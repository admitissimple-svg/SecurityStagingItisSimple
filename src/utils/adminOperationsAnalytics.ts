import { roundToCents, toCents, fromCents } from './financialEngine';

export const OPERATIONS_TIMEZONE = 'America/Sao_Paulo';

export interface OperationsQueryFilters {
  year?: number | 'all';
  month?: number | 'all';
  country?: string | 'all';
  teacherUid?: string | 'all';
}

export interface OperationsTeacherOption {
  teacherKey: string;
  name: string;
  country: string | null;
}

export interface OperationsRow {
  rowKey: string;
  year: number;
  month: number;
  country: string | null;
  teacherKey: string;
  nativeFriendName: string;
  nativeFriendEmail: string | null;
  studentsCount: number;
  aulasContratadas: number;
  paidContractedLessons: number;
  adminGrantedLessons: number;
  atendidas: number;
  trialAtendidas: number;
  saldo: number | null;
  aulaUsd: number | null;
  comissaoMarkupPercent: number | null;
  aulaBrl: number | null;
  faturamentoBrl: number | null;
  custoPlataformaBrl: number | null;
  custoNativeFriendBrl: number | null;
  lucroBrl: number | null;
  grossPlatformShareBrl: number | null;
  paidTransactionsCount: number;
  adminTransactionsCount: number;
  hasMixedPricingSnapshots: boolean;
}

export interface OperationsKpis {
  alunosCount: number;
  aulasContratadas: number;
  paidContractedLessons: number;
  adminGrantedLessons: number;
  atendidas: number;
  saldo: number | null;
  faturamentoBrl: number | null;
  custoPlataformaBrl: number | null;
  custoNativeFriendBrl: number | null;
  lucroBrl: number | null;
  grossPlatformShareBrl: number | null;
}

export interface OperationsFilterOptions {
  years: number[];
  months: number[];
  countries: string[];
  hasMissingCountry?: boolean;
  teachers: OperationsTeacherOption[];
}

export interface AdminOperationsDashboardData {
  generatedAt: string;
  timezone: string;
  dataSource: 'firestore_default';
  filtersApplied: {
    year: number | 'all';
    month: number | 'all';
    country: string | 'all';
    teacherUid: string | 'all';
  };
  filterOptions: OperationsFilterOptions;
  kpis: OperationsKpis;
  rows: OperationsRow[];
}

export interface AdminOperationsSourceInput {
  transactions: Record<string, any>[];
  lessons: Record<string, any>[];
  tutors: Record<string, any>[];
  users: Record<string, any>[];
  studentAssignments?: Record<string, any>[];
  filters?: OperationsQueryFilters;
  generatedAt?: string;
}

interface CanonicalTeacherProfile {
  teacherKey: string;
  name: string;
  email: string | null;
  country: string | null;
  aliases: Set<string>;
}

interface SnapshotAccumulator {
  usdWeightedSum: number;
  usdWeight: number;
  usdDistinct: Set<number>;
  markupWeightedSum: number;
  markupWeight: number;
  markupDistinct: Set<number>;
  brlWeightedSum: number;
  brlWeight: number;
  brlDistinct: Set<number>;
}

interface BucketAccumulator {
  rowKey: string;
  year: number;
  month: number;
  teacherKey: string;
  nativeFriendName: string;
  nativeFriendEmail: string | null;
  country: string | null;
  studentKeys: Set<string>;
  aulasContratadas: number;
  paidContractedLessons: number;
  adminGrantedLessons: number;
  atendidas: number;
  trialAtendidas: number;
  paidTransactionsCount: number;
  adminTransactionsCount: number;
  faturamentoCents: number;
  hasMissingPaidRevenue: boolean;
  custoPlataformaCents: number;
  hasAllPaidPlatformCosts: boolean;
  custoNativeFriendCents: number;
  hasAllPaidTeacherShares: boolean;
  grossPlatformShareCents: number;
  hasAnyGrossPlatformShare: boolean;
  paidSnapshot: SnapshotAccumulator;
  grantSnapshot: SnapshotAccumulator;
}

function createSnapshotAccumulator(): SnapshotAccumulator {
  return {
    usdWeightedSum: 0,
    usdWeight: 0,
    usdDistinct: new Set<number>(),
    markupWeightedSum: 0,
    markupWeight: 0,
    markupDistinct: new Set<number>(),
    brlWeightedSum: 0,
    brlWeight: 0,
    brlDistinct: new Set<number>(),
  };
}

function toFiniteNumber(val: unknown): number | null {
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  if (typeof val === 'string' && val.trim() !== '') {
    const parsed = Number(val.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function normalizeEmail(val: unknown): string {
  return typeof val === 'string' ? val.toLowerCase().trim() : '';
}

function cleanString(val: unknown): string {
  return typeof val === 'string' ? val.trim() : '';
}

/**
 * Extracts { year, month } (month 1..12) using America/Sao_Paulo operational competence.
 */
export function extractBrazilYearMonth(
  dateInput: unknown
): { year: number; month: number } | null {
  if (!dateInput) return null;

  if (typeof dateInput === 'string') {
    const trimmed = dateInput.trim();
    if (!trimmed) return null;
    const pureDateMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (pureDateMatch) {
      const year = Number(pureDateMatch[1]);
      const month = Number(pureDateMatch[2]);
      if (year >= 2000 && year <= 2100 && month >= 1 && month <= 12) {
        return { year, month };
      }
    }
  }

  let dateObj: Date | null = null;
  if (dateInput instanceof Date) {
    dateObj = dateInput;
  } else if (typeof dateInput === 'object' && dateInput !== null && typeof (dateInput as any).toDate === 'function') {
    // Firestore Timestamp support
    dateObj = (dateInput as any).toDate();
  } else if (typeof dateInput === 'string' || typeof dateInput === 'number') {
    dateObj = new Date(dateInput);
  }

  if (!dateObj || isNaN(dateObj.getTime())) return null;

  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: OPERATIONS_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
    }).formatToParts(dateObj);
    const yPart = parts.find((p) => p.type === 'year')?.value;
    const mPart = parts.find((p) => p.type === 'month')?.value;
    const year = Number(yPart);
    const month = Number(mPart);
    if (Number.isInteger(year) && Number.isInteger(month) && month >= 1 && month <= 12) {
      return { year, month };
    }
  } catch {
    // Fallback using UTC-3 offset if Intl fails in exotic runtime
  }

  const shifted = new Date(dateObj.getTime() - 3 * 60 * 60 * 1000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
  };
}

