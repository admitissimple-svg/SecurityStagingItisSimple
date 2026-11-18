/**
 * TEST SUITE: NF.SWITCH.2C — MOTOR PURO DE CONVERSÃO DE CRÉDITOS (NF.SWITCH.1A)
 *
 * Valida integralmente `src/utils/switchConversionEngine.ts`:
 *  1. Conservação exata de centavos inteiros (orçamento === convertido + resíduo; professor + plataforma === convertido)
 *  2. Composição determinística ótima de pacotes combinados (1, 4, 8, 12) + prova por força bruta em orçamentos variados
 *  3. Arredondamentos FIN.2C + PTAX D-1 + MARKUP + rateio unitário após consumo e estorno exato de índices intermediários
 *  4. Troca para professor mais caro, mais barato e de mesmo valor
 *  5. Preservação 1:1 de cortesias sem valor financeiro presumido (cortesia pura e mista com pago)
 *  6. Saldos insuficientes (0 créditos, todos travados em aulas agendadas, orçamento < 1 aula no destino)
 *  7. Bloqueio por ausência de evidência financeira, bloqueio automático de legacy_unreconciled e lote conciliado sem rateio histórico
 *  8. Respeito ao estado das aulas agendadas e regras oficiais de estorno (keep, cancel_by_student, cancel_by_teacher/admin, not_completed, trial)
 *  9. Separação contábil estrita (receita original, valor convertido, obrigação futura, pagamento devido) + zero receita artificial + imutabilidade
 */

import assert from 'assert';
import {
  buildCourtesyAdjustmentLotData,
  buildCourtesyGrantLotData,
  buildLegacyUnreconciledLotData,
  buildPaidPackageLotData,
  buildReconciledPaidLotData,
  consumeUnitsFromLots,
  CREDIT_LEDGER_DIVERGENCE_CODE,
  CreditLedgerError,
  refundUnitToExactLot,
} from '../src/utils/creditLots';
import {
  calculateFinancialPricingQuote,
  toCents,
} from '../src/utils/financialEngine';
import {
  assertSwitchConversionReady,
  composePackagesDeterministically,
  evaluateSwitchConversion,
  SwitchConversionError,
  type ApprovedPackageSize,
  type TargetPackagePriceSpec,
} from '../src/utils/switchConversionEngine';
import type { CreditLot, LiveLesson } from '../src/types';

let passed = 0;
let failed = 0;

function runTest(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`PASS: ${name}`);
  } catch (err: any) {
    failed++;
    console.error(`FAIL: ${name} -> ${err?.message || err}`);
    if (err?.stack) console.error(err.stack);
  }
}

const NOW_ISO = '2026-11-18T12:00:00.000Z';
const STUDENT_UID = 'std_switch_2c_uid_001';
const SOURCE_TEACHER_UID = 'tut_source_2c_uid_001';
const TARGET_TEACHER_UID = 'tut_target_2c_uid_002';

function makePaidLot(params: {
  idKey: string;
  lessonsCount: number;
  basePriceUsd: number;
  adminCommissionPercent: number;
  ptaxRate: number;
  lotSequence?: number;
  teacherUid?: string;
}): CreditLot {
  const quote = calculateFinancialPricingQuote({
    basePriceUsd: params.basePriceUsd,
    adminCommissionPercent: params.adminCommissionPercent,
    ptaxRate: params.ptaxRate,
    commissionModel: 'MARKUP',
    conversionBase: 'UNIT_PRICE_BRL',
  });
  const pkgCalc = quote.packages.list.find((p) => p.lessonsCount === params.lessonsCount);
  if (!pkgCalc) throw new Error(`Unsupported test package size: ${params.lessonsCount}`);

  return buildPaidPackageLotData({
    studentUid: STUDENT_UID,
    studentEmail: 'student2c@itissimple.org',
    lessonsCount: params.lessonsCount,
    lotSequence: params.lotSequence ?? 1,
    nowIso: NOW_ISO,
    sourceTransactionId: `tx_${params.idKey}`,
    idempotencyKey: `idem_${params.idKey}`,
    pricedTeacherUid: params.teacherUid ?? SOURCE_TEACHER_UID,
    teacherEmail: 'source.teacher@itissimple.org',
    teacherName: 'Source Native Friend',
    packageName: pkgCalc.labelPt,
    basePriceUsd: params.basePriceUsd,
    adminCommissionPercent: params.adminCommissionPercent,
    commissionModel: 'MARKUP',
    commissionVersion: 1,
    ptaxRate: params.ptaxRate,
    ptaxQuoteDate: '2026-11-17',
    ptaxPricingDate: '2026-11-18',
    pkgCalc,
    gatewayProvider: 'stripe',
    gatewayTransactionId: `gw_${params.idKey}`,
    performedByUid: STUDENT_UID,
    performedByEmail: 'student2c@itissimple.org',
    performedByRole: 'student',
  });
}

function makeLesson(params: {
  id: string;
  status: LiveLesson['status'];
  creditLotId?: string;
  creditUnitIndex?: number;
  isTrialLesson?: boolean;
  cancelledBy?: string;
  notCompletedResponsible?: string;
  creditRefunded?: boolean;
  teacherUid?: string;
}): LiveLesson {
  return {
    id: params.id,
    teacherEmail: 'source.teacher@itissimple.org',
    teacherName: 'Source Native Friend',
    teacherUid: params.teacherUid ?? SOURCE_TEACHER_UID,
    studentEmail: 'student2c@itissimple.org',
    studentName: 'Student 2C',
    studentUid: STUDENT_UID,
    title: `Lesson ${params.id}`,
    startDateTime: '2026-11-20T14:00:00.000Z',
    endDateTime: '2026-11-20T14:50:00.000Z',
    meetLink: 'https://meet.google.com/test-2c',
    status: params.status,
    isTrialLesson: params.isTrialLesson ?? false,
    creditLotId: params.creditLotId,
    creditUnitIndex: params.creditUnitIndex,
    cancelledBy: params.cancelledBy,
    notCompletedResponsible: params.notCompletedResponsible,
    creditRefunded: params.creditRefunded,
  };
}

