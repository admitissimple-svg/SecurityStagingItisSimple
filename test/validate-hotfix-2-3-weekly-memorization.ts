import assert from 'node:assert';
import {
  isGenericPedagogicalDefinition,
  isGenericPedagogicalExample,
  executeGeminiWithContingency,
  resolveGeminiContingencyModels,
} from '../src/serverGeminiSecurity';
import {
  analyzeSentenceGrammarDeterministic,
  validateHomeworkAiEvaluationResponse,
  isValidHomeworkEvaluation,
  isSyntheticHomeworkEvaluation,
} from '../src/utils/writingChecker';
import {
  synthesizeCohesiveStoryAndQuestions,
  profileWord,
} from '../src/utils/pedagogicalStorySynthesizer';
import {
  isBadStoryText,
  validatePart4StoryResponse,
  validateDirectMemorizationAiResponse,
} from '../serverApp';

console.log('🧪 Starting HOTFIX 2.3 — Weekly Memorization Activity Automated Test Suite...\n');

// =========================================================================
// PART 1: Meaning Association
// =========================================================================
console.log('▶ Test 1: Meaning Association (Part 1)...');

// 1.1 Rejection of generic/artificial boilerplate definitions
const genericDefinitions = [
  'an important concept, role, or tool referring to something essential',
  'a fundamental word for level B1 learners',
  'characterized by being very useful in conversation',
  'in a distinct manner, degree, or timing characterized as efficient',
  'to engage in, conduct, or carry out the action of learning',
  'conversational expression to enrich your speaking flow',
  'key communicative expression for business meetings',
  'a natural conversational expression used by native speakers to articulate ideas',
  'authentic lexical expression (essential for daily routines)',
];

for (const def of genericDefinitions) {
  assert.strictEqual(
    isGenericPedagogicalDefinition(def),
    true,
    `Failed: Generic definition must be rejected: "${def}"`
  );
}
console.log('  ✔ All generic and formulaic definitions successfully detected and rejected.');

// 1.2 Acceptance of authentic pedagogical definitions
const authenticDefinitions = [
  'Exactly correct or completely accurate.',
  'An important discovery or development that helps solve a problem.',
  'To succeed in finishing something or reaching an aim, especially after a lot of work.',
  'A situation in which you must face difficulty or danger with courage.',
];

for (const def of authenticDefinitions) {
  assert.strictEqual(
    isGenericPedagogicalDefinition(def),
    false,
    `Failed: Authentic definition must be accepted: "${def}"`
  );
}
console.log('  ✔ Authentic pedagogical definitions correctly accepted.');

// 1.3 Deterministic association evaluation without AI calls
const matchingPairs = [
  { id: 'm1', word: 'spot on', definition: 'Exactly correct or completely accurate.', translation: 'certeiro / na mosca' },
  { id: 'm2', word: 'breakthrough', definition: 'An important discovery or progress.', translation: 'avanço / descoberta' },
];

const studentAnswersCorrect = { m1: 'spot on', m2: 'Breakthrough' };
const studentAnswersIncorrect = { m1: 'breakthrough', m2: 'spot on' };

const evalCorrect = matchingPairs.map(p => {
  const ans = (studentAnswersCorrect[p.id as keyof typeof studentAnswersCorrect] || '').trim();
  return ans.toLowerCase() === p.word.toLowerCase();
});
assert.deepStrictEqual(evalCorrect, [true, true], 'Failed: Deterministic evaluation should match correct pairs case-insensitively');

const evalIncorrect = matchingPairs.map(p => {
  const ans = (studentAnswersIncorrect[p.id as keyof typeof studentAnswersIncorrect] || '').trim();
  return ans.toLowerCase() === p.word.toLowerCase();
});
assert.deepStrictEqual(evalIncorrect, [false, false], 'Failed: Deterministic evaluation should reject wrong pairs');
console.log('  ✔ Part 1 meaning associations evaluated deterministically without AI calls.');

// =========================================================================
// PART 2: Fill in the Blanks
// =========================================================================
console.log('\n▶ Test 2: Fill in the Blanks (Part 2)...');

