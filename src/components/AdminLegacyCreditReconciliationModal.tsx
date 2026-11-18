import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  X,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  Plus,
  Trash2,
  History,
  FileCheck2,
  RefreshCw,
  Receipt,
  Gift,
  Lock,
} from 'lucide-react';
import { getAdminAccessToken } from '../utils/auth';
import type {
  CreditReconciliationAuditRecord,
  HistoricalFinancialEvidenceSummary,
  Language,
  LegacyReconciliationAllocationInput,
  PendingLegacyStudentSummary,
} from '../types';

export interface AdminTeacherOption {
  uid: string;
  name: string;
  email: string;
  country?: string | null;
}

export interface AdminLegacyCreditReconciliationModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentLanguage?: Language;
  onReconciliationSuccess?: () => void;
  initialStudents?: PendingLegacyStudentSummary[];
  initialTeachers?: AdminTeacherOption[];
  initialAudits?: CreditReconciliationAuditRecord[];
}

interface AllocationDraftRow {
  rowId: string;
  origin: 'paid' | 'courtesy';
  lessonsCount: number;
  sourceTransactionId: string;
  teacherUid: string;
}

type ModalLang = 'pt' | 'en';

interface ModalCopy {
  title: string;
  subtitle: string;
  closeAria: string;
  tabReconcile: string;
  tabAudits: string;
  refresh: string;
  pendingStudentsTitle: string;
  searchPlaceholder: string;
  noPendingStudents: string;
  legacyPendingBadge: (n: number) => string;
  availableBalanceLabel: string;
  divergenceWarningTitle: string;
  divergenceBlockedAction: string;
  hydrationNotice: string;
  evidencesTitle: string;
  noEvidences: string;
  eligibleBadge: string;
  ineligibleBadge: string;
  capacityLabel: (rem: number, total: number) => string;
  classificationTitle: string;
  addPaidRow: string;
  addCourtesyRow: string;
  originPaid: string;
  originCourtesy: string;
  lessonsLabel: string;
  evidenceSelectLabel: string;
  selectEvidencePlaceholder: string;
  teacherConfirmLabel: string;
  selectTeacherPlaceholder: string;
  courtesyZeroNotice: string;
  summaryBefore: string;
  summaryReconciledNow: string;
  summaryRemainingLegacy: string;
  summaryPreservedAvailable: string;
  justificationLabel: string;
  justificationPlaceholder: string;
  confirmLabel: string;
  submitBtn: string;
  submittingBtn: string;
  idempotentReplayBanner: string;
  successBanner: string;
  authError: string;
  forbiddenError: string;
  loadError: string;
  auditsEmpty: string;
  auditSourceLabel: string;
  auditJustificationLabel: string;
  auditActorLabel: string;
  auditPreservedLabel: string;
}

