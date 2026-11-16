import { DayOfWeek, LiveLesson, UserProfile, WeeklyHistoryDoc } from '../types';
import {
  DEFAULT_STUDENT_TIMEZONE,
  getIsoDateInTimeZone,
  getStudentCurrentDayOfWeek,
  sanitizeTimeZone,
} from './timezone';

export interface ActiveCycleBoundary {
  activeCycle: number;
  /**
   * Epoch timestamp (ms) marking the start of the active cycle.
   * - `null` when `activeCycle === 1` (initial cycle with no closed prior cycle).
   * - `number` when `activeCycle >= 2` and a persisted boundary (`cycleTransition` or closed `weeklyHistory`) exists.
   */
  cycleStartMs: number | null;
  /**
   * True when the active cycle boundary is reliably verified.
   * When `activeCycle >= 2` and no boundary is available, this is false (fail-closed against phantom lessons).
   */
  hasVerifiedBoundary: boolean;
  source: 'initial_cycle_1' | 'cycle_transition' | 'closed_weekly_history' | 'unverified';
}

function parsePositiveCycleInt(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }
  if (typeof value === 'string') {
    const clean = value.trim().toLowerCase();
    if (!clean) return null;
    const raw = clean.startsWith('week-') ? clean.slice(5) : clean;
    if (!/^[0-9]+$/.test(raw)) return null;
    const parsed = Number(raw);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

function parseValidTimestampMs(isoOrDate?: string | null): number | null {
  if (!isoOrDate || typeof isoOrDate !== 'string') return null;
  const trimmed = isoOrDate.trim();
  if (!trimmed) return null;
  const ms = Date.parse(trimmed);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Resolves the active weeklyCycle start boundary strictly from persisted metadata:
 * - `userProfile.weeklyCycle`
 * - `userProfile.cycleTransition` (`startedAt` / `completedAt` matching `targetCycle === activeCycle`)
 * - `weeklyHistories` (`closedAt` of closed previous cycle `activeCycle - 1`)
 *
 * Never infers a new cycle from calendar week rollovers (e.g., Monday).
 */
export function resolveActiveCycleBoundary(
  userProfile?: Partial<UserProfile> | null,
  weeklyHistories?: WeeklyHistoryDoc[] | null
): ActiveCycleBoundary {
  const activeCycle = parsePositiveCycleInt(userProfile?.weeklyCycle) ?? 1;

  if (activeCycle === 1) {
    return {
      activeCycle: 1,
      cycleStartMs: null,
      hasVerifiedBoundary: true,
      source: 'initial_cycle_1',
    };
  }

  // 1. Primary authoritative boundary: cycleTransition persisted on users/{uid} for targetCycle === activeCycle
  const tr = userProfile?.cycleTransition;
  if (tr && parsePositiveCycleInt(tr.targetCycle) === activeCycle) {
    const trStartMs = parseValidTimestampMs(tr.startedAt) ?? parseValidTimestampMs(tr.completedAt);
    if (trStartMs !== null) {
      return {
        activeCycle,
        cycleStartMs: trStartMs,
        hasVerifiedBoundary: true,
        source: 'cycle_transition',
      };
    }
  }

  // 2. Redundant authoritative boundary: closedAt on weeklyHistory/week-{activeCycle - 1}
  if (Array.isArray(weeklyHistories) && weeklyHistories.length > 0) {
    const prevCycle = activeCycle - 1;
    const matchingPrev = weeklyHistories.find((h) => {
      if (!h) return false;
      const hCycle = parsePositiveCycleInt(h.weeklyCycle ?? h.weekId);
      return hCycle === prevCycle && parseValidTimestampMs(h.closedAt) !== null;
    });

    if (matchingPrev) {
      const closedMs = parseValidTimestampMs(matchingPrev.closedAt);
      if (closedMs !== null) {
        return {
          activeCycle,
          cycleStartMs: closedMs,
          hasVerifiedBoundary: true,
          source: 'closed_weekly_history',
        };
      }
    }
  }

  // 3. Fail-closed: if activeCycle >= 2 has no verifiable transition boundary, do not leak prior-cycle lessons.
  return {
    activeCycle,
    cycleStartMs: null,
    hasVerifiedBoundary: false,
    source: 'unverified',
  };
}

/**
 * Verifies whether a single LiveLesson is a legitimate completed lesson belonging
 * to the student's active weeklyCycle (never future, never cancelled, never from closed cycles).
 */
export function isTutorLiveLessonInActiveCycle(
  lesson: LiveLesson | null | undefined,
  params: {
    studentUid?: string;
    studentEmail?: string;
    userProfile?: Partial<UserProfile> | null;
    weeklyHistories?: WeeklyHistoryDoc[] | null;
    refDate?: Date;
    boundary?: ActiveCycleBoundary;
  }
): boolean {
  if (!lesson) return false;

  // HOTFIX 3B.2: Must be completed and not cancelled
  if (lesson.status !== 'completed') return false;
  if (
    Boolean(lesson.cancelledAt) ||
    (lesson.status as string) === 'cancelled' ||
    (lesson.status as string) === 'canceled'
  ) {
    return false;
  }

  // Must belong to authenticated student
  const cleanStudentUid = (params.studentUid || '').trim();
  const cleanStudentEmail = (params.studentEmail || '').toLowerCase().trim();
  const lStudentUid = (lesson.studentUid || '').trim();
  const lStudentEmail = (lesson.studentEmail || '').toLowerCase().trim();

  if (cleanStudentUid && lStudentUid && cleanStudentUid !== lStudentUid) {
    return false;
  }
  const isStudentMatch =
    (Boolean(cleanStudentUid) && Boolean(lStudentUid) && cleanStudentUid === lStudentUid) ||
    (Boolean(cleanStudentEmail) && Boolean(lStudentEmail) && cleanStudentEmail === lStudentEmail);
  if (!isStudentMatch) return false;

  // Must be linked to a legitimate Native Friend
  const userProfile = params.userProfile;
  const assignedTeacherEmail = (userProfile?.teacherEmail || '').toLowerCase().trim();
  const assignedTeacherUid = (
    userProfile?.teacherUid ||
    userProfile?.assignedNativeFriendUID ||
    userProfile?.nativeFriendUID ||
    ''
  ).trim();

  const lTeacherUid = (
    lesson.teacherUid ||
    (lesson as any).tutorUid ||
    (lesson as any).teacherAuthUid ||
    ''
  ).trim();
  const lTeacherPublicId = ((lesson as any).teacherPublicId || '').trim();
  const lTeacherEmail = (lesson.teacherEmail || (lesson as any).tutorEmail || '').toLowerCase().trim();

  if (!lTeacherUid && !lTeacherEmail && !lTeacherPublicId) return false;
  if (assignedTeacherUid && (lTeacherUid || lTeacherPublicId)) {
    const matchesUid =
      (lTeacherUid && assignedTeacherUid === lTeacherUid) ||
      (lTeacherPublicId && assignedTeacherUid === lTeacherPublicId);
    if (!matchesUid) return false;
  }
  if (assignedTeacherEmail && lTeacherEmail && assignedTeacherEmail !== lTeacherEmail) {
    return false;
  }

  // Must have a valid startDateTime and must NOT be a future lesson
  if (!lesson.startDateTime) return false;
  const lessonStartMs = Date.parse(lesson.startDateTime);
  if (Number.isNaN(lessonStartMs)) return false;

  const refDate = params.refDate || new Date();
  const studentTimezone = sanitizeTimeZone(
    userProfile?.timezone || userProfile?.studentTimezone || DEFAULT_STUDENT_TIMEZONE
  );
  const todayCivilDate = getIsoDateInTimeZone(refDate, studentTimezone);
  const lessonCivilDate = getIsoDateInTimeZone(lesson.startDateTime, studentTimezone);
  if (!lessonCivilDate) return false;
  if (todayCivilDate && lessonCivilDate > todayCivilDate) return false;
  if (lessonStartMs > refDate.getTime()) return false;

  // Active weeklyCycle membership verification (never inferred from calendar Monday rollover)
  const boundary =
    params.boundary || resolveActiveCycleBoundary(userProfile, params.weeklyHistories);
  if (!boundary.hasVerifiedBoundary) return false;

  if (
    typeof lesson.weeklyCycle === 'number' &&
    Number.isSafeInteger(lesson.weeklyCycle) &&
    lesson.weeklyCycle > 0 &&
    lesson.weeklyCycle !== boundary.activeCycle
  ) {
    return false;
  }

  if (boundary.cycleStartMs !== null && lessonStartMs < boundary.cycleStartMs) {
    return false;
  }

  return true;
}

/**
 * Evaluates whether `tutor_live` is completed for `dayKey` within the student's active weeklyCycle,
 * computing the lesson's day of the week in the student's timezone.
 */
export function evaluateTutorLiveCompletedForDay(
  dayKey: DayOfWeek,
  lessons: LiveLesson[] | undefined | null,
  studentUid: string,
  studentEmail: string,
  userProfile?: Partial<UserProfile> | null,
  weeklyHistories?: WeeklyHistoryDoc[] | null,
  refDate: Date = new Date()
): boolean {
  if (!Array.isArray(lessons) || lessons.length === 0) {
    return false;
  }

  const boundary = resolveActiveCycleBoundary(userProfile, weeklyHistories);
  if (!boundary.hasVerifiedBoundary) {
    return false;
  }

  const studentTimezone = sanitizeTimeZone(
    userProfile?.timezone || userProfile?.studentTimezone || DEFAULT_STUDENT_TIMEZONE
  );

  return lessons.some((l) => {
    if (
      !isTutorLiveLessonInActiveCycle(l, {
        studentUid,
        studentEmail,
        userProfile,
        weeklyHistories,
        refDate,
        boundary,
      })
    ) {
      return false;
    }

    const lessonDayOfWeek = getStudentCurrentDayOfWeek(
      studentTimezone,
      new Date(l.startDateTime)
    );
    return lessonDayOfWeek === dayKey;
  });
}
