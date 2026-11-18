/**
 * TEST SUITE: NF.SWITCH.2C.0 — RASTREABILIDADE EXATA EM CENTAVOS POR UNIDADE DE CRÉDITO
 * Behavioral + Unit + OCC Atomic Firestore validation tests covering:
 *  1. Deterministic per-unit cents distribution & coupled teacher/platform row conservation
 *  2. Exact cents persistence on new paid package purchases (PACKAGE_PURCHASE) & courtesy grants/adjustments (0 cents)
 *  3. Q1 Priority (courtesy -> paid -> legacy_unreconciled) & deterministic stable `creditUnitIndex` assignment
 *  4. Exact-unit refund (`refundedCreditUnitIndex`) & re-consumption without cent drift (cancel / not-completed / DELETE)
 *  5. Strict refusal of double-refund / out-of-bounds unit index (409 CREDIT_LEDGER_DIVERGENCE) & negative admin adjustment ledger
 *  6. Null-cents invariant on `legacy_unreconciled`, OCC concurrency safety, and student/teacher privacy boundary
 */

process.env.NODE_ENV = 'test';
process.env.FIREBASE_PROJECT_ID = 'itissimple-security-staging';
process.env.FIREBASE_DATABASE_ID = '(default)';
process.env.PAYMENTS_ENABLED = 'false';

import assert from 'assert';
import http from 'http';
import {
  app as serverApp,
  resetInMemoryDbForTesting,
  sanitizePackageTransactionForCaller,
} from '../serverApp';
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
  buildUnitCentsSchedule,
  CREDIT_LEDGER_DIVERGENCE_CODE,
  CreditLedgerError,
  distributeCentsDeterministically,
  refundUnitToExactLot,
  validateCreditLotsForStudent,
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

function assertLotCentsConservation(lot: CreditLot, label: string) {
  assert.strictEqual(
    lot.remainingLessons + lot.consumedLessons,
    lot.initialLessons,
    `${label}: remainingLessons + consumedLessons !== initialLessons`
  );
  if (lot.origin === 'legacy_unreconciled') {
    for (const key of [
      'totalPaidBrlCents',
      'totalPaidUsdCents',
      'teacherShareBrlCents',
      'teacherShareUsdCents',
      'platformRevenueBrlCents',
      'platformRevenueUsdCents',
      'remainingTotalPaidBrlCents',
      'consumedTotalPaidBrlCents',
      'unitCentsSchedule',
    ] as const) {
      assert.strictEqual(lot[key], null, `${label}: legacy_unreconciled.${key} must strictly be null`);
    }
    return;
  }

  assert.ok(Array.isArray(lot.unitCentsSchedule), `${label}: unitCentsSchedule must exist`);
  assert.strictEqual(lot.unitCentsSchedule!.length, lot.initialLessons);
  assert.ok(Array.isArray(lot.availableUnitIndices), `${label}: availableUnitIndices must exist`);
  assert.ok(Array.isArray(lot.consumedUnitIndices), `${label}: consumedUnitIndices must exist`);
  assert.strictEqual(lot.availableUnitIndices!.length, lot.remainingLessons);
  assert.strictEqual(lot.consumedUnitIndices!.length, lot.consumedLessons);

  const dims = [
    ['totalPaidBrlCents', 'remainingTotalPaidBrlCents', 'consumedTotalPaidBrlCents'],
    ['totalPaidUsdCents', 'remainingTotalPaidUsdCents', 'consumedTotalPaidUsdCents'],
    ['teacherShareBrlCents', 'remainingTeacherShareBrlCents', 'consumedTeacherShareBrlCents'],
    ['teacherShareUsdCents', 'remainingTeacherShareUsdCents', 'consumedTeacherShareUsdCents'],
    ['platformRevenueBrlCents', 'remainingPlatformRevenueBrlCents', 'consumedPlatformRevenueBrlCents'],
    ['platformRevenueUsdCents', 'remainingPlatformRevenueUsdCents', 'consumedPlatformRevenueUsdCents'],
  ] as const;

  for (const [totKey, remKey, consKey] of dims) {
    const tot = lot[totKey] as number;
    const rem = lot[remKey] as number;
    const cons = lot[consKey] as number;
    assert.ok(Number.isInteger(tot) && tot >= 0, `${label}: ${totKey} must be non-negative int`);
    assert.ok(Number.isInteger(rem) && rem >= 0, `${label}: ${remKey} must be non-negative int`);
    assert.ok(Number.isInteger(cons) && cons >= 0, `${label}: ${consKey} must be non-negative int`);
    assert.strictEqual(rem + cons, tot, `${label}: ${remKey}(${rem}) + ${consKey}(${cons}) !== ${totKey}(${tot})`);

    const expectedRem: number = lot.availableUnitIndices!.reduce<number>(
      (s, idx) => s + Number(lot.unitCentsSchedule![idx][totKey]),
      0
    );
    const expectedCons: number = lot.consumedUnitIndices!.reduce<number>(
      (s, idx) => s + Number(lot.unitCentsSchedule![idx][totKey]),
      0
    );
    assert.strictEqual(rem, expectedRem, `${label}: ${remKey} must match exact sum of availableUnitIndices`);
    assert.strictEqual(cons, expectedCons, `${label}: ${consKey} must match exact sum of consumedUnitIndices`);
  }
}

