import {
  WeeklyHomeworkData,
  UserProfile,
  RoutineItem,
  DayOfWeek,
  HomeworkVocabItem,
  MatchingPair,
  FillInBlankItem,
  SentenceWritingPrompt,
  ReadingQuestion,
  ReadingPassage,
  DailyHomeworkActivity,
  WordOriginSnapshot,
  LiveLesson,
} from '../types';
import { getActivityDisplayName } from './i18n';
import {
  synthesizeCohesiveStoryAndQuestions,
  synthesizeFillInBlanks,
  profileWord,
  isBadStoryText,
} from './pedagogicalStorySynthesizer';
import { auth } from '../firebase';
import { normalizeDictionaryWord } from './studentDictionaryLibrary';
import { isValidHomeworkEvaluation, isSyntheticHomeworkEvaluation } from './writingChecker';
import { getStudentCurrentDayOfWeek, DEFAULT_STUDENT_TIMEZONE } from './timezone';

// Rich dictionary knowledge base for routine words
const ROUTINE_VOCAB_DICT: Record<
  string,
  { translationPt: string; definitionEn: string; exampleSentence: string }
> = {
  brew: {
    translationPt: 'Preparar / Fazer infusão (café ou chá)',
    definitionEn: 'To make a hot drink like tea or coffee by soaking ingredients in boiling water.',
    exampleSentence: 'I brew fresh coffee every morning to start my routine.',
  },
  pour: {
    translationPt: 'Despejar / Servir líquido',
    definitionEn: 'To cause a liquid to flow from a container into another vessel.',
    exampleSentence: 'She poured hot milk into her morning mug.',
  },
  mug: {
    translationPt: 'Caneca',
    definitionEn: 'A large cup with a handle, used typically for hot drinks.',
    exampleSentence: 'I drink warm green tea from my favorite ceramic mug.',
  },
  toast: {
    translationPt: 'Torrada / Pão torrado',
    definitionEn: 'Sliced bread made crisp and brown by heat.',
    exampleSentence: 'He spreads creamy butter over hot breakfast toast.',
  },
  'scrambled eggs': {
    translationPt: 'Ovos mexidos',
    definitionEn: 'Eggs beaten with milk or water and cooked gently until firm.',
    exampleSentence: 'Scrambled eggs are a nutritious breakfast staple.',
  },
  skillet: {
    translationPt: 'Frigideira',
    definitionEn: 'A small flat-bottomed pan with a long handle used for frying food.',
    exampleSentence: 'He heated butter in the skillet before adding eggs.',
  },
  sip: {
    translationPt: 'Dar um gole / Beber em pequenos goles',
    definitionEn: 'To drink something by taking small mouthfuls.',
    exampleSentence: 'I take a slow sip of hot coffee while checking the morning news.',
  },
  aroma: {
    translationPt: 'Aroma / Cheiro agradável',
    definitionEn: 'A pleasant, distinctive smell, especially of food or coffee.',
    exampleSentence: 'The rich aroma of roasted coffee filled the entire kitchen.',
  },
  commute: {
    translationPt: 'Deslocamento diário / Trajeto',
    definitionEn: 'Travel some distance regularly between home and place of work.',
    exampleSentence: 'My morning commute is a great time to listen to English podcasts.',
  },
  subway: {
    translationPt: 'Metrô',
    definitionEn: 'An underground electric railroad system in a city.',
    exampleSentence: 'I take the subway to downtown every weekday morning.',
  },
  transit: {
    translationPt: 'Transporte público / Trânsito',
    definitionEn: 'The carrying of people from one place to another on public conveyances.',
    exampleSentence: 'Public transit is fast and environmentally friendly.',
  },
  meeting: {
    translationPt: 'Reunião de trabalho',
    definitionEn: 'An assembly of people for discussion or all-hands collaboration.',
    exampleSentence: 'We held a productive 30-minute status meeting with the team.',
  },
  deadline: {
    translationPt: 'Prazo limite de entrega',
    definitionEn: 'The latest time or date by which something should be completed.',
    exampleSentence: 'Meeting our project deadline required strong team focus.',
  },
  schedule: {
    translationPt: 'Cronograma / Agenda diária',
    definitionEn: 'A plan that gives a list of events or tasks and the times they will happen.',
    exampleSentence: 'I review my daily schedule every morning over coffee.',
  },
  email: {
    translationPt: 'E-mail / Correio eletrônico',
    definitionEn: 'Messages distributed by electronic means from one computer user to others.',
    exampleSentence: 'I responded to priority client emails before lunch.',
  },
  lunch: {
    translationPt: 'Almoço',
    definitionEn: 'A meal eaten in the middle of the day.',
    exampleSentence: 'We had a healthy lunch with fresh salad and grilled chicken.',
  },
  workout: {
    translationPt: 'Treino / Exercício físico',
    definitionEn: 'A session of vigorous physical exercise or training.',
    exampleSentence: 'A 45-minute workout keeps both body and mind sharp.',
  },
  treadmill: {
    translationPt: 'Esteira ergométrica',
    definitionEn: 'An exercise machine on which one walks or runs while remaining in one place.',
    exampleSentence: 'She completed a brisk 20-minute run on the treadmill.',
  },
  stretch: {
    translationPt: 'Alongar-se / Alongamento',
    definitionEn: 'To straighten or extend one\'s body or limbs to improve flexibility.',
    exampleSentence: 'It feels great to stretch after a long day at the desk.',
  },
  relax: {
    translationPt: 'Relaxar / Descansar',
    definitionEn: 'To rest from work or engage in an enjoyable peaceful activity.',
    exampleSentence: 'In the evening, I relax by reading a book with soothing music.',
  },
  unwind: {
    translationPt: 'Descontrair / Desacelerar',
    definitionEn: 'To relax after a period of work or tension.',
    exampleSentence: 'Drinking chamomile tea helps me unwind before bed.',
  },
  journal: {
    translationPt: 'Diário de reflexão / Anotações',
    definitionEn: 'A daily record of personal experiences, thoughts, and reflections.',
    exampleSentence: 'Writing in my English journal locks in my daily vocabulary.',
  },
  progress: {
    translationPt: 'Progresso / Evolução contínua',
    definitionEn: 'Forward or onward movement toward a goal or higher proficiency.',
    exampleSentence: 'Every small daily routine action creates immense speaking progress.',
  },
  today: {
    translationPt: 'Hoje / No dia de hoje',
    definitionEn: 'The present day, or this current 24-hour period.',
    exampleSentence: 'We need to finish our priority client tasks today before leaving.',
  },
  tomorrow: {
    translationPt: 'Amanhã / No dia seguinte',
    definitionEn: 'The day that comes immediately after today.',
    exampleSentence: 'Let us reschedule our project review for tomorrow morning.',
  },
  project: {
    translationPt: 'Projeto / Trabalho estruturado',
    definitionEn: 'A collaborative effort or set of tasks planned to achieve a goal.',
    exampleSentence: 'Our team completed the software project ahead of the deadline.',
  },
  piece: {
    translationPt: 'Peça / Parte / Documento',
    definitionEn: 'A distinct portion, document, or element of a larger whole.',
    exampleSentence: 'Writing the executive summary is the final piece of the proposal.',
  },
  task: {
    translationPt: 'Tarefa / Atividade a cumprir',
    definitionEn: 'A specific piece of work to be done or undertaken.',
    exampleSentence: 'I focus on one challenging task at a time to stay productive.',
  },
  coffee: {
    translationPt: 'Café',
    definitionEn: 'A hot aromatic beverage brewed from roasted coffee beans.',
    exampleSentence: 'I enjoy a warm cup of coffee while reviewing my morning schedule.',
  },
};

