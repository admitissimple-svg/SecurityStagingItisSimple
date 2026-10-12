import React, { useState, useMemo, useEffect } from 'react';
import {
  X,
  UserCheck,
  UserX,
  CheckCircle,
  CheckCircle2,
  AlertTriangle,
  Globe,
  Sparkles,
  Award,
  Video,
  ExternalLink,
  ShoppingBag,
  CreditCard,
  QrCode,
  ArrowLeft,
  Check,
  ShieldCheck,
  Clock,
  ChevronRight,
  Star,
  ArrowLeftRight,
  RefreshCw,
  CalendarCheck,
} from 'lucide-react';
import { GoogleAccount, Language, NativeFriendTutor, UserProfile } from '../types';

interface LessonPackageOption {
  lessonsCount: number;
  labelPt: string;
  labelEn: string;
  priceBrl: number;
  priceUsd: number;
  baseTotalUsd: number;
  baseTotalBrl: number;
  discountPercent: number;
  pricePerLessonUsd: number;
  pricePerLessonBrl: number;
  discountBadgePt?: string;
  discountBadgeEn?: string;
  isPopular?: boolean;
  isBestValue?: boolean;
  descriptionPt: string;
  descriptionEn: string;
  frequency?: '1x' | '2x' | '3x';
  isRecurringMonthly?: boolean;
}

export function generateLessonPackages(
  baseRateUsd: number,
  baseRateBrl?: number
): { monthly: LessonPackageOption[]; flexible: LessonPackageOption[] } {
  const safeUsd = Number(baseRateUsd) > 0 ? Number(baseRateUsd) : 15;
  const safeBrl = Number(baseRateBrl) > 0 ? Number(baseRateBrl) : Math.round(safeUsd * 5.5);

  const calcUsd = (count: number, discountPct: number) => {
    const raw = count * safeUsd * (1 - discountPct / 100);
    return Math.round(raw * 100) / 100;
  };

  const calcBrl = (count: number, discountPct: number) => {
    const raw = count * safeBrl * (1 - discountPct / 100);
    return Math.round(raw);
  };

  const monthly: LessonPackageOption[] = [
    {
      lessonsCount: 4,
      frequency: '1x',
      isRecurringMonthly: true,
      labelPt: '1x por semana (4 aulas/mês)',
      labelEn: '1x per week (4 lessons/mo)',
      discountPercent: 5,
      baseTotalUsd: 4 * safeUsd,
      baseTotalBrl: 4 * safeBrl,
      priceUsd: calcUsd(4, 5),
      priceBrl: calcBrl(4, 5),
      pricePerLessonUsd: Math.round((calcUsd(4, 5) / 4) * 100) / 100,
      pricePerLessonBrl: Math.round(calcBrl(4, 5) / 4),
      discountBadgePt: '5% OFF • RECORRÊNCIA MENSAL',
      discountBadgeEn: '5% OFF • MONTHLY AUTO-RENEW',
      descriptionPt: '1 encontro semanal com seu Amigo Nativo para manter contato constante e hábitos sólidos.',
      descriptionEn: '1 weekly session with your Native Friend for steady practice and solid habits.',
    },
    {
      lessonsCount: 8,
      frequency: '2x',
      isRecurringMonthly: true,
      labelPt: '2x por semana (8 aulas/mês)',
      labelEn: '2x per week (8 lessons/mo)',
      discountPercent: 10,
      baseTotalUsd: 8 * safeUsd,
      baseTotalBrl: 8 * safeBrl,
      priceUsd: calcUsd(8, 10),
      priceBrl: calcBrl(8, 10),
      pricePerLessonUsd: Math.round((calcUsd(8, 10) / 8) * 100) / 100,
      pricePerLessonBrl: Math.round(calcBrl(8, 10) / 8),
      discountBadgePt: 'MAIS RECOMENDADO • 10% OFF',
      discountBadgeEn: 'MOST POPULAR • 10% OFF',
      isPopular: true,
      descriptionPt: 'Ritmo ideal de imersão para destravar fluência, segurança e vocabulário ativo.',
      descriptionEn: 'Ideal immersion rhythm to unlock fluency, confidence and active vocabulary.',
    },
    {
      lessonsCount: 12,
      frequency: '3x',
      isRecurringMonthly: true,
      labelPt: '3x por semana (12 aulas/mês)',
      labelEn: '3x per week (12 lessons/mo)',
      discountPercent: 15,
      baseTotalUsd: 12 * safeUsd,
      baseTotalBrl: 12 * safeBrl,
      priceUsd: calcUsd(12, 15),
      priceBrl: calcBrl(12, 15),
      pricePerLessonUsd: Math.round((calcUsd(12, 15) / 12) * 100) / 100,
      pricePerLessonBrl: Math.round(calcBrl(12, 15) / 12),
      discountBadgePt: 'IMERSÃO INTENSIVA • 15% OFF',
      discountBadgeEn: 'INTENSIVE IMMERSION • 15% OFF',
      isBestValue: true,
      descriptionPt: 'Aceleração máxima: viva o inglês quase todos os dias com seu mentor dedicado.',
      descriptionEn: 'Maximum speed: live English almost every day with your dedicated mentor.',
    },
  ];

  const flexible: LessonPackageOption[] = [
    {
      lessonsCount: 1,
      labelPt: '1 Aula Avulsa',
      labelEn: '1 Single Lesson',
      discountPercent: 0,
      baseTotalUsd: safeUsd,
      baseTotalBrl: safeBrl,
      priceUsd: safeUsd,
      priceBrl: safeBrl,
      pricePerLessonUsd: safeUsd,
      pricePerLessonBrl: safeBrl,
      descriptionPt: 'Ideal para experimentar a dinâmica e conhecer seu novo Amigo Nativo.',
      descriptionEn: 'Perfect to test the dynamic and meet your new Native Friend.',
    },
    {
      lessonsCount: 4,
      labelPt: 'Pacote 4 Aulas',
      labelEn: '4 Lessons Pack',
      discountPercent: 5,
      baseTotalUsd: 4 * safeUsd,
      baseTotalBrl: 4 * safeBrl,
      priceUsd: calcUsd(4, 5),
      priceBrl: calcBrl(4, 5),
      pricePerLessonUsd: Math.round((calcUsd(4, 5) / 4) * 100) / 100,
      pricePerLessonBrl: Math.round(calcBrl(4, 5) / 4),
      discountBadgePt: '5% OFF',
      discountBadgeEn: '5% OFF',
      descriptionPt: 'Começo consistente para destravar a fala no dia a dia.',
      descriptionEn: 'Consistent start to unlock daily conversation.',
    },
    {
      lessonsCount: 8,
      labelPt: 'Pacote 8 Aulas',
      labelEn: '8 Lessons Pack',
      discountPercent: 10,
      baseTotalUsd: 8 * safeUsd,
      baseTotalBrl: 8 * safeBrl,
      priceUsd: calcUsd(8, 10),
      priceBrl: calcBrl(8, 10),
      pricePerLessonUsd: Math.round((calcUsd(8, 10) / 8) * 100) / 100,
      pricePerLessonBrl: Math.round(calcBrl(8, 10) / 8),
      discountBadgePt: 'MAIS POPULAR • 10% OFF',
      discountBadgeEn: 'MOST POPULAR • 10% OFF',
      isPopular: true,
      descriptionPt: 'Recomendado para manter encontros regulares e fixar vocabulário real.',
      descriptionEn: 'Recommended for regular sessions and solid routine retention.',
    },
    {
      lessonsCount: 12,
      labelPt: 'Pacote 12 Aulas',
      labelEn: '12 Lessons Pack',
      discountPercent: 15,
      baseTotalUsd: 12 * safeUsd,
      baseTotalBrl: 12 * safeBrl,
      priceUsd: calcUsd(12, 15),
      priceBrl: calcBrl(12, 15),
      pricePerLessonUsd: Math.round((calcUsd(12, 15) / 12) * 100) / 100,
      pricePerLessonBrl: Math.round(calcBrl(12, 15) / 12),
      discountBadgePt: 'MELHOR VALOR • 15% OFF',
      discountBadgeEn: 'BEST VALUE • 15% OFF',
      isBestValue: true,
      descriptionPt: 'Imersão completa para alcançar fluência conversacional acelerada.',
      descriptionEn: 'Full immersion to reach conversational fluency faster.',
    },
  ];

  return { monthly, flexible };
}

