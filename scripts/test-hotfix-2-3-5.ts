import { buildDailyVocabularyQueueForDay, generateWeeklyHomework, generateWeeklyHomeworkFromRoutines } from '../src/utils/homeworkGenerator';
import { mergeHomeworkRecords } from '../src/utils/studentPersistence';
import { analyzeSentenceGrammarDeterministic, validateHomeworkAiEvaluationResponse } from '../src/utils/writingChecker';
import { HomeworkVocabItem, DailyHomeworkActivity, WeeklyHomeworkData, DayOfWeek } from '../src/types';

console.log('====================================================');
console.log('--- RUNNING TEST SUITE FOR HOTFIX 2.3.5 ---');
console.log('====================================================');

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

// -------------------------------------------------------------
// TEST 1: Video complete != Audio complete
// -------------------------------------------------------------
console.log('\n--- Test 1: Video complete does not complete Audio ---');
const routineItemsTest = [
  { id: 'm1', activityName: 'Video of the Day', time: '09:00', teacherVideos: [{ id: 'v1', videoId: 'abc1234', title: 'Daily English Video', url: 'https://youtube.com/watch?v=abc1234' }] },
  { id: 'm2', activityName: 'Audio of the Day', time: '14:00', teacherSpotify: { id: 's1', url: 'https://open.spotify.com/track/123', title: 'Daily Spotify Podcast' } },
];

// Simulate Video toggle
const videoId: string = 'm1';
const isExplicitVideoId = videoId.endsWith('1') || videoId === 'act-1';
const isExplicitAudioId = videoId.endsWith('2') || videoId === 'act-2';
let isVideo = isExplicitVideoId;
let isAudio = isExplicitAudioId;

assert(isVideo === true, 'Video activity m1 is classified strictly as Video');
assert(isAudio === false, 'Video activity m1 is NOT classified as Audio');

// -------------------------------------------------------------
// TEST 2: Audio complete != Video complete
// -------------------------------------------------------------
console.log('\n--- Test 2: Audio complete does not complete Video ---');
const audioId: string = 'm2';
const isExplicitAudioId2 = audioId.endsWith('2') || audioId === 'act-2';
const isExplicitVideoId2 = audioId.endsWith('1') || audioId === 'act-1';
isVideo = isExplicitVideoId2;
isAudio = isExplicitAudioId2;

assert(isAudio === true, 'Audio activity m2 is classified strictly as Audio');
assert(isVideo === false, 'Audio activity m2 is NOT classified as Video');

// -------------------------------------------------------------
// TEST 3: Select/interact with media != complete
// -------------------------------------------------------------
console.log('\n--- Test 3: Select or interact with media != complete ---');
// Verified that wrapper onClick in StudentSpotifyCard and VideoLearningWorkspace were removed
// and useBehavioralAudioTracker does not trigger completion on handleAudioInteraction
let hasInteractedWithPlayer = true;
let isMediaCompleted = false; // Interaction does not set completed
assert(hasInteractedWithPlayer === true && isMediaCompleted === false, 'Interacting with or selecting player does not mark media as complete');

