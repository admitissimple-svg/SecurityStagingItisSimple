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
  Clock,
  ShieldCheck,
  Globe,
  DollarSign,
  Video,
  KeyRound,
} from 'lucide-react';
import {
  GoogleAccount,
  EnglishLevel,
  Language,
  UserRole,
  UserProfile,
  NativeFriendTutor,
} from '../types';
import { BrandLogo } from './BrandLogo';
import { GoogleSignInModal } from './GoogleSignInModal';
import { ImageUploadInput } from './ImageUploadInput';
import { firebaseSignInWithEmail, firebaseSignUpWithEmail } from '../utils/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { getDb } from '../firebase';

const TIME_OPTIONS = [
  { value: '06:00', label: '06:00 AM' },
  { value: '06:30', label: '06:30 AM' },
  { value: '07:00', label: '07:00 AM' },
  { value: '07:30', label: '07:30 AM' },
  { value: '08:00', label: '08:00 AM' },
  { value: '08:30', label: '08:30 AM' },
  { value: '09:00', label: '09:00 AM' },
  { value: '09:30', label: '09:30 AM' },
  { value: '10:00', label: '10:00 AM' },
  { value: '10:30', label: '10:30 AM' },
  { value: '11:00', label: '11:00 AM' },
  { value: '11:30', label: '11:30 AM' },
  { value: '12:00', label: '12:00 PM' },
  { value: '12:30', label: '12:30 PM' },
  { value: '13:00', label: '01:00 PM' },
  { value: '13:30', label: '01:30 PM' },
  { value: '14:00', label: '02:00 PM' },
  { value: '14:30', label: '02:30 PM' },
  { value: '15:00', label: '03:00 PM' },
  { value: '15:30', label: '03:30 PM' },
  { value: '16:00', label: '04:00 PM' },
  { value: '16:30', label: '04:30 PM' },
  { value: '17:00', label: '05:00 PM' },
  { value: '17:30', label: '05:30 PM' },
  { value: '18:00', label: '06:00 PM' },
  { value: '18:30', label: '06:30 PM' },
  { value: '19:00', label: '07:00 PM' },
  { value: '19:30', label: '07:30 PM' },
  { value: '20:00', label: '08:00 PM' },
  { value: '20:30', label: '08:30 PM' },
  { value: '21:00', label: '09:00 PM' },
  { value: '21:30', label: '09:30 PM' },
  { value: '22:00', label: '10:00 PM' },
  { value: '22:30', label: '10:30 PM' },
  { value: '23:00', label: '11:00 PM' },
];

const COUNTRY_OPTIONS = [
  { name: 'United States', flag: '🇺🇸', code: 'US', defaultAccent: 'North American' },
  { name: 'Canada', flag: '🇨🇦', code: 'CA', defaultAccent: 'North American' },
  { name: 'United Kingdom', flag: '🇬🇧', code: 'GB', defaultAccent: 'British' },
  { name: 'Australia', flag: '🇦🇺', code: 'AU', defaultAccent: 'Australian' },
  { name: 'Ireland', flag: '🇮🇪', code: 'IE', defaultAccent: 'Irish' },
  { name: 'New Zealand', flag: '🇳🇿', code: 'NZ', defaultAccent: 'Neutral' },
  { name: 'South Africa', flag: '🇿🇦', code: 'ZA', defaultAccent: 'South African' },
];

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialMode?: 'login' | 'signup';
  initialRole?: UserRole;
  initialEmail?: string;
  currentLanguage: Language;
  onShowToast?: (title: string, message: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
  onLoginSuccess: (
    account: GoogleAccount,
    initialProfile?: Partial<UserProfile>,
    tutorData?: NativeFriendTutor
  ) => void;
  onOpenOnboarding?: (email?: string) => void;
}

