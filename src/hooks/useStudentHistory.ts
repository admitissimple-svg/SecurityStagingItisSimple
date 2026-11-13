import { useState, useEffect, useCallback, useRef } from 'react';
import { auth } from '../firebase';
import {
  WeeklyHistoryDoc,
  ConsumedVideoItem,
  ConsumedTrackItem,
  WeeklyVocabularyItem,
} from '../types';
import { extractVideoIdFromHistoryItem, getAuthHeaders } from './useRoutine';
import { isSyntheticLegacyUid } from '../utils/tutorConsolidation';

export interface UseStudentHistoryParams {
  studentUid?: string;
  studentEmail?: string;
  weekId?: string;
  weeklyCycle?: number;
  nativeFriendUid?: string; // Teacher UID for strict access validation
  nativeFriendEmail?: string; // Teacher email for authorized validation
}

export interface UseStudentHistoryReturn {
  weeklyHistory: WeeklyHistoryDoc | null;
  allHistories: WeeklyHistoryDoc[];
  accumulatedVideoIds: Set<string>;
  accumulatedTrackIds: Set<string>;
  isAuthorized: boolean;
  isLoading: boolean;
  isSaving: boolean;
  recordVideo: (video: ConsumedVideoItem) => Promise<boolean>;
  recordTrack: (track: ConsumedTrackItem) => Promise<boolean>;
  recordVocabulary: (words: WeeklyVocabularyItem[]) => Promise<boolean>;
  refreshHistory: () => Promise<void>;
}

/**
 * Normalizes UID to clean string
 */
function cleanDocId(id?: string): string {
  if (!id) return '';
  return id.trim();
}

/**
 * Verify strict UID-based linkage between student and Native Friend
 */
export async function verifyStudentNativeFriendLink(
  studentUid: string,
  nativeFriendUid: string,
  studentEmail?: string,
  nativeFriendEmail?: string
): Promise<boolean> {
  const cleanStudent = cleanDocId(studentUid);
  const cleanTeacher = cleanDocId(nativeFriendUid);
  const currentEmail = (nativeFriendEmail || auth?.currentUser?.email || '').toLowerCase().trim();
  if (!cleanStudent) return false;

  // 1. Admin bypass - Admins oversee all students and tutors via verified Custom Claims
  if (auth?.currentUser) {
    try {
      const tokenResult = await auth.currentUser.getIdTokenResult();
      if (tokenResult?.claims?.role === 'admin' || tokenResult?.claims?.admin === true) {
        return true;
      }
    } catch {}
  }

  // 2. Student accessing their own history (only if no teacher is querying)
  if (!cleanTeacher) return true;
  if (!cleanTeacher && auth?.currentUser && (auth.currentUser.uid === cleanStudent || auth.currentUser.email?.toLowerCase().trim() === cleanStudent)) {
    return true;
  }

  const emailToSearch = (studentEmail || (cleanStudent.includes('@') ? cleanStudent : '')).toLowerCase().trim();

  // 3. Authoritative backend verification (Firestore default + lessons + tutor approval)
  try {
    let token: string | null = null;
    try {
      if (auth?.currentUser) {
        token = await auth.currentUser.getIdToken();
      }
    } catch {}
    const studentUidParam = cleanStudent && !cleanStudent.includes('@') && cleanStudent !== cleanTeacher ? cleanStudent : '';
    const resp = await fetch(
      `/api/students/verify-link?studentUid=${encodeURIComponent(studentUidParam)}&studentEmail=${encodeURIComponent(emailToSearch)}&teacherUid=${encodeURIComponent(cleanTeacher)}&teacherEmail=${encodeURIComponent(currentEmail)}`,
      token ? { headers: { Authorization: `Bearer ${token}` } } : undefined
    );
    if (resp.ok) {
      const json = await resp.json();
      if (typeof json.isLinked === 'boolean') {
        return json.isLinked;
      }
    }
  } catch (apiErr) {
    console.warn('Notice querying /api/students/verify-link:', apiErr);
  }

  // Strict default: If not explicitly linked or authorized, return false to prevent cross-profile leakage
  return false;
}

/**
 * Fetch specific weekly history doc via authenticated backend API (Firestore default)
 */