const COPY: Record<ModalLang, ModalCopy> = {
  pt: {
    title: 'Conciliação Administrativa de Créditos Legados',
    subtitle: 'NF.SWITCH.2B · Classificação explícita, auditável e imutável sem alterar o saldo disponível ou inflar métricas ADM.OPS.',
    closeAria: 'Fechar modal de conciliação',
    tabReconcile: 'Conciliar Lotes Legados',
    tabAudits: 'Histórico Imutável de Auditoria',
    refresh: 'Atualizar',
    pendingStudentsTitle: 'Alunos com Lotes legacy_unreconciled',
    searchPlaceholder: 'Buscar por nome ou e-mail...',
    noPendingStudents: 'Nenhum aluno possui créditos legados pendentes de conciliação no Firestore (default).',
    legacyPendingBadge: (n) => `${n} legado(s) pendente(s)`,
    availableBalanceLabel: 'Saldo availableLessons (preservado)',
    divergenceWarningTitle: 'CREDIT_LEDGER_DIVERGENCE detectada',
    divergenceBlockedAction: 'Divergência entre availableLessons e a soma dos lotes. Conciliação bloqueada sem autocorreção silenciosa.',
    hydrationNotice: 'Aluno pré-2A aguardando hidratação inicial única: a primeira conciliação materializará o lote legado atomicamente.',
    evidencesTitle: 'Evidências Financeiras Históricas Disponíveis',
    noEvidences: 'Nenhuma transação financeira encontrada para este aluno. Caso aplicável, utilize classificação explícita como Cortesia (sem receita).',
    eligibleBadge: 'Elegível p/ Paid',
    ineligibleBadge: 'Inelegível p/ Paid',
    capacityLabel: (rem, total) => `${rem} de ${total} aula(s) disponíveis p/ lastro`,
    classificationTitle: 'Plano de Classificação Explícita',
    addPaidRow: '+ Parcela Paga (com evidência)',
    addCourtesyRow: '+ Parcela Cortesia (R$ 0,00)',
    originPaid: 'Pago (Paid)',
    originCourtesy: 'Cortesia (Courtesy)',
    lessonsLabel: 'Qtd. Aulas',
    evidenceSelectLabel: 'Transação Histórica Comprovada',
    selectEvidencePlaceholder: 'Selecione uma transação elegível...',
    teacherConfirmLabel: 'Native Friend Confirmado (evidência)',
    selectTeacherPlaceholder: 'Selecione o Native Friend...',
    courtesyZeroNotice: 'Classificação Cortesia: gera R$ 0,00 de receita, obrigação de repasse zero e não soma em faturamento.',
    summaryBefore: 'Legado atual',
    summaryReconciledNow: 'Conciliado agora',
    summaryRemainingLegacy: 'Restante legacy_unreconciled',
    summaryPreservedAvailable: 'availableLessons após (inalterado)',
    justificationLabel: 'Justificativa Administrativa Obrigatória',
    justificationPlaceholder: 'Descreva a evidência verificada ou o motivo administrativo da classificação...',
    confirmLabel: 'Confirmo que a classificação acima reflete estritamente as evidências verificadas, preservando availableLessons sem gerar receita artificial.',
    submitBtn: 'Executar Conciliação Auditada',
    submittingBtn: 'Processando Transação...',
    idempotentReplayBanner: 'Requisição idempotente já processada anteriormente (nenhum crédito duplicado).',
    successBanner: 'Conciliação executada com sucesso em transação atômica e registrada na auditoria imutável.',
    authError: 'Sessão administrativa não autenticada.',
    forbiddenError: 'Acesso negado: somente administradores autorizados podem executar conciliações.',
    loadError: 'Erro ao carregar créditos legados pendentes.',
    auditsEmpty: 'Nenhuma conciliação administrativa registrada até o momento.',
    auditSourceLabel: 'Lote de origem',
    auditJustificationLabel: 'Justificativa',
    auditActorLabel: 'Executado por',
    auditPreservedLabel: 'Saldo preservado',
  },
  en: {
    title: 'Administrative Legacy Credit Reconciliation',
    subtitle: 'NF.SWITCH.2B · Explicit, auditable, immutable classification without changing availableLessons or inflating ADM.OPS metrics.',
    closeAria: 'Close reconciliation modal',
    tabReconcile: 'Reconcile Legacy Lots',
    tabAudits: 'Immutable Audit History',
    refresh: 'Refresh',
    pendingStudentsTitle: 'Students with legacy_unreconciled Lots',
    searchPlaceholder: 'Search by name or email...',
    noPendingStudents: 'No students have pending legacy credits in Firestore (default).',
    legacyPendingBadge: (n) => `${n} legacy pending`,
    availableBalanceLabel: 'availableLessons balance (preserved)',
    divergenceWarningTitle: 'CREDIT_LEDGER_DIVERGENCE detected',
    divergenceBlockedAction: 'Mismatch between availableLessons and lot sum. Reconciliation blocked without silent self-correction.',
    hydrationNotice: 'Pre-2A student awaiting single-time hydration: the first reconciliation will materialize the legacy lot atomically.',
    evidencesTitle: 'Available Historical Financial Evidences',
    noEvidences: 'No financial transactions found for this student. If applicable, classify explicitly as Courtesy (non-revenue).',
    eligibleBadge: 'Eligible for Paid',
    ineligibleBadge: 'Ineligible for Paid',
    capacityLabel: (rem, total) => `${rem} of ${total} lesson(s) available to back`,
    classificationTitle: 'Explicit Classification Plan',
    addPaidRow: '+ Paid Portion (with evidence)',
    addCourtesyRow: '+ Courtesy Portion ($0.00)',
    originPaid: 'Paid',
    originCourtesy: 'Courtesy',
    lessonsLabel: 'Lessons',
    evidenceSelectLabel: 'Verified Historical Transaction',
    selectEvidencePlaceholder: 'Select an eligible transaction...',
    teacherConfirmLabel: 'Confirmed Native Friend (from evidence)',
    selectTeacherPlaceholder: 'Select Native Friend...',
    courtesyZeroNotice: 'Courtesy classification: generates R$ 0.00 revenue, zero payout obligation, and does not count as revenue.',
    summaryBefore: 'Current legacy',
    summaryReconciledNow: 'Reconciled now',
    summaryRemainingLegacy: 'Remaining legacy_unreconciled',
    summaryPreservedAvailable: 'availableLessons after (unchanged)',
    justificationLabel: 'Mandatory Administrative Justification',
    justificationPlaceholder: 'Describe the verified evidence or administrative reason for this classification...',
    confirmLabel: 'I confirm that the classification above strictly reflects verified evidence while preserving availableLessons and without artificial revenue.',
    submitBtn: 'Execute Audited Reconciliation',
    submittingBtn: 'Executing Transaction...',
    idempotentReplayBanner: 'Idempotent request already processed previously (no duplicate credits created).',
    successBanner: 'Reconciliation committed atomically and recorded in the immutable audit ledger.',
    authError: 'Administrator session is not authenticated.',
    forbiddenError: 'Access denied: only authorized administrators may execute reconciliations.',
    loadError: 'Failed to load pending legacy credits.',
    auditsEmpty: 'No administrative reconciliations recorded yet.',
    auditSourceLabel: 'Source lot',
    auditJustificationLabel: 'Justification',
    auditActorLabel: 'Performed by',
    auditPreservedLabel: 'Balance preserved',
  },
};