/**
 * Strictly identifies whether a financial_transactions record represents a real paid purchase.
 * Administrative grants and credit adjustments are NEVER treated as paid revenue.
 */
export function isPaidPurchaseTransaction(tx: Record<string, any> | null | undefined): boolean {
  if (!tx || typeof tx !== 'object') return false;
  if (tx.status === 'cancelled' || tx.status === 'refunded' || tx.status === 'void') return false;
  if (tx.type === 'LEGACY_CREDIT_RECONCILIATION' || tx.category === 'legacy_credit_reconciliation') return false;
  if (tx.type === 'ADMIN_PACKAGE_GRANT' || tx.type === 'ADMIN_CREDIT_ADJUSTMENT') return false;
  if (tx.category === 'administrative_package_grant' || tx.category === 'administrative_adjustment') return false;
  if (tx.isAdministrativeOperation === true) return false;
  if (tx.countsAsRevenue === false || tx.isPaidPurchase === false) return false;

  if (tx.isPaidPurchase === true && tx.countsAsRevenue === true) {
    return true;
  }
  if (tx.type === 'PACKAGE_PURCHASE' && tx.countsAsRevenue === true) {
    return true;
  }
  return false;
}

/**
 * Identifies administrative grants/adjustments (non-revenue operations).
 */
export function isAdministrativeTransaction(tx: Record<string, any> | null | undefined): boolean {
  if (!tx || typeof tx !== 'object') return false;
  if (tx.status === 'cancelled' || tx.status === 'void') return false;
  if (tx.type === 'LEGACY_CREDIT_RECONCILIATION' || tx.category === 'legacy_credit_reconciliation') return false;
  if (isPaidPurchaseTransaction(tx)) return false;
  return (
    tx.type === 'ADMIN_PACKAGE_GRANT' ||
    tx.type === 'ADMIN_CREDIT_ADJUSTMENT' ||
    tx.category === 'administrative_package_grant' ||
    tx.category === 'administrative_adjustment' ||
    tx.isAdministrativeOperation === true ||
    tx.countsAsRevenue === false ||
    tx.isPaidPurchase === false
  );
}

function extractRecordedPlatformCostBrl(tx: Record<string, any>): number | null {
  const candidates = [
    tx.platformCostBrl,
    tx.gatewayFeeBrl,
    tx.platformFeeBrl,
    tx.processingFeeBrl,
  ];
  for (const c of candidates) {
    const num = toFiniteNumber(c);
    if (num !== null && num >= 0) return roundToCents(num);
  }
  return null;
}

function extractPaidRevenueBrl(tx: Record<string, any>): number | null {
  const candidates = [
    tx.revenueBrl,
    tx.finalPriceBrl,
    tx.packagePriceBrl,
    tx.amountBrl,
  ];
  for (const c of candidates) {
    const num = toFiniteNumber(c);
    if (num !== null && num >= 0) return roundToCents(num);
  }
  return null;
}

function extractPaidTeacherShareBrl(tx: Record<string, any>): number | null {
  const num = toFiniteNumber(tx.teacherShareBrl);
  if (num !== null && num >= 0) return roundToCents(num);
  return null;
}

function extractTransactionLessonsCount(tx: Record<string, any>): number {
  const direct =
    toFiniteNumber(tx.lessonsAdded) ??
    toFiniteNumber(tx.packageLessons) ??
    toFiniteNumber(tx.delta);
  if (direct !== null) return direct;
  return 0;
}

function recordSnapshotValues(
  acc: SnapshotAccumulator,
  tx: Record<string, any>,
  lessonsWeight: number,
  paidRevenueBrl: number | null
) {
  const weight = Math.max(1, Math.abs(lessonsWeight || 0));

  const baseUsd = toFiniteNumber(tx.basePriceUsd);
  if (baseUsd !== null && baseUsd > 0) {
    const roundedUsd = roundToCents(baseUsd);
    acc.usdWeightedSum += roundedUsd * weight;
    acc.usdWeight += weight;
    acc.usdDistinct.add(roundedUsd);
  }

  const markup = toFiniteNumber(tx.adminCommissionPercent);
  if (markup !== null && markup >= 0 && markup <= 100) {
    const cleanMarkup = roundToCents(markup);
    acc.markupWeightedSum += cleanMarkup * weight;
    acc.markupWeight += weight;
    acc.markupDistinct.add(cleanMarkup);
  }

  let lessonBrl = toFiniteNumber(tx.effectiveLessonPriceBrl);
  if ((lessonBrl === null || lessonBrl <= 0) && paidRevenueBrl !== null && lessonsWeight > 0) {
    lessonBrl = paidRevenueBrl / lessonsWeight;
  }
  if (lessonBrl === null || lessonBrl <= 0) {
    lessonBrl = toFiniteNumber(tx.unitFinalPriceBrl);
  }

  if (lessonBrl !== null && lessonBrl > 0) {
    const roundedBrl = roundToCents(lessonBrl);
    acc.brlWeightedSum += roundedBrl * weight;
    acc.brlWeight += weight;
    acc.brlDistinct.add(roundedBrl);
  }
}