export async function fetchWeeklyHistory(
  studentUid: string,
  weekId: string
): Promise<WeeklyHistoryDoc | null> {
  const cleanStudent = cleanDocId(studentUid);
  const cleanWeek = (weekId || 'week-1').trim();
  if (!cleanStudent || isSyntheticLegacyUid(cleanStudent)) return null;

  try {
    const headers = await getAuthHeaders();
    const res = await fetch(
      `/api/student-history?studentUid=${encodeURIComponent(cleanStudent)}&weekId=${encodeURIComponent(cleanWeek)}`,
      { method: 'GET', headers }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return (data && data.weeklyHistory) || null;
  } catch (err) {
    console.warn(`Failed to fetch weekly history for ${cleanStudent}/${cleanWeek}:`, err);
    return null;
  }
}

/**
 * Fetch all weekly histories for a student via authenticated backend API (Firestore default)
 */
export async function fetchAllWeeklyHistories(studentUid: string): Promise<WeeklyHistoryDoc[]> {
  const cleanStudent = cleanDocId(studentUid);
  if (!cleanStudent || isSyntheticLegacyUid(cleanStudent)) return [];

  try {
    const headers = await getAuthHeaders();
    const res = await fetch(
      `/api/student-history?studentUid=${encodeURIComponent(cleanStudent)}&includeAll=true`,
      { method: 'GET', headers }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data?.allHistories) ? (data.allHistories as WeeklyHistoryDoc[]) : [];
  } catch (err) {
    console.warn(`Failed to fetch all weekly histories for ${cleanStudent}:`, err);
    return [];
  }
}

/**
 * Fetch all accumulated consumed video IDs and track IDs across all historical cycles via backend API
 */
export async function fetchAccumulatedConsumedIds(studentUid: string): Promise<{
  videoIds: Set<string>;
  trackIds: Set<string>;
  allVideos: ConsumedVideoItem[];
  allTracks: ConsumedTrackItem[];
  allVocabulary: WeeklyVocabularyItem[];
}> {
  const videoIds = new Set<string>();
  const trackIds = new Set<string>();
  const allVideos: ConsumedVideoItem[] = [];
  const allTracks: ConsumedTrackItem[] = [];
  const allVocabulary: WeeklyVocabularyItem[] = [];

  const cleanStudent = cleanDocId(studentUid);
  if (!cleanStudent || isSyntheticLegacyUid(cleanStudent)) {
    return { videoIds, trackIds, allVideos, allTracks, allVocabulary };
  }

  try {
    const headers = await getAuthHeaders();
    const res = await fetch(
      `/api/student-history?studentUid=${encodeURIComponent(cleanStudent)}&includeAccumulated=true`,
      { method: 'GET', headers }
    );
    if (res.ok) {
      const data = await res.json();
      const acc = data?.accumulated;
      if (acc) {
        if (Array.isArray(acc.videoIds)) acc.videoIds.forEach((id: string) => id && videoIds.add(id));
        if (Array.isArray(acc.trackIds)) acc.trackIds.forEach((id: string) => id && trackIds.add(id));
        if (Array.isArray(acc.allVideos)) allVideos.push(...acc.allVideos);
        if (Array.isArray(acc.allTracks)) allTracks.push(...acc.allTracks);
        if (Array.isArray(acc.allVocabulary)) allVocabulary.push(...acc.allVocabulary);
      }
    }
  } catch (err) {
    console.warn(`Failed to fetch accumulated consumed IDs for ${cleanStudent}:`, err);
  }

  return { videoIds, trackIds, allVideos, allTracks, allVocabulary };
}

/**
 * Save or merge weekly history document via authenticated backend API
 */
export async function saveWeeklyHistory(
  studentUid: string,
  weekId: string,
  data: Partial<WeeklyHistoryDoc>
): Promise<boolean> {
  const cleanStudent = cleanDocId(studentUid);
  const cleanWeek = (weekId || 'week-1').trim();
  if (!cleanStudent || isSyntheticLegacyUid(cleanStudent)) return false;

  try {
    const headers = await getAuthHeaders();
    const res = await fetch('/api/student-history/record', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        studentUid: cleanStudent,
        weekId: cleanWeek,
        type: 'merge',
        data,
      }),
    });
    if (!res.ok) return false;
    const json = await res.json().catch(() => null);
    return Boolean(json?.success);
  } catch (err) {
    console.error(`Failed to save weekly history for ${cleanStudent}/${cleanWeek}:`, err);
    return false;
  }
}

/**
 * Record a watched video into the weekly history via authenticated backend API
 */
