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
} from 'lucide-react';
import { NativeFriendTutor, Language } from '../types';
import {
  validateAdminCommissionPercent,
  hasValidPersistedCommission,
  ALLOWED_COMMISSION_MODEL,
} from '../utils/tutorCommission';

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
  const inFlightIdsRef = useRef<Set<string>>(new Set());

  // When modal opens, default to pending if any are waiting for review, otherwise show all
  useEffect(() => {
    if (isOpen) {
      setFilter(pendingCount > 0 ? 'pending' : 'all');
      setCommissionErrors({});
      setActionError(null);
    }
  }, [isOpen]);

  // Support ESC key to easily dismiss modal
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

  const isEn = currentLanguage === 'en';

  const getTutorKey = (tutor: NativeFriendTutor) =>
    tutor.uid || tutor.authUid || tutor.id || tutor.email;

  const getRawBaseUsd = (tutor: NativeFriendTutor): number | null => {
    const raw =
      typeof tutor.pricePerSessionUsd === 'number'
        ? tutor.pricePerSessionUsd
        : typeof (tutor as any).hourlyRateUsd === 'number'
        ? (tutor as any).hourlyRateUsd
        : Number(tutor.pricePerSessionUsd ?? (tutor as any).hourlyRateUsd);
    return Number.isFinite(raw) && raw >= 0 ? raw : null;
  };

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
                onClick={onRefresh}
                className="px-3 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-[#9AB4FF] hover:text-white text-xs font-bold transition flex items-center gap-1.5 cursor-pointer"
                title={isEn ? 'Refresh list' : 'Atualizar lista'}
              >
                <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-[#F4CA54]' : ''}`} />
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
        <div className="flex items-center gap-2 p-4 bg-slate-50 border-b border-slate-200 shrink-0 overflow-x-auto">
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
              const baseUsd = getRawBaseUsd(tutor);
              const hasCommission = hasValidPersistedCommission(tutor);
              const rawInput = commissionInputs[tutorKey] ?? '';
              const inputValidation = validateAdminCommissionPercent(rawInput);
              const inlineError = commissionErrors[tutorKey];
              const isBusy = processingId === tutor.id;
              const historyList = Array.isArray(tutor.commissionHistory) ? tutor.commissionHistory : [];
              const isHistoryOpen = expandedHistoryId === tutorKey;

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
                          {tutor.email}
                        </span>
                        <span className="flex items-center gap-1">
                          <MapPin className="w-3.5 h-3.5 text-slate-400" />
                          {tutor.country || (tutor as any).nativeCountry || (tutor as any).location || 'United States'}
                          {tutor.accent ? ` • ${tutor.accent}` : ''}
                        </span>
                        <span className="flex items-center gap-1 font-bold text-slate-800 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-lg">
                          <DollarSign className="w-3.5 h-3.5 text-emerald-600" />
                          {baseUsd !== null
                            ? `${isEn ? 'Teacher base price:' : 'Preço-base USD:'} $${baseUsd.toFixed(2)} USD / 50 min`
                            : (isEn ? 'Base USD price not informed' : 'Preço-base USD não informado')}
                        </span>
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
                        <p className="text-xs text-slate-600 bg-slate-50 p-3 rounded-xl border border-slate-100 mt-2 leading-relaxed">
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
                        {tutor.meetUrl && (
                          <a
                            href={tutor.meetUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1.5 text-xs text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 px-2.5 py-1 rounded-lg font-bold transition"
                          >
                            <Video className="w-3.5 h-3.5 text-emerald-600" />
                            <span>Google Meet: {tutor.meetUrl}</span>
                            <ExternalLink className="w-3 h-3 text-emerald-500" />
                          </a>
                        )}

                        {tutor.videoIntroUrl && (
                          <a
                            href={tutor.videoIntroUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1.5 text-xs text-[#1C4C96] hover:underline font-bold"
                          >
                            <Video className="w-3.5 h-3.5" />
                            <span>{isEn ? 'Watch presentation video' : 'Ver vídeo de apresentação'}</span>
                            <ExternalLink className="w-3 h-3" />
                          </a>
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
                  <div className="flex sm:flex-col gap-2 w-full sm:w-auto shrink-0">
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
    </div>
  );
};