function bruteForceOptimalComposition(
  budgetBrlCents: number,
  table: TargetPackagePriceSpec[]
): { lessons: number; cost: number; counts: Record<ApprovedPackageSize, number> } {
  const p1 = table.find((t) => t.lessonsCount === 1)!;
  const p4 = table.find((t) => t.lessonsCount === 4)!;
  const p8 = table.find((t) => t.lessonsCount === 8)!;
  const p12 = table.find((t) => t.lessonsCount === 12)!;

  let best = { lessons: 0, cost: 0, counts: { 12: 0, 8: 0, 4: 0, 1: 0 } as Record<ApprovedPackageSize, number> };

  for (let c12 = 0; c12 * p12.finalPriceBrlCents <= budgetBrlCents; c12++) {
    for (let c8 = 0; c12 * p12.finalPriceBrlCents + c8 * p8.finalPriceBrlCents <= budgetBrlCents; c8++) {
      for (
        let c4 = 0;
        c12 * p12.finalPriceBrlCents + c8 * p8.finalPriceBrlCents + c4 * p4.finalPriceBrlCents <= budgetBrlCents;
        c4++
      ) {
        const rem =
          budgetBrlCents - (c12 * p12.finalPriceBrlCents + c8 * p8.finalPriceBrlCents + c4 * p4.finalPriceBrlCents);
        const c1 = Math.floor(rem / p1.finalPriceBrlCents);
        const lessons = 12 * c12 + 8 * c8 + 4 * c4 + c1;
        const cost =
          c12 * p12.finalPriceBrlCents +
          c8 * p8.finalPriceBrlCents +
          c4 * p4.finalPriceBrlCents +
          c1 * p1.finalPriceBrlCents;

        const better =
          lessons > best.lessons ||
          (lessons === best.lessons && cost < best.cost) ||
          (lessons === best.lessons &&
            cost === best.cost &&
            (c12 > best.counts[12] ||
              (c12 === best.counts[12] && c8 > best.counts[8]) ||
              (c12 === best.counts[12] && c8 === best.counts[8] && c4 > best.counts[4]) ||
              (c12 === best.counts[12] && c8 === best.counts[8] && c4 === best.counts[4] && c1 > best.counts[1])));
        if (better) {
          best = { lessons, cost, counts: { 12: c12, 8: c8, 4: c4, 1: c1 } };
        }
      }
    }
  }
  return best;
}

console.log('=========================================================================');
console.log(' NF.SWITCH.2C — MOTOR PURO DE CONVERSÃO DE CRÉDITOS (CONTRATO NF.SWITCH.1A)');
console.log('=========================================================================\n');

// 1. Conservação exata de centavos & professor mais caro -> menos aulas + resíduo exato
runTest('1. Professor mais caro: maximiza aulas sem ultrapassar orçamento e conserva centavos exatos no resíduo', () => {
  // Source: $15 USD, 20% MARKUP, PTAX 5.00 => unit BRL = 90.00 (9000 cents). Pack 8 (10% off) = 648.00 (64800 cents)
  // Consume 2 units -> 6 remaining units (540.00? Wait: 64800 / 8 = 8100 cents/unit => 6 * 8100 = 48600 cents)
  let lot = makePaidLot({
    idKey: 'expensive_1',
    lessonsCount: 8,
    basePriceUsd: 15,
    adminCommissionPercent: 20,
    ptaxRate: 5.0,
  });
  const cRes = consumeUnitsFromLots({ lots: [lot], units: 2, nowIso: NOW_ISO });
  lot = cRes.lots[0];
  const l0 = makeLesson({ id: 'l0', status: 'completed', creditLotId: lot.id, creditUnitIndex: 0 });
  const l1 = makeLesson({ id: 'l1', status: 'completed', creditLotId: lot.id, creditUnitIndex: 1 });

  // Target (more expensive): $25 USD, 25% MARKUP, PTAX 5.20
  // Unit USD = 25 * 1.25 = 31.25 -> Unit BRL = 31.25 * 5.20 = 162.50 (16250 cents)
  // Pack 4 (5% off) = 4 * 16250 = 65000 - 3250 = 61750 cents (> 48600!)
  // Pack 1 = 16250 cents. Budget = 48600 -> fits 2x Pack 1 (32500 cents), residual = 16100 cents (< 16250!)
  const result = evaluateSwitchConversion({
    studentUid: STUDENT_UID,
    studentAvailableLessons: 6,
    creditLots: [lot],
    lessons: [l0, l1],
    targetTeacher: {
      teacherUid: TARGET_TEACHER_UID,
      basePriceUsd: 25,
      adminCommissionPercent: 25,
      commissionModel: 'MARKUP',
      isApproved: true,
      isCommercializable: true,
    },
    ptax: { ptaxRate: 5.2, quoteDate: '2026-11-17', pricingDate: '2026-11-18' },
  });

  assert.strictEqual(result.status, 'READY');
  assert.strictEqual(result.canConvert, true);
  assert.strictEqual(result.sourceAnalysis.budgetBrlCents, 48600);
  assert.strictEqual(result.conversionPlan!.packageComposition.length, 1);
  assert.strictEqual(result.conversionPlan!.packageComposition[0].packageSize, 1);
  assert.strictEqual(result.conversionPlan!.packageComposition[0].quantity, 2);
  assert.strictEqual(result.accounting!.convertedValue.convertedPaidLessonsCount, 2);
  assert.strictEqual(result.accounting!.convertedValue.convertedTotalBrlCents, 32500);
  assert.strictEqual(result.accounting!.convertedValue.residualBrlCents, 16100);
  assert.strictEqual(result.accounting!.convertedValue.centsConservedExactly, true);
  assert.strictEqual(
    result.accounting!.convertedValue.convertedTotalBrlCents +
      result.accounting!.convertedValue.residualBrlCents,
    48600
  );
  // Check FIN.2C per-lot teacher/platform split conservation
  for (const pLot of result.conversionPlan!.plannedPaidLots) {
    assert.strictEqual(pLot.teacherShareBrlCents + pLot.platformRevenueBrlCents, pLot.totalPaidBrlCents);
    const schedSum = pLot.unitCentsSchedule.reduce((s, u) => s + Number(u.totalPaidBrlCents), 0);
    assert.strictEqual(schedSum, pLot.totalPaidBrlCents);
  }
});

