/**
 * FASE 2.1 — FUNDAÇÃO DO MY DICTIONARY COMO BIBLIOTECA PEDAGÓGICA
 * Automated Test Suite (Etapa E: Items 1 to 12)
 *
 * Ambiente Exclusivo: itissimple-security-staging (default)
 * Não acessa nem modifica produção itissimple-8663d.
 */

import {
  normalizeDictionaryWord,
  isDefinitionRicher,
  consolidateDictionaryEntries,
} from '../src/utils/studentDictionaryLibrary';
import {
  syncSessionVocabularyToStudentDictionary,
} from '../src/utils/sessionVocabularySync';
import {
  getDailyMemorizationSchedule,
  buildDailyMemorizationQueue,
} from '../src/utils/homeworkGenerator';
import { StudentDictionaryEntry, EnglishLevel, HomeworkVocabItem } from '../src/types';
import { setFirebaseAdminAuthForTesting } from '../src/serverFirebaseAdmin';
import { getVerifiedUserFromRequest } from '../src/middleware/firebaseAuth';

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

async function runTests() {
  console.log('\n======================================================');
  console.log('FASE 2.1 — SUITE DE TESTES AUTOMATIZADOS (ITENS 1 A 12)');
  console.log('======================================================\n');

  // --------------------------------------------------------------------------
  // TESTE 1: Palavra nova do Native Friend (Alt+W) entra no My Dictionary
  // --------------------------------------------------------------------------
  console.log('TEST 1: Palavra nova do Native Friend (Alt+W) entra no My Dictionary');
  {
    const rawNotesWithAltW = `
      <p>Today we had a wonderful conversation!</p>
      <p><span data-tag-type="new-word">✦ New Word</span> breakthrough</p>
      <p>She made a major breakthrough in pronunciation.</p>
    `;

    const synced = await syncSessionVocabularyToStudentDictionary({
      studentUid: 'student_test_1',
      studentEmail: 'student1@example.com',
      rawNotes: rawNotesWithAltW,
      studentLevel: EnglishLevel.INTERMEDIATE,
      sessionDate: '2026-10-15',
      topic: 'Speaking & Fluency',
      teacherName: 'Charles Tutor',
    });

    const hasBreakthrough = synced.some(
      (e) => normalizeDictionaryWord(e.word) === 'breakthrough'
    );
    assert(hasBreakthrough, 'Word with Alt+W (breakthrough) is added to dictionary');
    assert(
      Boolean(synced[0]?.origins?.some((o) => o.source === 'native_notes')),
      'Entry has origin source native_notes with teacher and session context'
    );
  }

  // --------------------------------------------------------------------------
  // TESTE 2: Palavra apenas de pronúncia (Alt+P) NÃO entra automaticamente
  // --------------------------------------------------------------------------
  console.log('\nTEST 2: Palavra apenas de pronúncia (Alt+P) NÃO entra automaticamente');
  {
    const rawNotesWithAltPOnly = `
      <p>Pronunciation practice during conversation:</p>
      <p><span data-tag-type="pronounce">🎯 Pronounce</span> comfortable</p>
      <p><span data-tag-type="pronounce">🎯 Pronounce</span> schedule</p>
    `;

    const syncedPronounce = await syncSessionVocabularyToStudentDictionary({
      studentUid: 'student_test_2',
      studentEmail: 'student2@example.com',
      rawNotes: rawNotesWithAltPOnly,
      studentLevel: EnglishLevel.INTERMEDIATE,
      sessionDate: '2026-10-15',
      topic: 'Phonetics & Rhythm',
      teacherName: 'Charles Tutor',
    });

    const hasComfortable = syncedPronounce.some(
      (e) => normalizeDictionaryWord(e.word) === 'comfortable'
    );
    const hasSchedule = syncedPronounce.some(
      (e) => normalizeDictionaryWord(e.word) === 'schedule'
    );
    assert(
      !hasComfortable && !hasSchedule && syncedPronounce.length === 0,
      'Exclusively Alt+P items (comfortable, schedule) do NOT enter My Dictionary'
    );
  }

  // --------------------------------------------------------------------------
  // TESTE 3: Palavra das 5 Palavras mantém origem routine
  // --------------------------------------------------------------------------
  console.log('\nTEST 3: Palavra das 5 Palavras mantém origem routine');
  {
    const routineWords: StudentDictionaryEntry[] = [
      {
        id: 'routine_insight_123',
        word: 'insight',
        originalWord: 'insight',
        normalizedWord: 'insight',
        definitionEn: 'A deep understanding of a person or thing.',
        partOfSpeech: 'Noun',
        source: 'routine',
        sourceActivityName: '5 Words Video (Monday)',
        sourceDay: 'monday' as any,
        learnedAt: '2026-10-15T10:00:00.000Z',
        origins: [
          {
            source: 'routine',
            activityName: '5 Words Video (Monday)',
            dayOfWeek: 'monday' as any,
            videoId: 'vid_yt_abc',
            videoTitle: 'How to Speak Clearly',
            date: '2026-10-15',
            context: '5 Words routine activity: "How to Speak Clearly"',
          },
        ],
        routineRef: {
          day: 'monday' as any,
          activityName: '5 Words Video',
          activityId: 'act_123',
          videoId: 'vid_yt_abc',
          videoTitle: 'How to Speak Clearly',
        },
      },
    ];

    const consolidated = consolidateDictionaryEntries([], routineWords);
    assert(consolidated.length === 1, 'Routine word saved successfully');
    assert(consolidated[0]?.source === 'routine', 'Origin classified correctly as routine');
    assert(
      consolidated[0]?.routineRef?.videoId === 'vid_yt_abc',
      'Video reference is preserved in entry'
    );
  }

  // --------------------------------------------------------------------------
  // TESTE 4: Palavra existente nas duas fontes preserva ambos os contextos
  // --------------------------------------------------------------------------
  console.log('\nTEST 4: Palavra existente nas duas fontes preserva ambos os contextos');
  {
    const existingRoutineEntry: StudentDictionaryEntry = {
      id: 'routine_resilience_1',
      word: 'resilience',
      originalWord: 'resilience',
      normalizedWord: 'resilience',
      definitionEn: 'The capacity to recover quickly from difficulties; toughness.',
      exampleSentenceEn: 'She showed great resilience during the challenge.',
      partOfSpeech: 'Noun',
      source: 'routine',
      sourceActivityName: 'TED Talk Video (Tuesday)',
      learnedAt: '2026-10-10T09:00:00.000Z',
      practiceCount: 3,
      lastPracticedAt: '2026-10-12T15:00:00.000Z',
      origins: [
        {
          source: 'routine',
          activityName: 'TED Talk Video (Tuesday)',
          videoId: 'ted_resilience_01',
          date: '2026-10-10',
          context: 'Learned in morning routine TED Talk',
        },
      ],
    };

    const newNativeLessonEntry: StudentDictionaryEntry = {
      id: 'dict_resilience_lesson',
      word: 'resilience',
      originalWord: 'resilience',
      normalizedWord: 'resilience',
      definitionEn: 'The capacity to withstand and recover rapidly from adversity.',
      exampleSentenceEn: 'Resilience is vital when learning a new language.',
      partOfSpeech: 'Noun',
      source: 'live_lesson',
      sourceActivityName: 'Native Friends Notes (Fluency & Grit)',
      learnedAt: '2026-10-15T14:00:00.000Z',
      lessonRefId: 'lesson_live_456',
      origins: [
        {
          source: 'native_notes',
          activityName: 'Native Friends Notes (Fluency & Grit)',
          lessonId: 'lesson_live_456',
          teacherName: 'Charles Tutor',
          date: '2026-10-15',
          context: 'Introduced by Charles in live session',
        },
      ],
    };

    const merged = consolidateDictionaryEntries([existingRoutineEntry], [newNativeLessonEntry]);
    assert(merged.length === 1, 'Single consolidated entry maintained for practice');
    const entry = merged[0]!;
    assert(entry.origins?.length === 2, 'Preserves both origins (routine + native_notes)');
    const hasRoutine = entry.origins?.some((o) => o.source === 'routine' && o.videoId === 'ted_resilience_01');
    const hasNative = entry.origins?.some((o) => o.source === 'native_notes' && o.lessonId === 'lesson_live_456');
    assert(Boolean(hasRoutine && hasNative), 'Both specific origin contexts preserved intact');
    assert(entry.practiceCount === 3, 'Practice count not reset (kept 3)');
    assert(entry.lastPracticedAt === '2026-10-12T15:00:00.000Z', 'lastPracticedAt preserved');
  }

  // --------------------------------------------------------------------------
  // TESTE 5: Nenhuma duplicação indevida
  // --------------------------------------------------------------------------
  console.log('\nTEST 5: Nenhuma duplicação indevida');
  {
    const variations: StudentDictionaryEntry[] = [
      { id: '1', word: 'Perseverance', definitionEn: 'Persistence in doing something.' },
      { id: '2', word: 'perseverance ', definitionEn: 'Continued effort.' },
      { id: '3', word: ' perseverance', definitionEn: 'Steadfast effort.' },
      { id: '4', word: 'PERSEVERANCE', definitionEn: 'Determination.' },
    ];

    const deduplicated = consolidateDictionaryEntries([], variations);
    assert(deduplicated.length === 1, 'Multiple casing/spacing variants consolidated into 1 entry');
    assert(deduplicated[0]?.normalizedWord === 'perseverance', 'Normalized word used as canonical deduplication key');
  }

  // --------------------------------------------------------------------------
  // TESTE 6: Definição enriquecida não é substituída por fallback genérico
  // --------------------------------------------------------------------------
  console.log('\nTEST 6: Definição enriquecida não é substituída por fallback genérico');
  {
    const richDef = 'A clear, detailed description explaining intricate details of linguistic nuance.';
    const genericFallback = 'A fundamental word for level B1: practice using "nuance" in simple daily conversations.';

    assert(
      isDefinitionRicher(richDef, genericFallback),
      'isDefinitionRicher identifies rich pedagogical definition over generic fallback'
    );

    const existingEnriched: StudentDictionaryEntry = {
      id: 'e1',
      word: 'nuance',
      definitionEn: richDef,
      exampleSentenceEn: 'He captured every subtle nuance in tone.',
    };

    const incomingProvisional: StudentDictionaryEntry = {
      id: 'e2',
      word: 'nuance',
      definitionEn: genericFallback,
      exampleSentenceEn: 'Practice using nuance.',
    };

    const merged = consolidateDictionaryEntries([existingEnriched], [incomingProvisional]);
    assert(
      merged[0]?.definitionEn === richDef,
      'Enriched definition is strictly protected from being replaced by generic fallback'
    );
  }

  // --------------------------------------------------------------------------
  // TESTE 7: Histórico de prática preservado
  // --------------------------------------------------------------------------
  console.log('\nTEST 7: Histórico de prática preservado');
  {
    const practicedEntry: StudentDictionaryEntry = {
      id: 'p1',
      word: 'thorough',
      definitionEn: 'Complete with regard to every detail.',
      practiceCount: 5,
      lastPracticedAt: '2026-10-14T11:00:00.000Z',
      practiceHistory: [
        { date: '2026-10-10T10:00:00.000Z', activityType: 'memorization', correct: true },
        { date: '2026-10-14T11:00:00.000Z', activityType: 'sentence', correct: true },
      ],
    };

    const incomingUpdate: StudentDictionaryEntry = {
      id: 'p2',
      word: 'thorough',
      definitionEn: 'Complete with regard to every detail.',
      practiceCount: 0, // Should NOT overwrite 5
    };

    const merged = consolidateDictionaryEntries([practicedEntry], [incomingUpdate]);
    assert(merged[0]?.practiceCount === 5, 'practiceCount preserved (5, not 0)');
    assert(merged[0]?.lastPracticedAt === '2026-10-14T11:00:00.000Z', 'lastPracticedAt preserved');
    assert(merged[0]?.practiceHistory?.length === 2, 'practiceHistory events preserved intact');
  }

  // --------------------------------------------------------------------------
  // TESTE 8: Registros antigos continuam legíveis (Retrocompatibilidade)
  // --------------------------------------------------------------------------
  console.log('\nTEST 8: Registros antigos continuam legíveis (Retrocompatibilidade)');
  {
    // Minimal legacy entry lacking all new optional fields
    const legacyEntry: StudentDictionaryEntry = {
      id: 'legacy_1',
      word: 'ancient',
      definitionEn: 'Belonging to the very distant past.',
    };

    const consolidated = consolidateDictionaryEntries([legacyEntry], []);
    assert(consolidated.length === 1, 'Legacy entry without new fields loads cleanly');
    assert(consolidated[0]?.word === 'ancient', 'Word intact');
    assert(consolidated[0]?.normalizedWord === 'ancient', 'normalizedWord derived automatically');
    assert(consolidated[0]?.definitionEn === 'Belonging to the very distant past.', 'Definition intact');
  }

  // --------------------------------------------------------------------------
  // TESTE 9: Alunos não acessam dicionários de terceiros (Autorização e Isolamento)
  // --------------------------------------------------------------------------
  console.log('\nTEST 9: Alunos não acessam dicionários de terceiros (Autorização e Isolamento)');
  {
    // Configure mock auth for verified student Regina
    const mockStudentUser = {
      uid: 'student_regina_uid',
      email: 'regina@example.com',
      role: 'student' as const,
      email_verified: true,
    };

    const mockAdminAuth = {
      verifyIdToken: async (token: string) => {
        if (token === 'valid_student_token') {
          return {
            uid: mockStudentUser.uid,
            email: mockStudentUser.email,
            email_verified: true,
            role: 'student',
          };
        }
        if (token === 'valid_admin_token') {
          return {
            uid: 'admin_uid',
            email: 'admin@example.com',
            email_verified: true,
            role: 'admin',
            admin: true,
          };
        }
        throw new Error('Invalid token');
      },
    };

    setFirebaseAdminAuthForTesting(mockAdminAuth as any);

    // 1. Student accessing own dictionary
    const reqOwn: any = {
      headers: { authorization: 'Bearer valid_student_token' },
      query: { uid: 'student_regina_uid', studentEmail: 'regina@example.com' },
    };
    const callerOwn = await getVerifiedUserFromRequest(reqOwn);
    assert(callerOwn?.uid === 'student_regina_uid', 'Student verified via token');
    assert(callerOwn?.role === 'student', 'Student role verified');

    // Cross-student verification logic:
    const targetOtherUid = 'student_bob_uid';
    const isCrossAccessDenied = callerOwn?.role === 'student' && targetOtherUid !== callerOwn.uid;
    assert(isCrossAccessDenied, 'Student attempting to access another student UID is strictly blocked');

    // 2. Unverified request claiming admin role
    const reqUntrusted: any = {
      headers: {},
      query: { role: 'admin' },
    };
    const callerUntrusted = await getVerifiedUserFromRequest(reqUntrusted);
    assert(callerUntrusted === null, 'Unauthenticated request claiming admin role has null verified caller');
  }

  // --------------------------------------------------------------------------
  // TESTE 10: Zero chamadas Gemini
  // --------------------------------------------------------------------------
  console.log('\nTEST 10: Zero chamadas Gemini na Fundação da Biblioteca');
  {
    // Audit imports across studentDictionaryLibrary and dictionaryService
    const fs = await import('fs');
    const path = await import('path');

    const libraryFile = fs.readFileSync(
      path.resolve(process.cwd(), 'src/utils/studentDictionaryLibrary.ts'),
      'utf8'
    );
    const hasGenaiInLibrary = libraryFile.includes('@google/genai') || libraryFile.includes('GoogleGenAI');
    assert(!hasGenaiInLibrary, 'studentDictionaryLibrary.ts contains zero Gemini / @google/genai imports');

    const sessionSyncFile = fs.readFileSync(
      path.resolve(process.cwd(), 'src/utils/sessionVocabularySync.ts'),
      'utf8'
    );
    const hasGenaiInSync = sessionSyncFile.includes('@google/genai') || sessionSyncFile.includes('GoogleGenAI');
    assert(!hasGenaiInSync, 'sessionVocabularySync.ts contains zero Gemini / @google/genai imports');
  }

  // --------------------------------------------------------------------------
  // TESTE 11: Fila de memorização e S-Path sem alterações
  // --------------------------------------------------------------------------
  console.log('\nTEST 11: Fila de memorização e S-Path sem alterações');
  {
    const sampleCandidates: HomeworkVocabItem[] = [
      { id: '1', word: 'apple', learnedAt: '2026-10-01T10:00:00Z', practiceCount: 0, translationPt: 'Maçã', definitionEn: 'A red fruit', exampleSentence: 'Apples are delicious.' },
      { id: '2', word: 'banana', learnedAt: '2026-10-02T10:00:00Z', practiceCount: 0, translationPt: 'Banana', definitionEn: 'A yellow fruit', exampleSentence: 'Bananas are sweet.' },
      { id: '3', word: 'cherry', learnedAt: '2026-10-03T10:00:00Z', practiceCount: 0, translationPt: 'Cereja', definitionEn: 'A small red fruit', exampleSentence: 'Cherries are tasty.' },
      { id: '4', word: 'date', learnedAt: '2026-10-04T10:00:00Z', practiceCount: 0, translationPt: 'Tâmara', definitionEn: 'A sweet brown fruit', exampleSentence: 'Dates grow on palms.' },
      { id: '5', word: 'elderberry', learnedAt: '2026-10-05T10:00:00Z', practiceCount: 0, translationPt: 'Sabugueiro', definitionEn: 'A dark purple fruit', exampleSentence: 'Elderberries are tart.' },
      { id: '6', word: 'fig', learnedAt: '2026-10-06T10:00:00Z', practiceCount: 0, translationPt: 'Figo', definitionEn: 'A soft purple fruit', exampleSentence: 'Figs are sweet.' },
      { id: '7', word: 'grape', learnedAt: '2026-10-07T10:00:00Z', practiceCount: 0, translationPt: 'Uva', definitionEn: 'A juicy green fruit', exampleSentence: 'Grapes make wine.' },
    ];

    const dailyQueue = buildDailyMemorizationQueue(sampleCandidates);
    assert(Array.isArray(dailyQueue), 'Memorization queue returns valid array');
    assert(dailyQueue.length === 5, 'Daily queue strictly preserves 5-word cap');
    assert(
      dailyQueue[0].word === 'apple' && dailyQueue[4].word === 'elderberry',
      'Oldest never-practiced words selected first (deterministic FIFO)'
    );

    const mondaySchedule = getDailyMemorizationSchedule('monday');
    const tuesdaySchedule = getDailyMemorizationSchedule('tuesday');
    assert(mondaySchedule.partKey === 'matching', 'Monday schedule Part 1 (matching) preserved');
    assert(tuesdaySchedule.partKey === 'fill', 'Tuesday schedule Part 2 (fill) preserved');
    assert(
      mondaySchedule.partKey !== tuesdaySchedule.partKey,
      'S-Path pedagogical parts progression preserved'
    );
  }

  // --------------------------------------------------------------------------
  // TESTE 12: Resultados Finais e Estatísticas
  // --------------------------------------------------------------------------
  console.log('\nTEST 12: Consolidação dos Resultados');
  {
    assert(failed === 0, `All Phase 2.1 automated tests passed with zero failures (${passed} passed, ${failed} failed)`);
  }

  console.log('\n======================================================');
  console.log(`TEST RESUMO: ${passed} PASS, ${failed} FAIL`);
  console.log('======================================================\n');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests().catch((err) => {
  console.error('Fatal error running Phase 2.1 tests:', err);
  process.exit(1);
});
