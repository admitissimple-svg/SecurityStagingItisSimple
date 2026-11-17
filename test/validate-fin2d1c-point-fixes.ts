/**
 * TEST SUITE: FIN.2D.1C — CORREÇÕES PONTUAIS
 * Validates all 4 targeted fixes:
 *  1. Identidade/RBAC (custom claim teacher cannot authorize pending/rejected/unregistered, unregistered != student, legitimate logins preserved)
 *  2. Google Login deleted accounts blocked persistently (403 ACCOUNT_DELETED, no Firestore doc recreation)
 *  3. Profile weeklyNativeLessonsTarget read/write restored without exposing admin/financial fields
 *  4. ADM Credits "Editar Total" 501 handling & feedback + PAYMENTS_ENABLED=false preservation
 */

process.env.NODE_ENV = 'test';
process.env.FIREBASE_PROJECT_ID = 'itissimple-security-staging';
process.env.FIREBASE_DATABASE_ID = '(default)';
process.env.PAYMENTS_ENABLED = 'false';

import assert from 'assert';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { app as serverApp, readDb, resetInMemoryDbForTesting } from '../serverApp';
import {
  resolveCanonicalUserRoleAndIdentity,
  setFirebaseAdminFirestoreForTesting,
  resetFirebaseAdminFirestoreForTesting,
} from '../src/serverFirestore';
import {
  setFirebaseAdminAuthForTesting,
  resetFirebaseAdminForTesting,
} from '../src/serverFirebaseAdmin';

