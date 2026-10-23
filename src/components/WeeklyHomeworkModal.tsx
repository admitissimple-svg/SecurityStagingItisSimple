import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  X,
  BookOpen,
  CheckCircle,
  HelpCircle,
  Send,
  Sparkles,
  Volume2,
  Award,
  Clock,
  User,
  ArrowRight,
  ArrowLeft,
  Layers,
  RefreshCw,
  Check,
  AlertCircle,
  FileText,
  MessageSquare,
  Compass,
  CheckSquare,
  ChevronRight,
  Save,
} from 'lucide-react';
import {
  WeeklyHomeworkData,
  Language,
  HomeworkAiEvaluation,
  SentenceWritingPrompt,
  DayOfWeek,
  HomeworkPartProgress,
} from '../types';
import {
  checkStudentWritingApi,
  evaluateWeeklyHomeworkApi,
  isSyntheticHomeworkEvaluation,
  isValidHomeworkEvaluation,
} from '../utils/writingChecker';
import { getMemorizationTranslations } from '../utils/i18n/memorizationActivity';
import { getDailyMemorizationSchedule, generatePart4StoryWithAi } from '../utils/homeworkGenerator';
import { isBadStoryText } from '../utils/pedagogicalStorySynthesizer';
import { speakText } from '../utils/audio';

interface WeeklyHomeworkModalProps {
  isOpen: boolean;
  onClose: () => void;
  homework: WeeklyHomeworkData;
  onSaveProgress: (updatedHomework: WeeklyHomeworkData) => void;
  onSubmitToTeacher: (homework: WeeklyHomeworkData) => void;
  currentLanguage: Language;
  onRegenerateWithAi?: () => Promise<void> | void;
  isGeneratingAi?: boolean;
  t?: any;
  selectedDay?: DayOfWeek;
  activeStudyDays?: DayOfWeek[];
  weeklyCycle?: number;
  weeklyChecks?: Record<string, boolean>;
  onCompleteTodayPart?: (partKey: 'matching' | 'fill' | 'writing' | 'reading', day: DayOfWeek) => void;
  onChangeDay?: (day: DayOfWeek) => void;
  routinesByDay?: Record<DayOfWeek, any>;
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

interface MemorizationAiLoadingSkeletonProps {
  isEn: boolean;
  studentLevelDisplay: string;
  activeTab: string;
  targetDayName?: string;
  wordsCount?: number;
  titleText?: string;
  subtitleText?: string;
}

const MemorizationAiLoadingSkeleton: React.FC<MemorizationAiLoadingSkeletonProps> = ({
  isEn,
  studentLevelDisplay,
  activeTab,
  targetDayName,
  wordsCount = 5,
  titleText,
  subtitleText,
}) => {
  const displayTitle =
    titleText ||
    (isEn
      ? 'Generating your personalized activity of the day...'
      : 'Gerando sua atividade personalizada do dia...');

  const displaySubtitle =
    subtitleText ||
    (isEn
      ? 'Gemini AI is crafting an authentic mini-story, smart blank challenges, and targeted comprehension questions based on your daily vocabulary...'
      : 'Conectando seu vocabulário diário ao Gemini AI para criar uma mini-história autêntica, exercícios de lacunas inteligentes e perguntas de interpretação...');

  return (
    <div className="space-y-5 animate-fadeIn py-1">
      {/* Centered AI Generator Hero Card */}
      <div className="bg-gradient-to-br from-[#000035] via-[#062863] to-[#1C4C96] rounded-2xl p-6 sm:p-7 text-white text-center shadow-lg border border-[#607EC9]/40 relative overflow-hidden">
        {/* Soft atmospheric glowing orbs */}
        <div className="absolute -top-10 -right-10 w-44 h-44 bg-[#9AB4FF]/20 rounded-full blur-2xl pointer-events-none" />
        <div className="absolute -bottom-10 -left-10 w-44 h-44 bg-[#F4CA54]/20 rounded-full blur-2xl pointer-events-none" />

        <div className="relative z-10 flex flex-col items-center max-w-lg mx-auto space-y-3.5">
          {/* Animated Spinner with Sparkles */}
          <div className="relative flex items-center justify-center">
            <div className="w-14 h-14 rounded-full border-4 border-[#9AB4FF]/30 border-t-[#F4CA54] animate-spin" />
            <div className="absolute inset-0 flex items-center justify-center">
              <Sparkles className="w-6 h-6 text-[#9AB4FF] animate-pulse" />
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full bg-white/10 border border-white/20 text-[10px] font-extrabold text-[#F4CA54] uppercase tracking-wider">
              <Sparkles className="w-3 h-3 animate-spin" />
              <span>Gemini AI Instructional Designer</span>
            </div>
            <h3 className="text-base sm:text-lg font-black text-white">
              {displayTitle}
            </h3>
            <p className="text-xs text-[#BFDBFE] leading-relaxed max-w-md mx-auto">
              {displaySubtitle}
            </p>
          </div>

          {/* Shimmering Progress Bar */}
          <div className="w-full max-w-xs h-1.5 bg-white/15 rounded-full overflow-hidden p-0.5 border border-white/20">
            <div className="h-full bg-gradient-to-r from-[#F4CA54] via-[#9AB4FF] to-white rounded-full animate-pulse w-3/4" />
          </div>

          {/* Active session metadata tags */}
          <div className="flex flex-wrap items-center justify-center gap-2 pt-0.5 text-[10px] font-bold text-[#BFDBFE]">
            <span className="px-2.5 py-0.5 rounded-md bg-white/10 border border-white/10">
              {wordsCount} {isEn ? 'Daily Words' : 'Palavras do Dia'}
            </span>
            <span className="px-2.5 py-0.5 rounded-md bg-white/10 border border-white/10">
              {studentLevelDisplay}
            </span>
            {targetDayName && (
              <span className="px-2.5 py-0.5 rounded-md bg-white/10 border border-white/10 capitalize">
                S-Path • {targetDayName}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Elegant Skeleton Preview Cards */}
      <div className="space-y-3.5">
        {/* Story Reading Passage Skeleton */}
        <div className="p-4 sm:p-5 bg-slate-50/90 rounded-2xl border border-slate-200 space-y-3 shadow-2xs">
          <div className="flex items-center justify-between pb-2.5 border-b border-slate-200">
            <div className="space-y-1">
              <div className="h-4 w-48 sm:w-64 bg-slate-300 rounded-md animate-pulse" />
              <div className="h-3 w-32 bg-slate-200 rounded animate-pulse" />
            </div>
            <div className="h-7 w-20 bg-slate-200 rounded-lg animate-pulse" />
          </div>

          <div className="space-y-2 py-1">
            <div className="flex items-center gap-2">
              <div className="h-3.5 w-full bg-slate-200 rounded animate-pulse" />
              <div className="h-4.5 w-20 bg-blue-100 rounded-md border border-blue-200 shrink-0 animate-pulse" />
            </div>
            <div className="flex items-center gap-2">
              <div className="h-4.5 w-24 bg-blue-100 rounded-md border border-blue-200 shrink-0 animate-pulse" />
              <div className="h-3.5 w-11/12 bg-slate-200 rounded animate-pulse" />
            </div>
            <div className="h-3.5 w-4/5 bg-slate-200 rounded animate-pulse" />
            <div className="h-3.5 w-3/4 bg-slate-200 rounded animate-pulse" />
          </div>
        </div>

        {/* Question 1 Skeleton */}
        <div className="p-3.5 sm:p-4 bg-white rounded-xl border border-slate-200 space-y-2.5 shadow-2xs">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded-md bg-slate-300 animate-pulse" />
            <div className="h-3.5 w-3/4 bg-slate-200 rounded animate-pulse" />
          </div>
          <div className="grid grid-cols-1 gap-1.5 pl-7">
            <div className="h-8.5 rounded-lg bg-slate-100/80 border border-slate-200/60 animate-pulse flex items-center px-3 gap-2">
              <div className="w-4 h-4 rounded-full bg-slate-200" />
              <div className="h-3 w-1/2 bg-slate-200 rounded" />
            </div>
            <div className="h-8.5 rounded-lg bg-slate-100/80 border border-slate-200/60 animate-pulse flex items-center px-3 gap-2">
              <div className="w-4 h-4 rounded-full bg-slate-200" />
              <div className="h-3 w-2/3 bg-slate-200 rounded" />
            </div>
          </div>
        </div>

        {/* Question 2 Skeleton */}
        <div className="p-3.5 sm:p-4 bg-white rounded-xl border border-slate-200 space-y-2.5 shadow-2xs">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded-md bg-slate-300 animate-pulse" />
            <div className="h-3.5 w-2/3 bg-slate-200 rounded animate-pulse" />
          </div>
          <div className="grid grid-cols-1 gap-1.5 pl-7">
            <div className="h-8.5 rounded-lg bg-slate-100/80 border border-slate-200/60 animate-pulse flex items-center px-3 gap-2">
              <div className="w-4 h-4 rounded-full bg-slate-200" />
              <div className="h-3 w-3/5 bg-slate-200 rounded" />
            </div>
            <div className="h-8.5 rounded-lg bg-slate-100/80 border border-slate-200/60 animate-pulse flex items-center px-3 gap-2">
              <div className="w-4 h-4 rounded-full bg-slate-200" />
              <div className="h-3 w-1/3 bg-slate-200 rounded" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export const WeeklyHomeworkModal: React.FC<WeeklyHomeworkModalProps> = ({
  isOpen,
  onClose,
  homework,
  onSaveProgress,
  onSubmitToTeacher,
  currentLanguage,
  onRegenerateWithAi,
  isGeneratingAi = false,
  selectedDay,
  activeStudyDays,
  weeklyCycle = 1,
  weeklyChecks,
  onCompleteTodayPart,
  onChangeDay,
  routinesByDay,
}) => {
  const isEn = currentLanguage === 'en';
  const memT = useMemo(() => getMemorizationTranslations(currentLanguage), [currentLanguage]);

  const [internalDay, setInternalDay] = useState<DayOfWeek>(selectedDay || homework?.targetDay || 'monday');

  useEffect(() => {
    if (selectedDay) {
      setInternalDay(selectedDay);
    }
  }, [selectedDay]);

  const targetDay: DayOfWeek = selectedDay || internalDay;

  const handleSelectDay = (newDay: DayOfWeek) => {
    setInternalDay(newDay);
    const newSchedule = getDailyMemorizationSchedule(newDay, activeStudyDays, weeklyCycle || 1);
    setActiveTab(newSchedule.partKey);
    if (onChangeDay) {
      onChangeDay(newDay);
    }
  };

  const dailySchedule = useMemo(() => {
    return getDailyMemorizationSchedule(
      targetDay,
      activeStudyDays,
      weeklyCycle || 1
    );
  }, [targetDay, activeStudyDays, weeklyCycle]);

  // Accurately determine if targetDay's activity part has been completed
  const isTodayPartCompleted = Boolean(
    homework?.completedPartsByDay?.[targetDay] ||
    weeklyChecks?.[`memorization_${targetDay}`] ||
    (homework?.targetDay === targetDay && homework?.isDayPartCompleted)
  );

  // Safety timeout to prevent any stuck loading indicator if background network hangs
  const [internalGenerating, setInternalGenerating] = useState<boolean>(Boolean(isGeneratingAi));
  const [regenerateError, setRegenerateError] = useState<string | null>(null);

  // HOTFIX 2.3.5K: Contextual AI Mini-Story Generation state & auto-trigger
  const [isGeneratingPart4Story, setIsGeneratingPart4Story] = useState(false);
  const [part4StoryError, setPart4StoryError] = useState<string | null>(null);
  const autoGeneratedDaysRef = React.useRef<Record<string, boolean>>({});

  useEffect(() => {
    setInternalGenerating(Boolean(isGeneratingAi));
  }, [isGeneratingAi]);

  const handleRegenerateClick = async () => {
    if (internalGenerating || isGeneratingAi) return;
    setInternalGenerating(true);
    setRegenerateError(null);
    if (onRegenerateWithAi) {
      try {
        await onRegenerateWithAi();
      } catch (err: any) {
        console.error('Error generating homework with AI:', err);
        setRegenerateError(
          isEn
            ? 'AI service is temporarily busy. Structured pedagogical exercises loaded.'
            : 'A IA está temporariamente ocupada. Exercícios estruturados disponíveis.'
        );
      } finally {
        setInternalGenerating(false);
      }
    }
  };

  const studentLevelDisplay = useMemo(() => {
    const raw = (homework?.studentLevel || 'Beginner').toLowerCase();
    if (raw.includes('avan') || raw.includes('advan')) {
      return isEn ? 'Advanced Level' : 'Nível Avançado';
    }
    if (raw.includes('inter')) {
      return isEn ? 'Intermediate Level' : 'Nível Intermediário';
    }
    return isEn ? 'Beginner Level' : 'Nível Iniciante';
  }, [homework?.studentLevel, isEn]);

  const formattedWeekLabel = useMemo(() => {
    if (!homework?.weekLabel) return '';
    if (currentLanguage === 'en' && homework.weekLabel.startsWith('Semana de ')) {
      return homework.weekLabel.replace('Semana de ', 'Week of ');
    }
    if (currentLanguage !== 'en' && homework.weekLabel.startsWith('Week of ')) {
      return homework.weekLabel.replace('Week of ', 'Semana de ');
    }
    return homework.weekLabel;
  }, [homework?.weekLabel, currentLanguage]);

  const renderHighlightedPassage = (text: string) => {
    if (!text) return null;
    const parts = text.split(/(\*\*[^*]+\*\*)/g);
    return parts.map((part, i) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        const clean = part.slice(2, -2);
        return (
          <span
            key={i}
            className="font-extrabold text-[#000035] bg-[#9AB4FF]/25 px-1 py-0.5 rounded border border-[#9AB4FF]/40 inline-block"
          >
            {clean}
          </span>
        );
      }
      return part;
    });
  };

  const routineActivityNames = useMemo(() => {
    const set = new Set<string>();
    (homework?.vocabularyList || []).forEach((v) => {
      if (v.sourceActivityName) set.add(v.sourceActivityName);
    });
    (homework?.allRoutineWords || []).forEach((v) => {
      if (v.sourceActivityName) set.add(v.sourceActivityName);
    });
    return Array.from(set);
  }, [homework?.vocabularyList, homework?.allRoutineWords]);

  const wordToActivityMap = useMemo(() => {
    const map: Record<string, string> = {};
    (homework?.allRoutineWords || []).forEach((item) => {
      if (item.word) map[item.word.toLowerCase()] = item.sourceActivityName || '';
    });
    (homework?.vocabularyList || []).forEach((item) => {
      if (item.word && !map[item.word.toLowerCase()]) {
        map[item.word.toLowerCase()] = item.sourceActivityName || '';
      }
    });
    return map;
  }, [homework?.allRoutineWords, homework?.vocabularyList]);

  const hasGenuineEvaluation = Boolean(
    homework?.aiEvaluation &&
    isValidHomeworkEvaluation(homework.aiEvaluation) &&
    !isSyntheticHomeworkEvaluation(homework.aiEvaluation)
  );

  const [activeTab, setActiveTab] = useState<'matching' | 'fill' | 'writing' | 'reading'>(
    dailySchedule.partKey
  );

  const [matchingAnswers, setMatchingAnswers] = useState<Record<string, string>>(
    homework?.studentAnswers?.matching || {}
  );
  const [fillAnswers, setFillAnswers] = useState<Record<string, string>>(
    homework?.studentAnswers?.fillInBlanks || {}
  );
  const [sentenceAnswers, setSentenceAnswers] = useState<Record<string, string>>(
    homework?.studentAnswers?.sentences || {}
  );
  const [quizAnswers, setQuizAnswers] = useState<Record<string, number>>(
    homework?.studentAnswers?.quizAnswers || {}
  );

  const [partsProgress, setPartsProgress] = useState<NonNullable<WeeklyHomeworkData['partsProgress']>>(() => {
    return homework?.partsProgress || {};
  });
  const [isSavingPart, setIsSavingPart] = useState<Record<string, boolean>>({
    matching: false,
    fill: false,
    writing: false,
    reading: false,
  });

  const [aiEvaluation, setAiEvaluation] = useState<HomeworkAiEvaluation | undefined>(
    hasGenuineEvaluation ? homework?.aiEvaluation : undefined
  );
  const [isEvaluatingAll, setIsEvaluatingAll] = useState(false);
  const [evalError, setEvalError] = useState<string | null>(null);

  const activeDayActivity = homework?.dailyActivities?.[targetDay];

  React.useEffect(() => {
    const dayAnswers =
      activeDayActivity?.studentAnswers ||
      (homework?.targetDay === targetDay ? homework?.studentAnswers : undefined) ||
      {};

    setMatchingAnswers(dayAnswers.matching || {});
    setFillAnswers(dayAnswers.fillInBlanks || {});
    setSentenceAnswers(dayAnswers.sentences || {});
    setQuizAnswers(dayAnswers.quizAnswers || {});

    const dayParts =
      activeDayActivity?.partsProgress ||
      (homework?.targetDay === targetDay ? homework?.partsProgress : undefined) ||
      {};
    setPartsProgress(dayParts);

    const dayEval =
      activeDayActivity?.aiEvaluation ||
      (homework?.targetDay === targetDay ? homework?.aiEvaluation : undefined);

    if (dayEval && isValidHomeworkEvaluation(dayEval) && !isSyntheticHomeworkEvaluation(dayEval)) {
      setAiEvaluation(dayEval);
      const feedbackList = dayEval.sentenceFeedback;
      // Restore sentence answers from sentenceFeedback if not already present
      if (Array.isArray(feedbackList) && feedbackList.length > 0) {
        setSentenceAnswers((prev) => {
          const next = { ...prev };
          feedbackList.forEach((sf: any) => {
            if (sf?.word && sf?.originalSentence && !next[sf.word]) {
              next[sf.word] = sf.originalSentence;
            }
          });
          return next;
        });
      }
    } else {
      setAiEvaluation(undefined);
    }
  }, [targetDay, homework?.id, activeDayActivity?.updatedAt]);

  // Synchronize student answers with parent state and Cloud Firestore
  const lastSavedJsonRef = React.useRef<string>('');

  React.useEffect(() => {
    if (!isOpen || !onSaveProgress) return;

    const hasAnyAnswers =
      Object.keys(matchingAnswers).length > 0 ||
      Object.keys(fillAnswers).length > 0 ||
      Object.keys(sentenceAnswers).length > 0 ||
      Object.keys(quizAnswers).length > 0;

    if (!hasAnyAnswers) return;

    // HOTFIX 2.3.1: Always preserve existing evaluation, score, and completed status in autosave!
    const effectiveEvaluation = aiEvaluation || homework?.aiEvaluation;
    const effectiveScore = (effectiveEvaluation ? effectiveEvaluation.overallScore : homework?.score) ?? 0;
    const effectiveIsCompleted = Boolean((effectiveEvaluation && effectiveScore > 0) || homework?.isCompleted);

    const currentDaily = { ...(homework.dailyActivities || {}) };
    currentDaily[targetDay] = {
      ...(currentDaily[targetDay] || {}),
      id: currentDaily[targetDay]?.id || `hw-${targetDay}-${weeklyCycle || 1}`,
      day: targetDay,
      weeklyCycle: weeklyCycle || 1,
      studentUid: homework.studentUid || '',
      selectedWords: activeDayActivity?.selectedWords || homework.vocabularyList || [],
      wordOrigins: activeDayActivity?.wordOrigins || [],
      matchingPairs: activeDayActivity?.matchingPairs || homework.matchingPairs || [],
      fillInBlanks: activeDayActivity?.fillInBlanks || homework.fillInBlanks || [],
      sentenceWritingPrompts: activeDayActivity?.sentenceWritingPrompts || homework.sentenceWritingPrompts || [],
      readingPassage: activeDayActivity?.readingPassage || homework.readingPassage,
      studentAnswers: {
        matching: matchingAnswers,
        fillInBlanks: fillAnswers,
        sentences: sentenceAnswers,
        quizAnswers: quizAnswers,
      },
      partsProgress,
      aiEvaluation: effectiveEvaluation,
      score: effectiveScore,
      isCompleted: Boolean(effectiveIsCompleted || homework?.completedPartsByDay?.[targetDay]),
      isStarted: true,
      updatedAt: new Date().toISOString(),
    };

    const updatedHw: WeeklyHomeworkData = {
      ...homework,
      targetDay,
      studentAnswers: {
        matching: matchingAnswers,
        fillInBlanks: fillAnswers,
        sentences: sentenceAnswers,
        quizAnswers: quizAnswers,
      },
      partsProgress,
      aiEvaluation: effectiveEvaluation,
      score: effectiveScore,
      isCompleted: effectiveIsCompleted,
      dailyActivities: currentDaily,
    };

    const currentJson = JSON.stringify({ targetDay, answers: updatedHw.studentAnswers });
    if (currentJson === lastSavedJsonRef.current) return;

    const timer = setTimeout(() => {
      lastSavedJsonRef.current = currentJson;
      onSaveProgress(updatedHw);
    }, 500);

    return () => clearTimeout(timer);
  }, [matchingAnswers, fillAnswers, sentenceAnswers, quizAnswers, partsProgress, isOpen, homework, onSaveProgress, aiEvaluation, targetDay, weeklyCycle]);

  // Track initial tab selection when modal opens
  const wasOpenRef = React.useRef(false);
  React.useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      wasOpenRef.current = true;
      setActiveTab(dailySchedule.partKey);
    } else if (!isOpen) {
      wasOpenRef.current = false;
    }
  }, [isOpen, homework?.id, dailySchedule.partKey, selectedDay, homework?.isCompleted, hasGenuineEvaluation]);

