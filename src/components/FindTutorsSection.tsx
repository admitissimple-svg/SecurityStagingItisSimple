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
  Award,
} from 'lucide-react';
import { NativeFriendTutor, INITIAL_NATIVE_FRIENDS } from '../data/tutors';
import { isTutorApproved, isTeacherRole } from '../hooks/useNativeFriends';
import { consolidateTutorsList, normalizeTutorName } from '../utils/tutorConsolidation';
import { Language } from '../types';
import { getTranslations } from '../utils/i18n';
import { extractYouTubeVideoId } from '../utils/youtube';

interface FindTutorsSectionProps {
  currentLanguage: Language;
  tutors?: NativeFriendTutor[];
  onStartLivingWithTutor?: (tutor: NativeFriendTutor) => void;
  onBookLesson?: (tutor: NativeFriendTutor) => void;
  onSendMessage?: (tutor: NativeFriendTutor) => void;
  onSelectMentor?: (tutor: NativeFriendTutor) => void;
  selectedMentorEmail?: string;
}

export const FindTutorsSection: React.FC<FindTutorsSectionProps> = ({
  currentLanguage,
  tutors: passedTutors,
  onStartLivingWithTutor,
  onBookLesson,
  onSendMessage,
  onSelectMentor,
  selectedMentorEmail,
}) => {
  const t = getTranslations(currentLanguage);
  const isEn = currentLanguage === 'en';

  const tutors = useMemo(() => {
    const list = passedTutors && passedTutors.length > 0 ? passedTutors : INITIAL_NATIVE_FRIENDS;
    const consolidated = consolidateTutorsList(list) as NativeFriendTutor[];
    // Approved Native Friends list for public directory
    const approvedList = consolidated.filter((t) => {
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
  const [detailedProfileTutor, setDetailedProfileTutor] = useState<NativeFriendTutor | null>(null);

  // Support ESC key to close video modal or detailed profile modal
  useEffect(() => {
    if (!activeVideoModal && !detailedProfileTutor) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setActiveVideoModal(null);
        setDetailedProfileTutor(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeVideoModal, detailedProfileTutor]);

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
    const q = (searchQuery || '').toLowerCase().trim();
    const matched = (tutors || []).filter((tutor) => {
      if (!tutor) return false;
      const matchesSearch = !q || (
        (tutor.name || '').toLowerCase().includes(q) ||
        (tutor.headline || '').toLowerCase().includes(q) ||
        (tutor.bio || '').toLowerCase().includes(q) ||
        (tutor.accent || '').toLowerCase().includes(q)
      );

      const matchesCountry = selectedCountry === 'all' || tutor.country === selectedCountry;
      const matchesSpecialty =
        selectedSpecialty === 'all' ||
        (Array.isArray(tutor.specialties) && tutor.specialties.includes(selectedSpecialty));

      return matchesSearch && matchesCountry && matchesSpecialty;
    });

    // Strict deduplication safeguard: guarantee each unique Native Friend appears exactly once
    const seen = new Set<string>();
    return matched.filter((tutor) => {
      const normName = normalizeTutorName(tutor.name);
      const pubId = (tutor.publicTutorId || tutor.id || '').toLowerCase().trim();
      const dedupeKey = normName && normName !== 'native friend' ? `name:${normName}` : `id:${pubId}`;
      if (seen.has(dedupeKey)) return false;
      seen.add(dedupeKey);
      return true;
    });
  }, [tutors, searchQuery, selectedCountry, selectedSpecialty]);

  const handleStartJourney = (tutor: NativeFriendTutor) => {
    if (activeVideoModal) setActiveVideoModal(null);
    if (detailedProfileTutor) setDetailedProfileTutor(null);
    if (typeof onStartLivingWithTutor === 'function') {
      onStartLivingWithTutor(tutor);
    } else if (typeof onSelectMentor === 'function') {
      onSelectMentor(tutor);
    } else if (typeof onBookLesson === 'function') {
      onBookLesson(tutor);
    }
  };

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

        {/* Tutors Discovery Cards List */}
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
              const selEmail = (selectedMentorEmail || '').toLowerCase().trim();
              const isSelectedMentor = Boolean(
                selEmail && (
                  (tutor.email && selEmail === tutor.email.toLowerCase().trim()) ||
                  (tutor.id && selEmail === tutor.id.toLowerCase().trim())
                )
              );

              const hasVideo = Boolean(
                (
                  tutor.videoIntroUrl ||
                  tutor.youtubeUrl ||
                  tutor.videoUrl ||
                  tutor.introVideoUrl ||
                  tutor.youtubeEmbedId ||
                  ''
                ).trim()
              );

              const firstName = tutor.name?.split(' ')[0] || tutor.name;

              return (
                <div
                  key={tutor.id}
                  id={`tutor-discovery-card-${tutor.id}`}
                  className={`bg-gradient-to-br from-[#062863]/90 via-[#000035] to-[#1C4C96]/60 rounded-2xl p-4.5 sm:p-5 border transition-all duration-200 shadow-xl flex flex-col lg:flex-row gap-5 items-start justify-between ${
                    isSelectedMentor
                      ? 'border-[#9AB4FF] ring-2 ring-[#9AB4FF]/60 bg-[#062863]'
                      : 'border-[#607EC9]/45 hover:border-[#9AB4FF]'
                  }`}
                >
                  {/* Left Column: Avatar, Flag & Video Preview */}
                  <div className="flex flex-col items-center sm:items-start gap-3 shrink-0 w-full sm:w-auto">
                    <div className="relative">
                      {tutor.avatar && tutor.avatar.trim() !== '' ? (
                        <img
                          src={tutor.avatar}
                          alt={tutor.name}
                          className="w-20 h-20 sm:w-22 sm:h-22 rounded-2xl object-cover border-2 border-[#9AB4FF]/60 shadow-md"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <div className="w-20 h-20 sm:w-22 sm:h-22 rounded-2xl bg-[#062863] text-white flex items-center justify-center font-black text-2xl border-2 border-[#9AB4FF]/60 shadow-md">
                          {tutor.name?.slice(0, 2).toUpperCase() || 'NF'}
                        </div>
                      )}
                      <span className="absolute -bottom-1 -right-1 text-xl drop-shadow-md" title={tutor.country}>
                        {tutor.flag || '🇺🇸'}
                      </span>
                    </div>

                    {/* Presentation Video Button - Rendered ONLY if video exists */}
                    {hasVideo && (
                      <button
                        type="button"
                        onClick={() => setActiveVideoModal(tutor)}
                        className="w-full sm:w-auto flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#1C4C96]/80 hover:bg-[#1C4C96] text-[#9AB4FF] hover:text-white text-[11px] font-bold transition cursor-pointer border border-[#607EC9]/50 shadow-xs"
                      >
                        <Play className="w-3 h-3 fill-[#9AB4FF]" />
                        <span>{isEn ? 'Watch Presentation' : 'Assistir Vídeo'}</span>
                      </button>
                    )}
                  </div>

                  {/* Center Column: Professional Bio, Country, Accent & Specialties */}
                  <div className="flex-1 space-y-2.5 w-full">
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
                          <span>{isEn ? 'Current Mentor' : 'Mentor Atual'}</span>
                        </span>
                      )}
                    </div>

                    {/* Stats & Accent */}
                    <div className="flex flex-wrap items-center gap-3 text-[11px] font-semibold text-[#9AB4FF]">
                      {/* Rating only displayed if real reviews exist */}
                      {typeof tutor.rating === 'number' && tutor.reviewsCount !== undefined && tutor.reviewsCount > 0 ? (
                        <div className="flex items-center gap-1 text-[#F4CA54] font-bold">
                          <Star className="w-3.5 h-3.5 fill-[#F4CA54] text-[#F4CA54]" />
                          <span>{tutor.rating.toFixed(1)}</span>
                          <span className="text-[#9AB4FF]/70">({tutor.reviewsCount} {t.reviewsLabel})</span>
                        </div>
                      ) : null}

                      <div className="flex items-center gap-1 text-slate-200">
                        <Globe className="w-3 h-3 text-[#9AB4FF]" />
                        <span>{tutor.country || 'Native Speaker'}</span>
                        <span>•</span>
                        <span>{tutor.accent || 'North American'}</span>
                      </div>

                      {typeof tutor.lessonsTaught === 'number' && tutor.lessonsTaught > 0 ? (
                        <div className="flex items-center gap-1 text-emerald-400">
                          <ShieldCheck className="w-3 h-3" />
                          <span>{tutor.lessonsTaught}+ {t.badge30MinMeet}</span>
                        </div>
                      ) : null}
                    </div>

                    {/* Professional Headline */}
                    {tutor.headline && (
                      <p className="text-xs font-bold text-[#9AB4FF]">
                        “{tutor.headline}”
                      </p>
                    )}

                    {/* Professional Bio / Description */}
                    <p className="text-xs text-blue-100/90 leading-relaxed line-clamp-3">
                      {tutor.bio || (isEn
                        ? 'Experienced Native Friend ready to guide you step by step through natural conversation and daily routines.'
                        : 'Amigo Nativo experiente pronto para guiar você passo a passo através de conversas reais e rotinas diárias.')}
                    </p>

                    {/* Specialties Badges */}
                    {Array.isArray(tutor.specialties) && tutor.specialties.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 pt-0.5">
                        {tutor.specialties.map((spec, idx) => (
                          <span
                            key={idx}
                            className="text-[10px] sm:text-[11px] font-medium px-2 py-0.5 rounded-md bg-[#000035]/80 text-[#9AB4FF] border border-[#607EC9]/40"
                          >
                            {spec}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Right Column: Discovery Action Panel (Zero commercial packages, 100% Start Living Integration) */}
                  <div className="w-full lg:w-56 shrink-0 bg-[#000035]/95 rounded-2xl p-4 border border-[#607EC9]/50 flex flex-col justify-between gap-3 shadow-lg">
                    <div className="space-y-2">
                      <div className="flex items-baseline justify-between">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-[#9AB4FF]/80">
                          {isEn ? 'Standard Rate' : 'Valor da Aula'}
                        </span>
                        <span className="text-[11px] text-slate-300 font-semibold">
                          50 min Meet
                        </span>
                      </div>

                      <div className="flex items-baseline gap-1">
                        <span className="text-xl sm:text-2xl font-black text-white">
                          ${tutor.pricePerSessionUsd ?? 15} USD
                        </span>
                        <span className="text-[11px] text-[#9AB4FF] font-semibold">
                          / 50 min
                        </span>
                      </div>

                      {/* Free Trial Lesson Guarantee */}
                      <div className="p-2 rounded-xl bg-emerald-500/15 border border-emerald-400/40 text-emerald-300">
                        <div className="flex items-center gap-1.5 font-bold text-[11px]">
                          <CheckCircle className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                          <span>{isEn ? '1st Trial: 25 min Free' : '1ª Aula: 25 min Grátis'}</span>
                        </div>
                        <span className="text-[10px] text-emerald-400/80 block mt-0.5 font-medium">
                          {isEn ? 'Zero commitment • No credit card' : 'Sem compromisso • Sem cartão agora'}
                        </span>
                      </div>
                    </div>

                    <div className="space-y-2 pt-1 border-t border-[#1C4C96]/60">
                      {/* Primary CTA: Start Living in English with this Native Friend */}
                      <button
                        type="button"
                        id={`btn-start-journey-${tutor.id}`}
                        onClick={() => handleStartJourney(tutor)}
                        className="w-full py-2.5 px-3 rounded-xl bg-[#F4CA54] hover:bg-amber-400 text-[#000035] font-black text-xs shadow-md transition flex items-center justify-center gap-1.5 cursor-pointer transform hover:scale-[1.02] active:scale-[0.98]"
                      >
                        <Sparkles className="w-3.5 h-3.5 text-[#000035]" />
                        <span className="truncate">
                          {isEn ? `Start Journey with ${firstName}` : `Começar com ${firstName}`}
                        </span>
                        <ArrowRight className="w-3.5 h-3.5 text-[#000035] shrink-0" />
                      </button>

                      {/* Secondary Action: Access Full Professional Profile & Description */}
                      <button
                        type="button"
                        id={`btn-view-profile-${tutor.id}`}
                        onClick={() => setDetailedProfileTutor(tutor)}
                        className="w-full py-1.5 px-2 rounded-lg bg-white/10 hover:bg-white/15 text-slate-200 hover:text-white font-bold text-[11px] transition flex items-center justify-center gap-1 cursor-pointer"
                      >
                        <span>{isEn ? 'View Profile & Details' : 'Ver Perfil & Detalhes'}</span>
                      </button>
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
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setActiveVideoModal(null);
          }}
        >
          <div className="bg-[#000035] rounded-3xl max-w-2xl w-full overflow-hidden shadow-2xl border border-[#607EC9]/40 animate-in fade-in zoom-in duration-200">
            <div className="flex items-center justify-between p-4 bg-gradient-to-r from-[#062863] via-[#000035] to-[#1C4C96] text-white border-b border-[#607EC9]/30">
              <div className="flex items-center gap-2">
                <span className="text-xl">{activeVideoModal.flag || '🇺🇸'}</span>
                <div>
                  <h4 className="font-extrabold text-sm sm:text-base">{activeVideoModal.name}</h4>
                  <span className="text-xs text-[#9AB4FF]">{activeVideoModal.accent || 'North American'}</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setActiveVideoModal(null)}
                className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center cursor-pointer transition text-white"
                aria-label="Close"
                title="Fechar (Esc)"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 sm:p-5 space-y-4">
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
                    <div className="w-full aspect-video rounded-xl overflow-hidden bg-black border border-white/10 shadow-lg">
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
                    <div className="w-full aspect-video rounded-xl overflow-hidden bg-black flex items-center justify-center border border-white/10 shadow-lg">
                      <video
                        src={rawVideo}
                        controls
                        autoPlay
                        playsInline
                        className="w-full h-full object-contain bg-black"
                      >
                        {isEn ? 'Your browser does not support HTML5 video.' : 'Seu navegador não suporta vídeos HTML5.'}
                      </video>
                    </div>
                  );
                }

                return null;
              })()}
            </div>

            <div className="p-4 sm:p-5 bg-[#000025] border-t border-[#607EC9]/30 flex flex-col sm:flex-row items-center justify-between gap-3">
              <div className="text-xs text-blue-200 text-center sm:text-left">
                <span className="font-bold text-white block">{activeVideoModal.name}</span>
                <span className="text-[#9AB4FF]">{isEn ? '1st Trial Lesson: 25 min Free' : '1ª Aula Teste: 25 min Grátis'}</span>
              </div>
              <button
                type="button"
                id={`modal-start-journey-${activeVideoModal.id}`}
                onClick={() => {
                  const tutor = activeVideoModal;
                  setActiveVideoModal(null);
                  handleStartJourney(tutor);
                }}
                className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-[#F4CA54] hover:bg-amber-400 text-[#000035] font-black text-xs sm:text-sm shadow-md transition flex items-center justify-center gap-2 cursor-pointer"
              >
                <Sparkles className="w-4 h-4 text-[#000035]" />
                <span>
                  {isEn
                    ? `Start Living in English with ${activeVideoModal.name.split(' ')[0]}`
                    : `Começar com ${activeVideoModal.name.split(' ')[0]}`}
                </span>
                <ArrowRight className="w-4 h-4 text-[#000035]" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Full Professional Profile Discovery Modal */}
      {detailedProfileTutor && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-3 sm:p-4 overflow-y-auto"
          onClick={(e) => {
            if (e.target === e.currentTarget) setDetailedProfileTutor(null);
          }}
        >
          <div className="bg-[#000035] rounded-3xl max-w-2xl w-full border border-[#607EC9]/40 shadow-2xl overflow-hidden flex flex-col my-4 max-h-[92vh] animate-in fade-in zoom-in-95 duration-200">
            {/* Header */}
            <div className="p-4 sm:p-5 bg-gradient-to-r from-[#062863] via-[#000035] to-[#1C4C96] border-b border-[#607EC9]/30 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="relative shrink-0">
                  {detailedProfileTutor.avatar ? (
                    <img
                      src={detailedProfileTutor.avatar}
                      alt={detailedProfileTutor.name}
                      className="w-14 h-14 rounded-2xl object-cover border-2 border-white/20 shadow-md"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div className="w-14 h-14 rounded-2xl bg-[#062863] text-white flex items-center justify-center font-black text-lg border border-[#9AB4FF]/40">
                      {detailedProfileTutor.name.slice(0, 2).toUpperCase()}
                    </div>
                  )}
                  <span className="absolute -bottom-1 -right-1 text-sm">
                    {detailedProfileTutor.flag || '🇺🇸'}
                  </span>
                </div>

                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-black text-base sm:text-lg text-white">
                      {detailedProfileTutor.name}
                    </h3>
                    {detailedProfileTutor.isSuperTutor && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/20 text-[#F4CA54] text-[10px] font-bold border border-[#F4CA54]/40">
                        <Sparkles className="w-3 h-3" />
                        Super Native Friend
                      </span>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 text-xs text-blue-200 mt-0.5">
                    <span className="font-semibold">{detailedProfileTutor.country || 'Native Speaker'}</span>
                    <span>•</span>
                    <span className="text-[#9AB4FF]">{detailedProfileTutor.accent || 'North American'}</span>
                    {typeof detailedProfileTutor.rating === 'number' && detailedProfileTutor.reviewsCount !== undefined && detailedProfileTutor.reviewsCount > 0 ? (
                      <>
                        <span>•</span>
                        <span className="text-[#F4CA54] font-bold flex items-center gap-0.5">
                          <Star className="w-3.5 h-3.5 fill-[#F4CA54] text-[#F4CA54]" />
                          {detailedProfileTutor.rating.toFixed(1)} ({detailedProfileTutor.reviewsCount} {t.reviewsLabel})
                        </span>
                      </>
                    ) : null}
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setDetailedProfileTutor(null)}
                className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition cursor-pointer"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Scrollable Body */}
            <div className="p-5 sm:p-6 overflow-y-auto space-y-5 flex-1">
              {/* Free Trial Lesson Guarantee */}
              <div className="p-3.5 sm:p-4 rounded-2xl bg-gradient-to-r from-emerald-600/30 via-[#062863] to-emerald-600/30 border border-emerald-400/60 flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl bg-emerald-500 text-white flex items-center justify-center font-black shrink-0 shadow-sm mt-0.5">
                  <Award className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-400 text-[#000035]">
                      {isEn ? '100% Free Trial Lesson (25 min)' : '1ª Aula Teste 100% Gratuita (25 min)'}
                    </span>
                    <span className="text-xs text-emerald-300 font-bold">
                      {isEn ? 'No upfront commitment' : 'Sem compromisso inicial'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-200 mt-1 leading-relaxed">
                    {isEn
                      ? `Experience a live 25-minute experimental conversation with ${detailedProfileTutor.name} via Google Meet. Test their rhythm, teaching style, and natural English before any plan decision.`
                      : `Vivencie uma conversa experimental de 25 minutos com ${detailedProfileTutor.name} via Google Meet. Conheça a didática, o ritmo e o acolhimento do seu Amigo Nativo antes de qualquer decisão.`}
                  </p>
                </div>
              </div>

              {/* Pricing Transparency */}
              <div className="p-4 rounded-2xl bg-[#062863]/60 border border-[#607EC9]/40 space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2 border-b border-white/10 pb-2.5">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-black uppercase tracking-wider text-white">
                      {isEn ? 'Pricing & Lesson Investment' : 'Valores & Investimento'}
                    </span>
                  </div>
                  <span className="text-[11px] text-emerald-400 font-bold bg-emerald-500/20 px-2 py-0.5 rounded-full">
                    {isEn ? '1st Lesson: Free ($0 USD / 25 min)' : '1ª Aula: Grátis ($0 USD / 25 min)'}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="p-3 rounded-xl bg-[#000035]/80 border border-white/10">
                    <span className="text-[10px] text-slate-400 uppercase font-bold block">
                      {isEn ? 'Standard Session (50 min)' : 'Aula Padrão (50 min)'}
                    </span>
                    <div className="flex items-baseline gap-1 mt-1">
                      <span className="text-xl font-black text-white">
                        ${detailedProfileTutor.pricePerSessionUsd ?? 15} USD
                      </span>
                      <span className="text-xs text-blue-200 font-semibold">
                        / 50 min
                      </span>
                    </div>
                    <p className="text-[10px] text-slate-300 mt-1">
                      {isEn ? 'Individual Google Meet conversation session' : 'Sessão individual via Google Meet'}
                    </p>
                  </div>

                  <div className="p-3 rounded-xl bg-[#000035]/80 border border-[#F4CA54]/30">
                    <span className="text-[10px] text-[#F4CA54] uppercase font-bold block">
                      {isEn ? 'Post-Trial Options' : 'Opções Pós-Teste'}
                    </span>
                    <div className="flex items-baseline gap-1 mt-1">
                      <span className="text-base font-black text-white">
                        {isEn ? 'Flexible Packages' : 'Planos Flexíveis'}
                      </span>
                    </div>
                    <p className="text-[10px] text-slate-300 mt-1">
                      {isEn ? 'Available after your free trial session' : 'Disponíveis após a conclusão da aula teste'}
                    </p>
                  </div>
                </div>
              </div>

              {/* Bio Section */}
              <div className="space-y-2">
                <h4 className="text-xs font-black uppercase tracking-wider text-[#9AB4FF]">
                  {isEn ? 'About the Native Friend' : 'Sobre o Amigo Nativo'}
                </h4>
                {detailedProfileTutor.headline && (
                  <p className="text-sm font-bold text-white">
                    "{detailedProfileTutor.headline}"
                  </p>
                )}
                <p className="text-xs sm:text-[13px] text-slate-200 leading-relaxed whitespace-pre-line">
                  {detailedProfileTutor.bio || (isEn
                    ? 'Experienced conversational native friend helping students speak naturally in everyday situations.'
                    : 'Amigo Nativo experiente ajudando estudantes a falarem inglês naturalmente em situações reais.')}
                </p>
              </div>

              {/* Presentation Video (if available) */}
              {(() => {
                const rawVideo = (
                  detailedProfileTutor.videoIntroUrl ||
                  detailedProfileTutor.youtubeUrl ||
                  detailedProfileTutor.videoUrl ||
                  detailedProfileTutor.introVideoUrl ||
                  detailedProfileTutor.youtubeEmbedId ||
                  ''
                ).trim();

                const embedId = extractYouTubeVideoId(rawVideo);
                if (!embedId && !rawVideo) return null;

                return (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-xs font-bold text-[#9AB4FF]">
                      <Video className="w-4 h-4 text-[#F4CA54]" />
                      <span>{isEn ? 'Presentation Video' : 'Vídeo de Apresentação'}</span>
                    </div>
                    {embedId ? (
                      <div className="w-full aspect-video rounded-xl overflow-hidden bg-black border border-white/10 shadow-lg">
                        <iframe
                          src={`https://www.youtube.com/embed/${embedId}`}
                          title={`Video by ${detailedProfileTutor.name}`}
                          className="w-full h-full border-0"
                          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                          allowFullScreen
                        />
                      </div>
                    ) : (
                      <div className="w-full aspect-video rounded-xl overflow-hidden bg-black border border-white/10 shadow-lg flex items-center justify-center">
                        <video
                          src={rawVideo}
                          controls
                          playsInline
                          preload="metadata"
                          className="w-full h-full object-contain bg-black"
                        />
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Specialties & Languages */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {detailedProfileTutor.specialties && detailedProfileTutor.specialties.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-xs font-black uppercase tracking-wider text-[#9AB4FF]">
                      {isEn ? 'Specialties' : 'Especialidades'}
                    </h4>
                    <div className="flex flex-wrap gap-1.5">
                      {detailedProfileTutor.specialties.map((sp, idx) => (
                        <span
                          key={idx}
                          className="px-2.5 py-1 rounded-lg bg-[#1C4C96]/60 text-white text-[11px] font-medium border border-[#607EC9]/40"
                        >
                          {sp}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {detailedProfileTutor.languagesSpoken && detailedProfileTutor.languagesSpoken.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-xs font-black uppercase tracking-wider text-[#9AB4FF]">
                      {isEn ? 'Languages Spoken' : 'Idiomas'}
                    </h4>
                    <div className="flex flex-wrap gap-1.5">
                      {detailedProfileTutor.languagesSpoken.map((lang, idx) => (
                        <span
                          key={idx}
                          className="px-2.5 py-1 rounded-lg bg-[#000035] text-[#9AB4FF] text-[11px] font-medium border border-[#607EC9]/30"
                        >
                          {lang}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Bottom Actions */}
            <div className="p-4 sm:p-5 bg-[#000025] border-t border-[#607EC9]/30 flex flex-col sm:flex-row items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => setDetailedProfileTutor(null)}
                className="w-full sm:w-auto px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-slate-200 font-bold text-xs transition cursor-pointer"
              >
                {isEn ? '← Back to Directory' : '← Voltar à Vitrine'}
              </button>

              <button
                type="button"
                id={`modal-profile-start-journey-${detailedProfileTutor.id}`}
                onClick={() => {
                  const tutor = detailedProfileTutor;
                  setDetailedProfileTutor(null);
                  handleStartJourney(tutor);
                }}
                className="w-full sm:w-auto px-6 py-2.5 rounded-xl bg-[#F4CA54] hover:bg-amber-400 text-[#000035] font-black text-xs sm:text-sm shadow-md transition flex items-center justify-center gap-2 cursor-pointer"
              >
                <Sparkles className="w-4 h-4 text-[#000035]" />
                <span>
                  {isEn
                    ? `Start Living in English with ${detailedProfileTutor.name}`
                    : `Começar com ${detailedProfileTutor.name}`}
                </span>
                <ArrowRight className="w-4 h-4 text-[#000035]" />
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};


