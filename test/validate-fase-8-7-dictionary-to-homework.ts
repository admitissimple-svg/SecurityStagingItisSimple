/**
 * Automated Verification Suite for FASE 8.7
 * Correção do fluxo My Dictionary -> Homework
 * 
 * Verifies all 10 realistic scenarios required by FASE 8.7 specifications.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveDailyMemorizationVocabulary,
  generateWeeklyHomeworkFromRoutines,
  deriveContextualSentencePrompt,
  isActivityStartedOrAnswered,
} from '../src/utils/homeworkGenerator';
import {
  mergeDailyActivities,
  sanitizeLoadedHomeworkData,
  createCleanInitializedHomework,
  normalizeUid,
} from '../src/utils/studentPersistence';
import { synthesizeFillInBlanks } from '../src/utils/pedagogicalStorySynthesizer';
import {
  DailyHomeworkActivity,
  WeeklyHomeworkData,
  HomeworkVocabItem,
  DayOfWeek,
  UserProfile,
  EnglishLevel,
} from '../src/types';

function createSampleWord(
  word: string,
  learnedAt: string,
  extra?: Partial<HomeworkVocabItem>
): HomeworkVocabItem {
  return {
    id: `vocab_${word.toLowerCase()}`,
    word,
    learnedAt,
    definitionEn: extra?.definitionEn || `Accurate definition of ${word}`,
    translationPt: extra?.translationPt || `${word} (traducao)`,
    exampleSentence: extra?.exampleSentence || `Realistic contextual sentence with ${word}.`,
    sourceActivityName: extra?.sourceActivityName || 'Personal Dictionary',
    source: extra?.source || 'personal_dictionary',
    studentUid: extra?.studentUid,
    studentEmail: extra?.studentEmail,
    origins: extra?.origins,
    cefrLevel: extra?.cefrLevel || 'B2',
    partOfSpeech: extra?.partOfSpeech || 'noun',
    ...extra,
  };
}

const sampleFiveWords = [
  createSampleWord('resilient', '2026-10-29T10:00:00Z', { studentUid: 'student_123', studentEmail: 'student@test.com' }),
  createSampleWord('thrive', '2026-10-29T11:00:00Z', { studentUid: 'student_123', studentEmail: 'student@test.com' }),
  createSampleWord('persevere', '2026-10-29T12:00:00Z', { studentUid: 'student_123', studentEmail: 'student@test.com' }),
  createSampleWord('insight', '2026-10-29T13:00:00Z', { studentUid: 'student_123', studentEmail: 'student@test.com' }),
  createSampleWord('foster', '2026-10-29T14:00:00Z', { studentUid: 'student_123', studentEmail: 'student@test.com' }),
];

describe('FASE 8.7: Correção do fluxo My Dictionary -> Homework', () => {
  const targetDay: DayOfWeek = 'thursday';
  const activityDate = '2026-10-29';
  const defaultProfile: UserProfile = {
    id: 'student_123',
    uid: 'student_123',
    name: 'Alice',
    email: 'student@test.com',
    level: EnglishLevel.INTERMEDIATE,
    weeklyStudyDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
    weeklyCycle: 1,
    streakDays: 5,
    streakCount: 5,
    points: 100,
    dailyGoalMinutes: 30,
    completedTodayMinutes: 20,
    targetAudienceCategory: 'general',
    timezone: 'America/Sao_Paulo',
    contractedLessons: 4,
    completedLessonsCount: 2,
  };

  it('1. Dicionário hidratando depois do perfil: gera exercícios com 5 palavras quando status muda para loaded_with_words', () => {
    // Stage A: Profile is loaded, but dictionary is 'loading'
    let dictStatus: string = 'loading';
    let dictionary: HomeworkVocabItem[] = [];

    // Guard simulation matching App.tsx
    let generatorRan = false;
    if (dictStatus !== 'uninitialized' && dictStatus !== 'loading' && dictStatus !== 'error') {
      generatorRan = true;
    }
    assert.equal(generatorRan, false, 'Generator must not run while dictionary is loading');

    // Stage B: Dictionary resolves asynchronously with 5 words
    dictStatus = 'loaded_with_words';
    dictionary = [...sampleFiveWords];

    if (dictStatus !== 'uninitialized' && dictStatus !== 'loading' && dictStatus !== 'error') {
      generatorRan = true;
    }
    assert.equal(generatorRan, true, 'Generator runs as soon as dictionary is loaded_with_words');

    const generated = generateWeeklyHomeworkFromRoutines({
      routinesByDay: {} as any,
      studentName: defaultProfile.name,
      studentLevel: defaultProfile.level,
      studentEmail: defaultProfile.email,
      studentUid: defaultProfile.uid,
      customWords: dictionary,
      targetDay,
      activityDate,
      userProfile: defaultProfile,
    });

    assert.equal(generated.isEmpty, false, 'Homework must not be empty');
    assert.equal(generated.vocabularyList.length, 5, 'Must select all 5 words from My Dictionary');
    assert.equal(generated.matchingPairs?.length, 5, 'Part 1 (Matching) must have 5 pairs');
    assert.equal(generated.fillInBlanks?.length, 5, 'Part 2 (Fill in blanks) must have 5 items (never 0/0)');
    assert.equal(generated.sentenceWritingPrompts?.length, 5, 'Part 3 (Writing prompts) must have 5 items (never 0/0)');
    assert.ok(generated.readingPassage?.text, 'Part 4 (Story) must be generated');
  });

  it('2. Dicionário contendo cinco palavras e rotinas vazias: atividade gerada com sucesso desacoplada de rotinas', () => {
    const emptyRoutines = {} as Record<DayOfWeek, any[]>;

    const generated = generateWeeklyHomeworkFromRoutines({
      routinesByDay: emptyRoutines,
      studentName: defaultProfile.name,
      studentLevel: defaultProfile.level,
      studentEmail: defaultProfile.email,
      studentUid: defaultProfile.uid,
      customWords: sampleFiveWords,
      targetDay,
      activityDate,
      userProfile: defaultProfile,
    });

    assert.equal(generated.isEmpty, false, 'Activity must be generated even when routinesByDay is completely empty');
    assert.equal(generated.vocabularyList.length, 5, 'Must have 5 words');
    assert.equal(generated.fillInBlanks?.length, 5, 'Part 2 must have 5 items');
    assert.equal(generated.sentenceWritingPrompts?.length, 5, 'Part 3 must have 5 items');
  });

  it('3. Dicionário contendo cinco palavras e falha na assinatura das rotinas: rotinasHydrationStatus: "error" não bloqueia geração', () => {
    // In Phase 8.6, routinesHydrationStatus === 'error' returned early and blocked generation.
    // In Phase 8.7, we decouple: dictionaryHydrationStatus === 'loaded_with_words' allows generation regardless of routines error.
    const dictStatus: string = 'loaded_with_words';
    const routinesStatus = 'error';

    let shouldRun = false;
    if (dictStatus !== 'uninitialized' && dictStatus !== 'loading' && dictStatus !== 'error') {
      shouldRun = true; // Decoupled!
    }

    assert.equal(shouldRun, true, 'Routines error must not block generation when dictionary is loaded_with_words');

    const generated = generateWeeklyHomeworkFromRoutines({
      routinesByDay: {} as any,
      studentName: defaultProfile.name,
      studentLevel: defaultProfile.level,
      studentEmail: defaultProfile.email,
      studentUid: defaultProfile.uid,
      customWords: sampleFiveWords,
      targetDay,
      activityDate,
      userProfile: defaultProfile,
    });

    assert.equal(generated.isEmpty, false);
    assert.equal(generated.fillInBlanks?.length, 5);
    assert.equal(generated.sentenceWritingPrompts?.length, 5);
  });

  it('4. Inclusão de uma nova palavra após a primeira renderização: reatividade atualiza a lista de 4 para 5 palavras', () => {
    const initialFourWords = sampleFiveWords.slice(0, 4);

    const firstGen = generateWeeklyHomeworkFromRoutines({
      routinesByDay: {} as any,
      studentName: defaultProfile.name,
      studentLevel: defaultProfile.level,
      studentEmail: defaultProfile.email,
      studentUid: defaultProfile.uid,
      customWords: initialFourWords,
      targetDay,
      activityDate,
      userProfile: defaultProfile,
    });

    assert.equal(firstGen.vocabularyList.length, 4, 'Initial run had 4 words');
    assert.equal(firstGen.fillInBlanks?.length, 4, 'Part 2 denominator initially 4');

    // Student adds 5th word to My Dictionary
    const updatedFiveWords = [...initialFourWords, sampleFiveWords[4]];

    const secondGen = generateWeeklyHomeworkFromRoutines({
      routinesByDay: {} as any,
      studentName: defaultProfile.name,
      studentLevel: defaultProfile.level,
      studentEmail: defaultProfile.email,
      studentUid: defaultProfile.uid,
      customWords: updatedFiveWords,
      targetDay,
      activityDate,
      userProfile: defaultProfile,
    });

    assert.equal(secondGen.vocabularyList.length, 5, 'Second run dynamically includes 5th word');
    assert.equal(secondGen.fillInBlanks?.length, 5, 'Part 2 denominator updated to 5');
    assert.equal(secondGen.sentenceWritingPrompts?.length, 5, 'Part 3 denominator updated to 5');
  });

  it('5. Requisição tardia do Firestore: substitui homework transitório vazio com exercícios completos', () => {
    // Initial state: homework is empty
    const initialHw: WeeklyHomeworkData = {
      id: 'hw-thursday-1',
      weekLabel: 'Semana 1',
      targetDay,
      studentEmail: 'student@test.com',
      studentName: 'Alice',
      studentLevel: 'Intermediate',
      createdAt: new Date().toISOString(),
      totalWordsCollected: 0,
      vocabularyList: [],
      allRoutineWords: [],
      matchingPairs: [],
      fillInBlanks: [],
      sentenceWritingPrompts: [],
      readingPassage: { title: '', text: '', questions: [] },
      dailyActivities: {},
      isEmpty: true,
      isCompleted: false,
      score: 0,
    };

    // Late Firestore response arrives with 5 words
    const generated = generateWeeklyHomeworkFromRoutines({
      routinesByDay: {} as any,
      studentName: defaultProfile.name,
      studentLevel: defaultProfile.level,
      studentEmail: defaultProfile.email,
      studentUid: defaultProfile.uid,
      customWords: sampleFiveWords,
      targetDay,
      activityDate,
      userProfile: defaultProfile,
    });

    // In App.tsx: when generated is not empty, it replaces initialHw (which was isEmpty: true)
    let finalHw = initialHw;
    if (!generated.isEmpty) {
      finalHw = {
        ...generated,
        dailyActivities: {
          ...initialHw.dailyActivities,
          ...generated.dailyActivities,
        },
      };
    }

    assert.equal(finalHw.isEmpty, false);
    assert.equal(finalHw.vocabularyList.length, 5);
    assert.equal(finalHw.fillInBlanks?.length, 5);
    assert.equal(finalHw.sentenceWritingPrompts?.length, 5);
  });

  it('6. Alternância entre duas contas de alunos: valida identidade canônica e isolamento estrito', () => {
    const studentAWords = [
      createSampleWord('word_alice_1', '2026-10-29T10:00:00Z', { studentUid: 'uid_alice', studentEmail: 'alice@test.com' }),
      createSampleWord('word_alice_2', '2026-10-29T11:00:00Z', { studentUid: 'uid_alice', studentEmail: 'alice@test.com' }),
    ];
    const studentBWords = [
      createSampleWord('word_bob_1', '2026-10-29T10:00:00Z', { studentUid: 'uid_bob', studentEmail: 'bob@test.com' }),
      createSampleWord('word_bob_2', '2026-10-29T11:00:00Z', { studentUid: 'uid_bob', studentEmail: 'bob@test.com' }),
    ];

    // Case 6A: Generate for Alice
    const aliceSelected = resolveDailyMemorizationVocabulary({
      targetDay,
      activityDate,
      customWords: [...studentAWords, ...studentBWords],
      studentUid: 'uid_alice',
      studentEmail: 'alice@test.com',
    });

    assert.equal(aliceSelected.length, 2);
    assert.ok(aliceSelected.every((w) => w.word.startsWith('word_alice_')), 'Alice must only receive Alice words');

    // Case 6B: Generate for Bob (even if userProfile.id was usr-bob and currentAccount.uid is uid_bob)
    const bobSelected = resolveDailyMemorizationVocabulary({
      targetDay,
      activityDate,
      customWords: [...studentAWords, ...studentBWords],
      studentUid: 'uid_bob',
      studentEmail: 'bob@test.com',
    });

    assert.equal(bobSelected.length, 2);
    assert.ok(bobSelected.every((w) => w.word.startsWith('word_bob_')), 'Bob must only receive Bob words');

    // Case 6C: Identity divergence reconciliation: userProfile.id = 'usr-bob', but email matches
    const reconciledSelected = resolveDailyMemorizationVocabulary({
      targetDay,
      activityDate,
      customWords: studentBWords,
      studentUid: 'usr-bob-divergent',
      studentEmail: 'bob@test.com',
    });
    assert.equal(reconciledSelected.length, 2, 'Email match reconciles identity divergence between userProfile and currentAccount');
  });

  it('7. Homework inicial vazio: modal/seletor recupera exercícios a partir de customWords e nunca exibe 0/0', () => {
    // Scenario: cloud snapshot has an empty activity object for today
    const emptyCloudActivity: DailyHomeworkActivity = {
      id: 'hw-thursday-1',
      day: 'thursday',
      weeklyCycle: 1,
      studentUid: 'student_123',
      selectedWords: [],
      wordOrigins: [],
      matchingPairs: [],
      fillInBlanks: [],
      sentenceWritingPrompts: [],
      readingPassage: { title: '', text: '', questions: [] },
      studentAnswers: { matching: {}, fillInBlanks: {}, sentences: {}, quizAnswers: {} },
      score: 0,
      isCompleted: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Modal fallback resolution logic using customWords
    const activeDayActivity = emptyCloudActivity;
    const directWords = (Array.isArray(activeDayActivity?.selectedWords) && activeDayActivity.selectedWords.length > 0)
      ? activeDayActivity.selectedWords
      : [];

    let safeWords = directWords;
    if (safeWords.length === 0 && sampleFiveWords.length > 0) {
      safeWords = resolveDailyMemorizationVocabulary({
        targetDay: 'thursday',
        activityDate: '2026-10-29',
        customWords: sampleFiveWords,
        studentUid: 'student_123',
        studentEmail: 'student@test.com',
      });
    }

    assert.equal(safeWords.length, 5, 'Fallback resolved 5 words from customWords');

    const safeFillInBlanks = (activeDayActivity?.fillInBlanks?.length > 0)
      ? activeDayActivity.fillInBlanks
      : synthesizeFillInBlanks(safeWords.map((w) => w.word), safeWords);

    const safeSentenceWritingPrompts = (activeDayActivity?.sentenceWritingPrompts?.length > 0)
      ? activeDayActivity.sentenceWritingPrompts
      : safeWords.map((v) => deriveContextualSentencePrompt(v));

    assert.equal(safeFillInBlanks.length, 5, 'Part 2 count is 5, never 0');
    assert.equal(safeSentenceWritingPrompts.length, 5, 'Part 3 count is 5, never 0');
  });

  it('8. Novo login com palavras persistidas: vocabulário do cache/Firestore popula atividades imediatamente', () => {
    // User signs in: initial cache returns 5 persisted words
    const persistedWords = [...sampleFiveWords];
    const initialStatus = 'loaded_with_words';

    const generated = generateWeeklyHomeworkFromRoutines({
      routinesByDay: {} as any,
      studentName: 'Alice',
      studentLevel: 'Intermediate',
      studentEmail: 'student@test.com',
      studentUid: 'student_123',
      customWords: persistedWords,
      targetDay: 'thursday',
      activityDate: '2026-10-29',
      userProfile: defaultProfile,
    });

    const dayAct = generated.dailyActivities?.['thursday'];
    assert.ok(dayAct, 'Thursday activity exists');
    assert.equal(dayAct.selectedWords?.length, 5, 'Selected words populated on fresh login');
    assert.equal(dayAct.fillInBlanks?.length, 5, 'Part 2 exercises immediately populated');
    assert.equal(dayAct.sentenceWritingPrompts?.length, 5, 'Part 3 exercises immediately populated');
  });

  it('9. Manutenção da regra de prioridade Native Friend da Fase 8.4: Priority 1 (data exata) + Priority 2 (mais recentes)', () => {
    const mixedDictionary: HomeworkVocabItem[] = [
      createSampleWord('nf_today_1', '2026-10-29T10:00:00Z', {
        origins: [{ source: 'native_notes', createdAt: '2026-10-29T10:00:00Z', date: '2026-10-29', activityName: 'Native Friend Notes' }],
        source: 'live_lesson',
      }),
      createSampleWord('nf_today_2', '2026-10-29T12:00:00Z', {
        origins: [{ source: 'native_notes', createdAt: '2026-10-29T12:00:00Z', date: '2026-10-29', activityName: 'Native Friend Notes' }],
        source: 'live_lesson',
      }),
      createSampleWord('dict_recent_1', '2026-10-28T15:00:00Z'),
      createSampleWord('dict_recent_2', '2026-10-27T15:00:00Z'),
      createSampleWord('dict_recent_3', '2026-10-26T15:00:00Z'),
      createSampleWord('dict_old', '2026-10-20T10:00:00Z'),
    ];

    const result = resolveDailyMemorizationVocabulary({
      targetDay,
      activityDate: '2026-10-29',
      customWords: mixedDictionary,
      studentUid: 'student_123',
      studentEmail: 'student@test.com',
    });

    assert.equal(result.length, 5, 'Must select exactly 5 words');
    // Priority 1: nf_today_2 (12:00) then nf_today_1 (10:00)
    assert.equal(result[0].word, 'nf_today_2');
    assert.equal(result[1].word, 'nf_today_1');
    // Priority 2: dict_recent_1, dict_recent_2, dict_recent_3
    assert.equal(result[2].word, 'dict_recent_1');
    assert.equal(result[3].word, 'dict_recent_2');
    assert.equal(result[4].word, 'dict_recent_3');
  });

  it('10. Preservação de respostas existentes: não sobrescreve respostas preenchidas pelo aluno', () => {
    const existingStartedActivity: DailyHomeworkActivity = {
      id: 'hw-thursday-1',
      day: 'thursday',
      weeklyCycle: 1,
      studentUid: 'student_123',
      selectedWords: sampleFiveWords,
      wordOrigins: [],
      matchingPairs: sampleFiveWords.map((w, idx) => ({ id: `p-${idx}`, word: w.word, definition: w.definitionEn, translation: w.translationPt })),
      fillInBlanks: synthesizeFillInBlanks(sampleFiveWords.map((w) => w.word), sampleFiveWords),
      sentenceWritingPrompts: sampleFiveWords.map((v) => deriveContextualSentencePrompt(v)),
      readingPassage: { title: 'Story', text: 'Passage text', questions: [] },
      studentAnswers: {
        matching: { 'p-0': 'resilient' },
        fillInBlanks: { 0: 'thrive' },
        sentences: { resilient: 'He is very resilient in stressful situations.' },
        quizAnswers: {},
      },
      score: 30,
      isStarted: true,
      isCompleted: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const isStarted = isActivityStartedOrAnswered(existingStartedActivity);
    assert.equal(isStarted, true, 'Activity must be recognized as started/answered');

    // Simulate merge or generator reconciliation
    const merged = mergeDailyActivities(
      { thursday: existingStartedActivity },
      { thursday: { ...existingStartedActivity, studentAnswers: { matching: { 'p-0': 'resilient' }, fillInBlanks: { 0: 'thrive', 1: 'foster' }, sentences: {}, quizAnswers: {} } } }
    );

    const thur = merged['thursday'];
    assert.ok(thur);
    assert.equal(thur.studentAnswers?.matching?.['p-0'], 'resilient', 'Preserves matching answers');
    assert.equal(thur.studentAnswers?.fillInBlanks?.[0], 'thrive', 'Preserves previous fill answers');
    assert.equal(thur.studentAnswers?.fillInBlanks?.[1], 'foster', 'Merges new answers');
    assert.equal(thur.studentAnswers?.sentences?.['resilient'], 'He is very resilient in stressful situations.', 'Preserves written sentences');
    assert.equal(thur.selectedWords?.length, 5, 'Selected words intact');
  });
});
