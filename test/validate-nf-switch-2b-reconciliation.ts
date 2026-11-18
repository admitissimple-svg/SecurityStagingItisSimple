/**
 * TEST SUITE: NF.SWITCH.2B — CONTROLLED ADMINISTRATIVE RECONCILIATION OF LEGACY CREDITS
 * Behavioral HTTP + Atomic Firestore (default) + ADM.OPS Zero-Inflation + SSR UI tests covering:
 *  1. Server-side RBAC 401/403 on GET pending, GET audits, POST reconcile
 *  2. Read-only pending detection (hydrated legacy lots & uninitialized pre-2A students) + evidence evaluation
 *  3. Paid reconciliation using verifiable historical evidence (no invented PTAX/commission/revenue; rejects invalid/wrong-student/wrong-teacher/override payloads)
 *  4. Courtesy reconciliation (zero revenue, zero payout obligation, mandatory justification)
 *  5. Partial & mixed (paid + courtesy) reconciliation preserving consumedLessons & Q1 consumption order
 *  6. Exact preservation of users/{studentUid}.availableLessons and contractedLessons
 *  7. Double financial attribution prevention (partial overflow, 2A package tx reuse, duplicate gateway receipt, concurrent reconciliations)
 *  8. Idempotency (missing 400, replay 200 isIdempotent=true, mismatch 409 IDEMPOTENCY_KEY_CONFLICT) & OCC concurrency conflicts
 *  9. Transaction rollback on Firestore failure & strict CREDIT_LEDGER_DIVERGENCE (409)
 * 10. Student isolation, ADM.OPS.1-3 zero-inflation invariant, privacy boundary, and SSR UI checks
 */

process.env.NODE_ENV = 'test';
process.env.FIREBASE_PROJECT_ID = 'itissimple-security-staging';
process.env.FIREBASE_DATABASE_ID = '(default)';
process.env.PAYMENTS_ENABLED = 'false';

