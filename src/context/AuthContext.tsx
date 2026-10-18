import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import {
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as firebaseAuthSignOut,
  onAuthStateChanged,
  User as FirebaseUser,
  GoogleAuthProvider,
} from 'firebase/auth';
import { doc, getDoc, setDoc, onSnapshot } from 'firebase/firestore';
import { auth, googleAuthProvider, getDb } from '../firebase';
import { GoogleAccount, UserProfile, UserRole, EnglishLevel, NativeFriendTutor } from '../types';
import { setGoogleOAuthToken, getGoogleOAuthToken, requestGoogleDriveAuth } from '../utils/auth';
import { DEFAULT_STUDENT_TIMEZONE } from '../utils/timezone';

export interface AuthUserDoc {
  uid: string;
  email: string;
  name: string;
  role: 'student' | 'native_friend' | 'teacher' | 'admin';
  nativeFriendUID?: string | null;
  teacherUid?: string | null;
  teacherEmail?: string | null;
  teacherName?: string | null;
  level?: EnglishLevel | string;
  studyPlan?: string;
  learningGoal?: string;
  weeklyStudyDaysTarget?: number;
  weeklyStudyDays?: string[];
  routineVideoTime?: string;
  routineAudioTime?: string;
  dailyPhraseTime?: string;
  contractedLessons?: number;
  completedLessonsCount?: number;
  avatar?: string;
  picture?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface AuthContextType {
  firebaseUser: FirebaseUser | null;
  currentAccount: GoogleAccount | null;
  userProfile: UserProfile | null;
  userRole: UserRole;
  isLoading: boolean;
  error: string | null;
  selectedRole: UserRole;
  setSelectedRole: (role: UserRole) => void;
  loginWithEmail: (
    email: string,
    pass: string,
    preferredRole?: UserRole
  ) => Promise<{
    success: boolean;
    role?: UserRole;
    account?: GoogleAccount;
    profile?: Partial<UserProfile>;
    tutor?: NativeFriendTutor;
    error?: string;
  }>;
  loginWithGoogle: (
    preferredRole?: UserRole
  ) => Promise<{
    success: boolean;
    role?: UserRole;
    account?: GoogleAccount;
    profile?: Partial<UserProfile>;
    error?: string;
  }>;
  logout: () => Promise<void>;
  fetchFirestoreUser: (uid: string, email?: string) => Promise<AuthUserDoc | null>;
  googleOAuthToken: string | null;
  connectGoogleDrive: (hintEmail?: string) => Promise<string | null>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Helper with timeout to prevent infinite freezes
function withTimeout<T>(promise: Promise<T>, ms = 4500): Promise<T | null> {
  let timer: any;
  const timeoutPromise = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  return Promise.race([
    promise
      .then((res) => {
        clearTimeout(timer);
        return res;
      })
      .catch((err) => {
        clearTimeout(timer);
        throw err;
      }),
    timeoutPromise,
  ]);
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [currentAccount, setCurrentAccount] = useState<GoogleAccount | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [selectedRole, setSelectedRole] = useState<UserRole>('student');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [googleOAuthToken, setGoogleOAuthTokenState] = useState<string | null>(getGoogleOAuthToken());

  const connectGoogleDrive = useCallback(async (hintEmail?: string): Promise<string | null> => {
    const targetEmail = hintEmail || currentAccount?.email || undefined;
    const token = await requestGoogleDriveAuth(targetEmail);
    if (token) {
      setGoogleOAuthToken(token);
      setGoogleOAuthTokenState(token);
    }
    return token;
  }, [currentAccount?.email]);

  // Fetch Firestore user doc by UID with fallback to emailDocId
  const fetchFirestoreUser = useCallback(async (uid: string, email?: string): Promise<AuthUserDoc | null> => {
    if (!uid && !email) return null;
    const db = getDb();
    try {
      if (uid) {
        const snap = await withTimeout(getDoc(doc(db, 'users', uid)), 3500);
        if (snap && snap.exists()) {
          return snap.data() as AuthUserDoc;
        }
      }
      if (email) {
        const cleanDocId = email.toLowerCase().trim().replace(/[^a-zA-Z0-9]/g, '-');
        const snapEmail = await withTimeout(getDoc(doc(db, 'users', cleanDocId)), 3500);
        if (snapEmail && snapEmail.exists()) {
          const emailData = snapEmail.data() as AuthUserDoc;
          if (uid) {
            await setDoc(
              doc(db, 'users', uid),
              {
                ...emailData,
                id: uid,
                uid: uid,
                email: (emailData.email || email).toLowerCase().trim(),
                updatedAt: new Date().toISOString(),
              },
              { merge: true }
            ).catch(() => null);
          }
          return emailData;
        }
      }
    } catch (err) {
      console.warn('Firestore fetch user error:', err);
    }
    return null;
  }, []);

  // Sync Firebase Auth session on mount and attach real-time onSnapshot listener to users/{user.uid}
  useEffect(() => {
    let userDocUnsub: (() => void) | null = null;

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (userDocUnsub) {
        userDocUnsub();
        userDocUnsub = null;
      }
      setFirebaseUser(user);

      if (user) {
        const cleanEmail = (user.email || '').toLowerCase().trim();

        // 1. Initial hydration using verified token claims and backend profile
        try {
          const tokenResult = await user.getIdTokenResult().catch(() => null);
          const claimRole = (tokenResult?.claims?.role as UserRole) || null;
          const idToken = await user.getIdToken().catch(() => null);

          let resolvedRole: UserRole = claimRole === 'admin' ? 'admin' : (claimRole === 'teacher' ? 'teacher' : 'student');

          if (idToken) {
            try {
              const verifyRes = await fetch('/api/auth/verify-session', {
                headers: { Authorization: `Bearer ${idToken}` },
              });
              if (verifyRes.ok) {
                const verifyData = await verifyRes.json();
                if (verifyData.role === 'admin' || verifyData.role === 'teacher' || verifyData.role === 'student') {
                  resolvedRole = verifyData.role;
                }
              }
            } catch {}
          }

          const acc: GoogleAccount = {
            uid: user.uid,
            email: cleanEmail,
            name: user.displayName || (cleanEmail ? cleanEmail.split('@')[0] : 'User'),
            role: resolvedRole,
            picture: user.photoURL || '',
          };
          setCurrentAccount(acc);

          // Fetch student profile via backend API if role is student
          if (resolvedRole === 'student' && idToken) {
            try {
              const profRes = await fetch(`/api/user-profile?email=${encodeURIComponent(cleanEmail)}&uid=${encodeURIComponent(user.uid)}`, {
                headers: { Authorization: `Bearer ${idToken}` },
              });
              if (profRes.ok) {
                const profData = await profRes.json();
                if (profData && typeof profData === 'object') {
                  setUserProfile((prev) => ({
                    ...(prev || {}),
                    ...profData,
                    id: user.uid,
                    uid: user.uid,
                  }));
                }
              }
            } catch {}
          }
        } catch (hydrationErr) {
          console.warn('Notice during user hydration:', hydrationErr);
          const acc: GoogleAccount = {
            uid: user.uid,
            email: cleanEmail,
            name: user.displayName || (cleanEmail ? cleanEmail.split('@')[0] : 'User'),
            role: 'student',
            picture: user.photoURL || '',
          };
          setCurrentAccount(acc);
        }
      } else {
        setCurrentAccount(null);
        setUserProfile(null);
        setGoogleOAuthToken(null);
        setGoogleOAuthTokenState(null);
      }
    });

    return () => {
      if (userDocUnsub) userDocUnsub();
      unsubscribe();
    };
  }, [fetchFirestoreUser]);

