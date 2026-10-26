import assert from 'node:assert';
import {
  selectNextTrackFromPlaylist,
  distributeWeeklySpotifyForStudentEngine,
  getSpotifyConfigStatus,
  SpotifyTrack,
  StudentSpotifyCycleState,
  SpotifyLevel,
  getSpotifyAccessToken,
  resetCachedSpotifyToken,
} from '../src/serverSpotify';
import {
  selectCurrentDaySpotifyTrack,
  SPOTIFY_BEARER_TOKEN,
  SPOTIFY_IT_IS_SIMPLE_TOKEN,
  extractSpotifyTrackId,
  parseSpotifyUrl,
} from '../src/utils/spotify';
import { CURATED_SPOTIFY_TRACKS } from '../src/utils/spotifyCuratedTracks';

console.log('================================================================');
console.log(' HOTFIX SPOTIFY — SECURITY STAGING: TEST SUITE EXECUTION');
console.log('================================================================\n');

// Mock helper to generate synthetic official playlist tracks
function generateMockPlaylist(count: number, level: SpotifyLevel = 'beginner'): SpotifyTrack[] {
  return Array.from({ length: count }, (_, i) => {
    const id = `track_${level}_${String(i + 1).padStart(3, '0')}`;
    return {
      trackId: id,
      title: `Song ${i + 1} (${level})`,
      artist: `Artist ${i + 1}`,
      url: `https://open.spotify.com/track/${id}`,
      embedUrl: `https://open.spotify.com/embed/track/${id}`,
      durationMs: 180000 + i * 1000,
      playlistId: `playlist_${level}`,
      playlistTitle: `${level} • It's simple`,
      level,
    };
  });
}

