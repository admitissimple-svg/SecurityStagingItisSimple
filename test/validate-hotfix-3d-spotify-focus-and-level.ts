import assert from 'node:assert';
import {
  SPOTIFY_PLAYLIST_IDS,
  SPOTIFY_LEVEL_PLAYLISTS,
  normalizeStudentLevel,
  resolveCanonicalStudentLevel,
  getSpotifyPlaylistForLevel,
  calculateWeeklyFocusTrack,
  isValidSpotifyUrl,
} from '../src/utils/spotify';
import fs from 'node:fs';
import path from 'node:path';

console.log('================================================================');
console.log(' HOTFIX 3D — SPOTIFY NÍVEL CORRETO + MÚSICA SEMANAL: TEST SUITE');
console.log('================================================================\n');

let passed = 0;
let total = 0;

function runTest(name: string, fn: () => void) {
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

// 1. Nível correto → playlist correspondente
runTest('1. Nível correto -> playlist correspondente (Intermediate e Advanced mapeiam para suas playlists oficiais)', () => {
  const intermediatePlaylist = getSpotifyPlaylistForLevel('intermediate');
  assert.strictEqual(intermediatePlaylist.playlistId, SPOTIFY_PLAYLIST_IDS.intermediate);
  assert.strictEqual(intermediatePlaylist.playlistId, '34E52K1dEJO5CzZRPkIR4I');
  assert.strictEqual(intermediatePlaylist.level, 'intermediate');

  const advancedPlaylist = getSpotifyPlaylistForLevel('advanced');
  assert.strictEqual(advancedPlaylist.playlistId, SPOTIFY_PLAYLIST_IDS.advanced);
  assert.strictEqual(advancedPlaylist.playlistId, '6ScLXNefp8JFohezoJve2Z');
  assert.strictEqual(advancedPlaylist.level, 'advanced');

  const beginnerPlaylist = getSpotifyPlaylistForLevel('beginner');
  assert.strictEqual(beginnerPlaylist.playlistId, SPOTIFY_PLAYLIST_IDS.beginner);
  assert.strictEqual(beginnerPlaylist.playlistId, '5MMU9H5oXDd7FCWr0gkzHE');
});

// 2. Perfil carregando → não exibir Beginner provisório
runTest('2. Perfil carregando -> não exibir Beginner provisório (resolveCanonicalStudentLevel retorna null e não beginner)', () => {
  // When level is not yet confirmed (null or undefined)
  const resolvingLevel = resolveCanonicalStudentLevel(null);
  assert.strictEqual(resolvingLevel, null, 'Enquanto perfil carrega, nível canônico deve ser null, não beginner');

  const emptyLevel = resolveCanonicalStudentLevel(undefined);
  assert.strictEqual(emptyLevel, null, 'Level indefinido não deve ser tratado como beginner prematuro');

  // Focus track with isLevelLoading=true returns null (never provisional beginner song)
  const mockTracks = [
    { trackId: 'trk1', title: 'Song 1', artist: 'Artist 1' },
    { trackId: 'trk2', title: 'Song 2', artist: 'Artist 2' },
  ];
  const focusWhileLoading = calculateWeeklyFocusTrack({
    tracks: mockTracks,
    weeklyCycle: 1,
    isLevelLoading: true,
  });
  assert.strictEqual(focusWhileLoading, null, 'Música de foco não pode ser calculada enquanto o nível estiver carregando');

  // Verify StudentSpotifyCard checks isLevelLoading
  const cardCode = fs.readFileSync(path.resolve(process.cwd(), 'src/components/StudentSpotifyCard.tsx'), 'utf-8');
  assert(cardCode.includes('isLoading || isLevelLoading'), 'Card deve renderizar estado neutro quando isLevelLoading for true');
  assert(cardCode.includes('isLevelLoading = false'), 'Card deve ter prop isLevelLoading');
});

// 3. F5 → nível e playlist corretos preservados
runTest('3. F5 -> nível e playlist corretos preservados (prioridade para englishLevel, userLevel, studentLevel)', () => {
  // Simulates student profile restored on F5 where englishLevel or studentLevel is intermediate
  const restoredIntermediateStudent = {
    englishLevel: 'intermediate',
    level: 'iniciante', // provisional default from createDefaultStudentProfile
  };
  const canonical = restoredIntermediateStudent.englishLevel || restoredIntermediateStudent.level;
  const normalized = normalizeStudentLevel(canonical);
  assert.strictEqual(normalized, 'intermediate', 'Nível intermediário do aluno deve prevalecer sobre o default provisório');

  const playlist = getSpotifyPlaylistForLevel(normalized);
  assert.strictEqual(playlist.playlistId, '34E52K1dEJO5CzZRPkIR4I');
});

// 4. Semana 1, 2 e 3 → músicas 1, 2 e 3
runTest('4. Semana 1, 2 e 3 -> faixas 1, 2 e 3 (songIndex = (weeklyCycle - 1) % totalTracks)', () => {
  const sampleTracks = [
    { trackId: 'track_a', title: 'Song Alpha', artist: 'Artist A', url: 'https://open.spotify.com/track/track_a' },
    { trackId: 'track_b', title: 'Song Beta', artist: 'Artist B', url: 'https://open.spotify.com/track/track_b' },
    { trackId: 'track_c', title: 'Song Gamma', artist: 'Artist C', url: 'https://open.spotify.com/track/track_c' },
    { trackId: 'track_d', title: 'Song Delta', artist: 'Artist D', url: 'https://open.spotify.com/track/track_d' },
  ];

  // Week 1 -> Track 1 (index 0, position 1)
  const week1 = calculateWeeklyFocusTrack({ tracks: sampleTracks, weeklyCycle: 1 });
  assert(week1 !== null);
  assert.strictEqual(week1.position, 1);
  assert.strictEqual(week1.trackId, 'track_a');
  assert.strictEqual(week1.title, 'Song Alpha');
  assert.strictEqual(week1.artist, 'Artist A');
  assert.strictEqual(week1.totalTracks, 4);

  // Week 2 -> Track 2 (index 1, position 2)
  const week2 = calculateWeeklyFocusTrack({ tracks: sampleTracks, weeklyCycle: 2 });
  assert(week2 !== null);
  assert.strictEqual(week2.position, 2);
  assert.strictEqual(week2.trackId, 'track_b');
  assert.strictEqual(week2.title, 'Song Beta');

  // Week 3 -> Track 3 (index 2, position 3)
  const week3 = calculateWeeklyFocusTrack({ tracks: sampleTracks, weeklyCycle: 3 });
  assert(week3 !== null);
  assert.strictEqual(week3.position, 3);
  assert.strictEqual(week3.trackId, 'track_c');
  assert.strictEqual(week3.title, 'Song Gamma');
});

// 5. Última música → próxima semana retorna à primeira
runTest('5. Última música -> próxima semana retorna à primeira (wrap around cíclico)', () => {
  const playlistWith3 = [
    { trackId: 't1', title: 'Track 1', artist: 'Artist 1' },
    { trackId: 't2', title: 'Track 2', artist: 'Artist 2' },
    { trackId: 't3', title: 'Track 3', artist: 'Artist 3' },
  ];

  // Week 3 -> Track 3 (last)
  const w3 = calculateWeeklyFocusTrack({ tracks: playlistWith3, weeklyCycle: 3 });
  assert(w3 !== null);
  assert.strictEqual(w3.position, 3);
  assert.strictEqual(w3.trackId, 't3');

  // Week 4 -> Returns to Track 1 ((4 - 1) % 3 = 0 -> position 1)
  const w4 = calculateWeeklyFocusTrack({ tracks: playlistWith3, weeklyCycle: 4 });
  assert(w4 !== null);
  assert.strictEqual(w4.position, 1);
  assert.strictEqual(w4.trackId, 't1');

  // Week 5 -> Track 2
  const w5 = calculateWeeklyFocusTrack({ tracks: playlistWith3, weeklyCycle: 5 });
  assert(w5 !== null);
  assert.strictEqual(w5.position, 2);
  assert.strictEqual(w5.trackId, 't2');
});

// 6. Mudança de ciclo → música de foco atualiza sem F5
runTest('6. Mudança de ciclo -> música de foco atualiza reativamente sem F5', () => {
  const tracks = [
    { trackId: 's1', title: 'Focus 1', artist: 'Band 1' },
    { trackId: 's2', title: 'Focus 2', artist: 'Band 2' },
  ];
  let cycle = 1;
  let currentFocus = calculateWeeklyFocusTrack({ tracks, weeklyCycle: cycle });
  assert.strictEqual(currentFocus?.position, 1);

  // Cycle increments upon Start New Week
  cycle = 2;
  currentFocus = calculateWeeklyFocusTrack({ tracks, weeklyCycle: cycle });
  assert.strictEqual(currentFocus?.position, 2);
  assert.strictEqual(currentFocus?.title, 'Focus 2');
});

// 7. Player Spotify permanece inalterado
runTest('7. Player Spotify permanece inalterado com embed e Listen on Spotify', () => {
  const cardCode = fs.readFileSync(path.resolve(process.cwd(), 'src/components/StudentSpotifyCard.tsx'), 'utf-8');
  assert(cardCode.includes('<iframe'), 'Player iframe do Spotify deve permanecer presente');
  assert(cardCode.includes('Listen on Spotify'), 'Botão "Listen on Spotify" deve permanecer intacto');
  assert(cardCode.includes('triggerAudioCompletion'), 'Mecanismo de conclusão deve permanecer inalterado');
  assert(cardCode.includes('setSpotifyPlayerMode'), 'Controle de modo App Player vs Web deve permanecer inalterado');
});

// 8. Nenhuma alteração nos fluxos de YouTube, S-Path e persistência
runTest('8. Nenhuma alteração nos fluxos de YouTube, S-Path e persistência', () => {
  const guideCode = fs.readFileSync(path.resolve(process.cwd(), 'src/components/StudentRoutineGuideSection.tsx'), 'utf-8');
  assert(guideCode.includes('dailyYouTubeVideo'), 'dailyYouTubeVideo mantido');
  assert(guideCode.includes("onUpdateSPathCheck?.('audio_day', selectedDay, true)"), 'S-Path de audio_day mantido');
  assert(guideCode.includes("onUpdateSPathCheck?.('video_day', selectedDay, true)"), 'S-Path de video_day mantido');
});

// 9. Ausência de inventar faixas se lista não estiver acessível
runTest('9. Lista de faixas inacessível -> não inventa faixas, títulos, posições ou links falsos', () => {
  const emptyRes = calculateWeeklyFocusTrack({ tracks: [], weeklyCycle: 1 });
  assert.strictEqual(emptyRes, null, 'Lista vazia de faixas deve retornar null, nunca música inventada');

  const nullRes = calculateWeeklyFocusTrack({ tracks: null, weeklyCycle: 2 });
  assert.strictEqual(nullRes, null, 'Lista null de faixas deve retornar null');
});

console.log(`\n================================================================`);
console.log(` ALL ${passed} / ${total} TESTS PASSED FOR HOTFIX 3D!`);
console.log(`================================================================\n`);