export const DAYS_OF_WEEK: DayOfWeek[] = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
];

export interface DailyMemorizationScheduleInfo {
  day: DayOfWeek;
  dayIndexInWeek: number;
  overallDayIndex: number;
  partNumber: 1 | 2 | 3 | 4;
  partKey: 'matching' | 'fill' | 'writing' | 'reading';
  partTitlePt: string;
  partTitleEn: string;
  partDescPt: string;
  partDescEn: string;
}

export const PART_KEY_BY_NUMBER: Record<1 | 2 | 3 | 4, 'matching' | 'fill' | 'writing' | 'reading'> = {
  1: 'matching',
  2: 'fill',
  3: 'writing',
  4: 'reading',
};

export const PART_INFO: Record<
  1 | 2 | 3 | 4,
  {
    partKey: 'matching' | 'fill' | 'writing' | 'reading';
    titlePt: string;
    titleEn: string;
    descPt: string;
    descEn: string;
  }
> = {
  1: {
    partKey: 'matching',
    titlePt: 'Parte 1: Associação de Vocabulário',
    titleEn: 'Part 1: Vocabulary Matching',
    descPt: 'Associe as palavras do dia ao seu significado em inglês e tradução.',
    descEn: 'Match today’s vocabulary to definitions and translations.',
  },
  2: {
    partKey: 'fill',
    titlePt: 'Parte 2: Preenchimento de Lacunas',
    titleEn: 'Part 2: Fill in the Blanks',
    descPt: 'Complete as frases contextuais usando as palavras do dia.',
    descEn: 'Complete contextual sentences using today’s active words.',
  },
  3: {
    partKey: 'writing',
    titlePt: 'Parte 3: Construção de Frases Ativas',
    titleEn: 'Part 3: Sentence Writing',
    descPt: 'Crie frases autênticas com as palavras aprendidas hoje e receba feedback.',
    descEn: 'Build authentic sentences with today’s words and get instant feedback.',
  },
  4: {
    partKey: 'reading',
    titlePt: 'Parte 4: Texto Integrado & Interpretação',
    titleEn: 'Part 4: Integrated Reading & Comprehension',
    descPt: 'Leia uma pequena história integrando as palavras do dia e responda às questões.',
    descEn: 'Read a short integrated story with today’s words and answer questions.',
  },
};

export function getDailyMemorizationSchedule(
  day: DayOfWeek,
  activeStudyDays?: DayOfWeek[],
  weeklyCycle: number = 1
): DailyMemorizationScheduleInfo {
  const activeList =
    Array.isArray(activeStudyDays) && activeStudyDays.length > 0
      ? DAYS_OF_WEEK.filter((d) => activeStudyDays.includes(d))
      : DAYS_OF_WEEK;

  const N = Math.max(1, activeList.length);
  const cycle = Math.max(1, weeklyCycle);

  let dayIndexInWeek = activeList.indexOf(day);
  if (dayIndexInWeek === -1) {
    // If it's a rest day outside activeStudyDays, map cyclically based on calendar position
    dayIndexInWeek = DAYS_OF_WEEK.indexOf(day) % N;
  }

  const priorDays = (cycle - 1) * N;
  const overallDayIndex = priorDays + dayIndexInWeek;
  const partNumber = (((overallDayIndex % 4) + 1) as 1 | 2 | 3 | 4);
  const info = PART_INFO[partNumber];

  return {
    day,
    dayIndexInWeek,
    overallDayIndex,
    partNumber,
    partKey: info.partKey,
    partTitlePt: info.titlePt,
    partTitleEn: info.titleEn,
    partDescPt: info.descPt,
    partDescEn: info.descEn,
  };
}

const DAY_LABELS_PT: Record<DayOfWeek, string> = {
  monday: 'Segunda-feira',
  tuesday: 'Terça-feira',
  wednesday: 'Quarta-feira',
  thursday: 'Quinta-feira',
  friday: 'Sexta-feira',
  saturday: 'Sábado',
  sunday: 'Domingo',
};

const DAY_LABELS_EN: Record<DayOfWeek, string> = {
  monday: 'Monday',
  tuesday: 'Tuesday',
  wednesday: 'Wednesday',
  thursday: 'Thursday',
  friday: 'Friday',
  saturday: 'Saturday',
  sunday: 'Sunday',
};

/**
 * Classify an entry as Native Friend vocabulary:
 * entry.source === 'live_lesson'
 * OR origin === 'native_friend' | 'native_notes'
 * OR sourceActivityName contains:
 * - "Native Friends Notes"
 * - "Live Session"
 * - "Native Friend"
 * - "Amigo Nativo"
 */
export function isNativeFriendVocabulary(entry: {
  source?: string;
  sourceActivityName?: string;
  origin?: string;
}): boolean {
  if (!entry) return false;
  if (entry.source === 'live_lesson') return true;
  if ((entry as any).origin === 'native_friend' || (entry as any).origin === 'native_notes') return true;
  const act = entry.sourceActivityName || '';
  if (
    act.includes('Native Friends Notes') ||
    act.includes('Live Session') ||
    act.includes('Native Friend') ||
    act.includes('Amigo Nativo')
  ) {
    return true;
  }
  return false;
}

/**
 * Phase 1B: Build the deterministic Daily Memorization Queue (max 5 words).
 *
 * FIRST PRIORITY:
 * Native Friend words never practiced:
 * practiceCount missing/0 OR lastPracticedAt missing.
 * Sort oldest first using best existing timestamp: learnedAt first, with stable fallback.
 *
 * SECOND PRIORITY:
 * Student/My Words never practiced.
 * Sort oldest first using the same deterministic strategy.
 * Fill until reaching 5 total.
 *
 * If fewer than 5 never-practiced words exist, fill remaining slots from previously practiced vocabulary:
 * - prioritize Native Friend vocabulary,
 * - then Student vocabulary,
 * and within each category select the LEAST RECENTLY PRACTICED first using lastPracticedAt.
 *
 * Deterministic tie-breaking (learnedAt, then normalized word/id).
 * No random selection.
 * No newest-first selection.
 * No duplicate normalized words.
 * Absolute maximum = 5.
 */
