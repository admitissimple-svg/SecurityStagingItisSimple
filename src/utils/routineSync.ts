import { doc, setDoc, onSnapshot, getDoc } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { getDb, auth } from '../firebase';
import { DayOfWeek, TeacherOverrideTrack } from '../types';
import { getSpotifyEmbedUrl } from './spotify';
import { recordConsumedTrack } from '../hooks/useStudentHistory';

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
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map((provider) => ({
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
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer) clearTimeout(timer);
  });
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
  currentSpotifyTrack?: CurrentSpotifyTrack | null;
  teacherFeedback?: Record<string, StudentTrackFeedback>;
  updatedAt?: string;
}

// In-memory debounce cache to prevent unnecessary writes if the track hasn't changed
const lastSyncedSignatureMap = new Map<string, string>();

/**
 * Normalizes a student ID/email to a safe Firestore document path token.
 * Prioritizes the authenticated Firebase Auth user UID when available.
 */
export function normalizeStudentIdForPath(rawIdOrEmail: string): string {
  if (!rawIdOrEmail || rawIdOrEmail === 'undefined' || rawIdOrEmail === 'null' || rawIdOrEmail === 'user-default' || rawIdOrEmail === 'anonymous_student') {
    return auth?.currentUser?.uid || '';
  }
  const trimmed = rawIdOrEmail.trim();

  // If active authenticated user matches the input (by UID or email), strictly bind to auth.currentUser.uid
  if (auth?.currentUser?.uid) {
    const curUid = auth.currentUser.uid;
    const curEmail = (auth.currentUser.email || '').toLowerCase().trim();
    const cleanLower = trimmed.toLowerCase();
    if (cleanLower === curUid.toLowerCase() || (curEmail && cleanLower === curEmail)) {
      return curUid;
    }
  }

  // Standardize email addresses to safe key tokens
  if (trimmed.includes('@')) {
    return trimmed.toLowerCase().replace(/[^a-zA-Z0-9_-]/g, '_');
  }
  return trimmed;
}

/**
 * Persists the student's Spotify Song of the Day to Firestore:
 * Path 1: users/{studentUID}/currentRoutine/weekData (Primary live document)
 * Path 2: users/{studentUID}/currentRoutine/{weekId} (Weekly cycle archive)
 * Path 3: users/{studentUID}/routines/{currentDayOfWeek} (Daily routine record)
 */
export async function syncStudentSpotifyTrackToFirestore(
  studentUid: string,
  weekId: string = 'week-1',
  track: CurrentSpotifyTrack | null,
  extra?: {
    studentEmail?: string;
    nativeFriendUid?: string;
    nativeFriendEmail?: string;
    dayOfWeek?: DayOfWeek;
  }
): Promise<boolean> {
  const cleanStudentUid = normalizeStudentIdForPath(studentUid);
  if (!cleanStudentUid) return false;
  const safeWeekId = weekId || 'week-1';
  const targetDay = track?.dayOfWeek || extra?.dayOfWeek;

  // Build signature to avoid redundant round-trips
  const trackSignature = track
    ? `${cleanStudentUid}:${safeWeekId}:${track.id}:${track.dayOfWeek}:${track.title}`
    : `${cleanStudentUid}:${safeWeekId}:null`;

  if (lastSyncedSignatureMap.get(`${cleanStudentUid}:${safeWeekId}`) === trackSignature) {
    return true; // Already up-to-date
  }

  const payload: Partial<StudentCurrentRoutineDoc> = {
    studentUid: cleanStudentUid,
    weekId: safeWeekId,
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
    updatedAt: new Date().toISOString(),
    ...(extra?.studentEmail ? { studentEmail: extra.studentEmail } : {}),
    ...(extra?.nativeFriendUid ? { nativeFriendUid: extra.nativeFriendUid } : {}),
    ...(extra?.nativeFriendEmail ? { nativeFriendEmail: extra.nativeFriendEmail } : {}),
  };

  // 1. Mirror to authorized server backend REST endpoint for safe public delivery
  fetch('/api/routines/current-routine', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).catch(() => {});

  // For unauthenticated visitors, utilize exclusively authorized server REST API above
  if (!auth.currentUser && typeof (auth as any)?.authStateReady === 'function') {
    try {
      await (auth as any).authStateReady();
    } catch {}
  }

  if (!auth.currentUser) {
    lastSyncedSignatureMap.set(`${cleanStudentUid}:${safeWeekId}`, trackSignature);
    return true;
  }

  try {
    const db = getDb();

    // 1. Primary Live Document: users/{studentUID}/currentRoutine/weekData
    const weekDataRef = doc(db, 'users', cleanStudentUid, 'currentRoutine', 'weekData');
    await setDoc(weekDataRef, payload, { merge: true });

    // 2. Weekly Cycle Document: users/{studentUID}/currentRoutine/{weekId}
    const routineDocRef = doc(db, 'users', cleanStudentUid, 'currentRoutine', safeWeekId);
    await setDoc(routineDocRef, payload, { merge: true });

    // 3. Daily Document: users/{studentUID}/routines/{currentDayOfWeek}
    if (targetDay) {
      const dayDocRef = doc(db, 'users', cleanStudentUid, 'routines', targetDay);
      await setDoc(
        dayDocRef,
        {
          currentSpotifyTrack: payload.currentSpotifyTrack,
          dayOfWeek: targetDay,
          updatedAt: payload.updatedAt,
          ...(extra?.studentEmail ? { studentEmail: extra.studentEmail } : {}),
          ...(extra?.nativeFriendUid ? { nativeFriendUid: extra.nativeFriendUid } : {}),
        },
        { merge: true }
      );
    }

    lastSyncedSignatureMap.set(`${cleanStudentUid}:${safeWeekId}`, trackSignature);

    // Record into weekly history subcollection: users/{studentUID}/weeklyHistory/{weekId}
    if (track && track.id) {
      recordConsumedTrack(
        cleanStudentUid,
        safeWeekId,
        {
          id: track.id,
          trackId: track.id,
          title: track.title,
          artist: track.artist,
          coverUrl: track.coverUrl,
          dayOfWeek: targetDay,
          listenedAt: new Date().toISOString(),
        },
        extra?.nativeFriendUid
      ).catch(() => {});
    }

    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `users/${cleanStudentUid}/currentRoutine/weekData`);
    return false;
  }
}