  // Dynamic Login with Email/Password using Firebase Authentication as single authority
  const loginWithEmail = async (
    emailInput: string,
    passInput: string,
    preferredRole: UserRole = 'student'
  ): Promise<{
    success: boolean;
    role?: UserRole;
    account?: GoogleAccount;
    profile?: Partial<UserProfile>;
    tutor?: NativeFriendTutor;
    error?: string;
  }> => {
    setIsLoading(true);
    setError(null);

    const cleanEmail = emailInput.toLowerCase().trim();

    try {
      // 1. Authenticate exclusively with Firebase Authentication
      let userCredential;
      try {
        userCredential = await signInWithEmailAndPassword(auth, cleanEmail, passInput);
      } catch (authErr: any) {
        const code = authErr?.code;
        const errMsg =
          code === 'auth/wrong-password' || code === 'auth/user-not-found' || code === 'auth/invalid-credential'
            ? 'E-mail ou senha inválidos.'
            : (authErr?.message || 'Falha ao autenticar no Firebase Authentication.');
        setError(errMsg);
        return { success: false, error: errMsg };
      }

      const authUid = userCredential.user.uid;
      const idToken = await userCredential.user.getIdToken();

      // 2. Authenticate with backend API endpoint using verified ID Token
      // Password is NEVER sent in payload, stored in state, or logged
      const backendPayload = {
        idToken,
        email: cleanEmail,
        role: preferredRole,
        uid: authUid,
      };

      const loginPromise = fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify(backendPayload),
      });

