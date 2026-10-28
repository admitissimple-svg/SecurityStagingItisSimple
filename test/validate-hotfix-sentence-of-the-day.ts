/**
 * TEST SUITE — HOTFIX CIRÚRGICO: SENTENCE OF THE DAY & CONTINGENCY
 * 
 * Verificação direcionada, sem chamadas de rede reais ao Gemini:
 * 1. Ordem correta dos três modelos: gemini-3.8-flash -> gemini-3.5-flash-lite -> gemini-3.1-flash-lite.
 * 2. Configuração de thinking compatível: remoção de thinkingBudget: 0, uso de thinkingLevel: LOW para Gemini 3/4, omissão segura quando incompatível.
 * 3. Retorno imediato após sucesso (sem chamadas adicionais desnecessárias).
 * 4. Fallback após HTTP 404 (modelo não encontrado/descontinuado na região).
 * 5. Fallback após HTTP 503 (serviço sobrecarregado / alta demanda).
 * 6. Fallback após HTTP 400 especificamente relacionado à configuração incompatível de parâmetros/thinking.
 * 7. Preservação estrita dos bloqueios de autenticação (401/403/apiKey) e segurança (safety/harm).
 * 8. Retorno AiUnavailable (HTTP 503) somente quando nenhuma alternativa produzir resultado válido ou houver impedimento não-recuperável.
 * 9. Preservação das funcionalidades existentes e sanitização de variáveis de ambiente legadas.
 */

import {
  DEFAULT_GEMINI_MODEL,
  GEMINI_CONTINGENCY_MODELS,
  DEFAULT_CONTINGENCY_POOL,
  resolveGeminiModel,
  resolveGeminiContingencyModels,
  resolveThinkingConfig,
  isLegacyOrInvalidModel,
  isModelConfigIncompatibleError,
  isNonRecoverableGeminiError,
  executeGeminiWithContingency,
  executeGeminiSingleAttempt,
  validatePayloadBounds,
  checkAndConsumeRateLimit,
  acquireSingleFlightLock,
  resetGeminiSecurityStateForTesting,
  GEMINI_POLICIES,
  GeminiFeature,
} from '../src/serverGeminiSecurity';
import { ThinkingLevel } from '@google/genai';

process.env.NODE_ENV = 'test';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    process.exit(1);
  }
  console.log(`  ✅ PASS: ${message}`);
}

