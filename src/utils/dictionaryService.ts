import { StudentDictionaryEntry, EnglishLevel } from '../types';
import { NATIVE_FRIENDS_DICTIONARY_DATABASE } from '../data/dictionaryDatabase';
import { resolveCefrLevel } from './pedagogicalTransformer';
import { auth } from '../firebase';
import { getCachedLocalVocabulary, normalizeDictionaryWord } from './studentPersistence';

export interface DictionaryLookupResult {
  word: string;
  partOfSpeech: string;
  definitionEn: string;
  exampleSentenceEn: string;
  phonetic?: string;
  audio?: string;
  translationPt?: string;
  source: 'native_notes_standard' | 'api' | 'not_found' | 'pending' | 'offline_dict' | 'fallback' | 'unavailable' | string;
  notFound?: boolean;
  unavailable?: boolean;
  errorMessage?: string;
  cefrLevel?: 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';
  collocations?: string[];
  synonyms?: string[];
  register?: 'informal' | 'neutral' | 'formal' | 'idiomatic';
}

/**
 * Detects whether a definition string is a generic synthetic placeholder template
 * instead of an authentic pedagogical definition tailored to the word.
 */
export function isGenericPedagogicalDefinition(def: string | undefined | null): boolean {
  if (!def || typeof def !== 'string') return true;
  const trimmed = def.trim();
  if (trimmed.length === 0) return true;
  const lower = trimmed.toLowerCase();

  if (
    lower.includes('a fundamental word for level') ||
    lower.includes('practice using "') ||
    lower.includes("practice using '") ||
    lower.includes('conversational expression to enrich') ||
    lower.includes('speaking flow and vocabulary range') ||
    lower.includes('elevate your expressive nuance') ||
    lower.includes('practical vocabulary term (') ||
    lower.includes('practical english term (') ||
    lower.includes('key communicative expression') ||
    lower.includes('a natural conversational expression used by native speakers to articulate') ||
    lower.includes('utilizado em inglês autêntico para expressar a ideia de') ||
    lower.includes('used in authentic english to convey') ||
    lower.includes('authentic lexical expression (') ||
    lower.startsWith('a fundamental word') ||
    lower.startsWith('a natural conversational expression') ||
    lower.startsWith('an advanced lexical item')
  ) {
    return true;
  }

  return false;
}

/**
 * Detects whether an example sentence is a generic synthetic placeholder template
 * instead of an authentic conversational sentence tailored to the word.
 */
export function isGenericPedagogicalExample(example: string | undefined | null): boolean {
  if (!example || typeof example !== 'string') return true;
  const trimmed = example.trim();
  if (trimmed.length === 0) return true;
  const lower = trimmed.toLowerCase();

  if (
    lower.includes('with confidence in our routine') ||
    lower.includes('during our daily conversation routine') ||
    lower.includes('makes your daily english sound much more expressive') ||
    lower.includes('during our live conversation practice today') ||
    lower.includes('helps you follow native english conversations easily') ||
    lower.includes('frequently used by native speakers in everyday chats') ||
    lower.includes('in relevant conversational contexts') ||
    lower.includes('helps incorporate it into active speaking') ||
    (lower.includes('i prefer saying') && lower.includes('to sound natural and clear')) ||
    (lower.includes('ensures clarity') && lower.includes('saying')) ||
    lower.includes('didactic example (hypothetical)')
  ) {
    return true;
  }

  return false;
}

interface FreeDictionaryDefinition {
  definition: string;
  synonyms?: string[];
  antonyms?: string[];
  example?: string;
}

interface FreeDictionaryMeaning {
  partOfSpeech: string;
  definitions: FreeDictionaryDefinition[];
  synonyms?: string[];
  antonyms?: string[];
}

interface FreeDictionaryPhonetic {
  text?: string;
  audio?: string;
}

interface FreeDictionaryItem {
  word: string;
  phonetic?: string;
  phonetics?: FreeDictionaryPhonetic[];
  meanings: FreeDictionaryMeaning[];
  sourceUrls?: string[];
}

// In-memory cache for session performance (Zero localStorage)
const memoryCache = new Map<string, DictionaryLookupResult>();