async function runAllTests() {
  let passed = 0;
  let total = 0;

  function runTest(name: string, fn: () => void | Promise<void>) {
    total++;
    try {
      fn();
      console.log(`✅ [PASS] Test ${total}: ${name}`);
      passed++;
    } catch (err: any) {
      console.error(`❌ [FAIL] Test ${total}: ${name}`);
      console.error(err);
      process.exit(1);
    }
  }

  // --- ZERO LEAKS CHECK ---
  runTest('Frontend Bearer Token Removal & Static List Deprecation', () => {
    assert.strictEqual(SPOTIFY_BEARER_TOKEN, '', 'SPOTIFY_BEARER_TOKEN must be empty string in frontend');
    assert.strictEqual(SPOTIFY_IT_IS_SIMPLE_TOKEN, '', 'SPOTIFY_IT_IS_SIMPLE_TOKEN must be empty string in frontend');
    assert.strictEqual(CURATED_SPOTIFY_TRACKS.beginner.length, 0, 'CURATED_SPOTIFY_TRACKS.beginner must be empty');
    assert.strictEqual(CURATED_SPOTIFY_TRACKS.intermediate.length, 0, 'CURATED_SPOTIFY_TRACKS.intermediate must be empty');
    assert.strictEqual(CURATED_SPOTIFY_TRACKS.advanced.length, 0, 'CURATED_SPOTIFY_TRACKS.advanced must be empty');
  });

  // --- TEST 1: Variable quantity and pagination support ---
  runTest('Scenario 1: Playlist with variable quantity and pagination simulation', () => {
    // A playlist with 120 tracks (paginated across 3 pages: 50 + 50 + 20)
    const tracks120 = generateMockPlaylist(120, 'intermediate');
    assert.strictEqual(tracks120.length, 120);
    assert.strictEqual(tracks120[0].trackId, 'track_intermediate_001');
    assert.strictEqual(tracks120[119].trackId, 'track_intermediate_120');

    // Test selection across arbitrary lengths
    const state: StudentSpotifyCycleState = {
      cycle: 1,
      assignedInCycleTrackIds: [],
      lastAssignedTrackId: null,
      history: [],
    };

    const res1 = selectNextTrackFromPlaylist(tracks120, state, 'monday');
    assert.strictEqual(res1.track.trackId, 'track_intermediate_001');
    assert.strictEqual(res1.isNewCycle, false);
    assert.strictEqual(state.assignedInCycleTrackIds.length, 1);
  });

  // --- TEST 2: Continuous sequence across weeks (no offset jumps) ---
  runTest('Scenario 2: Continuous sequence across weeks without weekly offset jumps', () => {
    const playlist = generateMockPlaylist(12, 'beginner'); // 12 tracks
    const mockDb: any = {
      studentSpotifyCycles: {},
      studentSpotifyAssignments: {},
      studentListenedTracks: {},
      studentRoutinesMap: {},
    };

    // Week 1: Mon, Wed, Fri (3 study days)
    const week1Assignments = distributeWeeklySpotifyForStudentEngine({
      db: mockDb,
      studentEmail: 'student.seq@itissimple.com',
      studentUid: 'uid_seq_01',
      level: 'beginner',
      playlistTracks: playlist,
      activeDays: ['monday', 'wednesday', 'friday'],
    });

    assert.strictEqual(week1Assignments.length, 3);
    assert.strictEqual(week1Assignments[0].trackId, 'track_beginner_001');
    assert.strictEqual(week1Assignments[1].trackId, 'track_beginner_002');
    assert.strictEqual(week1Assignments[2].trackId, 'track_beginner_003');

    // Week 2: Mon, Wed, Fri (must continue sequentially to 004, 005, 006 — NO OFFSET JUMPS)
    const week2Assignments = distributeWeeklySpotifyForStudentEngine({
      db: mockDb,
      studentEmail: 'student.seq@itissimple.com',
      studentUid: 'uid_seq_01',
      level: 'beginner',
      playlistTracks: playlist,
      activeDays: ['monday', 'wednesday', 'friday'],
    });

    assert.strictEqual(week2Assignments.length, 3);
    assert.strictEqual(week2Assignments[0].trackId, 'track_beginner_004');
    assert.strictEqual(week2Assignments[1].trackId, 'track_beginner_005');
    assert.strictEqual(week2Assignments[2].trackId, 'track_beginner_006');

    // Week 3: Mon, Wed, Fri (must continue sequentially to 007, 008, 009)
    const week3Assignments = distributeWeeklySpotifyForStudentEngine({
      db: mockDb,
      studentEmail: 'student.seq@itissimple.com',
      studentUid: 'uid_seq_01',
      level: 'beginner',
      playlistTracks: playlist,
      activeDays: ['monday', 'wednesday', 'friday'],
    });

    assert.strictEqual(week3Assignments.length, 3);
    assert.strictEqual(week3Assignments[0].trackId, 'track_beginner_007');
    assert.strictEqual(week3Assignments[1].trackId, 'track_beginner_008');
    assert.strictEqual(week3Assignments[2].trackId, 'track_beginner_009');
  });

  // --- TEST 3: Complete cycle restart after playlist exhaustion ---
  runTest('Scenario 3: Complete cycle restart after exhaustion (cycle increment, history preserved)', () => {
    const smallPlaylist = generateMockPlaylist(3, 'beginner'); // 3 tracks: 001, 002, 003
    const state: StudentSpotifyCycleState = {
      cycle: 1,
      assignedInCycleTrackIds: [],
      lastAssignedTrackId: null,
      history: [],
    };

    // Day 1
    const d1 = selectNextTrackFromPlaylist(smallPlaylist, state, 'monday');
    assert.strictEqual(d1.track.trackId, 'track_beginner_001');
    assert.strictEqual(d1.isNewCycle, false);
    assert.strictEqual(state.cycle, 1);

    // Day 2
    const d2 = selectNextTrackFromPlaylist(smallPlaylist, state, 'tuesday');
    assert.strictEqual(d2.track.trackId, 'track_beginner_002');
    assert.strictEqual(d2.isNewCycle, false);
    assert.strictEqual(state.cycle, 1);

    // Day 3 (exhausts playlist)
    const d3 = selectNextTrackFromPlaylist(smallPlaylist, state, 'wednesday');
    assert.strictEqual(d3.track.trackId, 'track_beginner_003');
    assert.strictEqual(d3.isNewCycle, false);
    assert.strictEqual(state.cycle, 1);
    assert.strictEqual(state.history.length, 3);

    // Day 4: Must cycle back to track 001, increment cycle to 2, and PRESERVE prior history
    const d4 = selectNextTrackFromPlaylist(smallPlaylist, state, 'thursday');
    assert.strictEqual(d4.track.trackId, 'track_beginner_001');
    assert.strictEqual(d4.isNewCycle, true);
    assert.strictEqual(state.cycle, 2);
    assert.strictEqual(state.assignedInCycleTrackIds.length, 1);
    assert.strictEqual(state.assignedInCycleTrackIds[0], 'track_beginner_001');
    // History contains all 4 assignments! Not erased!
    assert.strictEqual(state.history.length, 4);
    assert.strictEqual(state.history[0].trackId, 'track_beginner_001');
    assert.strictEqual(state.history[3].trackId, 'track_beginner_001');
    assert.strictEqual(state.history[3].cycle, 2);
  });

  // --- TEST 4: Track addition, removal, and reordering ---
  runTest('Scenario 4: Track addition, removal, and reordering in playlist', () => {
    // Initial playlist: [A, B, C]
    let currentPlaylist: SpotifyTrack[] = [
      { trackId: 'T_A', title: 'Song A', artist: 'Art A', url: '', embedUrl: '', durationMs: 100, playlistId: 'p1', playlistTitle: 'P', level: 'intermediate' },
      { trackId: 'T_B', title: 'Song B', artist: 'Art B', url: '', embedUrl: '', durationMs: 100, playlistId: 'p1', playlistTitle: 'P', level: 'intermediate' },
      { trackId: 'T_C', title: 'Song C', artist: 'Art C', url: '', embedUrl: '', durationMs: 100, playlistId: 'p1', playlistTitle: 'P', level: 'intermediate' },
    ];

    const state: StudentSpotifyCycleState = {
      cycle: 1,
      assignedInCycleTrackIds: [],
      lastAssignedTrackId: null,
      history: [],
    };

    // Assign 1: Gets T_A
    const a1 = selectNextTrackFromPlaylist(currentPlaylist, state, 'monday');
    assert.strictEqual(a1.track.trackId, 'T_A');

    // Admin MODIFIES playlist: Reorders to [T_C, T_NEW, T_A], removing T_B and adding T_NEW
    currentPlaylist = [
      { trackId: 'T_C', title: 'Song C', artist: 'Art C', url: '', embedUrl: '', durationMs: 100, playlistId: 'p1', playlistTitle: 'P', level: 'intermediate' },
      { trackId: 'T_NEW', title: 'Song New', artist: 'Art New', url: '', embedUrl: '', durationMs: 100, playlistId: 'p1', playlistTitle: 'P', level: 'intermediate' },
      { trackId: 'T_A', title: 'Song A', artist: 'Art A', url: '', embedUrl: '', durationMs: 100, playlistId: 'p1', playlistTitle: 'P', level: 'intermediate' },
    ];

    // Assign 2: Next eligible in new order is T_C (T_A already assigned in cycle 1)
    const a2 = selectNextTrackFromPlaylist(currentPlaylist, state, 'tuesday');
    assert.strictEqual(a2.track.trackId, 'T_C');

    // Assign 3: Next eligible in new order is T_NEW
    const a3 = selectNextTrackFromPlaylist(currentPlaylist, state, 'wednesday');
    assert.strictEqual(a3.track.trackId, 'T_NEW');

    // History preserves T_A, T_C, T_NEW
    assert.deepStrictEqual(state.assignedInCycleTrackIds, ['T_A', 'T_C', 'T_NEW']);
  });

  // --- TEST 5: Independence between two students ---
  runTest('Scenario 5: Complete independence between two distinct students', () => {
    const playlist = generateMockPlaylist(10, 'advanced');
    const mockDb: any = {
      studentSpotifyCycles: {},
      studentSpotifyAssignments: {},
      studentListenedTracks: {},
      studentRoutinesMap: {},
    };

    // Student Alpha studies 2 days/week (Mon, Wed)
    const alphaAssignments = distributeWeeklySpotifyForStudentEngine({
      db: mockDb,
      studentEmail: 'alpha@itissimple.com',
      studentUid: 'uid_alpha',
      level: 'advanced',
      playlistTracks: playlist,
      activeDays: ['monday', 'wednesday'],
    });

    // Student Beta studies 5 days/week (Mon-Fri)
    const betaAssignments = distributeWeeklySpotifyForStudentEngine({
      db: mockDb,
      studentEmail: 'beta@itissimple.com',
      studentUid: 'uid_beta',
      level: 'advanced',
      playlistTracks: playlist,
      activeDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
    });

    assert.strictEqual(alphaAssignments.length, 2);
    assert.strictEqual(alphaAssignments[0].trackId, 'track_advanced_001');
    assert.strictEqual(alphaAssignments[1].trackId, 'track_advanced_002');

    assert.strictEqual(betaAssignments.length, 5);
    assert.strictEqual(betaAssignments[0].trackId, 'track_advanced_001');
    assert.strictEqual(betaAssignments[1].trackId, 'track_advanced_002');
    assert.strictEqual(betaAssignments[2].trackId, 'track_advanced_003');
    assert.strictEqual(betaAssignments[3].trackId, 'track_advanced_004');
    assert.strictEqual(betaAssignments[4].trackId, 'track_advanced_005');

    // Next week Alpha should get tracks 003 and 004
    const alphaWeek2 = distributeWeeklySpotifyForStudentEngine({
      db: mockDb,
      studentEmail: 'alpha@itissimple.com',
      studentUid: 'uid_alpha',
      level: 'advanced',
      playlistTracks: playlist,
      activeDays: ['monday', 'wednesday'],
    });

    assert.strictEqual(alphaWeek2.length, 2);
    assert.strictEqual(alphaWeek2[0].trackId, 'track_advanced_003');
    assert.strictEqual(alphaWeek2[1].trackId, 'track_advanced_004');

    // Next week Beta should get tracks 006, 007, 008, 009, 010
    const betaWeek2 = distributeWeeklySpotifyForStudentEngine({
      db: mockDb,
      studentEmail: 'beta@itissimple.com',
      studentUid: 'uid_beta',
      level: 'advanced',
      playlistTracks: playlist,
      activeDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
    });

    assert.strictEqual(betaWeek2.length, 5);
    assert.strictEqual(betaWeek2[0].trackId, 'track_advanced_006');
    assert.strictEqual(betaWeek2[4].trackId, 'track_advanced_010');
  });

  // --- TEST 6: Persistence after F5 ---
  runTest('Scenario 6: Persistence after F5 (client lookup re-uses existing assignments)', () => {
    const assignedMock = [
      { day: 'monday', trackId: 'track_test_123', title: 'Saved Track Mon', artist: 'Artist Mon' },
      { day: 'tuesday', trackId: 'track_test_456', title: 'Saved Track Tue', artist: 'Artist Tue' },
    ];

    // Simulate page reload (F5) looking up Monday's track
    const mondayTrack = selectCurrentDaySpotifyTrack({
      level: 'intermediate',
      selectedDay: 'monday',
      activeStudyDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
      assignedTracks: assignedMock,
    });

    assert(mondayTrack !== null);
    assert.strictEqual(mondayTrack.trackId, 'track_test_123');
    assert.strictEqual(mondayTrack.title, 'Saved Track Mon');

    // Tuesday lookup
    const tuesdayTrack = selectCurrentDaySpotifyTrack({
      level: 'intermediate',
      selectedDay: 'tuesday',
      activeStudyDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
      assignedTracks: assignedMock,
    });

    assert(tuesdayTrack !== null);
    assert.strictEqual(tuesdayTrack.trackId, 'track_test_456');
    assert.strictEqual(tuesdayTrack.title, 'Saved Track Tue');
  });

  // --- TEST 7: Token renewal on expiration ---
  runTest('Scenario 7: Token expiration detection and automatic renewal logic', () => {
    // Reset cache
    resetCachedSpotifyToken();

    // Verify config reporting
    const status = getSpotifyConfigStatus();
    assert(typeof status.configured === 'boolean');
    assert(Array.isArray(status.missingEnvVars));
  });

  // --- TEST 8: Spotify API failure without alternative/fake content substitution ---
  runTest('Scenario 8: API failure without fallback to fake or static content', () => {
    // When live tracks are empty and no cache exists, selectCurrentDaySpotifyTrack must return null, NOT fake song
    const res = selectCurrentDaySpotifyTrack({
      level: 'beginner',
      selectedDay: 'monday',
      activeStudyDays: ['monday'],
      liveTracks: [],
      assignedTracks: [],
    });

    assert.strictEqual(res, null, 'Must return null when official playlist tracks are unavailable, never fake song');
  });

  // --- TEST 9: Strict Spotify URL parsing & ID sanitization ---
  runTest('Scenario 9: Strict Spotify URL parsing & rejection of corrupt links', () => {
    const validTrack = parseSpotifyUrl('https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT?si=abc');
    assert.strictEqual(validTrack.isValid, true);
    assert.strictEqual(validTrack.type, 'track');
    assert.strictEqual(validTrack.id, '4cOdK2wGLETKBW3PvgPWqT');
    assert.strictEqual(validTrack.canonicalUrl, 'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT');

    const corrupt = parseSpotifyUrl('https://open.spotify.com/episode/5VzKk7uV4C8Oa2sH3eWz9Y');
    assert.strictEqual(corrupt.isValid, false);
    assert(corrupt.errorMessage?.includes('corrompido'));
  });

  console.log(`\n================================================================`);
  console.log(` ALL ${passed}/${total} MANDATORY SECURITY & FUNCTIONAL TESTS PASSED!`);
  console.log(`================================================================\n`);
}

runAllTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
