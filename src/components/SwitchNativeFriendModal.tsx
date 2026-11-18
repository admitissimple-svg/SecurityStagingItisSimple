import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import {
  X,
  ArrowLeftRight,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  ShieldCheck,
  CalendarX,
  CalendarCheck,
  Gift,
  Coins,
  Search,
  ChevronRight,
  Lock,
  Clock,
  Info,
} from 'lucide-react';
import type {
  Language,
  NativeFriendTutor,
  SwitchExecuteResponseDto,
  SwitchPreviewResponseDto,
  UserProfile,
} from '../types';
import {
  confirmNativeFriendSwitch,
  createSwitchIdempotencyKey,
  formatBrlFromCents,
  getBilingualSwitchError,
  requestNativeFriendSwitchPreview,
  type BilingualSwitchErrorCopy,
} from '../utils/nativeFriendSwitchClient';
import { useBatchTutorPricingQuotes } from '../hooks/useTutorPricingQuote';
import { findQuoteForTutor, formatBrl } from '../utils/pricingQuoteClient';
import { isValidCanonicalUid } from '../utils/studentPersistence';

export interface SwitchNativeFriendModalProps {
  isOpen: boolean;
  onClose: () => void;
  userProfile: UserProfile | null;
  tutorsList: NativeFriendTutor[];
  currentLanguage: Language;
  timeZone?: string;
  initialTargetTutor?: NativeFriendTutor | null;
  onSwitchSuccess?: (result: SwitchExecuteResponseDto, targetTutor: NativeFriendTutor | null) => void | Promise<void>;
  onScheduleWithNewTutor?: () => void;
  /** Optional initial preview/state injection for deterministic SSR & UI verification tests */
  initialPreviewStateForTest?: SwitchPreviewResponseDto | null;
  initialErrorStateForTest?: BilingualSwitchErrorCopy | null;
  initialSuccessStateForTest?: SwitchExecuteResponseDto | null;
}

function resolveTutorCanonicalIdentifier(tutor: NativeFriendTutor): string {
  if (tutor.uid && isValidCanonicalUid(tutor.uid)) return tutor.uid.trim();
  if (tutor.authUid && isValidCanonicalUid(tutor.authUid)) return tutor.authUid.trim();
  if (tutor.id && tutor.id.trim()) return tutor.id.trim();
  if (tutor.publicTutorId && tutor.publicTutorId.trim()) return tutor.publicTutorId.trim();
  return (tutor.email || '').trim().toLowerCase();
}

function isSameTutorAsCurrent(
  tutor: NativeFriendTutor,
  currentTeacherUid: string,
  currentTeacherEmail: string
): boolean {
  if (
    currentTeacherUid &&
    (tutor.uid === currentTeacherUid || tutor.authUid === currentTeacherUid || tutor.id === currentTeacherUid)
  ) {
    return true;
  }
  const tEmail = (tutor.email || '').toLowerCase().trim();
  if (currentTeacherEmail && tEmail && tEmail === currentTeacherEmail) {
    return true;
  }
  return false;
}

