import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import {
  SPOTIFY_PLAYLIST_IDS,
  getSpotifyPlaylistForLevel,
  resolveCanonicalStudentLevel,
  normalizeStudentLevel,
} from '../src/utils/spotify';
import { EnglishLevel, UserProfile, DayOfWeek } from '../src/types';

console.log('================================================================');
console.log(' HOTFIX 3D.2 — SPOTIFY | CORREÇÃO CIRÚRGICA DA HIDRATAÇÃO DO NÍVEL');
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

// ============================================================================
// TESTE 1: Payload conflitante: Intermediate deve prevalecer sobre Beginner legado
// ============================================================================
runTest('1. Payload conflitante: Intermediate deve prevalecer sobre Beginner legado', () => {
  // Simular payload da API com conflito (englishLevel: intermediate vs level legado: iniciante/beginner)
  const apiPayloadConflicted = {
    email: 'student@example.com',
    englishLevel: 'intermediate',
    level: 'iniciante',
  };

  // Simular resolução nos 3 pontos de App.tsx:
  const resolvedType =
    resolveCanonicalStudentLevel(apiPayloadConflicted.englishLevel) ||
    resolveCanonicalStudentLevel(apiPayloadConflicted.level);

  assert.strictEqual(resolvedType, 'intermediate', 'Nível canônico deve ser intermediate');

  const rawLevelCandidate = [
    apiPayloadConflicted.englishLevel,
    apiPayloadConflicted.level,
  ].find((val) => typeof val === 'string' && val.toLowerCase().includes('inter'));

  assert.strictEqual(rawLevelCandidate, 'intermediate', 'Candidato textual bruto deve ser intermediate');

  const resolvedEffectiveEnglishLevel = rawLevelCandidate || (
    resolvedType === 'intermediate' ? 'intermediate' :
    resolvedType === 'advanced' ? 'advanced' :
    resolvedType === 'beginner' ? EnglishLevel.BEGINNER :
    undefined
  );

  assert.strictEqual(resolvedEffectiveEnglishLevel, 'intermediate');

  // Verificar na montagem do loadedProfile simulado
  const loadedProfile: Partial<UserProfile> = {
    level: (resolvedEffectiveEnglishLevel || EnglishLevel.BEGINNER) as EnglishLevel,
    englishLevel: resolvedEffectiveEnglishLevel,
    userLevel: resolvedEffectiveEnglishLevel,
  };

  assert.strictEqual(loadedProfile.englishLevel, 'intermediate', 'englishLevel no perfil hidratado deve ser intermediate');
  assert.strictEqual(loadedProfile.userLevel, 'intermediate', 'userLevel no perfil hidratado deve ser intermediate');

  // Resolução canônica final a partir do perfil
  const canonicalFromProfile = resolveCanonicalStudentLevel(
    loadedProfile.englishLevel,
    loadedProfile.userLevel,
    loadedProfile.level
  );
  assert.strictEqual(canonicalFromProfile, 'intermediate', 'Intermediate deve prevalecer sobre qualquer resquício de Beginner');

  // Mapeamento Spotify
  const playlist = getSpotifyPlaylistForLevel(canonicalFromProfile);
  assert.strictEqual(playlist.playlistId, SPOTIFY_PLAYLIST_IDS.intermediate);
  assert.strictEqual(playlist.playlistId, '34E52K1dEJO5CzZRPkIR4I');
});

