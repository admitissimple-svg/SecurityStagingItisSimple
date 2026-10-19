import React, { useState, useEffect } from 'react';
import {
  X,
  Lock,
  Mail,
  User,
  Sparkles,
  Eye,
  EyeOff,
  LogIn,
  AlertCircle,
  Compass,
  HeartHandshake,
  Loader2,
  ShieldCheck,
} from 'lucide-react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import {
  GoogleAccount,
  Language,
  UserRole,
  UserProfile,
  NativeFriendTutor,
  EnglishLevel,
} from '../types';
import { BrandLogo } from './BrandLogo';
import { GoogleSignInModal } from './GoogleSignInModal';
import { firebaseSignInWithEmail, firebaseSignUpWithEmail } from '../utils/auth';
import { getDb, auth } from '../firebase';

export interface LoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialRole?: UserRole;
  initialEmail?: string;
  currentLanguage?: Language;
  onShowToast?: (title: string, message: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
  onLoginSuccess: (
    account: GoogleAccount,
    initialProfile?: Partial<UserProfile>,
    tutorData?: NativeFriendTutor
  ) => void;
  onSwitchToSignUp?: (role: UserRole, email?: string) => void;
  onOpenOnboarding?: (email?: string) => void;
}

const ROLE_LABELS: Record<
  string,
  {
    student: string;
    studentDesc: string;
    teacher: string;
    teacherDesc: string;
    admin: string;
    adminDesc: string;
    accessAs: string;
  }
> = {
  pt: {
    student: 'Seu acesso',
    studentDesc: 'Vivendo o inglês no dia a dia',
    teacher: 'Amigo Nativo',
    teacherDesc: 'Mentoria e conversação real',
    admin: 'Administrador',
    adminDesc: 'Painel & aprovações',
    accessAs: 'Selecione seu perfil:',
  },
  en: {
    student: 'Student Access',
    studentDesc: 'Living English every day',
    teacher: 'Native Friend',
    teacherDesc: 'Mentoring & Conversation',
    admin: 'Administrator',
    adminDesc: 'Panel & approvals',
    accessAs: 'Select your role:',
  },
};

