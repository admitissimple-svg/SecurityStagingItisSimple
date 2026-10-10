import React, { useState, useEffect, useMemo } from 'react';
import {
  Music,
  Headphones,
  ExternalLink,
  Pencil,
  RotateCcw,
  Sparkles,
  CheckCircle2,
  Calendar,
  Layers,
  ChevronDown,
  ChevronUp,
  X,
  Play,
  Volume2,
  AlertCircle,
  Loader2
} from 'lucide-react';
import { doc, onSnapshot, collection } from 'firebase/firestore';
import { getDb } from '../firebase';
import { DayOfWeek, EnglishLevel, Language, TeacherOverrideTrack } from '../types';
import {
  selectCurrentDaySpotifyTrack,
  getSpotifyPlaylistForLevel,
  getSpotifyEmbedUrl,
  getSpotifyDirectUrl
} from '../utils/spotify';
import {
  saveTeacherSpotifyOverrideToFirestore,
  removeTeacherSpotifyOverrideFromFirestore,
  normalizeStudentIdForPath
} from '../utils/routineSync';

export interface NativeFriendSpotifyTableProps {
  studentUid: string;
  studentEmail?: string;
  studentName?: string;
  studentLevel?: string | EnglishLevel | null;
  teacherUid?: string;
  teacherName?: string;
  teacherEmail?: string;
  weeklyCycle?: number;
  activeStudyDays?: DayOfWeek[];
  currentLanguage?: Language;
}

