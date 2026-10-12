import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Sparkles,
  Calendar,
  Clock,
  Plus,
  Edit3,
  Trash2,
  CheckCircle2,
  Volume2,
  Save,
  Check,
  Headphones,
  ExternalLink,
  BookOpen,
  PenTool,
  Wand2,
  AlertTriangle,
  Play,
  Youtube,
  Radio,
  Music,
  X,
  ChevronDown,
  Layers,
  Video,
  RotateCcw,
  Star,
  RefreshCw,
  Target,
  Loader2,
} from 'lucide-react';
import { StartNewWeekModal } from './StartNewWeekModal';
import { StudentSpotifyCard } from './StudentSpotifyCard';
import { StudentKeyWordsCard } from './StudentKeyWordsCard';
import { StudentDailySentenceCard } from './StudentDailySentenceCard';
import {
  DayOfWeek,
  Language,
  RoutineItem,
  UserProfile,
  WritingEvaluationResult,
  TeacherAssignedVideo,
  TeacherAssignedSpotify,
  StudentJournalEntry,
} from '../types';
import { Translations, getActivityDisplayName } from '../utils/i18n';
import { extractYouTubeVideoId, getYouTubeEmbedUrl, getDailyYouTubeVideoForStudent, getYouTubePlaylistForLevel } from '../utils/youtube';
import {
  getSpotifyEmbedUrl,
  getSpotifyDirectUrl,
  normalizeStudentLevel,
  getSpotifyPlaylistForLevel,
  getDailySpotifyTrackForStudent,
  selectCurrentDaySpotifyTrack,
  DAYS_SEQUENCE,
  isValidSpotifyUrl,
  checkAndInvalidateSpotifyCache,
  fetchTracksForStudentLevel,
  getCachedPlaylistTracks,
  SpotifyDailyTrack,
} from '../utils/spotify';
import { useStudentSpotifySync } from '../hooks/useStudentSpotifySync';
import { useRoutine } from '../hooks/useRoutine';
import { useBehavioralVideoTracker, useBehavioralAudioTracker } from '../hooks/useBehavioralMediaTracker';
import { CurrentSpotifyTrack } from '../utils/routineSync';
import { speakText } from '../utils/audio';
import { checkDailySentenceAi } from '../utils/writingChecker';
import { getInstantOrCachedWord, lookupWord, DictionaryLookupResult } from '../utils/dictionaryService';
import {
  DAYS_OF_WEEK,
  getDayLabel,
  getDayShortLabel,
  getLastActivityOfTheDay,
  getEndOfDayReminderTime,
  getTodayDayOfWeek,
} from '../utils/notifications';
import {
  fetchDynamicYouTubePlaylists,
  authenticateYouTubeAccount,
  YouTubePlaylistItem,
  YOUTUBE_ASSOCIATED_ACCOUNT,
  DEFAULT_CURATED_PLAYLISTS,
} from '../utils/youtubeService';

interface StudentRoutineGuideSectionProps {
  routinesByDay: Record<DayOfWeek, RoutineItem[]>;
  selectedDay: DayOfWeek;
  onSelectDay: (day: DayOfWeek) => void;
  selectedActivityId: string | null;
  onSelectActivity: (id: string) => void;
  onToggleActivityComplete: (id: string) => void;
  onAddCustomActivity?: (item: Omit<RoutineItem, 'id'>) => void;
  onEditActivity?: (item: RoutineItem) => void;
  onDeleteActivity?: (id: string) => void;
  onUpdateTimeActivity?: (activityId: string, newTime: string) => void;
  onSaveLearnedWords: (activityId: string, words: string[]) => void;
  userProfile: UserProfile;
  onSaveDailySentence: (sentence: string, wordsUsed: string[], evaluationResult?: WritingEvaluationResult | null) => void;
  onOpenJournalModal?: () => void;
  onOpenEmailModal?: () => void;
  onTest30MinReminder?: () => void;
  currentLanguage: Language;
  t: Translations;
  onAssignVideoToActivity?: (activityId: string, video: TeacherAssignedVideo, day: DayOfWeek) => void;
  onStartNewWeek?: (studyDaysTarget?: number, selectedDays?: DayOfWeek[]) => Promise<boolean | void> | void;
  weeklyCycle?: number;
  isStarting?: boolean;
  weeklyChecks?: Record<string, boolean>;
  studentJournal?: StudentJournalEntry[];
  onUpdateSPathCheck?: (
    stepId: 'video_day' | 'audio_day' | 'memorization' | 'tutor_live',
    dayKey: DayOfWeek,
    isCompleted?: boolean
  ) => void;
  onBehavioralComplete?: (params: {
    type: 'video' | 'audio';
    dayOfWeek: DayOfWeek;
    activityId?: string;
    video?: {
      videoId: string;
      videoTitle?: string;
      url?: string;
      duration?: string;
    };
    track?: {
      id: string;
      trackId?: string;
      title: string;
      artist?: string;
      coverUrl?: string;
      url?: string;
    };
  }) => void;
}

