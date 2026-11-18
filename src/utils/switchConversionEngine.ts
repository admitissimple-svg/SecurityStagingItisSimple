/**
 * IT'S SIMPLE — NF.SWITCH.2C: MOTOR PURO DE CONVERSÃO DE CRÉDITOS NA TROCA DE NATIVE FRIEND
 *
 * Implementa o contrato NF.SWITCH.1A de forma 100% pura, determinística e sem efeitos colaterais:
 *  1. Utiliza exclusivamente valores financeiros inteiros em centavos dos lotes `paid` verificados.
 *  2. Considera somente unidades remanescentes e financeiramente disponíveis, respeitando o estado
 *     das aulas agendadas e as regras oficiais de estorno (cancelamento/não-realização pelo
 *     professor ou admin estorna unidade exata; culpa/cancelamento do aluno e aula experimental não estornam).
 *  3. Calcula os preços de destino exclusivamente via motor oficial FIN.2C, PTAX D-1, modelo MARKUP
 *     e pacotes reais aprovados (1, 4, 8 e 12 aulas com descontos 0%, 5%, 10% e 15%).
 *  4. Composição determinística ótima de pacotes: maximiza o número total de aulas sem ultrapassar
 *     o orçamento em centavos; em empate de aulas, minimiza o custo (maximiza o resíduo preservado);
 *     em empate de custo, prioriza pacotes maiores (12 -> 8 -> 4 -> 1).
 *  5. Conserva exatamente o resíduo financeiro em centavos (valor convertido + resíduo === orçamento).
 *  6. Preserva cortesias 1:1 sem valor financeiro presumido (0 centavos).
 *  7. Bloqueia conversão automática quando houver unidades `legacy_unreconciled` remanescentes.
 *  8. Separa explicitamente: receita original, valor convertido, obrigação futura do professor e
 *     pagamento efetivamente devido.
 *  9. Não altera cálculos comerciais existentes nem cria receita artificial.
 */

import type {
  CreditLot,
  CreditLotUnitLedgerEntry,
  LiveLesson,
} from '../types';
import {
  APPROVED_PACKAGES,
  calculateFinancialPricingQuote,
  fromCents,
  toCents,
  type FinancialPricingQuote,
  type LessonPackageCalculation,
} from './financialEngine';
import {
  buildUnitCentsSchedule,
  CREDIT_LEDGER_DIVERGENCE_CODE,
  CREDIT_LOT_ISOLATION_VIOLATION_CODE,
  CreditLedgerError,
  sumLotRemainingLessons,
  validateCreditLotsForStudent,
} from './creditLots';
import { ALLOWED_COMMISSION_MODEL } from './tutorCommission';

export const SWITCH_CONVERSION_ENGINE_VERSION = 'NF.SWITCH.2C.v1';

export type ApprovedPackageSize = 1 | 4 | 8 | 12;

export type SwitchBlockingCode =
  | 'INVALID_STUDENT_UID'
  | 'LEGACY_UNRECONCILED_PRESENT'
  | 'MISSING_FINANCIAL_EVIDENCE'
  | 'NO_AVAILABLE_CREDITS'
  | 'ALL_CREDITS_LOCKED_IN_SCHEDULED_LESSONS'
  | 'INSUFFICIENT_BUDGET_FOR_MINIMUM_LESSON'
  | 'TARGET_TEACHER_INVALID'
  | 'TARGET_TEACHER_NOT_APPROVED'
  | 'TARGET_TEACHER_NOT_COMMERCIALIZABLE'
  | 'TARGET_TEACHER_BASE_PRICE_UNAVAILABLE'
  | 'TARGET_TEACHER_COMMISSION_NOT_CONFIGURED'
  | 'INVALID_COMMISSION_MODEL'
  | 'PTAX_UNAVAILABLE'
  | 'FINANCIAL_INVARIANT_VIOLATION';

export type SwitchWarningCode =
  | 'INSUFFICIENT_PAID_BUDGET_FOR_MINIMUM_LESSON'
  | 'LOCKED_SCHEDULED_LESSONS_EXCLUDED'
  | 'SOURCE_TEACHER_SHARE_UNAVAILABLE_ON_RECONCILED_LOT';

export interface SwitchBlockingReason {
  code: SwitchBlockingCode;
  message: string;
  details?: Record<string, any>;
}

export interface SwitchTargetTeacherInput {
  teacherUid: string;
  teacherEmail?: string | null;
  teacherName?: string | null;
  basePriceUsd: number;
  adminCommissionPercent: number;
  commissionModel?: string | null;
  commissionVersion?: number | null;
  approvalStatus?: string | null;
  isApproved?: boolean;
  isCommercializable?: boolean;
}

export interface SwitchPtaxInput {
  ptaxRate: number;
  quoteDate?: string | null;
  pricingDate?: string | null;
  source?: string | null;
}

export type ScheduledLessonDispositionAction =
  | 'keep'
  | 'cancel_by_teacher'
  | 'cancel_by_admin'
  | 'cancel_by_student';

export interface SwitchConversionEngineInput {
  studentUid: string;
  /** Optional cross-check against users/{studentUid}.availableLessons */
  studentAvailableLessons?: number;
  creditLots: CreditLot[];
  lessons?: LiveLesson[];
  /**
   * Optional disposition for active scheduled lessons during switch preview/planning.
   * Defaults to 'keep' (scheduled lessons remain locked and are NOT available for conversion).
   * Only 'cancel_by_teacher' and 'cancel_by_admin' on non-trial, unrefunded lessons release
   * the exact locked unit back into the available pool; 'cancel_by_student' does NOT refund.
   */
  scheduledLessonDispositions?: Record<string, ScheduledLessonDispositionAction>;
  targetTeacher: SwitchTargetTeacherInput;
  ptax: SwitchPtaxInput;
}

export interface TargetPackagePriceSpec {
  lessonsCount: ApprovedPackageSize;
  discountPercent: number;
  labelPt: string;
  labelEn: string;
  finalPriceBrlCents: number;
  teacherShareBrlCents: number;
  platformRevenueBrlCents: number;
  finalPriceUsdCents: number;
  teacherShareUsdCents: number;
  platformRevenueUsdCents: number;
  effectiveLessonPriceBrlCents: number;
  unitCentsSchedule: CreditLotUnitLedgerEntry[];
}

export interface ComposedPackageLine {
  packageSize: ApprovedPackageSize;
  quantity: number;
  lessonsSubtotal: number;
  discountPercent: number;
  unitPackagePriceBrlCents: number;
  unitPackageTeacherShareBrlCents: number;
  unitPackagePlatformRevenueBrlCents: number;
  totalPriceBrlCents: number;
  totalTeacherShareBrlCents: number;
  totalPlatformRevenueBrlCents: number;
  totalPriceUsdCents: number;
  totalTeacherShareUsdCents: number;
  totalPlatformRevenueUsdCents: number;
}

export interface PlannedTargetPaidLotSpec {
  lotIndex: number;
  packageSize: ApprovedPackageSize;
  discountPercent: number;
  totalPaidBrlCents: number;
  teacherShareBrlCents: number;
  platformRevenueBrlCents: number;
  totalPaidUsdCents: number;
  teacherShareUsdCents: number;
  platformRevenueUsdCents: number;
  unitCentsSchedule: CreditLotUnitLedgerEntry[];
}

export interface PlannedTargetCourtesySpec {
  lessonsCount: number;
  totalPaidBrlCents: 0;
  teacherShareBrlCents: 0;
  platformRevenueBrlCents: 0;
  preservesOneToOne: true;
}

export interface SourceLotBreakdown {
  lotId: string;
  origin: CreditLot['origin'];
  sourceType: CreditLot['sourceType'];
  pricedTeacherUid: string | null;
  initialLessons: number;
  availableUnitsCount: number;
  lockedScheduledUnitsCount: number;
  permanentlyConsumedUnitsCount: number;
  simulatedRefundedUnitsCount: number;
  availableUnitIndices: number[];
  hasVerifiedFinancialEvidence: boolean;
  missingEvidenceReason: string | null;
  availableTotalPaidBrlCents: number | null;
  availableTeacherShareBrlCents: number | null;
  availablePlatformRevenueBrlCents: number | null;
  lockedScheduledTotalPaidBrlCents: number | null;
  permanentlyConsumedTotalPaidBrlCents: number | null;
}

export interface SwitchSourceAnalysis {
  totalInitialLessons: number;
  totalRemainingLessonsInLots: number;
  availablePaidUnitsCount: number;
  availableCourtesyUnitsCount: number;
  availableLegacyUnitsCount: number;
  lockedScheduledLessonsCount: number;
  lockedScheduledPaidUnitsCount: number;
  lockedScheduledCourtesyUnitsCount: number;
  lockedScheduledLegacyUnitsCount: number;
  simulatedRefundedScheduledLessonsCount: number;
  simulatedForfeitedStudentCancelCount: number;
  completedLessonsCount: number;
  studentFaultNotCompletedCount: number;
  studentCancelledCount: number;
  teacherOrAdminRefundedLessonsCount: number;
  trialLessonsCount: number;
  budgetBrlCents: number;
  lotsBreakdown: SourceLotBreakdown[];
}

