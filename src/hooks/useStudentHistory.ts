import { useState, useEffect, useCallback, useRef } from 'react';
import {
  doc,
  getDoc,
  setDoc,
  collection,
  getDocs,
  onSnapshot,
  query,
  where,
} from 'firebase/firestore';
import { getDb, auth } from '../firebase';
import {
  WeeklyHistoryDoc,
  ConsumedVideoItem,
  ConsumedTrackItem,
  WeeklyVocabularyItem,
  DayOfWeek,
} from '../types';
import {
  addVideoToWatchedHistoryInFirestore,
  addTrackToListenedHistoryInFirestore,
  extractVideoIdFromHistoryItem,
  extractVideoTitleFromHistoryItem,
} from './useRoutine';

export interface UseStudentHistoryParams {
  studentUid?: string;
  studentEmail?: string;
  weekId?: string;
  weeklyCycle?: number;
  nativeFriendUid?: string; // Teacher UID for strict access validation
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
  studentEmail?: string
): Promise<boolean> {
  const cleanStudent = cleanDocId(studentUid);
  const cleanTeacher = cleanDocId(nativeFriendUid);
  if (!cleanStudent) return false;

  // 1. Admin bypass - Admins oversee all students and tutors
  const currentEmail = (auth.currentUser?.email || '').toLowerCase().trim();
  const adminEmails = [
    'adm.itissimple@gmail.com',
    'estilobeeforkids@gmail.com',
    'adm.itssimple@gmail.com',
    'estilobeeadm@gmail.com',
  ];
  if (
    cleanTeacher === 'admin' ||
    adminEmails.includes(currentEmail) ||
    currentEmail.includes('admin')
  ) {
    return true;
  }

  // 2. Student accessing their own history
  if (!cleanTeacher || cleanStudent === cleanTeacher) return true;
  if (auth.currentUser && (auth.currentUser.uid === cleanStudent || auth.currentUser.email?.toLowerCase().trim() === cleanStudent)) {
    return true;
  }

  try {
    const db = getDb();
    const studentDocRef = doc(db, 'users', cleanStudent);
    let snap = await getDoc(studentDocRef);
    let targetRef = studentDocRef;

    // Check by email if document not directly found
    const emailToSearch = (studentEmail || (cleanStudent.includes('@') ? cleanStudent : '')).toLowerCase().trim();
    if (!snap.exists() && emailToSearch) {
      const q = query(collection(db, 'users'), where('email', '==', emailToSearch));
      const qSnap = await getDocs(q);
      if (!qSnap.empty) {
        snap = qSnap.docs[0];
        targetRef = snap.ref;
      }
    }

    if (snap.exists()) {
      const data = snap.data();
      const assignedUid = (data.assignedNativeFriendUID || data.nativeFriendUID || '').trim();
      const sTeacherEmail = (data.teacherEmail || data.assignedTeacherEmail || '').toLowerCase().trim();
      const sTeacherUid = (data.teacherUid || '').trim();

      // If directly assigned to this teacher UID
      if (assignedUid && assignedUid === cleanTeacher) {
        return true;
      }

      // If assigned to a DIFFERENT teacher UID, reject to prevent cross-profile leakage
      if (assignedUid && assignedUid !== cleanTeacher) {
        if (sTeacherEmail && (cleanTeacher.toLowerCase().includes(sTeacherEmail) || currentEmail === sTeacherEmail)) {
          return true;
        }
        return false;
      }

      // If no assignedUid yet, check if student matches by teacherUid or teacherEmail
      const teacherMatches =
        (sTeacherUid && sTeacherUid === cleanTeacher) ||
        (sTeacherEmail && (cleanTeacher.toLowerCase().includes(sTeacherEmail) || currentEmail === sTeacherEmail));

      if (teacherMatches) {
        await setDoc(
          targetRef,
          {
            assignedNativeFriendUID: cleanTeacher,
            nativeFriendUID: cleanTeacher,
            updatedAt: new Date().toISOString(),
          },
          { merge: true }
        );
        return true;
      }
    }

    // Secondary check: query users collection where assignedNativeFriendUID == cleanTeacher and uid == cleanStudent
    const q = query(
      collection(db, 'users'),
      where('assignedNativeFriendUID', '==', cleanTeacher)
    );
    const querySnap = await getDocs(q);
    let matched = false;
    querySnap.forEach((d) => {
      if (d.id === cleanStudent || d.data().uid === cleanStudent || (emailToSearch && d.data().email === emailToSearch)) {
        matched = true;
      }
    });

    if (matched) return true;

    // Direct backend verification fallback
    try {
      const resp = await fetch(
        `/api/students/verify-link?studentUid=${encodeURIComponent(cleanStudent)}&studentEmail=${encodeURIComponent(emailToSearch)}&teacherUid=${encodeURIComponent(cleanTeacher)}&teacherEmail=${encodeURIComponent(currentEmail)}`
      );
      if (resp.ok) {
        const json = await resp.json();
        if (typeof json.isLinked === 'boolean') {
          return json.isLinked;
        }
      }
    } catch {}

    // Strict default: If not explicitly linked or authorized, return false to prevent cross-profile leakage
    return false;
  } catch (err) {
    console.warn('Notice verifying student-nativeFriend UID link:', err);
    return false;
  }
}

