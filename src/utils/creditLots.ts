import crypto from 'crypto';
import type {
  CreditLot,
  CreditLotOrigin,
  CreditLotSourceType,
  CreditLotUnitLedgerEntry,
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
  kind:
    | 'paid'
    | 'grant'
    | 'adj'
    | 'legacy'
    | 'recon_paid'
    | 'recon_courtesy'
    | 'switch_paid'
    | 'switch_courtesy';
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

export function distributeCentsDeterministically(totalCents: number, unitsCount: number): number[] {
  if (!Number.isInteger(unitsCount) || unitsCount <= 0) {
    throw new CreditLedgerError(
      'Quantidade de unidades para distribuição de centavos deve ser inteira positiva.',
      400,
      CREDIT_LEDGER_DIVERGENCE_CODE
    );
  }
  if (!Number.isInteger(totalCents) || totalCents < 0) {
    throw new CreditLedgerError(
      'Valor em centavos para distribuição deve ser inteiro não negativo.',
      400,
      CREDIT_LEDGER_DIVERGENCE_CODE
    );
  }
  const base = Math.floor(totalCents / unitsCount);
  const remainder = totalCents % unitsCount;
  const result = new Array<number>(unitsCount);
  for (let i = 0; i < unitsCount; i++) {
    result[i] = base + (i < remainder ? 1 : 0);
  }
  return result;
}

function distributeCurrencySplitDeterministically(params: {
  totalCents: number | null;
  teacherCents: number | null;
  platformCents: number | null;
  unitsCount: number;
}): {
  total: Array<number | null>;
  teacher: Array<number | null>;
  platform: Array<number | null>;
} {
  const { totalCents, teacherCents, platformCents, unitsCount } = params;
  if (!Number.isInteger(unitsCount) || unitsCount <= 0) {
    throw new CreditLedgerError(
      'Quantidade de unidades para rateio em centavos deve ser inteira positiva.',
      400,
      CREDIT_LEDGER_DIVERGENCE_CODE
    );
  }

  // Coupled deterministic apportionment guarantees:
  // 1) sum(total[i]) === totalCents, sum(teacher[i]) === teacherCents, sum(platform[i]) === platformCents
  // 2) total[i] === teacher[i] + platform[i] for EVERY unit i
  // 3) Every column's per-unit values differ by at most 1 cent
  if (
    totalCents !== null &&
    teacherCents !== null &&
    platformCents !== null &&
    Number.isInteger(totalCents) &&
    Number.isInteger(teacherCents) &&
    Number.isInteger(platformCents) &&
    totalCents >= 0 &&
    teacherCents >= 0 &&
    platformCents >= 0 &&
    teacherCents + platformCents === totalCents
  ) {
    const total = distributeCentsDeterministically(totalCents, unitsCount);
    const teacher = distributeCentsDeterministically(teacherCents, unitsCount);
    const remTeacher = teacherCents % unitsCount;
    const basePlatform = Math.floor(platformCents / unitsCount);
    const remPlatform = platformCents % unitsCount;
    const platform = new Array<number>(unitsCount).fill(basePlatform);
    for (let k = 0; k < remPlatform; k++) {
      platform[(remTeacher + k) % unitsCount] += 1;
    }

    for (let i = 0; i < unitsCount; i++) {
      if (teacher[i] + platform[i] !== total[i]) {
        throw new CreditLedgerError(
          'Invariante de conservação de centavos por unidade violada no rateio.',
          409,
          CREDIT_LEDGER_DIVERGENCE_CODE,
          { unitIndex: i, totalCents, teacherCents, platformCents, unitsCount }
        );
      }
    }

    return { total, teacher, platform };
  }

  return {
    total: totalCents !== null ? distributeCentsDeterministically(totalCents, unitsCount) : new Array(unitsCount).fill(null),
    teacher: teacherCents !== null ? distributeCentsDeterministically(teacherCents, unitsCount) : new Array(unitsCount).fill(null),
    platform: platformCents !== null ? distributeCentsDeterministically(platformCents, unitsCount) : new Array(unitsCount).fill(null),
  };
}

export function buildUnitCentsSchedule(params: {
  lessonsCount: number;
  totalPaidBrlCents: number | null;
  totalPaidUsdCents: number | null;
  teacherShareBrlCents: number | null;
  teacherShareUsdCents: number | null;
  platformRevenueBrlCents: number | null;
  platformRevenueUsdCents: number | null;
}): CreditLotUnitLedgerEntry[] {
  const { lessonsCount } = params;
  if (!Number.isInteger(lessonsCount) || lessonsCount <= 0) {
    return [];
  }

  const brl = distributeCurrencySplitDeterministically({
    totalCents: params.totalPaidBrlCents,
    teacherCents: params.teacherShareBrlCents,
    platformCents: params.platformRevenueBrlCents,
    unitsCount: lessonsCount,
  });

  const usd = distributeCurrencySplitDeterministically({
    totalCents: params.totalPaidUsdCents,
    teacherCents: params.teacherShareUsdCents,
    platformCents: params.platformRevenueUsdCents,
    unitsCount: lessonsCount,
  });

  const schedule: CreditLotUnitLedgerEntry[] = [];
  for (let i = 0; i < lessonsCount; i++) {
    schedule.push({
      unitIndex: i,
      totalPaidBrlCents: brl.total[i],
      totalPaidUsdCents: usd.total[i],
      teacherShareBrlCents: brl.teacher[i],
      teacherShareUsdCents: usd.teacher[i],
      platformRevenueBrlCents: brl.platform[i],
      platformRevenueUsdCents: usd.platform[i],
    });
  }
  return schedule;
}

function buildZeroUnitCentsSchedule(lessonsCount: number): CreditLotUnitLedgerEntry[] {
  if (!Number.isInteger(lessonsCount) || lessonsCount <= 0) {
    return [];
  }
  const schedule: CreditLotUnitLedgerEntry[] = [];
  for (let i = 0; i < lessonsCount; i++) {
    schedule.push({
      unitIndex: i,
      totalPaidBrlCents: 0,
      totalPaidUsdCents: 0,
      teacherShareBrlCents: 0,
      teacherShareUsdCents: 0,
      platformRevenueBrlCents: 0,
      platformRevenueUsdCents: 0,
    });
  }
  return schedule;
}

function makeSequentialIndices(count: number, start: number = 0): number[] {
  if (!Number.isInteger(count) || count <= 0) return [];
  const out: number[] = new Array(count);
  for (let i = 0; i < count; i++) {
    out[i] = start + i;
  }
  return out;
}

function isValidDistinctNonNegativeIntArray(arr: unknown): arr is number[] {
  if (!Array.isArray(arr)) return false;
  const seen = new Set<number>();
  for (const item of arr) {
    if (typeof item !== 'number' || !Number.isInteger(item) || item < 0 || seen.has(item)) {
      return false;
    }
    seen.add(item);
  }
  return true;
}

function normalizeLotUnitIndices(lot: CreditLot): {
  availableUnitIndices: number[];
  consumedUnitIndices: number[];
} {
  const hasExplicit =
    isValidDistinctNonNegativeIntArray(lot.availableUnitIndices) &&
    isValidDistinctNonNegativeIntArray(lot.consumedUnitIndices) &&
    lot.availableUnitIndices.length === lot.remainingLessons &&
    lot.consumedUnitIndices.length === lot.consumedLessons;

  if (hasExplicit) {
    const availSet = new Set(lot.availableUnitIndices);
    const disjoint = lot.consumedUnitIndices!.every((idx) => !availSet.has(idx));
    const boundsOk =
      lot.origin === 'legacy_unreconciled' ||
      (lot.availableUnitIndices!.every((idx) => idx < lot.initialLessons) &&
        lot.consumedUnitIndices!.every((idx) => idx < lot.initialLessons));
    if (disjoint && boundsOk) {
      return {
        availableUnitIndices: [...lot.availableUnitIndices!].sort((a, b) => a - b),
        consumedUnitIndices: [...lot.consumedUnitIndices!].sort((a, b) => a - b),
      };
    }
  }

  return {
    consumedUnitIndices: makeSequentialIndices(lot.consumedLessons, 0),
    availableUnitIndices: makeSequentialIndices(lot.remainingLessons, lot.consumedLessons),
  };
}

function getEffectiveUnitScheduleForLot(lot: CreditLot): CreditLotUnitLedgerEntry[] | null {
  if (lot.origin === 'legacy_unreconciled') {
    return null;
  }
  if (Array.isArray(lot.unitCentsSchedule) && lot.unitCentsSchedule.length === lot.initialLessons) {
    return lot.unitCentsSchedule;
  }
  if (lot.initialLessons <= 0) {
    return [];
  }
  if (lot.origin === 'courtesy') {
    return buildZeroUnitCentsSchedule(lot.initialLessons);
  }
  return buildUnitCentsSchedule({
    lessonsCount: lot.initialLessons,
    totalPaidBrlCents:
      typeof lot.totalPaidBrlCents === 'number'
        ? lot.totalPaidBrlCents
        : typeof lot.totalPaidBrl === 'number'
        ? toBrlCents(lot.totalPaidBrl)
        : null,
    totalPaidUsdCents:
      typeof lot.totalPaidUsdCents === 'number'
        ? lot.totalPaidUsdCents
        : typeof lot.totalPaidUsd === 'number'
        ? toBrlCents(lot.totalPaidUsd)
        : null,
    teacherShareBrlCents:
      typeof lot.teacherShareBrlCents === 'number'
        ? lot.teacherShareBrlCents
        : typeof lot.teacherShareBrl === 'number'
        ? toBrlCents(lot.teacherShareBrl)
        : null,
    teacherShareUsdCents:
      typeof lot.teacherShareUsdCents === 'number'
        ? lot.teacherShareUsdCents
        : typeof lot.teacherShareUsd === 'number'
        ? toBrlCents(lot.teacherShareUsd)
        : null,
    platformRevenueBrlCents:
      typeof lot.platformRevenueBrlCents === 'number'
        ? lot.platformRevenueBrlCents
        : typeof lot.platformRevenueBrl === 'number'
        ? toBrlCents(lot.platformRevenueBrl)
        : null,
    platformRevenueUsdCents:
      typeof lot.platformRevenueUsdCents === 'number'
        ? lot.platformRevenueUsdCents
        : typeof lot.platformRevenueUsd === 'number'
        ? toBrlCents(lot.platformRevenueUsd)
        : null,
  });
}

function getUnitEntryForIndex(
  lot: CreditLot,
  schedule: CreditLotUnitLedgerEntry[] | null,
  unitIndex: number
): CreditLotUnitLedgerEntry {
  if (lot.origin === 'legacy_unreconciled') {
    return {
      unitIndex,
      totalPaidBrlCents: null,
      totalPaidUsdCents: null,
      teacherShareBrlCents: null,
      teacherShareUsdCents: null,
      platformRevenueBrlCents: null,
      platformRevenueUsdCents: null,
    };
  }
  if (schedule) {
    const direct = schedule[unitIndex]?.unitIndex === unitIndex
      ? schedule[unitIndex]
      : schedule.find((e) => e.unitIndex === unitIndex);
    if (direct) {
      return { ...direct };
    }
  }
  if (lot.origin === 'courtesy') {
    return {
      unitIndex,
      totalPaidBrlCents: 0,
      totalPaidUsdCents: 0,
      teacherShareBrlCents: 0,
      teacherShareUsdCents: 0,
      platformRevenueBrlCents: 0,
      platformRevenueUsdCents: 0,
    };
  }
  return {
    unitIndex,
    totalPaidBrlCents: null,
    totalPaidUsdCents: null,
    teacherShareBrlCents: null,
    teacherShareUsdCents: null,
    platformRevenueBrlCents: null,
    platformRevenueUsdCents: null,
  };
}

function sumUnitField(
  schedule: CreditLotUnitLedgerEntry[] | null,
  indices: number[],
  field: keyof Omit<CreditLotUnitLedgerEntry, 'unitIndex'>,
  lotTotal: number | null | undefined
): number | null {
  if (lotTotal === null || lotTotal === undefined || !Number.isInteger(lotTotal)) {
    return null;
  }
  if (!schedule) {
    return null;
  }
  let sum = 0;
  for (const idx of indices) {
    const entry = schedule[idx]?.unitIndex === idx ? schedule[idx] : schedule.find((e) => e.unitIndex === idx);
    const v = entry ? entry[field] : null;
    if (typeof v !== 'number' || !Number.isInteger(v)) {
      return null;
    }
    sum += v;
  }
  return sum;
}

function computeLotCentsSnapshot(
  lot: CreditLot,
  availableUnitIndices: number[],
  consumedUnitIndices: number[]
): Partial<CreditLot> {
  if (lot.origin === 'legacy_unreconciled') {
    return {
      totalPaidBrlCents: null,
      totalPaidUsdCents: null,
      teacherShareBrlCents: null,
      teacherShareUsdCents: null,
      platformRevenueBrlCents: null,
      platformRevenueUsdCents: null,
      remainingTotalPaidBrlCents: null,
      remainingTotalPaidUsdCents: null,
      remainingTeacherShareBrlCents: null,
      remainingTeacherShareUsdCents: null,
      remainingPlatformRevenueBrlCents: null,
      remainingPlatformRevenueUsdCents: null,
      consumedTotalPaidBrlCents: null,
      consumedTotalPaidUsdCents: null,
      consumedTeacherShareBrlCents: null,
      consumedTeacherShareUsdCents: null,
      consumedPlatformRevenueBrlCents: null,
      consumedPlatformRevenueUsdCents: null,
      unitCentsSchedule: null,
      availableUnitIndices,
      consumedUnitIndices,
    };
  }

  const schedule = getEffectiveUnitScheduleForLot(lot);
  const totalPaidBrlCents =
    typeof lot.totalPaidBrlCents === 'number'
      ? lot.totalPaidBrlCents
      : typeof lot.totalPaidBrl === 'number'
      ? toBrlCents(lot.totalPaidBrl)
      : lot.origin === 'courtesy'
      ? 0
      : null;
  const totalPaidUsdCents =
    typeof lot.totalPaidUsdCents === 'number'
      ? lot.totalPaidUsdCents
      : typeof lot.totalPaidUsd === 'number'
      ? toBrlCents(lot.totalPaidUsd)
      : lot.origin === 'courtesy'
      ? 0
      : null;
  const teacherShareBrlCents =
    typeof lot.teacherShareBrlCents === 'number'
      ? lot.teacherShareBrlCents
      : typeof lot.teacherShareBrl === 'number'
      ? toBrlCents(lot.teacherShareBrl)
      : lot.origin === 'courtesy'
      ? 0
      : null;
  const teacherShareUsdCents =
    typeof lot.teacherShareUsdCents === 'number'
      ? lot.teacherShareUsdCents
      : typeof lot.teacherShareUsd === 'number'
      ? toBrlCents(lot.teacherShareUsd)
      : lot.origin === 'courtesy'
      ? 0
      : null;
  const platformRevenueBrlCents =
    typeof lot.platformRevenueBrlCents === 'number'
      ? lot.platformRevenueBrlCents
      : typeof lot.platformRevenueBrl === 'number'
      ? toBrlCents(lot.platformRevenueBrl)
      : lot.origin === 'courtesy'
      ? 0
      : null;
  const platformRevenueUsdCents =
    typeof lot.platformRevenueUsdCents === 'number'
      ? lot.platformRevenueUsdCents
      : typeof lot.platformRevenueUsd === 'number'
      ? toBrlCents(lot.platformRevenueUsd)
      : lot.origin === 'courtesy'
      ? 0
      : null;

  return {
    totalPaidBrlCents,
    totalPaidUsdCents,
    teacherShareBrlCents,
    teacherShareUsdCents,
    platformRevenueBrlCents,
    platformRevenueUsdCents,
    remainingTotalPaidBrlCents: sumUnitField(schedule, availableUnitIndices, 'totalPaidBrlCents', totalPaidBrlCents),
    remainingTotalPaidUsdCents: sumUnitField(schedule, availableUnitIndices, 'totalPaidUsdCents', totalPaidUsdCents),
    remainingTeacherShareBrlCents: sumUnitField(schedule, availableUnitIndices, 'teacherShareBrlCents', teacherShareBrlCents),
    remainingTeacherShareUsdCents: sumUnitField(schedule, availableUnitIndices, 'teacherShareUsdCents', teacherShareUsdCents),
    remainingPlatformRevenueBrlCents: sumUnitField(schedule, availableUnitIndices, 'platformRevenueBrlCents', platformRevenueBrlCents),
    remainingPlatformRevenueUsdCents: sumUnitField(schedule, availableUnitIndices, 'platformRevenueUsdCents', platformRevenueUsdCents),
    consumedTotalPaidBrlCents: sumUnitField(schedule, consumedUnitIndices, 'totalPaidBrlCents', totalPaidBrlCents),
    consumedTotalPaidUsdCents: sumUnitField(schedule, consumedUnitIndices, 'totalPaidUsdCents', totalPaidUsdCents),
    consumedTeacherShareBrlCents: sumUnitField(schedule, consumedUnitIndices, 'teacherShareBrlCents', teacherShareBrlCents),
    consumedTeacherShareUsdCents: sumUnitField(schedule, consumedUnitIndices, 'teacherShareUsdCents', teacherShareUsdCents),
    consumedPlatformRevenueBrlCents: sumUnitField(schedule, consumedUnitIndices, 'platformRevenueBrlCents', platformRevenueBrlCents),
    consumedPlatformRevenueUsdCents: sumUnitField(schedule, consumedUnitIndices, 'platformRevenueUsdCents', platformRevenueUsdCents),
    unitCentsSchedule: schedule,
    availableUnitIndices,
    consumedUnitIndices,
  };
}

/**
 * Keeps `availableUnitIndices` and `consumedUnitIndices` consistent when NF.SWITCH.2B
 * reconciles `unitsReconciled` units out of a `legacy_unreconciled` lot.
 */
export function reconcileLegacyLotUnitIndices(
  legacyLot: CreditLot,
  unitsReconciled: number
): Pick<CreditLot, 'availableUnitIndices' | 'consumedUnitIndices'> {
  if (
    !Array.isArray(legacyLot.availableUnitIndices) &&
    !Array.isArray(legacyLot.consumedUnitIndices)
  ) {
    return {};
  }
  const { availableUnitIndices, consumedUnitIndices } = normalizeLotUnitIndices(legacyLot);
  return {
    availableUnitIndices: availableUnitIndices.slice(Math.max(0, unitsReconciled)),
    consumedUnitIndices,
  };
}

/**
 * Validates strict studentUid isolation, per-lot arithmetic integrity,
 * and NF.SWITCH.2C.0 unit index / cents conservation invariants.
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

    if (lot.origin === 'legacy_unreconciled') {
      const forbiddenLegacyCents = [
        lot.totalPaidBrlCents,
        lot.totalPaidUsdCents,
        lot.teacherShareBrlCents,
        lot.teacherShareUsdCents,
        lot.platformRevenueBrlCents,
        lot.platformRevenueUsdCents,
      ];
      if (forbiddenLegacyCents.some((v) => v !== undefined && v !== null)) {
        throw new CreditLedgerError(
          `Atribuição financeira indevida detectada no lote legado '${lot.id}'.`,
          409,
          CREDIT_LEDGER_DIVERGENCE_CODE,
          { lotId: lot.id }
        );
      }
    }

    if (lot.availableUnitIndices !== undefined || lot.consumedUnitIndices !== undefined) {
      if (
        !isValidDistinctNonNegativeIntArray(lot.availableUnitIndices) ||
        !isValidDistinctNonNegativeIntArray(lot.consumedUnitIndices) ||
        lot.availableUnitIndices.length !== lot.remainingLessons ||
        lot.consumedUnitIndices.length !== lot.consumedLessons
      ) {
        throw new CreditLedgerError(
          `Inconsistência nos índices unitários do lote de crédito '${lot.id}'.`,
          409,
          CREDIT_LEDGER_DIVERGENCE_CODE,
          { lotId: lot.id }
        );
      }
      const availSet = new Set(lot.availableUnitIndices);
      for (const cIdx of lot.consumedUnitIndices) {
        if (availSet.has(cIdx)) {
          throw new CreditLedgerError(
            `Índice unitário duplicado entre disponível e consumido no lote '${lot.id}'.`,
            409,
            CREDIT_LEDGER_DIVERGENCE_CODE,
            { lotId: lot.id, unitIndex: cIdx }
          );
        }
      }
      if (lot.origin !== 'legacy_unreconciled') {
        const outOfBounds =
          lot.availableUnitIndices.some((i) => i >= lot.initialLessons) ||
          lot.consumedUnitIndices.some((i) => i >= lot.initialLessons);
        if (outOfBounds) {
          throw new CreditLedgerError(
            `Índice unitário fora dos limites do lote '${lot.id}'.`,
            409,
            CREDIT_LEDGER_DIVERGENCE_CODE,
            { lotId: lot.id }
          );
        }
      }
    }

    if (lot.origin !== 'legacy_unreconciled' && Array.isArray(lot.unitCentsSchedule)) {
      if (lot.unitCentsSchedule.length !== lot.initialLessons) {
        throw new CreditLedgerError(
          `Agenda unitária de centavos inconsistente no lote '${lot.id}'.`,
          409,
          CREDIT_LEDGER_DIVERGENCE_CODE,
          { lotId: lot.id, scheduleLength: lot.unitCentsSchedule.length, initialLessons: lot.initialLessons }
        );
      }
      const fieldsToCheck: Array<{
        totalKey: keyof CreditLot;
        remKey: keyof CreditLot;
        consKey: keyof CreditLot;
        unitKey: keyof Omit<CreditLotUnitLedgerEntry, 'unitIndex'>;
      }> = [
        {
          totalKey: 'totalPaidBrlCents',
          remKey: 'remainingTotalPaidBrlCents',
          consKey: 'consumedTotalPaidBrlCents',
          unitKey: 'totalPaidBrlCents',
        },
        {
          totalKey: 'teacherShareBrlCents',
          remKey: 'remainingTeacherShareBrlCents',
          consKey: 'consumedTeacherShareBrlCents',
          unitKey: 'teacherShareBrlCents',
        },
        {
          totalKey: 'platformRevenueBrlCents',
          remKey: 'remainingPlatformRevenueBrlCents',
          consKey: 'consumedPlatformRevenueBrlCents',
          unitKey: 'platformRevenueBrlCents',
        },
        {
          totalKey: 'totalPaidUsdCents',
          remKey: 'remainingTotalPaidUsdCents',
          consKey: 'consumedTotalPaidUsdCents',
          unitKey: 'totalPaidUsdCents',
        },
        {
          totalKey: 'teacherShareUsdCents',
          remKey: 'remainingTeacherShareUsdCents',
          consKey: 'consumedTeacherShareUsdCents',
          unitKey: 'teacherShareUsdCents',
        },
        {
          totalKey: 'platformRevenueUsdCents',
          remKey: 'remainingPlatformRevenueUsdCents',
          consKey: 'consumedPlatformRevenueUsdCents',
          unitKey: 'platformRevenueUsdCents',
        },
      ];

      for (const spec of fieldsToCheck) {
        const lotTotal = lot[spec.totalKey];
        if (typeof lotTotal === 'number' && Number.isInteger(lotTotal)) {
          let scheduleSum = 0;
          for (let idx = 0; idx < lot.unitCentsSchedule.length; idx++) {
            const uVal = lot.unitCentsSchedule[idx]?.[spec.unitKey];
            if (typeof uVal !== 'number' || !Number.isInteger(uVal)) {
              throw new CreditLedgerError(
                `Entrada de centavos inválida na unidade ${idx} do lote '${lot.id}'.`,
                409,
                CREDIT_LEDGER_DIVERGENCE_CODE
              );
            }
            scheduleSum += uVal;
          }
          if (scheduleSum !== lotTotal) {
            throw new CreditLedgerError(
              `Conservação de centavos violada no lote '${lot.id}' (${String(spec.totalKey)}: ${scheduleSum} !== ${lotTotal}).`,
              409,
              CREDIT_LEDGER_DIVERGENCE_CODE
            );
          }

          const remVal = lot[spec.remKey];
          const consVal = lot[spec.consKey];
          if (typeof remVal === 'number' && typeof consVal === 'number' && remVal + consVal !== lotTotal) {
            throw new CreditLedgerError(
              `Saldo de centavos divergente no lote '${lot.id}' (${String(spec.totalKey)}: ${remVal} + ${consVal} !== ${lotTotal}).`,
              409,
              CREDIT_LEDGER_DIVERGENCE_CODE
            );
          }
        }
      }
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
    totalPaidBrlCents: null,
    totalPaidUsdCents: null,
    teacherShareBrlCents: null,
    teacherShareUsdCents: null,
    platformRevenueBrlCents: null,
    platformRevenueUsdCents: null,
    remainingTotalPaidBrlCents: null,
    remainingTotalPaidUsdCents: null,
    remainingTeacherShareBrlCents: null,
    remainingTeacherShareUsdCents: null,
    remainingPlatformRevenueBrlCents: null,
    remainingPlatformRevenueUsdCents: null,
    consumedTotalPaidBrlCents: null,
    consumedTotalPaidUsdCents: null,
    consumedTeacherShareBrlCents: null,
    consumedTeacherShareUsdCents: null,
    consumedPlatformRevenueBrlCents: null,
    consumedPlatformRevenueUsdCents: null,
    unitCentsSchedule: null,
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
  const totalPaidBrlCents = toBrlCents(pkgCalc.finalPriceBrl);
  const totalPaidUsdCents = toBrlCents(pkgCalc.finalPriceUsd);
  const teacherShareBrlCents = toBrlCents(pkgCalc.teacherShareBrl);
  const teacherShareUsdCents = toBrlCents(pkgCalc.teacherShareUsd);
  const platformRevenueBrlCents = totalPaidBrlCents - teacherShareBrlCents;
  const platformRevenueUsdCents = totalPaidUsdCents - teacherShareUsdCents;
  const unitCentsSchedule = buildUnitCentsSchedule({
    lessonsCount,
    totalPaidBrlCents,
    totalPaidUsdCents,
    teacherShareBrlCents,
    teacherShareUsdCents,
    platformRevenueBrlCents,
    platformRevenueUsdCents,
  });
  const availableUnitIndices = makeSequentialIndices(lessonsCount, 0);

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
    totalPaidBrlCents,
    totalPaidUsdCents,
    teacherShareBrlCents,
    teacherShareUsdCents,
    platformRevenueBrlCents,
    platformRevenueUsdCents,
    remainingTotalPaidBrlCents: totalPaidBrlCents,
    remainingTotalPaidUsdCents: totalPaidUsdCents,
    remainingTeacherShareBrlCents: teacherShareBrlCents,
    remainingTeacherShareUsdCents: teacherShareUsdCents,
    remainingPlatformRevenueBrlCents: platformRevenueBrlCents,
    remainingPlatformRevenueUsdCents: platformRevenueUsdCents,
    consumedTotalPaidBrlCents: 0,
    consumedTotalPaidUsdCents: 0,
    consumedTeacherShareBrlCents: 0,
    consumedTeacherShareUsdCents: 0,
    consumedPlatformRevenueBrlCents: 0,
    consumedPlatformRevenueUsdCents: 0,
    unitCentsSchedule,
    availableUnitIndices,
    consumedUnitIndices: [],
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
  const unitCentsSchedule = buildZeroUnitCentsSchedule(params.lessonsCount);
  const availableUnitIndices = makeSequentialIndices(params.lessonsCount, 0);

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
    totalPaidBrlCents: 0,
    totalPaidUsdCents: 0,
    teacherShareBrlCents: 0,
    teacherShareUsdCents: 0,
    platformRevenueBrlCents: 0,
    platformRevenueUsdCents: 0,
    remainingTotalPaidBrlCents: 0,
    remainingTotalPaidUsdCents: 0,
    remainingTeacherShareBrlCents: 0,
    remainingTeacherShareUsdCents: 0,
    remainingPlatformRevenueBrlCents: 0,
    remainingPlatformRevenueUsdCents: 0,
    consumedTotalPaidBrlCents: 0,
    consumedTotalPaidUsdCents: 0,
    consumedTeacherShareBrlCents: 0,
    consumedTeacherShareUsdCents: 0,
    consumedPlatformRevenueBrlCents: 0,
    consumedPlatformRevenueUsdCents: 0,
    unitCentsSchedule,
    availableUnitIndices,
    consumedUnitIndices: [],
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
  const unitCentsSchedule = buildZeroUnitCentsSchedule(params.lessonsCount);
  const availableUnitIndices = makeSequentialIndices(params.lessonsCount, 0);

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
    totalPaidBrlCents: 0,
    totalPaidUsdCents: 0,
    teacherShareBrlCents: 0,
    teacherShareUsdCents: 0,
    platformRevenueBrlCents: 0,
    platformRevenueUsdCents: 0,
    remainingTotalPaidBrlCents: 0,
    remainingTotalPaidUsdCents: 0,
    remainingTeacherShareBrlCents: 0,
    remainingTeacherShareUsdCents: 0,
    remainingPlatformRevenueBrlCents: 0,
    remainingPlatformRevenueUsdCents: 0,
    consumedTotalPaidBrlCents: 0,
    consumedTotalPaidUsdCents: 0,
    consumedTeacherShareBrlCents: 0,
    consumedTeacherShareUsdCents: 0,
    consumedPlatformRevenueBrlCents: 0,
    consumedPlatformRevenueUsdCents: 0,
    unitCentsSchedule,
    availableUnitIndices,
    consumedUnitIndices: [],
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
  unitIndices: number[];
  unitAllocations: CreditLotUnitLedgerEntry[];
  totalPaidBrlCents: number | null;
  totalPaidUsdCents: number | null;
  teacherShareBrlCents: number | null;
  teacherShareUsdCents: number | null;
  platformRevenueBrlCents: number | null;
  platformRevenueUsdCents: number | null;
}

function sumUnitAllocationField(
  entries: CreditLotUnitLedgerEntry[],
  field: keyof Omit<CreditLotUnitLedgerEntry, 'unitIndex'>
): number | null {
  let sum = 0;
  for (const e of entries) {
    const val = e[field];
    if (typeof val !== 'number' || !Number.isInteger(val)) {
      return null;
    }
    sum += val;
  }
  return sum;
}

/**
 * Consumes `units` credits strictly following Q1 priority:
 * courtesy -> paid -> legacy_unreconciled (FIFO inside each origin).
 * Deterministically assigns lowest available stable `unitIndex` per unit consumed.
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
    const { availableUnitIndices, consumedUnitIndices } = normalizeLotUnitIndices(lot);
    if (availableUnitIndices.length < take) {
      throw new CreditLedgerError(
        `Divergência nos índices disponíveis do lote '${lot.id}'.`,
        409,
        CREDIT_LEDGER_DIVERGENCE_CODE,
        { lotId: lot.id, availableIndices: availableUnitIndices.length, requested: take }
      );
    }

    const takenIndices = availableUnitIndices.slice(0, take);
    const nextAvailableIndices = availableUnitIndices.slice(take);
    const nextConsumedIndices = [...consumedUnitIndices, ...takenIndices].sort((a, b) => a - b);

    const schedule = getEffectiveUnitScheduleForLot(lot);
    const unitAllocations = takenIndices.map((idx) => getUnitEntryForIndex(lot, schedule, idx));
    const centsSnapshot = computeLotCentsSnapshot(lot, nextAvailableIndices, nextConsumedIndices);

    const nextRemaining = lot.remainingLessons - take;
    const nextConsumed = lot.consumedLessons + take;
    const updated: CreditLot = {
      ...lot,
      ...centsSnapshot,
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
      unitIndices: takenIndices,
      unitAllocations,
      totalPaidBrlCents: sumUnitAllocationField(unitAllocations, 'totalPaidBrlCents'),
      totalPaidUsdCents: sumUnitAllocationField(unitAllocations, 'totalPaidUsdCents'),
      teacherShareBrlCents: sumUnitAllocationField(unitAllocations, 'teacherShareBrlCents'),
      teacherShareUsdCents: sumUnitAllocationField(unitAllocations, 'teacherShareUsdCents'),
      platformRevenueBrlCents: sumUnitAllocationField(unitAllocations, 'platformRevenueBrlCents'),
      platformRevenueUsdCents: sumUnitAllocationField(unitAllocations, 'platformRevenueUsdCents'),
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
 * Refunds +1 credit strictly to the exact origin lot (`targetLotId`) and exact unit index
 * (`targetUnitIndex` when stored on the lesson).
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
  targetUnitIndex?: number | null;
  wasFirstInitialization: boolean;
  nextLotSequence: number;
  nowIso: string;
}): {
  lots: CreditLot[];
  refundedLot: CreditLot;
  refundedUnitIndex: number;
  refundedUnitCents: CreditLotUnitLedgerEntry;
  nextLotSequence: number;
} {
  const {
    studentUid,
    studentEmail,
    lots,
    targetLotId,
    targetUnitIndex,
    wasFirstInitialization,
    nowIso,
  } = params;
  let seq = params.nextLotSequence;
  const cleanTargetId = typeof targetLotId === 'string' ? targetLotId.trim() : '';
  const hasExplicitUnitIndex = typeof targetUnitIndex === 'number' && Number.isInteger(targetUnitIndex);
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

    const { availableUnitIndices, consumedUnitIndices } = normalizeLotUnitIndices(target);
    let resolvedUnitIndex: number;

    if (hasExplicitUnitIndex) {
      const requestedUnit = targetUnitIndex as number;
      const outOfBounds =
        requestedUnit < 0 ||
        (target.origin !== 'legacy_unreconciled' && requestedUnit >= target.initialLessons);
      if (outOfBounds) {
        throw new CreditLedgerError(
          `Estorno inválido no lote '${cleanTargetId}': índice unitário ${requestedUnit} fora dos limites.`,
          409,
          CREDIT_LEDGER_DIVERGENCE_CODE,
          { targetLotId: cleanTargetId, targetUnitIndex: requestedUnit }
        );
      }
      if (!consumedUnitIndices.includes(requestedUnit) || availableUnitIndices.includes(requestedUnit)) {
        throw new CreditLedgerError(
          `Estorno inválido no lote '${cleanTargetId}': índice unitário ${requestedUnit} não está consumido ou já foi estornado.`,
          409,
          CREDIT_LEDGER_DIVERGENCE_CODE,
          { targetLotId: cleanTargetId, targetUnitIndex: requestedUnit }
        );
      }
      resolvedUnitIndex = requestedUnit;
    } else {
      if (consumedUnitIndices.length === 0) {
        throw new CreditLedgerError(
          `Estorno inválido no lote '${cleanTargetId}': nenhuma unidade consumida disponível para estorno.`,
          409,
          CREDIT_LEDGER_DIVERGENCE_CODE,
          { targetLotId: cleanTargetId }
        );
      }
      resolvedUnitIndex = consumedUnitIndices[consumedUnitIndices.length - 1];
    }

    const nextConsumedIndices = consumedUnitIndices.filter((i) => i !== resolvedUnitIndex);
    const nextAvailableIndices = [...availableUnitIndices, resolvedUnitIndex].sort((a, b) => a - b);
    const schedule = getEffectiveUnitScheduleForLot(target);
    const refundedUnitCents = getUnitEntryForIndex(target, schedule, resolvedUnitIndex);
    const centsSnapshot = computeLotCentsSnapshot(target, nextAvailableIndices, nextConsumedIndices);

    const updated: CreditLot = {
      ...target,
      ...centsSnapshot,
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
      refundedUnitIndex: resolvedUnitIndex,
      refundedUnitCents,
      nextLotSequence: seq,
    };
  }

  // Pre-NF.SWITCH.2A lesson (no creditLotId stamped at scheduling time)
  const legacyIdx = workingLots.findIndex((l) => l.origin === 'legacy_unreconciled');
  if (legacyIdx >= 0) {
    const legacy = workingLots[legacyIdx];
    const { availableUnitIndices, consumedUnitIndices } = normalizeLotUnitIndices(legacy);

    if (legacy.consumedLessons >= 1 && legacy.remainingLessons + 1 <= legacy.initialLessons) {
      const resolvedUnitIndex =
        consumedUnitIndices.length > 0 ? consumedUnitIndices[consumedUnitIndices.length - 1] : 0;
      const nextConsumedIndices = consumedUnitIndices.filter((i) => i !== resolvedUnitIndex);
      const nextAvailableIndices = [...availableUnitIndices, resolvedUnitIndex].sort((a, b) => a - b);
      const hasTracking =
        Array.isArray(legacy.availableUnitIndices) || Array.isArray(legacy.consumedUnitIndices);

      const updated: CreditLot = {
        ...legacy,
        ...(hasTracking
          ? {
              availableUnitIndices: nextAvailableIndices,
              consumedUnitIndices: nextConsumedIndices,
            }
          : {}),
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
        refundedUnitIndex: resolvedUnitIndex,
        refundedUnitCents: getUnitEntryForIndex(updated, null, resolvedUnitIndex),
        nextLotSequence: seq,
      };
    }

    if (wasFirstInitialization) {
      const maxExisting = Math.max(-1, ...availableUnitIndices, ...consumedUnitIndices);
      const addedUnitIndex = Math.max(legacy.initialLessons, maxExisting + 1);
      const hasTracking =
        Array.isArray(legacy.availableUnitIndices) || Array.isArray(legacy.consumedUnitIndices);
      const updated: CreditLot = {
        ...legacy,
        ...(hasTracking
          ? {
              availableUnitIndices: [...availableUnitIndices, addedUnitIndex].sort((a, b) => a - b),
              consumedUnitIndices,
            }
          : {}),
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
        refundedUnitIndex: addedUnitIndex,
        refundedUnitCents: getUnitEntryForIndex(updated, null, addedUnitIndex),
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
      refundedUnitIndex: 0,
      refundedUnitCents: getUnitEntryForIndex(created, null, 0),
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

// ============================================================================
// NF.SWITCH.2B — CONTROLLED ADMINISTRATIVE RECONCILIATION HELPERS
// ============================================================================

export function toBrlCents(val: number): number {
  if (!Number.isFinite(val)) return 0;
  return Math.round((val + Number.EPSILON) * 100);
}

export function fromBrlCents(cents: number): number {
  if (!Number.isFinite(cents)) return 0;
  return Math.round(cents) / 100;
}

function toFinitePositive(val: unknown): number | null {
  if (typeof val === 'number' && Number.isFinite(val) && val > 0) return val;
  if (typeof val === 'string' && val.trim() !== '') {
    const parsed = Number(val.trim());
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return null;
}

function toFiniteNonNegative(val: unknown): number | null {
  if (typeof val === 'number' && Number.isFinite(val) && val >= 0) return val;
  if (typeof val === 'string' && val.trim() !== '') {
    const parsed = Number(val.trim());
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return null;
}

export interface EvaluatedHistoricalEvidence {
  eligible: boolean;
  ineligibilityCode: string | null;
  ineligibilityReason: string | null;
  transactionId: string;
  studentUid: string | null;
  studentEmail: string | null;
  teacherUid: string | null;
  teacherEmail: string | null;
  teacherName: string | null;
  packageName: string | null;
  lessonsCount: number;
  totalPaidBrl: number | null;
  totalPaidUsd: number | null;
  unitPriceBrl: number | null;
  unitPriceUsd: number | null;
  basePriceUsd: number | null;
  adminCommissionPercent: number | null;
  commissionModel: string | null;
  commissionVersion: number | null;
  ptaxRate: number | null;
  ptaxQuoteDate: string | null;
  ptaxPricingDate: string | null;
  ptaxSource: string | null;
  discountPercent: number | null;
  teacherShareBrl: number | null;
  teacherShareUsd: number | null;
  platformRevenueBrl: number | null;
  platformRevenueUsd: number | null;
  gatewayProvider: string | null;
  gatewayTransactionId: string | null;
  gatewayVerified: boolean;
  alreadyBackedLessons: number;
  remainingBackableLessons: number;
  alreadyBackedBrlCents: number;
  remainingBackableBrlCents: number;
}

/**
 * Evaluates a historical `financial_transactions` document as verifiable paid evidence
 * without ever inventing price, PTAX, commission, teacher, or revenue.
 */
export function evaluateHistoricalTransactionEvidence(params: {
  tx: Record<string, any> | null | undefined;
  transactionId: string;
  targetStudentUid: string;
  targetStudentEmail?: string;
  alreadyBackedLessons: number;
  alreadyBackedBrlCents: number;
}): EvaluatedHistoricalEvidence {
  const { tx, transactionId, targetStudentUid, targetStudentEmail, alreadyBackedLessons, alreadyBackedBrlCents } = params;
  const cleanTargetEmail = (targetStudentEmail || '').toLowerCase().trim();

  const emptyBase: EvaluatedHistoricalEvidence = {
    eligible: false,
    ineligibilityCode: 'EVIDENCE_NOT_FOUND',
    ineligibilityReason: 'Transação financeira histórica não encontrada.',
    transactionId,
    studentUid: null,
    studentEmail: null,
    teacherUid: null,
    teacherEmail: null,
    teacherName: null,
    packageName: null,
    lessonsCount: 0,
    totalPaidBrl: null,
    totalPaidUsd: null,
    unitPriceBrl: null,
    unitPriceUsd: null,
    basePriceUsd: null,
    adminCommissionPercent: null,
    commissionModel: null,
    commissionVersion: null,
    ptaxRate: null,
    ptaxQuoteDate: null,
    ptaxPricingDate: null,
    ptaxSource: null,
    discountPercent: null,
    teacherShareBrl: null,
    teacherShareUsd: null,
    platformRevenueBrl: null,
    platformRevenueUsd: null,
    gatewayProvider: null,
    gatewayTransactionId: null,
    gatewayVerified: false,
    alreadyBackedLessons: Math.max(0, alreadyBackedLessons || 0),
    remainingBackableLessons: 0,
    alreadyBackedBrlCents: Math.max(0, alreadyBackedBrlCents || 0),
    remainingBackableBrlCents: 0,
  };

  if (!tx || typeof tx !== 'object') {
    return emptyBase;
  }

  const txStudentUid = typeof tx.studentUid === 'string' && tx.studentUid.trim() ? tx.studentUid.trim() : null;
  const txStudentEmail = typeof tx.studentEmail === 'string' && tx.studentEmail.trim() ? tx.studentEmail.toLowerCase().trim() : null;
  const txTeacherUid =
    (typeof tx.teacherUid === 'string' && tx.teacherUid.trim()) ||
    (typeof tx.tutorUid === 'string' && tx.tutorUid.trim()) ||
    null;
  const txTeacherEmail =
    (typeof tx.teacherEmail === 'string' && tx.teacherEmail.trim() && tx.teacherEmail.toLowerCase().trim()) ||
    (typeof tx.tutorEmail === 'string' && tx.tutorEmail.trim() && tx.tutorEmail.toLowerCase().trim()) ||
    null;
  const txTeacherName = typeof tx.teacherName === 'string' && tx.teacherName.trim() ? tx.teacherName.trim() : null;

  const rawLessons =
    toFinitePositive(tx.lessonsAdded) ??
    toFinitePositive(tx.packageLessons) ??
    toFinitePositive(tx.delta);
  const lessonsCount = rawLessons !== null && Number.isInteger(rawLessons) ? rawLessons : 0;

  const totalPaidBrlRaw =
    toFinitePositive(tx.finalPriceBrl) ??
    toFinitePositive(tx.revenueBrl) ??
    toFinitePositive(tx.packagePriceBrl) ??
    toFinitePositive(tx.amountBrl);
  const totalPaidBrl = totalPaidBrlRaw !== null ? round2(totalPaidBrlRaw) : null;

  const totalPaidUsdRaw =
    toFinitePositive(tx.finalPriceUsd) ??
    toFinitePositive(tx.revenueUsd) ??
    toFinitePositive(tx.packagePriceUsd) ??
    toFinitePositive(tx.amountUsd);
  const totalPaidUsd = totalPaidUsdRaw !== null ? round2(totalPaidUsdRaw) : null;

  const unitPriceBrl =
    toFinitePositive(tx.effectiveLessonPriceBrl) ??
    toFinitePositive(tx.unitFinalPriceBrl) ??
    (totalPaidBrl !== null && lessonsCount > 0 ? round2(totalPaidBrl / lessonsCount) : null);

  const unitPriceUsd =
    toFinitePositive(tx.effectiveLessonPriceUsd) ??
    toFinitePositive(tx.unitFinalPriceUsd) ??
    (totalPaidUsd !== null && lessonsCount > 0 ? round2(totalPaidUsd / lessonsCount) : null);

  const basePriceUsd = toFinitePositive(tx.basePriceUsd);
  const adminCommissionPercent = toFiniteNonNegative(tx.adminCommissionPercent);
  const commissionModel = typeof tx.commissionModel === 'string' && tx.commissionModel.trim() ? tx.commissionModel.trim() : null;
  const commissionVersion =
    typeof tx.commissionVersion === 'number' && Number.isInteger(tx.commissionVersion) ? tx.commissionVersion : null;
  const ptaxRate = toFinitePositive(tx.ptaxRate);
  const ptaxQuoteDate = typeof tx.ptaxQuoteDate === 'string' && tx.ptaxQuoteDate.trim() ? tx.ptaxQuoteDate.trim() : null;
  const ptaxPricingDate = typeof tx.ptaxPricingDate === 'string' && tx.ptaxPricingDate.trim() ? tx.ptaxPricingDate.trim() : null;
  const ptaxSource = typeof tx.ptaxSource === 'string' && tx.ptaxSource.trim() ? tx.ptaxSource.trim() : null;
  const discountPercent = toFiniteNonNegative(tx.discountPercent);
  const teacherShareBrl = toFiniteNonNegative(tx.teacherShareBrl);
  const teacherShareUsd = toFiniteNonNegative(tx.teacherShareUsd);
  const platformRevenueBrl = toFiniteNonNegative(tx.platformRevenueBrl);
  const platformRevenueUsd = toFiniteNonNegative(tx.platformRevenueUsd);
  const gatewayProvider = typeof tx.gatewayProvider === 'string' && tx.gatewayProvider.trim() ? tx.gatewayProvider.trim() : null;
  const gatewayTransactionId =
    typeof tx.gatewayTransactionId === 'string' && tx.gatewayTransactionId.trim() ? tx.gatewayTransactionId.trim() : null;
  const gatewayVerified = tx.gatewayVerified === true;

  const totalBrlCents = totalPaidBrl !== null ? toBrlCents(totalPaidBrl) : 0;
  const backedLessons = Math.max(0, alreadyBackedLessons || 0);
  const backedBrlCents = Math.max(0, alreadyBackedBrlCents || 0);
  const remainingLessons = Math.max(0, lessonsCount - backedLessons);
  const remainingBrlCents = Math.max(0, totalBrlCents - backedBrlCents);

  const base: EvaluatedHistoricalEvidence = {
    ...emptyBase,
    studentUid: txStudentUid,
    studentEmail: txStudentEmail,
    teacherUid: txTeacherUid,
    teacherEmail: txTeacherEmail,
    teacherName: txTeacherName,
    packageName: typeof tx.packageName === 'string' && tx.packageName.trim() ? tx.packageName.trim() : null,
    lessonsCount,
    totalPaidBrl,
    totalPaidUsd,
    unitPriceBrl,
    unitPriceUsd,
    basePriceUsd,
    adminCommissionPercent,
    commissionModel,
    commissionVersion,
    ptaxRate,
    ptaxQuoteDate,
    ptaxPricingDate,
    ptaxSource,
    discountPercent,
    teacherShareBrl: teacherShareBrl !== null ? round2(teacherShareBrl) : null,
    teacherShareUsd: teacherShareUsd !== null ? round2(teacherShareUsd) : null,
    platformRevenueBrl: platformRevenueBrl !== null ? round2(platformRevenueBrl) : null,
    platformRevenueUsd: platformRevenueUsd !== null ? round2(platformRevenueUsd) : null,
    gatewayProvider,
    gatewayTransactionId,
    gatewayVerified,
    alreadyBackedLessons: backedLessons,
    remainingBackableLessons: remainingLessons,
    alreadyBackedBrlCents: backedBrlCents,
    remainingBackableBrlCents: remainingBrlCents,
  };

  const statusLower = String(tx.status || 'completed').toLowerCase().trim();
  if (['cancelled', 'refunded', 'void', 'failed', 'pending'].includes(statusLower)) {
    return {
      ...base,
      eligible: false,
      ineligibilityCode: 'EVIDENCE_INVALID_STATUS',
      ineligibilityReason: `Transação possui status '${statusLower}' e não pode lastrear créditos pagos.`,
    };
  }

  if (
    tx.isAdministrativeOperation === true ||
    tx.type === 'ADMIN_PACKAGE_GRANT' ||
    tx.type === 'ADMIN_CREDIT_ADJUSTMENT' ||
    tx.type === 'LEGACY_CREDIT_RECONCILIATION' ||
    tx.category === 'administrative_package_grant' ||
    tx.category === 'administrative_adjustment' ||
    tx.category === 'legacy_credit_reconciliation'
  ) {
    return {
      ...base,
      eligible: false,
      ineligibilityCode: 'EVIDENCE_ADMIN_NON_REVENUE',
      ineligibilityReason: 'Operação administrativa sem receita não pode lastrear créditos pagos.',
    };
  }

  if (tx.isPaidPurchase !== true || tx.countsAsRevenue !== true) {
    return {
      ...base,
      eligible: false,
      ineligibilityCode: 'INSUFFICIENT_FINANCIAL_EVIDENCE',
      ineligibilityReason: 'Transação não possui confirmação de compra paga (isPaidPurchase/countsAsRevenue).',
    };
  }

  const hasVerifiableOrigin = Boolean(
    tx.type === 'PACKAGE_PURCHASE' ||
    gatewayVerified ||
    (gatewayProvider && gatewayTransactionId)
  );
  if (!hasVerifiableOrigin) {
    return {
      ...base,
      eligible: false,
      ineligibilityCode: 'INSUFFICIENT_FINANCIAL_EVIDENCE',
      ineligibilityReason: 'Transação sem origem verificável (PACKAGE_PURCHASE ou gateway confirmado).',
    };
  }

  // Student ownership validation
  if (txStudentUid) {
    if (txStudentUid !== targetStudentUid) {
      return {
        ...base,
        eligible: false,
        ineligibilityCode: 'EVIDENCE_STUDENT_MISMATCH',
        ineligibilityReason: 'Transação financeira pertence a outro aluno.',
      };
    }
  } else if (!txStudentEmail || !cleanTargetEmail || txStudentEmail !== cleanTargetEmail) {
    return {
      ...base,
      eligible: false,
      ineligibilityCode: 'EVIDENCE_STUDENT_MISMATCH',
      ineligibilityReason: 'Transação financeira sem vínculo comprovado com este aluno.',
    };
  }

  if (lessonsCount <= 0) {
    return {
      ...base,
      eligible: false,
      ineligibilityCode: 'INSUFFICIENT_FINANCIAL_EVIDENCE',
      ineligibilityReason: 'Quantidade de aulas da evidência ausente ou inválida.',
    };
  }

  if (totalPaidBrl === null || totalPaidBrl <= 0) {
    return {
      ...base,
      eligible: false,
      ineligibilityCode: 'INSUFFICIENT_FINANCIAL_EVIDENCE',
      ineligibilityReason: 'Valor pago em BRL ausente ou zerado na evidência financeira.',
    };
  }

  if (!txTeacherUid) {
    return {
      ...base,
      eligible: false,
      ineligibilityCode: 'INSUFFICIENT_FINANCIAL_EVIDENCE',
      ineligibilityReason: 'Professor responsável (teacherUid) ausente na evidência financeira.',
    };
  }

  if (remainingLessons <= 0 || remainingBrlCents <= 0) {
    return {
      ...base,
      eligible: false,
      ineligibilityCode: 'FINANCIAL_EVIDENCE_EXHAUSTED',
      ineligibilityReason: 'Evidência financeira já teve 100% de sua quantidade/valor utilizado para lastrear créditos.',
    };
  }

  return {
    ...base,
    eligible: true,
    ineligibilityCode: null,
    ineligibilityReason: null,
  };
}

/**
 * Remainder-safe proportional cents allocation ensuring sum across partial reconciliations
 * never exceeds the recorded total cents on the historical transaction.
 */
export function allocateProportionalCents(params: {
  totalEvidenceCents: number;
  alreadyAllocatedCents: number;
  remainingEvidenceLessonsBefore: number;
  unitsToAllocate: number;
}): number {
  const { totalEvidenceCents, alreadyAllocatedCents, remainingEvidenceLessonsBefore, unitsToAllocate } = params;
  const remCents = Math.max(0, totalEvidenceCents - alreadyAllocatedCents);
  if (remCents <= 0 || remainingEvidenceLessonsBefore <= 0 || unitsToAllocate <= 0) return 0;
  if (unitsToAllocate >= remainingEvidenceLessonsBefore) {
    return remCents;
  }
  const proportional = Math.round((remCents * unitsToAllocate) / remainingEvidenceLessonsBefore);
  return Math.max(0, Math.min(remCents, proportional));
}

export function buildReconciledPaidLotData(params: {
  studentUid: string;
  studentEmail?: string;
  lessonsCount: number;
  lotSequence: number;
  nowIso: string;
  idempotencyKey: string;
  allocationIndex: number;
  reconciledFromLotId: string;
  reconciliationAuditId: string;
  sourceTransactionId: string;
  pricedTeacherUid: string;
  teacherEmail: string;
  teacherName: string;
  packageName: string | null;
  packageLessons: number;
  basePriceUsd: number | null;
  adminCommissionPercent: number | null;
  commissionModel: string | null;
  commissionVersion: number | null;
  ptaxRate: number | null;
  ptaxQuoteDate: string | null;
  ptaxPricingDate: string | null;
  ptaxSource: string | null;
  discountPercent: number | null;
  totalPaidBrl: number;
  totalPaidUsd: number | null;
  unitPriceBrl: number;
  unitPriceUsd: number | null;
  teacherShareBrl: number | null;
  teacherShareUsd: number | null;
  platformRevenueBrl: number | null;
  platformRevenueUsd: number | null;
  gatewayProvider: string | null;
  gatewayTransactionId: string | null;
  justification: string;
  performedByUid: string;
  performedByEmail: string;
}): CreditLot {
  const { lessonsCount } = params;
  const totalPaidBrlCents = toBrlCents(params.totalPaidBrl);
  const totalPaidUsdCents = params.totalPaidUsd !== null ? toBrlCents(params.totalPaidUsd) : null;
  const teacherShareBrlCents = params.teacherShareBrl !== null ? toBrlCents(params.teacherShareBrl) : null;
  const teacherShareUsdCents = params.teacherShareUsd !== null ? toBrlCents(params.teacherShareUsd) : null;
  const platformRevenueBrlCents =
    params.platformRevenueBrl !== null ? toBrlCents(params.platformRevenueBrl) : null;
  const platformRevenueUsdCents =
    params.platformRevenueUsd !== null ? toBrlCents(params.platformRevenueUsd) : null;

  const unitCentsSchedule = buildUnitCentsSchedule({
    lessonsCount,
    totalPaidBrlCents,
    totalPaidUsdCents,
    teacherShareBrlCents,
    teacherShareUsdCents,
    platformRevenueBrlCents,
    platformRevenueUsdCents,
  });
  const availableUnitIndices = makeSequentialIndices(lessonsCount, 0);

  return {
    id: buildCreditLotId({
      studentUid: params.studentUid,
      kind: 'recon_paid',
      idempotencyKey: `${params.idempotencyKey}:alloc:${params.allocationIndex}`,
    }),
    studentUid: params.studentUid,
    studentEmail: (params.studentEmail || '').toLowerCase().trim(),
    origin: 'paid',
    sourceType: 'LEGACY_RECONCILIATION_PAID',
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
    teacherEmail: params.teacherEmail || null,
    teacherName: params.teacherName || null,
    packageName: params.packageName,
    packageLessons: params.packageLessons,
    isPaidPurchase: true,
    countsAsRevenue: true,
    financialAttributionStatus: 'paid_verified',
    currency: 'BRL',
    basePriceUsd: params.basePriceUsd,
    adminCommissionPercent: params.adminCommissionPercent,
    commissionModel: params.commissionModel,
    commissionVersion: params.commissionVersion,
    ptaxRate: params.ptaxRate,
    ptaxQuoteDate: params.ptaxQuoteDate,
    ptaxPricingDate: params.ptaxPricingDate,
    ptaxSource: params.ptaxSource,
    discountPercent: params.discountPercent,
    totalPaidBrl: params.totalPaidBrl,
    totalPaidUsd: params.totalPaidUsd,
    unitPriceBrl: params.unitPriceBrl,
    unitPriceUsd: params.unitPriceUsd,
    teacherShareBrl: params.teacherShareBrl,
    teacherShareUsd: params.teacherShareUsd,
    teacherLessonShareBrl:
      params.teacherShareBrl !== null && lessonsCount > 0 ? round2(params.teacherShareBrl / lessonsCount) : null,
    teacherLessonShareUsd:
      params.teacherShareUsd !== null && lessonsCount > 0 ? round2(params.teacherShareUsd / lessonsCount) : null,
    platformRevenueBrl: params.platformRevenueBrl,
    platformRevenueUsd: params.platformRevenueUsd,
    platformLessonRevenueBrl:
      params.platformRevenueBrl !== null && lessonsCount > 0 ? round2(params.platformRevenueBrl / lessonsCount) : null,
    platformLessonRevenueUsd:
      params.platformRevenueUsd !== null && lessonsCount > 0 ? round2(params.platformRevenueUsd / lessonsCount) : null,
    totalPaidBrlCents,
    totalPaidUsdCents,
    teacherShareBrlCents,
    teacherShareUsdCents,
    platformRevenueBrlCents,
    platformRevenueUsdCents,
    remainingTotalPaidBrlCents: totalPaidBrlCents,
    remainingTotalPaidUsdCents: totalPaidUsdCents,
    remainingTeacherShareBrlCents: teacherShareBrlCents,
    remainingTeacherShareUsdCents: teacherShareUsdCents,
    remainingPlatformRevenueBrlCents: platformRevenueBrlCents,
    remainingPlatformRevenueUsdCents: platformRevenueUsdCents,
    consumedTotalPaidBrlCents: 0,
    consumedTotalPaidUsdCents: totalPaidUsdCents !== null ? 0 : null,
    consumedTeacherShareBrlCents: teacherShareBrlCents !== null ? 0 : null,
    consumedTeacherShareUsdCents: teacherShareUsdCents !== null ? 0 : null,
    consumedPlatformRevenueBrlCents: platformRevenueBrlCents !== null ? 0 : null,
    consumedPlatformRevenueUsdCents: platformRevenueUsdCents !== null ? 0 : null,
    unitCentsSchedule,
    availableUnitIndices,
    consumedUnitIndices: [],
    gatewayProvider: params.gatewayProvider,
    gatewayTransactionId: params.gatewayTransactionId,
    reason: params.justification,
    performedByUid: params.performedByUid,
    performedByEmail: params.performedByEmail,
    performedByRole: 'admin',
    reconciledFromLotId: params.reconciledFromLotId,
    reconciliationAuditId: params.reconciliationAuditId,
    reconciledAt: params.nowIso,
  };
}

export function buildReconciledCourtesyLotData(params: {
  studentUid: string;
  studentEmail?: string;
  lessonsCount: number;
  lotSequence: number;
  nowIso: string;
  idempotencyKey: string;
  allocationIndex: number;
  reconciledFromLotId: string;
  reconciliationAuditId: string;
  justification: string;
  performedByUid: string;
  performedByEmail: string;
}): CreditLot {
  const unitCentsSchedule = buildZeroUnitCentsSchedule(params.lessonsCount);
  const availableUnitIndices = makeSequentialIndices(params.lessonsCount, 0);

  return {
    id: buildCreditLotId({
      studentUid: params.studentUid,
      kind: 'recon_courtesy',
      idempotencyKey: `${params.idempotencyKey}:alloc:${params.allocationIndex}`,
    }),
    studentUid: params.studentUid,
    studentEmail: (params.studentEmail || '').toLowerCase().trim(),
    origin: 'courtesy',
    sourceType: 'LEGACY_RECONCILIATION_COURTESY',
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
    sourceTransactionId: null,
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
    totalPaidBrlCents: 0,
    totalPaidUsdCents: 0,
    teacherShareBrlCents: 0,
    teacherShareUsdCents: 0,
    platformRevenueBrlCents: 0,
    platformRevenueUsdCents: 0,
    remainingTotalPaidBrlCents: 0,
    remainingTotalPaidUsdCents: 0,
    remainingTeacherShareBrlCents: 0,
    remainingTeacherShareUsdCents: 0,
    remainingPlatformRevenueBrlCents: 0,
    remainingPlatformRevenueUsdCents: 0,
    consumedTotalPaidBrlCents: 0,
    consumedTotalPaidUsdCents: 0,
    consumedTeacherShareBrlCents: 0,
    consumedTeacherShareUsdCents: 0,
    consumedPlatformRevenueBrlCents: 0,
    consumedPlatformRevenueUsdCents: 0,
    unitCentsSchedule,
    availableUnitIndices,
    consumedUnitIndices: [],
    gatewayProvider: null,
    gatewayTransactionId: null,
    reason: params.justification,
    performedByUid: params.performedByUid,
    performedByEmail: params.performedByEmail,
    performedByRole: 'admin',
    reconciledFromLotId: params.reconciledFromLotId,
    reconciliationAuditId: params.reconciliationAuditId,
    reconciledAt: params.nowIso,
  };
}

/**
 * NF.SWITCH.2D: Retires all currently available units on an active paid or courtesy
 * source lot into the switch without reducing `initialLessons` or breaking any
 * unit-cents schedule conservation invariants.
 */
export function retireSourceLotUnitsForSwitch(params: {
  lot: CreditLot;
  switchAuditId: string;
  targetTeacherUid: string;
  nowIso: string;
}): {
  retiredLot: CreditLot;
  retiredUnitIndices: number[];
} {
  const { lot, switchAuditId, targetTeacherUid, nowIso } = params;
  if (lot.origin === 'legacy_unreconciled') {
    throw new CreditLedgerError(
      `Lote '${lot.id}' tem origem legacy_unreconciled e não pode ser convertido automaticamente sem conciliação administrativa.`,
      409,
      CREDIT_LEDGER_DIVERGENCE_CODE,
      { lotId: lot.id }
    );
  }
  const { availableUnitIndices, consumedUnitIndices } = normalizeLotUnitIndices(lot);
  if (availableUnitIndices.length !== lot.remainingLessons) {
    throw new CreditLedgerError(
      `Divergência nos índices disponíveis do lote '${lot.id}' durante encerramento de troca.`,
      409,
      CREDIT_LEDGER_DIVERGENCE_CODE,
      { lotId: lot.id, availableCount: availableUnitIndices.length, remainingLessons: lot.remainingLessons }
    );
  }

  const allConsumedIndices = [...consumedUnitIndices, ...availableUnitIndices].sort((a, b) => a - b);
  const centsSnapshot = computeLotCentsSnapshot(lot, [], allConsumedIndices);

  const retiredLot: CreditLot = {
    ...lot,
    ...centsSnapshot,
    remainingLessons: 0,
    consumedLessons: lot.initialLessons,
    status: 'exhausted',
    exhaustedAt: lot.exhaustedAt || nowIso,
    updatedAt: nowIso,
    switchedOutAt: nowIso,
    switchedOutAuditId: switchAuditId,
    switchedOutUnitIndices: [...availableUnitIndices],
    switchedOutLessonsCount: availableUnitIndices.length,
    switchedOutTargetTeacherUid: targetTeacherUid,
  };

  return {
    retiredLot,
    retiredUnitIndices: [...availableUnitIndices],
  };
}

export function buildSwitchedPaidLotData(params: {
  studentUid: string;
  studentEmail?: string;
  lessonsCount: 1 | 4 | 8 | 12;
  discountPercent: number;
  lotSequence: number;
  packageIndex: number;
  nowIso: string;
  idempotencyKey: string;
  switchAuditId: string;
  sourceTeacherUid: string;
  sourcePaidLotIds: string[];
  pricedTeacherUid: string;
  teacherEmail: string;
  teacherName: string;
  basePriceUsd: number;
  adminCommissionPercent: number;
  commissionModel: string;
  commissionVersion: number;
  ptaxRate: number;
  ptaxQuoteDate?: string | null;
  ptaxPricingDate?: string | null;
  ptaxSource?: string | null;
  totalPaidBrlCents: number;
  totalPaidUsdCents: number;
  teacherShareBrlCents: number;
  teacherShareUsdCents: number;
  platformRevenueBrlCents: number;
  platformRevenueUsdCents: number;
  unitCentsSchedule: CreditLotUnitLedgerEntry[];
}): CreditLot {
  const { lessonsCount, totalPaidBrlCents, totalPaidUsdCents, teacherShareBrlCents, teacherShareUsdCents, platformRevenueBrlCents, platformRevenueUsdCents } = params;
  const availableUnitIndices = makeSequentialIndices(lessonsCount, 0);
  const unitCentsSchedule = params.unitCentsSchedule.map((entry, idx) => ({
    unitIndex: typeof entry.unitIndex === 'number' ? entry.unitIndex : idx,
    totalPaidBrlCents: entry.totalPaidBrlCents,
    totalPaidUsdCents: entry.totalPaidUsdCents,
    teacherShareBrlCents: entry.teacherShareBrlCents,
    teacherShareUsdCents: entry.teacherShareUsdCents,
    platformRevenueBrlCents: entry.platformRevenueBrlCents,
    platformRevenueUsdCents: entry.platformRevenueUsdCents,
  }));

  const centsToBrl = (c: number) => round2(c / 100);

  return {
    id: buildCreditLotId({
      studentUid: params.studentUid,
      kind: 'switch_paid',
      idempotencyKey: `${params.idempotencyKey}:pkg:${params.packageIndex}`,
    }),
    studentUid: params.studentUid,
    studentEmail: (params.studentEmail || '').toLowerCase().trim(),
    origin: 'paid',
    sourceType: 'NATIVE_FRIEND_SWITCH_PAID',
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
    sourceTransactionId: null,
    idempotencyKey: params.idempotencyKey,
    pricedTeacherUid: params.pricedTeacherUid,
    teacherEmail: params.teacherEmail || null,
    teacherName: params.teacherName || null,
    packageName: `Conversão Troca Native Friend (${lessonsCount} ${lessonsCount === 1 ? 'aula' : 'aulas'})`,
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
    ptaxQuoteDate: params.ptaxQuoteDate ?? null,
    ptaxPricingDate: params.ptaxPricingDate ?? null,
    ptaxSource: params.ptaxSource ?? null,
    discountPercent: params.discountPercent,
    totalPaidBrl: centsToBrl(totalPaidBrlCents),
    totalPaidUsd: centsToBrl(totalPaidUsdCents),
    unitPriceBrl: round2(centsToBrl(totalPaidBrlCents) / lessonsCount),
    unitPriceUsd: round2(centsToBrl(totalPaidUsdCents) / lessonsCount),
    teacherShareBrl: centsToBrl(teacherShareBrlCents),
    teacherShareUsd: centsToBrl(teacherShareUsdCents),
    teacherLessonShareBrl: round2(centsToBrl(teacherShareBrlCents) / lessonsCount),
    teacherLessonShareUsd: round2(centsToBrl(teacherShareUsdCents) / lessonsCount),
    platformRevenueBrl: centsToBrl(platformRevenueBrlCents),
    platformRevenueUsd: centsToBrl(platformRevenueUsdCents),
    platformLessonRevenueBrl: round2(centsToBrl(platformRevenueBrlCents) / lessonsCount),
    platformLessonRevenueUsd: round2(centsToBrl(platformRevenueUsdCents) / lessonsCount),
    totalPaidBrlCents,
    totalPaidUsdCents,
    teacherShareBrlCents,
    teacherShareUsdCents,
    platformRevenueBrlCents,
    platformRevenueUsdCents,
    remainingTotalPaidBrlCents: totalPaidBrlCents,
    remainingTotalPaidUsdCents: totalPaidUsdCents,
    remainingTeacherShareBrlCents: teacherShareBrlCents,
    remainingTeacherShareUsdCents: teacherShareUsdCents,
    remainingPlatformRevenueBrlCents: platformRevenueBrlCents,
    remainingPlatformRevenueUsdCents: platformRevenueUsdCents,
    consumedTotalPaidBrlCents: 0,
    consumedTotalPaidUsdCents: 0,
    consumedTeacherShareBrlCents: 0,
    consumedTeacherShareUsdCents: 0,
    consumedPlatformRevenueBrlCents: 0,
    consumedPlatformRevenueUsdCents: 0,
    unitCentsSchedule,
    availableUnitIndices,
    consumedUnitIndices: [],
    gatewayProvider: null,
    gatewayTransactionId: null,
    reason: `Conversão de créditos na troca de Native Friend (${params.sourceTeacherUid} -> ${params.pricedTeacherUid})`,
    performedByUid: params.studentUid,
    performedByEmail: (params.studentEmail || '').toLowerCase().trim(),
    performedByRole: 'student',
    switchedFromAuditId: params.switchAuditId,
    switchedFromSourceTeacherUid: params.sourceTeacherUid,
    switchedFromLotIds: [...params.sourcePaidLotIds],
    switchedPackageIndex: params.packageIndex,
  };
}

export function buildSwitchedCourtesyLotData(params: {
  studentUid: string;
  studentEmail?: string;
  lessonsCount: number;
  lotSequence: number;
  nowIso: string;
  idempotencyKey: string;
  switchAuditId: string;
  sourceTeacherUid: string;
  targetTeacherUid: string;
  sourceCourtesyLotIds: string[];
}): CreditLot {
  const unitCentsSchedule = buildZeroUnitCentsSchedule(params.lessonsCount);
  const availableUnitIndices = makeSequentialIndices(params.lessonsCount, 0);

  return {
    id: buildCreditLotId({
      studentUid: params.studentUid,
      kind: 'switch_courtesy',
      idempotencyKey: params.idempotencyKey,
    }),
    studentUid: params.studentUid,
    studentEmail: (params.studentEmail || '').toLowerCase().trim(),
    origin: 'courtesy',
    sourceType: 'NATIVE_FRIEND_SWITCH_COURTESY',
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
    sourceTransactionId: null,
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
    totalPaidBrlCents: 0,
    totalPaidUsdCents: 0,
    teacherShareBrlCents: 0,
    teacherShareUsdCents: 0,
    platformRevenueBrlCents: 0,
    platformRevenueUsdCents: 0,
    remainingTotalPaidBrlCents: 0,
    remainingTotalPaidUsdCents: 0,
    remainingTeacherShareBrlCents: 0,
    remainingTeacherShareUsdCents: 0,
    remainingPlatformRevenueBrlCents: 0,
    remainingPlatformRevenueUsdCents: 0,
    consumedTotalPaidBrlCents: 0,
    consumedTotalPaidUsdCents: 0,
    consumedTeacherShareBrlCents: 0,
    consumedTeacherShareUsdCents: 0,
    consumedPlatformRevenueBrlCents: 0,
    consumedPlatformRevenueUsdCents: 0,
    unitCentsSchedule,
    availableUnitIndices,
    consumedUnitIndices: [],
    gatewayProvider: null,
    gatewayTransactionId: null,
    reason: `Transferência 1:1 de cortesias na troca de Native Friend (${params.sourceTeacherUid} -> ${params.targetTeacherUid})`,
    performedByUid: params.studentUid,
    performedByEmail: (params.studentEmail || '').toLowerCase().trim(),
    performedByRole: 'student',
    switchedFromAuditId: params.switchAuditId,
    switchedFromSourceTeacherUid: params.sourceTeacherUid,
    switchedFromLotIds: [...params.sourceCourtesyLotIds],
    switchedPackageIndex: null,
  };
}



