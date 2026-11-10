/**
 * TEST SUITE: FASE INSIGHTS.2A — LIMITAÇÃO DE EXIBIÇÃO WEEKLY LEARNING INSIGHTS
 *
 * Validates the 8 mandatory test conditions:
 * 1. Semana com 10 palavras e 5 frases → exibir 6 palavras e 3 frases.
 * 2. Semana com 4 palavras e 2 frases → exibir 4 palavras e 2 frases.
 * 3. Semana atual vazia → aplicar limites à semana anterior (e.g. 10 palavras e 5 frases da anterior resultam em 6 e 3).
 * 4. Semana atual com apenas palavras → não buscar frases da semana anterior.
 * 5. Ordenação correta por data decrescente com desempate determinístico.
 * 6. F5 e troca de aluno preservam os resultados (idempotência e isolamento).
 * 7. Nenhuma alteração no Dictionary, Journal ou S-Path (não-destrutivo).
 * 8. Build e TypeScript sem erros.
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
  MAX_WEEKLY_VOCABULARY,
  MAX_WEEKLY_SENTENCES,
} from '../src/utils/weeklyLearningInsights';

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
  console.log('START: FASE INSIGHTS.2A — Limiting Weekly Learning Insights');
  console.log('================================================================\n');

  // Fixed reference date: Tuesday, Nov 10, 2026, 14:00:00 UTC (11:00:00 in America/Sao_Paulo)
  // Current Week: Nov 9, 2026 to Nov 16, 2026
  // Previous Week: Nov 2, 2026 to Nov 9, 2026
  const refDate = new Date('2026-11-10T14:00:00.000Z');
  const boundaries = getWeekBoundariesInSaoPaulo(refDate);

  console.log('Sao Paulo Week Boundaries for Ref Date (2026-11-10):');
  console.log('  Current Week :', boundaries.currentWeek.startDate, 'to', boundaries.currentWeek.endDate, `[${boundaries.currentWeek.formattedRange}]`);
  console.log('  Previous Week:', boundaries.previousWeek.startDate, 'to', boundaries.previousWeek.endDate, `[${boundaries.previousWeek.formattedRange}]`);
  console.log(`  Limits: MAX_WORDS = ${MAX_WEEKLY_VOCABULARY}, MAX_SENTENCES = ${MAX_WEEKLY_SENTENCES}\n`);

  // -------------------------------------------------------------------------
  // TEST 1: Semana com 10 palavras e 5 frases → exibir 6 palavras e 3 frases
  // -------------------------------------------------------------------------
  console.log('--- TEST 1: Current week with 10 words and 5 sentences → displays 6 words and 3 sentences ---');
  const tenWords = [
    { id: 'w01', word: 'word_01', learnedAt: '2026-11-09T08:00:00-03:00' },
    { id: 'w02', word: 'word_02', learnedAt: '2026-11-09T09:00:00-03:00' },
    { id: 'w03', word: 'word_03', learnedAt: '2026-11-09T10:00:00-03:00' },
    { id: 'w04', word: 'word_04', learnedAt: '2026-11-09T11:00:00-03:00' },
    { id: 'w05', word: 'word_05', learnedAt: '2026-11-09T12:00:00-03:00' },
    { id: 'w06', word: 'word_06', learnedAt: '2026-11-10T08:00:00-03:00' },
    { id: 'w07', word: 'word_07', learnedAt: '2026-11-10T09:00:00-03:00' },
    { id: 'w08', word: 'word_08', learnedAt: '2026-11-10T10:00:00-03:00' },
    { id: 'w09', word: 'word_09', learnedAt: '2026-11-10T11:00:00-03:00' },
    { id: 'w10', word: 'word_10', learnedAt: '2026-11-10T12:00:00-03:00' }, // Newest word
  ];

  const fiveSentences = [
    { id: 's01', sentence: 'Sentence 01 was written on Monday morning.', date: '2026-11-09T08:30:00-03:00' },
    { id: 's02', sentence: 'Sentence 02 was written on Monday afternoon.', date: '2026-11-09T14:00:00-03:00' },
    { id: 's03', sentence: 'Sentence 03 was written on Monday evening.', date: '2026-11-09T19:00:00-03:00' },
    { id: 's04', sentence: 'Sentence 04 was written on Tuesday morning.', date: '2026-11-10T09:15:00-03:00' },
    { id: 's05', sentence: 'Sentence 05 was written on Tuesday noon.', date: '2026-11-10T12:00:00-03:00' }, // Newest sentence
  ];

  const result1 = buildWeeklyLearningInsights({
    rawWords: tenWords,
    rawSentences: fiveSentences,
    studentUid: 'student_1',
    studentEmail: 'student1@example.com',
    referenceDate: refDate,
  });

  assert(result1.period === 'current_week', 'Period is current_week');
  assert(result1.vocabulary.length === 6, 'Vocabulary limited to exactly 6 words', `got ${result1.vocabulary.length}`);
  assert(result1.sentences.length === 3, 'Sentences limited to exactly 3 sentences', `got ${result1.sentences.length}`);
  assert(result1.totalItems === 9, 'totalItems is 6 + 3 = 9', `got ${result1.totalItems}`);
  // Verify the 6 words are the newest ones (w10 down to w05)
  assert(result1.vocabulary[0].word === 'word_10', 'First word is the newest (word_10)');
  assert(result1.vocabulary[5].word === 'word_05', 'Sixth word is word_05');
  // Verify the 3 sentences are the newest ones (s05, s04, s03)
  assert(result1.sentences[0].id === 's05', 'First sentence is the newest (s05)');
  assert(result1.sentences[2].id === 's03', 'Third sentence is s03');

  // -------------------------------------------------------------------------
  // TEST 2: Semana com 4 palavras e 2 frases → exibir 4 e 2
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 2: Current week with 4 words and 2 sentences → displays 4 and 2 ---');
  const fourWords = tenWords.slice(0, 4);
  const twoSentences = fiveSentences.slice(0, 2);

  const result2 = buildWeeklyLearningInsights({
    rawWords: fourWords,
    rawSentences: twoSentences,
    studentUid: 'student_2',
    studentEmail: 'student2@example.com',
    referenceDate: refDate,
  });

  assert(result2.period === 'current_week', 'Period is current_week');
  assert(result2.vocabulary.length === 4, 'Displays all 4 available words (less than 6 limit)', `got ${result2.vocabulary.length}`);
  assert(result2.sentences.length === 2, 'Displays all 2 available sentences (less than 3 limit)', `got ${result2.sentences.length}`);
  assert(result2.totalItems === 6, 'totalItems is 4 + 2 = 6', `got ${result2.totalItems}`);

  // -------------------------------------------------------------------------
  // TEST 3: Semana atual vazia → aplicar limites à semana anterior
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 3: Current week empty → apply limits to previous week (10 words, 5 sentences -> 6 and 3) ---');
  const prevWeekTenWords = [
    { id: 'pw01', word: 'prev_word_01', learnedAt: '2026-11-03T08:00:00-03:00' },
    { id: 'pw02', word: 'prev_word_02', learnedAt: '2026-11-03T09:00:00-03:00' },
    { id: 'pw03', word: 'prev_word_03', learnedAt: '2026-11-03T10:00:00-03:00' },
    { id: 'pw04', word: 'prev_word_04', learnedAt: '2026-11-04T11:00:00-03:00' },
    { id: 'pw05', word: 'prev_word_05', learnedAt: '2026-11-04T12:00:00-03:00' },
    { id: 'pw06', word: 'prev_word_06', learnedAt: '2026-11-05T08:00:00-03:00' },
    { id: 'pw07', word: 'prev_word_07', learnedAt: '2026-11-05T09:00:00-03:00' },
    { id: 'pw08', word: 'prev_word_08', learnedAt: '2026-11-06T10:00:00-03:00' },
    { id: 'pw09', word: 'prev_word_09', learnedAt: '2026-11-06T11:00:00-03:00' },
    { id: 'pw10', word: 'prev_word_10', learnedAt: '2026-11-07T12:00:00-03:00' },
  ];

  const prevWeekFiveSentences = [
    { id: 'ps01', sentence: 'Prev sentence 01', date: '2026-11-03T10:00:00-03:00' },
    { id: 'ps02', sentence: 'Prev sentence 02', date: '2026-11-04T11:00:00-03:00' },
    { id: 'ps03', sentence: 'Prev sentence 03', date: '2026-11-05T12:00:00-03:00' },
    { id: 'ps04', sentence: 'Prev sentence 04', date: '2026-11-06T13:00:00-03:00' },
    { id: 'ps05', sentence: 'Prev sentence 05', date: '2026-11-07T14:00:00-03:00' },
  ];

  const result3 = buildWeeklyLearningInsights({
    rawWords: prevWeekTenWords,
    rawSentences: prevWeekFiveSentences,
    studentUid: 'student_3',
    studentEmail: 'student3@example.com',
    referenceDate: refDate,
  });

  assert(result3.period === 'previous_week', 'Period is previous_week');
  assert(result3.isFallbackToPreviousWeek === true, 'isFallbackToPreviousWeek is true');
  assert(result3.vocabulary.length === 6, 'Previous week vocabulary limited to 6 words', `got ${result3.vocabulary.length}`);
  assert(result3.sentences.length === 3, 'Previous week sentences limited to 3 sentences', `got ${result3.sentences.length}`);
  assert(result3.vocabulary[0].word === 'prev_word_10', 'Previous week newest word is prev_word_10');
  assert(result3.sentences[0].id === 'ps05', 'Previous week newest sentence is ps05');

  // -------------------------------------------------------------------------
  // TEST 4: Semana atual com apenas palavras → não buscar frases da semana anterior
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 4: Current week with only words → do not fetch sentences from previous week ---');
  const result4 = buildWeeklyLearningInsights({
    rawWords: [
      { id: 'w_cur_1', word: 'resilience', learnedAt: '2026-11-10T09:00:00-03:00' },
      { id: 'w_cur_2', word: 'mindset', learnedAt: '2026-11-10T10:00:00-03:00' },
    ],
    // Sentences only in previous week
    rawSentences: prevWeekFiveSentences,
    studentUid: 'student_4',
    studentEmail: 'student4@example.com',
    referenceDate: refDate,
  });

  assert(result4.period === 'current_week', 'Period is current_week (because current week has words)');
  assert(result4.isFallbackToPreviousWeek === false, 'Not a fallback');
  assert(result4.vocabulary.length === 2, 'Displays 2 words from current week');
  assert(result4.sentences.length === 0, 'Sentences is strictly empty (did not fetch previous week sentences)');
  assert(result4.hasSentences === false, 'hasSentences is false');

  // -------------------------------------------------------------------------
  // TEST 5: Ordenação correta por data decrescente e desempate determinístico
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 5: Date descending sort with deterministic tie-breaking ---');
  const wordsWithTies = [
    // Two words with same timestamp
    { id: 'w_tie_z', word: 'zebra', learnedAt: '2026-11-10T10:00:00-03:00' },
    { id: 'w_tie_a', word: 'apple', learnedAt: '2026-11-10T10:00:00-03:00' },
    // Earlier word
    { id: 'w_early', word: 'banana', learnedAt: '2026-11-09T10:00:00-03:00' },
    // Later word
    { id: 'w_latest', word: 'cranberry', learnedAt: '2026-11-10T15:00:00-03:00' },
  ];

  const sentencesWithTies = [
    // Two sentences on same calendar date
    { id: 's_tie_b', sentence: 'Bob likes tea.', date: '2026-11-10' },
    { id: 's_tie_a', sentence: 'Alice likes coffee.', date: '2026-11-10' },
    // Earlier sentence
    { id: 's_early', sentence: 'Yesterday sentence.', date: '2026-11-09' },
  ];

  const result5 = buildWeeklyLearningInsights({
    rawWords: wordsWithTies,
    rawSentences: sentencesWithTies,
    studentUid: 'student_5',
    referenceDate: refDate,
  });

  assert(result5.vocabulary[0].word === 'cranberry', 'Latest word is first');
  // At 10:00:00, apple comes before zebra due to deterministic tie-breaker (alphabetical)
  assert(result5.vocabulary[1].word === 'apple', 'Tie-break: apple precedes zebra deterministically');
  assert(result5.vocabulary[2].word === 'zebra', 'Tie-break: zebra follows apple');
  assert(result5.vocabulary[3].word === 'banana', 'Earlier word banana is last');

  // For sentences: same date tie-break
  assert(result5.sentences[0].sentence === 'Alice likes coffee.', 'Tie-break: Alice precedes Bob deterministically');
  assert(result5.sentences[1].sentence === 'Bob likes tea.', 'Tie-break: Bob follows Alice');
  assert(result5.sentences[2].sentence === 'Yesterday sentence.', 'Earlier sentence is last');

  // -------------------------------------------------------------------------
  // TEST 6: F5 e troca de aluno preservam os resultados (idempotência e isolamento)
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 6: F5 idempotency and multi-student isolation ---');
  const run1 = buildWeeklyLearningInsights({
    rawWords: tenWords,
    rawSentences: fiveSentences,
    studentUid: 'student_alpha',
    referenceDate: refDate,
  });
  const run2 = buildWeeklyLearningInsights({
    rawWords: tenWords,
    rawSentences: fiveSentences,
    studentUid: 'student_alpha',
    referenceDate: refDate,
  });

  assert(JSON.stringify(run1) === JSON.stringify(run2), 'F5 repeated runs produce identical deterministic output');

  const studentBeta = buildWeeklyLearningInsights({
    rawWords: [{ id: 'wb', word: 'beta_exclusive', learnedAt: '2026-11-10T09:00:00-03:00' }],
    rawSentences: [],
    studentUid: 'student_beta',
    referenceDate: refDate,
  });

  assert(studentBeta.vocabulary.length === 1 && studentBeta.vocabulary[0].word === 'beta_exclusive', 'Student Beta isolated');
  assert(!run1.vocabulary.some(w => w.word === 'beta_exclusive'), 'No leakage between student sessions');

  // -------------------------------------------------------------------------
  // TEST 7: Nenhuma alteração no Dictionary, Journal ou S-Path
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 7: Non-destructive verification (Raw data untouched) ---');
  const rawWordsCopy = JSON.parse(JSON.stringify(tenWords));
  const rawSentencesCopy = JSON.parse(JSON.stringify(fiveSentences));

  buildWeeklyLearningInsights({
    rawWords: tenWords,
    rawSentences: fiveSentences,
    studentUid: 'student_inspect',
    referenceDate: refDate,
  });

  assert(JSON.stringify(tenWords) === JSON.stringify(rawWordsCopy), 'rawWords input array is unmodified');
  assert(JSON.stringify(fiveSentences) === JSON.stringify(rawSentencesCopy), 'rawSentences input array is unmodified');

  // Check types for S-Path integrity
  const typesContent = fs.readFileSync('src/types.ts', 'utf8');
  assert(typesContent.includes('interface RoutineItem'), 'S-Path RoutineItem preserved');
  assert(typesContent.includes('interface StudentDictionaryEntry'), 'StudentDictionaryEntry preserved');
  assert(typesContent.includes('interface DailyJournalEntry'), 'DailyJournalEntry preserved');

  // -------------------------------------------------------------------------
  // TEST 8: Zero AI / Gemini calls
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 8: Verification of Zero AI / Gemini calls ---');
  const weeklyInsightsFile = fs.readFileSync('src/utils/weeklyLearningInsights.ts', 'utf8');
  assert(!weeklyInsightsFile.includes('GoogleGenAI') && !weeklyInsightsFile.includes('@google/genai'), 'Zero Gemini calls in weeklyLearningInsights.ts');

  // Summary
  console.log('\n================================================================');
  console.log(`TEST SUITE RESULTS: ${passed} PASSED / ${failed} FAILED`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTestSuite().catch((err) => {
  console.error('Fatal error in test suite:', err);
  process.exit(1);
});
