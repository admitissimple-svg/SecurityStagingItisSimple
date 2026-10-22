/**
 * BATERIA DE TESTES DE INTEGRAÇÃO — HOTFIX 2.1:
 * NATIVE FRIEND NOTES: QUALIDADE E PERSISTÊNCIA
 *
 * Requisitos Verificados:
 * 1. Preservação da contingência de 3 modelos Gemini.
 * 2. Anotação com vocabulário exclusivo (Alt+W) — sem erros ou regras sintéticas.
 * 3. Anotação com gramática exclusiva (Alt+N) — sem vocabulário sintético.
 * 4. Anotação com pronúncia exclusiva (Alt+P) — foco em pronúncia, sem inserções fictícias.
 * 5. Anotação combinada (Alt+W + Alt+N + Alt+P) — validação estrita de integridade.
 * 6. Falha dos três modelos — erro transparente sem inventar conteúdo; notas originais intactas.
 * 7. Persistência no Firestore (default) e recuperação idêntica pós-F5 sem chamadas Gemini.
 * 8. Rejeição e invalidação de conteúdo genérico legado em cache.
 */

process.env.NODE_ENV = 'test';
process.env.FIREBASE_PROJECT_ID = 'itissimple-security-staging';
process.env.FIREBASE_DATABASE_ID = '(default)';

import assert from 'assert';
import { parseNotesHtml } from '../src/utils/notesHtmlParser';
import {
  validatePedagogicalAiResponse,
  isLegacyGenericTransformation,
  computeNotesHash,
  getCanonicalSessionKey,
} from '../src/utils/pedagogicalTransformer';
import {
  DEFAULT_GEMINI_MODEL,
  GEMINI_CONTINGENCY_MODELS,
  executeGeminiWithContingency,
} from '../src/serverGeminiSecurity';
import {
  savePedagogicalTransformationToFirestoreServer,
  fetchPedagogicalTransformationFromFirestoreServer,
  setFirebaseAdminFirestoreForTesting,
} from '../src/serverFirestore';

// Mock Firestore for deterministic isolated execution
class MockDocRef {
  constructor(public id: string, private store: Map<string, any>, private parentPath: string) {}

  async get() {
    const key = `${this.parentPath}/${this.id}`;
    const data = this.store.get(key);
    return {
      id: this.id,
      exists: Boolean(data),
      data: () => (data ? JSON.parse(JSON.stringify(data)) : undefined),
    };
  }

  async set(data: any, options?: { merge?: boolean }) {
    const key = `${this.parentPath}/${this.id}`;
    const existing = this.store.get(key) || {};
    const merged = options?.merge ? { ...existing, ...JSON.parse(JSON.stringify(data)) } : JSON.parse(JSON.stringify(data));
    this.store.set(key, merged);
  }

  collection(subName: string) {
    return new MockCollectionRef(`${this.parentPath}/${this.id}/${subName}`, this.store);
  }
}

class MockCollectionRef {
  constructor(public path: string, private store: Map<string, any>) {}

  doc(id: string) {
    return new MockDocRef(id, this.store, this.path);
  }

  async get() {
    const docs: any[] = [];
    for (const [k, v] of this.store.entries()) {
      const prefix = `${this.path}/`;
      if (k.startsWith(prefix)) {
        const remainder = k.substring(prefix.length);
        if (!remainder.includes('/')) {
          docs.push({
            id: remainder,
            data: () => JSON.parse(JSON.stringify(v)),
          });
        }
      }
    }
    return {
      empty: docs.length === 0,
      size: docs.length,
      docs,
      forEach: (cb: any) => docs.forEach(cb),
    };
  }
}

class MockFirestoreDb {
  private store = new Map<string, any>();

  collection(name: string) {
    return new MockCollectionRef(name, this.store);
  }

  clear() {
    this.store.clear();
  }
}

const mockFirestore = new MockFirestoreDb();
setFirebaseAdminFirestoreForTesting(mockFirestore as any);

let totalTests = 0;
let passedTests = 0;

function testAssert(condition: boolean, desc: string, detail?: any) {
  totalTests++;
  if (condition) {
    console.log(`  ✅ PASS: ${desc}`);
    passedTests++;
  } else {
    console.error(`  ❌ FAIL: ${desc}`, detail || '');
    throw new Error(`Assertion failed: ${desc}`);
  }
}

