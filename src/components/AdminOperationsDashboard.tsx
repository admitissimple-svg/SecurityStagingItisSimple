import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BarChart3,
  RefreshCw,
  AlertCircle,
  Filter,
  RotateCcw,
  ShieldCheck,
} from 'lucide-react';
import { getAdminAccessToken } from '../utils/auth';
import { AdminLegacyCreditReconciliationModal } from './AdminLegacyCreditReconciliationModal';
import type { Language } from '../types';
import type {
  AdminOperationsDashboardData,
  OperationsRow,
} from '../utils/adminOperationsAnalytics';

export interface AdminOperationsDashboardProps {
  initialData?: AdminOperationsDashboardData | null;
  currentLanguage?: Language;
}

type SupportedDashboardLang = 'pt' | 'en';

const NUMERIC_MONTHS: ReadonlyArray<number> = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

interface DashboardCopy {
  title: string;
  subtitle: string;
  refresh: string;
  refreshing: string;
  reconcileLegacy: string;
  clearFilters: string;
  retry: string;
  nd: string;
  unassignedTeacher: string;
  allOption: string;
  filterYearAria: string;
  filterMonthAria: string;
  filterCountryAria: string;
  filterTeacherAria: string;
  authError: string;
  forbiddenError: string;
  loadError: string;
  connectionError: string;
  kpiStudents: string;
  kpiStudentsSub: string;
  kpiContracted: string;
  kpiContractedSubDefault: string;
  kpiAttended: string;
  kpiAttendedSub: string;
  kpiBalance: string;
  kpiBalanceSub: string;
  kpiRevenue: string;
  kpiRevenueSub: string;
  kpiProfit: string;
  kpiProfitSubComputed: string;
  kpiProfitSubNoCost: string;
  colYear: string;
  colMonth: string;
  colCountry: string;
  colNativeFriend: string;
  colStudentsCount: string;
  colContracted: string;
  colAttended: string;
  colBalance: string;
  colLessonUsd: string;
  colMarkup: string;
  colLessonBrl: string;
  colRevenue: string;
  colPlatformCost: string;
  colNativeFriendCost: string;
  colProfit: string;
  emptyTitle: string;
  emptySubtitle: string;
  footnoteHistorical: string;
  footnoteWeighted: string;
  formatPaidAdminSub: (paid: string, admin: string) => string;
  formatProfitMissingCostSub: (grossShare: string) => string;
  formatTotalsLabel: (count: number) => string;
}

