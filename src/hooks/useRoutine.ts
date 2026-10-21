import { useState, useEffect, useCallback } from 'react';
import { auth } from '../firebase';
import { DayOfWeek, TeacherOverrideTrack } from '../types';
import { normalizeStudentIdForPath } from '../utils/routineSync';
import { extractYouTubeVideoId } from '../utils/youtube';
import { isValidCanonicalUid } from '../utils/tutorConsolidation';

export interface SavedRoutineVideo {
  videoId: string;
  title: string;
  videoTitle?: string;
  url: string;
  playlistId?: string;
  playlistTitle?: string;
  dayOfWeek: DayOfWeek;
  activityId?: string;
  isRepeatVideo?: boolean;
  instructions?: string;
  duration?: string;
  completed?: boolean;
  completedToday?: boolean;
  weeklyCycle?: number;
  updatedAt?: string;
  teacherOverrideTrack?: TeacherOverrideTrack | null;
}

export interface WatchedVideoEntry {
  videoId: string;
  videoTitle: string;
  watchedAt: string;
}

export interface ListenedTrackEntry {
  trackId: string;
  trackTitle: string;
  artist?: string;
  listenedAt: string;
}

const ALL_DAYS_OF_WEEK: DayOfWeek[] = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
];

/**
 * Retrieves client authentication headers with Firebase ID token if authenticated.
 */
async function getAuthHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };
  try {
    const token = await auth?.currentUser?.getIdToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
  } catch {}
  return headers;
}

/**
 * Persists selected video and topic for a specific day via authenticated backend:
 * Uses Firebase Admin SDK on the backend to store at users/{studentUID}/routines/{dayOfWeek}
 * and confirms write in Firestore before returning success.
 */
