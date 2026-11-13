/**
 * TEST SUITE: IT'S SIMPLE — ARCH.2C
 * Consolidação de Contratação, Créditos e Transações no Firestore (default)
 *
 * Validações obrigatórias:
 * 1. Contratação persiste corretamente no Firestore (users/{uid}, student_assignments/{uid}, financial_transactions/{txId}).
 * 2. Saldo permanece consistente após reinicialização simulada do servidor (limpeza de inMemoryDb).
 * 3. Operações repetidas (idempotência) não duplicam créditos nem transações.
 * 4. Professor e aluno não conseguem alterar saldos indevidamente (RBAC + bloqueio de spoofing de UID/preço).
 * 5. Fluxos administrativos autorizados permanecem funcionais.
 * 6. Nenhuma regressão nas regras comerciais existentes (pacotes 1/4/8/12, USD base, comissão ADM, PTAX D-1, descontos 0/5/10/15%, rateio proporcional, trial, vínculo Native Friend).
 */

process.env.NODE_ENV = 'test';
process.env.FIREBASE_PROJECT_ID = 'itissimple-security-staging';
process.env.FIREBASE_DATABASE_ID = '(default)';

import assert from 'assert';
import http from 'http';
import { app as serverApp, readDb } from '../serverApp';
import {
  setFirebaseAdminFirestoreForTesting,
  resetFirebaseAdminFirestoreForTesting,
} from '../src/serverFirestore';
import { setFirebaseAdminAuthForTesting } from '../src/serverFirebaseAdmin';
import {
  clearPtaxMemoryCache,
  getExpectedReferenceDate,
  getSaoPauloDateString,
  PTAX_CACHE_COLLECTION,
} from '../src/serverPtax';
import { calculateFinancialPricingQuote } from '../src/utils/financialEngine';

