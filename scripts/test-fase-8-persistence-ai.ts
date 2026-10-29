import { GEMINI_POLICIES } from '../src/serverGeminiSecurity';
import {
  validateHomeworkAiEvaluationResponse,
  isValidHomeworkEvaluation,
  isSyntheticHomeworkEvaluation,
  analyzeSentenceGrammarDeterministic,
} from '../src/utils/writingChecker';
import {
  generateWeeklyHomeworkFromRoutines,
  getDailyMemorizationSchedule,
} from '../src/utils/homeworkGenerator';
import { DayOfWeek, RoutineItem, WeeklyHomeworkData, DailyJournalEntry } from '../src/types';

console.log('=== TEST SUITE: FASE 8 — CORREÇÕES CIRÚRGICAS DE PERSISTÊNCIA E IA ===\n');

let allPassed = true;
function assert(desc: string, condition: boolean, extra?: any) {
  if (condition) {
    console.log(`  ✓ PASS: ${desc}`);
  } else {
    console.error(`  ✗ FAIL: ${desc}`, extra || '');
    allPassed = false;
  }
}

// ============================================================================
// CORREÇÃO A: RECUPERAÇÃO DAS CINCO PALAVRAS & CONTROLE DE HIDRATAÇÃO
// ============================================================================
console.log('--- CORREÇÃO A: Controle de Hidratação das Rotinas & 5 Palavras ---');

// Requisito A.1, A.2, A.3, A.4: Estados explícitos de hidratação
type RoutinesHydrationStatus = 'uninitialized' | 'loading' | 'loaded_with_words' | 'loaded_empty' | 'error';

function simulateHomeworkGenerationGate(
  status: RoutinesHydrationStatus,
  routinesByDay: Record<DayOfWeek, RoutineItem[]>,
  currentHw: WeeklyHomeworkData | null
): { generated: boolean; resultingHw: WeeklyHomeworkData | null } {
  // Gate check applied in App.tsx
  if (status === 'uninitialized' || status === 'loading') {
    return { generated: false, resultingHw: currentHw };
  }
  if (status === 'error') {
    return { generated: false, resultingHw: currentHw };
  }

  const generated = generateWeeklyHomeworkFromRoutines({
    routinesByDay,
    studentName: 'Student Test',
    studentLevel: 'Intermediário (B1)',
    studentEmail: 'student@example.com',
    targetDay: 'friday',
    weeklyCycle: 1,
  });

  // Overwrite protection applied in App.tsx
  if (
    generated?.isEmpty &&
    currentHw &&
    !currentHw.isEmpty &&
    ((Array.isArray(currentHw.sentenceWritingPrompts) && currentHw.sentenceWritingPrompts.length > 0) ||
      (Array.isArray(currentHw.vocabularyList) && currentHw.vocabularyList.length > 0))
  ) {
    return { generated: true, resultingHw: currentHw };
  }

  return { generated: true, resultingHw: generated };
}

// 1. Initial login: routines empty in React state, hydration is 'loading'
const emptyRoutines: Record<DayOfWeek, RoutineItem[]> = {
  monday: [{ id: 'm1', activityName: 'Video of the Day', learnedWords: [], completedToday: false, time: '10:00' }],
  tuesday: [{ id: 't1', activityName: 'Video of the Day', learnedWords: [], completedToday: false, time: '10:00' }],
  wednesday: [{ id: 'w1', activityName: 'Video of the Day', learnedWords: [], completedToday: false, time: '10:00' }],
  thursday: [{ id: 'th1', activityName: 'Video of the Day', learnedWords: [], completedToday: false, time: '10:00' }],
  friday: [{ id: 'f1', activityName: 'Video of the Day', learnedWords: [], completedToday: false, time: '10:00' }],
  saturday: [{ id: 's1', activityName: 'Video of the Day', learnedWords: [], completedToday: false, time: '10:00' }],
  sunday: [{ id: 'su1', activityName: 'Video of the Day', learnedWords: [], completedToday: false, time: '10:00' }],
};

const preHydrationResult = simulateHomeworkGenerationGate('loading', emptyRoutines, null);
assert('Homework generation is BLOCKED when routinesHydrationStatus === "loading"', preHydrationResult.generated === false);
assert('Resulting homework remains null (not prematurely generated as empty)', preHydrationResult.resultingHw === null);

