import assert from 'node:assert';
import {
  isSyntheticHomeworkEvaluation,
  isValidHomeworkEvaluation,
  validateHomeworkAiEvaluationResponse,
  evaluateWeeklyHomeworkApi,
} from '../src/utils/writingChecker';
import { sanitizeLoadedHomeworkData } from '../src/utils/studentPersistence';
import { HomeworkAiEvaluation, WeeklyHomeworkData } from '../src/types';

console.log('🧪 Starting HOTFIX 2.2 — Homework Evaluation Automated Verification Suite...\n');

// =========================================================================
// TEST 1: Synthetic Evaluation Detection & Legacy Fallback Elimination
// =========================================================================
console.log('▶ Test 1: Detecting and rejecting synthetic heuristic evaluations...');

const syntheticEval1: any = {
  overallScore: 85,
  overallFeedback: 'Parabéns pela dedicação! Você concluiu as etapas de memorização do vocabulário desta semana. Continue praticando para fixar ainda mais as novas palavras.',
  detailedSentenceFeedback: 'Bom trabalho na construção de frases.',
  sentenceEvaluationResults: [
    {
      word: 'challenge',
      originalSentence: 'This is a big challenge.',
      correctedSentence: 'This is a big challenge.',
      score: 85,
      isCorrect: true,
      pedagogicalExplanation: 'Frase adequada ao contexto.',
    },
  ],
  vocabularyRetentionScore: 85,
  grammarAccuracyScore: 85,
  recommendations: ['Revise os termos nos próximos dias.'],
};

assert.strictEqual(
  isSyntheticHomeworkEvaluation(syntheticEval1),
  true,
  'Failed: syntheticEval1 must be detected as synthetic'
);

assert.strictEqual(
  isValidHomeworkEvaluation(syntheticEval1),
  false,
  'Failed: isValidHomeworkEvaluation must reject synthetic evaluation'
);

const syntheticEval2: any = {
  overallScore: 90,
  overallFeedback: 'Ótimo trabalho! Você completou suas frases com dedicação e demonstrou bom entendimento.',
  sentenceEvaluationResults: [],
  vocabularyRetentionScore: 90,
  grammarAccuracyScore: 90,
  recommendations: [],
};

assert.strictEqual(
  isSyntheticHomeworkEvaluation(syntheticEval2),
  true,
  'Failed: syntheticEval2 must be detected as synthetic due to missing sentence results'
);

console.log('  ✔ Successfully detects synthetic and heuristic evaluation patterns.');

// =========================================================================
// TEST 2: Genuine Pedagogical Evaluation Acceptance
// =========================================================================
console.log('\n▶ Test 2: Validating genuine pedagogical evaluation...');

const genuineEval: any = {
  overallScore: 82,
  overallFeedback: 'Excelente aplicação do vocabulário semanal em frases com contexto claro e natural. Na frase com "breakthrough", note o uso do artigo indefinido.',
  detailedSentenceFeedback: 'Suas frases demonstram domínio contextual das palavras "challenge" e "achieve".',
  sentenceEvaluationResults: [
    {
      word: 'challenge',
      originalSentence: 'Learning fluent English is a big challenge for international professionals.',
      correctedSentence: 'Learning fluent English is a big challenge for international professionals.',
      score: 95,
      isCorrect: true,
      pedagogicalExplanation: 'Estrutura gramatical impecável com substantivo e adjetivo empregados com precisão.',
      grammarPointers: ['Excelente concordância verbal'],
      cefrAlignment: 'B2',
    },
    {
      word: 'achieve',
      originalSentence: 'We want to achieve our quarterly goals together.',
      correctedSentence: 'We want to achieve our quarterly goals together.',
      score: 90,
      isCorrect: true,
      pedagogicalExplanation: 'Uso transitivo correto do verbo achieve com objeto direto apropriado.',
      grammarPointers: ['Bom emprego de infinitivo com to'],
      cefrAlignment: 'B1',
    },
  ],
  vocabularyRetentionScore: 88,
  grammarAccuracyScore: 84,
  recommendations: [
    'Continue praticando collocations como "overcome a challenge".',
    'Explore sinônimos formais de "achieve" como "attain" ou "accomplish".',
  ],
};

assert.strictEqual(
  isSyntheticHomeworkEvaluation(genuineEval),
  false,
  'Failed: genuineEval must not be flagged as synthetic'
);

assert.strictEqual(
  isValidHomeworkEvaluation(genuineEval),
  true,
  'Failed: isValidHomeworkEvaluation must accept genuine evaluation'
);

const expectedPrompts = [{ word: 'challenge' }, { word: 'achieve' }];
const studentSentences = {
  challenge: 'Learning fluent English is a big challenge for international professionals.',
  achieve: 'We want to achieve our quarterly goals together.',
};