export interface SwitchAccountingSeparation {
  /**
   * 1. RECEITA ORIGINAL (already collected at original package purchase; NEVER recreated on switch)
   */
  originalRevenue: {
    purchasedTotalPaidBrlCents: number | null;
    purchasedTeacherShareBrlCents: number | null;
    purchasedPlatformRevenueBrlCents: number | null;
    permanentlyConsumedTotalPaidBrlCents: number | null;
    lockedScheduledTotalPaidBrlCents: number | null;
    availableOriginalTotalPaidBrlCents: number;
    availableOriginalTeacherShareBrlCents: number | null;
    availableOriginalPlatformRevenueBrlCents: number | null;
    /** Artificial revenue created by switching: strictly 0 */
    newCashCollectedBrlCents: 0;
    artificialRevenueCreatedBrlCents: 0;
  };
  /**
   * 2. VALOR CONVERTIDO (budget reallocated into destination FIN.2C packages + exact cents residual)
   */
  convertedValue: {
    budgetBrlCents: number;
    convertedPaidLessonsCount: number;
    preservedCourtesyLessonsCount: number;
    totalResultingLessonsCount: number;
    convertedTotalBrlCents: number;
    convertedTotalBrl: number;
    convertedPlatformShareBrlCents: number;
    convertedPlatformShareBrl: number;
    residualBrlCents: number;
    residualBrl: number;
    courtesyFinancialValueBrlCents: 0;
    /** Conservation check: convertedTotalBrlCents + residualBrlCents === budgetBrlCents */
    centsConservedExactly: boolean;
  };
  /**
   * 3. OBRIGAÇÃO FUTURA DO PROFESSOR (contingent payout owed to destination teacher ONLY when converted lessons are completed)
   */
  futureTeacherObligation: {
    targetTeacherUid: string;
    targetFutureTeacherObligationBrlCents: number;
    targetFutureTeacherObligationBrl: number;
    targetFutureTeacherObligationUsdCents: number;
    courtesyTeacherObligationBrlCents: 0;
    residualTeacherObligationBrlCents: 0;
    /** Contingent obligation released from source teacher(s) on switched units (null if historical tx lacked split) */
    releasedSourceTeacherObligationBrlCents: number | null;
    /** Obligation still contingent on locked active scheduled lessons not cancelled */
    remainingLockedScheduledTeacherObligationBrlCents: number | null;
  };
  /**
   * 4. PAGAMENTO EFETIVAMENTE DEVIDO (immediate cash due at switch vs earned historical completed lessons)
   */
  effectivePaymentDue: {
    /** Student pays 0 extra BRL cents on switch */
    studentAdditionalPaymentDueBrlCents: 0;
    /** Immediate payout due to target teacher at switch moment is strictly 0 (lessons not yet taught) */
    immediateTargetTeacherPayoutDueBrlCents: 0;
    /** Target teacher payout becomes due ONLY upon future completion of converted paid lessons */
    contingentTargetTeacherPayoutOnCompletionBrlCents: number;
    /** Source teacher share already earned from lessons with status === 'completed' (null if historical tx lacked split) */
    sourceTeacherEarnedFromCompletedLessonsBrlCents: number | null;
    /** Source teacher share tied to non-refundable student-fault cancellations/no-shows (kept separate for audit) */
    sourceTeacherNonRefundedStudentFaultBrlCents: number | null;
    /** Zero payout due on switched/released units or courtesy units */
    releasedSwitchedUnitsPayoutDueBrlCents: 0;
  };
}

export interface SwitchConversionPlan {
  targetTeacherUid: string;
  ptaxRate: number;
  ptaxQuoteDate: string | null;
  ptaxPricingDate: string | null;
  ptaxSource: string | null;
  commissionModel: 'MARKUP';
  targetUnitFinalPriceBrlCents: number;
  targetPackagesTable: TargetPackagePriceSpec[];
  packageComposition: ComposedPackageLine[];
  plannedPaidLots: PlannedTargetPaidLotSpec[];
  plannedCourtesy: PlannedTargetCourtesySpec | null;
  paidConversionOutcome: 'CONVERTED' | 'NO_PAID_CREDITS' | 'INSUFFICIENT_FOR_ONE_LESSON';
}

export interface SwitchConversionResult {
  engineVersion: string;
  studentUid: string;
  status: 'READY' | 'BLOCKED';
  canConvert: boolean;
  blockingReasons: SwitchBlockingReason[];
  blockingCodes: SwitchBlockingCode[];
  warnings: Array<{ code: SwitchWarningCode; message: string }>;
  sourceAnalysis: SwitchSourceAnalysis;
  targetQuote: FinancialPricingQuote | null;
  conversionPlan: SwitchConversionPlan | null;
  accounting: SwitchAccountingSeparation | null;
}

export class SwitchConversionError extends Error {
  public statusCode: number;
  public code: SwitchBlockingCode | string;
  public details?: Record<string, any>;

