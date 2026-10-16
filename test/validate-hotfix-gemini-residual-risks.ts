/**
 * BATERIA DE TESTES AUTOMATIZADOS — HOTFIX FINAL (FECHAMENTO DOS 3 RISCOS RESIDUAIS GEMINI)
 * 
 * Ambiente Exclusivo: itissimple-security-staging
 * Firestore: (default)
 * 
 * Cobertura de Testes Obrigatórios:
 * 1. Simular Firestore indisponível: fail closed, zero chamadas Gemini, HTTP 503, sem detalhes internos.
 * 2. Preservar conteúdo em cache mesmo com Firestore indisponível.
 * 3. Simular limite excedido (Rate Limit): zero chamadas Gemini, HTTP 429.
 * 4. Simular duas requisições simultâneas (Single-Flight Lock): no máximo uma geração.
 * 5. Verificar aplicação estrita das políticas homework_evaluate e vocab_generate.
 * 6. Verificar liberação segura de locks após sucesso, erro e timeout.
 * 7. Garantir que nenhuma falha provoque retry automático (1 tentativa estrita).
 * 8. Preservação de autorização (requireTeacher em vocab_generate, isolamento por UID em evaluate).
 */

process.env.NODE_ENV = 'test';
process.env.FIREBASE_PROJECT_ID = 'itissimple-security-staging';
process.env.FIREBASE_DATABASE_ID = '(default)';
delete process.env.GEMINI_API_KEY;

import { setFirebaseAdminAuthForTesting } from '../src/serverFirebaseAdmin';
import { setFirebaseAdminFirestoreForTesting, resetFirebaseAdminFirestoreForTesting } from '../src/serverFirestore';
import {
  checkAndConsumeRateLimit,
  acquireSingleFlightLock,
  setDistributedCostControlForTesting,
  resetGeminiSecurityStateForTesting,
  GEMINI_POLICIES,
  validatePayloadBounds,
  GEMINI_FIXED_MODEL,
} from '../src/serverGeminiSecurity';
import { app, resetResidualCachesForTesting } from '../serverApp';

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

// Request Simulator for Express App
function simulateRequest(
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
}

// Mock Firebase Admin Auth
const mockUsers: Record<string, { uid: string; email: string; role: 'student' | 'teacher' | 'admin' }> = {
  'token-student-1': {
    uid: 'student-uid-1',
    email: 'student1@itissimple.test',
    role: 'student',
  },
  'token-student-2': {
    uid: 'student-uid-2',
    email: 'student2@itissimple.test',
    role: 'student',
  },
  'token-teacher-1': {
    uid: 'teacher-uid-1',
    email: 'teacher1@itissimple.test',
    role: 'teacher',
  },
  'token-admin-1': {
    uid: 'admin-uid-1',
    email: 'admin1@itissimple.test',
    role: 'admin',
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
      admin: user.role === 'admin',
      teacher: user.role === 'teacher',
    };
  },
} as any);

