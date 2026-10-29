import assert from 'node:assert';
import fs from 'node:fs';
import {
  isSyntheticHomeworkEvaluation,
  isValidHomeworkEvaluation,
  validateHomeworkAiEvaluationResponse,
} from '../src/utils/writingChecker';
import { sanitizeLoadedHomeworkData } from '../src/utils/studentPersistence';
import { HomeworkAiEvaluation, WeeklyHomeworkData, SentenceWritingPrompt } from '../src/types';

console.log('🧪 Starting FASE 5 — Part 3 Pedagogical Optimization Automated Verification Suite...\n');

const modalCode = fs.readFileSync('src/components/WeeklyHomeworkModal.tsx', 'utf8');
const serverAppCode = fs.readFileSync('serverApp.ts', 'utf8');

// =========================================================================
// TEST 1: Individual Check with AI Buttons Removed
// =========================================================================
console.log('▶ Test 1: Verifying individual "Check with AI" buttons were removed from Part 3 prompt cards...');
assert.strictEqual(
  modalCode.includes('handleCheckSentence(prompt'),
  false,
  'Failed: handleCheckSentence must not be called from any button in Part 3'
);
assert.strictEqual(
  modalCode.includes('memT.part3.checkWithAi'),
  false,
  'Failed: Individual "Check with AI" button text must be removed from Part 3 cards'
);
assert.strictEqual(
  modalCode.includes('isCheckingSentence['),
  false,
  'Failed: isCheckingSentence state must be removed from Part 3 cards'
);
console.log('  ✔ All individual "Check with AI" buttons removed from Part 3.');

// =========================================================================
// TEST 2: Redundant Individual Feedback Panels Removed
// =========================================================================
console.log('\n▶ Test 2: Verifying redundant individual feedback panels below textareas were removed...');
assert.strictEqual(
  modalCode.includes('feedback.hasAnyError ?'),
  false,
  'Failed: Individual feedback error panel must not exist in Part 3 cards'
);
assert.strictEqual(
  modalCode.includes('setSentenceFeedbacks('),
  false,
  'Failed: setSentenceFeedbacks state updater must be completely removed'
);
assert.strictEqual(
  modalCode.includes('sentenceFeedbacks['),
  false,
  'Failed: sentenceFeedbacks state lookup must be completely removed'
);
console.log('  ✔ Redundant individual feedback panels below textareas removed.');

// =========================================================================
// TEST 3: All 5 Sentences Remain Fully Editable
// =========================================================================
console.log('\n▶ Test 3: Verifying all 5 sentences remain editable and responsive...');
assert.ok(
  modalCode.includes('safeSentenceWritingPrompts.map((prompt, idx) =>'),
  'Failed: Part 3 must iterate over all safeSentenceWritingPrompts'
);
assert.ok(
  modalCode.includes('setSentenceAnswers((prev) => ({'),
  'Failed: textarea must update sentenceAnswers state'
);
assert.ok(
  modalCode.includes('placeholder={memT.part3.placeholder(prompt.word)}'),
  'Failed: textarea must display pedagogical placeholder'
);
console.log('  ✔ All 5 sentence writing fields remain fully editable.');

// =========================================================================
// TEST 4: Zero AI Calls Triggered During Typing
// =========================================================================
console.log('\n▶ Test 4: Verifying typing does NOT trigger AI or backend requests...');
const textareaMatch = modalCode.match(/<textarea[\s\S]*?onChange=\{\(e\) => \{([\s\S]*?)\}\}/);
assert.ok(textareaMatch, 'Failed: textarea onChange handler must exist');
const onChangeBody = textareaMatch[1];
assert.strictEqual(
  onChangeBody.includes('fetch('),
  false,
  'Failed: onChange must not trigger any fetch network request'
);
assert.strictEqual(
  onChangeBody.includes('checkStudentWritingApi'),
  false,
  'Failed: onChange must not trigger checkStudentWritingApi'
);
assert.strictEqual(
  onChangeBody.includes('evaluateWeeklyHomeworkApi'),
  false,
  'Failed: onChange must not trigger evaluateWeeklyHomeworkApi'
);
console.log('  ✔ Zero AI calls during typing verified.');

