import { DayOfWeek, RoutineItem } from '../types';
import { getAuthHeaders } from '../hooks/useRoutine';
import { normalizeStudentIdForPath, withFirestoreTimeout } from '../utils/routineSync';
import { normalizeStudentLevel } from '../utils/spotify';
import { cacheWeeklyChecksLocally } from '../utils/studentPersistence';
import { defaultRoutinesByDay } from '../data/defaultRoutines';
import { isSyntheticLegacyUid } from '../utils/tutorConsolidation';

export interface StartNewWeekParams {
  studentEmail: string;
  studentUid: string;
  weeklyStudyDaysTarget?: number;
  weeklyStudyDays?: DayOfWeek[];
  currentCycle?: number;
  studentLevel?: string;
  currentRoutines?: Record<DayOfWeek, RoutineItem[]>;
}

export interface StartNewWeekResult {
  success: boolean;
  weeklyCycle: number;
  weeklyStudyDaysTarget: number;
  weeklyStudyDays: DayOfWeek[];
  routines: Record<DayOfWeek, RoutineItem[]>;
  message: string;
}

const ALL_DAYS: DayOfWeek[] = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
];

const GENERIC_PLACEHOLDER_EMAILS = new Set([
  'aluno@itssimple.com',
  'student@itssimple.com',
  'user@example.com',
  'test@example.com',
]);

/**
 * ARCH.2E.2D: Executes the canonical "Start New Week" lifecycle via authenticated backend orchestration:
 * - Validates canonical UID (rejects synthetic usr-, st-, tutor- IDs)
 * - Issues a single idempotent POST /api/student-routines/start-new-week with expectedCycle and attemptId
 * - On HTTP timeout/network failure, queries GET /api/student-routines/cycle-status to confirm or recover
 * - Never executes direct Firebase Web SDK Firestore writes or independent post-advance resets
 */
