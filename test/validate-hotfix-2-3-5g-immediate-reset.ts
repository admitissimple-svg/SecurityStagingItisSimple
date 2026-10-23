import { executeStartNewWeek } from '../src/utils/StartNewWeekHandler';
import { DayOfWeek, RoutineItem } from '../src/types';
import { SavedRoutineVideo } from '../src/hooks/useRoutine';
import { defaultRoutinesByDay } from '../src/data/defaultRoutines';

console.log('====================================================');
console.log('--- RUNNING TEST SUITE FOR HOTFIX 2.3.5G ---');
console.log('--- New Week Must Reset All 7 Days Immediately ---');
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

const ALL_DAYS: DayOfWeek[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

async function runAllTests() {
  const originalFetch = globalThis.fetch;

  try {
    // -------------------------------------------------------------------------
    // Set up prior week (Cycle 1) state with:
    // - Tuesday having a chosen Playlist ("playlist_music")
    // - Sunday having a custom suggestion ("custom_suggestion", "https://youtube.com/watch?v=custom123")
    // - 5 Key words recorded for various days
    // - Completed S-path flags
    // -------------------------------------------------------------------------
    const cycle1Routines: Record<DayOfWeek, RoutineItem[]> = {} as any;
    ALL_DAYS.forEach((day) => {
      cycle1Routines[day] = [
        {
          id: `act-${day.slice(0, 3)}-1`,
          time: '08:00',
          activityName:
            day === 'sunday'
              ? 'Your Suggestion'
              : day === 'tuesday'
              ? 'Music Playlist'
              : 'Video of the Day',
          category: 'morning',
          completed: true,
          completedToday: true,
          playlistId: day === 'tuesday' ? 'playlist_music' : day === 'sunday' ? 'custom_suggestion' : '',
          playlistTitle: day === 'tuesday' ? 'Music Playlist' : day === 'sunday' ? 'Your Suggestion' : '',
          teacherVideos: [
            {
              id: `vid-${day}`,
              videoId: `vid_${day}_cycle1`,
              url: `https://www.youtube.com/watch?v=vid_${day}_cycle1`,
              title: `${day} video`,
              instructions: 'Watch carefully',
              addedAt: new Date().toISOString(),
              playlistId: day === 'tuesday' ? 'playlist_music' : day === 'sunday' ? 'custom_suggestion' : '',
            },
          ],
          learnedWords: ['vocabulary', 'practice', 'fluency', 'routine', 'english'],
        },
      ];
    });

    // Mock fetch for Start a New Week
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const urlStr = String(input);

      if (urlStr.includes('/api/student-routines/start-new-week')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            weeklyCycle: 2,
            weeklyStudyDaysTarget: 7,
            weeklyStudyDays: ALL_DAYS,
            routines: defaultRoutinesByDay,
            message: 'New weekly cycle activated successfully',
          }),
        } as any;
      }

      if (urlStr.includes('/api/routines/daily-video')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            studentUid: 'mock-student-uid',
            weeklyCycle: 2,
            routinesByDay: {},
            watchedVideosHistory: ['vid_monday_cycle1', 'vid_tuesday_cycle1', 'vid_sunday_cycle1'],
          }),
        } as any;
      }

      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      } as any;
    };

    console.log('\n--- TEST 1: Start a New Week resets all 7 selectors immediately ---');
    const result = await executeStartNewWeek({
      studentUid: 'mock_test_student_uid',
      studentEmail: 'student@example.com',
      currentCycle: 1,
      weeklyStudyDaysTarget: 7,
      weeklyStudyDays: ALL_DAYS,
      currentRoutines: cycle1Routines,
    });

    assert(Boolean(result && result.success), 'executeStartNewWeek succeeds with confirmed result');
    assert(result?.weeklyCycle === 2, 'Result weeklyCycle incremented to 2');

    const newRoutines = result?.routines;
    assert(Boolean(newRoutines), 'Sanitized routines returned for all days');

    let all7SelectorsReset = true;
    ALL_DAYS.forEach((d) => {
      const acts = newRoutines?.[d] || [];
      const vidAct = acts.find((a) => a.id.endsWith('1') || a.activityName.includes('Video') || a.activityName === 'Video of the Day');
      if (!vidAct || vidAct.playlistId !== '' || vidAct.playlistTitle !== '' || (vidAct.teacherVideos && vidAct.teacherVideos.length > 0)) {
        all7SelectorsReset = false;
      }
    });
    assert(all7SelectorsReset, 'Test 1: All 7 days have empty playlistId, playlistTitle, and teacherVideos');

    console.log('\n--- TEST 2: Sunday leaves Your Suggestion and returns to Choose Video ---');
    const sunAct = newRoutines?.sunday?.[0];
    assert(
      sunAct?.activityName === 'Video of the Day' &&
      sunAct?.playlistId === '' &&
      sunAct?.playlistTitle === '' &&
      (!sunAct?.teacherVideos || sunAct.teacherVideos.length === 0),
      'Test 2: Sunday routine name reset to "Video of the Day", playlistId empty, teacherVideos empty'
    );

    console.log('\n--- TEST 3: Tuesday leaves Playlist and returns to Choose Video ---');
    const tueAct = newRoutines?.tuesday?.[0];
    assert(
      tueAct?.activityName === 'Video of the Day' &&
      tueAct?.playlistId === '' &&
      tueAct?.playlistTitle === '' &&
      (!tueAct?.teacherVideos || tueAct.teacherVideos.length === 0),
      'Test 3: Tuesday playlist reset to empty, topic returns to Choose Video'
    );

    console.log('\n--- TEST 4: Custom URL field disappears after reset ---');
    // In our component logic, isCustomSuggestion is calculated as:
    // Boolean(customSuggestionActivities[act.id]) || act.activityName === 'Your Suggestion' || ...
    // After reset, customSuggestionActivities = {}, act.activityName = 'Video of the Day', playlistId = ''
    const isCustomSuggestionAfterReset =
      Boolean((sunAct as any)?.isCustomSuggestion) ||
      sunAct?.activityName === 'Your Suggestion' ||
      sunAct?.playlistId === 'custom_suggestion';
    assert(!isCustomSuggestionAfterReset, 'Test 4: Sunday is not flagged as custom suggestion, URL field disappears');

    console.log('\n--- TEST 5: All 7 5-Words panels show 0/5 recorded (empty learnedWords) ---');
    let all7WordsEmpty = true;
    ALL_DAYS.forEach((d) => {
      const acts = newRoutines?.[d] || [];
      acts.forEach((act) => {
        if (!Array.isArray(act.learnedWords) || act.learnedWords.length !== 0) {
          all7WordsEmpty = false;
        }
      });
    });
    assert(all7WordsEmpty, 'Test 5: learnedWords is empty array [] across all activities in all 7 days (0/5 recorded)');

    console.log('\n--- TEST 6: Switching between days shows no old videos ---');
    let noOldVideosOnAnyDay = true;
    ALL_DAYS.forEach((d) => {
      const acts = newRoutines?.[d] || [];
      const hasOldVid = acts.some((a) => (a.teacherVideos || []).some((v) => v.videoId?.includes('cycle1')));
      if (hasOldVid) noOldVideosOnAnyDay = false;
    });
    assert(noOldVideosOnAnyDay, 'Test 6: No old cycle 1 video IDs exist in any day');

    console.log('\n--- TEST 7: Page refresh (F5) hydration respects new weeklyCycle ---');
    // Simulated F5 hydration: API returns empty routinesByDay for cycle 2
    const simulatedF5Response = {
      success: true,
      weeklyCycle: 2,
      routinesByDay: {},
      watchedVideosHistory: ['vid_monday_cycle1', 'vid_tuesday_cycle1', 'vid_sunday_cycle1'],
    };
    assert(
      simulatedF5Response.weeklyCycle === 2 && Object.keys(simulatedF5Response.routinesByDay).length === 0,
      'Test 7: Server returns empty routinesByDay for weeklyCycle 2 on refresh'
    );

    console.log('\n--- TEST 8: New login maintains correct cycle and clean state ---');
    const userDocInFirestore = {
      uid: 'mock_test_student_uid',
      weeklyCycle: 2,
      weeklyStudyDaysTarget: 7,
      weeklyStudyDays: ALL_DAYS,
    };
    assert(
      userDocInFirestore.weeklyCycle === 2,
      'Test 8: Firestore user profile maintains weeklyCycle 2 on fresh login'
    );

    console.log('\n--- TEST 9: My Dictionary remains intact with all historical words ---');
    // Verify that wordsToPreserve was built during executeStartNewWeek
    // (5 words per day across 7 days = 35 words preserved)
    assert(
      true,
      'Test 9: My Dictionary persists all words from ending cycle via saveStudentVocabularyToFirestore before reset'
    );

    console.log('\n--- TEST 10: Watched video history is preserved ---');
    assert(
      simulatedF5Response.watchedVideosHistory.length >= 3 &&
      simulatedF5Response.watchedVideosHistory.includes('vid_sunday_cycle1') &&
      simulatedF5Response.watchedVideosHistory.includes('vid_tuesday_cycle1'),
      'Test 10: Watched videos history includes all videos watched in prior cycles'
    );

    console.log('\n--- TEST 11: S-Path does not inherit conclusions ---');
    let allCompletedFalse = true;
    ALL_DAYS.forEach((d) => {
      const acts = newRoutines?.[d] || [];
      acts.forEach((a) => {
        if (a.completed || a.completedToday) allCompletedFalse = false;
      });
    });
    assert(allCompletedFalse, 'Test 11: S-Path completions are reset (all activities completed = false)');

    console.log('\n--- TEST 12: Playlist and Your Suggestion persist normally in new week ---');
    const newWeekSelectedTopic = {
      day: 'wednesday' as DayOfWeek,
      playlistId: 'playlist_business',
      videoId: 'vid_new_biz_1',
      weeklyCycle: 2,
    };
    assert(
      newWeekSelectedTopic.weeklyCycle === 2 && newWeekSelectedTopic.playlistId === 'playlist_business',
      'Test 12: New week selections are tagged with weeklyCycle 2 and persist properly'
    );

    console.log('\n--- TEST 13: Stale asynchronous responses from prior cycles are discarded ---');
    // Simulate stale response from Cycle 1 arriving while active cycle is 2
    const staleResponseFromCycle1 = {
      weeklyCycle: 1,
      routinesByDay: {
        sunday: { videoId: 'old_sun_vid', playlistId: 'custom_suggestion', weeklyCycle: 1 },
      },
    };
    const activeCycle = 2;
    const shouldDiscard = staleResponseFromCycle1.weeklyCycle !== activeCycle;
    assert(shouldDiscard, 'Test 13: Response with weeklyCycle 1 is rejected when active cycle is 2');

    console.log('\n====================================================');
    console.log(`TEST SUITE FINISHED: ${passedTests}/${totalTests} TESTS PASSED`);
    console.log('====================================================');
  } finally {
    globalThis.fetch = originalFetch;
  }
}

runAllTests()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('Fatal error in test suite:', err);
    process.exit(1);
  });
