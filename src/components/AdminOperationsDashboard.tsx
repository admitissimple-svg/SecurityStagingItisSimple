import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BarChart3,
  RefreshCw,
  AlertCircle,
  Filter,
  RotateCcw,
} from 'lucide-react';
import { getAdminAccessToken } from '../utils/auth';
import type {
  AdminOperationsDashboardData,
  OperationsRow,
} from '../utils/adminOperationsAnalytics';

interface AdminOperationsDashboardProps {
  initialData?: AdminOperationsDashboardData | null;
}

const MONTH_OPTIONS: ReadonlyArray<{ value: number; label: string; short: string }> = [
  { value: 1, label: '01 - Janeiro', short: 'Jan' },
  { value: 2, label: '02 - Fevereiro', short: 'Fev' },
  { value: 3, label: '03 - Março', short: 'Mar' },
  { value: 4, label: '04 - Abril', short: 'Abr' },
  { value: 5, label: '05 - Maio', short: 'Mai' },
  { value: 6, label: '06 - Junho', short: 'Jun' },
  { value: 7, label: '07 - Julho', short: 'Jul' },
  { value: 8, label: '08 - Agosto', short: 'Ago' },
  { value: 9, label: '09 - Setembro', short: 'Set' },
  { value: 10, label: '10 - Outubro', short: 'Out' },
  { value: 11, label: '11 - Novembro', short: 'Nov' },
  { value: 12, label: '12 - Dezembro', short: 'Dez' },
];

function getMonthLabel(month: number): string {
  const found = MONTH_OPTIONS.find((m) => m.value === month);
  return found ? found.label : String(month).padStart(2, '0');
}

