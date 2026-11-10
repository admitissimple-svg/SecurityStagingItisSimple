/**
 * FASE INSIGHTS.2 — Weekly Learning Insights Deterministic Engine
 *
 * Grounded strictly and exclusively in two canonical sources:
 * 1. My Dictionary → My Words (users/{uid}.vocabulary & users/{uid}/vocabulary)
 * 2. View Journal → Your Sentence (users/{uid}.dailyJournalEntries & users/{uid}/journal)
 *
 * Rules:
 * - Timezone: America/Sao_Paulo.
 * - Week starts Monday 00:00:00 -03:00 and ends next Monday 00:00:00 -03:00 (exclusive).
 * - If current week has eligible records, display only current week.
 * - If current week has NO eligible records, consult previous week.
 * - If both are empty, return empty state.
 * - Zero AI / Gemini calls.
 * - All pedagogical presentation in English.
 */

export const SAO_PAULO_TZ = 'America/Sao_Paulo';
export const SAO_PAULO_OFFSET = '-03:00';

export interface WeeklyLearningWord {
  id: string;
  word: string;
  partOfSpeech: string;
  meaning: string;
  example: string;
  date: string;
  timestampMs: number | null;
}

export interface WeeklyLearningSentence {
  id: string;
  sentence: string;
  correctedSentence?: string | null;
  explanation?: string | null;
  date: string;
  timestampMs: number | null;
}

export type WeeklyPeriodType = 'current_week' | 'previous_week' | 'empty';

export interface WeekBoundary {
  startMs: number;
  endMs: number;
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
  formattedRange: string; // e.g. "Nov 9 – Nov 15, 2026"
}

export interface WeeklyLearningInsightsResult {
  studentUid: string;
  studentEmail?: string;
  period: WeeklyPeriodType;
  periodLabel: string;
  weekRange: {
    startDate: string;
    endDate: string;
    formattedRange: string;
  };
  vocabulary: WeeklyLearningWord[];
  sentences: WeeklyLearningSentence[];
  hasWords: boolean;
  hasSentences: boolean;
  totalItems: number;
  isFallbackToPreviousWeek: boolean;
}

/**
 * Parses date candidates into a precise UTC millisecond timestamp
 * aligned with the America/Sao_Paulo calendar.
 * Returns null if the date is invalid or unparseable.
 */
export function parseRecordDateToSaoPauloTimestamp(rawDate?: any): number | null {
  if (rawDate === null || rawDate === undefined || rawDate === '') return null;

  if (typeof rawDate === 'number') {
    if (isNaN(rawDate) || rawDate <= 0) return null;
    return rawDate;
  }

  const str = String(rawDate).trim();
  if (!str) return null;

  // Pure calendar date YYYY-MM-DD
  const calendarMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str);
  if (calendarMatch) {
    const [, y, m, d] = calendarMatch;
    // Set to 12:00:00 PM in Sao Paulo to stay safely inside the calendar day
    const isoString = `${y}-${m}-${d}T12:00:00${SAO_PAULO_OFFSET}`;
    const ts = new Date(isoString).getTime();
    return isNaN(ts) ? null : ts;
  }

  // ISO string or parseable date string
  const parsed = new Date(str).getTime();
  if (isNaN(parsed) || parsed <= 0) return null;
  return parsed;
}

const MONTH_NAMES_EN = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

function formatRangeString(startYear: number, startMonth: number, startDay: number, endYear: number, endMonth: number, endDay: number): string {
  const startM = MONTH_NAMES_EN[startMonth - 1] || '';
  const endM = MONTH_NAMES_EN[endMonth - 1] || '';

  if (startYear === endYear) {
    if (startMonth === endMonth) {
      return `${startM} ${startDay} – ${endDay}, ${startYear}`;
    }
    return `${startM} ${startDay} – ${endM} ${endDay}, ${startYear}`;
  }
  return `${startM} ${startDay}, ${startYear} – ${endM} ${endDay}, ${endYear}`;
}