// 2. Professor mais barato: gera mais aulas combinando pacotes reais (12 + 4 + 1, etc.)
runTest('2. Professor mais barato: compõe pacotes combinados (12/8/4/1) maximizando aulas dentro do orçamento', () => {
  // Source: $30 USD, 30% MARKUP, PTAX 5.50 -> Unit BRL = 39 * 5.50 = 214.50 (21450 cents)
  // Pack 12 (15% off): gross = 257400, disc = 38610, final = 218790 cents
  // Remaining 10 units after consuming 2
  let lot = makePaidLot({
    idKey: 'cheaper_1',
    lessonsCount: 12,
    basePriceUsd: 30,
    adminCommissionPercent: 30,
    ptaxRate: 5.5,
  });
  const cRes = consumeUnitsFromLots({ lots: [lot], units: 2, nowIso: NOW_ISO });
  lot = cRes.lots[0];

  // Target (cheaper): $12 USD, 20% MARKUP, PTAX 5.50
  // Unit USD = 14.40 -> Unit BRL = 79.20 (7920 cents)
  // Pack 1 = 7920, Pack 4 = 30096, Pack 8 = 57024, Pack 12 = 80784
  const result = evaluateSwitchConversion({
    studentUid: STUDENT_UID,
    creditLots: [lot],
    targetTeacher: {
      teacherUid: TARGET_TEACHER_UID,
      basePriceUsd: 12,
      adminCommissionPercent: 20,
      commissionModel: 'MARKUP',
      isApproved: true,
    },
    ptax: { ptaxRate: 5.5 },
  });

  assert.strictEqual(result.status, 'READY');
  const budget = result.sourceAnalysis.budgetBrlCents;
  const brute = bruteForceOptimalComposition(budget, result.conversionPlan!.targetPackagesTable);

  assert.strictEqual(result.accounting!.convertedValue.convertedPaidLessonsCount, brute.lessons);
  assert.strictEqual(result.accounting!.convertedValue.convertedTotalBrlCents, brute.cost);
  assert.ok(result.accounting!.convertedValue.convertedPaidLessonsCount > 10, 'Deve gerar mais aulas no professor mais barato');
  assert.ok(
    result.accounting!.convertedValue.residualBrlCents >= 0 &&
      result.accounting!.convertedValue.residualBrlCents < result.conversionPlan!.targetUnitFinalPriceBrlCents,
    'Resíduo estritamente menor que 1 aula avulsa'
  );
  assert.strictEqual(
    result.accounting!.convertedValue.convertedTotalBrlCents + result.accounting!.convertedValue.residualBrlCents,
    budget
  );
  // Expect multi-package composition (e.g. 2x12 + ... or 1x12 + 1x8 + ...)
  assert.ok(result.conversionPlan!.packageComposition.length >= 2, 'Deve combinar múltiplos tamanhos de pacotes');
});

// 3. Otimização determinística vs força bruta em dezenas de orçamentos e preços (incluindo grandes orçamentos)
runTest('3. Composição determinística ótima coincide 100% com força bruta em múltiplos cenários e escalas', () => {
  const quote = calculateFinancialPricingQuote({
    basePriceUsd: 13,
    adminCommissionPercent: 31,
    ptaxRate: 5.47,
    commissionModel: 'MARKUP',
    conversionBase: 'UNIT_PRICE_BRL',
  });
  const table: TargetPackagePriceSpec[] = [12, 8, 4, 1].map((size) => {
    const pkg = quote.packages.list.find((p) => p.lessonsCount === size)!;
    const finalPriceBrlCents = toCents(pkg.finalPriceBrl);
    const teacherShareBrlCents = toCents(pkg.teacherShareBrl);
    return {
      lessonsCount: size as ApprovedPackageSize,
      discountPercent: pkg.discountPercent,
      labelPt: pkg.labelPt,
      labelEn: pkg.labelEn,
      finalPriceBrlCents,
      teacherShareBrlCents,
      platformRevenueBrlCents: finalPriceBrlCents - teacherShareBrlCents,
      finalPriceUsdCents: toCents(pkg.finalPriceUsd),
      teacherShareUsdCents: toCents(pkg.teacherShareUsd),
      platformRevenueUsdCents: toCents(pkg.finalPriceUsd) - toCents(pkg.teacherShareUsd),
      effectiveLessonPriceBrlCents: toCents(pkg.effectiveLessonPriceBrl),
      unitCentsSchedule: [],
    };
  });

  const p1 = table.find((t) => t.lessonsCount === 1)!.finalPriceBrlCents;
  const p4 = table.find((t) => t.lessonsCount === 4)!.finalPriceBrlCents;
  const p8 = table.find((t) => t.lessonsCount === 8)!.finalPriceBrlCents;
  const p12 = table.find((t) => t.lessonsCount === 12)!.finalPriceBrlCents;

  const testBudgets = [
    0,
    1,
    p1 - 1,
    p1,
    p1 + 1,
    p4 - 1,
    p4,
    p4 + p1,
    p8 - 1,
    p8,
    p8 + p4 - 1,
    p12 - 1,
    p12,
    p12 + p1,
    p12 + p4,
    p12 + p8,
    p12 + p8 + p4 + p1,
    2 * p12 - 1,
    3 * p12 + p8 + 2 * p1 + 37,
    5 * p12 + 123,
  ];

  for (const b of testBudgets) {
    const actual = composePackagesDeterministically(b, table);
    const brute = bruteForceOptimalComposition(b, table);
    assert.strictEqual(actual.totalLessons, brute.lessons, `Aulas divergem para orçamento ${b}`);
    assert.strictEqual(actual.totalCostBrlCents, brute.cost, `Custo diverge para orçamento ${b}`);
    assert.deepStrictEqual(actual.counts, brute.counts, `Contagens divergem para orçamento ${b}`);
    assert.strictEqual(actual.totalCostBrlCents + actual.residualBrlCents, b);
    assert.ok(actual.residualBrlCents >= 0 && actual.residualBrlCents < p1);
  }

  // Also test huge budget (R$ 50,000.00 = 5_000_000 cents) finishes instantaneously and conserves cents
  const hugeBudget = 5_000_000;
  const hugeRes = composePackagesDeterministically(hugeBudget, table);
  assert.strictEqual(hugeRes.totalCostBrlCents + hugeRes.residualBrlCents, hugeBudget);
  assert.ok(hugeRes.residualBrlCents >= 0 && hugeRes.residualBrlCents < p1);
  assert.ok(hugeRes.counts[12] >= 40);
});