export const StudentRoutineGuideSection: React.FC<StudentRoutineGuideSectionProps> = ({
  routinesByDay,
  selectedDay,
  onSelectDay,
  selectedActivityId,
  onSelectActivity,
  onToggleActivityComplete,
  onAddCustomActivity,
  onEditActivity,
  onDeleteActivity,
  onUpdateTimeActivity,
  onSaveLearnedWords,
  userProfile,
  onSaveDailySentence,
  onOpenJournalModal,
  onOpenEmailModal,
  onTest30MinReminder,
  currentLanguage,
  t,
  onAssignVideoToActivity,
  onStartNewWeek,
  weeklyCycle = 1,
  isStarting = false,
  weeklyChecks,
  studentJournal,
  onUpdateSPathCheck,
  onBehavioralComplete,
}) => {
  const isEn = currentLanguage === 'en';
  const todayDay = getTodayDayOfWeek();
  const [isNewWeekModalOpen, setIsNewWeekModalOpen] = useState(false);
  const [isStartingNewWeek, setIsStartingNewWeek] = useState(false);

  // Playlists from active admin YouTube channel (adm.itissimple@gmail.com)
  const [playlists, setPlaylists] = useState<YouTubePlaylistItem[]>(DEFAULT_CURATED_PLAYLISTS);
  const [isLoadingPlaylists, setIsLoadingPlaylists] = useState(false);
  const [isSyncingPlaylists, setIsSyncingPlaylists] = useState(false);
  const [playlistsError, setPlaylistsError] = useState<string | null>(null);
  const [reauthRequired, setReauthRequired] = useState(false);
  const [isReauthenticating, setIsReauthenticating] = useState(false);

  // Alphabetically sorted playlists for topic selector (preserving Your Suggestion as the first item)
  const sortedPlaylists = useMemo(() => {
    return [...playlists].sort((a, b) =>
      (a.title || '').localeCompare(b.title || '', undefined, { sensitivity: 'base' })
    );
  }, [playlists]);
  const [loadingPlaylistAssignId, setLoadingPlaylistAssignId] = useState<string | null>(null);
  const [playlistFeedback, setPlaylistFeedback] = useState<{
    activityId: string;
    message: string;
    type: 'success' | 'warning' | 'error' | 'info';
  } | null>(null);

  // Custom YouTube video suggestion states
  const [customSuggestionActivities, setCustomSuggestionActivities] = useState<Record<string, boolean>>({});
  const [suggestingUrlActivityId, setSuggestingUrlActivityId] = useState<string | null>(null);
  const [suggestingUrlValues, setSuggestingUrlValues] = useState<Record<string, string>>({});
  const [isSavingSuggestionId, setIsSavingSuggestionId] = useState<string | null>(null);

  // Fetch active playlists dynamically from server or YouTube Data API v3
  const loadPlaylists = useCallback(async (force = false) => {
    if (force) {
      setIsSyncingPlaylists(true);
    } else {
      setIsLoadingPlaylists(true);
    }
    setPlaylistsError(null);

    try {
      const result = await fetchDynamicYouTubePlaylists({ force });
      if (result.playlists && result.playlists.length > 0) {
        setPlaylists(result.playlists);
      }
      if (result.reauthRequired) {
        setReauthRequired(true);
        if (result.error) setPlaylistsError(result.error);
      } else {
        setReauthRequired(false);
        setPlaylistsError(null);
      }
    } catch (err: any) {
      console.warn('Error fetching playlists for timeline selector:', err);
      setPlaylistsError(
        err?.message || (isEn ? 'Failed to fetch YouTube playlists' : 'Erro ao sincronizar playlists do YouTube')
      );
    } finally {
      setIsLoadingPlaylists(false);
      setIsSyncingPlaylists(false);
    }
  }, [isEn]);

  useEffect(() => {
    loadPlaylists(false);
  }, [loadPlaylists]);

  const handleReauthenticateYouTube = async () => {
    setIsReauthenticating(true);
    setPlaylistsError(null);
    try {
      await authenticateYouTubeAccount(YOUTUBE_ASSOCIATED_ACCOUNT);
      await loadPlaylists(true);
      setPlaylistFeedback({
        activityId: selectedActivityId || '',
        type: 'success',
        message: isEn
          ? '✨ YouTube account connected and playlists updated!'
          : '✨ Conta do YouTube conectada e playlists atualizadas!',
      });
      setTimeout(() => setPlaylistFeedback(null), 4000);
    } catch (err: any) {
      console.warn('Failed to reauthenticate YouTube:', err);
      setPlaylistsError(
        isEn
          ? 'Could not connect YouTube account. Please allow popup access.'
          : 'Não foi possível conectar a conta do YouTube. Permita a janela pop-up.'
      );
    } finally {
      setIsReauthenticating(false);
    }
  };

  // Inline time editing state for individual activity row
  const [editingTimeActivityId, setEditingTimeActivityId] = useState<string | null>(null);
  const [editingTimeValue, setEditingTimeValue] = useState<string>('');

  // Filter out any legacy audio activity from the timeline to keep the interface focused and simplified
  const isOldAudioActivity = (act: RoutineItem) => {
    const id = String(act?.id || '');
    const name = (act?.activityName || '').toLowerCase();
    return (
      id.endsWith('2') ||
      name.includes('escuta ativa') ||
      name.includes('podcast diário') ||
      name.includes('podcast diario') ||
      name.includes('(áudio)') ||
      name.includes('(audio)')
    );
  };

  const currentDayList = routinesByDay[selectedDay] || [];
  const sortedActivities = [...currentDayList]
    .filter((act) => !isOldAudioActivity(act))
    .sort((a, b) => a.time.localeCompare(b.time));

  // Current active activity (guaranteed not to be an old audio activity)
  const activeActivity =
    sortedActivities.find((a) => a.id === selectedActivityId) || sortedActivities[0] || null;

  // 5 Words State
  const [words, setWords] = useState<string[]>(['', '', '', '', '']);
  const [wordsSaveFeedback, setWordsSaveFeedback] = useState<boolean>(false);
  const [wordDefinitions, setWordDefinitions] = useState<Record<number, DictionaryLookupResult>>({});

  // Synchronize 5 words when active activity changes or learnedWords are loaded
  useEffect(() => {
    if (activeActivity && activeActivity.learnedWords && activeActivity.learnedWords.length > 0) {
      const padded = [...activeActivity.learnedWords];
      while (padded.length < 5) padded.push('');
      setWords(padded.slice(0, 5));
    } else {
      setWords(['', '', '', '', '']);
    }
    setWordsSaveFeedback(false);
  }, [activeActivity?.id, activeActivity?.learnedWords?.join(',')]);

  // Keep English definitions synchronized using Native Friend Notes unified pedagogical standard
  useEffect(() => {
    const studentLevel = userProfile?.level;
    const initialDefs: Record<number, DictionaryLookupResult> = {};
    words.forEach((w, idx) => {
      const clean = w.trim();
      if (clean) {
        initialDefs[idx] = getInstantOrCachedWord(clean, undefined, studentLevel);
      }
    });
    setWordDefinitions(initialDefs);

    // Reduced delay: 200ms debounce with selective lookup for terms needing AI enrichment
    const timer = setTimeout(() => {
      const wordsToLookup = words
        .map((w, idx) => ({ word: w.trim(), idx }))
        .filter(({ word, idx }) => word.length >= 2 && (!initialDefs[idx] || !initialDefs[idx].definitionEn));

      if (wordsToLookup.length === 0) return;

      wordsToLookup.forEach(async ({ word, idx }) => {
        try {
          const res = await lookupWord(word, undefined, studentLevel);
          if (res) {
            setWordDefinitions((prev) => {
              if (words[idx]?.trim().toLowerCase() === word.toLowerCase()) {
                return { ...prev, [idx]: res };
              }
              return prev;
            });
          }
        } catch {
          // Handled gracefully
        }
      });
    }, 200);

    return () => clearTimeout(timer);
  }, [words, userProfile?.level]);

  // Spotify view toggle: App Player or Spotify Web, and Track vs Full Playlist view
  const [spotifyPlayerMode, setSpotifyPlayerMode] = useState<'app' | 'web'>('app');
  const [spotifyEmbedView, setSpotifyEmbedView] = useState<'track' | 'playlist'>('track');

  // Sentence of the day State
  const [sentenceInput, setSentenceInput] = useState<string>('');
  const [sentenceSavedSuccess, setSentenceSavedSuccess] = useState<boolean>(false);
  const [sentenceEvaluation, setSentenceEvaluation] = useState<WritingEvaluationResult | null>(null);
  const [isCheckingSentence, setIsCheckingSentence] = useState<boolean>(false);
  const [savedTopicsBeforeRepeat, setSavedTopicsBeforeRepeat] = useState<Record<string, string>>({});

  // Strictly neutral initial state: topics start as "" until user voluntarily selects
  const [selectedTopicByDay, setSelectedTopicByDay] = useState<Partial<Record<DayOfWeek, string>>>({});

  const effectiveStudentUid = userProfile?.id || (userProfile as any)?.uid || userProfile?.email || '';
  const {
    routinesByDay: persistedRoutinesByDay,
    watchedHistory,
    saveVideoForDay,
    markVideoAsWatched,
    resetRepeatFlags,
    resetRoutinesForNewWeek,
    selectNextUnwatchedVideo: pickNextUnwatched,
    isLoading: isRoutineLoading,
  } = useRoutine(effectiveStudentUid, selectedDay);

  // Sync saved topic and video from Firestore so refreshing the page preserves the selection
  useEffect(() => {
    if (persistedRoutinesByDay) {
      setSelectedTopicByDay((prev) => {
        const next = { ...prev };
        let changed = false;
        Object.keys(persistedRoutinesByDay).forEach((dayKey) => {
          const d = dayKey as DayOfWeek;
          const persisted = persistedRoutinesByDay[d];
          if (persisted && (persisted.videoId || persisted.playlistId) && !next[d]) {
            next[d] = persisted.playlistId || (persisted.isRepeatVideo ? 'repeat_previous_video' : '');
            changed = true;
          } else if (persisted && persisted.videoId === '' && persisted.playlistId === '' && next[d]) {
            delete next[d];
            changed = true;
          }
        });
        return changed ? next : prev;
      });
    }
  }, [persistedRoutinesByDay]);

  // Reset day-specific ephemeral input state only when student identity actually switches
  useEffect(() => {
    setSelectedTopicByDay({});
    setCustomSuggestionActivities({});
    setSuggestingUrlValues({});
    setSavedTopicsBeforeRepeat({});
    setSentenceInput('');
    setSentenceSavedSuccess(false);
    setSentenceEvaluation(null);
  }, [effectiveStudentUid]);

  // Quick jump helpers
  const activeStudyDays: DayOfWeek[] = useMemo(() => {
    if (userProfile?.weeklyStudyDays && userProfile.weeklyStudyDays.length > 0) {
      return userProfile.weeklyStudyDays;
    }
    const target = userProfile?.weeklyStudyDaysTarget;
    if (target === 2) return ['tuesday', 'thursday'];
    if (target === 3) return ['monday', 'wednesday', 'friday'];
    if (target === 5) return ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
    if (target === 7) return DAYS_OF_WEEK;
    return DAYS_OF_WEEK;
  }, [userProfile?.weeklyStudyDays, userProfile?.weeklyStudyDaysTarget]);

  // Active study days sorted in standard calendar order
  const activeDaysInOrder: DayOfWeek[] = useMemo(() => {
    const calendarOrder: DayOfWeek[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    const filtered = calendarOrder.filter((d) => activeStudyDays.includes(d));
    return filtered.length > 0 ? filtered : calendarOrder;
  }, [activeStudyDays]);

  // Requirement 3: "Repeat Previous Video" option is available ONLY from the 2nd active study day onwards
  const canShowRepeatVideoOption = useMemo(() => {
    const currentActiveIdx = activeDaysInOrder.indexOf(selectedDay);
    return currentActiveIdx >= 1;
  }, [activeDaysInOrder, selectedDay]);

  // Ensure selectedDay is initialized to an active study day on initial load
  const hasInitializedDayRef = useRef(false);
  useEffect(() => {
    if (!hasInitializedDayRef.current && activeStudyDays && activeStudyDays.length > 0) {
      hasInitializedDayRef.current = true;
      if (!activeStudyDays.includes(selectedDay)) {
        const fallback = activeStudyDays.includes(todayDay)
          ? todayDay
          : activeStudyDays[0];
        if (fallback) {
          setTimeout(() => {
            onSelectDay(fallback);
          }, 0);
        }
      }
    }
  }, [activeStudyDays, selectedDay, todayDay, onSelectDay]);

  const handleJumpWeekdays = () => {
    const weekday = activeStudyDays.find((d) =>
      ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'].includes(d)
    );
    if (weekday) onSelectDay(weekday);
    else if (activeStudyDays[0]) onSelectDay(activeStudyDays[0]);
  };

  const handleJumpWeekends = () => {
    const weekend = activeStudyDays.find((d) => ['saturday', 'sunday'].includes(d));
    if (weekend) onSelectDay(weekend);
    else if (activeStudyDays.length > 0) onSelectDay(activeStudyDays[activeStudyDays.length - 1]);
  };

  // Calculate routine words for current day
  const allLearnedWordsToday: string[] = [];
  (sortedActivities || []).forEach((item) => {
    if (item?.learnedWords && Array.isArray(item.learnedWords)) {
      item.learnedWords.forEach((w) => {
        if (w && typeof w === 'string') {
          const trimmed = w.trim();
          if (trimmed && !allLearnedWordsToday.includes(trimmed)) {
            allLearnedWordsToday.push(trimmed);
          }
        }
      });
    }
  });

  // Today's routine words (starts empty without pre-filled words)
  const displayRoutineWords = allLearnedWordsToday;

  const formatToAmPm = (timeStr?: string): string => {
    if (!timeStr) return '';
    if (timeStr.includes('AM') || timeStr.includes('PM')) return timeStr;
    const parts = timeStr.split(':');
    if (parts.length < 2) return timeStr;
    let hours = parseInt(parts[0], 10);
    const minutes = parts[1].slice(0, 2);
    if (isNaN(hours)) return timeStr;
    const period = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    if (hours === 0) hours = 12;
    const formattedHours = hours.toString().padStart(2, '0');
    return `${formattedHours}:${minutes} ${period}`;
  };

  const matchedSentenceWords = displayRoutineWords.filter((w) =>
    Boolean(w && (sentenceInput || '').toLowerCase().includes(w.toLowerCase()))
  );

  // Handlers for 5 Words with automatic debounced background save
  const wordsDebounceRef = useRef<any>(null);
  const handleWordChange = (index: number, val: string) => {
    const updated = [...words];
    updated[index] = val;
    setWords(updated);

    if (activeActivity) {
      if (wordsDebounceRef.current) clearTimeout(wordsDebounceRef.current);
      wordsDebounceRef.current = setTimeout(() => {
        const cleanWords = updated.map((w) => w.trim()).filter((w) => w.length > 0);
        if (cleanWords.length > 0) {
          onSaveLearnedWords(activeActivity.id, cleanWords);
        }
      }, 700);
    }
  };

  const handleSaveWords = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (wordsDebounceRef.current) clearTimeout(wordsDebounceRef.current);
    if (!activeActivity) return;
    const cleanWords = words.map((w) => w.trim()).filter((w) => w.length > 0);
    onSaveLearnedWords(activeActivity.id, cleanWords);
    setWordsSaveFeedback(true);
    setTimeout(() => setWordsSaveFeedback(false), 2500);
  };

  // Handlers for Sentence of the Day (Isolated AI handler sending only sentence and daily vocabulary words)
  const handleCheckGrammar = async () => {
    const clean = sentenceInput.trim();
    if (!clean) return;
    setIsCheckingSentence(true);
    try {
      const evaluation = await checkDailySentenceAi(clean, displayRoutineWords);
      setSentenceEvaluation(evaluation);
    } catch (err) {
      console.warn('Sentence check error:', err);
    } finally {
      setIsCheckingSentence(false);
    }
  };

  const handleApplySentenceCorrection = () => {
    if (sentenceEvaluation?.correctedSentence) {
      const corrected = sentenceEvaluation.correctedSentence;
      const updatedEval: WritingEvaluationResult = {
        ...sentenceEvaluation,
        hasAnyError: false,
        isCorrect: true,
        correctedSentence: corrected,
      };
      setSentenceInput(corrected);
      setSentenceEvaluation(updatedEval);
      const finalWordsToSave =
        matchedSentenceWords.length > 0
          ? matchedSentenceWords
          : updatedEval.usedWords || displayRoutineWords;
      onSaveDailySentence(corrected, finalWordsToSave, updatedEval);
      setSentenceSavedSuccess(true);
      setTimeout(() => {
        setSentenceSavedSuccess(false);
      }, 2500);
    }
  };

  const handleSaveSentence = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const clean = sentenceInput.trim();
    if (!clean) return;

    let activeEval = sentenceEvaluation;
    if (!activeEval) {
      setIsCheckingSentence(true);
      try {
        activeEval = await checkDailySentenceAi(clean, displayRoutineWords);
        setSentenceEvaluation(activeEval);
      } catch (err) {
        console.warn('Sentence check error on save:', err);
      } finally {
        setIsCheckingSentence(false);
      }
    }

    // If the AI detected grammar, capitalization, spelling, or tense errors,
    // keep the AI Grammar Analysis & Feedback card visible so the student can review or click "Apply & Use".
    if (
      activeEval &&
      (activeEval.hasAnyError ||
        activeEval.isCorrect === false ||
        (activeEval.correctedSentence &&
          activeEval.correctedSentence.trim().replace(/[.!?]+$/, '') !==
            clean.replace(/[.!?]+$/, '')))
    ) {
      return;
    }

    const finalWordsToSave = matchedSentenceWords.length > 0 ? matchedSentenceWords : (activeEval?.usedWords || displayRoutineWords);
    onSaveDailySentence(clean, finalWordsToSave, activeEval);
    setSentenceSavedSuccess(true);
    setTimeout(() => {
      setSentenceSavedSuccess(false);
    }, 2500);
  };

  // Automated level-based Spotify & YouTube curriculum sequential distribution
  const normalizedLevel = normalizeStudentLevel(userProfile?.level);
  const levelPlaylistConfig = getSpotifyPlaylistForLevel(normalizedLevel);
  const [liveSpotifyTracks, setLiveSpotifyTracks] = useState<SpotifyDailyTrack[] | null>(() => {
    return getCachedPlaylistTracks(normalizedLevel);
  });
  const [isLoadingSpotify, setIsLoadingSpotify] = useState<boolean>(false);

  // Dynamic Spotify track fetch and cache validation when student level is active
  useEffect(() => {
    checkAndInvalidateSpotifyCache();
    setIsLoadingSpotify(true);
    // Triggers https://api.spotify.com/v1/playlists/{playlistId}/tracks (e.g. 34E52K1dEJO5CzZRPkIR4I for Intermediate)
    fetchTracksForStudentLevel(normalizedLevel)
      .then((tracks) => {
        if (tracks && tracks.length > 0) {
          setLiveSpotifyTracks(tracks);
        }
      })
      .catch((err) => {
        console.warn('Erro ao carregar faixas do Spotify em tempo real:', err);
      })
      .finally(() => {
        setIsLoadingSpotify(false);
      });
  }, [normalizedLevel]);

  // Daily Exclusivity (1 song per study day) based on student's active plan and weekly cycle
  const isRestDay = useMemo(() => {
    return !activeDaysInOrder.includes(selectedDay);
  }, [activeDaysInOrder, selectedDay]);

  const currentStudyDayIndex = useMemo(() => {
    return activeDaysInOrder.indexOf(selectedDay);
  }, [activeDaysInOrder, selectedDay]);

  const effectiveJournal = useMemo(() => {
    if (Array.isArray(studentJournal) && studentJournal.length > 0) return studentJournal;
    if (Array.isArray(userProfile?.studentJournal) && userProfile.studentJournal.length > 0) return userProfile.studentJournal;
    return [];
  }, [studentJournal, userProfile?.studentJournal]);

  const currentDayTrack = useMemo(() => {
    return selectCurrentDaySpotifyTrack({
      level: normalizedLevel,
      selectedDay,
      activeStudyDays: activeDaysInOrder,
      weeklyCycle,
      liveTracks: liveSpotifyTracks,
      studentJournal: effectiveJournal,
    });
  }, [normalizedLevel, selectedDay, activeDaysInOrder, weeklyCycle, liveSpotifyTracks, effectiveJournal]);

  const dailySpotifyTrack = useMemo(() => {
    return (
      currentDayTrack ||
      getDailySpotifyTrackForStudent(normalizedLevel, selectedDay, activeDaysInOrder, weeklyCycle, effectiveJournal) ||
      levelPlaylistConfig.tracks.monday
    );
  }, [currentDayTrack, normalizedLevel, selectedDay, activeDaysInOrder, weeklyCycle, levelPlaylistConfig, effectiveJournal]);

  const dailyYouTubeVideo = useMemo(() => {
    return (
      getDailyYouTubeVideoForStudent(normalizedLevel, selectedDay, activeDaysInOrder, weeklyCycle, effectiveJournal) ||
      getYouTubePlaylistForLevel(normalizedLevel)?.videos?.monday
    );
  }, [normalizedLevel, selectedDay, activeDaysInOrder, weeklyCycle, effectiveJournal]);

  const currentDayActivities = routinesByDay[selectedDay] || [];

  const persistedVideo = persistedRoutinesByDay[selectedDay];

  // Active YouTube video extraction: priority given to Firestore persisted video, then activeActivity, then day activities
  // If persistedVideo explicitly has empty videoId (''), no video was chosen by the student yet
  const hasPersistedVideoId = Boolean(persistedVideo && persistedVideo.videoId && persistedVideo.videoId.trim() !== '');
  const isPersistedClean = Boolean(persistedVideo && persistedVideo.videoId === '');

  const rawAssignedVideo: TeacherAssignedVideo | null =
    hasPersistedVideoId
      ? ({
          id: persistedVideo!.activityId || `vid-${persistedVideo!.videoId}`,
          videoId: persistedVideo!.videoId,
          url: persistedVideo!.url || `https://www.youtube.com/watch?v=${persistedVideo!.videoId}`,
          title: persistedVideo!.videoTitle || persistedVideo!.title || 'Daily Video Practice',
          duration: persistedVideo!.duration || '5-10 min',
          instructions: persistedVideo!.instructions || '',
          addedAt: persistedVideo!.updatedAt || new Date().toISOString(),
          playlistId: persistedVideo!.playlistId,
          playlistTitle: persistedVideo!.playlistTitle,
          isRepeatVideo: persistedVideo!.isRepeatVideo,
        } as any)
      : isPersistedClean
      ? null
      : ((activeActivity?.teacherVideos && activeActivity.teacherVideos.length > 0 && activeActivity.teacherVideos[0]?.videoId
          ? activeActivity.teacherVideos[0]
          : null) ||
        currentDayActivities.find((act) => act && act.teacherVideos && act.teacherVideos.length > 0 && act.teacherVideos[0]?.videoId)?.teacherVideos?.[0] ||
        null);

  const userChosenTopicForDay =
    selectedTopicByDay[selectedDay] ||
    (hasPersistedVideoId ? (persistedVideo?.playlistId || '') : '') ||
    (persistedVideo?.isRepeatVideo ? 'repeat_previous_video' : '') ||
    '';

  const isRepeatVideoToday =
    persistedVideo?.isRepeatVideo === true ||
    (rawAssignedVideo as any)?.playlistId === 'repeat_previous_video' ||
    (rawAssignedVideo as any)?.playlistTitle === 'Repeat Previous Video' ||
    (rawAssignedVideo as any)?.playlistTitle === 'Repetir Vídeo Anterior' ||
    (rawAssignedVideo as any)?.isRepeatVideo === true ||
    activeActivity?.activityName === 'Repeat Previous Video' ||
    activeActivity?.activityName === 'Repetir Vídeo Anterior' ||
    (activeActivity as any)?.isRepeatVideo === true ||
    userChosenTopicForDay === 'repeat_previous_video';

  const hasPersistedOrAssignedVideo = Boolean(
    (userChosenTopicForDay && userChosenTopicForDay !== '') ||
    hasPersistedVideoId ||
    (persistedVideo?.isRepeatVideo) ||
    ((rawAssignedVideo as any)?.isCustomSuggestion) ||
    ((rawAssignedVideo as any)?.isRepeatVideo) ||
    ((rawAssignedVideo as any)?.assignedByTeacher)
  );

  const isTopicVoluntarilyChosen =
    Boolean(userChosenTopicForDay) ||
    isRepeatVideoToday ||
    hasPersistedOrAssignedVideo;

  const assignedVideo: TeacherAssignedVideo | null = isTopicVoluntarilyChosen ? rawAssignedVideo : null;

  const isActiveActivityCustomSuggestion =
    Boolean(activeActivity && customSuggestionActivities[activeActivity.id]) ||
    (assignedVideo as any)?.playlistId === 'custom_suggestion' ||
    (assignedVideo as any)?.isCustomSuggestion === true ||
    activeActivity?.activityName === 'Your Suggestion' ||
    activeActivity?.activityName === 'Sua Sugestão' ||
    (assignedVideo as any)?.playlistTitle === 'Your Suggestion' ||
    (assignedVideo as any)?.playlistTitle === 'Sua Sugestão';

  // Rule 2a: Do NOT auto-fill any URL when "Your Suggestion" is selected without a saved video URL
  const isCustomWithoutVideo =
    isActiveActivityCustomSuggestion && (!assignedVideo?.url || !assignedVideo?.videoId);

  const hasAssignedVideo = Boolean(assignedVideo && (assignedVideo.url || assignedVideo.videoId));
  const rawVideoUrl = hasAssignedVideo
    ? (assignedVideo?.videoId || assignedVideo?.url || '')
    : '';
  const validVidId = hasAssignedVideo
    ? (extractYouTubeVideoId(rawVideoUrl) || assignedVideo?.videoId || '')
    : '';
  const defaultVideoTitle = isRoutineLoading
    ? (isEn ? 'Loading video...' : 'Carregando vídeo...')
    : hasAssignedVideo
    ? (assignedVideo?.title || 'Daily Video Practice')
    : (isEn ? 'Choose Video' : 'Escolher Vídeo');
  const embedUrl = validVidId ? getYouTubeEmbedUrl(validVidId) : '';

  const rawAssignedSpotify =
    currentDayActivities.find((act) => act && act.teacherSpotify && act.teacherSpotify.url)?.teacherSpotify ||
    (activeActivity?.teacherSpotify?.url ? activeActivity.teacherSpotify : null);

  // Guard against any obsolete, broken or dummy placeholder Spotify URLs
  const assignedSpotify =
    rawAssignedSpotify && isValidSpotifyUrl(rawAssignedSpotify.url)
      ? rawAssignedSpotify
      : null;

  // Detect legacy template audios or level-mismatched assignments from previous beginner state
  const isLegacyTemplateAudio = Boolean(
    assignedSpotify &&
    (
      (assignedSpotify.id && (
        assignedSpotify.id.startsWith('sp-m') ||
        assignedSpotify.id.startsWith('sp-t') ||
        assignedSpotify.id.startsWith('sp-w') ||
        assignedSpotify.id.startsWith('sp-th') ||
        assignedSpotify.id.startsWith('sp-f') ||
        assignedSpotify.id.startsWith('sp-sa') ||
        assignedSpotify.id.startsWith('sp-su') ||
        assignedSpotify.id.startsWith('def-') ||
        (assignedSpotify as any).isDefaultTemplate === true
      )) ||
      // Legacy hardcoded URLs from default templates
      assignedSpotify.url.includes('7pKfPomDEeI4TPT6EOYjn9') || // Imagine
      assignedSpotify.url.includes('3B5UbSndRz907IZhhmUfLi') || // Count on Me
      assignedSpotify.url.includes('7BqBn9nXd3Ba0BsflQvvx1') || // Count on Me alt
      assignedSpotify.url.includes('0tgVpDi06FyKpA1z0VMD4v') || // Perfect
      assignedSpotify.url.includes('4qsVPnhbvEooD1bSNqvvh0') || // Let It Be
      assignedSpotify.url.includes('3AJwUDP919kvQ9QcozQPxg') || // Yellow
      assignedSpotify.url.includes('62PaSfnXSMyLshYJrlTuL3') || // Hello
      assignedSpotify.url.includes('6OzAkuRDmEpd52RF1g1WvU')    // Stand By Me
    )
  );

  const isLevelMismatchedAudio = Boolean(
    assignedSpotify &&
    (assignedSpotify as any).level &&
    normalizeStudentLevel((assignedSpotify as any).level) !== normalizedLevel
  );

  const isAssignedPlaylistMismatched = Boolean(
    assignedSpotify &&
    (assignedSpotify as any).playlistId &&
    (assignedSpotify as any).playlistId !== levelPlaylistConfig.playlistId &&
    ((assignedSpotify as any).playlistId === '01gS0x1KOwrDp7pJq2dPCM' ||
     (assignedSpotify as any).playlistId === '34E52K1dEJO5cZ7RPKlR4l' ||
     (assignedSpotify as any).playlistId === '2bMnxz06NIK6dHeG9lwyUF' ||
     (assignedSpotify as any).playlistId === '5MMU9H5oXDd7FCWr0gkzHE' ||
     (assignedSpotify as any).playlistTitle?.includes('Beginner'))
  );

  const teacherOverride = persistedVideo?.teacherOverrideTrack || null;
  const hasTeacherOverride = Boolean(teacherOverride?.url);

  const hasTeacherCustomAudio = Boolean(
    hasTeacherOverride || (
      assignedSpotify?.url &&
      !isLegacyTemplateAudio &&
      !isLevelMismatchedAudio &&
      !isAssignedPlaylistMismatched &&
      assignedSpotify.url.trim() !== '' &&
      assignedSpotify.url.trim() !== (currentDayTrack?.url || dailySpotifyTrack.url).trim()
    )
  );

  const effectiveTrackTitle = teacherOverride?.title
    ? teacherOverride.title
    : (hasTeacherCustomAudio && assignedSpotify?.title && assignedSpotify.title !== 'Teacher Recommended Audio'
      ? assignedSpotify.title
      : (currentDayTrack?.title || (isEn ? 'Rest Day' : 'Dia de Descanso')));
  const effectiveArtist: string = (teacherOverride?.artist || teacherOverride?.artistOrHost)
    ? (teacherOverride.artist || teacherOverride.artistOrHost || "It's simple")
    : (hasTeacherCustomAudio && assignedSpotify?.artistOrHost
      ? assignedSpotify.artistOrHost
      : (currentDayTrack?.artist || "It's simple"));
  const effectiveEmbedUrl = teacherOverride?.url
    ? (teacherOverride.embedUrl || getSpotifyEmbedUrl(teacherOverride.url))
    : (hasTeacherCustomAudio && assignedSpotify?.url
      ? (getSpotifyEmbedUrl(assignedSpotify.url) || currentDayTrack?.embedUrl || '')
      : (currentDayTrack?.embedUrl || ''));

  // Strict daily exclusivity: Guarantee 1 single track embed (never full playlist)
  const sanitizedEmbedUrl = useMemo(() => {
    if (!effectiveEmbedUrl) return '';
    if (effectiveEmbedUrl.includes('/embed/playlist/')) {
      const trackId = currentDayTrack?.trackId && !currentDayTrack.trackId.startsWith('http')
        ? currentDayTrack.trackId
        : '7qiZfU4dY1lWllzX7mPBI3';
      return `https://open.spotify.com/embed/track/${trackId}?utm_source=generator&theme=0`;
    }
    return effectiveEmbedUrl;
  }, [effectiveEmbedUrl, currentDayTrack]);
  const effectiveDirectUrl = teacherOverride?.url
    ? getSpotifyDirectUrl(teacherOverride.url)
    : (hasTeacherCustomAudio && assignedSpotify?.url
      ? getSpotifyDirectUrl(assignedSpotify.url)
      : (currentDayTrack?.url || levelPlaylistConfig.playlistUrl));
  const effectiveCoverUrl = teacherOverride?.coverUrl || teacherOverride?.imageUrl || currentDayTrack?.imageUrl || (currentDayTrack?.albumImages && currentDayTrack.albumImages[0]?.url) || '';
  const effectiveTeacherTip = teacherOverride?.instructions
    ? teacherOverride.instructions
    : (hasTeacherCustomAudio && assignedSpotify?.instructions
      ? assignedSpotify.instructions
      : (currentDayTrack
          ? (isEn ? currentDayTrack.teacherTipEn : currentDayTrack.teacherTipPt)
          : (isEn ? 'Rest day in your weekly study plan.' : 'Dia de descanso no seu plano de estudos.')));
  const currentDaySeqIndex = currentStudyDayIndex >= 0 ? currentStudyDayIndex + 1 : 1;

  // Real-time Firestore synchronization of the student's daily Spotify track (student -> Native Friend / Teacher)
  const studentSyncUid = userProfile?.id || userProfile?.email || 'student';
  const effectiveWeekId = `week-${weeklyCycle || userProfile?.weeklyCycle || 1}`;

  const currentSpotifyTrackForSync: CurrentSpotifyTrack | null = useMemo(() => {
    if (isRestDay || !currentDayTrack) return null;
    const tId = teacherOverride?.id || teacherOverride?.trackId || (currentDayTrack as any).trackId || (currentDayTrack as any).id || 'spotify-track';
    const tTitle = effectiveTrackTitle || currentDayTrack.title || 'Daily Track';
    const tArtist = effectiveArtist || currentDayTrack.artist || "It's simple";
    const tCover = effectiveCoverUrl;
    return {
      id: tId,
      title: tTitle,
      artist: tArtist,
      coverUrl: tCover,
      dayOfWeek: selectedDay,
      url: effectiveDirectUrl || currentDayTrack.url,
      level: normalizedLevel,
    };
  }, [isRestDay, currentDayTrack, teacherOverride, effectiveTrackTitle, effectiveArtist, effectiveCoverUrl, selectedDay, effectiveDirectUrl, normalizedLevel]);

  const { teacherFeedback } = useStudentSpotifySync({
    studentUid: studentSyncUid,
    studentEmail: userProfile?.email,
    nativeFriendUid: userProfile?.assignedNativeFriendUID || userProfile?.nativeFriendUID || userProfile?.teacherEmail,
    nativeFriendEmail: userProfile?.teacherEmail,
    weekId: effectiveWeekId,
    currentTrack: currentSpotifyTrackForSync,
  });

  const activeNativeFriendFeedback = teacherFeedback?.[selectedDay];

  // Automatic behavioral trackers for Daily Video and Spotify Audio
  const isVideoWatchedToday = Boolean(weeklyChecks?.[`video_day_${selectedDay}`]);
  const isAudioListenedToday = Boolean(weeklyChecks?.[`audio_day_${selectedDay}`]);

  const handleVideoCompleted = useCallback((vid: string, tit?: string) => {
    setTimeout(() => {
      if (onBehavioralComplete) {
        onBehavioralComplete({
          type: 'video',
          dayOfWeek: selectedDay,
          activityId: activeActivity?.id || 'act-1',
          video: {
            videoId: vid,
            videoTitle: tit || defaultVideoTitle,
            url: embedUrl,
            isRepeat: isRepeatVideoToday,
            isRepeatVideo: isRepeatVideoToday,
          } as any,
          isRepeat: isRepeatVideoToday,
          isRepeatVideo: isRepeatVideoToday,
        } as any);
      } else {
        onUpdateSPathCheck?.('video_day', selectedDay, true);
      }
    }, 0);
  }, [onBehavioralComplete, selectedDay, activeActivity?.id, defaultVideoTitle, embedUrl, isRepeatVideoToday, onUpdateSPathCheck]);

  const {
    iframeRef: videoIframeRef,
    handleIframeLoad: handleVideoIframeLoad,
    handlePlayerInteraction: handleVideoPlayerInteraction,
  } = useBehavioralVideoTracker({
    videoId: validVidId,
    videoTitle: defaultVideoTitle,
    retentionSeconds: 35,
    onCompleted: handleVideoCompleted,
    isAlreadyCompleted: isVideoWatchedToday,
  });

  const handleAudioCompleted = useCallback((trkId: string, tit?: string, art?: string) => {
    setTimeout(() => {
      if (onBehavioralComplete) {
        onBehavioralComplete({
          type: 'audio',
          dayOfWeek: selectedDay,
          activityId: 'act-2',
          track: {
            id: trkId,
            trackId: trkId,
            title: tit || effectiveTrackTitle,
            artist: art || effectiveArtist,
            coverUrl: effectiveCoverUrl,
            url: effectiveDirectUrl,
          },
        });
      } else {
        onUpdateSPathCheck?.('audio_day', selectedDay, true);
      }
    }, 0);
  }, [onBehavioralComplete, selectedDay, effectiveTrackTitle, effectiveArtist, effectiveCoverUrl, effectiveDirectUrl, onUpdateSPathCheck]);

  const {
    triggerCompletion: triggerAudioCompletion,
  } = useBehavioralAudioTracker({
    trackId: currentSpotifyTrackForSync?.id || 'sp-track',
    trackTitle: effectiveTrackTitle,
    artist: effectiveArtist,
    onCompleted: handleAudioCompleted,
    isAlreadyCompleted: isAudioListenedToday,
  });

  // End of day reminder calculation
  const lastActivity = getLastActivityOfTheDay(sortedActivities);
  const reminderTime = lastActivity ? getEndOfDayReminderTime(lastActivity.time) : '07:00';

  // Topic / Playlist selection & auto video injection handler
  const handleSelectPlaylistForActivity = async (activityId: string, playlistId: string) => {
    if (!playlistId) return;

    // Record user's voluntary choice for this day
    setSelectedTopicByDay((prev) => ({ ...prev, [selectedDay]: playlistId }));

    // Exclusive behavior for "Your Suggestion" / "Sua Sugestão"
    if (playlistId === 'custom_suggestion') {
      setCustomSuggestionActivities((prev) => ({ ...prev, [activityId]: true }));
      setSuggestingUrlActivityId(activityId);

      // Rule 2a: Do NOT auto-fill any URL; keep existing custom URL if already set, else empty
      const targetAct = currentDayList.find((a) => a.id === activityId);
      const existingCustomVid = targetAct?.teacherVideos?.[0];
      const isAlreadyCustom =
        (existingCustomVid as any)?.isCustomSuggestion ||
        (existingCustomVid as any)?.playlistId === 'custom_suggestion';

      setSuggestingUrlValues((prev) => ({
        ...prev,
        [activityId]: isAlreadyCustom ? (existingCustomVid?.url || '') : '',
      }));

      setPlaylistFeedback({
        activityId,
        type: 'success',
        message: isEn ? '💡 Paste your YouTube link below' : '💡 Cole seu link do YouTube abaixo',
      });
      setTimeout(() => setPlaylistFeedback(null), 3500);
      onSelectActivity(activityId);
      return;
    }

    // Behavior for "Repeat Previous Video" / "Repetir Vídeo Anterior"
    if (playlistId === 'repeat_previous_video') {
      setCustomSuggestionActivities((prev) => ({ ...prev, [activityId]: false }));
      setSuggestingUrlActivityId(null);
      setLoadingPlaylistAssignId(activityId);
      setPlaylistFeedback(null);

      // Search prior active study day from the student's study plan
      const calendarOrder: DayOfWeek[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
      const activeDaysInOrder = calendarOrder.filter((d) => activeStudyDays.includes(d));
      const effectiveActive = activeDaysInOrder.length > 0 ? activeDaysInOrder : calendarOrder;
      const currentActiveIdx = effectiveActive.indexOf(selectedDay);

      let targetPrevActiveDay: DayOfWeek;
      if (currentActiveIdx > 0) {
        // Immediately previous active study day in the student's weekly plan
        targetPrevActiveDay = effectiveActive[currentActiveIdx - 1];
      } else if (currentActiveIdx === 0 && effectiveActive.length > 1) {
        // First active study day: wrap to the last active day of the plan
        targetPrevActiveDay = effectiveActive[effectiveActive.length - 1];
      } else {
        const selCalIdx = calendarOrder.indexOf(selectedDay);
        const preceding = effectiveActive.filter((d) => calendarOrder.indexOf(d) < selCalIdx);
        targetPrevActiveDay = preceding.length > 0 ? preceding[preceding.length - 1] : (effectiveActive[effectiveActive.length - 1] || 'monday');
      }

      let prevVideo: TeacherAssignedVideo | null = null;
      let prevDayName = getDayLabel(targetPrevActiveDay, currentLanguage);

      // 1. Search prior study day from targetPrevActiveDay in routinesByDay
      const targetActs = routinesByDay[targetPrevActiveDay] || [];
      for (const a of targetActs) {
        const v = a.teacherVideos?.[0];
        if (v && (v.url || v.videoId)) {
          prevVideo = v;
          prevDayName = getDayLabel(targetPrevActiveDay, currentLanguage);
          break;
        }
      }

      // 2. Search other active days in reverse order if targetPrevActiveDay has no video yet
      if (!prevVideo) {
        const otherActiveDays = [...effectiveActive].filter((d) => d !== selectedDay && d !== targetPrevActiveDay).reverse();
        for (const d of otherActiveDays) {
          const dayActs = routinesByDay[d] || [];
          for (const a of dayActs) {
            const v = a.teacherVideos?.[0];
            if (v && (v.url || v.videoId)) {
              prevVideo = v;
              prevDayName = getDayLabel(d, currentLanguage);
              break;
            }
          }
          if (prevVideo) break;
        }
      }

      // 3. Fallback: curriculum default for targetPrevActiveDay
      if (!prevVideo) {
        const normLevel = normalizeStudentLevel(userProfile?.level || 'beginner');
        const fallbackCurriculumVid = getDailyYouTubeVideoForStudent(normLevel, targetPrevActiveDay);
        if (fallbackCurriculumVid) {
          prevVideo = {
            id: `vid-${selectedDay}-repeat-${Date.now()}`,
            url: fallbackCurriculumVid.url,
            videoId: fallbackCurriculumVid.videoId,
            title: fallbackCurriculumVid.title,
            duration: fallbackCurriculumVid.duration || '5-10 min',
            instructions: isEn
              ? `Repeated video practice from ${getDayLabel(targetPrevActiveDay, 'en')}.`
              : `Prática de repetição do vídeo de ${getDayLabel(targetPrevActiveDay, 'pt')}.`,
            addedAt: new Date().toISOString(),
          };
          prevDayName = getDayLabel(targetPrevActiveDay, currentLanguage);
        }
      }

      const studentEmail = userProfile?.email || 'aluno@itssimple.com';
      try {
        const res = await fetch('/api/student-video-assignments/assign', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            studentEmail,
            playlistId: 'repeat_previous_video',
            activityId,
            day: selectedDay,
            videoUrl: prevVideo?.url,
          }),
        });

        const data = await res.json();
        const candidatePrev = prevVideo;
        const finalVideo: TeacherAssignedVideo = data.video || candidatePrev || {
          id: `vid-${selectedDay}-repeat-${Date.now()}`,
          url: 'https://www.youtube.com/watch?v=V1bFr2KGq1g',
          videoId: 'V1bFr2KGq1g',
          title: 'Daily English Video Practice',
          duration: '5-10 min',
          instructions: isEn ? 'Repeated previous video' : 'Vídeo anterior repetido',
          addedAt: new Date().toISOString(),
        };

        const repeatedWithMeta: TeacherAssignedVideo = {
          ...finalVideo,
          playlistId: 'repeat_previous_video',
          playlistTitle: isEn ? 'Repeat Previous Video' : 'Repetir Vídeo Anterior',
        } as any;

        if (onAssignVideoToActivity) {
          onAssignVideoToActivity(activityId, repeatedWithMeta, selectedDay);
        }

        if (effectiveStudentUid && repeatedWithMeta) {
          saveVideoForDay(selectedDay, {
            videoId: repeatedWithMeta.videoId,
            videoTitle: repeatedWithMeta.title,
            title: repeatedWithMeta.title,
            url: repeatedWithMeta.url,
            playlistId: 'repeat_previous_video',
            playlistTitle: repeatedWithMeta.playlistTitle || (isEn ? 'Repeat Previous Video' : 'Repetir Vídeo Anterior'),
            activityId,
            isRepeatVideo: true,
            instructions: repeatedWithMeta.instructions,
            duration: repeatedWithMeta.duration,
          }).catch((e) => console.warn('Firestore routine repeat save notice:', e));
        }

        setPlaylistFeedback({
          activityId,
          type: 'success',
          message: isEn
            ? `🔁 Previous video repeated (${prevDayName || 'prior day'})!`
            : `🔁 Vídeo anterior repetido com sucesso (${prevDayName || 'dia anterior'})!`,
        });
        setTimeout(() => setPlaylistFeedback(null), 4500);
        onSelectActivity(activityId);
      } catch (err) {
        console.warn('Error repeating previous video:', err);
        if (prevVideo && onAssignVideoToActivity) {
          const repeatedWithMeta: TeacherAssignedVideo = {
            ...prevVideo,
            playlistId: 'repeat_previous_video',
            playlistTitle: isEn ? 'Repeat Previous Video' : 'Repetir Vídeo Anterior',
          } as any;
          onAssignVideoToActivity(activityId, repeatedWithMeta, selectedDay);

          if (effectiveStudentUid) {
            saveVideoForDay(selectedDay, {
              videoId: repeatedWithMeta.videoId,
              videoTitle: repeatedWithMeta.title,
              title: repeatedWithMeta.title,
              url: repeatedWithMeta.url,
              playlistId: 'repeat_previous_video',
              playlistTitle: repeatedWithMeta.playlistTitle || (isEn ? 'Repeat Previous Video' : 'Repetir Vídeo Anterior'),
              activityId,
              isRepeatVideo: true,
              instructions: repeatedWithMeta.instructions,
              duration: repeatedWithMeta.duration,
            }).catch((e) => console.warn('Firestore routine repeat save notice:', e));
          }

          setPlaylistFeedback({
            activityId,
            type: 'success',
            message: isEn ? '🔁 Previous video repeated!' : '🔁 Vídeo anterior repetido com sucesso!',
          });
          setTimeout(() => setPlaylistFeedback(null), 4000);
          onSelectActivity(activityId);
        }
      } finally {
        setLoadingPlaylistAssignId(null);
      }
      return;
    }

    // Reset custom suggestion mode if switching to a predefined topic
    setCustomSuggestionActivities((prev) => ({ ...prev, [activityId]: false }));
    setSuggestingUrlActivityId(null);
    setLoadingPlaylistAssignId(activityId);
    setPlaylistFeedback(null);
    setSavedTopicsBeforeRepeat((prev) => ({ ...prev, [activityId]: playlistId }));

    const studentEmail = userProfile?.email || 'aluno@itssimple.com';

    try {
      const res = await fetch('/api/student-video-assignments/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentEmail,
          studentUid: effectiveStudentUid,
          uid: effectiveStudentUid,
          playlistId,
          activityId,
          day: selectedDay,
          watchedVideosHistory: watchedHistory,
          studentJournal: effectiveJournal,
        }),
      });

      const data = await res.json();
      if (data.allConsumed) {
        setPlaylistFeedback({
          activityId,
          type: 'warning',
          message: data.message || (isEn ? 'All videos in this playlist were already assigned.' : 'Todos os vídeos desta playlist já foram assistidos.'),
        });
      } else if (data.success && data.video) {
        setPlaylistFeedback({
          activityId,
          type: 'success',
          message: `✨ ${data.video.title}`,
        });
        setTimeout(() => setPlaylistFeedback(null), 4500);

        if (onAssignVideoToActivity) {
          onAssignVideoToActivity(activityId, data.video, selectedDay);
        }

        // Immediately save to Firestore users/{studentUID}/routines/{dayOfWeek}
        if (effectiveStudentUid) {
          saveVideoForDay(selectedDay, {
            videoId: data.video.videoId,
            videoTitle: data.video.title,
            title: data.video.title,
            url: data.video.url,
            playlistId,
            playlistTitle: data.playlistTitle || data.video.playlistTitle,
            activityId,
            isRepeatVideo: false,
            instructions: data.video.instructions,
            duration: data.video.duration,
          }).catch((e) => console.warn('Firestore routine save notice:', e));

          if (data.video.videoId) {
            markVideoAsWatched(data.video.videoId).catch(() => {});
          }
        }

        onSelectActivity(activityId);
      } else {
        setPlaylistFeedback({
          activityId,
          type: 'error',
          message: data.error || (isEn ? 'Error assigning video.' : 'Erro ao injetar vídeo.'),
        });
      }
    } catch (err) {
      console.warn('Error assigning video from playlist:', err);
      setPlaylistFeedback({
        activityId,
        type: 'error',
        message: isEn ? 'Connection error assigning video.' : 'Erro na conexão ao injetar vídeo.',
      });
    } finally {
      setLoadingPlaylistAssignId(null);
    }
  };

  // Handler: Toggle "Repeat Previous Video" checkbox/button
  const handleToggleRepeatPreviousVideo = async (activityId: string, shouldRepeat: boolean) => {
    if (shouldRepeat) {
      // Find current playlist topic and remember it before repeating
      const currentAct = currentDayList.find((a) => a.id === activityId);
      const currentVid = currentAct?.teacherVideos?.[0];
      const currentPlId = (currentVid as any)?.playlistId || '';
      if (currentPlId && currentPlId !== 'repeat_previous_video' && currentPlId !== 'custom_suggestion') {
        setSavedTopicsBeforeRepeat((prev) => ({ ...prev, [activityId]: currentPlId }));
      }
      await handleSelectPlaylistForActivity(activityId, 'repeat_previous_video');
    } else {
      await handleUncheckRepeatPreviousVideo(activityId);
    }
  };

  // Handler: Uncheck "Repeat Previous Video", restoring topic selection and resetting video
  const handleUncheckRepeatPreviousVideo = async (activityId: string) => {
    setLoadingPlaylistAssignId(activityId);
    setPlaylistFeedback(null);
    setSelectedTopicByDay((prev) => ({ ...prev, [selectedDay]: '' }));

    const normLevel = normalizeStudentLevel(userProfile?.level || 'beginner');
    const defaultDailyVid = getDailyYouTubeVideoForStudent(normLevel, selectedDay);
    const studentEmail = userProfile?.email || 'aluno@itssimple.com';
    const studentUid = userProfile?.id || (userProfile as any)?.uid;

    const resetVideo: TeacherAssignedVideo = {
      id: `vid-${selectedDay}-reset-${Date.now()}`,
      url: '',
      videoId: '',
      title: isEn ? 'Video of the Day' : 'Vídeo do Dia',
      duration: '5-10 min',
      instructions: isEn ? 'Daily English video practice.' : 'Prática diária de vídeo em inglês.',
      addedAt: new Date().toISOString(),
      playlistId: '',
      playlistTitle: isEn ? 'Video of the Day' : 'Vídeo do Dia',
    } as any;

    if (onAssignVideoToActivity) {
      onAssignVideoToActivity(activityId, resetVideo, selectedDay);
    }

    if (effectiveStudentUid) {
      saveVideoForDay(selectedDay, {
        videoId: resetVideo.videoId,
        videoTitle: resetVideo.title,
        title: resetVideo.title,
        url: resetVideo.url,
        playlistId: '',
        playlistTitle: resetVideo.playlistTitle,
        activityId,
        isRepeatVideo: false,
      }).catch(() => {});
    }

    setCustomSuggestionActivities((prev) => ({ ...prev, [activityId]: false }));
    setSuggestingUrlActivityId(null);

    try {
      await fetch('/api/routines/teacher-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          activityId,
          activityName: isEn ? 'Video of the Day' : 'Vídeo do Dia',
          playlistTitle: isEn ? 'Video of the Day' : 'Vídeo do Dia',
          playlistId: '',
          videos: [resetVideo],
          teacherNotes: resetVideo.instructions,
          days: [selectedDay],
          day: selectedDay,
          studentEmail,
          studentUid,
        }),
      });
    } catch (err) {
      console.warn('Error syncing uncheck repeat video:', err);
    } finally {
      setLoadingPlaylistAssignId(null);
    }

    setPlaylistFeedback({
      activityId,
      type: 'info',
      message: isEn
        ? 'Topic selector re-enabled. Choose a topic or your suggestion.'
        : 'Seletor de tópicos reabilitado. Escolha um tema ou sua sugestão.',
    });
    setTimeout(() => setPlaylistFeedback(null), 3500);
    onSelectActivity(activityId);
  };

  // Handler: Save / Confirm custom YouTube video URL suggested by student
  const handleSaveCustomVideoSuggestion = async (activityId: string) => {
    const rawUrl = (suggestingUrlValues[activityId] || '').trim();
    if (!rawUrl) {
      setPlaylistFeedback({
        activityId,
        type: 'warning',
        message: isEn ? 'Please paste a YouTube URL.' : 'Por favor, informe a URL do YouTube.',
      });
      setTimeout(() => setPlaylistFeedback(null), 3000);
      return;
    }

    const vidId = extractYouTubeVideoId(rawUrl);
    if (!vidId) {
      setPlaylistFeedback({
        activityId,
        type: 'error',
        message: isEn ? 'Invalid YouTube link. Please verify.' : 'Link do YouTube inválido. Verifique o endereço.',
      });
      setTimeout(() => setPlaylistFeedback(null), 3500);
      return;
    }

    setIsSavingSuggestionId(activityId);
    setPlaylistFeedback(null);

    const canonicalUrl = `https://www.youtube.com/watch?v=${vidId}`;
    const suggestionTitle = isEn ? 'Your Suggestion' : 'Sua Sugestão';
    const customVideo: TeacherAssignedVideo = {
      id: `custom-suggest-${Date.now()}`,
      videoId: vidId,
      title: suggestionTitle,
      url: canonicalUrl,
      instructions: isEn ? 'Student suggested video for this routine' : 'Vídeo sugerido pelo aluno para esta rotina',
      playlistTitle: suggestionTitle,
      playlistId: 'custom_suggestion',
      isCustomSuggestion: true,
      addedAt: new Date().toISOString(),
    };

    try {
      if (onAssignVideoToActivity) {
        onAssignVideoToActivity(activityId, customVideo, selectedDay);
      }

      if (effectiveStudentUid && customVideo) {
        saveVideoForDay(selectedDay, {
          videoId: customVideo.videoId,
          videoTitle: customVideo.title,
          title: customVideo.title,
          url: customVideo.url,
          playlistId: 'custom_suggestion',
          playlistTitle: customVideo.playlistTitle,
          activityId,
          isRepeatVideo: false,
          instructions: customVideo.instructions,
          duration: customVideo.duration,
        }).catch((e) => console.warn('Firestore custom suggestion save notice:', e));

        if (customVideo.videoId) {
          markVideoAsWatched(customVideo.videoId).catch(() => {});
        }
      }

      setSuggestingUrlActivityId(null);
      setCustomSuggestionActivities((prev) => ({ ...prev, [activityId]: true }));
      setSuggestingUrlValues((prev) => ({ ...prev, [activityId]: canonicalUrl }));
      setPlaylistFeedback({
        activityId,
        type: 'success',
        message: isEn ? '✨ Suggested video saved!' : '✨ Sugestão de vídeo salva com sucesso!',
      });
      setTimeout(() => setPlaylistFeedback(null), 4000);
      onSelectActivity(activityId);
    } catch (err) {
      console.warn('Error saving custom video suggestion:', err);
      setPlaylistFeedback({
        activityId,
        type: 'error',
        message: isEn ? 'Error saving video suggestion.' : 'Erro ao salvar sugestão de vídeo.',
      });
    } finally {
      setIsSavingSuggestionId(null);
    }
  };

  // Add default activity pre-filled with profile routine video time
  const handleAddDefaultActivity = () => {
    if (!onAddCustomActivity) return;
    const hasVideoAct = sortedActivities.some(
      (act) =>
        (act.teacherVideos && act.teacherVideos.length > 0) ||
        act.id.endsWith('1') ||
        act.activityName?.toLowerCase().includes('vídeo') ||
        act.activityName?.toLowerCase().includes('video')
    );

    if (!hasVideoAct) {
      onAddCustomActivity({
        time: userProfile?.routineVideoTime || '09:00',
        activityName: isEn ? 'Morning Coffee & Routine (Video)' : 'Rotina Matinal e Café da Manhã (Vídeo)',
        dayOfWeek: selectedDay,
        completed: false,
        learnedWords: [],
        category: 'morning',
      });
    } else {
      onAddCustomActivity({
        time: '14:00',
        activityName: isEn ? 'Afternoon English Routine' : 'Rotina da Tarde em Inglês',
        dayOfWeek: selectedDay,
        completed: false,
        learnedWords: [],
        category: 'afternoon',
      });
    }
  };

  return (
    <div className="space-y-4" id="daily-routine-guide-section">
      {/* 1. Header Banner with Week Counter & Start New Week */}
      <div className="bg-gradient-to-br from-[#000035] via-[#062863] to-[#1C4C96] text-white rounded-3xl p-5 border border-[#1C4C96] shadow-md">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-[#1C4C96] text-[#9AB4FF] flex items-center justify-center shrink-0 border border-[#9AB4FF]/40 shadow-xs">
              <Sparkles className="w-5 h-5 text-[#9AB4FF]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-black text-white tracking-tight">
                  {isEn ? 'Daily Routine Guide' : 'Guia da Rotina Diária'}
                </h2>
              </div>
              <p className="text-xs text-[#9AB4FF]/85 mt-0.5">
                {isEn
                  ? 'Your personalized daily English immersion routine and interactive practice'
                  : 'Sua rotina diária personalizada de imersão e prática de inglês'}
              </p>
            </div>
          </div>

          {/* Right Side: Week Counter and Start New Week */}
          <div className="flex items-center gap-2.5 self-start sm:self-auto shrink-0">
            <div className="bg-[#000035]/90 px-3 py-1.5 rounded-2xl border border-[#9AB4FF]/40 flex items-center gap-1.5 shadow-xs">
              <RotateCcw className="w-3.5 h-3.5 text-[#F4CA54]" />
              <span className="text-xs font-black text-white">
                {isEn ? `Week ${weeklyCycle}` : `Semana ${weeklyCycle}`}
              </span>
            </div>
            {userProfile?.weeklyStudyDaysTarget && (
              <div
                className="bg-[#062863] px-2.5 py-1.5 rounded-2xl border border-[#607EC9]/40 flex items-center gap-1 shadow-xs"
                title={isEn ? `Weekly Study Goal: ${userProfile.weeklyStudyDaysTarget} days/week` : `Meta Semanal: ${userProfile.weeklyStudyDaysTarget} dias/semana`}
              >
                <Target className="w-3.5 h-3.5 text-[#F4CA54]" />
                <span className="text-[11px] font-bold text-[#F4CA54]">
                  {userProfile.weeklyStudyDaysTarget}{isEn ? 'd/wk' : 'd/sem'}
                </span>
              </div>
            )}
            {onStartNewWeek && (
              <button
                type="button"
                onClick={() => setIsNewWeekModalOpen(true)}
                className="px-3.5 py-1.5 rounded-2xl bg-[#F4CA54] hover:bg-[#e0b840] text-[#000035] font-black text-xs transition flex items-center gap-1.5 cursor-pointer shadow-xs border border-[#F4CA54]/40"
                title={isEn ? 'Start a fresh weekly cycle with brand new content' : 'Iniciar novo ciclo semanal com conteúdos inéditos'}
              >
                <Sparkles className="w-3.5 h-3.5 text-[#000035]" />
                <span>{isEn ? 'Start New Week' : 'Iniciar Nova Semana'}</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 2. Top Controls Row: Day Selector + Activities Timeline (Definitive 2-Column Layout) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5 items-stretch">
        {/* Left: Day Selector with Today's Focus */}
        <div className="lg:col-span-4 bg-white rounded-3xl p-4 border border-[#607EC9]/30 shadow-xs flex flex-col justify-between space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-black uppercase tracking-wider text-[#607EC9] flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-[#1C4C96]" />
              <span>
                {isEn
                  ? `Select Day (${getDayLabel(selectedDay, currentLanguage)})`
                  : `Selecione o Dia (${getDayLabel(selectedDay, currentLanguage)})`}
              </span>
            </span>

            {/* Today's Focus Pill Indicator */}
            {activeStudyDays.includes(todayDay) ? (
              selectedDay !== todayDay ? (
                <button
                  type="button"
                  onClick={() => onSelectDay(todayDay)}
                  className="text-[10px] font-extrabold text-[#000035] bg-[#F4CA54] hover:bg-[#e0b840] px-2 py-0.5 rounded-full flex items-center gap-1 cursor-pointer transition shadow-xs"
                  title={isEn ? "Jump directly to today's focus" : 'Ir diretamente para o foco de hoje'}
                >
                  <Sparkles className="w-3 h-3 text-[#000035]" />
                  <span>{isEn ? "Today's Focus" : 'Foco de Hoje'}</span>
                </button>
              ) : (
                <span className="text-[10px] font-extrabold text-[#000035] bg-[#F4CA54] px-2 py-0.5 rounded-full flex items-center gap-1 shadow-xs">
                  <Sparkles className="w-3 h-3 text-[#000035]" />
                  <span>{isEn ? "Today's Focus" : 'Foco de Hoje'}</span>
                </span>
              )
            ) : (
              <span
                className="text-[10px] font-extrabold text-slate-500 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-full flex items-center gap-1"
                title={isEn ? 'Rest day in your study plan' : 'Dia de descanso no seu plano'}
              >
                <span>{isEn ? 'Rest Day' : 'Dia de Descanso'}</span>
              </span>
            )}
          </div>

          {/* 7 Days Buttons Grid with active student plan filter */}
          <div className="grid grid-cols-7 gap-1">
            {DAYS_OF_WEEK.map((day) => {
              const isSelected = selectedDay === day;
              const isToday = day === todayDay;
              const isActiveInPlan = activeStudyDays.includes(day);
              const dayCount = (routinesByDay[day] || []).length;

              if (!isActiveInPlan) {
                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() => onSelectDay(day)}
                    className={`py-2 px-1 rounded-xl text-center flex flex-col items-center justify-center transition cursor-pointer select-none ${
                      isSelected
                        ? 'bg-[#000035] text-white shadow-sm border-2 border-[#1C4C96]'
                        : 'opacity-40 hover:opacity-80 bg-slate-100 text-slate-500 border border-dashed border-slate-300'
                    }`}
                    title={
                      isEn
                        ? `Rest day in your weekly study plan (${getDayLabel(day, 'en')})`
                        : `Dia de descanso no seu plano semanal (${getDayLabel(day, 'pt')})`
                    }
                  >
                    <span className="text-[10px] font-black uppercase">
                      {getDayShortLabel(day, currentLanguage)}
                    </span>
                    <span className="text-[8px] font-bold mt-0.5">
                      {isEn ? 'Rest' : 'Folga'}
                    </span>
                  </button>
                );
              }

              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => onSelectDay(day)}
                  className={`py-2 px-1 rounded-xl text-center transition flex flex-col items-center justify-center cursor-pointer relative ${
                    isSelected
                      ? 'bg-[#000035] text-white shadow-sm border-2 border-[#1C4C96]'
                      : isToday
                      ? 'bg-amber-50/80 hover:bg-amber-100 text-[#000035] border-2 border-[#F4CA54]'
                      : 'bg-slate-50 hover:bg-[#9AB4FF]/20 text-[#000035] border border-slate-200'
                  }`}
                >
                  <span className="text-[10px] font-black uppercase flex items-center gap-0.5">
                    {getDayShortLabel(day, currentLanguage)}
                    {isToday && <span className="w-1.5 h-1.5 rounded-full bg-[#F4CA54] inline-block" />}
                  </span>
                  <span
                    className={`text-[9px] font-bold ${
                      isSelected ? 'text-[#9AB4FF]' : 'text-[#607EC9]'
                    }`}
                  >
                    {dayCount}
                  </span>
                  {isToday && (
                    <span className="text-[7px] font-black uppercase px-1 rounded-full bg-[#F4CA54] text-[#000035] leading-tight mt-0.5">
                      {isEn ? 'Today' : 'Hoje'}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Quick jump */}
          <div className="flex items-center justify-between text-[10px] pt-1.5 border-t border-slate-100">
            <button
              type="button"
              onClick={() => onSelectDay(todayDay)}
              className={`font-black cursor-pointer hover:underline flex items-center gap-1 ${
                selectedDay === todayDay ? 'text-[#000035]' : 'text-[#1C4C96]'
              }`}
            >
              <Star className="w-3 h-3 text-[#F4CA54] fill-[#F4CA54]" />
              <span>{isEn ? `Today (${getDayShortLabel(todayDay, currentLanguage)})` : `Hoje (${getDayShortLabel(todayDay, currentLanguage)})`}</span>
            </button>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleJumpWeekdays}
                className="text-[#607EC9] hover:underline font-bold cursor-pointer"
              >
                {isEn ? 'Mon-Fri' : 'Seg-Sex'}
              </button>
              <span className="text-slate-300">•</span>
              <button
                type="button"
                onClick={handleJumpWeekends}
                className="text-[#607EC9] hover:underline font-bold cursor-pointer"
              >
                {isEn ? 'Sat-Sun' : 'Sáb-Dom'}
              </button>
            </div>
          </div>
        </div>

        {/* Right: Activities Timeline with Integrated Topic/Playlist Selector */}
        <div className="lg:col-span-8 bg-white rounded-3xl p-4 border border-[#607EC9]/30 shadow-xs flex flex-col justify-between space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-black uppercase tracking-wider text-[#607EC9] flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-[#1C4C96]" />
              <span>
                {isEn
                  ? `Activities Timeline (${sortedActivities.length} ${
                      sortedActivities.length === 1 ? 'activity' : 'activities'
                    })`
                  : `Linha do Tempo (${sortedActivities.length} ${
                      sortedActivities.length === 1 ? 'atividade' : 'atividades'
                    })`}
              </span>
            </span>

            {onAddCustomActivity && (
              <button
                type="button"
                onClick={handleAddDefaultActivity}
                className="text-[11px] font-bold text-[#1C4C96] hover:text-[#062863] bg-[#9AB4FF]/15 hover:bg-[#9AB4FF]/30 px-2.5 py-1 rounded-xl flex items-center gap-1 cursor-pointer transition"
                title={isEn ? 'Add activity to today\'s timeline' : 'Adicionar atividade à rotina de hoje'}
              >
                <Plus className="w-3 h-3 text-[#1C4C96]" />
                <span>{isEn ? '+ Add Activity' : '+ Adicionar Atividade'}</span>
              </button>
            )}
          </div>

          {/* Activities list/timeline */}
          <div className="space-y-2 overflow-y-auto max-h-[190px] pr-1">
            {isRoutineLoading && sortedActivities.length === 0 ? (
              <div className="py-6 px-4 bg-[#9AB4FF]/5 rounded-2xl border border-dashed border-[#607EC9]/40 text-center flex flex-col items-center justify-center space-y-2">
                <Loader2 className="w-5 h-5 text-[#1C4C96] animate-spin" />
                <span className="text-xs font-semibold text-[#000035]">
                  {isEn ? 'Loading activities...' : 'Carregando atividades...'}
                </span>
              </div>
            ) : sortedActivities.length === 0 ? (
              <div className="py-5 px-4 bg-[#9AB4FF]/5 rounded-2xl border border-dashed border-[#607EC9]/40 text-center space-y-2">
                <div className="flex items-center justify-center gap-2 text-xs font-bold text-[#000035]">
                  <Clock className="w-4 h-4 text-[#1C4C96]" />
                  <span>
                    {isEn
                      ? `No routine configured for ${getDayLabel(selectedDay, currentLanguage)} yet.`
                      : `Nenhuma rotina configurada para ${getDayLabel(selectedDay, currentLanguage)} ainda.`}
                  </span>
                </div>
                <p className="text-[11px] text-[#607EC9] max-w-md mx-auto">
                  {isEn
                    ? `Set up your daily video activity with your profile's preferred study time (${formatToAmPm(userProfile?.routineVideoTime || '09:00')}). You can edit the time anytime.`
                    : `Configure sua atividade diária de vídeo com o horário preferencial do seu perfil (${formatToAmPm(userProfile?.routineVideoTime || '09:00')}). O horário permanece totalmente editável.`}
                </p>
                {onAddCustomActivity && (
                  <button
                    type="button"
                    onClick={handleAddDefaultActivity}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#1C4C96] hover:bg-[#062863] text-white rounded-xl text-xs font-black transition cursor-pointer shadow-xs"
                  >
                    <Plus className="w-3.5 h-3.5 text-[#9AB4FF]" />
                    <span>
                      {isEn
                        ? `+ Configure Daily Video (${formatToAmPm(userProfile?.routineVideoTime || '09:00')})`
                        : `+ Configurar Vídeo do Dia (${formatToAmPm(userProfile?.routineVideoTime || '09:00')})`}
                    </span>
                  </button>
                )}
              </div>
            ) : (
              sortedActivities.map((act) => {
                const isSelected = act.id === activeActivity?.id;
                const wordsCount = act.learnedWords ? act.learnedWords.length : 0;

                const isCustomSuggestion =
                  Boolean(customSuggestionActivities[act.id]) ||
                  (act.teacherVideos?.[0] as any)?.playlistId === 'custom_suggestion' ||
                  (act.teacherVideos?.[0] as any)?.isCustomSuggestion === true ||
                  act.activityName === 'Your Suggestion' ||
                  act.activityName === 'Sua Sugestão' ||
                  (act.teacherVideos?.[0] as any)?.playlistTitle === 'Your Suggestion' ||
                  (act.teacherVideos?.[0] as any)?.playlistTitle === 'Sua Sugestão';

                const isVideoAct =
                  isCustomSuggestion ||
                  (act.teacherVideos && act.teacherVideos.length > 0) ||
                  act.id.endsWith('1') ||
                  act.activityName?.toLowerCase().includes('vídeo') ||
                  act.activityName?.toLowerCase().includes('video') ||
                  playlists.some((pl) => pl.title?.toLowerCase().trim() === act.activityName?.toLowerCase().trim());

                const isAudioAct =
                  Boolean(act.teacherSpotify) ||
                  act.id.endsWith('2') ||
                  act.activityName?.toLowerCase().includes('áudio') ||
                  act.activityName?.toLowerCase().includes('audio') ||
                  act.activityName?.toLowerCase().includes('podcast');

                const badgeLabel = isVideoAct
                  ? isEn ? 'Video of the Day' : 'Vídeo do Dia'
                  : isAudioAct
                  ? isEn ? 'Audio / Podcast' : 'Áudio do Dia'
                  : isEn ? 'Daily Activity' : 'Atividade Diária';

                const badgeClasses = isVideoAct
                  ? isSelected
                    ? 'bg-[#1C4C96] text-[#9AB4FF]'
                    : 'bg-[#9AB4FF]/20 text-[#062863]'
                  : isAudioAct
                  ? isSelected
                    ? 'bg-emerald-800 text-emerald-200'
                    : 'bg-emerald-100 text-emerald-800'
                  : isSelected
                  ? 'bg-white/10 text-slate-300'
                  : 'bg-slate-100 text-slate-600';

                // Find currently active playlist ID for this activity
                const assignedVid = act.teacherVideos?.[0];
                const isRepeatVideo =
                  (assignedVid as any)?.playlistId === 'repeat_previous_video' ||
                  (assignedVid as any)?.playlistTitle === 'Repeat Previous Video' ||
                  (assignedVid as any)?.playlistTitle === 'Repetir Vídeo Anterior' ||
                  act.activityName === 'Repeat Previous Video' ||
                  act.activityName === 'Repetir Vídeo Anterior';

                const dayTopicSelection = selectedTopicByDay[selectedDay] || '';
                const persistedDay = persistedRoutinesByDay[selectedDay];
                let currentPlaylistId = '';

                if (isRepeatVideo || persistedDay?.isRepeatVideo) {
                  currentPlaylistId = 'repeat_previous_video';
                } else if (
                  dayTopicSelection === 'custom_suggestion' ||
                  isCustomSuggestion ||
                  persistedDay?.playlistId === 'custom_suggestion' ||
                  persistedDay?.title === 'Your Suggestion' ||
                  persistedDay?.title === 'Sua Sugestão' ||
                  persistedDay?.playlistTitle === 'Your Suggestion' ||
                  persistedDay?.playlistTitle === 'Sua Sugestão'
                ) {
                  currentPlaylistId = 'custom_suggestion';
                } else if (dayTopicSelection) {
                  currentPlaylistId = dayTopicSelection;
                } else if (persistedDay?.playlistId && hasPersistedVideoId) {
                  currentPlaylistId = persistedDay.playlistId;
                } else if (hasPersistedVideoId && (assignedVid as any)?.playlistId) {
                  currentPlaylistId = (assignedVid as any).playlistId;
                } else if (hasPersistedVideoId && (assignedVid as any)?.playlistTitle) {
                  const matched = sortedPlaylists.find((pl) => pl.title?.toLowerCase() === (assignedVid as any).playlistTitle?.toLowerCase());
                  if (matched) currentPlaylistId = matched.id;
                } else if (persistedDay?.playlistTitle) {
                  const matched = sortedPlaylists.find((pl) => pl.title?.toLowerCase() === persistedDay.playlistTitle?.toLowerCase());
                  if (matched) currentPlaylistId = matched.id;
                } else if (userChosenTopicForDay && act.activityName && act.activityName !== 'Video of the Day' && act.activityName !== 'Vídeo do Dia') {
                  const matched = sortedPlaylists.find((pl) => pl.title?.toLowerCase() === act.activityName?.toLowerCase());
                  if (matched) currentPlaylistId = matched.id;
                } else {
                  // Strictly neutral initial "Choose Video..." state ("" or null)
                  // The user must voluntarily pick a topic; never auto-match or inherit from previous day
                  currentPlaylistId = '';
                }

                // Verify that currentPlaylistId exists in known options, otherwise default to empty string ("Choose Topic...")
                const isKnownPlaylist =
                  currentPlaylistId === 'custom_suggestion' ||
                  currentPlaylistId === 'repeat_previous_video' ||
                  sortedPlaylists.some((pl) => pl.id === currentPlaylistId);
                const safePlaylistValue = isKnownPlaylist ? currentPlaylistId : '';

                return (
                  <div
                    key={act.id}
                    onClick={() => onSelectActivity(act.id)}
                    className={`p-2.5 rounded-2xl border text-left transition flex flex-col md:flex-row md:items-center justify-between gap-2 cursor-pointer ${
                      isSelected
                        ? 'bg-[#000035] text-white border-[#1C4C96] shadow-2xs'
                        : 'bg-slate-50 hover:bg-slate-100 text-[#000035] border-slate-200'
                    }`}
                  >
                    {/* Left: Checkbox + Time + Badges + Name */}
                    <div className="flex items-center gap-2 min-w-0 flex-wrap flex-1">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleActivityComplete(act.id);
                        }}
                        className="cursor-pointer shrink-0"
                        title={act.completed ? (isEn ? 'Completed' : 'Concluído') : (isEn ? 'Mark completed' : 'Marcar concluído')}
                      >
                        <CheckCircle2
                          className={`w-4 h-4 ${
                            act.completed
                              ? isSelected
                                ? 'text-[#9AB4FF]'
                                : 'text-emerald-600'
                              : isSelected
                              ? 'text-slate-500'
                              : 'text-slate-300'
                          }`}
                        />
                      </button>

                      {/* Time display with punctual inline edit */}
                      {editingTimeActivityId === act.id ? (
                        <div
                          className="flex items-center gap-1 bg-white px-1.5 py-0.5 rounded-lg border border-[#1C4C96] shadow-xs shrink-0"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input
                            type="time"
                            value={editingTimeValue}
                            onChange={(e) => setEditingTimeValue(e.target.value)}
                            className="text-[11px] font-mono font-bold text-[#000035] bg-transparent focus:outline-hidden"
                            autoFocus
                          />
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (editingTimeValue && onUpdateTimeActivity) {
                                onUpdateTimeActivity(act.id, editingTimeValue);
                              }
                              setEditingTimeActivityId(null);
                            }}
                            className="p-1 rounded bg-emerald-600 text-white hover:bg-emerald-700 cursor-pointer"
                            title={isEn ? 'Save time' : 'Salvar horário'}
                          >
                            <Check className="w-3 h-3" />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingTimeActivityId(null);
                            }}
                            className="p-1 rounded bg-slate-200 text-slate-700 hover:bg-slate-300 cursor-pointer"
                            title={isEn ? 'Cancel' : 'Cancelar'}
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingTimeActivityId(act.id);
                            setEditingTimeValue(act.time || '09:00');
                          }}
                          className={`group/time flex items-center gap-1 px-2 py-0.5 rounded-lg transition text-[11px] font-mono font-bold shrink-0 cursor-pointer ${
                            isSelected
                              ? 'text-[#9AB4FF] bg-white/10 hover:bg-white/20 hover:text-white'
                              : 'text-[#1C4C96] bg-[#9AB4FF]/15 hover:bg-[#9AB4FF]/30 hover:text-[#062863]'
                          }`}
                          title={isEn ? 'Click to change activity time' : 'Clique para alterar pontualmente o horário'}
                        >
                          <span>{formatToAmPm(act.time)}</span>
                          <Edit3 className="w-2.5 h-2.5 opacity-60 group-hover/time:opacity-100 transition shrink-0" />
                        </button>
                      )}

                      {/* Accurate Activity Type Badge */}
                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap shrink-0 ${badgeClasses}`}>
                        {badgeLabel}
                      </span>

                      <span
                        className={`text-[9px] font-bold shrink-0 ${
                          isSelected ? 'text-[#F4CA54]' : 'text-slate-500'
                        }`}
                      >
                        {wordsCount}/5 Words
                      </span>

                      {isVideoAct ? (
                        <div className="flex items-center gap-2 flex-wrap min-w-0">
                          {/* Topic Dropdown (Predefined topics + "Your Suggestion") */}
                          <div
                            className="relative inline-flex items-center min-w-0"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <select
                              value={isRepeatVideo ? '' : safePlaylistValue}
                              onChange={(e) => handleSelectPlaylistForActivity(act.id, e.target.value)}
                              disabled={isRepeatVideo || loadingPlaylistAssignId === act.id || isLoadingPlaylists || isRoutineLoading}
                              aria-label={isEn ? 'Playlist Topic / Routine name' : 'Tópico da Playlist / Nome da Rotina'}
                              className={`text-xs font-bold py-1 pl-2.5 pr-7 rounded-xl border appearance-none transition focus:outline-hidden max-w-[180px] sm:max-w-[240px] truncate shadow-2xs ${
                                isRepeatVideo
                                  ? isSelected
                                    ? 'bg-[#062863]/60 text-slate-300 border-[#607EC9]/40 opacity-70 cursor-not-allowed'
                                    : 'bg-slate-100 text-slate-500 border-slate-300 opacity-70 cursor-not-allowed'
                                  : isSelected
                                  ? 'bg-[#062863] text-white border-[#607EC9] hover:bg-[#1C4C96] hover:border-[#9AB4FF] cursor-pointer'
                                  : 'bg-white text-[#000035] border-slate-300 hover:border-[#1C4C96] cursor-pointer'
                              }`}
                              title={
                                isRepeatVideo
                                  ? (isEn
                                      ? 'Topic selection is disabled while "Repeat Previous Video" is checked'
                                      : 'Seleção de tópicos desabilitada enquanto "Repetir Vídeo Anterior" estiver marcado')
                                  : (isEn
                                      ? 'Topic: Choose video from playlist to unify routine name & inject exclusive video'
                                      : 'Tópico: Escolha o vídeo da playlist para unificar o nome da rotina e injetar o vídeo exclusivo')
                              }
                            >
                              <option value="" className="text-slate-600 bg-white font-medium">
                                {isRoutineLoading
                                  ? (isEn ? '⏳ Loading routine...' : '⏳ Carregando rotina...')
                                  : isLoadingPlaylists
                                  ? (isEn ? '⏳ Loading videos...' : '⏳ Carregando vídeos...')
                                  : loadingPlaylistAssignId === act.id
                                  ? (isEn ? '⏳ Assigning Video...' : '⏳ Injetando Vídeo...')
                                  : isRepeatVideo
                                  ? (isEn ? '🔁 Repeat Previous Video' : '🔁 Repetir Vídeo Anterior')
                                  : (isEn ? '🎯 Choose Video' : '🎯 Escolher Vídeo')}
                              </option>
                              <option value="custom_suggestion" className="text-[#000035] bg-white font-semibold">
                                {isEn ? '💡 Your Suggestion' : '💡 Sua Sugestão'}
                              </option>
                              {sortedPlaylists.map((pl) => (
                                <option key={pl.id} value={pl.id} className="text-[#000035] bg-white">
                                  {pl.title}
                                </option>
                              ))}
                            </select>
                            <ChevronDown
                              className={`w-3.5 h-3.5 pointer-events-none absolute right-2 ${
                                isRepeatVideo
                                  ? 'text-slate-400'
                                  : isSelected
                                  ? 'text-[#9AB4FF]'
                                  : 'text-[#1C4C96]'
                              }`}
                            />
                          </div>

                          {/* Dynamic Refresh / Sync Playlists button */}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              loadPlaylists(true);
                            }}
                            disabled={isSyncingPlaylists || isLoadingPlaylists}
                            title={
                              isEn
                                ? 'Sync & update YouTube playlists from adm.itissimple@gmail.com'
                                : 'Sincronizar e atualizar playlists do YouTube de adm.itissimple@gmail.com'
                            }
                            className={`p-1.5 rounded-xl border text-xs transition shrink-0 select-none shadow-2xs ${
                              isSelected
                                ? 'bg-white/10 hover:bg-white/20 text-[#9AB4FF] border-white/20'
                                : 'bg-white hover:bg-slate-50 text-[#1C4C96] border-slate-300'
                            } ${isSyncingPlaylists ? 'opacity-70 cursor-wait' : ''}`}
                          >
                            <RefreshCw className={`w-3.5 h-3.5 ${isSyncingPlaylists ? 'animate-spin text-amber-400' : ''}`} />
                          </button>

                          {/* Re-authenticate / Connect button if required */}
                          {reauthRequired && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleReauthenticateYouTube();
                              }}
                              disabled={isReauthenticating}
                              title={
                                isEn
                                  ? 'Connect YouTube account (adm.itissimple@gmail.com) to load dynamic playlists'
                                  : 'Conectar conta do YouTube (adm.itissimple@gmail.com) para carregar playlists dinâmicas'
                              }
                              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-bold border transition shrink-0 shadow-2xs ${
                                isSelected
                                  ? 'bg-amber-400/20 text-amber-200 border-amber-300/40 hover:bg-amber-400/30'
                                  : 'bg-amber-50 text-amber-900 border-amber-300 hover:bg-amber-100'
                              } ${isReauthenticating ? 'opacity-70 cursor-wait' : ''}`}
                            >
                              {isReauthenticating ? (
                                <RefreshCw className="w-3.5 h-3.5 animate-spin text-amber-500" />
                              ) : (
                                <Youtube className="w-3.5 h-3.5 text-red-500" />
                              )}
                              <span className="whitespace-nowrap">
                                {isReauthenticating
                                  ? (isEn ? 'Connecting...' : 'Conectando...')
                                  : (isEn ? 'Connect YouTube' : 'Conectar YouTube')}
                              </span>
                            </button>
                          )}

                          {/* Display non-blocking error badge if present and reauth not required */}
                          {playlistsError && !reauthRequired && (
                            <span
                              className="text-[10px] text-amber-500 font-medium truncate max-w-[160px]"
                              title={playlistsError}
                            >
                              ⚠️ {playlistsError}
                            </span>
                          )}

                          {/* Requirement 2 & 3: "Repeat Previous Video" Checkbox/Toggle, shown ONLY from 2nd active study day onwards */}
                          {canShowRepeatVideoOption && (
                            <label
                              onClick={(e) => e.stopPropagation()}
                              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-bold border transition cursor-pointer select-none shrink-0 shadow-2xs ${
                                isSelected
                                  ? isRepeatVideo
                                    ? 'bg-[#1C4C96] text-white border-[#9AB4FF] ring-1 ring-[#9AB4FF]/50'
                                    : 'bg-white/10 text-slate-200 border-white/20 hover:bg-white/20 hover:text-white'
                                  : isRepeatVideo
                                  ? 'bg-[#1C4C96]/15 text-[#062863] border-[#1C4C96] font-extrabold'
                                  : 'bg-white text-[#000035] border-slate-300 hover:border-[#1C4C96]'
                              } ${loadingPlaylistAssignId === act.id ? 'opacity-60 cursor-wait' : ''}`}
                              title={
                                isEn
                                  ? 'Repeat video from the previous active study day of this week'
                                  : 'Repetir vídeo do último dia de estudo ativo da semana'
                              }
                            >
                              <input
                                type="checkbox"
                                checked={isRepeatVideo}
                                onChange={(e) => handleToggleRepeatPreviousVideo(act.id, e.target.checked)}
                                disabled={loadingPlaylistAssignId === act.id}
                                className="w-3.5 h-3.5 rounded border-slate-300 text-[#1C4C96] focus:ring-0 cursor-pointer accent-[#1C4C96]"
                              />
                              <span className="whitespace-nowrap">
                                {isEn ? 'Repeat Previous Video' : 'Repetir Vídeo Anterior'}
                              </span>
                            </label>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs font-bold truncate max-w-[160px] sm:max-w-[220px]" title={act.activityName}>
                          {getActivityDisplayName(act.activityName, currentLanguage)}
                        </span>
                      )}

                      {/* Custom Suggestion URL Input & Confirmation Controls */}
                      {isCustomSuggestion && (
                        <div
                          className="inline-flex items-center gap-1.5 min-w-0"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {suggestingUrlActivityId === act.id || !assignedVid?.url ? (
                            <div className="inline-flex items-center gap-1.5 min-w-0">
                              <div className="relative w-44 sm:w-60 md:w-72">
                                <Youtube className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-red-500 pointer-events-none shrink-0" />
                                <input
                                  type="url"
                                  value={
                                    suggestingUrlValues[act.id] !== undefined
                                      ? suggestingUrlValues[act.id]
                                      : (assignedVid?.url || '')
                                  }
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    setSuggestingUrlValues((prev) => ({ ...prev, [act.id]: val }));
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      e.preventDefault();
                                      handleSaveCustomVideoSuggestion(act.id);
                                    } else if (e.key === 'Escape') {
                                      setSuggestingUrlActivityId(null);
                                    }
                                  }}
                                  placeholder={isEn ? 'Paste YouTube link (https://...)' : 'Cole o link do YouTube (https://...)'}
                                  className={`w-full text-xs py-1 pl-8 pr-2 rounded-xl border focus:outline-hidden transition shadow-2xs font-mono ${
                                    isSelected
                                      ? 'bg-[#062863] text-white border-[#607EC9] placeholder-slate-400 focus:border-[#9AB4FF]'
                                      : 'bg-white text-[#000035] border-slate-300 placeholder-slate-400 focus:border-[#1C4C96]'
                                  }`}
                                  autoFocus
                                />
                              </div>
                              <button
                                type="button"
                                onClick={() => handleSaveCustomVideoSuggestion(act.id)}
                                disabled={isSavingSuggestionId === act.id}
                                className="flex items-center gap-1 px-2.5 py-1 text-xs font-bold rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white transition shadow-xs cursor-pointer shrink-0 disabled:opacity-50"
                                title={isEn ? 'Save YouTube URL' : 'Salvar link do YouTube'}
                              >
                                {isSavingSuggestionId === act.id ? (
                                  <RefreshCw className="w-3 h-3 animate-spin" />
                                ) : (
                                  <Check className="w-3 h-3" />
                                )}
                                <span>{isEn ? 'Save' : 'Salvar'}</span>
                              </button>
                              {assignedVid?.url && (
                                <button
                                  type="button"
                                  onClick={() => setSuggestingUrlActivityId(null)}
                                  className={`p-1 rounded-lg transition cursor-pointer shrink-0 ${
                                    isSelected ? 'text-slate-400 hover:text-white' : 'text-slate-400 hover:text-slate-600'
                                  }`}
                                  title={isEn ? 'Cancel' : 'Cancelar'}
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          ) : (
                            <div className="inline-flex items-center gap-1.5 shrink-0">
                              <a
                                href={assignedVid.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className={`inline-flex items-center gap-1 text-[11px] font-mono px-2 py-0.5 rounded-lg border transition truncate max-w-[130px] sm:max-w-[180px] ${
                                  isSelected
                                    ? 'bg-white/10 text-[#9AB4FF] border-[#607EC9]/40 hover:bg-white/20'
                                    : 'bg-slate-100 text-[#1C4C96] border-slate-200 hover:bg-slate-200'
                                }`}
                                title={assignedVid.url}
                              >
                                <Youtube className="w-3 h-3 text-red-500 shrink-0" />
                                <span className="truncate">{assignedVid.url}</span>
                                <ExternalLink className="w-2.5 h-2.5 opacity-60 shrink-0" />
                              </a>
                              <button
                                type="button"
                                onClick={() => {
                                  setSuggestingUrlActivityId(act.id);
                                  setSuggestingUrlValues((prev) => ({
                                    ...prev,
                                    [act.id]: assignedVid.url || '',
                                  }));
                                }}
                                className={`p-1 rounded-lg transition cursor-pointer shrink-0 ${
                                  isSelected
                                    ? 'text-[#9AB4FF] hover:bg-white/10 hover:text-white'
                                    : 'text-[#1C4C96] hover:bg-slate-200'
                                }`}
                                title={isEn ? 'Edit suggested YouTube link' : 'Editar link sugerido do YouTube'}
                              >
                                <Edit3 className="w-3 h-3" />
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Right: Feedback message pill & Action Buttons */}
                    <div className="flex items-center gap-2 shrink-0 self-end md:self-auto">

                      {/* Feedback message pill */}
                      {playlistFeedback?.activityId === act.id && (
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-md truncate max-w-[140px] ${
                            playlistFeedback.type === 'success'
                              ? 'bg-emerald-100 text-emerald-800'
                              : playlistFeedback.type === 'warning'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-rose-100 text-rose-800'
                          }`}
                          title={playlistFeedback.message}
                        >
                          {playlistFeedback.message}
                        </span>
                      )}

                      <div className="flex items-center gap-1 shrink-0">
                        {onEditActivity && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onEditActivity(act);
                            }}
                            className={`p-1 rounded hover:bg-white/10 cursor-pointer ${
                              isSelected ? 'text-white' : 'text-slate-400 hover:text-slate-600'
                            }`}
                            title={isEn ? 'Edit activity' : 'Editar atividade'}
                          >
                            <Edit3 className="w-3 h-3" />
                          </button>
                        )}
                        {onDeleteActivity && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onDeleteActivity(act.id);
                            }}
                            className={`p-1 rounded hover:bg-rose-500/20 cursor-pointer ${
                              isSelected ? 'text-rose-300' : 'text-slate-400 hover:text-rose-600'
                            }`}
                            title={isEn ? 'Delete activity' : 'Excluir atividade'}
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* 3. Media & Practice Row: YouTube Video Player (Left) + 5 Key Words for this Moment (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
        {/* Left: YouTube Video Player */}
        <div className="lg:col-span-6 bg-white rounded-3xl p-5 border border-[#607EC9]/30 shadow-xs space-y-3 flex flex-col justify-between">
          <div className="flex items-center justify-between border-b border-[#9AB4FF]/30 pb-2.5">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-7 h-7 rounded-lg bg-red-600 text-white flex items-center justify-center shrink-0">
                <Youtube className="w-4 h-4" />
              </div>
              <h3 className="font-black text-xs text-[#000035] truncate">
                {defaultVideoTitle}
              </h3>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {isVideoWatchedToday && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-[11px] font-extrabold bg-emerald-500/15 border border-emerald-500/40 text-emerald-800 shadow-2xs">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                  <span>{isEn ? 'Watched' : 'Assistido'}</span>
                </span>
              )}
              <span className="text-[10px] font-mono text-[#607EC9] font-bold">
                {formatToAmPm(activeActivity?.time || '07:30')}
              </span>
            </div>
          </div>

          {/* Video Iframe Container */}
          <div
            className="relative aspect-video w-full rounded-2xl overflow-hidden bg-black shadow-inner border border-slate-200"
            onClick={handleVideoPlayerInteraction}
          >
            {embedUrl ? (
              <iframe
                ref={videoIframeRef}
                src={embedUrl}
                title={defaultVideoTitle}
                className="w-full h-full border-0"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                onLoad={handleVideoIframeLoad}
              />
            ) : isRoutineLoading ? (
              <div className="w-full h-full flex flex-col items-center justify-center text-white space-y-3 p-6 text-center bg-gradient-to-b from-[#062863]/60 to-[#000035]">
                <Loader2 className="w-8 h-8 text-[#9AB4FF] animate-spin" />
                <p className="text-xs font-bold text-slate-200">
                  {isEn ? 'Loading your routine video...' : 'Carregando o vídeo da sua rotina...'}
                </p>
              </div>
            ) : isCustomWithoutVideo ? (
              <div className="w-full h-full flex flex-col items-center justify-center text-white space-y-2 p-6 text-center">
                <div className="w-12 h-12 rounded-2xl bg-red-500/20 text-red-400 flex items-center justify-center mb-1">
                  <Youtube className="w-6 h-6" />
                </div>
                <p className="text-xs font-bold text-slate-100">
                  {isEn ? 'Waiting for your YouTube suggestion' : 'Aguardando sua sugestão de vídeo do YouTube'}
                </p>
                <p className="text-[11px] text-slate-400 max-w-xs">
                  {isEn
                    ? 'Paste your YouTube link in the activity row above and click Save to embed it.'
                    : 'Cole o link do YouTube na linha da atividade acima e clique em Salvar.'}
                </p>
              </div>
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center text-white space-y-2.5 p-6 text-center bg-gradient-to-b from-[#062863]/60 to-[#000035]">
                <div className="w-12 h-12 rounded-2xl bg-[#1C4C96]/40 text-[#9AB4FF] flex items-center justify-center border border-[#9AB4FF]/20 shadow-xs mb-0.5">
                  <Sparkles className="w-6 h-6 text-[#F4CA54]" />
                </div>
                <p className="text-sm font-black text-white">
                  {isEn ? 'Choose Video for this Day' : 'Escolha um Vídeo para este Dia'}
                </p>
                <p className="text-xs text-slate-300 max-w-sm leading-relaxed">
                  {isEn
                    ? 'Select a topic from the dropdown menu above or paste your own suggestion to choose your video for this day of your routine.'
                    : 'Selecione um tópico no menu suspenso acima ou sugira seu próprio vídeo para escolher o vídeo deste dia da sua rotina.'}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Right: 5 Key Words for this Moment */}
        <div className="lg:col-span-6">
          <StudentKeyWordsCard
            isEn={isEn}
            words={words}
            wordDefinitions={wordDefinitions}
            wordsSaveFeedback={wordsSaveFeedback}
            handleWordChange={handleWordChange}
            handleSaveWords={handleSaveWords}
            speakText={speakText}
            studentLevel={userProfile?.level}
          />
        </div>
      </div>

      {/* 4. Daily Wrap-up: Sentence of the Day (Top) + Teacher's Daily Listening • Spotify (Bottom) */}
      <div className="bg-white rounded-3xl p-5 border border-[#607EC9]/30 shadow-xs space-y-4">
        <StudentDailySentenceCard
          isEn={isEn}
          reminderTime={reminderTime}
          displayRoutineWords={displayRoutineWords}
          matchedSentenceWords={matchedSentenceWords}
          sentenceInput={sentenceInput}
          sentenceSavedSuccess={sentenceSavedSuccess}
          isCheckingSentence={isCheckingSentence}
          sentenceEvaluation={sentenceEvaluation}
          onOpenJournalModal={onOpenJournalModal}
          onTest30MinReminder={onTest30MinReminder}
          setSentenceInput={setSentenceInput}
          setSentenceEvaluation={setSentenceEvaluation}
          handleApplySentenceCorrection={handleApplySentenceCorrection}
          handleCheckGrammar={handleCheckGrammar}
          handleSaveSentence={handleSaveSentence}
          speakText={speakText}
        />

        <div className="pt-2">
          <StudentSpotifyCard
            isEn={isEn}
            selectedDay={selectedDay}
            levelPlaylistConfig={levelPlaylistConfig}
            isAudioListenedToday={isAudioListenedToday}
            isRestDay={isRestDay}
            currentDayTrack={currentDayTrack}
            currentStudyDayIndex={currentStudyDayIndex}
            activeDaysInOrder={activeDaysInOrder}
            spotifyPlayerMode={spotifyPlayerMode}
            setSpotifyPlayerMode={setSpotifyPlayerMode}
            sanitizedEmbedUrl={sanitizedEmbedUrl}
            effectiveDirectUrl={effectiveDirectUrl}
            effectiveTrackTitle={effectiveTrackTitle}
            effectiveArtist={effectiveArtist}
            effectiveCoverUrl={effectiveCoverUrl}
            teacherOverride={teacherOverride}
            activeNativeFriendFeedback={activeNativeFriendFeedback}
            triggerAudioCompletion={triggerAudioCompletion}
          />
        </div>
      </div>

      {/* Start New Week Configuration Modal */}
      <StartNewWeekModal
        isOpen={isNewWeekModalOpen}
        isStarting={isStarting || isStartingNewWeek}
        onClose={() => {
          setIsStartingNewWeek(false);
          setIsNewWeekModalOpen(false);
        }}
        onConfirm={async (studyDaysTarget, selectedDays) => {
          if (!onStartNewWeek) {
            setIsStartingNewWeek(false);
            setIsNewWeekModalOpen(false);
            return;
          }
          setIsStartingNewWeek(true);
          try {
            setSelectedTopicByDay({});
            setCustomSuggestionActivities({});
            setSuggestingUrlValues({});
            setSavedTopicsBeforeRepeat({});
            try {
              if (resetRoutinesForNewWeek) {
                await resetRoutinesForNewWeek(selectedDays);
              }
            } catch (routineErr) {
              console.warn('Notice resetting routines for new week:', routineErr);
            }
            try {
              await resetRepeatFlags();
            } catch (flagErr) {
              console.warn('Notice resetting repeat flags:', flagErr);
            }
            await onStartNewWeek(studyDaysTarget, selectedDays);
          } catch (err) {
            console.warn('Error starting new week in routine guide:', err);
          } finally {
            setSelectedTopicByDay({});
            setCustomSuggestionActivities({});
            setSuggestingUrlValues({});
            setSavedTopicsBeforeRepeat({});
            setIsStartingNewWeek(false);
            setIsNewWeekModalOpen(false);
          }
        }}
        currentCycle={weeklyCycle || userProfile?.weeklyCycle || 1}
        currentLanguage={currentLanguage}
        initialStudyDaysTarget={userProfile?.weeklyStudyDaysTarget || 7}
        initialSelectedDays={userProfile?.weeklyStudyDays}
        weeklyNativeLessonsTarget={userProfile?.weeklyNativeLessonsTarget || 1}
      />
    </div>
  );
};
