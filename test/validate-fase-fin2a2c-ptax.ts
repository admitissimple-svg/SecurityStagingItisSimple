/**
 * TEST SUITE: IT'S SIMPLE — FASE FIN.2A.2C
 * Serviço Cambial PTAX D-1 — Implementação Isolada
 *
 * 12 Testes Obrigatórios:
 * 1. Dia útil com fechamento anterior disponível.
 * 2. Segunda-feira após fim de semana.
 * 3. Dia seguinte a feriado.
 * 4. Cotação do próprio dia rejeitada.
 * 5. API indisponível (falha de rede / timeout).
 * 6. Resposta vazia da API.
 * 7. Cotação inválida, negativa ou não numérica.
 * 8. Cache válido (retorno com fromCache: true sem chamada externa).
 * 9. Cache desatualizado (rejeição de cache antigo e consulta atualizada).
 * 10. Concorrência de consultas (single-flight deduplication).
 * 11. Fuso horário de São Paulo (America/Sao_Paulo).
 * 12. Regressão do motor financeiro e da proteção de compras.
 */

process.env.NODE_ENV = 'test';
process.env.FIREBASE_PROJECT_ID = 'itissimple-security-staging';
process.env.FIREBASE_DATABASE_ID = '(default)';

import {
  getPtaxClosingD1,
  getSaoPauloDateString,
  getExpectedReferenceDate,
  isBusinessDay,
  shiftCalendarDays,
  toBcbDateFormat,
  clearPtaxMemoryCache,
  BCB_PTAX_API_ENDPOINT,
  PTAX_TIMEZONE,
  PTAX_CACHE_COLLECTION,
} from '../src/serverPtax';

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    console.log(`  ✅ PASS: ${testName}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${testName} ${detail ? `(${detail})` : ''}`);
    failed++;
  }
}

// Mock Response Helper
function createMockApiResponse(status: number, body: any): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

// Mock Firestore Db Helper for cache tests
function createMockFirestoreDb(initialData: Record<string, any> = {}) {
  const store = new Map<string, any>(Object.entries(initialData));
  return {
    collection: (collName: string) => ({
      doc: (docId: string) => ({
        get: async () => ({
          exists: store.has(docId),
          data: () => store.get(docId),
        }),
        set: async (data: any, options?: { merge?: boolean }) => {
          if (options?.merge && store.has(docId)) {
            store.set(docId, { ...store.get(docId), ...data });
          } else {
            store.set(docId, data);
          }
        },
      }),
    }),
    _getStore: () => store,
  };
}

