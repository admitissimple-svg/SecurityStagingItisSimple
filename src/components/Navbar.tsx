import React, { useState, useEffect, useRef } from 'react';
import {
  ChevronDown,
  Globe,
  User,
  GraduationCap,
  ShieldCheck,
  Search,
  LogOut,
  Check,
  Edit3,
  Users,
  MessageSquare,
} from 'lucide-react';
import { GoogleAccount, UserProfile, Language, NativeFriendTutor, LiveLesson } from '../types';
import { Translations, SUPPORTED_LANGUAGES, getTranslations } from '../utils/i18n';
import { BrandLogo } from './BrandLogo';
import { getShortTzBadge } from '../utils/timezone';
import { HeaderMessagesPopover } from './HeaderMessagesPopover';

export interface NavbarProps {
  userProfile: UserProfile;
  currentAccount: GoogleAccount | null;
  currentLanguage: Language;
  t: Translations;
  onToggleLanguage: (lang: Language) => void;
  onOpenAccountModal: () => void;
  onOpenStudentProfile?: () => void;
  onOpenTeacherProfile?: () => void;
  onOpenAdminApprovals?: () => void;
  onOpenAdminLandingEditor?: () => void;
  pendingTutorsCount?: number;
  timeZone?: string;
  onGoToLanding?: () => void;
  onFindTutors?: () => void;
  onLogout?: () => void;
  tutors?: NativeFriendTutor[];
  lessons?: LiveLesson[];
  students?: GoogleAccount[];
}

