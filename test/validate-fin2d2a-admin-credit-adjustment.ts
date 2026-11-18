/**
 * TEST SUITE: FIN.2D.2A — AJUSTE ADMINISTRATIVO DE CRÉDITOS
 * Behavioral HTTP + atomic Firestore (default) integration tests for manual ADM credit adjustments.
 * Uses strictly isolated in-memory Firestore (default) and Firebase Admin Auth mocks.
 */

process.env.NODE_ENV = 'test';
process.env.FIREBASE_PROJECT_ID = 'itissimple-security-staging';
process.env.FIREBASE_DATABASE_ID = '(default)';
process.env.PAYMENTS_ENABLED = 'false';

import assert from 'assert';
import crypto from 'crypto';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { app as serverApp, readDb, resetInMemoryDbForTesting } from '../serverApp';
import {
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
    _listCol: (col: string) => {
      const out: Array<{ id: string; data: Record<string, any> }> = [];
      for (const [k, v] of store.entries()) {
        if (k.startsWith(`${col}::`) && !k.slice(`${col}::`.length).includes('/')) {
          out.push({ id: k.slice(`${col}::`.length), data: JSON.parse(JSON.stringify(v)) });
        }
      }
      return out;
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
  console.log('FIN.2D.2A — AJUSTE ADMINISTRATIVO DE CRÉDITOS (TESTES COMPORTAMENTAIS)');
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

  const ADMIN_UID = 'Fin2d2aAdminCanonicalUid0001';
  const ADMIN_EMAIL = 'adm.itissimple@gmail.com';
  const TEACHER_UID = 'Fin2d2aApprovedTeacherUid002';
  const TEACHER_EMAIL = 'charles.fin2d2a@itissimple-test.com';
  const PENDING_TEACHER_UID = 'Fin2d2aPendingTeacherUid0003';
  const PENDING_TEACHER_EMAIL = 'pending.fin2d2a@itissimple-test.com';
  const STUDENT_UID = 'Fin2d2aStudentCanonicalUid04';
  const STUDENT_EMAIL = 'aluna.fin2d2a@itissimple-test.com';
  const TRIAL_STUDENT_UID = 'Fin2d2aTrialStudentUid000005';
  const TRIAL_STUDENT_EMAIL = 'trial.fin2d2a@itissimple-test.com';
  const DELETED_STUDENT_UID = 'Fin2d2aDeletedStudentUid0006';
  const DELETED_STUDENT_EMAIL = 'deleted.fin2d2a@itissimple-test.com';
  const UNREGISTERED_UID = 'Fin2d2aUnregisteredUid000007';
  const UNREGISTERED_EMAIL = 'unreg.fin2d2a@itissimple-test.com';

  // Seed Firestore (default)
  mockFs._setDoc('users', ADMIN_UID, {
    id: ADMIN_UID,
    uid: ADMIN_UID,
    email: ADMIN_EMAIL,
    name: 'Admin Principal',
    role: 'admin',
  });

  mockFs._setDoc('tutors', TEACHER_UID, {
    id: TEACHER_UID,
    uid: TEACHER_UID,
    authUid: TEACHER_UID,
    publicTutorId: 'charles-fin2d2a',
    email: TEACHER_EMAIL,
    name: 'Charles Native Friend',
    role: 'teacher',
    approvalStatus: 'approved',
    status: 'approved',
    isApproved: true,
    approved: true,
    adminCommissionPercent: 25,
    commissionModel: 'MARKUP',
    meetUrl: 'https://meet.google.com/charles-fin2d2a',
    availableDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
    availableHours: ['09:00', '10:00', '14:00', '15:00'],
  });
  mockFs._setDoc('users', TEACHER_UID, {
    id: TEACHER_UID,
    uid: TEACHER_UID,
    authUid: TEACHER_UID,
    email: TEACHER_EMAIL,
    name: 'Charles Native Friend',
    role: 'teacher',
    approvalStatus: 'approved',
    isApproved: true,
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

  mockFs._setDoc('users', STUDENT_UID, {
    id: STUDENT_UID,
    uid: STUDENT_UID,
    email: STUDENT_EMAIL,
    name: 'Aluna Fin2D2A',
    role: 'student',
    level: 'intermediario',
    learningGoal: 'Career Growth',
    teacherUid: TEACHER_UID,
    assignedNativeFriendUID: TEACHER_UID,
    nativeFriendUID: TEACHER_UID,
    teacherEmail: TEACHER_EMAIL,
    teacherName: 'Charles Native Friend',
    enrollmentStatus: 'active',
    contractedLessons: 4,
    availableLessons: 2,
    completedLessonsCount: 2,
    hasCompletedTrialLesson: true,
    weeklyNativeLessonsTarget: 2,
    weeklyStudyDays: ['monday', 'wednesday', 'friday'],
    weeklyStudyDaysTarget: 3,
    subscriptionType: 'package',
    onboardingCompleted: true,
  });
  mockFs._setDoc('student_assignments', STUDENT_UID, {
    studentUid: STUDENT_UID,
    teacherUid: TEACHER_UID,
    teacherAuthUid: TEACHER_UID,
    assignedNativeFriendUID: TEACHER_UID,
    nativeFriendUID: TEACHER_UID,
    teacherEmail: TEACHER_EMAIL,
    teacherName: 'Charles Native Friend',
  });

  // Zero-credit student who has not yet completed free trial
  mockFs._setDoc('users', TRIAL_STUDENT_UID, {
    id: TRIAL_STUDENT_UID,
    uid: TRIAL_STUDENT_UID,
    email: TRIAL_STUDENT_EMAIL,
    name: 'Aluna Trial Fin2D2A',
    role: 'student',
    level: 'iniciante',
    enrollmentStatus: 'active',
    contractedLessons: 0,
    availableLessons: 0,
    completedLessonsCount: 0,
    hasCompletedTrialLesson: false,
    weeklyNativeLessonsTarget: 1,
  });

  mockFs._setDoc('users', DELETED_STUDENT_UID, {
    id: DELETED_STUDENT_UID,
    uid: DELETED_STUDENT_UID,
    email: DELETED_STUDENT_EMAIL,
    name: 'Deleted Student',
    role: 'student',
    deleted: true,
    contractedLessons: 5,
    availableLessons: 5,
  });

  const TOKEN_MAP: Record<string, any> = {
    'tok-admin': { uid: ADMIN_UID, email: ADMIN_EMAIL, email_verified: true, role: 'admin', admin: true },
    'tok-teacher': { uid: TEACHER_UID, email: TEACHER_EMAIL, email_verified: true, role: 'teacher' },
    'tok-pending-teacher': { uid: PENDING_TEACHER_UID, email: PENDING_TEACHER_EMAIL, email_verified: true, role: 'teacher' },
    'tok-student': { uid: STUDENT_UID, email: STUDENT_EMAIL, email_verified: true, role: 'student' },
    'tok-trial-student': { uid: TRIAL_STUDENT_UID, email: TRIAL_STUDENT_EMAIL, email_verified: true, role: 'student' },
    'tok-unreg': { uid: UNREGISTERED_UID, email: UNREGISTERED_EMAIL, email_verified: true },
  };

  setFirebaseAdminAuthForTesting({
    verifyIdToken: async (token: string) => {
      if (TOKEN_MAP[token]) return TOKEN_MAP[token];
      throw new Error('Invalid test token');
    },
    getUser: async (uid: string) => {
      const entry = Object.values(TOKEN_MAP).find((u: any) => u.uid === uid);
      if (entry) return entry;
      const err: any = new Error('User not found');
      err.code = 'auth/user-not-found';
      throw err;
    },
    getUserByEmail: async (email: string) => {
      const entry = Object.values(TOKEN_MAP).find((u: any) => u.email === email);
      if (entry) return entry;
      const err: any = new Error('User not found');
      err.code = 'auth/user-not-found';
      throw err;
    },
  } as any);

  const server = http.createServer(serverApp);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    // -----------------------------------------------------------------------
    // 1. Permissions & RBAC
    // -----------------------------------------------------------------------
    await test('1. Permissões: exige token ADM válido (401 sem auth / inválido, 403 para student/teacher/pending/unregistered)', async () => {
      const payload = {
        studentUid: STUDENT_UID,
        delta: 2,
        reason: 'Tentativa sem permissão',
        idempotencyKey: 'perm-check-1',
      };

      const noAuth = await makeRequest(server, 'POST', '/api/admin/credits/adjust', payload);
      assert.strictEqual(noAuth.status, 401);

      const badAuth = await makeRequest(server, 'POST', '/api/admin/credits/adjust', payload, {
        Authorization: 'Bearer invalid-token-xyz',
      });
      assert.strictEqual(badAuth.status, 401);

      for (const tok of ['tok-student', 'tok-teacher', 'tok-pending-teacher', 'tok-unreg']) {
        const res = await makeRequest(server, 'POST', '/api/admin/credits/adjust', payload, {
          Authorization: `Bearer ${tok}`,
        });
        assert.strictEqual(res.status, 403, `Expected 403 for ${tok}, got ${res.status}`);
      }

      // Confirm zero mutations occurred
      assert.strictEqual(mockFs._getDoc('users', STUDENT_UID)?.availableLessons, 2);
      assert.strictEqual(mockFs._getDoc('users', STUDENT_UID)?.contractedLessons, 4);
      assert.strictEqual(mockFs._listCol('financial_transactions').length, 0);
    });

    // -----------------------------------------------------------------------
    // 2. Payload validation & canonical target rules
    // -----------------------------------------------------------------------
    await test('2. Validação: rejeita UID não-canônico, delta inválido/zero, motivo vazio, idempotencyKey ausente, alvo teacher/admin e aluno inexistente/deletado', async () => {
      // Non-canonical / email / missing UID
      for (const badUid of ['', 'st-12345', 'usr-99999', STUDENT_EMAIL, 'bad uid/slash']) {
        const res = await makeRequest(
          server,
          'POST',
          '/api/admin/credits/adjust',
          { studentUid: badUid, delta: 1, reason: 'Valid reason', idempotencyKey: `val-uid-${badUid}` },
          { Authorization: 'Bearer tok-admin' }
        );
        assert.strictEqual(res.status, 400, `Expected 400 for studentUid="${badUid}", got ${res.status}`);
        assert.strictEqual(res.data.error, 'CANONICAL_UID_REQUIRED');
      }

      // Invalid delta: 0, float, string, null
      for (const badDelta of [0, 1.5, -2.3, '2', null]) {
        const res = await makeRequest(
          server,
          'POST',
          '/api/admin/credits/adjust',
          { studentUid: STUDENT_UID, delta: badDelta, reason: 'Valid reason', idempotencyKey: 'val-delta' },
          { Authorization: 'Bearer tok-admin' }
        );
        assert.strictEqual(res.status, 400, `Expected 400 for delta=${JSON.stringify(badDelta)}, got ${res.status}`);
        assert.strictEqual(res.data.error, 'INVALID_DELTA');
      }

      // Missing / blank reason
      for (const badReason of ['', '   ', undefined]) {
        const res = await makeRequest(
          server,
          'POST',
          '/api/admin/credits/adjust',
          { studentUid: STUDENT_UID, delta: 1, reason: badReason, idempotencyKey: 'val-reason' },
          { Authorization: 'Bearer tok-admin' }
        );
        assert.strictEqual(res.status, 400);
        assert.strictEqual(res.data.error, 'REASON_REQUIRED');
      }

      // Missing / blank idempotencyKey
      for (const badKey of ['', '   ', undefined]) {
        const res = await makeRequest(
          server,
          'POST',
          '/api/admin/credits/adjust',
          { studentUid: STUDENT_UID, delta: 1, reason: 'Valid reason', idempotencyKey: badKey },
          { Authorization: 'Bearer tok-admin' }
        );
        assert.strictEqual(res.status, 400);
        assert.strictEqual(res.data.error, 'IDEMPOTENCY_KEY_REQUIRED');
      }

      // Target is teacher or admin
      for (const nonStudentUid of [TEACHER_UID, ADMIN_UID]) {
        const res = await makeRequest(
          server,
          'POST',
          '/api/admin/credits/adjust',
          { studentUid: nonStudentUid, delta: 1, reason: 'Wrong role', idempotencyKey: `val-role-${nonStudentUid}` },
          { Authorization: 'Bearer tok-admin' }
        );
        assert.strictEqual(res.status, 400);
        assert.strictEqual(res.data.error, 'INVALID_TARGET_ROLE');
      }

      // Non-existent or deleted student -> 404
      for (const missingUid of [UNREGISTERED_UID, DELETED_STUDENT_UID]) {
        const res = await makeRequest(
          server,
          'POST',
          '/api/admin/credits/adjust',
          { studentUid: missingUid, delta: 1, reason: 'Missing user', idempotencyKey: `val-404-${missingUid}` },
          { Authorization: 'Bearer tok-admin' }
        );
        assert.strictEqual(res.status, 404);
        assert.strictEqual(res.data.error, 'STUDENT_NOT_FOUND');
      }

      assert.strictEqual(mockFs._listCol('financial_transactions').length, 0);
    });

    // -----------------------------------------------------------------------
    // 3. Increment (+delta) & Zero-Revenue Ledger + Preservation
    // -----------------------------------------------------------------------
    await test('3. Incremento (+3): atualiza Firestore atomicamente, grava ADMIN_CREDIT_ADJUSTMENT sem receita e preserva vínculos/trial/target', async () => {
      const idempKey = 'adm-inc-test-001';
      const res = await makeRequest(
        server,
        'POST',
        '/api/admin/credits/adjust',
        {
          studentUid: STUDENT_UID,
          delta: 3,
          reason: 'Bônus de cortesia por reagendamento técnico',
          idempotencyKey: idempKey,
        },
        { Authorization: 'Bearer tok-admin' }
      );

      assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.data)}`);
      assert.strictEqual(res.data.success, true);
      assert.strictEqual(res.data.isIdempotent, false);
      assert.strictEqual(res.data.previousAvailableLessons, 2);
      assert.strictEqual(res.data.availableLessons, 5);
      assert.strictEqual(res.data.previousContractedLessons, 4);
      assert.strictEqual(res.data.contractedLessons, 7);

      const userDoc = mockFs._getDoc('users', STUDENT_UID);
      assert.strictEqual(userDoc?.availableLessons, 5);
      assert.strictEqual(userDoc?.contractedLessons, 7);
      // Mandatory preservations
      assert.strictEqual(userDoc?.uid, STUDENT_UID);
      assert.strictEqual(userDoc?.role, 'student');
      assert.strictEqual(userDoc?.teacherUid, TEACHER_UID);
      assert.strictEqual(userDoc?.teacherEmail, TEACHER_EMAIL);
      assert.strictEqual(userDoc?.hasCompletedTrialLesson, true);
      assert.strictEqual(userDoc?.weeklyNativeLessonsTarget, 2);
      assert.strictEqual(userDoc?.learningGoal, 'Career Growth');

      // Ledger entry in financial_transactions with zero revenue
      const expectedTxId = `admin_adj_${crypto.createHash('sha256').update(idempKey).digest('hex').slice(0, 32)}`;
      const txDoc = mockFs._getDoc('financial_transactions', expectedTxId);
      assert(txDoc, 'Expected financial_transactions document to exist');
      assert.strictEqual(txDoc.type, 'ADMIN_CREDIT_ADJUSTMENT');
      assert.strictEqual(txDoc.studentUid, STUDENT_UID);
      assert.strictEqual(txDoc.delta, 3);
      assert.strictEqual(txDoc.reason, 'Bônus de cortesia por reagendamento técnico');
      assert.strictEqual(txDoc.beforeAvailableLessons, 2);
      assert.strictEqual(txDoc.afterAvailableLessons, 5);
      assert.strictEqual(txDoc.beforeContractedLessons, 4);
      assert.strictEqual(txDoc.afterContractedLessons, 7);
      assert.strictEqual(txDoc.performedByUid, ADMIN_UID);
      assert.strictEqual(txDoc.performedByRole, 'admin');
      assert.strictEqual(txDoc.countsAsRevenue, false);
      assert.strictEqual(txDoc.revenueBrl, 0);
      assert.strictEqual(txDoc.revenueUsd, 0);
      assert.strictEqual(txDoc.amountBrl, 0);
      assert.strictEqual(txDoc.amountUsd, 0);

      // Must NOT pollute package purchase revenue db.transactions
      assert.strictEqual(readDb().transactions.length, 0);
    });

    // -----------------------------------------------------------------------
    // 4. Decrement (-delta) & Negative Balance Prevention
    // -----------------------------------------------------------------------
    await test('4. Decremento (-2 válido e -10 inválido): permite decremento seguro e impede saldo disponível negativo', async () => {
      // Valid decrement: 5 -> 3 available, 7 -> 5 contracted
      const decOk = await makeRequest(
        server,
        'POST',
        '/api/admin/credits/adjust',
        {
          studentUid: STUDENT_UID,
          delta: -2,
          reason: 'Correção de lançamento duplicado em teste',
          idempotencyKey: 'adm-dec-test-002',
        },
        { Authorization: 'Bearer tok-admin' }
      );
      assert.strictEqual(decOk.status, 200);
      assert.strictEqual(decOk.data.previousAvailableLessons, 5);
      assert.strictEqual(decOk.data.availableLessons, 3);
      assert.strictEqual(decOk.data.previousContractedLessons, 7);
      assert.strictEqual(decOk.data.contractedLessons, 5);
      assert.strictEqual(mockFs._getDoc('users', STUDENT_UID)?.availableLessons, 3);
      assert.strictEqual(mockFs._getDoc('users', STUDENT_UID)?.contractedLessons, 5);

      const txCountBefore = mockFs._listCol('financial_transactions').length;
      assert.strictEqual(txCountBefore, 2);

      // Excessive decrement (-4 when available=3 -> would be -1)
      const decFail = await makeRequest(
        server,
        'POST',
        '/api/admin/credits/adjust',
        {
          studentUid: STUDENT_UID,
          delta: -4,
          reason: 'Tentativa negativa',
          idempotencyKey: 'adm-dec-fail-neg',
        },
        { Authorization: 'Bearer tok-admin' }
      );
      assert.strictEqual(decFail.status, 400);
      assert.strictEqual(decFail.data.error, 'NEGATIVE_AVAILABLE_BALANCE');

      // Nothing modified on rejection
      assert.strictEqual(mockFs._getDoc('users', STUDENT_UID)?.availableLessons, 3);
      assert.strictEqual(mockFs._getDoc('users', STUDENT_UID)?.contractedLessons, 5);
      assert.strictEqual(mockFs._listCol('financial_transactions').length, txCountBefore);
    });

    // -----------------------------------------------------------------------
    // 5. Idempotency Replay & Conflict (409)
    // -----------------------------------------------------------------------
    await test('5. Idempotência: repetição com mesma idempotencyKey não reaplica delta; reutilização para outro delta/aluno retorna 409', async () => {
      const replayRes = await makeRequest(
        server,
        'POST',
        '/api/admin/credits/adjust',
        {
          studentUid: STUDENT_UID,
          delta: -2,
          reason: 'Correção de lançamento duplicado em teste',
          idempotencyKey: 'adm-dec-test-002',
        },
        { Authorization: 'Bearer tok-admin' }
      );
      assert.strictEqual(replayRes.status, 200);
      assert.strictEqual(replayRes.data.isIdempotent, true);
      assert.strictEqual(replayRes.data.availableLessons, 3);
      assert.strictEqual(replayRes.data.contractedLessons, 5);
      assert.strictEqual(mockFs._getDoc('users', STUDENT_UID)?.availableLessons, 3);
      assert.strictEqual(mockFs._listCol('financial_transactions').length, 2);

      // Conflict: same key with different delta
      const conflictDelta = await makeRequest(
        server,
        'POST',
        '/api/admin/credits/adjust',
        {
          studentUid: STUDENT_UID,
          delta: 1,
          reason: 'Conflito de chave',
          idempotencyKey: 'adm-dec-test-002',
        },
        { Authorization: 'Bearer tok-admin' }
      );
      assert.strictEqual(conflictDelta.status, 409);
      assert.strictEqual(conflictDelta.data.error, 'IDEMPOTENCY_KEY_CONFLICT');

      // Conflict: same key with different studentUid
      const conflictUid = await makeRequest(
        server,
        'POST',
        '/api/admin/credits/adjust',
        {
          studentUid: TRIAL_STUDENT_UID,
          delta: -2,
          reason: 'Conflito de aluno',
          idempotencyKey: 'adm-dec-test-002',
        },
        { Authorization: 'Bearer tok-admin' }
      );
      assert.strictEqual(conflictUid.status, 409);
      assert.strictEqual(conflictUid.data.error, 'IDEMPOTENCY_KEY_CONFLICT');
    });

    // -----------------------------------------------------------------------
    // 6. Persistence after Cold Restart
    // -----------------------------------------------------------------------
    await test('6. Persistência após reinício: resetInMemoryDbForTesting preserva saldos ajustados em GET /api/user-profile, /api/students e /api/contracted-lessons', async () => {
      resetInMemoryDbForTesting();

      const profileRes = await makeRequest(server, 'GET', `/api/user-profile?uid=${STUDENT_UID}`, undefined, {
        Authorization: 'Bearer tok-student',
      });
      assert.strictEqual(profileRes.status, 200);
      assert.strictEqual(profileRes.data.profile?.availableLessons, 3);
      assert.strictEqual(profileRes.data.profile?.contractedLessons, 5);
      assert.strictEqual(profileRes.data.profile?.weeklyNativeLessonsTarget, 2);
      assert.strictEqual(profileRes.data.profile?.teacherUid, TEACHER_UID);

      const studentsRes = await makeRequest(server, 'GET', '/api/students', undefined, {
        Authorization: 'Bearer tok-admin',
      });
      assert.strictEqual(studentsRes.status, 200);
      const stu = (studentsRes.data || []).find((s: any) => s.uid === STUDENT_UID);
      assert(stu, 'Student should be returned by GET /api/students after restart');
      assert.strictEqual(stu.availableLessons, 3);
      assert.strictEqual(stu.contractedLessons, 5);

      const contractedMapRes = await makeRequest(server, 'GET', '/api/contracted-lessons', undefined, {
        Authorization: 'Bearer tok-admin',
      });
      assert.strictEqual(contractedMapRes.status, 200);
      assert.strictEqual(contractedMapRes.data[STUDENT_EMAIL], 5);
    });

    // -----------------------------------------------------------------------
    // 7. Regressions: Legacy 501, PAYMENTS_ENABLED=false, Trial, Scheduling, Refund
    // -----------------------------------------------------------------------
    await test('7. Regressões: rotas legadas seguem 501, PAYMENTS_ENABLED=false, trial gratuita 0 créditos e agendamento/estorno usam saldo ajustado', async () => {
      // Legacy routes must stay blocked with 501
      for (const legacyRoute of ['/api/students/contract', '/api/contracted-lessons']) {
        const leg = await makeRequest(
          server,
          'POST',
          legacyRoute,
          { studentUid: STUDENT_UID, email: STUDENT_EMAIL, count: 99 },
          { Authorization: 'Bearer tok-admin' }
        );
        assert.strictEqual(leg.status, 501, `Expected 501 on ${legacyRoute}, got ${leg.status}`);
        assert.strictEqual(leg.data.error, 'LEGACY_CREDIT_MUTATION_BLOCKED');
      }

      // PAYMENTS_ENABLED=false still blocks purchase-package
      const pkg = await makeRequest(
        server,
        'POST',
        '/api/students/purchase-package',
        { studentUid: TRIAL_STUDENT_UID, teacherUid: TEACHER_UID, packageLessons: 4 },
        { Authorization: 'Bearer tok-trial-student' }
      );
      assert.strictEqual(pkg.status, 403);
      assert.strictEqual(pkg.data.error, 'PAYMENTS_DISABLED');

      // Trial 25-min at 0 credits still works
      const trialRes = await makeRequest(
        server,
        'POST',
        '/api/lessons/schedule',
        {
          studentUid: TRIAL_STUDENT_UID,
          studentEmail: TRIAL_STUDENT_EMAIL,
          studentName: 'Aluna Trial Fin2D2A',
          teacherId: TEACHER_UID,
          teacherUid: TEACHER_UID,
          startDateTime: '2026-12-10T14:00:00Z',
          endDateTime: '2026-12-10T14:25:00Z',
          title: 'Aula Experimental Ao Vivo (25 min)',
          isTrialLesson: true,
        },
        { Authorization: 'Bearer tok-trial-student' }
      );
      assert.strictEqual(trialRes.status, 200, `Trial failed: ${JSON.stringify(trialRes.data)}`);
      assert.strictEqual(trialRes.data.isTrialLesson, true);
      assert.strictEqual(mockFs._getDoc('users', TRIAL_STUDENT_UID)?.hasCompletedTrialLesson, true);

      // Regular 50-min scheduling debits adjusted availableLessons (3 -> 2)
      const schedRes = await makeRequest(
        server,
        'POST',
        '/api/lessons/schedule',
        {
          studentUid: STUDENT_UID,
          studentEmail: STUDENT_EMAIL,
          studentName: 'Aluna Fin2D2A',
          teacherId: TEACHER_UID,
          teacherUid: TEACHER_UID,
          startDateTime: '2026-12-11T14:00:00Z',
          endDateTime: '2026-12-11T14:50:00Z',
          title: 'Regular Lesson',
          isTrialLesson: false,
        },
        { Authorization: 'Bearer tok-student' }
      );
      assert.strictEqual(schedRes.status, 200, `Schedule failed: ${JSON.stringify(schedRes.data)}`);
      assert.strictEqual(schedRes.data.remainingLessons, 2);
      assert.strictEqual(mockFs._getDoc('users', STUDENT_UID)?.availableLessons, 2);

      // Teacher cancel refunds +1 credit (2 -> 3) without altering ADMIN_CREDIT_ADJUSTMENT ledger
      const lessonId = schedRes.data.id || schedRes.data.lesson?.id;
      assert(lessonId, 'Scheduled lesson ID must exist');
      const cancelRes = await makeRequest(
        server,
        'POST',
        `/api/lessons/${encodeURIComponent(lessonId)}/cancel`,
        { cancelledBy: 'teacher', reason: 'Teacher reschedule' },
        { Authorization: 'Bearer tok-teacher' }
      );
      assert.strictEqual(cancelRes.status, 200, `Cancel failed: ${JSON.stringify(cancelRes.data)}`);
      assert.strictEqual(cancelRes.data.creditRefunded, true);
      assert.strictEqual(cancelRes.data.remainingLessons, 3);
      assert.strictEqual(mockFs._getDoc('users', STUDENT_UID)?.availableLessons, 3);

      // Admin decrements student balance to 0 (-3), then student cannot book regular lesson (402)
      const zeroOut = await makeRequest(
        server,
        'POST',
        '/api/admin/credits/adjust',
        {
          studentUid: STUDENT_UID,
          delta: -3,
          reason: 'Zerar saldo de teste',
          idempotencyKey: 'adm-zero-out-003',
        },
        { Authorization: 'Bearer tok-admin' }
      );
      assert.strictEqual(zeroOut.status, 200);
      assert.strictEqual(zeroOut.data.availableLessons, 0);

      const blockedSched = await makeRequest(
        server,
        'POST',
        '/api/lessons/schedule',
        {
          studentUid: STUDENT_UID,
          studentEmail: STUDENT_EMAIL,
          studentName: 'Aluna Fin2D2A',
          teacherId: TEACHER_UID,
          teacherUid: TEACHER_UID,
          startDateTime: '2026-12-12T14:00:00Z',
          endDateTime: '2026-12-12T14:50:00Z',
          title: 'Regular Lesson Blocked',
          isTrialLesson: false,
        },
        { Authorization: 'Bearer tok-student' }
      );
      assert.strictEqual(blockedSched.status, 402);
      assert.strictEqual(mockFs._listCol('financial_transactions').length, 3);
    });

    // -----------------------------------------------------------------------
    // 8. Frontend UI Wiring ("Editar Total", double-submit lock, feedback)
    // -----------------------------------------------------------------------
    await test('8. UI "Editar Total": usa /api/admin/credits/adjust, exige motivo, protege duplo envio e exibe confirmação (sem window.alert)', () => {
      const appSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/App.tsx'), 'utf8');
      const headerSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/components/StudentHeaderSection.tsx'), 'utf8');

      assert(appSrc.includes("fetch('/api/admin/credits/adjust'"), 'App.tsx must call /api/admin/credits/adjust');
      assert(appSrc.includes('adminCreditSubmittingRef'), 'App.tsx must guard against double submit');
      assert(appSrc.includes('adminCreditFeedback'), 'App.tsx must display inline confirmation/error feedback');
      assert(appSrc.includes('admin-credit-adjustment-bar'), 'App.tsx must expose Editar Total in admin filtered workspace');
      assert(headerSrc.includes('isSubmittingContractRef'), 'StudentHeaderSection must guard against double submit');
      assert(headerSrc.includes('pendingIdempotencyKeyRef'), 'StudentHeaderSection must track idempotencyKey per attempt');
      assert(headerSrc.includes('contractReason'), 'StudentHeaderSection must require adjustment reason');
      assert(headerSrc.includes('contractEditFeedback'), 'StudentHeaderSection must display inline feedback');
      assert(!appSrc.includes('window.alert') && !headerSrc.includes('window.alert'), 'Must not use window.alert');
    });
  } finally {
    resetFirebaseAdminFirestoreForTesting();
    resetFirebaseAdminForTesting();
    server.closeAllConnections?.();
    server.close();
  }

  console.log('\n======================================================================');
  console.log(`RESULTADO FIN.2D.2A: ${passed} PASSOU | ${failed} FALHOU`);
  console.log('======================================================================\n');
  if (failed > 0) process.exit(1);
  process.exit(0);
}

runSuite().catch((err) => {
  console.error('Fatal error in FIN.2D.2A suite:', err);
  process.exit(1);
});