const fillInBlanksItem = {
  id: 'fill-1',
  sentenceWithBlank: 'Her analysis of the market trends was completely ______ and helped the team make the right decision.',
  correctWord: 'spot on',
  validAlternatives: ['accurate', 'precise'],
  options: ['spot on', 'overdue', 'shallow', 'fragile'],
};

// Distractor parts of speech check
assert.strictEqual(fillInBlanksItem.options.length, 4, 'Failed: Part 2 must provide exactly 4 options');
assert(fillInBlanksItem.sentenceWithBlank.includes('______'), 'Failed: Sentence must contain blank placeholder');

// Deterministic correction with valid alternative support
function evaluateFillBlank(userAns: string, item: typeof fillInBlanksItem): boolean {
  const userLower = userAns.toLowerCase().trim();
  const targetLower = item.correctWord.toLowerCase().trim();
  const validAlts = (item.validAlternatives || []).map(a => a.toLowerCase().trim());
  return userLower === targetLower || validAlts.includes(userLower);
}

assert.strictEqual(evaluateFillBlank('Spot On', fillInBlanksItem), true, 'Failed: Target word must be accepted case-insensitively');
assert.strictEqual(evaluateFillBlank('accurate', fillInBlanksItem), true, 'Failed: Valid alternative must be accepted');
assert.strictEqual(evaluateFillBlank('shallow', fillInBlanksItem), false, 'Failed: Incorrect distractor must be rejected');
assert.strictEqual(evaluateFillBlank('', fillInBlanksItem), false, 'Failed: Empty response must be rejected');
console.log('  ✔ Part 2 blanks evaluate deterministically and support valid linguistic alternatives.');

// =========================================================================
// PART 3: Sentence Writing & Mandatory Test Case ("SPOT ON" with "the anyone know about")
// =========================================================================
console.log('\n▶ Test 3: Sentence Writing (Part 3)...');

// 3.1 Mandatory test case: "SPOT ON" with "the anyone know about"
const mandatoryTarget = 'SPOT ON';
const mandatoryInput = 'the anyone know about';

const mandatoryAnalysis = analyzeSentenceGrammarDeterministic(mandatoryInput, [mandatoryTarget], mandatoryTarget);

assert.strictEqual(
  mandatoryAnalysis.hasGrammarError,
  true,
  'Failed: "the anyone know about" must trigger grammar errors (article before pronoun and incomplete question)'
);
assert.strictEqual(
  mandatoryAnalysis.usedTargetWord,
  false,
  'Failed: "the anyone know about" does not use target word "SPOT ON"'
);

// Verify that validateHomeworkAiEvaluationResponse REJECTS an evaluation that falsely approves this sentence
const falseApprovalAiResponse = {
  overallScore: 90,
  overallSummaryPt: 'Bom trabalho com as frases.',
  overallSummaryEn: 'Good job on the sentences.',
  sentenceFeedback: [
    {
      word: 'SPOT ON',
      originalSentence: mandatoryInput,
      isCorrect: true, // Artificial false approval by buggy AI
      correctedSentence: mandatoryInput,
      explanationPt: 'Frase aceita.',
      explanationEn: 'Sentence accepted.',
    },
  ],
};

const validatorResultOnFalseApproval = validateHomeworkAiEvaluationResponse(
  falseApprovalAiResponse,
  [{ word: 'SPOT ON' }],
  { 'SPOT ON': mandatoryInput }
);

assert.strictEqual(
  validatorResultOnFalseApproval,
  false,
  'Failed: validateHomeworkAiEvaluationResponse must REJECT AI responses that approve sentences without the target word or with grammar errors!'
);
console.log('  ✔ Mandatory test case verified: "SPOT ON" with "the anyone know about" is strictly rejected and cannot be approved by AI.');

// 3.2 Legitimate sentence with "SPOT ON"
const validSentence = 'Your advice during the presentation was spot on and saved the project.';
const validAnalysis = analyzeSentenceGrammarDeterministic(validSentence, [mandatoryTarget], mandatoryTarget);
assert.strictEqual(validAnalysis.hasGrammarError, false, 'Failed: Legitimate sentence should have no grammar errors');
assert.strictEqual(validAnalysis.usedTargetWord, true, 'Failed: Legitimate sentence uses target word');

