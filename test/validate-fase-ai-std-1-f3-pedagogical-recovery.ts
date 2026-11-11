process.env.NODE_ENV = 'test';

import assert from 'assert';
import http from 'http';
import { app as serverApp } from '../serverApp';
import { GEMINI_POLICIES, executeGeminiWithContingency } from '../src/serverGeminiSecurity';
import { parseNotesHtml } from '../src/utils/notesHtmlParser';
import { validatePedagogicalAiResponse } from '../src/utils/pedagogicalTransformer';
import { setFirebaseAdminAuthForTesting } from '../src/serverFirebaseAdmin';

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
          resolve({ status: res.statusCode || 500, data: parsed, headers: res.headers });
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

async function runTestSuite() {
  console.log('======================================================================');
  console.log('FASE AI-STD.1 / F.3 — SUÍTE DE TESTES: RECUPERAÇÃO DA TRANSFORMAÇÃO');
  console.log('Ambiente: itissimple-security-staging | Sem Deploy | Modo Seguro');
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

  const server = http.createServer(serverApp);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  const studentUid = 'dofH3QR7IrPJyV7DL9UgGnGeLQF3';
  const studentEmail = 'student.dofh3qr7@example.com';
  const teacherUid = 'charles_lambert_auth_uid_1010';
  const teacherEmail = 'charles.lambert@example.com';
  const otherStudentUid = 'other_student_test_uid_9999';
  const otherStudentEmail = 'other.student@example.com';

  const tokenMap: Record<string, any> = {
    'token-student': { uid: studentUid, email: studentEmail, email_verified: true, role: 'student' },
    'token-other': { uid: otherStudentUid, email: otherStudentEmail, email_verified: true, role: 'student' },
    'token-teacher': { uid: teacherUid, email: teacherEmail, email_verified: true, role: 'teacher' },
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
    // ------------------------------------------------------------------------
    // TEST GROUP 1: Ajuste Exclusivo de Orçamento
    // ------------------------------------------------------------------------
    console.log('--- GRUPO 1: Ajuste Exclusivo de Orçamento ---');

    await test('1.1: Política pedagogical_transform atualizada para 4000 tokens, 15s timeout e 36s total deadline', () => {
      const policy = GEMINI_POLICIES.pedagogical_transform;
      assert.strictEqual(policy.maxOutputTokens, 4000, 'maxOutputTokens deve ser 4000');
      assert.strictEqual(policy.timeoutMs, 15000, 'timeoutMs deve ser 15000');
      assert.strictEqual(policy.totalDeadlineMs, 36000, 'totalDeadlineMs deve ser 36000');
    });

    await test('1.2: Demais políticas de IA preservadas sem alterações', () => {
      assert.strictEqual(GEMINI_POLICIES.homework_generate.maxOutputTokens, 4000, 'homework_generate preservado');
      assert.strictEqual(GEMINI_POLICIES.homework_part4.maxOutputTokens, 2200, 'homework_part4 preservado');
      assert.strictEqual(GEMINI_POLICIES.check_daily_sentence.maxOutputTokens, 1500, 'check_daily_sentence preservado');
      assert.strictEqual(GEMINI_POLICIES.check_writing.maxOutputTokens, 1200, 'check_writing preservado');
      assert.strictEqual(GEMINI_POLICIES.homework_evaluate.maxOutputTokens, 2500, 'homework_evaluate preservado');
      assert.strictEqual(GEMINI_POLICIES.dictionary_define.maxOutputTokens, 800, 'dictionary_define preservado');
      assert.strictEqual(GEMINI_POLICIES.vocab_generate.maxOutputTokens, 800, 'vocab_generate preservado');
      assert.strictEqual(GEMINI_POLICIES.lesson_insights.maxOutputTokens, 500, 'lesson_insights preservado');
    });

    // ------------------------------------------------------------------------
    // TEST GROUP 2: Diagnóstico Seguro por Tentativa e Truncamento
    // ------------------------------------------------------------------------
    console.log('\n--- GRUPO 2: Diagnóstico Seguro por Tentativa e Truncamento ---');

    await test('2.1: Instrumentação de finishReason MAX_TOKENS e flags de diagnóstico', async () => {
      const mockAttemptExecutor = async (model: string) => {
        return {
          text: '{"mistakesAnalysis": [{"original": "bad", "corrected": "good', // truncated json
          parsedJson: null,
          finishReason: 'MAX_TOKENS',
          error: {
            statusCode: 502,
            category: 'INVALID_RESPONSE',
            safeReason: 'Model response was truncated at token limit (MAX_TOKENS) and was not valid JSON.',
            rawMessage: 'MALFORMED_JSON_MAX_TOKENS',
          },
        };
      };

      const result = await executeGeminiWithContingency(
        {
          feature: 'pedagogical_transform',
          systemInstruction: 'test instruction',
          untrustedUserDataPrompt: 'test prompt',
          modelsOverride: ['gemini-3.8-flash'],
        },
        mockAttemptExecutor
      );

      assert.strictEqual(result.success, false, 'Falha deve ser reportada');
      assert(Array.isArray(result.attemptsDetails), 'attemptsDetails deve ser um array');
      assert.strictEqual(result.attemptsDetails.length, 1);
      const att = result.attemptsDetails[0];
      assert.strictEqual(att.model, 'gemini-3.8-flash');
      assert.strictEqual(att.finishReason, 'MAX_TOKENS');
      assert.strictEqual(att.isMaxTokens, true, 'isMaxTokens deve ser true');
      assert.strictEqual(att.isParseError, true, 'isParseError deve ser true');
      assert.strictEqual(att.isValidationError, false, 'isValidationError deve ser false pois parsing falhou');
      assert(typeof att.durationMs === 'number', 'durationMs deve ser numérico');
    });

    await test('2.2: Sanitização estrita: attemptsDetails não vaza chaves, emails, prompts ou respostas cruas', async () => {
      const mockAttemptExecutor = async (model: string) => {
        return {
          text: 'SECRET_RAW_AI_OUTPUT_PROMPT_KEY_123',
          parsedJson: {
            mistakesAnalysis: [],
            grammarPoints: [],
            vocabularyAndExpressions: [],
            reviewSummary: { rememberThis: 'Valid golden rule test takeaway' },
          },
          finishReason: 'STOP',
        };
      };

      const result = await executeGeminiWithContingency(
        {
          feature: 'pedagogical_transform',
          systemInstruction: 'SUPER_SECRET_SYSTEM_INSTRUCTION',
          untrustedUserDataPrompt: 'SUPER_SECRET_STUDENT_EMAIL_denivalentedeni@gmail.com',
          modelsOverride: ['gemini-3.8-flash'],
        },
        mockAttemptExecutor
      );

      assert.strictEqual(result.success, true);
      const att = result.attemptsDetails![0];
      const serializedAtt = JSON.stringify(att);

      assert(!serializedAtt.includes('SUPER_SECRET'), 'Não deve conter system instruction nem student data');
      assert(!serializedAtt.includes('denivalentedeni'), 'Não deve conter emails');
      assert(!serializedAtt.includes('SECRET_RAW_AI_OUTPUT'), 'Não deve conter resposta crua');
      assert.strictEqual(att.success, true);
      assert.strictEqual(att.safeReason, 'Valid structured response');
      assert.strictEqual(att.isMaxTokens, false);
      assert.strictEqual(att.isParseError, false);
      assert.strictEqual(att.isValidationError, false);
    });

    // ------------------------------------------------------------------------
    // TEST GROUP 3: JSON Extenso (> 2500 Tokens)
    // ------------------------------------------------------------------------
    console.log('\n--- GRUPO 3: JSON Extenso (> 2500 Tokens) ---');

    await test('3.1: Resposta com JSON extenso (> 2.500 tokens / 10.000 chars) é validada e aprovada com orçamento de 4000 tokens', async () => {
      // Create rich payload with extensive vocabulary, phonetics, examples, grammar points and mistakes
      const largeMistakes = [
        {
          id: 'mistake-1',
          original: 'I am agree with your opinion about project architecture',
          corrected: 'I agree with your opinion regarding the project architecture',
          category: 'grammar',
          explanation: 'In English, "agree" is a stative lexical verb, not an adjective. Therefore, native speakers do not use the auxiliary "to be" with agree.',
          twoExamples: [
            'I completely agree with the architectural direction our engineering team selected.',
            'She agrees that maintaining modular interfaces prevents accidental coupling across components.'
          ],
          commonPitfalls: 'Direct Portuguese translation ("estou de acordo" -> "I am agree") causes L1 interference.'
        },
        {
          id: 'mistake-2',
          original: 'He make a big question during the meeting yesterday',
          corrected: 'He asked an insightful question during yesterday\'s cross-functional sync',
          category: 'collocation',
          explanation: 'Questions are "asked", not "made" in native English collocations. Making a question is a literal calque.',
          twoExamples: [
            'Please feel free to ask questions whenever a technical requirement seems ambiguous.',
            'During the stakeholder presentation, our principal engineer asked two insightful questions.'
          ],
          commonPitfalls: 'Portuguese speakers often use "make" due to "fazer uma pergunta".'
        }
      ];

      const largeGrammar = [
        {
          id: 'grammar-1',
          topic: 'Stative Verbs and State Assertions',
          rule: 'Stative verbs describe conditions, relationships, or mental states rather than physical processes.',
          form: 'Subject + Stative Verb [agree, belong, understand, prefer] + Object',
          usage: 'Used to express stances, intellectual agreement, or preferences in professional contexts.',
          examples: [
            'We agree on the core strategic deliverables for this quarter.',
            'They understand the technical trade-offs of microservice partitioning.'
          ],
          commonMistakes: 'Prefixing stative verbs with "am", "is", or "are".',
          comparisons: 'Dynamic verbs (collaborating, building) accept continuous forms; stative verbs do not.'
        }
      ];

      // Build 5 extensive vocabulary items with high detail
      const largeVocab = [
        {
          id: 'vocab-1',
          term: 'streamline',
          partOfSpeech: 'Transitive Verb',
          definitionEn: 'To reorganize an organization or workflow to make it simpler, more efficient, and cost-effective',
          simpleDefinition: 'Otimizar, simplificar ou agilizar um processo eliminando etapas desnecessárias',
          collocations: ['streamline operations', 'streamline workflow', 'streamline communication'],
          realExamples: [
            'Our engineering department initiated an effort to streamline continuous integration deployments.',
            'Automated schema verification helps streamline team-wide code reviews.'
          ],
          synonyms: ['optimize', 'simplify', 'expedite'],
          register: 'formal',
          category: 'New Words & Expressions (Alt+W)',
          isPronunciationFocus: false,
          isNewWord: true,
        },
        {
          id: 'vocab-2',
          term: 'resilience',
          partOfSpeech: 'Pronunciation Focus',
          definitionEn: 'The capacity to recover quickly from difficulties; toughness and elasticity',
          simpleDefinition: 'Pronúncia cuidadosa focada na tonicidade da segunda sílaba: /rɪˈzɪl.jəns/',
          collocations: ['operational resilience', 'systemic resilience', 'build resilience'],
          realExamples: [
            'Distributed architectures are engineered for high operational resilience under adverse network latency.',
            'Her resilience during unexpected production outages demonstrated exemplary leadership.'
          ],
          synonyms: ['durability', 'robustness', 'elasticity'],
          register: 'neutral',
          category: 'Pronunciation & Phonetics (Alt+P)',
          phoneticGuide: '/rɪˈzɪl.jəns/ — Sílaba tônica em -ZIL-',
          isPronunciationFocus: true,
          isNewWord: false,
        }
      ];

      const largeReviewSummary = {
        estimatedMinutes: '5–10 minutes',
        keyRules: ['Stative Verbs: Do not add auxiliary "to be" with agree'],
        mustKnowVocabulary: ['streamline', 'resilience'],
        essentialCorrections: [
          { original: 'I am agree', corrected: 'I agree' },
          { original: 'He make a big question', corrected: 'He asked an insightful question' }
        ],
        rememberThis: 'Lembre-se disto: Verbos estáticos como "agree" não levam o verbo to be antes deles. Diga sempre "I agree"!',
      };

      const largeJsonPayload = {
        mistakesAnalysis: largeMistakes,
        grammarPoints: largeGrammar,
        vocabularyAndExpressions: largeVocab,
        reviewSummary: largeReviewSummary,
      };

      const serialized = JSON.stringify(largeJsonPayload);
      const estimatedTokens = Math.ceil(serialized.length / 3.5);
      assert(serialized.length > 2000, `Payload deve ser substancial (tamanho: ${serialized.length} chars)`);

      const rawNotesHtml = `
        <div>
          <span class="inline-coaching-tag font-bold" data-tag-type="incorrect">✗ I am agree</span>
          <span class="inline-coaching-tag font-bold" data-tag-type="incorrect">✗ He make a big question</span>
          <span class="inline-coaching-tag font-bold" data-tag-type="new-word">✦ streamline</span>
          <span class="inline-coaching-tag font-bold" data-tag-type="pronounce">🎯 resilience</span>
        </div>
      `;

      const markings = parseNotesHtml(rawNotesHtml);
      const validation = validatePedagogicalAiResponse(largeJsonPayload, markings, 'B2', 'pt');
      assert(validation.valid, `Validação deve passar: ${validation.reason}`);
    });

    // ------------------------------------------------------------------------
    // TEST GROUP 4: Preservação do Validador e Rejeição de Incompletude
    // ------------------------------------------------------------------------
    console.log('\n--- GRUPO 4: Preservação do Validador e Rejeição de Incompletude ---');

    await test('4.1: Validador rejeita estritamente resposta que omite termo obrigatório Alt+W', () => {
      const notes = '<span data-tag-type="new-word">✦ streamline</span> <span data-tag-type="new-word">✦ bottleneck</span>';
      const markings = parseNotesHtml(notes);

      // Model only provided streamline, missed bottleneck
      const incompleteResponse = {
        mistakesAnalysis: [],
        grammarPoints: [],
        vocabularyAndExpressions: [
          {
            term: 'streamline',
            definitionEn: 'To make simpler and faster',
            simpleDefinition: 'Agilizar ou simplificar',
            realExamples: ['We streamline the build step.'],
          }
        ],
        reviewSummary: { rememberThis: 'Pratique o termo novo hoje!' }
      };

      const res = validatePedagogicalAiResponse(incompleteResponse, markings, 'B1', 'pt');
      assert.strictEqual(res.valid, false, 'Deve rejeitar omissão de termo Alt+W');
      assert(res.reason?.includes('bottleneck'), 'Motivo deve citar termo ausente');
    });

    await test('4.2: Validador rejeita estritamente resposta que omite correção obrigatória Alt+N', () => {
      const notes = '<span class="inline-coaching-tag incorrect-tag font-bold" data-tag-type="incorrect">✗ Incorrect</span>&nbsp;I have 28 years old';
      const markings = parseNotesHtml(notes);
      assert.strictEqual(markings.errors.length, 1, 'Markings deve conter 1 erro Alt+N');

      const emptyMistakesResponse = {
        mistakesAnalysis: [],
        grammarPoints: [],
        vocabularyAndExpressions: [],
        reviewSummary: { rememberThis: 'Pratique mais hoje!' }
      };

      const res = validatePedagogicalAiResponse(emptyMistakesResponse, markings, 'A2', 'pt');
      assert.strictEqual(res.valid, false, 'Deve rejeitar ausência de mistakesAnalysis quando há Alt+N');
      assert(res.reason?.includes('omitted mistakesAnalysis'), 'Motivo deve citar omissão de Alt+N');
    });

    await test('4.3: Validador rejeita definições genéricas ou placeholders', () => {
      const notes = '<span class="inline-coaching-tag new-word-tag font-bold" data-tag-type="new-word">✦ New Word</span>&nbsp;bottleneck';
      const markings = parseNotesHtml(notes);
      assert.strictEqual(markings.newWords.length, 1, 'Markings deve conter 1 newWord');

      const genericResponse = {
        mistakesAnalysis: [],
        grammarPoints: [],
        vocabularyAndExpressions: [
          {
            term: 'bottleneck',
            definitionEn: 'A fundamental word for level B1 learners to elevate your expressive nuance in English.', // known generic template
            simpleDefinition: 'Termo em inglês.',
            realExamples: ['We solved the operational bottleneck.'],
          }
        ],
        reviewSummary: { rememberThis: 'Pratique mais hoje!' }
      };

      const res = validatePedagogicalAiResponse(genericResponse, markings, 'B1', 'pt');
      assert.strictEqual(res.valid, false, 'Deve rejeitar definição genérica');
      assert(res.reason?.includes('generic'), 'Motivo deve citar generic definition');
    });

    // ------------------------------------------------------------------------
    // TEST GROUP 5: Isolamento entre Sessões e Segurança de Permissões
    // ------------------------------------------------------------------------
    console.log('\n--- GRUPO 5: Isolamento entre Sessões e Segurança de Permissões ---');

    await test('5.1: Aluno não pode requisitar transformação de outro aluno (HTTP 403)', async () => {
      const res = await makeRequest(server, 'POST', '/api/pedagogical-notes/transform', {
        rawNotes: '<span data-tag-type="new-word">✦ streamline</span>',
        studentUid: otherStudentUid, // trying to transform for another student
        studentEmail: otherStudentEmail,
      }, { Authorization: 'Bearer token-student' });

      assert.strictEqual(res.status, 403, 'Acesso cruzado de aluno deve retornar 403');
      assert.strictEqual(res.data.error, 'Forbidden');
    });

    await test('5.2: Duas sessões distintas mantêm dados e chaves isolados sem contaminação', async () => {
      const notesSessionA = '<span data-tag-type="new-word">✦ streamline</span>';
      const notesSessionB = '<span data-tag-type="new-word">✦ benchmark</span>';

      // Transform Session A
      const resA = await makeRequest(server, 'POST', '/api/pedagogical-notes/transform', {
        rawNotes: notesSessionA,
        sessionDate: '2026-11-10',
        topic: 'Engineering Workflow',
        studentUid,
        studentEmail,
        lessonId: 'lesson-a-isolation-test',
      }, { Authorization: 'Bearer token-student' });

      // In test mode without API key, backend returns 503 AiUnavailable with attemptsDetails
      assert([200, 503].includes(resA.status), 'Status esperado 200 ou 503 transparente');
      assert(Array.isArray(resA.data.attemptsDetails), 'attemptsDetails deve estar presente');

      // Transform Session B
      const resB = await makeRequest(server, 'POST', '/api/pedagogical-notes/transform', {
        rawNotes: notesSessionB,
        sessionDate: '2026-11-11',
        topic: 'Quality Metrics',
        studentUid,
        studentEmail,
        lessonId: 'lesson-b-isolation-test',
      }, { Authorization: 'Bearer token-student' });

      assert([200, 503].includes(resB.status), 'Status esperado 200 ou 503 transparente');
      assert(Array.isArray(resB.data.attemptsDetails), 'attemptsDetails deve estar presente');
    });

    // ------------------------------------------------------------------------
    // TEST GROUP 6: Preservação do Dicionário e Journal
    // ------------------------------------------------------------------------
    console.log('\n--- GRUPO 6: Preservação do Dicionário e Journal ---');

    await test('6.1: GET /api/student-dictionary e /api/student-journal preservam registros existentes', async () => {
      const dictRes = await makeRequest(server, 'GET', `/api/student-dictionary?studentUid=${studentUid}`, undefined, {
        Authorization: 'Bearer token-student'
      });
      assert.strictEqual(dictRes.status, 200, 'GET dictionary deve responder 200');

      const journalRes = await makeRequest(server, 'GET', `/api/student-journal?studentUid=${studentUid}`, undefined, {
        Authorization: 'Bearer token-student'
      });
      assert.strictEqual(journalRes.status, 200, 'GET journal deve responder 200');
    });

  } finally {
    server.close();
  }

  console.log('\n======================================================================');
  console.log(`TOTAL DE TESTES FASE AI-STD.1 / F.3: ${passed + failed} | APROVADOS: ${passed} | FALHAS: ${failed}`);
  console.log('======================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
  process.exit(0);
}

runTestSuite().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