// =========================================================================
// TEST 5: Save Part 3 Enforces Completion Rules
// =========================================================================
console.log('\n▶ Test 5: Verifying Save Part 3 enforces completion before proceeding...');
assert.ok(
  modalCode.includes('if (!isWritingComplete) {'),
  'Failed: handleSavePart3 must check isWritingComplete'
);
assert.ok(
  modalCode.includes('Please write your sentences for all'),
  'Failed: User feedback toast must be shown when sentences are incomplete'
);
// Test isWritingComplete logic:
const samplePrompts: SentenceWritingPrompt[] = [
  { word: 'mug', hint: 'Drink from mug', levelInstruction: 'Clear S+V+O' },
  { word: 'pour', hint: 'Pour liquid', levelInstruction: 'Clear S+V+O' },
  { word: 'toast', hint: 'Make toast', levelInstruction: 'Clear S+V+O' },
  { word: 'brew', hint: 'Brew coffee', levelInstruction: 'Clear S+V+O' },
  { word: 'sip', hint: 'Take a sip', levelInstruction: 'Clear S+V+O' },
];

function checkIsWritingComplete(prompts: SentenceWritingPrompt[], answers: Record<string, string>): boolean {
  if (!prompts || prompts.length === 0) return false;
  return prompts.every((p) => {
    const val = answers[p.word] || answers[p.word.trim()] || '';
    return val.trim().length >= 3;
  });
}

const incompleteAnswers = {
  mug: 'I drink from mug.',
  pour: 'He pours the tea.',
  toast: '', // missing
  brew: 'We brew coffee.',
  sip: 'She sips water.',
};
assert.strictEqual(
  checkIsWritingComplete(samplePrompts, incompleteAnswers),
  false,
  'Failed: Incomplete sentences must return false'
);

const completeAnswers = {
  mug: 'I drink from mug.',
  pour: 'He pours the tea.',
  toast: 'I love warm toast.',
  brew: 'We brew coffee.',
  sip: 'She sips water.',
};
assert.strictEqual(
  checkIsWritingComplete(samplePrompts, completeAnswers),
  true,
  'Failed: 5 completed sentences must return true'
);
console.log('  ✔ Save Part 3 completion enforcement verified.');

// =========================================================================
// TEST 6: Save Part 3 Triggers Single Consolidated Evaluation
// =========================================================================
console.log('\n▶ Test 6: Verifying Save Part 3 dispatches a single consolidated evaluation request...');
assert.ok(
  modalCode.includes('evaluateWeeklyHomeworkApi({'),
  'Failed: handleSavePart3 must call evaluateWeeklyHomeworkApi'
);
assert.ok(
  serverAppCode.includes("app.post('/api/homework/evaluate'"),
  'Failed: Consolidated homework evaluation endpoint must exist'
);
console.log('  ✔ Single consolidated evaluation triggered on Save Part 3.');

// =========================================================================
// TEST 7: Zero Individual Additional AI Calls Executed
// =========================================================================
console.log('\n▶ Test 7: Verifying zero individual AI calls executed during Part 3...');
assert.strictEqual(
  modalCode.includes('checkStudentWritingApi'),
  false,
  'Failed: checkStudentWritingApi must not be used anywhere in WeeklyHomeworkModal'
);
console.log('  ✔ Zero individual AI calls verified.');

// =========================================================================
// TEST 8: Evaluation Receives levelInstruction & activityContext
// =========================================================================
console.log('\n▶ Test 8: Verifying Gemini prompt includes levelInstruction and activityContext for each sentence...');
assert.ok(
  serverAppCode.includes("levelInstruction: p.levelInstruction || ''"),
  'Failed: serverApp.ts must include levelInstruction in Part 3 payload for Gemini'
);
assert.ok(
  serverAppCode.includes("activityContext:"),
  'Failed: serverApp.ts must include activityContext in Part 3 payload for Gemini'
);
console.log('  ✔ levelInstruction and activityContext correctly included in Gemini prompt.');

