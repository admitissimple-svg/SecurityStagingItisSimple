import {
  StudentDictionaryEntry,
  DictionaryEntryOrigin,
  DictionaryPracticeRecord,
  EnglishLevel,
  DayOfWeek,
} from '../types';
import {
  fetchStudentVocabularyFromFirestore,
  saveStudentVocabularyToFirestore,
  getCachedLocalVocabulary,
  normalizeUid,
} from './studentPersistence';
import { lookupWord } from './dictionaryService';

/**
 * Normalizes a vocabulary word or expression for deterministic indexing and deduplication.
 * - Trims outer whitespace
 * - Converts to lowercase
 * - Normalizes Unicode diacritics
 * - Normalizes curly apostrophes/quotes to standard single quotes
 * - Collapses consecutive spaces
 */
export function normalizeDictionaryWord(rawWord?: string | null): string {
  if (!rawWord || typeof rawWord !== 'string') return '';
  return rawWord
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['’]/g, "'")
    .replace(/\s+/g, ' ');
}

/**
 * Determines whether an existing definition is pedagogically richer than an incoming definition.
 * Richer definitions must never be overwritten by provisional, empty, or generic fallbacks.
 */
export function isDefinitionRicher(existingDef?: string, newDef?: string): boolean {
  const ex = (existingDef || '').trim();
  const nw = (newDef || '').trim();
  if (!ex) return false;
  if (!nw) return true;

  // Generic fallback patterns that should NOT overwrite concrete definitions
  const genericFallbackRegex = /A (fundamental word|natural conversational expression|practical English term|Key communicative expression)/i;
  const isNewGeneric = genericFallbackRegex.test(nw);
  const isExistingGeneric = genericFallbackRegex.test(ex);

  if (isNewGeneric && !isExistingGeneric) {
    return true;
  }
  if (!isNewGeneric && isExistingGeneric) {
    return false;
  }

  // If new definition is shorter by more than 15 chars and existing is substantive, keep existing
  if (ex.length > 20 && nw.length < 15) {
    return true;
  }

  return false;
}

/**
 * Consolidates new dictionary entries into an existing dictionary array.
 * Pure, deterministic consolidation engine that guarantees:
 * 1. Zero unwanted duplicates (deduplication by normalizedWord).
 * 2. Multi-origin preservation: keeps both 'routine' and 'native_notes' with their full contexts.
 * 3. Richer definition preservation: never downgrades enriched definitions to generic fallbacks.
 * 4. Practice metrics preservation: never resets practiceCount or lastPracticedAt.
 * 5. Full backwards compatibility with legacy entries lacking new optional fields.
 */
export function consolidateDictionaryEntries(
  existingList: StudentDictionaryEntry[] = [],
  newEntries: StudentDictionaryEntry[] = []
): StudentDictionaryEntry[] {
  const masterMap = new Map<string, StudentDictionaryEntry>();

  // 1. Index existing entries
  existingList.forEach((item) => {
    if (!item || !item.word || !item.word.trim()) return;
    const norm = normalizeDictionaryWord(item.normalizedWord || item.word);
    if (!norm) return;

    // Ensure item has normalizedWord stamped
    const normalizedItem: StudentDictionaryEntry = {
      ...item,
      normalizedWord: item.normalizedWord || norm,
      originalWord: item.originalWord || item.word,
    };
    masterMap.set(norm, normalizedItem);
  });

  // 2. Merge new entries
  newEntries.forEach((incoming) => {
    if (!incoming || !incoming.word || !incoming.word.trim()) return;
    const cleanWord = incoming.word.trim();
    const norm = normalizeDictionaryWord(incoming.normalizedWord || cleanWord);
    if (!norm) return;

    const existing = masterMap.get(norm);

    if (!existing) {
      // Brand-new entry: establish origins
      const initialOrigins: DictionaryEntryOrigin[] = Array.isArray(incoming.origins) && incoming.origins.length > 0
        ? [...incoming.origins]
        : incoming.source
        ? [
            {
              source: incoming.source,
              activityName: incoming.sourceActivityName,
              dayOfWeek: incoming.sourceDay,
              date: incoming.learnedAt ? incoming.learnedAt.split('T')[0] : new Date().toISOString().split('T')[0],
              lessonId: incoming.lessonRefId,
              videoId: incoming.routineRef?.videoId,
              videoTitle: incoming.routineRef?.videoTitle,
            },
          ]
        : [];

      masterMap.set(norm, {
        ...incoming,
        id: incoming.id || `dict_${norm.replace(/[^a-zA-Z0-9_-]/g, '_')}_${Date.now()}`,
        word: cleanWord,
        originalWord: incoming.originalWord || cleanWord,
        normalizedWord: norm,
        origins: initialOrigins,
        firstSeenAt: incoming.firstSeenAt || incoming.learnedAt || new Date().toISOString(),
        practiceCount: typeof incoming.practiceCount === 'number' ? incoming.practiceCount : 0,
      });
      return;
    }

    // Merging into existing record:
    // A. Definitions & Examples: Keep richer definition
    const keepExistingDef = isDefinitionRicher(existing.definitionEn, incoming.definitionEn);
    const resolvedDefinition = keepExistingDef
      ? existing.definitionEn
      : (incoming.definitionEn || existing.definitionEn || '');

    const resolvedExample = existing.exampleSentenceEn && (!incoming.exampleSentenceEn || incoming.exampleSentenceEn.length < existing.exampleSentenceEn.length)
      ? existing.exampleSentenceEn
      : (incoming.exampleSentenceEn || existing.exampleSentenceEn || '');

    // B. Translations
    const mergedTranslations: Record<string, string> = {
      ...(existing.translations || {}),
      ...(incoming.translations || {}),
    };
    if (incoming.translationPt && !mergedTranslations.pt) {
      mergedTranslations.pt = incoming.translationPt;
    } else if (existing.translationPt && !mergedTranslations.pt) {
      mergedTranslations.pt = existing.translationPt;
    }

    // C. Explanations
    const mergedExplanations: Record<string, string> = {
      ...(existing.explanations || {}),
      ...(incoming.explanations || {}),
    };

    // D. Contextual Examples array
    const mergedExamples = [...(existing.examples || [])];
    if (Array.isArray(incoming.examples)) {
      incoming.examples.forEach((ex) => {
        const isDup = mergedExamples.some(
          (m) => m.sentence.toLowerCase().trim() === ex.sentence.toLowerCase().trim()
        );
        if (!isDup) mergedExamples.push(ex);
      });
    }

    // E. Practice metrics: NEVER decrease or reset practiceCount
    const exCount = typeof existing.practiceCount === 'number' ? existing.practiceCount : 0;
    const inCount = typeof incoming.practiceCount === 'number' ? incoming.practiceCount : 0;
    const mergedPracticeCount = Math.max(exCount, inCount);

    let mergedLastPracticedAt = existing.lastPracticedAt;
    if (incoming.lastPracticedAt) {
      if (!existing.lastPracticedAt || new Date(incoming.lastPracticedAt) > new Date(existing.lastPracticedAt)) {
        mergedLastPracticedAt = incoming.lastPracticedAt;
      }
    }

    // F. Practice history accumulation
    const mergedPracticeHistory: DictionaryPracticeRecord[] = [...(existing.practiceHistory || [])];
    if (Array.isArray(incoming.practiceHistory)) {
      incoming.practiceHistory.forEach((h) => {
        const isDup = mergedPracticeHistory.some(
          (m) => m.date === h.date && m.activityType === h.activityType
        );
        if (!isDup) mergedPracticeHistory.push(h);
      });
    }

    // G. Origins accumulation: Preserve both sources (e.g. routine AND native_notes)
    const mergedOrigins: DictionaryEntryOrigin[] = [...(existing.origins || [])];

    // Seed existing legacy source if origins was empty
    if (mergedOrigins.length === 0 && existing.source) {
      mergedOrigins.push({
        source: existing.source,
        activityName: existing.sourceActivityName,
        dayOfWeek: existing.sourceDay,
        date: existing.learnedAt ? existing.learnedAt.split('T')[0] : undefined,
      });
    }

    const incomingOrigins = Array.isArray(incoming.origins) && incoming.origins.length > 0
      ? incoming.origins
      : incoming.source
      ? [
          {
            source: incoming.source,
            activityName: incoming.sourceActivityName,
            dayOfWeek: incoming.sourceDay,
            date: incoming.learnedAt ? incoming.learnedAt.split('T')[0] : undefined,
            lessonId: incoming.lessonRefId,
            videoId: incoming.routineRef?.videoId,
            videoTitle: incoming.routineRef?.videoTitle,
          },
        ]
      : [];

    incomingOrigins.forEach((newOrig) => {
      const isDup = mergedOrigins.some(
        (o) =>
          o.source === newOrig.source &&
          (o.activityName || '') === (newOrig.activityName || '') &&
          (o.dayOfWeek || '') === (newOrig.dayOfWeek || '') &&
          (o.lessonId || '') === (newOrig.lessonId || '') &&
          (o.videoId || '') === (newOrig.videoId || '')
      );
      if (!isDup) {
        mergedOrigins.push(newOrig);
      }
    });

    // Determine primary source label: if exists across both, prioritize showing richness
    let primarySource = existing.source || incoming.source || 'api';
    if (mergedOrigins.some((o) => o.source === 'live_lesson' || o.source === 'native_notes')) {
      primarySource = 'live_lesson';
    } else if (mergedOrigins.some((o) => o.source === 'routine')) {
      primarySource = 'routine';
    }

    // H. Enrichment status
    const enrichmentStatus =
      existing.enrichmentStatus === 'enriched' || incoming.enrichmentStatus === 'enriched'
        ? 'enriched'
        : incoming.enrichmentStatus || existing.enrichmentStatus || 'standard';

    // Build consolidated record
    const merged: StudentDictionaryEntry = {
      ...existing,
      ...incoming,
      id: existing.id || incoming.id,
      word: existing.word || cleanWord,
      originalWord: existing.originalWord || incoming.originalWord || cleanWord,
      normalizedWord: norm,
      definitionEn: resolvedDefinition,
      exampleSentenceEn: resolvedExample,
      partOfSpeech: existing.partOfSpeech || incoming.partOfSpeech || '',
      phonetic: incoming.phonetic || existing.phonetic,
      audio: incoming.audio || existing.audio || incoming.audioUrl || existing.audioUrl,
      audioUrl: incoming.audioUrl || existing.audioUrl || incoming.audio || existing.audio,
      cefrLevel: incoming.cefrLevel || existing.cefrLevel || 'B1',
      translationPt: mergedTranslations.pt || incoming.translationPt || existing.translationPt,
      translations: mergedTranslations,
      explanations: mergedExplanations,
      examples: mergedExamples,
      origins: mergedOrigins,
      source: primarySource,
      sourceActivityName: incoming.sourceActivityName || existing.sourceActivityName,
      sourceDay: incoming.sourceDay || existing.sourceDay,
      lessonRefId: incoming.lessonRefId || existing.lessonRefId,
      routineRef: incoming.routineRef || existing.routineRef,
      learnedAt: existing.learnedAt || incoming.learnedAt || new Date().toISOString(),
      firstSeenAt: existing.firstSeenAt || incoming.firstSeenAt || existing.learnedAt || incoming.learnedAt,
      practiceCount: mergedPracticeCount,
      lastPracticedAt: mergedLastPracticedAt,
      practiceHistory: mergedPracticeHistory,
      enrichmentStatus,
      aiMetadata: incoming.aiMetadata || existing.aiMetadata,
      notFound: existing.notFound && incoming.notFound,
    };

    masterMap.set(norm, merged);
  });

  return Array.from(masterMap.values()).sort((a, b) =>
    (a.word || '').localeCompare(b.word || '', ['en', 'pt'], { sensitivity: 'base' })
  );
}

/**
 * Pedagogical Library Service: Queries a student's personal dictionary.
 * Uses authoritative Cloud Firestore backing with in-memory caching for zero latency.
 */
export async function getStudentDictionary(
  studentUid: string,
  studentEmail?: string
): Promise<StudentDictionaryEntry[]> {
  const cleanUid = normalizeUid(studentUid, studentEmail);
  if (!cleanUid && !studentEmail) {
    return [];
  }

  // 1. Fetch authoritative vocabulary from Cloud Firestore
  const fsEntries = await fetchStudentVocabularyFromFirestore(cleanUid, studentEmail);

  // 2. Ensure each entry has normalized form and origins populated
  return fsEntries.map((e) => {
    const norm = normalizeDictionaryWord(e.normalizedWord || e.word);
    const origins = Array.isArray(e.origins) && e.origins.length > 0
      ? e.origins
      : e.source
      ? [
          {
            source: e.source,
            activityName: e.sourceActivityName,
            dayOfWeek: e.sourceDay,
            date: e.learnedAt ? e.learnedAt.split('T')[0] : undefined,
          },
        ]
      : [];

    return {
      ...e,
      normalizedWord: norm,
      originalWord: e.originalWord || e.word,
      origins,
    };
  });
}

/**
 * Queries a single word or expression within a student's personal dictionary.
 */
export async function findDictionaryWord(
  studentUid: string,
  word: string,
  studentEmail?: string
): Promise<StudentDictionaryEntry | null> {
  const norm = normalizeDictionaryWord(word);
  if (!norm) return null;

  // 1. Check local session cache first
  const cachedList = getCachedLocalVocabulary(studentUid, studentEmail);
  const foundInCache = cachedList.find((e) => normalizeDictionaryWord(e.normalizedWord || e.word) === norm);
  if (foundInCache) return foundInCache;

  // 2. Fetch from Firestore
  const allWords = await getStudentDictionary(studentUid, studentEmail);
  return allWords.find((e) => normalizeDictionaryWord(e.normalizedWord || e.word) === norm) || null;
}

/**
 * Saves and updates entries in the student's personal dictionary.
 * Leverages consolidateDictionaryEntries to prevent duplicate creations,
 * preserve practice counts, and accumulate multi-origin references.
 */
export async function saveStudentDictionary(
  studentUid: string,
  entries: StudentDictionaryEntry[],
  studentEmail?: string
): Promise<boolean> {
  const cleanUid = normalizeUid(studentUid, studentEmail);
  if (!cleanUid && !studentEmail) return false;
  if (!entries || entries.length === 0) return true;

  // 1. Fetch existing entries
  const existing = await getStudentDictionary(cleanUid, studentEmail);

  // 2. Consolidate without data loss
  const consolidated = consolidateDictionaryEntries(existing, entries);

  // 3. Persist to Firestore authoritative store
  return saveStudentVocabularyToFirestore(cleanUid, consolidated, studentEmail);
}

/**
 * Updates practice metrics for a set of words without modifying other pedagogical attributes.
 */
export async function recordWordPractice(
  studentUid: string,
  words: string[],
  activityType: 'memorization' | 'homework' | 'sentence' | 'routine' | string,
  studentEmail?: string
): Promise<StudentDictionaryEntry[]> {
  const cleanUid = normalizeUid(studentUid, studentEmail);
  if (!cleanUid || !words || words.length === 0) {
    return getCachedLocalVocabulary(cleanUid, studentEmail);
  }

  const normTargetSet = new Set(words.map((w) => normalizeDictionaryWord(w)).filter(Boolean));
  const currentEntries = await getStudentDictionary(cleanUid, studentEmail);
  const nowIso = new Date().toISOString();

  let modifiedCount = 0;
  const updatedEntries = currentEntries.map((entry) => {
    const norm = normalizeDictionaryWord(entry.normalizedWord || entry.word);
    if (normTargetSet.has(norm)) {
      modifiedCount++;
      const curCount = typeof entry.practiceCount === 'number' ? entry.practiceCount : 0;
      const history = Array.isArray(entry.practiceHistory) ? [...entry.practiceHistory] : [];
      history.push({
        date: nowIso,
        activityType,
        correct: true,
      });

      return {
        ...entry,
        practiceCount: curCount + 1,
        lastPracticedAt: nowIso,
        practiceHistory: history,
      };
    }
    return entry;
  });

  if (modifiedCount > 0) {
    await saveStudentVocabularyToFirestore(cleanUid, updatedEntries, studentEmail);
  }

  return updatedEntries;
}