export function buildDailyMemorizationQueue(
  candidates: HomeworkVocabItem[]
): HomeworkVocabItem[] {
  // 1. Deduplicate by normalized word (word.trim().toLowerCase())
  const uniqueMap = new Map<string, HomeworkVocabItem>();
  for (const item of candidates) {
    if (!item || !item.word || !item.word.trim()) continue;
    const norm = item.word.trim().toLowerCase();
    const existing = uniqueMap.get(norm);
    if (!existing) {
      uniqueMap.set(norm, { ...item, word: item.word.trim() });
    } else {
      // Merge metadata preferring existing with richer details
      uniqueMap.set(norm, {
        ...existing,
        id: existing.id || item.id,
        source: existing.source || item.source,
        sourceActivityName: existing.sourceActivityName || item.sourceActivityName,
        learnedAt: existing.learnedAt || item.learnedAt,
        practiceCount:
          existing.practiceCount !== undefined ? existing.practiceCount : item.practiceCount,
        lastPracticedAt: existing.lastPracticedAt || item.lastPracticedAt,
        definitionEn: existing.definitionEn || item.definitionEn,
        translationPt: existing.translationPt || item.translationPt,
        exampleSentence: existing.exampleSentence || item.exampleSentence,
      });
    }
  }

  const uniqueList = Array.from(uniqueMap.values());
  if (uniqueList.length === 0) return [];

  // Helper: check if never practiced
  const isNeverPracticed = (entry: HomeworkVocabItem): boolean => {
    const count = typeof entry.practiceCount === 'number' ? entry.practiceCount : 0;
    return count === 0 || !entry.lastPracticedAt;
  };

  // Helper: timestamp parser with fallback
  const parseTimestamp = (iso?: string): number => {
    if (!iso) return NaN;
    const t = new Date(iso).getTime();
    return isNaN(t) ? NaN : t;
  };

  // Helper: deterministic comparison for never-practiced words (oldest learnedAt first)
  const compareNeverPracticed = (a: HomeworkVocabItem, b: HomeworkVocabItem): number => {
    const tA = parseTimestamp(a.learnedAt);
    const tB = parseTimestamp(b.learnedAt);
    const hasA = !isNaN(tA);
    const hasB = !isNaN(tB);

    if (hasA && hasB && tA !== tB) {
      return tA - tB; // oldest first
    }
    if (hasA && !hasB) return -1;
    if (!hasA && hasB) return 1;

    // Stable deterministic fallback: normalized word, then id
    const normA = a.word.trim().toLowerCase();
    const normB = b.word.trim().toLowerCase();
    const wordCmp = normA.localeCompare(normB);
    if (wordCmp !== 0) return wordCmp;
    return (a.id || '').localeCompare(b.id || '');
  };

  // Helper: deterministic comparison for practiced words (least recently practiced first using lastPracticedAt)
  const comparePracticed = (a: HomeworkVocabItem, b: HomeworkVocabItem): number => {
    const tA = parseTimestamp(a.lastPracticedAt);
    const tB = parseTimestamp(b.lastPracticedAt);
    const hasA = !isNaN(tA);
    const hasB = !isNaN(tB);

    if (hasA && hasB && tA !== tB) {
      return tA - tB; // oldest lastPracticedAt first = least recently practiced
    }
    if (hasA && !hasB) return -1;
    if (!hasA && hasB) return 1;

    // Tie-break 1: learnedAt oldest first
    const lA = parseTimestamp(a.learnedAt);
    const lB = parseTimestamp(b.learnedAt);
    if (!isNaN(lA) && !isNaN(lB) && lA !== lB) {
      return lA - lB;
    }

    // Tie-break 2: normalized word, then id
    const normA = a.word.trim().toLowerCase();
    const normB = b.word.trim().toLowerCase();
    const wordCmp = normA.localeCompare(normB);
    if (wordCmp !== 0) return wordCmp;
    return (a.id || '').localeCompare(b.id || '');
  };

  // Partition into the 4 deterministic buckets
  const bucket1NfNever: HomeworkVocabItem[] = [];
  const bucket2MyNever: HomeworkVocabItem[] = [];
  const bucket3NfPracticed: HomeworkVocabItem[] = [];
  const bucket4MyPracticed: HomeworkVocabItem[] = [];

  for (const item of uniqueList) {
    const isNf = isNativeFriendVocabulary(item);
    const never = isNeverPracticed(item);

    if (isNf && never) {
      bucket1NfNever.push(item);
    } else if (!isNf && never) {
      bucket2MyNever.push(item);
    } else if (isNf && !never) {
      bucket3NfPracticed.push(item);
    } else {
      bucket4MyPracticed.push(item);
    }
  }

  // Sort each bucket deterministically
  bucket1NfNever.sort(compareNeverPracticed);
  bucket2MyNever.sort(compareNeverPracticed);
  bucket3NfPracticed.sort(comparePracticed);
  bucket4MyPracticed.sort(comparePracticed);

  // Fill up to 5 words strictly in priority order
  const queue: HomeworkVocabItem[] = [];

  // Priority 1: Native Friend words never practiced
  for (const item of bucket1NfNever) {
    if (queue.length >= 5) break;
    queue.push(item);
  }

  // Priority 2: Student/My Words never practiced
  for (const item of bucket2MyNever) {
    if (queue.length >= 5) break;
    queue.push(item);
  }

  // Priority 3: Practiced Native Friend words (least recently practiced first)
  for (const item of bucket3NfPracticed) {
    if (queue.length >= 5) break;
    queue.push(item);
  }

  // Priority 4: Practiced Student words (least recently practiced first)
  for (const item of bucket4MyPracticed) {
    if (queue.length >= 5) break;
    queue.push(item);
  }

  return queue;
}

/**
 * HOTFIX 2.3.5 — Daily Vocabulary Queue (Etapa 2)
 *
 * Each day possesses its own queue of up to 5 words/expressions:
 *
 * Priority 1 — Native Friend:
 * Words and expressions recorded by the Native Friend in notes associated with the student and this specific day.
 * If there are 5 or more legitimate words, select the 5 most recent from that day.
 *
 * Priority 2 — Student's 5 Words Vocabulary:
 * When there are fewer than 5 Native Friend words for that day, complete the remaining slots
 * with the most recent words recorded by the student in 5 Words (from that day, or recent student routine words),
 * strictly respecting chronological order (newest first).
 *
 * Examples:
 * - Native Friend: 5 words -> use the 5.
 * - Native Friend: 2 words -> complete with 3 from student.
 * - Native Friend: 0 words -> use the 5 most recent from student.
 *
 * Deduplication: eliminates duplicates without inventing words.
 * If fewer than 5 legitimate words exist, use only what exists and report actual count.
 * Never mix data from other students.
 */
export function getDayOfWeekFromDateString(
  dateStr?: string,
  timeZone: string = DEFAULT_STUDENT_TIMEZONE
): DayOfWeek | null {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const trimmed = dateStr.trim();
  const lower = trimmed.toLowerCase();
  for (const d of DAYS_OF_WEEK) {
    if (lower === d || lower.includes(`(${d})`) || lower.includes(`-${d}`)) return d;
  }
  try {
    const pureDateMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (pureDateMatch) {
      const year = parseInt(pureDateMatch[1], 10);
      const month = parseInt(pureDateMatch[2], 10) - 1;
      const day = parseInt(pureDateMatch[3], 10);
      const dObj = new Date(Date.UTC(year, month, day, 12, 0, 0));
      return getStudentCurrentDayOfWeek(timeZone, dObj);
    }
    const parsed = new Date(trimmed);
    if (!isNaN(parsed.getTime())) {
      return getStudentCurrentDayOfWeek(timeZone, parsed);
    }
  } catch {}
  return null;
}

export function getDayOfWeekFromEntry(
  entry: any,
  timeZone: string = DEFAULT_STUDENT_TIMEZONE
): DayOfWeek | null {
  if (!entry) return null;
  if (entry.sourceDay && DAYS_OF_WEEK.includes(entry.sourceDay.toLowerCase())) {
    return entry.sourceDay.toLowerCase() as DayOfWeek;
  }
  if (entry.originDay && DAYS_OF_WEEK.includes(entry.originDay.toLowerCase())) {
    return entry.originDay.toLowerCase() as DayOfWeek;
  }
  if (Array.isArray(entry.origins)) {
    for (const o of entry.origins) {
      if (o?.dayOfWeek && DAYS_OF_WEEK.includes(o.dayOfWeek.toLowerCase())) {
        return o.dayOfWeek.toLowerCase() as DayOfWeek;
      }
      if (o?.date) {
        const d = getDayOfWeekFromDateString(o.date, timeZone);
        if (d) return d;
      }
    }
  }
  if (entry.routineRef?.day && DAYS_OF_WEEK.includes(entry.routineRef.day.toLowerCase())) {
    return entry.routineRef.day.toLowerCase() as DayOfWeek;
  }
  const act = (entry.sourceActivityName || '').toLowerCase();
  for (const d of DAYS_OF_WEEK) {
    if (act.includes(`(${d})`)) return d;
  }
  const dateCandidates = [entry.sessionDate, entry.date, entry.learnedAt, entry.firstSeenAt, entry.createdAt];
  for (const dc of dateCandidates) {
    if (dc) {
      const d = getDayOfWeekFromDateString(dc, timeZone);
      if (d) return d;
    }
  }
  return null;
}