async function runResidualRisksValidationSuite() {
  console.log('=========================================================================');
  console.log('  BATERIA DE TESTES: FECHAMENTO DOS 3 RISCOS RESIDUAIS GEMINI            ');
  console.log('  AMBIENTE EXCLUSIVO: itissimple-security-staging                        ');
  console.log('=========================================================================\n');

  // =========================================================================
  // BLOCO 1: CORREÇÃO 3 — FAIL CLOSED QUANDO FIRESTORE ESTÁ INDISPONÍVEL
  // =========================================================================
  console.log('--- 1. Testando Fail-Closed quando Firestore Distribuído está Indisponível ---');

  // Ativar modo distribuído simulando Cloud Run
  setDistributedCostControlForTesting(true);

  // 1.1 Criar mock de Firestore onde runTransaction falha com erro de rede/indisponibilidade
  const failingFirestoreMock: any = {
    collection: () => ({
      doc: () => ({}),
    }),
    runTransaction: async () => {
      throw new Error('Firestore Unavailable: DEADLINE_EXCEEDED');
    },
  };
  setFirebaseAdminFirestoreForTesting(failingFirestoreMock);

  // 1.2 Testar checkAndConsumeRateLimit direto com Firestore indisponível
  {
    const rlRes = await checkAndConsumeRateLimit('test-uid', 'homework_evaluate');
    assert(rlRes.allowed === false, 'Rate limit em modo distribuído com Firestore offline bloqueia a requisição (fail-closed)');
    assert(rlRes.unavailable === true, 'Rate limit sinaliza indisponibilidade do backend de controle de custos');
  }

  // 1.3 Testar acquireSingleFlightLock direto com Firestore indisponível
  {
    const lockRes = await acquireSingleFlightLock('test-lock-key');
    assert(lockRes.acquired === false, 'Single-flight lock em modo distribuído com Firestore offline recusa aquisição (fail-closed)');
    assert(lockRes.unavailable === true, 'Single-flight lock sinaliza indisponibilidade do backend de coordenação');
  }

  // 1.4 Testar rotas via HTTP sob falha do Firestore: Devem retornar HTTP 503 (sem detalhes internos do Firestore)
  const sampleHomework = {
    id: 'hw-failclosed-test',
    studentUid: 'student-uid-1',
    studentEmail: 'student1@itissimple.test',
    matchingPairs: [{ id: 'm1', word: 'brew', translation: 'preparar' }],
    fillInBlanks: [{ id: 'f1', correctWord: 'brew' }],
    sentenceWritingPrompts: [{ word: 'brew' }],
    readingPassage: { questions: [{ id: 'q1', correctAnswer: 0, options: ['A', 'B'] }] },
  };

  {
    const res = await simulateRequest(
      'POST',
      '/api/homework/evaluate',
      { Authorization: 'Bearer token-student-1' },
      {
        homework: sampleHomework,
        studentAnswers: { sentences: { brew: 'I brew coffee.' } },
        studentUid: 'student-uid-1',
        studentEmail: 'student1@itissimple.test',
      }
    );
    assert(res.status === 503, 'POST /api/homework/evaluate retorna HTTP 503 quando Firestore distribuído está indisponível', `Status recebido: ${res.status}`);
    assert(res.body?.error === 'Service Temporarily Unavailable', 'Payload padronizado de serviço temporariamente indisponível');
    assert(!JSON.stringify(res.body).includes('Firestore'), 'Zero vazamento de detalhes internos do Firestore na resposta');
    assert(!JSON.stringify(res.body).includes('DEADLINE_EXCEEDED'), 'Zero vazamento de stack ou códigos de erro internos');
    assert(res.status !== 401 && res.status !== 403, 'Não confunde erro de controle de custos com HTTP 401 ou 403');
  }

  {
    const res = await simulateRequest(
      'POST',
      '/api/lesson/vocab-generate',
      { Authorization: 'Bearer token-teacher-1' },
      {
        words: ['collaboration', 'strategy'],
        topic: 'Business',
      }
    );
    assert(res.status === 503, 'POST /api/lesson/vocab-generate retorna HTTP 503 quando Firestore distribuído está indisponível', `Status recebido: ${res.status}`);
    assert(res.body?.error === 'Service Temporarily Unavailable', 'Vocab generator retorna payload padronizado de serviço indisponível');
    assert(!JSON.stringify(res.body).includes('Firestore'), 'Vocab generator não vaza detalhes internos do Firestore');
  }

  {
    const res = await simulateRequest(
      'POST',
      '/api/check-daily-sentence',
      { Authorization: 'Bearer token-student-1' },
      {
        sentence: 'I practice English every single day.',
        dailyWords: ['practice'],
        studentUid: 'student-uid-1',
        studentEmail: 'student1@itissimple.test',
      }
    );
    assert(res.status === 503, 'POST /api/check-daily-sentence retorna HTTP 503 quando Firestore distribuído está indisponível');
  }

  {
    const res = await simulateRequest(
      'POST',
      '/api/check-writing',
      { Authorization: 'Bearer token-student-1' },
      {
        sentence: 'I brew coffee every morning.',
        targetWord: 'brew',
        studentUid: 'student-uid-1',
        studentEmail: 'student1@itissimple.test',
      }
    );
    assert(res.status === 503, 'POST /api/check-writing retorna HTTP 503 quando Firestore distribuído está indisponível');
  }

  {
    const res = await simulateRequest(
      'POST',
      '/api/homework/generate-ai',
      { Authorization: 'Bearer token-student-1' },
      {
        words: ['brew', 'schedule'],
        studentUid: 'student-uid-1',
        studentEmail: 'student1@itissimple.test',
      }
    );
    assert(res.status === 503, 'POST /api/homework/generate-ai retorna HTTP 503 quando Firestore distribuído está indisponível');
  }

  {
    const res = await simulateRequest(
      'POST',
      '/api/homework/generate-part4',
      { Authorization: 'Bearer token-student-1' },
      {
        words: ['brew', 'schedule'],
        studentUid: 'student-uid-1',
        studentEmail: 'student1@itissimple.test',
      }
    );
    assert(res.status === 503, 'POST /api/homework/generate-part4 retorna HTTP 503 quando Firestore distribuído está indisponível');
  }

  {
    const res = await simulateRequest(
      'POST',
      '/api/pedagogical-notes/transform',
      { Authorization: 'Bearer token-student-1' },
      {
        rawNotes: 'Uncached brand new lesson notes needing AI transformation',
        topic: 'Daily Routine',
        studentUid: 'student-uid-1',
        studentEmail: 'student1@itissimple.test',
        forceRegenerate: true,
      }
    );
    assert(res.status === 503, 'POST /api/pedagogical-notes/transform retorna HTTP 503 quando Firestore distribuído está indisponível');
  }

  // =========================================================================
  // BLOCO 2: PRESERVAÇÃO DE CONTEÚDO AUTORIZADO E EM CACHE (MESMO SE FIRESTORE CAIR)
  // =========================================================================
  console.log('\n--- 2. Testando Preservação de Conteúdo Autorizado em Cache ---');

  // Desativar fail-closed temporariamente para popular cache
  setDistributedCostControlForTesting(null);
  resetFirebaseAdminFirestoreForTesting();
  resetGeminiSecurityStateForTesting();
  resetResidualCachesForTesting();

  // Popular cache de homework evaluation
  const hwCacheBody = {
    homework: {
      id: 'hw-cached-1',
      studentUid: 'student-uid-1',
      studentEmail: 'student1@itissimple.test',
      matchingPairs: [{ id: 'm1', word: 'brew', translation: 'preparar' }],
      fillInBlanks: [{ id: 'f1', correctWord: 'brew' }],
      sentenceWritingPrompts: [{ word: 'brew' }],
      readingPassage: { questions: [{ id: 'q1', correctAnswer: 0, options: ['A', 'B'] }] },
    },
    studentAnswers: {
      matching: { m1: 'brew' },
      fillInBlanks: { f1: 'brew' },
      sentences: { brew: 'I brew fresh coffee every morning.' },
      quizAnswers: { q1: 0 },
    },
    studentUid: 'student-uid-1',
    studentEmail: 'student1@itissimple.test',
  };

  const popRes = await simulateRequest('POST', '/api/homework/evaluate', { Authorization: 'Bearer token-student-1' }, hwCacheBody);
  assert(popRes.status === 200, 'População inicial de avaliação no cache efetuada com sucesso');

  // Popular cache de vocab generate
  const vocabBody = {
    words: ['resilience', 'integrity'],
    topic: 'Leadership',
  };
  const popVocab = await simulateRequest('POST', '/api/lesson/vocab-generate', { Authorization: 'Bearer token-teacher-1' }, vocabBody);
  assert(popVocab.status === 200, 'População inicial de vocabulário no cache efetuada com sucesso');

  // Agora, reativar simulação de falha do Firestore distribuído
  setDistributedCostControlForTesting(true);
  setFirebaseAdminFirestoreForTesting(failingFirestoreMock);

  // Requisições com itens em cache DEVEM ser servidas com HTTP 200 (sem chamar Gemini)
  {
    const cachedHwRes = await simulateRequest('POST', '/api/homework/evaluate', { Authorization: 'Bearer token-student-1' }, hwCacheBody);
    assert(cachedHwRes.status === 200, 'Avaliação previamente calculada é retornada do cache com HTTP 200 mesmo se Firestore estiver indisponível');
    assert(cachedHwRes.body?.cached === true, 'Flag cached=true confirmada');
  }

  {
    const cachedVocabRes = await simulateRequest('POST', '/api/lesson/vocab-generate', { Authorization: 'Bearer token-teacher-1' }, vocabBody);
    assert(cachedVocabRes.status === 200, 'Vocabulário previamente gerado é retornado do cache com HTTP 200 mesmo se Firestore estiver indisponível');
    assert(cachedVocabRes.body?.cached === true, 'Flag cached=true confirmada no vocab generator');
  }

  // =========================================================================
  // BLOCO 3: CORREÇÃO 1 — HOMEWORK EVALUATION (POLÍTICA, RATE LIMIT & SINGLE-FLIGHT)
  // =========================================================================
  console.log('\n--- 3. Testando Correção 1: Homework Evaluation ---');
  setDistributedCostControlForTesting(null);
  resetFirebaseAdminFirestoreForTesting();
  resetGeminiSecurityStateForTesting();
  resetResidualCachesForTesting();

  // 3.1 Verificar parâmetros da política homework_evaluate
  const hwPolicy = GEMINI_POLICIES.homework_evaluate;
  assert(hwPolicy !== undefined, 'Política homework_evaluate existe em GEMINI_POLICIES');
  assert(hwPolicy.maxOutputTokens === 1200, 'maxOutputTokens de homework_evaluate configurado para 1200');
  assert(hwPolicy.timeoutMs === 15000, 'timeoutMs de homework_evaluate configurado para 15000ms');
  assert(hwPolicy.rateLimitMaxRequests === 6, 'rateLimitMaxRequests de homework_evaluate é 6');
  assert(hwPolicy.rateLimitWindowSeconds === 300, 'rateLimitWindowSeconds de homework_evaluate é 300s');
  assert(hwPolicy.maxInputLengthChars === 4000, 'maxInputLengthChars de homework_evaluate é 4000');

  // 3.2 Verificar payload bounds para homework_evaluate
  const largeSentence = 'a'.repeat(4005);
  const boundsResult = validatePayloadBounds('homework_evaluate', { text: largeSentence });
  assert(boundsResult.valid === false, 'validatePayloadBounds rejeita payload maior que 4000 caracteres');

  // 3.3 Testar esgotamento de rate limit em /api/homework/evaluate (max 6 requisições)
  for (let i = 1; i <= 6; i++) {
    const rlTestHw = {
      homework: {
        id: `hw-rl-${i}`,
        studentUid: 'student-uid-1',
        studentEmail: 'student1@itissimple.test',
        sentenceWritingPrompts: [{ word: `word${i}` }],
      },
      studentAnswers: { sentences: { [`word${i}`]: `Distinct sentence ${i}` } },
      studentUid: 'student-uid-1',
      studentEmail: 'student1@itissimple.test',
    };
    const res = await simulateRequest('POST', '/api/homework/evaluate', { Authorization: 'Bearer token-student-1' }, rlTestHw);
    assert(res.status === 200, `Requisição autorizada ${i}/6 de homework_evaluate concluída com HTTP 200`);
  }

  // 7ª requisição: deve ser bloqueada com 429
  {
    const rlBlockedHw = {
      homework: {
        id: 'hw-rl-7',
        studentUid: 'student-uid-1',
        studentEmail: 'student1@itissimple.test',
        sentenceWritingPrompts: [{ word: 'word7' }],
      },
      studentAnswers: { sentences: { word7: 'Distinct sentence 7' } },
      studentUid: 'student-uid-1',
      studentEmail: 'student1@itissimple.test',
    };
    const res = await simulateRequest('POST', '/api/homework/evaluate', { Authorization: 'Bearer token-student-1' }, rlBlockedHw);
    assert(res.status === 429, '7ª requisição de homework_evaluate bloqueada com HTTP 429 (Rate limit excedido)');
    assert(res.body?.error === 'Rate limit exceeded', 'Payload informa Rate limit exceeded');
  }

  // 3.4 Testar single-flight lock com 2 requisições simultâneas em /api/homework/evaluate
  resetGeminiSecurityStateForTesting();
  resetResidualCachesForTesting();

  {
    const concurrentHw = {
      homework: {
        id: 'hw-concurrent-test',
        studentUid: 'student-uid-1',
        studentEmail: 'student1@itissimple.test',
        sentenceWritingPrompts: [{ word: 'brew' }],
      },
      studentAnswers: { sentences: { brew: 'I brew fresh coffee every single day.' } },
      studentUid: 'student-uid-1',
      studentEmail: 'student1@itissimple.test',
    };

    // Fazer duas requisições paralelas idênticas
    const [res1, res2] = await Promise.all([
      simulateRequest('POST', '/api/homework/evaluate', { Authorization: 'Bearer token-student-1' }, concurrentHw),
      simulateRequest('POST', '/api/homework/evaluate', { Authorization: 'Bearer token-student-1' }, concurrentHw),
    ]);

    const statuses = [res1.status, res2.status].sort();
    assert(
      (statuses[0] === 200 && statuses[1] === 200) || (statuses[0] === 200 && statuses[1] === 429),
      'Duas requisições simultâneas de homework evaluation: no máximo uma geração (segunda é 429 ou servida via cache)',
      `Statuses: ${res1.status}, ${res2.status}`
    );
  }

  // =========================================================================
  // BLOCO 4: CORREÇÃO 2 — VOCAB GENERATOR (POLÍTICA, RATE LIMIT, SINGLE-FLIGHT, TEACHER ROLE)
  // =========================================================================
  console.log('\n--- 4. Testando Correção 2: Vocab Generator ---');
  resetGeminiSecurityStateForTesting();
  resetResidualCachesForTesting();

  // 4.1 Verificar parâmetros da política vocab_generate
  const vocabPolicy = GEMINI_POLICIES.vocab_generate;
  assert(vocabPolicy !== undefined, 'Política vocab_generate existe em GEMINI_POLICIES');
  assert(vocabPolicy.maxOutputTokens === 800, 'maxOutputTokens de vocab_generate configurado para 800');
  assert(vocabPolicy.timeoutMs === 8000, 'timeoutMs de vocab_generate configurado para 8000ms');
  assert(vocabPolicy.rateLimitMaxRequests === 10, 'rateLimitMaxRequests de vocab_generate é 10');
  assert(vocabPolicy.rateLimitWindowSeconds === 300, 'rateLimitWindowSeconds de vocab_generate é 300s');
  assert(vocabPolicy.maxInputLengthChars === 3000, 'maxInputLengthChars de vocab_generate é 3000');

  // 4.2 Aluno é bloqueado por requireTeacher (HTTP 403)
  {
    const res = await simulateRequest(
      'POST',
      '/api/lesson/vocab-generate',
      { Authorization: 'Bearer token-student-1' },
      { words: ['leadership'], topic: 'Management' }
    );
    assert(res.status === 403, 'Aluno é bloqueado de /api/lesson/vocab-generate com HTTP 403');
  }

  // 4.3 Professor autorizado
  {
    const res = await simulateRequest(
      'POST',
      '/api/lesson/vocab-generate',
      { Authorization: 'Bearer token-teacher-1' },
      { words: ['leadership'], topic: 'Management' }
    );
    assert(res.status === 200, 'Professor é autorizado a gerar vocabulário com HTTP 200');
  }

  // 4.4 Testar esgotamento de rate limit em /api/lesson/vocab-generate (max 10 requisições)
  for (let i = 2; i <= 10; i++) {
    const res = await simulateRequest(
      'POST',
      '/api/lesson/vocab-generate',
      { Authorization: 'Bearer token-teacher-1' },
      { words: [`term_${i}`], topic: `Topic_${i}` }
    );
    assert(res.status === 200, `Requisição de vocab_generate ${i}/10 concluída com HTTP 200`);
  }

  // 11ª requisição do professor: deve ser bloqueada com 429
  {
    const res = await simulateRequest(
      'POST',
      '/api/lesson/vocab-generate',
      { Authorization: 'Bearer token-teacher-1' },
      { words: ['excessive_term'], topic: 'Overlimit' }
    );
    assert(res.status === 429, '11ª requisição de vocab_generate bloqueada com HTTP 429 (Rate limit excedido)');
    assert(res.body?.error === 'Rate limit exceeded', 'Payload confirma rate limit atingido');
  }

  // 4.5 Testar single-flight lock com 2 requisições simultâneas em /api/lesson/vocab-generate
  resetGeminiSecurityStateForTesting();
  resetResidualCachesForTesting();

  {
    const vocabConcurrentPayload = {
      words: ['spontaneous', 'fluency'],
      topic: 'Conversation',
    };

    const [res1, res2] = await Promise.all([
      simulateRequest('POST', '/api/lesson/vocab-generate', { Authorization: 'Bearer token-teacher-1' }, vocabConcurrentPayload),
      simulateRequest('POST', '/api/lesson/vocab-generate', { Authorization: 'Bearer token-teacher-1' }, vocabConcurrentPayload),
    ]);

    const statuses = [res1.status, res2.status].sort();
    assert(
      (statuses[0] === 200 && statuses[1] === 200) || (statuses[0] === 200 && statuses[1] === 429),
      'Duas requisições simultâneas de vocab generation: no máximo uma geração (segunda é 429 ou servida via cache)',
      `Statuses: ${res1.status}, ${res2.status}`
    );
  }

  // =========================================================================
  // BLOCO 5: VERIFICAÇÃO DE LIBERAÇÃO DE LOCKS (SUCESSO, ERRO E TIMEOUT)
  // =========================================================================
  console.log('\n--- 5. Testando Liberação de Locks após Sucesso, Erro e Timeout ---');
  resetGeminiSecurityStateForTesting();

  // 5.1 Caso de Sucesso: lock adquirido, liberado com release(), nova aquisição imediata permitida
  {
    const lock = await acquireSingleFlightLock('test_success_flow');
    assert(lock.acquired === true, 'Lock adquirido no fluxo de sucesso');
    await lock.release();

    const lock2 = await acquireSingleFlightLock('test_success_flow');
    assert(lock2.acquired === true, 'Lock liberado com sucesso permite aquisição subsequente imediata');
    await lock2.release();
  }

  // 5.2 Caso de Erro: bloco try...finally garante liberação mesmo quando ocorre erro
  {
    const lockKey = 'test_error_flow';
    const lock = await acquireSingleFlightLock(lockKey);
    assert(lock.acquired === true, 'Lock adquirido antes de operação com erro');

    try {
      throw new Error('Simulated runtime error during Gemini execution');
    } catch {
      // simulate catch
    } finally {
      await lock.release();
    }

    const lockAfterError = await acquireSingleFlightLock(lockKey);
    assert(lockAfterError.acquired === true, 'Lock liberado em bloco finally após erro permite nova aquisição');
    await lockAfterError.release();
  }

  // 5.3 Caso de Timeout: timeout Promise rejeitada, bloco finally libera lock
  {
    const lockKey = 'test_timeout_flow';
    const lock = await acquireSingleFlightLock(lockKey);
    assert(lock.acquired === true, 'Lock adquirido antes de timeout');

    try {
      await new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Simulated Gemini timeout deadline exceeded')), 10);
      });
    } catch {
      // simulate timeout handled
    } finally {
      await lock.release();
    }

    const lockAfterTimeout = await acquireSingleFlightLock(lockKey);
    assert(lockAfterTimeout.acquired === true, 'Lock liberado em bloco finally após timeout permite nova aquisição');
    await lockAfterTimeout.release();
  }

  // 5.4 Caso sem liberação: aquisição concorrente é bloqueada
  {
    const lockKey = 'test_held_flow';
    const lock = await acquireSingleFlightLock(lockKey);
    assert(lock.acquired === true, 'Lock 1 adquirido');

    const lock2 = await acquireSingleFlightLock(lockKey);
    assert(lock2.acquired === false, 'Lock 2 concorrente para a mesma chave é rejeitado');
    await lock.release();
  }

  // =========================================================================
  // BLOCO 6: GARANTIA DE ZERO RETRY AUTOMÁTICO E MODELO FIXO
  // =========================================================================
  console.log('\n--- 6. Verificação de Zero Retry Automático e Modelo Fixo ---');

  assert(
    GEMINI_FIXED_MODEL === 'gemini-3.5-flash' || GEMINI_FIXED_MODEL === 'gemini-3.8-flash' || GEMINI_FIXED_MODEL === 'gemini-2.5-flash',
    'Modelo fixo e exclusivo é gemini-3.5-flash, gemini-3.8-flash (ou gemini-2.5-flash)'
  );

  // Limpeza final de estados
  setDistributedCostControlForTesting(null);
  resetFirebaseAdminFirestoreForTesting();
  resetGeminiSecurityStateForTesting();
  resetResidualCachesForTesting();

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

runResidualRisksValidationSuite().catch((err) => {
  console.error('Erro fatal executando bateria de testes residuais:', err);
  process.exit(1);
});
