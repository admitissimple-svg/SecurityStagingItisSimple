import React, { useState, useEffect, useCallback } from 'react';
import {
  Play,
  Clock,
  CheckCircle2,
  GraduationCap,
  Volume2,
  Sparkles,
  Save,
  Check,
  Plus,
  BookOpen,
  Calendar,
  AlertCircle,
  ExternalLink,
  Edit3,
  Trash2,
  Link,
  Youtube,
  Info,
  Mail,
  RefreshCw,
  Layers,
  AlertTriangle,
  Wand2,
  HelpCircle,
  ArrowRight,
  Headphones,
  Music,
  Radio,
  Disc,
} from 'lucide-react';
import {
  RoutineItem,
  EnglishLevel,
  TeacherAssignedVideo,
  TeacherAssignedSpotify,
  DayOfWeek,
  WritingEvaluationResult,
  Language,
} from '../types';
import { extractYouTubeVideoId, getYouTubeEmbedUrl, getYouTubeWatchUrl, getYouTubeThumbnailUrl } from '../utils/youtube';
import {
  getSpotifyEmbedUrl,
  getSpotifyDirectUrl,
  isValidSpotifyUrl,
  getSpotifyContentType,
} from '../utils/spotify';
import { Translations, getActivityDisplayName } from '../utils/i18n';
import { checkStudentWritingApi } from '../utils/writingChecker';
import { getInstantOrCachedWord } from '../utils/dictionaryService';
import { useBehavioralVideoTracker, useBehavioralAudioTracker } from '../hooks/useBehavioralMediaTracker';