export async function saveRoutineVideoToFirestore(
  studentUid: string,
  dayOfWeek: DayOfWeek,
  videoData: {
    videoId: string;
    title: string;
    videoTitle?: string;
    url?: string;
    playlistId?: string;
    playlistTitle?: string;
    activityId?: string;
    isRepeatVideo?: boolean;
    instructions?: string;
    duration?: string;
  }
): Promise<boolean> {
  const authUid = auth?.currentUser?.uid || '';
  const cleanUid = normalizeStudentIdForPath(studentUid) || (isValidCanonicalUid(authUid) ? authUid : studentUid || '');
  if (!cleanUid || !dayOfWeek) return false;

  const rawVidId = videoData.videoId || videoData.url || '';
  const validVidId = extractYouTubeVideoId(rawVidId) || (videoData.videoId || '').trim();
  const cleanUrl = validVidId ? (videoData.url || `https://www.youtube.com/watch?v=${validVidId}`) : '';
  const cleanTitle = videoData.title || videoData.videoTitle || (validVidId ? 'Daily Video Practice' : 'Video of the Day');

  const payload = {
    studentUid: cleanUid,
    day: dayOfWeek,
    dayOfWeek,
    videoId: validVidId,
    title: cleanTitle,
    videoTitle: cleanTitle,
    url: cleanUrl,
    playlistId: videoData.playlistId || '',
    playlistTitle: videoData.playlistTitle || '',
    activityId: videoData.activityId || 'act-1',
    isRepeatVideo: Boolean(videoData.isRepeatVideo),
    instructions: videoData.instructions || '',
    duration: videoData.duration || '5-10 min',
  };

  try {
    const headers = await getAuthHeaders();
    const res = await fetch('/api/routines/daily-video', {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      console.warn(`[useRoutine] Failed to save routine video for ${dayOfWeek}: HTTP ${res.status}`);
      return false;
    }

    const data = await res.json();
    return Boolean(data && data.success);
  } catch (error) {
    console.error(`[useRoutine] Failed to save routine video for ${dayOfWeek}:`, error);
    return false;
  }
}

/**
 * Reads the persisted video for a specific day via authenticated backend.
 */
export async function fetchRoutineVideoFromFirestore(
  studentUid: string,
  dayOfWeek: DayOfWeek
): Promise<SavedRoutineVideo | null> {
  const cleanUid = normalizeStudentIdForPath(studentUid);
  if (!cleanUid || !dayOfWeek) return null;

  try {
    const headers = await getAuthHeaders();
    const res = await fetch(
      `/api/routines/daily-video?studentUid=${encodeURIComponent(cleanUid)}&day=${encodeURIComponent(dayOfWeek)}`,
      { method: 'GET', headers }
    );
    if (res.ok) {
      const data = await res.json();
      return (data && data.currentDayRoutine) || (data.routinesByDay && data.routinesByDay[dayOfWeek]) || null;
    }
    return null;
  } catch (error) {
    console.warn('[useRoutine] Error fetching routine video from backend:', error);
    return null;
  }
}

/**
 * Reads all 7 daily routine video selections for a student via authenticated backend.
 */
export async function fetchAllRoutineVideosFromFirestore(
  studentUid: string
): Promise<Partial<Record<DayOfWeek, SavedRoutineVideo>>> {
  const cleanUid = normalizeStudentIdForPath(studentUid);
  if (!cleanUid) return {};

  try {
    const headers = await getAuthHeaders();
    const res = await fetch(
      `/api/routines/daily-video?studentUid=${encodeURIComponent(cleanUid)}`,
      { method: 'GET', headers }
    );
    if (res.ok) {
      const data = await res.json();
      if (data && data.routinesByDay && typeof data.routinesByDay === 'object') {
        return data.routinesByDay as Partial<Record<DayOfWeek, SavedRoutineVideo>>;
      }
    }
  } catch (err) {
    console.warn('[useRoutine] Notice reading routines from backend:', err);
  }
  return {};
}

export function extractVideoIdFromHistoryItem(item: any): string {
  if (typeof item === 'string') {
    return (extractYouTubeVideoId(item) || item || '').trim();
  }
  if (item && typeof item === 'object') {
    const raw = item.videoId || item.id || item.url || '';
    return (extractYouTubeVideoId(raw) || raw || '').trim();
  }
  return '';
}

export function extractVideoTitleFromHistoryItem(item: any): string {
  if (item && typeof item === 'object') {
    return (item.videoTitle || item.title || 'Daily Video Practice').trim();
  }
  return 'Daily Video Practice';
}

/**
 * Reads the global watched videos history array via backend.
 * Always returns clean array of YouTube videoId strings for exclusivity checks.
 */
export async function fetchWatchedVideosHistoryFromFirestore(
  studentUid: string
): Promise<string[]> {
  const cleanUid = normalizeStudentIdForPath(studentUid);
  if (!cleanUid) return [];

  try {
    const headers = await getAuthHeaders();
    const res = await fetch(
      `/api/routines/daily-video?studentUid=${encodeURIComponent(cleanUid)}`,
      { method: 'GET', headers }
    );
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.watchedVideosHistory)) {
        return data.watchedVideosHistory;
      }
    }
    return [];
  } catch (error) {
    console.warn('[useRoutine] Error reading watched videos history from backend:', error);
    return [];
  }
}

/**
 * Reads the global watched videos history array with full metadata objects.
 */
export async function fetchWatchedVideoObjectsFromFirestore(
  studentUid: string
): Promise<WatchedVideoEntry[]> {
  const ids = await fetchWatchedVideosHistoryFromFirestore(studentUid);
  return ids.map((id) => ({
    videoId: id,
    videoTitle: 'Daily Video Practice',
    watchedAt: new Date().toISOString(),
  }));
}

/**
 * Appends a video record to the student's watched history via backend API.
 */
export async function addVideoToWatchedHistoryInFirestore(
  studentUid: string,
  videoId: string,
  videoTitle?: string
): Promise<boolean> {
  const cleanUid = normalizeStudentIdForPath(studentUid);
  const cleanVidId = extractYouTubeVideoId(videoId) || (videoId || '').trim();
  if (!cleanUid || !cleanVidId) return false;
  const cleanTitle = (videoTitle || 'Daily Video Practice').trim();

  try {
    const headers = await getAuthHeaders();
    const res = await fetch('/api/student-video-assignments/watch', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        studentUid: cleanUid,
        videoId: cleanVidId,
        videoTitle: cleanTitle,
      }),
    });
    return res.ok;
  } catch (error) {
    console.warn('[useRoutine] Error adding video to watched history:', error);
    return false;
  }
}

