import assert from 'node:assert';
import {
  SPOTIFY_PLAYLIST_IDS,
  SPOTIFY_LEVEL_PLAYLISTS,
  normalizeStudentLevel,
  getSpotifyPlaylistForLevel,
  fetchTracksForStudentLevel,
  fetchPlaylistTracksFromSpotifyApi,
  SPOTIFY_BEARER_TOKEN,
  SPOTIFY_IT_IS_SIMPLE_TOKEN,
} from '../src/utils/spotify';
import { OFFICIAL_SPOTIFY_PLAYLISTS } from '../src/serverSpotify';
import fs from 'node:fs';
import path from 'node:path';

console.log('================================================================');
console.log(' HOTFIX SPOTIFY — PLAYLISTS OFICIAIS: VALIDATION SUITE');
console.log('================================================================\n');

let passed = 0;
let total = 0;

function test(name: string, fn: () => void | Promise<void>) {
  total++;
  try {
    const res = fn();
    if (res instanceof Promise) {
      throw new Error('Async test must be awaited');
    }
    console.log(`✅ [PASS] Test ${total}: ${name}`);
    passed++;
  } catch (err: any) {
    console.error(`❌ [FAIL] Test ${total}: ${name}`);
    console.error(err);
    process.exit(1);
  }
}

async function testAsync(name: string, fn: () => Promise<void>) {
  total++;
  try {
    await fn();
    console.log(`✅ [PASS] Test ${total}: ${name}`);
    passed++;
  } catch (err: any) {
    console.error(`❌ [FAIL] Test ${total}: ${name}`);
    console.error(err);
    process.exit(1);
  }
}

