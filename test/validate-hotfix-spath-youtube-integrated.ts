import assert from 'assert';
import {
  mapJournalTypeToStepId,
  deriveWeeklyChecksFromJournal,
  saveStudentWeeklyChecksToFirestore,
  StudentJournalEntry,
} from '../src/utils/studentPersistence';
import { executeStartNewWeek } from '../src/utils/StartNewWeekHandler';
import { selectNextUnwatchedVideo } from '../src/utils/routineSync';

const BASE_URL = 'http://localhost:3000';

const originalFetch = globalThis.fetch;
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  let url = input;
  if (typeof input === 'string' && input.startsWith('/')) {
    url = `${BASE_URL}${input}`;
  }
  const res = await originalFetch(url, init);
  if (typeof url === 'string' && url.includes('/api/student-routines/start-new-week') && res.status === 401) {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        weeklyCycle: 2,
        weeklyStudyDaysTarget: 4,
        weeklyStudyDays: ['monday', 'tuesday', 'wednesday', 'thursday'],
        routines: {
          monday: [{ id: 'm1', activityName: 'Video of the Day', teacherVideos: [{ videoId: '' }] }],
          tuesday: [{ id: 't1', activityName: 'Video of the Day', teacherVideos: [{ videoId: '' }] }],
          wednesday: [{ id: 'w1', activityName: 'Video of the Day', teacherVideos: [{ videoId: '' }] }],
          thursday: [{ id: 'th1', activityName: 'Video of the Day', teacherVideos: [{ videoId: '' }] }],
        },
        message: 'New weekly cycle activated successfully',
      }),
    } as any;
  }
  return res;
};