  // HOTFIX 2.3.5K: Contextual AI Mini-Story Generator (Part 4 Only)
  const handleGeneratePart4Story = useCallback(
    async (forceRetry = false) => {
      const curDaily = homework?.dailyActivities?.[targetDay];
      const wordsList = curDaily?.selectedWords || homework?.vocabularyList || [];
      const cleanWords = wordsList.map((w) => w.word).filter(Boolean);
      if (cleanWords.length === 0) return;

      const hasAnyAnswers =
        (quizAnswers && Object.keys(quizAnswers).length > 0) ||
        (curDaily?.studentAnswers?.quizAnswers && Object.keys(curDaily.studentAnswers.quizAnswers).length > 0) ||
        partsProgress.reading?.status === 'completed' ||
        curDaily?.partsProgress?.reading?.status === 'completed';

      if (hasAnyAnswers && !forceRetry) {
        return;
      }

      const currentPassage = curDaily?.readingPassage || homework?.readingPassage;
      const hasValidAiStory = Boolean(
        currentPassage?.text &&
        currentPassage?.isAiGenerated &&
        !isBadStoryText(currentPassage.text) &&
        Array.isArray(currentPassage.questions) &&
        currentPassage.questions.length >= 2
      );

      if (hasValidAiStory && !forceRetry) {
        return;
      }

      // Extract videoContext for the targetDay without inventing scenes
      const dayRoutines = routinesByDay?.[targetDay] || [];
      let foundVideo: any = null;
      for (const item of dayRoutines) {
        if (Array.isArray(item?.teacherVideos) && item.teacherVideos.length > 0) {
          foundVideo = item.teacherVideos[0];
          break;
        }
      }

      const videoContext = foundVideo
        ? {
            title: foundVideo.title,
            theme: foundVideo.instructions || foundVideo.category,
            description: foundVideo.instructions,
            videoId: foundVideo.videoId,
          }
        : undefined;

      setIsGeneratingPart4Story(true);
      setPart4StoryError(null);

      const activeDayKey = targetDay;
      const activeCycleNum = weeklyCycle || 1;

      try {
        const generatedPassage = await generatePart4StoryWithAi({
          words: cleanWords,
          studentLevel: homework.studentLevel || 'Intermediate',
          studentName: homework.studentName || 'Student',
          studentUid: homework.studentUid,
          studentEmail: homework.studentEmail,
          wordDetails: wordsList,
          targetDay: activeDayKey,
          weeklyCycle: activeCycleNum,
          videoContext,
        });

        if (!generatedPassage || !generatedPassage.text || isBadStoryText(generatedPassage.text)) {
          throw new Error(
            isEn
              ? 'The contextual mini-story could not be generated by Gemini AI at this time. Contingency models were checked without fallback to synthetic text. Please click "Try Again with Gemini AI" to retry.'
              : 'A mini-história contextualizada não pôde ser gerada pela IA Gemini neste momento. Modelos de contingência foram verificados sem recorrer a textos sintéticos genéricos. Por favor, clique em "Tentar Novamente com Gemini AI".'
          );
        }

        const currentDaily = { ...(homework.dailyActivities || {}) };
        currentDaily[activeDayKey] = {
          ...(currentDaily[activeDayKey] || {}),
          id: currentDaily[activeDayKey]?.id || `hw-${activeDayKey}-${activeCycleNum}`,
          day: activeDayKey,
          weeklyCycle: activeCycleNum,
          studentUid: homework.studentUid || '',
          selectedWords: wordsList,
          wordOrigins: currentDaily[activeDayKey]?.wordOrigins || [],
          matchingPairs: currentDaily[activeDayKey]?.matchingPairs || homework.matchingPairs || [],
          fillInBlanks: currentDaily[activeDayKey]?.fillInBlanks || homework.fillInBlanks || [],
          sentenceWritingPrompts: currentDaily[activeDayKey]?.sentenceWritingPrompts || homework.sentenceWritingPrompts || [],
          readingPassage: generatedPassage,
          studentAnswers: {
            ...(currentDaily[activeDayKey]?.studentAnswers || {}),
            ...homework.studentAnswers,
            matching: matchingAnswers,
            fillInBlanks: fillAnswers,
            sentences: sentenceAnswers,
            quizAnswers: quizAnswers,
          },
          partsProgress,
          aiEvaluation,
          score: homework.score || 0,
          isCompleted: Boolean(homework.isCompleted),
          isStarted: Boolean((homework as any).isStarted || Object.keys(quizAnswers).length > 0),
          updatedAt: new Date().toISOString(),
        };

        const updatedHw: WeeklyHomeworkData = {
          ...homework,
          targetDay: activeDayKey,
          readingPassage: generatedPassage,
          dailyActivities: currentDaily,
        };

        onSaveProgress(updatedHw);
      } catch (err: any) {
        console.warn('Part 4 Gemini story generation failed:', err);
        setPart4StoryError(
          err?.message ||
            (isEn
              ? 'Story generation is temporarily unavailable. Please click "Try Again with Gemini AI".'
              : 'Geração da história temporariamente indisponível. Por favor, clique em "Tentar Novamente com Gemini AI".')
        );
      } finally {
        setIsGeneratingPart4Story(false);
      }
    },
    [
      homework,
      targetDay,
      weeklyCycle,
      routinesByDay,
      matchingAnswers,
      fillAnswers,
      sentenceAnswers,
      quizAnswers,
      partsProgress,
      aiEvaluation,
      onSaveProgress,
      isEn,
    ]
  );

  // Auto-trigger Gemini story generation when Part 4 is opened or active and has no valid AI story
  useEffect(() => {
    if (!isOpen) return;
    const isPart4Active = activeTab === 'reading' || dailySchedule.partKey === 'reading';
    if (!isPart4Active) return;

    const curDaily = homework?.dailyActivities?.[targetDay];
    const hasAnswered =
      (quizAnswers && Object.keys(quizAnswers).length > 0) ||
      (curDaily?.studentAnswers?.quizAnswers && Object.keys(curDaily.studentAnswers.quizAnswers).length > 0) ||
      partsProgress.reading?.status === 'completed';

    if (hasAnswered) return;

    const currentPassage = curDaily?.readingPassage || homework?.readingPassage;
    const hasValidStory = Boolean(
      currentPassage?.text &&
      currentPassage?.isAiGenerated &&
      !isBadStoryText(currentPassage.text) &&
      Array.isArray(currentPassage.questions) &&
      currentPassage.questions.length >= 2
    );

    const dayCycleKey = `${targetDay}-${weeklyCycle || 1}`;
    if (!hasValidStory && !autoGeneratedDaysRef.current[dayCycleKey] && !isGeneratingPart4Story) {
      autoGeneratedDaysRef.current[dayCycleKey] = true;
      handleGeneratePart4Story(false);
    }
  }, [
    isOpen,
    activeTab,
    dailySchedule.partKey,
    targetDay,
    weeklyCycle,
    homework,
    quizAnswers,
    partsProgress.reading?.status,
    isGeneratingPart4Story,
    handleGeneratePart4Story,
  ]);

  const [sentenceFeedbacks, setSentenceFeedbacks] = useState<Record<string, any>>({});
  const [isCheckingSentence, setIsCheckingSentence] = useState<Record<string, boolean>>({});
  const [submittedFeedbackToast, setSubmittedFeedbackToast] = useState<string | null>(null);

  // Check if each individual part has all questions answered
  const isMatchingComplete = useMemo(() => {
    if (!homework.matchingPairs || homework.matchingPairs.length === 0) return false;
    return homework.matchingPairs.every((pair) => Boolean(matchingAnswers[pair.id]));
  }, [homework.matchingPairs, matchingAnswers]);

  const isFillComplete = useMemo(() => {
    if (!homework.fillInBlanks || homework.fillInBlanks.length === 0) return false;
    return homework.fillInBlanks.every((item) => Boolean(fillAnswers[item.id]));
  }, [homework.fillInBlanks, fillAnswers]);

  const isWritingComplete = useMemo(() => {
    if (!homework.sentenceWritingPrompts || homework.sentenceWritingPrompts.length === 0) return false;
    return homework.sentenceWritingPrompts.every((p) => {
      const val =
        sentenceAnswers[p.word] ||
        sentenceAnswers[p.word.trim()] ||
        sentenceAnswers[p.word.toUpperCase()] ||
        sentenceAnswers[p.word.toLowerCase()] ||
        '';
      const hasFeedback = Boolean(
        sentenceFeedbacks[p.word] ||
        sentenceFeedbacks[p.word.toUpperCase()] ||
        sentenceFeedbacks[p.word.toLowerCase()]
      );
      return val.trim().length >= 3 || hasFeedback;
    });
  }, [homework.sentenceWritingPrompts, sentenceAnswers, sentenceFeedbacks]);

  const isReadingComplete = useMemo(() => {
    if (!homework.readingPassage?.questions || homework.readingPassage.questions.length === 0) return false;
    return homework.readingPassage.questions.every((q) => quizAnswers[q.id] !== undefined);
  }, [homework.readingPassage?.questions, quizAnswers]);

  // Check if today's scheduled part has been answered
  const isPartAnswersComplete = useMemo(() => {
    switch (dailySchedule.partKey) {
      case 'matching':
        return isMatchingComplete;
      case 'fill':
        return isFillComplete;
      case 'writing':
        return isWritingComplete;
      case 'reading':
        return isReadingComplete;
      default:
        return false;
    }
  }, [dailySchedule.partKey, isMatchingComplete, isFillComplete, isWritingComplete, isReadingComplete]);

  // Check if the currently viewed active tab has been completed
  const isCurrentActiveTabComplete = useMemo(() => {
    switch (activeTab) {
      case 'matching':
        return isMatchingComplete;
      case 'fill':
        return isFillComplete;
      case 'writing':
        return isWritingComplete;
      case 'reading':
        return isReadingComplete;
      default:
        return false;
    }
  }, [activeTab, isMatchingComplete, isFillComplete, isWritingComplete, isReadingComplete]);

