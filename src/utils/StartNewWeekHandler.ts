import { DayOfWeek, RoutineItem, ConsumedVideoItem } from '../types';
import {
  fetchWatchedVideosHistoryFromFirestore,
  addMultipleVideosToWatchedHistoryInFirestore,
  fetchAllRoutineVideosFromFirestore,
  resetRepeatFlagsInFirestore,
  resetDailyRoutinesForNewWeekInFirestore,
} from '../hooks/useRoutine';
import { normalizeStudentIdForPath, withFirestoreTimeout } from '../utils/routineSync';
import { extractYouTubeVideoId } from '../utils/youtube';
import { normalizeStudentLevel } from '../utils/spotify';
import { fetchAllWeeklyHistories, saveWeeklyHistory } from '../hooks/useStudentHistory';
import { fetchStudentJournalActivitiesFromFirestore } from '../utils/studentPersistence';

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
 * Executes the complete "Start New Week" lifecycle with complete isolation by studentUID:
 * 1. Reads accumulated global watched history from Firestore: users/{studentUID}/watchedVideosHistory
 * 2. Archives all displayed/completed videos of the previous cycle into watchedVideosHistory & weeklyHistory
 * 3. Resets all daily routine video documents in Firestore to clean state ("Choose a Topic")
 * 4. Resets repeat flags and completion statuses
 * 5. Advances weeklyCycle and synchronizes state with backend
 * 6. Guaranteed non-blocking execution wrapped in try/catch with safe recovery
 */