async function runSuite() {
  console.log('=========================================================================');
  console.log(' NF.SWITCH.2C.0 — RASTREABILIDADE EXATA EM CENTAVOS (TESTES DE INTEGRIDADE)');
  console.log('=========================================================================\n');

  resetInMemoryDbForTesting();
  clearPtaxMemoryCache();

  const mockDb = createOccFirestoreMock();
  setFirebaseAdminFirestoreForTesting(mockDb as any);

  const ADMIN_UID = 'adm_nf2c0_canonical_uid_0001';
  const TEACHER_UID = 'tut_nf2c0_canonical_uid_0001';
  const STUDENT_A_UID = 'std_nf2c0_canonical_uid_0001';
  const STUDENT_B_UID = 'std_nf2c0_canonical_uid_0002';
  const STUDENT_CONC_UID = 'std_nf2c0_canonical_uid_0003';

  const tokenUsers: Record<string, any> = {
    'tok-admin': { uid: ADMIN_UID, email: 'admin@itissimple.org', role: 'admin', email_verified: true },
    'tok-teacher': { uid: TEACHER_UID, email: 'tutor@itissimple.org', role: 'teacher', email_verified: true },
    'tok-student-a': { uid: STUDENT_A_UID, email: 'student_2c0_a@itissimple.org', role: 'student', email_verified: true },
    'tok-student-b': { uid: STUDENT_B_UID, email: 'student_2c0_b@itissimple.org', role: 'student', email_verified: true },
    'tok-student-conc': { uid: STUDENT_CONC_UID, email: 'student_2c0_c@itissimple.org', role: 'student', email_verified: true },
  };

  setFirebaseAdminAuthForTesting({
    verifyIdToken: async (token: string) => {
      const u = tokenUsers[token];
      if (!u) throw new Error('Invalid token');
      return u;
    },
  } as any);

  // Use PTAX 5.47 and pricePerSessionUsd 13 with 31% markup to guarantee odd remainder cents across 4 & 8 lessons
  const todaySp = getSaoPauloDateString(new Date());
  const expectedRef = getExpectedReferenceDate(todaySp);
  mockDb._setDoc(PTAX_CACHE_COLLECTION, expectedRef, {
    ptaxRate: 5.47,
    quoteDate: expectedRef,
    pricingDate: todaySp,
    source: PTAX_SOURCE_LABEL,
    fetchedAt: new Date().toISOString(),
  });

  mockDb._setDoc('users', ADMIN_UID, {
    uid: ADMIN_UID,
    id: ADMIN_UID,
    email: 'admin@itissimple.org',
    name: 'Admin NF2C0',
    role: 'admin',
  });
  const tutorBase = {
    uid: TEACHER_UID,
    id: TEACHER_UID,
    email: 'tutor@itissimple.org',
    name: 'Native Tutor NF2C0',
    role: 'teacher',
    approvalStatus: 'approved',
    isApproved: true,
    pricePerSessionUsd: 13,
    adminCommissionPercent: 31,
    commissionModel: 'MARKUP',
    commissionVersion: 1,
    isCommercializable: true,
    meetUrl: 'https://meet.google.com/nf2c0-room-tutor',
  };
  mockDb._setDoc('users', TEACHER_UID, tutorBase);
  mockDb._setDoc('tutors', TEACHER_UID, tutorBase);

  // Student A: brand new student starting at 0 credits (no legacy residue)
  mockDb._setDoc('users', STUDENT_A_UID, {
    uid: STUDENT_A_UID,
    id: STUDENT_A_UID,
    email: 'student_2c0_a@itissimple.org',
    name: 'Student 2C0 A',
    role: 'student',
    availableLessons: 0,
    contractedLessons: 0,
    hasCompletedTrialLesson: false,
    enrollmentStatus: 'active',
  });

  // Student B: starts with 1 pre-existing legacy credit + will mix courtesy, paid, legacy
  mockDb._setDoc('users', STUDENT_B_UID, {
    uid: STUDENT_B_UID,
    id: STUDENT_B_UID,
    email: 'student_2c0_b@itissimple.org',
    name: 'Student 2C0 B',
    role: 'student',
    availableLessons: 1,
    contractedLessons: 1,
    hasCompletedTrialLesson: false,
    enrollmentStatus: 'active',
  });

  // Student Conc: starts at 0 credits for concurrency + tamper tests
  mockDb._setDoc('users', STUDENT_CONC_UID, {
    uid: STUDENT_CONC_UID,
    id: STUDENT_CONC_UID,
    email: 'student_2c0_c@itissimple.org',
    name: 'Student 2C0 Conc',
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
    // 1. Deterministic cents distribution & coupled split row conservation
    // -----------------------------------------------------------------------
    await runTest('1. Distribuição determinística de centavos preserva soma por coluna e conservação por unidade (1, 4, 8, 12)', () => {
      // Non-divisible examples across 1, 4, 8, 12
      assert.deepStrictEqual(distributeCentsDeterministically(1299, 4), [325, 325, 325, 324]);
      assert.deepStrictEqual(distributeCentsDeterministically(1001, 8), [126, 125, 125, 125, 125, 125, 125, 125]);
      assert.deepStrictEqual(distributeCentsDeterministically(500, 1), [500]);

      // Coupled remainder test cases:
      // Case A: remTeacher (3) + remPlatform (2) = 5 >= unitsCount (4) -> wrap-around preserves row identity
      // Case B: remTeacher (1) + remPlatform (1) = 2 < unitsCount (4)
      const cases = [
        { lessonsCount: 1, totalPaidBrlCents: 9317, teacherShareBrlCents: 7112, platformRevenueBrlCents: 2205, totalPaidUsdCents: 1703, teacherShareUsdCents: 1300, platformRevenueUsdCents: 403 },
        { lessonsCount: 4, totalPaidBrlCents: 35413, teacherShareBrlCents: 27033, platformRevenueBrlCents: 8380, totalPaidUsdCents: 6475, teacherShareUsdCents: 4943, platformRevenueUsdCents: 1532 },
        { lessonsCount: 4, totalPaidBrlCents: 35414, teacherShareBrlCents: 27035, platformRevenueBrlCents: 8379, totalPaidUsdCents: 6474, teacherShareUsdCents: 4941, platformRevenueUsdCents: 1533 },
        { lessonsCount: 8, totalPaidBrlCents: 67119, teacherShareBrlCents: 51237, platformRevenueBrlCents: 15882, totalPaidUsdCents: 12271, teacherShareUsdCents: 9367, platformRevenueUsdCents: 2904 },
        { lessonsCount: 12, totalPaidBrlCents: 95123, teacherShareBrlCents: 72614, platformRevenueBrlCents: 22509, totalPaidUsdCents: 17391, teacherShareUsdCents: 13276, platformRevenueUsdCents: 4115 },
      ];

      for (const c of cases) {
        const schedule = buildUnitCentsSchedule(c);
        assert.strictEqual(schedule.length, c.lessonsCount);

        let sumTotBrl = 0;
        let sumTeachBrl = 0;
        let sumPlatBrl = 0;
        let sumTotUsd = 0;
        let sumTeachUsd = 0;
        let sumPlatUsd = 0;

        for (let i = 0; i < schedule.length; i++) {
          const u = schedule[i];
          assert.strictEqual(u.unitIndex, i);
          assert.strictEqual(
            u.totalPaidBrlCents,
            Number(u.teacherShareBrlCents) + Number(u.platformRevenueBrlCents),
            `BRL row conservation failed at unit ${i} for ${c.lessonsCount} lessons`
          );
          assert.strictEqual(
            u.totalPaidUsdCents,
            Number(u.teacherShareUsdCents) + Number(u.platformRevenueUsdCents),
            `USD row conservation failed at unit ${i} for ${c.lessonsCount} lessons`
          );
          sumTotBrl += Number(u.totalPaidBrlCents);
          sumTeachBrl += Number(u.teacherShareBrlCents);
          sumPlatBrl += Number(u.platformRevenueBrlCents);
          sumTotUsd += Number(u.totalPaidUsdCents);
          sumTeachUsd += Number(u.teacherShareUsdCents);
          sumPlatUsd += Number(u.platformRevenueUsdCents);
        }

        assert.strictEqual(sumTotBrl, c.totalPaidBrlCents);
        assert.strictEqual(sumTeachBrl, c.teacherShareBrlCents);
        assert.strictEqual(sumPlatBrl, c.platformRevenueBrlCents);
        assert.strictEqual(sumTotUsd, c.totalPaidUsdCents);
        assert.strictEqual(sumTeachUsd, c.teacherShareUsdCents);
        assert.strictEqual(sumPlatUsd, c.platformRevenueUsdCents);

        // Max 1 cent variance per column
        const brlVals = schedule.map((s) => Number(s.totalPaidBrlCents));
        assert.ok(Math.max(...brlVals) - Math.min(...brlVals) <= 1);
      }
    });

    // -----------------------------------------------------------------------
    // 2. Paid 4-lesson & 8-lesson package purchases store exact cents schedule
    // -----------------------------------------------------------------------
    let paidLot4Id = '';
    let paidLot8Id = '';

    await runTest('2. Compra paga (4 e 8 aulas) grava agenda unitária e saldos exatos em centavos no lote e na transação', async () => {
      const paid4 = await executePackageCreditOperationAtomicServer({
        actorUid: STUDENT_A_UID,
        actorEmail: 'student_2c0_a@itissimple.org',
        actorRole: 'student',
        studentUid: STUDENT_A_UID,
        teacherUid: TEACHER_UID,
        packageLessons: 4,
        idempotencyKey: 'nf2c0-paid-a-4',
        isPaidPurchase: true,
        gatewayConfirmation: {
          verifiedByServer: true,
          gatewayProvider: 'stripe',
          gatewayTransactionId: 'gw_nf2c0_paid_4',
        },
      });
      assert.strictEqual(paid4.success, true, paid4.error);
      paidLot4Id = paid4.transaction!.creditLotId;
      const lot4 = mockDb._getDoc('credit_lots', paidLot4Id) as CreditLot;

      assert.strictEqual(lot4.initialLessons, 4);
      assert.strictEqual(lot4.remainingLessons, 4);
      assert.strictEqual(lot4.consumedLessons, 0);
      assert.deepStrictEqual(lot4.availableUnitIndices, [0, 1, 2, 3]);
      assert.deepStrictEqual(lot4.consumedUnitIndices, []);
      assertLotCentsConservation(lot4, 'paidLot4 initial');

      // Check per-unit row conservation & remainder distribution on the actual priced package
      for (const u of lot4.unitCentsSchedule!) {
        assert.strictEqual(u.totalPaidBrlCents, Number(u.teacherShareBrlCents) + Number(u.platformRevenueBrlCents));
        assert.strictEqual(u.totalPaidUsdCents, Number(u.teacherShareUsdCents) + Number(u.platformRevenueUsdCents));
      }

      // Confirm transaction stores exact integer cents & sanitization hides revenue/share for student
      const tx4 = mockDb._getDoc('financial_transactions', paid4.transaction!.id);
      assert.strictEqual(tx4.totalPaidBrlCents, lot4.totalPaidBrlCents);
      assert.strictEqual(tx4.teacherShareBrlCents, lot4.teacherShareBrlCents);
      assert.strictEqual(tx4.platformRevenueBrlCents, lot4.platformRevenueBrlCents);
      assert.strictEqual(tx4.totalPaidUsdCents, lot4.totalPaidUsdCents);

      const sanitizedForStudent = sanitizePackageTransactionForCaller(tx4, false)!;
      assert.ok(sanitizedForStudent);
      assert.strictEqual(sanitizedForStudent.teacherShareBrlCents, undefined);
      assert.strictEqual(sanitizedForStudent.teacherShareUsdCents, undefined);
      assert.strictEqual(sanitizedForStudent.platformRevenueBrlCents, undefined);
      assert.strictEqual(sanitizedForStudent.platformRevenueUsdCents, undefined);

      // Also verify an 8-lesson paid purchase on Student Conc
      const paid8 = await executePackageCreditOperationAtomicServer({
        actorUid: STUDENT_CONC_UID,
        actorEmail: 'student_2c0_c@itissimple.org',
        actorRole: 'student',
        studentUid: STUDENT_CONC_UID,
        teacherUid: TEACHER_UID,
        packageLessons: 8,
        idempotencyKey: 'nf2c0-paid-c-8',
        isPaidPurchase: true,
        gatewayConfirmation: {
          verifiedByServer: true,
          gatewayProvider: 'stripe',
          gatewayTransactionId: 'gw_nf2c0_paid_8',
        },
      });
      assert.strictEqual(paid8.success, true, paid8.error);
      paidLot8Id = paid8.transaction!.creditLotId;
      const lot8 = mockDb._getDoc('credit_lots', paidLot8Id) as CreditLot;
      assert.strictEqual(lot8.initialLessons, 8);
      assert.deepStrictEqual(lot8.availableUnitIndices, [0, 1, 2, 3, 4, 5, 6, 7]);
      assertLotCentsConservation(lot8, 'paidLot8 initial');
    });

    // -----------------------------------------------------------------------
    // 3. Consume all 4 units of paidLot4 sequentially -> exact unit indices [0,1,2,3],
    //    exact refund of middle unitIndex=1 (not-completed) & unitIndex=2 (cancel),
    //    no cent drift, deterministic re-consumption of lowest index (1)
    // -----------------------------------------------------------------------
    await runTest('3. Consumo sequencial, estorno exato por unitIndex (1 e 2) e re-consumo sem desvio de centavos', async () => {
      const lot4Before = mockDb._getDoc('credit_lots', paidLot4Id) as CreditLot;
      const sched = lot4Before.unitCentsSchedule!;

      // Schedule 4 lessons -> consumes unitIndex 0, 1, 2, 3 in strict deterministic order
      for (let i = 0; i < 4; i++) {
        const day = String(10 + i).padStart(2, '0');
        const res = await makeRequest(
          server,
          'POST',
          '/api/lessons/schedule',
          {
            requestId: `lesson-2c0-a-${i}`,
            teacherUid: TEACHER_UID,
            startDateTime: `2026-12-${day}T10:00:00.000Z`,
            endDateTime: `2026-12-${day}T10:50:00.000Z`,
            title: `2C0 Lesson ${i}`,
            isTrialLesson: false,
          },
          { Authorization: 'Bearer tok-student-a' }
        );
        assert.strictEqual(res.status, 200, JSON.stringify(res.data));
        assert.strictEqual(res.data.lesson.creditLotId, paidLot4Id);
        assert.strictEqual(res.data.lesson.creditUnitIndex, i);
      }

      const lot4Exhausted = mockDb._getDoc('credit_lots', paidLot4Id) as CreditLot;
      assert.strictEqual(lot4Exhausted.remainingLessons, 0);
      assert.strictEqual(lot4Exhausted.consumedLessons, 4);
      assert.deepStrictEqual(lot4Exhausted.availableUnitIndices, []);
      assert.deepStrictEqual(lot4Exhausted.consumedUnitIndices, [0, 1, 2, 3]);
      assert.strictEqual(lot4Exhausted.remainingTotalPaidBrlCents, 0);
      assert.strictEqual(lot4Exhausted.consumedTotalPaidBrlCents, lot4Before.totalPaidBrlCents);
      assertLotCentsConservation(lot4Exhausted, 'paidLot4 exhausted');

      // Refund lesson at unitIndex=1 via teacher-fault not-completed
      const notCompRes = await makeRequest(
        server,
        'POST',
        '/api/lessons/lesson-2c0-a-1/not-completed',
        { responsible: 'teacher', reason: 'Teacher internet issue' },
        { Authorization: 'Bearer tok-teacher' }
      );
      assert.strictEqual(notCompRes.status, 200, JSON.stringify(notCompRes.data));
      assert.strictEqual(notCompRes.data.creditRefunded, true);

      const lesson1After = mockDb._getDoc('lessons', 'lesson-2c0-a-1');
      assert.strictEqual(lesson1After.refundedCreditLotId, paidLot4Id);
      assert.strictEqual(lesson1After.refundedCreditUnitIndex, 1);

      const lot4AfterRefund1 = mockDb._getDoc('credit_lots', paidLot4Id) as CreditLot;
      assert.deepStrictEqual(lot4AfterRefund1.availableUnitIndices, [1]);
      assert.deepStrictEqual(lot4AfterRefund1.consumedUnitIndices, [0, 2, 3]);
      // Remaining cents must match sched[1] EXACTLY (not sched[3], not average!)
      assert.strictEqual(lot4AfterRefund1.remainingTotalPaidBrlCents, sched[1].totalPaidBrlCents);
      assert.strictEqual(lot4AfterRefund1.remainingTeacherShareBrlCents, sched[1].teacherShareBrlCents);
      assert.strictEqual(lot4AfterRefund1.remainingPlatformRevenueBrlCents, sched[1].platformRevenueBrlCents);
      assert.strictEqual(lot4AfterRefund1.remainingTotalPaidUsdCents, sched[1].totalPaidUsdCents);
      assertLotCentsConservation(lot4AfterRefund1, 'paidLot4 after refund unit 1');

      // Refund lesson at unitIndex=2 via teacher cancel
      const cancel2Res = await makeRequest(
        server,
        'POST',
        '/api/lessons/lesson-2c0-a-2/cancel',
        { cancelledBy: 'teacher', reason: 'Teacher unavailable' },
        { Authorization: 'Bearer tok-teacher' }
      );
      assert.strictEqual(cancel2Res.status, 200, JSON.stringify(cancel2Res.data));
      assert.strictEqual(cancel2Res.data.creditRefunded, true);

      const lesson2After = mockDb._getDoc('lessons', 'lesson-2c0-a-2');
      assert.strictEqual(lesson2After.refundedCreditUnitIndex, 2);

      const lot4AfterRefund2 = mockDb._getDoc('credit_lots', paidLot4Id) as CreditLot;
      assert.deepStrictEqual(lot4AfterRefund2.availableUnitIndices, [1, 2]);
      assert.deepStrictEqual(lot4AfterRefund2.consumedUnitIndices, [0, 3]);
      assert.strictEqual(
        lot4AfterRefund2.remainingTotalPaidBrlCents,
        Number(sched[1].totalPaidBrlCents) + Number(sched[2].totalPaidBrlCents)
      );
      assert.strictEqual(
        lot4AfterRefund2.consumedTotalPaidBrlCents,
        Number(sched[0].totalPaidBrlCents) + Number(sched[3].totalPaidBrlCents)
      );
      assertLotCentsConservation(lot4AfterRefund2, 'paidLot4 after refund unit 2');

      // Idempotent repeat cancel does NOT double-refund
      const cancel2Repeat = await makeRequest(
        server,
        'POST',
        '/api/lessons/lesson-2c0-a-2/cancel',
        { cancelledBy: 'teacher', reason: 'Retry' },
        { Authorization: 'Bearer tok-teacher' }
      );
      assert.strictEqual(cancel2Repeat.status, 200);
      assert.strictEqual(cancel2Repeat.data.isIdempotent, true);
      assert.deepStrictEqual(
        (mockDb._getDoc('credit_lots', paidLot4Id) as CreditLot).availableUnitIndices,
        [1, 2]
      );

      // Re-schedule 1 lesson -> deterministically consumes lowest available index (unitIndex = 1)
      const reSchedRes = await makeRequest(
        server,
        'POST',
        '/api/lessons/schedule',
        {
          requestId: 'lesson-2c0-a-resched-1',
          teacherUid: TEACHER_UID,
          startDateTime: '2026-12-18T10:00:00.000Z',
          endDateTime: '2026-12-18T10:50:00.000Z',
          title: '2C0 Rescheduled Unit 1',
          isTrialLesson: false,
        },
        { Authorization: 'Bearer tok-student-a' }
      );
      assert.strictEqual(reSchedRes.status, 200);
      assert.strictEqual(reSchedRes.data.lesson.creditLotId, paidLot4Id);
      assert.strictEqual(reSchedRes.data.lesson.creditUnitIndex, 1);

      const lot4AfterResched = mockDb._getDoc('credit_lots', paidLot4Id) as CreditLot;
      assert.deepStrictEqual(lot4AfterResched.availableUnitIndices, [2]);
      assert.deepStrictEqual(lot4AfterResched.consumedUnitIndices, [0, 1, 3]);
      assert.strictEqual(lot4AfterResched.remainingTotalPaidBrlCents, sched[2].totalPaidBrlCents);
      assertLotCentsConservation(lot4AfterResched, 'paidLot4 after resched unit 1');

      // Student cancels lesson-2c0-a-0 -> NO credit or cents refund
      const studentCancelRes = await makeRequest(
        server,
        'POST',
        '/api/lessons/lesson-2c0-a-0/cancel',
        { cancelledBy: 'student', reason: 'Student busy' },
        { Authorization: 'Bearer tok-student-a' }
      );
      assert.strictEqual(studentCancelRes.status, 200);
      assert.strictEqual(studentCancelRes.data.creditRefunded, false);
      assert.deepStrictEqual(
        (mockDb._getDoc('credit_lots', paidLot4Id) as CreditLot).availableUnitIndices,
        [2]
      );

      // Admin DELETE on active lesson-2c0-a-resched-1 -> refunds exact unitIndex = 1
      const adminDelRes = await makeRequest(
        server,
        'DELETE',
        '/api/lessons/lesson-2c0-a-resched-1',
        {},
        { Authorization: 'Bearer tok-admin' }
      );
      assert.strictEqual(adminDelRes.status, 200);
      assert.strictEqual(adminDelRes.data.creditRefunded, true);
      const lot4AfterAdminDel = mockDb._getDoc('credit_lots', paidLot4Id) as CreditLot;
      assert.deepStrictEqual(lot4AfterAdminDel.availableUnitIndices, [1, 2]);
      assertLotCentsConservation(lot4AfterAdminDel, 'paidLot4 after admin DELETE');

      // Direct double-refund or wrong-index refund guard on refundUnitToExactLot -> 409 CREDIT_LEDGER_DIVERGENCE
      assert.throws(
        () =>
          refundUnitToExactLot({
            studentUid: STUDENT_A_UID,
            lots: [lot4AfterAdminDel],
            targetLotId: paidLot4Id,
            targetUnitIndex: 2, // already available!
            wasFirstInitialization: false,
            nextLotSequence: 10,
            nowIso: new Date().toISOString(),
          }),
        (err: any) => err instanceof CreditLedgerError && err.statusCode === 409 && err.code === CREDIT_LEDGER_DIVERGENCE_CODE
      );
      assert.throws(
        () =>
          refundUnitToExactLot({
            studentUid: STUDENT_A_UID,
            lots: [lot4AfterAdminDel],
            targetLotId: paidLot4Id,
            targetUnitIndex: 99, // out of bounds!
            wasFirstInitialization: false,
            nextLotSequence: 10,
            nowIso: new Date().toISOString(),
          }),
        (err: any) => err instanceof CreditLedgerError && err.statusCode === 409 && err.code === CREDIT_LEDGER_DIVERGENCE_CODE
      );
    });

    // -----------------------------------------------------------------------
    // 4. Q1 priority across Courtesy (0 cents), Paid (exact cents), Legacy (null cents)
    // -----------------------------------------------------------------------
    await runTest('4. Prioridade Q1 com cortesia (0 centavos), pago (centavos exatos) e legacy_unreconciled (null)', async () => {
      // Student B starts with 1 pre-existing legacy credit.
      // Step 1: Grant 1 courtesy package (triggers single-time legacy hydration + courtesy lot with 0 cents)
      const grantB = await makeRequest(
        server,
        'POST',
        '/api/admin/packages/grant',
        {
          studentUid: STUDENT_B_UID,
          teacherUid: TEACHER_UID,
          packageLessons: 1,
          idempotencyKey: 'nf2c0-grant-b-1',
        },
        { Authorization: 'Bearer tok-admin' }
      );
      assert.strictEqual(grantB.status, 200, JSON.stringify(grantB.data));
      const courtesyGrantLotId = grantB.data.transaction.creditLotId;

      // Step 2: Positive admin adjustment +1 (courtesy with 0 cents)
      const adjB = await makeRequest(
        server,
        'POST',
        '/api/admin/credits/adjust',
        {
          studentUid: STUDENT_B_UID,
          delta: 1,
          reason: 'Bônus cortesia 2C.0',
          idempotencyKey: 'nf2c0-adj-b-pos',
        },
        { Authorization: 'Bearer tok-admin' }
      );
      assert.strictEqual(adjB.status, 200);
      const courtesyAdjLotId = adjB.data.transaction.creditLotId;

      // Step 3: Paid 1-lesson package
      const paidB = await executePackageCreditOperationAtomicServer({
        actorUid: STUDENT_B_UID,
        actorEmail: 'student_2c0_b@itissimple.org',
        actorRole: 'student',
        studentUid: STUDENT_B_UID,
        teacherUid: TEACHER_UID,
        packageLessons: 1,
        idempotencyKey: 'nf2c0-paid-b-1',
        isPaidPurchase: true,
        gatewayConfirmation: {
          verifiedByServer: true,
          gatewayProvider: 'stripe',
          gatewayTransactionId: 'gw_nf2c0_paid_b1',
        },
      });
      assert.strictEqual(paidB.success, true);
      const paidBLotId = paidB.transaction!.creditLotId;

      const bLots = mockDb._listCol('credit_lots').filter((d) => d.data.studentUid === STUDENT_B_UID);
      const legacyBLotId = bLots.find((d) => d.data.origin === 'legacy_unreconciled')!.id;

      // Check initial invariants on all 4 lots
      for (const l of bLots) {
        assertLotCentsConservation(l.data as CreditLot, `Student B initial ${l.data.origin}`);
      }
      assert.strictEqual(mockDb._getDoc('credit_lots', courtesyGrantLotId).totalPaidBrlCents, 0);
      assert.strictEqual(mockDb._getDoc('credit_lots', courtesyAdjLotId).totalPaidBrlCents, 0);
      assert.strictEqual(mockDb._getDoc('credit_lots', legacyBLotId).totalPaidBrlCents, null);

      // Consume all 4 credits via scheduling -> verify exact Q1 order + creditUnitIndex=0 each
      const expectedLots = [courtesyGrantLotId, courtesyAdjLotId, paidBLotId, legacyBLotId];
      for (let i = 0; i < expectedLots.length; i++) {
        const day = String(20 + i).padStart(2, '0');
        const res = await makeRequest(
          server,
          'POST',
          '/api/lessons/schedule',
          {
            requestId: `lesson-2c0-b-q1-${i}`,
            teacherUid: TEACHER_UID,
            startDateTime: `2026-12-${day}T11:00:00.000Z`,
            endDateTime: `2026-12-${day}T11:50:00.000Z`,
            title: `2C0 B Q1 ${i}`,
            isTrialLesson: false,
          },
          { Authorization: 'Bearer tok-student-b' }
        );
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.data.lesson.creditLotId, expectedLots[i]);
        assert.strictEqual(res.data.lesson.creditUnitIndex, 0);
      }

      // Refund the legacy lesson -> legacy remains strictly null cents, unitIndex 0 restored
      const delLegacy = await makeRequest(
        server,
        'DELETE',
        '/api/lessons/lesson-2c0-b-q1-3',
        {},
        { Authorization: 'Bearer tok-admin' }
      );
      assert.strictEqual(delLegacy.status, 200);
      const legacyAfter = mockDb._getDoc('credit_lots', legacyBLotId) as CreditLot;
      assert.strictEqual(legacyAfter.remainingLessons, 1);
      assertLotCentsConservation(legacyAfter, 'Student B legacy after refund');
    });

    // -----------------------------------------------------------------------
    // 5. Negative admin adjustment persists exact unitIndices & cents in lotConsumptions
    // -----------------------------------------------------------------------
    await runTest('5. Ajuste negativo administrativo grava unitIndices, unitAllocations e centavos exatos em lotConsumptions', async () => {
      // Student Conc currently has paidLot8Id (8 units [0..7]). Consume unit 0 via lesson first,
      // then run negative adjustment delta: -2 -> must consume unitIndices [1, 2] cleanly.
      const s1 = await makeRequest(
        server,
        'POST',
        '/api/lessons/schedule',
        {
          requestId: 'lesson-2c0-conc-first',
          teacherUid: TEACHER_UID,
          startDateTime: '2026-12-26T12:00:00.000Z',
          endDateTime: '2026-12-26T12:50:00.000Z',
          title: '2C0 Conc First',
          isTrialLesson: false,
        },
        { Authorization: 'Bearer tok-student-conc' }
      );
      assert.strictEqual(s1.status, 200);
      assert.strictEqual(s1.data.lesson.creditUnitIndex, 0);

      const negRes = await makeRequest(
        server,
        'POST',
        '/api/admin/credits/adjust',
        {
          studentUid: STUDENT_CONC_UID,
          delta: -2,
          reason: 'Ajuste negativo 2C.0 com rastreabilidade em centavos',
          idempotencyKey: 'nf2c0-conc-neg-2',
        },
        { Authorization: 'Bearer tok-admin' }
      );
      assert.strictEqual(negRes.status, 200, JSON.stringify(negRes.data));
      assert.strictEqual(negRes.data.availableLessons, 5);

      const txConsumptions = negRes.data.transaction.lotConsumptions;
      assert.strictEqual(txConsumptions.length, 1);
      assert.strictEqual(txConsumptions[0].lotId, paidLot8Id);
      assert.deepStrictEqual(txConsumptions[0].unitIndices, [1, 2]);
      assert.strictEqual(txConsumptions[0].unitAllocations.length, 2);

      const lot8After = mockDb._getDoc('credit_lots', paidLot8Id) as CreditLot;
      const sched8 = lot8After.unitCentsSchedule!;
      assert.strictEqual(
        txConsumptions[0].totalPaidBrlCents,
        Number(sched8[1].totalPaidBrlCents) + Number(sched8[2].totalPaidBrlCents)
      );
      assert.strictEqual(
        txConsumptions[0].teacherShareBrlCents,
        Number(sched8[1].teacherShareBrlCents) + Number(sched8[2].teacherShareBrlCents)
      );
      assert.strictEqual(
        txConsumptions[0].platformRevenueBrlCents,
        Number(sched8[1].platformRevenueBrlCents) + Number(sched8[2].platformRevenueBrlCents)
      );
      assert.deepStrictEqual(lot8After.availableUnitIndices, [3, 4, 5, 6, 7]);
      assert.deepStrictEqual(lot8After.consumedUnitIndices, [0, 1, 2]);
      assertLotCentsConservation(lot8After, 'paidLot8 after negative adjustment');

      // Also adjust -4 so only 1 unit (unitIndex = 7) remains for OCC concurrency test below
      const negRes4 = await makeRequest(
        server,
        'POST',
        '/api/admin/credits/adjust',
        {
          studentUid: STUDENT_CONC_UID,
          delta: -4,
          reason: 'Deixar exatamente 1 crédito para teste OCC',
          idempotencyKey: 'nf2c0-conc-neg-4',
        },
        { Authorization: 'Bearer tok-admin' }
      );
      assert.strictEqual(negRes4.status, 200);
      assert.strictEqual(negRes4.data.availableLessons, 1);
      assert.deepStrictEqual(
        (mockDb._getDoc('credit_lots', paidLot8Id) as CreditLot).availableUnitIndices,
        [7]
      );
    });

    // -----------------------------------------------------------------------
    // 6. OCC concurrency on last unitIndex (7), validation guard, and privacy boundary
    // -----------------------------------------------------------------------
    await runTest('6. Concorrência OCC na última unidade, bloqueio de adulteração de centavos e fronteira de privacidade', async () => {
      const [r1, r2] = await Promise.all([
        makeRequest(
          server,
          'POST',
          '/api/lessons/schedule',
          {
            requestId: 'lesson-2c0-occ-1',
            teacherUid: TEACHER_UID,
            startDateTime: '2026-12-27T10:00:00.000Z',
            endDateTime: '2026-12-27T10:50:00.000Z',
            title: '2C0 OCC 1',
            isTrialLesson: false,
          },
          { Authorization: 'Bearer tok-student-conc' }
        ),
        makeRequest(
          server,
          'POST',
          '/api/lessons/schedule',
          {
            requestId: 'lesson-2c0-occ-2',
            teacherUid: TEACHER_UID,
            startDateTime: '2026-12-28T10:00:00.000Z',
            endDateTime: '2026-12-28T10:50:00.000Z',
            title: '2C0 OCC 2',
            isTrialLesson: false,
          },
          { Authorization: 'Bearer tok-student-conc' }
        ),
      ]);

      const statuses = [r1.status, r2.status].sort((a, b) => a - b);
      assert.deepStrictEqual(statuses, [200, 402]);
      const winner = r1.status === 200 ? r1 : r2;
      assert.strictEqual(winner.data.lesson.creditUnitIndex, 7);

      const lot8Final = mockDb._getDoc('credit_lots', paidLot8Id) as CreditLot;
      assert.strictEqual(lot8Final.remainingLessons, 0);
      assert.deepStrictEqual(lot8Final.availableUnitIndices, []);
      assert.deepStrictEqual(lot8Final.consumedUnitIndices, [0, 1, 2, 3, 4, 5, 6, 7]);
      assertLotCentsConservation(lot8Final, 'paidLot8 exhausted after OCC');

      // Tampering guard: breaking remaining + consumed !== total must throw CREDIT_LEDGER_DIVERGENCE
      const tamperedLot: CreditLot = {
        ...lot8Final,
        remainingTotalPaidBrlCents: 999,
      };
      assert.throws(
        () => validateCreditLotsForStudent(STUDENT_CONC_UID, [tamperedLot]),
        (err: any) => err instanceof CreditLedgerError && err.statusCode === 409 && err.code === CREDIT_LEDGER_DIVERGENCE_CODE
      );

      // Privacy boundary: student-visible lesson responses must NOT expose cents schedule / share / revenue / commission
      const studentLessonsRes = await makeRequest(
        server,
        'GET',
        '/api/lessons',
        undefined,
        { Authorization: 'Bearer tok-student-a' }
      );
      assert.strictEqual(studentLessonsRes.status, 200);
      const leakedKeys = collectNestedKeys(studentLessonsRes.data);
      for (const restricted of [
        ...ADMIN_COMMISSION_KEYS,
        'teacherShareBrl',
        'teacherShareUsd',
        'teacherShareBrlCents',
        'teacherShareUsdCents',
        'platformRevenueBrl',
        'platformRevenueUsd',
        'platformRevenueBrlCents',
        'platformRevenueUsdCents',
        'unitCentsSchedule',
      ]) {
        assert.strictEqual(leakedKeys.has(restricted), false, `Restricted key ${restricted} leaked to student`);
      }
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    resetFirebaseAdminFirestoreForTesting();
    resetFirebaseAdminForTesting();
    clearPtaxMemoryCache();
    resetInMemoryDbForTesting();
  }

  console.log(`\nNF.SWITCH.2C.0 SUMMARY: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

runSuite().catch((err) => {
  console.error('Fatal NF.SWITCH.2C.0 suite error:', err);
  process.exit(1);
});