/**
 * Fetch specific weekly history doc
 */
export async function fetchWeeklyHistory(
  studentUid: string,
  weekId: string
): Promise<WeeklyHistoryDoc | null> {
  const cleanStudent = cleanDocId(studentUid);
  const cleanWeek = (weekId || 'week-1').trim();
  if (!cleanStudent) return null;

  try {
    const db = getDb();
    const docRef = doc(db, 'users', cleanStudent, 'weeklyHistory', cleanWeek);
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      return snap.data() as WeeklyHistoryDoc;
    }
    return null;
  } catch (err) {
    console.warn(`Failed to fetch weekly history for ${cleanStudent}/${cleanWeek}:`, err);
    return null;
  }
}

/**
 * Fetch all weekly histories for a student to ensure exclusive non-repeating cycle history
 */
export async function fetchAllWeeklyHistories(studentUid: string): Promise<WeeklyHistoryDoc[]> {
  const cleanStudent = cleanDocId(studentUid);
  if (!cleanStudent) return [];

  try {
    const db = getDb();
    const subColRef = collection(db, 'users', cleanStudent, 'weeklyHistory');
    const snap = await getDocs(subColRef);
    const list: WeeklyHistoryDoc[] = [];
    snap.forEach((d) => {
      list.push(d.data() as WeeklyHistoryDoc);
    });
    return list;
  } catch (err) {
    console.warn(`Failed to fetch all weekly histories for ${cleanStudent}:`, err);
    return [];
  }
}