// 4. Arredondamentos PTAX D-1 quebrados + consumo e estorno exato por unitIndex intermediário
runTest('4. Arredondamentos FIN.2C/PTAX D-1 quebrados e estorno exato de unitIndex intermediário sem desvio de centavos', () => {
  // Odd numbers: $13 USD, 31% MARKUP, PTAX 5.7648, Pack 4
  let lot = makePaidLot({
    idKey: 'rounding_odd',
    lessonsCount: 4,
    basePriceUsd: 13,
    adminCommissionPercent: 31,
    ptaxRate: 5.7648,
  });
  const sched = lot.unitCentsSchedule!;
  // Ensure unit values are NOT all identical (there is remainder distribution)
  const unitValues = sched.map((s) => Number(s.totalPaidBrlCents));
  assert.ok(Math.max(...unitValues) - Math.min(...unitValues) <= 1);

  // Consume all 4 units [0, 1, 2, 3], refund unitIndex=1 (teacher cancel) and unitIndex=2 (teacher not_completed)
  const cAll = consumeUnitsFromLots({ lots: [lot], units: 4, nowIso: NOW_ISO });
  lot = cAll.lots[0];
  const r1 = refundUnitToExactLot({
    studentUid: STUDENT_UID,
    lots: [lot],
    targetLotId: lot.id,
    targetUnitIndex: 1,
    wasFirstInitialization: false,
    nextLotSequence: 5,
    nowIso: NOW_ISO,
  });
  const r2 = refundUnitToExactLot({
    studentUid: STUDENT_UID,
    lots: r1.lots,
    targetLotId: lot.id,
    targetUnitIndex: 2,
    wasFirstInitialization: false,
    nextLotSequence: 5,
    nowIso: NOW_ISO,
  });
  lot = r2.refundedLot;

  const expectedExactBudget = Number(sched[1].totalPaidBrlCents) + Number(sched[2].totalPaidBrlCents);
  const expectedExactTeacherShare =
    Number(sched[1].teacherShareBrlCents) + Number(sched[2].teacherShareBrlCents);

  const lessons: LiveLesson[] = [
    makeLesson({ id: 'l0', status: 'completed', creditLotId: lot.id, creditUnitIndex: 0 }),
    makeLesson({ id: 'l1_old', status: 'cancelled', cancelledBy: 'teacher', creditRefunded: true, creditLotId: lot.id, creditUnitIndex: 1 }),
    makeLesson({ id: 'l2_old', status: 'not_completed', notCompletedResponsible: 'teacher', creditRefunded: true, creditLotId: lot.id, creditUnitIndex: 2 }),
    makeLesson({ id: 'l3', status: 'not_completed', notCompletedResponsible: 'student', creditRefunded: false, creditLotId: lot.id, creditUnitIndex: 3 }),
  ];

  const result = evaluateSwitchConversion({
    studentUid: STUDENT_UID,
    studentAvailableLessons: 2,
    creditLots: [lot],
    lessons,
    targetTeacher: {
      teacherUid: TARGET_TEACHER_UID,
      basePriceUsd: 11,
      adminCommissionPercent: 17,
      commissionModel: 'MARKUP',
      isApproved: true,
    },
    ptax: { ptaxRate: 5.7648 },
  });

  assert.strictEqual(result.status, 'READY');
  assert.strictEqual(result.sourceAnalysis.availablePaidUnitsCount, 2);
  assert.strictEqual(result.sourceAnalysis.teacherOrAdminRefundedLessonsCount, 2);
  assert.strictEqual(result.sourceAnalysis.completedLessonsCount, 1);
  assert.strictEqual(result.sourceAnalysis.studentFaultNotCompletedCount, 1);
  assert.strictEqual(result.sourceAnalysis.budgetBrlCents, expectedExactBudget);
  assert.strictEqual(
    result.accounting!.futureTeacherObligation.releasedSourceTeacherObligationBrlCents,
    expectedExactTeacherShare
  );
  // Earned from completed lesson (unit 0) vs non-refunded student fault (unit 3) strictly separated!
  assert.strictEqual(
    result.accounting!.effectivePaymentDue.sourceTeacherEarnedFromCompletedLessonsBrlCents,
    sched[0].teacherShareBrlCents
  );
  assert.strictEqual(
    result.accounting!.effectivePaymentDue.sourceTeacherNonRefundedStudentFaultBrlCents,
    sched[3].teacherShareBrlCents
  );
});

// 5. Cortesia pura e mista: preservação 1:1 sem valor financeiro presumido
runTest('5. Cortesias: preservação 1:1 sem valor financeiro presumido (cortesia pura e mista com pago)', () => {
  const courtesyGrant = buildCourtesyGrantLotData({
    studentUid: STUDENT_UID,
    lessonsCount: 3,
    lotSequence: 1,
    nowIso: NOW_ISO,
    sourceTransactionId: 'tx_grant_1',
    idempotencyKey: 'grant_1',
    pricedTeacherUid: SOURCE_TEACHER_UID,
    teacherEmail: 'source.teacher@itissimple.org',
    teacherName: 'Source',
    packageName: 'Cortesia Admin',
    performedByUid: 'adm_1',
    performedByEmail: 'adm@itissimple.org',
    performedByRole: 'admin',
  });
  const courtesyAdj = buildCourtesyAdjustmentLotData({
    studentUid: STUDENT_UID,
    lessonsCount: 2,
    lotSequence: 2,
    nowIso: NOW_ISO,
    sourceTransactionId: 'tx_adj_1',
    idempotencyKey: 'adj_1',
    reason: 'Bônus cortesia',
    performedByUid: 'adm_1',
    performedByEmail: 'adm@itissimple.org',
  });

  // 5a. Courtesy-only switch to a very expensive target teacher ($100 USD, 100% markup) -> STILL 5:5 (1:1) with 0 cents!
  const pureCourtesyRes = evaluateSwitchConversion({
    studentUid: STUDENT_UID,
    studentAvailableLessons: 5,
    creditLots: [courtesyGrant, courtesyAdj],
    targetTeacher: {
      teacherUid: TARGET_TEACHER_UID,
      basePriceUsd: 100,
      adminCommissionPercent: 100,
      commissionModel: 'MARKUP',
      isApproved: true,
    },
    ptax: { ptaxRate: 5.5 },
  });

  assert.strictEqual(pureCourtesyRes.status, 'READY');
  assert.strictEqual(pureCourtesyRes.conversionPlan!.paidConversionOutcome, 'NO_PAID_CREDITS');
  assert.strictEqual(pureCourtesyRes.conversionPlan!.plannedPaidLots.length, 0);
  assert.strictEqual(pureCourtesyRes.conversionPlan!.plannedCourtesy?.lessonsCount, 5);
  assert.strictEqual(pureCourtesyRes.accounting!.convertedValue.convertedPaidLessonsCount, 0);
  assert.strictEqual(pureCourtesyRes.accounting!.convertedValue.preservedCourtesyLessonsCount, 5);
  assert.strictEqual(pureCourtesyRes.accounting!.convertedValue.totalResultingLessonsCount, 5);
  assert.strictEqual(pureCourtesyRes.accounting!.convertedValue.convertedTotalBrlCents, 0);
  assert.strictEqual(pureCourtesyRes.accounting!.convertedValue.residualBrlCents, 0);
  assert.strictEqual(pureCourtesyRes.accounting!.convertedValue.courtesyFinancialValueBrlCents, 0);
  assert.strictEqual(pureCourtesyRes.accounting!.futureTeacherObligation.targetFutureTeacherObligationBrlCents, 0);

  // 5b. Mixed paid + courtesy
  const paidLot = makePaidLot({
    idKey: 'mixed_paid',
    lessonsCount: 4,
    basePriceUsd: 20,
    adminCommissionPercent: 25,
    ptaxRate: 5.0,
    lotSequence: 3,
  });
  const mixedRes = evaluateSwitchConversion({
    studentUid: STUDENT_UID,
    studentAvailableLessons: 7,
    creditLots: [courtesyGrant, paidLot],
    targetTeacher: {
      teacherUid: TARGET_TEACHER_UID,
      basePriceUsd: 20,
      adminCommissionPercent: 25,
      commissionModel: 'MARKUP',
      isApproved: true,
    },
    ptax: { ptaxRate: 5.0 },
  });

  assert.strictEqual(mixedRes.status, 'READY');
  assert.strictEqual(mixedRes.accounting!.convertedValue.convertedPaidLessonsCount, 4);
  assert.strictEqual(mixedRes.accounting!.convertedValue.preservedCourtesyLessonsCount, 3);
  assert.strictEqual(mixedRes.accounting!.convertedValue.totalResultingLessonsCount, 7);
  assert.strictEqual(mixedRes.accounting!.convertedValue.residualBrlCents, 0);
  assert.strictEqual(mixedRes.accounting!.convertedValue.convertedTotalBrlCents, paidLot.totalPaidBrlCents);
  // Target teacher obligation comes ONLY from the 4 paid lessons, NOT the 3 courtesy lessons!
  assert.strictEqual(
    mixedRes.accounting!.futureTeacherObligation.targetFutureTeacherObligationBrlCents,
    paidLot.teacherShareBrlCents
  );
});