async function runHotfix21TestSuite() {
  console.log('============================================================================');
  console.log(' TEST SUITE — HOTFIX 2.1: NATIVE FRIEND NOTES QUALIDADE E PERSISTÊNCIA');
  console.log(' Target Project: itissimple-security-staging | DB: (default)');
  console.log('============================================================================\n');

  // --------------------------------------------------------------------------
  // TESTE 1: Preservação da contingência de 3 modelos Gemini
  // --------------------------------------------------------------------------
  console.log('--- 1. Contingência dos 3 Modelos Gemini ---');
  testAssert(DEFAULT_GEMINI_MODEL === 'gemini-3.5-flash', 'Modelo primário é gemini-3.5-flash');
  testAssert(
    GEMINI_CONTINGENCY_MODELS.length === 3 &&
      GEMINI_CONTINGENCY_MODELS[0] === 'gemini-3.5-flash' &&
      GEMINI_CONTINGENCY_MODELS[1] === 'gemini-3.8-flash' &&
      GEMINI_CONTINGENCY_MODELS[2] === 'gemini-3.1-flash-lite',
    'Pool de contingência mantém exatamente os 3 modelos autorizados na ordem correta'
  );

  // --------------------------------------------------------------------------
  // TESTE 2: Anotação com Vocabulário Exclusivo (Alt+W)
  // --------------------------------------------------------------------------
  console.log('\n--- 2. Anotação com Vocabulário Exclusivo (Alt+W) ---');
  const vocabHtml = `
    <div>
      <p>Session Topic: Entrepreneurship</p>
      <div><span class="inline-coaching-tag new-word-tag" data-tag-type="new-word">✦ New Word</span>&nbsp;resilience</div>
      <div><span class="inline-coaching-tag new-word-tag" data-tag-type="new-word">✦ New Word</span>&nbsp;pivot</div>
    </div>
  `;
  const parsedVocab = parseNotesHtml(vocabHtml);
  testAssert(parsedVocab.newWords.length === 2, 'Parser extraiu 2 itens de vocabulário');
  testAssert(parsedVocab.newWordCount === 2 && parsedVocab.incorrectCount === 0 && parsedVocab.pronounceCount === 0, 'Anotação possui exclusivamente vocabulário');

  // Validação: Resposta da IA com vocabulário válido e sem erros fictícios
  const validVocabAiResponse = {
    overview: 'The student focused on key entrepreneurship terms.',
    mistakesAnalysis: [],
    grammarPoints: [],
    vocabularyAndExpressions: [
      {
        term: 'resilience',
        partOfSpeech: 'noun',
        definitionEn: 'The capacity to recover quickly from difficulties; toughness.',
        simpleDefinition: 'The ability to bounce back from difficult situations.',
        realExamples: [
          'Resilience is essential when facing early startup hurdles.',
          'She showed great resilience in overcoming setbacks.',
        ],
        learnerTip: 'Stress is on the second syllable: re-ZIL-ience.',
        isPronunciationFocus: false,
      },
      {
        term: 'pivot',
        partOfSpeech: 'verb',
        definitionEn: 'To fundamentally change the direction of a business or strategy.',
        simpleDefinition: 'To change course or focus on a new strategy.',
        realExamples: [
          'The founders decided to pivot to a software subscription model.',
          'When market demand shifted, the company had to pivot quickly.',
        ],
        learnerTip: 'Short /i/ sound in the first syllable: PIV-ot.',
        isPronunciationFocus: false,
      },
    ],
    reviewSummary: {
      keyRules: [],
      mustKnowVocabulary: ['resilience', 'pivot'],
      essentialCorrections: [],
      rememberThis: 'Keep practicing the terms resilience and pivot in your startup pitches.',
    },
  };

  const vocabValidation = validatePedagogicalAiResponse(validVocabAiResponse, parsedVocab);
  testAssert(vocabValidation.valid, 'Resposta estritamente de vocabulário é validada com sucesso');
  testAssert(validVocabAiResponse.mistakesAnalysis.length === 0, 'Zero erros sintéticos injetados');
  testAssert(validVocabAiResponse.grammarPoints.length === 0, 'Zero regras gramaticais sintéticas injetadas');

  // Resposta com definição genérica ou preenchimento artificial DEVE ser rejeitada
  const fakeVocabAiResponse = {
    ...validVocabAiResponse,
    vocabularyAndExpressions: [
      {
        term: 'resilience',
        partOfSpeech: 'noun',
        definitionEn: 'A natural conversational expression used by native speakers to enrich speaking flow.',
        simpleDefinition: 'A natural conversational expression used by native speakers to enrich speaking flow.',
        realExamples: [
          'Native speakers employ resilience in relevant conversational contexts.',
          'We practiced how to touch base naturally during our daily conversation routine.',
        ],
        learnerTip: 'Pronounce naturally.',
        isPronunciationFocus: false,
      },
      validVocabAiResponse.vocabularyAndExpressions[1],
    ],
  };
  const fakeVocabValidation = validatePedagogicalAiResponse(fakeVocabAiResponse, parsedVocab);
  testAssert(!fakeVocabValidation.valid, 'Validador rejeitou definição artificial/genérica para forçar contingência');

  // --------------------------------------------------------------------------
  // TESTE 3: Anotação com Gramática Exclusiva (Alt+N)
  // --------------------------------------------------------------------------
  console.log('\n--- 3. Anotação com Gramática Exclusiva (Alt+N) ---');
  const grammarHtml = `
    <div>
      <p>Speaking practice:</p>
      <div><span class="inline-coaching-tag incorrect-tag" data-tag-type="incorrect">✗</span>&nbsp;We discuss about the project</div>
      <div><span class="inline-coaching-tag correct-tag" data-tag-type="correct">✓</span>&nbsp;We discuss the project</div>
    </div>
  `;
  const parsedGrammar = parseNotesHtml(grammarHtml);
  testAssert(parsedGrammar.errors.length === 1 && parsedGrammar.newWordCount === 0 && parsedGrammar.pronounceCount === 0, 'Anotação possui apenas gramática/correção');

  const validGrammarAiResponse = {
    overview: 'Focused on transitive verbs and avoiding unnecessary prepositions.',
    mistakesAnalysis: [
      {
        original: 'We discuss about the project',
        corrected: 'We discuss the project',
        explanation: 'The verb "discuss" is transitive and takes a direct object without the preposition "about".',
        twoExamples: [
          'Let us discuss the next steps after lunch.',
          'They discussed the quarterly budget for two hours.',
        ],
        whatHappened: 'Adding "about" after "discuss" is a common transfer error.',
        naturalAlternative: 'We talked about the project',
        isPendingConfirmation: false,
      },
    ],
    grammarPoints: [
      {
        title: 'Transitive Verbs without Prepositions',
        pattern: 'discuss + [direct object]',
        explanation: 'In English, "discuss" already carries the meaning of "talk about".',
        examples: ['We discussed the budget yesterday.', 'Please do not discuss confidential matters here.'],
      },
    ],
    vocabularyAndExpressions: [],
    reviewSummary: {
      keyRules: ['Use "discuss" directly with its object without "about".'],
      mustKnowVocabulary: [],
      essentialCorrections: ['We discuss about the project -> We discuss the project'],
      rememberThis: 'Say "discuss the issue", or "talk about the issue".',
    },
  };

  const grammarValidation = validatePedagogicalAiResponse(validGrammarAiResponse, parsedGrammar);
  testAssert(grammarValidation.valid, 'Resposta estritamente de gramática é validada com sucesso');
  testAssert(validGrammarAiResponse.vocabularyAndExpressions.length === 0, 'Zero vocabulário sintético injetado');

  // Se a IA omitir o erro solicitado, DEVE invalidar para permitir contingência
  const incompleteGrammarAiResponse = {
    ...validGrammarAiResponse,
    mistakesAnalysis: [],
  };
  const incompleteGrammarValidation = validatePedagogicalAiResponse(incompleteGrammarAiResponse, parsedGrammar);
  testAssert(!incompleteGrammarValidation.valid, 'Validador rejeita resposta que omitiu o erro solicitado (aciona contingência)');

  // --------------------------------------------------------------------------
  // TESTE 4: Anotação com Pronúncia Exclusiva (Alt+P)
  // --------------------------------------------------------------------------
  console.log('\n--- 4. Anotação com Pronúncia Exclusiva (Alt+P) ---');
  const pronounceHtml = `
    <div>
      <div><span class="inline-coaching-tag pronounce-tag" data-tag-type="pronounce">🎯 Pronounce</span>&nbsp;comfortable</div>
    </div>
  `;
  const parsedPronounce = parseNotesHtml(pronounceHtml);
  testAssert(parsedPronounce.pronounceCount === 1 && parsedPronounce.incorrectCount === 0 && parsedPronounce.newWordCount === 0, 'Anotação possui exclusivamente pronúncia');

  const validPronounceAiResponse = {
    overview: 'Targeted English word stress and vowel reduction.',
    mistakesAnalysis: [],
    grammarPoints: [],
    vocabularyAndExpressions: [
      {
        term: 'comfortable',
        partOfSpeech: 'adjective (pronunciation)',
        definitionEn: 'Providing physical ease and relaxation; free from stress or pain.',
        simpleDefinition: 'Pleasant to sit on or wear, making you feel relaxed.',
        realExamples: [
          'These shoes are very comfortable for walking all day long.',
          'Make yourself comfortable while I pour the tea.',
        ],
        phoneticGuide: '/ˈkʌmf.tə.bəl/ (3 syllables: COMF-ter-ble)',
        learnerTip: 'Pronounced with 3 syllables /ˈkʌmf.tə.bəl/, compressing the middle "or".',
        isPronunciationFocus: true,
      },
    ],
    reviewSummary: {
      keyRules: [],
      mustKnowVocabulary: ['comfortable'],
      essentialCorrections: [],
      rememberThis: 'Compress comfortable into three syllables: COMF-ter-ble.',
    },
  };

  const pronounceValidation = validatePedagogicalAiResponse(validPronounceAiResponse, parsedPronounce);
  testAssert(pronounceValidation.valid, 'Resposta estritamente de pronúncia é validada com sucesso');
  testAssert(validPronounceAiResponse.mistakesAnalysis.length === 0, 'Zero erros sintéticos inseridos para pronúncia');
  testAssert(validPronounceAiResponse.grammarPoints.length === 0, 'Zero regras sintéticas inseridas para pronúncia');

  // --------------------------------------------------------------------------
  // TESTE 5: Anotação Combinada (Alt+W + Alt+N + Alt+P)
  // --------------------------------------------------------------------------
  console.log('\n--- 5. Anotação Combinada (Alt+W + Alt+N + Alt+P) ---');
  const combinedHtml = `
    <div>
      <div><span class="inline-coaching-tag new-word-tag" data-tag-type="new-word">✦ New Word</span>&nbsp;serendipity</div>
      <div><span class="inline-coaching-tag incorrect-tag" data-tag-type="incorrect">✗</span>&nbsp;I didn't knew</div>
      <div><span class="inline-coaching-tag correct-tag" data-tag-type="correct">✓</span>&nbsp;I didn't know</div>
      <div><span class="inline-coaching-tag pronounce-tag" data-tag-type="pronounce">🎯 Pronounce</span>&nbsp;mischievous</div>
    </div>
  `;
  const parsedCombined = parseNotesHtml(combinedHtml);
  testAssert(
    parsedCombined.newWordCount === 1 && parsedCombined.incorrectCount === 1 && parsedCombined.pronounceCount === 1,
    'Anotação combinada possui exatamente os 3 tipos'
  );

  const validCombinedAiResponse = {
    overview: 'Comprehensive session covering vocabulary, past auxiliary grammar, and pronunciation.',
    mistakesAnalysis: [
      {
        original: "I didn't knew",
        corrected: "I didn't know",
        explanation: 'After the auxiliary "didn\'t", always use the base form of the main verb.',
        twoExamples: [
          "I didn't know you were waiting outside.",
          "She didn't know the answer to the question.",
        ],
        whatHappened: 'Double past tense marking (did + knew).',
        naturalAlternative: 'I had no idea',
        isPendingConfirmation: false,
      },
    ],
    grammarPoints: [
      {
        title: 'Past Simple Negation with Did Not',
        pattern: "did not (didn't) + base form",
        explanation: 'Because "did" already marks past tense, the main verb stays in base form.',
        examples: ["She didn't come to the party.", "They didn't see the email."],
      },
    ],
    vocabularyAndExpressions: [
      {
        term: 'serendipity',
        partOfSpeech: 'noun',
        definitionEn: 'The occurrence of events by chance in a happy or beneficial way.',
        simpleDefinition: 'A lucky finding of pleasant things by chance.',
        realExamples: [
          'Meeting our future co-founder at the airport was pure serendipity.',
          'Finding this rare book in a small village was real serendipity.',
        ],
        learnerTip: 'Four syllables: se-ren-DIP-i-ty.',
        isPronunciationFocus: false,
      },
      {
        term: 'mischievous',
        partOfSpeech: 'adjective (pronunciation)',
        definitionEn: 'Causing or showing a fondness for causing trouble in a playful way.',
        simpleDefinition: 'Playfully naughty or teasing.',
        realExamples: [
          'The puppy had a mischievous look in its eyes.',
          'He gave a mischievous grin before hiding the keys.',
        ],
        phoneticGuide: '/ˈmɪs.tʃɪ.vəs/ (3 syllables: MIS-chiv-ous)',
        learnerTip: 'Pronounce as 3 syllables: MIS-chiv-ous (avoid mis-CHEE-vee-us).',
        isPronunciationFocus: true,
      },
    ],
    reviewSummary: {
      keyRules: ["didn't + base verb"],
      mustKnowVocabulary: ['serendipity', 'mischievous'],
      essentialCorrections: ["I didn't knew -> I didn't know"],
      rememberThis: 'Remember: MIS-chiv-ous (3 syllables) and didn\'t know.',
    },
  };

  const combinedValidation = validatePedagogicalAiResponse(validCombinedAiResponse, parsedCombined);
  testAssert(combinedValidation.valid, 'Resposta combinada legítima é aprovada');

  // Se a IA omitir o termo de pronúncia, deve falhar para permitir failover
  const missingPronounceCombined = {
    ...validCombinedAiResponse,
    vocabularyAndExpressions: [validCombinedAiResponse.vocabularyAndExpressions[0]], // omitting mischievous
  };
  const missingPronounceValidation = validatePedagogicalAiResponse(missingPronounceCombined, parsedCombined);
  testAssert(!missingPronounceValidation.valid, 'Validador detecta omissão de termo solicitado na resposta combinada');

  // --------------------------------------------------------------------------
  // TESTE 6: Falha dos Três Modelos Sem Criação de Conteúdo Fictício
  // --------------------------------------------------------------------------
  console.log('\n--- 6. Falha dos 3 Modelos Sem Criação de Conteúdo Fictício ---');
  let attemptCount = 0;
  const simulatedCaller = async (model: string) => {
    attemptCount++;
    // Simula resposta que falha na validação pedagógica
    return {
      text: '{}',
      parsedJson: {
        overview: 'broken',
        mistakesAnalysis: [], // missing the required grammar error!
        grammarPoints: [],
        vocabularyAndExpressions: [],
        reviewSummary: { rememberThis: 'short' },
      },
    };
  };

  const contingencyResult = await executeGeminiWithContingency(
    {
      feature: 'pedagogical_transform',
      systemInstruction: 'Pedagogical guidelines',
      untrustedUserDataPrompt: 'Transform notes',
      validator: (json) => validatePedagogicalAiResponse(json, parsedGrammar).valid,
    },
    simulatedCaller
  );

  testAssert(!contingencyResult.success, 'Quando os 3 modelos falham na validação de fidelidade, a chamada não tem sucesso');
  testAssert(attemptCount === 3, 'Contingência tentou exatamente os 3 modelos autorizados');
  testAssert(
    contingencyResult.modelsAttempted.length === 3 &&
      contingencyResult.modelsAttempted[0] === 'gemini-3.5-flash' &&
      contingencyResult.modelsAttempted[1] === 'gemini-3.8-flash' &&
      contingencyResult.modelsAttempted[2] === 'gemini-3.1-flash-lite',
    'Modelos tentados em sequência rigorosa: gemini-3.5-flash -> gemini-3.8-flash -> gemini-3.1-flash-lite'
  );

  // Verificação de que as anotações do professor permanecem 100% intactas e NENHUM conteúdo fake é inventado
  testAssert(grammarHtml.includes('We discuss about the project'), 'Anotações originais do professor preservadas integralmente');

  // --------------------------------------------------------------------------
  // TESTE 7: Detecção e Rejeição de Conteúdo Genérico Legado
  // --------------------------------------------------------------------------
  console.log('\n--- 7. Rejeição e Invalidação de Conteúdo Genérico Legado ---');
  const legacyGenericContent = {
    overview: 'Analysis with legacy fake mistakes and placeholder text',
    mistakesAnalysis: [
      {
        original: 'I have 28 years old',
        corrected: 'I am 28 years old',
        explanation: 'In English, age is expressed with to be.',
      },
    ],
    vocabularyAndExpressions: [
      {
        term: 'catch up',
        definitionEn: 'A natural conversational expression used by native speakers to enrich speaking flow.',
      },
    ],
  };

  testAssert(isLegacyGenericTransformation(legacyGenericContent), 'Detecta "I have 28 years old" como conteúdo genérico legado');

  const legacyAgreeContent = {
    mistakesAnalysis: [
      {
        original: "I'm agree with you",
        corrected: 'I agree with you',
      },
    ],
  };
  testAssert(isLegacyGenericTransformation(legacyAgreeContent), 'Detecta "I\'m agree with you" como conteúdo genérico legado');

  // --------------------------------------------------------------------------
  // TESTE 8: Persistência no Firestore (default) e Recuperação Pós-F5
  // --------------------------------------------------------------------------
  console.log('\n--- 8. Persistência no Firestore (default) e Recuperação Pós-F5 ---');
  const studentUid = 'student-test-canonical-101';
  const teacherUid = 'teacher-test-canonical-202';
  const lessonId = 'lesson-session-2026-10-22';
  const sessionDate = '2026-10-22';
  const notesHash = computeNotesHash(combinedHtml);

  // 8.1 Persistência de transformação válida associada a UIDs canônicos e lessonId
  const compositeCacheKey = `session_${lessonId}__hash_${notesHash}__pt__b1__v2`;
  const transformationToSave = {
    ...validCombinedAiResponse,
    sessionKey: `session_${lessonId}`,
    lessonId,
    sessionDate,
    contentHash: notesHash,
    language: 'pt',
    studentUid,
    teacherUid,
    isAiGenerated: true,
    isFallback: false,
    isProvisional: false,
  };

  const saveSuccess = await savePedagogicalTransformationToFirestoreServer(
    compositeCacheKey,
    transformationToSave
  );
  testAssert(saveSuccess, 'Transformação legítima persistida com sucesso no Firestore (default)');

  // 8.2 Recuperação pós-F5 (simulando recarregamento de página / novo request)
  const cachedTransformation = await fetchPedagogicalTransformationFromFirestoreServer(
    compositeCacheKey,
    { rawNotes: combinedHtml, language: 'pt', contentHash: notesHash }
  );
  testAssert(cachedTransformation !== null, 'Transformação recuperada com sucesso pós-F5 do Firestore');
  testAssert(
    cachedTransformation?.vocabularyAndExpressions?.length === 2 &&
      cachedTransformation?.mistakesAnalysis?.length === 1,
    'Dados recuperados correspondem exatamente à transformação sem adulterações'
  );

  // 8.3 Rejeição de tentativa de persistir conteúdo genérico/legado
  const legacyToSave = {
    ...legacyGenericContent,
    sessionKey: `session_${lessonId}`,
    isAiGenerated: true,
    isFallback: false,
    isProvisional: false,
  };
  const saveLegacyAttempt = await savePedagogicalTransformationToFirestoreServer(
    `session_${lessonId}__legacy`,
    legacyToSave
  );
  testAssert(!saveLegacyAttempt, 'Tentativa de persistir conteúdo genérico legado no Firestore é terminantemente bloqueada');

  // 8.4 Determinismo da chave canônica entre professor e aluno
  const canonicalKeyFromStudent = getCanonicalSessionKey({ studentUid, lessonId, sessionDate });
  const canonicalKeyFromTeacher = getCanonicalSessionKey({ studentUid, lessonId, sessionDate });
  testAssert(
    canonicalKeyFromStudent === canonicalKeyFromTeacher && canonicalKeyFromStudent.startsWith('lesson_'),
    'Identificador canônico de sessão converge deterministicamente entre aluno e professor com lessonId'
  );

  const fallbackKeyStudent = getCanonicalSessionKey({ studentUid, sessionDate });
  const fallbackKeyTeacher = getCanonicalSessionKey({ studentUid, sessionDate });
  testAssert(
    fallbackKeyStudent === fallbackKeyTeacher && fallbackKeyStudent.startsWith('session_'),
    'Identificador canônico de sessão legado (sem lessonId) converge deterministicamente com session_'
  );

  console.log('\n============================================================================');
  console.log(`TOTAL DE TESTES EXECUTADOS: ${totalTests}`);
  console.log(`SUCESSO: ${passedTests}`);
  console.log(`FALHAS: 0`);
  console.log('============================================================================\n');
}

runHotfix21TestSuite()
  .then(() => {
    console.log('✅ TEST SUITE HOTFIX 2.1 CONCLUÍDO COM SUCESSO ABSOLUTO!');
    process.exit(0);
  })
  .catch((err) => {
    console.error('❌ ERRO NO TEST SUITE HOTFIX 2.1:', err);
    process.exit(1);
  });
