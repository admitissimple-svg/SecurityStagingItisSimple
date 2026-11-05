/**
 * SUÍTE DE TESTES OBRIGATÓRIOS — HOTFIX IA.2C
 * Correção cirúrgica da classificação de TIMEOUT na contingência Gemini
 * 
 * Ambiente: 100% Determinístico local (ZERO inferência real à IA).
 * 
 * Cobertura obrigatória:
 * 1. Timeout 14000ms não pode ser classificado como HTTP 400.
 * 2. Timeout 7000ms não pode ser classificado como erro HTTP.
 * 3. HTTP 400 real continua sendo identificado corretamente.
 * 4. HTTP 400 de parâmetro incompatível mantém a contingência prevista.
 * 5. HTTP 400 de segurança continua interrompendo a operação.
 * 6. HTTP 404 de modelo permite contingência.
 * 7. HTTP 429 por modelo permite contingência.
 * 8. HTTP 429 de quota global interrompe a operação.
 * 9. HTTP 503 permite contingência.
 * 10. Timeout no segundo modelo permite tentativa do terceiro quando houver tempo suficiente.
 * 11. Prazo global esgotado impede novas chamadas.
 * 12. Nenhum resultado inválido pode ser apresentado como sucesso.
 */

import {
  classifyGeminiError,
  extractDelimitedHttpStatusFromText,
  extractStructuredHttpStatus,
  isTimeoutError,
  isNonRecoverableGeminiError,
  isModelConfigIncompatibleError,
  executeGeminiWithContingency,
  GEMINI_POLICIES,
  resetGeminiSecurityStateForTesting,
} from '../src/serverGeminiSecurity';

process.env.NODE_ENV = 'test';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    process.exit(1);
  }
  console.log(`  ✅ PASS: ${message}`);
}

