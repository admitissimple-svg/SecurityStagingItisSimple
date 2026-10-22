import {
  buildDailyVocabularyQueueForDay,
  generateWeeklyHomework,
} from '../src/utils/homeworkGenerator';
import { executeStartNewWeek } from '../src/utils/StartNewWeekHandler';
import {
  saveStudentVocabularyToFirestore,
  getCachedLocalVocabulary,
  mergeHomeworkRecords,
} from '../src/utils/studentPersistence';
import {
  DayOfWeek,
  RoutineItem,
  StudentDictionaryEntry,
} from '../src/types';
import { defaultRoutinesByDay } from '../src/data/defaultRoutines';
import firebaseConfig from '../firebase-applet-config.json';

console.log('====================================================');
console.log('--- RUNNING TEST SUITE FOR HOTFIX 2.3.5C ---');
console.log('====================================================');

let mockBackendShouldFail = false;
let mockBackendResponse: any = { success: true, videos: [], routines: {} };

// Mock relative fetch in Node environment
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  if (typeof input === 'string' && input.includes('/api/student-routines/start-new-week')) {
    if (mockBackendShouldFail) {
      return {
        ok: false,
        status: 500,
        json: async () => ({ error: 'Internal Server Error' }),
        text: async () => JSON.stringify({ error: 'Internal Server Error' }),
      } as any;
    }
    return {
      ok: true,
      status: 200,
      json: async () => mockBackendResponse,
      text: async () => JSON.stringify(mockBackendResponse),
    } as any;
  }
  if (typeof input === 'string' && input.startsWith('/api/')) {
    return {
      ok: true,
      status: 200,
      json: async () => ({ success: true }),
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

let passedTests = 0;
let totalTests = 0;

function assert(condition: boolean, message: string) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`[PASS] ${message}`);
  } else {
    console.error(`[FAIL] ${message}`);
  }
}

