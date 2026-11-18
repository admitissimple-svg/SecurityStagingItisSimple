import crypto from 'crypto';
import type {
  CreditLot,
  CreditLotOrigin,
  CreditLotSourceType,
} from '../types';
import type { LessonPackageCalculation } from './financialEngine';

/**
 * NF.SWITCH.2A — Credit Lots Ledger Foundation
 *
 * Mandatory invariants:
 * 1. Q1 Consumption priority: courtesy -> paid -> legacy_unreconciled
 *    Deterministic tie-break inside each origin: createdAt ASC -> lotSequence ASC -> id ASC.
 * 2. Exact-lot refund: every consumed credit stamps `creditLotId` on the lesson, and refunds
 *    return +1 exclusively to that exact lot without exceeding `initialLessons`.
 * 3. Zero presumed financial attribution on `legacy_unreconciled` lots (all financial fields null).
 * 4. Single-time atomic hydration: `legacy_unreconciled` may ONLY be materialized during the
 *    student's first atomic credit initialization (when `creditLotsInitializedAt` is absent).
 *    After `creditLotsInitializedAt` is persisted, ANY divergence between `availableLessons`
 *    and the sum of `remainingLessons` across the student's `credit_lots` MUST fail immediately
 *    with `CREDIT_LEDGER_DIVERGENCE` (HTTP 409), with zero silent self-correction.
 * 5. Root collection `credit_lots`: globally unique IDs per student + operation, strict
 *    `studentUid` isolation, and transactional `activeCreditLotIds` synchronization without
 *    ever letting an incomplete `activeCreditLotIds` index hide active lots.
 */

export const CREDIT_LOT_CONSUMPTION_PRIORITY: readonly CreditLotOrigin[] = [
  'courtesy',
  'paid',
  'legacy_unreconciled',
] as const;

export const CREDIT_LEDGER_DIVERGENCE_CODE = 'CREDIT_LEDGER_DIVERGENCE';
export const CREDIT_LOT_ISOLATION_VIOLATION_CODE = 'CREDIT_LOT_ISOLATION_VIOLATION';

const ORIGIN_PRIORITY_RANK: Record<CreditLotOrigin, number> = {
  courtesy: 0,
  paid: 1,
  legacy_unreconciled: 2,
};

export class CreditLedgerError extends Error {
  public statusCode: number;
  public code: string;
  public details?: Record<string, any>;

