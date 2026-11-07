/**
 * IT'S SIMPLE — FASE FIN.2A.2C
 * Serviço Cambial PTAX D-1 Oficial do Banco Central do Brasil
 *
 * Módulo backend isolado, seguro e determinístico para consulta e cache
 * da cotação oficial PTAX de venda (USD/BRL).
 *
 * Regras Comerciais:
 * 1. Fonte oficial: API PTAX do Banco Central do Brasil (BACEN / Olinda OData).
 * 2. Moeda: USD/BRL.
 * 3. Cotação: cotacaoVenda.
 * 4. Referência: último fechamento PTAX disponível com data estritamente anterior
 *    à data local de precificação em 'America/Sao_Paulo'.
 * 5. Nunca utilizar cotação do próprio dia, mesmo que disponível.
 * 6. Em finais de semana e feriados, buscar o último fechamento anterior disponível.
 * 7. Sem fallback de cotação fictícia (sem taxa fixa 5.5 em produção).
 * 8. Cache persistente no Firestore '(default)', coleção dedicada 'ptax_rates'.
 * 9. Deduplicação de requisições simultâneas em trânsito (single-flight).
 */

import { getFirestoreDb } from './serverFirestore';

export const PTAX_TIMEZONE = 'America/Sao_Paulo';
export const BCB_PTAX_API_ENDPOINT =
  'https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoDolarPeriodo';
export const PTAX_SOURCE_LABEL = 'Banco Central do Brasil - API PTAX Olinda';
export const PTAX_CACHE_COLLECTION = 'ptax_rates';

/**
 * Interface padronizada do resultado da cotação PTAX D-1.
 * Pronta para consumo tipado futuro pelo financialEngine.
 */
export interface PtaxQuoteResult {
  success: boolean;
  /** Cotação oficial de venda (cotacaoVenda do BACEN) */
  ptaxRate?: number;
  /** Cotação oficial de compra (cotacaoCompra do BACEN) */
  cotacaoCompra?: number;
  /** Data oficial do fechamento PTAX (YYYY-MM-DD em America/Sao_Paulo) */
  quoteDate?: string;
  /** Data local da precificação (YYYY-MM-DD em America/Sao_Paulo) */
  pricingDate?: string;
  /** Data e hora exata do registro retornado pelo BACEN */
  dataHoraCotacao?: string;
  /** Tipo de boletim retornado pelo BACEN ('Fechamento', etc.) */
  tipoBoletim?: string;
  /** Identificação da fonte oficial */
  source: string;
  /** Timestamp ISO do momento da consulta */
  queriedAt: string;
  /** Indica se o resultado foi recuperado de cache válido */
  fromCache?: boolean;
  /** Status explícito: SUCCESS, UNAVAILABLE ou ERROR */
  status: 'SUCCESS' | 'UNAVAILABLE' | 'ERROR';
  /** Mensagem resumida de erro quando aplicável */
  error?: string;
  /** Detalhes adicionais do erro */
  details?: string;
}

/**
 * Opções de configuração e injeção de dependência para getPtaxClosingD1.
 */
export interface GetPtaxOptions {
  /** Data base para determinar o dia de precificação (padrão: new Date()) */
  currentDate?: Date;
  /** Data de precificação customizada (YYYY-MM-DD) */
  customPricingDate?: string;
  /** Função de fetch customizada (para testes e isolamento) */
  fetchFn?: typeof fetch;
  /** Instância de Firestore customizada (para testes) */
  firestoreDb?: any;
  /** Pula a verificação e escrita no Firestore (para testes puramente em memória) */
  skipFirestoreCache?: boolean;
  /** Timeout em milissegundos para a chamada HTTP ao BACEN (padrão: 8000ms) */
  timeoutMs?: number;
  /** Força atualização ignorando cache */
  forceRefresh?: boolean;
}

// In-flight request deduplication map (Single-flight)
const inFlightRequests = new Map<string, Promise<PtaxQuoteResult>>();

// In-memory hot cache: pricingDate -> { quote, cachedAt }
const memoryCache = new Map<string, { quote: PtaxQuoteResult; cachedAt: number }>();
const MEMORY_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hora de retenção em memória

