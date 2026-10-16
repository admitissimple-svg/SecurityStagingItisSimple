import { StudentDictionaryEntry, EnglishLevel } from '../types';
import {
  extractNotesMarkings,
  resolveCefrLevel,
  PedagogicalVocabularyItem,
} from './pedagogicalTransformer';
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
  isDefinitiveAi?: boolean;
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

  const isDefinitiveAi = params.isDefinitiveAi !== undefined
    ? Boolean(params.isDefinitiveAi)
    : (vocabularyAndExpressions.length > 0 && !vocabularyAndExpressions.some((v: any) => v.isProvisional || v.isFallback));

  const rawUid = (studentUid || '').trim();
  const cleanEmail = (studentEmail || '').toLowerCase().trim();
  // Filter out synthetic IDs (usr-*, st-*) and emails as UID
  const isSynthetic = !rawUid || rawUid.includes('@') || rawUid.startsWith('usr-') || rawUid.startsWith('st-');
  const cleanUid = !isSynthetic ? rawUid : '';

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
    cefrLevel?: string;
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
        // HOTFIX 4B.8.1: definitionEn must be exclusively in English
        definitionEn: (v as any).definitionEn || (isDefinitiveAi ? v.simpleDefinition : '') || existing?.definitionEn,
        exampleSentenceEn: Array.isArray(v.realExamples) && v.realExamples.length > 0 ? v.realExamples[0] : (v as any).exampleSentenceEn || existing?.exampleSentenceEn,
        phonetic: v.phoneticGuide || existing?.phonetic,
        cefrLevel: v.cefrLevel || existing?.cefrLevel,
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
    const isEnriched = Boolean(isDefinitiveAi && meta.definitionEn && meta.definitionEn.trim());
    const definition = meta.definitionEn || '';
    const example = meta.exampleSentenceEn || '';
    const partOfSpeech = meta.partOfSpeech || (meta.isPronounce ? 'Pronunciation Focus' : 'Expression');
    const phonetic = meta.phonetic || undefined;

    const docId = `dict_${key.replace(/[^a-zA-Z0-9_-]/g, '_')}_${sessionDate.replace(/-/g, '')}`;

    dictionaryEntries.push({
      id: docId,
      word: meta.term,
      originalWord: meta.term,
      normalizedWord: key,
      definitionEn: definition,
      partOfSpeech,
      exampleSentenceEn: formatSentence(example),
      phonetic,
      cefrLevel: meta.cefrLevel || cefrMeta.cefr,
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
      enrichmentStatus: isEnriched ? 'enriched' : 'pending',
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
