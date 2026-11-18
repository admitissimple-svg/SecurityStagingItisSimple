/**
 * TEST SUITE: ADM.OPS.1 — PLATFORM OPERATIONS DASHBOARD
 * Validates:
 *  1. Historical snapshot preservation (FIN.2B/2C/2D): never recalculates past transactions with current PTAX/commission
 *  2. Strict differentiation between paid purchases and administrative grants/adjustments (no revenue for admin grants)
 *  3. Accrual/competence separation between package purchase month and lesson realization month
 *  4. Zero fabrication: missing platform costs, missing country, or realization-only months return null -> N/D
 *  5. Filters (year, month, teacherUid) & distinct student KPI reconciliation
 *  6. Strict ADM-only RBAC on GET /api/admin/operations-dashboard (401/403/200) & Firestore (default) exclusivity (503 on failure)
 *  7. UI SSR render of all 3 filters, 6 KPIs, 15 table columns, N/D rendering, and horizontal scroll container
 */

process.env.NODE_ENV = 'test';
process.env.FIREBASE_PROJECT_ID = 'itissimple-security-staging';
process.env.FIREBASE_DATABASE_ID = '(default)';
process.env.PAYMENTS_ENABLED = 'false';

import assert from 'assert';
import http from 'http';
import fs from 'fs';
import path from 'path';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { app as serverApp, resetInMemoryDbForTesting } from '../serverApp';
import {
  setFirebaseAdminFirestoreForTesting,
  resetFirebaseAdminFirestoreForTesting,
} from '../src/serverFirestore';
import {
  setFirebaseAdminAuthForTesting,
  resetFirebaseAdminForTesting,
} from '../src/serverFirebaseAdmin';
import { calculateFinancialPricingQuote } from '../src/utils/financialEngine';
import {
  buildAdminOperationsDashboard,
  extractBrazilYearMonth,
  isPaidPurchaseTransaction,
  isAdministrativeTransaction,
} from '../src/utils/adminOperationsAnalytics';
import { AdminOperationsDashboard } from '../src/components/AdminOperationsDashboard';

function createIsolatedFirestoreMock(initialData: Record<string, Record<string, Record<string, any>>> = {}) {
  const collections = new Map<string, Map<string, Record<string, any>>>();
  for (const [colName, docsMap] of Object.entries(initialData)) {
    const col = new Map<string, Record<string, any>>();
    for (const [docId, docVal] of Object.entries(docsMap)) {
      col.set(docId, JSON.parse(JSON.stringify(docVal)));
    }
    collections.set(colName, col);
  }

  return {
    collection: (colName: string) => {
      const col = collections.get(colName) || new Map<string, Record<string, any>>();
      return {
        get: async () => {
          const docs = Array.from(col.entries()).map(([id, data]) => ({
            id,
            exists: true,
            data: () => JSON.parse(JSON.stringify(data)),
          }));
          return {
            empty: docs.length === 0,
            size: docs.length,
            docs,
            forEach: (cb: (d: any) => void) => docs.forEach(cb),
          };
        },
        doc: (docId: string) => ({
          id: docId,
          get: async () => {
            const val = col.get(docId);
            return {
              id: docId,
              exists: Boolean(val),
              data: () => (val ? JSON.parse(JSON.stringify(val)) : undefined),
            };
          },
        }),
      };
    },
  };
}

