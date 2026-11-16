/**
 * AI.BOUNDS.2A — Testes Direcionados para Rate Limit do /api/dictionary/define
 *
 * Cobertura obrigatória:
 * 1. Autenticação e validação preservadas (401 sem/com token inválido, 400 payload inválido).
 * 2. Limite permitido: requisições dentro da cota chamam Gemini (mock) e populam cache.
 * 3. Limite excedido COM fallback offline: palavra curada/cacheada retorna HTTP 200 sem chamar Gemini.
 * 4. Limite excedido SEM fallback offline: retorna HTTP 429, nunca chama Gemini nem API externa.
 * 5. Indisponibilidade do controle de rate limit: fail-closed (HTTP 503), zero chamadas Gemini,
 *    sem liberar chamadas ilimitadas; cache e repositório offline curado continuam funcionando.
 * 6. Concorrência:
 *    - Requisições simultâneas para mesma palavra inédita: no máximo 1 chamada Gemini (demais 429/cache).
 *    - Rajada concorrente excedendo o limite (25 reqs simultâneas): máx. 20 Gemini e >= 5 HTTP 429.
 *    - Liberação do lock após falha no Gemini.
 *
 * Sem Gemini real, sem Firestore real e sem chamadas de rede externas.
 */

process.env.NODE_ENV = 'test';
process.env.FIREBASE_PROJECT_ID = 'itissimple-security-staging';
process.env.FIREBASE_DATABASE_ID = '(default)';
process.env.GEMINI_API_KEY = 'test-fake-gemini-key-no-real-calls';

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    console.log(`  ✅ PASS: ${testName}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${testName}${detail ? ` (${detail})` : ''}`);
    failed++;
  }
}

function createSimulator(app: any) {
  return function simulateRequest(
    method: string,
    urlPath: string,
    headers: Record<string, string> = {},
    body: any = null
  ): Promise<{ status: number; headers: Record<string, string>; body: any }> {
    return new Promise((resolve) => {
      const reqHeaders: Record<string, string> = {};
      Object.entries(headers).forEach(([k, v]) => {
        reqHeaders[k.toLowerCase()] = v;
      });

      const parsedUrl = new URL(urlPath, 'http://localhost');
      const query: Record<string, string> = {};
      parsedUrl.searchParams.forEach((val, key) => {
        query[key] = val;
      });

      const req: any = {
        method: method.toUpperCase(),
        url: urlPath,
        originalUrl: urlPath,
        path: parsedUrl.pathname,
        query,
        headers: reqHeaders,
        body: body || {},
      };

      const resHeaders: Record<string, string> = {};
      let statusCode = 200;
      let resBody: any = null;

      const res: any = {
        setHeader: (name: string, value: string) => {
          resHeaders[name.toLowerCase()] = value;
        },
        getHeader: (name: string) => resHeaders[name.toLowerCase()],
        removeHeader: (name: string) => {
          delete resHeaders[name.toLowerCase()];
        },
        status: (code: number) => {
          statusCode = code;
          return res;
        },
        json: (data: any) => {
          resBody = data;
          resolve({ status: statusCode, headers: resHeaders, body: resBody });
        },
        send: (data: any) => {
          resBody = data;
          resolve({ status: statusCode, headers: resHeaders, body: resBody });
        },
        end: () => {
          resolve({ status: statusCode, headers: resHeaders, body: resBody });
        },
      };

      app(req, res, (err?: any) => {
        if (err) {
          resolve({ status: 500, headers: resHeaders, body: { error: err.message } });
        } else {
          resolve({ status: statusCode === 200 ? 404 : statusCode, headers: resHeaders, body: resBody });
        }
      });
    });
  };
}

