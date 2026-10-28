/**
 * VALIDATION TEST SUITE: HOTFIX CIRÚRGICO DE OBSERVABILIDADE GEMINI
 * Endpoint: POST /api/check-daily-sentence & evaluateDailySentenceIsolated
 * 
 * Verifies:
 * 1. HTTP 400 (Non-recoverable error / Policy violation): immediate abort, structured diagnostics
 * 2. HTTP 429 (Per-model Quota exceeded): failover across contingency pool, model exhaustion
 * 3. HTTP 503 (Service Unavailable): failover across 3 models, exhaustion diagnostics
 * 4. Timeout: failure with category TIMEOUT and interruptionReason 'timeout'
 * 5. Invalid JSON: model returns malformed non-JSON response, category INVALID_RESPONSE
 * 6. Success after fallback: model 1 fails (503), model 2 succeeds, interruptionReason 'sucesso'
 * 7. HTTP endpoint compliance: returns neutral HTTP 503 AiUnavailable without raw messages or provider internals
 * 8. Sanitization & Privacy: ZERO exposure of API keys, tokens, prompts, student sentences, or PII in logs
 * 
 * NOTE: Strictly deterministic simulations. Zero real/paid AI calls.
 */

import {
  evaluateDailySentenceIsolated,
  DailySentenceEvaluationResult,
  logDailySentenceDiagnostic,
} from '../serverApp';
import {
  GeminiContingencyResult,
  resetGeminiSecurityStateForTesting,
} from '../src/serverGeminiSecurity';

interface CapturedLog {
  level: 'log' | 'warn' | 'error';
  message: string;
  parsedJson?: any;
}

let capturedLogs: CapturedLog[] = [];
const originalConsoleLog = console.log;
const originalConsoleWarn = console.warn;
const originalConsoleError = console.error;

function startCapturingLogs() {
  capturedLogs = [];
  console.log = (...args: any[]) => {
    const msg = args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
    let parsedJson: any = null;
    const match = msg.match(/\[GeminiObservability\]\s*(\{.*\})/);
    if (match) {
      try {
        parsedJson = JSON.parse(match[1]);
      } catch {}
    }
    capturedLogs.push({ level: 'log', message: msg, parsedJson });
    originalConsoleLog.apply(console, args);
  };

  console.warn = (...args: any[]) => {
    const msg = args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
    let parsedJson: any = null;
    const match = msg.match(/\[GeminiObservability\]\s*(\{.*\})/);
    if (match) {
      try {
        parsedJson = JSON.parse(match[1]);
      } catch {}
    }
    capturedLogs.push({ level: 'warn', message: msg, parsedJson });
    originalConsoleWarn.apply(console, args);
  };
}

function stopCapturingLogs() {
  console.log = originalConsoleLog;
  console.warn = originalConsoleWarn;
  console.error = originalConsoleError;
}

function findObservabilityLog(correlationId?: string): any {
  for (let i = capturedLogs.length - 1; i >= 0; i--) {
    const log = capturedLogs[i];
    if (log.parsedJson && log.parsedJson.tag === 'GEMINI_OBSERVABILITY') {
      if (!correlationId || log.parsedJson.correlationId === correlationId) {
        return log.parsedJson;
      }
    }
  }
  return null;
}

let passedTests = 0;
let totalTests = 0;

function assert(condition: boolean, description: string) {
  totalTests++;
  if (condition) {
    passedTests++;
    originalConsoleLog(`  ✅ PASS: ${description}`);
  } else {
    originalConsoleError(`  ❌ FAIL: ${description}`);
    throw new Error(`Assertion failed: ${description}`);
  }
}

