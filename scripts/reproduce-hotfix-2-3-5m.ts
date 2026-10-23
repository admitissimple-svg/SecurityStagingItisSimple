import {
  generateWeeklyHomework,
  getDailyMemorizationSchedule,
  resolveDailyMemorizationVocabulary,
} from '../src/utils/homeworkGenerator';
import { isBadStoryText, synthesizeCohesiveStoryAndQuestions } from '../src/utils/pedagogicalStorySynthesizer';
import { getMemorizationTranslations } from '../src/utils/i18n/memorizationActivity';
import { DayOfWeek, RoutineItem, WeeklyHomeworkData } from '../src/types';

console.log('--- DIAGNOSTIC SCRIPT: REPRODUCING CANNOT READ PROPERTIES OF UNDEFINED (READING LENGTH) ---');

// Let us inspect what happens in WeeklyHomeworkModal when rendered or evaluated:
// Specifically, let us test:
// 1. activeTab === 'matching' with undefined matchingPairs
// 2. activeTab === 'fill' with undefined fillInBlanks
// 3. activeTab === 'writing' with undefined sentenceWritingPrompts
// 4. activeTab === 'reading' with undefined questions or missing arrays
// 5. handleSavePart1, handleSavePart2, handleSavePart3, handleSavePart4
// 6. hasValidAiStory / hasValidStory check in lines 593 and 731!

const memT = getMemorizationTranslations('en');

// Let us test lines 587-594 and lines 725-732 from WeeklyHomeworkModal.tsx:
console.log('\n--- Test 1: Testing currentPassage.questions.length (lines 593 & 731) ---');
try {
  const currentPassage: any = {
    title: 'Valid Story',
    text: 'Paragraph 1\n\nParagraph 2\n\nParagraph 3\n\nParagraph 4 is long enough to pass isBadStoryText with more than 120 characters total and proper sentences.',
    isAiGenerated: true,
    questions: undefined, // What if questions is undefined?!
  };

  // Wait! In WeeklyHomeworkModal.tsx:
  // line 592: Array.isArray(currentPassage.questions) && currentPassage.questions.length >= 2
  // Wait, if Array.isArray(undefined) is false, it short-circuits.
  // BUT WHAT IF currentPassage is an object from Firestore that was parsed or restored?
} catch (e) {
  console.error('Test 1 failed:', e);
}

// Let us check all places where `.length` is called directly on properties of `homework`:
console.log('\n--- Test 2: Checking homework properties .length ---');
const legacyHomework: any = {
  id: 'hw-legacy-1',
  studentEmail: 'test@example.com',
  studentName: 'Alex',
  totalWordsCollected: 5,
  vocabularyList: [{ word: 'need' }, { word: 'small' }],
  // Notice: matchingPairs is undefined!
  // fillInBlanks is undefined!
  // sentenceWritingPrompts is undefined!
  readingPassage: {
    title: 'Story',
    text: 'Four paragraphs here...',
    questions: undefined,
  },
};

// What happens in WeeklyHomeworkModal line 1814?
try {
  console.log('Checking line 1814: homework.matchingPairs.length');
  const val = legacyHomework.matchingPairs.length;
  console.log('val:', val);
} catch (e: any) {
  console.log('>>> REPRODUCED AT LINE 1814: homework.matchingPairs.length ->', e.message);
}

// What happens in WeeklyHomeworkModal line 2023?
try {
  console.log('Checking line 2023: homework.fillInBlanks.length');
  const val = legacyHomework.fillInBlanks.length;
  console.log('val:', val);
} catch (e: any) {
  console.log('>>> REPRODUCED AT LINE 2023: homework.fillInBlanks.length ->', e.message);
}

// What happens in WeeklyHomeworkModal line 2474 & 2559?
try {
  console.log('Checking line 2559: homework.sentenceWritingPrompts.length');
  const val = legacyHomework.sentenceWritingPrompts.length;
  console.log('val:', val);
} catch (e: any) {
  console.log('>>> REPRODUCED AT LINE 2559: homework.sentenceWritingPrompts.length ->', e.message);
}

// Now let us check Part 4 specifically!
console.log('\n--- Test 3: Checking Part 4 specific flows ---');
// In Part 4:
// Line 2698: (activeDayActivity?.selectedWords || homework.vocabularyList || []).length || 5
// Line 2748: if (!activeDayPassage || (!activeDayPassage.text && safeQuestions.length === 0))
// Line 2945: {Object.keys(quizAnswers).length} / {safeQuestions.length}
// Line 2986: {safeQuestions.length} {isEn ? 'questions' : 'perguntas'}
// Line 2990: {routineActivityNames.length > 0}
// Line 3109: {routineActivityNames.length > 0}
// Line 3137: {homework.matchingPairs.map(...)}
try {
  console.log('Checking line 3137 (in Part 4 tab!): homework.matchingPairs.map');
  legacyHomework.matchingPairs.map((m: any) => m);
} catch (e: any) {
  console.log('>>> REPRODUCED AT LINE 3137 (inside Part 4 view!): homework.matchingPairs.map ->', e.message);
}

// What about generateWeeklyHomework when targetDay has existingDailyActivities?
console.log('\n--- Test 4: generateWeeklyHomework with existingDailyActivities ---');
const existingDailyWithUndefinedArrays: Record<string, any> = {
  thursday: {
    id: 'hw-thursday-1',
    day: 'thursday',
    weeklyCycle: 1,
    studentUid: 'u1',
    selectedWords: [{ word: 'need' }],
    // No matchingPairs, fillInBlanks, sentenceWritingPrompts!
    readingPassage: {
      title: 'T',
      text: 'Story...',
      questions: undefined,
    },
    studentAnswers: {
      matching: {},
      fillInBlanks: {},
      sentences: {},
      quizAnswers: { 'q-1': 0 },
    },
    partsProgress: {
      reading: { status: 'completed' },
    },
    isStarted: true,
  }
};

const genResult = generateWeeklyHomework(
  { monday: [], tuesday: [], wednesday: [], thursday: [], friday: [], saturday: [], sunday: [] },
  { id: 'u1', weeklyCycle: 1 } as any,
  'alex@test.com',
  'Alex',
  undefined,
  'Intermediate',
  'thursday',
  undefined,
  existingDailyWithUndefinedArrays
);
console.log('genResult matchingPairs:', genResult.matchingPairs);
console.log('genResult readingPassage.questions:', genResult.readingPassage.questions);