/**
 * Fetch all accumulated consumed video IDs and track IDs across all historical cycles
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

  const histories = await fetchAllWeeklyHistories(studentUid);
  for (const hist of histories) {
    if (Array.isArray(hist.consumedVideoIds)) {
      for (const v of hist.consumedVideoIds) {
        const id = v.id || v.videoId;
        if (id) videoIds.add(id);
        allVideos.push(v);
      }
    }
    if (Array.isArray(hist.consumedTrackIds)) {
      for (const t of hist.consumedTrackIds) {
        const id = t.id || t.trackId;
        if (id) trackIds.add(id);
        allTracks.push(t);
      }
    }
    if (Array.isArray(hist.weeklyVocabulary)) {
      for (const w of hist.weeklyVocabulary) {
        allVocabulary.push(w);
      }
    }
  }

  // Also inspect student's main user profile watchedVideosHistory & studentJournal for unified source of truth
  try {
    const db = getDb();
    const cleanStudent = cleanDocId(studentUid);
    const userSnap = await getDoc(doc(db, 'users', cleanStudent));
    if (userSnap.exists()) {
      const data = userSnap.data();

      // 1. From studentJournal (Single Source of Truth)
      if (Array.isArray(data.studentJournal)) {
        data.studentJournal.forEach((entry: any) => {
          if (entry && entry.type === 'video' && entry.id) {
            const vid = extractVideoIdFromHistoryItem(entry.id) || entry.id;
            if (vid) {
              videoIds.add(vid);
              allVideos.push({
                id: vid,
                videoId: vid,
                videoTitle: entry.title || 'Daily Routine Video',
                title: entry.title || 'Daily Routine Video',
                watchedAt: (entry.timestamp ? new Date(entry.timestamp).toISOString() : entry.date) || '',
                dayOfWeek: entry.dayOfWeek,
              });
            }
          } else if (entry && entry.type === 'audio' && entry.id) {
            const trkId = entry.id;
            if (trkId) {
              trackIds.add(trkId);
              allTracks.push({
                id: trkId,
                trackId: trkId,
                title: entry.title || 'Daily Track',
                artist: entry.artist || 'Spotify Artist',
                listenedAt: (entry.timestamp ? new Date(entry.timestamp).toISOString() : entry.date) || '',
                dayOfWeek: entry.dayOfWeek,
                url: entry.url,
              });
            }
          }
        });
      }

      // 2. From watchedVideosHistory
      const history = data.watchedVideosHistory || data.watchedVideos || [];
      if (Array.isArray(history)) {
        history.forEach((item: any) => {
          const vid = extractVideoIdFromHistoryItem(item);
          if (vid && !videoIds.has(vid)) {
            videoIds.add(vid);
            const title = extractVideoTitleFromHistoryItem(item);
            allVideos.push({
              id: vid,
              videoId: vid,
              videoTitle: title,
              title: title,
              watchedAt: (item && typeof item === 'object' && item.watchedAt) || '',
            });
          }
        });
      }
    }
  } catch {}

  return { videoIds, trackIds, allVideos, allTracks, allVocabulary };
}

/**
 * Save or merge weekly history document in Firestore: users/{studentUid}/weeklyHistory/{weekId}
 */
export async function saveWeeklyHistory(
  studentUid: string,
  weekId: string,
  data: Partial<WeeklyHistoryDoc>
): Promise<boolean> {
  const cleanStudent = cleanDocId(studentUid);
  const cleanWeek = (weekId || 'week-1').trim();
  if (!cleanStudent) return false;

  try {
    const db = getDb();
    const docRef = doc(db, 'users', cleanStudent, 'weeklyHistory', cleanWeek);
    const payload: Partial<WeeklyHistoryDoc> = {
      ...data,
      studentUid: cleanStudent,
      weekId: cleanWeek,
      updatedAt: new Date().toISOString(),
    };

    await setDoc(docRef, payload, { merge: true });
    return true;
  } catch (err) {
    console.error(`Failed to save weekly history for ${cleanStudent}/${cleanWeek}:`, err);
    return false;
  }
}

/**
 * Record a watched video into the weekly history
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
  if (!cleanStudent || !cleanVidId) return false;
  const cleanTitle = (video.videoTitle || video.title || 'Daily Video Practice').trim();

  const formattedVideoItem: ConsumedVideoItem = {
    ...video,
    id: cleanVidId,
    videoId: cleanVidId,
    videoTitle: cleanTitle,
    title: cleanTitle,
    watchedAt: video.watchedAt || new Date().toISOString(),
  };

  try {
    const existing = await fetchWeeklyHistory(cleanStudent, cleanWeek);
    const currentVideos = existing?.consumedVideoIds ? [...existing.consumedVideoIds] : [];

    // Avoid duplicate video record in the same week
    const existsIndex = currentVideos.findIndex(
      (v) => (v.id || v.videoId || '').toLowerCase() === cleanVidId.toLowerCase()
    );
    if (existsIndex >= 0) {
      currentVideos[existsIndex] = { ...currentVideos[existsIndex], ...formattedVideoItem };
    } else {
      currentVideos.push(formattedVideoItem);
    }

    const payload: Partial<WeeklyHistoryDoc> = {
      studentUid: cleanStudent,
      weekId: cleanWeek,
      consumedVideoIds: currentVideos,
      updatedAt: new Date().toISOString(),
    };
    if (nativeFriendUid) {
      payload.assignedNativeFriendUID = nativeFriendUid;
      payload.nativeFriendUID = nativeFriendUid;
    }

    const saved = await saveWeeklyHistory(cleanStudent, cleanWeek, payload);

    // Also persist strictly to users/{cleanStudent}/watchedVideosHistory
    addVideoToWatchedHistoryInFirestore(cleanStudent, cleanVidId, cleanTitle).catch((err) =>
      console.warn('Notice saving to users watchedVideosHistory:', err)
    );

    return saved;
  } catch (err) {
    console.error('Failed to record consumed video:', err);
    return false;
  }
}

/**
 * Record a listened Spotify track into the weekly history
 */
