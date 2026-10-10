import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Globe, LogIn, LogOut, Check } from 'lucide-react';
import { GoogleAccount, Language } from '../types';
import { Translations, SUPPORTED_LANGUAGES } from '../utils/i18n';
import { BrandLogo } from './BrandLogo';
import { Navbar, NavbarProps } from './Navbar';

export interface HeaderProps {
  currentAccount: GoogleAccount | null;
  currentLanguage: Language;
  t: Translations;
  onToggleLanguage: (lang: Language) => void;
  onOpenAuthModal: (mode: 'login' | 'signup', role?: 'student' | 'teacher' | 'admin') => void;
  onOpenBecomeTutorModal: () => void;
  onGoToDashboard: () => void;
  onLogout?: () => void;
  scrollToSection: (id: string) => void;
}

/**
 * Clean Top Navigation Header for It's Simple.
 * Cleaned up: The help circle (?) and conspicuous Admin button have been removed.
 * Admin access has been moved to a discreet Easter egg trigger in the Footer (on the © symbol).
 */
export const Header: React.FC<HeaderProps> = ({
  currentAccount,
  currentLanguage,
  t,
  onToggleLanguage,
  onOpenAuthModal,
  onOpenBecomeTutorModal,
  onGoToDashboard,
  onLogout,
  scrollToSection,
}) => {
  const isEn = currentLanguage === 'en';
  const [isLangDropdownOpen, setIsLangDropdownOpen] = useState<boolean>(false);
  const langDropdownRef = useRef<HTMLDivElement>(null);

  const currentLangObj =
    SUPPORTED_LANGUAGES.find((l) => l.code === currentLanguage) || SUPPORTED_LANGUAGES[0];

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (langDropdownRef.current && !langDropdownRef.current.contains(event.target as Node)) {
        setIsLangDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <header className="sticky top-0 z-40 bg-[#000035]/95 backdrop-blur-md border-b border-[#1C4C96]/60 shadow-lg">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-14 sm:h-16">
          {/* Logo */}
          <div className="flex items-center gap-3">
            <BrandLogo size="sm" showText={true} textColor="text-white" />
          </div>

          {/* Center Nav Links (Desktop) */}
          <nav className="hidden md:flex items-center gap-6 text-xs sm:text-sm font-bold text-[#9AB4FF]">
            <button
              type="button"
              onClick={() => scrollToSection('find-native-friend')}
              className="hover:text-white transition cursor-pointer flex items-center gap-1.5"
            >
              <span>{t.findTutors}</span>
            </button>
            <button
              type="button"
              onClick={() => scrollToSection('philosophy')}
              className="hover:text-white transition cursor-pointer"
            >
              {currentLanguage === 'pt' ? 'Nossa Filosofia' : 'Philosophy'}
            </button>
            <button
              type="button"
              onClick={onOpenBecomeTutorModal}
              className="text-[#F4CA54] hover:text-white transition cursor-pointer font-extrabold"
            >
              {t.becomeTutor}
            </button>
          </nav>

          {/* Right Controls: 12-Language Selector & Single Unified Log In / Dashboard */}
          <div className="flex items-center gap-2 sm:gap-3">
            {/* 12-Language Switcher */}
            <div className="relative" ref={langDropdownRef}>
              <button
                type="button"
                onClick={() => setIsLangDropdownOpen(!isLangDropdownOpen)}
                className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 bg-[#062863] hover:bg-[#1C4C96] border border-[#607EC9]/50 rounded-xl text-xs font-bold text-white transition shadow-xs cursor-pointer"
                title={t.language}
              >
                <span className="text-base leading-none">{currentLangObj.flag}</span>
                <span className="hidden sm:inline font-black uppercase text-[11px] text-[#9AB4FF]">
                  {currentLangObj.code}
                </span>
                <ChevronDown
                  className={`w-3.5 h-3.5 text-[#9AB4FF] transition-transform duration-200 ${
                    isLangDropdownOpen ? 'rotate-180' : ''
                  }`}
                />
              </button>

              {isLangDropdownOpen && (
                <div className="absolute right-0 mt-2 w-64 bg-[#000035] rounded-2xl shadow-2xl border border-[#607EC9] p-2 z-50 animate-in fade-in zoom-in-95 duration-150 max-h-96 overflow-y-auto">
                  <div className="px-2.5 py-1.5 border-b border-[#1C4C96] text-[10px] font-bold text-[#9AB4FF] uppercase tracking-wider flex items-center justify-between">
                    <span>{t.language} (12)</span>
                    <Globe className="w-3 h-3 text-[#9AB4FF]" />
                  </div>
                  <div className="grid grid-cols-1 gap-1 pt-1.5">
                    {SUPPORTED_LANGUAGES.map((lang) => {
                      const isSelected = lang.code === currentLanguage;
                      return (
                        <button
                          key={lang.code}
                          type="button"
                          onClick={() => {
                            onToggleLanguage(lang.code);
                            setIsLangDropdownOpen(false);
                          }}
                          className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition cursor-pointer ${
                            isSelected
                              ? 'bg-[#1C4C96] text-white font-bold shadow-xs border border-[#9AB4FF]/50'
                              : 'text-slate-200 hover:bg-[#062863] hover:text-white'
                          }`}
                        >
                          <div className="flex items-center gap-2.5">
                            <span className="text-lg">{lang.flag}</span>
                            <div className="text-left">
                              <span className="block text-xs font-bold">{lang.nativeName}</span>
                              <span
                                className={`text-[10px] ${
                                  isSelected ? 'text-[#F4CA54]' : 'text-[#9AB4FF]/70'
                                }`}
                              >
                                {lang.name} • {lang.region}
                              </span>
                            </div>
                          </div>
                          {isSelected && <Check className="w-3.5 h-3.5 text-[#F4CA54]" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Note: Help circle (?) and conspicuous Admin button have been removed for clean minimalism */}

            {/* Preply-style Single Unified Log In / Dashboard Button */}
            <button
              type="button"
              onClick={() => {
                if (currentAccount) {
                  onGoToDashboard();
                } else {
                  onOpenAuthModal('login');
                }
              }}
              className="flex items-center gap-2 px-4 sm:px-5 py-2 sm:py-2.5 rounded-xl bg-white hover:bg-slate-100 text-[#000035] font-black text-xs sm:text-sm shadow-md transition cursor-pointer border-2 border-white active:scale-98"
              title={
                currentAccount
                  ? currentAccount.role === 'admin'
                    ? isEn
                      ? 'Administrator Dashboard'
                      : 'Painel do Administrador'
                    : currentAccount.role === 'teacher'
                    ? isEn
                      ? 'Native Friend Dashboard'
                      : 'Painel do Amigo Nativo'
                    : isEn
                    ? 'My Dashboard'
                    : 'Meu Painel'
                  : isEn
                  ? 'Log in to your account'
                  : 'Acessar sua conta'
              }
            >
              <LogIn className="w-4 h-4 text-[#000035] stroke-[2.5]" />
              <span>
                {currentAccount
                  ? currentAccount.role === 'admin'
                    ? isEn
                      ? 'Admin Dashboard'
                      : 'Painel Admin'
                    : currentAccount.role === 'teacher'
                    ? isEn
                      ? 'Teacher Dashboard'
                      : 'Painel Amigo Nativo'
                    : isEn
                    ? 'My Dashboard'
                    : 'Meu Painel'
                  : isEn
                  ? 'Log In'
                  : 'Entrar'}
              </span>
            </button>

            {/* Botão Sair da Conta (Quando o usuário já está logado) */}
            {currentAccount && onLogout && (
              <button
                type="button"
                onClick={onLogout}
                className="flex items-center gap-1.5 px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 border border-rose-400/50 text-rose-300 hover:text-white font-bold text-xs sm:text-sm transition cursor-pointer shadow-xs active:scale-98"
                title={isEn ? 'Log out of current account' : 'Sair da conta atual'}
              >
                <LogOut className="w-4 h-4 text-rose-400" />
                <span>{isEn ? 'Log Out' : 'Sair'}</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};

export { Navbar, type NavbarProps };
export default Header;