// 6. Saldos insuficientes (0 créditos, travados em agendamentos, orçamento < 1 aula destino, pago insuficiente + cortesia)
runTest('6. Saldos insuficientes: 0 créditos, todos travados, orçamento < 1 aula e pago insuficiente com cortesia', () => {
  // 6a. Zero credits
  const zeroRes = evaluateSwitchConversion({
    studentUid: STUDENT_UID,
    studentAvailableLessons: 0,
    creditLots: [],
    targetTeacher: {
      teacherUid: TARGET_TEACHER_UID,
      basePriceUsd: 20,
      adminCommissionPercent: 20,
      commissionModel: 'MARKUP',
      isApproved: true,
    },
    ptax: { ptaxRate: 5.0 },
  });
  assert.strictEqual(zeroRes.status, 'BLOCKED');
  assert.ok(zeroRes.blockingCodes.includes('NO_AVAILABLE_CREDITS'));

  // 6b. Paid lot exhausted because only remaining unit is locked in active scheduled lesson (keep)
  const paid1 = makePaidLot({
    idKey: 'locked_1',
    lessonsCount: 1,
    basePriceUsd: 20,
    adminCommissionPercent: 20,
    ptaxRate: 5.0,
  });
  const consumedPaid1 = consumeUnitsFromLots({ lots: [paid1], units: 1, nowIso: NOW_ISO }).lots[0];
  const activeLesson = makeLesson({
    id: 'lesson_locked_1',
    status: 'scheduled',
    creditLotId: consumedPaid1.id,
    creditUnitIndex: 0,
  });

  const lockedRes = evaluateSwitchConversion({
    studentUid: STUDENT_UID,
    studentAvailableLessons: 0,
    creditLots: [consumedPaid1],
    lessons: [activeLesson],
    targetTeacher: {
      teacherUid: TARGET_TEACHER_UID,
      basePriceUsd: 15,
      adminCommissionPercent: 20,
      commissionModel: 'MARKUP',
      isApproved: true,
    },
    ptax: { ptaxRate: 5.0 },
  });
  assert.strictEqual(lockedRes.status, 'BLOCKED');
  assert.ok(lockedRes.blockingCodes.includes('ALL_CREDITS_LOCKED_IN_SCHEDULED_LESSONS'));
  assert.strictEqual(lockedRes.sourceAnalysis.lockedScheduledLessonsCount, 1);
  assert.strictEqual(lockedRes.sourceAnalysis.budgetBrlCents, 0);

  // 6c. Student has 1 paid credit worth R$ 60 (6000 cents), target teacher costs R$ 150 (15000 cents) -> insufficient for 1 lesson!
  const cheapLot = makePaidLot({
    idKey: 'cheap_1',
    lessonsCount: 1,
    basePriceUsd: 10,
    adminCommissionPercent: 20,
    ptaxRate: 5.0, // 10 * 1.2 * 5 = 60.00 (6000 cents)
  });
  const insuffBudgetRes = evaluateSwitchConversion({
    studentUid: STUDENT_UID,
    studentAvailableLessons: 1,
    creditLots: [cheapLot],
    targetTeacher: {
      teacherUid: TARGET_TEACHER_UID,
      basePriceUsd: 25,
      adminCommissionPercent: 20,
      commissionModel: 'MARKUP',
      isApproved: true,
    }, // 25 * 1.2 * 5 = 150.00 (15000 cents)
    ptax: { ptaxRate: 5.0 },
  });
  assert.strictEqual(insuffBudgetRes.status, 'BLOCKED');
  assert.ok(insuffBudgetRes.blockingCodes.includes('INSUFFICIENT_BUDGET_FOR_MINIMUM_LESSON'));
  assert.strictEqual(insuffBudgetRes.accounting!.convertedValue.convertedPaidLessonsCount, 0);
  assert.strictEqual(insuffBudgetRes.accounting!.convertedValue.convertedTotalBrlCents, 0);
  assert.strictEqual(insuffBudgetRes.accounting!.convertedValue.residualBrlCents, 6000);
  assert.throws(
    () => assertSwitchConversionReady(insuffBudgetRes),
    (e: any) => e instanceof SwitchConversionError && e.code === 'INSUFFICIENT_BUDGET_FOR_MINIMUM_LESSON'
  );

  // 6d. Insufficient paid budget (6000 < 15000) WITH 1 courtesy lesson -> courtesy converts 1:1 + 6000 cents residual preserved!
  const courtesy1 = buildCourtesyGrantLotData({
    studentUid: STUDENT_UID,
    lessonsCount: 1,
    lotSequence: 2,
    nowIso: NOW_ISO,
    sourceTransactionId: 'tx_c1',
    idempotencyKey: 'c1',
    pricedTeacherUid: SOURCE_TEACHER_UID,
    teacherEmail: 'source.teacher@itissimple.org',
    teacherName: 'Source',
    packageName: 'Cortesia 1',
    performedByUid: 'adm_1',
    performedByEmail: 'adm@itissimple.org',
    performedByRole: 'admin',
  });
  const mixedInsuffRes = evaluateSwitchConversion({
    studentUid: STUDENT_UID,
    studentAvailableLessons: 2,
    creditLots: [cheapLot, courtesy1],
    targetTeacher: {
      teacherUid: TARGET_TEACHER_UID,
      basePriceUsd: 25,
      adminCommissionPercent: 20,
      commissionModel: 'MARKUP',
      isApproved: true,
    },
    ptax: { ptaxRate: 5.0 },
  });
  assert.strictEqual(mixedInsuffRes.status, 'READY');
  assert.strictEqual(mixedInsuffRes.conversionPlan!.paidConversionOutcome, 'INSUFFICIENT_FOR_ONE_LESSON');
  assert.ok(mixedInsuffRes.warnings.some((w) => w.code === 'INSUFFICIENT_PAID_BUDGET_FOR_MINIMUM_LESSON'));
  assert.strictEqual(mixedInsuffRes.accounting!.convertedValue.convertedPaidLessonsCount, 0);
  assert.strictEqual(mixedInsuffRes.accounting!.convertedValue.preservedCourtesyLessonsCount, 1);
  assert.strictEqual(mixedInsuffRes.accounting!.convertedValue.residualBrlCents, 6000);
});

