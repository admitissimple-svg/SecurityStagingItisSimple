import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  BookOpen,
  Sparkles,
  Layers,
  BookMarked,
  ArrowRight,
  CheckCircle2,
  Video,
  Headphones,
  Users,
  ChevronRight,
  Flame,
  RefreshCw,
  X,
  Target,
} from 'lucide-react';
import {
  DayOfWeek,
  Language,
  RoutineItem,
  WeeklyHomeworkData,
  UserProfile,
  StudentDictionaryEntry,
  StudentJournalEntry,
} from '../types';
import { Translations, getTranslations } from '../utils/i18n';
import { DAYS_OF_WEEK, getTodayDayOfWeek } from '../utils/notifications';
import { getDailyMemorizationSchedule } from '../utils/homeworkGenerator';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../firebase';
import { getAccessToken } from '../utils/auth';
import {
  saveStudentWeeklyChecksToFirestore,
  fetchStudentWeeklyChecksFromFirestore,
  saveMemorizationCompletionToFirestore,
  subscribeToStudentWeeklyChecks,
  getCachedWeeklyChecks,
  recordActivityInStudentJournal,
  removeActivityFromStudentJournal,
  subscribeToStudentJournal,
  getDateForDayInCurrentWeek,
  getTodayIsoDate,
  mapStepIdToJournalType,
  deriveWeeklyChecksFromJournal,
  isValidCanonicalUid,
  normalizeUid,
  normalizeWeekId,
  parseWeekCycleNumber,
} from '../utils/studentPersistence';

interface StudentWeeklyActivitySectionProps {
  homework: WeeklyHomeworkData | null;
  routinesByDay: Record<DayOfWeek, RoutineItem[]>;
  userProfile?: UserProfile;
  studentJournal?: StudentJournalEntry[];
  onOpenHomeworkModal: (targetDay?: DayOfWeek) => void;
  onOpenDictionaryModal: () => void;
  onOpenJournalModal?: () => void;
  journalEntriesCount?: number;
  currentLanguage: Language;
  dictionaryEntries?: StudentDictionaryEntry[];
  wordsFromRoutines?: Array<{ word: string; sourceActivityName?: string; sourceDay?: DayOfWeek }>;
  onUpdateUserProfile?: (updated: Partial<UserProfile>) => void;
  weeklyChecks?: Record<string, boolean>;
  onToggleWeeklyCheck?: (stepId: string, dayKey: DayOfWeek, newChecked?: boolean) => void;
}

const WEEK_DAYS: { key: DayOfWeek; label: string }[] = [
  { key: 'monday', label: 'Mon' },
  { key: 'tuesday', label: 'Tus' },
  { key: 'wednesday', label: 'Wed' },
  { key: 'thursday', label: 'Thu' },
  { key: 'friday', label: 'Fri' },
  { key: 'saturday', label: 'Sat' },
  { key: 'sunday', label: 'Sun' },
];

interface WeeklyRoutineRow {
  id: string;
  time: string;
  titleEn: string;
  titlePt: string;
  icon: any;
}

const ROUTINE_ROWS: WeeklyRoutineRow[] = [
  {
    id: 'video_day',
    time: '07:30',
    titleEn: 'Video of the Day',
    titlePt: 'Vídeo do Dia',
    icon: Video,
  },
  {
    id: 'audio_day',
    time: '08:30',
    titleEn: 'Audio of the Day: Podcast or Music',
    titlePt: 'Áudio do Dia: Podcast ou Música',
    icon: Headphones,
  },
  {
    id: 'tutor_live',
    time: '15:00',
    titleEn: 'Chat with Your Native Friend',
    titlePt: 'Conversa com Seu Amigo Nativo',
    icon: Users,
  },
  {
    id: 'memorization',
    time: '21:30',
    titleEn: 'Memorization Activity & Consolidation',
    titlePt: 'Atividade de Memorização & Fixação',
    icon: BookOpen,
  },
];

