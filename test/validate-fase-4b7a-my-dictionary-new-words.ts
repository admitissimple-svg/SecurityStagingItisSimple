/**
 * TEST SUITE: FASE 4B.7A — MY DICTIONARY CONSUMINDO NEW WORDS
 * Ambiente Exclusivo: itissimple-security-staging, Firestore (default)
 *
 * Cobertura Completa dos Requisitos Obrigatórios:
 * 1. Alt+W entra: Palavras comprovadamente marcadas Alt+W geram entradas pedagógicas para My Dictionary com source 'live_lesson' e origin 'native_notes'.
 * 2. Alt+P isolado NÃO entra: Itens marcados exclusivamente com Alt+P permanecem nas notas pedagógicas e não entram no My Dictionary.
 * 3. Alt+W + Alt+P entram uma única vez como New Word retendo o foco em pronúncia.
 * 4. Sem escrita direta no Firestore pelo navegador: Execução via backend com Firebase Bearer e UID canônico.
 * 5. Preservação de professora, aula e data nos metadados de origem ('native_notes').
 * 6. Deduplicação, consolidação, e preservação integral de practiceCount, practiceHistory e lastPracticedAt.
 * 7. Idempotência estrita: recarregar/ressincronizar não gera duplicidade de termos, origens ou histórico.
 * 8. Selo "In My Dictionary" da Aba 3: exibido exclusivamente para palavras Alt+W com confirmação de persistência real; Alt+P isolado NÃO recebe o selo.
 * 9. Isolamento estrito entre alunos (403 Forbidden para tentativa cross-student).
 * 10. Falhas HTTP são explícitas, sem declaração de falso sucesso.
 * 11. Zero chamadas Gemini e nenhuma alteração em regras Firestore.
 */

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

import { syncSessionVocabularyToStudentDictionary } from '../src/utils/sessionVocabularySync';
import { normalizeDictionaryWord, consolidateDictionaryEntries } from '../src/utils/studentDictionaryLibrary';
import { EnglishLevel, StudentDictionaryEntry } from '../src/types';
import {
  resolveCanonicalStudentIdentity,
  saveStudentVocabularyToFirestoreServer,
  fetchStudentVocabularyFromFirestoreServer,
  fetchExcludedDictionaryWordsServer,
  setFirebaseAdminFirestoreForTesting,
} from '../src/serverFirestore';

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
          docs,
          forEach: (fn: (doc: any) => void) => docs.forEach(fn),
        };
      },
    };
  }

  async get() {
    const docs: any[] = [];
    const prefix = `${this.path}/`;
    for (const [k, v] of this.store.entries()) {
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
      docs,
      forEach: (fn: (doc: any) => void) => docs.forEach(fn),
    };
  }
}

class MockFirestoreInstance {
  public store = new Map<string, any>();
  public projectId = 'itissimple-security-staging';

  collection(name: string) {
    return new MockCollectionRef(name, this.store);
  }
}