/**
 * Checks whether an activity for a given day has already been started by the student:
 * - Has valid saved student answers in matching, fillInBlanks, sentences, or quizAnswers
 * - Has genuine AI evaluation saved
 * - Is marked as completed
 * - Has score > 0
 * - Has completed parts in partsProgress
 */
export function isActivityStartedOrAnswered(
  activity?: Partial<DailyHomeworkActivity> | null
): boolean {
  if (!activity) return false;
  if (Boolean(activity.isCompleted)) return true;
  if (
    activity.aiEvaluation &&
    isValidHomeworkEvaluation(activity.aiEvaluation) &&
    !isSyntheticHomeworkEvaluation(activity.aiEvaluation)
  ) {
    return true;
  }
  if (typeof activity.score === 'number' && activity.score > 0) return true;

  const answers = activity.studentAnswers;
  if (answers) {
    if (
      answers.matching &&
      Object.values(answers.matching).some((v) => Boolean(v && String(v).trim().length > 0))
    ) {
      return true;
    }
    if (
      answers.fillInBlanks &&
      Object.values(answers.fillInBlanks).some((v) => Boolean(v && String(v).trim().length > 0))
    ) {
      return true;
    }
    if (
      answers.sentences &&
      Object.values(answers.sentences).some((v) => Boolean(v && String(v).trim().length > 0))
    ) {
      return true;
    }
    if (
      answers.quizAnswers &&
      Object.values(answers.quizAnswers).some((v) => typeof v === 'number')
    ) {
      return true;
    }
  }

  const parts = activity.partsProgress;
  if (parts) {
    if (
      parts.matching?.status === 'completed' ||
      (parts.matching?.answers && Object.keys(parts.matching.answers).length > 0)
    ) {
      return true;
    }
    if (
      parts.fill?.status === 'completed' ||
      (parts.fill?.answers && Object.keys(parts.fill.answers).length > 0)
    ) {
      return true;
    }
    if (
      parts.writing?.status === 'completed' ||
      (parts.writing?.answers && Object.keys(parts.writing.answers).length > 0)
    ) {
      return true;
    }
    if (
      parts.reading?.status === 'completed' ||
      (parts.reading?.answers && Object.keys(parts.reading.answers).length > 0)
    ) {
      return true;
    }
  }

  return false;
}

/**
 * HOTFIX 2.3.5J — Daily Memorization Vocabulary Priority
 *
 * For each daily memorization activity, select up to 5 distinct and authentic words,
 * strictly following this deterministic order:
 *
 * 1. Native Friend Notes of that day:
 *    Select first the words registered by the teacher for the student on the corresponding day.
 * 2. 5 Key Words of that same day:
 *    Fill remaining slots with words saved by the student in the daily routine, including newly saved.
 * 3. Historical vocabulary:
 *    Only if slots remain under 5, seek the most recent entries from My Dictionary,
 *    sorted by registration date descending (newest first).
 *
 * Rules:
 * - Up to 5 words max.
 * - If fewer than 5 real words available, use only existing ones. Never invent words.
 * - Deduplication: normalize only for comparison without modifying original word spelling.
 */
