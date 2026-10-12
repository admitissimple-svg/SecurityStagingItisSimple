import React, { useState, useMemo } from 'react';
import {
  Sparkles,
  CheckCircle2,
  Video,
  Coffee,
  Headphones,
  Users,
  Award,
  BookOpen,
  PenTool,
  Calendar,
  ChevronRight,
  Flame,
  Check,
  Play,
  ArrowRight,
  Info,
} from 'lucide-react';
import {
  DayOfWeek,
  Language,
  LiveLesson,
  RoutineItem,
  UserProfile,
  WeeklyHomeworkData,
  StudentDictionaryEntry,
} from '../types';
import { getTranslations } from '../utils/i18n';
import { DAYS_OF_WEEK, getDayLabel } from '../utils/notifications';

export interface SFluencyTrackerProps {
  mode?: 'demo' | 'student';
  currentLanguage: Language;
  // Demo Mode Prop
  onExploreRoutines?: () => void;

  // Student Live Mode Props
  routinesByDay?: Record<DayOfWeek, RoutineItem[]>;
  selectedDay?: DayOfWeek;
  userProfile?: UserProfile;
  lessons?: LiveLesson[];
  weeklyHomework?: WeeklyHomeworkData | null;
  dictionaryEntries?: StudentDictionaryEntry[];
  onSelectDay?: (day: DayOfWeek) => void;
  onSelectActivity?: (activityId: string) => void;
  onToggleActivityComplete?: (activityId: string) => void;
  onOpenDailySentence?: () => void;
  onOpenScheduleLesson?: () => void;
  onOpenHomework?: () => void;
}

interface DemoRoutineStep {
  id: string;
  time: string;
  title: Record<Language, string>;
  subtitle: Record<Language, string>;
  icon: any;
  defaultChecked: boolean;
}