interface VideoLearningWorkspaceProps {
  activity: RoutineItem | null;
  level: EnglishLevel;
  isTeacher: boolean;
  t: Translations;
  currentLanguage?: Language;
  onSaveLearnedWords: (activityId: string, words: string[]) => void;
  onToggleComplete: (activityId: string) => void;
  onTeacherEditVideos: (activity: RoutineItem) => void;
  onTeacherSaveVideos?: (
    activityId: string,
    videos: TeacherAssignedVideo[],
    teacherNotes?: string,
    replicateToAllDays?: boolean,
    targetDays?: DayOfWeek[],
    spotify?: TeacherAssignedSpotify | null
  ) => void;
  onOpenEndOfDayModal: () => void;
  onOpenEmailNotificationModal?: () => void;
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

const DAYS_BUTTONS: { id: DayOfWeek; labelEn: string; labelPt: string }[] = [
  { id: 'monday', labelEn: 'Mon', labelPt: 'Seg' },
  { id: 'tuesday', labelEn: 'Tue', labelPt: 'Ter' },
  { id: 'wednesday', labelEn: 'Wed', labelPt: 'Qua' },
  { id: 'thursday', labelEn: 'Thu', labelPt: 'Qui' },
  { id: 'friday', labelEn: 'Fri', labelPt: 'Sex' },
  { id: 'saturday', labelEn: 'Sat', labelPt: 'Sáb' },
  { id: 'sunday', labelEn: 'Sun', labelPt: 'Dom' },
];

export const VideoLearningWorkspace: React.FC<VideoLearningWorkspaceProps> = ({
  activity,
  level,
  isTeacher,
  t,
  currentLanguage = 'pt',
  onSaveLearnedWords,
  onToggleComplete,
  onTeacherEditVideos,
  onTeacherSaveVideos,
  onOpenEndOfDayModal,
  onOpenEmailNotificationModal,
  onBehavioralComplete,
}) => {
  if (!activity) {
    return (
      <div className="bg-white rounded-3xl p-8 border border-[#607EC9]/30 shadow-xs flex flex-col items-center justify-center text-center space-y-4 h-full min-h-[450px]">
        <div className="w-14 h-14 rounded-2xl bg-[#9AB4FF]/20 text-[#1C4C96] flex items-center justify-center border border-[#9AB4FF]/40">
          <BookOpen className="w-7 h-7" />
        </div>
        <div className="max-w-sm space-y-1">
          <h3 className="text-base font-bold text-[#000035]">
            {t.selectActivityPrompt}
          </h3>
          <p className="text-xs text-[#607EC9]">
            {t.selectActivityDesc}
          </p>
        </div>
      </div>
    );
  }

  // Single video assigned by teacher for this activity
  const videos = activity.teacherVideos || [];
  const assignedVideo: TeacherAssignedVideo | null = videos.length > 0 ? videos[0] : null;
  const assignedVideoId = assignedVideo ? (extractYouTubeVideoId(assignedVideo.videoId || assignedVideo.url || '') || assignedVideo.videoId || '') : '';

  const handleVideoCompleted = useCallback((vid: string, tit?: string) => {
    setTimeout(() => {
      if (onBehavioralComplete && activity) {
        onBehavioralComplete({
          type: 'video',
          dayOfWeek: activity.dayOfWeek || 'monday',
          activityId: activity.id,
          video: {
            videoId: vid,
            videoTitle: tit || assignedVideo?.title || 'Daily Video Practice',
            url: assignedVideo?.url,
          },
        });
      } else if (activity && !activity.completedToday) {
        onToggleComplete(activity.id);
      }
    }, 0);
  }, [onBehavioralComplete, activity, assignedVideo?.title, assignedVideo?.url, onToggleComplete]);

  // Automatic behavioral tracking hooks
  const {
    iframeRef: videoIframeRef,
    handleIframeLoad: handleVideoIframeLoad,
    handlePlayerInteraction: handleVideoPlayerInteraction,
    handleExternalWatchClick: handleVideoExternalClick,
  } = useBehavioralVideoTracker({
    videoId: assignedVideoId,
    videoTitle: assignedVideo?.title,
    retentionSeconds: 35,
    onCompleted: handleVideoCompleted,
    isAlreadyCompleted: Boolean(activity?.completedToday),
  });

  const handleAudioCompleted = useCallback((trkId: string, tit?: string, art?: string) => {
    setTimeout(() => {
      if (onBehavioralComplete && activity) {
        onBehavioralComplete({
          type: 'audio',
          dayOfWeek: activity.dayOfWeek || 'monday',
          activityId: activity.id,
          track: {
            id: trkId,
            trackId: trkId,
            title: tit || activity?.teacherSpotify?.title || 'Daily Track',
            artist: art || activity?.teacherSpotify?.artistOrHost || 'Spotify Artist',
            url: activity?.teacherSpotify?.url,
          },
        });
      } else if (activity && !activity.completedToday) {
        onToggleComplete(activity.id);
      }
    }, 0);
  }, [onBehavioralComplete, activity, onToggleComplete]);

  const {
    triggerCompletion: triggerAudioCompletion,
  } = useBehavioralAudioTracker({
    trackId: activity?.teacherSpotify?.id || activity?.teacherSpotify?.url,
    trackTitle: activity?.teacherSpotify?.title,
    artist: activity?.teacherSpotify?.artistOrHost,
    onCompleted: handleAudioCompleted,
    isAlreadyCompleted: Boolean(activity?.completedToday),
  });

  // 5 Words State
  const [words, setWords] = useState<string[]>(['', '', '', '', '']);
  const [saveFeedback, setSaveFeedback] = useState<boolean>(false);
  const [writingEvaluation, setWritingEvaluation] = useState<WritingEvaluationResult | null>(null);
  const [isCheckingWriting, setIsCheckingWriting] = useState<boolean>(false);

  // Inline Teacher Video Assignment State
  const [teacherInputUrl, setTeacherInputUrl] = useState<string>('');
  const [teacherInputTitle, setTeacherInputTitle] = useState<string>('');
  const [teacherInputInstructions, setTeacherInputInstructions] = useState<string>(
    activity.teacherNotes || ''
  );
  const [teacherSelectedDays, setTeacherSelectedDays] = useState<DayOfWeek[]>(() => [activity.dayOfWeek || 'monday']);
  const [teacherSaveSuccess, setTeacherSaveSuccess] = useState<boolean>(false);
  const [clearVideoFeedback, setClearVideoFeedback] = useState<boolean>(false);
  const [urlError, setUrlError] = useState<string | null>(null);

  // Teacher Spotify Assignment State
  const [teacherSpotifyUrl, setTeacherSpotifyUrl] = useState<string>('');
  const [teacherSpotifyTitle, setTeacherSpotifyTitle] = useState<string>('');
  const [teacherSpotifyType, setTeacherSpotifyType] = useState<'podcast' | 'music'>('podcast');
  const [teacherSpotifyArtist, setTeacherSpotifyArtist] = useState<string>('');
  const [teacherSpotifyInstructions, setTeacherSpotifyInstructions] = useState<string>('');
  const [showSpotifyEmbed, setShowSpotifyEmbed] = useState<boolean>(false);
  const [spotifyUrlError, setSpotifyUrlError] = useState<string | null>(null);

  useEffect(() => {
    // Reset or populate words when activity changes
    if (activity.learnedWords && activity.learnedWords.length > 0) {
      const padded = [...activity.learnedWords];
      while (padded.length < 5) padded.push('');
      setWords(padded.slice(0, 5));
    } else {
      setWords(['', '', '', '', '']);
    }

    if (assignedVideo) {
      setTeacherInputUrl(assignedVideo.url || '');
      setTeacherInputTitle(assignedVideo.title || '');
      setTeacherInputInstructions(
        assignedVideo.instructions ||
          activity.teacherNotes ||
          ''
      );
    } else {
      setTeacherInputUrl('');
      setTeacherInputTitle('');
      setTeacherInputInstructions(
        activity.teacherNotes || ''
      );
    }

    if (activity.teacherSpotify) {
      setTeacherSpotifyUrl(activity.teacherSpotify.url || '');
      setTeacherSpotifyTitle(activity.teacherSpotify.title || '');
      setTeacherSpotifyType(activity.teacherSpotify.type === 'music' ? 'music' : 'podcast');
      setTeacherSpotifyArtist(activity.teacherSpotify.artistOrHost || '');
      setTeacherSpotifyInstructions(activity.teacherSpotify.instructions || '');
    } else {
      setTeacherSpotifyUrl('');
      setTeacherSpotifyTitle('');
      setTeacherSpotifyType('podcast');
      setTeacherSpotifyArtist('');
      setTeacherSpotifyInstructions('');
    }

    setUrlError(null);
    setSpotifyUrlError(null);
    setTeacherSelectedDays([activity.dayOfWeek || 'monday']);
  }, [
    activity.id,
    activity.learnedWords,
    activity.teacherNotes,
    assignedVideo?.id,
    activity.dayOfWeek,
    activity.teacherSpotify?.id,
    activity.teacherSpotify?.url,
  ]);

  const filledCount = words.filter((w) => w.trim().length > 0).length;

  const handleToggleDay = (day: DayOfWeek) => {
    setTeacherSelectedDays((prev) =>
      prev.includes(day) ? (prev.length > 1 ? prev.filter((d) => d !== day) : prev) : [...prev, day]
    );
  };

  const handleSelectAllDays = () => {
    setTeacherSelectedDays(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']);
  };

  const handleSelectWeekdays = () => {
    setTeacherSelectedDays(['monday', 'tuesday', 'wednesday', 'thursday', 'friday']);
  };

  const handleWordChange = (index: number, value: string) => {
    const updated = [...words];
    updated[index] = value;
    setWords(updated);
    if (writingEvaluation) {
      setWritingEvaluation(null);
    }
  };

  const handleTriggerAiCheck = async () => {
    const cleanWords = words.map((w) => w.trim()).filter((w) => w.length > 0);
    if (cleanWords.length === 0) return;

    setIsCheckingWriting(true);
    try {
      const evaluation = await checkStudentWritingApi({
        words: cleanWords,
        activityName: activity.activityName,
        level,
      });
      setWritingEvaluation(evaluation);
    } catch (err) {
      console.warn('Error evaluating words:', err);
    } finally {
      setIsCheckingWriting(false);
    }
  };

  const handleSaveWords = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanWords = words.map((w) => w.trim()).filter((w) => w.length > 0);
    onSaveLearnedWords(activity.id, cleanWords);
    setSaveFeedback(true);
    setTimeout(() => setSaveFeedback(false), 3000);

    if (cleanWords.length > 0) {
      handleTriggerAiCheck();
    }
  };

  const handleApplyWordCorrection = (original: string, corrected: string) => {
    const newWords = words.map((w) => (w.trim().toLowerCase() === original.trim().toLowerCase() ? corrected : w));
    setWords(newWords);
    const cleanWords = newWords.map((w) => w.trim()).filter((w) => w.length > 0);
    onSaveLearnedWords(activity.id, cleanWords);

    if (writingEvaluation) {
      const updatedWordFeedbacks = writingEvaluation.wordFeedbacks.map((wf) =>
        wf.original.trim().toLowerCase() === original.trim().toLowerCase()
          ? { ...wf, hasError: false, original: corrected }
          : wf
      );
      setWritingEvaluation({
        ...writingEvaluation,
        hasAnyError: updatedWordFeedbacks.some((wf) => wf.hasError),
        wordFeedbacks: updatedWordFeedbacks,
      });
    }
  };

  const handleApplyAllCorrections = () => {
    if (!writingEvaluation?.wordFeedbacks || !Array.isArray(writingEvaluation.wordFeedbacks)) return;
    let newWords = [...words];
    writingEvaluation.wordFeedbacks.forEach((wf) => {
      if (wf.hasError && wf.corrected) {
        newWords = newWords.map((w) =>
          w.trim().toLowerCase() === wf.original.trim().toLowerCase() ? wf.corrected : w
        );
      }
    });
    setWords(newWords);
    const cleanWords = newWords.map((w) => w.trim()).filter((w) => w.length > 0);
    onSaveLearnedWords(activity.id, cleanWords);
    setWritingEvaluation({
      ...writingEvaluation,
      hasAnyError: false,
      wordFeedbacks: writingEvaluation.wordFeedbacks.map((wf) => ({
        ...wf,
        hasError: false,
        original: wf.corrected,
      })),
    });
  };

  const handleSpeak = (text: string) => {
    if ('speechSynthesis' in window && text.trim()) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'en-US';
      utterance.rate = 0.9;
      window.speechSynthesis.speak(utterance);
    }
  };

