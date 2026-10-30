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
import {
  getStudentCurrentDayOfWeek,
  getIsoDateInTimeZone,
  getDateForDayInCurrentWeek,
  sanitizeTimeZone,
  DEFAULT_STUDENT_TIMEZONE,
} from './timezone';

export { getIsoDateInTimeZone, getDateForDayInCurrentWeek };

/**
 * Checks if an origin record or origin metadata represents a Native Friend note/session.
 */
export function isNativeFriendOrigin(originObj: any): boolean {
  if (!originObj) return false;
  const s = String(originObj.source || originObj.origin || originObj.type || '').toLowerCase().trim();
  if (
    s === 'native_notes' ||
    s === 'live_lesson' ||
    s === 'native_friend' ||
    s === 'teacher_note' ||
    s === 'lesson_note'
  ) {
    return true;
  }
  const act = String(originObj.activityName || originObj.sourceActivityName || '').toLowerCase();
  if (
    act.includes('native friend') ||
    act.includes('live session') ||
    act.includes('amigo nativo') ||
    act.includes('native friends notes') ||
    act.includes('teacher note')
  ) {
    return true;
  }
  return false;
}

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
function normalizeStudentUid(rawId?: string | null, email?: string | null): string {
  const cleanRawId = (rawId || '').trim();
  const rawIsEmail = cleanRawId.includes('@');
  const cleanEmail = (email || '').toLowerCase().trim();
  const currentAuthUid = auth?.currentUser?.uid || '';
  const currentAuthEmail = (auth?.currentUser?.email || '').toLowerCase().trim();

  if (
    cleanRawId &&
    !rawIsEmail &&
    !cleanRawId.startsWith('usr-') &&
    !cleanRawId.startsWith('tutor-') &&
    cleanRawId !== 'user-default' &&
    cleanRawId !== 'anonymous_student' &&
    cleanRawId !== 'undefined' &&
    cleanRawId !== 'null'
  ) {
    return cleanRawId;
  }

  if (currentAuthUid) {
    if (!cleanEmail || (currentAuthEmail && cleanEmail === currentAuthEmail)) {
      return currentAuthUid;
    }
  }

  return cleanRawId && !rawIsEmail ? cleanRawId : '';
}