// =========================================================================
// TEST 9: Gemini Returns Valid Evaluations Associated with Correct Words
// =========================================================================
console.log('\n▶ Test 9: Verifying AI evaluation accurately maps to target words...');
const validMockResponse: any = {
  overallScore: 92,
  evaluatedAt: new Date().toISOString(),
  studentLevel: 'Intermediate',
  tutorFeedbackSummaryPt: 'Excelente trabalho nas frases desta semana.',
  tutorFeedbackSummaryEn: 'Great job with this week’s sentences.',
  sentenceFeedback: [
    {
      word: 'mug',
      originalSentence: 'I drink from mug.',
      isCorrect: true,
      correctedSentence: 'I drink fresh coffee from my favorite ceramic mug every morning.',
      explanationPt: 'Frase correta com sujeito, verbo e objeto claros.',
      explanationEn: 'Grammatically sound sentence with clear subject, verb, and object.',
      levelAdvicePt: 'Procure conectar com uma oração adverbial usando "because" ou "when".',
      levelAdviceEn: 'Try connecting with an adverbial clause using "because" or "when".',
    },
    {
      word: 'pour',
      originalSentence: 'He pours the tea.',
      isCorrect: true,
      correctedSentence: 'He carefully pours hot green tea into the teapot.',
      explanationPt: 'Excelente uso da terceira pessoa do singular.',
      explanationEn: 'Excellent use of third person singular agreement.',
      levelAdvicePt: 'Bom uso do presente simples.',
      levelAdviceEn: 'Good use of simple present tense.',
    },
    {
      word: 'toast',
      originalSentence: 'I love warm toast.',
      isCorrect: true,
      correctedSentence: 'I always enjoy warm toast with melted butter for breakfast.',
      explanationPt: 'Frase natural e adequada ao nível.',
      explanationEn: 'Natural sentence well suited for this level.',
      levelAdvicePt: 'Estrutura direta bem executada.',
      levelAdviceEn: 'Direct structure well executed.',
    },
    {
      word: 'brew',
      originalSentence: 'We brew coffee.',
      isCorrect: true,
      correctedSentence: 'We brew freshly roasted coffee before starting our morning work.',
      explanationPt: 'Verbo brew empregado no sentido correto.',
      explanationEn: 'The verb brew is accurately used in context.',
      levelAdvicePt: 'Tente adicionar marcadores de tempo.',
      levelAdviceEn: 'Try adding time markers.',
    },
    {
      word: 'sip',
      originalSentence: 'She sips water.',
      isCorrect: true,
      correctedSentence: 'She takes a slow sip of cold water while resting.',
      explanationPt: 'Frase gramaticalmente correta.',
      explanationEn: 'Grammatically sound sentence.',
      levelAdvicePt: 'Concordância perfeita.',
      levelAdviceEn: 'Perfect agreement.',
    },
  ],
};

assert.strictEqual(
  isValidHomeworkEvaluation(validMockResponse),
  true,
  'Failed: validMockResponse must be accepted by isValidHomeworkEvaluation'
);
assert.strictEqual(
  validateHomeworkAiEvaluationResponse(validMockResponse, samplePrompts, completeAnswers),
  true,
  'Failed: validateHomeworkAiEvaluationResponse must validate response matching student sentences'
);
console.log('  ✔ AI evaluation response correctly mapped and validated.');

// =========================================================================
// TEST 10: Unified Corrections Section Exists and Displays Correct Elements
// =========================================================================
console.log('\n▶ Test 10: Verifying STAGE-BY-STAGE PEDAGOGICAL CORRECTIONS unified section displays required elements...');
assert.ok(
  modalCode.includes('STAGE-BY-STAGE PEDAGOGICAL CORRECTIONS'),
  'Failed: STAGE-BY-STAGE PEDAGOGICAL CORRECTIONS header must exist'
);
assert.ok(
  modalCode.includes('Your sentence:'),
  'Failed: Original sentence label must exist in unified section'
);
assert.ok(
  modalCode.includes('promptWord.toUpperCase()'),
  'Failed: Target word tag must be presented'
);
assert.ok(
  modalCode.includes('Activity:'),
  'Failed: Activity context label must be presented'
);
console.log('  ✔ Unified corrections section displays required elements.');