async function runDictionaryDefineBoundsTests() {
  const { setFirebaseAdminAuthForTesting } = await import('../src/serverFirebaseAdmin');
  const { setFirebaseAdminFirestoreForTesting, resetFirebaseAdminFirestoreForTesting } = await import('../src/serverFirestore');
  const {
    GEMINI_POLICIES,
    setDistributedCostControlForTesting,
    setGeminiAttemptExecutorForTesting,
    resetGeminiSecurityStateForTesting,
  } = await import('../src/serverGeminiSecurity');
  const { app, resetResidualCachesForTesting } = await import('../serverApp');

  const simulateRequest = createSimulator(app);

  // Mock Firebase Auth
  const mockUsers: Record<string, { uid: string; email: string; role: 'student' | 'teacher' | 'admin' }> = {
    'token-student-1': {
      uid: 'dict-student-uid-1',
      email: 'dictstudent1@itissimple.test',
      role: 'student',
    },
    'token-student-2': {
      uid: 'dict-student-uid-2',
      email: 'dictstudent2@itissimple.test',
      role: 'student',
    },
    'token-teacher-1': {
      uid: 'dict-teacher-uid-1',
      email: 'dictteacher1@itissimple.test',
      role: 'teacher',
    },
  };

  setFirebaseAdminAuthForTesting({
    verifyIdToken: async (token: string) => {
      const user = mockUsers[token];
      if (!user) {
        const err: any = new Error('Invalid token');
        err.code = 'auth/invalid-id-token';
        throw err;
      }
      return {
        uid: user.uid,
        email: user.email,
        email_verified: true,
        role: user.role,
        teacher: user.role === 'teacher',
        admin: false,
      };
    },
  } as any);

  // Prevent any accidental outbound HTTP call (e.g. api.dictionaryapi.dev or real Gemini)
  const originalFetch = globalThis.fetch;
  let externalFetchCount = 0;
  (globalThis as any).fetch = async (input: any) => {
    externalFetchCount++;
    throw new Error(`Unexpected external fetch during unit test: ${String(input)}`);
  };

  let geminiCallCount = 0;
  let geminiDelayMs = 0;
  let geminiShouldFail = false;

  const installMockGemini = () => {
    setGeminiAttemptExecutorForTesting(async (_model: string, params: any) => {
      geminiCallCount++;
      if (geminiDelayMs > 0) {
        await new Promise((r) => setTimeout(r, geminiDelayMs));
      }
      if (geminiShouldFail) {
        const err: any = new Error('Simulated non-recoverable policy failure');
        err.status = 400;
        err.category = 'POLICY_VIOLATION';
        err.nonRecoverable = true;
        throw err;
      }
      const match = String(params?.untrustedUserDataPrompt || '').match(/Analyze the word or phrase: "([^"]+)"/);
      const word = match?.[1] || 'sampleword';
      const payload = {
        word,
        partOfSpeech: 'Noun',
        cefrLevel: 'B1',
        definitionEn: `A specific and authentic pedagogical explanation for ${word}.`,
        exampleSentenceEn: `Using ${word} accurately makes daily conversation much clearer.`,
        translationPt: `tradução de ${word}`,
        collocations: [`common ${word}`, `use ${word}`],
        phonetic: '/tɛst/',
        register: 'neutral',
      };
      return {
        text: JSON.stringify(payload),
        parsedJson: payload,
      };
    });
  };

  const resetAll = () => {
    setDistributedCostControlForTesting(null);
    resetFirebaseAdminFirestoreForTesting();
    resetGeminiSecurityStateForTesting();
    resetResidualCachesForTesting();
    geminiCallCount = 0;
    geminiDelayMs = 0;
    geminiShouldFail = false;
    externalFetchCount = 0;
    installMockGemini();
  };

  console.log('=========================================================================');
  console.log('  AI.BOUNDS.2A — TESTES DIRECIONADOS: /api/dictionary/define             ');
  console.log('=========================================================================\n');

  try {
    // =========================================================================
    // BLOCO 1: AUTENTICAÇÃO E VALIDAÇÃO PRESERVADAS
    // =========================================================================
    console.log('--- 1. Autenticação e Validação Preservadas ---');
    resetAll();

    {
      const resNoAuth = await simulateRequest('POST', '/api/dictionary/define', {}, { word: 'ephemeral' });
      assert(resNoAuth.status === 401, '1.1: Requisição sem token retorna HTTP 401');
      assert(geminiCallCount === 0, '1.2: Zero chamadas Gemini sem autenticação');

      const resBadAuth = await simulateRequest(
        'POST',
        '/api/dictionary/define',
        { Authorization: 'Bearer invalid-token' },
        { word: 'ephemeral' }
      );
      assert(resBadAuth.status === 401, '1.3: Token inválido retorna HTTP 401');
      assert(geminiCallCount === 0, '1.4: Zero chamadas Gemini com token inválido');

      const resMissingWord = await simulateRequest(
        'POST',
        '/api/dictionary/define',
        { Authorization: 'Bearer token-student-1' },
        {}
      );
      assert(resMissingWord.status === 400, '1.5: Payload sem palavra retorna HTTP 400');

      const resTooLong = await simulateRequest(
        'POST',
        '/api/dictionary/define',
        { Authorization: 'Bearer token-student-1' },
        { word: 'a'.repeat(101) }
      );
      assert(resTooLong.status === 400, '1.6: Palavra > 100 caracteres retorna HTTP 400');
      assert(geminiCallCount === 0, '1.7: Zero chamadas Gemini em payloads inválidos');
    }

    // =========================================================================
    // BLOCO 2: LIMITE PERMITIDO + CACHE + GET COMPATIBILITY
    // =========================================================================
    console.log('\n--- 2. Limite Permitido e Preservação de Cache ---');
    resetAll();

    {
      const maxAllowed = GEMINI_POLICIES.dictionary_define.rateLimitMaxRequests;
      assert(maxAllowed === 20, `2.1: Política dictionary_define rateLimitMaxRequests preservada (${maxAllowed})`);

      const res1 = await simulateRequest(
        'POST',
        '/api/dictionary/define',
        { Authorization: 'Bearer token-student-1' },
        { word: 'serendipity', studentLevel: 'intermediate' }
      );
      assert(res1.status === 200, '2.2: Primeira consulta inédita dentro do limite retorna HTTP 200');
      assert(res1.body?.source === 'native_notes_ai_personalized', '2.3: Contrato de definição IA preservado');
      assert(res1.body?.isAiGenerated === true, '2.4: Flag isAiGenerated preservada');
      assert(geminiCallCount === 1, `2.5: Gemini mock chamado exatamente 1 vez (atual: ${geminiCallCount})`);

      // Segunda consulta da mesma palavra -> cache (0 chamadas Gemini)
      const resCached = await simulateRequest(
        'POST',
        '/api/dictionary/define',
        { Authorization: 'Bearer token-student-1' },
        { word: 'serendipity', studentLevel: 'intermediate' }
      );
      assert(resCached.status === 200, '2.6: Segunda consulta da mesma palavra retorna HTTP 200 do cache');
      assert(geminiCallCount === 1, `2.7: Cache evita chamada Gemini redundante (chamadas: ${geminiCallCount})`);

      // Consulta via GET preservada
      const resGet = await simulateRequest(
        'GET',
        '/api/dictionary/define?word=serendipity&level=intermediate',
        { Authorization: 'Bearer token-student-1' }
      );
      assert(resGet.status === 200, '2.8: GET /api/dictionary/define continua suportado e usa cache');
      assert(geminiCallCount === 1, '2.9: GET cacheado não chama Gemini');
    }

    // =========================================================================
    // BLOCO 3: LIMITE EXCEDIDO COM FALLBACK OFFLINE vs SEM FALLBACK (HTTP 429)
    // =========================================================================
    console.log('\n--- 3. Limite Excedido (Com Fallback Offline vs Sem Fallback -> 429) ---');
    resetAll();

    {
      const maxAllowed = GEMINI_POLICIES.dictionary_define.rateLimitMaxRequests;

      // Consome todas as 20 requisições permitidas com palavras inéditas distintas
      let allowedSuccessCount = 0;
      for (let i = 1; i <= maxAllowed; i++) {
        const res = await simulateRequest(
          'POST',
          '/api/dictionary/define',
          { Authorization: 'Bearer token-student-1' },
          { word: `uniqueword_${i}`, studentLevel: 'intermediate' }
        );
        if (res.status === 200) allowedSuccessCount++;
      }
      assert(
        allowedSuccessCount === maxAllowed && geminiCallCount === maxAllowed,
        `3.1: Exatamente ${maxAllowed} requisições permitidas executadas com ${maxAllowed} chamadas Gemini`,
        `allowed=${allowedSuccessCount}, gemini=${geminiCallCount}`
      );

      // 3A: Limite excedido SEM fallback offline -> HTTP 429 e ZERO chamadas Gemini
      const callsBeforeDenied = geminiCallCount;
      const resDenied = await simulateRequest(
        'POST',
        '/api/dictionary/define',
        { Authorization: 'Bearer token-student-1' },
        { word: 'ephemeral_over_quota', studentLevel: 'intermediate' }
      );
      assert(
        resDenied.status === 429,
        `3.2: Requisição #${maxAllowed + 1} sem fallback offline retorna HTTP 429`,
        `status=${resDenied.status}`
      );
      assert(
        resDenied.body?.error === 'Rate limit exceeded',
        '3.3: Payload 429 contém error: "Rate limit exceeded"'
      );
      assert(
        resDenied.body?.rateLimited === true && Number(resDenied.body?.retryAfterSeconds) >= 1,
        '3.4: Payload 429 informa rateLimited=true e retryAfterSeconds'
      );
      assert(
        Boolean(resDenied.headers['retry-after']),
        '3.5: Header Retry-After incluído na resposta HTTP 429'
      );
      assert(
        geminiCallCount === callsBeforeDenied,
        `3.6: NUNCA chama Gemini após negativa do rate limit (${geminiCallCount} === ${callsBeforeDenied})`
      );
      assert(
        externalFetchCount === 0,
        `3.7: NUNCA chama API externa após negativa do rate limit (externalFetch=${externalFetchCount})`
      );

      // Múltiplas novas tentativas negadas continuam retornando 429 sem Gemini
      const resDenied2 = await simulateRequest(
        'POST',
        '/api/dictionary/define',
        { Authorization: 'Bearer token-student-1' },
        { word: 'another_uncached_word', studentLevel: 'intermediate' }
      );
      assert(resDenied2.status === 429, '3.8: Tentativas subsequentes sem fallback continuam bloqueadas com HTTP 429');
      assert(geminiCallCount === callsBeforeDenied, '3.9: Zero chamadas Gemini em tentativas bloqueadas subsequentes');

      // 3B: Limite excedido COM fallback offline (palavra curada em NATIVE_FRIENDS_DICTIONARY_DATABASE)
      const resOfflineCurated = await simulateRequest(
        'POST',
        '/api/dictionary/define',
        { Authorization: 'Bearer token-student-1' },
        { word: 'schedule', studentLevel: 'intermediate' }
      );
      assert(
        resOfflineCurated.status === 200,
        '3.10: Com cota excedida, palavra do repositório offline curado retorna HTTP 200'
      );
      assert(
        resOfflineCurated.body?.source === 'native_notes_standard' && Boolean(resOfflineCurated.body?.definitionEn),
        '3.11: Fallback offline retorna definição pedagógica íntegra'
      );
      assert(
        geminiCallCount === callsBeforeDenied,
        '3.12: Fallback offline com cota excedida realiza 0 chamadas Gemini'
      );

      // 3C: Limite excedido COM palavra já em cache
      const resCachedAfterLimit = await simulateRequest(
        'POST',
        '/api/dictionary/define',
        { Authorization: 'Bearer token-student-1' },
        { word: 'uniqueword_1', studentLevel: 'intermediate' }
      );
      assert(
        resCachedAfterLimit.status === 200,
        '3.13: Com cota excedida, palavra previamente cacheada retorna HTTP 200'
      );
      assert(
        geminiCallCount === callsBeforeDenied,
        '3.14: Cache hit após estouro de cota realiza 0 chamadas Gemini'
      );

      // 3D: Isolamento por UID — outro usuário continua com sua própria cota disponível
      const resOtherUser = await simulateRequest(
        'POST',
        '/api/dictionary/define',
        { Authorization: 'Bearer token-student-2' },
        { word: 'ephemeral_other_user', studentLevel: 'intermediate' }
      );
      assert(
        resOtherUser.status === 200,
        '3.15: Outro usuário autenticado mantém cota independente (HTTP 200)'
      );
      assert(
        geminiCallCount === callsBeforeDenied + 1,
        '3.16: Apenas o usuário com cota disponível invoca Gemini'
      );
    }

    // =========================================================================
    // BLOCO 4: INDISPONIBILIDADE DO CONTROLE DE RATE LIMIT (FAIL-CLOSED)
    // =========================================================================
    console.log('\n--- 4. Indisponibilidade do Rate Limiter (Fail-Closed, Sem Chamadas Ilimitadas) ---');
    resetAll();

    {
      // Primeiro popula uma palavra no cache antes da queda do Firestore
      const preCacheRes = await simulateRequest(
        'POST',
        '/api/dictionary/define',
        { Authorization: 'Bearer token-student-1' },
        { word: 'cached_before_outage', studentLevel: 'intermediate' }
      );
      assert(preCacheRes.status === 200 && geminiCallCount === 1, '4.1: Palavra cacheada antes da indisponibilidade');

      // Ativa modo distribuído e injeta Firestore com falha em runTransaction
      setDistributedCostControlForTesting(true);
      setFirebaseAdminFirestoreForTesting({
        collection: () => ({
          doc: () => ({}),
        }),
        runTransaction: async () => {
          throw new Error('Firestore Unavailable: DEADLINE_EXCEEDED');
        },
      } as any);

      // 4A: Requisição inédita sob indisponibilidade do rate limiter -> 503 fail-closed, 0 Gemini
      const callsBeforeOutage = geminiCallCount;
      for (let attempt = 1; attempt <= 3; attempt++) {
        const resOutage = await simulateRequest(
          'POST',
          '/api/dictionary/define',
          { Authorization: 'Bearer token-student-1' },
          { word: `outage_word_${attempt}`, studentLevel: 'intermediate' }
        );
        assert(
          resOutage.status === 503,
          `4.2.${attempt}: Indisponibilidade do rate limiter retorna HTTP 503 fail-closed (tentativa ${attempt})`,
          `status=${resOutage.status}`
        );
        assert(
          resOutage.body?.error === 'Service Temporarily Unavailable',
          `4.3.${attempt}: Payload fail-closed padronizado sem vazar detalhes internos`
        );
        assert(
          !JSON.stringify(resOutage.body).includes('Firestore') &&
            !JSON.stringify(resOutage.body).includes('DEADLINE_EXCEEDED'),
          `4.4.${attempt}: Zero vazamento de detalhes internos de erro`
        );
      }
      assert(
        geminiCallCount === callsBeforeOutage,
        `4.5: Indisponibilidade do rate limiter não libera chamadas ilimitadas ao Gemini (${geminiCallCount} === ${callsBeforeOutage})`
      );
      assert(externalFetchCount === 0, '4.6: Zero chamadas externas durante indisponibilidade');

      // 4B: Falha síncrona em db.collection() também é tratada de forma fail-closed
      setFirebaseAdminFirestoreForTesting({
        collection: () => {
          throw new Error('Unexpected synchronous client failure');
        },
      } as any);
      const resSyncThrow = await simulateRequest(
        'POST',
        '/api/dictionary/define',
        { Authorization: 'Bearer token-student-1' },
        { word: 'outage_sync_throw', studentLevel: 'intermediate' }
      );
      assert(resSyncThrow.status === 503, '4.7: Falha síncrona do cliente Firestore também falha fechada com HTTP 503');
      assert(geminiCallCount === callsBeforeOutage, '4.8: Zero chamadas Gemini após falha síncrona');

      // 4C: Cache e repositório offline curado continuam respondendo durante indisponibilidade
      const resCachedDuringOutage = await simulateRequest(
        'POST',
        '/api/dictionary/define',
        { Authorization: 'Bearer token-student-1' },
        { word: 'cached_before_outage', studentLevel: 'intermediate' }
      );
      assert(resCachedDuringOutage.status === 200, '4.9: Palavra em cache preservada com HTTP 200 durante indisponibilidade');

      const resOfflineDuringOutage = await simulateRequest(
        'POST',
        '/api/dictionary/define',
        { Authorization: 'Bearer token-student-1' },
        { word: 'streamline', studentLevel: 'intermediate' }
      );
      assert(resOfflineDuringOutage.status === 200, '4.10: Repositório offline curado preservado com HTTP 200 durante indisponibilidade');
      assert(geminiCallCount === callsBeforeOutage, '4.11: Zero chamadas Gemini em cache/offline durante indisponibilidade');
    }

    // =========================================================================
    // BLOCO 5: CONCORRÊNCIA (MESMA PALAVRA SINGLE-FLIGHT + RAJADA DE COTA)
    // =========================================================================
    console.log('\n--- 5. Concorrência (Single-Flight Lock e Rajada de Rate Limit) ---');

    // 5A: 5 requisições simultâneas para a MESMA palavra inédita (mesmo tick via teacher sem I/O extra de perfil)
    resetAll();
    geminiDelayMs = 60;
    {
      const concurrentSameWord = await Promise.all(
        Array.from({ length: 5 }, () =>
          simulateRequest(
            'POST',
            '/api/dictionary/define',
            { Authorization: 'Bearer token-teacher-1' },
            { word: 'ephemeral_concurrent', studentLevel: 'intermediate' }
          )
        )
      );

      const okResponses = concurrentSameWord.filter((r) => r.status === 200);
      const locked429Responses = concurrentSameWord.filter((r) => r.status === 429);

      assert(
        geminiCallCount === 1,
        `5.1: 5 requisições simultâneas para a mesma palavra geram exatamente 1 chamada Gemini (atual: ${geminiCallCount})`
      );
      assert(
        okResponses.length === 1 && locked429Responses.length === 4,
        `5.2: 1 requisição vence (200) e 4 concorrentes são contidas com HTTP 429`,
        `200=${okResponses.length}, 429=${locked429Responses.length}`
      );
      assert(
        externalFetchCount === 0,
        '5.3: Requisições concorrentes contidas não vazam para API externa'
      );

      // Após término da requisição em voo, nova requisição consome cache com 0 Gemini
      const afterFlightRes = await simulateRequest(
        'POST',
        '/api/dictionary/define',
        { Authorization: 'Bearer token-student-1' },
        { word: 'ephemeral_concurrent', studentLevel: 'intermediate' }
      );
      assert(afterFlightRes.status === 200, '5.4: Requisição posterior após liberação do lock retorna HTTP 200 do cache');
      assert(geminiCallCount === 1, '5.5: Cache preenchido pela 1ª requisição evita nova chamada Gemini');
    }

    // 5A-bis: Concorrência com alunos (pode resolver via 429 ou cache após conclusão da 1ª, mas sempre <= 1 Gemini)
    resetAll();
    geminiDelayMs = 60;
    {
      const studentConcurrent = await Promise.all(
        Array.from({ length: 4 }, (_, idx) =>
          simulateRequest(
            'POST',
            '/api/dictionary/define',
            { Authorization: idx % 2 === 0 ? 'Bearer token-student-1' : 'Bearer token-student-2' },
            { word: 'student_concurrent_word', studentLevel: 'intermediate' }
          )
        )
      );
      const all200Or429 = studentConcurrent.every((r) => r.status === 200 || r.status === 429);
      const has200 = studentConcurrent.some((r) => r.status === 200);
      assert(
        geminiCallCount === 1 && all200Or429 && has200,
        `5.5b: Concorrência entre alunos gera exatamente 1 chamada Gemini (chamadas=${geminiCallCount})`
      );
    }

    // 5B: Liberação segura do lock após falha no Gemini
    resetAll();
    geminiShouldFail = true;
    {
      const failedRes = await simulateRequest(
        'POST',
        '/api/dictionary/define',
        { Authorization: 'Bearer token-student-1' },
        { word: 'lock_release_on_error', studentLevel: 'intermediate' }
      );
      assert(failedRes.status === 503, '5.6: Falha no Gemini sem fallback offline/externo retorna 503');
      assert(geminiCallCount === 1, '5.7: Tentativa com falha chamou Gemini 1 vez');

      // Recupera Gemini e confirma que o lock foi liberado
      geminiShouldFail = false;
      const recoveredRes = await simulateRequest(
        'POST',
        '/api/dictionary/define',
        { Authorization: 'Bearer token-student-1' },
        { word: 'lock_release_on_error', studentLevel: 'intermediate' }
      );
      assert(recoveredRes.status === 200, '5.8: Lock liberado no finally permite nova tentativa após falha');
      assert(geminiCallCount === 2, '5.9: Nova tentativa após liberação executa normalmente');
    }

    // 5C: Rajada concorrente de 25 requisições simultâneas para palavras distintas pelo mesmo UID
    resetAll();
    geminiDelayMs = 20;
    {
      const maxAllowed = GEMINI_POLICIES.dictionary_define.rateLimitMaxRequests;
      const burstResponses = await Promise.all(
        Array.from({ length: 25 }, (_, i) =>
          simulateRequest(
            'POST',
            '/api/dictionary/define',
            { Authorization: 'Bearer token-teacher-1' },
            { word: `burst_word_${i + 1}`, studentLevel: 'intermediate' }
          )
        )
      );

      const okCount = burstResponses.filter((r) => r.status === 200).length;
      const count429 = burstResponses.filter((r) => r.status === 429).length;

      assert(
        geminiCallCount <= maxAllowed && okCount === maxAllowed,
        `5.10: Rajada de 25 reqs simultâneas permite no máximo ${maxAllowed} chamadas Gemini (ok=${okCount}, gemini=${geminiCallCount})`
      );
      assert(
        count429 === 5,
        `5.11: Excedente da rajada concorrente (5 reqs) retorna HTTP 429 (atual: ${count429})`
      );
      assert(
        externalFetchCount === 0,
        '5.12: Nenhuma requisição da rajada vazou para API externa'
      );
    }
  } finally {
    (globalThis as any).fetch = originalFetch;
    resetAll();
  }

  console.log('\n=========================================================================');
  console.log(`TOTAL DE TESTES EXECUTADOS: ${passed + failed}`);
  console.log(`SUCESSO: ${passed}`);
  console.log(`FALHAS: ${failed}`);
  console.log('=========================================================================');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runDictionaryDefineBoundsTests().catch((err) => {
  console.error('Erro fatal executando testes AI.BOUNDS.2A:', err);
  process.exit(1);
});