async function run() {
  // Test 1: Direcionamento correto nos três níveis
  test('1. Direcionamento correto nos três níveis (Beginner, Intermediate, Advanced)', () => {
    assert.strictEqual(SPOTIFY_PLAYLIST_IDS.beginner, '5MMU9H5oXDd7FCWr0gkzHE');
    assert.strictEqual(SPOTIFY_PLAYLIST_IDS.intermediate, '34E52K1dEJO5CzZRPkIR4I');
    assert.strictEqual(SPOTIFY_PLAYLIST_IDS.advanced, '6ScLXNefp8JFohezoJve2Z');

    assert.strictEqual(OFFICIAL_SPOTIFY_PLAYLISTS.beginner.id, '5MMU9H5oXDd7FCWr0gkzHE');
    assert.strictEqual(OFFICIAL_SPOTIFY_PLAYLISTS.intermediate.id, '34E52K1dEJO5CzZRPkIR4I');
    assert.strictEqual(OFFICIAL_SPOTIFY_PLAYLISTS.advanced.id, '6ScLXNefp8JFohezoJve2Z');

    const begConfig = getSpotifyPlaylistForLevel('beginner');
    assert.strictEqual(begConfig.playlistId, '5MMU9H5oXDd7FCWr0gkzHE');
    assert.strictEqual(begConfig.playlistUrl, 'https://open.spotify.com/playlist/5MMU9H5oXDd7FCWr0gkzHE');
    assert(begConfig.embedPlaylistUrl.includes('5MMU9H5oXDd7FCWr0gkzHE'));

    const intConfig = getSpotifyPlaylistForLevel('intermediate');
    assert.strictEqual(intConfig.playlistId, '34E52K1dEJO5CzZRPkIR4I');
    assert.strictEqual(intConfig.playlistUrl, 'https://open.spotify.com/playlist/34E52K1dEJO5CzZRPkIR4I');
    assert(intConfig.embedPlaylistUrl.includes('34E52K1dEJO5CzZRPkIR4I'));

    const advConfig = getSpotifyPlaylistForLevel('advanced');
    assert.strictEqual(advConfig.playlistId, '6ScLXNefp8JFohezoJve2Z');
    assert.strictEqual(advConfig.playlistUrl, 'https://open.spotify.com/playlist/6ScLXNefp8JFohezoJve2Z');
    assert(advConfig.embedPlaylistUrl.includes('6ScLXNefp8JFohezoJve2Z'));
  });

  // Test 2: Normalização dos níveis de inglês
  test('2. Normalização resiliente dos níveis de inglês do aluno', () => {
    assert.strictEqual(normalizeStudentLevel('Beginner'), 'beginner');
    assert.strictEqual(normalizeStudentLevel('Iniciante'), 'beginner');
    assert.strictEqual(normalizeStudentLevel('intermediate'), 'intermediate');
    assert.strictEqual(normalizeStudentLevel('Intermediário (B1/B2)'), 'intermediate');
    assert.strictEqual(normalizeStudentLevel('Advanced (C1/C2)'), 'advanced');
    assert.strictEqual(normalizeStudentLevel('Avançado'), 'advanced');
    assert.strictEqual(normalizeStudentLevel(null), 'beginner');
  });

  // Test 3: Abertura da playlist oficial e texto de Shuffle
  test('3. UI StudentSpotifyCard contém botão "Listen on Spotify" e orientação de Shuffle', () => {
    const cardContent = fs.readFileSync(path.resolve(process.cwd(), 'src/components/StudentSpotifyCard.tsx'), 'utf-8');
    assert(cardContent.includes('Listen on Spotify'), 'Deve conter botão "Listen on Spotify"');
    assert(cardContent.includes('Try Shuffle mode to discover different songs!'), 'Deve conter orientação "Try Shuffle mode to discover different songs!"');
    assert(cardContent.includes('target="_blank"'), 'Deve abrir em nova aba com target="_blank"');
    assert(cardContent.includes('rel="noopener noreferrer"'), 'Deve conter rel="noopener noreferrer"');
    assert(cardContent.includes('triggerAudioCompletion'), 'Deve preservar mecanismo de conclusão da atividade');
  });

  // Test 4: Eliminação de chamadas à Spotify Web API para seleção de faixas
  await testAsync('4. Chamadas à Spotify Web API para seleção de músicas na atividade eliminadas', async () => {
    const tracksBeg = await fetchTracksForStudentLevel('beginner');
    assert.strictEqual(tracksBeg, null, 'fetchTracksForStudentLevel deve retornar null sem chamadas de rede');
    const tracksInt = await fetchTracksForStudentLevel('intermediate');
    assert.strictEqual(tracksInt, null, 'fetchTracksForStudentLevel deve retornar null sem chamadas de rede');
    const playlistRes = await fetchPlaylistTracksFromSpotifyApi('5MMU9H5oXDd7FCWr0gkzHE');
    assert.strictEqual(playlistRes, null, 'fetchPlaylistTracksFromSpotifyApi deve retornar null');

    const guideContent = fs.readFileSync(path.resolve(process.cwd(), 'src/components/StudentRoutineGuideSection.tsx'), 'utf-8');
    assert(!guideContent.includes('fetchTracksForStudentLevel('), 'StudentRoutineGuideSection não deve chamar fetchTracksForStudentLevel');

    const appContent = fs.readFileSync(path.resolve(process.cwd(), 'src/App.tsx'), 'utf-8');
    assert(!appContent.includes('fetchTracksForStudentLevel('), 'App.tsx não deve chamar fetchTracksForStudentLevel');
  });

  // Test 5: Ausência de Bearer Token fixo no código
  test('5. Ausência de Bearer Token fixo no código', () => {
    assert.strictEqual(SPOTIFY_BEARER_TOKEN, '', 'SPOTIFY_BEARER_TOKEN deve ser vazio');
    assert.strictEqual(SPOTIFY_IT_IS_SIMPLE_TOKEN, '', 'SPOTIFY_IT_IS_SIMPLE_TOKEN deve ser vazio');

    const spotifyUtil = fs.readFileSync(path.resolve(process.cwd(), 'src/utils/spotify.ts'), 'utf-8');
    assert(!spotifyUtil.includes('BQ'), 'Não deve conter token fixo do Spotify');

    const serverSpotify = fs.readFileSync(path.resolve(process.cwd(), 'src/serverSpotify.ts'), 'utf-8');
    assert(!serverSpotify.includes('BQ'), 'Não deve conter token fixo no servidor');
  });

  // Test 6: Persistência da conclusão diária
  test('6. Chave e contrato de persistência de audio_day mantidos', () => {
    const guideContent = fs.readFileSync(path.resolve(process.cwd(), 'src/components/StudentRoutineGuideSection.tsx'), 'utf-8');
    assert(guideContent.includes("weeklyChecks?.[`audio_day_${selectedDay}`]"), 'Verificação de conclusão de áudio mantida');
    assert(guideContent.includes("onUpdateSPathCheck?.('audio_day', selectedDay, true)"), 'Atualização de S-Path mantida');
    assert(guideContent.includes("type: 'audio'"), 'Disparo comportamental de áudio mantido');
  });

  // Test 7: Ausência de regressão em YouTube e demais atividades
  test('7. Ausência de regressões em YouTube, S-Path e rotina', () => {
    const guideContent = fs.readFileSync(path.resolve(process.cwd(), 'src/components/StudentRoutineGuideSection.tsx'), 'utf-8');
    assert(guideContent.includes('dailyYouTubeVideo'), 'Integração com YouTube mantida intacta');
    assert(guideContent.includes('useBehavioralVideoTracker'), 'Tracker comportamental de vídeo mantido intacto');
    const appContent = fs.readFileSync(path.resolve(process.cwd(), 'src/App.tsx'), 'utf-8');
    assert(appContent.includes('StudentHeaderSection'), 'Header mantido em App.tsx');
    assert(appContent.includes('StudentWeeklyActivitySection'), 'Weekly activity mantido em App.tsx');
  });

  console.log(`\n================================================================`);
  console.log(` ALL ${passed} / ${total} TESTS PASSED SUCCESSFULLY!`);
  console.log(`================================================================\n`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
