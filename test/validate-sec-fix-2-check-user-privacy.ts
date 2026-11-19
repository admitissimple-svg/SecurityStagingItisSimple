/**
 * SEC.FIX.2 — Privacidade em GET /api/auth/check-user
 *
 * Valida:
 * 1. Ausência de vazamento de dados pessoais, comissões, repasses e informações
 *    administrativas (admin, pending_teacher, approvalStatus, creditLots, etc.)
 *    para estudante, professor aprovado, professor pendente, administrador e inexistente.
 * 2. Preservação dos campos mínimos indispensáveis aos fluxos legítimos de
 *    cadastro, onboarding e verificação de unicidade (emailExists, nameExists,
 *    exists, available, verificationAvailable, verificationStatus e HTTP 200/503).
 * 3. Compatibilidade integral de cadastro, login e onboarding após a correção.
 */

process.env.NODE_ENV = 'test';
process.env.FIREBASE_PROJECT_ID = 'itissimple-security-staging';
process.env.FIREBASE_DATABASE_ID = '(default)';

import assert from 'assert';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { app as serverApp, initCloudPersistence, resetInMemoryDbForTesting } from '../serverApp';
import { setFirebaseAdminAuthForTesting, resetFirebaseAdminForTesting } from '../src/serverFirebaseAdmin';
import { setFirebaseAdminFirestoreForTesting, resetFirebaseAdminFirestoreForTesting } from '../src/serverFirestore';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`  ✅ PASS: ${name}`);
    passed++;
  } catch (err: any) {
    console.error(`  ❌ FAIL: ${name}`);
    console.error(`         ${err?.stack || err?.message || err}`);
    failed++;
  }
}

function createMockFirestore() {
  const store = new Map<string, Record<string, any>>();
  let failUsersQuery = false;

  const makeDocRef = (col: string, id: string): any => {
    const key = `${col}::${id}`;
    return {
      id,
      path: `${col}/${id}`,
      get: async () => {
        const val = store.get(key);
        return {
          id,
          exists: Boolean(val),
          ref: makeDocRef(col, id),
          data: () => (val ? JSON.parse(JSON.stringify(val)) : undefined),
        };
      },
      set: async (data: Record<string, any>, opts?: { merge?: boolean }) => {
        const prev = opts?.merge ? store.get(key) || {} : {};
        store.set(key, JSON.parse(JSON.stringify({ ...prev, ...data })));
        return { writeTime: new Date() };
      },
      collection: () => ({
        get: async () => ({ empty: true, docs: [], size: 0, forEach: () => {} }),
      }),
    };
  };

  return {
    collection: (col: string) => ({
      doc: (id: string) => makeDocRef(col, id),
      where: (field: string, _op: string, value: any) => ({
        limit: () => ({
          get: async () => {
            if (col === 'users' && failUsersQuery) throw new Error('Simulated Firestore outage');
            const docs: any[] = [];
            for (const [k, v] of store.entries()) {
              if (k.startsWith(`${col}::`) && v?.[field] === value) {
                const id = k.split('::')[1];
                docs.push({ id, exists: true, ref: makeDocRef(col, id), data: () => JSON.parse(JSON.stringify(v)) });
              }
            }
            return { empty: docs.length === 0, size: docs.length, docs, forEach: (cb: any) => docs.forEach(cb) };
          },
        }),
        get: async () => {
          if (col === 'users' && failUsersQuery) throw new Error('Simulated Firestore outage');
          const docs: any[] = [];
          for (const [k, v] of store.entries()) {
            if (k.startsWith(`${col}::`) && v?.[field] === value) {
              const id = k.split('::')[1];
              docs.push({ id, exists: true, ref: makeDocRef(col, id), data: () => JSON.parse(JSON.stringify(v)) });
            }
          }
          return { empty: docs.length === 0, size: docs.length, docs, forEach: (cb: any) => docs.forEach(cb) };
        },
      }),
      get: async () => {
        if (col === 'users' && failUsersQuery) throw new Error('Simulated Firestore outage');
        const docs: any[] = [];
        for (const [k, v] of store.entries()) {
          if (k.startsWith(`${col}::`)) {
            const id = k.split('::')[1];
            docs.push({ id, exists: true, ref: makeDocRef(col, id), data: () => JSON.parse(JSON.stringify(v)) });
          }
        }
        return { empty: docs.length === 0, size: docs.length, docs, forEach: (cb: any) => docs.forEach(cb) };
      },
    }),
    _setDoc: (col: string, id: string, data: Record<string, any>) => {
      store.set(`${col}::${id}`, JSON.parse(JSON.stringify(data)));
    },
    _setFailUsersQuery: (v: boolean) => {
      failUsersQuery = v;
    },
  };
}