export async function executeStartNewWeek(
  params: StartNewWeekParams
): Promise<StartNewWeekResult | null> {
  const { studentEmail, studentUid, weeklyStudyDaysTarget, weeklyStudyDays } = params;
  const targetDays = weeklyStudyDaysTarget || 7;
  const chosenDays = weeklyStudyDays && weeklyStudyDays.length > 0 ? weeklyStudyDays : ALL_DAYS;

  // Strict UID validation: prioritize clean UID and reject generic placeholder emails
  const rawUid = (studentUid || '').trim();
  const rawEmail = (studentEmail || '').trim().toLowerCase();
  const isPlaceholder = !rawEmail || GENERIC_PLACEHOLDER_EMAILS.has(rawEmail) || rawEmail.includes('aluno@');
  const effectiveIdentifier = rawUid || (!isPlaceholder ? rawEmail : '');
  const cleanUid = normalizeStudentIdForPath(effectiveIdentifier);

  const fallbackCycle = (params.currentCycle || 1) + 1;

  try {
    // Step 1: Read the accumulated global history from Firestore (users/{studentUID}/watchedVideosHistory)
    let firestoreWatched: string[] = [];
    if (cleanUid) {
      try {
        firestoreWatched = await withFirestoreTimeout(
          fetchWatchedVideosHistoryFromFirestore(cleanUid),
          2500,
          []
        );
      } catch (err) {
        console.warn('Notice fetching watched videos history from Firestore:', err);
      }
    }

    // Step 2: Collect all video records displayed/assigned in the ending cycle to archive into watchedVideosHistory
    const videosToArchive: Array<{ videoId: string; videoTitle: string; watchedAt: string }> = [];

    // Check current in-memory routines
    if (params.currentRoutines) {
      ALL_DAYS.forEach((day) => {
        const acts = params.currentRoutines?.[day] || [];
        acts.forEach((act) => {
          if (act.teacherVideos && Array.isArray(act.teacherVideos)) {
            act.teacherVideos.forEach((v) => {
              const vidId = extractYouTubeVideoId(v.videoId || v.url || '');
              if (vidId) {
                videosToArchive.push({
                  videoId: vidId,
                  videoTitle: v.title || (v as any).videoTitle || 'Daily Video Practice',
                  watchedAt: new Date().toISOString(),
                });
              }
            });
          }
        });
      });
    }

    // Check persisted Firestore routine videos for this student
    if (cleanUid) {
      try {
        const persistedDailyVideos = await withFirestoreTimeout(
          fetchAllRoutineVideosFromFirestore(cleanUid),
          2000,
          {}
        );
        Object.values(persistedDailyVideos).forEach((item) => {
          if (item && item.videoId) {
            const vidId = extractYouTubeVideoId(item.videoId || item.url || '');
            if (vidId) {
              videosToArchive.push({
                videoId: vidId,
                videoTitle: item.videoTitle || item.title || 'Daily Video Practice',
                watchedAt: new Date().toISOString(),
              });
            }
          }
        });
      } catch (err) {
        console.warn('Notice reading persisted routines to archive videos:', err);
      }
    }

    // Persist newly archived videos to Firestore users/{studentUID}/watchedVideosHistory
    if (cleanUid && videosToArchive.length > 0) {
      try {
        await withFirestoreTimeout(
          addMultipleVideosToWatchedHistoryInFirestore(cleanUid, videosToArchive),
          2500,
          false
        );
      } catch (err) {
        console.warn('Notice archiving videos to Firestore:', err);
      }
    }

    // Build the complete accumulated set of watched IDs (lowercased & trimmed)
    const accumulatedWatchedSet = new Set<string>();
    firestoreWatched.forEach((id) => {
      const clean = (extractYouTubeVideoId(id) || id || '').trim().toLowerCase();
      if (clean) accumulatedWatchedSet.add(clean);
    });
    videosToArchive.forEach((v) => {
      const clean = (extractYouTubeVideoId(v.videoId) || v.videoId || '').trim().toLowerCase();
      if (clean) accumulatedWatchedSet.add(clean);
    });

    // Also query consolidated weeklyHistory subcollection to ensure cross-cycle exclusivity for both videos and tracks
    const accumulatedTrackSet = new Set<string>();
    if (cleanUid) {
      try {
        const pastHistories = await withFirestoreTimeout(
          fetchAllWeeklyHistories(cleanUid),
          2000,
          []
        );
        pastHistories.forEach((hist) => {
          if (Array.isArray(hist.consumedVideoIds)) {
            hist.consumedVideoIds.forEach((v) => {
              const vidId = extractYouTubeVideoId(v.id || v.videoId || '') || v.id || v.videoId || '';
              const clean = vidId.trim().toLowerCase();
              if (clean) accumulatedWatchedSet.add(clean);
            });
          }
          if (Array.isArray(hist.consumedTrackIds)) {
            hist.consumedTrackIds.forEach((t) => {
              const tid = (t.id || t.trackId || '').trim();
              if (tid) accumulatedTrackSet.add(tid);
            });
          }
        });
      } catch (err) {
        console.warn('Notice reading past weeklyHistories for exclusivity check:', err);
      }

      // Also consult studentJournal (Single Source of Truth) for video and audio exclusivity
      try {
        const journalEntries = await withFirestoreTimeout(
          fetchStudentJournalActivitiesFromFirestore(cleanUid, !isPlaceholder ? params.studentEmail : undefined),
          2000,
          []
        );
        journalEntries.forEach((entry) => {
          if (!entry || !entry.id) return;
          if (entry.type === 'video') {
            const vidId = extractYouTubeVideoId(entry.id) || entry.id.trim();
            if (vidId) accumulatedWatchedSet.add(vidId.toLowerCase());
          } else if (entry.type === 'audio') {
            const trackId = entry.id.trim();
            if (trackId) accumulatedTrackSet.add(trackId);
          }
        });
      } catch (err) {
        console.warn('Notice querying studentJournal for exclusivity check:', err);
      }
    }

    // Archive the outgoing cycle into weeklyHistory with both videoId and videoTitle
    if (cleanUid && videosToArchive.length > 0) {
      const consumedVideos: ConsumedVideoItem[] = videosToArchive.map((v) => ({
        id: v.videoId,
        videoId: v.videoId,
        videoTitle: v.videoTitle,
        title: v.videoTitle,
        watchedAt: v.watchedAt,
      }));

      try {
        await withFirestoreTimeout(
          saveWeeklyHistory(cleanUid, `week-${params.currentCycle || 1}`, {
            studentUid: cleanUid,
            studentEmail: !isPlaceholder ? params.studentEmail : '',
            weekId: `week-${params.currentCycle || 1}`,
            weeklyCycle: params.currentCycle || 1,
            consumedVideoIds: consumedVideos,
            updatedAt: new Date().toISOString(),
          }),
          2500,
          false
        );
      } catch (err) {
        console.warn('Notice saving previous cycle to weeklyHistory:', err);
      }
    }

    // Step 3: COMPLETELY RESET DAILY ROUTINES IN FIRESTORE TO "CHOOSE A TOPIC"
    // Every day of the new week must start clean: no pre-assigned video, no locked playlist
    if (cleanUid) {
      try {
        await withFirestoreTimeout(
          resetDailyRoutinesForNewWeekInFirestore(cleanUid, ALL_DAYS),
          2500,
          false
        );
      } catch (err) {
        console.warn('Notice resetting daily routines in Firestore for new week:', err);
      }
    }

    // Step 4: Call backend reset endpoint with resetTopicsToChooseTopic: true and full media exclusivity
    const normLevel = normalizeStudentLevel(params.studentLevel || 'intermediate');

    let data: any = null;
    try {
      const fetchPromise = fetch('/api/student-routines/start-new-week', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentEmail: !isPlaceholder ? studentEmail : '',
          uid: cleanUid,
          studentUid: cleanUid,
          weeklyStudyDaysTarget: targetDays,
          weeklyStudyDays: chosenDays,
          watchedVideosHistory: Array.from(accumulatedWatchedSet),
          listenedTracksHistory: Array.from(accumulatedTrackSet),
          studentLevel: normLevel,
          resetTopicsToChooseTopic: true,
        }),
      });

      const res = await withFirestoreTimeout(fetchPromise, 4500, null as any);
      if (res && res.ok) {
        data = await res.json();
      }
    } catch (netErr) {
      console.warn('Notice during backend sync in executeStartNewWeek:', netErr);
    }

    // Step 5: Construct clean, sanitized routines:
    // ALL days start with "Choose a Topic" (teacherVideos: [], playlistId: '', isRepeatVideo: false)
    const rawRoutines = data?.routines || params.currentRoutines || {};
    const sanitizedRoutines: Record<DayOfWeek, RoutineItem[]> = {} as any;
    ALL_DAYS.forEach((day) => {
      const dayList = rawRoutines[day] || [];
      sanitizedRoutines[day] = dayList.map((act: any) => {
        const isVideoAct =
          act.id?.endsWith('1') ||
          act.activityName?.toLowerCase().includes('vídeo') ||
          act.activityName?.toLowerCase().includes('video') ||
          (act.teacherVideos && act.teacherVideos.length > 0);

        if (isVideoAct) {
          return {
            ...act,
            activityName: 'Video of the Day',
            playlistId: '',
            playlistTitle: '',
            teacherVideos: [],
            completed: false,
            completedToday: false,
            isRepeatVideo: false,
            repeatVideo: false,
          };
        }

        return {
          ...act,
          completed: false,
          completedToday: false,
          isRepeatVideo: false,
          repeatVideo: false,
        };
      });
    });

    const finalCycle = data?.weeklyCycle !== undefined ? data.weeklyCycle : fallbackCycle;

    // Initialize new weeklyHistory document for the new cycle
    if (cleanUid) {
      saveWeeklyHistory(cleanUid, `week-${finalCycle}`, {
        studentUid: cleanUid,
        studentEmail: !isPlaceholder ? params.studentEmail : '',
        weekId: `week-${finalCycle}`,
        weeklyCycle: finalCycle,
        consumedVideoIds: [],
        consumedTrackIds: [],
        weeklyVocabulary: [],
        updatedAt: new Date().toISOString(),
      }).catch((err) => {
        console.warn('Notice initializing new weeklyHistory document:', err);
      });
    }

    return {
      success: true,
      weeklyCycle: finalCycle,
      weeklyStudyDaysTarget: data?.weeklyStudyDaysTarget || targetDays,
      weeklyStudyDays: data?.weeklyStudyDays || chosenDays,
      routines: sanitizedRoutines,
      message: data?.message || 'New week cycle started successfully with all days ready for Choose a Topic.',
    };
  } catch (unexpectedError) {
    console.error('Critical error in executeStartNewWeek, applying safe fallback:', unexpectedError);

    // Construct safe fallback routines so UI is never left in broken or loading state
    const rawRoutines: Partial<Record<DayOfWeek, RoutineItem[]>> = params.currentRoutines || {};
    const fallbackRoutines: Record<DayOfWeek, RoutineItem[]> = {} as any;
    ALL_DAYS.forEach((day) => {
      const dayList = rawRoutines[day] || [];
      fallbackRoutines[day] = dayList.map((act: any) => {
        const isVideoAct =
          act.id?.endsWith('1') ||
          act.activityName?.toLowerCase().includes('vídeo') ||
          act.activityName?.toLowerCase().includes('video');
        if (isVideoAct) {
          return {
            ...act,
            activityName: 'Video of the Day',
            playlistId: '',
            playlistTitle: '',
            teacherVideos: [],
            completed: false,
            completedToday: false,
            isRepeatVideo: false,
            repeatVideo: false,
          };
        }
        return {
          ...act,
          completed: false,
          completedToday: false,
          isRepeatVideo: false,
          repeatVideo: false,
        };
      });
    });

    return {
      success: true,
      weeklyCycle: fallbackCycle,
      weeklyStudyDaysTarget: targetDays,
      weeklyStudyDays: chosenDays,
      routines: fallbackRoutines,
      message: 'New week cycle initiated with local safe recovery.',
    };
  }
}