const defaultPackageSet = generateLessonPackages(15);
export const MONTHLY_PACKAGES: LessonPackageOption[] = defaultPackageSet.monthly;
export const FLEXIBLE_PACKAGES: LessonPackageOption[] = defaultPackageSet.flexible;
const LESSON_PACKAGES: LessonPackageOption[] = [...MONTHLY_PACKAGES, ...FLEXIBLE_PACKAGES];

interface ManageSubscriptionModalProps {
  isOpen: boolean;
  onClose: () => void;
  userProfile: UserProfile | null;
  tutorsList: NativeFriendTutor[];
  teachers: GoogleAccount[];
  currentLanguage: Language;
  onUpdateSubscription: (teacherEmail: string | null, teacherName: string | null) => Promise<void>;
  onPurchasePackage?: (params: {
    teacherEmail: string;
    teacherName: string;
    packageLessons: number;
    packagePriceBrl: number;
    packagePriceUsd: number;
    paymentMethod: string;
    isRecurringMonthly?: boolean;
    monthlyFrequency?: string;
  }) => Promise<any>;
  onScheduleTrialLessonWithTutor?: (tutor: NativeFriendTutor) => void;
  initialSelectedTutor?: NativeFriendTutor | null;
}

export const ManageSubscriptionModal: React.FC<ManageSubscriptionModalProps> = ({
  isOpen,
  onClose,
  userProfile,
  tutorsList,
  teachers,
  currentLanguage,
  onUpdateSubscription,
  onPurchasePackage,
  onScheduleTrialLessonWithTutor,
  initialSelectedTutor,
}) => {
  const isEn = currentLanguage === 'en';
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState<boolean>(false);
  const [feedbackMsg, setFeedbackMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // State to control visibility of the full tutors list when student already has an active tutor
  const [showAvailableTutors, setShowAvailableTutors] = useState<boolean>(false);
  const [showTrialLessonPicker, setShowTrialLessonPicker] = useState<boolean>(false);

  // Package category tab: monthly recurring vs flexible packages
  const [packageCategoryTab, setPackageCategoryTab] = useState<'monthly' | 'flexible'>('monthly');

  // Purchase Package Flow State
  const [selectedTutorForPurchase, setSelectedTutorForPurchase] = useState<NativeFriendTutor | null>(
    initialSelectedTutor || null
  );
  const [selectedPackageLessons, setSelectedPackageLessons] = useState<number>(8); // default to 2x/week (8 lessons)
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<'pix' | 'credit_card'>('pix');
  const [purchaseCompleted, setPurchaseCompleted] = useState<boolean>(false);

  // Sync initialSelectedTutor and reset states when modal opens
  useEffect(() => {
    if (isOpen) {
      setShowAvailableTutors(false);
      setShowTrialLessonPicker(false);
      setShowCancelConfirm(false);
      setFeedbackMsg(null);
      if (initialSelectedTutor) {
        setSelectedTutorForPurchase(initialSelectedTutor);
      }
    }
  }, [isOpen, initialSelectedTutor]);

  const currentTeacherEmail = (userProfile?.teacherEmail || '').toLowerCase().trim();
  const currentTeacherName = userProfile?.teacherName || '';

  // Find matching tutor info if available
  const currentTutor = tutorsList.find(
    (t) => t.email.toLowerCase() === currentTeacherEmail
  ) || (currentTeacherEmail ? {
    id: `tutor-${currentTeacherEmail}`,
    name: currentTeacherName || currentTeacherEmail.split('@')[0],
    email: currentTeacherEmail,
    pricePerSessionUsd: 15,
    pricePerSessionBrl: 83,
  } as NativeFriendTutor : undefined);

  // Active base lesson rates dynamically derived from selected tutor (or current tutor / fallback 15 USD)
  const activeBaseRateUsd = Number(selectedTutorForPurchase?.pricePerSessionUsd) > 0
    ? Number(selectedTutorForPurchase?.pricePerSessionUsd)
    : (Number(currentTutor?.pricePerSessionUsd) > 0 ? Number(currentTutor?.pricePerSessionUsd) : 15);

  const activeBaseRateBrl = Number(selectedTutorForPurchase?.pricePerSessionBrl) > 0
    ? Number(selectedTutorForPurchase?.pricePerSessionBrl)
    : (Number(currentTutor?.pricePerSessionBrl) > 0 ? Number(currentTutor?.pricePerSessionBrl) : Math.round(activeBaseRateUsd * 5.5));

  // Dynamically calculate packages strictly with 5%, 10%, 15% volume discounts based on the tutor's registered base rate
  const { monthly: dynamicMonthlyPackages, flexible: dynamicFlexiblePackages } = useMemo(() => {
    return generateLessonPackages(activeBaseRateUsd, activeBaseRateBrl);
  }, [activeBaseRateUsd, activeBaseRateBrl]);

  const activePackageList = packageCategoryTab === 'monthly' ? dynamicMonthlyPackages : dynamicFlexiblePackages;

  const selectedPkg = activePackageList.find((p) => p.lessonsCount === selectedPackageLessons)
    || activePackageList.find((p) => p.lessonsCount === 8)
    || activePackageList[0];

  const approvedTutors = useMemo(() => {
    return tutorsList.filter((t) => (t.approvalStatus || 'approved') === 'approved');
  }, [tutorsList]);

  const hasActiveSubscription = Boolean(
    currentTeacherEmail &&
    currentTeacherEmail.trim() !== '' &&
    userProfile?.enrollmentStatus !== 'cancelled' &&
    userProfile?.enrollmentStatus !== 'not_enrolled'
  );

  // Section "Amigos Nativos Disponíveis" is only shown if student has no active tutor OR explicitly clicks "Substituir Amigo Nativo"
  const shouldShowAvailableTutors = !hasActiveSubscription || showAvailableTutors;

  const handleCancelSubscription = async () => {
    setIsProcessing(true);
    try {
      await onUpdateSubscription(null, null);
      setShowCancelConfirm(false);
      setFeedbackMsg({
        type: 'success',
        text: isEn
          ? 'Subscription cancelled. You can select another Native Friend anytime!'
          : 'Inscrição cancelada com sucesso. Você pode escolher outro Amigo Nativo e adquirir um pacote a qualquer momento!',
      });
      setTimeout(() => {
        setFeedbackMsg(null);
      }, 4000);
    } catch (err) {
      setFeedbackMsg({
        type: 'error',
        text: isEn ? 'Failed to cancel subscription.' : 'Erro ao cancelar inscrição.',
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSelectTutorDirectly = async (email: string, name: string) => {
    setIsProcessing(true);
    try {
      await onUpdateSubscription(email, name);
      setFeedbackMsg({
        type: 'success',
        text: isEn
          ? `Successfully switched to ${name}! They are now your fixed Native Friend.`
          : `Vinculado com sucesso a ${name}! Agora este é seu Amigo Nativo fixo.`,
      });
      setTimeout(() => {
        setFeedbackMsg(null);
        onClose();
      }, 2000);
    } catch (err) {
      setFeedbackMsg({
        type: 'error',
        text: isEn ? 'Failed to select Native Friend.' : 'Erro ao selecionar Amigo Nativo.',
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleConfirmPurchase = async () => {
    if (!selectedTutorForPurchase) return;

    const pkg = selectedPkg;
    setIsProcessing(true);
    try {
      if (onPurchasePackage) {
        await onPurchasePackage({
          teacherEmail: selectedTutorForPurchase.email,
          teacherName: selectedTutorForPurchase.name,
          packageLessons: pkg.lessonsCount,
          packagePriceBrl: pkg.priceBrl,
          packagePriceUsd: pkg.priceUsd,
          paymentMethod: selectedPaymentMethod,
          isRecurringMonthly: pkg.isRecurringMonthly,
          monthlyFrequency: pkg.frequency,
        });
      } else {
        // Fallback: update subscription directly
        await onUpdateSubscription(selectedTutorForPurchase.email, selectedTutorForPurchase.name);
      }

      setPurchaseCompleted(true);
      setFeedbackMsg({
        type: 'success',
        text: isEn
          ? `Package of ${pkg.lessonsCount} lessons purchased! ${selectedTutorForPurchase.name} is now your fixed Native Friend.`
          : `Pacote de ${pkg.lessonsCount} aulas adquirido com sucesso! ${selectedTutorForPurchase.name} agora é seu Amigo Nativo fixo.`,
      });

      setTimeout(() => {
        setPurchaseCompleted(false);
        setSelectedTutorForPurchase(null);
        onClose();
      }, 2500);
    } catch (err) {
      setFeedbackMsg({
        type: 'error',
        text: isEn ? 'Payment processing failed. Please try again.' : 'Erro ao processar compra. Tente novamente.',
      });
    } finally {
      setIsProcessing(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-[#000035]/70 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6 overflow-y-auto">
      <div className="bg-white rounded-3xl max-w-2xl w-full shadow-2xl border border-[#607EC9]/30 overflow-hidden my-auto max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 bg-[#000035] text-white flex items-center justify-between border-b border-[#1C4C96] shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-[#1C4C96] flex items-center justify-center text-white shadow-xs border border-[#9AB4FF]/40">
              {selectedTutorForPurchase ? (
                <ShoppingBag className="w-5 h-5 text-[#9AB4FF]" />
              ) : (
                <UserCheck className="w-5 h-5 text-[#9AB4FF]" />
              )}
            </div>
            <div>
              <h3 className="font-black text-base sm:text-lg text-white">
                {selectedTutorForPurchase
                  ? (isEn ? 'Buy Lesson Package & Bind Native Friend' : 'Comprar Pacote & Vincular Amigo Nativo')
                  : (isEn ? 'Native Friend & Lesson Packages' : 'Amigo Nativo & Pacotes de Aulas')}
              </h3>
              <p className="text-xs text-[#9AB4FF]">
                {selectedTutorForPurchase
                  ? (isEn
                      ? `Select package with ${selectedTutorForPurchase.name}`
                      : `Escolha o pacote com ${selectedTutorForPurchase.name} para fixá-lo como seu tutor`)
                  : (isEn
                      ? 'Browse native friends, select packages, and manage your subscription'
                      : 'Navegue pelos amigos nativos, compre pacotes e gerencie sua inscrição')}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl text-[#9AB4FF] hover:text-white hover:bg-[#1C4C96] transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="p-4 sm:p-6 space-y-6 overflow-y-auto overflow-x-hidden">
          {/* Feedback Banner */}
          {feedbackMsg && (
            <div
              className={`p-3.5 rounded-2xl text-xs font-bold flex items-center gap-2.5 ${
                feedbackMsg.type === 'success'
                  ? 'bg-emerald-50 text-emerald-800 border border-emerald-300'
                  : 'bg-red-50 text-red-800 border border-red-300'
              }`}
            >
              {feedbackMsg.type === 'success' ? (
                <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
              )}
              <span>{feedbackMsg.text}</span>
            </div>
          )}

          {/* VIEW MODE 1: PACKAGE PURCHASE FOR A SPECIFIC TUTOR */}
          {selectedTutorForPurchase ? (
            <div className="space-y-5">
              {/* Back to list button */}
              <button
                type="button"
                onClick={() => {
                  setSelectedTutorForPurchase(null);
                  setPurchaseCompleted(false);
                }}
                className="inline-flex items-center gap-1.5 text-xs font-bold text-[#1C4C96] hover:text-[#062863] transition cursor-pointer"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>{isEn ? 'Back to Native Friends list' : 'Voltar para lista de Amigos Nativos'}</span>
              </button>

              {/* Selected Tutor Card */}
              <div className="bg-[#9AB4FF]/10 rounded-2xl border border-[#607EC9]/30 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-14 h-14 rounded-2xl bg-[#062863] text-white flex items-center justify-center font-black text-lg border border-[#9AB4FF]/40 shadow-xs shrink-0 overflow-hidden">
                    {selectedTutorForPurchase.avatar && selectedTutorForPurchase.avatar.trim() !== '' ? (
                      <img
                        src={selectedTutorForPurchase.avatar}
                        alt={selectedTutorForPurchase.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      selectedTutorForPurchase.name.slice(0, 2).toUpperCase()
                    )}
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <h4 className="font-black text-base text-[#000035]">{selectedTutorForPurchase.name}</h4>
                      <span className="text-base">{selectedTutorForPurchase.flag}</span>
                      {selectedTutorForPurchase.isSuperTutor && (
                        <span className="px-1.5 py-0.5 rounded-md text-[10px] font-black bg-amber-100 text-amber-900 border border-amber-300 flex items-center gap-0.5">
                          <Award className="w-3 h-3 text-amber-700" />
                          Super
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-[#062863] font-semibold mt-0.5">
                      {selectedTutorForPurchase.headline || selectedTutorForPurchase.accent}
                    </p>
                    <div className="flex items-center gap-2 mt-1 text-[11px] text-[#607EC9]">
                      <span className="flex items-center gap-0.5 font-bold text-amber-600">
                        <Star className="w-3 h-3 fill-amber-500 text-amber-500" />
                        {(selectedTutorForPurchase.rating || 5.0).toFixed(1)}
                      </span>
                      <span>•</span>
                      <span>{selectedTutorForPurchase.accent || 'Native Accent'}</span>
                    </div>
                  </div>
                </div>

                <div className="bg-white px-3 py-2 rounded-xl border border-[#607EC9]/30 text-right">
                  <span className="text-[10px] text-[#607EC9] font-bold uppercase block">
                    {isEn ? 'Lesson Rate' : 'Valor Base'}
                  </span>
                  <span className="text-base font-black text-[#000035]">
                    ${activeBaseRateUsd} USD
                  </span>
                  <span className="text-[10px] text-[#607EC9] font-semibold block">/ {isEn ? 'session' : 'sessão'}</span>
                </div>
              </div>

              {/* Informational Banner about Fixed Binding & Volume Discounts */}
              <div className="p-3.5 bg-blue-50/70 rounded-2xl border border-[#9AB4FF]/50 flex items-start gap-2.5 text-xs text-[#062863]">
                <ShieldCheck className="w-5 h-5 text-[#1C4C96] shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold block">
                    {isEn ? 'Fixed Assignment on Purchase • Volume Discounts' : 'Vínculo Fixo Garantido • Descontos Progressivos'}
                  </span>
                  <span>
                    {isEn
                      ? `By completing the purchase of any package below, ${selectedTutorForPurchase.name} will be permanently assigned as your fixed Native Friend. Package prices are based strictly on their rate of $${activeBaseRateUsd} USD/session with automatic volume discounts (4 lessons: 5% OFF, 8 lessons: 10% OFF, 12 lessons: 15% OFF).`
                      : `Ao confirmar a compra de qualquer pacote abaixo, ${selectedTutorForPurchase.name} passará a ser automaticamente seu Amigo Nativo fixo na plataforma. Os valores são baseados na taxa de $${activeBaseRateUsd} USD/aula do professor com descontos progressivos (4 aulas: 5% OFF, 8 aulas: 10% OFF, 12 aulas: 15% OFF).`}
                  </span>
                </div>
              </div>

              {/* Package Category Tabs */}
              <div className="flex items-center gap-2 p-1 bg-slate-100 rounded-xl border border-slate-200">
                <button
                  type="button"
                  onClick={() => {
                    setPackageCategoryTab('monthly');
                    if (selectedPackageLessons === 1) {
                      setSelectedPackageLessons(8);
                    }
                  }}
                  className={`flex-1 py-2 px-3 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer ${
                    packageCategoryTab === 'monthly'
                      ? 'bg-white text-[#000035] shadow-xs border border-slate-200/80'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <RefreshCw className="w-3.5 h-3.5 text-[#1C4C96]" />
                  <span>{isEn ? 'Monthly Plans (Recommended)' : 'Planos Mensais (Recomendado)'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPackageCategoryTab('flexible');
                  }}
                  className={`flex-1 py-2 px-3 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer ${
                    packageCategoryTab === 'flexible'
                      ? 'bg-white text-[#000035] shadow-xs border border-slate-200/80'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <ShoppingBag className="w-3.5 h-3.5 text-[#1C4C96]" />
                  <span>{isEn ? 'Flexible Lesson Packs' : 'Pacotes Avulsos Flexíveis'}</span>
                </button>
              </div>

              {/* Package Selection Grid */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="font-black text-sm text-[#000035] flex items-center gap-2">
                    <ShoppingBag className="w-4 h-4 text-[#1C4C96]" />
                    <span>
                      {packageCategoryTab === 'monthly'
                        ? (isEn ? 'Select Monthly Subscription Frequency' : 'Escolha a Frequência Mensal do Amigo Nativo')
                        : (isEn ? 'Select Flexible Lesson Pack' : 'Escolha o Pacote de Aulas Avulsas')}
                    </span>
                  </h4>
                  {packageCategoryTab === 'monthly' && (
                    <span className="text-[11px] text-emerald-700 font-bold bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200">
                      {isEn ? 'Auto-renews monthly • Cancel anytime' : 'Renovação mensal • Cancele quando quiser'}
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {activePackageList.map((pkg) => {
                    const isSelected = selectedPackageLessons === pkg.lessonsCount;
                    return (
                      <div
                        key={`${packageCategoryTab}-${pkg.lessonsCount}`}
                        onClick={() => setSelectedPackageLessons(pkg.lessonsCount)}
                        className={`p-4 rounded-2xl border transition-all cursor-pointer relative flex flex-col justify-between ${
                          isSelected
                            ? 'bg-blue-50/60 border-[#1C4C96] ring-2 ring-[#1C4C96] shadow-sm'
                            : 'bg-white border-[#607EC9]/30 hover:border-[#1C4C96]/60 shadow-2xs'
                        }`}
                      >
                        {pkg.discountBadgePt && (
                          <div className="absolute -top-2.5 right-3">
                            <span
                              className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider text-white shadow-xs ${
                                pkg.isPopular
                                  ? 'bg-[#1C4C96]'
                                  : pkg.isBestValue
                                  ? 'bg-emerald-600'
                                  : 'bg-blue-600'
                              }`}
                            >
                              {isEn ? pkg.discountBadgeEn : pkg.discountBadgePt}
                            </span>
                          </div>
                        )}

                        <div className="space-y-1">
                          <div className="flex items-center justify-between">
                            <h5 className="font-black text-sm text-[#000035]">
                              {isEn ? pkg.labelEn : pkg.labelPt}
                            </h5>
                            <div
                              className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                                isSelected ? 'border-[#1C4C96] bg-[#1C4C96]' : 'border-slate-300'
                              }`}
                            >
                              {isSelected && <Check className="w-2.5 h-2.5 text-white stroke-[3]" />}
                            </div>
                          </div>

                          <div className="flex items-baseline gap-1.5 pt-1 flex-wrap">
                            <span className="text-xl font-black text-[#000035]">
                              ${pkg.priceUsd % 1 === 0 ? pkg.priceUsd : pkg.priceUsd.toFixed(2)} USD
                            </span>
                            {pkg.discountPercent > 0 && (
                              <span className="text-xs text-slate-400 line-through font-semibold">
                                ${pkg.baseTotalUsd}
                              </span>
                            )}
                            <span className="text-xs text-[#607EC9] font-medium">
                              {pkg.isRecurringMonthly ? (isEn ? '/mo' : '/mês') : ''}
                            </span>
                          </div>

                          <div className="flex items-center gap-1.5 pt-0.5">
                            <p className="text-[11px] text-[#062863] font-bold">
                              ${pkg.pricePerLessonUsd % 1 === 0 ? pkg.pricePerLessonUsd : pkg.pricePerLessonUsd.toFixed(2)} USD {isEn ? '/ lesson' : '/ aula'}
                            </p>
                            {pkg.discountPercent > 0 && (
                              <span className="text-[10px] text-emerald-700 font-extrabold bg-emerald-50 px-1.5 py-0.2 rounded border border-emerald-200">
                                -{pkg.discountPercent}%
                              </span>
                            )}
                          </div>

                          <p className="text-xs text-slate-600 pt-1 leading-relaxed">
                            {isEn ? pkg.descriptionEn : pkg.descriptionPt}
                          </p>

                          <span className="text-[10px] text-slate-400 font-medium block pt-0.5">
                            ≈ R$ {pkg.priceBrl} BRL
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Payment Method Selector */}
              <div className="space-y-2.5 pt-2">
                <h4 className="font-black text-xs uppercase tracking-wider text-[#062863]">
                  {isEn ? 'Payment Method' : 'Forma de Pagamento'}
                </h4>

                <div className="grid grid-cols-2 gap-3">
                  <div
                    onClick={() => setSelectedPaymentMethod('pix')}
                    className={`p-3 rounded-xl border flex items-center gap-2.5 cursor-pointer transition ${
                      selectedPaymentMethod === 'pix'
                        ? 'bg-emerald-50/60 border-emerald-600 ring-2 ring-emerald-500/40'
                        : 'bg-white border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                      <QrCode className="w-4 h-4" />
                    </div>
                    <div>
                      <span className="font-bold text-xs text-[#000035] block">PIX</span>
                      <span className="text-[10px] text-emerald-700 font-semibold">
                        {isEn ? 'Instant Release' : 'Liberação Imediata'}
                      </span>
                    </div>
                  </div>

                  <div
                    onClick={() => setSelectedPaymentMethod('credit_card')}
                    className={`p-3 rounded-xl border flex items-center gap-2.5 cursor-pointer transition ${
                      selectedPaymentMethod === 'credit_card'
                        ? 'bg-blue-50/60 border-[#1C4C96] ring-2 ring-[#1C4C96]/40'
                        : 'bg-white border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <div className="w-8 h-8 rounded-lg bg-blue-100 text-[#1C4C96] flex items-center justify-center shrink-0">
                      <CreditCard className="w-4 h-4" />
                    </div>
                    <div>
                      <span className="font-bold text-xs text-[#000035] block">
                        {isEn ? 'Credit Card' : 'Cartão de Crédito'}
                      </span>
                      <span className="text-[10px] text-[#607EC9] font-medium">
                        {isEn ? 'Up to 12x' : 'Em até 12x'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Order Summary & Purchase CTA */}
              <div className="bg-[#000035] text-white rounded-2xl p-4 space-y-3">
                <div className="flex items-center justify-between text-xs border-b border-[#1C4C96] pb-2">
                  <span className="text-[#9AB4FF] font-medium">
                    {isEn ? 'Tutor to be assigned:' : 'Amigo Nativo a vincular:'}
                  </span>
                  <span className="font-bold text-white flex items-center gap-1">
                    <span>{selectedTutorForPurchase.name}</span>
                    <span>{selectedTutorForPurchase.flag}</span>
                  </span>
                </div>

                <div className="flex items-center justify-between text-xs border-b border-[#1C4C96] pb-2">
                  <span className="text-[#9AB4FF] font-medium">{isEn ? 'Package:' : 'Pacote Escolhido:'}</span>
                  <span className="font-bold text-white">
                    {selectedPkg.lessonsCount === 1
                      ? (isEn ? '1 Single Lesson (50 min)' : '1 Aula Avulsa (50 min)')
                      : `${selectedPkg.lessonsCount} ${isEn ? 'Lessons (50 min)' : 'Aulas de 50 min'}`}
                    {selectedPkg.discountPercent > 0 ? ` (${selectedPkg.discountPercent}% OFF)` : ''}
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-[10px] text-[#9AB4FF] font-bold uppercase block">Total</span>
                    <div className="flex items-baseline gap-1.5 flex-wrap">
                      <span className="text-xl font-black text-white">
                        ${selectedPkg.priceUsd % 1 === 0 ? selectedPkg.priceUsd : selectedPkg.priceUsd.toFixed(2)} USD
                      </span>
                      {selectedPkg.discountPercent > 0 && (
                        <span className="text-xs text-[#9AB4FF]/70 line-through">
                          ${selectedPkg.baseTotalUsd}
                        </span>
                      )}
                      {selectedPkg.isRecurringMonthly && (
                        <span className="text-xs text-[#9AB4FF]">{isEn ? '/month' : '/mês'}</span>
                      )}
                    </div>
                    <span className="text-[10px] text-[#9AB4FF]/80 block">
                      ≈ R$ {selectedPkg.priceBrl} BRL
                    </span>
                  </div>

                  <button
                    type="button"
                    disabled={isProcessing || purchaseCompleted}
                    onClick={handleConfirmPurchase}
                    className="px-5 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-[#000035] rounded-xl font-black text-xs transition flex items-center gap-2 cursor-pointer shadow-md disabled:opacity-50"
                  >
                    {isProcessing ? (
                      <span>{isEn ? 'Processing...' : 'Processando...'}</span>
                    ) : purchaseCompleted ? (
                      <>
                        <CheckCircle className="w-4 h-4 text-[#000035]" />
                        <span>{isEn ? 'Purchased!' : 'Comprado com Sucesso!'}</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4 text-[#000035]" />
                        <span>
                          {isEn
                            ? `Confirm & Link ${selectedTutorForPurchase.name}`
                            : `Confirmar Compra & Vincular ${selectedTutorForPurchase.name}`}
                        </span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            /* VIEW MODE 2: OVERVIEW & NATIVE FRIENDS BROWSER */
            <>
              {/* Section 1: Current Native Friend Status */}
              <div className="bg-[#9AB4FF]/10 rounded-2xl border border-[#607EC9]/30 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-extrabold uppercase tracking-wider text-[#062863]">
                    {isEn ? 'Current Native Friend' : 'Seu Amigo Nativo Atual'}
                  </span>
                  {hasActiveSubscription ? (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                      {isEn ? '● Active Enrollment' : '● Amigo Nativo Fixo'}
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
                      {isEn ? '○ No Native Friend Assigned' : '○ Nenhum Amigo Nativo Atribuído'}
                    </span>
                  )}
                </div>

                {hasActiveSubscription ? (
                  <div className="bg-white rounded-2xl p-4 border border-[#607EC9]/25 shadow-2xs space-y-3.5">
                    {/* Tutor Profile Info */}
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-xl bg-[#062863] text-white flex items-center justify-center font-black text-base border border-[#9AB4FF]/40 shadow-xs shrink-0 overflow-hidden">
                        {currentTutor?.avatar && currentTutor.avatar.trim() !== '' ? (
                          <img src={currentTutor.avatar} alt={currentTeacherName} className="w-full h-full object-cover" />
                        ) : (
                          (currentTeacherName || 'AN').slice(0, 2).toUpperCase()
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <h4 className="font-black text-sm text-[#000035] flex items-center gap-1.5 truncate">
                          <span className="truncate">{currentTeacherName || currentTutor?.name || currentTeacherEmail}</span>
                          {currentTutor?.flag && <span className="shrink-0">{currentTutor.flag}</span>}
                        </h4>
                        <p className="text-xs text-[#607EC9] font-medium truncate">{currentTeacherEmail}</p>
                        {currentTutor?.accent && (
                          <p className="text-[11px] text-[#062863] font-semibold mt-0.5 truncate">
                            {currentTutor.accent}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* 2 Clear Options for Post-Trial / Ongoing Learning */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
                      {/* OPÇÃO A */}
                      <div className="bg-linear-to-br from-blue-50/90 to-indigo-50/70 border border-[#1C4C96]/30 rounded-xl p-3.5 flex flex-col justify-between space-y-2">
                        <div>
                          <div className="flex items-center gap-1.5 text-xs font-black text-[#000035]">
                            <CheckCircle2 className="w-4 h-4 text-[#1C4C96]" />
                            <span>{isEn ? 'Option A: Continue with Current Friend' : 'Opção A: Continuar com seu Amigo Nativo'}</span>
                          </div>
                          <p className="text-[11px] text-[#062863] mt-1 leading-relaxed">
                            {isEn
                              ? 'Keep your momentum with a Monthly Recurring Package (1x, 2x or 4x/week) or flexible lesson packs.'
                              : 'Renove a rotina escolhendo um Pacote Mensal de Aulas (1x, 2x ou 4x/semana) com renovação automática sem multas!'}
                          </p>
                        </div>
                        {currentTutor && (
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedTutorForPurchase(currentTutor);
                              setPackageCategoryTab('monthly');
                              setSelectedPackageLessons(8);
                            }}
                            className="w-full py-2 px-3 bg-[#1C4C96] hover:bg-[#062863] text-white rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
                          >
                            <ShoppingBag className="w-3.5 h-3.5 text-[#9AB4FF]" />
                            <span>{isEn ? 'Choose Monthly Package' : 'Contratar Pacote de Aulas'}</span>
                          </button>
                        )}
                      </div>

                      {/* OPÇÃO B */}
                      <div className="bg-linear-to-br from-amber-50/80 to-orange-50/60 border border-amber-300/70 rounded-xl p-3.5 flex flex-col justify-between space-y-2">
                        <div>
                          <div className="flex items-center gap-1.5 text-xs font-black text-amber-950">
                            <Sparkles className="w-4 h-4 text-amber-600" />
                            <span>{isEn ? 'Option B: Try Another Native Friend' : 'Opção B: Nova Aula Teste com Outro Tutor'}</span>
                          </div>
                          <p className="text-[11px] text-amber-900 mt-1 leading-relaxed">
                            {isEn
                              ? 'Did not click or want to test another style? Schedule a new trial session with another Native Friend at zero extra charge!'
                              : 'Não se adaptou à 1ª experiência? Agende uma nova aula teste com outro Amigo Nativo sem nenhum custo adicional!'}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setShowTrialLessonPicker(true);
                            setShowAvailableTutors(true);
                          }}
                          className="w-full py-2 px-3 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
                        >
                          <CalendarCheck className="w-3.5 h-3.5" />
                          <span>{isEn ? 'Schedule Trial with Another Tutor' : 'Agendar Aula Teste com Outro Tutor'}</span>
                        </button>
                      </div>
                    </div>

                    {/* Reorganized Action Buttons: Responsive Wrap, Clean Spacing, No Horizontal Scroll */}
                    <div className="pt-2.5 border-t border-slate-100 flex flex-wrap items-center gap-2">
                      {/* Action button: Substituir Amigo Nativo */}
                      <button
                        type="button"
                        onClick={() => setShowAvailableTutors((prev) => !prev)}
                        className={`px-3 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-2xs ${
                          showAvailableTutors
                            ? 'bg-[#1C4C96]/15 text-[#062863] border border-[#1C4C96]/40 hover:bg-[#1C4C96]/25'
                            : 'bg-white hover:bg-slate-50 text-[#062863] border border-[#607EC9]/40'
                        }`}
                        title={
                          showAvailableTutors
                            ? (isEn ? 'Hide available Native Friends list' : 'Ocultar lista de Amigos Nativos disponíveis')
                            : (isEn ? 'Change current Native Friend' : 'Substituir Amigo Nativo atual')
                        }
                      >
                        <ArrowLeftRight className="w-3.5 h-3.5 text-[#1C4C96]" />
                        <span className="whitespace-nowrap">
                          {showAvailableTutors
                            ? (isEn ? 'Hide Other Friends' : 'Ocultar Lista')
                            : (isEn ? 'Change Native Friend' : 'Substituir Amigo Nativo')}
                        </span>
                      </button>

                      {!showCancelConfirm ? (
                        <button
                          type="button"
                          onClick={() => setShowCancelConfirm(true)}
                          className="sm:ml-auto px-3 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer"
                        >
                          <UserX className="w-3.5 h-3.5" />
                          <span className="whitespace-nowrap">{isEn ? 'Cancel Subscription' : 'Cancelar Inscrição'}</span>
                        </button>
                      ) : (
                        <div className="sm:ml-auto p-2 bg-rose-50 rounded-xl border border-rose-300 flex items-center gap-2 text-xs">
                          <span className="font-bold text-rose-900 text-[11px] whitespace-nowrap">
                            {isEn ? 'Cancel anytime (no fees)?' : 'Cancelar sem multas?'}
                          </span>
                          <button
                            type="button"
                            disabled={isProcessing}
                            onClick={handleCancelSubscription}
                            className="px-2.5 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded-lg font-bold text-[11px] transition cursor-pointer disabled:opacity-50"
                          >
                            {isProcessing ? '...' : (isEn ? 'Yes, Cancel' : 'Sim, Cancelar')}
                          </button>
                          <button
                            type="button"
                            onClick={() => setShowCancelConfirm(false)}
                            className="px-2 py-1 bg-white border border-slate-300 text-slate-700 rounded-lg font-bold text-[11px] cursor-pointer"
                          >
                            {isEn ? 'Keep' : 'Manter'}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="p-3.5 text-xs text-[#062863] bg-white rounded-xl border border-dashed border-[#607EC9]/40 space-y-1">
                    <p className="font-bold text-[#000035]">
                      {isEn
                        ? 'You do not have a fixed Native Friend yet.'
                        : 'Você ainda não possui um Amigo Nativo vinculado.'}
                    </p>
                    <p className="text-slate-600 leading-relaxed">
                      {isEn
                        ? 'Browse the available native friends below, pick your preferred mentor, and choose a lesson package to activate your fixed assignment!'
                        : 'Navegue pelos Amigos Nativos disponíveis abaixo, selecione o de sua preferência e escolha um pacote de aulas para vinculá-lo como seu professor fixo!'}
                    </p>
                  </div>
                )}
              </div>

              {/* Section 2: Available Native Friends List (Visible if student has no active tutor or clicked 'Substituir Amigo Nativo') */}
              {shouldShowAvailableTutors && (
                <div className="space-y-3 pt-1 animate-in fade-in duration-200">
                  {showTrialLessonPicker && (
                    <div className="p-3 bg-amber-50 border border-amber-300 rounded-xl flex items-start gap-2.5 text-xs text-amber-950">
                      <Sparkles className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                      <div>
                        <span className="font-bold block">
                          {isEn ? 'Schedule New Trial Session with Another Native Friend' : 'Agendamento de Nova Aula Teste'}
                        </span>
                        <span>
                          {isEn
                            ? 'Choose any Native Friend below to switch your assigned mentor and immediately schedule your 1-on-1 free trial session.'
                            : 'Selecione qualquer Amigo Nativo abaixo para atualizar seu mentor e agendar sua aula experimental gratuita de 25 minutos.'}
                        </span>
                      </div>
                    </div>
                  )}

                  <div className="flex items-center justify-between">
                    <h4 className="font-black text-sm text-[#000035] flex items-center gap-2">
                      <Globe className="w-4 h-4 text-[#1C4C96]" />
                      <span>{isEn ? 'Available Native Friends' : 'Amigos Nativos Disponíveis'}</span>
                    </h4>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-[#607EC9]">
                        {approvedTutors.length} {isEn ? 'available' : 'disponíveis'}
                      </span>
                      {hasActiveSubscription && (
                        <button
                          type="button"
                          onClick={() => {
                            setShowAvailableTutors(false);
                            setShowTrialLessonPicker(false);
                          }}
                          className="text-xs font-bold text-[#1C4C96] hover:text-[#062863] hover:underline cursor-pointer ml-1"
                        >
                          {isEn ? 'Hide list' : 'Fechar lista'}
                        </button>
                      )}
                    </div>
                  </div>

                <div className="grid grid-cols-1 gap-3">
                  {approvedTutors.map((tutor) => {
                    const isSelected = Boolean(
                      (tutor.email && tutor.email.toLowerCase() === currentTeacherEmail) ||
                      (tutor.id && tutor.id.toLowerCase() === currentTeacherEmail)
                    ) && hasActiveSubscription;
                    return (
                      <div
                        key={tutor.id || tutor.email}
                        className={`rounded-2xl p-4 border transition-all ${
                          isSelected
                            ? 'bg-blue-50/50 border-[#1C4C96] ring-2 ring-[#9AB4FF]/50'
                            : 'bg-white border-[#607EC9]/30 hover:border-[#1C4C96]/60 shadow-xs'
                        }`}
                      >
                        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                          <div className="flex items-start gap-3 min-w-0">
                            <div className="w-12 h-12 rounded-xl bg-[#062863] text-white flex items-center justify-center font-black text-base border border-[#9AB4FF]/40 shadow-xs shrink-0 overflow-hidden">
                              {tutor.avatar && tutor.avatar.trim() !== '' ? (
                                <img src={tutor.avatar} alt={tutor.name} className="w-full h-full object-cover" />
                              ) : (
                                (tutor.name || 'AN').slice(0, 2).toUpperCase()
                              )}
                            </div>

                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <h5 className="font-black text-sm text-[#000035] truncate">{tutor.name}</h5>
                                <span className="text-base">{tutor.flag}</span>
                                {tutor.isSuperTutor && (
                                  <span className="px-1.5 py-0.5 rounded-md text-[10px] font-black bg-amber-100 text-amber-900 border border-amber-300 flex items-center gap-0.5">
                                    <Award className="w-3 h-3 text-amber-700" />
                                    Super
                                  </span>
                                )}
                              </div>
                              {tutor.email ? <p className="text-xs text-[#607EC9] font-mono">{tutor.email}</p> : null}
                              <p className="text-xs text-[#062863] font-medium mt-1">{tutor.headline || tutor.accent}</p>

                              {Array.isArray(tutor?.specialties) && tutor.specialties.length > 0 && (
                                <div className="flex items-center gap-1 flex-wrap mt-2">
                                  {tutor.specialties.slice(0, 3).map((sp, idx) => (
                                    <span
                                      key={idx}
                                      className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-[#9AB4FF]/20 text-[#062863]"
                                    >
                                      {sp}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>

                          <div className="shrink-0 flex sm:flex-col items-center sm:items-end justify-between gap-2 border-t sm:border-t-0 pt-2 sm:pt-0 border-slate-100">
                            {/* Price preview */}
                            <div className="text-right hidden sm:block">
                              <span className="text-xs font-black text-[#000035]">
                                ${tutor.pricePerSessionUsd || 15} USD
                              </span>
                              <span className="text-[10px] text-[#607EC9]"> / {isEn ? 'session' : 'sessão'}</span>
                            </div>

                            {/* Actions */}
                            <div className="flex items-center gap-2">
                              {/* Option when picking a tutor for a new trial lesson */}
                              {!isSelected && showTrialLessonPicker ? (
                                <button
                                  type="button"
                                  disabled={isProcessing}
                                  onClick={async () => {
                                    await handleSelectTutorDirectly(tutor.email || tutor.id, tutor.name);
                                    if (onScheduleTrialLessonWithTutor) {
                                      onScheduleTrialLessonWithTutor(tutor);
                                    }
                                  }}
                                  className="px-3.5 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-xs active:scale-98 disabled:opacity-50"
                                >
                                  <CalendarCheck className="w-3.5 h-3.5" />
                                  <span>{isEn ? 'Schedule Trial with This Friend' : 'Agendar Aula Teste com este Tutor'}</span>
                                </button>
                              ) : (
                                <>
                                  {/* Primary: Buy Package & Link */}
                                  <button
                                    type="button"
                                    onClick={() => setSelectedTutorForPurchase(tutor)}
                                    className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-xs active:scale-98"
                                  >
                                    <ShoppingBag className="w-3.5 h-3.5 text-white" />
                                    <span>
                                      {isSelected
                                        ? (isEn ? 'Buy More Lessons' : 'Comprar Mais Aulas')
                                        : (isEn ? 'Buy Package & Bind' : 'Comprar Pacote & Vincular')}
                                    </span>
                                  </button>

                                  {/* Secondary: Switch tutor directly without purchase (if desired) */}
                                  {!isSelected && hasActiveSubscription && (
                                    <button
                                      type="button"
                                      disabled={isProcessing}
                                      onClick={() => handleSelectTutorDirectly(tutor.email || tutor.id, tutor.name)}
                                      className="px-2.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition cursor-pointer disabled:opacity-50"
                                      title={isEn ? 'Switch to this tutor directly' : 'Substituir para este tutor diretamente'}
                                    >
                                      {isEn ? 'Switch' : 'Substituir'}
                                    </button>
                                  )}
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  {approvedTutors.length === 0 && (
                    <div className="p-4 text-center text-xs text-slate-500 bg-slate-50 rounded-2xl border border-slate-200">
                      {isEn
                        ? 'No other Native Friends registered yet. New native friends can register via "Become a Tutor".'
                        : 'Nenhum Amigo Nativo disponível no momento.'}
                    </div>
                  )}
                </div>
              </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 bg-slate-50 border-t border-slate-200 flex justify-end shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 rounded-xl text-xs font-bold transition cursor-pointer"
          >
            {isEn ? 'Close' : 'Fechar'}
          </button>
        </div>
      </div>
    </div>
  );
};