export function resolveDailyMemorizationVocabulary(params: {
  targetDay: DayOfWeek;
  routinesByDay?: Record<DayOfWeek, RoutineItem[]>;
  customWords?: Array<Partial<HomeworkVocabItem> & { word: string }>;
  lessons?: LiveLesson[];
  studentUid?: string;
  studentEmail?: string;
  excludedWords?: string[] | Set<string>;
  studentLevel?: string;
}): HomeworkVocabItem[] {
  const {
    targetDay,
    routinesByDay = {} as Record<DayOfWeek, RoutineItem[]>,
    customWords = [],
    lessons = [],
    studentUid = '',
    studentEmail = '',
    excludedWords,
  } = params;

  const normTargetUid = (studentUid || '').trim();
  const normTargetEmail = (studentEmail || '').toLowerCase().trim();

  const excludedSet =
    excludedWords instanceof Set
      ? excludedWords
      : Array.isArray(excludedWords)
      ? new Set(excludedWords.map((w) => normalizeDictionaryWord(w)).filter(Boolean))
      : new Set<string>();

  const selectedQueue: HomeworkVocabItem[] = [];
  const selectedNormalized = new Set<string>();

  const isTargetStudent = (item: any): boolean => {
    if (!item) return false;
    const itemUid = (item.studentUid || item.uid || '').trim();
    const itemEmail = (item.studentEmail || item.email || '').toLowerCase().trim();
    if (normTargetUid && itemUid && itemUid !== normTargetUid) return false;
    if (normTargetEmail && itemEmail && itemEmail !== normTargetEmail) return false;
    return true;
  };

  const parseTs = (iso?: any): number => {
    if (!iso) return 0;
    if (typeof iso === 'number') return iso;
    const t = new Date(iso).getTime();
    return isNaN(t) ? 0 : t;
  };

  const enrichItem = (
    word: string,
    sourceActivity: string,
    originType: 'native_friend' | 'student_5words' | 'routine' | 'personal_dictionary',
    rawItem?: any
  ): HomeworkVocabItem => {
    const cleanWord = word.trim();
    const lower = cleanWord.toLowerCase();
    const norm = normalizeDictionaryWord(cleanWord);

    const dictMatch = customWords.find((cw) => {
      if (!cw || !cw.word) return false;
      return (
        normalizeDictionaryWord(cw.word) === norm &&
        Boolean(cw.definitionEn && cw.definitionEn.trim().length > 0)
      );
    });

    const staticDict = ROUTINE_VOCAB_DICT[lower];
    const prof = profileWord(
      cleanWord,
      dictMatch
        ? {
            definitionEn: dictMatch.definitionEn,
            translationPt: dictMatch.translationPt,
            exampleSentence: dictMatch.exampleSentence,
          }
        : staticDict
        ? {
            definitionEn: staticDict.definitionEn,
            translationPt: staticDict.translationPt,
            exampleSentence: staticDict.exampleSentence,
          }
        : undefined
    );

    return {
      id: rawItem?.id || dictMatch?.id || `vocab_${norm}`,
      word: cleanWord,
      definitionEn: rawItem?.definitionEn || dictMatch?.definitionEn || prof.definitionEn,
      translationPt: rawItem?.translationPt || dictMatch?.translationPt || prof.translationPt,
      exampleSentence: rawItem?.exampleSentence || dictMatch?.exampleSentence || prof.exampleSentenceEn,
      sourceActivityName: sourceActivity,
      sourceDay: targetDay,
      source: originType === 'native_friend' ? 'live_lesson' : 'routine',
      origin: originType,
      learnedAt:
        rawItem?.learnedAt ||
        rawItem?.date ||
        (dictMatch as any)?.learnedAt ||
        new Date().toISOString(),
      studentUid: normTargetUid || rawItem?.studentUid,
      studentEmail: normTargetEmail || rawItem?.studentEmail,
      practiceCount:
        typeof rawItem?.practiceCount === 'number'
          ? rawItem.practiceCount
          : (dictMatch as any)?.practiceCount || 0,
      lastPracticedAt: rawItem?.lastPracticedAt || (dictMatch as any)?.lastPracticedAt,
    };
  };

  const tryAdd = (
    word: string,
    sourceActivity: string,
    originType: 'native_friend' | 'student_5words' | 'routine' | 'personal_dictionary',
    rawItem?: any
  ): boolean => {
    if (selectedQueue.length >= 5) return false;
    const clean = (word || '').trim();
    if (!clean) return false;
    const norm = normalizeDictionaryWord(clean);
    if (!norm) return false;
    if (excludedSet.has(norm)) return false;
    if (selectedNormalized.has(norm)) return false;

    selectedNormalized.add(norm);
    selectedQueue.push(enrichItem(clean, sourceActivity, originType, rawItem));
    return true;
  };

  // =========================================================================
  // 1. Native Friend Notes daquele dia (targetDay)
  // =========================================================================
  const nfDayCandidates: Array<{ word: string; item: any; timestamp: number }> = [];

  // 1a. From lessons
  (lessons || []).forEach((l) => {
    if (!l || !isTargetStudent(l)) return;
    const lDay =
      getDayOfWeekFromEntry(l) ||
      getDayOfWeekFromDateString(l.sessionDate || l.startDateTime);
    if (lDay === targetDay) {
      const ts = parseTs(l.sessionDate || l.startDateTime || l.updatedAt || l.createdAt);
      if (Array.isArray(l.vocabularyNotes)) {
        l.vocabularyNotes.forEach((vn) => {
          if (vn && vn.word && vn.word.trim()) {
            nfDayCandidates.push({
              word: vn.word.trim(),
              item: {
                ...vn,
                source: 'live_lesson',
                origin: 'native_friend',
                sourceActivityName: `Live Session with ${l.teacherName || 'Native Friend'} (${targetDay})`,
                learnedAt: l.sessionDate ? `${l.sessionDate}T12:00:00Z` : l.startDateTime,
                definitionEn: vn.meaningOrTip || (vn as any).definitionEn,
                exampleSentence: vn.exampleSentence,
              },
              timestamp: ts,
            });
          }
        });
      }
    }
  });

  // 1b. From customWords / studentDictionaryEntries
  (customWords || []).forEach((cw) => {
    if (!cw || !cw.word || !isTargetStudent(cw)) return;
    if (!isNativeFriendVocabulary(cw as any)) return;
    const entryDay = getDayOfWeekFromEntry(cw);
    if (entryDay === targetDay) {
      const ts = parseTs((cw as any).learnedAt || (cw as any).firstSeenAt || (cw as any).date);
      nfDayCandidates.push({
        word: cw.word.trim(),
        item: cw,
        timestamp: ts,
      });
    }
  });

  // Sort NF candidates newest first
  nfDayCandidates.sort((a, b) => {
    if (a.timestamp !== b.timestamp) return b.timestamp - a.timestamp;
    return a.word.localeCompare(b.word);
  });

  for (const cand of nfDayCandidates) {
    if (selectedQueue.length >= 5) break;
    tryAdd(
      cand.word,
      cand.item.sourceActivityName || `Native Friend Notes (${targetDay})`,
      'native_friend',
      cand.item
    );
  }

  // =========================================================================
  // 2. 5 Key Words daquele mesmo dia (targetDay)
  // =========================================================================
  if (selectedQueue.length < 5) {
    const studentDayWords: Array<{ word: string; item?: any; sourceActivity?: string }> = [];

    // 2a. Direct from routinesByDay[targetDay]
    const targetRoutineItems = routinesByDay[targetDay] || [];
    for (const act of targetRoutineItems) {
      if (Array.isArray(act?.learnedWords)) {
        for (const w of act.learnedWords) {
          if (w && w.trim()) {
            studentDayWords.push({
              word: w.trim(),
              sourceActivity: act.activityName || `Daily Routine (${targetDay})`,
            });
          }
        }
      }
    }

    // 2b. From customWords recorded specifically for targetDay
    for (const cw of customWords) {
      if (!cw || !cw.word || !isTargetStudent(cw)) continue;
      if (isNativeFriendVocabulary(cw as any)) continue;
      const entryDay = getDayOfWeekFromEntry(cw);
      if (entryDay === targetDay) {
        studentDayWords.push({
          word: cw.word.trim(),
          item: cw,
          sourceActivity: cw.sourceActivityName || `5 Words Routine (${targetDay})`,
        });
      }
    }

    for (const item of studentDayWords) {
      if (selectedQueue.length >= 5) break;
      tryAdd(
        item.word,
        item.sourceActivity || `5 Words Routine (${targetDay})`,
        'student_5words',
        item.item
      );
    }
  }

  // =========================================================================
  // 3. Vocabulário histórico (My Dictionary decrescente por data de registro)
  // =========================================================================
  if (selectedQueue.length < 5) {
    const historicalCandidates: Array<{ word: string; item: any; timestamp: number }> = [];

    for (const cw of customWords) {
      if (!cw || !cw.word || !isTargetStudent(cw)) continue;
      const norm = normalizeDictionaryWord(cw.word);
      if (!norm || excludedSet.has(norm) || selectedNormalized.has(norm)) continue;

      const ts = parseTs(
        (cw as any).learnedAt ||
        (cw as any).firstSeenAt ||
        (cw as any).date ||
        (cw as any).createdAt
      );
      historicalCandidates.push({
        word: cw.word.trim(),
        item: cw,
        timestamp: ts,
      });
    }

    // Sort strictly newest first (descending registration date)
    historicalCandidates.sort((a, b) => {
      if (a.timestamp !== b.timestamp) return b.timestamp - a.timestamp;
      return a.word.localeCompare(b.word);
    });

    for (const cand of historicalCandidates) {
      if (selectedQueue.length >= 5) break;
      const isNf = isNativeFriendVocabulary(cand.item);
      tryAdd(
        cand.word,
        cand.item.sourceActivityName || (isNf ? 'Native Friend Notes' : 'Personal Dictionary'),
        isNf ? 'native_friend' : 'personal_dictionary',
        cand.item
      );
    }
  }

  return selectedQueue;
}

/**
 * HOTFIX 2.3.5J — Daily Vocabulary Queue
 *
 * Preserves backward compatibility while strictly adhering to the 3-level priority order:
 * 1. Native Friend Notes of targetDay
 * 2. 5 Key Words of targetDay
 * 3. Historical vocabulary descending by date
 */
export function buildDailyVocabularyQueueForDay(
  targetDay: DayOfWeek,
  candidates: HomeworkVocabItem[],
  studentUid?: string,
  studentEmail?: string,
  routinesByDay?: Record<DayOfWeek, RoutineItem[]>,
  lessons?: LiveLesson[],
  excludedWords?: string[] | Set<string>
): HomeworkVocabItem[] {
  return resolveDailyMemorizationVocabulary({
    targetDay,
    routinesByDay,
    customWords: candidates,
    lessons,
    studentUid,
    studentEmail,
    excludedWords,
  });
}

