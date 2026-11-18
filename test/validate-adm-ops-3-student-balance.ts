/**
 * TEST SUITE: ADM.OPS.3 — SALDO DO ALUNO E INDEPENDÊNCIA DO NATIVE FRIEND
 * Validates:
 *  1. Reads canonical persisted student balance (users/{uid}.availableLessons) from Firestore (default)
 *  2. Never fabricates balance from (contracted - attended) when persisted balance is missing -> N/D / N/A
 *  3. Never presents current student balance as historical balance of previous months (past rows & past filters -> null)
 *  4. Never assigns the same student's full balance to multiple Native Friends
 *  5. Displays per-teacher Saldo ONLY when attribution is unequivocal (single Native Friend across profile/assignments/txs/lessons); otherwise N/D
 *  6. Displays consolidated distinct student balance in KPI & footer without duplication across rows or teachers
 *  7. Preserves EN/PT localization, filters, and all other indicators + ADM-only RBAC on backend
 */

process.env.NODE_ENV = 'test';
process.env.FIREBASE_PROJECT_ID = 'itissimple-security-staging';
process.env.FIREBASE_DATABASE_ID = '(default)';
process.env.PAYMENTS_ENABLED = 'false';

import http from 'http';
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
  console.log('🧪 TEST SUITE: ADM.OPS.3 — SALDO DO ALUNO E INDEPENDÊNCIA DO NATIVE FRIEND');
  console.log('====================================================================\n');

  const quoteA = calculateFinancialPricingQuote({
    basePriceUsd: 20,
    adminCommissionPercent: 25,
    ptaxRate: 5.0,
    commissionModel: 'MARKUP',
    conversionBase: 'UNIT_PRICE_BRL',
  });
  const pkg4A = quoteA.packages.package4;

  const quoteB = calculateFinancialPricingQuote({
    basePriceUsd: 25,
    adminCommissionPercent: 30,
    ptaxRate: 5.0,
    commissionModel: 'MARKUP',
    conversionBase: 'UNIT_PRICE_BRL',
  });
  const pkg1B = quoteB.packages.package1;

  const tutors = [
    {
      id: 'tutor_ana_uid',
      uid: 'tutor_ana_uid',
      name: 'Ana Native',
      email: 'ana@native.test',
      country: 'Canada',
      approvalStatus: 'approved',
      isApproved: true,
    },
    {
      id: 'tutor_bob_uid',
      uid: 'tutor_bob_uid',
      name: 'Bob Native',
      email: 'bob@native.test',
      country: 'United States',
      approvalStatus: 'approved',
      isApproved: true,
    },
    {
      id: 'tutor_claire_uid',
      uid: 'tutor_claire_uid',
      name: 'Claire Native',
      email: 'claire@native.test',
      country: 'United Kingdom',
      approvalStatus: 'approved',
      isApproved: true,
    },
  ];

  // Student 1: switched from Ana to Bob (bought with Ana in Sept, now linked to Bob & took lesson with Bob in Nov)
  //   Canonical persisted availableLessons = 5 (NOT 4 - 2 = 2; e.g., had prior balance + new pack).
  // Student 2: unequivocally ONLY with Ana (availableLessons = 3)
  // Student 3: unequivocally ONLY with Claire (bought in Sept, no Nov activity, availableLessons = 7)
  // Legacy duplicate doc for Student 1 with stale availableLessons = 99 MUST be ignored in favor of canonical UID doc.
  const users = [
    {
      id: 'stu_1_uid',
      uid: 'stu_1_uid',
      email: 's1@test.com',
      name: 'Student One',
      role: 'student',
      teacherUid: 'tutor_bob_uid',
      availableLessons: 5,
    },
    {
      id: 's1@test.com',
      email: 's1@test.com',
      canonicalUid: 'stu_1_uid',
      role: 'student',
      availableLessons: 99,
    },
    {
      id: 'stu_2_uid',
      uid: 'stu_2_uid',
      email: 's2@test.com',
      name: 'Student Two',
      role: 'student',
      teacherUid: 'tutor_ana_uid',
      availableLessons: 3,
    },
    {
      id: 'stu_3_uid',
      uid: 'stu_3_uid',
      email: 's3@test.com',
      name: 'Student Three',
      role: 'student',
      teacherUid: 'tutor_claire_uid',
      availableLessons: 7,
    },
  ];

  const transactions = [
    // Student 1 bought 4 lessons with Ana in Sept 2026 (past month)
    {
      id: 'tx_s1_sept_ana',
      type: 'PACKAGE_PURCHASE',
      category: 'paid_package_purchase',
      studentUid: 'stu_1_uid',
      studentEmail: 's1@test.com',
      teacherUid: 'tutor_ana_uid',
      teacherEmail: 'ana@native.test',
      teacherName: 'Ana Native',
      packageLessons: 4,
      lessonsAdded: 4,
      basePriceUsd: 20,
      adminCommissionPercent: 25,
      commissionModel: 'MARKUP',
      ptaxRate: 5.0,
      unitFinalPriceBrl: quoteA.unit.finalPriceBrl,
      effectiveLessonPriceBrl: pkg4A.effectiveLessonPriceBrl,
      finalPriceBrl: pkg4A.finalPriceBrl,
      revenueBrl: pkg4A.finalPriceBrl,
      teacherShareBrl: pkg4A.teacherShareBrl,
      platformRevenueBrl: pkg4A.platformRevenueBrl,
      isAdministrativeOperation: false,
      isPaidPurchase: true,
      countsAsRevenue: true,
      status: 'completed',
      createdAt: '2026-09-10T15:00:00.000Z',
    },
    // Student 2 bought 4 lessons with Ana in Nov 2026 (current month)
    {
      id: 'tx_s2_nov_ana',
      type: 'PACKAGE_PURCHASE',
      category: 'paid_package_purchase',
      studentUid: 'stu_2_uid',
      studentEmail: 's2@test.com',
      teacherUid: 'tutor_ana_uid',
      teacherEmail: 'ana@native.test',
      teacherName: 'Ana Native',
      packageLessons: 4,
      lessonsAdded: 4,
      basePriceUsd: 20,
      adminCommissionPercent: 25,
      commissionModel: 'MARKUP',
      ptaxRate: 5.0,
      unitFinalPriceBrl: quoteA.unit.finalPriceBrl,
      effectiveLessonPriceBrl: pkg4A.effectiveLessonPriceBrl,
      finalPriceBrl: pkg4A.finalPriceBrl,
      revenueBrl: pkg4A.finalPriceBrl,
      teacherShareBrl: pkg4A.teacherShareBrl,
      platformRevenueBrl: pkg4A.platformRevenueBrl,
      isAdministrativeOperation: false,
      isPaidPurchase: true,
      countsAsRevenue: true,
      status: 'completed',
      createdAt: '2026-11-05T15:00:00.000Z',
    },
    // Student 3 bought 1 lesson with Claire in Sept 2026 (past month) — also got admin adjustment
    {
      id: 'tx_s3_sept_claire',
      type: 'PACKAGE_PURCHASE',
      category: 'paid_package_purchase',
      studentUid: 'stu_3_uid',
      studentEmail: 's3@test.com',
      teacherUid: 'tutor_claire_uid',
      teacherEmail: 'claire@native.test',
      teacherName: 'Claire Native',
      packageLessons: 1,
      lessonsAdded: 1,
      basePriceUsd: 25,
      adminCommissionPercent: 30,
      commissionModel: 'MARKUP',
      ptaxRate: 5.0,
      unitFinalPriceBrl: quoteB.unit.finalPriceBrl,
      effectiveLessonPriceBrl: pkg1B.effectiveLessonPriceBrl,
      finalPriceBrl: pkg1B.finalPriceBrl,
      revenueBrl: pkg1B.finalPriceBrl,
      teacherShareBrl: pkg1B.teacherShareBrl,
      platformRevenueBrl: pkg1B.platformRevenueBrl,
      isAdministrativeOperation: false,
      isPaidPurchase: true,
      countsAsRevenue: true,
      status: 'completed',
      createdAt: '2026-09-12T15:00:00.000Z',
    },
  ];

  const lessons = [
    // Student 1 completed 1 lesson with Ana in Nov 2026 (referenced only by email on legacy lesson)
    {
      id: 'l_s1_nov_ana',
      teacherUid: 'tutor_ana_uid',
      studentEmail: 's1@test.com',
      status: 'completed',
      isTrialLesson: false,
      startDateTime: '2026-11-02T14:00:00.000Z',
      completedAt: '2026-11-02T14:55:00.000Z',
    },
    // Student 1 completed 1 lesson with Bob in Nov 2026 (same student across 2 teachers in Nov!)
    {
      id: 'l_s1_nov_bob',
      teacherUid: 'tutor_bob_uid',
      studentUid: 'stu_1_uid',
      studentEmail: 's1@test.com',
      status: 'completed',
      isTrialLesson: false,
      startDateTime: '2026-11-10T14:00:00.000Z',
      completedAt: '2026-11-10T14:55:00.000Z',
    },
    // Student 2 completed 1 lesson with Ana in Nov 2026
    {
      id: 'l_s2_nov_ana',
      teacherUid: 'tutor_ana_uid',
      studentUid: 'stu_2_uid',
      studentEmail: 's2@test.com',
      status: 'completed',
      isTrialLesson: false,
      startDateTime: '2026-11-08T14:00:00.000Z',
      completedAt: '2026-11-08T14:55:00.000Z',
    },
  ];

  const generatedAt = '2026-11-18T12:00:00.000Z';

  // ---------------------------------------------------------------------------
  // 1. Core ADM.OPS.3 Rules: Canonical Balance, Historical N/D, Unequivocal Teacher, Distinct KPI
  // ---------------------------------------------------------------------------
  console.log('--- 1. Saldo Canônico, Histórico N/D, Atribuição Inequívoca e KPI Distinto ---');
  {
    const dash = buildAdminOperationsDashboard({
      transactions,
      lessons,
      tutors,
      users,
      generatedAt,
    });

    const septAna = dash.rows.find((r) => r.year === 2026 && r.month === 9 && r.teacherKey === 'tutor_ana_uid');
    const septClaire = dash.rows.find((r) => r.year === 2026 && r.month === 9 && r.teacherKey === 'tutor_claire_uid');
    const novAna = dash.rows.find((r) => r.year === 2026 && r.month === 11 && r.teacherKey === 'tutor_ana_uid');
    const novBob = dash.rows.find((r) => r.year === 2026 && r.month === 11 && r.teacherKey === 'tutor_bob_uid');

    check(septAna?.saldo === null, `Mês anterior (2026-09 Ana) NÃO exibe saldo atual -> null (obtido=${septAna?.saldo})`);
    check(septClaire?.saldo === null, `Mês anterior (2026-09 Claire) NÃO exibe saldo atual -> null (obtido=${septClaire?.saldo})`);
    check(novAna?.saldo === null, `Nov Ana contém Student 1 (compartilhado com Bob) -> sem atribuição inequívoca -> null (obtido=${novAna?.saldo})`);
    check(novBob?.saldo === null, `Nov Bob contém Student 1 (compartilhado com Ana) -> sem atribuição inequívoca -> null (obtido=${novBob?.saldo})`);

    // KPI Saldo must consolidate distinct students WITHOUT duplicating Student 1 (5 + 3 + 7 = 15, NOT 99 from legacy doc, NOT 5+5!)
    check(dash.kpis.alunosCount === 3, `KPI Alunos distintos = 3 (legacy email doc deduplicado), obtido=${dash.kpis.alunosCount}`);
    check(dash.kpis.saldo === 15, `KPI Saldo consolidado distinto = 15 (5 + 3 + 7, sem duplicidade), obtido=${dash.kpis.saldo}`);

    // Other indicators remain completely preserved
    check(dash.kpis.aulasContratadas === 9, `KPI Aulas Contratadas preservado = 9 (4 + 4 + 1), obtido=${dash.kpis.aulasContratadas}`);
    check(dash.kpis.atendidas === 3, `KPI Atendidas preservado = 3, obtido=${dash.kpis.atendidas}`);
    const expectedRev = Number((pkg4A.finalPriceBrl * 2 + pkg1B.finalPriceBrl).toFixed(2));
    check(dash.kpis.faturamentoBrl === expectedRev, `KPI Faturamento preservado = ${expectedRev}`);
  }

  // ---------------------------------------------------------------------------
  // 2. Unequivocal Single-Teacher Attribution in Current Month
  // ---------------------------------------------------------------------------
  console.log('--- 2. Atribuição Inequívoca por Professor no Mês Atual ---');
  {
    // Remove Student 1's overlap so Student 2 (only Ana) and Student 4 (only Bob) are unequivocal
    const dashUnequivocal = buildAdminOperationsDashboard({
      transactions: [transactions[1]], // Student 2 (availableLessons = 3) with Ana in Nov 2026
      lessons: [
        lessons[2], // Student 2 with Ana in Nov 2026
        {
          id: 'l_s4_nov_bob',
          teacherUid: 'tutor_bob_uid',
          studentUid: 'stu_4_uid',
          studentEmail: 's4@test.com',
          status: 'completed',
          isTrialLesson: false,
          startDateTime: '2026-11-11T14:00:00.000Z',
          completedAt: '2026-11-11T14:55:00.000Z',
        },
      ],
      tutors,
      users: [
        users[2], // stu_2_uid -> availableLessons: 3, teacherUid: tutor_ana_uid
        {
          id: 'stu_4_uid',
          uid: 'stu_4_uid',
          email: 's4@test.com',
          role: 'student',
          teacherUid: 'tutor_bob_uid',
          availableLessons: 8,
        },
      ],
      generatedAt,
    });

    const novAna = dashUnequivocal.rows.find((r) => r.teacherKey === 'tutor_ana_uid');
    const novBob = dashUnequivocal.rows.find((r) => r.teacherKey === 'tutor_bob_uid');

    check(novAna?.saldo === 3, `Nov Ana inequívoco exibe availableLessons=3 (mesmo com 4 contratadas - 1 atendida = 3, usa Firestore), obtido=${novAna?.saldo}`);
    check(novBob?.saldo === 8, `Nov Bob inequívoco exibe availableLessons=8 do Firestore (0 contratadas no mês - 1 atendida), obtido=${novBob?.saldo}`);
    check(dashUnequivocal.kpis.saldo === 11, `KPI Saldo = 3 + 8 = 11, obtido=${dashUnequivocal.kpis.saldo}`);
  }

  // ---------------------------------------------------------------------------
  // 3. Student Switched Native Friend via Assignment Only (No Multi-Teacher Lessons Yet)
  // ---------------------------------------------------------------------------
  console.log('--- 3. Troca de Vínculo (users vs tx) Torna Atribuição por Professor N/D ---');
  {
    const dashSwitched = buildAdminOperationsDashboard({
      transactions: [
        {
          ...transactions[1], // Student 2 bought with Ana in Nov 2026
        },
      ],
      lessons: [],
      tutors,
      users: [
        {
          ...users[2],
          teacherUid: 'tutor_bob_uid', // Student 2 is now assigned to Bob in users!
          availableLessons: 4,
        },
      ],
      generatedAt,
    });

    const novAna = dashSwitched.rows.find((r) => r.teacherKey === 'tutor_ana_uid');
    check(novAna?.saldo === null, `Compra com Ana + vínculo atual com Bob -> row.saldo=null (N/D), obtido=${novAna?.saldo}`);
    check(dashSwitched.kpis.saldo === 4, `KPI Saldo consolidado preserva saldo do aluno (4), obtido=${dashSwitched.kpis.saldo}`);

    const filteredAna = buildAdminOperationsDashboard({
      transactions: [{ ...transactions[1] }],
      lessons: [],
      tutors,
      users: [{ ...users[2], teacherUid: 'tutor_bob_uid', availableLessons: 4 }],
      filters: { teacherUid: 'tutor_ana_uid' },
      generatedAt,
    });
    check(filteredAna.kpis.saldo === null, `Filtro por teacherUid=Ana retorna KPI Saldo=null (N/D) quando aluno pertence a múltiplos professores, obtido=${filteredAna.kpis.saldo}`);
  }

  // ---------------------------------------------------------------------------
  // 4. Filters (Historical Month/Year vs Current Month, Country, Teacher)
  // ---------------------------------------------------------------------------
  console.log('--- 4. Filtros Temporais Históricos vs Mês Atual e País/Professor ---');
  {
    const pastMonthFilter = buildAdminOperationsDashboard({
      transactions,
      lessons,
      tutors,
      users,
      filters: { year: 2026, month: 9 },
      generatedAt,
    });
    check(pastMonthFilter.kpis.saldo === null, `Filtro mês anterior (2026-09) retorna KPI Saldo=null (N/D), obtido=${pastMonthFilter.kpis.saldo}`);

    const pastYearFilter = buildAdminOperationsDashboard({
      transactions,
      lessons,
      tutors,
      users,
      filters: { year: 2025 },
      generatedAt,
    });
    check(pastYearFilter.kpis.saldo === null, `Filtro ano anterior (2025) retorna KPI Saldo=null (N/D), obtido=${pastYearFilter.kpis.saldo}`);

    const claireFilter = buildAdminOperationsDashboard({
      transactions,
      lessons,
      tutors,
      users,
      filters: { teacherUid: 'tutor_claire_uid' },
      generatedAt,
    });
    check(claireFilter.rows[0]?.saldo === null, 'Linha 2026-09 de Claire continua null (mês anterior)');
    check(claireFilter.kpis.saldo === 7, `Filtro teacherUid=Claire (período all/all, aluno 3 inequívoco) retorna KPI Saldo=7, obtido=${claireFilter.kpis.saldo}`);

    const ukCountryFilter = buildAdminOperationsDashboard({
      transactions,
      lessons,
      tutors,
      users,
      filters: { country: 'United Kingdom' },
      generatedAt,
    });
    check(ukCountryFilter.kpis.saldo === 7, `Filtro País=United Kingdom (aluno 3 inequívoco) retorna KPI Saldo=7, obtido=${ukCountryFilter.kpis.saldo}`);

    const canadaCountryFilter = buildAdminOperationsDashboard({
      transactions,
      lessons,
      tutors,
      users,
      filters: { country: 'Canada' },
      generatedAt,
    });
    check(canadaCountryFilter.kpis.saldo === null, `Filtro País=Canada (inclui aluno 1 com aulas nos EUA) retorna KPI Saldo=null (N/D), obtido=${canadaCountryFilter.kpis.saldo}`);
  }

  // ---------------------------------------------------------------------------
  // 5. Missing Persisted Balance Never Fabricated + Zero Balance Preserved
  // ---------------------------------------------------------------------------
  console.log('--- 5. Saldo Zero Preservado vs Saldo Ausente Nunca Fabricado ---');
  {
    const zeroBalanceDash = buildAdminOperationsDashboard({
      transactions: [{ ...transactions[1] }],
      lessons: [],
      tutors,
      users: [{ ...users[2], availableLessons: 0 }],
      generatedAt,
    });
    check(zeroBalanceDash.rows[0]?.saldo === 0, 'Saldo persistido igual a 0 é exibido como 0 (não N/D)');
    check(zeroBalanceDash.kpis.saldo === 0, 'KPI Saldo igual a 0 é exibido como 0');

    const missingBalanceDash = buildAdminOperationsDashboard({
      transactions: [{ ...transactions[1] }],
      lessons: [],
      tutors,
      users: [{ id: 'stu_2_uid', uid: 'stu_2_uid', email: 's2@test.com', role: 'student', teacherUid: 'tutor_ana_uid' }],
      generatedAt,
    });
    check(missingBalanceDash.rows[0]?.saldo === null, 'Sem availableLessons no Firestore -> row.saldo = null (não fabrica 4)');
    check(missingBalanceDash.kpis.saldo === null, 'Sem availableLessons no Firestore -> kpis.saldo = null (não fabrica 4)');
  }

  // ---------------------------------------------------------------------------
  // 6. Backend Endpoint Integration (Firestore (default) + RBAC) & UI EN/PT Render
  // ---------------------------------------------------------------------------
  console.log('--- 6. Endpoint Backend (Firestore default + RBAC) e UI EN/PT ---');
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
        return { uid: 'stu_1_uid', email: 's1@test.com', email_verified: true, role: 'student' };
      }
      throw new Error('Invalid');
    },
  } as any);

  await withServer(async (baseUrl) => {
    const stuRes = await fetch(`${baseUrl}/api/admin/operations-dashboard`, {
      headers: { Authorization: 'Bearer token-student' },
    });
    check(stuRes.status === 403, `RBAC bloqueia aluno com 403 (obtido=${stuRes.status})`);

    const admRes = await fetch(`${baseUrl}/api/admin/operations-dashboard`, {
      headers: { Authorization: 'Bearer token-admin' },
    });
    const admJson = await admRes.json();
    check(admRes.status === 200 && admJson.success === true, 'Endpoint ADM retorna 200 OK');
    check(admJson.kpis?.saldo === 15, `Endpoint retorna KPI Saldo consolidado distinto = 15, obtido=${admJson.kpis?.saldo}`);
    check(
      Array.isArray(admJson.rows) && admJson.rows.every((r: any) => r.saldo === null),
      'Endpoint retorna row.saldo = null para todas as linhas ambíguas/históricas'
    );
  });

  resetFirebaseAdminFirestoreForTesting();
  resetFirebaseAdminForTesting();

  {
    const dashData = buildAdminOperationsDashboard({
      transactions,
      lessons,
      tutors,
      users,
      generatedAt,
    });
    const htmlPt = renderToString(
      React.createElement(AdminOperationsDashboard, { initialData: dashData, currentLanguage: 'pt' })
    );
    const htmlEn = renderToString(
      React.createElement(AdminOperationsDashboard, { initialData: dashData, currentLanguage: 'en' })
    );

    check(htmlPt.includes('Créditos disponíveis por aluno'), 'UI PT exibe subtítulo atualizado do KPI Saldo');
    check(htmlPt.includes('>15<'), 'UI PT renderiza KPI/Total Saldo = 15');
    check(htmlPt.includes('N/D') && !htmlPt.includes('N/A'), 'UI PT renderiza N/D para saldos não atribuíveis');
    check(!htmlPt.includes('Contratadas − Atendidas'), 'UI PT remove subtítulo obsoleto Contratadas − Atendidas');

    check(htmlEn.includes('Available credits per student'), 'UI EN exibe subtítulo atualizado do KPI Balance');
    check(htmlEn.includes('>15<'), 'UI EN renderiza KPI/Total Balance = 15');
    check(htmlEn.includes('N/A') && !htmlEn.includes('N/D'), 'UI EN renderiza N/A para saldos não atribuíveis');
    check(!htmlEn.includes('Contracted − Attended'), 'UI EN remove subtítulo obsoleto Contracted − Attended');
  }

  console.log('\n====================================================================');
  console.log(`📊 RESULTADO ADM.OPS.3: ${passed} PASSOU | ${failed} FALHOU`);
  console.log('====================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Erro inesperado na suite ADM.OPS.3:', err);
  process.exit(1);
});
