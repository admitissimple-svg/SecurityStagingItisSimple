import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  UserCheck,
  CheckCircle,
  XCircle,
  Clock,
  Mail,
  MapPin,
  DollarSign,
  ShieldCheck,
  Video,
  ExternalLink,
  Trash2,
  RefreshCw,
  Calendar,
  Percent,
  AlertTriangle,
  History,
  Eye,
  Globe,
  ArrowLeft,
  Languages,
} from 'lucide-react';
import { NativeFriendTutor, Language } from '../types';
import {
  validateAdminCommissionPercent,
  hasValidPersistedCommission,
  ALLOWED_COMMISSION_MODEL,
} from '../utils/tutorCommission';
import { useBatchTutorPricingQuotes } from '../hooks/useTutorPricingQuote';
import {
  findQuoteForTutor,
  formatBrl,
  PublicTutorPricingQuoteDto,
} from '../utils/pricingQuoteClient';
import { calculateFinancialPricingQuote } from '../utils/financialEngine';
import { extractYouTubeVideoId } from '../utils/youtube';

interface AdminApprovalsModalProps {
  isOpen: boolean;
  onClose: () => void;
  tutors: NativeFriendTutor[];
  onApproveTutor: (
    tutorId: string,
    tutor?: NativeFriendTutor,
    adminCommissionPercent?: number
  ) => Promise<{ success: boolean; error?: string } | void> | void;
  onUpdateTutorCommission?: (
    tutorId: string,
    adminCommissionPercent: number,
    tutor?: NativeFriendTutor
  ) => Promise<{ success: boolean; error?: string } | void> | void;
  onRejectTutor: (tutorId: string, tutor?: NativeFriendTutor) => Promise<{ success: boolean; error?: string } | void> | void;
  onDeleteTutor?: (tutorId: string, tutorEmail?: string) => Promise<{ success: boolean; error?: string } | void> | void;
  onRefresh?: () => void;
  isRefreshing?: boolean;
  currentLanguage: Language;
  authError?: string | null;
}

export interface TutorVideoPresentationInfo {
  hasVideo: boolean;
  rawUrl: string;
  youtubeId: string | null;
  embedUrl: string | null;
  watchUrl: string | null;
  isDirectVideo: boolean;
}

export interface AdminCandidatePricingSummary {
  basePriceUsd: number | null;
  hasPersistedCommission: boolean;
  activeCommissionPercent: number | null;
  commissionModel: string;
  commissionVersion: number | null;
  publicPriceBrl: number | null;
  publicPriceUsd: number | null;
  publicPriceSource:
    | 'fin2c_batch_quote'
    | 'fin2c_engine_ptax'
    | 'missing_base_usd'
    | 'missing_commission'
    | 'ptax_unavailable'
    | 'ptax_loading';
  previewCommissionPercent: number | null;
  previewPriceBrl: number | null;
  previewPriceUsd: number | null;
  ptaxRate: number | null;
  ptaxQuoteDate: string | null;
  packages: Array<{
    lessonsCount: number;
    discountPercent: number;
    finalPriceBrl: number;
    effectiveLessonPriceBrl: number;
  }>;
}

export function isSafeHttpUrl(url?: string | null): boolean {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  return /^https?:\/\//i.test(trimmed);
}

export function extractRawBaseUsd(tutor: Partial<NativeFriendTutor> | null | undefined): number | null {
  if (!tutor || typeof tutor !== 'object') return null;
  const rawCandidate =
    tutor.pricePerSessionUsd !== undefined && tutor.pricePerSessionUsd !== null && String(tutor.pricePerSessionUsd).trim() !== ''
      ? tutor.pricePerSessionUsd
      : (tutor as any).hourlyRateUsd !== undefined && (tutor as any).hourlyRateUsd !== null && String((tutor as any).hourlyRateUsd).trim() !== ''
      ? (tutor as any).hourlyRateUsd
      : null;

  if (rawCandidate === null) return null;
  const parsed = typeof rawCandidate === 'number' ? rawCandidate : Number(rawCandidate);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function buildCandidateMailtoHref(
  tutor: Pick<NativeFriendTutor, 'name' | 'email'> | null | undefined,
  isEn: boolean = false
): string | null {
  if (!tutor || typeof tutor.email !== 'string') return null;
  const cleanEmail = tutor.email.trim().replace(/[\r\n\s]/g, '');
  if (!cleanEmail || !cleanEmail.includes('@')) return null;

  const candidateName = (tutor.name || '').trim() || (isEn ? 'Candidate' : 'Candidato(a)');
  const subject = isEn
    ? `It's simple — Native Friend Application (${candidateName})`
    : `It's simple — Candidatura Native Friend (${candidateName})`;
  const body = isEn
    ? `Hello ${candidateName},\n\nWe reviewed your Native Friend application on It's simple.\n\nBest regards,\nIt's simple Administration`
    : `Olá ${candidateName},\n\nAnalisamos sua candidatura como Native Friend na It's simple.\n\nAtenciosamente,\nAdministração It's simple`;

  return `mailto:${cleanEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export function resolveTutorVideoPresentation(
  tutor: Partial<NativeFriendTutor> | null | undefined
): TutorVideoPresentationInfo {
  if (!tutor || typeof tutor !== 'object') {
    return {
      hasVideo: false,
      rawUrl: '',
      youtubeId: null,
      embedUrl: null,
      watchUrl: null,
      isDirectVideo: false,
    };
  }

  const rawUrl = String(
    tutor.videoIntroUrl ||
      tutor.youtubeUrl ||
      tutor.videoUrl ||
      tutor.introVideoUrl ||
      ''
  ).trim();
  const rawEmbedId = String(tutor.youtubeEmbedId || '').trim();

  let youtubeId =
    extractYouTubeVideoId(rawUrl) ||
    extractYouTubeVideoId(rawEmbedId) ||
    null;

  if (!youtubeId && rawUrl) {
    const shortsOrLiveMatch = rawUrl.match(
      /youtube\.com\/(?:shorts|live)\/([^"&?\/\s]{11})/i
    );
    if (shortsOrLiveMatch && shortsOrLiveMatch[1]) {
      youtubeId = shortsOrLiveMatch[1];
    }
  }

  if (youtubeId) {
    const safeWatch = isSafeHttpUrl(rawUrl)
      ? rawUrl
      : `https://www.youtube.com/watch?v=${youtubeId}`;
    return {
      hasVideo: true,
      rawUrl: safeWatch,
      youtubeId,
      embedUrl: `https://www.youtube-nocookie.com/embed/${youtubeId}?rel=0&modestbranding=1`,
      watchUrl: safeWatch,
      isDirectVideo: false,
    };
  }

  if (isSafeHttpUrl(rawUrl)) {
    return {
      hasVideo: true,
      rawUrl,
      youtubeId: null,
      embedUrl: null,
      watchUrl: rawUrl,
      isDirectVideo: true,
    };
  }

  return {
    hasVideo: false,
    rawUrl: '',
    youtubeId: null,
    embedUrl: null,
    watchUrl: null,
    isDirectVideo: false,
  };
}

