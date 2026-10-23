import {
  resolveDailyMemorizationVocabulary,
  isActivityStartedOrAnswered,
  generateWeeklyHomework,
  getDailyMemorizationSchedule,
} from '../src/utils/homeworkGenerator';
import {
  isBadStoryText,
  synthesizeCohesiveStoryAndQuestions,
} from '../src/utils/pedagogicalStorySynthesizer';
import {
  DayOfWeek,
  RoutineItem,
  WeeklyHomeworkData,
  DailyHomeworkActivity,
} from '../src/types';

console.log('================================================================');
console.log('--- TEST SUITE: HOTFIX 2.3.5K — CONTEXTUAL AI MINI-STORY GENERATION (PART 4 ONLY) ---');
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

async function runAllTests() {
  // ---------------------------------------------------------------------------
  // Category 1: Flawed Robotic Template Detection (isBadStoryText)
  // ---------------------------------------------------------------------------
  console.log('\n--- Category 1: Detection of Flawed Robotic Templates ---');
  {
    const flawedStory1 = `The project breakthrough was clear.\n\nThe working session began with clear intention as Alex collaborated closely with colleagues to need every detail with precision.\n\nDuring the core phase of the sprint, the team focused on managing all tasks.\n\nBefore wrapping up the day, celebrating the successful delivery of the small provided genuine momentum for tomorrow.`;
    assert(isBadStoryText(flawedStory1), 'Detects "to need every detail" and "delivery of the small" formulaic slop');

    const flawedStory2 = `In the YouTube video, the presenter explained how to make coffee.\n\nThe video showed the entire preparation process step by step.\n\nAs seen in the video clip, the barista used fresh milk and hot water.\n\nFinally, the student watched the video until the end of the lesson.`;
    assert(isBadStoryText(flawedStory2), 'Detects fake video claims ("in the youtube video", "the video showed", "watched the video")');

    const shortStory = `First paragraph here.\n\nSecond paragraph here.\n\nThird paragraph here.`;
    assert(isBadStoryText(shortStory), 'Rejects stories with fewer than 4 paragraphs');

    const valid4ParagraphStory = `Alex arrived at the office early to prepare the presentation before the morning briefing began. The quiet room gave them the time needed to organize their speaking notes and test the projector with great care.\n\nDuring the meeting, the client listened attentively to the proposal and asked clear questions about the budget. Everyone agreed that a small pilot phase would reduce risk while demonstrating measurable progress.\n\nAfter lunch, the project team gathered in the workshop area to build the first prototype. Collaborating across departments helped surface practical solutions that nobody had anticipated earlier in the week.\n\nBy late afternoon, the milestones had been verified and recorded in the team tracker. Taking time to celebrate each completed step created a shared sense of accomplishment and renewed energy for the days ahead.`;
    assert(!isBadStoryText(valid4ParagraphStory), 'Accepts authentic cohesive 4-paragraph story without robotic slots');
  }

  // ---------------------------------------------------------------------------
  // Category 2: Friday 5 Words & Vocabulary Priority Preservation
  // ---------------------------------------------------------------------------
  console.log('\n--- Category 2: 5 Words of the Day & Vocabulary Priority ---');
  {
    const routines: Record<DayOfWeek, RoutineItem[]> = {
      monday: [{ id: 'm1', time: '08:00', activityName: 'Routine', learnedWords: ['apple', 'banana', 'orange', 'grape', 'lemon'] }],
      tuesday: [],
      wednesday: [],
      thursday: [{
        id: 'th1',
        time: '14:00',
        activityName: 'Thursday Reading Session',
        learnedWords: ['need', 'small', 'schedule', 'review', 'confident'],
        teacherVideos: [{
          id: 'v1',
          videoId: 'vid-coffee-123',
          title: 'Specialty Coffee Craftsmanship & Daily Rituals',
          url: 'https://youtube.com/watch?v=vid-coffee-123',
          instructions: 'Notice the brewing technique and morning routine vocabulary.',
        }],
      }],
      friday: [{ id: 'f1', time: '09:00', activityName: 'Friday Wrap', learnedWords: ['deliver', 'milestone', 'awesome', 'client', 'finish'] }],
      saturday: [],
      sunday: [],
    };

    const resolvedThursday = resolveDailyMemorizationVocabulary({
      targetDay: 'thursday',
      routinesByDay: routines,
      studentUid: 'student-123',
    });

    assert(resolvedThursday.length === 5, 'Thursday resolves exactly 5 words');
    const thWords = resolvedThursday.map((w) => w.word.toLowerCase());
    assert(thWords.includes('need') && thWords.includes('small'), 'Thursday contains "need" and "small"');
  }

  // ---------------------------------------------------------------------------
  // Category 3: Preservation Across F5 Page Refreshes (Zero Overwrite)
  // ---------------------------------------------------------------------------
  console.log('\n--- Category 3: Preservation Across F5 Refreshes ---');
  {
    const savedAiPassage = {
      title: 'A Careful Morning at the Studio',
      text: `Alex arrived at the studio early to test the new recording equipment before the client session began. The calm room gave them the quiet space they needed to adjust audio levels and prepare their script.\n\nDuring the rehearsal, a small error in the playback track was quickly detected and corrected. Everyone agreed that catching the issue early saved hours of re-recording later in the afternoon.\n\nBy midday, the creative team aligned on the production schedule and confirmed all scene deliverables. Working methodically through each task ensured that no detail was overlooked.\n\nBefore wrapping up the day, the team reviewed the final mix with genuine pride. Completing the project ahead of the deadline left everyone feeling confident and ready for the next campaign.`,
      questions: [
        {
          id: 'q-1',
          question: 'Why did Alex arrive at the studio early?',
          options: ['To test recording equipment', 'To clean the office', 'To meet the client', 'To drink coffee'],
          correctAnswer: 0,
          explanation: 'Paragraph 1 states Alex tested equipment before the session.',
        },
        {
          id: 'q-2',
          question: 'What issue was resolved during the rehearsal?',
          options: ['A missing microphone', 'A small playback error', 'A broken camera', 'A delayed script'],
          correctAnswer: 1,
          explanation: 'Paragraph 2 notes a small error in the playback track was corrected.',
        },
      ],
      isAiGenerated: true,
    };

    const existingDailyActivities: Record<string, any> = {
      thursday: {
        id: 'hw-thursday-1',
        day: 'thursday',
        weeklyCycle: 1,
        studentUid: 'student-alex',
        selectedWords: [
          { word: 'need', definitionEn: 'to require something essential', translationPt: 'precisar', exampleSentence: '' },
          { word: 'small', definitionEn: 'not large in size or scale', translationPt: 'pequeno', exampleSentence: '' },
          { word: 'schedule', definitionEn: 'a planned timetable', translationPt: 'cronograma', exampleSentence: '' },
          { word: 'review', definitionEn: 'to examine carefully', translationPt: 'revisar', exampleSentence: '' },
          { word: 'confident', definitionEn: 'feeling sure about abilities', translationPt: 'confiante', exampleSentence: '' },
        ],
        readingPassage: savedAiPassage,
        isStarted: false,
        isCompleted: false,
      },
    };

    const emptyRoutines: Record<DayOfWeek, RoutineItem[]> = {
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

    const generated = generateWeeklyHomework(
      emptyRoutines,
      { id: 'student-alex', weeklyCycle: 1, level: 'Intermediate' } as any,
      'alex@example.com',
      'Alex',
      undefined,
      'Intermediate',
      'thursday',
      undefined,
      existingDailyActivities
    );

    assert(
      generated.readingPassage?.text === savedAiPassage.text,
      'Preserves existing AI-generated story across F5 refresh instead of overwriting'
    );
    assert(
      generated.readingPassage?.isAiGenerated === true,
      'Maintains isAiGenerated flag across F5 refresh'
    );
  }

  // ---------------------------------------------------------------------------
  // Category 4: Answered Activity Protection (Zero Loss)
  // ---------------------------------------------------------------------------
  console.log('\n--- Category 4: Answered Activity Protection ---');
  {
    const answeredActivity: any = {
      id: 'hw-thursday-cycle-1',
      day: 'thursday',
      weeklyCycle: 1,
      studentUid: 'student-maria',
      studentAnswers: {
        quizAnswers: { 'q-1': 0, 'q-2': 1 },
      },
      readingPassage: {
        title: 'Original Student Story',
        text: 'Existing story text\n\nSecond paragraph\n\nThird paragraph\n\nFourth paragraph',
        questions: [
          { id: 'q-1', question: 'Q1?', options: ['A', 'B'], correctAnswer: 0, explanation: 'Exp 1' },
          { id: 'q-2', question: 'Q2?', options: ['A', 'B'], correctAnswer: 1, explanation: 'Exp 2' },
        ],
        isAiGenerated: true,
      },
      partsProgress: {
        reading: {
          partKey: 'reading',
          partNumber: 4,
          status: 'completed',
          answers: { 'q-1': 0, 'q-2': 1 },
          score: 100,
          updatedAt: new Date().toISOString(),
        },
      },
      isStarted: true,
      isCompleted: true,
    };

    assert(
      isActivityStartedOrAnswered(answeredActivity),
      'isActivityStartedOrAnswered accurately flags student with submitted quiz answers'
    );
  }

  // ---------------------------------------------------------------------------
  // Category 5: Student and Cycle Isolation
  // ---------------------------------------------------------------------------
  console.log('\n--- Category 5: Student and Cycle Isolation ---');
  {
    const routinesCycle1: Record<DayOfWeek, RoutineItem[]> = {
      monday: [], tuesday: [], wednesday: [],
      thursday: [{
        id: 'act-th-c1',
        time: '10:00',
        activityName: 'Office Routine',
        learnedWords: ['boss', 'meeting', 'budget', 'urgent', 'reply'],
      }],
      friday: [], saturday: [], sunday: [],
    };

    const routinesCycle2: Record<DayOfWeek, RoutineItem[]> = {
      monday: [], tuesday: [], wednesday: [],
      thursday: [{
        id: 'act-th-c2',
        time: '10:00',
        activityName: 'Travel Routine',
        learnedWords: ['flight', 'passport', 'luggage', 'hotel', 'ticket'],
      }],
      friday: [], saturday: [], sunday: [],
    };

    const resolvedC1 = resolveDailyMemorizationVocabulary({
      targetDay: 'thursday',
      routinesByDay: routinesCycle1,
      studentUid: 'student-cycle-test',
    });

    const resolvedC2 = resolveDailyMemorizationVocabulary({
      targetDay: 'thursday',
      routinesByDay: routinesCycle2,
      studentUid: 'student-cycle-test',
    });

    const wordsC1 = resolvedC1.map((w) => w.word);
    const wordsC2 = resolvedC2.map((w) => w.word);

    assert(wordsC1.includes('boss') && !wordsC1.includes('flight'), 'Cycle 1 keeps its own vocabulary');
    assert(wordsC2.includes('flight') && !wordsC2.includes('boss'), 'Cycle 2 keeps its own vocabulary with zero cross-cycle bleed');
  }

  // ---------------------------------------------------------------------------
  // Category 6: S-Path Rhythm Preservation (P1, P2, P3, P4, P1, P2, P3)
  // ---------------------------------------------------------------------------
  console.log('\n--- Category 6: S-Path Rhythm Unchanged ---');
  {
    const schedMon = getDailyMemorizationSchedule('monday');
    const schedTue = getDailyMemorizationSchedule('tuesday');
    const schedWed = getDailyMemorizationSchedule('wednesday');
    const schedThu = getDailyMemorizationSchedule('thursday');
    const schedFri = getDailyMemorizationSchedule('friday');
    const schedSat = getDailyMemorizationSchedule('saturday');
    const schedSun = getDailyMemorizationSchedule('sunday');

    assert(schedMon.partKey === 'matching' && schedMon.partNumber === 1, 'Monday is Part 1 (matching)');
    assert(schedTue.partKey === 'fill' && schedTue.partNumber === 2, 'Tuesday is Part 2 (fill)');
    assert(schedWed.partKey === 'writing' && schedWed.partNumber === 3, 'Wednesday is Part 3 (writing)');
    assert(schedThu.partKey === 'reading' && schedThu.partNumber === 4, 'Thursday is Part 4 (reading)');
    assert(schedFri.partKey === 'matching' && schedFri.partNumber === 1, 'Friday is Part 1 (matching)');
    assert(schedSat.partKey === 'fill' && schedSat.partNumber === 2, 'Saturday is Part 2 (fill)');
    assert(schedSun.partKey === 'writing' && schedSun.partNumber === 3, 'Sunday is Part 3 (writing)');
  }

  console.log('\n================================================================');
  console.log(`--- TEST RESULTS: ${passedTests} / ${totalTests} PASSED ---`);
  console.log('================================================================');
}

runAllTests().catch((err) => {
  console.error('Unhandled error in test runner:', err);
  process.exit(1);
});
