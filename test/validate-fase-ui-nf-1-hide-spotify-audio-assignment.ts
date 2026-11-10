import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SHOW_SPOTIFY_AUDIO_ASSIGNMENT, NativeFriendSpotifyTable } from '../src/components/NativeFriendSpotifyTable';
import { getSpotifyPlaylistForLevel } from '../src/utils/spotify';
import { EnglishLevel } from '../src/types';

console.log('================================================================');
console.log('🧪 TEST SUITE: FASE UI-NF.1 — OCULTAÇÃO SPOTIFY AUDIO ASSIGNMENT');
console.log('================================================================\n');

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) {
    console.log(`  ✅ PASS: ${msg}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${msg}`);
    failed++;
  }
}

// Test 1: Feature flag check
console.log('--- Test 1: Feature flag SHOW_SPOTIFY_AUDIO_ASSIGNMENT ---');
assert(SHOW_SPOTIFY_AUDIO_ASSIGNMENT === false, 'SHOW_SPOTIFY_AUDIO_ASSIGNMENT is false');

// Test 2: NativeFriendSpotifyTable renders null when flag is false
console.log('\n--- Test 2: NativeFriendSpotifyTable rendering output ---');
const markup = renderToStaticMarkup(
  React.createElement(NativeFriendSpotifyTable, {
    studentUid: 'student-test-uid-123',
    studentEmail: 'student@example.com',
    studentName: 'Student Test',
    studentLevel: 'intermediate',
  })
);
assert(markup === '', 'NativeFriendSpotifyTable renders completely empty string (null)');
assert(!markup.includes('Spotify Audio Assignment'), 'Markup does not contain "Spotify Audio Assignment"');
assert(!markup.includes('Open Level Playlist'), 'Markup does not contain "Open Level Playlist"');
assert(!markup.includes('Recommend'), 'Markup does not contain "Recommend"');

// Test 3: Fixed playlists for CEFR levels remain intact
console.log('\n--- Test 3: Fixed CEFR level playlists remain intact ---');
const beginnerPlaylist = getSpotifyPlaylistForLevel(EnglishLevel.BEGINNER);
const intermediatePlaylist = getSpotifyPlaylistForLevel(EnglishLevel.INTERMEDIATE);
const advancedPlaylist = getSpotifyPlaylistForLevel(EnglishLevel.ADVANCED);

assert(beginnerPlaylist.playlistUrl.includes('spotify.com'), 'Beginner playlist URL is valid');
assert(intermediatePlaylist.playlistUrl.includes('spotify.com'), 'Intermediate playlist URL is valid');
assert(advancedPlaylist.playlistUrl.includes('spotify.com'), 'Advanced playlist URL is valid');

console.log('\n================================================================');
console.log(`📊 RESULTADOS: ${passed} PASSOU | ${failed} FALHOU`);
console.log('================================================================');

if (failed > 0) {
  process.exit(1);
}