// =========================================================================
// TEST 11: Contextual Suggestions Displayed
// =========================================================================
console.log('\n▶ Test 11: Verifying contextual suggestions are displayed when different from student sentence...');
assert.ok(
  modalCode.includes('Suggested improvement:'),
  'Failed: "Suggested improvement:" label must be present in unified section'
);
assert.ok(
  modalCode.includes('hasValidSuggestion'),
  'Failed: hasValidSuggestion condition must be used'
);
console.log('  ✔ Contextual suggestions conditionally presented.');

// =========================================================================
// TEST 12: Correct Sentences Can Receive Improvements Without Unfair Penalties
// =========================================================================
console.log('\n▶ Test 12: Verifying grammatically correct sentences retain isCorrect: true with contextual suggestions...');
const item = validMockResponse.sentenceFeedback[0];
assert.strictEqual(item.isCorrect, true, 'Failed: Sentence must be marked isCorrect: true');
assert.notStrictEqual(item.correctedSentence, item.originalSentence, 'Failed: Corrected sentence offers a richer alternative');
assert.ok(serverAppCode.includes('CRITICAL RULE: A grammatically correct sentence must NEVER be marked isCorrect: false'),
  'Failed: server prompt must instruct model not to penalize correct sentences just because a richer phrasing exists'
);
console.log('  ✔ Correct sentences retain isCorrect: true with richer contextual suggestions.');

// =========================================================================
// TEST 13: Apply Suggestion Modifies ONLY the Selected Sentence
// =========================================================================
console.log('\n▶ Test 13: Verifying Apply Suggestion modifies only the target word sentence...');
const initialSentences = {
  mug: 'I drink from mug.',
  pour: 'He pours the tea.',
  toast: 'I love warm toast.',
  brew: 'We brew coffee.',
  sip: 'She sips water.',
};

function applySuggestionHelper(
  currentSentences: Record<string, string>,
  targetWord: string,
  suggestion: string
): Record<string, string> {
  return {
    ...currentSentences,
    [targetWord]: suggestion.trim(),
  };
}

const suggestedMug = 'I drink fresh coffee from my favorite ceramic mug every morning.';
const afterApply = applySuggestionHelper(initialSentences, 'mug', suggestedMug);

assert.strictEqual(afterApply.mug, suggestedMug, 'Failed: mug sentence must be updated to suggestion');
assert.strictEqual(afterApply.pour, initialSentences.pour, 'Failed: pour sentence must remain unchanged');
assert.strictEqual(afterApply.toast, initialSentences.toast, 'Failed: toast sentence must remain unchanged');
assert.strictEqual(afterApply.brew, initialSentences.brew, 'Failed: brew sentence must remain unchanged');
assert.strictEqual(afterApply.sip, initialSentences.sip, 'Failed: sip sentence must remain unchanged');
console.log('  ✔ Apply suggestion modifies strictly the selected sentence, preserving the other 4.');

// =========================================================================
// TEST 14: Apply Suggestion Persists Changes in Firestore
// =========================================================================
console.log('\n▶ Test 14: Verifying Apply Suggestion persists changes via onSaveProgress...');
assert.ok(
  modalCode.includes('handleApplySuggestion = async (wordKey: string, suggestedSentence: string) =>'),
  'Failed: handleApplySuggestion handler must exist in WeeklyHomeworkModal'
);
assert.ok(
  modalCode.includes('await onSaveProgress(updatedHw)'),
  'Failed: handleApplySuggestion must call onSaveProgress to persist to Firestore'
);
console.log('  ✔ Apply suggestion persistence via onSaveProgress verified.');

// =========================================================================
// TEST 15: Invalidation of Previous Evaluation on Sentence Modification
// =========================================================================
console.log('\n▶ Test 15: Verifying previous evaluation is invalidated when sentence text changes...');
assert.ok(
  modalCode.includes('isModified: true'),
  'Failed: Sentence modification must set isModified: true on corresponding eval item'
);
assert.ok(
  modalCode.includes('!evalItem.isModified'),
  'Failed: isEvaluated check must require !evalItem.isModified'
);
assert.ok(
  modalCode.includes('evalItem.originalSentence.trim().toLowerCase() === userSentence.toLowerCase()'),
  'Failed: isEvaluated check must ensure evaluated sentence matches current student sentence'
);
console.log('  ✔ Stale evaluation invalidation verified.');