/**
 * Appends multiple video records to the student's watched history.
 */
export async function addMultipleVideosToWatchedHistoryInFirestore(
  studentUid: string,
  videos: Array<string | { videoId: string; videoTitle?: string; watchedAt?: string }>
): Promise<boolean> {
  const cleanUid = normalizeStudentIdForPath(studentUid);
  if (!cleanUid || !Array.isArray(videos) || videos.length === 0) return false;

  try {
    for (const v of videos) {
      const vid = typeof v === 'string' ? v : v.videoId;
      const title = typeof v === 'object' && v.videoTitle ? v.videoTitle : 'Daily Video Practice';
      await addVideoToWatchedHistoryInFirestore(cleanUid, vid, title);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Appends a Spotify track record to the student's listened tracks history via backend API.
 */
export async function addTrackToListenedHistoryInFirestore(
  studentUid: string,
  trackId: string,
  trackTitle?: string,
  artist?: string
): Promise<boolean> {
  const cleanUid = normalizeStudentIdForPath(studentUid);
  const cleanTrackId = (trackId || '').trim();
  if (!cleanUid || !cleanTrackId) return false;
  const cleanTitle = (trackTitle || 'Daily Spotify Listening').trim();
  const cleanArtist = (artist || 'Spotify Artist').trim();

  try {
    const headers = await getAuthHeaders();
    const res = await fetch('/api/student-track-assignments/listen', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        studentUid: cleanUid,
        trackId: cleanTrackId,
        title: cleanTitle,
        artist: cleanArtist,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Resets "Repeat Previous Video" (isRepeatVideo: false) for all days.
 */
export async function resetRepeatFlagsInFirestore(
  studentUid: string,
  targetDays: DayOfWeek[] = ALL_DAYS_OF_WEEK
): Promise<boolean> {
  const cleanUid = normalizeStudentIdForPath(studentUid);
  if (!cleanUid) return false;

  try {
    const headers = await getAuthHeaders();
    const res = await fetch('/api/student-routines/start-new-week', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        studentUid: cleanUid,
        uid: cleanUid,
        resetTopicsToChooseTopic: false,
        weeklyStudyDays: targetDays,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Completely resets daily routines for a new weekly cycle:
 * Clears topic/playlistId, videoId, and repeat flags so all days start cleanly on "Choose a Topic".
 */
export async function resetDailyRoutinesForNewWeekInFirestore(
  studentUid: string,
  targetDays: DayOfWeek[] = ALL_DAYS_OF_WEEK
): Promise<boolean> {
  const cleanUid = normalizeStudentIdForPath(studentUid);
  if (!cleanUid) return false;

  try {
    const headers = await getAuthHeaders();
    const res = await fetch('/api/student-routines/start-new-week', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        studentUid: cleanUid,
        uid: cleanUid,
        resetTopicsToChooseTopic: true,
        weeklyStudyDays: targetDays,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Initializes clean, default isolated routine records for a newly registered student.
 */
export async function initializeCleanStudentRoutinesInFirestore(
  studentUid: string,
  targetDays: DayOfWeek[] = ALL_DAYS_OF_WEEK
): Promise<boolean> {
  return await resetDailyRoutinesForNewWeekInFirestore(studentUid, targetDays);
}

/**
 * Filter candidates against watched videos history and studentJournal to enforce 100% exclusivity.
 * Returns the first video that has NOT yet been watched or recorded in studentJournal.
 */
export function selectNextUnwatchedVideo<T extends { videoId?: string; id?: string; url?: string }>(
  candidateVideos: T[],
  watchedHistory: string[],
  studentJournal?: any[]
): T | null {
  if (!Array.isArray(candidateVideos) || candidateVideos.length === 0) {
    return null;
  }

  const watchedSet = new Set(
    (watchedHistory || []).map((id) => (extractYouTubeVideoId(id) || id || '').trim().toLowerCase())
  );

  if (Array.isArray(studentJournal)) {
    studentJournal.forEach((entry) => {
      if (entry && entry.type === 'video' && entry.id) {
        const vid = (extractYouTubeVideoId(entry.id) || entry.id || '').trim().toLowerCase();
        if (vid) watchedSet.add(vid);
        if (entry.url) {
          const uVid = (extractYouTubeVideoId(entry.url) || '').trim().toLowerCase();
          if (uVid) watchedSet.add(uVid);
        }
      }
    });
  }

  const unwatched = candidateVideos.find((vid) => {
    const rawId = vid.videoId || vid.id || vid.url || '';
    const cleanId = (extractYouTubeVideoId(rawId) || rawId).trim().toLowerCase();
    return cleanId && !watchedSet.has(cleanId);
  });

  return unwatched || null;
}

/**
 * Custom React Hook: useRoutine
 * Manages daily video persistence, global watched history, and new week resets.
 * Strictly uses backend endpoints and Firebase Admin SDK with zero client cache.
 * Distinguishes 3 states:
 * 1. isLoading (still loading from server)
 * 2. Unselected video (first access or after Start a New Week: displays "Choose a Video")
 * 3. Week with saved video (video persisted and restored on refresh/login)
 */
export function useRoutine(studentUid?: string, selectedDay?: DayOfWeek) {
  const authUid = auth?.currentUser?.uid || '';
  const effectiveUid =
    (isValidCanonicalUid(authUid) ? authUid : '') ||
    (studentUid ? normalizeStudentIdForPath(studentUid) : '') ||
    authUid ||
    (studentUid && isValidCanonicalUid(studentUid) ? studentUid : '');

  const [routinesByDay, setRoutinesByDay] = useState<Partial<Record<DayOfWeek, SavedRoutineVideo>>>({});
  const [watchedHistory, setWatchedHistory] = useState<string[]>([]);
  const [weeklyCycle, setWeeklyCycle] = useState<number>(1);
  const [loadedUid, setLoadedUid] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(() => Boolean(effectiveUid));
  const [isInitialized, setIsInitialized] = useState<boolean>(false);
  const [lastSavedDay, setLastSavedDay] = useState<DayOfWeek | null>(null);

  const isRoutineLoading = Boolean(effectiveUid && loadedUid !== effectiveUid) || isLoading;

  const loadData = useCallback(async (uid: string) => {
    if (!uid) {
      setRoutinesByDay({});
      setWatchedHistory([]);
      setIsLoading(false);
      setIsInitialized(true);
      return;
    }

    setIsLoading(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/routines/daily-video?studentUid=${encodeURIComponent(uid)}`, {
        method: 'GET',
        headers,
      });

      if (res.ok) {
        const data = await res.json();
        if (data.routinesByDay && typeof data.routinesByDay === 'object') {
          setRoutinesByDay(data.routinesByDay);
        } else {
          setRoutinesByDay({});
        }
        if (Array.isArray(data.watchedVideosHistory)) {
          setWatchedHistory(data.watchedVideosHistory);
        }
        if (typeof data.weeklyCycle === 'number') {
          setWeeklyCycle(data.weeklyCycle);
        }
        setLoadedUid(uid);
      }
    } catch (err) {
      console.warn('[useRoutine] Error loading routine data from backend:', err);
    } finally {
      setIsLoading(false);
      setIsInitialized(true);
    }
  }, []);

  useEffect(() => {
    setRoutinesByDay({});
    setWatchedHistory([]);
    setLoadedUid(null);

    if (!effectiveUid) {
      setIsLoading(false);
      setIsInitialized(true);
      return;
    }

    loadData(effectiveUid);
  }, [effectiveUid, loadData]);

  // Save selected video for a day: updates local React state ONLY after persistence is confirmed
  const saveVideoForDay = useCallback(
    async (
      day: DayOfWeek,
      videoData: {
        videoId: string;
        title: string;
        videoTitle?: string;
        url?: string;
        playlistId?: string;
        playlistTitle?: string;
        activityId?: string;
        isRepeatVideo?: boolean;
        instructions?: string;
        duration?: string;
      }
    ): Promise<boolean> => {
      if (!effectiveUid || !day) return false;

      const cleanVidId = extractYouTubeVideoId(videoData.videoId || videoData.url || '') || videoData.videoId;
      const cleanTitle = videoData.title || videoData.videoTitle || 'Daily Video Practice';
      const cleanUrl = videoData.url || (cleanVidId ? `https://www.youtube.com/watch?v=${cleanVidId}` : '');

      const savedObj: SavedRoutineVideo = {
        videoId: cleanVidId,
        title: cleanTitle,
        videoTitle: cleanTitle,
        url: cleanUrl,
        playlistId: videoData.playlistId || '',
        playlistTitle: videoData.playlistTitle || '',
        dayOfWeek: day,
        activityId: videoData.activityId || 'act-1',
        isRepeatVideo: Boolean(videoData.isRepeatVideo),
        instructions: videoData.instructions || '',
        duration: videoData.duration || '5-10 min',
        updatedAt: new Date().toISOString(),
      };

      // Persist to backend and await confirmation before mutating React state
      const confirmed = await saveRoutineVideoToFirestore(effectiveUid, day, videoData);

      if (confirmed) {
        setRoutinesByDay((prev) => ({ ...prev, [day]: savedObj }));
        if (cleanVidId && !watchedHistory.includes(cleanVidId)) {
          setWatchedHistory((prev) => [...prev, cleanVidId]);
        }
        setLastSavedDay(day);
        return true;
      }

      console.error(`[useRoutine] Routine video persistence failed for day ${day}`);
      return false;
    },
    [effectiveUid, watchedHistory]
  );

  const markVideoAsWatched = useCallback(
    async (videoId: string, videoTitle?: string) => {
      if (!effectiveUid || !videoId) return false;
      const cleanVidId = extractYouTubeVideoId(videoId) || videoId;
      if (!cleanVidId) return false;

      if (!watchedHistory.includes(cleanVidId)) {
        setWatchedHistory((prev) => [...prev, cleanVidId]);
      }
      return await addVideoToWatchedHistoryInFirestore(effectiveUid, cleanVidId, videoTitle);
    },
    [effectiveUid, watchedHistory]
  );

  const resetRepeatFlags = useCallback(
    async (studyDays?: DayOfWeek[]) => {
      if (!effectiveUid) return false;
      setRoutinesByDay((prev) => {
        const updated = { ...prev };
        Object.keys(updated).forEach((d) => {
          const dayKey = d as DayOfWeek;
          if (updated[dayKey]) {
            updated[dayKey] = { ...updated[dayKey]!, isRepeatVideo: false };
          }
        });
        return updated;
      });
      return await resetRepeatFlagsInFirestore(effectiveUid, studyDays);
    },
    [effectiveUid]
  );

  const resetRoutinesForNewWeek = useCallback(
    async (studyDays?: DayOfWeek[]) => {
      if (!effectiveUid) return false;

      const cleanRoutines: Partial<Record<DayOfWeek, SavedRoutineVideo>> = {};
      ALL_DAYS_OF_WEEK.forEach((d) => {
        cleanRoutines[d] = {
          videoId: '',
          title: '',
          videoTitle: '',
          url: '',
          playlistId: '',
          playlistTitle: '',
          isRepeatVideo: false,
          dayOfWeek: d,
          activityId: 'act-1',
          instructions: '',
          duration: '',
          completed: false,
          completedToday: false,
          updatedAt: new Date().toISOString(),
        };
      });
      setRoutinesByDay(cleanRoutines);

      return await resetDailyRoutinesForNewWeekInFirestore(effectiveUid, studyDays);
    },
    [effectiveUid]
  );

  const currentDayRoutine = selectedDay ? routinesByDay[selectedDay] || null : null;
  const hasSavedVideoToday = Boolean(
    currentDayRoutine && currentDayRoutine.videoId && currentDayRoutine.videoId.trim() !== ''
  );

  return {
    routinesByDay,
    currentDayRoutine,
    hasSavedVideoToday,
    watchedHistory,
    weeklyCycle,
    isLoading: isRoutineLoading,
    isInitialized,
    lastSavedDay,
    saveVideoForDay,
    markVideoAsWatched,
    resetRepeatFlags,
    resetRoutinesForNewWeek,
    refreshRoutines: () => (effectiveUid ? loadData(effectiveUid) : Promise.resolve()),
    selectNextUnwatchedVideo: <T extends { videoId?: string; id?: string; url?: string }>(
      candidates: T[],
      customJournal?: any[]
    ) => selectNextUnwatchedVideo(candidates, watchedHistory, customJournal),
  };
}
