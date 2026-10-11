import React, { useState, useEffect } from 'react';
import {
  X,
  ArrowRight,
  ArrowLeft,
  Check,
  CheckCircle2,
  Sparkles,
  Calendar,
  Clock,
  User,
  Star,
  Globe,
  Award,
  Video,
  Headphones,
  BookOpen,
  HelpCircle,
  LogIn,
  AlertCircle,
  ShieldCheck,
  Play,
  Eye,
  EyeOff,
  DollarSign,
  Briefcase,
  Plane,
  GraduationCap,
  Home,
  Palette,
  MessageCircle,
  HelpCircle as QuestionIcon,
} from 'lucide-react';
import {
  DayOfWeek,
  Language,
  NativeFriendTutor,
  UserProfile,
  GoogleAccount,
  EnglishLevel,
} from '../types';

export interface OnboardingResultData {
  learningGoal: string;
  level: EnglishLevel;
  englishLevel: EnglishLevel;
  userLevel: EnglishLevel;
  weeklyStudyDaysTarget: number;
  weeklyStudyDays: DayOfWeek[];
  routineVideoTime: string;
  routineAudioTime: string;
  dailyPhraseTime: string;
  selectedTutor: NativeFriendTutor;
  studentAccount?: {
    name: string;
    email: string;
    password?: string;
  };
}

export interface OnboardingWizardModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentLanguage: Language;
  tutorsList: NativeFriendTutor[];
  currentUserProfile?: UserProfile | null;
  currentAccount?: GoogleAccount | null;
  initialEmail?: string;
  onEmailAlreadyExists?: (email: string) => void;
  onCompleteOnboarding: (onboardingData: OnboardingResultData) => void | Promise<void>;
  onOpenScheduleTrialLesson?: (tutor: NativeFriendTutor, studentInfo?: { name: string; email: string; uid?: string }) => void;
  onOpenStartNewWeek?: () => void;
}

function getYouTubeEmbedId(urlOrId?: string): string | null {
  if (!urlOrId) return null;
  const trimmed = urlOrId.trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
    return trimmed;
  }
  const match = trimmed.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|shorts\/|watch\?v=|watch\?.+&v=))([\w-]{11})/i);
  if (match && match[1]) {
    return match[1];
  }
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
  const secondary = trimmed.match(regExp);
  return secondary && secondary[2].length === 11 ? secondary[2] : null;
}

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

const PREDEFINED_GOALS = [
  {
    id: 'career',
    titlePt: 'Carreira & Trabalho',
    titleEn: 'Career & Work',
    descPt: 'Entrevistas, reuniões, emails e promoções globais.',
    descEn: 'Interviews, meetings, emails and global promotions.',
    icon: Briefcase,
    color: 'from-blue-600 to-indigo-600',
  },
  {
    id: 'travel',
    titlePt: 'Viagens & Turismo',
    titleEn: 'Travel & Tourism',
    descPt: 'Aeroportos, hotéis, restaurantes e autonomia no exterior.',
    descEn: 'Airports, hotels, restaurants and independence abroad.',
    icon: Plane,
    color: 'from-teal-600 to-cyan-600',
  },
  {
    id: 'academic',
    titlePt: 'Estudos & Exames Acadêmicos',
    titleEn: 'Studies & Academic Exams',
    descPt: 'TOEFL, IELTS, pós-graduação e leitura de artigos.',
    descEn: 'TOEFL, IELTS, graduate programs and academic reading.',
    icon: GraduationCap,
    color: 'from-purple-600 to-violet-600',
  },
  {
    id: 'immigration',
    titlePt: 'Imigração & Mudança de País',
    titleEn: 'Immigration & Relocation',
    descPt: 'Morar fora, resolver burocracias e vida social no exterior.',
    descEn: 'Living abroad, daily bureaucracy and foreign social life.',
    icon: Home,
    color: 'from-amber-600 to-orange-600',
  },
  {
    id: 'personal',
    titlePt: 'Desenvolvimento Pessoal & Hobbies',
    titleEn: 'Personal Development & Hobbies',
    descPt: 'Assistir séries sem legenda, podcasts e cultura mundial.',
    descEn: 'Movies without subtitles, podcasts and global culture.',
    icon: Palette,
    color: 'from-rose-600 to-pink-600',
  },
  {
    id: 'conversation',
    titlePt: 'Apenas Conversar / Manter a Fluência',
    titleEn: 'Casual Conversation / Fluency Maintenance',
    descPt: 'Praticar com frequência para não enferrujar o vocabulário.',
    descEn: 'Consistent practice to keep speaking sharp and natural.',
    icon: MessageCircle,
    color: 'from-emerald-600 to-green-600',
  },
  {
    id: 'other',
    titlePt: 'Outro motivo',
    titleEn: 'Other reason',
    descPt: 'Defina seu objetivo específico para personalizarmos sua rotina.',
    descEn: 'Define your specific goal for a personalized routine.',
    icon: QuestionIcon,
    color: 'from-slate-600 to-slate-700',
  },
];

const WEEK_DAYS_CONFIG: { key: DayOfWeek; shortPt: string; shortEn: string; labelPt: string; labelEn: string }[] = [
  { key: 'monday', shortPt: 'Seg', shortEn: 'Mon', labelPt: 'Segunda', labelEn: 'Monday' },
  { key: 'tuesday', shortPt: 'Ter', shortEn: 'Tue', labelPt: 'Terça', labelEn: 'Tuesday' },
  { key: 'wednesday', shortPt: 'Qua', shortEn: 'Wed', labelPt: 'Quarta', labelEn: 'Wednesday' },
  { key: 'thursday', shortPt: 'Qui', shortEn: 'Thu', labelPt: 'Quinta', labelEn: 'Thursday' },
  { key: 'friday', shortPt: 'Sex', shortEn: 'Fri', labelPt: 'Sexta', labelEn: 'Friday' },
  { key: 'saturday', shortPt: 'Sáb', shortEn: 'Sat', labelPt: 'Sábado', labelEn: 'Saturday' },
  { key: 'sunday', shortPt: 'Dom', shortEn: 'Sun', labelPt: 'Domingo', labelEn: 'Sunday' },
];

export const ENGLISH_LEVEL_OPTIONS: {
  key: EnglishLevel;
  value: 'Beginner' | 'Intermediate' | 'Advanced';
  titlePt: string;
  titleEn: string;
  badge: string;
  descPt: string;
  descEn: string;
  icon: string;
  color: string;
}[] = [
  {
    key: EnglishLevel.BEGINNER,
    value: 'Beginner',
    titlePt: 'Beginner (Iniciante)',
    titleEn: 'Beginner (A1 - A2)',
    badge: 'A1 - A2',
    descPt: 'Começando do zero ou construindo vocabulário essencial do cotidiano.',
    descEn: 'Starting from scratch or building essential everyday vocabulary.',
    icon: '🌱',
    color: 'from-emerald-600 to-teal-700',
  },
  {
    key: EnglishLevel.INTERMEDIATE,
    value: 'Intermediate',
    titlePt: 'Intermediate (Intermediário)',
    titleEn: 'Intermediate (B1 - B2)',
    badge: 'B1 - B2',
    descPt: 'Compreendo conversas e quero destravar fluência e confiança.',
    descEn: 'I understand conversations and want to unlock natural fluency.',
    icon: '🌿',
    color: 'from-blue-600 to-indigo-700',
  },
  {
    key: EnglishLevel.ADVANCED,
    value: 'Advanced',
    titlePt: 'Advanced (Avançado)',
    titleEn: 'Advanced (C1 - C2)',
    badge: 'C1 - C2',
    descPt: 'Vocabulário profissional, nuances, pronúncia fina e ritmo natural.',
    descEn: 'Professional vocabulary, subtle nuances, idioms, and natural rhythm.',
    icon: '🌳',
    color: 'from-purple-600 to-violet-800',
  },
];

