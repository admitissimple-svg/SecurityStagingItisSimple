import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  CurrentSpotifyTrack,
  StudentCurrentRoutineDoc,
  StudentTrackFeedback,
  subscribeStudentCurrentRoutine,
  saveNativeFriendTrackFeedback,
  normalizeStudentIdForPath,
} from '../utils/routineSync';
import { DayOfWeek, StudentJournalEntry } from '../types';
import { getStudentCurrentDayOfWeek, sanitizeTimeZone, DEFAULT_STUDENT_TIMEZONE } from '../utils/timezone';
import { selectCurrentDaySpotifyTrack, normalizeStudentLevel } from '../utils/spotify';
import { verifyStudentNativeFriendLink } from './useStudentHistory';
import { subscribeToStudentJournal, fetchStudentJournalActivitiesFromFirestore } from '../utils/studentPersistence';

export interface UseNativeFriendStudentSyncParams {
  studentUid?: string;
  studentEmail?: string;
  studentName?: string;
  teacherUid?: string;
  teacherName?: string;
  teacherEmail?: string;
  weekId?: string;
  weeklyCycle?: number;
  studentTimezone?: string;
  activeStudyDays?: DayOfWeek[];
  activeStudyDaysCount?: number;
  studentLevel?: string;
}

export function useNativeFriendStudentSync(params: UseNativeFriendStudentSyncParams) {
  const {
    studentUid,
    studentEmail,
    teacherUid,
    teacherName,
    teacherEmail,
    weekId,
    weeklyCycle,
    studentTimezone,
    activeStudyDays,
    activeStudyDaysCount,
    studentLevel,
  } = params;

  const [routineDoc, setRoutineDoc] = useState<StudentCurrentRoutineDoc | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isAuthorized, setIsAuthorized] = useState<boolean>(false);
  const [isSavingFeedback, setIsSavingFeedback] = useState<boolean>(false);
  const [feedbackSuccess, setFeedbackSuccess] = useState<boolean>(false);

  const effectiveUid = normalizeStudentIdForPath(studentUid || studentEmail || '');
  const cleanTeacherUid = (teacherUid || '').trim();
  const effectiveTz = sanitizeTimeZone(studentTimezone || DEFAULT_STUDENT_TIMEZONE);

  // Accurately resolve student's current day in their local timezone
  const todayInStudentTz = useMemo(() => {
    return getStudentCurrentDayOfWeek(effectiveTz);
  }, [effectiveTz]);

  // Determine active study days for this student (default: Mon-Fri = 5 days)
  const effectiveStudyDays = useMemo<DayOfWeek[]>(() => {
    if (activeStudyDays && activeStudyDays.length > 0) {
      return activeStudyDays;
    }
    const default5x: DayOfWeek[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
    if (activeStudyDaysCount && activeStudyDaysCount < 5) {
      return default5x.slice(0, activeStudyDaysCount);
    }
    if (activeStudyDaysCount === 7) {
      return ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    }
    return default5x;
  }, [activeStudyDays, activeStudyDaysCount]);

  // Check if today is an active study day or Rest Day
  const isRestDay = useMemo(() => {
    return !effectiveStudyDays.includes(todayInStudentTz);
  }, [effectiveStudyDays, todayInStudentTz]);

  // Determine the effective weekId
  const effectiveWeekId = useMemo(() => {
    if (weekId && weekId !== 'week-1') return weekId;
    if (weeklyCycle) return `week-${weeklyCycle}`;
    return 'weekData';
  }, [weekId, weeklyCycle]);

  // 1. Immediate state reset on student change to eliminate cross-profile data leakage
  useEffect(() => {
    setRoutineDoc(null);
    setIsAuthorized(false);
  }, [effectiveUid]);

  // 2. Strict UID Link Authorization Check
  // Ensures Native Friend can NEVER list, view, or listen to unauthorized student data
  useEffect(() => {
    let active = true;

    async function checkLink() {
      if (!effectiveUid) {
        if (active) {
          setIsAuthorized(false);
          setIsLoading(false);
        }
        return;
      }

      // If no teacher UID provided, this is the student accessing their own view
      if (!cleanTeacherUid) {
        if (active) {
          setIsAuthorized(true);
        }
        return;
      }

      setIsLoading(true);
      const isLinked = await verifyStudentNativeFriendLink(effectiveUid, cleanTeacherUid, studentEmail);
      if (active) {
        setIsAuthorized(isLinked);
        if (!isLinked) {
          setRoutineDoc(null);
          setIsLoading(false);
        }
      }
    }

    checkLink();

    return () => {
      active = false;
    };
  }, [effectiveUid, cleanTeacherUid, studentEmail]);

  // 3. Subscribe in real time to Firestore ONLY if authorized by UID
  const [studentJournal, setStudentJournal] = useState<StudentJournalEntry[]>([]);

  useEffect(() => {
    if (!effectiveUid || !isAuthorized) {
      setStudentJournal([]);
      return;
    }
    fetchStudentJournalActivitiesFromFirestore(effectiveUid, studentEmail).then((items) => {
      if (Array.isArray(items) && items.length > 0) {
        setStudentJournal(items);
      }
    });
    const unsubJournal = subscribeToStudentJournal(effectiveUid, studentEmail, (items) => {
      if (Array.isArray(items)) {
        setStudentJournal(items);
      }
    });
    return () => unsubJournal();
  }, [effectiveUid, studentEmail, isAuthorized]);

  useEffect(() => {
    if (!effectiveUid || !isAuthorized) {
      setRoutineDoc(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);

    const unsubscribe = subscribeStudentCurrentRoutine(
      effectiveUid,
      effectiveWeekId,
      (data) => {
        setRoutineDoc(data);
        setIsLoading(false);
      },
      {
        currentDayOfWeek: todayInStudentTz,
        studentTimezone: effectiveTz,
      }
    );

    return () => {
      unsubscribe();
    };
  }, [effectiveUid, effectiveWeekId, todayInStudentTz, effectiveTz, isAuthorized]);

  // 3. Resolve the active Spotify track for today
  const currentSpotifyTrack = useMemo<CurrentSpotifyTrack | null>(() => {
    if (!isAuthorized || isRestDay) {
      return null;
    }

    // A. Track explicitly recorded in Firestore
    if (routineDoc?.currentSpotifyTrack) {
      return routineDoc.currentSpotifyTrack;
    }

    // B. Real-time deterministic scheduled track for today's active study day with studentJournal exclusivity
    const normalizedLvl = normalizeStudentLevel(studentLevel || 'intermediate');
    const computed = selectCurrentDaySpotifyTrack({
      level: normalizedLvl,
      selectedDay: todayInStudentTz,
      activeStudyDays: effectiveStudyDays,
      weeklyCycle: weeklyCycle || 5,
      studentJournal: studentJournal.length > 0 ? studentJournal : ((routineDoc as any)?.studentJournal || []),
    });

    if (computed) {
      return {
        id: computed.trackId || (computed as any).id || 'spotify-daily-track',
        title: computed.title,
        artist: computed.artist,
        coverUrl: computed.imageUrl || (computed.albumImages && computed.albumImages[0]?.url) || '',
        dayOfWeek: todayInStudentTz,
        url: computed.url,
        level: normalizedLvl,
      };
    }

    return null;
  }, [isAuthorized, isRestDay, routineDoc?.currentSpotifyTrack, studentLevel, todayInStudentTz, effectiveStudyDays, weeklyCycle]);

  // Teacher feedback for the active day
  const teacherFeedback: StudentTrackFeedback | null = useMemo(() => {
    if (!routineDoc?.teacherFeedback) return null;
    const dayKey = currentSpotifyTrack?.dayOfWeek || todayInStudentTz;
    const fb = routineDoc.teacherFeedback[dayKey] || null;
    if (!fb) return null;

    // Strict UID verification: only return feedback from assigned Native Friend
    if (cleanTeacherUid && fb.teacherUid && fb.teacherUid !== cleanTeacherUid) {
      return null;
    }
    return fb;
  }, [routineDoc?.teacherFeedback, currentSpotifyTrack?.dayOfWeek, todayInStudentTz, cleanTeacherUid]);

  // 4. Send feedback/recommendations to student (strictly gated by UID authorization)
  const sendFeedback = useCallback(
    async (comment: string, recommendation?: string) => {
      if (!effectiveUid || !cleanTeacherUid || !isAuthorized) {
        console.warn('Feedback blocked: UID pairing not authorized');
        return false;
      }
      const targetTrackId = currentSpotifyTrack?.id || 'daily-track';
      const targetDay = currentSpotifyTrack?.dayOfWeek || todayInStudentTz;

      setIsSavingFeedback(true);
      setFeedbackSuccess(false);

      try {
        const success = await saveNativeFriendTrackFeedback(effectiveUid, effectiveWeekId, {
          teacherUid: cleanTeacherUid,
          teacherName,
          teacherEmail,
          dayOfWeek: targetDay,
          trackId: targetTrackId,
          comment,
          recommendation,
        });

        if (success) {
          setFeedbackSuccess(true);
          // Optimistically update local routineDoc state
          setRoutineDoc((prev) => {
            const base = prev || {
              studentUid: effectiveUid,
              weekId: effectiveWeekId,
              updatedAt: new Date().toISOString(),
            };
            return {
              ...base,
              teacherFeedback: {
                ...(base.teacherFeedback || {}),
                [targetDay]: {
                  studentUid: effectiveUid,
                  teacherUid: cleanTeacherUid,
                  teacherName,
                  teacherEmail,
                  dayOfWeek: targetDay,
                  trackId: targetTrackId,
                  comment,
                  recommendation,
                  createdAt: new Date().toISOString(),
                },
              },
            };
          });
          setTimeout(() => setFeedbackSuccess(false), 4000);
        }
        return success;
      } catch (err) {
        console.error('Failed to send Native Friend feedback:', err);
        return false;
      } finally {
        setIsSavingFeedback(false);
      }
    },
    [effectiveUid, cleanTeacherUid, isAuthorized, teacherName, teacherEmail, currentSpotifyTrack, todayInStudentTz, effectiveWeekId]
  );

  return {
    routineDoc,
    currentSpotifyTrack,
    teacherFeedback,
    todayInStudentTz,
    isRestDay,
    isLoading,
    isAuthorized,
    isSavingFeedback,
    feedbackSuccess,
    sendFeedback,
  };
}
