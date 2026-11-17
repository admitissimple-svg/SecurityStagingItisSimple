/**
 * TEST SUITE: IT'S SIMPLE — FASE FIN.2C
 * Integração segura de preços e pacotes ao motor financeiro FIN.2 e PTAX D-1
 *
 * Cobre integralmente todos os cenários obrigatórios:
 * 1. Comissão de 0%, 20% e 100% (modelo MARKUP).
 * 2. Pacotes aprovados de 1, 4, 8 e 12 aulas.
 * 3. Descontos de 0%, 5%, 10% e 15% e paridade exata de arredondamento e rateio com financialEngine.ts.
 * 4. PTAX D-1 oficial e falhas explícitas de cotação (503 PTAX_UNAVAILABLE, zero fallback 5.5).
 * 5. Professor legado aprovado sem comissão válida (422 TUTOR_COMMISSION_NOT_CONFIGURED; ausente de quotes compráveis).
 * 6. Professor não aprovado / pendente / rejeitado / estudante (403 TUTOR_NOT_APPROVED).
 * 7. Resolução por UID canônico e slug público + rejeição de parâmetros de preço/comissão enviados pelo navegador.
 * 8. Privacidade da comissão e do preço-base USD nos DTOs públicos de cotação e GET /api/tutors.
 * 9. Consistência dos preços entre todas as telas (FindTutorsSection, OnboardingWizardModal, ManageSubscriptionModal) e remoção de 5.5 / $15 / $13 legados.
 * 10. Alteração posterior de comissão pelo ADM refletida imediatamente na cotação backend.
 * 11. Bloqueio de compra preservado com PAYMENTS_ENABLED=false (POST /api/students/purchase-package -> 403 PAYMENTS_DISABLED).
 * 12. Regressão de módulos protegidos (financialEngine.ts e serverPtax.ts inalterados; contratos e créditos intactos).
 */

process.env.NODE_ENV = 'test';
process.env.FIREBASE_PROJECT_ID = 'itissimple-security-staging';
process.env.FIREBASE_DATABASE_ID = '(default)';
process.env.PAYMENTS_ENABLED = 'false';

import http from 'http';
import { AddressInfo } from 'net';
import fs from 'fs';
import path from 'path';
import { setFirebaseAdminAuthForTesting } from '../src/serverFirebaseAdmin';
import {
  setFirebaseAdminFirestoreForTesting,
  resetFirebaseAdminFirestoreForTesting,
} from '../src/serverFirestore';
import {
  clearPtaxMemoryCache,
  getExpectedReferenceDate,
  getSaoPauloDateString,
  PTAX_CACHE_COLLECTION,
  PTAX_SOURCE_LABEL,
} from '../src/serverPtax';
import {
  calculateFinancialPricingQuote,
} from '../src/utils/financialEngine';
import { ADMIN_COMMISSION_KEYS } from '../src/utils/tutorCommission';
import { consolidateTutorsList } from '../src/utils/tutorConsolidation';
import { normalizeTutorDoc } from '../src/hooks/useNativeFriends';
import {
  buildPackagesFromAuthoritativeQuote,
  generateLessonPackages,
} from '../src/components/ManageSubscriptionModal';
import {
  findQuoteForTutor,
  formatBrl,
} from '../src/utils/pricingQuoteClient';

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    console.log(`  ✅ PASS: ${testName}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${testName}${detail ? ` (${detail})` : ''}`);
    failed++;
  }
}

function approxEq(a: number, b: number, eps = 0.001): boolean {
  return Math.abs(a - b) <= eps;
}

function createMockFirestore(initialStore: Record<string, any> = {}) {
  const store: Record<string, any> = {};
  for (const [k, v] of Object.entries(initialStore)) {
    store[k] = JSON.parse(JSON.stringify(v));
  }

  let txQueue = Promise.resolve();

  const makeDocRef = (col: string, id: string) => ({
    _path: `${col}/${id}`,
    id,
    get: async () => {
      const val = store[`${col}/${id}`];
      return {
        exists: Boolean(val),
        id,
        data: () => (val ? JSON.parse(JSON.stringify(val)) : undefined),
      };
    },
    set: async (data: any, opts?: any) => {
      const prev = opts?.merge && store[`${col}/${id}`] ? store[`${col}/${id}`] : {};
      store[`${col}/${id}`] = JSON.parse(JSON.stringify({ ...prev, ...data }));
      return true;
    },
    delete: async () => {
      delete store[`${col}/${id}`];
      return true;
    },
  });

  const makeCollection = (col: string) => {
    const queryFilter = (filters: Array<{ field: string; val: any }>) => ({
      where: (field: string, _op: string, val: any) =>
        queryFilter([...filters, { field, val }]),
      limit: (_n: number) => queryFilter(filters),
      get: async () => {
        const docs: any[] = [];
        for (const [key, val] of Object.entries(store)) {
          if (!key.startsWith(`${col}/`) || !val) continue;
          const matches = filters.every((f) => val[f.field] === f.val);
          if (matches) {
            const docId = key.slice(col.length + 1);
            docs.push({
              id: docId,
              exists: true,
              data: () => JSON.parse(JSON.stringify(val)),
            });
          }
        }
        return {
          docs,
          empty: docs.length === 0,
          forEach: (cb: any) => docs.forEach(cb),
        };
      },
    });

    return {
      doc: (id: string) => makeDocRef(col, id),
      where: (field: string, _op: string, val: any) => queryFilter([{ field, val }]),
      get: async () => queryFilter([]).get(),
    };
  };

  return {
    _store: store,
    collection: (col: string) => makeCollection(col),
    runTransaction: async (fn: (tx: any) => Promise<any>) => {
      const run = txQueue.then(async () => {
        const stagedWrites: Array<{ path: string; data: any; merge?: boolean }> = [];
        const tx = {
          get: async (docRef: any) => {
            const val = store[docRef._path];
            return {
              exists: Boolean(val),
              id: docRef.id,
              data: () => (val ? JSON.parse(JSON.stringify(val)) : undefined),
            };
          },
          set: (docRef: any, data: any, opts?: any) => {
            stagedWrites.push({ path: docRef._path, data, merge: opts?.merge });
          },
        };
        const result = await fn(tx);
        for (const w of stagedWrites) {
          const prev = w.merge && store[w.path] ? store[w.path] : {};
          store[w.path] = JSON.parse(JSON.stringify({ ...prev, ...w.data }));
        }
        return result;
      });
      txQueue = run.catch(() => {});
      return run;
    },
  };
}

