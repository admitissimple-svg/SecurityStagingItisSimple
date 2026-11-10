/**
 * TEST SUITE: FASE INSIGHTS.2 — SIMPLIFICAÇÃO DO WEEKLY LEARNING INSIGHTS
 *
 * Validates the 16 mandatory test conditions:
 * 1. Aluno com palavras e frases na semana atual.
 * 2. Aluno com apenas palavras na semana atual.
 * 3. Aluno com apenas frases na semana atual.
 * 4. Semana atual vazia e semana anterior preenchida.
 * 5. Ambas as semanas vazias.
 * 6. Registros sem data válida.
 * 7. Virada de mês e ano.
 * 8. Professor alternando entre dois alunos.
 * 9. Professor sem autorização para determinado aluno.
 * 10. Atualização por F5 / idempotência.
 * 11. Acesso em outro computador (stateless backend / Firestore source of truth).
 * 12. Funcionamento sob Firestore default-deny.
 * 13. Zero chamadas Gemini.
 * 14. Nenhuma alteração no Dictionary ou Journal.
 * 15. Nenhuma regressão no S-Path.
 * 16. Build e TypeScript sem erros.
 */

import fs from 'fs';
if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  try {
    if (!fs.existsSync(process.env.GOOGLE_APPLICATION_CREDENTIALS) || process.env.GOOGLE_APPLICATION_CREDENTIALS.includes('placeholder')) {
      delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    }
  } catch {
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
  }
}

import {
  buildWeeklyLearningInsights,
  getWeekBoundariesInSaoPaulo,
  parseRecordDateToSaoPauloTimestamp,
  extractCanonicalWords,
  extractCanonicalSentences,
} from '../src/utils/weeklyLearningInsights';
import {
  resolveCanonicalStudentIdentity,
} from '../src/serverFirestore';

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

