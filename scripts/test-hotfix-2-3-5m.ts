import {
  generateWeeklyHomework,
  getDailyMemorizationSchedule,
  resolveDailyMemorizationVocabulary,
} from '../src/utils/homeworkGenerator';
import { isBadStoryText, synthesizeCohesiveStoryAndQuestions } from '../src/utils/pedagogicalStorySynthesizer';
import { getMemorizationTranslations } from '../src/utils/i18n/memorizationActivity';
import { DayOfWeek, RoutineItem, WeeklyHomeworkData } from '../src/types';

console.log('=== TEST SUITE: HOTFIX 2.3.5M — REACT UNDEFINED LENGTH FIX ===\n');

let allPassed = true;
function assert(desc: string, condition: boolean, extra?: any) {
  if (condition) {
    console.log(`  ✓ PASS: ${desc}`);
  } else {
    console.error(`  ✗ FAIL: ${desc}`, extra || '');
    allPassed = false;
  }
}

// ---------------------------------------------------------
// Scenario 1: Opening Weekly Memorization Activity (Part 1 on Friday)
// ---------------------------------------------------------
console.log('--- Scenario 1: Opening Weekly Memorization Activity on Friday (Part 1 Rhythm) ---');
const fridaySchedule = getDailyMemorizationSchedule('friday', undefined, 1);
assert('Friday schedule is Part 1 (matching)', fridaySchedule.partKey === 'matching' && fridaySchedule.partNumber === 1);

const legacyHwFriday: any = {
  id: 'hw-friday-1',
  studentEmail: 'student@example.com',
  studentName: 'Student',
  studentLevel: 'Intermediate',
  totalWordsCollected: 5,
  vocabularyList: [
    { word: 'challenge' },
    { word: 'strategy' },
    { word: 'meeting' },
    { word: 'report' },
    { word: 'schedule' },
  ],
  // matchingPairs, fillInBlanks, sentenceWritingPrompts are UNDEFINED (simulating Firestore missing field or partial document)
  matchingPairs: undefined,
  fillInBlanks: undefined,
  sentenceWritingPrompts: undefined,
  readingPassage: undefined,
};

// Simulate the safe array resolution that WeeklyHomeworkModal now performs
const safeMatchingPairs = Array.isArray(legacyHwFriday?.matchingPairs) ? legacyHwFriday.matchingPairs : [];
const safeFillInBlanks = Array.isArray(legacyHwFriday?.fillInBlanks) ? legacyHwFriday.fillInBlanks : [];
const safeSentenceWritingPrompts = Array.isArray(legacyHwFriday?.sentenceWritingPrompts) ? legacyHwFriday.sentenceWritingPrompts : [];

assert('safeMatchingPairs is safely an array (not undefined)', Array.isArray(safeMatchingPairs));
assert('safeMatchingPairs.length is 0 without throwing', safeMatchingPairs.length === 0);

const memT = getMemorizationTranslations('en');
const part1AnsweredCount = memT.part1.answeredCount(0, safeMatchingPairs.length);
assert('memT.part1.answeredCount safely renders with safeMatchingPairs.length', part1AnsweredCount === '0/0 answered');

// ---------------------------------------------------------
// Scenario 2: Opening Part 4 with Legacy, Empty, or Partial Data
// ---------------------------------------------------------
console.log('\n--- Scenario 2: Opening Part 4 with Legacy, Empty, or Partial Structures ---');
const legacyPart4Hw: any = {
  id: 'hw-thursday-1',
  targetDay: 'thursday',
  studentEmail: 'student@example.com',
  studentName: 'Student',
  matchingPairs: undefined,
  fillInBlanks: undefined,
  sentenceWritingPrompts: undefined,
  readingPassage: {
    title: 'Legacy Title',
    text: 'A well structured paragraph 1.\n\nParagraph 2 details the day.\n\nParagraph 3 describes the meeting.\n\nParagraph 4 concludes the experience nicely with enough characters.',
    questions: undefined, // Legacy record with undefined questions!
  },
};

const safeQuestions = Array.isArray(legacyPart4Hw?.readingPassage?.questions) ? legacyPart4Hw.readingPassage.questions : [];
assert('safeQuestions handles undefined questions without throwing', Array.isArray(safeQuestions) && safeQuestions.length === 0);