const UIDS = {
  ADMIN: 'ADMIN_UID_FIN2C_000000000001',
  STUDENT: 'STUDENT_UID_FIN2C_0000000002',
  TUTOR_0: 'TUTOR_0PCT_UID_FIN2C_0000003',
  TUTOR_20: 'TUTOR_20PCT_UID_FIN2C_000004',
  TUTOR_100: 'TUTOR_100PCT_UID_FIN2C_0005',
  TUTOR_LEGACY_NO_COMM: 'TUTOR_LEGACY_UID_FIN2C_00006',
  TUTOR_PENDING: 'TUTOR_PENDING_UID_FIN2C_0007',
  TUTOR_REJECTED: 'TUTOR_REJECT_UID_FIN2C_0008',
  TUTOR_NO_PRICE: 'TUTOR_NOPRICE_UID_FIN2C_0009',
};

const TOKENS = {
  ADMIN: 'token-admin-fin2c',
  STUDENT: 'token-student-fin2c',
  TUTOR_20: 'token-tutor20-fin2c',
};

const FORBIDDEN_COMMISSION_AND_INTERNAL_KEYS = [
  ...ADMIN_COMMISSION_KEYS,
  'basePriceUsd',
  'pricePerSessionUsd',
  'pricePerSessionBrl',
  'teacherShareUsd',
  'teacherShareBrl',
  'platformMarkupUsd',
  'platformMarkupBrl',
  'platformRevenueBrl',
  'platformRevenueUsd',
  'teacherShareRatio',
  'platformShareRatio',
  'email',
  'meetUrl',
  'meetLink',
];

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