function formatLessonDateTime(iso: string, isEn: boolean, timeZone?: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  try {
    return new Intl.DateTimeFormat(isEn ? 'en-US' : 'pt-BR', {
      timeZone: timeZone || 'America/Sao_Paulo',
      weekday: 'short',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(ms));
  } catch {
    return iso;
  }
}

export const SwitchNativeFriendModal: React.FC<SwitchNativeFriendModalProps> = ({
  isOpen,
  onClose,
  userProfile,
  tutorsList,
  currentLanguage,
  timeZone = 'America/Sao_Paulo',
  initialTargetTutor = null,
  onSwitchSuccess,
  onScheduleWithNewTutor,
  initialPreviewStateForTest = null,
  initialErrorStateForTest = null,
  initialSuccessStateForTest = null,
}) => {
  const isEn = currentLanguage === 'en';

  const currentTeacherUid = String(
    userProfile?.teacherUid || userProfile?.assignedNativeFriendUID || userProfile?.nativeFriendUID || ''
  ).trim();
  const currentTeacherEmail = String(userProfile?.teacherEmail || '').toLowerCase().trim();
  const currentTeacherName = String(
    userProfile?.teacherName ||
      (currentTeacherEmail ? currentTeacherEmail.split('@')[0] : isEn ? 'Current Native Friend' : 'Amigo Nativo Atual')
  ).trim();

  const candidateTutors = useMemo(() => {
    return (tutorsList || []).filter((tutor) => {
      if ((tutor.approvalStatus || 'approved') !== 'approved') return false;
      if (isSameTutorAsCurrent(tutor, currentTeacherUid, currentTeacherEmail)) return false;
      return Boolean(resolveTutorCanonicalIdentifier(tutor));
    });
  }, [tutorsList, currentTeacherUid, currentTeacherEmail]);

  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedTargetTutor, setSelectedTargetTutor] = useState<NativeFriendTutor | null>(initialTargetTutor);
  const [preview, setPreview] = useState<SwitchPreviewResponseDto | null>(initialPreviewStateForTest);
  const [isLoadingPreview, setIsLoadingPreview] = useState<boolean>(false);
  const [previewError, setPreviewError] = useState<BilingualSwitchErrorCopy | null>(initialErrorStateForTest);
  const [submitError, setSubmitError] = useState<BilingualSwitchErrorCopy | null>(initialErrorStateForTest);
  const [isConfirmed, setIsConfirmed] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [completedResult, setCompletedResult] = useState<SwitchExecuteResponseDto | null>(initialSuccessStateForTest);

  // Keeps same idempotencyKey while retrying the exact same snapshot attempt; rotated whenever preview changes.
  const idempotencyKeyRef = useRef<string>('');
  const activePreviewRequestIdRef = useRef<number>(0);

  const { quotesByTutorId, unavailableByTutorId, isLoading: isQuotesLoading } = useBatchTutorPricingQuotes(
    isOpen && !selectedTargetTutor,
    isOpen
  );

  const filteredCandidates = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return candidateTutors;
    return candidateTutors.filter((t) => {
      const hay = [t.name, t.accent, t.headline, ...(t.specialties || [])]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [candidateTutors, searchQuery]);

  const loadPreviewForTutor = useCallback(
    async (tutor: NativeFriendTutor) => {
      const targetId = resolveTutorCanonicalIdentifier(tutor);
      if (!targetId) return;

      const reqId = ++activePreviewRequestIdRef.current;
      setSelectedTargetTutor(tutor);
      setIsLoadingPreview(true);
      setPreviewError(null);
      setSubmitError(null);
      setIsConfirmed(false);
      setPreview(null);
      idempotencyKeyRef.current = '';

      const res = await requestNativeFriendSwitchPreview({
        targetTeacherId: targetId,
        expectedCurrentTeacherUid: currentTeacherUid || undefined,
      });

      if (activePreviewRequestIdRef.current !== reqId) return;

      if (!res.success) {
        setPreviewError(getBilingualSwitchError(res.errorCode, res.message, isEn));
        setIsLoadingPreview(false);
        return;
      }

      idempotencyKeyRef.current = createSwitchIdempotencyKey(res.targetTeacher.uid || targetId);
      setPreview(res);
      setIsLoadingPreview(false);
    },
    [currentTeacherUid, isEn]
  );

  useEffect(() => {
    if (!isOpen) return;
    if (initialPreviewStateForTest || initialSuccessStateForTest || initialErrorStateForTest) {
      return;
    }
    setSearchQuery('');
    setPreview(null);
    setPreviewError(null);
    setSubmitError(null);
    setIsConfirmed(false);
    setIsSubmitting(false);
    setCompletedResult(null);
    idempotencyKeyRef.current = '';

    if (
      initialTargetTutor &&
      !isSameTutorAsCurrent(initialTargetTutor, currentTeacherUid, currentTeacherEmail)
    ) {
      setSelectedTargetTutor(initialTargetTutor);
      void loadPreviewForTutor(initialTargetTutor);
    } else {
      setSelectedTargetTutor(null);
    }
  }, [
    isOpen,
    initialTargetTutor,
    currentTeacherUid,
    currentTeacherEmail,
    initialPreviewStateForTest,
    initialSuccessStateForTest,
    initialErrorStateForTest,
    loadPreviewForTutor,
  ]);

  const handleConfirmSwitch = async () => {
    if (
      isSubmitting ||
      isLoadingPreview ||
      !preview ||
      preview.status !== 'READY' ||
      !preview.canConfirm ||
      !preview.previewToken ||
      !preview.previewSnapshotHash ||
      !isConfirmed
    ) {
      return;
    }

    if (!idempotencyKeyRef.current) {
      idempotencyKeyRef.current = createSwitchIdempotencyKey(preview.targetTeacher.uid);
    }

    setIsSubmitting(true);
    setSubmitError(null);

    const execRes = await confirmNativeFriendSwitch({
      targetTeacherUid: preview.targetTeacher.uid,
      expectedCurrentTeacherUid: preview.sourceTeacher.uid || currentTeacherUid || undefined,
      previewToken: preview.previewToken,
      previewSnapshotHash: preview.previewSnapshotHash,
      idempotencyKey: idempotencyKeyRef.current,
    });

    if (!execRes.success) {
      const mapped = getBilingualSwitchError(execRes.errorCode, execRes.message, isEn);
      setSubmitError(mapped);
      setIsSubmitting(false);
      return;
    }

    setCompletedResult(execRes);
    setIsSubmitting(false);

    if (onSwitchSuccess) {
      await onSwitchSuccess(execRes, selectedTargetTutor);
    }
  };

  if (!isOpen) return null;

  const canRenderReadyPreview = Boolean(preview && preview.status === 'READY' && preview.canConfirm);
  const canClickConfirm = Boolean(
    canRenderReadyPreview &&
      isConfirmed &&
      !isLoadingPreview &&
      !isSubmitting &&
      preview?.previewToken &&
      preview?.previewSnapshotHash &&
      !submitError?.requiresPreviewRefresh
  );

  return (
    <div
      className="fixed inset-0 z-50 bg-[#000035]/70 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="switch-native-friend-modal-title"
    >
      <div className="bg-white rounded-3xl max-w-2xl w-full shadow-2xl border border-[#607EC9]/30 overflow-hidden my-auto max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 bg-[#000035] text-white flex items-center justify-between border-b border-[#1C4C96] shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-2xl bg-[#1C4C96] flex items-center justify-center text-white border border-[#9AB4FF]/40 shrink-0">
              <ArrowLeftRight className="w-5 h-5 text-[#9AB4FF]" />
            </div>
            <div className="min-w-0">
              <h3 id="switch-native-friend-modal-title" className="font-black text-base sm:text-lg text-white truncate">
                {completedResult
                  ? isEn
                    ? 'Native Friend Switched'
                    : 'Amigo Nativo Alterado'
                  : isEn
                  ? 'Switch Native Friend'
                  : 'Trocar de Amigo Nativo'}
              </h3>
              <p className="text-xs text-[#9AB4FF] truncate">
                {completedResult
                  ? isEn
                    ? 'Your credits, schedule, and balance were updated on the server'
                    : 'Créditos, agenda e saldo atualizados com segurança no servidor'
                  : isEn
                  ? `Current mentor: ${currentTeacherName}`
                  : `Mentor atual: ${currentTeacherName}`}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="p-1.5 rounded-xl text-[#9AB4FF] hover:text-white hover:bg-[#1C4C96] transition cursor-pointer disabled:opacity-50 shrink-0"
            aria-label={isEn ? 'Close modal' : 'Fechar modal'}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 sm:p-6 space-y-5 overflow-y-auto overflow-x-hidden flex-1">
          {/* STATE 1: COMPLETED SUCCESS */}
          {completedResult ? (
            <div className="space-y-5" data-testid="switch-success-summary">
              <div className="p-5 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-start gap-3.5">
                <CheckCircle2 className="w-6 h-6 text-emerald-700 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <h4 className="font-black text-base text-emerald-950">
                    {isEn
                      ? `You are now learning with ${completedResult.targetTeacherName}!`
                      : `Agora você está conectado(a) com ${completedResult.targetTeacherName}!`}
                  </h4>
                  <p className="text-xs text-emerald-900 leading-relaxed">
                    {isEn
                      ? 'All eligible unstarted future lessons were cancelled with full refund, and your remaining credits were converted with zero additional cost.'
                      : 'As aulas futuras não iniciadas foram canceladas com estorno integral e seus créditos disponíveis foram convertidos sem custo adicional.'}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-600 block">
                    {isEn ? 'Available Credits' : 'Créditos Disponíveis'}
                  </span>
                  <span className="text-2xl font-black text-[#000035] tabular-nums mt-1 block">
                    {completedResult.availableLessonsAfterSwitch}
                  </span>
                  <span className="text-[11px] text-[#062863] font-medium">
                    {isEn ? 'ready to schedule' : 'prontos para agendar'}
                  </span>
                </div>

                <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-600 block">
                    {isEn ? 'Residual Credit' : 'Saldo Residual'}
                  </span>
                  <span className="text-2xl font-black text-[#000035] tabular-nums mt-1 block">
                    {formatBrlFromCents(completedResult.residualBrlCentsAfter)}
                  </span>
                  <span className="text-[11px] text-[#062863] font-medium">
                    {isEn ? 'kept in your BRL account' : 'preservado em reais na sua conta'}
                  </span>
                </div>

                <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-600 block">
                    {isEn ? 'Cancelled Q2 Lessons' : 'Aulas Canceladas (Q2)'}
                  </span>
                  <span className="text-2xl font-black text-[#000035] tabular-nums mt-1 block">
                    {completedResult.q2CancelledLessonsCount}
                  </span>
                  <span className="text-[11px] text-[#062863] font-medium tabular-nums">
                    {isEn
                      ? `${completedResult.q2RefundedCreditsCount} credit(s) refunded`
                      : `${completedResult.q2RefundedCreditsCount} crédito(s) estornado(s)`}
                  </span>
                </div>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-700 flex flex-wrap items-center justify-between gap-2">
                <span>
                  {isEn ? 'Switch Audit ID:' : 'Código de Auditoria da Troca:'}{' '}
                  <strong className="font-mono text-[#000035]">{completedResult.switchAuditId}</strong>
                </span>
                {completedResult.lockedStartedLessonsCount > 0 && (
                  <span className="text-[#062863] font-semibold">
                    {isEn
                      ? `${completedResult.lockedStartedLessonsCount} started/historical lesson(s) preserved`
                      : `${completedResult.lockedStartedLessonsCount} aula(s) já iniciada(s) preservada(s)`}
                  </span>
                )}
              </div>

              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2.5 rounded-xl bg-white border border-slate-300 hover:bg-slate-50 text-slate-800 text-xs font-bold transition cursor-pointer whitespace-nowrap shrink-0"
                >
                  {isEn ? 'Back to Dashboard' : 'Voltar ao Painel'}
                </button>
                {onScheduleWithNewTutor && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onScheduleWithNewTutor();
                    }}
                    className="px-5 py-2.5 rounded-xl bg-[#1C4C96] hover:bg-[#062863] text-white text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <CalendarCheck className="w-4 h-4 text-[#9AB4FF]" />
                    <span>{isEn ? 'Schedule with New Native Friend' : 'Agendar com Novo Amigo Nativo'}</span>
                  </button>
                )}
              </div>
            </div>
          ) : !selectedTargetTutor && !preview ? (
            /* STATE 2: SELECT ANOTHER APPROVED NATIVE FRIEND */
            <div className="space-y-4" data-testid="switch-tutor-selector">
              <div className="p-3.5 rounded-2xl bg-blue-50/70 border border-[#9AB4FF]/50 flex items-start gap-2.5 text-xs text-[#062863]">
                <ShieldCheck className="w-5 h-5 text-[#1C4C96] shrink-0 mt-0.5" />
                <div className="space-y-0.5">
                  <strong className="block font-bold text-[#000035]">
                    {isEn
                      ? 'Transparent Server-Calculated Conversion · Zero Additional Fee'
                      : 'Conversão Calculada no Servidor · Sem Taxa Adicional'}
                  </strong>
                  <p className="leading-relaxed">
                    {isEn
                      ? 'Choose another Native Friend below to see an exact preview of cancelled unstarted lessons, converted paid credits, 1:1 courtesy lessons, and any residual BRL credit before confirming.'
                      : 'Escolha outro Amigo Nativo abaixo para visualizar a prévia exata das aulas futuras canceladas (estorno integral), novos créditos pagos, cortesias 1:1 e saldo residual antes de confirmar.'}
                  </p>
                </div>
              </div>

              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={isEn ? 'Search by name, accent or specialty...' : 'Buscar por nome, sotaque ou especialidade...'}
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-300 text-xs text-[#000035] placeholder:text-slate-400 focus:outline-none focus:border-[#1C4C96] focus:ring-2 focus:ring-[#1C4C96]/20"
                  aria-label={isEn ? 'Search available Native Friends' : 'Buscar Amigos Nativos disponíveis'}
                />
              </div>

              <div className="space-y-2.5">
                {filteredCandidates.map((tutor) => {
                  const { quote } = findQuoteForTutor(tutor, quotesByTutorId, unavailableByTutorId);
                  return (
                    <div
                      key={resolveTutorCanonicalIdentifier(tutor)}
                      className="rounded-2xl p-4 border border-[#607EC9]/30 hover:border-[#1C4C96] bg-white transition flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-11 h-11 rounded-xl bg-[#062863] text-white flex items-center justify-center font-black text-sm border border-[#9AB4FF]/40 shrink-0 overflow-hidden">
                          {tutor.avatar && tutor.avatar.trim() !== '' ? (
                            <img src={tutor.avatar} alt={tutor.name} className="w-full h-full object-cover" />
                          ) : (
                            (tutor.name || 'AN').slice(0, 2).toUpperCase()
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <h4 className="font-black text-sm text-[#000035] truncate">{tutor.name}</h4>
                            {tutor.flag && <span className="text-sm shrink-0">{tutor.flag}</span>}
                          </div>
                          <p className="text-xs text-[#062863] truncate">
                            {[tutor.accent, tutor.headline].filter(Boolean).join(' · ') ||
                              (isEn ? 'Approved Native Friend' : 'Amigo Nativo Aprovado')}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center justify-between sm:justify-end gap-3 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-100 shrink-0">
                        <div className="text-left sm:text-right">
                          {isQuotesLoading && !quote ? (
                            <span className="text-[11px] text-slate-500 font-medium">
                              {isEn ? 'Loading price...' : 'Consultando preço...'}
                            </span>
                          ) : quote ? (
                            <div className="tabular-nums">
                              <span className="text-sm font-black text-[#000035]">
                                {formatBrl(quote.unit.finalPriceBrl)}
                              </span>
                              <span className="text-[11px] text-[#607EC9]"> / {isEn ? 'lesson' : 'aula'}</span>
                            </div>
                          ) : (
                            <span className="text-[11px] text-slate-500">
                              {isEn ? 'Preview checks price' : 'Prévia valida preço'}
                            </span>
                          )}
                        </div>

                        <button
                          type="button"
                          onClick={() => void loadPreviewForTutor(tutor)}
                          className="px-3.5 py-2 rounded-xl bg-[#1C4C96] hover:bg-[#062863] text-white text-xs font-bold transition flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
                        >
                          <span>{isEn ? 'Preview Switch' : 'Simular Troca'}</span>
                          <ChevronRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}

                {filteredCandidates.length === 0 && (
                  <div className="p-6 text-center rounded-2xl bg-slate-50 border border-slate-200 text-xs text-slate-600">
                    {isEn
                      ? 'No other approved Native Friends match your search right now.'
                      : 'Nenhum outro Amigo Nativo aprovado disponível encontrado para esta busca.'}
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* STATE 3: SERVER-CALCULATED PREVIEW & EXPLICIT CONFIRMATION */
            <div className="space-y-4" data-testid="switch-preview-panel">
              {/* Top Action Row */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                {candidateTutors.length > 0 && !isSubmitting && (
                  <button
                    type="button"
                    onClick={() => {
                      activePreviewRequestIdRef.current += 1;
                      setSelectedTargetTutor(null);
                      setPreview(null);
                      setPreviewError(null);
                      setSubmitError(null);
                      setIsConfirmed(false);
                    }}
                    className="text-xs font-bold text-[#1C4C96] hover:text-[#062863] hover:underline cursor-pointer"
                  >
                    ← {isEn ? 'Choose another Native Friend' : 'Escolher outro Amigo Nativo'}
                  </button>
                )}

                {selectedTargetTutor && (
                  <button
                    type="button"
                    disabled={isLoadingPreview || isSubmitting}
                    onClick={() => void loadPreviewForTutor(selectedTargetTutor)}
                    className="ml-auto px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-[#062863] text-xs font-bold transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50 whitespace-nowrap shrink-0"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isLoadingPreview ? 'animate-spin' : ''}`} />
                    <span>{isEn ? 'Refresh Preview' : 'Atualizar Prévia'}</span>
                  </button>
                )}
              </div>

              {/* Loading Skeleton */}
              {isLoadingPreview && (
                <div className="p-6 rounded-2xl border border-[#607EC9]/30 bg-slate-50 text-center space-y-2.5">
                  <RefreshCw className="w-6 h-6 text-[#1C4C96] animate-spin mx-auto" />
                  <p className="text-xs font-bold text-[#000035]">
                    {isEn
                      ? 'Calculating Q2 refunds, BACEN PTAX D-1 quote, and converted credits on the server...'
                      : 'Calculando estornos Q2, cotação oficial PTAX D-1 e novos créditos no servidor...'}
                  </p>
                </div>
              )}

              {/* Preview Fetch Error */}
              {!isLoadingPreview && previewError && (
                <div className="p-4 rounded-2xl bg-rose-50 border border-rose-300 space-y-3" data-testid="switch-preview-error">
                  <div className="flex items-start gap-2.5 text-rose-950">
                    <AlertTriangle className="w-5 h-5 text-rose-700 shrink-0 mt-0.5" />
                    <div className="space-y-1 text-xs">
                      <strong className="block font-black text-sm">{previewError.title}</strong>
                      <p className="leading-relaxed text-rose-900">{previewError.message}</p>
                    </div>
                  </div>
                  {selectedTargetTutor && previewError.requiresPreviewRefresh && (
                    <button
                      type="button"
                      onClick={() => void loadPreviewForTutor(selectedTargetTutor)}
                      className="px-3.5 py-2 rounded-xl bg-white border border-rose-300 hover:bg-rose-100 text-rose-900 text-xs font-bold transition inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>{isEn ? 'Try Again' : 'Tentar Novamente'}</span>
                    </button>
                  )}
                </div>
              )}

              {/* Loaded Preview Details */}
              {!isLoadingPreview && preview && (
                <div className="space-y-4">
                  {/* Mentor Transition & Authoritative PTAX Summary */}
                  <div className="p-4 rounded-2xl bg-[#9AB4FF]/10 border border-[#607EC9]/30 space-y-2.5">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div>
                        <span className="text-[11px] font-bold uppercase tracking-wider text-[#062863] block">
                          {isEn ? 'Native Friend Transition' : 'Troca de Amigo Nativo'}
                        </span>
                        <p className="text-sm font-black text-[#000035] mt-0.5">
                          {preview.sourceTeacher.name || currentTeacherName} → {preview.targetTeacher.name}
                        </p>
                      </div>
                      <div className="text-left sm:text-right tabular-nums">
                        <span className="text-[11px] font-bold uppercase tracking-wider text-[#062863] block">
                          {isEn ? 'Target Unit Price' : 'Valor Unitário (50 min)'}
                        </span>
                        <span className="text-base font-black text-[#000035]">
                          {formatBrlFromCents(preview.targetTeacher.unitFinalPriceBrlCents)}
                        </span>
                      </div>
                    </div>

                    <div className="pt-2 border-t border-[#607EC9]/20 text-[11px] text-[#062863] flex flex-wrap items-center gap-x-2 gap-y-1 tabular-nums">
                      <span>
                        {isEn ? 'Official BACEN PTAX D-1' : 'PTAX Oficial BACEN D-1'}:{' '}
                        <strong>R$ {preview.ptax.rate.toFixed(4)}</strong>
                      </span>
                      {preview.ptax.quoteDate && (
                        <>
                          <span>·</span>
                          <span>
                            {isEn ? 'Ref Date' : 'Data Ref.'}: {preview.ptax.quoteDate}
                          </span>
                        </>
                      )}
                      <span>·</span>
                      <span>
                        {isEn ? 'Additional Charge' : 'Cobrança Adicional'}:{' '}
                        <strong className="text-emerald-800">{formatBrlFromCents(preview.balances.additionalCostBrlCents)}</strong>
                      </span>
                    </div>
                  </div>

                  {/* Blocking Alert (when BLOCKED) */}
                  {preview.status === 'BLOCKED' && (
                    <div className="p-4 rounded-2xl bg-rose-50 border border-rose-300 space-y-2" data-testid="switch-preview-blocked">
                      <div className="flex items-start gap-2.5 text-rose-950">
                        <Lock className="w-5 h-5 text-rose-700 shrink-0 mt-0.5" />
                        <div className="space-y-1.5 text-xs">
                          <strong className="block font-black text-sm">
                            {isEn ? 'Switch Blocked for Account Integrity' : 'Troca Bloqueada por Regra de Integridade'}
                          </strong>
                          {preview.blockingReasons.map((reason, idx) => {
                            const mapped = getBilingualSwitchError(reason.code, reason.message, isEn);
                            return (
                              <p key={`${reason.code}-${idx}`} className="text-rose-900 leading-relaxed">
                                {mapped.message}
                              </p>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Warnings */}
                  {preview.warnings.length > 0 && (
                    <div className="p-3.5 rounded-2xl bg-amber-50 border border-amber-300 text-xs text-amber-950 space-y-1">
                      {preview.warnings.map((w, idx) => (
                        <div key={`${w.code}-${idx}`} className="flex items-start gap-2">
                          <Info className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                          <span className="leading-relaxed">{w.message}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Submit Error (including Stale / Concurrency / Timeout) */}
                  {submitError && (
                    <div className="p-4 rounded-2xl bg-rose-50 border border-rose-300 space-y-3" data-testid="switch-submit-error">
                      <div className="flex items-start gap-2.5 text-rose-950">
                        <AlertTriangle className="w-5 h-5 text-rose-700 shrink-0 mt-0.5" />
                        <div className="space-y-1 text-xs">
                          <strong className="block font-black text-sm">{submitError.title}</strong>
                          <p className="leading-relaxed text-rose-900">{submitError.message}</p>
                        </div>
                      </div>
                      {submitError.requiresPreviewRefresh && selectedTargetTutor && (
                        <button
                          type="button"
                          onClick={() => void loadPreviewForTutor(selectedTargetTutor)}
                          className="px-3.5 py-2 rounded-xl bg-[#000035] hover:bg-[#062863] text-white text-xs font-bold transition inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                          <span>{isEn ? 'Refresh Server Preview' : 'Atualizar Prévia do Servidor'}</span>
                        </button>
                      )}
                    </div>
                  )}

                  {/* Q2: Future Scheduled Lessons Cancellation & Refund Breakdown */}
                  <div className="rounded-2xl border border-slate-200 p-4 space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <h4 className="font-black text-xs uppercase tracking-wider text-[#000035] flex items-center gap-1.5">
                        <CalendarX className="w-4 h-4 text-[#1C4C96]" />
                        <span>
                          {isEn ? 'Scheduled Lessons Impact (Q2 Rule)' : 'Aulas Agendadas (Regra Q2)'}
                        </span>
                      </h4>
                      <span className="text-xs font-bold text-[#062863] tabular-nums">
                        {preview.q2.cancelledLessonsCount}{' '}
                        {isEn ? 'to cancel' : preview.q2.cancelledLessonsCount === 1 ? 'será cancelada' : 'serão canceladas'}
                      </span>
                    </div>

                    {preview.q2.cancelledLessonsCount > 0 ? (
                      <div className="space-y-2">
                        <p className="text-xs text-slate-700 leading-relaxed tabular-nums">
                          {isEn
                            ? `${preview.q2.cancelledLessonsCount} unstarted future lesson(s) will be cancelled with full credit restoration (${preview.q2.refundedCreditsCount} credit(s) refunded${
                                preview.q2.cancelledTrialLessonsCount > 0
                                  ? `, ${preview.q2.cancelledTrialLessonsCount} trial session(s)`
                                  : ''
                              }).`
                            : `${preview.q2.cancelledLessonsCount} aula(s) futura(s) não iniciada(s) será(ão) cancelada(s) com estorno integral (${preview.q2.refundedCreditsCount} crédito(s) devolvido(s)${
                                preview.q2.cancelledTrialLessonsCount > 0
                                  ? `, ${preview.q2.cancelledTrialLessonsCount} aula(s) experimental(is)`
                                  : ''
                              }).`}
                        </p>
                        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-slate-50/70 max-h-36 overflow-y-auto">
                          {preview.q2.cancelledLessons.map((les) => (
                            <li key={les.id} className="px-3 py-2 text-xs flex items-center justify-between gap-2">
                              <span className="font-semibold text-[#000035]">
                                {formatLessonDateTime(les.startDateTime, isEn, timeZone)}
                              </span>
                              <span className="text-[11px] font-medium text-[#062863] shrink-0">
                                {les.isTrialLesson
                                  ? isEn
                                    ? 'Trial · Free'
                                    : 'Experimental · Sem crédito'
                                  : les.creditOrigin === 'courtesy'
                                  ? isEn
                                    ? 'Refund to courtesy lot'
                                    : 'Estorno integral (cortesia)'
                                  : isEn
                                  ? 'Full refund to paid lot'
                                  : 'Estorno integral ao lote'}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : (
                      <p className="text-xs text-slate-600">
                        {isEn
                          ? 'No unstarted future lessons will be cancelled.'
                          : 'Nenhuma aula futura não iniciada precisará ser cancelada.'}
                      </p>
                    )}

                    {preview.q2.lockedStartedLessonsCount > 0 && (
                      <p className="text-[11px] text-slate-600 flex items-center gap-1.5 pt-1">
                        <Clock className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                        <span>
                          {isEn
                            ? `${preview.q2.lockedStartedLessonsCount} already started lesson(s) remain preserved with the previous mentor.`
                            : `${preview.q2.lockedStartedLessonsCount} aula(s) já iniciada(s) permanece(m) preservada(s) no histórico com o tutor anterior.`}
                        </span>
                      </p>
                    )}
                  </div>

                  {/* Credit Conversion Breakdown */}
                  <div className="rounded-2xl border border-[#607EC9]/30 p-4 space-y-3 bg-white">
                    <h4 className="font-black text-xs uppercase tracking-wider text-[#000035] flex items-center gap-1.5">
                      <Coins className="w-4 h-4 text-[#1C4C96]" />
                      <span>
                        {isEn ? 'Credits & Residual Financial Summary' : 'Novos Créditos, Cortesias & Saldo Residual'}
                      </span>
                    </h4>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 tabular-nums">
                      <div className="p-3 rounded-xl bg-blue-50/70 border border-[#9AB4FF]/50">
                        <span className="text-[11px] font-bold text-[#062863] block">
                          {isEn ? 'New Paid Credits' : 'Novos Créditos Pagos'}
                        </span>
                        <span className="text-xl font-black text-[#000035] mt-0.5 block">
                          {preview.balances.convertedPaidLessonsCount}
                        </span>
                        <span className="text-[11px] text-[#062863]">
                          {isEn
                            ? `From ${formatBrlFromCents(preview.balances.budgetBrlCents)} budget`
                            : `Orçamento: ${formatBrlFromCents(preview.balances.budgetBrlCents)}`}
                        </span>
                      </div>

                      <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                        <span className="text-[11px] font-bold text-[#062863] flex items-center gap-1">
                          <Gift className="w-3.5 h-3.5 text-[#1C4C96]" />
                          <span>{isEn ? 'Courtesy Credits (1:1)' : 'Cortesias Transferidas (1:1)'}</span>
                        </span>
                        <span className="text-xl font-black text-[#000035] mt-0.5 block">
                          {preview.balances.courtesyTransferredLessonsCount}
                        </span>
                        <span className="text-[11px] text-slate-600">
                          {isEn ? 'Financial value: R$ 0.00' : 'Valor financeiro: R$ 0,00'}
                        </span>
                      </div>

                      <div className="p-3 rounded-xl bg-[#000035] text-white border border-[#1C4C96]">
                        <span className="text-[11px] font-bold text-[#9AB4FF] block">
                          {isEn ? 'Residual BRL Balance' : 'Saldo Residual (R$)'}
                        </span>
                        <span className="text-xl font-black text-white mt-0.5 block">
                          {formatBrlFromCents(preview.balances.residualBrlCentsAfter)}
                        </span>
                        <span className="text-[11px] text-[#9AB4FF]">
                          {preview.balances.residualBrlCentsBefore > 0
                            ? isEn
                              ? `${formatBrlFromCents(preview.balances.residualBrlCentsBefore)} prev + ${formatBrlFromCents(preview.balances.switchResidualBrlCents)} new`
                              : `${formatBrlFromCents(preview.balances.residualBrlCentsBefore)} ant. + ${formatBrlFromCents(preview.balances.switchResidualBrlCents)} novo`
                            : isEn
                            ? `Generated: ${formatBrlFromCents(preview.balances.switchResidualBrlCents)}`
                            : `Gerado na troca: ${formatBrlFromCents(preview.balances.switchResidualBrlCents)}`}
                        </span>
                      </div>
                    </div>

                    {/* Package Composition */}
                    {preview.packageComposition.length > 0 && (
                      <div className="pt-2 border-t border-slate-100 space-y-1.5">
                        <span className="text-[11px] font-bold text-[#062863] block">
                          {isEn
                            ? 'Optimal Package Composition Applied Automatically:'
                            : 'Composição Automática dos Novos Créditos Pagos:'}
                        </span>
                        <div className="space-y-1">
                          {preview.packageComposition.map((line, idx) => (
                            <div
                              key={`${line.packageSize}-${idx}`}
                              className="flex items-center justify-between text-xs py-1.5 px-3 rounded-lg bg-slate-50 border border-slate-200 tabular-nums"
                            >
                              <span className="font-semibold text-[#000035]">
                                {line.quantity}×{' '}
                                {isEn
                                  ? line.packageSize === 1
                                    ? 'Single Lesson (1)'
                                    : `${line.packageSize}-Lesson Package`
                                  : line.packageSize === 1
                                  ? 'Aula Avulsa (1)'
                                  : `Pacote ${line.packageSize} Aulas`}
                                {line.discountPercent > 0 ? ` (${line.discountPercent}% OFF)` : ''}
                              </span>
                              <span className="font-bold text-[#062863]">
                                {line.lessonsSubtotal} {isEn ? 'lessons' : 'aulas'} ·{' '}
                                {formatBrlFromCents(line.totalPriceBrlCents)}
                              </span>
                            </div>
                          ))}
                        </div>
                        <div className="flex items-center justify-between text-[11px] text-slate-600 pt-1 tabular-nums">
                          <span>
                            {isEn ? 'Converted total' : 'Total alocado nos créditos'}:{' '}
                            <strong className="text-[#000035]">
                              {formatBrlFromCents(preview.balances.convertedTotalBrlCents)}
                            </strong>
                          </span>
                          <span>
                            {isEn ? 'Total lessons after switch' : 'Total de aulas após troca'}:{' '}
                            <strong className="text-[#000035]">{preview.balances.availableLessonsAfterSwitch}</strong>
                          </span>
                        </div>
                      </div>
                    )}

                    {/* Zero-credit clean transfer notice */}
                    {preview.status === 'READY' &&
                      preview.balances.availableLessonsAfterRefunds === 0 && (
                        <p className="text-xs text-slate-700 bg-slate-50 rounded-xl p-3 border border-slate-200">
                          {isEn
                            ? 'You currently have 0 paid or courtesy lesson credits. Confirming will update your active Native Friend immediately at no cost.'
                            : 'Você possui 0 créditos de aula pendentes no momento. Ao confirmar, seu vínculo de Amigo Nativo será atualizado imediatamente sem custos.'}
                        </p>
                      )}
                  </div>

                  {/* Explicit Student Confirmation Checkbox */}
                  {canRenderReadyPreview && (
                    <label className="flex items-start gap-2.5 p-3.5 rounded-2xl bg-slate-50 border border-slate-300 cursor-pointer hover:border-[#1C4C96] transition">
                      <input
                        type="checkbox"
                        checked={isConfirmed}
                        disabled={isSubmitting || Boolean(submitError?.requiresPreviewRefresh)}
                        onChange={(e) => setIsConfirmed(e.target.checked)}
                        className="mt-0.5 w-4 h-4 rounded border-slate-400 text-[#1C4C96] focus:ring-[#1C4C96]"
                      />
                      <span className="text-xs text-[#000035] leading-relaxed font-medium">
                        {isEn
                          ? `I confirm switching my Native Friend to ${preview.targetTeacher.name} under the exact preview terms above (Q2 cancellations with full refund, ${preview.balances.convertedPaidLessonsCount} paid credit(s), ${preview.balances.courtesyTransferredLessonsCount} courtesy credit(s), and ${formatBrlFromCents(preview.balances.residualBrlCentsAfter)} residual BRL balance).`
                          : `Confirmo a troca do meu Amigo Nativo para ${preview.targetTeacher.name} nas condições exatas desta prévia (cancelamentos Q2 com estorno integral, ${preview.balances.convertedPaidLessonsCount} crédito(s) pago(s), ${preview.balances.courtesyTransferredLessonsCount} cortesia(s) e ${formatBrlFromCents(preview.balances.residualBrlCentsAfter)} de saldo residual).`}
                      </span>
                    </label>
                  )}

                  {/* Footer CTA Bar */}
                  <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2.5 pt-1">
                    <button
                      type="button"
                      disabled={isSubmitting}
                      onClick={onClose}
                      className="px-4 py-2.5 rounded-xl bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-bold transition cursor-pointer disabled:opacity-50 whitespace-nowrap shrink-0"
                    >
                      {isEn ? 'Cancel' : 'Cancelar'}
                    </button>

                    <button
                      type="button"
                      disabled={!canClickConfirm}
                      onClick={() => void handleConfirmSwitch()}
                      data-testid="confirm-switch-button"
                      className={`px-5 py-2.5 rounded-xl text-xs font-black transition flex items-center justify-center gap-2 whitespace-nowrap shrink-0 ${
                        canClickConfirm
                          ? 'bg-[#1C4C96] hover:bg-[#062863] text-white cursor-pointer shadow-xs'
                          : 'bg-slate-200 text-slate-500 cursor-not-allowed'
                      }`}
                    >
                      {isSubmitting ? (
                        <>
                          <RefreshCw className="w-4 h-4 animate-spin" />
                          <span>{isEn ? 'Confirming Switch...' : 'Confirmando Troca...'}</span>
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="w-4 h-4" />
                          <span>{isEn ? 'Confirm Native Friend Switch' : 'Confirmar Troca de Amigo Nativo'}</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