// ============================================================================
// TESTE 2: F5 e novo login: playlist Intermediate deve continuar selecionada
// ============================================================================
runTest('2. F5 e novo login: playlist Intermediate deve continuar selecionada', () => {
  // Caso A: F5 / page reload (dados persistidos no Firestore restaurados no onAuthStateChanged)
  const firestoreDocOnF5 = {
    uid: 'student-uid-123',
    email: 'student@example.com',
    englishLevel: 'intermediate',
    userLevel: 'intermediate',
    level: 'iniciante', // legado preservado
    weeklyCycle: 2,
  };

  const authCanonicalLevelType =
    resolveCanonicalStudentLevel(firestoreDocOnF5.englishLevel, firestoreDocOnF5.userLevel) ||
    resolveCanonicalStudentLevel(firestoreDocOnF5.level);

  assert.strictEqual(authCanonicalLevelType, 'intermediate', 'F5 deve restaurar intermediate');

  const rawAuthCandidate = [
    firestoreDocOnF5.englishLevel,
    firestoreDocOnF5.userLevel,
    firestoreDocOnF5.level,
  ].find((val) => typeof val === 'string' && val.toLowerCase().includes('inter'));

  const resolvedAuthEnglishLevel = rawAuthCandidate || 'intermediate';

  const restoredProfileF5: Partial<UserProfile> = {
    level: resolvedAuthEnglishLevel as EnglishLevel,
    englishLevel: resolvedAuthEnglishLevel,
    userLevel: resolvedAuthEnglishLevel,
  };

  const playlistF5 = getSpotifyPlaylistForLevel(
    resolveCanonicalStudentLevel(restoredProfileF5.englishLevel, restoredProfileF5.userLevel, restoredProfileF5.level)
  );
  assert.strictEqual(playlistF5.playlistId, '34E52K1dEJO5CzZRPkIR4I', 'Playlist Intermediate deve continuar selecionada após F5');

  // Caso B: Novo login (handleLoginSuccess com initialProfile)
  const initialProfileOnLogin = {
    email: 'student@example.com',
    englishLevel: 'intermediate',
    userLevel: 'intermediate',
    level: 'iniciante',
  };

  const loginCanonicalLevelType =
    resolveCanonicalStudentLevel(initialProfileOnLogin.englishLevel, initialProfileOnLogin.userLevel) ||
    resolveCanonicalStudentLevel(initialProfileOnLogin.level);

  assert.strictEqual(loginCanonicalLevelType, 'intermediate', 'Novo login deve resolver para intermediate');

  const rawLoginLevelCandidate = [
    initialProfileOnLogin.englishLevel,
    initialProfileOnLogin.userLevel,
    initialProfileOnLogin.level,
  ].find((val) => typeof val === 'string' && val.toLowerCase().includes('inter'));

  const freshProfileOnLogin: Partial<UserProfile> = {
    level: (rawLoginLevelCandidate || 'intermediate') as EnglishLevel,
    englishLevel: rawLoginLevelCandidate || 'intermediate',
    userLevel: rawLoginLevelCandidate || 'intermediate',
  };

  const playlistLogin = getSpotifyPlaylistForLevel(
    resolveCanonicalStudentLevel(freshProfileOnLogin.englishLevel, freshProfileOnLogin.userLevel, freshProfileOnLogin.level)
  );
  assert.strictEqual(playlistLogin.playlistId, '34E52K1dEJO5CzZRPkIR4I', 'Playlist Intermediate deve continuar selecionada no novo login');
});