async function runSentenceOfTheDayHotfixTests(): Promise<void> {
  console.log('============================================================================');
  console.log(' TEST SUITE: HOTFIX CIRÚRGICO — SENTENCE OF THE DAY');
  console.log(' Sequência Padrão: gemini-3.8-flash -> gemini-3.5-flash-lite -> gemini-3.1-flash-lite');
  console.log(' Modo: 100% Determinístico local (Zero chamadas de rede pagas à API)');
  console.log('============================================================================\n');

  resetGeminiSecurityStateForTesting();

  // -------------------------------------------------------------------------
  // 1. Ordem correta dos três modelos e sanitização de variáveis de ambiente
  // -------------------------------------------------------------------------
  console.log('--- 1. Ordem Correta dos Três Modelos e Sanitização de Variáveis ---');

  assert(
    DEFAULT_GEMINI_MODEL === 'gemini-3.8-flash',
    `1.1: DEFAULT_GEMINI_MODEL padrão é 'gemini-3.8-flash' (atual: ${DEFAULT_GEMINI_MODEL})`
  );

  assert(
    Array.isArray(GEMINI_CONTINGENCY_MODELS) && GEMINI_CONTINGENCY_MODELS.length === 3,
    '1.2: GEMINI_CONTINGENCY_MODELS possui exatamente 3 modelos'
  );

  assert(
    GEMINI_CONTINGENCY_MODELS[0] === 'gemini-3.8-flash' &&
    GEMINI_CONTINGENCY_MODELS[1] === 'gemini-3.5-flash-lite' &&
    GEMINI_CONTINGENCY_MODELS[2] === 'gemini-3.1-flash-lite',
    `1.3: Sequência exata de contingência: [gemini-3.8-flash, gemini-3.5-flash-lite, gemini-3.1-flash-lite]`
  );

  const defaultSequence = resolveGeminiContingencyModels();
  assert(
    defaultSequence[0] === 'gemini-3.8-flash' &&
    defaultSequence[1] === 'gemini-3.5-flash-lite' &&
    defaultSequence[2] === 'gemini-3.1-flash-lite',
    '1.4: resolveGeminiContingencyModels() sem env vars retorna a sequência padrão'
  );

  // Teste de sanitização de modelo legado (ex: gemini-2.5-flash ou gemini-1.5-flash)
  const originalEnvModel = process.env.GEMINI_MODEL;
  try {
    process.env.GEMINI_MODEL = 'gemini-2.5-flash';
    assert(
      isLegacyOrInvalidModel('gemini-2.5-flash'),
      '1.5a: isLegacyOrInvalidModel identifica gemini-2.5-flash como legado'
    );
    assert(
      isLegacyOrInvalidModel('gemini-1.5-pro'),
      '1.5b: isLegacyOrInvalidModel identifica gemini-1.5-pro como legado'
    );
    const sanitizedPrimary = resolveGeminiModel();
    assert(
      sanitizedPrimary === 'gemini-3.8-flash',
      `1.5c: resolveGeminiModel() rejeita modelo legado e reverte seguramente para gemini-3.8-flash (resultado: ${sanitizedPrimary})`
    );

    const safeCascade = resolveGeminiContingencyModels();
    assert(
      safeCascade[0] === 'gemini-3.8-flash' &&
      safeCascade[1] === 'gemini-3.5-flash-lite' &&
      safeCascade[2] === 'gemini-3.1-flash-lite',
      '1.5d: Cascata não é comprometida por identificador legado em GEMINI_MODEL'
    );
  } finally {
    if (originalEnvModel !== undefined) {
      process.env.GEMINI_MODEL = originalEnvModel;
    } else {
      delete process.env.GEMINI_MODEL;
    }
  }

  // -------------------------------------------------------------------------
  // 2. Configuração de Thinking Compatível
  // -------------------------------------------------------------------------
  console.log('\n--- 2. Configuração de Thinking Compatível ---');

  const thinking38 = resolveThinkingConfig('gemini-3.8-flash');
  assert(
    thinking38 !== undefined && thinking38.thinkingLevel === ThinkingLevel.LOW,
    `2.1: gemini-3.8-flash utiliza thinkingLevel: LOW (valor: ${thinking38?.thinkingLevel})`
  );

  const thinking35 = resolveThinkingConfig('gemini-3.5-flash-lite');
  assert(
    thinking35 !== undefined && thinking35.thinkingLevel === ThinkingLevel.LOW,
    `2.2: gemini-3.5-flash-lite utiliza thinkingLevel: LOW (valor: ${thinking35?.thinkingLevel})`
  );

  const thinking31 = resolveThinkingConfig('gemini-3.1-flash-lite');
  assert(
    thinking31 !== undefined && thinking31.thinkingLevel === ThinkingLevel.LOW,
    `2.3: gemini-3.1-flash-lite utiliza thinkingLevel: LOW (valor: ${thinking31?.thinkingLevel})`
  );

  // Modelos incompatíveis ou desconhecidos devem omitir thinkingConfig
  const thinkingLegacy = resolveThinkingConfig('legacy-unknown-model');
  assert(
    thinkingLegacy === undefined,
    '2.4: Modelos sem compatibilidade garantida omitem thinkingConfig completamente (retorna undefined)'
  );

  // Garantir que thinkingBudget NÃO existe em nenhum thinkingConfig gerado
  assert(
    (thinking38 as any)?.thinkingBudget === undefined,
    '2.5: thinkingBudget: 0 foi estritamente eliminado das opções geradas'
  );

  // -------------------------------------------------------------------------
  // 3. Retorno Imediato Após Sucesso (Execução Sequencial Estrita)
  // -------------------------------------------------------------------------
  console.log('\n--- 3. Retorno Imediato Após Sucesso ---');

  {
    const attemptsMade: string[] = [];
    const mockExecutor = async (model: string) => {
      attemptsMade.push(model);
      return {
        text: '{"hasAnyError":false,"isCorrect":true}',
        parsedJson: { hasAnyError: false, isCorrect: true },
        model,
      };
    };

    const result = await executeGeminiWithContingency(
      {
        feature: 'check_daily_sentence',
        systemInstruction: 'Checker',
        untrustedUserDataPrompt: 'Today was a nice day.',
        callerRole: 'student',
      },
      mockExecutor
    );

    assert(
      result.success === true && result.modelUsed === 'gemini-3.8-flash',
      '3.1: Sucesso imediato no primeiro modelo da lista (gemini-3.8-flash)'
    );
    assert(
      attemptsMade.length === 1 && attemptsMade[0] === 'gemini-3.8-flash',
      `3.2: Nenhuma chamada subsequente realizada após sucesso inicial (chamadas: ${JSON.stringify(attemptsMade)})`
    );
  }

  // -------------------------------------------------------------------------
  // 4. Fallback Após HTTP 404 (Model Not Found)
  // -------------------------------------------------------------------------
  console.log('\n--- 4. Fallback Após HTTP 404 (Model Not Found) ---');

  {
    const attemptsMade: string[] = [];
    const mockExecutor = async (model: string) => {
      attemptsMade.push(model);
      if (model === 'gemini-3.8-flash') {
        const notFoundErr: any = new Error('models/gemini-3.8-flash is not found for API version v1beta');
        notFoundErr.status = 404;
        notFoundErr.statusCode = 404;
        throw notFoundErr;
      }
      return {
        text: '{"hasAnyError":false,"isCorrect":true}',
        parsedJson: { hasAnyError: false, isCorrect: true },
        model,
      };
    };

    const result = await executeGeminiWithContingency(
      {
        feature: 'check_daily_sentence',
        systemInstruction: 'Checker',
        untrustedUserDataPrompt: 'I love learning english.',
        callerRole: 'student',
      },
      mockExecutor
    );

    assert(
      result.success === true && result.modelUsed === 'gemini-3.5-flash-lite',
      '4.1: Fallback recuperou com sucesso no 2º modelo após HTTP 404 no 1º modelo'
    );
    assert(
      attemptsMade.length === 2 &&
      attemptsMade[0] === 'gemini-3.8-flash' &&
      attemptsMade[1] === 'gemini-3.5-flash-lite',
      `4.2: Transição sequencial 404 correta: ${JSON.stringify(attemptsMade)}`
    );
  }

  // -------------------------------------------------------------------------
  // 5. Fallback Após HTTP 503 (Alta Demanda / Sobrecarga)
  // -------------------------------------------------------------------------
  console.log('\n--- 5. Fallback Após HTTP 503 (Alta Demanda / Sobrecarga) ---');

  {
    const attemptsMade: string[] = [];
    const mockExecutor = async (model: string) => {
      attemptsMade.push(model);
      if (model === 'gemini-3.8-flash') {
        const err503: any = new Error('The model is experiencing high demand. Please try again later.');
        err503.status = 503;
        err503.statusCode = 503;
        throw err503;
      }
      return {
        text: '{"hasAnyError":false,"isCorrect":true,"correctedSentence":"I love coding."}',
        parsedJson: { hasAnyError: false, isCorrect: true, correctedSentence: 'I love coding.' },
        model,
      };
    };

    const result = await executeGeminiWithContingency(
      {
        feature: 'check_daily_sentence',
        systemInstruction: 'Checker',
        untrustedUserDataPrompt: 'I love coding.',
        callerRole: 'student',
      },
      mockExecutor
    );

    assert(
      result.success === true && result.modelUsed === 'gemini-3.5-flash-lite',
      '5.1: Fallback bem-sucedido após HTTP 503 no 1º modelo'
    );
    assert(
      attemptsMade.length === 2 &&
      attemptsMade[0] === 'gemini-3.8-flash' &&
      attemptsMade[1] === 'gemini-3.5-flash-lite',
      `5.2: Transição sequencial 503 correta: ${JSON.stringify(attemptsMade)}`
    );
  }

  // -------------------------------------------------------------------------
  // 6. Fallback Após HTTP 400 por Configuração Incompatível de Modelo
  // -------------------------------------------------------------------------
  console.log('\n--- 6. Fallback Após HTTP 400 por Configuração Incompatível ---');

  // Teste de detecção do erro de incompatibilidade de configuração
  const configErr1 = new Error('INVALID_ARGUMENT: thinking_config is not supported for this model');
  (configErr1 as any).status = 400;
  assert(
    isModelConfigIncompatibleError(configErr1),
    '6.1a: isModelConfigIncompatibleError detecta erro de thinking_config não suportado'
  );
  assert(
    !isNonRecoverableGeminiError(configErr1),
    '6.1b: 400 por thinking_config NÃO é classificado como erro não-recuperável (permite fallback)'
  );

  const configErr2 = new Error('Invalid JSON payload: unsupported parameter thinking_budget on model');
  (configErr2 as any).statusCode = 400;
  assert(
    isModelConfigIncompatibleError(configErr2),
    '6.1c: isModelConfigIncompatibleError detecta unsupported parameter thinking_budget'
  );
  assert(
    !isNonRecoverableGeminiError(configErr2),
    '6.1d: 400 por parâmetro de modelo NÃO é classificado como não-recuperável'
  );

  // Execução do fluxo de contingência com 400 por incompatibilidade
  {
    const attemptsMade: string[] = [];
    const mockExecutor = async (model: string) => {
      attemptsMade.push(model);
      if (model === 'gemini-3.8-flash') {
        const incompatErr: any = new Error('INVALID_ARGUMENT: thinking_level is not supported on this model version');
        incompatErr.status = 400;
        throw incompatErr;
      }
      return {
        text: '{"hasAnyError":false,"isCorrect":true}',
        parsedJson: { hasAnyError: false, isCorrect: true },
        model,
      };
    };

    const result = await executeGeminiWithContingency(
      {
        feature: 'check_daily_sentence',
        systemInstruction: 'Checker',
        untrustedUserDataPrompt: 'English practice sentence',
        callerRole: 'student',
      },
      mockExecutor
    );

    assert(
      result.success === true && result.modelUsed === 'gemini-3.5-flash-lite',
      '6.2: 400 por incompatibilidade de config avançou para o próximo modelo com sucesso sem abortar'
    );
    assert(
      attemptsMade.length === 2 &&
      attemptsMade[0] === 'gemini-3.8-flash' &&
      attemptsMade[1] === 'gemini-3.5-flash-lite',
      `6.3: Transição sequencial correta após 400 de configuração: ${JSON.stringify(attemptsMade)}`
    );
  }

  // -------------------------------------------------------------------------
  // 7. Preservação dos Bloqueios de Autenticação e Segurança (Não Mascarar Erros)
  // -------------------------------------------------------------------------
  console.log('\n--- 7. Preservação dos Bloqueios de Autenticação e Segurança ---');

  // Autenticação inválida (401 / 403 / API Key)
  const authErr = new Error('API key not valid. Please pass a valid API key.');
  (authErr as any).status = 401;
  assert(
    isNonRecoverableGeminiError(authErr),
    '7.1: Erro de chave de API é classificado como NÃO-recuperável'
  );

  // Violação de segurança/safety
  const safetyErr = new Error('SAFETY_VIOLATION: Response blocked by safety filters (HARM_CATEGORY_HARASSMENT)');
  (safetyErr as any).status = 400;
  assert(
    isNonRecoverableGeminiError(safetyErr),
    '7.2: Violação de segurança (safety filters) é classificada como NÃO-recuperável'
  );

  // Cota compartilhada do projeto
  const projectQuotaErr = new Error('PROJECT_QUOTA_EXCEEDED: daily limit exceeded for project itissimple-security-staging');
  (projectQuotaErr as any).status = 429;
  assert(
    isNonRecoverableGeminiError(projectQuotaErr),
    '7.3: Cota compartilhada global do projeto é classificada como NÃO-recuperável'
  );

  // Execução de contingência com erro de autenticação: deve abortar no 1º modelo
  {
    const attemptsMade: string[] = [];
    const mockExecutor = async (model: string) => {
      attemptsMade.push(model);
      const e: any = new Error('API_KEY_INVALID: 401 Unauthorized API key');
      e.status = 401;
      throw e;
    };

    const result = await executeGeminiWithContingency(
      {
        feature: 'check_daily_sentence',
        systemInstruction: 'Checker',
        untrustedUserDataPrompt: 'Sentence',
        callerRole: 'student',
      },
      mockExecutor
    );

    assert(
      result.success === false && result.error?.category === 'AUTH_ERROR',
      '7.4: Erro de autenticação abortou imediatamente marcando AUTH_ERROR'
    );
    assert(
      attemptsMade.length === 1 && attemptsMade[0] === 'gemini-3.8-flash',
      `7.5: Interrupção imediata estrita: exatamente 1 tentativa, modelos 2 e 3 NÃO foram chamados (${JSON.stringify(attemptsMade)})`
    );
  }

  // -------------------------------------------------------------------------
  // 8. Retorno AiUnavailable Somente Quando Todas as Alternativas Esgotam
  // -------------------------------------------------------------------------
  console.log('\n--- 8. Retorno AiUnavailable Somente Quando Todas as Alternativas Esgotam ---');

  {
    const attemptsMade: string[] = [];
    const mockExecutor = async (model: string) => {
      attemptsMade.push(model);
      const e: any = new Error(`503 Service Unavailable on ${model}`);
      e.status = 503;
      throw e;
    };

    const result = await executeGeminiWithContingency(
      {
        feature: 'check_daily_sentence',
        systemInstruction: 'Checker',
        untrustedUserDataPrompt: 'I walked to school yesterday.',
        callerRole: 'student',
      },
      mockExecutor
    );

    assert(
      result.success === false && result.parsedJson === null,
      '8.1: Quando os 3 modelos falham, retorna success: false transparente'
    );
    assert(
      attemptsMade.length === 3 &&
      attemptsMade[0] === 'gemini-3.8-flash' &&
      attemptsMade[1] === 'gemini-3.5-flash-lite' &&
      attemptsMade[2] === 'gemini-3.1-flash-lite',
      `8.2: Esgotou todos os 3 modelos sequencialmente antes de declarar indisponibilidade: ${JSON.stringify(attemptsMade)}`
    );
  }

  // -------------------------------------------------------------------------
  // 9. Preservação das Políticas e Funcionalidades Existentes
  // -------------------------------------------------------------------------
  console.log('\n--- 9. Preservação das Políticas e Funcionalidades Existentes ---');

  const policy = GEMINI_POLICIES['check_daily_sentence'];
  assert(
    policy.maxOutputTokens === 450,
    `9.1: maxOutputTokens para check_daily_sentence preservado em 450 (atual: ${policy.maxOutputTokens})`
  );
  assert(
    policy.timeoutMs === 9000,
    `9.2: timeoutMs para check_daily_sentence ajustado exclusivamente para 9000ms (atual: ${policy.timeoutMs}ms)`
  );
  assert(
    policy.maxInputLengthChars === 500,
    `9.3: maxInputLengthChars preservado em 500 caracteres (atual: ${policy.maxInputLengthChars})`
  );

  // Validação de bounds
  const boundsOk = validatePayloadBounds('check_daily_sentence', {
    sentence: 'A valid sentence under 500 chars.',
    words: ['apple', 'book', 'chair', 'desk', 'lamp'],
  });
  assert(boundsOk.valid, '9.4: Bounds validation aceita payload válido');

  const boundsTooLong = validatePayloadBounds('check_daily_sentence', {
    sentence: 'x'.repeat(600),
  });
  assert(!boundsTooLong.valid, '9.5: Bounds validation rejeita frase acima do limite');

  // Rate limiting e single flight lock
  const rateLimit = await checkAndConsumeRateLimit('test-student-uid', 'check_daily_sentence');
  assert(rateLimit.allowed, '9.6: Rate limiter opera normalmente');

  const lock = await acquireSingleFlightLock('test-lock-key');
  assert(lock.acquired, '9.7: Single flight lock opera normalmente');
  await lock.release();

  console.log('\n============================================================================');
  console.log(' ✅ TODOS OS 9 REQUISITOS DO HOTFIX SENTENCE OF THE DAY FORAM COMPROVADOS!');
  console.log('============================================================================\n');
}

runSentenceOfTheDayHotfixTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