/**
 * Subscribes to the student's current weekly routine in real time using onSnapshot.
 * Listens in parallel to:
 * 1. users/{studentUID}/currentRoutine/weekData (Primary live document)
 * 2. users/{studentUID}/currentRoutine/{weekId} (Weekly cycle document)
 * 3. users/{studentUID}/routines/{currentDayOfWeek} (Daily routine document)
 * Returns a composite unsubscribe callback.
 */
export function subscribeStudentCurrentRoutine(
  studentUid: string,
  weekId: string = 'week-1',
  onUpdate: (data: StudentCurrentRoutineDoc | null) => void,
  options?: {
    currentDayOfWeek?: DayOfWeek;
    studentTimezone?: string;
  }
): () => void {
  const cleanStudentUid = normalizeStudentIdForPath(studentUid);
  if (!cleanStudentUid) {
    onUpdate(null);
    return () => {};
  }
  const safeWeekId = weekId || 'week-1';
  const targetDay = options?.currentDayOfWeek;

  // Composite state to merge latest active document
  let weekDataState: StudentCurrentRoutineDoc | null = null;
  let cycleDataState: StudentCurrentRoutineDoc | null = null;
  let week5DataState: StudentCurrentRoutineDoc | null = null;
  let dayDataState: any = null;

  const emitMerged = () => {
    // Pick the most relevant track
    const candidateTrack =
      weekDataState?.currentSpotifyTrack ||
      dayDataState?.currentSpotifyTrack ||
      cycleDataState?.currentSpotifyTrack ||
      week5DataState?.currentSpotifyTrack ||
      null;

    const candidateDoc =
      weekDataState ||
      cycleDataState ||
      week5DataState ||
      (dayDataState ? {
        studentUid: cleanStudentUid,
        weekId: safeWeekId,
        currentSpotifyTrack: dayDataState.currentSpotifyTrack,
        updatedAt: dayDataState.updatedAt,
      } as StudentCurrentRoutineDoc : null);

    if (candidateDoc) {
      const merged: StudentCurrentRoutineDoc = {
        ...candidateDoc,
        currentSpotifyTrack: candidateTrack,
        teacherFeedback: {
          ...(week5DataState?.teacherFeedback || {}),
          ...(cycleDataState?.teacherFeedback || {}),
          ...(weekDataState?.teacherFeedback || {}),
          ...(dayDataState?.teacherFeedback || {}),
        },
      };
      onUpdate(merged);
    } else {
      onUpdate(null);
    }
  };

  // Immediate REST Hydration to prevent any initial lag
  fetch(`/api/routines/current-routine?studentUid=${encodeURIComponent(cleanStudentUid)}&weekId=${encodeURIComponent(safeWeekId)}`)
    .then((r) => r.json())
    .then((res) => {
      if (res?.routine) {
        if (!weekDataState && !cycleDataState) {
          cycleDataState = res.routine;
          emitMerged();
        }
      }
    })
    .catch(() => {});

  const firestoreUnsubs: (() => void)[] = [];

  const cleanupFirestore = () => {
    while (firestoreUnsubs.length > 0) {
      try {
        firestoreUnsubs.pop()?.();
      } catch {}
    }
  };

  const attachFirestoreListeners = () => {
    cleanupFirestore();
    if (!auth.currentUser) return;

    try {
      const db = getDb();

      // 1. Listen to users/{studentUID}/currentRoutine/weekData (Primary)
      const weekDataRef = doc(db, 'users', cleanStudentUid, 'currentRoutine', 'weekData');
      const unsubWeekData = onSnapshot(
        weekDataRef,
        (snap) => {
          if (snap.exists()) {
            weekDataState = snap.data() as StudentCurrentRoutineDoc;
          } else {
            weekDataState = null;
          }
          emitMerged();
        },
        (err) => {
          handleFirestoreError(err, OperationType.GET, `users/${cleanStudentUid}/currentRoutine/weekData`);
        }
      );
      firestoreUnsubs.push(unsubWeekData);

      // 2. Listen to users/{studentUID}/currentRoutine/{weekId}
      const cycleRef = doc(db, 'users', cleanStudentUid, 'currentRoutine', safeWeekId);
      const unsubCycle = onSnapshot(
        cycleRef,
        (snap) => {
          if (snap.exists()) {
            cycleDataState = snap.data() as StudentCurrentRoutineDoc;
          } else {
            cycleDataState = null;
          }
          emitMerged();
        },
        (err) => {
          handleFirestoreError(err, OperationType.GET, `users/${cleanStudentUid}/currentRoutine/${safeWeekId}`);
        }
      );
      firestoreUnsubs.push(unsubCycle);

      // If safeWeekId is week-1, also check week-5 where active cycle data lives
      if (safeWeekId !== 'week-5') {
        const week5Ref = doc(db, 'users', cleanStudentUid, 'currentRoutine', 'week-5');
        const unsubWeek5 = onSnapshot(
          week5Ref,
          (snap) => {
            if (snap.exists()) {
              week5DataState = snap.data() as StudentCurrentRoutineDoc;
              emitMerged();
            }
          },
          () => {}
        );
        firestoreUnsubs.push(unsubWeek5);
      }

      // 3. Listen to users/{studentUID}/routines/{currentDayOfWeek}
      if (targetDay) {
        const dayRef = doc(db, 'users', cleanStudentUid, 'routines', targetDay);
        const unsubDay = onSnapshot(
          dayRef,
          (snap) => {
            if (snap.exists()) {
              dayDataState = snap.data();
              emitMerged();
            }
          },
          () => {}
        );
        firestoreUnsubs.push(unsubDay);
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, `users/${cleanStudentUid}/currentRoutine/weekData`);
    }
  };

  // Only attach Firestore listeners if already authenticated
  if (auth.currentUser) {
    attachFirestoreListeners();
  }

  // Subscribe to auth transitions: attach listeners on sign-in, cleanup on sign-out/visitor
  const unsubAuth = onAuthStateChanged(auth, (user) => {
    if (user) {
      attachFirestoreListeners();
    } else {
      cleanupFirestore();
    }
  });

  return () => {
    unsubAuth();
    cleanupFirestore();
  };
}

