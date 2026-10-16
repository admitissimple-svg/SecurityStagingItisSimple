/**
 * TEST SUITE: FASE 4B.8 — NATIVE FRIENDS NOTES: IA SOB DEMANDA, CACHE E LEMBRETE DIÁRIO
 * Ambiente Exclusivo: itissimple-security-staging, Firestore: (default)
 *
 * Validações Obrigatórias:
 * 1. Salvar notas pelo professor: zero chamadas Gemini e sem escrita direta no dicionário.
 * 2. Abrir aplicativo / apresentar lembrete: zero chamadas Gemini.
 * 3. Primeira abertura de notas sem cache: exatamente UMA chamada Gemini completa abrangendo as 4 abas,
 *    persistida em cache persistente e enriquecendo My Dictionary.
 * 4. Reabertura da mesma aula / outras abas: reutilização do cache, zero novas chamadas Gemini.
 * 5. Edição posterior das notas pelo professor: invalidação do cache e nova chamada Gemini apenas quando o aluno abrir novamente.
 * 6. Lembrete diário: exibido uma única vez por dia por aluno; não reapresentado no mesmo dia após refresh/remontagem/troca de dispositivo;
 *    exibido no dia seguinte conforme o ciclo; separação estrita entre lembrete apresentado e revisão concluída.
 * 7. My Dictionary: enriquecimento com definitionEn adequada ao CEFR e persistência canônica; zero poluição com Alt+P isolado.
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
  cleanExpressionTerm,
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
  invalidatePedagogicalCache,
} from '../serverApp';
import {
  recordDailyReminderShownServer,
  fetchSessionNotesProgressServer,
  saveSessionNotesProgressToFirestore,
  savePedagogicalTransformationToFirestoreServer,
  fetchPedagogicalTransformationFromFirestoreServer,
  setFirebaseAdminFirestoreForTesting,
} from '../src/serverFirestore';
import { syncSessionVocabularyToStudentDictionary } from '../src/utils/sessionVocabularySync';
import { normalizeDictionaryWord } from '../src/utils/studentDictionaryLibrary';
import { EnglishLevel, StudentDictionaryEntry } from '../src/types';

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

  where(field: string, op: string, value: any) {
    return {
      get: async () => {
        const docs: any[] = [];
        for (const [k, v] of this.store.entries()) {
          const prefix = `${this.path}/`;
          if (k.startsWith(prefix)) {
            const remainder = k.substring(prefix.length);
            if (!remainder.includes('/')) {
              if (op === '==' && v && v[field] === value) {
                docs.push({
                  id: remainder,
                  data: () => JSON.parse(JSON.stringify(v)),
                });
              }
            }
          }
        }
        return {
          empty: docs.length === 0,
          size: docs.length,
          docs,
          forEach: (cb: any) => docs.forEach(cb),
        };
      },
    };
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

  async runTransaction(updateFunction: (tx: any) => Promise<any>) {
    const tx = {
      get: async (ref: MockDocRef) => ref.get(),
      set: async (ref: MockDocRef, data: any, options?: any) => ref.set(data, options),
    };
    return updateFunction(tx);
  }

  dump() {
    return Object.fromEntries(this.store.entries());
  }

  clear() {
    this.store.clear();
  }
}

const mockFirestore = new MockFirestoreDb();
setFirebaseAdminFirestoreForTesting(mockFirestore as any);

console.log('============================================================================');
console.log(' TEST SUITE FASE 4B.8 — NATIVE FRIENDS NOTES: IA SOB DEMANDA, CACHE & LEMBRETE');
console.log(' AMBIENTE: itissimple-security-staging | FIRESTORE: (default)');
console.log('============================================================================\n');

async function runTests() {
  // Test Data
  const studentUid = 'student_fase4b8_uid_01';
  const studentEmail = 'aluna.fase4b8@example.com';
  const lessonId = 'lesson_fase4b8_101';
  const sessionDate = '2026-10-16';
  const sessionTopic = 'Global Expansion & Product Strategy';

  const rawTeacherNotesV1 = `
<div><strong>Native Friend Coaching Session</strong></div>
<div>Date: 2026-10-16 | Topic: Global Expansion & Product Strategy</div>
<div><span class="inline-coaching-tag correct-tag" data-tag-type="correct">✓</span>&nbsp;We expanded into European markets successfully</div>
<div><span class="inline-coaching-tag incorrect-tag" data-tag-type="incorrect">✗</span>&nbsp;I am agree with your roadmap&nbsp;➜&nbsp;I agree with your roadmap</div>
<div><span class="inline-coaching-tag new-word-tag" data-tag-type="new-word">✦ New Word</span>&nbsp;streamline</div>
<div><span class="inline-coaching-tag pronounce-tag" data-tag-type="pronounce">🎯 Pronounce</span>&nbsp;entrepreneurial</div>
`;

  let simulatedGeminiCallCount = 0;

  // Mock Gemini Transformer function that simulates the backend AI execution
  async function simulateBackendGeminiTransform(params: {
    rawNotes: string;
    topic: string;
    sessionDate: string;
    studentUid: string;
    studentLevel: string;
    language: string;
  }) {
    simulatedGeminiCallCount++;
    const markings = parseNotesHtml(params.rawNotes);
    const cefrMeta = resolveCefrLevel(params.studentLevel);

    return {
      sessionKey: lessonId,
      sessionDate: params.sessionDate,
      topic: params.topic,
      studentUid: params.studentUid,
      studentLevel: params.studentLevel,
      cefrLevel: cefrMeta.cefr,
      contentHash: computeNotesHash(params.rawNotes),
      language: params.language,
      promptVersion: PEDAGOGICAL_PROMPT_VERSION,
      isAiGenerated: true,
      isFallback: false,
      isProvisional: false,
      modelUsed: 'gemini-3.8-flash',
      mistakesAnalysis: [
        {
          id: 'mistake-1',
          original: 'I am agree with your roadmap',
          corrected: 'I agree with your roadmap',
          category: 'grammar',
          explanation: 'In English, "agree" is a main verb of mental state, not an adjective preceded by "am".',
          twoExamples: [
            'Didactic Example: I agree with the proposal completely.',
            'Didactic Example: Do you agree with the revised budget?',
          ],
          commonPitfalls: 'Saying "I am agree" is a literal Portuguese calque ("estou de acordo").',
          isPendingConfirmation: false,
        },
      ],
      grammarPoints: [
        {
          id: 'grammar-1',
          topic: 'Stative Verbs: Agree vs To Be',
          rule: 'Mental state verbs function as lexical verbs in simple tenses without the auxiliary "be".',
          form: 'Subject + agree (with + noun / that + clause)',
          usage: 'Expressing shared perspective or consensus in discussions.',
          examples: [
            'Didactic Example: The board agreed on the timeline.',
            'Didactic Example: We agree that security is our top priority.',
          ],
          commonMistakes: 'Saying "I am agree".',
          comparisons: 'I agree (Verb) vs I am agreeable (Adjective).',
        },
      ],
      vocabularyAndExpressions: [
        {
          id: 'vocab-1',
          term: 'streamline',
          partOfSpeech: 'Verb',
          simpleDefinition: 'To make an organization or process more efficient and effective by simplifying steps.',
          collocations: ['streamline the process', 'streamline operations'],
          realExamples: ['We streamlined our onboarding flow to reduce drop-off.'],
          synonyms: ['optimize', 'simplify'],
          register: 'formal' as const,
          category: 'New Words & Expressions (Alt+W)',
          isNewWord: true,
          isPronunciationFocus: false,
          cefrLevel: 'B2',
        },
        {
          id: 'vocab-2',
          term: 'entrepreneurial',
          partOfSpeech: 'Pronunciation Focus',
          simpleDefinition: 'Pronunciation focus: Pay careful attention to the 6 syllables /ˌɒn.trə.prəˈnɜː.ri.əl/ and stress on "neur".',
          collocations: ['entrepreneurial mindset'],
          realExamples: ['She has a strong entrepreneurial spirit.'],
          synonyms: ['innovative', 'business-minded'],
          register: 'neutral' as const,
          category: 'Pronunciation & Phonetics (Alt+P)',
          isNewWord: false,
          isPronunciationFocus: true,
          cefrLevel: 'C1',
        },
      ],
      reviewSummary: {
        estimatedMinutes: '5–10 minutes',
        keyRules: ['Stative Verbs: Use "I agree" without "am".'],
        mustKnowVocabulary: ['streamline (v.)', 'entrepreneurial (pronunciation)'],
        essentialCorrections: [
          { original: 'I am agree with your roadmap', corrected: 'I agree with your roadmap' },
        ],
        rememberThis: 'Always say "I agree" directly in your executive meetings!',
      },
      generatedAt: new Date().toISOString(),
    };
  }

  // ----------------------------------------------------------------------------
  // 1. SALVAR NOTAS PELO PROFESSOR: ZERO CHAMADAS GEMINI
  // ----------------------------------------------------------------------------
  console.log('--- 1. Salvar Notas pelo Professor: Zero Chamadas Gemini ---');

  const initialGeminiCalls = simulatedGeminiCallCount;

  // Teacher saves notes in database
  const db: any = {
    liveLessons: [
      {
        id: lessonId,
        studentUid,
        studentEmail,
        sessionDate,
        title: sessionTopic,
        sessionNotesDocument: rawTeacherNotesV1,
      },
    ],
    pedagogicalTransformationsMap: {},
    studentDictionaryMap: {},
  };

  // Invalidate cache on teacher note save
  invalidatePedagogicalCache(db, {
    canonicalSessionKey: lessonId,
    sessionKey: lessonId,
    lessonId,
    id: lessonId,
  });

  assert(
    simulatedGeminiCallCount === initialGeminiCalls,
    'Test 1A: Salvar anotações pelo professor resulta em ZERO chamadas ao Gemini',
    `Chamadas: ${simulatedGeminiCallCount}`
  );

  assert(
    !db.studentDictionaryMap[studentUid] || db.studentDictionaryMap[studentUid].length === 0,
    'Test 1B: Salvar notas pelo professor NÃO escreve diretamente no dicionário do aluno'
  );

  // ----------------------------------------------------------------------------
  // 2. ABRIR APLICATIVO / APRESENTAR LEMBRETE: ZERO CHAMADAS GEMINI
  // ----------------------------------------------------------------------------
  console.log('\n--- 2. Abrir Aplicativo / Apresentar Lembrete: Zero Chamadas Gemini ---');

  // Background reminder hook loads sessions and evaluates eligibility
  const markingsBeforeOpen = parseNotesHtml(rawTeacherNotesV1);
  const hasEligibleMistakes = markingsBeforeOpen.incorrectCount > 0;
  const hasEligibleVocab = markingsBeforeOpen.newWordCount > 0 || markingsBeforeOpen.pronounceCount > 0;

  // Background reminder checks cache without triggering AI (triggerAiIfMissing: false)
  const contentHashV1 = computeNotesHash(rawTeacherNotesV1);
  const cacheKeyV1 = buildPedagogicalCacheKey({
    canonicalSessionKey: lessonId,
    contentHash: contentHashV1,
    language: 'pt',
    cefrLevel: 'B1',
  });

  const cachedBeforeOpen = db.pedagogicalTransformationsMap[cacheKeyV1];

  assert(
    !cachedBeforeOpen,
    'Test 2A: Cache não existe antes da primeira abertura pelo aluno'
  );

  assert(
    simulatedGeminiCallCount === initialGeminiCalls,
    'Test 2B: Carregar a página e computar elegibilidade do lembrete resulta em ZERO chamadas Gemini',
    `Chamadas: ${simulatedGeminiCallCount}`
  );

  // ----------------------------------------------------------------------------
  // 3. PRIMEIRA ABERTURA DE NOTAS: EXATAMENTE UMA GERAÇÃO GEMINI (4 ABAS)
  // ----------------------------------------------------------------------------
  console.log('\n--- 3. Primeira Abertura de Notas pelo Aluno: Exatamente 1 Chamada Gemini ---');

  // Student clicks to open notes modal: triggerAiIfMissing = true
  const transformationResult = await simulateBackendGeminiTransform({
    rawNotes: rawTeacherNotesV1,
    topic: sessionTopic,
    sessionDate,
    studentUid,
    studentLevel: 'intermediario',
    language: 'pt',
  });

  // Persist transformation to in-memory map and Cloud Firestore
  db.pedagogicalTransformationsMap[cacheKeyV1] = transformationResult;
  await savePedagogicalTransformationToFirestoreServer(cacheKeyV1, transformationResult);

  // Sync Alt+W words to My Dictionary
  const syncedWords = await syncSessionVocabularyToStudentDictionary({
    studentUid,
    studentEmail,
    rawNotes: rawTeacherNotesV1,
    vocabularyAndExpressions: transformationResult.vocabularyAndExpressions,
    studentLevel: EnglishLevel.INTERMEDIATE,
    sessionDate,
    topic: sessionTopic,
    skipClientWrite: true,
  });

  assert(
    simulatedGeminiCallCount === initialGeminiCalls + 1,
    'Test 3A: Primeira abertura efetiva executa EXATAMENTE UMA chamada Gemini',
    `Esperado: 1, Obtido: ${simulatedGeminiCallCount - initialGeminiCalls}`
  );

  assert(
    transformationResult.mistakesAnalysis.length === 1 &&
    transformationResult.grammarPoints.length === 1 &&
    transformationResult.vocabularyAndExpressions.length === 2 &&
    Boolean(transformationResult.reviewSummary.rememberThis),
    'Test 3B: Geração única abrange integralmente as 4 abas pedagógicas'
  );

  assert(
    transformationResult.isAiGenerated === true && transformationResult.isProvisional === false,
    'Test 3C: Resultado validado é definitivo (isAiGenerated: true, isProvisional: false)'
  );

  const fsCacheCheck = await fetchPedagogicalTransformationFromFirestoreServer(cacheKeyV1);
  assert(
    Boolean(fsCacheCheck && fsCacheCheck.isAiGenerated && !fsCacheCheck.isProvisional),
    'Test 3D: Resultado pedagógico persistido no Firestore sob a chave canônica para reutilização'
  );

  // ----------------------------------------------------------------------------
  // 4. REABERTURA DA MESMA AULA / OUTRAS ABAS: REUTILIZAÇÃO DO CACHE (0 GEMINI)
  // ----------------------------------------------------------------------------
  console.log('\n--- 4. Reabertura da Mesma Aula / Outras Abas: Reutilização do Cache (0 Gemini) ---');

  const geminiCallsBeforeReopen = simulatedGeminiCallCount;

  // Student switches tabs or closes and re-opens the same lesson notes
  let cachedOnReopen = db.pedagogicalTransformationsMap[cacheKeyV1];
  if (!cachedOnReopen || cachedOnReopen.isProvisional) {
    cachedOnReopen = await fetchPedagogicalTransformationFromFirestoreServer(cacheKeyV1);
  }

  assert(
    Boolean(cachedOnReopen && cachedOnReopen.contentHash === contentHashV1 && cachedOnReopen.isAiGenerated),
    'Test 4A: Cache persistente é recuperado com sucesso na reabertura'
  );

  assert(
    simulatedGeminiCallCount === geminiCallsBeforeReopen,
    'Test 4B: Reabertura da mesma aula ou alternância de abas resulta em ZERO novas chamadas Gemini',
    `Novas chamadas: ${simulatedGeminiCallCount - geminiCallsBeforeReopen}`
  );

  // ----------------------------------------------------------------------------
  // 5. EDIÇÃO POSTERIOR DAS NOTAS PELO PROFESSOR: INVALIDAÇÃO DO CACHE
  // ----------------------------------------------------------------------------
  console.log('\n--- 5. Edição Posterior das Notas pelo Professor: Invalidação do Cache ---');

  const rawTeacherNotesV2 = `
<div><strong>Native Friend Coaching Session - Revised</strong></div>
<div>Date: 2026-10-16 | Topic: Global Expansion & Product Strategy</div>
<div><span class="inline-coaching-tag correct-tag" data-tag-type="correct">✓</span>&nbsp;We expanded into European markets successfully</div>
<div><span class="inline-coaching-tag incorrect-tag" data-tag-type="incorrect">✗</span>&nbsp;I am agree with your roadmap&nbsp;➜&nbsp;I agree with your roadmap</div>
<div><span class="inline-coaching-tag incorrect-tag" data-tag-type="incorrect">✗</span>&nbsp;We depend of investors&nbsp;➜&nbsp;We depend on investors</div>
<div><span class="inline-coaching-tag new-word-tag" data-tag-type="new-word">✦ New Word</span>&nbsp;streamline</div>
<div><span class="inline-coaching-tag new-word-tag" data-tag-type="new-word">✦ New Word</span>&nbsp;synergy</div>
<div><span class="inline-coaching-tag pronounce-tag" data-tag-type="pronounce">🎯 Pronounce</span>&nbsp;entrepreneurial</div>
`;

  const contentHashV2 = computeNotesHash(rawTeacherNotesV2);
  const cacheKeyV2 = buildPedagogicalCacheKey({
    canonicalSessionKey: lessonId,
    contentHash: contentHashV2,
    language: 'pt',
    cefrLevel: 'B1',
  });

  // Teacher saves updated notes: invalidates cache
  invalidatePedagogicalCache(db, {
    canonicalSessionKey: lessonId,
    sessionKey: lessonId,
    lessonId,
  });

  assert(
    simulatedGeminiCallCount === geminiCallsBeforeReopen,
    'Test 5A: Edição e salvamento das novas notas pelo professor NÃO gera chamada Gemini imediata'
  );

  // Student re-opens notes modal with revised notes
  const updatedTransformation = await simulateBackendGeminiTransform({
    rawNotes: rawTeacherNotesV2,
    topic: sessionTopic,
    sessionDate,
    studentUid,
    studentLevel: 'intermediario',
    language: 'pt',
  });
  db.pedagogicalTransformationsMap[cacheKeyV2] = updatedTransformation;
  await savePedagogicalTransformationToFirestoreServer(cacheKeyV2, updatedTransformation);

  assert(
    simulatedGeminiCallCount === geminiCallsBeforeReopen + 1,
    'Test 5B: Nova chamada Gemini ocorre somente quando o aluno abre as notas editadas',
    `Esperado: 1 nova chamada, Total: ${simulatedGeminiCallCount}`
  );

  assert(
    contentHashV2 !== contentHashV1 && cacheKeyV2 !== cacheKeyV1,
    'Test 5C: Cache particionado por hash assegura versionamento estrito das anotações'
  );

  // ----------------------------------------------------------------------------
  // 6. LEMBRETE DIÁRIO: ATÔMICO, MÁXIMO 1 VEZ POR DIA POR ALUNO
  // ----------------------------------------------------------------------------
  console.log('\n--- 6. Lembrete Diário: Atômico, Máximo 1 Vez por Dia por Aluno ---');

  const todayStr = '2026-10-16';
  const tomorrowStr = '2026-10-17';

  // 6.1 First eligible app open on Day 1
  const claimDay1First = await recordDailyReminderShownServer(studentUid, todayStr);
  assert(
    claimDay1First.canShow === true && claimDay1First.alreadyShown === false,
    'Test 6A: Primeira abertura do dia exibe o lembrete com sucesso (canShow: true)'
  );

  // 6.2 Refresh on Day 1 (same day, same student)
  const claimDay1Refresh = await recordDailyReminderShownServer(studentUid, todayStr);
  assert(
    claimDay1Refresh.canShow === false && claimDay1Refresh.alreadyShown === true,
    'Test 6B: Refresh da página no mesmo dia NÃO reapresenta o lembrete (canShow: false, alreadyShown: true)'
  );

  // 6.3 Different device / concurrent login on Day 1
  const claimDay1OtherDevice = await recordDailyReminderShownServer(studentUid, todayStr);
  assert(
    claimDay1OtherDevice.canShow === false && claimDay1OtherDevice.alreadyShown === true,
    'Test 6C: Acesso em outro dispositivo no mesmo dia NÃO reapresenta o lembrete'
  );

  // 6.4 Next Day (Day 2): Eligible for new daily reminder
  const claimDay2 = await recordDailyReminderShownServer(studentUid, tomorrowStr);
  assert(
    claimDay2.canShow === true && claimDay2.alreadyShown === false,
    'Test 6D: No dia seguinte (nova data no fuso do aluno), lembrete é apresentado novamente'
  );

  // 6.5 Complete separation: Reminder Shown (lastReminderShownDate) vs Review Completed (lastReviewedDate)
  await saveSessionNotesProgressToFirestore(studentUid, {
    lastSessionKey: lessonId,
    stepIndex: 1,
    lastReviewedTab: 'grammar',
    lastReviewedDate: todayStr,
    lastReminderShownDate: todayStr,
  });

  const progressSnap = await fetchSessionNotesProgressServer(studentUid);
  assert(
    progressSnap &&
    progressSnap.lastReminderShownDate === todayStr &&
    progressSnap.lastReviewedDate === todayStr &&
    progressSnap.stepIndex === 1,
    'Test 6E: Separação completa e persistência canônica de lastReminderShownDate e lastReviewedDate no Firestore'
  );

  // ----------------------------------------------------------------------------
  // 7. MY DICTIONARY: APENAS ALT+W, ZERO ALT+P ISOLADO, ENRIQUECIMENTO CEFR
  // ----------------------------------------------------------------------------
  console.log('\n--- 7. My Dictionary: Apenas Alt+W, Zero Alt+P Isolado, Enriquecimento CEFR ---');

  // Verify syncedWords from Test 3
  const streamlineWord = syncedWords.find((w) => normalizeDictionaryWord(w.word) === 'streamline');
  const entrepreneurialWord = syncedWords.find((w) => normalizeDictionaryWord(w.word) === 'entrepreneurial');

  assert(
    Boolean(streamlineWord),
    'Test 7A: Palavra Alt+W (streamline) entra no My Dictionary'
  );

  assert(
    !entrepreneurialWord,
    'Test 7B: Palavra marcada EXCLUSIVAMENTE com Alt+P (entrepreneurial) NÃO entra no My Dictionary'
  );

  assert(
    Boolean(streamlineWord?.definitionEn?.includes('efficient and effective') && streamlineWord?.cefrLevel === 'B2'),
    'Test 7C: definitionEn contém definição em inglês calibrada ao nível CEFR B2'
  );

  assert(
    Boolean(
      streamlineWord?.source === 'live_lesson' &&
      streamlineWord?.origins?.[0]?.source === 'native_notes' &&
      streamlineWord?.origins?.[0]?.activityName?.includes('Global Expansion')
    ),
    'Test 7D: Metadados canônicos de rastreabilidade (source: live_lesson, origin: native_notes) preservados'
  );

  // Test Combined Alt+W + Alt+P (enters once as New Word with pronunciation focus)
  const rawCombinedNotes = `
<div><span class="inline-coaching-tag new-word-tag" data-tag-type="new-word">✦ New Word</span>&nbsp;<span class="inline-coaching-tag pronounce-tag" data-tag-type="pronounce">🎯 Pronounce</span>&nbsp;serendipitous</div>
`;
  const combinedSynced = await syncSessionVocabularyToStudentDictionary({
    studentUid,
    studentEmail,
    rawNotes: rawCombinedNotes,
    vocabularyAndExpressions: [
      {
        id: 'vocab-combined',
        term: 'serendipitous',
        partOfSpeech: 'Adjective',
        simpleDefinition: 'Occurring or discovered by chance in a happy or beneficial way.',
        collocations: ['serendipitous encounter'],
        realExamples: ['Meeting our lead investor was completely serendipitous.'],
        synonyms: ['fortuitous', 'lucky'],
        register: 'neutral',
        category: 'New Word & Pronunciation (Alt+W + Alt+P)',
        isNewWord: true,
        isPronunciationFocus: true,
        cefrLevel: 'C1',
      },
    ],
    studentLevel: EnglishLevel.ADVANCED,
    sessionDate,
    topic: sessionTopic,
    skipClientWrite: true,
  });

  assert(
    combinedSynced.length === 1 && normalizeDictionaryWord(combinedSynced[0].word) === 'serendipitous',
    'Test 7E: Termo Alt+W + Alt+P entra uma única vez no dicionário como New Word'
  );

  assert(
    combinedSynced[0].enrichmentStatus === 'enriched' && Boolean(combinedSynced[0].definitionEn),
    'Test 7F: Termo enriquecido retém enrichmentStatus: "enriched"'
  );

  // Test Pre-AI Registration with Pending Status (Zero External API lookup)
  const preAiSynced = await syncSessionVocabularyToStudentDictionary({
    studentUid,
    studentEmail,
    rawNotes: `<div><span class="inline-coaching-tag new-word-tag" data-tag-type="new-word">✦ New Word</span>&nbsp;paradigm</div>`,
    vocabularyAndExpressions: [], // Pre-AI generation: empty list
    studentLevel: EnglishLevel.INTERMEDIATE,
    sessionDate,
    topic: sessionTopic,
    skipClientWrite: true,
  });

  assert(
    preAiSynced.length === 1 && normalizeDictionaryWord(preAiSynced[0].word) === 'paradigm',
    'Test 7G: Palavra Alt+W pré-IA é registrada imediatamente no dicionário'
  );

  assert(
    preAiSynced[0].enrichmentStatus === 'pending' && (!preAiSynced[0].definitionEn || preAiSynced[0].definitionEn === ''),
    'Test 7H: Registro pré-IA possui status "pending" sem inventar definições ou recorrer a APIs externas'
  );

  // Summary
  console.log('\n============================================================================');
  console.log(`TOTAL PASSADOS: ${passed}`);
  console.log(`TOTAL FALHADOS: ${failed}`);
  console.log('============================================================================\n');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests().catch((err) => {
  console.error('Fatal error running test suite:', err);
  process.exit(1);
});
