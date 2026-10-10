import React, { useState, useMemo, useEffect } from 'react';
import {
  Search,
  Star,
  Video,
  Calendar,
  MessageSquare,
  Sparkles,
  ShieldCheck,
  CheckCircle,
  Filter,
  Play,
  X,
  ArrowRight,
  Globe,
  Clock,
} from 'lucide-react';
import { NativeFriendTutor, INITIAL_NATIVE_FRIENDS } from '../data/tutors';
import { isTutorApproved, isTeacherRole } from '../hooks/useNativeFriends';
import { Language } from '../types';
import { getTranslations } from '../utils/i18n';
import { extractYouTubeVideoId } from '../utils/youtube';

interface FindTutorsSectionProps {
  currentLanguage: Language;
  tutors?: NativeFriendTutor[];
  onBookLesson?: (tutor: NativeFriendTutor) => void;
  onSendMessage?: (tutor: NativeFriendTutor) => void;
  onSelectMentor?: (tutor: NativeFriendTutor) => void;
  selectedMentorEmail?: string;
}

export const FindTutorsSection: React.FC<FindTutorsSectionProps> = ({
  currentLanguage,
  tutors: passedTutors,
  onBookLesson,
  onSendMessage,
  onSelectMentor,
  selectedMentorEmail,
}) => {
  const t = getTranslations(currentLanguage);
  const tutors = useMemo(() => {
    const list = passedTutors && passedTutors.length > 0 ? passedTutors : INITIAL_NATIVE_FRIENDS;
    // Approved Native Friends list for public directory
    const approvedList = list.filter((t) => {
      return isTutorApproved(t) && isTeacherRole(t);
    });

    // Required simple console.log to list retrieved Firestore IDs on the public page for production validation
    console.log(
      '[NativeFriends Directory] Retrieved Firestore tutor IDs:',
      approvedList.map((t) => t.id || t.email)
    );

    return approvedList;
  }, [passedTutors]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCountry, setSelectedCountry] = useState<string>('all');
  const [selectedSpecialty, setSelectedSpecialty] = useState<string>('all');
  const [activeVideoModal, setActiveVideoModal] = useState<NativeFriendTutor | null>(null);

  // Support ESC key to close video modal
  useEffect(() => {
    if (!activeVideoModal) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setActiveVideoModal(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeVideoModal]);

  const countries = useMemo(() => {
    const list = Array.from(new Set((tutors || []).map((t) => t?.country).filter(Boolean)));
    return ['all', ...list];
  }, [tutors]);

  const allSpecialties = useMemo(() => {
    const set = new Set<string>();
    (tutors || []).forEach((t) => {
      if (t && Array.isArray(t.specialties)) {
        t.specialties.forEach((s) => set.add(s));
      }
    });
    return ['all', ...Array.from(set)];
  }, [tutors]);

  const filteredTutors = useMemo(() => {
    return (tutors || []).filter((tutor) => {
      const matchesSearch =
        (tutor.name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (tutor.headline || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (tutor.bio || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (tutor.accent || '').toLowerCase().includes(searchQuery.toLowerCase());

      const matchesCountry = selectedCountry === 'all' || tutor.country === selectedCountry;
      const matchesSpecialty =
        selectedSpecialty === 'all' ||
        (Array.isArray(tutor.specialties) && tutor.specialties.includes(selectedSpecialty));

      return matchesSearch && matchesCountry && matchesSpecialty;
    });
  }, [tutors, searchQuery, selectedCountry, selectedSpecialty]);

  return (
    <section className="py-12 sm:py-16 bg-[#000035] text-white border-t border-[#1C4C96]/50" id="find-native-friend">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header Title */}
        <div className="text-center max-w-3xl mx-auto space-y-3">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#1C4C96]/60 border border-[#9AB4FF]/50 text-[#9AB4FF] text-[11px] font-bold">
            <Globe className="w-3.5 h-3.5 text-[#9AB4FF]" />
            <span>{t.tutorsHeaderBadge}</span>
          </div>

          <h2 className="text-2xl sm:text-3xl lg:text-4xl font-black text-white tracking-tight">
            {t.tutorsHeaderTitle}
          </h2>

          <p className="text-xs sm:text-sm text-blue-100 font-normal leading-relaxed">
            {t.tutorsHeaderSubtitle}
          </p>
        </div>

        {/* Filters Bar */}
        <div className="mt-8 bg-[#062863]/60 border border-[#607EC9]/40 rounded-2xl p-3.5 sm:p-4.5 shadow-xl space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
            {/* Search Input */}
            <div className="sm:col-span-6 relative">
              <Search className="w-3.5 h-3.5 text-[#9AB4FF] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t.searchTutorsPlaceholder}
                className="w-full pl-9 pr-3 py-2 bg-[#000035] border border-[#607EC9]/50 rounded-xl text-xs text-white placeholder:text-[#9AB4FF]/60 focus:outline-hidden focus:ring-2 focus:ring-[#9AB4FF]"
              />
            </div>

            {/* Country Selector */}
            <div className="sm:col-span-3">
              <select
                value={selectedCountry}
                onChange={(e) => setSelectedCountry(e.target.value)}
                className="w-full px-2.5 py-2 bg-[#000035] border border-[#607EC9]/50 rounded-xl text-xs text-white font-medium focus:outline-hidden focus:ring-2 focus:ring-[#9AB4FF]"
              >
                <option value="all" className="bg-[#000035] text-white">
                  {t.allCountriesOption}
                </option>
                {countries
                  .filter((c) => c !== 'all')
                  .map((c) => (
                    <option key={c} value={c} className="bg-[#000035] text-white">
                      {c}
                    </option>
                  ))}
              </select>
            </div>

            {/* Specialty Selector */}
            <div className="sm:col-span-3">
              <select
                value={selectedSpecialty}
                onChange={(e) => setSelectedSpecialty(e.target.value)}
                className="w-full px-2.5 py-2 bg-[#000035] border border-[#607EC9]/50 rounded-xl text-xs text-white font-medium focus:outline-hidden focus:ring-2 focus:ring-[#9AB4FF]"
              >
                <option value="all" className="bg-[#000035] text-white">
                  {t.allSpecialtiesOption}
                </option>
                {allSpecialties
                  .filter((s) => s !== 'all')
                  .map((s) => (
                    <option key={s} value={s} className="bg-[#000035] text-white">
                      {s}
                    </option>
                  ))}
              </select>
            </div>
          </div>

          <div className="flex items-center justify-between text-[11px] text-[#9AB4FF] px-1 pt-1 border-t border-[#1C4C96]/50">
            <span className="font-semibold">
              {filteredTutors.length} {t.badge100Native}
            </span>
            {(searchQuery || selectedCountry !== 'all' || selectedSpecialty !== 'all') && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setSelectedCountry('all');
                  setSelectedSpecialty('all');
                }}
                className="text-[#F4CA54] hover:underline font-bold cursor-pointer"
              >
                {t.cancel}
              </button>
            )}
          </div>
        </div>

        {/* Tutors List */}
        <div className="mt-6 space-y-4">
          {filteredTutors.length === 0 ? (
            <div className="text-center py-12 bg-[#062863]/40 rounded-2xl border border-dashed border-[#607EC9]/40">
              <Search className="w-8 h-8 text-[#9AB4FF]/50 mx-auto mb-2.5" />
              <h3 className="text-sm font-bold text-white">
                {t.noTutorsFound}
              </h3>
            </div>
          ) : (
            filteredTutors.map((tutor) => {
              const isSelectedMentor = selectedMentorEmail === tutor.email;

              return (
                <div
                  key={tutor.id}
                  className={`bg-gradient-to-br from-[#062863]/90 via-[#000035] to-[#1C4C96]/60 rounded-2xl p-4.5 sm:p-5 border transition-all duration-200 shadow-xl flex flex-col lg:flex-row gap-5 items-start justify-between ${
                    isSelectedMentor
                      ? 'border-[#9AB4FF] ring-2 ring-[#9AB4FF]/60 bg-[#062863]'
                      : 'border-[#607EC9]/45 hover:border-[#9AB4FF]'
                  }`}
                >
                  {/* Left: Avatar & Intro Video Preview */}
                  <div className="flex flex-col items-center sm:items-start gap-3 shrink-0 w-full sm:w-auto">
                    <div className="relative">
                      {tutor.avatar && tutor.avatar.trim() !== '' ? (
                        <img
                          src={tutor.avatar}
                          alt={tutor.name}
                          className="w-18 h-18 sm:w-20 sm:h-20 rounded-xl object-cover border-2 border-[#9AB4FF]/60 shadow-md"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <div className="w-18 h-18 sm:w-20 sm:h-20 rounded-xl bg-[#062863] text-white flex items-center justify-center font-black text-2xl border-2 border-[#9AB4FF]/60 shadow-md">
                          {tutor.name?.slice(0, 2).toUpperCase() || 'NF'}
                        </div>
                      )}
                      <span className="absolute -bottom-1.5 -right-1.5 text-xl drop-shadow-md" title={tutor.country}>
                        {tutor.flag}
                      </span>
                    </div>

                    {Boolean(
                      (
                        tutor.videoIntroUrl ||
                        tutor.youtubeUrl ||
                        tutor.videoUrl ||
                        tutor.introVideoUrl ||
                        tutor.youtubeEmbedId ||
                        ''
                      ).trim()
                    ) && (
                      <button
                        type="button"
                        onClick={() => setActiveVideoModal(tutor)}
                        className="w-full sm:w-auto flex items-center justify-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#1C4C96]/60 hover:bg-[#1C4C96] text-[#9AB4FF] hover:text-white text-[11px] font-bold transition cursor-pointer border border-[#607EC9]/40"
                      >
                        <Play className="w-3 h-3 fill-[#9AB4FF]" />
                        <span>{t.watchIntroVideoBtn}</span>
                      </button>
                    )}
                  </div>

                  {/* Center: Tutor Details & Bio */}
                  <div className="flex-1 space-y-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-base sm:text-lg font-black text-white">
                        {tutor.name}
                      </h3>
                      {tutor.isSuperTutor && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-950/80 text-[#F4CA54] border border-[#F4CA54]/50">
                          <Sparkles className="w-2.5 h-2.5 text-[#F4CA54]" />
                          <span>Super Native Friend</span>
                        </span>
                      )}
                      {isSelectedMentor && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#1C4C96] text-white border border-[#9AB4FF]">
                          <CheckCircle className="w-2.5 h-2.5 text-[#9AB4FF]" />
                          <span>Mentor</span>
                        </span>
                      )}
                    </div>

                    {/* Stats & Accent */}
                    <div className="flex flex-wrap items-center gap-3 text-[11px] font-semibold text-[#9AB4FF]">
                      <div className="flex items-center gap-1 text-[#F4CA54] font-bold">
                        <Star className="w-3.5 h-3.5 fill-[#F4CA54] text-[#F4CA54]" />
                        <span>{(typeof tutor.rating === 'number' ? tutor.rating : 5.0).toFixed(1)}</span>
                        <span className="text-[#9AB4FF]/70">({tutor.reviewsCount ?? 0} {t.reviewsLabel})</span>
                      </div>
                      <div className="flex items-center gap-1 text-slate-200">
                        <Globe className="w-3 h-3 text-[#9AB4FF]" />
                        <span>{tutor.accent || 'Native'}</span>
                      </div>
                      <div className="flex items-center gap-1 text-emerald-400">
                        <ShieldCheck className="w-3 h-3" />
                        <span>{tutor.lessonsTaught ?? 0}+ {t.badge30MinMeet}</span>
                      </div>
                    </div>

                    {/* Headline */}
                    <p className="text-xs font-bold text-[#9AB4FF]">
                      “{tutor.headline || 'English Conversational Native Friend'}”
                    </p>

                    {/* Bio excerpt */}
                    <p className="text-xs text-blue-100/90 leading-relaxed">
                      {tutor.bio}
                    </p>

                    {/* Specialties Chips */}
                    <div className="flex flex-wrap gap-1 pt-0.5">
                      {(tutor.specialties || []).map((spec, idx) => (
                        <span
                          key={idx}
                          className="text-[10px] sm:text-[11px] font-medium px-2 py-0.5 rounded-md bg-[#000035]/80 text-[#9AB4FF] border border-[#607EC9]/40"
                        >
                          {spec}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Right: Booking Actions & Price */}
                  <div className="w-full lg:w-48 shrink-0 bg-[#000035]/90 rounded-xl p-3 border border-[#607EC9]/50 flex flex-col justify-between gap-3">
                    <div>
                      <span className="text-[11px] text-[#9AB4FF]/80 font-bold block">
                        {t.badge30MinMeet}
                      </span>
                      <div className="flex items-baseline gap-1 mt-0.5">
                        <span className="text-lg sm:text-xl font-black text-white">
                          ${tutor.pricePerSessionUsd ?? 15} USD
                        </span>
                        <span className="text-[11px] text-[#9AB4FF] font-semibold">
                          / 50 min
                        </span>
                      </div>
                      <span className="text-[10px] text-emerald-400 font-bold flex items-center gap-1 mt-0.5">
                        <CheckCircle className="w-2.5 h-2.5" />
                        <span>{currentLanguage === 'en' ? '1st Trial: 25 min Free' : '1ª Aula: 25 min Grátis'}</span>
                      </span>
                    </div>

                    <div className="space-y-1.5">
                      <button
                        type="button"
                        onClick={() => onBookLesson && onBookLesson(tutor)}
                        className="w-full py-2 px-3 rounded-lg bg-[#607EC9] text-white hover:bg-[#1C4C96] font-bold text-xs shadow-md transition flex items-center justify-center gap-1.5 cursor-pointer border border-[#9AB4FF]/60"
                      >
                        <Calendar className="w-3.5 h-3.5" />
                        <span>{t.bookLesson30MinBtn}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => onSendMessage && onSendMessage(tutor)}
                        className="w-full py-1.5 px-2.5 rounded-lg bg-[#000035] text-white border border-[#607EC9] hover:bg-[#062863] font-bold text-[11px] transition flex items-center justify-center gap-1 cursor-pointer"
                      >
                        <MessageSquare className="w-3 h-3 text-[#9AB4FF]" />
                        <span>{t.sendMessageBtn}</span>
                      </button>

                      {onSelectMentor && (
                        <button
                          type="button"
                          onClick={() => onSelectMentor(tutor)}
                          className={`w-full py-2 px-2.5 rounded-lg font-bold text-[11px] transition flex items-center justify-center gap-1.5 cursor-pointer shadow-xs active:scale-98 ${
                            isSelectedMentor
                              ? 'bg-[#1C4C96] hover:bg-[#062863] text-white border border-[#9AB4FF]/50'
                              : 'bg-emerald-600 hover:bg-emerald-500 text-white border border-emerald-400/50'
                          }`}
                        >
                          <Sparkles className="w-3.5 h-3.5 text-emerald-200" />
                          <span>
                            {isSelectedMentor
                              ? (currentLanguage === 'en' ? 'Buy More Lessons' : 'Comprar Mais Aulas')
                              : (currentLanguage === 'en' ? 'Buy Package & Link' : 'Comprar Pacote & Vincular')}
                          </span>
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

      {/* Intro Video Modal */}
      {activeVideoModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setActiveVideoModal(null);
          }}
        >
          <div className="bg-white rounded-3xl max-w-2xl w-full overflow-hidden shadow-2xl border border-white/20 animate-in fade-in zoom-in duration-200">
            <div className="flex items-center justify-between p-4 bg-[#000035] text-white">
              <div className="flex items-center gap-2">
                <span className="text-xl">{activeVideoModal.flag}</span>
                <div>
                  <h4 className="font-extrabold text-sm sm:text-base">{activeVideoModal.name}</h4>
                  <span className="text-xs text-[#9AB4FF]">{activeVideoModal.accent}</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setActiveVideoModal(null)}
                className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center cursor-pointer transition"
                aria-label="Close"
                title="Fechar (Esc)"
              >
                <X className="w-4 h-4 text-white" />
              </button>
            </div>

            {(() => {
              const rawVideo = (
                activeVideoModal.videoIntroUrl ||
                activeVideoModal.youtubeUrl ||
                activeVideoModal.videoUrl ||
                activeVideoModal.introVideoUrl ||
                activeVideoModal.youtubeEmbedId ||
                ''
              ).trim();

              const embedId = extractYouTubeVideoId(rawVideo);

              if (embedId) {
                return (
                  <div className="w-full aspect-video rounded-xl overflow-hidden bg-black">
                    <iframe
                      src={`https://www.youtube.com/embed/${embedId}?autoplay=1&rel=0`}
                      title={`Introduction by ${activeVideoModal.name}`}
                      className="w-full h-full border-0"
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                      allowFullScreen
                    />
                  </div>
                );
              }

              if (rawVideo) {
                return (
                  <div className="w-full aspect-video rounded-xl overflow-hidden bg-black flex items-center justify-center">
                    <video
                      src={rawVideo}
                      controls
                      autoPlay
                      playsInline
                      className="w-full h-full object-contain bg-black"
                    >
                      {currentLanguage === 'en' ? 'Your browser does not support HTML5 video.' : 'Seu navegador não suporta vídeos HTML5.'}
                    </video>
                  </div>
                );
              }

              return null;
            })()}

            <div className="p-4 sm:p-5 bg-slate-50 flex items-center justify-between gap-4">
              <div>
                <p className="text-xs sm:text-sm text-slate-700 font-medium">
                  {activeVideoModal.name}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  const tutor = activeVideoModal;
                  setActiveVideoModal(null);
                  if (onBookLesson) onBookLesson(tutor);
                }}
                className="px-4 py-2 rounded-xl bg-[#062863] text-white hover:bg-[#000035] font-bold text-xs sm:text-sm shadow-xs transition cursor-pointer shrink-0"
              >
                {t.bookLesson30MinBtn}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};

