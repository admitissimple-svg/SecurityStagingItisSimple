/**
 * TEST SUITE: NF.SWITCH.2A — CREDIT LOTS LEDGER FOUNDATION & ATOMIC CONSUMPTION/REFUND
 * Behavioral HTTP + Atomic Firestore (default) validation tests covering:
 *  1. Q1 Priority Order: courtesy -> paid -> legacy_unreconciled + deterministic FIFO tie-breakers
 *  2. Exact-lot refund on teacher/admin cancel, teacher-fault not_completed, and admin DELETE
 *  3. Zero presumed financial attribution (strictly null) on legacy_unreconciled
 *  4. Hidratação única (`creditLotsInitializedAt`) + CREDIT_LEDGER_DIVERGENCE (HTTP 409) without silent self-correction
 *  5. Root `credit_lots` invariants: global ID uniqueness, studentUid isolation, incomplete `activeCreditLotIds` resilience
 *  6. OCC concurrency safety, negative admin adjustment Q1 consumption, privacy boundary, and trial 0-credit preservation
 */

process.env.NODE_ENV = 'test';
process.env.FIREBASE_PROJECT_ID = 'itissimple-security-staging';
process.env.FIREBASE_DATABASE_ID = '(default)';
process.env.PAYMENTS_ENABLED = 'false';

import assert from 'assert';
import http from 'http';
import { app as serverApp, resetInMemoryDbForTesting } from '../serverApp';
import {
  setFirebaseAdminFirestoreForTesting,
  resetFirebaseAdminFirestoreForTesting,
  executePackageCreditOperationAtomicServer,
} from '../src/serverFirestore';
import {
  setFirebaseAdminAuthForTesting,
  resetFirebaseAdminForTesting,
} from '../src/serverFirebaseAdmin';
import {
  clearPtaxMemoryCache,
  getExpectedReferenceDate,
  getSaoPauloDateString,
  PTAX_CACHE_COLLECTION,
  PTAX_SOURCE_LABEL,
} from '../src/serverPtax';
import { ADMIN_COMMISSION_KEYS } from '../src/utils/tutorCommission';
import {
  buildCreditLotId,
  sortCreditLotsForConsumption,
} from '../src/utils/creditLots';
import type { CreditLot } from '../src/types';

