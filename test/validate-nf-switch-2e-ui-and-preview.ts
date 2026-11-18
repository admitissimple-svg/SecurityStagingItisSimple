/**
 * TEST SUITE: NF.SWITCH.2E — INTERFACE DE TROCA DE NATIVE FRIEND, PRÉVIA SERVER-SIDE E BINDING CRIPTOGRÁFICO
 *
 * Valida exclusivamente a entrega NF.SWITCH.2E sobre NF.SWITCH.1A e 2A–2D:
 *  1. Endpoint read-only POST /api/students/switch-native-friend/preview (RBAC, 0 escritas, 0 vazamentos)
 *  2. Cálculos 100% no servidor reutilizando motor 2C e Q1/Q2/Q3 (cancelamentos Q2, pacotes, cortesias, resíduo, bloqueios)
 *  3. Vinculação criptográfica prévia -> confirmação (token tampering, expiry, cross-student, target mismatch)
 *  4. Rejeição transacional na 2D para qualquer mutação entre prévia e confirmação (saldo, aulas/Q2, preço, PTAX)
 *  5. Happy path prévia -> confirmação idempotente com previewSnapshotHash gravado na auditoria
 *  6. Renderização SSR bilíngue PT/EN (SwitchNativeFriendModal, StudentHeaderSection, ManageSubscriptionModal) e higiene de UI
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
import {
  previewNativeFriendSwitchServer,
  switchNativeFriendAtomicServer,
  setFirebaseAdminFirestoreForTesting,
  resetFirebaseAdminFirestoreForTesting,
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
import { ADMIN_COMMISSION_KEYS, ALLOWED_COMMISSION_MODEL } from '../src/utils/tutorCommission';
import {
  buildPaidPackageLotData,
  buildCourtesyGrantLotData,
  buildLegacyUnreconciledLotData,
  consumeUnitsFromLots,
} from '../src/utils/creditLots';
import { SwitchNativeFriendModal } from '../src/components/SwitchNativeFriendModal';
import { StudentHeaderSection } from '../src/components/StudentHeaderSection';
import { ManageSubscriptionModal } from '../src/components/ManageSubscriptionModal';
import { getBilingualSwitchError } from '../src/utils/nativeFriendSwitchClient';
import { getTranslations } from '../src/utils/i18n';
import type { CreditLot, NativeFriendTutor, SwitchExecuteResponseDto, SwitchPreviewResponseDto } from '../src/types';

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
    nowIso: '2026-10-05T10:00:00.000Z',
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

  const matchFilters = (data: Record<string, any>, filters: Array<{ field: string; op: string; val: any }>) =>
    filters.every((f) => (f.op === '==' ? data[f.field] === f.val : false));

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
      for (let attempt = 0; attempt < 6; attempt++) {
        const readVersions = new Map<string, number>();
        const staged: Array<{ key: string; op: 'set' | 'delete'; data?: Record<string, any>; merge?: boolean }> = [];
        let hasWritten = false;

        const tx = {
          get: async (ref: any) => {
            if (hasWritten) throw new Error('Reads must precede writes in transaction.');
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
            staged.push({ key: `${ref._col}::${ref._id}`, op: 'set', data, merge: opts?.merge });
          },
          update: (ref: any, data: Record<string, any>) => {
            hasWritten = true;
            staged.push({ key: `${ref._col}::${ref._id}`, op: 'set', data, merge: true });
          },
          delete: (ref: any) => {
            hasWritten = true;
            staged.push({ key: `${ref._col}::${ref._id}`, op: 'delete' });
          },
        };

        const result = await fn(tx);
        let conflict = false;
        for (const [k, ver] of readVersions.entries()) {
          if ((store.get(k)?.version || 0) !== ver) {
            conflict = true;
            break;
          }
        }
        if (conflict) continue;

        for (const item of staged) {
          if (item.op === 'delete') {
            store.delete(item.key);
          } else {
            const existing = store.get(item.key);
            const prev = item.merge ? (existing?.data || {}) : {};
            store.set(item.key, {
              data: JSON.parse(JSON.stringify({ ...prev, ...item.data })),
              version: (existing?.version || 0) + 1,
            });
          }
        }
        return result;
      }
      throw new Error('Transaction conflict');
    },
    _clear: () => store.clear(),
    _setDoc: (col: string, id: string, data: Record<string, any>) => {
      const key = `${col}::${id}`;
      const existing = store.get(key);
      store.set(key, {
        data: JSON.parse(JSON.stringify(data)),
        version: (existing?.version || 0) + 1,
      });
    },
    _getDoc: (col: string, id: string) => {
      const entry = store.get(`${col}::${id}`);
      return entry?.data ? JSON.parse(JSON.stringify(entry.data)) : null;
    },
    _deleteDoc: (col: string, id: string) => store.delete(`${col}::${id}`),
    _listCol: (col: string) => {
      const out: any[] = [];
      for (const [k, entry] of store.entries()) {
        if (k.startsWith(`${col}::`) && !k.slice(`${col}::`.length).includes('/')) {
          out.push(JSON.parse(JSON.stringify(entry.data)));
        }
      }
      return out;
    },
    _snapshotStore: () => {
      const entries: Record<string, any> = {};
      const keys = Array.from(store.keys()).sort();
      for (const k of keys) entries[k] = store.get(k)?.data;
      return entries;
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
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(payload)) } : {}),
          ...headers,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let parsed: any = null;
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
    if (payload) req.write(payload);
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
    collectNestedKeys(v, out);
  }
  return out;
}

const PTAX_RATE = 5.0;
const STUDENT_A_UID = 'stdUidSwitch2eAlpha00001';
const STUDENT_A_EMAIL = 'alice.switch2e@example.com';
const STUDENT_B_UID = 'stdUidSwitch2eBravo00002';
const STUDENT_B_EMAIL = 'bruno.switch2e@example.com';

const TEACHER_A_UID = 'tchUidSwitch2eArthur001';
const TEACHER_A_EMAIL = 'arthur.2e@example.com';
const TEACHER_B_UID = 'tchUidSwitch2eBeth00002';
const TEACHER_B_EMAIL = 'beth.2e@example.com';
const TEACHER_C_UID = 'tchUidSwitch2eCarlos003';
const TEACHER_C_EMAIL = 'carlos.2e@example.com';
const TEACHER_UNAPPROVED_UID = 'tchUidSwitch2ePend00004';
const TEACHER_UNAPPROVED_EMAIL = 'pending.2e@example.com';
const ADMIN_UID = 'admUidSwitch2eRoot00005';
const ADMIN_EMAIL = 'admin.2e@example.com';

function seedTeachers(mockFs: ReturnType<typeof createOccFirestoreMock>) {
  const teachers = [
    {
      uid: TEACHER_A_UID,
      id: TEACHER_A_UID,
      publicTutorId: 'tutor-arthur-2e',
      email: TEACHER_A_EMAIL,
      name: 'Teacher Arthur',
      role: 'teacher',
      approvalStatus: 'approved',
      isApproved: true,
      isCommercializable: true,
      basePriceUsd: 20,
      pricePerSessionUsd: 20,
      adminCommissionPercent: 25,
      commissionModel: ALLOWED_COMMISSION_MODEL,
      commissionVersion: 1,
      meetUrl: 'https://meet.google.com/arthur-2e',
    },
    {
      uid: TEACHER_B_UID,
      id: TEACHER_B_UID,
      publicTutorId: 'tutor-beth-2e',
      email: TEACHER_B_EMAIL,
      name: 'Teacher Beth',
      role: 'teacher',
      approvalStatus: 'approved',
      isApproved: true,
      isCommercializable: true,
      basePriceUsd: 30,
      pricePerSessionUsd: 30,
      adminCommissionPercent: 20, // unit = 30 * 5 * 1.20 = R$ 180.00
      commissionModel: ALLOWED_COMMISSION_MODEL,
      commissionVersion: 1,
      meetUrl: 'https://meet.google.com/beth-2e',
    },
    {
      uid: TEACHER_C_UID,
      id: TEACHER_C_UID,
      publicTutorId: 'tutor-carlos-2e',
      email: TEACHER_C_EMAIL,
      name: 'Teacher Carlos',
      role: 'teacher',
      approvalStatus: 'approved',
      isApproved: true,
      isCommercializable: true,
      basePriceUsd: 16,
      pricePerSessionUsd: 16,
      adminCommissionPercent: 25, // unit = 16 * 5 * 1.25 = R$ 100.00
      commissionModel: ALLOWED_COMMISSION_MODEL,
      commissionVersion: 1,
      meetUrl: 'https://meet.google.com/carlos-2e',
    },
    {
      uid: TEACHER_UNAPPROVED_UID,
      id: TEACHER_UNAPPROVED_UID,
      publicTutorId: 'tutor-pending-2e',
      email: TEACHER_UNAPPROVED_EMAIL,
      name: 'Teacher Pending',
      role: 'teacher',
      approvalStatus: 'pending',
      isApproved: false,
      isCommercializable: false,
      basePriceUsd: 18,
      pricePerSessionUsd: 18,
      adminCommissionPercent: 20,
      commissionModel: ALLOWED_COMMISSION_MODEL,
      commissionVersion: 1,
    },
  ];
  for (const t of teachers) {
    mockFs._setDoc('tutors', t.uid, t);
    mockFs._setDoc('users', t.uid, t);
  }
  mockFs._setDoc('users', ADMIN_UID, {
    uid: ADMIN_UID,
    id: ADMIN_UID,
    email: ADMIN_EMAIL,
    name: 'Admin Root',
    role: 'admin',
  });
}

function seedPtax(mockFs: ReturnType<typeof createOccFirestoreMock>, rate = PTAX_RATE) {
  clearPtaxMemoryCache();
  const pricingDate = getSaoPauloDateString(new Date());
  const expectedRefDate = getExpectedReferenceDate(pricingDate);
  mockFs._setDoc(PTAX_CACHE_COLLECTION, expectedRefDate, {
    pricingDate,
    quoteDate: expectedRefDate,
    cotacaoVenda: rate,
    cotacaoCompra: rate - 0.02,
    dataHoraCotacao: `${expectedRefDate} 13:05:00.000`,
    tipoBoletim: 'Fechamento',
    source: PTAX_SOURCE_LABEL,
    updatedAt: new Date().toISOString(),
  });
}

function seedStudent(
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
  }
) {
  const totalAvailable = opts.lots.reduce((s, l) => s + Number(l.remainingLessons || 0), 0);
  const totalContracted = opts.lots.reduce((s, l) => s + Number(l.initialLessons || 0), 0);
  const activeIds = opts.lots.filter((l) => l.remainingLessons > 0).map((l) => l.id);
  const maxSeq = opts.lots.reduce((m, l) => Math.max(m, Number(l.lotSequence || 0)), 0);

  for (const lot of opts.lots) {
    mockFs._setDoc('credit_lots', lot.id, lot);
  }
  mockFs._setDoc('users', opts.uid, {
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
    hasCompletedTrialLesson: true,
    onboardingCompleted: true,
    contractedLessons: totalContracted,
    availableLessons: totalAvailable,
    residualBrlCents: opts.residualBrlCents || 0,
    creditLotsInitializedAt: '2026-10-05T10:00:00.000Z',
    activeCreditLotIds: activeIds,
    creditLotSequence: maxSeq,
  });
  mockFs._setDoc('student_assignments', opts.uid, {
    studentUid: opts.uid,
    teacherUid: opts.teacherUid,
    teacherAuthUid: opts.teacherUid,
    assignedNativeFriendUID: opts.teacherUid,
    nativeFriendUID: opts.teacherUid,
    teacherEmail: opts.teacherEmail,
    teacherName: opts.teacherName,
    enrollmentStatus: 'active',
  });
}

async function runSuite() {
  console.log('\n=========================================================================');
  console.log(' SUITE NF.SWITCH.2E — INTERFACE, PRÉVIA SERVER-SIDE E BINDING CRIPTOGRÁFICO');
  console.log('=========================================================================\n');

  const mockFs = createOccFirestoreMock();
  setFirebaseAdminFirestoreForTesting(mockFs as any);

  const tokenUsers: Record<string, any> = {
    'tok-std-a': { uid: STUDENT_A_UID, email: STUDENT_A_EMAIL, role: 'student', email_verified: true },
    'tok-std-b': { uid: STUDENT_B_UID, email: STUDENT_B_EMAIL, role: 'student', email_verified: true },
    'tok-tch-a': { uid: TEACHER_A_UID, email: TEACHER_A_EMAIL, role: 'teacher', email_verified: true },
    'tok-admin': { uid: ADMIN_UID, email: ADMIN_EMAIL, role: 'admin', email_verified: true },
  };
  setFirebaseAdminAuthForTesting({
    verifyIdToken: async (tok: string) => {
      const u = tokenUsers[tok];
      if (!u) throw new Error('Invalid token');
      return u;
    },
  } as any);

  const { app: serverApp, resetInMemoryDbForTesting } = await import('../serverApp');

  const server = http.createServer(serverApp);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));

  const resetAll = () => {
    mockFs._clear();
    resetInMemoryDbForTesting();
    clearPtaxMemoryCache();
    seedTeachers(mockFs);
    seedPtax(mockFs, PTAX_RATE);
  };

  try {
    // -------------------------------------------------------------------------
    // TEST 1: RBAC, Client Override Blocking, Read-Only & Privacy on Preview
    // -------------------------------------------------------------------------
    console.log('--- 1. Prévia HTTP: RBAC, Anti-Override, Read-Only & Privacidade ---');
    resetAll();
    {
      const rawPaidLot = makePaidLot({
        studentUid: STUDENT_A_UID,
        studentEmail: STUDENT_A_EMAIL,
        lessonsCount: 4,
        lotSequence: 1,
        idempotencyKey: 'lot-2e-1',
        sourceTransactionId: 'ftx-2e-1',
        pricedTeacherUid: TEACHER_A_UID,
        teacherEmail: TEACHER_A_EMAIL,
        teacherName: 'Teacher Arthur',
        basePriceUsd: 20,
        adminCommissionPercent: 25,
        ptaxRate: PTAX_RATE,
      });
      const consRes = consumeUnitsFromLots({
        lots: [rawPaidLot],
        units: 1,
        nowIso: '2026-10-05T11:00:00.000Z',
      });
      const paidLot = consRes.lots[0];
      const consumedUnitIdx = consRes.allocations[0]?.unitIndices?.[0] ?? 0;

      const courtesyLot = buildCourtesyGrantLotData({
        studentUid: STUDENT_A_UID,
        studentEmail: STUDENT_A_EMAIL,
        lessonsCount: 1,
        lotSequence: 2,
        nowIso: '2026-10-06T10:00:00.000Z',
        sourceTransactionId: 'ftx-crt-2e-1',
        idempotencyKey: 'crt-2e-1',
        pricedTeacherUid: TEACHER_A_UID,
        teacherEmail: TEACHER_A_EMAIL,
        teacherName: 'Teacher Arthur',
        packageName: 'Cortesia 2E',
        performedByUid: ADMIN_UID,
        performedByEmail: ADMIN_EMAIL,
        performedByRole: 'admin',
      });

      seedStudent(mockFs, {
        uid: STUDENT_A_UID,
        email: STUDENT_A_EMAIL,
        name: 'Alice Switch',
        teacherUid: TEACHER_A_UID,
        teacherEmail: TEACHER_A_EMAIL,
        teacherName: 'Teacher Arthur',
        lots: [paidLot, courtesyLot],
        residualBrlCents: 1500, // R$ 15,00 prévio
      });

      // Q2 Future lesson using unit 1 of paidLot + already started historical lesson
      mockFs._setDoc('lessons', 'les_q2_future_1', {
        id: 'les_q2_future_1',
        studentUid: STUDENT_A_UID,
        studentEmail: STUDENT_A_EMAIL,
        teacherUid: TEACHER_A_UID,
        status: 'scheduled',
        startDateTime: '2099-12-10T14:00:00.000Z',
        endDateTime: '2099-12-10T14:50:00.000Z',
        isTrialLesson: false,
        creditLotId: paidLot.id,
        creditUnitIndex: consumedUnitIdx,
      });
      mockFs._setDoc('lessons', 'les_q2_started_1', {
        id: 'les_q2_started_1',
        studentUid: STUDENT_A_UID,
        studentEmail: STUDENT_A_EMAIL,
        teacherUid: TEACHER_A_UID,
        status: 'scheduled',
        startDateTime: '2020-01-10T14:00:00.000Z',
        endDateTime: '2020-01-10T14:50:00.000Z',
        isTrialLesson: false,
      });

      // Auth & RBAC rejections
      const rUnauth = await makeRequest(server, 'POST', '/api/students/switch-native-friend/preview', {
        targetTeacherUid: TEACHER_B_UID,
      });
      check(rUnauth.status === 401, '1a. Preview sem token retorna 401');

      const rTeacher = await makeRequest(
        server,
        'POST',
        '/api/students/switch-native-friend/preview',
        { targetTeacherUid: TEACHER_B_UID },
        { Authorization: 'Bearer tok-tch-a' }
      );
      check(rTeacher.status === 403, '1b. Professor tentando prévia retorna 403');

      const rAdmin = await makeRequest(
        server,
        'POST',
        '/api/students/switch-native-friend/preview',
        { targetTeacherUid: TEACHER_B_UID },
        { Authorization: 'Bearer tok-admin' }
      );
      check(rAdmin.status === 403, '1c. Admin tentando prévia de aluno retorna 403');

      const rCross = await makeRequest(
        server,
        'POST',
        '/api/students/switch-native-friend/preview',
        { studentUid: STUDENT_A_UID, targetTeacherUid: TEACHER_B_UID },
        { Authorization: 'Bearer tok-std-b' }
      );
      check(rCross.status === 403, '1d. Aluno B tentando prévia para Aluno A retorna 403');

      const rOverride = await makeRequest(
        server,
        'POST',
        '/api/students/switch-native-friend/preview',
        { targetTeacherUid: TEACHER_B_UID, ptaxRate: 99, adminCommissionPercent: 1 },
        { Authorization: 'Bearer tok-std-a' }
      );
      check(
        rOverride.status === 400 && rOverride.data?.error === 'CLIENT_SWITCH_OVERRIDE_FORBIDDEN',
        '1e. Rejeita tentativa de override comercial/PTAX pelo cliente (400)'
      );

      const rSame = await makeRequest(
        server,
        'POST',
        '/api/students/switch-native-friend/preview',
        { targetTeacherUid: TEACHER_A_UID },
        { Authorization: 'Bearer tok-std-a' }
      );
      check(
        rSame.status === 400 && rSame.data?.error === 'SAME_TEACHER_SWITCH_FORBIDDEN',
        '1f. Impede prévia para o mesmo Amigo Nativo atual (400)'
      );

      const rUnapp = await makeRequest(
        server,
        'POST',
        '/api/students/switch-native-friend/preview',
        { targetTeacherUid: TEACHER_UNAPPROVED_UID },
        { Authorization: 'Bearer tok-std-a' }
      );
      check(
        rUnapp.status === 403 && rUnapp.data?.error === 'TUTOR_NOT_APPROVED',
        '1g. Rejeita prévia para Amigo Nativo não aprovado (403)'
      );

      // Snapshot before read-only preview
      const snapBefore = JSON.stringify(mockFs._snapshotStore());
      const prevRes = await makeRequest(
        server,
        'POST',
        '/api/students/switch-native-friend/preview',
        { targetTeacherUid: TEACHER_B_UID },
        { Authorization: 'Bearer tok-std-a' }
      );
      const snapAfter = JSON.stringify(mockFs._snapshotStore());

      const p: SwitchPreviewResponseDto = prevRes.data;
      check(
        prevRes.status === 200 && p.success === true && p.readOnly === true && snapBefore === snapAfter,
        '1h. Prévia retorna 200 e mantém Firestore 100% read-only (zero escritas)'
      );

      // Check Q2 + 2C math inside preview:
      // Paid lot: 3 remaining + 1 Q2 refunded (11875c) = 47500c budget; Teacher B unit = 18000c
      // Best for 47500c -> 2 * 18000c = 36000c, switchResidual = 11500c, + prev 1500c = 13000c; courtesy = 1
      check(
        p.status === 'READY' &&
          p.canConfirm === true &&
          Boolean(p.previewToken) &&
          Boolean(p.previewSnapshotHash) &&
          p.q2.cancelledLessonsCount === 1 &&
          p.q2.refundedCreditsCount === 1 &&
          p.q2.lockedStartedLessonsCount === 1 &&
          p.balances.budgetBrlCents === 47500 &&
          p.balances.convertedPaidLessonsCount === 2 &&
          p.balances.courtesyTransferredLessonsCount === 1 &&
          p.balances.availableLessonsAfterSwitch === 3 &&
          p.balances.residualBrlCentsBefore === 1500 &&
          p.balances.switchResidualBrlCents === 11500 &&
          p.balances.residualBrlCentsAfter === 13000 &&
          p.balances.additionalCostBrlCents === 0 &&
          p.balances.courtesyFinancialValueBrlCents === 0,
        '1i. Prévia calcula Q2, conversão 2C, cortesia 1:1 e resíduo cumulativo idênticos ao motor',
        JSON.stringify({ q2: p.q2, balances: p.balances })
      );

      // Privacy check: ZERO leaked commission/platform/USD base fields
      const leakedKeys = collectNestedKeys(p);
      const forbiddenPreviewKeys = [
        ...ADMIN_COMMISSION_KEYS,
        'teacherShareBrlCents',
        'teacherShareUsdCents',
        'platformRevenueBrlCents',
        'platformRevenueUsdCents',
        'basePriceUsd',
        'pricePerSessionUsd',
      ];
      const leakedFound = forbiddenPreviewKeys.filter((k) => leakedKeys.has(k));
      check(
        leakedFound.length === 0,
        '1j. Privacidade estrita: prévia não vaza comissão, base USD nem split professor/plataforma',
        leakedFound.join(', ')
      );
    }

    // -------------------------------------------------------------------------
    // TEST 2: Blocked Previews (legacy_unreconciled + insufficient budget) & Zero-Credit Student
    // -------------------------------------------------------------------------
    console.log('\n--- 2. Prévia em Estados Bloqueados e Aluno Zero-Crédito Pós-Trial ---');
    resetAll();
    {
      // 2a. Legacy unreconciled blocked preview
      const legacyLot = buildLegacyUnreconciledLotData({
        studentUid: STUDENT_A_UID,
        studentEmail: STUDENT_A_EMAIL,
        lessonsCount: 2,
        lotSequence: 1,
        nowIso: '2026-10-01T10:00:00.000Z',
      });
      seedStudent(mockFs, {
        uid: STUDENT_A_UID,
        email: STUDENT_A_EMAIL,
        name: 'Alice Legacy',
        teacherUid: TEACHER_A_UID,
        teacherEmail: TEACHER_A_EMAIL,
        teacherName: 'Teacher Arthur',
        lots: [legacyLot],
      });
      const legPrev = await makeRequest(
        server,
        'POST',
        '/api/students/switch-native-friend/preview',
        { targetTeacherUid: TEACHER_B_UID },
        { Authorization: 'Bearer tok-std-a' }
      );
      check(
        legPrev.status === 200 &&
          legPrev.data.status === 'BLOCKED' &&
          legPrev.data.canConfirm === false &&
          legPrev.data.previewToken === null &&
          legPrev.data.previewSnapshotHash === null &&
          Array.isArray(legPrev.data.blockingCodes) &&
          legPrev.data.blockingCodes.includes('LEGACY_UNRECONCILED_PRESENT'),
        '2a. Créditos legados retornam prévia BLOCKED sem token de confirmação',
        JSON.stringify(legPrev.data?.blockingCodes)
      );

      // 2b. Insufficient budget for 1 lesson (10000c paid vs 18000c target unit)
      const cheapLot = makePaidLot({
        studentUid: STUDENT_B_UID,
        studentEmail: STUDENT_B_EMAIL,
        lessonsCount: 1,
        lotSequence: 1,
        idempotencyKey: 'lot-cheap-1',
        sourceTransactionId: 'ftx-cheap-1',
        pricedTeacherUid: TEACHER_C_UID,
        teacherEmail: TEACHER_C_EMAIL,
        teacherName: 'Teacher Carlos',
        basePriceUsd: 16,
        adminCommissionPercent: 25,
        ptaxRate: PTAX_RATE, // 10000c
      });
      seedStudent(mockFs, {
        uid: STUDENT_B_UID,
        email: STUDENT_B_EMAIL,
        name: 'Bruno Insuf',
        teacherUid: TEACHER_C_UID,
        teacherEmail: TEACHER_C_EMAIL,
        teacherName: 'Teacher Carlos',
        lots: [cheapLot],
      });
      const insRes = await makeRequest(
        server,
        'POST',
        '/api/students/switch-native-friend/preview',
        { targetTeacherUid: TEACHER_B_UID },
        { Authorization: 'Bearer tok-std-b' }
      );
      check(
        insRes.status === 200 &&
          insRes.data.status === 'BLOCKED' &&
          insRes.data.canConfirm === false &&
          insRes.data.previewToken === null &&
          insRes.data.blockingCodes.includes('INSUFFICIENT_BUDGET_FOR_MINIMUM_LESSON'),
        '2b. Orçamento insuficiente para 1 aula retorna BLOCKED com INSUFFICIENT_BUDGET_FOR_MINIMUM_LESSON'
      );

      // 2c. Zero-credit post-trial student returns READY cleanly
      resetAll();
      seedStudent(mockFs, {
        uid: STUDENT_B_UID,
        email: STUDENT_B_EMAIL,
        name: 'Bruno ZeroCredit',
        teacherUid: TEACHER_A_UID,
        teacherEmail: TEACHER_A_EMAIL,
        teacherName: 'Teacher Arthur',
        lots: [],
      });
      const zeroPrev = await makeRequest(
        server,
        'POST',
        '/api/students/switch-native-friend/preview',
        { targetTeacherUid: TEACHER_B_UID },
        { Authorization: 'Bearer tok-std-b' }
      );
      check(
        zeroPrev.status === 200 &&
          zeroPrev.data.status === 'READY' &&
          zeroPrev.data.canConfirm === true &&
          Boolean(zeroPrev.data.previewToken) &&
          zeroPrev.data.balances.availableLessonsAfterSwitch === 0,
        '2c. Aluno pós-trial com 0 créditos recebe prévia READY confirmável sem custo'
      );
    }

    // -------------------------------------------------------------------------
    // TEST 3: Cryptographic Binding Rejections (Tamper, Expiry, Stale State)
    // -------------------------------------------------------------------------
    console.log('\n--- 3. Binding Prévia -> Confirmação: Rejeição de Adulteração e Mudanças Pós-Prévia ---');
    resetAll();
    {
      const paidLot = makePaidLot({
        studentUid: STUDENT_A_UID,
        studentEmail: STUDENT_A_EMAIL,
        lessonsCount: 4,
        lotSequence: 1,
        idempotencyKey: 'lot-bind-1',
        sourceTransactionId: 'ftx-bind-1',
        pricedTeacherUid: TEACHER_A_UID,
        teacherEmail: TEACHER_A_EMAIL,
        teacherName: 'Teacher Arthur',
        basePriceUsd: 20,
        adminCommissionPercent: 25,
        ptaxRate: PTAX_RATE,
      });
      seedStudent(mockFs, {
        uid: STUDENT_A_UID,
        email: STUDENT_A_EMAIL,
        name: 'Alice Bound',
        teacherUid: TEACHER_A_UID,
        teacherEmail: TEACHER_A_EMAIL,
        teacherName: 'Teacher Arthur',
        lots: [paidLot],
      });
      seedStudent(mockFs, {
        uid: STUDENT_B_UID,
        email: STUDENT_B_EMAIL,
        name: 'Bruno Other',
        teacherUid: TEACHER_A_UID,
        teacherEmail: TEACHER_A_EMAIL,
        teacherName: 'Teacher Arthur',
        lots: [],
      });

      const baseNowIso = '2026-11-18T12:00:00.000Z';
      const prevOut = await previewNativeFriendSwitchServer({
        studentAuthUid: STUDENT_A_UID,
        studentEmail: STUDENT_A_EMAIL,
        targetTeacherId: TEACHER_B_UID,
        nowOverrideIso: baseNowIso,
        ptaxOverride: { success: true, ptaxRate: PTAX_RATE, quoteDate: '2026-11-17', pricingDate: '2026-11-18' },
      });
      const p = prevOut.preview!;

      // 3a. Incomplete binding
      const rIncomp = await makeRequest(
        server,
        'POST',
        '/api/students/switch-native-friend',
        { targetTeacherUid: TEACHER_B_UID, idempotencyKey: 'bind-incomp', previewToken: p.previewToken },
        { Authorization: 'Bearer tok-std-a' }
      );
      check(
        rIncomp.status === 400 && rIncomp.data?.error === 'PREVIEW_BINDING_INCOMPLETE',
        '3a. Enviar previewToken sem previewSnapshotHash retorna 400 PREVIEW_BINDING_INCOMPLETE'
      );

      // 3b. Tampered hash
      const rTamper = await makeRequest(
        server,
        'POST',
        '/api/students/switch-native-friend',
        {
          targetTeacherUid: TEACHER_B_UID,
          idempotencyKey: 'bind-tamper',
          previewToken: p.previewToken,
          previewSnapshotHash: '0'.repeat(64),
        },
        { Authorization: 'Bearer tok-std-a' }
      );
      check(
        rTamper.status === 409 && rTamper.data?.error === 'PREVIEW_BINDING_INVALID',
        '3b. Hash adulterado rejeitado com 409 PREVIEW_BINDING_INVALID'
      );

      // 3c. Cross-student token reuse
      const rCrossTok = await makeRequest(
        server,
        'POST',
        '/api/students/switch-native-friend',
        {
          targetTeacherUid: TEACHER_B_UID,
          idempotencyKey: 'bind-cross',
          previewToken: p.previewToken,
          previewSnapshotHash: p.previewSnapshotHash,
        },
        { Authorization: 'Bearer tok-std-b' }
      );
      check(
        rCrossTok.status === 409 && rCrossTok.data?.error === 'PREVIEW_BINDING_INVALID',
        '3c. Token de prévia do Aluno A rejeitado para Aluno B (409 PREVIEW_BINDING_INVALID)'
      );

      // 3d. Target teacher mismatch
      const rMismatch = await makeRequest(
        server,
        'POST',
        '/api/students/switch-native-friend',
        {
          targetTeacherUid: TEACHER_C_UID,
          idempotencyKey: 'bind-target-mismatch',
          previewToken: p.previewToken,
          previewSnapshotHash: p.previewSnapshotHash,
        },
        { Authorization: 'Bearer tok-std-a' }
      );
      check(
        rMismatch.status === 409 && rMismatch.data?.error === 'PREVIEW_TARGET_MISMATCH',
        '3d. Confirmar destino diferente do pré-visualizado retorna 409 PREVIEW_TARGET_MISMATCH'
      );

      // 3e. Expired preview (>10 min later)
      const rExpired = await switchNativeFriendAtomicServer({
        studentAuthUid: STUDENT_A_UID,
        studentEmail: STUDENT_A_EMAIL,
        targetTeacherId: TEACHER_B_UID,
        idempotencyKey: 'bind-expired',
        previewToken: p.previewToken!,
        previewSnapshotHash: p.previewSnapshotHash!,
        nowOverrideIso: '2026-11-18T12:15:00.000Z',
        ptaxOverride: { success: true, ptaxRate: PTAX_RATE, quoteDate: '2026-11-17', pricingDate: '2026-11-18' },
      });
      check(
        !rExpired.success && rExpired.statusCode === 409 && rExpired.code === 'PREVIEW_EXPIRED',
        '3e. Prévia expirada (>10 min) rejeitada antes da execução com 409 PREVIEW_EXPIRED'
      );

      // 3f. PTAX changed before confirmation -> PREVIEW_STALE_PTAX_CHANGED + zero writes
      const snapBeforeStale = JSON.stringify(mockFs._snapshotStore());
      const rPtaxChanged = await switchNativeFriendAtomicServer({
        studentAuthUid: STUDENT_A_UID,
        studentEmail: STUDENT_A_EMAIL,
        targetTeacherId: TEACHER_B_UID,
        idempotencyKey: 'bind-ptax-stale',
        previewToken: p.previewToken!,
        previewSnapshotHash: p.previewSnapshotHash!,
        nowOverrideIso: '2026-11-18T12:02:00.000Z',
        ptaxOverride: { success: true, ptaxRate: 5.5, quoteDate: '2026-11-18', pricingDate: '2026-11-19' },
      });
      check(
        !rPtaxChanged.success &&
          rPtaxChanged.statusCode === 409 &&
          rPtaxChanged.code === 'PREVIEW_STALE_PTAX_CHANGED' &&
          JSON.stringify(mockFs._snapshotStore()) === snapBeforeStale,
        '3f. Alteração de PTAX D-1 entre prévia e confirmação rejeitada (409 PREVIEW_STALE_PTAX_CHANGED) sem escritas'
      );

      // 3g. Target teacher price changed before confirmation -> PREVIEW_STALE_PRICE_CHANGED
      mockFs._setDoc('tutors', TEACHER_B_UID, {
        ...mockFs._getDoc('tutors', TEACHER_B_UID),
        basePriceUsd: 35,
        pricePerSessionUsd: 35,
      });
      mockFs._setDoc('users', TEACHER_B_UID, {
        ...mockFs._getDoc('users', TEACHER_B_UID),
        basePriceUsd: 35,
        pricePerSessionUsd: 35,
      });
      const rPriceChanged = await switchNativeFriendAtomicServer({
        studentAuthUid: STUDENT_A_UID,
        studentEmail: STUDENT_A_EMAIL,
        targetTeacherId: TEACHER_B_UID,
        idempotencyKey: 'bind-price-stale',
        previewToken: p.previewToken!,
        previewSnapshotHash: p.previewSnapshotHash!,
        nowOverrideIso: '2026-11-18T12:02:00.000Z',
        ptaxOverride: { success: true, ptaxRate: PTAX_RATE, quoteDate: '2026-11-17', pricingDate: '2026-11-18' },
      });
      check(
        !rPriceChanged.success && rPriceChanged.statusCode === 409 && rPriceChanged.code === 'PREVIEW_STALE_PRICE_CHANGED',
        '3g. Alteração de preço do professor destino rejeitada (409 PREVIEW_STALE_PRICE_CHANGED)'
      );
      seedTeachers(mockFs); // restore price

      // 3h. New lesson scheduled between preview and confirmation -> PREVIEW_STALE_LESSONS_CHANGED
      mockFs._setDoc('lessons', 'les_midflight_1', {
        id: 'les_midflight_1',
        studentUid: STUDENT_A_UID,
        studentEmail: STUDENT_A_EMAIL,
        teacherUid: TEACHER_A_UID,
        status: 'scheduled',
        startDateTime: '2099-12-20T14:00:00.000Z',
        endDateTime: '2099-12-20T14:50:00.000Z',
        isTrialLesson: false,
      });
      const rLessonsChanged = await switchNativeFriendAtomicServer({
        studentAuthUid: STUDENT_A_UID,
        studentEmail: STUDENT_A_EMAIL,
        targetTeacherId: TEACHER_B_UID,
        idempotencyKey: 'bind-lessons-stale',
        previewToken: p.previewToken!,
        previewSnapshotHash: p.previewSnapshotHash!,
        nowOverrideIso: '2026-11-18T12:02:00.000Z',
        ptaxOverride: { success: true, ptaxRate: PTAX_RATE, quoteDate: '2026-11-17', pricingDate: '2026-11-18' },
      });
      check(
        !rLessonsChanged.success &&
          rLessonsChanged.statusCode === 409 &&
          rLessonsChanged.code === 'PREVIEW_STALE_LESSONS_CHANGED',
        '3h. Nova aula agendada entre prévia e confirmação rejeitada (409 PREVIEW_STALE_LESSONS_CHANGED)'
      );
      mockFs._deleteDoc('lessons', 'les_midflight_1');

      // 3i. Residual/balance changed between preview and confirmation -> PREVIEW_STALE_BALANCE_CHANGED
      mockFs._setDoc('users', STUDENT_A_UID, {
        ...mockFs._getDoc('users', STUDENT_A_UID),
        residualBrlCents: 999,
      });
      const rBalChanged = await switchNativeFriendAtomicServer({
        studentAuthUid: STUDENT_A_UID,
        studentEmail: STUDENT_A_EMAIL,
        targetTeacherId: TEACHER_B_UID,
        idempotencyKey: 'bind-balance-stale',
        previewToken: p.previewToken!,
        previewSnapshotHash: p.previewSnapshotHash!,
        nowOverrideIso: '2026-11-18T12:02:00.000Z',
        ptaxOverride: { success: true, ptaxRate: PTAX_RATE, quoteDate: '2026-11-17', pricingDate: '2026-11-18' },
      });
      check(
        !rBalChanged.success && rBalChanged.statusCode === 409 && rBalChanged.code === 'PREVIEW_STALE_BALANCE_CHANGED',
        '3i. Alteração de saldo/resíduo entre prévia e confirmação rejeitada (409 PREVIEW_STALE_BALANCE_CHANGED)'
      );
    }

    // -------------------------------------------------------------------------
    // TEST 4: Full HTTP End-to-End Bound Flow (Preview -> Confirm -> Idempotent Replay)
    // -------------------------------------------------------------------------
    console.log('\n--- 4. Fluxo HTTP E2E Completo: Prévia -> Confirmação Vinculada -> Idempotência ---');
    resetAll();
    {
      const paidLot = makePaidLot({
        studentUid: STUDENT_A_UID,
        studentEmail: STUDENT_A_EMAIL,
        lessonsCount: 4,
        lotSequence: 1,
        idempotencyKey: 'lot-e2e-2e',
        sourceTransactionId: 'ftx-e2e-2e',
        pricedTeacherUid: TEACHER_A_UID,
        teacherEmail: TEACHER_A_EMAIL,
        teacherName: 'Teacher Arthur',
        basePriceUsd: 20,
        adminCommissionPercent: 25,
        ptaxRate: PTAX_RATE,
      });
      seedStudent(mockFs, {
        uid: STUDENT_A_UID,
        email: STUDENT_A_EMAIL,
        name: 'Alice E2E',
        teacherUid: TEACHER_A_UID,
        teacherEmail: TEACHER_A_EMAIL,
        teacherName: 'Teacher Arthur',
        lots: [paidLot],
      });

      const prevHttp = await makeRequest(
        server,
        'POST',
        '/api/students/switch-native-friend/preview',
        { targetTeacherUid: TEACHER_C_UID },
        { Authorization: 'Bearer tok-std-a' }
      );
      const previewDto: SwitchPreviewResponseDto = prevHttp.data;

      // 47500c budget with Carlos (R$ 100/unit):
      // 4x pack = 4 * 10000 * 0.95 = 38000c; remaining = 9500c < 10000c
      check(
        prevHttp.status === 200 &&
          previewDto.status === 'READY' &&
          previewDto.balances.convertedPaidLessonsCount === 4 &&
          previewDto.balances.switchResidualBrlCents === 9500 &&
          previewDto.packageComposition.some((line) => line.packageSize === 4 && line.quantity === 1),
        '4a. Prévia HTTP E2E para Teacher Carlos compõe pacote 4 aulas (5% OFF) + R$ 95,00 resíduo'
      );

      const confirmHttp = await makeRequest(
        server,
        'POST',
        '/api/students/switch-native-friend',
        {
          targetTeacherUid: TEACHER_C_UID,
          expectedCurrentTeacherUid: TEACHER_A_UID,
          previewToken: previewDto.previewToken,
          previewSnapshotHash: previewDto.previewSnapshotHash,
          idempotencyKey: 'http-bound-switch-1',
        },
        { Authorization: 'Bearer tok-std-a' }
      );
      const confirmLeakedKeys = collectNestedKeys(confirmHttp.data);
      const forbiddenConfirmKeys = [
        ...ADMIN_COMMISSION_KEYS,
        'targetAdminCommissionPercent',
        'targetCommissionModel',
        'targetCommissionVersion',
        'targetBasePriceUsd',
        'basePriceUsd',
        'pricePerSessionUsd',
        'teacherShareBrlCents',
        'teacherShareUsdCents',
        'platformRevenueBrlCents',
        'platformRevenueUsdCents',
        'totalPaidUsdCents',
        'immediateTargetTeacherPayoutDueBrlCents',
      ];
      const confirmLeaksFound = forbiddenConfirmKeys.filter((k) => confirmLeakedKeys.has(k));
      check(
        confirmHttp.status === 200 &&
          confirmHttp.data.success === true &&
          confirmHttp.data.availableLessonsAfterSwitch === previewDto.balances.availableLessonsAfterSwitch &&
          confirmHttp.data.residualBrlCentsAfter === previewDto.balances.residualBrlCentsAfter &&
          confirmHttp.data.audit?.previewSnapshotHash === previewDto.previewSnapshotHash &&
          confirmLeaksFound.length === 0 &&
          mockFs._listCol('financial_transactions').length === 0,
        '4b. Confirmação HTTP vinculada espelha valores exatos da prévia, grava previewSnapshotHash, não vaza dados sensíveis e gera 0 receita artificial',
        confirmLeaksFound.length > 0 ? `Vazamentos: ${confirmLeaksFound.join(', ')}` : undefined
      );

      // Replay exact same key & preview -> 200 isIdempotent: true
      const replayHttp = await makeRequest(
        server,
        'POST',
        '/api/students/switch-native-friend',
        {
          targetTeacherUid: TEACHER_C_UID,
          expectedCurrentTeacherUid: TEACHER_A_UID,
          previewToken: previewDto.previewToken,
          previewSnapshotHash: previewDto.previewSnapshotHash,
          idempotencyKey: 'http-bound-switch-1',
        },
        { Authorization: 'Bearer tok-std-a' }
      );
      check(
        replayHttp.status === 200 &&
          replayHttp.data.isIdempotent === true &&
          replayHttp.data.switchAuditId === confirmHttp.data.switchAuditId,
        '4c. Replay idempotente da mesma confirmação retorna 200 { isIdempotent: true }'
      );

      // Same key with tampered/different snapshot hash -> 409 IDEMPOTENCY_KEY_CONFLICT
      const conflictKeyHttp = await makeRequest(
        server,
        'POST',
        '/api/students/switch-native-friend',
        {
          targetTeacherUid: TEACHER_C_UID,
          expectedCurrentTeacherUid: TEACHER_A_UID,
          idempotencyKey: 'http-bound-switch-1',
        },
        { Authorization: 'Bearer tok-std-a' }
      );
      check(
        conflictKeyHttp.status === 409 && conflictKeyHttp.data?.error === 'IDEMPOTENCY_KEY_CONFLICT',
        '4d. Reuso da mesma idempotencyKey com payload/hash distinto rejeitado com 409 IDEMPOTENCY_KEY_CONFLICT'
      );
    }

    // -------------------------------------------------------------------------
    // TEST 5: SSR Rendering (PT/EN, Ready, Blocked, Stale Error, Success) & Hygiene
    // -------------------------------------------------------------------------
    console.log('\n--- 5. Validação SSR Bilíngue PT/EN e Higiene de UI ---');
    {
      const sampleTutors: NativeFriendTutor[] = [
        {
          id: TEACHER_A_UID,
          uid: TEACHER_A_UID,
          name: 'Teacher Arthur',
          email: TEACHER_A_EMAIL,
          country: 'USA',
          flag: '🇺🇸',
          accent: 'American English',
          headline: 'Conversational fluency',
          bio: 'Native tutor',
          rating: 5,
          reviewsCount: 12,
          specialties: ['Daily Life'],
          avatar: '',
          approvalStatus: 'approved',
        },
        {
          id: TEACHER_B_UID,
          uid: TEACHER_B_UID,
          name: 'Teacher Beth',
          email: TEACHER_B_EMAIL,
          country: 'UK',
          flag: '🇬🇧',
          accent: 'British English',
          headline: 'Business & pronunciation',
          bio: 'Native tutor',
          rating: 5,
          reviewsCount: 20,
          specialties: ['Business'],
          avatar: '',
          approvalStatus: 'approved',
        },
      ];

      const readyPreview: SwitchPreviewResponseDto = {
        success: true,
        readOnly: true,
        status: 'READY',
        canConfirm: true,
        previewToken: 'mock.tok',
        previewSnapshotHash: 'abc123',
        issuedAt: '2026-11-18T12:00:00.000Z',
        expiresAt: '2026-11-18T12:10:00.000Z',
        studentUid: STUDENT_A_UID,
        sourceTeacher: { uid: TEACHER_A_UID, email: TEACHER_A_EMAIL, name: 'Teacher Arthur' },
        targetTeacher: {
          uid: TEACHER_B_UID,
          publicTutorId: 'tutor-beth-2e',
          email: TEACHER_B_EMAIL,
          name: 'Teacher Beth',
          unitFinalPriceBrlCents: 18000,
          lowestEffectiveLessonPriceBrlCents: 15300,
        },
        ptax: { rate: 5.0, quoteDate: '2026-11-17', pricingDate: '2026-11-18', source: PTAX_SOURCE_LABEL },
        q2: {
          cancelledLessons: [
            {
              id: 'les-1',
              startDateTime: '2026-12-10T14:00:00.000Z',
              endDateTime: '2026-12-10T14:50:00.000Z',
              isTrialLesson: false,
              creditOrigin: 'paid',
              creditRefundedToLot: true,
            },
          ],
          cancelledLessonsCount: 1,
          refundedCreditsCount: 1,
          cancelledTrialLessonsCount: 0,
          lockedStartedLessonsCount: 1,
        },
        balances: {
          availableLessonsBefore: 3,
          availableLessonsAfterRefunds: 4,
          availablePaidLessonsAvailableForConversion: 3,
          availableCourtesyLessonsAvailableForTransfer: 1,
          remainingLegacyUnitsCount: 0,
          budgetBrlCents: 47500,
          convertedPaidLessonsCount: 2,
          courtesyTransferredLessonsCount: 1,
          availableLessonsAfterSwitch: 3,
          convertedTotalBrlCents: 36000,
          residualBrlCentsBefore: 1500,
          switchResidualBrlCents: 11500,
          residualBrlCentsAfter: 13000,
          additionalCostBrlCents: 0,
          courtesyFinancialValueBrlCents: 0,
        },
        packageComposition: [
          {
            packageSize: 1,
            quantity: 2,
            lessonsSubtotal: 2,
            discountPercent: 0,
            unitPackagePriceBrlCents: 18000,
            totalPriceBrlCents: 36000,
          },
        ],
        targetPackagesTable: [],
        paidConversionOutcome: 'CONVERTED',
        blockingCodes: [],
        blockingReasons: [],
        warnings: [],
      };

      const studentProfileSample: any = {
        id: STUDENT_A_UID,
        uid: STUDENT_A_UID,
        name: 'Alice Switch',
        email: STUDENT_A_EMAIL,
        teacherUid: TEACHER_A_UID,
        teacherEmail: TEACHER_A_EMAIL,
        teacherName: 'Teacher Arthur',
        enrollmentStatus: 'active',
        availableLessons: 3,
        residualBrlCents: 13000,
      };

      const ptReadyHtml = renderToString(
        React.createElement(SwitchNativeFriendModal, {
          isOpen: true,
          onClose: () => {},
          userProfile: studentProfileSample,
          tutorsList: sampleTutors,
          currentLanguage: 'pt',
          initialTargetTutor: sampleTutors[1],
          initialPreviewStateForTest: readyPreview,
        })
      );
      check(
        ptReadyHtml.includes('Trocar de Amigo Nativo') &&
          ptReadyHtml.includes('Teacher Arthur') &&
          ptReadyHtml.includes('Teacher Beth') &&
          ptReadyHtml.includes('Aulas Agendadas (Regra Q2)') &&
          ptReadyHtml.includes('Novos Créditos Pagos') &&
          ptReadyHtml.includes('Cortesias Transferidas (1:1)') &&
          ptReadyHtml.includes('Saldo Residual (R$)') &&
          ptReadyHtml.includes('Confirmar Troca de Amigo Nativo') &&
          !ptReadyHtml.includes('adminCommissionPercent') &&
          !ptReadyHtml.includes('teacherShare'),
        '5a. SwitchNativeFriendModal PT renderiza prévia completa com Q2, pacotes, cortesias e resíduo sem vazar comissão'
      );

      const enReadyHtml = renderToString(
        React.createElement(SwitchNativeFriendModal, {
          isOpen: true,
          onClose: () => {},
          userProfile: studentProfileSample,
          tutorsList: sampleTutors,
          currentLanguage: 'en',
          initialTargetTutor: sampleTutors[1],
          initialPreviewStateForTest: readyPreview,
        })
      );
      check(
        enReadyHtml.includes('Switch Native Friend') &&
          enReadyHtml.includes('Scheduled Lessons Impact (Q2 Rule)') &&
          enReadyHtml.includes('New Paid Credits') &&
          enReadyHtml.includes('Courtesy Credits (1:1)') &&
          enReadyHtml.includes('Residual BRL Balance') &&
          enReadyHtml.includes('Confirm Native Friend Switch'),
        '5b. SwitchNativeFriendModal EN renderiza integralmente traduzido'
      );

      const blockedHtml = renderToString(
        React.createElement(SwitchNativeFriendModal, {
          isOpen: true,
          onClose: () => {},
          userProfile: studentProfileSample,
          tutorsList: sampleTutors,
          currentLanguage: 'pt',
          initialTargetTutor: sampleTutors[1],
          initialPreviewStateForTest: {
            ...readyPreview,
            status: 'BLOCKED',
            canConfirm: false,
            previewToken: null,
            previewSnapshotHash: null,
            blockingCodes: ['LEGACY_UNRECONCILED_PRESENT'],
            blockingReasons: [{ code: 'LEGACY_UNRECONCILED_PRESENT', message: 'Legacy blocked' }],
          },
        })
      );
      check(
        blockedHtml.includes('switch-preview-blocked') &&
          blockedHtml.includes('Troca Bloqueada por Regra de Integridade') &&
          !blockedHtml.includes('Confirmo a troca do meu Amigo Nativo'),
        '5c. Estado BLOCKED exibe bloqueio claro e oculta checkbox de confirmação'
      );

      const staleErrorHtml = renderToString(
        React.createElement(SwitchNativeFriendModal, {
          isOpen: true,
          onClose: () => {},
          userProfile: studentProfileSample,
          tutorsList: sampleTutors,
          currentLanguage: 'en',
          initialTargetTutor: sampleTutors[1],
          initialPreviewStateForTest: readyPreview,
          initialErrorStateForTest: getBilingualSwitchError('PREVIEW_STALE_PTAX_CHANGED', '', true),
        })
      );
      check(
        staleErrorHtml.includes('Official PTAX Rate Updated') &&
          staleErrorHtml.includes('Refresh Server Preview'),
        '5d. Erro de prévia desatualizada (PTAX/Saldo/Aulas) exibe ação de atualização da prévia'
      );

      const successSummary: SwitchExecuteResponseDto = {
        success: true,
        isIdempotent: false,
        switchAuditId: 'switch_audit_e2e_1',
        studentUid: STUDENT_A_UID,
        sourceTeacherUid: TEACHER_A_UID,
        targetTeacherUid: TEACHER_B_UID,
        targetTeacherEmail: TEACHER_B_EMAIL,
        targetTeacherName: 'Teacher Beth',
        targetTeacherMeetUrl: '',
        availableLessonsBefore: 3,
        availableLessonsAfterRefunds: 4,
        availableLessonsAfterSwitch: 3,
        residualBrlCentsBefore: 1500,
        switchResidualBrlCents: 11500,
        residualBrlCentsAfter: 13000,
        q2CancelledLessonsCount: 1,
        q2RefundedCreditsCount: 1,
        q2CancelledTrialLessonsCount: 0,
        lockedStartedLessonsCount: 1,
      };
      const successHtml = renderToString(
        React.createElement(SwitchNativeFriendModal, {
          isOpen: true,
          onClose: () => {},
          userProfile: studentProfileSample,
          tutorsList: sampleTutors,
          currentLanguage: 'pt',
          initialSuccessStateForTest: successSummary,
        })
      );
      check(
        successHtml.includes('switch-success-summary') &&
          successHtml.includes('switch_audit_e2e_1') &&
          successHtml.includes('Teacher Beth'),
        '5e. Resumo pós-troca exibe auditoria, créditos finais e novo Amigo Nativo'
      );

      // Selector mode (no target pre-selected) excludes current teacher
      const selectorHtml = renderToString(
        React.createElement(SwitchNativeFriendModal, {
          isOpen: true,
          onClose: () => {},
          userProfile: studentProfileSample,
          tutorsList: sampleTutors,
          currentLanguage: 'pt',
        })
      );
      const selectorBody = selectorHtml.split('data-testid="switch-tutor-selector"')[1] || '';
      check(
        selectorHtml.includes('switch-tutor-selector') &&
          selectorBody.includes('Teacher Beth') &&
          !selectorBody.includes('Teacher Arthur') &&
          selectorBody.includes('Simular Troca'),
        '5f. Seletor de destino renderiza outros Amigos Nativos aprovados excluindo o atual'
      );

      // StudentHeaderSection shows Switch button + Residual credit
      const headerHtml = renderToString(
        React.createElement(StudentHeaderSection, {
          lessons: [],
          currentAccount: { id: STUDENT_A_UID, uid: STUDENT_A_UID, name: 'Alice', email: STUDENT_A_EMAIL, role: 'student' },
          userProfile: studentProfileSample,
          teachers: [{ name: 'Teacher Arthur', email: TEACHER_A_EMAIL, role: 'teacher' }],
          onOpenScheduleModal: () => {},
          onOpenManageSubscription: () => {},
          onOpenSwitchNativeFriend: () => {},
          currentLanguage: 'pt',
          t: getTranslations('pt'),
        })
      );
      check(
        headerHtml.includes('student-header-switch-btn') &&
          headerHtml.includes('student-residual-balance') &&
          headerHtml.includes('Crédito residual:'),
        '5g. StudentHeaderSection exibe botão Trocar e crédito residual separado de aulas disponíveis'
      );

      // ManageSubscriptionModal renders cleanly and delegates active switch
      const manageHtml = renderToString(
        React.createElement(ManageSubscriptionModal, {
          isOpen: true,
          onClose: () => {},
          userProfile: studentProfileSample,
          tutorsList: sampleTutors,
          teachers: [],
          currentLanguage: 'pt',
          onUpdateSubscription: async () => {},
          onRequestSwitchNativeFriend: () => {},
        })
      );
      check(
        manageHtml.includes('Substituir Amigo Nativo') &&
          manageHtml.includes('Cancelar Inscrição'),
        '5h. ManageSubscriptionModal preserva layout existente e integra entrada de troca 2E'
      );

      // Source hygiene checks
      const modalSrc = fs.readFileSync(path.join(process.cwd(), 'src/components/SwitchNativeFriendModal.tsx'), 'utf8');
      const clientSrc = fs.readFileSync(path.join(process.cwd(), 'src/utils/nativeFriendSwitchClient.ts'), 'utf8');
      check(
        !modalSrc.includes('window.alert') &&
          !modalSrc.includes('window.confirm') &&
          !modalSrc.includes('window.open') &&
          !modalSrc.includes('adminCommissionPercent') &&
          !modalSrc.includes('teacherShare') &&
          !modalSrc.includes('platformRevenue') &&
          !clientSrc.includes('adminCommissionPercent') &&
          !clientSrc.includes('calculateFinancialPricingQuote'),
        '5i. Zero window.alert/confirm/open e zero cálculo financeiro ou comissão no frontend 2E'
      );
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    resetFirebaseAdminFirestoreForTesting();
    resetFirebaseAdminForTesting();
    resetInMemoryDbForTesting();
    clearPtaxMemoryCache();
  }

  console.log('\n=========================================================================');
  console.log(` RESULTADO NF.SWITCH.2E: ${passed} passed, ${failed} failed`);
  console.log('=========================================================================\n');
  if (failed > 0) process.exit(1);
}

runSuite().catch((err) => {
  console.error('Erro fatal na suíte NF.SWITCH.2E:', err);
  process.exit(1);
});