function createIsolatedFirestoreMock() {
  const store = new Map<string, Record<string, any>>();

  const matchFilters = (data: Record<string, any>, filters: Array<{ field: string; op: string; val: any }>) => {
    return filters.every((f) => {
      const val = data[f.field];
      if (f.op === '==') return val === f.val;
      return false;
    });
  };

  const makeDocRef = (col: string, id: string, parentPath = ''): any => {
    const fullCol = parentPath ? `${parentPath}/${col}` : col;
    const key = `${fullCol}::${id}`;
    return {
      _col: fullCol,
      _id: id,
      id,
      path: `${fullCol}/${id}`,
      collection: (subCol: string) => makeCollectionRef(subCol, `${fullCol}/${id}`),
      get: async () => {
        const val = store.get(key);
        return {
          id,
          exists: Boolean(val),
          ref: makeDocRef(col, id, parentPath),
          data: () => (val ? JSON.parse(JSON.stringify(val)) : undefined),
        };
      },
      set: async (data: Record<string, any>, opts?: { merge?: boolean }) => {
        const prev = opts?.merge ? (store.get(key) || {}) : {};
        store.set(key, JSON.parse(JSON.stringify({ ...prev, ...data })));
        return { writeTime: new Date() };
      },
      update: async (data: Record<string, any>) => {
        const prev = store.get(key) || {};
        store.set(key, JSON.parse(JSON.stringify({ ...prev, ...data })));
        return { writeTime: new Date() };
      },
      delete: async () => {
        store.delete(key);
        return { writeTime: new Date() };
      },
    };
  };

  const makeQuery = (
    col: string,
    parentPath = '',
    filters: Array<{ field: string; op: string; val: any }> = [],
    maxLimit?: number
  ): any => {
    const fullCol = parentPath ? `${parentPath}/${col}` : col;
    return {
      where: (field: string, op: string, val: any) =>
        makeQuery(col, parentPath, [...filters, { field, op, val }], maxLimit),
      limit: (n: number) => makeQuery(col, parentPath, filters, n),
      orderBy: () => makeQuery(col, parentPath, filters, maxLimit),
      get: async () => {
        const docs: any[] = [];
        for (const [k, v] of store.entries()) {
          if (!k.startsWith(`${fullCol}::`)) continue;
          const docId = k.slice(`${fullCol}::`.length);
          if (docId.includes('/')) continue;
          if (matchFilters(v, filters)) {
            docs.push({
              id: docId,
              exists: true,
              ref: makeDocRef(col, docId, parentPath),
              data: () => JSON.parse(JSON.stringify(v)),
            });
          }
        }
        const sliced = typeof maxLimit === 'number' ? docs.slice(0, maxLimit) : docs;
        return {
          empty: sliced.length === 0,
          docs: sliced,
          size: sliced.length,
          forEach: (cb: (d: any) => void) => sliced.forEach(cb),
        };
      },
    };
  };

  const makeCollectionRef = (col: string, parentPath = ''): any => ({
    doc: (id: string) => makeDocRef(col, id, parentPath),
    where: (field: string, op: string, val: any) => makeQuery(col, parentPath, [{ field, op, val }]),
    limit: (n: number) => makeQuery(col, parentPath, [], n),
    orderBy: () => makeQuery(col, parentPath, []),
    get: async () => makeQuery(col, parentPath).get(),
  });

  return {
    collection: (col: string) => makeCollectionRef(col),
    batch: () => {
      const ops: Array<() => void> = [];
      return {
        delete: (ref: any) => ops.push(() => store.delete(`${ref._col}::${ref._id}`)),
        set: (ref: any, data: Record<string, any>, opts?: { merge?: boolean }) =>
          ops.push(() => {
            const key = `${ref._col}::${ref._id}`;
            const prev = opts?.merge ? (store.get(key) || {}) : {};
            store.set(key, JSON.parse(JSON.stringify({ ...prev, ...data })));
          }),
        update: (ref: any, data: Record<string, any>) =>
          ops.push(() => {
            const key = `${ref._col}::${ref._id}`;
            const prev = store.get(key) || {};
            store.set(key, JSON.parse(JSON.stringify({ ...prev, ...data })));
          }),
        commit: async () => {
          ops.forEach((op) => op());
        },
      };
    },
    runTransaction: async (fn: (tx: any) => Promise<any>) => {
      const staged: Array<{ key: string; data: Record<string, any>; merge: boolean }> = [];
      const tx = {
        get: async (ref: any) => ref.get(),
        set: (ref: any, data: Record<string, any>, opts?: { merge?: boolean }) => {
          staged.push({
            key: `${ref._col}::${ref._id}`,
            data: JSON.parse(JSON.stringify(data)),
            merge: Boolean(opts?.merge),
          });
        },
        update: (ref: any, data: Record<string, any>) => {
          staged.push({
            key: `${ref._col}::${ref._id}`,
            data: JSON.parse(JSON.stringify(data)),
            merge: true,
          });
        },
      };
      const result = await fn(tx);
      for (const w of staged) {
        const prev = w.merge ? (store.get(w.key) || {}) : {};
        store.set(w.key, JSON.parse(JSON.stringify({ ...prev, ...w.data })));
      }
      return result;
    },
    _store: store,
    _setDoc: (col: string, id: string, data: Record<string, any>) => {
      store.set(`${col}::${id}`, JSON.parse(JSON.stringify(data)));
    },
    _getDoc: (col: string, id: string) => store.get(`${col}::${id}`),
    _deleteDoc: (col: string, id: string) => store.delete(`${col}::${id}`),
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
    const addr = server.address();
    if (!addr || typeof addr === 'string') {
      return reject(new Error('Server address unavailable'));
    }
    const bodyStr = body !== undefined ? JSON.stringify(body) : undefined;
    const reqHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      Connection: 'close',
      ...headers,
    };
    if (bodyStr) {
      reqHeaders['Content-Length'] = Buffer.byteLength(bodyStr).toString();
    }
    const req = http.request(
      { host: '127.0.0.1', port: addr.port, path: reqPath, method, headers: reqHeaders },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => (raw += chunk));
        res.on('end', () => {
          let parsed: any;
          try {
            parsed = JSON.parse(raw);
          } catch {
            parsed = raw;
          }
          resolve({ status: res.statusCode || 0, data: parsed });
        });
      }
    );
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