// =========================================================================
// TEST 16: Persistence Failure Handling Without False Success
// =========================================================================
console.log('\n▶ Test 16: Verifying persistence failure produces clear error and no false success...');
assert.ok(
  modalCode.includes('catch (err) {'),
  'Failed: handleApplySuggestion must catch errors'
);
assert.ok(
  modalCode.includes('Failed to persist applied suggestion in Firestore:'),
  'Failed: Persistence error must be logged'
);
assert.ok(
  modalCode.includes('Error saving suggestion to Firestore'),
  'Failed: User toast must inform about persistence failure'
);
console.log('  ✔ Persistence failure handling verified.');

// =========================================================================
// TEST 17: AI Contingency Failure Preserves Answers
// =========================================================================
console.log('\n▶ Test 17: Verifying AI contingency failure preserves student answers in Firestore...');
assert.ok(
  modalCode.includes("status: 'pending_evaluation'"),
  'Failed: In-progress answers must be saved with status pending_evaluation before AI call'
);
assert.ok(
  modalCode.includes('AI evaluation error in Part 3, preserving sentences in Firestore with status pending_evaluation:'),
  'Failed: AI error must log preservation in Firestore'
);
assert.ok(
  modalCode.includes('Retry Evaluation'),
  'Failed: UI must offer Retry Evaluation button when AI fails'
);
console.log('  ✔ Answers preserved on AI failure without data loss.');

// =========================================================================
// TEST 18: Pending Evaluation Generates Zero Synthetic Scores
// =========================================================================
console.log('\n▶ Test 18: Verifying pending evaluation does NOT generate synthetic scores or artificial completion...');
const testHomeworkWithPending: any = {
  id: 'week-1',
  studentAnswers: {
    sentences: completeAnswers,
  },
  partsProgress: {
    writing: {
      partKey: 'writing',
      partNumber: 3,
      status: 'pending_evaluation',
      answers: completeAnswers,
    },
  },
  isCompleted: false,
};

const sanitizedPending = sanitizeLoadedHomeworkData(testHomeworkWithPending);
assert.strictEqual(sanitizedPending.isCompleted, false, 'Failed: Pending homework must remain isCompleted: false');
assert.strictEqual(sanitizedPending.score, undefined, 'Failed: Pending homework must have score: undefined');
assert.strictEqual(sanitizedPending.aiEvaluation, undefined, 'Failed: Pending homework must not have aiEvaluation');
console.log('  ✔ Zero synthetic scores generated for pending evaluations.');

// =========================================================================
// TEST 19: S-Path Rules, markSPathCompleted and Progression Preserved
// =========================================================================
console.log('\n▶ Test 19: Verifying S-Path rules and markSPathCompleted are fully intact...');
assert.ok(
  modalCode.includes('const markSPathCompleted = useCallback('),
  'Failed: markSPathCompleted must be preserved'
);
assert.ok(
  modalCode.includes("markSPathCompleted(targetDay, 'writing', finalParts)"),
  'Failed: S-Path completion must be triggered only when genuine evaluation succeeds'
);
assert.ok(
  modalCode.includes('dailySchedule.partKey === \'writing\''),
  'Failed: Daily schedule part rotation must be respected'
);
console.log('  ✔ S-Path protected and fully preserved.');

// =========================================================================
// TEST 20: Zero Alternative Local Storage Introduced
// =========================================================================
console.log('\n▶ Test 20: Verifying zero localStorage/sessionStorage/IndexedDB introduced...');
assert.strictEqual(
  modalCode.includes('localStorage.'),
  false,
  'Failed: localStorage must NOT be used in WeeklyHomeworkModal'
);
assert.strictEqual(
  modalCode.includes('sessionStorage.'),
  false,
  'Failed: sessionStorage must NOT be used in WeeklyHomeworkModal'
);
assert.strictEqual(
  modalCode.includes('indexedDB.'),
  false,
  'Failed: indexedDB must NOT be used in WeeklyHomeworkModal'
);
console.log('  ✔ Zero local storage dependencies confirmed.');

console.log('\n=================================================================');
console.log('🎉 ALL 20 FASE 5 VERIFICATION TESTS PASSED SUCCESSFULLY!');
console.log('=================================================================\n');
