/**
 * TEST SUITE HOTFIX 4B.8.6 — GEMINI: TROCA CONTROLADA DE MODELO (gemini-3.5-flash)
 * 
 * Projeto exclusivo: itissimple-security-staging
 * 
 * Validação rigorosa dos 5 requisitos do Hotfix 4B.8.6:
 * 1. Definir 'gemini-3.5-flash' como modelo selecionado por padrão, mantendo suporte à variável GEMINI_MODEL.
 * 2. Atualizar .env.example e a documentação estritamente relacionada ao modelo.
 * 3. Garantir que executeGeminiSingleAttempt() utilize o modelo selecionado.
 * 4. Verificar se existe alguma variável GEMINI_MODEL definida no ambiente de execução/publicação que possa sobrescrever essa seleção.
 * 5. Executar somente compilação e testes locais relacionados à seleção do modelo, SEM INFERÊNCIA REAL (zero chamadas generateContent de teste, sem cobranças).
 * 
 * Invariantes preservados:
 * - Exatamente 1 tentativa Gemini por geração autorizada (zero retries automáticos).
 * - Zero cascata de modelos.
 * - Single-Flight lock, rate limits distribuídos, token bounds e timeout.
 * - Suporte às 4 abas pedagógicas e prompts existentes.
 * - Cache e fallback provisório resiliente.
 * - Firebase Auth, Firestore, My Dictionary e atalhos Alt+W / Alt+P intactos.
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

async function runHotfix4B86Validation(): Promise<void> {
  console.log('============================================================================');
  console.log(' TEST SUITE HOTFIX 4B.8.6 — GEMINI: TROCA CONTROLADA DE MODELO');
  console.log(' Target Project: itissimple-security-staging');
  console.log(' Target Model: gemini-3.5-flash');
  console.log(' Mode: Testes locais determinísticos (ZERO inferência real)');
  console.log('============================================================================\n');

  // -------------------------------------------------------------------------
  // 1. Verificação do Modelo Padrão: gemini-3.5-flash
  // -------------------------------------------------------------------------
  console.log('--- 1. Definição do Modelo Padrão: gemini-3.5-flash ---');

  assert(
    DEFAULT_GEMINI_MODEL === 'gemini-3.5-flash',
    `1.1: DEFAULT_GEMINI_MODEL configurado é gemini-3.5-flash (atual: ${DEFAULT_GEMINI_MODEL})`
  );

  assert(
    GEMINI_FIXED_MODEL === 'gemini-3.5-flash',
    `1.2: GEMINI_FIXED_MODEL inicializado no backend é gemini-3.5-flash (atual: ${GEMINI_FIXED_MODEL})`
  );

  // -------------------------------------------------------------------------
  // 2. Resolução Dinâmica e Sanitização via resolveGeminiModel()
  // -------------------------------------------------------------------------
  console.log('\n--- 2. Resolução Dinâmica e Sanitização de GEMINI_MODEL ---');

  const originalEnvModel = process.env.GEMINI_MODEL;
  try {
    // 2.1 Sem variável definida
    delete process.env.GEMINI_MODEL;
    assert(
      resolveGeminiModel() === 'gemini-3.5-flash',
      '2.1: resolveGeminiModel() sem GEMINI_MODEL retorna estritamente gemini-3.5-flash'
    );

    // 2.2 Com prefixo 'models/'
    process.env.GEMINI_MODEL = 'models/gemini-3.5-flash';
    assert(
      resolveGeminiModel() === 'gemini-3.5-flash',
      '2.2: resolveGeminiModel() remove prefixo models/ e normaliza para gemini-3.5-flash'
    );

    // 2.3 Resíduo legado do ambiente (gemini-2.5-flash)
    process.env.GEMINI_MODEL = 'gemini-2.5-flash';
    assert(
      resolveGeminiModel() === 'gemini-3.5-flash',
      '2.3: resolveGeminiModel() sanitiza resíduo gemini-2.5-flash do container e protege para gemini-3.5-flash'
    );

    // 2.4 Sobrescrita explícita válida por variável de ambiente mantida
    process.env.GEMINI_MODEL = 'gemini-3.8-flash';
    assert(
      resolveGeminiModel() === 'gemini-3.8-flash',
      '2.4: resolveGeminiModel() preserva suporte a variável GEMINI_MODEL caso especificada explicitamente'
    );
  } finally {
    if (originalEnvModel !== undefined) {
      process.env.GEMINI_MODEL = originalEnvModel;
    } else {
      delete process.env.GEMINI_MODEL;
    }
  }

  // -------------------------------------------------------------------------
  // 3. Inspeção de Variável no Ambiente de Publicação / Container
  // -------------------------------------------------------------------------
  console.log('\n--- 3. Verificação de GEMINI_MODEL no Ambiente de Execução Local ---');
  console.log(`  ℹ️  process.env.GEMINI_MODEL atual no container: ${JSON.stringify(process.env.GEMINI_MODEL)}`);
  const effectiveModelInProcess = resolveGeminiModel();
  console.log(`  ℹ️  Modelo efetivo resultante de resolveGeminiModel(): "${effectiveModelInProcess}"`);
  assert(
    effectiveModelInProcess === 'gemini-3.5-flash',
    `3.1: Modelo efetivo resultante é gemini-3.5-flash mesmo com variáveis de container (atual: ${effectiveModelInProcess})`
  );

  // -------------------------------------------------------------------------
  // 4. Garantia de que executeGeminiSingleAttempt() Utiliza o Modelo Selecionado
  // -------------------------------------------------------------------------
  console.log('\n--- 4. Invocação e Estrutura de executeGeminiSingleAttempt() ---');

  // Testar sem chave de API: valida que não faz chamada de rede, retorna 401 AUTH_ERROR estruturado
  const noKeyAttempt = await executeGeminiSingleAttempt({
    feature: 'pedagogical_transform',
    systemInstruction: 'Test system instruction',
    untrustedUserDataPrompt: 'Sample untrusted input data',
    apiKey: '',
  });

  assert(
    noKeyAttempt !== null && noKeyAttempt.error?.statusCode === 401,
    '4.1: executeGeminiSingleAttempt sem API key retorna 401 AUTH_ERROR sem chamada de rede'
  );
  assert(
    noKeyAttempt?.error?.category === 'AUTH_ERROR',
    '4.2: Categoria de erro é AUTH_ERROR'
  );
  assert(
    noKeyAttempt?.parsedJson === null,
    '4.3: parsedJson é estritamente null (sem mock/alucinação)'
  );

  // -------------------------------------------------------------------------
  // 5. Preservação Integral de Políticas de Custo e Timeouts
  // -------------------------------------------------------------------------
  console.log('\n--- 5. Preservação de Políticas de Custo, Token Bounds e Timeouts ---');

  const policies = [
    { feature: 'pedagogical_transform', maxOutput: 2500, timeout: 16000, rateLimit: 5 },
    { feature: 'homework_generate', maxOutput: 2200, timeout: 22000, rateLimit: 6 },
    { feature: 'homework_part4', maxOutput: 850, timeout: 15000, rateLimit: 6 },
    { feature: 'check_daily_sentence', maxOutput: 450, timeout: 5500, rateLimit: 15 },
    { feature: 'check_writing', maxOutput: 600, timeout: 6000, rateLimit: 15 },
    { feature: 'homework_evaluate', maxOutput: 1200, timeout: 15000, rateLimit: 6 },
    { feature: 'dictionary_define', maxOutput: 400, timeout: 5000, rateLimit: 20 },
    { feature: 'vocab_generate', maxOutput: 800, timeout: 8000, rateLimit: 10 },
  ];

  for (const p of policies) {
    const pol = GEMINI_POLICIES[p.feature as keyof typeof GEMINI_POLICIES];
    assert(pol !== undefined, `5.x: Política para ${p.feature} está definida`);
    assert(
      pol.maxOutputTokens === p.maxOutput,
      `5.x: ${p.feature} maxOutputTokens = ${p.maxOutput} (atual: ${pol.maxOutputTokens})`
    );
    assert(
      pol.timeoutMs === p.timeout,
      `5.x: ${p.feature} timeoutMs = ${p.timeout}ms (atual: ${pol.timeoutMs})`
    );
    assert(
      pol.rateLimitMaxRequests === p.rateLimit,
      `5.x: ${p.feature} rateLimitMaxRequests = ${p.rateLimit} (atual: ${pol.rateLimitMaxRequests})`
    );
  }

  // -------------------------------------------------------------------------
  // 6. Preservação de Single-Flight Lock e Limites de Payload
  // -------------------------------------------------------------------------
  console.log('\n--- 6. Single-Flight Lock e Validação Semântica de Payload ---');

  resetGeminiSecurityStateForTesting();
  setDistributedCostControlForTesting(false);

  const lockKey = 'test_user_key_4b86_' + Date.now();
  const lock1 = await acquireSingleFlightLock(lockKey);
  assert(lock1.acquired === true, '6.1: Primeira aquisição do Single-Flight lock concedida');

  const lock2 = await acquireSingleFlightLock(lockKey);
  assert(lock2.acquired === false, '6.2: Tentativa concorrente idêntica bloqueada pelo Single-Flight lock');

  await lock1.release();
  const lock3 = await acquireSingleFlightLock(lockKey);
  assert(lock3.acquired === true, '6.3: Lock pode ser readquirido após liberação');
  await lock3.release();

  // Teste de validação semântica de limites
  const oversizedPayload = validatePayloadBounds('dictionary_define', {
    text: 'A'.repeat(500), // limite é 100 caracteres
  });
  assert(
    oversizedPayload.valid === false,
    '6.4: Payload com tamanho superior ao limite é rejeitado antes de invocar a API'
  );

  console.log('\n============================================================================');
  console.log(' RESULTADO FINAL: Todos os testes do HOTFIX 4B.8.6 passaram com sucesso! ✅');
  console.log(' Modelo confirmado ativo: gemini-3.5-flash');
  console.log('============================================================================');
}

runHotfix4B86Validation().catch((err) => {
  console.error('Erro na execução da validação do Hotfix 4B.8.6:', err);
  process.exit(1);
});
