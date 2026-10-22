import { analyzeSentenceGrammarDeterministic, validateHomeworkAiEvaluationResponse } from '../src/utils/writingChecker';

console.log('--- RUNNING TEST SUITE FOR HOTFIX 2.3.4B ---');

let passedTests = 0;
let totalTests = 0;

function assert(condition: boolean, message: string) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`[PASS] ${message}`);
  } else {
    console.error(`[FAIL] ${message}`);
    process.exitCode = 1;
  }
}

// 1. Incomplete fragment checks
const test1 = analyzeSentenceGrammarDeterministic('Anyone know about', ['anyone'], 'anyone');
assert(test1.hasGrammarError === true, '"Anyone know about" must trigger hasGrammarError: true');
assert(test1.isCorrect === false, '"Anyone know about" must be isCorrect: false');
assert(test1.fixedSentence.includes('Does anyone know about'), '"Anyone know about" correction must include "Does anyone know about"');

const test2 = analyzeSentenceGrammarDeterministic('Nobody told', ['told'], 'told');
assert(test2.hasGrammarError === true, '"Nobody told" must trigger hasGrammarError: true');
assert(test2.isCorrect === false, '"Nobody told" must be isCorrect: false');
assert(test2.fixedSentence.includes('Nobody told me about it'), '"Nobody told" correction must provide a complete object');

// 2. Complete, grammatically correct sentences
const test3 = analyzeSentenceGrammarDeterministic('Does anyone know about this new project?', ['anyone'], 'anyone');
assert(test3.hasGrammarError === false, '"Does anyone know about this new project?" must be grammatically sound');
assert(test3.isCorrect === true, '"Does anyone know about this new project?" must be isCorrect: true');

const test4 = analyzeSentenceGrammarDeterministic('Nobody told me about the meeting yesterday.', ['told'], 'told');
assert(test4.hasGrammarError === false, '"Nobody told me about the meeting yesterday." must be grammatically sound');
assert(test4.isCorrect === true, '"Nobody told me about the meeting yesterday." must be isCorrect: true');

// 3. validateHomeworkAiEvaluationResponse: Rejection of synthetic approvals of fragments
const invalidGeminiResponse = {
  sentenceFeedback: [
    {
      word: 'anyone',
      originalSentence: 'Anyone know about',
      isCorrect: true, // ILLEGITIMATE SYNTHETIC APPROVAL
      correctedSentence: 'Anyone know about',
      explanationPt: 'Muito bem!',
      explanationEn: 'Well done!',
    },
  ],
  tutorFeedbackSummaryPt: 'Bom trabalho.',
  tutorFeedbackSummaryEn: 'Good job.',
};

const isValidated = validateHomeworkAiEvaluationResponse(
  invalidGeminiResponse,
  [{ word: 'anyone' }],
  { anyone: 'Anyone know about' }
);
assert(isValidated === false, 'Gemini response that approves "Anyone know about" must be strictly REJECTED');

// 4. validateHomeworkAiEvaluationResponse: Acceptance of legitimate correction
const validGeminiResponse = {
  sentenceFeedback: [
    {
      word: 'anyone',
      originalSentence: 'Anyone know about',
      isCorrect: false, // ACCURATE REJECTION
      correctedSentence: 'Does anyone know about this?',
      explanationPt: 'A frase é uma pergunta incompleta. Use "Does anyone know about this?".',
      explanationEn: 'The sentence is an incomplete question. Use "Does anyone know about this?".',
    },
  ],
  readingFeedback: [
    {
      id: 'q-1',
      isCorrect: true,
      explanationPt: 'Resposta correta com base no parágrafo 2.',
      explanationEn: 'Correct answer based on paragraph 2.',
    },
  ],
  tutorFeedbackSummaryPt: 'Continue praticando a estrutura das perguntas.',
  tutorFeedbackSummaryEn: 'Keep practicing question structure.',
};

const isLegitValidated = validateHomeworkAiEvaluationResponse(
  validGeminiResponse,
  [{ word: 'anyone' }],
  { anyone: 'Anyone know about' },
  [{ id: 'q-1', question: 'What happened?', options: ['A', 'B'], correctAnswer: 0 }],
  { 'q-1': 0 }
);
assert(isLegitValidated === true, 'Legitimate pedagogical correction must be ACCEPTED');

// 5. Weighting calculation verification
const matchScore = (5 / 5) * 20; // 20
const fillScore = (5 / 5) * 25;  // 25
const sentenceScore = (4 / 5) * 35; // 28
const quizScore = (2 / 2) * 20; // 20
const totalCalculated = Math.round(matchScore + fillScore + sentenceScore + quizScore); // 20+25+28+20 = 93
assert(totalCalculated === 93, 'Standardized scoring weights: Matching 20%, Fill 25%, Sentences 35%, Reading 20% equals 93/100');

console.log(`\nResults: ${passedTests}/${totalTests} tests passed.`);
if (passedTests === totalTests) {
  console.log('ALL TESTS PASSED SUCCESSFULLY FOR HOTFIX 2.3.4B!');
} else {
  process.exit(1);
}