  const handleInlineTeacherSave = (e: React.FormEvent) => {
    e.preventDefault();
    setUrlError(null);
    setSpotifyUrlError(null);

    let newVideoList: TeacherAssignedVideo[] = [];

    if (teacherInputUrl.trim()) {
      const videoId = extractYouTubeVideoId(teacherInputUrl);
      if (!videoId) {
        setUrlError(t.invalidYoutubeUrl);
        return;
      }

      const englishTitle = getActivityDisplayName(activity.activityName, 'en');

      const newVideo: TeacherAssignedVideo = {
        id: assignedVideo?.id || `tv-${Date.now()}`,
        url: teacherInputUrl.trim(),
        videoId,
        title: teacherInputTitle.trim() || `${englishTitle} - Daily English Practice`,
        duration: assignedVideo?.duration || '8-10 min',
        instructions:
          teacherInputInstructions.trim() ||
          activity.teacherNotes ||
          'Pay close attention to vocabulary, expressions, and native pronunciation in this video.',
        addedAt: new Date().toISOString(),
      };
      newVideoList = [newVideo];
    }

    let spotifyObj: TeacherAssignedSpotify | null = null;
    if (teacherSpotifyUrl.trim()) {
      if (!isValidSpotifyUrl(teacherSpotifyUrl.trim())) {
        setSpotifyUrlError('URL do Spotify inválida. Use um link válido do open.spotify.com');
        return;
      }
      spotifyObj = {
        id: activity.teacherSpotify?.id || `sp-${Date.now()}`,
        url: getSpotifyDirectUrl(teacherSpotifyUrl.trim()),
        title:
          teacherSpotifyTitle.trim() ||
          (teacherSpotifyType === 'podcast'
            ? 'Daily English Podcast Episode'
            : 'English Song for Listening Practice'),
        type: teacherSpotifyType,
        artistOrHost: teacherSpotifyArtist.trim() || undefined,
        instructions:
          teacherSpotifyInstructions.trim() ||
          'Sugestão diária do Teacher: Ouça com foco na compreensão auditiva e entonação natural.',
        addedAt: new Date().toISOString(),
      };
    }

    if (onTeacherSaveVideos) {
      onTeacherSaveVideos(
        activity.id,
        newVideoList.length > 0 ? newVideoList : videos,
        teacherInputInstructions.trim() || activity.teacherNotes,
        teacherSelectedDays.length === 7,
        teacherSelectedDays,
        spotifyObj !== null ? spotifyObj : activity.teacherSpotify
      );
      setTeacherSaveSuccess(true);
      setTimeout(() => setTeacherSaveSuccess(false), 3500);
    }
  };

  const handleTeacherRemoveVideo = () => {
    if (onTeacherSaveVideos) {
      onTeacherSaveVideos(
        activity.id,
        [],
        activity.teacherNotes,
        false,
        [activity.dayOfWeek || 'monday'],
        activity.teacherSpotify
      );
      setTeacherInputUrl('');
      setTeacherInputTitle('');
    }
  };

  const handleTeacherRemoveSpotify = () => {
    if (onTeacherSaveVideos) {
      onTeacherSaveVideos(
        activity.id,
        videos,
        activity.teacherNotes,
        false,
        [activity.dayOfWeek || 'monday'],
        null
      );
      setTeacherSpotifyUrl('');
      setTeacherSpotifyTitle('');
      setTeacherSpotifyArtist('');
      setTeacherSpotifyInstructions('');
    }
  };

  const handleClearVideoLink = (andMarkCompleted = false) => {
    if (onTeacherSaveVideos) {
      onTeacherSaveVideos(activity.id, [], '', false, [activity.dayOfWeek || 'monday'], null);
    }
    setTeacherInputUrl('');
    setTeacherInputTitle('');
    setTeacherInputInstructions('');
    setTeacherSpotifyUrl('');
    setTeacherSpotifyTitle('');
    setTeacherSpotifyArtist('');
    setTeacherSpotifyInstructions('');
    if (andMarkCompleted && !activity.completedToday) {
      onToggleComplete(activity.id);
    }
    setClearVideoFeedback(true);
    setTimeout(() => setClearVideoFeedback(false), 5000);
  };

  const lang: Language = currentLanguage === 'en' ? 'en' : 'pt';
  const displayActivityName = getActivityDisplayName(activity.activityName, lang);