function createOccFirestoreMock() {
  const store = new Map<string, { data: Record<string, any>; version: number }>();
  let txChain = Promise.resolve();

  const matchFilters = (data: Record<string, any>, filters: Array<{ field: string; op: string; val: any }>) => {
    return filters.every((f) => {
      if (f.op === '==') return data[f.field] === f.val;
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
        const entry = store.get(key);
        return {
          id,
          exists: Boolean(entry?.data),
          ref: makeDocRef(col, id, parentPath),
          data: () => (entry?.data ? JSON.parse(JSON.stringify(entry.data)) : undefined),
        };
      },
      set: async (data: Record<string, any>, opts?: { merge?: boolean }) => {
        const entry = store.get(key);
        const prev = opts?.merge ? (entry?.data || {}) : {};
        store.set(key, {
          data: JSON.parse(JSON.stringify({ ...prev, ...data })),
          version: (entry?.version || 0) + 1,
        });
        return { writeTime: new Date() };
      },
      update: async (data: Record<string, any>) => {
        const entry = store.get(key);
        const prev = entry?.data || {};
        store.set(key, {
          data: JSON.parse(JSON.stringify({ ...prev, ...data })),
          version: (entry?.version || 0) + 1,
        });
        return { writeTime: new Date() };
      },
      delete: async () => {
        const entry = store.get(key);
        store.delete(key);
        if (entry) {
          // Track deletion version bump implicitly by deletion
        }
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
        for (const [k, entry] of store.entries()) {
          if (!k.startsWith(`${fullCol}::`)) continue;
          const docId = k.slice(`${fullCol}::`.length);
          if (docId.includes('/')) continue;
          if (matchFilters(entry.data, filters)) {
            docs.push({
              id: docId,
              exists: true,
              ref: makeDocRef(col, docId, parentPath),
              data: () => JSON.parse(JSON.stringify(entry.data)),
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
      const execute = txChain.then(async () => {
        const maxAttempts = 5;
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          const readVersions = new Map<string, number>();
          const staged: Array<{ key: string; op: 'set' | 'delete'; data?: Record<string, any>; merge?: boolean }> = [];

          const tx = {
            get: async (ref: any) => {
              const key = `${ref._col}::${ref._id}`;
              const entry = store.get(key);
              readVersions.set(key, entry?.version || 0);
              return {
                id: ref._id,
                exists: Boolean(entry?.data),
                ref,
                data: () => (entry?.data ? JSON.parse(JSON.stringify(entry.data)) : undefined),
              };
            },
            set: (ref: any, data: Record<string, any>, opts?: { merge?: boolean }) => {
              staged.push({
                key: `${ref._col}::${ref._id}`,
                op: 'set',
                data: JSON.parse(JSON.stringify(data)),
                merge: Boolean(opts?.merge),
              });
            },
            update: (ref: any, data: Record<string, any>) => {
              staged.push({
                key: `${ref._col}::${ref._id}`,
                op: 'set',
                data: JSON.parse(JSON.stringify(data)),
                merge: true,
              });
            },
            delete: (ref: any) => {
              staged.push({
                key: `${ref._col}::${ref._id}`,
                op: 'delete',
              });
            },
          };

          const result = await fn(tx);

          let conflict = false;
          for (const [k, v] of readVersions.entries()) {
            const currV = store.get(k)?.version || 0;
            if (currV !== v) {
              conflict = true;
              break;
            }
          }
          if (conflict) {
            if (attempt === maxAttempts - 1) throw new Error('ABORTED: OCC conflict');
            continue;
          }

          for (const w of staged) {
            const entry = store.get(w.key);
            if (w.op === 'delete') {
              store.delete(w.key);
            } else {
              const prev = w.merge ? (entry?.data || {}) : {};
              store.set(w.key, {
                data: JSON.parse(JSON.stringify({ ...prev, ...w.data })),
                version: (entry?.version || 0) + 1,
              });
            }
          }
          return result;
        }
      });
      txChain = execute.catch(() => {});
      return execute;
    },
    _setDoc: (col: string, id: string, data: Record<string, any>) => {
      const key = `${col}::${id}`;
      const entry = store.get(key);
      store.set(key, {
        data: JSON.parse(JSON.stringify(data)),
        version: (entry?.version || 0) + 1,
      });
    },
    _getDoc: (col: string, id: string): any => store.get(`${col}::${id}`)?.data,
    _listCol: (col: string) => {
      const out: Array<{ id: string; data: Record<string, any> }> = [];
      for (const [k, entry] of store.entries()) {
        if (k.startsWith(`${col}::`) && !k.slice(`${col}::`.length).includes('/')) {
          out.push({ id: k.slice(`${col}::`.length), data: JSON.parse(JSON.stringify(entry.data)) });
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

function collectNestedKeys(obj: any, out = new Set<string>()): Set<string> {
  if (!obj || typeof obj !== 'object') return out;
  if (Array.isArray(obj)) {
    for (const item of obj) collectNestedKeys(item, out);
    return out;
  }
  for (const [k, v] of Object.entries(obj)) {
    out.add(k);
    if (v && typeof v === 'object') collectNestedKeys(v, out);
  }
  return out;
}

async function runSuite() {
  console.log('=========================================================================');
  console.log(' NF.SWITCH.2A — CREDIT LOTS LEDGER FOUNDATION (TESTES COMPORTAMENTAIS)');
  console.log('=========================================================================\n');

  resetInMemoryDbForTesting();
  clearPtaxMemoryCache();

  const mockDb = createOccFirestoreMock();
  setFirebaseAdminFirestoreForTesting(mockDb as any);

  const ADMIN_UID = 'adm_nf2a_canonical_uid_0001';
  const TEACHER_UID = 'tut_nf2a_canonical_uid_0001';
  const STUDENT_A_UID = 'std_nf2a_canonical_uid_0001';
  const STUDENT_B_UID = 'std_nf2a_canonical_uid_0002';
  const STUDENT_C_UID = 'std_nf2a_canonical_uid_0003';
  const STUDENT_TRIAL_UID = 'std_nf2a_canonical_uid_0004';

  const tokenUsers: Record<string, any> = {
    'tok-admin': { uid: ADMIN_UID, email: 'admin@itissimple.org', role: 'admin', email_verified: true },
    'tok-teacher': { uid: TEACHER_UID, email: 'tutor@itissimple.org', role: 'teacher', email_verified: true },
    'tok-student-a': { uid: STUDENT_A_UID, email: 'student_a@itissimple.org', role: 'student', email_verified: true },
    'tok-student-b': { uid: STUDENT_B_UID, email: 'student_b@itissimple.org', role: 'student', email_verified: true },
    'tok-student-c': { uid: STUDENT_C_UID, email: 'student_c@itissimple.org', role: 'student', email_verified: true },
    'tok-student-trial': { uid: STUDENT_TRIAL_UID, email: 'student_trial@itissimple.org', role: 'student', email_verified: true },
  };

  setFirebaseAdminAuthForTesting({
    verifyIdToken: async (token: string) => {
      const u = tokenUsers[token];
      if (!u) throw new Error('Invalid token');
      return u;
    },
  } as any);

  // Seed PTAX D-1 cache for package calculations
  const todaySp = getSaoPauloDateString(new Date());
  const expectedRef = getExpectedReferenceDate(todaySp);
  mockDb._setDoc(PTAX_CACHE_COLLECTION, expectedRef, {
    ptaxRate: 5.5,
    quoteDate: expectedRef,
    pricingDate: todaySp,
    source: PTAX_SOURCE_LABEL,
    fetchedAt: new Date().toISOString(),
  });

  // Seed admin & approved teacher
  mockDb._setDoc('users', ADMIN_UID, {
    uid: ADMIN_UID,
    id: ADMIN_UID,
    email: 'admin@itissimple.org',
    name: 'Admin NF2A',
    role: 'admin',
  });
  const tutorBase = {
    uid: TEACHER_UID,
    id: TEACHER_UID,
    email: 'tutor@itissimple.org',
    name: 'Native Tutor NF2A',
    role: 'teacher',
    approvalStatus: 'approved',
    isApproved: true,
    pricePerSessionUsd: 10,
    adminCommissionPercent: 30,
    commissionModel: 'MARKUP',
    commissionVersion: 1,
    isCommercializable: true,
    meetUrl: 'https://meet.google.com/nf2a-room-tutor',
  };
  mockDb._setDoc('users', TEACHER_UID, tutorBase);
  mockDb._setDoc('tutors', TEACHER_UID, tutorBase);

  // Seed Student A with pre-existing legacy balance of 1 lesson (NO creditLotsInitializedAt yet!)
  mockDb._setDoc('users', STUDENT_A_UID, {
    uid: STUDENT_A_UID,
    id: STUDENT_A_UID,
    email: 'student_a@itissimple.org',
    name: 'Student A',
    role: 'student',
    availableLessons: 1,
    contractedLessons: 1,
    hasCompletedTrialLesson: false,
    enrollmentStatus: 'active',
  });

  // Seed Student B with 0 balance and NO creditLotsInitializedAt
  mockDb._setDoc('users', STUDENT_B_UID, {
    uid: STUDENT_B_UID,
    id: STUDENT_B_UID,
    email: 'student_b@itissimple.org',
    name: 'Student B',
    role: 'student',
    availableLessons: 0,
    contractedLessons: 0,
    hasCompletedTrialLesson: false,
    enrollmentStatus: 'active',
  });

  // Seed Student C with 0 balance for concurrency & isolation tests
  mockDb._setDoc('users', STUDENT_C_UID, {
    uid: STUDENT_C_UID,
    id: STUDENT_C_UID,
    email: 'student_c@itissimple.org',
    name: 'Student C',
    role: 'student',
    availableLessons: 0,
    contractedLessons: 0,
    hasCompletedTrialLesson: false,
    enrollmentStatus: 'active',
  });

  // Seed Student Trial with 0 balance for 25-min trial preservation test
  mockDb._setDoc('users', STUDENT_TRIAL_UID, {
    uid: STUDENT_TRIAL_UID,
    id: STUDENT_TRIAL_UID,
    email: 'student_trial@itissimple.org',
    name: 'Student Trial',
    role: 'student',
    availableLessons: 0,
    contractedLessons: 0,
    hasCompletedTrialLesson: false,
    enrollmentStatus: 'active',
  });

  const server = http.createServer(serverApp);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));

  let passed = 0;
  let failed = 0;
  async function runTest(name: string, fn: () => Promise<void> | void) {
    try {
      await fn();
      passed++;
      console.log(`PASS: ${name}`);
    } catch (err: any) {
      failed++;
      console.error(`FAIL: ${name} -> ${err?.message || err}`);
      if (err?.stack) console.error(err.stack);
    }
  }

  try {
    // -----------------------------------------------------------------------
    // 1. Deterministic FIFO tie-breaking & Q1 unit sort verification
    // -----------------------------------------------------------------------
    await runTest('1. Q1 Deterministic sort: courtesy -> paid -> legacy_unreconciled + createdAt/lotSequence/id tie-break', () => {
      const sameIso = '2026-11-18T10:00:00.000Z';
      const sample: CreditLot[] = [
        { id: 'lot-legacy', studentUid: STUDENT_A_UID, origin: 'legacy_unreconciled', sourceType: 'LEGACY_INITIAL_HYDRATION', status: 'active', initialLessons: 1, remainingLessons: 1, consumedLessons: 0, lotSequence: 1, createdAt: '2026-11-18T09:00:00.000Z', updatedAt: sameIso, isPaidPurchase: false, countsAsRevenue: false, financialAttributionStatus: 'unreconciled_no_presumed_value' } as CreditLot,
        { id: 'lot-paid-2', studentUid: STUDENT_A_UID, origin: 'paid', sourceType: 'PACKAGE_PURCHASE', status: 'active', initialLessons: 1, remainingLessons: 1, consumedLessons: 0, lotSequence: 3, createdAt: sameIso, updatedAt: sameIso, isPaidPurchase: true, countsAsRevenue: true, financialAttributionStatus: 'paid_verified' } as CreditLot,
        { id: 'lot-paid-1', studentUid: STUDENT_A_UID, origin: 'paid', sourceType: 'PACKAGE_PURCHASE', status: 'active', initialLessons: 1, remainingLessons: 1, consumedLessons: 0, lotSequence: 2, createdAt: sameIso, updatedAt: sameIso, isPaidPurchase: true, countsAsRevenue: true, financialAttributionStatus: 'paid_verified' } as CreditLot,
        { id: 'lot-courtesy-b', studentUid: STUDENT_A_UID, origin: 'courtesy', sourceType: 'ADMIN_CREDIT_ADJUSTMENT', status: 'active', initialLessons: 1, remainingLessons: 1, consumedLessons: 0, lotSequence: 5, createdAt: sameIso, updatedAt: sameIso, isPaidPurchase: false, countsAsRevenue: false, financialAttributionStatus: 'courtesy_non_revenue' } as CreditLot,
        { id: 'lot-courtesy-a', studentUid: STUDENT_A_UID, origin: 'courtesy', sourceType: 'ADMIN_PACKAGE_GRANT', status: 'active', initialLessons: 1, remainingLessons: 1, consumedLessons: 0, lotSequence: 4, createdAt: sameIso, updatedAt: sameIso, isPaidPurchase: false, countsAsRevenue: false, financialAttributionStatus: 'courtesy_non_revenue' } as CreditLot,
      ];
      const sorted = sortCreditLotsForConsumption(sample);
      assert.deepStrictEqual(
        sorted.map((l) => l.id),
        ['lot-courtesy-a', 'lot-courtesy-b', 'lot-paid-1', 'lot-paid-2', 'lot-legacy']
      );
    });

    // -----------------------------------------------------------------------
    // 2. Single-time hydration of legacy balance + zero presumed financial attribution
    // -----------------------------------------------------------------------
    let legacyLotId = '';
    let grantCourtesyLotId = '';
    let adjCourtesyLotId = '';
    let paidLot1Id = '';
    let paidLot2Id = '';

    await runTest('2. Primeira operação atômica hidrata legado uma única vez sem atribuição financeira presumida', async () => {
      // Student A starts with availableLessons: 1 (no creditLotsInitializedAt).
      // Grant a 4-lesson courtesy package via HTTP ADM endpoint.
      const grantRes = await makeRequest(
        server,
        'POST',
        '/api/admin/packages/grant',
        {
          studentUid: STUDENT_A_UID,
          teacherUid: TEACHER_UID,
          packageLessons: 4,
          idempotencyKey: 'nf2a-grant-a-1',
        },
        { Authorization: 'Bearer tok-admin' }
      );
      assert.strictEqual(grantRes.status, 200, JSON.stringify(grantRes.data));
      assert.strictEqual(grantRes.data.availableLessons, 5);
      grantCourtesyLotId = grantRes.data.transaction.creditLotId;
      assert.ok(grantCourtesyLotId, 'creditLotId must be linked on package transaction');

      const studentDoc = mockDb._getDoc('users', STUDENT_A_UID);
      assert.ok(typeof studentDoc.creditLotsInitializedAt === 'string' && studentDoc.creditLotsInitializedAt.length > 0);
      assert.strictEqual(studentDoc.activeCreditLotIds.length, 2);

      const lots = mockDb._listCol('credit_lots').filter((d) => d.data.studentUid === STUDENT_A_UID);
      assert.strictEqual(lots.length, 2);

      const legacyEntry = lots.find((d) => d.data.origin === 'legacy_unreconciled');
      assert.ok(legacyEntry, 'legacy_unreconciled lot must be materialized once');
      legacyLotId = legacyEntry!.id;

      // Strict check: NO presumed financial attribution on legacy_unreconciled
      const ld = legacyEntry!.data;
      assert.strictEqual(ld.sourceType, 'LEGACY_INITIAL_HYDRATION');
      assert.strictEqual(ld.initialLessons, 1);
      assert.strictEqual(ld.remainingLessons, 1);
      assert.strictEqual(ld.consumedLessons, 0);
      assert.strictEqual(ld.isPaidPurchase, false);
      assert.strictEqual(ld.countsAsRevenue, false);
      assert.strictEqual(ld.financialAttributionStatus, 'unreconciled_no_presumed_value');
      for (const nullField of [
        'pricedTeacherUid',
        'basePriceUsd',
        'adminCommissionPercent',
        'commissionModel',
        'commissionVersion',
        'ptaxRate',
        'discountPercent',
        'totalPaidBrl',
        'totalPaidUsd',
        'unitPriceBrl',
        'unitPriceUsd',
        'teacherShareBrl',
        'teacherShareUsd',
        'teacherLessonShareBrl',
        'teacherLessonShareUsd',
        'platformRevenueBrl',
        'platformRevenueUsd',
        'platformLessonRevenueBrl',
        'platformLessonRevenueUsd',
      ]) {
        assert.strictEqual(ld[nullField], null, `legacy lot field ${nullField} must strictly be null`);
      }

      // Check courtesy grant lot
      const grantLot = mockDb._getDoc('credit_lots', grantCourtesyLotId);
      assert.strictEqual(grantLot.origin, 'courtesy');
      assert.strictEqual(grantLot.sourceType, 'ADMIN_PACKAGE_GRANT');
      assert.strictEqual(grantLot.isPaidPurchase, false);
      assert.strictEqual(grantLot.countsAsRevenue, false);
      assert.strictEqual(grantLot.totalPaidBrl, 0);
      assert.strictEqual(grantLot.platformRevenueBrl, 0);
    });

    // -----------------------------------------------------------------------
    // 3. Add Paid Package #1, Courtesy Admin Adjustment +1, and Paid Package #2
    //    Verify Q1 consumption priority across all 8 credits (courtesy -> paid -> legacy)
    // -----------------------------------------------------------------------
    await runTest('3. Consumo Q1 estrito (courtesy -> paid -> legacy_unreconciled) e ordenação FIFO intra-origem', async () => {
      // Paid package #1 (1 lesson)
      const paidRes1 = await executePackageCreditOperationAtomicServer({
        actorUid: STUDENT_A_UID,
        actorEmail: 'student_a@itissimple.org',
        actorRole: 'student',
        studentUid: STUDENT_A_UID,
        teacherUid: TEACHER_UID,
        packageLessons: 1,
        idempotencyKey: 'nf2a-paid-a-1',
        isPaidPurchase: true,
        gatewayConfirmation: {
          verifiedByServer: true,
          gatewayProvider: 'stripe',
          gatewayTransactionId: 'gw_nf2a_1',
        },
      });
      assert.strictEqual(paidRes1.success, true, paidRes1.error);
      paidLot1Id = paidRes1.transaction!.creditLotId;
      const paidLot1Doc = mockDb._getDoc('credit_lots', paidLot1Id);
      assert.strictEqual(paidLot1Doc.origin, 'paid');
      assert.strictEqual(paidLot1Doc.isPaidPurchase, true);
      assert.strictEqual(paidLot1Doc.countsAsRevenue, true);
      assert.ok(typeof paidLot1Doc.totalPaidBrl === 'number' && paidLot1Doc.totalPaidBrl > 0);
      assert.ok(typeof paidLot1Doc.teacherLessonShareBrl === 'number' && paidLot1Doc.teacherLessonShareBrl > 0);

      // Admin manual adjustment +1 (courtesy)
      const adjRes = await makeRequest(
        server,
        'POST',
        '/api/admin/credits/adjust',
        {
          studentUid: STUDENT_A_UID,
          delta: 1,
          reason: 'Bônus cortesia NF2A',
          idempotencyKey: 'nf2a-adj-a-1',
        },
        { Authorization: 'Bearer tok-admin' }
      );
      assert.strictEqual(adjRes.status, 200, JSON.stringify(adjRes.data));
      adjCourtesyLotId = adjRes.data.transaction.creditLotId;
      assert.strictEqual(mockDb._getDoc('credit_lots', adjCourtesyLotId).origin, 'courtesy');

      // Paid package #2 (1 lesson)
      const paidRes2 = await executePackageCreditOperationAtomicServer({
        actorUid: STUDENT_A_UID,
        actorEmail: 'student_a@itissimple.org',
        actorRole: 'student',
        studentUid: STUDENT_A_UID,
        teacherUid: TEACHER_UID,
        packageLessons: 1,
        idempotencyKey: 'nf2a-paid-a-2',
        isPaidPurchase: true,
        gatewayConfirmation: {
          verifiedByServer: true,
          gatewayProvider: 'stripe',
          gatewayTransactionId: 'gw_nf2a_2',
        },
      });
      assert.strictEqual(paidRes2.success, true);
      paidLot2Id = paidRes2.transaction!.creditLotId;

      // Total for Student A = 1 (legacy) + 4 (grant courtesy) + 1 (paid1) + 1 (adj courtesy) + 1 (paid2) = 8 lessons
      assert.strictEqual(mockDb._getDoc('users', STUDENT_A_UID).availableLessons, 8);

      // Schedule 8 consecutive non-overlapping lessons and record exact creditLotId consumed each time
      const expectedLotOrder = [
        grantCourtesyLotId,
        grantCourtesyLotId,
        grantCourtesyLotId,
        grantCourtesyLotId,
        adjCourtesyLotId,
        paidLot1Id,
        paidLot2Id,
        legacyLotId,
      ];

      for (let i = 0; i < 8; i++) {
        const day = String(10 + i).padStart(2, '0');
        const res = await makeRequest(
          server,
          'POST',
          '/api/lessons/schedule',
          {
            requestId: `lesson-nf2a-q1-${i + 1}`,
            teacherUid: TEACHER_UID,
            startDateTime: `2026-12-${day}T10:00:00.000Z`,
            endDateTime: `2026-12-${day}T10:50:00.000Z`,
            title: `Q1 Order Lesson ${i + 1}`,
            isTrialLesson: false,
          },
          { Authorization: 'Bearer tok-student-a' }
        );
        assert.strictEqual(res.status, 200, `Lesson ${i + 1} schedule failed: ${JSON.stringify(res.data)}`);
        assert.strictEqual(
          res.data.lesson.creditLotId,
          expectedLotOrder[i],
          `Lesson ${i + 1} must consume lot ${expectedLotOrder[i]}, got ${res.data.lesson.creditLotId}`
        );

        // Verify zero restricted commission/revenue fields leak on student scheduling response
        const nestedKeys = collectNestedKeys(res.data.lesson);
        for (const restricted of ADMIN_COMMISSION_KEYS) {
          assert.strictEqual(nestedKeys.has(restricted), false, `Restricted key ${restricted} leaked on lesson`);
        }
        assert.strictEqual(nestedKeys.has('teacherShareBrl'), false);
        assert.strictEqual(nestedKeys.has('platformRevenueBrl'), false);
      }

      const studentEnd = mockDb._getDoc('users', STUDENT_A_UID);
      assert.strictEqual(studentEnd.availableLessons, 0);
      assert.deepStrictEqual(studentEnd.activeCreditLotIds, []);

      // Verify all lots are exhausted
      for (const lotId of [grantCourtesyLotId, adjCourtesyLotId, paidLot1Id, paidLot2Id, legacyLotId]) {
        const l = mockDb._getDoc('credit_lots', lotId);
        assert.strictEqual(l.remainingLessons, 0);
        assert.strictEqual(l.status, 'exhausted');
      }
    });

    // -----------------------------------------------------------------------
    // 4. Exact-lot refunds on cancel (teacher), not_completed (teacher), and DELETE (admin)
    //    No refund on student cancel, no double refund on idempotent retry
    // -----------------------------------------------------------------------
    await runTest('4. Estorno preserva exatamente o lote de origem (courtesy/paid/legacy) sem vazamento nem duplicidade', async () => {
      // Refund lesson #6 (paidLot1Id) via teacher cancel
      const cancelPaidRes = await makeRequest(
        server,
        'POST',
        '/api/lessons/lesson-nf2a-q1-6/cancel',
        { cancelledBy: 'teacher', reason: 'Teacher emergency' },
        { Authorization: 'Bearer tok-teacher' }
      );
      assert.strictEqual(cancelPaidRes.status, 200);
      assert.strictEqual(cancelPaidRes.data.creditRefunded, true);
      assert.strictEqual(cancelPaidRes.data.remainingLessons, 1);
      assert.strictEqual(mockDb._getDoc('credit_lots', paidLot1Id).remainingLessons, 1);
      assert.strictEqual(mockDb._getDoc('credit_lots', paidLot1Id).consumedLessons, 0);
      assert.strictEqual(mockDb._getDoc('credit_lots', paidLot1Id).status, 'active');
      assert.strictEqual(mockDb._getDoc('credit_lots', grantCourtesyLotId).remainingLessons, 0);

      // Idempotent repeat cancel must NOT double refund
      const cancelPaidRepeat = await makeRequest(
        server,
        'POST',
        '/api/lessons/lesson-nf2a-q1-6/cancel',
        { cancelledBy: 'teacher', reason: 'Retry' },
        { Authorization: 'Bearer tok-teacher' }
      );
      assert.strictEqual(cancelPaidRepeat.status, 200);
      assert.strictEqual(cancelPaidRepeat.data.isIdempotent, true);
      assert.strictEqual(mockDb._getDoc('credit_lots', paidLot1Id).remainingLessons, 1);
      assert.strictEqual(mockDb._getDoc('users', STUDENT_A_UID).availableLessons, 1);

      // Refund lesson #5 (adjCourtesyLotId) via not_completed (teacher fault)
      const notCompRes = await makeRequest(
        server,
        'POST',
        '/api/lessons/lesson-nf2a-q1-5/not-completed',
        { responsible: 'teacher', reason: 'Connection dropped' },
        { Authorization: 'Bearer tok-teacher' }
      );
      assert.strictEqual(notCompRes.status, 200);
      assert.strictEqual(notCompRes.data.creditRefunded, true);
      assert.strictEqual(notCompRes.data.remainingLessons, 2);
      assert.strictEqual(mockDb._getDoc('credit_lots', adjCourtesyLotId).remainingLessons, 1);
      assert.strictEqual(mockDb._getDoc('credit_lots', adjCourtesyLotId).status, 'active');

      // Refund lesson #8 (legacyLotId) via admin DELETE while active
      const deleteLegacyRes = await makeRequest(
        server,
        'DELETE',
        '/api/lessons/lesson-nf2a-q1-8',
        {},
        { Authorization: 'Bearer tok-admin' }
      );
      assert.strictEqual(deleteLegacyRes.status, 200);
      assert.strictEqual(deleteLegacyRes.data.creditRefunded, true);
      assert.strictEqual(deleteLegacyRes.data.remainingLessons, 3);
      assert.strictEqual(mockDb._getDoc('credit_lots', legacyLotId).remainingLessons, 1);
      assert.strictEqual(mockDb._getDoc('credit_lots', legacyLotId).status, 'active');

      // Student cancels lesson #1 (grantCourtesyLotId) -> NO refund!
      const studentCancelRes = await makeRequest(
        server,
        'POST',
        '/api/lessons/lesson-nf2a-q1-1/cancel',
        { cancelledBy: 'student', reason: 'Student busy' },
        { Authorization: 'Bearer tok-student-a' }
      );
      assert.strictEqual(studentCancelRes.status, 200);
      assert.strictEqual(studentCancelRes.data.creditRefunded, false);
      assert.strictEqual(mockDb._getDoc('credit_lots', grantCourtesyLotId).remainingLessons, 0);
      assert.strictEqual(mockDb._getDoc('users', STUDENT_A_UID).availableLessons, 3);

      // Verify activeCreditLotIds contains the 3 refunded active lots in Q1 priority order (adjCourtesy -> paid1 -> legacy)
      assert.deepStrictEqual(
        mockDb._getDoc('users', STUDENT_A_UID).activeCreditLotIds,
        [adjCourtesyLotId, paidLot1Id, legacyLotId]
      );
    });

    // -----------------------------------------------------------------------
    // 5. Post-initialization: CREDIT_LEDGER_DIVERGENCE (HTTP 409) without silent self-correction
    // -----------------------------------------------------------------------
    await runTest('5. Pós-inicialização: divergência entre availableLessons e soma dos lotes gera CREDIT_LEDGER_DIVERGENCE (409) sem autocorreção', async () => {
      // Initialize Student B cleanly at 0 via +4 grant, then test divergence
      const grantB = await makeRequest(
        server,
        'POST',
        '/api/admin/packages/grant',
        {
          studentUid: STUDENT_B_UID,
          teacherUid: TEACHER_UID,
          packageLessons: 4,
          idempotencyKey: 'nf2a-init-b-1',
        },
        { Authorization: 'Bearer tok-admin' }
      );
      assert.strictEqual(grantB.status, 200);
      const bDocInit = mockDb._getDoc('users', STUDENT_B_UID);
      assert.ok(bDocInit.creditLotsInitializedAt);
      // Confirm no legacy lot materialized when starting from 0
      const bLegacyLots = mockDb._listCol('credit_lots').filter(
        (d) => d.data.studentUid === STUDENT_B_UID && d.data.origin === 'legacy_unreconciled'
      );
      assert.strictEqual(bLegacyLots.length, 0);

      // Schedule 1 lesson cleanly for Student B so we also have an active lesson to test refund divergence on
      const schedB1 = await makeRequest(
        server,
        'POST',
        '/api/lessons/schedule',
        {
          requestId: 'lesson-nf2a-b-div-1',
          teacherUid: TEACHER_UID,
          startDateTime: '2026-12-20T14:00:00.000Z',
          endDateTime: '2026-12-20T14:50:00.000Z',
          title: 'B Divergence Test',
          isTrialLesson: false,
        },
        { Authorization: 'Bearer tok-student-b' }
      );
      assert.strictEqual(schedB1.status, 200);
      assert.strictEqual(schedB1.data.remainingLessons, 3);

      // Now simulate ledger corruption: externally overwrite availableLessons from 3 to 10 while creditLotsInitializedAt is set
      const bCorruptDoc = mockDb._getDoc('users', STUDENT_B_UID);
      mockDb._setDoc('users', STUDENT_B_UID, { ...bCorruptDoc, availableLessons: 10 });

      // 5a. Scheduling rejects with 409 CREDIT_LEDGER_DIVERGENCE
      const schedFail = await makeRequest(
        server,
        'POST',
        '/api/lessons/schedule',
        {
          requestId: 'lesson-nf2a-b-div-fail',
          teacherUid: TEACHER_UID,
          startDateTime: '2026-12-21T14:00:00.000Z',
          endDateTime: '2026-12-21T14:50:00.000Z',
          title: 'Should Fail',
          isTrialLesson: false,
        },
        { Authorization: 'Bearer tok-student-b' }
      );
      assert.strictEqual(schedFail.status, 409);
      assert.strictEqual(schedFail.data.code, 'CREDIT_LEDGER_DIVERGENCE');
      assert.strictEqual(mockDb._getDoc('lessons', 'lesson-nf2a-b-div-fail'), undefined);

      // 5b. Package grant rejects with 409 CREDIT_LEDGER_DIVERGENCE
      const grantFail = await makeRequest(
        server,
        'POST',
        '/api/admin/packages/grant',
        {
          studentUid: STUDENT_B_UID,
          teacherUid: TEACHER_UID,
          packageLessons: 1,
          idempotencyKey: 'nf2a-grant-b-div-fail',
        },
        { Authorization: 'Bearer tok-admin' }
      );
      assert.strictEqual(grantFail.status, 409);
      assert.strictEqual(grantFail.data.error, 'CREDIT_LEDGER_DIVERGENCE');

      // 5c. Admin adjust rejects with 409 CREDIT_LEDGER_DIVERGENCE
      const adjFail = await makeRequest(
        server,
        'POST',
        '/api/admin/credits/adjust',
        {
          studentUid: STUDENT_B_UID,
          delta: 1,
          reason: 'Should fail on divergence',
          idempotencyKey: 'nf2a-adj-b-div-fail',
        },
        { Authorization: 'Bearer tok-admin' }
      );
      assert.strictEqual(adjFail.status, 409);
      assert.strictEqual(adjFail.data.error, 'CREDIT_LEDGER_DIVERGENCE');

      // 5d. Cancel/not-completed/delete with refund also reject with 409 CREDIT_LEDGER_DIVERGENCE
      const cancelFail = await makeRequest(
        server,
        'POST',
        '/api/lessons/lesson-nf2a-b-div-1/cancel',
        { cancelledBy: 'teacher', reason: 'Should fail on divergence' },
        { Authorization: 'Bearer tok-teacher' }
      );
      assert.strictEqual(cancelFail.status, 409);
      assert.strictEqual(cancelFail.data.code, 'CREDIT_LEDGER_DIVERGENCE');

      // 5e. Post-initialization divergence when availableLessons is overwritten to 0 while lotsSum > 0 -> 409 CREDIT_LEDGER_DIVERGENCE (NOT 402)
      mockDb._setDoc('users', STUDENT_B_UID, { ...bCorruptDoc, availableLessons: 0 });
      const schedZeroDivergence = await makeRequest(
        server,
        'POST',
        '/api/lessons/schedule',
        {
          requestId: 'lesson-nf2a-b-div-zero',
          teacherUid: TEACHER_UID,
          startDateTime: '2026-12-21T16:00:00.000Z',
          endDateTime: '2026-12-21T16:50:00.000Z',
          title: 'Should Fail 409 Not 402',
          isTrialLesson: false,
        },
        { Authorization: 'Bearer tok-student-b' }
      );
      assert.strictEqual(schedZeroDivergence.status, 409);
      assert.strictEqual(schedZeroDivergence.data.code, 'CREDIT_LEDGER_DIVERGENCE');

      // 5f. Post-initialization divergence when availableLessons is missing/undefined on refund or adjust -> 409 CREDIT_LEDGER_DIVERGENCE
      const bWithoutAvail = { ...bCorruptDoc };
      delete bWithoutAvail.availableLessons;
      mockDb._setDoc('users', STUDENT_B_UID, bWithoutAvail);
      const adjMissingAvail = await makeRequest(
        server,
        'POST',
        '/api/admin/credits/adjust',
        {
          studentUid: STUDENT_B_UID,
          delta: 1,
          reason: 'Should fail when availableLessons missing post-init',
          idempotencyKey: 'nf2a-adj-b-missing-avail',
        },
        { Authorization: 'Bearer tok-admin' }
      );
      assert.strictEqual(adjMissingAvail.status, 409);
      assert.strictEqual(adjMissingAvail.data.error, 'CREDIT_LEDGER_DIVERGENCE');

      // Confirm NO silent legacy_unreconciled lot was materialized and NO silent self-correction happened!
      const bLotsAfter = mockDb._listCol('credit_lots').filter((d) => d.data.studentUid === STUDENT_B_UID);
      assert.strictEqual(bLotsAfter.length, 1);
      assert.strictEqual(bLotsAfter[0].data.origin, 'courtesy');

      // Restore B's availableLessons to 3 so B is clean for further checks
      mockDb._setDoc('users', STUDENT_B_UID, { ...mockDb._getDoc('users', STUDENT_B_UID), availableLessons: 3 });
    });

    // -----------------------------------------------------------------------
    // 6. Incomplete `activeCreditLotIds` index does NOT hide active courtesy lot
    // -----------------------------------------------------------------------
    await runTest('6. Índice activeCreditLotIds incompleto não oculta lote ativo nem distorce prioridade Q1', async () => {
      // Student A currently has 3 active lots: [adjCourtesyLotId (1), paidLot1Id (1), legacyLotId (1)]
      // Tamper activeCreditLotIds to ONLY include paidLot1Id (omitting adjCourtesyLotId & legacyLotId!)
      const aDoc = mockDb._getDoc('users', STUDENT_A_UID);
      mockDb._setDoc('users', STUDENT_A_UID, {
        ...aDoc,
        activeCreditLotIds: [paidLot1Id],
      });

      const res = await makeRequest(
        server,
        'POST',
        '/api/lessons/schedule',
        {
          requestId: 'lesson-nf2a-incomplete-index',
          teacherUid: TEACHER_UID,
          startDateTime: '2026-12-22T10:00:00.000Z',
          endDateTime: '2026-12-22T10:50:00.000Z',
          title: 'Incomplete Index Test',
          isTrialLesson: false,
        },
        { Authorization: 'Bearer tok-student-a' }
      );
      assert.strictEqual(res.status, 200, JSON.stringify(res.data));
      // Must STILL discover and consume adjCourtesyLotId first (courtesy -> paid -> legacy)!
      assert.strictEqual(res.data.lesson.creditLotId, adjCourtesyLotId);
      assert.strictEqual(res.data.remainingLessons, 2);

      // And activeCreditLotIds is transactionally repaired to [paidLot1Id, legacyLotId]
      assert.deepStrictEqual(
        mockDb._getDoc('users', STUDENT_A_UID).activeCreditLotIds,
        [paidLot1Id, legacyLotId]
      );
    });

    // -----------------------------------------------------------------------
    // 7. Global lot ID uniqueness across students + studentUid isolation guard + negative adjustment
    // -----------------------------------------------------------------------
    await runTest('7. Unicidade global de lotId entre alunos, isolamento studentUid e ajuste negativo Q1', async () => {
      const sharedIdempKey = 'shared-key-cross-student-1';

      // Grant 1 lesson to Student B & 1 lesson to Student C with identical idempotencyKey
      const idB = buildCreditLotId({ studentUid: STUDENT_B_UID, kind: 'grant', idempotencyKey: sharedIdempKey });
      const idC = buildCreditLotId({ studentUid: STUDENT_C_UID, kind: 'grant', idempotencyKey: sharedIdempKey });
      assert.notStrictEqual(idB, idC, 'Lot IDs must never collide across students even with same idempotencyKey');

      const gB = await makeRequest(
        server,
        'POST',
        '/api/admin/packages/grant',
        { studentUid: STUDENT_B_UID, teacherUid: TEACHER_UID, packageLessons: 1, idempotencyKey: sharedIdempKey },
        { Authorization: 'Bearer tok-admin' }
      );
      const gCConflict = await makeRequest(
        server,
        'POST',
        '/api/admin/packages/grant',
        { studentUid: STUDENT_C_UID, teacherUid: TEACHER_UID, packageLessons: 1, idempotencyKey: sharedIdempKey },
        { Authorization: 'Bearer tok-admin' }
      );
      assert.strictEqual(gB.status, 200);
      assert.strictEqual(gCConflict.status, 409);

      const gC = await makeRequest(
        server,
        'POST',
        '/api/admin/packages/grant',
        { studentUid: STUDENT_C_UID, teacherUid: TEACHER_UID, packageLessons: 1, idempotencyKey: 'nf2a-grant-c-1' },
        { Authorization: 'Bearer tok-admin' }
      );
      assert.strictEqual(gC.status, 200);
      assert.notStrictEqual(gB.data.transaction.creditLotId, gC.data.transaction.creditLotId);

      // Negative admin adjustment on Student A (-1) must consume paidLot1Id before legacyLotId (Q1)
      const negAdj = await makeRequest(
        server,
        'POST',
        '/api/admin/credits/adjust',
        {
          studentUid: STUDENT_A_UID,
          delta: -1,
          reason: 'Estorno administrativo manual',
          idempotencyKey: 'nf2a-neg-adj-a-1',
        },
        { Authorization: 'Bearer tok-admin' }
      );
      assert.strictEqual(negAdj.status, 200);
      assert.strictEqual(negAdj.data.availableLessons, 1);
      assert.strictEqual(negAdj.data.transaction.lotConsumptions[0].lotId, paidLot1Id);
      assert.strictEqual(mockDb._getDoc('credit_lots', paidLot1Id).remainingLessons, 0);
      assert.strictEqual(mockDb._getDoc('credit_lots', legacyLotId).remainingLessons, 1);

      // Cross-student isolation: tamper a lesson for Student A referencing Student C's creditLotId -> 409 CREDIT_LOT_ISOLATION_VIOLATION
      mockDb._setDoc('lessons', 'lesson-nf2a-cross-tamper', {
        id: 'lesson-nf2a-cross-tamper',
        studentUid: STUDENT_A_UID,
        studentEmail: 'student_a@itissimple.org',
        teacherUid: TEACHER_UID,
        teacherAuthUid: TEACHER_UID,
        teacherEmail: 'tutor@itissimple.org',
        status: 'scheduled',
        isTrialLesson: false,
        creditLotId: gC.data.transaction.creditLotId,
        startDateTime: '2026-12-23T10:00:00.000Z',
        endDateTime: '2026-12-23T10:50:00.000Z',
      });
      const isoFail = await makeRequest(
        server,
        'POST',
        '/api/lessons/lesson-nf2a-cross-tamper/cancel',
        { cancelledBy: 'teacher', reason: 'Attempt cross-student lot refund' },
        { Authorization: 'Bearer tok-teacher' }
      );
      assert.strictEqual(isoFail.status, 409);
      assert.strictEqual(isoFail.data.code, 'CREDIT_LOT_ISOLATION_VIOLATION');
      assert.strictEqual(mockDb._getDoc('credit_lots', gC.data.transaction.creditLotId).remainingLessons, 1);
    });

    // -----------------------------------------------------------------------
    // 8. Concurrent OCC scheduling on 1 credit & 25-min trial at 0 credits
    // -----------------------------------------------------------------------
    await runTest('8. Concorrência OCC (1 crédito para 2 agendamentos simultâneos) e trial 25-min com 0 créditos', async () => {
      // Student C currently has 1 credit (gC lot)
      const [cRes1, cRes2] = await Promise.all([
        makeRequest(
          server,
          'POST',
          '/api/lessons/schedule',
          {
            requestId: 'lesson-nf2a-conc-1',
            teacherUid: TEACHER_UID,
            startDateTime: '2026-12-24T10:00:00.000Z',
            endDateTime: '2026-12-24T10:50:00.000Z',
            title: 'Conc 1',
            isTrialLesson: false,
          },
          { Authorization: 'Bearer tok-student-c' }
        ),
        makeRequest(
          server,
          'POST',
          '/api/lessons/schedule',
          {
            requestId: 'lesson-nf2a-conc-2',
            teacherUid: TEACHER_UID,
            startDateTime: '2026-12-25T10:00:00.000Z',
            endDateTime: '2026-12-25T10:50:00.000Z',
            title: 'Conc 2',
            isTrialLesson: false,
          },
          { Authorization: 'Bearer tok-student-c' }
        ),
      ]);
      const statuses = [cRes1.status, cRes2.status].sort((a, b) => a - b);
      assert.deepStrictEqual(statuses, [200, 402], `Expected [200, 402], got ${JSON.stringify(statuses)}`);
      assert.strictEqual(mockDb._getDoc('users', STUDENT_C_UID).availableLessons, 0);

      // 25-min trial lesson with 0 credits continues working seamlessly without touching credit_lots
      const trialRes = await makeRequest(
        server,
        'POST',
        '/api/lessons/schedule',
        {
          requestId: 'lesson-nf2a-trial-0',
          teacherUid: TEACHER_UID,
          startDateTime: '2026-12-26T10:00:00.000Z',
          endDateTime: '2026-12-26T10:25:00.000Z',
          title: 'Trial 25 min',
          isTrialLesson: true,
        },
        { Authorization: 'Bearer tok-student-trial' }
      );
      assert.strictEqual(trialRes.status, 200);
      assert.strictEqual(trialRes.data.remainingLessons, 0);
      assert.strictEqual(trialRes.data.lesson.creditLotId, undefined);
      assert.strictEqual(mockDb._getDoc('users', STUDENT_TRIAL_UID).creditLotsInitializedAt, undefined);
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    resetFirebaseAdminFirestoreForTesting();
    resetFirebaseAdminForTesting();
    clearPtaxMemoryCache();
    resetInMemoryDbForTesting();
  }

  console.log(`\nNF.SWITCH.2A SUMMARY: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

runSuite().catch((err) => {
  console.error('Fatal NF.SWITCH.2A suite error:', err);
  process.exit(1);
});