const DEMO_DAILY_STEPS: DemoRoutineStep[] = [
  {
    id: 'video_day',
    time: '07:30',
    icon: Video,
    defaultChecked: true,
    title: {
      pt: 'Vídeo do Dia',
      en: 'Video of the Day',
      es: 'Video del Día',
      fr: 'Vidéo du Jour',
      de: 'Video des Tages',
      it: 'Video del Giorno',
      ja: '今日の動画',
      ko: '오늘의 비디오',
      zh: '今日视频',
      ru: 'Видео дня',
      ar: 'فيديو اليوم',
      tr: 'Günün Videosu',
    },
    subtitle: {
      pt: 'Assista ao vídeo e anote suas palavras-chave',
      en: 'Watch the video and note down your key words',
      es: 'Mira el video y anota tus palabras clave',
      fr: 'Regardez la vidéo et notez vos mots-clés',
      de: 'Schau das Video und notiere deine Schlüsselwörter',
      it: 'Guarda il video e annota le tue parole chiave',
      ja: '動画を視聴してキーワードをメモ',
      ko: '동영상을 시청하고 키워드를 기록하세요',
      zh: '观看视频并记录核心关键词',
      ru: 'Посмотрите видео и запишите ключевые слова',
      ar: 'شاهد الفيديو ودون كلماتك الأساسية',
      tr: 'Videoyu izleyin ve anahtar kelimelerinizi not edin',
    },
  },
  {
    id: 'audio_day',
    time: '08:30',
    icon: Headphones,
    defaultChecked: true,
    title: {
      pt: 'Áudio do Dia: Podcast ou Música',
      en: 'Audio of the Day: Podcast or Music',
      es: 'Audio del Día: Podcast o Música',
      fr: 'Audio du Jour : Podcast ou Musique',
      de: 'Audio des Tages: Podcast oder Musik',
      it: 'Audio del Giorno: Podcast o Musica',
      ja: '今日の音声: ポッドキャストまたは音楽',
      ko: '오늘의 오디오: 팟캐스트 또는 음악',
      zh: '今日音频: 播客或音乐',
      ru: 'Аудио дня: Подкаст или музыка',
      ar: 'صوت اليوم: بودكاست أو موسيقى',
      tr: 'Günün Sesi: Podcast veya Müzik',
    },
    subtitle: {
      pt: '15 min de escuta e imersão no trajeto',
      en: '15 min immersion & listening on the way',
      es: '15 min de escucha e inmersión en el trayecto',
      fr: '15 min d\'écoute et immersion sur le trajet',
      de: '15 Min. Hören & Immersion unterwegs',
      it: '15 min di ascolto e immersione nel tragitto',
      ja: '移動中に15分間のリスニング環境',
      ko: '이동 중 15분 청취 및 몰입',
      zh: '通勤途中倾听与沉浸练习15分钟',
      ru: '15 минут прослушивания и погружения в пути',
      ar: '15 دقيقة استماع وانغماس في الطريق',
      tr: 'Yolda 15 dakika dinleme ve pratik',
    },
  },
  {
    id: 'tutor_live',
    time: '15:00',
    icon: Users,
    defaultChecked: true,
    title: {
      pt: 'Conversa com Seu Amigo Nativo',
      en: 'Chat with Your Native Friend',
      es: 'Charla con tu Amigo Nativo',
      fr: 'Échange avec votre Ami Natif',
      de: 'Gespräch mit deinem Muttersprachler-Freund',
      it: 'Conversazione con il tuo Amico Nativo',
      ja: 'ネイティブの友達と30分トーク',
      ko: '원어민 친구와 30분 실전 대화',
      zh: '与母语外教好友进行30分钟对话',
      ru: 'Разговор с носителем языка',
      ar: 'محادثة حية مع صديقك المتحدث الأصلي',
      tr: 'Anadili İngilizce Olan Arkadaşınla Sohbet',
    },
    subtitle: {
      pt: '25 ou 50 min de fala natural sobre sua rotina',
      en: '25 or 50 min natural talk about your day',
      es: '25 o 50 min de charla natural sobre tu día',
      fr: '25 ou 50 min de conversation naturelle sur votre journée',
      de: '25 oder 50 Min. natürliches Sprechen über deinen Tag',
      it: '25 o 50 min di conversazione naturale sulla tua giornata',
      ja: '25分または50分の日常英会話',
      ko: '25분 또는 50분의 일상 대화',
      zh: '25或50分钟围绕日常生活的自然英语交流',
      ru: '25 или 50 минут живого общения о вашем дне',
      ar: '25 أو 50 دقيقة محادثة طبيعية عن يومك',
      tr: 'Gününüz hakkında 25 veya 50 dk doğal konuşma',
    },
  },
  {
    id: 'memorization',
    time: '21:30',
    icon: BookOpen,
    defaultChecked: false,
    title: {
      pt: 'Atividade de Memorização & Fixação',
      en: 'Memorization Activity & Consolidation',
      es: 'Actividad de Memorización y Fijación',
      fr: 'Activité de Mémorisation et Fixation',
      de: 'Merkaktivität & Festigung',
      it: 'Attività di Memorizzazione e Fissaggio',
      ja: '記憶定着アクティビティと振り返り',
      ko: '암기 및 복습 활동',
      zh: '记忆巩固活动与每日回顾',
      ru: 'Упражнение на запоминание и закрепление',
      ar: 'نشاط الحفظ والترسيخ',
      tr: 'Ezberleme & Pekiştirme Aktivitesi',
    },
    subtitle: {
      pt: 'Fixação leve das palavras do dia',
      en: 'Light practice of the words of the day',
      es: 'Fijación ligera de las palabras del día',
      fr: 'Pratique légère des mots du jour',
      de: 'Leichte Festigung der Tageswörter',
      it: 'Consolidamento leggero delle parole del giorno',
      ja: '今日学んだ単語を楽しく復習',
      ko: '오늘의 단어를 가볍게 복습',
      zh: '轻松复习今日所学单词',
      ru: 'Легкое закрепление слов за день',
      ar: 'ترسيخ خفيف لكلمات اليوم',
      tr: 'Günün kelimelerini hafifçe pekiştirme',
    },
  },
];