/**
 * Limpa o cache em memória (utilizado em testes e manutenções).
 */
export function clearPtaxMemoryCache(): void {
  memoryCache.clear();
  inFlightRequests.clear();
}

/**
 * Retorna a data em formato 'YYYY-MM-DD' segundo o fuso horário 'America/Sao_Paulo'.
 */
export function getSaoPauloDateString(date: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: PTAX_TIMEZONE }).format(date);
}

/**
 * Desloca uma data no formato 'YYYY-MM-DD' por uma quantidade de dias (positiva ou negativa).
 */
export function shiftCalendarDays(isoDate: string, daysDelta: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + daysDelta, 12, 0, 0));
  return dt.toISOString().slice(0, 10);
}

/**
 * Converte data 'YYYY-MM-DD' para o formato exigido pela API Olinda do BACEN: 'MM-DD-YYYY'.
 */
export function toBcbDateFormat(isoDate: string): string {
  const [year, month, day] = isoDate.split('-');
  return `${month}-${day}-${year}`;
}

/**
 * Algoritmo de Butcher/Meeus para cálculo do Domingo de Páscoa de qualquer ano.
 */
function getEasterSunday(year: number): { month: number; day: number } {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
}

/**
 * Retorna o conjunto de feriados bancários nacionais do Brasil para um determinado ano.
 */
function getBrazilianBankHolidays(year: number): Set<string> {
  const holidays = new Set<string>();

  const add = (m: number, d: number) => {
    const mm = String(m).padStart(2, '0');
    const dd = String(d).padStart(2, '0');
    holidays.add(`${year}-${mm}-${dd}`);
  };

  // Feriados fixos nacionais
  add(1, 1); // Ano Novo
  add(4, 21); // Tiradentes
  add(5, 1); // Dia do Trabalho
  add(9, 7); // Independência
  add(10, 12); // Nossa Senhora Aparecida
  add(11, 2); // Finados
  add(11, 15); // Proclamação da República
  add(11, 20); // Consciência Negra (Lei 14.759/2023)
  add(12, 25); // Natal
  add(12, 31); // Último dia útil do ano - sem expediente bancário / sem mercado de câmbio (Resolução CMN 4.880/2020)

  // Feriados móveis derivados da Páscoa
  const easter = getEasterSunday(year);
  const easterUtc = new Date(Date.UTC(year, easter.month - 1, easter.day, 12, 0, 0));

  const addOffset = (days: number) => {
    const dt = new Date(easterUtc.getTime() + days * 86400000);
    holidays.add(dt.toISOString().slice(0, 10));
  };

  addOffset(-48); // Segunda-feira de Carnaval
  addOffset(-47); // Terça-feira de Carnaval
  addOffset(-2); // Sexta-feira da Paixão
  addOffset(60); // Corpus Christi

  return holidays;
}

/**
 * Determina se o tipo de boletim corresponde a um fechamento oficial do BACEN.
 *
 * Regras:
 * - Se tipoBoletim for omitido/undefined/null: aceito (ex: endpoint CotacaoDolarPeriodo do BACEN
 *   que por especificação OData TipoCotacaoDolar só emite a cotação oficial diária de fechamento).
 * - Se fornecido como string:
 *   - Deve conter 'fechamento' (case-insensitive, ex: 'Fechamento', 'Fechamento PTAX').
 *   - Rejeita explicitamente 'Abertura', 'Intermediário', '1º boletim', etc.
 */
export function isOfficialClosingBulletin(tipoBoletim?: unknown): boolean {
  if (tipoBoletim === undefined || tipoBoletim === null) {
    return true;
  }
  if (typeof tipoBoletim !== 'string') {
    return false;
  }
  const normalized = tipoBoletim.trim().toLowerCase();
  if (
    normalized.includes('abertura') ||
    normalized.includes('intermedi') ||
    normalized.includes('1º') ||
    normalized.includes('2º') ||
    normalized.includes('3º')
  ) {
    return false;
  }
  return normalized.includes('fechamento');
}

/**
 * Determina se uma data 'YYYY-MM-DD' é um dia útil bancário no Brasil.
 */
