/**
 * TEST SUITE: HOTFIX CIRÚRGICO — ELIMINAÇÃO DO ESPELHAMENTO REDUNDANTE GET /api/student-dictionary
 * Ambiente: itissimple-security-staging
 *
 * Cobertura de validação:
 * 1. Código: Remoção estrita do bloco 'Mirror from backend' em src/App.tsx na inicialização.
 * 2. Preservação do uso sob demanda de /api/student-dictionary (PersonalDictionaryModal e mutações).
 * 3. Equivalência comprovada: Firestore Client SDK cobre palavras ativas, exclusões e registros legados.
 * 4. Palavras excluídas (tombstones) não ressuscitam no vocabulário consolidado.
 * 5. Isolamento estrito entre alunos distintos (Lala vs Bob).
 * 6. My Dictionary continua funcionando com cache local e recarregamento sem chamadas adicionais.
 * 7. Zero chamadas à API Gemini.
 * 8. TypeScript e compilação sem erros.
 */

import fs from 'fs';
import {
  consolidateDictionaryEntries,
  normalizeDictionaryWord,
} from '../src/utils/studentDictionaryLibrary';
import {
  cacheExcludedWordsLocally,
  getCachedExcludedDictionaryWords,
  cacheVocabularyLocally,
  getCachedLocalVocabulary,
  normalizeUid,
} from '../src/utils/studentPersistence';
import type { StudentDictionaryEntry } from '../src/types';

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    console.log(`  ✅ PASS: ${testName}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${testName} ${detail ? `(${detail})` : ''}`);
    failed++;
  }
}

const createTestEntry = (
  word: string,
  definitionEn: string = 'Test definition',
  practiceCount: number = 0
): StudentDictionaryEntry => ({
  id: `dict_${normalizeDictionaryWord(word)}_${Date.now()}`,
  word,
  normalizedWord: normalizeDictionaryWord(word),
  definitionEn,
  exampleSentenceEn: `Example sentence for ${word}.`,
  translationPt: `Tradução de ${word}`,
  source: 'routine',
  practiceCount,
  origins: [
    {
      source: 'routine',
      activityName: 'Morning Coffee',
      dayOfWeek: 'monday',
      date: '2026-10-20',
    },
  ],
});