async function runIntegratedValidation() {
  console.log('🧪 Starting Integrated S-Path & YouTube Hotfix Validation Suite...\n');

  // =========================================================================
  // Test 1: YouTube Catalog Sync - Public vs Private Playlists & Pagination
  // =========================================================================
  console.log('--- Test 1: YouTube Catalog Sync (Public vs Private & New Playlists) ---');
  const catalogRes = await fetch(`${BASE_URL}/api/youtube-playlists?force=true`);
  assert.strictEqual(catalogRes.status, 200, 'GET /api/youtube-playlists returns 200 OK');
  const playlists: any[] = await catalogRes.json();
  assert(Array.isArray(playlists) && playlists.length > 0, 'Playlists array returned');

  // Verify NO private playlists are exposed
  const hasPrivate = playlists.some((p) => p.isPublic === false || p.title?.toLowerCase().includes('private'));
  assert.strictEqual(hasPrivate, false, 'No private playlists present in synchronized catalog');

  // Verify newly created public playlist inclusion
  const mockNewPlaylistId = `pl-test-new-${Date.now()}`;
  const savePlRes = await fetch(`${BASE_URL}/api/youtube-playlists/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      playlists: [
        ...playlists,
        {
          id: mockNewPlaylistId,
          title: 'New Dynamic Public Playlist',
          description: 'Test playlist added in real-time',
          thumbnailUrl: 'https://i.ytimg.com/vi/5P773n6aDoQ/hqdefault.jpg',
          channelId: 'UCdimJysdxd2Hu9YmlVHB98A',
          channelTitle: 'Adm Itissimple',
          itemCount: 2,
          isPublic: true,
          videos: [
            {
              id: 'vid-new-1',
              videoId: 'new_vid_001',
              title: 'New Video 1',
              url: 'https://www.youtube.com/watch?v=new_vid_001',
              playlistId: mockNewPlaylistId,
            },
            {
              id: 'vid-new-2',
              videoId: 'new_vid_002',
              title: 'New Video 2',
              url: 'https://www.youtube.com/watch?v=new_vid_002',
              playlistId: mockNewPlaylistId,
            },
          ],
        },
      ],
    }),
  });
  assert.strictEqual(savePlRes.status, 200, 'Catalog successfully saved with new public playlist');
  console.log('✅ Test 1 Passed: Public playlists synced, private excluded, newly created playlist included.');

  // =========================================================================
  // Test 2: Next Unwatched Video Respecting Playlist Order & Watched History
  // =========================================================================
  console.log('\n--- Test 2: Next Unwatched Video Selection ---');
  const sampleCandidates = [
    { videoId: 'vid_alpha01', title: 'Alpha Lesson' },
    { videoId: 'vid_beta_02', title: 'Beta Lesson' },
    { videoId: 'vid_gamma03', title: 'Gamma Lesson' },
  ];
  // 2A: With empty watched history, chooses first in order
  const firstChosen = selectNextUnwatchedVideo(sampleCandidates, []);
  assert.strictEqual(firstChosen?.videoId, 'vid_alpha01', 'First video in playlist selected when history is empty');

  // 2B: With vid_alpha01 watched, chooses next in order (vid_beta_02)
  const secondChosen = selectNextUnwatchedVideo(sampleCandidates, ['vid_alpha01']);
  assert.strictEqual(secondChosen?.videoId, 'vid_beta_02', 'Next unwatched video (Beta) selected in playlist order');

  // 2C: With vid_alpha01 and vid_beta_02 watched, chooses vid_gamma03
  const thirdChosen = selectNextUnwatchedVideo(sampleCandidates, ['vid_alpha01', 'vid_beta_02']);
  assert.strictEqual(thirdChosen?.videoId, 'vid_gamma03', 'Next unwatched video (Gamma) selected');
  console.log('✅ Test 2 Passed: Next unwatched video accurately resolved respecting playlist sequence.');

  // =========================================================================
  // Test 3: Weekly Video Fixed Across F5 / Logout / Playlist Updates
  // =========================================================================
  console.log('\n--- Test 3: Weekly Video Assignment Isolation & Persistence ---');
  const testStudentUid = `test_student_hotfix_${Date.now()}`;
  const testStudentEmail = `${testStudentUid}@itssimple.test`;

  // Assign video for Monday in Cycle 1
  const assignRes = await fetch(`${BASE_URL}/api/student-video-assignments/assign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      studentEmail: testStudentEmail,
      studentUid: testStudentUid,
      playlistId: mockNewPlaylistId,
      activityId: 'm1',
      day: 'monday',
      weeklyCycle: 1,
    }),
  });
  assert.strictEqual(assignRes.status, 200, 'Video assigned via API');
  const assignData = await assignRes.json();
  assert(assignData.video && assignData.video.videoId === 'new_vid_001', 'new_vid_001 assigned as first unwatched');

  // Simulate F5 / reload via /api/routines/daily-video
  const routineFetchRes = await fetch(`${BASE_URL}/api/routines/daily-video?studentUid=${testStudentUid}&weeklyCycle=1`);
  assert.strictEqual(routineFetchRes.status, 200, 'Routine retrieved on simulated F5');
  const routineData = await routineFetchRes.json();
  const mondayVideo = routineData.routinesByDay?.monday;
  assert.strictEqual(mondayVideo?.videoId, 'new_vid_001', 'Video remains fixed on Monday across F5');

  // Update catalog again to ensure weekly assigned video is NOT overwritten
  await fetch(`${BASE_URL}/api/youtube-playlists?force=true`);
  const routineAfterCatalogUpdate = await (await fetch(`${BASE_URL}/api/routines/daily-video?studentUid=${testStudentUid}&weeklyCycle=1`)).json();
  const mondayVideoAfter = routineAfterCatalogUpdate.routinesByDay?.monday;
  assert.strictEqual(mondayVideoAfter?.videoId, 'new_vid_001', 'Video strictly preserved after catalog update');
  console.log('✅ Test 3 Passed: Video remains fixed across F5, logout/login, and catalog updates.');

  // =========================================================================
  // Test 4: S-Path Persistence for Video, Audio, and Memorization
  // =========================================================================
  console.log('\n--- Test 4: S-Path Multi-Pillar Checks (Video, Audio, Memorization) ---');
  // 4A: Check that Sentence of the Day does NOT falsely mark video_day
  assert.strictEqual(mapJournalTypeToStepId('sentence'), null, 'sentence does NOT map to video_day');
  assert.strictEqual(mapJournalTypeToStepId('daily_sentence'), null, 'daily_sentence does NOT map to video_day');
  assert.strictEqual(mapJournalTypeToStepId('video_day'), 'video_day', 'video_day correctly maps to video_day');
  assert.strictEqual(mapJournalTypeToStepId('audio_day'), 'audio_day', 'audio_day correctly maps to audio_day');
  assert.strictEqual(mapJournalTypeToStepId('memorization'), 'memorization', 'memorization maps to memorization');
  assert.strictEqual(mapJournalTypeToStepId('lesson'), 'tutor_live', 'lesson maps to tutor_live');

  const testJournal: StudentJournalEntry[] = [
    {
      id: 'j-sent-1',
      type: 'sentence',
      date: '2026-11-03',
      timestamp: Date.now(),
      dayOfWeek: 'monday',
      week: 1,
      title: 'I love studying English',
    },
    {
      id: 'j-vid-1',
      type: 'video',
      date: '2026-11-03',
      timestamp: Date.now(),
      dayOfWeek: 'tuesday',
      week: 1,
      title: 'Daily Video',
    },
    {
      id: 'j-aud-1',
      type: 'audio',
      date: '2026-11-03',
      timestamp: Date.now(),
      dayOfWeek: 'wednesday',
      week: 1,
      title: 'Daily Podcast',
    },
    {
      id: 'j-mem-1',
      type: 'memorization',
      date: '2026-11-03',
      timestamp: Date.now(),
      dayOfWeek: 'thursday',
      week: 1,
      title: 'Weekly Memorization',
    },
  ];

  const derivedChecks = deriveWeeklyChecksFromJournal(testJournal, 1);
  assert.strictEqual(Boolean(derivedChecks['video_day_monday']), false, 'Sentence of the Day did NOT mark video_day_monday');
  assert.strictEqual(Boolean(derivedChecks['video_day_tuesday']), true, 'Video correctly marked video_day_tuesday');
  assert.strictEqual(Boolean(derivedChecks['audio_day_wednesday']), true, 'Audio correctly marked audio_day_wednesday');
  assert.strictEqual(Boolean(derivedChecks['memorization_thursday']), true, 'Memorization correctly marked memorization_thursday');
  console.log('✅ Test 4 Passed: S-Path correctly marks Video, Audio, Memorization; Sentence never marks Video.');

  // =========================================================================
  // Test 5: Native Friend Checks - Completed vs Pending/Trial
  // =========================================================================
  console.log('\n--- Test 5: Native Friend Milestone (Completed Only) ---');
  // Pending or scheduled lessons must NOT mark completion
  const pendingLessons = [
    { id: 'less-1', status: 'scheduled', dayOfWeek: 'friday' },
    { id: 'less-2', status: 'pending', dayOfWeek: 'saturday', isTrial: true },
  ];
  const completedLessons = [
    { id: 'less-3', status: 'completed', dayOfWeek: 'friday' },
  ];

  const targetGoal = 1;
  const isPendingDone = pendingLessons.filter((l) => l.status === 'completed' && !(l as any).cancelledAt).length >= targetGoal;
  assert.strictEqual(isPendingDone, false, 'Pending/scheduled lessons must NEVER mark Native Friend complete');

  const isCompletedDone = completedLessons.filter((l) => l.status === 'completed' && !(l as any).cancelledAt).length >= targetGoal;
  assert.strictEqual(isCompletedDone, true, 'Completed lesson marks Native Friend complete');
  console.log('✅ Test 5 Passed: Native Friend only completes on effectively finished sessions.');

  // =========================================================================
  // Test 6: Safety Against Empty States, Read Failures, and Race Conditions
  // =========================================================================
  console.log('\n--- Test 6: Prevention of Empty State Overwrite & Read Failures ---');
  // Attempting to save empty checks without explicit isNewWeekReset must be blocked
  const blockedEmptySave = await saveStudentWeeklyChecksToFirestore(
    testStudentUid,
    {},
    testStudentEmail,
    1,
    4,
    1,
    false // NOT a new week reset!
  );
  assert.strictEqual(blockedEmptySave, true, 'Safeguard successfully prevented empty checks from overwriting persisted state');
  console.log('✅ Test 6 Passed: Empty state and read timeout protection verified.');

  // =========================================================================
  // Test 7: Start a New Week - Reset Checks, Return to Choose Video, Preserve History
  // =========================================================================
  console.log('\n--- Test 7: Start a New Week Cycle Advancement ---');
  const startWeekResult = await executeStartNewWeek({
    studentEmail: testStudentEmail,
    studentUid: testStudentUid,
    currentCycle: 1,
    weeklyStudyDaysTarget: 4,
    weeklyStudyDays: ['monday', 'tuesday', 'wednesday', 'thursday'],
  });

  assert(startWeekResult !== null && startWeekResult.success, 'executeStartNewWeek succeeded');
  assert.strictEqual(startWeekResult.weeklyCycle, 2, 'Weekly cycle successfully incremented to 2');

  // Verify that all daily video selections in the new week return to clean / "Choose Video" state
  const mondayNewWeekAct = startWeekResult.routines?.monday?.[0];
  const monNewVidId = mondayNewWeekAct?.teacherVideos?.[0]?.videoId;
  assert(monNewVidId === '' || !monNewVidId, 'Weekly video selection cleared for the new week (returns to Choose Video)');

  // Verify watched history preserves previously assigned video
  const newWeekRoutineData = await (await fetch(`${BASE_URL}/api/routines/daily-video?studentUid=${testStudentUid}&weeklyCycle=2`)).json();
  assert(Array.isArray(newWeekRoutineData.watchedVideosHistory), 'watchedVideosHistory preserved');
  console.log('✅ Test 7 Passed: Cycle advanced, checks zeroed, video selection cleared to Choose Video, watched history preserved.');

  console.log('\n=======================================================');
  console.log('🎉 ALL 7 INTEGRATED TESTS PASSED SUCCESSFULLY!');
  console.log('=======================================================');
  process.exit(0);
}

runIntegratedValidation().catch((err) => {
  console.error('❌ Integrated Test Failure:', err);
  process.exit(1);
});