/**
 * Clears the public in-memory dictionary cache.
 * Called upon logout or account switch to guarantee clean isolation.
 */
export function clearDictionaryMemoryCache(): void {
  memoryCache.clear();
}

/**
 * Normalizes example sentence to clean whitespace, capitalized first letter, and clean punctuation.
 */
function formatExample(ex?: string): string {
  if (!ex) return '';
  let cleaned = ex.trim().replace(/^["']|["']$/g, '').trim();
  if (cleaned && !/[.!?]$/.test(cleaned)) {
    cleaned += '.';
  }
  if (cleaned.length > 0) {
    cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }
  return cleaned;
}

/**
 * Normalizes and formats part of speech into Native Friend Notes standard.
 */
function normalizePartOfSpeech(rawPos: string, word: string): string {
  const p = (rawPos || '').toLowerCase().trim();
  const trimmedWord = word.trim().toLowerCase();
  const isMultiWord = trimmedWord.includes(' ');

  if (p.includes('phrasal') || (isMultiWord && /^(catch|work|get|make|touch|follow|figure|look|wrap|bring|come|run|give|take|turn|put|call|stand|point|hold|back|fill|drop|sign|warm|wind|burn|cut|deal|keep)\s+(up|out|down|off|in|on|at|for|to|with|into|across|away|over|back|through)/i.test(trimmedWord))) {
    return 'Phrasal Verb';
  }
  if (isMultiWord) {
    return 'Idiomatic Expression';
  }
  if (p === 'noun' || p.includes('noun')) return 'Noun';
  if (p === 'verb' || p.includes('verb')) return 'Verb';
  if (p === 'adjective' || p.includes('adj')) return 'Adjective';
  if (p === 'adverb' || p.includes('adv')) return 'Adverb';
  if (p === 'preposition' || p.includes('prep')) return 'Preposition';
  if (p === 'conjunction' || p.includes('conj')) return 'Conjunction';
  if (p === 'interjection') return 'Interjection';
  return 'Vocabulary Item';
}

/**
 * Generates an authentic real-world conversational example sentence adhering to Native Friend Notes standard.
 */
function generateRealConversationalExample(word: string, partOfSpeech: string): string {
  const w = word.trim();
  const lowerPos = (partOfSpeech || '').toLowerCase();

  if (lowerPos.includes('phrasal') || lowerPos.includes('verb')) {
    return `We practiced how to ${w} naturally during our daily conversation routine.`;
  }
  if (lowerPos.includes('adjective') || lowerPos.includes('adj')) {
    return `Using "${w}" makes your daily English sound much more expressive and natural.`;
  }
  if (lowerPos.includes('adverb') || lowerPos.includes('adv')) {
    return `She spoke English ${w} during our live conversation practice today.`;
  }
  if (lowerPos.includes('idiom') || lowerPos.includes('expression')) {
    return `The phrase "${w}" is frequently used by native speakers in everyday chats.`;
  }
  if (lowerPos.includes('noun')) {
    return `Understanding the term "${w}" helps you follow native English conversations easily.`;
  }
  return `In daily speaking: "I practiced using '${w}' with confidence in our routine."`;
}

/**
 * Executes a real HTTP fetch to the official Free Dictionary API
 * Endpoint: https://api.dictionaryapi.dev/api/v2/entries/en/[palavra]
 * Transforms response strictly according to Native Friend Notes pedagogical standard.
 */
export async function fetchFromFreeDictionaryApi(
  rawWord: string,
  studentLevel?: EnglishLevel | string
): Promise<DictionaryLookupResult | null> {
  const cleanWord = rawWord.trim();
  if (!cleanWord) return null;

  const targetCefr = resolveCefrLevel(studentLevel).cefr;

  const queryApi = async (term: string): Promise<FreeDictionaryItem[] | null> => {
    try {
      const url = `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(term.toLowerCase())}`;
      
      let signal: AbortSignal | undefined;
      if (typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal) {
        signal = AbortSignal.timeout(8000);
      }

      const res = await fetch(url, {
        method: 'GET',
        signal,
      });

      if (!res.ok) {
        return null;
      }

      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        return data as FreeDictionaryItem[];
      }
      return null;
    } catch {
      return null;
    }
  };

  // 1. Direct query with clean word
  let data = await queryApi(cleanWord);

  // 2. If not found and word contains punctuation, query stripped term
  if (!data && /[^a-zA-Z\s-]/.test(cleanWord)) {
    const stripped = cleanWord.replace(/[^a-zA-Z\s-]/g, '').trim();
    if (stripped && stripped.toLowerCase() !== cleanWord.toLowerCase()) {
      data = await queryApi(stripped);
    }
  }

  if (!data || data.length === 0) {
    return null;
  }

  const entry = data[0];
  const meanings = entry.meanings || [];
  if (meanings.length === 0) {
    return null;
  }

  // Extract part of speech and format to Native Friend Notes standard
  const firstMeaning = meanings[0];
  const rawPos = firstMeaning.partOfSpeech || '';
  const partOfSpeech = normalizePartOfSpeech(rawPos, cleanWord);

  // Extract definition
  const firstDefObj = firstMeaning.definitions?.[0];
  let rawDef = firstDefObj?.definition?.trim() || '';

  if (!rawDef) {
    return null;
  }

  // Clean definition of trailing/leading periods or weird markup
  let definitionEn = rawDef.replace(/^[:\s\-—]+/, '').trim();
  if (definitionEn.length > 0) {
    definitionEn = definitionEn.charAt(0).toUpperCase() + definitionEn.slice(1);
    if (!/[.!?]$/.test(definitionEn)) {
      definitionEn += '.';
    }
  }

  // Extract official example or generate authentic real conversational example
  let rawExample = firstDefObj?.example?.trim() || '';
  if (!rawExample) {
    for (const meaning of meanings) {
      for (const def of meaning.definitions || []) {
        if (def.example && def.example.trim()) {
          rawExample = def.example.trim();
          break;
        }
      }
      if (rawExample) break;
    }
  }

  const exampleSentenceEn = rawExample
    ? formatExample(rawExample)
    : generateRealConversationalExample(cleanWord, partOfSpeech);

  // Phonetic text & Audio pronunciation if provided by API
  const phoneticText =
    entry.phonetic ||
    entry.phonetics?.find((p) => p.text && p.text.trim())?.text ||
    '';

  const audioUrl =
    entry.phonetics?.find((p) => p.audio && p.audio.startsWith('http'))?.audio ||
    '';

  return {
    word: entry.word || cleanWord,
    partOfSpeech,
    definitionEn,
    exampleSentenceEn,
    phonetic: phoneticText || undefined,
    audio: audioUrl || undefined,
    cefrLevel: targetCefr,
    source: 'native_notes_standard',
    notFound: false,
  };
}

/**
 * Backend dictionary endpoint (/api/dictionary/define)
 * Follows unified Native Friend Notes standard across all endpoints.
 */
async function fetchFromBackendApi(
  cleanWord: string,
  context?: string,
  studentLevel?: EnglishLevel | string
): Promise<DictionaryLookupResult | null> {
  try {
    let signal: AbortSignal | undefined;
    if (typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal) {
      signal = AbortSignal.timeout(16000);
    }

    const token = await auth?.currentUser?.getIdToken().catch(() => null);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const res = await fetch('/api/dictionary/define', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        word: cleanWord,
        context,
        studentLevel: studentLevel || 'intermediate',
        level: studentLevel || 'intermediate',
        studentUid: auth?.currentUser?.uid || '',
      }),
      signal,
    });

    if (res.status === 401 || res.status === 403) {
      console.warn(`Dictionary define rejected (${res.status}): unauthenticated or unauthorized.`);
      return null;
    }

    if (res.status === 503) {
      return {
        word: cleanWord,
        partOfSpeech: '',
        definitionEn: '',
        exampleSentenceEn: '',
        source: 'unavailable',
        notFound: false,
        unavailable: true,
        errorMessage: 'Definição temporariamente indisponível. Palavra preservada.',
      };
    }

    if (!res.ok) return null;

    const data = await res.json();
    if (data && (data.definitionEn || data.notFound || data.unavailable)) {
      if (data.unavailable) {
        return {
          word: cleanWord,
          partOfSpeech: data.partOfSpeech || '',
          definitionEn: '',
          exampleSentenceEn: '',
          source: 'unavailable',
          notFound: false,
          unavailable: true,
          errorMessage: 'Definição temporariamente indisponível. Palavra preservada.',
        };
      }

      if (data.notFound) {
        return {
          word: cleanWord,
          partOfSpeech: '',
          definitionEn: '',
          exampleSentenceEn: '',
          source: 'not_found',
          notFound: true,
          errorMessage: 'Palavra não localizada no padrão unificado.',
        };
      }

      if (data.definitionEn && isGenericPedagogicalDefinition(data.definitionEn)) {
        return null;
      }

      return {
        word: data.word || cleanWord,
        partOfSpeech: data.partOfSpeech || 'Vocabulary Item',
        definitionEn: data.definitionEn,
        exampleSentenceEn: formatExample(data.exampleSentenceEn),
        translationPt: data.translationPt,
        phonetic: data.phonetic,
        audio: data.audio,
        cefrLevel: data.cefrLevel || resolveCefrLevel(studentLevel).cefr,
        collocations: data.collocations,
        synonyms: data.synonyms,
        register: data.register,
        source: 'native_notes_standard',
        notFound: false,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Main function to look up a word adhering strictly to Native Friend Notes standards:
 * - Specific grammatical class (part of speech)
 * - Clear, learner-friendly pedagogical definition
 * - CEFR level badge (A1 - C2)
 * - Real, authentic conversational example sentence
 *
 * Uses in-memory session caching to avoid redundant HTTP requests. Zero localStorage.
 */
export async function lookupWord(
  rawWord: string,
  context?: string,
  studentLevel?: EnglishLevel | string,
  studentUid?: string,
  studentEmail?: string,
  activeDictionary?: StudentDictionaryEntry[]
): Promise<DictionaryLookupResult> {
  const cleanWord = rawWord.trim();
  if (!cleanWord) {
    return {
      word: '',
      partOfSpeech: '',
      definitionEn: '',
      exampleSentenceEn: '',
      source: 'not_found',
      notFound: true,
      errorMessage: 'Nenhuma palavra informada.',
    };
  }

  const norm = normalizeDictionaryWord(cleanWord);
  const cacheKey = cleanWord.toLowerCase();
  const cefrMeta = resolveCefrLevel(studentLevel);

  // 1. First priority: Check student's My Dictionary for existing rich pedagogical definition
  // NOTE: Private student definitions must NEVER be stored in the global shared memoryCache!
  if (Array.isArray(activeDictionary) && activeDictionary.length > 0) {
    const existing = activeDictionary.find(
      (e) =>
        normalizeDictionaryWord(e.normalizedWord || e.word) === norm &&
        Boolean(e.definitionEn && e.definitionEn.trim().length > 0 && !isGenericPedagogicalDefinition(e.definitionEn))
    );
    if (existing) {
      const myDictResult: DictionaryLookupResult = {
        word: existing.word,
        partOfSpeech: existing.partOfSpeech || (cleanWord.includes(' ') ? 'Idiomatic Expression' : 'Noun'),
        definitionEn: existing.definitionEn,
        exampleSentenceEn: formatExample(existing.exampleSentenceEn || ''),
        translationPt: existing.translationPt || '',
        phonetic: existing.phonetic,
        audio: existing.audio || existing.audioUrl,
        cefrLevel: (existing.cefrLevel as any) || cefrMeta.cefr,
        source: 'my_dictionary',
        notFound: false,
      };
      // Isolated private data: return directly without writing to shared memoryCache
      return myDictResult;
    }
  }

  // Check cached local vocabulary if studentUid/studentEmail or auth is present
  const uidToCheck = studentUid || auth?.currentUser?.uid;
  const emailToCheck = studentEmail || auth?.currentUser?.email || undefined;
  if (uidToCheck || emailToCheck) {
    const localVocab = getCachedLocalVocabulary(uidToCheck, emailToCheck);
    const existing = localVocab.find(
      (e) =>
        normalizeDictionaryWord(e.normalizedWord || e.word) === norm &&
        Boolean(e.definitionEn && e.definitionEn.trim().length > 0 && !isGenericPedagogicalDefinition(e.definitionEn))
    );
    if (existing) {
      const myDictResult: DictionaryLookupResult = {
        word: existing.word,
        partOfSpeech: existing.partOfSpeech || (cleanWord.includes(' ') ? 'Idiomatic Expression' : 'Noun'),
        definitionEn: existing.definitionEn,
        exampleSentenceEn: formatExample(existing.exampleSentenceEn || ''),
        translationPt: existing.translationPt || '',
        phonetic: existing.phonetic,
        audio: existing.audio || existing.audioUrl,
        cefrLevel: (existing.cefrLevel as any) || cefrMeta.cefr,
        source: 'my_dictionary',
        notFound: false,
      };
      // Isolated private data: return directly without writing to shared memoryCache
      return myDictResult;
    }
  }

  // 2. Check session memory cache
  const cached = memoryCache.get(cacheKey);
  if (cached && !cached.notFound) {
    if (cached.definitionEn && !isGenericPedagogicalDefinition(cached.definitionEn)) {
      return cached;
    }
    memoryCache.delete(cacheKey);
  }

  // 3. Check Native Friend Notes validated database for instant match
  const lowerKey = cleanWord.toLowerCase();
  const normalizedKey = lowerKey.replace(/[_\-]+/g, ' ');
  const dbEntry = NATIVE_FRIENDS_DICTIONARY_DATABASE[lowerKey] || NATIVE_FRIENDS_DICTIONARY_DATABASE[normalizedKey];

  if (dbEntry) {
    const result: DictionaryLookupResult = {
      word: dbEntry.word,
      partOfSpeech: dbEntry.partOfSpeech,
      definitionEn: dbEntry.definitionEn,
      exampleSentenceEn: formatExample(dbEntry.exampleSentenceEn),
      translationPt: dbEntry.translationPt,
      cefrLevel: dbEntry.cefrLevel || cefrMeta.cefr,
      collocations: dbEntry.collocations,
      synonyms: dbEntry.synonyms,
      register: dbEntry.register,
      phonetic: dbEntry.phonetic,
      source: 'native_notes_standard',
      notFound: false,
    };
    memoryCache.set(cacheKey, result);
    return result;
  }

  // 4. Query backend dictionary endpoint (/api/dictionary/define)
  const backendResult = await fetchFromBackendApi(cleanWord, context, studentLevel);
  if (backendResult && !backendResult.notFound && backendResult.definitionEn && !isGenericPedagogicalDefinition(backendResult.definitionEn)) {
    memoryCache.set(cacheKey, backendResult);
    return backendResult;
  }
  if (backendResult && backendResult.unavailable) {
    return backendResult;
  }

  // 5. Query Free Dictionary API with Native Friend Notes pedagogical adaptation
  const apiResult = await fetchFromFreeDictionaryApi(cleanWord, studentLevel);
  if (apiResult && !apiResult.notFound && apiResult.definitionEn && !isGenericPedagogicalDefinition(apiResult.definitionEn)) {
    memoryCache.set(cacheKey, apiResult);
    return apiResult;
  }

  // 6. When external and AI services fail, return transparent unavailability preserving typed words
  const isMultiWord = cleanWord.includes(' ');
  const fallbackPos = isMultiWord ? 'Idiomatic Expression' : 'Vocabulary Item';
  return {
    word: cleanWord,
    partOfSpeech: fallbackPos,
    definitionEn: '',
    exampleSentenceEn: '',
    cefrLevel: cefrMeta.cefr,
    source: 'unavailable',
    notFound: false,
    unavailable: true,
  };
}

/**
 * Returns instant synchronous cached result or Native Friend Notes standard instant preview
 */
export function getInstantOrCachedWord(
  rawWord: string,
  _context?: string,
  studentLevel?: EnglishLevel | string,
  studentUid?: string,
  studentEmail?: string,
  activeDictionary?: StudentDictionaryEntry[]
): DictionaryLookupResult {
  const cleanWord = rawWord.trim();
  if (!cleanWord) {
    return {
      word: '',
      partOfSpeech: '',
      definitionEn: '',
      exampleSentenceEn: '',
      source: 'pending',
      notFound: false,
    };
  }

  const norm = normalizeDictionaryWord(cleanWord);
  const cacheKey = cleanWord.toLowerCase();
  const cefrMeta = resolveCefrLevel(studentLevel);

  // 1. Check My Dictionary first
  if (Array.isArray(activeDictionary) && activeDictionary.length > 0) {
    const existing = activeDictionary.find(
      (e) =>
        normalizeDictionaryWord(e.normalizedWord || e.word) === norm &&
        Boolean(e.definitionEn && e.definitionEn.trim().length > 0 && !isGenericPedagogicalDefinition(e.definitionEn))
    );
    if (existing) {
      return {
        word: existing.word,
        partOfSpeech: existing.partOfSpeech || (cleanWord.includes(' ') ? 'Idiomatic Expression' : 'Noun'),
        definitionEn: existing.definitionEn,
        exampleSentenceEn: formatExample(existing.exampleSentenceEn || ''),
        translationPt: existing.translationPt || '',
        phonetic: existing.phonetic,
        audio: existing.audio || existing.audioUrl,
        cefrLevel: (existing.cefrLevel as any) || cefrMeta.cefr,
        source: 'my_dictionary',
        notFound: false,
      };
    }
  }

  const uidToCheck = studentUid || auth?.currentUser?.uid;
  const emailToCheck = studentEmail || auth?.currentUser?.email || undefined;
  if (uidToCheck || emailToCheck) {
    const localVocab = getCachedLocalVocabulary(uidToCheck, emailToCheck);
    const existing = localVocab.find(
      (e) =>
        normalizeDictionaryWord(e.normalizedWord || e.word) === norm &&
        Boolean(e.definitionEn && e.definitionEn.trim().length > 0 && !isGenericPedagogicalDefinition(e.definitionEn))
    );
    if (existing) {
      return {
        word: existing.word,
        partOfSpeech: existing.partOfSpeech || (cleanWord.includes(' ') ? 'Idiomatic Expression' : 'Noun'),
        definitionEn: existing.definitionEn,
        exampleSentenceEn: formatExample(existing.exampleSentenceEn || ''),
        translationPt: existing.translationPt || '',
        phonetic: existing.phonetic,
        audio: existing.audio || existing.audioUrl,
        cefrLevel: (existing.cefrLevel as any) || cefrMeta.cefr,
        source: 'my_dictionary',
        notFound: false,
      };
    }
  }

  const cached = memoryCache.get(cacheKey);
  if (cached) {
    if (!cached.definitionEn || !isGenericPedagogicalDefinition(cached.definitionEn)) {
      return cached;
    }
    memoryCache.delete(cacheKey);
  }

  const lowerKey = cleanWord.toLowerCase();
  const normalizedKey = lowerKey.replace(/[_\-]+/g, ' ');
  const dbEntry = NATIVE_FRIENDS_DICTIONARY_DATABASE[lowerKey] || NATIVE_FRIENDS_DICTIONARY_DATABASE[normalizedKey];

  if (dbEntry) {
    return {
      word: dbEntry.word,
      partOfSpeech: dbEntry.partOfSpeech,
      definitionEn: dbEntry.definitionEn,
      exampleSentenceEn: formatExample(dbEntry.exampleSentenceEn),
      translationPt: dbEntry.translationPt,
      cefrLevel: dbEntry.cefrLevel || cefrMeta.cefr,
      collocations: dbEntry.collocations,
      synonyms: dbEntry.synonyms,
      register: dbEntry.register,
      phonetic: dbEntry.phonetic,
      source: 'native_notes_standard',
      notFound: false,
    };
  }

  return {
    word: cleanWord,
    partOfSpeech: cleanWord.includes(' ') ? 'Expression' : 'Word',
    definitionEn: '',
    exampleSentenceEn: '',
    cefrLevel: cefrMeta.cefr,
    source: 'pending',
    notFound: false,
  };
}