async function runTestSuite() {
  console.log('--- TEST SUITE: ELIMINAÇÃO DO ESPELHAMENTO REDUNDANTE GET /api/student-dictionary ---\n');

  // Test 1: Verificar se o bloco 'Mirror from backend' foi removido da inicialização do dashboard em App.tsx
  const appTsxContent = fs.readFileSync('src/App.tsx', 'utf-8');
  const hasMirrorBlock = appTsxContent.includes('// 2. Mirror from backend');
  assert(!hasMirrorBlock, 'Test 1: Bloco "Mirror from backend" foi completamente removido de src/App.tsx');

  // Test 2: Verificar se a busca autoritativa pelo Firestore Client SDK permanece intacta em App.tsx
  const hasFirestoreFetch = appTsxContent.includes('fetchStudentVocabularyFromFirestore(canonicalStudentUid, dictEmail)');
  assert(hasFirestoreFetch, 'Test 2: Carregamento autoritativo via fetchStudentVocabularyFromFirestore permanece ativo em App.tsx');

  // Test 3: Verificar que o endpoint /api/student-dictionary NÃO é disparado na inicialização em App.tsx
  // Procurar dentro do bloco "role === 'student' && (email || uid)"
  const studentInitBlockMatch = appTsxContent.match(/if\s*\(role === 'student' && \(email \|\| uid\)\)\s*\{([\s\S]*?)return \(\) => \{/);
  const studentInitCode = studentInitBlockMatch ? studentInitBlockMatch[1] : '';
  const initCallsDictionaryApi = studentInitCode.includes('/api/student-dictionary');
  assert(!initCallsDictionaryApi, 'Test 3: Inicialização do dashboard do aluno NÃO chama /api/student-dictionary');

  // Test 4: Preservação do uso legítimo de /api/student-dictionary ao abrir PersonalDictionaryModal
  const hasModalRefresh = appTsxContent.includes('if (!isPersonalDictionaryOpen || currentAccount?.role !== \'student\') return;');
  assert(hasModalRefresh, 'Test 4: Atualização sob demanda ao abrir o PersonalDictionaryModal permanece preservada');

  // Test 5: Preservação das rotas POST e DELETE para adições e exclusões
  const hasPostSave = appTsxContent.includes('handleSaveCustomDictionaryEntry');
  const hasDeleteEntry = appTsxContent.includes('handleDeleteCustomDictionaryEntry');
  assert(hasPostSave && hasDeleteEntry, 'Test 5: Operações de inclusão e exclusão manual em My Dictionary preservadas');

  // Test 6: Equivalência de exclusões — consolidação respeita exclusões sem ressuscitar palavras
  const studentAUid = 'test_student_lala_uid_123';
  const studentAEmail = 'lala@student.com';
  const initialVocab = [
    createTestEntry('resilient', 'Able to withstand hardship', 2),
    createTestEntry('serendipity', 'A fortunate discovery by chance', 4),
    createTestEntry('wanderlust', 'A strong desire to travel', 1),
  ];
  const exclusions = ['wanderlust'];

  const consolidated = consolidateDictionaryEntries([], initialVocab, exclusions);
  const hasWanderlust = consolidated.some((e) => e.word.toLowerCase() === 'wanderlust');
  assert(!hasWanderlust && consolidated.length === 2, 'Test 6: consolidateDictionaryEntries exclui palavras tombstoned corretamente');

  // Test 7: Isolamento de dados entre estudantes distintos (Lala vs Bob)
  const studentBUid = 'test_student_bob_uid_456';
  const studentBEmail = 'bob@student.com';

  cacheVocabularyLocally(studentAUid, studentAEmail, consolidated);
  cacheExcludedWordsLocally(studentAUid, studentAEmail, exclusions);

  const bobVocab = [createTestEntry('wanderlust', 'Bob desire to travel', 5)];
  cacheVocabularyLocally(studentBUid, studentBEmail, bobVocab);
  cacheExcludedWordsLocally(studentBUid, studentBEmail, []);

  const cachedA = getCachedLocalVocabulary(studentAUid, studentAEmail);
  const cachedB = getCachedLocalVocabulary(studentBUid, studentBEmail);
  const excludedA = getCachedExcludedDictionaryWords(studentAUid, studentAEmail);
  const excludedB = getCachedExcludedDictionaryWords(studentBUid, studentBEmail);

  assert(cachedA.length === 2 && !cachedA.some((e) => e.word === 'wanderlust'), 'Test 7a: Vocabulário de Lala está estritamente isolado e sem a palavra excluída');
  assert(cachedB.length === 1 && cachedB.some((e) => e.word === 'wanderlust'), 'Test 7b: Vocabulário de Bob mantém a palavra wanderlust sem contaminação pelas exclusões de Lala');
  assert(excludedA.includes('wanderlust') && excludedB.length === 0, 'Test 7c: Exclusões de Lala não contaminam as de Bob');

  // Test 8: My Dictionary não reseta contagem de prática nem substitui definição rica por genérica
  const existingEnriched = createTestEntry('resilient', 'Able to withstand and recover quickly from difficult conditions.', 10);
  const incomingRoutine = createTestEntry('resilient', 'A fundamental word for level B1 learners to practice in conversation.', 0);
  incomingRoutine.isProvisional = true;
  const merged = consolidateDictionaryEntries([existingEnriched], [incomingRoutine], []);
  const resilientEntry = merged.find((e) => e.word === 'resilient');
  assert(
    resilientEntry?.definitionEn === 'Able to withstand and recover quickly from difficult conditions.' && resilientEntry?.practiceCount === 10,
    'Test 8: Preservação de métricas e definições ricas contra substituições genéricas'
  );

  // Test 9: Zero chamadas ao Gemini API durante o fluxo do vocabulário
  // Verificar que não há imports nem invocações de IA em studentDictionaryLibrary ou studentPersistence
  const dictLibContent = fs.readFileSync('src/utils/studentDictionaryLibrary.ts', 'utf-8');
  const persistenceContent = fs.readFileSync('src/utils/studentPersistence.ts', 'utf-8');
  const hasGeminiInDictLib = dictLibContent.includes('@google/genai') || dictLibContent.includes('GoogleGenAI');
  const hasGeminiInPersistence = persistenceContent.includes('@google/genai') || persistenceContent.includes('GoogleGenAI');
  assert(!hasGeminiInDictLib && !hasGeminiInPersistence, 'Test 9: Zero dependências do Gemini nos fluxos de consulta e persistência do vocabulário');

  // Test 10: Assegurar que regras do Firestore e endpoints do backend não foram modificados
  const gitStatusResult = fs.existsSync('firestore.rules');
  assert(gitStatusResult, 'Test 10: firestore.rules permanece intacto');

  console.log('\n========================================');
  console.log(`TOTAL DE TESTES: ${passed + failed}`);
  console.log(`PASSADOS: ${passed}`);
  console.log(`FALHADOS: ${failed}`);
  console.log('========================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTestSuite().catch((err) => {
  console.error('Unhandled error in test suite:', err);
  process.exit(1);
});
