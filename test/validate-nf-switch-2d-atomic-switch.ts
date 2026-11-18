/**
 * TEST SUITE: NF.SWITCH.2D — TROCA ATÔMICA, IDEMPOTENTE E AUDITÁVEL DE NATIVE FRIEND
 *
 * Behavioral HTTP + Firestore (default) OCC transaction tests covering:
 *  1. Troca com aulas futuras agendadas (Q2 cancelamento + estorno integral sem multa/perda)
 *  2. Preservação de aulas já iniciadas (startDateTime <= now), completed, not_completed e já canceladas
 *  3. Pacotes pagos, cortesias (1:1 sem valor BRL) e combinações + aluno com 0 créditos pós-trial
 *  4. Resíduo financeiro em centavos (residualBrlCents) canônico, separado de availableLessons e cumulativo
 *  5. Professor de destino mais caro e mais barato + 2ª troca subsequente (rastreabilidade lot->lot)
 *  6. Repetição da mesma idempotencyKey (replay seguro, conflito 409 em alvo distinto, isolamento por aluno)
 *  7. Tentativa concorrente de troca (Promise.all OCC + expectedCurrentTeacherUid)
 *  8. Corrida com agendamento e compra + bloqueio de bypass por trial + blindagem POST /api/user-profile
 *  9. Falha intermediária (commit error, timeout, permission, divergência, legacy_unreconciled, limites) com rollback integral
 * 10. RBAC e isolamento entre alunos + rejeição de overrides financeiros/PTAX do cliente
 * 11. Preservação de invariantes de saldo e ausência absoluta de receita artificial (ADM.OPS.1-3)
 */

process.env.NODE_ENV = 'test';
process.env.FIREBASE_PROJECT_ID = 'itissimple-security-staging';
process.env.FIREBASE_DATABASE_ID = '(default)';
process.env.PAYMENTS_ENABLED = 'false';