const DASHBOARD_COPY: Record<SupportedDashboardLang, DashboardCopy> = {
  pt: {
    title: 'Painel de Operações da Plataforma',
    subtitle: 'Operação mensal por Native Friend — competência de compra e realização de aulas · Firestore (default)',
    refresh: 'Atualizar',
    refreshing: 'Atualizando...',
    reconcileLegacy: 'Conciliar Créditos Legados',
    clearFilters: 'Limpar filtros',
    retry: 'Tentar novamente',
    nd: 'N/D',
    unassignedTeacher: 'Ajuste sem vínculo',
    allOption: 'Todos',
    filterYearAria: 'Filtrar por Ano',
    filterMonthAria: 'Filtrar por Mês',
    filterCountryAria: 'Filtrar por País',
    filterTeacherAria: 'Filtrar por Native Friend',
    authError: 'Sessão administrativa não autenticada. Faça login novamente para consultar a operação.',
    forbiddenError: 'Acesso negado: apenas administradores podem visualizar o dashboard operacional.',
    loadError: 'Não foi possível carregar os indicadores operacionais do Firestore (default).',
    connectionError: 'Erro de conexão ao consultar o dashboard operacional.',
    kpiStudents: 'Alunos',
    kpiStudentsSub: 'Distintos no recorte',
    kpiContracted: 'Aulas Contratadas',
    kpiContractedSubDefault: 'Competência de compra',
    kpiAttended: 'Atendidas',
    kpiAttendedSub: 'Realizadas (não-trial)',
    kpiBalance: 'Saldo',
    kpiBalanceSub: 'Créditos disponíveis por aluno',
    kpiRevenue: 'Faturamento',
    kpiRevenueSub: 'Apenas compras pagas',
    kpiProfit: 'Lucro',
    kpiProfitSubComputed: 'Faturamento − Custos',
    kpiProfitSubNoCost: 'Sem custo plataforma registrado',
    colYear: 'Ano',
    colMonth: 'Mês',
    colCountry: 'País',
    colNativeFriend: 'Native Friend',
    colStudentsCount: 'Nº Alunos',
    colContracted: 'Aulas Contratadas',
    colAttended: 'Atendidas',
    colBalance: 'Saldo',
    colLessonUsd: 'Aula USD',
    colMarkup: 'Comissão MARKUP',
    colLessonBrl: 'Aula BRL',
    colRevenue: 'Faturamento',
    colPlatformCost: 'Custo Plataforma',
    colNativeFriendCost: 'Custo Native Friend',
    colProfit: 'Lucro',
    emptyTitle: 'Nenhum registro operacional encontrado para os filtros selecionados.',
    emptySubtitle: 'Os dados são consolidados diretamente do Firestore (default) sem registros simulados.',
    footnoteHistorical:
      'Valores históricos preservam os snapshots FIN.2B/2C/2D de PTAX e comissão MARKUP gravados em cada transação. Concessões administrativas não são somadas ao faturamento.',
    footnoteWeighted: '* Média ponderada pelos pacotes históricos do mês.',
    formatPaidAdminSub: (paid, admin) => `${paid} pagas · ${admin} admin`,
    formatProfitMissingCostSub: (grossShare) => `Plat. FIN.2D: ${grossShare} · Custo plat. N/D`,
    formatTotalsLabel: (count) => `Totais do recorte (${count} ${count === 1 ? 'linha' : 'linhas'})`,
  },
  en: {
    title: 'Platform Operations Dashboard',
    subtitle: 'Monthly operations per Native Friend — purchase and lesson realization competence · Firestore (default)',
    refresh: 'Refresh',
    refreshing: 'Refreshing...',
    reconcileLegacy: 'Reconcile Legacy Credits',
    clearFilters: 'Clear filters',
    retry: 'Try again',
    nd: 'N/A',
    unassignedTeacher: 'Unlinked adjustment',
    allOption: 'All',
    filterYearAria: 'Filter by Year',
    filterMonthAria: 'Filter by Month',
    filterCountryAria: 'Filter by Country',
    filterTeacherAria: 'Filter by Native Friend',
    authError: 'Administrator session not authenticated. Sign in again to query operations.',
    forbiddenError: 'Access denied: only administrators can view the operations dashboard.',
    loadError: 'Could not load operational metrics from Firestore (default).',
    connectionError: 'Connection error while querying the operations dashboard.',
    kpiStudents: 'Students',
    kpiStudentsSub: 'Distinct in selection',
    kpiContracted: 'Contracted Lessons',
    kpiContractedSubDefault: 'Purchase competence',
    kpiAttended: 'Attended',
    kpiAttendedSub: 'Completed (non-trial)',
    kpiBalance: 'Balance',
    kpiBalanceSub: 'Available credits per student',
    kpiRevenue: 'Revenue',
    kpiRevenueSub: 'Paid purchases only',
    kpiProfit: 'Profit',
    kpiProfitSubComputed: 'Revenue − Costs',
    kpiProfitSubNoCost: 'No platform cost recorded',
    colYear: 'Year',
    colMonth: 'Month',
    colCountry: 'Country',
    colNativeFriend: 'Native Friend',
    colStudentsCount: 'Students',
    colContracted: 'Contracted Lessons',
    colAttended: 'Attended',
    colBalance: 'Balance',
    colLessonUsd: 'Lesson USD',
    colMarkup: 'MARKUP Commission',
    colLessonBrl: 'Lesson BRL',
    colRevenue: 'Revenue',
    colPlatformCost: 'Platform Cost',
    colNativeFriendCost: 'Native Friend Cost',
    colProfit: 'Profit',
    emptyTitle: 'No operational records found for the selected filters.',
    emptySubtitle: 'Data is consolidated directly from Firestore (default) with no simulated records.',
    footnoteHistorical:
      'Historical values preserve the FIN.2B/2C/2D PTAX and MARKUP commission snapshots recorded in each transaction. Administrative grants are not added to revenue.',
    footnoteWeighted: "* Weighted average across the month's historical packages.",
    formatPaidAdminSub: (paid, admin) => `${paid} paid · ${admin} admin`,
    formatProfitMissingCostSub: (grossShare) => `Plat. FIN.2D: ${grossShare} · Plat. cost N/A`,
    formatTotalsLabel: (count) => `Filtered totals (${count} ${count === 1 ? 'row' : 'rows'})`,
  },
};

