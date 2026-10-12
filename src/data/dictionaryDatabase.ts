import { StudentDictionaryEntry } from '../types';

export interface PedagogicalWordEntry {
  word: string;
  partOfSpeech: string;
  definitionEn: string;
  exampleSentenceEn: string;
  translationPt?: string;
  cefrLevel: 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';
  collocations?: string[];
  realExamples?: string[];
  synonyms?: string[];
  register?: 'informal' | 'neutral' | 'formal' | 'idiomatic';
  category?: string;
  phonetic?: string;
}

/**
 * Standard Native Friend Notes Vocabulary Repository.
 * All entries follow the rigorous validated pedagogical standards of Native Friend Notes:
 * - Specific grammatical class (part of speech)
 * - Clear, learner-friendly pedagogical definition in English
 * - Assigned CEFR level (A1 to C2)
 * - Real, authentic conversational example sentences
 * - Natural collocations, synonyms, and register
 */
export const NATIVE_FRIENDS_DICTIONARY_DATABASE: Record<string, PedagogicalWordEntry> = {
  'catch up': {
    word: 'catch up',
    partOfSpeech: 'Phrasal Verb',
    cefrLevel: 'B1',
    definitionEn: 'To talk with someone you haven’t seen in a while to exchange the latest life or work news.',
    exampleSentenceEn: 'Let’s grab a quick coffee this afternoon to catch up.',
    translationPt: 'colocar a conversa em dia',
    collocations: ['catch up with a friend', 'catch up on work', 'play catch-up'],
    realExamples: [
      'Let’s grab a quick coffee this afternoon to catch up.',
      'I spent Saturday morning catching up on my favorite podcasts.',
    ],
    synonyms: ['reconnect', 'update each other', 'get up to date'],
    register: 'informal',
    category: 'Phrasal Verbs & Social Life',
    phonetic: '/kætʃ ʌp/',
  },
  workload: {
    word: 'workload',
    partOfSpeech: 'Noun (Uncountable)',
    cefrLevel: 'B2',
    definitionEn: 'The amount of work that someone has to do within a given period.',
    exampleSentenceEn: 'Her workload has been intense since the new project launched.',
    translationPt: 'carga de trabalho',
    collocations: ['heavy workload', 'manageable workload', 'reduce workload'],
    realExamples: [
      'Her workload has been intense since the new project launched.',
      'We need to delegate tasks to keep the team workload balanced.',
    ],
    synonyms: ['volume of work', 'duties', 'commitments'],
    register: 'neutral',
    category: 'Work & Productivity',
    phonetic: '/ˈwɜːrkloʊd/',
  },
  streamline: {
    word: 'streamline',
    partOfSpeech: 'Verb',
    cefrLevel: 'C1',
    definitionEn: 'To make an organization, process, or system more efficient and simpler.',
    exampleSentenceEn: 'The team introduced new software to streamline weekly reporting.',
    translationPt: 'otimizar / simplificar',
    collocations: ['streamline the process', 'streamline operations', 'streamline workflow'],
    realExamples: [
      'The team introduced new software to streamline weekly reporting.',
      'Streamlining our morning routine saves at least thirty minutes.',
    ],
    synonyms: ['simplify', 'optimize', 'make efficient'],
    register: 'formal',
    category: 'Professional & Business',
    phonetic: '/ˈstriːmlaɪn/',
  },
  'make sense': {
    word: 'make sense',
    partOfSpeech: 'Idiomatic Phrase',
    cefrLevel: 'B1',
    definitionEn: 'To be intelligible, reasonable, or wise to do.',
    exampleSentenceEn: 'It makes sense to practice speaking for 10 minutes every single day.',
    translationPt: 'fazer sentido',
    collocations: ['that makes a lot of sense', 'make sense to do something', 'doesn’t make sense'],
    realExamples: [
      'Does the new schedule make sense to everyone?',
      'It makes sense to practice speaking for 10 minutes every single day.',
    ],
    synonyms: ['be logical', 'be understandable', 'be justifiable'],
    register: 'neutral',
    category: 'Everyday Fluency Expressions',
    phonetic: '/meɪk sɛns/',
  },
  'get the hang of': {
    word: 'get the hang of',
    partOfSpeech: 'Idiomatic Expression',
    cefrLevel: 'B2',
    definitionEn: 'To learn how to do or use something that is not easy at first.',
    exampleSentenceEn: 'At first pronunciation was tricky, but I am getting the hang of it.',
    translationPt: 'pegar o jeito de',
    collocations: ['get the hang of it', 'finally get the hang of', 'take time to get the hang of'],
    realExamples: [
      'At first pronunciation was tricky, but I am getting the hang of it.',
      'Once you get the hang of the past continuous, storytelling becomes natural.',
    ],
    synonyms: ['master', 'become proficient in', 'figure out'],
    register: 'informal',
    category: 'Idioms & Fluency Boosters',
    phonetic: '/ɡɛt ðə hæŋ ʌv/',
  },
  routine: {
    word: 'routine',
    partOfSpeech: 'Noun',
    cefrLevel: 'A2',
    definitionEn: 'A regular way of doing things in a fixed order.',
    exampleSentenceEn: 'A daily morning routine helps build consistent speaking habits.',
    translationPt: 'rotina',
    collocations: ['daily routine', 'morning routine', 'stick to a routine'],
    realExamples: [
      'A daily morning routine helps build consistent speaking habits.',
      'She adjusted her daily routine to include English listening practice.',
    ],
    synonyms: ['pattern', 'habit', 'schedule'],
    register: 'neutral',
    category: 'Daily Life',
    phonetic: '/ruːˈtiːn/',
  },
  schedule: {
    word: 'schedule',
    partOfSpeech: 'Noun',
    cefrLevel: 'B1',
    definitionEn: 'A plan that gives expected times for different events or tasks.',
    exampleSentenceEn: 'I checked my schedule to book my next live conversation session.',
    translationPt: 'cronograma / agenda',
    collocations: ['busy schedule', 'on schedule', 'ahead of schedule'],
    realExamples: [
      'I checked my schedule to book my next live conversation session.',
      'We managed to finish the presentation ahead of schedule.',
    ],
    synonyms: ['timetable', 'calendar', 'agenda'],
    register: 'neutral',
    category: 'Time & Organization',
    phonetic: '/ˈskɛdʒuːl/',
  },
  commute: {
    word: 'commute',
    partOfSpeech: 'Verb',
    cefrLevel: 'B1',
    definitionEn: 'To travel regularly between home and work or school.',
    exampleSentenceEn: 'I commute by train and listen to English podcasts during the ride.',
    translationPt: 'deslocar-se para o trabalho',
    collocations: ['daily commute', 'commute to work', 'long commute'],
    realExamples: [
      'I commute by train and listen to English podcasts during the ride.',
      'Her morning commute takes about forty-five minutes.',
    ],
    synonyms: ['travel', 'journey'],
    register: 'neutral',
    category: 'Daily Travel',
    phonetic: '/kəˈmjuːt/',
  },
  feedback: {
    word: 'feedback',
    partOfSpeech: 'Noun (Uncountable)',
    cefrLevel: 'B1',
    definitionEn: 'Information about reactions to a person’s performance of a task, used as a basis for improvement.',
    exampleSentenceEn: 'The Native Friend gave encouraging feedback on my pronunciation.',
    translationPt: 'feedback / retorno',
    collocations: ['constructive feedback', 'give feedback', 'receive feedback'],
    realExamples: [
      'The Native Friend gave encouraging feedback on my pronunciation.',
      'Constructive feedback helps you correct recurring mistakes quickly.',
    ],
    synonyms: ['evaluation', 'critique', 'assessment'],
    register: 'neutral',
    category: 'Communication & Learning',
    phonetic: '/ˈfiːdbæk/',
  },
  workflow: {
    word: 'workflow',
    partOfSpeech: 'Noun',
    cefrLevel: 'B2',
    definitionEn: 'The sequence of industrial, administrative, or other processes through which a piece of work passes from initiation to completion.',
    exampleSentenceEn: 'Establishing a clear daily workflow prevents unexpected delays.',
    translationPt: 'fluxo de trabalho',
    collocations: ['improve workflow', 'daily workflow', 'efficient workflow'],
    realExamples: [
      'Establishing a clear daily workflow prevents unexpected delays.',
      'Our team adjusted the project workflow to improve communication.',
    ],
    synonyms: ['process', 'procedure', 'operations'],
    register: 'formal',
    category: 'Professional & Business',
    phonetic: '/ˈwɜːrkfloʊ/',
  },
  brainstorm: {
    word: 'brainstorm',
    partOfSpeech: 'Verb',
    cefrLevel: 'B2',
    definitionEn: 'To produce an idea or way of solving a problem by holding a spontaneous group discussion.',
    exampleSentenceEn: 'We met for thirty minutes to brainstorm new topics for next week.',
    translationPt: 'fazer tempestade de ideias',
    collocations: ['brainstorm ideas', 'brainstorm solutions', 'brainstorming session'],
    realExamples: [
      'We met for thirty minutes to brainstorm new topics for next week.',
      'Let’s brainstorm three practical ways to improve conversational flow.',
    ],
    synonyms: ['generate ideas', 'ideate', 'deliberate'],
    register: 'neutral',
    category: 'Productivity & Creativity',
    phonetic: '/ˈbreɪnstɔːrm/',
  },
  deadline: {
    word: 'deadline',
    partOfSpeech: 'Noun',
    cefrLevel: 'B1',
    definitionEn: 'The latest time or date by which something should be completed.',
    exampleSentenceEn: 'We met the project deadline with several hours to spare.',
    translationPt: 'prazo final',
    collocations: ['meet a deadline', 'tight deadline', 'miss a deadline'],
    realExamples: [
      'We met the project deadline with several hours to spare.',
      'Working under a tight deadline requires strong focus.',
    ],
    synonyms: ['due date', 'time limit', 'target date'],
    register: 'neutral',
    category: 'Work & Organization',
    phonetic: '/ˈdɛdlaɪn/',
  },
  'touch base': {
    word: 'touch base',
    partOfSpeech: 'Idiomatic Phrase',
    cefrLevel: 'B2',
    definitionEn: 'To briefly make contact or communicate with someone to update each other.',
    exampleSentenceEn: 'Let’s touch base on Friday afternoon before finalizing the plan.',
    translationPt: 'fazer contato / alinhar brevemente',
    collocations: ['touch base with someone', 'touch base briefly', 'touch base next week'],
    realExamples: [
      'Let’s touch base on Friday afternoon before finalizing the plan.',
      'I wanted to touch base regarding the points we discussed in our live lesson.',
    ],
    synonyms: ['check in', 'make contact', 'reconnect'],
    register: 'informal',
    category: 'Communication & Business',
    phonetic: '/tʌtʃ beɪs/',
  },
  'follow up': {
    word: 'follow up',
    partOfSpeech: 'Phrasal Verb',
    cefrLevel: 'B1',
    definitionEn: 'To pursue the development of something or take further action regarding a previous event.',
    exampleSentenceEn: 'I will follow up with the tutor by sending my revised sentence.',
    translationPt: 'dar seguimento / acompanhar',
    collocations: ['follow up on an email', 'follow up with someone', 'follow-up meeting'],
    realExamples: [
      'I will follow up with the tutor by sending my revised sentence.',
      'Always follow up on your weekly study commitments.',
    ],
    synonyms: ['pursue', 'check back', 'continue'],
    register: 'neutral',
    category: 'Work & Communication',
    phonetic: '/ˈfɒloʊ ʌp/',
  },
  'figure out': {
    word: 'figure out',
    partOfSpeech: 'Phrasal Verb',
    cefrLevel: 'B1',
    definitionEn: 'To solve or discover the cause or solution of a problem through thought.',
    exampleSentenceEn: 'It took me a few minutes to figure out the right preposition.',
    translationPt: 'compreender / desvendar',
    collocations: ['figure out a solution', 'finally figure out', 'figure out how to'],
    realExamples: [
      'It took me a few minutes to figure out the right preposition.',
      'Once you figure out the formula, daily practice feels effortless.',
    ],
    synonyms: ['understand', 'resolve', 'decipher'],
    register: 'informal',
    category: 'Cognitive & Problem Solving',
    phonetic: '/ˈfɪɡjər aʊt/',
  },
  'look forward to': {
    word: 'look forward to',
    partOfSpeech: 'Phrasal Verb',
    cefrLevel: 'B1',
    definitionEn: 'To feel happy and excited about something that is going to happen in the future.',
    exampleSentenceEn: 'I always look forward to my Wednesday live lesson with my Native Friend.',
    translationPt: 'aguardar com expectativa',
    collocations: ['look forward to hearing from you', 'look forward to seeing', 'really look forward to'],
    realExamples: [
      'I always look forward to my Wednesday live lesson with my Native Friend.',
      'We look forward to beginning our next weekly cycle.',
    ],
    synonyms: ['anticipate with pleasure', 'await eagerly'],
    register: 'neutral',
    category: 'Emotions & Future',
    phonetic: '/lʊk ˈfɔːrwərd tuː/',
  },
  'wrap up': {
    word: 'wrap up',
    partOfSpeech: 'Phrasal Verb',
    cefrLevel: 'B1',
    definitionEn: 'To bring something to a conclusion or finish a session.',
    exampleSentenceEn: 'Let’s wrap up our practice by reviewing the five key words of the day.',
    translationPt: 'concluir / finalizar',
    collocations: ['wrap up a meeting', 'wrap up the day', 'wrap things up'],
    realExamples: [
      'Let’s wrap up our practice by reviewing the five key words of the day.',
      'We should wrap up the call before the next scheduled lesson.',
    ],
    synonyms: ['conclude', 'finalize', 'finish'],
    register: 'informal',
    category: 'Everyday Fluency',
    phonetic: '/ræp ʌp/',
  },
};