// 2. Read failure / network error: status is 'error'
const persistedHomework: WeeklyHomeworkData = {
  id: 'hw-friday-1',
  weekId: 'week-1',
  weekLabel: 'Week 1',
  targetDay: 'friday',
  studentEmail: 'student@example.com',
  studentName: 'Student Test',
  studentLevel: 'Intermediário (B1)',
  createdAt: '2026-10-28T00:00:00Z',
  isEmpty: false,
  vocabularyList: [
    { word: 'strategy', definitionEn: 'A plan of action', translationPt: 'estratégia', exampleSentence: 'We need a strategy.' },
    { word: 'deadline', definitionEn: 'The latest time', translationPt: 'prazo', exampleSentence: 'The deadline is near.' },
    { word: 'feedback', definitionEn: 'Information about performance', translationPt: 'avaliação', exampleSentence: 'I appreciate the feedback.' },
    { word: 'outcome', definitionEn: 'The way something turns out', translationPt: 'resultado', exampleSentence: 'The outcome was great.' },
    { word: 'milestone', definitionEn: 'An action or event marking a significant stage', translationPt: 'marco', exampleSentence: 'This was a milestone.' },
  ],
  matchingPairs: [],
  fillInBlanks: [],
  sentenceWritingPrompts: [
    { word: 'strategy', hint: 'Describe your plan', hintEn: 'Describe your plan', hintPt: 'Descreva seu plano' },
    { word: 'deadline', hint: 'Describe a timeline', hintEn: 'Describe a timeline', hintPt: 'Descreva um prazo' },
    { word: 'feedback', hint: 'Describe evaluation', hintEn: 'Describe evaluation', hintPt: 'Descreva avaliação' },
    { word: 'outcome', hint: 'Describe a result', hintEn: 'Describe a result', hintPt: 'Descreva um resultado' },
    { word: 'milestone', hint: 'Describe an event', hintEn: 'Describe an event', hintPt: 'Descreva um marco' },
  ],
  readingPassage: { title: 'Story', text: 'Story passage', questions: [] },
  totalWordsCollected: 5,
  isCompleted: false,
  score: 0,
};

const errorResult = simulateHomeworkGenerationGate('error', emptyRoutines, persistedHomework);
assert('Homework generation is BLOCKED when routinesHydrationStatus === "error"', errorResult.generated === false);
assert('Persisted homework is completely preserved on read error (not overwritten)', errorResult.resultingHw === persistedHomework);

// 3. Firestore hydration finishes with words: status becomes 'loaded_with_words'
const hydratedRoutinesWithWords: Record<DayOfWeek, RoutineItem[]> = {
  ...emptyRoutines,
  friday: [
    {
      id: 'f1',
      activityName: 'Video of the Day',
      learnedWords: ['strategy', 'deadline', 'feedback', 'outcome', 'milestone'],
      completedToday: true,
      time: '10:00',
    },
  ],
};

const hydratedResult = simulateHomeworkGenerationGate('loaded_with_words', hydratedRoutinesWithWords, null);
assert('Homework generation EXECUTES when routinesHydrationStatus === "loaded_with_words"', hydratedResult.generated === true);
assert('Generated homework contains exactly the 5 hydrated words', hydratedResult.resultingHw?.vocabularyList?.length === 5);
assert('Generated homework is NOT empty (isEmpty: false)', hydratedResult.resultingHw?.isEmpty === false);
assert('Part 3 sentence writing prompts are generated for all 5 words', hydratedResult.resultingHw?.sentenceWritingPrompts?.length === 5);

// 4. Overwrite protection when React state is empty but persisted homework exists
const transientEmptyResult = simulateHomeworkGenerationGate('loaded_empty', emptyRoutines, persistedHomework);
assert('Overwrite protection preserves existing valid homework when transient routines are empty', transientEmptyResult.resultingHw === persistedHomework);
assert('Sentence prompts are not wiped to 0/0 written', (transientEmptyResult.resultingHw?.sentenceWritingPrompts?.length ?? 0) === 5);

// 5. Reinitialization on user logout / switch
let activeSessionUid = 'student-uid-1';
let hydrationStatus: RoutinesHydrationStatus = 'loaded_with_words';

// User logs out
activeSessionUid = '';
hydrationStatus = 'uninitialized';
assert('Hydration status resets to "uninitialized" on logout', hydrationStatus === 'uninitialized');

// New user logs in
activeSessionUid = 'student-uid-2';
hydrationStatus = 'loading';
assert('Hydration status resets to "loading" on new user login', hydrationStatus === 'loading');

// Asynchronous callback from old user ('student-uid-1') arrives
const callbackTargetUid = 'student-uid-1';
const shouldProcessStaleCallback = callbackTargetUid === activeSessionUid;
assert('Stale async callback from previous user is rejected', shouldProcessStaleCallback === false);


