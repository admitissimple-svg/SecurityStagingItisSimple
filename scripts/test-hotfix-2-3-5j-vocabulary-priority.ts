import {
  resolveDailyMemorizationVocabulary,
  isActivityStartedOrAnswered,
  generateWeeklyHomework,
  generateWeeklyHomeworkFromRoutines,
  getDailyMemorizationSchedule,
} from '../src/utils/homeworkGenerator';
import {
  DailyHomeworkActivity,
  DayOfWeek,
  HomeworkVocabItem,
  LiveLesson,
  RoutineItem,
  WeeklyHomeworkData,
} from '../src/types';

console.log('================================================================');
console.log('--- TEST SUITE: HOTFIX 2.3.5J — DAILY MEMORIZATION VOCABULARY PRIORITY ---');
console.log('================================================================');

let passedTests = 0;
let totalTests = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  totalTests++;
  if (condition) {
    console.log(`[PASS] Test ${totalTests}: ${testName}`);
    passedTests++;
  } else {
    console.error(`[FAIL] Test ${totalTests}: ${testName}`);
    if (detail) console.error(`       Detail: ${detail}`);
    process.exitCode = 1;
  }
}

function normalizeWords(list: Array<{ word: string } | string>): string[] {
  return list.map((item) => (typeof item === 'string' ? item : item.word).toLowerCase().trim());
}

