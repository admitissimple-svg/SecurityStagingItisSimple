import { EnglishLevel, LiveLesson } from '../types';
import { NATIVE_FRIENDS_DICTIONARY_DATABASE } from '../data/dictionaryDatabase';
import { parseNotesHtml, ParsedNotesResult } from './notesHtmlParser';

export interface PedagogicalMistakeAnalysis {
  id: string;
  original: string;
  corrected: string;
  category: 'grammar' | 'vocabulary' | 'collocation' | 'preposition' | 'pronunciation' | 'phrasing';
  explanation: string;
  twoExamples: string[];
  commonPitfalls: string;
  isPendingConfirmation?: boolean;
}

export interface PedagogicalGrammarPoint {
  id: string;
  topic: string;
  rule: string;
  form: string;
  usage: string;
  examples: string[];
  commonMistakes: string;
  comparisons: string;
}

export interface PedagogicalVocabularyItem {
  id: string;
  term: string;
  partOfSpeech: string;
  simpleDefinition: string;
  collocations: string[];
  realExamples: string[];
  synonyms: string[];
  register: 'informal' | 'neutral' | 'formal' | 'idiomatic';
  category: string;
  phoneticGuide?: string;
  isPronunciationFocus?: boolean;
  cefrLevel?: string;
}

export interface PedagogicalLevelAdaptation {
  cefrLevel: 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';
  levelLabel: string;
  nativeInterferenceNotes: string;
  complexityAdjustmentAdvice: string;
  targetedPracticePrompt: string;
}

export interface PedagogicalReviewSummary {
  estimatedMinutes: string;
  keyRules: string[];
  mustKnowVocabulary: string[];
  essentialCorrections: { original: string; corrected: string; explanation?: string }[];
  rememberThis: string;
}

export interface PedagogicalLessonTransformation {
  lessonId?: string;
  sessionKey: string;
  sessionDate: string;
  topic: string;
  teacherName?: string;
  teacherEmail?: string;
  studentUid?: string;
  studentEmail?: string;
  studentLevel: string;
  cefrLevel: string;
  contentHash?: string;
  // Rigorously specified sections:
  // 1. Analyze Mistakes (mapped from Alt+N)
  // 2. Grammar Points (systemic grammar rules from Alt+N & session topic)
  // 3. Vocabulary & Expressions (mapped from Alt+W and Alt+P)
  // 4. Quick Review (comprehensive summary of ALL session items)
  mistakesAnalysis: PedagogicalMistakeAnalysis[];
  grammarPoints: PedagogicalGrammarPoint[];
  vocabularyAndExpressions: PedagogicalVocabularyItem[];
  levelAdaptation?: PedagogicalLevelAdaptation;
  reviewSummary: PedagogicalReviewSummary;
  rawNotesSnippet?: string;
  correctStampsCount: number;
  incorrectStampsCount: number;
  newWordStampsCount?: number;
  pronounceStampsCount?: number;
  generatedAt: string;
}

/**
 * Computes a deterministic content hash for note versioning and cache invalidation.
 */
