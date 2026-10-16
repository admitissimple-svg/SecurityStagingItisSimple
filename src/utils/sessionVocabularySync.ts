import { StudentDictionaryEntry, EnglishLevel } from '../types';
import {
  extractNotesMarkings,
  resolveCefrLevel,
  PedagogicalVocabularyItem,
} from './pedagogicalTransformer';
import { lookupWord } from './dictionaryService';
import { persistStudentVocabularyViaBackendApi } from './studentPersistence';
import { normalizeDictionaryWord } from './studentDictionaryLibrary';

export interface SyncSessionVocabParams {
  studentUid: string;
  studentEmail?: string;
  rawNotes?: string;
  vocabularyAndExpressions?: PedagogicalVocabularyItem[];
  studentLevel?: EnglishLevel | string;
  sessionDate?: string;
  topic?: string;
  teacherName?: string;
  lessonId?: string;
  skipClientWrite?: boolean;
}

/**
 * Normalizes example sentence to have clean formatting.
 */
function formatSentence(str?: string): string {
  if (!str) return '';
  let cleaned = str.trim().replace(/^["']|["']$/g, '').trim();
  if (cleaned && !/[.!?]$/.test(cleaned)) {
    cleaned += '.';
  }
  return cleaned;
}

/**
 * Synchronizes words and expressions indicated by the Native Friend/Tutor
 * during a session into the student's "My Dictionary" in Cloud Firestore.
 *
 * Strict Compliance Requirements (Fase 4B.7A):
 * 1. ONLY words explicitly marked as New Word (Alt + W) enter My Dictionary.
 * 2. Items marked exclusively as Pronounce (Alt + P) remain in pedagogical notes
 *    and do NOT enter the personal dictionary automatically.
 * 3. If a term has both New Word (Alt+W) and Pronounce (Alt+P), it enters as a New Word
 *    while retaining its pronunciation focus guidance.
 * 4. Zero direct client Firestore writes: 100% of data is persisted via backend API with Firebase Bearer.
 * 5. Multi-origin preservation: source 'live_lesson', origin 'native_notes'.
 */
export async function syncSessionVocabularyToStudentDictionary(
  params: SyncSessionVocabParams
): Promise<StudentDictionaryEntry[]> {
  const {
    studentUid,
    studentEmail,
    rawNotes = '',
    vocabularyAndExpressions = [],
    studentLevel = EnglishLevel.INTERMEDIATE,
    sessionDate = new Date().toISOString().split('T')[0],
    topic = 'Conversation & Fluency',
    teacherName = 'Native Friend',
    lessonId,
  } = params;

  const cleanUid = (studentUid || '').trim();
  const cleanEmail = (studentEmail || '').toLowerCase().trim();

  if (!cleanUid && !cleanEmail) {
    return [];
  }

  const cefrMeta = resolveCefrLevel(studentLevel);

  // 1. Extract raw markings from notes (Alt + W: new-word, Alt + P: pronounce)
  const markings = rawNotes ? extractNotesMarkings(rawNotes) : { newWords: [], pronounceItems: [] };

  // 2. Build term candidates map
  interface TermMetadata {
    term: string;
    isPronounce: boolean;
    isNewWord: boolean;
    partOfSpeech?: string;
    definitionEn?: string;
    exampleSentenceEn?: string;
    phonetic?: string;
  }

  const candidateMap = new Map<string, TermMetadata>();

  // Add terms from raw markings (Alt + W: New Word) -> EXCLUSIVE ENTRY PERMITTED
  (markings.newWords || []).forEach((w) => {
    const clean = w.trim();
    if (!clean) return;
    const key = normalizeDictionaryWord(clean);
    if (!key) return;
    if (!candidateMap.has(key)) {
      candidateMap.set(key, {
        term: clean,
        isPronounce: false,
        isNewWord: true,
      });
    } else {
      candidateMap.get(key)!.isNewWord = true;
    }
  });

  // Check terms from raw markings (Alt + P: Pronounce)
  // RULE: Items marked EXCLUSIVELY as Pronounce (Alt + P) remain in pedagogical notes
  // and do NOT automatically enter My Dictionary!
  (markings.pronounceItems || []).forEach((p) => {
    const clean = p.trim();
    if (!clean) return;
    const key = normalizeDictionaryWord(clean);
    if (!key) return;
    const existing = candidateMap.get(key);
    if (existing) {
      // Word is already marked as Alt+W (New Word), so annotate with pronunciation focus
      existing.isPronounce = true;
    }
    // If not existing in candidateMap, do NOT add: strictly kept out of My Dictionary
  });

  // Merge terms from pedagogical transformation vocabulary (if provided)
  // Strictly enforce Rule 2: Only accept terms that are proven New Words (Alt+W)
  (vocabularyAndExpressions || []).forEach((v) => {
    const clean = (v.term || '').trim();
    if (!clean) return;
    const key = normalizeDictionaryWord(clean);
    if (!key) return;
    const existing = candidateMap.get(key);

    const inAltWNotes = (markings.newWords || []).some((w) => normalizeDictionaryWord(w) === key);
    const inAltPNotes = (markings.pronounceItems || []).some((p) => normalizeDictionaryWord(p) === key);
    const isAltPIsolated = inAltPNotes && !inAltWNotes;

    // Strict Rule 2: Alt+P isolated NEVER enters My Dictionary
    if (isAltPIsolated) {
      return;
    }

    const isExplicitNewWord =
      Boolean(existing?.isNewWord) ||
      inAltWNotes ||
      (!rawNotes && (Boolean(v.isNewWord) || v.category?.toLowerCase().includes('alt+w') || v.category?.toLowerCase().includes('new word')));

    // Only if it is explicitly a New Word (Alt+W)
    if (isExplicitNewWord) {
      const isPronounce =
        Boolean(v.isPronunciationFocus) ||
        Boolean(existing?.isPronounce) ||
        inAltPNotes;

      const candidate: TermMetadata = {
        term: clean,
        isPronounce,
        isNewWord: true,
        partOfSpeech: v.partOfSpeech || (isPronounce ? 'Pronunciation Focus' : 'Expression'),
        definitionEn: v.simpleDefinition || existing?.definitionEn,
        exampleSentenceEn: Array.isArray(v.realExamples) && v.realExamples.length > 0 ? v.realExamples[0] : existing?.exampleSentenceEn,
        phonetic: v.phoneticGuide || existing?.phonetic,
      };

      candidateMap.set(key, candidate);
    }
  });

  if (candidateMap.size === 0) {
    return [];
  }

  // 3. Enrich entries adhering to the unified Native Friend Notes pedagogical standard
  const dictionaryEntries: StudentDictionaryEntry[] = [];

  for (const [key, meta] of candidateMap.entries()) {
    let definition = meta.definitionEn || '';
    let example = meta.exampleSentenceEn || '';
    let partOfSpeech = meta.partOfSpeech || '';
    let phonetic = meta.phonetic || '';

    // If definition or example is missing, do a pedagogical dictionary lookup (No Gemini)
    if (!definition || !example || !partOfSpeech) {
      try {
        const lookupRes = await lookupWord(meta.term, undefined, studentLevel);
        if (lookupRes && !lookupRes.notFound && lookupRes.definitionEn) {
          if (!definition) definition = lookupRes.definitionEn;
          if (!example && lookupRes.exampleSentenceEn) example = lookupRes.exampleSentenceEn;
          if (!partOfSpeech && lookupRes.partOfSpeech) partOfSpeech = lookupRes.partOfSpeech;
          if (!phonetic && lookupRes.phonetic) phonetic = lookupRes.phonetic;
        }
      } catch (err) {
        console.warn(`Dictionary lookup notice for "${meta.term}":`, err);
      }
    }

    // Default pedagogical fallback for definitions if API did not return one
    if (!definition) {
      definition = meta.isPronounce
        ? `Pronunciation focus: Pay careful attention to syllable stress, vowel reduction, and clear articulation of "${meta.term}".`
        : cefrMeta.cefr === 'A1' || cefrMeta.cefr === 'A2'
        ? `A fundamental word for level ${cefrMeta.cefr}: practice using "${meta.term}" in simple everyday conversations.`
        : cefrMeta.cefr === 'B1' || cefrMeta.cefr === 'B2'
        ? `A natural conversational expression to enrich your speaking flow and vocabulary range.`
        : `An advanced lexical item to elevate your expressive nuance and natural delivery.`;
    }

    if (!example) {
      example = `In everyday conversation: "I practiced using '${meta.term}' with my Native Friend today."`;
    }

    if (!partOfSpeech) {
      partOfSpeech = meta.isPronounce ? 'Pronunciation Focus' : 'Expression';
    }

    const docId = `dict_${key.replace(/[^a-zA-Z0-9_-]/g, '_')}_${sessionDate.replace(/-/g, '')}`;

    dictionaryEntries.push({
      id: docId,
      word: meta.term,
      originalWord: meta.term,
      normalizedWord: key,
      definitionEn: definition,
      partOfSpeech,
      exampleSentenceEn: formatSentence(example),
      phonetic: phonetic || undefined,
      cefrLevel: cefrMeta.cefr,
      sourceActivityName: `Native Friends Notes (${topic})`,
      source: 'live_lesson',
      learnedAt: sessionDate ? `${sessionDate}T12:00:00.000Z` : new Date().toISOString(),
      customNotes: `Introduced by ${teacherName} in live session`,
      notFound: false,
      origins: [
        {
          source: 'native_notes',
          activityName: `Native Friends Notes (${topic})`,
          date: sessionDate,
          lessonId,
          context: `Introduced by ${teacherName} in live session: "${topic}"`,
          teacherName,
        },
      ],
      lessonRefId: lessonId,
    });
  }

  // 4. Save cumulatively and permanently to Cloud Firestore isolated by student UID (if not skipped)
  // Strictly executed via authenticated backend API with verified Firebase Bearer (Rule 3 & Rule 4).
  if (!params.skipClientWrite) {
    try {
      await persistStudentVocabularyViaBackendApi({
        studentUid: cleanUid,
        studentEmail: cleanEmail,
        lessonId,
        entries: dictionaryEntries,
        isAutomaticSync: true,
        syncType: 'native_notes',
      });
    } catch (err: any) {
      console.error('syncSessionVocabularyToStudentDictionary backend save error:', err);
      throw new Error(`Falha na persistência canônica do vocabulário: ${err?.message || err}`);
    }
  }

  return dictionaryEntries;
}