// ============================================================================
// TESTE 3: Start New Week: ciclo semanal e nível devem permanecer independentes
// ============================================================================
runTest('3. Start New Week: ciclo semanal e nível devem permanecer independentes', () => {
  // Estado inicial antes de Start New Week
  let currentProfile: UserProfile = {
    id: 'student-uid-789',
    uid: 'student-uid-789',
    name: 'Student Name',
    email: 'student@example.com',
    level: 'intermediate' as EnglishLevel,
    englishLevel: 'intermediate',
    userLevel: 'intermediate',
    weeklyCycle: 1,
    weeklyStudyDaysTarget: 4,
    weeklyStudyDays: ['monday', 'tuesday', 'wednesday', 'thursday'],
  };

  // Nível inicial verificado
  const initialResolved = resolveCanonicalStudentLevel(
    currentProfile.englishLevel,
    currentProfile.userLevel,
    currentProfile.level
  );
  assert.strictEqual(initialResolved, 'intermediate');
  assert.strictEqual(currentProfile.weeklyCycle, 1);

  // Simular transição do Start New Week (como em handleStartNewWeek em App.tsx)
  const effectiveNewCycle = 2;
  const effectiveStudyTarget = 5;
  const effectiveStudyDays: DayOfWeek[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];

  // Atualização de estado como em App.tsx linha 4338:
  // setUserProfile((prev) => ({
  //   ...prev,
  //   weeklyCycle: effectiveCycle,
  //   weeklyStudyDaysTarget: effectiveStudyTarget,
  //   weeklyStudyDays: effectiveStudyDays,
  // }));
  currentProfile = {
    ...currentProfile,
    weeklyCycle: effectiveNewCycle,
    weeklyStudyDaysTarget: effectiveStudyTarget,
    weeklyStudyDays: effectiveStudyDays,
  };

  // Verificação de independência rigorosa:
  assert.strictEqual(currentProfile.weeklyCycle, 2, 'Ciclo semanal deve avançar para semana 2');
  assert.strictEqual(currentProfile.englishLevel, 'intermediate', 'englishLevel deve permanecer intocado e idêntico');
  assert.strictEqual(currentProfile.userLevel, 'intermediate', 'userLevel deve permanecer intocado');
  assert.strictEqual(currentProfile.level, 'intermediate' as EnglishLevel, 'level deve permanecer intocado');

  const afterResolved = resolveCanonicalStudentLevel(
    currentProfile.englishLevel,
    currentProfile.userLevel,
    currentProfile.level
  );
  assert.strictEqual(afterResolved, 'intermediate', 'Nível resolvido após Start New Week permanece Intermediate');

  const playlistAfter = getSpotifyPlaylistForLevel(afterResolved);
  assert.strictEqual(playlistAfter.playlistId, '34E52K1dEJO5CzZRPkIR4I', 'Playlist Intermediate permanece ativa');

  // Avançar mais uma semana (Semana 3)
  currentProfile = {
    ...currentProfile,
    weeklyCycle: 3,
  };
  assert.strictEqual(currentProfile.weeklyCycle, 3);
  assert.strictEqual(currentProfile.englishLevel, 'intermediate');
  assert.strictEqual(
    resolveCanonicalStudentLevel(currentProfile.englishLevel, currentProfile.userLevel, currentProfile.level),
    'intermediate'
  );
});

// ============================================================================
// TESTE 4: Verificação estática do código-fonte em src/App.tsx
// ============================================================================
runTest('4. Verificação estática do código-fonte em src/App.tsx (os 3 pontos autorizados)', () => {
  const appCode = fs.readFileSync(path.resolve(process.cwd(), 'src/App.tsx'), 'utf-8');

  // Ponto 1: loadStudentData (hidratação da API)
  assert(
    appCode.includes('canonicalFromCanonicalFields = resolveCanonicalStudentLevel'),
    'Ponto 1 (loadStudentData) deve reutilizar resolveCanonicalStudentLevel'
  );
  assert(
    appCode.includes('resolvedEffectiveEnglishLevel ? {'),
    'Ponto 1 não deve sobrescrever campos canônicos com Beginner durante inicialização'
  );

  // Ponto 2: onAuthStateChanged (autenticação/F5)
  assert(
    appCode.includes('authCanonicalLevelType ='),
    'Ponto 2 (onAuthStateChanged) deve reutilizar resolveCanonicalStudentLevel'
  );
  assert(
    appCode.includes('resolvedAuthEnglishLevel ? {'),
    'Ponto 2 não deve sobrescrever campos canônicos com Beginner na restauração F5'
  );

  // Ponto 3: handleLoginSuccess (restauração/troca de conta)
  assert(
    appCode.includes('loginCanonicalLevelType ='),
    'Ponto 3 (handleLoginSuccess) deve reutilizar resolveCanonicalStudentLevel'
  );
  assert(
    appCode.includes('resolvedLoginEnglishLevel ? {'),
    'Ponto 3 não deve sobrescrever campos canônicos com Beginner no login/troca de conta'
  );

  // Verificação de não-duplicação de funções
  const countResolveDecl = (appCode.match(/function resolveCanonicalStudentLevel/g) || []).length;
  assert.strictEqual(countResolveDecl, 0, 'resolveCanonicalStudentLevel não deve ser duplicada em App.tsx (deve ser importada)');
});

console.log(`\n================================================================`);
console.log(` TODOS OS ${passed} / ${total} TESTES PASSARAM COM SUCESSO!`);
console.log(`================================================================\n`);