export async function recordConsumedTrack(
  studentUid: string,
  weekId: string,
  track: ConsumedTrackItem,
  nativeFriendUid?: string
): Promise<boolean> {
  const cleanStudent = cleanDocId(studentUid);
  const cleanWeek = (weekId || 'week-1').trim();
  if (!cleanStudent || !track || !track.id) return false;

  try {
    const existing = await fetchWeeklyHistory(cleanStudent, cleanWeek);
    const currentTracks = existing?.consumedTrackIds ? [...existing.consumedTrackIds] : [];

    const existsIndex = currentTracks.findIndex(
      (t) => (t.id || t.trackId) === (track.id || track.trackId)
    );
    if (existsIndex >= 0) {
      currentTracks[existsIndex] = { ...currentTracks[existsIndex], ...track };
    } else {
      currentTracks.push(track);
    }

    const payload: Partial<WeeklyHistoryDoc> = {
      studentUid: cleanStudent,
      weekId: cleanWeek,
      consumedTrackIds: currentTracks,
      updatedAt: new Date().toISOString(),
    };
    if (nativeFriendUid) {
      payload.assignedNativeFriendUID = nativeFriendUid;
      payload.nativeFriendUID = nativeFriendUid;
    }

    const saved = await saveWeeklyHistory(cleanStudent, cleanWeek, payload);

    // Also persist strictly to users/{cleanStudent}/listenedTracksHistory
    const trackIdToSave = track.trackId || track.id;
    if (trackIdToSave) {
      addTrackToListenedHistoryInFirestore(cleanStudent, trackIdToSave, track.title, track.artist).catch((err) =>
        console.warn('Notice saving to users listenedTracksHistory:', err)
      );
    }

    return saved;
  } catch (err) {
    console.error('Failed to record consumed track:', err);
    return false;
  }
}

/**
 * Record learned vocabulary words into the weekly history
 */
export async function recordWeeklyVocabulary(
  studentUid: string,
  weekId: string,
  words: WeeklyVocabularyItem[],
  nativeFriendUid?: string
): Promise<boolean> {
  const cleanStudent = cleanDocId(studentUid);
  const cleanWeek = (weekId || 'week-1').trim();
  if (!cleanStudent || !Array.isArray(words) || words.length === 0) return false;

  try {
    const existing = await fetchWeeklyHistory(cleanStudent, cleanWeek);
    const currentVocab = existing?.weeklyVocabulary ? [...existing.weeklyVocabulary] : [];

    for (const w of words) {
      const cleanWord = (w.word || '').trim().toLowerCase();
      if (!cleanWord) continue;
      const idx = currentVocab.findIndex((item) => (item.word || '').trim().toLowerCase() === cleanWord);
      if (idx >= 0) {
        currentVocab[idx] = { ...currentVocab[idx], ...w };
      } else {
        currentVocab.push(w);
      }
    }

    const payload: Partial<WeeklyHistoryDoc> = {
      studentUid: cleanStudent,
      weekId: cleanWeek,
      weeklyVocabulary: currentVocab,
      updatedAt: new Date().toISOString(),
    };
    if (nativeFriendUid) {
      payload.assignedNativeFriendUID = nativeFriendUid;
      payload.nativeFriendUID = nativeFriendUid;
    }

    return await saveWeeklyHistory(cleanStudent, cleanWeek, payload);
  } catch (err) {
    console.error('Failed to record weekly vocabulary:', err);
    return false;
  }
}