/**
 * Saves a comment or recommendation from the Native Friend / Teacher
 * strictly linked to the student and the song/day they listened to.
 * Persists to both weekData and specific weekId.
 */
export async function saveNativeFriendTrackFeedback(
  studentUid: string,
  weekId: string = 'week-1',
  feedback: {
    teacherUid: string;
    teacherName?: string;
    teacherEmail?: string;
    dayOfWeek: DayOfWeek;
    trackId: string;
    comment: string;
    recommendation?: string;
  }
): Promise<boolean> {
  const cleanStudentUid = normalizeStudentIdForPath(studentUid);
  if (!cleanStudentUid) return false;
  const safeWeekId = weekId || 'week-1';

  const feedbackEntry: StudentTrackFeedback = {
    ...feedback,
    studentUid: cleanStudentUid,
    createdAt: new Date().toISOString(),
  };

  const payload = {
    updatedAt: new Date().toISOString(),
    nativeFriendUid: feedback.teacherUid,
    ...(feedback.teacherEmail ? { nativeFriendEmail: feedback.teacherEmail } : {}),
    teacherFeedback: {
      [feedback.dayOfWeek]: feedbackEntry,
    },
  };

  // 1. Mirror to server backend REST endpoint
  fetch('/api/routines/current-routine/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      studentUid: cleanStudentUid,
      weekId: safeWeekId,
      feedback: feedbackEntry,
    }),
  }).catch(() => {});

  if (!auth.currentUser && typeof (auth as any)?.authStateReady === 'function') {
    try {
      await (auth as any).authStateReady();
    } catch {}
  }

  if (!auth.currentUser) {
    return true;
  }

  try {
    const db = getDb();

    // 1. Save to users/{studentUID}/currentRoutine/weekData
    const weekDataRef = doc(db, 'users', cleanStudentUid, 'currentRoutine', 'weekData');
    await setDoc(weekDataRef, payload, { merge: true });

    // 2. Save to users/{studentUID}/currentRoutine/{weekId}
    const routineDocRef = doc(db, 'users', cleanStudentUid, 'currentRoutine', safeWeekId);
    await setDoc(routineDocRef, payload, { merge: true });

    // 3. Save to users/{studentUID}/routines/{dayOfWeek}
    const dayDocRef = doc(db, 'users', cleanStudentUid, 'routines', feedback.dayOfWeek);
    await setDoc(dayDocRef, { teacherFeedback: payload.teacherFeedback }, { merge: true });

    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `users/${cleanStudentUid}/currentRoutine/weekData`);
    return false;
  }
}