function formatBrlOrNd(val: number | null | undefined): string {
  if (typeof val !== 'number' || !Number.isFinite(val)) return 'N/D';
  return val.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatUsdOrNd(val: number | null | undefined): string {
  if (typeof val !== 'number' || !Number.isFinite(val)) return 'N/D';
  return `$${val.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatMarkupOrNd(val: number | null | undefined): string {
  if (typeof val !== 'number' || !Number.isFinite(val)) return 'N/D';
  const formatted = Number.isInteger(val)
    ? String(val)
    : val.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  return `${formatted}%`;
}

function formatInteger(val: number): string {
  return val.toLocaleString('pt-BR');
}

function renderValueOrNd(
  formatted: string,
  emphasisClass = 'text-slate-900 font-medium'
): React.ReactNode {
  if (formatted === 'N/D') {
    return <span className="text-slate-400 font-normal">N/D</span>;
  }
  return <span className={emphasisClass}>{formatted}</span>;
}

export const AdminOperationsDashboard: React.FC<AdminOperationsDashboardProps> = ({
  initialData = null,
}) => {
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
  const [selectedTeacher, setSelectedTeacher] = useState<string>(
    initialData?.filtersApplied?.teacherUid && initialData.filtersApplied.teacherUid !== 'all'
      ? initialData.filtersApplied.teacherUid
      : 'all'
  );

  const [data, setData] = useState<AdminOperationsDashboardData | null>(initialData);
  const [loading, setLoading] = useState<boolean>(!initialData);
  const [error, setError] = useState<string | null>(null);
  const requestSeqRef = useRef(0);
  const skipInitialFetchRef = useRef<boolean>(Boolean(initialData));

  const fetchOperations = useCallback(
    async (yearVal: string, monthVal: string, teacherVal: string) => {
      const seq = ++requestSeqRef.current;
      setLoading(true);
      setError(null);

      try {
        const token = await getAdminAccessToken();
        if (!token) {
          if (seq === requestSeqRef.current) {
            setError('Sessão administrativa não autenticada. Faça login novamente para consultar a operação.');
            setLoading(false);
          }
          return;
        }

        const params = new URLSearchParams();
        if (yearVal && yearVal !== 'all') params.set('year', yearVal);
        if (monthVal && monthVal !== 'all') params.set('month', monthVal);
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
              (res.status === 403
                ? 'Acesso negado: apenas administradores podem visualizar o dashboard operacional.'
                : 'Não foi possível carregar os indicadores operacionais do Firestore (default).')
          );
          setLoading(false);
          return;
        }

        setData(json as AdminOperationsDashboardData);
        setLoading(false);
      } catch (err: any) {
        if (seq !== requestSeqRef.current) return;
        setError(err?.message || 'Erro de conexão ao consultar o dashboard operacional.');
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
    fetchOperations(selectedYear, selectedMonth, selectedTeacher);
  }, [fetchOperations, selectedYear, selectedMonth, selectedTeacher]);

  const hasActiveFilters =
    selectedYear !== 'all' || selectedMonth !== 'all' || selectedTeacher !== 'all';

  const handleResetFilters = () => {
    setSelectedYear('all');
    setSelectedMonth('all');
    setSelectedTeacher('all');
  };

  const rows: OperationsRow[] = data?.rows || [];
  const kpis = data?.kpis;
  const yearOptions = data?.filterOptions?.years || [];
  const teacherOptions = data?.filterOptions?.teachers || [];

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
              Platform Operations Dashboard
            </h2>
            <p className="text-xs text-slate-600 mt-0.5">
              Operação mensal por Native Friend — competência de compra e realização de aulas · Firestore (default)
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => fetchOperations(selectedYear, selectedMonth, selectedTeacher)}
          disabled={loading}
          className="inline-flex items-center justify-center gap-2 px-3.5 py-2 rounded-xl bg-white hover:bg-slate-50 border border-slate-300 text-[#000035] font-bold text-xs transition cursor-pointer disabled:opacity-60 whitespace-nowrap shrink-0 self-start sm:self-auto"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>{loading ? 'Atualizando...' : 'Atualizar'}</span>
        </button>
      </div>

      {/* Filters Toolbar */}
      <div className="px-5 py-3.5 sm:px-6 border-b border-slate-200 bg-white flex flex-col lg:flex-row lg:items-end justify-between gap-3">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 flex-1">
          <div className="flex flex-col gap-1">
            <label
              htmlFor="ops-filter-year"
              className="text-[11px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5"
            >
              <Filter className="w-3 h-3 text-[#1C4C96]" />
              <span>Ano</span>
            </label>
            <select
              id="ops-filter-year"
              value={selectedYear}
              onChange={(e) => setSelectedYear(e.target.value)}
              className="h-9 px-3 rounded-xl border border-slate-300 bg-white text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#1C4C96]/25 focus:border-[#1C4C96]"
            >
              <option value="all">Todos os anos</option>
              {yearOptions.map((yr) => (
                <option key={yr} value={String(yr)}>
                  {yr}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label
              htmlFor="ops-filter-month"
              className="text-[11px] font-bold uppercase tracking-wider text-slate-500"
            >
              Mês
            </label>
            <select
              id="ops-filter-month"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="h-9 px-3 rounded-xl border border-slate-300 bg-white text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#1C4C96]/25 focus:border-[#1C4C96]"
            >
              <option value="all">Todos os meses</option>
              {MONTH_OPTIONS.map((m) => (
                <option key={m.value} value={String(m.value)}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label
              htmlFor="ops-filter-teacher"
              className="text-[11px] font-bold uppercase tracking-wider text-slate-500"
            >
              Native Friend
            </label>
            <select
              id="ops-filter-teacher"
              value={selectedTeacher}
              onChange={(e) => setSelectedTeacher(e.target.value)}
              className="h-9 px-3 rounded-xl border border-slate-300 bg-white text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#1C4C96]/25 focus:border-[#1C4C96]"
            >
              <option value="all">Todos os Native Friends</option>
              {teacherOptions.map((t) => (
                <option key={t.teacherKey} value={t.teacherKey}>
                  {t.name}
                  {t.country ? ` (${t.country})` : ''}
                </option>
              ))}
            </select>
          </div>
        </div>

        {hasActiveFilters && (
          <button
            type="button"
            onClick={handleResetFilters}
            className="inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-xl border border-slate-300 bg-slate-50 hover:bg-slate-100 text-xs font-bold text-slate-700 transition cursor-pointer whitespace-nowrap shrink-0"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Limpar filtros</span>
          </button>
        )}
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
            onClick={() => fetchOperations(selectedYear, selectedMonth, selectedTeacher)}
            className="px-3 py-1.5 rounded-lg bg-white border border-rose-300 text-rose-800 text-xs font-bold hover:bg-rose-50 transition cursor-pointer whitespace-nowrap shrink-0"
          >
            Tentar novamente
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
                Alunos
              </span>
              <span
                data-testid="kpi-alunos"
                className="mt-1 block text-xl font-extrabold text-[#000035] font-mono tabular-nums"
              >
                {kpis ? formatInteger(kpis.alunosCount) : 'N/D'}
              </span>
              <span className="mt-0.5 block text-[11px] text-slate-500">
                Distintos no recorte
              </span>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-3.5">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 block">
                Aulas Contratadas
              </span>
              <span
                data-testid="kpi-contratadas"
                className="mt-1 block text-xl font-extrabold text-[#000035] font-mono tabular-nums"
              >
                {kpis ? formatInteger(kpis.aulasContratadas) : 'N/D'}
              </span>
              <span className="mt-0.5 block text-[11px] text-slate-500 tabular-nums">
                {kpis && kpis.adminGrantedLessons !== 0
                  ? `${formatInteger(kpis.paidContractedLessons)} pagas · ${formatInteger(kpis.adminGrantedLessons)} admin`
                  : 'Competência de compra'}
              </span>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-3.5">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 block">
                Atendidas
              </span>
              <span
                data-testid="kpi-atendidas"
                className="mt-1 block text-xl font-extrabold text-[#1C4C96] font-mono tabular-nums"
              >
                {kpis ? formatInteger(kpis.atendidas) : 'N/D'}
              </span>
              <span className="mt-0.5 block text-[11px] text-slate-500">
                Realizadas (não-trial)
              </span>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-3.5">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 block">
                Saldo
              </span>
              <span
                data-testid="kpi-saldo"
                className={`mt-1 block text-xl font-extrabold font-mono tabular-nums ${
                  kpis && kpis.saldo < 0 ? 'text-amber-700' : 'text-[#000035]'
                }`}
              >
                {kpis ? formatInteger(kpis.saldo) : 'N/D'}
              </span>
              <span className="mt-0.5 block text-[11px] text-slate-500">
                Contratadas − Atendidas
              </span>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-3.5">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 block">
                Faturamento
              </span>
              <span
                data-testid="kpi-faturamento"
                className="mt-1 block text-xl font-extrabold text-emerald-700 font-mono tabular-nums"
              >
                {kpis ? formatBrlOrNd(kpis.faturamentoBrl) : 'N/D'}
              </span>
              <span className="mt-0.5 block text-[11px] text-slate-500">
                Apenas compras pagas
              </span>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-3.5">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 block">
                Lucro
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
                {kpis ? formatBrlOrNd(kpis.lucroBrl) : 'N/D'}
              </span>
              <span className="mt-0.5 block text-[11px] text-slate-500 tabular-nums">
                {kpis && kpis.lucroBrl === null && kpis.grossPlatformShareBrl !== null
                  ? `Plat. FIN.2D: ${formatBrlOrNd(kpis.grossPlatformShareBrl)} · Custo plat. N/D`
                  : kpis && kpis.lucroBrl !== null
                  ? 'Faturamento − Custos'
                  : 'Sem custo plataforma registrado'}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Operations Monthly Table with Horizontal Scroll */}
      <div className="p-5 sm:p-6">
        {loading && !data ? (
          <div className="h-44 rounded-2xl border border-slate-200 bg-slate-50 animate-pulse" />
        ) : rows.length === 0 ? (
          <div className="py-12 px-4 text-center rounded-2xl border border-slate-200 bg-slate-50/50">
            <p className="text-sm font-bold text-[#000035]">
              Nenhum registro operacional encontrado para os filtros selecionados.
            </p>
            <p className="text-xs text-slate-500 mt-1">
              Os dados são consolidados diretamente do Firestore (default) sem registros simulados.
            </p>
            {hasActiveFilters && (
              <button
                type="button"
                onClick={handleResetFilters}
                className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#000035] hover:bg-[#062863] text-white text-xs font-bold transition cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Limpar filtros</span>
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="overflow-x-auto rounded-2xl border border-slate-200">
              <table className="w-full min-w-[1280px] border-collapse text-xs">
                <thead>
                  <tr className="bg-[#000035] text-white text-[11px] font-bold uppercase tracking-wider">
                    <th className="py-3 px-3 text-left whitespace-nowrap">Ano</th>
                    <th className="py-3 px-3 text-left whitespace-nowrap">Mês</th>
                    <th className="py-3 px-3 text-left whitespace-nowrap">País</th>
                    <th className="py-3 px-3 text-left whitespace-nowrap">Native Friend</th>
                    <th className="py-3 px-3 text-right whitespace-nowrap">Nº Alunos</th>
                    <th className="py-3 px-3 text-right whitespace-nowrap">Aulas Contratadas</th>
                    <th className="py-3 px-3 text-right whitespace-nowrap">Atendidas</th>
                    <th className="py-3 px-3 text-right whitespace-nowrap">Saldo</th>
                    <th className="py-3 px-3 text-right whitespace-nowrap">Aula USD</th>
                    <th className="py-3 px-3 text-right whitespace-nowrap">Comissão MARKUP</th>
                    <th className="py-3 px-3 text-right whitespace-nowrap">Aula BRL</th>
                    <th className="py-3 px-3 text-right whitespace-nowrap">Faturamento</th>
                    <th className="py-3 px-3 text-right whitespace-nowrap">Custo Plataforma</th>
                    <th className="py-3 px-3 text-right whitespace-nowrap">Custo Native Friend</th>
                    <th className="py-3 px-3 text-right whitespace-nowrap">Lucro</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 bg-white">
                  {rows.map((row) => (
                    <tr
                      key={row.rowKey}
                      className="hover:bg-[#FAFCFF] transition-colors"
                    >
                      <td className="py-3 px-3 text-left font-mono tabular-nums font-semibold text-slate-800 whitespace-nowrap">
                        {row.year}
                      </td>
                      <td className="py-3 px-3 text-left font-medium text-slate-700 whitespace-nowrap">
                        {getMonthLabel(row.month)}
                      </td>
                      <td className="py-3 px-3 text-left whitespace-nowrap">
                        {row.country ? (
                          <span className="text-slate-700 font-medium">{row.country}</span>
                        ) : (
                          <span className="text-slate-400">N/D</span>
                        )}
                      </td>
                      <td className="py-3 px-3 text-left whitespace-nowrap">
                        <div className="font-bold text-[#000035]">{row.nativeFriendName}</div>
                        {row.nativeFriendEmail && (
                          <div className="text-[11px] text-slate-500 font-normal">
                            {row.nativeFriendEmail}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-800 whitespace-nowrap">
                        {formatInteger(row.studentsCount)}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-900 font-semibold whitespace-nowrap">
                        <div>{formatInteger(row.aulasContratadas)}</div>
                        {row.adminGrantedLessons !== 0 && (
                          <div className="text-[10px] font-sans font-normal text-slate-500">
                            {formatInteger(row.paidContractedLessons)}p / {formatInteger(row.adminGrantedLessons)} adm
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums text-[#1C4C96] font-semibold whitespace-nowrap">
                        {formatInteger(row.atendidas)}
                      </td>
                      <td
                        className={`py-3 px-3 text-right font-mono tabular-nums font-semibold whitespace-nowrap ${
                          row.saldo < 0 ? 'text-amber-700' : 'text-slate-900'
                        }`}
                      >
                        {formatInteger(row.saldo)}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                        {renderValueOrNd(formatUsdOrNd(row.aulaUsd), 'text-slate-800')}
                        {row.hasMixedPricingSnapshots && row.aulaUsd !== null ? (
                          <span className="text-slate-400 ml-0.5">*</span>
                        ) : null}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                        {renderValueOrNd(formatMarkupOrNd(row.comissaoMarkupPercent), 'text-slate-800')}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                        {renderValueOrNd(formatBrlOrNd(row.aulaBrl), 'text-slate-800')}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                        {renderValueOrNd(formatBrlOrNd(row.faturamentoBrl), 'text-emerald-700 font-bold')}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                        {renderValueOrNd(formatBrlOrNd(row.custoPlataformaBrl), 'text-slate-800')}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                        {renderValueOrNd(formatBrlOrNd(row.custoNativeFriendBrl), 'text-slate-800')}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                        {renderValueOrNd(
                          formatBrlOrNd(row.lucroBrl),
                          row.lucroBrl !== null && row.lucroBrl < 0
                            ? 'text-rose-700 font-bold'
                            : 'text-emerald-700 font-bold'
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                {kpis && (
                  <tfoot>
                    <tr className="bg-slate-50 border-t-2 border-slate-200 font-bold text-slate-900">
                      <td className="py-3 px-3 text-left whitespace-nowrap" colSpan={4}>
                        Totais do recorte ({rows.length} {rows.length === 1 ? 'linha' : 'linhas'})
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-600 whitespace-nowrap">
                        {formatInteger(kpis.alunosCount)}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                        {formatInteger(kpis.aulasContratadas)}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums text-[#1C4C96] whitespace-nowrap">
                        {formatInteger(kpis.atendidas)}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                        {formatInteger(kpis.saldo)}
                      </td>
                      <td className="py-3 px-3 text-right text-slate-400 whitespace-nowrap">—</td>
                      <td className="py-3 px-3 text-right text-slate-400 whitespace-nowrap">—</td>
                      <td className="py-3 px-3 text-right text-slate-400 whitespace-nowrap">—</td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums text-emerald-700 whitespace-nowrap">
                        {formatBrlOrNd(kpis.faturamentoBrl)}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                        {renderValueOrNd(formatBrlOrNd(kpis.custoPlataformaBrl))}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                        {renderValueOrNd(formatBrlOrNd(kpis.custoNativeFriendBrl))}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                        {renderValueOrNd(
                          formatBrlOrNd(kpis.lucroBrl),
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
              <span>
                Valores históricos preservam os snapshots FIN.2B/2C/2D de PTAX e comissão MARKUP gravados em cada transação. Concessões administrativas não são somadas ao faturamento.
              </span>
              {hasMixedSnapshotsInRows && (
                <span className="shrink-0">
                  * Média ponderada pelos pacotes históricos do mês.
                </span>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
};

export default AdminOperationsDashboard;