const ROLE_LABELS: Record<
  Language,
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
  es: {
    student: 'Tu acceso',
    studentDesc: 'Viviendo el inglés día a día',
    teacher: 'Amigo Nativo',
    teacherDesc: 'Mentoría y conversación real',
    admin: 'Administrador',
    adminDesc: 'Panel y aprobaciones',
    accessAs: 'Selecciona tu perfil:',
  },
  fr: {
    student: 'Votre accès',
    studentDesc: "Vivre l'anglais au quotidien",
    teacher: 'Ami Natif',
    teacherDesc: 'Mentorat et conversation réelle',
    admin: 'Administrateur',
    adminDesc: 'Gestion et approbations',
    accessAs: 'Sélectionnez votre profil :',
  },
  de: {
    student: 'Ihr Zugang',
    studentDesc: 'Englisch im Alltag leben',
    teacher: 'Muttersprachler',
    teacherDesc: 'Mentoring & Konversation',
    admin: 'Administrator',
    adminDesc: 'Verwaltung & Freigaben',
    accessAs: 'Zugriffstyp auswählen:',
  },
  it: {
    student: 'Il tuo accesso',
    studentDesc: "Vivere l'inglese ogni giorno",
    teacher: 'Amico Madrelingua',
    teacherDesc: 'Mentoring e conversazione reale',
    admin: 'Amministratore',
    adminDesc: 'Pannello e approvazioni',
    accessAs: 'Seleziona profilo:',
  },
  ja: {
    student: 'あなたのアクセス',
    studentDesc: '日常生活で英語を生きる',
    teacher: 'ネイティブの友達',
    teacherDesc: 'メンタリング＆リアル会話',
    admin: '管理者',
    adminDesc: '管理パネルと承認',
    accessAs: 'アクセス種別を選択:',
  },
  ko: {
    student: '나의 접속',
    studentDesc: '일상 속에서 영어를 실천',
    teacher: '원어민 친구',
    teacherDesc: '멘토링 및 실전 대화',
    admin: '관리자',
    adminDesc: '관리 패널 및 승인',
    accessAs: '접속 유형 선택:',
  },
  zh: {
    student: '您的访问',
    studentDesc: '在日常生活中体验英语',
    teacher: '母语朋友',
    teacherDesc: '导师指导与真实对话',
    admin: '管理员',
    adminDesc: '管理面板与审批',
    accessAs: '请选择身份：',
  },
  ru: {
    student: 'Ваш доступ',
    studentDesc: 'Жизнь на английском каждый день',
    teacher: 'Носитель языка',
    teacherDesc: 'Менторство и живой диалог',
    admin: 'Администратор',
    adminDesc: 'Панель и одобрения',
    accessAs: 'Войти как:',
  },
  ar: {
    student: 'وصولك',
    studentDesc: 'عِش الإنجليزية كل يوم',
    teacher: 'صديق ناطق أصلي',
    teacherDesc: 'إرشاد ومحادثة حقيقية',
    admin: 'المشرف',
    adminDesc: 'لوحة الإدارة والموافقات',
    accessAs: 'اختر حسابك:',
  },
  tr: {
    student: 'Erişiminiz',
    studentDesc: 'Her gün İngilizceyi yaşayın',
    teacher: 'Anadili İngilizce Olan Arkadaş',
    teacherDesc: 'Mentörlük ve gerçek sohbet',
    admin: 'Yönetici',
    adminDesc: 'Yönetim ve onaylar',
    accessAs: 'Profil seçin:',
  },
};

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  onClose,
  initialMode = 'login',
  initialRole = 'student',
  initialEmail = '',
  currentLanguage,
  onShowToast,
  onLoginSuccess,
  onOpenOnboarding,
}) => {
  const isEn = currentLanguage === 'en';
  const roleText = ROLE_LABELS[currentLanguage] || ROLE_LABELS.pt;
  const [mode, setMode] = useState<'login' | 'signup'>(initialMode);
  const [role, setRole] = useState<UserRole>(initialRole);
  const [name, setName] = useState('');
  const [email, setEmail] = useState(initialEmail || '');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Student specific state
  const [level, setLevel] = useState<EnglishLevel>(EnglishLevel.BEGINNER);
  const [learningGoal, setLearningGoal] = useState('');
  const [routineVideoTime, setRoutineVideoTime] = useState('');
  const [routineAudioTime, setRoutineAudioTime] = useState('');
  const [dailyPhraseTime, setDailyPhraseTime] = useState('');

  // Tutor (Amigo Nativo) specific state
  const [selectedCountry, setSelectedCountry] = useState('');
  const [countryCode, setCountryCode] = useState('');
  const [countryFlag, setCountryFlag] = useState('');
  const [accent, setAccent] = useState('');
  const [headline, setHeadline] = useState('');
  const [bio, setBio] = useState('');
  const [priceUsd, setPriceUsd] = useState<number | ''>('');
  const [meetUrl, setMeetUrl] = useState('');
  const [avatar, setAvatar] = useState('');
  const [videoIntroUrl, setVideoIntroUrl] = useState('');
  const [specialties, setSpecialties] = useState('');

  // Admin status check state
  const [hasExistingAdmin, setHasExistingAdmin] = useState(false);
  const [adminEmail, setAdminEmail] = useState('');

  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showGoogleSignIn, setShowGoogleSignIn] = useState(false);

  // Reset password mode
  const [isResetMode, setIsResetMode] = useState(false);
  const [newPasswordInput, setNewPasswordInput] = useState('');
  const [resetError, setResetError] = useState('');
  const [resetSuccess, setResetSuccess] = useState('');
  const [isSubmittingReset, setIsSubmittingReset] = useState(false);

  // Duplicate checks state for realtime feedback
  const [emailWarning, setEmailWarning] = useState('');
  const [nameWarning, setNameWarning] = useState('');
  const [isCheckingEmail, setIsCheckingEmail] = useState(false);
  const [isCheckingName, setIsCheckingName] = useState(false);

  const checkDuplicateEmail = async (emailToCheck: string) => {
    const clean = emailToCheck.trim().toLowerCase();
    if (!clean || !clean.includes('@') || mode !== 'signup') {
      setEmailWarning('');
      return;
    }
    setIsCheckingEmail(true);
    try {
      const res = await fetch(`/api/auth/check-user?email=${encodeURIComponent(clean)}&role=${role}`);
      if (res.ok) {
        const data = await res.json();
        if (data.emailExists) {
          setEmailWarning(
            isEn
              ? 'This email is already registered. Please log in.'
              : 'Este e-mail já possui uma conta cadastrada.'
          );
        } else {
          setEmailWarning('');
        }
      }
    } catch {
      // ignore
    } finally {
      setIsCheckingEmail(false);
    }
  };

  const checkDuplicateName = async (nameToCheck: string) => {
    const clean = nameToCheck.trim();
    if (!clean || clean.length < 3 || mode !== 'signup') {
      setNameWarning('');
      return;
    }
    setIsCheckingName(true);
    try {
      const res = await fetch(`/api/auth/check-user?name=${encodeURIComponent(clean)}&role=${role}`);
      if (res.ok) {
        const data = await res.json();
        if (data.nameExists) {
          setNameWarning(
            isEn
              ? `A user with the name "${clean}" already exists. Please include your full surname to ensure unique identification.`
              : `Já existe um cadastro com o nome "${clean}". Por favor, informe seu nome completo e sobrenome para garantir identificação individual.`
          );
        } else {
          setNameWarning('');
        }
      }
    } catch {
      // ignore
    } finally {
      setIsCheckingName(false);
    }
  };

  useEffect(() => {
    if (initialEmail && initialEmail.trim()) {
      setEmail(initialEmail.trim());
    }
  }, [initialEmail]);

  useEffect(() => {
    if (isOpen) {
      setMode(initialMode || 'login');
      // Initialize with initialRole if provided, otherwise 'student'
      setRole(initialRole || 'student');
      setErrorMsg('');
      setSuccessMsg('');
      setIsLoading(false);
      if (initialEmail && initialEmail.trim()) {
        setEmail(initialEmail.trim());
      }

      // If URL is stuck on /admin from a previous session, clean it up
      if (typeof window !== 'undefined' && window.location.pathname === '/admin') {
        try {
          window.history.replaceState({}, '', '/');
        } catch {}
      }

      // Check if admin already exists to guide user properly
      fetch('/api/auth/admin-status')
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data) {
            setHasExistingAdmin(!!data.hasAdmin);
            setAdminEmail(data.adminEmail || '');
          }
        })
        .catch(() => {});
    }
  }, [isOpen, initialMode, initialRole]);

  // Support ESC key to dismiss registration/login modal easily
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

  const handleCountryChange = (countryName: string) => {
    if (!countryName) {
      setSelectedCountry('');
      setCountryCode('');
      setCountryFlag('');
      setAccent('');
      return;
    }
    const found = COUNTRY_OPTIONS.find((c) => c.name === countryName);
    if (found) {
      setSelectedCountry(found.name);
      setCountryCode(found.code);
      setCountryFlag(found.flag);
      setAccent(found.defaultAccent);
    }
  };

  const handleGoogleLogin = () => {
    setShowGoogleSignIn(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');

    if (!email || !password) {
      setErrorMsg(isEn ? 'Please fill in email and password' : 'Por favor, preencha o e-mail e a senha');
      return;
    }

    const cleanEmail = email.toLowerCase().trim();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(cleanEmail)) {
      setErrorMsg(
        isEn
          ? 'Please provide a valid email address (e.g. user@domain.com).'
          : 'Por favor, informe um endereço de e-mail válido (ex: seu.nome@dominio.com).'
      );
      return;
    }

    if (password.length < 6) {
      setErrorMsg(
        isEn ? 'Password must be at least 6 characters long.' : 'A senha deve conter no mínimo 6 caracteres.'
      );
      return;
    }

    if (mode === 'signup' && !name) {
      setErrorMsg(isEn ? 'Please enter your full name' : 'Por favor, informe o seu nome completo');
      return;
    }

    if (mode === 'signup' && role === 'admin' && hasExistingAdmin) {
      setErrorMsg(
        isEn
          ? 'An administrator account already exists. Only 1 administrator is permitted.'
          : 'Já existe um Administrador cadastrado na plataforma. Só é permitido um único Administrador. Acesse pelo Login.'
      );
      return;
    }

    if (mode === 'signup' && emailWarning) {
      const toastMsg = isEn ? 'This email is already registered.' : 'Este e-mail já possui uma conta cadastrada.';
      if (onShowToast) {
        onShowToast(isEn ? 'Account exists' : 'Conta já cadastrada', toastMsg, 'warning');
      }
      setMode('login');
      setPassword('');
      setErrorMsg(toastMsg);
      return;
    }

    if (mode === 'signup' && nameWarning) {
      setErrorMsg(nameWarning);
      return;
    }

    setIsLoading(true);

    try {
      if (mode === 'signup') {
        // Attempt Firebase Auth account creation to generate real UID
        let firebaseUid: string | undefined;
        try {
          const fbAuth = await firebaseSignUpWithEmail(cleanEmail, password);
          firebaseUid = fbAuth.user.uid;
        } catch (fbErr: any) {
          // If already exists in Firebase Auth, proceed to backend verification
          console.log('Firebase signup notice:', fbErr?.message || fbErr);
        }

        const payload: Record<string, any> = {
          uid: firebaseUid,
          name,
          email: cleanEmail,
          password,
          role,
        };

        if (role === 'student') {
          payload.englishLevel = level;
          payload.learningGoal = learningGoal;
          payload.routineVideoTime = routineVideoTime;
          payload.routineAudioTime = routineAudioTime;
          payload.dailyPhraseTime = dailyPhraseTime;
        } else if (role === 'teacher') {
          payload.avatar = avatar;
          payload.country = selectedCountry;
          payload.countryCode = countryCode;
          payload.flag = countryFlag;
          payload.accent = accent;
          payload.headline = headline;
          payload.bio = bio;
          payload.pricePerSessionUsd = Number(priceUsd) || 20;
          payload.meetUrl = meetUrl;
          payload.videoIntroUrl = videoIntroUrl;
          payload.specialties = specialties
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
        }

        const res = await fetch('/api/auth/signup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (res.ok) {
          const data = await res.json();
          if (role === 'teacher') {
            setSuccessMsg(
              isEn
                ? 'Native Friend account registered! Profile saved and pending Admin approval.'
                : 'Cadastro de Amigo Nativo realizado! Seus dados foram carregados no seu perfil e aguardam aprovação do Administrador.'
            );
            setTimeout(() => {
              onLoginSuccess(data.account, undefined, data.tutor);
              onClose();
            }, 800);
          } else if (role === 'admin') {
            setSuccessMsg(isEn ? 'Administrator registered successfully!' : 'Administrador cadastrado com sucesso!');
            setHasExistingAdmin(true);
            setTimeout(() => {
              onLoginSuccess(data.account);
              onClose();
            }, 800);
          } else {
            setSuccessMsg(isEn ? 'Student account created successfully!' : 'Conta de aluno(a) criada com sucesso!');
            const builtProfile: Partial<UserProfile> = data.profile || {
              name,
              email: cleanEmail,
              level,
              learningGoal,
              routineVideoTime,
              routineAudioTime,
              dailyPhraseTime,
            };

            const targetStudentUid = firebaseUid || data.account?.uid || '';
            if (targetStudentUid) {
              const db = getDb();
              if (db) {
                setDoc(
                  doc(db, 'users', targetStudentUid),
                  {
                    ...builtProfile,
                    id: targetStudentUid,
                    uid: targetStudentUid,
                    email: cleanEmail,
                    role: 'student',
                    updatedAt: new Date().toISOString(),
                  },
                  { merge: true }
                ).catch(() => null);
              }
            }

            setTimeout(() => {
              onLoginSuccess(data.account, builtProfile);
              onClose();
            }, 600);
          }
        } else {
          const errData = await res.json().catch(() => ({}));
          if (res.status === 409) {
            const toastMsg = isEn ? 'This email is already registered.' : 'Este e-mail já possui uma conta cadastrada.';
            if (onShowToast) {
              onShowToast(isEn ? 'Account exists' : 'Conta já cadastrada', toastMsg, 'warning');
            }
            setMode('login');
            setPassword('');
            setErrorMsg(toastMsg);
            return;
          } else if (res.status === 403) {
            setErrorMsg(
              errData.error ||
                'Já existe um Administrador cadastrado no sistema. Só é permitido um único Administrador.'
            );
          } else {
            setErrorMsg(errData.error || (isEn ? 'Failed to create account' : 'Erro ao criar conta'));
          }
        }
      } else {
        // Mode === 'login'
        // 1. Authenticate user in Firebase Auth and obtain UID
        let firebaseUid: string | undefined;
        try {
          const authResult = await firebaseSignInWithEmail(cleanEmail, password);
          firebaseUid = authResult?.user?.uid;
        } catch (authErr: any) {
          console.warn('Firebase Auth sign-in notice in AuthModal (will fallback to backend DB check):', authErr?.code || authErr?.message);
        }

        // 2. Query user document in 'users' collection in Firestore using the authenticated UID
        let firestoreUserDoc: any = null;
        const firestoreDb = getDb();

        if (firebaseUid) {
          try {
            const userDocRef = doc(firestoreDb, 'users', firebaseUid);
            const snap = await Promise.race([
              getDoc(userDocRef),
              new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000)),
            ]);
            if (snap && 'exists' in snap && snap.exists()) {
              firestoreUserDoc = snap.data();
            }
          } catch (fsErr) {
            console.warn('Firestore user fetch notice in AuthModal:', fsErr);
          }
        }

        // Fallback: Query by sanitized email doc ID in users collection if not found by UID
        if (!firestoreUserDoc && cleanEmail) {
          try {
            const cleanDocId = cleanEmail.replace(/[^a-zA-Z0-9]/g, '-');
            const emailDocRef = doc(firestoreDb, 'users', cleanDocId);
            const snapEmail = await Promise.race([
              getDoc(emailDocRef),
              new Promise<null>((resolve) => setTimeout(() => resolve(null), 2500)),
            ]);
            if (snapEmail && 'exists' in snapEmail && snapEmail.exists()) {
              firestoreUserDoc = snapEmail.data();
            }
          } catch (fsErr) {
            console.warn('Firestore user fetch by email notice in AuthModal:', fsErr);
          }
        }

        // Check tutor document in /tutors or /users with tutor prefix
        if (!firestoreUserDoc && cleanEmail) {
          try {
            const cleanTutorId = `tutor-${cleanEmail.replace(/[^a-zA-Z0-9]/g, '-')}`;
            const tutorSnap = await getDoc(doc(firestoreDb, 'tutors', cleanTutorId)).catch(() => null);
            if (tutorSnap && tutorSnap.exists()) {
              firestoreUserDoc = { ...tutorSnap.data(), role: 'teacher' };
            } else {
              const userTutorSnap = await getDoc(doc(firestoreDb, 'users', cleanTutorId)).catch(() => null);
              if (userTutorSnap && userTutorSnap.exists()) {
                firestoreUserDoc = { ...userTutorSnap.data(), role: 'teacher' };
              }
            }
          } catch {}
        }

        // 3. Read role field corresponding to user's role ('teacher', 'native_friend', 'admin', 'student')
        const docRole = (firestoreUserDoc?.role || firestoreUserDoc?.userRole || '').toLowerCase().trim();
        let verifiedRole: UserRole = 'student';

        if (cleanEmail === 'adm.itissimple@gmail.com' || docRole === 'admin') {
          verifiedRole = 'admin';
        } else if (docRole === 'teacher' || docRole === 'native_friend' || docRole === 'tutor') {
          verifiedRole = 'teacher';
        } else if (docRole === 'student') {
          verifiedRole = 'student';
        } else {
          // Fallback: if Firestore document does not explicitly specify role, align with selected tab if teacher or admin, else default to student
          verifiedRole = role === 'teacher' || role === 'admin' ? role : 'student';
        }

        // 4. Synchronize role selection tab state with the authenticated user role
        setRole(verifiedRole);

        // 5. Sync with backend API
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 6000);

        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: cleanEmail,
            password,
            role: verifiedRole,
            uid: firebaseUid || firestoreUserDoc?.uid,
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

        if (res.ok) {
          const data = await res.json();
          const serverRole = (data.account?.role || (data.isTeacher ? 'teacher' : '') || '').toLowerCase();
          if (serverRole === 'teacher' || serverRole === 'admin') {
            verifiedRole = serverRole as UserRole;
            setRole(verifiedRole);
          }

          const account: GoogleAccount = data.account || {
            uid: firebaseUid || firestoreUserDoc?.uid || `usr-${cleanEmail.replace(/[^a-zA-Z0-9]/g, '-')}`,
            email: cleanEmail,
            name: firestoreUserDoc?.name || cleanEmail.split('@')[0],
            role: verifiedRole,
          };

          const effectiveAuthUid = firebaseUid || firestoreUserDoc?.uid || account?.uid || '';
          if (effectiveAuthUid) {
            account.uid = effectiveAuthUid;
            account.id = effectiveAuthUid;
          }
          account.role = verifiedRole;

          // 6. Conditional redirection strictly based on verifiedRole:
          // - Teacher / Native Friend -> /teacher (Native Friend / Teacher Panel)
          // - Administrator -> /admin (Administrator Panel)
          // - Student -> /dashboard (Student Space)
          let resolvedProfile: Partial<UserProfile> | undefined = undefined;

          if (verifiedRole === 'teacher') {
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
          } else {
            // Student space
            resolvedProfile = {
              ...(data.profile || {}),
              id: account.uid,
              uid: account.uid,
              name: account.name,
              email: account.email,
              nativeFriendUID:
                firestoreUserDoc?.nativeFriendUID ||
                firestoreUserDoc?.teacherUid ||
                (data.profile as any)?.nativeFriendUID ||
                null,
              teacherUid:
                firestoreUserDoc?.teacherUid ||
                firestoreUserDoc?.nativeFriendUID ||
                (data.profile as any)?.teacherUid ||
                null,
              teacherEmail: firestoreUserDoc?.teacherEmail || data.profile?.teacherEmail || null,
              teacherName: firestoreUserDoc?.teacherName || data.profile?.teacherName || null,
              level: firestoreUserDoc?.level || data.profile?.level,
              studyPlan: firestoreUserDoc?.studyPlan || firestoreUserDoc?.learningGoal || data.profile?.learningGoal || '',
              learningGoal: firestoreUserDoc?.learningGoal || data.profile?.learningGoal || '',
              weeklyStudyDaysTarget: firestoreUserDoc?.weeklyStudyDaysTarget ?? data.profile?.weeklyStudyDaysTarget ?? 7,
              weeklyStudyDays: firestoreUserDoc?.weeklyStudyDays || data.profile?.weeklyStudyDays,
            };

            const targetStudentUid = account.uid || firebaseUid || '';
            if (targetStudentUid) {
              const db = getDb();
              if (db) {
                setDoc(
                  doc(db, 'users', targetStudentUid),
                  {
                    ...resolvedProfile,
                    id: targetStudentUid,
                    uid: targetStudentUid,
                    email: cleanEmail,
                    role: 'student',
                    updatedAt: new Date().toISOString(),
                  },
                  { merge: true }
                ).catch(() => null);
              }
            }

            if (typeof window !== 'undefined') {
              try {
                window.history.replaceState({ page: 'dashboard' }, '', '/dashboard');
              } catch {}
            }
          }

          setIsLoading(false);
          const tutorPayload = data.tutor || (verifiedRole === 'teacher' ? (firestoreUserDoc || { email: cleanEmail, name: account.name, role: 'teacher' }) : undefined);
          onLoginSuccess(account, resolvedProfile, tutorPayload);
          onClose();
        } else {
          const errData = await res.json().catch(() => ({}));
          const userFriendlyError =
            errData.error ||
            (res.status === 401
              ? (isEn
                  ? 'Profile not found. Please register your account.'
                  : 'Perfil não encontrado. Por favor, cadastre-se.')
              : (isEn ? 'Invalid email or password.' : 'E-mail ou senha incorretos.'));

          setErrorMsg(userFriendlyError);
          if (onShowToast) {
            onShowToast(
              isEn ? 'Account not found' : 'Conta não encontrada',
              userFriendlyError,
              'warning'
            );
          }
          setIsLoading(false);
          return;
        }
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Erro de conexão com o servidor');
    } finally {
      setIsLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) {
      setResetError(isEn ? 'Please enter your email.' : 'Por favor, informe seu e-mail.');
      return;
    }
    if (!newPasswordInput || newPasswordInput.length < 4) {
      setResetError(isEn ? 'Password must be at least 4 characters.' : 'A nova senha deve conter pelo menos 4 caracteres.');
      return;
    }
    setIsSubmittingReset(true);
    setResetError('');
    setResetSuccess('');
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.toLowerCase().trim(), newPassword: newPasswordInput }),
      });
      const data = await res.json();
      if (res.ok) {
        setPassword(newPasswordInput);
        setResetSuccess(isEn ? 'Password updated! Returning to login...' : 'Senha alterada com sucesso! Retornando ao login...');
        setTimeout(() => {
          setIsResetMode(false);
          setResetSuccess('');
          setErrorMsg('');
        }, 1200);
      } else {
        setResetError(data.error || (isEn ? 'Failed to reset password.' : 'Erro ao redefinir senha.'));
      }
    } catch (err: any) {
      setResetError(err.message || (isEn ? 'Connection error' : 'Erro de conexão'));
    } finally {
      setIsSubmittingReset(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-3 sm:p-4 overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white rounded-3xl max-w-[460px] w-full p-6 sm:p-8 shadow-2xl border border-slate-200 relative my-6 text-[#000035] animate-in fade-in zoom-in duration-150">
        
        {/* Close Button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute top-5 right-5 w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-500 hover:text-slate-800 transition cursor-pointer z-10"
          aria-label="Close"
          title="Fechar (Esc)"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Brand Header */}
        <div className="text-center mb-5">
          <div className="flex justify-center mb-2.5">
            <BrandLogo size="md" showText={true} />
          </div>

          <h2 className="text-2xl font-black text-[#000035] tracking-tight">
            {mode === 'login'
              ? isEn ? 'Log in to It\'s Simple' : 'Entrar no It\'s Simple'
              : isEn ? 'Join It\'s Simple' : 'Criar conta no It\'s Simple'}
          </h2>
          
          <p className="text-xs text-slate-500 mt-1 font-medium">
            {mode === 'login' ? (
              <>
                {isEn ? 'New here? ' : 'Novo por aqui? '}
                <button
                  type="button"
                  onClick={() => {
                    setMode('signup');
                    setErrorMsg('');
                  }}
                  className="text-[#1C4C96] hover:underline font-bold cursor-pointer"
                >
                  {isEn ? 'Sign up' : 'Cadastre-se'}
                </button>
              </>
            ) : (
              <>
                {isEn ? 'Already have an account? ' : 'Já possui uma conta? '}
                <button
                  type="button"
                  onClick={() => {
                    setMode('login');
                    setErrorMsg('');
                  }}
                  className="text-[#1C4C96] hover:underline font-bold cursor-pointer"
                >
                  {isEn ? 'Log in' : 'Entrar'}
                </button>
              </>
            )}
          </p>
        </div>

        {/* 🌟 Role Selection Switcher (Seu acesso vs Amigo Nativo vs Administrador) */}
        <div className="mb-5 bg-slate-100/90 p-1.5 rounded-2xl border border-slate-200">
          <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider text-center mb-1.5">
            {roleText.accessAs}
          </p>
          <div className="grid grid-cols-3 gap-1.5">
            <button
              type="button"
              onClick={() => {
                setRole('student');
                setErrorMsg('');
                if (typeof window !== 'undefined' && window.location.pathname === '/admin') {
                  try { window.history.replaceState({}, '', '/'); } catch {}
                }
              }}
              className={`p-2 rounded-xl text-left transition cursor-pointer flex flex-col justify-between ${
                role === 'student'
                  ? 'bg-white text-[#000035] shadow-sm border border-slate-200 ring-1 ring-blue-500/20'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-white/50'
              }`}
            >
              <div className="flex items-center gap-1 mb-0.5">
                <Compass
                  className={`w-3.5 h-3.5 shrink-0 ${
                    role === 'student' ? 'text-[#1C4C96]' : 'text-slate-400'
                  }`}
                />
                <span className="font-extrabold text-xs truncate">
                  {roleText.student}
                </span>
              </div>
              <span className="text-[9px] text-slate-500 font-medium leading-tight truncate">
                {roleText.studentDesc}
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                setRole('teacher');
                setErrorMsg('');
                if (typeof window !== 'undefined' && window.location.pathname === '/admin') {
                  try { window.history.replaceState({}, '', '/'); } catch {}
                }
              }}
              className={`p-2 rounded-xl text-left transition cursor-pointer flex flex-col justify-between ${
                role === 'teacher'
                  ? 'bg-white text-[#000035] shadow-sm border border-slate-200 ring-1 ring-emerald-500/20'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-white/50'
              }`}
            >
              <div className="flex items-center gap-1 mb-0.5">
                <HeartHandshake
                  className={`w-3.5 h-3.5 shrink-0 ${
                    role === 'teacher' ? 'text-emerald-600' : 'text-slate-400'
                  }`}
                />
                <span className="font-extrabold text-xs truncate">
                  {roleText.teacher}
                </span>
              </div>
              <span className="text-[9px] text-slate-500 font-medium leading-tight truncate">
                {roleText.teacherDesc}
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                setRole('admin');
                setErrorMsg('');
              }}
              className={`p-2 rounded-xl text-left transition cursor-pointer flex flex-col justify-between ${
                role === 'admin'
                  ? 'bg-white text-[#000035] shadow-sm border border-slate-200 ring-1 ring-amber-500/30'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-white/50'
              }`}
            >
              <div className="flex items-center gap-1 mb-0.5">
                <ShieldCheck
                  className={`w-3.5 h-3.5 shrink-0 ${
                    role === 'admin' ? 'text-amber-600' : 'text-slate-400'
                  }`}
                />
                <span className="font-extrabold text-xs truncate">
                  {roleText.admin}
                </span>
              </div>
              <span className="text-[9px] text-slate-500 font-medium leading-tight truncate">
                {roleText.adminDesc}
              </span>
            </button>
          </div>
        </div>

        {/* 1. Continue with Google Social Button */}
        <div className="space-y-2.5 mb-4">
          <button
            type="button"
            onClick={handleGoogleLogin}
            disabled={isLoading}
            className="w-full py-3 px-4 bg-white hover:bg-slate-50 text-[#000035] font-black text-xs sm:text-sm rounded-2xl border-2 border-slate-300 hover:border-slate-400 shadow-xs transition flex items-center justify-center gap-3 cursor-pointer active:scale-[0.99] disabled:opacity-50"
          >
            {isLoading ? (
              <Loader2 className="w-5 h-5 animate-spin text-[#1C4C96]" />
            ) : (
              /* Multicolored Google G SVG */
              <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24">
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
            )}
            <span>{isEn ? 'Continue with Google' : 'Continuar com o Google'}</span>
          </button>
        </div>

        {/* Divider with single-line text */}
        <div className="relative flex items-center justify-center my-4">
          <div className="border-t border-slate-200 w-full" />
          <span className="bg-white px-3 text-[11px] font-bold text-slate-400 uppercase tracking-wider whitespace-nowrap">
            {isEn ? 'or with email' : 'ou com e-mail'}
          </span>
          <div className="border-t border-slate-200 w-full" />
        </div>

        {/* Alerts & Existing User Warnings */}
        {errorMsg && (
          <div className="mb-4 p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-semibold flex flex-col gap-2 shadow-xs animate-in fade-in">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-600 mt-0.5" />
              <span className="leading-snug">{errorMsg}</span>
            </div>
            {(errorMsg.toLowerCase().includes('não encontrada') ||
              errorMsg.toLowerCase().includes('not found') ||
              errorMsg.toLowerCase().includes('crie seu cadastro') ||
              errorMsg.toLowerCase().includes('cadastre-se')) && role === 'student' && onOpenOnboarding && (
              <button
                type="button"
                onClick={() => {
                  onOpenOnboarding(email.trim());
                  onClose();
                }}
                className="self-start py-2 px-3.5 bg-[#000035] hover:bg-[#062863] text-white text-xs font-black rounded-xl transition shadow-sm flex items-center gap-1.5 cursor-pointer active:scale-98"
              >
                <span>{isEn ? 'Start Student Onboarding Wizard →' : 'Criar cadastro no Wizard Onboard →'}</span>
              </button>
            )}

            {(errorMsg.toLowerCase().includes('já está cadastrado') ||
              errorMsg.toLowerCase().includes('already registered') ||
              errorMsg.toLowerCase().includes('já existe')) && (
              <button
                type="button"
                onClick={() => {
                  setMode('login');
                  setErrorMsg('');
                }}
                className="self-start px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-bold transition cursor-pointer shadow-xs"
              >
                {isEn ? '👉 Click here to Log In' : '👉 Clique aqui para Fazer Login'}
              </button>
            )}
          </div>
        )}

        {successMsg && (
          <div className="mb-4 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold flex items-center gap-2">
            <Sparkles className="w-4 h-4 shrink-0 text-emerald-600" />
            <span>{successMsg}</span>
          </div>
        )}

        {/* Admin Registration Lockout Notice (Single Admin Rule) */}
        {mode === 'signup' && role === 'admin' && hasExistingAdmin ? (
          <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 text-amber-900 space-y-3">
            <div className="flex items-start gap-2.5">
              <ShieldCheck className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <h4 className="font-extrabold text-xs text-amber-900 mb-1">
                  {isEn ? 'Administrator Already Configured' : 'Administrador Já Cadastrado'}
                </h4>
                <p className="text-[11px] text-amber-800 leading-relaxed font-medium">
                  {isEn
                    ? 'The platform permits only 1 Administrator account. If you are the administrator, please log in with your administrator email and password.'
                    : 'A plataforma permite apenas 1 único cadastro de Administrador. Se você é o administrador, por favor efetue seu login com e-mail e senha.'}
                </p>
                {adminEmail && (
                  <p className="text-[10px] text-amber-700 mt-1 font-mono">
                    Admin: {adminEmail}
                  </p>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setErrorMsg('');
              }}
              className="w-full py-2.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-xl transition cursor-pointer shadow-xs"
            >
              {isEn ? 'Go to Administrator Login' : 'Ir para o Login de Administrador'}
            </button>
          </div>
        ) : isResetMode ? (
          /* 2. Password Reset Form */
          <form onSubmit={handleResetPassword} className="space-y-3.5">
            <div className="text-center mb-2">
              <div className="inline-flex p-2.5 rounded-full bg-blue-50 text-[#1C4C96] mb-1.5">
                <KeyRound className="w-5 h-5" />
              </div>
              <h3 className="text-base font-extrabold text-[#000035]">
                {isEn ? 'Reset Password' : 'Redefinir Senha'}
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {isEn
                  ? 'Enter your registered email and choose a new password.'
                  : 'Informe seu e-mail cadastrado e digite uma nova senha.'}
              </p>
            </div>

            {resetError && (
              <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-semibold flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
                <span>{resetError}</span>
              </div>
            )}

            {resetSuccess && (
              <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold flex items-center gap-2">
                <Sparkles className="w-4 h-4 shrink-0 text-emerald-600" />
                <span>{resetSuccess}</span>
              </div>
            )}

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                {isEn ? 'Email Address' : 'E-mail cadastrado'}
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="exemplo@gmail.com"
                  className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs sm:text-sm font-medium text-[#000035] placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-[#1C4C96]"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                {isEn ? 'New Password' : 'Nova Senha'}
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={newPasswordInput}
                  onChange={(e) => setNewPasswordInput(e.target.value)}
                  placeholder="••••••••"
                  className="w-full pl-10 pr-10 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs sm:text-sm font-medium text-[#000035] placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-[#1C4C96]"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div className="pt-2 flex flex-col gap-2">
              <button
                type="submit"
                disabled={isSubmittingReset}
                className="w-full py-3 px-4 bg-[#000035] hover:bg-[#062863] text-white font-black text-xs sm:text-sm rounded-xl shadow-md transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {isSubmittingReset ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <KeyRound className="w-4 h-4" />
                )}
                <span>{isEn ? 'Save New Password' : 'Salvar Nova Senha'}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsResetMode(false);
                  setResetError('');
                  setResetSuccess('');
                }}
                className="w-full py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition cursor-pointer"
              >
                {isEn ? '← Back to Login' : '← Voltar ao Login'}
              </button>
            </div>
          </form>
        ) : (
          /* 2. Email & Password Form */
          <form onSubmit={handleSubmit} className="space-y-3.5">
            {mode === 'signup' && (
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  {isEn ? 'Full Name' : 'Nome Completo'}
                </label>
                <div className="relative">
                  <User className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => {
                      setName(e.target.value);
                      if (nameWarning) setNameWarning('');
                    }}
                    onBlur={() => checkDuplicateName(name)}
                    placeholder={
                      role === 'admin'
                        ? isEn ? 'Administrator Name' : 'Nome do Administrador'
                        : role === 'teacher'
                        ? isEn ? 'Native Friend Name' : 'Nome do Amigo Nativo'
                        : isEn ? 'Your full name' : 'Seu nome completo'
                    }
                    className={`w-full pl-10 pr-4 py-2.5 bg-slate-50 border rounded-xl text-xs sm:text-sm font-medium text-[#000035] placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:border-transparent transition ${
                      nameWarning
                        ? 'border-amber-400 ring-2 ring-amber-400/20'
                        : 'border-slate-300 focus:ring-[#1C4C96]'
                    }`}
                  />
                </div>
                {nameWarning && (
                  <p className="mt-1 text-[11px] font-semibold text-amber-700 bg-amber-50 p-2 rounded-lg border border-amber-200 animate-in fade-in">
                    ⚠️ {nameWarning}
                  </p>
                )}
              </div>
            )}

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                {isEn ? 'Email' : 'E-mail'}
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (emailWarning) setEmailWarning('');
                  }}
                  onBlur={() => checkDuplicateEmail(email)}
                  placeholder={
                    role === 'admin'
                      ? 'adm.itissimple@gmail.com'
                      : isEn ? 'name@example.com' : 'seu.email@exemplo.com'
                  }
                  className={`w-full pl-10 pr-4 py-2.5 bg-slate-50 border rounded-xl text-xs sm:text-sm font-medium text-[#000035] placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:border-transparent transition ${
                    emailWarning
                      ? 'border-rose-400 ring-2 ring-rose-400/20'
                      : 'border-slate-300 focus:ring-[#1C4C96]'
                  }`}
                />
              </div>
              {emailWarning && (
                <div className="mt-1 text-[11px] font-semibold text-rose-700 bg-rose-50 p-2 rounded-lg border border-rose-200 flex items-center justify-between gap-2 animate-in fade-in">
                  <span>⚠️ {emailWarning}</span>
                  <button
                    type="button"
                    onClick={() => {
                      setMode('login');
                      setEmailWarning('');
                      setErrorMsg('');
                    }}
                    className="px-2 py-0.5 bg-rose-600 text-white rounded text-[10px] font-bold hover:bg-rose-700 cursor-pointer shrink-0"
                  >
                    {isEn ? 'Log in' : 'Fazer login'}
                  </button>
                </div>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-bold text-slate-700">
                  {isEn ? 'Password' : 'Senha'}
                </label>
                {mode === 'login' && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsResetMode(true);
                      setResetError('');
                      setResetSuccess('');
                      setNewPasswordInput('');
                    }}
                    className="text-[11px] font-bold text-[#1C4C96] hover:underline cursor-pointer"
                  >
                    {isEn ? 'Forgot password?' : 'Esqueceu a senha?'}
                  </button>
                )}
              </div>
              <div className="relative">
                <Lock className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full pl-10 pr-10 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs sm:text-sm font-medium text-[#000035] placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-[#1C4C96] focus:border-transparent transition"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition cursor-pointer"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* 🎓 Sign Up: Student Level & Routine Selectors */}
            {mode === 'signup' && role === 'student' && (
              <>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    {isEn ? 'Your Comfort Level in English' : 'Como você se sente com o Inglês?'}
                  </label>
                  <select
                    value={level}
                    onChange={(e) => setLevel(e.target.value as EnglishLevel)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs sm:text-sm font-medium text-[#000035] focus:outline-hidden focus:ring-2 focus:ring-[#1C4C96]"
                  >
                    <option value={EnglishLevel.BEGINNER}>
                      {isEn ? 'Beginner (Starting now)' : 'Iniciante (Começando agora)'}
                    </option>
                    <option value={EnglishLevel.INTERMEDIATE}>
                      {isEn ? 'Intermediate (Understand but want fluency)' : 'Intermediário (Entendo mas quero destravar)'}
                    </option>
                    <option value={EnglishLevel.ADVANCED}>
                      {isEn ? 'Advanced (Seeking daily naturalness)' : 'Avançado (Buscando naturalidade diária)'}
                    </option>
                  </select>
                </div>

                {/* Scheduled Routine Times */}
                <div className="p-3.5 bg-blue-50/70 rounded-2xl border border-[#607EC9]/30 space-y-2.5">
                  <div className="flex items-center gap-1.5 text-xs font-black text-[#062863]">
                    <Clock className="w-3.5 h-3.5 text-[#1C4C96]" />
                    <span>{isEn ? 'Daily Routine Scheduled Times' : 'Horários Previstos da Sua Rotina'}</span>
                  </div>
                  <p className="text-[11px] text-[#607EC9] leading-tight">
                    {isEn
                      ? 'Default times for your daily activities (customizable anytime on your routine board):'
                      : 'Horários padrão das suas atividades (editáveis a qualquer momento no seu quadro diário):'}
                  </p>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <div>
                      <label className="block text-[10px] font-bold text-slate-700 mb-1">
                        {isEn ? 'Routine (Video)' : 'Rotina (Vídeo)'}
                      </label>
                      <select
                        value={routineVideoTime}
                        onChange={(e) => setRoutineVideoTime(e.target.value)}
                        className="w-full px-2 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-bold text-[#000035] focus:ring-2 focus:ring-[#1C4C96]"
                      >
                        {TIME_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold text-slate-700 mb-1">
                        {isEn ? 'Routine (Audio)' : 'Rotina (Áudio)'}
                      </label>
                      <select
                        value={routineAudioTime}
                        onChange={(e) => setRoutineAudioTime(e.target.value)}
                        className="w-full px-2 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-bold text-[#000035] focus:ring-2 focus:ring-[#1C4C96]"
                      >
                        {TIME_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold text-slate-700 mb-1">
                        {isEn ? 'Phrase of the Day' : 'Frase do Dia'}
                      </label>
                      <select
                        value={dailyPhraseTime}
                        onChange={(e) => setDailyPhraseTime(e.target.value)}
                        className="w-full px-2 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-bold text-[#000035] focus:ring-2 focus:ring-[#1C4C96]"
                      >
                        {TIME_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              </>
            )}

            {/* 🌟 Sign Up: Native Friend (Amigo Nativo) Specific Fields */}
            {mode === 'signup' && role === 'teacher' && (
              <div className="space-y-3 p-3.5 rounded-2xl bg-emerald-50/70 border border-emerald-200">
                <div className="flex items-center gap-1.5 text-xs font-black text-emerald-900 mb-1">
                  <HeartHandshake className="w-4 h-4 text-emerald-600" />
                  <span>{isEn ? 'Native Friend Profile Settings' : 'Dados do Perfil de Amigo Nativo'}</span>
                </div>

                {/* Profile Photo / Avatar Upload */}
                <div className="bg-white p-3 rounded-xl border border-emerald-200 shadow-2xs">
                  <ImageUploadInput
                    label={isEn ? 'Profile Photo / Avatar (Upload from device or choose)' : 'Foto de Perfil / Avatar (Carregue do dispositivo ou escolha)'}
                    value={avatar}
                    onChange={(newVal) => setAvatar(newVal)}
                    currentLanguage={currentLanguage}
                    helperText={
                      isEn
                        ? 'Select or upload a clear photo that will appear on your public card and approval application.'
                        : 'Selecione ou carregue uma foto nítida que aparecerá no seu cartão público e no pedido de aprovação.'
                    }
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-700 mb-1">
                      {isEn ? 'Native Country' : 'País de Origem'}
                    </label>
                    <select
                      value={selectedCountry}
                      onChange={(e) => handleCountryChange(e.target.value)}
                      className="w-full px-2 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-bold text-[#000035]"
                    >
                      <option value="">{isEn ? 'Select country...' : 'Selecione o país...'}</option>
                      {COUNTRY_OPTIONS.map((c) => (
                        <option key={c.name} value={c.name}>
                          {c.flag} {c.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-slate-700 mb-1">
                      {isEn ? 'Accent' : 'Sotaque'}
                    </label>
                    <input
                      type="text"
                      value={accent}
                      onChange={(e) => setAccent(e.target.value)}
                      placeholder="e.g. North American"
                      className="w-full px-2 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-bold text-[#000035]"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-700 mb-1">
                    {isEn ? 'Profile Headline' : 'Título do Perfil (Headline)'}
                  </label>
                  <input
                    type="text"
                    value={headline}
                    onChange={(e) => setHeadline(e.target.value)}
                    placeholder="e.g. Conversational Native Friend & Cultural Guide"
                    className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-bold text-[#000035]"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-700 mb-1">
                    {isEn ? 'Specialties / Conversation Focus' : 'Especialidades / Foco de Conversação'}
                  </label>
                  <input
                    type="text"
                    value={specialties}
                    onChange={(e) => setSpecialties(e.target.value)}
                    placeholder="e.g. Daily Routine & Lifestyle, Conversational Fluency, Slangs"
                    className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-bold text-[#000035]"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-700 mb-1">
                    {isEn ? 'Bio / Presentation' : 'Biografia / Apresentação'}
                  </label>
                  <textarea
                    rows={2}
                    value={bio}
                    onChange={(e) => setBio(e.target.value)}
                    placeholder="Tell students about yourself and your conversation style..."
                    className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-xs text-[#000035]"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-700 mb-1">
                      {isEn ? 'Session Price (USD)' : 'Preço por Sessão (USD)'}
                    </label>
                    <div className="relative">
                      <DollarSign className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        type="number"
                        min="5"
                        max="150"
                        value={priceUsd}
                        onChange={(e) => setPriceUsd(e.target.value === '' ? '' : Number(e.target.value))}
                        className="w-full pl-6 pr-2 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-bold text-[#000035]"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-slate-700 mb-1">
                      {isEn ? 'Google Meet Link' : 'Link Padrão do Google Meet'}
                    </label>
                    <div className="relative">
                      <Video className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        type="url"
                        value={meetUrl}
                        onChange={(e) => setMeetUrl(e.target.value)}
                        placeholder="https://meet.google.com/..."
                        className="w-full pl-6 pr-2 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-bold text-[#000035]"
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-700 mb-1">
                    {isEn ? 'Video Presentation URL (YouTube/Vimeo - Optional)' : 'Vídeo de Apresentação (YouTube/Vimeo - Opcional)'}
                  </label>
                  <input
                    type="url"
                    value={videoIntroUrl}
                    onChange={(e) => setVideoIntroUrl(e.target.value)}
                    placeholder="https://www.youtube.com/watch?v=..."
                    className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-bold text-[#000035]"
                  />
                </div>

                <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-[11px] leading-relaxed">
                  <strong>💡 {isEn ? 'Approval workflow:' : 'Fluxo de aprovação:'}</strong>{' '}
                  {isEn
                    ? 'Your photo and profile details will be registered immediately and submitted to the Administrator for approval before going live on the platform.'
                    : 'Sua foto e dados do perfil serão salvos imediatamente e enviados para a central de aprovações do Administrador antes de ficarem visíveis publicamente.'}
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="w-full mt-2 py-3 px-4 bg-[#000035] hover:bg-[#062863] text-white font-black text-xs sm:text-sm rounded-xl shadow-md transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 active:scale-[0.99]"
            >
              {isLoading ? (
                <Loader2 className="w-4 h-4 animate-spin text-white" />
              ) : (
                <LogIn className="w-4 h-4" />
              )}
              <span>
                {mode === 'login'
                  ? role === 'teacher'
                    ? isEn ? 'Log in as Native Friend' : 'Acessar como Amigo Nativo'
                    : role === 'admin'
                    ? isEn ? 'Log in as Administrator' : 'Acessar como Administrador'
                    : isEn ? 'Log in to Student Space' : 'Acessar Espaço do Aluno'
                  : role === 'teacher'
                  ? isEn ? 'Register as Native Friend' : 'Cadastrar como Amigo Nativo'
                  : role === 'admin'
                  ? isEn ? 'Register Administrator' : 'Cadastrar Administrador'
                  : isEn ? 'Create account' : 'Criar minha conta'}
              </span>
            </button>
          </form>
        )}

        {/* Terms Disclaimer */}
        <p className="text-[10px] text-slate-400 text-center mt-4 leading-tight">
          {isEn ? (
            <>
              By logging in, you agree to It's Simple{' '}
              <span className="underline cursor-pointer">Terms</span> and{' '}
              <span className="underline cursor-pointer">Privacy Policy</span>.
            </>
          ) : (
            <>
              Ao entrar, você concorda com os{' '}
              <span className="underline cursor-pointer">Termos</span> e a{' '}
              <span className="underline cursor-pointer">Política de Privacidade</span> do It's Simple.
            </>
          )}
        </p>
      </div>

      <GoogleSignInModal
        isOpen={showGoogleSignIn}
        onClose={() => setShowGoogleSignIn(false)}
        onLoginSuccess={(acc, prof) => {
          setShowGoogleSignIn(false);
          onLoginSuccess(acc, prof);
          onClose();
        }}
        preferredRole={role}
        currentLanguage={currentLanguage}
      />
    </div>
  );
};