      const res = await withTimeout(loginPromise, 8000);

      if (!res) {
        throw new Error('Tempo de conexão esgotado ao contatar o servidor. Tente novamente.');
      }

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        const errMsg =
          errData.message ||
          errData.error ||
          (res.status === 401
            ? 'Conta não autorizada ou perfil não encontrado. Por favor, cadastre-se antes de fazer login.'
            : (res.status === 403
                ? 'Acesso negado: esta conta não possui privilégios de administrador ou a custom claim de administrador ainda não foi provisionada.'
                : 'Erro ao autenticar credenciais no servidor.'));
        await firebaseAuthSignOut(auth).catch(() => {});
        setError(errMsg);
        return { success: false, error: errMsg };
      }

      const data = await res.json();
      const account: GoogleAccount = data.account;
      const verifiedRole: UserRole = account.role as UserRole;

      if (preferredRole === 'admin' && verifiedRole !== 'admin') {
        await firebaseAuthSignOut(auth).catch(() => {});
        const errMsg = 'Acesso negado: a conta informada não possui privilégios de administrador.';
        setError(errMsg);
        return { success: false, error: errMsg };
      }

      if (verifiedRole === 'admin') {
        try {
          await userCredential.user.getIdToken(true);
        } catch {}
      }

      setCurrentAccount(account);

      let profile: Partial<UserProfile> | undefined = data.profile;
      if (verifiedRole === 'student') {
        profile = {
          ...(data.profile || {}),
          id: account.uid,
          name: account.name,
          email: account.email,
          nativeFriendUID: (data.profile as any)?.nativeFriendUID || null,
          teacherUid: (data.profile as any)?.teacherUid || null,
          teacherEmail: data.profile?.teacherEmail || null,
          teacherName: data.profile?.teacherName || null,
          level: data.profile?.level || EnglishLevel.BEGINNER,
          studyPlan: data.profile?.learningGoal || '',
          learningGoal: data.profile?.learningGoal || '',
          weeklyStudyDaysTarget: data.profile?.weeklyStudyDaysTarget ?? 7,
          weeklyStudyDays: data.profile?.weeklyStudyDays || [
            'monday',
            'tuesday',
            'wednesday',
            'thursday',
            'friday',
            'saturday',
            'sunday',
          ],
        };
        setUserProfile(profile as UserProfile);

        if (typeof window !== 'undefined') {
          try {
            window.history.replaceState({ page: 'dashboard' }, '', '/dashboard');
          } catch {}
        }
      } else if (verifiedRole === 'teacher') {
        setUserProfile(data.profile || null);
        if (typeof window !== 'undefined') {
          try {
            window.history.replaceState({ page: 'teacher' }, '', '/teacher');
          } catch {}
        }
      } else if (verifiedRole === 'admin') {
        setUserProfile(data.profile || null);
        if (typeof window !== 'undefined') {
          try {
            window.history.replaceState({ page: 'admin' }, '', '/admin');
          } catch {}
        }
      }

      return {
        success: true,
        role: verifiedRole,
        account,
        profile,
        tutor: data.tutor,
      };
    } catch (err: any) {
      const msg = err.message || 'Erro ao processar login.';
      setError(msg);
      return { success: false, error: msg };
    } finally {
      setIsLoading(false);
    }
  };

  // Dynamic Login with Google Popup and Firestore Role Verification
  const loginWithGoogle = async (
    preferredRole: UserRole = 'student'
  ): Promise<{
    success: boolean;
    role?: UserRole;
    account?: GoogleAccount;
    profile?: Partial<UserProfile>;
    error?: string;
  }> => {
    setIsLoading(true);
    setError(null);

    try {
      const result = await signInWithPopup(auth, googleAuthProvider);
      const user = result.user;

      const credential = GoogleAuthProvider.credentialFromResult(result);
      const googleOAuthAccessToken = credential?.accessToken || null;
      if (googleOAuthAccessToken) {
        setGoogleOAuthToken(googleOAuthAccessToken);
        setGoogleOAuthTokenState(googleOAuthAccessToken);
      }

      if (!user.email) {
        throw new Error('Nenhum e-mail verificado foi retornado pelo Google.');
      }

      const idToken = await user.getIdToken();

      // Synchronize with server backend using verified Firebase ID token
      const res = await withTimeout(
        fetch('/api/auth/google', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({
            idToken,
            uid: user.uid,
            email: user.email,
            name: user.displayName || user.email.split('@')[0],
            role: preferredRole,
            picture: user.photoURL || undefined,
          }),
        }),
        8000
      );

      if (!res || !res.ok) {
        const errData = res ? await res.json().catch(() => ({})) : {};
        throw new Error(errData.error || errData.message || 'Falha ao sincronizar perfil do Google.');
      }

      const data = await res.json();
      const account: GoogleAccount = data.account || {
        uid: user.uid,
        email: user.email,
        name: user.displayName || user.email.split('@')[0],
        role: preferredRole,
        picture: user.photoURL || '',
      };

      const targetRole = (account.role || preferredRole || 'student') as UserRole;
      setCurrentAccount(account);
      if (data.profile) {
        setUserProfile(data.profile);
      }

      // Redirection by verified role
      if (targetRole === 'student') {
        if (typeof window !== 'undefined') {
          try {
            window.history.replaceState({ page: 'dashboard' }, '', '/dashboard');
          } catch {}
        }
      } else if (targetRole === 'teacher') {
        if (typeof window !== 'undefined') {
          try {
            window.history.replaceState({ page: 'teacher' }, '', '/teacher');
          } catch {}
        }
      } else if (targetRole === 'admin') {
        if (typeof window !== 'undefined') {
          try {
            window.history.replaceState({ page: 'admin' }, '', '/admin');
          } catch {}
        }
      }

      return {
        success: true,
        role: targetRole,
        account,
        profile: data.profile,
      };
    } catch (err: any) {
      const errMsg = err.message || 'Erro ao autenticar com Google.';
      setError(errMsg);
      return { success: false, error: errMsg };
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async () => {
    try {
      await firebaseAuthSignOut(auth);
    } catch {
      // ignore
    }
    setGoogleOAuthToken(null);
    setGoogleOAuthTokenState(null);
    setCurrentAccount(null);
    setUserProfile(null);
    setSelectedRole('student');
  };

  return (
    <AuthContext.Provider
      value={{
        firebaseUser,
        currentAccount,
        userProfile,
        userRole: currentAccount?.role || 'student',
        isLoading,
        error,
        selectedRole,
        setSelectedRole,
        loginWithEmail,
        loginWithGoogle,
        logout,
        fetchFirestoreUser,
        googleOAuthToken,
        connectGoogleDrive,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) {
    return {
      firebaseUser: null,
      currentAccount: null,
      userProfile: null,
      userRole: 'student',
      isLoading: false,
      error: null,
      selectedRole: 'student',
      setSelectedRole: () => {},
      loginWithEmail: async () => ({ success: false, error: 'Auth context not available' }),
      loginWithGoogle: async () => ({ success: false, error: 'Auth context not available' }),
      logout: async () => {},
      fetchFirestoreUser: async () => null,
      googleOAuthToken: getGoogleOAuthToken(),
      connectGoogleDrive: async (hintEmail?: string) => {
        try {
          const token = await requestGoogleDriveAuth(hintEmail);
          if (token) setGoogleOAuthToken(token);
          return token;
        } catch {
          return null;
        }
      },
    };
  }
  return context;
};