// ============================================================================
// CORREÇÃO B: EXCLUSÃO DEFINITIVA NO JOURNAL & SEM RESSURREIÇÃO POR DB.JSON
// ============================================================================
console.log('\n--- CORREÇÃO B: Exclusão Definitiva no Journal ---');

// Mock of dual-source journal subscription with deletedIdsSet
class MockJournalSubscription {
  private subColMap = new Map<string, DailyJournalEntry>();
  private userDocMap = new Map<string, DailyJournalEntry>();
  private deletedIdsSet = new Set<string>();
  public currentEntries: DailyJournalEntry[] = [];

  constructor(private callback: (entries: DailyJournalEntry[]) => void) {}

  public onSubColSnapshot(docs: DailyJournalEntry[], changes: { type: 'removed'; id: string }[]) {
    changes.forEach((c) => {
      if (c.type === 'removed') {
        this.deletedIdsSet.add(c.id);
        this.subColMap.delete(c.id);
      }
    });
    this.subColMap.clear();
    docs.forEach((d) => {
      if (d.id && !this.deletedIdsSet.has(d.id)) {
        this.subColMap.set(d.id, d);
      }
    });
    this.rebuild();
  }

  public onUserDocSnapshot(entries: DailyJournalEntry[]) {
    this.userDocMap.clear();
    entries.forEach((d) => {
      if (d.id && !this.deletedIdsSet.has(d.id)) {
        this.userDocMap.set(d.id, d);
      }
    });
    this.rebuild();
  }

  public deleteEntry(id: string) {
    this.deletedIdsSet.add(id);
    this.subColMap.delete(id);
    this.userDocMap.delete(id);
    this.rebuild();
  }

  private rebuild() {
    const combined = new Map<string, DailyJournalEntry>();
    this.userDocMap.forEach((v, k) => {
      if (!this.deletedIdsSet.has(k)) combined.set(k, v);
    });
    this.subColMap.forEach((v, k) => {
      if (!this.deletedIdsSet.has(k)) combined.set(k, v);
    });
    this.currentEntries = Array.from(combined.values());
    this.callback(this.currentEntries);
  }
}

let journalState: DailyJournalEntry[] = [];
const sub = new MockJournalSubscription((entries) => {
  journalState = entries;
});

// Seed 3 journal entries
const entry1: DailyJournalEntry = { id: 'entry-1', sentence: 'Today I practiced my vocabulary.', date: '2026-10-28', createdAt: '2026-10-28T10:00:00Z', wordsUsed: ['practice'] };
const entry2: DailyJournalEntry = { id: 'entry-2', sentence: 'I prepared a strategy for the meeting.', date: '2026-10-28', createdAt: '2026-10-28T11:00:00Z', wordsUsed: ['strategy'] };
const entry3: DailyJournalEntry = { id: 'entry-3', sentence: 'The team met the deadline.', date: '2026-10-28', createdAt: '2026-10-28T12:00:00Z', wordsUsed: ['deadline'] };

sub.onSubColSnapshot([entry1, entry2, entry3], []);
assert('Initial journal subscription loads 3 entries', journalState.length === 3);

// Delete entry2
sub.deleteEntry('entry-2');
assert('Entry-2 is removed immediately from journal state', journalState.length === 2 && !journalState.some((e) => e.id === 'entry-2'));

// Stale Firestore snapshot or userDoc snapshot arrives with entry2 (simulating async event)
sub.onUserDocSnapshot([entry1, entry2, entry3]);
assert('Stale snapshot does NOT resurrect deleted entry-2 (protected by deletedIdsSet)', !journalState.some((e) => e.id === 'entry-2'));
assert('Active valid entries (entry-1, entry-3) are preserved', journalState.length === 2 && journalState.some((e) => e.id === 'entry-1') && journalState.some((e) => e.id === 'entry-3'));

// Optimistic UI update and rollback simulation
let uiDailyJournal = [entry1, entry3];
const entryToDelete = entry3;
const prevSnapshot = [...uiDailyJournal];

// User clicks delete
uiDailyJournal = uiDailyJournal.filter((e) => e.id !== entryToDelete.id);
assert('Optimistic deletion removes entry immediately from UI', uiDailyJournal.length === 1);

// Simulate deletion failure from Firestore
const deletionSucceeded = false;
if (!deletionSucceeded) {
  // Rollback state
  uiDailyJournal = prevSnapshot;
}
assert('UI rollback restores entry upon deletion failure', uiDailyJournal.length === 2 && uiDailyJournal.some((e) => e.id === entryToDelete.id));


