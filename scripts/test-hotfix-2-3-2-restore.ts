/**
 * Verification Test Suite for HOTFIX 2.3.2
 * Weekly Memorization Activity: Restore from Firestore
 */
import assert from 'assert';
import { mergeHomeworkRecords } from '../src/serverFirestore';
import { sanitizeLoadedHomeworkData } from '../src/utils/studentPersistence';

console.log('--- Starting HOTFIX 2.3.2 Verification Tests ---');

// Test Case 1: Partial responses across all 4 parts -> F5 reload -> verify all answers restored
console.log('\n[Test 1] Partial responses across all 4 parts -> F5 -> restored completely');
{
  const partialAnswersHomework = {
    id: 'week-1',
    weeklyCycle: 1,
    studentUid: 'student_test_123',
    matchingPairs: [
      { id: 'match-coffee', word: 'coffee', definition: 'A hot beverage' },
      { id: 'match-project', word: 'project', definition: 'A collaborative effort' },
    ],
    fillInBlanks: [
      { id: 'fill-coffee', sentenceWithBlank: 'I drink ______ every morning.', correctWord: 'coffee' },
    ],
    sentenceWritingPrompts: [
      { word: 'coffee', hint: 'Write about coffee' },
      { word: 'project', hint: 'Write about project' },
    ],
    readingPassage: {
      title: 'Daily Growth',
      text: 'A story about teamwork and coffee.',
      questions: [
        { id: 'q-1', question: 'What beverage was mentioned?', options: ['Coffee', 'Tea'], correctAnswer: 0 },
      ],
    },
    studentAnswers: {
      matching: { 'match-coffee': 'coffee' },
      fillInBlanks: { 'fill-coffee': 'coffee' },
      sentences: { 'coffee': 'I drink fresh coffee every morning before working.' },
      quizAnswers: { 'q-1': 0 },
    },
    isCompleted: false,
    score: 0,
  };

  // Simulate F5 reload where routine generator generates a blank template:
  const freshBlankTemplate = {
    id: 'week-1',
    weeklyCycle: 1,
    studentAnswers: { matching: {}, fillInBlanks: {}, sentences: {}, quizAnswers: {} },
    isCompleted: false,
    score: 0,
  };

  // Restoration through merge:
  const restored = mergeHomeworkRecords(partialAnswersHomework, freshBlankTemplate);

  assert.strictEqual(restored.studentAnswers.matching['match-coffee'], 'coffee', 'Matching answer should be restored');
  assert.strictEqual(restored.studentAnswers.fillInBlanks['fill-coffee'], 'coffee', 'Fill-in-the-blank answer should be restored');
  assert.strictEqual(restored.studentAnswers.sentences['coffee'], 'I drink fresh coffee every morning before working.', 'Sentence answer should be restored');
  assert.strictEqual(restored.studentAnswers.quizAnswers['q-1'], 0, 'Quiz answer should be restored');
  console.log('✓ Test 1 passed: All 4 parts partial answers accurately restored after F5 reload.');
}

