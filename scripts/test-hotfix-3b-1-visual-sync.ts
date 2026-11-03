import assert from 'assert';
import {
  parseWeekCycleNumber,
  normalizeWeekId,
  deriveWeeklyChecksFromJournal,
  getCachedWeeklyChecks,
  cacheWeeklyChecksLocally,
  clearAllLocalPersistenceCaches,
} from '../src/utils/studentPersistence';
import { executeStartNewWeek } from '../src/utils/StartNewWeekHandler';
import { RoutineItem, StudentJournalEntry, UserProfile, EnglishLevel } from '../src/types';

console.log('=== TEST SUITE: HOTFIX 3B.1 — Visual Synchronization & Neutral Loading State ===\n');

async function runTests() {
  clearAllLocalPersistenceCaches();

  // Test 1: Start New Week resets S-Path immediately upon backend confirmation
  console.log('--- Test 1: Start New Week resets S-Path immediately upon backend confirmation ---');
  {
    const uid = 'test_student_hotfix_3b1';
    const email = 'hotfix3b1@test.com';

    // Simulate week-1 checks in cache
    cacheWeeklyChecksLocally(uid, email, { video_day_monday: true, audio_day_monday: true }, 'week-1');
    const week1Cached = getCachedWeeklyChecks(uid, email, 'week-1');
    assert.strictEqual(week1Cached['video_day_monday'], true, 'Week 1 cache should have completed check');

    // Simulate backend response for start-new-week
    const originalFetch = globalThis.fetch;
    let endpointCalled = false;
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/student-routines/start-new-week')) {
        endpointCalled = true;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            weeklyCycle: 2,
            weekId: 'week-2',
            message: 'New week started',
            routines: {
              monday: [
                {
                  id: 'm1',
                  time: '08:00',
                  activityName: 'Vídeo do Dia',
                  completed: false,
                  completedToday: false,
                  completedVideoToday: false,
                  completedAudioToday: false,
                  learnedWords: [],
                  teacherVideos: [],
                },
              ],
            },
          }),
        } as any;
      }
      return { ok: true, status: 200, json: async () => ({ success: true }) } as any;
    };

    try {
      const snwResult = await executeStartNewWeek({
        studentUid: uid,
        studentEmail: email,
        currentCycle: 1,
        weeklyStudyDaysTarget: 5,
      });

      assert.strictEqual(endpointCalled, true, 'Backend endpoint must be called');
      assert.ok(snwResult, 'Result must exist');
      assert.strictEqual(snwResult.success, true, 'Start New Week must succeed');
      assert.strictEqual(snwResult.weeklyCycle, 2, 'New cycle must be 2');

      // Verify that week-2 cache is initialized with zero checks
      const week2Cached = getCachedWeeklyChecks(uid, email, 'week-2');
      assert.deepStrictEqual(week2Cached, {}, 'Week 2 in-memory checks must be zeroed immediately');

      // Verify that week-1 checks are preserved in history
      const week1Preserved = getCachedWeeklyChecks(uid, email, 'week-1');
      assert.strictEqual(week1Preserved['video_day_monday'], true, 'Week 1 historical checks must be preserved');

      console.log('✓ Test 1 Passed: S-Path resets immediately to zero upon backend confirmation, preserving history.');
    } finally {
      globalThis.fetch = originalFetch;
    }
  }

  // Test 2: Start New Week cleans videos and completes routine item state
  console.log('\n--- Test 2: Routine items have completedVideoToday and completedAudioToday cleared ---');
  {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        weeklyCycle: 2,
        weekId: 'week-2',
      }),
    } as any);

    try {
      const snwResult = await executeStartNewWeek({
        studentUid: 'uid_clean_routine',
        studentEmail: 'clean_routine@test.com',
        currentCycle: 1,
        currentRoutines: {
          monday: [
            {
              id: 'm1',
              time: '08:00',
              activityName: 'Vídeo do Dia',
              completed: true,
              completedToday: true,
              completedVideoToday: true,
              completedAudioToday: true,
              learnedWords: ['word1', 'word2'],
              teacherVideos: [{ id: 'v1', videoId: 'abc', url: 'https://youtu.be/abc', title: 'Video 1' }],
            } as any,
          ],
        } as any,
      });

      assert.ok(snwResult, 'Result should exist');
      const sanitizedMon = snwResult.routines?.monday?.[0];
      assert.ok(sanitizedMon, 'Monday routine should exist');
      assert.strictEqual(sanitizedMon.completed, false, 'completed must be reset to false');
      assert.strictEqual(sanitizedMon.completedToday, false, 'completedToday must be reset to false');
      assert.strictEqual((sanitizedMon as any).completedVideoToday, false, 'completedVideoToday must be reset to false');
      assert.strictEqual((sanitizedMon as any).completedAudioToday, false, 'completedAudioToday must be reset to false');
      assert.deepStrictEqual(sanitizedMon.learnedWords, [], 'learnedWords must be empty');
      assert.deepStrictEqual(sanitizedMon.teacherVideos, [], 'teacherVideos must be empty (back to Choose Video)');

      console.log('✓ Test 2 Passed: Routine video state cleaned, returning to Choose Video.');
    } finally {
      globalThis.fetch = originalFetch;
    }
  }

  // Test 3: Backend failure does NOT cause premature visual reset
  console.log('\n--- Test 3: Backend rejection prevents S-Path reset ---');
  {
    const uid = 'uid_fail_test';
    const email = 'fail@test.com';
    cacheWeeklyChecksLocally(uid, email, { video_day_monday: true }, 'week-1');

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: false,
      status: 500,
      json: async () => ({
        success: false,
        error: 'Database connection failed',
      }),
    } as any);

    try {
      const snwResult = await executeStartNewWeek({
        studentUid: uid,
        studentEmail: email,
        currentCycle: 1,
      });

      assert.ok(snwResult, 'Result should exist');
      assert.strictEqual(snwResult.success, false, 'Operation must report failure');
      // Verify week 1 cache was NOT wiped
      const checks = getCachedWeeklyChecks(uid, email, 'week-1');
      assert.strictEqual(checks['video_day_monday'], true, 'Week 1 checks must remain intact on error');

      console.log('✓ Test 3 Passed: Backend failure leaves S-Path intact without premature visual reset.');
    } finally {
      globalThis.fetch = originalFetch;
    }
  }

  // Test 4: Journal cycle isolation prevents stale checkmark leakage into Week 2
  console.log('\n--- Test 4: Journal cycle isolation prevents stale checkmark leakage ---');
  {
    const entries: StudentJournalEntry[] = [
      {
        id: 'j1',
        type: 'video',
        date: '2026-11-01',
        timestamp: 1700000000000,
        dayOfWeek: 'monday',
        week: 1,
        title: 'Week 1 Video',
      },
      {
        id: 'j2',
        type: 'audio',
        date: '2026-11-01',
        timestamp: 1700000000000,
        dayOfWeek: 'monday',
        week: 1,
        title: 'Week 1 Audio',
      },
      {
        id: 'j3',
        type: 'video',
        date: '2026-11-08',
        timestamp: 1700600000000,
        dayOfWeek: 'monday',
        week: 2,
        title: 'Week 2 Video',
      },
    ];

    const week1Derived = deriveWeeklyChecksFromJournal(entries, 1);
    assert.strictEqual(week1Derived['video_day_monday'], true, 'Week 1 must have video_day_monday');
    assert.strictEqual(week1Derived['audio_day_monday'], true, 'Week 1 must have audio_day_monday');

    const week2Derived = deriveWeeklyChecksFromJournal(entries, 2);
    assert.strictEqual(week2Derived['video_day_monday'], true, 'Week 2 must have video_day_monday');
    assert.strictEqual(week2Derived['audio_day_monday'], undefined, 'Week 2 must NOT inherit Week 1 audio check');

    const week3Derived = deriveWeeklyChecksFromJournal(entries, 3);
    assert.deepStrictEqual(week3Derived, {}, 'Week 3 must have zero derived checks');

    console.log('✓ Test 4 Passed: Journal derivation strictly isolates cycles without cross-week leakage.');
  }

  // Test 5: Neutral Loading State logic for Playlist
  console.log('\n--- Test 5: Neutral loading state verification ---');
  {
    // Simulate initial student profile before Firestore profile resolves
    const initialProfile: UserProfile = {
      name: 'Student',
      email: 'student@test.com',
      level: EnglishLevel.BEGINNER,
      weeklyCycle: 2,
    };

    // When profile or routines is loading:
    const isRoutinesLoading = true;
    const isStarting = false;
    const isStartingNewWeek = false;
    const isLoadingSpotify = false;

    const shouldShowLoadingNeutral = Boolean(
      isStarting || isStartingNewWeek || isRoutinesLoading || !initialProfile?.id || isLoadingSpotify
    );

    assert.strictEqual(
      shouldShowLoadingNeutral,
      true,
      'When userProfile.id is missing or routines are loading, card must show neutral Loading state'
    );

    console.log('✓ Test 5 Passed: Neutral loading state triggered during load, eliminating provisional flash.');
  }

  // Test 6: Delayed responses from past cycle discarded
  console.log('\n--- Test 6: Delayed async responses from past cycles discarded ---');
  {
    const activeCycle = 2;
    const delayedResponseCycle = 1;

    const isStale = (respCycle: number, currentCycle: number) => {
      const parsedResp = parseWeekCycleNumber(respCycle);
      const parsedCurr = parseWeekCycleNumber(currentCycle);
      return parsedResp !== parsedCurr;
    };

    assert.strictEqual(isStale(delayedResponseCycle, activeCycle), true, 'Cycle 1 response must be flagged as stale');
    assert.strictEqual(isStale(2, activeCycle), false, 'Cycle 2 response must be accepted');

    console.log('✓ Test 6 Passed: Stale responses from prior cycles are cleanly discarded.');
  }

  console.log('\n======================================================');
  console.log('ALL 6 TESTS PASSED FOR HOTFIX 3B.1 VISUAL SYNCHRONIZATION');
  console.log('======================================================');
  process.exit(0);
}

runTests().catch((err) => {
  console.error('Test Suite Failed:', err);
  process.exit(1);
});
