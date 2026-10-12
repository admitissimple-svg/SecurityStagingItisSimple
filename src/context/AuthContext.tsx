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
        const isMasterAdmin = cleanEmail === 'adm.itissimple@gmail.com';

        // 1. Initial hydration from Firestore
        let resolvedRole: UserRole = isMasterAdmin ? 'admin' : 'student';
        try {
          const docData = await fetchFirestoreUser(user.uid, user.email || undefined);
          resolvedRole = docData
            ? (docData.role === 'admin' || isMasterAdmin
                ? 'admin'
                : docData.role === 'teacher' || docData.role === 'native_friend'
                ? 'teacher'
                : 'student')
            : (isMasterAdmin ? 'admin' : 'student');

          // Always ensure student profile is created/saved at doc(db, 'users', user.uid) with user.uid as document key
          if (resolvedRole === 'student') {
            const db = getDb();
            if (db) {
              const studentProfilePayload = {
                id: user.uid,
                uid: user.uid,
                email: cleanEmail,
                name: docData?.name || user.displayName || cleanEmail.split('@')[0],
                role: 'student',
                picture: docData?.picture || docData?.avatar || user.photoURL || '',
                avatar: docData?.avatar || docData?.picture || user.photoURL || '',
                level: docData?.level || EnglishLevel.BEGINNER,
                ...(docData || {}),
                updatedAt: new Date().toISOString(),
              };
              await setDoc(doc(db, 'users', user.uid), studentProfilePayload, { merge: true }).catch(() => null);
            }
          }

          const acc: GoogleAccount = {
            uid: user.uid,
            email: cleanEmail,
            name: docData?.name || user.displayName || (cleanEmail ? cleanEmail.split('@')[0] : 'User'),
            role: resolvedRole,
            picture: docData?.picture || docData?.avatar || user.photoURL || '',
          };
          setCurrentAccount(acc);
        } catch (hydrationErr) {
          console.warn('Notice during user hydration:', hydrationErr);
          const acc: GoogleAccount = {
            uid: user.uid,
            email: cleanEmail,
            name: user.displayName || (cleanEmail ? cleanEmail.split('@')[0] : 'User'),
            role: isMasterAdmin ? 'admin' : 'student',
            picture: user.photoURL || '',
          };
          setCurrentAccount(acc);
        }

        // 2. Active multi-device real-time sync with onSnapshot tied to auth.currentUser.uid
        try {
          const db = getDb();
          const userDocRef = doc(db, 'users', user.uid);
          userDocUnsub = onSnapshot(
            userDocRef,
            (snap) => {
              if (snap.exists()) {
                const liveData = snap.data() as AuthUserDoc;
                const liveRole: UserRole = isMasterAdmin
                  ? 'admin'
                  : (liveData.role === 'teacher' || liveData.role === 'native_friend'
                      ? 'teacher'
                      : 'student');

                setCurrentAccount((prev) => ({
                  uid: user.uid,
                  email: cleanEmail,
                  name: liveData.name || prev?.name || user.displayName || cleanEmail.split('@')[0],
                  role: liveRole,
                  picture: liveData.picture || liveData.avatar || prev?.picture || user.photoURL || '',
                }));

                setUserProfile((prev) => ({
                  ...(prev || {
                    id: user.uid,
                    uid: user.uid,
                    email: cleanEmail,
                    name: liveData.name || user.displayName || cleanEmail.split('@')[0],
                    picture: liveData.picture || liveData.avatar || user.photoURL || '',
                    avatar: liveData.avatar || liveData.picture || user.photoURL || '',
                    level: (liveData.level as any) || EnglishLevel.BEGINNER,
                    streakDays: 0,
                    streakCount: 0,
                    points: 0,
                    dailyGoalMinutes: 30,
                    completedTodayMinutes: 0,
                    targetAudienceCategory: 'general',
                    timezone: DEFAULT_STUDENT_TIMEZONE,
                  }),
                  ...(liveData as any),
                  id: user.uid,
                  uid: user.uid,
                }));
              }
            },
            (snapshotError) => {
              console.error('[Firestore onSnapshot user error]:', snapshotError);
            }
          );
        } catch (subErr) {
          console.error('[Firestore onSnapshot setup error]:', subErr);
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

  // Dynamic Login with Email/Password and Firestore Role Verification
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
      // 1. Firebase Auth Sign-In
      let authUid: string | undefined;
      try {
        const userCredential = await signInWithEmailAndPassword(auth, cleanEmail, passInput);
        authUid = userCredential.user.uid;
      } catch (authErr: any) {
        console.log('Firebase Auth attempt:', authErr?.code || authErr?.message);
        // Continue to server verification which supports master admin and fallback credentials
      }

      // 2. Fetch User Document from Firestore by UID
      let firestoreDoc: AuthUserDoc | null = null;
      if (authUid) {
        firestoreDoc = await fetchFirestoreUser(authUid, cleanEmail);
      } else {
        firestoreDoc = await fetchFirestoreUser('', cleanEmail);
      }

      // 3. Authenticate with backend API endpoint with timeout safety
      const backendPayload = {
        email: cleanEmail,
        password: passInput,
        role: firestoreDoc?.role || preferredRole || 'student',
        uid: authUid,
      };

      const loginPromise = fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(backendPayload),
      });

      const res = await withTimeout(loginPromise, 6000);

      if (!res) {
        throw new Error('Tempo de conexão esgotado ao contatar o servidor. Tente novamente.');
      }

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        const errMsg =
          errData.error ||
          (res.status === 401
            ? 'Perfil não encontrado. Por favor, cadastre-se antes de fazer login.'
            : 'Erro ao autenticar credenciais.');
        setError(errMsg);
        return { success: false, error: errMsg };
      }

      const data = await res.json();
      const account: GoogleAccount = data.account;

      // 4. Determine verified role strictly from Firestore doc (source of truth)
      const docRole = (firestoreDoc?.role || '').toLowerCase();
      let verifiedRole: UserRole = 'student';

      if (cleanEmail === 'adm.itissimple@gmail.com') {
        verifiedRole = 'admin';
      } else if (docRole === 'student' || account.role === 'student') {
        // STRICT RBAC: Registered student locked strictly to student role
        verifiedRole = 'student';
      } else if (docRole === 'native_friend' || docRole === 'teacher' || account.role === 'teacher') {
        verifiedRole = 'teacher';
      } else if (docRole === 'admin') {
        verifiedRole = cleanEmail === 'adm.itissimple@gmail.com' ? 'admin' : 'student';
      } else {
        verifiedRole = account.role || 'student';
      }

      account.role = verifiedRole;
      setCurrentAccount(account);

      // Hydrate student profile with routine state, level, study plan, and unique Native Friend link (nativeFriendUID)
      let profile: Partial<UserProfile> | undefined = data.profile;
      if (verifiedRole === 'student') {
        profile = {
          ...(data.profile || {}),
          id: account.uid,
          name: account.name,
          email: account.email,
          nativeFriendUID: firestoreDoc?.nativeFriendUID || firestoreDoc?.teacherUid || (data.profile as any)?.nativeFriendUID || null,
          teacherUid: firestoreDoc?.teacherUid || firestoreDoc?.nativeFriendUID || (data.profile as any)?.teacherUid || null,
          teacherEmail: firestoreDoc?.teacherEmail || data.profile?.teacherEmail || null,
          teacherName: firestoreDoc?.teacherName || data.profile?.teacherName || null,
          level: (firestoreDoc?.level as any) || data.profile?.level || EnglishLevel.BEGINNER,
          studyPlan: firestoreDoc?.studyPlan || firestoreDoc?.learningGoal || data.profile?.learningGoal || '',
          learningGoal: firestoreDoc?.learningGoal || data.profile?.learningGoal || '',
          weeklyStudyDaysTarget: firestoreDoc?.weeklyStudyDaysTarget ?? data.profile?.weeklyStudyDaysTarget ?? 7,
          weeklyStudyDays: firestoreDoc?.weeklyStudyDays || data.profile?.weeklyStudyDays || [
            'monday',
            'tuesday',
            'wednesday',
            'thursday',
            'friday',
            'saturday',
            'sunday',
          ],
          routineVideoTime: firestoreDoc?.routineVideoTime || data.profile?.routineVideoTime || '09:00',
          routineAudioTime: firestoreDoc?.routineAudioTime || data.profile?.routineAudioTime || '14:00',
          dailyPhraseTime: firestoreDoc?.dailyPhraseTime || data.profile?.dailyPhraseTime || '20:00',
        };

        // Direct persistence to users/{studentUidToSave} ensuring Auth UID is the document ID
        const studentUidToSave = authUid || account.uid;
        if (studentUidToSave) {
          const db = getDb();
          if (db) {
            const studentPayload = {
              id: studentUidToSave,
              uid: studentUidToSave,
              email: cleanEmail,
              name: account.name,
              role: 'student',
              ...(profile || {}),
              updatedAt: new Date().toISOString(),
            };
            setDoc(doc(db, 'users', studentUidToSave), studentPayload, { merge: true }).catch(() => null);
          }
        }

        // Redirection INSTANTLY to Student Dashboard (/dashboard)
        if (typeof window !== 'undefined') {
          try {
            window.history.replaceState({ page: 'dashboard' }, '', '/dashboard');
          } catch {}
        }
      } else if (verifiedRole === 'teacher') {
        // Redirection to Native Friend Panel (/teacher)
        if (typeof window !== 'undefined') {
          try {
            window.history.replaceState({ page: 'teacher' }, '', '/teacher');
          } catch {}
        }
      } else if (verifiedRole === 'admin') {
        // Redirection to Administrator Panel (/admin)
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

      // Check Firestore doc by UID
      const firestoreDoc = await fetchFirestoreUser(user.uid, user.email);

      const cleanGoogleEmail = user.email.toLowerCase().trim();
      const isMasterAdmin = cleanGoogleEmail === 'adm.itissimple@gmail.com';
      const docRole = (firestoreDoc?.role || '').toLowerCase();
      let targetRole: UserRole = 'student';

      if (isMasterAdmin) {
        targetRole = 'admin';
      } else if (docRole === 'student') {
        // STRICT RBAC: Registered student locked strictly to student space
        targetRole = 'student';
      } else if (docRole === 'teacher' || docRole === 'native_friend') {
        targetRole = 'teacher';
      } else if (docRole === 'admin') {
        targetRole = isMasterAdmin ? 'admin' : 'student';
      } else {
        targetRole = preferredRole === 'teacher' ? 'teacher' : 'student';
      }

      // Synchronize with server backend
      const res = await withTimeout(
        fetch('/api/auth/google', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            uid: user.uid,
            email: user.email,
            name: user.displayName || user.email.split('@')[0],
            role: targetRole,
            picture: user.photoURL || undefined,
          }),
        }),
        6000
      );

      if (!res || !res.ok) {
        const errData = res ? await res.json().catch(() => ({})) : {};
        throw new Error(errData.error || 'Falha ao sincronizar perfil do Google.');
      }

      const data = await res.json();
      const account: GoogleAccount = data.account || {
        uid: user.uid,
        email: user.email,
        name: user.displayName || user.email.split('@')[0],
        role: targetRole,
        picture: user.photoURL || '',
      };

      // Strict role enforcement
      if (docRole === 'student' || data.isRoleEnforced || account.role === 'student' || targetRole === 'student') {
        if (!isMasterAdmin) {
          targetRole = 'student';
          account.role = 'student';
        }
      } else {
        account.role = targetRole;
      }
      setCurrentAccount(account);

      // Guarantee student profile in Firestore is created/saved strictly under doc(db, 'users', user.uid)
      if (targetRole === 'student' && user.uid) {
        const db = getDb();
        if (db) {
          const studentDoc = {
            id: user.uid,
            uid: user.uid,
            email: cleanGoogleEmail,
            name: account.name,
            role: 'student',
            picture: account.picture || '',
            avatar: account.picture || '',
            level: firestoreDoc?.level || data.profile?.level || EnglishLevel.BEGINNER,
            ...(firestoreDoc || {}),
            ...(data.profile || {}),
            updatedAt: new Date().toISOString(),
          };
          setDoc(doc(db, 'users', user.uid), studentDoc, { merge: true }).catch(() => null);
        }
      }

      // Strict Redirection by verified role
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