  // Per-part completion indicators
  const isPart1Completed = Boolean(
    partsProgress.matching?.status === 'completed' ||
    (dailySchedule.partKey === 'matching' && isTodayPartCompleted)
  );
  const isPart2Completed = Boolean(
    partsProgress.fill?.status === 'completed' ||
    (dailySchedule.partKey === 'fill' && isTodayPartCompleted)
  );
  const isPart3Completed = Boolean(
    partsProgress.writing?.status === 'completed' ||
    (hasGenuineEvaluation && isWritingComplete) ||
    (dailySchedule.partKey === 'writing' && isTodayPartCompleted)
  );
  const isPart4Completed = Boolean(
    partsProgress.reading?.status === 'completed' ||
    (dailySchedule.partKey === 'reading' && isTodayPartCompleted)
  );

  // Event-driven helper to synchronously mark S-Path completed and persist to state/DB
  // Strictly records completion for the selected day executed, preserving rotation of parts
  const markSPathCompleted = useCallback(
    (day: DayOfWeek, partKey: string, updatedPartsProgress?: WeeklyHomeworkData['partsProgress']) => {
      const effectiveEvaluation = aiEvaluation || homework?.aiEvaluation;
      const effectiveScore = (effectiveEvaluation ? effectiveEvaluation.overallScore : homework?.score) ?? 0;
      const effectivePartsProgress = updatedPartsProgress || partsProgress || homework?.partsProgress || {};

      const allFourDone = Boolean(
        effectivePartsProgress.matching?.status === 'completed' &&
        effectivePartsProgress.fill?.status === 'completed' &&
        effectivePartsProgress.writing?.status === 'completed' &&
        effectivePartsProgress.reading?.status === 'completed'
      );

      const currentDaily = { ...(homework?.dailyActivities || {}) };
      currentDaily[day] = {
        ...(currentDaily[day] || {}),
        id: currentDaily[day]?.id || `hw-${day}-${weeklyCycle || 1}`,
        day: day,
        weeklyCycle: weeklyCycle || 1,
        studentUid: homework?.studentUid || '',
        selectedWords: activeDayActivity?.selectedWords || homework?.vocabularyList || [],
        wordOrigins: activeDayActivity?.wordOrigins || [],
        matchingPairs: activeDayActivity?.matchingPairs || homework?.matchingPairs || [],
        fillInBlanks: activeDayActivity?.fillInBlanks || homework?.fillInBlanks || [],
        sentenceWritingPrompts: activeDayActivity?.sentenceWritingPrompts || homework?.sentenceWritingPrompts || [],
        readingPassage: activeDayActivity?.readingPassage || homework?.readingPassage,
        studentAnswers: {
          matching: { ...(homework?.studentAnswers?.matching || {}), ...matchingAnswers },
          fillInBlanks: { ...(homework?.studentAnswers?.fillInBlanks || {}), ...fillAnswers },
          sentences: { ...(homework?.studentAnswers?.sentences || {}), ...sentenceAnswers },
          quizAnswers: { ...(homework?.studentAnswers?.quizAnswers || {}), ...quizAnswers },
        },
        partsProgress: effectivePartsProgress,
        aiEvaluation: effectiveEvaluation,
        score: effectiveScore,
        isCompleted: true,
        isStarted: true,
        updatedAt: new Date().toISOString(),
      };

      const updated: WeeklyHomeworkData = {
        ...homework,
        targetDay: day,
        isDayPartCompleted: true,
        completedPartsByDay: {
          ...(homework?.completedPartsByDay || {}),
          [day]: true,
        },
        studentAnswers: {
          matching: { ...(homework?.studentAnswers?.matching || {}), ...matchingAnswers },
          fillInBlanks: { ...(homework?.studentAnswers?.fillInBlanks || {}), ...fillAnswers },
          sentences: { ...(homework?.studentAnswers?.sentences || {}), ...sentenceAnswers },
          quizAnswers: { ...(homework?.studentAnswers?.quizAnswers || {}), ...quizAnswers },
        },
        partsProgress: effectivePartsProgress,
        aiEvaluation: effectiveEvaluation,
        score: effectiveScore,
        isCompleted: allFourDone || Boolean(homework?.isCompleted),
        dailyActivities: currentDaily,
      };

      onSaveProgress(updated);
      if (onCompleteTodayPart) {
        onCompleteTodayPart(partKey as any, day);
      }
    },
    [homework, matchingAnswers, fillAnswers, sentenceAnswers, quizAnswers, onSaveProgress, onCompleteTodayPart, aiEvaluation, partsProgress, weeklyCycle, activeDayActivity]
  );