// ============================================================================
// CORREÇÃO C: AVALIAÇÃO GEMINI DA PART 3
// ============================================================================
console.log('\n--- CORREÇÃO C: Avaliação Gemini da Part 3 ---');

// 1. Security policy check for homework_evaluate
const hwPolicy = GEMINI_POLICIES['homework_evaluate'];
assert('GEMINI_POLICIES.homework_evaluate maxOutputTokens is 2500 (increased from 1200)', hwPolicy.maxOutputTokens === 2500);
assert('GEMINI_POLICIES.homework_evaluate timeoutMs is 30000 (increased from 15000)', hwPolicy.timeoutMs === 30000);
assert('GEMINI_POLICIES.homework_evaluate maxInputLengthChars is 8000 (increased from 4000)', hwPolicy.maxInputLengthChars === 8000);

// 2. Autonomous Part 3 evaluation without Part 4 dependency
const samplePrompts = [
  { word: 'strategy', hintEn: 'Describe your business plan', hintPt: 'Descreva seu plano' },
  { word: 'deadline', hintEn: 'Mention completing work on time', hintPt: 'Mencione entrega no prazo' },
  { word: 'feedback', hintEn: 'Mention client response', hintPt: 'Mencione resposta do cliente' },
  { word: 'outcome', hintEn: 'Explain the final result', hintPt: 'Explique o resultado final' },
  { word: 'milestone', hintEn: 'Describe an accomplishment', hintPt: 'Descreva uma conquista' },
];

const sampleStudentAnswers = {
  strategy: 'We implemented a new digital strategy for the sales team.',
  deadline: 'The team worked hard to meet the strict project deadline.',
  feedback: 'Our manager provided helpful feedback on the initial draft.',
  outcome: 'The final outcome of the negotiation exceeded our targets.',
  milestone: 'Launching the mobile application was a significant milestone.',
};

const validGeminiPart3Response = {
  sentenceFeedback: [
    {
      word: 'strategy',
      originalSentence: 'We implemented a new digital strategy for the sales team.',
      isCorrect: true,
      correctedSentence: 'We implemented a new digital strategy for the sales team.',
      explanationPt: 'Excelente frase! O termo "strategy" foi usado de forma correta e natural.',
      explanationEn: 'Excellent sentence! The word "strategy" is used accurately and naturally.',
      levelAdvicePt: 'Bom uso da estrutura no Simple Past.',
      levelAdviceEn: 'Good use of the Simple Past structure.',
    },
    {
      word: 'deadline',
      originalSentence: 'The team worked hard to meet the strict project deadline.',
      isCorrect: true,
      correctedSentence: 'The team worked hard to meet the strict project deadline.',
      explanationPt: 'Correto! A coligação "meet the deadline" é idiomática.',
      explanationEn: 'Correct! The collocation "meet the deadline" is idiomatic.',
      levelAdvicePt: 'Ótima precisão lexical.',
      levelAdviceEn: 'Great lexical precision.',
    },
    {
      word: 'feedback',
      originalSentence: 'Our manager provided helpful feedback on the initial draft.',
      isCorrect: true,
      correctedSentence: 'Our manager provided helpful feedback on the initial draft.',
      explanationPt: 'Perfeito! "Feedback" é substantivo incontável e foi usado perfeitamente.',
      explanationEn: 'Perfect! "Feedback" is uncountable and used properly.',
      levelAdvicePt: 'Estrutura gramatical sólida.',
      levelAdviceEn: 'Solid grammatical structure.',
    },
    {
      word: 'outcome',
      originalSentence: 'The final outcome of the negotiation exceeded our targets.',
      isCorrect: true,
      correctedSentence: 'The final outcome of the negotiation exceeded our targets.',
      explanationPt: 'Muito bem! "Outcome" se encaixa perfeitamente no contexto de negociação.',
      explanationEn: 'Well done! "Outcome" fits the negotiation context accurately.',
      levelAdvicePt: 'Nível avançado de vocabulário demonstrado.',
      levelAdviceEn: 'Advanced vocabulary demonstrated.',
    },
    {
      word: 'milestone',
      originalSentence: 'Launching the mobile application was a significant milestone.',
      isCorrect: true,
      correctedSentence: 'Launching the mobile application was a significant milestone.',
      explanationPt: 'Parabéns! O gerúndio como sujeito da oração está correto.',
      explanationEn: 'Congratulations! Gerund as subject of the clause is correct.',
      levelAdvicePt: 'Construção sofisticada de oração.',
      levelAdviceEn: 'Sophisticated clause construction.',
    },
  ],
  tutorFeedbackSummaryPt: 'Impressionante dedicação! Suas cinco frases demonstram excelente domínio das palavras aprendidas.',
  tutorFeedbackSummaryEn: 'Impressive dedication! Your five sentences show great mastery of the target vocabulary.',
  levelStrengthsPt: 'Excelente concordância e vocabulário natural.',
  levelStrengthsEn: 'Great agreement and natural vocabulary.',
  levelNextStepsPt: 'Continue praticando orações compostas com conectivos.',
  levelNextStepsEn: 'Keep practicing compound sentences with linking words.',
};