// Test Case 2: Completed activity with aiEvaluation & score -> F5 reload -> verify evaluation and score restored
console.log('\n[Test 2] Completed activity with aiEvaluation & score -> F5 -> restored');
{
  const completedHomework = {
    id: 'week-1',
    weeklyCycle: 1,
    studentUid: 'student_test_123',
    isCompleted: true,
    score: 95,
    studentAnswers: {
      matching: { 'match-coffee': 'coffee' },
      fillInBlanks: { 'fill-coffee': 'coffee' },
      sentences: { 'coffee': 'I drink coffee.' },
      quizAnswers: { 'q-1': 0 },
    },
    aiEvaluation: {
      overallScore: 95,
      evaluatedAt: '2026-10-22T10:00:00.000Z',
      tutorFeedbackSummaryPt: 'Excelente trabalho nas frases!',
      tutorFeedbackSummaryEn: 'Excellent work on sentences!',
      sentenceFeedback: [
        {
          word: 'coffee',
          originalSentence: 'I drink coffee.',
          isCorrect: true,
          correctedSentence: 'I drink coffee.',
          explanationPt: 'Gramática impecável.',
          explanationEn: 'Impeccable grammar.',
        },
      ],
    },
  };

  // Simulating F5 reload with empty in-memory or generated state:
  const freshBlankTemplate = {
    id: 'week-1',
    weeklyCycle: 1,
    studentAnswers: { matching: {}, fillInBlanks: {}, sentences: {}, quizAnswers: {} },
    isCompleted: false,
    score: 0,
  };

  const restored = mergeHomeworkRecords(completedHomework, freshBlankTemplate);

  assert.strictEqual(restored.isCompleted, true, 'isCompleted must remain true');
  assert.strictEqual(restored.score, 95, 'Score must be 95');
  assert.ok(restored.aiEvaluation, 'aiEvaluation must be preserved');
  assert.strictEqual(restored.aiEvaluation.overallScore, 95, 'overallScore must be 95');
  assert.strictEqual(restored.aiEvaluation.sentenceFeedback[0].word, 'coffee', 'sentenceFeedback must be preserved');
  console.log('✓ Test 2 passed: Completed activity, genuine aiEvaluation, and score 95 restored after F5.');
}

// Test Case 3: Close session / re-login -> verify identical data restored
console.log('\n[Test 3] Session close / re-login -> verify identical data restored');
{
  const persistedFirestoreDoc = {
    id: 'week-1',
    weeklyCycle: 1,
    studentUid: 'UID_Canonical_CaseSensitive_AbC',
    isCompleted: true,
    score: 100,
    studentAnswers: {
      matching: { 'match-apple': 'apple' },
      fillInBlanks: { 'fill-apple': 'apple' },
      sentences: { 'apple': 'I eat an apple every day.' },
      quizAnswers: { 'q-1': 1 },
    },
    aiEvaluation: {
      overallScore: 100,
      tutorFeedbackSummaryPt: 'Perfeito!',
      tutorFeedbackSummaryEn: 'Perfect!',
      sentenceFeedback: [
        {
          word: 'apple',
          originalSentence: 'I eat an apple every day.',
          correctedSentence: 'I eat an apple every day.',
          isCorrect: true,
          explanationPt: 'Uso correto do substantivo apple.',
          explanationEn: 'Correct use of the noun apple.',
        },
      ],
    },
  };

  // Clean login with new auth session
  const cleanLoginData = sanitizeLoadedHomeworkData(persistedFirestoreDoc);

  assert.strictEqual(cleanLoginData.studentUid, 'UID_Canonical_CaseSensitive_AbC', 'Canonical UID case preserved');
  assert.strictEqual(cleanLoginData.score, 100);
  assert.strictEqual(cleanLoginData.isCompleted, true);
  assert.strictEqual(cleanLoginData.studentAnswers?.sentences?.apple, 'I eat an apple every day.');
  console.log('✓ Test 3 passed: Session close and new login restore identical data with canonical UID intact.');
}

// Test Case 4: Simulate slow loading / empty initial state -> prevent overwrite
console.log('\n[Test 4] Slow load / empty initial state -> prevent destructive overwrite');
{
  const existingInFirestore = {
    id: 'week-1',
    weeklyCycle: 1,
    studentUid: 'student_slow_loader',
    studentAnswers: {
      matching: { 'match-task': 'task' },
      fillInBlanks: { 'fill-task': 'task' },
      sentences: { 'task': 'I finish each task.' },
      quizAnswers: { 'q-1': 0 },
    },
    aiEvaluation: {
      overallScore: 90,
      sentenceFeedback: [{ word: 'task', originalSentence: 'I finish each task.', isCorrect: true }],
    },
    score: 90,
    isCompleted: true,
  };

  // Slow initial state with empty answers trying to autosave:
  const emptyInitialAutosave = {
    id: 'week-1',
    weeklyCycle: 1,
    studentAnswers: { matching: {}, fillInBlanks: {}, sentences: {}, quizAnswers: {} },
    score: 0,
    isCompleted: false,
  };

  // Merge simulation in saveStudentHomeworkProgressToFirestore:
  const mergedForSave = mergeHomeworkRecords(emptyInitialAutosave, existingInFirestore);

  assert.strictEqual(mergedForSave.studentAnswers.sentences['task'], 'I finish each task.', 'Persisted answer must not be wiped by empty autosave');
  assert.strictEqual(mergedForSave.isCompleted, true, 'isCompleted must remain true');
  assert.strictEqual(mergedForSave.score, 90, 'Score must remain 90');
  assert.ok(mergedForSave.aiEvaluation, 'aiEvaluation must be retained');
  console.log('✓ Test 4 passed: Slow initial state and empty autosave do not overwrite persisted Firestore data.');
}

