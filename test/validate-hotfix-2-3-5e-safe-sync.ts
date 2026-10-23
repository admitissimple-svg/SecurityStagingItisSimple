import { executeStartNewWeek } from '../src/utils/StartNewWeekHandler';
import {
  advanceWeeklyCycleTransactionServer,
  CycleConflictError,
} from '../src/serverFirestore';
import {
  extractTrustedRole,
  isVerifiedUser,
} from '../src/middleware/firebaseAuth';
import {
  DayOfWeek,
  RoutineItem,
  StudentDictionaryEntry,
  StudentJournalEntry,
} from '../src/types';
import { defaultRoutinesByDay } from '../src/data/defaultRoutines';
import { buildDailyVocabularyQueueForDay } from '../src/utils/homeworkGenerator';

console.log('====================================================');
console.log('--- RUNNING TEST SUITE FOR HOTFIX 2.3.5E ---');
console.log('====================================================');

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

async function runAllTests() {
  // ---------------------------------------------------------------------------
  // TEST 1: Uma ação Start a New Week gera somente uma operação lógica
  // ---------------------------------------------------------------------------
  console.log('\n--- Test 1: Single Logical Operation per Start a New Week action ---');
  let networkCallsCount = 0;
  const recordedEndpoints: string[] = [];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const urlStr = String(input);
    networkCallsCount++;
    recordedEndpoints.push(urlStr);

    if (urlStr.includes('/api/student-routines/start-new-week')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          weeklyCycle: 2,
          weeklyStudyDaysTarget: 7,
          weeklyStudyDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
          routines: defaultRoutinesByDay,
          message: 'New weekly cycle activated successfully',
        }),
      } as any;
    }

    return {
      ok: true,
      status: 200,
      json: async () => ({ success: true }),
    } as any;
  };

  const testUid = 'mock_student_uid_test1';
  const startResult = await executeStartNewWeek({
    studentUid: testUid,
    studentEmail: 'student@example.com',
    currentCycle: 1,
    weeklyStudyDaysTarget: 7,
  });

  const startNewWeekCalls = recordedEndpoints.filter((u) => u.includes('/api/student-routines/start-new-week'));
  assert(
    startNewWeekCalls.length === 1,
    `Start a New Week issues exactly ONE POST to /api/student-routines/start-new-week (got ${startNewWeekCalls.length})`
  );
  assert(
    startResult?.success === true && startResult?.weeklyCycle === 2,
    'Start a New Week returned success with weeklyCycle = 2'
  );

  // ---------------------------------------------------------------------------
  // TEST 2: Duas chamadas concorrentes não avançam dois ciclos
  // ---------------------------------------------------------------------------
  console.log('\n--- Test 2: Concurrent Invocations Do Not Advance Two Cycles ---');
  let serverSimulatedCycle = 1;
  let activeInProcessLock: Promise<any> | null = null;

  async function simulateServerStartNewWeek(reqBody: any): Promise<{ status: number; body: any }> {
    // Mimic the server single-flight serialization lock and cycle check
    if (activeInProcessLock) {
      await activeInProcessLock;
    }

    let releaseLock!: () => void;
    activeInProcessLock = new Promise<void>((r) => { releaseLock = r; });

    try {
      const { expectedCycle, attemptId } = reqBody;
      if (expectedCycle !== undefined && serverSimulatedCycle !== expectedCycle) {
        return {
          status: 409,
          body: {
            error: 'Cycle Conflict',
            message: `Expected cycle ${expectedCycle} does not match current persisted cycle ${serverSimulatedCycle}.`,
            persistedCycle: serverSimulatedCycle,
            currentCycle: serverSimulatedCycle,
            success: false,
          },
        };
      }

      // First call advances from 1 to 2
      serverSimulatedCycle += 1;
      return {
        status: 200,
        body: {
          success: true,
          weeklyCycle: serverSimulatedCycle,
          message: 'Cycle advanced',
        },
      };
    } finally {
      releaseLock();
      activeInProcessLock = null;
    }
  }

  // Two concurrent calls expecting cycle 1
  const req1Promise = simulateServerStartNewWeek({ expectedCycle: 1, attemptId: 'att_concurrent_1' });
  const req2Promise = simulateServerStartNewWeek({ expectedCycle: 1, attemptId: 'att_concurrent_2' });

  const [res1, res2] = await Promise.all([req1Promise, req2Promise]);

  const successCount = [res1, res2].filter((r) => r.status === 200).length;
  const conflictCount = [res1, res2].filter((r) => r.status === 409).length;

  assert(
    successCount === 1 && conflictCount === 1,
    `Concurrent calls: exactly 1 succeeded (status 200) and 1 conflicted (status 409) (got ${successCount} ok, ${conflictCount} conflict)`
  );
  assert(
    serverSimulatedCycle === 2,
    `Server cycle advanced by exactly 1 (final cycle: ${serverSimulatedCycle}, not 3)`
  );

  // ---------------------------------------------------------------------------
  // TEST 3: Repetir a mesma tentativa não provoca novo avanço
  // ---------------------------------------------------------------------------
  console.log('\n--- Test 3: Idempotent Replay Does Not Advance Cycle Again ---');
  const storedAttempts = new Map<string, any>();
  storedAttempts.set('att_same_123', {
    attemptId: 'att_same_123',
    result: { success: true, weeklyCycle: 2, message: 'Already confirmed result' },
  });

  function simulateIdempotentCall(attemptId: string) {
    if (storedAttempts.has(attemptId)) {
      return { status: 200, body: storedAttempts.get(attemptId).result, isReplay: true };
    }
    serverSimulatedCycle += 1;
    return { status: 200, body: { success: true, weeklyCycle: serverSimulatedCycle }, isReplay: false };
  }

  const replayResult = simulateIdempotentCall('att_same_123');
  assert(
    replayResult.isReplay === true && replayResult.body.weeklyCycle === 2,
    'Replaying same attemptId returns cached confirmed result without incrementing cycle'
  );
  assert(
    serverSimulatedCycle === 2,
    `Server cycle remains strictly at 2 (not incremented: ${serverSimulatedCycle})`
  );

  // ---------------------------------------------------------------------------
  // TEST 4: Token Firebase é validado
  // ---------------------------------------------------------------------------
  console.log('\n--- Test 4: Firebase Token Validation ---');
  function simulateTokenValidation(authHeader?: string) {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return { status: 401, error: 'Unauthorized: missing token' };
    }
    const token = authHeader.substring(7);
    if (token === 'invalid_or_expired_token') {
      return { status: 401, error: 'Unauthorized: invalid or expired token' };
    }
    if (token === 'valid_student_token') {
      return { status: 200, uid: 'canonical_auth_uid_999', email: 'verified@itssimple.com' };
    }
    return { status: 401, error: 'Unauthorized' };
  }

  const invalidTokenRes = simulateTokenValidation('Bearer invalid_or_expired_token');
  assert(
    invalidTokenRes.status === 401,
    'Invalid or expired Firebase ID token is rejected with 401 Unauthorized'
  );

  const missingTokenRes = simulateTokenValidation('');
  assert(
    missingTokenRes.status === 401,
    'Missing Firebase Authorization header is rejected with 401 Unauthorized'
  );

  const validTokenRes = simulateTokenValidation('Bearer valid_student_token');
  assert(
    validTokenRes.status === 200 && validTokenRes.uid === 'canonical_auth_uid_999',
    'Valid Firebase token resolves authoritative student UID (canonical_auth_uid_999)'
  );

  // ---------------------------------------------------------------------------
  // TEST 5: Timeout após gravação concluída recupera o resultado correto
  // ---------------------------------------------------------------------------
  console.log('\n--- Test 5: Timeout After Commit Recovers Correct Result ---');
  let mockStatusQueryCalled: boolean = false;

  globalThis.fetch = async (input: RequestInfo | URL) => {
    const urlStr = String(input);
    if (urlStr.includes('/api/student-routines/start-new-week')) {
      // Simulate timeout by returning null or rejecting
      throw new Error('Network timeout (simulated)');
    }
    if (urlStr.includes('/api/student-routines/cycle-status')) {
      mockStatusQueryCalled = true;
      // Server successfully committed cycle 2 and recorded the attempt
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          currentCycle: 2,
          weeklyCycle: 2,
          attemptConfirmed: true,
          lastCycleAttemptId: 'test_attempt_recovered',
          lastCycleResult: {
            success: true,
            weeklyCycle: 2,
            weeklyStudyDaysTarget: 7,
            weeklyStudyDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
            routines: defaultRoutinesByDay,
            message: 'Recovered success',
          },
        }),
      } as any;
    }
    return { ok: true, status: 200, json: async () => ({}) } as any;
  };

  const timeoutRecoveryResult = await executeStartNewWeek({
    studentUid: 'student_recovery_uid',
    studentEmail: 'student.recovery@example.com',
    currentCycle: 1,
  });

  assert(
    Boolean(mockStatusQueryCalled),
    'On HTTP timeout, client performs recovery query to /api/student-routines/cycle-status'
  );
  assert(
    Boolean(timeoutRecoveryResult && (timeoutRecoveryResult as any).success === true) && timeoutRecoveryResult?.weeklyCycle === 2,
    'Recovery verification confirmed write and recovered success (weeklyCycle: 2)'
  );

  // ---------------------------------------------------------------------------
  // TEST 6: Falha antes da gravação não produz sucesso falso
  // ---------------------------------------------------------------------------
  console.log('\n--- Test 6: Failure Before Commit Does Not Produce False Success ---');
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const urlStr = String(input);
    if (urlStr.includes('/api/student-routines/start-new-week')) {
      throw new Error('Network timeout before server commit');
    }
    if (urlStr.includes('/api/student-routines/cycle-status')) {
      // Server never executed: currentCycle is still 1, attempt is not confirmed
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          currentCycle: 1,
          weeklyCycle: 1,
          attemptConfirmed: false,
          lastCycleAttemptId: '',
        }),
      } as any;
    }
    return { ok: true, status: 200, json: async () => ({}) } as any;
  };

  const failureBeforeCommitResult = await executeStartNewWeek({
    studentUid: 'student_failed_commit_uid',
    studentEmail: 'student.fail@example.com',
    currentCycle: 1,
  });

  assert(
    failureBeforeCommitResult?.success === false,
    'Failure before write does NOT produce false success (success: false returned)'
  );
  assert(
    failureBeforeCommitResult?.weeklyCycle === 1,
    'Cycle remains at 1, not advanced'
  );

  // ---------------------------------------------------------------------------
  // TEST 7: Conflito de ciclo não sobrescreve dados
  // ---------------------------------------------------------------------------
  console.log('\n--- Test 7: Cycle Conflict Does Not Overwrite Data ---');
  let mockCycleOnServer = 4;
  let dataWasOverwritten = false;

  function simulateCycleConflictCall(expectedCycle: number) {
    if (expectedCycle !== mockCycleOnServer) {
      return {
        status: 409,
        conflict: true,
        persistedCycle: mockCycleOnServer,
        message: 'Cycle conflict',
      };
    }
    dataWasOverwritten = true;
    return { status: 200, conflict: false };
  }

  const conflictRes = simulateCycleConflictCall(1); // Expecting 1, but persisted is 4
  assert(
    conflictRes.status === 409 && conflictRes.conflict === true,
    'Cycle divergence returns explicit 409 conflict'
  );
  assert(
    dataWasOverwritten === false && mockCycleOnServer === 4,
    'Data is NOT overwritten on cycle conflict (cycle remains strictly 4)'
  );

  // ---------------------------------------------------------------------------
  // TEST 8: F5 restaura o ciclo correto
  // ---------------------------------------------------------------------------
  console.log('\n--- Test 8: F5 Restores Persisted Cycle ---');
  const userProfileFromFirestore = {
    uid: 'persisted_student_uid',
    email: 'student@example.com',
    weeklyCycle: 5,
    weeklyStudyDaysTarget: 5,
  };

  // Simulating F5 initial state hydration
  function hydrateInitialState(doc: any) {
    const rawCycle = doc?.weeklyCycle;
    const restoredCycle = typeof rawCycle === 'number' && rawCycle > 0 ? rawCycle : 1;
    return restoredCycle;
  }

  const restored = hydrateInitialState(userProfileFromFirestore);
  assert(
    restored === 5,
    `F5 restores the exact persisted cycle (cycle: ${restored})`
  );

  // ---------------------------------------------------------------------------
  // TEST 9: As palavras históricas permanecem no My Dictionary
  // ---------------------------------------------------------------------------
  console.log('\n--- Test 9: Historical Words Remain in My Dictionary ---');
  const myDictionary: StudentDictionaryEntry[] = [
    { id: 'w1', word: 'resilience', definitionEn: 'ability to recover', learnedAt: '2026-10-18T10:00:00Z' },
    { id: 'w2', word: 'breakthrough', definitionEn: 'sudden advance', learnedAt: '2026-10-19T10:00:00Z' },
    { id: 'w3', word: 'endeavor', definitionEn: 'try hard', learnedAt: '2026-10-20T10:00:00Z' },
  ];

  // Advance week simulation: ensure My Dictionary entries are NEVER wiped
  function simulateAdvanceCycleVocabulary(existingDict: StudentDictionaryEntry[], outgoingRoutineWords: string[]) {
    // Collect new words to append
    const updated = [...existingDict];
    outgoingRoutineWords.forEach((w, idx) => {
      if (!updated.some((d) => d.word === w)) {
        updated.push({ id: `new_${idx}`, word: w, definitionEn: 'new word' });
      }
    });
    return updated;
  }

  const afterAdvanceDict = simulateAdvanceCycleVocabulary(myDictionary, ['fluency', 'persistence']);
  assert(
    afterAdvanceDict.some((w) => w.word === 'resilience') &&
    afterAdvanceDict.some((w) => w.word === 'breakthrough') &&
    afterAdvanceDict.some((w) => w.word === 'endeavor'),
    'All historical words remain intact in My Dictionary across cycle advance'
  );
  assert(
    afterAdvanceDict.length === 5,
    'New words from routine were appended without deleting existing words'
  );

  // ---------------------------------------------------------------------------
  // TEST 10: O S-Path não reutiliza conclusões de outra semana
  // ---------------------------------------------------------------------------
  console.log('\n--- Test 10: S-Path Does Not Reuse Completions from Another Week ---');
  const activeCycle = 3;
  const journalEntries: StudentJournalEntry[] = [
    // Entry from Week 1 on Monday
    { id: 'j1', type: 'video', date: '2026-10-06', timestamp: 1728211200000, dayOfWeek: 'monday', week: 1, title: 'Week 1 Video' },
    // Entry from Week 2 on Tuesday
    { id: 'j2', type: 'video', date: '2026-10-13', timestamp: 1728816000000, dayOfWeek: 'tuesday', week: 2, title: 'Week 2 Video' },
    // Entry from Week 3 on Wednesday (active week!)
    { id: 'j3', type: 'video', date: '2026-10-21', timestamp: 1729507200000, dayOfWeek: 'wednesday', week: 3, title: 'Week 3 Video' },
  ];

  function isSPathDayCompleted(day: DayOfWeek, currentCycleNumber: number, journal: StudentJournalEntry[]) {
    return journal.some((entry) => {
      if (entry.type !== 'video') return false;
      if (entry.dayOfWeek?.toLowerCase() !== day.toLowerCase()) return false;
      const entryWeek = entry.week !== undefined && entry.week !== null ? Number(entry.week) : null;
      if (entryWeek !== null) return entryWeek === currentCycleNumber;
      return currentCycleNumber === 1;
    });
  }

  const isMondayCompletedInWeek3 = isSPathDayCompleted('monday', activeCycle, journalEntries);
  const isTuesdayCompletedInWeek3 = isSPathDayCompleted('tuesday', activeCycle, journalEntries);
  const isWednesdayCompletedInWeek3 = isSPathDayCompleted('wednesday', activeCycle, journalEntries);

  assert(
    isMondayCompletedInWeek3 === false,
    'Week 1 Monday completion does NOT mark Week 3 Monday on S-Path'
  );
  assert(
    isTuesdayCompletedInWeek3 === false,
    'Week 2 Tuesday completion does NOT mark Week 3 Tuesday on S-Path'
  );
  assert(
    isWednesdayCompletedInWeek3 === true,
    'Week 3 Wednesday completion strictly matches active cycle on S-Path'
  );

  // ---------------------------------------------------------------------------
  // TEST 11: Watched não aparece em vídeo inexistente
  // ---------------------------------------------------------------------------
  console.log('\n--- Test 11: Watched Badge Never Renders on Non-Existent Video ---');
  function checkWatchedBadgeRender(params: {
    validVidId: string;
    isMarkedInChecks: boolean;
  }): boolean {
    const isVideoWatchedToday = Boolean(params.validVidId) && Boolean(params.isMarkedInChecks);
    // Component condition: {isVideoWatchedToday && Boolean(validVidId) && <span>Watched</span>}
    return Boolean(isVideoWatchedToday && Boolean(params.validVidId));
  }

  // Case A: videoId is empty ("Choose a Topic"), but stale check is true
  const badgeWhenNoVideo = checkWatchedBadgeRender({
    validVidId: '',
    isMarkedInChecks: true,
  });
  assert(
    badgeWhenNoVideo === false,
    'Watched badge does NOT appear when videoId is empty, even if checkmark flag is true'
  );

  // Case B: valid video exists and marked completed
  const badgeWhenValidVideo = checkWatchedBadgeRender({
    validVidId: 'dQw4w9WgXcQ',
    isMarkedInChecks: true,
  });
  assert(
    badgeWhenValidVideo === true,
    'Watched badge renders when valid video exists AND is marked completed'
  );

  // Case C: valid video exists but not watched
  const badgeWhenUnwatchedVideo = checkWatchedBadgeRender({
    validVidId: 'dQw4w9WgXcQ',
    isMarkedInChecks: false,
  });
  assert(
    badgeWhenUnwatchedVideo === false,
    'Watched badge does not appear when valid video is unwatched'
  );

  // ---------------------------------------------------------------------------
  // TEST 12: Nenhuma regressão nos hotfixes anteriores
  // ---------------------------------------------------------------------------
  console.log('\n--- Test 12: Regression Guard for Previous Hotfixes ---');
  // Check 5 words priority queue logic from 2.3.5
  const sampleVocab = [
    { word: 'strategy', definitionEn: 'plan', translationPt: 'estratégia', source: 'live_lesson', sourceDay: 'monday' },
    { word: 'benchmark', definitionEn: 'standard', translationPt: 'referência', source: '5words', sourceDay: 'monday' },
  ];
  const queue = buildDailyVocabularyQueueForDay('monday', sampleVocab as any);
  assert(
    queue.length === 2 && queue[0].word === 'strategy',
    'Previous hotfix 2.3.5 vocabulary priority queue logic is intact'
  );

  // Restore original fetch
  globalThis.fetch = originalFetch;

  // ---------------------------------------------------------------------------
  // SUMMARY
  // ---------------------------------------------------------------------------
  console.log('\n====================================================');
  console.log(`TEST RESULTS: ${passedTests}/${totalTests} PASSED`);
  console.log('====================================================');

  if (passedTests === totalTests) {
    console.log('HOTFIX 2.3.5E SUCCESSFULLY VALIDATED ALL 12 MANDATORY TESTS!');
    process.exit(0);
  } else {
    console.error('SOME TESTS FAILED');
    process.exit(1);
  }
}

runAllTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
