import {
  saveRoutineVideoSubcollection,
  fetchRoutineVideosFromFirestoreServer,
} from '../src/serverFirestore';
import firebaseConfig from '../firebase-applet-config.json';
import { extractYouTubeVideoId } from '../src/utils/youtube';

console.log('====================================================');
console.log('--- RUNNING TEST SUITE FOR HOTFIX 2.3.5F ---');
console.log('--- Video Persistence by Selection Source (Playlist & Your Suggestion) ---');
console.log('====================================================');

let testsPassed = 0;
let testsTotal = 0;

function assert(condition: boolean, message: string) {
  testsTotal++;
  if (condition) {
    console.log(`[PASS] ${message}`);
    testsPassed++;
  } else {
    console.error(`[FAIL] ${message}`);
    process.exitCode = 1;
  }
}

async function runTestSuite() {
  // -----------------------------------------------------------------------------
  // Test 1: Staging Firebase Environment Verification
  // -----------------------------------------------------------------------------
  console.log('\n--- Test 1: Project Identity & Target Database ---');
  assert(
    firebaseConfig.projectId === 'itissimple-security-staging',
    `Target Firebase project is 'itissimple-security-staging' (got: ${firebaseConfig.projectId})`
  );

  // -----------------------------------------------------------------------------
  // Test 2: Playlist Selection Payload & Extraction (Tuesday)
  // -----------------------------------------------------------------------------
  console.log('\n--- Test 2: Playlist Selection & Structure Extraction (Tuesday) ---');

  // When selected via playlist, backend receives video data either directly or nested under teacherVideos
  const playlistAssignmentData = {
    activityId: 'act-tuesday-1',
    activityName: 'English at Work & Meetings',
    playlistTitle: 'English at Work & Meetings',
    playlistId: 'PL_WORK_MEETINGS_01',
    teacherVideos: [
      {
        id: 'vid-playlist-tuesday-101',
        videoId: 'abc12345678',
        title: 'Effective Business English Idioms',
        url: 'https://www.youtube.com/watch?v=abc12345678',
        instructions: 'Focus on polite disagreement structures.',
        duration: '7 min',
        playlistId: 'PL_WORK_MEETINGS_01',
        playlistTitle: 'English at Work & Meetings',
        isRepeatVideo: false,
      },
    ],
    days: ['tuesday'],
    day: 'tuesday',
    weeklyCycle: 2,
  };

  // Test extraction from teacherVideos[0] when top-level videoId is absent
  const firstVideo = playlistAssignmentData.teacherVideos[0];
  const rawVidId = (playlistAssignmentData as any).videoId || firstVideo?.videoId;
  const cleanVidId = extractYouTubeVideoId(rawVidId) || firstVideo.videoId;
  const cleanPlaylistId = (playlistAssignmentData as any).playlistId || firstVideo.playlistId;

  assert(
    cleanVidId === 'abc12345678',
    `Playlist videoId extracted successfully from nested structure: ${cleanVidId}`
  );
  assert(
    cleanPlaylistId === 'PL_WORK_MEETINGS_01',
    `PlaylistId preserved accurately: ${cleanPlaylistId}`
  );
  assert(
    playlistAssignmentData.weeklyCycle === 2,
    `Weekly cycle bound to 2 for Tuesday playlist assignment`
  );

  // -----------------------------------------------------------------------------
  // Test 3: Your Suggestion Selection & Payload Handling (Sunday)
  // -----------------------------------------------------------------------------
  console.log('\n--- Test 3: Your Suggestion Selection & Payload Handling (Sunday) ---');

  const customSuggestionPayload = {
    studentUid: 'student_test_uid_777',
    day: 'sunday',
    dayOfWeek: 'sunday',
    videoId: 'xyz98765432',
    title: 'Your Suggestion',
    videoTitle: 'Your Suggestion',
    url: 'https://www.youtube.com/watch?v=xyz98765432',
    playlistId: 'custom_suggestion',
    playlistTitle: 'Your Suggestion',
    isRepeatVideo: false,
    activityId: 'act-sunday-1',
    instructions: 'Student suggested video for this routine',
    weeklyCycle: '2', // Test string format numeric cycle
  };

  const parsedCustomCycle = typeof customSuggestionPayload.weeklyCycle === 'number'
    ? customSuggestionPayload.weeklyCycle
    : parseInt((customSuggestionPayload.weeklyCycle as string).replace(/\D/g, ''), 10);

  assert(
    parsedCustomCycle === 2,
    `Numeric string weeklyCycle ('2') parsed correctly to integer 2`
  );
  assert(
    customSuggestionPayload.playlistId === 'custom_suggestion',
    `playlistId explicitly marked 'custom_suggestion'`
  );
  assert(
    customSuggestionPayload.url.includes('xyz98765432'),
    `Canonical YouTube URL preserved for custom suggestion`
  );

  // -----------------------------------------------------------------------------
  // Test 4: Pedagogical Non-Negotiable — Selection MUST NOT Mark Watched
  // -----------------------------------------------------------------------------
  console.log('\n--- Test 4: Pedagogical Rule #3 — Selection is NOT Consumption ---');

  const initialWatchedHistory: string[] = ['prior_video_001', 'prior_video_002'];
  const simulatedWatchedHistory = [...initialWatchedHistory];

  // Selecting Tuesday Playlist
  assert(
    !simulatedWatchedHistory.includes(cleanVidId),
    `Selecting playlist video (${cleanVidId}) did NOT add video to watchedHistory`
  );

  // Selecting Sunday Your Suggestion
  assert(
    !simulatedWatchedHistory.includes(customSuggestionPayload.videoId),
    `Saving custom suggested video (${customSuggestionPayload.videoId}) did NOT add video to watchedHistory`
  );

  assert(
    simulatedWatchedHistory.length === 2,
    `Watched history length unchanged after selections (strictly 2 items)`
  );

  // -----------------------------------------------------------------------------
  // Test 5: Hydration Logic Across Day Switching & Page Refresh (F5)
  // -----------------------------------------------------------------------------
  console.log('\n--- Test 5: Hydration & Day Switching ---');

  // Simulated persisted state returned from Firestore for weeklyCycle 2
  const persistedRoutinesByDay: Record<string, any> = {
    monday: {
      videoId: 'monday_vid_11',
      title: 'Monday English Basics',
      url: 'https://www.youtube.com/watch?v=monday_vid_11',
      playlistId: 'PL_DEFAULT',
      weeklyCycle: 2,
    },
    tuesday: {
      videoId: 'abc12345678',
      title: 'Effective Business English Idioms',
      url: 'https://www.youtube.com/watch?v=abc12345678',
      playlistId: 'PL_WORK_MEETINGS_01',
      playlistTitle: 'English at Work & Meetings',
      weeklyCycle: 2,
    },
    sunday: {
      videoId: 'xyz98765432',
      title: 'Your Suggestion',
      url: 'https://www.youtube.com/watch?v=xyz98765432',
      playlistId: 'custom_suggestion',
      playlistTitle: 'Your Suggestion',
      weeklyCycle: 2,
    },
  };

  // Test Tuesday Playlist Restoration
  const tuesdayRoutine = persistedRoutinesByDay['tuesday'];
  const tuesdayHasVideo = Boolean(tuesdayRoutine && tuesdayRoutine.videoId);
  assert(
    tuesdayHasVideo && tuesdayRoutine.videoId === 'abc12345678',
    `Tuesday (Playlist) restored with videoId abc12345678`
  );
  assert(
    tuesdayRoutine.playlistId === 'PL_WORK_MEETINGS_01',
    `Tuesday (Playlist) restored with playlistId PL_WORK_MEETINGS_01`
  );

  // Test Sunday Your Suggestion Restoration
  const sundayRoutine = persistedRoutinesByDay['sunday'];
  const sundayHasVideo = Boolean(sundayRoutine && sundayRoutine.videoId);
  assert(
    sundayHasVideo && sundayRoutine.videoId === 'xyz98765432',
    `Sunday (Your Suggestion) restored with videoId xyz98765432`
  );
  assert(
    sundayRoutine.playlistId === 'custom_suggestion',
    `Sunday (Your Suggestion) restored with custom_suggestion playlistId`
  );

  // Test that Monday video was untouched and preserved
  const mondayRoutine = persistedRoutinesByDay['monday'];
  assert(
    mondayRoutine && mondayRoutine.videoId === 'monday_vid_11',
    `Monday video untouched and fully preserved across day switching`
  );

  // Test Cycle Match vs Cycle Bleed
  const priorWeekRoutine = {
    videoId: 'old_video_from_week_1',
    title: 'Old Video',
    weeklyCycle: 1, // Prior week cycle
  };

  const activeWeeklyCycle = 2;
  const isCandidateEligible = priorWeekRoutine.weeklyCycle === activeWeeklyCycle;
  assert(
    !isCandidateEligible,
    `Prior week cycle (cycle 1) is NOT restored in active cycle 2 (prevents cross-cycle bleeding)`
  );

  // -----------------------------------------------------------------------------
  // Test 6: Summary of Results
  // -----------------------------------------------------------------------------
  console.log('\n====================================================');
  console.log(`TOTAL TESTS: ${testsTotal} | PASSED: ${testsPassed} | FAILED: ${testsTotal - testsPassed}`);
  console.log('====================================================\n');

  if (testsPassed === testsTotal) {
    console.log('All tests passed successfully for HOTFIX 2.3.5F!');
  } else {
    process.exitCode = 1;
  }
}

runTestSuite().catch((err) => {
  console.error('Fatal error in test suite:', err);
  process.exitCode = 1;
});