function finalizeSnapshotMetric(weightedSum: number, weight: number): number | null {
  if (weight <= 0) return null;
  return roundToCents(weightedSum / weight);
}

export function buildAdminOperationsDashboard(
  input: AdminOperationsSourceInput
): AdminOperationsDashboardData {
  const transactions = Array.isArray(input.transactions) ? input.transactions : [];
  const lessons = Array.isArray(input.lessons) ? input.lessons : [];
  const tutors = Array.isArray(input.tutors) ? input.tutors : [];
  const users = Array.isArray(input.users) ? input.users : [];
  const studentAssignments = Array.isArray(input.studentAssignments) ? input.studentAssignments : [];

  // 1. Build canonical teacher directory (from tutors + users[role=teacher])
  const teachersByKey = new Map<string, CanonicalTeacherProfile>();
  const aliasToTeacherKey = new Map<string, string>();

  const registerTeacher = (raw: Record<string, any>) => {
    if (!raw || typeof raw !== 'object') return;
    const uid = cleanString(raw.uid) || cleanString(raw.authUid);
    const id = cleanString(raw.id);
    const publicId = cleanString(raw.publicTutorId);
    const email = normalizeEmail(raw.email);
    const canonicalKey = uid || (id && !id.includes('@') ? id : '') || email || id;
    if (!canonicalKey) return;

    const existing = teachersByKey.get(canonicalKey);
    const rawName = cleanString(raw.name) || cleanString(raw.fullName);
    const rawCountry = cleanString(raw.country);

    const profile: CanonicalTeacherProfile = existing || {
      teacherKey: canonicalKey,
      name: rawName || email || canonicalKey,
      email: email || null,
      country: rawCountry || null,
      aliases: new Set<string>([canonicalKey]),
    };

    if (rawName && (!existing || profile.name === profile.email || profile.name === profile.teacherKey)) {
      profile.name = rawName;
    }
    if (email && !profile.email) {
      profile.email = email;
    }
    if (rawCountry && !profile.country) {
      profile.country = rawCountry;
    }

    const allAliases = [canonicalKey, uid, cleanString(raw.authUid), id, publicId, email].filter(Boolean);
    for (const a of allAliases) {
      profile.aliases.add(a);
      aliasToTeacherKey.set(a, canonicalKey);
      aliasToTeacherKey.set(a.toLowerCase(), canonicalKey);
    }

    teachersByKey.set(canonicalKey, profile);
  };

  for (const t of tutors) {
    registerTeacher(t);
  }
  for (const u of users) {
    if (u && String(u.role || '').toLowerCase().trim() === 'teacher') {
      registerTeacher(u);
    }
  }

  const resolveTeacherFromFields = (fields: {
    teacherUid?: unknown;
    teacherAuthUid?: unknown;
    tutorUid?: unknown;
    teacherPublicId?: unknown;
    teacherEmail?: unknown;
    tutorEmail?: unknown;
    teacherName?: unknown;
  }): CanonicalTeacherProfile | null => {
    const candidates = [
      cleanString(fields.teacherUid),
      cleanString(fields.teacherAuthUid),
      cleanString(fields.tutorUid),
      cleanString(fields.teacherPublicId),
      normalizeEmail(fields.teacherEmail),
      normalizeEmail(fields.tutorEmail),
    ].filter(Boolean);

    for (const c of candidates) {
      const mapped = aliasToTeacherKey.get(c) || aliasToTeacherKey.get(c.toLowerCase());
      if (mapped && teachersByKey.has(mapped)) {
        return teachersByKey.get(mapped)!;
      }
    }

    const fallbackUid =
      cleanString(fields.teacherUid) ||
      cleanString(fields.teacherAuthUid) ||
      cleanString(fields.tutorUid) ||
      cleanString(fields.teacherPublicId);
    const fallbackEmail = normalizeEmail(fields.teacherEmail) || normalizeEmail(fields.tutorEmail);
    const fallbackKey = fallbackUid || fallbackEmail;
    if (!fallbackKey) return null;

    const fallbackName = cleanString(fields.teacherName) || fallbackEmail || fallbackKey;
    const synthesized: CanonicalTeacherProfile = {
      teacherKey: fallbackKey,
      name: fallbackName,
      email: fallbackEmail || null,
      country: null,
      aliases: new Set<string>(candidates),
    };
    teachersByKey.set(fallbackKey, synthesized);
    for (const c of candidates) {
      aliasToTeacherKey.set(c, fallbackKey);
      aliasToTeacherKey.set(c.toLowerCase(), fallbackKey);
    }
    return synthesized;
  };

  // 2. Build canonical student balance registry & read-only student -> teacher lookup
  const currentYm = extractBrazilYearMonth(input.generatedAt || new Date().toISOString());
  const studentAliasToCanonicalKey = new Map<string, string>();
  const studentPersistedBalance = new Map<string, number | null>();
  const studentDocIsCanonical = new Map<string, boolean>();
  const studentAssociatedTeachers = new Map<string, Set<string>>();
  const studentHadCreditActivity = new Set<string>();
  const studentAssignedTeacherMap = new Map<string, CanonicalTeacherProfile>();

  const registerStudentCanonicalBalance = (rec: Record<string, any>) => {
    if (!rec || typeof rec !== 'object') return;
    const role = String(rec.role || '').toLowerCase().trim();
    if (role === 'admin' || role === 'teacher') return;
    if (rec.deleted === true) return;

    const rawCanonical = cleanString(rec.canonicalUid);
    const rawAuthUid = cleanString(rec.authUid);
    const rawUid = cleanString(rec.uid);
    const rawId = cleanString(rec.id);
    const email = normalizeEmail(rec.email) || normalizeEmail(rec.studentEmail);

    const canonicalKey =
      rawCanonical ||
      rawAuthUid ||
      rawUid ||
      (rawId && !rawId.includes('@') ? rawId : '') ||
      email;
    if (!canonicalKey) return;

    const isCanonicalDoc =
      (!rawCanonical || rawCanonical === canonicalKey) &&
      (!rawCanonical || rawId === canonicalKey || rawUid === canonicalKey || rawAuthUid === canonicalKey);

    const rawBal = toFiniteNumber(rec.availableLessons);
    if (!studentPersistedBalance.has(canonicalKey)) {
      studentPersistedBalance.set(canonicalKey, rawBal);
      studentDocIsCanonical.set(canonicalKey, isCanonicalDoc);
    } else {
      const prevCanonical = Boolean(studentDocIsCanonical.get(canonicalKey));
      const prevBal = studentPersistedBalance.get(canonicalKey) ?? null;
      if (
        (isCanonicalDoc && !prevCanonical) ||
        (isCanonicalDoc === prevCanonical && prevBal === null && rawBal !== null)
      ) {
        studentPersistedBalance.set(canonicalKey, rawBal);
        studentDocIsCanonical.set(canonicalKey, isCanonicalDoc);
      }
    }

    const aliases = [canonicalKey, rawAuthUid, rawUid, rawId, email].filter(Boolean);
    for (const a of aliases) {
      if (a.includes('@')) {
        const lowerEmail = a.toLowerCase();
        if (!studentAliasToCanonicalKey.has(lowerEmail) || !canonicalKey.includes('@')) {
          studentAliasToCanonicalKey.set(lowerEmail, canonicalKey);
        }
      } else {
        studentAliasToCanonicalKey.set(a, canonicalKey);
      }
    }
  };

  for (const u of users) {
    if (!u || typeof u !== 'object') continue;
    const hasNonEmailUid = Boolean(
      cleanString(u.canonicalUid) ||
        cleanString(u.authUid) ||
        cleanString(u.uid) ||
        (cleanString(u.id) && !cleanString(u.id).includes('@'))
    );
    if (hasNonEmailUid) registerStudentCanonicalBalance(u);
  }
  for (const u of users) {
    if (!u || typeof u !== 'object') continue;
    const email = normalizeEmail(u.email) || normalizeEmail(u.studentEmail);
    const hasNonEmailUid = Boolean(
      cleanString(u.canonicalUid) ||
        cleanString(u.authUid) ||
        cleanString(u.uid) ||
        (cleanString(u.id) && !cleanString(u.id).includes('@'))
    );
    if (!hasNonEmailUid && (!email || !studentAliasToCanonicalKey.has(email))) {
      registerStudentCanonicalBalance(u);
    }
  }

  const resolveStudentKey = (rec: {
    studentUid?: unknown;
    studentEmail?: unknown;
    uid?: unknown;
    id?: unknown;
    email?: unknown;
  }): string => {
    const sUid = cleanString(rec.studentUid) || cleanString(rec.uid) || cleanString(rec.id);
    const sEmail = normalizeEmail(rec.studentEmail) || normalizeEmail(rec.email);
    if (sUid) {
      const mapped = studentAliasToCanonicalKey.get(sUid);
      if (mapped) return mapped;
    }
    if (sEmail) {
      const mapped = studentAliasToCanonicalKey.get(sEmail);
      if (mapped) return mapped;
    }
    return sUid || sEmail || 'unknown_student';
  };

  const addStudentTeacherAssociation = (
    studentKey: string,
    teacher: CanonicalTeacherProfile | null | undefined
  ) => {
    if (!studentKey || studentKey === 'unknown_student') return;
    if (!teacher || teacher.teacherKey === '__unassigned__') return;
    let set = studentAssociatedTeachers.get(studentKey);
    if (!set) {
      set = new Set<string>();
      studentAssociatedTeachers.set(studentKey, set);
    }
    set.add(teacher.teacherKey);
  };

  const registerStudentLink = (rec: Record<string, any>) => {
    if (!rec || typeof rec !== 'object') return;
    const role = String(rec.role || '').toLowerCase().trim();
    if (role === 'admin' || role === 'teacher') return;
    if (rec.deleted === true) return;

    const tProfile = resolveTeacherFromFields({
      teacherUid: rec.teacherUid || rec.assignedNativeFriendUID || rec.nativeFriendUID,
      teacherAuthUid: rec.teacherAuthUid,
      teacherPublicId: rec.teacherPublicId,
      teacherEmail: rec.teacherEmail,
      teacherName: rec.teacherName,
    });
    if (!tProfile) return;

    const sUid = cleanString(rec.studentUid) || cleanString(rec.uid) || cleanString(rec.id);
    const sEmail = normalizeEmail(rec.email) || normalizeEmail(rec.studentEmail);
    if (sUid) studentAssignedTeacherMap.set(sUid, tProfile);
    if (sEmail) studentAssignedTeacherMap.set(sEmail, tProfile);

    const canonicalStudentKey = resolveStudentKey({
      studentUid: rec.studentUid,
      studentEmail: rec.studentEmail,
      uid: rec.uid,
      id: rec.id,
      email: rec.email,
    });
    addStudentTeacherAssociation(canonicalStudentKey, tProfile);
  };

  for (const sa of studentAssignments) registerStudentLink(sa);
  for (const u of users) registerStudentLink(u);

  // 3. Bucket accumulator keyed by `${year}-${month}::${teacherKey}`
  const buckets = new Map<string, BucketAccumulator>();

  const getOrCreateBucket = (
    year: number,
    month: number,
    teacher: CanonicalTeacherProfile
  ): BucketAccumulator => {
    const rowKey = `${year}-${String(month).padStart(2, '0')}::${teacher.teacherKey}`;
    let existing = buckets.get(rowKey);
    if (!existing) {
      existing = {
        rowKey,
        year,
        month,
        teacherKey: teacher.teacherKey,
        nativeFriendName: teacher.name,
        nativeFriendEmail: teacher.email,
        country: teacher.country || null,
        studentKeys: new Set<string>(),
        aulasContratadas: 0,
        paidContractedLessons: 0,
        adminGrantedLessons: 0,
        atendidas: 0,
        trialAtendidas: 0,
        paidTransactionsCount: 0,
        adminTransactionsCount: 0,
        faturamentoCents: 0,
        hasMissingPaidRevenue: false,
        custoPlataformaCents: 0,
        hasAllPaidPlatformCosts: true,
        custoNativeFriendCents: 0,
        hasAllPaidTeacherShares: true,
        grossPlatformShareCents: 0,
        hasAnyGrossPlatformShare: false,
        paidSnapshot: createSnapshotAccumulator(),
        grantSnapshot: createSnapshotAccumulator(),
      };
      buckets.set(rowKey, existing);
    }
    return existing;
  };

  const UNASSIGNED_TEACHER: CanonicalTeacherProfile = {
    teacherKey: '__unassigned__',
    name: 'Ajuste sem vínculo',
    email: null,
    country: null,
    aliases: new Set(['__unassigned__']),
  };

  // 4. Process financial_transactions (Purchase / Grant competence = tx.createdAt)
  for (const tx of transactions) {
    if (!tx || typeof tx !== 'object') continue;
    if (tx.status === 'cancelled' || tx.status === 'void') continue;

    const isPaid = isPaidPurchaseTransaction(tx);
    const isAdminOp = isAdministrativeTransaction(tx);
    if (!isPaid && !isAdminOp) continue;

    const competence = extractBrazilYearMonth(tx.gatewayConfirmedAt || tx.createdAt || tx.timestamp);
    if (!competence) continue;

    const explicitTeacher = resolveTeacherFromFields({
      teacherUid: tx.teacherUid || tx.tutorUid,
      teacherAuthUid: tx.teacherAuthUid,
      teacherPublicId: tx.teacherPublicId,
      teacherEmail: tx.teacherEmail || tx.tutorEmail,
      teacherName: tx.teacherName,
    });

    let teacher = explicitTeacher;
    if (!teacher) {
      const sUid = cleanString(tx.studentUid);
      const sEmail = normalizeEmail(tx.studentEmail);
      teacher =
        (sUid ? studentAssignedTeacherMap.get(sUid) : undefined) ||
        (sEmail ? studentAssignedTeacherMap.get(sEmail) : undefined) ||
        UNASSIGNED_TEACHER;
    }

    const studentKey = resolveStudentKey({ studentUid: tx.studentUid, studentEmail: tx.studentEmail });
    studentHadCreditActivity.add(studentKey);
    if (explicitTeacher) {
      addStudentTeacherAssociation(studentKey, explicitTeacher);
    }

    const bucket = getOrCreateBucket(competence.year, competence.month, teacher);
    bucket.studentKeys.add(studentKey);

    const lessonsCount = extractTransactionLessonsCount(tx);
    bucket.aulasContratadas += lessonsCount;

    if (isPaid) {
      bucket.paidTransactionsCount += 1;
      bucket.paidContractedLessons += lessonsCount;

      const revenueBrl = extractPaidRevenueBrl(tx);
      if (revenueBrl === null) {
        bucket.hasMissingPaidRevenue = true;
      } else {
        bucket.faturamentoCents += toCents(revenueBrl);
      }

      const platformCostBrl = extractRecordedPlatformCostBrl(tx);
      if (platformCostBrl === null) {
        bucket.hasAllPaidPlatformCosts = false;
      } else {
        bucket.custoPlataformaCents += toCents(platformCostBrl);
      }

      const teacherShareBrl = extractPaidTeacherShareBrl(tx);
      if (teacherShareBrl === null) {
        bucket.hasAllPaidTeacherShares = false;
      } else {
        bucket.custoNativeFriendCents += toCents(teacherShareBrl);
      }

      const grossShare = toFiniteNumber(tx.platformRevenueBrl);
      if (grossShare !== null && grossShare >= 0) {
        bucket.grossPlatformShareCents += toCents(grossShare);
        bucket.hasAnyGrossPlatformShare = true;
      } else if (revenueBrl !== null && teacherShareBrl !== null) {
        bucket.grossPlatformShareCents += toCents(revenueBrl) - toCents(teacherShareBrl);
        bucket.hasAnyGrossPlatformShare = true;
      }

      recordSnapshotValues(bucket.paidSnapshot, tx, lessonsCount, revenueBrl);
    } else {
      // Administrative grants / adjustments: NEVER counted as revenue or paid teacher payout cost
      bucket.adminTransactionsCount += 1;
      bucket.adminGrantedLessons += lessonsCount;
      recordSnapshotValues(bucket.grantSnapshot, tx, lessonsCount, null);
    }
  }

  // 5. Process lessons (Realization competence = completedAt || startDateTime)
  for (const lesson of lessons) {
    if (!lesson || typeof lesson !== 'object') continue;
    if (lesson.status === 'cancelled' || lesson.status === 'void') continue;

    const lessonTeacher = resolveTeacherFromFields({
      teacherUid: lesson.teacherUid || lesson.tutorUid,
      teacherAuthUid: lesson.teacherAuthUid,
      teacherPublicId: lesson.teacherPublicId,
      teacherEmail: lesson.teacherEmail || lesson.tutorEmail,
      teacherName: lesson.teacherName,
    });
    const studentKey = resolveStudentKey({
      studentUid: lesson.studentUid,
      studentEmail: lesson.studentEmail,
    });

    if (lessonTeacher) {
      addStudentTeacherAssociation(studentKey, lessonTeacher);
    }

    if (lesson.status !== 'completed') continue;

    if (!lesson.isTrialLesson) {
      studentHadCreditActivity.add(studentKey);
    }

    const competence = extractBrazilYearMonth(
      lesson.completedAt || lesson.startDateTime || lesson.updatedAt
    );
    if (!competence) continue;

    const teacher = lessonTeacher || UNASSIGNED_TEACHER;
    const bucket = getOrCreateBucket(competence.year, competence.month, teacher);
    bucket.studentKeys.add(studentKey);

    if (Boolean(lesson.isTrialLesson)) {
      bucket.trialAtendidas += 1;
    } else {
      bucket.atendidas += 1;
    }
  }

  // 6. Build all finalized rows & collect filter options across unfiltered dataset
  const allYearSet = new Set<number>();
  const allMonthSet = new Set<number>();
  const allCountrySet = new Set<string>();
  let hasMissingCountry = false;
  const allTeachersMap = new Map<string, OperationsTeacherOption>();

  const allEntries: Array<{ row: OperationsRow; studentKeys: Set<string>; aliases: Set<string> }> = [];

  for (const b of buckets.values()) {
    allYearSet.add(b.year);
    allMonthSet.add(b.month);
    if (b.country && b.country.trim() !== '') {
      allCountrySet.add(b.country.trim());
    } else {
      hasMissingCountry = true;
    }
    if (!allTeachersMap.has(b.teacherKey)) {
      allTeachersMap.set(b.teacherKey, {
        teacherKey: b.teacherKey,
        name: b.nativeFriendName,
        country: b.country,
      });
    }

    const activeSnapshot = b.paidTransactionsCount > 0 ? b.paidSnapshot : b.grantSnapshot;
    const aulaUsd = finalizeSnapshotMetric(activeSnapshot.usdWeightedSum, activeSnapshot.usdWeight);
    const comissaoMarkupPercent = finalizeSnapshotMetric(
      activeSnapshot.markupWeightedSum,
      activeSnapshot.markupWeight
    );
    const aulaBrl = finalizeSnapshotMetric(activeSnapshot.brlWeightedSum, activeSnapshot.brlWeight);
    const hasMixedPricingSnapshots =
      activeSnapshot.usdDistinct.size > 1 ||
      activeSnapshot.markupDistinct.size > 1 ||
      activeSnapshot.brlDistinct.size > 1;

    const faturamentoBrl =
      b.paidTransactionsCount === 0
        ? 0
        : b.hasMissingPaidRevenue
        ? null
        : fromCents(b.faturamentoCents);

    const custoPlataformaBrl =
      b.paidTransactionsCount > 0 && b.hasAllPaidPlatformCosts
        ? fromCents(b.custoPlataformaCents)
        : null;

    const custoNativeFriendBrl =
      b.paidTransactionsCount > 0 && b.hasAllPaidTeacherShares
        ? fromCents(b.custoNativeFriendCents)
        : null;

    const lucroBrl =
      faturamentoBrl !== null && custoPlataformaBrl !== null && custoNativeFriendBrl !== null
        ? fromCents(
            toCents(faturamentoBrl) - toCents(custoPlataformaBrl) - toCents(custoNativeFriendBrl)
          )
        : null;

    const grossPlatformShareBrl =
      b.paidTransactionsCount > 0 && b.hasAnyGrossPlatformShare
        ? fromCents(b.grossPlatformShareCents)
        : null;

    // ADM.OPS.3: Row Saldo rules:
    // - Never show current balance as historical balance of previous/non-current months.
    // - Show per-teacher balance ONLY when every student in the row has a persisted canonical balance
    //   in Firestore and is unequivocally attributed to this single Native Friend; otherwise null (N/D).
    const isCurrentMonthRow = Boolean(
      currentYm && b.year === currentYm.year && b.month === currentYm.month
    );
    let rowSaldo: number | null = null;
    if (isCurrentMonthRow && b.teacherKey !== '__unassigned__' && b.studentKeys.size > 0) {
      let allUnequivocal = true;
      let sumSaldo = 0;
      for (const sk of b.studentKeys) {
        if (sk === 'unknown_student') {
          allUnequivocal = false;
          break;
        }
        const persistedBal = studentPersistedBalance.get(sk) ?? null;
        if (persistedBal === null) {
          allUnequivocal = false;
          break;
        }
        const assocTeachers = studentAssociatedTeachers.get(sk);
        if (!assocTeachers || assocTeachers.size !== 1 || !assocTeachers.has(b.teacherKey)) {
          allUnequivocal = false;
          break;
        }
        sumSaldo += persistedBal;
      }
      if (allUnequivocal) {
        rowSaldo = sumSaldo;
      }
    }

    const row: OperationsRow = {
      rowKey: b.rowKey,
      year: b.year,
      month: b.month,
      country: b.country,
      teacherKey: b.teacherKey,
      nativeFriendName: b.nativeFriendName,
      nativeFriendEmail: b.nativeFriendEmail,
      studentsCount: b.studentKeys.size,
      aulasContratadas: b.aulasContratadas,
      paidContractedLessons: b.paidContractedLessons,
      adminGrantedLessons: b.adminGrantedLessons,
      atendidas: b.atendidas,
      trialAtendidas: b.trialAtendidas,
      saldo: rowSaldo,
      aulaUsd,
      comissaoMarkupPercent,
      aulaBrl,
      faturamentoBrl,
      custoPlataformaBrl,
      custoNativeFriendBrl,
      lucroBrl,
      grossPlatformShareBrl,
      paidTransactionsCount: b.paidTransactionsCount,
      adminTransactionsCount: b.adminTransactionsCount,
      hasMixedPricingSnapshots,
    };

    const aliases = teachersByKey.get(b.teacherKey)?.aliases || new Set([b.teacherKey]);
    allEntries.push({ row, studentKeys: b.studentKeys, aliases });
  }

  // Ensure approved/active tutors also appear in the teacher filter dropdown even if 0 records yet
  for (const t of tutors) {
    if (!t || t.deleted === true) continue;
    const prof = resolveTeacherFromFields({
      teacherUid: t.uid || t.authUid || t.id,
      teacherEmail: t.email,
      teacherName: t.name,
    });
    if (prof && !allTeachersMap.has(prof.teacherKey)) {
      allTeachersMap.set(prof.teacherKey, {
        teacherKey: prof.teacherKey,
        name: prof.name,
        country: prof.country,
      });
    }
    if (prof?.country && prof.country.trim() !== '') {
      allCountrySet.add(prof.country.trim());
    }
  }

  // 7. Apply filters
  const filterYear =
    typeof input.filters?.year === 'number' && Number.isInteger(input.filters.year)
      ? input.filters.year
      : 'all';
  const filterMonth =
    typeof input.filters?.month === 'number' &&
    Number.isInteger(input.filters.month) &&
    input.filters.month >= 1 &&
    input.filters.month <= 12
      ? input.filters.month
      : 'all';
  const rawCountryFilter =
    typeof input.filters?.country === 'string' && input.filters.country.trim() !== ''
      ? input.filters.country.trim()
      : 'all';
  const rawTeacherFilter =
    typeof input.filters?.teacherUid === 'string' && input.filters.teacherUid.trim() !== ''
      ? input.filters.teacherUid.trim()
      : 'all';

  const resolvedFilterTeacherKey =
    rawTeacherFilter === 'all'
      ? 'all'
      : aliasToTeacherKey.get(rawTeacherFilter) ||
        aliasToTeacherKey.get(rawTeacherFilter.toLowerCase()) ||
        rawTeacherFilter;

  const filteredEntries = allEntries.filter(({ row, aliases }) => {
    if (filterYear !== 'all' && row.year !== filterYear) return false;
    if (filterMonth !== 'all' && row.month !== filterMonth) return false;
    if (rawCountryFilter !== 'all') {
      if (rawCountryFilter === '__nd__') {
        if (row.country && row.country.trim() !== '') return false;
      } else {
        if ((row.country || '').trim().toLowerCase() !== rawCountryFilter.toLowerCase()) {
          return false;
        }
      }
    }
    if (resolvedFilterTeacherKey !== 'all') {
      const matches =
        row.teacherKey === resolvedFilterTeacherKey ||
        aliases.has(resolvedFilterTeacherKey) ||
        aliases.has(rawTeacherFilter);
      if (!matches) return false;
    }
    return true;
  });

  filteredEntries.sort((a, b) => {
    if (b.row.year !== a.row.year) return b.row.year - a.row.year;
    if (b.row.month !== a.row.month) return b.row.month - a.row.month;
    return a.row.nativeFriendName.localeCompare(b.row.nativeFriendName, 'pt-BR', {
      sensitivity: 'base',
    });
  });

  // 8. Compute filtered KPIs strictly from filtered rows without inventing data
  const distinctStudents = new Set<string>();
  let aulasContratadas = 0;
  let paidContractedLessons = 0;
  let adminGrantedLessons = 0;
  let atendidas = 0;

  let paidRowCount = 0;
  let missingRevenueRow = false;
  let faturamentoCents = 0;

  let allPlatformCostsPresent = true;
  let custoPlataformaCents = 0;

  let allTeacherSharesPresent = true;
  let custoNativeFriendCents = 0;

  let allLucrosPresent = true;
  let lucroCents = 0;

  let anyGrossShare = false;
  let grossShareCents = 0;

  for (const { row, studentKeys } of filteredEntries) {
    for (const sk of studentKeys) distinctStudents.add(sk);
    aulasContratadas += row.aulasContratadas;
    paidContractedLessons += row.paidContractedLessons;
    adminGrantedLessons += row.adminGrantedLessons;
    atendidas += row.atendidas;

    if (row.faturamentoBrl === null) {
      missingRevenueRow = true;
    } else {
      faturamentoCents += toCents(row.faturamentoBrl);
    }

    if (row.paidTransactionsCount > 0) {
      paidRowCount += 1;
      if (row.custoPlataformaBrl === null) {
        allPlatformCostsPresent = false;
      } else {
        custoPlataformaCents += toCents(row.custoPlataformaBrl);
      }

      if (row.custoNativeFriendBrl === null) {
        allTeacherSharesPresent = false;
      } else {
        custoNativeFriendCents += toCents(row.custoNativeFriendBrl);
      }

      if (row.lucroBrl === null) {
        allLucrosPresent = false;
      } else {
        lucroCents += toCents(row.lucroBrl);
      }

      if (row.grossPlatformShareBrl !== null) {
        anyGrossShare = true;
        grossShareCents += toCents(row.grossPlatformShareBrl);
      }
    }
  }

  // ADM.OPS.3: Compute consolidated distinct student Saldo KPI
  // - Never present current balance as historical balance of previous/non-current months.
  // - When filtered by teacherUid or country, show balance only if every student in the slice
  //   is unequivocally attributed to that teacher/country; otherwise null (N/D).
  // - Across multiple/all teachers, sum each distinct student's canonical persisted balance once.
  const isNonCurrentPeriodFilter = Boolean(
    currentYm &&
      ((filterYear !== 'all' && filterYear !== currentYm.year) ||
        (filterMonth !== 'all' && filterMonth !== currentYm.month))
  );

  let kpiSaldo: number | null = null;
  if (!isNonCurrentPeriodFilter) {
    if (distinctStudents.size === 0) {
      kpiSaldo = 0;
    } else if (resolvedFilterTeacherKey === '__unassigned__') {
      kpiSaldo = null;
    } else {
      let validSaldo = true;
      let hasAnyPersisted = false;
      let sumDistinctSaldo = 0;

      for (const sk of distinctStudents) {
        if (sk === 'unknown_student') {
          validSaldo = false;
          break;
        }
        const persistedBal = studentPersistedBalance.get(sk) ?? null;
        if (persistedBal === null) {
          if (studentHadCreditActivity.has(sk)) {
            validSaldo = false;
            break;
          }
          continue;
        }
        hasAnyPersisted = true;

        if (resolvedFilterTeacherKey !== 'all') {
          const assocTeachers = studentAssociatedTeachers.get(sk);
          if (!assocTeachers || assocTeachers.size !== 1 || !assocTeachers.has(resolvedFilterTeacherKey)) {
            validSaldo = false;
            break;
          }
        } else if (rawCountryFilter !== 'all') {
          const assocTeachers = studentAssociatedTeachers.get(sk);
          if (!assocTeachers || assocTeachers.size === 0) {
            validSaldo = false;
            break;
          }
          let allTeachersMatchCountry = true;
          for (const tKey of assocTeachers) {
            const tCountry = (teachersByKey.get(tKey)?.country || '').trim();
            if (rawCountryFilter === '__nd__') {
              if (tCountry !== '') {
                allTeachersMatchCountry = false;
                break;
              }
            } else if (tCountry.toLowerCase() !== rawCountryFilter.toLowerCase()) {
              allTeachersMatchCountry = false;
              break;
            }
          }
          if (!allTeachersMatchCountry) {
            validSaldo = false;
            break;
          }
        }

        sumDistinctSaldo += persistedBal;
      }

      if (validSaldo && hasAnyPersisted) {
        kpiSaldo = sumDistinctSaldo;
      }
    }
  }

  const kpis: OperationsKpis = {
    alunosCount: distinctStudents.size,
    aulasContratadas,
    paidContractedLessons,
    adminGrantedLessons,
    atendidas,
    saldo: kpiSaldo,
    faturamentoBrl: missingRevenueRow ? null : fromCents(faturamentoCents),
    custoPlataformaBrl:
      paidRowCount > 0 && allPlatformCostsPresent ? fromCents(custoPlataformaCents) : null,
    custoNativeFriendBrl:
      paidRowCount > 0 && allTeacherSharesPresent ? fromCents(custoNativeFriendCents) : null,
    lucroBrl: paidRowCount > 0 && allLucrosPresent ? fromCents(lucroCents) : null,
    grossPlatformShareBrl: paidRowCount > 0 && anyGrossShare ? fromCents(grossShareCents) : null,
  };

  return {
    generatedAt: input.generatedAt || new Date().toISOString(),
    timezone: OPERATIONS_TIMEZONE,
    dataSource: 'firestore_default',
    filtersApplied: {
      year: filterYear,
      month: filterMonth,
      country: rawCountryFilter,
      teacherUid: resolvedFilterTeacherKey,
    },
    filterOptions: {
      years: Array.from(allYearSet).sort((a, b) => b - a),
      months: Array.from(allMonthSet).sort((a, b) => a - b),
      countries: Array.from(allCountrySet).sort((a, b) =>
        a.localeCompare(b, 'en', { sensitivity: 'base' })
      ),
      hasMissingCountry,
      teachers: Array.from(allTeachersMap.values()).sort((a, b) =>
        a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' })
      ),
    },
    kpis,
    rows: filteredEntries.map((e) => e.row),
  };
}