export function resolveDailyMemorizationVocabulary(params: {
  targetDay: DayOfWeek;
  activityDate?: string;
  targetDate?: string;
  referenceTimestamp?: number | string;
  timeZone?: string;
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
    activityDate,
    targetDate,
    referenceTimestamp,
    timeZone: rawTimeZone,
    routinesByDay = {} as Record<DayOfWeek, RoutineItem[]>,
    customWords = [],
    lessons = [],
    studentUid = '',
    studentEmail = '',
    excludedWords,
  } = params;

  const timeZone = sanitizeTimeZone(rawTimeZone || DEFAULT_STUDENT_TIMEZONE);
  const resolvedActivityDate =
    getIsoDateInTimeZone(activityDate || targetDate, timeZone) ||
    getDateForDayInCurrentWeek(targetDay, new Date(), timeZone);

  const normTargetUid = normalizeStudentUid(studentUid, studentEmail) || (studentUid || '').trim();
  const normTargetEmail = (studentEmail || '').toLowerCase().trim();

  const parseTs = (iso?: any): number => {
    if (!iso) return 0;
    if (typeof iso === 'number') return iso;
    const t = new Date(iso).getTime();
    return isNaN(t) ? 0 : t;
  };

  const maxTs = referenceTimestamp ? parseTs(referenceTimestamp) : Infinity;

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
    const rawItemUid = (item.studentUid || item.uid || '').trim();
    const rawItemEmail = (item.studentEmail || item.email || '').toLowerCase().trim();

    // If item doesn't have UID or email specified, it belongs to the student's personal dictionary loaded for this session
    if (!rawItemUid && !rawItemEmail) return true;

    const itemUid = normalizeStudentUid(rawItemUid, rawItemEmail) || rawItemUid;
    const itemEmail = rawItemEmail;

    if (normTargetUid && itemUid) {
      if (itemUid === normTargetUid) return true;
      // If UIDs differ due to userProfile vs currentAccount or legacy prefix, check if emails match
      if (normTargetEmail && itemEmail && normTargetEmail === itemEmail) return true;
      return false;
    }

    if (normTargetEmail && itemEmail && itemEmail !== normTargetEmail) return false;
    return true;
  };

  const enrichItem = (
    cleanWord: string,
    sourceActivity: string,
    originType: 'native_friend' | 'student_5words' | 'routine' | 'personal_dictionary',
    rawItem?: any,
    matchedOrigin?: any
  ): HomeworkVocabItem => {
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

    const resolvedPartOfSpeech =
      rawItem?.partOfSpeech ||
      dictMatch?.partOfSpeech ||
      (staticDict as any)?.partOfSpeech ||
      prof?.partOfSpeech;
    const resolvedCefr =
      rawItem?.cefrLevel ||
      dictMatch?.cefrLevel ||
      (staticDict as any)?.cefrLevel;

    const resolvedOrigins =
      rawItem?.origins ||
      (dictMatch as any)?.origins ||
      (matchedOrigin ? [matchedOrigin] : undefined);

    const resolvedLessonRef =
      matchedOrigin?.lessonId ||
      rawItem?.lessonRefId ||
      (dictMatch as any)?.lessonRefId;

    const resolvedLearnedAt =
      matchedOrigin?.date ||
      rawItem?.learnedAt ||
      rawItem?.date ||
      (dictMatch as any)?.learnedAt ||
      new Date().toISOString();

    const resolvedFirstSeenAt =
      rawItem?.firstSeenAt ||
      (dictMatch as any)?.firstSeenAt;

    return {
      id: rawItem?.id || dictMatch?.id || `vocab_${norm}`,
      word: cleanWord,
      definitionEn:
        rawItem?.definitionEn ||
        rawItem?.meaningOrTip ||
        dictMatch?.definitionEn ||
        (staticDict ? staticDict.definitionEn : prof.definitionEn),
      translationPt:
        rawItem?.translationPt ||
        dictMatch?.translationPt ||
        (staticDict ? staticDict.translationPt : prof.translationPt),
      exampleSentence:
        rawItem?.exampleSentence ||
        dictMatch?.exampleSentence ||
        (staticDict ? staticDict.exampleSentence : prof.exampleSentenceEn),
      sourceActivityName: sourceActivity,
      sourceDay: targetDay,
      source: originType === 'native_friend' ? 'live_lesson' : 'routine',
      origin: originType,
      learnedAt: resolvedLearnedAt,
      firstSeenAt: resolvedFirstSeenAt,
      studentUid: normTargetUid || rawItem?.studentUid,
      studentEmail: normTargetEmail || rawItem?.studentEmail,
      practiceCount:
        typeof rawItem?.practiceCount === 'number'
          ? rawItem.practiceCount
          : (dictMatch as any)?.practiceCount || 0,
      lastPracticedAt: rawItem?.lastPracticedAt || (dictMatch as any)?.lastPracticedAt,
      partOfSpeech: resolvedPartOfSpeech,
      cefrLevel: resolvedCefr,
      origins: resolvedOrigins,
      lessonRefId: resolvedLessonRef,
      normalizedWord: norm,
    };
  };

  const tryAdd = (
    word: string,
    sourceActivity: string,
    originType: 'native_friend' | 'student_5words' | 'routine' | 'personal_dictionary',
    rawItem?: any,
    matchedOrigin?: any
  ): boolean => {
    if (selectedQueue.length >= 5) return false;
    const clean = (word || '').trim();
    if (!clean) return false;
    const norm = normalizeDictionaryWord(clean);
    if (!norm) return false;
    if (excludedSet.has(norm)) return false;
    if (selectedNormalized.has(norm)) return false;

    selectedNormalized.add(norm);
    selectedQueue.push(enrichItem(clean, sourceActivity, originType, rawItem, matchedOrigin));
    return true;
  };

  // =========================================================================
  // PRIORIDADE 1 — Native Friend Notes da data exata (resolvedActivityDate: YYYY-MM-DD)
  // Fonte canônica exclusiva: My Dictionary (customWords / studentDictionaryEntries).
  // =========================================================================
  const priority1Candidates: Array<{
    word: string;
    item: any;
    matchedOrigin?: any;
    timestamp: number;
    activityName?: string;
  }> = [];

  for (const cw of customWords) {
    if (!cw || !cw.word || !isTargetStudent(cw)) continue;
    const norm = normalizeDictionaryWord(cw.word);
    if (!norm || excludedSet.has(norm)) continue;

    let bestMatchingOrigin: any = null;
    let bestOriginTs = 0;

    // 10. Se uma palavra possuir múltiplas origens, considerar todas as ocorrências reais:
    if (Array.isArray((cw as any).origins) && (cw as any).origins.length > 0) {
      for (const orig of (cw as any).origins) {
        if (!orig || !isNativeFriendOrigin(orig)) continue;
        const origDate = getIsoDateInTimeZone(orig.createdAt || orig.timestamp || orig.date, timeZone);
        if (origDate && origDate === resolvedActivityDate) {
          const ts = parseTs(orig.createdAt || orig.timestamp || orig.date || (cw as any).learnedAt || (cw as any).firstSeenAt);
          if (ts <= maxTs && ts >= bestOriginTs) {
            bestOriginTs = ts;
            bestMatchingOrigin = orig;
          }
        }
      }
    }

    // Direct entry properties check (if origins array did not match or for single-origin entries)
    if (!bestMatchingOrigin && (isNativeFriendVocabulary(cw as any) || isNativeFriendOrigin(cw))) {
      const directDate = getIsoDateInTimeZone(
        (cw as any).sessionDate || (cw as any).date || (cw as any).learnedAt || (cw as any).firstSeenAt || (cw as any).createdAt,
        timeZone
      );
      if (directDate && directDate === resolvedActivityDate) {
        const ts = parseTs((cw as any).learnedAt || (cw as any).firstSeenAt || (cw as any).date || (cw as any).createdAt);
        if (ts <= maxTs) {
          bestOriginTs = ts;
          bestMatchingOrigin = {
            source: 'native_notes',
            date: (cw as any).learnedAt || (cw as any).date,
            lessonId: (cw as any).lessonRefId,
            activityName: cw.sourceActivityName,
          };
        }
      }
    }

    if (bestMatchingOrigin) {
      priority1Candidates.push({
        word: cw.word.trim(),
        item: cw,
        matchedOrigin: bestMatchingOrigin,
        timestamp: bestOriginTs,
        activityName: bestMatchingOrigin.activityName || cw.sourceActivityName || `Native Friend Notes (${resolvedActivityDate})`,
      });
    }
  }

  // Ordenar por data/hora, das mais recentes para as mais antigas (descending)
  priority1Candidates.sort((a, b) => {
    if (a.timestamp !== b.timestamp) return b.timestamp - a.timestamp;
    return a.word.localeCompare(b.word);
  });

  // Selecionar até cinco palavras
  for (const cand of priority1Candidates) {
    if (selectedQueue.length >= 5) break;
    tryAdd(
      cand.word,
      cand.activityName || `Native Friend Notes (${resolvedActivityDate})`,
      'native_friend',
      cand.item,
      cand.matchedOrigin
    );
  }

  // =========================================================================
  // PRIORIDADE 2 — My Dictionary
  // Preencher as vagas restantes com as palavras mais recentes do My Dictionary,
  // independentemente da origem, sem repetir palavras já selecionadas.
  // =========================================================================
  if (selectedQueue.length < 5) {
    const priority2Candidates: Array<{
      word: string;
      item: any;
      timestamp: number;
      isNf: boolean;
    }> = [];

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

      // 8. Não considerar registros posteriores ao momento de referência da seleção
      if (ts > maxTs) continue;

      const isNf = isNativeFriendVocabulary(cw as any) || isNativeFriendOrigin(cw);

      priority2Candidates.push({
        word: cw.word.trim(),
        item: cw,
        timestamp: ts,
        isNf,
      });
    }

    // Ordenar estritamente das mais recentes para as mais antigas (descending)
    priority2Candidates.sort((a, b) => {
      if (a.timestamp !== b.timestamp) return b.timestamp - a.timestamp;
      return a.word.localeCompare(b.word);
    });

    for (const cand of priority2Candidates) {
      if (selectedQueue.length >= 5) break;
      const originType = cand.isNf ? 'native_friend' : 'personal_dictionary';
      tryAdd(
        cand.word,
        cand.item.sourceActivityName || (cand.isNf ? 'Native Friend Notes' : 'Personal Dictionary'),
        originType,
        cand.item
      );
    }
  }

  return selectedQueue;
}

