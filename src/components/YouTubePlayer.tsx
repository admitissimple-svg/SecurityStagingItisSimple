import React from 'react';
import { Youtube, ExternalLink, RotateCcw, Sparkles, CheckCircle2, Clock } from 'lucide-react';
import { extractYouTubeVideoId, getYouTubeEmbedUrl, getYouTubeWatchUrl } from '../utils/youtube';
import { useBehavioralVideoTracker } from '../hooks/useBehavioralMediaTracker';

export interface YouTubePlayerProps {
  videoId?: string | null;
  videoUrl?: string | null;
  videoTitle?: string | null;
  playlistTitle?: string | null;
  isRepeatVideo?: boolean;
  isCustomSuggestion?: boolean;
  instructions?: string | null;
  duration?: string | null;
  isEn?: boolean;
  isCompleted?: boolean;
  onMarkWatched?: (videoId: string, title?: string) => void;
  className?: string;
}

export const YouTubePlayer: React.FC<YouTubePlayerProps> = ({
  videoId,
  videoUrl,
  videoTitle,
  playlistTitle,
  isRepeatVideo = false,
  isCustomSuggestion = false,
  instructions,
  duration = '5-10 min',
  isEn = false,
  isCompleted = false,
  onMarkWatched,
  className = '',
}) => {
  const rawId = videoId || (videoUrl ? extractYouTubeVideoId(videoUrl) : '');
  const cleanId = rawId ? extractYouTubeVideoId(rawId) || rawId : '';

  const title = videoTitle || (isEn ? 'Daily Video Practice' : 'Prática Diária de Vídeo');
  const embedUrl = cleanId ? getYouTubeEmbedUrl(cleanId) : '';
  const watchUrl = cleanId ? getYouTubeWatchUrl(cleanId) : videoUrl || '';

  const {
    iframeRef,
    hasCompleted,
    handleIframeLoad,
    handlePlayerInteraction,
    handleExternalWatchClick,
  } = useBehavioralVideoTracker({
    videoId: cleanId,
    videoTitle: title,
    retentionSeconds: 35,
    onCompleted: (vid, tit) => {
      if (onMarkWatched) {
        onMarkWatched(vid, tit);
      }
    },
    isAlreadyCompleted: isCompleted,
  });

  // State: No video selected yet -> Show "Choose a Topic to Start"
  if (!cleanId) {
    return (
      <div
        id="youtube-player-placeholder"
        className={`bg-white rounded-3xl p-8 border border-slate-200 shadow-xs flex flex-col items-center justify-center text-center space-y-4 min-h-[360px] ${className}`}
      >
        <div className="w-16 h-16 rounded-2xl bg-[#062863]/10 text-[#062863] flex items-center justify-center border border-[#062863]/20">
          <Youtube className="w-8 h-8 text-rose-600" />
        </div>
        <div className="max-w-md space-y-1.5">
          <h3 className="text-lg font-bold text-[#000035]">
            {isEn ? 'Choose a Topic to Start' : 'Escolha um Tópico para Iniciar'}
          </h3>
          <p className="text-xs text-slate-500 leading-relaxed">
            {isEn
              ? 'Select a conversation topic or use your suggestion to unlock your daily curated YouTube video lesson.'
              : 'Selecione um tópico de conversação ou sua sugestão para carregar seu vídeo exclusivo do YouTube para a rotina de hoje.'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      id="youtube-player-container"
      className={`bg-white rounded-3xl border border-slate-200 shadow-xs overflow-hidden ${className}`}
      onClick={handlePlayerInteraction}
    >
      {/* Top Bar: Badges + Direct Link */}
      <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between gap-3 flex-wrap bg-slate-50/60">
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          <span className="inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-0.5 rounded-full bg-[#062863] text-white">
            <Youtube className="w-3.5 h-3.5 text-rose-400" />
            {playlistTitle || (isEn ? 'Curated Lesson' : 'Aula Exclusiva')}
          </span>

          {isRepeatVideo && (
            <span className="inline-flex items-center gap-1 text-xs font-extrabold px-2.5 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">
              <RotateCcw className="w-3 h-3" />
              {isEn ? 'Repeated Video' : 'Vídeo Repetido'}
            </span>
          )}

          {isCustomSuggestion && (
            <span className="inline-flex items-center gap-1 text-xs font-bold px-2.5 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200">
              <Sparkles className="w-3 h-3 text-amber-600" />
              {isEn ? 'Your Suggestion' : 'Sua Sugestão'}
            </span>
          )}

          {hasCompleted && (
            <span className="inline-flex items-center gap-1 text-[11px] font-extrabold px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-800 border border-emerald-500/30">
              <CheckCircle2 className="w-3 h-3 text-emerald-600" />
              {isEn ? 'Watched' : 'Assistido'}
            </span>
          )}
        </div>

        {watchUrl && (
          <a
            href={watchUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={handleExternalWatchClick}
            className="inline-flex items-center gap-1 text-xs font-semibold text-[#1C4C96] hover:text-[#062863] hover:underline"
          >
            <span>{isEn ? 'Watch on YouTube' : 'Assistir no YouTube'}</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        )}
      </div>

      {/* Responsive 16:9 Video Embed */}
      <div className="relative w-full aspect-video bg-black">
        <iframe
          ref={iframeRef}
          src={embedUrl}
          title={title}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
          className="absolute top-0 left-0 w-full h-full border-0"
          onLoad={handleIframeLoad}
        />
      </div>

      {/* Video Footer: Title, Duration & Instructions */}
      <div className="p-5 space-y-2">
        <div className="flex items-start justify-between gap-3">
          <h4 className="text-base font-bold text-[#000035] leading-snug">
            {title}
          </h4>
          {duration && (
            <span className="shrink-0 inline-flex items-center gap-1 text-xs text-slate-500 font-medium bg-slate-100 px-2 py-0.5 rounded-lg">
              <Clock className="w-3 h-3" />
              {duration}
            </span>
          )}
        </div>

        {instructions && (
          <p className="text-xs text-slate-600 leading-relaxed bg-slate-50 p-3 rounded-xl border border-slate-100">
            {instructions}
          </p>
        )}
      </div>
    </div>
  );
};
