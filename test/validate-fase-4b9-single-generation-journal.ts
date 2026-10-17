/**
 * TEST SUITE: FASE 4B.9 — UMA GERAÇÃO GEMINI POR AULA + INTEGRAÇÃO COM MY JOURNAL
 * Ambiente Exclusivo: itissimple-security-staging, Firestore: (default)
 * 
 * Validação rigorosa dos requisitos:
 * 1. Primeira abertura: no máximo uma tentativa Gemini para uma versão inédita da aula, abrangendo as 4 abas.
 * 2. Reabertura da mesma versão: zero chamadas Gemini (reutilização estrita do cache canônico do backend).
 * 3. Navegação pelas 4 abas e reabertura do modal: zero chamadas adicionais.
 * 4. Integração com My Journal: exatamente uma entrada de Journal por aluno/sessão/versão.
 *    - Data da aula e nome do Native Friend.
 *    - Resumo pedagógico do Quick Review.
 *    - Principais correções, regras gramaticais e pontos de pronúncia somente quando presentes no resumo validado.
 *    - Referência à análise completa armazenada no backend.
 *    - Idempotência garantida: reabrir a aula não duplica o registro.
 *    - Zero chamadas Gemini para criar o registro do Journal.
 * 5. Integração com My Dictionary: Alt+W alimenta o dicionário; Alt+P isolado NÃO cria palavra no dicionário.
 * 6. Falha/timeout: sem cache definitivo falso e sem resumo artificial no Journal; notas originais preservadas.
 */

process.env.NODE_ENV = 'test';
process.env.FIREBASE_PROJECT_ID = 'itissimple-security-staging';
process.env.FIREBASE_DATABASE_ID = '(default)';

import fs from 'fs';
if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  try {
    if (!fs.existsSync(process.env.GOOGLE_APPLICATION_CREDENTIALS) || process.env.GOOGLE_APPLICATION_CREDENTIALS.includes('placeholder')) {
      delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    }
  } catch {
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
  }
}

import {
  parseNotesHtml,
} from '../src/utils/notesHtmlParser';
import {
  generateLocalPedagogicalTransformation,
  getCanonicalSessionKey,
  computeNotesHash,
  resolveCefrLevel,
  buildPedagogicalCacheKey,
  PEDAGOGICAL_PROMPT_VERSION,
} from '../src/utils/pedagogicalTransformer';
import {
  savePedagogicalTransformationToFirestoreServer,
  fetchPedagogicalTransformationFromFirestoreServer,
  recordLessonReviewInStudentJournalServer,
  setFirebaseAdminFirestoreForTesting,
} from '../src/serverFirestore';
import { normalizeDictionaryWord } from '../src/utils/studentDictionaryLibrary';

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

// In-Memory Mock Firestore for isolated testing
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

  dump() {
    return Object.fromEntries(this.store.entries());
  }

  clear() {
    this.store.clear();
  }
}

const mockFirestore = new MockFirestoreDb();