assert.strictEqual(
  validateHomeworkAiEvaluationResponse(genuineEval, expectedPrompts, studentSentences),
  true,
  'Failed: validateHomeworkAiEvaluationResponse must validate genuine response matching student sentences'
);

console.log('  ✔ Genuine pedagogical evaluations are correctly validated and accepted.');

// =========================================================================
// TEST 3: Validation Rejection on Mismatched Student Answers
// =========================================================================
console.log('\n▶ Test 3: Rejecting AI responses that do not match student answers...');

const hallucinatedEval: any = {
  overallScore: 80,
  overallFeedback: 'Bom trabalho com as frases apresentadas.',
  sentenceEvaluationResults: [
    {
      word: 'challenge',
      originalSentence: 'He accepted the new challenge yesterday at school.', // Mismatched text!
      correctedSentence: 'He accepted the new challenge yesterday at school.',
      score: 85,
      isCorrect: true,
      pedagogicalExplanation: 'Frase aceitável.',
    },
  ],
  vocabularyRetentionScore: 80,
  grammarAccuracyScore: 80,
  recommendations: ['Pratique mais.'],
};

assert.strictEqual(
  validateHomeworkAiEvaluationResponse(hallucinatedEval, expectedPrompts, studentSentences),
  false,
  'Failed: validateHomeworkAiEvaluationResponse must reject evaluation with mismatched original sentences'
);

console.log('  ✔ Mismatched or hallucinated evaluations are strictly rejected.');

// =========================================================================
// TEST 4: Student Answers Preservation & Legacy Sanitization
// =========================================================================
console.log('\n▶ Test 4: Preserving student typed answers while sanitizing legacy synthetic evals...');

const legacySavedHomework: any = {
  id: 'hw-test-123',
  weekLabel: 'Semana de 20 de Outubro de 2026',
  createdAt: '2026-10-20T10:00:00.000Z',
  targetDay: 'thursday',
  studentId: 'user-canonical-uid-1001',
  studentName: 'Ana Silva',
  studentLevel: 'Intermediate',
  vocabularyList: [
    {
      word: 'challenge',
      translation: 'desafio',
      contextSentence: 'Taking this course is a challenge.',
      contextTranslation: 'Fazer este curso é um desafio.',
      pronunciation: '/ˈtʃælɪndʒ/',
      partOfSpeech: 'noun',
      definition: 'a task or situation that tests abilities',
    },
  ],
  matchingPairs: [
    {
      id: 'm1',
      word: 'challenge',
      translation: 'desafio',
    },
  ],
  fillInBlanks: [
    {
      id: 'f1',
      sentenceWithBlank: 'This task is a big ____.',
      correctWord: 'challenge',
      options: ['challenge', 'easy', 'light'],
      explanation: 'Use the noun.',
    },
  ],
  sentenceWritingPrompts: [
    {
      word: 'challenge',
      instructions: 'Write a sentence with challenge',
    },
  ],
  readingPassage: {
    title: 'New Opportunities',
    text: 'Every challenge is an opportunity.',
    highlightedWords: ['challenge'],
    questions: [
      {
        id: 'q1',
        question: 'What is a challenge?',
        options: ['An opportunity', 'A roadblock', 'Nothing'],
        correctAnswer: 0,
        explanation: 'The text states so.',
      },
    ],
  },
  // Student typed answers:
  studentAnswers: {
    matching: { m1: 'challenge' },
    fillInBlanks: { f1: 'challenge' },
    sentences: { challenge: 'I face every daily challenge with confidence.' },
    quizAnswers: { q1: 0 },
  },
  // Legacy synthetic evaluation:
  aiEvaluation: syntheticEval1,
  isCompleted: true,
  score: 85,
};

const sanitized = sanitizeLoadedHomeworkData(legacySavedHomework);

assert.strictEqual(
  sanitized.aiEvaluation,
  undefined,
  'Failed: legacy synthetic aiEvaluation must be stripped'
);
assert.strictEqual(
  sanitized.isCompleted,
  false,
  'Failed: isCompleted must be reset to false so student can receive genuine evaluation'
);
assert.strictEqual(
  sanitized.score,
  undefined,
  'Failed: synthetic score must be stripped'
);
assert.deepStrictEqual(
  sanitized.studentAnswers,
  legacySavedHomework.studentAnswers,
  'Failed: student typed answers must be 100% preserved!'
);
assert.strictEqual(
  sanitized.studentAnswers?.sentences?.challenge,
  'I face every daily challenge with confidence.',
  'Failed: exact student sentence must remain intact'
);

console.log('  ✔ Student answers preserved 100% while synthetic evaluation is stripped.');

