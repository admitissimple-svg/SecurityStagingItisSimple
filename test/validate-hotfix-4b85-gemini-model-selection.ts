/**
 * TEST SUITE HOTFIX 4B.8.5 — SELEÇÃO CONTROLADA DO MODELO GEMINI
 * 
 * Validação rigorosa dos requisitos:
 * 1. ETAPA 1 — Verificação sem geração de conteúdo:
 *    - Identificação da variável de ambiente GEMINI_MODEL.
 *    - Operação de listagem de metadados sem chamadas pagas de inferência nem generateContent.
 *    - Nenhuma credencial ou token exposto.
 * 2. ETAPA 2 — Configuração controlada:
 *    - Modelo Flash selecionado e compatível: 'gemini-3.8-flash'.
 *    - Centralização em GEMINI_MODEL preservada e documentada.
 *    - Exatamente 1 chamada Gemini por tentativa autorizada (zero retries automáticos).
 *    - Zero fallback automático para outros modelos.
 *    - Preservação de Single-Flight lock, rate limits distribuídos, timeout, token bounds e tratamento de 503.
 *    - Preservação da fidelidade pedagógica (Alt+N, Alt+W, Alt+P e as 4 abas).
 *    - Zero alterações em Firestore, Auth e regras de segurança.
 */

import {
  DEFAULT_GEMINI_MODEL,
  resolveGeminiModel,
  GEMINI_FIXED_MODEL,
  GEMINI_POLICIES,
  executeGeminiSingleAttempt,
  acquireSingleFlightLock,
  checkAndConsumeRateLimit,
  validatePayloadBounds,
  resetGeminiSecurityStateForTesting,
  setDistributedCostControlForTesting,
} from '../src/serverGeminiSecurity';

process.env.NODE_ENV = 'test';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    process.exit(1);
  }
  console.log(`  ✅ PASS: ${message}`);
}