export function computeAdminCandidatePricingSummary(params: {
  tutor: NativeFriendTutor;
  officialQuote?: PublicTutorPricingQuoteDto | null;
  ptaxMeta?: PublicTutorPricingQuoteDto['ptax'] | null;
  ptaxErrorCode?: string | null;
  draftCommissionInput?: string;
  isLoadingPtax?: boolean;
}): AdminCandidatePricingSummary {
  const {
    tutor,
    officialQuote = null,
    ptaxMeta = null,
    ptaxErrorCode = null,
    draftCommissionInput = '',
    isLoadingPtax = false,
  } = params;

  const basePriceUsd = extractRawBaseUsd(tutor);
  const hasPersistedCommission = hasValidPersistedCommission(tutor);
  const activeCommissionPercent = hasPersistedCommission
    ? (tutor.adminCommissionPercent as number)
    : null;
  const commissionModel = tutor.commissionModel || ALLOWED_COMMISSION_MODEL;
  const commissionVersion =
    typeof tutor.commissionVersion === 'number' && Number.isFinite(tutor.commissionVersion)
      ? tutor.commissionVersion
      : null;

  const effectivePtaxRate =
    (typeof officialQuote?.ptax?.rate === 'number' && Number.isFinite(officialQuote.ptax.rate) && officialQuote.ptax.rate > 0
      ? officialQuote.ptax.rate
      : null) ??
    (typeof ptaxMeta?.rate === 'number' && Number.isFinite(ptaxMeta.rate) && ptaxMeta.rate > 0
      ? ptaxMeta.rate
      : null);

  const ptaxQuoteDate = officialQuote?.ptax?.quoteDate || ptaxMeta?.quoteDate || null;

  // Preview calculation when admin types a valid commission in the input
  let previewCommissionPercent: number | null = null;
  let previewPriceBrl: number | null = null;
  let previewPriceUsd: number | null = null;

  if (draftCommissionInput.trim() !== '') {
    const draftValidation = validateAdminCommissionPercent(draftCommissionInput);
    if (draftValidation.valid) {
      previewCommissionPercent = draftValidation.value;
      if (basePriceUsd !== null && basePriceUsd > 0 && effectivePtaxRate !== null) {
        const previewQuote = calculateFinancialPricingQuote({
          basePriceUsd,
          adminCommissionPercent: draftValidation.value,
          ptaxRate: effectivePtaxRate,
          commissionModel: 'MARKUP',
          conversionBase: 'UNIT_PRICE_BRL',
        });
        previewPriceBrl = previewQuote.unit.finalPriceBrl;
        previewPriceUsd = previewQuote.unit.finalPriceUsd;
      }
    }
  }

  // Authoritative public BRL price from FIN.2C / PTAX
  if (
    officialQuote &&
    officialQuote.commercializable &&
    typeof officialQuote.unit?.finalPriceBrl === 'number'
  ) {
    let engineUnitUsd: number | null = null;
    if (basePriceUsd !== null && basePriceUsd > 0 && activeCommissionPercent !== null && effectivePtaxRate !== null) {
      const eng = calculateFinancialPricingQuote({
        basePriceUsd,
        adminCommissionPercent: activeCommissionPercent,
        ptaxRate: effectivePtaxRate,
        commissionModel: 'MARKUP',
        conversionBase: 'UNIT_PRICE_BRL',
      });
      engineUnitUsd = eng.unit.finalPriceUsd;
    }

    return {
      basePriceUsd,
      hasPersistedCommission,
      activeCommissionPercent,
      commissionModel,
      commissionVersion,
      publicPriceBrl: officialQuote.unit.finalPriceBrl,
      publicPriceUsd: engineUnitUsd,
      publicPriceSource: 'fin2c_batch_quote',
      previewCommissionPercent,
      previewPriceBrl,
      previewPriceUsd,
      ptaxRate: effectivePtaxRate,
      ptaxQuoteDate,
      packages: Array.isArray(officialQuote.packages)
        ? officialQuote.packages.map((p) => ({
            lessonsCount: p.lessonsCount,
            discountPercent: p.discountPercent,
            finalPriceBrl: p.finalPriceBrl,
            effectiveLessonPriceBrl: p.effectiveLessonPriceBrl,
          }))
        : [],
    };
  }

  if (basePriceUsd === null || basePriceUsd <= 0) {
    return {
      basePriceUsd,
      hasPersistedCommission,
      activeCommissionPercent,
      commissionModel,
      commissionVersion,
      publicPriceBrl: null,
      publicPriceUsd: null,
      publicPriceSource: 'missing_base_usd',
      previewCommissionPercent,
      previewPriceBrl,
      previewPriceUsd,
      ptaxRate: effectivePtaxRate,
      ptaxQuoteDate,
      packages: [],
    };
  }

  if (!hasPersistedCommission || activeCommissionPercent === null) {
    return {
      basePriceUsd,
      hasPersistedCommission,
      activeCommissionPercent: null,
      commissionModel,
      commissionVersion,
      publicPriceBrl: null,
      publicPriceUsd: null,
      publicPriceSource:
        isLoadingPtax
          ? 'ptax_loading'
          : effectivePtaxRate === null || ptaxErrorCode === 'PTAX_UNAVAILABLE'
          ? 'ptax_unavailable'
          : 'missing_commission',
      previewCommissionPercent,
      previewPriceBrl,
      previewPriceUsd,
      ptaxRate: effectivePtaxRate,
      ptaxQuoteDate,
      packages: [],
    };
  }

  if (isLoadingPtax && effectivePtaxRate === null) {
    return {
      basePriceUsd,
      hasPersistedCommission,
      activeCommissionPercent,
      commissionModel,
      commissionVersion,
      publicPriceBrl: null,
      publicPriceUsd: null,
      publicPriceSource: 'ptax_loading',
      previewCommissionPercent,
      previewPriceBrl,
      previewPriceUsd,
      ptaxRate: null,
      ptaxQuoteDate: null,
      packages: [],
    };
  }

  if (effectivePtaxRate === null || ptaxErrorCode === 'PTAX_UNAVAILABLE') {
    return {
      basePriceUsd,
      hasPersistedCommission,
      activeCommissionPercent,
      commissionModel,
      commissionVersion,
      publicPriceBrl: null,
      publicPriceUsd: null,
      publicPriceSource: 'ptax_unavailable',
      previewCommissionPercent,
      previewPriceBrl,
      previewPriceUsd,
      ptaxRate: null,
      ptaxQuoteDate: null,
      packages: [],
    };
  }

  const engineQuote = calculateFinancialPricingQuote({
    basePriceUsd,
    adminCommissionPercent: activeCommissionPercent,
    ptaxRate: effectivePtaxRate,
    commissionModel: 'MARKUP',
    conversionBase: 'UNIT_PRICE_BRL',
  });

  return {
    basePriceUsd,
    hasPersistedCommission,
    activeCommissionPercent,
    commissionModel,
    commissionVersion,
    publicPriceBrl: engineQuote.unit.finalPriceBrl,
    publicPriceUsd: engineQuote.unit.finalPriceUsd,
    publicPriceSource: 'fin2c_engine_ptax',
    previewCommissionPercent,
    previewPriceBrl,
    previewPriceUsd,
    ptaxRate: effectivePtaxRate,
    ptaxQuoteDate,
    packages: engineQuote.packages.list.map((p) => ({
      lessonsCount: p.lessonsCount,
      discountPercent: p.discountPercent,
      finalPriceBrl: p.finalPriceBrl,
      effectiveLessonPriceBrl: p.effectiveLessonPriceBrl,
    })),
  };
}