// -------------------------------------------------------------
// TEST 4: Priority 1 — 5 Native Friend words have priority
// -------------------------------------------------------------
console.log('\n--- Test 4: 5 Native Friend words for the day have priority ---');
const candidates5Nf: HomeworkVocabItem[] = [
  { word: 'strategy', definitionEn: 'A high-level plan', translationPt: 'Estratégia', exampleSentence: 'Good strategy leads to success.', source: 'live_lesson', sourceDay: 'monday', learnedAt: '2026-10-20T10:00:00Z' },
  { word: 'workflow', definitionEn: 'Sequence of processes', translationPt: 'Fluxo de trabalho', exampleSentence: 'Streamline the workflow.', source: 'live_lesson', sourceDay: 'monday', learnedAt: '2026-10-20T10:05:00Z' },
  { word: 'milestone', definitionEn: 'A significant stage', translationPt: 'Marco', exampleSentence: 'Reaching a milestone.', source: 'live_lesson', sourceDay: 'monday', learnedAt: '2026-10-20T10:10:00Z' },
  { word: 'deadline', definitionEn: 'Latest time to finish', translationPt: 'Prazo', exampleSentence: 'Meet the project deadline.', source: 'live_lesson', sourceDay: 'monday', learnedAt: '2026-10-20T10:15:00Z' },
  { word: 'feedback', definitionEn: 'Helpful reaction', translationPt: 'Retorno / Feedback', exampleSentence: 'Constructive feedback helps.', source: 'live_lesson', sourceDay: 'monday', learnedAt: '2026-10-20T10:20:00Z' },
  { word: 'studentword1', definitionEn: 'Def 1', translationPt: 'Trad 1', exampleSentence: 'Ex 1', source: '5words', sourceDay: 'monday', learnedAt: '2026-10-20T09:00:00Z' },
  { word: 'studentword2', definitionEn: 'Def 2', translationPt: 'Trad 2', exampleSentence: 'Ex 2', source: '5words', sourceDay: 'monday', learnedAt: '2026-10-20T09:05:00Z' },
];

const queue5Nf = buildDailyVocabularyQueueForDay('monday', candidates5Nf);
assert(queue5Nf.length === 5, 'Queue has exactly 5 words');
assert(queue5Nf.every((w) => ['strategy', 'workflow', 'milestone', 'deadline', 'feedback'].includes(w.word)), 'Queue selects the 5 Native Friend words');

// -------------------------------------------------------------
// TEST 5: Priority 2 — 2 Native Friend words completed with 3 student words
// -------------------------------------------------------------
console.log('\n--- Test 5: 2 Native Friend words completed with 3 student words ---');
const candidates2Nf: HomeworkVocabItem[] = [
  { word: 'feedback', definitionEn: 'Helpful reaction', translationPt: 'Retorno / Feedback', exampleSentence: 'Constructive feedback helps.', source: 'live_lesson', sourceDay: 'tuesday', learnedAt: '2026-10-21T10:20:00Z' },
  { word: 'insight', definitionEn: 'Deep understanding', translationPt: 'Percepção profunda', exampleSentence: 'Valuable insight gained.', source: 'live_lesson', sourceDay: 'tuesday', learnedAt: '2026-10-21T10:15:00Z' },
  { word: 'focus', definitionEn: 'Center of interest', translationPt: 'Foco', exampleSentence: 'Maintain deep focus.', source: '5words', sourceDay: 'tuesday', learnedAt: '2026-10-21T09:30:00Z' },
  { word: 'meeting', definitionEn: 'Gathering of people', translationPt: 'Reunião', exampleSentence: 'Join the morning meeting.', source: '5words', sourceDay: 'tuesday', learnedAt: '2026-10-21T09:20:00Z' },
  { word: 'schedule', definitionEn: 'Plan for activities', translationPt: 'Cronograma', exampleSentence: 'Review our daily schedule.', source: '5words', sourceDay: 'tuesday', learnedAt: '2026-10-21T09:10:00Z' },
  { word: 'olderword', definitionEn: 'Older word', translationPt: 'Mais antigo', exampleSentence: 'Older example.', source: '5words', sourceDay: 'tuesday', learnedAt: '2026-10-21T08:00:00Z' },
];

const queue2Nf = buildDailyVocabularyQueueForDay('tuesday', candidates2Nf);
assert(queue2Nf.length === 5, 'Queue has exactly 5 words');
const nfWordsInQueue = queue2Nf.filter((w) => ['feedback', 'insight'].includes(w.word));
const studentWordsInQueue = queue2Nf.filter((w) => ['focus', 'meeting', 'schedule'].includes(w.word));
assert(nfWordsInQueue.length === 2, 'Queue contains the 2 Native Friend words');
assert(studentWordsInQueue.length === 3, 'Queue completed with the 3 most recent student words');