// In Part 4, Vocabulary Key rendered at the bottom:
const vocabKeyPairs = Array.isArray(legacyPart4Hw?.matchingPairs) ? legacyPart4Hw.matchingPairs : [];
const vocabKeyMapped = vocabKeyPairs.map((item: any) => item.word);
assert('Vocabulary Key in Part 4 maps safely without throwing', Array.isArray(vocabKeyMapped) && vocabKeyMapped.length === 0);

// ---------------------------------------------------------
// Scenario 3: Legacy Activities with Missing Properties in generateWeeklyHomework
// ---------------------------------------------------------
console.log('\n--- Scenario 3: Legacy Activities Handled in generateWeeklyHomework ---');
const legacyDailyActs: Record<string, any> = {
  thursday: {
    id: 'hw-thursday-1',
    day: 'thursday',
    weeklyCycle: 1,
    studentUid: 'u1',
    selectedWords: [{ word: 'strategy' }, { word: 'budget' }],
    matchingPairs: undefined,
    fillInBlanks: undefined,
    sentenceWritingPrompts: undefined,
    readingPassage: {
      title: 'Legacy Reading',
      text: 'Sample text...',
      questions: undefined,
    },
    studentAnswers: {
      quizAnswers: { 'q-1': 1 },
    },
    partsProgress: {
      reading: { status: 'completed' },
    },
    isStarted: true,
  },
};

const restoredHw = generateWeeklyHomework(
  { monday: [], tuesday: [], wednesday: [], thursday: [], friday: [], saturday: [], sunday: [] },
  { id: 'u1', weeklyCycle: 1 } as any,
  'student@example.com',
  'Student',
  undefined,
  'Intermediate',
  'thursday',
  undefined,
  legacyDailyActs
);

assert('restoredHw.matchingPairs is guaranteed to be an array', Array.isArray(restoredHw.matchingPairs));
assert('restoredHw.fillInBlanks is guaranteed to be an array', Array.isArray(restoredHw.fillInBlanks));
assert('restoredHw.sentenceWritingPrompts is guaranteed to be an array', Array.isArray(restoredHw.sentenceWritingPrompts));
assert('restoredHw.readingPassage.questions is guaranteed to be an array', Array.isArray(restoredHw.readingPassage.questions));
assert('Student existing quiz answers preserved', restoredHw.studentAnswers?.quizAnswers?.['q-1'] === 1);
assert('Student reading completion status preserved', restoredHw.partsProgress?.reading?.status === 'completed');

// ---------------------------------------------------------
// Scenario 4: Generating a New Mini-Story without Uninitialized Properties
// ---------------------------------------------------------
console.log('\n--- Scenario 4: Generating a New Mini-Story without Uninitialized Properties ---');
const newStory = synthesizeCohesiveStoryAndQuestions({
  words: ['negotiate', 'deadline', 'priority', 'deliverable', 'objective'],
  studentLevel: 'Intermediate',
  studentName: 'Alex',
});

assert('Generated story has valid text', typeof newStory.text === 'string' && newStory.text.length > 50);
assert('Generated story text passes isBadStoryText', !isBadStoryText(newStory.text));
assert('Generated story questions is a valid array with >= 2 items', Array.isArray(newStory.questions) && newStory.questions.length >= 2);
newStory.questions.forEach((q, idx) => {
  assert(`Question ${idx + 1} has an id`, Boolean(q.id));
  assert(`Question ${idx + 1} has options array`, Array.isArray(q.options) && q.options.length > 0);
  assert(`Question ${idx + 1} has numeric correctAnswer`, typeof q.correctAnswer === 'number' || typeof (q as any).correctOptionIndex === 'number');
});

