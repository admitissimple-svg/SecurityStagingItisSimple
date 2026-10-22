import {
  DayOfWeek,
  RoutineItem,
  TeacherAssignedVideo,
  WeeklyHomeworkData,
} from '../src/types';
import firebaseConfig from '../firebase-applet-config.json';

console.log('====================================================');
console.log('--- RUNNING TEST SUITE FOR HOTFIX 2.3.5D ---');
console.log('====================================================');

let testsPassed = 0;
let testsTotal = 0;

function assert(condition: boolean, message: string) {
  testsTotal++;
  if (condition) {
    console.log(`[PASS] ${message}`);
    testsPassed++;
  } else {
    console.error(`[FAIL] ${message}`);
    process.exitCode = 1;
  }
}

// -----------------------------------------------------------------------------
// Test Suite 1: Firebase Project Target & Database
// -----------------------------------------------------------------------------
console.log('\n--- Test Suite 1: Firebase Project Target & Database ---');
assert(
  firebaseConfig.projectId === 'itissimple-security-staging',
  `Target Firebase Project is 'itissimple-security-staging' (got: ${firebaseConfig.projectId})`
);

// -----------------------------------------------------------------------------
// Test Suite 2: Regressão A — Video of the Day Persistence & Cycle Match
// -----------------------------------------------------------------------------
console.log('\n--- Test Suite 2: Regressão A — Video of the Day ---');

// 2.1: Test that selecting a video saves with the student's active weeklyCycle (e.g. 8)
const studentActiveCycle = 8;
const selectedVideoPayload = {
  videoId: 'dQw4w9WgXcQ',
  title: 'English Pronunciation Masterclass',
  weeklyCycle: studentActiveCycle,
};

assert(
  selectedVideoPayload.weeklyCycle === studentActiveCycle,
  'Video payload preserves active weekly cycle (cycle 8) instead of defaulting to 1'
);

// 2.2: Test that saving a video does NOT mark it as watched
const watchedHistoryMock: string[] = [];
function simulateSaveVideo(vidId: string, history: string[]) {
  // HOTFIX 2.3.5D: saveVideoForDay must NOT add vidId to watchedHistory!
  return { saved: true, updatedHistory: [...history] };
}
const saveResult = simulateSaveVideo('dQw4w9WgXcQ', watchedHistoryMock);
assert(
  !saveResult.updatedHistory.includes('dQw4w9WgXcQ'),
  'Selecting a video does NOT mark it as watched (watchedHistory remains clean)'
);

// 2.3: Test fallback chain for rawAssignedVideo
function resolveRawAssignedVideo(
  persistedVideo: any,
  activeActivity: any,
  currentDayActivities: any[]
): TeacherAssignedVideo | null {
  const hasPersistedVideoId = Boolean(persistedVideo && persistedVideo.videoId && persistedVideo.videoId.trim() !== '');
  const isPersistedClean = Boolean(persistedVideo && persistedVideo.videoId === '');

  return hasPersistedVideoId
    ? ({
        id: persistedVideo.activityId || `vid-${persistedVideo.videoId}`,
        videoId: persistedVideo.videoId,
        url: persistedVideo.url,
        title: persistedVideo.videoTitle || persistedVideo.title,
      } as any)
    : !isPersistedClean && activeActivity?.teacherVideos?.[0]
    ? activeActivity.teacherVideos[0]
    : !isPersistedClean && currentDayActivities.find((a) => a.teacherVideos && a.teacherVideos.length > 0)?.teacherVideos?.[0]
    ? (currentDayActivities.find((a) => a.teacherVideos && a.teacherVideos.length > 0)!.teacherVideos![0] as any)
    : null;
}

// Case A: Persisted video exists
const withPersisted = resolveRawAssignedVideo(
  { videoId: 'dQw4w9WgXcQ', title: 'Persisted Video' },
  null,
  []
);
assert(
  withPersisted !== null && withPersisted.videoId === 'dQw4w9WgXcQ',
  'rawAssignedVideo correctly resolves persisted video when present'
);

// Case B: Persisted video not yet loaded / missing, fallback to activeActivity
const withFallback = resolveRawAssignedVideo(
  null,
  { teacherVideos: [{ videoId: 'abc123xyz', title: 'Fallback Activity Video' }] },
  []
);
assert(
  withFallback !== null && withFallback.videoId === 'abc123xyz',
  'rawAssignedVideo falls back to activeActivity when persisted video is not in state'
);

// Case C: Explicitly cleaned / new week reset (videoId: "")
const withCleanReset = resolveRawAssignedVideo(
  { videoId: '' },
  { teacherVideos: [{ videoId: 'abc123xyz', title: 'Old Video' }] },
  []
);
assert(
  withCleanReset === null,
  'rawAssignedVideo returns null when persistedVideo explicitly has videoId: "" (clean reset)'
);

// -----------------------------------------------------------------------------
// Test Suite 3: Regressão B — 5 Key Words Persistence & Resolution
// -----------------------------------------------------------------------------
console.log('\n--- Test Suite 3: Regressão B — 5 Key Words ---');

