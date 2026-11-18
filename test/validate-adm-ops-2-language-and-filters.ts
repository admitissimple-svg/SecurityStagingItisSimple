/**
 * TEST SUITE: ADM.OPS.2 — PLATFORM OPERATIONS DASHBOARD (LANGUAGE & TABLE HEADER FILTERS)
 * Validates:
 *  1. Global language integration (EN / PT only) without adding a second language selector
 *  2. Numeric months ONLY (1..12), zero month names in filter options and table cells
 *  3. Combinable filters directly in <thead> for Year, Month, Country, and Native Friend
 *  4. Country filter (including __nd__ for missing country) in analytics engine & backend endpoint
 *  5. Rows, totals, and KPIs update strictly for the filtered slice without recalculating snapshots
 *  6. Table header filters remain mounted when filtered slice returns 0 rows
 *  7. Horizontal scroll & responsive layout preserved + RBAC & Firestore (default) exclusivity
 */

process.env.NODE_ENV = 'test';
process.env.FIREBASE_PROJECT_ID = 'itissimple-security-staging';
process.env.FIREBASE_DATABASE_ID = '(default)';
process.env.PAYMENTS_ENABLED = 'false';

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
import { buildAdminOperationsDashboard } from '../src/utils/adminOperationsAnalytics';
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
  console.log('🧪 TEST SUITE: ADM.OPS.2 — IDIOMA E FILTROS NA TABELA');
  console.log('====================================================================\n');

  const quoteCanada = calculateFinancialPricingQuote({
    basePriceUsd: 22,
    adminCommissionPercent: 25,
    ptaxRate: 5.1,
    commissionModel: 'MARKUP',
    conversionBase: 'UNIT_PRICE_BRL',
  });
  const pkg4Canada = quoteCanada.packages.package4;

  const quoteUs = calculateFinancialPricingQuote({
    basePriceUsd: 28,
    adminCommissionPercent: 30,
    ptaxRate: 5.5,
    commissionModel: 'MARKUP',
    conversionBase: 'UNIT_PRICE_BRL',
  });
  const pkg1Us = quoteUs.packages.package1;

  const tutors = [
    {
      id: 'tutor_canada_1',
      uid: 'tutor_canada_1',
      name: 'Charles Lambert',
      email: 'charles@native.test',
      country: 'Canada',
      approvalStatus: 'approved',
      isApproved: true,
    },
    {
      id: 'tutor_us_1',
      uid: 'tutor_us_1',
      name: 'Skull Bee',
      email: 'skull@native.test',
      country: 'United States',
      approvalStatus: 'approved',
      isApproved: true,
    },
    {
      id: 'tutor_nd_1',
      uid: 'tutor_nd_1',
      name: 'No Country Tutor',
      email: 'nocountry@native.test',
      approvalStatus: 'approved',
      isApproved: true,
    },
  ];

  const users = [
    { id: 'stu_1', uid: 'stu_1', email: 's1@test.com', role: 'student', teacherUid: 'tutor_canada_1' },
    { id: 'stu_2', uid: 'stu_2', email: 's2@test.com', role: 'student', teacherUid: 'tutor_us_1' },
    { id: 'stu_3', uid: 'stu_3', email: 's3@test.com', role: 'student', teacherUid: 'tutor_nd_1' },
  ];

  const transactions = [
    {
      id: 'tx_canada_2026_10',
      type: 'PACKAGE_PURCHASE',
      category: 'paid_package_purchase',
      studentUid: 'stu_1',
      studentEmail: 's1@test.com',
      teacherUid: 'tutor_canada_1',
      teacherEmail: 'charles@native.test',
      teacherName: 'Charles Lambert',
      packageLessons: 4,
      lessonsAdded: 4,
      basePriceUsd: 22,
      adminCommissionPercent: 25,
      commissionModel: 'MARKUP',
      ptaxRate: 5.1,
      unitFinalPriceBrl: quoteCanada.unit.finalPriceBrl,
      effectiveLessonPriceBrl: pkg4Canada.effectiveLessonPriceBrl,
      finalPriceBrl: pkg4Canada.finalPriceBrl,
      revenueBrl: pkg4Canada.finalPriceBrl,
      teacherShareBrl: pkg4Canada.teacherShareBrl,
      platformRevenueBrl: pkg4Canada.platformRevenueBrl,
      platformCostBrl: 12.0,
      isAdministrativeOperation: false,
      isPaidPurchase: true,
      countsAsRevenue: true,
      status: 'completed',
      createdAt: '2026-10-12T15:00:00.000Z',
    },
    {
      id: 'tx_us_2025_11',
      type: 'PACKAGE_PURCHASE',
      category: 'paid_package_purchase',
      studentUid: 'stu_2',
      studentEmail: 's2@test.com',
      teacherUid: 'tutor_us_1',
      teacherEmail: 'skull@native.test',
      teacherName: 'Skull Bee',
      packageLessons: 1,
      lessonsAdded: 1,
      basePriceUsd: 28,
      adminCommissionPercent: 30,
      commissionModel: 'MARKUP',
      ptaxRate: 5.5,
      unitFinalPriceBrl: quoteUs.unit.finalPriceBrl,
      effectiveLessonPriceBrl: pkg1Us.effectiveLessonPriceBrl,
      finalPriceBrl: pkg1Us.finalPriceBrl,
      revenueBrl: pkg1Us.finalPriceBrl,
      teacherShareBrl: pkg1Us.teacherShareBrl,
      platformRevenueBrl: pkg1Us.platformRevenueBrl,
      platformCostBrl: 8.5,
      isAdministrativeOperation: false,
      isPaidPurchase: true,
      countsAsRevenue: true,
      status: 'completed',
      createdAt: '2025-11-05T15:00:00.000Z',
    },
  ];

  const lessons = [
    {
      id: 'l_canada_2026_10',
      teacherUid: 'tutor_canada_1',
      studentUid: 'stu_1',
      studentEmail: 's1@test.com',
      status: 'completed',
      isTrialLesson: false,
      startDateTime: '2026-10-18T14:00:00.000Z',
      completedAt: '2026-10-18T14:55:00.000Z',
    },
    {
      id: 'l_us_2026_11',
      teacherUid: 'tutor_us_1',
      studentUid: 'stu_2',
      studentEmail: 's2@test.com',
      status: 'completed',
      isTrialLesson: false,
      startDateTime: '2026-11-10T14:00:00.000Z',
      completedAt: '2026-11-10T14:55:00.000Z',
    },
    {
      id: 'l_nd_2026_11',
      teacherUid: 'tutor_nd_1',
      studentUid: 'stu_3',
      studentEmail: 's3@test.com',
      status: 'completed',
      isTrialLesson: false,
      startDateTime: '2026-11-11T14:00:00.000Z',
      completedAt: '2026-11-11T14:55:00.000Z',
    },
  ];

  // ---------------------------------------------------------------------------
  // 1. Combinable Filters (Year, Month, Country, Native Friend) & KPI Sync
  // ---------------------------------------------------------------------------
  console.log('--- 1. Filtros combináveis (Ano, Mês, País, Native Friend) e KPIs ---');
  {
    const allDash = buildAdminOperationsDashboard({ transactions, lessons, tutors, users });
    check(allDash.rows.length === 4, `Dataset completo tem 4 linhas (obtido=${allDash.rows.length})`);
    check(
      allDash.filterOptions.countries.includes('Canada') &&
        allDash.filterOptions.countries.includes('United States'),
      'filterOptions.countries inclui Canada e United States'
    );
    check(allDash.filterOptions.hasMissingCountry === true, 'filterOptions.hasMissingCountry detecta linha sem país');

    const usOnly = buildAdminOperationsDashboard({
      transactions,
      lessons,
      tutors,
      users,
      filters: { country: 'United States' },
    });
    check(usOnly.rows.length === 2, `Filtro País=United States retorna 2 linhas (2025/11 e 2026/11)`);
    check(usOnly.kpis.alunosCount === 1, 'KPI Alunos distintos reconcilia para 1 aluno no recorte United States');
    check(usOnly.kpis.aulasContratadas === 1, 'KPI Aulas Contratadas = 1');
    check(usOnly.kpis.atendidas === 1, 'KPI Atendidas = 1');
    check(usOnly.kpis.saldo === 0, 'KPI Saldo = 0 (1 contratada em 2025 - 1 atendida em 2026)');
    check(usOnly.kpis.faturamentoBrl === pkg1Us.finalPriceBrl, 'KPI Faturamento = pacote US sem recalcular');
    check(
      usOnly.filterOptions.countries.includes('Canada') &&
        usOnly.filterOptions.years.includes(2026) &&
        usOnly.filterOptions.years.includes(2025),
      'filterOptions preserva opções completas mesmo após filtrar'
    );

    const us2026Nov = buildAdminOperationsDashboard({
      transactions,
      lessons,
      tutors,
      users,
      filters: { year: 2026, month: 11, country: 'United States', teacherUid: 'tutor_us_1' },
    });
    check(us2026Nov.rows.length === 1, 'Filtro combinado (Ano+Mês+País+Native Friend) retorna 1 linha exata');
    check(us2026Nov.rows[0]?.saldo === -1, 'Linha de competência apenas de realização preserva saldo -1');
    check(us2026Nov.kpis.saldo === -1 && us2026Nov.kpis.faturamentoBrl === 0, 'KPIs atualizam para o recorte combinado');

    const missingCountryOnly = buildAdminOperationsDashboard({
      transactions,
      lessons,
      tutors,
      users,
      filters: { country: '__nd__' },
    });
    check(
      missingCountryOnly.rows.length === 1 && missingCountryOnly.rows[0]?.teacherKey === 'tutor_nd_1',
      'Filtro country=__nd__ filtra corretamente registros sem país'
    );

    const emptyCombo = buildAdminOperationsDashboard({
      transactions,
      lessons,
      tutors,
      users,
      filters: { year: 2025, country: 'Canada' },
    });
    check(emptyCombo.rows.length === 0 && emptyCombo.kpis.alunosCount === 0, 'Combinação sem linhas retorna 0 linhas e KPIs zerados');
  }

  // ---------------------------------------------------------------------------
  // 2. Backend Endpoint Query Param ?country=... + RBAC
  // ---------------------------------------------------------------------------
  console.log('--- 2. Endpoint /api/admin/operations-dashboard?country=... e RBAC ---');
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
      if (token === 'token-student') {
        return { uid: 'stu_1', email: 's1@test.com', email_verified: true, role: 'student' };
      }
      throw new Error('Invalid');
    },
  } as any);

  await withServer(async (baseUrl) => {
    const studentRes = await fetch(`${baseUrl}/api/admin/operations-dashboard?country=Canada`, {
      headers: { Authorization: 'Bearer token-student' },
    });
    check(studentRes.status === 403, 'Aluno continua bloqueado com 403 ao filtrar por country');

    const res = await fetch(
      `${baseUrl}/api/admin/operations-dashboard?year=2026&month=10&country=Canada`,
      { headers: { Authorization: 'Bearer token-admin' } }
    );
    const json = await res.json();
    check(res.status === 200 && json.success === true, 'Admin recebe 200 OK com filtro country');
    check(json.rows?.length === 1 && json.rows[0]?.country === 'Canada', 'Backend aplica filtro country combinado');
    check(json.filtersApplied?.country === 'Canada', 'filtersApplied retorna country aplicado');
  });

  resetFirebaseAdminFirestoreForTesting();
  resetFirebaseAdminForTesting();

  // ---------------------------------------------------------------------------
  // 3. UI EN/PT Translation, Numeric Months (1..12), Header Filters & No Extra Selector
  // ---------------------------------------------------------------------------
  console.log('--- 3. UI EN/PT Global, Meses Numéricos (1..12) e Filtros nos Cabeçalhos ---');
  {
    const fullData = buildAdminOperationsDashboard({ transactions, lessons, tutors, users });
    const emptyData = buildAdminOperationsDashboard({
      transactions,
      lessons,
      tutors,
      users,
      filters: { year: 2025, country: 'Canada' },
    });

    const htmlEn = renderToString(
      React.createElement(AdminOperationsDashboard, { initialData: fullData, currentLanguage: 'en' })
    );
    const htmlPt = renderToString(
      React.createElement(AdminOperationsDashboard, { initialData: fullData, currentLanguage: 'pt' })
    );
    const htmlFallbackEs = renderToString(
      React.createElement(AdminOperationsDashboard, { initialData: fullData, currentLanguage: 'es' })
    );
    const htmlEmptyEn = renderToString(
      React.createElement(AdminOperationsDashboard, { initialData: emptyData, currentLanguage: 'en' })
    );

    const enStrings = [
      'Platform Operations Dashboard',
      'Monthly operations per Native Friend',
      'Students',
      'Contracted Lessons',
      'Attended',
      'Balance',
      'Revenue',
      'Profit',
      'Year',
      'Month',
      'Country',
      'Native Friend',
      'Lesson USD',
      'MARKUP Commission',
      'Lesson BRL',
      'Platform Cost',
      'Native Friend Cost',
      'Filtered totals (4 rows)',
      'N/A',
      'Refresh',
      'overflow-x-auto',
    ];
    for (const s of enStrings) {
      check(htmlEn.includes(s), `EN UI renderiza "${s}"`);
    }
    check(!htmlEn.includes('N/D'), 'EN UI não exibe N/D (exibe N/A)');
    check(!htmlEn.includes('Faturamento'), 'EN UI não mistura textos em PT ("Faturamento")');
    check(!htmlEn.includes('Aulas Contratadas'), 'EN UI não mistura textos em PT ("Aulas Contratadas")');

    const ptStrings = [
      'Painel de Operações da Plataforma',
      'Operação mensal por Native Friend',
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
      'Totais do recorte (4 linhas)',
      'N/D',
      'Atualizar',
    ];
    for (const s of ptStrings) {
      check(htmlPt.includes(s), `PT UI renderiza "${s}"`);
    }

    check(
      htmlFallbackEs.includes('Contracted Lessons') && htmlFallbackEs.includes('Filtered totals'),
      'Idioma diferente de PT usa EN (somente EN/PT)'
    );

    // Month names MUST NOT appear anywhere in EN or PT
    const forbiddenMonthNames = [
      'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
      'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
      'January', 'February', 'March', 'April', 'June', 'July',
      'August', 'September', 'October', 'November', 'December',
    ];
    for (const mName of forbiddenMonthNames) {
      check(!htmlPt.includes(mName) && !htmlEn.includes(mName), `Sem nome de mês "${mName}" em PT ou EN`);
    }

    // Numeric months 1..12 options present
    for (let m = 1; m <= 12; m++) {
      check(
        htmlEn.includes(`value="${m}">${m}</option>`),
        `Filtro de Mês renderiza número puro ${m}`
      );
    }

    // All 4 filters inside <thead>
    const theadMatch = htmlEn.match(/<thead>([\s\S]*?)<\/thead>/);
    const theadHtml = theadMatch ? theadMatch[1] : '';
    check(theadHtml.includes('id="ops-filter-year"'), 'Filtro Ano está dentro de <thead>');
    check(theadHtml.includes('id="ops-filter-month"'), 'Filtro Mês está dentro de <thead>');
    check(theadHtml.includes('id="ops-filter-country"'), 'Filtro País está dentro de <thead>');
    check(theadHtml.includes('id="ops-filter-teacher"'), 'Filtro Native Friend está dentro de <thead>');

    // Only 4 <select> elements in the entire dashboard (no extra language selector)
    const selectCount = (htmlEn.match(/<select /g) || []).length;
    check(selectCount === 4, `Dashboard possui exatamente 4 <select> (Ano, Mês, País, Native Friend), sem seletor extra de idioma (obtido=${selectCount})`);

    // Empty state keeps <thead> and all 4 filters mounted
    check(
      htmlEmptyEn.includes('id="ops-filter-year"') &&
        htmlEmptyEn.includes('id="ops-filter-country"') &&
        htmlEmptyEn.includes('No operational records found for the selected filters.') &&
        htmlEmptyEn.includes('Clear filters'),
      'Estado vazio preserva <thead> com os 4 filtros e exibe botão Clear filters'
    );

    // App.tsx passes global currentLanguage without altering global language system
    const appSource = fs.readFileSync(path.join(process.cwd(), 'src/App.tsx'), 'utf8');
    check(
      appSource.includes('<AdminOperationsDashboard currentLanguage={currentLanguage} />'),
      'App.tsx repassa currentLanguage global diretamente para AdminOperationsDashboard'
    );
  }

  console.log('\n====================================================================');
  console.log(`📊 RESULTADO ADM.OPS.2: ${passed} PASSOU | ${failed} FALHOU`);
  console.log('====================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Erro inesperado na suite ADM.OPS.2:', err);
  process.exit(1);
});