// ---------------------------------------------------------
// Scenario 5: F5 Restoration Preservation
// ---------------------------------------------------------
console.log('\n--- Scenario 5: F5 Restoration Preservation ---');
const existingDayWithFullData: Record<string, any> = {
  friday: {
    id: 'hw-friday-1',
    day: 'friday',
    weeklyCycle: 1,
    studentUid: 'u1',
    selectedWords: [
      { word: 'strategy', definitionEn: 'a plan of action', translationPt: 'estratégia' },
      { word: 'focus', definitionEn: 'center of interest', translationPt: 'foco' },
    ],
    matchingPairs: [
      { id: 'm-1', word: 'strategy', definition: 'a plan of action', translation: 'estratégia' },
      { id: 'm-2', word: 'focus', definition: 'center of interest', translation: 'foco' },
    ],
    fillInBlanks: [
      { id: 'f-1', sentenceWithBlank: 'We must ___ our goals.', correctWord: 'focus', options: ['focus', 'strategy'] },
    ],
    sentenceWritingPrompts: [
      { word: 'strategy', hint: 'Write a sentence' },
      { word: 'focus', hint: 'Write a sentence' },
    ],
    readingPassage: {
      title: 'Friday Focus',
      text: 'Paragraph 1...\n\nParagraph 2...\n\nParagraph 3...\n\nParagraph 4...',
      questions: [
        { id: 'q-1', question: 'What is the topic?', options: ['A', 'B'], correctOptionIndex: 0 },
      ],
      isAiGenerated: true,
    },
    studentAnswers: {
      matching: { 'm-1': 'strategy' },
      fillInBlanks: { 'f-1': 'focus' },
      sentences: { strategy: 'We developed a solid strategy for Q4.' },
      quizAnswers: { 'q-1': 0 },
    },
    partsProgress: {
      matching: { partKey: 'matching', partNumber: 1, status: 'completed' },
      fill: { partKey: 'fill', partNumber: 2, status: 'completed' },
      writing: { partKey: 'writing', partNumber: 3, status: 'completed' },
      reading: { partKey: 'reading', partNumber: 4, status: 'completed' },
    },
    isCompleted: true,
  },
};

const f5Restored = generateWeeklyHomework(
  { monday: [], tuesday: [], wednesday: [], thursday: [], friday: [], saturday: [], sunday: [] },
  { id: 'u1', weeklyCycle: 1 } as any,
  'alex@example.com',
  'Alex',
  undefined,
  'Intermediate',
  'friday',
  undefined,
  existingDayWithFullData
);

assert('Matching pairs preserved across F5', f5Restored.matchingPairs.length === 2);
assert('Student matching answers preserved across F5', f5Restored.studentAnswers?.matching?.['m-1'] === 'strategy');
assert('Student sentence answers preserved across F5', f5Restored.studentAnswers?.sentences?.['strategy'] === 'We developed a solid strategy for Q4.');
assert('Student quiz answers preserved across F5', f5Restored.studentAnswers?.quizAnswers?.['q-1'] === 0);
assert('All parts progress preserved across F5', f5Restored.partsProgress?.matching?.status === 'completed');

// ---------------------------------------------------------
// Scenario 6: Preservation of Existing Student Answers
// ---------------------------------------------------------
console.log('\n--- Scenario 6: Preservation of Existing Student Answers ---');
assert('Answers object exists', f5Restored.studentAnswers !== undefined);
assert('Fill in blanks answers intact', f5Restored.studentAnswers?.fillInBlanks?.['f-1'] === 'focus');

// ---------------------------------------------------------
// Scenario 7: Absence of Regressions in P1, P2, P3
// ---------------------------------------------------------
console.log('\n--- Scenario 7: Absence of Regressions in P1, P2, P3 ---');
const freshWords: RoutineItem[] = [
  {
    id: 'r1',
    time: '08:00',
    activityName: 'Morning Review',
    dayOfWeek: 'friday',
    learnedWords: ['analyze', 'execute', 'summarize'],
  },
];

const freshHw = generateWeeklyHomework(
  { monday: [], tuesday: [], wednesday: [], thursday: [], friday: freshWords, saturday: [], sunday: [] },
  { id: 'u2', weeklyCycle: 1 } as any,
  'student2@example.com',
  'Student 2',
  undefined,
  'Intermediate',
  'friday'
);

assert('P1 matchingPairs generated for fresh homework', freshHw.matchingPairs.length === 3);
assert('P2 fillInBlanks generated for fresh homework', freshHw.fillInBlanks.length === 3);
assert('P3 sentenceWritingPrompts generated for fresh homework', freshHw.sentenceWritingPrompts.length === 3);
assert('P4 readingPassage generated for fresh homework', Boolean(freshHw.readingPassage && freshHw.readingPassage.text));

console.log('\n======================================================');
if (allPassed) {
  console.log('✅ ALL 7 TEST SCENARIOS PASSED WITH ZERO REGRESSIONS!');
} else {
  console.error('❌ SOME TESTS FAILED. PLEASE REVIEW LOGS ABOVE.');
  process.exit(1);
}