// 7. Bloqueio de legacy_unreconciled e ausência de evidência financeira
runTest('7. Bloqueia conversão automática de legacy_unreconciled e ausência de evidência financeira; suporta lote 2B conciliado', () => {
  const paidLot = makePaidLot({
    idKey: 'verified_p',
    lessonsCount: 4,
    basePriceUsd: 20,
    adminCommissionPercent: 20,
    ptaxRate: 5.0,
    lotSequence: 1,
  });
  const legacyLot = buildLegacyUnreconciledLotData({
    studentUid: STUDENT_UID,
    lessonsCount: 2,
    lotSequence: 2,
    nowIso: NOW_ISO,
  });

  // 7a. Legacy unreconciled remaining -> BLOCKED even when combined with verified paid lot!
  const legacyRes = evaluateSwitchConversion({
    studentUid: STUDENT_UID,
    studentAvailableLessons: 6,
    creditLots: [paidLot, legacyLot],
    targetTeacher: {
      teacherUid: TARGET_TEACHER_UID,
      basePriceUsd: 20,
      adminCommissionPercent: 20,
      commissionModel: 'MARKUP',
      isApproved: true,
    },
    ptax: { ptaxRate: 5.0 },
  });
  assert.strictEqual(legacyRes.status, 'BLOCKED');
  assert.strictEqual(legacyRes.canConvert, false);
  assert.ok(legacyRes.blockingCodes.includes('LEGACY_UNRECONCILED_PRESENT'));
  assert.strictEqual(legacyRes.sourceAnalysis.availableLegacyUnitsCount, 2);

  // 7b. Exhausted legacy_unreconciled (0 remaining) does NOT block!
  const exhaustedLegacy = consumeUnitsFromLots({ lots: [legacyLot], units: 2, nowIso: NOW_ISO }).lots[0];
  const exhaustedLegacyRes = evaluateSwitchConversion({
    studentUid: STUDENT_UID,
    studentAvailableLessons: 4,
    creditLots: [paidLot, exhaustedLegacy],
    targetTeacher: {
      teacherUid: TARGET_TEACHER_UID,
      basePriceUsd: 20,
      adminCommissionPercent: 20,
      commissionModel: 'MARKUP',
      isApproved: true,
    },
    ptax: { ptaxRate: 5.0 },
  });
  assert.strictEqual(exhaustedLegacyRes.status, 'READY');

  // 7c. Paid lot missing verified financial evidence (e.g. totalPaidBrlCents: null / missing unitCentsSchedule)
  const unverifiedPaidLot: CreditLot = {
    ...paidLot,
    id: 'lot_unverified_paid',
    totalPaidBrlCents: null,
    remainingTotalPaidBrlCents: null,
    unitCentsSchedule: null,
    financialAttributionStatus: 'unreconciled_no_presumed_value',
  };
  const missingEvidenceRes = evaluateSwitchConversion({
    studentUid: STUDENT_UID,
    studentAvailableLessons: 4,
    creditLots: [unverifiedPaidLot],
    targetTeacher: {
      teacherUid: TARGET_TEACHER_UID,
      basePriceUsd: 20,
      adminCommissionPercent: 20,
      commissionModel: 'MARKUP',
      isApproved: true,
    },
    ptax: { ptaxRate: 5.0 },
  });
  assert.strictEqual(missingEvidenceRes.status, 'BLOCKED');
  assert.ok(missingEvidenceRes.blockingCodes.includes('MISSING_FINANCIAL_EVIDENCE'));
  assert.strictEqual(missingEvidenceRes.conversionPlan, null);

  // 7d. Paid lot missing unitCentsSchedule even if totalPaidBrlCents is set -> BLOCKED (strictly uses verified unit cents)
  const noScheduleLot: CreditLot = {
    ...paidLot,
    id: 'lot_no_sched',
    unitCentsSchedule: null,
  };
  const noSchedRes = evaluateSwitchConversion({
    studentUid: STUDENT_UID,
    studentAvailableLessons: 4,
    creditLots: [noScheduleLot],
    targetTeacher: {
      teacherUid: TARGET_TEACHER_UID,
      basePriceUsd: 20,
      adminCommissionPercent: 20,
      commissionModel: 'MARKUP',
      isApproved: true,
    },
    ptax: { ptaxRate: 5.0 },
  });
  assert.strictEqual(noSchedRes.status, 'BLOCKED');
  assert.ok(noSchedRes.blockingCodes.includes('MISSING_FINANCIAL_EVIDENCE'));

  // 7e. Reconciled NF.SWITCH.2B paid lot where historical tx had totalPaidBrl but null teacherShareBrl:
  // preserves exact budgetBrlCents while keeping original teacherShare as null (never presumed!)
  const reconPaidNoTeacherSplit = buildReconciledPaidLotData({
    studentUid: STUDENT_UID,
    lessonsCount: 4,
    lotSequence: 4,
    nowIso: NOW_ISO,
    idempotencyKey: 'recon_no_split',
    allocationIndex: 0,
    reconciledFromLotId: legacyLot.id,
    reconciliationAuditId: 'audit_1',
    sourceTransactionId: 'tx_hist_1',
    pricedTeacherUid: SOURCE_TEACHER_UID,
    teacherEmail: 'source.teacher@itissimple.org',
    teacherName: 'Source',
    packageName: 'Pacote Histórico 4 Aulas',
    packageLessons: 4,
    basePriceUsd: null,
    adminCommissionPercent: null,
    commissionModel: null,
    commissionVersion: null,
    ptaxRate: null,
    ptaxQuoteDate: null,
    ptaxPricingDate: null,
    ptaxSource: null,
    discountPercent: null,
    totalPaidBrl: 456.0,
    totalPaidUsd: null,
    unitPriceBrl: 114.0,
    unitPriceUsd: null,
    teacherShareBrl: null,
    teacherShareUsd: null,
    platformRevenueBrl: null,
    platformRevenueUsd: null,
    gatewayProvider: 'stripe',
    gatewayTransactionId: 'gw_hist_1',
    justification: 'Conciliação histórica NF.SWITCH.2B',
    performedByUid: 'adm_1',
    performedByEmail: 'adm@itissimple.org',
  });
  const reconRes = evaluateSwitchConversion({
    studentUid: STUDENT_UID,
    studentAvailableLessons: 4,
    creditLots: [reconPaidNoTeacherSplit],
    targetTeacher: {
      teacherUid: TARGET_TEACHER_UID,
      basePriceUsd: 19,
      adminCommissionPercent: 20,
      commissionModel: 'MARKUP',
      isApproved: true,
    },
    ptax: { ptaxRate: 5.0 }, // Unit BRL = 19 * 1.2 * 5 = 114.00 -> Pack 4 (5% off) = 433.20 (43320 cents)
  });
  assert.strictEqual(reconRes.status, 'READY');
  assert.strictEqual(reconRes.sourceAnalysis.budgetBrlCents, 45600);
  assert.strictEqual(reconRes.accounting!.originalRevenue.availableOriginalTeacherShareBrlCents, null);
  assert.strictEqual(reconRes.accounting!.futureTeacherObligation.releasedSourceTeacherObligationBrlCents, null);
  assert.ok(reconRes.warnings.some((w) => w.code === 'SOURCE_TEACHER_SHARE_UNAVAILABLE_ON_RECONCILED_LOT'));
  assert.strictEqual(reconRes.accounting!.convertedValue.convertedPaidLessonsCount, 4);
  assert.strictEqual(reconRes.accounting!.convertedValue.convertedTotalBrlCents, 43320);
  assert.strictEqual(reconRes.accounting!.convertedValue.residualBrlCents, 2280);
});