async function runAllTests() {
  // ---------------------------------------------------------------------------
  // Test 1: Sexta-feira: aluno salva 5 palavras e abre P1 → aparecem as 5 palavras de sexta, não as anteriores
  // ---------------------------------------------------------------------------
  console.log('\n--- Scenario 1: Friday 5 Words Routine vs Previous Days ---');
  {
    const routinesByDay: Record<DayOfWeek, RoutineItem[]> = {
      monday: [
        {
          id: 'mon-1',
          dayOfWeek: 'monday',
          time: '08:00',
          activityName: 'Morning Coffee',
          learnedWords: ['coffee', 'mug', 'toast', 'pour', 'brew'],
          completed: true,
        },
      ],
      tuesday: [
        {
          id: 'tue-1',
          dayOfWeek: 'tuesday',
          time: '08:00',
          activityName: 'Quick Commute',
          learnedWords: ['subway', 'traffic', 'commute', 'ticket', 'station'],
          completed: true,
        },
      ],
      wednesday: [],
      thursday: [],
      friday: [
        {
          id: 'fri-1',
          dayOfWeek: 'friday',
          time: '09:00',
          activityName: 'Work Strategy',
          learnedWords: ['resilient', 'benchmark', 'streamline', 'leverage', 'optimize'],
          completed: false,
        },
      ],
      saturday: [],
      sunday: [],
    };

    const fridayWords = resolveDailyMemorizationVocabulary({
      targetDay: 'friday',
      routinesByDay,
      customWords: [],
      lessons: [],
      studentUid: 'student_123',
    });

    const normResult = normalizeWords(fridayWords);
    assert(
      fridayWords.length === 5,
      'Friday selects exactly 5 words',
      `Got ${fridayWords.length} words`
    );
    assert(
      normResult.includes('resilient') &&
        normResult.includes('benchmark') &&
        normResult.includes('streamline') &&
        normResult.includes('leverage') &&
        normResult.includes('optimize'),
      'Friday contains the 5 words from Friday routine, NOT Monday words',
      `Got words: ${normResult.join(', ')}`
    );
    assert(
      !normResult.includes('coffee') && !normResult.includes('subway'),
      'Friday does NOT leak words from Monday or Tuesday',
      `Got words: ${normResult.join(', ')}`
    );
  }

  // ---------------------------------------------------------------------------
  // Test 2: Sexta-feira: Native Friend registra 2 palavras e aluno registra 5 → selecionar 2 do professor + 3 do aluno
  // ---------------------------------------------------------------------------
  console.log('\n--- Scenario 2: Native Friend 2 Notes + Student 5 Words on Friday ---');
  {
    const routinesByDay: Record<DayOfWeek, RoutineItem[]> = {
      monday: [],
      tuesday: [],
      wednesday: [],
      thursday: [],
      friday: [
        {
          id: 'fri-1',
          dayOfWeek: 'friday',
          time: '09:00',
          activityName: 'Project Sync',
          learnedWords: ['deliverable', 'actionable', 'synergy', 'bandwidth', 'timeline'],
          completed: false,
        },
      ],
      saturday: [],
      sunday: [],
    };

    const lessons: LiveLesson[] = [
      {
        id: 'lesson-fri-1',
        title: 'Friday Native Friend Conversation',
        startDateTime: '2026-10-23T14:00:00Z', // Friday
        endDateTime: '2026-10-23T14:30:00Z',
        sessionDate: '2026-10-23',
        studentEmail: 'student@example.com',
        studentName: 'Alex',
        studentUid: 'student_123',
        teacherEmail: 'sarah@itissimple.com',
        teacherName: 'Sarah Jenkins',
        meetLink: 'https://meet.google.com/abc-defg-hij',
        status: 'scheduled',
        vocabularyNotes: [
          { id: 'vn-1', word: 'breakthrough', meaningOrTip: 'a sudden, dramatic, and important discovery or development' },
          { id: 'vn-2', word: 'stakeholder', meaningOrTip: 'a person with an interest or concern in something' },
        ],
      },
    ];

    const fridayWords = resolveDailyMemorizationVocabulary({
      targetDay: 'friday',
      routinesByDay,
      customWords: [],
      lessons,
      studentUid: 'student_123',
      studentEmail: 'student@example.com',
    });

    const normResult = normalizeWords(fridayWords);
    assert(fridayWords.length === 5, 'Friday selects exactly 5 words in total', `Got ${fridayWords.length}`);
    assert(
      normResult[0] === 'breakthrough' || normResult[0] === 'stakeholder',
      'Teacher words are placed first in priority',
      `Got order: ${normResult.join(', ')}`
    );
    assert(
      normResult.includes('breakthrough') && normResult.includes('stakeholder'),
      'Both 2 teacher words are present',
      `Got words: ${normResult.join(', ')}`
    );
    // Student words fill the remaining 3 slots
    const studentCountInSelection = normResult.filter((w) =>
      ['deliverable', 'actionable', 'synergy', 'bandwidth', 'timeline'].includes(w)
    ).length;
    assert(
      studentCountInSelection === 3,
      'Exactly 3 words from student routine fill the remaining slots (2 teacher + 3 student = 5)',
      `Found ${studentCountInSelection} student words`
    );
  }

  // ---------------------------------------------------------------------------
  // Test 3: Dia sem Native Friend Notes, com 5 palavras do aluno → selecionar as 5 daquele dia
  // ---------------------------------------------------------------------------
  console.log('\n--- Scenario 3: Wednesday with 0 Teacher Notes and 5 Student Words ---');
  {
    const routinesByDay: Record<DayOfWeek, RoutineItem[]> = {
      monday: [],
      tuesday: [],
      wednesday: [
        {
          id: 'wed-1',
          dayOfWeek: 'wednesday',
          time: '08:00',
          activityName: 'Midweek Review',
          learnedWords: ['collaborate', 'milestone', 'deadline', 'overview', 'summary'],
          completed: false,
        },
      ],
      thursday: [],
      friday: [],
      saturday: [],
      sunday: [],
    };

    const wedWords = resolveDailyMemorizationVocabulary({
      targetDay: 'wednesday',
      routinesByDay,
      customWords: [],
      lessons: [],
      studentUid: 'student_123',
    });

    const normResult = normalizeWords(wedWords);
    assert(wedWords.length === 5, 'Wednesday selects exactly 5 words', `Got ${wedWords.length}`);
    assert(
      normResult.includes('collaborate') &&
        normResult.includes('milestone') &&
        normResult.includes('deadline') &&
        normResult.includes('overview') &&
        normResult.includes('summary'),
      'All 5 student words from Wednesday are selected',
      `Got: ${normResult.join(', ')}`
    );
  }

  // ---------------------------------------------------------------------------
  // Test 4: Dia com apenas 2 palavras do aluno e nenhuma do professor → completar com as 3 históricas mais recentes
  // ---------------------------------------------------------------------------
  console.log('\n--- Scenario 4: Tuesday with 2 Student Words + 3 Historical Dictionary Words ---');
  {
    const routinesByDay: Record<DayOfWeek, RoutineItem[]> = {
      monday: [],
      tuesday: [
        {
          id: 'tue-1',
          dayOfWeek: 'tuesday',
          time: '08:00',
          activityName: 'Brief Planning',
          learnedWords: ['meeting', 'agenda'],
          completed: false,
        },
      ],
      wednesday: [],
      thursday: [],
      friday: [],
      saturday: [],
      sunday: [],
    };

    const historicalDictionary = [
      { word: 'strategy', learnedAt: '2026-10-10T10:00:00Z', studentUid: 'student_123' },
      { word: 'budget', learnedAt: '2026-10-18T10:00:00Z', studentUid: 'student_123' },
      { word: 'workflow', learnedAt: '2026-10-15T10:00:00Z', studentUid: 'student_123' },
      { word: 'feedback', learnedAt: '2026-10-22T10:00:00Z', studentUid: 'student_123' }, // newest historical
      { word: 'proposal', learnedAt: '2026-10-21T10:00:00Z', studentUid: 'student_123' }, // 2nd newest
      { word: 'roadmap', learnedAt: '2026-10-20T10:00:00Z', studentUid: 'student_123' },  // 3rd newest
    ];

    const tueWords = resolveDailyMemorizationVocabulary({
      targetDay: 'tuesday',
      routinesByDay,
      customWords: historicalDictionary as any,
      lessons: [],
      studentUid: 'student_123',
    });

    const normResult = normalizeWords(tueWords);
    assert(tueWords.length === 5, 'Tuesday selects exactly 5 words (2 today + 3 historical)', `Got ${tueWords.length}`);
    assert(
      normResult.includes('meeting') && normResult.includes('agenda'),
      'Tuesday includes the 2 words of today',
      `Got: ${normResult.join(', ')}`
    );
    assert(
      normResult.includes('feedback') && normResult.includes('proposal') && normResult.includes('roadmap'),
      'Tuesday completes with the 3 most recent historical dictionary words sorted descending by date',
      `Got: ${normResult.join(', ')}`
    );
  }

  // ---------------------------------------------------------------------------
  // Test 5: Dia com 5 palavras do professor → utilizar as 5 do professor
  // ---------------------------------------------------------------------------
  console.log('\n--- Scenario 5: Thursday with 5 Teacher Words ---');
  {
    const routinesByDay: Record<DayOfWeek, RoutineItem[]> = {
      monday: [],
      tuesday: [],
      wednesday: [],
      thursday: [
        {
          id: 'thu-1',
          dayOfWeek: 'thursday',
          time: '08:00',
          activityName: 'Student Routine',
          learnedWords: ['word1', 'word2', 'word3', 'word4', 'word5'],
          completed: false,
        },
      ],
      friday: [],
      saturday: [],
      sunday: [],
    };

    const lessons: LiveLesson[] = [
      {
        id: 'lesson-thu-1',
        title: 'Thursday Deep Dive',
        startDateTime: '2026-10-22T15:00:00Z', // Thursday
        endDateTime: '2026-10-22T15:30:00Z',
        sessionDate: '2026-10-22',
        studentEmail: 'student@example.com',
        studentName: 'Alex',
        studentUid: 'student_123',
        teacherEmail: 'john@itissimple.com',
        teacherName: 'John Doe',
        meetLink: 'https://meet.google.com/xyz-uvwx-rst',
        status: 'scheduled',
        vocabularyNotes: [
          { id: 'vn-1', word: 'negotiate', meaningOrTip: 'try to reach an agreement or compromise by discussion' },
          { id: 'vn-2', word: 'compromise', meaningOrTip: 'an agreement reached by mutual concession' },
          { id: 'vn-3', word: 'perspective', meaningOrTip: 'a particular attitude toward or way of regarding something' },
          { id: 'vn-4', word: 'feasible', meaningOrTip: 'possible to do easily or conveniently' },
          { id: 'vn-5', word: 'outcome', meaningOrTip: 'the way a thing turns out; a consequence' },
        ],
      },
    ];

    const thuWords = resolveDailyMemorizationVocabulary({
      targetDay: 'thursday',
      routinesByDay,
      customWords: [],
      lessons,
      studentUid: 'student_123',
      studentEmail: 'student@example.com',
    });

    const normResult = normalizeWords(thuWords);
    assert(thuWords.length === 5, 'Thursday selects 5 words', `Got ${thuWords.length}`);
    assert(
      normResult.includes('negotiate') &&
        normResult.includes('compromise') &&
        normResult.includes('perspective') &&
        normResult.includes('feasible') &&
        normResult.includes('outcome'),
      'All 5 teacher words are selected',
      `Got: ${normResult.join(', ')}`
    );
    assert(
      !normResult.includes('word1') && !normResult.includes('word2'),
      'Student words are not selected because teacher slots already filled all 5',
      `Got: ${normResult.join(', ')}`
    );
  }

  // ---------------------------------------------------------------------------
  // Test 6: Salvar palavras e abrir atividade sem F5 → refletir imediatamente os novos dados
  // ---------------------------------------------------------------------------
  console.log('\n--- Scenario 6: Immediate Reflection on Save without F5 ---');
  {
    // Step 1: Initial empty Friday routine
    const routinesStep1: Record<DayOfWeek, RoutineItem[]> = {
      monday: [],
      tuesday: [],
      wednesday: [],
      thursday: [],
      friday: [
        {
          id: 'fri-1',
          dayOfWeek: 'friday',
          time: '09:00',
          activityName: 'Friday Routine',
          learnedWords: [],
          completed: false,
        },
      ],
      saturday: [],
      sunday: [],
    };

    const initialHw = generateWeeklyHomeworkFromRoutines({
      routinesByDay: routinesStep1,
      targetDay: 'friday',
      weeklyCycle: 1,
      studentName: 'Alex',
    });

    // Activity is unstarted
    assert(
      !isActivityStartedOrAnswered(initialHw.dailyActivities?.friday),
      'Initial Friday activity is not started'
    );

    // Step 2: Student saves 5 words in Friday routine
    const routinesStep2: Record<DayOfWeek, RoutineItem[]> = {
      ...routinesStep1,
      friday: [
        {
          id: 'fri-1',
          dayOfWeek: 'friday',
          time: '09:00',
          activityName: 'Friday Routine',
          learnedWords: ['innovate', 'clarify', 'execute', 'synthesize', 'empower'],
          completed: false,
        },
      ],
    };

    // Re-generation runs (simulating React state update without F5)
    const updatedHw = generateWeeklyHomeworkFromRoutines({
      routinesByDay: routinesStep2,
      targetDay: 'friday',
      weeklyCycle: 1,
      studentName: 'Alex',
      existingDailyActivities: initialHw.dailyActivities, // unstarted existing snapshot
    });

    const updatedWords = normalizeWords(updatedHw.vocabularyList || []);
    assert(
      updatedWords.includes('innovate') &&
        updatedWords.includes('clarify') &&
        updatedWords.includes('execute') &&
        updatedWords.includes('synthesize') &&
        updatedWords.includes('empower'),
      'Unstarted activity immediately updates vocabulary to the newly saved 5 words without F5',
      `Got words: ${updatedWords.join(', ')}`
    );
  }

  // ---------------------------------------------------------------------------
  // Test 7: Atividade já respondida → não sobrescrever respostas, correções ou vocabulário
  // ---------------------------------------------------------------------------
  console.log('\n--- Scenario 7: Answered Activity Preserved Verbatim ---');
  {
    const initialWords: HomeworkVocabItem[] = [
      { word: 'apple', translationPt: 'maçã', definitionEn: 'a fruit', exampleSentence: 'I eat an apple.', sourceActivityName: 'Routine' },
      { word: 'banana', translationPt: 'banana', definitionEn: 'a fruit', exampleSentence: 'She peels a banana.', sourceActivityName: 'Routine' },
      { word: 'orange', translationPt: 'laranja', definitionEn: 'a fruit', exampleSentence: 'Fresh orange juice.', sourceActivityName: 'Routine' },
      { word: 'grape', translationPt: 'uva', definitionEn: 'a fruit', exampleSentence: 'A cluster of grapes.', sourceActivityName: 'Routine' },
      { word: 'melon', translationPt: 'melão', definitionEn: 'a fruit', exampleSentence: 'Sweet summer melon.', sourceActivityName: 'Routine' },
    ];

    const existingDaily: Record<string, DailyHomeworkActivity> = {
      friday: {
        id: 'hw-friday-1',
        day: 'friday',
        weeklyCycle: 1,
        studentUid: 'student_123',
        selectedWords: initialWords,
        wordOrigins: [],
        matchingPairs: [
          { id: 'm-1', word: 'apple', definition: 'a fruit', translation: 'maçã' },
        ],
        fillInBlanks: [],
        sentenceWritingPrompts: [],
        readingPassage: { title: '', text: '', questions: [] },
        studentAnswers: {
          matching: { 'm-1': 'a fruit' },
          fillInBlanks: {},
          sentences: {},
          quizAnswers: {},
        },
        score: 100,
        isCompleted: true,
        isStarted: true,
        createdAt: '2026-10-23T10:00:00Z',
        updatedAt: '2026-10-23T10:30:00Z',
      },
    };

    // Student subsequently changes Friday routine words
    const routinesModified: Record<DayOfWeek, RoutineItem[]> = {
      monday: [],
      tuesday: [],
      wednesday: [],
      thursday: [],
      friday: [
        {
          id: 'fri-1',
          dayOfWeek: 'friday',
          time: '09:00',
          activityName: 'Friday Routine',
          learnedWords: ['brand_new_1', 'brand_new_2', 'brand_new_3', 'brand_new_4', 'brand_new_5'],
          completed: false,
        },
      ],
      saturday: [],
      sunday: [],
    };

    const hwResult = generateWeeklyHomeworkFromRoutines({
      routinesByDay: routinesModified,
      targetDay: 'friday',
      weeklyCycle: 1,
      studentName: 'Alex',
      existingDailyActivities: existingDaily,
    });

    const resultWords = normalizeWords(hwResult.vocabularyList || []);
    assert(
      resultWords.includes('apple') && resultWords.includes('banana'),
      'Answered activity preserves its original vocabulary set',
      `Got: ${resultWords.join(', ')}`
    );
    assert(
      !resultWords.includes('brand_new_1'),
      'Answered activity does NOT get overwritten by later routine changes',
      `Got: ${resultWords.join(', ')}`
    );
    assert(
      hwResult.studentAnswers?.matching?.['m-1'] === 'a fruit',
      'Answered activity preserves student answers intact'
    );
    assert(hwResult.score === 100, 'Score is preserved intact');
    assert(hwResult.isCompleted === true, 'Completion status is preserved intact');
  }

  // ---------------------------------------------------------------------------
  // Test 8: Segunda P1 e sexta P1 → conjuntos e progresso independentes
  // ---------------------------------------------------------------------------
  console.log('\n--- Scenario 8: Monday P1 and Friday P1 Independence ---');
  {
    const routines: Record<DayOfWeek, RoutineItem[]> = {
      monday: [
        {
          id: 'mon-1',
          dayOfWeek: 'monday',
          time: '08:00',
          activityName: 'Mon Activity',
          learnedWords: ['mon_word_1', 'mon_word_2', 'mon_word_3', 'mon_word_4', 'mon_word_5'],
          completed: true,
        },
      ],
      tuesday: [],
      wednesday: [],
      thursday: [],
      friday: [
        {
          id: 'fri-1',
          dayOfWeek: 'friday',
          time: '08:00',
          activityName: 'Fri Activity',
          learnedWords: ['fri_word_1', 'fri_word_2', 'fri_word_3', 'fri_word_4', 'fri_word_5'],
          completed: false,
        },
      ],
      saturday: [],
      sunday: [],
    };

    const monSchedule = getDailyMemorizationSchedule('monday');
    const friSchedule = getDailyMemorizationSchedule('friday');
    assert(
      monSchedule.partNumber === 1 && friSchedule.partNumber === 1,
      'Both Monday and Friday are Part 1 (Matching)'
    );

    const monHw = generateWeeklyHomeworkFromRoutines({
      routinesByDay: routines,
      targetDay: 'monday',
      weeklyCycle: 1,
      studentName: 'Alex',
    });

    const friHw = generateWeeklyHomeworkFromRoutines({
      routinesByDay: routines,
      targetDay: 'friday',
      weeklyCycle: 1,
      studentName: 'Alex',
    });

    const monWords = normalizeWords(monHw.vocabularyList || []);
    const friWords = normalizeWords(friHw.vocabularyList || []);

    assert(
      monWords.every((w) => w.startsWith('mon_')),
      'Monday P1 uses Monday words',
      `Got: ${monWords.join(', ')}`
    );
    assert(
      friWords.every((w) => w.startsWith('fri_')),
      'Friday P1 uses Friday words',
      `Got: ${friWords.join(', ')}`
    );
    assert(
      !monWords.some((w) => friWords.includes(w)),
      'Monday and Friday have completely disjoint vocabulary sets'
    );
  }

  // ---------------------------------------------------------------------------
  // Test 9: F5 → restaurar corretamente o vocabulário e as respostas daquele dia
  // ---------------------------------------------------------------------------
  console.log('\n--- Scenario 9: F5 Restoration of Day Vocabulary & Answers ---');
  {
    // Snapshot as stored in Firestore users/{uid}/homework/{weekId}
    const persistedSnapshot: WeeklyHomeworkData = {
      id: 'hw-week-1',
      targetDay: 'wednesday',
      assignedPart: 3,
      assignedPartKey: 'writing',
      weekLabel: 'Quarta-feira • Semana 1',
      studentEmail: 'student@example.com',
      studentName: 'Alex',
      studentLevel: 'Intermediate',
      createdAt: '2026-10-21T10:00:00Z',
      updatedAt: '2026-10-21T10:30:00Z',
      totalWordsCollected: 5,
      vocabularyList: [
        { word: 'persevere', definitionEn: 'continue in a course of action', translationPt: 'perseverar', exampleSentence: 'She persevered in her studies.' },
        { word: 'thrive', definitionEn: 'grow or develop well', translationPt: 'prosperar', exampleSentence: 'Plants thrive in the sun.' },
        { word: 'adapt', definitionEn: 'make suitable to a new use', translationPt: 'adaptar', exampleSentence: 'We adapted to the new routine.' },
        { word: 'tackle', definitionEn: 'make determined efforts to deal with', translationPt: 'enfrentar', exampleSentence: 'He tackled the difficult problem.' },
        { word: 'flourish', definitionEn: 'grow or develop vigorously', translationPt: 'florescer', exampleSentence: 'The business flourished.' },
      ],
      matchingPairs: [],
      fillInBlanks: [],
      readingPassage: { title: '', text: '', questions: [] },
      sentenceWritingPrompts: [
        { word: 'persevere', hint: 'Write a sentence with persevere' },
      ],
      studentAnswers: {
        sentences: { persevere: 'I persevere through difficult challenges every day.' },
        matching: {},
        fillInBlanks: {},
        quizAnswers: {},
      },
      score: 95,
      isCompleted: true,
      dailyActivities: {
        wednesday: {
          id: 'hw-wednesday-1',
          day: 'wednesday',
          weeklyCycle: 1,
          studentUid: 'student_123',
          selectedWords: [
            { word: 'persevere', definitionEn: 'continue in a course of action', translationPt: 'perseverar', exampleSentence: 'She persevered in her studies.' },
            { word: 'thrive', definitionEn: 'grow or develop well', translationPt: 'prosperar', exampleSentence: 'Plants thrive in the sun.' },
            { word: 'adapt', definitionEn: 'make suitable to a new use', translationPt: 'adaptar', exampleSentence: 'We adapted to the new routine.' },
            { word: 'tackle', definitionEn: 'make determined efforts to deal with', translationPt: 'enfrentar', exampleSentence: 'He tackled the difficult problem.' },
            { word: 'flourish', definitionEn: 'grow or develop vigorously', translationPt: 'florescer', exampleSentence: 'The business flourished.' },
          ],
          wordOrigins: [],
          matchingPairs: [],
          fillInBlanks: [],
          sentenceWritingPrompts: [
            { word: 'persevere', hint: 'Write a sentence with persevere' },
          ],
          readingPassage: { title: '', text: '', questions: [] },
          studentAnswers: {
            sentences: { persevere: 'I persevere through difficult challenges every day.' },
            matching: {},
            fillInBlanks: {},
            quizAnswers: {},
          },
          score: 95,
          isCompleted: true,
          isStarted: true,
          createdAt: '2026-10-21T10:00:00Z',
          updatedAt: '2026-10-21T10:30:00Z',
        },
      },
    };

    // Simulate F5 page reload: generateWeeklyHomework receives existingDailyActivities
    const restored = generateWeeklyHomework(
      {} as any,
      undefined,
      'student@example.com',
      'Alex',
      [],
      'Intermediate',
      'wednesday',
      undefined,
      persistedSnapshot.dailyActivities
    );

    const restoredWords = normalizeWords(restored.vocabularyList || []);
    assert(
      restoredWords.includes('persevere') && restoredWords.includes('thrive'),
      'F5 restored original words for Wednesday',
      `Got: ${restoredWords.join(', ')}`
    );
    assert(
      restored.studentAnswers?.sentences?.['persevere'] === 'I persevere through difficult challenges every day.',
      'F5 restored student sentence answer intact'
    );
    assert(restored.score === 95, 'F5 restored score intact');
    assert(restored.isCompleted === true, 'F5 restored completion status intact');
  }

  // ---------------------------------------------------------------------------
  // Test 10: Validar as mesmas regras em P1, P2, P3 e P4
  // ---------------------------------------------------------------------------
  console.log('\n--- Scenario 10: Validation of Rules across P1, P2, P3, and P4 ---');
  {
    const testRoutines: Record<DayOfWeek, RoutineItem[]> = {
      monday: [
        {
          id: 'mon-1',
          dayOfWeek: 'monday',
          time: '08:00',
          activityName: 'Mon Act',
          learnedWords: ['p1_w1', 'p1_w2', 'p1_w3', 'p1_w4', 'p1_w5'],
          completed: false,
        },
      ],
      tuesday: [
        {
          id: 'tue-1',
          dayOfWeek: 'tuesday',
          time: '08:00',
          activityName: 'Tue Act',
          learnedWords: ['p2_w1', 'p2_w2', 'p2_w3', 'p2_w4', 'p2_w5'],
          completed: false,
        },
      ],
      wednesday: [
        {
          id: 'wed-1',
          dayOfWeek: 'wednesday',
          time: '08:00',
          activityName: 'Wed Act',
          learnedWords: ['p3_w1', 'p3_w2', 'p3_w3', 'p3_w4', 'p3_w5'],
          completed: false,
        },
      ],
      thursday: [
        {
          id: 'thu-1',
          dayOfWeek: 'thursday',
          time: '08:00',
          activityName: 'Thu Act',
          learnedWords: ['p4_w1', 'p4_w2', 'p4_w3', 'p4_w4', 'p4_w5'],
          completed: false,
        },
      ],
      friday: [],
      saturday: [],
      sunday: [],
    };

    // P1 — Matching (Monday)
    const p1Hw = generateWeeklyHomeworkFromRoutines({
      routinesByDay: testRoutines,
      targetDay: 'monday',
      weeklyCycle: 1,
      studentName: 'Alex',
    });
    const p1Words = normalizeWords(p1Hw.vocabularyList || []);
    assert(
      p1Words.every((w) => w.startsWith('p1_')),
      'P1 (Monday Matching) uses Monday words',
      `Got: ${p1Words.join(', ')}`
    );
    assert(
      Boolean(p1Hw.matchingPairs && p1Hw.matchingPairs.length === 5),
      'P1 generated matching pairs for all 5 words'
    );

    // P2 — Fill in the Blanks (Tuesday)
    const p2Hw = generateWeeklyHomeworkFromRoutines({
      routinesByDay: testRoutines,
      targetDay: 'tuesday',
      weeklyCycle: 1,
      studentName: 'Alex',
    });
    const p2Words = normalizeWords(p2Hw.vocabularyList || []);
    assert(
      p2Words.every((w) => w.startsWith('p2_')),
      'P2 (Tuesday Fill in the Blanks) uses Tuesday words',
      `Got: ${p2Words.join(', ')}`
    );
    assert(
      Boolean(p2Hw.fillInBlanks && p2Hw.fillInBlanks.length === 5),
      'P2 generated fill-in-blanks items for all 5 words'
    );

    // P3 — Sentence Writing (Wednesday)
    const p3Hw = generateWeeklyHomeworkFromRoutines({
      routinesByDay: testRoutines,
      targetDay: 'wednesday',
      weeklyCycle: 1,
      studentName: 'Alex',
    });
    const p3Words = normalizeWords(p3Hw.vocabularyList || []);
    assert(
      p3Words.every((w) => w.startsWith('p3_')),
      'P3 (Wednesday Sentence Writing) uses Wednesday words',
      `Got: ${p3Words.join(', ')}`
    );
    assert(
      Boolean(p3Hw.sentenceWritingPrompts && p3Hw.sentenceWritingPrompts.length === 5),
      'P3 generated sentence writing prompts for all 5 words'
    );

    // P4 — Mini-Story (Thursday)
    const p4Hw = generateWeeklyHomeworkFromRoutines({
      routinesByDay: testRoutines,
      targetDay: 'thursday',
      weeklyCycle: 1,
      studentName: 'Alex',
    });
    const p4Words = normalizeWords(p4Hw.vocabularyList || []);
    assert(
      p4Words.every((w) => w.startsWith('p4_')),
      'P4 (Thursday Mini-Story) uses Thursday words',
      `Got: ${p4Words.join(', ')}`
    );
    assert(
      Boolean(p4Hw.readingPassage && p4Hw.readingPassage.text),
      'P4 generated integrated reading passage containing Thursday words'
    );
  }

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  console.log('\n================================================================');
  console.log(`--- TEST RESULTS: ${passedTests} / ${totalTests} PASSED ---`);
  console.log('================================================================\n');

  if (passedTests === totalTests) {
    console.log('🎉 ALL 10 MANDATORY TEST SCENARIOS PASSED WITH 100% SUCCESS!');
  } else {
    console.error('⚠️ SOME TESTS FAILED.');
    process.exit(1);
  }
}

runAllTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