export const Navbar: React.FC<NavbarProps> = ({
  userProfile,
  currentAccount,
  currentLanguage,
  t,
  onToggleLanguage,
  onOpenAccountModal,
  onOpenStudentProfile,
  onOpenTeacherProfile,
  onOpenAdminApprovals,
  onOpenAdminLandingEditor,
  pendingTutorsCount = 0,
  timeZone,
  onGoToLanding,
  onFindTutors,
  onLogout,
  tutors = [],
  lessons = [],
  students = [],
}) => {
  const isTeacher = currentAccount?.role === 'teacher';
  const isAdmin = currentAccount?.role === 'admin';
  const isTeacherOrAdmin = isTeacher || isAdmin;
  
  // Enforce English for teacher navbar view
  const navLanguage = isTeacher ? 'en' : currentLanguage;
  const isEn = navLanguage === 'en';
  const navT = isTeacher ? getTranslations('en') : t;

  const [currentTime, setCurrentTime] = useState<string>('');
  const [currentDateStr, setCurrentDateStr] = useState<string>('');
  const [isUserMenuOpen, setIsUserMenuOpen] = useState<boolean>(false);
  const [showLanguageSubmenu, setShowLanguageSubmenu] = useState<boolean>(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  // Discrete Asynchronous Direct Messages in Header
  const [isMessagesOpen, setIsMessagesOpen] = useState<boolean>(false);
  const [unreadMessagesCount, setUnreadMessagesCount] = useState<number>(0);
  const messagesMenuRef = useRef<HTMLDivElement>(null);

  const effectiveTimeZone = timeZone || (isTeacherOrAdmin ? 'America/Toronto' : 'America/Sao_Paulo');

  const currentLangObj =
    SUPPORTED_LANGUAGES.find((l) => l.code === currentLanguage) || SUPPORTED_LANGUAGES[0];

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setIsUserMenuOpen(false);
        setShowLanguageSubmenu(false);
      }
      if (messagesMenuRef.current && !messagesMenuRef.current.contains(event.target as Node)) {
        setIsMessagesOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      const localeMap: Record<Language, string> = {
        pt: 'pt-BR',
        en: 'en-US',
        es: 'es-ES',
        fr: 'fr-FR',
        de: 'de-DE',
        it: 'it-IT',
        ja: 'ja-JP',
        ko: 'ko-KR',
        zh: 'zh-CN',
        ru: 'ru-RU',
        ar: 'ar-SA',
        tr: 'tr-TR',
      };
      const locale = localeMap[navLanguage] || 'en-US';
      try {
        setCurrentTime(
          now.toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            timeZone: effectiveTimeZone,
            hour12: true,
          })
        );
        setCurrentDateStr(
          now.toLocaleDateString(locale, {
            weekday: 'long',
            day: 'numeric',
            month: 'short',
            timeZone: effectiveTimeZone,
          })
        );
      } catch (err) {
        console.warn('Error formatting timezone time:', err);
        setCurrentTime(
          now.toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: true,
          })
        );
        setCurrentDateStr(
          now.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'short' })
        );
      }
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, [navLanguage, effectiveTimeZone]);

  const isAccountProfile = Boolean(
    currentAccount?.email &&
      userProfile?.email &&
      userProfile.email.toLowerCase().trim() === currentAccount.email.toLowerCase().trim()
  );

  const userName =
    currentAccount?.name ||
    (isAccountProfile && userProfile.name ? userProfile.name : '') ||
    (isTeacher ? 'Native Friend' : isEn ? 'Student' : 'Aluno');

  const userAvatarPic =
    (currentAccount?.picture && currentAccount.picture.trim() !== '' ? currentAccount.picture : '') ||
    (isAccountProfile && userProfile?.avatar && userProfile.avatar.trim() !== '' ? userProfile.avatar : '') ||
    (isAccountProfile && userProfile?.picture && userProfile.picture.trim() !== '' ? userProfile.picture : '') ||
    '';

  const userSubtitle = isAdmin
    ? (isEn ? 'Administrator' : 'Administrador')
    : isTeacher
    ? (isEn ? 'Native Friend' : 'Amigo Nativo')
    : (isEn ? 'Your Practice Space' : 'Seu Espaço de Prática');

  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-[#607EC9]/20 shadow-xs">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 sm:h-20 gap-3">
          {/* 1. Left: Brand Logo & Tagline */}
          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={onGoToLanding}
              className="hover:opacity-90 transition cursor-pointer text-left"
              title="Home / Landing"
            >
              <BrandLogo size="md" showText={true} />
            </button>
          </div>

          {/* 2. Center: Clean Date & Time Pill */}
          <div className="hidden sm:flex flex-col items-center justify-center px-6 py-1.5 bg-[#9AB4FF]/15 border border-[#9AB4FF]/40 rounded-2xl shadow-2xs">
            <div className="flex items-center gap-2 text-[#000035] font-mono font-bold text-xs sm:text-sm">
              <span className="inline-block w-2 h-2 rounded-full bg-[#1C4C96] animate-pulse" />
              <span>{currentTime}</span>
            </div>
            <span className="text-[11px] text-[#062863] capitalize font-medium">
              {currentDateStr}
            </span>
          </div>

          {/* 3. Right: Clean User Card & Logout Button */}
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            {/* Discrete Minimalist Direct Messages & Notices Button */}
            <div className="relative" ref={messagesMenuRef}>
              <button
                type="button"
                onClick={() => setIsMessagesOpen((prev) => !prev)}
                className={`relative p-2 sm:p-2.5 rounded-2xl border transition shadow-2xs cursor-pointer flex items-center justify-center group ${
                  isMessagesOpen
                    ? 'bg-[#062863] text-white border-[#062863]'
                    : 'bg-white hover:bg-[#9AB4FF]/15 border-[#607EC9]/30 text-[#000035] hover:text-[#062863]'
                }`}
                title={isEn ? 'Direct Messages & Notices' : 'Recados e Mensagens com Amigo Nativo'}
                aria-label={isEn ? 'Direct Messages & Notices' : 'Recados e Mensagens'}
                id="header-direct-messages-btn"
              >
                <MessageSquare
                  className={`w-4 h-4 sm:w-4.5 sm:h-4.5 group-hover:scale-105 transition-transform ${
                    isMessagesOpen ? 'text-white' : 'text-[#062863]'
                  }`}
                />

                {/* Discrete Unread Indicator (Badge / Dot) */}
                {unreadMessagesCount > 0 && (
                  <span className="absolute -top-1 -right-1 flex h-3.5 w-3.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-[#1C4C96] text-white text-[8px] font-black items-center justify-center border border-white shadow-2xs">
                      {unreadMessagesCount > 9 ? '9+' : unreadMessagesCount}
                    </span>
                  </span>
                )}
              </button>

              {/* Direct Messages & Notices Dropdown / Popover */}
              <HeaderMessagesPopover
                isOpen={isMessagesOpen}
                onClose={() => setIsMessagesOpen(false)}
                currentAccount={currentAccount}
                userProfile={userProfile}
                tutors={tutors}
                lessons={lessons}
                students={students}
                currentLanguage={currentLanguage}
                onUnreadChange={setUnreadMessagesCount}
              />
            </div>

            {currentAccount ? (
              <div className="relative" ref={userMenuRef}>
                {/* Clean User Card Button */}
                <button
                  type="button"
                  onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
                  className="flex items-center gap-3 px-3.5 sm:px-4 py-1.5 sm:py-2 bg-[#9AB4FF]/10 hover:bg-[#9AB4FF]/20 border border-[#9AB4FF]/40 rounded-2xl transition cursor-pointer text-left shadow-2xs group"
                >
                  <div className="w-8 h-8 rounded-full overflow-hidden border border-[#1C4C96]/30 shrink-0 bg-[#9AB4FF]/20 flex items-center justify-center">
                    {userAvatarPic ? (
                      <img
                        src={userAvatarPic}
                        alt={userName}
                        className="w-full h-full object-cover"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <User className="w-4 h-4 text-[#1C4C96]" />
                    )}
                  </div>
                  <div className="hidden xs:block text-left pr-1">
                    <span className="block font-bold text-xs sm:text-sm text-[#000035] leading-tight truncate max-w-[140px] sm:max-w-[180px]">
                      {userName}
                    </span>
                    <span className="text-[11px] text-[#607EC9] font-medium leading-none block mt-0.5">
                      {userSubtitle}
                    </span>
                  </div>
                  <ChevronDown
                    className={`w-3.5 h-3.5 text-[#1C4C96] opacity-70 transition-transform duration-200 ${
                      isUserMenuOpen ? 'rotate-180' : ''
                    }`}
                  />
                </button>

                {/* Clean Dropdown Menu */}
                {isUserMenuOpen && (
                  <div className="absolute right-0 mt-2 w-72 bg-white rounded-2xl shadow-2xl border border-[#607EC9]/30 p-2.5 z-50 animate-in fade-in zoom-in-95 duration-150 space-y-1.5">
                    {/* User Info Header */}
                    <div className="px-3 py-2 bg-[#9AB4FF]/10 rounded-xl border border-[#9AB4FF]/30 mb-2">
                      <p className="text-xs font-bold text-[#000035] truncate">{userName}</p>
                      <p className="text-[11px] text-[#607EC9] truncate">{currentAccount.email}</p>
                      <div className="mt-1.5 flex items-center gap-1.5">
                        <span
                          className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-full ${
                            isAdmin
                              ? 'bg-amber-500 text-white'
                              : isTeacher
                              ? 'bg-[#1C4C96] text-white'
                              : 'bg-blue-600 text-white'
                          }`}
                        >
                          {isAdmin ? (isEn ? 'Administrator' : 'Administrador') : isTeacher ? 'Native Friend' : 'Student'}
                        </span>
                      </div>
                    </div>

                    {/* Admin Actions */}
                    {isAdmin && (
                      <div className="space-y-1 pb-1 mb-1 border-b border-slate-100">
                        <button
                          type="button"
                          onClick={() => {
                            setIsUserMenuOpen(false);
                            if (onOpenAdminApprovals) onOpenAdminApprovals();
                          }}
                          className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-bold text-amber-900 bg-amber-50 hover:bg-amber-100/80 border border-amber-200 transition cursor-pointer"
                        >
                          <div className="flex items-center gap-2">
                            <ShieldCheck className="w-4 h-4 text-amber-600 shrink-0" />
                            <span>{isEn ? 'Native Friend Approvals' : 'Aprovações de Amigos Nativos'}</span>
                          </div>
                          {pendingTutorsCount > 0 && (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-amber-600 text-white shrink-0">
                              {pendingTutorsCount}
                            </span>
                          )}
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setIsUserMenuOpen(false);
                            if (onOpenAdminLandingEditor) onOpenAdminLandingEditor();
                          }}
                          className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold text-[#000035] hover:bg-[#9AB4FF]/15 transition cursor-pointer"
                        >
                          <Edit3 className="w-4 h-4 text-[#1C4C96]" />
                          <span>{isEn ? 'Edit Landing Page' : 'Editar Página Inicial'}</span>
                        </button>
                      </div>
                    )}

                    {/* Edit Profile (Teachers and Students) */}
                    {!isAdmin && (
                      <button
                        type="button"
                        onClick={() => {
                          setIsUserMenuOpen(false);
                          if (isTeacher && onOpenTeacherProfile) {
                            onOpenTeacherProfile();
                          } else if (onOpenStudentProfile) {
                            onOpenStudentProfile();
                          }
                        }}
                        className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-[#000035] hover:bg-[#9AB4FF]/15 transition cursor-pointer"
                      >
                        <Edit3 className="w-4 h-4 text-[#1C4C96]" />
                        <span>
                          {isTeacher
                            ? (isEn ? 'Edit Native Friend Profile' : 'Editar Perfil de Amigo Nativo')
                            : (isEn ? 'Edit Profile & Photo' : 'Editar Perfil & Foto')}
                        </span>
                      </button>
                    )}

                    {/* Switch Account / Role */}
                    <button
                      type="button"
                      onClick={() => {
                        setIsUserMenuOpen(false);
                        onOpenAccountModal();
                      }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-[#000035] hover:bg-[#9AB4FF]/15 transition cursor-pointer"
                    >
                      <Users className="w-4 h-4 text-[#1C4C96]" />
                      <span>{isEn ? 'Switch Account / Role' : 'Alternar Conta / Função'}</span>
                    </button>

                    {/* Language Selector for Students */}
                    {!isTeacher && (
                      <div className="pt-1 border-t border-slate-100">
                        <button
                          type="button"
                          onClick={() => setShowLanguageSubmenu(!showLanguageSubmenu)}
                          className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold text-[#000035] hover:bg-[#9AB4FF]/15 transition cursor-pointer"
                        >
                          <div className="flex items-center gap-2.5">
                            <Globe className="w-4 h-4 text-[#1C4C96]" />
                            <span>{navT.language}</span>
                          </div>
                          <span className="text-xs font-bold text-[#1C4C96] flex items-center gap-1">
                            <span>{currentLangObj.flag}</span>
                            <span>{currentLangObj.code.toUpperCase()}</span>
                          </span>
                        </button>

                        {showLanguageSubmenu && (
                          <div className="p-1 max-h-48 overflow-y-auto rounded-xl bg-slate-50 border border-slate-200 mt-1 space-y-0.5">
                            {SUPPORTED_LANGUAGES.map((lang) => (
                              <button
                                key={lang.code}
                                type="button"
                                onClick={() => {
                                  onToggleLanguage(lang.code);
                                  setShowLanguageSubmenu(false);
                                  setIsUserMenuOpen(false);
                                }}
                                className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition cursor-pointer ${
                                  lang.code === currentLanguage
                                    ? 'bg-[#1C4C96] text-white font-bold'
                                    : 'text-slate-700 hover:bg-[#9AB4FF]/20'
                                }`}
                              >
                                <span className="flex items-center gap-2">
                                  <span>{lang.flag}</span>
                                  <span>{lang.nativeName}</span>
                                </span>
                                {lang.code === currentLanguage && <Check className="w-3.5 h-3.5 text-white" />}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Find Native Friends / Tutors */}
                    {onFindTutors && !isTeacher && (
                      <button
                        type="button"
                        onClick={() => {
                          setIsUserMenuOpen(false);
                          onFindTutors();
                        }}
                        className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-[#000035] hover:bg-[#9AB4FF]/15 transition cursor-pointer"
                      >
                        <Search className="w-4 h-4 text-[#1C4C96]" />
                        <span>{navT.findTutors}</span>
                      </button>
                    )}

                    {/* Logout Option in Dropdown */}
                    {onLogout && (
                      <div className="pt-1 border-t border-slate-100">
                        <button
                          type="button"
                          onClick={() => {
                            setIsUserMenuOpen(false);
                            onLogout();
                          }}
                          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-rose-600 hover:bg-rose-50 transition cursor-pointer"
                        >
                          <LogOut className="w-4 h-4 text-rose-500" />
                          <span>{isEn ? 'Log Out' : 'Sair da Conta'}</span>
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <button
                type="button"
                onClick={onOpenAccountModal}
                className="flex items-center gap-2 px-4 py-2 rounded-2xl bg-[#000035] text-white text-xs font-bold hover:bg-[#062863] transition cursor-pointer shadow-xs"
              >
                <User className="w-4 h-4 text-[#9AB4FF]" />
                <span>{navT.logIn}</span>
              </button>
            )}

            {/* Logout Quick Button */}
            {onLogout && currentAccount && (
              <button
                type="button"
                onClick={onLogout}
                className="p-2.5 sm:p-3 rounded-2xl border border-slate-200 text-slate-400 hover:text-rose-600 hover:bg-rose-50 hover:border-rose-200 transition cursor-pointer flex items-center justify-center shadow-2xs"
                title={isEn ? 'Log Out' : 'Sair da Conta'}
              >
                <LogOut className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};

export const Header = Navbar;
export default Navbar;



