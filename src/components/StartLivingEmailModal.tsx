import React, { useState } from 'react';
import { Mail, ArrowRight, X, Loader2, Sparkles } from 'lucide-react';
import { Language } from '../types';

interface StartLivingEmailModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentLanguage: Language;
  onEmailAlreadyExists: (email: string) => void;
  onEmailProceed?: (email: string) => void;
  onEmailVerified?: (email: string) => void;
  onSwitchToLogin: (prefilledEmail?: string) => void;
}

export const StartLivingEmailModal: React.FC<StartLivingEmailModalProps> = ({
  isOpen,
  onClose,
  currentLanguage,
  onEmailAlreadyExists,
  onEmailProceed,
  onEmailVerified,
  onSwitchToLogin,
}) => {
  const [email, setEmail] = useState('');
  const [isChecking, setIsChecking] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  if (!isOpen) return null;

  const isEn = currentLanguage === 'en';

  const handleProceed = (cleanEmail: string) => {
    setIsChecking(false);
    try {
      if (typeof onEmailProceed === 'function') {
        onEmailProceed(cleanEmail);
      }
      if (typeof onEmailVerified === 'function') {
        onEmailVerified(cleanEmail);
      }
    } catch (callbackErr) {
      console.warn('Error during onEmailProceed callback:', callbackErr);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    const cleanEmail = email.toLowerCase().trim();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!cleanEmail || !emailRegex.test(cleanEmail)) {
      setErrorMsg(
        isEn
          ? 'Please provide a valid email address (e.g. user@domain.com).'
          : 'Por favor, informe um endereço de e-mail válido (ex: seu.nome@dominio.com).'
      );
      return;
    }

    setIsChecking(true);
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);

      const res = await fetch(`/api/auth/check-user?email=${encodeURIComponent(cleanEmail)}`, {
        signal: controller.signal,
      }).catch((fetchErr) => {
        console.warn('Check user network notice:', fetchErr);
        return null;
      });

      clearTimeout(timeoutId);

      if (res && res.ok) {
        const data = await res.json().catch(() => null);
        if (data?.emailExists) {
          // Email already exists: trigger subtle toast and redirect to login
          setIsChecking(false);
          if (typeof onEmailAlreadyExists === 'function') {
            onEmailAlreadyExists(cleanEmail);
          }
          return;
        }
      }

      // Email is unique or verification reached fallback: proceed to onboarding wizard
      handleProceed(cleanEmail);
    } catch (err) {
      console.warn('Notice checking email existence:', err);
      // Proceed to onboarding wizard where server will guard on submit
      handleProceed(cleanEmail);
    }
  };

  return (
    <div
      id="start-living-email-modal"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#000035]/60 backdrop-blur-xs transition-opacity duration-200"
    >
      <div className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl border border-[#607EC9]/20 overflow-hidden transform transition-all animate-in fade-in zoom-in-95 duration-200">
        {/* Decorative Top Accent */}
        <div className="h-2 w-full bg-linear-to-r from-[#000035] via-[#062863] to-[#607EC9]" />

        {/* Close Button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute top-5 right-5 p-2 text-slate-400 hover:text-[#000035] rounded-full hover:bg-slate-100 transition cursor-pointer"
          aria-label="Close"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="p-6 sm:p-8 space-y-6">
          {/* Header */}
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#9AB4FF]/20 text-[#062863] text-xs font-bold tracking-wide uppercase">
              <Sparkles className="w-3.5 h-3.5 text-[#062863]" />
              {isEn ? 'Start Living in English' : 'Comece a Viver em Inglês'}
            </div>
            <h2 className="text-2xl font-black text-[#000035] tracking-tight">
              {isEn ? 'Welcome to It\'s Simple' : 'Boas-vindas ao It\'s Simple'}
            </h2>
            <p className="text-sm text-slate-600 leading-relaxed">
              {isEn
                ? 'Enter your email to verify your registration and set up your personalized English routine.'
                : 'Informe seu e-mail para verificar seu cadastro e iniciar seu plano personalizado de rotinas em inglês.'}
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="start-email-input" className="block text-xs font-bold text-[#062863] uppercase tracking-wider">
                {isEn ? 'Email Address' : 'Endereço de E-mail'}
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                  <Mail className="w-4 h-4" />
                </div>
                <input
                  id="start-email-input"
                  type="email"
                  autoFocus
                  required
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (errorMsg) setErrorMsg('');
                  }}
                  placeholder={isEn ? 'your.name@example.com' : 'seu.nome@exemplo.com'}
                  className="w-full pl-10 pr-4 py-3 bg-[#FAFCFF] border border-[#607EC9]/30 rounded-xl text-sm font-medium text-[#000035] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#062863] focus:border-transparent transition shadow-2xs"
                  disabled={isChecking}
                />
              </div>
              {errorMsg && (
                <p className="text-xs font-semibold text-rose-600 mt-1 animate-in fade-in">
                  {errorMsg}
                </p>
              )}
            </div>

            <button
              type="submit"
              disabled={isChecking || !email.trim()}
              className="w-full py-3.5 px-6 rounded-xl bg-[#062863] hover:bg-[#000035] text-white font-bold text-sm flex items-center justify-center gap-2 transition duration-150 shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              {isChecking ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>{isEn ? 'Verifying email...' : 'Verificando e-mail...'}</span>
                </>
              ) : (
                <>
                  <span>{isEn ? 'Continue to Onboarding' : 'Continuar Onboarding'}</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>

          {/* Switch to Login footer */}
          <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
            <span>{isEn ? 'Already have an account?' : 'Já possui uma conta?'}</span>
            <button
              type="button"
              onClick={() => {
                onClose();
                onSwitchToLogin(email.trim() || undefined);
              }}
              className="font-bold text-[#062863] hover:underline cursor-pointer"
            >
              {isEn ? 'Sign In / Log In →' : 'Fazer Login →'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