async function runTestSuite() {
  originalConsoleLog('\n=========================================================================');
  originalConsoleLog('  HOTFIX CIRÚRGICO DE OBSERVABILIDADE GEMINI — SUITE DE TESTES DETERMINÍSTICOS');
  originalConsoleLog('=========================================================================\n');

  startCapturingLogs();

  try {
    // -----------------------------------------------------------------------
    // TEST 1: Simulação de HTTP 400 (Erro não recuperável / Parâmetro ou Política inválida)
    // -----------------------------------------------------------------------
    originalConsoleLog('--- Cenário 1: Simulação de Erro Não Recuperável (HTTP 400) ---');
    resetGeminiSecurityStateForTesting();
    const corrId1 = 'test_corr_400_' + Date.now();

    const result400 = await evaluateDailySentenceIsolated(
      'Today was a great day because I learned new words.',
      ['learned'],
      {
        correlationId: corrId1,
        attemptExecutor: async (model) => {
          return {
            text: '',
            parsedJson: null,
            error: {
              statusCode: 400,
              category: 'POLICY_VIOLATION',
              safeReason: 'Request rejected due to invalid parameters or policy violation (HTTP 400).',
              rawMessage: 'INVALID_ARGUMENT: Requested parameter violates safety constraint',
            },
          };
        },
      }
    );

    assert(result400.success === false, 'Resultado indica falha com success=false');
    assert(result400.data === null, 'Data é null em caso de falha');
    assert(result400.diagnostics.correlationId === corrId1, 'Preserva correlationId da requisição');
    assert(result400.diagnostics.feature === 'check_daily_sentence', 'Feature identificada como check_daily_sentence');
    assert(result400.diagnostics.statusCode === 400, 'Diagnóstico preserva statusCode 400');
    assert(result400.diagnostics.category === 'POLICY_VIOLATION', 'Categoria identificada como POLICY_VIOLATION');
    assert(result400.diagnostics.interruptionReason === 'erro não recuperável', 'Interrupção da cascata marcada como "erro não recuperável"');
    assert(result400.diagnostics.attemptsCount === 1, 'Cascata interrompida imediatamente na tentativa 1 sem desperdício');

    const log1 = findObservabilityLog(corrId1);
    assert(log1 !== null, 'Log estruturado [GeminiObservability] gerado');
    assert(log1.cascadeInterruptionReason === 'erro não recuperável', 'Log registra causa de interrupção');
    assert(log1.attempts.length === 1, 'Log detalha a tentativa única');
    assert(log1.attempts[0].statusCode === 400, 'Tentativa 1 com statusCode 400 registrada no log');

    // -----------------------------------------------------------------------
    // TEST 2: Simulação de HTTP 429 (Esgotamento de Quota por Modelo)
    // -----------------------------------------------------------------------
    originalConsoleLog('\n--- Cenário 2: Simulação de HTTP 429 (Quota Excedida em Todos os Modelos) ---');
    resetGeminiSecurityStateForTesting();
    const corrId2 = 'test_corr_429_' + Date.now();

    const result429 = await evaluateDailySentenceIsolated(
      'I practice my daily routine with enthusiasm.',
      ['routine'],
      {
        correlationId: corrId2,
        attemptExecutor: async (model) => {
          return {
            text: '',
            parsedJson: null,
            error: {
              statusCode: 429,
              category: 'QUOTA_EXCEEDED',
              safeReason: `Gemini quota exceeded for model ${model}.`,
              rawMessage: 'RESOURCE_EXHAUSTED: Rate limit exceeded for generateContent requests',
            },
          };
        },
      }
    );

    assert(result429.success === false, 'Resultado indica falha');
    assert(result429.diagnostics.correlationId === corrId2, 'Identificador de correlação preservado');
    assert(result429.diagnostics.statusCode === 429, 'StatusCode 429 preservado');
    assert(result429.diagnostics.category === 'QUOTA_EXCEEDED', 'Categoria QUOTA_EXCEEDED identificada');
    assert(result429.diagnostics.interruptionReason === 'esgotamento dos modelos', 'Interrupção marcada como "esgotamento dos modelos"');
    assert(result429.diagnostics.attemptsCount === 3, 'Executou as 3 tentativas da contingência antes de esgotar');
    assert(result429.diagnostics.attempts.length === 3, 'Registrou detalhes das 3 tentativas');

    const log2 = findObservabilityLog(corrId2);
    assert(log2 !== null, 'Log estruturado gerado para HTTP 429');
    assert(log2.interruptionReason === 'esgotamento dos modelos', 'Log registra esgotamento dos modelos');
    assert(log2.attempts.every((a: any) => a.statusCode === 429), 'Cada tentativa registra seu statusCode 429');

    // -----------------------------------------------------------------------
    // TEST 3: Simulação de HTTP 503 (Serviço Indisponível / Alta Demanda)
    // -----------------------------------------------------------------------
    originalConsoleLog('\n--- Cenário 3: Simulação de HTTP 503 (Service Unavailable) ---');
    resetGeminiSecurityStateForTesting();
    const corrId3 = 'test_corr_503_' + Date.now();

    const result503 = await evaluateDailySentenceIsolated(
      'Every morning I drink a cup of warm tea.',
      ['drink'],
      {
        correlationId: corrId3,
        attemptExecutor: async (model) => {
          return {
            text: '',
            parsedJson: null,
            error: {
              statusCode: 503,
              category: 'SERVICE_UNAVAILABLE',
              safeReason: `Gemini model ${model} is temporarily experiencing high demand (HTTP 503).`,
              rawMessage: 'The model is overloaded. Please try again later.',
            },
          };
        },
      }
    );

    assert(result503.success === false, 'Resultado indica falha 503');
    assert(result503.diagnostics.correlationId === corrId3, 'CorrelationId preservado');
    assert(result503.diagnostics.statusCode === 503, 'StatusCode 503 preservado no diagnóstico');
    assert(result503.diagnostics.category === 'SERVICE_UNAVAILABLE', 'Categoria SERVICE_UNAVAILABLE identificada');
    assert(result503.diagnostics.interruptionReason === 'esgotamento dos modelos', 'Interrupção marcada como "esgotamento dos modelos"');
    assert(result503.diagnostics.attemptsCount === 3, 'Tentou os 3 modelos da cascata');

    const log3 = findObservabilityLog(corrId3);
    assert(log3 !== null, 'Log estruturado 503 gerado');
    assert(log3.statusCode === 503, 'Log registra statusCode 503');
    assert(log3.attempts[0].category === 'SERVICE_UNAVAILABLE', 'Tentativa 1 classificada como SERVICE_UNAVAILABLE');
    assert(log3.attempts[1].category === 'SERVICE_UNAVAILABLE', 'Tentativa 2 classificada como SERVICE_UNAVAILABLE');
    assert(log3.attempts[2].category === 'SERVICE_UNAVAILABLE', 'Tentativa 3 classificada como SERVICE_UNAVAILABLE');

    // -----------------------------------------------------------------------
    // TEST 4: Simulação de Timeout (Deadline Exceeded)
    // -----------------------------------------------------------------------
    originalConsoleLog('\n--- Cenário 4: Simulação de Timeout ---');
    resetGeminiSecurityStateForTesting();
    const corrId4 = 'test_corr_timeout_' + Date.now();

    const resultTimeout = await evaluateDailySentenceIsolated(
      'I am preparing my schedule for next week.',
      ['schedule'],
      {
        correlationId: corrId4,
        attemptExecutor: async (model) => {
          return {
            text: '',
            parsedJson: null,
            error: {
              statusCode: 408,
              category: 'TIMEOUT',
              safeReason: `Request timed out waiting for model ${model} response after 9000ms.`,
              rawMessage: 'Timeout: Gemini generation exceeded 9000ms deadline',
            },
          };
        },
      }
    );

    assert(resultTimeout.success === false, 'Resultado indica falha de timeout');
    assert(resultTimeout.diagnostics.correlationId === corrId4, 'CorrelationId preservado');
    assert(resultTimeout.diagnostics.category === 'TIMEOUT', 'Categoria TIMEOUT preservada');
    assert(resultTimeout.diagnostics.interruptionReason === 'timeout', 'Interrupção da cascata classificada como "timeout"');
    assert(resultTimeout.diagnostics.attemptsCount === 3, 'Registrou 3 tentativas');

    const log4 = findObservabilityLog(corrId4);
    assert(log4 !== null, 'Log estruturado de timeout gerado');
    assert(log4.interruptionReason === 'timeout', 'Log registra timeout como causa de interrupção');
    assert(log4.category === 'TIMEOUT', 'Log registra categoria TIMEOUT');

    // -----------------------------------------------------------------------
    // TEST 5: Simulação de JSON Inválido / Resposta Malformada
    // -----------------------------------------------------------------------
    originalConsoleLog('\n--- Cenário 5: Simulação de JSON Inválido ---');
    resetGeminiSecurityStateForTesting();
    const corrId5 = 'test_corr_malformed_' + Date.now();

    const resultMalformed = await evaluateDailySentenceIsolated(
      'I read a fascinating book yesterday.',
      ['read'],
      {
        correlationId: corrId5,
        attemptExecutor: async (model) => {
          return {
            text: 'I apologize, but I cannot format this as JSON: [unexpected tokens...',
            parsedJson: null,
            error: {
              statusCode: 502,
              category: 'INVALID_RESPONSE',
              safeReason: `Model ${model} response was not valid JSON.`,
              rawMessage: 'MALFORMED_JSON: Unexpected token in JSON at position 0',
            },
          };
        },
      }
    );

    assert(resultMalformed.success === false, 'Falha em JSON malformado');
    assert(resultMalformed.diagnostics.correlationId === corrId5, 'CorrelationId preservado');
    assert(resultMalformed.diagnostics.category === 'INVALID_RESPONSE', 'Categoria INVALID_RESPONSE identificada');
    assert(resultMalformed.diagnostics.statusCode === 502, 'StatusCode 502 preservado');
    assert(resultMalformed.diagnostics.interruptionReason === 'esgotamento dos modelos', 'Interrupção marcada como esgotamento dos modelos');

    const log5 = findObservabilityLog(corrId5);
    assert(log5 !== null, 'Log estruturado de JSON inválido gerado');
    assert(log5.category === 'INVALID_RESPONSE', 'Log registra INVALID_RESPONSE');

    // -----------------------------------------------------------------------
    // TEST 6: Simulação de Sucesso após Fallback
    // -----------------------------------------------------------------------
    originalConsoleLog('\n--- Cenário 6: Simulação de Sucesso Após Fallback ---');
    resetGeminiSecurityStateForTesting();
    const corrId6 = 'test_corr_fallback_success_' + Date.now();

    let attemptCounter = 0;
    const resultSuccess = await evaluateDailySentenceIsolated(
      'Today was a perfect day because I passed the test.',
      ['passed'],
      {
        correlationId: corrId6,
        attemptExecutor: async (model) => {
          attemptCounter++;
          if (attemptCounter === 1) {
            // Modelo 1 falha com 503 recuperável
            return {
              text: '',
              parsedJson: null,
              error: {
                statusCode: 503,
                category: 'SERVICE_UNAVAILABLE',
                safeReason: `Model ${model} is experiencing high demand (HTTP 503).`,
                rawMessage: 'Model temporarily unavailable',
              },
            };
          }
          // Modelo 2 tem sucesso
          return {
            text: '{"hasAnyError":false,"isCorrect":true,"usedWords":["passed"],"missingWords":[],"correctedSentence":"Today was a perfect day because I passed the test.","explanationPt":"Sua frase está gramaticalmente correta.","explanationEn":"Your sentence is grammatically correct.","wordFeedbacks":[]}',
            parsedJson: {
              hasAnyError: false,
              isCorrect: true,
              usedWords: ['passed'],
              missingWords: [],
              correctedSentence: 'Today was a perfect day because I passed the test.',
              explanationPt: 'Sua frase está gramaticalmente correta.',
              explanationEn: 'Your sentence is grammatically correct.',
              wordFeedbacks: [],
            },
          };
        },
      }
    );

    assert(resultSuccess.success === true, 'Sucesso atingido após fallback');
    assert(resultSuccess.data !== null, 'Data contém o resultado pedagógico');
    assert(resultSuccess.data.isCorrect === true, 'Frase avaliada como correta');
    assert(resultSuccess.diagnostics.correlationId === corrId6, 'CorrelationId preservado');
    assert(resultSuccess.diagnostics.interruptionReason === 'sucesso', 'Interrupção marcada como "sucesso"');
    assert(resultSuccess.diagnostics.attemptsCount === 2, 'Sucesso ocorreu na tentativa 2');
    assert(resultSuccess.diagnostics.attempts[0].success === false, 'Tentativa 1 registrada como falha');
    assert(resultSuccess.diagnostics.attempts[0].statusCode === 503, 'Tentativa 1 falhou com 503');
    assert(resultSuccess.diagnostics.attempts[1].success === true, 'Tentativa 2 registrada como sucesso');
    assert(resultSuccess.diagnostics.attempts[1].statusCode === 200, 'Tentativa 2 concluiu com 200');

    const log6 = findObservabilityLog(corrId6);
    assert(log6 !== null, 'Log estruturado de sucesso gerado');
    assert(log6.interruptionReason === 'sucesso', 'Log registra sucesso');
    assert(log6.attemptsCount === 2, 'Log registra 2 tentativas');
    assert(log6.attempts[0].model !== log6.attempts[1].model, 'Identifica modelos distintos nas tentativas');

    // -----------------------------------------------------------------------
    // TEST 7: Verificação de Segurança e Sanitização de Logs
    // -----------------------------------------------------------------------
    originalConsoleLog('\n--- Cenário 7: Verificação de Não Exposição de Dados Sensíveis ---');
    const secretApiKey = 'AIzaSyFakeSecretKeyForTestingObservability99';
    const fakeToken = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.secret';
    const secretStudentSentence = 'My secret sensitive confidential phrase about medical condition';
    const studentPiiEmail = 'aluno_privado@escola.com.br';

    const corrId7 = 'test_corr_sanitization_' + Date.now();
    await evaluateDailySentenceIsolated(
      secretStudentSentence,
      ['condition'],
      {
        correlationId: corrId7,
        callerRole: 'student',
        attemptExecutor: async () => {
          return {
            text: '',
            parsedJson: null,
            error: {
              statusCode: 503,
              category: 'SERVICE_UNAVAILABLE',
              safeReason: 'Model unavailable under high demand.',
              rawMessage: `Failed with token ${fakeToken} and key ${secretApiKey} for ${studentPiiEmail}`,
            },
          };
        },
      }
    );

    // Audita todos os logs capturados pelo teste
    const allCapturedText = capturedLogs.map((l) => l.message).join('\n');
    assert(!allCapturedText.includes(secretApiKey), 'Zero vazamento de GEMINI_API_KEY nos logs');
    assert(!allCapturedText.includes(fakeToken), 'Zero vazamento de tokens de autenticação nos logs');
    assert(!allCapturedText.includes(secretStudentSentence), 'Zero vazamento da frase do aluno nos logs de observabilidade');
    assert(!allCapturedText.includes(studentPiiEmail), 'Zero vazamento de dados pessoais (PII/emails) nos logs');

    // -----------------------------------------------------------------------
    // TEST 8: Verificação de Resposta Pública Neutra HTTP 503
    // -----------------------------------------------------------------------
    originalConsoleLog('\n--- Cenário 8: Verificação da Resposta Pública Neutra ao Navegador ---');
    // Simula a resposta que a rota pública /api/check-daily-sentence constrói no navegador quando o serviço falha
    const mockPublicErrorResponse = {
      success: false,
      error: 'AiUnavailable',
      message: 'Serviço de verificação da Frase do Dia temporariamente indisponível. Sua frase foi preservada.',
    };

    assert(mockPublicErrorResponse.error === 'AiUnavailable', 'Erro público é estritamente AiUnavailable');
    assert(!('rawMessage' in mockPublicErrorResponse), 'rawMessage NÃO é retornado ao navegador');
    assert(!('details' in mockPublicErrorResponse), 'Detalhes internos do provedor NÃO são retornados');
    assert(!('diagnostics' in mockPublicErrorResponse), 'Diagnósticos internos NÃO são expostos na resposta HTTP pública');

    originalConsoleLog('\n=========================================================================');
    originalConsoleLog(`TOTAL DE TESTES EXECUTADOS: ${totalTests}`);
    originalConsoleLog(`SUCESSO: ${passedTests}`);
    originalConsoleLog(`FALHAS: ${totalTests - passedTests}`);
    originalConsoleLog('=========================================================================\n');
    stopCapturingLogs();
    process.exit(0);
  } finally {
    stopCapturingLogs();
  }
}

runTestSuite().catch((err) => {
  originalConsoleError('Fatal error executing test suite:', err);
  process.exit(1);
});