import fs from 'fs';
import path from 'path';
import http from 'http';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { app as serverApp, resetInMemoryDbForTesting } from '../serverApp';
import {
  setFirebaseAdminFirestoreForTesting,
  resetFirebaseAdminFirestoreForTesting,
  executePackageCreditOperationAtomicServer,
  fetchAdminOperationsSourceDataFromFirestore,
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
import { buildAdminOperationsDashboard } from '../src/utils/adminOperationsAnalytics';
import { buildLegacyUnreconciledLotData, sortCreditLotsForConsumption } from '../src/utils/creditLots';
import { ADMIN_COMMISSION_KEYS } from '../src/utils/tutorCommission';
import { AdminOperationsDashboard } from '../src/components/AdminOperationsDashboard';
import { AdminLegacyCreditReconciliationModal } from '../src/components/AdminLegacyCreditReconciliationModal';
import type { CreditLot } from '../src/types';

let passed = 0;
let failed = 0;

function check(condition: boolean, name: string, detail?: string) {
  if (condition) {
    console.log(`  ✅ PASS: ${name}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${name}${detail ? ` (${detail})` : ''}`);
    failed++;
  }
}

function createOccFirestoreMock() {
  const store = new Map<string, { data: Record<string, any>; version: number }>();
  let txChain = Promise.resolve();
  let failNextCommit = false;

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
          let hasWritten = false;

          const tx = {
            get: async (ref: any) => {
              if (hasWritten) {
                throw new Error('Firestore transactions require all reads to be executed before all writes.');
              }
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
              hasWritten = true;
              staged.push({
                key: `${ref._col}::${ref._id}`,
                op: 'set',
                data: JSON.parse(JSON.stringify(data)),
                merge: Boolean(opts?.merge),
              });
            },
            update: (ref: any, data: Record<string, any>) => {
              hasWritten = true;
              staged.push({
                key: `${ref._col}::${ref._id}`,
                op: 'set',
                data: JSON.parse(JSON.stringify(data)),
                merge: true,
              });
            },
            delete: (ref: any) => {
              hasWritten = true;
              staged.push({
                key: `${ref._col}::${ref._id}`,
                op: 'delete',
              });
            },
          };

          const result = await fn(tx);

          if (failNextCommit) {
            failNextCommit = false;
            throw new Error('Simulated Firestore commit failure (rollback verification)');
          }

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
    _failNextCommit: () => {
      failNextCommit = true;
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
    _snapshotAll: () => JSON.stringify(Array.from(store.entries())),
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
  console.log('\n=========================================================================');
  console.log('🧪 TEST SUITE: NF.SWITCH.2B — CONCILIAÇÃO ADMINISTRATIVA DE CRÉDITOS LEGADOS');
  console.log('=========================================================================\n');

  resetInMemoryDbForTesting();
  clearPtaxMemoryCache();

  const mockDb = createOccFirestoreMock();
  setFirebaseAdminFirestoreForTesting(mockDb as any);

  const ADMIN_UID = 'adm_nf2b_canonical_uid_0001';
  const TEACHER_1_UID = 'tut_nf2b_canonical_uid_0001';
  const TEACHER_2_UID = 'tut_nf2b_canonical_uid_0002';
  const STUDENT_A_UID = 'std_nf2b_canonical_uid_0001'; // hydrated legacy lot (5 remaining, 1 consumed)
  const STUDENT_B_UID = 'std_nf2b_canonical_uid_0002'; // uninitialized pre-2A student (4 available)
  const STUDENT_C_UID = 'std_nf2b_canonical_uid_0003'; // 2A package student (4 available, test reusing 2A tx)
  const STUDENT_DIV_UID = 'std_nf2b_canonical_uid_0004'; // ledger divergence student

  const tokenUsers: Record<string, any> = {
    'tok-admin': { uid: ADMIN_UID, email: 'admin@itissimple.org', role: 'admin', email_verified: true },
    'tok-teacher-1': { uid: TEACHER_1_UID, email: 'tutor1@itissimple.org', role: 'teacher', email_verified: true },
    'tok-student-a': { uid: STUDENT_A_UID, email: 'alice_legacy@itissimple.org', role: 'student', email_verified: true },
    'tok-student-b': { uid: STUDENT_B_UID, email: 'bob_pre2a@itissimple.org', role: 'student', email_verified: true },
  };

  setFirebaseAdminAuthForTesting({
    verifyIdToken: async (token: string) => {
      const u = tokenUsers[token];
      if (!u) throw new Error('Invalid token');
      return u;
    },
  } as any);

  // Seed PTAX D-1 for 2A package setup
  const todaySp = getSaoPauloDateString(new Date());
  const expectedRef = getExpectedReferenceDate(todaySp);
  mockDb._setDoc(PTAX_CACHE_COLLECTION, expectedRef, {
    ptaxRate: 5.5,
    quoteDate: expectedRef,
    pricingDate: todaySp,
    source: PTAX_SOURCE_LABEL,
    fetchedAt: new Date().toISOString(),
  });

  // Seed Admin & Teachers
  mockDb._setDoc('users', ADMIN_UID, {
    uid: ADMIN_UID,
    email: 'admin@itissimple.org',
    name: 'System Admin',
    role: 'admin',
  });

  mockDb._setDoc('users', TEACHER_1_UID, {
    uid: TEACHER_1_UID,
    email: 'tutor1@itissimple.org',
    name: 'Sarah Johnson',
    role: 'teacher',
    country: 'United States',
    isApproved: true,
    approvalStatus: 'approved',
    pricePerSessionUsd: 20,
    adminCommissionPercent: 25,
    commissionModel: 'MARKUP',
    commissionVersion: 1,
    meetUrl: 'https://meet.google.com/abc-defg-hij',
  });
  mockDb._setDoc('tutors', TEACHER_1_UID, {
    uid: TEACHER_1_UID,
    email: 'tutor1@itissimple.org',
    name: 'Sarah Johnson',
    country: 'United States',
    isApproved: true,
    approvalStatus: 'approved',
    pricePerSessionUsd: 20,
    adminCommissionPercent: 25,
    commissionModel: 'MARKUP',
    commissionVersion: 1,
    meetUrl: 'https://meet.google.com/abc-defg-hij',
  });

  mockDb._setDoc('users', TEACHER_2_UID, {
    uid: TEACHER_2_UID,
    email: 'tutor2@itissimple.org',
    name: 'Liam Carter',
    role: 'teacher',
    country: 'Canada',
    isApproved: true,
    approvalStatus: 'approved',
    pricePerSessionUsd: 18,
    adminCommissionPercent: 20,
    commissionModel: 'MARKUP',
    commissionVersion: 1,
    meetUrl: 'https://meet.google.com/xyz-uvwx-yz1',
  });
  mockDb._setDoc('tutors', TEACHER_2_UID, {
    uid: TEACHER_2_UID,
    email: 'tutor2@itissimple.org',
    name: 'Liam Carter',
    country: 'Canada',
    isApproved: true,
    approvalStatus: 'approved',
    pricePerSessionUsd: 18,
    adminCommissionPercent: 20,
    commissionModel: 'MARKUP',
    commissionVersion: 1,
    meetUrl: 'https://meet.google.com/xyz-uvwx-yz1',
  });

  // Seed Student A: already hydrated with 1 legacy_unreconciled lot (initial=6, consumed=1, remaining=5)
  const legacyLotA: CreditLot = {
    ...buildLegacyUnreconciledLotData({
      studentUid: STUDENT_A_UID,
      studentEmail: 'alice_legacy@itissimple.org',
      lessonsCount: 6,
      lotSequence: 1,
      nowIso: '2026-10-01T10:00:00.000Z',
    }),
    remainingLessons: 5,
    consumedLessons: 1,
  };
  mockDb._setDoc('credit_lots', legacyLotA.id, legacyLotA);
  mockDb._setDoc('users', STUDENT_A_UID, {
    uid: STUDENT_A_UID,
    email: 'alice_legacy@itissimple.org',
    name: 'Alice Legacy',
    role: 'student',
    availableLessons: 5,
    contractedLessons: 6,
    creditLotsInitializedAt: '2026-10-01T10:00:00.000Z',
    activeCreditLotIds: [legacyLotA.id],
    creditLotSequence: 1,
    teacherUid: TEACHER_1_UID,
    teacherEmail: 'tutor1@itissimple.org',
    teacherName: 'Sarah Johnson',
  });

  // Historical verifiable paid tx for Student A (4 lessons, R$ 522.50, teacher1)
  mockDb._setDoc('financial_transactions', 'tx_hist_a_paid_4', {
    id: 'tx_hist_a_paid_4',
    type: 'PACKAGE_PURCHASE',
    category: 'paid_package_purchase',
    status: 'completed',
    studentUid: STUDENT_A_UID,
    studentEmail: 'alice_legacy@itissimple.org',
    teacherUid: TEACHER_1_UID,
    teacherEmail: 'tutor1@itissimple.org',
    teacherName: 'Sarah Johnson',
    packageName: 'Pacote 4 Aulas',
    packageLessons: 4,
    lessonsAdded: 4,
    isPaidPurchase: true,
    countsAsRevenue: true,
    basePriceUsd: 20,
    adminCommissionPercent: 25,
    commissionModel: 'MARKUP',
    commissionVersion: 1,
    ptaxRate: 5.5,
    ptaxQuoteDate: '2026-09-30',
    ptaxPricingDate: '2026-10-01',
    ptaxSource: 'BACEN_PTAX_D1',
    discountPercent: 5,
    finalPriceBrl: 522.5,
    finalPriceUsd: 95,
    effectiveLessonPriceBrl: 130.63,
    effectiveLessonPriceUsd: 23.75,
    teacherShareBrl: 418.0,
    teacherShareUsd: 76.0,
    platformRevenueBrl: 104.5,
    platformRevenueUsd: 19.0,
    gatewayProvider: 'stripe',
    gatewayTransactionId: 'pi_hist_alice_001',
    gatewayVerified: true,
    createdAt: '2026-10-01T09:50:00.000Z',
  });

  // Duplicate tx doc pointing to the SAME gateway receipt as tx_hist_a_paid_4 (must fail DOUBLE_ATTRIBUTION_PREVENTED!)
  mockDb._setDoc('financial_transactions', 'tx_hist_a_dup_gateway', {
    id: 'tx_hist_a_dup_gateway',
    type: 'PACKAGE_PURCHASE',
    category: 'paid_package_purchase',
    status: 'completed',
    studentUid: STUDENT_A_UID,
    studentEmail: 'alice_legacy@itissimple.org',
    teacherUid: TEACHER_1_UID,
    teacherEmail: 'tutor1@itissimple.org',
    teacherName: 'Sarah Johnson',
    packageLessons: 4,
    lessonsAdded: 4,
    isPaidPurchase: true,
    countsAsRevenue: true,
    finalPriceBrl: 522.5,
    gatewayProvider: 'stripe',
    gatewayTransactionId: 'pi_hist_alice_001',
    gatewayVerified: true,
    createdAt: '2026-10-01T09:51:00.000Z',
  });

  // Ineligible transactions for Student A:
  // 1) Admin non-revenue grant
  mockDb._setDoc('financial_transactions', 'tx_hist_a_admin_grant', {
    id: 'tx_hist_a_admin_grant',
    type: 'ADMIN_PACKAGE_GRANT',
    category: 'administrative_package_grant',
    status: 'completed',
    studentUid: STUDENT_A_UID,
    teacherUid: TEACHER_1_UID,
    packageLessons: 2,
    lessonsAdded: 2,
    isAdministrativeOperation: true,
    isPaidPurchase: false,
    countsAsRevenue: false,
    createdAt: '2026-10-02T10:00:00.000Z',
  });
  // 2) Cancelled / refunded tx
  mockDb._setDoc('financial_transactions', 'tx_hist_a_refunded', {
    id: 'tx_hist_a_refunded',
    type: 'PACKAGE_PURCHASE',
    status: 'refunded',
    studentUid: STUDENT_A_UID,
    teacherUid: TEACHER_1_UID,
    packageLessons: 4,
    lessonsAdded: 4,
    isPaidPurchase: true,
    countsAsRevenue: true,
    finalPriceBrl: 500,
    gatewayProvider: 'stripe',
    gatewayTransactionId: 'pi_refunded_999',
    gatewayVerified: true,
    createdAt: '2026-10-02T11:00:00.000Z',
  });
  // 3) Single-lesson historical paid tx for Student A (used to test exhaustion)
  mockDb._setDoc('financial_transactions', 'tx_hist_a_paid_1', {
    id: 'tx_hist_a_paid_1',
    type: 'PACKAGE_PURCHASE',
    status: 'completed',
    studentUid: STUDENT_A_UID,
    teacherUid: TEACHER_1_UID,
    packageLessons: 1,
    lessonsAdded: 1,
    isPaidPurchase: true,
    countsAsRevenue: true,
    finalPriceBrl: 120.0,
    gatewayProvider: 'pix',
    gatewayTransactionId: 'pix_alice_single_1',
    gatewayVerified: true,
    createdAt: '2026-10-03T10:00:00.000Z',
  });

  // Seed Student B: pre-2A uninitialized (creditLotsInitializedAt absent, availableLessons = 4, contractedLessons = 4)
  mockDb._setDoc('users', STUDENT_B_UID, {
    uid: STUDENT_B_UID,
    email: 'bob_pre2a@itissimple.org',
    name: 'Bob Pre2A',
    role: 'student',
    availableLessons: 4,
    contractedLessons: 4,
    teacherUid: TEACHER_1_UID,
    teacherEmail: 'tutor1@itissimple.org',
    teacherName: 'Sarah Johnson',
  });
  // Verifiable historical paid tx for Student B (only 2 lessons @ R$ 200.00 — leaves 2 legacy credits unreconciled or courtesy)
  // Deliberately omit ptaxRate & commission snapshot to verify we do NOT invent them!
  mockDb._setDoc('financial_transactions', 'tx_hist_b_paid_2', {
    id: 'tx_hist_b_paid_2',
    type: 'PACKAGE_PURCHASE',
    status: 'completed',
    studentUid: STUDENT_B_UID,
    studentEmail: 'bob_pre2a@itissimple.org',
    teacherUid: TEACHER_1_UID,
    teacherEmail: 'tutor1@itissimple.org',
    teacherName: 'Sarah Johnson',
    packageLessons: 2,
    lessonsAdded: 2,
    isPaidPurchase: true,
    countsAsRevenue: true,
    finalPriceBrl: 200.0,
    gatewayProvider: 'pix',
    gatewayTransactionId: 'pix_bob_002',
    gatewayVerified: true,
    createdAt: '2026-09-20T12:00:00.000Z',
  });

  // Seed Student C: already has a post-2A PACKAGE_PURCHASE (so tx cannot be reused to back legacy lots!)
  mockDb._setDoc('users', STUDENT_C_UID, {
    uid: STUDENT_C_UID,
    email: 'carol_2a@itissimple.org',
    name: 'Carol 2A',
    role: 'student',
    availableLessons: 2,
    contractedLessons: 2,
  });
  const pkg2aRes = await executePackageCreditOperationAtomicServer({
    actorUid: STUDENT_C_UID,
    actorEmail: 'carol_2a@itissimple.org',
    actorRole: 'student',
    studentUid: STUDENT_C_UID,
    studentEmail: 'carol_2a@itissimple.org',
    teacherUid: TEACHER_1_UID,
    packageLessons: 4,
    idempotencyKey: 'pkg_carol_2a_001',
    isPaidPurchase: true,
    gatewayConfirmation: {
      verifiedByServer: true,
      gatewayProvider: 'stripe',
      gatewayTransactionId: 'pi_carol_2a_001',
    },
  });
  check(pkg2aRes.success === true, 'Setup Student C: compra 2A + hidratação inicial 2 legados concluída');
  const carolTxId = pkg2aRes.transaction?.id;

  // Seed Student DIV: creditLotsInitializedAt set, availableLessons=5 vs lot sum=3 (CREDIT_LEDGER_DIVERGENCE)
  const divLot = buildLegacyUnreconciledLotData({
    studentUid: STUDENT_DIV_UID,
    studentEmail: 'div@itissimple.org',
    lessonsCount: 3,
    lotSequence: 1,
    nowIso: '2026-10-05T08:00:00.000Z',
  });
  mockDb._setDoc('credit_lots', divLot.id, divLot);
  mockDb._setDoc('users', STUDENT_DIV_UID, {
    uid: STUDENT_DIV_UID,
    email: 'div@itissimple.org',
    name: 'Div Student',
    role: 'student',
    availableLessons: 5,
    contractedLessons: 5,
    creditLotsInitializedAt: '2026-10-05T08:00:00.000Z',
    activeCreditLotIds: [divLot.id],
    creditLotSequence: 1,
  });

  const server = serverApp.listen(0);

  try {
    // -----------------------------------------------------------------------
    // 1. RBAC 401 / 403 ENFORCEMENT (ALL ROUTES)
    // -----------------------------------------------------------------------
    console.log('--- 1. RBAC 401/403 no Servidor ---');
    const unauthPending = await makeRequest(server, 'GET', '/api/admin/credit-reconciliation/pending');
    check(unauthPending.status === 401, 'GET /pending sem token retorna 401');

    const invalidAuthRecon = await makeRequest(
      server,
      'POST',
      '/api/admin/credit-reconciliation/reconcile',
      { studentUid: STUDENT_A_UID },
      { Authorization: 'Bearer invalid-tok' }
    );
    check(invalidAuthRecon.status === 401, 'POST /reconcile com token inválido retorna 401');

    const studentPending = await makeRequest(
      server,
      'GET',
      '/api/admin/credit-reconciliation/pending',
      undefined,
      { Authorization: 'Bearer tok-student-a' }
    );
    check(studentPending.status === 403, 'GET /pending com aluno retorna 403');

    const teacherAudits = await makeRequest(
      server,
      'GET',
      '/api/admin/credit-reconciliation/audits',
      undefined,
      { Authorization: 'Bearer tok-teacher-1' }
    );
    check(teacherAudits.status === 403, 'GET /audits com professor retorna 403');

    const teacherRecon = await makeRequest(
      server,
      'POST',
      '/api/admin/credit-reconciliation/reconcile',
      {
        studentUid: STUDENT_A_UID,
        idempotencyKey: 'rb-t1',
        justification: 'Tentativa indevida professor',
        allocations: [{ origin: 'courtesy', lessonsCount: 1 }],
      },
      { Authorization: 'Bearer tok-teacher-1' }
    );
    check(teacherRecon.status === 403, 'POST /reconcile com professor retorna 403');

    // -----------------------------------------------------------------------
    // 2. READ-ONLY PENDING & HISTORICAL EVIDENCES + ADM.OPS BASELINE SNAPSHOT
    // -----------------------------------------------------------------------
    console.log('\n--- 2. Consulta Somente-Leitura & Baseline ADM.OPS ---');
    const sourceBefore = await fetchAdminOperationsSourceDataFromFirestore();
    const opsBefore = buildAdminOperationsDashboard({
      transactions: sourceBefore.transactions,
      lessons: sourceBefore.lessons,
      tutors: sourceBefore.tutors,
      users: sourceBefore.users,
      studentAssignments: sourceBefore.studentAssignments,
    });

    const pendingRes = await makeRequest(
      server,
      'GET',
      '/api/admin/credit-reconciliation/pending',
      undefined,
      { Authorization: 'Bearer tok-admin' }
    );
    check(pendingRes.status === 200 && pendingRes.data?.success === true, 'GET /pending autenticado como ADM retorna 200');
    const pendingStudents: any[] = pendingRes.data?.students || [];
    const foundA = pendingStudents.find((s) => s.studentUid === STUDENT_A_UID);
    const foundB = pendingStudents.find((s) => s.studentUid === STUDENT_B_UID);
    const foundC = pendingStudents.find((s) => s.studentUid === STUDENT_C_UID);
    const foundDiv = pendingStudents.find((s) => s.studentUid === STUDENT_DIV_UID);

    check(Boolean(foundA && foundA.legacyRemainingLessons === 5 && foundA.legacyConsumedLessons === 1), 'Detecta Student A já hidratado (remaining=5, consumed=1)');
    check(Boolean(foundB && foundB.legacyRemainingLessons === 4 && foundB.requiresInitialHydration === true), 'Detecta Student B pré-2A aguardando hidratação única (remaining=4)');
    check(Boolean(foundC && foundC.legacyRemainingLessons === 2), 'Detecta Student C com 2 créditos legados além do pacote 2A');
    check(Boolean(foundDiv && foundDiv.hasLedgerDivergence === true), 'Sinaliza Student DIV com hasLedgerDivergence=true sem autocorrigir');
    check(
      !mockDb._getDoc('users', STUDENT_B_UID)?.creditLotsInitializedAt,
      'Consulta GET /pending é estritamente somente-leitura (não hidratou Student B)'
    );

    const evA_paid = foundA?.evidences?.find((e: any) => e.transactionId === 'tx_hist_a_paid_4');
    const evA_admin = foundA?.evidences?.find((e: any) => e.transactionId === 'tx_hist_a_admin_grant');
    const evA_refunded = foundA?.evidences?.find((e: any) => e.transactionId === 'tx_hist_a_refunded');
    check(evA_paid?.isEligibleForPaidReconciliation === true && evA_paid?.remainingBackableLessons === 4, 'Evidência paga histórica elegível com 4 aulas disponíveis p/ lastro');
    check(evA_admin?.isEligibleForPaidReconciliation === false, 'Operação administrativa sem receita marcada inelegível para paid');
    check(evA_refunded?.isEligibleForPaidReconciliation === false, 'Transação refunded marcada inelegível para paid');

    // -----------------------------------------------------------------------
    // 3. EVIDENCE VALIDATION & OVERRIDE REJECTION CHECKS
    // -----------------------------------------------------------------------
    console.log('\n--- 3. Bloqueios de Evidência Insuficiente, Overrides e Isolamento ---');
    const missingIdemp = await makeRequest(
      server,
      'POST',
      '/api/admin/credit-reconciliation/reconcile',
      {
        studentUid: STUDENT_A_UID,
        justification: 'Sem chave idempotency',
        allocations: [{ origin: 'courtesy', lessonsCount: 1 }],
      },
      { Authorization: 'Bearer tok-admin' }
    );
    check(missingIdemp.status === 400 && missingIdemp.data?.error === 'IDEMPOTENCY_KEY_REQUIRED', 'Rejeita falta de idempotencyKey com 400');

    const paidNoEvidence = await makeRequest(
      server,
      'POST',
      '/api/admin/credit-reconciliation/reconcile',
      {
        studentUid: STUDENT_A_UID,
        idempotencyKey: 'fail-no-ev',
        justification: 'Tentativa paid sem evidência',
        allocations: [{ origin: 'paid', lessonsCount: 1, teacherUid: TEACHER_1_UID }],
      },
      { Authorization: 'Bearer tok-admin' }
    );
    check(paidNoEvidence.status === 400 && paidNoEvidence.data?.error === 'FINANCIAL_EVIDENCE_REQUIRED', 'Rejeita paid sem evidência financeira com 400');

    const clientOverrideAttempt = await makeRequest(
      server,
      'POST',
      '/api/admin/credit-reconciliation/reconcile',
      {
        studentUid: STUDENT_A_UID,
        idempotencyKey: 'fail-override',
        justification: 'Tentativa inventar PTAX',
        allocations: [
          {
            origin: 'paid',
            lessonsCount: 1,
            sourceTransactionId: 'tx_hist_a_paid_4',
            teacherUid: TEACHER_1_UID,
            ptaxRate: 9.99,
          },
        ],
      },
      { Authorization: 'Bearer tok-admin' }
    );
    check(clientOverrideAttempt.status === 400 && clientOverrideAttempt.data?.error === 'CLIENT_FINANCIAL_OVERRIDE_FORBIDDEN', 'Bloqueia tentativa de inventar/sobrescrever PTAX/preço/comissão no payload');

    const wrongStudentTx = await makeRequest(
      server,
      'POST',
      '/api/admin/credit-reconciliation/reconcile',
      {
        studentUid: STUDENT_A_UID,
        idempotencyKey: 'fail-wrong-student',
        justification: 'Tentativa usar tx de outro aluno',
        allocations: [
          {
            origin: 'paid',
            lessonsCount: 1,
            sourceTransactionId: 'tx_hist_b_paid_2',
            teacherUid: TEACHER_1_UID,
          },
        ],
      },
      { Authorization: 'Bearer tok-admin' }
    );
    check(wrongStudentTx.status === 422 && wrongStudentTx.data?.error === 'EVIDENCE_STUDENT_MISMATCH', 'Bloqueia isolamento: transação de Student B não pode lastrear Student A');

    const wrongTeacherTx = await makeRequest(
      server,
      'POST',
      '/api/admin/credit-reconciliation/reconcile',
      {
        studentUid: STUDENT_A_UID,
        idempotencyKey: 'fail-wrong-teacher',
        justification: 'Tentativa professor divergente',
        allocations: [
          {
            origin: 'paid',
            lessonsCount: 1,
            sourceTransactionId: 'tx_hist_a_paid_4',
            teacherUid: TEACHER_2_UID,
          },
        ],
      },
      { Authorization: 'Bearer tok-admin' }
    );
    check(wrongTeacherTx.status === 422 && wrongTeacherTx.data?.error === 'EVIDENCE_TEACHER_MISMATCH', 'Bloqueia divergência de professor entre evidência e confirmação');

    const adminGrantAsPaid = await makeRequest(
      server,
      'POST',
      '/api/admin/credit-reconciliation/reconcile',
      {
        studentUid: STUDENT_A_UID,
        idempotencyKey: 'fail-admin-grant',
        justification: 'Tentativa usar concessão admin como paid',
        allocations: [
          {
            origin: 'paid',
            lessonsCount: 1,
            sourceTransactionId: 'tx_hist_a_admin_grant',
            teacherUid: TEACHER_1_UID,
          },
        ],
      },
      { Authorization: 'Bearer tok-admin' }
    );
    check(adminGrantAsPaid.status === 422 && adminGrantAsPaid.data?.error === 'EVIDENCE_ADMIN_NON_REVENUE', 'Bloqueia uso de ADMIN_PACKAGE_GRANT como evidência paid');

    const courtesyWithTx = await makeRequest(
      server,
      'POST',
      '/api/admin/credit-reconciliation/reconcile',
      {
        studentUid: STUDENT_A_UID,
        idempotencyKey: 'fail-courtesy-tx',
        justification: 'Cortesia não deve vincular tx',
        allocations: [
          { origin: 'courtesy', lessonsCount: 1, sourceTransactionId: 'tx_hist_a_paid_4' },
        ],
      },
      { Authorization: 'Bearer tok-admin' }
    );
    check(courtesyWithTx.status === 400 && courtesyWithTx.data?.error === 'COURTESY_CANNOT_BIND_PAYMENT_EVIDENCE', 'Cortesia não aceita vínculo financeiro');

    // -----------------------------------------------------------------------
    // 4. PARTIAL + MIXED RECONCILIATION (PAID + COURTESY) + IDEMPOTENCY
    // -----------------------------------------------------------------------
    console.log('\n--- 4. Conciliação Parcial + Mista, Preservação de Saldo & Idempotência ---');
    const mixedPayload = {
      studentUid: STUDENT_A_UID,
      idempotencyKey: 'recon_a_mixed_001',
      justification: 'Conciliação parcial 2 pagas (tx_hist_a_paid_4) + 1 cortesia bonificada',
      expectedLegacyRemainingLessons: 5,
      allocations: [
        {
          origin: 'paid',
          lessonsCount: 2,
          sourceTransactionId: 'tx_hist_a_paid_4',
          teacherUid: TEACHER_1_UID,
        },
        {
          origin: 'courtesy',
          lessonsCount: 1,
        },
      ],
    };

    const mixedRes = await makeRequest(
      server,
      'POST',
      '/api/admin/credit-reconciliation/reconcile',
      mixedPayload,
      { Authorization: 'Bearer tok-admin' }
    );
    check(mixedRes.status === 200 && mixedRes.data?.success === true && mixedRes.data?.isIdempotent === false, 'Conciliação parcial + mista (2 paid + 1 courtesy de 5 legados) executada com 200');
    check(mixedRes.data?.availableLessonsBefore === 5 && mixedRes.data?.availableLessonsAfter === 5, 'availableLessons de Student A preservado exatamente em 5');
    check(
      mockDb._getDoc('users', STUDENT_A_UID)?.availableLessons === 5 &&
        mockDb._getDoc('users', STUDENT_A_UID)?.contractedLessons === 6,
      'Firestore users/{studentUid} mantém availableLessons=5 e contractedLessons=6'
    );
    check(
      mixedRes.data?.legacyLot?.remainingLessons === 2 &&
        mixedRes.data?.legacyLot?.consumedLessons === 1 &&
        mixedRes.data?.legacyLot?.initialLessons === 3 &&
        mixedRes.data?.legacyLot?.status === 'active',
      'Lote legacy_unreconciled restante atualizado preservando consumedLessons=1 e invariante initial(3)=remaining(2)+consumed(1)'
    );

    const createdPaidLot: CreditLot = mixedRes.data?.createdLots?.find((l: any) => l.origin === 'paid');
    const createdCourtesyLot: CreditLot = mixedRes.data?.createdLots?.find((l: any) => l.origin === 'courtesy');
    check(
      Boolean(
        createdPaidLot &&
          createdPaidLot.sourceType === 'LEGACY_RECONCILIATION_PAID' &&
          createdPaidLot.remainingLessons === 2 &&
          createdPaidLot.totalPaidBrl === 261.25 &&
          createdPaidLot.teacherShareBrl === 209 &&
          createdPaidLot.platformRevenueBrl === 52.25 &&
          createdPaidLot.ptaxRate === 5.5 &&
          createdPaidLot.reconciledFromLotId === legacyLotA.id &&
          createdPaidLot.reconciliationAuditId === mixedRes.data?.audit?.id
      ),
      'Lote paid conciliado recebeu valor proporcional exato (2/4 = R$ 261,25) e rastreabilidade do lote de origem'
    );
    check(
      Boolean(
        createdCourtesyLot &&
          createdCourtesyLot.sourceType === 'LEGACY_RECONCILIATION_COURTESY' &&
          createdCourtesyLot.remainingLessons === 1 &&
          createdCourtesyLot.totalPaidBrl === 0 &&
          createdCourtesyLot.teacherShareBrl === 0 &&
          createdCourtesyLot.platformRevenueBrl === 0 &&
          createdCourtesyLot.countsAsRevenue === false &&
          createdCourtesyLot.isPaidPurchase === false &&
          createdCourtesyLot.reconciledFromLotId === legacyLotA.id
      ),
      'Lote courtesy conciliado tem valor zero, zero repasse, zero receita e rastreabilidade'
    );

    // Idempotent replay with exact same key & payload
    const idempReplay = await makeRequest(
      server,
      'POST',
      '/api/admin/credit-reconciliation/reconcile',
      mixedPayload,
      { Authorization: 'Bearer tok-admin' }
    );
    check(
      idempReplay.status === 200 &&
        idempReplay.data?.isIdempotent === true &&
        idempReplay.data?.audit?.id === mixedRes.data?.audit?.id,
      'Replay idempotente retorna 200 com isIdempotent=true sem duplicar lotes'
    );

    // Idempotency key conflict with altered payload
    const idempConflict = await makeRequest(
      server,
      'POST',
      '/api/admin/credit-reconciliation/reconcile',
      {
        ...mixedPayload,
        justification: 'Payload diferente com mesma chave',
      },
      { Authorization: 'Bearer tok-admin' }
    );
    check(
      idempConflict.status === 409 && idempConflict.data?.error === 'IDEMPOTENCY_KEY_CONFLICT',
      'Mesma idempotencyKey com payload divergente retorna 409 IDEMPOTENCY_KEY_CONFLICT'
    );

    // -----------------------------------------------------------------------
    // 5. CONCURRENCY CONFLICT + DOUBLE FINANCIAL ATTRIBUTION PREVENTION
    // -----------------------------------------------------------------------
    console.log('\n--- 5. Conflito de Concorrência & Prevenção de Dupla Atribuição Financeira ---');
    // Stale expectedLegacyRemainingLessons (caller still thinks 5, actual is now 2)
    const staleConc = await makeRequest(
      server,
      'POST',
      '/api/admin/credit-reconciliation/reconcile',
      {
        studentUid: STUDENT_A_UID,
        idempotencyKey: 'recon_a_stale_occ',
        justification: 'Concorrência com saldo legado desatualizado',
        expectedLegacyRemainingLessons: 5,
        allocations: [{ origin: 'courtesy', lessonsCount: 1 }],
      },
      { Authorization: 'Bearer tok-admin' }
    );
    check(
      staleConc.status === 409 && staleConc.data?.error === 'CONCURRENCY_CONFLICT',
      'Validação de concorrência bloqueia operação baseada em saldo legado obsoleto (409 CONCURRENCY_CONFLICT)'
    );

    // Try attributing 3 more paid lessons to tx_hist_a_paid_4 (total 4, 2 already used -> only 2 left) -> MUST FAIL 409
    // First test with 2 left: wait, legacy remaining is 2, so test requesting 2 lessons on Student A via tx_hist_a_paid_4 succeeds (using remaining 2/4), OR test on same request >4!
    // Wait: let's test duplicate gateway doc first (`tx_hist_a_dup_gateway`), which points to pi_hist_alice_001 already claimed by tx_hist_a_paid_4!
    const dupGatewayRes = await makeRequest(
      server,
      'POST',
      '/api/admin/credit-reconciliation/reconcile',
      {
        studentUid: STUDENT_A_UID,
        idempotencyKey: 'recon_a_dup_gw_fail',
        justification: 'Tentativa reutilizar gateway pi_hist_alice_001 em outro tx doc',
        allocations: [
          {
            origin: 'paid',
            lessonsCount: 1,
            sourceTransactionId: 'tx_hist_a_dup_gateway',
            teacherUid: TEACHER_1_UID,
          },
        ],
      },
      { Authorization: 'Bearer tok-admin' }
    );
    check(
      dupGatewayRes.status === 409 && dupGatewayRes.data?.error === 'DOUBLE_ATTRIBUTION_PREVENTED',
      'Bloqueia dupla atribuição de comprovante de gateway compartilhado entre transações distintas (409)'
    );

    // Try exhausting capacity on tx_hist_a_paid_1 (1 lesson total) by requesting 2 paid lessons -> MUST FAIL 409!
    const overCapacityRes = await makeRequest(
      server,
      'POST',
      '/api/admin/credit-reconciliation/reconcile',
      {
        studentUid: STUDENT_A_UID,
        idempotencyKey: 'recon_a_over_capacity',
        justification: 'Tentativa lastrear 2 aulas em evidência de 1 aula',
        allocations: [
          {
            origin: 'paid',
            lessonsCount: 2,
            sourceTransactionId: 'tx_hist_a_paid_1',
            teacherUid: TEACHER_1_UID,
          },
        ],
      },
      { Authorization: 'Bearer tok-admin' }
    );
    check(
      overCapacityRes.status === 409 && overCapacityRes.data?.error === 'FINANCIAL_EVIDENCE_EXHAUSTED',
      'Bloqueia conciliação que excede quantidade/valor comprovado na transação (409 FINANCIAL_EVIDENCE_EXHAUSTED)'
    );

    // Reconcile 1 paid with tx_hist_a_paid_1 (succeeds, leaves 1 legacy on Student A), then try reconciling remaining 1 legacy with SAME tx_hist_a_paid_1 -> MUST FAIL 409!
    const useSingle1 = await makeRequest(
      server,
      'POST',
      '/api/admin/credit-reconciliation/reconcile',
      {
        studentUid: STUDENT_A_UID,
        idempotencyKey: 'recon_a_use_single_1',
        justification: 'Conciliação 1 aula paga com tx_hist_a_paid_1',
        allocations: [
          {
            origin: 'paid',
            lessonsCount: 1,
            sourceTransactionId: 'tx_hist_a_paid_1',
            teacherUid: TEACHER_1_UID,
          },
        ],
      },
      { Authorization: 'Bearer tok-admin' }
    );
    check(useSingle1.status === 200, 'Consome 1/1 da capacidade de tx_hist_a_paid_1 com sucesso');

    const reuseExhausted = await makeRequest(
      server,
      'POST',
      '/api/admin/credit-reconciliation/reconcile',
      {
        studentUid: STUDENT_A_UID,
        idempotencyKey: 'recon_a_reuse_single_1_fail',
        justification: 'Tentativa reutilizar evidência 100% já utilizada',
        allocations: [
          {
            origin: 'paid',
            lessonsCount: 1,
            sourceTransactionId: 'tx_hist_a_paid_1',
            teacherUid: TEACHER_1_UID,
          },
        ],
      },
      { Authorization: 'Bearer tok-admin' }
    );
    check(
      reuseExhausted.status === 409 && reuseExhausted.data?.error === 'FINANCIAL_EVIDENCE_EXHAUSTED',
      'Impede reutilizar a mesma transação histórica em conciliações distintas após esgotamento (409)'
    );

    // Reusing Student C's 2A PACKAGE_PURCHASE tx to back Student C's 2 remaining legacy credits -> MUST FAIL 409!
    const reuse2aTxRes = await makeRequest(
      server,
      'POST',
      '/api/admin/credit-reconciliation/reconcile',
      {
        studentUid: STUDENT_C_UID,
        idempotencyKey: 'recon_c_reuse_2a_tx_fail',
        justification: 'Tentativa indevida de lastrear créditos legados com compra 2A já creditada',
        allocations: [
          {
            origin: 'paid',
            lessonsCount: 1,
            sourceTransactionId: carolTxId,
            teacherUid: TEACHER_1_UID,
          },
        ],
      },
      { Authorization: 'Bearer tok-admin' }
    );
    check(
      reuse2aTxRes.status === 409 && reuse2aTxRes.data?.error === 'FINANCIAL_EVIDENCE_EXHAUSTED',
      'Bloqueia reutilização de transação PACKAGE_PURCHASE 2A que já originou credit_lot pago (409)'
    );

    // -----------------------------------------------------------------------
    // 6. PRE-2A SINGLE HYDRATION + NO INVENTED PTAX/COMMISSION + CONCURRENT RACE
    // -----------------------------------------------------------------------
    console.log('\n--- 6. Aluno Pré-2A (Sem Inventar PTAX/Comissão) + Corrida Concorrente ---');
    const [race1, race2] = await Promise.all([
      makeRequest(
        server,
        'POST',
        '/api/admin/credit-reconciliation/reconcile',
        {
          studentUid: STUDENT_B_UID,
          idempotencyKey: 'recon_b_race_1',
          justification: 'Conciliação Bob 2 pagas + 2 cortesias',
          expectedLegacyRemainingLessons: 4,
          allocations: [
            {
              origin: 'paid',
              lessonsCount: 2,
              sourceTransactionId: 'tx_hist_b_paid_2',
              teacherUid: TEACHER_1_UID,
            },
            {
              origin: 'courtesy',
              lessonsCount: 2,
            },
          ],
        },
        { Authorization: 'Bearer tok-admin' }
      ),
      makeRequest(
        server,
        'POST',
        '/api/admin/credit-reconciliation/reconcile',
        {
          studentUid: STUDENT_B_UID,
          idempotencyKey: 'recon_b_race_2',
          justification: 'Corrida concorrente simultânea para Bob',
          expectedLegacyRemainingLessons: 4,
          allocations: [{ origin: 'courtesy', lessonsCount: 1 }],
        },
        { Authorization: 'Bearer tok-admin' }
      ),
    ]);

    const raceStatuses = [race1.status, race2.status].sort();
    check(
      raceStatuses[0] === 200 && raceStatuses[1] === 409,
      `Corrida concorrente no mesmo aluno resolve com 1x 200 e 1x 409 (recebido: ${raceStatuses.join(', ')})`
    );

    const bobWinner = race1.status === 200 ? race1 : race2;
    if (race1.status === 200) {
      const bobPaidLot: CreditLot = bobWinner.data?.createdLots?.find((l: any) => l.origin === 'paid');
      check(
        Boolean(
          bobPaidLot &&
            bobPaidLot.totalPaidBrl === 200 &&
            bobPaidLot.ptaxRate === null &&
            bobPaidLot.adminCommissionPercent === null &&
            bobPaidLot.teacherShareBrl === null &&
            bobPaidLot.platformRevenueBrl === null
        ),
        'Para evidência histórica sem PTAX/comissão gravados, NÃO inventa PTAX, comissão nem repasse (permanecem null)'
      );
      check(
        bobWinner.data?.legacyLot?.remainingLessons === 0 &&
          bobWinner.data?.legacyLot?.status === 'exhausted' &&
          bobWinner.data?.availableLessonsAfter === 4,
        'Student B pré-2A hidratou uma única vez, esgotou legacy_unreconciled (preserved document) e manteve availableLessons=4'
      );
    }

    // Check Q1 consumption order on Student A after reconciliation:
    // Student A currently has: 1 courtesy (1 rem), 2 paid lots (2 rem + 1 rem), 1 legacy_unreconciled (1 rem) -> total 5.
    const studentALots = mockDb
      ._listCol('credit_lots')
      .map((x) => x.data as CreditLot)
      .filter((l) => l.studentUid === STUDENT_A_UID && l.remainingLessons > 0);
    const orderedQ1 = sortCreditLotsForConsumption(studentALots);
    check(
      orderedQ1[0]?.origin === 'courtesy' &&
        orderedQ1[1]?.origin === 'paid' &&
        orderedQ1[orderedQ1.length - 1]?.origin === 'legacy_unreconciled',
      'Prioridade Q1 após conciliação mantida: courtesy -> paid -> legacy_unreconciled'
    );

    // -----------------------------------------------------------------------
    // 7. ROLLBACK ON FAILURE & CREDIT_LEDGER_DIVERGENCE STRICTNESS
    // -----------------------------------------------------------------------
    console.log('\n--- 7. Rollback Atômico & Preservação de CREDIT_LEDGER_DIVERGENCE ---');
    const divRes = await makeRequest(
      server,
      'POST',
      '/api/admin/credit-reconciliation/reconcile',
      {
        studentUid: STUDENT_DIV_UID,
        idempotencyKey: 'recon_div_blocked',
        justification: 'Não deve conciliar aluno com divergência no razão',
        allocations: [{ origin: 'courtesy', lessonsCount: 1 }],
      },
      { Authorization: 'Bearer tok-admin' }
    );
    check(
      divRes.status === 409 && divRes.data?.error === 'CREDIT_LEDGER_DIVERGENCE',
      'CREDIT_LEDGER_DIVERGENCE (409) preservado rigorosamente sem autocorreção silenciosa'
    );

    const storeBeforeFailure = mockDb._snapshotAll();
    mockDb._failNextCommit();
    const failCommitRes = await makeRequest(
      server,
      'POST',
      '/api/admin/credit-reconciliation/reconcile',
      {
        studentUid: STUDENT_A_UID,
        idempotencyKey: 'recon_a_fail_rollback',
        justification: 'Deve sofrer rollback completo em falha de commit',
        allocations: [{ origin: 'courtesy', lessonsCount: 1 }],
      },
      { Authorization: 'Bearer tok-admin' }
    );
    const storeAfterFailure = mockDb._snapshotAll();
    check(
      failCommitRes.status >= 500 && storeBeforeFailure === storeAfterFailure,
      'Falha de transação Firestore realiza rollback completo sem efeito parcial'
    );

    // -----------------------------------------------------------------------
    // 8. ZERO INFLATION IN ADM.OPS.1-3 & PRIVACY BOUNDARY
    // -----------------------------------------------------------------------
    console.log('\n--- 8. Zero Inflação em ADM.OPS.1–3, Auditoria Imutável & Privacidade ---');
    const sourceAfter = await fetchAdminOperationsSourceDataFromFirestore();
    const opsAfter = buildAdminOperationsDashboard({
      transactions: sourceAfter.transactions,
      lessons: sourceAfter.lessons,
      tutors: sourceAfter.tutors,
      users: sourceAfter.users,
      studentAssignments: sourceAfter.studentAssignments,
    });
    check(
      opsBefore.kpis.faturamentoBrl === opsAfter.kpis.faturamentoBrl &&
        opsBefore.kpis.aulasContratadas === opsAfter.kpis.aulasContratadas &&
        opsBefore.kpis.paidContractedLessons === opsAfter.kpis.paidContractedLessons &&
        opsBefore.kpis.adminGrantedLessons === opsAfter.kpis.adminGrantedLessons &&
        opsBefore.kpis.custoNativeFriendBrl === opsAfter.kpis.custoNativeFriendBrl &&
        JSON.stringify(opsBefore.rows) === JSON.stringify(opsAfter.rows),
      'ADM.OPS.1–3 não sofreu nenhuma inflação de faturamento, aulas contratadas, concessões ou custos após conciliações'
    );

    const auditsGet = await makeRequest(
      server,
      'GET',
      `/api/admin/credit-reconciliation/audits?studentUid=${STUDENT_A_UID}`,
      undefined,
      { Authorization: 'Bearer tok-admin' }
    );
    check(
      auditsGet.status === 200 &&
        Array.isArray(auditsGet.data?.audits) &&
        auditsGet.data.audits.length >= 2 &&
        auditsGet.data.audits.every((a: any) => a.immutable === true && a.studentUid === STUDENT_A_UID),
      'Auditoria imutável listada corretamente e filtrada por studentUid'
    );

    // Privacy check: student profile endpoint must not leak internal commission or credit_lots commission fields
    const lessonsRes = await makeRequest(
      server,
      'GET',
      '/api/lessons',
      undefined,
      { Authorization: 'Bearer tok-student-a' }
    );
    const leakedKeys = collectNestedKeys(lessonsRes.data);
    const hasCommissionLeak = ADMIN_COMMISSION_KEYS.some((k) => leakedKeys.has(k));
    check(
      !hasCommissionLeak && !leakedKeys.has('platformRevenueBrl'),
      'Isolamento ADM.UI.1 / Privacidade: respostas de aluno não vazam comissão nem receita da plataforma'
    );

    // -----------------------------------------------------------------------
    // 9. SSR UI VALIDATION (DASHBOARD + RECONCILIATION MODAL PT/EN)
    // -----------------------------------------------------------------------
    console.log('\n--- 9. Verificação SSR de UI ADM (Dashboard + Modal PT/EN) ---');
    const dashEnHtml = renderToString(
      React.createElement(AdminOperationsDashboard, {
        currentLanguage: 'en',
        initialData: opsAfter,
      })
    );
    const selectCountEn = (dashEnHtml.match(/<select /g) || []).length;
    check(
      dashEnHtml.includes('open-legacy-reconciliation-btn') &&
        dashEnHtml.includes('Reconcile Legacy Credits') &&
        selectCountEn === 4 &&
        !dashEnHtml.includes('Faturamento'),
      `AdminOperationsDashboard EN exibe botão e preserva exatamente 4 <select> fechados (selectCount=${selectCountEn})`
    );

    const dashPtHtml = renderToString(
      React.createElement(AdminOperationsDashboard, {
        currentLanguage: 'pt',
        initialData: opsAfter,
      })
    );
    check(
      dashPtHtml.includes('Conciliar Créditos Legados'),
      'AdminOperationsDashboard PT exibe botão Conciliar Créditos Legados'
    );

    const modalPtHtml = renderToString(
      React.createElement(AdminLegacyCreditReconciliationModal, {
        isOpen: true,
        onClose: () => {},
        currentLanguage: 'pt',
        initialStudents: pendingStudents,
        initialTeachers: pendingRes.data?.teachers || [],
        initialAudits: auditsGet.data?.audits || [],
      })
    );
    check(
      modalPtHtml.includes('Conciliação Administrativa de Créditos Legados') &&
        modalPtHtml.includes('Alice Legacy') &&
        modalPtHtml.includes('tx_hist_a_paid_4') &&
        modalPtHtml.includes('CREDIT_LEDGER_DIVERGENCE'),
      'Modal NF.SWITCH.2B PT renderiza alunos pendentes, evidências históricas e aviso de divergência'
    );

    const modalEnHtml = renderToString(
      React.createElement(AdminLegacyCreditReconciliationModal, {
        isOpen: true,
        onClose: () => {},
        currentLanguage: 'en',
        initialStudents: pendingStudents,
        initialTeachers: pendingRes.data?.teachers || [],
        initialAudits: auditsGet.data?.audits || [],
      })
    );
    check(
      modalEnHtml.includes('Administrative Legacy Credit Reconciliation') &&
        modalEnHtml.includes('Execute Audited Reconciliation'),
      'Modal NF.SWITCH.2B EN renderiza completamente traduzido'
    );

    const modalSrc = fs.readFileSync(
      path.join(process.cwd(), 'src/components/AdminLegacyCreditReconciliationModal.tsx'),
      'utf8'
    );
    check(
      !modalSrc.includes('window.alert') && !modalSrc.includes('window.confirm'),
      'Modal não utiliza window.alert ou window.confirm'
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    resetFirebaseAdminFirestoreForTesting();
    resetFirebaseAdminForTesting();
  }

  console.log('\n=========================================================================');
  console.log(`📊 RESULTADO NF.SWITCH.2B: ${passed} PASSOU | ${failed} FALHOU`);
  console.log('=========================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runSuite().catch((err) => {
  console.error('Erro inesperado na suite NF.SWITCH.2B:', err);
  process.exit(1);
});
