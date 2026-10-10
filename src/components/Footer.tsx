import React from 'react';
import { BrandLogo } from './BrandLogo';
import { GoogleAccount, Language } from '../types';
import { Translations } from '../utils/i18n';

export interface FooterProps {
  currentAccount?: GoogleAccount | null;
  currentLanguage: Language;
  t: Translations;
  footerSlogan?: string;
  scrollToSection: (id: string) => void;
  onOpenBecomeTutorModal: () => void;
  onOpenAuthModal: (mode: 'login' | 'signup', role?: 'student' | 'teacher' | 'admin') => void;
  onOpenAdminApprovals?: () => void;
  onGoToDashboard?: () => void;
  onOpenAdminAuth?: () => void;
}

export const Footer: React.FC<FooterProps> = ({
  currentAccount,
  currentLanguage,
  t,
  footerSlogan,
  scrollToSection,
  onOpenBecomeTutorModal,
  onOpenAuthModal,
  onOpenAdminApprovals,
  onGoToDashboard,
  onOpenAdminAuth,
}) => {
  const handleAdminEasterEgg = (e: React.MouseEvent) => {
    e.preventDefault();

    if (onOpenAdminAuth) {
      onOpenAdminAuth();
      return;
    }

    if (currentAccount?.role === 'admin') {
      if (onOpenAdminApprovals) {
        onOpenAdminApprovals();
        return;
      }
      if (onGoToDashboard) {
        onGoToDashboard();
        return;
      }
    }

    // Open Administrator Authentication Modal directly
    onOpenAuthModal('login', 'admin');

    // Update browser URL state seamlessly to /admin if supported
    try {
      if (typeof window !== 'undefined' && window.history && window.history.pushState) {
        window.history.pushState({ page: 'admin' }, '', '/admin');
      }
    } catch {
      // Ignored in sandboxed environments
    }
  };

  const defaultSlogan =
    currentLanguage === 'pt'
      ? 'Aprenda inglês vivendo sua vida real. Prática diária, hábitos e amigos nativos.'
      : 'Learn English by living your real life. Daily practice, habits, and native friends.';

  return (
    <footer className="bg-[#000035] border-t border-[#1C4C96]/40 py-12 text-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col md:flex-row items-center justify-between gap-8">
          <div className="flex flex-col items-center md:items-start gap-2">
            <BrandLogo size="md" showText={true} textColor="text-white" />
            <p className="text-xs text-[#9AB4FF]/80 max-w-sm text-center md:text-left">
              {footerSlogan || defaultSlogan}
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-6 text-xs font-bold text-[#9AB4FF]">
            <button
              type="button"
              onClick={() => scrollToSection('find-native-friend')}
              className="hover:text-white cursor-pointer transition"
            >
              {t.findTutors}
            </button>
            <button
              type="button"
              onClick={onOpenBecomeTutorModal}
              className="hover:text-white cursor-pointer transition"
            >
              {t.becomeTutor}
            </button>
            <button
              type="button"
              onClick={() => onOpenAuthModal('login')}
              className="hover:text-white cursor-pointer transition"
            >
              {t.studentAccess}
            </button>
            <a
              href="/privacy.html"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-white cursor-pointer transition"
            >
              {currentLanguage === 'pt' ? 'Política de Privacidade' : 'Privacy Policy'}
            </a>
            <a
              href="/terms.html"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-white cursor-pointer transition"
            >
              {currentLanguage === 'pt' ? 'Termos de Serviço' : 'Terms of Service'}
            </a>
          </div>
        </div>

        <div className="mt-8 pt-6 border-t border-[#1C4C96]/30 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-[#9AB4FF]/60">
          <span>
            {/* Discrete Easter Egg: Clicking © triggers the Admin Authentication Modal / Panel */}
            <button
              type="button"
              onClick={handleAdminEasterEgg}
              className="cursor-pointer hover:opacity-80 transition-opacity inline-flex items-center text-inherit bg-transparent border-0 p-0 font-inherit select-none"
              aria-label="Admin Access"
              id="admin-easter-egg-trigger"
            >
              ©
            </button>{' '}
            2026 It's Simple. All rights reserved.
          </span>
          <span>English Learning by Living your Life • Powered by Gemini AI</span>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