/**
 * Saves a Spotify track recommendation / override from the Native Friend teacher
 * for a specific day of the student's routine.
 * Persists to Firestore at users/{studentUID}/routines/{dayOfWeek}.
 */
export async function saveTeacherSpotifyOverrideToFirestore(
  studentUid: string,
  dayOfWeek: DayOfWeek,
  overrideTrack: TeacherOverrideTrack
): Promise<boolean> {
  const cleanStudentUid = normalizeStudentIdForPath(studentUid);
  if (!cleanStudentUid || !dayOfWeek) return false;

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

  // 1. Mirror to server REST notification
  fetch('/api/routines/override-track', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      studentUid: cleanStudentUid,
      dayOfWeek,
      teacherOverrideTrack: sanitizedTrack,
    }),
  }).catch(() => {});

  if (!auth.currentUser && typeof (auth as any)?.authStateReady === 'function') {
    try {
      await (auth as any).authStateReady();
    } catch {}
  }

  if (!auth.currentUser) {
    return true;
  }

  try {
    const db = getDb();
    // 1. Write to users/{studentUID}/routines/{dayOfWeek}
    const dayRef = doc(db, 'users', cleanStudentUid, 'routines', dayOfWeek);
    await setDoc(
      dayRef,
      {
        teacherOverrideTrack: sanitizedTrack,
        dayOfWeek,
        updatedAt: sanitizedTrack.updatedAt,
      },
      { merge: true }
    );

    // 2. Also write to users/{studentUID}/currentRoutine/weekData
    const weekDataRef = doc(db, 'users', cleanStudentUid, 'currentRoutine', 'weekData');
    await setDoc(
      weekDataRef,
      {
        teacherOverrides: {
          [dayOfWeek]: sanitizedTrack,
        },
        updatedAt: sanitizedTrack.updatedAt,
      },
      { merge: true }
    );

    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `users/${cleanStudentUid}/routines/${dayOfWeek}`);
    return false;
  }
}

/**
 * Removes a Spotify track recommendation / override from the Native Friend teacher
 * for a specific day of the student's routine, restoring the curriculum track.
 */
export async function removeTeacherSpotifyOverrideFromFirestore(
  studentUid: string,
  dayOfWeek: DayOfWeek
): Promise<boolean> {
  const cleanStudentUid = normalizeStudentIdForPath(studentUid);
  if (!cleanStudentUid || !dayOfWeek) return false;

  const now = new Date().toISOString();

  // 1. Mirror to server REST notification
  fetch('/api/routines/override-track', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      studentUid: cleanStudentUid,
      dayOfWeek,
      teacherOverrideTrack: null,
    }),
  }).catch(() => {});

  if (!auth.currentUser && typeof (auth as any)?.authStateReady === 'function') {
    try {
      await (auth as any).authStateReady();
    } catch {}
  }

  if (!auth.currentUser) {
    return true;
  }

  try {
    const db = getDb();

    const dayRef = doc(db, 'users', cleanStudentUid, 'routines', dayOfWeek);
    await setDoc(
      dayRef,
      {
        teacherOverrideTrack: null,
        updatedAt: now,
      },
      { merge: true }
    );

    const weekDataRef = doc(db, 'users', cleanStudentUid, 'currentRoutine', 'weekData');
    await setDoc(
      weekDataRef,
      {
        teacherOverrides: {
          [dayOfWeek]: null,
        },
        updatedAt: now,
      },
      { merge: true }
    );

    return true;
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