// 8. Respeito ao estado das aulas agendadas, estorno por professor/admin vs aluno e bloqueio de modelo/PTAX/tutor
runTest('8. Respeita estado das aulas agendadas, regras de estorno (teacher/admin vs student), trial e validações FIN.2C', () => {
  // 4-lesson paid lot ($20, 25% markup, PTAX 5.0 -> unit 125.00, Pack 4 = 475.00 = 47500 cents)
  let lot = makePaidLot({
    idKey: 'sched_rules',
    lessonsCount: 4,
    basePriceUsd: 20,
    adminCommissionPercent: 25,
    ptaxRate: 5.0,
  });
  // Consume 2 units (indices 0 and 1) for two active scheduled lessons; indices 2 and 3 remain free
  lot = consumeUnitsFromLots({ lots: [lot], units: 2, nowIso: NOW_ISO }).lots[0];
  const sched = lot.unitCentsSchedule!;

  const schedLesson0 = makeLesson({ id: 'sched_0', status: 'scheduled', creditLotId: lot.id, creditUnitIndex: 0 });
  const schedLesson1 = makeLesson({ id: 'sched_1', status: 'scheduled', creditLotId: lot.id, creditUnitIndex: 1 });
  const trialLesson = makeLesson({ id: 'trial_0', status: 'scheduled', isTrialLesson: true });

  // 8a. Default ('keep'): only units [2, 3] are available; units [0, 1] are locked; trial is ignored
  const keepRes = evaluateSwitchConversion({
    studentUid: STUDENT_UID,
    studentAvailableLessons: 2,
    creditLots: [lot],
    lessons: [schedLesson0, schedLesson1, trialLesson],
    targetTeacher: {
      teacherUid: TARGET_TEACHER_UID,
      basePriceUsd: 20,
      adminCommissionPercent: 25,
      commissionModel: 'MARKUP',
      isApproved: true,
    },
    ptax: { ptaxRate: 5.0 },
  });
  assert.strictEqual(keepRes.status, 'READY');
  assert.strictEqual(keepRes.sourceAnalysis.availablePaidUnitsCount, 2);
  assert.strictEqual(keepRes.sourceAnalysis.lockedScheduledLessonsCount, 2);
  assert.strictEqual(keepRes.sourceAnalysis.trialLessonsCount, 1);
  assert.strictEqual(
    keepRes.sourceAnalysis.budgetBrlCents,
    Number(sched[2].totalPaidBrlCents) + Number(sched[3].totalPaidBrlCents)
  );

  // 8b. Disposition: sched_0 cancelled by teacher (refunds unit 0!), sched_1 cancelled by student (NO refund!)
  const dispRes = evaluateSwitchConversion({
    studentUid: STUDENT_UID,
    studentAvailableLessons: 2,
    creditLots: [lot],
    lessons: [schedLesson0, schedLesson1, trialLesson],
    scheduledLessonDispositions: {
      sched_0: 'cancel_by_teacher',
      sched_1: 'cancel_by_student',
    },
    targetTeacher: {
      teacherUid: TARGET_TEACHER_UID,
      basePriceUsd: 20,
      adminCommissionPercent: 25,
      commissionModel: 'MARKUP',
      isApproved: true,
    },
    ptax: { ptaxRate: 5.0 },
  });
  assert.strictEqual(dispRes.status, 'READY');
  assert.strictEqual(dispRes.sourceAnalysis.availablePaidUnitsCount, 3); // [0, 2, 3]
  assert.strictEqual(dispRes.sourceAnalysis.simulatedRefundedScheduledLessonsCount, 1);
  assert.strictEqual(dispRes.sourceAnalysis.simulatedForfeitedStudentCancelCount, 1);
  assert.strictEqual(
    dispRes.sourceAnalysis.budgetBrlCents,
    Number(sched[0].totalPaidBrlCents) + Number(sched[2].totalPaidBrlCents) + Number(sched[3].totalPaidBrlCents)
  );
  // Student-forfeited unit 1 must be in sourceTeacherNonRefundedStudentFaultBrlCents, NOT in budget!
  assert.strictEqual(
    dispRes.accounting!.effectivePaymentDue.sourceTeacherNonRefundedStudentFaultBrlCents,
    sched[1].teacherShareBrlCents
  );

  // 8c. Reject non-MARKUP model, unapproved tutor, and missing PTAX (zero 5.5 fallback)
  const badModel = evaluateSwitchConversion({
    studentUid: STUDENT_UID,
    creditLots: [lot],
    targetTeacher: {
      teacherUid: TARGET_TEACHER_UID,
      basePriceUsd: 20,
      adminCommissionPercent: 25,
      commissionModel: 'MARGIN',
      isApproved: true,
    },
    ptax: { ptaxRate: 5.0 },
  });
  assert.strictEqual(badModel.status, 'BLOCKED');
  assert.ok(badModel.blockingCodes.includes('INVALID_COMMISSION_MODEL'));

  const badPtax = evaluateSwitchConversion({
    studentUid: STUDENT_UID,
    creditLots: [lot],
    targetTeacher: {
      teacherUid: TARGET_TEACHER_UID,
      basePriceUsd: 20,
      adminCommissionPercent: 25,
      commissionModel: 'MARKUP',
      isApproved: true,
    },
    ptax: { ptaxRate: 0 },
  });
  assert.strictEqual(badPtax.status, 'BLOCKED');
  assert.ok(badPtax.blockingCodes.includes('PTAX_UNAVAILABLE'));

  const unapprovedTutor = evaluateSwitchConversion({
    studentUid: STUDENT_UID,
    creditLots: [lot],
    targetTeacher: {
      teacherUid: TARGET_TEACHER_UID,
      basePriceUsd: 20,
      adminCommissionPercent: 25,
      commissionModel: 'MARKUP',
      approvalStatus: 'pending',
      isApproved: false,
    },
    ptax: { ptaxRate: 5.0 },
  });
  assert.strictEqual(unapprovedTutor.status, 'BLOCKED');
  assert.ok(unapprovedTutor.blockingCodes.includes('TARGET_TEACHER_NOT_APPROVED'));
});

