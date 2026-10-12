import React, { useState, useRef, useEffect } from 'react';
import {
  Sparkles,
  ArrowRight,
  Globe,
  CheckCircle2,
  Heart,
  Users,
  UserPlus,
  ChevronDown,
  Check,
  LogIn,
  LogOut,
  HelpCircle,
  User,
  GraduationCap,
  X,
  BookOpen,
  Calendar,
  MessageSquare,
  ShieldCheck,
} from 'lucide-react';
import { GoogleAccount, Language, UserRole, AdminLandingContent } from '../types';
import { BrandLogo } from './BrandLogo';
import { Header } from './Header';
import { Footer } from './Footer';
import { FindTutorsSection } from './FindTutorsSection';
import { SFluencyTracker } from './SFluencyTracker';
import { HowItWorksModal } from './HowItWorksModal';
import { getHowItWorksContent } from '../data/howItWorksContent';
import { NativeFriendTutor } from '../data/tutors';
import { SUPPORTED_LANGUAGES, getTranslations } from '../utils/i18n';

interface LandingPageProps {
  currentLanguage: Language;
  onToggleLanguage: (lang: Language) => void;
  currentAccount: GoogleAccount | null;
  onOpenAuthModal: (mode: 'login' | 'signup', role?: UserRole) => void;
  onOpenBecomeTutorModal: () => void;
  onGoToDashboard: () => void;
  onBookLessonWithTutor: (tutor: NativeFriendTutor) => void;
  onSendMessageToTutor: (tutor: NativeFriendTutor) => void;
  landingContent?: AdminLandingContent;
  tutors?: NativeFriendTutor[];
  onOpenAdminLandingEditor?: () => void;
  onOpenAdminApprovals?: () => void;
  pendingApprovalsCount?: number;
  onLogout?: () => void;
  onStartLivingInEnglish?: () => void;
}