/**
 * Daily Vocabulary Queue
 * Strictly adheres to the 2-priority canonical rule for the activity date:
 * 1. Native Friend Notes of the exact activity date (YYYY-MM-DD), newest first (up to 5).
 * 2. My Dictionary general recent vocabulary filling up to 5 words max.
 */
export function buildDailyVocabularyQueueForDay(
  targetDay: DayOfWeek,
  candidates: HomeworkVocabItem[],
  studentUid?: string,
  studentEmail?: string,
  routinesByDay?: Record<DayOfWeek, RoutineItem[]>,
  lessons?: LiveLesson[],
  excludedWords?: string[] | Set<string>,
  activityDate?: string,
  referenceTimestamp?: number | string,
  timeZone?: string
): HomeworkVocabItem[] {
  return resolveDailyMemorizationVocabulary({
    targetDay,
    activityDate,
    referenceTimestamp,
    timeZone,
    routinesByDay,
    customWords: candidates,
    lessons,
    studentUid,
    studentEmail,
    excludedWords,
  });
}


export interface ContextualSentencePromptParams {
  word: string;
  definitionEn?: string;
  translationPt?: string;
  exampleSentence?: string;
  sourceActivityName?: string;
  partOfSpeech?: string;
  cefrLevel?: string;
  studentLevel?: string;
}

/**
 * Validates whether a definition is genuine and pedagogically informative,
 * or merely a generic synthetic placeholder / boilerplate.
 */
export function isGenericPedagogicalDefinition(def?: string): boolean {
  if (!def || typeof def !== 'string') return true;
  const t = def.trim().toLowerCase();
  if (t.length < 5) return true;
  return (
    t.includes('an important concept, role, or term referring to') ||
    t.includes('to engage in, conduct, or carry out the action of') ||
    t.includes('characterized by being') ||
    t.includes('in a distinct manner, degree, or timing characterized as') ||
    t.includes('core active vocabulary applied') ||
    t.includes('active vocabulary practiced during') ||
    t.includes('key vocabulary term practiced') ||
    t.includes('applied during your daily') ||
    t.includes('understanding how to optimize') ||
    t.includes('the team established a') ||
    t.includes('key concept representing') ||
    t.includes('descriptive term characterizing') ||
    t.includes('action term describing') ||
    t.includes('modifying term highlighting') ||
    t.includes('with clear intention creates noticeable progress') ||
    t.includes('focus on the sentence context to identify') ||
    t.includes('practicing with') ||
    t.includes('builds natural fluency and confidence') ||
    t.includes('plays an indispensable role') ||
    t.includes('having a clear and structured') ||
    t.includes('definition not available') ||
    t.includes('no definition provided') ||
    t.includes('meaning not specified') ||
    t.includes('n/a') ||
    t === 'to practice' ||
    t === 'vocabulary word' ||
    t === 'general vocabulary'
  );
}