export const LoginModal: React.FC<LoginModalProps> = ({
  isOpen,
  onClose,
  initialRole = 'student',
  initialEmail = '',
  currentLanguage = 'pt',
  onShowToast,
  onLoginSuccess,
  onSwitchToSignUp,
  onOpenOnboarding,
}) => {
  const isEn = currentLanguage === 'en';
  const roleText = ROLE_LABELS[currentLanguage] || ROLE_LABELS.pt;

  // 1. Mandatory requirement: default role MUST be 'student' (Student Access)
  const [selectedRole, setSelectedRole] = useState<UserRole>('student');
  const [email, setEmail] = useState<string>(initialEmail || '');
  const [password, setPassword] = useState<string>('');
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [showGoogleSignIn, setShowGoogleSignIn] = useState<boolean>(false);

  // Initialize and reset on modal open - synchronizing with initialRole
  useEffect(() => {
    if (isOpen) {
      setSelectedRole(initialRole || 'student');
      setErrorMsg('');
      setIsLoading(false);
      if (initialEmail) {
        setEmail(initialEmail.trim());
      }
      // If window path is stuck on /admin from a previous session, clean it up when opening (only if not admin initialRole)
      if (initialRole !== 'admin' && typeof window !== 'undefined' && window.location.pathname === '/admin') {
        try {
          window.history.replaceState({}, '', '/');
        } catch {}
      }
    }
  }, [isOpen, initialRole, initialEmail]);

  // Support ESC key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  // Handle role card selection: updates visual selection and synchronizes with form submission
  const handleRoleSelect = (role: UserRole) => {
    setSelectedRole(role);
    setErrorMsg('');
    // If switching away from admin, clear /admin URL state
    if (role !== 'admin' && typeof window !== 'undefined' && window.location.pathname === '/admin') {
      try {
        window.history.replaceState({}, '', '/');
      } catch {}
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    if (!email.trim() || !password) {
      setErrorMsg(isEn ? 'Please fill in both email and password.' : 'Por favor, preencha o e-mail e a senha.');
      return;
    }

    const cleanEmail = email.toLowerCase().trim();
    setIsLoading(true);

    try {
      // 1. Authenticate user in Firebase Auth and obtain UID
      let firebaseUid: string | undefined;
      let idToken: string | undefined;
      try {
        const authResult = await firebaseSignInWithEmail(cleanEmail, password);
        firebaseUid = authResult?.user?.uid;
        idToken = authResult?.accessToken;
      } catch {
        const userFriendlyError = isEn ? 'Invalid email or password.' : 'E-mail ou senha incorretos.';
        setErrorMsg(userFriendlyError);
        if (onShowToast) {
          onShowToast(
            isEn ? 'Authentication Failed' : 'Falha na Autenticação',
            userFriendlyError,
            'warning'
          );
        }
        setIsLoading(false);
        return;
      }

      // Wipe password state immediately
      setPassword('');

      // 2. Authenticate exclusively with backend API using verified Firebase ID Token
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);

      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({
          idToken,
          email: cleanEmail,
          role: selectedRole,
          uid: firebaseUid,
        }),
        signal: controller.signal,
      }).catch(() => {
        clearTimeout(timeoutId);
        throw new Error(
          isEn
            ? 'Connection timed out. Please check your network and try again.'
            : 'Tempo de conexão esgotado. Verifique sua rede e tente novamente.'
        );
      });

      clearTimeout(timeoutId);

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        const userFriendlyError =
          errData.message ||
          errData.error ||
          (res.status === 401
            ? (isEn
                ? 'Profile not found. Please register before logging in.'
                : 'Perfil não encontrado. Por favor, cadastre-se.')
            : (res.status === 403
                ? (isEn
                    ? 'Access denied: This account is not authorized as an administrator.'
                    : 'Acesso negado: esta conta não possui privilégios de administrador ou a custom claim administrativa ainda não foi provisionada.')
                : (isEn ? 'Failed to authenticate credentials.' : 'Falha ao autenticar credenciais.')));

        // Defensively sign out from Firebase Auth so background listeners do not retain an unauthorized student session
        try {
          await auth.signOut();
        } catch {}

        setErrorMsg(userFriendlyError);
        if (onShowToast) {
          onShowToast(
            res.status === 403
              ? (isEn ? 'Access Denied' : 'Acesso Negado')
              : (isEn ? 'Authentication Failed' : 'Falha na Autenticação'),
            userFriendlyError,
            'error'
          );
        }
        setIsLoading(false);
        return;
      }

      const data = await res.json();
      const verifiedRole: UserRole = data.account?.role || 'student';

      // Strict Defense-in-Depth: If Administrator was requested, user MUST be verified as admin
      if (selectedRole === 'admin' && verifiedRole !== 'admin') {
        try {
          await auth.signOut();
        } catch {}
        const accessDeniedMsg = isEn
          ? 'Access denied: This account is not authorized as an administrator.'
          : 'Acesso negado: esta conta não possui privilégios de administrador ou a custom claim administrativa ainda não foi provisionada.';
        setErrorMsg(accessDeniedMsg);
        if (onShowToast) {
          onShowToast(
            isEn ? 'Access Denied' : 'Acesso Negado',
            accessDeniedMsg,
            'error'
          );
        }
        setIsLoading(false);
        return;
      }

      setSelectedRole(verifiedRole);

      const account: GoogleAccount = data.account || {
        uid: firebaseUid || `usr-${cleanEmail.replace(/[^a-zA-Z0-9]/g, '-')}`,
        email: cleanEmail,
        name: cleanEmail.split('@')[0],
        role: verifiedRole,
      };

      // 3. Conditional redirection strictly based on verifiedRole:
      if (verifiedRole === 'teacher') {
        if (typeof window !== 'undefined') {
          try {
            window.history.replaceState({ page: 'teacher' }, '', '/teacher');
          } catch {}
        }
      } else if (verifiedRole === 'admin') {
        // Force refresh ID token if custom claims were recently updated on the server
        try {
          if (auth.currentUser) {
            await auth.currentUser.getIdToken(true);
          }
        } catch {}
        if (typeof window !== 'undefined') {
          try {
            window.history.replaceState({ page: 'admin' }, '', '/admin');
          } catch {}
        }
      } else {
        if (typeof window !== 'undefined') {
          try {
            window.history.replaceState({ page: 'dashboard' }, '', '/dashboard');
          } catch {}
        }
      }

      setIsLoading(false);
      onLoginSuccess(account, data.profile, data.tutor);
      onClose();
    } catch (err: any) {
      const errorText = err.message || (isEn ? 'Unexpected error during login' : 'Erro inesperado ao realizar login');
      setErrorMsg(errorText);
      if (onShowToast) {
        onShowToast(isEn ? 'Login error' : 'Erro no login', errorText, 'error');
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#000035]/80 backdrop-blur-sm overflow-y-auto animate-in fade-in">
      <div className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden text-[#000035] my-8">
        {/* Header Ribbon */}
        <div className="bg-gradient-to-r from-[#000035] to-[#062863] px-6 py-5 text-white flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <BrandLogo size="sm" showText={false} />
            <div>
              <h3 className="text-base font-black tracking-tight flex items-center gap-1.5">
                <span>It&apos;s Simple</span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-[#1C4C96] text-[#9AB4FF] font-bold">
                  {isEn ? 'Sign in' : 'Entrar'}
                </span>
              </h3>
              <p className="text-[11px] text-slate-300 font-medium">
                {isEn ? 'Live your English every day' : 'Viva seu inglês todos os dias'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl hover:bg-white/10 text-white/80 hover:text-white transition cursor-pointer"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6">
          {/* 🌟 Role Selection Switcher (Student Access vs Native Friend vs Administrator) */}
          <div className="mb-5 bg-slate-100/90 p-1.5 rounded-2xl border border-slate-200">
            <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider text-center mb-1.5">
              {roleText.accessAs}
            </p>
            <div className="grid grid-cols-3 gap-1.5">
              {/* Card 1: Student Access */}
              <button
                type="button"
                onClick={() => handleRoleSelect('student')}
                className={`p-2 rounded-xl text-left transition cursor-pointer flex flex-col justify-between ${
                  selectedRole === 'student'
                    ? 'bg-white text-[#000035] shadow-sm border border-slate-200 ring-2 ring-[#1C4C96]/30 font-bold'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-white/50'
                }`}
              >
                <div className="flex items-center gap-1 mb-0.5">
                  <Compass
                    className={`w-3.5 h-3.5 shrink-0 ${
                      selectedRole === 'student' ? 'text-[#1C4C96]' : 'text-slate-400'
                    }`}
                  />
                  <span className="font-extrabold text-xs truncate">{roleText.student}</span>
                </div>
                <span className="text-[9px] text-slate-500 font-medium leading-tight truncate">
                  {roleText.studentDesc}
                </span>
              </button>

              {/* Card 2: Native Friend */}
              <button
                type="button"
                onClick={() => handleRoleSelect('teacher')}
                className={`p-2 rounded-xl text-left transition cursor-pointer flex flex-col justify-between ${
                  selectedRole === 'teacher'
                    ? 'bg-white text-[#000035] shadow-sm border border-slate-200 ring-2 ring-emerald-500/30 font-bold'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-white/50'
                }`}
              >
                <div className="flex items-center gap-1 mb-0.5">
                  <HeartHandshake
                    className={`w-3.5 h-3.5 shrink-0 ${
                      selectedRole === 'teacher' ? 'text-emerald-600' : 'text-slate-400'
                    }`}
                  />
                  <span className="font-extrabold text-xs truncate">{roleText.teacher}</span>
                </div>
                <span className="text-[9px] text-slate-500 font-medium leading-tight truncate">
                  {roleText.teacherDesc}
                </span>
              </button>

              {/* Card 3: Administrator */}
              <button
                type="button"
                onClick={() => handleRoleSelect('admin')}
                className={`p-2 rounded-xl text-left transition cursor-pointer flex flex-col justify-between ${
                  selectedRole === 'admin'
                    ? 'bg-white text-[#000035] shadow-sm border border-slate-200 ring-2 ring-amber-500/30 font-bold'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-white/50'
                }`}
              >
                <div className="flex items-center gap-1 mb-0.5">
                  <ShieldCheck
                    className={`w-3.5 h-3.5 shrink-0 ${
                      selectedRole === 'admin' ? 'text-amber-600' : 'text-slate-400'
                    }`}
                  />
                  <span className="font-extrabold text-xs truncate">{roleText.admin}</span>
                </div>
                <span className="text-[9px] text-slate-500 font-medium leading-tight truncate">
                  {roleText.adminDesc}
                </span>
              </button>
            </div>
          </div>

          {/* Social Google Login Button */}
          <div className="mb-4">
            <button
              type="button"
              onClick={() => setShowGoogleSignIn(true)}
              className="w-full flex items-center justify-center gap-3 px-4 py-3 rounded-2xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:border-slate-300 font-bold text-xs sm:text-sm transition shadow-2xs cursor-pointer group"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                />
              </svg>
              <span>{isEn ? 'Continue with Google' : 'Continuar com o Google'}</span>
            </button>
          </div>

          <div className="relative flex py-2 items-center mb-4">
            <div className="flex-grow border-t border-slate-200"></div>
            <span className="flex-shrink mx-4 text-slate-400 text-[11px] font-bold uppercase tracking-wider">
              {isEn ? 'or with email' : 'ou com seu e-mail'}
            </span>
            <div className="flex-grow border-t border-slate-200"></div>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Email Field */}
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">
                {isEn ? 'Email address' : 'Endereço de e-mail'}
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={
                    selectedRole === 'admin'
                      ? 'adm.itissimple@gmail.com'
                      : isEn
                      ? 'your.email@domain.com'
                      : 'seu.email@dominio.com'
                  }
                  required
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-xs sm:text-sm font-medium focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-[#1C4C96] focus:border-transparent transition"
                />
              </div>
            </div>

            {/* Password Field */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-bold text-slate-700">
                  {isEn ? 'Password' : 'Senha'}
                </label>
                {(onSwitchToSignUp || onOpenOnboarding) && (
                  <button
                    type="button"
                    onClick={() => {
                      const cleanEmail = email.trim();
                      if (onSwitchToSignUp) {
                        onSwitchToSignUp(selectedRole, cleanEmail);
                      } else if (onOpenOnboarding) {
                        onOpenOnboarding(cleanEmail);
                      }
                      onClose();
                    }}
                    className="text-[11px] font-semibold text-[#1C4C96] hover:underline cursor-pointer"
                  >
                    {isEn ? 'Forgot password?' : 'Esqueceu a senha?'}
                  </button>
                )}
              </div>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  className="w-full pl-10 pr-10 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-xs sm:text-sm font-medium focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-[#1C4C96] focus:border-transparent transition"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="p-1 text-slate-400 hover:text-slate-600 absolute right-3 top-1/2 -translate-y-1/2 transition cursor-pointer"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Error Message with direct Wizard Onboarding action */}
            {errorMsg && (
              <div className="p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex flex-col gap-2.5 animate-in fade-in">
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600" />
                  <span className="font-medium leading-relaxed">{errorMsg}</span>
                </div>
                {selectedRole === 'student' && (onOpenOnboarding || onSwitchToSignUp) && (
                  <button
                    type="button"
                    onClick={() => {
                      const cleanEmail = email.trim();
                      if (onOpenOnboarding) {
                        onOpenOnboarding(cleanEmail);
                      } else if (onSwitchToSignUp) {
                        onSwitchToSignUp('student', cleanEmail);
                      }
                      onClose();
                    }}
                    className="self-start py-2 px-3.5 bg-[#000035] hover:bg-[#062863] text-white text-xs font-black rounded-xl transition shadow-sm flex items-center gap-1.5 cursor-pointer active:scale-98"
                  >
                    <span>{isEn ? 'Start Student Onboarding Wizard →' : 'Criar cadastro no Wizard Onboard →'}</span>
                  </button>
                )}
              </div>
            )}

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-3 px-4 rounded-2xl bg-[#000035] text-white hover:bg-[#062863] font-black text-xs sm:text-sm flex items-center justify-center gap-2 transition shadow-md disabled:opacity-60 cursor-pointer active:scale-98"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-[#9AB4FF]" />
                  <span>{isEn ? 'Verifying profile...' : 'Verificando perfil...'}</span>
                </>
              ) : (
                <>
                  <LogIn className="w-4 h-4 text-[#9AB4FF]" />
                  <span>
                    {selectedRole === 'student'
                      ? isEn
                        ? 'Log in to Student Space'
                        : 'Acessar Espaço do Aluno'
                      : selectedRole === 'teacher'
                      ? isEn
                        ? 'Log in as Native Friend'
                        : 'Acessar como Amigo Nativo'
                      : isEn
                      ? 'Log in as Administrator'
                      : 'Acessar como Administrador'}
                  </span>
                </>
              )}
            </button>

            {/* Divider */}
            <div className="relative my-3.5 flex items-center justify-center">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-slate-200"></div>
              </div>
              <div className="relative bg-white px-3 text-[11px] font-bold text-slate-400 uppercase">
                {isEn ? 'or' : 'ou'}
              </div>
            </div>

            {/* Google Sign In Option */}
            <button
              type="button"
              onClick={() => setShowGoogleSignIn(true)}
              className="w-full py-2.5 px-4 rounded-2xl bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 font-bold text-xs sm:text-sm flex items-center justify-center gap-2.5 transition shadow-xs cursor-pointer active:scale-98"
            >
              <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                />
              </svg>
              <span>{isEn ? 'Sign in with Google' : 'Entrar com o Google'}</span>
            </button>
          </form>

          {/* Switch to SignUp */}
          {(onSwitchToSignUp || onOpenOnboarding) && (
            <div className="mt-5 text-center pt-4 border-t border-slate-100">
              <p className="text-xs text-slate-500">
                {isEn ? "Don't have an account yet?" : 'Ainda não possui uma conta?'}{' '}
                <button
                  type="button"
                  onClick={() => {
                    const cleanEmail = email.trim();
                    if (selectedRole === 'student' && onOpenOnboarding) {
                      onOpenOnboarding(cleanEmail);
                      onClose();
                    } else if (onSwitchToSignUp) {
                      onSwitchToSignUp(selectedRole, cleanEmail);
                    }
                  }}
                  className="font-extrabold text-[#1C4C96] hover:underline cursor-pointer"
                >
                  {isEn ? 'Create account' : 'Cadastre-se gratuitamente'}
                </button>
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Google Sign In Modal */}
      {showGoogleSignIn && (
        <GoogleSignInModal
          isOpen={showGoogleSignIn}
          onClose={() => setShowGoogleSignIn(false)}
          preferredRole={selectedRole}
          currentLanguage={currentLanguage}
          onLoginSuccess={(acc, prof) => {
            setShowGoogleSignIn(false);
            onLoginSuccess(acc, prof);
            onClose();
          }}
        />
      )}
    </div>
  );
};

export default LoginModal;