function makeRequest(
  server: http.Server,
  method: string,
  reqPath: string,
  body?: any,
  headers: Record<string, string> = {}
): Promise<{ status: number; data: any }> {
  return new Promise((resolve, reject) => {
    const addr = server.address() as any;
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: addr.port,
        path: reqPath,
        method,
        headers: {
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
          ...headers,
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => (raw += chunk));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode || 0, data: raw ? JSON.parse(raw) : null });
          } catch {
            resolve({ status: res.statusCode || 0, data: raw });
          }
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const ALLOWED_200_KEYS = [
  'available',
  'emailExists',
  'exists',
  'nameExists',
  'verificationAvailable',
  'verificationStatus',
];

const FORBIDDEN_TOP_LEVEL_KEYS = ['profile', 'student', 'tutor', 'name', 'role', 'uid', 'email'];

const SENSITIVE_SUBSTRINGS = [
  'adminCommissionPercent',
  'commissionModel',
  'commissionVersion',
  'commissionHistory',
  'payout',
  'pixKey',
  'bankAccount',
  'paypalEmail',
  'approvedBy',
  'approvalStatus',
  'adminNotes',
  'creditLots',
  'meet.google.com',
  '+551199999',
  'Secret',
];

function assertNoPrivacyLeak(data: Record<string, any>, label: string) {
  const keys = Object.keys(data).sort();
  assert.deepStrictEqual(
    keys,
    ALLOWED_200_KEYS,
    `${label}: response keys must match strict allowlist (${JSON.stringify(keys)})`
  );
  for (const forbidden of FORBIDDEN_TOP_LEVEL_KEYS) {
    assert.strictEqual(
      Object.prototype.hasOwnProperty.call(data, forbidden),
      false,
      `${label}: forbidden key "${forbidden}" must not be present`
    );
  }
  const serialized = JSON.stringify(data);
  for (const needle of SENSITIVE_SUBSTRINGS) {
    assert.strictEqual(
      serialized.includes(needle),
      false,
      `${label}: response must not leak sensitive substring "${needle}"`
    );
  }
}

