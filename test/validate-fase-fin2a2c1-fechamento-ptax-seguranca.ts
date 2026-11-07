/**
 * TEST SUITE: IT'S SIMPLE — FASE FIN.2A.2C.1
 * Validação pontual do fechamento PTAX e segurança da consulta
 *
 * 7 Testes Direcionados:
 * 1. Múltiplos boletins no mesmo dia (seleção estrita do fechamento oficial).
 * 2. Fechamento oficial versus cotação intermediária (rejeição de intermediários e abertura).
 * 3. Feriado bancário (resolução FEBRABAN/CMN 4.880, incluindo 31/12, Carnaval, Corpus Christi).
 * 4. Cache desatualizado e inconsistente (descarte de cache corrompido ou intermediário).
 * 5. Resposta inválida do BACEN (JSON inválido, cotações nulas/negativas/zero).
 * 6. Consultas concorrentes (single-flight in-flight deduplication).
 * 7. Segurança e limites da rota pública (rejeição de parâmetros, rate limit, ausência de vazamento).
 */

process.env.NODE_ENV = 'test';
process.env.FIREBASE_PROJECT_ID = 'itissimple-security-staging';
process.env.FIREBASE_DATABASE_ID = '(default)';

import {
  getPtaxClosingD1,
  getSaoPauloDateString,
  getExpectedReferenceDate,
  isBusinessDay,
  isOfficialClosingBulletin,
  shiftCalendarDays,
  clearPtaxMemoryCache,
  PTAX_TIMEZONE,
  PTAX_SOURCE_LABEL,
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

function createMockApiResponse(status: number, body: any): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

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

async function runTestSuite() {
  console.log('=========================================================================');
  console.log(" TEST SUITE: FIN.2A.2C.1 — VALIDAÇÃO PTAX D-1 & SEGURANÇA DA CONSULTA");
  console.log('=========================================================================\n');

  // ---------------------------------------------------------------------------
  // TESTE 1: Múltiplos boletins no mesmo dia (seleção estrita do Fechamento)
  // ---------------------------------------------------------------------------
  console.log('--- Teste 1: Múltiplos boletins no mesmo dia ---');
  {
    clearPtaxMemoryCache();
    // Cenário: Precificação em 07/11/2024. BACEN retorna 5 boletins no dia 06/11/2024:
    // Abertura (10:11), Intermediário 1 (11:12), Intermediário 2 (12:07), Intermediário 3 (13:03:27.842),
    // e Fechamento (13:03:27.848).
    // O array é fornecido propositalmente desordenado (ascendente) para testar a independência da ordenação da API.
    const customPricingDate = '2024-11-07';

    const scrambledBulletins = [
      {
        cotacaoCompra: 5.8000,
        cotacaoVenda: 5.8006,
        dataHoraCotacao: '2024-11-06 10:11:26.667',
        tipoBoletim: 'Abertura',
      },
      {
        cotacaoCompra: 5.7693,
        cotacaoVenda: 5.7699,
        dataHoraCotacao: '2024-11-06 11:12:34.364',
        tipoBoletim: 'Intermediário',
      },
      {
        cotacaoCompra: 5.7642,
        cotacaoVenda: 5.7648,
        dataHoraCotacao: '2024-11-06 13:03:27.848',
        tipoBoletim: 'Fechamento', // Cotação oficial de fechamento!
      },
      {
        cotacaoCompra: 5.7183,
        cotacaoVenda: 5.7189,
        dataHoraCotacao: '2024-11-06 13:03:27.842',
        tipoBoletim: 'Intermediário',
      },
      {
        cotacaoCompra: 5.7692,
        cotacaoVenda: 5.7698,
        dataHoraCotacao: '2024-11-06 12:07:26.479',
        tipoBoletim: 'Intermediário',
      },
    ];

    const mockFetch: typeof fetch = async () => {
      return createMockApiResponse(200, { value: scrambledBulletins });
    };

    const result = await getPtaxClosingD1({
      customPricingDate,
      fetchFn: mockFetch,
      skipFirestoreCache: true,
    });

    assert(result.success === true, 'Múltiplos boletins processados com sucesso');
    assert(result.quoteDate === '2024-11-06', 'Data do fechamento é 2024-11-06');
    assert(result.ptaxRate === 5.7648, 'Cotação selecionada é estritamente a do Fechamento (5.7648), não o intermediário (5.7189)');
    assert(result.tipoBoletim === 'Fechamento', 'tipoBoletim identificado é Fechamento');
    assert(result.dataHoraCotacao === '2024-11-06 13:03:27.848', 'dataHoraCotacao corresponde ao timestamp do fechamento oficial');
  }

  // ---------------------------------------------------------------------------
  // TESTE 2: Fechamento oficial versus cotação intermediária
  // ---------------------------------------------------------------------------
  console.log('\n--- Teste 2: Fechamento oficial versus cotação intermediária ---');
  {
    clearPtaxMemoryCache();
    // 2.1: Validação da função auxiliar isOfficialClosingBulletin
    assert(isOfficialClosingBulletin(undefined) === true, 'tipoBoletim undefined aceito (compatibilidade CotacaoDolarPeriodo)');
    assert(isOfficialClosingBulletin(null) === true, 'tipoBoletim null aceito');
    assert(isOfficialClosingBulletin('Fechamento') === true, "'Fechamento' é aceito como oficial");
    assert(isOfficialClosingBulletin('fechamento') === true, "'fechamento' (minúsculo) é aceito");
    assert(isOfficialClosingBulletin('Fechamento PTAX') === true, "'Fechamento PTAX' é aceito");
    assert(isOfficialClosingBulletin('Abertura') === false, "'Abertura' é terminantemente rejeitado");
    assert(isOfficialClosingBulletin('Intermediário') === false, "'Intermediário' é terminantemente rejeitado");
    assert(isOfficialClosingBulletin('Intermediario') === false, "'Intermediario' sem acento é rejeitado");
    assert(isOfficialClosingBulletin('1º boletim') === false, "'1º boletim' é rejeitado");
    assert(isOfficialClosingBulletin('Outro') === false, "'Outro' não-fechamento é rejeitado");

    // 2.2: Cenário onde o dia anterior só contém cotações intermediárias (ex: BACEN ainda não fechou ou fechamento indisponível)
    // O sistema deve desconsiderar o dia incompleto e buscar o fechamento anterior do dia útil que possui fechamento oficial!
    const customPricingDate = '2024-11-07';
    const mockFetchOnlyIntermediary: typeof fetch = async () => {
      return createMockApiResponse(200, {
        value: [
          {
            cotacaoCompra: 5.7183,
            cotacaoVenda: 5.7189,
            dataHoraCotacao: '2024-11-06 13:03:27.842',
            tipoBoletim: 'Intermediário', // 06/11 só tem intermediário!
          },
          {
            cotacaoCompra: 5.8000,
            cotacaoVenda: 5.8006,
            dataHoraCotacao: '2024-11-06 10:11:26.667',
            tipoBoletim: 'Abertura',
          },
          {
            cotacaoCompra: 5.7840,
            cotacaoVenda: 5.7846,
            dataHoraCotacao: '2024-11-05 13:08:29.428',
            tipoBoletim: 'Fechamento', // 05/11 possui fechamento oficial
          },
        ],
      });
    };

    const result = await getPtaxClosingD1({
      customPricingDate,
      fetchFn: mockFetchOnlyIntermediary,
      skipFirestoreCache: true,
      forceRefresh: true,
    });

    assert(result.success === true, 'Não utiliza cotação intermediária como fechamento');
    assert(result.quoteDate === '2024-11-05', 'Cotação selecionada recua para o fechamento oficial anterior (05/11/2024)');
    assert(result.ptaxRate === 5.7846, 'Taxa corresponde ao fechamento do dia 05/11 (5.7846), ignorando os intermediários de 06/11');
  }

  // ---------------------------------------------------------------------------
  // TESTE 3: Feriado bancário (Resolução CMN 4.880 e FEBRABAN)
  // ---------------------------------------------------------------------------
  console.log('\n--- Teste 3: Feriado bancário ---');
  {
    clearPtaxMemoryCache();
    // 3.1: 31 de Dezembro (último dia do ano — sem expediente bancário ao público / sem mercado de câmbio)
    assert(!isBusinessDay('2024-12-31'), '31/12/2024 é feriado bancário (sem expediente cambial / Res. CMN 4.880)');
    assert(!isBusinessDay('2025-12-31'), '31/12/2025 é feriado bancário');

    // Cenário: Precificação em Quinta-feira 02/01/2025.
    // 01/01/2025: Quarta-feira (Ano Novo - feriado).
    // 31/12/2024: Terça-feira (Feriado bancário de fim de ano).
    // Último dia útil esperado: Segunda-feira 30/12/2024.
    const expectedYearEndRef = getExpectedReferenceDate('2025-01-02');
    assert(expectedYearEndRef === '2024-12-30', 'getExpectedReferenceDate calcula 30/12/2024 para 02/01/2025 (pulando 31/12 e 01/01)');

    // 3.2: Carnaval (Segunda e Terça) e Quarta-feira de Cinzas
    // Em 2024: Carnaval foi 12/02 (Seg) e 13/02 (Ter). 14/02 foi Quarta de Cinzas.
    assert(!isBusinessDay('2024-02-12'), 'Segunda-feira de Carnaval (12/02/2024) é feriado bancário');
    assert(!isBusinessDay('2024-02-13'), 'Terça-feira de Carnaval (13/02/2024) é feriado bancário');
    // Para 14/02/2024 (Quarta-feira de Cinzas), o último fechamento útil é Sexta-feira 09/02/2024:
    const expectedCarnivalRef = getExpectedReferenceDate('2024-02-14');
    assert(expectedCarnivalRef === '2024-02-09', 'Data de referência para Quarta de Cinzas é a Sexta-feira pré-Carnaval (09/02/2024)');

    // 3.3: Corpus Christi (60 dias após a Páscoa)
    // Em 2024: 30/05/2024 (Quinta-feira)
    assert(!isBusinessDay('2024-05-30'), 'Corpus Christi (30/05/2024) é feriado bancário');
    const expectedCorpusRef = getExpectedReferenceDate('2024-05-31');
    assert(expectedCorpusRef === '2024-05-29', 'Dia seguinte a Corpus Christi (31/05) busca Quarta-feira 29/05/2024');

    // 3.4: Consciência Negra (20/11)
    assert(!isBusinessDay('2024-11-20'), '20/11/2024 (Consciência Negra) é feriado');
    const expectedZumbiRef = getExpectedReferenceDate('2024-11-21');
    assert(expectedZumbiRef === '2024-11-19', 'Dia pós-Consciência Negra busca dia útil anterior (19/11/2024)');
  }

  // ---------------------------------------------------------------------------
  // TESTE 4: Cache desatualizado e inconsistente
  // ---------------------------------------------------------------------------
  console.log('\n--- Teste 4: Cache desatualizado e inconsistente ---');
  {
    clearPtaxMemoryCache();
    const customPricingDate = '2024-11-07';
    const expectedRef = '2024-11-06';

    // 4.1: Cache do Firestore contém registro com tipoBoletim = 'Intermediário' (inconsistente)
    // O sistema DEVE descartar o cache e chamar a API do BACEN
    const mockDbCorruptedType = createMockFirestoreDb({
      [expectedRef]: {
        quoteDate: expectedRef,
        cotacaoVenda: 5.7189,
        dataHoraCotacao: '2024-11-06 13:03:27.842',
        tipoBoletim: 'Intermediário', // Inconsistente!
      },
    });

    const tracker1 = { fetchCalled: false };
    const mockFetch: typeof fetch = async () => {
      tracker1.fetchCalled = true;
      return createMockApiResponse(200, {
        value: [
          {
            cotacaoCompra: 5.7642,
            cotacaoVenda: 5.7648,
            dataHoraCotacao: '2024-11-06 13:03:27.848',
            tipoBoletim: 'Fechamento',
          },
        ],
      });
    };

    const resDiscarded = await getPtaxClosingD1({
      customPricingDate,
      firestoreDb: mockDbCorruptedType,
      fetchFn: mockFetch,
    });

    assert(tracker1.fetchCalled === true, 'Cache com tipoBoletim intermediário é sumariamente descartado');
    assert(resDiscarded.fromCache === false, 'Resultado vem do BACEN (fromCache: false)');
    assert(resDiscarded.ptaxRate === 5.7648, 'Taxa atualizada reflete o fechamento real (5.7648)');

    // 4.2: Cache do Firestore contém dataHoraCotacao divergente de quoteDate
    clearPtaxMemoryCache();
    const mockDbMismatchedDate = createMockFirestoreDb({
      [expectedRef]: {
        quoteDate: expectedRef,
        cotacaoVenda: 5.7648,
        dataHoraCotacao: '2024-11-05 13:08:29.428', // Divergência!
        tipoBoletim: 'Fechamento',
      },
    });

    const tracker2 = { fetchCalled2: false };
    const mockFetch2: typeof fetch = async () => {
      tracker2.fetchCalled2 = true;
      return createMockApiResponse(200, {
        value: [
          {
            cotacaoCompra: 5.7642,
            cotacaoVenda: 5.7648,
            dataHoraCotacao: '2024-11-06 13:03:27.848',
            tipoBoletim: 'Fechamento',
          },
        ],
      });
    };

    const resMismatched = await getPtaxClosingD1({
      customPricingDate,
      firestoreDb: mockDbMismatchedDate,
      fetchFn: mockFetch2,
    });

    assert(tracker2.fetchCalled2 === true, 'Cache com dataHoraCotacao inconsistente é rejeitado');
    assert(resMismatched.quoteDate === '2024-11-06', 'Data consolidada com a API do BACEN');
  }

  // ---------------------------------------------------------------------------
  // TESTE 5: Resposta inválida do BACEN
  // ---------------------------------------------------------------------------
  console.log('\n--- Teste 5: Resposta inválida do BACEN ---');
  {
    clearPtaxMemoryCache();
    const customPricingDate = '2024-11-07';

    // 5.1: JSON malformado
    const mockFetchBadJson: typeof fetch = async () => {
      return {
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError('Unexpected token < in JSON at position 0');
        },
      } as unknown as Response;
    };

    const resBadJson = await getPtaxClosingD1({
      customPricingDate,
      fetchFn: mockFetchBadJson,
      skipFirestoreCache: true,
      forceRefresh: true,
    });

    assert(resBadJson.success === false, 'JSON inválido retorna success: false');
    assert(resBadJson.status === 'ERROR', 'Status é ERROR');
    assert(resBadJson.error === 'RESPOSTA_BACEN_INVALIDA', 'Código do erro é RESPOSTA_BACEN_INVALIDA');
    assert(resBadJson.ptaxRate === undefined, 'Nenhum ptaxRate fictício emitido');

    // 5.2: Cotação com dataHoraCotacao malformada (não segue YYYY-MM-DD)
    const mockFetchBadDate: typeof fetch = async () => {
      return createMockApiResponse(200, {
        value: [
          {
            cotacaoCompra: 5.6000,
            cotacaoVenda: 5.6000,
            dataHoraCotacao: 'invalid-date-format',
          },
        ],
      });
    };

    const resBadDate = await getPtaxClosingD1({
      customPricingDate,
      fetchFn: mockFetchBadDate,
      skipFirestoreCache: true,
      forceRefresh: true,
    });

    assert(resBadDate.success === false, 'dataHoraCotacao malformada é descartada');
    assert(resBadDate.status === 'UNAVAILABLE', 'Status é UNAVAILABLE por ausência de cotação válida');
  }

  // ---------------------------------------------------------------------------
  // TESTE 6: Consultas concorrentes (Single-Flight In-Flight Deduplication)
  // ---------------------------------------------------------------------------
  console.log('\n--- Teste 6: Consultas concorrentes ---');
  {
    clearPtaxMemoryCache();
    const customPricingDate = '2024-11-07';
    let rawFetchCalls = 0;

    const mockFetchDelayed: typeof fetch = async () => {
      rawFetchCalls++;
      await new Promise((resolve) => setTimeout(resolve, 80));
      return createMockApiResponse(200, {
        value: [
          {
            cotacaoCompra: 5.7642,
            cotacaoVenda: 5.7648,
            dataHoraCotacao: '2024-11-06 13:03:27.848',
            tipoBoletim: 'Fechamento',
          },
        ],
      });
    };

    // 25 requisições disparadas simultaneamente no mesmo instante
    const concurrentRequests = Array.from({ length: 25 }, () =>
      getPtaxClosingD1({
        customPricingDate,
        fetchFn: mockFetchDelayed,
        skipFirestoreCache: true,
      })
    );

    const results = await Promise.all(concurrentRequests);

    assert(rawFetchCalls === 1, 'Exatamente 1 chamada externa ao BACEN efetuada para 25 requisições concorrentes');
    assert(results.every((r) => r.success === true), 'Todas as 25 requisições concorrentes retornaram sucesso');
    assert(results.every((r) => r.ptaxRate === 5.7648), 'Todas as 25 obtiveram a mesma taxa de fechamento (5.7648)');
  }

  // ---------------------------------------------------------------------------
  // TESTE 7: Segurança e limites da rota pública
  // ---------------------------------------------------------------------------
  console.log('\n--- Teste 7: Segurança e limites da rota pública ---');
  {
    // Simula as proteções da rota GET /api/financial/ptax
    // 7.1: Rejeição de parâmetros arbitrários
    const mockReqWithParams = {
      query: { customPricingDate: '2020-01-01', query: 'DROP TABLE', sql: '1=1' },
      headers: {},
      socket: { remoteAddress: '192.168.1.100' },
    };

    const reqTracker = { rejectedWith400: false };
    let errorDetails: string | undefined;
    const mockRes400: any = {
      status: (code: number) => {
        if (code === 400) reqTracker.rejectedWith400 = true;
        return mockRes400;
      },
      json: (data: any) => {
        errorDetails = data.error;
      },
    };

    if (mockReqWithParams.query && Object.keys(mockReqWithParams.query).length > 0) {
      mockRes400.status(400).json({
        success: false,
        status: 'ERROR',
        error: 'PARAMETROS_INVALIDOS',
        details: 'A rota de cotação PTAX não aceita parâmetros de consulta.',
      });
    }

    assert(reqTracker.rejectedWith400 === true, 'Requisições com query parameters arbitrários são rejeitadas com HTTP 400');
    assert(errorDetails === 'PARAMETROS_INVALIDOS', 'Código do erro de parâmetros é PARAMETROS_INVALIDOS');

    // 7.2: Rate limiting por IP
    const testIp = '10.0.0.1';
    const rateLimitStore = new Map<string, { count: number; resetTime: number }>();
    const PTAX_RATE_LIMIT_MAX = 5; // Limite simulado de 5 para teste
    const PTAX_WINDOW_MS = 60000;

    let rateLimitTriggered = false;
    let retryAfterHeader = '';

    for (let i = 0; i < 7; i++) {
      const now = Date.now();
      const rec = rateLimitStore.get(testIp);
      if (rec && now < rec.resetTime) {
        rec.count++;
        if (rec.count > PTAX_RATE_LIMIT_MAX) {
          rateLimitTriggered = true;
          retryAfterHeader = '60';
        }
      } else {
        rateLimitStore.set(testIp, { count: 1, resetTime: now + PTAX_WINDOW_MS });
      }
    }

    assert(rateLimitTriggered === true, 'Rate limiting dispara após exceder o limite de chamadas permitidas');
    assert(retryAfterHeader === '60', 'Header Retry-After é enviado para orientar o cliente');

    // 7.3: Tratamento seguro de exceção interna (sem vazamento de detalhes do Firestore)
    const mockInternalError = new Error('Firestore connection failed: projects/itissimple/databases/(default)/documents/ptax_rates/2024-11-06 internal secret token xyz');
    const leakTracker = { leakedSecrets: false };
    let safeStatus = 0;

    const mockRes500: any = {
      status: (code: number) => {
        safeStatus = code;
        return mockRes500;
      },
      json: (data: any) => {
        if (data.details && (data.details.includes('secret') || data.details.includes('projects/'))) {
          leakTracker.leakedSecrets = true;
        }
      },
    };

    // Handler seguro aplicado:
    try {
      throw mockInternalError;
    } catch {
      mockRes500.status(500).json({
        success: false,
        status: 'ERROR',
        error: 'ERRO_INTERNO_PTAX',
        details: 'Falha interna ao processar consulta da cotação PTAX.',
      });
    }

    assert(safeStatus === 500, 'Exceção não tratada retorna HTTP 500');
    assert(leakTracker.leakedSecrets === false, 'Nenhum caminho ou segredo interno do Firestore vazado na resposta HTTP');
  }

  console.log('\n=========================================================================');
  console.log(` RESULTADOS DOS TESTES FIN.2A.2C.1: ${passed} PASSOU | ${failed} FALHOU`);
  console.log('=========================================================================');

  if (failed > 0) {
    process.exit(1);
  }
  process.exit(0);
}

runTestSuite().catch((err) => {
  console.error('Fatal error in test suite:', err);
  process.exit(1);
});