  constructor(
    message: string,
    statusCode: number = 422,
    code: SwitchBlockingCode | string = 'SWITCH_CONVERSION_BLOCKED',
    details?: Record<string, any>
  ) {
    super(message);
    this.name = 'SwitchConversionError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

function makeSequentialIndices(count: number, start: number = 0): number[] {
  if (!Number.isInteger(count) || count <= 0) return [];
  const out = new Array<number>(count);
  for (let i = 0; i < count; i++) out[i] = start + i;
  return out;
}

function getNormalizedUnitIndices(lot: CreditLot): {
  availableUnitIndices: number[];
  consumedUnitIndices: number[];
} {
  if (
    Array.isArray(lot.availableUnitIndices) &&
    Array.isArray(lot.consumedUnitIndices) &&
    lot.availableUnitIndices.length === lot.remainingLessons &&
    lot.consumedUnitIndices.length === lot.consumedLessons
  ) {
    return {
      availableUnitIndices: [...lot.availableUnitIndices].sort((a, b) => a - b),
      consumedUnitIndices: [...lot.consumedUnitIndices].sort((a, b) => a - b),
    };
  }
  return {
    consumedUnitIndices: makeSequentialIndices(lot.consumedLessons, 0),
    availableUnitIndices: makeSequentialIndices(lot.remainingLessons, lot.consumedLessons),
  };
}

function isLessonCancelled(lesson: LiveLesson): boolean {
  const s = String(lesson.status || '').toLowerCase().trim();
  return s === 'cancelled' || s === 'canceled' || Boolean(lesson.cancelledAt);
}

function isLessonCompleted(lesson: LiveLesson): boolean {
  return String(lesson.status || '').toLowerCase().trim() === 'completed';
}

function isLessonNotCompleted(lesson: LiveLesson): boolean {
  return String(lesson.status || '').toLowerCase().trim() === 'not_completed';
}

function isLessonActiveScheduled(lesson: LiveLesson): boolean {
  if (isLessonCancelled(lesson) || isLessonCompleted(lesson) || isLessonNotCompleted(lesson)) {
    return false;
  }
  const s = String(lesson.status || 'scheduled').toLowerCase().trim();
  return s === '' || s === 'scheduled' || s === 'confirmed';
}

function isRefundEligibleActor(actor: unknown): boolean {
  const clean = String(actor || '').toLowerCase().trim();
  return clean === 'teacher' || clean === 'admin';
}

function buildTargetPackageSpec(pkg: LessonPackageCalculation): TargetPackagePriceSpec {
  const lessonsCount = pkg.lessonsCount as ApprovedPackageSize;
  const finalPriceBrlCents = toCents(pkg.finalPriceBrl);
  const teacherShareBrlCents = toCents(pkg.teacherShareBrl);
  const platformRevenueBrlCents = finalPriceBrlCents - teacherShareBrlCents;

  const finalPriceUsdCents = toCents(pkg.finalPriceUsd);
  const teacherShareUsdCents = toCents(pkg.teacherShareUsd);
  const platformRevenueUsdCents = finalPriceUsdCents - teacherShareUsdCents;

  if (
    !pkg.invariants.brlSumMatchesTotal ||
    !pkg.invariants.usdSumMatchesTotal ||
    teacherShareBrlCents + platformRevenueBrlCents !== finalPriceBrlCents ||
    teacherShareUsdCents + platformRevenueUsdCents !== finalPriceUsdCents ||
    finalPriceBrlCents <= 0
  ) {
    throw new SwitchConversionError(
      `Violação de invariante financeira FIN.2C no pacote de ${lessonsCount} aulas.`,
      500,
      'FINANCIAL_INVARIANT_VIOLATION',
      { lessonsCount, finalPriceBrlCents, teacherShareBrlCents, platformRevenueBrlCents }
    );
  }

  const unitCentsSchedule = buildUnitCentsSchedule({
    lessonsCount,
    totalPaidBrlCents: finalPriceBrlCents,
    totalPaidUsdCents: finalPriceUsdCents,
    teacherShareBrlCents,
    teacherShareUsdCents,
    platformRevenueBrlCents,
    platformRevenueUsdCents,
  });

  return {
    lessonsCount,
    discountPercent: pkg.discountPercent,
    labelPt: pkg.labelPt,
    labelEn: pkg.labelEn,
    finalPriceBrlCents,
    teacherShareBrlCents,
    platformRevenueBrlCents,
    finalPriceUsdCents,
    teacherShareUsdCents,
    platformRevenueUsdCents,
    effectiveLessonPriceBrlCents: toCents(pkg.effectiveLessonPriceBrl),
    unitCentsSchedule,
  };
}

export interface DeterministicPackageCompositionResult {
  counts: Record<ApprovedPackageSize, number>;
  lines: ComposedPackageLine[];
  totalLessons: number;
  totalCostBrlCents: number;
  totalTeacherShareBrlCents: number;
  totalPlatformRevenueBrlCents: number;
  totalCostUsdCents: number;
  totalTeacherShareUsdCents: number;
  totalPlatformRevenueUsdCents: number;
  residualBrlCents: number;
}

/**
 * Pure deterministic optimizer over approved packages (12, 8, 4, 1):
 * 1. Never exceeds `budgetBrlCents` (integer cents).
 * 2. Maximizes total lessons.
 * 3. Tie-breaks equal lessons by minimizing total cost (maximizing preserved residual cents).
 * 4. Tie-breaks equal lessons & equal cost by preferring larger packs (12 -> 8 -> 4 -> 1).
 */
export function composePackagesDeterministically(
  budgetBrlCents: number,
  targetPackages: readonly TargetPackagePriceSpec[]
): DeterministicPackageCompositionResult {
  if (!Number.isInteger(budgetBrlCents) || budgetBrlCents < 0) {
    throw new SwitchConversionError(
      'Orçamento em centavos para composição de pacotes deve ser inteiro não negativo.',
      400,
      'FINANCIAL_INVARIANT_VIOLATION',
      { budgetBrlCents }
    );
  }

  const p1 = targetPackages.find((p) => p.lessonsCount === 1);
  const p4 = targetPackages.find((p) => p.lessonsCount === 4);
  const p8 = targetPackages.find((p) => p.lessonsCount === 8);
  const p12 = targetPackages.find((p) => p.lessonsCount === 12);

  if (!p1 || !p4 || !p8 || !p12) {
    throw new SwitchConversionError(
      'Conjunto oficial de pacotes 1/4/8/12 incompleto para composição.',
      500,
      'FINANCIAL_INVARIANT_VIOLATION'
    );
  }

  for (const spec of [p1, p4, p8, p12]) {
    if (!Number.isInteger(spec.finalPriceBrlCents) || spec.finalPriceBrlCents <= 0) {
      throw new SwitchConversionError(
        `Preço em centavos inválido para pacote de ${spec.lessonsCount} aulas.`,
        500,
        'FINANCIAL_INVARIANT_VIOLATION',
        { lessonsCount: spec.lessonsCount, finalPriceBrlCents: spec.finalPriceBrlCents }
      );
    }
  }

  if (budgetBrlCents < p1.finalPriceBrlCents) {
    return {
      counts: { 12: 0, 8: 0, 4: 0, 1: 0 },
      lines: [],
      totalLessons: 0,
      totalCostBrlCents: 0,
      totalTeacherShareBrlCents: 0,
      totalPlatformRevenueBrlCents: 0,
      totalCostUsdCents: 0,
      totalTeacherShareUsdCents: 0,
      totalPlatformRevenueUsdCents: 0,
      residualBrlCents: budgetBrlCents,
    };
  }

  const price1 = p1.finalPriceBrlCents;
  const price4 = p4.finalPriceBrlCents;
  const price8 = p8.finalPriceBrlCents;
  const price12 = p12.finalPriceBrlCents;

  // Bounded exact search:
  // Since 1*P12 <= 3*P4, 2*P12 <= 3*P8, 1*P12 <= 12*P1 and 1*P4 <= 4*P1,
  // an optimal solution never uses fewer than max(0, floor(budget / P12) - 3) packs of 12.
  const base12 = Math.max(0, Math.floor(budgetBrlCents / price12) - 3);
  const remBudget = budgetBrlCents - base12 * price12;

  let best = {
    c12: base12,
    c8: 0,
    c4: 0,
    c1: 0,
    lessons: base12 * 12,
    cost: base12 * price12,
  };

  const maxExtra12 = Math.floor(remBudget / price12);
  for (let extra12 = 0; extra12 <= maxExtra12; extra12++) {
    const after12 = remBudget - extra12 * price12;
    const max8 = Math.floor(after12 / price8);
    for (let c8 = 0; c8 <= max8; c8++) {
      const after8 = after12 - c8 * price8;
      const max4 = Math.floor(after8 / price4);
      for (let c4 = 0; c4 <= max4; c4++) {
        const after4 = after8 - c4 * price4;
        const c1 = Math.floor(after4 / price1);
        const c12 = base12 + extra12;
        const lessons = 12 * c12 + 8 * c8 + 4 * c4 + c1;
        const cost = c12 * price12 + c8 * price8 + c4 * price4 + c1 * price1;

        if (cost > budgetBrlCents) continue;

        const isBetter =
          lessons > best.lessons ||
          (lessons === best.lessons && cost < best.cost) ||
          (lessons === best.lessons &&
            cost === best.cost &&
            (c12 > best.c12 ||
              (c12 === best.c12 && c8 > best.c8) ||
              (c12 === best.c12 && c8 === best.c8 && c4 > best.c4) ||
              (c12 === best.c12 && c8 === best.c8 && c4 === best.c4 && c1 > best.c1)));

        if (isBetter) {
          best = { c12, c8, c4, c1, lessons, cost };
        }
      }
    }
  }

  const counts: Record<ApprovedPackageSize, number> = {
    12: best.c12,
    8: best.c8,
    4: best.c4,
    1: best.c1,
  };

  const specsBySize: Array<{ size: ApprovedPackageSize; spec: TargetPackagePriceSpec }> = [
    { size: 12, spec: p12 },
    { size: 8, spec: p8 },
    { size: 4, spec: p4 },
    { size: 1, spec: p1 },
  ];

  const lines: ComposedPackageLine[] = [];
  let totalTeacherShareBrlCents = 0;
  let totalPlatformRevenueBrlCents = 0;
  let totalCostUsdCents = 0;
  let totalTeacherShareUsdCents = 0;
  let totalPlatformRevenueUsdCents = 0;

  for (const { size, spec } of specsBySize) {
    const qty = counts[size];
    if (qty <= 0) continue;

    const totalPriceBrlCents = qty * spec.finalPriceBrlCents;
    const lineTeacherBrl = qty * spec.teacherShareBrlCents;
    const linePlatformBrl = qty * spec.platformRevenueBrlCents;
    const lineTotalUsd = qty * spec.finalPriceUsdCents;
    const lineTeacherUsd = qty * spec.teacherShareUsdCents;
    const linePlatformUsd = qty * spec.platformRevenueUsdCents;

    lines.push({
      packageSize: size,
      quantity: qty,
      lessonsSubtotal: qty * size,
      discountPercent: spec.discountPercent,
      unitPackagePriceBrlCents: spec.finalPriceBrlCents,
      unitPackageTeacherShareBrlCents: spec.teacherShareBrlCents,
      unitPackagePlatformRevenueBrlCents: spec.platformRevenueBrlCents,
      totalPriceBrlCents,
      totalTeacherShareBrlCents: lineTeacherBrl,
      totalPlatformRevenueBrlCents: linePlatformBrl,
      totalPriceUsdCents: lineTotalUsd,
      totalTeacherShareUsdCents: lineTeacherUsd,
      totalPlatformRevenueUsdCents: linePlatformUsd,
    });

    totalTeacherShareBrlCents += lineTeacherBrl;
    totalPlatformRevenueBrlCents += linePlatformBrl;
    totalCostUsdCents += lineTotalUsd;
    totalTeacherShareUsdCents += lineTeacherUsd;
    totalPlatformRevenueUsdCents += linePlatformUsd;
  }

  const residualBrlCents = budgetBrlCents - best.cost;
  if (
    residualBrlCents < 0 ||
    best.cost + residualBrlCents !== budgetBrlCents ||
    totalTeacherShareBrlCents + totalPlatformRevenueBrlCents !== best.cost
  ) {
    throw new SwitchConversionError(
      'Invariante de conservação de centavos violada na composição de pacotes.',
      500,
      'FINANCIAL_INVARIANT_VIOLATION',
      {
        budgetBrlCents,
        cost: best.cost,
        residualBrlCents,
        totalTeacherShareBrlCents,
        totalPlatformRevenueBrlCents,
      }
    );
  }

  return {
    counts,
    lines,
    totalLessons: best.lessons,
    totalCostBrlCents: best.cost,
    totalTeacherShareBrlCents,
    totalPlatformRevenueBrlCents,
    totalCostUsdCents,
    totalTeacherShareUsdCents,
    totalPlatformRevenueUsdCents,
    residualBrlCents,
  };
}

interface VerifiedPaidLotEvidence {
  ok: boolean;
  reason: string | null;
  schedule: CreditLotUnitLedgerEntry[] | null;
  hasTeacherAndPlatformSplit: boolean;
  totalPaidBrlCents: number | null;
  teacherShareBrlCents: number | null;
  platformRevenueBrlCents: number | null;
}

function inspectPaidLotFinancialEvidence(lot: CreditLot): VerifiedPaidLotEvidence {
  if (lot.origin !== 'paid') {
    return {
      ok: false,
      reason: 'Lote não possui origem paid.',
      schedule: null,
      hasTeacherAndPlatformSplit: false,
      totalPaidBrlCents: null,
      teacherShareBrlCents: null,
      platformRevenueBrlCents: null,
    };
  }

  if (
    lot.financialAttributionStatus !== 'paid_verified' ||
    lot.isPaidPurchase !== true ||
    lot.countsAsRevenue !== true
  ) {
    return {
      ok: false,
      reason: `Lote pago '${lot.id}' sem confirmação financeira verificada (paid_verified/isPaidPurchase/countsAsRevenue).`,
      schedule: null,
      hasTeacherAndPlatformSplit: false,
      totalPaidBrlCents: null,
      teacherShareBrlCents: null,
      platformRevenueBrlCents: null,
    };
  }

  if (
    typeof lot.totalPaidBrlCents !== 'number' ||
    !Number.isInteger(lot.totalPaidBrlCents) ||
    lot.totalPaidBrlCents <= 0
  ) {
    return {
      ok: false,
      reason: `Lote pago '${lot.id}' não possui totalPaidBrlCents inteiro positivo verificado.`,
      schedule: null,
      hasTeacherAndPlatformSplit: false,
      totalPaidBrlCents: null,
      teacherShareBrlCents: null,
      platformRevenueBrlCents: null,
    };
  }

  if (
    typeof lot.remainingTotalPaidBrlCents !== 'number' ||
    !Number.isInteger(lot.remainingTotalPaidBrlCents) ||
    lot.remainingTotalPaidBrlCents < 0
  ) {
    return {
      ok: false,
      reason: `Lote pago '${lot.id}' não possui remainingTotalPaidBrlCents inteiro válido.`,
      schedule: null,
      hasTeacherAndPlatformSplit: false,
      totalPaidBrlCents: null,
      teacherShareBrlCents: null,
      platformRevenueBrlCents: null,
    };
  }

  if (
    !Array.isArray(lot.unitCentsSchedule) ||
    lot.unitCentsSchedule.length !== lot.initialLessons
  ) {
    return {
      ok: false,
      reason: `Lote pago '${lot.id}' não possui agenda unitária unitCentsSchedule completa em centavos.`,
      schedule: null,
      hasTeacherAndPlatformSplit: false,
      totalPaidBrlCents: null,
      teacherShareBrlCents: null,
      platformRevenueBrlCents: null,
    };
  }

  if (
    !Array.isArray(lot.availableUnitIndices) ||
    lot.availableUnitIndices.length !== lot.remainingLessons ||
    !Array.isArray(lot.consumedUnitIndices) ||
    lot.consumedUnitIndices.length !== lot.consumedLessons
  ) {
    return {
      ok: false,
      reason: `Lote pago '${lot.id}' não possui índices unitários explícitos (availableUnitIndices/consumedUnitIndices).`,
      schedule: null,
      hasTeacherAndPlatformSplit: false,
      totalPaidBrlCents: null,
      teacherShareBrlCents: null,
      platformRevenueBrlCents: null,
    };
  }

  let schedulePaidSum = 0;
  for (let i = 0; i < lot.unitCentsSchedule.length; i++) {
    const entry = lot.unitCentsSchedule[i];
    if (
      !entry ||
      entry.unitIndex !== i ||
      typeof entry.totalPaidBrlCents !== 'number' ||
      !Number.isInteger(entry.totalPaidBrlCents) ||
      entry.totalPaidBrlCents < 0
    ) {
      return {
        ok: false,
        reason: `Lote pago '${lot.id}' possui entrada unitária inválida em unitCentsSchedule[${i}].`,
        schedule: null,
        hasTeacherAndPlatformSplit: false,
        totalPaidBrlCents: null,
        teacherShareBrlCents: null,
        platformRevenueBrlCents: null,
      };
    }
    schedulePaidSum += entry.totalPaidBrlCents;
  }

  if (schedulePaidSum !== lot.totalPaidBrlCents) {
    return {
      ok: false,
      reason: `Soma unitária em centavos (${schedulePaidSum}) diverge de totalPaidBrlCents (${lot.totalPaidBrlCents}) no lote '${lot.id}'.`,
      schedule: null,
      hasTeacherAndPlatformSplit: false,
      totalPaidBrlCents: null,
      teacherShareBrlCents: null,
      platformRevenueBrlCents: null,
    };
  }

  const remFromSchedule = lot.availableUnitIndices.reduce(
    (acc, idx) => acc + Number(lot.unitCentsSchedule![idx].totalPaidBrlCents),
    0
  );
  if (remFromSchedule !== lot.remainingTotalPaidBrlCents) {
    return {
      ok: false,
      reason: `Saldo remanescente em centavos (${lot.remainingTotalPaidBrlCents}) diverge da soma das unidades disponíveis (${remFromSchedule}) no lote '${lot.id}'.`,
      schedule: null,
      hasTeacherAndPlatformSplit: false,
      totalPaidBrlCents: null,
      teacherShareBrlCents: null,
      platformRevenueBrlCents: null,
    };
  }

  const hasTeacherInt =
    typeof lot.teacherShareBrlCents === 'number' &&
    Number.isInteger(lot.teacherShareBrlCents) &&
    lot.teacherShareBrlCents >= 0;
  const hasPlatformInt =
    typeof lot.platformRevenueBrlCents === 'number' &&
    Number.isInteger(lot.platformRevenueBrlCents) &&
    lot.platformRevenueBrlCents >= 0;

  let hasTeacherAndPlatformSplit = false;
  if (hasTeacherInt && hasPlatformInt) {
    if (lot.teacherShareBrlCents! + lot.platformRevenueBrlCents! !== lot.totalPaidBrlCents) {
      return {
        ok: false,
        reason: `Lote pago '${lot.id}' viola conservação Professor + Plataforma !== Total em centavos.`,
        schedule: null,
        hasTeacherAndPlatformSplit: false,
        totalPaidBrlCents: null,
        teacherShareBrlCents: null,
        platformRevenueBrlCents: null,
      };
    }

    let sumTeach = 0;
    let sumPlat = 0;
    for (let i = 0; i < lot.unitCentsSchedule.length; i++) {
      const e = lot.unitCentsSchedule[i];
      if (
        typeof e.teacherShareBrlCents !== 'number' ||
        !Number.isInteger(e.teacherShareBrlCents) ||
        e.teacherShareBrlCents < 0 ||
        typeof e.platformRevenueBrlCents !== 'number' ||
        !Number.isInteger(e.platformRevenueBrlCents) ||
        e.platformRevenueBrlCents < 0 ||
        e.teacherShareBrlCents + e.platformRevenueBrlCents !== e.totalPaidBrlCents
      ) {
        return {
          ok: false,
          reason: `Unidade ${i} do lote '${lot.id}' viola conservação unitária Professor + Plataforma === Total.`,
          schedule: null,
          hasTeacherAndPlatformSplit: false,
          totalPaidBrlCents: null,
          teacherShareBrlCents: null,
          platformRevenueBrlCents: null,
        };
      }
      sumTeach += e.teacherShareBrlCents;
      sumPlat += e.platformRevenueBrlCents;
    }
    if (sumTeach !== lot.teacherShareBrlCents || sumPlat !== lot.platformRevenueBrlCents) {
      return {
        ok: false,
        reason: `Soma de rateio unitário no lote '${lot.id}' diverge dos totais do lote.`,
        schedule: null,
        hasTeacherAndPlatformSplit: false,
        totalPaidBrlCents: null,
        teacherShareBrlCents: null,
        platformRevenueBrlCents: null,
      };
    }
    hasTeacherAndPlatformSplit = true;
  }

  return {
    ok: true,
    reason: null,
    schedule: lot.unitCentsSchedule,
    hasTeacherAndPlatformSplit,
    totalPaidBrlCents: lot.totalPaidBrlCents,
    teacherShareBrlCents: hasTeacherAndPlatformSplit ? lot.teacherShareBrlCents! : null,
    platformRevenueBrlCents: hasTeacherAndPlatformSplit ? lot.platformRevenueBrlCents! : null,
  };
}

function validateCourtesyLotIntegrity(lot: CreditLot): { ok: boolean; reason: string | null } {
  if (lot.financialAttributionStatus !== 'courtesy_non_revenue') {
    return {
      ok: false,
      reason: `Lote de cortesia '${lot.id}' possui financialAttributionStatus inválido (${String(lot.financialAttributionStatus)}).`,
    };
  }
  if (lot.isPaidPurchase !== false || lot.countsAsRevenue !== false) {
    return {
      ok: false,
      reason: `Lote de cortesia '${lot.id}' não pode marcar isPaidPurchase ou countsAsRevenue.`,
    };
  }
  const zeroFields = [
    lot.totalPaidBrlCents,
    lot.teacherShareBrlCents,
    lot.platformRevenueBrlCents,
    lot.remainingTotalPaidBrlCents,
    lot.remainingTeacherShareBrlCents,
    lot.remainingPlatformRevenueBrlCents,
  ];
  if (zeroFields.some((v) => v !== undefined && v !== null && v !== 0)) {
    return {
      ok: false,
      reason: `Lote de cortesia '${lot.id}' possui valor financeiro não-zerado indevido.`,
    };
  }
  return { ok: true, reason: null };
}

/**
 * Main pure evaluation entrypoint for NF.SWITCH.2C (NF.SWITCH.1A contract).
 */
export function evaluateSwitchConversion(
  input: SwitchConversionEngineInput
): SwitchConversionResult {
  const cleanStudentUid = typeof input?.studentUid === 'string' ? input.studentUid.trim() : '';
  if (!cleanStudentUid) {
    const reason: SwitchBlockingReason = {
      code: 'INVALID_STUDENT_UID',
      message: 'UID canônico do aluno é obrigatório para calcular a conversão de créditos.',
    };
    return {
      engineVersion: SWITCH_CONVERSION_ENGINE_VERSION,
      studentUid: '',
      status: 'BLOCKED',
      canConvert: false,
      blockingReasons: [reason],
      blockingCodes: [reason.code],
      warnings: [],
      sourceAnalysis: {
        totalInitialLessons: 0,
        totalRemainingLessonsInLots: 0,
        availablePaidUnitsCount: 0,
        availableCourtesyUnitsCount: 0,
        availableLegacyUnitsCount: 0,
        lockedScheduledLessonsCount: 0,
        lockedScheduledPaidUnitsCount: 0,
        lockedScheduledCourtesyUnitsCount: 0,
        lockedScheduledLegacyUnitsCount: 0,
        simulatedRefundedScheduledLessonsCount: 0,
        simulatedForfeitedStudentCancelCount: 0,
        completedLessonsCount: 0,
        studentFaultNotCompletedCount: 0,
        studentCancelledCount: 0,
        teacherOrAdminRefundedLessonsCount: 0,
        trialLessonsCount: 0,
        budgetBrlCents: 0,
        lotsBreakdown: [],
      },
      targetQuote: null,
      conversionPlan: null,
      accounting: null,
    };
  }

  const lotsCopy: CreditLot[] = Array.isArray(input.creditLots)
    ? input.creditLots.map((l) => ({
        ...l,
        availableUnitIndices: Array.isArray(l.availableUnitIndices)
          ? [...l.availableUnitIndices]
          : undefined,
        consumedUnitIndices: Array.isArray(l.consumedUnitIndices)
          ? [...l.consumedUnitIndices]
          : undefined,
        unitCentsSchedule: Array.isArray(l.unitCentsSchedule)
          ? l.unitCentsSchedule.map((u) => ({ ...u }))
          : l.unitCentsSchedule,
      }))
    : [];

  // Strict structural & isolation validation (throws CreditLedgerError on ledger tampering/divergence)
  validateCreditLotsForStudent(cleanStudentUid, lotsCopy);

  const totalRemainingInLots = sumLotRemainingLessons(lotsCopy);
  if (input.studentAvailableLessons !== undefined) {
    if (
      !Number.isInteger(input.studentAvailableLessons) ||
      input.studentAvailableLessons < 0 ||
      input.studentAvailableLessons !== totalRemainingInLots
    ) {
      throw new CreditLedgerError(
        `Divergência detectada no razão de créditos (CREDIT_LEDGER_DIVERGENCE): availableLessons=${input.studentAvailableLessons} difere da soma dos lotes=${totalRemainingInLots}.`,
        409,
        CREDIT_LEDGER_DIVERGENCE_CODE,
        { studentAvailableLessons: input.studentAvailableLessons, lotsSum: totalRemainingInLots }
      );
    }
  }

  const lessons = Array.isArray(input.lessons) ? input.lessons : [];
  for (const lesson of lessons) {
    if (!lesson || typeof lesson !== 'object') continue;
    const lessonStudentUid = typeof lesson.studentUid === 'string' ? lesson.studentUid.trim() : '';
    if (lessonStudentUid && lessonStudentUid !== cleanStudentUid) {
      throw new CreditLedgerError(
        `Violação de isolamento: aula '${lesson.id}' pertence a outro estudante.`,
        409,
        CREDIT_LOT_ISOLATION_VIOLATION_CODE,
        { lessonId: lesson.id, expectedStudentUid: cleanStudentUid, actualStudentUid: lessonStudentUid }
      );
    }
  }

  const lotById = new Map<string, CreditLot>();
  const lotIndicesMap = new Map<string, { available: Set<number>; consumed: Set<number> }>();
  for (const lot of lotsCopy) {
    lotById.set(lot.id, lot);
    const { availableUnitIndices, consumedUnitIndices } = getNormalizedUnitIndices(lot);
    lotIndicesMap.set(lot.id, {
      available: new Set(availableUnitIndices),
      consumed: new Set(consumedUnitIndices),
    });
  }

  const dispositions = input.scheduledLessonDispositions || {};
  const seenActiveScheduledUnits = new Set<string>();
  const lockedUnitsByLot = new Map<string, Set<number>>();
  const simulatedRefundedUnitsByLot = new Map<string, Set<number>>();
  const completedUnitsByLot = new Map<string, Set<number>>();
  const studentFaultUnitsByLot = new Map<string, Set<number>>();

  let lockedScheduledLessonsCount = 0;
  let lockedScheduledPaidUnitsCount = 0;
  let lockedScheduledCourtesyUnitsCount = 0;
  let lockedScheduledLegacyUnitsCount = 0;
  let simulatedRefundedScheduledLessonsCount = 0;
  let simulatedForfeitedStudentCancelCount = 0;
  let completedLessonsCount = 0;
  let studentFaultNotCompletedCount = 0;
  let studentCancelledCount = 0;
  let teacherOrAdminRefundedLessonsCount = 0;
  let trialLessonsCount = 0;

  const ensureSet = (map: Map<string, Set<number>>, key: string): Set<number> => {
    let s = map.get(key);
    if (!s) {
      s = new Set<number>();
      map.set(key, s);
    }
    return s;
  };

  for (const lesson of lessons) {
    if (!lesson || typeof lesson !== 'object') continue;
    if (lesson.isTrialLesson === true) {
      trialLessonsCount += 1;
      continue;
    }

    const lotId = typeof lesson.creditLotId === 'string' ? lesson.creditLotId.trim() : '';
    const unitIndex =
      typeof lesson.creditUnitIndex === 'number' && Number.isInteger(lesson.creditUnitIndex)
        ? lesson.creditUnitIndex
        : null;

    if (isLessonCompleted(lesson)) {
      completedLessonsCount += 1;
      if (lotId && unitIndex !== null) {
        ensureSet(completedUnitsByLot, lotId).add(unitIndex);
      }
      continue;
    }

    if (isLessonCancelled(lesson)) {
      if (lesson.creditRefunded === true) {
        teacherOrAdminRefundedLessonsCount += 1;
      } else if (String(lesson.cancelledBy || '').toLowerCase().trim() === 'student') {
        studentCancelledCount += 1;
        if (lotId && unitIndex !== null) {
          ensureSet(studentFaultUnitsByLot, lotId).add(unitIndex);
        }
      }
      continue;
    }

    if (isLessonNotCompleted(lesson)) {
      if (lesson.creditRefunded === true) {
        teacherOrAdminRefundedLessonsCount += 1;
      } else if (String(lesson.notCompletedResponsible || '').toLowerCase().trim() === 'student') {
        studentFaultNotCompletedCount += 1;
        if (lotId && unitIndex !== null) {
          ensureSet(studentFaultUnitsByLot, lotId).add(unitIndex);
        }
      }
      continue;
    }

    if (isLessonActiveScheduled(lesson)) {
      const action: ScheduledLessonDispositionAction = dispositions[lesson.id] || 'keep';

      if (lotId && unitIndex !== null) {
        const lot = lotById.get(lotId);
        const idxState = lotIndicesMap.get(lotId);
        if (!lot || !idxState) {
          throw new CreditLedgerError(
            `Divergência: aula agendada '${lesson.id}' aponta para lote inexistente '${lotId}'.`,
            409,
            CREDIT_LEDGER_DIVERGENCE_CODE,
            { lessonId: lesson.id, creditLotId: lotId }
          );
        }

        // If lesson hasn't been refunded yet, its unitIndex must be in consumedUnitIndices (not available)
        if (lesson.creditRefunded !== true) {
          const unitKey = `${lotId}::${unitIndex}`;
          if (seenActiveScheduledUnits.has(unitKey)) {
            throw new CreditLedgerError(
              `Divergência: múltiplas aulas agendadas ativas apontam para a mesma unidade ${unitIndex} do lote '${lotId}'.`,
              409,
              CREDIT_LEDGER_DIVERGENCE_CODE,
              { lessonId: lesson.id, creditLotId: lotId, creditUnitIndex: unitIndex }
            );
          }
          seenActiveScheduledUnits.add(unitKey);

          if (idxState.available.has(unitIndex) || !idxState.consumed.has(unitIndex)) {
            throw new CreditLedgerError(
              `Divergência: unidade ${unitIndex} da aula agendada '${lesson.id}' no lote '${lotId}' não consta como consumida.`,
              409,
              CREDIT_LEDGER_DIVERGENCE_CODE,
              { lessonId: lesson.id, creditLotId: lotId, creditUnitIndex: unitIndex }
            );
          }

          if (action === 'cancel_by_teacher' || action === 'cancel_by_admin') {
            // Official refund rule: teacher/admin cancel on non-trial unrefunded lesson restores exact unitIndex
            idxState.consumed.delete(unitIndex);
            idxState.available.add(unitIndex);
            ensureSet(simulatedRefundedUnitsByLot, lotId).add(unitIndex);
            simulatedRefundedScheduledLessonsCount += 1;
            continue;
          }

          if (action === 'cancel_by_student') {
            simulatedForfeitedStudentCancelCount += 1;
            ensureSet(studentFaultUnitsByLot, lotId).add(unitIndex);
            continue;
          }

          // Default 'keep': unit remains locked in scheduled lesson
          lockedScheduledLessonsCount += 1;
          ensureSet(lockedUnitsByLot, lotId).add(unitIndex);
          if (lot.origin === 'paid') lockedScheduledPaidUnitsCount += 1;
          else if (lot.origin === 'courtesy') lockedScheduledCourtesyUnitsCount += 1;
          else lockedScheduledLegacyUnitsCount += 1;
        } else {
          // Already refunded (rare/edge state on an active lesson)
          lockedScheduledLessonsCount += 1;
        }
      } else {
        // Legacy pre-2A scheduled lesson without creditLotId
        if (action === 'cancel_by_student') {
          simulatedForfeitedStudentCancelCount += 1;
        } else if (action === 'cancel_by_teacher' || action === 'cancel_by_admin') {
          // Pre-2A lesson without creditLotId cannot be attributed to a paid lot; only counts as unattributed refund attempt
          lockedScheduledLessonsCount += 1;
          lockedScheduledLegacyUnitsCount += 1;
        } else {
          lockedScheduledLessonsCount += 1;
          lockedScheduledLegacyUnitsCount += 1;
        }
      }
    }
  }

  // Analyze each lot's available, locked, and consumed units & integer cents
  const blockingReasons: SwitchBlockingReason[] = [];
  const warnings: Array<{ code: SwitchWarningCode; message: string }> = [];
  const lotsBreakdown: SourceLotBreakdown[] = [];

  let totalInitialLessons = 0;
  let availablePaidUnitsCount = 0;
  let availableCourtesyUnitsCount = 0;
  let availableLegacyUnitsCount = 0;
  let budgetBrlCents = 0;

  let purchasedTotalPaidBrlCents: number | null = 0;
  let purchasedTeacherShareBrlCents: number | null = 0;
  let purchasedPlatformRevenueBrlCents: number | null = 0;
  let availableOriginalTeacherShareBrlCents: number | null = 0;
  let availableOriginalPlatformRevenueBrlCents: number | null = 0;
  let lockedScheduledTotalPaidBrlCents: number | null = 0;
  let remainingLockedTeacherShareBrlCents: number | null = 0;
  let permanentlyConsumedTotalPaidBrlCents: number | null = 0;
  let sourceTeacherEarnedFromCompletedBrlCents: number | null = 0;
  let sourceTeacherNonRefundedStudentFaultBrlCents: number | null = 0;

  let hasAnyLegacyUnreconciledRemaining = false;
  let hasAnyMissingPaidEvidence = false;
  let missingEvidenceDetails: string[] = [];
  let missingTeacherSplitWarned = false;

  for (const lot of lotsCopy) {
    totalInitialLessons += lot.initialLessons;
    const idxState = lotIndicesMap.get(lot.id)!;
    const effectiveAvailIndices = Array.from(idxState.available).sort((a, b) => a - b);
    const lockedSet = lockedUnitsByLot.get(lot.id) || new Set<number>();
    const simRefundSet = simulatedRefundedUnitsByLot.get(lot.id) || new Set<number>();
    const completedSet = completedUnitsByLot.get(lot.id) || new Set<number>();
    const studentFaultSet = studentFaultUnitsByLot.get(lot.id) || new Set<number>();
    const permConsumedCount = Array.from(idxState.consumed).filter((i) => !lockedSet.has(i)).length;

    if (lot.origin === 'legacy_unreconciled') {
      const availCount = effectiveAvailIndices.length;
      availableLegacyUnitsCount += availCount;
      if (availCount > 0) {
        hasAnyLegacyUnreconciledRemaining = true;
      }

      purchasedTotalPaidBrlCents = null;
      purchasedTeacherShareBrlCents = null;
      purchasedPlatformRevenueBrlCents = null;

      lotsBreakdown.push({
        lotId: lot.id,
        origin: lot.origin,
        sourceType: lot.sourceType,
        pricedTeacherUid: null,
        initialLessons: lot.initialLessons,
        availableUnitsCount: availCount,
        lockedScheduledUnitsCount: lockedSet.size,
        permanentlyConsumedUnitsCount: permConsumedCount,
        simulatedRefundedUnitsCount: simRefundSet.size,
        availableUnitIndices: effectiveAvailIndices,
        hasVerifiedFinancialEvidence: false,
        missingEvidenceReason: 'Lote legacy_unreconciled sem atribuição financeira presumida.',
        availableTotalPaidBrlCents: null,
        availableTeacherShareBrlCents: null,
        availablePlatformRevenueBrlCents: null,
        lockedScheduledTotalPaidBrlCents: null,
        permanentlyConsumedTotalPaidBrlCents: null,
      });
      continue;
    }

    if (lot.origin === 'courtesy') {
      const check = validateCourtesyLotIntegrity(lot);
      if (!check.ok) {
        hasAnyMissingPaidEvidence = true;
        if (check.reason) missingEvidenceDetails.push(check.reason);
      }
      const availCount = effectiveAvailIndices.length;
      availableCourtesyUnitsCount += availCount;

      lotsBreakdown.push({
        lotId: lot.id,
        origin: lot.origin,
        sourceType: lot.sourceType,
        pricedTeacherUid: lot.pricedTeacherUid || null,
        initialLessons: lot.initialLessons,
        availableUnitsCount: availCount,
        lockedScheduledUnitsCount: lockedSet.size,
        permanentlyConsumedUnitsCount: permConsumedCount,
        simulatedRefundedUnitsCount: simRefundSet.size,
        availableUnitIndices: effectiveAvailIndices,
        hasVerifiedFinancialEvidence: check.ok,
        missingEvidenceReason: check.reason,
        availableTotalPaidBrlCents: 0,
        availableTeacherShareBrlCents: 0,
        availablePlatformRevenueBrlCents: 0,
        lockedScheduledTotalPaidBrlCents: 0,
        permanentlyConsumedTotalPaidBrlCents: 0,
      });
      continue;
    }

    // origin === 'paid'
    const evidence = inspectPaidLotFinancialEvidence(lot);
    const availCount = effectiveAvailIndices.length;

    if (!evidence.ok || !evidence.schedule) {
      if (availCount > 0 || lockedSet.size > 0) {
        hasAnyMissingPaidEvidence = true;
        if (evidence.reason) missingEvidenceDetails.push(evidence.reason);
      }

      purchasedTotalPaidBrlCents = null;
      purchasedTeacherShareBrlCents = null;
      purchasedPlatformRevenueBrlCents = null;
      availableOriginalTeacherShareBrlCents = null;
      availableOriginalPlatformRevenueBrlCents = null;
      lockedScheduledTotalPaidBrlCents = null;
      remainingLockedTeacherShareBrlCents = null;
      permanentlyConsumedTotalPaidBrlCents = null;
      sourceTeacherEarnedFromCompletedBrlCents = null;
      sourceTeacherNonRefundedStudentFaultBrlCents = null;

      lotsBreakdown.push({
        lotId: lot.id,
        origin: lot.origin,
        sourceType: lot.sourceType,
        pricedTeacherUid: lot.pricedTeacherUid || null,
        initialLessons: lot.initialLessons,
        availableUnitsCount: availCount,
        lockedScheduledUnitsCount: lockedSet.size,
        permanentlyConsumedUnitsCount: permConsumedCount,
        simulatedRefundedUnitsCount: simRefundSet.size,
        availableUnitIndices: effectiveAvailIndices,
        hasVerifiedFinancialEvidence: false,
        missingEvidenceReason: evidence.reason,
        availableTotalPaidBrlCents: null,
        availableTeacherShareBrlCents: null,
        availablePlatformRevenueBrlCents: null,
        lockedScheduledTotalPaidBrlCents: null,
        permanentlyConsumedTotalPaidBrlCents: null,
      });
      continue;
    }

    availablePaidUnitsCount += availCount;
    const sched = evidence.schedule;

    let lotAvailPaid = 0;
    let lotAvailTeacher = 0;
    let lotAvailPlatform = 0;
    for (const uIdx of effectiveAvailIndices) {
      const entry = sched[uIdx];
      lotAvailPaid += Number(entry.totalPaidBrlCents);
      if (evidence.hasTeacherAndPlatformSplit) {
        lotAvailTeacher += Number(entry.teacherShareBrlCents);
        lotAvailPlatform += Number(entry.platformRevenueBrlCents);
      }
    }

    let lotLockedPaid = 0;
    let lotLockedTeacher = 0;
    for (const uIdx of lockedSet) {
      const entry = sched[uIdx];
      lotLockedPaid += Number(entry.totalPaidBrlCents);
      if (evidence.hasTeacherAndPlatformSplit) {
        lotLockedTeacher += Number(entry.teacherShareBrlCents);
      }
    }

    let lotPermConsumedPaid = 0;
    for (const uIdx of idxState.consumed) {
      if (lockedSet.has(uIdx)) continue;
      lotPermConsumedPaid += Number(sched[uIdx].totalPaidBrlCents);
    }

    budgetBrlCents += lotAvailPaid;

    if (purchasedTotalPaidBrlCents !== null) {
      purchasedTotalPaidBrlCents += evidence.totalPaidBrlCents!;
    }
    if (lockedScheduledTotalPaidBrlCents !== null) {
      lockedScheduledTotalPaidBrlCents += lotLockedPaid;
    }
    if (permanentlyConsumedTotalPaidBrlCents !== null) {
      permanentlyConsumedTotalPaidBrlCents += lotPermConsumedPaid;
    }

    if (evidence.hasTeacherAndPlatformSplit) {
      if (purchasedTeacherShareBrlCents !== null) {
        purchasedTeacherShareBrlCents += evidence.teacherShareBrlCents!;
      }
      if (purchasedPlatformRevenueBrlCents !== null) {
        purchasedPlatformRevenueBrlCents += evidence.platformRevenueBrlCents!;
      }
      if (availableOriginalTeacherShareBrlCents !== null) {
        availableOriginalTeacherShareBrlCents += lotAvailTeacher;
      }
      if (availableOriginalPlatformRevenueBrlCents !== null) {
        availableOriginalPlatformRevenueBrlCents += lotAvailPlatform;
      }
      if (remainingLockedTeacherShareBrlCents !== null) {
        remainingLockedTeacherShareBrlCents += lotLockedTeacher;
      }

      if (sourceTeacherEarnedFromCompletedBrlCents !== null) {
        for (const uIdx of completedSet) {
          if (sched[uIdx]) {
            sourceTeacherEarnedFromCompletedBrlCents += Number(sched[uIdx].teacherShareBrlCents);
          }
        }
      }
      if (sourceTeacherNonRefundedStudentFaultBrlCents !== null) {
        for (const uIdx of studentFaultSet) {
          if (sched[uIdx]) {
            sourceTeacherNonRefundedStudentFaultBrlCents += Number(sched[uIdx].teacherShareBrlCents);
          }
        }
      }
    } else {
      purchasedTeacherShareBrlCents = null;
      purchasedPlatformRevenueBrlCents = null;
      availableOriginalTeacherShareBrlCents = null;
      availableOriginalPlatformRevenueBrlCents = null;
      remainingLockedTeacherShareBrlCents = null;
      sourceTeacherEarnedFromCompletedBrlCents = null;
      sourceTeacherNonRefundedStudentFaultBrlCents = null;
      if (!missingTeacherSplitWarned) {
        missingTeacherSplitWarned = true;
        warnings.push({
          code: 'SOURCE_TEACHER_SHARE_UNAVAILABLE_ON_RECONCILED_LOT',
          message:
            'Um lote pago conciliado historicamente não possui rateio professor/plataforma registrado; o orçamento pago em BRL foi preservado sem presumir repasse.',
        });
      }
    }

    lotsBreakdown.push({
      lotId: lot.id,
      origin: lot.origin,
      sourceType: lot.sourceType,
      pricedTeacherUid: lot.pricedTeacherUid || null,
      initialLessons: lot.initialLessons,
      availableUnitsCount: availCount,
      lockedScheduledUnitsCount: lockedSet.size,
      permanentlyConsumedUnitsCount: permConsumedCount,
      simulatedRefundedUnitsCount: simRefundSet.size,
      availableUnitIndices: effectiveAvailIndices,
      hasVerifiedFinancialEvidence: true,
      missingEvidenceReason: null,
      availableTotalPaidBrlCents: lotAvailPaid,
      availableTeacherShareBrlCents: evidence.hasTeacherAndPlatformSplit ? lotAvailTeacher : null,
      availablePlatformRevenueBrlCents: evidence.hasTeacherAndPlatformSplit ? lotAvailPlatform : null,
      lockedScheduledTotalPaidBrlCents: lotLockedPaid,
      permanentlyConsumedTotalPaidBrlCents: lotPermConsumedPaid,
    });
  }

  const sourceAnalysis: SwitchSourceAnalysis = {
    totalInitialLessons,
    totalRemainingLessonsInLots: totalRemainingInLots,
    availablePaidUnitsCount,
    availableCourtesyUnitsCount,
    availableLegacyUnitsCount,
    lockedScheduledLessonsCount,
    lockedScheduledPaidUnitsCount,
    lockedScheduledCourtesyUnitsCount,
    lockedScheduledLegacyUnitsCount,
    simulatedRefundedScheduledLessonsCount,
    simulatedForfeitedStudentCancelCount,
    completedLessonsCount,
    studentFaultNotCompletedCount,
    studentCancelledCount,
    teacherOrAdminRefundedLessonsCount,
    trialLessonsCount,
    budgetBrlCents,
    lotsBreakdown,
  };

  if (lockedScheduledLessonsCount > 0) {
    warnings.push({
      code: 'LOCKED_SCHEDULED_LESSONS_EXCLUDED',
      message: `${lockedScheduledLessonsCount} aula(s) agendada(s) ativa(s) permanece(m) bloqueada(s) e não entra(m) na conversão sem estorno oficial elegível.`,
    });
  }

  // Blocking checks on source lots
  if (hasAnyLegacyUnreconciledRemaining) {
    blockingReasons.push({
      code: 'LEGACY_UNRECONCILED_PRESENT',
      message:
        'Conversão automática bloqueada: o aluno possui créditos legados não conciliados (legacy_unreconciled). Realize a conciliação administrativa (NF.SWITCH.2B) antes da troca.',
      details: { availableLegacyUnitsCount },
    });
  }

  if (hasAnyMissingPaidEvidence) {
    blockingReasons.push({
      code: 'MISSING_FINANCIAL_EVIDENCE',
      message:
        'Conversão bloqueada: lote(s) pago(s) sem evidência financeira verificada e íntegra em centavos.',
      details: { reasons: missingEvidenceDetails },
    });
  }

  if (availablePaidUnitsCount === 0 && availableCourtesyUnitsCount === 0 && availableLegacyUnitsCount === 0) {
    if (lockedScheduledLessonsCount > 0) {
      blockingReasons.push({
        code: 'ALL_CREDITS_LOCKED_IN_SCHEDULED_LESSONS',
        message:
          'Saldo disponível insuficiente para conversão: todas as aulas restantes estão vinculadas a agendamentos ativos.',
        details: { lockedScheduledLessonsCount },
      });
    } else {
      blockingReasons.push({
        code: 'NO_AVAILABLE_CREDITS',
        message: 'Saldo de créditos disponível insuficiente para realizar conversão (0 aulas disponíveis).',
      });
    }
  }

  // Validate target teacher & PTAX D-1
  const target = input.targetTeacher;
  const cleanTargetTeacherUid = typeof target?.teacherUid === 'string' ? target.teacherUid.trim() : '';
  if (!cleanTargetTeacherUid) {
    blockingReasons.push({
      code: 'TARGET_TEACHER_INVALID',
      message: 'UID canônico do Native Friend de destino é obrigatório.',
    });
  } else {
    const isApproved =
      target.isApproved !== false &&
      (target.approvalStatus === undefined ||
        target.approvalStatus === null ||
        target.approvalStatus === 'approved');
    if (!isApproved) {
      blockingReasons.push({
        code: 'TARGET_TEACHER_NOT_APPROVED',
        message: 'Native Friend de destino não está aprovado para comercialização.',
        details: { approvalStatus: target.approvalStatus, isApproved: target.isApproved },
      });
    }

    if (target.isCommercializable === false) {
      blockingReasons.push({
        code: 'TARGET_TEACHER_NOT_COMMERCIALIZABLE',
        message: 'Native Friend de destino não está habilitado para comercialização.',
      });
    }

    if (
      typeof target.basePriceUsd !== 'number' ||
      !Number.isFinite(target.basePriceUsd) ||
      target.basePriceUsd <= 0
    ) {
      blockingReasons.push({
        code: 'TARGET_TEACHER_BASE_PRICE_UNAVAILABLE',
        message: 'Valor-base em USD do Native Friend de destino ausente ou inválido.',
      });
    }

    if (
      typeof target.adminCommissionPercent !== 'number' ||
      !Number.isFinite(target.adminCommissionPercent) ||
      target.adminCommissionPercent < 0 ||
      target.adminCommissionPercent > 100
    ) {
      blockingReasons.push({
        code: 'TARGET_TEACHER_COMMISSION_NOT_CONFIGURED',
        message: 'Comissão administrativa do Native Friend de destino ausente ou fora do intervalo 0%–100%.',
      });
    }

    if (
      target.commissionModel !== undefined &&
      target.commissionModel !== null &&
      target.commissionModel !== '' &&
      target.commissionModel !== ALLOWED_COMMISSION_MODEL
    ) {
      blockingReasons.push({
        code: 'INVALID_COMMISSION_MODEL',
        message: `Modelo de comissão inválido ('${target.commissionModel}'). Apenas MARKUP é permitido.`,
      });
    }
  }

  const ptaxRate = input.ptax?.ptaxRate;
  if (typeof ptaxRate !== 'number' || !Number.isFinite(ptaxRate) || ptaxRate <= 0) {
    blockingReasons.push({
      code: 'PTAX_UNAVAILABLE',
      message: 'Cotação oficial PTAX D-1 ausente ou inválida. Fallback fictício é proibido.',
    });
  }

  // Check if we can compute target FIN.2C pricing quote
  const hasPricingBlock = blockingReasons.some((r) =>
    [
      'TARGET_TEACHER_INVALID',
      'TARGET_TEACHER_NOT_APPROVED',
      'TARGET_TEACHER_NOT_COMMERCIALIZABLE',
      'TARGET_TEACHER_BASE_PRICE_UNAVAILABLE',
      'TARGET_TEACHER_COMMISSION_NOT_CONFIGURED',
      'INVALID_COMMISSION_MODEL',
      'PTAX_UNAVAILABLE',
    ].includes(r.code)
  );

  let targetQuote: FinancialPricingQuote | null = null;
  let conversionPlan: SwitchConversionPlan | null = null;
  let accounting: SwitchAccountingSeparation | null = null;

  if (!hasPricingBlock) {
    targetQuote = calculateFinancialPricingQuote({
      basePriceUsd: target.basePriceUsd,
      adminCommissionPercent: target.adminCommissionPercent,
      ptaxRate: ptaxRate,
      commissionModel: ALLOWED_COMMISSION_MODEL,
      conversionBase: 'UNIT_PRICE_BRL',
    });

    if (!targetQuote.allInvariantsPassed) {
      blockingReasons.push({
        code: 'FINANCIAL_INVARIANT_VIOLATION',
        message: 'Falha nas invariantes monetárias do motor FIN.2C para o professor de destino.',
      });
    } else if (!hasAnyMissingPaidEvidence) {
      const targetPackagesTable: TargetPackagePriceSpec[] = [
        buildTargetPackageSpec(targetQuote.packages.package12),
        buildTargetPackageSpec(targetQuote.packages.package8),
        buildTargetPackageSpec(targetQuote.packages.package4),
        buildTargetPackageSpec(targetQuote.packages.package1),
      ];

      const specBySize = new Map<ApprovedPackageSize, TargetPackagePriceSpec>(
        targetPackagesTable.map((s) => [s.lessonsCount, s])
      );

      const composed = composePackagesDeterministically(budgetBrlCents, targetPackagesTable);
      const unit1PriceCents = specBySize.get(1)!.finalPriceBrlCents;

      let paidConversionOutcome: SwitchConversionPlan['paidConversionOutcome'] = 'CONVERTED';
      if (availablePaidUnitsCount === 0 || budgetBrlCents === 0) {
        paidConversionOutcome = 'NO_PAID_CREDITS';
      } else if (composed.totalLessons === 0 && budgetBrlCents > 0) {
        paidConversionOutcome = 'INSUFFICIENT_FOR_ONE_LESSON';
        if (availableCourtesyUnitsCount === 0) {
          blockingReasons.push({
            code: 'INSUFFICIENT_BUDGET_FOR_MINIMUM_LESSON',
            message: `Saldo financeiro disponível (${budgetBrlCents} centavos) é insuficiente para adquirir ao menos 1 aula avulsa do professor de destino (${unit1PriceCents} centavos).`,
            details: {
              budgetBrlCents,
              minimumLessonPriceBrlCents: unit1PriceCents,
              residualBrlCents: composed.residualBrlCents,
            },
          });
        } else {
          warnings.push({
            code: 'INSUFFICIENT_PAID_BUDGET_FOR_MINIMUM_LESSON',
            message: `Saldo financeiro pago (${budgetBrlCents} centavos) insuficiente para 1 aula paga do destino (${unit1PriceCents} centavos); o valor integral permanece preservado como resíduo e as cortesias seguem 1:1.`,
          });
        }
      }

      const plannedPaidLots: PlannedTargetPaidLotSpec[] = [];
      let lotIdxCounter = 0;
      for (const size of [12, 8, 4, 1] as const) {
        const qty = composed.counts[size];
        const spec = specBySize.get(size)!;
        for (let k = 0; k < qty; k++) {
          plannedPaidLots.push({
            lotIndex: lotIdxCounter++,
            packageSize: size,
            discountPercent: spec.discountPercent,
            totalPaidBrlCents: spec.finalPriceBrlCents,
            teacherShareBrlCents: spec.teacherShareBrlCents,
            platformRevenueBrlCents: spec.platformRevenueBrlCents,
            totalPaidUsdCents: spec.finalPriceUsdCents,
            teacherShareUsdCents: spec.teacherShareUsdCents,
            platformRevenueUsdCents: spec.platformRevenueUsdCents,
            unitCentsSchedule: spec.unitCentsSchedule.map((u) => ({ ...u })),
          });
        }
      }

      const plannedCourtesy: PlannedTargetCourtesySpec | null =
        availableCourtesyUnitsCount > 0
          ? {
              lessonsCount: availableCourtesyUnitsCount,
              totalPaidBrlCents: 0,
              teacherShareBrlCents: 0,
              platformRevenueBrlCents: 0,
              preservesOneToOne: true,
            }
          : null;

      conversionPlan = {
        targetTeacherUid: cleanTargetTeacherUid,
        ptaxRate,
        ptaxQuoteDate: input.ptax.quoteDate || null,
        ptaxPricingDate: input.ptax.pricingDate || null,
        ptaxSource: input.ptax.source || null,
        commissionModel: ALLOWED_COMMISSION_MODEL,
        targetUnitFinalPriceBrlCents: unit1PriceCents,
        targetPackagesTable,
        packageComposition: composed.lines,
        plannedPaidLots,
        plannedCourtesy,
        paidConversionOutcome,
      };

      const totalResultingLessonsCount = composed.totalLessons + availableCourtesyUnitsCount;
      const centsConservedExactly =
        composed.totalCostBrlCents + composed.residualBrlCents === budgetBrlCents &&
        composed.totalTeacherShareBrlCents + composed.totalPlatformRevenueBrlCents ===
          composed.totalCostBrlCents;

      if (!centsConservedExactly) {
        throw new SwitchConversionError(
          'Violação crítica na conservação de centavos da conversão.',
          500,
          'FINANCIAL_INVARIANT_VIOLATION'
        );
      }

      accounting = {
        originalRevenue: {
          purchasedTotalPaidBrlCents,
          purchasedTeacherShareBrlCents,
          purchasedPlatformRevenueBrlCents,
          permanentlyConsumedTotalPaidBrlCents,
          lockedScheduledTotalPaidBrlCents,
          availableOriginalTotalPaidBrlCents: budgetBrlCents,
          availableOriginalTeacherShareBrlCents,
          availableOriginalPlatformRevenueBrlCents,
          newCashCollectedBrlCents: 0,
          artificialRevenueCreatedBrlCents: 0,
        },
        convertedValue: {
          budgetBrlCents,
          convertedPaidLessonsCount: composed.totalLessons,
          preservedCourtesyLessonsCount: availableCourtesyUnitsCount,
          totalResultingLessonsCount,
          convertedTotalBrlCents: composed.totalCostBrlCents,
          convertedTotalBrl: fromCents(composed.totalCostBrlCents),
          convertedPlatformShareBrlCents: composed.totalPlatformRevenueBrlCents,
          convertedPlatformShareBrl: fromCents(composed.totalPlatformRevenueBrlCents),
          residualBrlCents: composed.residualBrlCents,
          residualBrl: fromCents(composed.residualBrlCents),
          courtesyFinancialValueBrlCents: 0,
          centsConservedExactly,
        },
        futureTeacherObligation: {
          targetTeacherUid: cleanTargetTeacherUid,
          targetFutureTeacherObligationBrlCents: composed.totalTeacherShareBrlCents,
          targetFutureTeacherObligationBrl: fromCents(composed.totalTeacherShareBrlCents),
          targetFutureTeacherObligationUsdCents: composed.totalTeacherShareUsdCents,
          courtesyTeacherObligationBrlCents: 0,
          residualTeacherObligationBrlCents: 0,
          releasedSourceTeacherObligationBrlCents: availableOriginalTeacherShareBrlCents,
          remainingLockedScheduledTeacherObligationBrlCents: remainingLockedTeacherShareBrlCents,
        },
        effectivePaymentDue: {
          studentAdditionalPaymentDueBrlCents: 0,
          immediateTargetTeacherPayoutDueBrlCents: 0,
          contingentTargetTeacherPayoutOnCompletionBrlCents: composed.totalTeacherShareBrlCents,
          sourceTeacherEarnedFromCompletedLessonsBrlCents: sourceTeacherEarnedFromCompletedBrlCents,
          sourceTeacherNonRefundedStudentFaultBrlCents: sourceTeacherNonRefundedStudentFaultBrlCents,
          releasedSwitchedUnitsPayoutDueBrlCents: 0,
        },
      };
    }
  }

  // Ensure package sizes in APPROVED_PACKAGES remain intact for audit clarity
  void APPROVED_PACKAGES;

  const blockingCodes = blockingReasons.map((r) => r.code);
  const canConvert = blockingReasons.length === 0;

  return {
    engineVersion: SWITCH_CONVERSION_ENGINE_VERSION,
    studentUid: cleanStudentUid,
    status: canConvert ? 'READY' : 'BLOCKED',
    canConvert,
    blockingReasons,
    blockingCodes,
    warnings,
    sourceAnalysis,
    targetQuote,
    conversionPlan,
    accounting,
  };
}

/**
 * Throws SwitchConversionError if conversion is blocked; otherwise returns the READY result.
 */
export function assertSwitchConversionReady(
  result: SwitchConversionResult
): SwitchConversionResult {
  if (!result.canConvert || result.status !== 'READY') {
    const primary = result.blockingReasons[0];
    throw new SwitchConversionError(
      primary?.message || 'Conversão de créditos bloqueada.',
      422,
      primary?.code || 'SWITCH_CONVERSION_BLOCKED',
      { blockingCodes: result.blockingCodes, blockingReasons: result.blockingReasons }
    );
  }
  return result;
}
