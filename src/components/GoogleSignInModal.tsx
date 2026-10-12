import React, { useState, useEffect } from 'react';
import {
  X,
  Loader2,
  AlertCircle,
  ShieldCheck,
  ExternalLink,
  Copy,
  Check,
  Info,
} from 'lucide-react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { getDb } from '../firebase';
import { GoogleAccount, UserRole, Language } from '../types';
import { googleSignIn } from '../utils/auth';

interface GoogleSignInModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLoginSuccess: (account: GoogleAccount, initialProfile?: any) => void;
  preferredRole?: UserRole;
  currentLanguage: Language;
}

export const GoogleSignInModal: React.FC<GoogleSignInModalProps> = ({
  isOpen,
  onClose,
  onLoginSuccess,
  preferredRole = 'student',
  currentLanguage = 'pt',
}) => {
  const isEn = currentLanguage === 'en';

  const [selectedRole, setSelectedRole] = useState<UserRole>('student');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [noticeMsg, setNoticeMsg] = useState<string>('');
  const [isUnauthorizedDomain, setIsUnauthorizedDomain] = useState<boolean>(false);
  const [copiedDomain, setCopiedDomain] = useState<boolean>(false);

  // Sync selectedRole when preferredRole changes (defaulting strictly to 'student')
  useEffect(() => {
    setSelectedRole(preferredRole === 'teacher' ? 'teacher' : preferredRole === 'admin' ? 'admin' : 'student');
  }, [preferredRole]);

  // Reset messages when opening modal
  useEffect(() => {
    if (isOpen) {
      setErrorMsg('');
      setNoticeMsg('');
      setIsUnauthorizedDomain(false);
    }
  }, [isOpen]);

  // Support ESC key to dismiss modal
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

  const currentHostname = typeof window !== 'undefined' ? window.location.hostname : '';

  const handleCopyHostname = () => {
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(currentHostname);
      setCopiedDomain(true);
      setTimeout(() => setCopiedDomain(false), 2000);
    }
  };

  // Trigger Google Official Sign-In via Firebase Auth Popup
  const handleGoogleAuth = async () => {
    setIsLoading(true);
    setErrorMsg('');
    setNoticeMsg('');
    setIsUnauthorizedDomain(false);

    try {
      const { user } = await googleSignIn();

      if (!user.email) {
        throw new Error(
          isEn
            ? 'No verified email returned from Google.'
            : 'Nenhum e-mail verificado retornado pelo Google.'
        );
      }

      // 1. Query user document in users/{uid} in Firestore to read field role
      let firestoreUserDoc: any = null;
      try {
        const db = getDb();
        const userDocRef = doc(db, 'users', user.uid);
        const snap = await Promise.race([
          getDoc(userDocRef),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000)),
        ]);
        if (snap && 'exists' in snap && snap.exists()) {
          firestoreUserDoc = snap.data();
        }
      } catch (fsErr) {
        console.warn('Firestore fetch notice during Google sign-in:', fsErr);
      }

      // 2. Strict role determination from Firestore document
      const cleanEmail = user.email.toLowerCase().trim();
      const isMasterAdmin = cleanEmail === 'adm.itissimple@gmail.com';
      const docRole = (firestoreUserDoc?.role || '').toLowerCase();
      let verifiedRole: UserRole = 'student';

      if (isMasterAdmin) {
        verifiedRole = 'admin';
      } else if (docRole === 'student') {
        // STRICT RBAC: Registered student locked strictly to student role
        verifiedRole = 'student';
      } else if (docRole === 'native_friend' || docRole === 'teacher') {
        verifiedRole = 'teacher';
      } else if (docRole === 'admin') {
        verifiedRole = isMasterAdmin ? 'admin' : 'student';
      } else {
        verifiedRole = selectedRole === 'teacher' ? 'teacher' : 'student';
      }

      // Synchronize authenticated user with backend profile and persistence
      const res = await fetch('/api/auth/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uid: user.uid,
          email: user.email,
          name: user.displayName || user.email.split('@')[0],
          role: verifiedRole,
          picture: user.photoURL || undefined,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(
          errData.error ||
            (isEn ? 'Failed to synchronize account.' : 'Falha ao sincronizar conta.')
        );
      }

      const data = await res.json();
      const account: GoogleAccount = data.account;
      account.uid = user.uid;
      account.id = user.uid;

      // Lock role if server or Firestore confirms student
      if (docRole === 'student' || data.isRoleEnforced || account.role === 'student' || verifiedRole === 'student') {
        if (!isMasterAdmin) {
          verifiedRole = 'student';
          account.role = 'student';
        }
      } else {
        account.role = verifiedRole;
      }

      // Guarantee student profile is saved under doc(db, 'users', user.uid) with UID as document key
      if (verifiedRole === 'student' && user.uid) {
        const db = getDb();
        if (db) {
          const studentProfilePayload = {
            id: user.uid,
            uid: user.uid,
            email: cleanEmail,
            name: account.name || user.displayName || cleanEmail.split('@')[0],
            role: 'student',
            picture: account.picture || user.photoURL || '',
            avatar: account.picture || user.photoURL || '',
            level: firestoreUserDoc?.level || data?.profile?.level || 'iniciante',
            ...(firestoreUserDoc || {}),
            ...(data?.profile || {}),
            updatedAt: new Date().toISOString(),
          };
          setDoc(doc(db, 'users', user.uid), studentProfilePayload, { merge: true }).catch(() => null);
        }
      }

      // 3. Redirection
      if (verifiedRole === 'student') {
        if (typeof window !== 'undefined') {
          try {
            window.history.replaceState({ page: 'dashboard' }, '', '/dashboard');
          } catch {}
        }
      } else if (verifiedRole === 'teacher') {
        if (typeof window !== 'undefined') {
          try {
            window.history.replaceState({ page: 'teacher' }, '', '/teacher');
          } catch {}
        }
      } else if (verifiedRole === 'admin') {
        if (typeof window !== 'undefined') {
          try {
            window.history.replaceState({ page: 'admin' }, '', '/admin');
          } catch {}
        }
      }

      onLoginSuccess(account, data.profile);
      onClose();
    } catch (err: any) {
      const errCode = err?.code || '';
      const errMsg = String(err?.message || '');

      const isCancelled =
        errCode === 'auth/popup-closed-by-user' ||
        errCode === 'auth/cancelled-popup-request' ||
        errMsg.includes('auth/popup-closed-by-user') ||
        errMsg.includes('popup-closed-by-user') ||
        errMsg.includes('auth/cancelled-popup-request') ||
        errMsg.includes('cancelled-popup-request');

      const isPopupBlocked =
        errCode === 'auth/popup-blocked' ||
        errMsg.includes('auth/popup-blocked') ||
        errMsg.includes('popup-blocked');

      const isUnauthDomain =
        errCode === 'auth/unauthorized-domain' ||
        errMsg.includes('auth/unauthorized-domain') ||
        errMsg.includes('unauthorized-domain');

      if (isCancelled) {
        // Normal user cancellation - do not treat as error or log console.error
        setNoticeMsg(
          isEn
            ? 'Sign-in window was closed. Click "Continue with Google" whenever you are ready.'
            : 'Janela de autenticação fechada. Clique em "Continuar com o Google" quando desejar tentar novamente.'
        );
        setErrorMsg('');
      } else if (isPopupBlocked) {
        setErrorMsg(
          isEn
            ? 'Popup was blocked by your browser. Please allow popups for this site and try again.'
            : 'A janela pop-up foi bloqueada pelo seu navegador. Por favor, autorize pop-ups para este site e tente novamente.'
        );
      } else if (isUnauthDomain) {
        setIsUnauthorizedDomain(true);
        setErrorMsg(
          isEn
            ? `Domain "${currentHostname}" is not yet added to Authorized Domains in Firebase Console.`
            : `O domínio "${currentHostname}" ainda não foi adicionado aos Domínios Autorizados no Firebase Console.`
        );
      } else {
        console.error('Google Sign-In Error:', err);
        setErrorMsg(
          err?.message ||
            (isEn ? 'Google authentication failed.' : 'Falha na autenticação com Google.')
        );
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-60 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white rounded-3xl max-w-[440px] w-full p-6 sm:p-8 shadow-2xl border border-slate-200 relative my-6 text-[#202124] animate-in fade-in zoom-in-95 duration-150">
        {/* Close Button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute top-5 right-5 w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-500 hover:text-slate-800 transition cursor-pointer z-10"
          aria-label={isEn ? 'Close' : 'Fechar'}
          title="Fechar (Esc)"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Google Official Header */}
        <div className="flex flex-col items-center text-center mb-6">
          <div className="w-14 h-14 rounded-full flex items-center justify-center bg-white shadow-xs border border-slate-100 mb-3">
            <svg className="w-7 h-7" viewBox="0 0 24 24">
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
          </div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">
            {isEn ? 'Sign in with Google' : 'Entrar com o Google'}
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            {isEn
              ? 'Real and secure authentication via Firebase Auth'
              : 'Autenticação real e segura via Firebase Auth'}
          </p>
        </div>

        {/* Profile Role Selector */}
        <div className="mb-5 p-3 rounded-2xl bg-slate-50 border border-slate-200">
          <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-2 text-center">
            {isEn ? 'Choose your profile type:' : 'Escolha seu tipo de perfil:'}
          </label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setSelectedRole('student')}
              className={`py-2 px-3 rounded-xl text-xs font-semibold transition cursor-pointer border ${
                selectedRole === 'student'
                  ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
              }`}
            >
              {isEn ? 'Student' : 'Aluno (Student)'}
            </button>
            <button
              type="button"
              onClick={() => setSelectedRole('teacher')}
              className={`py-2 px-3 rounded-xl text-xs font-semibold transition cursor-pointer border ${
                selectedRole === 'teacher'
                  ? 'bg-amber-600 text-white border-amber-600 shadow-xs'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
              }`}
            >
              {isEn ? 'Native Friend (Tutor)' : 'Amigo Nativo (Tutor)'}
            </button>
          </div>
        </div>

        {/* Cancellation Notice */}
        {noticeMsg && (
          <div className="mb-4 p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-700 text-xs flex items-start gap-2.5 animate-in fade-in">
            <Info className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
            <div className="space-y-1 flex-1">
              <span className="leading-snug block font-medium">{noticeMsg}</span>
            </div>
          </div>
        )}

        {/* Error Alert */}
        {errorMsg && (
          <div className="mb-4 p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-start gap-2.5 animate-in fade-in">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <div className="space-y-1.5 flex-1">
              <span className="leading-snug block font-medium">{errorMsg}</span>
            </div>
          </div>
        )}

        {/* Domain Helper only shown if unauthorized domain error occurs */}
        {isUnauthorizedDomain && currentHostname && (
          <div className="mb-4 p-3.5 bg-amber-50/80 rounded-2xl border border-amber-200 text-[11px] text-amber-900 space-y-2 text-left">
            <div className="font-semibold text-amber-950 flex items-center justify-between">
              <span>{isEn ? 'Authorized Domain Needed:' : 'Domínio a autorizar no Firebase:'}</span>
              <button
                type="button"
                onClick={handleCopyHostname}
                className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-800 bg-white px-2 py-0.5 rounded-md border border-amber-300 hover:bg-amber-100 transition cursor-pointer"
              >
                {copiedDomain ? (
                  <>
                    <Check className="w-3 h-3 text-emerald-600" />
                    <span className="text-emerald-700">{isEn ? 'Copied!' : 'Copiado!'}</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3 h-3" />
                    <span>{isEn ? 'Copy' : 'Copiar'}</span>
                  </>
                )}
              </button>
            </div>
            <div className="p-1.5 bg-white rounded font-mono text-[10px] text-slate-800 select-all truncate border border-amber-200">
              {currentHostname}
            </div>
            <p className="text-[10px] text-amber-800 leading-tight">
              {isEn
                ? 'To authorize: Firebase Console > Authentication > Settings > Authorized Domains > Add domain.'
                : 'Para autorizar: Firebase Console > Authentication > Configurações > Domínios Autorizados > Adicionar o domínio.'}
            </p>
          </div>
        )}

        {/* Action: Single Clean Button to open Google Official Popup */}
        <div className="space-y-3">
          <button
            type="button"
            disabled={isLoading}
            onClick={handleGoogleAuth}
            className="w-full py-3.5 px-4 bg-[#1a73e8] hover:bg-[#1b66c9] active:scale-[0.99] text-white rounded-full font-bold text-sm transition shadow-sm cursor-pointer disabled:opacity-50 flex items-center justify-center gap-3"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                <span>{isEn ? 'Connecting to Google...' : 'Conectando ao Google...'}</span>
              </>
            ) : (
              <>
                <svg className="w-5 h-5 bg-white rounded-full p-0.5 shrink-0" viewBox="0 0 24 24">
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
              </>
            )}
          </button>

          <button
            type="button"
            onClick={onClose}
            className="w-full py-2 text-xs font-semibold text-slate-500 hover:text-slate-800 transition cursor-pointer"
          >
            {isEn ? 'Cancel' : 'Cancelar'}
          </button>
        </div>

        {/* Security badge */}
        <div className="mt-5 pt-3.5 border-t border-slate-100 flex items-center justify-center gap-1.5 text-[11px] text-slate-500">
          <ShieldCheck className="w-4 h-4 text-emerald-600" />
          <span>
            {isEn
              ? 'Official Google Verified Identity'
              : 'Identidade Google Verificada • Sem dados simulados'}
          </span>
        </div>
      </div>
    </div>
  );
};