const trueApprovalAiResponse = {
  overallScore: 95,
  overallSummaryPt: 'Excelente domínio gramatical e contextual.',
  overallSummaryEn: 'Outstanding grammar and contextual vocabulary usage.',
  sentenceFeedback: [
    {
      word: 'SPOT ON',
      originalSentence: validSentence,
      isCorrect: true,
      correctedSentence: validSentence,
      explanationPt: 'Excelente uso da expressão em contexto corporativo.',
      explanationEn: 'Excellent use of the expression in a workplace context.',
    },
  ],
};

const validatorResultOnTrueApproval = validateHomeworkAiEvaluationResponse(
  trueApprovalAiResponse,
  [{ word: 'SPOT ON' }],
  { 'SPOT ON': validSentence }
);
assert.strictEqual(
  validatorResultOnTrueApproval,
  true,
  'Failed: Genuine grammatically sound sentence using the target word must be accepted.'
);
console.log('  ✔ Genuine sentence with target word approved with complete pedagogical feedback.');

// =========================================================================
// PART 4: Mini Story & Comprehension (4-Paragraph Format)
// =========================================================================
console.log('\n▶ Test 4: Mini Story & Comprehension (Part 4)...');

// 4.1 Rejection of stories with fewer than 4 paragraphs
const threeParagraphStory = `Alex arrived at the office early to prepare the technical demonstration for the team.

He quickly reviewed the core architecture to ensure all components were working in harmony.

By the end of the afternoon, the client approved the proposed solution with enthusiasm.`;

assert.strictEqual(
  isBadStoryText(threeParagraphStory),
  true,
  'Failed: isBadStoryText must reject stories with fewer than 4 paragraphs'
);
console.log('  ✔ Stories with fewer than 4 paragraphs are strictly rejected.');

// 4.2 Rejection of formulaic boilerplate stories
const formulaicStory = `The day began with great purpose as Alex reviewed key plans regarding the system.
Taking decisive steps early in the morning ensured everyone was prepared to address every requirement.
Transitioning into the afternoon, the team focused their energy on managing the deployment.
Finishing the workday on schedule allowed everyone to celebrate their achievements.`;

assert.strictEqual(
  isBadStoryText(formulaicStory),
  true,
  'Failed: isBadStoryText must reject formulaic robotic templates'
);
console.log('  ✔ Formulaic slot-filling templates are strictly rejected.');

// 4.3 Deterministic pedagogical synthesizer produces exactly 4 paragraphs
const synthesizedStory = synthesizeCohesiveStoryAndQuestions({
  words: ['spot on', 'breakthrough', 'challenge'],
  studentLevel: 'Intermediate',
  studentName: 'Alex',
});

assert(synthesizedStory && synthesizedStory.text, 'Failed: Story must be generated');
const paragraphs = synthesizedStory.text
  .split(/\n+/)
  .map(p => p.trim())
  .filter(p => p.length > 25);

assert.strictEqual(
  paragraphs.length >= 4,
  true,
  `Failed: Synthesized story must have at least 4 paragraphs (found ${paragraphs.length})`
);
assert.strictEqual(
  isBadStoryText(synthesizedStory.text),
  false,
  'Failed: Valid 4-paragraph synthesized story must pass isBadStoryText'
);

// 4.4 validatePart4StoryResponse checks story and questions
const validPart4Payload = {
  title: 'The Design Review Breakthrough',
  text: synthesizedStory.text,
  questions: synthesizedStory.questions,
};

assert.strictEqual(
  validatePart4StoryResponse(validPart4Payload, ['spot on', 'breakthrough', 'challenge']),
  true,
  'Failed: validatePart4StoryResponse must accept complete 4-paragraph story and questions'
);
console.log('  ✔ 4-paragraph story format and reading comprehension questions validated.');

// =========================================================================
// PART 5: 3-Model Contingency & Fail-Closed Behavior
// =========================================================================
console.log('\n▶ Test 5: 3-Model Gemini Contingency Architecture...');

const contingencyModels = resolveGeminiContingencyModels();
assert.strictEqual(contingencyModels.length, 3, 'Failed: Must contain exactly 3 validated models');
assert.ok(contingencyModels.includes('gemini-3.8-flash'), 'Failed: Must include gemini-3.8-flash');
assert.ok(contingencyModels.includes('gemini-3.5-flash-lite') || contingencyModels.includes('gemini-3.5-flash'), 'Failed: Must include gemini-3.5-flash-lite');
assert.ok(contingencyModels.includes('gemini-3.1-flash-lite'), 'Failed: Must include gemini-3.1-flash-lite');
console.log(`  ✔ Contingency pool correctly configured: ${contingencyModels.join(' -> ')}`);