export async function executeStartNewWeek(
  params: StartNewWeekParams
): Promise<StartNewWeekResult | null> {
  const { studentEmail, studentUid, weeklyStudyDaysTarget, weeklyStudyDays } = params;
  const targetDays = weeklyStudyDaysTarget || 7;
  const chosenDays = weeklyStudyDays && weeklyStudyDays.length > 0 ? weeklyStudyDays : ALL_DAYS;

  const rawUid = (studentUid || '').trim();
  const rawEmail = (studentEmail || '').trim().toLowerCase();
  const isPlaceholder = !rawEmail || GENERIC_PLACEHOLDER_EMAILS.has(rawEmail) || rawEmail.includes('aluno@');

  if (!rawUid || isSyntheticLegacyUid(rawUid)) {
    return {
      success: false,
      weeklyCycle: params.currentCycle || 1,
      weeklyStudyDaysTarget: targetDays,
      weeklyStudyDays: chosenDays,
      routines: params.currentRoutines || ({} as any),
      message: 'Canonical Firebase Auth UID is required to start a new week.',
    };
  }

  const cleanUid = normalizeStudentIdForPath(rawUid) || rawUid;
  const expectedCycle =
    typeof params.currentCycle === 'number' && Number.isSafeInteger(params.currentCycle) && params.currentCycle > 0
      ? params.currentCycle
      : 1;

  try {
    const normLevel = normalizeStudentLevel(params.studentLevel || 'intermediate');
    const attemptId = `start_week_${cleanUid}_cycle${expectedCycle}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    let authHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
    try {
      const routineHeaders = await getAuthHeaders();
      authHeaders = { ...authHeaders, ...routineHeaders };
    } catch {}

    let data: any = null;
    let requestTimedOutOrErrored = false;

    try {
      const fetchPromise = fetch('/api/student-routines/start-new-week', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          studentEmail: !isPlaceholder ? rawEmail : '',
          uid: cleanUid,
          studentUid: cleanUid,
          expectedCycle,
          attemptId,
          weeklyStudyDaysTarget: targetDays,
          weeklyStudyDays: chosenDays,
          studentLevel: normLevel,
          resetTopicsToChooseTopic: true,
        }),
      });

      const res = await withFirestoreTimeout(fetchPromise, 8000, null as any);

      if (res) {
        if (res.status === 409) {
          const conflictData = await res.json().catch(() => ({}));
          console.warn('Start a New Week cycle conflict returned by server:', conflictData);
          return {
            success: false,
            weeklyCycle: conflictData.persistedCycle || conflictData.currentCycle || expectedCycle,
            weeklyStudyDaysTarget: targetDays,
            weeklyStudyDays: chosenDays,
            routines: params.currentRoutines || ({} as any),
            message: conflictData.message || 'Cycle conflict: the current cycle diverged. Please refresh the page.',
          };
        } else if (res.ok) {
          data = await res.json();
          if (!data || data.success !== true) {
            return {
              success: false,
              weeklyCycle: expectedCycle,
              weeklyStudyDaysTarget: targetDays,
              weeklyStudyDays: chosenDays,
              routines: params.currentRoutines || ({} as any),
              message: data?.message || 'Server did not confirm new week activation.',
            };
          }
        } else {
          console.error('Backend start-new-week call returned error status:', res.status);
          const errData = await res.json().catch(() => ({}));
          return {
            success: false,
            weeklyCycle: expectedCycle,
            weeklyStudyDaysTarget: targetDays,
            weeklyStudyDays: chosenDays,
            routines: params.currentRoutines || ({} as any),
            message: errData.message || `Backend error ${res.status} while starting new week.`,
          };
        }
      } else {
        requestTimedOutOrErrored = true;
      }
    } catch (netErr) {
      console.warn('Network or timeout notice during start-new-week:', netErr);
      requestTimedOutOrErrored = true;
    }

    // Timeout & network failure recovery verification via GET /api/student-routines/cycle-status
    if (requestTimedOutOrErrored && !data) {
      console.warn('Start new week response did not arrive. Performing recovery inquiry with backend...');
      try {
        const queryUrl = `/api/student-routines/cycle-status?studentUid=${encodeURIComponent(cleanUid)}&attemptId=${encodeURIComponent(attemptId)}`;
        const statusRes = await withFirestoreTimeout(
          fetch(queryUrl, { method: 'GET', headers: authHeaders }),
          4500,
          null as any
        );

        if (statusRes && statusRes.ok) {
          const statusData = await statusRes.json();
          const confirmedCycle = statusData.currentCycle || statusData.weeklyCycle;
          const isPending = Boolean(statusData.preparationPending);
          const attemptWasConfirmed = Boolean(
            (statusData.attemptConfirmed || statusData.lastCycleAttemptId === attemptId) && !isPending
          );

          if (!isPending && (attemptWasConfirmed || confirmedCycle === expectedCycle + 1)) {
            console.info('Recovery confirmed: start-new-week was successfully committed on the server despite HTTP timeout.');
            data = statusData.lastCycleResult || {
              success: true,
              weeklyCycle: confirmedCycle,
              weeklyStudyDaysTarget: statusData.weeklyStudyDaysTarget || targetDays,
              weeklyStudyDays: statusData.weeklyStudyDays || chosenDays,
              routines: statusData.routines,
              message: 'New weekly cycle activated successfully (recovered).',
            };
          } else if (confirmedCycle === expectedCycle && !attemptWasConfirmed) {
            console.warn('Recovery confirmed: advance was NOT executed before failure.');
            return {
              success: false,
              weeklyCycle: expectedCycle,
              weeklyStudyDaysTarget: targetDays,
              weeklyStudyDays: chosenDays,
              routines: params.currentRoutines || ({} as any),
              message: 'Cycle advance was not executed. Please try again.',
            };
          } else {
            console.warn('Recovery returned uncertain or incomplete status:', statusData);
            return {
              success: false,
              weeklyCycle: confirmedCycle || expectedCycle,
              weeklyStudyDaysTarget: targetDays,
              weeklyStudyDays: chosenDays,
              routines: params.currentRoutines || ({} as any),
              message: 'Synchronization incomplete or uncertain. Please refresh and verify your current cycle.',
            };
          }
        } else {
          return {
            success: false,
            weeklyCycle: expectedCycle,
            weeklyStudyDaysTarget: targetDays,
            weeklyStudyDays: chosenDays,
            routines: params.currentRoutines || ({} as any),
            message: 'Request timed out and cycle status could not be verified. Please check connection and refresh.',
          };
        }
      } catch (recoveryErr) {
        console.error('Error during cycle recovery check:', recoveryErr);
        return {
          success: false,
          weeklyCycle: expectedCycle,
          weeklyStudyDaysTarget: targetDays,
          weeklyStudyDays: chosenDays,
          routines: params.currentRoutines || ({} as any),
          message: 'Connection timed out and synchronization could not be verified. Please refresh.',
        };
      }
    }

    if (!data || typeof data.weeklyCycle !== 'number') {
      return {
        success: false,
        weeklyCycle: expectedCycle,
        weeklyStudyDaysTarget: targetDays,
        weeklyStudyDays: chosenDays,
        routines: params.currentRoutines || ({} as any),
        message: 'Server did not return a confirmed weeklyCycle.',
      };
    }

    // Construct clean, sanitized routines from server response
    const rawRoutines = data.routines || {};
    const sanitizedRoutines: Record<DayOfWeek, RoutineItem[]> = {} as any;
    ALL_DAYS.forEach((day) => {
      const candidateList = rawRoutines[day] || defaultRoutinesByDay[day] || [];
      const dayList = candidateList.length > 0 ? candidateList : (defaultRoutinesByDay[day] || []);
      sanitizedRoutines[day] = dayList.map((act: any) => {
        const isVideoAct =
          act.id?.endsWith('1') ||
          act.activityName?.toLowerCase().includes('vídeo') ||
          act.activityName?.toLowerCase().includes('video') ||
          act.activityName === 'Your Suggestion' ||
          act.activityName === 'Sua Sugestão' ||
          Boolean(act.playlistId) ||
          Boolean(act.playlistTitle) ||
          Boolean(act.isRepeatVideo) ||
          (act.teacherVideos && act.teacherVideos.length > 0);

        if (isVideoAct) {
          return {
            ...act,
            activityName: 'Video of the Day',
            playlistId: '',
            playlistTitle: '',
            teacherVideos: [],
            learnedWords: [],
            completed: false,
            completedToday: false,
            completedVideoToday: false,
            completedAudioToday: false,
            isRepeatVideo: false,
            repeatVideo: false,
          };
        }

        return {
          ...act,
          learnedWords: [],
          completed: false,
          completedToday: false,
          completedVideoToday: false,
          completedAudioToday: false,
          isRepeatVideo: false,
          repeatVideo: false,
        };
      });
    });

    const finalCycle = data.weeklyCycle;
    const finalWeekId = `week-${finalCycle}`;

    // Initialize local in-memory S-Path cache for the confirmed new cycle (backend already persisted canonical checks)
    cacheWeeklyChecksLocally(cleanUid, !isPlaceholder ? rawEmail : undefined, {}, finalWeekId);

    return {
      success: true,
      weeklyCycle: finalCycle,
      weeklyStudyDaysTarget: data.weeklyStudyDaysTarget || targetDays,
      weeklyStudyDays: data.weeklyStudyDays || chosenDays,
      routines: sanitizedRoutines,
      message: data.message || 'New week cycle started successfully with all days ready for Choose a Topic.',
    };
  } catch (unexpectedError) {
    console.error('Critical error in executeStartNewWeek, reporting backend failure:', unexpectedError);
    return {
      success: false,
      weeklyCycle: expectedCycle,
      weeklyStudyDaysTarget: targetDays,
      weeklyStudyDays: chosenDays,
      routines: params.currentRoutines || ({} as any),
      message: 'Critical error starting new week cycle.',
    };
  }
}