function formatBrlOrNd(val: number | null | undefined, lang: SupportedDashboardLang, ndLabel: string): string {
  if (typeof val !== 'number' || !Number.isFinite(val)) return ndLabel;
  return val.toLocaleString(lang === 'pt' ? 'pt-BR' : 'en-US', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatUsdOrNd(val: number | null | undefined, ndLabel: string): string {
  if (typeof val !== 'number' || !Number.isFinite(val)) return ndLabel;
  return `$${val.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatMarkupOrNd(val: number | null | undefined, lang: SupportedDashboardLang, ndLabel: string): string {
  if (typeof val !== 'number' || !Number.isFinite(val)) return ndLabel;
  const formatted = Number.isInteger(val)
    ? String(val)
    : val.toLocaleString(lang === 'pt' ? 'pt-BR' : 'en-US', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
      });
  return `${formatted}%`;
}

function formatInteger(val: number, lang: SupportedDashboardLang): string {
  return val.toLocaleString(lang === 'pt' ? 'pt-BR' : 'en-US');
}

function formatIntegerOrNd(
  val: number | null | undefined,
  lang: SupportedDashboardLang,
  ndLabel: string
): string {
  if (typeof val !== 'number' || !Number.isFinite(val)) return ndLabel;
  return val.toLocaleString(lang === 'pt' ? 'pt-BR' : 'en-US');
}

function renderValueOrNd(
  formatted: string,
  ndLabel: string,
  emphasisClass = 'text-slate-900 font-medium'
): React.ReactNode {
  if (formatted === ndLabel) {
    return <span className="text-slate-400 font-normal">{ndLabel}</span>;
  }
  return <span className={emphasisClass}>{formatted}</span>;
}

export const AdminOperationsDashboard: React.FC<AdminOperationsDashboardProps> = ({
  initialData = null,
  currentLanguage = 'pt',
}) => {
  const lang: SupportedDashboardLang = currentLanguage === 'pt' ? 'pt' : 'en';
  const copy = DASHBOARD_COPY[lang];
  const copyRef = useRef(copy);
  copyRef.current = copy;

  const [selectedYear, setSelectedYear] = useState<string>(
    initialData?.filtersApplied?.year && initialData.filtersApplied.year !== 'all'
      ? String(initialData.filtersApplied.year)
      : 'all'
  );
  const [selectedMonth, setSelectedMonth] = useState<string>(
    initialData?.filtersApplied?.month && initialData.filtersApplied.month !== 'all'
      ? String(initialData.filtersApplied.month)
      : 'all'
  );
  const [selectedCountry, setSelectedCountry] = useState<string>(
    initialData?.filtersApplied?.country && initialData.filtersApplied.country !== 'all'
      ? initialData.filtersApplied.country
      : 'all'
  );
  const [selectedTeacher, setSelectedTeacher] = useState<string>(
    initialData?.filtersApplied?.teacherUid && initialData.filtersApplied.teacherUid !== 'all'
      ? initialData.filtersApplied.teacherUid
      : 'all'
  );

  const [data, setData] = useState<AdminOperationsDashboardData | null>(initialData);
  const [loading, setLoading] = useState<boolean>(!initialData);
  const [error, setError] = useState<string | null>(null);
  const [isReconcileModalOpen, setIsReconcileModalOpen] = useState<boolean>(false);
  const requestSeqRef = useRef(0);
  const skipInitialFetchRef = useRef<boolean>(Boolean(initialData));

  const fetchOperations = useCallback(
    async (yearVal: string, monthVal: string, countryVal: string, teacherVal: string) => {
      const seq = ++requestSeqRef.current;
      setLoading(true);
      setError(null);

      try {
        const token = await getAdminAccessToken();
        if (!token) {
          if (seq === requestSeqRef.current) {
            setError(copyRef.current.authError);
            setLoading(false);
          }
          return;
        }

        const params = new URLSearchParams();
        if (yearVal && yearVal !== 'all') params.set('year', yearVal);
        if (monthVal && monthVal !== 'all') params.set('month', monthVal);
        if (countryVal && countryVal !== 'all') params.set('country', countryVal);
        if (teacherVal && teacherVal !== 'all') params.set('teacherUid', teacherVal);

        const qs = params.toString();
        const url = `/api/admin/operations-dashboard${qs ? `?${qs}` : ''}`;

        const res = await fetch(url, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
          },
        });

        const json = await res.json().catch(() => null);
        if (seq !== requestSeqRef.current) return;

        if (!res.ok || !json?.success) {
          setError(
            json?.message ||
              (res.status === 403 ? copyRef.current.forbiddenError : copyRef.current.loadError)
          );
          setLoading(false);
          return;
        }

        setData(json as AdminOperationsDashboardData);
        setLoading(false);
      } catch (err: any) {
        if (seq !== requestSeqRef.current) return;
        setError(err?.message || copyRef.current.connectionError);
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    if (skipInitialFetchRef.current) {
      skipInitialFetchRef.current = false;
      return;
    }
    fetchOperations(selectedYear, selectedMonth, selectedCountry, selectedTeacher);
  }, [fetchOperations, selectedYear, selectedMonth, selectedCountry, selectedTeacher]);

  const hasActiveFilters =
    selectedYear !== 'all' ||
    selectedMonth !== 'all' ||
    selectedCountry !== 'all' ||
    selectedTeacher !== 'all';

  const handleResetFilters = () => {
    setSelectedYear('all');
    setSelectedMonth('all');
    setSelectedCountry('all');
    setSelectedTeacher('all');
  };

  const rows: OperationsRow[] = data?.rows || [];
  const kpis = data?.kpis;
  const yearOptions = data?.filterOptions?.years || [];
  const teacherOptions = data?.filterOptions?.teachers || [];

  const countryOptions = useMemo(() => {
    if (Array.isArray(data?.filterOptions?.countries)) {
      return data.filterOptions.countries;
    }
    const derived = new Set<string>();
    for (const r of rows) {
      if (r.country && r.country.trim() !== '') {
        derived.add(r.country.trim());
      }
    }
    return Array.from(derived).sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
  }, [data?.filterOptions?.countries, rows]);

  const hasMissingCountry = useMemo(() => {
    if (typeof data?.filterOptions?.hasMissingCountry === 'boolean') {
      return data.filterOptions.hasMissingCountry;
    }
    return rows.some((r) => !r.country || r.country.trim() === '');
  }, [data?.filterOptions?.hasMissingCountry, rows]);

  const hasMixedSnapshotsInRows = useMemo(
    () => rows.some((r) => r.hasMixedPricingSnapshots),
    [rows]
  );

  return (
    <section
      aria-label="Platform Operations Dashboard"
      data-testid="adm-ops-dashboard"
      className="bg-white rounded-3xl border border-slate-200/90 shadow-sm overflow-hidden"
    >
      {/* Header */}
      <div className="px-5 py-4 sm:px-6 border-b border-slate-200 bg-[#FAFCFF] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-start sm:items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-[#000035] text-white flex items-center justify-center shrink-0">
            <BarChart3 className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base sm:text-lg font-extrabold text-[#000035] tracking-tight">
              {copy.title}
            </h2>
            <p className="text-xs text-slate-600 mt-0.5">{copy.subtitle}</p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap self-start sm:self-auto shrink-0">
          {hasActiveFilters && (
            <button
              type="button"
              onClick={handleResetFilters}
              data-testid="ops-clear-filters"
              className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-slate-300 bg-slate-50 hover:bg-slate-100 text-xs font-bold text-slate-700 transition cursor-pointer whitespace-nowrap shrink-0"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>{copy.clearFilters}</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => setIsReconcileModalOpen(true)}
            data-testid="open-legacy-reconciliation-btn"
            className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#000035] hover:bg-[#062863] text-white font-bold text-xs transition cursor-pointer whitespace-nowrap shrink-0"
          >
            <ShieldCheck className="w-3.5 h-3.5 text-[#9AB4FF]" />
            <span>{copy.reconcileLegacy}</span>
          </button>
          <button
            type="button"
            onClick={() =>
              fetchOperations(selectedYear, selectedMonth, selectedCountry, selectedTeacher)
            }
            disabled={loading}
            className="inline-flex items-center justify-center gap-2 px-3.5 py-2 rounded-xl bg-white hover:bg-slate-50 border border-slate-300 text-[#000035] font-bold text-xs transition cursor-pointer disabled:opacity-60 whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>{loading ? copy.refreshing : copy.refresh}</span>
          </button>
        </div>
      </div>

      {/* Error State */}
      {error && (
        <div className="mx-5 mt-5 sm:mx-6 p-4 rounded-2xl border border-rose-200 bg-rose-50/70 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-2.5 text-rose-900">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-rose-600" />
            <p className="text-xs font-semibold">{error}</p>
          </div>
          <button
            type="button"
            onClick={() =>
              fetchOperations(selectedYear, selectedMonth, selectedCountry, selectedTeacher)
            }
            className="px-3 py-1.5 rounded-lg bg-white border border-rose-300 text-rose-800 text-xs font-bold hover:bg-rose-50 transition cursor-pointer whitespace-nowrap shrink-0"
          >
            {copy.retry}
          </button>
        </div>
      )}

      {/* KPI Summary Strip */}
      <div className="p-5 sm:p-6 border-b border-slate-200 bg-[#FAFCFF]">
        {loading && !data ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {Array.from({ length: 6 }).map((_, idx) => (
              <div
                key={idx}
                className="h-20 rounded-2xl border border-slate-200 bg-white animate-pulse p-3.5"
              />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <div className="rounded-2xl border border-slate-200 bg-white p-3.5">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 block">
                {copy.kpiStudents}
              </span>
              <span
                data-testid="kpi-alunos"
                className="mt-1 block text-xl font-extrabold text-[#000035] font-mono tabular-nums"
              >
                {kpis ? formatInteger(kpis.alunosCount, lang) : copy.nd}
              </span>
              <span className="mt-0.5 block text-[11px] text-slate-500">{copy.kpiStudentsSub}</span>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-3.5">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 block">
                {copy.kpiContracted}
              </span>
              <span
                data-testid="kpi-contratadas"
                className="mt-1 block text-xl font-extrabold text-[#000035] font-mono tabular-nums"
              >
                {kpis ? formatInteger(kpis.aulasContratadas, lang) : copy.nd}
              </span>
              <span className="mt-0.5 block text-[11px] text-slate-500 tabular-nums">
                {kpis && kpis.adminGrantedLessons !== 0
                  ? copy.formatPaidAdminSub(
                      formatInteger(kpis.paidContractedLessons, lang),
                      formatInteger(kpis.adminGrantedLessons, lang)
                    )
                  : copy.kpiContractedSubDefault}
              </span>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-3.5">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 block">
                {copy.kpiAttended}
              </span>
              <span
                data-testid="kpi-atendidas"
                className="mt-1 block text-xl font-extrabold text-[#1C4C96] font-mono tabular-nums"
              >
                {kpis ? formatInteger(kpis.atendidas, lang) : copy.nd}
              </span>
              <span className="mt-0.5 block text-[11px] text-slate-500">{copy.kpiAttendedSub}</span>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-3.5">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 block">
                {copy.kpiBalance}
              </span>
              <span
                data-testid="kpi-saldo"
                className={`mt-1 block text-xl font-extrabold font-mono tabular-nums ${
                  kpis && typeof kpis.saldo === 'number'
                    ? kpis.saldo < 0
                      ? 'text-amber-700'
                      : 'text-[#000035]'
                    : 'text-slate-500'
                }`}
              >
                {kpis ? formatIntegerOrNd(kpis.saldo, lang, copy.nd) : copy.nd}
              </span>
              <span className="mt-0.5 block text-[11px] text-slate-500">{copy.kpiBalanceSub}</span>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-3.5">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 block">
                {copy.kpiRevenue}
              </span>
              <span
                data-testid="kpi-faturamento"
                className="mt-1 block text-xl font-extrabold text-emerald-700 font-mono tabular-nums"
              >
                {kpis ? formatBrlOrNd(kpis.faturamentoBrl, lang, copy.nd) : copy.nd}
              </span>
              <span className="mt-0.5 block text-[11px] text-slate-500">{copy.kpiRevenueSub}</span>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-3.5">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 block">
                {copy.kpiProfit}
              </span>
              <span
                data-testid="kpi-lucro"
                className={`mt-1 block text-xl font-extrabold font-mono tabular-nums ${
                  kpis && kpis.lucroBrl !== null
                    ? kpis.lucroBrl >= 0
                      ? 'text-emerald-700'
                      : 'text-rose-700'
                    : 'text-slate-500'
                }`}
              >
                {kpis ? formatBrlOrNd(kpis.lucroBrl, lang, copy.nd) : copy.nd}
              </span>
              <span className="mt-0.5 block text-[11px] text-slate-500 tabular-nums">
                {kpis && kpis.lucroBrl === null && kpis.grossPlatformShareBrl !== null
                  ? copy.formatProfitMissingCostSub(
                      formatBrlOrNd(kpis.grossPlatformShareBrl, lang, copy.nd)
                    )
                  : kpis && kpis.lucroBrl !== null
                  ? copy.kpiProfitSubComputed
                  : copy.kpiProfitSubNoCost}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Operations Monthly Table with Header Filters & Horizontal Scroll */}
      <div className="p-5 sm:p-6">
        {loading && !data ? (
          <div className="h-44 rounded-2xl border border-slate-200 bg-slate-50 animate-pulse" />
        ) : (
          <>
            <div className="overflow-x-auto rounded-2xl border border-slate-200">
              <table className="w-full min-w-[1280px] border-collapse text-xs">
                <thead>
                  <tr className="bg-[#000035] text-white text-[11px] font-bold uppercase tracking-wider">
                    <th className="py-2.5 px-3 text-left whitespace-nowrap align-top">
                      <div className="flex flex-col gap-1.5 min-w-[82px]">
                        <span className="inline-flex items-center gap-1">
                          <Filter className="w-3 h-3 text-[#9AB4FF]" />
                          <span>{copy.colYear}</span>
                        </span>
                        <select
                          id="ops-filter-year"
                          aria-label={copy.filterYearAria}
                          value={selectedYear}
                          onChange={(e) => setSelectedYear(e.target.value)}
                          className="h-7 px-2 rounded-lg border border-white/25 bg-white text-slate-900 text-[11px] font-semibold normal-case tracking-normal focus:outline-none focus:ring-2 focus:ring-[#9AB4FF]"
                        >
                          <option value="all">{copy.allOption}</option>
                          {yearOptions.map((yr) => (
                            <option key={yr} value={String(yr)}>
                              {yr}
                            </option>
                          ))}
                        </select>
                      </div>
                    </th>
                    <th className="py-2.5 px-3 text-left whitespace-nowrap align-top">
                      <div className="flex flex-col gap-1.5 min-w-[74px]">
                        <span className="inline-flex items-center gap-1">
                          <Filter className="w-3 h-3 text-[#9AB4FF]" />
                          <span>{copy.colMonth}</span>
                        </span>
                        <select
                          id="ops-filter-month"
                          aria-label={copy.filterMonthAria}
                          value={selectedMonth}
                          onChange={(e) => setSelectedMonth(e.target.value)}
                          className="h-7 px-2 rounded-lg border border-white/25 bg-white text-slate-900 text-[11px] font-semibold normal-case tracking-normal focus:outline-none focus:ring-2 focus:ring-[#9AB4FF]"
                        >
                          <option value="all">{copy.allOption}</option>
                          {NUMERIC_MONTHS.map((m) => (
                            <option key={m} value={String(m)}>
                              {m}
                            </option>
                          ))}
                        </select>
                      </div>
                    </th>
                    <th className="py-2.5 px-3 text-left whitespace-nowrap align-top">
                      <div className="flex flex-col gap-1.5 min-w-[122px]">
                        <span className="inline-flex items-center gap-1">
                          <Filter className="w-3 h-3 text-[#9AB4FF]" />
                          <span>{copy.colCountry}</span>
                        </span>
                        <select
                          id="ops-filter-country"
                          aria-label={copy.filterCountryAria}
                          value={selectedCountry}
                          onChange={(e) => setSelectedCountry(e.target.value)}
                          className="h-7 px-2 rounded-lg border border-white/25 bg-white text-slate-900 text-[11px] font-semibold normal-case tracking-normal focus:outline-none focus:ring-2 focus:ring-[#9AB4FF]"
                        >
                          <option value="all">{copy.allOption}</option>
                          {countryOptions.map((country) => (
                            <option key={country} value={country}>
                              {country}
                            </option>
                          ))}
                          {hasMissingCountry && <option value="__nd__">{copy.nd}</option>}
                        </select>
                      </div>
                    </th>
                    <th className="py-2.5 px-3 text-left whitespace-nowrap align-top">
                      <div className="flex flex-col gap-1.5 min-w-[175px]">
                        <span className="inline-flex items-center gap-1">
                          <Filter className="w-3 h-3 text-[#9AB4FF]" />
                          <span>{copy.colNativeFriend}</span>
                        </span>
                        <select
                          id="ops-filter-teacher"
                          aria-label={copy.filterTeacherAria}
                          value={selectedTeacher}
                          onChange={(e) => setSelectedTeacher(e.target.value)}
                          className="h-7 px-2 rounded-lg border border-white/25 bg-white text-slate-900 text-[11px] font-semibold normal-case tracking-normal focus:outline-none focus:ring-2 focus:ring-[#9AB4FF] max-w-[220px]"
                        >
                          <option value="all">{copy.allOption}</option>
                          {teacherOptions.map((t) => (
                            <option key={t.teacherKey} value={t.teacherKey}>
                              {t.teacherKey === '__unassigned__' ? copy.unassignedTeacher : t.name}
                              {t.country ? ` (${t.country})` : ''}
                            </option>
                          ))}
                        </select>
                      </div>
                    </th>
                    <th className="py-3 px-3 text-right whitespace-nowrap align-top">
                      {copy.colStudentsCount}
                    </th>
                    <th className="py-3 px-3 text-right whitespace-nowrap align-top">
                      {copy.colContracted}
                    </th>
                    <th className="py-3 px-3 text-right whitespace-nowrap align-top">
                      {copy.colAttended}
                    </th>
                    <th className="py-3 px-3 text-right whitespace-nowrap align-top">
                      {copy.colBalance}
                    </th>
                    <th className="py-3 px-3 text-right whitespace-nowrap align-top">
                      {copy.colLessonUsd}
                    </th>
                    <th className="py-3 px-3 text-right whitespace-nowrap align-top">
                      {copy.colMarkup}
                    </th>
                    <th className="py-3 px-3 text-right whitespace-nowrap align-top">
                      {copy.colLessonBrl}
                    </th>
                    <th className="py-3 px-3 text-right whitespace-nowrap align-top">
                      {copy.colRevenue}
                    </th>
                    <th className="py-3 px-3 text-right whitespace-nowrap align-top">
                      {copy.colPlatformCost}
                    </th>
                    <th className="py-3 px-3 text-right whitespace-nowrap align-top">
                      {copy.colNativeFriendCost}
                    </th>
                    <th className="py-3 px-3 text-right whitespace-nowrap align-top">
                      {copy.colProfit}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 bg-white">
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={15} className="py-12 px-4 text-center bg-slate-50/50">
                        <p className="text-sm font-bold text-[#000035]">{copy.emptyTitle}</p>
                        <p className="text-xs text-slate-500 mt-1">{copy.emptySubtitle}</p>
                        {hasActiveFilters && (
                          <button
                            type="button"
                            onClick={handleResetFilters}
                            className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#000035] hover:bg-[#062863] text-white text-xs font-bold transition cursor-pointer"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                            <span>{copy.clearFilters}</span>
                          </button>
                        )}
                      </td>
                    </tr>
                  ) : (
                    rows.map((row) => (
                      <tr key={row.rowKey} className="hover:bg-[#FAFCFF] transition-colors">
                        <td className="py-3 px-3 text-left font-mono tabular-nums font-semibold text-slate-800 whitespace-nowrap">
                          {row.year}
                        </td>
                        <td className="py-3 px-3 text-left font-mono tabular-nums font-medium text-slate-700 whitespace-nowrap">
                          {row.month}
                        </td>
                        <td className="py-3 px-3 text-left whitespace-nowrap">
                          {row.country ? (
                            <span className="text-slate-700 font-medium">{row.country}</span>
                          ) : (
                            <span className="text-slate-400">{copy.nd}</span>
                          )}
                        </td>
                        <td className="py-3 px-3 text-left whitespace-nowrap">
                          <div className="font-bold text-[#000035]">
                            {row.teacherKey === '__unassigned__'
                              ? copy.unassignedTeacher
                              : row.nativeFriendName}
                          </div>
                          {row.nativeFriendEmail && (
                            <div className="text-[11px] text-slate-500 font-normal">
                              {row.nativeFriendEmail}
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-800 whitespace-nowrap">
                          {formatInteger(row.studentsCount, lang)}
                        </td>
                        <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-900 font-semibold whitespace-nowrap">
                          <div>{formatInteger(row.aulasContratadas, lang)}</div>
                          {row.adminGrantedLessons !== 0 && (
                            <div className="text-[10px] font-sans font-normal text-slate-500">
                              {formatInteger(row.paidContractedLessons, lang)}p /{' '}
                              {formatInteger(row.adminGrantedLessons, lang)} adm
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-3 text-right font-mono tabular-nums text-[#1C4C96] font-semibold whitespace-nowrap">
                          {formatInteger(row.atendidas, lang)}
                        </td>
                        <td className="py-3 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                          {renderValueOrNd(
                            formatIntegerOrNd(row.saldo, lang, copy.nd),
                            copy.nd,
                            row.saldo !== null && row.saldo < 0
                              ? 'text-amber-700 font-semibold'
                              : 'text-slate-900 font-semibold'
                          )}
                        </td>
                        <td className="py-3 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                          {renderValueOrNd(
                            formatUsdOrNd(row.aulaUsd, copy.nd),
                            copy.nd,
                            'text-slate-800'
                          )}
                          {row.hasMixedPricingSnapshots && row.aulaUsd !== null ? (
                            <span className="text-slate-400 ml-0.5">*</span>
                          ) : null}
                        </td>
                        <td className="py-3 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                          {renderValueOrNd(
                            formatMarkupOrNd(row.comissaoMarkupPercent, lang, copy.nd),
                            copy.nd,
                            'text-slate-800'
                          )}
                        </td>
                        <td className="py-3 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                          {renderValueOrNd(
                            formatBrlOrNd(row.aulaBrl, lang, copy.nd),
                            copy.nd,
                            'text-slate-800'
                          )}
                        </td>
                        <td className="py-3 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                          {renderValueOrNd(
                            formatBrlOrNd(row.faturamentoBrl, lang, copy.nd),
                            copy.nd,
                            'text-emerald-700 font-bold'
                          )}
                        </td>
                        <td className="py-3 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                          {renderValueOrNd(
                            formatBrlOrNd(row.custoPlataformaBrl, lang, copy.nd),
                            copy.nd,
                            'text-slate-800'
                          )}
                        </td>
                        <td className="py-3 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                          {renderValueOrNd(
                            formatBrlOrNd(row.custoNativeFriendBrl, lang, copy.nd),
                            copy.nd,
                            'text-slate-800'
                          )}
                        </td>
                        <td className="py-3 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                          {renderValueOrNd(
                            formatBrlOrNd(row.lucroBrl, lang, copy.nd),
                            copy.nd,
                            row.lucroBrl !== null && row.lucroBrl < 0
                              ? 'text-rose-700 font-bold'
                              : 'text-emerald-700 font-bold'
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
                {kpis && rows.length > 0 && (
                  <tfoot>
                    <tr className="bg-slate-50 border-t-2 border-slate-200 font-bold text-slate-900">
                      <td className="py-3 px-3 text-left whitespace-nowrap" colSpan={4}>
                        {copy.formatTotalsLabel(rows.length)}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-600 whitespace-nowrap">
                        {formatInteger(kpis.alunosCount, lang)}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                        {formatInteger(kpis.aulasContratadas, lang)}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums text-[#1C4C96] whitespace-nowrap">
                        {formatInteger(kpis.atendidas, lang)}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                        {renderValueOrNd(
                          formatIntegerOrNd(kpis.saldo, lang, copy.nd),
                          copy.nd,
                          kpis.saldo !== null && kpis.saldo < 0
                            ? 'text-amber-700 font-bold'
                            : 'text-slate-900 font-bold'
                        )}
                      </td>
                      <td className="py-3 px-3 text-right text-slate-400 whitespace-nowrap">—</td>
                      <td className="py-3 px-3 text-right text-slate-400 whitespace-nowrap">—</td>
                      <td className="py-3 px-3 text-right text-slate-400 whitespace-nowrap">—</td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums text-emerald-700 whitespace-nowrap">
                        {formatBrlOrNd(kpis.faturamentoBrl, lang, copy.nd)}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                        {renderValueOrNd(
                          formatBrlOrNd(kpis.custoPlataformaBrl, lang, copy.nd),
                          copy.nd
                        )}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                        {renderValueOrNd(
                          formatBrlOrNd(kpis.custoNativeFriendBrl, lang, copy.nd),
                          copy.nd
                        )}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                        {renderValueOrNd(
                          formatBrlOrNd(kpis.lucroBrl, lang, copy.nd),
                          copy.nd,
                          kpis.lucroBrl !== null && kpis.lucroBrl < 0
                            ? 'text-rose-700 font-bold'
                            : 'text-emerald-700 font-bold'
                        )}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>

            <div className="mt-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[11px] text-slate-500">
              <span>{copy.footnoteHistorical}</span>
              {hasMixedSnapshotsInRows && (
                <span className="shrink-0">{copy.footnoteWeighted}</span>
              )}
            </div>
          </>
        )}
      </div>

      {isReconcileModalOpen && (
        <AdminLegacyCreditReconciliationModal
          isOpen={isReconcileModalOpen}
          onClose={() => setIsReconcileModalOpen(false)}
          currentLanguage={currentLanguage}
        />
      )}
    </section>
  );
};

export default AdminOperationsDashboard;