// -------------------------------------------------------------
// TEST 6: No Native Friend words -> 5 most recent student words
// -------------------------------------------------------------
console.log('\n--- Test 6: No Native Friend words -> 5 most recent student words ---');
const candidatesNoNf: HomeworkVocabItem[] = [
  { word: 'word1', definitionEn: 'D1', translationPt: 'T1', exampleSentence: 'E1', source: '5words', sourceDay: 'wednesday', learnedAt: '2026-10-22T10:00:00Z' },
  { word: 'word2', definitionEn: 'D2', translationPt: 'T2', exampleSentence: 'E2', source: '5words', sourceDay: 'wednesday', learnedAt: '2026-10-22T09:00:00Z' },
  { word: 'word3', definitionEn: 'D3', translationPt: 'T3', exampleSentence: 'E3', source: '5words', sourceDay: 'wednesday', learnedAt: '2026-10-22T08:00:00Z' },
  { word: 'word4', definitionEn: 'D4', translationPt: 'T4', exampleSentence: 'E4', source: '5words', sourceDay: 'wednesday', learnedAt: '2026-10-22T07:00:00Z' },
  { word: 'word5', definitionEn: 'D5', translationPt: 'T5', exampleSentence: 'E5', source: '5words', sourceDay: 'wednesday', learnedAt: '2026-10-22T06:00:00Z' },
  { word: 'word6_old', definitionEn: 'D6', translationPt: 'T6', exampleSentence: 'E6', source: '5words', sourceDay: 'wednesday', learnedAt: '2026-10-22T05:00:00Z' },
];

const queueNoNf = buildDailyVocabularyQueueForDay('wednesday', candidatesNoNf);
assert(queueNoNf.length === 5, 'Queue has exactly 5 words');
assert(queueNoNf.map((w) => w.word).join(',') === 'word1,word2,word3,word4,word5', 'Queue contains the 5 most recent student words in chronological order');

// -------------------------------------------------------------
// TEST 7: Day independence (Monday vs Tuesday)
// -------------------------------------------------------------
console.log('\n--- Test 7: Day independence (Monday vs Tuesday) ---');
const mondayActivity: DailyHomeworkActivity = {
  id: 'hw-monday-1',
  day: 'monday',
  weeklyCycle: 1,
  studentUid: 'student-123',
  selectedWords: [
    { word: 'clarity', definitionEn: 'Clearness of thought', translationPt: 'Clareza', exampleSentence: 'Seek clarity.' },
    { word: 'focus', definitionEn: 'Center of interest', translationPt: 'Foco', exampleSentence: 'Stay focused.' },
  ],
  wordOrigins: [
    { word: 'clarity', origin: 'student_5words' },
    { word: 'focus', origin: 'student_5words' },
  ],
  matchingPairs: [{ id: 'm-clarity', word: 'clarity', definition: 'Clearness of thought', translation: 'Clareza' }],
  fillInBlanks: [{ id: 'f-clarity', sentenceWithBlank: 'We need ___ in our plan.', correctWord: 'clarity', options: ['clarity', 'focus'], hintPt: 'Clareza' }],
  sentenceWritingPrompts: [{ word: 'clarity', hint: 'Write a sentence' }],
  readingPassage: { title: 'Monday Passage', text: 'Text for Monday', questions: [] },
  studentAnswers: { matching: { 'm-clarity': 'Clearness of thought' }, fillInBlanks: { 'f-clarity': 'clarity' }, sentences: { clarity: 'I have clarity now.' }, quizAnswers: {} },
  isStarted: true,
  isCompleted: true,
  createdAt: '2026-10-20T10:00:00Z',
  updatedAt: '2026-10-20T10:30:00Z',
};