const ALL_DAYS: DayOfWeek[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

const DAY_LABELS_PT: Record<DayOfWeek, string> = {
  monday: 'Segunda-feira',
  tuesday: 'Terça-feira',
  wednesday: 'Quarta-feira',
  thursday: 'Quinta-feira',
  friday: 'Sexta-feira',
  saturday: 'Sábado',
  sunday: 'Domingo',
};

const DAY_LABELS_EN: Record<DayOfWeek, string> = {
  monday: 'Monday',
  tuesday: 'Tuesday',
  wednesday: 'Wednesday',
  thursday: 'Thursday',
  friday: 'Friday',
  saturday: 'Saturday',
  sunday: 'Sunday',
};

// Curated song library per level for fast 1-click teacher recommendations
const CURATED_LEVEL_TRACKS: Record<string, Array<{ title: string; artist: string; url: string; note: string }>> = {
  beginner: [
    {
      title: 'Count On Me',
      artist: 'Bruno Mars',
      url: 'https://open.spotify.com/track/3H04Y8V3L2aVf7f2b1d3kK',
      note: 'Excelente para praticar pronomes e vocabulário simples do dia a dia.',
    },
    {
      title: 'Stand By Me',
      artist: 'Ben E. King',
      url: 'https://open.spotify.com/track/3SdTKo2uVsxFblQjpScoHy',
      note: 'Ritmo compassado e pronúncia clássica impecável.',
    },
    {
      title: 'What a Wonderful World',
      artist: 'Louis Armstrong',
      url: 'https://open.spotify.com/track/2Qoi96v3tL8yR9V7K1yXQp',
      note: 'Frases curtas com descrições vívidas de cores e sentimentos.',
    },
    {
      title: 'Three Little Birds',
      artist: 'Bob Marley',
      url: 'https://open.spotify.com/track/4bN5W5QhC8j34V0g8pE6mF',
      note: 'Vocabulário positivo e repetição que fixa estruturas em inglês.',
    },
  ],
  intermediate: [
    {
      title: 'Viva La Vida',
      artist: 'Coldplay',
      url: 'https://open.spotify.com/track/1mea3bSkSGXuIRvnydlB5b',
      note: 'Ótimo para estudar tempos verbais no passado (past simple e particípios).',
    },
    {
      title: 'Rolling in the Deep',
      artist: 'Adele',
      url: 'https://open.spotify.com/track/1CkvWZme3RKiZJNXZe47ci',
      note: 'Foco em phrasal verbs e expressividade com entonação forte.',
    },
    {
      title: 'Budapest',
      artist: 'George Ezra',
      url: 'https://open.spotify.com/track/2ixOvtAoMgGmgCsBGqxjh8',
      note: 'Condicionais e listas de desejos expressos com ritmo acústico.',
    },
    {
      title: 'Shape of You',
      artist: 'Ed Sheeran',
      url: 'https://open.spotify.com/track/7qiZfU4dY1lWllzX7mPBI3',
      note: 'Excelente para treinar ritmo, cadência natural e connected speech.',
    },
  ],
  advanced: [
    {
      title: 'Fast Car',
      artist: 'Tracy Chapman',
      url: 'https://open.spotify.com/track/2M9ro2krQAaRUMxusiobpC',
      note: 'Narrativa rica em storytelling, metáforas sociais e discurso direto.',
    },
    {
      title: 'Lose Yourself',
      artist: 'Eminem',
      url: 'https://open.spotify.com/track/5Z01UMMf7V1o0Mz98608Fv',
      note: 'Desafio auditivo de alta densidade léxica e rimas complexas.',
    },
    {
      title: 'Bohemian Rhapsody',
      artist: 'Queen',
      url: 'https://open.spotify.com/track/7tFiyTwD0nx5a1eklYtX2J',
      note: 'Diferentes andamentos, vocabulário operístico e gírias teatrais.',
    },
  ],
};

export const NativeFriendSpotifyTable: React.FC<NativeFriendSpotifyTableProps> = ({
  studentUid,
  studentEmail,
  studentName = 'Aluno',
  studentLevel,
  teacherUid,
  teacherName = 'Amigo Nativo',
  teacherEmail,
  weeklyCycle = 1,
  activeStudyDays,
  currentLanguage = 'pt',
}) => {
  const isEn = currentLanguage === 'en';
  const cleanStudentUid = useMemo(() => normalizeStudentIdForPath(studentUid), [studentUid]);

  // Normalized level
  const normalizedLevel = useMemo<EnglishLevel>(() => {
    const raw = (studentLevel || '').toLowerCase();
    if (raw.includes('adv') || raw.includes('c1') || raw.includes('c2')) return EnglishLevel.ADVANCED;
    if (raw.includes('int') || raw.includes('b1') || raw.includes('b2')) return EnglishLevel.INTERMEDIATE;
    return EnglishLevel.BEGINNER;
  }, [studentLevel]);

  const playlistConfig = useMemo(() => getSpotifyPlaylistForLevel(normalizedLevel), [normalizedLevel]);

  // Determine active days list
  const activeDaysList = useMemo<DayOfWeek[]>(() => {
    if (activeStudyDays && activeStudyDays.length > 0) {
      return ALL_DAYS.filter((d) => activeStudyDays.includes(d));
    }
    // Default 5-day plan
    return ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
  }, [activeStudyDays]);

  // Today's day of week
  const todayDayOfWeek = useMemo<DayOfWeek>(() => {
    const dayIndex = new Date().getDay();
    const map: DayOfWeek[] = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    return map[dayIndex];
  }, []);

  // Real-time Firestore routine overrides per day
  const [dayOverrides, setDayOverrides] = useState<Record<string, TeacherOverrideTrack | null>>({});
  const [isLoadingSync, setIsLoadingSync] = useState<boolean>(true);

  useEffect(() => {
    if (!cleanStudentUid) {
      setIsLoadingSync(false);
      return;
    }

    setIsLoadingSync(true);
    const db = getDb();
    let unsub = () => {};

    try {
      const routinesCol = collection(db, 'users', cleanStudentUid, 'routines');
      unsub = onSnapshot(
        routinesCol,
        (snapshot) => {
          const updated: Partial<Record<DayOfWeek, TeacherOverrideTrack | null>> = {};
          ALL_DAYS.forEach((d) => {
            updated[d] = null;
          });
          snapshot.forEach((docSnap) => {
            const day = docSnap.id as DayOfWeek;
            const data = docSnap.data();
            const override = data?.teacherOverrideTrack as TeacherOverrideTrack | undefined;
            updated[day] = override || null;
          });
          setDayOverrides((prev) => ({ ...prev, ...updated }));
          setIsLoadingSync(false);
        },
        (err) => {
          console.warn('NativeFriendSpotifyTable routines listener notice:', err);
          setIsLoadingSync(false);
        }
      );
    } catch (err) {
      console.warn('Error setting up onSnapshot for routines:', err);
      setIsLoadingSync(false);
    }

    return () => {
      unsub();
    };
  }, [cleanStudentUid]);

  // Selected track for compact inline preview
  const [previewTrackUrl, setPreviewTrackUrl] = useState<string | null>(null);
  const [previewDay, setPreviewDay] = useState<DayOfWeek | null>(null);
  const [showPreviewPlayer, setShowPreviewPlayer] = useState<boolean>(false);

  // Override / Recommendation Modal State
  const [editingDay, setEditingDay] = useState<DayOfWeek | null>(null);
  const [modalUrl, setModalUrl] = useState<string>('');
  const [modalTitle, setModalTitle] = useState<string>('');
  const [modalArtist, setModalArtist] = useState<string>('');
  const [modalInstructions, setModalInstructions] = useState<string>('');
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveSuccess, setSaveSuccess] = useState<boolean>(false);

  // Open modal for a specific day
  const handleOpenEditModal = (day: DayOfWeek) => {
    const existingOverride = dayOverrides[day];
    const defaultTrack = selectCurrentDaySpotifyTrack({
      level: normalizedLevel,
      selectedDay: day,
      activeStudyDays: activeDaysList,
      weeklyCycle,
    });

    setEditingDay(day);
    if (existingOverride) {
      setModalUrl(existingOverride.url || '');
      setModalTitle(existingOverride.title || '');
      setModalArtist(existingOverride.artist || existingOverride.artistOrHost || '');
      setModalInstructions(existingOverride.instructions || '');
    } else if (defaultTrack) {
      setModalUrl(defaultTrack.url || '');
      setModalTitle(defaultTrack.title || '');
      setModalArtist(defaultTrack.artist || "It's simple");
      setModalInstructions('');
    } else {
      setModalUrl('');
      setModalTitle('');
      setModalArtist('');
      setModalInstructions('');
    }
    setSaveSuccess(false);
  };

  const handleCloseModal = () => {
    setEditingDay(null);
    setIsSaving(false);
    setSaveSuccess(false);
  };

  // Quick fill from curated library
  const handleSelectCuratedTrack = (track: { title: string; artist: string; url: string; note: string }) => {
    setModalUrl(track.url);
    setModalTitle(track.title);
    setModalArtist(track.artist);
    setModalInstructions(track.note);
  };

  // Save override to Firestore
  const handleSaveOverride = async () => {
    if (!editingDay || !modalUrl.trim() || !cleanStudentUid) return;

    setIsSaving(true);
    try {
      const cleanUrl = modalUrl.trim();
      const embed = getSpotifyEmbedUrl(cleanUrl);
      const trackPayload: TeacherOverrideTrack = {
        id: `override-${editingDay}-${Date.now()}`,
        trackId: cleanUrl.split('/track/')[1]?.split('?')[0] || 'custom-track',
        title: modalTitle.trim() || 'Recommended Audio',
        artist: modalArtist.trim() || 'Spotify Artist',
        artistOrHost: modalArtist.trim() || 'Spotify Artist',
        url: cleanUrl,
        embedUrl: embed || undefined,
        instructions: modalInstructions.trim(),
        teacherUid: teacherUid || '',
        teacherName: teacherName || 'Amigo Nativo',
        teacherEmail: teacherEmail || '',
        updatedAt: new Date().toISOString(),
      };

      const success = await saveTeacherSpotifyOverrideToFirestore(cleanStudentUid, editingDay, trackPayload);
      if (success) {
        setSaveSuccess(true);
        setTimeout(() => {
          handleCloseModal();
        }, 900);
      }
    } catch (err) {
      console.error('Error saving teacher Spotify override:', err);
    } finally {
      setIsSaving(false);
    }
  };

  // Restore default curriculum track
  const handleRestoreDefault = async (day: DayOfWeek) => {
    if (!cleanStudentUid) return;
    const confirmMessage = isEn
      ? `Restore default curriculum audio for ${DAY_LABELS_EN[day]}?`
      : `Restaurar o áudio padrão do currículo para ${DAY_LABELS_PT[day]}?`;

    if (window.confirm(confirmMessage)) {
      try {
        await removeTeacherSpotifyOverrideFromFirestore(cleanStudentUid, day);
        if (editingDay === day) {
          handleCloseModal();
        }
      } catch (err) {
        console.error('Error restoring default track:', err);
      }
    }
  };

  // Compute table rows data
  const tableRows = useMemo(() => {
    return activeDaysList.map((day, idx) => {
      const defaultTrack = selectCurrentDaySpotifyTrack({
        level: normalizedLevel,
        selectedDay: day,
        activeStudyDays: activeDaysList,
        weeklyCycle,
      });
      const override = dayOverrides[day] || null;
      const isOverridden = Boolean(override?.url);

      const displayTitle = override?.title || defaultTrack?.title || (isEn ? 'Rest Day' : 'Dia de Descanso');
      const displayArtist = override?.artist || override?.artistOrHost || defaultTrack?.artist || "It's simple";
      const displayCover = override?.coverUrl || override?.imageUrl || defaultTrack?.imageUrl || defaultTrack?.albumImages?.[0]?.url || '';
      const displayUrl = override?.url || defaultTrack?.url || playlistConfig.playlistUrl;
      const displayEmbedUrl = override?.embedUrl || (override?.url ? getSpotifyEmbedUrl(override.url) : defaultTrack?.embedUrl) || '';
      const teacherNote = override?.instructions || '';

      const isToday = day === todayDayOfWeek;

      return {
        day,
        dayLabel: isEn ? DAY_LABELS_EN[day] : DAY_LABELS_PT[day],
        stepIndex: idx + 1,
        totalSteps: activeDaysList.length,
        isToday,
        isOverridden,
        override,
        displayTitle,
        displayArtist,
        displayCover,
        displayUrl,
        displayEmbedUrl,
        teacherNote,
      };
    });
  }, [activeDaysList, dayOverrides, normalizedLevel, weeklyCycle, isEn, todayDayOfWeek, playlistConfig]);

  // Preview embed sanitizer
  const activePreviewEmbedUrl = useMemo(() => {
    if (!previewTrackUrl) return '';
    return getSpotifyEmbedUrl(previewTrackUrl);
  }, [previewTrackUrl]);

  return (
    <div id="native-friend-spotify-table-container" className="space-y-4">
      {/* Table Header Bar */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-4 sm:p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#1DB954] text-[#000035] flex items-center justify-center shrink-0 shadow-xs">
              <Headphones className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-base font-black text-[#000035]">
                  {isEn ? 'Spotify Audio Assignment' : 'Atribuição de Áudio Spotify'}
                </h3>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-100 text-emerald-900 border border-emerald-300">
                  {isEn ? playlistConfig.levelLabelEn : playlistConfig.levelLabelPt}
                </span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-blue-50 text-blue-800 border border-blue-200">
                  {tableRows.length}x / {isEn ? 'week' : 'sem'}
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                {isEn
                  ? `Live real-time view of what ${studentName} hears in each study session. Click the pencil icon to recommend or override any track.`
                  : `Visualização em tempo real do que ${studentName} escuta em cada sessão. Clique no lápis para recomendar ou substituir.`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {previewTrackUrl && (
              <button
                type="button"
                onClick={() => setShowPreviewPlayer(!showPreviewPlayer)}
                className="px-3 py-1.5 rounded-xl border border-[#1DB954] text-xs font-bold text-[#000035] bg-emerald-50 hover:bg-emerald-100 flex items-center gap-1.5 transition cursor-pointer"
              >
                <Volume2 className="w-3.5 h-3.5 text-[#1DB954]" />
                <span>{showPreviewPlayer ? (isEn ? 'Hide Player' : 'Ocultar Player') : (isEn ? 'Show Player' : 'Ver Player')}</span>
                {showPreviewPlayer ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </button>
            )}

            <a
              href={playlistConfig.playlistUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold flex items-center gap-1.5 transition"
            >
              <span>{isEn ? 'Open Level Playlist' : 'Ver Playlist Oficial'}</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>

        {/* Compact Embedded Audio Player Dock */}
        {showPreviewPlayer && previewTrackUrl && (
          <div className="mt-4 pt-4 border-t border-slate-100 animate-in fade-in duration-200">
            <div className="p-3 bg-black rounded-2xl overflow-hidden border border-[#1DB954]/50 shadow-md">
              <div className="flex items-center justify-between text-white text-xs font-bold mb-2 px-1">
                <div className="flex items-center gap-1.5 text-emerald-400">
                  <Play className="w-3.5 h-3.5 fill-emerald-400" />
                  <span>
                    {isEn ? 'Previewing audio for' : 'Ouvindo áudio de'}: {previewDay ? (isEn ? DAY_LABELS_EN[previewDay] : DAY_LABELS_PT[previewDay]) : ''}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowPreviewPlayer(false)}
                  className="text-slate-400 hover:text-white text-xs cursor-pointer p-1"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <iframe
                src={activePreviewEmbedUrl || undefined}
                width="100%"
                height="80"
                frameBorder="0"
                allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
                loading="lazy"
                title="Teacher Spotify Preview"
                className="rounded-xl"
              />
            </div>
          </div>
        )}
      </div>

      {/* Main Single-Source Spotify Audio Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-black uppercase tracking-wider text-slate-600">
                <th className="py-3 px-4 sm:px-5 w-44">{isEn ? 'Day / Sequence' : 'Dia / Sequência'}</th>
                <th className="py-3 px-4 sm:px-5">{isEn ? 'Audio in Student Routine' : 'Áudio na Rotina do Aluno'}</th>
                <th className="py-3 px-4 sm:px-5 w-48 text-right">{isEn ? 'Teacher Actions' : 'Ações do Professor'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {tableRows.map((row) => (
                <tr
                  key={row.day}
                  className={`transition-colors hover:bg-slate-50/80 ${
                    row.isToday ? 'bg-emerald-50/30' : ''
                  }`}
                >
                  {/* Day Column */}
                  <td className="py-3.5 px-4 sm:px-5 align-middle">
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <span className="font-extrabold text-[#000035] text-sm">
                          {row.dayLabel}
                        </span>
                        {row.isToday && (
                          <span className="px-1.5 py-0.2 rounded-md bg-emerald-600 text-white font-black text-[9px] uppercase tracking-wider">
                            {isEn ? 'Today' : 'Hoje'}
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] text-slate-500 font-semibold flex items-center gap-1">
                        <Calendar className="w-3 h-3 text-slate-400" />
                        <span>
                          {isEn
                            ? `Track ${row.stepIndex} of ${row.totalSteps}`
                            : `Faixa ${row.stepIndex} de ${row.totalSteps}`}
                        </span>
                      </span>
                    </div>
                  </td>

                  {/* Audio in Student Routine Column */}
                  <td className="py-3.5 px-4 sm:px-5 align-middle">
                    <div className="flex items-center gap-3">
                      {/* Album Cover Thumbnail */}
                      <div className="relative shrink-0">
                        {row.displayCover ? (
                          <img
                            src={row.displayCover}
                            alt={row.displayTitle}
                            className="w-12 h-12 rounded-xl object-cover border border-slate-200 shadow-2xs"
                            referrerPolicy="no-referrer"
                          />
                        ) : (
                          <div className="w-12 h-12 rounded-xl bg-emerald-100 border border-emerald-200 text-emerald-800 flex items-center justify-center shadow-2xs">
                            <Music className="w-5 h-5 text-emerald-700" />
                          </div>
                        )}
                        {row.isOverridden && (
                          <div
                            className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-emerald-500 text-white flex items-center justify-center shadow-xs"
                            title={isEn ? 'Teacher Override Active' : 'Substituição Ativa do Professor'}
                          >
                            <Sparkles className="w-3 h-3" />
                          </div>
                        )}
                      </div>

                      {/* Song Details */}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h4 className="font-bold text-[#000035] text-sm truncate max-w-xs sm:max-w-md">
                            {row.displayTitle}
                          </h4>
                          {row.isOverridden ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-100 text-emerald-900 border border-emerald-300">
                              <Sparkles className="w-2.5 h-2.5 text-emerald-700" />
                              <span>{isEn ? 'Teacher Override' : 'Recomendação do Professor'}</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200">
                              <span>{isEn ? 'Curriculum Default' : 'Faixa do Currículo'}</span>
                            </span>
                          )}
                        </div>

                        <p className="text-xs text-slate-600 font-medium truncate mt-0.5">
                          {row.displayArtist}
                        </p>

                        {/* Pedagogical Note / Tip */}
                        {row.teacherNote && (
                          <div className="mt-1.5 flex items-start gap-1.5 text-[11px] text-emerald-900 bg-emerald-50/80 border border-emerald-200/80 rounded-lg px-2.5 py-1 max-w-xl">
                            <Sparkles className="w-3 h-3 text-emerald-600 shrink-0 mt-0.5" />
                            <p className="truncate">
                              <span className="font-bold text-emerald-950">
                                {row.override?.teacherName ? `${row.override.teacherName}: ` : ''}
                              </span>
                              {row.teacherNote}
                            </p>
                          </div>
                        )}
                      </div>

                      {/* External Spotify Link */}
                      <a
                        href={row.displayUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[#1DB954] hover:text-[#1ed760] p-1.5 rounded-lg hover:bg-slate-100 transition shrink-0"
                        title={isEn ? 'Listen on Spotify' : 'Ouvir no Spotify'}
                      >
                        <ExternalLink className="w-4 h-4" />
                      </a>
                    </div>
                  </td>

                  {/* Actions Column */}
                  <td className="py-3.5 px-4 sm:px-5 align-middle text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      {/* Preview Button */}
                      <button
                        type="button"
                        onClick={() => {
                          setPreviewTrackUrl(row.displayUrl);
                          setPreviewDay(row.day);
                          setShowPreviewPlayer(true);
                        }}
                        className="p-2 rounded-xl text-slate-600 hover:text-emerald-700 hover:bg-emerald-50 border border-slate-200 hover:border-emerald-300 transition cursor-pointer"
                        title={isEn ? 'Play Preview' : 'Ouvir Prévia'}
                      >
                        <Play className="w-3.5 h-3.5" />
                      </button>

                      {/* Recommend / Override Action (Pencil) */}
                      <button
                        type="button"
                        onClick={() => handleOpenEditModal(row.day)}
                        className={`px-3 py-1.5 rounded-xl text-xs font-extrabold flex items-center gap-1.5 transition cursor-pointer shadow-2xs ${
                          row.isOverridden
                            ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                            : 'bg-white hover:bg-slate-50 text-[#000035] border border-slate-300 hover:border-slate-400'
                        }`}
                        title={
                          row.isOverridden
                            ? (isEn ? 'Edit Override' : 'Editar Substituição')
                            : (isEn ? 'Recommend / Override Track' : 'Recomendar / Substituir Música')
                        }
                      >
                        <Pencil className="w-3.5 h-3.5" />
                        <span>
                          {row.isOverridden
                            ? (isEn ? 'Edit' : 'Editar')
                            : (isEn ? 'Recommend' : 'Recomendar')}
                        </span>
                      </button>

                      {/* Restore Default button (if already overridden) */}
                      {row.isOverridden && (
                        <button
                          type="button"
                          onClick={() => handleRestoreDefault(row.day)}
                          className="p-2 rounded-xl text-slate-400 hover:text-rose-600 hover:bg-rose-50 border border-transparent hover:border-rose-200 transition cursor-pointer"
                          title={isEn ? 'Restore curriculum default track' : 'Restaurar música padrão do currículo'}
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Recommend / Override Modal */}
      {editingDay && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl max-w-lg w-full overflow-hidden flex flex-col max-h-[90vh]">
            {/* Modal Header */}
            <div className="p-5 sm:p-6 bg-gradient-to-r from-emerald-600 to-teal-700 text-white flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-white/20 backdrop-blur-xs flex items-center justify-center text-white">
                  <Sparkles className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-black">
                    {isEn
                      ? `Recommend Track • ${DAY_LABELS_EN[editingDay]}`
                      : `Recomendar Áudio • ${DAY_LABELS_PT[editingDay]}`}
                  </h3>
                  <p className="text-xs text-emerald-100 font-medium">
                    {isEn
                      ? `Customize the Spotify audio for ${studentName} (${playlistConfig.levelLabelEn})`
                      : `Personalize a faixa no Spotify para ${studentName} (${playlistConfig.levelLabelPt})`}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleCloseModal}
                className="text-white/80 hover:text-white p-1 rounded-xl hover:bg-white/10 transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 sm:p-6 space-y-4 overflow-y-auto flex-1">
              {/* Quick Curated Selection */}
              <div>
                <label className="block text-xs font-black uppercase tracking-wider text-slate-700 mb-1.5 flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-emerald-600" />
                  <span>
                    {isEn ? '1-Click Curated Level Suggestions' : 'Sugestões Rápidas do Nível (1-Clique)'}
                  </span>
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {(CURATED_LEVEL_TRACKS[normalizedLevel] || CURATED_LEVEL_TRACKS.beginner).map((track) => (
                    <button
                      key={track.title}
                      type="button"
                      onClick={() => handleSelectCuratedTrack(track)}
                      className="p-2.5 rounded-xl border border-slate-200 hover:border-emerald-400 bg-slate-50 hover:bg-emerald-50/60 text-left transition cursor-pointer group"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-extrabold text-xs text-[#000035] group-hover:text-emerald-900 truncate">
                          {track.title}
                        </span>
                        <Play className="w-3 h-3 text-slate-400 group-hover:text-emerald-600 shrink-0" />
                      </div>
                      <p className="text-[10px] text-slate-500 font-medium truncate">{track.artist}</p>
                    </button>
                  ))}
                </div>
              </div>

              {/* Spotify Track URL Input */}
              <div>
                <label className="block text-xs font-black uppercase tracking-wider text-slate-700 mb-1">
                  {isEn ? 'Spotify Track Link or URI' : 'Link ou URI da Faixa no Spotify'} <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  value={modalUrl}
                  onChange={(e) => setModalUrl(e.target.value)}
                  placeholder="https://open.spotify.com/track/..."
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-xs font-medium text-slate-900 placeholder:text-slate-400"
                />
                <p className="text-[10px] text-slate-500 mt-1">
                  {isEn
                    ? 'Paste any track or podcast episode link from Spotify.'
                    : 'Cole qualquer link de música ou episódio de podcast do Spotify.'}
                </p>
              </div>

              {/* Track Title & Artist */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-black uppercase tracking-wider text-slate-700 mb-1">
                    {isEn ? 'Song / Audio Title' : 'Título da Música'}
                  </label>
                  <input
                    type="text"
                    value={modalTitle}
                    onChange={(e) => setModalTitle(e.target.value)}
                    placeholder={isEn ? 'E.g. Count on Me' : 'Ex: Count on Me'}
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-xs font-medium text-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-xs font-black uppercase tracking-wider text-slate-700 mb-1">
                    {isEn ? 'Artist / Host' : 'Artista / Banda'}
                  </label>
                  <input
                    type="text"
                    value={modalArtist}
                    onChange={(e) => setModalArtist(e.target.value)}
                    placeholder={isEn ? 'E.g. Bruno Mars' : 'Ex: Bruno Mars'}
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-xs font-medium text-slate-900"
                  />
                </div>
              </div>

              {/* Pedagogical Note / Instructions for Student */}
              <div>
                <label className="block text-xs font-black uppercase tracking-wider text-slate-700 mb-1">
                  {isEn ? 'Pedagogical Note / Tip for the Student' : 'Dica Pedagógica / Nota para o Aluno'}
                </label>
                <textarea
                  value={modalInstructions}
                  onChange={(e) => setModalInstructions(e.target.value)}
                  rows={3}
                  placeholder={
                    isEn
                      ? 'E.g. Pay attention to the pronunciation of regular verbs in the chorus.'
                      : 'Ex: Preste atenção na pronúncia dos verbos no passado durante o refrão.'
                  }
                  className="w-full px-3.5 py-2 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-xs font-medium text-slate-900 placeholder:text-slate-400 resize-none"
                />
              </div>

              {/* Success Notification */}
              {saveSuccess && (
                <div className="p-3 bg-emerald-50 border border-emerald-300 rounded-xl text-xs text-emerald-900 font-bold flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>
                    {isEn
                      ? 'Track override saved and synced with student routine!'
                      : 'Música recomendada salva e sincronizada na rotina do aluno!'}
                  </span>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-4 sm:p-5 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-3 shrink-0">
              {dayOverrides[editingDay] ? (
                <button
                  type="button"
                  onClick={() => handleRestoreDefault(editingDay)}
                  className="px-3.5 py-2 rounded-xl text-rose-600 hover:text-rose-700 hover:bg-rose-50 border border-rose-200 text-xs font-bold transition flex items-center gap-1.5 cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>{isEn ? 'Clear Override' : 'Restaurar Padrão'}</span>
                </button>
              ) : (
                <div />
              )}

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCloseModal}
                  className="px-4 py-2 rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-100 text-xs font-bold transition cursor-pointer"
                >
                  {isEn ? 'Cancel' : 'Cancelar'}
                </button>
                <button
                  type="button"
                  onClick={handleSaveOverride}
                  disabled={isSaving || !modalUrl.trim()}
                  className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-black transition flex items-center gap-1.5 cursor-pointer shadow-xs"
                >
                  {isSaving ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>{isEn ? 'Saving...' : 'Salvando...'}</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>{isEn ? 'Save Override' : 'Salvar Recomendação'}</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default NativeFriendSpotifyTable;
