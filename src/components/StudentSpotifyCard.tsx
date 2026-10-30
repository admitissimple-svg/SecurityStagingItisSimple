import React from 'react';
import {
  Headphones,
  CheckCircle2,
  ExternalLink,
  Music,
  Shuffle,
  Sparkles,
} from 'lucide-react';
import { DayOfWeek } from '../types';
import { getDayLabel } from '../utils/notifications';

interface StudentSpotifyCardProps {
  isEn: boolean;
  selectedDay: DayOfWeek;
  levelPlaylistConfig: {
    level?: string;
    levelLabelEn: string;
    levelLabelPt: string;
    playlistId?: string;
    playlistTitle: string;
    playlistUrl: string;
    embedPlaylistUrl?: string;
    descriptionEn?: string;
    descriptionPt?: string;
  };
  isAudioListenedToday: boolean;
  isRestDay: boolean;
  currentDayTrack?: any;
  currentStudyDayIndex: number;
  activeDaysInOrder: DayOfWeek[];
  spotifyPlayerMode: 'app' | 'web';
  setSpotifyPlayerMode: (mode: 'app' | 'web') => void;
  sanitizedEmbedUrl?: string;
  effectiveDirectUrl?: string;
  effectiveTrackTitle?: string;
  effectiveArtist?: string;
  effectiveCoverUrl?: string;
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
  currentStudyDayIndex,
  activeDaysInOrder,
  spotifyPlayerMode,
  setSpotifyPlayerMode,
  teacherOverride,
  activeNativeFriendFeedback,
  triggerAudioCompletion,
}) => {
  const embedUrl =
    levelPlaylistConfig.embedPlaylistUrl ||
    `https://open.spotify.com/embed/playlist/${levelPlaylistConfig.playlistId || '5MMU9H5oXDd7FCWr0gkzHE'}?utm_source=generator&theme=0`;
  const playlistUrl =
    levelPlaylistConfig.playlistUrl ||
    `https://open.spotify.com/playlist/${levelPlaylistConfig.playlistId || '5MMU9H5oXDd7FCWr0gkzHE'}`;

  return (
    <div className="rounded-3xl bg-gradient-to-br from-slate-900 via-[#000035] to-[#062863] p-2.5 sm:p-3 text-white border border-[#1DB954]/30 shadow-xs">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        {/* Left Column: Metadata & Controls (matching image_3d4b54d3.png) */}
        <div className="flex-1 min-w-0 flex flex-col justify-between space-y-2.5">
          {/* Top: Icon, Title, Level, Listened Status & Day info */}
          <div className="space-y-1">
            <div className="flex items-center gap-2.5 flex-wrap">
              <div className="w-7 h-7 rounded-xl bg-[#1DB954] text-[#000035] flex items-center justify-center font-black shrink-0 shadow-xs">
                <Headphones className="w-3.5 h-3.5" />
              </div>
              <div className="flex items-center gap-2 flex-wrap min-w-0">
                <h4 className="font-black text-xs sm:text-sm text-white tracking-tight truncate">
                  {isEn ? "Teacher's Daily Listening • Spotify" : 'Sugestão Diária do Teacher • Spotify'}
                </h4>
                <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-[#1DB954]/20 text-[#1DB954] border border-[#1DB954]/40 shrink-0">
                  {isEn ? levelPlaylistConfig.levelLabelEn : levelPlaylistConfig.levelLabelPt}
                </span>
                {isAudioListenedToday && (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded-md text-[9px] font-bold bg-emerald-500/20 border border-emerald-400/30 text-emerald-300 shrink-0">
                    <CheckCircle2 className="w-2.5 h-2.5 text-emerald-400" />
                    <span>{isEn ? 'Listened' : 'Ouvido'}</span>
                  </span>
                )}
              </div>
            </div>

            <p className="text-[11px] text-slate-300 font-medium pl-9.5">
              {isRestDay
                ? (isEn
                    ? `${getDayLabel(selectedDay, 'en')} • Rest Day • Relax & Recharge`
                    : `${getDayLabel(selectedDay, 'pt')} • Dia de Descanso • Recarregue as energias`)
                : (isEn
                    ? `${getDayLabel(selectedDay, 'en')} • Day ${currentStudyDayIndex + 1} of ${activeDaysInOrder.length} • ${levelPlaylistConfig.playlistTitle}`
                    : `${getDayLabel(selectedDay, 'pt')} • Dia ${currentStudyDayIndex + 1} de ${activeDaysInOrder.length} • ${levelPlaylistConfig.playlistTitle}`)}
            </p>
          </div>

          {/* Middle: Subtle Shuffle tip */}
          {!isRestDay && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#1DB954]/10 border border-[#1DB954]/20 text-[11px] text-emerald-200 w-fit">
              <Shuffle className="w-3 h-3 text-[#1DB954] shrink-0" />
              {/*<span className="font-medium text-emerald-100 text-[10px] sm:text-[11px]">
                Try Shuffle mode to discover different songs!
              </span>*/}
            </div>
          )}

          {/* Bottom Left: Playlist Title & Mode Toggle */}
          <div className="flex items-center gap-3 pt-1 border-t border-white/10 flex-wrap">
            {/*<span className="text-[11px] text-slate-300 font-semibold truncate max-w-[240px]">
              {levelPlaylistConfig.playlistTitle}
            </span>*/}

            {/* Mode switch (App Player vs Web) */}
            <div className="flex items-center gap-0.5 bg-black/40 p-0.5 rounded-lg border border-white/10 text-[9px] shrink-0">
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
        </div>

        {/* Right Column: Player & Action Buttons (matching image_3d4b54d3.png) */}
        <div className="shrink-0 w-full md:w-[460px] lg:w-[500px] flex flex-col justify-between space-y-1">
          {/* Playlist Content / Player */}
          {isRestDay ? (
            <div className="p-3 bg-white/5 rounded-2xl border border-white/10 flex items-center gap-3 h-[120px]">
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
            <div className="rounded-2xl overflow-hidden border border-[#1DB954]/30 shadow-xs h-[152px] bg-black w-full">
              <iframe
                src={embedUrl}
                width="100%"
                height="152"
                frameBorder="0"
                allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
                loading="lazy"
                title={levelPlaylistConfig.playlistTitle}
              />
            </div>
          ) : (
            <div className="p-3 bg-white/5 rounded-2xl border border-white/10 flex items-center justify-between gap-3 h-[152px]">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-[#1DB954] text-[#000035] flex items-center justify-center shrink-0 shadow-xs">
                  <Music className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <h5 className="text-xs font-black text-white truncate">
                    {levelPlaylistConfig.playlistTitle}
                  </h5>
                  <p className="text-[11px] text-emerald-300 font-semibold truncate">
                    {isEn
                      ? levelPlaylistConfig.descriptionEn || "Official It's simple Spotify playlist for your level."
                      : levelPlaylistConfig.descriptionPt || "Playlist oficial da It's simple no Spotify para o seu nível."}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Action row (Listen on Spotify & Completion) */}
          <div className="flex items-center justify-end gap-2 pt-0.5">
            {teacherOverride && (
              <span className="text-[9px] font-bold text-emerald-300 bg-emerald-900/60 px-1.5 py-0.5 rounded border border-emerald-500/40 flex items-center gap-0.5 mr-auto">
                <Sparkles className="w-2.5 h-2.5 text-emerald-400" />
                <span>{isEn ? 'Teacher Pick' : 'Recomendação'}</span>
              </span>
            )}

            {isAudioListenedToday ? (
              <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-extrabold bg-emerald-500/20 border border-emerald-400/40 text-emerald-300">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                <span>{isEn ? 'Listened' : 'Ouvido'}</span>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => triggerAudioCompletion()}
                className="px-3 py-1.5 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-400/40 rounded-xl text-xs font-bold flex items-center gap-1 transition cursor-pointer active:scale-95"
              >
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                {/*<span>{isEn ? 'Mark as Listened' : 'Marcar como Ouvido'}</span>*/}
              </button>
            )}

            <a
              href={playlistUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => triggerAudioCompletion()}
              className="px-4 py-1.5 bg-[#1DB954] hover:bg-[#1ed760] text-[#000035] rounded-xl text-xs font-black flex items-center gap-1.5 transition shadow-xs cursor-pointer active:scale-95 shrink-0"
            >
              <span>Listen on Spotify</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        </div>
      </div>

      {/* Teacher/Native Friend Note if present */}
      {teacherOverride?.instructions && (
        <div className="mt-2.5 p-1.5 px-2 rounded-lg bg-white/5 border border-emerald-400/20 text-[10px] text-emerald-200 flex items-start gap-1.5">
          <Sparkles className="w-2.5 h-2.5 text-emerald-400 shrink-0 mt-0.5" />
          <div className="text-[10px] leading-relaxed">
            <span className="font-bold text-white mr-1">
              {teacherOverride.teacherName ? `${teacherOverride.teacherName}:` : (isEn ? 'Teacher Note:' : 'Dica do Professor:')}
            </span>
            <span>{teacherOverride.instructions}</span>
          </div>
        </div>
      )}

      {activeNativeFriendFeedback && (activeNativeFriendFeedback.comment || activeNativeFriendFeedback.recommendation) && (
        <div className="mt-2.5 p-1.5 px-2 rounded-lg bg-white/5 border border-emerald-400/20 text-[10px] text-emerald-200 flex items-start gap-1.5">
          <Sparkles className="w-2.5 h-2.5 text-emerald-400 shrink-0 mt-0.5" />
          <div className="text-[10px] leading-relaxed">
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