export const AdminApprovalsModal: React.FC<AdminApprovalsModalProps> = ({
  isOpen,
  onClose,
  tutors,
  onApproveTutor,
  onUpdateTutorCommission,
  onRejectTutor,
  onDeleteTutor,
  onRefresh,
  isRefreshing = false,
  currentLanguage,
  authError,
}) => {
  const isTutorApproved = (t: NativeFriendTutor) =>
    t.approvalStatus === 'approved' && t.isApproved === true;

  const isTutorRejected = (t: NativeFriendTutor) =>
    !isTutorApproved(t) &&
    (t.approvalStatus === 'rejected' || (t as any).status === 'rejected');

  const pendingCount = tutors.filter((t) => !isTutorApproved(t) && !isTutorRejected(t)).length;
  const approvedCount = tutors.filter((t) => isTutorApproved(t)).length;
  const rejectedCount = tutors.filter((t) => isTutorRejected(t)).length;

  const [filter, setFilter] = useState<'pending' | 'approved' | 'rejected' | 'all'>('all');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [actionNotification, setActionNotification] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // FIN.2B: Estado controlado do campo "Comissão da Plataforma (%)" — NUNCA pré-preenchido
  const [commissionInputs, setCommissionInputs] = useState<Record<string, string>>({});
  const [commissionErrors, setCommissionErrors] = useState<Record<string, string>>({});
  const [expandedHistoryId, setExpandedHistoryId] = useState<string | null>(null);
  const [viewingTutorKey, setViewingTutorKey] = useState<string | null>(null);
  const inFlightIdsRef = useRef<Set<string>>(new Set());

  // FIN.2C / PTAX D-1: Consulta oficial de cotações e PTAX vigente quando o painel ADM está aberto
  const {
    quotesByTutorId,
    unavailableByTutorId,
    ptaxMeta,
    isLoading: isQuotesLoading,
    errorCode: quotesErrorCode,
    refresh: refreshQuotes,
  } = useBatchTutorPricingQuotes(isOpen, tutors.length);

  // Fallback direto para /api/financial/ptax caso /api/financial/pricing-quotes não retorne ptaxMeta
  const [fallbackPtaxMeta, setFallbackPtaxMeta] = useState<PublicTutorPricingQuoteDto['ptax'] | null>(null);
  const [fallbackPtaxErrorCode, setFallbackPtaxErrorCode] = useState<string | null>(null);
  const [isFallbackPtaxLoading, setIsFallbackPtaxLoading] = useState<boolean>(false);

  useEffect(() => {
    if (!isOpen || isQuotesLoading || ptaxMeta || quotesErrorCode === 'PTAX_UNAVAILABLE') {
      setIsFallbackPtaxLoading(false);
      return;
    }
    let cancelled = false;
    setIsFallbackPtaxLoading(true);
    fetch('/api/financial/ptax', { method: 'GET', cache: 'no-store' })
      .then(async (res) => {
        const data = await res.json().catch(() => null);
        if (cancelled) return;
        if (res.ok && data?.success && typeof data.ptaxRate === 'number' && data.ptaxRate > 0) {
          setFallbackPtaxMeta({
            rate: data.ptaxRate,
            quoteDate: data.quoteDate || '',
            pricingDate: data.pricingDate || '',
            source: data.source || 'BACEN_PTAX_D1',
            ...(data.tipoBoletim ? { tipoBoletim: data.tipoBoletim } : {}),
          });
          setFallbackPtaxErrorCode(null);
        } else {
          setFallbackPtaxMeta(null);
          setFallbackPtaxErrorCode(data?.error || 'PTAX_UNAVAILABLE');
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFallbackPtaxMeta(null);
          setFallbackPtaxErrorCode('PTAX_UNAVAILABLE');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsFallbackPtaxLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, isQuotesLoading, ptaxMeta, quotesErrorCode]);

  const effectivePtaxMeta = ptaxMeta || fallbackPtaxMeta;
  const effectiveIsPtaxLoading = isQuotesLoading || isFallbackPtaxLoading;
  const effectivePtaxErrorCode =
    quotesErrorCode === 'PTAX_UNAVAILABLE'
      ? 'PTAX_UNAVAILABLE'
      : !effectivePtaxMeta
      ? fallbackPtaxErrorCode || quotesErrorCode
      : null;

  // When modal opens, default to pending if any are waiting for review, otherwise show all
  useEffect(() => {
    if (isOpen) {
      setFilter(pendingCount > 0 ? 'pending' : 'all');
      setCommissionErrors({});
      setActionError(null);
      setViewingTutorKey(null);
    }
  }, [isOpen]);

  // Support ESC key to easily dismiss View Application or main modal
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (viewingTutorKey) {
          setViewingTutorKey(null);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, viewingTutorKey, onClose]);

  if (!isOpen) return null;

  const isEn = currentLanguage === 'en';

  const getTutorKey = (tutor: NativeFriendTutor) =>
    tutor.uid || tutor.authUid || tutor.id || tutor.email;

  const viewingTutor = viewingTutorKey
    ? tutors.find((t) => getTutorKey(t) === viewingTutorKey) || null
    : null;

  const handleCommissionInputChange = (tutorKey: string, nextVal: string) => {
    setCommissionInputs((prev) => ({ ...prev, [tutorKey]: nextVal }));
    if (nextVal.trim() === '') {
      setCommissionErrors((prev) => {
        const copy = { ...prev };
        delete copy[tutorKey];
        return copy;
      });
      return;
    }
    const check = validateAdminCommissionPercent(nextVal);
    if (!check.valid) {
      setCommissionErrors((prev) => ({ ...prev, [tutorKey]: check.error }));
    } else {
      setCommissionErrors((prev) => {
        const copy = { ...prev };
        delete copy[tutorKey];
        return copy;
      });
    }
  };

  const filteredTutors = tutors.filter((t) => {
    const status = isTutorApproved(t)
      ? 'approved'
      : isTutorRejected(t)
      ? 'rejected'
      : 'pending';
    if (filter === 'all') return true;
    return status === filter;
  });

  const renderApplicationDetailModal = (tutor: NativeFriendTutor) => {
    const tutorKey = getTutorKey(tutor);
    const status = isTutorApproved(tutor)
      ? 'approved'
      : isTutorRejected(tutor)
      ? 'rejected'
      : 'pending';
    const avatarSrc = tutor.avatar || tutor.photoUrl || (tutor as any).picture || '';
    const videoInfo = resolveTutorVideoPresentation(tutor);
    const mailtoHref = buildCandidateMailtoHref(tutor, isEn);
    const { quote: officialQuote } = findQuoteForTutor(
      tutor,
      quotesByTutorId,
      unavailableByTutorId
    );
    const pricingSummary = computeAdminCandidatePricingSummary({
      tutor,
      officialQuote,
      ptaxMeta: effectivePtaxMeta,
      ptaxErrorCode: effectivePtaxErrorCode,
      draftCommissionInput: commissionInputs[tutorKey] ?? '',
      isLoadingPtax: effectiveIsPtaxLoading,
    });
    const safeMeetUrl = isSafeHttpUrl(tutor.meetUrl || tutor.meetLink)
      ? (tutor.meetUrl || tutor.meetLink || '').trim()
      : '';
    const availabilityEntries = Object.entries(
      tutor.availableHoursByDay || tutor.availability || {}
    ).filter(([, slots]) => Array.isArray(slots) && slots.length > 0);
    const historyList = Array.isArray(tutor.commissionHistory)
      ? tutor.commissionHistory
      : [];

    return (
      <div
        className="fixed inset-0 z-[60] bg-[#000035]/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6 overflow-y-auto"
        id="admin-view-application-modal"
        onClick={(e) => {
          if (e.target === e.currentTarget) setViewingTutorKey(null);
        }}
      >
        <div className="bg-white rounded-3xl max-w-3xl w-full shadow-2xl border border-[#607EC9]/50 overflow-hidden flex flex-col max-h-[90vh] my-auto animate-in fade-in zoom-in duration-200">
          {/* Detail Header */}
          <div className="p-5 sm:p-6 bg-gradient-to-r from-[#000035] via-[#062863] to-[#1C4C96] text-white flex items-center justify-between gap-3 border-b border-[#607EC9]/40 shrink-0">
            <div className="flex items-center gap-3 min-w-0">
              <button
                type="button"
                onClick={() => setViewingTutorKey(null)}
                className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white transition cursor-pointer shrink-0"
                title={isEn ? 'Back to list' : 'Voltar à lista'}
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
              <div className="min-w-0">
                <p className="text-[10px] font-black uppercase tracking-wider text-[#F4CA54]">
                  {isEn ? 'Candidate Application' : 'Candidatura Original'}
                </p>
                <h3 className="text-base sm:text-lg font-black text-white truncate">
                  {tutor.name}
                </h3>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {mailtoHref && (
                <a
                  href={mailtoHref}
                  className="px-3 py-2 rounded-xl bg-[#F4CA54] hover:bg-[#eab93b] text-[#000035] text-xs font-black transition inline-flex items-center gap-1.5 shadow-sm"
                  title={isEn ? 'Send email to candidate' : 'Enviar e-mail ao candidato'}
                >
                  <Mail className="w-3.5 h-3.5" />
                  <span>Contact Candidate</span>
                </a>
              )}
              <button
                type="button"
                onClick={() => setViewingTutorKey(null)}
                className="p-2 rounded-xl text-[#9AB4FF] hover:text-white hover:bg-white/10 transition cursor-pointer"
                aria-label="Close application view"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Detail Body */}
          <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-5">
            {/* Profile Banner */}
            <div className="flex flex-col sm:flex-row items-start gap-4 p-4 rounded-2xl bg-slate-50 border border-slate-200">
              <div className="relative shrink-0">
                {avatarSrc && avatarSrc.trim() !== '' ? (
                  <img
                    src={avatarSrc}
                    alt={tutor.name}
                    referrerPolicy="no-referrer"
                    className="w-20 h-20 rounded-2xl object-cover border-2 border-[#1C4C96]/30 shadow-sm bg-white"
                  />
                ) : (
                  <div className="w-20 h-20 rounded-2xl border-2 border-[#1C4C96]/30 shadow-sm bg-[#062863]/10 flex items-center justify-center text-[#1C4C96] font-bold text-2xl">
                    {tutor.name?.charAt(0) || 'T'}
                  </div>
                )}
                <div className="absolute -bottom-1 -right-1 bg-[#000035] text-white text-[10px] font-black px-1.5 py-0.5 rounded-md border border-white">
                  {tutor.flag || '🇺🇸'}
                </div>
              </div>

              <div className="flex-1 min-w-0 space-y-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <h4 className="text-lg font-black text-[#000035]">{tutor.name}</h4>
                  {status === 'pending' && (
                    <span className="text-[10px] font-extrabold px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-300">
                      {isEn ? 'Pending Review' : 'Aguardando Aprovação'}
                    </span>
                  )}
                  {status === 'approved' && (
                    <span className="text-[10px] font-extrabold px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-900 border border-emerald-300">
                      {isEn ? 'Approved & Public' : 'Aprovado e Público'}
                    </span>
                  )}
                  {status === 'rejected' && (
                    <span className="text-[10px] font-extrabold px-2.5 py-0.5 rounded-full bg-rose-100 text-rose-900 border border-rose-300">
                      {isEn ? 'Rejected' : 'Recusado'}
                    </span>
                  )}
                </div>

                {tutor.headline && (
                  <p className="text-xs font-bold text-[#1C4C96]">"{tutor.headline}"</p>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-xs text-slate-600 pt-1">
                  <div className="flex items-center gap-1.5">
                    <Mail className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span className="truncate">{tutor.email || (isEn ? 'Not informed' : 'Não informado')}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span>
                      {tutor.country || (isEn ? 'Not informed' : 'Não informado')}
                      {tutor.accent ? ` • ${tutor.accent}` : ''}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Globe className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span>{tutor.timezone || (isEn ? 'Timezone not informed' : 'Fuso não informado')}</span>
                  </div>
                  {tutor.appliedAt && (
                    <div className="flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span>
                        {isEn ? 'Applied:' : 'Cadastro:'}{' '}
                        {new Date(tutor.appliedAt).toLocaleString()}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Financial Overview (FIN.2B / FIN.2C / PTAX) */}
            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <h5 className="text-xs font-black uppercase tracking-wider text-[#000035] flex items-center gap-1.5">
                  <DollarSign className="w-4 h-4 text-emerald-600" />
                  <span>{isEn ? 'Pricing & MARKUP Summary (FIN.2C / PTAX D-1)' : 'Resumo Financeiro e Precificação (FIN.2C / PTAX D-1)'}</span>
                </h5>
                {pricingSummary.ptaxRate !== null && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-blue-100 text-[#1C4C96]">
                    PTAX D-1: R$ {pricingSummary.ptaxRate.toFixed(4)}
                    {pricingSummary.ptaxQuoteDate ? ` (${pricingSummary.ptaxQuoteDate})` : ''}
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <div className="p-3 rounded-xl bg-white border border-slate-200">
                  <span className="text-[10px] font-bold uppercase text-slate-500 block">
                    {isEn ? 'Base Price (USD)' : 'Preço-base USD'}
                  </span>
                  <span className="text-sm font-black text-[#000035] mt-0.5 block">
                    {pricingSummary.basePriceUsd !== null && pricingSummary.basePriceUsd > 0
                      ? `$${pricingSummary.basePriceUsd.toFixed(2)} USD / 50 min`
                      : (isEn ? 'Not informed' : 'Não informado')}
                  </span>
                </div>

                <div className="p-3 rounded-xl bg-white border border-slate-200">
                  <span className="text-[10px] font-bold uppercase text-slate-500 block">
                    {isEn ? 'Active Commission (MARKUP)' : 'Comissão MARKUP Vigente'}
                  </span>
                  <span className="text-sm font-black text-[#1C4C96] mt-0.5 block">
                    {pricingSummary.hasPersistedCommission && pricingSummary.activeCommissionPercent !== null
                      ? `${pricingSummary.activeCommissionPercent}% (${pricingSummary.commissionModel})${
                          pricingSummary.commissionVersion ? ` • v${pricingSummary.commissionVersion}` : ''
                        }`
                      : (isEn ? 'Pending configuration' : 'Não definida')}
                  </span>
                </div>

                <div className="p-3 rounded-xl bg-white border border-emerald-200">
                  <span className="text-[10px] font-bold uppercase text-emerald-700 block">
                    {isEn ? 'Public Price (BRL)' : 'Preço Público BRL'}
                  </span>
                  <span className="text-sm font-black text-emerald-800 mt-0.5 block">
                    {pricingSummary.publicPriceBrl !== null
                      ? `${formatBrl(pricingSummary.publicPriceBrl)} / 50 min`
                      : pricingSummary.publicPriceSource === 'ptax_loading'
                      ? (isEn ? 'Loading PTAX...' : 'Consultando PTAX...')
                      : pricingSummary.publicPriceSource === 'ptax_unavailable'
                      ? (isEn ? 'PTAX D-1 unavailable' : 'PTAX D-1 indisponível')
                      : pricingSummary.publicPriceSource === 'missing_base_usd'
                      ? (isEn ? 'Missing USD price' : 'Preço USD ausente')
                      : (isEn ? 'Set commission to calculate' : 'Defina a comissão para calcular')}
                  </span>
                  {pricingSummary.previewPriceBrl !== null && pricingSummary.previewCommissionPercent !== null && (
                    <span className="text-[10px] font-bold text-[#1C4C96] block mt-0.5">
                      {isEn
                        ? `Draft preview (${pricingSummary.previewCommissionPercent}%): ${formatBrl(pricingSummary.previewPriceBrl)}`
                        : `Simulação (${pricingSummary.previewCommissionPercent}%): ${formatBrl(pricingSummary.previewPriceBrl)}`}
                    </span>
                  )}
                </div>
              </div>

              {pricingSummary.packages.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
                  {pricingSummary.packages.map((pkg) => (
                    <div
                      key={pkg.lessonsCount}
                      className="p-2 rounded-xl bg-white border border-slate-200 text-center"
                    >
                      <span className="text-[10px] font-bold text-slate-500 block">
                        {pkg.lessonsCount} {isEn ? (pkg.lessonsCount === 1 ? 'lesson' : 'lessons') : (pkg.lessonsCount === 1 ? 'aula' : 'aulas')}
                        {pkg.discountPercent > 0 ? ` (-${pkg.discountPercent}%)` : ''}
                      </span>
                      <span className="text-xs font-black text-[#000035] block mt-0.5">
                        {formatBrl(pkg.finalPriceBrl)}
                      </span>
                      <span className="text-[10px] text-emerald-700 font-semibold block">
                        {formatBrl(pkg.effectiveLessonPriceBrl)}/{isEn ? 'ea' : 'aula'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Presentation Video */}
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h5 className="text-xs font-black uppercase tracking-wider text-[#000035] flex items-center gap-1.5">
                  <Video className="w-4 h-4 text-[#1C4C96]" />
                  <span>{isEn ? 'Presentation Video' : 'Vídeo de Apresentação'}</span>
                </h5>
                {videoInfo.watchUrl && (
                  <a
                    href={videoInfo.watchUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-bold text-[#1C4C96] hover:underline"
                  >
                    <span>{isEn ? 'Open link' : 'Abrir link'}</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>

              {videoInfo.hasVideo ? (
                videoInfo.embedUrl ? (
                  <div className="w-full aspect-video rounded-2xl overflow-hidden bg-black border border-slate-200 shadow-sm">
                    <iframe
                      src={videoInfo.embedUrl}
                      title={`Presentation video of ${tutor.name}`}
                      className="w-full h-full border-0"
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                      allowFullScreen
                    />
                  </div>
                ) : (
                  <div className="w-full aspect-video rounded-2xl overflow-hidden bg-black border border-slate-200 shadow-sm flex items-center justify-center">
                    <video
                      src={videoInfo.rawUrl}
                      controls
                      playsInline
                      preload="metadata"
                      className="w-full h-full object-contain bg-black"
                    />
                  </div>
                )
              ) : (
                <div className="p-4 rounded-2xl bg-slate-50 border border-dashed border-slate-300 text-xs text-slate-500">
                  {isEn
                    ? 'No presentation video was provided in this application.'
                    : 'Nenhum vídeo de apresentação foi informado nesta candidatura.'}
                </div>
              )}
            </div>

            {/* Bio & Teaching Approach */}
            <div className="space-y-1.5">
              <h5 className="text-xs font-black uppercase tracking-wider text-[#000035]">
                {isEn ? 'Bio & Teaching Approach' : 'Biografia e Abordagem'}
              </h5>
              <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 text-xs text-slate-700 leading-relaxed whitespace-pre-line">
                {tutor.bio && tutor.bio.trim() !== ''
                  ? tutor.bio
                  : (isEn ? 'No biography informed.' : 'Biografia não informada.')}
              </div>
            </div>

            {/* Specialties, Languages & Availability */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 space-y-2">
                <h5 className="text-xs font-black uppercase tracking-wider text-[#000035]">
                  {isEn ? 'Specialties & Languages' : 'Especialidades e Idiomas'}
                </h5>
                {Array.isArray(tutor.specialties) && tutor.specialties.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {tutor.specialties.map((spec, idx) => (
                      <span
                        key={idx}
                        className="px-2 py-0.5 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-800 text-[11px] font-bold"
                      >
                        {spec}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-slate-500">
                    {isEn ? 'No specialties informed.' : 'Nenhuma especialidade informada.'}
                  </p>
                )}

                {Array.isArray(tutor.languagesSpoken) && tutor.languagesSpoken.length > 0 && (
                  <div className="pt-1 flex items-center gap-1.5 flex-wrap text-xs text-slate-600">
                    <Languages className="w-3.5 h-3.5 text-slate-400" />
                    <span className="font-bold">{isEn ? 'Languages:' : 'Idiomas:'}</span>
                    <span>{tutor.languagesSpoken.join(', ')}</span>
                  </div>
                )}
              </div>

              <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 space-y-2">
                <h5 className="text-xs font-black uppercase tracking-wider text-[#000035]">
                  {isEn ? 'Schedule & Meet Link' : 'Agenda e Google Meet'}
                </h5>
                <div className="text-xs text-slate-700 space-y-1">
                  <p>
                    <strong>{isEn ? 'Available Days:' : 'Dias disponíveis:'}</strong>{' '}
                    {Array.isArray(tutor.availableDays) && tutor.availableDays.length > 0
                      ? tutor.availableDays.join(', ')
                      : (isEn ? 'Not informed' : 'Não informado')}
                  </p>
                  {availabilityEntries.length > 0 && (
                    <div className="space-y-0.5 pt-0.5">
                      {availabilityEntries.map(([day, slots]) => (
                        <p key={day} className="text-[11px] text-slate-600">
                          <span className="font-bold capitalize">{day}:</span> {(slots as string[]).join(', ')}
                        </p>
                      ))}
                    </div>
                  )}
                  <div className="pt-1">
                    {safeMeetUrl ? (
                      <a
                        href={safeMeetUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 text-xs text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 px-2.5 py-1 rounded-lg font-bold transition break-all"
                      >
                        <Video className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                        <span>{safeMeetUrl}</span>
                        <ExternalLink className="w-3 h-3 shrink-0" />
                      </a>
                    ) : (
                      <span className="text-xs text-slate-500">
                        {isEn ? 'Google Meet link not informed.' : 'Link do Google Meet não informado.'}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Commission History (if any) */}
            {historyList.length > 0 && (
              <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 space-y-2">
                <h5 className="text-xs font-black uppercase tracking-wider text-[#000035] flex items-center gap-1.5">
                  <History className="w-3.5 h-3.5 text-[#1C4C96]" />
                  <span>{isEn ? 'Immutable Commission Versions' : 'Histórico Imutável de Comissão'}</span>
                </h5>
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {[...historyList].reverse().map((h) => (
                    <div
                      key={`detail-v-${h.version}-${h.updatedAt}`}
                      className="text-[11px] text-slate-600 bg-white px-2.5 py-1.5 rounded-lg border border-slate-200 flex items-center justify-between gap-2 flex-wrap"
                    >
                      <span>
                        <strong>v{h.version}</strong>: {h.adminCommissionPercent}% ({h.commissionModel})
                      </span>
                      <span className="text-[10px] text-slate-400">
                        {new Date(h.effectiveFrom || h.updatedAt).toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Detail Footer */}
          <div className="p-4 sm:px-6 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-3 shrink-0">
            <span className="text-[11px] text-slate-500 font-mono truncate">
              ID: {tutor.uid || tutor.authUid || tutor.id}
            </span>
            <div className="flex items-center gap-2">
              {mailtoHref && (
                <a
                  href={mailtoHref}
                  className="px-3.5 py-2 rounded-xl bg-[#1C4C96] hover:bg-[#062863] text-white text-xs font-black transition inline-flex items-center gap-1.5"
                  title={isEn ? 'Send email to candidate' : 'Enviar e-mail ao candidato'}
                >
                  <Mail className="w-3.5 h-3.5" />
                  <span>Contact Candidate</span>
                </a>
              )}
              <button
                type="button"
                onClick={() => setViewingTutorKey(null)}
                className="px-4 py-2 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-800 text-xs font-bold transition cursor-pointer"
              >
                {isEn ? 'Close' : 'Fechar'}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-[#000035]/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-6 overflow-y-auto"
      id="admin-approvals-modal"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white rounded-3xl max-w-4xl w-full shadow-2xl border border-[#607EC9]/40 overflow-hidden flex flex-col max-h-[90vh] my-auto animate-in fade-in zoom-in duration-200">
        {/* Header */}
        <div className="p-6 bg-gradient-to-r from-[#000035] via-[#062863] to-[#1C4C96] text-white flex items-center justify-between border-b border-[#607EC9]/40 shrink-0">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-2xl bg-[#1C4C96] text-[#F4CA54] flex items-center justify-center font-black shadow-md border border-[#9AB4FF]/50">
              <UserCheck className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h2 className="text-lg sm:text-xl font-black text-white">
                  {isEn ? 'Native Friend Approval Center' : 'Aprovação de Amigos Nativos'}
                </h2>
                {pendingCount > 0 && (
                  <span className="text-[10px] font-black px-2.5 py-0.5 rounded-full bg-[#F4CA54] text-[#000035]">
                    {pendingCount} {isEn ? 'Pending' : 'Pendentes'}
                  </span>
                )}
              </div>
              <p className="text-xs text-[#9AB4FF]">
                {isEn
                  ? 'Review and authorize native friends with mandatory individual commission before public listing.'
                  : 'Revise cadastros e defina a comissão individual da plataforma antes de aprovar.'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {onRefresh && (
              <button
                type="button"
                onClick={() => {
                  onRefresh();
                  refreshQuotes();
                }}
                className="px-3 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-[#9AB4FF] hover:text-white text-xs font-bold transition flex items-center gap-1.5 cursor-pointer"
                title={isEn ? 'Refresh list' : 'Atualizar lista'}
              >
                <RefreshCw className={`w-4 h-4 ${isRefreshing || effectiveIsPtaxLoading ? 'animate-spin text-[#F4CA54]' : ''}`} />
                <span className="hidden sm:inline">{isEn ? 'Refresh' : 'Atualizar'}</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl text-[#9AB4FF] hover:text-white hover:bg-white/10 transition cursor-pointer"
              aria-label="Close"
              title="Fechar (Esc)"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Filter bar */}
        <div className="flex items-center justify-between gap-2 p-4 bg-slate-50 border-b border-slate-200 shrink-0 overflow-x-auto">
          <div className="flex items-center gap-2">
            {[
              { id: 'all', label: isEn ? 'All Applications' : 'Todos', badge: tutors.length },
              { id: 'approved', label: isEn ? 'Approved Friends' : 'Aprovados', badge: approvedCount },
              { id: 'pending', label: isEn ? 'Pending Review' : 'Pendentes de Análise', badge: pendingCount },
              { id: 'rejected', label: isEn ? 'Rejected' : 'Recusados', badge: rejectedCount },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilter(tab.id as any)}
                className={`px-3.5 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 cursor-pointer shrink-0 ${
                  filter === tab.id
                    ? 'bg-[#000035] text-white shadow-xs'
                    : 'bg-white text-slate-600 hover:bg-slate-200 border border-slate-200'
                }`}
              >
                <span>{tab.label}</span>
                {tab.badge !== undefined && (
                  <span className={`w-5 h-5 rounded-full text-[10px] font-black flex items-center justify-center ${
                    filter === tab.id ? 'bg-[#F4CA54] text-[#000035]' : 'bg-slate-200 text-slate-700'
                  }`}>
                    {tab.badge}
                  </span>
                )}
              </button>
            ))}
          </div>

          {effectivePtaxMeta && (
            <span className="text-[10px] font-bold px-2.5 py-1 rounded-lg bg-blue-50 border border-blue-200 text-[#1C4C96] shrink-0">
              PTAX D-1: R$ {effectivePtaxMeta.rate.toFixed(4)}
              {effectivePtaxMeta.quoteDate ? ` (${effectivePtaxMeta.quoteDate})` : ''}
            </span>
          )}
        </div>

        {/* Action feedback toast */}
        {actionNotification && (
          <div className="mx-6 mt-3 p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-xs font-bold flex items-center justify-between animate-fadeIn">
            <div className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{actionNotification}</span>
            </div>
            <button
              type="button"
              onClick={() => setActionNotification(null)}
              className="text-emerald-700 hover:text-emerald-900 font-black cursor-pointer px-1"
            >
              ✕
            </button>
          </div>
        )}

        {/* Action error or Auth error alert */}
        {(actionError || authError) && (
          <div className="mx-6 mt-3 p-3 bg-rose-50 border border-rose-300 text-rose-800 rounded-xl text-xs font-bold flex items-center justify-between animate-fadeIn" role="alert">
            <div className="flex items-center gap-2">
              <XCircle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{authError || actionError}</span>
            </div>
            {actionError && !authError && (
              <button
                type="button"
                onClick={() => setActionError(null)}
                className="text-rose-700 hover:text-rose-900 font-black cursor-pointer px-1"
              >
                ✕
              </button>
            )}
          </div>
        )}

        {/* Tutors list */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {filteredTutors.length === 0 ? (
            <div className="text-center py-12 space-y-3">
              <ShieldCheck className="w-12 h-12 text-slate-300 mx-auto" />
              <p className="text-sm font-bold text-slate-600">
                {isEn ? 'No applications in this status.' : 'Nenhum cadastro com este status.'}
              </p>
            </div>
          ) : (
            filteredTutors.map((tutor) => {
              const status = isTutorApproved(tutor)
                ? 'approved'
                : isTutorRejected(tutor)
                ? 'rejected'
                : 'pending';
              const avatarSrc =
                tutor.avatar ||
                tutor.photoUrl ||
                (tutor as any).picture ||
                '';
              const tutorKey = getTutorKey(tutor);
              const rawInput = commissionInputs[tutorKey] ?? '';
              const inputValidation = validateAdminCommissionPercent(rawInput);
              const inlineError = commissionErrors[tutorKey];
              const isBusy = processingId === tutor.id;
              const historyList = Array.isArray(tutor.commissionHistory) ? tutor.commissionHistory : [];
              const isHistoryOpen = expandedHistoryId === tutorKey;

              const { quote: officialQuote } = findQuoteForTutor(
                tutor,
                quotesByTutorId,
                unavailableByTutorId
              );
              const pricingSummary = computeAdminCandidatePricingSummary({
                tutor,
                officialQuote,
                ptaxMeta: effectivePtaxMeta,
                ptaxErrorCode: effectivePtaxErrorCode,
                draftCommissionInput: rawInput,
                isLoadingPtax: effectiveIsPtaxLoading,
              });
              const hasCommission = pricingSummary.hasPersistedCommission;
              const baseUsd = pricingSummary.basePriceUsd;
              const mailtoHref = buildCandidateMailtoHref(tutor, isEn);
              const videoInfo = resolveTutorVideoPresentation(tutor);
              const safeMeetUrl = isSafeHttpUrl(tutor.meetUrl || tutor.meetLink)
                ? (tutor.meetUrl || tutor.meetLink || '').trim()
                : '';

              return (
                <div
                  key={tutor.id}
                  className="p-5 rounded-3xl bg-white border border-slate-200 shadow-sm hover:border-[#607EC9]/70 transition flex flex-col md:flex-row items-start justify-between gap-5"
                >
                  {/* Tutor Info */}
                  <div className="flex items-start gap-4 flex-1 w-full">
                    {/* Tutor Avatar with Flag Badge */}
                    <div className="relative shrink-0">
                      {avatarSrc && avatarSrc.trim() !== '' ? (
                        <img
                          src={avatarSrc}
                          alt={tutor.name}
                          referrerPolicy="no-referrer"
                          className="w-20 h-20 rounded-2xl object-cover border-2 border-[#1C4C96]/30 shrink-0 shadow-sm bg-slate-100"
                        />
                      ) : (
                        <div className="w-20 h-20 rounded-2xl border-2 border-[#1C4C96]/30 shrink-0 shadow-sm bg-[#062863]/10 flex items-center justify-center text-[#1C4C96] font-bold text-2xl">
                          {tutor.name?.charAt(0) || 'T'}
                        </div>
                      )}
                      <div className="absolute -bottom-1 -right-1 bg-[#000035] text-white text-[10px] font-black px-1.5 py-0.5 rounded-md border border-white shadow-xs">
                        {tutor.flag || '🇺🇸'}
                      </div>
                    </div>

                    <div className="space-y-1.5 flex-1 min-w-0">
                      <div className="flex items-center gap-2.5 flex-wrap">
                        <h3 className="text-base font-black text-[#000035]">{tutor.name}</h3>
                        {tutor.headline && (
                          <span className="text-xs text-slate-500 font-medium">({tutor.headline})</span>
                        )}

                        {status === 'pending' && (
                          <span className="text-[10px] font-extrabold px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-300 flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {isEn ? 'Pending Review' : 'Aguardando Aprovação'}
                          </span>
                        )}
                        {status === 'approved' && (
                          <span className="text-[10px] font-extrabold px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-900 border border-emerald-300 flex items-center gap-1">
                            <CheckCircle className="w-3 h-3 text-emerald-600" />
                            {isEn ? 'Approved & Public' : 'Aprovado e Público'}
                          </span>
                        )}
                        {status === 'rejected' && (
                          <span className="text-[10px] font-extrabold px-2.5 py-0.5 rounded-full bg-rose-100 text-rose-900 border border-rose-300 flex items-center gap-1">
                            <XCircle className="w-3 h-3 text-rose-600" />
                            {isEn ? 'Rejected' : 'Recusado'}
                          </span>
                        )}
                        {status === 'approved' && !hasCommission && (
                          <span className="text-[10px] font-extrabold px-2.5 py-0.5 rounded-full bg-orange-100 text-orange-900 border border-orange-300 flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3 text-orange-600" />
                            {isEn ? 'Pending financial configuration' : 'Pendente de configuração financeira'}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-3 text-xs text-slate-500 flex-wrap">
                        <span className="flex items-center gap-1">
                          <Mail className="w-3.5 h-3.5 text-slate-400" />
                          {tutor.email || (isEn ? 'Not informed' : 'Não informado')}
                        </span>
                        <span className="flex items-center gap-1">
                          <MapPin className="w-3.5 h-3.5 text-slate-400" />
                          {tutor.country || (tutor as any).nativeCountry || (tutor as any).location || 'United States'}
                          {tutor.accent ? ` • ${tutor.accent}` : ''}
                        </span>
                      </div>

                      {/* ADM.NF.1: Resumo financeiro persistido (Base USD + MARKUP vigente + Preço Público BRL FIN.2C/PTAX) */}
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
                        <div className="px-2.5 py-1.5 rounded-xl bg-slate-50 border border-slate-200">
                          <span className="text-[10px] font-bold uppercase text-slate-500 block">
                            {isEn ? 'Base Price (USD)' : 'Preço-base USD'}
                          </span>
                          <span className="text-xs font-black text-[#000035] flex items-center gap-1 mt-0.5">
                            <DollarSign className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                            <span>
                              {baseUsd !== null
                                ? `$${baseUsd.toFixed(2)} USD / 50 min`
                                : (isEn ? 'Not informed' : 'Não informado')}
                            </span>
                          </span>
                        </div>

                        <div className="px-2.5 py-1.5 rounded-xl bg-slate-50 border border-slate-200">
                          <span className="text-[10px] font-bold uppercase text-slate-500 block">
                            {isEn ? 'Active MARKUP' : 'Comissão MARKUP vigente'}
                          </span>
                          <span className="text-xs font-black text-[#1C4C96] block mt-0.5">
                            {hasCommission && pricingSummary.activeCommissionPercent !== null
                              ? `${pricingSummary.activeCommissionPercent}% ${pricingSummary.commissionModel}${
                                  pricingSummary.commissionVersion ? ` (v${pricingSummary.commissionVersion})` : ''
                                }`
                              : (isEn ? 'Not defined' : 'Não definida')}
                          </span>
                        </div>

                        <div className="px-2.5 py-1.5 rounded-xl bg-emerald-50/70 border border-emerald-200">
                          <span className="text-[10px] font-bold uppercase text-emerald-800 block">
                            {isEn ? 'Public Price (BRL • FIN.2C)' : 'Preço público BRL (FIN.2C)'}
                          </span>
                          <span className="text-xs font-black text-emerald-900 block mt-0.5">
                            {pricingSummary.publicPriceBrl !== null
                              ? `${formatBrl(pricingSummary.publicPriceBrl)} / 50 min`
                              : pricingSummary.publicPriceSource === 'ptax_loading'
                              ? (isEn ? 'Loading PTAX...' : 'Calculando PTAX...')
                              : pricingSummary.publicPriceSource === 'ptax_unavailable'
                              ? (isEn ? 'PTAX unavailable' : 'PTAX indisponível')
                              : pricingSummary.publicPriceSource === 'missing_base_usd'
                              ? (isEn ? 'Missing USD price' : 'Preço USD ausente')
                              : (isEn ? 'Pending commission' : 'Aguardando comissão')}
                          </span>
                          {pricingSummary.previewPriceBrl !== null && pricingSummary.previewCommissionPercent !== null && (
                            <span className="text-[10px] font-bold text-[#1C4C96] block">
                              {isEn
                                ? `Preview (${pricingSummary.previewCommissionPercent}%): ${formatBrl(pricingSummary.previewPriceBrl)}`
                                : `Simulação (${pricingSummary.previewCommissionPercent}%): ${formatBrl(pricingSummary.previewPriceBrl)}`}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* FIN.2B: Configuração e histórico administrativo da comissão individual (MARKUP) */}
                      <div className="mt-2 p-3 rounded-2xl bg-slate-50 border border-slate-200 space-y-2">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <div className="flex items-center gap-1.5 text-xs font-black text-[#000035]">
                            <Percent className="w-3.5 h-3.5 text-[#1C4C96]" />
                            <span>
                              {status === 'approved' && hasCommission
                                ? (isEn
                                    ? `Platform Commission (${tutor.commissionModel || ALLOWED_COMMISSION_MODEL})`
                                    : `Comissão da Plataforma (${tutor.commissionModel || ALLOWED_COMMISSION_MODEL})`)
                                : (isEn
                                    ? 'Platform Commission (%) *'
                                    : 'Comissão da Plataforma (%) *')}
                            </span>
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-blue-100 text-[#1C4C96]">
                              {ALLOWED_COMMISSION_MODEL}
                            </span>
                          </div>

                          {hasCommission && (
                            <div className="flex items-center gap-2 text-[11px] font-bold text-emerald-800">
                              <span>
                                {isEn ? 'Active:' : 'Vigente:'}{' '}
                                <strong>{tutor.adminCommissionPercent}%</strong>
                                {tutor.commissionVersion ? ` (v${tutor.commissionVersion})` : ''}
                              </span>
                              {historyList.length > 0 && (
                                <button
                                  type="button"
                                  onClick={() => setExpandedHistoryId(isHistoryOpen ? null : tutorKey)}
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-white border border-slate-300 text-slate-700 hover:bg-slate-100 cursor-pointer text-[10px] font-bold"
                                >
                                  <History className="w-3 h-3" />
                                  <span>
                                    {isHistoryOpen
                                      ? (isEn ? 'Hide history' : 'Ocultar histórico')
                                      : `${isEn ? 'History' : 'Histórico'} (${historyList.length})`}
                                  </span>
                                </button>
                              )}
                            </div>
                          )}
                        </div>

                        {(status !== 'approved' || onUpdateTutorCommission) && (
                          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                            <div className="relative flex-1 max-w-xs">
                              <input
                                type="number"
                                min={0}
                                max={100}
                                step="any"
                                inputMode="decimal"
                                disabled={isBusy}
                                value={rawInput}
                                onChange={(e) => handleCommissionInputChange(tutorKey, e.target.value)}
                                placeholder={
                                  status === 'approved' && hasCommission
                                    ? (isEn ? 'New commission % (0 to 100)' : 'Nova comissão % (0 a 100)')
                                    : (isEn ? 'Required: 0 to 100 (%)' : 'Obrigatório: 0 a 100 (%)')
                                }
                                aria-label={`Comissão da Plataforma (%) para ${tutor.name}`}
                                className={`w-full px-3 py-1.5 pr-8 rounded-xl border text-xs font-bold bg-white text-[#000035] focus:outline-none focus:ring-2 ${
                                  inlineError
                                    ? 'border-rose-400 focus:ring-rose-200'
                                    : 'border-slate-300 focus:ring-[#607EC9]/40 focus:border-[#1C4C96]'
                                }`}
                              />
                              <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs font-black text-slate-400">
                                %
                              </span>
                            </div>

                            {status === 'approved' && onUpdateTutorCommission && (
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={async () => {
                                  if (inFlightIdsRef.current.has(tutor.id)) return;
                                  const check = validateAdminCommissionPercent(rawInput);
                                  if (!check.valid) {
                                    setCommissionErrors((prev) => ({ ...prev, [tutorKey]: check.error }));
                                    return;
                                  }
                                  inFlightIdsRef.current.add(tutor.id);
                                  setActionError(null);
                                  setActionNotification(null);
                                  setProcessingId(tutor.id);
                                  try {
                                    const res = await onUpdateTutorCommission(tutor.id, check.value, tutor);
                                    if (res && res.success === false) {
                                      const errMsg = res.error || (isEn ? 'Failed to update commission' : 'Falha ao atualizar comissão');
                                      setCommissionErrors((prev) => ({ ...prev, [tutorKey]: errMsg }));
                                      setActionError(errMsg);
                                    } else {
                                      setCommissionInputs((prev) => ({ ...prev, [tutorKey]: '' }));
                                      setCommissionErrors((prev) => {
                                        const copy = { ...prev };
                                        delete copy[tutorKey];
                                        return copy;
                                      });
                                      refreshQuotes();
                                      setActionNotification(
                                        isEn
                                          ? `Commission (${check.value}% MARKUP) saved for "${tutor.name}".`
                                          : `Comissão (${check.value}% MARKUP) registrada para "${tutor.name}".`
                                      );
                                      setTimeout(() => setActionNotification(null), 5000);
                                    }
                                  } catch (err: any) {
                                    const msg = err?.message || (isEn ? 'Failed to update commission' : 'Falha ao atualizar comissão');
                                    setCommissionErrors((prev) => ({ ...prev, [tutorKey]: msg }));
                                    setActionError(msg);
                                  } finally {
                                    inFlightIdsRef.current.delete(tutor.id);
                                    setProcessingId(null);
                                  }
                                }}
                                className="px-3.5 py-1.5 bg-[#1C4C96] hover:bg-[#062863] disabled:opacity-50 text-white rounded-xl text-xs font-black transition cursor-pointer shrink-0"
                              >
                                {isBusy
                                  ? (isEn ? 'Saving...' : 'Salvando...')
                                  : hasCommission
                                  ? (isEn ? 'Update Commission' : 'Atualizar Comissão')
                                  : (isEn ? 'Set Commission' : 'Definir Comissão')}
                              </button>
                            )}
                          </div>
                        )}

                        {inlineError && (
                          <p className="text-[11px] font-bold text-rose-700" role="alert">
                            {inlineError}
                          </p>
                        )}

                        {isHistoryOpen && historyList.length > 0 && (
                          <div className="pt-1.5 border-t border-slate-200 space-y-1">
                            <p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500">
                              {isEn ? 'Immutable Commission Versions' : 'Histórico Imutável de Versões'}
                            </p>
                            <div className="space-y-1 max-h-32 overflow-y-auto">
                              {[...historyList].reverse().map((h) => (
                                <div
                                  key={`v-${h.version}-${h.updatedAt}`}
                                  className="text-[11px] text-slate-600 bg-white px-2.5 py-1 rounded-lg border border-slate-200 flex items-center justify-between gap-2 flex-wrap"
                                >
                                  <span>
                                    <strong>v{h.version}</strong>: {h.adminCommissionPercent}% ({h.commissionModel})
                                  </span>
                                  <span className="text-[10px] text-slate-400">
                                    {new Date(h.effectiveFrom || h.updatedAt).toLocaleString()}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Bio */}
                      {tutor.bio && (
                        <p className="text-xs text-slate-600 bg-slate-50 p-3 rounded-xl border border-slate-100 mt-2 leading-relaxed line-clamp-3">
                          {tutor.bio}
                        </p>
                      )}

                      {/* Specialties Chips */}
                      {Array.isArray(tutor?.specialties) && tutor.specialties.length > 0 && (
                        <div className="flex items-center gap-1.5 flex-wrap pt-1">
                          <span className="text-[10px] font-bold text-slate-400">
                            {isEn ? 'Focus:' : 'Especialidades:'}
                          </span>
                          {tutor.specialties.map((spec, sIdx) => (
                            <span
                              key={sIdx}
                              className="px-2 py-0.5 rounded-lg bg-indigo-50 border border-indigo-200/70 text-indigo-800 text-[10px] font-bold"
                            >
                              {spec}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Google Meet & Video Intro */}
                      <div className="flex items-center gap-3 flex-wrap pt-1">
                        {safeMeetUrl && (
                          <a
                            href={safeMeetUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1.5 text-xs text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 px-2.5 py-1 rounded-lg font-bold transition"
                          >
                            <Video className="w-3.5 h-3.5 text-emerald-600" />
                            <span>Google Meet: {safeMeetUrl}</span>
                            <ExternalLink className="w-3 h-3 text-emerald-500" />
                          </a>
                        )}

                        {videoInfo.hasVideo && videoInfo.watchUrl && (
                          <button
                            type="button"
                            onClick={() => setViewingTutorKey(tutorKey)}
                            className="inline-flex items-center gap-1.5 text-xs text-[#1C4C96] hover:underline font-bold cursor-pointer"
                          >
                            <Video className="w-3.5 h-3.5" />
                            <span>{isEn ? 'Watch presentation video' : 'Ver vídeo de apresentação'}</span>
                          </button>
                        )}
                      </div>

                      {/* Availability & Applied Date */}
                      <div className="flex items-center gap-4 text-[11px] text-slate-400 pt-1 flex-wrap">
                        {tutor.availableDays && tutor.availableDays.length > 0 && (
                          <div className="flex items-center gap-1 text-slate-500">
                            <Calendar className="w-3 h-3 text-slate-400" />
                            <span>
                              <strong>{isEn ? 'Available:' : 'Dias:'}</strong> {tutor.availableDays.join(', ')}
                            </span>
                          </div>
                        )}
                        {tutor.appliedAt && (
                          <span>
                            {isEn ? 'Applied:' : 'Cadastrado em:'}{' '}
                            {new Date(tutor.appliedAt).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex sm:flex-col gap-2 w-full sm:w-auto shrink-0 flex-wrap">
                    {/* ADM.NF.1: View Application & Contact Candidate */}
                    <button
                      type="button"
                      onClick={() => setViewingTutorKey(tutorKey)}
                      className="flex-1 sm:flex-initial px-3.5 py-2 bg-[#062863] hover:bg-[#000035] text-white rounded-xl text-xs font-black transition flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
                    >
                      <Eye className="w-4 h-4 text-[#F4CA54]" />
                      <span>{isEn ? 'View Application' : 'View Application'}</span>
                    </button>

                    {mailtoHref ? (
                      <a
                        href={mailtoHref}
                        className="flex-1 sm:flex-initial px-3.5 py-2 bg-blue-50 hover:bg-blue-100 text-[#1C4C96] border border-blue-200 rounded-xl text-xs font-black transition flex items-center justify-center gap-1.5 shadow-xs"
                      >
                        <Mail className="w-4 h-4" />
                        <span>{isEn ? 'Contact Candidate' : 'Contact Candidate'}</span>
                      </a>
                    ) : (
                      <span className="flex-1 sm:flex-initial px-3.5 py-2 bg-slate-100 text-slate-400 border border-slate-200 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5">
                        <Mail className="w-4 h-4" />
                        <span>{isEn ? 'No email' : 'Sem e-mail'}</span>
                      </span>
                    )}

                    {status !== 'approved' && (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={async () => {
                          if (inFlightIdsRef.current.has(tutor.id)) return;
                          setActionError(null);
                          setActionNotification(null);

                          const check = validateAdminCommissionPercent(rawInput);
                          if (!check.valid) {
                            setCommissionErrors((prev) => ({ ...prev, [tutorKey]: check.error }));
                            setActionError(check.error);
                            return;
                          }

                          inFlightIdsRef.current.add(tutor.id);
                          setProcessingId(tutor.id);
                          try {
                            const res = await onApproveTutor(tutor.id, tutor, check.value);
                            if (res && res.success === false) {
                              const errMsg = res.error || (isEn ? 'Failed to approve native friend' : 'Falha ao aprovar Amigo Nativo');
                              setCommissionErrors((prev) => ({ ...prev, [tutorKey]: errMsg }));
                              setActionError(errMsg);
                            } else {
                              setCommissionInputs((prev) => ({ ...prev, [tutorKey]: '' }));
                              setCommissionErrors((prev) => {
                                const copy = { ...prev };
                                delete copy[tutorKey];
                                return copy;
                              });
                              refreshQuotes();
                              setActionNotification(
                                isEn
                                  ? `Native Friend "${tutor.name}" approved with ${check.value}% commission and published!`
                                  : `Amigo Nativo "${tutor.name}" aprovado com comissão de ${check.value}% e publicado!`
                              );
                              setTimeout(() => setActionNotification(null), 5000);
                            }
                          } catch (err: any) {
                            const msg = err?.message || (isEn ? 'Failed to approve native friend' : 'Falha ao aprovar Amigo Nativo');
                            setCommissionErrors((prev) => ({ ...prev, [tutorKey]: msg }));
                            setActionError(msg);
                          } finally {
                            inFlightIdsRef.current.delete(tutor.id);
                            setProcessingId(null);
                          }
                        }}
                        className={`flex-1 sm:flex-initial px-4 py-2 ${
                          inputValidation.valid
                            ? 'bg-emerald-600 hover:bg-emerald-700'
                            : 'bg-slate-400 hover:bg-slate-500'
                        } disabled:opacity-50 text-white rounded-xl text-xs font-black transition flex items-center justify-center gap-1.5 cursor-pointer shadow-sm`}
                        title={
                          !inputValidation.valid
                            ? inputValidation.error
                            : (isEn ? 'Approve Native Friend' : 'Aprovar Amigo Nativo')
                        }
                      >
                        <CheckCircle className={`w-4 h-4 ${isBusy ? 'animate-spin' : ''}`} />
                        <span>{isBusy ? (isEn ? 'Approving...' : 'Aprovando...') : (isEn ? 'Approve' : 'Aprovar')}</span>
                      </button>
                    )}

                    {status !== 'rejected' && (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={async () => {
                          if (inFlightIdsRef.current.has(tutor.id)) return;
                          inFlightIdsRef.current.add(tutor.id);
                          setActionError(null);
                          setActionNotification(null);
                          setProcessingId(tutor.id);
                          try {
                            const res = await onRejectTutor(tutor.id, tutor);
                            if (res && res.success === false) {
                              setActionError(res.error || (isEn ? 'Failed to reject native friend' : 'Falha ao recusar Amigo Nativo'));
                            } else {
                              setActionNotification(
                                isEn
                                  ? `Native Friend "${tutor.name}" rejected.`
                                  : `Cadastro de "${tutor.name}" recusado.`
                              );
                              setTimeout(() => setActionNotification(null), 5000);
                            }
                          } catch (err: any) {
                            setActionError(err?.message || (isEn ? 'Failed to reject native friend' : 'Falha ao recusar Amigo Nativo'));
                          } finally {
                            inFlightIdsRef.current.delete(tutor.id);
                            setProcessingId(null);
                          }
                        }}
                        className="flex-1 sm:flex-initial px-4 py-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white rounded-xl text-xs font-black transition flex items-center justify-center gap-1.5 cursor-pointer shadow-sm"
                      >
                        <XCircle className={`w-4 h-4 ${isBusy ? 'animate-spin' : ''}`} />
                        <span>{isBusy ? (isEn ? 'Rejecting...' : 'Recusando...') : (isEn ? 'Reject' : 'Recusar')}</span>
                      </button>
                    )}

                    {onDeleteTutor && (
                      confirmDeleteId === tutor.id ? (
                        <div className="flex flex-col gap-1.5 p-2 bg-rose-50 border border-rose-300 rounded-xl shadow-xs animate-fadeIn">
                          <span className="text-[11px] font-bold text-rose-800 text-center leading-tight">
                            {isEn ? 'Permanently delete?' : 'Confirmar exclusão?'}
                          </span>
                          <div className="flex items-center gap-1.5 justify-center">
                            <button
                              type="button"
                              disabled={deletingId === tutor.id}
                              onClick={async () => {
                                setDeletingId(tutor.id);
                                try {
                                  await onDeleteTutor(tutor.id, tutor.email);
                                  setActionNotification(
                                    isEn
                                      ? `Native friend "${tutor.name}" was permanently deleted.`
                                      : `Amigo Nativo "${tutor.name}" excluído com sucesso.`
                                  );
                                  setTimeout(() => setActionNotification(null), 4000);
                                } finally {
                                  setDeletingId(null);
                                  setConfirmDeleteId(null);
                                }
                              }}
                              className="px-2.5 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-black transition flex items-center gap-1 shadow-sm cursor-pointer disabled:opacity-50"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              <span>
                                {deletingId === tutor.id
                                  ? (isEn ? 'Deleting...' : 'Excluindo...')
                                  : (isEn ? 'Yes, delete' : 'Sim, excluir')}
                              </span>
                            </button>
                            <button
                              type="button"
                              disabled={deletingId === tutor.id}
                              onClick={() => setConfirmDeleteId(null)}
                              className="px-2 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-lg text-xs font-bold transition cursor-pointer"
                            >
                              {isEn ? 'Cancel' : 'Cancelar'}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(tutor.id)}
                          className="flex-1 sm:flex-initial px-3.5 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
                          title={isEn ? 'Delete tutor from system' : 'Excluir Amigo Nativo do sistema'}
                        >
                          <Trash2 className="w-4 h-4 text-rose-600" />
                          <span>{isEn ? 'Delete' : 'Excluir'}</span>
                        </button>
                      )
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* View Application Detail Modal */}
      {viewingTutor && renderApplicationDetailModal(viewingTutor)}
    </div>
  );
};