export function isBusinessDay(isoDate: string): boolean {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const dayOfWeek = dt.getUTCDay();

  // Finais de semana: 0 = Domingo, 6 = Sábado
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    return false;
  }

  // Feriados nacionais bancários
  const holidays = getBrazilianBankHolidays(y);
  if (holidays.has(isoDate)) {
    return false;
  }

  return true;
}

/**
 * Calcula a data de referência oficial D-1 esperada para uma determinada data de precificação.
 * Representa o último dia útil estritamente anterior à data de precificação.
 */
export function getExpectedReferenceDate(pricingDate: string): string {
  let candidate = shiftCalendarDays(pricingDate, -1);
  let guard = 0;
  while (!isBusinessDay(candidate) && guard < 14) {
    candidate = shiftCalendarDays(candidate, -1);
    guard++;
  }
  return candidate;
}

/**
 * Valida a cotação retornada pelo BACEN.
 */
function isValidPtaxNumber(val: unknown): val is number {
  return typeof val === 'number' && Number.isFinite(val) && val > 0 && !Number.isNaN(val);
}

/**
 * Obtém a cotação oficial PTAX D-1 de venda (USD/BRL) do Banco Central do Brasil.
 *
 * Fluxo:
 * 1. Calcula a data local de precificação em America/Sao_Paulo.
 * 2. Determina a data esperada do último fechamento anterior (D-1).
 * 3. Consulta cache em memória e cache persistente no Firestore '(default)'.
 * 4. Se o cache for válido para a referência, retorna com fromCache: true.
 * 5. Se o cache for inexistente ou desatualizado, consulta a API oficial do BACEN com single-flight.
 * 6. Valida os dados, descarta qualquer dado do mesmo dia (Regra 5), e persiste no Firestore.
 */