async function withServer(fn: (baseUrl: string) => Promise<void>) {
  const server = http.createServer(serverApp);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    await fn(baseUrl);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

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

async function runTests() {
  console.log('\n====================================================================');
  console.log('🧪 TEST SUITE: ADM.OPS.1 — PLATFORM OPERATIONS DASHBOARD');
  console.log('====================================================================\n');

  // ---------------------------------------------------------------------------
  // 1. Timezone & Transaction Classification Helpers
  // ---------------------------------------------------------------------------
  console.log('--- 1. Competência Brasil (America/Sao_Paulo) e Classificação FIN.2D ---');
  {
    // 2026-10-01T01:30:00Z is 2026-09-30 22:30 BRT -> September 2026 in São Paulo!
    const brtYm = extractBrazilYearMonth('2026-10-01T01:30:00.000Z');
    check(brtYm?.year === 2026 && brtYm?.month === 9, 'Extrai competência correta no fuso America/Sao_Paulo');

    check(
      isPaidPurchaseTransaction({
        type: 'PACKAGE_PURCHASE',
        isPaidPurchase: true,
        countsAsRevenue: true,
        isAdministrativeOperation: false,
      }) === true,
      'Reconhece PACKAGE_PURCHASE pago com countsAsRevenue: true'
    );

    check(
      isPaidPurchaseTransaction({
        type: 'ADMIN_PACKAGE_GRANT',
        isPaidPurchase: false,
        countsAsRevenue: false,
        isAdministrativeOperation: true,
      }) === false,
      'Rejeita ADMIN_PACKAGE_GRANT como compra paga'
    );

    check(
      isAdministrativeTransaction({
        type: 'ADMIN_CREDIT_ADJUSTMENT',
        countsAsRevenue: false,
      }) === true,
      'Reconhece ADMIN_CREDIT_ADJUSTMENT como operação administrativa sem receita'
    );
  }

  // ---------------------------------------------------------------------------
  // 2. Historical Snapshot Preservation, Admin Grant Exclusion, Competence Split & N/D
  // ---------------------------------------------------------------------------
  console.log('--- 2. Snapshots Históricos, Concessões Admin, Competências e N/D ---');
  const quoteSept = calculateFinancialPricingQuote({
    basePriceUsd: 20,
    adminCommissionPercent: 25,
    ptaxRate: 5.0,
    commissionModel: 'MARKUP',
    conversionBase: 'UNIT_PRICE_BRL',
  });
  const pkg4Sept = quoteSept.packages.package4; // 4 lessons, 5% discount

  const quoteOct = calculateFinancialPricingQuote({
    basePriceUsd: 30,
    adminCommissionPercent: 40,
    ptaxRate: 6.0,
    commissionModel: 'MARKUP',
    conversionBase: 'UNIT_PRICE_BRL',
  });
  const pkg1Oct = quoteOct.packages.package1;

  // Tutor later updated to $50 and 50% markup — must NEVER alter historical Sept/Oct rows!
  const tutors = [
    {
      id: 'tutor_uid_ana_1234567890',
      uid: 'tutor_uid_ana_1234567890',
      name: 'Ana Native',
      email: 'ana@native.test',
      country: 'Canada',
      pricePerSessionUsd: 50,
      adminCommissionPercent: 50,
      commissionModel: 'MARKUP',
      approvalStatus: 'approved',
      isApproved: true,
    },
    {
      id: 'tutor_uid_bob_1234567890',
      uid: 'tutor_uid_bob_1234567890',
      name: 'Bob Native',
      email: 'bob@native.test',
      // No country -> must render N/D (null), never invented!
      pricePerSessionUsd: 18,
      adminCommissionPercent: 20,
      commissionModel: 'MARKUP',
      approvalStatus: 'approved',
      isApproved: true,
    },
  ];

  const users = [
    {
      id: 'student_uid_1_abcdef',
      uid: 'student_uid_1_abcdef',
      email: 'st1@test.com',
      name: 'Student One',
      role: 'student',
      teacherUid: 'tutor_uid_ana_1234567890',
    },
    {
      id: 'student_uid_2_abcdef',
      uid: 'student_uid_2_abcdef',
      email: 'st2@test.com',
      name: 'Student Two',
      role: 'student',
      teacherUid: 'tutor_uid_bob_1234567890',
    },
  ];

  const transactions = [
    // Paid purchase in Sept 2026 for Ana (4 lessons, old rate $20, 25% markup, PTAX 5.0)
    {
      id: 'tx_paid_sept_ana',
      type: 'PACKAGE_PURCHASE',
      category: 'paid_package_purchase',
      studentUid: 'student_uid_1_abcdef',
      studentEmail: 'st1@test.com',
      teacherUid: 'tutor_uid_ana_1234567890',
      teacherEmail: 'ana@native.test',
      teacherName: 'Ana Native',
      packageLessons: 4,
      lessonsAdded: 4,
      basePriceUsd: 20,
      adminCommissionPercent: 25,
      commissionModel: 'MARKUP',
      ptaxRate: 5.0,
      unitFinalPriceBrl: quoteSept.unit.finalPriceBrl,
      effectiveLessonPriceBrl: pkg4Sept.effectiveLessonPriceBrl,
      finalPriceBrl: pkg4Sept.finalPriceBrl,
      revenueBrl: pkg4Sept.finalPriceBrl,
      teacherShareBrl: pkg4Sept.teacherShareBrl,
      platformRevenueBrl: pkg4Sept.platformRevenueBrl,
      isAdministrativeOperation: false,
      isPaidPurchase: true,
      countsAsRevenue: true,
      status: 'completed',
      createdAt: '2026-09-10T15:00:00.000Z',
    },
    // Admin credit adjustment in Sept 2026 for Student 1 (+2 lessons, NO teacherUid on doc -> resolves via student assignment, ZERO revenue!)
    {
      id: 'tx_adj_sept_st1',
      type: 'ADMIN_CREDIT_ADJUSTMENT',
      category: 'administrative_adjustment',
      studentUid: 'student_uid_1_abcdef',
      studentEmail: 'st1@test.com',
      delta: 2,
      countsAsRevenue: false,
      revenueBrl: 0,
      amountBrl: 0,
      status: 'completed',
      createdAt: '2026-09-15T15:00:00.000Z',
    },
    // Admin package grant in Oct 2026 for Bob (+4 free lessons, ZERO revenue!)
    {
      id: 'tx_grant_oct_bob',
      type: 'ADMIN_PACKAGE_GRANT',
      category: 'administrative_package_grant',
      studentUid: 'student_uid_2_abcdef',
      studentEmail: 'st2@test.com',
      teacherUid: 'tutor_uid_bob_1234567890',
      teacherEmail: 'bob@native.test',
      teacherName: 'Bob Native',
      packageLessons: 4,
      lessonsAdded: 4,
      basePriceUsd: 18,
      adminCommissionPercent: 20,
      commissionModel: 'MARKUP',
      ptaxRate: 5.2,
      unitFinalPriceBrl: 112.32,
      effectiveLessonPriceBrl: 106.7,
      finalPriceBrl: 426.82,
      teacherShareBrl: 355.68,
      platformRevenueBrl: 71.14,
      isAdministrativeOperation: true,
      isPaidPurchase: false,
      countsAsRevenue: false,
      revenueBrl: 0,
      amountBrl: 0,
      status: 'completed',
      createdAt: '2026-10-05T15:00:00.000Z',
    },
    // Paid purchase in Nov 2026 for Bob WITH explicit recorded gateway/platform cost
    {
      id: 'tx_paid_nov_bob_with_cost',
      type: 'PACKAGE_PURCHASE',
      category: 'paid_package_purchase',
      studentUid: 'student_uid_2_abcdef',
      studentEmail: 'st2@test.com',
      teacherUid: 'tutor_uid_bob_1234567890',
      teacherEmail: 'bob@native.test',
      teacherName: 'Bob Native',
      packageLessons: 1,
      lessonsAdded: 1,
      basePriceUsd: 30,
      adminCommissionPercent: 40,
      commissionModel: 'MARKUP',
      ptaxRate: 6.0,
      unitFinalPriceBrl: quoteOct.unit.finalPriceBrl,
      effectiveLessonPriceBrl: pkg1Oct.effectiveLessonPriceBrl,
      finalPriceBrl: pkg1Oct.finalPriceBrl,
      revenueBrl: pkg1Oct.finalPriceBrl,
      teacherShareBrl: pkg1Oct.teacherShareBrl,
      platformRevenueBrl: pkg1Oct.platformRevenueBrl,
      platformCostBrl: 10.5, // Explicit recorded cost
      isAdministrativeOperation: false,
      isPaidPurchase: true,
      countsAsRevenue: true,
      status: 'completed',
      createdAt: '2026-11-05T15:00:00.000Z',
    },
  ];

  const lessons = [
    // 1 completed lesson in Sept for Ana (Student 1)
    {
      id: 'l_sept_1',
      teacherUid: 'tutor_uid_ana_1234567890',
      studentUid: 'student_uid_1_abcdef',
      studentEmail: 'st1@test.com',
      status: 'completed',
      isTrialLesson: false,
      startDateTime: '2026-09-20T14:00:00.000Z',
      completedAt: '2026-09-20T14:55:00.000Z',
    },
    // 1 completed TRIAL lesson in Sept for Ana (must NOT count in paid Atendidas!)
    {
      id: 'l_sept_trial',
      teacherUid: 'tutor_uid_ana_1234567890',
      studentUid: 'student_uid_1_abcdef',
      studentEmail: 'st1@test.com',
      status: 'completed',
      isTrialLesson: true,
      startDateTime: '2026-09-12T14:00:00.000Z',
      completedAt: '2026-09-12T14:30:00.000Z',
    },
    // 2 completed lessons in Oct for Ana (Student 1 using credits bought in Sept -> competence separation!)
    {
      id: 'l_oct_1',
      teacherUid: 'tutor_uid_ana_1234567890',
      studentUid: 'student_uid_1_abcdef',
      studentEmail: 'st1@test.com',
      status: 'completed',
      isTrialLesson: false,
      startDateTime: '2026-10-08T14:00:00.000Z',
      completedAt: '2026-10-08T14:55:00.000Z',
    },
    {
      id: 'l_oct_2',
      teacherUid: 'tutor_uid_ana_1234567890',
      studentUid: 'student_uid_1_abcdef',
      studentEmail: 'st1@test.com',
      status: 'completed',
      isTrialLesson: false,
      startDateTime: '2026-10-15T14:00:00.000Z',
      completedAt: '2026-10-15T14:55:00.000Z',
    },
    // Cancelled lesson in Oct (must NOT count)
    {
      id: 'l_oct_cancelled',
      teacherUid: 'tutor_uid_ana_1234567890',
      studentUid: 'student_uid_1_abcdef',
      studentEmail: 'st1@test.com',
      status: 'cancelled',
      isTrialLesson: false,
      startDateTime: '2026-10-18T14:00:00.000Z',
    },
  ];

  {
    const dash = buildAdminOperationsDashboard({
      transactions,
      lessons,
      tutors,
      users,
      generatedAt: '2026-11-18T10:00:00.000Z',
    });

    const septAna = dash.rows.find((r) => r.year === 2026 && r.month === 9 && r.teacherKey === 'tutor_uid_ana_1234567890');
    const octAna = dash.rows.find((r) => r.year === 2026 && r.month === 10 && r.teacherKey === 'tutor_uid_ana_1234567890');
    const octBob = dash.rows.find((r) => r.year === 2026 && r.month === 10 && r.teacherKey === 'tutor_uid_bob_1234567890');
    const novBob = dash.rows.find((r) => r.year === 2026 && r.month === 11 && r.teacherKey === 'tutor_uid_bob_1234567890');

    check(Boolean(septAna && octAna && octBob && novBob), 'Gerou todas as 4 linhas mensais por competência');

    // Sept Ana checks
    check(septAna?.country === 'Canada', 'País preservado do cadastro de Ana (Canada)');
    check(septAna?.aulasContratadas === 6, `Sept Ana Aulas Contratadas = 6 (4 pagas + 2 admin), obtido=${septAna?.aulasContratadas}`);
    check(septAna?.paidContractedLessons === 4 && septAna?.adminGrantedLessons === 2, 'Separação paga/admin em Aulas Contratadas');
    check(septAna?.atendidas === 1 && septAna?.trialAtendidas === 1, 'Sept Ana Atendidas = 1 (trial excluída do saldo pago)');
    check(septAna?.saldo === null, 'Sept Ana Saldo = null (N/D em mês anterior / sem saldo canônico persistido)');
    check(septAna?.aulaUsd === 20, `Snapshot histórico preserva Aula USD = 20 (não 50 atual), obtido=${septAna?.aulaUsd}`);
    check(septAna?.comissaoMarkupPercent === 25, `Snapshot histórico preserva MARKUP = 25% (não 50% atual), obtido=${septAna?.comissaoMarkupPercent}`);
    check(septAna?.aulaBrl === pkg4Sept.effectiveLessonPriceBrl, 'Snapshot histórico preserva Aula BRL sem recalcular PTAX');
    check(septAna?.faturamentoBrl === pkg4Sept.finalPriceBrl, 'Faturamento considera apenas compra paga (ignora +2 ajuste admin)');
    check(septAna?.custoPlataformaBrl === null, 'Custo Plataforma ausente retorna null (N/D) sem inventar');
    check(septAna?.custoNativeFriendBrl === pkg4Sept.teacherShareBrl, 'Custo Native Friend usa teacherShareBrl histórico');
    check(septAna?.lucroBrl === null, 'Lucro retorna null (N/D) quando Custo Plataforma é desconhecido');

    // Oct Ana checks (realization competence only -> no transactions in Oct!)
    check(octAna?.aulasContratadas === 0, 'Oct Ana Aulas Contratadas = 0 (compra foi em Sept)');
    check(octAna?.atendidas === 2, 'Oct Ana Atendidas = 2 (competência de realização em Oct)');
    check(octAna?.saldo === null, 'Oct Ana Saldo = null (N/D em mês anterior)');
    check(octAna?.faturamentoBrl === 0, 'Oct Ana Faturamento = 0');
    check(octAna?.aulaUsd === null && octAna?.comissaoMarkupPercent === null && octAna?.aulaBrl === null, 'Mês apenas de realização não inventa snapshot usando preço/comissão atual (retorna null/N/D)');

    // Oct Bob checks (admin package grant ONLY -> ZERO revenue, country null -> N/D)
    check(octBob?.country === null, 'Bob sem país retorna null (N/D)');
    check(octBob?.aulasContratadas === 4 && octBob?.adminGrantedLessons === 4, 'Oct Bob registra 4 aulas de concessão admin');
    check(octBob?.faturamentoBrl === 0, 'Concessão administrativa NUNCA entra como faturamento (R$ 0,00)');
    check(octBob?.custoNativeFriendBrl === null && octBob?.lucroBrl === null, 'Concessão administrativa não inventa custo nem lucro');

    // Nov Bob checks (paid WITH explicit platformCostBrl recorded -> exact Lucro!)
    check(novBob?.custoPlataformaBrl === 10.5, 'Nov Bob preserva Custo Plataforma explícito (10.50)');
    const expectedLucro = Number((pkg1Oct.finalPriceBrl - 10.5 - pkg1Oct.teacherShareBrl).toFixed(2));
    check(novBob?.lucroBrl === expectedLucro, `Nov Bob calcula Lucro exato (${expectedLucro}) quando todos os custos reais existem`);

    // KPI reconciliation checks
    check(dash.kpis.alunosCount === 2, `KPI Alunos distintos = 2 (não duplica Student 1 entre Sept e Oct), obtido=${dash.kpis.alunosCount}`);
    check(dash.kpis.aulasContratadas === 11, `KPI Aulas Contratadas = 11 (6 + 0 + 4 + 1), obtido=${dash.kpis.aulasContratadas}`);
    check(dash.kpis.atendidas === 3, `KPI Atendidas = 3, obtido=${dash.kpis.atendidas}`);
    check(dash.kpis.saldo === null, `KPI Saldo = null (N/D quando alunos não possuem availableLessons persistido), obtido=${dash.kpis.saldo}`);
    const expectedTotalRevenue = Number((pkg4Sept.finalPriceBrl + pkg1Oct.finalPriceBrl).toFixed(2));
    check(dash.kpis.faturamentoBrl === expectedTotalRevenue, `KPI Faturamento = ${expectedTotalRevenue}`);
    check(dash.kpis.lucroBrl === null, 'KPI Lucro = N/D quando parte das linhas pagas não possui Custo Plataforma registrado');
  }

  // ---------------------------------------------------------------------------
  // 3. Filters Verification (Year, Month, Native Friend)
  // ---------------------------------------------------------------------------
  console.log('--- 3. Filtros (Ano, Mês, Native Friend) ---');
  {
    const filteredNovBob = buildAdminOperationsDashboard({
      transactions,
      lessons,
      tutors,
      users,
      filters: { year: 2026, month: 11, teacherUid: 'tutor_uid_bob_1234567890' },
    });
    check(filteredNovBob.rows.length === 1, 'Filtro combinado retorna exatamente 1 linha');
    check(filteredNovBob.kpis.alunosCount === 1, 'KPI Alunos atualizado para filtro');
    check(filteredNovBob.kpis.faturamentoBrl === pkg1Oct.finalPriceBrl, 'KPI Faturamento atualizado para filtro');
    check(
      filteredNovBob.kpis.lucroBrl === Number((pkg1Oct.finalPriceBrl - 10.5 - pkg1Oct.teacherShareBrl).toFixed(2)),
      'KPI Lucro calcula corretamente quando o recorte filtrado possui todos os custos'
    );
    check(filteredNovBob.filterOptions.years.includes(2026), 'filterOptions preserva anos disponíveis');
    check(filteredNovBob.filterOptions.teachers.length >= 2, 'filterOptions preserva Native Friends');
  }

  // ---------------------------------------------------------------------------
  // 4. Backend RBAC & Firestore (default) Exclusivity
  // ---------------------------------------------------------------------------
  console.log('--- 4. RBAC ADM-Only e Firestore (default) no Backend ---');
  resetInMemoryDbForTesting();
  const mockDb = createIsolatedFirestoreMock({
    financial_transactions: Object.fromEntries(transactions.map((t) => [t.id, t])),
    lessons: Object.fromEntries(lessons.map((l) => [l.id, l])),
    tutors: Object.fromEntries(tutors.map((t) => [t.id, t])),
    users: Object.fromEntries(users.map((u) => [u.id, u])),
    student_assignments: {},
  });
  setFirebaseAdminFirestoreForTesting(mockDb as any);
  setFirebaseAdminAuthForTesting({
    verifyIdToken: async (token: string) => {
      if (token === 'token-admin') {
        return { uid: 'adm-uid-1', email: 'estilobeeadm@gmail.com', email_verified: true, role: 'admin', admin: true };
      }
      if (token === 'token-teacher') {
        return { uid: 'tutor_uid_ana_1234567890', email: 'ana@native.test', email_verified: true, role: 'teacher' };
      }
      if (token === 'token-student') {
        return { uid: 'student_uid_1_abcdef', email: 'st1@test.com', email_verified: true, role: 'student' };
      }
      throw new Error('Invalid token');
    },
  } as any);

  await withServer(async (baseUrl) => {
    const unauthRes = await fetch(`${baseUrl}/api/admin/operations-dashboard`);
    check(unauthRes.status === 401, `Sem token retorna 401 (obtido=${unauthRes.status})`);

    const studentRes = await fetch(`${baseUrl}/api/admin/operations-dashboard`, {
      headers: { Authorization: 'Bearer token-student' },
    });
    check(studentRes.status === 403, `Aluno retorna 403 Forbidden (obtido=${studentRes.status})`);

    const teacherRes = await fetch(`${baseUrl}/api/admin/operations-dashboard`, {
      headers: { Authorization: 'Bearer token-teacher' },
    });
    check(teacherRes.status === 403, `Professor retorna 403 Forbidden (obtido=${teacherRes.status})`);

    const badMonthRes = await fetch(`${baseUrl}/api/admin/operations-dashboard?month=13`, {
      headers: { Authorization: 'Bearer token-admin' },
    });
    check(badMonthRes.status === 400, `Filtro de mês inválido retorna 400 (obtido=${badMonthRes.status})`);

    const adminRes = await fetch(`${baseUrl}/api/admin/operations-dashboard?year=2026&month=9`, {
      headers: { Authorization: 'Bearer token-admin' },
    });
    const adminJson = await adminRes.json();
    check(adminRes.status === 200 && adminJson.success === true, 'Admin autenticado recebe 200 OK');
    check(adminJson.dataSource === 'firestore_default', 'Resposta declara dataSource=firestore_default');
    check(Array.isArray(adminJson.rows) && adminJson.rows.length === 1, 'Endpoint aplica filtros year/month corretamente');
    check(adminJson.rows[0]?.faturamentoBrl === pkg4Sept.finalPriceBrl, 'Endpoint retorna snapshot histórico preservado');

    // Firestore unavailable -> 503 (never falls back to mock or app_db.json)
    setFirebaseAdminFirestoreForTesting(null);
    const prevProjectId = process.env.FIREBASE_PROJECT_ID;
    delete process.env.FIREBASE_PROJECT_ID; // ensure getFirestoreDb returns null cleanly
    const unavailableRes = await fetch(`${baseUrl}/api/admin/operations-dashboard`, {
      headers: { Authorization: 'Bearer token-admin' },
    });
    process.env.FIREBASE_PROJECT_ID = prevProjectId;
    check(unavailableRes.status === 503, `Firestore indisponível retorna 503 sem fallback (obtido=${unavailableRes.status})`);
  });

  resetFirebaseAdminFirestoreForTesting();
  resetFirebaseAdminForTesting();

  // ---------------------------------------------------------------------------
  // 5. UI Component SSR Render & App.tsx Conditional Integration
  // ---------------------------------------------------------------------------
  console.log('--- 5. Renderização UI (Filtros, KPIs, 15 Colunas, N/D, Scroll Horizontal) ---');
  {
    const sampleData = buildAdminOperationsDashboard({
      transactions,
      lessons,
      tutors,
      users,
    });
    const html = renderToString(React.createElement(AdminOperationsDashboard, { initialData: sampleData }));

    const expectedStrings = [
      'Platform Operations Dashboard',
      'ops-filter-year',
      'ops-filter-month',
      'ops-filter-teacher',
      'Alunos',
      'Aulas Contratadas',
      'Atendidas',
      'Saldo',
      'Faturamento',
      'Lucro',
      'Ano',
      'Mês',
      'País',
      'Native Friend',
      'Nº Alunos',
      'Aula USD',
      'Comissão MARKUP',
      'Aula BRL',
      'Custo Plataforma',
      'Custo Native Friend',
      'overflow-x-auto',
      'N/D',
      'Ana Native',
      'Bob Native',
    ];

    for (const s of expectedStrings) {
      check(html.includes(s), `UI renderiza "${s}"`);
    }
    check(!html.includes('undefined'), 'UI não contém "undefined" no HTML renderizado');

    const appSource = fs.readFileSync(path.join(process.cwd(), 'src/App.tsx'), 'utf8');
    check(
      appSource.includes("currentAccount?.role === 'admin' ? (") &&
        appSource.includes('<AdminOperationsDashboard') &&
        appSource.includes('<TeacherScheduleControlTable'),
      'App.tsx substitui exclusivamente Master Schedule Control no painel ADM e preserva TeacherScheduleControlTable para professores'
    );
  }

  console.log('\n====================================================================');
  console.log(`📊 RESULTADO ADM.OPS.1: ${passed} PASSOU | ${failed} FALHOU`);
  console.log('====================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Erro inesperado na suite ADM.OPS.1:', err);
  process.exit(1);
});