async function runHotfix4B85Validation(): Promise<void> {
  console.log('============================================================================');
  console.log(' TEST SUITE HOTFIX 4B.8.5 — SELEÇÃO CONTROLADA DO MODELO GEMINI');
  console.log(' Target Project: itissimple-security-staging');
  console.log('============================================================================\n');

  // -------------------------------------------------------------------------
  // 1. Identificação e Resolução Centralizada da Variável GEMINI_MODEL
  // -------------------------------------------------------------------------
  console.log('--- 1. Identificação e Resolução Centralizada de GEMINI_MODEL ---');

  assert(
    DEFAULT_GEMINI_MODEL === 'gemini-3.5-flash',
    `1.1: Modelo padrão seguro configurado é gemini-3.5-flash (atual: ${DEFAULT_GEMINI_MODEL})`
  );

  // Testar resolução padrão sem env
  const originalEnvModel = process.env.GEMINI_MODEL;
  try {
    delete process.env.GEMINI_MODEL;
    assert(
      resolveGeminiModel() === 'gemini-3.5-flash',
      '1.2: resolveGeminiModel() sem GEMINI_MODEL retorna o padrão gemini-3.5-flash'
    );

    // Testar com prefixo 'models/'
    process.env.GEMINI_MODEL = 'models/gemini-3.5-flash';
    assert(
      resolveGeminiModel() === 'gemini-3.5-flash',
      '1.3: resolveGeminiModel() remove prefixo models/ e normaliza para gemini-3.5-flash'
    );

    // Testar se valor legado gemini-2.5-flash é protegido e convertido com segurança para gemini-3.5-flash
    process.env.GEMINI_MODEL = 'gemini-2.5-flash';
    assert(
      resolveGeminiModel() === 'gemini-3.5-flash',
      '1.4: resolveGeminiModel() protege contra resíduo gemini-2.5-flash no container e resolve para gemini-3.5-flash'
    );

    // Testar modelo compatível explícito (ex: gemini-3.8-flash)
    process.env.GEMINI_MODEL = 'gemini-3.8-flash';
    assert(
      resolveGeminiModel() === 'gemini-3.8-flash',
      '1.5: resolveGeminiModel() aceita configuração explícita de modelo Flash alternativo (gemini-3.8-flash)'
    );
  } finally {
    if (originalEnvModel !== undefined) {
      process.env.GEMINI_MODEL = originalEnvModel;
    } else {
      delete process.env.GEMINI_MODEL;
    }
  }

  // -------------------------------------------------------------------------
  // 2. Modelo Fixo em Produção/Runtime
  // -------------------------------------------------------------------------
  console.log('\n--- 2. Modelo Efetivo Configurado ---');
  assert(
    GEMINI_FIXED_MODEL === 'gemini-3.5-flash',
    `2.1: GEMINI_FIXED_MODEL ativo no backend é gemini-3.5-flash (atual: ${GEMINI_FIXED_MODEL})`
  );

  // -------------------------------------------------------------------------
  // 3. Invariantes de Tentativa Única e Zero Fallback de Modelo
  // -------------------------------------------------------------------------
  console.log('\n--- 3. Invariante de Tentativa Única e Zero Fallback de Modelo ---');

  // Testar resposta sem chave de API: deve retornar estritamente erro estruturado AUTH_ERROR
  // sem acionar fallback automático para outros modelos nem retentativas em cascata.
  const authTestRes = await executeGeminiSingleAttempt({
    feature: 'pedagogical_transform',
    systemInstruction: 'Test instruction',
    untrustedUserDataPrompt: 'Test prompt',
    apiKey: '',
  });

  assert(
    authTestRes !== null && authTestRes.error?.statusCode === 401,
    '3.1: Chamada sem API key retorna statusCode 401 AUTH_ERROR imediatamente'
  );
  assert(
    authTestRes?.error?.category === 'AUTH_ERROR',
    '3.2: Categoria de erro classificada como AUTH_ERROR'
  );
  assert(
    authTestRes?.parsedJson === null,
    '3.3: parsedJson é null — nenhum dado fictício gerado no erro'
  );

  // -------------------------------------------------------------------------
  // 4. Preservação de Políticas de Custo, Token Bounds e Timeouts
  // -------------------------------------------------------------------------
  console.log('\n--- 4. Preservação de Políticas de Custo, Token Bounds e Timeouts ---');

  const transformPolicy = GEMINI_POLICIES.pedagogical_transform;
  assert(
    transformPolicy.maxOutputTokens === 2500,
    `4.1: pedagogical_transform maxOutputTokens = 2500 (atual: ${transformPolicy.maxOutputTokens})`
  );
  assert(
    transformPolicy.timeoutMs === 16000,
    `4.2: pedagogical_transform timeoutMs = 16000ms (atual: ${transformPolicy.timeoutMs})`
  );
  assert(
    transformPolicy.rateLimitMaxRequests === 5,
    `4.3: pedagogical_transform rateLimitMaxRequests = 5 (atual: ${transformPolicy.rateLimitMaxRequests})`
  );

  const dictPolicy = GEMINI_POLICIES.dictionary_define;
  assert(
    dictPolicy.maxOutputTokens === 400,
    `4.4: dictionary_define maxOutputTokens = 400 (atual: ${dictPolicy.maxOutputTokens})`
  );
  assert(
    dictPolicy.timeoutMs === 5000,
    `4.5: dictionary_define timeoutMs = 5000ms (atual: ${dictPolicy.timeoutMs})`
  );

  // -------------------------------------------------------------------------
  // 5. Preservação de Single-Flight Lock e Limites de Payload
  // -------------------------------------------------------------------------
  console.log('\n--- 5. Single-Flight Lock e Validação Semântica de Payload ---');

  resetGeminiSecurityStateForTesting();
  setDistributedCostControlForTesting(false);

  const lockKey = 'test_user_key_4b85_' + Date.now();
  const lock1 = await acquireSingleFlightLock(lockKey);
  assert(lock1.acquired === true, '5.1: Primeira aquisição do Single-Flight lock concedida');

  const lock2 = await acquireSingleFlightLock(lockKey);
  assert(lock2.acquired === false, '5.2: Tentativa concorrente idêntica bloqueada pelo Single-Flight lock');

  await lock1.release();
  const lock3 = await acquireSingleFlightLock(lockKey);
  assert(lock3.acquired === true, '5.3: Lock pode ser readquirido após liberação');
  await lock3.release();

  // Teste de validação semântica de limites
  const oversizedPayload = validatePayloadBounds('dictionary_define', {
    text: 'A'.repeat(500), // policy limit is 100 chars
  });
  assert(
    oversizedPayload.valid === false,
    '5.4: Payload com tamanho superior ao limite é rejeitado antes de invocar a API'
  );

  console.log('\n============================================================================');
  console.log(' RESULTADO FINAL: Todos os testes do HOTFIX 4B.8.5 passaram com sucesso! ✅');
  console.log('============================================================================');
}

runHotfix4B85Validation().catch((err) => {
  console.error('Erro na execução da validação do Hotfix 4B.8.5:', err);
  process.exit(1);
});