export const OnboardingWizardModal: React.FC<OnboardingWizardModalProps> = ({
  isOpen,
  onClose,
  currentLanguage,
  tutorsList,
  currentUserProfile,
  currentAccount,
  initialEmail,
  onEmailAlreadyExists,
  onCompleteOnboarding,
  onOpenScheduleTrialLesson,
  onOpenStartNewWeek,
}) => {
  const isEn = currentLanguage === 'en';

  // Step state: 1 to 6
  const [currentStep, setCurrentStep] = useState<number>(1);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [isClosing, setIsClosing] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const wasOpenRef = React.useRef<boolean>(false);

  // English Level selection: Beginner | Intermediate | Advanced
  const [studentLevel, setStudentLevel] = useState<EnglishLevel>(() => {
    const raw = currentUserProfile?.level || (currentUserProfile as any)?.englishLevel || (currentUserProfile as any)?.userLevel;
    if (!raw) return EnglishLevel.BEGINNER;
    const l = String(raw).toLowerCase();
    if (l.includes('inter')) return EnglishLevel.INTERMEDIATE;
    if (l.includes('avan') || l.includes('adv')) return EnglishLevel.ADVANCED;
    return EnglishLevel.BEGINNER;
  });

  // Step 1: Learning Goal
  const [selectedGoalId, setSelectedGoalId] = useState<string>('career');
  const [customGoalText, setCustomGoalText] = useState<string>('');

  // Step 2: Practice Days Target
  const [selectedDaysTarget, setSelectedDaysTarget] = useState<number>(7);
  const [selectedDays, setSelectedDays] = useState<DayOfWeek[]>([
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday',
    'sunday',
  ]);

  // Step 3: Daily Routine Times
  const [routineVideoTime, setRoutineVideoTime] = useState<string>('06:00');
  const [routineAudioTime, setRoutineAudioTime] = useState<string>('06:00');
  const [dailyPhraseTime, setDailyPhraseTime] = useState<string>('06:00');

  // Step 4: Chosen Native Friend & Profile Preview Modal
  const approvedTutors = tutorsList.filter((t) => (t.approvalStatus || 'approved') === 'approved');
  const [selectedTutorId, setSelectedTutorId] = useState<string>(
    approvedTutors[0]?.id || approvedTutors[0]?.email || ''
  );
  const [previewTutorModal, setPreviewTutorModal] = useState<NativeFriendTutor | null>(null);

  // Support ESC key to close preview tutor modal or main wizard modal
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (previewTutorModal) {
          setPreviewTutorModal(null);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, previewTutorModal, onClose]);

  // Step 5: Account Registration (if not logged in)
  const [authMode, setAuthMode] = useState<'signup' | 'login'>('signup');
  const [studentName, setStudentName] = useState<string>(
    currentUserProfile?.name || currentAccount?.name || ''
  );
  const [studentEmail, setStudentEmail] = useState<string>(
    currentUserProfile?.email || currentAccount?.email || ''
  );
  const [studentPassword, setStudentPassword] = useState<string>('');
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [isSavedSuccessfully, setIsSavedSuccessfully] = useState<boolean>(false);

  // Reset or initialize on open ONLY when transitioning from closed to open
  useEffect(() => {
    if (initialEmail && initialEmail.trim()) {
      setStudentEmail(initialEmail.trim());
    }
  }, [initialEmail]);

  useEffect(() => {
    if (isOpen) {
      if (!wasOpenRef.current) {
        wasOpenRef.current = true;
        setCurrentStep(1);
        setIsSubmitting(false);
        setIsClosing(false);
        setErrorMessage(null);
        setIsSavedSuccessfully(false);

        if (initialEmail && initialEmail.trim()) {
          setStudentEmail(initialEmail.trim());
        }

        if (currentUserProfile) {
          if (currentUserProfile.learningGoal) {
            const match = PREDEFINED_GOALS.find((g) => g.titlePt === currentUserProfile.learningGoal || g.titleEn === currentUserProfile.learningGoal);
            if (match) {
              setSelectedGoalId(match.id);
            } else {
              setSelectedGoalId('other');
              setCustomGoalText(currentUserProfile.learningGoal);
            }
          }
          if (currentUserProfile.weeklyStudyDaysTarget) {
            setSelectedDaysTarget(currentUserProfile.weeklyStudyDaysTarget);
          }
          if (currentUserProfile.weeklyStudyDays && currentUserProfile.weeklyStudyDays.length > 0) {
            setSelectedDays(currentUserProfile.weeklyStudyDays);
          }
          if (currentUserProfile.routineVideoTime) {
            setRoutineVideoTime(currentUserProfile.routineVideoTime);
          }
          if (currentUserProfile.routineAudioTime) {
            setRoutineAudioTime(currentUserProfile.routineAudioTime);
          }
          if (currentUserProfile.dailyPhraseTime) {
            setDailyPhraseTime(currentUserProfile.dailyPhraseTime);
          }
          if (currentUserProfile.teacherEmail) {
            const matchTutor = tutorsList.find(
              (t) => t.email.toLowerCase() === currentUserProfile.teacherEmail?.toLowerCase()
            );
            if (matchTutor) {
              setSelectedTutorId(matchTutor.id || matchTutor.email);
            }
          }
        }

        if (currentAccount) {
          setStudentName(currentAccount.name || '');
          setStudentEmail(currentAccount.email || '');
        }
      }
    } else {
      wasOpenRef.current = false;
      setIsClosing(false);
      setIsSubmitting(false);
    }
  }, [isOpen, currentUserProfile, currentAccount, tutorsList]);

  if (!isOpen || isClosing) return null;

  // Selected tutor object
  const selectedTutor =
    approvedTutors.find((t) => t.id === selectedTutorId || t.email === selectedTutorId) ||
    approvedTutors[0];

  // Frequency preset handlers
  const handleSelectFrequencyPreset = (target: number) => {
    setSelectedDaysTarget(target);
    if (target === 2) {
      setSelectedDays(['tuesday', 'thursday']);
    } else if (target === 3) {
      setSelectedDays(['monday', 'wednesday', 'friday']);
    } else if (target === 5) {
      setSelectedDays(['monday', 'tuesday', 'wednesday', 'thursday', 'friday']);
    } else {
      setSelectedDays(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']);
    }
  };

  const handleToggleDay = (day: DayOfWeek) => {
    setSelectedDays((prev) => {
      if (prev.includes(day)) {
        if (prev.length <= 1) return prev; // keep at least 1
        const updated = prev.filter((d) => d !== day);
        setSelectedDaysTarget(updated.length);
        return updated;
      } else {
        const updated = [...prev, day];
        setSelectedDaysTarget(updated.length);
        return updated;
      }
    });
  };

  // Get finalized learning goal label
  const getFinalLearningGoal = () => {
    if (selectedGoalId === 'other') {
      return customGoalText.trim() || (isEn ? 'Personal Growth' : 'Desenvolvimento Pessoal');
    }
    const found = PREDEFINED_GOALS.find((g) => g.id === selectedGoalId);
    return isEn ? found?.titleEn || '' : found?.titlePt || '';
  };

  // Step 5 Save / Submit Action
  const handleSaveAndAdvance = async () => {
    setErrorMessage(null);

    // Validation for guest
    if (!currentAccount) {
      if (!studentName.trim()) {
        setErrorMessage(isEn ? 'Please enter your name.' : 'Por favor, informe seu nome completo.');
        return;
      }
      if (!studentEmail.trim() || !studentEmail.includes('@')) {
        setErrorMessage(isEn ? 'Please enter a valid email address.' : 'Por favor, informe um email válido.');
        return;
      }
      if (authMode === 'signup' && (!studentPassword || studentPassword.length < 6)) {
        setErrorMessage(isEn ? 'Password must be at least 6 characters.' : 'A senha deve conter no mínimo 6 caracteres.');
        return;
      }
    }

    if (!selectedTutor) {
      setErrorMessage(isEn ? 'Please select a Native Friend.' : 'Por favor, selecione um Amigo Nativo.');
      return;
    }

    const cleanEmail = (studentEmail.trim() || currentAccount?.email || '').toLowerCase();
    const isNewRegistration = !currentAccount || currentAccount.role !== 'student' || cleanEmail !== (currentAccount.email || '').toLowerCase();

    // Check if email already exists in Firebase Auth or Firestore
    if (isNewRegistration && cleanEmail) {
      setIsSubmitting(true);
      try {
        const checkRes = await fetch(`/api/auth/check-user?email=${encodeURIComponent(cleanEmail)}`);
        if (checkRes.ok) {
          const checkData = await checkRes.json();
          if (checkData.emailExists) {
            setIsSubmitting(false);
            if (onEmailAlreadyExists) {
              onEmailAlreadyExists(cleanEmail);
            } else {
              setErrorMessage(isEn ? 'This email is already registered.' : 'Este e-mail já possui uma conta cadastrada.');
            }
            return;
          }
        }
      } catch (err) {
        console.warn('Check email error in onboarding:', err);
      }
    }

    // Passa estado local de carregamento
    setIsSubmitting(true);

    try {
      await onCompleteOnboarding({
        learningGoal: getFinalLearningGoal(),
        level: studentLevel,
        englishLevel: studentLevel,
        userLevel: studentLevel,
        weeklyStudyDaysTarget: selectedDaysTarget,
        weeklyStudyDays: selectedDays,
        routineVideoTime,
        routineAudioTime,
        dailyPhraseTime,
        selectedTutor,
        studentAccount: (!currentAccount || currentAccount.role !== 'student' || cleanEmail !== (currentAccount.email || '').toLowerCase())
          ? {
              name: studentName.trim() || currentAccount?.name || '',
              email: cleanEmail,
              password: studentPassword,
            }
          : {
              name: currentAccount.name,
              email: currentAccount.email,
            },
      });

      setIsSavedSuccessfully(true);
    } catch (err: any) {
      console.warn('Failed to save onboarding configuration:', err);
      setErrorMessage(err?.message || (isEn ? 'Failed to save configuration.' : 'Erro ao salvar configuração do perfil.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleBookTrialLesson = () => {
    const activeStudentEmail = (studentEmail.trim() || currentUserProfile?.email || currentAccount?.email || '').toLowerCase();
    const activeStudentName = studentName.trim() || currentUserProfile?.name || currentAccount?.name || activeStudentEmail.split('@')[0] || 'Aluno';
    const activeStudentUid = currentUserProfile?.id || (currentAccount as any)?.uid || (activeStudentEmail ? `usr-${activeStudentEmail.replace(/[^a-zA-Z0-9]/g, '-')}` : undefined);
    if (selectedTutor && onOpenScheduleTrialLesson) {
      onOpenScheduleTrialLesson(selectedTutor, {
        name: activeStudentName,
        email: activeStudentEmail,
        uid: activeStudentUid,
      });
    }
    onClose();
  };

  const handleFinishToDashboard = () => {
    if (onOpenStartNewWeek) {
      onOpenStartNewWeek();
    }
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div
      id="onboarding-wizard-modal"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-3 sm:p-4 overflow-y-auto animate-in fade-in duration-200"
    >
      <div className="bg-[#000035] text-white rounded-3xl max-w-2xl w-full border border-[#607EC9]/40 shadow-2xl overflow-hidden flex flex-col my-4 max-h-[92vh]">
        {/* Modal Top Header */}
        <div className="px-5 sm:px-6 py-4 bg-gradient-to-r from-[#062863] via-[#000035] to-[#1C4C96] border-b border-[#607EC9]/30 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#F4CA54] text-[#000035] flex items-center justify-center font-black shadow-sm">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-full bg-[#9AB4FF]/20 text-[#9AB4FF] border border-[#9AB4FF]/30">
                  {isEn ? 'Welcome Wizard' : 'Assistente de Boas-Vindas'}
                </span>
                <span className="text-[11px] font-bold text-[#F4CA54]">
                  {isEn ? `Step ${currentStep} of 6` : `Passo ${currentStep} de 6`}
                </span>
              </div>
              <h2 className="text-base sm:text-lg font-black text-white mt-0.5">
                {currentStep === 1 && (isEn ? 'What is your primary goal?' : 'Qual o seu objetivo com o inglês?')}
                {currentStep === 2 && (isEn ? 'Set your weekly practice target' : 'Sua meta de dias de prática')}
                {currentStep === 3 && (isEn ? 'Configure your daily routine times' : 'Horários da sua rotina diária')}
                {currentStep === 4 && (isEn ? 'Choose your Native Friend (Trial Lesson)' : 'Escolha seu Amigo Nativo (Aula Teste)')}
                {currentStep === 5 && (isEn ? 'Activate account & your Native Friend' : 'Ativar conta & vincular Amigo Nativo')}
                {currentStep === 6 && (isEn ? 'First week roadmap: Start New Week' : 'Orientação da 1ª Semana: Start New Week')}
              </h2>
            </div>
          </div>

          <button
            type="button"
            id="onboarding-close-btn"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-slate-300 hover:text-white flex items-center justify-center transition cursor-pointer"
            title={isEn ? 'Close' : 'Fechar'}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Step Progress Bar */}
        <div className="w-full bg-[#062863] h-1.5 flex">
          {[1, 2, 3, 4, 5, 6].map((st) => (
            <div
              key={st}
              className={`flex-1 h-full transition-all duration-300 ${
                st <= currentStep ? 'bg-gradient-to-r from-[#9AB4FF] to-[#F4CA54]' : 'bg-transparent'
              } ${st < 6 ? 'border-r border-[#000035]' : ''}`}
            />
          ))}
        </div>

        {/* Error Notification */}
        {errorMessage && (
          <div className="mx-5 sm:mx-6 mt-4 p-3 rounded-xl bg-rose-500/20 border border-rose-500/50 text-rose-200 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Scrollable Content Body */}
        <div className="p-5 sm:p-6 overflow-y-auto space-y-5 flex-1">
          {/* ============================================================ */}
          {/* STEP 1: OBJETIVO DE APRENDIZADO */}
          {/* ============================================================ */}
          {currentStep === 1 && (
            <div className="space-y-4 animate-in fade-in duration-200">
              <div className="p-3.5 rounded-2xl bg-[#062863]/60 border border-[#607EC9]/30 text-xs text-blue-100/90 leading-relaxed">
                {isEn
                  ? 'Select what brings you here today. We use this to curate your daily content, YouTube videos, and conversation topics with your Native Friend.'
                  : 'Selecione o motivo principal para aprender inglês hoje. Usaremos isso para calibrar seus vídeos diários, áudios e temas de conversação com seu Amigo Nativo.'}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {PREDEFINED_GOALS.map((goal) => {
                  const Icon = goal.icon;
                  const isSelected = selectedGoalId === goal.id;
                  return (
                    <button
                      key={goal.id}
                      type="button"
                      id={`onboarding-goal-${goal.id}`}
                      onClick={() => setSelectedGoalId(goal.id)}
                      className={`p-3.5 rounded-2xl border text-left transition cursor-pointer flex items-start gap-3 relative ${
                        isSelected
                          ? 'bg-[#1C4C96] border-[#F4CA54] shadow-md ring-2 ring-[#F4CA54]/40'
                          : 'bg-[#062863]/40 border-[#607EC9]/30 hover:bg-[#062863]/80 hover:border-[#9AB4FF]/50'
                      }`}
                    >
                      <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${goal.color} text-white flex items-center justify-center shrink-0 shadow-sm mt-0.5`}>
                        <Icon className="w-4 h-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-1">
                          <h4 className="font-extrabold text-xs sm:text-sm text-white truncate">
                            {isEn ? goal.titleEn : goal.titlePt}
                          </h4>
                          {isSelected && <CheckCircle2 className="w-4 h-4 text-[#F4CA54] shrink-0" />}
                        </div>
                        <p className="text-[11px] text-blue-200/80 leading-snug mt-1">
                          {isEn ? goal.descEn : goal.descPt}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Custom Goal Input if "Other" is selected */}
              {selectedGoalId === 'other' && (
                <div className="p-4 rounded-2xl bg-[#062863]/50 border border-[#F4CA54]/50 space-y-2 animate-in fade-in duration-150">
                  <label htmlFor="custom-goal-input" className="block text-xs font-bold text-[#F4CA54]">
                    {isEn ? 'Describe your specific reason or goal:' : 'Descreva seu objetivo específico:'}
                  </label>
                  <input
                    id="custom-goal-input"
                    type="text"
                    value={customGoalText}
                    onChange={(e) => setCustomGoalText(e.target.value)}
                    placeholder={isEn ? 'e.g. Preparing for medical conferences abroad' : 'Ex: Preparação para conferências internacionais de medicina'}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[#000035] border border-[#607EC9]/60 text-white text-xs placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#F4CA54]"
                  />
                </div>
              )}

              {/* Requirement 1: English Level Selection ("Beginner", "Intermediate", "Advanced") */}
              <div className="pt-4 border-t border-[#607EC9]/30 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                  <label className="text-xs font-black uppercase tracking-wider text-[#F4CA54] flex items-center gap-1.5">
                    <GraduationCap className="w-4 h-4 text-[#F4CA54]" />
                    <span>{isEn ? 'Select your English Level' : 'Qual o seu nível de inglês?'}</span>
                  </label>
                  <span className="text-[10px] sm:text-[11px] text-blue-200 font-bold">
                    {isEn
                      ? 'Calibrates your YouTube videos & Spotify playlist'
                      : 'Define sua playlist do Spotify e vídeos recomendados'}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  {ENGLISH_LEVEL_OPTIONS.map((lvl) => {
                    const isSelected = studentLevel === lvl.key;
                    return (
                      <button
                        key={lvl.key}
                        type="button"
                        id={`onboarding-level-${lvl.value.toLowerCase()}`}
                        onClick={() => setStudentLevel(lvl.key)}
                        className={`p-3 sm:p-3.5 rounded-2xl border text-left transition cursor-pointer flex flex-col justify-between relative ${
                          isSelected
                            ? 'bg-[#1C4C96] border-[#F4CA54] shadow-md ring-2 ring-[#F4CA54]/40'
                            : 'bg-[#062863]/40 border-[#607EC9]/30 hover:bg-[#062863]/80 hover:border-[#9AB4FF]/50'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-1 w-full">
                          <span className="text-lg">{lvl.icon}</span>
                          <span className="text-[9.5px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md bg-[#000035] text-[#9AB4FF] border border-[#607EC9]/30">
                            {lvl.badge}
                          </span>
                        </div>

                        <div className="mt-2.5">
                          <div className="flex items-center justify-between">
                            <h5 className="font-extrabold text-xs sm:text-[13px] text-white">
                              {isEn ? lvl.titleEn : lvl.titlePt}
                            </h5>
                            {isSelected && <CheckCircle2 className="w-4 h-4 text-[#F4CA54] shrink-0" />}
                          </div>
                          <p className="text-[10.5px] sm:text-[11px] text-blue-200/80 leading-snug mt-1 line-clamp-2">
                            {isEn ? lvl.descEn : lvl.descPt}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* ============================================================ */}
          {/* STEP 2: META DE DIAS DA SEMANA */}
          {/* ============================================================ */}
          {currentStep === 2 && (
            <div className="space-y-4 animate-in fade-in duration-200">
              {/* Official It's Simple Recommendation Box */}
              <div className="p-4 rounded-2xl bg-gradient-to-r from-[#1C4C96]/60 via-[#062863]/80 to-[#1C4C96]/60 border border-[#F4CA54]/50 shadow-sm space-y-2">
                <div className="flex items-center gap-2 text-[#F4CA54]">
                  <Sparkles className="w-4 h-4 shrink-0" />
                  <span className="text-xs font-black uppercase tracking-wider">
                    {isEn ? "It's Simple Golden Recommendation" : "Recomendação Oficial It's Simple"}
                  </span>
                </div>
                <p className="text-xs sm:text-[13px] text-white font-medium leading-relaxed">
                  {isEn
                    ? '"We recommend consuming input content every single day — even a 5-minute video daily makes all the difference in consistency and lasting fluency retention."'
                    : '"Recomendamos o input de conteúdos todos os dias — mesmo um vídeo de 5 minutos diário faz toda a diferença na sua constância e aprendizado."'}
                </p>
              </div>

              {/* Presets Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                {[
                  {
                    days: 2,
                    labelPt: '2x por semana',
                    labelEn: '2x / week',
                    descPt: 'Leve & flexível',
                    descEn: 'Light & flexible',
                  },
                  {
                    days: 3,
                    labelPt: '3x por semana',
                    labelEn: '3x / week',
                    descPt: 'Ritmo constante',
                    descEn: 'Steady pace',
                  },
                  {
                    days: 5,
                    labelPt: '5x por semana',
                    labelEn: '5x / week',
                    descPt: 'Dias úteis (Seg-Sex)',
                    descEn: 'Workdays',
                  },
                  {
                    days: 7,
                    labelPt: '7x por semana',
                    labelEn: '7x / week',
                    descPt: 'Todos os dias ⭐',
                    descEn: 'Every day ⭐',
                    recommended: true,
                  },
                ].map((preset) => {
                  const isSelected = selectedDaysTarget === preset.days;
                  return (
                    <button
                      key={preset.days}
                      type="button"
                      id={`onboarding-freq-${preset.days}`}
                      onClick={() => handleSelectFrequencyPreset(preset.days)}
                      className={`p-3 rounded-2xl border text-center transition cursor-pointer relative ${
                        isSelected
                          ? 'bg-[#1C4C96] border-[#F4CA54] shadow-md ring-2 ring-[#F4CA54]/40'
                          : 'bg-[#062863]/40 border-[#607EC9]/30 hover:bg-[#062863]/80'
                      }`}
                    >
                      {preset.recommended && (
                        <span className="absolute -top-2 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-full bg-[#F4CA54] text-[#000035] text-[9px] font-black uppercase tracking-wider shadow-xs whitespace-nowrap">
                          {isEn ? 'Best Practice' : 'Recomendado'}
                        </span>
                      )}
                      <h4 className="font-black text-sm text-white mt-1">
                        {isEn ? preset.labelEn : preset.labelPt}
                      </h4>
                      <p className="text-[10.5px] text-blue-200/80 mt-0.5">
                        {isEn ? preset.descEn : preset.descPt}
                      </p>
                    </button>
                  );
                })}
              </div>

              {/* Day Pills Selector */}
              <div className="p-4 rounded-2xl bg-[#062863]/40 border border-[#607EC9]/30 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-200">
                    {isEn ? 'Customize practice days:' : 'Dias selecionados para prática:'}
                  </span>
                  <span className="text-xs font-black text-[#F4CA54]">
                    {selectedDays.length} {isEn ? 'days active' : 'dias ativos'}
                  </span>
                </div>

                <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
                  {WEEK_DAYS_CONFIG.map((d) => {
                    const active = selectedDays.includes(d.key);
                    return (
                      <button
                        key={d.key}
                        type="button"
                        id={`onboarding-day-${d.key}`}
                        onClick={() => handleToggleDay(d.key)}
                        className={`py-2 rounded-xl text-xs font-black transition cursor-pointer flex flex-col items-center justify-center border ${
                          active
                            ? 'bg-[#F4CA54] text-[#000035] border-[#F4CA54] shadow-xs'
                            : 'bg-[#000035]/80 text-slate-300 border-[#607EC9]/30 hover:border-white'
                        }`}
                      >
                        <span className="text-[11px]">{isEn ? d.shortEn : d.shortPt}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* ============================================================ */}
          {/* STEP 3: CONFIGURAÇÃO DE HORÁRIOS DA ROTINA */}
          {/* ============================================================ */}
          {currentStep === 3 && (
            <div className="space-y-4 animate-in fade-in duration-200">
              {/* It's Simple Method Guidance */}
              <div className="p-4 rounded-2xl bg-gradient-to-r from-[#1C4C96]/60 via-[#062863]/80 to-[#1C4C96]/60 border border-[#9AB4FF]/50 shadow-sm space-y-2">
                <div className="flex items-center gap-2 text-[#9AB4FF]">
                  <Clock className="w-4 h-4 text-[#F4CA54]" />
                  <span className="text-xs font-black uppercase tracking-wider">
                    {isEn ? 'Micro-habits compound results' : 'Pequenos passos geram grandes resultados'}
                  </span>
                </div>
                <p className="text-xs sm:text-[13px] text-white font-medium leading-relaxed">
                  {isEn
                    ? '"In the It\'s Simple methodology, you combine at least 1 daily video, 1 daily audio/song, and 1 daily sentence to cement your vocabulary in real context without burnout."'
                    : '"Na metodologia It\'s Simple, você combina ao menos 1 vídeo diário, 1 áudio/música e 1 frase autoral para fixar seu vocabulário em contexto real sem sobrecarga."'}
                </p>
              </div>

              {/* Form 3 Dropdowns (Routine Video, Audio, Phrase of the day) */}
              <div className="p-4 sm:p-5 rounded-2xl bg-[#062863]/40 border border-[#607EC9]/30 space-y-4">
                {/* 1. Routine (Video) */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 rounded-xl bg-[#000035]/60 border border-[#607EC9]/30">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-rose-500/20 text-rose-300 flex items-center justify-center font-bold">
                      <Video className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-white">
                        {isEn ? 'Routine (Video)' : 'Rotina (Vídeo)'}
                      </h4>
                      <p className="text-[10px] text-slate-300">
                        {isEn ? '5-min curated YouTube video' : 'Vídeo curto de 5 min curado no YouTube'}
                      </p>
                    </div>
                  </div>

                  <select
                    id="onboarding-video-time"
                    value={routineVideoTime}
                    onChange={(e) => setRoutineVideoTime(e.target.value)}
                    className="px-3 py-1.5 rounded-xl bg-[#062863] border border-[#607EC9] text-white font-bold text-xs cursor-pointer focus:ring-2 focus:ring-[#F4CA54] outline-none"
                  >
                    {TIME_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value} className="bg-[#000035] text-white">
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* 2. Routine (Audio) */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 rounded-xl bg-[#000035]/60 border border-[#607EC9]/30">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-emerald-500/20 text-emerald-300 flex items-center justify-center font-bold">
                      <Headphones className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-white">
                        {isEn ? 'Routine (Audio)' : 'Rotina (Áudio / Música)'}
                      </h4>
                      <p className="text-[10px] text-slate-300">
                        {isEn ? 'Immersion track or Spotify song' : 'Faixa de imersão ou música no Spotify'}
                      </p>
                    </div>
                  </div>

                  <select
                    id="onboarding-audio-time"
                    value={routineAudioTime}
                    onChange={(e) => setRoutineAudioTime(e.target.value)}
                    className="px-3 py-1.5 rounded-xl bg-[#062863] border border-[#607EC9] text-white font-bold text-xs cursor-pointer focus:ring-2 focus:ring-[#F4CA54] outline-none"
                  >
                    {TIME_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value} className="bg-[#000035] text-white">
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* 3. Phrase of the Day */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 rounded-xl bg-[#000035]/60 border border-[#607EC9]/30">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-[#F4CA54]/20 text-[#F4CA54] flex items-center justify-center font-bold">
                      <BookOpen className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-white">
                        {isEn ? 'Phrase of the Day' : 'Frase do Dia'}
                      </h4>
                      <p className="text-[10px] text-slate-300">
                        {isEn ? 'Journal your sentence with learned words' : 'Crie sua frase usando o vocabulário do dia'}
                      </p>
                    </div>
                  </div>

                  <select
                    id="onboarding-phrase-time"
                    value={dailyPhraseTime}
                    onChange={(e) => setDailyPhraseTime(e.target.value)}
                    className="px-3 py-1.5 rounded-xl bg-[#062863] border border-[#607EC9] text-white font-bold text-xs cursor-pointer focus:ring-2 focus:ring-[#F4CA54] outline-none"
                  >
                    {TIME_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value} className="bg-[#000035] text-white">
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <p className="text-[11px] text-slate-400 text-center">
                {isEn
                  ? '💡 You can easily adjust any of these times later directly from your Routine Timeline.'
                  : '💡 Você pode alterar ou reordenar esses horários a qualquer momento no seu painel de rotinas.'}
              </p>
            </div>
          )}

          {/* ============================================================ */}
          {/* STEP 4: ESCOLHA DO AMIGO NATIVO (AULA TESTE) */}
          {/* ============================================================ */}
          {currentStep === 4 && (
            <div className="space-y-4 animate-in fade-in duration-200">
              {/* Highlight Banner: 1 Trial Lesson Included */}
              <div className="p-4 rounded-2xl bg-gradient-to-r from-emerald-600/30 via-[#062863] to-emerald-600/30 border border-emerald-400/60 shadow-sm flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-500 text-white flex items-center justify-center font-black shrink-0 shadow-sm">
                  <Award className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-400 text-[#000035]">
                      {isEn ? '1 Free Trial Lesson Included (25 min)' : '1 Aula Teste Gratuita Incluída (25 min)'}
                    </span>
                    <span className="text-[11px] text-emerald-300 font-bold">
                      {isEn ? 'No upfront commitment' : 'Sem compromisso inicial'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-200 mt-1 leading-snug">
                    {isEn
                      ? 'Pick your preferred Native Friend for your first 25-minute experimental conversation. You can experience the session before deciding on monthly plans!'
                      : 'Escolha seu Amigo Nativo preferido para a sua primeira aula experimental de 25 minutos. Você vivencia a conversa real antes de decidir sobre planos mensais!'}
                  </p>
                </div>
              </div>

              {/* Tutors Cards Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-80 overflow-y-auto pr-1">
                {approvedTutors.map((tutor) => {
                  const isSelected = selectedTutorId === tutor.id || selectedTutorId === tutor.email;
                  return (
                    <div
                      key={tutor.id || tutor.email}
                      id={`onboarding-tutor-${tutor.id || tutor.email}`}
                      onClick={() => setSelectedTutorId(tutor.id || tutor.email)}
                      className={`p-3.5 rounded-2xl border text-left transition cursor-pointer flex flex-col justify-between gap-2.5 relative ${
                        isSelected
                          ? 'bg-[#1C4C96] border-[#F4CA54] shadow-lg ring-2 ring-[#F4CA54]/40'
                          : 'bg-[#062863]/40 border-[#607EC9]/30 hover:bg-[#062863]/80'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <div className="relative shrink-0">
                          {tutor.avatar ? (
                            <img
                              src={tutor.avatar}
                              alt={tutor.name}
                              className="w-12 h-12 rounded-2xl object-cover border-2 border-white/20 shadow-xs"
                            />
                          ) : (
                            <div className="w-12 h-12 rounded-2xl bg-[#000035] text-[#9AB4FF] flex items-center justify-center font-black text-base border border-[#9AB4FF]/40">
                              {tutor.name.charAt(0).toUpperCase()}
                            </div>
                          )}
                          <span className="absolute -bottom-1 -right-1 text-sm">
                            {tutor.flag || '🇺🇸'}
                          </span>
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between">
                            <h4 className="font-black text-xs sm:text-sm text-white truncate">
                              {tutor.name}
                            </h4>
                            {isSelected && <CheckCircle2 className="w-4 h-4 text-[#F4CA54] shrink-0" />}
                          </div>

                          <div className="flex items-center gap-1.5 text-[10px] text-blue-200 mt-0.5">
                            <span className="font-bold">{tutor.country || 'Native Speaker'}</span>
                            <span>•</span>
                            <span className="text-[#F4CA54] font-bold flex items-center gap-0.5">
                              <Star className="w-3 h-3 fill-[#F4CA54] text-[#F4CA54]" />
                              {tutor.rating || 5.0}
                            </span>
                            {tutor.reviewsCount ? (
                              <span className="text-slate-400 text-[9px]">({tutor.reviewsCount})</span>
                            ) : null}
                          </div>

                          <div className="flex items-center gap-1.5 mt-1">
                            <span className="inline-block px-1.5 py-0.2 rounded-md bg-[#000035]/80 text-[#9AB4FF] text-[9px] font-bold">
                              {tutor.accent || 'North American'}
                            </span>
                            {tutor.isSuperTutor && (
                              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded-md bg-amber-500/20 text-[#F4CA54] text-[9px] font-bold border border-[#F4CA54]/30">
                                <Sparkles className="w-2.5 h-2.5" />
                                Super Tutor
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <p className="text-[10.5px] text-slate-300 line-clamp-2 leading-relaxed">
                        {tutor.headline || tutor.bio || 'Conversational Native Friend ready to guide you step by step.'}
                      </p>

                      {tutor.specialties && tutor.specialties.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {tutor.specialties.slice(0, 2).map((sp, idx) => (
                            <span
                              key={idx}
                              className="px-1.5 py-0.2 rounded-md bg-[#1C4C96]/60 text-slate-200 text-[9px] font-medium"
                            >
                              {sp}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Pricing & Actions Row */}
                      <div className="pt-2 border-t border-white/10 flex items-center justify-between gap-2 mt-auto">
                        <div>
                          <div className="flex items-baseline gap-1">
                            <span className="text-xs sm:text-sm font-black text-white">
                              ${tutor.pricePerSessionUsd || 15} USD
                            </span>
                            <span className="text-[9.5px] text-slate-300">
                              / 50 min
                            </span>
                          </div>
                          <span className="text-[9px] font-bold text-emerald-400 block">
                            {isEn ? '1st Lesson Free (25 min)' : '1ª Aula Grátis (25 min)'}
                          </span>
                        </div>

                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setPreviewTutorModal(tutor);
                            }}
                            className="px-2.5 py-1.5 rounded-xl bg-[#000035]/80 hover:bg-[#000035] text-[#9AB4FF] hover:text-white text-[10.5px] font-bold border border-[#607EC9]/40 flex items-center gap-1 transition cursor-pointer"
                            title={isEn ? 'View Profile & Video' : 'Ver Perfil & Vídeo'}
                          >
                            <Play className="w-2.5 h-2.5 fill-[#9AB4FF]" />
                            <span>{isEn ? 'Profile & Video' : 'Perfil & Vídeo'}</span>
                          </button>

                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedTutorId(tutor.id || tutor.email);
                            }}
                            className={`px-2.5 py-1.5 rounded-xl text-[10.5px] font-black transition cursor-pointer flex items-center gap-1 ${
                              isSelected
                                ? 'bg-[#F4CA54] text-[#000035] shadow-xs'
                                : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                            }`}
                          >
                            {isSelected ? (
                              <>
                                <Check className="w-3 h-3 stroke-[3]" />
                                <span>{isEn ? 'Selected' : 'Escolhido'}</span>
                              </>
                            ) : (
                              <span>{isEn ? 'Select' : 'Escolher'}</span>
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Tutor Full Profile & Video Preview Modal */}
              {previewTutorModal && (
                <div
                  className="fixed inset-0 z-[70] flex items-center justify-center bg-black/85 backdrop-blur-xs p-3 sm:p-4 animate-in fade-in duration-150"
                  onClick={(e) => {
                    if (e.target === e.currentTarget) setPreviewTutorModal(null);
                  }}
                >
                  <div className="bg-[#000035] border border-[#607EC9]/50 rounded-3xl max-w-2xl w-full max-h-[92vh] overflow-y-auto shadow-2xl text-white flex flex-col animate-in zoom-in-95 duration-200">
                    {/* Modal Header */}
                    <div className="sticky top-0 z-10 bg-[#000035]/95 backdrop-blur-md p-4 sm:p-5 border-b border-[#607EC9]/30 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="relative shrink-0">
                          {previewTutorModal.avatar ? (
                            <img
                              src={previewTutorModal.avatar}
                              alt={previewTutorModal.name}
                              className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl object-cover border-2 border-white/20 shadow-xs"
                            />
                          ) : (
                            <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-[#062863] text-[#9AB4FF] flex items-center justify-center font-black text-xl border border-[#9AB4FF]/40">
                              {previewTutorModal.name.charAt(0).toUpperCase()}
                            </div>
                          )}
                          <span className="absolute -bottom-1 -right-1 text-base">
                            {previewTutorModal.flag || '🇺🇸'}
                          </span>
                        </div>

                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <h3 className="font-black text-base sm:text-lg text-white truncate">
                              {previewTutorModal.name}
                            </h3>
                            {previewTutorModal.isSuperTutor && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/20 text-[#F4CA54] text-[10px] font-bold border border-[#F4CA54]/40">
                                <Sparkles className="w-3 h-3" />
                                Super Tutor
                              </span>
                            )}
                          </div>

                          <div className="flex flex-wrap items-center gap-2 text-xs text-blue-200 mt-0.5">
                            <span className="font-semibold">{previewTutorModal.country || 'Native Speaker'}</span>
                            <span>•</span>
                            <span className="text-[#9AB4FF]">{previewTutorModal.accent || 'North American Accent'}</span>
                            <span>•</span>
                            <span className="text-[#F4CA54] font-bold flex items-center gap-0.5">
                              <Star className="w-3.5 h-3.5 fill-[#F4CA54] text-[#F4CA54]" />
                              {previewTutorModal.rating || 5.0} ({previewTutorModal.reviewsCount || 12} {isEn ? 'reviews' : 'avaliações'})
                            </span>
                          </div>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => setPreviewTutorModal(null)}
                        className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center cursor-pointer transition shrink-0"
                        aria-label="Close"
                        title="Fechar (Esc)"
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>

                    <div className="p-4 sm:p-6 space-y-5">
                      {/* Free Trial Lesson Guarantee */}
                      <div className="p-3.5 sm:p-4 rounded-2xl bg-gradient-to-r from-emerald-600/30 via-[#062863] to-emerald-600/30 border border-emerald-400/60 flex items-start gap-3">
                        <div className="w-9 h-9 rounded-xl bg-emerald-500 text-white flex items-center justify-center font-black shrink-0 shadow-sm mt-0.5">
                          <Award className="w-5 h-5" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-400 text-[#000035]">
                              {isEn ? '100% Free Trial Lesson (25 min)' : '1ª Aula Teste 100% Gratuita (25 min)'}
                            </span>
                            <span className="text-xs text-emerald-300 font-bold">
                              {isEn ? 'No credit card required now' : 'Sem cartão de crédito ou compromisso'}
                            </span>
                          </div>
                          <p className="text-xs text-slate-200 mt-1 leading-relaxed">
                            {isEn
                              ? `You can choose ${previewTutorModal.name} for your first 25-minute experimental conversation via Google Meet. Test their accent, teaching rhythm, and connection before choosing any monthly plan.`
                              : `Você pode escolher ${previewTutorModal.name} para a sua primeira conversa experimental de 25 minutos via Google Meet. Teste o sotaque, a simpatia e o ritmo antes de escolher qualquer plano.`}
                          </p>
                        </div>
                      </div>

                      {/* Pricing Transparency Card */}
                      <div className="p-4 rounded-2xl bg-[#062863]/60 border border-[#607EC9]/40 space-y-3">
                        <div className="flex items-center justify-between flex-wrap gap-2 border-b border-white/10 pb-2.5">
                          <div className="flex items-center gap-2">
                            <DollarSign className="w-4 h-4 text-[#F4CA54]" />
                            <span className="text-xs font-black uppercase tracking-wider text-white">
                              {isEn ? 'Pricing & Lesson Investment' : 'Valores & Investimento'}
                            </span>
                          </div>
                          <span className="text-[11px] text-emerald-400 font-bold bg-emerald-500/20 px-2 py-0.5 rounded-full">
                            {isEn ? '1st Lesson: Free ($0 USD / 25 min)' : '1ª Aula: Grátis ($0 USD / 25 min)'}
                          </span>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div className="p-3 rounded-xl bg-[#000035]/80 border border-white/10">
                            <span className="text-[10px] text-slate-400 uppercase font-bold block">
                              {isEn ? 'Single / On-demand Lesson (50 min)' : 'Aula Avulsa / Flexível (50 min)'}
                            </span>
                            <div className="flex items-baseline gap-1 mt-1">
                              <span className="text-xl font-black text-white">
                                ${previewTutorModal.pricePerSessionUsd || 15} USD
                              </span>
                              <span className="text-xs text-blue-200 font-semibold">
                                / 50 min
                              </span>
                            </div>
                            <p className="text-[10px] text-slate-300 mt-1">
                              {isEn ? '50 min individual session via Google Meet' : 'Sessão individual de 50 min no Google Meet'}
                            </p>
                          </div>

                          <div className="p-3 rounded-xl bg-[#000035]/80 border border-[#F4CA54]/30">
                            <span className="text-[10px] text-[#F4CA54] uppercase font-bold block">
                              {isEn ? 'Monthly Plans (Post-Trial)' : 'Planos Mensais (Pós-Teste)'}
                            </span>
                            <div className="flex items-baseline gap-1 mt-1">
                              <span className="text-base font-black text-white">
                                {isEn ? 'From $13 USD / lesson' : 'A partir de $13 USD / aula'}
                              </span>
                              <span className="text-[10px] text-emerald-400 font-bold">
                                (até 15% OFF)
                              </span>
                            </div>
                            <p className="text-[10px] text-slate-300 mt-1">
                              {isEn ? 'Options of 1x, 2x or 4x per week with cancel anytime' : 'Opções de 1x, 2x ou 4x por semana sem multas'}
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* Bio / About Section */}
                      <div className="space-y-2">
                        <h4 className="text-xs font-black uppercase tracking-wider text-[#9AB4FF]">
                          {isEn ? 'About the Native Friend' : 'Sobre o Amigo Nativo'}
                        </h4>
                        {previewTutorModal.headline && (
                          <p className="text-sm font-bold text-white">
                            "{previewTutorModal.headline}"
                          </p>
                        )}
                        <p className="text-xs sm:text-[13px] text-slate-200 leading-relaxed whitespace-pre-line">
                          {previewTutorModal.bio || 'Experienced conversational native friend helping students speak naturally in everyday situations.'}
                        </p>
                      </div>

                      {/* Presentation Video Player - Positioned directly below ABOUT THE NATIVE FRIEND */}
                      {(() => {
                        const rawVideoUrl = (
                          previewTutorModal.videoIntroUrl ||
                          previewTutorModal.youtubeUrl ||
                          previewTutorModal.videoUrl ||
                          previewTutorModal.introVideoUrl ||
                          (previewTutorModal.youtubeEmbedId ? `https://www.youtube.com/watch?v=${previewTutorModal.youtubeEmbedId}` : '') ||
                          ''
                        ).trim();

                        const embedId = getYouTubeEmbedId(rawVideoUrl);

                        // If tutor did not register a video, do not render the container
                        if (!embedId && !rawVideoUrl) {
                          return null;
                        }

                        if (embedId) {
                          return (
                            <div id="tutor-presentation-video-container" className="space-y-2">
                              <div className="flex items-center gap-2 text-xs font-bold text-[#9AB4FF]">
                                <Video className="w-4 h-4 text-[#F4CA54]" />
                                <span>{isEn ? 'Presentation Video' : 'Vídeo de Apresentação'}</span>
                              </div>
                              <div className="w-full aspect-video rounded-xl overflow-hidden bg-black border border-white/10 shadow-lg">
                                <iframe
                                  src={`https://www.youtube.com/embed/${embedId}`}
                                  title={`Video by ${previewTutorModal.name}`}
                                  className="w-full h-full border-0"
                                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                                  allowFullScreen
                                />
                              </div>
                            </div>
                          );
                        }

                        // Direct HTML5 video file support
                        if (rawVideoUrl.match(/\.(mp4|webm|ogg)($|\?)/i)) {
                          return (
                            <div id="tutor-presentation-video-container" className="space-y-2">
                              <div className="flex items-center gap-2 text-xs font-bold text-[#9AB4FF]">
                                <Video className="w-4 h-4 text-[#F4CA54]" />
                                <span>{isEn ? 'Presentation Video' : 'Vídeo de Apresentação'}</span>
                              </div>
                              <div className="w-full aspect-video rounded-xl overflow-hidden bg-black border border-white/10 shadow-lg flex items-center justify-center">
                                <video
                                  src={rawVideoUrl}
                                  controls
                                  playsInline
                                  preload="metadata"
                                  className="w-full h-full object-contain bg-black"
                                >
                                  <p className="text-xs text-slate-300 p-4">
                                    {isEn ? 'Your browser does not support HTML5 video.' : 'Seu navegador não suporta vídeos HTML5.'}
                                  </p>
                                </video>
                              </div>
                            </div>
                          );
                        }

                        return null;
                      })()}

                      {/* Specialties & Languages Spoken */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {previewTutorModal.specialties && previewTutorModal.specialties.length > 0 && (
                          <div className="space-y-2">
                            <h4 className="text-xs font-black uppercase tracking-wider text-[#9AB4FF]">
                              {isEn ? 'Specialties' : 'Especialidades'}
                            </h4>
                            <div className="flex flex-wrap gap-1.5">
                              {previewTutorModal.specialties.map((sp, idx) => (
                                <span
                                  key={idx}
                                  className="px-2 py-1 rounded-lg bg-[#1C4C96]/60 text-white text-[11px] font-medium border border-[#607EC9]/40"
                                >
                                  {sp}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                        {previewTutorModal.languagesSpoken && previewTutorModal.languagesSpoken.length > 0 && (
                          <div className="space-y-2">
                            <h4 className="text-xs font-black uppercase tracking-wider text-[#9AB4FF]">
                              {isEn ? 'Languages Spoken' : 'Idiomas Falados'}
                            </h4>
                            <div className="flex flex-wrap gap-1.5">
                              {previewTutorModal.languagesSpoken.map((lang, idx) => (
                                <span
                                  key={idx}
                                  className="px-2 py-1 rounded-lg bg-[#000035] text-[#9AB4FF] text-[11px] font-medium border border-[#607EC9]/30"
                                >
                                  {lang}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Modal Sticky Bottom Actions */}
                    <div className="sticky bottom-0 bg-[#000035]/95 backdrop-blur-md p-4 sm:p-5 border-t border-[#607EC9]/30 flex flex-col sm:flex-row items-center justify-between gap-3">
                      <button
                        type="button"
                        onClick={() => setPreviewTutorModal(null)}
                        className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white font-bold text-xs transition cursor-pointer"
                      >
                        {isEn ? '← Back to Tutors List' : '← Voltar à Lista de Mentores'}
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setSelectedTutorId(previewTutorModal.id || previewTutorModal.email);
                          setPreviewTutorModal(null);
                        }}
                        className="w-full sm:w-auto px-6 py-2.5 rounded-xl bg-[#F4CA54] hover:bg-[#F4CA54]/90 text-[#000035] font-black text-xs sm:text-sm shadow-md transition cursor-pointer flex items-center justify-center gap-2"
                      >
                        <Check className="w-4 h-4 stroke-[3]" />
                        <span>
                          {isEn
                            ? `Select ${previewTutorModal.name} for Free Trial`
                            : `Escolher ${previewTutorModal.name} para Aula Teste`}
                        </span>
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ============================================================ */}
          {/* STEP 5: DIRECIONAMENTO AO PAINEL DO ALUNO & CADASTRO */}
          {/* ============================================================ */}
          {currentStep === 5 && (
            <div className="space-y-4 animate-in fade-in duration-200">
              {/* If user is not logged in: Quick Account Setup */}
              {!currentAccount ? (
                <div className="p-4 sm:p-5 rounded-2xl bg-[#062863]/50 border border-[#607EC9]/40 space-y-3.5">
                  <div className="flex items-center justify-between border-b border-[#607EC9]/30 pb-2.5">
                    <div className="flex items-center gap-2">
                      <User className="w-4 h-4 text-[#F4CA54]" />
                      <span className="text-xs font-black uppercase tracking-wider text-white">
                        {authMode === 'signup'
                          ? (isEn ? 'Create your student account' : 'Crie sua conta de aluno')
                          : (isEn ? 'Log in to your account' : 'Acesse sua conta')}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => setAuthMode(authMode === 'signup' ? 'login' : 'signup')}
                      className="text-[11px] font-bold text-[#F4CA54] hover:underline cursor-pointer"
                    >
                      {authMode === 'signup'
                        ? (isEn ? 'Already have an account? Log in' : 'Já tem conta? Entrar')
                        : (isEn ? 'Need an account? Sign up' : 'Novo aluno? Criar conta')}
                    </button>
                  </div>

                  <div className="space-y-3">
                    {authMode === 'signup' && (
                      <div>
                        <label htmlFor="student-name-input" className="block text-xs font-bold text-slate-300 mb-1">
                          {isEn ? 'Full Name' : 'Nome Completo'}
                        </label>
                        <input
                          id="student-name-input"
                          type="text"
                          value={studentName}
                          onChange={(e) => setStudentName(e.target.value)}
                          placeholder={isEn ? 'e.g. John Doe' : 'Ex: Carlos Silva'}
                          className="w-full px-3 py-2 rounded-xl bg-[#000035] border border-[#607EC9]/50 text-white text-xs placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-[#F4CA54]"
                        />
                      </div>
                    )}

                    <div>
                      <label htmlFor="student-email-input" className="block text-xs font-bold text-slate-300 mb-1">
                        {isEn ? 'Email Address' : 'Endereço de Email'}
                      </label>
                      <input
                        id="student-email-input"
                        type="email"
                        value={studentEmail}
                        onChange={(e) => setStudentEmail(e.target.value)}
                        placeholder="seuemail@exemplo.com"
                        className="w-full px-3 py-2 rounded-xl bg-[#000035] border border-[#607EC9]/50 text-white text-xs placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-[#F4CA54]"
                      />
                    </div>

                    <div>
                      <label htmlFor="student-password-input" className="block text-xs font-bold text-slate-300 mb-1">
                        {isEn ? 'Password' : 'Senha'}
                      </label>
                      <div className="relative">
                        <input
                          id="student-password-input"
                          type={showPassword ? 'text' : 'password'}
                          value={studentPassword}
                          onChange={(e) => setStudentPassword(e.target.value)}
                          placeholder="••••••••"
                          className="w-full pl-3 pr-10 py-2 rounded-xl bg-[#000035] border border-[#607EC9]/50 text-white text-xs placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-[#F4CA54]"
                        />
                        <button
                          type="button"
                          id="student-password-toggle-btn"
                          onClick={() => setShowPassword((prev) => !prev)}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white transition-colors p-1 cursor-pointer"
                          aria-label={showPassword ? (isEn ? 'Hide password' : 'Ocultar senha') : (isEn ? 'Show password' : 'Ver senha')}
                          title={showPassword ? (isEn ? 'Hide password' : 'Ocultar senha') : (isEn ? 'Show password' : 'Ver senha')}
                        >
                          {showPassword ? (
                            <EyeOff className="w-4 h-4 text-[#F4CA54]" />
                          ) : (
                            <Eye className="w-4 h-4" />
                          )}
                        </button>
                      </div>
                    </div>

                    {authMode === 'signup' && (
                      <div>
                        <label htmlFor="student-level-select" className="block text-xs font-bold text-slate-300 mb-1">
                          {isEn ? 'English Level' : 'Nível de Inglês'}
                        </label>
                        <select
                          id="student-level-select"
                          value={studentLevel}
                          onChange={(e) => setStudentLevel(e.target.value as EnglishLevel)}
                          className="w-full px-3 py-2 rounded-xl bg-[#000035] border border-[#607EC9]/50 text-white text-xs focus:outline-none focus:ring-2 focus:ring-[#F4CA54] cursor-pointer"
                        >
                          <option value={EnglishLevel.BEGINNER} className="bg-[#000035] text-white">
                            🌱 {isEn ? 'Beginner (Iniciante - A1/A2)' : 'Iniciante / Beginner (A1/A2)'}
                          </option>
                          <option value={EnglishLevel.INTERMEDIATE} className="bg-[#000035] text-white">
                            🌿 {isEn ? 'Intermediate (Intermediário - B1/B2)' : 'Intermediário / Intermediate (B1/B2)'}
                          </option>
                          <option value={EnglishLevel.ADVANCED} className="bg-[#000035] text-white">
                            🌳 {isEn ? 'Advanced (Avançado - C1/C2)' : 'Avançado / Advanced (C1/C2)'}
                          </option>
                        </select>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                /* Already logged in: Profile Summary Confirmation */
                <div className="p-4 rounded-2xl bg-[#062863]/40 border border-[#607EC9]/40 space-y-2">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-[#1C4C96] text-[#F4CA54] flex items-center justify-center font-black text-sm border border-[#F4CA54]/40">
                      {currentAccount.name?.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <h4 className="text-sm font-extrabold text-white">
                        {currentAccount.name}
                      </h4>
                      <p className="text-xs text-[#9AB4FF]">
                        {currentAccount.email} • {isEn ? 'Active Student' : 'Aluno Ativo'}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Linking Summary Card */}
              <div className="p-4 rounded-2xl bg-gradient-to-br from-[#062863] via-[#000035] to-[#1C4C96]/60 border border-[#F4CA54]/50 space-y-3 shadow-md">
                <div className="flex items-center gap-2 text-[#F4CA54]">
                  <Sparkles className="w-4 h-4" />
                  <span className="text-xs font-black uppercase tracking-wider">
                    {isEn ? 'Profile Binding Summary' : 'Resumo de Vinculação do Perfil'}
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
                  <div className="p-2.5 rounded-xl bg-[#000035]/70 border border-[#607EC9]/30">
                    <span className="text-[10px] text-slate-400 block font-medium">
                      {isEn ? 'Assigned Native Friend' : 'Amigo Nativo Vinculado'}
                    </span>
                    <span className="font-extrabold text-white flex items-center gap-1.5 mt-0.5">
                      <span>{selectedTutor?.flag || '🇺🇸'}</span>
                      <span className="truncate">{selectedTutor?.name || 'Native Friend'}</span>
                    </span>
                  </div>

                  <div className="p-2.5 rounded-xl bg-[#000035]/70 border border-[#607EC9]/30">
                    <span className="text-[10px] text-slate-400 block font-medium">
                      {isEn ? 'English Level' : 'Nível de Inglês'}
                    </span>
                    <span className="font-extrabold text-[#F4CA54] flex items-center gap-1.5 mt-0.5">
                      <span>{studentLevel === EnglishLevel.INTERMEDIATE ? '🌿' : studentLevel === EnglishLevel.ADVANCED ? '🌳' : '🌱'}</span>
                      <span>{studentLevel === EnglishLevel.INTERMEDIATE ? 'Intermediate' : studentLevel === EnglishLevel.ADVANCED ? 'Advanced' : 'Beginner'}</span>
                    </span>
                  </div>

                  <div className="p-2.5 rounded-xl bg-[#000035]/70 border border-[#607EC9]/30">
                    <span className="text-[10px] text-slate-400 block font-medium">
                      {isEn ? 'Practice Target' : 'Meta de Prática'}
                    </span>
                    <span className="font-extrabold text-emerald-300 mt-0.5 block">
                      {selectedDaysTarget}x {isEn ? 'per week' : 'por semana'}
                    </span>
                  </div>

                  <div className="p-2.5 rounded-xl bg-[#000035]/70 border border-[#607EC9]/30 col-span-2 sm:col-span-2">
                    <span className="text-[10px] text-slate-400 block font-medium">
                      {isEn ? 'Primary Goal' : 'Objetivo'}
                    </span>
                    <span className="font-extrabold text-[#F4CA54] truncate block mt-0.5">
                      {getFinalLearningGoal()}
                    </span>
                  </div>

                  <div className="p-2.5 rounded-xl bg-[#000035]/70 border border-[#607EC9]/30 col-span-2 sm:col-span-1">
                    <span className="text-[10px] text-slate-400 block font-medium">
                      {isEn ? 'Trial Lesson Balance' : 'Saldo de Aula Teste'}
                    </span>
                    <span className="font-extrabold text-white mt-0.5 block">
                      1 {isEn ? 'lesson ready' : 'aula disponível'}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ============================================================ */}
          {/* STEP 6: ORIENTAÇÃO DA PRIMEIRA SEMANA */}
          {/* ============================================================ */}
          {currentStep === 6 && (
            <div className="space-y-4 animate-in fade-in duration-200">
              {/* Congratulatory Banner */}
              <div className="p-4 sm:p-5 rounded-2xl bg-gradient-to-r from-emerald-600/30 via-[#000035] to-emerald-600/30 border border-emerald-400/60 shadow-lg text-center space-y-2">
                <div className="w-12 h-12 rounded-full bg-emerald-500 text-white flex items-center justify-center font-black mx-auto shadow-md">
                  <Check className="w-6 h-6" />
                </div>
                <h3 className="text-lg font-black text-white">
                  {isEn ? 'Setup Completed! Welcome to It\'s Simple!' : 'Tudo Pronto! Bem-vindo(a) ao It\'s Simple!'}
                </h3>
                <p className="text-xs text-slate-200 max-w-md mx-auto leading-relaxed">
                  {isEn
                    ? `Your Native Friend ${selectedTutor?.name} is linked. Now complete these two essential steps to kick off your English journey:`
                    : `Seu Amigo Nativo ${selectedTutor?.name} foi vinculado com sucesso. Siga estes dois passos fundamentais para começar sua jornada:`}
                </p>
              </div>

              {/* Two Fundamental Steps */}
              <div className="space-y-3">
                {/* Step A: Schedule 1st Trial Lesson */}
                <div className="p-4 rounded-2xl bg-[#062863]/60 border border-[#607EC9]/40 flex items-start gap-3.5">
                  <div className="w-8 h-8 rounded-xl bg-[#F4CA54] text-[#000035] flex items-center justify-center font-black text-sm shrink-0 shadow-xs mt-0.5">
                    1
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="text-xs sm:text-sm font-black text-white">
                      {isEn ? 'Schedule your 1st Trial Lesson (25 min)' : 'Agende sua 1ª Aula Teste Experimental (25 min)'}
                    </h4>
                    <p className="text-[11.5px] text-blue-100/80 mt-1 leading-relaxed">
                      {isEn
                        ? `Pick a convenient time slot with ${selectedTutor?.name} via Google Meet to meet each other, discuss your goal (${getFinalLearningGoal()}), and unlock real speaking.`
                        : `Escolha um horário conveniente com ${selectedTutor?.name} via Google Meet para se conhecerem, alinhar seu objetivo (${getFinalLearningGoal()}) e praticar sem travas.`}
                    </p>

                    <button
                      type="button"
                      id="onboarding-schedule-trial-btn"
                      onClick={handleBookTrialLesson}
                      className="mt-2.5 px-4 py-2 rounded-xl bg-[#F4CA54] hover:bg-amber-400 text-[#000035] font-black text-xs transition cursor-pointer shadow-xs flex items-center gap-1.5"
                    >
                      <Calendar className="w-3.5 h-3.5" />
                      <span>{isEn ? 'Schedule My 1st Lesson Now' : 'Agendar Minha 1ª Aula Teste Agora'}</span>
                    </button>
                  </div>
                </div>

                {/* Step B: Start New Week */}
                <div className="p-4 rounded-2xl bg-[#062863]/60 border border-[#607EC9]/40 flex items-start gap-3.5">
                  <div className="w-8 h-8 rounded-xl bg-[#9AB4FF] text-[#000035] flex items-center justify-center font-black text-sm shrink-0 shadow-xs mt-0.5">
                    2
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="text-xs sm:text-sm font-black text-white">
                      {isEn ? 'Click "Start New Week" in your Workspace' : 'Clique em "Start New Week" no seu Painel'}
                    </h4>
                    <p className="text-[11.5px] text-blue-100/80 mt-1 leading-relaxed">
                      {isEn
                        ? 'The "Start New Week" button calibrates your weekly cycle and automatically generates your daily YouTube videos, Spotify audio tracks, and vocabulary challenges.'
                        : 'O botão "Start New Week" calibra seu ciclo semanal e carrega automaticamente seus vídeos do YouTube, músicas do Spotify e desafios de vocabulário para cada dia da semana.'}
                    </p>

                    <button
                      type="button"
                      id="onboarding-start-week-btn"
                      onClick={handleFinishToDashboard}
                      className="mt-2.5 px-4 py-2 rounded-xl bg-[#1C4C96] hover:bg-[#607EC9] text-white font-extrabold text-xs transition cursor-pointer border border-[#9AB4FF]/50 shadow-xs flex items-center gap-1.5"
                    >
                      <Play className="w-3.5 h-3.5" />
                      <span>{isEn ? 'Go to Dashboard & Start Week' : 'Ir para o Painel & Iniciar Semana'}</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Modal Bottom Footer Navigation */}
        <div className="px-5 sm:px-6 py-4 bg-[#000025] border-t border-[#607EC9]/30 flex items-center justify-between gap-3">
          {currentStep > 1 && currentStep < 6 ? (
            <button
              type="button"
              id="onboarding-back-btn"
              onClick={() => {
                setErrorMessage(null);
                setCurrentStep((prev) => Math.max(1, prev - 1));
              }}
              className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-slate-200 font-bold text-xs transition cursor-pointer flex items-center gap-1.5"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>{isEn ? 'Back' : 'Voltar'}</span>
            </button>
          ) : currentStep === 1 ? (
            <button
              type="button"
              id="onboarding-cancel-btn"
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-slate-200 font-bold text-xs transition cursor-pointer flex items-center gap-1.5"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>{isEn ? 'Cancel & Return Home' : 'Cancelar & Voltar ao Início'}</span>
            </button>
          ) : (
            <div />
          )}

          {currentStep < 5 && (
            <button
              type="button"
              id="onboarding-next-btn"
              onClick={() => {
                setErrorMessage(null);
                setCurrentStep((prev) => Math.min(6, prev + 1));
              }}
              className="px-6 py-2.5 rounded-xl bg-[#F4CA54] hover:bg-amber-400 text-[#000035] font-black text-xs sm:text-sm transition cursor-pointer shadow-md flex items-center gap-1.5"
            >
              <span>{isEn ? 'Next Step' : 'Próximo Passo'}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          )}

          {currentStep === 5 && (
            <button
              type="button"
              id="onboarding-save-btn"
              disabled={isSubmitting}
              onClick={handleSaveAndAdvance}
              className="px-6 py-2.5 rounded-xl bg-[#F4CA54] hover:bg-amber-400 text-[#000035] font-black text-xs sm:text-sm transition cursor-pointer shadow-md flex items-center gap-1.5 disabled:opacity-50"
            >
              {isSubmitting ? (
                <span>{isEn ? 'Saving Profile...' : 'Salvando Perfil...'}</span>
              ) : (
                <>
                  <span>{isEn ? 'Save & Continue' : 'Salvar & Continuar'}</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          )}

          {currentStep === 6 && (
            <button
              type="button"
              id="onboarding-finish-btn"
              onClick={handleFinishToDashboard}
              className="px-6 py-2.5 rounded-xl bg-[#F4CA54] hover:bg-amber-400 text-[#000035] font-black text-xs sm:text-sm transition cursor-pointer shadow-md flex items-center gap-1.5"
            >
              <span>{isEn ? 'Enter My Learning Space' : 'Entrar no Meu Espaço de Prática'}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