export async function getPtaxClosingD1(options: GetPtaxOptions = {}): Promise<PtaxQuoteResult> {
  const pricingDate =
    options.customPricingDate ||
    getSaoPauloDateString(options.currentDate || new Date());

  const expectedRefDate = getExpectedReferenceDate(pricingDate);
  const nowIso = new Date().toISOString();

  // 1. Verificação de Cache em Memória (se não houver forceRefresh)
  if (!options.forceRefresh) {
    const memEntry = memoryCache.get(pricingDate);
    if (memEntry && Date.now() - memEntry.cachedAt < MEMORY_CACHE_TTL_MS) {
      const q = memEntry.quote;
      if (
        q.success &&
        q.quoteDate &&
        q.quoteDate === expectedRefDate &&
        q.quoteDate < pricingDate &&
        isValidPtaxNumber(q.ptaxRate) &&
        isOfficialClosingBulletin(q.tipoBoletim)
      ) {
        return {
          ...q,
          fromCache: true,
        };
      }
    }
  }

  // 2. Verificação de Cache Persistente no Firestore '(default)'
  if (!options.forceRefresh && !options.skipFirestoreCache) {
    try {
      const db = options.firestoreDb || getFirestoreDb();
      if (db) {
        const docRef = db.collection(PTAX_CACHE_COLLECTION).doc(expectedRefDate);
        const docSnap = await docRef.get();
        if (docSnap.exists) {
          const data = docSnap.data() || {};
          if (
            isValidPtaxNumber(data.cotacaoVenda) &&
            data.quoteDate === expectedRefDate &&
            data.quoteDate < pricingDate &&
            typeof data.dataHoraCotacao === 'string' &&
            data.dataHoraCotacao.slice(0, 10) === data.quoteDate &&
            isOfficialClosingBulletin(data.tipoBoletim)
          ) {
            const cachedResult: PtaxQuoteResult = {
              success: true,
              ptaxRate: Number(data.cotacaoVenda),
              cotacaoCompra: isValidPtaxNumber(data.cotacaoCompra) ? Number(data.cotacaoCompra) : undefined,
              quoteDate: data.quoteDate,
              pricingDate,
              dataHoraCotacao: data.dataHoraCotacao,
              tipoBoletim: typeof data.tipoBoletim === 'string' ? data.tipoBoletim : 'Fechamento',
              source: data.source || PTAX_SOURCE_LABEL,
              queriedAt: data.queriedAt || nowIso,
              fromCache: true,
              status: 'SUCCESS',
            };

            memoryCache.set(pricingDate, { quote: cachedResult, cachedAt: Date.now() });
            return cachedResult;
          }
        }
      }
    } catch (fsErr) {
      console.warn('[serverPtax] Aviso: Falha ao ler cache do Firestore, consultando BACEN:', fsErr);
    }
  }

  // 3. Deduplicação Concorrente (Single-flight)
  // Se já existe uma requisição em andamento para a mesma data de precificação, reutiliza a Promise.
  const inflightKey = `${pricingDate}:${options.forceRefresh ? 'force' : 'std'}`;
  if (inFlightRequests.has(inflightKey)) {
    return inFlightRequests.get(inflightKey)!;
  }

  const queryPromise = (async (): Promise<PtaxQuoteResult> => {
    // Definir período de busca no BACEN:
    // Do dia (pricingDate - 10 dias) até o dia (pricingDate - 1 dia).
    // Garante recuperação do último fechamento mesmo após finais de semana prolongados ou feriados.
    const maxAllowedDate = shiftCalendarDays(pricingDate, -1);
    const startDate = shiftCalendarDays(pricingDate, -10);

    const bcbStart = toBcbDateFormat(startDate);
    const bcbEnd = toBcbDateFormat(maxAllowedDate);

    const url =
      `${BCB_PTAX_API_ENDPOINT}(dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)?` +
      `@dataInicial='${bcbStart}'&@dataFinalCotacao='${bcbEnd}'&$top=100&$orderby=dataHoraCotacao%20desc&$format=json`;

    const effectiveFetch = options.fetchFn || globalThis.fetch;
    const timeoutMs = options.timeoutMs || 8000;

    let response: Response;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      response = await effectiveFetch(url, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
    } catch (netErr: any) {
      clearTimeout(timeoutId);
      const isAbort = netErr?.name === 'AbortError' || netErr?.message?.includes('aborted');
      console.error('[serverPtax] Erro de rede ao consultar API PTAX do BACEN:', netErr);
      return {
        success: false,
        source: PTAX_SOURCE_LABEL,
        queriedAt: nowIso,
        status: 'ERROR',
        error: isAbort ? 'TIMEOUT_BACEN_API' : 'REDE_BACEN_API_INDISPONIVEL',
        details: isAbort
          ? `Tempo limite de ${timeoutMs}ms esgotado ao aguardar resposta do Banco Central.`
          : netErr?.message || String(netErr),
      };
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      return {
        success: false,
        source: PTAX_SOURCE_LABEL,
        queriedAt: nowIso,
        status: 'ERROR',
        error: `HTTP_${response.status}_BACEN_API`,
        details: `API PTAX do Banco Central retornou status HTTP ${response.status}.`,
      };
    }

    let payload: any;
    try {
      payload = await response.json();
    } catch (parseErr: any) {
      return {
        success: false,
        source: PTAX_SOURCE_LABEL,
        queriedAt: nowIso,
        status: 'ERROR',
        error: 'RESPOSTA_BACEN_INVALIDA',
        details: 'Falha ao interpretar resposta JSON da API PTAX do BACEN.',
      };
    }

    const items = Array.isArray(payload?.value) ? payload.value : [];
    if (items.length === 0) {
      return {
        success: false,
        source: PTAX_SOURCE_LABEL,
        queriedAt: nowIso,
        status: 'UNAVAILABLE',
        error: 'COTACAO_NAO_DISPONIVEL',
        details: `Nenhum registro de fechamento retornado pelo BACEN para o período ${startDate} a ${maxAllowedDate}.`,
      };
    }

    // Filtrar cotações:
    // Regra 1: Rejeitar cotações intermediárias ou de abertura (apenas fechamento oficial).
    // Regra 5: NUNCA aceitar cotação com data igual ou posterior à data de precificação.
    // Filtrar cotações inválidas (não numéricas, negativas ou zero, ou dataHoraCotacao malformada).
    const validQuotes = items.filter((it: any) => {
      if (!it || typeof it.dataHoraCotacao !== 'string') return false;
      if (!/^\d{4}-\d{2}-\d{2}/.test(it.dataHoraCotacao)) return false;

      const quoteDateStr = it.dataHoraCotacao.slice(0, 10);

      // Invariante estrita: a data da cotação DEVE ser estritamente anterior à data de precificação em America/Sao_Paulo
      if (quoteDateStr >= pricingDate) {
        return false;
      }

      // Validação de tipo de boletim: não aceitar boletins intermediários ou abertura
      if (!isOfficialClosingBulletin(it.tipoBoletim)) {
        return false;
      }

      // Validação numérica estrita
      if (!isValidPtaxNumber(it.cotacaoVenda)) {
        return false;
      }

      return true;
    });

    if (validQuotes.length === 0) {
      return {
        success: false,
        source: PTAX_SOURCE_LABEL,
        queriedAt: nowIso,
        status: 'UNAVAILABLE',
        error: 'SEM_FECHAMENTO_ANTERIOR_VALIDO',
        details: `Os registros retornados pelo BACEN não continham fechamento anterior válido para a data ${pricingDate}.`,
      };
    }

    // Ordenar deterministicamente para não depender exclusivamente da ordenação da API externa:
    // 1) Data da cotação desc (YYYY-MM-DD)
    // 2) Horário da cotação desc (dataHoraCotacao)
    validQuotes.sort((a: any, b: any) => {
      const dateA = a.dataHoraCotacao.slice(0, 10);
      const dateB = b.dataHoraCotacao.slice(0, 10);
      if (dateB !== dateA) {
        return dateB.localeCompare(dateA);
      }
      const timeA = new Date(a.dataHoraCotacao.replace(' ', 'T')).getTime() || 0;
      const timeB = new Date(b.dataHoraCotacao.replace(' ', 'T')).getTime() || 0;
      if (timeB !== timeA) {
        return timeB - timeA;
      }
      return String(b.dataHoraCotacao).localeCompare(String(a.dataHoraCotacao));
    });

    const chosen = validQuotes[0];
    const chosenQuoteDate = chosen.dataHoraCotacao.slice(0, 10);
    const chosenVenda = Number(chosen.cotacaoVenda);
    const chosenCompra = isValidPtaxNumber(chosen.cotacaoCompra) ? Number(chosen.cotacaoCompra) : undefined;
    const chosenTipoBoletim = typeof chosen.tipoBoletim === 'string' ? chosen.tipoBoletim : 'Fechamento';

    const finalResult: PtaxQuoteResult = {
      success: true,
      ptaxRate: chosenVenda,
      cotacaoCompra: chosenCompra,
      quoteDate: chosenQuoteDate,
      pricingDate,
      dataHoraCotacao: chosen.dataHoraCotacao,
      tipoBoletim: chosenTipoBoletim,
      source: PTAX_SOURCE_LABEL,
      queriedAt: nowIso,
      fromCache: false,
      status: 'SUCCESS',
    };

    // 4. Salvar no Firestore '(default)' — gravação cirúrgica apenas na coleção de cache oficial
    if (!options.skipFirestoreCache) {
      try {
        const db = options.firestoreDb || getFirestoreDb();
        if (db) {
          const docRef = db.collection(PTAX_CACHE_COLLECTION).doc(chosenQuoteDate);
          await docRef.set(
            {
              quoteDate: chosenQuoteDate,
              cotacaoVenda: chosenVenda,
              cotacaoCompra: chosenCompra || null,
              dataHoraCotacao: chosen.dataHoraCotacao,
              tipoBoletim: chosenTipoBoletim,
              source: PTAX_SOURCE_LABEL,
              queriedAt: nowIso,
              updatedAt: nowIso,
            },
            { merge: true }
          );
        }
      } catch (saveErr) {
        console.warn('[serverPtax] Aviso: Falha ao persistir cotação no Firestore:', saveErr);
      }
    }

    // 5. Salvar no Cache de Memória
    memoryCache.set(pricingDate, { quote: finalResult, cachedAt: Date.now() });

    return finalResult;
  })();

  inFlightRequests.set(inflightKey, queryPromise);

  try {
    return await queryPromise;
  } finally {
    inFlightRequests.delete(inflightKey);
  }
}
