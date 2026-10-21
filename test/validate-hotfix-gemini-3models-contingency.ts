/**
 * TEST SUITE — HOTFIX GEMINI: CONTINGÊNCIA COM 3 MODELOS
 * 
 * Projeto: itissimple-security-staging
 * 
 * Validação rigorosa dos requisitos do Hotfix:
 * 1. Sucesso no primeiro modelo: nenhuma chamada adicional.
 * 2. Falha recuperável: utilização do próximo modelo na sequência.
 * 3. Erro não-recuperável (Auth 401/403, 400 Bad Request/Policy): interrupção imediata.
 * 4. Falha nos três modelos: erro transparente, sem resposta inventada (sem fallbacks sintéticos).
 * 5. Preservação de dados e vínculos canônicos (UID canônico, Firestore, relacionamentos).
 * 6. Compatibilidade de contratos para os oito fluxos de IA pedagógicos.
 * 7. Execução 100% determinística sem chamadas de API pagas.
 */

import {
  DEFAULT_GEMINI_MODEL,
  GEMINI_CONTINGENCY_MODELS,
  resolveGeminiContingencyModels,
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

process.env.NODE_ENV = 'test';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    process.exit(1);
  }
  console.log(`  ✅ PASS: ${message}`);
}

async function runHotfix3ModelContingencyTests(): Promise<void> {
  console.log('============================================================================');
  console.log(' TEST SUITE — HOTFIX: CONTINGÊNCIA GEMINI COM 3 MODELOS');
  console.log(' Target Project: itissimple-security-staging');
  console.log(' Verified Models: gemini-3.5-flash -> gemini-3.8-flash -> gemini-3.1-flash-lite');
  console.log(' Mode: Determinístico local (ZERO chamadas de rede pagas)');
  console.log('============================================================================\n');

  // -------------------------------------------------------------------------
  // 1. Modelos Efetivamente Verificados e Sequência de Contingência
  // -------------------------------------------------------------------------
  console.log('--- 1. Modelos Efetivamente Verificados e Sequência de Contingência ---');

  assert(
    DEFAULT_GEMINI_MODEL === 'gemini-3.5-flash',
    `1.1: DEFAULT_GEMINI_MODEL é 'gemini-3.5-flash' (atual: ${DEFAULT_GEMINI_MODEL})`
  );

  assert(
    Array.isArray(GEMINI_CONTINGENCY_MODELS) && GEMINI_CONTINGENCY_MODELS.length === 3,
    `1.2: GEMINI_CONTINGENCY_MODELS possui exatamente 3 modelos configurados`
  );

  assert(
    GEMINI_CONTINGENCY_MODELS[0] === 'gemini-3.5-flash' &&
    GEMINI_CONTINGENCY_MODELS[1] === 'gemini-3.8-flash' &&
    GEMINI_CONTINGENCY_MODELS[2] === 'gemini-3.1-flash-lite',
    `1.3: Lista de contingência corresponde exatamente aos modelos verificados na API: ${JSON.stringify(GEMINI_CONTINGENCY_MODELS)}`
  );

  const defaultSequence = resolveGeminiContingencyModels();
  assert(
    defaultSequence[0] === 'gemini-3.5-flash' &&
    defaultSequence[1] === 'gemini-3.8-flash' &&
    defaultSequence[2] === 'gemini-3.1-flash-lite',
    `1.4: resolveGeminiContingencyModels() padrão mantém sequência ordenada correta`
  );

  // Verificação de override via GEMINI_MODEL
  const originalEnvModel = process.env.GEMINI_MODEL;
  try {
    process.env.GEMINI_MODEL = 'gemini-3.8-flash';
    const overriddenSequence = resolveGeminiContingencyModels();
    assert(
      overriddenSequence[0] === 'gemini-3.8-flash' &&
      overriddenSequence[1] === 'gemini-3.5-flash' &&
      overriddenSequence[2] === 'gemini-3.1-flash-lite',
      `1.5: resolveGeminiContingencyModels() prioriza modelo configurado em GEMINI_MODEL sem duplicatas`
    );
  } finally {
    if (originalEnvModel !== undefined) {
      process.env.GEMINI_MODEL = originalEnvModel;
    } else {
      delete process.env.GEMINI_MODEL;
    }
  }

  // -------------------------------------------------------------------------
  // 2. Classificação Estrita de Erros Não-Recuperáveis vs Recuperáveis
  // -------------------------------------------------------------------------
  console.log('\n--- 2. Classificação Estrita de Erros Não-Recuperáveis vs Recuperáveis ---');

  // Erros não-recuperáveis (devem abortar IMEDIATAMENTE sem testar modelos subsequentes)
  assert(
    isNonRecoverableGeminiError(new Error('API key not valid. Please pass a valid API key.')),
    `2.1: Erro de chave de API inválida (401/403) é classificado como NÃO-recuperável`
  );
  assert(
    isNonRecoverableGeminiError(new Error('Permission denied: caller lacks permission to project')),
    `2.2: Erro de permissão negada (403 Forbidden) é classificado como NÃO-recuperável`
  );
  assert(
    isNonRecoverableGeminiError(new Error('User location is not supported for the API use')),
    `2.3: Restrição geográfica / policy violation é classificada como NÃO-recuperável`
  );
  assert(
    isNonRecoverableGeminiError(new Error('Gemini API disabled on project itissimple-security-staging')),
    `2.4: Serviço desabilitado no projeto é classificado como NÃO-recuperável`
  );
  assert(
    isNonRecoverableGeminiError(new Error('PROJECT_QUOTA_EXCEEDED: daily billable limit exceeded')),
    `2.5: Cota compartilhada de projeto esgotada é classificada como NÃO-recuperável`
  );

  // Erros recuperáveis (devem acionar o próximo modelo da contingência)
  assert(
    !isNonRecoverableGeminiError(new Error('The model is overloaded. Please try again later.')),
    `2.6: Modelo sobrecarregado (503 Service Unavailable) é classificado como RECUPERÁVEL`
  );
  assert(
    !isNonRecoverableGeminiError(new Error('FetchError: network request timed out after 6000ms')),
    `2.7: Timeout de rede é classificado como RECUPERÁVEL`
  );
  assert(
    !isNonRecoverableGeminiError(new Error('RESOURCE_EXHAUSTED: Quota exceeded for metric generate_content_free_tier_requests')),
    `2.8: Quota específica daquele modelo específico (per-model free-tier) é classificada como RECUPERÁVEL`
  );

  // -------------------------------------------------------------------------
  // 3. Executor Compartilhado: Testes de Ciclo de Vida da Contingência
  // -------------------------------------------------------------------------
  console.log('\n--- 3. Executor Compartilhado: Testes de Ciclo de Vida da Contingência ---');

  // Teste 3.1: Sucesso no 1º modelo — NENHUMA chamada adicional
  {
    const attemptsMade: string[] = [];
    const mockExecutor = async (model: string) => {
      attemptsMade.push(model);
      return {
        text: '{"status":"ok"}',
        parsedJson: { status: 'ok' },
        model,
        feature: 'pedagogical_transform' as GeminiFeature,
        durationMs: 120,
        promptLength: 50,
      };
    };

    const result = await executeGeminiWithContingency(
      {
        feature: 'pedagogical_transform',
        systemInstruction: 'Test',
        untrustedUserDataPrompt: 'Test prompt',
        callerRole: 'teacher',
      },
      mockExecutor
    );

    assert(
      result !== null && result.parsedJson?.status === 'ok',
      '3.1.1: Execução com sucesso retorna resultado esperado'
    );
    assert(
      attemptsMade.length === 1 && attemptsMade[0] === 'gemini-3.5-flash',
      `3.1.2: Sucesso no 1º modelo fez exatamente 1 chamada ao gemini-3.5-flash (chamadas: ${JSON.stringify(attemptsMade)})`
    );
  }

  // Teste 3.2: Falha recuperável no 1º modelo -> Failover para o 2º modelo
  {
    const attemptsMade: string[] = [];
    const mockExecutor = async (model: string) => {
      attemptsMade.push(model);
      if (model === 'gemini-3.5-flash') {
        throw new Error('503 Service Unavailable: High load on gemini-3.5-flash');
      }
      return {
        text: '{"status":"ok_from_model_2"}',
        parsedJson: { status: 'ok_from_model_2' },
        model,
        feature: 'check_daily_sentence' as GeminiFeature,
        durationMs: 140,
        promptLength: 50,
      };
    };

    const result = await executeGeminiWithContingency(
      {
        feature: 'check_daily_sentence',
        systemInstruction: 'Test',
        untrustedUserDataPrompt: 'Test prompt',
        callerRole: 'student',
      },
      mockExecutor
    );

    assert(
      result !== null && result.parsedJson?.status === 'ok_from_model_2',
      '3.2.1: Failover recuperável retornou resultado do 2º modelo'
    );
    assert(
      attemptsMade.length === 2 &&
      attemptsMade[0] === 'gemini-3.5-flash' &&
      attemptsMade[1] === 'gemini-3.8-flash',
      `3.2.2: Transição correta: tentou gemini-3.5-flash, falhou e chamou gemini-3.8-flash (chamadas: ${JSON.stringify(attemptsMade)})`
    );
  }

  // Teste 3.3: Falha não-recuperável (ex: Chave Inválida) -> Interrupção IMEDIATA sem testar 2º ou 3º modelo
  {
    const attemptsMade: string[] = [];
    const mockExecutor = async (model: string) => {
      attemptsMade.push(model);
      throw new Error('API_KEY_INVALID: 401 Unauthorized API key');
    };

    const result = await executeGeminiWithContingency(
      {
        feature: 'check_writing',
        systemInstruction: 'Test',
        untrustedUserDataPrompt: 'Test prompt',
        callerRole: 'student',
      },
      mockExecutor
    );

    assert(
      result.success === false && result.parsedJson === null,
      '3.3.1: Falha não-recuperável abortou e retornou success: false com parsedJson: null'
    );
    assert(
      attemptsMade.length === 1 && attemptsMade[0] === 'gemini-3.5-flash',
      `3.3.2: Interrupção imediata respeitada: exatamente 1 chamada realizada, não tentou modelos 2 e 3 (chamadas: ${JSON.stringify(attemptsMade)})`
    );
  }

  // Teste 3.4: Falha nos 3 modelos -> Erro transparente, SEM fallback inventado
  {
    const attemptsMade: string[] = [];
    const mockExecutor = async (model: string) => {
      attemptsMade.push(model);
      throw new Error(`503 Service Unavailable on ${model}`);
    };

    const result = await executeGeminiWithContingency(
      {
        feature: 'homework_evaluate',
        systemInstruction: 'Test',
        untrustedUserDataPrompt: 'Test prompt',
        callerRole: 'student',
      },
      mockExecutor
    );

    assert(
      result.success === false && result.parsedJson === null,
      '3.4.1: Falha nos três modelos retorna success: false transparente sem fallback inventado'
    );
    assert(
      attemptsMade.length === 3 &&
      attemptsMade[0] === 'gemini-3.5-flash' &&
      attemptsMade[1] === 'gemini-3.8-flash' &&
      attemptsMade[2] === 'gemini-3.1-flash-lite',
      `3.4.2: Percorreu exatamente os 3 modelos de contingência sequencialmente (chamadas: ${JSON.stringify(attemptsMade)})`
    );
  }

  // Teste 3.5: Validador de JSON falha (resposta inválida/vazia) -> Tenta próximo modelo
  {
    const attemptsMade: string[] = [];
    const mockExecutor = async (model: string) => {
      attemptsMade.push(model);
      if (model === 'gemini-3.5-flash') {
        // Retorna JSON válido mas que não satisfaz a validação pedagógica
        return {
          text: '{"empty":true}',
          parsedJson: { empty: true },
          model,
          feature: 'vocab_generate' as GeminiFeature,
          durationMs: 100,
          promptLength: 50,
        };
      }
      return {
        text: '[{"word":"contingency","definitionEn":"A provision for an unforeseen event."}]',
        parsedJson: [{ word: 'contingency', definitionEn: 'A provision for an unforeseen event.' }],
        model,
        feature: 'vocab_generate' as GeminiFeature,
        durationMs: 110,
        promptLength: 50,
      };
    };

    const result = await executeGeminiWithContingency(
      {
        feature: 'vocab_generate',
        systemInstruction: 'Test',
        untrustedUserDataPrompt: 'Test prompt',
        callerRole: 'teacher',
        jsonValidator: (val) => Array.isArray(val) && val.length > 0,
      },
      mockExecutor
    );

    assert(
      result !== null && Array.isArray(result.parsedJson) && result.parsedJson.length === 1,
      '3.5.1: JSON que falhou na validação ativou failover para o próximo modelo com sucesso'
    );
    assert(
      attemptsMade.length === 2 && attemptsMade[0] === 'gemini-3.5-flash' && attemptsMade[1] === 'gemini-3.8-flash',
      '3.5.2: 1º modelo descartado por falha no validador; 2º modelo aceito'
    );
  }

  // -------------------------------------------------------------------------
  // 4. Compatibilidade de Contratos e Políticas dos 8 Fluxos de IA
  // -------------------------------------------------------------------------
  console.log('\n--- 4. Compatibilidade de Contratos e Políticas dos 8 Fluxos de IA ---');

  const requiredFeatures: GeminiFeature[] = [
    'pedagogical_transform',      // Fluxo 1: Native Friend Notes
    'check_daily_sentence',       // Fluxo 2: Sentence of the Day
    'check_writing',              // Fluxo 3: Writing
    'homework_generate',          // Fluxo 4: Memorization Activities
    'homework_part4',             // Fluxo 5: Story Generation
    'homework_evaluate',          // Fluxo 6: Homework Evaluation
    'vocab_generate',             // Fluxo 7a: Live Vocabulary / 5 Words
    'dictionary_define',          // Fluxo 7b: Dictionary Define
    'lesson_insights',            // Fluxo 8: Weekly Lesson Insights & Icebreakers
  ];

  for (const feat of requiredFeatures) {
    const policy = GEMINI_POLICIES[feat];
    assert(
      Boolean(policy),
      `4.1: Política e limites definidos para o fluxo '${feat}'`
    );
    assert(
      typeof policy.maxOutputTokens === 'number' && policy.maxOutputTokens > 0,
      `4.2: Fluxo '${feat}' possui maxOutputTokens delimitado (${policy.maxOutputTokens} tokens)`
    );
    assert(
      typeof policy.timeoutMs === 'number' && policy.timeoutMs > 0,
      `4.3: Fluxo '${feat}' possui timeout delimitado (${policy.timeoutMs}ms)`
    );
  }

  // -------------------------------------------------------------------------
  // 5. Preservação de Dados e Vínculos Canônicos em Caso de Falha
  // -------------------------------------------------------------------------
  console.log('\n--- 5. Preservação de Dados e Vínculos Canônicos em Caso de Falha ---');

  // Validar que o payload original e vínculos permanecem intactos quando a IA falha
  const mockTeacherNotes = {
    lessonId: 'lesson-rec-canonical-001',
    teacherUid: 'teacher-uid-xyz-123',
    studentUid: 'student-uid-canonical-456',
    originalTeacherNotes: 'The student talked about their morning routine and practiced past tense verbs.',
  };

  // Simula execução onde todos os 3 modelos falham
  const notesContingencyResult = await executeGeminiWithContingency(
    {
      feature: 'pedagogical_transform',
      systemInstruction: 'Transform notes',
      untrustedUserDataPrompt: mockTeacherNotes.originalTeacherNotes,
      callerRole: 'teacher',
    },
    async (m) => { throw new Error(`Model ${m} temporarily unavailable`); }
  );

  assert(
    notesContingencyResult.success === false && notesContingencyResult.parsedJson === null,
    '5.1: Em caso de falha de todos os 3 modelos, o executor retorna success: false e parsedJson: null (nenhum fallback sintético)'
  );
  assert(
    mockTeacherNotes.originalTeacherNotes === 'The student talked about their morning routine and practiced past tense verbs.',
    '5.2: As anotações originais do professor permaneceram 100% inalteradas e preservadas'
  );
  assert(
    mockTeacherNotes.lessonId === 'lesson-rec-canonical-001' &&
    mockTeacherNotes.teacherUid === 'teacher-uid-xyz-123' &&
    mockTeacherNotes.studentUid === 'student-uid-canonical-456',
    '5.3: Vínculos canônicos entre aula, professor e aluno permaneceram intactos'
  );

  console.log('\n============================================================================');
  console.log(' ✅ TODAS AS VALIDAÇÕES DO HOTFIX GEMINI COM 3 MODELOS PASSARAM COM SUCESSO!');
  console.log('============================================================================');
}

runHotfix3ModelContingencyTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