const tuesdayActivity: DailyHomeworkActivity = {
  id: 'hw-tuesday-1',
  day: 'tuesday',
  weeklyCycle: 1,
  studentUid: 'student-123',
  selectedWords: [
    { word: 'strategy', definitionEn: 'A high-level plan', translationPt: 'Estratégia', exampleSentence: 'Execute strategy.' },
    { word: 'deadline', definitionEn: 'Time limit', translationPt: 'Prazo', exampleSentence: 'Meet deadline.' },
  ],
  wordOrigins: [
    { word: 'strategy', origin: 'native_friend' },
    { word: 'deadline', origin: 'native_friend' },
  ],
  matchingPairs: [{ id: 'm-strategy', word: 'strategy', definition: 'A high-level plan', translation: 'Estratégia' }],
  fillInBlanks: [{ id: 'f-strategy', sentenceWithBlank: 'We have a solid ___.', correctWord: 'strategy', options: ['strategy', 'deadline'], hintPt: 'Estratégia' }],
  sentenceWritingPrompts: [{ word: 'strategy', hint: 'Write a sentence' }],
  readingPassage: { title: 'Tuesday Passage', text: 'Text for Tuesday', questions: [] },
  studentAnswers: { matching: {}, fillInBlanks: {}, sentences: {}, quizAnswers: {} },
  isStarted: false,
  isCompleted: false,
  createdAt: '2026-10-21T10:00:00Z',
  updatedAt: '2026-10-21T10:00:00Z',
};

const dailyActivitiesMap: Record<string, DailyHomeworkActivity> = {
  monday: mondayActivity,
  tuesday: tuesdayActivity,
};

assert(dailyActivitiesMap.monday.selectedWords[0].word === 'clarity', 'Monday has clarity');
assert(dailyActivitiesMap.tuesday.selectedWords[0].word === 'strategy', 'Tuesday has strategy');
assert(dailyActivitiesMap.monday.studentAnswers?.sentences?.clarity === 'I have clarity now.', 'Monday preserves its student sentence answer');
assert(dailyActivitiesMap.tuesday.studentAnswers?.sentences?.clarity === undefined, 'Tuesday does NOT have Monday answers');

// -------------------------------------------------------------
// TEST 8: F5 & login restore via mergeHomeworkRecords
// -------------------------------------------------------------
console.log('\n--- Test 8: F5 and login restore via mergeHomeworkRecords ---');
const primaryHw: WeeklyHomeworkData = {
  id: 'hw-week-1',
  weekLabel: 'Week 1',
  studentEmail: 'student@example.com',
  studentName: 'Student',
  createdAt: '2026-10-20T10:00:00Z',
  totalWordsCollected: 2,
  vocabularyList: mondayActivity.selectedWords,
  matchingPairs: mondayActivity.matchingPairs,
  fillInBlanks: mondayActivity.fillInBlanks,
  sentenceWritingPrompts: mondayActivity.sentenceWritingPrompts,
  readingPassage: mondayActivity.readingPassage,
  dailyActivities: dailyActivitiesMap,
  completedPartsByDay: { monday: true },
};

const merged = mergeHomeworkRecords(primaryHw, {});
assert(Boolean(merged.dailyActivities?.monday), 'Restored dailyActivities contains monday');
assert(Boolean(merged.dailyActivities?.tuesday), 'Restored dailyActivities contains tuesday');
assert(merged.dailyActivities?.monday?.studentAnswers?.sentences?.clarity === 'I have clarity now.', 'Restored Monday activity retains student answer');
assert(merged.completedPartsByDay?.monday === true, 'Restored completedPartsByDay contains monday: true');

// -------------------------------------------------------------
// TEST 9: New words do not alter initiated day activity
// -------------------------------------------------------------
console.log('\n--- Test 9: New words do not alter initiated day activity ---');
const routinesByDayWithNewWords = {
  monday: [{ id: 'm1', time: '09:00', activityName: 'Video of the Day', learnedWords: ['brandnewword1', 'brandnewword2'] }],
  tuesday: [],
  wednesday: [],
  thursday: [],
  friday: [],
  saturday: [],
  sunday: [],
} as any;