export const StudentWeeklyActivitySection: React.FC<StudentWeeklyActivitySectionProps> = ({
  homework,
  routinesByDay,
  userProfile,
  studentJournal: propStudentJournal,
  onOpenHomeworkModal,
  onOpenDictionaryModal,
  onOpenJournalModal,
  journalEntriesCount = 0,
  currentLanguage,
  dictionaryEntries,
  wordsFromRoutines,
  onUpdateUserProfile,
  weeklyChecks: propWeeklyChecks,
  onToggleWeeklyCheck,
}) => {
  const isEn = currentLanguage === 'en';
  const t = getTranslations(currentLanguage);
  const studentEmail = userProfile?.email || '';
  const studentUid = normalizeUid(userProfile?.uid || userProfile?.id, studentEmail);
  const todayDay = getTodayDayOfWeek();

  // Canonical active week cycle and week ID derived strictly from userProfile.weeklyCycle
  const activeWeekCycle = parseWeekCycleNumber(userProfile?.weeklyCycle);
  const activeWeekId = normalizeWeekId(userProfile?.weeklyCycle);

  // Active study days from student's single source of truth plan
  const activeStudyDays: DayOfWeek[] = useMemo(() => {
    if (userProfile?.weeklyStudyDays && userProfile.weeklyStudyDays.length > 0) {
      return userProfile.weeklyStudyDays;
    }
    return ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  }, [userProfile?.weeklyStudyDays]);

  const todayMemorizationSchedule = useMemo(() => {
    return getDailyMemorizationSchedule(
      todayDay,
      activeStudyDays,
      activeWeekCycle ?? 1
    );
  }, [todayDay, activeStudyDays, activeWeekCycle]);

  // Real-time studentJournal state for multi-device sync
  const [localJournal, setLocalJournal] = useState<StudentJournalEntry[]>(userProfile?.studentJournal || []);

  useEffect(() => {
    if (propStudentJournal && Array.isArray(propStudentJournal)) {
      setLocalJournal(propStudentJournal);
    } else if (userProfile?.studentJournal && Array.isArray(userProfile.studentJournal)) {
      setLocalJournal(userProfile.studentJournal);
    }
  }, [propStudentJournal, userProfile?.studentJournal]);

  // Real-time listener for cross-device synchronization (e.g. mobile to desktop)
  useEffect(() => {
    if (!studentUid && !studentEmail) return;
    const unsub = subscribeToStudentJournal(studentUid, studentEmail, (journal) => {
      if (Array.isArray(journal)) {
        setLocalJournal(journal);
      }
    });
    return () => unsub();
  }, [studentUid, studentEmail]);

  // Single Source of Truth: Merge prop, real-time listener, and profile journal by entry id
  const activeJournal = useMemo(() => {
    const map = new Map<string, StudentJournalEntry>();
    if (Array.isArray(propStudentJournal)) {
      propStudentJournal.forEach((e) => {
        if (e && e.id) map.set(e.id, e);
      });
    }
    if (Array.isArray(localJournal)) {
      localJournal.forEach((e) => {
        if (e && e.id) map.set(e.id, e);
      });
    }
    if (Array.isArray(userProfile?.studentJournal)) {
      userProfile.studentJournal.forEach((e) => {
        if (e && e.id && !map.has(e.id)) map.set(e.id, e);
      });
    }
    const list = Array.from(map.values());
    list.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    return list;
  }, [propStudentJournal, localJournal, userProfile?.studentJournal]);

  // Local state for dictionary entries loaded directly from server database
  const [loadedDictEntries, setLoadedDictEntries] = useState<StudentDictionaryEntry[]>([]);

  // Sync loaded entries whenever dictionaryEntries prop changes
  useEffect(() => {
    if (Array.isArray(dictionaryEntries)) {
      setLoadedDictEntries(dictionaryEntries);
    }
  }, [dictionaryEntries]);

  // Fetch dictionary directly from server database for the active student
  useEffect(() => {
    if (!studentEmail) return;
    let isMounted = true;
    fetch(`/api/student-dictionary?studentEmail=${encodeURIComponent(studentEmail)}`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => {
        if (isMounted && Array.isArray(data) && data.length > 0) {
          setLoadedDictEntries((prev) => {
            const map = new Map<string, StudentDictionaryEntry>();
            prev.forEach((e) => {
              if (e && e.word) map.set(e.word.toLowerCase().trim(), e);
            });
            data.forEach((e: StudentDictionaryEntry) => {
              if (e && e.word) map.set(e.word.toLowerCase().trim(), e);
            });
            return Array.from(map.values());
          });
        }
      })
      .catch((err) => {
        console.warn('Error loading student dictionary for weekly activity counter:', err);
      });
    return () => {
      isMounted = false;
    };
  }, [studentEmail]);

  // Total learned / practiced words calculation across student personal dictionary (saved by native friend or student), routines, and live sessions
  const totalWords = useMemo(() => {
    const uniqueWords = new Set<string>();

    // 1. Personal dictionary words (saved by native friends during live lessons or student)
    const activeDict = (dictionaryEntries && dictionaryEntries.length > 0)
      ? dictionaryEntries
      : loadedDictEntries;

    if (Array.isArray(activeDict)) {
      activeDict.forEach((entry) => {
        const clean = (entry?.word || '').trim().toLowerCase();
        if (clean) uniqueWords.add(clean);
      });
    }

    // 2. Words from routines and live lesson notes
    if (Array.isArray(wordsFromRoutines)) {
      wordsFromRoutines.forEach((item) => {
        const clean = (item?.word || '').trim().toLowerCase();
        if (clean) uniqueWords.add(clean);
      });
    }

    // 3. Directly inspect routinesByDay items
    if (routinesByDay && typeof routinesByDay === 'object') {
      Object.values(routinesByDay as Record<string, RoutineItem[]>).forEach((dayItems) => {
        if (Array.isArray(dayItems)) {
          dayItems.forEach((item) => {
            if (item?.learnedWords && Array.isArray(item.learnedWords)) {
              item.learnedWords.forEach((w) => {
                if (typeof w === 'string' && w.trim().length > 0) {
                  uniqueWords.add(w.trim().toLowerCase());
                }
              });
            }
          });
        }
      });
    }

    return uniqueWords.size;
  }, [dictionaryEntries, loadedDictEntries, wordsFromRoutines, routinesByDay]);

  // Target weekly chat sessions with native friend (default: 1 or from user profile)
  const initialTarget = userProfile?.weeklyNativeLessonsTarget || 1;
  const [weeklyNativeTarget, setWeeklyNativeTarget] = useState<number>(initialTarget);

  useEffect(() => {
    if (userProfile?.weeklyNativeLessonsTarget && userProfile.weeklyNativeLessonsTarget > 0) {
      setWeeklyNativeTarget(userProfile.weeklyNativeLessonsTarget);
    }
  }, [userProfile?.weeklyNativeLessonsTarget]);

  // 7-day checklist grid state: map of "stepId_dayKey" -> boolean
  // Starts with no markings (0%) and persists in Firestore users/{studentUID} and backend server
  const [localWeeklyChecks, setLocalWeeklyChecks] = useState<Record<string, boolean>>({});

  // Use props if provided from App level, otherwise fall back to local state
  const weeklyChecks = propWeeklyChecks !== undefined ? propWeeklyChecks : localWeeklyChecks;

  // Reset local weekly checks immediately when a new week begins
  useEffect(() => {
    if (propWeeklyChecks === undefined) {
      setLocalWeeklyChecks({});
    }
  }, [activeWeekCycle, propWeeklyChecks]);

  // Fetch weekly checks and weekly native target from Firestore & server API for multi-device sync
  useEffect(() => {
    let isMounted = true;
    if (propWeeklyChecks === undefined && (studentUid || studentEmail)) {
      if (activeWeekCycle !== null) {
        fetchStudentWeeklyChecksFromFirestore(studentUid, studentEmail, activeWeekCycle)
          .then((data) => {
            if (isMounted && data) {
              if (data.checks) {
                setLocalWeeklyChecks((prev) => ({ ...prev, ...data.checks }));
              }
              if (typeof data.weeklyNativeLessonsTarget === 'number' && data.weeklyNativeLessonsTarget > 0) {
                setWeeklyNativeTarget(data.weeklyNativeLessonsTarget);
              }
            }
          })
          .catch((err) => {
            console.warn('Notice loading weekly checks from Firestore:', err);
          });
      }
    }

    // Real-time Firestore subscription to guarantee instant checkmark reflection
    let unsubWeekly: (() => void) | null = null;
    if ((studentUid || studentEmail) && activeWeekCycle !== null) {
      unsubWeekly = subscribeToStudentWeeklyChecks(
        studentUid,
        studentEmail,
        (data) => {
          if (isMounted && data && data.checks) {
            setLocalWeeklyChecks((prev) => ({ ...prev, ...data.checks }));
          }
          if (isMounted && typeof data?.weeklyNativeLessonsTarget === 'number' && data.weeklyNativeLessonsTarget > 0) {
            setWeeklyNativeTarget(data.weeklyNativeLessonsTarget);
          }
        },
        activeWeekCycle
      );
    }

    // Also fetch target from endpoint with protected Firebase Auth & explicit week
    let unsubAuthSession: (() => void) | null = null;
    if (activeWeekCycle !== null && activeWeekId) {
      const executeProtectedFetch = async () => {
        const token = await getAccessToken();
        if (!isMounted || !token) return;

        const canonicalUid = auth.currentUser?.uid || (isValidCanonicalUid(studentUid) ? studentUid : '');
        if (!canonicalUid && !studentEmail) return;

        const currentAuthEmail = (auth?.currentUser?.email || '').toLowerCase().trim();
        const safeStudentEmail = (studentEmail && (!currentAuthEmail || currentAuthEmail === studentEmail.toLowerCase().trim())) ? studentEmail : '';

        const params = new URLSearchParams();
        if (canonicalUid) params.append('studentUid', canonicalUid);
        if (safeStudentEmail) params.append('studentEmail', safeStudentEmail);
        params.append('weekId', activeWeekId);
        params.append('weeklyCycle', String(activeWeekCycle));

        fetch(`/api/routines/weekly-checks?${params.toString()}`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        })
          .then((res) => (res.ok ? res.json() : null))
          .then((data) => {
            if (isMounted && data) {
              if (propWeeklyChecks === undefined && data.checks && Object.keys(data.checks).length > 0) {
                setLocalWeeklyChecks((prev) => ({ ...prev, ...data.checks }));
              }
              if (typeof data.weeklyNativeLessonsTarget === 'number' && data.weeklyNativeLessonsTarget > 0) {
                setWeeklyNativeTarget(data.weeklyNativeLessonsTarget);
              }
            }
          })
          .catch((err) => {
            console.warn('Error loading weekly checks from server:', err);
          });
      };

      // Trigger fetch once auth resolution completes
      executeProtectedFetch();

      // Ensure immediate sync when user logs in
      unsubAuthSession = onAuthStateChanged(auth, (user) => {
        if (user && isMounted) {
          executeProtectedFetch();
        }
      });
    }

    return () => {
      isMounted = false;
      if (unsubWeekly) unsubWeekly();
      if (unsubAuthSession) unsubAuthSession();
    };
  }, [studentEmail, studentUid, activeWeekCycle, activeWeekId, propWeeklyChecks]);

  const handleTargetChange = (newTarget: number) => {
    const safeTarget = Math.max(1, Math.min(7, newTarget));
    setWeeklyNativeTarget(safeTarget);
    if (onUpdateUserProfile) {
      onUpdateUserProfile({ weeklyNativeLessonsTarget: safeTarget });
    }
    // Save to Firestore and server strictly with activeWeekCycle
    if (activeWeekCycle !== null) {
      saveStudentWeeklyChecksToFirestore(
        studentUid,
        weeklyChecks,
        studentEmail,
        safeTarget,
        weeklyStudyDaysTarget,
        activeWeekCycle
      );
    }
  };

  // Helper to determine if a day's video is a repeat video action
  const isDayVideoRepeatAction = useCallback(
    (dayKey: DayOfWeek): boolean => {
      // 1. Check routinesByDay for this day
      const dayRoutines = routinesByDay?.[dayKey] || [];
      for (const act of dayRoutines) {
        if (!act) continue;
        if (act.isRepeatVideo || (act as any).repeatVideo) return true;
        const actName = (act.activityName || '').toLowerCase();
        if (
          actName.includes('repeat previous video') ||
          actName.includes('repetir vídeo anterior') ||
          actName.includes('repetir video anterior')
        ) {
          return true;
        }
        const tv = act.teacherVideos?.[0];
        if (tv) {
          if ((tv as any).isRepeatVideo) return true;
          if (tv.playlistId === 'repeat_previous_video') return true;
          const plTitle = (tv.playlistTitle || tv.title || '').toLowerCase();
          if (
            plTitle.includes('repeat previous video') ||
            plTitle.includes('repetir vídeo anterior') ||
            plTitle.includes('repetir video anterior')
          ) {
            return true;
          }
          if (
            tv.instructions &&
            (tv.instructions.toLowerCase().includes('repeated from') ||
              tv.instructions.toLowerCase().includes('repetido de'))
          ) {
            return true;
          }
        }
      }

      // 2. Check userProfile persisted video or routines if available
      const persistedRoutines = (userProfile as any)?.persistedRoutines?.[dayKey];
      if (
        persistedRoutines?.isRepeatVideo ||
        persistedRoutines?.playlistId === 'repeat_previous_video'
      ) {
        return true;
      }
      const persistedVideo =
        (userProfile as any)?.persistedVideos?.[dayKey] ||
        (userProfile as any)?.teacherVideosByDay?.[dayKey];
      if (
        persistedVideo?.isRepeatVideo ||
        persistedVideo?.playlistId === 'repeat_previous_video'
      ) {
        return true;
      }

      return false;
    },
    [routinesByDay, userProfile]
  );

  // Check if an activity is completed: rendered with instant synchronization from weeklyChecks, homework progress, and studentJournal for persistent multi-device sync
  const isActivityCompleted = useCallback(
    (rowId: string, dayKey: DayOfWeek): boolean => {
      const checkKey = `${rowId}_${dayKey}`;

      if (activeWeekCycle === null) {
        return false;
      }

      // 1. Memorization Activity: Permanent Firestore persistence and multi-device sync
      if (rowId === 'memorization') {
        // Strictly only scheduled study days count for memorization
        if (!activeStudyDays.includes(dayKey)) return false;

        // Direct weeklyChecks checkmark
        if (weeklyChecks && Boolean(weeklyChecks[checkKey])) return true;
        // Direct homework completed parts by day
        if (homework?.completedPartsByDay && Boolean(homework.completedPartsByDay[dayKey])) return true;
        // Check activeJournal specifically for this day and active week
        const hasMemoInJournal = activeJournal.some((entry) => {
          if (!entry) return false;
          const isMemo = entry.type === 'memorization' || (entry as any).type === 'homework';
          if (!isMemo) return false;
          if (entry.dayOfWeek && entry.dayOfWeek.toLowerCase() === dayKey.toLowerCase()) {
            if (entry.week === activeWeekCycle) return true;
          }
          return false;
        });
        if (hasMemoInJournal) return true;
        // In-memory cache fallback (Firestore users/{studentUID} is the master)
        const localCached = getCachedWeeklyChecks(studentUid, studentEmail, activeWeekCycle);
        if (localCached && Boolean(localCached[checkKey])) return true;
        return false;
      }

      // 2. Video of the Day: S-Path evolution tracker logic
      // Rule: If a student completes an activity on a given day (even if it is a repeated video),
      // that specific day must be marked as completed in the S-Path tracker.
      // Do not mark past/retroactive days, but do mark the current active day when completed.
      if (rowId === 'video_day') {
        // Strictly only scheduled study days count
        if (!activeStudyDays.includes(dayKey)) {
          return false;
        }

        // Direct checkmark from weeklyChecks (Single Source of Truth)
        if (weeklyChecks && Boolean(weeklyChecks[checkKey])) {
          return true;
        }

        // Check if completed in routinesByDay
        const dayList = routinesByDay?.[dayKey] || [];
        const hasCompletedRoutineVideo = dayList.some((act) => {
          if (!act) return false;
          const actName = (act.activityName || '').toLowerCase();
          const isVideo =
            (act.teacherVideos && act.teacherVideos.length > 0) ||
            act.id?.endsWith('1') ||
            actName.includes('video') ||
            actName.includes('vídeo');
          return isVideo && Boolean(act.completedToday || act.completed);
        });
        if (hasCompletedRoutineVideo) return true;

        // In studentJournal: verify completion strictly for this scheduled day and active week (ignoring past/retroactive reviews)
        const hasValidJournalVideo = activeJournal.some((entry) => {
          if (!entry) return false;
          const isVideo = entry.type === 'video' || (entry as any).type === 'video_day';
          if (!isVideo) return false;

          // Do not mark past/retroactive day reviews
          if ((entry as any).reviewedPastDay) {
            return false;
          }

          // Strictly match the scheduled day for this routine item and active week
          if (entry.dayOfWeek && entry.dayOfWeek.toLowerCase() === dayKey.toLowerCase()) {
            if (entry.week === activeWeekCycle) {
              return true;
            }
          }
          return false;
        });

        if (hasValidJournalVideo) return true;

        // In-memory cache fallback (Firestore users/{studentUID} is the master)
        const localCached = getCachedWeeklyChecks(studentUid, studentEmail, activeWeekCycle);
        if (localCached && Boolean(localCached[checkKey])) return true;

        return false;
      }

      // 3. Audio of the Day & Live Tutor Lessons
      if (rowId === 'audio_day' && !activeStudyDays.includes(dayKey)) {
        return false;
      }

      if (weeklyChecks && Boolean(weeklyChecks[checkKey])) return true;

      const targetType = mapStepIdToJournalType(rowId);

      const hasMatchingJournal = activeJournal.some((entry) => {
        if (!entry) return false;
        const matchesType =
          entry.type === targetType ||
          (rowId === 'tutor_live' && (entry.type === 'lesson' || (entry as any).type === 'tutor_live')) ||
          (rowId === 'audio_day' && (entry.type === 'audio' || (entry as any).type === 'audio_day'));
        if (!matchesType) return false;

        if (entry.dayOfWeek && entry.dayOfWeek.toLowerCase() === dayKey.toLowerCase()) {
          if (entry.week === activeWeekCycle) return true;
        }
        return false;
      });

      if (hasMatchingJournal) return true;

      const localCached = getCachedWeeklyChecks(studentUid, studentEmail, activeWeekCycle);
      if (localCached && Boolean(localCached[checkKey])) return true;

      return false;
    },
    [
      activeJournal,
      activeWeekCycle,
      weeklyChecks,
      routinesByDay,
      homework?.completedPartsByDay,
      studentUid,
      studentEmail,
      activeStudyDays,
    ]
  );

  const toggleCheck = (stepId: string, dayKey: DayOfWeek) => {
    // Only allow marking days configured in the student's study plan (tutor_live remains independent)
    if (stepId !== 'tutor_live' && !activeStudyDays.includes(dayKey)) return;

    // Objective 5: If the active week is unavailable or invalid, prevent new weekly completion writes
    if (activeWeekCycle === null || !activeWeekId) {
      console.warn('[StudentWeeklyActivitySection] Active week cycle is unknown or invalid. Preventing weekly completion write.');
      return;
    }

    const isCurrentlyChecked = isActivityCompleted(stepId, dayKey);
    const newChecked = !isCurrentlyChecked;

    // Objective 6: When parent callback is present, parent callback owns persistence.
    // Delegate directly and do NOT execute redundant journal record/remove calls in child.
    if (onToggleWeeklyCheck) {
      onToggleWeeklyCheck(stepId, dayKey, newChecked);
      return;
    }

    // Standalone mode: when parent callback is absent
    const targetType = mapStepIdToJournalType(stepId);
    const dayDate = getDateForDayInCurrentWeek(dayKey);

    // If step is memorization, persist permanently across all Firestore documents and subcollections
    if (stepId === 'memorization') {
      saveMemorizationCompletionToFirestore(
        studentUid,
        studentEmail,
        dayKey,
        newChecked,
        homework || undefined,
        activeWeekId
      );
    }

    // Persist directly to studentJournal in Firestore users/{studentUID} strictly with activeWeekCycle
    if (newChecked) {
      recordActivityInStudentJournal(
        studentUid,
        {
          id: `${stepId}_${dayKey}_${activeWeekCycle}_${Date.now()}`,
          type: targetType,
          date: dayDate,
          dayOfWeek: dayKey,
          week: activeWeekCycle,
          timestamp: Date.now(),
          title: stepId === 'tutor_live' ? 'Live Session with Native Friend' : stepId === 'memorization' ? 'Weekly Memorization Activity' : undefined,
        },
        studentEmail
      ).then((res) => {
        if (res.updatedJournal) {
          setLocalJournal(res.updatedJournal);
        }
      });
    } else {
      removeActivityFromStudentJournal(
        studentUid,
        targetType,
        dayKey,
        activeWeekCycle,
        studentEmail
      ).then((res) => {
        if (res.updatedJournal) {
          setLocalJournal(res.updatedJournal);
        }
      });
    }

    const key = `${stepId}_${dayKey}`;
    const previousWeeklyChecks = { ...localWeeklyChecks };
    setLocalWeeklyChecks((prev) => ({
      ...prev,
      [key]: newChecked,
    }));

    // Persist directly to Firestore users/{studentUID} and backend database with rollback on failure
    saveStudentWeeklyChecksToFirestore(
      studentUid,
      { [key]: newChecked },
      studentEmail,
      weeklyNativeTarget,
      weeklyStudyDaysTarget,
      activeWeekCycle
    ).then((success) => {
      if (!success) {
        setLocalWeeklyChecks(previousWeeklyChecks);
      }
    }).catch(() => {
      setLocalWeeklyChecks(previousWeeklyChecks);
    });
  };

  // Count completed days per routine row strictly based on isActivityCompleted
  // Daily habits (video, audio, memorization) strictly count unique daily completions for scheduled study days, ignoring video repeat actions
  const checkedCounts = useMemo(() => {
    const counts: Record<string, number> = {
      video_day: 0,
      audio_day: 0,
      tutor_live: 0,
      memorization: 0,
    };
    WEEK_DAYS.forEach((d) => {
      ROUTINE_ROWS.forEach((row) => {
        // Daily habits strictly count unique daily completions for the scheduled day
        if (row.id !== 'tutor_live' && !activeStudyDays.includes(d.key)) {
          return;
        }
        if (isActivityCompleted(row.id, d.key)) {
          counts[row.id] = (counts[row.id] || 0) + 1;
        }
      });
    });
    return counts;
  }, [isActivityCompleted, activeStudyDays]);

  const weeklyStudyDaysTarget =
    userProfile?.weeklyStudyDaysTarget && userProfile.weeklyStudyDaysTarget >= 1 && userProfile.weeklyStudyDaysTarget <= 7
      ? userProfile.weeklyStudyDaysTarget
      : 7;

  // Pillar completion ratios (0.0 to 1.0 capped)
  // Daily habits (Video, Audio, Memorization) use the student's configured weekly study days goal (e.g. 2, 3, 5, 7 days/week) as the 100% divisor.
  // Chat with Native Friend uses the student's dynamic weekly target (contracted live lessons), 100% independent!
  const videoRatio = Math.min(1, (checkedCounts.video_day || 0) / Math.max(1, weeklyStudyDaysTarget));
  const audioRatio = Math.min(1, (checkedCounts.audio_day || 0) / Math.max(1, weeklyStudyDaysTarget));
  const nativeRatio = Math.min(1, (checkedCounts.tutor_live || 0) / Math.max(1, weeklyNativeTarget));
  const memoRatio = Math.min(1, (checkedCounts.memorization || 0) / Math.max(1, weeklyStudyDaysTarget));

  // Evolution of the Week progress percentage
  // Each of the 4 routine pillars has equal weight (25%).
  // Reaching the configured weekly goal of native chats awards 100% of that pillar (25% toward the total).
  const progressPercent = Math.min(
    100,
    Math.round(((videoRatio + audioRatio + nativeRatio + memoRatio) / 4) * 100)
  );

  // S Path SVG calculation
  const pathTotalLength = 220;
  const strokeDashoffset = pathTotalLength - (progressPercent / 100) * pathTotalLength;

  return (
    <div className="space-y-4" id="weekly-activity-section">
      {/* 1. Memorization Activity Card */}
      <div className="bg-gradient-to-br from-[#000035] via-[#062863] to-[#1C4C96] text-white rounded-3xl p-5 sm:p-6 border border-[#1C4C96] shadow-md space-y-5">
        {/* Banner Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#607EC9]/40 pb-4">
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-2xl bg-[#1C4C96] text-white flex items-center justify-center shrink-0 border border-[#9AB4FF]/50 shadow-xs">
              <BookOpen className="w-5 h-5 text-[#9AB4FF]" />
            </div>
            <div>
              <h3 className="text-sm sm:text-base font-black text-white tracking-tight">
                {isEn ? 'Memorization Activity' : 'Atividade de Memorização'}
              </h3>
            </div>
          </div>

          {/* Right Action Buttons */}
          <div className="flex items-center gap-2.5 shrink-0 self-start sm:self-auto flex-wrap">
            <button
              type="button"
              onClick={onOpenDictionaryModal}
              className="px-3.5 py-2.5 bg-[#000035]/80 hover:bg-[#000035] text-white rounded-2xl font-bold text-xs transition flex items-center gap-2 cursor-pointer shadow-md border border-[#9AB4FF]/40 hover:border-[#F4CA54]"
            >
              <BookMarked className="w-4 h-4 text-[#F4CA54]" />
              <span>{isEn ? 'My Dictionary' : 'Meu Dicionário'}</span>
              <span className="text-[10px] font-bold px-1.5 py-0.2 rounded-full bg-[#F4CA54] text-[#000035]">
                {totalWords}
              </span>
            </button>

            {onOpenJournalModal && (
              <button
                type="button"
                onClick={onOpenJournalModal}
                className="px-3.5 py-2.5 bg-[#000035]/80 hover:bg-[#000035] text-white rounded-2xl font-bold text-xs transition flex items-center gap-2 cursor-pointer shadow-md border border-[#9AB4FF]/40 hover:border-[#9AB4FF]"
                title={isEn ? 'View saved sentences and AI corrections' : 'Ver frases salvas e correções pedagógicas da IA'}
              >
                <Sparkles className="w-4 h-4 text-[#9AB4FF]" />
                <span>{isEn ? 'View Journal' : 'Ver Diário'}</span>
                {journalEntriesCount > 0 && (
                  <span className="text-[10px] font-bold px-1.5 py-0.2 rounded-full bg-[#9AB4FF] text-[#000035]">
                    {journalEntriesCount}
                  </span>
                )}
              </button>
            )}

            <button
              type="button"
              onClick={() => onOpenHomeworkModal(todayDay)}
              className="px-4 py-2.5 bg-[#607EC9] hover:bg-[#1C4C96] text-white rounded-2xl font-black text-xs transition flex items-center gap-2 cursor-pointer shadow-lg border border-[#9AB4FF]/60 active:scale-98"
            >
              <BookOpen className="w-4 h-4 text-white" />
              <span>
                {isEn
                  ? `Open Part ${todayMemorizationSchedule.partNumber}: ${todayMemorizationSchedule.partTitleEn.split(':')[1]?.trim() || todayMemorizationSchedule.partTitleEn} →`
                  : `Abrir Parte ${todayMemorizationSchedule.partNumber}: ${todayMemorizationSchedule.partTitlePt.split(':')[1]?.trim() || todayMemorizationSchedule.partTitlePt} →`}
              </span>
            </button>
          </div>
        </div>

        {/* 4 Metric / Feature Boxes */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
          {/* Metric 1: Learned Words */}
          <div className="p-3.5 bg-[#000035]/60 rounded-2xl border border-[#607EC9]/40 flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#1C4C96]/60 flex items-center justify-center text-[#9AB4FF] shrink-0 border border-[#9AB4FF]/30">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <span className="text-[10px] text-[#9AB4FF]/75 font-bold block uppercase tracking-wider">
                {isEn ? 'Learned Words' : 'Palavras Praticadas'}
              </span>
              <div className="flex items-baseline gap-1.5 mt-0.5">
                <span className="text-lg font-black text-white font-mono">
                  {totalWords}
                </span>
                <span className="text-[10px] text-[#9AB4FF]/80">
                  {isEn ? 'in your routine' : 'na sua rotina'}
                </span>
              </div>
            </div>
          </div>

          {/* Metric 2: Practice Modules */}
          <div className="p-3.5 bg-[#000035]/60 rounded-2xl border border-[#607EC9]/40 flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#1C4C96]/60 flex items-center justify-center text-[#9AB4FF] shrink-0 border border-[#9AB4FF]/30">
              <Layers className="w-4 h-4" />
            </div>
            <div>
              <span className="text-[10px] text-[#9AB4FF]/75 font-bold block uppercase tracking-wider">
                {isEn ? 'Practice Modules' : 'Módulos Práticos'}
              </span>
              <div className="flex items-baseline gap-1.5 mt-0.5">
                <span className="text-lg font-black text-white font-mono">5</span>
                <span className="text-[10px] text-[#9AB4FF]/80">
                  {isEn ? 'interactive exercises' : 'exercícios interativos'}
                </span>
              </div>
            </div>
          </div>

          {/* Metric 3: Access My Dictionary */}
          <button
            type="button"
            onClick={onOpenDictionaryModal}
            className="p-3.5 bg-[#000035]/60 hover:bg-[#000035] rounded-2xl border border-[#607EC9]/40 hover:border-[#9AB4FF] transition flex items-center justify-between gap-3 text-left cursor-pointer group"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-[#1C4C96]/60 flex items-center justify-center text-[#F4CA54] shrink-0 border border-[#9AB4FF]/30">
                <BookMarked className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <span className="text-[10px] text-[#9AB4FF]/75 font-bold block uppercase tracking-wider">
                  {isEn ? 'My Dictionary' : 'Meu Dicionário'}
                </span>
                <p className="text-[10px] text-white font-semibold truncate mt-0.5">
                  {isEn ? 'Definitions & audio' : 'Definições e áudio'}
                </p>
              </div>
            </div>
            <ArrowRight className="w-4 h-4 text-[#9AB4FF] group-hover:translate-x-1 transition shrink-0" />
          </button>

          {/* Metric 4: Saved Sentences / Journal */}
          <button
            type="button"
            onClick={onOpenJournalModal}
            className="p-3.5 bg-[#000035]/60 hover:bg-[#000035] rounded-2xl border border-[#607EC9]/40 hover:border-[#9AB4FF] transition flex items-center justify-between gap-3 text-left cursor-pointer group"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-[#1C4C96]/60 flex items-center justify-center text-[#9AB4FF] shrink-0 border border-[#9AB4FF]/30">
                <BookOpen className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <span className="text-[10px] text-[#9AB4FF]/75 font-bold block uppercase tracking-wider">
                  {isEn ? 'Saved Sentences' : 'Frases Salvas'}
                </span>
                <p className="text-[10px] text-white font-semibold truncate mt-0.5">
                  {isEn ? 'Daily journal & AI polish' : 'Diário & correções da IA'}
                </p>
              </div>
            </div>
            <ArrowRight className="w-4 h-4 text-[#9AB4FF] group-hover:translate-x-1 transition shrink-0" />
          </button>
        </div>
      </div>

      {/* 3. Bottom Card: 2-Column S-Fluency Path & 7-Day Checklist Grid */}
      <div className="bg-gradient-to-br from-[#000035] via-[#062863] to-[#1C4C96] text-white rounded-3xl p-5 sm:p-6 border border-[#1C4C96] shadow-md space-y-5">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* Left Column: S-Curve Vector & Weekly Progress */}
          <div className="lg:col-span-4 bg-[#000035]/70 rounded-2xl p-4 border border-[#607EC9]/40 flex flex-col justify-between space-y-4">
            {/* Badges & Heading */}
            <div className="space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] font-extrabold px-2.5 py-0.5 bg-[#1C4C96] text-[#9AB4FF] rounded-full uppercase border border-[#9AB4FF]/40">
                  {isEn ? 'Your Path to Fluency' : 'Seu Caminho para a Fluência'}
                </span>
                <span className="text-[9px] font-bold px-2 py-0.5 bg-[#000035] text-[#F4CA54] rounded-full border border-[#F4CA54]/40 uppercase">
                  {isEn ? 'Weekly Tracker' : 'Acompanhamento Semanal'}
                </span>
              </div>

              <div className="pt-2 flex items-baseline gap-2">
                <span className="text-2xl font-black text-[#F4CA54] font-mono">
                  {progressPercent}%
                </span>
                <span className="text-xs font-bold text-white uppercase tracking-wider">
                  {isEn ? 'Evolution of the Week' : 'Evolução da Semana'}
                </span>
              </div>

              <p className="text-[11px] text-[#9AB4FF]/85 leading-snug">
                {isEn
                  ? 'With each routine completed in your week, the path illuminates towards natural fluency.'
                  : 'A cada rotina realizada na sua semana, o caminho do S se ilumina até a fluência natural.'}
              </p>
            </div>

            {/* The Animated S-Curve Vector */}
            <div className="relative w-full aspect-square max-w-[200px] mx-auto flex items-center justify-center py-2">
              <svg
                viewBox="0 0 100 100"
                className="w-full h-full drop-shadow-md"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <defs>
                  <linearGradient id="sTrackBgWeekly" x1="15" y1="85" x2="85" y2="15" gradientUnits="userSpaceOnUse">
                    <stop offset="0%" stopColor="#1C4C96" stopOpacity="0.4" />
                    <stop offset="100%" stopColor="#607EC9" stopOpacity="0.3" />
                  </linearGradient>

                  <linearGradient id="sTrackActiveWeekly" x1="15" y1="85" x2="85" y2="15" gradientUnits="userSpaceOnUse">
                    <stop offset="0%" stopColor="#9AB4FF" />
                    <stop offset="50%" stopColor="#607EC9" />
                    <stop offset="85%" stopColor="#9AB4FF" />
                    <stop offset="100%" stopColor="#F4CA54" />
                  </linearGradient>

                  <radialGradient id="fluencyGlowWeekly" cx="80" cy="20" r="16" gradientUnits="userSpaceOnUse">
                    <stop offset="0%" stopColor="#FFFBEB" />
                    <stop offset="45%" stopColor="#F4CA54" />
                    <stop offset="100%" stopColor="#F4CA54" stopOpacity="0" />
                  </radialGradient>
                </defs>

                {/* Orbit / Horizon lines */}
                <ellipse
                  cx="50"
                  cy="50"
                  rx="42"
                  ry="25"
                  transform="rotate(-25 50 50)"
                  stroke="#607EC9"
                  strokeOpacity="0.35"
                  strokeWidth="2"
                  strokeDasharray="4 4"
                />
                <ellipse
                  cx="50"
                  cy="50"
                  rx="26"
                  ry="42"
                  transform="rotate(-25 50 50)"
                  stroke="#607EC9"
                  strokeOpacity="0.25"
                  strokeWidth="1.5"
                  strokeDasharray="3 3"
                />

                {/* Inactive S Path background (empty track) */}
                <path
                  d="M 24 78 C 36 86, 68 84, 68 66 C 68 52, 32 48, 32 34 C 32 18, 62 14, 76 22"
                  stroke="url(#sTrackBgWeekly)"
                  strokeWidth="10"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />

                {/* Active S Path illuminated progress */}
                <path
                  d="M 24 78 C 36 86, 68 84, 68 66 C 68 52, 32 48, 32 34 C 32 18, 62 14, 76 22"
                  stroke="url(#sTrackActiveWeekly)"
                  strokeWidth="10"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeDasharray={pathTotalLength}
                  strokeDashoffset={strokeDashoffset}
                  className="transition-all duration-700 ease-out"
                />

                {/* Inner dashed road line */}
                <path
                  d="M 26 78 C 36 85, 66 83, 66 66 C 66 53, 34 47, 34 34 C 34 20, 60 16, 74 22"
                  stroke="#000035"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeDasharray="4 4"
                />

                {/* Milestone Checkpoint Dots along the S curve */}
                <circle cx="24" cy="78" r="4" fill={progressPercent >= 20 ? '#9AB4FF' : '#1C4C96'} stroke="#000035" strokeWidth="1.5" />
                <circle cx="66" cy="66" r="4" fill={progressPercent >= 45 ? '#9AB4FF' : '#1C4C96'} stroke="#000035" strokeWidth="1.5" />
                <circle cx="32" cy="34" r="4" fill={progressPercent >= 70 ? '#9AB4FF' : '#1C4C96'} stroke="#000035" strokeWidth="1.5" />
                <circle cx="76" cy="22" r="4" fill={progressPercent >= 100 ? '#F4CA54' : '#1C4C96'} stroke="#000035" strokeWidth="1.5" />

                {/* Fluency Beacon Star at top right */}
                <circle cx="80" cy="20" r="10" fill="url(#fluencyGlowWeekly)" />
                <circle cx="80" cy="20" r="5" fill={progressPercent === 100 ? '#FFFBEB' : '#F4CA54'} />
                <path
                  d="M80 8 L80 13 M80 27 L80 32 M68 20 L73 20 M87 20 L92 20"
                  stroke="#F4CA54"
                  strokeWidth="2"
                  strokeLinecap="round"
                  className={progressPercent === 100 ? 'animate-spin origin-[80px_20px]' : ''}
                />
              </svg>

              {/* S Symbol Floating Badge */}
              <div className="absolute -bottom-1 -right-1 px-1.5 py-0.5 bg-[#000035] border border-[#F4CA54] rounded-lg text-[9px] font-black text-[#F4CA54] shadow-md flex items-center gap-1">
                <span>S</span>
                <span className="text-[8px] text-[#9AB4FF]">PATH</span>
              </div>
            </div>

            {/* Bottom Progress details */}
            <div className="space-y-1.5 pt-2 border-t border-[#607EC9]/30">
              <div className="flex items-center justify-between text-[10px] font-bold">
                <span className="text-white uppercase">
                  {isEn ? 'Path Traveled This Week:' : 'Caminho Percorrido na Semana:'}
                </span>
                <span className="text-[#F4CA54] font-mono">{progressPercent}%</span>
              </div>

              <div className="w-full bg-[#000035] rounded-full h-2 overflow-hidden border border-[#607EC9]/40">
                <div
                  className="bg-gradient-to-r from-[#9AB4FF] via-[#607EC9] to-[#F4CA54] h-full transition-all duration-500 rounded-full"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>

              <p className="text-[10px] text-[#9AB4FF]/80 italic text-center pt-1">
                {isEn
                  ? 'Mark your daily activities to track your evolution along the S path to fluency.'
                  : 'Marque suas atividades diárias para acompanhar sua evolução no caminho do S até a fluência natural.'}
              </p>
            </div>
          </div>

          {/* Right Column: Interactive 7-Day Routine Checklist Table */}
          <div className="lg:col-span-8 bg-[#000035]/70 rounded-2xl p-4 border border-[#607EC9]/40 space-y-3">
            {/* Header with Title & Day Columns */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[#607EC9]/40 pb-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-bold text-white">
                  {isEn
                    ? 'Mark your completed activities for each day of the week:'
                    : 'Acompanhe e marque suas atividades realizadas na semana:'}
                </span>
                <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-[#1C4C96] text-[#F4CA54] border border-[#F4CA54]/40 uppercase">
                  {activeWeekCycle !== null
                    ? (isEn ? `Week ${activeWeekCycle}` : `Semana ${activeWeekCycle}`)
                    : (isEn ? 'Week ...' : 'Semana ...')}
                </span>
                <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-[#062863] text-[#9AB4FF] border border-[#9AB4FF]/30 flex items-center gap-1 shadow-xs">
                  <Target className="w-3 h-3 text-[#9AB4FF]" />
                  <span>{isEn ? `Goal: ${weeklyStudyDaysTarget} days/week` : `Meta: ${weeklyStudyDaysTarget} dias/semana`}</span>
                </span>
              </div>

              {/* 7 Days Header Pill with Today focus & Study Plan Highlights */}
              <div className="grid grid-cols-7 gap-1 bg-[#062863] px-2 py-1 rounded-xl border border-[#1C4C96] text-center">
                {WEEK_DAYS.map((d) => {
                  const isToday = d.key === todayDay;
                  const isDayInPlan = activeStudyDays.includes(d.key);
                  return (
                    <span
                      key={d.key}
                      className={`text-[9px] font-mono font-black uppercase w-6 flex flex-col items-center ${
                        !isDayInPlan
                          ? 'opacity-30 text-slate-400'
                          : isToday
                          ? 'text-[#F4CA54]'
                          : 'text-[#9AB4FF]'
                      }`}
                      title={
                        isToday
                          ? isEn ? "Today's Focus" : 'Foco de Hoje'
                          : !isDayInPlan
                          ? isEn ? 'Rest Day' : 'Dia de Descanso'
                          : undefined
                      }
                    >
                      <span>{d.label}</span>
                      {isToday && <span className="w-1 h-1 rounded-full bg-[#F4CA54] mt-0.5" />}
                    </span>
                  );
                })}
              </div>
            </div>

            {/* 4 Routine Rows */}
            <div className="space-y-2">
              {ROUTINE_ROWS.map((row) => {
                const Icon = row.icon;
                return (
                  <div
                    key={row.id}
                    className="p-2.5 sm:p-3 bg-[#062863]/60 rounded-xl border border-[#1C4C96]/60 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
                  >
                    {/* Step Info */}
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-8 h-8 rounded-lg bg-[#000035] text-[#9AB4FF] flex items-center justify-center shrink-0 border border-[#9AB4FF]/30 shadow-xs">
                        <Icon className="w-4 h-4" />
                      </div>
                      <div className="min-w-0 flex items-center gap-2 flex-wrap">
                        {(() => {
                          const displayTime =
                            row.id === 'video_day'
                              ? userProfile?.routineVideoTime || row.time
                              : row.id === 'audio_day'
                              ? userProfile?.routineAudioTime || row.time
                              : row.time;
                          return (
                            <span className="text-[11px] font-mono font-bold text-[#9AB4FF] px-1.5 py-0.5 rounded bg-[#000035]/70 border border-[#9AB4FF]/20 shrink-0">
                              {displayTime}
                            </span>
                          );
                        })()}
                        <h4 className="text-xs sm:text-sm font-black text-white truncate">
                          {isEn ? row.titleEn : row.titlePt}
                        </h4>
                        {row.id === 'tutor_live' ? (
                          <div className="inline-flex items-center gap-1.5 flex-wrap">
                            <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-[#000035]/80 border border-[#9AB4FF]/30 text-[10px] text-[#9AB4FF] shadow-xs">
                              <span className="text-[#9AB4FF]/70 text-[9px] font-semibold uppercase">{isEn ? 'Goal:' : 'Meta:'}</span>
                              <select
                                value={weeklyNativeTarget}
                                onChange={(e) => handleTargetChange(Number(e.target.value))}
                                className="bg-transparent text-[#F4CA54] font-black cursor-pointer focus:outline-hidden text-[10px]"
                                title={isEn ? 'Weekly native chat frequency goal' : 'Frequência de aulas semanais com o nativo'}
                              >
                                <option value={1} className="bg-[#000035] text-white">1x {isEn ? '/ week' : '/ semana'}</option>
                                <option value={2} className="bg-[#000035] text-white">2x {isEn ? '/ week' : '/ semana'}</option>
                                <option value={3} className="bg-[#000035] text-white">3x {isEn ? '/ week' : '/ semana'}</option>
                                <option value={4} className="bg-[#000035] text-white">4x {isEn ? '/ week' : '/ semana'}</option>
                                <option value={5} className="bg-[#000035] text-white">5x {isEn ? '/ week' : '/ semana'}</option>
                                <option value={7} className="bg-[#000035] text-white">7x {isEn ? '/ week' : '/ semana'}</option>
                              </select>
                            </div>
                            {(checkedCounts.tutor_live || 0) >= weeklyNativeTarget ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-400/40 text-emerald-300 text-[9px] font-extrabold uppercase tracking-wide">
                                <CheckCircle2 className="w-2.5 h-2.5 text-emerald-400" />
                                <span>{isEn ? 'Goal met' : 'Meta atingida'} ({(checkedCounts.tutor_live || 0)}/{weeklyNativeTarget})</span>
                              </span>
                            ) : (
                              <span className="text-[10px] text-[#9AB4FF]/75 font-bold">
                                ({(checkedCounts.tutor_live || 0)}/{weeklyNativeTarget} {isEn ? 'completed' : 'concluída' + (weeklyNativeTarget > 1 ? 's' : '')})
                              </span>
                            )}
                          </div>
                        ) : row.id === 'memorization' ? (
                          <div className="inline-flex items-center gap-1.5 flex-wrap">
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#F4CA54]/20 border border-[#F4CA54]/40 text-[#F4CA54] text-[9px] font-extrabold uppercase tracking-wide">
                              ⭐ {isEn ? `Today: Part ${todayMemorizationSchedule.partNumber}` : `Hoje: Parte ${todayMemorizationSchedule.partNumber}`}
                            </span>
                            {(checkedCounts[row.id] || 0) >= weeklyStudyDaysTarget ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-400/40 text-emerald-300 text-[9px] font-extrabold uppercase tracking-wide">
                                <CheckCircle2 className="w-2.5 h-2.5 text-emerald-400" />
                                <span>{isEn ? 'Goal met' : 'Meta atingida'} ({(checkedCounts[row.id] || 0)}/{weeklyStudyDaysTarget})</span>
                              </span>
                            ) : (
                              <span className="text-[10px] text-[#9AB4FF]/75 font-bold">
                                ({(checkedCounts[row.id] || 0)}/{weeklyStudyDaysTarget} {isEn ? (weeklyStudyDaysTarget === 1 ? 'day' : 'days') : (weeklyStudyDaysTarget === 1 ? 'dia' : 'dias')})
                              </span>
                            )}
                          </div>
                        ) : (
                          <div className="inline-flex items-center gap-1.5 flex-wrap">
                            {(checkedCounts[row.id] || 0) >= weeklyStudyDaysTarget ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-400/40 text-emerald-300 text-[9px] font-extrabold uppercase tracking-wide">
                                <CheckCircle2 className="w-2.5 h-2.5 text-emerald-400" />
                                <span>{isEn ? 'Goal met' : 'Meta atingida'} ({(checkedCounts[row.id] || 0)}/{weeklyStudyDaysTarget})</span>
                              </span>
                            ) : (
                              <span className="text-[10px] text-[#9AB4FF]/75 font-bold">
                                ({(checkedCounts[row.id] || 0)}/{weeklyStudyDaysTarget} {isEn ? (weeklyStudyDaysTarget === 1 ? 'day' : 'days') : (weeklyStudyDaysTarget === 1 ? 'dia' : 'dias')})
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* 7 Interactive Day Check Circles */}
                    <div className="grid grid-cols-7 gap-1 shrink-0 self-end sm:self-auto">
                      {WEEK_DAYS.map((d) => {
                        const isDayInPlan = activeStudyDays.includes(d.key);
                        const isInteractive = row.id === 'tutor_live' || isDayInPlan;
                        const isChecked = isActivityCompleted(row.id, d.key);
                        const memPart = row.id === 'memorization'
                          ? getDailyMemorizationSchedule(d.key, activeStudyDays, activeWeekCycle ?? 1)
                          : null;

                        if (!isInteractive) {
                          return (
                            <div
                              key={d.key}
                              className="w-6 h-6 rounded-full flex items-center justify-center opacity-25 cursor-not-allowed select-none"
                              title={
                                isEn
                                  ? `Day not in study plan (${d.label})`
                                  : `Dia fora do plano de estudos (${d.label})`
                              }
                            >
                              <div className="w-4 h-4 rounded-full border border-[#607EC9]/40 bg-[#000035]/20" />
                            </div>
                          );
                        }

                        if (row.id === 'video_day' || row.id === 'audio_day') {
                          return (
                            <div
                              key={d.key}
                              className="w-6 h-6 rounded-full flex items-center justify-center select-none"
                              title={
                                isChecked
                                  ? (isEn
                                      ? `${row.titleEn} (${d.label}) • Completed`
                                      : `${row.titlePt} (${d.label}) • Concluído`)
                                  : (isEn
                                      ? `${row.titleEn} (${d.label}) • Completed automatically upon watching/listening`
                                      : `${row.titlePt} (${d.label}) • Concluído automaticamente ao praticar`)
                              }
                            >
                              {isChecked ? (
                                <div className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center border border-emerald-400/80 shadow-xs">
                                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                                </div>
                              ) : (
                                <div className="w-5 h-5 rounded-full border-2 border-[#607EC9]/30 bg-[#000035]/30" />
                              )}
                            </div>
                          );
                        }

                        return (
                          <button
                            key={d.key}
                            type="button"
                            onClick={() => {
                              if (row.id === 'memorization') {
                                onOpenHomeworkModal(d.key);
                              } else if (row.id === 'tutor_live') {
                                toggleCheck(row.id, d.key);
                              }
                            }}
                            className="w-6 h-6 rounded-full flex items-center justify-center cursor-pointer transition active:scale-95"
                            title={
                              memPart
                                ? `${d.label}: Parte ${memPart.partNumber} (${isEn ? memPart.partTitleEn.split(':')[1]?.trim() : memPart.partTitlePt.split(':')[1]?.trim()})`
                                : `${isEn ? row.titleEn : row.titlePt} (${d.label})`
                            }
                          >
                            {isChecked ? (
                              <div className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center border border-emerald-400/80 shadow-xs">
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                              </div>
                            ) : memPart ? (
                              <div className="w-5 h-5 rounded-full border-2 border-[#607EC9]/50 hover:border-[#9AB4FF] transition bg-[#000035]/40 flex items-center justify-center text-[8px] font-bold text-[#9AB4FF]/80">
                                P{memPart.partNumber}
                              </div>
                            ) : (
                              <div className="w-5 h-5 rounded-full border-2 border-[#607EC9]/50 hover:border-[#9AB4FF] transition bg-[#000035]/40" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
