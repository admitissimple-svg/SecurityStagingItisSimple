import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  CurrentSpotifyTrack,
  StudentCurrentRoutineDoc,
  StudentTrackFeedback,
  syncStudentSpotifyTrackToFirestore,
  subscribeStudentCurrentRoutine,
  saveNativeFriendTrackFeedback,
  normalizeStudentIdForPath,
} from '../utils/routineSync';
import { DayOfWeek } from '../types';

/**
 * Hook for the Student:
 * Persists the daily calculated Spotify track to Firestore and receives
 * any teacher feedback/recommendations in real time.
 */
export function useStudentSpotifySync(params: {
  studentUid?: string;
  studentEmail?: string;
  nativeFriendUid?: string;
  nativeFriendEmail?: string;
  weekId?: string;
  currentTrack?: CurrentSpotifyTrack | null;
}) {
  const {
    studentUid,
    studentEmail,
    nativeFriendUid,
    nativeFriendEmail,
    weekId = 'week-1',
    currentTrack,
  } = params;

  const [routineDoc, setRoutineDoc] = useState<StudentCurrentRoutineDoc | null>(null);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);

  const effectiveUid = normalizeStudentIdForPath(studentUid || studentEmail || '');

  // 1. Persist current track whenever it is computed/displayed
  useEffect(() => {
    if (!effectiveUid) return;

    let isMounted = true;
    setIsSyncing(true);

    syncStudentSpotifyTrackToFirestore(effectiveUid, weekId, currentTrack || null, {
      studentEmail,
      nativeFriendUid,
      nativeFriendEmail,
    })
      .then((success) => {
        if (isMounted && success) {
          setLastSyncedAt(new Date().toISOString());
        }
      })
      .finally(() => {
        if (isMounted) setIsSyncing(false);
      });

    return () => {
      isMounted = false;
    };
  }, [
    effectiveUid,
    weekId,
    currentTrack?.id,
    currentTrack?.title,
    currentTrack?.dayOfWeek,
    studentEmail,
    nativeFriendUid,
    nativeFriendEmail,
  ]);

  // 2. Listen in real time for feedback or updates from the Native Friend
  useEffect(() => {
    if (!effectiveUid) return;

    const unsubscribe = subscribeStudentCurrentRoutine(effectiveUid, weekId, (data) => {
      setRoutineDoc(data);
    });

    return () => {
      unsubscribe();
    };
  }, [effectiveUid, weekId]);

  // Read teacher feedback exclusively from the assigned Native Friend
  const filteredTeacherFeedback: Record<string, StudentTrackFeedback> | null = useMemo(() => {
    if (!routineDoc?.teacherFeedback) return null;
    if (!nativeFriendUid) return routineDoc.teacherFeedback as Record<string, StudentTrackFeedback>;

    const cleanTutorUid = nativeFriendUid.trim();
    const cleanTutorEmail = (nativeFriendEmail || '').trim().toLowerCase();
    const result: Record<string, StudentTrackFeedback> = {};

    const rawFeedback = routineDoc.teacherFeedback as Record<string, StudentTrackFeedback>;
    Object.entries(rawFeedback).forEach(([day, fb]) => {
      if (!fb) return;
      const fbTutorUid = (fb.teacherUid || '').trim();
      const fbTutorEmail = (fb.teacherEmail || '').trim().toLowerCase();

      // Enforce strict UID match or verified tutor email match
      if (
        (fbTutorUid && fbTutorUid === cleanTutorUid) ||
        (cleanTutorEmail && fbTutorEmail && fbTutorEmail === cleanTutorEmail) ||
        cleanTutorUid.includes(fbTutorEmail)
      ) {
        result[day] = fb;
      }
    });

    return Object.keys(result).length > 0 ? result : null;
  }, [routineDoc?.teacherFeedback, nativeFriendUid, nativeFriendEmail]);

  return {
    routineDoc,
    isSyncing,
    lastSyncedAt,
    teacherFeedback: filteredTeacherFeedback,
  };
}

/**
 * Hook for the Native Friend / Teacher:
 * Listens in real time via Firestore onSnapshot to the selected student's
 * daily Spotify track, allowing feedback and recommendations.
 */
export function useTeacherStudentRoutineSync(params: {
  studentUid?: string;
  studentEmail?: string;
  teacherUid?: string;
  teacherName?: string;
  teacherEmail?: string;
  weekId?: string;
}) {
  const {
    studentUid,
    studentEmail,
    teacherUid,
    teacherName,
    teacherEmail,
    weekId = 'week-1',
  } = params;

  const effectiveUid = normalizeStudentIdForPath(studentUid || studentEmail || '');
  const [routineDoc, setRoutineDoc] = useState<StudentCurrentRoutineDoc | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSavingFeedback, setIsSavingFeedback] = useState<boolean>(false);
  const [feedbackSuccess, setFeedbackSuccess] = useState<boolean>(false);

  useEffect(() => {
    if (!effectiveUid) {
      setRoutineDoc(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);

    const unsubscribe = subscribeStudentCurrentRoutine(effectiveUid, weekId, (data) => {
      setRoutineDoc(data);
      setIsLoading(false);
    });

    return () => {
      unsubscribe();
    };
  }, [effectiveUid, weekId]);

  const sendFeedback = useCallback(
    async (feedbackData: {
      dayOfWeek: DayOfWeek;
      trackId: string;
      comment: string;
      recommendation?: string;
    }) => {
      if (!effectiveUid) return false;

      setIsSavingFeedback(true);
      setFeedbackSuccess(false);

      const success = await saveNativeFriendTrackFeedback(effectiveUid, weekId, {
        teacherUid: teacherUid || teacherEmail || 'teacher-native-friend',
        teacherName: teacherName || 'Native Friend',
        teacherEmail: teacherEmail || '',
        dayOfWeek: feedbackData.dayOfWeek,
        trackId: feedbackData.trackId,
        comment: feedbackData.comment,
        recommendation: feedbackData.recommendation,
      });

      setIsSavingFeedback(false);
      if (success) {
        setFeedbackSuccess(true);
        setTimeout(() => setFeedbackSuccess(false), 3000);
      }
      return success;
    },
    [effectiveUid, weekId, teacherUid, teacherName, teacherEmail]
  );

  return {
    routineDoc,
    currentSpotifyTrack: routineDoc?.currentSpotifyTrack || null,
    teacherFeedback: routineDoc?.teacherFeedback || null,
    isLoading,
    isSavingFeedback,
    feedbackSuccess,
    sendFeedback,
  };
}
