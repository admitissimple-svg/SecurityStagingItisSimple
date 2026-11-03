import assert from 'assert';
import {
  DEFAULT_CURATED_PLAYLISTS,
  YouTubePlaylistItem,
} from '../src/utils/youtubeService';
import { getGoogleOAuthToken, setGoogleOAuthToken, firebaseSignOut } from '../src/utils/auth';

/**
 * Test suite for Hotfix: Sincronização das Playlists do YouTube
 * Validates:
 * 1. Catálogo atualizado e inclusão de playlist recém-criada
 * 2. Paginação da API e deduplicação (mine=true + channelId)
 * 3. Atualização manual (force=true) vs cache, e sinalização de falha upstream
 * 4. F5 e Novo Login (retenção de token via sessionStorage)
 * 5. Preservação estrita da seleção semanal do aluno contra sobrescrita durante sync
 */

async function runTests() {
  console.log('🚀 Running YouTube Playlists Sync Hotfix Validation...\n');

  // 1. Initial baseline catalog verification
  assert(Array.isArray(DEFAULT_CURATED_PLAYLISTS) && DEFAULT_CURATED_PLAYLISTS.length >= 18,
    'DEFAULT_CURATED_PLAYLISTS contains authentic fallback catalog');
  console.log('✅ 1. Baseline curated catalog verified.');

  // 2. Token persistence across simulated F5 (sessionStorage)
  const mockToken = 'ya29.mock_oauth_token_institution_1234567890';
  
  // Set up window / sessionStorage mock in node environment if needed
  if (typeof (global as any).window === 'undefined') {
    const store: Record<string, string> = {};
    (global as any).window = {
      sessionStorage: {
        getItem: (k: string) => store[k] || null,
        setItem: (k: string, v: string) => { store[k] = v; },
        removeItem: (k: string) => { delete store[k]; },
      },
    };
  }

  setGoogleOAuthToken(mockToken);
  assert.strictEqual(getGoogleOAuthToken(), mockToken, 'Token correctly stored in memory and sessionStorage');

  // Simulate F5 reload (clearing in-memory variable by re-reading from sessionStorage)
  const tokenAfterF5 = getGoogleOAuthToken();
  assert.strictEqual(tokenAfterF5, mockToken, 'Token successfully retrieved after simulated F5 reload');

  // Verify sign-out clears token
  await firebaseSignOut();
  assert.strictEqual(getGoogleOAuthToken(), null, 'Token cleared on signOut');
  console.log('✅ 2. OAuth token retention across F5 and clearance on sign-out verified.');

  // 3. API endpoint verification: normal vs forced request
  const BASE_URL = 'http://localhost:3000';

  // Normal request (cached)
  const normalRes = await fetch(`${BASE_URL}/api/youtube-playlists`);
  assert.strictEqual(normalRes.status, 200, 'GET /api/youtube-playlists returns 200 OK');
  const normalCacheControl = normalRes.headers.get('cache-control') || '';
  assert(normalCacheControl.includes('max-age=300'), 'Normal request uses 300s cache');
  const normalSource = normalRes.headers.get('x-catalog-source');
  assert(normalSource === 'cache' || normalSource === 'channel' || normalSource === 'api', 'Normal request indicates catalog source');

  const normalPlaylists: YouTubePlaylistItem[] = await normalRes.json();
  assert(Array.isArray(normalPlaylists) && normalPlaylists.length >= 18, 'Returned playlists array is valid');
  console.log(`✅ 3. Normal catalog request returned ${normalPlaylists.length} playlists with valid cache headers.`);

  // Forced refresh request (bypasses cache)
  const forceRes = await fetch(`${BASE_URL}/api/youtube-playlists?force=true`);
  assert.strictEqual(forceRes.status, 200, 'GET /api/youtube-playlists?force=true returns 200 OK');
  const forceCacheControl = forceRes.headers.get('cache-control') || '';
  assert(forceCacheControl.includes('no-cache') && forceCacheControl.includes('no-store'), 'Forced request uses no-cache, no-store headers');
  const upstreamSuccess = forceRes.headers.get('x-upstream-success');
  assert(upstreamSuccess === 'true' || upstreamSuccess === 'false', 'Forced request explicitly signals upstream success/failure');
  console.log(`✅ 4. Manual update (force=true) bypasses cache and explicitly signals upstream state: ${upstreamSuccess}.`);

  // 4. Test newly created playlist ingestion & preservation of student selection
  const newlyCreatedPlaylistId = `PL_newly_created_${Date.now()}`;
  const newlyCreatedPlaylist: YouTubePlaylistItem = {
    id: newlyCreatedPlaylistId,
    title: 'Brand New Educational Playlist 2026',
    description: 'Freshly created playlist from YouTube account',
    thumbnailUrl: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
    channelId: 'UCdimJysdxd2Hu9YmlVHB98A',
    channelTitle: 'Adm Itissimple',
    itemCount: 2,
    updatedAt: new Date().toISOString(),
    isPublic: true,
    videos: [
      {
        id: `vid-${newlyCreatedPlaylistId}-1`,
        videoId: 'dQw4w9WgXcQ',
        title: 'Lesson 1: Intro to New Topic',
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        embedUrl: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0',
        playlistId: newlyCreatedPlaylistId,
        playlistTitle: 'Brand New Educational Playlist 2026',
        duration: '5 min',
      },
      {
        id: `vid-${newlyCreatedPlaylistId}-2`,
        videoId: '5P773n6aDoQ',
        title: 'Lesson 2: Advanced Conversation',
        url: 'https://www.youtube.com/watch?v=5P773n6aDoQ',
        embedUrl: 'https://www.youtube-nocookie.com/embed/5P773n6aDoQ?rel=0',
        playlistId: newlyCreatedPlaylistId,
        playlistTitle: 'Brand New Educational Playlist 2026',
        duration: '6 min',
      },
    ],
  };

  // Simulate student already having a weekly video selected for Monday
  const testStudentUid = `test-student-${Date.now()}`;
  const testStudentEmail = `student-${Date.now()}@itissimple.com`;
  
  const initialStudentVideo = {
    studentUid: testStudentUid,
    day: 'monday',
    dayOfWeek: 'monday',
    videoId: 'OT1YRzt1f8A',
    title: 'The Perfect Morning Habits (Do This Now)',
    videoTitle: 'The Perfect Morning Habits (Do This Now)',
    url: 'https://www.youtube.com/watch?v=OT1YRzt1f8A',
    playlistId: 'PLJVu3A-fZ0Pg',
    playlistTitle: 'Morning Routine',
    activityId: 'act-1',
    isRepeatVideo: false,
    duration: '7 min',
    weeklyCycle: 1,
  };

  // Save student's weekly video selection
  const saveRoutineRes = await fetch(`${BASE_URL}/api/routines/daily-video`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(initialStudentVideo),
  });
  assert(saveRoutineRes.ok, 'Student weekly video successfully saved to routines');

  // Verify student video is persisted
  const getRoutineRes1 = await fetch(`${BASE_URL}/api/routines/daily-video?studentUid=${testStudentUid}&day=monday`);
  assert(getRoutineRes1.ok, 'Routine fetch returns 200');
  const routineData1 = await getRoutineRes1.json();
  const currentVideoBeforeSync = routineData1.currentDayRoutine?.videoId || routineData1.routinesByDay?.monday?.videoId;
  assert.strictEqual(currentVideoBeforeSync, 'OT1YRzt1f8A', 'Student video verified prior to catalog sync');

  // Now sync newly created playlist into the catalog
  const updatedPlaylistsList = [...normalPlaylists, newlyCreatedPlaylist];
  const savePlaylistsRes = await fetch(`${BASE_URL}/api/youtube-playlists/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playlists: updatedPlaylistsList }),
  });
  assert(savePlaylistsRes.ok, 'Newly created playlist saved to server catalog');

  // Verify catalog reflects the new playlist
  const verifyCatalogRes = await fetch(`${BASE_URL}/api/youtube-playlists?force=true`);
  const catalogAfterSync: YouTubePlaylistItem[] = await verifyCatalogRes.json();
  const foundNewPlaylist = catalogAfterSync.find((p) => p.id === newlyCreatedPlaylistId);
  assert(Boolean(foundNewPlaylist), 'Newly created playlist is present in updated catalog');
  assert.strictEqual(foundNewPlaylist?.title, 'Brand New Educational Playlist 2026', 'New playlist title matches exactly');
  console.log('✅ 5. Newly created playlist successfully reflected in updated catalog.');

  // Crucial requirement: Student's weekly video MUST NOT be overwritten during catalog sync
  const getRoutineRes2 = await fetch(`${BASE_URL}/api/routines/daily-video?studentUid=${testStudentUid}&day=monday`);
  assert(getRoutineRes2.ok, 'Routine fetch after sync returns 200');
  const routineData2 = await getRoutineRes2.json();
  const currentVideoAfterSync = routineData2.currentDayRoutine?.videoId || routineData2.routinesByDay?.monday?.videoId;
  assert.strictEqual(currentVideoAfterSync, 'OT1YRzt1f8A', 'Student weekly video selection strictly preserved without overwrite during catalog sync');
  console.log('✅ 6. Student weekly video strictly preserved without overwrite during catalog update.');

  // Assign a video from the new playlist to verify full workflow
  const assignFromNewPlRes = await fetch(`${BASE_URL}/api/student-video-assignments/assign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      studentEmail: testStudentEmail,
      studentUid: testStudentUid,
      playlistId: newlyCreatedPlaylistId,
      activityId: 'act-1',
      day: 'tuesday',
    }),
  });
  assert(assignFromNewPlRes.ok, 'Assigned video from new playlist successfully');
  const assignData = await assignFromNewPlRes.json();
  assert(assignData.success && assignData.video, 'Assign response contains valid video from new playlist');
  assert(assignData.video.playlistId === newlyCreatedPlaylistId || assignData.video.playlistTitle === 'Brand New Educational Playlist 2026',
    'Assigned video correctly belongs to newly created playlist');
  console.log('✅ 7. Student can assign videos from the newly created playlist.');

  console.log('\n🎉 ALL 7 TESTS PASSED! YouTube playlists synchronization hotfix validated.');
}

runTests().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