function createTransactionMockFirestore() {
  const store = new Map<string, Record<string, any>>();

  const matchFilters = (data: Record<string, any>, filters: Array<{ field: string; op: string; val: any }>) => {
    return filters.every((f) => {
      const val = data[f.field];
      if (f.op === '==') return val === f.val;
      return false;
    });
  };

  const makeDocRef = (col: string, id: string): any => ({
    _col: col,
    _id: id,
    id,
    path: `${col}/${id}`,
    get: async () => {
      const val = store.get(`${col}::${id}`);
      return {
        id,
        exists: Boolean(val),
        ref: makeDocRef(col, id),
        data: () => (val ? JSON.parse(JSON.stringify(val)) : undefined),
      };
    },
    set: async (data: Record<string, any>, opts?: { merge?: boolean }) => {
      const key = `${col}::${id}`;
      const prev = opts?.merge ? (store.get(key) || {}) : {};
      store.set(key, JSON.parse(JSON.stringify({ ...prev, ...data })));
      return { writeTime: new Date() };
    },
    delete: async () => {
      store.delete(`${col}::${id}`);
      return { writeTime: new Date() };
    },
  });

  const makeQuery = (col: string, filters: Array<{ field: string; op: string; val: any }> = [], maxLimit?: number): any => ({
    where: (field: string, op: string, val: any) => makeQuery(col, [...filters, { field, op, val }], maxLimit),
    limit: (n: number) => makeQuery(col, filters, n),
    get: async () => {
      const docs: any[] = [];
      for (const [k, v] of store.entries()) {
        if (!k.startsWith(`${col}::`)) continue;
        const docId = k.slice(`${col}::`.length);
        if (matchFilters(v, filters)) {
          docs.push({
            id: docId,
            exists: true,
            ref: makeDocRef(col, docId),
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
  });

  const dbMock: any = {
    collection: (col: string) => ({
      doc: (id: string) => makeDocRef(col, id),
      where: (field: string, op: string, val: any) => makeQuery(col, [{ field, op, val }]),
      limit: (n: number) => makeQuery(col, [], n),
      get: async () => makeQuery(col).get(),
    }),
    runTransaction: async (fn: (tx: any) => Promise<any>) => {
      // Buffer writes and commit atomically on success (simulates real Firestore transaction isolation)
      const stagedWrites: Array<{ key: string; data: Record<string, any>; merge: boolean }> = [];
      const tx = {
        get: async (ref: any) => ref.get(),
        set: (ref: any, data: Record<string, any>, opts?: { merge?: boolean }) => {
          stagedWrites.push({
            key: `${ref._col}::${ref._id}`,
            data: JSON.parse(JSON.stringify(data)),
            merge: Boolean(opts?.merge),
          });
        },
        update: (ref: any, data: Record<string, any>) => {
          stagedWrites.push({
            key: `${ref._col}::${ref._id}`,
            data: JSON.parse(JSON.stringify(data)),
            merge: true,
          });
        },
      };
      const result = await fn(tx);
      for (const w of stagedWrites) {
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
        if (k.startsWith(`${col}::`)) {
          out.push({ id: k.slice(`${col}::`.length), data: JSON.parse(JSON.stringify(v)) });
        }
      }
      return out;
    },
  };

  return dbMock;
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
  console.log('ARCH.2C — CONSOLIDAÇÃO DE CONTRATAÇÃO, CRÉDITOS E TRANSAÇÕES');
  console.log('======================================================================\n');

  let passed = 0;
  let failed = 0;

  async function test(name: string, fn: () => void | Promise<void>) {
    try {
      await fn();
      console.log(`  ✅ PASS: ${name}`);
      passed++;
    } catch (err: any) {
      console.error(`  ❌ FAIL: ${name} -> ${err?.message || err}`);
      failed++;
    }
  }

  const mockFs = createTransactionMockFirestore();
  setFirebaseAdminFirestoreForTesting(mockFs as any);
  clearPtaxMemoryCache();

  // Canonical UIDs (28 chars alphanumeric)
  const ADMIN_UID = 'Adm1nCanonicalUid2026Arch2C1';
  const ADMIN_EMAIL = 'adm.itissimple@gmail.com';
  const STUDENT_A_UID = 'StuACanonicalUid2026Arch2C11';
  const STUDENT_A_EMAIL = 'aluno.a.arch2c@itissimple.com';
  const STUDENT_B_UID = 'StuBCanonicalUid2026Arch2C22';
  const STUDENT_B_EMAIL = 'aluno.b.arch2c@itissimple.com';
  const TEACHER_1_UID = 'Tch1CanonicalUid2026Arch2C33';
  const TEACHER_1_EMAIL = 'charles.arch2c@itissimple.com';
  const TEACHER_2_UID = 'Tch2CanonicalUid2026Arch2C44';
  const TEACHER_2_EMAIL = 'other.teacher@itissimple.com';

  // Seed Firestore (default) users, tutors, and PTAX D-1 cache
  mockFs._setDoc('users', ADMIN_UID, {
    uid: ADMIN_UID,
    id: ADMIN_UID,
    email: ADMIN_EMAIL,
    name: 'Admin User',
    role: 'admin',
  });
  mockFs._setDoc('users', STUDENT_A_UID, {
    uid: STUDENT_A_UID,
    id: STUDENT_A_UID,
    email: STUDENT_A_EMAIL,
    name: 'Aluno A',
    role: 'student',
    contractedLessons: 0,
    availableLessons: 0,
    completedLessonsCount: 0,
    hasCompletedTrialLesson: false,
    enrollmentStatus: 'not_enrolled',
  });
  mockFs._setDoc('users', STUDENT_B_UID, {
    uid: STUDENT_B_UID,
    id: STUDENT_B_UID,
    email: STUDENT_B_EMAIL,
    name: 'Aluno B',
    role: 'student',
    contractedLessons: 4,
    availableLessons: 3,
    completedLessonsCount: 1,
    hasCompletedTrialLesson: true,
    teacherUid: TEACHER_2_UID,
    assignedNativeFriendUID: TEACHER_2_UID,
    enrollmentStatus: 'active',
  });
  mockFs._setDoc('users', TEACHER_1_UID, {
    uid: TEACHER_1_UID,
    id: TEACHER_1_UID,
    email: TEACHER_1_EMAIL,
    name: 'Charles Lambert',
    role: 'teacher',
    isApproved: true,
    approvalStatus: 'approved',
    publicTutorId: 'charles-lambert-2c',
    pricePerSessionUsd: 20,
    adminCommissionPercent: 25,
    commissionModel: 'MARKUP',
  });
  mockFs._setDoc('tutors', TEACHER_1_UID, {
    uid: TEACHER_1_UID,
    id: TEACHER_1_UID,
    email: TEACHER_1_EMAIL,
    name: 'Charles Lambert',
    isApproved: true,
    approvalStatus: 'approved',
    publicTutorId: 'charles-lambert-2c',
    pricePerSessionUsd: 20,
    adminCommissionPercent: 25,
    commissionModel: 'MARKUP',
  });
  mockFs._setDoc('users', TEACHER_2_UID, {
    uid: TEACHER_2_UID,
    id: TEACHER_2_UID,
    email: TEACHER_2_EMAIL,
    name: 'Outro Professor',
    role: 'teacher',
    isApproved: true,
    approvalStatus: 'approved',
    pricePerSessionUsd: 18,
    adminCommissionPercent: 20,
  });

  // Seed official PTAX D-1 rate in Firestore cache so no external BACEN HTTP request is needed
  const todaySp = getSaoPauloDateString();
  const ptaxRefDate = getExpectedReferenceDate(todaySp);
  const PTAX_RATE = 5.6;
  mockFs._setDoc(PTAX_CACHE_COLLECTION, ptaxRefDate, {
    quoteDate: ptaxRefDate,
    cotacaoVenda: PTAX_RATE,
    cotacaoCompra: 5.599,
    dataHoraCotacao: `${ptaxRefDate} 13:05:00.000`,
    tipoBoletim: 'Fechamento',
    source: 'Banco Central do Brasil - API PTAX Olinda',
    queriedAt: new Date().toISOString(),
  });

  setFirebaseAdminAuthForTesting({
    verifyIdToken: async (token: string) => {
      if (token === 'admin-token') {
        return { uid: ADMIN_UID, email: ADMIN_EMAIL, email_verified: true, role: 'admin' };
      }
      if (token === 'student-a-token') {
        return { uid: STUDENT_A_UID, email: STUDENT_A_EMAIL, email_verified: true, role: 'student' };
      }
      if (token === 'student-b-token') {
        return { uid: STUDENT_B_UID, email: STUDENT_B_EMAIL, email_verified: true, role: 'student' };
      }
      if (token === 'teacher-1-token') {
        return { uid: TEACHER_1_UID, email: TEACHER_1_EMAIL, email_verified: true, role: 'teacher' };
      }
      throw new Error('Invalid token');
    },
  } as any);

  const server = http.createServer(serverApp);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));

  try {
    // -------------------------------------------------------------------------
    // 1. Contratação persiste corretamente no Firestore + cálculo comercial server-side
    // -------------------------------------------------------------------------
    await test('1a. Contratação de pacote persiste no Firestore (users, student_assignments, financial_transactions) ignorando valores do cliente', async () => {
      const res = await makeRequest(
        server,
        'POST',
        '/api/students/purchase-package',
        {
          studentEmail: STUDENT_A_EMAIL, // Admin targeting student by email without studentUid
          teacherId: 'charles-lambert-2c',
          packageLessons: 8,
          // Client attempts to spoof prices/discounts — must be completely ignored!
          packagePriceBrl: 1,
          packagePriceUsd: 0.01,
          discountPercent: 99,
          idempotencyKey: 'arch2c-order-8-001',
        },
        { Authorization: 'Bearer admin-token' }
      );

      assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.data)}`);
      assert.strictEqual(res.data.success, true);
      assert.strictEqual(res.data.contractedLessons, 8);
      assert.strictEqual(res.data.availableLessons, 8);
      assert.strictEqual(res.data.teacherUid, TEACHER_1_UID);

      const userDoc = mockFs._getDoc('users', STUDENT_A_UID);
      assert.ok(userDoc, 'users/{uid} must exist');
      assert.strictEqual(userDoc!.contractedLessons, 8);
      assert.strictEqual(userDoc!.availableLessons, 8);
      assert.strictEqual(userDoc!.teacherUid, TEACHER_1_UID);
      assert.strictEqual(userDoc!.assignedNativeFriendUID, TEACHER_1_UID);
      assert.strictEqual(userDoc!.enrollmentStatus, 'active');
      assert.strictEqual(userDoc!.hasCompletedTrialLesson, false, 'Trial status must remain untouched');

      const assignDoc = mockFs._getDoc('student_assignments', STUDENT_A_UID);
      assert.ok(assignDoc, 'student_assignments/{uid} must be persisted');
      assert.strictEqual(assignDoc!.teacherUid, TEACHER_1_UID);

      const txs = mockFs._listCol('financial_transactions');
      assert.strictEqual(txs.length, 1, 'Exactly 1 financial transaction must be recorded');
      const tx = txs[0].data;

      // Expected commercial calculation from financialEngine ($20 base, 25% markup -> $25/lesson, 8 lessons 10% off, PTAX 5.60)
      const expectedQuote = calculateFinancialPricingQuote({
        basePriceUsd: 20,
        adminCommissionPercent: 25,
        ptaxRate: PTAX_RATE,
        commissionModel: 'MARKUP',
      });
      const expectedPkg8 = expectedQuote.packages.package8;

      assert.strictEqual(tx.packagePriceUsd, expectedPkg8.finalPriceUsd);
      assert.strictEqual(tx.packagePriceBrl, expectedPkg8.finalPriceBrl);
      assert.strictEqual(tx.discountPercent, 10);
      assert.strictEqual(tx.teacherShareBrl, expectedPkg8.teacherShareBrl);
      assert.strictEqual(tx.platformRevenueBrl, expectedPkg8.platformRevenueBrl);
      assert.strictEqual(tx.ptaxRate, PTAX_RATE);
      assert.strictEqual(tx.basePriceUsd, 20);
      assert.strictEqual(tx.adminCommissionPercent, 25);
    });

    await test('1b. Pacotes fora das opções comerciais aprovadas (1, 4, 8, 12) são rejeitados com 400', async () => {
      const res = await makeRequest(
        server,
        'POST',
        '/api/students/purchase-package',
        {
          studentUid: STUDENT_A_UID,
          teacherUid: TEACHER_1_UID,
          packageLessons: 5,
        },
        { Authorization: 'Bearer admin-token' }
      );
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.data.error, 'INVALID_PACKAGE');
    });

    // -------------------------------------------------------------------------
    // 2. Saldo permanece consistente após reinicialização simulada do servidor
    // -------------------------------------------------------------------------
    await test('2. Saldo e vínculo permanecem consistentes após reinicialização simulada (limpeza total do inMemoryDb)', async () => {
      // Wipe inMemoryDb completely to simulate server process restart
      const memDb = readDb();
      memDb.students = [];
      memDb.contractedLessons = {};
      memDb.userProfiles = {};
      memDb.transactions = [];

      // Query GET /api/contracted-lessons as student A
      const resStudent = await makeRequest(server, 'GET', '/api/contracted-lessons', undefined, {
        Authorization: 'Bearer student-a-token',
      });
      assert.strictEqual(resStudent.status, 200);
      assert.strictEqual(resStudent.data[STUDENT_A_EMAIL], 8, 'Student A must still see 8 from Firestore');
      assert.strictEqual(resStudent.data[STUDENT_B_EMAIL], undefined, 'Student A must NOT see Student B');

      // Query GET /api/contracted-lessons as teacher 1 (linked to A, not linked to B)
      const resTeacher = await makeRequest(server, 'GET', '/api/contracted-lessons', undefined, {
        Authorization: 'Bearer teacher-1-token',
      });
      assert.strictEqual(resTeacher.status, 200);
      assert.strictEqual(resTeacher.data[STUDENT_A_EMAIL], 8, 'Teacher 1 sees linked Student A');
      assert.strictEqual(resTeacher.data[STUDENT_B_EMAIL], undefined, 'Teacher 1 must NOT see unlinked Student B');

      // Query GET /api/user-profile for Student A after memory wipe
      const resProfile = await makeRequest(
        server,
        'GET',
        `/api/user-profile?uid=${STUDENT_A_UID}&email=${encodeURIComponent(STUDENT_A_EMAIL)}`
      );
      assert.strictEqual(resProfile.status, 200);
      assert.strictEqual(resProfile.data.profile.contractedLessons, 8);
      assert.strictEqual(resProfile.data.profile.availableLessons, 8);

      // Additional purchase accumulates cleanly on top of Firestore balance (8 + 4 = 12)
      const resAdd4 = await makeRequest(
        server,
        'POST',
        '/api/students/purchase-package',
        {
          studentUid: STUDENT_A_UID,
          teacherUid: TEACHER_1_UID,
          packageLessons: 4,
          idempotencyKey: 'arch2c-order-4-002',
        },
        { Authorization: 'Bearer admin-token' }
      );
      assert.strictEqual(resAdd4.status, 200);
      assert.strictEqual(resAdd4.data.contractedLessons, 12);
      assert.strictEqual(resAdd4.data.availableLessons, 12);
    });

    // -------------------------------------------------------------------------
    // 3. Operações repetidas não duplicam créditos ou transações
    // -------------------------------------------------------------------------
    await test('3. Operações repetidas com mesma idempotencyKey não duplicam créditos nem transações', async () => {
      const txCountBefore = mockFs._listCol('financial_transactions').length;

      const replayRes1 = await makeRequest(
        server,
        'POST',
        '/api/students/purchase-package',
        {
          studentUid: STUDENT_A_UID,
          teacherUid: TEACHER_1_UID,
          packageLessons: 4,
          idempotencyKey: 'arch2c-order-4-002',
        },
        { Authorization: 'Bearer admin-token' }
      );
      const replayRes2 = await makeRequest(
        server,
        'POST',
        '/api/students/purchase-package',
        {
          studentUid: STUDENT_A_UID,
          teacherUid: TEACHER_1_UID,
          packageLessons: 4,
          idempotencyKey: 'arch2c-order-4-002',
        },
        { Authorization: 'Bearer admin-token' }
      );

      assert.strictEqual(replayRes1.status, 200);
      assert.strictEqual(replayRes2.status, 200);
      assert.strictEqual(replayRes1.data.isIdempotent, true);
      assert.strictEqual(replayRes1.data.contractedLessons, 12);
      assert.strictEqual(replayRes1.data.availableLessons, 12);
      assert.strictEqual(replayRes2.data.contractedLessons, 12);
      assert.strictEqual(mockFs._listCol('financial_transactions').length, txCountBefore, 'No duplicate financial transaction allowed');
    });

    // -------------------------------------------------------------------------
    // 4. Professor e aluno não conseguem alterar saldos indevidamente
    // -------------------------------------------------------------------------
    await test('4. Professor, aluno e chamadas não autenticadas não conseguem alterar saldos indevidamente', async () => {
      // Unauthenticated checks (401)
      const unauth1 = await makeRequest(server, 'GET', '/api/contracted-lessons');
      const unauth2 = await makeRequest(server, 'POST', '/api/contracted-lessons', { email: STUDENT_A_EMAIL, count: 999 });
      const unauth3 = await makeRequest(server, 'POST', '/api/students/contract', { email: STUDENT_A_EMAIL, count: 999 });
      const unauth4 = await makeRequest(server, 'POST', '/api/students/cancel', { email: STUDENT_A_EMAIL });
      assert.strictEqual(unauth1.status, 401);
      assert.strictEqual(unauth2.status, 401);
      assert.strictEqual(unauth3.status, 401);
      assert.strictEqual(unauth4.status, 401);

      // Student cannot alter own or others' balances via /api/students/contract or /api/contracted-lessons
      const stuContract = await makeRequest(
        server,
        'POST',
        '/api/students/contract',
        { studentUid: STUDENT_A_UID, email: STUDENT_A_EMAIL, count: 99 },
        { Authorization: 'Bearer student-a-token' }
      );
      const stuContractedPost = await makeRequest(
        server,
        'POST',
        '/api/contracted-lessons',
        { studentUid: STUDENT_A_UID, email: STUDENT_A_EMAIL, count: 99 },
        { Authorization: 'Bearer student-a-token' }
      );
      assert.strictEqual(stuContract.status, 403);
      assert.strictEqual(stuContractedPost.status, 403);

      // Teacher cannot alter any student's balance via /api/students/contract or /api/contracted-lessons
      const tchContract = await makeRequest(
        server,
        'POST',
        '/api/students/contract',
        { studentUid: STUDENT_A_UID, email: STUDENT_A_EMAIL, count: 99 },
        { Authorization: 'Bearer teacher-1-token' }
      );
      const tchContractedPost = await makeRequest(
        server,
        'POST',
        '/api/contracted-lessons',
        { studentUid: STUDENT_A_UID, email: STUDENT_A_EMAIL, count: 99 },
        { Authorization: 'Bearer teacher-1-token' }
      );
      assert.strictEqual(tchContract.status, 403);
      assert.strictEqual(tchContractedPost.status, 403);

      // Teacher cannot cancel student's enrollment
      const tchCancel = await makeRequest(
        server,
        'POST',
        '/api/students/cancel',
        { studentUid: STUDENT_A_UID, studentEmail: STUDENT_A_EMAIL },
        { Authorization: 'Bearer teacher-1-token' }
      );
      assert.strictEqual(tchCancel.status, 403);

      // Student A cannot cancel Student B's enrollment
      const stuCancelOther = await makeRequest(
        server,
        'POST',
        '/api/students/cancel',
        { studentUid: STUDENT_B_UID, studentEmail: STUDENT_B_EMAIL },
        { Authorization: 'Bearer student-a-token' }
      );
      assert.strictEqual(stuCancelOther.status, 403);

      // Student A cannot buy package in pre-commercialization mode (even spoofing UID)
      process.env.PAYMENTS_ENABLED = 'false';
      const stuBuy = await makeRequest(
        server,
        'POST',
        '/api/students/purchase-package',
        { studentUid: STUDENT_B_UID, teacherUid: TEACHER_1_UID, packageLessons: 8 },
        { Authorization: 'Bearer student-a-token' }
      );
      assert.strictEqual(stuBuy.status, 403);

      // Balances of both Student A (12) and Student B (4/3) must remain untouched
      assert.strictEqual(mockFs._getDoc('users', STUDENT_A_UID)?.contractedLessons, 12);
      assert.strictEqual(mockFs._getDoc('users', STUDENT_A_UID)?.availableLessons, 12);
      assert.strictEqual(mockFs._getDoc('users', STUDENT_B_UID)?.contractedLessons, 4);
      assert.strictEqual(mockFs._getDoc('users', STUDENT_B_UID)?.availableLessons, 3);
    });

    // -------------------------------------------------------------------------
    // 5. Fluxos administrativos autorizados e cancelamento preservando créditos
    // -------------------------------------------------------------------------
    await test('5. Fluxos administrativos autorizados permanecem funcionais e cancelamento preserva créditos pagos', async () => {
      // Admin GET /api/contracted-lessons returns all students
      const resAdminGet = await makeRequest(server, 'GET', '/api/contracted-lessons', undefined, {
        Authorization: 'Bearer admin-token',
      });
      assert.strictEqual(resAdminGet.status, 200);
      assert.strictEqual(resAdminGet.data[STUDENT_A_EMAIL], 12);
      assert.strictEqual(resAdminGet.data[STUDENT_B_EMAIL], 4);

      // Admin adjusts Student B's contract from 4 -> 6 (Student B had 4 contracted, 3 available => +2 delta => 5 available)
      const resAdminContract = await makeRequest(
        server,
        'POST',
        '/api/students/contract',
        { studentEmail: STUDENT_B_EMAIL, count: 6, reason: 'Support credit adjustment' },
        { Authorization: 'Bearer admin-token' }
      );
      assert.strictEqual(resAdminContract.status, 200);
      assert.strictEqual(resAdminContract.data.contractedLessons, 6);
      assert.strictEqual(resAdminContract.data.availableLessons, 5);
      assert.strictEqual(mockFs._getDoc('users', STUDENT_B_UID)?.contractedLessons, 6);
      assert.strictEqual(mockFs._getDoc('users', STUDENT_B_UID)?.availableLessons, 5);

      // Admin adjusts via POST /api/contracted-lessons back to 8 -> available becomes 7
      const resAdminContracted = await makeRequest(
        server,
        'POST',
        '/api/contracted-lessons',
        { studentUid: STUDENT_B_UID, count: 8 },
        { Authorization: 'Bearer admin-token' }
      );
      assert.strictEqual(resAdminContracted.status, 200);
      assert.strictEqual(resAdminContracted.data.contractedLessons, 8);
      assert.strictEqual(resAdminContracted.data.availableLessons, 7);

      // Student A cancels own subscription (even attempting to spoof cancelledBy: 'teacher') -> preserves 12 credits!
      const resStuCancel = await makeRequest(
        server,
        'POST',
        '/api/students/cancel',
        { studentEmail: STUDENT_A_EMAIL, cancelledBy: 'teacher' },
        { Authorization: 'Bearer student-a-token' }
      );
      assert.strictEqual(resStuCancel.status, 200);
      assert.strictEqual(resStuCancel.data.enrollmentStatus, 'cancelled');
      assert.strictEqual(resStuCancel.data.cancelledBy, 'student', 'Server must derive cancelledBy from token role');
      assert.strictEqual(resStuCancel.data.contractedLessons, 12, 'Cancel must preserve contractedLessons');
      assert.strictEqual(resStuCancel.data.availableLessons, 12, 'Cancel must preserve availableLessons');

      const docAfterCancel = mockFs._getDoc('users', STUDENT_A_UID);
      assert.strictEqual(docAfterCancel?.enrollmentStatus, 'cancelled');
      assert.strictEqual(docAfterCancel?.contractedLessons, 12);
      assert.strictEqual(docAfterCancel?.availableLessons, 12);
      assert.strictEqual(docAfterCancel?.teacherUid, null);

      // Admin cancels Student B -> preserves 8 contracted / 7 available
      const resAdminCancel = await makeRequest(
        server,
        'POST',
        '/api/students/cancel',
        { studentUid: STUDENT_B_UID },
        { Authorization: 'Bearer admin-token' }
      );
      assert.strictEqual(resAdminCancel.status, 200);
      assert.strictEqual(resAdminCancel.data.cancelledBy, 'admin');
      assert.strictEqual(resAdminCancel.data.contractedLessons, 8);
      assert.strictEqual(resAdminCancel.data.availableLessons, 7);
    });

    // -------------------------------------------------------------------------
    // 6. Nenhuma regressão nas regras comerciais (1, 4, 8, 12; 0%, 5%, 10%, 15%; rateio)
    // -------------------------------------------------------------------------
    await test('6. Todas as faixas comerciais (1/4/8/12 aulas, descontos 0/5/10/15%, rateio exato em centavos, PTAX D-1) sem regressão', async () => {
      const expectedDiscounts = [
        { count: 1, discount: 0 },
        { count: 4, discount: 5 },
        { count: 8, discount: 10 },
        { count: 12, discount: 15 },
      ];
      const quote = calculateFinancialPricingQuote({
        basePriceUsd: 20,
        adminCommissionPercent: 25,
        ptaxRate: PTAX_RATE,
        commissionModel: 'MARKUP',
      });

      for (const spec of expectedDiscounts) {
        const res = await makeRequest(
          server,
          'POST',
          '/api/students/purchase-package',
          {
            studentUid: STUDENT_A_UID,
            teacherUid: TEACHER_1_UID,
            packageLessons: spec.count,
            idempotencyKey: `arch2c-pkg-${spec.count}`,
          },
          { Authorization: 'Bearer admin-token' }
        );
        assert.strictEqual(res.status, 200);
        const tx = res.data.transaction;
        const qPkg = quote.packages.list.find((p) => p.lessonsCount === spec.count)!;

        assert.strictEqual(tx.discountPercent, spec.discount);
        assert.strictEqual(tx.packagePriceUsd, qPkg.finalPriceUsd);
        assert.strictEqual(tx.packagePriceBrl, qPkg.finalPriceBrl);
        assert.strictEqual(
          Math.round((tx.teacherShareUsd + tx.platformRevenueUsd) * 100),
          Math.round(tx.packagePriceUsd * 100),
          `USD invariant for ${spec.count} lessons`
        );
        assert.strictEqual(
          Math.round((tx.teacherShareBrl + tx.platformRevenueBrl) * 100),
          Math.round(tx.packagePriceBrl * 100),
          `BRL invariant for ${spec.count} lessons`
        );
      }

      // Final accumulated balance on Student A: 12 + 1 + 4 + 8 + 12 = 37
      const finalDoc = mockFs._getDoc('users', STUDENT_A_UID);
      assert.strictEqual(finalDoc?.contractedLessons, 37);
      assert.strictEqual(finalDoc?.availableLessons, 37);
      assert.strictEqual(finalDoc?.teacherUid, TEACHER_1_UID);
    });
  } finally {
    server.close();
    resetFirebaseAdminFirestoreForTesting();
    clearPtaxMemoryCache();
  }

  console.log('\n======================================================================');
  console.log(` RESULTADOS ARCH.2C: ${passed} PASSOU | ${failed} FALHOU`);
  console.log('======================================================================');
  if (failed > 0) process.exit(1);
  process.exit(0);
}

runSuite().catch((err) => {
  console.error('Fatal error in ARCH.2C test suite:', err);
  process.exit(1);
});