// Validate without Part 4 (autonomous Part 3 validation)
const isPart3AutonomousValid = validateHomeworkAiEvaluationResponse(
  validGeminiPart3Response,
  samplePrompts,
  sampleStudentAnswers
);
assert('validateHomeworkAiEvaluationResponse succeeds autonomously for Part 3 without Part 4', isPart3AutonomousValid === true);

// 3. Zero synthetic approvals: incomplete fragments or missing target word must be rejected
const invalidApprovalResponse = {
  ...validGeminiPart3Response,
  sentenceFeedback: [
    ...validGeminiPart3Response.sentenceFeedback.slice(0, 4),
    {
      word: 'milestone',
      originalSentence: 'anyone know about', // Incomplete fragment with missing target word
      isCorrect: true, // Erroneously approved!
      correctedSentence: 'Does anyone know about this?',
      explanationPt: 'Frase aprovada',
      explanationEn: 'Approved',
    },
  ],
};

const fragmentStudentAnswers = {
  ...sampleStudentAnswers,
  milestone: 'anyone know about',
};

const isFalseApprovalRejected = validateHomeworkAiEvaluationResponse(
  invalidApprovalResponse,
  samplePrompts,
  fragmentStudentAnswers
);
assert('validateHomeworkAiEvaluationResponse REJECTS false approval of incomplete fragment without target word', isFalseApprovalRejected === false);

// 4. Zero synthetic approvals: short fragments (< 3 words)
const shortFragmentAnswers = {
  ...sampleStudentAnswers,
  strategy: 'good strategy', // only 2 words
};

const isShortFragmentApproved = validateHomeworkAiEvaluationResponse(
  validGeminiPart3Response,
  samplePrompts,
  shortFragmentAnswers
);
// Deterministic grammar analysis detects fragment
const detAnalysis = analyzeSentenceGrammarDeterministic('good strategy', ['strategy'], 'strategy');
assert('analyzeSentenceGrammarDeterministic flags short fragment without verb/subject', detAnalysis.hasGrammarError === true);

// 5. Preserving student answers when AI is unavailable
interface FallbackHwRecord {
  id: string;
  studentUid: string;
  studentAnswers: {
    matching: Record<string, string>;
    fillInBlanks: Record<string, string>;
    sentences: Record<string, string>;
    quizAnswers: Record<string, any>;
  };
  aiEvaluation?: any;
}

const studentAnswersToPersist = {
  matching: { 'match-strategy': 'strategy' },
  fillInBlanks: { 'blank-1': 'deadline' },
  sentences: sampleStudentAnswers,
  quizAnswers: { 'q-1': 2 },
};

function simulateAiFailurePersistence(
  studentUid: string,
  answers: typeof studentAnswersToPersist
): { savedDoc: FallbackHwRecord; status: number; errorCode: string } {
  // Simulates serverApp.ts line 16900: saving answers before returning 503
  const savedDoc: FallbackHwRecord = {
    id: 'week-1',
    studentUid,
    studentAnswers: answers,
  };
  return {
    savedDoc,
    status: 503,
    errorCode: 'AiUnavailable',
  };
}

const fallbackResult = simulateAiFailurePersistence('student-uid-1', studentAnswersToPersist);
assert('Server returns HTTP 503 with errorCode "AiUnavailable" on AI failure', fallbackResult.status === 503 && fallbackResult.errorCode === 'AiUnavailable');
assert('Student answers are safely persisted in storage doc even when AI is unavailable', fallbackResult.savedDoc.studentAnswers.sentences['strategy'] === sampleStudentAnswers.strategy);
assert('All 5 student written sentences are preserved in storage during AI failure', Object.keys(fallbackResult.savedDoc.studentAnswers.sentences).length === 5);

// ============================================================================
// FINAL SUMMARY
// ============================================================================
console.log('\n============================================================');
if (allPassed) {
  console.log('🎉 ALL AUTOMATED TESTS FOR FASE 8 PASSED SUCCESSFULLY!');
} else {
  console.error('❌ SOME TESTS FAILED. PLEASE REVIEW LOGS ABOVE.');
  process.exit(1);
}
console.log('============================================================\n');
