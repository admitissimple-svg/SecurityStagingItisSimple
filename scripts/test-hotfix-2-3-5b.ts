import {
  buildDailyVocabularyQueueForDay,
  generateWeeklyHomework,
  generateWeeklyHomeworkFromRoutines,
} from '../src/utils/homeworkGenerator';
import { executeStartNewWeek } from '../src/utils/StartNewWeekHandler';
import {
  saveStudentVocabularyToFirestore,
  getCachedLocalVocabulary,
  mergeHomeworkRecords,
  saveStudentHomeworkProgressToFirestore,
} from '../src/utils/studentPersistence';
import {
  HomeworkVocabItem,
  DailyHomeworkActivity,
  WeeklyHomeworkData,
  DayOfWeek,
  RoutineItem,
} from '../src/types';
import { defaultRoutinesByDay } from '../src/data/defaultRoutines';
import firebaseConfig from '../firebase-applet-config.json';

console.log('====================================================');
console.log('--- RUNNING TEST SUITE FOR HOTFIX 2.3.5B ---');
console.log('====================================================');

// Mock relative fetch in Node environment
const originalFetch = globalThis.fetch;
if (typeof globalThis.fetch === 'function') {
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof input === 'string' && input.startsWith('/api/')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, videos: [], routines: {} }),
        text: async () => JSON.stringify({ success: true }),
      } as any;
    }
    try {
      return await originalFetch(input, init);
    } catch {
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
        text: async () => JSON.stringify({ success: true }),
      } as any;
    }
  };
}

let passedTests = 0;
let totalTests = 0;

function assert(condition: boolean, message: string) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`[PASS] ${message}`);
  } else {
    console.error(`[FAIL] ${message}`);
    process.exitCode = 1;
  }
}