async function runHotfixIA2CSuite(): Promise<void> {
  console.log('============================================================================');
  console.log(' TEST SUITE — HOTFIX IA.2C: CLASSIFICAÇÃO CIRÚRGICA DE TIMEOUT');
  console.log(' Target: serverGeminiSecurity.ts');
  console.log(' Mode: Determinístico local (ZERO chamadas reais à IA)');
  console.log('============================================================================\n');

  resetGeminiSecurityStateForTesting();

  // -------------------------------------------------------------------------
  // Teste 1: Timeout 14000ms NÃO pode ser classificado como HTTP 400
  // -------------------------------------------------------------------------
  console.log('--- Teste 1: Timeout 14000ms (não pode ser classificado como HTTP 400) ---');
  {
    const err14k = new Error('Timeout: Gemini generation exceeded 14000ms deadline');
    const classified = classifyGeminiError(err14k);

    assert(classified.category === 'TIMEOUT', '1.1: Categoria do erro é "TIMEOUT"');
    assert(classified.statusCode === undefined, '1.2: statusCode é undefined (não 400, não 500)');
    assert(classified.statusCode !== 400, '1.3: Estritamente NÃO classificado como HTTP 400');
    assert(isNonRecoverableGeminiError(err14k) === false, '1.4: Timeout de 14000ms é classificado como RECUPERÁVEL');
    assert(isModelConfigIncompatibleError(err14k) === false, '1.5: Timeout não é confundido com erro de configuração');
    assert(extractDelimitedHttpStatusFromText(err14k.message) === undefined, '1.6: 14000ms não é extraído como código HTTP 400');
  }

  // -------------------------------------------------------------------------
  // Teste 2: Timeout 7000ms NÃO pode ser classificado como erro HTTP
  // -------------------------------------------------------------------------
  console.log('\n--- Teste 2: Timeout 7000ms (não pode ser classificado como erro HTTP) ---');
  {
    const err7k = new Error('Timeout: Gemini generation exceeded 7000ms deadline');
    const classified = classifyGeminiError(err7k);

    assert(classified.category === 'TIMEOUT', '2.1: Categoria do erro é "TIMEOUT"');
    assert(classified.statusCode === undefined, '2.2: statusCode é undefined (sem atribuir HTTP 500 ou outro status HTTP)');
    assert(isNonRecoverableGeminiError(err7k) === false, '2.3: Timeout de 7000ms é classificado como RECUPERÁVEL');
    assert(extractDelimitedHttpStatusFromText(err7k.message) === undefined, '2.4: 7000ms não é interpretado como código HTTP');
  }

  // -------------------------------------------------------------------------
  // Teste 3: HTTP 400 real continua sendo identificado corretamente
  // -------------------------------------------------------------------------
  console.log('\n--- Teste 3: HTTP 400 real continua sendo identificado corretamente ---');
  {
    const real400 = { status: 400, message: 'Invalid argument: contents is required and must not be empty' };
    const classified = classifyGeminiError(real400);

    assert(classified.category === 'POLICY_VIOLATION', '3.1: Categoria é "POLICY_VIOLATION"');
    assert(classified.statusCode === 400, '3.2: statusCode é 400');
    assert(classified.nonRecoverable === true, '3.3: HTTP 400 real é NÃO-recuperável');
    assert(isNonRecoverableGeminiError(real400) === true, '3.4: isNonRecoverableGeminiError retorna true');

    const errorWith400Text = new Error('HTTP 400 Bad Request: prompt contains illegal structure');
    const classifiedText = classifyGeminiError(errorWith400Text);
    assert(classifiedText.statusCode === 400, '3.5: HTTP 400 explícito e delimitado em texto é extraído');
    assert(classifiedText.nonRecoverable === true, '3.6: Aborta imediatamente');
  }

  // -------------------------------------------------------------------------
  // Teste 4: HTTP 400 de parâmetro incompatível mantém contingência prevista
  // -------------------------------------------------------------------------
  console.log('\n--- Teste 4: HTTP 400 de parâmetro incompatível mantém a contingência prevista ---');
  {
    const configError = {
      status: 400,
      message: 'thinking_level is not supported for this model [INVALID_ARGUMENT]'
    };
    const classified = classifyGeminiError(configError);

    assert(classified.category === 'MODEL_INCOMPATIBLE_CONFIG', '4.1: Categoria é "MODEL_INCOMPATIBLE_CONFIG"');
    assert(classified.statusCode === 400, '4.2: statusCode é 400');
    assert(classified.nonRecoverable === false, '4.3: nonRecoverable é false (permite contingência)');
    assert(isModelConfigIncompatibleError(configError) === true, '4.4: isModelConfigIncompatibleError reconhece o parâmetro thinking');
    assert(isNonRecoverableGeminiError(configError) === false, '4.5: isNonRecoverableGeminiError não bloqueia contingência');
  }

  // -------------------------------------------------------------------------
  // Teste 5: HTTP 400 de segurança continua interrompendo a operação
  // -------------------------------------------------------------------------
  console.log('\n--- Teste 5: HTTP 400 de segurança continua interrompendo a operação ---');
  {
    const safetyError = {
      status: 400,
      message: 'Request blocked due to SAFETY policy violation: HARM_CATEGORY_HATE_SPEECH'
    };
    const classified = classifyGeminiError(safetyError);

    assert(classified.category === 'POLICY_VIOLATION', '5.1: Categoria é "POLICY_VIOLATION"');
    assert(classified.statusCode === 400, '5.2: statusCode é 400');
    assert(classified.nonRecoverable === true, '5.3: nonRecoverable é true (interrompe imediatamente)');
    assert(isModelConfigIncompatibleError(safetyError) === false, '5.4: Erro de segurança NÃO é tratado como erro de configuração');
    assert(isNonRecoverableGeminiError(safetyError) === true, '5.5: isNonRecoverableGeminiError bloqueia a cascata');
  }

  // -------------------------------------------------------------------------
  // Teste 6: HTTP 404 de modelo permite contingência
  // -------------------------------------------------------------------------
  console.log('\n--- Teste 6: HTTP 404 de modelo permite contingência ---');
  {
    const notFoundError = {
      status: 404,
      message: 'models/gemini-3.8-flash is not found for API version v1beta'
    };
    const classified = classifyGeminiError(notFoundError);

    assert(classified.category === 'MODEL_NOT_FOUND', '6.1: Categoria é "MODEL_NOT_FOUND"');
    assert(classified.statusCode === 404, '6.2: statusCode é 404');
    assert(classified.nonRecoverable === false, '6.3: Modelo 404 é recuperável');
    assert(isNonRecoverableGeminiError(notFoundError) === false, '6.4: isNonRecoverableGeminiError permite contingência');
  }

  // -------------------------------------------------------------------------
  // Teste 7: HTTP 429 por modelo permite contingência
  // -------------------------------------------------------------------------
  console.log('\n--- Teste 7: HTTP 429 por modelo permite contingência ---');
  {
    const modelQuotaError = {
      status: 429,
      message: 'Resource exhausted: free_tier_requests perprojectpermodel quota reached for gemini-3.8-flash'
    };
    const classified = classifyGeminiError(modelQuotaError);

    assert(classified.category === 'QUOTA_EXCEEDED', '7.1: Categoria é "QUOTA_EXCEEDED"');
    assert(classified.statusCode === 429, '7.2: statusCode é 429');
    assert(classified.nonRecoverable === false, '7.3: Cota por modelo é recuperável');
    assert(isNonRecoverableGeminiError(modelQuotaError) === false, '7.4: isNonRecoverableGeminiError permite próximo modelo');
  }

  // -------------------------------------------------------------------------
  // Teste 8: HTTP 429 de quota global interrompe a operação
  // -------------------------------------------------------------------------
  console.log('\n--- Teste 8: HTTP 429 de quota global interrompe a operação ---');
  {
    const projectQuotaError = {
      status: 429,
      message: 'Resource exhausted: project_quota daily limit exceeded for project 330078849278'
    };
    const classified = classifyGeminiError(projectQuotaError);

    assert(classified.category === 'QUOTA_EXCEEDED', '8.1: Categoria é "QUOTA_EXCEEDED"');
    assert(classified.statusCode === 429, '8.2: statusCode é 429');
    assert(classified.nonRecoverable === true, '8.3: Cota de projeto é estritamente NÃO-recuperável');
    assert(isNonRecoverableGeminiError(projectQuotaError) === true, '8.4: isNonRecoverableGeminiError bloqueia imediatamente');
  }

  // -------------------------------------------------------------------------
  // Teste 9: HTTP 503 permite contingência
  // -------------------------------------------------------------------------
  console.log('\n--- Teste 9: HTTP 503 permite contingência ---');
  {
    const srv503 = {
      status: 503,
      message: 'The model is overloaded. Please try again later.'
    };
    const classified = classifyGeminiError(srv503);

    assert(classified.category === 'SERVICE_UNAVAILABLE', '9.1: Categoria é "SERVICE_UNAVAILABLE"');
    assert(classified.statusCode === 503, '9.2: statusCode é 503');
    assert(classified.nonRecoverable === false, '9.3: 503 é recuperável');
    assert(isNonRecoverableGeminiError(srv503) === false, '9.4: isNonRecoverableGeminiError permite contingência');
  }

  // -------------------------------------------------------------------------
  // Teste 10: Timeout no segundo modelo permite tentativa do terceiro quando houver tempo suficiente
  // -------------------------------------------------------------------------
  console.log('\n--- Teste 10: Timeout no 2º modelo permite tentativa do 3º com tempo suficiente ---');
  {
    const attemptsMade: string[] = [];
    const validHomework = {
      title: 'Contingency Success on 3rd Model',
      exercises: [{ id: 'ex-1', prompt: 'Practice sentence', answer: 'practice' }],
    };

    const mockExecutor = async (model: string) => {
      attemptsMade.push(model);
      if (model === 'gemini-3.8-flash') {
        // Modelo 1 falha com 503 (recuperável)
        const err = new Error('503 Service Unavailable: overloaded');
        (err as any).status = 503;
        throw err;
      }
      if (model === 'gemini-3.5-flash-lite') {
        // Modelo 2 falha com timeout de 14000ms (recuperável)
        // NOTA: antes do hotfix, a string "14000ms" continha "400", sendo classificada erroneamente como HTTP 400 não-recuperável
        throw new Error('Timeout: Gemini generation exceeded 14000ms deadline');
      }
      // Modelo 3 entrega o resultado
      return {
        text: JSON.stringify(validHomework),
        parsedJson: validHomework,
      };
    };

    const res = await executeGeminiWithContingency(
      {
        feature: 'homework_generate',
        systemInstruction: 'Test',
        untrustedUserDataPrompt: 'Test',
        callerRole: 'student',
      },
      mockExecutor
    );

    assert(res.success === true, '10.1: Contingência bem-sucedida após timeout de 14000ms no 2º modelo');
    assert(attemptsMade.length === 3, '10.2: Percorreu exatamente os 3 modelos da contingência');
    assert(res.attemptsCount === 3, '10.3: attemptsCount é 3');
    assert(res.modelUsed === 'gemini-3.1-flash-lite', '10.4: Terceiro modelo entregou o resultado com sucesso');
    assert(res.interruptionReason === 'sucesso', '10.5: Motivo de encerramento é "sucesso"');
  }

  // -------------------------------------------------------------------------
  // Teste 11: Prazo global esgotado impede novas chamadas
  // -------------------------------------------------------------------------
  console.log('\n--- Teste 11: Prazo global esgotado impede novas chamadas ---');
  {
    const attemptsMade: string[] = [];
    const mockExecutor = async (model: string) => {
      attemptsMade.push(model);
      await new Promise((r) => setTimeout(r, 60));
      throw new Error('Timeout: Gemini generation exceeded 14000ms deadline');
    };

    const originalPolicy = { ...GEMINI_POLICIES.homework_generate };
    (GEMINI_POLICIES.homework_generate as any).totalDeadlineMs = 50; // Prazo global esgota na primeira tentativa

    try {
      const res = await executeGeminiWithContingency(
        {
          feature: 'homework_generate',
          systemInstruction: 'Test',
          untrustedUserDataPrompt: 'Test',
          callerRole: 'student',
        },
        mockExecutor
      );

      assert(res.success === false, '11.1: Sucesso é false quando prazo total é esgotado');
      assert(res.interruptionReason === 'timeout', '11.2: interruptionReason é "timeout"');
      assert(attemptsMade.length === 1, '11.3: Não realizou novas chamadas após esgotamento do prazo total');
      assert(res.error?.category === 'TIMEOUT', '11.4: Categoria do erro final é "TIMEOUT"');
    } finally {
      GEMINI_POLICIES.homework_generate.totalDeadlineMs = originalPolicy.totalDeadlineMs;
    }
  }

  // -------------------------------------------------------------------------
  // Teste 12: Nenhum resultado inválido pode ser apresentado como sucesso
  // -------------------------------------------------------------------------
  console.log('\n--- Teste 12: Nenhum resultado inválido pode ser apresentado como sucesso ---');
  {
    const attemptsMade: string[] = [];
    const invalidJsonPayload = { corrupted: true };

    const mockExecutor = async (model: string) => {
      attemptsMade.push(model);
      return {
        text: JSON.stringify(invalidJsonPayload),
        parsedJson: invalidJsonPayload,
      };
    };

    const strictValidator = (json: any) => {
      return Boolean(json && json.title && Array.isArray(json.exercises));
    };

    const res = await executeGeminiWithContingency(
      {
        feature: 'homework_generate',
        systemInstruction: 'Test',
        untrustedUserDataPrompt: 'Test',
        callerRole: 'student',
        validator: strictValidator,
      },
      mockExecutor
    );

    assert(res.success === false, '12.1: Sucesso é estritamente false quando a validação pedagógica falha');
    assert(res.parsedJson === null, '12.2: parsedJson é null (zero fallback sintético disfarçado)');
    assert(res.error?.category === 'INVALID_RESPONSE', '12.3: Categoria é INVALID_RESPONSE');
  }

  console.log('\n============================================================================');
  console.log(' ✅ TODOS OS 12 TESTES OBRIGATÓRIOS DO HOTFIX IA.2C FORAM APROVADOS!');
  console.log('============================================================================\n');

  process.exit(0);
}

runHotfixIA2CSuite().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