async function runSuite() {
  console.log('======================================================================');
  console.log('SEC.FIX.2 — PRIVACIDADE EM GET /api/auth/check-user');
  console.log('======================================================================\n');

  resetInMemoryDbForTesting();
  const mockDb = createMockFirestore();

  const STUDENT_UID = 'SecFix2StudentUid1234567890';
  const STUDENT_EMAIL = 'student.secfix2@example.com';
  const TEACHER_UID = 'SecFix2TeacherUid1234567890';
  const TEACHER_EMAIL = 'teacher.secfix2@example.com';
  const PENDING_TEACHER_UID = 'SecFix2PendingTeacherUid123';
  const PENDING_TEACHER_EMAIL = 'pending.secfix2@example.com';
  const ADMIN_UID = 'SecFix2AdminUid123456789012';
  const ADMIN_EMAIL = 'admin.secfix2@example.com';

  mockDb._setDoc('users', STUDENT_UID, {
    id: STUDENT_UID,
    uid: STUDENT_UID,
    email: STUDENT_EMAIL,
    name: 'Secret Student Name',
    role: 'student',
    phone: '+5511999990001',
    teacherUid: TEACHER_UID,
    teacherEmail: TEACHER_EMAIL,
    credits: 12,
    creditLots: [{ lotId: 'lot-1', remaining: 12, paidCents: 48000 }],
    enrollmentStatus: 'active',
  });

  mockDb._setDoc('users', TEACHER_UID, {
    id: TEACHER_UID,
    uid: TEACHER_UID,
    email: TEACHER_EMAIL,
    name: 'Secret Teacher Name',
    role: 'teacher',
    approvalStatus: 'approved',
    isApproved: true,
    approved: true,
    approvedByUid: ADMIN_UID,
    approvedByEmail: ADMIN_EMAIL,
    adminCommissionPercent: 25,
    commissionModel: 'MARKUP',
    commissionVersion: 2,
    commissionHistory: [{ version: 2, percent: 25, updatedBy: ADMIN_EMAIL }],
    pricePerSessionUsd: 30,
    basePriceUsd: 24,
    payoutMethod: 'pix',
    pixKey: 'secret-pix-key-123',
    paypalEmail: 'payout@example.com',
    meetUrl: 'https://meet.google.com/secret-teacher-room',
    adminNotes: 'Internal admin evaluation note',
  });

  mockDb._setDoc('tutors', TEACHER_UID, {
    id: TEACHER_UID,
    uid: TEACHER_UID,
    email: TEACHER_EMAIL,
    name: 'Secret Teacher Name',
    role: 'teacher',
    approvalStatus: 'approved',
    isApproved: true,
    approved: true,
    approvedByUid: ADMIN_UID,
    approvedByEmail: ADMIN_EMAIL,
    adminCommissionPercent: 25,
    commissionModel: 'MARKUP',
    commissionVersion: 2,
    commissionHistory: [{ version: 2, percent: 25, updatedBy: ADMIN_EMAIL }],
    pricePerSessionUsd: 30,
    basePriceUsd: 24,
    payoutMethod: 'pix',
    pixKey: 'secret-pix-key-123',
    meetUrl: 'https://meet.google.com/secret-teacher-room',
    adminNotes: 'Internal admin evaluation note',
  });

  mockDb._setDoc('users', PENDING_TEACHER_UID, {
    id: PENDING_TEACHER_UID,
    uid: PENDING_TEACHER_UID,
    email: PENDING_TEACHER_EMAIL,
    name: 'Secret Pending Teacher',
    role: 'teacher',
    approvalStatus: 'pending',
    isApproved: false,
    approved: false,
    pixKey: 'pending-pix-key',
    adminNotes: 'Awaiting background verification',
  });

  mockDb._setDoc('tutors', PENDING_TEACHER_UID, {
    id: PENDING_TEACHER_UID,
    uid: PENDING_TEACHER_UID,
    email: PENDING_TEACHER_EMAIL,
    name: 'Secret Pending Teacher',
    role: 'teacher',
    approvalStatus: 'pending',
    isApproved: false,
    approved: false,
    pixKey: 'pending-pix-key',
    adminNotes: 'Awaiting background verification',
  });

  mockDb._setDoc('users', ADMIN_UID, {
    id: ADMIN_UID,
    uid: ADMIN_UID,
    email: ADMIN_EMAIL,
    name: 'Secret Admin Name',
    role: 'admin',
    phone: '+5511999999999',
  });

  setFirebaseAdminFirestoreForTesting(mockDb as any);
  await initCloudPersistence();

  const authRecords: Record<string, any> = {
    [STUDENT_EMAIL]: { uid: STUDENT_UID, email: STUDENT_EMAIL, displayName: 'Secret Student Name' },
    [TEACHER_EMAIL]: { uid: TEACHER_UID, email: TEACHER_EMAIL, displayName: 'Secret Teacher Name', customClaims: { role: 'teacher' } },
    [PENDING_TEACHER_EMAIL]: { uid: PENDING_TEACHER_UID, email: PENDING_TEACHER_EMAIL, displayName: 'Secret Pending Teacher' },
    [ADMIN_EMAIL]: { uid: ADMIN_UID, email: ADMIN_EMAIL, displayName: 'Secret Admin Name', customClaims: { role: 'admin' } },
  };

  setFirebaseAdminAuthForTesting({
    getUserByEmail: async (email: string) => {
      const rec = authRecords[email.toLowerCase().trim()];
      if (rec) return rec;
      const err: any = new Error('User not found');
      err.code = 'auth/user-not-found';
      throw err;
    },
    verifyIdToken: async (token: string) => {
      if (token === 'tok-student-secfix2') {
        return { uid: STUDENT_UID, email: STUDENT_EMAIL, email_verified: true };
      }
      if (token === 'tok-new-onboarding') {
        return { uid: 'NewOnboardingUid1234567890', email: 'new.onboarding@example.com', email_verified: true };
      }
      throw new Error('Invalid token');
    },
  } as any);

  const server = http.createServer(serverApp);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    await test('1. Estudante existente retorna apenas status de existência sem vazar profile, student, name, role ou dados privados', async () => {
      const res = await makeRequest(server, 'GET', `/api/auth/check-user?email=${encodeURIComponent(STUDENT_EMAIL)}&role=student`);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.available, true);
      assert.strictEqual(res.data.verificationAvailable, true);
      assert.strictEqual(res.data.verificationStatus, 'available');
      assert.strictEqual(res.data.exists, true);
      assert.strictEqual(res.data.emailExists, true);
      assert.strictEqual(res.data.nameExists, false);
      assertNoPrivacyLeak(res.data, 'student');
    });

    await test('2. Professor aprovado não expõe tutor, comissões, repasses (pix/paypal/basePrice), meetUrl ou aprovação', async () => {
      const res = await makeRequest(server, 'GET', `/api/auth/check-user?email=${encodeURIComponent(TEACHER_EMAIL)}&role=teacher`);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.emailExists, true);
      assert.strictEqual(res.data.exists, true);
      assertNoPrivacyLeak(res.data, 'approved-teacher');
    });

    await test('3. Professor pendente não expõe status administrativo (pending_teacher / approvalStatus / adminNotes)', async () => {
      const res = await makeRequest(server, 'GET', `/api/auth/check-user?email=${encodeURIComponent(PENDING_TEACHER_EMAIL)}&role=teacher`);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.emailExists, true);
      assertNoPrivacyLeak(res.data, 'pending-teacher');
    });

    await test('4. Conta administrativa não expõe role=admin nem dados do administrador', async () => {
      const res = await makeRequest(server, 'GET', `/api/auth/check-user?email=${encodeURIComponent(ADMIN_EMAIL)}`);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.emailExists, true);
      assertNoPrivacyLeak(res.data, 'admin');
    });

    await test('5. E-mail inexistente retorna emailExists=false sem campos extras', async () => {
      const res = await makeRequest(server, 'GET', `/api/auth/check-user?email=${encodeURIComponent('never.existed@example.com')}`);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.emailExists, false);
      assert.strictEqual(res.data.nameExists, false);
      assert.strictEqual(res.data.exists, false);
      assertNoPrivacyLeak(res.data, 'non-existent');
    });

    await test('6. Verificação de unicidade por nome preserva nameExists sem vazar dados pessoais', async () => {
      const resStudentName = await makeRequest(
        server,
        'GET',
        `/api/auth/check-user?name=${encodeURIComponent('Secret Student Name')}&role=student`
      );
      assert.strictEqual(resStudentName.status, 200);
      assert.strictEqual(resStudentName.data.nameExists, true);
      assert.strictEqual(resStudentName.data.emailExists, false);
      assert.strictEqual(resStudentName.data.exists, true);
      assertNoPrivacyLeak(resStudentName.data, 'student-name');

      const resTeacherName = await makeRequest(
        server,
        'GET',
        `/api/auth/check-user?name=${encodeURIComponent('Secret Teacher Name')}&role=teacher`
      );
      assert.strictEqual(resTeacherName.status, 200);
      assert.strictEqual(resTeacherName.data.nameExists, true);
      assert.strictEqual(resTeacherName.data.exists, true);
      assertNoPrivacyLeak(resTeacherName.data, 'teacher-name');

      const resUniqueName = await makeRequest(
        server,
        'GET',
        `/api/auth/check-user?name=${encodeURIComponent('Brand New Person')}&role=student`
      );
      assert.strictEqual(resUniqueName.status, 200);
      assert.strictEqual(resUniqueName.data.nameExists, false);
      assert.strictEqual(resUniqueName.data.exists, false);
      assertNoPrivacyLeak(resUniqueName.data, 'unique-name');
    });

    await test('7. HTTP 503 em indisponibilidade de Auth ou Firestore preserva contrato sem campos privados', async () => {
      mockDb._setFailUsersQuery(true);
      const resName503 = await makeRequest(
        server,
        'GET',
        `/api/auth/check-user?name=${encodeURIComponent('Secret Student Name')}&role=student`
      );
      mockDb._setFailUsersQuery(false);
      assert.strictEqual(resName503.status, 503);
      assert.strictEqual(resName503.data.available, false);
      assert.strictEqual(resName503.data.verificationAvailable, false);
      assert.strictEqual(resName503.data.verificationStatus, 'unavailable');
      assert.strictEqual(resName503.data.nameExists, null);
      assert.strictEqual(resName503.data.error, 'AUTHORITATIVE_VERIFICATION_UNAVAILABLE');
      for (const forbidden of FORBIDDEN_TOP_LEVEL_KEYS) {
        assert.strictEqual(Object.prototype.hasOwnProperty.call(resName503.data, forbidden), false);
      }

      setFirebaseAdminAuthForTesting({
        getUserByEmail: async () => {
          const err: any = new Error('Auth service down');
          err.code = 'auth/internal-error';
          throw err;
        },
      } as any);
      const resAuth503 = await makeRequest(
        server,
        'GET',
        `/api/auth/check-user?email=${encodeURIComponent(STUDENT_EMAIL)}`
      );
      assert.strictEqual(resAuth503.status, 503);
      assert.strictEqual(resAuth503.data.available, false);
      assert.strictEqual(resAuth503.data.verificationAvailable, false);
      assert.strictEqual(resAuth503.data.emailExists, null);
      assert.strictEqual(resAuth503.data.error, 'AUTHORITATIVE_VERIFICATION_UNAVAILABLE');
      for (const forbidden of FORBIDDEN_TOP_LEVEL_KEYS) {
        assert.strictEqual(Object.prototype.hasOwnProperty.call(resAuth503.data, forbidden), false);
      }

      // Restore auth mock
      setFirebaseAdminAuthForTesting({
        getUserByEmail: async (email: string) => {
          const rec = authRecords[email.toLowerCase().trim()];
          if (rec) return rec;
          const err: any = new Error('User not found');
          err.code = 'auth/user-not-found';
          throw err;
        },
        verifyIdToken: async (token: string) => {
          if (token === 'tok-student-secfix2') {
            return { uid: STUDENT_UID, email: STUDENT_EMAIL, email_verified: true };
          }
          if (token === 'tok-new-onboarding') {
            return { uid: 'NewOnboardingUid1234567890', email: 'new.onboarding@example.com', email_verified: true };
          }
          throw new Error('Invalid token');
        },
      } as any);
    });

    await test('8. Compatibilidade de login, cadastro e onboarding preservada', async () => {
      // Onboarding pre-check (StartLivingEmailModal flow)
      const preCheckNew = await makeRequest(
        server,
        'GET',
        `/api/auth/check-user?email=${encodeURIComponent('new.onboarding@example.com')}`
      );
      assert.strictEqual(preCheckNew.status, 200);
      assert.strictEqual(preCheckNew.data.emailExists, false);

      // Signup after pre-check
      const signupRes = await makeRequest(
        server,
        'POST',
        '/api/auth/signup',
        {
          uid: 'NewOnboardingUid1234567890',
          name: 'New Onboarding User',
          email: 'new.onboarding@example.com',
          role: 'student',
          englishLevel: 'iniciante',
        },
        { Authorization: 'Bearer tok-new-onboarding' }
      );
      assert.strictEqual(signupRes.status, 201);
      assert.strictEqual(signupRes.data.success, true);

      // Login flow preserved
      const loginRes = await makeRequest(
        server,
        'POST',
        '/api/auth/login',
        { uid: STUDENT_UID, email: STUDENT_EMAIL, role: 'student' },
        { Authorization: 'Bearer tok-student-secfix2' }
      );
      assert.strictEqual(loginRes.status, 200);
      assert.strictEqual(loginRes.data.account?.role, 'student');

      // Verify-session flow preserved
      const verifyRes = await makeRequest(server, 'GET', '/api/auth/verify-session', undefined, {
        Authorization: 'Bearer tok-student-secfix2',
      });
      assert.strictEqual(verifyRes.status, 200);
      assert.strictEqual(verifyRes.data.role, 'student');

      // Frontend callers only consume emailExists / nameExists and never read profile/student/tutor/name/role
      const callerFiles = [
        'src/components/AuthModal.tsx',
        'src/components/StartLivingEmailModal.tsx',
        'src/components/BecomeTutorModal.tsx',
      ];
      for (const relPath of callerFiles) {
        const content = fs.readFileSync(path.resolve(process.cwd(), relPath), 'utf8');
        assert.strictEqual(content.includes('/api/auth/check-user'), true, `${relPath} calls check-user`);
        assert.strictEqual(
          /check-user[\s\S]{0,400}data\.(profile|student|tutor|name\b|role\b)/.test(content),
          false,
          `${relPath} does not consume stripped private fields from check-user`
        );
      }
    });
  } finally {
    resetFirebaseAdminFirestoreForTesting();
    resetFirebaseAdminForTesting();
    server.closeAllConnections?.();
    server.close();
  }

  console.log('\n======================================================================');
  console.log(`SEC.FIX.2 SUITE: ${passed} PASSED, ${failed} FAILED`);
  console.log('======================================================================');
  process.exit(failed > 0 ? 1 : 0);
}

runSuite().catch((err) => {
  console.error('Fatal error running SEC.FIX.2 suite:', err);
  process.exit(1);
});
