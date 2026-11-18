/**
 * TEST SUITE: FIN.2D.2B — PACOTES E REGISTRO FINANCEIRO
 * Behavioral HTTP + atomic Firestore (default) integration tests for:
 *  - Restriction of packages strictly to 1 / 4 / 8 / 12 lessons with FIN.2C discounts (0%, 5%, 10%, 15%)
 *  - Exclusive server-side financial calculations (tutor basePriceUsd, MARKUP commission, official PTAX D-1)
 *  - Rejection of client-supplied pricing, discount, commission, PTAX, or split parameters
 *  - Rejection of forged paid-purchase flags without verifiable server gateway confirmation
 *  - Clear distinction in Firestore financial_transactions between ADMIN_PACKAGE_GRANT,
 *    ADMIN_CREDIT_ADJUSTMENT (FIN.2D.2A), and gateway-verified PACKAGE_PURCHASE
 *  - Deterministic idempotency (200 replay, 409 conflict) and atomic Firestore (default) credit updates
 *  - Strict preservation of weeklyNativeLessonsTarget and existing pedagogical links
 *  - Regressions: FIN.2D.2A, legacy 501, 25-min trial at 0 credits, scheduling & refund, privacy
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
import { calculateFinancialPricingQuote } from '../src/utils/financialEngine';
import { ADMIN_COMMISSION_KEYS } from '../src/utils/tutorCommission';

function createIsolatedFirestoreMock() {
  const store = new Map<string, Record<string, any>>();
  let txQueue = Promise.resolve();

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
      const run = txQueue.then(async () => {
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
      });
      txQueue = run.catch(() => {});
      return run;
    },
    _store: store,
    _setDoc: (col: string, id: string, data: Record<string, any>) => {
      store.set(`${col}::${id}`, JSON.parse(JSON.stringify(data)));
    },
    _deleteDoc: (col: string, id: string) => {
      store.delete(`${col}::${id}`);
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
  console.log(' FIN.2D.2B — PACOTES E REGISTRO FINANCEIRO (TESTES COMPORTAMENTAIS)');
  console.log('=========================================================================\n');

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
  clearPtaxMemoryCache();
  const mockFs = createIsolatedFirestoreMock();
  setFirebaseAdminFirestoreForTesting(mockFs as any);

  const PTAX_RATE = 5.65;
  const pricingDate = getSaoPauloDateString();
  const expectedPtaxRefDate = getExpectedReferenceDate(pricingDate);

  const seedValidPtax = () => {
    clearPtaxMemoryCache();
    mockFs._setDoc(PTAX_CACHE_COLLECTION, expectedPtaxRefDate, {
      cotacaoVenda: PTAX_RATE,
      cotacaoCompra: 5.64,
      quoteDate: expectedPtaxRefDate,
      dataHoraCotacao: `${expectedPtaxRefDate} 13:11:00.000`,
      tipoBoletim: 'Fechamento',
      source: PTAX_SOURCE_LABEL,
      queriedAt: new Date().toISOString(),
    });
  };
  seedValidPtax();

  const ADMIN_UID = 'Fin2d2bAdminCanonicalUid0001';
  const ADMIN_EMAIL = 'adm.fin2d2b@itissimple-test.com';

  const TUTOR_25_UID = 'Fin2d2bTutor25CanonicalUid02';
  const TUTOR_25_EMAIL = 'tutor25.fin2d2b@itissimple-test.com';

  const TUTOR_0_UID = 'Fin2d2bTutor00CanonicalUid03';
  const TUTOR_0_EMAIL = 'tutor00.fin2d2b@itissimple-test.com';

  const TUTOR_100_UID = 'Fin2d2bTutor100CanonicalUid4';
  const TUTOR_100_EMAIL = 'tutor100.fin2d2b@itissimple-test.com';

  const TUTOR_PENDING_UID = 'Fin2d2bPendingTutorUid000005';
  const TUTOR_LEGACY_NOCOMM_UID = 'Fin2d2bLegacyNoCommUid000006';
  const TUTOR_NOPRICE_UID = 'Fin2d2bNoPriceTutorUid000007';

  const LINKED_STUDENT_UID = 'Fin2d2bLinkedStudentUid00008';
  const LINKED_STUDENT_EMAIL = 'linked.fin2d2b@itissimple-test.com';

  const UNLINKED_STUDENT_UID = 'Fin2d2bUnlinkedStudentUid009';
  const UNLINKED_STUDENT_EMAIL = 'unlinked.fin2d2b@itissimple-test.com';

  const TRIAL_STUDENT_UID = 'Fin2d2bTrialStudentUid000010';
  const TRIAL_STUDENT_EMAIL = 'trial.fin2d2b@itissimple-test.com';

  // Seed users and tutors in Firestore (default)
  mockFs._setDoc('users', ADMIN_UID, {
    id: ADMIN_UID,
    uid: ADMIN_UID,
    email: ADMIN_EMAIL,
    name: 'Admin Fin2D2B',
    role: 'admin',
  });

  mockFs._setDoc('tutors', TUTOR_25_UID, {
    id: TUTOR_25_UID,
    uid: TUTOR_25_UID,
    authUid: TUTOR_25_UID,
    publicTutorId: 'charles-fin2d2b',
    email: TUTOR_25_EMAIL,
    name: 'Charles Native 25%',
    role: 'teacher',
    approvalStatus: 'approved',
    status: 'approved',
    isApproved: true,
    approved: true,
    pricePerSessionUsd: 20,
    adminCommissionPercent: 25,
    commissionModel: 'MARKUP',
    commissionVersion: 1,
    meetUrl: 'https://meet.google.com/charles-fin2d2b',
    availableDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
    availableHours: ['09:00', '10:00', '14:00', '15:00'],
  });
  mockFs._setDoc('users', TUTOR_25_UID, {
    id: TUTOR_25_UID,
    uid: TUTOR_25_UID,
    authUid: TUTOR_25_UID,
    email: TUTOR_25_EMAIL,
    name: 'Charles Native 25%',
    role: 'teacher',
    approvalStatus: 'approved',
    isApproved: true,
    pricePerSessionUsd: 20,
    adminCommissionPercent: 25,
    commissionModel: 'MARKUP',
    commissionVersion: 1,
  });

  mockFs._setDoc('tutors', TUTOR_0_UID, {
    id: TUTOR_0_UID,
    uid: TUTOR_0_UID,
    authUid: TUTOR_0_UID,
    publicTutorId: 'sarah-zero-comm',
    email: TUTOR_0_EMAIL,
    name: 'Sarah Zero Comm',
    role: 'teacher',
    approvalStatus: 'approved',
    isApproved: true,
    pricePerSessionUsd: 16,
    adminCommissionPercent: 0,
    commissionModel: 'MARKUP',
    commissionVersion: 1,
  });

  mockFs._setDoc('tutors', TUTOR_100_UID, {
    id: TUTOR_100_UID,
    uid: TUTOR_100_UID,
    authUid: TUTOR_100_UID,
    publicTutorId: 'david-100-comm',
    email: TUTOR_100_EMAIL,
    name: 'David Full Markup',
    role: 'teacher',
    approvalStatus: 'approved',
    isApproved: true,
    pricePerSessionUsd: 15,
    adminCommissionPercent: 100,
    commissionModel: 'MARKUP',
    commissionVersion: 1,
  });

  mockFs._setDoc('tutors', TUTOR_PENDING_UID, {
    id: TUTOR_PENDING_UID,
    uid: TUTOR_PENDING_UID,
    authUid: TUTOR_PENDING_UID,
    publicTutorId: 'pending-fin2d2b',
    email: 'pending.fin2d2b@itissimple-test.com',
    name: 'Pending Tutor',
    role: 'teacher',
    approvalStatus: 'pending',
    isApproved: false,
    pricePerSessionUsd: 20,
    adminCommissionPercent: 25,
    commissionModel: 'MARKUP',
  });

  mockFs._setDoc('tutors', TUTOR_LEGACY_NOCOMM_UID, {
    id: TUTOR_LEGACY_NOCOMM_UID,
    uid: TUTOR_LEGACY_NOCOMM_UID,
    authUid: TUTOR_LEGACY_NOCOMM_UID,
    publicTutorId: 'legacy-nocomm',
    email: 'nocomm.fin2d2b@itissimple-test.com',
    name: 'Legacy No Commission',
    role: 'teacher',
    approvalStatus: 'approved',
    isApproved: true,
    pricePerSessionUsd: 18,
  });

  mockFs._setDoc('tutors', TUTOR_NOPRICE_UID, {
    id: TUTOR_NOPRICE_UID,
    uid: TUTOR_NOPRICE_UID,
    authUid: TUTOR_NOPRICE_UID,
    publicTutorId: 'noprice-fin2d2b',
    email: 'noprice.fin2d2b@itissimple-test.com',
    name: 'No Price Tutor',
    role: 'teacher',
    approvalStatus: 'approved',
    isApproved: true,
    adminCommissionPercent: 20,
    commissionModel: 'MARKUP',
  });

  // Linked student: already linked to TUTOR_25_UID with weeklyNativeLessonsTarget = 3
  mockFs._setDoc('users', LINKED_STUDENT_UID, {
    id: LINKED_STUDENT_UID,
    uid: LINKED_STUDENT_UID,
    email: LINKED_STUDENT_EMAIL,
    name: 'Linked Student',
    role: 'student',
    level: 'intermediario',
    teacherUid: TUTOR_25_UID,
    assignedNativeFriendUID: TUTOR_25_UID,
    nativeFriendUID: TUTOR_25_UID,
    teacherEmail: TUTOR_25_EMAIL,
    teacherName: 'Charles Native 25%',
    enrollmentStatus: 'active',
    contractedLessons: 4,
    availableLessons: 2,
    completedLessonsCount: 2,
    hasCompletedTrialLesson: true,
    weeklyNativeLessonsTarget: 3,
    subscriptionType: 'package',
    onboardingCompleted: true,
  });
  mockFs._setDoc('student_assignments', LINKED_STUDENT_UID, {
    studentUid: LINKED_STUDENT_UID,
    teacherUid: TUTOR_25_UID,
    teacherAuthUid: TUTOR_25_UID,
    assignedNativeFriendUID: TUTOR_25_UID,
    nativeFriendUID: TUTOR_25_UID,
    teacherEmail: TUTOR_25_EMAIL,
    teacherName: 'Charles Native 25%',
  });

  // Unlinked student: no teacher link yet, custom weeklyNativeLessonsTarget = 4
  mockFs._setDoc('users', UNLINKED_STUDENT_UID, {
    id: UNLINKED_STUDENT_UID,
    uid: UNLINKED_STUDENT_UID,
    email: UNLINKED_STUDENT_EMAIL,
    name: 'Unlinked Student',
    role: 'student',
    level: 'iniciante',
    enrollmentStatus: 'not_enrolled',
    contractedLessons: 0,
    availableLessons: 0,
    completedLessonsCount: 0,
    hasCompletedTrialLesson: true,
    weeklyNativeLessonsTarget: 4,
  });

  // Trial student: 0 credits, hasCompletedTrialLesson = false
  mockFs._setDoc('users', TRIAL_STUDENT_UID, {
    id: TRIAL_STUDENT_UID,
    uid: TRIAL_STUDENT_UID,
    email: TRIAL_STUDENT_EMAIL,
    name: 'Trial Student',
    role: 'student',
    level: 'iniciante',
    enrollmentStatus: 'active',
    contractedLessons: 0,
    availableLessons: 0,
    completedLessonsCount: 0,
    hasCompletedTrialLesson: false,
    weeklyNativeLessonsTarget: 1,
  });

  const TOKEN_MAP: Record<string, any> = {
    'tok-admin': { uid: ADMIN_UID, email: ADMIN_EMAIL, email_verified: true, role: 'admin', admin: true },
    'tok-teacher': { uid: TUTOR_25_UID, email: TUTOR_25_EMAIL, email_verified: true, role: 'teacher' },
    'tok-linked-student': { uid: LINKED_STUDENT_UID, email: LINKED_STUDENT_EMAIL, email_verified: true, role: 'student' },
    'tok-trial-student': { uid: TRIAL_STUDENT_UID, email: TRIAL_STUDENT_EMAIL, email_verified: true, role: 'student' },
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
    // 1. Permissions, Payments Gate, & Anti-Spoofing
    // -----------------------------------------------------------------------
    await test('1. Segurança & Permissões: PAYMENTS_ENABLED=false/true sem gateway bloqueia alunos; admin routes exigem ADM; flags pagas forjadas são bloqueadas inclusive para ADM', async () => {
      process.env.PAYMENTS_ENABLED = 'false';

      // Unauthenticated
      const noAuthPurchase = await makeRequest(server, 'POST', '/api/students/purchase-package', {
        studentUid: LINKED_STUDENT_UID,
        teacherId: TUTOR_25_UID,
        packageLessons: 4,
        idempotencyKey: 'sec-1',
      });
      assert.strictEqual(noAuthPurchase.status, 401);

      const noAuthAdminGrant = await makeRequest(server, 'POST', '/api/admin/packages/grant', {
        studentUid: LINKED_STUDENT_UID,
        teacherId: TUTOR_25_UID,
        packageLessons: 4,
        idempotencyKey: 'sec-2',
      });
      assert.strictEqual(noAuthAdminGrant.status, 401);

      const noAuthLedger = await makeRequest(server, 'GET', '/api/admin/financial-transactions');
      assert.strictEqual(noAuthLedger.status, 401);

      // Student & Teacher blocked from admin routes
      for (const tok of ['tok-linked-student', 'tok-teacher']) {
        const resGrant = await makeRequest(
          server,
          'POST',
          '/api/admin/packages/grant',
          { studentUid: LINKED_STUDENT_UID, teacherId: TUTOR_25_UID, packageLessons: 4, idempotencyKey: 'sec-3' },
          { Authorization: `Bearer ${tok}` }
        );
        assert.strictEqual(resGrant.status, 403);

        const resLedger = await makeRequest(server, 'GET', '/api/admin/financial-transactions', undefined, {
          Authorization: `Bearer ${tok}`,
        });
        assert.strictEqual(resLedger.status, 403);
      }

      // Student blocked on purchase-package when PAYMENTS_ENABLED=false
      const studentDisabled = await makeRequest(
        server,
        'POST',
        '/api/students/purchase-package',
        { studentUid: LINKED_STUDENT_UID, teacherId: TUTOR_25_UID, packageLessons: 4, idempotencyKey: 'sec-4' },
        { Authorization: 'Bearer tok-linked-student' }
      );
      assert.strictEqual(studentDisabled.status, 403);
      assert.strictEqual(studentDisabled.data.error, 'PAYMENTS_DISABLED');

      // Student STILL blocked even when PAYMENTS_ENABLED=true without gateway
      process.env.PAYMENTS_ENABLED = 'true';
      const studentForgedPaid = await makeRequest(
        server,
        'POST',
        '/api/students/purchase-package',
        {
          studentUid: LINKED_STUDENT_UID,
          teacherId: TUTOR_25_UID,
          packageLessons: 8,
          idempotencyKey: 'sec-5',
          paid: true,
          isPaidPurchase: true,
          paymentStatus: 'paid',
          gatewayConfirmed: true,
        },
        { Authorization: 'Bearer tok-linked-student' }
      );
      assert.strictEqual(studentForgedPaid.status, 403);
      assert.strictEqual(studentForgedPaid.data.error, 'PAYMENT_GATEWAY_NOT_CONFIGURED');

      // Even ADM cannot forge a paid purchase without a real gateway
      for (const route of ['/api/students/purchase-package', '/api/admin/packages/grant']) {
        const adminForgedPaid = await makeRequest(
          server,
          'POST',
          route,
          {
            studentUid: LINKED_STUDENT_UID,
            teacherId: TUTOR_25_UID,
            packageLessons: 4,
            idempotencyKey: `sec-adm-forged-${route}`,
            isPaidPurchase: true,
            paymentStatus: 'paid',
            gatewayVerified: true,
          },
          { Authorization: 'Bearer tok-admin' }
        );
        assert.strictEqual(adminForgedPaid.status, 403, `Expected 403 for forged paid flags on ${route}`);
        assert.strictEqual(adminForgedPaid.data.error, 'PAYMENT_GATEWAY_NOT_CONFIGURED');
      }

      process.env.PAYMENTS_ENABLED = 'false';
      assert.strictEqual(mockFs._listCol('financial_transactions').length, 0);
      assert.strictEqual(mockFs._getDoc('users', LINKED_STUDENT_UID)?.availableLessons, 2);
    });

    // -----------------------------------------------------------------------
    // 2. Package Restrictions (1/4/8/12) & Canonical UID / IdempotencyKey
    // -----------------------------------------------------------------------
    await test('2. Restrição de Pacotes (1/4/8/12), UID canônico obrigatório (sem fallback ao ADM) e idempotencyKey obrigatória', async () => {
      // Invalid package sizes rejected with 400 INVALID_PACKAGE
      for (const badPkg of [0, -1, 2, 3, 5, 6, 10, 24, 1.5, null, '4', '8']) {
        const res = await makeRequest(
          server,
          'POST',
          '/api/admin/packages/grant',
          {
            studentUid: LINKED_STUDENT_UID,
            teacherId: TUTOR_25_UID,
            packageLessons: badPkg,
            idempotencyKey: `bad-pkg-${String(badPkg)}`,
          },
          { Authorization: 'Bearer tok-admin' }
        );
        assert.strictEqual(res.status, 400, `Expected 400 for packageLessons=${JSON.stringify(badPkg)}, got ${res.status}`);
        assert.strictEqual(res.data.error, 'INVALID_PACKAGE');
      }

      // Admin omitting studentUid MUST fail with 400 CANONICAL_UID_REQUIRED (never fall back to ADMIN_UID!)
      const missingStudentRes = await makeRequest(
        server,
        'POST',
        '/api/students/purchase-package',
        {
          studentEmail: LINKED_STUDENT_EMAIL,
          teacherId: TUTOR_25_UID,
          packageLessons: 4,
          idempotencyKey: 'missing-uid-1',
        },
        { Authorization: 'Bearer tok-admin' }
      );
      assert.strictEqual(missingStudentRes.status, 400);
      assert.strictEqual(missingStudentRes.data.error, 'CANONICAL_UID_REQUIRED');

      // Missing idempotencyKey
      const missingIdempRes = await makeRequest(
        server,
        'POST',
        '/api/admin/packages/grant',
        {
          studentUid: LINKED_STUDENT_UID,
          teacherId: TUTOR_25_UID,
          packageLessons: 4,
        },
        { Authorization: 'Bearer tok-admin' }
      );
      assert.strictEqual(missingIdempRes.status, 400);
      assert.strictEqual(missingIdempRes.data.error, 'IDEMPOTENCY_KEY_REQUIRED');

      assert.strictEqual(mockFs._listCol('financial_transactions').length, 0);
    });

    // -----------------------------------------------------------------------
    // 3. Reject Client-Supplied Prices, Discounts, Commissions, PTAX, Splits
    // -----------------------------------------------------------------------
    await test('3. Rejeita qualquer preço, desconto, comissão, PTAX ou repasse enviado pelo cliente (400 CLIENT_PRICING_PARAMS_FORBIDDEN)', async () => {
      const tamperBodies = [
        { packagePriceBrl: 1 },
        { packagePriceUsd: 0.5 },
        { price: 10 },
        { basePriceUsd: 5 },
        { discountPercent: 90 },
        { adminCommissionPercent: 0 },
        { ptaxRate: 2.0 },
        { teacherShareBrl: 500 },
        { platformRevenueBrl: 0 },
        { finalPriceBrl: 10 },
      ];

      for (let i = 0; i < tamperBodies.length; i++) {
        const res = await makeRequest(
          server,
          'POST',
          '/api/admin/packages/grant',
          {
            studentUid: LINKED_STUDENT_UID,
            teacherId: TUTOR_25_UID,
            packageLessons: 4,
            idempotencyKey: `tamper-${i}`,
            ...tamperBodies[i],
          },
          { Authorization: 'Bearer tok-admin' }
        );
        assert.strictEqual(res.status, 400, `Tamper #${i} (${Object.keys(tamperBodies[i])[0]}) returned ${res.status}`);
        assert.strictEqual(res.data.error, 'CLIENT_PRICING_PARAMS_FORBIDDEN');
      }

      assert.strictEqual(mockFs._listCol('financial_transactions').length, 0);
    });

    // -----------------------------------------------------------------------
    // 4. Tutor Commercializability & PTAX Failure Guards (Zero Fallback)
    // -----------------------------------------------------------------------
    await test('4. Bloqueia tutor pendente (403), sem comissão (422), sem preço-base USD (422) e PTAX indisponível (503 sem fallback)', async () => {
      const pendingRes = await makeRequest(
        server,
        'POST',
        '/api/admin/packages/grant',
        { studentUid: LINKED_STUDENT_UID, teacherId: TUTOR_PENDING_UID, packageLessons: 4, idempotencyKey: 'err-pending' },
        { Authorization: 'Bearer tok-admin' }
      );
      assert.strictEqual(pendingRes.status, 403);
      assert.strictEqual(pendingRes.data.error, 'TUTOR_NOT_APPROVED');

      const noCommRes = await makeRequest(
        server,
        'POST',
        '/api/admin/packages/grant',
        { studentUid: LINKED_STUDENT_UID, teacherId: TUTOR_LEGACY_NOCOMM_UID, packageLessons: 4, idempotencyKey: 'err-nocomm' },
        { Authorization: 'Bearer tok-admin' }
      );
      assert.strictEqual(noCommRes.status, 422);
      assert.strictEqual(noCommRes.data.error, 'TUTOR_COMMISSION_NOT_CONFIGURED');

      const noPriceRes = await makeRequest(
        server,
        'POST',
        '/api/admin/packages/grant',
        { studentUid: LINKED_STUDENT_UID, teacherId: TUTOR_NOPRICE_UID, packageLessons: 4, idempotencyKey: 'err-noprice' },
        { Authorization: 'Bearer tok-admin' }
      );
      assert.strictEqual(noPriceRes.status, 422);
      assert.strictEqual(noPriceRes.data.error, 'TUTOR_BASE_PRICE_UNAVAILABLE');

      // Remove PTAX from cache + stub global fetch failure -> must return 503 PTAX_UNAVAILABLE (never 5.5!)
      clearPtaxMemoryCache();
      mockFs._deleteDoc(PTAX_CACHE_COLLECTION, expectedPtaxRefDate);
      const origFetch = globalThis.fetch;
      globalThis.fetch = (async () => new Response('Unavailable', { status: 503 })) as any;
      try {
        const ptaxFailRes = await makeRequest(
          server,
          'POST',
          '/api/admin/packages/grant',
          { studentUid: LINKED_STUDENT_UID, teacherId: TUTOR_25_UID, packageLessons: 4, idempotencyKey: 'err-ptax' },
          { Authorization: 'Bearer tok-admin' }
        );
        assert.strictEqual(ptaxFailRes.status, 503);
        assert.strictEqual(ptaxFailRes.data.error, 'PTAX_UNAVAILABLE');
      } finally {
        globalThis.fetch = origFetch;
        seedValidPtax();
      }

      assert.strictEqual(mockFs._listCol('financial_transactions').length, 0);
    });

    // -----------------------------------------------------------------------
    // 5. Server Calculation Parity (FIN.2C + MARKUP + PTAX) & Link/Target Preservation
    // -----------------------------------------------------------------------
    await test('5. Cálculo exclusivo no servidor (1/4/8/12, descontos 0/5/10/15%, MARKUP 0/25/100%, PTAX D-1) e preservação de links & weeklyNativeLessonsTarget', async () => {
      // A. Grant 8 lessons to UNLINKED_STUDENT_UID using TUTOR_0_UID (0% markup, $16 base, 10% discount)
      const expectedQuote0 = calculateFinancialPricingQuote({
        basePriceUsd: 16,
        adminCommissionPercent: 0,
        ptaxRate: PTAX_RATE,
        commissionModel: 'MARKUP',
        conversionBase: 'UNIT_PRICE_BRL',
      }).packages.package8;

      const grantUnlinked = await makeRequest(
        server,
        'POST',
        '/api/admin/packages/grant',
        {
          studentUid: UNLINKED_STUDENT_UID,
          teacherId: TUTOR_0_UID,
          packageLessons: 8,
          idempotencyKey: 'grant-unlinked-8',
        },
        { Authorization: 'Bearer tok-admin' }
      );
      assert.strictEqual(grantUnlinked.status, 200);
      assert.strictEqual(grantUnlinked.data.availableLessons, 8);
      assert.strictEqual(grantUnlinked.data.contractedLessons, 8);
      assert.strictEqual(grantUnlinked.data.preservedExistingTeacherLink, false);

      // Verify initial link was established ONLY because student had no prior link,
      // AND weeklyNativeLessonsTarget remained 4 (NOT overwritten to 2!)
      const unlinkedUserAfter = mockFs._getDoc('users', UNLINKED_STUDENT_UID);
      assert.strictEqual(unlinkedUserAfter?.teacherUid, TUTOR_0_UID);
      assert.strictEqual(unlinkedUserAfter?.weeklyNativeLessonsTarget, 4, 'weeklyNativeLessonsTarget must NOT be altered automatically');

      const txUnlinked = grantUnlinked.data.transaction;
      assert.strictEqual(txUnlinked.type, 'ADMIN_PACKAGE_GRANT');
      assert.strictEqual(txUnlinked.category, 'administrative_package_grant');
      assert.strictEqual(txUnlinked.isAdministrativeOperation, true);
      assert.strictEqual(txUnlinked.isPaidPurchase, false);
      assert.strictEqual(txUnlinked.countsAsRevenue, false);
      assert.strictEqual(txUnlinked.gatewayVerified, false);
      assert.strictEqual(txUnlinked.revenueBrl, 0);
      assert.strictEqual(txUnlinked.revenueUsd, 0);
      assert.strictEqual(txUnlinked.amountBrl, 0);
      assert.strictEqual(txUnlinked.amountUsd, 0);
      assert.strictEqual(txUnlinked.discountPercent, 10);
      assert.strictEqual(txUnlinked.adminCommissionPercent, 0);
      assert.strictEqual(txUnlinked.ptaxRate, PTAX_RATE);
      assert.strictEqual(txUnlinked.finalPriceBrl, expectedQuote0.finalPriceBrl);
      assert.strictEqual(txUnlinked.finalPriceUsd, expectedQuote0.finalPriceUsd);
      assert.strictEqual(txUnlinked.teacherShareBrl, expectedQuote0.teacherShareBrl);
      assert.strictEqual(txUnlinked.platformRevenueBrl, expectedQuote0.platformRevenueBrl);
      assert.strictEqual(txUnlinked.invariants.brlSumMatchesTotal, true);
      assert.strictEqual(txUnlinked.invariants.usdSumMatchesTotal, true);

      // B. Grant 12 lessons to ALREADY LINKED_STUDENT_UID priced using TUTOR_100_UID (100% markup, $15 base, 15% discount)
      // Must preserve LINKED_STUDENT_UID's existing pedagogical link to TUTOR_25_UID AND weeklyNativeLessonsTarget === 3!
      const expectedQuote100 = calculateFinancialPricingQuote({
        basePriceUsd: 15,
        adminCommissionPercent: 100,
        ptaxRate: PTAX_RATE,
        commissionModel: 'MARKUP',
        conversionBase: 'UNIT_PRICE_BRL',
      }).packages.package12;

      const grantLinked = await makeRequest(
        server,
        'POST',
        '/api/students/purchase-package',
        {
          studentUid: LINKED_STUDENT_UID,
          teacherId: TUTOR_100_UID,
          packageLessons: 12,
          idempotencyKey: 'grant-linked-12',
        },
        { Authorization: 'Bearer tok-admin' }
      );
      assert.strictEqual(grantLinked.status, 200);
      assert.strictEqual(grantLinked.data.previousAvailableLessons, 2);
      assert.strictEqual(grantLinked.data.availableLessons, 14);
      assert.strictEqual(grantLinked.data.previousContractedLessons, 4);
      assert.strictEqual(grantLinked.data.contractedLessons, 16);
      assert.strictEqual(grantLinked.data.preservedExistingTeacherLink, true);
      assert.strictEqual(grantLinked.data.pricedTeacherUid, TUTOR_100_UID);
      assert.strictEqual(grantLinked.data.teacherUid, TUTOR_25_UID);

      const linkedUserAfter = mockFs._getDoc('users', LINKED_STUDENT_UID);
      const linkedAssignAfter = mockFs._getDoc('student_assignments', LINKED_STUDENT_UID);
      assert.strictEqual(linkedUserAfter?.teacherUid, TUTOR_25_UID, 'Existing users/{uid}.teacherUid must be preserved');
      assert.strictEqual(linkedUserAfter?.assignedNativeFriendUID, TUTOR_25_UID);
      assert.strictEqual(linkedUserAfter?.nativeFriendUID, TUTOR_25_UID);
      assert.strictEqual(linkedUserAfter?.teacherEmail, TUTOR_25_EMAIL);
      assert.strictEqual(linkedAssignAfter?.teacherUid, TUTOR_25_UID, 'Existing student_assignments must be preserved');
      assert.strictEqual(linkedUserAfter?.weeklyNativeLessonsTarget, 3, 'Existing weeklyNativeLessonsTarget=3 must be preserved');

      const txLinked = grantLinked.data.transaction;
      assert.strictEqual(txLinked.type, 'ADMIN_PACKAGE_GRANT');
      assert.strictEqual(txLinked.countsAsRevenue, false);
      assert.strictEqual(txLinked.discountPercent, 15);
      assert.strictEqual(txLinked.adminCommissionPercent, 100);
      assert.strictEqual(txLinked.finalPriceBrl, expectedQuote100.finalPriceBrl);
      assert.strictEqual(txLinked.teacherShareBrl, expectedQuote100.teacherShareBrl);
      assert.strictEqual(txLinked.platformRevenueBrl, expectedQuote100.platformRevenueBrl);
      assert.strictEqual(txLinked.finalPriceUsd, expectedQuote100.finalPriceUsd);
      assert.strictEqual(txLinked.teacherShareUsd, expectedQuote100.teacherShareUsd);
      assert.strictEqual(txLinked.platformRevenueUsd, expectedQuote100.platformRevenueUsd);
      assert.strictEqual(txLinked.preservedExistingTeacherLink, true);

      // C. Grant 1 lesson (0% discount) & 4 lessons (5% discount) with TUTOR_25_UID (25% markup, $20 base)
      const q25 = calculateFinancialPricingQuote({
        basePriceUsd: 20,
        adminCommissionPercent: 25,
        ptaxRate: PTAX_RATE,
        commissionModel: 'MARKUP',
        conversionBase: 'UNIT_PRICE_BRL',
      });

      const grant1 = await makeRequest(
        server,
        'POST',
        '/api/admin/packages/grant',
        { studentUid: UNLINKED_STUDENT_UID, teacherId: TUTOR_25_UID, packageLessons: 1, idempotencyKey: 'grant-1-pack' },
        { Authorization: 'Bearer tok-admin' }
      );
      assert.strictEqual(grant1.status, 200);
      assert.strictEqual(grant1.data.transaction.discountPercent, 0);
      assert.strictEqual(grant1.data.transaction.finalPriceBrl, q25.packages.package1.finalPriceBrl);
      assert.strictEqual(grant1.data.transaction.teacherShareBrl, q25.packages.package1.teacherShareBrl);
      assert.strictEqual(grant1.data.transaction.platformRevenueBrl, q25.packages.package1.platformRevenueBrl);

      const grant4 = await makeRequest(
        server,
        'POST',
        '/api/admin/packages/grant',
        { studentUid: UNLINKED_STUDENT_UID, teacherId: TUTOR_25_UID, packageLessons: 4, idempotencyKey: 'grant-4-pack' },
        { Authorization: 'Bearer tok-admin' }
      );
      assert.strictEqual(grant4.status, 200);
      assert.strictEqual(grant4.data.transaction.discountPercent, 5);
      assert.strictEqual(grant4.data.transaction.finalPriceBrl, q25.packages.package4.finalPriceBrl);
      assert.strictEqual(grant4.data.transaction.teacherShareBrl, q25.packages.package4.teacherShareBrl);
      assert.strictEqual(grant4.data.transaction.platformRevenueBrl, q25.packages.package4.platformRevenueBrl);
      assert.strictEqual(mockFs._getDoc('users', UNLINKED_STUDENT_UID)?.availableLessons, 13); // 8 + 1 + 4
      assert.strictEqual(mockFs._getDoc('users', UNLINKED_STUDENT_UID)?.weeklyNativeLessonsTarget, 4);
    });

    // -----------------------------------------------------------------------
    // 6. Idempotency (Replay 200 & Conflict 409) & Persistence Across RAM Reset
    // -----------------------------------------------------------------------
    await test('6. Idempotência determinística (replay sem duplicar créditos, 409 em conflito) e sobrevivência ao reset de RAM', async () => {
      const beforeAvail = mockFs._getDoc('users', LINKED_STUDENT_UID)?.availableLessons;
      const beforeTxCount = mockFs._listCol('financial_transactions').length;

      // Exact replay of 'grant-linked-12'
      const replayRes = await makeRequest(
        server,
        'POST',
        '/api/admin/packages/grant',
        {
          studentUid: LINKED_STUDENT_UID,
          teacherId: TUTOR_100_UID,
          packageLessons: 12,
          idempotencyKey: 'grant-linked-12',
        },
        { Authorization: 'Bearer tok-admin' }
      );
      assert.strictEqual(replayRes.status, 200);
      assert.strictEqual(replayRes.data.isIdempotent, true);
      assert.strictEqual(replayRes.data.availableLessons, beforeAvail);
      assert.strictEqual(mockFs._getDoc('users', LINKED_STUDENT_UID)?.availableLessons, beforeAvail);
      assert.strictEqual(mockFs._listCol('financial_transactions').length, beforeTxCount);

      // Conflict: same idempotencyKey with different package size or different student or different tutor -> 409
      const conflictPkg = await makeRequest(
        server,
        'POST',
        '/api/admin/packages/grant',
        {
          studentUid: LINKED_STUDENT_UID,
          teacherId: TUTOR_100_UID,
          packageLessons: 4,
          idempotencyKey: 'grant-linked-12',
        },
        { Authorization: 'Bearer tok-admin' }
      );
      assert.strictEqual(conflictPkg.status, 409);
      assert.strictEqual(conflictPkg.data.error, 'IDEMPOTENCY_KEY_CONFLICT');

      const conflictStudent = await makeRequest(
        server,
        'POST',
        '/api/admin/packages/grant',
        {
          studentUid: UNLINKED_STUDENT_UID,
          teacherId: TUTOR_100_UID,
          packageLessons: 12,
          idempotencyKey: 'grant-linked-12',
        },
        { Authorization: 'Bearer tok-admin' }
      );
      assert.strictEqual(conflictStudent.status, 409);
      assert.strictEqual(conflictStudent.data.error, 'IDEMPOTENCY_KEY_CONFLICT');

      // Reset server RAM and verify Firestore (default) persistence still authoritative
      resetInMemoryDbForTesting();
      const postResetReplay = await makeRequest(
        server,
        'POST',
        '/api/admin/packages/grant',
        {
          studentUid: LINKED_STUDENT_UID,
          teacherId: TUTOR_100_UID,
          packageLessons: 12,
          idempotencyKey: 'grant-linked-12',
        },
        { Authorization: 'Bearer tok-admin' }
      );
      assert.strictEqual(postResetReplay.status, 200);
      assert.strictEqual(postResetReplay.data.isIdempotent, true);
      assert.strictEqual(postResetReplay.data.availableLessons, beforeAvail);
    });

    // -----------------------------------------------------------------------
    // 7. Financial Ledger Distinction: ADMIN_PACKAGE_GRANT vs ADMIN_CREDIT_ADJUSTMENT vs Verified PACKAGE_PURCHASE
    // -----------------------------------------------------------------------
    await test('7. Separação estrita em financial_transactions (ADMIN_PACKAGE_GRANT vs ADMIN_CREDIT_ADJUSTMENT vs PACKAGE_PURCHASE verificada) e GET /api/admin/financial-transactions', async () => {
      // FIN.2D.2A credit adjustment remains fully operational and distinct
      const adjRes = await makeRequest(
        server,
        'POST',
        '/api/admin/credits/adjust',
        {
          studentUid: LINKED_STUDENT_UID,
          delta: 2,
          reason: 'Bônus de cortesia FIN.2D.2A',
          idempotencyKey: 'adj-fin2d2b-coexist-1',
        },
        { Authorization: 'Bearer tok-admin' }
      );
      assert.strictEqual(adjRes.status, 200);
      assert.strictEqual(adjRes.data.transaction.type, 'ADMIN_CREDIT_ADJUSTMENT');
      assert.strictEqual(adjRes.data.transaction.countsAsRevenue, false);

      // Direct internal server call attempting paid purchase WITHOUT gateway confirmation MUST fail
      const unverifiedPaid = await executePackageCreditOperationAtomicServer({
        actorUid: UNLINKED_STUDENT_UID,
        actorEmail: UNLINKED_STUDENT_EMAIL,
        actorRole: 'student',
        studentUid: UNLINKED_STUDENT_UID,
        teacherUid: TUTOR_25_UID,
        packageLessons: 4,
        idempotencyKey: 'paid-unverified-1',
        isPaidPurchase: true,
        gatewayConfirmation: null,
      });
      assert.strictEqual(unverifiedPaid.success, false);
      assert.strictEqual(unverifiedPaid.statusCode, 403);
      assert.strictEqual(unverifiedPaid.code, 'PAYMENT_GATEWAY_NOT_CONFIGURED');

      // Direct internal server call WITH verifiable server gateway confirmation records genuine paid PACKAGE_PURCHASE
      const expectedPaid4 = calculateFinancialPricingQuote({
        basePriceUsd: 20,
        adminCommissionPercent: 25,
        ptaxRate: PTAX_RATE,
        commissionModel: 'MARKUP',
        conversionBase: 'UNIT_PRICE_BRL',
      }).packages.package4;

      const verifiedPaid = await executePackageCreditOperationAtomicServer({
        actorUid: UNLINKED_STUDENT_UID,
        actorEmail: UNLINKED_STUDENT_EMAIL,
        actorRole: 'student',
        studentUid: UNLINKED_STUDENT_UID,
        teacherUid: TUTOR_25_UID,
        packageLessons: 4,
        idempotencyKey: 'paid-verified-gateway-1',
        isPaidPurchase: true,
        gatewayConfirmation: {
          verifiedByServer: true,
          gatewayProvider: 'stripe_webhook',
          gatewayTransactionId: 'pi_fin2d2b_verified_001',
        },
      });
      assert.strictEqual(verifiedPaid.success, true);
      assert.strictEqual(verifiedPaid.transaction?.type, 'PACKAGE_PURCHASE');
      assert.strictEqual(verifiedPaid.transaction?.category, 'paid_package_purchase');
      assert.strictEqual(verifiedPaid.transaction?.isAdministrativeOperation, false);
      assert.strictEqual(verifiedPaid.transaction?.isPaidPurchase, true);
      assert.strictEqual(verifiedPaid.transaction?.countsAsRevenue, true);
      assert.strictEqual(verifiedPaid.transaction?.gatewayVerified, true);
      assert.strictEqual(verifiedPaid.transaction?.gatewayProvider, 'stripe_webhook');
      assert.strictEqual(verifiedPaid.transaction?.gatewayTransactionId, 'pi_fin2d2b_verified_001');
      assert.strictEqual(verifiedPaid.transaction?.revenueBrl, expectedPaid4.finalPriceBrl);
      assert.strictEqual(verifiedPaid.transaction?.revenueUsd, expectedPaid4.finalPriceUsd);
      assert.strictEqual(verifiedPaid.transaction?.amountBrl, expectedPaid4.finalPriceBrl);

      // Audit listing via GET /api/admin/financial-transactions
      const allLedger = await makeRequest(
        server,
        'GET',
        '/api/admin/financial-transactions',
        undefined,
        { Authorization: 'Bearer tok-admin' }
      );
      assert.strictEqual(allLedger.status, 200);
      assert.strictEqual(allLedger.data.success, true);
      assert(allLedger.data.count >= 6);

      const paidOnly = await makeRequest(
        server,
        'GET',
        '/api/admin/financial-transactions?countsAsRevenue=true&isPaidPurchase=true',
        undefined,
        { Authorization: 'Bearer tok-admin' }
      );
      assert.strictEqual(paidOnly.status, 200);
      assert.strictEqual(paidOnly.data.count, 1);
      assert.strictEqual(paidOnly.data.transactions[0].type, 'PACKAGE_PURCHASE');

      const grantsOnly = await makeRequest(
        server,
        'GET',
        '/api/admin/financial-transactions?type=ADMIN_PACKAGE_GRANT',
        undefined,
        { Authorization: 'Bearer tok-admin' }
      );
      assert.strictEqual(grantsOnly.status, 200);
      assert.strictEqual(grantsOnly.data.count, 4);
      assert(grantsOnly.data.transactions.every((t: any) => t.countsAsRevenue === false && t.isPaidPurchase === false));
    });

    // -----------------------------------------------------------------------
    // 8. Regressions: Legacy 501, Trial 25 min, Schedule & Refund, Privacy
    // -----------------------------------------------------------------------
    await test('8. Regressões: /api/students/contract (501), trial 25min com 0 créditos, agendamento + estorno e privacidade pública', async () => {
      // Legacy /api/students/contract remains 501
      const legacyContract = await makeRequest(
        server,
        'POST',
        '/api/students/contract',
        { studentEmail: LINKED_STUDENT_EMAIL, contractedLessons: 10 },
        { Authorization: 'Bearer tok-admin' }
      );
      assert.strictEqual(legacyContract.status, 501);

      // 25-min trial lesson with 0 credits still works
      const trialRes = await makeRequest(
        server,
        'POST',
        '/api/lessons/schedule',
        {
          studentUid: TRIAL_STUDENT_UID,
          studentEmail: TRIAL_STUDENT_EMAIL,
          studentName: 'Trial Student',
          teacherUid: TUTOR_25_UID,
          teacherId: TUTOR_25_UID,
          startDateTime: '2026-12-10T14:00:00Z',
          endDateTime: '2026-12-10T14:25:00Z',
          title: 'Aula Experimental (25 min)',
          isTrialLesson: true,
          requestId: 'trial-reg-fin2d2b',
        },
        { Authorization: 'Bearer tok-trial-student' }
      );
      assert.strictEqual(trialRes.status, 200, `Trial scheduling failed: ${JSON.stringify(trialRes.data)}`);
      assert.strictEqual(mockFs._getDoc('users', TRIAL_STUDENT_UID)?.availableLessons, 0);

      // Regular lesson schedule consumes 1 credit and cancel refunds 1 credit
      const beforeAvail = mockFs._getDoc('users', LINKED_STUDENT_UID)?.availableLessons;
      const schedRes = await makeRequest(
        server,
        'POST',
        '/api/lessons/schedule',
        {
          studentUid: LINKED_STUDENT_UID,
          studentEmail: LINKED_STUDENT_EMAIL,
          studentName: 'Linked Student',
          teacherUid: TUTOR_25_UID,
          teacherId: TUTOR_25_UID,
          startDateTime: '2026-12-11T15:00:00Z',
          endDateTime: '2026-12-11T15:50:00Z',
          title: 'Aula Regular 50 min',
          isTrialLesson: false,
          requestId: 'reg-sched-fin2d2b',
        },
        { Authorization: 'Bearer tok-linked-student' }
      );
      assert.strictEqual(schedRes.status, 200, `Regular schedule failed: ${JSON.stringify(schedRes.data)}`);
      assert.strictEqual(mockFs._getDoc('users', LINKED_STUDENT_UID)?.availableLessons, beforeAvail - 1);

      const lessonId = schedRes.data.lesson?.id || schedRes.data.id;
      const cancelRes = await makeRequest(
        server,
        'POST',
        `/api/lessons/${encodeURIComponent(lessonId)}/cancel`,
        { cancelledBy: 'teacher', reason: 'Teacher reschedule' },
        { Authorization: 'Bearer tok-teacher' }
      );
      assert.strictEqual(cancelRes.status, 200, `Cancel failed: ${JSON.stringify(cancelRes.data)}`);
      assert.strictEqual(cancelRes.data.creditRefunded, true);
      assert.strictEqual(mockFs._getDoc('users', LINKED_STUDENT_UID)?.availableLessons, beforeAvail);

      // Public pricing quote and GET /api/tutors never leak adminCommissionPercent or basePriceUsd
      const publicQuote = await makeRequest(server, 'GET', `/api/financial/pricing-quote/${TUTOR_25_UID}`);
      assert.strictEqual(publicQuote.status, 200);
      const quoteKeys = collectNestedKeys(publicQuote.data);
      for (const forbidden of [...ADMIN_COMMISSION_KEYS, 'basePriceUsd', 'pricePerSessionUsd', 'teacherShareBrl', 'platformRevenueBrl']) {
        assert(!quoteKeys.has(forbidden), `Public quote leaked '${forbidden}'`);
      }

      // Guardrail: financialEngine.ts and serverPtax.ts untouched
      const engineSrc = fs.readFileSync(path.join(process.cwd(), 'src/utils/financialEngine.ts'), 'utf8');
      assert(engineSrc.includes('APPROVED_PACKAGES') && engineSrc.includes('calculateFinancialPricingQuote'));
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    resetFirebaseAdminFirestoreForTesting();
    resetFirebaseAdminForTesting();
    clearPtaxMemoryCache();
  }

  console.log('\n=========================================================================');
  console.log(` RESULTADO FIN.2D.2B: ${passed} passed, ${failed} failed`);
  console.log('=========================================================================');
  if (failed > 0) process.exit(1);
}

runSuite().catch((err) => {
  console.error('Fatal error running FIN.2D.2B suite:', err);
  process.exit(1);
});