import assert from 'assert';
import http from 'http';
import { app as serverApp, readDb, resetInMemoryDbForTesting } from '../serverApp';
import {
  setFirebaseAdminFirestoreForTesting,
  resetFirebaseAdminFirestoreForTesting,
  switchNativeFriendAtomicServer,
  scheduleLessonAtomicServer,
  executePackageCreditOperationAtomicServer,
  fetchAdminOperationsSourceDataFromFirestore,
  SWITCH_MAX_CREDIT_LOTS,
  SWITCH_MAX_STUDENT_LESSONS,
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
import { ALLOWED_COMMISSION_MODEL } from '../src/utils/tutorCommission';
import { buildAdminOperationsDashboard } from '../src/utils/adminOperationsAnalytics';
import {
  buildPaidPackageLotData,
  buildCourtesyGrantLotData,
  buildLegacyUnreconciledLotData,
  sumLotRemainingLessons,
  validateCreditLotsForStudent,
} from '../src/utils/creditLots';
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

function makePaidLot(params: {
  studentUid: string;
  studentEmail: string;
  lessonsCount: 1 | 4 | 8 | 12;
  lotSequence: number;
  idempotencyKey: string;
  sourceTransactionId: string;
  pricedTeacherUid: string;
  teacherEmail: string;
  teacherName: string;
  basePriceUsd: number;
  adminCommissionPercent: number;
  ptaxRate: number;
  nowIso?: string;
}): CreditLot {
  const quote = calculateFinancialPricingQuote({
    basePriceUsd: params.basePriceUsd,
    adminCommissionPercent: params.adminCommissionPercent,
    ptaxRate: params.ptaxRate,
    commissionModel: ALLOWED_COMMISSION_MODEL,
    conversionBase: 'UNIT_PRICE_BRL',
  });
  const pkgCalc = quote.packages.list.find((p) => p.lessonsCount === params.lessonsCount);
  if (!pkgCalc) throw new Error(`Unsupported package size: ${params.lessonsCount}`);

  return buildPaidPackageLotData({
    studentUid: params.studentUid,
    studentEmail: params.studentEmail,
    lessonsCount: params.lessonsCount,
    lotSequence: params.lotSequence,
    nowIso: params.nowIso || '2026-10-05T10:00:00.000Z',
    sourceTransactionId: params.sourceTransactionId,
    idempotencyKey: params.idempotencyKey,
    pricedTeacherUid: params.pricedTeacherUid,
    teacherEmail: params.teacherEmail,
    teacherName: params.teacherName,
    packageName: pkgCalc.labelPt,
    basePriceUsd: params.basePriceUsd,
    adminCommissionPercent: params.adminCommissionPercent,
    commissionModel: ALLOWED_COMMISSION_MODEL,
    commissionVersion: 1,
    ptaxRate: params.ptaxRate,
    ptaxQuoteDate: '2026-11-17',
    ptaxPricingDate: '2026-11-18',
    ptaxSource: PTAX_SOURCE_LABEL,
    pkgCalc,
    gatewayProvider: 'stripe',
    gatewayTransactionId: `gw_${params.idempotencyKey}`,
    performedByUid: params.studentUid,
    performedByEmail: params.studentEmail,
    performedByRole: 'student',
  });
}

function createOccFirestoreMock() {
  const store = new Map<string, { data: Record<string, any>; version: number }>();
  let failNextCommitError: Error | null = null;
  let commitPauseHook: (() => Promise<void> | void) | null = null;

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
      const maxAttempts = 8;
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

        if (commitPauseHook) {
          const hook = commitPauseHook;
          commitPauseHook = null;
          await hook();
        }

        if (failNextCommitError) {
          const errToThrow = failNextCommitError;
          failNextCommitError = null;
          throw errToThrow;
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
          if (attempt === maxAttempts - 1) {
            const err: any = new Error('ABORTED: Too much contention on these documents.');
            err.code = 10;
            throw err;
          }
          await new Promise((r) => setTimeout(r, 2 * (attempt + 1)));
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
    },
    _store: store,
    _snapshotStore: () => {
      const snap: Record<string, any> = {};
      for (const [k, v] of store.entries()) {
        snap[k] = JSON.parse(JSON.stringify(v.data));
      }
      return snap;
    },
    _failNextCommitWith: (err: Error) => {
      failNextCommitError = err;
    },
    _setCommitPauseHook: (hook: () => Promise<void> | void) => {
      commitPauseHook = hook;
    },
    _setDoc: (col: string, id: string, data: Record<string, any>) => {
      const prev = store.get(`${col}::${id}`);
      store.set(`${col}::${id}`, {
        data: JSON.parse(JSON.stringify(data)),
        version: (prev?.version || 0) + 1,
      });
    },
    _deleteDoc: (col: string, id: string) => {
      store.delete(`${col}::${id}`);
    },
    _getDoc: (col: string, id: string) => store.get(`${col}::${id}`)?.data,
    _listCol: (col: string) => {
      const out: Array<{ id: string; data: Record<string, any> }> = [];
      for (const [k, v] of store.entries()) {
        if (k.startsWith(`${col}::`) && !k.slice(`${col}::`.length).includes('/')) {
          out.push({ id: k.slice(`${col}::`.length), data: JSON.parse(JSON.stringify(v.data)) });
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

function seedPtaxCache(mockFs: ReturnType<typeof createOccFirestoreMock>, ptaxRate: number) {
  const pricingDate = getSaoPauloDateString(new Date());
  const quoteDate = getExpectedReferenceDate(pricingDate);
  mockFs._setDoc(PTAX_CACHE_COLLECTION, quoteDate, {
    pricingDate,
    quoteDate,
    cotacaoVenda: ptaxRate,
    cotacaoCompra: ptaxRate - 0.02,
    dataHoraCotacao: `${quoteDate} 13:05:00.000`,
    tipoBoletim: 'Fechamento',
    source: PTAX_SOURCE_LABEL,
    updatedAt: new Date().toISOString(),
  });
  clearPtaxMemoryCache();
  return { pricingDate, quoteDate, ptaxRate };
}

function seedTutor(
  mockFs: ReturnType<typeof createOccFirestoreMock>,
  opts: {
    uid: string;
    email: string;
    name: string;
    publicTutorId: string;
    basePriceUsd: number;
    adminCommissionPercent: number;
    isApproved?: boolean;
    approvalStatus?: string;
    meetUrl?: string;
  }
) {
  const isApproved = opts.isApproved !== false;
  const approvalStatus = opts.approvalStatus || (isApproved ? 'approved' : 'pending');
  const record = {
    uid: opts.uid,
    authUid: opts.uid,
    id: opts.publicTutorId,
    publicTutorId: opts.publicTutorId,
    email: opts.email,
    name: opts.name,
    role: 'teacher',
    approvalStatus,
    isApproved,
    approved: isApproved,
    status: approvalStatus,
    country: 'US',
    basePriceUsd: opts.basePriceUsd,
    pricePerSessionUsd: opts.basePriceUsd,
    adminCommissionPercent: opts.adminCommissionPercent,
    commissionModel: ALLOWED_COMMISSION_MODEL,
    commissionVersion: 1,
    meetUrl: opts.meetUrl || `https://meet.google.com/${opts.uid.slice(0, 6)}`,
    isCommercializable: isApproved,
    updatedAt: '2026-10-01T10:00:00.000Z',
  };
  mockFs._setDoc('tutors', opts.uid, record);
  mockFs._setDoc('users', opts.uid, record);
}

function seedStudentWithLotsAndLink(
  mockFs: ReturnType<typeof createOccFirestoreMock>,
  opts: {
    uid: string;
    email: string;
    name: string;
    teacherUid: string;
    teacherEmail: string;
    teacherName: string;
    lots: CreditLot[];
    residualBrlCents?: number;
    scheduledLessonsMirrors?: any[];
    contractedLessons?: number;
  }
) {
  const availableLessons = sumLotRemainingLessons(opts.lots);
  const activeCreditLotIds = opts.lots.filter((l) => l.remainingLessons > 0).map((l) => l.id);
  const maxSeq = opts.lots.reduce((m, l) => Math.max(m, Number(l.lotSequence || 0)), 0);
  const userDoc: Record<string, any> = {
    uid: opts.uid,
    id: opts.uid,
    email: opts.email,
    name: opts.name,
    role: 'student',
    teacherUid: opts.teacherUid,
    assignedNativeFriendUID: opts.teacherUid,
    nativeFriendUID: opts.teacherUid,
    teacherEmail: opts.teacherEmail,
    teacherName: opts.teacherName,
    enrollmentStatus: 'active',
    availableLessons,
    contractedLessons: opts.contractedLessons ?? availableLessons,
    creditLotsInitializedAt: '2026-10-01T10:00:00.000Z',
    activeCreditLotIds,
    creditLotSequence: maxSeq,
    ...(opts.residualBrlCents !== undefined ? { residualBrlCents: opts.residualBrlCents } : {}),
    ...(opts.scheduledLessonsMirrors ? { scheduledLessons: opts.scheduledLessonsMirrors } : {}),
    updatedAt: '2026-10-01T10:00:00.000Z',
  };
  mockFs._setDoc('users', opts.uid, userDoc);
  mockFs._setDoc('student_assignments', opts.uid, {
    studentUid: opts.uid,
    teacherUid: opts.teacherUid,
    teacherAuthUid: opts.teacherUid,
    assignedNativeFriendUID: opts.teacherUid,
    nativeFriendUID: opts.teacherUid,
    teacherEmail: opts.teacherEmail,
    teacherName: opts.teacherName,
    enrollmentStatus: 'active',
    updatedAt: '2026-10-01T10:00:00.000Z',
  });
  for (const lot of opts.lots) {
    mockFs._setDoc('credit_lots', lot.id, lot);
  }
}

function loadStudentLots(mockFs: ReturnType<typeof createOccFirestoreMock>, studentUid: string): CreditLot[] {
  return mockFs
    ._listCol('credit_lots')
    .map((entry) => entry.data as CreditLot)
    .filter((l) => l.studentUid === studentUid);
}

async function runSuite() {
  console.log('=========================================================================');
  console.log(' NF.SWITCH.2D — TROCA ATÔMICA DE NATIVE FRIEND (TESTES COMPORTAMENTAIS)');
  console.log('=========================================================================\n');

  const STUDENT_A_UID = 'uid_std_nf2d_alice_00001';
  const STUDENT_A_EMAIL = 'alice.nf2d@itssimple.com';
  const STUDENT_B_UID = 'uid_std_nf2d_bruno_00002';
  const STUDENT_B_EMAIL = 'bruno.nf2d@itssimple.com';
  const TEACHER_A_UID = 'uid_tut_nf2d_arthur_001';
  const TEACHER_A_EMAIL = 'arthur.nf2d@itssimple.com';
  const TEACHER_B_UID = 'uid_tut_nf2d_beth_0002';
  const TEACHER_B_EMAIL = 'beth.nf2d@itssimple.com';
  const TEACHER_C_UID = 'uid_tut_nf2d_carl_0003';
  const TEACHER_C_EMAIL = 'carl.nf2d@itssimple.com';
  const PENDING_TEACHER_UID = 'uid_tut_nf2d_pend_0004';
  const PENDING_TEACHER_EMAIL = 'pending.nf2d@itssimple.com';
  const ADMIN_UID = 'uid_adm_nf2d_super_00001';
  const ADMIN_EMAIL = 'admin.nf2d@itssimple.com';

  const PTAX_RATE = 5.0; // $1.00 USD = R$ 5.00 BRL -> integer cent arithmetic

  const mockFs = createOccFirestoreMock();
  setFirebaseAdminFirestoreForTesting(mockFs as any);

  const tokenMap: Record<string, any> = {
    'tok-std-a': { uid: STUDENT_A_UID, email: STUDENT_A_EMAIL, role: 'student' },
    'tok-std-b': { uid: STUDENT_B_UID, email: STUDENT_B_EMAIL, role: 'student' },
    'tok-tch-a': { uid: TEACHER_A_UID, email: TEACHER_A_EMAIL, role: 'teacher' },
    'tok-tch-pend': { uid: PENDING_TEACHER_UID, email: PENDING_TEACHER_EMAIL, role: 'pending_teacher' },
    'tok-adm': { uid: ADMIN_UID, email: ADMIN_EMAIL, role: 'admin' },
  };

  setFirebaseAdminAuthForTesting({
    verifyIdToken: async (token: string) => {
      const claims = tokenMap[token];
      if (!claims) throw new Error('Invalid or expired Firebase ID token');
      return {
        uid: claims.uid,
        email: claims.email,
        role: claims.role,
        admin: claims.role === 'admin',
      };
    },
  } as any);

  const server = serverApp.listen(0);

  const resetAllBaseData = () => {
    resetInMemoryDbForTesting();
    mockFs._store.clear();
    mockFs._failNextCommitWith(null as any);
    mockFs._setCommitPauseHook(null as any);
    clearPtaxMemoryCache();
    seedPtaxCache(mockFs, PTAX_RATE);

    // Teacher A: $20 * 1.25 = $25 USD/unit = R$125,00/unit (12500c/unit; 4-pack = R$475,00 = 11875c/unit)
    seedTutor(mockFs, {
      uid: TEACHER_A_UID,
      email: TEACHER_A_EMAIL,
      name: 'Teacher Arthur',
      publicTutorId: 'tut_arthur_20',
      basePriceUsd: 20,
      adminCommissionPercent: 25,
    });
    // Teacher B (MORE EXPENSIVE): $30 * 1.20 = $36 USD/unit = R$180,00/unit (18000c/unit)
    seedTutor(mockFs, {
      uid: TEACHER_B_UID,
      email: TEACHER_B_EMAIL,
      name: 'Teacher Beth',
      publicTutorId: 'tut_beth_30',
      basePriceUsd: 30,
      adminCommissionPercent: 20,
    });
    // Teacher C (CHEAPER): $10 * 1.20 = $12 USD/unit = R$60,00/unit (6000c/unit)
    seedTutor(mockFs, {
      uid: TEACHER_C_UID,
      email: TEACHER_C_EMAIL,
      name: 'Teacher Carl',
      publicTutorId: 'tut_carl_10',
      basePriceUsd: 10,
      adminCommissionPercent: 20,
    });
    // Unapproved teacher
    seedTutor(mockFs, {
      uid: PENDING_TEACHER_UID,
      email: PENDING_TEACHER_EMAIL,
      name: 'Pending Tutor',
      publicTutorId: 'tut_pending',
      basePriceUsd: 20,
      adminCommissionPercent: 25,
      isApproved: false,
      approvalStatus: 'pending',
    });
  };

  try {
    // =========================================================================
    // TEST 1: RBAC, Auth & Isolamento entre Alunos + Rejeição de Overrides Cliente
    // =========================================================================
    resetAllBaseData();
    {
      const paidLot = makePaidLot({
        studentUid: STUDENT_A_UID,
        studentEmail: STUDENT_A_EMAIL,
        lessonsCount: 4,
        lotSequence: 1,
        idempotencyKey: 'pkg-seed-1',
        sourceTransactionId: 'ftx-seed-1',
        pricedTeacherUid: TEACHER_A_UID,
        teacherEmail: TEACHER_A_EMAIL,
        teacherName: 'Teacher Arthur',
        basePriceUsd: 20,
        adminCommissionPercent: 25,
        ptaxRate: PTAX_RATE,
      });
      seedStudentWithLotsAndLink(mockFs, {
        uid: STUDENT_A_UID,
        email: STUDENT_A_EMAIL,
        name: 'Alice',
        teacherUid: TEACHER_A_UID,
        teacherEmail: TEACHER_A_EMAIL,
        teacherName: 'Teacher Arthur',
        lots: [paidLot],
      });
      seedStudentWithLotsAndLink(mockFs, {
        uid: STUDENT_B_UID,
        email: STUDENT_B_EMAIL,
        name: 'Bruno',
        teacherUid: TEACHER_A_UID,
        teacherEmail: TEACHER_A_EMAIL,
        teacherName: 'Teacher Arthur',
        lots: [],
      });

      const unauthRes = await makeRequest(server, 'POST', '/api/students/switch-native-friend', {
        targetTeacherUid: TEACHER_B_UID,
        idempotencyKey: 'rbac-unauth',
      });
      check(unauthRes.status === 401, '1a. Requisição sem token retorna 401');

      const teacherRes = await makeRequest(
        server,
        'POST',
        '/api/students/switch-native-friend',
        { targetTeacherUid: TEACHER_B_UID, idempotencyKey: 'rbac-tch' },
        { Authorization: 'Bearer tok-tch-a' }
      );
      check(teacherRes.status === 403, '1b. Professor não pode executar rota de troca do aluno (403)');

      const adminRes = await makeRequest(
        server,
        'POST',
        '/api/students/switch-native-friend',
        { studentUid: STUDENT_A_UID, targetTeacherUid: TEACHER_B_UID, idempotencyKey: 'rbac-adm' },
        { Authorization: 'Bearer tok-adm' }
      );
      check(adminRes.status === 403, '1c. Admin não pode acionar rota self-service de troca (403)');

      const crossStudentRes = await makeRequest(
        server,
        'POST',
        '/api/students/switch-native-friend',
        { studentUid: STUDENT_A_UID, targetTeacherUid: TEACHER_B_UID, idempotencyKey: 'rbac-cross' },
        { Authorization: 'Bearer tok-std-b' }
      );
      check(crossStudentRes.status === 403, '1d. Aluno B não pode trocar vínculo do Aluno A (403)');

      const crossEmailRes = await makeRequest(
        server,
        'POST',
        '/api/students/switch-native-friend',
        { studentEmail: STUDENT_A_EMAIL, targetTeacherUid: TEACHER_B_UID, idempotencyKey: 'rbac-cross-em' },
        { Authorization: 'Bearer tok-std-b' }
      );
      check(crossEmailRes.status === 403, '1e. Aluno B não pode passar email de Aluno A (403)');

      const overridePtaxRes = await makeRequest(
        server,
        'POST',
        '/api/students/switch-native-friend',
        { targetTeacherUid: TEACHER_B_UID, idempotencyKey: 'override-ptax', ptaxRate: 2.0 },
        { Authorization: 'Bearer tok-std-a' }
      );
      check(
        overridePtaxRes.status === 400 && overridePtaxRes.data.error === 'CLIENT_SWITCH_OVERRIDE_FORBIDDEN',
        '1f. Cliente tentando injetar ptaxRate é rejeitado com 400 CLIENT_SWITCH_OVERRIDE_FORBIDDEN'
      );

      const overrideSkipQ2Res = await makeRequest(
        server,
        'POST',
        '/api/students/switch-native-friend',
        { targetTeacherUid: TEACHER_B_UID, idempotencyKey: 'override-q2', skipQ2Refund: true },
        { Authorization: 'Bearer tok-std-a' }
      );
      check(
        overrideSkipQ2Res.status === 400 && overrideSkipQ2Res.data.error === 'CLIENT_SWITCH_OVERRIDE_FORBIDDEN',
        '1g. Cliente tentando injetar skipQ2Refund é rejeitado com 400'
      );

      const sameTeacherRes = await makeRequest(
        server,
        'POST',
        '/api/students/switch-native-friend',
        { targetTeacherUid: TEACHER_A_UID, idempotencyKey: 'same-teacher' },
        { Authorization: 'Bearer tok-std-a' }
      );
      check(
        sameTeacherRes.status === 400 && sameTeacherRes.data.error === 'SAME_TEACHER_SWITCH_FORBIDDEN',
        '1h. Troca para o mesmo professor atual retorna 400 SAME_TEACHER_SWITCH_FORBIDDEN'
      );

      const unapprovedTargetRes = await makeRequest(
        server,
        'POST',
        '/api/students/switch-native-friend',
        { targetTeacherUid: PENDING_TEACHER_UID, idempotencyKey: 'pending-target' },
        { Authorization: 'Bearer tok-std-a' }
      );
      check(
        unapprovedTargetRes.status === 403 && unapprovedTargetRes.data.error === 'TUTOR_NOT_APPROVED',
        '1i. Troca para professor não aprovado retorna 403 TUTOR_NOT_APPROVED'
      );

      // Verify zero mutations happened on Alice during all rejected calls
      const aliceAfter = mockFs._getDoc('users', STUDENT_A_UID)!;
      check(
        aliceAfter.teacherUid === TEACHER_A_UID && aliceAfter.availableLessons === 4 && mockFs._listCol('native_friend_switches').length === 0,
        '1j. Nenhuma mutação persistida após todas as rejeições de RBAC/validação'
      );
    }

    // =========================================================================
    // TEST 2: Q2 Cancelamento & Estorno Integral + Aulas Iniciadas/Concluídas Preservadas
    //         + Mistura Pagos & Cortesias + Professor Mais Caro + Resíduo em Centavos
    // =========================================================================
    resetAllBaseData();
    {
      // 4-lesson package @ $20 base + 25% markup ($25) * PTAX 5.0 * 5% discount = R$475,00 (11875 cents/unit)
      // Plus 1 courtesy unit (0 cents).
      // Consumed before switch:
      //  - unitIndex 0: completed
      //  - unitIndex 1: already started (startDateTime = 10 min before now)
      //  - unitIndex 2: future unstarted (startDateTime = 2 hours after now -> Q2 must cancel & refund!)
      // Remaining availableLessons BEFORE switch = 2 (1 paid unitIndex 3 + 1 courtesy unitIndex 0).
      // After Q2 refund of unitIndex 2 (11875 cents), Alice has:
      //  - 2 paid units @ 11875 cents = 23750 cents (R$ 237,50)
      //  - 1 courtesy unit @ 0 cents
      //  - Total availableLessonsAfterRefunds = 3
      // Target Teacher B costs $30 * 1.20 * 5.0 = R$ 180,00 = 18000 cents per lesson!
      // Budget 23750 cents / 18000 cents = 1 paid lesson with Teacher B (18000 cents) + residual 5750 cents!
      // Courtesy 1:1 transferred = 1 courtesy lesson with Teacher B!
      // Final availableLessonsAfterSwitch = 1 + 1 = 2, residualBrlCentsAfter = 5750!
      const rawPaidLot = makePaidLot({
        studentUid: STUDENT_A_UID,
        studentEmail: STUDENT_A_EMAIL,
        lessonsCount: 4,
        lotSequence: 1,
        idempotencyKey: 'pkg-q2-1',
        sourceTransactionId: 'ftx-q2-1',
        pricedTeacherUid: TEACHER_A_UID,
        teacherEmail: TEACHER_A_EMAIL,
        teacherName: 'Teacher Arthur',
        basePriceUsd: 20,
        adminCommissionPercent: 25,
        ptaxRate: PTAX_RATE,
      });

      const paidLot: CreditLot = {
        ...rawPaidLot,
        remainingLessons: 1,
        consumedLessons: 3,
        consumedUnitIndices: [0, 1, 2],
        availableUnitIndices: [3],
        remainingTotalPaidBrlCents: 11875,
        remainingTotalPaidUsdCents: 2375,
        consumedTotalPaidBrlCents: 35625,
        consumedTotalPaidUsdCents: 7125,
      };

      const courtesyLot = buildCourtesyGrantLotData({
        studentUid: STUDENT_A_UID,
        studentEmail: STUDENT_A_EMAIL,
        lessonsCount: 1,
        lotSequence: 2,
        nowIso: '2026-10-06T10:00:00.000Z',
        idempotencyKey: 'crt-q2-2',
        sourceTransactionId: 'ftx-crt-2',
        pricedTeacherUid: TEACHER_A_UID,
        teacherEmail: TEACHER_A_EMAIL,
        teacherName: 'Teacher Arthur',
        packageName: 'Bônus boas-vindas',
        performedByUid: ADMIN_UID,
        performedByEmail: ADMIN_EMAIL,
        performedByRole: 'admin',
      });

      const nowFixedIso = '2026-11-18T12:00:00.000Z';
      const lessonsData = [
        {
          id: 'les_completed_01',
          studentUid: STUDENT_A_UID,
          studentEmail: STUDENT_A_EMAIL,
          teacherUid: TEACHER_A_UID,
          teacherEmail: TEACHER_A_EMAIL,
          status: 'completed',
          startDateTime: '2026-11-10T10:00:00.000Z',
          endDateTime: '2026-11-10T10:50:00.000Z',
          isTrialLesson: false,
          creditLotId: paidLot.id,
          creditUnitIndex: 0,
        },
        {
          id: 'les_started_02',
          studentUid: STUDENT_A_UID,
          studentEmail: STUDENT_A_EMAIL,
          teacherUid: TEACHER_A_UID,
          teacherEmail: TEACHER_A_EMAIL,
          status: 'scheduled',
          startDateTime: '2026-11-18T11:50:00.000Z',
          endDateTime: '2026-11-18T12:40:00.000Z',
          isTrialLesson: false,
          creditLotId: paidLot.id,
          creditUnitIndex: 1,
        },
        {
          id: 'les_future_paid_03',
          studentUid: STUDENT_A_UID,
          studentEmail: STUDENT_A_EMAIL,
          teacherUid: TEACHER_A_UID,
          teacherEmail: TEACHER_A_EMAIL,
          status: 'scheduled',
          startDateTime: '2026-11-18T14:00:00.000Z',
          endDateTime: '2026-11-18T14:50:00.000Z',
          isTrialLesson: false,
          creditLotId: paidLot.id,
          creditUnitIndex: 2,
          creditRefunded: false,
        },
        {
          id: 'les_future_trial_04',
          studentUid: STUDENT_A_UID,
          studentEmail: STUDENT_A_EMAIL,
          teacherUid: TEACHER_A_UID,
          teacherEmail: TEACHER_A_EMAIL,
          status: 'confirmed',
          startDateTime: '2026-11-19T14:00:00.000Z',
          endDateTime: '2026-11-19T14:50:00.000Z',
          isTrialLesson: true,
        },
        {
          id: 'les_already_cancelled_05',
          studentUid: STUDENT_A_UID,
          studentEmail: STUDENT_A_EMAIL,
          teacherUid: TEACHER_A_UID,
          teacherEmail: TEACHER_A_EMAIL,
          status: 'cancelled',
          cancelledAt: '2026-11-12T09:00:00.000Z',
          creditRefunded: true,
          startDateTime: '2026-11-20T14:00:00.000Z',
          endDateTime: '2026-11-20T14:50:00.000Z',
          isTrialLesson: false,
        },
      ];

      seedStudentWithLotsAndLink(mockFs, {
        uid: STUDENT_A_UID,
        email: STUDENT_A_EMAIL,
        name: 'Alice',
        teacherUid: TEACHER_A_UID,
        teacherEmail: TEACHER_A_EMAIL,
        teacherName: 'Teacher Arthur',
        lots: [paidLot, courtesyLot],
        contractedLessons: 4,
        scheduledLessonsMirrors: lessonsData,
      });
      mockFs._setDoc('users', TEACHER_A_UID, {
        ...mockFs._getDoc('users', TEACHER_A_UID),
        scheduledLessons: lessonsData,
      });

      for (const l of lessonsData) {
        mockFs._setDoc('lessons', l.id, l);
        mockFs._setDoc(`users/${STUDENT_A_UID}/lessons`, l.id, l);
        mockFs._setDoc(`users/${TEACHER_A_UID}/lessons`, l.id, l);
        mockFs._setDoc(`tutors/${TEACHER_A_UID}/lessons`, l.id, l);
      }

      const switchRes = await switchNativeFriendAtomicServer({
        studentAuthUid: STUDENT_A_UID,
        studentEmail: STUDENT_A_EMAIL,
        targetTeacherId: TEACHER_B_UID,
        idempotencyKey: 'switch-q2-expensive-1',
        nowOverrideIso: nowFixedIso,
        ptaxOverride: {
          success: true,
          ptaxRate: PTAX_RATE,
          quoteDate: '2026-11-17',
          pricingDate: '2026-11-18',
          source: PTAX_SOURCE_LABEL,
        },
      });

      check(switchRes.success && switchRes.statusCode === 200, '2a. Troca A->B (com Q2 + professor mais caro) concluída com 200', switchRes.error);
      check(switchRes.q2CancelledLessonsCount === 2, '2b. Exatamente 2 aulas futuras não iniciadas canceladas (1 paga + 1 trial)');
      check(switchRes.q2RefundedCreditsCount === 1, '2c. Exatamente 1 crédito estornado pela Q2 (a aula trial não estorna crédito)');
      check(switchRes.q2CancelledTrialLessonsCount === 1, '2d. 1 aula trial futura cancelada sem estorno de crédito');
      check(switchRes.lockedStartedLessonsCount === 1, '2e. 1 aula já iniciada detectada e preservada intacta');
      check(switchRes.availableLessonsBefore === 2, '2f. availableLessonsBefore = 2 (1 paga + 1 cortesia)');
      check(switchRes.availableLessonsAfterRefunds === 3, '2g. availableLessonsAfterRefunds = 3 após estorno Q2 (<24h sem multa)');
      check(switchRes.availableLessonsAfterSwitch === 2, '2h. availableLessonsAfterSwitch = 2 (1 paga convertida + 1 cortesia 1:1)');
      check(
        switchRes.switchResidualBrlCents === 5750 && switchRes.residualBrlCentsAfter === 5750,
        '2i. residualBrlCents = 5750 centavos (R$ 57,50) persistido separadamente'
      );

      // Check Firestore lesson states & mirrors
      const futPaid = mockFs._getDoc('lessons', 'les_future_paid_03')!;
      const futPaidStudentMirror = mockFs._getDoc(`users/${STUDENT_A_UID}/lessons`, 'les_future_paid_03')!;
      const futPaidTeacherMirror = mockFs._getDoc(`tutors/${TEACHER_A_UID}/lessons`, 'les_future_paid_03')!;
      const futTrial = mockFs._getDoc('lessons', 'les_future_trial_04')!;
      const startedLes = mockFs._getDoc('lessons', 'les_started_02')!;
      const completedLes = mockFs._getDoc('lessons', 'les_completed_01')!;
      const alreadyCancelled = mockFs._getDoc('lessons', 'les_already_cancelled_05')!;

      check(
        futPaid.status === 'cancelled' &&
          futPaid.cancelledBySwitch === true &&
          futPaid.creditRefunded === true &&
          futPaidStudentMirror.status === 'cancelled' &&
          futPaidTeacherMirror.status === 'cancelled',
        '2j. Aula futura paga cancelada em lessons + subcoleções com cancelledBySwitch e creditRefunded=true'
      );
      check(
        futTrial.status === 'cancelled' && futTrial.cancelledBySwitch === true && futTrial.creditRefunded === false,
        '2k. Aula trial futura cancelada em Q2 com creditRefunded=false'
      );
      check(
        startedLes.status === 'scheduled' && !startedLes.cancelledBySwitch && completedLes.status === 'completed' && !alreadyCancelled.cancelledBySwitch,
        '2l. Aulas já iniciadas, concluídas e previamente canceladas intocadas (sem duplo estorno)'
      );

      // Check student user document, assignment document, and teacher scheduledLessons mirror
      const aliceDoc = mockFs._getDoc('users', STUDENT_A_UID)!;
      const assignDoc = mockFs._getDoc('student_assignments', STUDENT_A_UID)!;
      const teacherADoc = mockFs._getDoc('users', TEACHER_A_UID)!;

      check(
        aliceDoc.teacherUid === TEACHER_B_UID &&
          aliceDoc.assignedNativeFriendUID === TEACHER_B_UID &&
          aliceDoc.nativeFriendUID === TEACHER_B_UID &&
          aliceDoc.teacherEmail === TEACHER_B_EMAIL &&
          aliceDoc.availableLessons === 2 &&
          aliceDoc.residualBrlCents === 5750 &&
          assignDoc.teacherUid === TEACHER_B_UID &&
          assignDoc.enrollmentStatus === 'active',
        '2m. Vínculo canônico em users/{uid} e student_assignments/{uid} + availableLessons=2 + residualBrlCents=5750'
      );

      const mirrorFut = (teacherADoc.scheduledLessons || []).find((x: any) => x.id === 'les_future_paid_03');
      const mirrorStarted = (teacherADoc.scheduledLessons || []).find((x: any) => x.id === 'les_started_02');
      check(
        mirrorFut === undefined && mirrorStarted?.status === 'scheduled',
        '2n. Espelho scheduledLessons do professor de origem sincronizado (aula cancelada removida e iniciada preservada)'
      );

      // Check credit lots traceability & invariants
      const allLots = loadStudentLots(mockFs, STUDENT_A_UID);
      validateCreditLotsForStudent(STUDENT_A_UID, allLots);
      check(
        sumLotRemainingLessons(allLots) === aliceDoc.availableLessons,
        '2o. Soma dos lotes ativos igual exatamente a users/{uid}.availableLessons (2)'
      );

      const retiredPaid = allLots.find((l) => l.id === paidLot.id)!;
      const retiredCourtesy = allLots.find((l) => l.id === courtesyLot.id)!;
      const destPaidLots = allLots.filter((l) => l.origin === 'paid' && l.sourceType === 'NATIVE_FRIEND_SWITCH_PAID');
      const destCourtesyLots = allLots.filter(
        (l) => l.origin === 'courtesy' && l.sourceType === 'NATIVE_FRIEND_SWITCH_COURTESY'
      );

      check(
        retiredPaid.remainingLessons === 0 &&
          retiredPaid.initialLessons === 4 &&
          retiredPaid.switchedOutAuditId === switchRes.switchAuditId &&
          retiredPaid.switchedOutTargetTeacherUid === TEACHER_B_UID &&
          retiredCourtesy.remainingLessons === 0,
        '2p. Lotes de origem aposentados mantendo initialLessons e rastreabilidade switchedOut*'
      );

      check(
        destPaidLots.length === 1 &&
          destPaidLots[0].remainingLessons === 1 &&
          destPaidLots[0].totalPaidBrlCents === 18000 &&
          destPaidLots[0].pricedTeacherUid === TEACHER_B_UID &&
          destPaidLots[0].switchedFromAuditId === switchRes.switchAuditId &&
          Boolean(destPaidLots[0].switchedFromLotIds?.includes(paidLot.id)) &&
          destCourtesyLots.length === 1 &&
          destCourtesyLots[0].remainingLessons === 1 &&
          destCourtesyLots[0].totalPaidBrlCents === 0 &&
          destCourtesyLots[0].isPaidPurchase === false &&
          destCourtesyLots[0].countsAsRevenue === false,
        '2q. Lotes de destino (pago R$180 + cortesia 1:1 com valor BRL 0) criados com rastreabilidade completa'
      );

      // Zero financial_transactions revenue created
      const ftList = mockFs._listCol('financial_transactions');
      check(
        ftList.length === 0,
        '2r. Nenhuma transação de receita artificial ou repasse criada em financial_transactions'
      );

      // Verify ADM.OPS dashboard sees ZERO revenue and ZERO payout inflation
      const opsSrc = await fetchAdminOperationsSourceDataFromFirestore();
      const dash = buildAdminOperationsDashboard({
        transactions: opsSrc.transactions,
        lessons: opsSrc.lessons,
        tutors: opsSrc.tutors,
        users: opsSrc.users,
        studentAssignments: opsSrc.studentAssignments,
        filters: { year: 'all', month: 'all', country: 'all', teacherUid: 'all' },
      });
      check(
        (dash.kpis.faturamentoBrl ?? 0) === 0 &&
          (dash.kpis.custoNativeFriendBrl ?? 0) === 0 &&
          dash.kpis.paidContractedLessons === 0,
        '2s. Painel ADM.OPS registra zero receita e zero repasse artificial após troca'
      );

      // =========================================================================
      // TEST 3: Replay Idempotente, Conflito de IdempotencyKey & 2ª Troca para Mais Barato + Acúmulo de Resíduo
      // =========================================================================
      const replayRes = await switchNativeFriendAtomicServer({
        studentAuthUid: STUDENT_A_UID,
        studentEmail: STUDENT_A_EMAIL,
        targetTeacherId: TEACHER_B_UID,
        idempotencyKey: 'switch-q2-expensive-1',
        nowOverrideIso: nowFixedIso,
        ptaxOverride: { success: true, ptaxRate: PTAX_RATE },
      });
      check(
        replayRes.success &&
          replayRes.isIdempotent === true &&
          replayRes.switchAuditId === switchRes.switchAuditId &&
          mockFs._getDoc('users', STUDENT_A_UID)!.availableLessons === 2 &&
          mockFs._getDoc('users', STUDENT_A_UID)!.residualBrlCents === 5750,
        '3a. Replay da mesma idempotencyKey retorna isIdempotent=true sem dupla conversão ou duplicação de resíduo'
      );

      const conflictIdempRes = await switchNativeFriendAtomicServer({
        studentAuthUid: STUDENT_A_UID,
        studentEmail: STUDENT_A_EMAIL,
        targetTeacherId: TEACHER_C_UID,
        idempotencyKey: 'switch-q2-expensive-1',
        nowOverrideIso: nowFixedIso,
        ptaxOverride: { success: true, ptaxRate: PTAX_RATE },
      });
      check(
        !conflictIdempRes.success && conflictIdempRes.statusCode === 409 && conflictIdempRes.code === 'IDEMPOTENCY_KEY_CONFLICT',
        '3b. Reuso da mesma idempotencyKey com outro destino retorna 409 IDEMPOTENCY_KEY_CONFLICT'
      );

      // Same idempotencyKey by Student B (isolated per student!)
      seedStudentWithLotsAndLink(mockFs, {
        uid: STUDENT_B_UID,
        email: STUDENT_B_EMAIL,
        name: 'Bruno',
        teacherUid: TEACHER_A_UID,
        teacherEmail: TEACHER_A_EMAIL,
        teacherName: 'Teacher Arthur',
        lots: [],
      });
      const studentBSameKeyRes = await switchNativeFriendAtomicServer({
        studentAuthUid: STUDENT_B_UID,
        studentEmail: STUDENT_B_EMAIL,
        targetTeacherId: TEACHER_B_UID,
        idempotencyKey: 'switch-q2-expensive-1',
        nowOverrideIso: nowFixedIso,
        ptaxOverride: { success: true, ptaxRate: PTAX_RATE },
      });
      check(
        studentBSameKeyRes.success &&
          studentBSameKeyRes.isIdempotent === false &&
          studentBSameKeyRes.availableLessonsAfterSwitch === 0,
        '3c. Mesmo idempotencyKey por outro aluno (pós-trial 0 créditos) é isolado e executa troca limpa'
      );

      // Second sequential switch for Alice: Teacher B (18000c) -> Cheaper Teacher C (6000c)
      // 18000 / 6000 = 3 single lessons (18000c), residual stays 5750c, plus 1 courtesy = 4 lessons!
      const secondSwitchRes = await switchNativeFriendAtomicServer({
        studentAuthUid: STUDENT_A_UID,
        studentEmail: STUDENT_A_EMAIL,
        targetTeacherId: TEACHER_C_UID,
        idempotencyKey: 'switch-b-to-cheaper-c-2',
        nowOverrideIso: '2026-11-18T12:05:00.000Z',
        ptaxOverride: { success: true, ptaxRate: PTAX_RATE },
      });
      check(
        secondSwitchRes.success &&
          secondSwitchRes.sourceTeacherUid === TEACHER_B_UID &&
          secondSwitchRes.targetTeacherUid === TEACHER_C_UID &&
          secondSwitchRes.availableLessonsAfterSwitch === 4 &&
          secondSwitchRes.residualBrlCentsBefore === 5750 &&
          secondSwitchRes.residualBrlCentsAfter === 5750,
        '3d. 2ª troca para professor mais barato converte R$180->3 aulas ($12) + 1 cortesia, preservando residualBrlCents separado',
        secondSwitchRes.error
      );
    }

    // =========================================================================
    // TEST 4: Conversão com Troco/Resíduo no Professor Mais Barato + Somente Cortesias
    // =========================================================================
    resetAllBaseData();
    {
      // 1 single lesson @ Teacher A (12500 cents) -> Target Teacher C (6000 cents):
      // 12500 / 6000 = 2 lessons (12000 cents) + 500 cents residual! Accumulated over 1000c = 1500c!
      const lot125 = makePaidLot({
        studentUid: STUDENT_A_UID,
        studentEmail: STUDENT_A_EMAIL,
        lessonsCount: 1,
        lotSequence: 1,
        idempotencyKey: 'pkg-125',
        sourceTransactionId: 'ftx-125',
        pricedTeacherUid: TEACHER_A_UID,
        teacherEmail: TEACHER_A_EMAIL,
        teacherName: 'Teacher Arthur',
        basePriceUsd: 20,
        adminCommissionPercent: 25,
        ptaxRate: PTAX_RATE,
      });
      seedStudentWithLotsAndLink(mockFs, {
        uid: STUDENT_A_UID,
        email: STUDENT_A_EMAIL,
        name: 'Alice',
        teacherUid: TEACHER_A_UID,
        teacherEmail: TEACHER_A_EMAIL,
        teacherName: 'Teacher Arthur',
        lots: [lot125],
        residualBrlCents: 1000,
      });

      const cheapRes = await switchNativeFriendAtomicServer({
        studentAuthUid: STUDENT_A_UID,
        studentEmail: STUDENT_A_EMAIL,
        targetTeacherId: TEACHER_C_UID,
        idempotencyKey: 'switch-cheap-residuo',
        ptaxOverride: { success: true, ptaxRate: PTAX_RATE },
      });
      check(
        cheapRes.success &&
          cheapRes.availableLessonsAfterSwitch === 2 &&
          cheapRes.switchResidualBrlCents === 500 &&
          cheapRes.residualBrlCentsBefore === 1000 &&
          cheapRes.residualBrlCentsAfter === 1500,
        '4a. Professor mais barato gera 2 aulas + 500c resíduo acumulados sobre 1000c existentes = 1500c',
        cheapRes.error
      );

      // Courtesy-only switch
      const courtesyOnlyLot = buildCourtesyGrantLotData({
        studentUid: STUDENT_B_UID,
        studentEmail: STUDENT_B_EMAIL,
        lessonsCount: 3,
        lotSequence: 1,
        nowIso: '2026-10-05T10:00:00.000Z',
        idempotencyKey: 'crt-only-1',
        sourceTransactionId: 'ftx-crt-only',
        pricedTeacherUid: TEACHER_A_UID,
        teacherEmail: TEACHER_A_EMAIL,
        teacherName: 'Teacher Arthur',
        packageName: 'Cortesia integral',
        performedByUid: ADMIN_UID,
        performedByEmail: ADMIN_EMAIL,
        performedByRole: 'admin',
      });
      seedStudentWithLotsAndLink(mockFs, {
        uid: STUDENT_B_UID,
        email: STUDENT_B_EMAIL,
        name: 'Bruno',
        teacherUid: TEACHER_A_UID,
        teacherEmail: TEACHER_A_EMAIL,
        teacherName: 'Teacher Arthur',
        lots: [courtesyOnlyLot],
      });
      const crtSwitchRes = await switchNativeFriendAtomicServer({
        studentAuthUid: STUDENT_B_UID,
        studentEmail: STUDENT_B_EMAIL,
        targetTeacherId: TEACHER_B_UID,
        idempotencyKey: 'switch-courtesy-only',
        ptaxOverride: { success: true, ptaxRate: PTAX_RATE },
      });
      check(
        crtSwitchRes.success &&
          crtSwitchRes.availableLessonsAfterSwitch === 3 &&
          crtSwitchRes.switchResidualBrlCents === 0 &&
          crtSwitchRes.audit?.budgetBrlCents === 0 &&
          crtSwitchRes.audit?.accountingInvariants.courtesyFinancialValueBrlCents === 0,
        '4b. Somente cortesias transfere 3:3 1:1 com budget 0 e valor financeiro zero',
        crtSwitchRes.error
      );
    }

    // =========================================================================
    // TEST 5: Tentativa Concorrente de Troca & Corridas (Agendamento, Trial Bypass & Compra)
    // =========================================================================
    resetAllBaseData();
    {
      const paidLot = makePaidLot({
        studentUid: STUDENT_A_UID,
        studentEmail: STUDENT_A_EMAIL,
        lessonsCount: 4,
        lotSequence: 1,
        idempotencyKey: 'pkg-race-1',
        sourceTransactionId: 'ftx-race-1',
        pricedTeacherUid: TEACHER_A_UID,
        teacherEmail: TEACHER_A_EMAIL,
        teacherName: 'Teacher Arthur',
        basePriceUsd: 20,
        adminCommissionPercent: 25,
        ptaxRate: PTAX_RATE,
      });
      seedStudentWithLotsAndLink(mockFs, {
        uid: STUDENT_A_UID,
        email: STUDENT_A_EMAIL,
        name: 'Alice',
        teacherUid: TEACHER_A_UID,
        teacherEmail: TEACHER_A_EMAIL,
        teacherName: 'Teacher Arthur',
        lots: [paidLot],
      });

      const [r1, r2] = await Promise.all([
        switchNativeFriendAtomicServer({
          studentAuthUid: STUDENT_A_UID,
          studentEmail: STUDENT_A_EMAIL,
          targetTeacherId: TEACHER_B_UID,
          idempotencyKey: 'conc-switch-b',
          expectedCurrentTeacherUid: TEACHER_A_UID,
          ptaxOverride: { success: true, ptaxRate: PTAX_RATE },
        }),
        switchNativeFriendAtomicServer({
          studentAuthUid: STUDENT_A_UID,
          studentEmail: STUDENT_A_EMAIL,
          targetTeacherId: TEACHER_C_UID,
          idempotencyKey: 'conc-switch-c',
          expectedCurrentTeacherUid: TEACHER_A_UID,
          ptaxOverride: { success: true, ptaxRate: PTAX_RATE },
        }),
      ]);

      const succeeded = [r1, r2].filter((r) => r.success);
      const conflicted = [r1, r2].filter((r) => !r.success && r.code === 'CONCURRENCY_CONFLICT');
      check(
        succeeded.length === 1 && conflicted.length === 1,
        '5a. Tentativa concorrente de troca (Promise.all): exatamente 1 vence e 1 recebe 409 CONCURRENCY_CONFLICT'
      );

      const postConcLots = loadStudentLots(mockFs, STUDENT_A_UID);
      validateCreditLotsForStudent(STUDENT_A_UID, postConcLots);
      check(
        sumLotRemainingLessons(postConcLots) === mockFs._getDoc('users', STUDENT_A_UID)!.availableLessons,
        '5b. Saldo pós-corrida de troca 100% consistente com soma dos lotes (sem dupla conversão)'
      );
    }

    // Race: Switch A->B overlapping with Schedule with A (using OCC commitPauseHook!)
    resetAllBaseData();
    {
      const paidLot = makePaidLot({
        studentUid: STUDENT_A_UID,
        studentEmail: STUDENT_A_EMAIL,
        lessonsCount: 4,
        lotSequence: 1,
        idempotencyKey: 'pkg-race-sched',
        sourceTransactionId: 'ftx-race-sched',
        pricedTeacherUid: TEACHER_A_UID,
        teacherEmail: TEACHER_A_EMAIL,
        teacherName: 'Teacher Arthur',
        basePriceUsd: 20,
        adminCommissionPercent: 25,
        ptaxRate: PTAX_RATE,
      });
      seedStudentWithLotsAndLink(mockFs, {
        uid: STUDENT_A_UID,
        email: STUDENT_A_EMAIL,
        name: 'Alice',
        teacherUid: TEACHER_A_UID,
        teacherEmail: TEACHER_A_EMAIL,
        teacherName: 'Teacher Arthur',
        lots: [paidLot],
      });

      mockFs._setCommitPauseHook(async () => {
        await switchNativeFriendAtomicServer({
          studentAuthUid: STUDENT_A_UID,
          studentEmail: STUDENT_A_EMAIL,
          targetTeacherId: TEACHER_B_UID,
          idempotencyKey: 'race-switch-before-sched-commit',
          ptaxOverride: { success: true, ptaxRate: PTAX_RATE },
        });
      });

      const schedRaceRes = await scheduleLessonAtomicServer({
        studentAuthUid: STUDENT_A_UID,
        studentEmail: STUDENT_A_EMAIL,
        studentName: 'Alice',
        teacherIdOrEmail: TEACHER_A_UID,
        teacherUid: TEACHER_A_UID,
        teacherEmail: TEACHER_A_EMAIL,
        teacherName: 'Teacher Arthur',
        startDateTime: '2026-12-01T14:00:00.000Z',
        endDateTime: '2026-12-01T14:50:00.000Z',
        isTrialLesson: false,
        requestId: 'les_race_with_a',
      });

      check(
        !schedRaceRes.success && schedRaceRes.statusCode === 409 && schedRaceRes.code === 'TEACHER_LINK_MISMATCH',
        '5c. Corrida agendamento vs troca: agendamento concorrente com professor A falha no retry OCC (409 TEACHER_LINK_MISMATCH)',
        `${schedRaceRes.statusCode} ${schedRaceRes.code || ''} ${schedRaceRes.error || ''}`
      );
      check(
        mockFs._listCol('lessons').length === 0,
        '5d. Nenhuma aula órfã criada para professor A na corrida com troca'
      );

      // Post-switch trial lesson bypass check!
      const trialBypassRes = await scheduleLessonAtomicServer({
        studentAuthUid: STUDENT_A_UID,
        studentEmail: STUDENT_A_EMAIL,
        studentName: 'Alice',
        teacherIdOrEmail: TEACHER_C_UID,
        teacherUid: TEACHER_C_UID,
        teacherEmail: TEACHER_C_EMAIL,
        teacherName: 'Teacher Carl',
        startDateTime: '2026-12-02T14:00:00.000Z',
        endDateTime: '2026-12-02T14:50:00.000Z',
        isTrialLesson: true,
        requestId: 'les_trial_bypass_c',
      });
      check(
        !trialBypassRes.success && trialBypassRes.statusCode === 409 && trialBypassRes.code === 'TEACHER_LINK_MISMATCH',
        '5e. Aula trial com professor C é bloqueada quando aluno tem vínculo ativo com B (409 TEACHER_LINK_MISMATCH)',
        `${trialBypassRes.statusCode} ${trialBypassRes.code || ''} ${trialBypassRes.error || ''}`
      );

      // Verify POST /api/user-profile cannot silently switch active student back to A
      const profileOverwriteRes = await makeRequest(
        server,
        'POST',
        '/api/user-profile',
        { uid: STUDENT_A_UID, email: STUDENT_A_EMAIL, teacherUid: TEACHER_A_UID, teacherEmail: TEACHER_A_EMAIL, name: 'Alice Upd' },
        { Authorization: 'Bearer tok-std-a' }
      );
      check(
        profileOverwriteRes.status === 200 && mockFs._getDoc('users', STUDENT_A_UID)!.teacherUid === TEACHER_B_UID,
        '5f. POST /api/user-profile preserva vínculo canônico com Teacher B (impede bypass de troca)'
      );
    }

    // Race: Switch A->B overlapping with Package Purchase
    resetAllBaseData();
    {
      const initialLot = makePaidLot({
        studentUid: STUDENT_A_UID,
        studentEmail: STUDENT_A_EMAIL,
        lessonsCount: 4,
        lotSequence: 1,
        idempotencyKey: 'pkg-race-buy-init',
        sourceTransactionId: 'ftx-race-buy-init',
        pricedTeacherUid: TEACHER_A_UID,
        teacherEmail: TEACHER_A_EMAIL,
        teacherName: 'Teacher Arthur',
        basePriceUsd: 20,
        adminCommissionPercent: 25,
        ptaxRate: PTAX_RATE,
      });
      seedStudentWithLotsAndLink(mockFs, {
        uid: STUDENT_A_UID,
        email: STUDENT_A_EMAIL,
        name: 'Alice',
        teacherUid: TEACHER_A_UID,
        teacherEmail: TEACHER_A_EMAIL,
        teacherName: 'Teacher Arthur',
        lots: [initialLot],
      });

      mockFs._setCommitPauseHook(async () => {
        await switchNativeFriendAtomicServer({
          studentAuthUid: STUDENT_A_UID,
          studentEmail: STUDENT_A_EMAIL,
          targetTeacherId: TEACHER_B_UID,
          idempotencyKey: 'switch-during-pkg-purchase',
          ptaxOverride: { success: true, ptaxRate: PTAX_RATE },
        });
      });

      const purchaseRaceRes = await executePackageCreditOperationAtomicServer({
        studentUid: STUDENT_A_UID,
        studentEmail: STUDENT_A_EMAIL,
        idempotencyKey: 'pkg-during-switch-race',
        packageLessons: 4,
        isPaidPurchase: true,
        gatewayConfirmation: {
          verifiedByServer: true,
          gatewayProvider: 'stripe',
          gatewayTransactionId: 'gw_race_pkg_during_switch',
        },
        actorUid: STUDENT_A_UID,
        actorEmail: STUDENT_A_EMAIL,
        actorRole: 'student',
      });

      check(
        !purchaseRaceRes.success && purchaseRaceRes.statusCode === 409 && purchaseRaceRes.code === 'CONCURRENCY_CONFLICT',
        '5g. Corrida compra vs troca: compra derivada do professor antigo A falha com 409 CONCURRENCY_CONFLICT após troca para B',
        `${purchaseRaceRes.statusCode} ${purchaseRaceRes.code || ''} ${purchaseRaceRes.error || ''}`
      );

      const lotsAfterPkgRace = loadStudentLots(mockFs, STUDENT_A_UID);
      validateCreditLotsForStudent(STUDENT_A_UID, lotsAfterPkgRace);
      check(
        mockFs._getDoc('users', STUDENT_A_UID)!.teacherUid === TEACHER_B_UID &&
          sumLotRemainingLessons(lotsAfterPkgRace) === mockFs._getDoc('users', STUDENT_A_UID)!.availableLessons,
        '5h. Lotes e saldo do aluno íntegros após compra concorrente rejeitada'
      );
    }

    // =========================================================================
    // TEST 6: Falhas Intermediárias, Rollback Integral, Legacy Bloqueado & Limites
    // =========================================================================
    resetAllBaseData();
    {
      const rawPaidLot = makePaidLot({
        studentUid: STUDENT_A_UID,
        studentEmail: STUDENT_A_EMAIL,
        lessonsCount: 4,
        lotSequence: 1,
        idempotencyKey: 'pkg-rollback-1',
        sourceTransactionId: 'ftx-rollback-1',
        pricedTeacherUid: TEACHER_A_UID,
        teacherEmail: TEACHER_A_EMAIL,
        teacherName: 'Teacher Arthur',
        basePriceUsd: 20,
        adminCommissionPercent: 25,
        ptaxRate: PTAX_RATE,
      });
      const paidLot: CreditLot = {
        ...rawPaidLot,
        remainingLessons: 3,
        consumedLessons: 1,
        consumedUnitIndices: [0],
        availableUnitIndices: [1, 2, 3],
        remainingTotalPaidBrlCents: 35625,
        remainingTotalPaidUsdCents: 7125,
        consumedTotalPaidBrlCents: 11875,
        consumedTotalPaidUsdCents: 2375,
      };
      seedStudentWithLotsAndLink(mockFs, {
        uid: STUDENT_A_UID,
        email: STUDENT_A_EMAIL,
        name: 'Alice',
        teacherUid: TEACHER_A_UID,
        teacherEmail: TEACHER_A_EMAIL,
        teacherName: 'Teacher Arthur',
        lots: [paidLot],
      });
      mockFs._setDoc('lessons', 'les_rb_future', {
        id: 'les_rb_future',
        studentUid: STUDENT_A_UID,
        studentEmail: STUDENT_A_EMAIL,
        teacherUid: TEACHER_A_UID,
        status: 'scheduled',
        startDateTime: '2026-12-10T14:00:00.000Z',
        endDateTime: '2026-12-10T14:50:00.000Z',
        isTrialLesson: false,
        creditLotId: paidLot.id,
        creditUnitIndex: 0,
      });

      const snapshotBeforeFail = JSON.stringify(mockFs._snapshotStore());
      mockFs._failNextCommitWith(new Error('DEADLINE_EXCEEDED: Simulated Firestore intermediate commit failure'));

      const failRes = await makeRequest(
        server,
        'POST',
        '/api/students/switch-native-friend',
        { targetTeacherUid: TEACHER_B_UID, idempotencyKey: 'rollback-timeout' },
        { Authorization: 'Bearer tok-std-a' }
      );
      const snapshotAfterFail = JSON.stringify(mockFs._snapshotStore());

      check(
        failRes.status === 504 && failRes.data.error === 'FIRESTORE_TIMEOUT',
        '6a. Falha intermediária DEADLINE_EXCEEDED retorna 504 FIRESTORE_TIMEOUT',
        `${failRes.status} ${JSON.stringify(failRes.data)}`
      );
      check(
        snapshotBeforeFail === snapshotAfterFail,
        '6b. Rollback integral: estado do Firestore 100% idêntico ao snapshot anterior (zero escrita parcial)'
      );

      // Legacy unreconciled blocked cleanly
      const legacyLot = buildLegacyUnreconciledLotData({
        studentUid: STUDENT_B_UID,
        studentEmail: STUDENT_B_EMAIL,
        lessonsCount: 2,
        lotSequence: 1,
        nowIso: '2026-10-05T10:00:00.000Z',
      });
      seedStudentWithLotsAndLink(mockFs, {
        uid: STUDENT_B_UID,
        email: STUDENT_B_EMAIL,
        name: 'Bruno',
        teacherUid: TEACHER_A_UID,
        teacherEmail: TEACHER_A_EMAIL,
        teacherName: 'Teacher Arthur',
        lots: [legacyLot],
      });

      const legacyRes = await makeRequest(
        server,
        'POST',
        '/api/students/switch-native-friend',
        { targetTeacherUid: TEACHER_B_UID, idempotencyKey: 'switch-legacy-blocked' },
        { Authorization: 'Bearer tok-std-b' }
      );
      check(
        legacyRes.status === 409 && legacyRes.data.error === 'LEGACY_UNRECONCILED_PRESENT',
        '6c. Saldo legacy_unreconciled bloqueia troca com 409 LEGACY_UNRECONCILED_PRESENT sem alteração parcial'
      );

      // Conservative limits enforcement (lessons > SWITCH_MAX_STUDENT_LESSONS & lots > SWITCH_MAX_CREDIT_LOTS)
      for (let i = 0; i <= SWITCH_MAX_CREDIT_LOTS; i++) {
        mockFs._setDoc('credit_lots', `lot_excess_${i}`, {
          ...paidLot,
          id: `lot_excess_${i}`,
          lotSequence: i + 10,
          remainingLessons: 0,
          consumedLessons: 2,
          consumedUnitIndices: [0, 1],
          remainingBrlCents: 0,
          remainingUsdCents: 0,
        });
      }
      const snapshotBeforeLimit = JSON.stringify(mockFs._snapshotStore());
      const limitRes = await switchNativeFriendAtomicServer({
        studentAuthUid: STUDENT_A_UID,
        studentEmail: STUDENT_A_EMAIL,
        targetTeacherId: TEACHER_B_UID,
        idempotencyKey: 'switch-limit-lots',
        ptaxOverride: { success: true, ptaxRate: PTAX_RATE },
      });
      check(
        !limitRes.success &&
          limitRes.statusCode === 422 &&
          limitRes.code === 'SWITCH_TRANSACTION_LIMIT_EXCEEDED' &&
          JSON.stringify(mockFs._snapshotStore()) === snapshotBeforeLimit,
        '6d. Excesso de lotes (> SWITCH_MAX_CREDIT_LOTS) falha com 422 SWITCH_TRANSACTION_LIMIT_EXCEEDED sem alterar dados'
      );

      // Test lessons limit too on Student B
      seedStudentWithLotsAndLink(mockFs, {
        uid: STUDENT_B_UID,
        email: STUDENT_B_EMAIL,
        name: 'Bruno',
        teacherUid: TEACHER_A_UID,
        teacherEmail: TEACHER_A_EMAIL,
        teacherName: 'Teacher Arthur',
        lots: [],
      });
      for (let i = 0; i <= SWITCH_MAX_STUDENT_LESSONS; i++) {
        mockFs._setDoc('lessons', `les_limit_${i}`, {
          id: `les_limit_${i}`,
          studentUid: STUDENT_B_UID,
          studentEmail: STUDENT_B_EMAIL,
          teacherUid: TEACHER_A_UID,
          status: 'completed',
          startDateTime: '2026-10-01T10:00:00.000Z',
          endDateTime: '2026-10-01T10:50:00.000Z',
        });
      }
      const limitLessonsRes = await switchNativeFriendAtomicServer({
        studentAuthUid: STUDENT_B_UID,
        studentEmail: STUDENT_B_EMAIL,
        targetTeacherId: TEACHER_B_UID,
        idempotencyKey: 'switch-limit-lessons',
        ptaxOverride: { success: true, ptaxRate: PTAX_RATE },
      });
      check(
        !limitLessonsRes.success &&
          limitLessonsRes.statusCode === 422 &&
          limitLessonsRes.code === 'SWITCH_TRANSACTION_LIMIT_EXCEEDED',
        '6e. Excesso de aulas (> SWITCH_MAX_STUDENT_LESSONS) falha com 422 SWITCH_TRANSACTION_LIMIT_EXCEEDED'
      );
    }

    // =========================================================================
    // TEST 7: Endpoint HTTP Completo End-to-End + Sync RAM Cache Pós-Commit + PTAX Indisponível
    // =========================================================================
    resetAllBaseData();
    {
      const paidLot = makePaidLot({
        studentUid: STUDENT_A_UID,
        studentEmail: STUDENT_A_EMAIL,
        lessonsCount: 4,
        lotSequence: 1,
        idempotencyKey: 'pkg-http-e2e',
        sourceTransactionId: 'ftx-http-e2e',
        pricedTeacherUid: TEACHER_A_UID,
        teacherEmail: TEACHER_A_EMAIL,
        teacherName: 'Teacher Arthur',
        basePriceUsd: 20,
        adminCommissionPercent: 25,
        ptaxRate: PTAX_RATE,
      });
      seedStudentWithLotsAndLink(mockFs, {
        uid: STUDENT_A_UID,
        email: STUDENT_A_EMAIL,
        name: 'Alice',
        teacherUid: TEACHER_A_UID,
        teacherEmail: TEACHER_A_EMAIL,
        teacherName: 'Teacher Arthur',
        lots: [paidLot],
      });

      const httpRes = await makeRequest(
        server,
        'POST',
        '/api/students/switch-native-friend',
        { targetTeacherUid: TEACHER_B_UID, idempotencyKey: 'http-e2e-key-1' },
        { Authorization: 'Bearer tok-std-a' }
      );
      check(
        httpRes.status === 200 &&
          httpRes.data.success === true &&
          httpRes.data.targetTeacherUid === TEACHER_B_UID &&
          httpRes.data.availableLessonsAfterSwitch === 2 && // 47500c -> 2 aulas (36000c) + 11500c resíduo
          httpRes.data.residualBrlCentsAfter === 11500,
        '7a. POST /api/students/switch-native-friend retorna 200 e executa conversão real via PTAX cacheada',
        `${httpRes.status} ${JSON.stringify(httpRes.data)}`
      );

      const ramDb = readDb();
      check(
        ramDb.userProfiles?.[STUDENT_A_EMAIL]?.teacherUid === TEACHER_B_UID &&
          ramDb.userProfiles?.[STUDENT_A_EMAIL]?.availableLessons === 2 &&
          ramDb.userProfiles?.[STUDENT_A_EMAIL]?.residualBrlCents === 11500,
        '7b. Cache RAM (db.userProfiles) sincronizado estritamente pós-commit sem afetar receita',
        JSON.stringify(ramDb.userProfiles?.[STUDENT_A_EMAIL])
      );

      // PTAX Unavailable (503) test without fallback
      const pricingDate = getSaoPauloDateString(new Date());
      const expectedRefDate = getExpectedReferenceDate(pricingDate);
      mockFs._deleteDoc(PTAX_CACHE_COLLECTION, expectedRefDate);
      clearPtaxMemoryCache();
      const origFetch = globalThis.fetch;
      globalThis.fetch = (async () => new Response('Unavailable', { status: 503 })) as any;
      try {
        const ptaxFailRes = await makeRequest(
          server,
          'POST',
          '/api/students/switch-native-friend',
          { targetTeacherUid: TEACHER_C_UID, idempotencyKey: 'http-ptax-fail' },
          { Authorization: 'Bearer tok-std-a' }
        );
        check(
          ptaxFailRes.status === 503 && ptaxFailRes.data.error === 'PTAX_UNAVAILABLE',
          '7c. Sem PTAX oficial disponível retorna 503 PTAX_UNAVAILABLE sem fallback fictício'
        );
      } finally {
        globalThis.fetch = origFetch;
      }
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    resetFirebaseAdminFirestoreForTesting();
    resetFirebaseAdminForTesting();
    resetInMemoryDbForTesting();
    clearPtaxMemoryCache();
  }

  console.log('\n=========================================================================');
  console.log(` RESULTADO NF.SWITCH.2D: ${passed} passed, ${failed} failed`);
  console.log('=========================================================================');
  if (failed > 0) process.exit(1);
}

runSuite().catch((err) => {
  console.error('Erro fatal na suíte NF.SWITCH.2D:', err);
  process.exit(1);
});