async function runTests() {
  console.log('=========================================================================');
  console.log(" TEST SUITE: FASE FIN.2A.2C — SERVIÇO CAMBIAL PTAX D-1 (BACEN)");
  console.log(" Projeto: itissimple-security-staging");
  console.log('=========================================================================\n');

  // ---------------------------------------------------------------------------
  // TESTE 1: Dia útil com fechamento anterior disponível
  // ---------------------------------------------------------------------------
  console.log('--- Teste 1: Dia útil com fechamento anterior disponível ---');
  {
    clearPtaxMemoryCache();
    // Cenário: Quinta-feira 07/11/2024. Dia anterior D-1 útil: Quarta-feira 06/11/2024.
    const customPricingDate = '2024-11-07';
    const tracker = { fetchCalled: false };

    const mockFetch: typeof fetch = async (url: string | URL | Request) => {
      tracker.fetchCalled = true;
      assert(String(url).includes('CotacaoDolarPeriodo'), 'URL consulta endpoint oficial CotacaoDolarPeriodo');
      return createMockApiResponse(200, {
        value: [
          {
            cotacaoCompra: 5.6740,
            cotacaoVenda: 5.6746,
            dataHoraCotacao: '2024-11-06 13:05:10.123',
          },
          {
            cotacaoCompra: 5.7480,
            cotacaoVenda: 5.7486,
            dataHoraCotacao: '2024-11-05 13:01:22.456',
          },
        ],
      });
    };

    const result = await getPtaxClosingD1({
      customPricingDate,
      fetchFn: mockFetch,
      skipFirestoreCache: true,
    });

    assert(result.success === true, 'Consulta de dia útil bem-sucedida');
    assert(result.status === 'SUCCESS', 'Status é SUCCESS');
    assert(result.quoteDate === '2024-11-06', 'Data da cotação é estritamente D-1 (2024-11-06)');
    assert(result.ptaxRate === 5.6746, 'Cotação de venda reflete o valor oficial (5.6746)');
    assert(result.fromCache === false, 'Primeira consulta indica fromCache: false');
    assert(tracker.fetchCalled === true, 'API externa do BACEN foi consultada');
  }

  // ---------------------------------------------------------------------------
  // TESTE 2: Segunda-feira após fim de semana
  // ---------------------------------------------------------------------------
  console.log('\n--- Teste 2: Segunda-feira após fim de semana ---');
  {
    clearPtaxMemoryCache();
    // Cenário: Segunda-feira 04/11/2024. Sábado (02/11) e Domingo (03/11) sem cotação.
    // Fechamento esperado: Sexta-feira 01/11/2024.
    const customPricingDate = '2024-11-04';
    const expectedRef = getExpectedReferenceDate(customPricingDate);
    assert(expectedRef === '2024-11-01', 'getExpectedReferenceDate calcula Sexta-feira 01/11/2024 para Segunda-feira');

    const mockFetch: typeof fetch = async () => {
      return createMockApiResponse(200, {
        value: [
          {
            cotacaoCompra: 5.8690,
            cotacaoVenda: 5.8696,
            dataHoraCotacao: '2024-11-01 13:04:12.789',
          },
          {
            cotacaoCompra: 5.7640,
            cotacaoVenda: 5.7646,
            dataHoraCotacao: '2024-10-31 13:02:11.111',
          },
        ],
      });
    };

    const result = await getPtaxClosingD1({
      customPricingDate,
      fetchFn: mockFetch,
      skipFirestoreCache: true,
    });

    assert(result.success === true, 'Segunda-feira recupera PTAX com sucesso');
    assert(result.quoteDate === '2024-11-01', 'Cotação vinculada à Sexta-feira anterior (01/11/2024)');
    assert(result.ptaxRate === 5.8696, 'Taxa de venda da Sexta-feira preservada');
  }

  // ---------------------------------------------------------------------------
  // TESTE 3: Dia seguinte a feriado
  // ---------------------------------------------------------------------------
  console.log('\n--- Teste 3: Dia seguinte a feriado ---');
  {
    clearPtaxMemoryCache();
    // Cenário: Quinta-feira 02/05/2024. 01/05/2024 foi Quarta-feira (Dia do Trabalho - feriado).
    // Último fechamento útil: Terça-feira 30/04/2024.
    const customPricingDate = '2024-05-02';
    assert(!isBusinessDay('2024-05-01'), '01/05/2024 é identificado como feriado bancário (Dia do Trabalho)');
    const expectedRef = getExpectedReferenceDate(customPricingDate);
    assert(expectedRef === '2024-04-30', 'Data esperada após 01/05 é 30/04/2024');

    const mockFetch: typeof fetch = async () => {
      return createMockApiResponse(200, {
        value: [
          {
            cotacaoCompra: 5.1880,
            cotacaoVenda: 5.1886,
            dataHoraCotacao: '2024-04-30 13:06:55.321',
          },
        ],
      });
    };

    const result = await getPtaxClosingD1({
      customPricingDate,
      fetchFn: mockFetch,
      skipFirestoreCache: true,
    });

    assert(result.success === true, 'Dia seguinte a feriado recupera cotação com sucesso');
    assert(result.quoteDate === '2024-04-30', 'Cotação selecionada é a do último dia útil pré-feriado');
    assert(result.ptaxRate === 5.1886, 'Taxa PTAX do dia útil pré-feriado confirmada');
  }

  // ---------------------------------------------------------------------------
  // TESTE 4: Cotação do próprio dia rejeitada
  // ---------------------------------------------------------------------------
  console.log('\n--- Teste 4: Cotação do próprio dia rejeitada ---');
  {
    clearPtaxMemoryCache();
    // Cenário: Precificação em 06/11/2024. A API do BACEN já contém cotação de 06/11/2024 e de 05/11/2024.
    // A regra 5 exige estritamente rejeitar 06/11/2024 e selecionar 05/11/2024.
    const customPricingDate = '2024-11-06';

    const mockFetch: typeof fetch = async () => {
      return createMockApiResponse(200, {
        value: [
          {
            cotacaoCompra: 5.9990,
            cotacaoVenda: 5.9999, // Cotação do próprio dia 06/11
            dataHoraCotacao: '2024-11-06 13:02:00.000',
          },
          {
            cotacaoCompra: 5.7480,
            cotacaoVenda: 5.7486, // Cotação de D-1 (05/11)
            dataHoraCotacao: '2024-11-05 13:01:22.456',
          },
        ],
      });
    };

    const result = await getPtaxClosingD1({
      customPricingDate,
      fetchFn: mockFetch,
      skipFirestoreCache: true,
    });

    assert(result.success === true, 'Consulta filtra cotações com sucesso');
    assert(result.quoteDate !== '2024-11-06', 'Cotação do próprio dia 06/11 NÃO foi utilizada');
    assert(result.quoteDate === '2024-11-05', 'Cotação selecionada é estritamente a de D-1 (05/11/2024)');
    assert(result.ptaxRate === 5.7486, 'Taxa de venda é a de D-1 (5.7486), rejeitando o 5.9999 do dia corrente');

    // Cenário B: API do BACEN retorna APENAS cotação do próprio dia (sem fechamento anterior no payload)
    const mockFetchSameDayOnly: typeof fetch = async () => {
      return createMockApiResponse(200, {
        value: [
          {
            cotacaoCompra: 5.9990,
            cotacaoVenda: 5.9999,
            dataHoraCotacao: '2024-11-06 13:02:00.000',
          },
        ],
      });
    };

    const resultOnlySameDay = await getPtaxClosingD1({
      customPricingDate,
      fetchFn: mockFetchSameDayOnly,
      skipFirestoreCache: true,
      forceRefresh: true,
    });

    assert(resultOnlySameDay.success === false, 'Quando só há cotação do próprio dia, a requisição falha com segurança');
    assert(resultOnlySameDay.status === 'UNAVAILABLE', 'Status é UNAVAILABLE quando só há cotação do mesmo dia');
    assert(resultOnlySameDay.ptaxRate === undefined, 'Nenhum ptaxRate é gerado a partir de cotação do mesmo dia');
  }

  // ---------------------------------------------------------------------------
  // TESTE 5: API indisponível (Erro de rede ou timeout)
  // ---------------------------------------------------------------------------
  console.log('\n--- Teste 5: API indisponível (Erro de rede ou timeout) ---');
  {
    clearPtaxMemoryCache();
    const customPricingDate = '2024-11-07';

    // Simula erro de conexão de rede
    const mockFetchNetworkError: typeof fetch = async () => {
      throw new Error('connect ECONNREFUSED 161.148.170.83:443');
    };

    const resNet = await getPtaxClosingD1({
      customPricingDate,
      fetchFn: mockFetchNetworkError,
      skipFirestoreCache: true,
    });

    assert(resNet.success === false, 'Falha de rede retorna success: false');
    assert(resNet.status === 'ERROR', 'Status retornado é ERROR');
    assert(resNet.error === 'REDE_BACEN_API_INDISPONIVEL', 'Código de erro indica indisponibilidade de rede');
    assert(resNet.ptaxRate === undefined, 'Não gera taxa fictícia (sem taxa 5.5 em produção)');

    // Simula resposta HTTP 503 do BACEN
    const mockFetch503: typeof fetch = async () => {
      return createMockApiResponse(503, { error: 'Serviço temporariamente indisponível' });
    };

    const res503 = await getPtaxClosingD1({
      customPricingDate,
      fetchFn: mockFetch503,
      skipFirestoreCache: true,
      forceRefresh: true,
    });

    assert(res503.success === false, 'HTTP 503 do BACEN retorna success: false');
    assert(res503.status === 'ERROR', 'Status é ERROR');
    assert(res503.error === 'HTTP_503_BACEN_API', 'Código de erro identifica HTTP 503');
  }

  // ---------------------------------------------------------------------------
  // TESTE 6: Resposta vazia da API
  // ---------------------------------------------------------------------------
  console.log('\n--- Teste 6: Resposta vazia da API ---');
  {
    clearPtaxMemoryCache();
    const customPricingDate = '2024-11-07';

    const mockFetchEmpty: typeof fetch = async () => {
      return createMockApiResponse(200, { value: [] });
    };

    const resEmpty = await getPtaxClosingD1({
      customPricingDate,
      fetchFn: mockFetchEmpty,
      skipFirestoreCache: true,
    });

    assert(resEmpty.success === false, 'Resposta vazia retorna success: false');
    assert(resEmpty.status === 'UNAVAILABLE', 'Status retornado é UNAVAILABLE');
    assert(resEmpty.error === 'COTACAO_NAO_DISPONIVEL', 'Código de erro é COTACAO_NAO_DISPONIVEL');
    assert(resEmpty.ptaxRate === undefined, 'Nenhuma taxa arbitrária inventada');
  }

  // ---------------------------------------------------------------------------
  // TESTE 7: Cotação inválida, negativa ou não numérica
  // ---------------------------------------------------------------------------
  console.log('\n--- Teste 7: Cotação inválida, negativa ou não numérica ---');
  {
    clearPtaxMemoryCache();
    const customPricingDate = '2024-11-07';

    const mockFetchInvalid: typeof fetch = async () => {
      return createMockApiResponse(200, {
        value: [
          {
            cotacaoCompra: -5.1234,
            cotacaoVenda: -5.1234, // Negativa
            dataHoraCotacao: '2024-11-06 13:00:00.000',
          },
          {
            cotacaoCompra: 'NaN',
            cotacaoVenda: 'invalid_string', // Não numérica
            dataHoraCotacao: '2024-11-05 13:00:00.000',
          },
          {
            cotacaoCompra: 0,
            cotacaoVenda: 0, // Zero
            dataHoraCotacao: '2024-11-04 13:00:00.000',
          },
        ],
      });
    };

    const resInvalid = await getPtaxClosingD1({
      customPricingDate,
      fetchFn: mockFetchInvalid,
      skipFirestoreCache: true,
    });

    assert(resInvalid.success === false, 'Cotações inválidas são todas rejeitadas');
    assert(resInvalid.status === 'UNAVAILABLE', 'Status final é UNAVAILABLE quando não há cotação válida');
    assert(resInvalid.error === 'SEM_FECHAMENTO_ANTERIOR_VALIDO', 'Erro reporta ausência de fechamento válido');
  }

  // ---------------------------------------------------------------------------
  // TESTE 8: Cache válido (fromCache: true sem chamada externa)
  // ---------------------------------------------------------------------------
  console.log('\n--- Teste 8: Cache válido (fromCache: true sem chamada externa) ---');
  {
    clearPtaxMemoryCache();
    const customPricingDate = '2024-11-07'; // Quinta-feira
    const expectedRef = '2024-11-06'; // Quarta-feira

    const mockDb = createMockFirestoreDb({
      [expectedRef]: {
        quoteDate: expectedRef,
        cotacaoVenda: 5.6746,
        cotacaoCompra: 5.6740,
        dataHoraCotacao: '2024-11-06 13:05:10.123',
        source: 'Banco Central do Brasil - API PTAX Olinda',
        queriedAt: '2024-11-06T18:00:00.000Z',
      },
    });

    let externalApiCalled: boolean = false;
    const mockFetch: typeof fetch = async () => {
      externalApiCalled = true;
      return createMockApiResponse(200, { value: [] });
    };

    const resCached = await getPtaxClosingD1({
      customPricingDate,
      firestoreDb: mockDb,
      fetchFn: mockFetch,
    });

    assert(resCached.success === true, 'Leitura de cache válido retorna sucesso');
    assert(resCached.fromCache === true, 'fromCache sinaliza true');
    assert(resCached.ptaxRate === 5.6746, 'Taxa recuperada do cache com precisão');
    assert(resCached.quoteDate === expectedRef, 'Data da cotação no cache confere com D-1');
    assert(externalApiCalled === false, 'Nenhuma chamada externa efetuada ao BACEN quando há cache válido');
  }

  // ---------------------------------------------------------------------------
  // TESTE 9: Cache desatualizado (rejeição de cotação antiga além da política)
  // ---------------------------------------------------------------------------
  console.log('\n--- Teste 9: Cache desatualizado (rejeição de cotação antiga) ---');
  {
    clearPtaxMemoryCache();
    // Cenário: Precificação em Quinta-feira 07/11/2024 (esperado: 06/11/2024).
    // O banco contém apenas uma cotação antiga de 04/11/2024.
    const customPricingDate = '2024-11-07';

    const mockDb = createMockFirestoreDb({
      '2024-11-04': {
        quoteDate: '2024-11-04',
        cotacaoVenda: 5.7898,
        dataHoraCotacao: '2024-11-04 13:02:46.918',
        source: 'Banco Central do Brasil - API PTAX Olinda',
      },
    });

    const refreshTracker = { called: false };
    const mockFetchRefresh: typeof fetch = async () => {
      refreshTracker.called = true;
      return createMockApiResponse(200, {
        value: [
          {
            cotacaoCompra: 5.6740,
            cotacaoVenda: 5.6746,
            dataHoraCotacao: '2024-11-06 13:05:10.123',
          },
        ],
      });
    };

    const resRefresh = await getPtaxClosingD1({
      customPricingDate,
      firestoreDb: mockDb,
      fetchFn: mockFetchRefresh,
    });

    assert(refreshTracker.called === true, 'Cache antigo (04/11) NÃO foi reutilizado silenciosamente para 07/11');
    assert(resRefresh.success === true, 'Consulta atualizada ao BACEN foi bem-sucedida');
    assert(resRefresh.fromCache === false, 'fromCache indica false após refresh');
    assert(resRefresh.quoteDate === '2024-11-06', 'Data atualizada para o fechamento correto (06/11)');
    assert(resRefresh.ptaxRate === 5.6746, 'Taxa atualizada corretamente para 5.6746');
  }

  // ---------------------------------------------------------------------------
  // TESTE 10: Concorrência de consultas (Single-Flight In-Flight Deduplication)
  // ---------------------------------------------------------------------------
  console.log('\n--- Teste 10: Concorrência de consultas (Single-Flight) ---');
  {
    clearPtaxMemoryCache();
    const customPricingDate = '2024-11-07';
    let concurrentFetchCount = 0;

    const mockConcurrentFetch: typeof fetch = async () => {
      concurrentFetchCount++;
      // Simula latência de rede
      await new Promise((resolve) => setTimeout(resolve, 50));
      return createMockApiResponse(200, {
        value: [
          {
            cotacaoCompra: 5.6740,
            cotacaoVenda: 5.6746,
            dataHoraCotacao: '2024-11-06 13:05:10.123',
          },
        ],
      });
    };

    // Dispara 10 requisições simultâneas para a mesma data de precificação
    const promises = Array.from({ length: 10 }, () =>
      getPtaxClosingD1({
        customPricingDate,
        fetchFn: mockConcurrentFetch,
        skipFirestoreCache: true,
      })
    );

    const results = await Promise.all(promises);

    assert(concurrentFetchCount === 1, 'Exatamente 1 chamada externa efetuada para 10 requisições simultâneas (Single-Flight Deduplication)');
    assert(results.every((r) => r.success === true), 'Todas as 10 requisições resolveram com success: true');
    assert(results.every((r) => r.ptaxRate === 5.6746), 'Todas as 10 requisições obtiveram a mesma taxa de 5.6746');
  }

  // ---------------------------------------------------------------------------
  // TESTE 11: Fuso horário de São Paulo (America/Sao_Paulo)
  // ---------------------------------------------------------------------------
  console.log('\n--- Teste 11: Fuso horário de São Paulo (America/Sao_Paulo) ---');
  {
    assert(PTAX_TIMEZONE === 'America/Sao_Paulo', 'Fuso horário configurado é estritamente America/Sao_Paulo');

    // Horário UTC 01:30 do dia 07/11/2024 -> Em São Paulo (UTC-3) ainda é 22:30 do dia 06/11/2024
    const instant1 = new Date('2024-11-07T01:30:00Z');
    const spDate1 = getSaoPauloDateString(instant1);
    assert(spDate1 === '2024-11-06', '01:30 UTC do dia 07/11 é corretamente avaliado como dia 06/11 em São Paulo');

    // Horário UTC 22:00 do dia 06/11/2024 -> Em São Paulo (UTC-3) é 19:00 do dia 06/11/2024
    const instant2 = new Date('2024-11-06T22:00:00Z');
    const spDate2 = getSaoPauloDateString(instant2);
    assert(spDate2 === '2024-11-06', '22:00 UTC do dia 06/11 é dia 06/11 em São Paulo');

    // Horário UTC 03:01 do dia 07/11/2024 -> Em São Paulo (UTC-3) é 00:01 do dia 07/11/2024
    const instant3 = new Date('2024-11-07T03:01:00Z');
    const spDate3 = getSaoPauloDateString(instant3);
    assert(spDate3 === '2024-11-07', '03:01 UTC do dia 07/11 é dia 07/11 em São Paulo');
  }

  // ---------------------------------------------------------------------------
  // TESTE 12: Integração com Financial Engine e Regressão da Proteção de Compras
  // ---------------------------------------------------------------------------
  console.log('\n--- Teste 12: Integração com Financial Engine e Regressão Geral ---');
  {
    // Simula cotação obtida pelo serviço PTAX D-1 e alimenta o Financial Engine
    const mockPtaxResult = {
      success: true,
      ptaxRate: 5.6543,
      quoteDate: '2026-11-06',
      status: 'SUCCESS',
    };

    const {
      calculateFinancialPricingQuote,
      validateFinancialInputs,
    } = await import('../src/utils/financialEngine');

    const validation = validateFinancialInputs({
      basePriceUsd: 20,
      adminCommissionPercent: 20,
      ptaxRate: mockPtaxResult.ptaxRate,
    });
    assert(validation.isValid === true, 'ptaxRate do serviço PTAX é válido para o financialEngine');

    const quote = calculateFinancialPricingQuote({
      basePriceUsd: 20,
      adminCommissionPercent: 20,
      ptaxRate: mockPtaxResult.ptaxRate,
    });

    assert(quote.ptaxRate === 5.6543, 'ptaxRate aplicado com precisão no cálculo de preços');
    assert(quote.allInvariantsPassed === true, 'Invariante estrita de centavos exatos confirmada');
    assert(quote.packages.package8.lessonsCount === 8, 'Pacotes gerados preservados');
  }

  console.log('\n=========================================================================');
  console.log(` RESULTADOS DOS TESTES FASE FIN.2A.2C: ${passed} PASSOU | ${failed} FALHOU`);
  console.log('=========================================================================');

  if (failed > 0) {
    process.exit(1);
  }
  process.exit(0);
}

runTests().catch((err) => {
  console.error('Fatal error in test suite:', err);
  process.exit(1);
});