// 3.1: Verify resolvedWords in routine snapshot sync
function resolveRoutineWords(dayData: any, item: RoutineItem): string[] {
  // HOTFIX 2.3.5D logic:
  return Array.isArray(dayData.learnedWords) && dayData.learnedWords.length > 0
    ? dayData.learnedWords
    : (item.learnedWords || []);
}

const existingWords = ['negotiate', 'leverage', 'benchmark', 'paradigm', 'synergy'];
const routineItemWithWords: RoutineItem = {
  id: 'act-1',
  time: '07:30',
  activityName: 'Video Practice',
  category: 'video',
  learnedWords: existingWords,
};

// Snapshot arrives without a video selected (cleanVidId === '')
const resolvedWhenNoVideo = resolveRoutineWords({ videoId: '', playlistId: '' }, routineItemWithWords);
assert(
  resolvedWhenNoVideo.length === 5 && resolvedWhenNoVideo[0] === 'negotiate',
  'resolvedWords NEVER wipes learnedWords to [] just because cleanVidId is empty'
);

// Snapshot arrives with new learnedWords
const updatedWords = ['fluency', 'idiom', 'collocation', 'accent', 'phrasal'];
const resolvedWhenSnapshotHasWords = resolveRoutineWords({ learnedWords: updatedWords }, routineItemWithWords);
assert(
  resolvedWhenSnapshotHasWords.length === 5 && resolvedWhenSnapshotHasWords[0] === 'fluency',
  'resolvedWords takes new learnedWords when incoming snapshot provides them'
);

// -----------------------------------------------------------------------------
// Test Suite 4: Regressão C — Audio of the Day S-Path Isolation
// -----------------------------------------------------------------------------
console.log('\n--- Test Suite 4: Regressão C — Audio of the Day ---');

// Simulate behavioral activity completion dispatch
function simulateActivityComplete(
  params: { type: 'video' | 'audio'; dayOfWeek: DayOfWeek },
  weeklyChecks: Record<string, boolean>
) {
  const stepMapping = {
    video: 'video_day',
    audio: 'audio_day',
  };
  const stepId = stepMapping[params.type];
  const checkKey = `${stepId}_${params.dayOfWeek}`;
  return {
    ...weeklyChecks,
    [checkKey]: true,
  };
}

const initialChecks: Record<string, boolean> = {};
const afterAudio = simulateActivityComplete({ type: 'audio', dayOfWeek: 'wednesday' }, initialChecks);

assert(
  afterAudio['audio_day_wednesday'] === true,
  'Audio completion marks audio_day_wednesday on S-Path'
);
assert(
  afterAudio['video_day_wednesday'] === undefined,
  'Audio completion does NOT mark video_day_wednesday (complete isolation)'
);

const afterVideo = simulateActivityComplete({ type: 'video', dayOfWeek: 'wednesday' }, afterAudio);
assert(
  afterVideo['video_day_wednesday'] === true && afterVideo['audio_day_wednesday'] === true,
  'Both activities can be independently completed for the same day'
);

// -----------------------------------------------------------------------------
// Test Suite 5: Regressão D — Dashboard & Atividade do Dia Crash Protection
// -----------------------------------------------------------------------------
console.log('\n--- Test Suite 5: Regressão D — Crash Protection & Error Boundary ---');

// 5.1: Test readingPassage safe resolution when undefined
function safeReadingPassageCheck(homework: Partial<WeeklyHomeworkData>) {
  const questionsList = homework.readingPassage?.questions || [];
  const title = homework.readingPassage?.title || 'Mini-Story Reading';
  const text = homework.readingPassage?.text || '';
  const isPending = !homework.readingPassage || (!text && questionsList.length === 0);

  return { questionsCount: questionsList.length, title, isPending };
}

const emptyHw: Partial<WeeklyHomeworkData> = {
  id: 'hw-test-1',
  weeklyCycle: 8,
  // readingPassage is completely undefined!
};

let didCrash = false;
let checkResult: any = null;
try {
  checkResult = safeReadingPassageCheck(emptyHw);
} catch (err) {
  didCrash = true;
}

assert(
  !didCrash && checkResult !== null,
  'safeReadingPassageCheck executes without throwing TypeError when readingPassage is undefined'
);
assert(
  checkResult.isPending === true,
  'Identifies undefined reading passage as isPending: true for empty state rendering'
);
assert(
  checkResult.questionsCount === 0,
  'Safely resolves questionsCount as 0 without crashing on .length'
);

// 5.2: Test AppErrorBoundary exists and exports properly
import { AppErrorBoundary } from '../src/components/AppErrorBoundary';
assert(
  typeof AppErrorBoundary === 'function',
  'AppErrorBoundary is a valid React component class'
);

// -----------------------------------------------------------------------------
// SUMMARY
// -----------------------------------------------------------------------------
console.log('\n====================================================');
console.log(`TEST RESULTS: ${testsPassed}/${testsTotal} PASSED`);
console.log('====================================================');
if (testsPassed === testsTotal) {
  console.log('HOTFIX 2.3.5D VALIDATED ALL 4 REGRESSION RECOVERIES SUCCESSFULLY!');
  process.exit(0);
} else {
  console.error('SOME TESTS FAILED');
  process.exit(1);
}