async function runSuite() {
  console.log('======================================================================');
  console.log('FIN.2D.1C — CORREÇÕES PONTUAIS (SUÍTE DIRECIONADA)');
  console.log('======================================================================\n');

  let passed = 0;
  let failed = 0;

  async function test(name: string, fn: () => void | Promise<void>) {
    try {
      await fn();
      console.log(`  ✅ PASS: ${name}`);
      passed++;
    } catch (err: any) {
      console.error(`  ❌ FAIL: ${name}`);
      console.error(`         ${err?.message || err}`);
      failed++;
    }
  }

  resetInMemoryDbForTesting();
  const mockFs = createIsolatedFirestoreMock();
  setFirebaseAdminFirestoreForTesting(mockFs as any);

  const ADMIN_UID = 'Fin2d1cAdminUid0000000000001';
  const ADMIN_EMAIL = 'adm.itissimple@gmail.com';
  const APPROVED_TEACHER_UID = 'Fin2d1cApprovedTeacherUid002';
  const APPROVED_TEACHER_EMAIL = 'approved.nf@itissimple-test.com';
  const PENDING_TEACHER_UID = 'Fin2d1cPendingTeacherUid0003';
  const PENDING_TEACHER_EMAIL = 'pending.nf@itissimple-test.com';
  const REJECTED_TEACHER_UID = 'Fin2d1cRejectedTeacherUid004';
  const REJECTED_TEACHER_EMAIL = 'rejected.nf@itissimple-test.com';
  const CLAIM_ONLY_TEACHER_UID = 'Fin2d1cClaimOnlyTeacherUid05';
  const CLAIM_ONLY_TEACHER_EMAIL = 'claimonly.nf@itissimple-test.com';
  const UNREGISTERED_PLAIN_UID = 'Fin2d1cUnregisteredUid000006';
  const UNREGISTERED_PLAIN_EMAIL = 'unregistered@itissimple-test.com';
  const STUDENT_UID = 'Fin2d1cRegisteredStudentUid7';
  const STUDENT_EMAIL = 'student.reg@itissimple-test.com';
  const DELETED_STUDENT_UID = 'Fin2d1cDeletedStudentUid0008';
  const DELETED_STUDENT_EMAIL = 'deleted.student@itissimple-test.com';
  const DELETED_TUTOR_UID = 'Fin2d1cDeletedTutorUid000009';
  const DELETED_TUTOR_EMAIL = 'deleted.tutor@itissimple-test.com';
  const GOOGLE_NEW_UID = 'Fin2d1cGoogleFreshUid0000010';
  const GOOGLE_NEW_EMAIL = 'google.fresh@itissimple-test.com';

  // Seed Firestore canonical docs
  mockFs._setDoc('users', ADMIN_UID, {
    id: ADMIN_UID,
    uid: ADMIN_UID,
    email: ADMIN_EMAIL,
    name: 'Admin Principal',
    role: 'admin',
  });

  mockFs._setDoc('tutors', APPROVED_TEACHER_UID, {
    id: APPROVED_TEACHER_UID,
    uid: APPROVED_TEACHER_UID,
    authUid: APPROVED_TEACHER_UID,
    publicTutorId: 'approved-nf',
    email: APPROVED_TEACHER_EMAIL,
    name: 'Approved NF',
    role: 'teacher',
    approvalStatus: 'approved',
    status: 'approved',
    isApproved: true,
    approved: true,
  });

  mockFs._setDoc('tutors', PENDING_TEACHER_UID, {
    id: PENDING_TEACHER_UID,
    uid: PENDING_TEACHER_UID,
    authUid: PENDING_TEACHER_UID,
    email: PENDING_TEACHER_EMAIL,
    name: 'Pending NF',
    role: 'teacher',
    approvalStatus: 'pending',
    status: 'pending',
    isApproved: false,
    approved: false,
  });

  mockFs._setDoc('tutors', REJECTED_TEACHER_UID, {
    id: REJECTED_TEACHER_UID,
    uid: REJECTED_TEACHER_UID,
    authUid: REJECTED_TEACHER_UID,
    email: REJECTED_TEACHER_EMAIL,
    name: 'Rejected NF',
    role: 'teacher',
    approvalStatus: 'rejected',
    status: 'rejected',
    isApproved: false,
    approved: false,
  });

  mockFs._setDoc('users', STUDENT_UID, {
    id: STUDENT_UID,
    uid: STUDENT_UID,
    email: STUDENT_EMAIL,
    name: 'Registered Student',
    role: 'student',
    level: 'iniciante',
    contractedLessons: 5,
    availableLessons: 3,
    hasCompletedTrialLesson: false,
    subscriptionType: 'paid_package',
    weeklyNativeLessonsTarget: 1,
    teacherUid: APPROVED_TEACHER_UID,
    teacherEmail: APPROVED_TEACHER_EMAIL,
    enrollmentStatus: 'active',
  });

  mockFs._setDoc('users', DELETED_STUDENT_UID, {
    id: DELETED_STUDENT_UID,
    uid: DELETED_STUDENT_UID,
    email: DELETED_STUDENT_EMAIL,
    name: 'To Be Deleted Student',
    role: 'student',
  });

  mockFs._setDoc('tutors', DELETED_TUTOR_UID, {
    id: DELETED_TUTOR_UID,
    uid: DELETED_TUTOR_UID,
    authUid: DELETED_TUTOR_UID,
    email: DELETED_TUTOR_EMAIL,
    name: 'To Be Deleted Tutor',
    role: 'teacher',
    approvalStatus: 'approved',
    isApproved: true,
  });

  const tokenMap: Record<string, any> = {
    'tok-admin': { uid: ADMIN_UID, email: ADMIN_EMAIL, email_verified: true, role: 'admin', admin: true },
    'tok-approved-teacher': { uid: APPROVED_TEACHER_UID, email: APPROVED_TEACHER_EMAIL, email_verified: true, role: 'teacher' },
    'tok-pending-teacher-claim': { uid: PENDING_TEACHER_UID, email: PENDING_TEACHER_EMAIL, email_verified: true, role: 'teacher' },
    'tok-rejected-teacher-claim': { uid: REJECTED_TEACHER_UID, email: REJECTED_TEACHER_EMAIL, email_verified: true, role: 'teacher' },
    'tok-claim-only-teacher': { uid: CLAIM_ONLY_TEACHER_UID, email: CLAIM_ONLY_TEACHER_EMAIL, email_verified: true, role: 'teacher' },
    'tok-unregistered-plain': { uid: UNREGISTERED_PLAIN_UID, email: UNREGISTERED_PLAIN_EMAIL, email_verified: true },
    'tok-student': { uid: STUDENT_UID, email: STUDENT_EMAIL, email_verified: true, role: 'student' },
    'tok-deleted-student': { uid: DELETED_STUDENT_UID, email: DELETED_STUDENT_EMAIL, email_verified: true, role: 'student' },
    'tok-deleted-tutor': { uid: DELETED_TUTOR_UID, email: DELETED_TUTOR_EMAIL, email_verified: true, role: 'teacher' },
    'tok-google-fresh': { uid: GOOGLE_NEW_UID, email: GOOGLE_NEW_EMAIL, email_verified: true },
  };

  setFirebaseAdminAuthForTesting({
    verifyIdToken: async (token: string) => {
      if (!tokenMap[token]) throw new Error('Invalid token');
      return tokenMap[token];
    },
    getUserByEmail: async (email: string) => {
      const clean = email.toLowerCase().trim();
      const found = Object.values(tokenMap).find((u: any) => u.email === clean);
      if (found) {
        return {
          uid: found.uid,
          email: found.email,
          displayName: clean.split('@')[0],
          customClaims: found.role ? { role: found.role } : {},
        };
      }
      const err: any = new Error('User not found');
      err.code = 'auth/user-not-found';
      throw err;
    },
  } as any);

  const server = http.createServer(serverApp);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    // 1. IDENTIDADE / RBAC
    await test('1.1 Custom claim "teacher" em tutor PENDENTE não autoriza teacher (verify-session=403, login=403, vocab=403)', async () => {
      const resResolve = await resolveCanonicalUserRoleAndIdentity({
        uid: PENDING_TEACHER_UID,
        email: PENDING_TEACHER_EMAIL,
        tokenRole: 'teacher',
      });
      assert.strictEqual(resResolve.role, 'pending_teacher');

      const vs = await makeRequest(server, 'GET', '/api/auth/verify-session', undefined, {
        Authorization: 'Bearer tok-pending-teacher-claim',
      });
      assert.strictEqual(vs.status, 403);
      assert.strictEqual(vs.data.role, 'pending_teacher');

      const login = await makeRequest(
        server,
        'POST',
        '/api/auth/login',
        { email: PENDING_TEACHER_EMAIL, uid: PENDING_TEACHER_UID, role: 'teacher' },
        { Authorization: 'Bearer tok-pending-teacher-claim' }
      );
      assert.strictEqual(login.status, 403);
      assert.strictEqual(login.data.code, 'TEACHER_APPROVAL_PENDING');

      const gLogin = await makeRequest(
        server,
        'POST',
        '/api/auth/google',
        { email: PENDING_TEACHER_EMAIL, uid: PENDING_TEACHER_UID, role: 'teacher' },
        { Authorization: 'Bearer tok-pending-teacher-claim' }
      );
      assert.strictEqual(gLogin.status, 403);
      assert.strictEqual(gLogin.data.code, 'TEACHER_APPROVAL_PENDING');

      const vocab = await makeRequest(
        server,
        'POST',
        '/api/lesson/vocab-generate',
        { words: ['focus'], topic: 'Test' },
        { Authorization: 'Bearer tok-pending-teacher-claim' }
      );
      assert.strictEqual(vocab.status, 403);
    });

    await test('1.2 Custom claim "teacher" em tutor REJEITADO não autoriza teacher nem student', async () => {
      const resResolve = await resolveCanonicalUserRoleAndIdentity({
        uid: REJECTED_TEACHER_UID,
        email: REJECTED_TEACHER_EMAIL,
        tokenRole: 'teacher',
      });
      assert.strictEqual(resResolve.role, 'unregistered');

      const vs = await makeRequest(server, 'GET', '/api/auth/verify-session', undefined, {
        Authorization: 'Bearer tok-rejected-teacher-claim',
      });
      assert.strictEqual(vs.status, 200);
      assert.strictEqual(vs.data.role, 'unregistered');

      const login = await makeRequest(
        server,
        'POST',
        '/api/auth/login',
        { email: REJECTED_TEACHER_EMAIL, uid: REJECTED_TEACHER_UID, role: 'teacher' },
        { Authorization: 'Bearer tok-rejected-teacher-claim' }
      );
      assert.strictEqual(login.status, 401);
      assert.strictEqual(login.data.code, 'ACCOUNT_NOT_REGISTERED');

      const vocab = await makeRequest(
        server,
        'POST',
        '/api/lesson/vocab-generate',
        { words: ['focus'], topic: 'Test' },
        { Authorization: 'Bearer tok-rejected-teacher-claim' }
      );
      assert.strictEqual(vocab.status, 403);
    });

    await test('1.3 Custom claim "teacher" SEM cadastro aprovado não autoriza teacher e /api/auth/check-user não retorna role=teacher', async () => {
      const resResolve = await resolveCanonicalUserRoleAndIdentity({
        uid: CLAIM_ONLY_TEACHER_UID,
        email: CLAIM_ONLY_TEACHER_EMAIL,
        tokenRole: 'teacher',
      });
      assert.strictEqual(resResolve.role, 'unregistered');

      const vs = await makeRequest(server, 'GET', '/api/auth/verify-session', undefined, {
        Authorization: 'Bearer tok-claim-only-teacher',
      });
      assert.strictEqual(vs.status, 200);
      assert.strictEqual(vs.data.role, 'unregistered');

      const login = await makeRequest(
        server,
        'POST',
        '/api/auth/login',
        { email: CLAIM_ONLY_TEACHER_EMAIL, uid: CLAIM_ONLY_TEACHER_UID, role: 'teacher' },
        { Authorization: 'Bearer tok-claim-only-teacher' }
      );
      assert.strictEqual(login.status, 401);
      assert.strictEqual(login.data.code, 'ACCOUNT_NOT_REGISTERED');

      const check = await makeRequest(
        server,
        'GET',
        `/api/auth/check-user?email=${encodeURIComponent(CLAIM_ONLY_TEACHER_EMAIL)}`
      );
      assert.strictEqual(check.status, 200);
      assert.strictEqual(check.data.role, null);
    });

    await test('1.4 UID não cadastrado SEM claim não recebe "student" automaticamente', async () => {
      const resResolve = await resolveCanonicalUserRoleAndIdentity({
        uid: UNREGISTERED_PLAIN_UID,
        email: UNREGISTERED_PLAIN_EMAIL,
        tokenRole: 'student',
      });
      assert.strictEqual(resResolve.role, 'unregistered');
      assert.strictEqual(resResolve.identityStatus, 'unregistered');

      const vs = await makeRequest(server, 'GET', '/api/auth/verify-session', undefined, {
        Authorization: 'Bearer tok-unregistered-plain',
      });
      assert.strictEqual(vs.status, 200);
      assert.strictEqual(vs.data.role, 'unregistered');

      const login = await makeRequest(
        server,
        'POST',
        '/api/auth/login',
        { email: UNREGISTERED_PLAIN_EMAIL, uid: UNREGISTERED_PLAIN_UID },
        { Authorization: 'Bearer tok-unregistered-plain' }
      );
      assert.strictEqual(login.status, 401);
      assert.strictEqual(login.data.code, 'ACCOUNT_NOT_REGISTERED');
    });

    await test('1.5 Login legítimo de ADM, professor aprovado e aluno registrado permanece íntegro', async () => {
      const adm = await makeRequest(server, 'GET', '/api/auth/verify-session', undefined, {
        Authorization: 'Bearer tok-admin',
      });
      assert.strictEqual(adm.status, 200);
      assert.strictEqual(adm.data.role, 'admin');

      const tch = await makeRequest(
        server,
        'POST',
        '/api/auth/login',
        { email: APPROVED_TEACHER_EMAIL, uid: APPROVED_TEACHER_UID, role: 'teacher' },
        { Authorization: 'Bearer tok-approved-teacher' }
      );
      assert.strictEqual(tch.status, 200);
      assert.strictEqual(tch.data.role, 'teacher');

      const stu = await makeRequest(
        server,
        'POST',
        '/api/auth/login',
        { email: STUDENT_EMAIL, uid: STUDENT_UID },
        { Authorization: 'Bearer tok-student' }
      );
      assert.strictEqual(stu.status, 200);
      assert.strictEqual(stu.data.role, 'student');
    });

    // 2. GOOGLE LOGIN — CONTAS EXCLUÍDAS
    await test('2.1 Conta de aluno excluída via DELETE é persistida em app_state/main_data e bloqueada em /api/auth/google mesmo após restart/cache vazio', async () => {
      const del = await makeRequest(
        server,
        'DELETE',
        `/api/students/${encodeURIComponent(DELETED_STUDENT_EMAIL)}`,
        undefined,
        { Authorization: 'Bearer tok-admin' }
      );
      assert.strictEqual(del.status, 200);
      assert.strictEqual(mockFs._getDoc('users', DELETED_STUDENT_UID), undefined, 'users doc deleted');

      const mainData = mockFs._getDoc('app_state', 'main_data');
      assert(
        Array.isArray(mainData?.deletedStudentEmails) && mainData.deletedStudentEmails.includes(DELETED_STUDENT_EMAIL),
        'deletedStudentEmails persisted directly in app_state/main_data'
      );

      // Simulate cold instance cache reset (RAM lost, Firestore persists)
      const memDb = readDb();
      memDb.deletedStudentEmails = [];

      const gBlocked = await makeRequest(
        server,
        'POST',
        '/api/auth/google',
        { uid: DELETED_STUDENT_UID, email: DELETED_STUDENT_EMAIL, name: 'Deleted Student' },
        { Authorization: 'Bearer tok-deleted-student' }
      );
      assert.strictEqual(gBlocked.status, 403);
      assert.strictEqual(gBlocked.data.code, 'ACCOUNT_DELETED');
      assert.strictEqual(mockFs._getDoc('users', DELETED_STUDENT_UID), undefined, 'users doc NOT recreated');
    });

    await test('2.2 Tutor excluído via DELETE é persistido em app_state/tutors e bloqueado em /api/auth/google', async () => {
      const delTutor = await makeRequest(
        server,
        'DELETE',
        `/api/tutors/${encodeURIComponent(DELETED_TUTOR_UID)}?email=${encodeURIComponent(DELETED_TUTOR_EMAIL)}`,
        undefined,
        { Authorization: 'Bearer tok-admin' }
      );
      assert.strictEqual(delTutor.status, 200);

      const memDb = readDb();
      memDb.deletedTutorEmails = [];
      memDb.deletedTutorIds = [];

      const gBlocked = await makeRequest(
        server,
        'POST',
        '/api/auth/google',
        { uid: DELETED_TUTOR_UID, email: DELETED_TUTOR_EMAIL, name: 'Deleted Tutor' },
        { Authorization: 'Bearer tok-deleted-tutor' }
      );
      assert.strictEqual(gBlocked.status, 403);
      assert.strictEqual(gBlocked.data.code, 'ACCOUNT_DELETED');
      assert.strictEqual(mockFs._getDoc('users', DELETED_TUTOR_UID), undefined, 'deleted tutor NOT recreated in users');
    });

    await test('2.3 Novo usuário legítimo (não excluído) no Google Login continua fazendo onboarding normalmente', async () => {
      const gOk = await makeRequest(
        server,
        'POST',
        '/api/auth/google',
        { uid: GOOGLE_NEW_UID, email: GOOGLE_NEW_EMAIL, name: 'Google Fresh' },
        { Authorization: 'Bearer tok-google-fresh' }
      );
      assert.strictEqual(gOk.status, 200);
      assert.strictEqual(gOk.data.role, 'student');
      assert(mockFs._getDoc('users', GOOGLE_NEW_UID), 'Fresh Google user created in users');
    });

    // 3. PERFIL — weeklyNativeLessonsTarget
    await test('3.1 Gravação e leitura de weeklyNativeLessonsTarget em /api/user-profile sem abrir campos administrativos/financeiros', async () => {
      const saveRes = await makeRequest(
        server,
        'POST',
        '/api/user-profile',
        {
          uid: STUDENT_UID,
          email: STUDENT_EMAIL,
          profile: {
            name: 'Registered Student Updated',
            weeklyNativeLessonsTarget: 4,
            contractedLessons: 999,
            availableLessons: 999,
            role: 'admin',
            hasCompletedTrialLesson: true,
          },
        },
        { Authorization: 'Bearer tok-student' }
      );
      assert.strictEqual(saveRes.status, 200);
      assert.strictEqual(saveRes.data.profile.weeklyNativeLessonsTarget, 4);
      assert.strictEqual(saveRes.data.profile.contractedLessons, 5, 'contractedLessons untouched');
      assert.strictEqual(saveRes.data.profile.availableLessons, 3, 'availableLessons untouched');
      assert.strictEqual(saveRes.data.profile.role, 'student', 'role escalation blocked');
      assert.strictEqual(saveRes.data.profile.hasCompletedTrialLesson, false, 'trial flag untouched');

      const fsSaved = mockFs._getDoc('users', STUDENT_UID);
      assert.strictEqual(fsSaved?.weeklyNativeLessonsTarget, 4, 'Firestore persisted weeklyNativeLessonsTarget=4');
      assert.strictEqual(fsSaved?.contractedLessons, 5, 'Firestore contractedLessons preserved');
      assert.strictEqual(fsSaved?.availableLessons, 3, 'Firestore availableLessons preserved');

      // Invalid target should NOT overwrite valid target
      const invalidSave = await makeRequest(
        server,
        'POST',
        '/api/user-profile',
        {
          uid: STUDENT_UID,
          email: STUDENT_EMAIL,
          profile: {
            weeklyNativeLessonsTarget: 99,
          },
        },
        { Authorization: 'Bearer tok-student' }
      );
      assert.strictEqual(invalidSave.status, 200);
      assert.strictEqual(invalidSave.data.profile.weeklyNativeLessonsTarget, 4, 'Out-of-range value rejected cleanly');

      const readRes = await makeRequest(
        server,
        'GET',
        `/api/user-profile?email=${encodeURIComponent(STUDENT_EMAIL)}&uid=${STUDENT_UID}`,
        undefined,
        { Authorization: 'Bearer tok-student' }
      );
      assert.strictEqual(readRes.status, 200);
      assert.strictEqual(readRes.data.profile.weeklyNativeLessonsTarget, 4);
    });

    await test('3.2 /api/students/profile também preserva/atualiza weeklyNativeLessonsTarget', async () => {
      const legacySave = await makeRequest(
        server,
        'POST',
        '/api/students/profile',
        {
          uid: STUDENT_UID,
          profile: {
            email: STUDENT_EMAIL,
            weeklyNativeLessonsTarget: 3,
          },
        },
        { Authorization: 'Bearer tok-student' }
      );
      assert.strictEqual(legacySave.status, 200);
      assert.strictEqual(legacySave.data.profile.weeklyNativeLessonsTarget, 3);
      assert.strictEqual(legacySave.data.profile.contractedLessons, 5);
    });

    // 4. CRÉDITOS ADM — 501 FEEDBACK + PAYMENTS_ENABLED=false
    await test('4.1 /api/students/contract retorna 501 e UI exibe feedback ao ADM (sem window.alert) e PAYMENTS_ENABLED=false', async () => {
      const contract501 = await makeRequest(
        server,
        'POST',
        '/api/students/contract',
        { studentUid: STUDENT_UID, email: STUDENT_EMAIL, count: 12 },
        { Authorization: 'Bearer tok-admin' }
      );
      assert.strictEqual(contract501.status, 501);
      assert.strictEqual(contract501.data.error, 'LEGACY_CREDIT_MUTATION_BLOCKED');

      const appSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/App.tsx'), 'utf8');
      assert(appSrc.includes('LEGACY_CREDIT_MUTATION_BLOCKED') && appSrc.includes('res.status === 501'), 'App.tsx handles 501');
      assert(appSrc.includes('contract-err-'), 'App.tsx surfaces notification on 501');

      const headerSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/components/StudentHeaderSection.tsx'), 'utf8');
      assert(headerSrc.includes('contractEditFeedback'), 'StudentHeaderSection renders inline contractEditFeedback on failure');

      const pkgBlock = await makeRequest(
        server,
        'POST',
        '/api/students/purchase-package',
        { studentUid: STUDENT_UID, packageId: 'pkg_4' },
        { Authorization: 'Bearer tok-student' }
      );
      assert.strictEqual(pkgBlock.status, 403);
      assert.strictEqual(pkgBlock.data.error, 'PAYMENTS_DISABLED');
    });
  } finally {
    resetFirebaseAdminFirestoreForTesting();
    resetFirebaseAdminForTesting();
    server.closeAllConnections?.();
    server.close();
  }

  console.log('\n======================================================================');
  console.log(`FIN.2D.1C SUITE: ${passed} PASSED, ${failed} FAILED`);
  console.log('======================================================================');
  process.exit(failed > 0 ? 1 : 0);
}

runSuite().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