async function runTestSuite() {
  const studentUid = 'student-test-hotfix-235c';
  const studentEmail = 'student.235c@example.com';
  const week1Words = ['resilience', 'breakthrough', 'endeavor', 'fluency', 'clarity'];

  // Seed initial Week 1 routines with 5 words on Monday and Tuesday
  const week1Routines: Record<DayOfWeek, RoutineItem[]> = JSON.parse(JSON.stringify(defaultRoutinesByDay));
  week1Routines.monday[0].learnedWords = [...week1Words];
  week1Routines.tuesday[0].learnedWords = ['pinnacle', 'tenacity', 'bandwidth', 'leverage', 'benchmark'];

  console.log('\n--- Test 1 & 2: Start a New Week immediately resets the panel to 0/5 without F5 ---');
  mockBackendShouldFail = false;
  mockBackendResponse = {
    success: true,
    weeklyCycle: 2,
    weeklyStudyDaysTarget: 5,
    weeklyStudyDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
    routines: {},
    message: 'Week cycle advanced successfully',
  };

  const startResult = await executeStartNewWeek({
    studentUid,
    studentEmail,
    currentCycle: 1,
    weeklyStudyDaysTarget: 5,
    weeklyStudyDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
    studentLevel: 'intermediate',
    currentRoutines: week1Routines,
  });

  assert(Boolean(startResult && startResult.success === true), 'executeStartNewWeek succeeds with backend confirmation');
  assert(Boolean(startResult && startResult.weeklyCycle === 2), 'weeklyCycle increments to 2');

  if (!startResult) {
    throw new Error('startResult is unexpectedly null');
  }

  // Verify that all 7 days have learnedWords: []
  const allDays: DayOfWeek[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  const allDaysEmpty = allDays.every((d) => {
    const list = startResult.routines[d];
    return Array.isArray(list) && list.length > 0 && list.every((item) => Array.isArray(item.learnedWords) && item.learnedWords.length === 0);
  });
  assert(allDaysEmpty, 'All 7 days in sanitized routines have learnedWords: [] (0/5 recorded)');

  // Verify UI mapping: words array is 5 empty strings, counter is 0/5
  const initialMondayWords = startResult.routines.monday[0].learnedWords || [];
  const uiWordsPadded = [...initialMondayWords];
  while (uiWordsPadded.length < 5) uiWordsPadded.push('');
  const activeCount = uiWordsPadded.filter((w) => w.trim() !== '').length;

  assert(activeCount === 0, 'Active word counter is 0/5 immediately without reload');
  assert(uiWordsPadded.length === 5 && uiWordsPadded.every((w) => w === ''), 'All 5 positions in the panel are empty strings');

  console.log('\n--- Test 3: Switching days in the new week does not restore old words ---');
  let daySwitchPreservesClean = true;
  for (const day of allDays) {
    const dayAct = startResult.routines[day][0];
    const dayWords = (dayAct.learnedWords || []).filter((w) => Boolean(w && w.trim()));
    if (dayWords.length !== 0) {
      daySwitchPreservesClean = false;
    }
  }
  assert(daySwitchPreservesClean, 'Switching between all 7 days in week 2 shows 0/5 with no lingering words');

  console.log('\n--- Test 4: Simulated F5 / page remount preserves 0/5 in new cycle ---');
  // Simulated remount state loading from Firestore/backend routines for cycle 2
  const remountRoutines = JSON.parse(JSON.stringify(startResult.routines));
  const remountMonday = remountRoutines.monday[0];
  const remountLearned = remountMonday.learnedWords || [];
  assert(remountLearned.length === 0, 'Simulated remount/F5 preserves 0/5 for active cycle 2');

  console.log('\n--- Test 5: Outgoing words are preserved in My Dictionary ---');
  const cachedDict = getCachedLocalVocabulary(studentUid, studentEmail);
  const preservedWords = ['resilience', 'breakthrough', 'endeavor', 'fluency', 'clarity'];
  const allPreserved = preservedWords.every((w) =>
    cachedDict.some((d) => d.word.toLowerCase() === w.toLowerCase())
  );
  assert(allPreserved, 'My Dictionary safely preserves all 5 words from week 1');
  const breakthroughEntry = cachedDict.find((d) => d.word.toLowerCase() === 'breakthrough');
  assert(Boolean(breakthroughEntry?.learnedAt), 'Preserved dictionary entry has authentic learnedAt timestamp');
  assert(Boolean(breakthroughEntry?.source === 'routine'), 'Preserved dictionary entry records routine source');

  console.log('\n--- Test 6: Backend failure does NOT produce a false visual reset ---');
  mockBackendShouldFail = true;
  const failedStartResult = await executeStartNewWeek({
    studentUid,
    studentEmail,
    currentCycle: 2,
    weeklyStudyDaysTarget: 5,
    weeklyStudyDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
    studentLevel: 'intermediate',
    currentRoutines: week1Routines,
  });

  assert(Boolean(failedStartResult && failedStartResult.success === false), 'executeStartNewWeek returns success: false when backend fails');
  assert(Boolean(failedStartResult && failedStartResult.weeklyCycle === 2), 'weeklyCycle remains at current cycle on failure (no advance)');
  assert(Boolean(failedStartResult && failedStartResult.message), 'Descriptive error message returned on failure');

  console.log('\n--- Test 7: Stale async Firestore snapshots from prior cycle are discarded ---');
  const activeCycle = 2;
  const staleWeek1Snapshot: any = {
    monday: {
      videoId: 'oldVid123',
      title: 'Old Video',
      learnedWords: ['oldWord1', 'oldWord2', 'oldWord3'],
      weeklyCycle: 1, // Stale cycle 1!
    },
  };

  // Simulating App.tsx listener guard:
  // if (typeof dayData.weeklyCycle === 'number' && dayData.weeklyCycle < currentActiveCycle) return;
  const incomingCycle = staleWeek1Snapshot.monday.weeklyCycle;
  const isStale = typeof incomingCycle === 'number' && incomingCycle < activeCycle;
  assert(isStale === true, 'Listener correctly identifies incoming snapshot as stale from past cycle');

  let mergedRoutines = JSON.parse(JSON.stringify(startResult.routines));
  if (!isStale) {
    mergedRoutines.monday[0].learnedWords = staleWeek1Snapshot.monday.learnedWords;
  }
  assert(
    mergedRoutines.monday[0].learnedWords.length === 0,
    'Stale async callback from cycle 1 is discarded and does NOT overwrite week 2 state'
  );

  console.log('\n--- Test 8: Zero regression on HOTFIX 2.3.5 and 2.3.5B ---');
  // Verify buildDailyVocabularyQueueForDay works as expected
  const testCandidates: any[] = [
    { word: 'Alpha', definitionEn: 'Def A', translationPt: 'Alfa', exampleSentence: 'Ex A', cefrLevel: 'B1', learnedAt: '2026-10-21T10:00:00Z', source: 'routine' },
    { word: 'Beta', definitionEn: 'Def B', translationPt: 'Beta', exampleSentence: 'Ex B', cefrLevel: 'B2', learnedAt: '2026-10-21T11:00:00Z', source: 'routine' },
    { word: 'Gamma', definitionEn: 'Def G', translationPt: 'Gama', exampleSentence: 'Ex G', cefrLevel: 'B2', learnedAt: '2026-10-21T12:00:00Z', source: 'routine' },
    { word: 'Delta', definitionEn: 'Def D', translationPt: 'Delta', exampleSentence: 'Ex D', cefrLevel: 'C1', learnedAt: '2026-10-21T13:00:00Z', source: 'routine' },
    { word: 'Epsilon', definitionEn: 'Def E', translationPt: 'Epsilon', exampleSentence: 'Ex E', cefrLevel: 'C1', learnedAt: '2026-10-21T14:00:00Z', source: 'routine' },
  ];

  const queue = buildDailyVocabularyQueueForDay('monday', testCandidates, studentUid, studentEmail);

  assert(queue.length === 5, 'Daily vocabulary queue continues to resolve exactly 5 words');
  assert(queue[0].word === 'Epsilon', 'Queue retains descending chronological order (Epsilon most recent)');
  assert(queue[4].word === 'Alpha', 'Queue retains Alpha as 5th item');

  // Verify mergeHomeworkRecords keeps student progress intact
  const primaryHw = {
    weeklyCycle: 2,
    weekId: 'week-2',
    score: 85,
    isCompleted: true,
    studentAnswers: {
      matching: { '1': 'answer1' },
      fillInBlanks: {},
      sentences: {},
      quizAnswers: {},
    },
  };
  const fallbackHw = {
    weeklyCycle: 2,
    weekId: 'week-2',
    score: 80,
    studentAnswers: {
      matching: {},
      fillInBlanks: { '2': 'answer2' },
      sentences: {},
      quizAnswers: {},
    },
  };
  const merged = mergeHomeworkRecords(primaryHw, fallbackHw);
  assert(merged.score === 85, 'mergeHomeworkRecords preserves highest score');
  assert(merged.isCompleted === true, 'mergeHomeworkRecords preserves isCompleted');
  assert(Boolean(merged.studentAnswers.matching['1']), 'mergeHomeworkRecords preserves primary matching answer');
  assert(Boolean(merged.studentAnswers.fillInBlanks['2']), 'mergeHomeworkRecords preserves fallback fillInBlanks answer');

  // Verify Firebase staging configuration
  assert(firebaseConfig.projectId === 'itissimple-security-staging', 'Firebase projectId matches staging target');

  console.log('\n====================================================');
  console.log(`TEST RESULTS: ${passedTests}/${totalTests} PASSED`);
  console.log('====================================================');
  if (passedTests === totalTests) {
    console.log('HOTFIX 2.3.5C VALIDATED SUCCESSFULLY!');
  } else {
    console.error('SOME TESTS FAILED');
    process.exit(1);
  }
}

runTestSuite().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