  constructor(
    message: string,
    statusCode: number = 409,
    code: string = CREDIT_LEDGER_DIVERGENCE_CODE,
    details?: Record<string, any>
  ) {
    super(message);
    this.name = 'CreditLedgerError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

function round2(val: number): number {
  return Math.round((val + Number.EPSILON) * 100) / 100;
}

function sanitizeIdFragment(raw: string, maxLen: number): string {
  const cleaned = String(raw || '').replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_');
  return cleaned.slice(0, maxLen) || 'std';
}

export function isValidCreditLotOrigin(origin: unknown): origin is CreditLotOrigin {
  return origin === 'courtesy' || origin === 'paid' || origin === 'legacy_unreconciled';
}

/**
 * Generates a globally unique, deterministic credit lot ID scoped strictly to
 * (studentUid, kind, idempotencyKey) so identical idempotencyKeys across
 * different students can never collide in root `credit_lots`.
 */
export function buildCreditLotId(params: {
  studentUid: string;
  kind: 'paid' | 'grant' | 'adj' | 'legacy';
  idempotencyKey: string;
}): string {
  const uidPart = sanitizeIdFragment(params.studentUid, 28);
  const hash = crypto
    .createHash('sha256')
    .update(`${params.kind}:${params.studentUid}:${params.idempotencyKey}`)
    .digest('hex')
    .slice(0, 24);
  return `lot_${uidPart}_${params.kind}_${hash}`;
}

export function buildLegacyHydrationLotId(studentUid: string): string {
  return buildCreditLotId({
    studentUid,
    kind: 'legacy',
    idempotencyKey: `initial_hydration:${studentUid}`,
  });
}

function parseCreatedAtMs(createdAt: unknown): number {
  if (typeof createdAt !== 'string' || !createdAt.trim()) return 0;
  const parsed = Date.parse(createdAt);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Q1 Deterministic consumption order:
 * 1. origin priority: courtesy (0) -> paid (1) -> legacy_unreconciled (2)
 * 2. createdAt ascending (ms)
 * 3. lotSequence ascending
 * 4. id ascending (lexicographical UTF-16)
 */
export function sortCreditLotsForConsumption(lots: CreditLot[]): CreditLot[] {
  return [...lots].sort((a, b) => {
    const rankA = isValidCreditLotOrigin(a.origin) ? ORIGIN_PRIORITY_RANK[a.origin] : 99;
    const rankB = isValidCreditLotOrigin(b.origin) ? ORIGIN_PRIORITY_RANK[b.origin] : 99;
    if (rankA !== rankB) return rankA - rankB;

    const timeA = parseCreatedAtMs(a.createdAt);
    const timeB = parseCreatedAtMs(b.createdAt);
    if (timeA !== timeB) return timeA - timeB;

    const seqA = typeof a.lotSequence === 'number' && Number.isFinite(a.lotSequence) ? a.lotSequence : 0;
    const seqB = typeof b.lotSequence === 'number' && Number.isFinite(b.lotSequence) ? b.lotSequence : 0;
    if (seqA !== seqB) return seqA - seqB;

    if (a.id < b.id) return -1;
    if (a.id > b.id) return 1;
    return 0;
  });
}

export function computeActiveCreditLotIds(lots: CreditLot[]): string[] {
  return sortCreditLotsForConsumption(lots)
    .filter((lot) => lot.remainingLessons > 0)
    .map((lot) => lot.id);
}

export function sumLotRemainingLessons(lots: CreditLot[]): number {
  return lots.reduce((sum, lot) => sum + (Number.isFinite(lot.remainingLessons) ? lot.remainingLessons : 0), 0);
}

/**
 * Validates strict studentUid isolation and per-lot arithmetic integrity.
 */
export function validateCreditLotsForStudent(studentUid: string, lots: CreditLot[]): void {
  for (const lot of lots) {
    if (!lot || typeof lot !== 'object' || typeof lot.id !== 'string' || !lot.id.trim()) {
      throw new CreditLedgerError(
        'Registro de lote de crédito inválido ou sem identificador.',
        409,
        CREDIT_LEDGER_DIVERGENCE_CODE
      );
    }

    if (String(lot.studentUid || '').trim() !== studentUid) {
      throw new CreditLedgerError(
        `Violação de isolamento de lote: lote '${lot.id}' pertence a outro estudante.`,
        409,
        CREDIT_LOT_ISOLATION_VIOLATION_CODE,
        { lotId: lot.id, expectedStudentUid: studentUid, actualStudentUid: lot.studentUid }
      );
    }

    if (!isValidCreditLotOrigin(lot.origin)) {
      throw new CreditLedgerError(
        `Origem de lote de crédito inválida no lote '${lot.id}'.`,
        409,
        CREDIT_LEDGER_DIVERGENCE_CODE,
        { lotId: lot.id, origin: lot.origin }
      );
    }

    if (
      typeof lot.initialLessons !== 'number' ||
      !Number.isInteger(lot.initialLessons) ||
      lot.initialLessons < 0 ||
      typeof lot.remainingLessons !== 'number' ||
      !Number.isInteger(lot.remainingLessons) ||
      lot.remainingLessons < 0 ||
      typeof lot.consumedLessons !== 'number' ||
      !Number.isInteger(lot.consumedLessons) ||
      lot.consumedLessons < 0 ||
      lot.remainingLessons + lot.consumedLessons !== lot.initialLessons
    ) {
      throw new CreditLedgerError(
        `Inconsistência aritmética no lote de crédito '${lot.id}'.`,
        409,
        CREDIT_LEDGER_DIVERGENCE_CODE,
        {
          lotId: lot.id,
          initialLessons: lot.initialLessons,
          remainingLessons: lot.remainingLessons,
          consumedLessons: lot.consumedLessons,
        }
      );
    }
  }
}

export interface HydrationReconciliationResult {
  lots: CreditLot[];
  createdLegacyLot: CreditLot | null;
  creditLotsInitializedAt: string;
  nextLotSequence: number;
  wasFirstInitialization: boolean;
}

/**
 * Enforces single-time hydration (`creditLotsInitializedAt`):
 * - If `creditLotsInitializedAt` is NOT present:
 *     Allows materializing a single `legacy_unreconciled` lot ONLY if `beforeAvailable > lotsSum`
 *     (and forbids negative/impossible gaps if `lotsSum > beforeAvailable`).
 *     Persists `creditLotsInitializedAt = nowIso`.
 * - If `creditLotsInitializedAt` IS already present:
 *     NEVER materializes a `legacy_unreconciled` lot.
 *     Requires `beforeAvailable === lotsSum`; otherwise throws `CREDIT_LEDGER_DIVERGENCE` (HTTP 409)
 *     without silent self-correction.
 */
export function reconcileStudentCreditLedger(params: {
  studentUid: string;
  studentEmail?: string;
  studentData: Record<string, any>;
  existingLots: CreditLot[];
  beforeAvailable: number;
  nowIso: string;
}): HydrationReconciliationResult {
  const { studentUid, studentEmail, studentData, existingLots, beforeAvailable, nowIso } = params;

  const workingLots = existingLots.map((l) => ({ ...l }));
  validateCreditLotsForStudent(studentUid, workingLots);

  const lotsSum = sumLotRemainingLessons(workingLots);
  const existingInitAt =
    typeof studentData?.creditLotsInitializedAt === 'string' && studentData.creditLotsInitializedAt.trim()
      ? studentData.creditLotsInitializedAt.trim()
      : '';
  let nextSeq =
    typeof studentData?.creditLotSequence === 'number' &&
    Number.isInteger(studentData.creditLotSequence) &&
    studentData.creditLotSequence >= 0
      ? studentData.creditLotSequence
      : workingLots.reduce((max, l) => Math.max(max, Number(l.lotSequence || 0)), 0);

  if (!Number.isInteger(beforeAvailable) || beforeAvailable < 0) {
    throw new CreditLedgerError(
      `Divergência detectada no razão de créditos: saldo disponível inválido (${beforeAvailable}).`,
      409,
      CREDIT_LEDGER_DIVERGENCE_CODE,
      { beforeAvailable, lotsSum }
    );
  }

  if (existingInitAt) {
    if (beforeAvailable !== lotsSum) {
      throw new CreditLedgerError(
        `Divergência detectada no razão de créditos (CREDIT_LEDGER_DIVERGENCE): availableLessons=${beforeAvailable} difere da soma dos lotes=${lotsSum}.`,
        409,
        CREDIT_LEDGER_DIVERGENCE_CODE,
        { beforeAvailable, lotsSum, creditLotsInitializedAt: existingInitAt }
      );
    }

    return {
      lots: workingLots,
      createdLegacyLot: null,
      creditLotsInitializedAt: existingInitAt,
      nextLotSequence: nextSeq,
      wasFirstInitialization: false,
    };
  }

  // First atomic initialization for this student
  if (lotsSum > beforeAvailable) {
    throw new CreditLedgerError(
      `Divergência na inicialização do razão de créditos: soma dos lotes (${lotsSum}) excede availableLessons (${beforeAvailable}).`,
      409,
      CREDIT_LEDGER_DIVERGENCE_CODE,
      { beforeAvailable, lotsSum }
    );
  }

  let createdLegacyLot: CreditLot | null = null;
  const legacyDelta = beforeAvailable - lotsSum;
  if (legacyDelta > 0) {
    const existingLegacy = workingLots.find((l) => l.origin === 'legacy_unreconciled');
    if (existingLegacy) {
      throw new CreditLedgerError(
        `Divergência na inicialização do razão de créditos: lote legado já existente não cobre saldo (${beforeAvailable} vs ${lotsSum}).`,
        409,
        CREDIT_LEDGER_DIVERGENCE_CODE,
        { beforeAvailable, lotsSum }
      );
    }

    nextSeq += 1;
    createdLegacyLot = buildLegacyUnreconciledLotData({
      studentUid,
      studentEmail,
      lessonsCount: legacyDelta,
      lotSequence: nextSeq,
      nowIso,
    });
    workingLots.push(createdLegacyLot);
  }

  return {
    lots: workingLots,
    createdLegacyLot,
    creditLotsInitializedAt: nowIso,
    nextLotSequence: nextSeq,
    wasFirstInitialization: true,
  };
}

export function buildLegacyUnreconciledLotData(params: {
  studentUid: string;
  studentEmail?: string;
  lessonsCount: number;
  lotSequence: number;
  nowIso: string;
}): CreditLot {
  const { studentUid, studentEmail, lessonsCount, lotSequence, nowIso } = params;
  return {
    id: buildLegacyHydrationLotId(studentUid),
    studentUid,
    studentEmail: (studentEmail || '').toLowerCase().trim(),
    origin: 'legacy_unreconciled',
    sourceType: 'LEGACY_INITIAL_HYDRATION',
    status: lessonsCount > 0 ? 'active' : 'exhausted',
    initialLessons: lessonsCount,
    remainingLessons: lessonsCount,
    consumedLessons: 0,
    lotSequence,
    createdAt: nowIso,
    updatedAt: nowIso,
    exhaustedAt: lessonsCount > 0 ? null : nowIso,
    lastConsumedAt: null,
    lastRefundedAt: null,
    sourceTransactionId: null,
    idempotencyKey: null,
    // Strictly forbid presumed financial attribution on legacy_unreconciled
    pricedTeacherUid: null,
    teacherEmail: null,
    teacherName: null,
    packageName: null,
    packageLessons: null,
    isPaidPurchase: false,
    countsAsRevenue: false,
    financialAttributionStatus: 'unreconciled_no_presumed_value',
    currency: null,
    basePriceUsd: null,
    adminCommissionPercent: null,
    commissionModel: null,
    commissionVersion: null,
    ptaxRate: null,
    ptaxQuoteDate: null,
    ptaxPricingDate: null,
    ptaxSource: null,
    discountPercent: null,
    totalPaidBrl: null,
    totalPaidUsd: null,
    unitPriceBrl: null,
    unitPriceUsd: null,
    teacherShareBrl: null,
    teacherShareUsd: null,
    teacherLessonShareBrl: null,
    teacherLessonShareUsd: null,
    platformRevenueBrl: null,
    platformRevenueUsd: null,
    platformLessonRevenueBrl: null,
    platformLessonRevenueUsd: null,
    gatewayProvider: null,
    gatewayTransactionId: null,
    reason: null,
    performedByUid: null,
    performedByEmail: null,
    performedByRole: null,
  };
}

export function buildPaidPackageLotData(params: {
  studentUid: string;
  studentEmail?: string;
  lessonsCount: number;
  lotSequence: number;
  nowIso: string;
  sourceTransactionId: string;
  idempotencyKey: string;
  pricedTeacherUid: string;
  teacherEmail: string;
  teacherName: string;
  packageName: string;
  basePriceUsd: number;
  adminCommissionPercent: number;
  commissionModel: string;
  commissionVersion: number;
  ptaxRate: number;
  ptaxQuoteDate?: string;
  ptaxPricingDate?: string;
  ptaxSource?: string;
  pkgCalc: LessonPackageCalculation;
  gatewayProvider: string;
  gatewayTransactionId: string;
  performedByUid: string;
  performedByEmail: string;
  performedByRole: string;
}): CreditLot {
  const { pkgCalc, lessonsCount } = params;
  return {
    id: buildCreditLotId({
      studentUid: params.studentUid,
      kind: 'paid',
      idempotencyKey: params.idempotencyKey,
    }),
    studentUid: params.studentUid,
    studentEmail: (params.studentEmail || '').toLowerCase().trim(),
    origin: 'paid',
    sourceType: 'PACKAGE_PURCHASE',
    status: 'active',
    initialLessons: lessonsCount,
    remainingLessons: lessonsCount,
    consumedLessons: 0,
    lotSequence: params.lotSequence,
    createdAt: params.nowIso,
    updatedAt: params.nowIso,
    exhaustedAt: null,
    lastConsumedAt: null,
    lastRefundedAt: null,
    sourceTransactionId: params.sourceTransactionId,
    idempotencyKey: params.idempotencyKey,
    pricedTeacherUid: params.pricedTeacherUid,
    teacherEmail: params.teacherEmail,
    teacherName: params.teacherName,
    packageName: params.packageName,
    packageLessons: lessonsCount,
    isPaidPurchase: true,
    countsAsRevenue: true,
    financialAttributionStatus: 'paid_verified',
    currency: 'BRL',
    basePriceUsd: params.basePriceUsd,
    adminCommissionPercent: params.adminCommissionPercent,
    commissionModel: params.commissionModel,
    commissionVersion: params.commissionVersion,
    ptaxRate: params.ptaxRate,
    ptaxQuoteDate: params.ptaxQuoteDate || null,
    ptaxPricingDate: params.ptaxPricingDate || null,
    ptaxSource: params.ptaxSource || 'BACEN_PTAX_D1',
    discountPercent: pkgCalc.discountPercent,
    totalPaidBrl: pkgCalc.finalPriceBrl,
    totalPaidUsd: pkgCalc.finalPriceUsd,
    unitPriceBrl: pkgCalc.effectiveLessonPriceBrl,
    unitPriceUsd: pkgCalc.effectiveLessonPriceUsd,
    teacherShareBrl: pkgCalc.teacherShareBrl,
    teacherShareUsd: pkgCalc.teacherShareUsd,
    teacherLessonShareBrl: round2(pkgCalc.teacherShareBrl / lessonsCount),
    teacherLessonShareUsd: round2(pkgCalc.teacherShareUsd / lessonsCount),
    platformRevenueBrl: pkgCalc.platformRevenueBrl,
    platformRevenueUsd: pkgCalc.platformRevenueUsd,
    platformLessonRevenueBrl: round2(pkgCalc.platformRevenueBrl / lessonsCount),
    platformLessonRevenueUsd: round2(pkgCalc.platformRevenueUsd / lessonsCount),
    gatewayProvider: params.gatewayProvider,
    gatewayTransactionId: params.gatewayTransactionId,
    reason: null,
    performedByUid: params.performedByUid,
    performedByEmail: params.performedByEmail,
    performedByRole: params.performedByRole,
  };
}

export function buildCourtesyGrantLotData(params: {
  studentUid: string;
  studentEmail?: string;
  lessonsCount: number;
  lotSequence: number;
  nowIso: string;
  sourceTransactionId: string;
  idempotencyKey: string;
  pricedTeacherUid: string;
  teacherEmail: string;
  teacherName: string;
  packageName: string;
  performedByUid: string;
  performedByEmail: string;
  performedByRole: string;
}): CreditLot {
  return {
    id: buildCreditLotId({
      studentUid: params.studentUid,
      kind: 'grant',
      idempotencyKey: params.idempotencyKey,
    }),
    studentUid: params.studentUid,
    studentEmail: (params.studentEmail || '').toLowerCase().trim(),
    origin: 'courtesy',
    sourceType: 'ADMIN_PACKAGE_GRANT',
    status: 'active',
    initialLessons: params.lessonsCount,
    remainingLessons: params.lessonsCount,
    consumedLessons: 0,
    lotSequence: params.lotSequence,
    createdAt: params.nowIso,
    updatedAt: params.nowIso,
    exhaustedAt: null,
    lastConsumedAt: null,
    lastRefundedAt: null,
    sourceTransactionId: params.sourceTransactionId,
    idempotencyKey: params.idempotencyKey,
    pricedTeacherUid: params.pricedTeacherUid,
    teacherEmail: params.teacherEmail,
    teacherName: params.teacherName,
    packageName: params.packageName,
    packageLessons: params.lessonsCount,
    isPaidPurchase: false,
    countsAsRevenue: false,
    financialAttributionStatus: 'courtesy_non_revenue',
    currency: 'BRL',
    basePriceUsd: null,
    adminCommissionPercent: null,
    commissionModel: null,
    commissionVersion: null,
    ptaxRate: null,
    ptaxQuoteDate: null,
    ptaxPricingDate: null,
    ptaxSource: null,
    discountPercent: null,
    totalPaidBrl: 0,
    totalPaidUsd: 0,
    unitPriceBrl: 0,
    unitPriceUsd: 0,
    teacherShareBrl: 0,
    teacherShareUsd: 0,
    teacherLessonShareBrl: 0,
    teacherLessonShareUsd: 0,
    platformRevenueBrl: 0,
    platformRevenueUsd: 0,
    platformLessonRevenueBrl: 0,
    platformLessonRevenueUsd: 0,
    gatewayProvider: null,
    gatewayTransactionId: null,
    reason: null,
    performedByUid: params.performedByUid,
    performedByEmail: params.performedByEmail,
    performedByRole: params.performedByRole,
  };
}

export function buildCourtesyAdjustmentLotData(params: {
  studentUid: string;
  studentEmail?: string;
  lessonsCount: number;
  lotSequence: number;
  nowIso: string;
  sourceTransactionId: string;
  idempotencyKey: string;
  reason: string;
  performedByUid: string;
  performedByEmail: string;
}): CreditLot {
  return {
    id: buildCreditLotId({
      studentUid: params.studentUid,
      kind: 'adj',
      idempotencyKey: params.idempotencyKey,
    }),
    studentUid: params.studentUid,
    studentEmail: (params.studentEmail || '').toLowerCase().trim(),
    origin: 'courtesy',
    sourceType: 'ADMIN_CREDIT_ADJUSTMENT',
    status: 'active',
    initialLessons: params.lessonsCount,
    remainingLessons: params.lessonsCount,
    consumedLessons: 0,
    lotSequence: params.lotSequence,
    createdAt: params.nowIso,
    updatedAt: params.nowIso,
    exhaustedAt: null,
    lastConsumedAt: null,
    lastRefundedAt: null,
    sourceTransactionId: params.sourceTransactionId,
    idempotencyKey: params.idempotencyKey,
    pricedTeacherUid: null,
    teacherEmail: null,
    teacherName: null,
    packageName: null,
    packageLessons: null,
    isPaidPurchase: false,
    countsAsRevenue: false,
    financialAttributionStatus: 'courtesy_non_revenue',
    currency: 'BRL',
    basePriceUsd: null,
    adminCommissionPercent: null,
    commissionModel: null,
    commissionVersion: null,
    ptaxRate: null,
    ptaxQuoteDate: null,
    ptaxPricingDate: null,
    ptaxSource: null,
    discountPercent: null,
    totalPaidBrl: 0,
    totalPaidUsd: 0,
    unitPriceBrl: 0,
    unitPriceUsd: 0,
    teacherShareBrl: 0,
    teacherShareUsd: 0,
    teacherLessonShareBrl: 0,
    teacherLessonShareUsd: 0,
    platformRevenueBrl: 0,
    platformRevenueUsd: 0,
    platformLessonRevenueBrl: 0,
    platformLessonRevenueUsd: 0,
    gatewayProvider: null,
    gatewayTransactionId: null,
    reason: params.reason,
    performedByUid: params.performedByUid,
    performedByEmail: params.performedByEmail,
    performedByRole: 'admin',
  };
}

export interface LotConsumptionAllocation {
  lotId: string;
  origin: CreditLotOrigin;
  sourceType: CreditLotSourceType;
  units: number;
}

/**
 * Consumes `units` credits strictly following Q1 priority:
 * courtesy -> paid -> legacy_unreconciled (FIFO inside each origin).
 */
export function consumeUnitsFromLots(params: {
  lots: CreditLot[];
  units: number;
  nowIso: string;
}): {
  lots: CreditLot[];
  mutatedLots: CreditLot[];
  allocations: LotConsumptionAllocation[];
} {
  const { lots, units, nowIso } = params;
  if (!Number.isInteger(units) || units <= 0) {
    throw new CreditLedgerError(
      'Quantidade de consumo de créditos deve ser inteira positiva.',
      400,
      CREDIT_LEDGER_DIVERGENCE_CODE
    );
  }

  const totalRemaining = sumLotRemainingLessons(lots);
  if (totalRemaining < units) {
    throw new CreditLedgerError(
      `Divergência no razão de créditos: saldo em lotes (${totalRemaining}) insuficiente para consumir ${units}.`,
      409,
      CREDIT_LEDGER_DIVERGENCE_CODE,
      { totalRemaining, requestedUnits: units }
    );
  }

  const ordered = sortCreditLotsForConsumption(lots);
  const mutatedById = new Map<string, CreditLot>();
  const allocations: LotConsumptionAllocation[] = [];
  let remainingToConsume = units;

  const nextLots = ordered.map((lot) => {
    if (remainingToConsume <= 0 || lot.remainingLessons <= 0) {
      return lot;
    }
    const take = Math.min(lot.remainingLessons, remainingToConsume);
    const nextRemaining = lot.remainingLessons - take;
    const nextConsumed = lot.consumedLessons + take;
    const updated: CreditLot = {
      ...lot,
      remainingLessons: nextRemaining,
      consumedLessons: nextConsumed,
      status: nextRemaining === 0 ? 'exhausted' : 'active',
      exhaustedAt: nextRemaining === 0 ? nowIso : null,
      lastConsumedAt: nowIso,
      updatedAt: nowIso,
    };
    remainingToConsume -= take;
    mutatedById.set(updated.id, updated);
    allocations.push({
      lotId: updated.id,
      origin: updated.origin,
      sourceType: updated.sourceType,
      units: take,
    });
    return updated;
  });

  if (remainingToConsume !== 0) {
    throw new CreditLedgerError(
      'Falha ao alocar unidades de crédito nos lotes disponíveis.',
      409,
      CREDIT_LEDGER_DIVERGENCE_CODE
    );
  }

  return {
    lots: nextLots,
    mutatedLots: Array.from(mutatedById.values()),
    allocations,
  };
}

/**
 * Refunds +1 credit strictly to the exact origin lot (`targetLotId` stored on the lesson).
 * Pre-2A lessons without `targetLotId`:
 * - During first atomic initialization (`wasFirstInitialization === true`), the returned credit
 *   may hydrate into the student's `legacy_unreconciled` lot (without any financial attribution).
 * - After initialization (`wasFirstInitialization === false`), NEVER materializes a new
 *   `legacy_unreconciled` lot and requires an existing `legacy_unreconciled` lot with `consumedLessons >= 1`,
 *   otherwise raises `CREDIT_LEDGER_DIVERGENCE` (HTTP 409).
 */
export function refundUnitToExactLot(params: {
  studentUid: string;
  studentEmail?: string;
  lots: CreditLot[];
  targetLotId?: string | null;
  wasFirstInitialization: boolean;
  nextLotSequence: number;
  nowIso: string;
}): {
  lots: CreditLot[];
  refundedLot: CreditLot;
  nextLotSequence: number;
} {
  const {
    studentUid,
    studentEmail,
    lots,
    targetLotId,
    wasFirstInitialization,
    nowIso,
  } = params;
  let seq = params.nextLotSequence;
  const cleanTargetId = typeof targetLotId === 'string' ? targetLotId.trim() : '';
  const workingLots = lots.map((l) => ({ ...l }));

  if (cleanTargetId) {
    const idx = workingLots.findIndex((l) => l.id === cleanTargetId);
    if (idx < 0) {
      throw new CreditLedgerError(
        `Lote de origem '${cleanTargetId}' da aula não foi encontrado para estorno.`,
        409,
        CREDIT_LEDGER_DIVERGENCE_CODE,
        { targetLotId: cleanTargetId }
      );
    }

    const target = workingLots[idx];
    if (target.studentUid !== studentUid) {
      throw new CreditLedgerError(
        `Violação de isolamento no estorno: lote '${cleanTargetId}' não pertence ao aluno '${studentUid}'.`,
        409,
        CREDIT_LOT_ISOLATION_VIOLATION_CODE,
        { targetLotId: cleanTargetId, studentUid }
      );
    }

    if (target.consumedLessons < 1 || target.remainingLessons + 1 > target.initialLessons) {
      throw new CreditLedgerError(
        `Estorno inválido no lote '${cleanTargetId}': capacidade inicial (${target.initialLessons}) seria excedida.`,
        409,
        CREDIT_LEDGER_DIVERGENCE_CODE,
        {
          targetLotId: cleanTargetId,
          initialLessons: target.initialLessons,
          remainingLessons: target.remainingLessons,
          consumedLessons: target.consumedLessons,
        }
      );
    }

    const updated: CreditLot = {
      ...target,
      remainingLessons: target.remainingLessons + 1,
      consumedLessons: target.consumedLessons - 1,
      status: 'active',
      exhaustedAt: null,
      lastRefundedAt: nowIso,
      updatedAt: nowIso,
    };
    workingLots[idx] = updated;
    return {
      lots: workingLots,
      refundedLot: updated,
      nextLotSequence: seq,
    };
  }

  // Pre-NF.SWITCH.2A lesson (no creditLotId stamped at scheduling time)
  const legacyIdx = workingLots.findIndex((l) => l.origin === 'legacy_unreconciled');
  if (legacyIdx >= 0) {
    const legacy = workingLots[legacyIdx];
    if (legacy.consumedLessons >= 1 && legacy.remainingLessons + 1 <= legacy.initialLessons) {
      const updated: CreditLot = {
        ...legacy,
        remainingLessons: legacy.remainingLessons + 1,
        consumedLessons: legacy.consumedLessons - 1,
        status: 'active',
        exhaustedAt: null,
        lastRefundedAt: nowIso,
        updatedAt: nowIso,
      };
      workingLots[legacyIdx] = updated;
      return {
        lots: workingLots,
        refundedLot: updated,
        nextLotSequence: seq,
      };
    }

    if (wasFirstInitialization) {
      const updated: CreditLot = {
        ...legacy,
        initialLessons: legacy.initialLessons + 1,
        remainingLessons: legacy.remainingLessons + 1,
        status: 'active',
        exhaustedAt: null,
        lastRefundedAt: nowIso,
        updatedAt: nowIso,
      };
      workingLots[legacyIdx] = updated;
      return {
        lots: workingLots,
        refundedLot: updated,
        nextLotSequence: seq,
      };
    }

    throw new CreditLedgerError(
      'Divergência no estorno de aula legada pós-inicialização: lote legacy_unreconciled não possui unidade consumida para estorno.',
      409,
      CREDIT_LEDGER_DIVERGENCE_CODE,
      { studentUid }
    );
  }

  if (wasFirstInitialization) {
    seq += 1;
    const created = buildLegacyUnreconciledLotData({
      studentUid,
      studentEmail,
      lessonsCount: 1,
      lotSequence: seq,
      nowIso,
    });
    created.lastRefundedAt = nowIso;
    workingLots.push(created);
    return {
      lots: workingLots,
      refundedLot: created,
      nextLotSequence: seq,
    };
  }

  throw new CreditLedgerError(
    'Divergência no estorno após inicialização do razão de créditos: aula sem creditLotId e sem lote legacy_unreconciled elegível.',
    409,
    CREDIT_LEDGER_DIVERGENCE_CODE,
    { studentUid }
  );
}
