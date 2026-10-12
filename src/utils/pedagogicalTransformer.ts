import { EnglishLevel, LiveLesson } from '../types';
import { NATIVE_FRIENDS_DICTIONARY_DATABASE } from '../data/dictionaryDatabase';

export interface PedagogicalMistakeAnalysis {
  id: string;
  original: string;
  corrected: string;
  category: 'grammar' | 'vocabulary' | 'collocation' | 'preposition' | 'pronunciation' | 'phrasing';
  explanation: string;
  twoExamples: [string, string];
  commonPitfalls: string;
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
 * - Alt + N: Incorrect / Error (<span data-tag-type="incorrect">✗</span> or ✗ or "Instead of: ... Say: ...")
 * - Alt + W: New Word (<span data-tag-type="new-word">✦ New Word</span> or [New Word])
 * - Alt + P: Pronunciation (<span data-tag-type="pronounce">🎯 Pronounce</span> or [Pronounce])
 * - Alt + Y: Correct (<span data-tag-type="correct">✓</span> or ✓ or "Say: ...")
 */
export function extractNotesMarkings(rawContent: string): {
  errors: { original: string; corrected?: string; context?: string }[];
  newWords: string[];
  pronounceItems: string[];
  positives: string[];
  vocabItems: string[];
  cleanText: string;
  correctCount: number;
  incorrectCount: number;
  newWordCount: number;
  pronounceCount: number;
} {
  if (!rawContent) {
    return {
      errors: [],
      newWords: [],
      pronounceItems: [],
      positives: [],
      vocabItems: [],
      cleanText: '',
      correctCount: 0,
      incorrectCount: 0,
      newWordCount: 0,
      pronounceCount: 0,
    };
  }

  // Count tags
  const tagCorrect = (rawContent.match(/data-tag-type=["']correct["']/g) || []).length;
  const tagIncorrect = (rawContent.match(/data-tag-type=["']incorrect["']/g) || []).length;
  const tagNewWord = (rawContent.match(/data-tag-type=["']new-word["']/g) || []).length;
  const tagPronounce = (rawContent.match(/data-tag-type=["']pronounce["']/g) || []).length;

  const plainCorrect = (rawContent.replace(/<span[^>]*data-tag-type=["']correct["'][^>]*>[\s\S]*?<\/span>/gi, '').match(/✓|✔/g) || []).length;
  const plainIncorrect = (rawContent.replace(/<span[^>]*data-tag-type=["']incorrect["'][^>]*>[\s\S]*?<\/span>/gi, '').match(/✗|✖/g) || []).length;
  const plainNewWord = (rawContent.replace(/<span[^>]*data-tag-type=["']new-word["'][^>]*>[\s\S]*?<\/span>/gi, '').match(/\[New Word\]/gi) || []).length;
  const plainPronounce = (rawContent.replace(/<span[^>]*data-tag-type=["']pronounce["'][^>]*>[\s\S]*?<\/span>/gi, '').match(/\[Pronounce\]/gi) || []).length;

  const correctCount = tagCorrect + plainCorrect;
  const incorrectCount = tagIncorrect + plainIncorrect;
  const newWordCount = tagNewWord + plainNewWord;
  const pronounceCount = tagPronounce + plainPronounce;

  // Convert HTML breaks to newlines
  const textWithBreaks = rawContent
    .replace(/<br\s*[\/]?>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<div>/gi, '')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<p>/gi, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');

  const lines = textWithBreaks.split('\n').map((l) => l.trim()).filter(Boolean);

  const errors: { original: string; corrected?: string; context?: string }[] = [];
  const newWords: string[] = [];
  const pronounceItems: string[] = [];
  const positives: string[] = [];
  const vocabItems: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check for Alt + W (New Word tag)
    const hasNewWord = /data-tag-type=["']new-word["']|\[New Word\]/i.test(line);
    if (hasNewWord) {
      const cleanTerm = cleanLineTags(
        line
          .replace(/<span[^>]*data-tag-type=["']new-word["'][^>]*>[\s\S]*?<\/span>/gi, '')
          .replace(/\[New Word\]/gi, '')
      ).trim();
      if (cleanTerm && cleanTerm.length > 1) {
        newWords.push(cleanTerm);
      }
      continue;
    }

    // Check for Alt + P (Pronounce tag)
    const hasPronounce = /data-tag-type=["']pronounce["']|\[Pronounce\]/i.test(line);
    if (hasPronounce) {
      const cleanTerm = cleanLineTags(
        line
          .replace(/<span[^>]*data-tag-type=["']pronounce["'][^>]*>[\s\S]*?<\/span>/gi, '')
          .replace(/\[Pronounce\]/gi, '')
      ).trim();
      if (cleanTerm && cleanTerm.length > 1) {
        pronounceItems.push(cleanTerm);
      }
      continue;
    }

    // Pattern 1: Inline HTML tag or symbol with both incorrect (Alt+N) and correct in same line
    // e.g. <span data-tag-type="incorrect">✗</span> I'm agree <span data-tag-type="correct">✓</span> I agree
    const hasIncorrect = /data-tag-type=["']incorrect["']|✗|✖/.test(line);
    const hasCorrect = /data-tag-type=["']correct["']|✓|✔/.test(line);

    if (hasIncorrect && hasCorrect) {
      const parts = line.split(/data-tag-type=["']correct["'][^>]*>[\s\S]*?<\/span>|✓|✔/);
      if (parts.length >= 2) {
        const origPart = cleanLineTags(parts[0]);
        const corrPart = cleanLineTags(parts[1]);
        if (origPart || corrPart) {
          errors.push({
            original: origPart.replace(/^(Instead of|Original|Mistake|Error):\s*/i, '').trim(),
            corrected: corrPart.replace(/^(Say|Corrected|Better|Correction):\s*/i, '').trim(),
            context: line,
          });
        }
        continue;
      }
    }

    // Pattern 2: Dedicated Incorrect tag line (Alt+N)
    if (hasIncorrect) {
      const cleaned = cleanLineTags(line);
      // Lookahead: Next line might be the correction!
      let lookaheadCorrection = '';
      if (i + 1 < lines.length && /data-tag-type=["']correct["']|✓|✔|^(Say|Better):/i.test(lines[i + 1])) {
        lookaheadCorrection = cleanLineTags(lines[i + 1]);
        i++; // skip next line
      }

      // Check if line contains "->" or "=>" or "Instead of"
      if (cleaned.includes('->') || cleaned.includes('=>') || cleaned.includes('Instead of') || cleaned.includes('Say:')) {
        const arrowParts = cleaned.split(/->|=>|Say:/i);
        errors.push({
          original: (arrowParts[0] || '').replace(/^(Instead of|Original|Mistake|Error):\s*/i, '').trim(),
          corrected: (arrowParts[1] || lookaheadCorrection || '').trim(),
          context: line,
        });
      } else {
        errors.push({
          original: cleaned,
          corrected: lookaheadCorrection || undefined,
          context: line,
        });
      }
      continue;
    }

    // Pattern 3: Dedicated Correct tag line
    if (hasCorrect) {
      const cleaned = cleanLineTags(line);
      positives.push(cleaned);
      continue;
    }

    // Pattern 4: Text-based "Instead of: ... Say: ..." (Alt+N mapping)
    if (/instead of/i.test(line) && /say/i.test(line)) {
      const match = line.match(/instead of:?\s*(.*?)(?:say:?\s*(.*)|$)/i);
      if (match) {
        errors.push({
          original: cleanLineTags(match[1] || ''),
          corrected: cleanLineTags(match[2] || ''),
          context: line,
        });
        continue;
      }
    }

    // Pattern 5: Vocabulary items or bullets
    if (line.startsWith('•') || line.startsWith('-') || line.startsWith('*')) {
      const item = cleanLineTags(line.replace(/^[•\-\*]\s*/, ''));
      if (item && !item.toLowerCase().includes('in-session notes') && !item.toLowerCase().includes('date:') && !item.toLowerCase().includes('student:') && !item.toLowerCase().includes('topic:')) {
        vocabItems.push(item);
      }
    }
  }

  // Clean full text for AI processing
  const cleanText = textWithBreaks.replace(/<[^>]+>/g, '').trim();

  return {
    errors,
    newWords,
    pronounceItems,
    positives,
    vocabItems,
    cleanText,
    correctCount,
    incorrectCount,
    newWordCount,
    pronounceCount,
  };
}

function cleanLineTags(str: string): string {
  return str
    .replace(/<span[^>]*>[\s\S]*?<\/span>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/✓|✔|✗|✖/g, '')
    .trim();
}

/**
 * Robust, pedagogical fallback generator that deterministically constructs
 * all 5 required sections based on CEFR level and detected markers.
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
  } = params;

  const markings = extractNotesMarkings(rawNotes);
  const cefrMeta = resolveCefrLevel(studentLevel);

  // Common L1 (Portuguese) error patterns & grammar rules
  const L1_PATTERNS = [
    {
      regex: /\b(have|has)\s+(\d{1,2})\s*(years|years old)?\b/i,
      category: 'grammar' as const,
      topic: 'Age expression (Be vs Have)',
      rule: 'In English, we express age using the verb "to be" (am / is / are), NEVER "have". In Portuguese, "ter anos" is used, which creates a classic false friend interference.',
      form: 'Subject + be (am/is/are) + [number] (years old)',
      usage: 'Used to state age, duration of life, or anniversary of things.',
      originalFallback: 'I have 28 years old',
      correctedFallback: 'I am 28 years old',
      explanation: 'Age is an ongoing physical and temporal state of being in English, not a tangible possession.',
      twoExamples: ['She is 34 years old.', 'When I was 20, I lived in London.'] as [string, string],
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
      originalFallback: "I'm agree with you",
      correctedFallback: 'I agree with you',
      explanation: 'In Portuguese, we say "Estou de acordo", which misleads learners into saying "I am agree".',
      twoExamples: ['I completely agree with your proposal.', 'Do you agree with the manager?'] as [string, string],
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
      originalFallback: 'It depends of the weather',
      correctedFallback: 'It depends on the weather',
      explanation: 'Portuguese speakers say "depende DE", causing automatic substitution of "de" with "of".',
      twoExamples: ['Our travel plans depend on the budget.', 'Success depends on daily consistency.'] as [string, string],
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
      originalFallback: 'Can I make a question?',
      correctedFallback: 'Can I ask a question?',
      explanation: 'Portuguese "fazer uma pergunta" leads to translating "fazer" as "make".',
      twoExamples: ['Feel free to ask questions at any point.', 'He asked me a tricky question about finance.'] as [string, string],
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
      originalFallback: 'I went to the store for buy coffee',
      correctedFallback: 'I went to the store to buy coffee',
      explanation: 'In Portuguese "para comprar" is translated with "para" -> "for". But in English, purpose of an action is expressed by the bare infinitive with "to".',
      twoExamples: ['I called him to confirm our meeting time.', 'She exercises daily to stay energized.'] as [string, string],
      commonPitfalls: 'Saying "for to buy" or "for buying" when indicating your personal goal or immediate reason.',
      comparisons: 'To buy (purpose of action) vs For buying (purpose of an object or tool)',
    },
  ];

  // 1. Build Section 1: Mistakes Analysis
  const mistakesAnalysis: PedagogicalMistakeAnalysis[] = [];
  const processedSignatures = new Set<string>();

  // Process detected errors from raw notes
  for (const err of markings.errors) {
    const rawOrig = (err.original || '').trim();
    if (!rawOrig || processedSignatures.has(rawOrig.toLowerCase())) continue;
    processedSignatures.add(rawOrig.toLowerCase());

    // Check if it matches an L1 pattern
    const matchedPattern = L1_PATTERNS.find((p) => p.regex.test(rawOrig) || (err.corrected && p.regex.test(err.corrected)));

    if (matchedPattern) {
      mistakesAnalysis.push({
        id: `mistake-${mistakesAnalysis.length + 1}`,
        original: rawOrig,
        corrected: err.corrected || matchedPattern.correctedFallback,
        category: matchedPattern.category,
        explanation: matchedPattern.explanation,
        twoExamples: matchedPattern.twoExamples,
        commonPitfalls: matchedPattern.commonPitfalls,
      });
    } else {
      // Intelligent heuristic for general mistakes
      const correctedText = err.corrected || (rawOrig.includes('->') ? rawOrig.split('->')[1].trim() : rawOrig);
      mistakesAnalysis.push({
        id: `mistake-${mistakesAnalysis.length + 1}`,
        original: rawOrig,
        corrected: correctedText,
        category: 'grammar',
        explanation: `In native spoken English, phrasing this structure as "${correctedText}" aligns naturally with conversational rhythm and grammatical precision.`,
        twoExamples: [
          `In everyday conversation: "${correctedText}".`,
          `Alternative formulation: "I prefer saying ${correctedText} to sound natural and clear."`,
        ],
        commonPitfalls: `Reverting to literal native language syntax instead of adopting natural English phraseology.`,
      });
    }
  }

  // If few or no explicit errors found, add 2 relevant foundational coaching points tailored to CEFR level
  if (mistakesAnalysis.length === 0) {
    if (cefrMeta.cefr === 'A1' || cefrMeta.cefr === 'A2') {
      mistakesAnalysis.push({
        id: 'mistake-foundational-1',
        original: 'I have 28 years old',
        corrected: 'I am 28 years old',
        category: 'grammar',
        explanation: 'In English, age is expressed with the verb "to be" (am/is/are), not with "to have".',
        twoExamples: ['I am 28 years old.', 'My friend is 30 years old.'],
        commonPitfalls: 'Translating Portuguese "Eu tenho 28 anos" directly as "I have 28 years".',
      });
      mistakesAnalysis.push({
        id: 'mistake-foundational-2',
        original: 'It depends of the day',
        corrected: 'It depends on the day',
        category: 'preposition',
        explanation: 'The verb "depend" always pairs with the preposition "ON", never "of".',
        twoExamples: ['It depends on the traffic.', 'Our schedule depends on the weather.'],
        commonPitfalls: 'Saying "depend of" because of Portuguese "depender de".',
      });
    } else {
      mistakesAnalysis.push({
        id: 'mistake-foundational-1',
        original: "I'm agree with you",
        corrected: 'I agree with you',
        category: 'grammar',
        explanation: '"Agree" is an active verb, not an adjective. We say "I agree", without "am".',
        twoExamples: ['I agree with your suggestion.', 'I don\'t agree with that strategy.'],
        commonPitfalls: 'Saying "I am agree" or negative "I am not agree".',
      });
      mistakesAnalysis.push({
        id: 'mistake-foundational-2',
        original: 'Can I make a question?',
        corrected: 'Can I ask a question?',
        category: 'collocation',
        explanation: 'In natural English, you "ask a question", not "make a question".',
        twoExamples: ['May I ask a quick question?', 'He asked an interesting question.'],
        commonPitfalls: 'Translating "fazer uma pergunta" literally as "make a question".',
      });
    }
  }

  // 2. Build Section 2: Teach Grammar Points
  const grammarPoints: PedagogicalGrammarPoint[] = [];

  // Match grammar points to mistakes or theme
  const hasAgreeMistake = mistakesAnalysis.some((m) => /agree/i.test(m.original) || /agree/i.test(m.corrected));
  const hasAgeMistake = mistakesAnalysis.some((m) => /year/i.test(m.original) || /have.*old/i.test(m.original));
  const hasPrepositionMistake = mistakesAnalysis.some((m) => m.category === 'preposition' || /depend/i.test(m.original));

  if (hasAgreeMistake || cefrMeta.cefr !== 'A1') {
    grammarPoints.push({
      id: 'grammar-1',
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

  if (hasPrepositionMistake || grammarPoints.length < 2) {
    grammarPoints.push({
      id: 'grammar-2',
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

  if (hasAgeMistake || grammarPoints.length < 2) {
    grammarPoints.push({
      id: 'grammar-3',
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

  // 3. Build Section 3: Teach Vocabulary and Expressions (Mapped from Alt+W and Alt+P + bullets)
  const vocabularyAndExpressions: PedagogicalVocabularyItem[] = [];

  // Combine Alt+W (New Word), Alt+P (Pronounce), and general vocab markings
  const candidateVocab = [...markings.newWords, ...markings.pronounceItems, ...markings.vocabItems];
  if (candidateVocab.length === 0) {
    candidateVocab.push('catch up', 'workload', 'streamline', 'make sense', 'get the hang of');
  }

  const VOCAB_DATABASE: Record<string, Omit<PedagogicalVocabularyItem, 'id' | 'term'>> = {
    ...Object.fromEntries(
      Object.entries(NATIVE_FRIENDS_DICTIONARY_DATABASE).map(([key, item]) => [
        key,
        {
          partOfSpeech: item.partOfSpeech,
          simpleDefinition: item.definitionEn,
          collocations: item.collocations || [`use "${item.word}" naturally`],
          realExamples: item.realExamples || [item.exampleSentenceEn],
          synonyms: item.synonyms || ['target phrase'],
          register: item.register || ('neutral' as const),
          category: item.category || 'Core Session Vocabulary',
        },
      ])
    ),
  };

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

    const entry = VOCAB_DATABASE[cleanWord] || (dbMatch ? {
      partOfSpeech: dbMatch.partOfSpeech,
      simpleDefinition: dbMatch.definitionEn,
      collocations: dbMatch.collocations || [`use "${rawTrimmed}" naturally`],
      realExamples: dbMatch.realExamples || [dbMatch.exampleSentenceEn],
      synonyms: dbMatch.synonyms || ['target phrase'],
      register: dbMatch.register || ('neutral' as const),
      category: isPronounce ? 'Pronunciation & Phonetics (Alt+P)' : isNewWord ? 'New Words & Expressions (Alt+W)' : 'Core Session Vocabulary',
    } : {
      partOfSpeech: isPronounce
        ? 'Pronunciation Focus'
        : cleanWord.includes(' ')
        ? 'Idiomatic Expression'
        : 'Vocabulary Item',
      simpleDefinition: isPronounce
        ? `Pronunciation focus: Pay careful attention to the syllable stress, vowel reduction, and clear consonant articulation of "${rawTrimmed}".`
        : `Key communicative expression (${cefrMeta.cefr}): used in conversation to communicate "${rawTrimmed}" clearly and naturally.`,
      collocations: [`use "${rawTrimmed}" naturally`, `frequently heard with "${rawTrimmed}"`],
      realExamples: [
        `In daily speaking: "I practiced using '${rawTrimmed}' naturally in our conversation today."`,
        `Practice sentence: "Understanding how native speakers say '${rawTrimmed}' makes your speech flow smoothly."`,
      ],
      synonyms: ['natural expression', 'target phrase'],
      register: 'neutral' as const,
      category: isPronounce ? 'Pronunciation & Phonetics (Alt+P)' : isNewWord ? 'New Words & Expressions (Alt+W)' : 'Core Session Vocabulary',
    });

    vocabularyAndExpressions.push({
      id: `vocab-${vocabularyAndExpressions.length + 1}`,
      term: rawTrimmed,
      cefrLevel: dbMatch?.cefrLevel || cefrMeta.cefr,
      ...entry,
      phoneticGuide: isPronounce ? `🎯 Pronunciation focus: practice clean syllable stress on "${rawTrimmed}" without adding Portuguese final vowels.` : (dbMatch?.phonetic || undefined),
      isPronunciationFocus: isPronounce,
    });
  });

  // CEFR Level Adaptation metadata (dynamically applied across all remaining tabs)
  const levelAdaptation: PedagogicalLevelAdaptation = {
    cefrLevel: cefrMeta.cefr,
    levelLabel: cefrMeta.labelEn,
    nativeInterferenceNotes:
      cefrMeta.cefr === 'A1' || cefrMeta.cefr === 'A2'
        ? 'At the A1-A2 level, Brazilian Portuguese speakers frequently transfer basic word order and verb structures directly into English (e.g. "I have 25 years" instead of "I am 25", and omitting the subject pronoun "it" in "is raining" instead of "it is raining"). Focus on short, declarative subject-verb-object building blocks and anchor common prepositions (in/on/at).'
        : cefrMeta.cefr === 'B1' || cefrMeta.cefr === 'B2'
        ? 'At the B1-B2 level, learners speak comfortably but often encounter subtle preposition collocations ("depend on" vs "depend of", "interested in" vs "interested on"), false friends ("pretend" vs "intend", "actually" vs "currently"), and over-reliance on simple verb forms. Prioritize conversational collocations and connecting phrases.'
        : 'At the C1-C2 level, focus shifts to pragmatic nuance, sophisticated idiomatic expressions, tone calibration, and eliminating residual syntactic Portuguese calques to achieve effortless executive fluency.',
    complexityAdjustmentAdvice:
      cefrMeta.cefr === 'A1' || cefrMeta.cefr === 'A2'
        ? 'Keep sentences short, clear, and grounded in daily concrete actions. Repeat the corrected phrase out loud 3 times.'
        : 'Integrate the new vocabulary into spontaneous 2-minute speaking monologues before your next live session.',
    targetedPracticePrompt: `Describe your typical routine or recent experiences regarding "${topic}", making sure to incorporate at least two of the corrected phrases and vocabulary items.`,
  };

  // 4. Build Section 4: Create a 5-10 Minute Quick Review Summary
  // MANDATORY: ALL session notes, corrections, and processed terms MUST compose the Quick Review
  const reviewSummary: PedagogicalReviewSummary = {
    estimatedMinutes: '5–10 minutes',
    // ALL grammar rules from session
    keyRules: grammarPoints.map((gp) => `${gp.topic}: ${gp.rule}`),
    // ALL must-know vocabulary & pronunciation items from session
    mustKnowVocabulary: vocabularyAndExpressions.map((v) => {
      const tag = v.isPronunciationFocus ? '🎯 [Pronounce]' : '✨';
      return `${tag} ${v.term} (${v.partOfSpeech}) — ${v.simpleDefinition}`;
    }),
    // ALL essential corrections from session (NO slicing)
    essentialCorrections: mistakesAnalysis.map((m) => ({
      original: m.original,
      corrected: m.corrected,
      explanation: m.explanation,
    })),
    rememberThis:
      mistakesAnalysis.length > 0
        ? `Remember this: Instead of saying "${mistakesAnalysis[0].original}", always say "${mistakesAnalysis[0].corrected}"! Consistent small shifts in your active vocabulary build unstoppable speaking confidence.`
        : `Remember this: Fluency is not about never making mistakes; it is about recognizing patterns quickly and adopting natural native phraseology!`,
  };

  const sessionKey = lessonId
    ? `lesson_${lessonId}`
    : `student_${(studentEmail || '').toLowerCase().trim()}_${sessionDate}`;

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
    console.warn('Backend pedagogical transform request failed, falling back to local synthesizer:', err);
  }

  // Graceful deterministic fallback
  return generateLocalPedagogicalTransformation({
    rawNotes,
    topic,
    sessionDate,
    teacherName,
    studentLevel,
    studentUid,
    studentEmail,
    lessonId,
  });
}
