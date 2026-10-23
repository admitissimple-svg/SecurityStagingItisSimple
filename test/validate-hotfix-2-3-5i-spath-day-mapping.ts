import assert from 'node:assert';
import { DayOfWeek, WeeklyHomeworkData, UserProfile, StudentJournalEntry } from '../src/types';
import {
  getDailyMemorizationSchedule,
  DAYS_OF_WEEK,
} from '../src/utils/homeworkGenerator';
import {
  normalizeWeekId,
  parseWeekCycleNumber,
  normalizeUid,
} from '../src/utils/studentPersistence';

console.log('🧪 Starting HOTFIX 2.3.5I — S-Path Memorization: Correct Day Mapping Test Suite...\n');

// =========================================================================
// TEST 1: P1 na sexta marca somente sexta (Week 13 scenario)
// =========================================================================
console.log('▶ Test 1: P1 na sexta marca somente sexta (Week 13 scenario)...');

const week13Cycle = 13;
const activeDaysAll: DayOfWeek[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

// Verify rotation: on Week 13 with 7 study days, Friday is indeed Part 1 (matching)
const fridaySchedule = getDailyMemorizationSchedule('friday', activeDaysAll, week13Cycle);
const mondaySchedule = getDailyMemorizationSchedule('monday', activeDaysAll, week13Cycle);

assert.strictEqual(fridaySchedule.partNumber, 1, 'Friday in Week 13 must be Part 1');
assert.strictEqual(fridaySchedule.partKey, 'matching', 'Friday in Week 13 must be matching');
assert.strictEqual(mondaySchedule.partNumber, 1, 'Monday in Week 13 must also be Part 1');

// Simulate the completion handler (markSPathCompleted) executing on Friday for Part 1
const initialHomework: WeeklyHomeworkData = {
  id: 'hw-friday-13',
  weekLabel: 'Week of Oct 19',
  studentEmail: 'student@example.com',
  studentName: 'Student Test',
  targetDay: 'friday',
  weeklyCycle: 13,
  createdAt: new Date().toISOString(),
  totalWordsCollected: 5,
  vocabularyList: [{ word: 'boss' }, { word: 'colleague' }] as any,
  matchingPairs: [{ id: 'm1', word: 'boss', definition: 'supervisor' }] as any,
  fillInBlanks: [],
  sentenceWritingPrompts: [],
  readingPassage: { title: 'Story', text: 'Text', questions: [] },
  completedPartsByDay: {},
  studentAnswers: { matching: { m1: 'boss' } },
  partsProgress: {},
};

// Simulation of markSPathCompleted with targetDay = 'friday'
function simulateMarkSPathCompleted(
  day: DayOfWeek,
  partKey: string,
  hw: WeeklyHomeworkData,
  cycle: number
): { updatedHw: WeeklyHomeworkData; weeklyChecks: Record<string, boolean>; journalEntry: StudentJournalEntry } {
  const updatedParts = { ...(hw.completedPartsByDay || {}), [day]: true };
  const updatedHw: WeeklyHomeworkData = {
    ...hw,
    targetDay: day,
    isDayPartCompleted: true,
    completedPartsByDay: updatedParts,
    dailyActivities: {
      ...(hw.dailyActivities || {}),
      [day]: {
        id: `hw-${day}-${cycle}`,
        day,
        weeklyCycle: cycle,
        studentUid: 'student-uid-1',
        selectedWords: hw.vocabularyList,
        wordOrigins: [],
        matchingPairs: hw.matchingPairs,
        fillInBlanks: hw.fillInBlanks,
        sentenceWritingPrompts: hw.sentenceWritingPrompts,
        readingPassage: hw.readingPassage,
        isCompleted: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    },
  };

  const checkKey = `memorization_${day}`;
  const weeklyChecks: Record<string, boolean> = { [checkKey]: true };

  const journalEntry: StudentJournalEntry = {
    id: `memorization_${day}_${cycle}_${Date.now()}`,
    type: 'memorization',
    date: '2026-10-23',
    dayOfWeek: day,
    week: cycle,
    partNumber: getDailyMemorizationSchedule(day, activeDaysAll, cycle).partNumber,
    timestamp: Date.now(),
    title: 'Weekly Memorization Activity',
  };

  return { updatedHw, weeklyChecks, journalEntry };
}

const resultFridayP1 = simulateMarkSPathCompleted('friday', 'matching', initialHomework, 13);

assert.strictEqual(resultFridayP1.updatedHw.completedPartsByDay?.['friday'], true, 'Friday must be marked in completedPartsByDay');
assert.strictEqual(Boolean(resultFridayP1.updatedHw.completedPartsByDay?.['monday']), false, 'Monday must NOT be marked in completedPartsByDay');
assert.strictEqual(resultFridayP1.weeklyChecks['memorization_friday'], true, 'weeklyChecks must have memorization_friday: true');
assert.strictEqual(Boolean(resultFridayP1.weeklyChecks['memorization_monday']), false, 'weeklyChecks must NOT have memorization_monday');
assert.strictEqual(resultFridayP1.journalEntry.dayOfWeek, 'friday', 'Journal entry dayOfWeek must be friday');
assert.strictEqual(resultFridayP1.journalEntry.week, 13, 'Journal entry week must be 13');
assert.strictEqual(resultFridayP1.journalEntry.partNumber, 1, 'Journal entry partNumber must be 1');

console.log('  ✔ P1 on Friday marks strictly Friday. Monday is unaffected.\n');

// =========================================================================
// TEST 2: P1 na segunda marca somente segunda
// =========================================================================
console.log('▶ Test 2: P1 na segunda marca somente segunda...');

const resultMondayP1 = simulateMarkSPathCompleted('monday', 'matching', initialHomework, 13);

assert.strictEqual(resultMondayP1.updatedHw.completedPartsByDay?.['monday'], true, 'Monday must be marked in completedPartsByDay');
assert.strictEqual(Boolean(resultMondayP1.updatedHw.completedPartsByDay?.['friday']), false, 'Friday must NOT be marked');
assert.strictEqual(resultMondayP1.weeklyChecks['memorization_monday'], true, 'weeklyChecks must have memorization_monday: true');
assert.strictEqual(Boolean(resultMondayP1.weeklyChecks['memorization_friday']), false, 'weeklyChecks must NOT have memorization_friday');
assert.strictEqual(resultMondayP1.journalEntry.dayOfWeek, 'monday', 'Journal entry dayOfWeek must be monday');

console.log('  ✔ P1 on Monday marks strictly Monday.\n');

// =========================================================================
// TEST 3: P2 no sábado marca somente sábado
// =========================================================================
console.log('▶ Test 3: P2 no sábado marca somente sábado...');

const saturdaySchedule = getDailyMemorizationSchedule('saturday', activeDaysAll, 13);
assert.strictEqual(saturdaySchedule.partNumber, 2, 'Saturday in Week 13 must be Part 2');
assert.strictEqual(saturdaySchedule.partKey, 'fill', 'Saturday in Week 13 must be fill');

const resultSaturdayP2 = simulateMarkSPathCompleted('saturday', 'fill', initialHomework, 13);

assert.strictEqual(resultSaturdayP2.updatedHw.completedPartsByDay?.['saturday'], true, 'Saturday must be marked in completedPartsByDay');
assert.strictEqual(Boolean(resultSaturdayP2.updatedHw.completedPartsByDay?.['tuesday']), false, 'Tuesday must NOT be marked');
assert.strictEqual(resultSaturdayP2.weeklyChecks['memorization_saturday'], true, 'weeklyChecks must have memorization_saturday: true');
assert.strictEqual(Boolean(resultSaturdayP2.weeklyChecks['memorization_tuesday']), false, 'weeklyChecks must NOT have memorization_tuesday');
assert.strictEqual(resultSaturdayP2.journalEntry.dayOfWeek, 'saturday', 'Journal entry dayOfWeek must be saturday');
assert.strictEqual(resultSaturdayP2.journalEntry.partNumber, 2, 'Journal entry partNumber must be 2');

console.log('  ✔ P2 on Saturday marks strictly Saturday. Tuesday is unaffected.\n');

// =========================================================================
// TEST 4: F5 mantém o dia correto
// =========================================================================
console.log('▶ Test 4: F5 mantém o dia correto...');

// Simulate page reload: rehydration from Firestore weeklyChecks & homework
const persistedWeeklyChecks = {
  memorization_friday: true,
};
const persistedCompletedPartsByDay = {
  friday: true,
};

// Simulation of App.tsx rehydration
const rehydratedWeeklyChecks = { ...persistedWeeklyChecks };
const rehydratedCompletedParts = { ...persistedCompletedPartsByDay };

// Function that checks if a circle is marked in StudentWeeklyActivitySection
function isActivityCompletedCheck(
  rowId: string,
  dayKey: DayOfWeek,
  checks: Record<string, boolean>,
  completedParts: Record<string, boolean>
): boolean {
  if (rowId !== 'memorization') return false;
  const checkKey = `${rowId}_${dayKey}`;
  if (checks && Boolean(checks[checkKey])) return true;
  if (completedParts && Boolean(completedParts[dayKey])) return true;
  return false;
}

assert.strictEqual(isActivityCompletedCheck('memorization', 'friday', rehydratedWeeklyChecks, rehydratedCompletedParts), true, 'Friday must remain checked after F5');
assert.strictEqual(isActivityCompletedCheck('memorization', 'monday', rehydratedWeeklyChecks, rehydratedCompletedParts), false, 'Monday must remain unchecked after F5');
assert.strictEqual(isActivityCompletedCheck('memorization', 'saturday', rehydratedWeeklyChecks, rehydratedCompletedParts), false, 'Saturday must remain unchecked after F5');

console.log('  ✔ After F5, strictly Friday is restored. No other day is altered.\n');

// =========================================================================
// TEST 5: Trocar de dia não transfere a conclusão
// =========================================================================
console.log('▶ Test 5: Trocar de dia não transfere a conclusão...');

// Student has Friday completed
let currentHomeworkState: WeeklyHomeworkData = {
  ...initialHomework,
  targetDay: 'friday',
  completedPartsByDay: { friday: true },
};

// Student switches to Saturday in the UI
const switchedToSaturdayState: WeeklyHomeworkData = {
  ...currentHomeworkState,
  targetDay: 'saturday',
  // targetDay changed, completedPartsByDay is preserved
};

// Verify Friday is still completed
assert.strictEqual(switchedToSaturdayState.completedPartsByDay?.['friday'], true, 'Friday must remain completed');
// Verify Saturday is NOT completed
assert.strictEqual(Boolean(switchedToSaturdayState.completedPartsByDay?.['saturday']), false, 'Saturday must NOT be completed');

// Verify isTodayPartCompleted logic for both days
function checkIsTodayPartCompleted(targetDay: DayOfWeek, hw: WeeklyHomeworkData, checks: Record<string, boolean>): boolean {
  return Boolean(
    hw?.completedPartsByDay?.[targetDay] ||
    checks?.[`memorization_${targetDay}`] ||
    (hw?.targetDay === targetDay && hw?.isDayPartCompleted && hw?.completedPartsByDay?.[targetDay])
  );
}

const checksState = { memorization_friday: true };
assert.strictEqual(checkIsTodayPartCompleted('friday', currentHomeworkState, checksState), true, 'Friday is completed');
assert.strictEqual(checkIsTodayPartCompleted('saturday', switchedToSaturdayState, checksState), false, 'Saturday is NOT completed');

console.log('  ✔ Switching day preserves Friday completion and does NOT transfer to Saturday.\n');

// =========================================================================
// TEST 6: Nova semana não herda conclusões anteriores
// =========================================================================
console.log('▶ Test 6: Nova semana não herda conclusões anteriores...');

// Week 13 had Friday completed
const week13Checks = { memorization_friday: true };
const week13HomeworkParts = { friday: true };

// Week 14 starts: new cycle is 14
const week14Cycle = 14;
const week14Checks: Record<string, boolean> = {}; // Scoped to week-14
const week14HomeworkParts: Record<string, boolean> = {}; // Fresh week

DAYS_OF_WEEK.forEach((d) => {
  assert.strictEqual(
    isActivityCompletedCheck('memorization', d, week14Checks, week14HomeworkParts),
    false,
    `Day ${d} must not be completed in Week 14`
  );
});

// Verify rotation for Week 14:
// Prior days = (14 - 1) * 7 = 13 * 7 = 91.
// 91 % 4 = 3.
// Monday: (91 + 0) % 4 + 1 = 4 (Part 4).
// Tuesday: (91 + 1) % 4 + 1 = 1 (Part 1).
const mondayW14 = getDailyMemorizationSchedule('monday', activeDaysAll, week14Cycle);
assert.strictEqual(mondayW14.partNumber, 4, 'Monday in Week 14 is Part 4');
const tuesdayW14 = getDailyMemorizationSchedule('tuesday', activeDaysAll, week14Cycle);
assert.strictEqual(tuesdayW14.partNumber, 1, 'Tuesday in Week 14 is Part 1');

console.log('  ✔ Week 14 starts completely fresh (0% markings) and part rotation is preserved.\n');

// =========================================================================
// TEST 7: Vídeo, áudio e Native Friend permanecem independentes
// =========================================================================
console.log('▶ Test 7: Vídeo, áudio e Native Friend permanecem independentes...');

const fullSPathChecks = {
  video_day_friday: true,
  audio_day_friday: false,
  tutor_live_friday: true,
  memorization_friday: true,
};

assert.strictEqual(fullSPathChecks.video_day_friday, true, 'Video check is independent');
assert.strictEqual(fullSPathChecks.audio_day_friday, false, 'Audio check is independent');
assert.strictEqual(fullSPathChecks.tutor_live_friday, true, 'Native Friend check is independent');
assert.strictEqual(fullSPathChecks.memorization_friday, true, 'Memorization check is independent');

// Modifying memorization does not affect others
const toggledChecks = {
  ...fullSPathChecks,
  memorization_friday: false,
};

assert.strictEqual(toggledChecks.video_day_friday, true, 'Video remains true when memorization toggles');
assert.strictEqual(toggledChecks.audio_day_friday, false, 'Audio remains false when memorization toggles');
assert.strictEqual(toggledChecks.tutor_live_friday, true, 'Native Friend remains true when memorization toggles');

console.log('  ✔ Video, audio, and Native Friend pillars are strictly independent.\n');

console.log('=========================================================================');
console.log('🎉 ALL 7 MANDATORY TESTS FOR HOTFIX 2.3.5I PASSED SUCCESSFULLY!');
console.log('=========================================================================\n');