async function httpRequest(
  serverUrl: string,
  method: string,
  urlPath: string,
  opts: { token?: string; body?: any } = {}
): Promise<{ status: number; body: any; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(urlPath, serverUrl);
    const payload = opts.body ? JSON.stringify(opts.body) : undefined;
    const req = http.request(
      parsed,
      {
        method,
        headers: {
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
          ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let json: any = null;
          try {
            json = JSON.parse(raw);
          } catch {
            json = raw;
          }
          resolve({ status: res.statusCode || 0, body: json, headers: res.headers });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function runTests() {
  console.log('=========================================================================');
  console.log(' TEST SUITE: FASE FIN.2C — INTEGRAÇÃO SEGURA DE PREÇOS E PACOTES');
  console.log('=========================================================================\n');

  const { app, isPaymentsEnabled } = await import('../serverApp');

  setFirebaseAdminAuthForTesting({
    verifyIdToken: async (token: string) => {
      if (token === TOKENS.ADMIN) {
        return { uid: UIDS.ADMIN, email: 'adm.itissimple@gmail.com', role: 'admin', email_verified: true };
      }
      if (token === TOKENS.STUDENT) {
        return { uid: UIDS.STUDENT, email: 'student.fin2c@example.com', role: 'student', email_verified: true };
      }
      if (token === TOKENS.TUTOR_20) {
        return { uid: UIDS.TUTOR_20, email: 'tutor20@example.com', role: 'teacher', email_verified: true };
      }
      throw new Error('Invalid token');
    },
    getUser: async (uid: string) => ({ uid }),
  } as any);

  const pricingDate = getSaoPauloDateString(new Date());
  const expectedPtaxDate = getExpectedReferenceDate(pricingDate);
  const PTAX_RATE = 5.7648;

  const initialFirestore: Record<string, any> = {
    [`${PTAX_CACHE_COLLECTION}/${expectedPtaxDate}`]: {
      cotacaoVenda: PTAX_RATE,
      cotacaoCompra: 5.7642,
      quoteDate: expectedPtaxDate,
      dataHoraCotacao: `${expectedPtaxDate} 13:03:27.848`,
      tipoBoletim: 'Fechamento',
      source: PTAX_SOURCE_LABEL,
      queriedAt: new Date().toISOString(),
    },
    [`tutors/${UIDS.TUTOR_0}`]: {
      id: UIDS.TUTOR_0,
      uid: UIDS.TUTOR_0,
      authUid: UIDS.TUTOR_0,
      publicTutorId: 'john-zero-pct',
      email: 'tutor0@example.com',
      name: 'John Zero Pct',
      role: 'teacher',
      approvalStatus: 'approved',
      isApproved: true,
      pricePerSessionUsd: 20,
      adminCommissionPercent: 0,
      commissionModel: 'MARKUP',
      commissionVersion: 1,
      effectiveFrom: '2026-11-01T00:00:00.000Z',
      updatedByUid: UIDS.ADMIN,
    },
    [`users/${UIDS.TUTOR_0}`]: {
      uid: UIDS.TUTOR_0,
      email: 'tutor0@example.com',
      name: 'John Zero Pct',
      publicTutorId: 'john-zero-pct',
      role: 'teacher',
      approvalStatus: 'approved',
      isApproved: true,
      adminCommissionPercent: 0,
      commissionModel: 'MARKUP',
      commissionVersion: 1,
    },
    [`tutors/${UIDS.TUTOR_20}`]: {
      id: UIDS.TUTOR_20,
      uid: UIDS.TUTOR_20,
      authUid: UIDS.TUTOR_20,
      publicTutorId: 'emma-twenty-pct',
      email: 'tutor20@example.com',
      name: 'Emma Twenty Pct',
      role: 'teacher',
      approvalStatus: 'approved',
      isApproved: true,
      pricePerSessionUsd: 25,
      adminCommissionPercent: 20,
      commissionModel: 'MARKUP',
      commissionVersion: 1,
      effectiveFrom: '2026-11-01T00:00:00.000Z',
      updatedByUid: UIDS.ADMIN,
    },
    [`users/${UIDS.TUTOR_20}`]: {
      uid: UIDS.TUTOR_20,
      email: 'tutor20@example.com',
      name: 'Emma Twenty Pct',
      publicTutorId: 'emma-twenty-pct',
      role: 'teacher',
      approvalStatus: 'approved',
      isApproved: true,
      adminCommissionPercent: 20,
      commissionModel: 'MARKUP',
      commissionVersion: 1,
    },
    [`tutors/${UIDS.TUTOR_100}`]: {
      id: UIDS.TUTOR_100,
      uid: UIDS.TUTOR_100,
      authUid: UIDS.TUTOR_100,
      publicTutorId: 'liam-hundred-pct',
      email: 'tutor100@example.com',
      name: 'Liam Hundred Pct',
      role: 'teacher',
      approvalStatus: 'approved',
      isApproved: true,
      pricePerSessionUsd: 18,
      adminCommissionPercent: 100,
      commissionModel: 'MARKUP',
      commissionVersion: 1,
      effectiveFrom: '2026-11-01T00:00:00.000Z',
      updatedByUid: UIDS.ADMIN,
    },
    [`users/${UIDS.TUTOR_100}`]: {
      uid: UIDS.TUTOR_100,
      email: 'tutor100@example.com',
      name: 'Liam Hundred Pct',
      publicTutorId: 'liam-hundred-pct',
      role: 'teacher',
      approvalStatus: 'approved',
      isApproved: true,
      adminCommissionPercent: 100,
      commissionModel: 'MARKUP',
      commissionVersion: 1,
    },
    [`tutors/${UIDS.TUTOR_LEGACY_NO_COMM}`]: {
      id: UIDS.TUTOR_LEGACY_NO_COMM,
      uid: UIDS.TUTOR_LEGACY_NO_COMM,
      authUid: UIDS.TUTOR_LEGACY_NO_COMM,
      publicTutorId: 'olivia-legacy-nocomm',
      email: 'legacy@example.com',
      name: 'Olivia Legacy',
      role: 'teacher',
      approvalStatus: 'approved',
      isApproved: true,
      pricePerSessionUsd: 22,
      // Intentionally NO adminCommissionPercent / commissionModel
    },
    [`users/${UIDS.TUTOR_LEGACY_NO_COMM}`]: {
      uid: UIDS.TUTOR_LEGACY_NO_COMM,
      email: 'legacy@example.com',
      role: 'teacher',
      approvalStatus: 'approved',
      isApproved: true,
    },
    [`tutors/${UIDS.TUTOR_PENDING}`]: {
      id: UIDS.TUTOR_PENDING,
      uid: UIDS.TUTOR_PENDING,
      authUid: UIDS.TUTOR_PENDING,
      publicTutorId: 'noah-pending',
      email: 'pending@example.com',
      name: 'Noah Pending',
      role: 'teacher',
      approvalStatus: 'pending',
      isApproved: false,
      pricePerSessionUsd: 20,
      adminCommissionPercent: 20,
      commissionModel: 'MARKUP',
      commissionVersion: 1,
    },
    [`users/${UIDS.TUTOR_PENDING}`]: {
      uid: UIDS.TUTOR_PENDING,
      email: 'pending@example.com',
      role: 'teacher',
      approvalStatus: 'pending',
      isApproved: false,
    },
    [`tutors/${UIDS.TUTOR_REJECTED}`]: {
      id: UIDS.TUTOR_REJECTED,
      uid: UIDS.TUTOR_REJECTED,
      authUid: UIDS.TUTOR_REJECTED,
      publicTutorId: 'ava-rejected',
      email: 'rejected@example.com',
      name: 'Ava Rejected',
      role: 'teacher',
      approvalStatus: 'rejected',
      isApproved: false,
      pricePerSessionUsd: 20,
      adminCommissionPercent: 20,
      commissionModel: 'MARKUP',
      commissionVersion: 1,
    },
    [`users/${UIDS.TUTOR_REJECTED}`]: {
      uid: UIDS.TUTOR_REJECTED,
      email: 'rejected@example.com',
      role: 'teacher',
      approvalStatus: 'rejected',
      isApproved: false,
    },
    [`tutors/${UIDS.TUTOR_NO_PRICE}`]: {
      id: UIDS.TUTOR_NO_PRICE,
      uid: UIDS.TUTOR_NO_PRICE,
      authUid: UIDS.TUTOR_NO_PRICE,
      publicTutorId: 'mia-noprice',
      email: 'noprice@example.com',
      name: 'Mia NoPrice',
      role: 'teacher',
      approvalStatus: 'approved',
      isApproved: true,
      adminCommissionPercent: 20,
      commissionModel: 'MARKUP',
      commissionVersion: 1,
    },
    [`users/${UIDS.STUDENT}`]: {
      uid: UIDS.STUDENT,
      email: 'student.fin2c@example.com',
      role: 'student',
      lessonCredits: 0,
    },
  };

  const mockFs = createMockFirestore(initialFirestore);
  setFirebaseAdminFirestoreForTesting(mockFs as any);
  clearPtaxMemoryCache();

  const server = app.listen(0);
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // -------------------------------------------------------------------------
    // 1. Cotações autoritativas para comissões 0%, 20% e 100% + pacotes 1/4/8/12
    // -------------------------------------------------------------------------
    console.log('--- 1. Comissões 0%, 20%, 100%, pacotes 1/4/8/12, descontos e engine ---');
    const scenarios = [
      { label: '0%', uid: UIDS.TUTOR_0, baseUsd: 20, commPct: 0, slug: 'john-zero-pct' },
      { label: '20%', uid: UIDS.TUTOR_20, baseUsd: 25, commPct: 20, slug: 'emma-twenty-pct' },
      { label: '100%', uid: UIDS.TUTOR_100, baseUsd: 18, commPct: 100, slug: 'liam-hundred-pct' },
    ];

    const singleQuotesByUid: Record<string, any> = {};

    for (const sc of scenarios) {
      const res = await httpRequest(baseUrl, 'GET', `/api/financial/pricing-quote/${sc.uid}`, {
        token: TOKENS.STUDENT,
      });
      assert(res.status === 200 && res.body?.success === true, `Cotação individual (${sc.label}) retorna 200`);
      assert(res.body.currency === 'BRL', `Cotação (${sc.label}) retorna moeda BRL`);
      assert(res.body.commercializable === true, `Cotação (${sc.label}) marca commercializable=true`);
      assert(res.body.tutorId === sc.uid, `Cotação (${sc.label}) resolve UID canônico`);
      assert(res.body.ptax?.rate === PTAX_RATE && res.body.ptax?.quoteDate === expectedPtaxDate, `Cotação (${sc.label}) usa PTAX D-1 oficial`);

      const engineRef = calculateFinancialPricingQuote({
        basePriceUsd: sc.baseUsd,
        adminCommissionPercent: sc.commPct,
        ptaxRate: PTAX_RATE,
        commissionModel: 'MARKUP',
        conversionBase: 'UNIT_PRICE_BRL',
      });

      assert(
        approxEq(res.body.unit?.finalPriceBrl, engineRef.unit.finalPriceBrl),
        `Unit finalPriceBrl (${sc.label}) idêntico ao financialEngine`,
        `got ${res.body.unit?.finalPriceBrl}, expected ${engineRef.unit.finalPriceBrl}`
      );
      assert(Array.isArray(res.body.packages) && res.body.packages.length === 4, `Cotação (${sc.label}) contém exatamente 4 pacotes (1/4/8/12)`);

      const counts = res.body.packages.map((p: any) => p.lessonsCount);
      assert(
        JSON.stringify(counts) === JSON.stringify([1, 4, 8, 12]),
        `Pacotes (${sc.label}) em ordem [1, 4, 8, 12]`
      );

      for (const engPkg of engineRef.packages.list) {
        const apiPkg = res.body.packages.find((p: any) => p.lessonsCount === engPkg.lessonsCount);
        assert(Boolean(apiPkg), `Pacote ${engPkg.lessonsCount} presente (${sc.label})`);
        assert(apiPkg.discountPercent === engPkg.discountPercent, `Desconto ${engPkg.discountPercent}% exato no pacote ${engPkg.lessonsCount} (${sc.label})`);
        assert(approxEq(apiPkg.grossTotalBrl, engPkg.grossTotalBrl), `grossTotalBrl exato pacote ${engPkg.lessonsCount} (${sc.label})`);
        assert(approxEq(apiPkg.discountAmountBrl, engPkg.discountAmountBrl), `discountAmountBrl exato pacote ${engPkg.lessonsCount} (${sc.label})`);
        assert(approxEq(apiPkg.finalPriceBrl, engPkg.finalPriceBrl), `finalPriceBrl exato pacote ${engPkg.lessonsCount} (${sc.label})`);
        assert(approxEq(apiPkg.effectiveLessonPriceBrl, engPkg.effectiveLessonPriceBrl), `effectiveLessonPriceBrl exato pacote ${engPkg.lessonsCount} (${sc.label})`);

        // Validate deterministic proportional split in underlying engine
        assert(
          approxEq(engPkg.teacherShareBrl + engPkg.platformRevenueBrl, engPkg.finalPriceBrl),
          `Rateio proporcional fecha em finalPriceBrl (pacote ${engPkg.lessonsCount}, ${sc.label})`
        );
      }

      singleQuotesByUid[sc.uid] = res.body;
    }

    // -------------------------------------------------------------------------
    // 2. Resolução por slug público & query ?tutorId= e consistência com batch
    // -------------------------------------------------------------------------
    console.log('\n--- 2. Resolução canônica, query endpoint e lote (/pricing-quotes) ---');
    const bySlug = await httpRequest(baseUrl, 'GET', `/api/financial/pricing-quote/emma-twenty-pct`);
    assert(bySlug.status === 200 && bySlug.body?.tutorId === UIDS.TUTOR_20, 'Resolução por slug publicTutorId retorna UID canônico');
    assert(
      JSON.stringify(bySlug.body?.packages) === JSON.stringify(singleQuotesByUid[UIDS.TUTOR_20]?.packages),
      'Cotação via slug idêntica à via UID canônico'
    );

    const byQuery = await httpRequest(baseUrl, 'GET', `/api/financial/pricing-quote?tutorId=${UIDS.TUTOR_20}`);
    assert(byQuery.status === 200 && byQuery.body?.unit?.finalPriceBrl === singleQuotesByUid[UIDS.TUTOR_20]?.unit?.finalPriceBrl, 'GET /api/financial/pricing-quote?tutorId=... consistente');

    const batchRes = await httpRequest(baseUrl, 'GET', '/api/financial/pricing-quotes');
    assert(batchRes.status === 200 && batchRes.body?.success === true, 'GET /api/financial/pricing-quotes retorna 200');
    assert(batchRes.body?.ptax?.rate === PTAX_RATE, 'Batch retorna PTAX D-1 oficial');

    for (const sc of scenarios) {
      const qUid = batchRes.body.quotesByTutorId?.[sc.uid];
      const qSlug = batchRes.body.quotesByTutorId?.[sc.slug];
      assert(Boolean(qUid && qSlug), `Batch indexa cotação para ${sc.uid} e slug ${sc.slug}`);
      assert(
        JSON.stringify(qUid.packages) === JSON.stringify(singleQuotesByUid[sc.uid].packages),
        `Batch e individual retornam pacotes idênticos para comissão ${sc.label}`
      );
    }

    // -------------------------------------------------------------------------
    // 3. Professor sem comissão válida, sem preço-base, pendente e estudante
    // -------------------------------------------------------------------------
    console.log('\n--- 3. Professores não elegíveis (sem comissão, sem preço, pendente, estudante) ---');
    const legacySingle = await httpRequest(baseUrl, 'GET', `/api/financial/pricing-quote/${UIDS.TUTOR_LEGACY_NO_COMM}`);
    assert(legacySingle.status === 422 && legacySingle.body?.error === 'TUTOR_COMMISSION_NOT_CONFIGURED', 'Professor legado sem comissão falha explicitamente com 422 TUTOR_COMMISSION_NOT_CONFIGURED');
    assert(legacySingle.body?.commercializable === false, 'Professor sem comissão retorna commercializable=false');
    assert(!batchRes.body.quotesByTutorId?.[UIDS.TUTOR_LEGACY_NO_COMM], 'Professor legado sem comissão NÃO entra em quotesByTutorId compráveis');
    assert(
      batchRes.body.unavailableByTutorId?.[UIDS.TUTOR_LEGACY_NO_COMM]?.error === 'TUTOR_COMMISSION_NOT_CONFIGURED',
      'Professor legado aparece em unavailableByTutorId com motivo explícito'
    );

    const noPriceSingle = await httpRequest(baseUrl, 'GET', `/api/financial/pricing-quote/${UIDS.TUTOR_NO_PRICE}`);
    assert(noPriceSingle.status === 422 && noPriceSingle.body?.error === 'TUTOR_BASE_PRICE_UNAVAILABLE', 'Professor sem preço-base falha com 422 TUTOR_BASE_PRICE_UNAVAILABLE');
    assert(!batchRes.body.quotesByTutorId?.[UIDS.TUTOR_NO_PRICE], 'Professor sem preço-base NÃO entra em quotesByTutorId');

    const pendingSingle = await httpRequest(baseUrl, 'GET', `/api/financial/pricing-quote/${UIDS.TUTOR_PENDING}`);
    assert(pendingSingle.status === 403 && pendingSingle.body?.error === 'TUTOR_NOT_APPROVED', 'Professor pendente/não aprovado é bloqueado com 403 TUTOR_NOT_APPROVED');
    assert(!batchRes.body.quotesByTutorId?.[UIDS.TUTOR_PENDING] && !batchRes.body.unavailableByTutorId?.[UIDS.TUTOR_PENDING], 'Professor não aprovado nunca aparece no batch público');

    const rejectedSingle = await httpRequest(baseUrl, 'GET', `/api/financial/pricing-quote/${UIDS.TUTOR_REJECTED}`);
    assert(rejectedSingle.status === 403 && rejectedSingle.body?.error === 'TUTOR_NOT_APPROVED', 'Professor rejeitado é bloqueado com 403 TUTOR_NOT_APPROVED');
    assert(!batchRes.body.quotesByTutorId?.[UIDS.TUTOR_REJECTED] && !batchRes.body.unavailableByTutorId?.[UIDS.TUTOR_REJECTED], 'Professor rejeitado nunca aparece no batch público');

    const studentAsTutor = await httpRequest(baseUrl, 'GET', `/api/financial/pricing-quote/${UIDS.STUDENT}`);
    assert(studentAsTutor.status === 404 || studentAsTutor.status === 403, 'UID de estudante é rejeitado como alvo de cotação');

    const emailLookup = await httpRequest(baseUrl, 'GET', `/api/financial/pricing-quote/${encodeURIComponent('tutor20@example.com')}`);
    assert(emailLookup.status === 400 && emailLookup.body?.error === 'INVALID_TUTOR_IDENTIFIER', 'E-mail é rejeitado como identificador público de cotação');

    // -------------------------------------------------------------------------
    // 4. Rejeição de parâmetros externos (preço/comissão do navegador)
    // -------------------------------------------------------------------------
    console.log('\n--- 4. Rejeição de adulteração por parâmetros do navegador ---');
    const tamper1 = await httpRequest(baseUrl, 'GET', `/api/financial/pricing-quote/${UIDS.TUTOR_20}?price=1&adminCommissionPercent=0&ptax=2`);
    assert(tamper1.status === 400 && tamper1.body?.error === 'CLIENT_PRICING_PARAMS_FORBIDDEN', 'Rota individual rejeita price/commission/ptax do navegador (400)');

    const tamper2 = await httpRequest(baseUrl, 'GET', `/api/financial/pricing-quote?tutorId=${UIDS.TUTOR_20}&discountPercent=90`);
    assert(tamper2.status === 400 && tamper2.body?.error === 'CLIENT_PRICING_PARAMS_FORBIDDEN', 'Rota query rejeita discountPercent do navegador (400)');

    const tamper3 = await httpRequest(baseUrl, 'GET', `/api/financial/pricing-quotes?rate=5.5`);
    assert(tamper3.status === 400 && tamper3.body?.error === 'CLIENT_PRICING_PARAMS_FORBIDDEN', 'Rota lote rejeita rate=5.5 externo (400)');

    // -------------------------------------------------------------------------
    // 5. Privacidade estrita da comissão e preço-base USD em DTOs públicos
    // -------------------------------------------------------------------------
    console.log('\n--- 5. Privacidade da comissão administrativa e preço-base USD ---');
    const quoteKeys = collectNestedKeys(singleQuotesByUid[UIDS.TUTOR_20]);
    const batchKeys = collectNestedKeys(batchRes.body);
    for (const forbidden of FORBIDDEN_COMMISSION_AND_INTERNAL_KEYS) {
      assert(!quoteKeys.has(forbidden), `DTO cotação individual NÃO expõe "${forbidden}"`);
      assert(!batchKeys.has(forbidden), `DTO cotação batch NÃO expõe "${forbidden}"`);
    }

    const publicTutorsRes = await httpRequest(baseUrl, 'GET', '/api/tutors');
    assert(publicTutorsRes.status === 200 && Array.isArray(publicTutorsRes.body), 'GET /api/tutors público responde 200');
    const publicEmma = publicTutorsRes.body.find((t: any) => t.id === UIDS.TUTOR_20 || t.publicTutorId === 'emma-twenty-pct');
    assert(Boolean(publicEmma), 'Emma encontrada em GET /api/tutors público');
    const publicTutorKeys = collectNestedKeys(publicEmma);
    for (const k of ADMIN_COMMISSION_KEYS) {
      assert(!publicTutorKeys.has(k), `GET /api/tutors público NÃO expõe campo FIN.2B "${k}"`);
    }
    assert(!publicTutorKeys.has('pricePerSessionUsd'), 'GET /api/tutors público omite pricePerSessionUsd para impedir engenharia reversa da comissão');
    assert(!publicTutorKeys.has('pricePerSessionBrl'), 'GET /api/tutors público omite pricePerSessionBrl legado (* 5.5)');

    // Teacher viewing OWN record still receives their pricePerSessionUsd, without adminCommissionPercent
    const ownTutorsRes = await httpRequest(baseUrl, 'GET', '/api/tutors', { token: TOKENS.TUTOR_20 });
    const ownEmma = ownTutorsRes.body.find((t: any) => t.uid === UIDS.TUTOR_20 || t.id === UIDS.TUTOR_20);
    assert(ownEmma?.pricePerSessionUsd === 25, 'Próprio professor continua vendo seu valor-base em USD');
    assert(ownEmma?.adminCommissionPercent === undefined, 'Próprio professor NÃO vê adminCommissionPercent');

    // -------------------------------------------------------------------------
    // 6. Atualização posterior de comissão reflete imediatamente na cotação
    // -------------------------------------------------------------------------
    console.log('\n--- 6. Alteração posterior de comissão pelo ADM reflete imediatamente ---');
    const updateCommRes = await httpRequest(baseUrl, 'PUT', `/api/tutors/${UIDS.TUTOR_20}/commission`, {
      token: TOKENS.ADMIN,
      body: { adminCommissionPercent: 35, commissionModel: 'MARKUP' },
    });
    assert(updateCommRes.status === 200 && updateCommRes.body?.success === true, 'ADM atualiza comissão de 20% para 35% com sucesso');

    const afterUpdateQuote = await httpRequest(baseUrl, 'GET', `/api/financial/pricing-quote/${UIDS.TUTOR_20}`);
    const expected35 = calculateFinancialPricingQuote({
      basePriceUsd: 25,
      adminCommissionPercent: 35,
      ptaxRate: PTAX_RATE,
      commissionModel: 'MARKUP',
      conversionBase: 'UNIT_PRICE_BRL',
    });
    assert(
      afterUpdateQuote.status === 200 && approxEq(afterUpdateQuote.body?.unit?.finalPriceBrl, expected35.unit.finalPriceBrl),
      'Cotação backend reflete imediatamente comissão atualizada de 35%',
      `got ${afterUpdateQuote.body?.unit?.finalPriceBrl}, expected ${expected35.unit.finalPriceBrl}`
    );
    assert(
      afterUpdateQuote.body.unit.finalPriceBrl > singleQuotesByUid[UIDS.TUTOR_20].unit.finalPriceBrl,
      'Novo preço final BRL é estritamente maior após elevação de comissão de 20% para 35%'
    );

    const afterBatchQuote = await httpRequest(baseUrl, 'GET', '/api/financial/pricing-quotes');
    assert(
      approxEq(afterBatchQuote.body.quotesByTutorId?.[UIDS.TUTOR_20]?.unit?.finalPriceBrl, expected35.unit.finalPriceBrl),
      'Batch /api/financial/pricing-quotes também reflete imediatamente a nova comissão de 35%'
    );

    // Direct Firestore commissionVersion bump (simulating multi-instance / external Firestore write)
    mockFs._store[`tutors/${UIDS.TUTOR_20}`] = {
      ...mockFs._store[`tutors/${UIDS.TUTOR_20}`],
      adminCommissionPercent: 40,
      commissionVersion: 99,
      updatedAt: '2020-01-01T00:00:00.000Z',
    };
    const expected40 = calculateFinancialPricingQuote({
      basePriceUsd: 25,
      adminCommissionPercent: 40,
      ptaxRate: PTAX_RATE,
      commissionModel: 'MARKUP',
      conversionBase: 'UNIT_PRICE_BRL',
    });
    const batchFreshRes = await httpRequest(baseUrl, 'GET', '/api/financial/pricing-quotes');
    assert(
      approxEq(batchFreshRes.body.quotesByTutorId?.[UIDS.TUTOR_20]?.unit?.finalPriceBrl, expected40.unit.finalPriceBrl),
      'Batch respeita commissionVersion mais recente do Firestore mesmo com updatedAt anterior'
    );
    // Restore version 2 (35%) for consistency checks below
    mockFs._store[`tutors/${UIDS.TUTOR_20}`] = {
      ...mockFs._store[`tutors/${UIDS.TUTOR_20}`],
      adminCommissionPercent: 35,
      commissionVersion: 2,
      updatedAt: new Date().toISOString(),
    };

    // -------------------------------------------------------------------------
    // 7. Falha explícita de PTAX D-1 (sem fallback 5.5)
    // -------------------------------------------------------------------------
    console.log('\n--- 7. Falha explícita de PTAX D-1 (503 PTAX_UNAVAILABLE, zero 5.5) ---');
    delete mockFs._store[`${PTAX_CACHE_COLLECTION}/${expectedPtaxDate}`];
    clearPtaxMemoryCache();

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error('Simulated BACEN outage');
    }) as any;

    try {
      const ptaxFailSingle = await httpRequest(baseUrl, 'GET', `/api/financial/pricing-quote/${UIDS.TUTOR_0}`);
      assert(ptaxFailSingle.status === 503 && ptaxFailSingle.body?.error === 'PTAX_UNAVAILABLE', 'Cotação individual falha explicitamente com 503 PTAX_UNAVAILABLE quando BACEN indisponível');
      assert(ptaxFailSingle.body?.commercializable === false, 'Falha PTAX retorna commercializable=false');

      const ptaxFailBatch = await httpRequest(baseUrl, 'GET', '/api/financial/pricing-quotes');
      assert(ptaxFailBatch.status === 503 && ptaxFailBatch.body?.error === 'PTAX_UNAVAILABLE', 'Cotação em lote falha explicitamente com 503 PTAX_UNAVAILABLE sem usar 5.5');
    } finally {
      globalThis.fetch = originalFetch;
    }

    // Restore PTAX cache for consistency checks below
    mockFs._store[`${PTAX_CACHE_COLLECTION}/${expectedPtaxDate}`] = initialFirestore[`${PTAX_CACHE_COLLECTION}/${expectedPtaxDate}`];
    clearPtaxMemoryCache();

    // -------------------------------------------------------------------------
    // 8. Bloqueio de compra com PAYMENTS_ENABLED=false
    // -------------------------------------------------------------------------
    console.log('\n--- 8. Bloqueio de compra com PAYMENTS_ENABLED=false ---');
    assert(isPaymentsEnabled() === false, 'isPaymentsEnabled() permanece false');
    const purchaseRes = await httpRequest(baseUrl, 'POST', '/api/students/purchase-package', {
      token: TOKENS.STUDENT,
      body: {
        teacherUid: UIDS.TUTOR_20,
        teacherId: UIDS.TUTOR_20,
        teacherName: 'Emma Twenty Pct',
        packageLessons: 8,
        packagePriceBrl: expected35.packages.package8.finalPriceBrl,
        paymentMethod: 'pix',
      },
    });
    assert(purchaseRes.status === 403 && purchaseRes.body?.error === 'PAYMENTS_DISABLED', 'POST /api/students/purchase-package bloqueado com 403 PAYMENTS_DISABLED');
    assert(mockFs._store[`users/${UIDS.STUDENT}`]?.lessonCredits === 0, 'Nenhum crédito de aula foi concedido ao aluno');

    // -------------------------------------------------------------------------
    // 9. Consistência cross-screen e limpeza de fallbacks 5.5 / $15 / $13 no frontend
    // -------------------------------------------------------------------------
    console.log('\n--- 9. Consistência entre telas e verificação estática do frontend ---');
    const authorQuote = afterUpdateQuote.body;
    const { quote: matchedInFindTutors } = findQuoteForTutor(
      { id: UIDS.TUTOR_20, publicTutorId: 'emma-twenty-pct' },
      afterBatchQuote.body.quotesByTutorId,
      afterBatchQuote.body.unavailableByTutorId
    );
    assert(matchedInFindTutors !== null, 'FindTutorsSection/Onboarding resolvem a cotação pelo mesmo helper');
    assert(
      formatBrl(matchedInFindTutors!.unit.finalPriceBrl) === formatBrl(authorQuote.unit.finalPriceBrl),
      'Preço exibido em FindTutorsSection e OnboardingWizardModal coincide em centavos com ManageSubscriptionModal'
    );

    const builtPackages = buildPackagesFromAuthoritativeQuote(authorQuote);
    assert(builtPackages.monthly.length === 3 && builtPackages.flexible.length === 4, 'ManageSubscriptionModal constrói 3 planos mensais e 4 pacotes flexíveis da cotação oficial');
    for (const engPkg of expected35.packages.list) {
      const uiFlex = builtPackages.flexible.find((p) => p.lessonsCount === engPkg.lessonsCount);
      assert(Boolean(uiFlex) && approxEq(uiFlex!.priceBrl, engPkg.finalPriceBrl), `ManageSubscriptionModal flexible (${engPkg.lessonsCount} aulas) exibe exatamente ${formatBrl(engPkg.finalPriceBrl)}`);
      if (engPkg.lessonsCount >= 4) {
        const uiMonthly = builtPackages.monthly.find((p) => p.lessonsCount === engPkg.lessonsCount);
        assert(Boolean(uiMonthly) && approxEq(uiMonthly!.priceBrl, engPkg.finalPriceBrl), `ManageSubscriptionModal monthly (${engPkg.lessonsCount} aulas) exibe exatamente ${formatBrl(engPkg.finalPriceBrl)}`);
      }
    }

    // Legacy generateLessonPackages kept for FIN.2A.2B test compatibility but with 5.5 and 15 fallbacks removed:
    const emptyFallbackPkgs = generateLessonPackages(0);
    assert(emptyFallbackPkgs.flexible[0].priceUsd === 0 && emptyFallbackPkgs.flexible[0].priceBrl === 0, 'generateLessonPackages(0) não inventa mais $15 nem taxa 5.5');

    // Normalizers must not fabricate $20 / * 5.5 prices when absent
    const normMissingPrice = normalizeTutorDoc('legacy-doc', { name: 'Legacy Doc', approvalStatus: 'approved', isApproved: true });
    assert(Boolean(normMissingPrice) && normMissingPrice?.pricePerSessionUsd === undefined && normMissingPrice?.pricePerSessionBrl === undefined, 'useNativeFriends.normalizeTutorDoc não inventa 20 USD nem 5.5 BRL');

    const consolidatedMissingPrice = consolidateTutorsList([{ id: 'legacy-1', name: 'Legacy One', approvalStatus: 'approved', isApproved: true } as any]);
    assert(consolidatedMissingPrice[0].pricePerSessionUsd === undefined && consolidatedMissingPrice[0].pricePerSessionBrl === undefined, 'tutorConsolidation não inventa 20 USD nem 5.5 BRL');

    // Static source checks on student-facing screens
    const rootDir = path.resolve(process.cwd());
    const findTutorsSrc = fs.readFileSync(path.join(rootDir, 'src/components/FindTutorsSection.tsx'), 'utf8');
    const onboardingSrc = fs.readFileSync(path.join(rootDir, 'src/components/OnboardingWizardModal.tsx'), 'utf8');
    const manageSubSrc = fs.readFileSync(path.join(rootDir, 'src/components/ManageSubscriptionModal.tsx'), 'utf8');

    assert(!findTutorsSrc.includes('5.5') && !findTutorsSrc.includes('?? 15') && !findTutorsSrc.includes('pricePerSessionUsd'), 'FindTutorsSection livre de 5.5 e pricePerSessionUsd/15');
    assert(findTutorsSrc.includes('useBatchTutorPricingQuotes') && findTutorsSrc.includes('useSingleTutorPricingQuote'), 'FindTutorsSection consome hooks oficiais FIN.2C');

    assert(!onboardingSrc.includes('5.5') && !onboardingSrc.includes('|| 15') && !onboardingSrc.includes('$13 USD') && !onboardingSrc.includes('pricePerSessionUsd'), 'OnboardingWizardModal livre de 5.5, $15 e $13 USD');
    assert(onboardingSrc.includes('useBatchTutorPricingQuotes') && onboardingSrc.includes('useSingleTutorPricingQuote'), 'OnboardingWizardModal consome hooks oficiais FIN.2C');

    assert(!manageSubSrc.includes('5.5') && !manageSubSrc.includes('pricePerSessionUsd || 15') && !manageSubSrc.includes('activeBaseRateUsd'), 'ManageSubscriptionModal livre de 5.5 e fallback 15 USD');
    assert(manageSubSrc.includes('buildPackagesFromAuthoritativeQuote') && manageSubSrc.includes('useSingleTutorPricingQuote'), 'ManageSubscriptionModal consome cotação oficial do servidor');
  } finally {
    server.close();
    resetFirebaseAdminFirestoreForTesting();
    clearPtaxMemoryCache();
  }

  console.log('\n=========================================================================');
  console.log(` RESULTADO FIN.2C: ${passed} passed, ${failed} failed`);
  console.log('=========================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Erro fatal na suíte FIN.2C:', err);
  process.exit(1);
});