export const LandingPage: React.FC<LandingPageProps> = ({
  currentLanguage,
  onToggleLanguage,
  currentAccount,
  onOpenAuthModal,
  onOpenBecomeTutorModal,
  onGoToDashboard,
  onBookLessonWithTutor,
  onSendMessageToTutor,
  landingContent,
  tutors,
  onOpenAdminLandingEditor,
  onOpenAdminApprovals,
  pendingApprovalsCount = 0,
  onLogout,
  onStartLivingInEnglish,
}) => {
  const isEn = currentLanguage === 'en';
  const isPt = currentLanguage === 'pt';
  const t = getTranslations(currentLanguage);
  const howItWorksContent = getHowItWorksContent(currentLanguage);
  const [isHowItWorksOpen, setIsHowItWorksOpen] = useState(false);

  const isAdmin = currentAccount?.role === 'admin';

  const scrollToSection = (sectionId: string) => {
    const el = document.getElementById(sectionId);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' });
    }
  };

  // Dynamic texts: When in Portuguese, allow Admin customized content, else use localized translations
  const heroBadge = (isPt && landingContent?.heroBadge) || t.heroBadge;
  const heroHeadlineStart = (isPt && landingContent?.heroHeadlineStart) || t.heroHeadlineStart;
  const heroHeadlineHighlight = (isPt && landingContent?.heroHeadlineHighlight) || t.heroHeadlineHighlight;
  const heroQuote = (isPt && landingContent?.heroQuote) || t.heroQuote;
  const heroSubtext = (isPt && landingContent?.heroSubtext) || t.heroSubtext;
  const heroFindFriendBtn = (isPt && landingContent?.heroFindFriendBtn) || t.heroFindFriendBtn;
  const heroStartLivingBtn = (isPt && landingContent?.heroStartLivingBtn) || t.heroStartLivingBtn;
  const philosophyBadge = (isPt && landingContent?.philosophyBadge) || t.philosophyBadge;
  const philosophyHeading1 = (isPt && landingContent?.philosophyHeading1) || t.philosophyHeading1;
  const philosophyHeading2 = (isPt && landingContent?.philosophyHeading2) || t.philosophyHeading2;
  const philosophySubheading = (isPt && landingContent?.philosophySubheading) || t.philosophySubheading;
  const philosophyPillar1Title = (isPt && landingContent?.philosophyPillar1Title) || t.philosophyPillar1Title;
  const philosophyPillar1Desc = (isPt && landingContent?.philosophyPillar1Desc) || t.philosophyPillar1Desc;
  const philosophyPillar1Tag = (isPt && landingContent?.philosophyPillar1Tag) || t.philosophyPillar1Tag;
  const philosophyPillar2Title = (isPt && landingContent?.philosophyPillar2Title) || t.philosophyPillar2Title;
  const philosophyPillar2Desc = (isPt && landingContent?.philosophyPillar2Desc) || t.philosophyPillar2Desc;
  const philosophyPillar2Tag = (isPt && landingContent?.philosophyPillar2Tag) || t.philosophyPillar2Tag;
  const philosophyPillar3Title = (isPt && landingContent?.philosophyPillar3Title) || t.philosophyPillar3Title;
  const philosophyPillar3Desc = (isPt && landingContent?.philosophyPillar3Desc) || t.philosophyPillar3Desc;
  const philosophyPillar3Tag = (isPt && landingContent?.philosophyPillar3Tag) || t.philosophyPillar3Tag;
  const footerSlogan = (isPt && landingContent?.footerSlogan) || t.footerSub;

  return (
    <div className="min-h-screen bg-[#000035] text-white flex flex-col selection:bg-[#9AB4FF]/30 selection:text-white">
      {/* 0. Dedicated Admin Controls Bar (Only Visible for Administrator) */}
      {isAdmin && (
        <div className="bg-[#1C4C96] text-white px-4 py-2 text-xs font-bold flex flex-wrap items-center justify-between gap-3 border-b border-[#9AB4FF]/40 z-50">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-[#F4CA54] animate-pulse" />
            <span>PAINEL ADMINISTRADOR: {currentAccount?.name} ({currentAccount?.email})</span>
          </div>

          <div className="flex items-center gap-2">
            {onOpenAdminLandingEditor && (
              <button
                type="button"
                onClick={onOpenAdminLandingEditor}
                className="px-3 py-1 rounded-lg bg-white text-[#000035] hover:bg-[#F4CA54] transition cursor-pointer font-black shadow-xs flex items-center gap-1.5"
              >
                ✏️ {isEn ? 'Edit Landing Page Texts' : 'Editar Textos da Home'}
              </button>
            )}

            {onOpenAdminApprovals && (
              <button
                type="button"
                onClick={onOpenAdminApprovals}
                className="px-3 py-1 rounded-lg bg-[#000035] text-[#9AB4FF] hover:text-white hover:bg-[#062863] border border-[#9AB4FF]/40 transition cursor-pointer font-bold shadow-xs flex items-center gap-1.5"
              >
                👥 {isEn ? 'Approve Native Friends' : 'Aprovações de Amigos Nativos'}
                {pendingApprovalsCount > 0 && (
                  <span className="w-5 h-5 rounded-full bg-[#F4CA54] text-[#000035] text-[10px] flex items-center justify-center font-black">
                    {pendingApprovalsCount}
                  </span>
                )}
              </button>
            )}

            {onLogout && (
              <button
                type="button"
                onClick={onLogout}
                className="px-3 py-1 rounded-lg bg-rose-600 hover:bg-rose-700 text-white transition cursor-pointer font-bold shadow-xs flex items-center gap-1.5"
                title={isEn ? 'Log out' : 'Sair da conta de Administrador'}
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>{isEn ? 'Log Out' : 'Sair'}</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* 1. Top Header (Cleaned: no help circle, no conspicuous Admin button) */}
      <Header
        currentAccount={currentAccount}
        currentLanguage={currentLanguage}
        t={t}
        onToggleLanguage={onToggleLanguage}
        onOpenAuthModal={onOpenAuthModal}
        onOpenBecomeTutorModal={onOpenBecomeTutorModal}
        onGoToDashboard={onGoToDashboard}
        onLogout={onLogout}
        scrollToSection={scrollToSection}
      />

      {/* 2. Hero Section */}
      <section className="relative overflow-hidden pt-5 pb-8 sm:pt-6 sm:pb-10 bg-gradient-to-b from-[#000035] via-[#062863] to-[#000035]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 items-center">
            {/* Left Content */}
            <div className="lg:col-span-7 space-y-3.5 text-left">
              {/* Badge */}
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#1C4C96]/60 border border-[#9AB4FF]/50 text-[#9AB4FF] text-[11px] font-extrabold shadow-sm">
                <Sparkles className="w-3 h-3 text-[#F4CA54]" />
                <span>{heroBadge}</span>
              </div>

              {/* Main Headline (Scaled to 80%) */}
              <h1 className="text-2xl sm:text-3xl lg:text-4xl font-black text-white tracking-tight leading-[1.15]">
                {heroHeadlineStart}{' '}
                <span className="underline decoration-[#F4CA54] decoration-3 underline-offset-4 text-white">
                  Living
                </span>{' '}
                <span className="underline decoration-[#9AB4FF] decoration-3 underline-offset-4 text-white">
                  your Life.
                </span>
              </h1>

              {/* Sub-slogans & Philosophy Manifesto */}
              <div className="space-y-1 text-xs sm:text-[13px] text-blue-100 font-medium leading-relaxed max-w-2xl mb-[3cm]">
                <p className="font-extrabold text-[#9AB4FF]">
                  {heroQuote}
                </p>
                <p className="text-slate-200">
                  {heroSubtext}
                </p>
              </div>

              {/* Minimalist & Discreet "How It Works" Trigger Pill */}
              <div className="pt-0.5 pb-1 flex items-center">
                <button
                  type="button"
                  onClick={() => setIsHowItWorksOpen(true)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-[#062863]/60 hover:bg-[#1C4C96]/80 border border-[#9AB4FF]/40 hover:border-[#F4CA54]/80 text-[#9AB4FF] hover:text-white text-xs font-bold tracking-wide backdrop-blur-md transition-all duration-200 shadow-xs hover:shadow-[0_0_15px_rgba(154,180,255,0.25)] cursor-pointer group active:scale-98"
                  title={howItWorksContent.title}
                >
                  <span className="text-xs transition-transform duration-200 group-hover:scale-110">✨</span>
                  <span>{howItWorksContent.buttonText}</span>
                  <span className="text-[10px] text-[#9AB4FF]/70 group-hover:text-white transition-colors ml-0.5">→</span>
                </button>
              </div>

              {/* Call to Actions */}
              <div className="pt-1 flex flex-wrap items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => scrollToSection('find-native-friend')}
                  className="px-5 py-2 rounded-xl bg-[#607EC9] hover:bg-[#1C4C96] text-white font-black text-xs shadow-lg transition flex items-center gap-1.5 cursor-pointer border border-[#9AB4FF]/60 transform hover:scale-102"
                >
                  <Users className="w-3.5 h-3.5 text-white" />
                  <span>{heroFindFriendBtn}</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    if (onStartLivingInEnglish) {
                      onStartLivingInEnglish();
                    } else if (currentAccount) {
                      onGoToDashboard();
                    } else {
                      onOpenAuthModal('signup');
                    }
                  }}
                  className="px-4 py-2 rounded-xl bg-[#000035]/80 hover:bg-[#062863] text-white border border-[#607EC9] font-extrabold text-xs shadow-sm transition flex items-center gap-1.5 cursor-pointer"
                >
                  <span>{heroStartLivingBtn}</span>
                  <ArrowRight className="w-3.5 h-3.5 text-[#9AB4FF]" />
                </button>
              </div>

              {/* Trust & Key Features Badges */}
              <div className="pt-1.5 grid grid-cols-2 sm:grid-cols-3 gap-2 text-[10px] sm:text-[11px] font-bold text-[#9AB4FF]">
                <div className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                  <span>{t.badge100Native}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                  <span>{t.badge30MinMeet}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                  <span>{t.badgeAiCorrection}</span>
                </div>
              </div>
            </div>

            {/* Right Visual Card: S Fun Path to Fluency (Showcase Demo Only) */}
            <div className="lg:col-span-5 relative">
              <SFluencyTracker
                mode="demo"
                currentLanguage={currentLanguage}
                onExploreRoutines={onStartLivingInEnglish || onGoToDashboard}
              />
            </div>
          </div>
        </div>
      </section>

      {/* 3. The Philosophy Section */}
      <section className="py-12 sm:py-16 bg-[#000035] border-t border-[#1C4C96]/50" id="philosophy">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto space-y-3">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#1C4C96]/60 border border-[#9AB4FF]/50 text-[#9AB4FF] text-[11px] font-bold">
              <Heart className="w-3.5 h-3.5 text-rose-400 fill-rose-400" />
              <span>{philosophyBadge}</span>
            </div>

            <h2 className="text-2xl sm:text-3xl lg:text-4xl font-black text-white tracking-tight">
              {philosophyHeading1}{' '}
              <span className="text-[#9AB4FF] block sm:inline">
                {philosophyHeading2}
              </span>
            </h2>

            <p className="text-xs sm:text-sm text-blue-100 font-normal leading-relaxed">
              {philosophySubheading}
            </p>
          </div>

          {/* 3 Pillars Cards (Scaled to 80%) */}
          <div className="mt-10 grid grid-cols-1 md:grid-cols-3 gap-5">
            {/* Pillar 1 */}
            <div className="bg-gradient-to-br from-[#062863]/90 via-[#000035] to-[#1C4C96]/60 rounded-2xl p-5 border border-[#607EC9]/50 shadow-xl space-y-3 hover:border-[#9AB4FF] transition flex flex-col justify-between">
              <div className="space-y-2.5">
                <div className="w-9 h-9 rounded-xl bg-[#1C4C96] text-[#9AB4FF] border border-[#9AB4FF]/40 flex items-center justify-center font-black text-sm shadow-xs">
                  1
                </div>
                <h3 className="text-base font-extrabold text-white">
                  {philosophyPillar1Title}
                </h3>
                <p className="text-xs text-blue-100/90 leading-relaxed">
                  {philosophyPillar1Desc}
                </p>
              </div>
              <div className="p-2.5 bg-[#000035]/80 rounded-lg border border-[#607EC9]/40 text-[11px] font-bold text-[#9AB4FF]">
                {philosophyPillar1Tag}
              </div>
            </div>

            {/* Pillar 2 */}
            <div className="bg-gradient-to-br from-[#062863]/90 via-[#000035] to-[#1C4C96]/60 rounded-2xl p-5 border border-[#607EC9]/50 shadow-xl space-y-3 hover:border-[#9AB4FF] transition flex flex-col justify-between">
              <div className="space-y-2.5">
                <div className="w-9 h-9 rounded-xl bg-[#1C4C96] text-[#9AB4FF] border border-[#9AB4FF]/40 flex items-center justify-center font-black text-sm shadow-xs">
                  2
                </div>
                <h3 className="text-base font-extrabold text-white">
                  {philosophyPillar2Title}
                </h3>
                <p className="text-xs text-blue-100/90 leading-relaxed">
                  {philosophyPillar2Desc}
                </p>
              </div>
              <div className="p-2.5 bg-[#000035]/80 rounded-lg border border-[#607EC9]/40 text-[11px] font-bold text-emerald-400">
                {philosophyPillar2Tag}
              </div>
            </div>

            {/* Pillar 3 */}
            <div className="bg-gradient-to-br from-[#062863]/90 via-[#000035] to-[#1C4C96]/60 rounded-2xl p-5 border border-[#607EC9]/50 shadow-xl space-y-3 hover:border-[#9AB4FF] transition flex flex-col justify-between">
              <div className="space-y-2.5">
                <div className="w-9 h-9 rounded-xl bg-[#1C4C96] text-[#9AB4FF] border border-[#9AB4FF]/40 flex items-center justify-center font-black text-sm shadow-xs">
                  3
                </div>
                <h3 className="text-base font-extrabold text-white">
                  {philosophyPillar3Title}
                </h3>
                <p className="text-xs text-blue-100/90 leading-relaxed">
                  {philosophyPillar3Desc}
                </p>
              </div>
              <div className="p-2.5 bg-[#000035]/80 rounded-lg border border-[#607EC9]/40 text-[11px] font-bold text-[#F4CA54]">
                {philosophyPillar3Tag}
              </div>
            </div>
          </div>

          {/* Bottom Transition Banner to Next Section */}
          <div className="mt-10 text-center">
            <div className="inline-block bg-[#000035] px-6 py-2.5 rounded-xl border border-[#607EC9]/60 shadow-lg">
              <h3 className="text-lg sm:text-xl font-black text-white tracking-tight">
                {isPt ? 'Sua jornada, passo a passo!' : 'Your journey, step by step!'}
              </h3>
            </div>
          </div>
        </div>
      </section>

      {/* 4. Find your Native Friend Section */}
      <FindTutorsSection
        currentLanguage={currentLanguage}
        tutors={tutors}
        onBookLesson={onBookLessonWithTutor}
        onSendMessage={onSendMessageToTutor}
        onSelectMentor={(tutor) => {
          if (onBookLessonWithTutor) onBookLessonWithTutor(tutor);
        }}
      />

      {/* 6. Become a Native Friend Callout Banner */}
      <section className="py-12 bg-[#000035] text-white border-t border-[#1C4C96]/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="bg-gradient-to-r from-[#062863] via-[#000035] to-[#1C4C96] rounded-2xl p-6 sm:p-9 border border-[#607EC9]/50 shadow-2xl flex flex-col lg:flex-row items-center justify-between gap-6">
            <div className="space-y-3 max-w-2xl text-left">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#1C4C96]/80 text-[#9AB4FF] text-[11px] font-bold border border-[#9AB4FF]/40">
                <Globe className="w-3 h-3 text-[#9AB4FF]" />
                <span>{t.forNativeSpeakersBadge}</span>
              </span>
              <h2 className="text-2xl sm:text-3xl font-black tracking-tight text-white">
                {t.becomeTutorBannerTitle}
              </h2>
              <p className="text-xs sm:text-[13px] text-blue-100 leading-relaxed font-normal">
                {t.becomeTutorBannerDesc}
              </p>
            </div>

            <button
              type="button"
              onClick={onOpenBecomeTutorModal}
              className="px-6 py-2.5 rounded-xl bg-[#607EC9] hover:bg-[#1C4C96] text-white font-black text-xs sm:text-sm shadow-xl transition cursor-pointer shrink-0 border border-[#9AB4FF]/60"
            >
              {t.applyAsTutorBtn}
            </button>
          </div>
        </div>
      </section>

      {/* 7. Footer with Discreet Easter Egg on © */}
      <Footer
        currentAccount={currentAccount}
        currentLanguage={currentLanguage}
        t={t}
        footerSlogan={footerSlogan}
        scrollToSection={scrollToSection}
        onOpenBecomeTutorModal={onOpenBecomeTutorModal}
        onOpenAuthModal={onOpenAuthModal}
        onOpenAdminApprovals={onOpenAdminApprovals}
        onGoToDashboard={onGoToDashboard}
      />

      {/* Interactive Presentation Modal: How It Works */}
      <HowItWorksModal
        isOpen={isHowItWorksOpen}
        onClose={() => setIsHowItWorksOpen(false)}
        onGetStarted={() => {
          if (onStartLivingInEnglish) {
            onStartLivingInEnglish();
          } else if (currentAccount) {
            onGoToDashboard();
          } else {
            onOpenAuthModal('signup');
          }
        }}
        currentLanguage={currentLanguage}
      />
    </div>
  );
};

