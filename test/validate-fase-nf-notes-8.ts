process.env.NODE_ENV = 'test';

import assert from 'assert';
import http from 'http';
import { app as serverApp } from '../serverApp';
import { setFirebaseAdminAuthForTesting } from '../src/serverFirebaseAdmin';
import {
  isLegacyGenericTransformation,
  validatePedagogicalAiResponse,
  getCanonicalSessionKey,
  generateLocalPedagogicalTransformation,
  computeNotesHash,
  buildPedagogicalCacheKey,
  parseNotesHtml,
  PedagogicalLessonTransformation,
} from '../src/utils/pedagogicalTransformer';
import {
  DEFAULT_GEMINI_MODEL,
  resolveGeminiContingencyModels,
  executeGeminiWithContingency,
  executeGeminiSingleAttempt,
  classifyGeminiError,
  isNonRecoverableGeminiError,
  isModelConfigIncompatibleError,
  resetGeminiSecurityStateForTesting,
} from '../src/serverGeminiSecurity';
import {
  savePedagogicalTransformationToFirestoreServer,
  fetchPedagogicalTransformationFromFirestoreServer,
  setFirebaseAdminFirestoreForTesting,
  resetFirebaseAdminFirestoreForTesting,
  setIsCloudWriteDisabled,
} from '../src/serverFirestore';

/**
 * FASE NF-NOTES.8 — Testes Obrigatórios:
 * Correção Cirúrgica da Transformação Pedagógica Gemini
 * 
 * 1. streamline presente nas anotações legítimas não é rejeitado.
 * 2. Conteúdo fictício de fixtures continua sendo rejeitado.
 * 3. Cache válido é salvo e recuperado após simulação de reinicialização.
 * 4. Sessão sem lessonId mantém a chave canônica.
 * 5. Falha recuperável do modelo primário permite failover.
 * 6. Modelo inválido não é tratado como sucesso.
 * 7. rememberThis ausente é complementado apenas quando seguro.
 * 8. Nenhum erro gramatical é inventado.
 * 9. Fallback continua exibindo as anotações originais.
 * 10. NF-NOTES.6, roles, UIDs e vínculos pedagógicos não sofrem regressão.
 */

function makeRequest(
  server: http.Server,
  method: string,
  path: string,
  body?: any,
  headers: Record<string, string> = {}
): Promise<{ status: number; data: any; headers: any }> {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    if (!addr || typeof addr === 'string') {
      return reject(new Error('Server address not available'));
    }
    const port = addr.port;
    const bodyStr = body ? JSON.stringify(body) : undefined;
    const reqHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      ...headers,
    };
    if (bodyStr) {
      reqHeaders['Content-Length'] = Buffer.byteLength(bodyStr).toString();
    }

    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path,
        method,
        headers: reqHeaders,
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => {
          raw += chunk;
        });
        res.on('end', () => {
          let parsed: any;
          try {
            parsed = JSON.parse(raw);
          } catch {
            parsed = raw;
          }
          resolve({
            status: res.statusCode || 0,
            data: parsed,
            headers: res.headers,
          });
        });
      }
    );

    req.on('error', reject);
    if (bodyStr) {
      req.write(bodyStr);
    }
    req.end();
  });
}