/**
 * Calculates current and previous week boundaries in America/Sao_Paulo.
 * Monday 00:00:00 to next Monday 00:00:00 (exclusive).
 * Accurately handles month transitions, leap years, and year changes.
 */
export function getWeekBoundariesInSaoPaulo(refDate: Date = new Date()): {
  currentWeek: WeekBoundary;
  previousWeek: WeekBoundary;
} {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: SAO_PAULO_TZ,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
  }).formatToParts(refDate);

  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;

  const year = parseInt(map.year, 10);
  const month = parseInt(map.month, 10);
  const day = parseInt(map.day, 10);

  const weekdayMap: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 0 };
  const dayOfWeek = weekdayMap[map.weekday] ?? 1;
  const daysSinceMonday = (dayOfWeek + 6) % 7;

  // Monday of the current week (UTC arithmetic prevents local timezone shifts)
  const currentDayUtc = Date.UTC(year, month - 1, day);
  const curMonUtc = new Date(currentDayUtc - daysSinceMonday * 86400000);
  const curMonYear = curMonUtc.getUTCFullYear();
  const curMonMonth = curMonUtc.getUTCMonth() + 1;
  const curMonDay = curMonUtc.getUTCDate();

  // Sunday of the current week (inclusive end of presentation range)
  const curSunUtc = new Date(curMonUtc.getTime() + 6 * 86400000);
  const curSunYear = curSunUtc.getUTCFullYear();
  const curSunMonth = curSunUtc.getUTCMonth() + 1;
  const curSunDay = curSunUtc.getUTCDate();

  // Next Monday (exclusive boundary: 00:00:00)
  const nextMonUtc = new Date(curMonUtc.getTime() + 7 * 86400000);
  const nextMonYear = nextMonUtc.getUTCFullYear();
  const nextMonMonth = nextMonUtc.getUTCMonth() + 1;
  const nextMonDay = nextMonUtc.getUTCDate();

  // Previous Monday
  const prevMonUtc = new Date(curMonUtc.getTime() - 7 * 86400000);
  const prevMonYear = prevMonUtc.getUTCFullYear();
  const prevMonMonth = prevMonUtc.getUTCMonth() + 1;
  const prevMonDay = prevMonUtc.getUTCDate();

  // Previous Sunday
  const prevSunUtc = new Date(curMonUtc.getTime() - 1 * 86400000);
  const prevSunYear = prevSunUtc.getUTCFullYear();
  const prevSunMonth = prevSunUtc.getUTCMonth() + 1;
  const prevSunDay = prevSunUtc.getUTCDate();

  const pad = (n: number) => String(n).padStart(2, '0');
  const makeSpIso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}T00:00:00${SAO_PAULO_OFFSET}`;

  const currentWeekStartMs = new Date(makeSpIso(curMonYear, curMonMonth, curMonDay)).getTime();
  const currentWeekEndMs = new Date(makeSpIso(nextMonYear, nextMonMonth, nextMonDay)).getTime();

  const prevWeekStartMs = new Date(makeSpIso(prevMonYear, prevMonMonth, prevMonDay)).getTime();
  const prevWeekEndMs = currentWeekStartMs;

  return {
    currentWeek: {
      startMs: currentWeekStartMs,
      endMs: currentWeekEndMs,
      startDate: `${curMonYear}-${pad(curMonMonth)}-${pad(curMonDay)}`,
      endDate: `${nextMonYear}-${pad(nextMonMonth)}-${pad(nextMonDay)}`,
      formattedRange: formatRangeString(curMonYear, curMonMonth, curMonDay, curSunYear, curSunMonth, curSunDay),
    },
    previousWeek: {
      startMs: prevWeekStartMs,
      endMs: prevWeekEndMs,
      startDate: `${prevMonYear}-${pad(prevMonMonth)}-${pad(prevMonDay)}`,
      endDate: `${curMonYear}-${pad(curMonMonth)}-${pad(curMonDay)}`,
      formattedRange: formatRangeString(prevMonYear, prevMonMonth, prevMonDay, prevSunYear, prevSunMonth, prevSunDay),
    },
  };
}

/**
 * Extracts and maps raw dictionary entries into canonical WeeklyLearningWord objects.
 * Strict exclusion of catalog-only / unsaved suggestions.
 */
export function extractCanonicalWords(rawWords: any[]): WeeklyLearningWord[] {
  if (!Array.isArray(rawWords)) return [];

  const results: WeeklyLearningWord[] = [];
  const seenWords = new Set<string>();

  for (const item of rawWords) {
    if (!item) continue;
    const word = (item.word || item.term || item.originalWord || '').trim();
    if (!word) continue;

    // Ignore placeholder / not_found markers
    if (item.notFound === true || item.status === 'not_found') continue;

    const lower = word.toLowerCase();
    if (seenWords.has(lower)) continue;
    seenWords.add(lower);

    // Extract pedagogical fields
    const partOfSpeech = (item.partOfSpeech || 'Word').trim();
    const meaning = (
      item.definitionEn ||
      item.simpleDefinition ||
      (item.explanations && (item.explanations.en || item.explanations.pt)) ||
      item.translationPt ||
      ''
    ).trim();

    let example = (item.exampleSentenceEn || '').trim();
    if (!example && Array.isArray(item.examples) && item.examples.length > 0) {
      const firstEx = item.examples[0];
      example = (typeof firstEx === 'string' ? firstEx : (firstEx?.sentence || '')).trim();
    }

    const rawDate = item.learnedAt || item.firstSeenAt || item.createdAt || item.date || item.updatedAt || '';
    const ts = parseRecordDateToSaoPauloTimestamp(rawDate);

    results.push({
      id: item.id || `word_${lower.replace(/[^a-zA-Z0-9_-]/g, '_')}`,
      word,
      partOfSpeech,
      meaning,
      example,
      date: typeof rawDate === 'string' ? rawDate : (ts ? new Date(ts).toISOString() : ''),
      timestampMs: ts,
    });
  }

  return results;
}

/**
 * Extracts and maps raw journal entries into canonical WeeklyLearningSentence objects.
 * Strict inclusion of entries where the student actually recorded a sentence.
 */
export function extractCanonicalSentences(rawJournal: any[]): WeeklyLearningSentence[] {
  if (!Array.isArray(rawJournal)) return [];

  const results: WeeklyLearningSentence[] = [];
  const seenIds = new Set<string>();

  for (const entry of rawJournal) {
    if (!entry) continue;

    // Only process entries with student's original sentence
    const sentence = (entry.sentence || '').trim();
    if (!sentence) continue;

    const id = String(entry.id || '').trim() || `sentence_${results.length}`;
    if (seenIds.has(id)) continue;
    seenIds.add(id);

    const correctedSentence = (
      entry.correctedSentence &&
      entry.correctedSentence.trim() !== sentence
    ) ? entry.correctedSentence.trim() : null;

    const explanation = (
      entry.explanation ||
      entry.evaluationResult?.feedback ||
      entry.evaluationResult?.pedagogicalExplanation ||
      entry.evaluationResult?.explanation ||
      null
    );

    const rawDate = entry.date || entry.createdAt || entry.updatedAt || '';
    const ts = parseRecordDateToSaoPauloTimestamp(rawDate);

    results.push({
      id,
      sentence,
      correctedSentence,
      explanation: explanation ? String(explanation).trim() : null,
      date: typeof rawDate === 'string' ? rawDate : (ts ? new Date(ts).toISOString() : ''),
      timestampMs: ts,
    });
  }

  return results;
}

/**
 * Builds the complete deterministic Weekly Learning Insights payload.
 *
 * Evaluation:
 * 1. Checks current week [startMs, endMs).
 * 2. If current week has >= 1 eligible word OR sentence, selects current week.
 * 3. Else, checks previous week [prevStartMs, curStartMs).
 * 4. If previous week has >= 1 eligible word OR sentence, selects previous week.
 * 5. Else, returns empty state.
 */
export function buildWeeklyLearningInsights(params: {
  rawWords: any[];
  rawSentences: any[];
  studentUid: string;
  studentEmail?: string;
  referenceDate?: Date;
}): WeeklyLearningInsightsResult {
  const { rawWords, rawSentences, studentUid, studentEmail, referenceDate = new Date() } = params;

  const boundaries = getWeekBoundariesInSaoPaulo(referenceDate);
  const words = extractCanonicalWords(rawWords);
  const sentences = extractCanonicalSentences(rawSentences);

  // Filter words and sentences by valid timestamp in America/Sao_Paulo
  const filterByRange = <T extends { timestampMs: number | null }>(
    items: T[],
    startMs: number,
    endMs: number
  ): T[] => {
    return items.filter((item) => item.timestampMs !== null && item.timestampMs >= startMs && item.timestampMs < endMs);
  };

  const curWords = filterByRange(words, boundaries.currentWeek.startMs, boundaries.currentWeek.endMs);
  const curSentences = filterByRange(sentences, boundaries.currentWeek.startMs, boundaries.currentWeek.endMs);

  const prevWords = filterByRange(words, boundaries.previousWeek.startMs, boundaries.previousWeek.endMs);
  const prevSentences = filterByRange(sentences, boundaries.previousWeek.startMs, boundaries.previousWeek.endMs);

  // Sorting helpers: newest first
  const sortByNewest = <T extends { timestampMs: number | null; id: string }>(items: T[]): T[] => {
    return [...items].sort((a, b) => (b.timestampMs || 0) - (a.timestampMs || 0));
  };

  if (curWords.length > 0 || curSentences.length > 0) {
    const selectedWords = sortByNewest(curWords);
    const selectedSentences = sortByNewest(curSentences);
    return {
      studentUid,
      studentEmail,
      period: 'current_week',
      periodLabel: `Current Week (${boundaries.currentWeek.formattedRange})`,
      weekRange: {
        startDate: boundaries.currentWeek.startDate,
        endDate: boundaries.currentWeek.endDate,
        formattedRange: boundaries.currentWeek.formattedRange,
      },
      vocabulary: selectedWords,
      sentences: selectedSentences,
      hasWords: selectedWords.length > 0,
      hasSentences: selectedSentences.length > 0,
      totalItems: selectedWords.length + selectedSentences.length,
      isFallbackToPreviousWeek: false,
    };
  }

  if (prevWords.length > 0 || prevSentences.length > 0) {
    const selectedWords = sortByNewest(prevWords);
    const selectedSentences = sortByNewest(prevSentences);
    return {
      studentUid,
      studentEmail,
      period: 'previous_week',
      periodLabel: `Previous Week (${boundaries.previousWeek.formattedRange})`,
      weekRange: {
        startDate: boundaries.previousWeek.startDate,
        endDate: boundaries.previousWeek.endDate,
        formattedRange: boundaries.previousWeek.formattedRange,
      },
      vocabulary: selectedWords,
      sentences: selectedSentences,
      hasWords: selectedWords.length > 0,
      hasSentences: selectedSentences.length > 0,
      totalItems: selectedWords.length + selectedSentences.length,
      isFallbackToPreviousWeek: true,
    };
  }

  return {
    studentUid,
    studentEmail,
    period: 'empty',
    periodLabel: `Current Week (${boundaries.currentWeek.formattedRange})`,
    weekRange: {
      startDate: boundaries.currentWeek.startDate,
      endDate: boundaries.currentWeek.endDate,
      formattedRange: boundaries.currentWeek.formattedRange,
    },
    vocabulary: [],
    sentences: [],
    hasWords: false,
    hasSentences: false,
    totalItems: 0,
    isFallbackToPreviousWeek: false,
  };
}