export function computeNotesHash(str: string): string {
  let hash = 0;
  const clean = (str || '').trim();
  for (let i = 0; i < clean.length; i++) {
    const char = clean.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(16);
}

/**
 * Resolves a canonical session key ensuring teacher and student access the identical identifier.
 */
export function getCanonicalSessionKey(params: {
  lessonId?: string;
  sessionKey?: string;
  id?: string;
  studentUid?: string;
  studentEmail?: string;
  sessionDate?: string;
}): string {
  const custom = (params.sessionKey || params.id || '').trim();
  const rawLessonId = (params.lessonId || '').trim();
  if (rawLessonId) {
    const cleanId = rawLessonId.replace(/^lesson_/, '');
    return `lesson_${cleanId}`;
  }
  if (custom) {
    if (custom.startsWith('lesson_')) {
      const cleanId = custom.replace(/^lesson_+/, '');
      return `lesson_${cleanId}`;
    }
    return custom;
  }
  const cleanEmail = (params.studentEmail || '').toLowerCase().trim();
  const cleanUid = (params.studentUid || '').trim();
  const idPart = (cleanUid || cleanEmail).replace(/[^a-zA-Z0-9_-]/g, '_');
  const datePart = (params.sessionDate || new Date().toISOString().split('T')[0]).slice(0, 10);
  return `session_${datePart}_${idPart || 'student'}`;
}

/**
 * Maps app level to standardized CEFR code and metadata
 */
export function resolveCefrLevel(level?: EnglishLevel | string): {
  cefr: 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';
  labelEn: string;
  labelPt: string;
} {
  const norm = String(level || '').toLowerCase().trim();
  if (norm.includes('c2') || norm.includes('c1') || norm.includes('avancado') || norm.includes('advanced')) {
    return { cefr: 'C1', labelEn: 'Advanced (C1-C2)', labelPt: 'Avançado (C1-C2)' };
  }
  if (norm.includes('b2') || norm.includes('upper')) {
    return { cefr: 'B2', labelEn: 'Upper-Intermediate (B2)', labelPt: 'Intermediário Superior (B2)' };
  }
  if (norm.includes('b1') || norm.includes('intermediario') || norm.includes('intermediate')) {
    return { cefr: 'B1', labelEn: 'Intermediate (B1-B2)', labelPt: 'Intermediário (B1-B2)' };
  }
  if (norm.includes('a2') || norm.includes('elementary')) {
    return { cefr: 'A2', labelEn: 'Elementary (A2)', labelPt: 'Elementar (A2)' };
  }
  return { cefr: 'A1', labelEn: 'Beginner (A1-A2)', labelPt: 'Iniciante (A1-A2)' };
}

/**
 * Extracts and categorizes markings from teacher notes:
 * Re-exports results using the robust notesHtmlParser.
 */
export function extractNotesMarkings(rawContent: string): ParsedNotesResult {
  return parseNotesHtml(rawContent);
}

/**
 * Robust, pedagogical fallback generator that deterministically constructs
 * all 4 required sections strictly based on CEFR level and real detected markers.
 * NEVER inserts mocked items (no "I have 28 years old", no "catch up", no fake grammar rules).
 */
export function generateLocalPedagogicalTransformation(params: {
  rawNotes: string;
  topic?: string;
  sessionDate?: string;
  teacherName?: string;
  studentLevel?: EnglishLevel | string;
  studentUid?: string;
  studentEmail?: string;
  lessonId?: string;
  sessionKey?: string;
}): PedagogicalLessonTransformation {
  const {
    rawNotes,
    topic = 'General Conversation & Fluency',
    sessionDate = new Date().toISOString().split('T')[0],
    teacherName = 'Native Friend',
    studentLevel = EnglishLevel.INTERMEDIATE,
    studentUid,
    studentEmail,
    lessonId,
    sessionKey: customSessionKey,
  } = params;

  const markings = parseNotesHtml(rawNotes);
  const cefrMeta = resolveCefrLevel(studentLevel);
  const contentHash = computeNotesHash(rawNotes);

  const sessionKey = getCanonicalSessionKey({
    lessonId,
    sessionKey: customSessionKey,
    studentUid,
    studentEmail,
    sessionDate,
  });

  // Common L1 (Portuguese) error patterns & grammar rules
  const L1_PATTERNS = [
    {
      regex: /\b(have|has)\s+(\d{1,2})\s*(years|years old)?\b/i,
      category: 'grammar' as const,
      topic: 'Age expression (Be vs Have)',
      rule: 'In English, we express age using the verb "to be" (am / is / are), NEVER "have". In Portuguese, "ter anos" is used, which creates a classic false friend interference.',
      form: 'Subject + be (am/is/are) + [number] (years old)',
      usage: 'Used to state age, duration of life, or anniversary of things.',
      correctedFallback: 'I am 28 years old',
      explanation: 'Age is an ongoing physical and temporal state of being in English, not a tangible possession.',
      twoExamples: ['She is 34 years old.', 'When I was 20, I lived in London.'],
      commonPitfalls: 'Saying "I have 25 years" or translating Portuguese "Eu tenho ... anos" literally.',
      comparisons: 'English: "I AM 25" (State) vs Portuguese: "Eu TENHO 25" (Possession)',
    },
    {
      regex: /\b(i('m| am)\s+agree)\b/i,
      category: 'grammar' as const,
      topic: 'Verb "Agree" (Active Verb vs Adjective)',
      rule: '"Agree" is an active verb in English, NOT an adjective. Do not put the auxiliary verb "am" before it in the present simple.',
      form: 'Subject + agree / agrees (with + person / on + topic)',
      usage: 'Used to express shared opinion, consensus, or harmony in thoughts.',
      correctedFallback: 'I agree with you',
      explanation: 'In Portuguese, we say "Estou de acordo", which misleads learners into saying "I am agree".',
      twoExamples: ['I completely agree with your proposal.', 'Do you agree with the manager?'],
      commonPitfalls: 'Adding "am" ("I am agree") or making it negative with "am not agree" instead of "I don\'t agree".',
      comparisons: 'I agree (Verb) vs I am in agreement (Formal idiom)',
    },
    {
      regex: /\b(depend\s+of)\b/i,
      category: 'preposition' as const,
      topic: 'Preposition collocation with "Depend"',
      rule: 'The verb "depend" strictly collocates with the preposition "ON" (or occasionally "upon"), NEVER "of".',
      form: 'Subject + depend(s) + ON + object / noun phrase',
      usage: 'Expresses reliance, contingency, or conditional outcome.',
      correctedFallback: 'It depends on the weather',
      explanation: 'Portuguese speakers say "depende DE", causing automatic substitution of "de" with "of".',
      twoExamples: ['Our travel plans depend on the budget.', 'Success depends on daily consistency.'],
      commonPitfalls: 'Using "depend of" or "it depends from".',
      comparisons: 'Depend ON (English) vs Depender DE (Portuguese)',
    },
    {
      regex: /\b(make\s+a\s+question)\b/i,
      category: 'collocation' as const,
      topic: 'Collocation "Ask a question" (Make vs Ask)',
      rule: 'In English, you "ASK a question", you never "make a question" or "do a question".',
      form: 'Subject + ask + [someone] + a question',
      usage: 'Used when inquiring or seeking clarification from a colleague or speaker.',
      correctedFallback: 'Can I ask a question?',
      explanation: 'Portuguese "fazer uma pergunta" leads to translating "fazer" as "make".',
      twoExamples: ['Feel free to ask questions at any point.', 'He asked me a tricky question about finance.'],
      commonPitfalls: 'Saying "make a question" or "do a question".',
      comparisons: 'Ask a question (Inquire) vs Make a statement (Declare)',
    },
    {
      regex: /\b(for\s+to\s+\w+|for\s+\w+ing\s+to)\b/i,
      category: 'grammar' as const,
      topic: 'Infinitive of Purpose (To + Verb vs For)',
      rule: 'To express the purpose of an action ("para fazer algo"), use "TO + base verb", NOT "for + verb" or "for to".',
      form: 'Main clause + TO + base verb (Infinitive of purpose)',
      usage: 'Answers "why" an action was performed.',
      correctedFallback: 'I went to the store to buy coffee',
      explanation: 'In Portuguese "para comprar" is translated with "para" -> "for". But in English, purpose of an action is expressed by the bare infinitive with "to".',
      twoExamples: ['I called him to confirm our meeting time.', 'She exercises daily to stay energized.'],
      commonPitfalls: 'Saying "for to buy" or "for buying" when indicating your personal goal or immediate reason.',
      comparisons: 'To buy (purpose of action) vs For buying (purpose of an object or tool)',
    },
  ];

  // 1. Build Section 1: Mistakes Analysis (Strictly from real markings)
  const mistakesAnalysis: PedagogicalMistakeAnalysis[] = [];
  const processedSignatures = new Set<string>();

  for (const err of markings.errors) {
    const rawOrig = (err.original || '').trim();
    if (!rawOrig || processedSignatures.has(rawOrig.toLowerCase())) continue;
    processedSignatures.add(rawOrig.toLowerCase());

    const hasCorrection = Boolean(err.corrected && err.corrected.trim() && !err.isPendingConfirmation);

    if (!hasCorrection) {
      // Teacher marked the mistake but did not provide the correction (e.g. "Blate")
      // Do NOT guess or hallucinate a correction; mark as pending confirmation
      mistakesAnalysis.push({
        id: `mistake-${mistakesAnalysis.length + 1}`,
        original: rawOrig,
        corrected: 'Pendente de confirmação com o professor',
        category: 'vocabulary',
        explanation: `A forma corrigida para "${rawOrig}" não foi informada na aula. Confirme com seu Native Friend na próxima sessão para validar o contexto exato.`,
        twoExamples: [],
        commonPitfalls: 'Aguardando confirmação do professor sobre o contexto específico de uso.',
        isPendingConfirmation: true,
      });
      continue;
    }

    const cleanCorr = (err.corrected || '').trim();
    const matchedPattern = L1_PATTERNS.find(
      (p) => p.regex.test(rawOrig) || (cleanCorr && p.regex.test(cleanCorr))
    );

    if (matchedPattern) {
      mistakesAnalysis.push({
        id: `mistake-${mistakesAnalysis.length + 1}`,
        original: rawOrig,
        corrected: cleanCorr || matchedPattern.correctedFallback,
        category: matchedPattern.category,
        explanation: matchedPattern.explanation,
        twoExamples: matchedPattern.twoExamples,
        commonPitfalls: matchedPattern.commonPitfalls,
        isPendingConfirmation: false,
      });
    } else {
      mistakesAnalysis.push({
        id: `mistake-${mistakesAnalysis.length + 1}`,
        original: rawOrig,
        corrected: cleanCorr,
        category: 'grammar',
        explanation: `In native spoken English, phrasing this structure as "${cleanCorr}" aligns naturally with conversational rhythm and grammatical precision.`,
        twoExamples: [
          `In everyday conversation: "${cleanCorr}".`,
          `Alternative formulation: "I prefer saying ${cleanCorr} to sound natural and clear."`,
        ],
        commonPitfalls: `Reverting to literal native language syntax instead of adopting natural English phraseology.`,
        isPendingConfirmation: false,
      });
    }
  }

  // 2. Build Section 2: Teach Grammar Points
  // Only explain rules related to real errors when there is sufficient systemic evidence; otherwise return empty list!
  const grammarPoints: PedagogicalGrammarPoint[] = [];

  const hasAgreeMistake = mistakesAnalysis.some(
    (m) => !m.isPendingConfirmation && (/agree/i.test(m.original) || /agree/i.test(m.corrected))
  );
  const hasAgeMistake = mistakesAnalysis.some(
    (m) => !m.isPendingConfirmation && (/year/i.test(m.original) || /have.*old/i.test(m.original))
  );
  const hasPrepositionMistake = mistakesAnalysis.some(
    (m) => !m.isPendingConfirmation && (m.category === 'preposition' || /depend\s+o/i.test(m.original))
  );
  const hasPurposeMistake = mistakesAnalysis.some(
    (m) => !m.isPendingConfirmation && (/for\s+to\b/i.test(m.original) || /for\s+\w+ing\b/i.test(m.original))
  );

  if (hasAgreeMistake) {
    grammarPoints.push({
      id: 'grammar-agree',
      topic: 'Stative & Opinion Verbs: Agree, Believe, Need',
      rule: 'Verbs expressing mental state or opinion (agree, think, understand) function as main lexical verbs. They do not take the auxiliary "be" in simple affirmative statements.',
      form: 'Affirmative: Subject + Verb (e.g., I agree) | Negative: Subject + do/does not + Verb (e.g., I don\'t agree) | Question: Do/Does + Subject + Verb? (e.g., Do you agree?)',
      usage: 'Used in discussions, meetings, and casual chats to indicate agreement, consensus, or shared perspectives.',
      examples: [
        'I agree with your perspective on work-life balance.',
        'We don\'t agree on every detail, but we respect each other\'s view.',
        'Do you agree with the revised deadline?',
      ],
      commonMistakes: 'Saying "I am agree", "I am not agree", or "Are you agree?".',
      comparisons: 'I agree (Active state verb) vs I am happy (Subject + be + adjective).',
    });
  }

  if (hasPrepositionMistake) {
    grammarPoints.push({
      id: 'grammar-preposition',
      topic: 'Dependent Prepositions with Common Verbs (Depend on, Wait for, Listen to)',
      rule: 'In English, certain verbs demand specific fixed prepositions before their noun objects. These pairings must be learned as single semantic blocks.',
      form: 'Verb + Fixed Preposition + Object Noun/Pronoun/Gerund (-ing)',
      usage: 'Essential for discussing dependencies, time, and interpersonal focus accurately.',
      examples: [
        'My weekend plans depend on my energy levels after Friday.',
        'I am waiting for the confirmation email.',
        'She always listens to the daily podcast during her commute.',
      ],
      commonMistakes: 'Saying "depend of" (from Portuguese "depender de") or "listen music" without "to".',
      comparisons: 'Depend ON vs Wait FOR vs Listen TO vs Look AT.',
    });
  }

  if (hasAgeMistake) {
    grammarPoints.push({
      id: 'grammar-age',
      topic: 'Expressing Age and Enduring Physical States with "To Be"',
      rule: 'Age, temperature, hunger, and physical conditions in English are expressed with the verb "to be", reflecting states of existence.',
      form: 'Subject + be (am/is/are) + age number [years old] / adjective',
      usage: 'Introducing oneself, introducing relatives, discussing milestones and life phases.',
      examples: [
        'I am 32 years old, and my brother is 29.',
        'When my daughter is five, she will start school.',
      ],
      commonMistakes: 'Using "have" instead of "be" (e.g., "I have 25 years").',
      comparisons: 'I am 25 (English state) vs Eu tenho 25 anos (Portuguese possession).',
    });
  }

  if (hasPurposeMistake) {
    grammarPoints.push({
      id: 'grammar-purpose',
      topic: 'Infinitive of Purpose (To + Base Verb vs For)',
      rule: 'To express the purpose of a personal action, use "TO + base verb", NOT "for + verb" or "for to".',
      form: 'Action clause + TO + base verb',
      usage: 'Explaining why an action was performed or planned.',
      examples: [
        'I called him to confirm our meeting time.',
        'She exercises daily to stay energized.',
      ],
      commonMistakes: 'Saying "for buy" or "for to buy".',
      comparisons: 'To buy (purpose of an action) vs For buying (function of an object).',
    });
  }

  // 3. Build Section 3: Teach Vocabulary and Expressions (Exclusively new-word and pronounce)
  const vocabularyAndExpressions: PedagogicalVocabularyItem[] = [];
  const candidateVocab = [...markings.newWords, ...markings.pronounceItems];

  const seenVocabTerms = new Set<string>();

  candidateVocab.forEach((item) => {
    const rawTrimmed = item.trim();
    const cleanWord = rawTrimmed.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim();
    if (!cleanWord || seenVocabTerms.has(cleanWord)) return;
    seenVocabTerms.add(cleanWord);

    const isPronounce = markings.pronounceItems.some(
      (p) => p.toLowerCase().trim() === cleanWord || cleanWord.includes(p.toLowerCase().trim())
    );

    const isNewWord = markings.newWords.some(
      (w) => w.toLowerCase().trim() === cleanWord || cleanWord.includes(w.toLowerCase().trim())
    );

    const normalizedKey = cleanWord.replace(/[_\-]+/g, ' ');
    const dbMatch = NATIVE_FRIENDS_DICTIONARY_DATABASE[cleanWord] || NATIVE_FRIENDS_DICTIONARY_DATABASE[normalizedKey];

    const entry = dbMatch
      ? {
          partOfSpeech: isPronounce ? 'Pronunciation Focus' : dbMatch.partOfSpeech,
          simpleDefinition: isPronounce
            ? `Pronunciation focus: Pay careful attention to syllable stress, vowel reduction, and clear consonant articulation of "${rawTrimmed}".`
            : dbMatch.definitionEn,
          collocations: dbMatch.collocations || [`use "${rawTrimmed}" naturally`],
          realExamples: dbMatch.realExamples || [dbMatch.exampleSentenceEn],
          synonyms: dbMatch.synonyms || ['target phrase'],
          register: dbMatch.register || ('neutral' as const),
          category: isPronounce ? 'Pronunciation & Phonetics (Alt+P)' : isNewWord ? 'New Words & Expressions (Alt+W)' : 'Core Session Vocabulary',
        }
      : {
          partOfSpeech: isPronounce
            ? 'Pronunciation Focus'
            : cleanWord.includes(' ')
            ? 'Idiomatic Expression'
            : 'Vocabulary Item',
          simpleDefinition: isPronounce
            ? `Pronunciation focus: Pay careful attention to syllable stress, vowel reduction, and clear consonant articulation of "${rawTrimmed}".`
            : `Key communicative expression (${cefrMeta.cefr}): used in conversation to communicate "${rawTrimmed}" clearly and naturally.`,
          collocations: [`use "${rawTrimmed}" naturally`, `frequently heard with "${rawTrimmed}"`],
          realExamples: [
            `In daily speaking: "I practiced using '${rawTrimmed}' naturally in our conversation today."`,
            `Practice sentence: "Understanding how native speakers say '${rawTrimmed}' makes your speech flow smoothly."`,
          ],
          synonyms: ['natural expression', 'target phrase'],
          register: 'neutral' as const,
          category: isPronounce ? 'Pronunciation & Phonetics (Alt+P)' : isNewWord ? 'New Words & Expressions (Alt+W)' : 'Core Session Vocabulary',
        };

    vocabularyAndExpressions.push({
      id: `vocab-${vocabularyAndExpressions.length + 1}`,
      term: rawTrimmed,
      cefrLevel: dbMatch?.cefrLevel || cefrMeta.cefr,
      ...entry,
      phoneticGuide: isPronounce
        ? `🎯 Pronunciation focus: practice clean syllable stress on "${rawTrimmed}" without adding Portuguese final vowels.`
        : (dbMatch?.phonetic || undefined),
      isPronunciationFocus: isPronounce,
    });
  });

  // CEFR Level Adaptation metadata
  const levelAdaptation: PedagogicalLevelAdaptation = {
    cefrLevel: cefrMeta.cefr,
    levelLabel: cefrMeta.labelEn,
    nativeInterferenceNotes:
      cefrMeta.cefr === 'A1' || cefrMeta.cefr === 'A2'
        ? 'At the A1-A2 level, Brazilian Portuguese speakers frequently transfer basic word order and verb structures directly into English. Focus on short, declarative subject-verb-object building blocks and anchor common prepositions (in/on/at).'
        : cefrMeta.cefr === 'B1' || cefrMeta.cefr === 'B2'
        ? 'At the B1-B2 level, learners speak comfortably but often encounter subtle preposition collocations, false friends, and over-reliance on simple verb forms. Prioritize conversational collocations and connecting phrases.'
        : 'At the C1-C2 level, focus shifts to pragmatic nuance, sophisticated idiomatic expressions, tone calibration, and eliminating residual syntactic Portuguese calques to achieve effortless executive fluency.',
    complexityAdjustmentAdvice:
      cefrMeta.cefr === 'A1' || cefrMeta.cefr === 'A2'
        ? 'Keep sentences short, clear, and grounded in daily concrete actions. Repeat the expressions out loud 3 times.'
        : 'Integrate the new vocabulary into spontaneous 2-minute speaking monologues before your next live session.',
    targetedPracticePrompt: `Describe your typical routine or recent experiences regarding "${topic}", making sure to incorporate at least two of the session items.`,
  };

  // 4. Build Section 4: 5-10 Minute Quick Review Summary
  // Strictly summarizes real information from the other categories
  let rememberThis = 'Remember this: Fluency is not about never making mistakes; it is about recognizing patterns quickly and adopting natural native phraseology!';
  if (mistakesAnalysis.length > 0) {
    const firstMistake = mistakesAnalysis[0];
    if (firstMistake.isPendingConfirmation) {
      rememberThis = `Lembre-se disto: Revise a expressão "${firstMistake.original}" com seu Native Friend para confirmar a formulação exata!`;
    } else {
      rememberThis = `Remember this: Instead of saying "${firstMistake.original}", always say "${firstMistake.corrected}"! Consistent small shifts in your active vocabulary build unstoppable speaking confidence.`;
    }
  } else if (vocabularyAndExpressions.length > 0) {
    const termNames = vocabularyAndExpressions.map((v) => v.term).slice(0, 3).join(', ');
    rememberThis = `Remember this: Active practice with your new expressions (${termNames}) turns passive recognition into spontaneous conversational confidence!`;
  }

  const reviewSummary: PedagogicalReviewSummary = {
    estimatedMinutes: '5–10 minutes',
    keyRules: grammarPoints.map((gp) => `${gp.topic}: ${gp.rule}`),
    mustKnowVocabulary: vocabularyAndExpressions.map((v) => {
      const tag = v.isPronunciationFocus ? '🎯 [Pronounce]' : '✨';
      return `${tag} ${v.term} (${v.partOfSpeech}) — ${v.simpleDefinition}`;
    }),
    essentialCorrections: mistakesAnalysis.map((m) => ({
      original: m.original,
      corrected: m.corrected,
      explanation: m.explanation,
    })),
    rememberThis,
  };

  return {
    lessonId,
    sessionKey,
    sessionDate,
    topic,
    teacherName,
    teacherEmail: undefined,
    studentUid,
    studentEmail,
    studentLevel: String(studentLevel),
    cefrLevel: cefrMeta.cefr,
    contentHash,
    mistakesAnalysis,
    grammarPoints,
    vocabularyAndExpressions,
    levelAdaptation,
    reviewSummary,
    rawNotesSnippet: markings.cleanText.slice(0, 300),
    correctStampsCount: markings.correctCount,
    incorrectStampsCount: markings.incorrectCount,
    newWordStampsCount: markings.newWordCount,
    pronounceStampsCount: markings.pronounceCount,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Service to fetch or generate the pedagogical transformation for a session note.
 * Tries server-side Gemini AI generation first, falling back gracefully to local pedagogical synthesizer.
 */
export async function fetchPedagogicalTransformation(params: {
  rawNotes: string;
  topic?: string;
  sessionDate?: string;
  teacherName?: string;
  studentLevel?: EnglishLevel | string;
  studentUid?: string;
  studentEmail?: string;
  lessonId?: string;
  sessionKey?: string;
  forceRegenerate?: boolean;
}): Promise<PedagogicalLessonTransformation> {
  const {
    rawNotes,
    topic = 'Daily Conversation & Fluency',
    sessionDate = new Date().toISOString().split('T')[0],
    teacherName = 'Native Friend',
    studentLevel = EnglishLevel.INTERMEDIATE,
    studentUid,
    studentEmail,
    lessonId,
    sessionKey,
    forceRegenerate = false,
  } = params;

  try {
    const res = await fetch('/api/pedagogical-notes/transform', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rawNotes,
        topic,
        sessionDate,
        teacherName,
        studentLevel,
        studentUid,
        studentEmail,
        lessonId,
        sessionKey,
        forceRegenerate,
      }),
    });

    if (res.ok) {
      const data = await res.json();
      if (data && data.transformation && Array.isArray(data.transformation.mistakesAnalysis)) {
        return data.transformation;
      }
    }
  } catch (err) {
    console.warn('Backend pedagogical transform request notice:', (err as any)?.message || 'NETWORK_FAILURE');
  }

  // Graceful deterministic fallback strictly faithful to raw notes
  return generateLocalPedagogicalTransformation({
    rawNotes,
    topic,
    sessionDate,
    teacherName,
    studentLevel,
    studentUid,
    studentEmail,
    lessonId,
    sessionKey,
  });
}