/**
 * Detects whether the provided lexical parameters are contradictory,
 * mutually incompatible, or ambiguously unresolved without a disambiguating context.
 */
export function isContradictoryOrAmbiguousContext(params: {
  word: string;
  definitionEn?: string;
  translationPt?: string;
  exampleSentence?: string;
  sourceActivityName?: string;
  partOfSpeech?: string;
}): boolean {
  const def = (params.definitionEn || '').trim().toLowerCase();
  const act = (params.sourceActivityName || '').trim().toLowerCase();
  const pos = (params.partOfSpeech || '').trim().toLowerCase();
  const trans = (params.translationPt || '').trim().toLowerCase();

  // 1. Explicit unresolved multiple meanings or ambiguity markers
  if (
    def.includes('multiple meanings') ||
    def.includes('various meanings') ||
    def.includes('different meanings depending on context') ||
    def.includes('ambiguous meaning') ||
    def.includes('meaning depends on context')
  ) {
    return true;
  }

  // 2. Ambiguity in source activity without disambiguating definition
  if (
    (act.includes('unspecified') || act.includes('no context') || act.includes('ambiguous')) &&
    (!def || isGenericPedagogicalDefinition(def))
  ) {
    return true;
  }

  // 3. POS vs Definition contradiction
  if (pos && def) {
    const isInfinitiveVerb = /^to\s+[a-z]{3,}\b/.test(def);
    const isNounPos = pos === 'noun' || pos === 'substantivo';
    if (isNounPos && isInfinitiveVerb && !def.includes('ability to') && !def.includes('tendency to') && !def.includes('attempt to') && !def.includes('act to')) {
      return true;
    }

    const isConcreteNounDef = /^(a|an|the)\s+(person|device|tool|instrument|vehicle|building|room|machine|substance|plant|animal)\b/.test(def);
    const isVerbPos = pos === 'verb' || pos === 'verbo';
    if (isVerbPos && isConcreteNounDef) {
      return true;
    }

    const isAdjPos = pos === 'adjective' || pos === 'adjetivo';
    if (isAdjPos && isInfinitiveVerb) {
      return true;
    }
  }

  // 4. Definition vs Translation severe domain contradiction
  if (def.includes('financial institution') && trans.includes('margem de rio')) {
    return true;
  }
  if (def.includes('river bank') && trans.includes('instituição financeira')) {
    return true;
  }

  return false;
}

/**
 * Checks if a sentence writing prompt is already personalized and valid,
 * distinguishing it from legacy generic CEFR templates.
 */
export function isPersonalizedPrompt(p?: Partial<SentenceWritingPrompt> | null): boolean {
  if (!p) return false;
  const hint = (p.hint || p.hintEn || p.hintPt || '').trim();
  if (!hint) return false;

  const lower = hint.toLowerCase();
  const isOldGeneric =
    lower.includes('formulate an advanced sentence applying') ||
    lower.includes('write a realistic compound sentence with') ||
    lower.includes('write a clear, direct english sentence about your daily routine') ||
    lower.includes('formule uma frase em nível avançado aplicando') ||
    lower.includes('escreva uma frase intermediária autêntica com') ||
    lower.includes('escreva uma frase simples e direta sobre sua rotina') ||
    lower.includes('escreva uma frase completa em inglês usando');

  return !isOldGeneric;
}

/**
 * Phase 6: Deterministically derives a contextualized sentence writing prompt
 * based on verified word semantic data (definition, translation, example, source activity, POS, CEFR).
 * Zero additional Gemini API calls. Returns empty prompts when context is insufficient or ambiguous.
 */
