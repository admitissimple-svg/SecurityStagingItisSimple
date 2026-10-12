import React from 'react';
import {
  Headphones,
  CheckCircle2,
  ExternalLink,
  Music,
  Sparkles,
} from 'lucide-react';
import { DayOfWeek } from '../types';
import { getDayLabel } from '../utils/notifications';

interface StudentSpotifyCardProps {
  isEn: boolean;
  selectedDay: DayOfWeek;
  levelPlaylistConfig: {
    levelLabelEn: string;
    levelLabelPt: string;
    playlistTitle: string;
    playlistUrl: string;
  };
  isAudioListenedToday: boolean;
  isRestDay: boolean;
  currentDayTrack: any;
  currentStudyDayIndex: number;
  activeDaysInOrder: DayOfWeek[];
  spotifyPlayerMode: 'app' | 'web';
  setSpotifyPlayerMode: (mode: 'app' | 'web') => void;
  sanitizedEmbedUrl: string;
  effectiveDirectUrl: string;
  effectiveTrackTitle: string;
  effectiveArtist: string;
  effectiveCoverUrl: string;
  teacherOverride?: any;
  activeNativeFriendFeedback?: any;
  triggerAudioCompletion: () => void;
}

export const StudentSpotifyCard: React.FC<StudentSpotifyCardProps> = ({
  isEn,
  selectedDay,
  levelPlaylistConfig,
  isAudioListenedToday,
  isRestDay,
  currentDayTrack,
  currentStudyDayIndex,
  activeDaysInOrder,
  spotifyPlayerMode,
  setSpotifyPlayerMode,
  sanitizedEmbedUrl,
  effectiveDirectUrl,
  effectiveTrackTitle,
  effectiveArtist,
  effectiveCoverUrl,
  teacherOverride,
  activeNativeFriendFeedback,
  triggerAudioCompletion,
}) => {
  return (
    <div className="rounded-2xl bg-gradient-to-br from-slate-900 via-[#000035] to-[#062863] p-4 text-white border border-[#1DB954]/40 shadow-xs space-y-3">
      {/* Header bar */}
      <div className="flex items-center justify-between gap-2 border-b border-white/10 pb-2.5 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-xl bg-[#1DB954] text-[#000035] flex items-center justify-center font-black shrink-0 shadow-xs">
            <Headphones className="w-3.5 h-3.5" />
          </div>
          <div>
            <div className="flex items-center gap-1.5 flex-wrap">
              <h4 className="font-black text-xs text-white tracking-tight">
                {isEn ? "Teacher's Daily Listening • Spotify" : 'Sugestão Diária do Teacher • Spotify'}
              </h4>
              <span className="px-2 py-0.5 rounded-full text-[9px] font-extrabold bg-[#1DB954]/25 text-[#1DB954] border border-[#1DB954]/40">
                {isEn ? levelPlaylistConfig.levelLabelEn : levelPlaylistConfig.levelLabelPt}
              </span>
              {isAudioListenedToday && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-extrabold bg-emerald-500/20 border border-emerald-400/40 text-emerald-300">
                  <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                  <span>{isEn ? 'Listened' : 'Ouvido'}</span>
                </span>
              )}
            </div>
            <p className="text-[10px] text-slate-300 font-medium">
              {isRestDay || !currentDayTrack
                ? (isEn
                    ? `${getDayLabel(selectedDay, 'en')} • Rest Day • Relax & Recharge`
                    : `${getDayLabel(selectedDay, 'pt')} • Dia de Descanso • Recarregue as energias`)
                : (isEn
                    ? `${currentDayTrack.dayLabelEn} • Track ${currentStudyDayIndex + 1} of ${activeDaysInOrder.length} • Adm Itissimple`
                    : `${currentDayTrack.dayLabelPt} • Faixa ${currentStudyDayIndex + 1} de ${activeDaysInOrder.length} • Adm Itissimple`)}
            </p>
          </div>
        </div>

        {/* Mode switch */}
        <div className="flex items-center gap-1 bg-black/40 p-0.5 rounded-lg border border-white/10 text-[10px]">
          <button
            type="button"
            onClick={() => setSpotifyPlayerMode('app')}
            className={`px-2 py-0.5 rounded-md font-bold transition cursor-pointer ${
              spotifyPlayerMode === 'app'
                ? 'bg-white text-[#000035] shadow-xs'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            {isEn ? 'App Player' : 'No App'}
          </button>
          <button
            type="button"
            onClick={() => setSpotifyPlayerMode('web')}
            className={`px-2 py-0.5 rounded-md font-bold transition cursor-pointer ${
              spotifyPlayerMode === 'web'
                ? 'bg-white text-[#000035] shadow-xs'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            {isEn ? 'Spotify Web' : 'Spotify'}
          </button>
        </div>
      </div>

      {/* Track Player / Content */}
      {isRestDay || !currentDayTrack ? (
        <div className="p-3 bg-white/5 rounded-xl border border-white/10 flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
            <Music className="w-4 h-4" />
          </div>
          <p className="text-xs text-slate-300 leading-snug">
            {isEn
              ? 'Rest Day: No Spotify listening scheduled for today according to your weekly plan.'
              : 'Dia de Descanso: Nenhuma música programada para hoje de acordo com seu plano.'}
          </p>
        </div>
      ) : spotifyPlayerMode === 'app' ? (
        <div className="space-y-1.5" onClick={() => triggerAudioCompletion()}>
          <div className="rounded-xl overflow-hidden border border-[#1DB954]/40 shadow-xs h-[80px] sm:h-[152px] bg-black">
            <iframe
              src={sanitizedEmbedUrl}
              width="100%"
              height="152"
              frameBorder="0"
              allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
              loading="lazy"
              title="Spotify Daily Track Player"
            />
          </div>
          <div className="flex items-center justify-between text-[10px] text-slate-300 px-1">
            <span className="font-semibold truncate">
              🎵 {effectiveTrackTitle} • {effectiveArtist}
            </span>
            <div className="flex items-center gap-1.5 shrink-0">
              {teacherOverride && (
                <span className="text-[9px] font-bold text-emerald-300 bg-emerald-900/60 px-1.5 py-0.5 rounded border border-emerald-500/40 flex items-center gap-0.5">
                  <Sparkles className="w-2.5 h-2.5 text-emerald-400" />
                  <span>{isEn ? 'Teacher Pick' : 'Recomendação'}</span>
                </span>
              )}
              <a
                href={effectiveDirectUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[10px] font-extrabold text-[#1DB954] hover:underline flex items-center gap-0.5"
              >
                <span>{isEn ? 'Open' : 'Abrir'}</span>
                <ExternalLink className="w-2.5 h-2.5" />
              </a>
            </div>
          </div>
        </div>
      ) : (
        <div className="p-2.5 bg-white/5 rounded-xl border border-white/10 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            {effectiveCoverUrl ? (
              <img
                src={effectiveCoverUrl}
                alt={effectiveTrackTitle}
                className="w-10 h-10 rounded-lg object-cover shrink-0 shadow-xs border border-white/20"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="w-10 h-10 rounded-lg bg-[#1DB954] text-[#000035] flex items-center justify-center shrink-0">
                <Music className="w-5 h-5" />
              </div>
            )}
            <div className="min-w-0">
              <h5 className="text-xs font-black text-white truncate">
                {effectiveTrackTitle}
              </h5>
              <p className="text-[10px] text-emerald-300 font-semibold truncate">
                {effectiveArtist}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <a
              href={effectiveDirectUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => triggerAudioCompletion()}
              className="px-3 py-1.5 bg-[#1DB954] hover:bg-[#1ed760] text-[#000035] rounded-xl text-[11px] font-extrabold flex items-center gap-1 transition shadow-xs cursor-pointer active:scale-95"
            >
              <span>{isEn ? 'Play Track' : 'Tocar Faixa'}</span>
              <ExternalLink className="w-3 h-3" />
            </a>
            <a
              href={levelPlaylistConfig.playlistUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] font-bold text-slate-300 hover:text-white px-1.5 py-1"
            >
              {isEn ? 'Playlist' : 'Playlist'}
            </a>
          </div>
        </div>
      )}

      {/* Teacher/Native Friend Note if present */}
      {teacherOverride?.instructions && (
        <div className="p-2 rounded-xl bg-white/10 border border-emerald-400/30 text-xs text-emerald-200 flex items-start gap-2">
          <Sparkles className="w-3 h-3 text-emerald-400 shrink-0 mt-0.5" />
          <div className="text-[11px] leading-relaxed">
            <span className="font-bold text-white mr-1">
              {teacherOverride.teacherName ? `${teacherOverride.teacherName}:` : (isEn ? 'Teacher Note:' : 'Dica do Professor:')}
            </span>
            <span>{teacherOverride.instructions}</span>
          </div>
        </div>
      )}

      {activeNativeFriendFeedback && (activeNativeFriendFeedback.comment || activeNativeFriendFeedback.recommendation) && (
        <div className="p-2 rounded-xl bg-white/10 border border-emerald-400/30 text-xs text-emerald-200 flex items-start gap-2">
          <Sparkles className="w-3 h-3 text-emerald-400 shrink-0 mt-0.5" />
          <div className="text-[11px] leading-relaxed">
            <span className="font-bold text-white mr-1">
              {activeNativeFriendFeedback.teacherName ? `${activeNativeFriendFeedback.teacherName}:` : (isEn ? 'Native Friend:' : 'Amigo Nativo:')}
            </span>
            <span>{activeNativeFriendFeedback.comment || activeNativeFriendFeedback.recommendation}</span>
          </div>
        </div>
      )}
    </div>
  );
};