  return (
    <div className="bg-white rounded-3xl p-5 sm:p-7 border border-[#607EC9]/30 shadow-xs space-y-6">
      {/* Activity Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#9AB4FF]/25 pb-5">
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-xs font-bold px-2.5 py-1 rounded-lg bg-[#9AB4FF]/20 text-[#062863] border border-[#9AB4FF]/40 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-[#1C4C96]" />
              {activity.time}
            </span>

            <span className="text-xs font-bold px-2.5 py-1 rounded-lg bg-[#9AB4FF]/10 text-[#062863] border border-[#9AB4FF]/30 capitalize">
              {t.level}: {level}
            </span>

            {isTeacher && (
              <span className="text-xs font-bold px-2.5 py-1 rounded-lg bg-[#9AB4FF]/20 text-[#062863] border border-[#9AB4FF]/40 flex items-center gap-1">
                <GraduationCap className="w-3.5 h-3.5 text-[#1C4C96]" />
                Teacher Assignment Mode
              </span>
            )}
          </div>

          <h2 className="text-xl sm:text-2xl font-black text-[#000035] tracking-tight">
            {displayActivityName}
          </h2>
        </div>

        {/* Action button */}
        <div className="flex items-center gap-2">
          {isTeacher ? (
            <button
              onClick={() => onTeacherEditVideos(activity)}
              className="px-4 py-2.5 bg-[#1C4C96] hover:bg-[#062863] text-white rounded-xl text-xs font-bold transition flex items-center gap-2 shadow-xs cursor-pointer"
            >
              <Edit3 className="w-4 h-4" />
              <span>Manage Video Assignment</span>
            </button>
          ) : activity.completedToday ? (
            <div className="px-3.5 py-2 rounded-xl bg-emerald-500/15 border border-emerald-500/40 text-emerald-800 text-xs font-bold flex items-center gap-1.5 shadow-2xs">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              <span>{t.practicedToday}</span>
            </div>
          ) : null}
        </div>
      </div>

      {/* TEACHER LINK INSERTION PANEL */}
      {isTeacher && (
        <div className="p-5 bg-[#000035] text-white rounded-3xl space-y-4 shadow-md border border-[#1C4C96]">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-[#1C4C96] flex items-center justify-center font-bold border border-[#9AB4FF]/30">
                <Youtube className="w-4 h-4 text-[#9AB4FF]" />
              </div>
              <div>
                <h3 className="text-sm font-extrabold text-white">
                  Teacher Space: Assign YouTube Video Link
                </h3>
                <p className="text-xs text-[#9AB4FF]/80">
                  Assign strictly 1 YouTube video link for &quot;{getActivityDisplayName(activity.activityName, 'en')}&quot;.
                </p>
              </div>
            </div>

            {assignedVideo && (
              <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-[#1C4C96]/60 text-[#9AB4FF] border border-[#9AB4FF]/40 flex items-center gap-1 shrink-0">
                <Check className="w-3.5 h-3.5 text-[#9AB4FF]" />
                1 Video Assigned
              </span>
            )}
          </div>

          <form onSubmit={handleInlineTeacherSave} className="space-y-4">
            {/* YouTube Video Assignment */}
            <div className="p-4 bg-[#062863]/60 rounded-2xl border border-[#1C4C96] space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-extrabold text-white flex items-center gap-1.5">
                  <Youtube className="w-4 h-4 text-red-400" />
                  <span>1. Vídeo do YouTube (Obrigatório)</span>
                </span>
                {assignedVideo && (
                  <span className="text-[10px] font-bold text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded-md border border-emerald-500/40">
                    Atribuído
                  </span>
                )}
              </div>

              <div>
                <label className="block text-[11px] font-bold text-[#9AB4FF] uppercase tracking-wider mb-1 flex items-center gap-1.5">
                  <Link className="w-3.5 h-3.5 text-[#9AB4FF]" />
                  <span>YouTube Video URL</span>
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="url"
                    value={teacherInputUrl}
                    onChange={(e) => {
                      setTeacherInputUrl(e.target.value);
                      setUrlError(null);
                    }}
                    placeholder="https://www.youtube.com/watch?v=... ou https://youtu.be/..."
                    className={`w-full px-3.5 py-2.5 bg-[#000035] border rounded-xl text-xs sm:text-sm text-white placeholder-[#9AB4FF]/50 focus:outline-none focus:ring-2 focus:ring-[#607EC9] transition ${
                      urlError ? 'border-rose-400' : 'border-[#1C4C96]'
                    }`}
                  />
                </div>
                {urlError && (
                  <p className="text-xs text-rose-300 font-semibold mt-1">{urlError}</p>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-[#9AB4FF] uppercase tracking-wider mb-1">
                    Título do Vídeo
                  </label>
                  <input
                    type="text"
                    value={teacherInputTitle}
                    onChange={(e) => setTeacherInputTitle(e.target.value)}
                    placeholder={`Ex: ${getActivityDisplayName(activity.activityName, 'en')} Daily Practice`}
                    className="w-full px-3.5 py-2 bg-[#000035] border border-[#1C4C96] rounded-xl text-xs sm:text-sm text-white placeholder-[#9AB4FF]/50 focus:outline-none focus:ring-2 focus:ring-[#607EC9] transition"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-[#9AB4FF] uppercase tracking-wider mb-1">
                    Orientações do Professor para o Vídeo
                  </label>
                  <input
                    type="text"
                    value={teacherInputInstructions}
                    onChange={(e) => setTeacherInputInstructions(e.target.value)}
                    placeholder="Ex: Preste atenção aos verbos e anote 5 palavras..."
                    className="w-full px-3.5 py-2 bg-[#000035] border border-[#1C4C96] rounded-xl text-xs sm:text-sm text-white placeholder-[#9AB4FF]/50 focus:outline-none focus:ring-2 focus:ring-[#607EC9] transition"
                  />
                </div>
              </div>
            </div>

            {/* Spotify Suggestion Assignment (Podcast or Music) */}
            <div className="p-4 bg-[#062863]/60 rounded-2xl border border-[#1DB954]/50 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-extrabold text-white flex items-center gap-1.5">
                  <Headphones className="w-4 h-4 text-[#1DB954]" />
                  <span>2. Sugestão Diária do Teacher • Spotify (Podcast ou Música)</span>
                </span>
                {activity.teacherSpotify && (
                  <span className="text-[10px] font-bold text-[#1DB954] bg-[#000035] px-2 py-0.5 rounded-md border border-[#1DB954]/40">
                    Spotify Configurado
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-[11px] font-bold text-[#1DB954] uppercase tracking-wider mb-1 flex items-center gap-1.5">
                    <Music className="w-3.5 h-3.5 text-[#1DB954]" />
                    <span>Link do Spotify (Podcast, Episódio ou Música)</span>
                  </label>
                  <input
                    type="url"
                    value={teacherSpotifyUrl}
                    onChange={(e) => {
                      setTeacherSpotifyUrl(e.target.value);
                      setSpotifyUrlError(null);
                    }}
                    placeholder="https://open.spotify.com/episode/... ou /track/..."
                    className={`w-full px-3.5 py-2.5 bg-[#000035] border rounded-xl text-xs sm:text-sm text-white placeholder-[#9AB4FF]/50 focus:outline-none focus:ring-2 focus:ring-[#1DB954] transition ${
                      spotifyUrlError ? 'border-rose-400' : 'border-[#1C4C96]'
                    }`}
                  />
                  {spotifyUrlError && (
                    <p className="text-xs text-rose-300 font-semibold mt-1">{spotifyUrlError}</p>
                  )}
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-[#9AB4FF] uppercase tracking-wider mb-1">
                    Tipo de Áudio
                  </label>
                  <div className="flex items-center gap-2 pt-0.5">
                    <button
                      type="button"
                      onClick={() => setTeacherSpotifyType('podcast')}
                      className={`flex-1 py-2 px-2 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1 border cursor-pointer ${
                        teacherSpotifyType === 'podcast'
                          ? 'bg-[#1DB954] text-[#000035] border-[#1DB954]'
                          : 'bg-[#000035] text-[#9AB4FF] border-[#1C4C96]'
                      }`}
                    >
                      <Radio className="w-3.5 h-3.5" />
                      <span>Podcast</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setTeacherSpotifyType('music')}
                      className={`flex-1 py-2 px-2 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1 border cursor-pointer ${
                        teacherSpotifyType === 'music'
                          ? 'bg-[#1DB954] text-[#000035] border-[#1DB954]'
                          : 'bg-[#000035] text-[#9AB4FF] border-[#1C4C96]'
                      }`}
                    >
                      <Disc className="w-3.5 h-3.5" />
                      <span>Música</span>
                    </button>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-[#9AB4FF] uppercase tracking-wider mb-1">
                    Título / Episódio do Spotify
                  </label>
                  <input
                    type="text"
                    value={teacherSpotifyTitle}
                    onChange={(e) => setTeacherSpotifyTitle(e.target.value)}
                    placeholder="Ex: 6 Minute English: Daily Habits (BBC Learning English)"
                    className="w-full px-3.5 py-2 bg-[#000035] border border-[#1C4C96] rounded-xl text-xs sm:text-sm text-white placeholder-[#9AB4FF]/50 focus:outline-none focus:ring-2 focus:ring-[#1DB954] transition"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-[#9AB4FF] uppercase tracking-wider mb-1">
                    Dica do Teacher para a Escuta no Spotify
                  </label>
                  <input
                    type="text"
                    value={teacherSpotifyInstructions}
                    onChange={(e) => setTeacherSpotifyInstructions(e.target.value)}
                    placeholder="Ex: Ouça prestando atenção no ritmo e entonação natural..."
                    className="w-full px-3.5 py-2 bg-[#000035] border border-[#1C4C96] rounded-xl text-xs sm:text-sm text-white placeholder-[#9AB4FF]/50 focus:outline-none focus:ring-2 focus:ring-[#1DB954] transition"
                  />
                </div>
              </div>

              {/* Quick Presets for Teacher */}
              <div className="pt-1">
                <span className="text-[11px] font-bold text-[#9AB4FF] block mb-1.5">
                  ⚡ Sugestões Rápidas de Podcast/Música para Preenchimento:
                </span>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <button
                    type="button"
                    onClick={() => {
                      setTeacherSpotifyUrl('https://open.spotify.com/show/3CF9ANEicXGxEROA3cOryE');
                      setTeacherSpotifyTitle('BBC 6 Minute English: Daily Practice');
                      setTeacherSpotifyType('podcast');
                      setTeacherSpotifyInstructions('Sugestão do Teacher: Ouça prestando atenção nos novos termos.');
                    }}
                    className="px-2.5 py-1 rounded-lg bg-[#000035] hover:bg-[#1C4C96] text-[#1DB954] border border-[#1DB954]/40 text-[11px] font-bold transition cursor-pointer"
                  >
                    🎙️ BBC 6 Minute English
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setTeacherSpotifyUrl('https://open.spotify.com/show/0nvd89U6p8s95aGphBvR5J');
                      setTeacherSpotifyTitle('Luke\'s English Podcast - Everyday Conversation');
                      setTeacherSpotifyType('podcast');
                      setTeacherSpotifyInstructions('Sugestão do Teacher: Treine a escuta durante esta rotina.');
                    }}
                    className="px-2.5 py-1 rounded-lg bg-[#000035] hover:bg-[#1C4C96] text-[#1DB954] border border-[#1DB954]/40 text-[11px] font-bold transition cursor-pointer"
                  >
                    🎙️ Luke\'s English Podcast
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setTeacherSpotifyUrl('https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT');
                      setTeacherSpotifyTitle('Música: "Good Life" - OneRepublic (Listening Practice)');
                      setTeacherSpotifyType('music');
                      setTeacherSpotifyInstructions('Sugestão do Teacher: Ouça e acompanhe a letra em inglês!');
                    }}
                    className="px-2.5 py-1 rounded-lg bg-[#000035] hover:bg-[#1C4C96] text-[#1DB954] border border-[#1DB954]/40 text-[11px] font-bold transition cursor-pointer"
                  >
                    🎵 OneRepublic - Good Life
                  </button>
                </div>
              </div>
            </div>

            {/* Replicate days */}
            <div className="p-3.5 bg-[#062863] rounded-2xl border border-[#1C4C96] space-y-2.5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <span className="text-xs font-bold text-white block">
                    🔁 Replicar Atribuições para Dias da Semana:
                  </span>
                  <span className="text-[11px] text-[#9AB4FF]/80 block">
                    Escolha quais dias da semana receberão as orientações, vídeo e sugestão de Spotify.
                  </span>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={handleSelectAllDays}
                    className="px-2 py-0.5 text-[10px] font-bold bg-[#1C4C96] hover:bg-[#607EC9] text-white rounded-lg transition border border-[#9AB4FF]/40 cursor-pointer"
                  >
                    Todos os 7 Dias
                  </button>
                  <button
                    type="button"
                    onClick={handleSelectWeekdays}
                    className="px-2 py-0.5 text-[10px] font-bold bg-[#000035] hover:bg-[#1C4C96] text-[#9AB4FF] rounded-lg transition border border-[#1C4C96] cursor-pointer"
                  >
                    Seg - Sex
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-7 gap-1.5 pt-0.5">
                {DAYS_BUTTONS.map((day) => {
                  const isSelected = teacherSelectedDays.includes(day.id);
                  return (
                    <button
                      key={day.id}
                      type="button"
                      onClick={() => handleToggleDay(day.id)}
                      className={`py-1.5 px-1 rounded-xl text-xs font-bold transition flex flex-col items-center justify-center border cursor-pointer ${
                        isSelected
                          ? 'bg-[#1C4C96] text-white border-[#9AB4FF]/60 shadow-xs'
                          : 'bg-[#000035] text-[#9AB4FF]/70 border-[#1C4C96]/50 hover:border-[#607EC9] hover:text-white'
                      }`}
                    >
                      <span>{day.labelEn}</span>
                      <span className={`text-[9px] font-normal ${isSelected ? 'text-[#9AB4FF]' : 'text-[#607EC9]'}`}>
                        {day.labelPt}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 pt-1 flex-wrap">
              <div className="flex items-center gap-3">
                {assignedVideo && (
                  <button
                    type="button"
                    onClick={handleTeacherRemoveVideo}
                    className="text-rose-300 hover:text-rose-200 text-xs font-semibold flex items-center gap-1 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Remover Vídeo</span>
                  </button>
                )}

                {activity.teacherSpotify && (
                  <button
                    type="button"
                    onClick={handleTeacherRemoveSpotify}
                    className="text-rose-300 hover:text-rose-200 text-xs font-semibold flex items-center gap-1 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Remover Spotify</span>
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2">
                {teacherSaveSuccess && (
                  <span className="text-xs text-[#9AB4FF] font-bold flex items-center gap-1 animate-pulse">
                    <Check className="w-4 h-4" />
                    Rotina Devolvida ao Aluno!
                  </span>
                )}
                <button
                  type="submit"
                  className="px-5 py-2.5 bg-[#1DB954] hover:bg-[#1ed760] text-[#000035] rounded-xl text-xs font-black transition flex items-center gap-2 shadow-xs cursor-pointer"
                >
                  <Save className="w-4 h-4" />
                  <span>Salvar & Devolver ao Aluno</span>
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* SINGLE ASSIGNED VIDEO PLAYER */}
      <div className="space-y-4">
        {clearVideoFeedback && (
          <div className="p-4 bg-[#9AB4FF]/20 text-[#062863] border border-[#9AB4FF]/50 rounded-2xl flex items-center gap-2.5 text-xs font-bold shadow-xs">
            <Check className="w-4 h-4 text-[#1C4C96] shrink-0" />
            <span>
              {currentLanguage === 'en'
                ? '✨ Video completed! The video link field has returned to blank, ready for your teacher to assign a new one.'
                : '✨ Vídeo concluído! O campo do link voltou a ficar em branco, pronto para a próxima indicação do professor.'}
            </span>
          </div>
        )}

        {assignedVideo ? (
          <div className="space-y-4">
            {/* Embedded Player */}
            <div
              className="relative aspect-video rounded-3xl overflow-hidden bg-[#000035] shadow-md border border-[#1C4C96]"
              onClick={handleVideoPlayerInteraction}
            >
              <iframe
                ref={videoIframeRef}
                src={getYouTubeEmbedUrl(assignedVideo.videoId || assignedVideo.url)}
                title={assignedVideo.title || 'YouTube Video'}
                className="w-full h-full border-0"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                onLoad={handleVideoIframeLoad}
              />
            </div>

            {/* Video Meta & Teacher Instructions */}
            <div className="p-4 sm:p-5 bg-[#9AB4FF]/10 rounded-2xl border border-[#607EC9]/30 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="space-y-0.5">
                  <span className="text-[11px] font-bold text-[#1C4C96] uppercase tracking-wider">
                    {currentLanguage === 'en' ? 'Teacher-Assigned YouTube Video' : 'Vídeo Indicado pelo Professor'}
                  </span>
                  <h4 className="text-sm font-bold text-[#000035]">
                    {assignedVideo.title}
                  </h4>
                </div>

                <a
                  href={getYouTubeWatchUrl(assignedVideo.videoId || assignedVideo.url)}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={handleVideoExternalClick}
                  className="text-xs font-bold text-[#1C4C96] hover:text-[#062863] flex items-center gap-1 shrink-0"
                >
                  <span>{t.openInYouTube}</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>

              {(assignedVideo.instructions || activity.teacherNotes) && (
                <div className="p-3 bg-white rounded-xl border border-[#9AB4FF]/40 flex items-start gap-2.5 text-xs text-[#062863]">
                  <GraduationCap className="w-4 h-4 text-[#1C4C96] shrink-0 mt-0.5" />
                  <div>
                    <strong className="text-[#000035] block mb-0.5 font-bold">
                      {t.teacherNotesTitle}
                    </strong>
                    <p className="leading-relaxed text-[#062863]">
                      {assignedVideo.instructions || activity.teacherNotes}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="p-8 sm:p-12 bg-[#9AB4FF]/5 rounded-3xl border border-dashed border-[#607EC9]/40 text-center space-y-4">
            <div className="w-14 h-14 rounded-2xl bg-[#9AB4FF]/20 text-[#062863] flex items-center justify-center mx-auto border border-[#9AB4FF]/40">
              <Youtube className="w-7 h-7 text-[#B91C1C]" />
            </div>
            <div className="space-y-1.5 max-w-md mx-auto">
              <h4 className="text-base font-bold text-[#000035]">
                {t.noVideoYetTitle}
              </h4>
              <p className="text-xs text-[#607EC9] leading-relaxed">
                {isTeacher
                  ? (currentLanguage === 'en'
                      ? 'Please use the Teacher section above to paste the YouTube video link for this routine moment.'
                      : t.noVideoYetTeacher)
                  : (currentLanguage === 'en'
                      ? 'No video assigned yet. Your native English teacher will assign the ideal YouTube video link for this routine moment soon.'
                      : 'Nenhum vídeo associado ainda. Seu professor de inglês indicará em breve o link do vídeo do YouTube ideal para este momento da sua rotina.')}
              </p>
            </div>

            {!isTeacher && onOpenEmailNotificationModal && (
              <button
                onClick={onOpenEmailNotificationModal}
                className="px-4 py-2.5 bg-[#1C4C96] hover:bg-[#062863] text-white text-xs font-bold rounded-xl transition cursor-pointer inline-flex items-center gap-2 shadow-xs"
              >
                <Mail className="w-4 h-4 text-[#9AB4FF]" />
                <span>{currentLanguage === 'en' ? 'Request Video from Teacher' : 'Solicitar Vídeo ao Professor por E-mail'}</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* 5 Words Learned Practice Section */}
      <div className="p-5 sm:p-6 bg-[#9AB4FF]/10 rounded-3xl border border-[#607EC9]/30 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[#9AB4FF]/30 pb-3">
          <div>
            <h3 className="text-sm font-extrabold text-[#000035] flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-[#1C4C96]" />
              <span>{t.fiveWordsTitle}</span>
            </h3>
            <p className="text-xs text-[#607EC9] mt-0.5">
              {t.fiveWordsDesc}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span
              className={`text-xs font-bold px-2.5 py-1 rounded-full ${
                filledCount === 5
                  ? 'bg-[#9AB4FF]/30 text-[#062863] border border-[#9AB4FF]/50'
                  : 'bg-[#9AB4FF]/20 text-[#062863] border border-[#9AB4FF]/40'
              }`}
            >
              {filledCount}/5 {t.wordsRecordedBadge}
            </span>
          </div>
        </div>

        {/* 5 Inputs */}
        <form onSubmit={handleSaveWords} className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {words.map((word, idx) => (
              <div key={idx} className="space-y-1">
                <label className="text-[11px] font-bold text-[#062863] flex items-center justify-between">
                  <span>{currentLanguage === 'en' ? `Word / Expression ${idx + 1}` : `Palavra / Expressão ${idx + 1}`}</span>
                  {word.trim() && (
                    <button
                      type="button"
                      onClick={() => handleSpeak(word)}
                      className="text-[#1C4C96] hover:text-[#062863] flex items-center gap-0.5 text-[10px] font-semibold cursor-pointer"
                      title={t.listenPronunciation}
                    >
                      <Volume2 className="w-3 h-3" />
                      <span>{t.listenPronunciation}</span>
                    </button>
                  )}
                </label>

                <div className="flex items-center gap-2 px-3 py-2 bg-white rounded-xl border border-[#9AB4FF]/40 focus-within:ring-2 focus-within:ring-[#1C4C96] focus-within:border-[#1C4C96] transition">
                  <span className="font-mono text-xs font-bold text-[#607EC9] w-4">
                    {idx + 1}.
                  </span>
                  <input
                    type="text"
                    value={word}
                    onChange={(e) => handleWordChange(idx, e.target.value)}
                    placeholder={t.wordPlaceholder.replace('{n}', (idx + 1).toString())}
                    className="w-full text-xs sm:text-sm text-[#000035] bg-transparent focus:outline-none font-medium"
                  />
                  {word.trim() && (
                    <Check className="w-4 h-4 text-[#1C4C96] shrink-0" />
                  )}
                </div>
                {word.trim() && (
                  <div
                    className="flex items-center gap-1.5 px-2.5 py-1 bg-slate-50 rounded-lg border border-slate-200 text-[11px] text-slate-600 truncate mt-1"
                    title={getInstantOrCachedWord(word.trim()).definitionEn}
                  >
                    <BookOpen className="w-3 h-3 text-[#1C4C96] shrink-0" />
                    <span className="truncate">{getInstantOrCachedWord(word.trim()).definitionEn}</span>
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
            <span className="text-[11px] text-[#607EC9]">
              {filledCount < 5 ? t.fillAllFiveWordsNotice : t.wordsSavedSuccess}
            </span>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleTriggerAiCheck}
                disabled={filledCount === 0 || isCheckingWriting}
                className="px-3.5 py-2.5 bg-white hover:bg-[#9AB4FF]/15 text-[#062863] border border-[#9AB4FF]/40 rounded-xl font-bold text-xs transition cursor-pointer flex items-center gap-1.5 shadow-xs disabled:opacity-50"
                title="Verificar se há erros de ortografia nas palavras com IA"
              >
                <Wand2 className={`w-3.5 h-3.5 text-[#1C4C96] ${isCheckingWriting ? 'animate-spin' : ''}`} />
                <span>
                  {isCheckingWriting
                    ? currentLanguage === 'en'
                      ? 'Checking...'
                      : 'Analisando...'
                    : currentLanguage === 'en'
                    ? 'Check Spelling'
                    : 'Verificar com IA'}
                </span>
              </button>

              <button
                type="submit"
                disabled={filledCount === 0}
                className={`px-5 py-2.5 rounded-xl font-bold text-xs transition cursor-pointer flex items-center justify-center gap-2 shadow-xs ${
                  saveFeedback
                    ? 'bg-[#1C4C96] text-white'
                    : filledCount === 5
                    ? 'bg-[#1C4C96] hover:bg-[#062863] text-white'
                    : 'bg-[#000035] hover:bg-[#062863] text-white disabled:opacity-50 disabled:cursor-not-allowed'
                }`}
              >
                {saveFeedback ? (
                  <>
                    <Check className="w-4 h-4 text-[#9AB4FF]" />
                    <span>{t.wordsSavedSuccess}</span>
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4" />
                    <span>{t.saveFiveWordsBtn}</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </form>

        {/* AI Writing Feedback & Correction Alert */}
        {writingEvaluation && writingEvaluation.hasAnyError && (
          <div className="p-4.5 bg-[#FFF8F6] rounded-2xl border-2 border-[#FCA5A5] shadow-xs space-y-3 animate-in fade-in">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-[#FEE2E2] text-[#DC2626] flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-xs sm:text-sm font-extrabold text-[#991B1B]">
                    {currentLanguage === 'en'
                      ? '⚠️ Spelling & Vocabulary Feedback'
                      : '⚠️ Alerta Pedagógico de Vocabulário'}
                  </h4>
                  <p className="text-[11px] text-[#7F1D1D]">
                    {currentLanguage === 'en'
                      ? 'Errors were identified in your recorded words. Review the corrections and explanations below:'
                      : 'Identificamos erros de grafia nas palavras digitadas. Veja a explicação e a forma correta:'}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={handleApplyAllCorrections}
                className="px-3 py-1.5 bg-[#DC2626] hover:bg-[#B91C1C] text-white text-[11px] font-bold rounded-xl transition flex items-center gap-1 shrink-0 shadow-xs cursor-pointer"
              >
                <Wand2 className="w-3 h-3 text-[#FDE047]" />
                <span>{currentLanguage === 'en' ? 'Apply All Corrections' : 'Corrigir Todas'}</span>
              </button>
            </div>

            {/* Individual Word Corrections */}
            <div className="space-y-2 pt-1">
              {writingEvaluation.wordFeedbacks
                .filter((wf) => wf.hasError)
                .map((wf, wIdx) => (
                  <div
                    key={wIdx}
                    className="p-3 bg-white rounded-xl border border-[#FECACA] flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                  >
                    <div className="space-y-1 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-rose-600 line-through bg-rose-50 px-2 py-0.5 rounded border border-rose-200">
                          {wf.original}
                        </span>
                        <ArrowRight className="w-3.5 h-3.5 text-[#64748B]" />
                        <span className="font-extrabold text-[#062863] bg-[#9AB4FF]/20 px-2.5 py-0.5 rounded-lg border border-[#9AB4FF]/40 flex items-center gap-1">
                          <Check className="w-3 h-3 text-[#1C4C96]" />
                          {wf.corrected}
                        </span>
                      </div>
                      <p className="text-[11px] text-[#334155] leading-relaxed">
                        {currentLanguage === 'en' ? wf.explanationEn : wf.explanationPt}
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleApplyWordCorrection(wf.original, wf.corrected)}
                      className="px-3 py-1.5 bg-[#9AB4FF]/20 hover:bg-[#9AB4FF]/30 text-[#062863] font-bold text-[11px] rounded-lg border border-[#9AB4FF]/50 transition shrink-0 self-start sm:self-auto cursor-pointer"
                    >
                      {currentLanguage === 'en' ? 'Apply Fix' : 'Corrigir'}
                    </button>
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* Success Alert if All Words Correct */}
        {writingEvaluation && !writingEvaluation.hasAnyError && filledCount > 0 && (
          <div className="p-3.5 bg-[#9AB4FF]/20 rounded-2xl border border-[#9AB4FF]/40 text-[#062863] flex items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-[#1C4C96] shrink-0" />
              <span className="font-bold">
                {currentLanguage === 'en'
                  ? '✨ Excellent! All words are spelled correctly in English.'
                  : '✨ Excelente! Todas as palavras foram digitadas corretamente em inglês.'}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setWritingEvaluation(null)}
              className="text-[#607EC9] hover:text-[#000035] text-[10px] font-bold"
            >
              OK
            </button>
          </div>
        )}

        {/* End of Day Prompt Callout */}
        {filledCount >= 5 && (
          <div className="mt-4 p-4 bg-gradient-to-r from-[#9AB4FF]/20 to-[#607EC9]/20 rounded-2xl border border-[#9AB4FF]/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="space-y-0.5">
              <span className="font-bold text-xs text-[#000035] block">
                {t.dailyReviewPromptTitle}
              </span>
              <p className="text-[11px] text-[#062863]">
                {t.dailyReviewPromptDesc}
              </p>
            </div>
            <button
              onClick={onOpenEndOfDayModal}
              className="px-4 py-2 bg-[#1C4C96] hover:bg-[#062863] text-white text-xs font-bold rounded-xl transition shrink-0 cursor-pointer shadow-xs"
            >
              {t.openDailySentenceReviewBtn}
            </button>
          </div>
        )}
      </div>

      {/* 🎧 DAILY SPOTIFY SUGGESTION SECTION (BELOW 5 WORDS) */}
      <div
        id="daily-spotify-suggestion"
        className="p-5 sm:p-6 bg-gradient-to-br from-[#000035] to-[#062863] rounded-3xl border-2 border-[#1DB954]/50 text-white shadow-md space-y-4 transition-all"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#1DB954]/20 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-[#1DB954] text-[#000035] flex items-center justify-center font-black shadow-xs shrink-0">
              <Headphones className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-sm sm:text-base font-extrabold text-white">
                  {currentLanguage === 'en'
                    ? "Teacher's Daily Listening Suggestion • Spotify"
                    : 'Sugestão Diária do Teacher • Spotify'}
                </h3>
                {activity.teacherSpotify && (
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-[#1DB954]/20 text-[#1DB954] border border-[#1DB954]/40 flex items-center gap-1">
                    {activity.teacherSpotify.type === 'podcast' ? (
                      <>
                        <Radio className="w-3 h-3" />
                        <span>Podcast</span>
                      </>
                    ) : (
                      <>
                        <Music className="w-3 h-3" />
                        <span>Música em Inglês</span>
                      </>
                    )}
                  </span>
                )}
              </div>
              <p className="text-xs text-[#9AB4FF]">
                {currentLanguage === 'en'
                  ? 'Curated daily audio suggestion (podcast or song) directly from your teacher.'
                  : 'Link de direcionamento para o Spotify preenchido com a sugestão diária do Teacher.'}
              </p>
            </div>
          </div>

          {activity.teacherSpotify && (
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setShowSpotifyEmbed(!showSpotifyEmbed)}
                className="px-3 py-1.5 rounded-xl text-xs font-bold bg-[#062863] hover:bg-[#1C4C96] text-[#9AB4FF] hover:text-white border border-[#1C4C96] transition flex items-center gap-1.5 cursor-pointer"
              >
                <Headphones className="w-3.5 h-3.5" />
                <span>{showSpotifyEmbed ? 'Ocultar Player' : 'Player no App'}</span>
              </button>

              <a
                href={getSpotifyDirectUrl(activity.teacherSpotify.url)}
                target="_blank"
                rel="noopener noreferrer"
                className="px-4 py-1.5 rounded-xl text-xs font-extrabold bg-[#1DB954] hover:bg-[#1ed760] text-[#000035] transition flex items-center gap-1.5 shadow-xs cursor-pointer"
              >
                <span>Ouvir no Spotify</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          )}
        </div>

        {activity.teacherSpotify ? (
          <div className="space-y-3.5">
            <div className="bg-[#062863]/70 p-4 rounded-2xl border border-[#1DB954]/30 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="space-y-1.5 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs sm:text-sm font-bold text-white">
                    {activity.teacherSpotify.title}
                  </span>
                  {activity.teacherSpotify.artistOrHost && (
                    <span className="text-[11px] text-[#9AB4FF] bg-[#000035] px-2 py-0.5 rounded-md border border-[#1C4C96]">
                      {activity.teacherSpotify.artistOrHost}
                    </span>
                  )}
                </div>

                {activity.teacherSpotify.instructions && (
                  <p className="text-xs text-[#9AB4FF]/90 leading-relaxed bg-[#000035]/50 p-2.5 rounded-xl border border-[#1C4C96]/50">
                    <span className="font-bold text-[#1DB954]">💡 Dica do Teacher:</span>{' '}
                    {activity.teacherSpotify.instructions}
                  </p>
                )}
              </div>

              <a
                href={getSpotifyDirectUrl(activity.teacherSpotify.url)}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => triggerAudioCompletion()}
                className="self-start md:self-center px-4 py-2 bg-[#1DB954] hover:bg-[#1ed760] text-[#000035] text-xs font-extrabold rounded-xl transition flex items-center gap-2 shrink-0 shadow-sm"
              >
                <Play className="w-4 h-4 fill-current" />
                <span>Abrir no Spotify</span>
              </a>
            </div>

            {/* Optional Embedded Spotify Player */}
            {showSpotifyEmbed && (
              <div
                className="rounded-2xl overflow-hidden border border-[#1DB954]/40 bg-[#000035] shadow-inner p-1"
                onClick={() => triggerAudioCompletion()}
              >
                <iframe
                  src={getSpotifyEmbedUrl(activity.teacherSpotify.url) || undefined}
                  width="100%"
                  height="152"
                  frameBorder="0"
                  allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
                  loading="lazy"
                  title="Spotify Player"
                  className="rounded-xl"
                />
              </div>
            )}
          </div>
        ) : (
          <div className="p-4 bg-[#062863]/40 rounded-2xl border border-dashed border-[#1DB954]/30 flex flex-col sm:flex-row items-center justify-between gap-3 text-center sm:text-left">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-[#062863] text-[#1DB954] flex items-center justify-center shrink-0 border border-[#1DB954]/30">
                <Music className="w-4 h-4" />
              </div>
              <p className="text-xs text-[#9AB4FF]">
                {isTeacher
                  ? 'Você pode definir um link do Spotify (podcast ou música) no formulário do Teacher acima para este horário.'
                  : 'Assim que o professor devolver a rotina sugerida, o link e a recomendação do Spotify (música ou podcast) estarão disponíveis aqui.'}
              </p>
            </div>

            {isTeacher && (
              <button
                type="button"
                onClick={() => {
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                className="px-3 py-1.5 rounded-xl bg-[#1DB954]/20 hover:bg-[#1DB954]/30 text-[#1DB954] border border-[#1DB954]/40 text-xs font-bold transition shrink-0 cursor-pointer"
              >
                + Adicionar Spotify
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