/**
 * Custom React Hook: useStudentHistory
 * Manages consolidated weekly history with strict UID isolation
 */
export function useStudentHistory({
  studentUid,
  studentEmail,
  weekId = 'week-1',
  weeklyCycle,
  nativeFriendUid,
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
      if (!effectiveUid) {
        if (active) {
          setIsAuthorized(false);
          setIsLoading(false);
        }
        return;
      }

      if (!cleanTeacherUid) {
        // Accessed by student themselves
        if (active) setIsAuthorized(true);
        return;
      }

      // Teacher is accessing - strictly verify assignedNativeFriendUID
      setIsLoading(true);
      const isLinked = await verifyStudentNativeFriendLink(effectiveUid, cleanTeacherUid, studentEmail);
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
  }, [effectiveUid, cleanTeacherUid, studentEmail]);

  // Real-time listener on weeklyHistory document if authorized
  useEffect(() => {
    // Immediately clear state for new student so that old student data never lingers
    setWeeklyHistory(null);
    setAllHistories([]);
    setAccumulatedVideoIds(new Set());
    setAccumulatedTrackIds(new Set());

    if (!effectiveUid || !isAuthorized) {
      if (isMountedRef.current) {
        setIsLoading(false);
      }
      return;
    }

    setIsLoading(true);
    const db = getDb();
    const docRef = doc(db, 'users', effectiveUid, 'weeklyHistory', effectiveWeekId);

    const unsubscribe = onSnapshot(
      docRef,
      (snapshot) => {
        if (!isMountedRef.current) return;
        const historyData: WeeklyHistoryDoc = snapshot.exists()
          ? (snapshot.data() as WeeklyHistoryDoc)
          : {
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

        // Complement with studentJournal from user doc for real-time mobile sync
        getDoc(doc(db, 'users', effectiveUid))
          .then((uSnap) => {
            if (uSnap.exists() && isMountedRef.current) {
              const uData = uSnap.data();
              if (Array.isArray(uData.studentJournal)) {
                const targetCycle = weeklyCycle || 1;
                const journalVideos = uData.studentJournal.filter(
                  (e: any) => e && e.type === 'video' && (!e.week || e.week === targetCycle)
                );
                const journalTracks = uData.studentJournal.filter(
                  (e: any) => e && e.type === 'audio' && (!e.week || e.week === targetCycle)
                );

                const existingVids = new Set((historyData.consumedVideoIds || []).map((v) => v.id || v.videoId));
                journalVideos.forEach((jv: any) => {
                  if (jv.id && !existingVids.has(jv.id)) {
                    historyData.consumedVideoIds.push({
                      id: jv.id,
                      videoId: jv.id,
                      videoTitle: jv.title || 'Daily Routine Video',
                      title: jv.title || 'Daily Routine Video',
                      watchedAt: (jv.timestamp ? new Date(jv.timestamp).toISOString() : jv.date) || '',
                      dayOfWeek: jv.dayOfWeek,
                    });
                  }
                });

                const existingTrks = new Set((historyData.consumedTrackIds || []).map((t) => t.id || t.trackId));
                journalTracks.forEach((jt: any) => {
                  if (jt.id && !existingTrks.has(jt.id)) {
                    historyData.consumedTrackIds.push({
                      id: jt.id,
                      trackId: jt.id,
                      title: jt.title || 'Daily Track',
                      artist: jt.artist || 'Spotify Artist',
                      coverUrl: jt.coverUrl || '',
                      listenedAt: (jt.timestamp ? new Date(jt.timestamp).toISOString() : jt.date) || '',
                      dayOfWeek: jt.dayOfWeek,
                      url: jt.url || '',
                    });
                  }
                });

                setWeeklyHistory({ ...historyData });
              }
            }
          })
          .catch(() => {});

        // If tracks are empty, complement with currentRoutine
        if (!historyData.consumedTrackIds || historyData.consumedTrackIds.length === 0) {
          getDoc(doc(db, 'users', effectiveUid, 'currentRoutine', 'active'))
            .then((rSnap) => {
              if (rSnap.exists() && isMountedRef.current) {
                const rData = rSnap.data();
                if (rData.currentSpotifyTrack) {
                  const trk = rData.currentSpotifyTrack;
                  historyData.consumedTrackIds = [
                    {
                      id: trk.id || 'track-1',
                      trackId: trk.id || 'track-1',
                      title: trk.title,
                      artist: trk.artist,
                      coverUrl: trk.coverUrl,
                      listenedAt: new Date().toISOString(),
                      dayOfWeek: trk.dayOfWeek,
                    },
                  ];
                  setWeeklyHistory({ ...historyData });
                }
              }
            })
            .catch(() => {});
        }

        setWeeklyHistory(historyData);
        setIsLoading(false);
      },
      (err) => {
        console.warn(`Firestore onSnapshot notice for weeklyHistory ${effectiveUid}:`, err);
        if (isMountedRef.current) {
          setIsLoading(false);
        }
      }
    );

    // Also fetch all past cycles for accumulated uniqueness
    fetchAccumulatedConsumedIds(effectiveUid).then((accumulated) => {
      if (!isMountedRef.current) return;
      setAccumulatedVideoIds(accumulated.videoIds);
      setAccumulatedTrackIds(accumulated.trackIds);
    });

    fetchAllWeeklyHistories(effectiveUid).then((all) => {
      if (!isMountedRef.current) return;
      setAllHistories(all);
    });

    return () => {
      unsubscribe();
    };
  }, [effectiveUid, effectiveWeekId, isAuthorized, cleanTeacherUid, studentEmail, weeklyCycle]);

  // Record actions
  const recordVideo = useCallback(
    async (video: ConsumedVideoItem): Promise<boolean> => {
      if (!effectiveUid || !isAuthorized) return false;
      setIsSaving(true);
      try {
        const ok = await recordConsumedVideo(effectiveUid, effectiveWeekId, video, cleanTeacherUid);
        return ok;
      } finally {
        if (isMountedRef.current) setIsSaving(false);
      }
    },
    [effectiveUid, effectiveWeekId, isAuthorized, cleanTeacherUid]
  );

  const recordTrack = useCallback(
    async (track: ConsumedTrackItem): Promise<boolean> => {
      if (!effectiveUid || !isAuthorized) return false;
      setIsSaving(true);
      try {
        const ok = await recordConsumedTrack(effectiveUid, effectiveWeekId, track, cleanTeacherUid);
        return ok;
      } finally {
        if (isMountedRef.current) setIsSaving(false);
      }
    },
    [effectiveUid, effectiveWeekId, isAuthorized, cleanTeacherUid]
  );

  const recordVocabulary = useCallback(
    async (words: WeeklyVocabularyItem[]): Promise<boolean> => {
      if (!effectiveUid || !isAuthorized) return false;
      setIsSaving(true);
      try {
        const ok = await recordWeeklyVocabulary(effectiveUid, effectiveWeekId, words, cleanTeacherUid);
        return ok;
      } finally {
        if (isMountedRef.current) setIsSaving(false);
      }
    },
    [effectiveUid, effectiveWeekId, isAuthorized, cleanTeacherUid]
  );

  const refreshHistory = useCallback(async () => {
    if (!effectiveUid || !isAuthorized) return;
    setIsLoading(true);
    try {
      const data = await fetchWeeklyHistory(effectiveUid, effectiveWeekId);
      if (isMountedRef.current) {
        if (data) setWeeklyHistory(data);
        const accumulated = await fetchAccumulatedConsumedIds(effectiveUid);
        setAccumulatedVideoIds(accumulated.videoIds);
        setAccumulatedTrackIds(accumulated.trackIds);
      }
    } finally {
      if (isMountedRef.current) setIsLoading(false);
    }
  }, [effectiveUid, effectiveWeekId, isAuthorized]);

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