  // Dedicated Save Handlers per part
  const handleSavePart1 = async () => {
    const pairsList = homework.matchingPairs || [];
    if (!isMatchingComplete) {
      setSubmittedFeedbackToast(
        isEn
          ? `Please match all ${pairsList.length} words before saving Part 1.`
          : `Por favor, associe todas as ${pairsList.length} palavras antes de salvar a Parte 1.`
      );
      setTimeout(() => setSubmittedFeedbackToast(null), 3500);
      return;
    }

    setIsSavingPart((prev) => ({ ...prev, matching: true }));
    try {
      const total = pairsList.length;
      const correct = pairsList.filter((pair) => {
        const safeKey = pair.word ? pair.word.toLowerCase().replace(/[^a-z0-9]/g, '_') : '';
        const userAns = matchingAnswers[pair.id] || (safeKey ? matchingAnswers[`match-${safeKey}`] : '') || matchingAnswers[pair.word] || '';
        return userAns.trim().toLowerCase() === pair.word.toLowerCase();
      }).length;
      const score = total > 0 ? Math.round((correct / total) * 100) : 100;

      const updatedPart: HomeworkPartProgress = {
        partKey: 'matching',
        partNumber: 1,
        status: 'completed',
        answers: matchingAnswers,
        score,
        completedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const nextPartsProgress = {
        ...partsProgress,
        matching: updatedPart,
      };
      setPartsProgress(nextPartsProgress);

      markSPathCompleted(targetDay, 'matching', nextPartsProgress);

      setSubmittedFeedbackToast(
        isEn
          ? '🎉 Part 1 saved and recorded on S-Path!'
          : '🎉 Parte 1 salva e gravada no S-Path com sucesso!'
      );
      setTimeout(() => setSubmittedFeedbackToast(null), 3500);
    } finally {
      setIsSavingPart((prev) => ({ ...prev, matching: false }));
    }
  };

  const handleSavePart2 = async () => {
    const fillList = homework.fillInBlanks || [];
    if (!isFillComplete) {
      setSubmittedFeedbackToast(
        isEn
          ? `Please answer all ${fillList.length} blank questions before saving Part 2.`
          : `Por favor, preencha todas as ${fillList.length} lacunas antes de salvar a Parte 2.`
      );
      setTimeout(() => setSubmittedFeedbackToast(null), 3500);
      return;
    }

    setIsSavingPart((prev) => ({ ...prev, fill: true }));
    try {
      const total = fillList.length;
      const correct = fillList.filter((fill) => {
        const safeKey = fill.correctWord ? fill.correctWord.toLowerCase().replace(/[^a-z0-9]/g, '_') : '';
        const userAns = fillAnswers[fill.id] || (safeKey ? fillAnswers[`fill-${safeKey}`] : '') || fillAnswers[fill.correctWord] || '';
        return userAns.trim().toLowerCase() === fill.correctWord.toLowerCase();
      }).length;
      const score = total > 0 ? Math.round((correct / total) * 100) : 100;

      const updatedPart: HomeworkPartProgress = {
        partKey: 'fill',
        partNumber: 2,
        status: 'completed',
        answers: fillAnswers,
        score,
        completedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const nextPartsProgress = {
        ...partsProgress,
        fill: updatedPart,
      };
      setPartsProgress(nextPartsProgress);

      markSPathCompleted(targetDay, 'fill', nextPartsProgress);

      setSubmittedFeedbackToast(
        isEn
          ? '🎉 Part 2 saved and recorded on S-Path!'
          : '🎉 Parte 2 salva e gravada no S-Path com sucesso!'
      );
      setTimeout(() => setSubmittedFeedbackToast(null), 3500);
    } finally {
      setIsSavingPart((prev) => ({ ...prev, fill: false }));
    }
  };
  const handleSavePart3 = async () => {
    const promptList = homework.sentenceWritingPrompts || [];
    if (!isWritingComplete) {
      setSubmittedFeedbackToast(
        isEn
          ? `Please write your sentences for all ${promptList.length} words before saving Part 3.`
          : `Por favor, escreva suas frases para todas as ${promptList.length} palavras antes de salvar a Parte 3.`
      );
      setTimeout(() => setSubmittedFeedbackToast(null), 3500);
      return;
    }

    setIsSavingPart((prev) => ({ ...prev, writing: true }));
    setEvalError(null);

    // 1. Immediately persist typed student answers to Firestore so they are never lost
    const inProgressPart: HomeworkPartProgress = {
      partKey: 'writing',
      partNumber: 3,
      status: 'pending_evaluation',
      answers: sentenceAnswers,
      updatedAt: new Date().toISOString(),
    };
    const inProgressParts = {
      ...partsProgress,
      writing: inProgressPart,
    };
    setPartsProgress(inProgressParts);

    const inProgressUpdate: WeeklyHomeworkData = {
      ...homework,
      studentAnswers: {
        ...(homework.studentAnswers || {}),
        matching: matchingAnswers,
        fillInBlanks: fillAnswers,
        sentences: sentenceAnswers,
        quizAnswers: quizAnswers,
      },
      partsProgress: inProgressParts,
    };
    onSaveProgress(inProgressUpdate);

    // 2. Check if an authentic, genuine evaluation already exists and matches current student sentences
    const activeEval = aiEvaluation || homework?.aiEvaluation;
    const existingIsLegitimate = Boolean(
      activeEval &&
      isValidHomeworkEvaluation(activeEval) &&
      !isSyntheticHomeworkEvaluation(activeEval) &&
      (homework.sentenceWritingPrompts || []).every((p) => {
        const studentSentence = (
          sentenceAnswers[p.word] ||
          sentenceAnswers[p.word.trim()] ||
          sentenceAnswers[p.word.toLowerCase()] ||
          ''
        ).trim().toLowerCase();
        const sentencesList = activeEval?.sentenceFeedback || (activeEval as any)?.sentenceEvaluationResults || [];
        const evaluatedItem = sentencesList.find(
          (r: any) => (r.word || '').toLowerCase() === p.word.toLowerCase()
        );
        const evaluatedSentence = (evaluatedItem?.originalSentence || '').trim().toLowerCase();
        return studentSentence === evaluatedSentence || (!studentSentence && Boolean(evaluatedSentence));
      })
    );

    if (existingIsLegitimate && activeEval) {
      setAiEvaluation(activeEval);
      const completedPart: HomeworkPartProgress = {
        partKey: 'writing',
        partNumber: 3,
        status: 'completed',
        answers: sentenceAnswers,
        evaluation: activeEval,
        score: activeEval.overallScore,
        completedAt: activeEval.evaluatedAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const finalParts = { ...partsProgress, writing: completedPart };
      setPartsProgress(finalParts);

      markSPathCompleted(targetDay, 'writing', finalParts);

      setSubmittedFeedbackToast(
        isEn
          ? '🎉 Part 3 evaluation verified and recorded on S-Path!'
          : '🎉 Avaliação da Parte 3 verificada e gravada no S-Path!'
      );
      setTimeout(() => setSubmittedFeedbackToast(null), 3500);
      setIsSavingPart((prev) => ({ ...prev, writing: false }));
      return;
    }

    // 3. Request genuine AI evaluation from server endpoint (which runs 3-model Gemini contingency)
    try {
      const currentAnswers = {
        matching: matchingAnswers,
        fillInBlanks: fillAnswers,
        sentences: sentenceAnswers,
        quizAnswers: quizAnswers,
      };

      const evalResult = await evaluateWeeklyHomeworkApi({
        homework,
        studentAnswers: currentAnswers,
        studentLevel: homework.studentLevel || 'Beginner',
        studentName: homework.studentName || 'Student',
        currentLanguage,
      });

      if (!evalResult || !isValidHomeworkEvaluation(evalResult) || isSyntheticHomeworkEvaluation(evalResult)) {
        throw new Error(
          isEn
            ? 'The pedagogical evaluation could not be completed at this moment. No synthetic scores have been created.'
            : 'A correção pedagógica não pôde ser concluída neste momento. Nenhuma pontuação sintética foi gerada.'
        );
      }

      setAiEvaluation(evalResult);

      const completedPart: HomeworkPartProgress = {
        partKey: 'writing',
        partNumber: 3,
        status: 'completed',
        answers: sentenceAnswers,
        evaluation: evalResult,
        score: evalResult.overallScore,
        completedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const finalParts = { ...partsProgress, writing: completedPart };
      setPartsProgress(finalParts);

      markSPathCompleted(targetDay, 'writing', finalParts);

      setSubmittedFeedbackToast(
        isEn
          ? '🎉 Part 3 evaluated by AI and recorded on S-Path!'
          : '🎉 Parte 3 corrigida pela IA e gravada no S-Path com sucesso!'
      );
      setTimeout(() => setSubmittedFeedbackToast(null), 3500);
    } catch (err: any) {
      console.warn('AI evaluation error in Part 3, preserving sentences in Firestore with status pending_evaluation:', err);
      const friendlyMsg =
        err?.message ||
        (isEn
          ? 'The pedagogical grading AI is temporarily unavailable after checking contingency models. Your sentences have been safely preserved in Firestore. Please click "Retry Evaluation" to try again.'
          : 'A IA de correção pedagógica está temporariamente indisponível após verificação dos modelos de contingência. Suas frases foram salvas no Firestore. Por favor, clique em "Tentar Novamente".');
      setEvalError(friendlyMsg);
    } finally {
      setIsSavingPart((prev) => ({ ...prev, writing: false }));
    }
  };

  const handleSavePart4 = async () => {
    const questionsList = homework.readingPassage?.questions || [];
    if (!isReadingComplete) {
      setSubmittedFeedbackToast(
        isEn
          ? `Please answer all ${questionsList.length} comprehension questions before saving Part 4.`
          : `Por favor, responda todas as ${questionsList.length} perguntas de compreensão antes de salvar a Parte 4.`
      );
      setTimeout(() => setSubmittedFeedbackToast(null), 3500);
      return;
    }

    setIsSavingPart((prev) => ({ ...prev, reading: true }));
    setEvalError(null);

    // 1. Immediately persist typed student answers to Firestore so they are never lost
    const inProgressPart: HomeworkPartProgress = {
      partKey: 'reading',
      partNumber: 4,
      status: 'pending_evaluation',
      answers: quizAnswers,
      updatedAt: new Date().toISOString(),
    };
    const inProgressParts = {
      ...partsProgress,
      reading: inProgressPart,
    };
    setPartsProgress(inProgressParts);

    const inProgressUpdate: WeeklyHomeworkData = {
      ...homework,
      studentAnswers: {
        ...(homework.studentAnswers || {}),
        matching: matchingAnswers,
        fillInBlanks: fillAnswers,
        sentences: sentenceAnswers,
        quizAnswers: quizAnswers,
      },
      partsProgress: inProgressParts,
    };
    onSaveProgress(inProgressUpdate);

    // 2. Check if an authentic, genuine evaluation already exists matching current answers
    const activeEval = aiEvaluation || homework?.aiEvaluation;
    const existingReadingMatches = Boolean(
      activeEval &&
      isValidHomeworkEvaluation(activeEval) &&
      !isSyntheticHomeworkEvaluation(activeEval) &&
      Array.isArray(activeEval.readingFeedback) &&
      activeEval.readingFeedback.length === questionsList.length &&
      questionsList.every((q: any, idx: number) => {
        const chosen = quizAnswers[q.id] !== undefined ? quizAnswers[q.id] : quizAnswers[String(idx)];
        return chosen !== undefined && chosen !== null;
      })
    );

    if (existingReadingMatches && activeEval) {
      setAiEvaluation(activeEval);
      const totalQ = Math.max(1, questionsList.length);
      const readingScore = activeEval.readingFeedback
        ? Math.round((activeEval.readingFeedback.filter((r: any) => r.isCorrect).length / totalQ) * 100)
        : 100;

      const completedPart: HomeworkPartProgress = {
        partKey: 'reading',
        partNumber: 4,
        status: 'completed',
        answers: quizAnswers,
        evaluation: activeEval,
        score: readingScore,
        completedAt: activeEval.evaluatedAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const finalParts = { ...partsProgress, reading: completedPart };
      setPartsProgress(finalParts);

      markSPathCompleted(targetDay, 'reading', finalParts);

      setSubmittedFeedbackToast(
        isEn
          ? '🎉 Part 4 evaluation verified and recorded on S-Path!'
          : '🎉 Avaliação da Parte 4 verificada e gravada no S-Path!'
      );
      setTimeout(() => setSubmittedFeedbackToast(null), 3500);
      setIsSavingPart((prev) => ({ ...prev, reading: false }));
      return;
    }

    // 3. Request genuine AI evaluation from server endpoint (Gemini 3-model contingency)
    try {
      const currentAnswers = {
        matching: matchingAnswers,
        fillInBlanks: fillAnswers,
        sentences: sentenceAnswers,
        quizAnswers: quizAnswers,
      };

      const evalResult = await evaluateWeeklyHomeworkApi({
        homework,
        studentAnswers: currentAnswers,
        studentLevel: homework.studentLevel || 'Beginner',
        studentName: homework.studentName || 'Student',
        currentLanguage,
      });

      if (!evalResult || !isValidHomeworkEvaluation(evalResult) || isSyntheticHomeworkEvaluation(evalResult)) {
        throw new Error(
          isEn
            ? 'The pedagogical evaluation could not be completed at this moment. No synthetic scores have been created.'
            : 'A correção pedagógica não pôde ser concluída neste momento. Nenhuma pontuação sintética foi gerada.'
        );
      }

      setAiEvaluation(evalResult);

      const totalQ = Math.max(1, questionsList.length);
      const readingScore = Array.isArray(evalResult.readingFeedback) && totalQ > 0
        ? Math.round((evalResult.readingFeedback.filter((r: any) => r.isCorrect).length / totalQ) * 100)
        : 100;

      const completedPart: HomeworkPartProgress = {
        partKey: 'reading',
        partNumber: 4,
        status: 'completed',
        answers: quizAnswers,
        evaluation: evalResult,
        score: readingScore,
        completedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const finalParts = { ...partsProgress, reading: completedPart };
      setPartsProgress(finalParts);

      markSPathCompleted(targetDay, 'reading', finalParts);

      // Check if all 4 parts are now completed
      const allPartsCompleted = Boolean(
        finalParts.matching?.status === 'completed' &&
        finalParts.fill?.status === 'completed' &&
        finalParts.writing?.status === 'completed' &&
        finalParts.reading?.status === 'completed'
      );

      if (allPartsCompleted) {
        const s1 = finalParts.matching?.score ?? 100;
        const s2 = finalParts.fill?.score ?? 100;
        const s3 = finalParts.writing?.score ?? (evalResult.overallScore ?? 100);
        const s4 = readingScore;
        const overallScore = Math.round((s1 * 0.2) + (s2 * 0.25) + (s3 * 0.35) + (s4 * 0.2));

        const fullHw: WeeklyHomeworkData = {
          ...homework,
          partsProgress: finalParts,
          studentAnswers: currentAnswers,
          aiEvaluation: evalResult,
          isCompleted: true,
          score: overallScore,
          submittedAt: homework.submittedAt || new Date().toISOString(),
        };
        onSaveProgress(fullHw);
      }

      setSubmittedFeedbackToast(
        isEn
          ? '🎉 Part 4 evaluated by AI and recorded on S-Path!'
          : '🎉 Parte 4 corrigida pela IA e gravada no S-Path com sucesso!'
      );
      setTimeout(() => setSubmittedFeedbackToast(null), 3500);
    } catch (err: any) {
      console.warn('AI evaluation error in Part 4, preserving answers in Firestore with status pending_evaluation:', err);
      const friendlyMsg =
        err?.message ||
        (isEn
          ? 'The pedagogical grading AI is temporarily unavailable after checking contingency models. Your answers have been safely preserved in Firestore. Please click "Retry Evaluation" to try again.'
          : 'A IA de correção pedagógica está temporariamente indisponível após verificação dos modelos de contingência. Suas respostas foram salvas no Firestore. Por favor, clique em "Tentar Novamente".');
      setEvalError(friendlyMsg);
    } finally {
      setIsSavingPart((prev) => ({ ...prev, reading: false }));
    }
  };

  const handleCheckSentence = async (prompt: SentenceWritingPrompt, textOverride?: string) => {
    const wordKey = prompt.word;
    const directVal = textOverride !== undefined
      ? textOverride
      : (sentenceAnswers[wordKey] || sentenceAnswers[wordKey.trim()] || sentenceAnswers[wordKey.toUpperCase()] || sentenceAnswers[wordKey.toLowerCase()] || '');
    const cleanText = directVal.trim();

    if (!cleanText) {
      setSubmittedFeedbackToast(
        currentLanguage === 'en'
          ? `Please write your sentence for "${wordKey}" before checking with AI.`
          : `Por favor, digite sua frase para "${wordKey}" antes de verificar com a IA.`
      );
      setTimeout(() => setSubmittedFeedbackToast(null), 3500);
      return;
    }

    setIsCheckingSentence((prev) => ({
      ...prev,
      [wordKey]: true,
      [wordKey.toUpperCase()]: true,
      [wordKey.toLowerCase()]: true,
    }));

    try {
      const promptInstruction =
        currentLanguage === 'pt' && prompt.hintPt
          ? prompt.hintPt
          : currentLanguage === 'en' && prompt.hintEn
          ? prompt.hintEn
          : prompt.hint || '';

      const result = await checkStudentWritingApi({
        sentence: cleanText,
        targetWord: wordKey,
        words: [wordKey],
        instruction: promptInstruction,
        levelInstruction: prompt.levelInstruction || '',
        activityName: 'Weekly Memorization Activity - Part 3',
        level: homework?.studentLevel || 'Intermediate',
        language: currentLanguage,
      });

      setSentenceFeedbacks((prev) => ({
        ...prev,
        [wordKey]: result,
        [wordKey.toUpperCase()]: result,
        [wordKey.toLowerCase()]: result,
      }));

      // Update state & persist student answers
      const updatedSentences = {
        ...sentenceAnswers,
        [wordKey]: cleanText,
      };
      setSentenceAnswers(updatedSentences);

      if (onSaveProgress) {
        onSaveProgress({
          ...homework,
          studentAnswers: {
            ...homework.studentAnswers,
            sentences: {
              ...(homework.studentAnswers?.sentences || {}),
              ...updatedSentences,
            },
          },
        });
      }

      const isOk = result?.isCorrect ?? !result?.hasAnyError;
      setSubmittedFeedbackToast(
        currentLanguage === 'en'
          ? isOk ? `✓ Sentence evaluated for "${wordKey}"!` : `💡 Feedback ready for "${wordKey}".`
          : isOk ? `✓ Frase analisada com sucesso para "${wordKey}"!` : `💡 Sugestões da IA prontas para "${wordKey}".`
      );
      setTimeout(() => setSubmittedFeedbackToast(null), 3500);
    } catch (err) {
      console.error(`Check error for ${wordKey}:`, err);
      const unavailableMsgPt = 'Serviço de avaliação pedagógica temporariamente indisponível após tentativa com os modelos de contingência. Sua frase foi preservada.';
      const unavailableMsgEn = 'Pedagogical evaluation service temporarily unavailable after attempting contingency models. Your sentence has been preserved.';
      const fallbackResult = {
        hasAnyError: true,
        isCorrect: false,
        isAiUnavailable: true,
        wordFeedbacks: [],
        sentenceFeedback: {
          original: cleanText,
          hasError: true,
          corrected: cleanText,
          explanationPt: currentLanguage === 'en' ? unavailableMsgEn : unavailableMsgPt,
          explanationEn: unavailableMsgEn,
        },
        correctedSentence: cleanText,
        overallSummaryPt: unavailableMsgPt,
        overallSummaryEn: unavailableMsgEn,
      };
      setSentenceFeedbacks((prev) => ({ ...prev, [wordKey]: fallbackResult }));
    } finally {
      setIsCheckingSentence((prev) => ({
        ...prev,
        [wordKey]: false,
        [wordKey.toUpperCase()]: false,
        [wordKey.toLowerCase()]: false,
      }));
    }
  };

  const handleSubmit = () => {
    onSubmitToTeacher(homework);
    setSubmittedFeedbackToast(memT.toastSubmitted);
    setTimeout(() => setSubmittedFeedbackToast(null), 4000);
  };

  if (!isOpen || !homework) return null;

  return (
    <div className="fixed inset-0 z-50 bg-[#0F172A]/75 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6 overflow-y-auto print:p-0 print:bg-white print:fixed-none">
      <div className="bg-white rounded-3xl max-w-4xl w-full shadow-2xl border border-[#CBD5E1] overflow-hidden my-auto max-h-[92vh] flex flex-col print:max-h-none print:shadow-none print:border-none">
        {/* Header */}
        <div className="px-6 py-4 bg-[#000035] text-white flex items-center justify-between border-b border-[#1C4C96] shrink-0 print:bg-white print:text-black print:border-b-2 print:border-black">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-[#062863] flex items-center justify-center text-white shadow-xs border border-[#607EC9] print:hidden">
              <BookOpen className="w-5 h-5 text-[#9AB4FF]" />
            </div>
            <div>
              <h3 className="font-black text-base sm:text-xl text-white print:text-black tracking-tight">
                {memT.modalTitle}
              </h3>
              <p className="text-xs text-[#9AB4FF]/80 print:text-gray-600 mt-0.5">
                {formattedWeekLabel} • {homework.studentName}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 print:hidden">
            {homework.totalWordsCollected > 0 && !homework.isEmpty && onRegenerateWithAi && (
              <button
                type="button"
                onClick={handleRegenerateClick}
                disabled={internalGenerating || isGeneratingAi}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-sm border ${
                  internalGenerating || isGeneratingAi
                    ? 'bg-indigo-900/60 text-indigo-200 border-indigo-500/40 cursor-wait'
                    : homework.isAiGenerated
                    ? 'bg-[#1C4C96] hover:bg-[#607EC9] text-white border-[#9AB4FF]/50'
                    : 'bg-gradient-to-r from-amber-500 via-indigo-600 to-blue-600 hover:from-amber-400 hover:to-indigo-500 text-white border-amber-300/60 animate-pulse'
                }`}
                title={
                  isEn
                    ? 'Elaborate or regenerate memorization activities using Gemini AI'
                    : 'Elaborar ou recriar atividades de memorização com a IA Gemini'
                }
              >
                <Sparkles
                  className={`w-3.5 h-3.5 ${
                    internalGenerating || isGeneratingAi ? 'animate-spin text-amber-300' : 'text-amber-300'
                  }`}
                />
                <span className="hidden sm:inline">
                  {internalGenerating || isGeneratingAi
                    ? isEn
                      ? 'Elaborating with AI...'
                      : 'Elaborando com IA...'
                    : homework.isAiGenerated
                    ? isEn
                      ? 'Regenerate with AI'
                      : 'Recriar com IA'
                    : isEn
                    ? 'Elaborate with Gemini AI'
                    : 'Elaborar com IA (Gemini)'}
                </span>
                <span className="sm:hidden">
                  {internalGenerating || isGeneratingAi
                    ? 'IA...'
                    : homework.isAiGenerated
                    ? 'Recriar'
                    : 'IA'}
                </span>
              </button>
            )}

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-xl text-[#BFDBFE] hover:text-white hover:bg-[#1E3A8A] transition cursor-pointer"
              title={memT.close}
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* S-Path Rhythm 7-Day Timeline Bar */}
        <div className="px-4 sm:px-6 py-2.5 bg-[#000035]/95 border-b border-[#1C4C96]/60 flex flex-wrap items-center justify-between gap-3 text-white print:hidden shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-bold text-[#BFDBFE]">
              {isEn ? 'S-Path Rhythm (1 Part / Day):' : 'Ritmo S-Path (1 Parte / Dia):'}
            </span>
            <span className="text-[10px] font-extrabold text-[#F4CA54] bg-[#062863] px-2.5 py-0.5 rounded-full border border-[#1C4C96] flex items-center gap-1 shadow-xs">
              <span>⭐ {isEn ? `Day Focus: Part ${dailySchedule.partNumber}` : `Foco do Dia: Parte ${dailySchedule.partNumber}`}</span>
            </span>
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            {WEEK_DAYS.map((d) => {
              const isSelected = d.key === targetDay;
              const isDayCompleted = Boolean(
                homework?.completedPartsByDay?.[d.key] ||
                weeklyChecks?.[`memorization_${d.key}`] ||
                (d.key === targetDay && isTodayPartCompleted)
              );
              const daySchedule = getDailyMemorizationSchedule(d.key, activeStudyDays, weeklyCycle);
              const isDayInPlan = !activeStudyDays || activeStudyDays.includes(d.key);

              return (
                <button
                  key={d.key}
                  type="button"
                  onClick={() => handleSelectDay(d.key)}
                  disabled={!isDayInPlan}
                  title={`${d.label}: Parte ${daySchedule.partNumber} ${isDayCompleted ? (isEn ? '• Completed' : '• Concluída') : ''}`}
                  className={`px-2.5 py-1 rounded-xl text-[10px] font-bold flex items-center gap-1.5 transition cursor-pointer select-none border ${
                    isSelected
                      ? 'bg-[#1C4C96] text-white border-[#F4CA54] shadow-xs ring-1 ring-[#F4CA54]/40'
                      : isDayCompleted
                      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-400/50 hover:bg-emerald-500/30'
                      : isDayInPlan
                      ? 'bg-[#062863]/60 text-[#9AB4FF] border-[#1C4C96]/60 hover:bg-[#062863] hover:text-white'
                      : 'opacity-30 text-slate-400 border-transparent cursor-not-allowed'
                  }`}
                >
                  <span className="uppercase text-[9px] font-mono">{d.label}</span>
                  {isDayCompleted ? (
                    <div className="w-3.5 h-3.5 rounded-full bg-emerald-500/30 text-emerald-300 flex items-center justify-center">
                      <Check className="w-2.5 h-2.5 text-emerald-300" />
                    </div>
                  ) : (
                    <span
                      className={`text-[8px] font-mono px-1 py-0.2 rounded font-black ${
                        isSelected ? 'bg-[#F4CA54] text-[#000035]' : 'bg-[#000035] text-[#9AB4FF]'
                      }`}
                    >
                      P{daySchedule.partNumber}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Dismissible Error / Notice Banner */}
        {regenerateError && (
          <div className="px-6 py-2 bg-amber-50 border-b border-amber-200 text-amber-900 flex items-center justify-between text-xs print:hidden">
            <span>{regenerateError}</span>
            <button
              type="button"
              onClick={() => setRegenerateError(null)}
              className="text-amber-700 hover:text-amber-900 font-bold ml-2 cursor-pointer"
            >
              ✕
            </button>
          </div>
        )}

        {/* Live AI Generation Banner */}
        {internalGenerating && (
          <div className="px-6 py-2.5 bg-gradient-to-r from-blue-700 via-indigo-700 to-blue-800 text-white flex items-center justify-between gap-3 text-xs font-semibold shadow-inner print:hidden shrink-0">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 animate-spin text-amber-300 shrink-0" />
              <span>
                {isEn
                  ? 'Gemini AI is crafting your authentic native memorization activities (story, smart blanks, writing prompts)...'
                  : 'A IA Gemini está criando suas atividades autênticas de memorização (história nativa, lacunas inteligentes, desafios)...'}
              </span>
            </div>
            <span className="text-[10px] bg-white/20 px-2.5 py-0.5 rounded-full font-extrabold shrink-0">
              {isEn ? 'Live Native Generation' : 'Geração Didática Nativa'}
            </span>
          </div>
        )}

        {/* Empty State Warning if no weekly vocabulary is registered (Anti-Generic Rule) */}
        {homework.isEmpty || homework.totalWordsCollected === 0 ? (
          <div className="p-6 sm:p-10 flex flex-col items-center text-center max-w-xl mx-auto space-y-5 my-auto">
            <div className="w-16 h-16 rounded-2xl bg-[#9AB4FF]/20 text-[#000035] flex items-center justify-center border border-[#9AB4FF]/40">
              <AlertCircle className="w-8 h-8 text-[#1C4C96]" />
            </div>
            <div className="space-y-2">
              <h3 className="text-xl font-black text-[#000035]">
                {memT.emptyState.title}
              </h3>
              <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
                {currentLanguage === 'pt' && homework.emptyWarning
                  ? homework.emptyWarning
                  : currentLanguage === 'en' && homework.emptyWarningEn
                  ? homework.emptyWarningEn
                  : memT.emptyState.description}
              </p>
            </div>

            <div className="w-full bg-slate-50 p-4 sm:p-5 rounded-2xl border border-slate-200 text-left space-y-3">
              <h5 className="font-bold text-xs text-[#000035] uppercase tracking-wider">
                {memT.emptyState.howToTitle}
              </h5>
              <ul className="space-y-2 text-xs text-slate-700">
                <li className="flex items-start gap-2">
                  <span className="font-bold text-[#1C4C96] shrink-0">1.</span>
                  <span>{memT.emptyState.step1}</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="font-bold text-[#1C4C96] shrink-0">2.</span>
                  <span>{memT.emptyState.step2}</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="font-bold text-[#1C4C96] shrink-0">3.</span>
                  <span>{memT.emptyState.step3}</span>
                </li>
              </ul>
            </div>

            <div className="flex flex-wrap gap-3 justify-center pt-2">
              <button
                type="button"
                onClick={onClose}
                className="px-5 py-2.5 bg-[#000035] hover:bg-[#062863] text-white rounded-xl text-xs font-bold shadow-2xs transition cursor-pointer"
              >
                {memT.emptyState.backBtn}
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Navigation Tabs (Permanently Sticky & Fully Visible) */}
            <div className="px-4 sm:px-6 py-2.5 bg-slate-50/95 backdrop-blur-xs border-b border-slate-200 overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden print:hidden shrink-0 sticky top-0 z-20 shadow-xs">
              <div className="flex items-center gap-2 min-w-max">
                <button
                  type="button"
                  onClick={() => setActiveTab('matching')}
                  className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition shrink-0 cursor-pointer flex items-center gap-1.5 ${
                    activeTab === 'matching'
                      ? 'bg-[#000035] text-white shadow-2xs'
                      : 'text-slate-600 hover:text-[#000035] hover:bg-slate-200/60'
                  }`}
                >
                  <span>{memT.tabs.matching}</span>
                  {dailySchedule.partKey === 'matching' && (
                    <span className="text-[9px] font-black px-1.5 py-0.2 rounded-full bg-[#F4CA54] text-[#000035]">
                      {isEn ? 'Today' : 'Hoje'}
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('fill')}
                  className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition shrink-0 cursor-pointer flex items-center gap-1.5 ${
                    activeTab === 'fill'
                      ? 'bg-[#000035] text-white shadow-2xs'
                      : 'text-slate-600 hover:text-[#000035] hover:bg-slate-200/60'
                  }`}
                >
                  <span>{memT.tabs.fill}</span>
                  {dailySchedule.partKey === 'fill' && (
                    <span className="text-[9px] font-black px-1.5 py-0.2 rounded-full bg-[#F4CA54] text-[#000035]">
                      {isEn ? 'Today' : 'Hoje'}
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('writing')}
                  className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition shrink-0 cursor-pointer flex items-center gap-1.5 ${
                    activeTab === 'writing'
                      ? 'bg-[#000035] text-white shadow-2xs'
                      : 'text-slate-600 hover:text-[#000035] hover:bg-slate-200/60'
                  }`}
                >
                  <span>{memT.tabs.sentences}</span>
                  {dailySchedule.partKey === 'writing' && (
                    <span className="text-[9px] font-black px-1.5 py-0.2 rounded-full bg-[#F4CA54] text-[#000035]">
                      {isEn ? 'Today' : 'Hoje'}
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('reading')}
                  className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition shrink-0 cursor-pointer flex items-center gap-1.5 ${
                    activeTab === 'reading'
                      ? 'bg-[#000035] text-white shadow-2xs'
                      : 'text-slate-600 hover:text-[#000035] hover:bg-slate-200/60'
                  }`}
                >
                  <span>{memT.tabs.reading}</span>
                  {dailySchedule.partKey === 'reading' && (
                    <span className="text-[9px] font-black px-1.5 py-0.2 rounded-full bg-[#F4CA54] text-[#000035]">
                      {isEn ? 'Today' : 'Hoje'}
                    </span>
                  )}
                </button>
              </div>
            </div>

            {/* Toast */}
            {submittedFeedbackToast && (
              <div className="mx-6 mt-3 p-3 bg-blue-50 border border-blue-200 rounded-xl text-xs font-semibold text-blue-900 flex items-center gap-2 shadow-2xs">
                <CheckCircle className="w-4 h-4 text-blue-600 shrink-0" />
                <span>{submittedFeedbackToast}</span>
              </div>
            )}

            {/* Tab Contents (Scrollable Viewport with zero occlusion) */}
            <div className="p-4 sm:p-6 overflow-y-auto flex-1 min-h-0 space-y-5">
              {internalGenerating ? (
                <MemorizationAiLoadingSkeleton
                  isEn={isEn}
                  studentLevelDisplay={studentLevelDisplay}
                  activeTab={activeTab}
                  targetDayName={targetDay}
                  wordsCount={homework.totalWordsCollected || homework.vocabularyList?.length || 5}
                  titleText={memT.generatingDailyActivity}
                  subtitleText={memT.generatingDailyActivitySubtitle}
                />
              ) : (
                <>
                  {/* AI Elaboration Banner if current version is offline baseline */}
                  {!homework.isAiGenerated && onRegenerateWithAi && homework.totalWordsCollected > 0 && !homework.isEmpty && (
                    <div className="p-3.5 bg-gradient-to-r from-amber-50 via-indigo-50/60 to-blue-50 border border-amber-200/80 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs shadow-2xs">
                      <div className="flex items-center gap-2.5 text-slate-800">
                        <Sparkles className="w-4 h-4 text-amber-500 shrink-0" />
                        <span>
                          {isEn
                            ? 'Want a custom narrative and smart challenges? Elaborate this activity with Gemini AI.'
                            : 'Quer uma história nativa inédita e desafios dinâmicos? Elabore esta atividade com a IA Gemini.'}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={handleRegenerateClick}
                        disabled={internalGenerating || isGeneratingAi}
                        className="px-3.5 py-1.5 bg-[#000035] hover:bg-[#062863] text-white rounded-xl font-bold text-xs shrink-0 cursor-pointer flex items-center justify-center gap-1.5 shadow-xs transition"
                      >
                        <Sparkles className="w-3.5 h-3.5 text-amber-300" />
                        <span>{isEn ? 'Elaborate with AI' : 'Elaborar com IA'}</span>
                      </button>
                    </div>
                  )}

                  {/* TAB 1: MATCHING */}
                  {activeTab === 'matching' && (
                <div className="space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2.5 border-b border-slate-200">
                    <div>
                      <h4 className="font-bold text-sm text-[#000035]">
                        {memT.part1.title}
                      </h4>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {memT.part1.instruction}
                      </p>
                    </div>
                    <span className="text-[11px] font-bold text-[#1C4C96] bg-[#9AB4FF]/20 px-2.5 py-1 rounded-full border border-[#9AB4FF]/40 self-start sm:self-auto">
                      {memT.part1.answeredCount(
                        Object.values(matchingAnswers).filter(Boolean).length,
                        homework.matchingPairs.length
                      )}
                    </span>
                  </div>

                  {/* Available Words minimal chip row */}
                  <div className="py-2.5 px-3.5 bg-slate-50 rounded-xl border border-slate-200 flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] font-bold text-slate-500 mr-1 uppercase tracking-wide">
                      {memT.part1.wordsBankLabel}
                    </span>
                    {homework.matchingPairs.map((p) => {
                      const isUsed = Object.values(matchingAnswers).includes(p.word);
                      return (
                        <span
                          key={p.id}
                          className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition ${
                            isUsed
                              ? 'bg-slate-200/80 text-slate-400 line-through'
                              : 'bg-white text-[#000035] border border-slate-300 shadow-2xs'
                          }`}
                        >
                          {p.word}
                        </span>
                      );
                    })}
                  </div>

                  {/* Matching list */}
                  <div className="space-y-2">
                    {homework.matchingPairs.map((item, idx) => {
                      const selectedVal = matchingAnswers[item.id] || '';
                      const isAnswered = Boolean(selectedVal);
                      return (
                        <div
                          key={item.id}
                          className={`p-3.5 rounded-xl border transition flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                            isAnswered
                              ? 'bg-slate-50/70 border-slate-300'
                              : 'bg-white border-slate-200 hover:border-slate-300'
                          }`}
                        >
                          <div className="flex items-start gap-2.5">
                            <span className="w-5 h-5 rounded-md bg-[#000035] text-white text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                              {idx + 1}
                            </span>
                            <div className="space-y-0.5">
                              <p className="text-xs font-semibold text-slate-900 leading-snug">{item.definition}</p>
                              {currentLanguage !== 'en' && item.translation && (
                                <p className="text-[11px] text-[#1C4C96] font-medium">
                                  {memT.part1.pedagogicalSupportLabel} {item.translation}
                                </p>
                              )}
                            </div>
                          </div>

                          <div className="shrink-0 self-end sm:self-center">
                            <select
                              value={selectedVal}
                              onChange={(e) =>
                                setMatchingAnswers((prev) => ({
                                  ...prev,
                                  [item.id]: e.target.value,
                                }))
                              }
                              className="px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-bold text-[#000035] focus:outline-none focus:ring-1 focus:ring-[#1C4C96] focus:border-[#1C4C96] cursor-pointer"
                            >
                              <option value="">{memT.part1.selectPlaceholder}</option>
                              {homework.matchingPairs.map((opt) => (
                                <option key={opt.id} value={opt.word}>
                                  {opt.word}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Action Bar & Save Part 1 */}
                  <div className="pt-3 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200">
                    <div className="flex items-center gap-2">
                      {isPart1Completed ? (
                        <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-700 bg-emerald-50 px-3 py-1.5 rounded-xl border border-emerald-200">
                          <CheckCircle className="w-4 h-4 text-emerald-600" />
                          <span>{isEn ? 'Recorded on S-Path' : 'Gravado no S-Path'}</span>
                        </div>
                      ) : (
                        <span className="text-[11px] text-slate-500 font-medium">
                          {memT.part1.answeredCount(
                            Object.values(matchingAnswers).filter(Boolean).length,
                            homework.matchingPairs.length
                          )} • {isEn ? 'Answer all to record on S-Path' : 'Responda todas para gravar no S-Path'}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2.5">
                      <button
                        type="button"
                        onClick={handleSavePart1}
                        disabled={isSavingPart.matching}
                        className="px-5 py-2.5 bg-[#000035] hover:bg-[#062863] text-white rounded-xl font-bold text-xs flex items-center gap-2 shadow-xs cursor-pointer transition disabled:opacity-50"
                      >
                        <Save className="w-4 h-4 text-[#9AB4FF]" />
                        <span>{isEn ? 'Save Part 1' : 'Salvar Parte 1'}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setActiveTab('fill')}
                        className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-[#000035] rounded-xl font-bold text-xs flex items-center gap-1.5 transition cursor-pointer"
                      >
                        <span>{memT.part1.nextBtn}</span>
                        <ArrowRight className="w-4 h-4 text-[#1C4C96]" />
                      </button>
                    </div>
                  </div>

                  {/* STAGE-BY-STAGE PEDAGOGICAL CORRECTIONS (Part 1) */}
                  <div className="pt-4 border-t border-slate-200 space-y-3">
                    <h4 className="font-bold text-xs uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                      <CheckSquare className="w-4 h-4 text-[#1C4C96]" />
                      <span>{isEn ? 'STAGE-BY-STAGE PEDAGOGICAL CORRECTIONS' : 'CORREÇÃO PEDAGÓGICA PASSO A PASSO'}</span>
                    </h4>

                    <div className="p-4 bg-white rounded-2xl border border-slate-200 space-y-3 shadow-xs">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-[#000035]">
                          {isEn ? 'Part 1: Meaning Association' : 'Parte 1: Associação de Palavras'}
                        </span>
                        <span className="text-[11px] text-slate-500 font-semibold">
                          {homework.matchingPairs.length} {isEn ? 'items' : 'itens'}
                        </span>
                      </div>

                      <div className="space-y-2">
                        {homework.matchingPairs.map((pair) => {
                          const safeKey = pair.word ? pair.word.toLowerCase().replace(/[^a-z0-9]/g, '_') : '';
                          const userAns = matchingAnswers[pair.id] || (safeKey ? matchingAnswers[`match-${safeKey}`] : '') || matchingAnswers[pair.word] || '';
                          const isAnswered = Boolean(userAns.trim());
                          const isMatchCorrect = isAnswered && userAns.toLowerCase() === pair.word.toLowerCase();
                          const actName = wordToActivityMap[pair.word.toLowerCase()];

                          return (
                            <div
                              key={pair.id}
                              className={`p-3 rounded-xl border text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 transition ${
                                !isAnswered
                                  ? 'bg-slate-50/70 border-slate-200'
                                  : isMatchCorrect
                                  ? 'bg-emerald-50/60 border-emerald-200'
                                  : 'bg-amber-50/60 border-amber-200'
                              }`}
                            >
                              <div className="space-y-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <p className="font-bold text-slate-900 capitalize text-xs">{pair.word}</p>
                                  {actName && (
                                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-blue-100 text-[#000035] border border-blue-200">
                                      {isEn ? 'Activity:' : 'Atividade:'} {actName}
                                    </span>
                                  )}
                                </div>
                                <p className="text-[11px] text-slate-600">{pair.definition}</p>
                              </div>

                              <div className="text-right shrink-0">
                                {!isAnswered ? (
                                  <span className="text-[11px] font-semibold text-slate-500">
                                    ⏳ {isEn ? 'Pending / Not answered' : 'Pendente / Não respondido'}
                                  </span>
                                ) : (
                                  <span className={`text-[11px] font-bold ${isMatchCorrect ? 'text-emerald-700' : 'text-amber-700'}`}>
                                    {isMatchCorrect
                                      ? `✓ ${isEn ? 'Matched' : 'Associado'}: ${userAns}`
                                      : `✗ ${isEn ? 'Chosen' : 'Escolhido'}: ${userAns} → ${isEn ? 'Correct' : 'Correto'}: ${pair.word}`}
                                  </span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 2: FILL IN BLANKS */}
              {activeTab === 'fill' && (
                <div className="space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2.5 border-b border-slate-200">
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="font-bold text-sm text-[#000035]">
                          {memT.part2.title}
                        </h4>
                        <span className="text-[10px] font-bold px-2 py-0.5 bg-[#9AB4FF]/20 text-[#1C4C96] rounded-md border border-[#9AB4FF]/40">
                          {studentLevelDisplay}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {memT.part2.instruction}
                      </p>
                    </div>
                    <span className="text-[11px] font-bold text-[#1C4C96] bg-[#9AB4FF]/20 px-2.5 py-1 rounded-full border border-[#9AB4FF]/40 self-start sm:self-auto">
                      {memT.part2.completedCount(
                        Object.values(fillAnswers).filter(Boolean).length,
                        homework.fillInBlanks.length
                      )}
                    </span>
                  </div>

                  <div className="space-y-3">
                    {homework.fillInBlanks.map((item, idx) => {
                      const selectedOption = fillAnswers[item.id];
                      return (
                        <div
                          key={item.id}
                          className="p-3.5 bg-white rounded-xl border border-slate-200 space-y-2.5"
                        >
                          <div className="flex items-start gap-2.5">
                            <span className="w-5 h-5 rounded-md bg-[#000035] text-white text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                              {idx + 1}
                            </span>
                            <div className="space-y-1">
                              <p className="text-xs sm:text-sm font-medium text-slate-800 leading-relaxed">
                                {item.sentenceWithBlank}
                              </p>
                              <p className="text-[11px] text-slate-500 italic">
                                {memT.part2.getPedagogicalHint(item.correctWord, item.hintPt, item.hintEn)}
                              </p>
                            </div>
                          </div>

                          <div className="flex flex-wrap gap-1.5 pl-7">
                            {item.options.map((opt, optIdx) => {
                              const isSelected = selectedOption === opt;
                              return (
                                <button
                                  key={optIdx}
                                  type="button"
                                  onClick={() =>
                                    setFillAnswers((prev) => ({
                                      ...prev,
                                      [item.id]: opt,
                                    }))
                                  }
                                  className={`py-1 px-3 rounded-lg border text-xs font-semibold transition cursor-pointer ${
                                    isSelected
                                      ? 'bg-[#000035] border-[#000035] text-white shadow-2xs'
                                      : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100 hover:border-slate-300'
                                  }`}
                                >
                                  {opt}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Action Bar & Save Part 2 */}
                  <div className="pt-3 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200">
                    <div className="flex items-center gap-2.5">
                      <button
                        type="button"
                        onClick={() => setActiveTab('matching')}
                        className="px-3.5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition cursor-pointer flex items-center gap-1.5"
                      >
                        <ArrowLeft className="w-4 h-4 text-[#1C4C96]" />
                        <span>{memT.part2.backBtn}</span>
                      </button>

                      {isPart2Completed ? (
                        <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-700 bg-emerald-50 px-3 py-1.5 rounded-xl border border-emerald-200">
                          <CheckCircle className="w-4 h-4 text-emerald-600" />
                          <span>{isEn ? 'Recorded on S-Path' : 'Gravado no S-Path'}</span>
                        </div>
                      ) : (
                        <span className="text-[11px] text-slate-500 font-medium">
                          {memT.part2.completedCount(
                            Object.values(fillAnswers).filter(Boolean).length,
                            homework.fillInBlanks.length
                          )} • {isEn ? 'Answer all to record on S-Path' : 'Responda todas para gravar no S-Path'}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2.5">
                      <button
                        type="button"
                        onClick={handleSavePart2}
                        disabled={isSavingPart.fill}
                        className="px-5 py-2.5 bg-[#000035] hover:bg-[#062863] text-white rounded-xl font-bold text-xs flex items-center gap-2 shadow-xs cursor-pointer transition disabled:opacity-50"
                      >
                        <Save className="w-4 h-4 text-[#9AB4FF]" />
                        <span>{isEn ? 'Save Part 2' : 'Salvar Parte 2'}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setActiveTab('writing')}
                        className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-[#000035] rounded-xl font-bold text-xs flex items-center gap-1.5 transition cursor-pointer"
                      >
                        <span>{memT.part2.nextBtn}</span>
                        <ArrowRight className="w-4 h-4 text-[#1C4C96]" />
                      </button>
                    </div>
                  </div>

                  {/* STAGE-BY-STAGE PEDAGOGICAL CORRECTIONS (Part 2) */}
                  <div className="pt-4 border-t border-slate-200 space-y-3">
                    <h4 className="font-bold text-xs uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                      <CheckSquare className="w-4 h-4 text-[#1C4C96]" />
                      <span>{isEn ? 'STAGE-BY-STAGE PEDAGOGICAL CORRECTIONS' : 'CORREÇÃO PEDAGÓGICA PASSO A PASSO'}</span>
                    </h4>

                    <div className="p-4 bg-white rounded-2xl border border-slate-200 space-y-3 shadow-xs">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-[#000035]">
                          {isEn ? 'Part 2: Fill in the Blanks' : 'Parte 2: Lacunas da Rotina'}
                        </span>
                        <span className="text-[11px] text-slate-500 font-semibold">
                          {homework.fillInBlanks.length} {isEn ? 'items' : 'itens'}
                        </span>
                      </div>

                      <div className="space-y-2">
                        {homework.fillInBlanks.map((fill) => {
                          const safeKey = fill.correctWord ? fill.correctWord.toLowerCase().replace(/[^a-z0-9]/g, '_') : '';
                          const userAns = fillAnswers[fill.id] || (safeKey ? fillAnswers[`fill-${safeKey}`] : '') || fillAnswers[fill.correctWord] || '';
                          const isAnswered = Boolean(userAns.trim());
                          const isFillCorrect = isAnswered && userAns.toLowerCase() === fill.correctWord.toLowerCase();
                          const actName = wordToActivityMap[fill.correctWord.toLowerCase()];

                          return (
                            <div
                              key={fill.id}
                              className={`p-3 rounded-xl border text-xs space-y-1.5 transition ${
                                !isAnswered
                                  ? 'bg-slate-50/70 border-slate-200'
                                  : isFillCorrect
                                  ? 'bg-emerald-50/60 border-emerald-200'
                                  : 'bg-amber-50/60 border-amber-200'
                              }`}
                            >
                              <div className="flex flex-wrap items-center justify-between gap-1.5">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="font-semibold text-slate-900">{fill.sentenceWithBlank}</span>
                                  {actName && (
                                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-blue-100 text-[#000035] border border-blue-200">
                                      {isEn ? 'Activity:' : 'Atividade:'} {actName}
                                    </span>
                                  )}
                                </div>
                                {!isAnswered ? (
                                  <span className="text-[11px] font-semibold text-slate-500">
                                    ⏳ {isEn ? 'Pending / Not answered' : 'Pendente / Não respondido'}
                                  </span>
                                ) : (
                                  <span className={`text-[11px] font-bold ${isFillCorrect ? 'text-emerald-700' : 'text-amber-700'}`}>
                                    {isFillCorrect
                                      ? `✓ ${userAns}`
                                      : `✗ ${userAns} → ${isEn ? 'Target' : 'Correto'}: ${fill.correctWord}`}
                                  </span>
                                )}
                              </div>
                              <p className="text-[11px] text-slate-600">
                                {isEn
                                  ? (fill.explanationEn || fill.hintEn || `Correct word is "${fill.correctWord}".`)
                                  : (fill.explanationPt || fill.hintPt || `A palavra correta é "${fill.correctWord}".`)}
                              </p>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 3: SENTENCES */}
              {activeTab === 'writing' && (
                <div className="space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2.5 border-b border-slate-200">
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="font-bold text-sm text-[#000035]">
                          {memT.part3.title}
                        </h4>
                        <span className="text-[10px] font-bold px-2 py-0.5 bg-[#9AB4FF]/20 text-[#1C4C96] rounded-md border border-[#9AB4FF]/40">
                          {studentLevelDisplay}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {memT.part3.instruction}
                      </p>
                    </div>
                  </div>

                  <div className="space-y-3">
                    {homework.sentenceWritingPrompts.map((prompt, idx) => {
                      const promptWord = prompt.word;
                      const val =
                        sentenceAnswers[promptWord] ??
                        sentenceAnswers[promptWord.trim()] ??
                        sentenceAnswers[promptWord.toUpperCase()] ??
                        sentenceAnswers[promptWord.toLowerCase()] ??
                        '';
                      const feedback =
                        sentenceFeedbacks[promptWord] ||
                        sentenceFeedbacks[promptWord.trim()] ||
                        sentenceFeedbacks[promptWord.toUpperCase()] ||
                        sentenceFeedbacks[promptWord.toLowerCase()];
                      const isChecking = Boolean(
                        isCheckingSentence[promptWord] ||
                        isCheckingSentence[promptWord.trim()] ||
                        isCheckingSentence[promptWord.toUpperCase()]
                      );

                      return (
                        <div
                          key={idx}
                          className="p-3.5 bg-white rounded-xl border border-slate-200 space-y-2.5 transition shadow-2xs hover:border-slate-300"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="px-2.5 py-0.5 rounded-md bg-[#9AB4FF]/20 text-[#000035] text-xs font-black uppercase tracking-wide border border-[#9AB4FF]/30">
                                {prompt.word}
                              </span>
                              <span className="text-[11px] text-slate-600">
                                {currentLanguage === 'pt' && prompt.hintPt
                                  ? prompt.hintPt
                                  : currentLanguage === 'en' && prompt.hintEn
                                  ? prompt.hintEn
                                  : memT.part3.getPedagogicalPrompt(prompt.word, prompt.hint)}
                              </span>
                              {prompt.levelInstruction && (
                                <span className="text-[10px] font-bold text-[#1C4C96] bg-slate-100 px-2 py-0.5 rounded-md border border-slate-200">
                                  🎯 {prompt.levelInstruction}
                                </span>
                              )}
                            </div>

                            <button
                              type="button"
                              onClick={() => handleCheckSentence(prompt, val)}
                              disabled={isChecking || !val.trim()}
                              aria-label={`${memT.part3.checkWithAi} - ${prompt.word}`}
                              className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition select-none cursor-pointer ${
                                isChecking
                                  ? 'bg-[#000035]/70 text-white cursor-wait opacity-90'
                                  : val.trim()
                                  ? 'bg-[#000035] text-white hover:bg-[#062863] active:scale-95 shadow-2xs'
                                  : 'bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed'
                              }`}
                              title={!val.trim() ? (isEn ? 'Type a sentence first' : 'Digite uma frase primeiro') : ''}
                            >
                              <Sparkles className={`w-3.5 h-3.5 text-[#9AB4FF] ${isChecking ? 'animate-spin' : ''}`} />
                              <span>{isChecking ? (memT.part3.checking || 'Checking...') : memT.part3.checkWithAi}</span>
                            </button>
                          </div>

                          <textarea
                            rows={2}
                            value={val}
                            onChange={(e) => {
                              const newVal = e.target.value;
                              setSentenceAnswers((prev) => ({
                                ...prev,
                                [prompt.word]: newVal,
                              }));
                              // Invalidate ONLY the evaluation for this altered sentence
                              setSentenceFeedbacks((prev) => {
                                if (!prev[prompt.word] && !prev[prompt.word.toLowerCase()]) return prev;
                                const next = { ...prev };
                                delete next[prompt.word];
                                delete next[prompt.word.toLowerCase()];
                                delete next[prompt.word.toUpperCase()];
                                return next;
                              });
                              if (aiEvaluation?.sentenceFeedback) {
                                setAiEvaluation((prev) => {
                                  if (!prev || !prev.sentenceFeedback) return prev;
                                  return {
                                    ...prev,
                                    sentenceFeedback: prev.sentenceFeedback.map((sf: any) =>
                                      (sf.word || '').toLowerCase() === prompt.word.toLowerCase()
                                        ? { ...sf, isModified: true, isCorrect: false }
                                        : sf
                                    ),
                                  };
                                });
                              }
                              if (partsProgress.writing?.status === 'completed') {
                                setPartsProgress((prev) => ({
                                  ...prev,
                                  writing: {
                                    ...prev.writing!,
                                    status: 'draft',
                                    answers: { ...sentenceAnswers, [prompt.word]: newVal },
                                    updatedAt: new Date().toISOString(),
                                  },
                                }));
                              }
                            }}
                            placeholder={memT.part3.placeholder(prompt.word)}
                            className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium text-slate-900 focus:bg-white focus:outline-none focus:ring-1 focus:ring-[#1C4C96] focus:border-[#1C4C96] transition"
                          />

                          {feedback && (
                            <div
                              className={`p-3.5 rounded-xl border text-xs space-y-2.5 transition animate-in fade-in duration-200 ${
                                feedback.hasAnyError
                                  ? 'bg-amber-50/90 border-amber-300 text-amber-950'
                                  : 'bg-emerald-50/90 border-emerald-300 text-emerald-950'
                              }`}
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <div className="flex items-center gap-1.5 font-bold text-xs">
                                    {feedback.hasAnyError ? (
                                      <>
                                        <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                                        <span>{memT.part3.suggestionLabel || (isEn ? 'AI Feedback' : 'Sugestões da IA')}</span>
                                      </>
                                    ) : (
                                      <>
                                        <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
                                        <span>{memT.part3.greatSentence || (isEn ? 'Great sentence!' : 'Excelente frase!')}</span>
                                      </>
                                    )}
                                  </div>

                                  {feedback.usedTargetWord !== undefined && (
                                    <span
                                      className={`text-[10px] font-bold px-2 py-0.5 rounded-md border ${
                                        feedback.usedTargetWord
                                          ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                                          : 'bg-amber-100 text-amber-900 border-amber-300'
                                      }`}
                                    >
                                      {feedback.usedTargetWord
                                        ? `✓ ${isEn ? `Word "${prompt.word}" used` : `Palavra "${prompt.word}" aplicada`}`
                                        : `⚠ ${isEn ? `Use word "${prompt.word}"` : `Use a palavra "${prompt.word}"`}`}
                                    </span>
                                  )}

                                  {prompt.levelInstruction && (
                                    <span
                                      className={`text-[10px] font-bold px-2 py-0.5 rounded-md border ${
                                        feedback.usedTrigger === false
                                          ? 'bg-amber-100 text-amber-900 border-amber-300'
                                          : 'bg-blue-100/90 text-[#000035] border-blue-200'
                                      }`}
                                    >
                                      🎯 {feedback.usedTrigger === false
                                        ? (isEn ? 'Trigger missed' : 'Gatilho ausente')
                                        : (isEn ? 'Trigger satisfied' : 'Gatilho cumprido')}
                                    </span>
                                  )}
                                </div>

                                <button
                                  type="button"
                                  onClick={() => {
                                    setSentenceFeedbacks((prev) => {
                                      const next = { ...prev };
                                      delete next[prompt.word];
                                      delete next[prompt.word.toLowerCase()];
                                      delete next[prompt.word.toUpperCase()];
                                      return next;
                                    });
                                  }}
                                  className="text-slate-400 hover:text-slate-600 text-xs font-bold px-1 py-0.5 cursor-pointer"
                                  title={isEn ? 'Dismiss feedback' : 'Ocultar feedback'}
                                >
                                  ✕
                                </button>
                              </div>

                              {feedback.correctedSentence &&
                                feedback.correctedSentence.trim().toLowerCase() !== val.trim().toLowerCase() && (
                                  <div className="bg-white/95 p-2.5 rounded-lg border border-slate-200/80 space-y-1.5 shadow-2xs">
                                    <div className="flex items-center justify-between gap-2">
                                      <span className="text-[11px] font-bold text-slate-700">
                                        {isEn ? 'Enhanced sentence suggestion:' : 'Sugestão aprimorada da IA:'}
                                      </span>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setSentenceAnswers((prev) => ({
                                            ...prev,
                                            [prompt.word]: feedback.correctedSentence!,
                                          }));
                                        }}
                                        className="text-[10px] font-bold text-[#1C4C96] hover:text-[#000035] underline cursor-pointer"
                                      >
                                        {isEn ? 'Apply suggestion' : 'Usar esta versão'}
                                      </button>
                                    </div>
                                    <p className="text-xs font-semibold text-slate-900 italic">
                                      "{feedback.correctedSentence}"
                                    </p>
                                  </div>
                                )}

                              <p className="text-[11px] leading-relaxed">
                                {currentLanguage === 'en'
                                  ? (feedback.overallSummaryEn || feedback.explanation || feedback.overallSummaryPt)
                                  : (feedback.overallSummaryPt || feedback.explanation || feedback.overallSummaryEn)}
                              </p>

                              {(feedback.triggerFeedback || feedback.targetWordFeedback) && (
                                <div className="text-[11px] text-slate-700 pt-1 border-t border-slate-200/60 space-y-0.5">
                                  {feedback.targetWordFeedback && <p>• {feedback.targetWordFeedback}</p>}
                                  {feedback.triggerFeedback && <p>• {feedback.triggerFeedback}</p>}
                                </div>
                              )}

                              {(feedback.levelTipsPt || feedback.levelTipsEn) && (
                                <p className="text-[11px] text-[#1C4C96] font-medium pt-1 border-t border-slate-200/60 flex items-center gap-1.5">
                                  <Compass className="w-3.5 h-3.5 text-[#1C4C96] shrink-0" />
                                  <span>
                                    {isEn
                                      ? (feedback.levelTipsEn || feedback.levelTipsPt)
                                      : (feedback.levelTipsPt || feedback.levelTipsEn)}
                                  </span>
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Action Bar & Save Part 3 */}
                  <div className="pt-3 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200">
                    <div className="flex items-center gap-2.5">
                      <button
                        type="button"
                        onClick={() => setActiveTab('fill')}
                        className="px-3.5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition cursor-pointer flex items-center gap-1.5"
                      >
                        <ArrowLeft className="w-4 h-4 text-[#1C4C96]" />
                        <span>{memT.part3.backBtn}</span>
                      </button>

                      {isPart3Completed ? (
                        <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-700 bg-emerald-50 px-3 py-1.5 rounded-xl border border-emerald-200">
                          <CheckCircle className="w-4 h-4 text-emerald-600" />
                          <span>{isEn ? 'Recorded on S-Path' : 'Gravado no S-Path'}</span>
                        </div>
                      ) : (
                        <span className="text-[11px] text-slate-500 font-medium">
                          {Object.values(sentenceAnswers).filter((s) => (s || '').trim().length >= 3).length} / {homework.sentenceWritingPrompts.length} {isEn ? 'written' : 'escritas'} • {isEn ? 'Write all to record on S-Path' : 'Escreva todas para gravar no S-Path'}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2.5">
                      <button
                        type="button"
                        onClick={handleSavePart3}
                        disabled={isSavingPart.writing}
                        className="px-5 py-2.5 bg-[#000035] hover:bg-[#062863] text-white rounded-xl font-bold text-xs flex items-center gap-2 shadow-xs cursor-pointer transition disabled:opacity-50"
                      >
                        {isSavingPart.writing ? (
                          <>
                            <Sparkles className="w-4 h-4 text-[#9AB4FF] animate-spin" />
                            <span>{isEn ? 'Evaluating with AI...' : 'Avaliando com IA...'}</span>
                          </>
                        ) : evalError ? (
                          <>
                            <RefreshCw className="w-4 h-4 text-[#9AB4FF]" />
                            <span>{isEn ? 'Retry Evaluation' : 'Tentar Avaliação Novamente'}</span>
                          </>
                        ) : (
                          <>
                            <Save className="w-4 h-4 text-[#9AB4FF]" />
                            <span>{isEn ? 'Save Part 3' : 'Salvar Parte 3'}</span>
                          </>
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() => setActiveTab('reading')}
                        className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-[#000035] rounded-xl font-bold text-xs flex items-center gap-1.5 transition cursor-pointer"
                      >
                        <span>{memT.part3.nextBtn}</span>
                        <ArrowRight className="w-4 h-4 text-[#1C4C96]" />
                      </button>
                    </div>
                  </div>

                  {/* AI Evaluation Error Banner if unavailable (Transparent Contingency Reporting) */}
                  {evalError && (
                    <div className="p-4 bg-amber-50 border border-amber-300 rounded-2xl flex items-start gap-3 text-amber-950 text-xs shadow-xs animate-in fade-in duration-200">
                      <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                      <div className="flex-1 space-y-1.5">
                        <p className="font-bold text-amber-900">
                          {isEn ? 'AI Pedagogical Evaluation Unavailable' : 'Avaliação Pedagógica da IA Indisponível'}
                        </p>
                        <p className="text-amber-800 leading-relaxed font-medium">
                          {evalError}
                        </p>
                        <p className="text-[11px] text-amber-700">
                          {isEn
                            ? 'Your written sentences have been safely preserved in Firestore. No synthetic or artificial grades were created.'
                            : 'Suas frases escritas foram salvas com segurança no Firestore. Nenhuma nota fictícia foi gerada.'}
                        </p>
                        <div className="pt-1">
                          <button
                            type="button"
                            onClick={handleSavePart3}
                            disabled={isSavingPart.writing}
                            className="px-3.5 py-1.5 bg-[#000035] hover:bg-[#062863] text-white rounded-lg text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer shadow-xs transition disabled:opacity-50"
                          >
                            <RefreshCw className={`w-3.5 h-3.5 text-[#9AB4FF] ${isSavingPart.writing ? 'animate-spin' : ''}`} />
                            <span>{isEn ? 'Retry AI Evaluation' : 'Tentar Novamente Avaliação da IA'}</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* STAGE-BY-STAGE PEDAGOGICAL CORRECTIONS (Part 3) */}
                  <div className="pt-4 border-t border-slate-200 space-y-3">
                    <h4 className="font-bold text-xs uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                      <CheckSquare className="w-4 h-4 text-[#1C4C96]" />
                      <span>{isEn ? 'STAGE-BY-STAGE PEDAGOGICAL CORRECTIONS' : 'CORREÇÃO PEDAGÓGICA PASSO A PASSO'}</span>
                    </h4>

                    <div className="p-4 bg-white rounded-2xl border border-slate-200 space-y-3 shadow-xs">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-[#000035]">
                          {isEn ? 'Part 3: Sentence Writing' : 'Parte 3: Construção de Frases Ativas'}
                        </span>
                        <span className="text-[11px] text-slate-500 font-semibold">
                          {homework.sentenceWritingPrompts.length} {isEn ? 'sentences' : 'frases'}
                        </span>
                      </div>

                      <div className="space-y-2.5">
                        {homework.sentenceWritingPrompts.map((prompt) => {
                          const userSentence = (sentenceAnswers[prompt.word] || '').trim();
                          const feedback = sentenceFeedbacks[prompt.word];
                          const evalItem = aiEvaluation?.sentenceFeedback?.find(
                            (s) => s.word.toLowerCase() === prompt.word.toLowerCase()
                          );
                          const actName = wordToActivityMap[prompt.word.toLowerCase()];

                          const isEvaluated = Boolean((evalItem && !evalItem.isModified) || feedback);
                          const isSentenceOk = evalItem && !evalItem.isModified
                            ? Boolean(evalItem.isCorrect)
                            : feedback
                            ? Boolean(feedback.isCorrect && !feedback.hasAnyError)
                            : false;
                          const corrected = evalItem?.correctedSentence || feedback?.correctedSentence;
                          const explanation = isEn
                            ? (evalItem?.explanationEn || feedback?.overallSummaryEn)
                            : (evalItem?.explanationPt || feedback?.overallSummaryPt);

                          return (
                            <div
                              key={prompt.word}
                              className={`p-3 rounded-xl border text-xs space-y-1.5 transition ${
                                !userSentence
                                  ? 'bg-slate-50/70 border-slate-200'
                                  : !isEvaluated
                                  ? 'bg-blue-50/50 border-blue-200'
                                  : isSentenceOk
                                  ? 'bg-emerald-50/60 border-emerald-200'
                                  : 'bg-amber-50/60 border-amber-200'
                              }`}
                            >
                              <div className="flex items-center justify-between gap-2 flex-wrap">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="font-bold text-[#000035] uppercase tracking-wide bg-[#9AB4FF]/20 px-2 py-0.5 rounded text-[10px]">
                                    {prompt.word}
                                  </span>
                                  {actName && (
                                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-blue-100 text-[#000035] border border-blue-200">
                                      {isEn ? 'Activity:' : 'Atividade:'} {actName}
                                    </span>
                                  )}
                                </div>
                                <span className={`text-[11px] font-bold ${
                                  !userSentence
                                    ? 'text-slate-500'
                                    : !isEvaluated
                                    ? 'text-blue-700'
                                    : isSentenceOk
                                    ? 'text-emerald-700'
                                    : 'text-amber-700'
                                }`}>
                                  {!userSentence
                                    ? `⏳ ${isEn ? 'Pending / Not answered' : 'Pendente / Não respondido'}`
                                    : !isEvaluated
                                    ? `⏳ ${isEn ? 'Pending AI Evaluation' : 'Aguardando Avaliação da IA'}`
                                    : isSentenceOk
                                    ? (isEn ? '✓ Well Structured' : '✓ Bem Estruturada')
                                    : (isEn ? '⚠ Needs Review' : '⚠ Revisão Recomendada')}
                                </span>
                              </div>

                              <p className="text-[11px] text-slate-800 italic">
                                <span className="text-slate-500 font-normal mr-1">{isEn ? 'Your sentence:' : 'Sua frase:'}</span>
                                "{userSentence || (isEn ? '(no sentence provided yet)' : '(nenhuma frase enviada ainda)')}"
                              </p>

                              {corrected && corrected !== userSentence && (
                                <p className="text-[11px] text-[#000035] bg-white/80 p-2 rounded-md border border-slate-200 font-medium">
                                  <span className="text-slate-500 mr-1 font-normal">{isEn ? 'Recommended form:' : 'Forma recomendada:'}</span>
                                  "{corrected}"
                                </p>
                              )}

                              {explanation && (
                                <p className="text-[11px] text-slate-600">
                                  {explanation}
                                </p>
                              )}

                              {evalItem && (evalItem.levelAdvicePt || evalItem.levelAdviceEn) && (
                                <p className="text-[10px] text-[#1C4C96] font-medium flex items-center gap-1">
                                  <Compass className="w-3 h-3 shrink-0" />
                                  <span>{isEn ? evalItem.levelAdviceEn : evalItem.levelAdvicePt}</span>
                                </p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 4: READING */}
              {activeTab === 'reading' && (
                <div className="space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2.5 border-b border-slate-200">
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="font-bold text-sm text-[#000035]">
                          {memT.part4.title}
                        </h4>
                        <span className="text-[10px] font-bold px-2 py-0.5 bg-[#9AB4FF]/20 text-[#1C4C96] rounded-md border border-[#9AB4FF]/40">
                          {studentLevelDisplay}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {memT.part4.instruction}
                      </p>
                    </div>
                  </div>

                  {/* Reading passage */}
                  {(() => {
                    const activeDayPassage = activeDayActivity?.readingPassage || homework.readingPassage;

                    if (isGeneratingPart4Story) {
                      return (
                        <MemorizationAiLoadingSkeleton
                          isEn={isEn}
                          studentLevelDisplay={studentLevelDisplay}
                          activeTab="reading"
                          targetDayName={targetDay}
                          wordsCount={
                            (activeDayActivity?.selectedWords || homework.vocabularyList || []).length || 5
                          }
                          titleText={
                            isEn
                              ? 'Crafting authentic contextual mini-story...'
                              : 'Criando mini-história contextualizada com Gemini AI...'
                          }
                          subtitleText={
                            isEn
                              ? "Gemini AI is crafting a cohesive 4-paragraph story and comprehension questions naturally integrating today's 5 words..."
                              : "O Gemini AI está criando uma história coesa de 4 parágrafos e perguntas de interpretação integrando naturalmente as 5 palavras do dia..."
                          }
                        />
                      );
                    }

                    if (part4StoryError && (!activeDayPassage?.text || isBadStoryText(activeDayPassage.text))) {
                      return (
                        <div className="p-4 bg-amber-50 border border-amber-300 rounded-2xl flex items-start gap-3 text-amber-950 text-xs shadow-xs animate-in fade-in duration-200">
                          <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                          <div className="flex-1 space-y-1.5">
                            <p className="font-bold text-amber-900">
                              {isEn
                                ? 'Story Generation Temporarily Unavailable'
                                : 'Geração da Mini-História Temporariamente Indisponível'}
                            </p>
                            <p className="text-amber-800 leading-relaxed font-medium">
                              {part4StoryError}
                            </p>
                            <p className="text-[11px] text-amber-700">
                              {isEn
                                ? 'No synthetic or generic fallback stories were created. Please click below to try again with Gemini AI.'
                                : 'Nenhuma história sintética ou genérica foi criada como substituta. Por favor, clique abaixo para tentar novamente com Gemini AI.'}
                            </p>
                            <div className="pt-1">
                              <button
                                type="button"
                                onClick={() => handleGeneratePart4Story(true)}
                                disabled={isGeneratingPart4Story}
                                className="px-3.5 py-1.5 bg-[#000035] hover:bg-[#062863] text-white rounded-lg text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer shadow-xs transition disabled:opacity-50"
                              >
                                <RefreshCw className={`w-3.5 h-3.5 text-[#9AB4FF] ${isGeneratingPart4Story ? 'animate-spin' : ''}`} />
                                <span>{isEn ? 'Try Again with Gemini AI' : 'Tentar Novamente com Gemini AI'}</span>
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    }

                    if (!activeDayPassage || (!activeDayPassage.text && (!activeDayPassage.questions || activeDayPassage.questions.length === 0))) {
                      return (
                        <div className="p-8 bg-slate-50 rounded-2xl border border-dashed border-slate-300 text-center space-y-3">
                          <BookOpen className="w-10 h-10 text-[#1C4C96]/60 mx-auto" />
                          <div className="space-y-1">
                            <h5 className="font-bold text-sm text-[#000035]">
                              {isEn ? 'Reading Passage Pending' : 'Texto de Leitura em Preparação'}
                            </h5>
                            <p className="text-xs text-slate-500 max-w-sm mx-auto">
                              {isEn
                                ? 'The mini-story reading comprehension exercise for today will be crafted with Gemini AI using your daily vocabulary.'
                                : 'O exercício de interpretação de texto de hoje será criado com o Gemini AI a partir do seu vocabulário diário.'}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleGeneratePart4Story(true)}
                            disabled={isGeneratingPart4Story}
                            className="px-4 py-2 bg-[#000035] hover:bg-[#062863] text-white text-xs font-bold rounded-xl transition cursor-pointer inline-flex items-center gap-2"
                          >
                            <Sparkles className="w-4 h-4 text-[#9AB4FF]" />
                            <span>{isEn ? 'Generate Reading Story with Gemini AI' : 'Gerar Texto de Leitura com Gemini AI'}</span>
                          </button>
                        </div>
                      );
                    }

                    return (
                      <>
                        <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
                          <div className="flex items-center justify-between flex-wrap gap-2">
                            <div className="flex items-center gap-2 flex-wrap">
                              <h5 className="font-bold text-xs sm:text-sm text-[#000035]">
                                {activeDayPassage?.title || (isEn ? 'Mini-Story Reading' : 'Interpretação de Texto')}
                              </h5>
                              {activeDayPassage?.isAiGenerated && (
                                <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-gradient-to-r from-blue-500/15 to-indigo-500/15 text-[#000035] border border-blue-200 flex items-center gap-1">
                                  <Sparkles className="w-3 h-3 text-[#1C4C96]" />
                                  <span>{isEn ? 'Gemini AI Contextual Story' : 'História Contextualizada Gemini AI'}</span>
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              {activeDayPassage?.text && (
                                <button
                                  type="button"
                                  onClick={() => speakText(activeDayPassage?.text || '')}
                                  className="px-2.5 py-1 bg-white text-[#000035] hover:bg-slate-100 rounded-lg border border-slate-200 transition flex items-center gap-1 text-[11px] font-bold cursor-pointer"
                                >
                                  <Volume2 className="w-3.5 h-3.5 text-[#1C4C96]" />
                                  <span>{memT.part4.listenBtn}</span>
                                </button>
                              )}
                              {!isPart4Completed && Object.keys(quizAnswers).length === 0 && (
                                <button
                                  type="button"
                                  onClick={() => handleGeneratePart4Story(true)}
                                  disabled={isGeneratingPart4Story}
                                  title={isEn ? 'Regenerate story with Gemini AI' : 'Regenerar história com Gemini AI'}
                                  className="px-2 py-1 bg-white text-slate-700 hover:text-[#000035] hover:bg-slate-100 rounded-lg border border-slate-200 transition flex items-center gap-1 text-[11px] font-bold cursor-pointer"
                                >
                                  <RefreshCw className={`w-3.5 h-3.5 text-[#1C4C96] ${isGeneratingPart4Story ? 'animate-spin' : ''}`} />
                                  <span>{isEn ? 'Regenerate' : 'Regenerar'}</span>
                                </button>
                              )}
                            </div>
                          </div>
                          <p className="text-xs sm:text-sm text-slate-700 leading-relaxed whitespace-pre-wrap font-normal">
                            {renderHighlightedPassage(activeDayPassage?.text || '')}
                          </p>
                        </div>

                        {/* Questions */}
                        <div className="space-y-3">
                          {(activeDayPassage?.questions || []).map((q, qIdx) => {
                            const selectedChoice = quizAnswers[q.id];
                            return (
                              <div
                                key={q.id}
                                className="p-3.5 bg-white rounded-xl border border-slate-200 space-y-2.5"
                              >
                                <div className="flex items-start gap-2">
                                  <span className="w-5 h-5 rounded-md bg-[#000035] text-white text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                                    {qIdx + 1}
                                  </span>
                                  <p className="text-xs font-semibold text-slate-900">{q.question}</p>
                                </div>

                                <div className="space-y-1 pl-7">
                                  {q.options.map((opt, optIdx) => {
                                    const isSelected = selectedChoice === optIdx;
                                    return (
                                      <div
                                        key={optIdx}
                                        onClick={() => {
                                          setQuizAnswers((prev) => ({
                                            ...prev,
                                            [q.id]: optIdx,
                                          }));
                                          if (aiEvaluation?.readingFeedback) {
                                            setAiEvaluation((prev) => {
                                              if (!prev || !prev.readingFeedback) return prev;
                                              return {
                                                ...prev,
                                                readingFeedback: prev.readingFeedback.map((rf: any) =>
                                                  (rf.id === q.id || rf.id === `q-${qIdx + 1}`)
                                                    ? { ...rf, isModified: true }
                                                    : rf
                                                ),
                                              };
                                            });
                                          }
                                          if (partsProgress.reading?.status === 'completed') {
                                            setPartsProgress((prev) => ({
                                              ...prev,
                                              reading: {
                                                ...prev.reading!,
                                                status: 'draft',
                                                answers: { ...quizAnswers, [q.id]: optIdx },
                                                updatedAt: new Date().toISOString(),
                                              },
                                            }));
                                          }
                                        }}
                                        className={`py-2 px-3 rounded-lg border text-xs font-medium transition cursor-pointer flex items-center gap-2 ${
                                          isSelected
                                            ? 'bg-[#000035] border-[#000035] text-white shadow-2xs font-semibold'
                                            : 'bg-slate-50/60 border-slate-200 text-slate-700 hover:bg-slate-100'
                                        }`}
                                      >
                                        <span className="w-4 h-4 rounded-full border border-current flex items-center justify-center text-[9px] shrink-0 font-bold">
                                          {String.fromCharCode(65 + optIdx)}
                                        </span>
                                        <span>{opt}</span>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </>
                    );
                  })()}

                  {/* Evaluation error / transparent unavailability notice */}
                  {evalError && (
                    <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-3 text-amber-900 text-xs">
                      <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                      <div className="flex-1 space-y-1.5">
                        <p className="font-bold text-amber-950">
                          {isEn ? 'Pedagogical Evaluation Unavailable' : 'Correção Pedagógica Temporariamente Indisponível'}
                        </p>
                        <p className="mt-0.5 text-amber-800 leading-relaxed">{evalError}</p>
                        <p className="mt-1 text-[11px] text-amber-700 font-medium">
                          {isEn
                            ? 'Your answers have been safely preserved in Firestore. You can try again below.'
                            : 'Suas respostas digitadas foram salvas com segurança no banco de dados. Você pode tentar novamente no botão abaixo.'}
                        </p>
                        <div className="pt-1">
                          <button
                            type="button"
                            onClick={handleSavePart4}
                            disabled={isSavingPart.reading}
                            className="px-3.5 py-1.5 bg-[#000035] hover:bg-[#062863] text-white rounded-lg text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer shadow-xs transition disabled:opacity-50"
                          >
                            <RefreshCw className={`w-3.5 h-3.5 text-[#9AB4FF] ${isSavingPart.reading ? 'animate-spin' : ''}`} />
                            <span>{isEn ? 'Retry AI Evaluation' : 'Tentar Novamente Avaliação da IA'}</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Action Bar & Save Part 4 */}
                  <div className="pt-3 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200">
                    <div className="flex items-center gap-2.5">
                      <button
                        type="button"
                        onClick={() => setActiveTab('writing')}
                        className="px-3.5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition cursor-pointer flex items-center gap-1.5"
                      >
                        <ArrowLeft className="w-4 h-4 text-[#1C4C96]" />
                        <span>{memT.part4.backBtn}</span>
                      </button>

                      {isPart4Completed ? (
                        <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-700 bg-emerald-50 px-3 py-1.5 rounded-xl border border-emerald-200">
                          <CheckCircle className="w-4 h-4 text-emerald-600" />
                          <span>{isEn ? 'Recorded on S-Path' : 'Gravado no S-Path'}</span>
                        </div>
                      ) : (
                        <span className="text-[11px] text-slate-500 font-medium">
                          {Object.keys(quizAnswers).length} / {(homework.readingPassage?.questions || []).length} {isEn ? 'answered' : 'respondidas'} • {isEn ? 'Answer all to record on S-Path' : 'Responda todas para gravar no S-Path'}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2.5">
                      <button
                        type="button"
                        onClick={handleSavePart4}
                        disabled={isSavingPart.reading}
                        className="px-5 py-2.5 bg-[#000035] hover:bg-[#062863] text-white rounded-xl font-bold text-xs flex items-center gap-2 shadow-xs cursor-pointer transition disabled:opacity-50"
                      >
                        <Save className="w-4 h-4 text-[#9AB4FF]" />
                        <span>{isEn ? 'Save Part 4' : 'Salvar Parte 4'}</span>
                      </button>

                      <button
                        type="button"
                        onClick={handleSubmit}
                        className="px-5 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl font-bold text-xs flex items-center gap-2 shadow-xs cursor-pointer transition"
                      >
                        <Send className="w-4 h-4 text-emerald-200" />
                        <span>{isEn ? 'Submit to Teacher' : 'Enviar ao Professor'}</span>
                      </button>
                    </div>
                  </div>

                  {/* STAGE-BY-STAGE PEDAGOGICAL CORRECTIONS (Part 4) */}
                  <div className="pt-4 border-t border-slate-200 space-y-4">
                    <h4 className="font-bold text-xs uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                      <CheckSquare className="w-4 h-4 text-[#1C4C96]" />
                      <span>{isEn ? 'STAGE-BY-STAGE PEDAGOGICAL CORRECTIONS' : 'CORREÇÃO PEDAGÓGICA PASSO A PASSO'}</span>
                    </h4>

                    {/* Part 4 Questions Feedback Card */}
                    <div className="p-4 bg-white rounded-2xl border border-slate-200 space-y-3 shadow-xs">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <span className="text-xs font-bold text-[#000035]">
                          {isEn ? 'Part 4: Mini-Story Reading' : 'Parte 4: Interpretação de Texto'}
                        </span>
                        <span className="text-[11px] text-slate-500 font-semibold">
                          {(homework.readingPassage?.questions || []).length} {isEn ? 'questions' : 'perguntas'}
                        </span>
                      </div>

                      {routineActivityNames.length > 0 && (
                        <div className="text-[11px] text-[#1C4C96] bg-blue-50/90 p-2.5 rounded-lg border border-blue-200 font-medium">
                          <span className="font-bold text-[#000035] mr-1.5">{isEn ? 'Story Context:' : 'Contexto das Atividades:'}</span>
                          {routineActivityNames.join(' • ')}
                        </div>
                      )}

                      <div className="space-y-2">
                        {(homework.readingPassage?.questions || []).map((q, idx) => {
                          const chosenIdx = quizAnswers[q.id] !== undefined ? quizAnswers[q.id] : quizAnswers[String(idx)];
                          const isAnswered = chosenIdx !== undefined && chosenIdx !== null && typeof chosenIdx === 'number';
                          const rfItem = aiEvaluation?.readingFeedback?.find((rf: any) => rf.id === q.id || rf.id === `q-${idx + 1}`);
                          const isEvaluated = Boolean(rfItem && !rfItem.isModified);
                          const isQuizCorrect = isEvaluated
                            ? Boolean(rfItem?.isCorrect)
                            : (isAnswered && chosenIdx === q.correctAnswer);
                          const chosenText = isAnswered && q.options?.[chosenIdx] ? q.options[chosenIdx] : (isAnswered ? String(chosenIdx) : '');
                          const correctText = q.options?.[q.correctAnswer] || '';
                          const explanation = isEn
                            ? (rfItem?.explanationEn || q.explanation)
                            : (rfItem?.explanationPt || q.explanation);

                          return (
                            <div
                              key={q.id}
                              className={`p-3 rounded-xl border text-xs space-y-1.5 transition ${
                                !isAnswered
                                  ? 'bg-slate-50/70 border-slate-200'
                                  : !isEvaluated
                                  ? 'bg-blue-50/50 border-blue-200'
                                  : isQuizCorrect
                                  ? 'bg-emerald-50/60 border-emerald-200'
                                  : 'bg-amber-50/60 border-amber-200'
                              }`}
                            >
                              <p className="font-semibold text-slate-900">
                                {idx + 1}. {q.question}
                              </p>
                              <div className="flex flex-wrap items-center justify-between gap-1 text-[11px]">
                                {!isAnswered ? (
                                  <span className="text-[11px] font-semibold text-slate-500">
                                    ⏳ {isEn ? 'Pending / Not answered' : 'Pendente / Não respondido'}
                                  </span>
                                ) : !isEvaluated ? (
                                  <span className="text-[11px] font-semibold text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
                                    ⏳ {isEn ? 'Pending AI Evaluation' : 'Aguardando Avaliação da IA'}
                                  </span>
                                ) : (
                                  <span className={isQuizCorrect ? 'text-emerald-700 font-bold' : 'text-amber-700 font-bold'}>
                                    {isQuizCorrect
                                      ? `✓ ${isEn ? 'Correct Answer' : 'Resposta Correta'}: ${chosenText}`
                                      : `✗ ${isEn ? 'Your choice' : 'Sua escolha'}: ${chosenText} → ${isEn ? 'Correct' : 'Correta'}: ${correctText}`}
                                  </span>
                                )}
                              </div>
                              {explanation && (
                                <p className="text-[11px] text-slate-600 italic">
                                  {explanation}
                                </p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* AI Tutor Pedagogical Feedback Summary */}
                    {aiEvaluation && (
                      <div className="p-4 bg-gradient-to-br from-indigo-50/60 to-blue-50/60 rounded-2xl border border-indigo-100 space-y-3">
                        <div className="flex items-center gap-2 text-xs font-bold text-[#000035]">
                          <MessageSquare className="w-4 h-4 text-[#1C4C96]" />
                          <span>
                            {isEn
                              ? `Native Friend AI Tutor Feedback (${aiEvaluation.studentLevel || homework.studentLevel || 'Calibrated'})`
                              : `Feedback do Amigo Nativo IA (${aiEvaluation.studentLevel || homework.studentLevel || 'Calibrado'})`}
                          </span>
                        </div>
                        <p className="text-xs text-slate-700 leading-relaxed font-medium">
                          {isEn
                            ? (aiEvaluation.tutorFeedbackSummaryEn || aiEvaluation.tutorFeedbackSummaryPt)
                            : (aiEvaluation.tutorFeedbackSummaryPt || aiEvaluation.tutorFeedbackSummaryEn)}
                        </p>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                          {Boolean(aiEvaluation.levelStrengthsPt || aiEvaluation.levelStrengthsEn) && (
                            <div className="p-3 bg-white/90 rounded-xl border border-emerald-100 space-y-1">
                              <span className="text-[11px] font-bold text-emerald-800 flex items-center gap-1">
                                <CheckCircle className="w-3.5 h-3.5 text-emerald-600" />
                                {isEn ? 'Demonstrated Strengths' : 'Pontos Fortes'}
                              </span>
                              <p className="text-[11px] text-slate-600 leading-normal">
                                {isEn
                                  ? (aiEvaluation.levelStrengthsEn || aiEvaluation.levelStrengthsPt)
                                  : (aiEvaluation.levelStrengthsPt || aiEvaluation.levelStrengthsEn)}
                              </p>
                            </div>
                          )}

                          {Boolean(aiEvaluation.levelNextStepsPt || aiEvaluation.levelNextStepsEn) && (
                            <div className="p-3 bg-white/90 rounded-xl border border-blue-100 space-y-1">
                              <span className="text-[11px] font-bold text-[#1C4C96] flex items-center gap-1">
                                <Compass className="w-3.5 h-3.5 text-[#1C4C96]" />
                                {isEn ? 'Next Step Focus' : 'Próximos Passos'}
                              </span>
                              <p className="text-[11px] text-slate-600 leading-normal">
                                {isEn
                                  ? (aiEvaluation.levelNextStepsEn || aiEvaluation.levelNextStepsPt)
                                  : (aiEvaluation.levelNextStepsPt || aiEvaluation.levelNextStepsEn)}
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Routine Activities Practiced Banner */}
                    {routineActivityNames.length > 0 && (
                      <div className="p-4 bg-blue-50/90 rounded-2xl border border-blue-200 space-y-2 shadow-xs">
                        <div className="flex items-center gap-2 text-xs font-bold text-[#000035]">
                          <Layers className="w-4 h-4 text-[#1C4C96]" />
                          <span>
                            {isEn ? 'Routine Activities Practiced This Week:' : 'Atividades da Rotina Praticadas Nesta Semana:'}
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-2 pt-0.5">
                          {routineActivityNames.map((actName, idx) => (
                            <span
                              key={idx}
                              className="px-3 py-1 rounded-xl bg-white border border-blue-200 text-xs font-bold text-[#000035] shadow-2xs flex items-center gap-1.5"
                            >
                              <span className="w-2 h-2 rounded-full bg-[#1C4C96]" />
                              {actName}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Vocabulary Key */}
                    <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-2 text-xs">
                      <span className="font-bold text-[#000035] uppercase text-[11px] block">
                        {memT.results.vocabKeyLabel}
                      </span>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {homework.matchingPairs.map((item, idx) => {
                          const actName = wordToActivityMap[item.word.toLowerCase()];
                          return (
                            <div key={idx} className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-200 pb-1.5 pt-1 text-xs gap-1.5">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="font-bold text-slate-800 capitalize">{item.word}</span>
                                {actName && (
                                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-blue-100/90 text-[#000035] border border-blue-200">
                                    {actName}
                                  </span>
                                )}
                              </div>
                              <span className="text-slate-500 italic text-[11px]">
                                {currentLanguage === 'en'
                                  ? item.definition
                                  : item.translation
                                    ? `${item.translation} (${item.definition})`
                                    : item.definition}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
          </>
        )}
      </div>
    </div>
  );
};