async function runTests() {
  // -------------------------------------------------------------
  // TEST 1: Start a New Week clears the active 5 Key Words panel to 0/5
  // -------------------------------------------------------------
  console.log('\n--- Test 1: Start a New Week resets the panel to 0/5 ---');
  const studentUid = 'test-student-hotfix-235b';
  const studentEmail = 'student235b@example.com';

  const mockOutgoingRoutines: Record<DayOfWeek, RoutineItem[]> = JSON.parse(
    JSON.stringify(defaultRoutinesByDay)
  );
  // Add 5 words to Monday and 3 words to Tuesday
  mockOutgoingRoutines.monday[0].learnedWords = [
    'breakthrough',
    'resilience',
    'clarity',
    'endeavor',
    'milestone',
  ];
  mockOutgoingRoutines.tuesday[0].learnedWords = ['collaborate', 'feedback', 'streamline'];

  const startNewWeekResult = await executeStartNewWeek({
    studentUid,
    studentEmail,
    weeklyStudyDaysTarget: 5,
    weeklyStudyDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
    currentCycle: 1,
    studentLevel: 'intermediate',
    currentRoutines: mockOutgoingRoutines,
  });

  assert(startNewWeekResult !== null && startNewWeekResult.success === true, 'executeStartNewWeek succeeds');
  assert(startNewWeekResult?.weeklyCycle === 2, 'weeklyCycle increments to 2');

  // Verify all days in the new week have empty learnedWords
  const routinesObj = startNewWeekResult!.routines as Record<DayOfWeek, RoutineItem[]>;
  const allDaysEmpty = (Object.keys(routinesObj) as DayOfWeek[]).every((day) => {
    const acts: RoutineItem[] = routinesObj[day] || [];
    return acts.every((act: RoutineItem) => !act.learnedWords || act.learnedWords.length === 0);
  });
  assert(allDaysEmpty === true, 'All routine activities across all days in the new week have learnedWords: [] (0/5 recorded)');

  // -------------------------------------------------------------
  // TEST 2: Previous words remain in My Dictionary with rich metadata
  // -------------------------------------------------------------
  console.log('\n--- Test 2: Outgoing words are safely preserved in My Dictionary ---');
  const cachedDict = getCachedLocalVocabulary(studentUid, studentEmail);
  const preservedWords = cachedDict.map((e) => e.word.toLowerCase());

  assert(preservedWords.includes('breakthrough'), 'My Dictionary preserves "breakthrough"');
  assert(preservedWords.includes('resilience'), 'My Dictionary preserves "resilience"');
  assert(preservedWords.includes('clarity'), 'My Dictionary preserves "clarity"');
  assert(preservedWords.includes('endeavor'), 'My Dictionary preserves "endeavor"');
  assert(preservedWords.includes('milestone'), 'My Dictionary preserves "milestone"');
  assert(preservedWords.includes('collaborate'), 'My Dictionary preserves "collaborate"');
  assert(preservedWords.includes('feedback'), 'My Dictionary preserves "feedback"');
  assert(preservedWords.includes('streamline'), 'My Dictionary preserves "streamline"');

  const breakthroughEntry = cachedDict.find((e) => e.word.toLowerCase() === 'breakthrough');
  assert(Boolean(breakthroughEntry && breakthroughEntry.learnedAt), '"breakthrough" has valid learnedAt timestamp');
  assert(Boolean(breakthroughEntry && breakthroughEntry.cefrLevel), '"breakthrough" has valid CEFR level');

  // -------------------------------------------------------------
  // TEST 3: F5 does not restore old words to the panel in the new week
  // -------------------------------------------------------------
  console.log('\n--- Test 3: Reload / fresh mount does not resurrect old words in panel ---');
  // When fresh routines are fetched for the new week, act.learnedWords remains []
  const newWeekRoutines = startNewWeekResult!.routines;
  const mondayActs = newWeekRoutines.monday;
  const mondayActiveWords = (mondayActs[0]?.learnedWords || []).filter((w) => w.trim().length > 0);
  assert(mondayActiveWords.length === 0, 'New week Monday active words count is 0 (0/5, not 5/5 from week 1)');

  // -------------------------------------------------------------
  // TEST 4: The queue uses the student\'s latest real words even when not visible in panel
  // -------------------------------------------------------------
  console.log('\n--- Test 4: Queue queries chronological history rather than visual panel ---');
  // Panel is currently 0/5 in new week.
  // Student has chronological words in My Dictionary with real timestamps.
  const candidatesHistorical: HomeworkVocabItem[] = [
    {
      word: 'word_old',
      definitionEn: 'Old def',
      translationPt: 'Velho',
      exampleSentence: 'Old ex',
      source: 'routine',
      learnedAt: '2026-10-10T10:00:00Z',
    },
    {
      word: 'word_recent_1',
      definitionEn: 'Recent 1',
      translationPt: 'Recente 1',
      exampleSentence: 'Rec 1 ex',
      source: 'routine',
      learnedAt: '2026-10-22T08:00:00Z',
    },
    {
      word: 'word_recent_2',
      definitionEn: 'Recent 2',
      translationPt: 'Recente 2',
      exampleSentence: 'Rec 2 ex',
      source: 'routine',
      learnedAt: '2026-10-22T09:00:00Z',
    },
    {
      word: 'word_recent_3',
      definitionEn: 'Recent 3',
      translationPt: 'Recente 3',
      exampleSentence: 'Rec 3 ex',
      source: 'routine',
      learnedAt: '2026-10-22T10:00:00Z',
    },
    {
      word: 'word_recent_4',
      definitionEn: 'Recent 4',
      translationPt: 'Recente 4',
      exampleSentence: 'Rec 4 ex',
      source: 'routine',
      learnedAt: '2026-10-22T11:00:00Z',
    },
    {
      word: 'word_recent_5',
      definitionEn: 'Recent 5',
      translationPt: 'Recente 5',
      exampleSentence: 'Rec 5 ex',
      source: 'routine',
      learnedAt: '2026-10-22T12:00:00Z',
    },
  ];

  const queueFromHistory = buildDailyVocabularyQueueForDay('monday', candidatesHistorical);
  assert(queueFromHistory.length === 5, 'Queue has 5 words from history');
  assert(
    queueFromHistory[0].word === 'word_recent_5' &&
    queueFromHistory[1].word === 'word_recent_4' &&
    queueFromHistory[2].word === 'word_recent_3' &&
    queueFromHistory[3].word === 'word_recent_2' &&
    queueFromHistory[4].word === 'word_recent_1',
    'Queue strictly selects the 5 most recent student words in descending chronological order'
  );
  assert(
    !queueFromHistory.some((w) => w.word === 'word_old'),
    'Older word "word_old" was excluded by the 5-item recency limit'
  );

  // -------------------------------------------------------------
  // TEST 5: 2 Native Friend words + 3 recent student words produce the exact queue
  // -------------------------------------------------------------
  console.log('\n--- Test 5: 2 Native Friend words + 3 recent student words ---');
  const candidatesCombination: HomeworkVocabItem[] = [
    // Native Friend notes on Wednesday
    {
      word: 'articulate',
      definitionEn: 'Express fluently and coherently',
      translationPt: 'Articular com clareza',
      exampleSentence: 'She articulates complex ideas well.',
      source: 'live_lesson',
      sourceDay: 'wednesday',
      learnedAt: '2026-10-22T14:30:00Z',
    },
    {
      word: 'nuance',
      definitionEn: 'A subtle distinction or shade of meaning',
      translationPt: 'Nuance / Sutileza',
      exampleSentence: 'Pay attention to cultural nuance.',
      source: 'live_lesson',
      sourceDay: 'wednesday',
      learnedAt: '2026-10-22T14:35:00Z',
    },
    // Student's recent words (A, B, C are most recent, D is older)
    {
      word: 'Word_A',
      definitionEn: 'Def A',
      translationPt: 'Trad A',
      exampleSentence: 'Ex A',
      source: 'routine',
      learnedAt: '2026-10-22T13:00:00Z',
    },
    {
      word: 'Word_B',
      definitionEn: 'Def B',
      translationPt: 'Trad B',
      exampleSentence: 'Ex B',
      source: 'routine',
      learnedAt: '2026-10-22T12:00:00Z',
    },
    {
      word: 'Word_C',
      definitionEn: 'Def C',
      translationPt: 'Trad C',
      exampleSentence: 'Ex C',
      source: 'routine',
      learnedAt: '2026-10-22T11:00:00Z',
    },
    {
      word: 'Word_D_older',
      definitionEn: 'Def D',
      translationPt: 'Trad D',
      exampleSentence: 'Ex D',
      source: 'routine',
      learnedAt: '2026-10-21T09:00:00Z',
    },
  ];

  const queueCombined = buildDailyVocabularyQueueForDay('wednesday', candidatesCombination);
  assert(queueCombined.length === 5, 'Combined queue has exactly 5 words');

  const nfWords = queueCombined.filter((w) => w.origin === 'native_friend');
  const studentSelectedWords = queueCombined.filter((w) => w.origin === 'student_5words');

  assert(nfWords.length === 2, 'Queue has 2 Native Friend words');
  assert(studentSelectedWords.length === 3, 'Queue has 3 student words');
  assert(
    studentSelectedWords.map((w) => w.word).join(',') === 'Word_A,Word_B,Word_C',
    'Student words in queue are strictly the 3 most recent: Word_A, Word_B, Word_C'
  );
  assert(
    !queueCombined.some((w) => w.word === 'Word_D_older'),
    'Older word Word_D_older was correctly not selected'
  );

  // -------------------------------------------------------------
  // TEST 6: The queue eliminates duplicates without inventing words
  // -------------------------------------------------------------
  console.log('\n--- Test 6: Deduplication without synthetic filler ---');
  const duplicateCandidates: HomeworkVocabItem[] = [
    {
      word: 'Fluency',
      definitionEn: 'Ability to speak smoothly',
      translationPt: 'Fluência',
      exampleSentence: 'Fluency takes practice.',
      source: 'live_lesson',
      sourceDay: 'thursday',
      learnedAt: '2026-10-22T15:00:00Z',
    },
    {
      word: 'fluency', // duplicate
      definitionEn: 'Ability to speak smoothly',
      translationPt: 'Fluência',
      exampleSentence: 'Fluency takes practice.',
      source: 'routine',
      learnedAt: '2026-10-22T12:00:00Z',
    },
    {
      word: 'Accuracy',
      definitionEn: 'Being correct or precise',
      translationPt: 'Precisão',
      exampleSentence: 'Accuracy in pronunciation matters.',
      source: 'routine',
      learnedAt: '2026-10-22T11:00:00Z',
    },
  ];

  const queueDedup = buildDailyVocabularyQueueForDay('thursday', duplicateCandidates);
  assert(queueDedup.length === 2, 'Queue contains exactly the 2 legitimate words (no duplicates, no fake filler)');
  assert(queueDedup[0].word.toLowerCase() === 'fluency' && queueDedup[0].origin === 'native_friend', 'Native Friend origin is preferred for the deduplicated word');
  assert(queueDedup[1].word.toLowerCase() === 'accuracy', 'Second word is accuracy');

  // -------------------------------------------------------------
  // TEST 7: A new day uses the updated queue
  // -------------------------------------------------------------
  console.log('\n--- Test 7: A new unstarted day computes the updated queue ---');
  const candidatesDays: HomeworkVocabItem[] = [
    { word: 'friday_term', source: 'live_lesson', sourceDay: 'friday', learnedAt: '2026-10-24T10:00:00Z', definitionEn: 'Friday term', translationPt: 'Termo de sexta', exampleSentence: 'Friday sentence' },
    { word: 'thursday_term', source: 'live_lesson', sourceDay: 'thursday', learnedAt: '2026-10-23T10:00:00Z', definitionEn: 'Thursday term', translationPt: 'Termo de quinta', exampleSentence: 'Thursday sentence' },
    { word: 'general_student_1', source: 'routine', learnedAt: '2026-10-22T10:00:00Z', definitionEn: 'Gen 1', translationPt: 'Gen 1', exampleSentence: 'Gen 1 sentence' },
    { word: 'general_student_2', source: 'routine', learnedAt: '2026-10-21T10:00:00Z', definitionEn: 'Gen 2', translationPt: 'Gen 2', exampleSentence: 'Gen 2 sentence' },
  ];

  const fridayQueue = buildDailyVocabularyQueueForDay('friday', candidatesDays);
  assert(fridayQueue.some((w) => w.word === 'friday_term'), 'Friday queue prioritizes friday_term');
  assert(!fridayQueue.slice(0, 1).some((w) => w.word === 'thursday_term'), 'Friday queue does not place thursday_term ahead of friday_term');

  // -------------------------------------------------------------
  // TEST 8: An already initiated day maintains its original snapshot
  // -------------------------------------------------------------
  console.log('\n--- Test 8: Initiated day preserves verbatim snapshot ---');
  const existingMondaySnapshot: DailyHomeworkActivity = {
    id: 'hw-monday-2',
    day: 'monday',
    weeklyCycle: 2,
    studentUid,
    selectedWords: [
      { word: 'snapshot_word_1', definitionEn: 'Snap 1', translationPt: 'Snap 1', exampleSentence: 'Snap 1 ex' },
      { word: 'snapshot_word_2', definitionEn: 'Snap 2', translationPt: 'Snap 2', exampleSentence: 'Snap 2 ex' },
    ],
    matchingPairs: [
      { id: 'm-snap1', word: 'snapshot_word_1', definition: 'Snap 1', translation: 'Snap 1' },
    ],
    fillInBlanks: [],
    sentenceWritingPrompts: [],
    readingPassage: { title: 'Story', text: 'Text', questions: [] },
    wordOrigins: [],
    studentAnswers: {
      matching: { 'm-snap1': 'Snap 1' },
    },
    isStarted: true,
    isCompleted: false,
    score: 10,
    createdAt: '2026-10-22T08:00:00Z',
    updatedAt: '2026-10-22T08:15:00Z',
  };

  const homeworkWithExisting = generateWeeklyHomework(
    mockOutgoingRoutines,
    { uid: studentUid, email: studentEmail, weeklyCycle: 2 } as any,
    studentEmail,
    'Student',
    candidatesHistorical,
    'intermediate',
    'monday',
    undefined,
    { monday: existingMondaySnapshot }
  );

  assert(homeworkWithExisting.vocabularyList.length === 2, 'Initiated Monday activity keeps its 2 snapshot words');
  assert(homeworkWithExisting.vocabularyList[0].word === 'snapshot_word_1', 'Snapshot word 1 preserved verbatim');
  assert(homeworkWithExisting.studentAnswers?.matching?.['m-snap1'] === 'Snap 1', 'Student answer preserved verbatim');

  // -------------------------------------------------------------
  // TEST 9: No prior answers or evaluations are lost across merges
  // -------------------------------------------------------------
  console.log('\n--- Test 9: Merging homework records does not lose answers or evaluations ---');
  const recordA: Partial<WeeklyHomeworkData> = {
    weeklyCycle: 2,
    isCompleted: true,
    score: 95,
    aiEvaluation: {
      score: 95,
      feedback: 'Excellent work!',
      evaluatedAt: '2026-10-22T09:00:00Z',
    } as any,
    studentAnswers: {
      sentences: { 'word_a': 'I used word_a successfully.' },
    },
    dailyActivities: {
      monday: existingMondaySnapshot,
    },
  };

  const recordB: Partial<WeeklyHomeworkData> = {
    weeklyCycle: 2,
    completedPartsByDay: { monday: true },
  };

  const mergedHw = mergeHomeworkRecords(recordB, recordA);
  assert(mergedHw.aiEvaluation?.score === 95, 'AI evaluation score 95 preserved');
  assert(mergedHw.studentAnswers?.sentences?.['word_a'] === 'I used word_a successfully.', 'Sentence answer preserved');
  assert(mergedHw.dailyActivities?.monday?.isStarted === true, 'Monday dailyActivity preserved');

  // -------------------------------------------------------------
  // TEST 10: Memorization S-Path completion remains intact
  // -------------------------------------------------------------
  console.log('\n--- Test 10: S-Path completion flag remains intact ---');
  assert(mergedHw.completedPartsByDay?.monday === true, 'completedPartsByDay.monday is preserved as true');

  // -------------------------------------------------------------
  // TEST 11: Firestore project & database configuration
  // -------------------------------------------------------------
  console.log('\n--- Test 11: Firestore project and database configuration ---');
  assert(firebaseConfig.projectId === 'itissimple-security-staging', 'Firebase projectId is itissimple-security-staging');
  assert(
    firebaseConfig.firestoreDatabaseId === '(default)' ||
    firebaseConfig.firestoreDatabaseId === 'ai-studio-securitystagingi-82447e17-0a01-4d71-b6f9-a8880c9fcea9',
    'Firestore database ID is valid staging database'
  );

  console.log('\n====================================================');
  console.log(`TEST RESULTS: ${passedTests}/${totalTests} PASSED`);
  console.log('====================================================');
  if (passedTests === totalTests) {
    console.log('HOTFIX 2.3.5B VALIDATED SUCCESSFULLY!');
    process.exit(0);
  } else {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Test execution failed with unhandled error:', err);
  process.exit(1);
});
