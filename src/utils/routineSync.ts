import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../firebase';
import { DayOfWeek, TeacherOverrideTrack } from '../types';
import { getSpotifyEmbedUrl } from './spotify';
import { isValidCanonicalUid } from './tutorConsolidation';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth?.currentUser?.uid,
      email: auth?.currentUser?.email,
      emailVerified: auth?.currentUser?.emailVerified,
      isAnonymous: auth?.currentUser?.isAnonymous,
      tenantId: auth?.currentUser?.tenantId,
      providerInfo: auth?.currentUser?.providerData?.map((provider) => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
}

/**
 * Executes a Promise with a strict timeout to prevent Firestore operations
 * from hanging indefinitely in offline or slow-network environments.
 */
export async function withFirestoreTimeout<T>(
  promise: Promise<T>,
  ms = 3500,
  fallback: T
): Promise<T> {
  let timer: any;
  const timeoutPromise = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  const safePromise = promise.catch(() => fallback);
  return Promise.race([safePromise, timeoutPromise]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

async function getAuthTokenForSync(): Promise<string | null> {
  try {
    if (auth && !auth.currentUser && typeof (auth as any).authStateReady === 'function') {
      await (auth as any).authStateReady().catch(() => {});
    }
    if (auth?.currentUser) {
      return await auth.currentUser.getIdToken();
    }
  } catch {}
  return null;
}

export interface CurrentSpotifyTrack {
  id: string;
  title: string;
  artist: string;
  coverUrl: string;
  dayOfWeek: DayOfWeek;
  url?: string;
  level?: string;
}

export interface StudentTrackFeedback {
  teacherUid: string;
  teacherName?: string;
  teacherEmail?: string;
  studentUid: string;
  dayOfWeek: DayOfWeek;
  trackId: string;
  comment: string;
  recommendation?: string;
  createdAt: string;
}

export interface StudentCurrentRoutineDoc {
  studentUid: string;
  studentEmail?: string;
  nativeFriendUid?: string;
  nativeFriendEmail?: string;
  weekId: string;
  weeklyCycle?: number;
  currentSpotifyTrack?: CurrentSpotifyTrack | null;
  teacherFeedback?: Record<string, StudentTrackFeedback>;
  teacherOverrides?: Record<string, TeacherOverrideTrack | null>;
  updatedAt?: string;
}

// In-memory debounce cache to prevent unnecessary writes if the track hasn't changed
const lastSyncedSignatureMap = new Map<string, string>();

/**
 * Normalizes a student ID/email to a safe Firestore document path token.
 * Prioritizes the authenticated Firebase Auth user UID when available.
 */
export function normalizeStudentIdForPath(rawIdOrEmail: string): string {
  if (!rawIdOrEmail || typeof rawIdOrEmail !== 'string') {
    return '';
  }
  const trimmed = rawIdOrEmail.trim();
  if (
    !trimmed ||
    trimmed === 'undefined' ||
    trimmed === 'null' ||
    trimmed === 'user-default' ||
    trimmed === 'anonymous_student' ||
    trimmed.startsWith('st-') ||
    trimmed.startsWith('usr-')
  ) {
    return '';
  }

  // If input is an explicit valid canonical UID, return it directly
  if (isValidCanonicalUid(trimmed)) {
    return trimmed;
  }

  // If active authenticated user matches the input by email (self-context as student only),
  // return auth.currentUser.uid if valid.
  if (auth?.currentUser?.uid && isValidCanonicalUid(auth.currentUser.uid)) {
    const curUid = auth.currentUser.uid;
    const curEmail = (auth.currentUser.email || '').toLowerCase().trim();
    const cleanLower = trimmed.toLowerCase();
    if ((curEmail && cleanLower === curEmail) || cleanLower === curUid.toLowerCase()) {
      return curUid;
    }
  }

  // Never return email or email-derived strings for document paths
  return '';
}

/**
 * Persists the student's Spotify Song of the Day via authenticated backend API
 * to canonical Firestore (default) documents.
 */
export async function syncStudentSpotifyTrackToFirestore(
  studentUid: string,
  weekId: string = 'weekData',
  track: CurrentSpotifyTrack | null,
  extra?: {
    studentEmail?: string;
    nativeFriendUid?: string;
    nativeFriendEmail?: string;
    dayOfWeek?: DayOfWeek;
    weeklyCycle?: number;
  }
): Promise<boolean> {
  const cleanStudentUid = normalizeStudentIdForPath(studentUid);
  if (!cleanStudentUid) return false;
  const safeWeekId = weekId || 'weekData';
  const targetDay = track?.dayOfWeek || extra?.dayOfWeek;

  // Build signature to avoid redundant round-trips
  const trackSignature = track
    ? `${cleanStudentUid}:${safeWeekId}:${track.id}:${track.dayOfWeek}:${track.title}`
    : `${cleanStudentUid}:${safeWeekId}:null`;

  if (lastSyncedSignatureMap.get(`${cleanStudentUid}:${safeWeekId}`) === trackSignature) {
    return true;
  }

  const token = await getAuthTokenForSync();
  if (!token) {
    return false;
  }

  const payload = {
    studentUid: cleanStudentUid,
    weekId: safeWeekId,
    ...(extra?.weeklyCycle !== undefined ? { weeklyCycle: extra.weeklyCycle } : {}),
    currentSpotifyTrack: track
      ? {
          id: track.id || '',
          title: track.title || '',
          artist: track.artist || '',
          coverUrl: track.coverUrl || '',
          dayOfWeek: track.dayOfWeek,
          ...(track.url ? { url: track.url } : {}),
          ...(track.level ? { level: track.level } : {}),
        }
      : null,
    ...(targetDay ? { dayOfWeek: targetDay } : {}),
    ...(extra?.studentEmail ? { studentEmail: extra.studentEmail } : {}),
    ...(extra?.nativeFriendUid ? { nativeFriendUid: extra.nativeFriendUid } : {}),
    ...(extra?.nativeFriendEmail ? { nativeFriendEmail: extra.nativeFriendEmail } : {}),
  };

  try {
    const res = await fetch('/api/routines/current-routine', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      return false;
    }

    const data = await res.json().catch(() => null);
    if (!data?.success) {
      return false;
    }

    lastSyncedSignatureMap.set(`${cleanStudentUid}:${safeWeekId}`, trackSignature);
    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `users/${cleanStudentUid}/currentRoutine/weekData`);
    return false;
  }
}

/**
 * Subscribes to the student's current weekly routine via authenticated backend API.
 */
export function subscribeStudentCurrentRoutine(
  studentUid: string,
  weekId: string = 'weekData',
  onUpdate: (data: StudentCurrentRoutineDoc | null) => void,
  options?: {
    currentDayOfWeek?: DayOfWeek;
    studentTimezone?: string;
    weeklyCycle?: number;
  }
): () => void {
  const cleanStudentUid = normalizeStudentIdForPath(studentUid);
  if (!cleanStudentUid) {
    onUpdate(null);
    return () => {};
  }
  const safeWeekId = weekId || 'weekData';
  let disposed = false;

  const fetchRoutine = async () => {
    if (disposed) return;
    const token = await getAuthTokenForSync();
    if (!token || disposed) {
      if (!disposed && !token) onUpdate(null);
      return;
    }

    try {
      const params = new URLSearchParams({
        studentUid: cleanStudentUid,
        weekId: safeWeekId,
      });
      if (options?.weeklyCycle !== undefined) {
        params.set('weeklyCycle', String(options.weeklyCycle));
      }
      const res = await fetch(`/api/routines/current-routine?${params.toString()}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
      });
      if (!res.ok) {
        return;
      }
      const data = await res.json().catch(() => null);
      if (!disposed) {
        onUpdate(data?.routine || null);
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, `users/${cleanStudentUid}/currentRoutine/weekData`);
    }
  };

  fetchRoutine();

  const pollId = setInterval(fetchRoutine, 15000);
  const unsubAuth = auth
    ? onAuthStateChanged(auth, (user) => {
        if (disposed) return;
        if (user) {
          fetchRoutine();
        } else {
          onUpdate(null);
        }
      })
    : () => {};

  return () => {
    disposed = true;
    clearInterval(pollId);
    try {
      unsubAuth();
    } catch {}
  };
}

/**
 * Saves a comment or recommendation from the Native Friend / Teacher
 * via authenticated backend API.
 */
export async function saveNativeFriendTrackFeedback(
  studentUid: string,
  weekId: string = 'weekData',
  feedback: {
    teacherUid: string;
    teacherName?: string;
    teacherEmail?: string;
    dayOfWeek: DayOfWeek;
    trackId: string;
    comment: string;
    recommendation?: string;
    weeklyCycle?: number;
  }
): Promise<boolean> {
  const cleanStudentUid = normalizeStudentIdForPath(studentUid);
  if (!cleanStudentUid) return false;
  const safeWeekId = weekId || 'weekData';

  const token = await getAuthTokenForSync();
  if (!token) {
    return false;
  }

  const feedbackEntry: StudentTrackFeedback = {
    teacherUid: feedback.teacherUid,
    teacherName: feedback.teacherName,
    teacherEmail: feedback.teacherEmail,
    dayOfWeek: feedback.dayOfWeek,
    trackId: feedback.trackId,
    comment: feedback.comment,
    recommendation: feedback.recommendation,
    studentUid: cleanStudentUid,
    createdAt: new Date().toISOString(),
  };

  try {
    const res = await fetch('/api/routines/current-routine/feedback', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        studentUid: cleanStudentUid,
        weekId: safeWeekId,
        ...(feedback.weeklyCycle !== undefined ? { weeklyCycle: feedback.weeklyCycle } : {}),
        feedback: feedbackEntry,
      }),
    });

    if (!res.ok) {
      return false;
    }

    const data = await res.json().catch(() => null);
    return Boolean(data?.success);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `users/${cleanStudentUid}/currentRoutine/weekData`);
    return false;
  }
}

/**
 * Saves a Spotify track recommendation / override from the Native Friend teacher
 * via authenticated backend API.
 */
export async function saveTeacherSpotifyOverrideToFirestore(
  studentUid: string,
  dayOfWeek: DayOfWeek,
  overrideTrack: TeacherOverrideTrack,
  weeklyCycle?: number
): Promise<boolean> {
  const cleanStudentUid = normalizeStudentIdForPath(studentUid);
  if (!cleanStudentUid || !dayOfWeek) return false;

  const token = await getAuthTokenForSync();
  if (!token) {
    return false;
  }

  const sanitizedTrack: TeacherOverrideTrack = {
    id: overrideTrack.id || overrideTrack.trackId || 'override-track',
    trackId: overrideTrack.trackId || overrideTrack.id || '',
    title: overrideTrack.title || 'Recommended Track',
    artist: overrideTrack.artist || overrideTrack.artistOrHost || 'Spotify Audio',
    artistOrHost: overrideTrack.artist || overrideTrack.artistOrHost || 'Spotify Audio',
    url: overrideTrack.url,
    embedUrl: overrideTrack.embedUrl || getSpotifyEmbedUrl(overrideTrack.url) || undefined,
    coverUrl: overrideTrack.coverUrl || overrideTrack.imageUrl || '',
    imageUrl: overrideTrack.coverUrl || overrideTrack.imageUrl || '',
    instructions: overrideTrack.instructions || '',
    teacherUid: overrideTrack.teacherUid || '',
    teacherName: overrideTrack.teacherName || 'Native Friend',
    teacherEmail: overrideTrack.teacherEmail || '',
    updatedAt: new Date().toISOString(),
  };

  try {
    const res = await fetch('/api/routines/override-track', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        studentUid: cleanStudentUid,
        dayOfWeek,
        ...(weeklyCycle !== undefined ? { weeklyCycle } : {}),
        teacherOverrideTrack: sanitizedTrack,
      }),
    });

    if (!res.ok) {
      return false;
    }

    const data = await res.json().catch(() => null);
    return Boolean(data?.success);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `users/${cleanStudentUid}/routines/${dayOfWeek}`);
    return false;
  }
}

/**
 * Removes a Spotify track recommendation / override via authenticated backend API,
 * restoring the curriculum track.
 */
export async function removeTeacherSpotifyOverrideFromFirestore(
  studentUid: string,
  dayOfWeek: DayOfWeek,
  weeklyCycle?: number
): Promise<boolean> {
  const cleanStudentUid = normalizeStudentIdForPath(studentUid);
  if (!cleanStudentUid || !dayOfWeek) return false;

  const token = await getAuthTokenForSync();
  if (!token) {
    return false;
  }

  try {
    const res = await fetch('/api/routines/override-track', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        studentUid: cleanStudentUid,
        dayOfWeek,
        ...(weeklyCycle !== undefined ? { weeklyCycle } : {}),
        teacherOverrideTrack: null,
      }),
    });

    if (!res.ok) {
      return false;
    }

    const data = await res.json().catch(() => null);
    return Boolean(data?.success);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `users/${cleanStudentUid}/routines/${dayOfWeek}`);
    return false;
  }
}

// Re-export YouTube routine video persistence & global watched history functions
export {
  saveRoutineVideoToFirestore,
  fetchRoutineVideoFromFirestore,
  fetchAllRoutineVideosFromFirestore,
  fetchWatchedVideosHistoryFromFirestore,
  addVideoToWatchedHistoryInFirestore,
  addTrackToListenedHistoryInFirestore,
  resetRepeatFlagsInFirestore,
  selectNextUnwatchedVideo,
} from '../hooks/useRoutine';
export type { SavedRoutineVideo, ListenedTrackEntry } from '../hooks/useRoutine';