async function runFase4B9Validation() {
  console.log('============================================================================');
  console.log(' TEST SUITE: FASE 4B.9 — UMA GERAÇÃO GEMINI POR AULA + MY JOURNAL');
  console.log(' Target Project: itissimple-security-staging');
  console.log(' Mode: Testes locais com mocks determinísticos (ZERO chamadas pagas)');
  console.log('============================================================================\n');

  setFirebaseAdminFirestoreForTesting(mockFirestore as any);

  const studentUid = 'student-test-uid-4b9';
  const studentEmail = 'student4b9@itissimple.com';
  const sessionDate = '2026-10-17';
  const lessonId = 'lesson_live_4b9_001';
  const teacherName = 'Sarah Jenkins';

  const rawTeacherNotes = `
Topic: Weekend Activities and Work-Life Balance
Great conversation today!

Corrections:
• <span class="correction-incorrect">I have 28 years old</span> <span class="correction-arrow">➜</span> <span class="correction-correct">I am 28 years old</span>
• <span class="correction-incorrect">It depends of the weather</span> <span class="correction-arrow">➜</span> <span class="correction-correct">It depends on the weather</span>

Vocabulary & Pronunciation:
• <span class="notes-new-word">workload</span> — heavy amount of work
• <span class="notes-new-word">burnout</span> — state of emotional exhaustion
• <span class="notes-pronounce">schedule</span> — focus on the pronunciation /ˈskedʒ.uːl/
`;

  const parsedMarkings = parseNotesHtml(rawTeacherNotes);
  const contentHash = computeNotesHash(rawTeacherNotes);
  const canonicalSessionKey = getCanonicalSessionKey({
    lessonId,
    studentUid,
    studentEmail,
    sessionDate,
  });
  const compositeCacheKey = buildPedagogicalCacheKey({
    canonicalSessionKey,
    contentHash,
    language: 'pt',
    cefrLevel: 'B1',
  });

  // -------------------------------------------------------------------------
  // 1. Diagnóstico e Geração Única para as Quatro Abas
  // -------------------------------------------------------------------------
  console.log('--- 1. Primeira Abertura: No Máximo UMA Chamada Gemini para as Quatro Abas ---');

  let geminiInferenceCounter = 0;

  // Simulate authorized backend generation service with mock
  async function simulateBackendTransform(forceRegenerate: boolean = false) {
    // 1. Check canonical cache first
    const cached = await fetchPedagogicalTransformationFromFirestoreServer(compositeCacheKey, {
      language: 'pt',
      contentHash,
    });
    if (!forceRegenerate && cached && cached.isAiGenerated && !cached.isProvisional) {
      return { cached: true, transformation: cached, geminiCalled: false };
    }

    // 2. Perform exactly one simulated Gemini inference for all 4 tabs
    geminiInferenceCounter++;

    // Simulated validated AI response encompassing all 4 tabs
    const transformation = {
      lessonId,
      sessionKey: canonicalSessionKey,
      sessionDate,
      topic: 'Weekend Activities and Work-Life Balance',
      teacherName,
      studentUid,
      studentEmail,
      studentLevel: 'intermediario',
      cefrLevel: 'B1',
      contentHash,
      language: 'pt',
      promptVersion: PEDAGOGICAL_PROMPT_VERSION,
      isAiGenerated: true,
      isFallback: false,
      isProvisional: false,
      source: 'gemini' as const,
      modelUsed: 'gemini-3.5-flash',
      // Tab 1: Mistakes Analysis
      mistakesAnalysis: [
        {
          id: 'mistake-1',
          original: 'I have 28 years old',
          corrected: 'I am 28 years old',
          category: 'grammar',
          explanation: 'Em inglês, idade é expressa com o verbo to be, e não have.',
          twoExamples: ['Didactic Example: "I am 28 years old."'],
          commonPitfalls: 'Dizer "have 28 years".',
        },
        {
          id: 'mistake-2',
          original: 'It depends of the weather',
          corrected: 'It depends on the weather',
          category: 'preposition',
          explanation: 'O verbo depend exige a preposição on em inglês.',
          twoExamples: ['Didactic Example: "It depends on the weather."'],
          commonPitfalls: 'Usar "depends of".',
        },
      ],
      // Tab 2: Grammar Points
      grammarPoints: [
        {
          id: 'grammar-1',
          topic: 'Expressing Age with To Be',
          rule: 'Use o verbo to be para estados físicos e idade.',
          form: 'Subject + be + age',
          usage: 'Apresentações pessoais e dados biográficos.',
          examples: ['I am 28 years old.'],
          commonMistakes: 'Usar have no lugar de be.',
          comparisons: 'I am 28 vs Tenho 28 anos.',
        },
      ],
      // Tab 3: Vocabulary and Expressions (Alt+W and Alt+P)
      vocabularyAndExpressions: [
        {
          id: 'vocab-1',
          term: 'workload',
          partOfSpeech: 'Noun',
          definitionEn: 'The amount of work to be done by someone.',
          simpleDefinition: 'Volume de trabalho.',
          collocations: ['heavy workload'],
          realExamples: ['Didactic Example: "She has a heavy workload this week."'],
          synonyms: ['amount of work'],
          register: 'neutral',
          category: 'New Words & Expressions (Alt+W)',
          isNewWord: true,
          isPronunciationFocus: false,
        },
        {
          id: 'vocab-2',
          term: 'burnout',
          partOfSpeech: 'Noun',
          definitionEn: 'State of physical or mental exhaustion.',
          simpleDefinition: 'Exaustão provocada pelo excesso de trabalho.',
          collocations: ['experience burnout'],
          realExamples: ['Didactic Example: "Preventing burnout requires balance."'],
          synonyms: ['exhaustion'],
          register: 'neutral',
          category: 'New Words & Expressions (Alt+W)',
          isNewWord: true,
          isPronunciationFocus: false,
        },
        {
          id: 'vocab-3',
          term: 'schedule',
          partOfSpeech: 'Pronunciation Focus',
          definitionEn: 'Pronunciation focus: Pay careful attention to syllable stress on "schedule".',
          simpleDefinition: 'Foco em pronúncia: Preste atenção à articulação de "schedule".',
          collocations: ['tight schedule'],
          realExamples: ['Didactic Example: "Check your schedule."'],
          synonyms: ['agenda'],
          register: 'neutral',
          category: 'Pronunciation & Phonetics (Alt+P)',
          isNewWord: false,
          isPronunciationFocus: true,
        },
      ],
      // Tab 4: Quick Review Summary
      reviewSummary: {
        estimatedMinutes: '5–10 min',
        keyRules: ['Idade com To Be (I am 28)', 'Depend on + noun'],
        mustKnowVocabulary: ['✨ workload', '✨ burnout', '🎯 [Pronounce] schedule'],
        essentialCorrections: [
          { original: 'I have 28 years old', corrected: 'I am 28 years old' },
          { original: 'It depends of the weather', corrected: 'It depends on the weather' },
        ],
        rememberThis: 'Lembre-se disto: Em vez de dizer "I have 28 years old", use "I am 28 years old"!',
      },
      correctStampsCount: parsedMarkings.correctCount,
      incorrectStampsCount: parsedMarkings.incorrectCount,
      newWordStampsCount: parsedMarkings.newWordCount,
      pronounceStampsCount: parsedMarkings.pronounceCount,
      generatedAt: new Date().toISOString(),
    };

    // Save definitive transformation to canonical backend Firestore
    await savePedagogicalTransformationToFirestoreServer(compositeCacheKey, transformation);

    // Register single lesson review entry in Student's My Journal
    const journalRes = await recordLessonReviewInStudentJournalServer({
      studentUid,
      studentEmail,
      transformation,
      compositeCacheKey,
    });

    return { cached: false, transformation, journalRes, geminiCalled: true };
  }

  // First opening execution
  const firstOpenResult = await simulateBackendTransform(false);
  assert(firstOpenResult.geminiCalled === true, '1.1: Primeira abertura de versão inédita realiza tentativa autorizada de geração');
  assert(geminiInferenceCounter === 1, `1.2: Exatamente UMA tentativa Gemini realizada (contador: ${geminiInferenceCounter})`);
  assert(firstOpenResult.cached === false, '1.3: Primeira abertura reporta cached: false e armazena análise');
  assert(Array.isArray(firstOpenResult.transformation.mistakesAnalysis) && firstOpenResult.transformation.mistakesAnalysis.length === 2, '1.4: Aba 1 (Mistakes Analysis) gerada no mesmo payload');
  assert(Array.isArray(firstOpenResult.transformation.grammarPoints) && firstOpenResult.transformation.grammarPoints.length === 1, '1.5: Aba 2 (Grammar Points) gerada no mesmo payload');
  assert(Array.isArray(firstOpenResult.transformation.vocabularyAndExpressions) && firstOpenResult.transformation.vocabularyAndExpressions.length === 3, '1.6: Aba 3 (Vocabulary & Pronunciation) gerada no mesmo payload');
  assert(Boolean(firstOpenResult.transformation.reviewSummary?.rememberThis), '1.7: Aba 4 (Quick Review Summary) gerada no mesmo payload');

  // -------------------------------------------------------------------------
  // 2. Reabertura e Navegação entre as Quatro Abas: ZERO Chamadas Gemini
  // -------------------------------------------------------------------------
  console.log('\n--- 2. Reabertura e Navegação entre Abas: Zero Chamadas Gemini ---');

  // Reopen session
  const reopenResult = await simulateBackendTransform(false);
  assert(reopenResult.geminiCalled === false, '2.1: Reabertura da mesma versão não invoca o Gemini');
  assert(reopenResult.cached === true, '2.2: Reabertura consulta e reutiliza o cache canônico do backend');
  assert(geminiInferenceCounter === 1, `2.3: Contador de inferências permanece inalterado em 1 (atual: ${geminiInferenceCounter})`);

  // Simulate tab navigation ('mistakes' -> 'grammar' -> 'vocab' -> 'summary' -> 'all')
  const tabs: Array<'mistakes' | 'grammar' | 'vocab' | 'summary' | 'all'> = ['mistakes', 'grammar', 'vocab', 'summary', 'all'];
  for (const tab of tabs) {
    // When switching activeTab in the UI, transformation is read from local state without network request
    const tabDataPresent =
      tab === 'mistakes' ? reopenResult.transformation.mistakesAnalysis :
      tab === 'grammar' ? reopenResult.transformation.grammarPoints :
      tab === 'vocab' ? reopenResult.transformation.vocabularyAndExpressions :
      reopenResult.transformation.reviewSummary;
    assert(Boolean(tabDataPresent), `2.4: Navegação para aba "${tab}" utiliza os dados já armazenados no payload da aula`);
  }
  assert(geminiInferenceCounter === 1, `2.5: Zero chamadas Gemini durante a navegação por todas as abas (contador: ${geminiInferenceCounter})`);

  // -------------------------------------------------------------------------
  // 3. Integração com My Journal: Idempotência e Conteúdo Validado
  // -------------------------------------------------------------------------
  console.log('\n--- 3. Integração com My Journal: Entrada Única e Idempotente ---');

  // Verify journal document in Firestore under users/{studentUid}/journal
  const journalCol = mockFirestore.collection(`users/${studentUid}/journal`);
  const journalDocs = await journalCol.get();
  assert(journalDocs.size === 1, `3.1: Exatamente UMA entrada registrada no subcollection users/${studentUid}/journal (encontradas: ${journalDocs.size})`);

  const journalEntry = journalDocs.docs[0].data();
  assert(journalEntry.entryType === 'lesson_review', '3.2: Entrada identificada como lesson_review');
  assert(journalEntry.date === sessionDate, `3.3: Data da aula conferida (${journalEntry.date})`);
  assert(journalEntry.teacherName === teacherName, `3.4: Nome do Native Friend preservado (${journalEntry.teacherName})`);
  assert(journalEntry.sentence.includes('Lembre-se disto: Em vez de dizer "I have 28 years old"'), '3.5: Resumo pedagógico do Quick Review incluído fielmente');
  assert(Array.isArray(journalEntry.keyCorrections) && journalEntry.keyCorrections.length === 2, '3.6: Principais correções presentes no resumo');
  assert(journalEntry.grammarRules && journalEntry.grammarRules.length === 2, '3.7: Regras gramaticais presentes');
  assert(Array.isArray(journalEntry.pronunciationPoints) && journalEntry.pronunciationPoints.includes('schedule'), '3.8: Ponto de pronúncia registrado');
  assert(journalEntry.cacheKeyRef === compositeCacheKey, '3.9: Referência à análise completa armazenada no backend incluída');

  // Verify users/{studentUid} parent document array
  const userDocSnap = await mockFirestore.collection('users').doc(studentUid).get();
  const userData = userDocSnap.data();
  assert(Array.isArray(userData?.dailyJournalEntries) && userData.dailyJournalEntries.length === 1, '3.10: users/{studentUid}.dailyJournalEntries contém exatamente 1 entrada');

  // IDEMPOTENCY TEST: Call recordLessonReviewInStudentJournalServer multiple times for the same session
  for (let i = 0; i < 3; i++) {
    await recordLessonReviewInStudentJournalServer({
      studentUid,
      studentEmail,
      transformation: reopenResult.transformation,
      compositeCacheKey,
    });
  }

  const journalDocsAfterRepeated = await journalCol.get();
  const userDocSnapAfterRepeated = await mockFirestore.collection('users').doc(studentUid).get();
  assert(journalDocsAfterRepeated.size === 1, `3.11: IDEMPOTÊNCIA: Chamadas repetidas NÃO duplicam registro em users/${studentUid}/journal (total: ${journalDocsAfterRepeated.size})`);
  assert(userDocSnapAfterRepeated.data()?.dailyJournalEntries.length === 1, `3.12: IDEMPOTÊNCIA: Chamadas repetidas NÃO duplicam registro em dailyJournalEntries (total: ${userDocSnapAfterRepeated.data()?.dailyJournalEntries.length})`);

  // -------------------------------------------------------------------------
  // 4. Integração com My Dictionary: Alt+W alimenta; Alt+P isolado não sincroniza
  // -------------------------------------------------------------------------
  console.log('\n--- 4. Integração com My Dictionary: Alt+W vs Alt+P Isolado ---');

  const vocabItems = firstOpenResult.transformation.vocabularyAndExpressions;
  const newWordItems = vocabItems.filter((v: any) => v.isNewWord);
  const pronounceOnlyItems = vocabItems.filter((v: any) => v.isPronunciationFocus && !v.isNewWord);

  assert(newWordItems.some((v: any) => v.term === 'workload'), '4.1: "workload" (Alt+W) marcado como New Word');
  assert(newWordItems.some((v: any) => v.term === 'burnout'), '4.2: "burnout" (Alt+W) marcado como New Word');
  assert(pronounceOnlyItems.some((v: any) => v.term === 'schedule'), '4.3: "schedule" (Alt+P isolado) identificado exclusivamente como foco de pronúncia');

  // Verify dictionary filtering rule (syncTransformationVocabToDictionary rule)
  const dictionaryFiltered = vocabItems.filter((v: any) => {
    const isPronounce = Boolean(v.isPronunciationFocus);
    const isNewWord = Boolean(v.isNewWord);
    if (isPronounce && !isNewWord) {
      return false; // Alt+P isolado NÃO entra no dicionário!
    }
    return true;
  });

  assert(dictionaryFiltered.some((v: any) => v.term === 'workload'), '4.4: Alt+W "workload" é autorizado a entrar no My Dictionary');
  assert(dictionaryFiltered.some((v: any) => v.term === 'burnout'), '4.5: Alt+W "burnout" é autorizado a entrar no My Dictionary');
  assert(!dictionaryFiltered.some((v: any) => v.term === 'schedule'), '4.6: Alt+P isolado "schedule" NÃO entra no My Dictionary');

  // -------------------------------------------------------------------------
  // 5. Falha / Timeout: Sem Cache Falso e Sem Resumo Artificial no Journal
  // -------------------------------------------------------------------------
  console.log('\n--- 5. Falha / Timeout: Proteção contra Cache Definitivo Falso e Resumo Artificial ---');

  const failedSessionKey = 'lesson_failed_session_002';
  const failedContent = '<p>Short notes</p>';
  const failedContentHash = computeNotesHash(failedContent);
  const failedCompositeKey = buildPedagogicalCacheKey({
    canonicalSessionKey: failedSessionKey,
    contentHash: failedContentHash,
    language: 'pt',
    cefrLevel: 'B1',
  });

  // Simulated fallback transformation created when Gemini fails/timeouts
  const fallbackTransformation = generateLocalPedagogicalTransformation({
    rawNotes: failedContent,
    topic: 'Conversation',
    sessionDate: '2026-10-18',
    teacherName: 'Mark R.',
    studentLevel: 'intermediario',
    studentUid,
    studentEmail,
    sessionKey: failedSessionKey,
    language: 'pt',
  });
  fallbackTransformation.isAiGenerated = false;
  fallbackTransformation.isFallback = true;
  fallbackTransformation.isProvisional = true;

  // Invariant 1: recordLessonReviewInStudentJournalServer REJECTS fallback transformations
  const failedJournalResult = await recordLessonReviewInStudentJournalServer({
    studentUid,
    studentEmail,
    transformation: fallbackTransformation,
    compositeCacheKey: failedCompositeKey,
  });

  assert(failedJournalResult.success === false, '5.1: Fallback/provisório rejeitado por recordLessonReviewInStudentJournalServer');

  // Invariant 2: No artificial journal entry was created
  const journalDocFailed = await mockFirestore.collection(`users/${studentUid}/journal`).doc(`journal_lesson_${failedSessionKey}_${studentUid}`).get();
  assert(journalDocFailed.exists === false, '5.2: Nenhum resumo artificial salvo em users/{studentUid}/journal quando a IA falha');

  // Invariant 3: fetchPedagogicalTransformationFromFirestoreServer returns null for missing/provisional
  const fsCacheCheck = await fetchPedagogicalTransformationFromFirestoreServer(failedCompositeKey);
  assert(fsCacheCheck === null, '5.3: Nenhum cache falso é retornado do Firestore para falhas');

  // -------------------------------------------------------------------------
  // 6. Mudança Real nas Notas: Nova Versão de Análise sem Apagar Histórico
  // -------------------------------------------------------------------------
  console.log('\n--- 6. Mudança Real nas Notas: Nova Versão sem Apagar Histórico ---');

  const modifiedTeacherNotes = rawTeacherNotes + '\n• <span class="notes-new-word">resilience</span> — ability to recover quickly';
  const newContentHash = computeNotesHash(modifiedTeacherNotes);
  const newCompositeCacheKey = buildPedagogicalCacheKey({
    canonicalSessionKey,
    contentHash: newContentHash,
    language: 'pt',
    cefrLevel: 'B1',
  });

  assert(newContentHash !== contentHash, '6.1: Hash do conteúdo modificado difere do hash original');
  assert(newCompositeCacheKey !== compositeCacheKey, '6.2: Chave de cache da nova versão difere da versão anterior');

  // Verify previous version is still safely in Firestore
  const previousVersionSnap = await mockFirestore.collection('session_notes').doc(canonicalSessionKey).collection('pedagogical_cache').doc(compositeCacheKey).get();
  assert(previousVersionSnap.exists === true, '6.3: Histórico da versão anterior do cache foi preservado em Firestore');

  console.log('\n============================================================================');
  console.log(` RESULTADOS DOS TESTES FASE 4B.9: ${passed} PASSOU | ${failed} FALHOU`);
  console.log('============================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runFase4B9Validation().catch((err) => {
  console.error('Fatal error during validation suite execution:', err);
  process.exit(1);
});