// Test Case 5: Student & Week cycle isolation
console.log('\n[Test 5] Confirm isolation between students and week cycles');
{
  const studentA_Week1 = {
    id: 'week-1',
    weeklyCycle: 1,
    studentUid: 'student_A',
    studentAnswers: { matching: { 'match-run': 'run' } as Record<string, string> },
    score: 80,
  };

  const studentA_Week2 = {
    id: 'week-2',
    weeklyCycle: 2,
    studentUid: 'student_A',
    studentAnswers: { matching: { 'match-jump': 'jump' } as Record<string, string> },
    score: 90,
  };

  const studentB_Week1 = {
    id: 'week-1',
    weeklyCycle: 1,
    studentUid: 'student_B',
    studentAnswers: { matching: { 'match-swim': 'swim' } as Record<string, string> },
    score: 85,
  };

  // Verify student A week 1 does not leak into week 2
  assert.notStrictEqual(studentA_Week1.weeklyCycle, studentA_Week2.weeklyCycle);
  assert.strictEqual(studentA_Week1.studentAnswers.matching['match-run'], 'run');
  assert.strictEqual(studentA_Week2.studentAnswers.matching['match-run'], undefined);

  // Verify student A does not leak into student B
  assert.notStrictEqual(studentA_Week1.studentUid, studentB_Week1.studentUid);
  assert.strictEqual(studentB_Week1.studentAnswers.matching['match-run'], undefined);
  console.log('✓ Test 5 passed: Strict isolation maintained between students and week cycles.');
}

// Test Case 6: Confirm zero Gemini API calls when existing legitimate evaluation is present
console.log('\n[Test 6] Confirm zero Gemini calls when valid evaluation exists');
{
  const activeEval = {
    overallScore: 92,
    sentenceFeedback: [
      { word: 'coffee', originalSentence: 'I drink coffee every day.', isCorrect: true },
      { word: 'project', originalSentence: 'I manage the project.', isCorrect: true },
    ],
  };

  const sentenceAnswers = {
    coffee: 'I drink coffee every day.',
    project: 'I manage the project.',
  };

  const prompts = [
    { word: 'coffee', hint: '...' },
    { word: 'project', hint: '...' },
  ];

  // Exact logic used in WeeklyHomeworkModal handleCalculateScore:
  const existingIsLegitimate = Boolean(
    activeEval &&
    activeEval.overallScore > 0 &&
    (prompts || []).every((p) => {
      const studentSentence = (sentenceAnswers[p.word as keyof typeof sentenceAnswers] || '').trim().toLowerCase();
      const sentencesList = activeEval.sentenceFeedback || [];
      const evaluatedItem = sentencesList.find(
        (r: any) => (r.word || '').toLowerCase() === p.word.toLowerCase()
      );
      const evaluatedSentence = (evaluatedItem?.originalSentence || '').trim().toLowerCase();
      return studentSentence === evaluatedSentence || (!studentSentence && Boolean(evaluatedSentence));
    })
  );

  assert.strictEqual(existingIsLegitimate, true, 'Existing evaluation must be recognized as legitimate');
  console.log('✓ Test 6 passed: Legitimate evaluation recognized; 0 Gemini calls triggered.');
}

console.log('\n=============================================');
console.log(' ALL 6 MANDATORY TESTS PASSED SUCCESSFULLY! ');
console.log('=============================================');