export const SFluencyTracker: React.FC<SFluencyTrackerProps> = ({
  mode = 'demo',
  currentLanguage,
  onExploreRoutines,
  routinesByDay,
  selectedDay = 'monday',
  userProfile,
  lessons = [],
  weeklyHomework,
  dictionaryEntries,
  onSelectDay,
  onSelectActivity,
  onToggleActivityComplete,
  onOpenDailySentence,
  onOpenScheduleLesson,
  onOpenHomework,
}) => {
  const isEn = currentLanguage === 'en';
  const t = getTranslations(currentLanguage);

  // --- DEMO MODE STATE (Purely isolated showcase for landing page) ---
  const [demoCompletedSteps, setDemoCompletedSteps] = useState<Record<string, boolean>>({
    video_day: true,
    audio_day: true,
    tutor_live: true,
    memorization: false,
  });

  const toggleDemoStep = (id: string) => {
    setDemoCompletedSteps((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  // --- STUDENT MODE LIVE DATA CALCULATIONS ---
  const studentWeeklyStats = useMemo(() => {
    if (mode !== 'student' || !routinesByDay) {
      return null;
    }

    // 1. All week routines (strictly scheduled study days, ignoring video repeat actions)
    let totalWeekActivities = 0;
    let completedWeekActivities = 0;
    let activitiesWithWords = 0;
    let totalWordsRecorded = 0;

    const uniqueWordsSet = new Set<string>();

    const activeStudyDays =
      userProfile?.weeklyStudyDays && userProfile.weeklyStudyDays.length > 0
        ? userProfile.weeklyStudyDays
        : DAYS_OF_WEEK;

    DAYS_OF_WEEK.forEach((dayKey) => {
      // Strictly calculate based on unique daily completions for the scheduled day
      if (!activeStudyDays.includes(dayKey)) {
        return;
      }

      const dayList = (routinesByDay && routinesByDay[dayKey]) || [];
      dayList.forEach((act) => {
        totalWeekActivities += 1;
        if (act.completed || act.completedToday) {
          completedWeekActivities += 1;
        }
        const words = act.learnedWords ? act.learnedWords.filter((w) => w && w.trim().length > 0) : [];
        words.forEach((w) => uniqueWordsSet.add(w.trim().toLowerCase()));
        if (words.length >= 3) {
          activitiesWithWords += 1;
        }
      });
    });

    // Also include words from personal dictionary (saved by native friends or student)
    if (Array.isArray(dictionaryEntries)) {
      dictionaryEntries.forEach((entry) => {
        const w = (entry?.word || '').trim().toLowerCase();
        if (w) uniqueWordsSet.add(w);
      });
    }

    totalWordsRecorded = uniqueWordsSet.size;

    // 2. Current selected day routines
    const currentDayList = routinesByDay[selectedDay] || [];
    const currentDayTotal = currentDayList.length;
    const currentDayCompleted = currentDayList.filter((a) => a.completed).length;

    // 3. Sentence of the day (Journal check)
    const hasDailySentenceToday = Boolean(
      userProfile?.dailyJournalSentence && userProfile.dailyJournalSentence.trim().length > 5
    );

    // 4. Live lessons scheduled or completed with Native Friend
    const hasLiveLessonsScheduled = lessons.length > 0;
    const completedLiveLessons = lessons.filter((l) => l.status === 'completed').length;

    // 5. Weekly Homework / Memorization Activity
    const isHomeworkSubmitted = Boolean(weeklyHomework?.status === 'submitted' || weeklyHomework?.status === 'graded');
    const hasCompletedParts = Boolean(
      weeklyHomework?.isCompleted ||
      weeklyHomework?.isDayPartCompleted ||
      (weeklyHomework?.completedPartsByDay && Object.values(weeklyHomework.completedPartsByDay).some(Boolean))
    );
    const hasAnyAnswers = Boolean(
      (weeklyHomework?.studentAnswers?.matching && Object.keys(weeklyHomework.studentAnswers.matching).length > 0) ||
      (weeklyHomework?.studentAnswers?.fillInBlanks && Object.keys(weeklyHomework.studentAnswers.fillInBlanks).length > 0) ||
      (weeklyHomework?.studentAnswers?.sentences && Object.keys(weeklyHomework.studentAnswers.sentences).length > 0) ||
      (weeklyHomework?.studentAnswers?.quizAnswers && Object.keys(weeklyHomework.studentAnswers.quizAnswers).length > 0) ||
      (weeklyHomework?.answers && Object.keys(weeklyHomework.answers).length > 0)
    );
    const hasHomeworkProgress = isHomeworkSubmitted || hasCompletedParts || hasAnyAnswers;

    // Milestone Steps Definition for real student
    const steps = [
      {
        id: 'routines_milestone',
        icon: Coffee,
        title: isEn ? 'Daily Routine Moments' : 'Momentos da Rotina Diária',
        subtitle: isEn
          ? `${completedWeekActivities} of ${totalWeekActivities} moments lived this week`
          : `${completedWeekActivities} de ${totalWeekActivities} momentos praticados na semana`,
        isCompleted: totalWeekActivities > 0 && completedWeekActivities >= Math.max(1, Math.round(totalWeekActivities * 0.7)),
        percentContribution: 30,
        actionLabel: isEn ? 'View routines' : 'Ver rotinas',
        onAction: () => onSelectDay && onSelectDay(selectedDay),
      },
      {
        id: 'words_milestone',
        icon: Headphones,
        title: isEn ? '5 Key Words Recorded' : '5 Palavras-Chave da Rotina',
        subtitle: isEn
          ? `${totalWordsRecorded} words recorded in your personal dictionary`
          : `${totalWordsRecorded} palavras anotadas no seu vocabulário ativo`,
        isCompleted: totalWordsRecorded >= 10,
        percentContribution: 25,
        actionLabel: isEn ? 'Record words' : 'Anotar palavras',
        onAction: () => {
          if (currentDayList.length > 0 && onSelectActivity) {
            onSelectActivity(currentDayList[0].id);
          }
        },
      },
      {
        id: 'sentence_milestone',
        icon: PenTool,
        title: isEn ? 'Sentence of the Day' : 'Frase de Encerramento do Dia',
        subtitle: hasDailySentenceToday
          ? isEn ? 'Today\'s journal sentence recorded with AI!' : 'Frase do dia registrada no diário com IA!'
          : isEn ? 'Wrap up your day with a sentence in English' : 'Encerre o dia registrando sua frase em inglês',
        isCompleted: hasDailySentenceToday,
        percentContribution: 20,
        actionLabel: isEn ? 'Write sentence' : 'Escrever frase',
        onAction: onOpenDailySentence,
      },
      {
        id: 'native_friend_milestone',
        icon: Users,
        title: isEn ? 'Live Native Friend Chat' : 'Conversa com Amigo Nativo',
        subtitle: hasLiveLessonsScheduled
          ? isEn
            ? `${lessons.length}/${userProfile?.weeklyNativeLessonsTarget || 1} session(s) booked / completed`
            : `${lessons.length}/${userProfile?.weeklyNativeLessonsTarget || 1} aula(s) agendada(s) no Google Meet`
          : isEn
          ? `Schedule your session (Goal: ${userProfile?.weeklyNativeLessonsTarget || 1}x/wk)`
          : `Agende sua sessão (Meta: ${userProfile?.weeklyNativeLessonsTarget || 1}x/sem)`,
        isCompleted: hasLiveLessonsScheduled,
        percentContribution: 15,
        actionLabel: isEn ? 'Schedule meet' : 'Agendar aula',
        onAction: onOpenScheduleLesson,
      },
      {
        id: 'memorization_milestone',
        icon: BookOpen,
        title: isEn ? 'Weekly Memorization Activity' : 'Atividade de Memorização',
        subtitle: isHomeworkSubmitted
          ? isEn ? 'Weekly review submitted to Native Friend!' : 'Atividade de memorização entregue ao mentor!'
          : hasHomeworkProgress
          ? isEn ? 'In progress — practice your vocabulary' : 'Em andamento — fixe suas palavras'
          : isEn ? 'Consolidate all weekly words' : 'Fixe e memorize todo o vocabulário da semana',
        isCompleted: isHomeworkSubmitted || hasHomeworkProgress,
        percentContribution: 10,
        actionLabel: isEn ? 'Open activity' : 'Abrir atividade',
        onAction: onOpenHomework,
      },
    ];

    // Compute progress percent
    const completedStepsCount = steps.filter((s) => s.isCompleted).length;
    let computedPercent = 0;
    steps.forEach((st) => {
      if (st.isCompleted) {
        computedPercent += st.percentContribution;
      }
    });

    // Ensure 100% when all steps are completed
    if (completedStepsCount === steps.length) {
      computedPercent = 100;
    }

    return {
      totalWeekActivities,
      completedWeekActivities,
      totalWordsRecorded,
      hasDailySentenceToday,
      hasLiveLessonsScheduled,
      hasHomeworkProgress,
      steps,
      completedStepsCount,
      progressPercent: Math.min(100, computedPercent),
    };
  }, [
    mode,
    routinesByDay,
    selectedDay,
    userProfile,
    lessons,
    weeklyHomework,
    isEn,
    onSelectDay,
    onSelectActivity,
    onOpenDailySentence,
    onOpenScheduleLesson,
    onOpenHomework,
  ]);

  // Determine progress percentage and active milestone states
  const progressPercent = useMemo(() => {
    if (mode === 'student' && studentWeeklyStats) {
      return studentWeeklyStats.progressPercent;
    }
    const demoCompletedCount = Object.values(demoCompletedSteps).filter(Boolean).length;
    return Math.round((demoCompletedCount / DEMO_DAILY_STEPS.length) * 100);
  }, [mode, studentWeeklyStats, demoCompletedSteps]);

  // Calculate SVG stroke offset for S curve (total length approx 260)
  const pathTotalLength = 260;
  const strokeDashoffset = pathTotalLength - (pathTotalLength * progressPercent) / 100;

  return (
    <div
      className={`relative rounded-3xl p-4 sm:p-5 border-2 shadow-2xl text-white overflow-hidden space-y-3.5 animate-in fade-in zoom-in-95 duration-500 ${
        mode === 'student'
          ? 'bg-gradient-to-br from-[#000035] via-[#062863] to-[#1C4C96] border-[#607EC9]'
          : 'bg-gradient-to-br from-[#000035] via-[#062863] to-[#1C4C96] border-[#607EC9]'
      }`}
      id="s-fluency-path-tracker"
    >
      {/* Background ambient lighting */}
      <div className="absolute -top-12 -right-12 w-48 h-48 rounded-full bg-[#9AB4FF]/15 blur-2xl pointer-events-none" />
      <div className="absolute -bottom-12 -left-12 w-48 h-48 rounded-full bg-[#607EC9]/20 blur-2xl pointer-events-none" />

      {/* Header Banner */}
      <div className="relative z-10 space-y-1.5">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#000035]/80 border border-[#9AB4FF]/50 text-[#9AB4FF] text-[11px] font-black uppercase tracking-wider shadow-xs">
              <Sparkles className="w-3 h-3 text-[#F4CA54] animate-pulse" />
              <span>
                {mode === 'student'
                  ? isEn ? 'Your Weekly S-Fluency Path' : 'Seu Caminho do S para a Fluência'
                  : t.sSymbolTitle}
              </span>
            </div>

            {mode === 'student' && (
              <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-400/40 text-emerald-300 text-[10px] font-bold uppercase tracking-wider flex items-center gap-1">
                <Flame className="w-3 h-3 text-emerald-400" />
                {isEn ? 'Live Weekly Progress' : 'Progresso Real'}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5 px-2 py-0.5 bg-[#1C4C96]/70 rounded-full border border-[#9AB4FF]/40 text-[11px] font-mono font-black text-white">
            <span className="text-[#F4CA54]">{progressPercent}%</span>
            <span className="text-[9px] text-[#9AB4FF] font-normal uppercase tracking-tight">
              {isEn ? 'Target' : 'Meta'}
            </span>
          </div>
        </div>

        <p className="text-[11px] text-[#9AB4FF]/90 leading-tight font-medium">
          {mode === 'student'
            ? isEn
              ? 'Connected in real time to your daily living moments, words bank, mentor chats and memorization!'
              : 'Conectado em tempo real às suas rotinas, palavras anotadas, conversas e memorização semanal!'
            : t.sSymbolSubtitle}
        </p>
      </div>

      {/* S-Pathway Center Visual Stage */}
      <div className="relative z-10 bg-[#000035]/70 rounded-2xl p-3 border border-[#607EC9]/40 flex flex-row items-center gap-3.5">
        {/* The Animated S-Curve Vector */}
        <div className="relative w-24 h-24 sm:w-28 sm:h-28 shrink-0 flex items-center justify-center">
          <svg
            viewBox="0 0 100 100"
            className="w-full h-full drop-shadow-md"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <defs>
              {/* Base track gradient */}
              <linearGradient id="sTrackBg" x1="15" y1="85" x2="85" y2="15" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="#1C4C96" stopOpacity="0.4" />
                <stop offset="100%" stopColor="#607EC9" stopOpacity="0.3" />
              </linearGradient>

              {/* Glowing active progress gradient */}
              <linearGradient id="sTrackActive" x1="15" y1="85" x2="85" y2="15" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="#9AB4FF" />
                <stop offset="50%" stopColor="#607EC9" />
                <stop offset="85%" stopColor="#9AB4FF" />
                <stop offset="100%" stopColor="#F4CA54" />
              </linearGradient>

              {/* Fluency star glow */}
              <radialGradient id="fluencyGlow" cx="80" cy="20" r="16" gradientUnits="userSpaceOnUse">
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
              stroke="url(#sTrackBg)"
              strokeWidth="10"
              strokeLinecap="round"
              strokeLinejoin="round"
            />

            {/* Active S Path illuminated progress */}
            <path
              d="M 24 78 C 36 86, 68 84, 68 66 C 68 52, 32 48, 32 34 C 32 18, 62 14, 76 22"
              stroke="url(#sTrackActive)"
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
            {/* Step 1: Start (Bottom Left) */}
            <circle
              cx="24"
              cy="78"
              r="4"
              fill={progressPercent >= 20 ? '#9AB4FF' : '#1C4C96'}
              stroke="#000035"
              strokeWidth="1.5"
            />
            {/* Step 2: Mid-curve 1 */}
            <circle
              cx="66"
              cy="66"
              r="4"
              fill={progressPercent >= 45 ? '#9AB4FF' : '#1C4C96'}
              stroke="#000035"
              strokeWidth="1.5"
            />
            {/* Step 3: Mid-curve 2 */}
            <circle
              cx="32"
              cy="34"
              r="4"
              fill={progressPercent >= 70 ? '#9AB4FF' : '#1C4C96'}
              stroke="#000035"
              strokeWidth="1.5"
            />
            {/* Step 4: Top Right Fluency Goal */}
            <circle
              cx="76"
              cy="22"
              r="4"
              fill={progressPercent >= 100 ? '#F4CA54' : '#1C4C96'}
              stroke="#000035"
              strokeWidth="1.5"
            />

            {/* Fluency Beacon Star at top right */}
            <circle cx="80" cy="20" r="10" fill="url(#fluencyGlow)" />
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

        {/* Progress Metric & Message */}
        <div className="space-y-1.5 text-left flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-xl sm:text-2xl font-black text-white tracking-tight">
              {progressPercent}%
            </span>
            <span className="text-[11px] font-bold text-[#9AB4FF] uppercase tracking-wide">
              {mode === 'student'
                ? isEn ? 'Weekly S-Fluency Score' : 'Pontuação do S da Fluência'
                : t.sSymbolPathProgress}
            </span>
          </div>

          <p className="text-[11px] text-[#9AB4FF]/85 leading-snug">
            {progressPercent === 100 ? (
              <span className="text-[#F4CA54] font-black flex items-center gap-1">
                <Sparkles className="w-3.5 h-3.5 text-[#F4CA54] shrink-0" />
                {isEn
                  ? '🎉 Outstanding! You completed 100% of your weekly living English path!'
                  : '🎉 Extraordinário! Você cumpriu 100% de todas as etapas programadas da sua semana!'}
              </span>
            ) : mode === 'student' && studentWeeklyStats ? (
              isEn
                ? `${studentWeeklyStats.completedStepsCount} of ${studentWeeklyStats.steps.length} weekly milestones completed. Keep living your English daily!`
                : `${studentWeeklyStats.completedStepsCount} de ${studentWeeklyStats.steps.length} etapas semanais concluídas. Cada momento praticado ilumina sua fluência!`
            ) : (
              isEn
                ? 'Try ticking off routines to see how the S-path reaches 100% fluency!'
                : 'Marque os momentos para ver como o caminho do S avança até a fluência natural!'
            )}
          </p>

          <div className="w-full bg-[#000035] rounded-full h-2 overflow-hidden border border-[#607EC9]/40">
            <div
              className="bg-gradient-to-r from-[#9AB4FF] via-[#607EC9] to-[#F4CA54] h-full transition-all duration-500 rounded-full"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
      </div>

      {/* Steps List: Real Live Student Mode vs Showcase Demo Mode */}
      {mode === 'student' && studentWeeklyStats ? (
        <div className="relative z-10 space-y-2.5">
          <div className="flex items-center justify-between text-[11px] text-[#9AB4FF] font-bold">
            <span className="flex items-center gap-1.5">
              <Flame className="w-3.5 h-3.5 text-[#F4CA54]" />
              {isEn ? 'Your Weekly Milestones & Actions:' : 'Suas Etapas & Metas da Semana:'}
            </span>
            <span className="text-[10px] text-[#9AB4FF]/70">
              {studentWeeklyStats.completedStepsCount}/{studentWeeklyStats.steps.length}{' '}
              {isEn ? 'completed' : 'concluídas'}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
            {studentWeeklyStats.steps.map((st) => {
              const Icon = st.icon;
              return (
                <div
                  key={st.id}
                  className={`p-3.5 rounded-2xl border transition flex items-center justify-between gap-3 ${
                    st.isCompleted
                      ? 'bg-[#062863]/90 border-emerald-500/50 shadow-xs'
                      : 'bg-[#000035]/70 border-[#1C4C96]/60 hover:border-[#607EC9]/60'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 border transition ${
                        st.isCompleted
                          ? 'bg-emerald-600/30 border-emerald-400 text-emerald-300'
                          : 'bg-[#000035] border-[#607EC9]/40 text-[#9AB4FF]/70'
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                    </div>

                    <div className="min-w-0">
                      <h4
                        className={`text-xs font-black truncate flex items-center gap-1.5 ${
                          st.isCompleted ? 'text-emerald-200' : 'text-white'
                        }`}
                      >
                        <span>{st.title}</span>
                        {st.isCompleted && <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />}
                      </h4>
                    </div>
                  </div>

                  <div className="shrink-0">
                    {st.isCompleted ? (
                      <div className="w-6 h-6 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center border border-emerald-400">
                        <CheckCircle2 className="w-4 h-4" />
                      </div>
                    ) : (
                      st.onAction && (
                        <button
                          type="button"
                          onClick={st.onAction}
                          className="px-2.5 py-1 rounded-xl bg-[#1C4C96] hover:bg-[#607EC9] text-white text-[10px] font-bold transition cursor-pointer flex items-center gap-1 shadow-xs whitespace-nowrap active:scale-95"
                        >
                          <span>{st.actionLabel}</span>
                          <ChevronRight className="w-3 h-3" />
                        </button>
                      )
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        /* Demo Mode Step Items (Interactive showcase for prospective visitors) */
        <div className="relative z-10 space-y-1.5">
          <div className="flex items-center justify-between text-[11px] text-[#9AB4FF] font-bold">
            <span>{t.sSymbolInteractiveHint}</span>
            <span className="text-[10px] text-[#9AB4FF]/70">
              {isEn ? 'Click to mark' : 'Clique para marcar'}
            </span>
          </div>

          <div className="grid grid-cols-1 gap-1.5">
            {DEMO_DAILY_STEPS.map((step) => {
              const Icon = step.icon;
              const isChecked = Boolean(demoCompletedSteps[step.id]);

              return (
                <button
                  key={step.id}
                  type="button"
                  onClick={() => toggleDemoStep(step.id)}
                  className={`w-full py-2 px-3 rounded-xl border text-left transition flex items-center justify-between gap-2.5 cursor-pointer ${
                    isChecked
                      ? 'bg-[#062863]/90 border-[#607EC9] shadow-xs'
                      : 'bg-[#000035]/60 border-[#1C4C96]/60 hover:border-[#607EC9]/60 opacity-75'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div
                      className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 border transition ${
                        isChecked
                          ? 'bg-[#1C4C96] border-[#9AB4FF] text-white'
                          : 'bg-[#000035] border-[#607EC9]/40 text-[#9AB4FF]/60'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-mono font-bold text-[#9AB4FF] px-1.5 py-0.2 rounded bg-[#000035]/70 border border-[#9AB4FF]/20 shrink-0">
                          {step.time}
                        </span>
                        <h4
                          className={`text-xs sm:text-sm font-black truncate ${
                            isChecked ? 'text-white' : 'text-slate-300'
                          }`}
                        >
                          {step.title[currentLanguage] || step.title.pt}
                        </h4>
                      </div>
                    </div>
                  </div>

                  <div className="shrink-0">
                    {isChecked ? (
                      <div className="w-5 h-5 rounded-full bg-[#1C4C96] text-[#9AB4FF] flex items-center justify-center border border-[#9AB4FF]">
                        <CheckCircle2 className="w-3.5 h-3.5 text-[#9AB4FF]" />
                      </div>
                    ) : (
                      <div className="w-5 h-5 rounded-full border-2 border-[#607EC9]/50 hover:border-[#9AB4FF] transition" />
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