function formatBrl(val: number | null | undefined, lang: ModalLang): string {
  if (typeof val !== 'number' || !Number.isFinite(val)) return '—';
  return val.toLocaleString(lang === 'pt' ? 'pt-BR' : 'en-US', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function createIdempotencyKey(studentUid: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `recon_${studentUid}_${Date.now()}_${rand}`;
}

export const AdminLegacyCreditReconciliationModal: React.FC<
  AdminLegacyCreditReconciliationModalProps
> = ({
  isOpen,
  onClose,
  currentLanguage = 'pt',
  onReconciliationSuccess,
  initialStudents,
  initialTeachers,
  initialAudits,
}) => {
  const lang: ModalLang = currentLanguage === 'pt' ? 'pt' : 'en';
  const copy = COPY[lang];

  const [activeTab, setActiveTab] = useState<'reconcile' | 'audits'>('reconcile');
  const [students, setStudents] = useState<PendingLegacyStudentSummary[]>(initialStudents || []);
  const [teachers, setTeachers] = useState<AdminTeacherOption[]>(initialTeachers || []);
  const [audits, setAudits] = useState<CreditReconciliationAuditRecord[]>(initialAudits || []);
  const [loading, setLoading] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [selectedStudentUid, setSelectedStudentUid] = useState<string>(
    initialStudents?.[0]?.studentUid || ''
  );

  const [rows, setRows] = useState<AllocationDraftRow[]>([
    {
      rowId: 'row-1',
      origin: 'courtesy',
      lessonsCount: 1,
      sourceTransactionId: '',
      teacherUid: '',
    },
  ]);
  const [justification, setJustification] = useState<string>('');
  const [confirmed, setConfirmed] = useState<boolean>(false);
  const [draftIdempotencyKey, setDraftIdempotencyKey] = useState<string>('');

  const loadData = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const token = await getAdminAccessToken();
      if (!token) {
        setErrorMsg(copy.authError);
        setLoading(false);
        return;
      }

      const [pendingRes, auditsRes] = await Promise.all([
        fetch('/api/admin/credit-reconciliation/pending', {
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        }),
        fetch('/api/admin/credit-reconciliation/audits?limit=50', {
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        }),
      ]);

      const pendingJson = await pendingRes.json().catch(() => null);
      const auditsJson = await auditsRes.json().catch(() => null);

      if (!pendingRes.ok || !pendingJson?.success) {
        setErrorMsg(
          pendingJson?.message ||
            (pendingRes.status === 403 ? copy.forbiddenError : copy.loadError)
        );
        setLoading(false);
        return;
      }

      const nextStudents: PendingLegacyStudentSummary[] = pendingJson.students || [];
      setStudents(nextStudents);
      setTeachers(pendingJson.teachers || []);
      if (auditsRes.ok && auditsJson?.success) {
        setAudits(auditsJson.audits || []);
      }

      setSelectedStudentUid((prev) => {
        if (prev && nextStudents.some((s) => s.studentUid === prev)) return prev;
        return nextStudents[0]?.studentUid || '';
      });
    } catch (err: any) {
      setErrorMsg(err?.message || copy.loadError);
    } finally {
      setLoading(false);
    }
  }, [copy.authError, copy.forbiddenError, copy.loadError]);

  useEffect(() => {
    if (!isOpen) return;
    if (initialStudents === undefined) {
      loadData();
    }
  }, [isOpen, initialStudents, loadData]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  const selectedStudent = useMemo(
    () => students.find((s) => s.studentUid === selectedStudentUid) || null,
    [students, selectedStudentUid]
  );

  // Reset draft safely when switching student
  useEffect(() => {
    if (!selectedStudent) return;
    const firstEligible = selectedStudent.evidences.find((e) => e.isEligibleForPaidReconciliation);
    const defaultCount = Math.max(1, Math.min(selectedStudent.legacyRemainingLessons, firstEligible?.remainingBackableLessons || selectedStudent.legacyRemainingLessons));
    setRows([
      firstEligible
        ? {
            rowId: `row-${Date.now()}`,
            origin: 'paid',
            lessonsCount: defaultCount,
            sourceTransactionId: firstEligible.transactionId,
            teacherUid: firstEligible.teacherUid || '',
          }
        : {
            rowId: `row-${Date.now()}`,
            origin: 'courtesy',
            lessonsCount: Math.max(1, selectedStudent.legacyRemainingLessons),
            sourceTransactionId: '',
            teacherUid: '',
          },
    ]);
    setJustification('');
    setConfirmed(false);
    setErrorMsg(null);
    setSuccessMsg(null);
    setDraftIdempotencyKey(createIdempotencyKey(selectedStudent.studentUid));
  }, [selectedStudent?.studentUid]);

  const filteredStudents = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return students;
    return students.filter(
      (s) =>
        s.studentName.toLowerCase().includes(q) ||
        s.studentEmail.toLowerCase().includes(q) ||
        s.studentUid.toLowerCase().includes(q)
    );
  }, [students, searchTerm]);

  const totalAllocatedInDraft = useMemo(
    () => rows.reduce((sum, r) => sum + (Number.isFinite(r.lessonsCount) && r.lessonsCount > 0 ? Math.floor(r.lessonsCount) : 0), 0),
    [rows]
  );

  const mutateDraft = (updater: (prev: AllocationDraftRow[]) => AllocationDraftRow[]) => {
    setRows(updater);
    setConfirmed(false);
    setSuccessMsg(null);
    setErrorMsg(null);
    if (selectedStudent) {
      setDraftIdempotencyKey(createIdempotencyKey(selectedStudent.studentUid));
    }
  };

  const handleSelectEvidenceForRow = (rowId: string, txId: string) => {
    const ev = selectedStudent?.evidences.find((e) => e.transactionId === txId);
    mutateDraft((prev) =>
      prev.map((r) =>
        r.rowId === rowId
          ? {
              ...r,
              sourceTransactionId: txId,
              teacherUid: ev?.teacherUid || r.teacherUid || '',
            }
          : r
      )
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedStudent || submitting || selectedStudent.hasLedgerDivergence) return;

    setSubmitting(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const token = await getAdminAccessToken();
      if (!token) {
        setErrorMsg(copy.authError);
        setSubmitting(false);
        return;
      }

      const idempKey = draftIdempotencyKey || createIdempotencyKey(selectedStudent.studentUid);
      if (!draftIdempotencyKey) setDraftIdempotencyKey(idempKey);

      const allocations: LegacyReconciliationAllocationInput[] = rows.map((r) =>
        r.origin === 'paid'
          ? {
              origin: 'paid',
              lessonsCount: Math.floor(Number(r.lessonsCount || 0)),
              sourceTransactionId: r.sourceTransactionId.trim(),
              teacherUid: r.teacherUid.trim(),
            }
          : {
              origin: 'courtesy',
              lessonsCount: Math.floor(Number(r.lessonsCount || 0)),
            }
      );

      const res = await fetch('/api/admin/credit-reconciliation/reconcile', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          studentUid: selectedStudent.studentUid,
          idempotencyKey: idempKey,
          justification: justification.trim(),
          allocations,
          expectedLegacyRemainingLessons: selectedStudent.legacyRemainingLessons,
          ...(selectedStudent.legacyLotUpdatedAt
            ? { expectedLegacyLotUpdatedAt: selectedStudent.legacyLotUpdatedAt }
            : {}),
        }),
      });

      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        setErrorMsg(json?.message || copy.loadError);
        setSubmitting(false);
        return;
      }

      setSuccessMsg(json.isIdempotent ? copy.idempotentReplayBanner : copy.successBanner);
      setConfirmed(false);
      await loadData();
      if (onReconciliationSuccess) {
        onReconciliationSuccess();
      }
    } catch (err: any) {
      setErrorMsg(err?.message || copy.loadError);
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  const eligibleEvidences: HistoricalFinancialEvidenceSummary[] =
    selectedStudent?.evidences.filter((e) => e.isEligibleForPaidReconciliation) || [];
  const legacyRemaining = selectedStudent?.legacyRemainingLessons || 0;
  const remainingAfterDraft = legacyRemaining - totalAllocatedInDraft;
  const canSubmit =
    Boolean(selectedStudent) &&
    !selectedStudent?.hasLedgerDivergence &&
    !submitting &&
    confirmed &&
    justification.trim().length >= 3 &&
    totalAllocatedInDraft > 0 &&
    totalAllocatedInDraft <= legacyRemaining &&
    rows.every((r) =>
      r.origin === 'courtesy'
        ? Number.isInteger(r.lessonsCount) && r.lessonsCount > 0
        : Number.isInteger(r.lessonsCount) &&
          r.lessonsCount > 0 &&
          r.sourceTransactionId.trim() !== '' &&
          r.teacherUid.trim() !== ''
    );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-3 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={copy.title}
      data-testid="legacy-reconciliation-modal"
    >
      <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl w-full max-w-6xl max-h-[92vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 sm:px-6 border-b border-slate-200 bg-[#000035] text-white flex items-start justify-between gap-4">
          <div className="flex items-start gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center shrink-0 mt-0.5">
              <ShieldCheck className="w-5 h-5 text-[#9AB4FF]" />
            </div>
            <div className="min-w-0">
              <h3 className="text-base sm:text-lg font-extrabold tracking-tight">
                {copy.title}
              </h3>
              <p className="text-xs text-slate-300 mt-0.5">{copy.subtitle}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={loadData}
              disabled={loading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-xs font-bold text-white transition cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>{copy.refresh}</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label={copy.closeAria}
              className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white transition cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Subnav Tabs */}
        <div className="px-5 sm:px-6 pt-3 border-b border-slate-200 bg-[#FAFCFF] flex items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveTab('reconcile')}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-t-xl text-xs font-bold border-b-2 transition cursor-pointer ${
              activeTab === 'reconcile'
                ? 'border-[#000035] text-[#000035] bg-white'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            <FileCheck2 className="w-3.5 h-3.5" />
            <span>{copy.tabReconcile}</span>
            <span className="px-1.5 py-0.5 rounded-md bg-slate-200/80 text-[10px] font-mono">
              {students.length}
            </span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('audits')}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-t-xl text-xs font-bold border-b-2 transition cursor-pointer ${
              activeTab === 'audits'
                ? 'border-[#000035] text-[#000035] bg-white'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            <History className="w-3.5 h-3.5" />
            <span>{copy.tabAudits}</span>
            <span className="px-1.5 py-0.5 rounded-md bg-slate-200/80 text-[10px] font-mono">
              {audits.length}
            </span>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-6">
          {errorMsg && (
            <div
              data-testid="recon-error-banner"
              className="mb-4 p-3.5 rounded-2xl border border-rose-200 bg-rose-50 text-rose-900 flex items-start gap-2.5 text-xs font-semibold"
            >
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          {successMsg && (
            <div
              data-testid="recon-success-banner"
              className="mb-4 p-3.5 rounded-2xl border border-emerald-200 bg-emerald-50 text-emerald-900 flex items-start gap-2.5 text-xs font-semibold"
            >
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <span>{successMsg}</span>
            </div>
          )}

          {activeTab === 'audits' ? (
            <div className="space-y-3" data-testid="recon-audits-list">
              {audits.length === 0 ? (
                <div className="p-8 text-center rounded-2xl border border-slate-200 bg-slate-50 text-xs text-slate-500">
                  {copy.auditsEmpty}
                </div>
              ) : (
                audits.map((audit) => (
                  <div
                    key={audit.id}
                    className="p-4 rounded-2xl border border-slate-200 bg-white space-y-2 text-xs"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Lock className="w-3.5 h-3.5 text-slate-500" />
                        <span className="font-bold text-[#000035]">
                          {audit.studentName} ({audit.studentEmail || audit.studentUid})
                        </span>
                      </div>
                      <span className="font-mono text-[11px] text-slate-500">
                        {new Date(audit.createdAt).toLocaleString(lang === 'pt' ? 'pt-BR' : 'en-US')}
                      </span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px] text-slate-600 bg-slate-50 p-2.5 rounded-xl">
                      <div>
                        <span className="font-semibold text-slate-700">{copy.auditSourceLabel}:</span>{' '}
                        <span className="font-mono">{audit.sourceLotId}</span> ({audit.legacyBefore.remainingLessons} → {audit.legacyAfter.remainingLessons})
                      </div>
                      <div>
                        <span className="font-semibold text-slate-700">{copy.auditPreservedLabel}:</span>{' '}
                        <span className="font-mono font-bold text-[#000035]">
                          {audit.availableLessonsBefore} === {audit.availableLessonsAfter}
                        </span>
                      </div>
                      <div>
                        <span className="font-semibold text-slate-700">{copy.auditActorLabel}:</span>{' '}
                        {audit.performedByEmail || audit.performedByUid}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {audit.allocations.map((al) => (
                        <span
                          key={al.targetLotId}
                          className={`px-2.5 py-1 rounded-lg border text-[11px] font-semibold ${
                            al.origin === 'paid'
                              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                              : 'bg-sky-50 border-sky-200 text-sky-800'
                          }`}
                        >
                          {al.origin.toUpperCase()} · {al.lessonsCount} aula(s)
                          {al.origin === 'paid' && al.totalPaidBrl !== null
                            ? ` · ${formatBrl(al.totalPaidBrl, lang)} · tx ${al.sourceTransactionId}`
                            : ' · R$ 0,00'}
                        </span>
                      ))}
                    </div>
                    <p className="text-[11px] text-slate-700">
                      <span className="font-semibold">{copy.auditJustificationLabel}:</span>{' '}
                      {audit.justification}
                    </p>
                  </div>
                ))
              )}
            </div>
          ) : students.length === 0 ? (
            <div className="p-10 text-center rounded-2xl border border-slate-200 bg-slate-50 text-sm text-slate-600">
              {copy.noPendingStudents}
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
              {/* Left Column: Pending Students */}
              <div className="lg:col-span-4 space-y-3">
                <div className="text-xs font-extrabold uppercase tracking-wider text-slate-600">
                  {copy.pendingStudentsTitle}
                </div>
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder={copy.searchPlaceholder}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs focus:outline-none focus:ring-2 focus:ring-[#1C4C96]"
                />
                <div className="space-y-2 max-h-[54vh] overflow-y-auto pr-1">
                  {filteredStudents.map((st) => {
                    const active = st.studentUid === selectedStudentUid;
                    return (
                      <button
                        key={st.studentUid}
                        type="button"
                        onClick={() => setSelectedStudentUid(st.studentUid)}
                        className={`w-full text-left p-3.5 rounded-2xl border transition cursor-pointer ${
                          active
                            ? 'border-[#000035] bg-[#F4F7FF] shadow-xs'
                            : 'border-slate-200 bg-white hover:bg-slate-50'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="text-xs font-extrabold text-[#000035] truncate">
                              {st.studentName}
                            </div>
                            <div className="text-[11px] text-slate-500 truncate">
                              {st.studentEmail || st.studentUid}
                            </div>
                          </div>
                          <span className="shrink-0 px-2 py-0.5 rounded-md bg-amber-100 text-amber-900 font-mono font-bold text-[11px]">
                            {copy.legacyPendingBadge(st.legacyRemainingLessons)}
                          </span>
                        </div>
                        <div className="mt-2 flex items-center justify-between text-[11px] text-slate-600 font-mono">
                          <span>avail: {st.availableLessons}</span>
                          <span>
                            evid: {st.evidences.filter((e) => e.isEligibleForPaidReconciliation).length}
                          </span>
                        </div>
                        {st.hasLedgerDivergence && (
                          <div className="mt-1.5 text-[10px] font-bold text-rose-700 flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3" />
                            <span>CREDIT_LEDGER_DIVERGENCE</span>
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Right Column: Selected Student Details & Classification Form */}
              <div className="lg:col-span-8 space-y-5">
                {selectedStudent && (
                  <>
                    {/* Student Balance Summary Card */}
                    <div className="p-4 rounded-2xl border border-slate-200 bg-[#FAFCFF] space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <div className="text-sm font-extrabold text-[#000035]">
                            {selectedStudent.studentName}
                          </div>
                          <div className="text-xs text-slate-500">
                            {selectedStudent.studentEmail} · <span className="font-mono">{selectedStudent.studentUid}</span>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-[10px] font-bold uppercase text-slate-500">
                            {copy.availableBalanceLabel}
                          </div>
                          <div className="text-lg font-extrabold font-mono text-[#000035]">
                            {selectedStudent.availableLessons}
                          </div>
                        </div>
                      </div>

                      {selectedStudent.requiresInitialHydration && (
                        <div className="p-2.5 rounded-xl bg-sky-50 border border-sky-200 text-[11px] text-sky-900 font-medium">
                          {copy.hydrationNotice}
                        </div>
                      )}

                      {selectedStudent.hasLedgerDivergence && (
                        <div className="p-3 rounded-xl bg-rose-50 border border-rose-300 text-xs text-rose-900 space-y-1">
                          <div className="font-extrabold flex items-center gap-1.5">
                            <AlertTriangle className="w-4 h-4 text-rose-600" />
                            <span>{copy.divergenceWarningTitle}</span>
                          </div>
                          <p className="text-[11px]">{selectedStudent.divergenceDetails || copy.divergenceBlockedAction}</p>
                        </div>
                      )}
                    </div>

                    {/* Historical Financial Evidences */}
                    <div className="space-y-2.5">
                      <h4 className="text-xs font-extrabold uppercase tracking-wider text-slate-600 flex items-center gap-1.5">
                        <Receipt className="w-3.5 h-3.5" />
                        <span>{copy.evidencesTitle}</span>
                      </h4>
                      {selectedStudent.evidences.length === 0 ? (
                        <div className="p-4 rounded-2xl border border-dashed border-slate-300 bg-slate-50 text-xs text-slate-600">
                          {copy.noEvidences}
                        </div>
                      ) : (
                        <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                          {selectedStudent.evidences.map((ev) => (
                            <div
                              key={ev.transactionId}
                              className={`p-3 rounded-2xl border text-xs ${
                                ev.isEligibleForPaidReconciliation
                                  ? 'border-emerald-200 bg-emerald-50/40'
                                  : 'border-slate-200 bg-slate-50 opacity-85'
                              }`}
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="font-mono font-bold text-[#000035]">
                                  {ev.transactionId} · {ev.type}
                                </div>
                                <span
                                  className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                                    ev.isEligibleForPaidReconciliation
                                      ? 'bg-emerald-100 text-emerald-800'
                                      : 'bg-slate-200 text-slate-700'
                                  }`}
                                >
                                  {ev.isEligibleForPaidReconciliation ? copy.eligibleBadge : copy.ineligibleBadge}
                                </span>
                              </div>
                              <div className="mt-1.5 grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] text-slate-700">
                                <div>
                                  <span className="font-semibold">Valor:</span> {formatBrl(ev.totalPaidBrl, lang)}
                                </div>
                                <div>
                                  <span className="font-semibold">Aulas:</span> {ev.lessonsCount}
                                </div>
                                <div>
                                  <span className="font-semibold">Native Friend:</span>{' '}
                                  {ev.teacherName || ev.teacherUid || '—'}
                                </div>
                                <div>
                                  <span className="font-semibold">Gateway:</span>{' '}
                                  {ev.gatewayProvider ? `${ev.gatewayProvider} (${ev.gatewayTransactionId || '—'})` : '—'}
                                </div>
                              </div>
                              <div className="mt-1 text-[11px] font-mono text-slate-600">
                                {copy.capacityLabel(ev.remainingBackableLessons, ev.lessonsCount)}
                                {ev.remainingBackableBrl > 0 ? ` · ${formatBrl(ev.remainingBackableBrl, lang)}` : ''}
                              </div>
                              {!ev.isEligibleForPaidReconciliation && ev.ineligibilityReason && (
                                <div className="mt-1 text-[11px] text-rose-700 font-medium">
                                  {ev.ineligibilityReason}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Explicit Classification Form */}
                    <form onSubmit={handleSubmit} className="space-y-4 p-4 rounded-2xl border border-slate-200 bg-white">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h4 className="text-xs font-extrabold uppercase tracking-wider text-[#000035]">
                          {copy.classificationTitle}
                        </h4>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={eligibleEvidences.length === 0 || selectedStudent.hasLedgerDivergence}
                            onClick={() => {
                              const ev = eligibleEvidences[0];
                              mutateDraft((prev) => [
                                ...prev,
                                {
                                  rowId: `row-${Date.now()}-${prev.length}`,
                                  origin: 'paid',
                                  lessonsCount: 1,
                                  sourceTransactionId: ev?.transactionId || '',
                                  teacherUid: ev?.teacherUid || '',
                                },
                              ]);
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-emerald-900 text-[11px] font-bold transition cursor-pointer disabled:opacity-40"
                          >
                            <Plus className="w-3 h-3" />
                            <span>{copy.addPaidRow}</span>
                          </button>
                          <button
                            type="button"
                            disabled={selectedStudent.hasLedgerDivergence}
                            onClick={() =>
                              mutateDraft((prev) => [
                                ...prev,
                                {
                                  rowId: `row-${Date.now()}-${prev.length}`,
                                  origin: 'courtesy',
                                  lessonsCount: 1,
                                  sourceTransactionId: '',
                                  teacherUid: '',
                                },
                              ])
                            }
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl border border-sky-300 bg-sky-50 hover:bg-sky-100 text-sky-900 text-[11px] font-bold transition cursor-pointer disabled:opacity-40"
                          >
                            <Gift className="w-3 h-3" />
                            <span>{copy.addCourtesyRow}</span>
                          </button>
                        </div>
                      </div>

                      <div className="space-y-3">
                        {rows.map((row, idx) => (
                          <div
                            key={row.rowId}
                            className="p-3 rounded-xl border border-slate-200 bg-slate-50/60 space-y-2.5"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex items-center gap-2">
                                <span className="text-[11px] font-mono font-bold text-slate-500">
                                  #{idx + 1}
                                </span>
                                <select
                                  aria-label={`Origin #${idx + 1}`}
                                  value={row.origin}
                                  onChange={(e) => {
                                    const nextOrigin = e.target.value === 'paid' ? 'paid' : 'courtesy';
                                    const firstEv = eligibleEvidences[0];
                                    mutateDraft((prev) =>
                                      prev.map((item) =>
                                        item.rowId === row.rowId
                                          ? {
                                              ...item,
                                              origin: nextOrigin,
                                              sourceTransactionId:
                                                nextOrigin === 'paid' ? firstEv?.transactionId || '' : '',
                                              teacherUid:
                                                nextOrigin === 'paid' ? firstEv?.teacherUid || '' : '',
                                            }
                                          : item
                                      )
                                    );
                                  }}
                                  className="h-8 px-2.5 rounded-lg border border-slate-300 bg-white text-xs font-bold text-[#000035]"
                                >
                                  <option value="courtesy">{copy.originCourtesy}</option>
                                  <option value="paid" disabled={eligibleEvidences.length === 0}>
                                    {copy.originPaid}
                                  </option>
                                </select>
                              </div>

                              <div className="flex items-center gap-2">
                                <label className="text-[11px] font-semibold text-slate-600">
                                  {copy.lessonsLabel}:
                                </label>
                                <input
                                  type="number"
                                  min={1}
                                  max={Math.max(1, legacyRemaining)}
                                  value={row.lessonsCount}
                                  onChange={(e) => {
                                    const val = Math.max(1, Math.floor(Number(e.target.value) || 1));
                                    mutateDraft((prev) =>
                                      prev.map((item) =>
                                        item.rowId === row.rowId ? { ...item, lessonsCount: val } : item
                                      )
                                    );
                                  }}
                                  className="w-20 h-8 px-2 rounded-lg border border-slate-300 bg-white text-xs font-mono font-bold text-right"
                                />
                                {rows.length > 1 && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      mutateDraft((prev) => prev.filter((item) => item.rowId !== row.rowId))
                                    }
                                    className="p-1.5 rounded-lg text-rose-600 hover:bg-rose-50 cursor-pointer"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>
                            </div>

                            {row.origin === 'paid' ? (
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                                <div>
                                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                                    {copy.evidenceSelectLabel}
                                  </label>
                                  <select
                                    value={row.sourceTransactionId}
                                    onChange={(e) => handleSelectEvidenceForRow(row.rowId, e.target.value)}
                                    className="w-full h-8 px-2.5 rounded-lg border border-slate-300 bg-white text-xs"
                                  >
                                    <option value="">{copy.selectEvidencePlaceholder}</option>
                                    {eligibleEvidences.map((ev) => (
                                      <option key={ev.transactionId} value={ev.transactionId}>
                                        {ev.transactionId} ({ev.remainingBackableLessons}/{ev.lessonsCount} · {formatBrl(ev.totalPaidBrl, lang)})
                                      </option>
                                    ))}
                                  </select>
                                </div>
                                <div>
                                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                                    {copy.teacherConfirmLabel}
                                  </label>
                                  <select
                                    value={row.teacherUid}
                                    onChange={(e) => {
                                      const tUid = e.target.value;
                                      mutateDraft((prev) =>
                                        prev.map((item) =>
                                          item.rowId === row.rowId ? { ...item, teacherUid: tUid } : item
                                        )
                                      );
                                    }}
                                    className="w-full h-8 px-2.5 rounded-lg border border-slate-300 bg-white text-xs"
                                  >
                                    <option value="">{copy.selectTeacherPlaceholder}</option>
                                    {teachers.map((t) => (
                                      <option key={t.uid} value={t.uid}>
                                        {t.name} ({t.email})
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              </div>
                            ) : (
                              <div className="text-[11px] text-sky-900 bg-sky-50 border border-sky-200 px-2.5 py-1.5 rounded-lg">
                                {copy.courtesyZeroNotice}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>

                      {/* Reconciliation Preview Strip */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs">
                        <div>
                          <div className="text-[10px] font-bold uppercase text-slate-500">
                            {copy.summaryBefore}
                          </div>
                          <div className="font-mono font-extrabold text-[#000035]">
                            {legacyRemaining}
                          </div>
                        </div>
                        <div>
                          <div className="text-[10px] font-bold uppercase text-slate-500">
                            {copy.summaryReconciledNow}
                          </div>
                          <div className="font-mono font-extrabold text-[#1C4C96]">
                            {totalAllocatedInDraft}
                          </div>
                        </div>
                        <div>
                          <div className="text-[10px] font-bold uppercase text-slate-500">
                            {copy.summaryRemainingLegacy}
                          </div>
                          <div
                            className={`font-mono font-extrabold ${
                              remainingAfterDraft < 0 ? 'text-rose-700' : 'text-amber-700'
                            }`}
                          >
                            {remainingAfterDraft}
                          </div>
                        </div>
                        <div>
                          <div className="text-[10px] font-bold uppercase text-slate-500">
                            {copy.summaryPreservedAvailable}
                          </div>
                          <div className="font-mono font-extrabold text-emerald-700">
                            {selectedStudent.availableLessons}
                          </div>
                        </div>
                      </div>

                      {/* Justification */}
                      <div>
                        <label className="block text-xs font-bold text-[#000035] mb-1">
                          {copy.justificationLabel}
                        </label>
                        <textarea
                          rows={2}
                          value={justification}
                          onChange={(e) => {
                            setJustification(e.target.value);
                            setDraftIdempotencyKey(createIdempotencyKey(selectedStudent.studentUid));
                          }}
                          placeholder={copy.justificationPlaceholder}
                          className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs focus:outline-none focus:ring-2 focus:ring-[#1C4C96]"
                        />
                      </div>

                      {/* Explicit Confirmation */}
                      <label className="flex items-start gap-2.5 p-3 rounded-xl border border-slate-200 bg-slate-50 cursor-pointer text-xs text-slate-700">
                        <input
                          type="checkbox"
                          checked={confirmed}
                          onChange={(e) => setConfirmed(e.target.checked)}
                          disabled={selectedStudent.hasLedgerDivergence}
                          className="mt-0.5"
                        />
                        <span>{copy.confirmLabel}</span>
                      </label>

                      <div className="flex justify-end">
                        <button
                          type="submit"
                          disabled={!canSubmit}
                          data-testid="submit-legacy-reconciliation-btn"
                          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#000035] hover:bg-[#062863] text-white text-xs font-extrabold transition cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed"
                        >
                          <ShieldCheck className="w-4 h-4" />
                          <span>{submitting ? copy.submittingBtn : copy.submitBtn}</span>
                        </button>
                      </div>
                    </form>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AdminLegacyCreditReconciliationModal;