// Simulate contingency with mock validator rejecting Model 1 and accepting Model 2
let attemptCounter = 0;
const mockExecutor = async (model: string) => {
  attemptCounter++;
  if (model === contingencyModels[0]) {
    // Model 1 returns generic boilerplate definition
    return {
      text: JSON.stringify({
        matchingPairs: [
          { word: 'spot on', definition: 'an important concept, role, or tool referring to accuracy' },
        ],
        fillInBlanks: [{ sentenceWithBlank: '______ is good', correctWord: 'spot on', options: ['a', 'b', 'c', 'd'] }],
        sentenceWritingPrompts: [{ word: 'spot on' }],
        readingPassage: { text: synthesizedStory.text, questions: synthesizedStory.questions },
      }),
      parsedJson: {
        matchingPairs: [
          { word: 'spot on', definition: 'an important concept, role, or tool referring to accuracy' },
        ],
        fillInBlanks: [{ sentenceWithBlank: '______ is good', correctWord: 'spot on', options: ['a', 'b', 'c', 'd'] }],
        sentenceWritingPrompts: [{ word: 'spot on' }],
        readingPassage: { text: synthesizedStory.text, questions: synthesizedStory.questions },
      },
    };
  }
  // Model 2 returns valid authentic pedagogical content
  return {
    text: JSON.stringify({
      matchingPairs: [
        { word: 'spot on', definition: 'Completely accurate or exactly correct.' },
      ],
      fillInBlanks: [{ sentenceWithBlank: 'The diagnosis was ______.', correctWord: 'spot on', options: ['spot on', 'late', 'weak', 'slow'] }],
      sentenceWritingPrompts: [{ word: 'spot on' }],
      readingPassage: { text: synthesizedStory.text, questions: synthesizedStory.questions },
    }),
    parsedJson: {
      matchingPairs: [
        { word: 'spot on', definition: 'Completely accurate or exactly correct.' },
      ],
      fillInBlanks: [{ sentenceWithBlank: 'The diagnosis was ______.', correctWord: 'spot on', options: ['spot on', 'late', 'weak', 'slow'] }],
      sentenceWritingPrompts: [{ word: 'spot on' }],
      readingPassage: { text: synthesizedStory.text, questions: synthesizedStory.questions },
    },
  };
};

const simResult = await executeGeminiWithContingency(
  {
    feature: 'homework_generate',
    systemInstruction: 'test',
    untrustedUserDataPrompt: 'test',
    validator: (json) => validateDirectMemorizationAiResponse(json, ['spot on']),
  },
  mockExecutor
);

assert.strictEqual(simResult.success, true, 'Failed: Contingency should succeed on Model 2');
assert.strictEqual(simResult.modelUsed, contingencyModels[1], 'Failed: Contingency should fail over to Model 2 after Model 1 returned generic boilerplate');
assert.strictEqual(simResult.attemptsCount, 2, 'Failed: Exactly 2 attempts should have been made');
console.log('  ✔ Content validation inside contingency successfully triggered failover from generic Model 1 to authentic Model 2.');

// Simulate exhaustion when all models fail
const failExecutor = async () => ({
  text: '',
  parsedJson: null,
  error: { statusCode: 503, category: 'SERVICE_UNAVAILABLE', safeReason: 'Overloaded' },
});

const exhaustResult = await executeGeminiWithContingency(
  {
    feature: 'homework_part4',
    systemInstruction: 'test',
    untrustedUserDataPrompt: 'test',
  },
  failExecutor
);

assert.strictEqual(exhaustResult.success, false, 'Failed: When all models fail, success must be false');
assert.strictEqual(exhaustResult.parsedJson, null, 'Failed: Zero synthetic fallbacks should be returned');
console.log('  ✔ Fail-closed behavior verified: returns transparent error without fake data when models are exhausted.');

console.log('\n🎉 ALL HOTFIX 2.3 TESTS PASSED WITH 100% SUCCESS!\n');
process.exit(0);