export async function recordConsumedVideo(
  studentUid: string,
  weekId: string,
  video: ConsumedVideoItem,
  nativeFriendUid?: string
): Promise<boolean> {
  const cleanStudent = cleanDocId(studentUid);
  const cleanWeek = (weekId || 'week-1').trim();
  const rawId = video?.videoId || video?.id || '';
  const cleanVidId = extractVideoIdFromHistoryItem(rawId) || rawId.trim();
  if (!cleanStudent || isSyntheticLegacyUid(cleanStudent) || !cleanVidId) return false;

  try {
    const headers = await getAuthHeaders();
    const res = await fetch('/api/student-history/record', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        studentUid: cleanStudent,
        weekId: cleanWeek,
        type: 'video',
        video: {
          ...video,
          id: cleanVidId,
          videoId: cleanVidId,
        },
        ...(nativeFriendUid ? { nativeFriendUid } : {}),
      }),
    });
    if (!res.ok) return false;
    const json = await res.json().catch(() => null);
    return Boolean(json?.success);
  } catch (err) {
    console.error('Failed to record consumed video:', err);
    return false;
  }
}

/**
 * Record a listened Spotify track into the weekly history via authenticated backend API
 */
export async function recordConsumedTrack(
  studentUid: string,
  weekId: string,
  track: ConsumedTrackItem,
  nativeFriendUid?: string
): Promise<boolean> {
  const cleanStudent = cleanDocId(studentUid);
  const cleanWeek = (weekId || 'week-1').trim();
  if (!cleanStudent || isSyntheticLegacyUid(cleanStudent) || !track || (!track.id && !track.trackId)) return false;

  try {
    const headers = await getAuthHeaders();
    const res = await fetch('/api/student-history/record', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        studentUid: cleanStudent,
        weekId: cleanWeek,
        type: 'track',
        track,
        ...(nativeFriendUid ? { nativeFriendUid } : {}),
      }),
    });
    if (!res.ok) return false;
    const json = await res.json().catch(() => null);
    return Boolean(json?.success);
  } catch (err) {
    console.error('Failed to record consumed track:', err);
    return false;
  }
}

/**
 * Record learned vocabulary words into the weekly history via authenticated backend API
 */
export async function recordWeeklyVocabulary(
  studentUid: string,
  weekId: string,
  words: WeeklyVocabularyItem[],
  nativeFriendUid?: string
): Promise<boolean> {
  const cleanStudent = cleanDocId(studentUid);
  const cleanWeek = (weekId || 'week-1').trim();
  if (!cleanStudent || isSyntheticLegacyUid(cleanStudent) || !Array.isArray(words) || words.length === 0) return false;

  try {
    const headers = await getAuthHeaders();
    const res = await fetch('/api/student-history/record', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        studentUid: cleanStudent,
        weekId: cleanWeek,
        type: 'vocabulary',
        words,
        ...(nativeFriendUid ? { nativeFriendUid } : {}),
      }),
    });
    if (!res.ok) return false;
    const json = await res.json().catch(() => null);
    return Boolean(json?.success);
  } catch (err) {
    console.error('Failed to record weekly vocabulary:', err);
    return false;
  }
}

/**
 * Custom React Hook: useStudentHistory
 * Manages consolidated weekly history via canonical backend APIs with strict UID isolation
 */