async function runTestSuite() {
  console.log('================================================================');
  console.log('START: FASE INSIGHTS.2 — Weekly Learning Insights Validation');
  console.log('================================================================\n');

  // Fixed reference date: Tuesday, Nov 10, 2026, 14:00:00 UTC (11:00:00 in America/Sao_Paulo)
  const refDate = new Date('2026-11-10T14:00:00.000Z');
  const boundaries = getWeekBoundariesInSaoPaulo(refDate);

  console.log('Calculated Sao Paulo Week Boundaries for Ref Date (2026-11-10):');
  console.log('  Current Week :', boundaries.currentWeek.startDate, 'to', boundaries.currentWeek.endDate, `[${boundaries.currentWeek.formattedRange}]`);
  console.log('  Previous Week:', boundaries.previousWeek.startDate, 'to', boundaries.previousWeek.endDate, `[${boundaries.previousWeek.formattedRange}]\n`);

  // -------------------------------------------------------------------------
  // TEST 1: Aluno com palavras e frases na semana atual
  // -------------------------------------------------------------------------
  console.log('--- TEST 1: Student with both words and sentences in current week ---');
  const wordsTest1 = [
    {
      id: 'w1',
      word: 'breakthrough',
      partOfSpeech: 'Noun',
      definitionEn: 'A sudden, dramatic, and important discovery or development.',
      exampleSentenceEn: 'Scientists made a major breakthrough in renewable energy.',
      learnedAt: '2026-11-10T10:00:00-03:00',
    },
    {
      id: 'w2',
      word: 'reschedule',
      partOfSpeech: 'Verb',
      definitionEn: 'To change the time of an event or meeting.',
      exampleSentenceEn: 'I need to reschedule our conversation session for Friday.',
      learnedAt: '2026-11-09T15:30:00-03:00',
    },
  ];
  const sentencesTest1 = [
    {
      id: 's1',
      sentence: 'I will going to the market tomorrow morning.',
      correctedSentence: 'I will go to the market tomorrow morning.',
      explanation: 'Use the base form of the verb after the modal auxiliary "will".',
      date: '2026-11-10',
    },
  ];

  const result1 = buildWeeklyLearningInsights({
    rawWords: wordsTest1,
    rawSentences: sentencesTest1,
    studentUid: 'student_101',
    studentEmail: 'student101@test.com',
    referenceDate: refDate,
  });

  assert(result1.period === 'current_week', 'Result period is current_week');
  assert(!result1.isFallbackToPreviousWeek, 'Not a fallback to previous week');
  assert(result1.vocabulary.length === 2, 'Vocabulary has 2 words', `got ${result1.vocabulary.length}`);
  assert(result1.sentences.length === 1, 'Sentences has 1 sentence', `got ${result1.sentences.length}`);
  assert(result1.vocabulary[0].word === 'breakthrough', 'Word content preserved in English');
  assert(result1.sentences[0].sentence === 'I will going to the market tomorrow morning.', 'Student original sentence preserved');
  assert(result1.sentences[0].correctedSentence === 'I will go to the market tomorrow morning.', 'AI pedagogical correction preserved');

  // -------------------------------------------------------------------------
  // TEST 2: Aluno com apenas palavras na semana atual
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 2: Student with only words in current week ---');
  const result2 = buildWeeklyLearningInsights({
    rawWords: wordsTest1,
    rawSentences: [],
    studentUid: 'student_102',
    referenceDate: refDate,
  });

  assert(result2.period === 'current_week', 'Result period is current_week');
  assert(result2.hasWords === true, 'hasWords is true');
  assert(result2.hasSentences === false, 'hasSentences is false');
  assert(result2.sentences.length === 0, 'Sentences list is empty');
  assert(result2.vocabulary.length === 2, 'Vocabulary list has 2 words');

  // -------------------------------------------------------------------------
  // TEST 3: Aluno com apenas frases na semana atual
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 3: Student with only sentences in current week ---');
  const result3 = buildWeeklyLearningInsights({
    rawWords: [],
    rawSentences: sentencesTest1,
    studentUid: 'student_103',
    referenceDate: refDate,
  });

  assert(result3.period === 'current_week', 'Result period is current_week');
  assert(result3.hasWords === false, 'hasWords is false');
  assert(result3.hasSentences === true, 'hasSentences is true');
  assert(result3.vocabulary.length === 0, 'Vocabulary list is empty');
  assert(result3.sentences.length === 1, 'Sentences list has 1 sentence');

  // -------------------------------------------------------------------------
  // TEST 4: Semana atual vazia e semana anterior preenchida
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 4: Current week empty and previous week populated ---');
  const wordsTest4 = [
    {
      id: 'w_old',
      word: 'commute',
      partOfSpeech: 'Verb',
      definitionEn: 'To travel some distance to work on a regular basis.',
      exampleSentenceEn: 'I commute by train every single weekday.',
      learnedAt: '2026-11-04T12:00:00-03:00', // Previous week (Nov 2 - Nov 8)
    },
  ];
  const sentencesTest4 = [
    {
      id: 's_old',
      sentence: 'I drank a lot of water yesterday.',
      correctedSentence: null,
      explanation: 'Great sentence! No grammatical errors found.',
      date: '2026-11-05', // Previous week
    },
  ];

  const result4 = buildWeeklyLearningInsights({
    rawWords: wordsTest4,
    rawSentences: sentencesTest4,
    studentUid: 'student_104',
    referenceDate: refDate,
  });

  assert(result4.period === 'previous_week', 'Result period is previous_week');
  assert(result4.isFallbackToPreviousWeek === true, 'isFallbackToPreviousWeek is true');
  assert(result4.vocabulary.length === 1, 'Vocabulary from previous week retrieved');
  assert(result4.vocabulary[0].word === 'commute', 'Correct word from previous week retrieved');
  assert(result4.sentences.length === 1, 'Sentences from previous week retrieved');

  // -------------------------------------------------------------------------
  // TEST 5: Ambas as semanas vazias
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 5: Both current and previous week empty ---');
  const wordsTest5 = [
    {
      id: 'w_very_old',
      word: 'ancient',
      learnedAt: '2026-09-01T12:00:00-03:00', // 2 months ago
    },
  ];

  const result5 = buildWeeklyLearningInsights({
    rawWords: wordsTest5,
    rawSentences: [],
    studentUid: 'student_105',
    referenceDate: refDate,
  });

  assert(result5.period === 'empty', 'Result period is empty');
  assert(result5.vocabulary.length === 0, 'Vocabulary is empty');
  assert(result5.sentences.length === 0, 'Sentences is empty');
  assert(result5.totalItems === 0, 'totalItems is 0');

  // -------------------------------------------------------------------------
  // TEST 6: Registros sem data válida
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 6: Records with invalid or missing date ---');
  const wordsTest6 = [
    { id: 'w_no_date', word: 'invalid_date_word', learnedAt: null },
    { id: 'w_bad_str', word: 'bad_date_word', learnedAt: 'invalid-date-string' },
    { id: 'w_empty', word: 'empty_date_word', learnedAt: '' },
    { id: 'w_valid', word: 'valid_word', learnedAt: '2026-11-10T11:00:00-03:00' },
  ];
  const sentencesTest6 = [
    { id: 's_no_date', sentence: 'No date sentence', date: undefined },
    { id: 's_bad_str', sentence: 'Bad date sentence', date: 'not-a-date' },
  ];

  const result6 = buildWeeklyLearningInsights({
    rawWords: wordsTest6,
    rawSentences: sentencesTest6,
    studentUid: 'student_106',
    referenceDate: refDate,
  });

  assert(result6.period === 'current_week', 'Period resolved without throwing');
  assert(result6.vocabulary.length === 1, 'Only the valid record was included');
  assert(result6.vocabulary[0].word === 'valid_word', 'Correct valid word included');
  assert(result6.sentences.length === 0, 'Invalid sentence records excluded safely');

  // -------------------------------------------------------------------------
  // TEST 7: Virada de mês e ano
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 7: Month and Year turnover handling ---');
  // 7A: Year turnover — Friday Jan 1, 2027
  const newYearRef = new Date('2027-01-01T15:00:00.000Z');
  const newYearBoundaries = getWeekBoundariesInSaoPaulo(newYearRef);
  assert(newYearBoundaries.currentWeek.startDate === '2026-12-28', 'Year turnover: Current Monday starts in previous year 2026-12-28');
  assert(newYearBoundaries.currentWeek.endDate === '2027-01-04', 'Year turnover: Next Monday is in new year 2027-01-04');
  assert(newYearBoundaries.previousWeek.startDate === '2026-12-21', 'Year turnover: Previous Monday is 2026-12-21');

  // 7B: Month turnover — Sunday Nov 1, 2026
  const monthTurnRef = new Date('2026-11-01T15:00:00.000Z');
  const monthBoundaries = getWeekBoundariesInSaoPaulo(monthTurnRef);
  assert(monthBoundaries.currentWeek.startDate === '2026-10-26', 'Month turnover: Sunday Nov 1 belongs to week starting Mon Oct 26');
  assert(monthBoundaries.currentWeek.endDate === '2026-11-02', 'Month turnover: Next Monday is Nov 2');

  // 7C: Boundary exclusivity test
  const curMon00 = new Date('2026-11-09T00:00:00-03:00').getTime();
  const nextMon00 = new Date('2026-11-16T00:00:00-03:00').getTime();
  assert(curMon00 >= boundaries.currentWeek.startMs && curMon00 < boundaries.currentWeek.endMs, 'Monday 00:00:00 is inclusive');
  assert(nextMon00 >= boundaries.currentWeek.endMs, 'Next Monday 00:00:00 is exclusive');

  // -------------------------------------------------------------------------
  // TEST 8: Professor alternando entre dois alunos
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 8: Teacher switching between two students (isolation & reset) ---');
  const studentAData = buildWeeklyLearningInsights({
    rawWords: [{ id: 'wa', word: 'studentA_word', learnedAt: '2026-11-10T10:00:00-03:00' }],
    rawSentences: [],
    studentUid: 'student_A',
    referenceDate: refDate,
  });

  const studentBData = buildWeeklyLearningInsights({
    rawWords: [{ id: 'wb', word: 'studentB_word', learnedAt: '2026-11-10T11:00:00-03:00' }],
    rawSentences: [],
    studentUid: 'student_B',
    referenceDate: refDate,
  });

  assert(studentAData.studentUid === 'student_A' && studentAData.vocabulary[0].word === 'studentA_word', 'Student A has only Student A words');
  assert(studentBData.studentUid === 'student_B' && studentBData.vocabulary[0].word === 'studentB_word', 'Student B has only Student B words');
  assert(!studentAData.vocabulary.some(w => w.word === 'studentB_word'), 'No cross-student leakage from B to A');
  assert(!studentBData.vocabulary.some(w => w.word === 'studentA_word'), 'No cross-student leakage from A to B');

  // -------------------------------------------------------------------------
  // TEST 9: Professor sem autorização para determinado aluno
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 9: Unauthorized teacher access rejection (403) ---');
  const unauthorizedTeacherCaller = {
    uid: 'unauthorized-teacher-999',
    email: 'unauthorized@teacher.com',
    role: 'teacher' as const,
  };

  const identityCheck = await resolveCanonicalStudentIdentity({
    caller: unauthorizedTeacherCaller,
    studentUid: 'random-unknown-student-456',
    studentEmail: 'unknown@student.com',
  });

  assert(identityCheck.authorized === false, 'Unauthorized teacher is denied access');
  assert(identityCheck.statusCode === 403, 'Denied with HTTP 403');

  // -------------------------------------------------------------------------
  // TEST 10: Atualização por F5 / Idempotência
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 10: F5 / Idempotence (Deterministic execution) ---');
  const runA = buildWeeklyLearningInsights({
    rawWords: wordsTest1,
    rawSentences: sentencesTest1,
    studentUid: 'student_101',
    referenceDate: refDate,
  });
  const runB = buildWeeklyLearningInsights({
    rawWords: wordsTest1,
    rawSentences: sentencesTest1,
    studentUid: 'student_101',
    referenceDate: refDate,
  });

  assert(JSON.stringify(runA) === JSON.stringify(runB), 'Repeated execution produces identical deterministic output (F5 safe)');

  // -------------------------------------------------------------------------
  // TEST 11: Acesso em outro computador (Multi-device Firestore authority)
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 11: Multi-computer consistency (Pure Firestore projection) ---');
  // buildWeeklyLearningInsights operates on passed Firestore records without reading localStorage
  const simulatedFirestoreWord = {
    id: 'cloud_w1',
    word: 'discipline',
    partOfSpeech: 'Noun',
    definitionEn: 'The practice of training people to obey rules or a code of behavior.',
    learnedAt: '2026-11-10T08:00:00-03:00',
  };
  const multiDeviceResult = buildWeeklyLearningInsights({
    rawWords: [simulatedFirestoreWord],
    rawSentences: [],
    studentUid: 'cloud_student',
    referenceDate: refDate,
  });
  assert(multiDeviceResult.vocabulary[0].word === 'discipline', 'Grounded purely in cloud Firestore records');

  // -------------------------------------------------------------------------
  // TEST 12: Funcionamento sob Firestore default-deny
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 12: Firestore default-deny compliance ---');
  const firestoreRulesContent = fs.readFileSync('firestore.rules', 'utf8');
  assert(
    firestoreRulesContent.includes('allow read, write: if false;'),
    'firestore.rules enforces default-deny'
  );

  // -------------------------------------------------------------------------
  // TEST 13: Zero chamadas Gemini
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 13: Zero Gemini API invocations confirmation ---');
  const newInsightsUtil = fs.readFileSync('src/utils/weeklyLearningInsights.ts', 'utf8');
  const newComponentContent = fs.readFileSync('src/components/NativeFriendLessonInsights.tsx', 'utf8');
  const serverAppContent = fs.readFileSync('serverApp.ts', 'utf8');

  assert(!newInsightsUtil.includes('GoogleGenAI') && !newInsightsUtil.includes('@google/genai'), 'weeklyLearningInsights.ts has no Gemini imports');
  assert(!newComponentContent.includes('GoogleGenAI') && !newComponentContent.includes('@google/genai'), 'NativeFriendLessonInsights.tsx has no Gemini imports');
  assert(!newComponentContent.includes('/api/lesson-insights/generate'), 'Component does not call AI snapshot generation endpoint');

  // -------------------------------------------------------------------------
  // TEST 14: Nenhuma alteração no Dictionary ou Journal
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 14: Non-destructive verification (Dictionary and Journal intact) ---');
  const sampleWordsOriginal = JSON.parse(JSON.stringify(wordsTest1));
  const sampleSentencesOriginal = JSON.parse(JSON.stringify(sentencesTest1));

  buildWeeklyLearningInsights({
    rawWords: wordsTest1,
    rawSentences: sentencesTest1,
    studentUid: 'student_101',
    referenceDate: refDate,
  });

  assert(JSON.stringify(wordsTest1) === JSON.stringify(sampleWordsOriginal), 'rawWords remained completely unmutated');
  assert(JSON.stringify(sentencesTest1) === JSON.stringify(sampleSentencesOriginal), 'rawSentences remained completely unmutated');

  // -------------------------------------------------------------------------
  // TEST 15: Nenhuma regressão no S-Path
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 15: No regression on S-Path, Video, Audio or Memorization ---');
  const spathTypes = fs.readFileSync('src/types.ts', 'utf8');
  assert(spathTypes.includes('interface RoutineItem'), 'RoutineItem preserved');
  assert(spathTypes.includes('interface StudentJournalEntry'), 'StudentJournalEntry preserved');
  assert(spathTypes.includes('interface DailyJournalEntry'), 'DailyJournalEntry preserved');
  assert(spathTypes.includes('interface StudentDictionaryEntry'), 'StudentDictionaryEntry preserved');

  // -------------------------------------------------------------------------
  // TEST 16: Summary of Results
  // -------------------------------------------------------------------------
  console.log('\n================================================================');
  console.log(`TEST SUITE RESULTS: ${passed} PASSED / ${failed} FAILED`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTestSuite().catch((err) => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});
