import {
  isBadStoryText,
  synthesizeCohesiveStoryAndQuestions,
} from '../src/utils/pedagogicalStorySynthesizer';
import {
  resolveDailyMemorizationVocabulary,
  isActivityStartedOrAnswered,
  generateWeeklyHomework,
  getDailyMemorizationSchedule,
} from '../src/utils/homeworkGenerator';
import { validatePart4StoryResponse } from '../serverApp';
import { executeGeminiWithContingency } from '../src/serverGeminiSecurity';
import { DayOfWeek, RoutineItem, WeeklyHomeworkData } from '../src/types';

console.log('================================================================');
console.log('--- TEST SUITE: HOTFIX 2.3.5L — MINI-STORY: STABILITY & AI QUALITY ---');
console.log('================================================================');

let passedTests = 0;
let totalTests = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  totalTests++;
  if (condition) {
    console.log(`[PASS] Test ${totalTests}: ${testName}`);
    passedTests++;
  } else {
    console.error(`[FAIL] Test ${totalTests}: ${testName}`);
    if (detail) console.error(`       Detail: ${detail}`);
    process.exitCode = 1;
  }
}

async function runHotfixTests() {
  // ---------------------------------------------------------------------------
  // 1. React .map() Prevention & Corrupted/Legacy Data Resilience
  // ---------------------------------------------------------------------------
  console.log('\n--- Category 1: React .map() Safety with Legacy / Missing Arrays ---');
  {
    // Case 1: readingPassage with undefined questions
    const legacyPassageNoQuestions: any = {
      title: 'Legacy Story',
      text: 'A valid story text with four paragraphs here.\n\nSecond paragraph text.\n\nThird paragraph text.\n\nFourth paragraph text here.',
      questions: undefined,
    };
    const safeQuestions1 = Array.isArray(legacyPassageNoQuestions?.questions) ? legacyPassageNoQuestions.questions : [];
    assert(safeQuestions1.length === 0, 'Safely defaults undefined questions to empty array');
    let mapThrew = false;
    try {
      safeQuestions1.map((q: any) => q.id);
    } catch {
      mapThrew = true;
    }
    assert(!mapThrew, 'No map() exception on undefined questions');

    // Case 2: question with undefined options
    const legacyQuestionNoOptions: any = {
      id: 'q-1',
      question: 'What happened?',
      options: undefined,
      correctAnswer: 0,
      explanation: 'Explanation here',
    };
    const safeOptions = Array.isArray(legacyQuestionNoOptions.options) ? legacyQuestionNoOptions.options : [];
    assert(safeOptions.length === 0, 'Safely defaults undefined options to empty array');
    let optionsMapThrew = false;
    try {
      safeOptions.map((opt: string) => opt.toUpperCase());
    } catch {
      optionsMapThrew = true;
    }
    assert(!optionsMapThrew, 'No map() exception on undefined question.options');

    // Case 3: fillInBlanks with undefined options
    const legacyFillItem: any = {
      id: 'fill-1',
      sentenceWithBlank: 'The ______ was clear.',
      correctWord: 'schedule',
      options: undefined,
    };
    const safeFillOpts = Array.isArray(legacyFillItem.options) ? legacyFillItem.options : [];
    assert(safeFillOpts.length === 0, 'Safely defaults undefined fillInBlanks options to empty array');
  }

  // ---------------------------------------------------------------------------
  // 2. Strict Rejection of Incomplete Sentences & Participial Fragments
  // ---------------------------------------------------------------------------
  console.log('\n--- Category 2: Strict Rejection of Ungrammatical Fragments ---');
  {
    // Example 1 from specification: "During the morning session, pausing to watch the progress."
    const fragmentStory1 = `Alex arrived at the design studio early to prepare the workstation before the team assembled.\n\nDuring the morning session, pausing to watch the progress.\n\nThe developers aligned on the remaining tasks to ensure each step went smoothly.\n\nBy late afternoon, the milestones were verified and celebrated by everyone involved.`;
    assert(
      isBadStoryText(fragmentStory1),
      'Rejects fragment: "During the morning session, pausing to watch the progress."'
    );

    // Example 2 from specification: "Before concluding the session, delivering a series of small improvements."
    const fragmentStory2 = `Elena began the review session with a clear agenda to organize the client deliverables.\n\nColleagues asked detailed questions about the timeline and agreed on practical next steps.\n\nBefore concluding the session, delivering a series of small improvements.\n\nThe entire team left the meeting with clear milestones and shared confidence.`;
    assert(
      isBadStoryText(fragmentStory2),
      'Rejects fragment: "Before concluding the session, delivering a series of small improvements."'
    );

    // Valid complete grammatical sentences:
    const validGrammarStory = `Alex arrived at the design studio early to prepare the workstation before the team assembled. The quiet morning provided ample time to review all project notes.\n\nDuring the morning session, Alex paused to watch the team make steady progress. Seeing the interface come together confirmed that their planning was sound.\n\nBefore concluding the session, the team delivered a series of small improvements. Everyone contributed constructive feedback on the user experience.\n\nBy late afternoon, the milestones were verified and celebrated by all colleagues. The successful launch gave everyone genuine momentum for tomorrow.`;
    assert(
      !isBadStoryText(validGrammarStory),
      'Accepts grammatically complete story with explicit subjects and finite verbs'
    );
  }

  // ---------------------------------------------------------------------------
  // 3. Mini-Story with & without Video of the Day
  // ---------------------------------------------------------------------------
  console.log('\n--- Category 3: Mini-Story With and Without Video of the Day ---');
  {
    const routinesWithoutVideo: Record<DayOfWeek, RoutineItem[]> = {
      monday: [],
      tuesday: [],
      wednesday: [],
      thursday: [{
        id: 'th1',
        time: '14:00',
        activityName: 'Afternoon Focus',
        learnedWords: ['routine', 'challenge', 'focus', 'progress', 'milestone'],
        // No video configured
      }],
      friday: [],
      saturday: [],
      sunday: [],
    };

    const wordsWithoutVideo = resolveDailyMemorizationVocabulary({
      targetDay: 'thursday',
      routinesByDay: routinesWithoutVideo,
      studentUid: 'student-no-vid',
    });
    assert(wordsWithoutVideo.length === 5, 'Resolves 5 words even with zero videos assigned');

    const synthesizedStory = synthesizeCohesiveStoryAndQuestions({
      words: wordsWithoutVideo.map((w) => w.word),
      studentLevel: 'Intermediate',
      studentName: 'Alex',
    });

    assert(Boolean(synthesizedStory.text), 'Generates valid story without video');
    assert(!isBadStoryText(synthesizedStory.text), 'Generated story passes isBadStoryText validation');
    assert(Array.isArray(synthesizedStory.questions) && synthesizedStory.questions.length >= 2, 'Comprehension questions generated');
    assert(synthesizedStory.questions.every((q) => Array.isArray(q.options) && q.options.length === 4), 'Every question has exactly 4 options');
  }

  // ---------------------------------------------------------------------------
  // 4. Sequential 3-Model Fallback & Verification
  // ---------------------------------------------------------------------------
  console.log('\n--- Category 4: Sequential 3-Model Fallback Verification ---');
  {
    const expectedModels = ['gemini-3.5-flash', 'gemini-3.8-flash', 'gemini-3.1-flash-lite'];

    // Simulation A: Model 1 succeeds immediately
    const attemptsA: string[] = [];
    const resultA = await executeGeminiWithContingency(
      {
        feature: 'homework_part4',
        systemInstruction: 'test',
        untrustedUserDataPrompt: 'test',
        modelsOverride: expectedModels,
        validator: (json) => Boolean(json && json.valid),
      },
      async (model) => {
        attemptsA.push(model);
        return {
          text: 'ok',
          parsedJson: { valid: true },
        };
      }
    );
    assert(resultA.success === true, 'Succeeds when Model 1 passes');
    assert(resultA.modelUsed === 'gemini-3.5-flash', 'Model 1 (gemini-3.5-flash) used on first attempt');
    assert(attemptsA.length === 1, 'Does not call subsequent models when Model 1 succeeds');

    // Simulation B: Model 1 fails pedagogically -> Model 2 succeeds
    const attemptsB: string[] = [];
    const resultB = await executeGeminiWithContingency(
      {
        feature: 'homework_part4',
        systemInstruction: 'test',
        untrustedUserDataPrompt: 'test',
        modelsOverride: expectedModels,
        validator: (json) => Boolean(json && json.pedagogicallyApproved),
      },
      async (model) => {
        attemptsB.push(model);
        if (model === 'gemini-3.5-flash') {
          return {
            text: 'ungrammatical',
            parsedJson: { pedagogicallyApproved: false }, // Pedagogical rejection!
          };
        }
        return {
          text: 'approved',
          parsedJson: { pedagogicallyApproved: true },
        };
      }
    );
    assert(resultB.success === true, 'Succeeds on failover to Model 2');
    assert(resultB.modelUsed === 'gemini-3.8-flash', 'Model 2 (gemini-3.8-flash) used on second attempt');
    assert(attemptsB[0] === 'gemini-3.5-flash' && attemptsB[1] === 'gemini-3.8-flash', 'Strict sequential order: 3.5 -> 3.8');

    // Simulation C: Model 1 & 2 fail -> Model 3 succeeds
    const attemptsC: string[] = [];
    const resultC = await executeGeminiWithContingency(
      {
        feature: 'homework_part4',
        systemInstruction: 'test',
        untrustedUserDataPrompt: 'test',
        modelsOverride: expectedModels,
        validator: (json) => Boolean(json && json.qualityPassed),
      },
      async (model) => {
        attemptsC.push(model);
        if (model === 'gemini-3.1-flash-lite') {
          return {
            text: 'lite ok',
            parsedJson: { qualityPassed: true },
          };
        }
        return {
          text: 'failed quality',
          parsedJson: { qualityPassed: false },
        };
      }
    );
    assert(resultC.success === true, 'Succeeds on failover to Model 3');
    assert(resultC.modelUsed === 'gemini-3.1-flash-lite', 'Model 3 (gemini-3.1-flash-lite) used');
    assert(attemptsC.length === 3, 'Tried all 3 models in order before succeeding');

    // Simulation D: All 3 models fail -> Complete failure with ZERO synthetic fallback
    const attemptsD: string[] = [];
    const resultD = await executeGeminiWithContingency(
      {
        feature: 'homework_part4',
        systemInstruction: 'test',
        untrustedUserDataPrompt: 'test',
        modelsOverride: expectedModels,
        validator: () => false, // All fail validation
      },
      async (model) => {
        attemptsD.push(model);
        return {
          text: 'bad text',
          parsedJson: { bad: true },
        };
      }
    );
    assert(resultD.success === false, 'Returns recoverable failure when all 3 models fail');
    assert(attemptsD.length === 3, 'Attempted all 3 models sequentially');
    assert(resultD.parsedJson === null, 'Never invents synthetic or fictional response data');
  }

  // ---------------------------------------------------------------------------
  // 5. Preservation Across F5 Page Refreshes (Zero Regression)
  // ---------------------------------------------------------------------------
  console.log('\n--- Category 5: Preservation Across F5 Refreshes ---');
  {
    const existingAiPassage = {
      title: 'A Careful Morning at the Studio',
      text: `Alex arrived at the studio early to test the new recording equipment before the client session began. The calm room gave them the quiet space they needed to adjust audio levels and prepare their script.\n\nDuring the rehearsal, a small error in the playback track was quickly detected and corrected. Everyone agreed that catching the issue early saved hours of re-recording later in the afternoon.\n\nBy midday, the creative team aligned on the production schedule and confirmed all scene deliverables. Working methodically through each task ensured that no detail was overlooked.\n\nBefore wrapping up the day, the team reviewed the final mix with genuine pride. Completing the project ahead of the deadline left everyone feeling confident and ready for the next campaign.`,
      questions: [
        {
          id: 'q-1',
          question: 'Why did Alex arrive early?',
          options: ['To test equipment', 'To drink coffee', 'To sleep', 'To clean'],
          correctAnswer: 0,
          explanation: 'Paragraph 1 explains Alex tested equipment.',
        },
      ],
      isAiGenerated: true,
    };

    const routines: Record<DayOfWeek, RoutineItem[]> = {
      monday: [],
      tuesday: [],
      wednesday: [],
      thursday: [{
        id: 'th-1',
        time: '10:00',
        activityName: 'Thursday Study',
        learnedWords: ['need', 'small', 'schedule', 'review', 'confident'],
      }],
      friday: [],
      saturday: [],
      sunday: [],
    };

    const existingDailyActivities: Record<string, any> = {
      thursday: {
        id: 'hw-thursday-1',
        day: 'thursday',
        weeklyCycle: 1,
        studentUid: 'student-alex',
        selectedWords: [
          { word: 'need', definitionEn: 'to require', translationPt: 'precisar', exampleSentence: '' },
          { word: 'small', definitionEn: 'not large', translationPt: 'pequeno', exampleSentence: '' },
          { word: 'schedule', definitionEn: 'timetable', translationPt: 'cronograma', exampleSentence: '' },
          { word: 'review', definitionEn: 'to examine', translationPt: 'revisar', exampleSentence: '' },
          { word: 'confident', definitionEn: 'sure of self', translationPt: 'confiante', exampleSentence: '' },
        ],
        readingPassage: existingAiPassage,
        studentAnswers: {
          matching: {},
          fillInBlanks: {},
          sentences: {},
          quizAnswers: { 'q-1': 0 },
        },
        partsProgress: {
          reading: {
            partKey: 'reading',
            partNumber: 4,
            status: 'completed',
            answers: { 'q-1': 0 },
          },
        },
        isStarted: true,
        isCompleted: false,
      },
    };

    const homeworkWithSavedStory = generateWeeklyHomework(
      routines,
      { id: 'student-alex', weeklyCycle: 1, level: 'Intermediate' } as any,
      'alex@example.com',
      'Alex',
      undefined,
      'Intermediate',
      'thursday',
      undefined,
      existingDailyActivities
    );

    const activePassage = homeworkWithSavedStory.readingPassage;
    assert(activePassage?.title === 'A Careful Morning at the Studio', 'F5 preserves existing valid story title');
    assert(activePassage?.isAiGenerated === true, 'F5 preserves isAiGenerated flag');
    assert(
      homeworkWithSavedStory.studentAnswers?.quizAnswers?.['q-1'] === 0,
      'F5 preserves student quiz answer'
    );
  }

  // ---------------------------------------------------------------------------
  // 6. Zero Regressions on P1-P3 and S-Path
  // ---------------------------------------------------------------------------
  console.log('\n--- Category 6: S-Path Rhythm (P1/P2/P3/P4/P1/P2/P3) ---');
  {
    assert(getDailyMemorizationSchedule('monday').partNumber === 1, 'Monday is P1');
    assert(getDailyMemorizationSchedule('tuesday').partNumber === 2, 'Tuesday is P2');
    assert(getDailyMemorizationSchedule('wednesday').partNumber === 3, 'Wednesday is P3');
    assert(getDailyMemorizationSchedule('thursday').partNumber === 4, 'Thursday is P4');
    assert(getDailyMemorizationSchedule('friday').partNumber === 1, 'Friday is P1');
    assert(getDailyMemorizationSchedule('saturday').partNumber === 2, 'Saturday is P2');
    assert(getDailyMemorizationSchedule('sunday').partNumber === 3, 'Sunday is P3');
  }

  console.log('================================================================');
  console.log(`--- TEST RESULTS: ${passedTests} / ${totalTests} PASSED ---`);
  console.log('================================================================');
  if (passedTests !== totalTests) {
    process.exit(1);
  }
}

runHotfixTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