export const COMMON_ROUTINE_DICTIONARY: Record<string, Omit<StudentDictionaryEntry, 'id'>> = Object.fromEntries(
  Object.entries(NATIVE_FRIENDS_DICTIONARY_DATABASE).map(([key, item]) => [
    key,
    {
      word: item.word,
      partOfSpeech: item.partOfSpeech,
      definitionEn: item.definitionEn,
      exampleSentenceEn: item.exampleSentenceEn,
      translationPt: item.translationPt || '',
      cefrLevel: item.cefrLevel,
    },
  ])
);

/**
 * Returns dictionary definition adhering to the Native Friend Notes standard.
 */
export function getDictionaryDefinition(
  rawWord: string,
  _context?: string
): Omit<StudentDictionaryEntry, 'id'> {
  const cleanKey = rawWord.toLowerCase().trim();
  const normalizedKey = cleanKey.replace(/[_\-]+/g, ' ');

  if (NATIVE_FRIENDS_DICTIONARY_DATABASE[cleanKey]) {
    const entry = NATIVE_FRIENDS_DICTIONARY_DATABASE[cleanKey];
    return {
      word: entry.word,
      partOfSpeech: entry.partOfSpeech,
      definitionEn: entry.definitionEn,
      exampleSentenceEn: entry.exampleSentenceEn,
      translationPt: entry.translationPt || '',
      cefrLevel: entry.cefrLevel,
    };
  }

  if (NATIVE_FRIENDS_DICTIONARY_DATABASE[normalizedKey]) {
    const entry = NATIVE_FRIENDS_DICTIONARY_DATABASE[normalizedKey];
    return {
      word: entry.word,
      partOfSpeech: entry.partOfSpeech,
      definitionEn: entry.definitionEn,
      exampleSentenceEn: entry.exampleSentenceEn,
      translationPt: entry.translationPt || '',
      cefrLevel: entry.cefrLevel,
    };
  }

  const wordTrimmed = rawWord.trim();
  return {
    word: wordTrimmed,
    partOfSpeech: '',
    definitionEn: '',
    exampleSentenceEn: '',
    translationPt: '',
  };
}

/**
 * Returns instant simplified English definition & example sentence for live sessions and daily words
 */
export function getInstantVocabEntry(
  word: string,
  context?: string
): {
  word: string;
  definitionEn: string;
  exampleSentenceEn: string;
  partOfSpeech?: string;
  cefrLevel?: string;
} {
  const entry = getDictionaryDefinition(word, context);
  return {
    word: entry.word,
    definitionEn: entry.definitionEn,
    exampleSentenceEn: entry.exampleSentenceEn || '',
    partOfSpeech: entry.partOfSpeech,
    cefrLevel: entry.cefrLevel,
  };
}
