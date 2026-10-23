import { DayOfWeek, RoutineItem, ConsumedVideoItem } from '../types';
import {
  fetchWatchedVideosHistoryFromFirestore,
  addMultipleVideosToWatchedHistoryInFirestore,
  fetchAllRoutineVideosFromFirestore,
  resetRepeatFlagsInFirestore,
  getAuthHeaders,
} from '../hooks/useRoutine';
import { normalizeStudentIdForPath, withFirestoreTimeout } from '../utils/routineSync';
import { extractYouTubeVideoId } from '../utils/youtube';
import { normalizeStudentLevel } from '../utils/spotify';
import { fetchAllWeeklyHistories, saveWeeklyHistory } from '../hooks/useStudentHistory';
import {
  fetchStudentJournalActivitiesFromFirestore,
  saveStudentVocabularyToFirestore,
} from '../utils/studentPersistence';
import { StudentDictionaryEntry } from '../types';
import {
  getInstantOrCachedWord,
  isGenericPedagogicalDefinition,
  isGenericPedagogicalExample,
} from '../utils/dictionaryService';
import { normalizeDictionaryWord } from '../utils/studentDictionaryLibrary';
import { defaultRoutinesByDay } from '../data/defaultRoutines';

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

    // Step 2b: Collect all legitimately registered words from the ending cycle to ensure permanent preservation in My Dictionary
    const wordsToPreserve: Array<{ word: string; sourceDay: DayOfWeek; activityName: string; activityId?: string }> = [];

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
          if (Array.isArray(act.learnedWords) && act.learnedWords.length > 0) {
            act.learnedWords.forEach((w) => {
              const trimmed = (w || '').trim();
              if (trimmed) {
                wordsToPreserve.push({
                  word: trimmed,
                  sourceDay: day,
                  activityName: act.activityName || 'Daily Routine',
                  activityId: act.id,
                });
              }
            });
          }
        });
      });
    }

    // Guarantee that all legitimately recorded words from current routines are persisted to My Dictionary
    if (cleanUid && wordsToPreserve.length > 0) {
      try {
        const nowIso = new Date().toISOString();
        const dictEntriesToSave: StudentDictionaryEntry[] = wordsToPreserve.map((item) => {
          const cleanW = item.word;
          const normKey = normalizeDictionaryWord(cleanW);
          const cached = getInstantOrCachedWord(cleanW, item.activityName, params.studentLevel, cleanUid, !isPlaceholder ? params.studentEmail : undefined);
          return {
            id: `routine_${normKey.replace(/[^a-zA-Z0-9_-]/g, '_')}_${Date.now()}`,
            word: cleanW,
            originalWord: cleanW,
            normalizedWord: normKey,
            definitionEn: cached.definitionEn && !isGenericPedagogicalDefinition(cached.definitionEn) ? cached.definitionEn : '',
            exampleSentenceEn: cached.exampleSentenceEn && !isGenericPedagogicalExample(cached.exampleSentenceEn) ? cached.exampleSentenceEn : '',
            partOfSpeech: cached.partOfSpeech || (cleanW.includes(' ') ? 'Idiomatic Expression' : 'Noun'),
            translationPt: cached.translationPt || '',
            cefrLevel: cached.cefrLevel || 'B1',
            learnedAt: nowIso,
            source: 'routine',
            sourceActivityName: `${item.activityName} (${item.sourceDay})`,
            sourceDay: item.sourceDay,
            origins: [
              {
                source: 'routine',
                activityName: `${item.activityName} (${item.sourceDay})`,
                dayOfWeek: item.sourceDay,
                date: nowIso.slice(0, 10),
                context: `5 Words routine activity: "${item.activityName}"`,
              },
            ],
            routineRef: {
              day: item.sourceDay,
              activityName: item.activityName,
              activityId: item.activityId,
            },
          };
        });

        await withFirestoreTimeout(
          saveStudentVocabularyToFirestore(cleanUid, dictEntriesToSave, !isPlaceholder ? params.studentEmail : undefined),
          3500,
          false
        );
      } catch (dictErr) {
        console.warn('Notice preserving outgoing 5 words into My Dictionary before reset:', dictErr);
      }
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
    if (cleanUid && (videosToArchive.length > 0 || wordsToPreserve.length > 0)) {
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
            weeklyVocabulary: wordsToPreserve.map((w) => {
              const cached = getInstantOrCachedWord(w.word, w.activityName, params.studentLevel, cleanUid, !isPlaceholder ? params.studentEmail : undefined);
              return {
                word: w.word,
                definitionEn: cached.definitionEn || '',
                translationPt: cached.translationPt || '',
                learnedAt: new Date().toISOString(),
                sourceDay: w.sourceDay,
              };
            }),
            updatedAt: new Date().toISOString(),
          }),
          2500,
          false
        );
      } catch (err) {
        console.warn('Notice saving previous cycle to weeklyHistory:', err);
      }
    }

    // HOTFIX 2.3.5E: Removed redundant client call to resetDailyRoutinesForNewWeekInFirestore.
    // The backend POST /api/student-routines/start-new-week executes the atomic reset and advances the cycle.

    // Step 3 & 4: Call backend reset endpoint with authentication, expectedCycle, attemptId, and full media exclusivity
    const normLevel = normalizeStudentLevel(params.studentLevel || 'intermediate');
    const expectedCycle = params.currentCycle || 1;
    const attemptId = `start_week_${cleanUid || 'student'}_cycle${expectedCycle}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

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
          studentEmail: !isPlaceholder ? studentEmail : '',
          uid: cleanUid,
          studentUid: cleanUid,
          expectedCycle,
          attemptId,
          weeklyStudyDaysTarget: targetDays,
          weeklyStudyDays: chosenDays,
          watchedVideosHistory: Array.from(accumulatedWatchedSet),
          listenedTracksHistory: Array.from(accumulatedTrackSet),
          studentLevel: normLevel,
          resetTopicsToChooseTopic: true,
        }),
      });

      const res = await withFirestoreTimeout(fetchPromise, 6000, null as any);

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

    // HOTFIX 2.3.5E — Requirement 5: Timeout and recovery verification
    // If the HTTP response did not arrive, avoid treating timeout as definitive failure:
    // 1. Consult persisted cycle on backend
    // 2. Check if the attempt was completed
    // 3. Sync React state with confirmed result
    // 4. Present success only when completion is proven
    // 5. If uncertain, block automatic re-attempts
    if (requestTimedOutOrErrored && !data) {
      console.warn('Start new week response did not arrive. Performing recovery inquiry with backend...');
      try {
        const queryUrl = `/api/student-routines/cycle-status?studentUid=${encodeURIComponent(cleanUid)}&attemptId=${encodeURIComponent(attemptId)}`;
        const statusRes = await withFirestoreTimeout(
          fetch(queryUrl, { method: 'GET', headers: authHeaders }),
          3500,
          null as any
        );

        if (statusRes && statusRes.ok) {
          const statusData = await statusRes.json();
          const confirmedCycle = statusData.currentCycle || statusData.weeklyCycle;
          const attemptWasConfirmed = Boolean(statusData.attemptConfirmed || statusData.lastCycleAttemptId === attemptId);

          if (attemptWasConfirmed || confirmedCycle === expectedCycle + 1) {
            console.info('Recovery confirmed: start-new-week was successfully committed on the server despite HTTP timeout.');
            data = statusData.lastCycleResult || {
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
            console.warn('Recovery returned uncertain status:', statusData);
            return {
              success: false,
              weeklyCycle: confirmedCycle || expectedCycle,
              weeklyStudyDaysTarget: targetDays,
              weeklyStudyDays: chosenDays,
              routines: params.currentRoutines || ({} as any),
              message: 'Synchronization uncertain. Please check your connection and verify your current cycle.',
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

    // Step 5: Construct clean, sanitized routines:
    // ALL days start with "Choose a Topic" (teacherVideos: [], playlistId: '', isRepeatVideo: false)
    // AND 5 Key Words for this Moment panel resets to empty 0/5 (learnedWords: [])
    const rawRoutines = data?.routines || params.currentRoutines || {};
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
            isRepeatVideo: false,
            repeatVideo: false,
          };
        }

        return {
          ...act,
          learnedWords: [],
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
    console.error('Critical error in executeStartNewWeek, reporting backend failure:', unexpectedError);

    return {
      success: false,
      weeklyCycle: params.currentCycle || 1,
      weeklyStudyDaysTarget: targetDays,
      weeklyStudyDays: chosenDays,
      routines: params.currentRoutines || ({} as any),
      message: 'Critical error starting new week cycle.',
    };
  }
}