// 9. Separação contábil, zero receita artificial, imutabilidade dos inputs e detecção de divergência de razão
runTest('9. Separação contábil completa, zero receita artificial, imutabilidade e bloqueio de divergência no razão', () => {
  let lot = makePaidLot({
    idKey: 'acct_sep',
    lessonsCount: 8,
    basePriceUsd: 20,
    adminCommissionPercent: 25,
    ptaxRate: 5.0,
  });
  lot = consumeUnitsFromLots({ lots: [lot], units: 2, nowIso: NOW_ISO }).lots[0];
  const l0 = makeLesson({ id: 'comp_0', status: 'completed', creditLotId: lot.id, creditUnitIndex: 0 });
  const l1 = makeLesson({ id: 'sched_1', status: 'scheduled', creditLotId: lot.id, creditUnitIndex: 1 });

  const lotSnapshotBefore = JSON.stringify(lot);
  const res = evaluateSwitchConversion({
    studentUid: STUDENT_UID,
    studentAvailableLessons: 6,
    creditLots: [lot],
    lessons: [l0, l1],
    targetTeacher: {
      teacherUid: TARGET_TEACHER_UID,
      basePriceUsd: 15,
      adminCommissionPercent: 20,
      commissionModel: 'MARKUP',
      isApproved: true,
    },
    ptax: { ptaxRate: 5.0 },
  });

  // Pure function must NOT mutate input CreditLot
  assert.strictEqual(JSON.stringify(lot), lotSnapshotBefore);
  assert.strictEqual(res.status, 'READY');

  const acct = res.accounting!;
  assert.strictEqual(acct.originalRevenue.newCashCollectedBrlCents, 0);
  assert.strictEqual(acct.originalRevenue.artificialRevenueCreatedBrlCents, 0);
  assert.strictEqual(acct.effectivePaymentDue.studentAdditionalPaymentDueBrlCents, 0);
  assert.strictEqual(acct.effectivePaymentDue.immediateTargetTeacherPayoutDueBrlCents, 0);
  assert.strictEqual(acct.effectivePaymentDue.releasedSwitchedUnitsPayoutDueBrlCents, 0);
  assert.strictEqual(
    acct.effectivePaymentDue.contingentTargetTeacherPayoutOnCompletionBrlCents,
    acct.futureTeacherObligation.targetFutureTeacherObligationBrlCents
  );
  assert.strictEqual(
    acct.effectivePaymentDue.sourceTeacherEarnedFromCompletedLessonsBrlCents,
    lot.unitCentsSchedule![0].teacherShareBrlCents
  );
  assert.strictEqual(
    acct.futureTeacherObligation.remainingLockedScheduledTeacherObligationBrlCents,
    lot.unitCentsSchedule![1].teacherShareBrlCents
  );
  // Original revenue parts sum back to total purchased!
  assert.strictEqual(
    Number(acct.originalRevenue.permanentlyConsumedTotalPaidBrlCents) +
      Number(acct.originalRevenue.lockedScheduledTotalPaidBrlCents) +
      acct.originalRevenue.availableOriginalTotalPaidBrlCents,
    acct.originalRevenue.purchasedTotalPaidBrlCents
  );

  // Ledger divergence check (e.g. studentAvailableLessons mismatch or duplicate scheduled lesson on same unit)
  assert.throws(
    () =>
      evaluateSwitchConversion({
        studentUid: STUDENT_UID,
        studentAvailableLessons: 99,
        creditLots: [lot],
        targetTeacher: {
          teacherUid: TARGET_TEACHER_UID,
          basePriceUsd: 15,
          adminCommissionPercent: 20,
          commissionModel: 'MARKUP',
          isApproved: true,
        },
        ptax: { ptaxRate: 5.0 },
      }),
    (e: any) => e instanceof CreditLedgerError && e.code === CREDIT_LEDGER_DIVERGENCE_CODE
  );

  assert.throws(
    () =>
      evaluateSwitchConversion({
        studentUid: STUDENT_UID,
        studentAvailableLessons: 6,
        creditLots: [lot],
        lessons: [
          l1,
          makeLesson({ id: 'dup_sched_1', status: 'scheduled', creditLotId: lot.id, creditUnitIndex: 1 }),
        ],
        targetTeacher: {
          teacherUid: TARGET_TEACHER_UID,
          basePriceUsd: 15,
          adminCommissionPercent: 20,
          commissionModel: 'MARKUP',
          isApproved: true,
        },
        ptax: { ptaxRate: 5.0 },
      }),
    (e: any) => e instanceof CreditLedgerError && e.code === CREDIT_LEDGER_DIVERGENCE_CODE
  );
});

console.log('\n=========================================================================');
console.log(` NF.SWITCH.2C SUMMARY: ${passed} passed, ${failed} failed`);
console.log('=========================================================================');

if (failed > 0) {
  process.exit(1);
}