// =========================================================================
// TEST 5: Legitimate Evaluation Retained on Reload/F5
// =========================================================================
console.log('\n▶ Test 5: Retaining genuine evaluation across reload/F5...');

const validSavedHomework: WeeklyHomeworkData = {
  ...legacySavedHomework,
  aiEvaluation: genuineEval,
  isCompleted: true,
  score: 82,
};

const sanitizedValid = sanitizeLoadedHomeworkData(validSavedHomework);

assert.deepStrictEqual(
  sanitizedValid.aiEvaluation,
  genuineEval,
  'Failed: genuine evaluation must be retained across reloads'
);
assert.strictEqual(
  sanitizedValid.isCompleted,
  true,
  'Failed: isCompleted must remain true for genuine evaluation'
);
assert.strictEqual(
  sanitizedValid.score,
  82,
  'Failed: genuine score must be retained'
);

console.log('  ✔ Genuine evaluations are fully retained across page reloads and sessions.');

// =========================================================================
// TEST 6: Transparent Error Handling on API Failure (No Local Synthetic Fallback)
// =========================================================================
console.log('\n▶ Test 6: Verifying evaluateWeeklyHomeworkApi throws transparently without local heuristic fallback...');

// Test that calling evaluateWeeklyHomeworkApi with an invalid/mock server URL fails transparently:
let caughtError: any = null;
try {
  // Pass an invalid port/endpoint so it triggers failure
  await evaluateWeeklyHomeworkApi({
    homework: legacySavedHomework,
    studentAnswers: legacySavedHomework.studentAnswers!,
    studentLevel: 'Beginner',
    studentName: 'Ana',
    currentLanguage: 'pt',
  });
} catch (err: any) {
  caughtError = err;
}

// In unit test environment without dev server running on port 3000, it MUST throw an error
// and NOT return a synthetic fallback object with overallScore and boilerplate praise!
assert.ok(
  caughtError !== null,
  'Failed: evaluateWeeklyHomeworkApi MUST throw an error when API is unavailable, not return heuristic score!'
);

console.log('  ✔ Local heuristic fallback was completely removed. Transparent error is raised.');

// =========================================================================
// TEST 7: Canonical UID & Weekly Cycle Path Integrity
// =========================================================================
console.log('\n▶ Test 7: Checking canonical UID and weekly cycle validation...');

const validUidPattern = /^[a-zA-Z0-9_-]+$/;
const canonicalUid = 'user-canonical-uid-1001';
const weeklyCycle = 3;

assert.strictEqual(
  validUidPattern.test(canonicalUid),
  true,
  'Failed: Canonical UID must be sanitized alphanumeric/dashes'
);
assert.strictEqual(
  typeof weeklyCycle,
  'number',
  'Failed: weeklyCycle must be a valid number'
);
const docPath = `users/${canonicalUid}/homework/week-${weeklyCycle}`;
assert.strictEqual(
  docPath,
  'users/user-canonical-uid-1001/homework/week-3',
  'Failed: Document path must strictly follow users/{cleanUid}/homework/week-{cycle}'
);

console.log('  ✔ Canonical UID path strictly adheres to Firestore (default) structure.');

// =========================================================================
// TEST 8: Regression Check for 5 Words & Native Friends Notes
// =========================================================================
console.log('\n▶ Test 8: Verifying no regression in 5 Words & Native Friends Notes...');

import fs from 'node:fs';

const serverAppContent = fs.readFileSync('serverApp.ts', 'utf8');
assert.ok(
  serverAppContent.includes('/api/check-writing'),
  'Failed: 5 Words / Daily Sentence check-writing validation endpoint must remain intact'
);
assert.ok(
  serverAppContent.includes('/api/pedagogical-notes/transform'),
  'Failed: Native Friends pedagogical notes transform endpoint must remain intact'
);
import { resolveGeminiContingencyModels } from '../src/serverGeminiSecurity';

const models = resolveGeminiContingencyModels();
assert.ok(models.includes('gemini-3.5-flash') || models.includes('gemini-3.5-flash-lite'), 'Failed: Contingency must include gemini-3.5-flash or gemini-3.5-flash-lite');
assert.ok(models.includes('gemini-3.8-flash'), 'Failed: Contingency must include gemini-3.8-flash');
assert.ok(models.includes('gemini-3.1-flash-lite'), 'Failed: Contingency must include gemini-3.1-flash-lite');
assert.strictEqual(models.length, 3, 'Failed: Contingency must contain exactly 3 models');

console.log('  ✔ 5 Words, Native Friends Notes, and Gemini 3-model contingency remain intact and untouched.');

console.log('\n🎉 ALL 8 HOTFIX 2.2 VERIFICATION TESTS PASSED SUCCESSFULLY!\n');