export function deriveContextualSentencePrompt(
  params: ContextualSentencePromptParams
): SentenceWritingPrompt {
  const cleanWord = (params.word || '').trim();
  if (!cleanWord) {
    return { word: '', hint: '', hintEn: '', hintPt: '', levelInstruction: '' };
  }

  const rawDef = (params.definitionEn || '').trim();
  const rawTrans = (params.translationPt || '').trim();
  const rawEx = (params.exampleSentence || '').trim();
  const sourceAct = (params.sourceActivityName || '').trim();
  const pos = (params.partOfSpeech || '').trim().toLowerCase();
  const studentLvl = (params.studentLevel || params.cefrLevel || 'intermediate').toLowerCase();

  const isAdv = studentLvl.includes('avanc') || studentLvl.includes('advan') || studentLvl.includes('c1') || studentLvl.includes('c2');

  const lowerWord = cleanWord.toLowerCase();
  const hasRealDef = rawDef.length > 0 && !isGenericPedagogicalDefinition(rawDef);
  const hasRealEx =
    rawEx.length > 0 &&
    !isGenericPedagogicalDefinition(rawEx) &&
    rawEx.toLowerCase().includes(lowerWord) &&
    !rawEx.toLowerCase().includes('i practice using');

  // Rule 4 & 8: If no valid definition AND no contextual example -> context is insufficient
  // Translation alone is NOT sufficient context without definition/example.
  if (!hasRealDef && !hasRealEx) {
    return {
      word: cleanWord,
      hint: '',
      hintEn: '',
      hintPt: '',
      levelInstruction: '',
    };
  }

  // Rule 8: If contradictory or ambiguous -> omit rather than provide false guidance
  if (
    isContradictoryOrAmbiguousContext({
      word: cleanWord,
      definitionEn: rawDef,
      translationPt: rawTrans,
      exampleSentence: rawEx,
      sourceActivityName: sourceAct,
      partOfSpeech: pos,
    })
  ) {
    return {
      word: cleanWord,
      hint: '',
      hintEn: '',
      hintPt: '',
      levelInstruction: '',
    };
  }

  // We have genuine context!
  // Determine register, communicative domain, and semantic affordances:
  const defLower = rawDef.toLowerCase();
  const transLower = rawTrans.toLowerCase();
  const actLower = sourceAct.toLowerCase();

  let hintEn = '';
  let hintPt = '';
  let levelInstruction = '';

  // 1. Pragmatic Register: Informal / Colloquial / Disbelief / Insincerity
  // e.g. BULLSHIT or colloquial slang
  const isInformalOrTaboo =
    /\b(informal|slang|colloquial|vulgar|taboo|pejorative|derogatory|swear|insincere|deceitful)\b/i.test(defLower) ||
    /\b(besteira|balela|conversa fiada|palavrão|gíria)\b/i.test(transLower) ||
    lowerWord === 'bullshit';

  const isNonsenseOrUntrue =
    defLower.includes('untrue') ||
    defLower.includes('deceitful') ||
    defLower.includes('insincere') ||
    defLower.includes('exaggerated') ||
    defLower.includes('nonsense') ||
    transLower.includes('besteira') ||
    transLower.includes('balela') ||
    transLower.includes('conversa fiada');

  if (isInformalOrTaboo && isNonsenseOrUntrue) {
    hintEn = `Use "${cleanWord}" in an informal context to express skepticism or reject a statement you consider untrue or insincere.`;
    hintPt = `Use "${cleanWord}" em um contexto informal para expressar ceticismo ou rejeitar uma afirmação que você considera falsa ou sem sinceridade.`;
    levelInstruction = isAdv
      ? 'Contextualize in candid dialogue, personal reflection, or calling out exaggeration.'
      : '';
    return { word: cleanWord, hint: hintEn, hintEn, hintPt, levelInstruction };
  }

  // 2. Structural text formatting / list presentation / slide design
  // e.g. BULLET (list marker)
  const isListOrPresentation =
    defLower.includes('list') ||
    defLower.includes('items in a list') ||
    defLower.includes('presentation slides') ||
    defLower.includes('printed text') ||
    defLower.includes('symbol used') ||
    transLower.includes('marcador de tópicos') ||
    transLower.includes('ponto de lista') ||
    actLower.includes('presentation') ||
    actLower.includes('slide') ||
    actLower.includes('notes');

  if (
    isListOrPresentation &&
    (defLower.includes('dot') || defLower.includes('mark') || defLower.includes('symbol') || defLower.includes('list') || transLower.includes('marcador') || transLower.includes('tópico'))
  ) {
    hintEn = `Apply "${cleanWord}" in the context of organizing information, such as preparing slides, meeting notes, or list items.`;
    hintPt = `Aplique "${cleanWord}" no contexto de organização de texto, como na preparação de slides, notas de reunião ou tópicos de uma lista.`;
    levelInstruction = '';
    return { word: cleanWord, hint: hintEn, hintEn, hintPt, levelInstruction };
  }

  // 3. Tracking metrics / plotting / data monitoring / progress over time
  // e.g. CHARTING
  const isTrackingOrMetrics =
    defLower.includes('charting') ||
    defLower.includes('tracking') ||
    defLower.includes('mapping progress') ||
    defLower.includes('trends') ||
    defLower.includes('record over time') ||
    defLower.includes('graph') ||
    transLower.includes('rastreamento') ||
    transLower.includes('mapeamento') ||
    transLower.includes('registro de dados') ||
    actLower.includes('metrics') ||
    actLower.includes('data');

  if (isTrackingOrMetrics) {
    hintEn = `Use "${cleanWord}" to describe tracking progress, monitoring metrics, or mapping data trends over time.`;
    hintPt = `Use "${cleanWord}" para descrever o acompanhamento de métricas, o monitoramento do progresso ou a análise de dados ao longo do tempo.`;
    levelInstruction = isAdv
      ? 'Reference measurable outcomes, strategic indicators, or organizational trends.'
      : '';
    return { word: cleanWord, hint: hintEn, hintEn, hintPt, levelInstruction };
  }

  // 4. Contingency / Condition & consequence / Alternatives
  // e.g. OTHERWISE
  const isContingencyOrAlternative =
    defLower.includes('if a circumstance is different') ||
    defLower.includes('if a condition is not met') ||
    defLower.includes('what will or might happen') ||
    defLower.includes('in a different way') ||
    defLower.includes('or else') ||
    transLower.includes('caso contrário') ||
    transLower.includes('de outro modo') ||
    transLower.includes('senão');

  if (isContingencyOrAlternative) {
    hintEn = `Use "${cleanWord}" to connect an important condition or requirement with the consequence that happens if it is not met.`;
    hintPt = `Use "${cleanWord}" para relacionar uma ação ou condição importante à consequência que ocorrerá caso ela não seja cumprida.`;
    levelInstruction = `State the condition first, followed by "${cleanWord}" and the outcome.`;
    return { word: cleanWord, hint: hintEn, hintEn, hintPt, levelInstruction };
  }

  // 5. Sensory / subtle light / faint emergence of hope or opportunity
  // e.g. GLIMMERING
  const isLightOrFaintHope =
    defLower.includes('shining faintly') ||
    defLower.includes('unsteady light') ||
    defLower.includes('faint sign of hope') ||
    defLower.includes('initial sign of') ||
    transLower.includes('cintilante') ||
    transLower.includes('lampejo') ||
    transLower.includes('esperança');

  if (isLightOrFaintHope) {
    hintEn = `Apply "${cleanWord}" to describe either a soft, unsteady light (like water reflections) or an emerging sign of hope and new possibility.`;
    hintPt = `Aplique "${cleanWord}" para descrever uma luz suave e tremeluzente ou um vislumbre sutil de esperança e oportunidade.`;
    levelInstruction = '';
    return { word: cleanWord, hint: hintEn, hintEn, hintPt, levelInstruction };
  }

  // 6. Action / Verb semantics (starting with "To [verb]..." or POS verb)
  if (hasRealDef && (pos === 'verb' || /^to\s+[a-z]{3,}\b/i.test(rawDef))) {
    const cleanedAction = rawDef
      .replace(/^to\s+/i, '')
      .replace(/\.$/, '')
      .trim();

    if (defLower.includes('hot drink') || defLower.includes('boiling water') || defLower.includes('tea or coffee')) {
      hintEn = `Use "${cleanWord}" to describe preparing or brewing a hot drink (such as coffee or tea) in your routine.`;
      hintPt = `Use "${cleanWord}" para descrever o preparo de uma bebida quente (como café ou chá) na sua rotina.`;
    } else if (defLower.includes('liquid to flow') || defLower.includes('into another vessel')) {
      hintEn = `Use "${cleanWord}" to describe serving or pouring a liquid into a cup or container.`;
      hintPt = `Use "${cleanWord}" para descrever o ato de servir ou despejar um líquido em uma xícara ou recipiente.`;
    } else if (defLower.includes('small mouthfuls') || defLower.includes('drink something by taking')) {
      hintEn = `Use "${cleanWord}" to describe enjoying or tasting a drink in small, slow sips.`;
      hintPt = `Use "${cleanWord}" para descrever o ato de saborear ou beber algo em pequenos goles.`;
    } else if (defLower.includes('period of work or tension') || defLower.includes('rest from work')) {
      hintEn = `Use "${cleanWord}" to describe how you relax and unwind after a busy or demanding period.`;
      hintPt = `Use "${cleanWord}" para descrever como você relaxa e descansa após um período intenso de trabalho ou esforço.`;
    } else if (defLower.includes('straighten') || defLower.includes('limbs') || defLower.includes('flexibility')) {
      hintEn = `Use "${cleanWord}" to describe stretching your muscles to relieve tension or improve flexibility.`;
      hintPt = `Use "${cleanWord}" para descrever o alongamento do corpo para aliviar a tensão ou melhorar a flexibilidade.`;
    } else if (cleanedAction) {
      const actionWords = cleanedAction.split(/\s+/);
      const shortAction = actionWords.length > 9 ? actionWords.slice(0, 9).join(' ') : cleanedAction;
      hintEn = `Use "${cleanWord}" to describe the action of ${shortAction}.`;
      const transHead = rawTrans ? rawTrans.split('/')[0].trim() : '';
      hintPt = transHead
        ? `Use "${cleanWord}" (${transHead}) para expressar a ação de ${shortAction}.`
        : `Use "${cleanWord}" para expressar a ação de ${shortAction}.`;
    }

    if (hintEn && hintPt) {
      return { word: cleanWord, hint: hintEn, hintEn, hintPt, levelInstruction: '' };
    }
  }

  // 7. Physical Tools / Utensils / Daily Routine Nouns
  if (
    hasRealDef &&
    (defLower.includes('cup with a handle') ||
      defLower.includes('pan with a long handle') ||
      defLower.includes('exercise machine') ||
      defLower.includes('meal eaten in the middle') ||
      defLower.includes('sliced bread made crisp'))
  ) {
    if (defLower.includes('cup with a handle')) {
      hintEn = `Use "${cleanWord}" to describe having a warm beverage in your morning or evening routine.`;
      hintPt = `Use "${cleanWord}" para descrever o momento de saborear uma bebida quente na sua rotina.`;
    } else if (defLower.includes('pan with a long handle')) {
      hintEn = `Use "${cleanWord}" in the context of preparing or cooking food in the kitchen.`;
      hintPt = `Use "${cleanWord}" no contexto de cozinhar ou preparar alimentos na cozinha.`;
    } else if (defLower.includes('exercise machine')) {
      hintEn = `Use "${cleanWord}" to describe an indoor workout or cardiovascular training session.`;
      hintPt = `Use "${cleanWord}" para descrever um treino cardiovascular ou corrida em ambiente interno.`;
    } else if (defLower.includes('meal eaten in the middle')) {
      hintEn = `Use "${cleanWord}" to describe having a midday meal with colleagues, friends, or family.`;
      hintPt = `Use "${cleanWord}" para descrever o momento da refeição do meio-dia com colegas ou familiares.`;
    } else if (defLower.includes('sliced bread')) {
      hintEn = `Use "${cleanWord}" in the context of having breakfast or a quick snack.`;
      hintPt = `Use "${cleanWord}" no contexto do café da manhã ou de um lanche rápido.`;
    }
    return { word: cleanWord, hint: hintEn, hintEn, hintPt, levelInstruction: '' };
  }

  // 8. General Noun / Concept semantics
  if (hasRealDef && (pos === 'noun' || /^(a|an|the)\s+/i.test(rawDef))) {
    const cleanConcept = rawDef
      .replace(/^(a|an|the)\s+/i, '')
      .replace(/\.$/, '')
      .trim();
    if (cleanConcept) {
      const conceptWords = cleanConcept.split(/\s+/);
      const shortConcept = conceptWords.length > 9 ? conceptWords.slice(0, 9).join(' ') : cleanConcept;

      hintEn = `Apply "${cleanWord}" in a sentence related to ${shortConcept}.`;
      const transHead = rawTrans ? rawTrans.split('/')[0].trim() : '';
      hintPt = transHead
        ? `Aplique "${cleanWord}" (${transHead}) em uma frase sobre esse tema ou contexto.`
        : `Aplique "${cleanWord}" em uma frase sobre esse tema ou contexto.`;
      return { word: cleanWord, hint: hintEn, hintEn, hintPt, levelInstruction: '' };
    }
  }

  // 9. Adjective / Descriptive semantics
  if (hasRealDef && (pos === 'adjective' || defLower.includes('characterized by') || defLower.includes('expressing a'))) {
    hintEn = `Apply "${cleanWord}" to describe a person, situation, or quality characterized by this state.`;
    const transHead = rawTrans ? rawTrans.split('/')[0].trim() : '';
    hintPt = transHead
      ? `Aplique "${cleanWord}" (${transHead}) para descrever uma pessoa, situação ou característica.`
      : `Aplique "${cleanWord}" para descrever uma pessoa, situação ou característica.`;
    return { word: cleanWord, hint: hintEn, hintEn, hintPt, levelInstruction: '' };
  }

  // 10. Fallback on authentic contextual example if definition was absent
  if (!hasRealDef && hasRealEx) {
    hintEn = `Apply "${cleanWord}" in a realistic sentence similar to how it was used in your lesson or routine.`;
    hintPt = `Aplique "${cleanWord}" em uma frase realista contextualizada na sua rotina ou conversa recente.`;
    return { word: cleanWord, hint: hintEn, hintEn, hintPt, levelInstruction: '' };
  }

  // Default fallback if context cannot be reliably articulated without guessing:
  // Rule 4: Return empty rather than generic boilerplate!
  return { word: cleanWord, hint: '', hintEn: '', hintPt: '', levelInstruction: '' };
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
  lessons?: LiveLesson[],
  activityDate?: string,
  referenceTimestamp?: number | string,
  timeZone?: string,
  studentUid?: string
): WeeklyHomeworkData {
  const email = studentEmail || userProfile?.email || '';
  const name = studentName || userProfile?.name || (email ? email.split('@')[0] : 'Student');
  const rawLvl = (studentLevel || userProfile?.level || 'iniciante').toLowerCase();

  const resolvedStudentUid =
    normalizeStudentUid(studentUid || userProfile?.uid || userProfile?.id, email) ||
    (studentUid || userProfile?.uid || userProfile?.id || '').trim();

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

  // HOTFIX 2.3.5J / FASE 8.4: If an activity for targetDay already exists AND has student answers or completed evaluation,
  // preserve it verbatim. If any exercise part is missing/empty, reconstruct it from existing.selectedWords!
  if (targetDay && existingDailyActivities && existingDailyActivities[targetDay]) {
    const existing = existingDailyActivities[targetDay];
    if (existing.selectedWords && existing.selectedWords.length > 0 && isActivityStartedOrAnswered(existing)) {
      const matchingPairs = (Array.isArray(existing.matchingPairs) && existing.matchingPairs.length > 0)
        ? existing.matchingPairs
        : existing.selectedWords.map((v, idx) => ({
            id: `pair-${idx + 1}`,
            word: v.word,
            definition: v.definitionEn,
            translation: v.translationPt,
          }));

      const fillInBlanks = (Array.isArray(existing.fillInBlanks) && existing.fillInBlanks.length > 0)
        ? existing.fillInBlanks
        : synthesizeFillInBlanks(existing.selectedWords.map((v) => typeof v === 'string' ? v : v.word), existing.selectedWords);

      const sentenceWritingPrompts = (Array.isArray(existing.sentenceWritingPrompts) && existing.sentenceWritingPrompts.length > 0)
        ? existing.sentenceWritingPrompts
        : existing.selectedWords.map((v) => deriveContextualSentencePrompt({
            word: typeof v === 'string' ? v : v.word,
            definitionEn: v.definitionEn,
            translationPt: v.translationPt,
            exampleSentence: v.exampleSentence,
            sourceActivityName: v.sourceActivityName,
            partOfSpeech: v.partOfSpeech,
            cefrLevel: v.cefrLevel,
            studentLevel: levelLabel,
          }));

      const readingPassage = (existing.readingPassage && existing.readingPassage.text)
        ? existing.readingPassage
        : synthesizeCohesiveStoryAndQuestions({
            words: existing.selectedWords.map((v) => typeof v === 'string' ? v : v.word),
            studentLevel: studentLevel || levelLabel,
            studentName: name,
            wordDetails: existing.selectedWords,
          });

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
        matchingPairs,
        fillInBlanks,
        sentenceWritingPrompts,
        readingPassage: {
          ...readingPassage,
          questions: Array.isArray(readingPassage.questions)
            ? readingPassage.questions.map((q: any, qIdx: number) => ({
                ...q,
                id: q?.id || `q-${qIdx + 1}`,
                options: Array.isArray(q?.options) ? q.options : [],
              }))
            : [],
        },
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

  // Canonical deterministic selection of <= 5 words according to 2-priority rule
  const rawWords: HomeworkVocabItem[] = targetDay
    ? resolveDailyMemorizationVocabulary({
        targetDay,
        activityDate,
        referenceTimestamp,
        timeZone,
        routinesByDay,
        customWords,
        lessons,
        studentUid: resolvedStudentUid,
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

  // 4. Build Sentence Writing Prompts (Part 3 - Construção de Frases Ativas Contextuais - FASE 6)
  const existingPrompts = targetDay && existingDailyActivities?.[targetDay]?.sentenceWritingPrompts;

  const sentenceWritingPrompts: SentenceWritingPrompt[] = rawWords.slice(0, 5).map((item) => {
    // Preserve existing valid personalized prompts for this word across updates
    if (Array.isArray(existingPrompts)) {
      const match = existingPrompts.find(
        (ep) => ep && ep.word && ep.word.trim().toLowerCase() === item.word.trim().toLowerCase()
      );
      if (match && isPersonalizedPrompt(match)) {
        return match;
      }
    }

    return deriveContextualSentencePrompt({
      word: item.word,
      definitionEn: item.definitionEn,
      translationPt: item.translationPt,
      exampleSentence: item.exampleSentence,
      sourceActivityName: item.sourceActivityName,
      partOfSpeech: item.partOfSpeech,
      cefrLevel: item.cefrLevel,
      studentLevel: levelLabel,
    });
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
      studentUid: (resolvedStudentUid || userProfile?.uid || userProfile?.id || email || '').trim(),
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
    studentUid: (resolvedStudentUid || userProfile?.uid || userProfile?.id || email || '').trim(),
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
  studentUid?: string;
  customWords?: Array<Partial<HomeworkVocabItem> & { word: string }>;
  targetDay?: DayOfWeek;
  activeStudyDays?: DayOfWeek[];
  weeklyCycle?: number;
  userProfile?: UserProfile;
  excludedWords?: string[] | Set<string>;
  existingDailyActivities?: Record<string, DailyHomeworkActivity>;
  existingHomework?: WeeklyHomeworkData;
  lessons?: LiveLesson[];
  activityDate?: string;
  targetDate?: string;
  referenceTimestamp?: number | string;
  timeZone?: string;
}): WeeklyHomeworkData {
  const profile = params.userProfile || ({
    weeklyStudyDays: params.activeStudyDays,
    weeklyCycle: params.weeklyCycle,
    level: params.studentLevel,
    name: params.studentName,
    email: params.studentEmail,
    uid: params.studentUid,
    id: params.studentUid,
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
    params.lessons,
    params.activityDate || params.targetDate,
    params.referenceTimestamp,
    params.timeZone,
    params.studentUid || params.userProfile?.id || (params.userProfile as any)?.uid
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