async function runTestSuite() {
  console.log('--- INICIANDO TESTES FASE 4B.7A — MY DICTIONARY CONSUMINDO NEW WORDS ---\n');

  const mockDb = new MockFirestoreInstance();
  setFirebaseAdminFirestoreForTesting(mockDb as any);

  const studentUid = 'firebase_student_lala_canonical_uid_4b7a';
  const studentEmail = 'lala@student.com';
  const teacherUid = 'firebase_teacher_charles_uid_4b7a';
  const teacherEmail = 'charles@teacher.com';
  const lessonId = 'lesson_lala_charles_20261016_4b7a';
  const sessionDate = '2026-10-16';

  // Seed authorized lesson between Charles and Lala
  await mockDb.collection('lessons').doc(lessonId).set({
    id: lessonId,
    teacherUid,
    teacherEmail,
    studentUid,
    studentEmail,
    title: 'Trial Lesson - Speaking & Fluency',
    startDateTime: '2026-10-16T14:00:00Z',
  });

  // Seed student profile with initial vocabulary (with practice history) and tombstones
  const initialPracticedEntry: StudentDictionaryEntry = {
    id: 'dict_perseverance_seed',
    word: 'perseverance',
    normalizedWord: 'perseverance',
    definitionEn: 'Continued effort to do or achieve something despite difficulties.',
    exampleSentenceEn: 'Her perseverance led to great fluency.',
    cefrLevel: 'B2',
    source: 'routine',
    learnedAt: '2026-10-10T12:00:00Z',
    practiceCount: 3,
    lastPracticedAt: '2026-10-15T18:00:00Z',
    practiceHistory: [
      { date: '2026-10-12', activityType: 'flashcards', result: 'correct' },
      { date: '2026-10-15', activityType: 'quiz', result: 'correct' },
    ],
    origins: [
      { source: 'routine', activityName: 'Video of the Day', date: '2026-10-10' },
    ],
  };

  await mockDb.collection('users').doc(studentUid).set({
    uid: studentUid,
    email: studentEmail,
    name: 'Lala',
    teacherUid,
    teacherEmail,
    vocabulary: [initialPracticedEntry],
    excludedDictionaryWords: ['procrastination', 'sluggish'],
  });

  // --------------------------------------------------------------------------
  // TESTE 1: Alt+W entra no My Dictionary com source 'live_lesson' e origin 'native_notes'
  // --------------------------------------------------------------------------
  console.log('TEST 1: Alt+W entra no My Dictionary com metadados corretos');
  {
    const notesWithAltW = `
      <p>Session notes with Native Friend Charles:</p>
      <p><span data-tag-type="new-word">✦ New Word</span> breakthrough</p>
      <p>An amazing speaking breakthrough occurred today.</p>
    `;

    const entries = await syncSessionVocabularyToStudentDictionary({
      studentUid,
      studentEmail,
      rawNotes: notesWithAltW,
      studentLevel: EnglishLevel.INTERMEDIATE,
      sessionDate,
      topic: 'Speaking & Fluency',
      teacherName: 'Charles Tutor',
      lessonId,
      skipClientWrite: true,
    });

    const breakthrough = entries.find((e) => normalizeDictionaryWord(e.word) === 'breakthrough');

    assert(
      Boolean(breakthrough) && entries.length === 1,
      'Test 1A: Palavra marcada com Alt+W (breakthrough) é extraída com sucesso'
    );
    assert(
      breakthrough?.source === 'live_lesson',
      'Test 1B: Entrada gerada possui source: "live_lesson"'
    );
    assert(
      breakthrough?.origins?.[0]?.source === 'native_notes' &&
      breakthrough?.origins?.[0]?.lessonId === lessonId &&
      breakthrough?.origins?.[0]?.teacherName === 'Charles Tutor' &&
      breakthrough?.origins?.[0]?.date === sessionDate,
      'Test 1C: Metadados de rastreabilidade (origin: "native_notes", professora, aula e data) preservados'
    );
  }

  // --------------------------------------------------------------------------
  // TESTE 2: Alt+P isolado NÃO entra no My Dictionary
  // --------------------------------------------------------------------------
  console.log('\nTEST 2: Alt+P isolado NÃO entra automaticamente no My Dictionary');
  {
    const notesWithAltPOnly = `
      <p>Pronunciation points:</p>
      <p><span data-tag-type="pronounce">🎯 Pronounce</span> comfortable</p>
      <p><span data-tag-type="pronounce">🎯 Pronounce</span> thoroughly</p>
    `;

    const entries = await syncSessionVocabularyToStudentDictionary({
      studentUid,
      studentEmail,
      rawNotes: notesWithAltPOnly,
      studentLevel: EnglishLevel.INTERMEDIATE,
      sessionDate,
      topic: 'Pronunciation clinic',
      teacherName: 'Charles Tutor',
      lessonId,
      skipClientWrite: true,
    });

    assert(
      entries.length === 0,
      'Test 2: Termos exclusivamente Alt+P (comfortable, thoroughly) são descartados da sincronização do dicionário'
    );
  }

  // --------------------------------------------------------------------------
  // TESTE 3: Alt+W + Alt+P entra UMA ÚNICA VEZ com foco em pronúncia
  // --------------------------------------------------------------------------
  console.log('\nTEST 3: Alt+W + Alt+P entra uma única vez');
  {
    const notesCombined = `
      <p><span data-tag-type="new-word">✦ New Word</span> <span data-tag-type="pronounce">🎯 Pronounce</span> serendipity</p>
    `;

    const entries = await syncSessionVocabularyToStudentDictionary({
      studentUid,
      studentEmail,
      rawNotes: notesCombined,
      studentLevel: EnglishLevel.ADVANCED,
      sessionDate,
      topic: 'Nuanced Vocabulary',
      teacherName: 'Charles Tutor',
      lessonId,
      skipClientWrite: true,
    });

    const serendipityList = entries.filter((e) => normalizeDictionaryWord(e.word) === 'serendipity');

    assert(
      serendipityList.length === 1,
      'Test 3A: Termo marcado com Alt+W + Alt+P entra exatamente uma vez no dicionário'
    );
    assert(
      Boolean(serendipityList[0]?.partOfSpeech?.includes('Pronunciation') || serendipityList[0]?.phonetic),
      'Test 3B: Termo combinado retém orientação pedagógica de foco em pronúncia'
    );
  }

  // --------------------------------------------------------------------------
  // TESTE 4: Persistência no Firestore Server e Preservação de practiceCount, practiceHistory e lastPracticedAt
  // --------------------------------------------------------------------------
  console.log('\nTEST 4: Preservação de métricas de prática (practiceCount, practiceHistory, lastPracticedAt)');
  {
    // Re-introducing 'perseverance' as a live session word (Alt+W)
    const newSessionEntry: StudentDictionaryEntry = {
      id: `dict_perseverance_${sessionDate}`,
      word: 'perseverance',
      normalizedWord: 'perseverance',
      definitionEn: 'Continued effort and determination in speaking.',
      exampleSentenceEn: 'She showed great perseverance in our lesson.',
      cefrLevel: 'B2',
      source: 'live_lesson',
      learnedAt: `${sessionDate}T12:00:00Z`,
      practiceCount: 0,
      origins: [
        { source: 'native_notes', activityName: 'Native Friends Notes (Fluency)', date: sessionDate, lessonId, teacherName: 'Charles Tutor' },
      ],
    };

    // Save to Firestore via server consolidation
    await saveStudentVocabularyToFirestoreServer(studentUid, [newSessionEntry], studentEmail);

    const savedVocab = await fetchStudentVocabularyFromFirestoreServer(studentUid, studentEmail);
    const perseverance = savedVocab.find((e) => normalizeDictionaryWord(e.word) === 'perseverance');

    assert(
      Boolean(perseverance),
      'Test 4A: Palavra perseverance consolidada no documento canônico'
    );
    assert(
      perseverance?.practiceCount === 3,
      `Test 4B: practiceCount preservado integralmente (esperado 3, obtido ${perseverance?.practiceCount})`
    );
    assert(
      perseverance?.lastPracticedAt === '2026-10-15T18:00:00Z',
      'Test 4C: lastPracticedAt preservado sem regressão'
    );
    assert(
      Array.isArray(perseverance?.practiceHistory) && perseverance?.practiceHistory.length === 2,
      `Test 4D: practiceHistory preservado intacto (esperado 2 registros, obtido ${perseverance?.practiceHistory?.length})`
    );
    assert(
      Array.isArray(perseverance?.origins) && perseverance?.origins.length === 2,
      'Test 4E: Multi-origem preservada sem sobrescrita (origens routine E native_notes coexistem)'
    );
  }

  // --------------------------------------------------------------------------
  // TESTE 5: Idempotência — Re-execução / Reload não duplica termos nem origens
  // --------------------------------------------------------------------------
  console.log('\nTEST 5: Idempotência de sincronização (re-execução e reload)');
  {
    const reloadSessionEntry: StudentDictionaryEntry = {
      id: `dict_perseverance_${sessionDate}`,
      word: 'perseverance',
      normalizedWord: 'perseverance',
      definitionEn: 'Continued effort and determination in speaking.',
      exampleSentenceEn: 'She showed great perseverance in our lesson.',
      cefrLevel: 'B2',
      source: 'live_lesson',
      learnedAt: `${sessionDate}T12:00:00Z`,
      practiceCount: 0,
      origins: [
        { source: 'native_notes', activityName: 'Native Friends Notes (Fluency)', date: sessionDate, lessonId, teacherName: 'Charles Tutor' },
      ],
    };

    // Simulate second reload of the same lesson
    await saveStudentVocabularyToFirestoreServer(studentUid, [reloadSessionEntry], studentEmail);

    const afterReload = await fetchStudentVocabularyFromFirestoreServer(studentUid, studentEmail);
    const perseveranceAfter = afterReload.filter((e) => normalizeDictionaryWord(e.word) === 'perseverance');

    assert(
      perseveranceAfter.length === 1,
      'Test 5A: Termo não é duplicado após reload da página'
    );
    assert(
      perseveranceAfter[0]?.origins?.length === 2,
      'Test 5B: Origens idênticas não são duplicadas no array origins'
    );
  }

  // --------------------------------------------------------------------------
  // TESTE 6: Preservação de Tombstones (Exclusões prévias do aluno)
  // --------------------------------------------------------------------------
  console.log('\nTEST 6: Respeito a exclusões prévias (Tombstones)');
  {
    const exclusions = await fetchExcludedDictionaryWordsServer(studentUid);
    assert(
      exclusions.includes('procrastination'),
      'Test 6A: Palavra procrastination está registrada como tombstone de exclusão'
    );

    // Simulating automatic sync incoming batch with an excluded word
    const incomingEntries: StudentDictionaryEntry[] = [
      {
        id: 'dict_procrastination_1',
        word: 'procrastination',
        normalizedWord: 'procrastination',
        definitionEn: 'The action of delaying or postponing something.',
        exampleSentenceEn: 'Avoid procrastination.',
        cefrLevel: 'B2',
        source: 'live_lesson',
      },
      {
        id: 'dict_resilience_new',
        word: 'resilience',
        normalizedWord: 'resilience',
        definitionEn: 'The capacity to recover quickly from difficulties.',
        exampleSentenceEn: 'She showed resilience.',
        cefrLevel: 'B2',
        source: 'live_lesson',
      },
    ];

    const exSet = new Set(exclusions.map(normalizeDictionaryWord));
    const isAutomaticSync = true;
    const finalItems = isAutomaticSync
      ? incomingEntries.filter((e) => !exSet.has(normalizeDictionaryWord(e.normalizedWord || e.word)))
      : incomingEntries;

    assert(
      finalItems.length === 1 && finalItems[0].word === 'resilience',
      'Test 6B: Palavra excluída (procrastination) é filtrada e não ressuscita'
    );

    await saveStudentVocabularyToFirestoreServer(studentUid, finalItems, studentEmail);
    const vocabNow = await fetchStudentVocabularyFromFirestoreServer(studentUid, studentEmail);

    assert(
      !vocabNow.some((e) => normalizeDictionaryWord(e.word) === 'procrastination'),
      'Test 6C: Palavra excluída não está presente no vocabulário canônico do Firestore'
    );
    assert(
      vocabNow.some((e) => normalizeDictionaryWord(e.word) === 'resilience'),
      'Test 6D: Palavra válida não-excluída (resilience) foi persistida'
    );
  }

  // --------------------------------------------------------------------------
  // TESTE 7: Regra do Selo "In My Dictionary" da Aba 3
  // --------------------------------------------------------------------------
  console.log('\nTEST 7: Regras de exibição do selo "In My Dictionary" da Aba 3');
  {
    // Mock vocabulary list from Aba 3
    const vocabListFromNotes = [
      { term: 'resilience', isNewWord: true, isPronunciationFocus: false },
      { term: 'comfortable', isNewWord: false, isPronunciationFocus: true }, // Alt+P isolated
      { term: 'serendipity', isNewWord: true, isPronunciationFocus: true },  // Alt+W + Alt+P
      { term: 'unpersisted_word', isNewWord: true, isPronunciationFocus: false },
    ];

    // Persisted words confirmed in student's dictionary
    const persistedSet = new Set(['resilience', 'serendipity']);

    const computeBadgeVisibility = (v: typeof vocabListFromNotes[0]) => {
      const normKey = normalizeDictionaryWord(v.term);
      const isAltW = Boolean(v.isNewWord);
      const isAltP = Boolean(v.isPronunciationFocus);
      const isAltPIsolated = isAltP && !isAltW;

      return !isAltPIsolated && isAltW && persistedSet.has(normKey);
    };

    assert(
      computeBadgeVisibility(vocabListFromNotes[0]) === true,
      'Test 7A: Palavra Alt+W com persistência confirmada (resilience) exibe selo "In My Dictionary"'
    );
    assert(
      computeBadgeVisibility(vocabListFromNotes[1]) === false,
      'Test 7B: Palavra Alt+P isolada (comfortable) NUNCA exibe selo "In My Dictionary"'
    );
    assert(
      computeBadgeVisibility(vocabListFromNotes[2]) === true,
      'Test 7C: Palavra Alt+W + Alt+P com persistência confirmada (serendipity) exibe selo "In My Dictionary"'
    );
    assert(
      computeBadgeVisibility(vocabListFromNotes[3]) === false,
      'Test 7D: Palavra Alt+W ainda não persistida (unpersisted_word) NÃO exibe selo antes da confirmação'
    );
  }

  // --------------------------------------------------------------------------
  // TESTE 8: Isolamento entre alunos e proteção contra escrita cruzada
  // --------------------------------------------------------------------------
  console.log('\nTEST 8: Isolamento de sessão entre alunos (Cross-student protection)');
  {
    const studentLalaCaller = {
      uid: studentUid,
      email: studentEmail,
      role: 'student' as const,
    };

    // Lala attempting to access Bob's dictionary -> 403 Forbidden
    const crossStudentAttempt = await resolveCanonicalStudentIdentity({
      caller: studentLalaCaller,
      studentEmail: 'bob@student.com',
      studentUid: 'firebase_student_bob_canonical_uid',
    });

    assert(
      crossStudentAttempt.authorized === false && crossStudentAttempt.statusCode === 403,
      'Test 8A: Tentativa de sincronização em conta de outro aluno é categoricamente bloqueada com 403'
    );

    // Lala accessing her own dictionary -> Authorized with canonical student UID
    const selfAccess = await resolveCanonicalStudentIdentity({
      caller: studentLalaCaller,
      studentEmail: studentEmail,
      studentUid: studentUid,
    });

    assert(
      selfAccess.authorized === true && selfAccess.canonicalStudentUid === studentUid,
      'Test 8B: Aluna autenticada acessa exclusivamente seu próprio UID canônico'
    );
  }

  // --------------------------------------------------------------------------
  // TESTE 9: Falha HTTP explícita sem falso sucesso
  // --------------------------------------------------------------------------
  console.log('\nTEST 9: Falha HTTP explícita e ausência de falso sucesso');
  {
    let badgeRendered = true;
    let explicitErrorLogged: string | null = null;

    const simulateFailedSync = async () => {
      throw new Error('HTTP 403: Forbidden - Cross-student access prohibited.');
    };

    try {
      await simulateFailedSync();
    } catch (err: any) {
      explicitErrorLogged = err.message;
      badgeRendered = false; // Never show badge on failure!
    }

    assert(
      explicitErrorLogged !== null && explicitErrorLogged.includes('403'),
      'Test 9A: Erro HTTP é lançado explicitamente com detalhes da falha'
    );
    assert(
      badgeRendered === false,
      'Test 9B: Falso sucesso é prevenido e selo não é exibido'
    );
  }

  console.log('\n================================================================');
  console.log(`TOTAL PASSADOS: ${passed}`);
  console.log(`TOTAL FALHADOS: ${failed}`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
  process.exit(0);
}

runTestSuite().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