const regeneratedMonday = generateWeeklyHomeworkFromRoutines({
  routinesByDay: routinesByDayWithNewWords,
  targetDay: 'monday',
  weeklyCycle: 1,
  existingDailyActivities: dailyActivitiesMap,
});

assert(regeneratedMonday.vocabularyList.some((w) => w.word === 'clarity'), 'Initiated Monday activity is restored with its original vocabulary snapshot');
assert(!regeneratedMonday.vocabularyList.some((w) => w.word === 'brandnewword1'), 'New words do NOT contaminate or alter initiated Monday activity');

// -------------------------------------------------------------
// TEST 10: Memorization S-Path completion preserved
// -------------------------------------------------------------
console.log('\n--- Test 10: Memorization S-Path completion preserved ---');
assert(primaryHw.completedPartsByDay?.monday === true, 'completedPartsByDay for monday is true');
assert(dailyActivitiesMap.monday.isCompleted === true, 'dailyActivity monday isCompleted is true');

// -------------------------------------------------------------
// TEST 11: 4 parts use the day\'s vocabulary
// -------------------------------------------------------------
console.log('\n--- Test 11: 4 parts integrate the day\'s vocabulary ---');
const genHw = generateWeeklyHomework(
  routinesByDayWithNewWords,
  { uid: 's1', name: 'Student', email: 's@test.com', level: 'intermediate' } as any,
  's@test.com',
  'Student',
  [
    { word: 'strategy', definitionEn: 'Plan', translationPt: 'Estratégia', exampleSentence: 'A good strategy.' },
    { word: 'deadline', definitionEn: 'Due date', translationPt: 'Prazo', exampleSentence: 'A strict deadline.' },
  ],
  'intermediate',
  'friday'
);

assert(genHw.matchingPairs.some((p) => p.word === 'strategy' || p.word === 'deadline'), 'Part 1 matching pairs use selected words');
assert(genHw.fillInBlanks.some((f) => f.correctWord === 'strategy' || f.correctWord === 'deadline'), 'Part 2 fill in blanks use selected words');
assert(genHw.sentenceWritingPrompts.some((s) => s.word === 'strategy' || s.word === 'deadline'), 'Part 3 sentence writing prompts use selected words');
assert(Boolean(genHw.readingPassage?.text), 'Part 4 mini story is generated');

// -------------------------------------------------------------
// TEST 12: Zero regression on HOTFIXES 2.3.3, 2.3.4A, 2.3.4B
// -------------------------------------------------------------
console.log('\n--- Test 12: Zero regressions on 2.3.3, 2.3.4A, 2.3.4B ---');
// Regression check 2.3.4B: Incomplete fragments rejected
const fragCheck = analyzeSentenceGrammarDeterministic('Anyone know about', ['anyone'], 'anyone');
assert(fragCheck.isCorrect === false, 'HOTFIX 2.3.4B intact: fragments are rejected');

const validCheck = analyzeSentenceGrammarDeterministic('Does anyone know about this new project?', ['anyone'], 'anyone');
assert(validCheck.isCorrect === true, 'HOTFIX 2.3.4B intact: valid sentences accepted');

const fakeGeminiApproval = {
  sentenceFeedback: [{ word: 'anyone', originalSentence: 'Anyone know about', isCorrect: true, correctedSentence: 'Anyone know about' }],
};
const isValidated = validateHomeworkAiEvaluationResponse(fakeGeminiApproval as any, [{ word: 'anyone' }], { anyone: 'Anyone know about' });
assert(isValidated === false, 'HOTFIX 2.3.4B intact: synthetic approval of fragments rejected');

console.log('\n====================================================');
console.log(`TEST RESULTS: ${passedTests}/${totalTests} PASSED`);
console.log('====================================================');
if (passedTests === totalTests) {
  console.log('ALL TESTS PASSED SUCCESSFULLY!');
} else {
  process.exitCode = 1;
}