async function runNFNotes8TestSuite() {
  console.log('======================================================================');
  console.log('FASE NF-NOTES.8 — SUÍTE DE TESTES OBRIGATÓRIOS');
  console.log('Correção Cirúrgica da Transformação Pedagógica Gemini');
  console.log('======================================================================\n');

  let passed = 0;
  let failed = 0;

  async function test(name: string, fn: () => void | Promise<void>) {
    try {
      await fn();
      passed++;
      console.log(`  ✅ [PASS] ${name}`);
    } catch (err: any) {
      failed++;
      console.error(`  ❌ [FAIL] ${name}`);
      console.error(`         ${err.message}`);
    }
  }

  // -------------------------------------------------------------------------
  // TESTE 1: streamline presente nas anotações legítimas não é rejeitado
  // -------------------------------------------------------------------------
  await test('1. streamline presente nas anotações legítimas não é rejeitado', () => {
    const legitimateNote = `<div>Session Notes 10/11<br><span data-tag-type="new-word">✦ New Word</span>&nbsp;streamline</div>`;
    const transformation: PedagogicalLessonTransformation = {
      sessionKey: 'session_2026-11-10_dofH3QR7IrPJyV7DL9UgGnGeLQF3',
      sessionDate: '2026-11-10',
      topic: 'Business English & Operations',
      studentLevel: 'intermediate',
      cefrLevel: 'B1',
      isAiGenerated: true,
      isFallback: false,
      isProvisional: false,
      rawNotesSnippet: 'Session Notes 10/11\n✦ New Word streamline',
      mistakesAnalysis: [],
      grammarPoints: [],
      vocabularyAndExpressions: [
        {
          id: 'vocab-1',
          term: 'streamline',
          partOfSpeech: 'verb',
          definitionEn: 'To make an organization or process more efficient and effective by simplifying or eliminating redundant steps.',
          simpleDefinition: 'Otimizar ou simplificar um processo para torná-lo mais ágil e econômico.',
          collocations: ['streamline the process', 'streamline operations', 'streamline workflow'],
          realExamples: [
            'Our team implemented new software to streamline the onboarding workflow.',
            'They are looking for effective ways to streamline business communication.',
          ],
          synonyms: ['simplify', 'optimize', 'rationalize'],
          register: 'formal',
          category: 'New Words & Expressions (Alt+W)',
        },
      ],
      reviewSummary: {
        estimatedMinutes: '5–10 minutes',
        keyRules: [],
        mustKnowVocabulary: ['✨ streamline (verb) — Otimizar ou simplificar um processo'],
        essentialCorrections: [],
        rememberThis: 'Lembre-se disto: Pratique o uso de "streamline" naturalmente em suas reuniões diárias!',
      },
      correctStampsCount: 0,
      incorrectStampsCount: 0,
      newWordStampsCount: 1,
      generatedAt: new Date().toISOString(),
    };

    // 1.1: Com as notas originas fornecidas
    const isGenericWithNotes = isLegacyGenericTransformation(transformation, legitimateNote);
    assert.strictEqual(
      isGenericWithNotes,
      false,
      'A transformação legítima com "streamline" presente nas notas NÃO pode ser rejeitada como genérica'
    );

    // 1.2: Quando rawNotesOrMarkings estiver ausente, mas os dados forem autênticos
    const isGenericWithoutNotesParam = isLegacyGenericTransformation(transformation);
    assert.strictEqual(
      isGenericWithoutNotesParam,
      false,
      'Não presumir conteúdo fictício quando rawNotesOrMarkings estiver ausente se os dados forem válidos'
    );
  });

  // -------------------------------------------------------------------------
  // TESTE 2: Conteúdo fictício de fixtures continua sendo rejeitado
  // -------------------------------------------------------------------------
  await test('2. Conteúdo fictício de fixtures continua sendo rejeitado', () => {
    const notesWithoutWords = `<div>Session Notes<br>Discussed general routine and daily tasks.</div>`;

    // 2.1: Injeção artificial de "streamline" quando as notas não a contêm
    const fabricatedTransformation: any = {
      sessionKey: 'session_2026-11-10_test',
      isAiGenerated: true,
      rawNotesSnippet: 'Session Notes\nDiscussed general routine and daily tasks.',
      mistakesAnalysis: [],
      grammarPoints: [],
      vocabularyAndExpressions: [
        {
          id: 'vocab-1',
          term: 'streamline',
          simpleDefinition: 'A fundamental word for level B1 vocabulary.', // Generic definition
          realExamples: ['Practicing with "streamline" in daily english conversations builds natural fluency.'], // Generic example
        },
      ],
      reviewSummary: {
        rememberThis: 'Remember this!',
      },
    };

    const rejectedFabrication = isLegacyGenericTransformation(fabricatedTransformation, notesWithoutWords);
    assert.strictEqual(
      rejectedFabrication,
      true,
      'Vocabulário sintético ausente das notas originais deve ser rejeitado'
    );

    // 2.2: Fixture com definição genérica padrão
    const genericDefTransformation: any = {
      sessionKey: 'session_2026-11-10_test',
      isAiGenerated: true,
      mistakesAnalysis: [],
      grammarPoints: [],
      vocabularyAndExpressions: [
        {
          id: 'vocab-1',
          term: 'resilience',
          simpleDefinition: 'A fundamental word for level B1 learners to practice daily.',
          realExamples: ['She showed great resilience during difficult moments.'],
        },
      ],
      reviewSummary: {
        rememberThis: 'Always keep practicing!',
      },
    };
    assert.strictEqual(
      isLegacyGenericTransformation(genericDefTransformation),
      true,
      'Definição genérica artificial deve ser rejeitada como fixture'
    );

    // 2.3: Fixture com exemplos sintéticos genéricos
    const genericExTransformation: any = {
      sessionKey: 'session_2026-11-10_test',
      isAiGenerated: true,
      mistakesAnalysis: [],
      grammarPoints: [],
      vocabularyAndExpressions: [
        {
          id: 'vocab-1',
          term: 'collaborate',
          simpleDefinition: 'To work together with others to achieve a shared goal.',
          realExamples: ['with confidence in our routine'], // Generic example template
        },
      ],
      reviewSummary: {
        rememberThis: 'Always keep practicing!',
      },
    };
    assert.strictEqual(
      isLegacyGenericTransformation(genericExTransformation),
      true,
      'Exemplo sintético genérico deve ser rejeitado como fixture'
    );
  });

  // -------------------------------------------------------------------------
  // TESTE 3: Cache válido é salvo e recuperado após simulação de reinicialização
  // -------------------------------------------------------------------------
  await test('3. Cache válido é salvo e recuperado após simulação de reinicialização', async () => {
    const sessionKey = 'session_2026-11-10_dofH3QR7IrPJyV7DL9UgGnGeLQF3';
    const noteContent = `<div>Session Notes 10/11<br><span data-tag-type="new-word">✦ New Word</span>&nbsp;streamline</div>`;
    const hash = computeNotesHash(noteContent);
    const cacheKey = buildPedagogicalCacheKey({
      canonicalSessionKey: sessionKey,
      contentHash: hash,
      language: 'pt',
      cefrLevel: 'B1',
    });

    const validTransformation: PedagogicalLessonTransformation = {
      sessionKey,
      sessionDate: '2026-11-10',
      topic: 'Business English Operations',
      studentLevel: 'intermediate',
      cefrLevel: 'B1',
      contentHash: hash,
      language: 'pt',
      isAiGenerated: true,
      isFallback: false,
      isProvisional: false,
      rawNotesSnippet: 'Session Notes 10/11\n✦ New Word streamline',
      mistakesAnalysis: [],
      grammarPoints: [],
      vocabularyAndExpressions: [
        {
          id: 'vocab-1',
          term: 'streamline',
          partOfSpeech: 'verb',
          definitionEn: 'To make an organization or process simpler and more effective.',
          simpleDefinition: 'Otimizar ou simplificar um processo corporativo.',
          collocations: ['streamline the process', 'streamline operations'],
          realExamples: ['We hired a specialist to streamline our logistical processes.'],
          synonyms: ['simplify', 'optimize'],
          register: 'formal',
          category: 'New Words & Expressions (Alt+W)',
        },
      ],
      reviewSummary: {
        estimatedMinutes: '5–10 minutes',
        keyRules: [],
        mustKnowVocabulary: ['✨ streamline (verb) — Otimizar ou simplificar um processo'],
        essentialCorrections: [],
        rememberThis: 'Lembre-se disto: Pratique o uso de "streamline" naturalmente em suas conversas diárias!',
      },
      correctStampsCount: 0,
      incorrectStampsCount: 0,
      newWordStampsCount: 1,
      generatedAt: new Date().toISOString(),
    };

    // Configurar Mock Firestore determinístico para simular persistência e reinicialização
    const storage = new Map<string, any>();
    const mockFirestore: any = {
      collection: (colName: string) => ({
        doc: (docId: string) => ({
          collection: (subColName: string) => ({
            doc: (subDocId: string) => ({
              set: async (data: any) => {
                storage.set(`${colName}/${docId}/${subColName}/${subDocId}`, data);
                return { writeTime: new Date() };
              },
              get: async () => {
                const key = `${colName}/${docId}/${subColName}/${subDocId}`;
                const data = storage.get(key);
                return {
                  exists: Boolean(data),
                  data: () => data,
                };
              },
            }),
            get: async () => {
              const prefix = `${colName}/${docId}/${subColName}/`;
              const docs: any[] = [];
              for (const [k, v] of storage.entries()) {
                if (k.startsWith(prefix)) {
                  docs.push({
                    id: k.replace(prefix, ''),
                    data: () => v,
                  });
                }
              }
              return {
                empty: docs.length === 0,
                docs,
              };
            },
          }),
        }),
      }),
    };

    setFirebaseAdminFirestoreForTesting(mockFirestore);
    setIsCloudWriteDisabled(false);

    try {
      // 1. Salvar no Firestore Server
      const saved = await savePedagogicalTransformationToFirestoreServer(cacheKey, validTransformation, {
        rawNotes: noteContent,
      });
      assert.strictEqual(saved, true, 'O salvamento da transformação autêntica no Firestore deve retornar true');

      // 2. Recuperar do Firestore Server
      const retrieved = await fetchPedagogicalTransformationFromFirestoreServer(cacheKey, {
        language: 'pt',
        contentHash: hash,
        rawNotes: noteContent,
      });

      assert.ok(retrieved, 'A transformação deve ser recuperada do Firestore');
      assert.strictEqual(retrieved.sessionKey, sessionKey);
      assert.strictEqual(retrieved.isAiGenerated, true);
      assert.strictEqual(retrieved.vocabularyAndExpressions?.[0]?.term, 'streamline');
    } finally {
      resetFirebaseAdminFirestoreForTesting();
    }
  });

  // -------------------------------------------------------------------------
  // TESTE 4: Sessão sem lessonId mantém a chave canônica
  // -------------------------------------------------------------------------
  await test('4. Sessão sem lessonId mantém a chave canônica', () => {
    const studentUid = 'dofH3QR7IrPJyV7DL9UgGnGeLQF3';
    const sessionDate = '2026-11-10';

    const canonicalKey = getCanonicalSessionKey({
      studentUid,
      sessionDate,
    });

    assert.strictEqual(
      canonicalKey,
      'session_2026-11-10_dofH3QR7IrPJyV7DL9UgGnGeLQF3',
      'Chave canônica determinística gerada sem lessonId'
    );

    const withLessonId = getCanonicalSessionKey({
      lessonId: 'lesson_abc123',
      studentUid,
      sessionDate,
    });
    assert.strictEqual(withLessonId, 'lesson_abc123', 'lessonId opcional é preservado quando fornecido');
  });

  // -------------------------------------------------------------------------
  // TESTE 5: Falha recuperável do modelo primário permite failover
  // -------------------------------------------------------------------------
  await test('5. Falha recuperável do modelo primário permite failover', async () => {
    resetGeminiSecurityStateForTesting();

    const contingencyModels = resolveGeminiContingencyModels();
    assert.ok(contingencyModels.length >= 2, 'Pelo menos 2 modelos configurados para contingência');

    const attemptsMade: string[] = [];
    const mockExecutor = async (model: string) => {
      attemptsMade.push(model);
      if (model === contingencyModels[0]) {
        // Modelo 1 falha com erro 503 temporário (recuperável)
        const err: any = new Error('503 Service Unavailable: High demand on gemini-3.8-flash');
        err.status = 503;
        throw err;
      }
      // Modelo 2 responde com sucesso
      return {
        text: JSON.stringify({ ok: true, source: model }),
        parsedJson: { ok: true, source: model },
      };
    };

    const result = await executeGeminiWithContingency(
      {
        feature: 'pedagogical_transform',
        systemInstruction: 'Test',
        untrustedUserDataPrompt: 'Test Data',
      },
      mockExecutor
    );

    assert.strictEqual(result.success, true, 'Failover permitiu execução bem-sucedida no modelo 2');
    assert.strictEqual(result.modelUsed, contingencyModels[1], 'Modelo 2 entregou a resposta com sucesso');
    assert.strictEqual(attemptsMade.length, 2, 'Tentou exatamente o modelo 1 (falhou) e o modelo 2 (sucesso)');
    assert.strictEqual(result.interruptionReason, 'sucesso');
  });

  // -------------------------------------------------------------------------
  // TESTE 6: Modelo inválido não é tratado como sucesso
  // -------------------------------------------------------------------------
  await test('6. Modelo inválido não é tratado como sucesso', async () => {
    resetGeminiSecurityStateForTesting();

    const mockExecutor = async (model: string) => {
      // Todos os modelos retornam erro de modelo inválido ou não encontrado
      const err: any = new Error(`404 Not Found: Model ${model} is not available or does not exist`);
      err.status = 404;
      throw err;
    };

    const result = await executeGeminiWithContingency(
      {
        feature: 'pedagogical_transform',
        systemInstruction: 'Test',
        untrustedUserDataPrompt: 'Test Data',
      },
      mockExecutor
    );

    assert.strictEqual(result.success, false, 'Modelo inválido NÃO deve ser tratado como sucesso');
    assert.strictEqual(result.parsedJson, null, 'parsedJson deve ser estritamente null em caso de falha');
    assert.strictEqual(result.error?.category, 'MODEL_NOT_FOUND', 'Erro classificado corretamente como MODEL_NOT_FOUND');
  });

  // -------------------------------------------------------------------------
  // TESTE 7: rememberThis ausente é complementado apenas quando seguro
  // -------------------------------------------------------------------------
  await test('7. rememberThis ausente é complementado apenas quando seguro', () => {
    const markings = parseNotesHtml(`
      <div>
        <span data-tag-type="incorrect">✗</span>&nbsp;I am agree with you -> I agree with you<br>
        <span data-tag-type="new-word">✦ New Word</span>&nbsp;streamline
      </div>
    `);

    // Resposta válida da IA, mas com rememberThis ausente
    const aiResponseWithoutRememberThis: any = {
      mistakesAnalysis: [
        {
          id: 'mistake-1',
          original: 'I am agree with you',
          corrected: 'I agree with you',
          explanation: 'Agree is an active verb, not an adjective.',
          twoExamples: ['I agree with your suggestion.', 'She agrees with our plan.'],
          commonPitfalls: 'Saying "I am agree".',
        },
      ],
      vocabularyAndExpressions: [
        {
          id: 'vocab-1',
          term: 'streamline',
          definitionEn: 'To simplify and improve efficiency.',
          simpleDefinition: 'Tornar mais ágil e direto.',
          realExamples: ['We streamlined the entire process.'],
          register: 'neutral',
          category: 'Vocabulary',
        },
      ],
      reviewSummary: {
        estimatedMinutes: '5 minutes',
        keyRules: ['Agree is an active verb'],
        mustKnowVocabulary: ['streamline'],
        essentialCorrections: [{ original: 'I am agree with you', corrected: 'I agree with you' }],
        rememberThis: '', // Ausente / vazio
      },
    };

    const validationResult = validatePedagogicalAiResponse(aiResponseWithoutRememberThis, markings, 'B1', 'pt');
    assert.strictEqual(validationResult.valid, true, 'Resposta válida não deve ser descartada por falta de rememberThis');
    assert.ok(
      typeof aiResponseWithoutRememberThis.reviewSummary.rememberThis === 'string' &&
      aiResponseWithoutRememberThis.reviewSummary.rememberThis.length >= 5,
      'rememberThis deve ser complementado de forma segura'
    );
    assert.ok(
      aiResponseWithoutRememberThis.reviewSummary.rememberThis.includes('I agree with you') ||
      aiResponseWithoutRememberThis.reviewSummary.rememberThis.includes('streamline'),
      'rememberThis complementado referencia itens autênticos verificados'
    );

    // Caso 2: Notas SEM erros gramaticais (apenas vocabulário).
    // Garantir que NÃO seja inventado nenhum erro gramatical em rememberThis!
    const markingsVocabOnly = parseNotesHtml(`<div><span data-tag-type="new-word">✦ New Word</span>&nbsp;streamline</div>`);
    const aiResponseVocabOnly: any = {
      mistakesAnalysis: [],
      vocabularyAndExpressions: [
        {
          id: 'vocab-1',
          term: 'streamline',
          definitionEn: 'To simplify and improve efficiency.',
          simpleDefinition: 'Tornar mais ágil e direto.',
          realExamples: ['We streamlined the entire process.'],
          register: 'neutral',
          category: 'Vocabulary',
        },
      ],
      reviewSummary: {
        estimatedMinutes: '5 minutes',
        keyRules: [],
        mustKnowVocabulary: ['streamline'],
        essentialCorrections: [],
        rememberThis: '',
      },
    };

    const valResVocab = validatePedagogicalAiResponse(aiResponseVocabOnly, markingsVocabOnly, 'B1', 'pt');
    assert.strictEqual(valResVocab.valid, true);
    assert.ok(
      !aiResponseVocabOnly.reviewSummary.rememberThis.includes('agree') &&
      !aiResponseVocabOnly.reviewSummary.rememberThis.includes('28 years old'),
      'Nenhum erro gramatical sintético é inventado no rememberThis de sessões sem erros'
    );
  });

  // -------------------------------------------------------------------------
  // TESTE 8: Nenhum erro gramatical é inventado
  // -------------------------------------------------------------------------
  await test('8. Nenhum erro gramatical é inventado', () => {
    // Nota contendo apenas novo vocabulário, sem erros marcados pelo professor
    const cleanNote = `<div>Session Notes<br><span data-tag-type="new-word">✦ New Word</span>&nbsp;streamline</div>`;
    const markings = parseNotesHtml(cleanNote);

    // Tentativa de IA inserindo erro sintético "I have 28 years old"
    const maliciousAiResponse: any = {
      mistakesAnalysis: [
        {
          id: 'mistake-1',
          original: 'I have 28 years old',
          corrected: 'I am 28 years old',
          explanation: 'Age uses to be.',
          twoExamples: ['I am 28.'],
        },
      ],
      vocabularyAndExpressions: [
        {
          id: 'vocab-1',
          term: 'streamline',
          definitionEn: 'To simplify and improve efficiency.',
          simpleDefinition: 'Tornar mais ágil e direto.',
          realExamples: ['We streamlined the process.'],
        },
      ],
      reviewSummary: {
        rememberThis: 'Remember this!',
      },
    };

    const validation = validatePedagogicalAiResponse(maliciousAiResponse, markings, 'B1', 'pt');
    assert.strictEqual(validation.valid, false, 'Erro gramatical não presente nas anotações DEVE ser rejeitado');
    assert.ok(
      validation.reason?.includes('synthetic mistake') || validation.reason?.includes('no errors'),
      `Motivo da rejeição: ${validation.reason}`
    );

    // Geração determinística de fallback também não inventa erros
    const local = generateLocalPedagogicalTransformation({
      rawNotes: cleanNote,
      studentLevel: 'intermediate',
    });
    assert.strictEqual(local.mistakesAnalysis.length, 0, 'Fallback local não inventa erros gramaticais');
    assert.strictEqual(local.grammarPoints.length, 0, 'Fallback local não inventa regras gramaticais');
  });

  // -------------------------------------------------------------------------
  // TESTE 9: Fallback continua exibindo as anotações originais
  // -------------------------------------------------------------------------
  await test('9. Fallback continua exibindo as anotações originais', () => {
    const originalTeacherNote = `<div>Session Notes 10/11<br><span data-tag-type="new-word">✦ New Word</span>&nbsp;streamline<br>Great pronunciation practice!</div>`;
    const fallback = generateLocalPedagogicalTransformation({
      rawNotes: originalTeacherNote,
      sessionDate: '2026-11-10',
      studentLevel: 'intermediate',
      language: 'pt',
    });

    assert.strictEqual(fallback.isFallback, true, 'isFallback é true');
    assert.strictEqual(fallback.isAiGenerated, false, 'isAiGenerated é false');
    assert.strictEqual(fallback.source, 'fallback', 'source é fallback');
    assert.ok(
      fallback.rawNotesSnippet?.includes('streamline') || fallback.rawNotesSnippet?.includes('Session Notes'),
      'O snippet preserva o conteúdo das anotações originais'
    );
    assert.ok(
      fallback.vocabularyAndExpressions.some((v) => v.term.toLowerCase() === 'streamline'),
      'Preserva o termo "streamline" marcado pelo professor'
    );
  });

  // -------------------------------------------------------------------------
  // TESTE 10: NF-NOTES.6, roles, UIDs e vínculos pedagógicos não sofrem regressão
  // -------------------------------------------------------------------------
  await test('10. NF-NOTES.6, roles, UIDs e vínculos pedagógicos não sofrem regressão', async () => {
    const server = http.createServer(serverApp);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

    const canonicalStudentUid = 'dofH3QR7IrPJyV7DL9UgGnGeLQF3';
    const canonicalStudentEmail = 'student.dofh3qr7@example.com';
    const charlesLambertUid = 'charles_lambert_auth_uid_1010';
    const charlesLambertEmail = 'charles.lambert@example.com';
    const unauthTeacherUid = 'unauthorized_teacher_uid_9999';
    const unauthTeacherEmail = 'unauth.teacher@example.com';

    const tokenMap: Record<string, any> = {
      'token-student-dof': { uid: canonicalStudentUid, email: canonicalStudentEmail, email_verified: true, role: 'student' },
      'token-charles-lambert': { uid: charlesLambertUid, email: charlesLambertEmail, email_verified: true, role: 'teacher' },
      'token-unauth-teacher': { uid: unauthTeacherUid, email: unauthTeacherEmail, email_verified: true, role: 'teacher' },
      'token-admin': { uid: 'admin_uid', email: 'admin@example.com', email_verified: true, role: 'admin', admin: true },
    };

    setFirebaseAdminAuthForTesting({
      verifyIdToken: async (token: string) => {
        const match = tokenMap[token];
        if (match) return match;
        throw new Error(`Invalid token: ${token}`);
      },
      getUser: async (uid: string) => {
        const found = Object.values(tokenMap).find((u) => u.uid === uid);
        if (found) return found;
        throw new Error(`User not found: ${uid}`);
      },
      getUserByEmail: async (email: string) => {
        const found = Object.values(tokenMap).find((u) => u.email === email);
        if (found) return found;
        throw new Error('User not found');
      },
      setCustomUserClaims: async () => {},
    } as any);

    try {
      // 1. Register and approve Charles Lambert
      await makeRequest(server, 'POST', '/api/tutors', {
        email: charlesLambertEmail,
        name: 'Charles Lambert',
        availableDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
        availableHours: ['09:00', '10:00', '14:00', '15:00'],
        uid: charlesLambertUid,
        approvalStatus: 'approved',
        isApproved: true,
        registeredByAdmin: true,
      }, { Authorization: 'Bearer token-admin' });

      await makeRequest(server, 'POST', `/api/tutors/${charlesLambertUid}/approve`, {}, { Authorization: 'Bearer token-admin' });

      // 2. Register Unauthorized Teacher
      await makeRequest(server, 'POST', '/api/tutors', {
        email: unauthTeacherEmail,
        name: 'Unauthorized Teacher',
        availableDays: ['monday', 'wednesday'],
        availableHours: ['10:00'],
        uid: unauthTeacherUid,
        approvalStatus: 'approved',
        isApproved: true,
        registeredByAdmin: true,
      }, { Authorization: 'Bearer token-admin' });

      await makeRequest(server, 'POST', `/api/tutors/${unauthTeacherUid}/approve`, {}, { Authorization: 'Bearer token-admin' });

      // 3. Register Student with pedagogical link to Charles Lambert
      await makeRequest(server, 'POST', '/api/auth/google', {
        uid: canonicalStudentUid,
        email: canonicalStudentEmail,
        name: 'Student Reference dofH3QR7',
        assignedNativeFriendUID: charlesLambertUid,
        teacherUid: charlesLambertUid,
      }, { Authorization: 'Bearer token-student-dof' });

      await makeRequest(server, 'POST', '/api/user/profile', {
        uid: canonicalStudentUid,
        email: canonicalStudentEmail,
        name: 'Student Reference dofH3QR7',
        assignedNativeFriendUID: charlesLambertUid,
        teacherUid: charlesLambertUid,
        level: 'intermediate',
      }, { Authorization: 'Bearer token-student-dof' });

      // Charles grava Session Note de 10/11
      const noteRes = await makeRequest(server, 'POST', '/api/session-notes', {
        studentUid: canonicalStudentUid,
        sessionDate: '2026-11-10',
        topic: 'Advanced Idioms with Streamline',
        content: `<div>Session Notes 10/11<br><span data-tag-type="new-word">✦ New Word</span>&nbsp;streamline</div>`,
      }, { Authorization: 'Bearer token-charles-lambert' });

      assert.strictEqual(noteRes.status, 200, 'Gravação da nota deve ter sucesso');

      // Professor não-autorizado tenta acessar -> deve receber 403
      const unauthAccess = await makeRequest(
        server,
        'GET',
        `/api/session-notes?studentUid=${canonicalStudentUid}`,
        undefined,
        { Authorization: 'Bearer token-unauth-teacher' }
      );
      assert.strictEqual(unauthAccess.status, 403, 'Professor sem vínculo pedagógico recebe 403');

      // Aluno consulta seu próprio histórico -> deve receber 200
      const studentHistory = await makeRequest(
        server,
        'GET',
        `/api/session-notes?studentUid=${canonicalStudentUid}`,
        undefined,
        { Authorization: 'Bearer token-student-dof' }
      );
      assert.strictEqual(studentHistory.status, 200, 'Aluno consulta seu próprio histórico com sucesso');
      assert.ok(Array.isArray(studentHistory.data) && studentHistory.data.length > 0, 'Histórico contém as notas gravadas');
    } finally {
      server.close();
    }
  });

  console.log('\n======================================================================');
  console.log(`FASE NF-NOTES.8 — RESULTADO FINAL: ${passed} PASSOU | ${failed} FALHOU`);
  console.log('======================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
  process.exit(0);
}

runNFNotes8TestSuite().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
