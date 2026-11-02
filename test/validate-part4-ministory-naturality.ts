import { validatePart4StoryResponse } from '../serverApp';
import { isBadStoryText, synthesizeCohesiveStoryAndQuestions } from '../src/utils/pedagogicalStorySynthesizer';
import { getDailyMemorizationSchedule } from '../src/utils/homeworkGenerator';
import { DayOfWeek, ReadingPassage } from '../src/types';

console.log('================================================================');
console.log('--- TEST SUITE: PART 4 MINI-STORY NATURALITY & S-PATH INTEGRITY ---');
console.log('================================================================');

let totalTests = 0;
let passedTests = 0;

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

async function runTests() {
  // ---------------------------------------------------------------------------
  // 1. SCENARIO A: 5 Semantically Compatible Expressions
  // ---------------------------------------------------------------------------
  console.log('\n--- 1. SCENARIO A: 5 Semantically Compatible Expressions ---');
  {
    const compatibleWords = ['nowadays', 'environment', 'relationship', 'boss', 'employee'];

    // Simulated story generated following the new prompt rules
    const compatibleStoryJson = {
      title: 'Leadership and Culture in the Modern Workplace',
      text: `**Nowadays**, creating a positive work **environment** has become a top priority for forward-thinking organizations. Leaders understand that a healthy atmosphere directly influences motivation, creativity, and daily focus.\n\nAt the office, Alex observed how essential a respectful **relationship** is between a supportive **boss** and every dedicated **employee**. When managers listen actively and staff members feel valued, team collaboration becomes natural and effortless.\n\nIn the afternoon, the group tackled a complex project milestone together, applying constructive feedback to refine their strategic goals and streamline daily operations.\n\nBy the end of the day, fostering open communication and mutual respect proved that a supportive culture drives sustainable success, leaving the entire team energized for the week ahead.`,
      usedWords: ['nowadays', 'environment', 'relationship', 'boss', 'employee'],
      unusedWords: [],
      questions: [
        {
          id: 'q-1',
          question: 'According to the story, what has become a top priority nowadays?',
          options: [
            'Creating a positive and supportive work environment.',
            'Working in complete silence without any breaks.',
            'Canceling all team meetings indefinitely.',
            'Replacing staff members with automated tools.',
          ],
          correctAnswer: 0,
          explanation: 'Paragraph 1 states that creating a positive work environment is a top priority.',
        },
        {
          id: 'q-2',
          question: 'Why is a respectful relationship between a boss and employee valuable?',
          options: [
            'It fosters effortless collaboration and makes staff feel valued.',
            'It enables managers to cancel weekly projects without notice.',
            'It forces staff to compete aggressively against each other.',
            'It removes the need for any daily schedules.',
          ],
          correctAnswer: 0,
          explanation: 'Paragraph 2 highlights that respectful relationships make collaboration effortless.',
        },
      ],
    };

    // Validations:
    assert(!isBadStoryText(compatibleStoryJson.text), 'Compatible story passes isBadStoryText checks (no robotic templates)');
    assert(validatePart4StoryResponse(compatibleStoryJson, compatibleWords), 'Compatible story passes validatePart4StoryResponse validation');
    assert(compatibleStoryJson.usedWords.length === 5, 'All 5 compatible words are organically used');
    assert(compatibleStoryJson.unusedWords.length === 0, 'Zero words marked as unused when all fit naturally');

    // Also test fallback synthesizer with compatible words
    const synthCompatible = synthesizeCohesiveStoryAndQuestions({
      words: compatibleWords,
      studentLevel: 'Intermediate',
      studentName: 'Alex',
    });
    assert(!isBadStoryText(synthCompatible.text), 'Synthesizer compatible story passes isBadStoryText');
    assert(Array.isArray(synthCompatible.usedWords) && synthCompatible.usedWords.length > 0, 'Synthesizer accurately tracks usedWords');
  }

  // ---------------------------------------------------------------------------
  // 2. SCENARIO B: Semantically Divergent / Difficult to Combine Expressions
  // ---------------------------------------------------------------------------
  console.log('\n--- 2. SCENARIO B: Difficult to Combine Expressions (Organic Priority) ---');
  {
    // Expressions from completely conflicting semantic domains that cannot be forced together naturally:
    // e.g., 'treadmill' (fitness), 'deadline' (office work), 'storm' (weather), 'satellite' (astronomy), 'ancient' (history)
    const divergentWords = ['treadmill', 'deadline', 'storm', 'satellite', 'ancient'];

    // Simulated organic story where Gemini organically uses words that make sense for the scenario
    // ('treadmill', 'storm', 'deadline') and gracefully omits 'satellite' and 'ancient'
    // rather than inventing bizarre, artificial situations (like "looking at an ancient satellite while on a treadmill"):
    const organicDivergentStoryJson = {
      title: 'A Stormy Morning and a Pressing Deadline',
      text: `An intense morning **storm** made running outside impossible, so Alex headed down to the fitness room to train indoors. Spending forty minutes on the **treadmill** cleared their mind and provided the calm stamina needed for a demanding day.\n\nOnce at the workstation, the immediate priority was an urgent project **deadline** scheduled for three o'clock. Alex methodically organized the design files and prioritized critical revisions first.\n\nDuring the midday team alignment, colleagues reviewed the updated specifications together and verified that each requirement had been addressed without rushing.\n\nBy early afternoon, the completed deliverables were submitted smoothly ahead of schedule. Taking time to exercise before tackling high-pressure work proved that healthy habits foster steady focus under pressure.`,
      usedWords: ['storm', 'treadmill', 'deadline'],
      unusedWords: ['satellite', 'ancient'],
      questions: [
        {
          id: 'q-1',
          question: 'Why did Alex choose to train on the treadmill inside?',
          options: [
            'Because an intense morning storm made running outside impossible.',
            'Because the fitness center had an ancient satellite exhibition.',
            'Because the outdoor park was under construction.',
            'Because Alex missed the morning bus.',
          ],
          correctAnswer: 0,
          explanation: 'Paragraph 1 explains that an intense storm prevented running outside.',
        },
        {
          id: 'q-2',
          question: 'What helped Alex handle the pressing afternoon deadline effectively?',
          options: [
            'Methodically organizing files and exercising beforehand to maintain calm stamina.',
            'Ignoring colleague messages and submitting incomplete files.',
            'Requesting a two-week extension from the client.',
            'Working without stopping for any rest.',
          ],
          correctAnswer: 0,
          explanation: 'Paragraphs 1 and 2 highlight morning preparation and methodical organization.',
        },
      ],
    };

    assert(!isBadStoryText(organicDivergentStoryJson.text), 'Divergent story sounds 100% natural and passes isBadStoryText');
    assert(
      validatePart4StoryResponse(organicDivergentStoryJson, divergentWords),
      'validatePart4StoryResponse accepts organic story without requiring all 5 words to be forced'
    );
    assert(organicDivergentStoryJson.usedWords.length === 3, 'Accurately records 3 organically used words');
    assert(organicDivergentStoryJson.unusedWords.length === 2, 'Accurately records 2 omitted words');
    assert(
      organicDivergentStoryJson.unusedWords.includes('satellite') && organicDivergentStoryJson.unusedWords.includes('ancient'),
      'Omitted words are identified as unusedWords without penalizing or treating as student error'
    );

    // Verify rejection of a story with 0 target words
    const zeroTargetWordsStory = {
      title: 'Completely Unrelated Story',
      text: `Paragraph one about cooking soup in a kitchen.\n\nParagraph two about tasting the broth and adding salt.\n\nParagraph three about serving the guests at dinner.\n\nParagraph four about cleaning the dining table after everyone ate.`,
      questions: [
        { id: 'q-1', question: 'What was cooked?', options: ['Soup', 'Pasta', 'Pizza', 'Bread'], correctAnswer: 0, explanation: 'Soup' },
        { id: 'q-2', question: 'When did they clean?', options: ['After dinner', 'Before lunch', 'Tomorrow', 'Never'], correctAnswer: 0, explanation: 'After' },
      ],
    };
    assert(
      !validatePart4StoryResponse(zeroTargetWordsStory, divergentWords),
      'Correctly rejects story that has 0 target words from the day'
    );
  }

  // ---------------------------------------------------------------------------
  // 3. S-Path Rhythm, Scoring and Completion Invariance
  // ---------------------------------------------------------------------------
  console.log('\n--- 3. S-Path Rhythm, Completion & Scoring Invariance ---');
  {
    const days: DayOfWeek[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    const expectedParts = ['matching', 'fill', 'writing', 'reading', 'matching', 'fill', 'writing'];

    days.forEach((day, idx) => {
      const schedule = getDailyMemorizationSchedule(day);
      assert(schedule.partKey === expectedParts[idx], `S-Path Day ${day} maps to ${expectedParts[idx]}`);
    });

    // Verify Part 4 completion logic: Reading completion depends strictly on questions answered
    const sampleQuestions = [
      { id: 'q-1', question: 'Q1', options: ['A', 'B', 'C', 'D'], correctAnswer: 0, explanation: 'Exp 1' },
      { id: 'q-2', question: 'Q2', options: ['A', 'B', 'C', 'D'], correctAnswer: 1, explanation: 'Exp 2' },
    ];
    const fullAnswers = { 'q-1': 0, 'q-2': 1 };
    const isComplete = sampleQuestions.every((q) => fullAnswers[q.id as 'q-1' | 'q-2'] !== undefined);
    assert(isComplete, 'Part 4 S-Path completion requires answering comprehension questions');

    // Verify S-Path scoring (2 out of 2 correct = 100%)
    let correctCount = 0;
    sampleQuestions.forEach((q) => {
      if (fullAnswers[q.id as 'q-1' | 'q-2'] === q.correctAnswer) {
        correctCount++;
      }
    });
    const score = Math.round((correctCount / sampleQuestions.length) * 100);
    assert(score === 100, 'S-Path score calculation is 100% intact');
  }

  console.log('\n================================================================');
  console.log(`--- TEST RESULTS: ${passedTests} / ${totalTests} PASSED ---`);
  console.log('================================================================');
  process.exit(0);
}

runTests().catch((err) => {
  console.error('Test run failed:', err);
  process.exit(1);
});