export function generateWeeklyHomework(
  routinesByDay: Record<DayOfWeek, RoutineItem[]>,
  userProfile?: UserProfile,
  studentEmail?: string,
  studentName?: string,
  customWords?: Array<Partial<HomeworkVocabItem> & { word: string }>,
  studentLevel?: string,
  targetDay?: DayOfWeek,
  excludedWords?: string[] | Set<string>,
  existingDailyActivities?: Record<string, DailyHomeworkActivity>,
  lessons?: LiveLesson[]
): WeeklyHomeworkData {
  const email = studentEmail || userProfile?.email || '';
  const name = studentName || userProfile?.name || (email ? email.split('@')[0] : 'Student');
  const rawLvl = (studentLevel || userProfile?.level || 'iniciante').toLowerCase();

  const isAdv = rawLvl.includes('avanc') || rawLvl.includes('advan') || rawLvl.includes('c1') || rawLvl.includes('c2');
  const isInter = !isAdv && (rawLvl.includes('intermed') || rawLvl.includes('b1') || rawLvl.includes('b2'));
  const levelLabel = isAdv ? 'Advanced' : isInter ? 'Intermediate' : 'Beginner';

  const schedule = targetDay
    ? getDailyMemorizationSchedule(targetDay, userProfile?.weeklyStudyDays, userProfile?.weeklyCycle || 1)
    : null;

  const excludedSet = excludedWords instanceof Set
    ? excludedWords
    : Array.isArray(excludedWords)
    ? new Set(excludedWords.map((w) => normalizeDictionaryWord(w)).filter(Boolean))
    : new Set<string>();

  // Gather candidate vocabulary available to the student (for whole-week fallback only)
  const candidateItems: HomeworkVocabItem[] = [];
  const seenCandidates = new Set<string>();

  if (Array.isArray(customWords)) {
    customWords.forEach((cw) => {
      const trimmed = (cw?.word || '').trim();
      const norm = normalizeDictionaryWord(trimmed);
      if (trimmed && norm && !excludedSet.has(norm) && !seenCandidates.has(norm)) {
        seenCandidates.add(norm);
        const prof = profileWord(trimmed, {
          definitionEn: cw.definitionEn,
          translationPt: cw.translationPt,
          exampleSentence: cw.exampleSentence,
        });
        const cwDay = cw.sourceDay || getDayOfWeekFromEntry(cw);
        candidateItems.push({
          id: (cw as any).id,
          word: trimmed,
          source: (cw as any).source,
          sourceActivityName: cw.sourceActivityName || 'Personal Dictionary',
          sourceDay: cwDay || undefined,
          learnedAt: (cw as any).learnedAt || (cw as any).firstSeenAt,
          firstSeenAt: (cw as any).firstSeenAt,
          practiceCount: (cw as any).practiceCount,
          lastPracticedAt: (cw as any).lastPracticedAt,
          definitionEn: prof.definitionEn,
          translationPt: prof.translationPt,
          exampleSentence: prof.exampleSentenceEn,
          studentUid: (cw as any).studentUid,
          studentEmail: (cw as any).studentEmail,
        });
      }
    });
  }

  for (const d of DAYS_OF_WEEK) {
    const items = routinesByDay[d] || [];
    for (const item of items) {
      if (item.learnedWords && Array.isArray(item.learnedWords)) {
        for (const w of item.learnedWords) {
          const trimmed = (w || '').trim();
          const norm = normalizeDictionaryWord(trimmed);
          if (trimmed && norm && !excludedSet.has(norm) && !seenCandidates.has(norm)) {
            seenCandidates.add(norm);
            const lower = trimmed.toLowerCase();
            const customMatch = Array.isArray(customWords)
              ? customWords.find(
                  (cw) =>
                    (cw?.word || '').trim().toLowerCase() === lower &&
                    Boolean(cw.definitionEn && cw.definitionEn.trim().length > 0)
                )
              : undefined;
            const dictMatch = ROUTINE_VOCAB_DICT[lower];
            const prof = profileWord(trimmed, customMatch ? {
              definitionEn: customMatch.definitionEn,
              translationPt: customMatch.translationPt,
              exampleSentence: customMatch.exampleSentence,
            } : (dictMatch ? {
              definitionEn: dictMatch.definitionEn,
              translationPt: dictMatch.translationPt,
              exampleSentence: dictMatch.exampleSentence,
            } : undefined));

            candidateItems.push({
              id: (customMatch as any)?.id,
              word: trimmed,
              sourceActivityName: item.activityName,
              sourceDay: d,
              source: (customMatch as any)?.source || 'routine',
              practiceCount: typeof (customMatch as any)?.practiceCount === 'number' ? (customMatch as any).practiceCount : 0,
              lastPracticedAt: (customMatch as any)?.lastPracticedAt,
              learnedAt: (customMatch as any)?.learnedAt,
              definitionEn: prof.definitionEn,
              translationPt: prof.translationPt,
              exampleSentence: prof.exampleSentenceEn,
            });
          }
        }
      }
    }
  }

  const dayNamePt = targetDay ? DAY_LABELS_PT[targetDay] : '';
  const dayNameEn = targetDay ? DAY_LABELS_EN[targetDay] : '';
  const weekLabel = targetDay
    ? `${dayNamePt} • Semana ${userProfile?.weeklyCycle || 1}`
    : `Semana de ${new Date().toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' })}`;

  const canonicalHwId = `hw-${targetDay || 'week'}-${userProfile?.weeklyCycle || 1}`;

  // HOTFIX 2.3.5J: If an activity for targetDay already exists AND has student answers or completed evaluation,
  // preserve it verbatim. If NOT started/answered, allow updating the vocabulary from the most recent records!
  if (targetDay && existingDailyActivities && existingDailyActivities[targetDay]) {
    const existing = existingDailyActivities[targetDay];
    if (existing.selectedWords && existing.selectedWords.length > 0 && isActivityStartedOrAnswered(existing)) {
      return {
        id: existing.id || canonicalHwId,
        targetDay,
        assignedPart: existing.assignedPart || schedule?.partNumber,
        assignedPartKey: existing.assignedPartKey || schedule?.partKey,
        weekLabel,
        studentEmail: email,
        studentName: name,
        studentLevel: levelLabel,
        createdAt: existing.createdAt || new Date().toISOString(),
        updatedAt: existing.updatedAt || new Date().toISOString(),
        totalWordsCollected: existing.selectedWords.length,
        vocabularyList: existing.selectedWords,
        allRoutineWords: existing.selectedWords,
        matchingPairs: Array.isArray(existing.matchingPairs) ? existing.matchingPairs : [],
        fillInBlanks: Array.isArray(existing.fillInBlanks) ? existing.fillInBlanks : [],
        sentenceWritingPrompts: Array.isArray(existing.sentenceWritingPrompts) ? existing.sentenceWritingPrompts : [],
        readingPassage: existing.readingPassage
          ? {
              ...existing.readingPassage,
              questions: Array.isArray(existing.readingPassage.questions)
                ? existing.readingPassage.questions.map((q: any, qIdx: number) => ({
                    ...q,
                    id: q?.id || `q-${qIdx + 1}`,
                    options: Array.isArray(q?.options) ? q.options : [],
                  }))
                : [],
            }
          : { title: '', text: '', questions: [] },
        studentAnswers: existing.studentAnswers,
        partsProgress: existing.partsProgress,
        aiEvaluation: existing.aiEvaluation,
        score: existing.score,
        isCompleted: Boolean(existing.isCompleted),
        dailyActivities: existingDailyActivities,
        isEmpty: false,
      };
    }
  }

  // HOTFIX 2.3.5J: Deterministic selection of <= 5 words according to 3-level priority order
  const rawWords: HomeworkVocabItem[] = targetDay
    ? resolveDailyMemorizationVocabulary({
        targetDay,
        routinesByDay,
        customWords,
        lessons,
        studentUid: userProfile?.id || (userProfile as any)?.uid,
        studentEmail: email,
        excludedWords,
        studentLevel: levelLabel,
      })
    : buildDailyMemorizationQueue(candidateItems);

  // REGRA DE OURO ANTI-GENÉRICO: Se não houver palavras cadastradas, retorna aviso estruturado
  if (rawWords.length === 0) {
    return {
      id: canonicalHwId,
      targetDay,
      assignedPart: schedule?.partNumber,
      assignedPartKey: schedule?.partKey,
      weekLabel,
      studentEmail: email,
      studentName: name,
      studentLevel: levelLabel,
      createdAt: new Date().toISOString(),
      totalWordsCollected: 0,
      vocabularyList: [],
      allRoutineWords: [],
      matchingPairs: [],
      fillInBlanks: [],
      sentenceWritingPrompts: [],
      readingPassage: {
        title: targetDay ? `Vocabulário de ${dayNamePt}` : 'Aguardando Vocabulário da Semana',
        text: '',
        questions: [],
      },
      dailyActivities: existingDailyActivities,
      isEmpty: true,
      emptyWarning: targetDay
        ? `Nenhum vocabulário registrado para ${dayNamePt} ainda. Para realizar a ${schedule?.partTitlePt || 'Atividade de Memorização de hoje'}, registre palavras nas atividades de hoje (Vídeo do Dia ou Áudio do Spotify) ou participe da conversa ao vivo.`
        : 'Nenhum vocabulário cadastrado nesta semana ainda. Para gerar sua Atividade de Memorização inteligente, adicione palavras nas suas rotinas diárias ou participe de uma aula ao vivo com seu Amigo Nativo para que ele anote novos termos no seu vocabulário.',
      emptyWarningEn: targetDay
        ? `No vocabulary registered for ${dayNameEn} yet. To complete today's ${schedule?.partTitleEn || 'Memorization Activity'}, add words in today's activities (Video of the Day or Spotify Audio) or join your live conversation.`
        : 'No vocabulary registered for this week yet. To generate your AI Memorization Activity, add words in your daily routines or attend a live lesson with your Native Friend so they can note new terms in your vocabulary.',
      isCompleted: false,
      score: 0,
    };
  }

  // 2. Build Matching Pairs (Part 1 - Associação): Deterministic stable IDs keyed by word
  const matchingPairs: MatchingPair[] = [...rawWords].map((item) => {
    const cleanWord = item.word.trim();
    const safeWordId = cleanWord.toLowerCase().replace(/[^a-z0-9]/g, '_');
    return {
      id: `match-${safeWordId}`,
      word: cleanWord,
      definition: item.definitionEn,
      translation: item.translationPt,
    };
  });

  // 3. Build Fill-in-the-Blanks (Part 2 - Lacunas): Sintetizado com precisão semântica e gramatical autêntica
  const fillInBlanks: FillInBlankItem[] = synthesizeFillInBlanks(
    rawWords.map((rw) => rw.word),
    rawWords
  );

  // 4. Build Sentence Writing Prompts (Part 3 - Construção de Frases Ativas): Calibrado por nível
  const sentenceWritingPrompts: SentenceWritingPrompt[] = rawWords.slice(0, 5).map((item) => {
    const prof = profileWord(item.word);
    let hintEn = '';
    let hintPt = '';

    if (isAdv) {
      hintEn = `Formulate an advanced sentence applying "${item.word}" to analyze a complex decision, project challenge, or strategic goal in your career.`;
      hintPt = `Formule uma frase em nível avançado aplicando "${item.word}" (${prof.translationPt}) para analisar uma decisão complexa, desafio de projeto ou meta estratégica.`;
      return {
        word: item.word,
        hint: hintEn,
        hintEn,
        hintPt,
        levelInstruction: 'Use complex clauses, conditionals (if/would), or executive phrasing.',
      };
    }
    if (isInter) {
      hintEn = `Write a realistic compound sentence with "${item.word}" connecting two related actions or explaining a key reason in your daily routine or work.`;
      hintPt = `Escreva uma frase intermediária autêntica com "${item.word}" (${prof.translationPt}) conectando duas ações ou explicando uma razão da sua rotina ou trabalho.`;
      return {
        word: item.word,
        hint: hintEn,
        hintEn,
        hintPt,
        levelInstruction: 'Connect two ideas using a connector like "because", "although", "since", or "while".',
      };
    }
    hintEn = `Write a clear, direct English sentence about your daily routine or home life applying "${item.word}".`;
    hintPt = `Escreva uma frase simples e direta sobre sua rotina diária aplicando "${item.word}" (${prof.translationPt}).`;
    return {
      word: item.word,
      hint: hintEn,
      hintEn,
      hintPt,
      levelInstruction: 'Use a clear Subject + Verb + Object structure.',
    };
  });

  // 5. Build Reading Passage & Comprehension (Part 4 - Mini-Story Coesa e Gramaticalmente Fluida)
  // HOTFIX 2.3.5K: If targetDay already has a valid AI-generated or validated reading passage, preserve it verbatim across F5!
  const existingStory = targetDay && existingDailyActivities?.[targetDay]?.readingPassage;
  const hasExistingValidStory = Boolean(
    existingStory?.text &&
    !isBadStoryText(existingStory.text) &&
    Array.isArray(existingStory.questions) &&
    existingStory.questions.length >= 2
  );

  let readingPassageToUse: ReadingPassage;
  if (hasExistingValidStory) {
    readingPassageToUse = {
      ...existingStory!,
      isAiGenerated: existingStory!.isAiGenerated ?? true,
    };
  } else if (existingStory?.text) {
    readingPassageToUse = {
      ...existingStory,
      isAiGenerated: Boolean(existingStory.isAiGenerated),
    };
  } else {
    const defaultSynthesized = synthesizeCohesiveStoryAndQuestions({
      words: rawWords.map((rw) => rw.word),
      studentLevel: levelLabel,
      studentName: name,
      wordDetails: rawWords,
    });
    readingPassageToUse = {
      ...defaultSynthesized,
      isAiGenerated: false,
    };
  }

  readingPassageToUse.questions = (Array.isArray(readingPassageToUse.questions) ? readingPassageToUse.questions : []).map(
    (q, qIdx) => ({
      ...q,
      id: q?.id || `q-${qIdx + 1}`,
      options: Array.isArray(q?.options) ? q.options : [],
    })
  );

  const passageTitle = readingPassageToUse.title;
  const passageText = readingPassageToUse.text;
  const readingQuestions = readingPassageToUse.questions;

  const wordOrigins: WordOriginSnapshot[] = rawWords.map((item) => ({
    word: item.word,
    origin: (item.origin || (isNativeFriendVocabulary(item) ? 'native_friend' : 'student_5words')) as any,
    sourceActivityName: item.sourceActivityName,
    sourceDay: item.sourceDay || targetDay,
    learnedAt: item.learnedAt,
  }));

  const updatedDailyActivities: Record<string, DailyHomeworkActivity> = {
    ...(existingDailyActivities || {}),
  };

  if (targetDay) {
    updatedDailyActivities[targetDay] = {
      id: canonicalHwId,
      day: targetDay,
      weeklyCycle: userProfile?.weeklyCycle || 1,
      studentUid: (userProfile?.uid || userProfile?.id || email || '').trim(),
      selectedWords: rawWords,
      wordOrigins,
      matchingPairs,
      fillInBlanks,
      sentenceWritingPrompts,
      readingPassage: readingPassageToUse,
      assignedPart: schedule?.partNumber,
      assignedPartKey: schedule?.partKey,
      studentAnswers: {},
      partsProgress: {},
      isCompleted: false,
      score: 0,
      isStarted: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  return {
    id: canonicalHwId,
    targetDay,
    assignedPart: schedule?.partNumber,
    assignedPartKey: schedule?.partKey,
    weekLabel,
    studentEmail: email,
    studentName: name,
    studentLevel: levelLabel,
    createdAt: new Date().toISOString(),
    totalWordsCollected: rawWords.length,
    vocabularyList: rawWords,
    allRoutineWords: rawWords,
    matchingPairs,
    fillInBlanks,
    sentenceWritingPrompts,
    readingPassage: readingPassageToUse,
    dailyActivities: updatedDailyActivities,
    isEmpty: false,
    isCompleted: false,
    score: 0,
  };
}

export function generateWeeklyHomeworkFromRoutines(params: {
  routinesByDay: Record<DayOfWeek, RoutineItem[]>;
  studentName?: string;
  studentLevel?: string;
  studentEmail?: string;
  customWords?: Array<Partial<HomeworkVocabItem> & { word: string }>;
  targetDay?: DayOfWeek;
  activeStudyDays?: DayOfWeek[];
  weeklyCycle?: number;
  userProfile?: UserProfile;
  excludedWords?: string[] | Set<string>;
  existingDailyActivities?: Record<string, DailyHomeworkActivity>;
  existingHomework?: WeeklyHomeworkData;
  lessons?: LiveLesson[];
}): WeeklyHomeworkData {
  const profile = params.userProfile || ({
    weeklyStudyDays: params.activeStudyDays,
    weeklyCycle: params.weeklyCycle,
    level: params.studentLevel,
    name: params.studentName,
    email: params.studentEmail,
  } as any);

  const existingDaily =
    params.existingDailyActivities ||
    params.existingHomework?.dailyActivities ||
    (params.userProfile as any)?.weeklyHomework?.dailyActivities;

  return generateWeeklyHomework(
    params.routinesByDay,
    profile,
    params.studentEmail,
    params.studentName,
    params.customWords,
    params.studentLevel,
    params.targetDay,
    params.excludedWords,
    existingDaily,
    params.lessons
  );
}


/**
 * Async generator that triggers the server-side Gemini AI engine
 * to generate the 4 stages using real daily vocabulary.
 */
export async function generateWeeklyHomeworkWithAi(params: {
  routinesByDay: Record<DayOfWeek, RoutineItem[]>;
  studentName?: string;
  studentLevel?: string;
  studentEmail?: string;
  studentUid?: string;
  customWords?: Array<Partial<HomeworkVocabItem> & { word: string }>;
  targetDay?: DayOfWeek;
  activeStudyDays?: DayOfWeek[];
  weeklyCycle?: number;
  userProfile?: UserProfile;
}): Promise<WeeklyHomeworkData> {
  const localBaseline = generateWeeklyHomeworkFromRoutines(params);

  // If there are no words, return the empty structured notice immediately without calling AI
  if (localBaseline.isEmpty || localBaseline.totalWordsCollected === 0) {
    return localBaseline;
  }

  try {
    // Simple direct payload: array of words and student level
    const cleanWordList = Array.from(
      new Set(
        localBaseline.vocabularyList
          .map((item) => item.word.trim())
          .filter((w) => Boolean(w))
      )
    );

    const controller = new AbortController();
    const abortTimeout = setTimeout(() => controller.abort(), 35000);

    const currentUid = auth?.currentUser?.uid || params.studentUid || '';
    const currentEmail = (auth?.currentUser?.email || params.studentEmail || '').toLowerCase().trim();
    const token = await auth?.currentUser?.getIdToken().catch(() => null);
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch('/api/homework/generate-ai', {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        words: cleanWordList,
        wordDetails: localBaseline.vocabularyList,
        studentLevel: params.studentLevel || 'Intermediate',
        studentName: params.studentName || 'Student',
        studentEmail: currentEmail,
        studentUid: currentUid,
        weekLabel: localBaseline.weekLabel,
        targetDay: params.targetDay,
        weeklyCycle: params.weeklyCycle,
      }),
    });
    clearTimeout(abortTimeout);

    if (response.status === 401 || response.status === 403) {
      console.warn(`Homework generate-ai rejected (${response.status}): unauthenticated or unauthorized. Falling back to structured baseline.`);
      return {
        ...localBaseline,
        isAiGenerated: false,
      };
    }

    if (response.ok) {
      const data = await response.json();
      if (data.homework && Array.isArray(data.homework.matchingPairs) && data.homework.matchingPairs.length > 0) {
        return {
          ...data.homework,
          targetDay: params.targetDay,
          assignedPart: localBaseline.assignedPart,
          assignedPartKey: localBaseline.assignedPartKey,
          studentLevel: data.homework.studentLevel || localBaseline.studentLevel,
          totalWordsCollected: localBaseline.totalWordsCollected,
          vocabularyList:
            Array.isArray(data.homework.vocabularyList) && data.homework.vocabularyList.length > 0
              ? data.homework.vocabularyList
              : localBaseline.vocabularyList,
          isAiGenerated: true,
        };
      }
      if (data.isEmpty) {
        return {
          ...localBaseline,
          isEmpty: true,
          emptyWarning: data.emptyWarning || localBaseline.emptyWarning,
        };
      }
    }
  } catch (err) {
    console.warn('AI memorization generation temporarily unavailable, using structured pedagogical base:', err);
  }

  return {
    ...localBaseline,
    isAiGenerated: false,
  };
}