export function useStudentHistory({
  studentUid,
  studentEmail,
  weekId = 'week-1',
  weeklyCycle,
  nativeFriendUid,
  nativeFriendEmail,
}: UseStudentHistoryParams): UseStudentHistoryReturn {
  const effectiveUid = cleanDocId(studentUid);
  const effectiveWeekId = cleanDocId(weekId) || (weeklyCycle ? `week-${weeklyCycle}` : 'week-1');
  const cleanTeacherUid = cleanDocId(nativeFriendUid);

  const [weeklyHistory, setWeeklyHistory] = useState<WeeklyHistoryDoc | null>(null);
  const [allHistories, setAllHistories] = useState<WeeklyHistoryDoc[]>([]);
  const [accumulatedVideoIds, setAccumulatedVideoIds] = useState<Set<string>>(new Set());
  const [accumulatedTrackIds, setAccumulatedTrackIds] = useState<Set<string>>(new Set());
  const [isAuthorized, setIsAuthorized] = useState<boolean>(true);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState<boolean>(false);

  const isMountedRef = useRef<boolean>(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Strict UID Link Verification
  useEffect(() => {
    let active = true;

    async function checkAuth() {
      if (!effectiveUid || isSyntheticLegacyUid(effectiveUid)) {
        if (active) {
          setIsAuthorized(false);
          setIsLoading(false);
        }
        return;
      }

      if (!cleanTeacherUid && !nativeFriendEmail) {
        if (active) setIsAuthorized(true);
        return;
      }

      setIsLoading(true);
      const isLinked = await verifyStudentNativeFriendLink(effectiveUid, cleanTeacherUid, studentEmail, nativeFriendEmail);
      if (active) {
        setIsAuthorized(isLinked);
        if (!isLinked) {
          setWeeklyHistory(null);
          setAllHistories([]);
          setIsLoading(false);
        }
      }
    }

    checkAuth();

    return () => {
      active = false;
    };
  }, [effectiveUid, cleanTeacherUid, studentEmail, nativeFriendEmail]);

  const loadHistoryFromBackend = useCallback(async () => {
    if (!effectiveUid || isSyntheticLegacyUid(effectiveUid) || !isAuthorized) {
      if (isMountedRef.current) {
        setIsLoading(false);
      }
      return;
    }

    setIsLoading(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(
        `/api/student-history?studentUid=${encodeURIComponent(effectiveUid)}&weekId=${encodeURIComponent(effectiveWeekId)}&includeAll=true&includeAccumulated=true`,
        { method: 'GET', headers }
      );
      if (!isMountedRef.current) return;
      if (res.ok) {
        const data = await res.json();
        const historyData: WeeklyHistoryDoc = data?.weeklyHistory || {
          studentUid: effectiveUid,
          studentEmail: studentEmail || '',
          assignedNativeFriendUID: cleanTeacherUid,
          nativeFriendUID: cleanTeacherUid,
          weekId: effectiveWeekId,
          weeklyCycle: weeklyCycle || 1,
          consumedVideoIds: [],
          consumedTrackIds: [],
          weeklyVocabulary: [],
          updatedAt: new Date().toISOString(),
        };
        setWeeklyHistory(historyData);
        if (Array.isArray(data?.allHistories)) {
          setAllHistories(data.allHistories);
        }
        const vSet = new Set<string>(Array.isArray(data?.accumulated?.videoIds) ? data.accumulated.videoIds : []);
        const tSet = new Set<string>(Array.isArray(data?.accumulated?.trackIds) ? data.accumulated.trackIds : []);
        setAccumulatedVideoIds(vSet);
        setAccumulatedTrackIds(tSet);
      }
    } catch (err) {
      console.warn(`Notice loading weeklyHistory from backend for ${effectiveUid}:`, err);
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [effectiveUid, effectiveWeekId, isAuthorized, cleanTeacherUid, studentEmail, weeklyCycle]);

  useEffect(() => {
    setWeeklyHistory(null);
    setAllHistories([]);
    setAccumulatedVideoIds(new Set());
    setAccumulatedTrackIds(new Set());
    loadHistoryFromBackend();
  }, [loadHistoryFromBackend]);

  const recordVideo = useCallback(
    async (video: ConsumedVideoItem): Promise<boolean> => {
      if (!effectiveUid || !isAuthorized) return false;
      setIsSaving(true);
      try {
        const ok = await recordConsumedVideo(effectiveUid, effectiveWeekId, video, cleanTeacherUid);
        if (ok) await loadHistoryFromBackend();
        return ok;
      } finally {
        if (isMountedRef.current) setIsSaving(false);
      }
    },
    [effectiveUid, effectiveWeekId, isAuthorized, cleanTeacherUid, loadHistoryFromBackend]
  );

  const recordTrack = useCallback(
    async (track: ConsumedTrackItem): Promise<boolean> => {
      if (!effectiveUid || !isAuthorized) return false;
      setIsSaving(true);
      try {
        const ok = await recordConsumedTrack(effectiveUid, effectiveWeekId, track, cleanTeacherUid);
        if (ok) await loadHistoryFromBackend();
        return ok;
      } finally {
        if (isMountedRef.current) setIsSaving(false);
      }
    },
    [effectiveUid, effectiveWeekId, isAuthorized, cleanTeacherUid, loadHistoryFromBackend]
  );

  const recordVocabulary = useCallback(
    async (words: WeeklyVocabularyItem[]): Promise<boolean> => {
      if (!effectiveUid || !isAuthorized) return false;
      setIsSaving(true);
      try {
        const ok = await recordWeeklyVocabulary(effectiveUid, effectiveWeekId, words, cleanTeacherUid);
        if (ok) await loadHistoryFromBackend();
        return ok;
      } finally {
        if (isMountedRef.current) setIsSaving(false);
      }
    },
    [effectiveUid, effectiveWeekId, isAuthorized, cleanTeacherUid, loadHistoryFromBackend]
  );

  const refreshHistory = useCallback(async () => {
    await loadHistoryFromBackend();
  }, [loadHistoryFromBackend]);

  return {
    weeklyHistory,
    allHistories,
    accumulatedVideoIds,
    accumulatedTrackIds,
    isAuthorized,
    isLoading,
    isSaving,
    recordVideo,
    recordTrack,
    recordVocabulary,
    refreshHistory,
  };
}