/**
 * Dedicated AI generator specifically for Part 4 (Mini-Story & Reading Comprehension)
 * Guarantees a 100% original, unprecedented storyline with organic vocabulary integration
 * and cohesive, story-grounded questions using the Gemini API.
 */
export async function generatePart4StoryWithAi(params: {
  words: string[];
  studentLevel?: string;
  studentName?: string;
  studentUid?: string;
  studentEmail?: string;
  wordDetails?: any[];
  targetDay?: DayOfWeek | string;
  weeklyCycle?: number;
  videoContext?: any;
}): Promise<ReadingPassage | null> {
  const cleanWords = Array.from(new Set(params.words.filter(Boolean)));
  if (cleanWords.length === 0) return null;

  try {
    const controller = new AbortController();
    const abortTimeout = setTimeout(() => controller.abort(), 25000);

    const currentUid = auth?.currentUser?.uid || params.studentUid || '';
    const currentEmail = (auth?.currentUser?.email || params.studentEmail || '').toLowerCase().trim();
    const token = await auth?.currentUser?.getIdToken().catch(() => null);
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch('/api/homework/generate-part4', {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        words: cleanWords,
        studentLevel: params.studentLevel || 'Intermediate',
        studentName: params.studentName || 'Student',
        studentUid: currentUid,
        studentEmail: currentEmail,
        wordDetails: params.wordDetails || [],
        targetDay: params.targetDay,
        weeklyCycle: params.weeklyCycle,
        videoContext: params.videoContext,
      }),
    });
    clearTimeout(abortTimeout);

    if (response.status === 401 || response.status === 403) {
      console.warn(`Homework generate-part4 rejected (${response.status}): unauthenticated or unauthorized.`);
      return null;
    }

    if (response.ok) {
      const data = await response.json();
      if (data.readingPassage?.text && Array.isArray(data.readingPassage?.questions) && !isBadStoryText(data.readingPassage.text)) {
        return {
          ...data.readingPassage,
          questions: data.readingPassage.questions.map((q: any, idx: number) => ({
            ...q,
            id: q?.id || `q-${idx + 1}`,
            options: Array.isArray(q?.options) ? q.options : [],
          })),
          isAiGenerated: true,
        };
      }
    }
  } catch (err) {
    console.warn('Part 4 AI generation failed:', err);
  }

  // HOTFIX 2.3.5K: Strictly zero synthetic fallback or fictional emergency text to simulate success.
  // Returns null so that the UI presents a recoverable error allowing user retry.
  return null;
}

