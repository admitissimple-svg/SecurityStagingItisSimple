import {
  doc,
  setDoc,
  getDoc,
  getDocs,
  collection,
  query,
  where,
  deleteDoc,
  onSnapshot,
  runTransaction,
} from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { getDb, auth } from '../firebase';
import {
  StudentDictionaryEntry,
  DailyJournalEntry,
  LiveLesson,
  StudentJournalEntry,
  StudentJournalActivityType,
  DayOfWeek,
  WeeklyHomeworkData,
  DailyHomeworkActivity,
  UserProfile,
  NativeFriendTutor,
} from '../types';

export type { StudentJournalEntry };
import { handleFirestoreError, OperationType, withFirestoreTimeout } from './routineSync';
import { DAYS_OF_WEEK, getTodayDayOfWeek } from './notifications';
import { getAccessToken, waitForAuthUser, isAuthorizedAdminUser } from './auth';
import { normalizeDictionaryWord, consolidateDictionaryEntries } from './studentDictionaryLibrary';
import {
  assertSafeFirestoreWrite,
  validateFirestoreDocument,
  stampSchemaVersion,
  CURRENT_SCHEMA_VERSION,
  migrateLegacyLocalStorageToFirestore,
} from './firestoreSchemaValidator';
import { isSyntheticHomeworkEvaluation, isValidHomeworkEvaluation } from './writingChecker';
import {
  getIsoDateInTimeZone,
  getDateForDayInCurrentWeek as getDateForDayInCurrentWeekTz,
  DEFAULT_STUDENT_TIMEZONE,
} from './timezone';
import {
  synthesizeFillInBlanks,
  synthesizeCohesiveStoryAndQuestions,
} from './pedagogicalStorySynthesizer';
import {
  isActivityStartedOrAnswered,
  deriveContextualSentencePrompt,
  resolveDailyMemorizationVocabulary,
} from './homeworkGenerator';

export { getIsoDateInTimeZone, DEFAULT_STUDENT_TIMEZONE };

// Pure in-memory session caches to provide instant zero-delay UI rendering during active session
// ZERO dependency on localStorage: 100% of persistent data is stored in Cloud Firestore
const inMemoryVocabularyCache = new Map<string, StudentDictionaryEntry[]>();
const inMemoryWeeklyChecksCache = new Map<string, Record<string, boolean>>();
const inMemoryExcludedVocabularyWords = new Map<string, Set<string>>();

/**
 * Strict validator for positive integer week cycles.
 * Accepts only positive safe integers or string representations thereof (e.g. 1, "1", "week-1").
 * Rejects malformed strings, fractional values, zero, negative values, nonnumeric suffixes,
 * NaN, Infinity, and unsafe integers.
 */
function extractPositiveIntegerCycle(week?: string | number | null): number | null {
  if (week === undefined || week === null) return null;

  if (typeof week === 'number') {
    if (!Number.isFinite(week) || !Number.isSafeInteger(week) || week <= 0) {
      return null;
    }
    return week;
  }

  if (typeof week !== 'string') return null;

  const clean = week.trim().toLowerCase();
  if (!clean) return null;

  let numStr = clean;
  if (clean.startsWith('week-')) {
    numStr = clean.slice(5);
  }

  // Must consist solely of one or more ASCII digits, no signs, decimals, or trailing characters
  if (!/^[0-9]+$/.test(numStr)) {
    return null;
  }

  const parsed = Number(numStr);
  if (!Number.isFinite(parsed) || !Number.isSafeInteger(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}

/**
 * Normalizes a week cycle or week identifier to canonical 'week-${cycle}' format.
 * Returns null if week identity is missing or invalid.
 * CRITICAL: Never silently defaults to 'week-1' and never returns malformed strings.
 */
export function normalizeWeekId(week?: string | number | null): string | null {
  const cycle = extractPositiveIntegerCycle(week);
  return cycle !== null ? `week-${cycle}` : null;
}

/**
 * Executes a Promise with a strict timeout that rejects if the operation exceeds the deadline.
 * Unlike withFirestoreTimeout, this does not swallow rejections or convert failures to null.
 */
export async function withStrictTimeout<T>(
  promise: Promise<T>,
  ms = 4000,
  timeoutMessage = 'Firestore operation timed out'
): Promise<T> {
  let timer: any;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(timeoutMessage)), ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/**
 * Extracts numeric cycle from week identifier (e.g. 'week-2' -> 2, 3 -> 3).
 * Returns null if cycle cannot be determined.
 * CRITICAL: Never silently defaults to 1 and never returns malformed week numbers.
 */
export function parseWeekCycleNumber(week?: string | number | null): number | null {
  return extractPositiveIntegerCycle(week);
}

export function buildWeeklyChecksCacheKey(identifier: string, weekId: string): string {
  return `${identifier.trim()}::${weekId}`;
}

import { isValidCanonicalUid } from './tutorConsolidation';
export { migrateLegacyLocalStorageToFirestore, normalizeDictionaryWord, consolidateDictionaryEntries, isValidCanonicalUid };

export function normalizeUid(rawId?: string | null, email?: string | null): string {
  const cleanRawId = (rawId || '').trim();
  const rawIsEmail = cleanRawId.includes('@');
  const cleanEmail = (email || '').toLowerCase().trim();
  const currentAuthUid = auth?.currentUser?.uid || '';
  const currentAuthEmail = (auth?.currentUser?.email || '').toLowerCase().trim();

  // 1. If an explicit valid canonical UID was provided, prioritize and return it directly.
  // CRITICAL: An explicit valid UID must NEVER be overwritten by auth.currentUser.uid!
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

  // 2. Only prioritize Firebase Auth UID (auth.currentUser.uid) if:
  // - No email was provided (assumed self-context), OR
  // - The provided email explicitly matches the current authenticated user's email.
  // This CRITICALLY prevents a logged-in Student's auth.currentUser.uid from being resolved as a Native Friend's UID!
  if (currentAuthUid) {
    if (!cleanEmail || (currentAuthEmail && cleanEmail === currentAuthEmail)) {
      return currentAuthUid;
    }
  }

  // Never fall back to email as document ID in Firestore
  return cleanRawId && !rawIsEmail ? cleanRawId : '';
}

export function getUserDocIds(rawId?: string | null, email?: string | null): string[] {
  const cleanEmail = (email || '').toLowerCase().trim();
  const cleanUid = normalizeUid(rawId, cleanEmail);
  return cleanUid && isValidCanonicalUid(cleanUid) ? [cleanUid] : [];
}

/**
 * Retrieve potential legacy document IDs strictly for read-only fallback lookup.
 * PROHIBITED: Never use this array for write operations.
 */
export function getLegacyReadDocIds(rawId?: string | null, email?: string | null): string[] {
  const cleanEmail = (email || '').toLowerCase().trim();
  const cleanUid = normalizeUid(rawId, cleanEmail);
  const rawClean = (rawId || '').trim();
  const emailUnderscore = cleanEmail ? cleanEmail.replace(/[^a-zA-Z0-9_-]/g, '_') : '';
  const emailHyphen = cleanEmail ? cleanEmail.replace(/[^a-zA-Z0-9]/g, '-') : '';
  const emailUsr = cleanEmail ? `usr-${emailHyphen}` : '';

  return Array.from(
    new Set([cleanUid, rawClean, emailUnderscore, emailHyphen, emailUsr, cleanEmail].filter(Boolean))
  );
}

/**
 * Retrieve cached vocabulary from in-memory session cache for immediate, non-empty rendering.
 * ZERO localStorage dependency: 100% backed permanently by Cloud Firestore.
 */
export function getCachedLocalVocabulary(studentUid?: string | null, studentEmail?: string | null): StudentDictionaryEntry[] {
  const cleanUid = studentUid?.trim();
  const cleanEmail = studentEmail?.toLowerCase().trim();
  if (cleanUid && inMemoryVocabularyCache.has(cleanUid)) {
    return inMemoryVocabularyCache.get(cleanUid) || [];
  }
  if (cleanEmail && inMemoryVocabularyCache.has(cleanEmail)) {
    return inMemoryVocabularyCache.get(cleanEmail) || [];
  }
  return [];
}

/**
 * Retrieve cached weekly checks from in-memory session cache for instant, non-flickering checkmarks.
 * Scoped strictly to the requested week (e.g. 'week-1', 'week-2').
 * ZERO localStorage dependency: 100% backed permanently by Cloud Firestore.
 */
export function getCachedWeeklyChecks(
  studentUid?: string | null,
  studentEmail?: string | null,
  week?: string | number | null
): Record<string, boolean> {
  const canonicalWeekId = normalizeWeekId(week);
  if (!canonicalWeekId) {
    // Week identity is unknown: do not silently default to Week 1
    return {};
  }
  const cleanUid = studentUid?.trim();
  const cleanEmail = studentEmail?.toLowerCase().trim();
  if (cleanUid) {
    const key = buildWeeklyChecksCacheKey(cleanUid, canonicalWeekId);
    if (inMemoryWeeklyChecksCache.has(key)) {
      return inMemoryWeeklyChecksCache.get(key) || {};
    }
  }
  if (cleanEmail) {
    const key = buildWeeklyChecksCacheKey(cleanEmail, canonicalWeekId);
    if (inMemoryWeeklyChecksCache.has(key)) {
      return inMemoryWeeklyChecksCache.get(key) || {};
    }
  }
  return {};
}

/**
 * Cache weekly checks in in-memory session cache for instant active session reflection.
 * Scoped strictly to the requested week (e.g. 'week-1', 'week-2').
 * Never touches browser localStorage; Firestore users/{studentUID}/weeklyChecks/{weekId} is the exclusive master.
 */
export function cacheWeeklyChecksLocally(
  studentUid?: string | null,
  studentEmail?: string | null,
  checks?: Record<string, boolean>,
  week?: string | number | null
) {
  if (!checks) return;
  const canonicalWeekId = normalizeWeekId(week);
  if (!canonicalWeekId) {
    // Week identity is unknown: refuse to silently cache under Week 1
    return;
  }
  const cleanUid = studentUid?.trim();
  const cleanEmail = studentEmail?.toLowerCase().trim();
  if (cleanUid) {
    inMemoryWeeklyChecksCache.set(buildWeeklyChecksCacheKey(cleanUid, canonicalWeekId), checks);
  }
  if (cleanEmail) {
    inMemoryWeeklyChecksCache.set(buildWeeklyChecksCacheKey(cleanEmail, canonicalWeekId), checks);
  }
}

/**
 * Cache vocabulary in in-memory session cache for instant retrieval across component switches.
 * Never touches browser localStorage; Firestore users/{studentUID}/vocabulary is the exclusive master.
 */
export function cacheVocabularyLocally(
  studentUid?: string | null,
  studentEmail?: string | null,
  entries?: StudentDictionaryEntry[]
) {
  if (!Array.isArray(entries)) return;
  const cleanUid = studentUid?.trim();
  const cleanEmail = studentEmail?.toLowerCase().trim();
  if (cleanUid) inMemoryVocabularyCache.set(cleanUid, entries);
  if (cleanEmail) inMemoryVocabularyCache.set(cleanEmail, entries);
}

/**
 * Clears all local in-memory session persistence caches upon student logout or account switch.
 * Ensures zero leakage of private student data across account switches.
 */
export function clearAllLocalPersistenceCaches(): void {
  inMemoryVocabularyCache.clear();
  inMemoryWeeklyChecksCache.clear();
  inMemoryExcludedVocabularyWords.clear();
}

/**
 * Persist student vocabulary entries directly and permanently to Cloud Firestore.
 * CUMULATIVE: Loads existing words first and merges, ensuring words accumulate permanently over time
 * and are never overwritten or cleared.
 * Stores in both users/{studentUID} (consolidated vocabulary array) and subcollection users/{studentUID}/vocabulary/{wordId}.
 */
export async function saveStudentVocabularyToFirestore(
  studentUid: string,
  entries: StudentDictionaryEntry[],
  studentEmail?: string,
  lessonId?: string
): Promise<boolean> {
  const db = getDb();
  if (!db) return false;
  if (!entries || entries.length === 0) return true;

  const cleanEmail = (studentEmail || '').toLowerCase().trim();
  const cleanUid = normalizeUid(studentUid, cleanEmail);
  if (!cleanUid) return false;

  try {
    const sanitizedEntries: StudentDictionaryEntry[] = JSON.parse(JSON.stringify(entries || []));
    const masterMap = new Map<string, StudentDictionaryEntry>();

    // 1. Seed masterMap with local cache first to ensure zero data loss during network latency
    const cached = getCachedLocalVocabulary(cleanUid, cleanEmail);
    cached.forEach((item) => {
      if (item?.word) {
        const key = item.word.toLowerCase().trim();
        masterMap.set(key, item);
      }
    });

    // 2. Load existing words from Firestore users/{cleanUid} & subcollection (authoritative)
    try {
      const userRef = doc(db, 'users', cleanUid);
      const userSnap = await withFirestoreTimeout(getDoc(userRef), 4000, null);
      if (userSnap && userSnap.exists()) {
        const data = userSnap.data();
        if (Array.isArray(data?.vocabulary)) {
          data.vocabulary.forEach((item: StudentDictionaryEntry) => {
            if (item?.word) {
              const key = item.word.toLowerCase().trim();
              masterMap.set(key, { ...(masterMap.get(key) || {}), ...item });
            }
          });
        }
      }
    } catch {}

    try {
      const subColRef = collection(db, 'users', cleanUid, 'vocabulary');
      const subSnap = await withFirestoreTimeout(getDocs(subColRef), 4000, null);
      if (subSnap && !subSnap.empty) {
        subSnap.forEach((docItem) => {
          const item = docItem.data() as StudentDictionaryEntry;
          if (item && item.word) {
            const key = item.word.toLowerCase().trim();
            masterMap.set(key, { ...(masterMap.get(key) || {}), ...item });
          }
        });
      }
    } catch {}

    // 3. Check legacy doc IDs if masterMap is still small or for accounts migrated from email (READ ONLY)
    const allDocIds = getLegacyReadDocIds(cleanUid, cleanEmail);
    for (const altId of allDocIds) {
      if (altId === cleanUid) continue;
      try {
        const altRef = doc(db, 'users', altId);
        const altSnap = await withFirestoreTimeout(getDoc(altRef), 2000, null);
        if (altSnap && altSnap.exists()) {
          const altData = altSnap.data();
          if (Array.isArray(altData?.vocabulary)) {
            altData.vocabulary.forEach((item: StudentDictionaryEntry) => {
              if (item?.word) {
                const key = item.word.toLowerCase().trim();
                if (!masterMap.has(key)) {
                  masterMap.set(key, item);
                }
              }
            });
          }
        }
      } catch {}
    }

    // 4. Merge new entries into masterMap using pedagogical consolidation engine
    // Guarantees: multi-origin preservation, richer definition protection, non-zeroing practice count
    const accumulatedList = consolidateDictionaryEntries(
      Array.from(masterMap.values()),
      sanitizedEntries
    );

    // Cache accumulated list locally immediately
    cacheVocabularyLocally(cleanUid, cleanEmail, accumulatedList);

    // Write strictly to Cloud Firestore users/{cleanUid} with accumulatedList and schema validation
    const userPayload = stampSchemaVersion({
      vocabulary: accumulatedList,
      updatedAt: new Date().toISOString(),
    });
    assertSafeFirestoreWrite(`users/${cleanUid}`, userPayload, undefined, true);

    const userRef = doc(db, 'users', cleanUid);
    const writePromises: Promise<any>[] = [
      setDoc(userRef, userPayload, { merge: true }),
    ];

    // Write individual entries to subcollection users/{cleanUid}/vocabulary/{wordDocId}
    accumulatedList.forEach((fullItem) => {
      if (!fullItem || !fullItem.word || !fullItem.word.trim()) return;
      const key = normalizeDictionaryWord(fullItem.normalizedWord || fullItem.word);
      if (!key) return;
      const wordDocId = key.replace(/[^a-zA-Z0-9_-]/g, '_');
      const itemRef = doc(db, 'users', cleanUid, 'vocabulary', wordDocId);
      const wordPayload = stampSchemaVersion({
        ...fullItem,
        studentUid: cleanUid,
        studentEmail: cleanEmail,
        updatedAt: new Date().toISOString(),
      });
      assertSafeFirestoreWrite(`users/${cleanUid}/vocabulary/${wordDocId}`, wordPayload, undefined, true);
      writePromises.push(
        setDoc(itemRef, wordPayload, { merge: true })
      );
    });

    await withFirestoreTimeout(Promise.all(writePromises), 6000, null);

    // Authoritative backend persistence with verified authorization & Firebase Admin SDK
    if (cleanEmail || cleanUid) {
      let token: string | null = null;
      try {
        token = await getAccessToken();
      } catch {}

      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      try {
        const res = await fetch('/api/student-dictionary', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            studentEmail: cleanEmail,
            studentUid: cleanUid,
            lessonId,
            entries: accumulatedList,
          }),
        });

        if (!res.ok) {
          const errJson = await res.json().catch(() => ({}));
          throw new Error(errJson.message || errJson.error || `HTTP ${res.status}: Failed to persist dictionary.`);
        }

        const resData = await res.json().catch(() => ({}));
        if (resData?.excludedWords && Array.isArray(resData.excludedWords)) {
          cacheExcludedWordsLocally(resData.studentUid || cleanUid, resData.studentEmail || cleanEmail, resData.excludedWords);
        }
        if (resData?.dictionary && Array.isArray(resData.dictionary)) {
          cacheVocabularyLocally(resData.studentUid || cleanUid, resData.studentEmail || cleanEmail, resData.dictionary);
          return true;
        }
      } catch (fetchErr: any) {
        // In Node/test/SSR environment where relative URL cannot be resolved:
        if (typeof window === 'undefined') {
          try {
            const serverModule = '../' + 'serverFirestore';
            const { getFirestoreDb, saveStudentVocabularyToFirestoreServer } = await import(/* @vite-ignore */ serverModule);
            const serverDb = getFirestoreDb();
            if (serverDb) {
              await saveStudentVocabularyToFirestoreServer(cleanUid, accumulatedList, cleanEmail);
              cacheVocabularyLocally(cleanUid, cleanEmail, accumulatedList);
              return true;
            }
          } catch {}
        }
        throw fetchErr;
      }
    }

    // Cache accumulated list locally only after confirmed persistence
    cacheVocabularyLocally(cleanUid, cleanEmail, accumulatedList);
    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `users/${cleanUid}/vocabulary`);
    return false;
  }
}

/**
 * Persists vocabulary exclusively through the authenticated backend API /api/student-dictionary
 * with Firebase Bearer token and canonical server-side validation.
 * ZERO browser-side direct writes to Firestore (strictly compliant with Fase 4B.7A Rule 3 & Rule 4).
 */
export async function persistStudentVocabularyViaBackendApi(params: {
  studentUid: string;
  studentEmail?: string;
  lessonId?: string;
  entries: StudentDictionaryEntry[];
  isAutomaticSync?: boolean;
  syncType?: string;
}): Promise<StudentDictionaryEntry[]> {
  const { studentUid, studentEmail, lessonId, entries, isAutomaticSync = true, syncType = 'native_notes' } = params;
  const cleanUid = (studentUid || '').trim();
  const cleanEmail = (studentEmail || '').toLowerCase().trim();

  if (!entries || entries.length === 0) return [];

  if (typeof window !== 'undefined') {
    let token: string | null = null;
    try {
      token = (await getAccessToken().catch(() => null)) || (await auth.currentUser?.getIdToken().catch(() => null)) || null;
    } catch {}

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch('/api/student-dictionary', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        studentEmail: cleanEmail,
        studentUid: cleanUid,
        lessonId,
        entries,
        isAutomaticSync,
        syncType,
      }),
    });

    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      const msg = errJson.message || errJson.error || `HTTP ${res.status}: Falha ao persistir vocabulário no backend.`;
      throw new Error(msg);
    }

    const data = await res.json().catch(() => ({}));
    const updatedDict: StudentDictionaryEntry[] = Array.isArray(data?.dictionary) ? data.dictionary : entries;
    if (data?.excludedWords && Array.isArray(data.excludedWords)) {
      cacheExcludedWordsLocally(data.studentUid || cleanUid, data.studentEmail || cleanEmail, data.excludedWords);
    }
    cacheVocabularyLocally(data?.studentUid || cleanUid, data?.studentEmail || cleanEmail, updatedDict);
    return updatedDict;
  } else {
    // Node.js test environment support
    try {
      const serverModule = '../' + 'serverFirestore';
      const {
        getFirestoreDb,
        saveStudentVocabularyToFirestoreServer,
        fetchExcludedDictionaryWordsServer,
        fetchStudentVocabularyFromFirestoreServer,
      } = await import(/* @vite-ignore */ serverModule);
      const serverDb = getFirestoreDb();
      if (serverDb && cleanUid) {
        let itemsToSave = entries;
        if (isAutomaticSync) {
          const exclusions = await fetchExcludedDictionaryWordsServer(cleanUid);
          const exSet = new Set(exclusions.map(normalizeDictionaryWord).filter(Boolean));
          itemsToSave = entries.filter((e) => {
            const norm = normalizeDictionaryWord(e.normalizedWord || e.word);
            return Boolean(norm && !exSet.has(norm));
          });
        }
        if (itemsToSave.length > 0) {
          await saveStudentVocabularyToFirestoreServer(cleanUid, itemsToSave, cleanEmail);
        }
        const updated = await fetchStudentVocabularyFromFirestoreServer(cleanUid, cleanEmail);
        cacheVocabularyLocally(cleanUid, cleanEmail, updated);
        return updated;
      }
    } catch {}
    return entries;
  }
}

/**
 * Phase 1B: Mark vocabulary words practiced upon successful completion of Daily Memorization Activity.
 * Increments practiceCount (+1) and sets lastPracticedAt to current ISO timestamp for each word in the queue.
 * Persists through the existing vocabulary persistence architecture.
 */
export async function markVocabularyWordsPracticedInFirestore(
  studentUid: string,
  words: string[],
  studentEmail?: string
): Promise<StudentDictionaryEntry[]> {
  const cleanEmail = (studentEmail || '').toLowerCase().trim();
  const cleanUid = normalizeUid(studentUid, cleanEmail);
  if (!cleanUid || !words || words.length === 0) {
    return getCachedLocalVocabulary(cleanUid, cleanEmail);
  }

  const currentVocab = await fetchStudentVocabularyFromFirestore(cleanUid, cleanEmail);
  const nowIso = new Date().toISOString();
  const targetWordsSet = new Set(words.map((w) => normalizeDictionaryWord(w)).filter(Boolean));

  let modifiedCount = 0;
  const updatedVocab = currentVocab.map((entry) => {
    if (!entry || !entry.word) return entry;
    const norm = normalizeDictionaryWord(entry.normalizedWord || entry.word);
    if (targetWordsSet.has(norm)) {
      modifiedCount++;
      const currentCount = typeof entry.practiceCount === 'number' ? entry.practiceCount : 0;
      const history = Array.isArray(entry.practiceHistory) ? [...entry.practiceHistory] : [];
      history.push({
        date: nowIso,
        activityType: 'memorization',
        correct: true,
      });
      return {
        ...entry,
        normalizedWord: entry.normalizedWord || norm,
        practiceCount: currentCount + 1,
        lastPracticedAt: nowIso,
        practiceHistory: history,
      };
    }
    return entry;
  });

  if (modifiedCount > 0) {
    await saveStudentVocabularyToFirestore(cleanUid, updatedVocab, cleanEmail);
  }

  return updatedVocab;
}

/**
 * Fetch student vocabulary directly from Firestore.
 * Always returns accumulated words across document and subcollection,
 * pre-seeding with local cache so the dictionary never starts empty.
 */
export async function fetchStudentVocabularyFromFirestore(
  studentUid: string,
  studentEmail?: string
): Promise<StudentDictionaryEntry[]> {
  const db = getDb();
  const cleanEmail = (studentEmail || '').toLowerCase().trim();
  const cleanUid = normalizeUid(studentUid, cleanEmail);

  if (!db || !cleanUid) {
    return getCachedLocalVocabulary(cleanUid, cleanEmail);
  }

  const entryMap = new Map<string, StudentDictionaryEntry>();

  // A. Pre-populate from local cache so we never start empty
  const localCache = getCachedLocalVocabulary(cleanUid, cleanEmail);
  localCache.forEach((item) => {
    if (item?.word) entryMap.set(item.word.toLowerCase().trim(), item);
  });

  try {
    // 1. Fetch from users/{cleanUid} user profile document
    try {
      const userRef = doc(db, 'users', cleanUid);
      const userSnap = await withFirestoreTimeout(getDoc(userRef), 4000, null);
      if (userSnap && userSnap.exists()) {
        const data = userSnap.data();
        if (Array.isArray(data?.excludedDictionaryWords)) {
          const list: string[] = data.excludedDictionaryWords
            .map((w: string) => normalizeDictionaryWord(w))
            .filter(Boolean);
          cacheExcludedWordsLocally(cleanUid, cleanEmail, list);
        }
        if (Array.isArray(data?.vocabulary)) {
          data.vocabulary.forEach((item: StudentDictionaryEntry) => {
            if (item?.word) {
              const key = item.word.toLowerCase().trim();
              entryMap.set(key, { ...(entryMap.get(key) || {}), ...item });
            }
          });
        }
      }
    } catch {}

    // 2. Fetch from subcollection users/{cleanUid}/vocabulary
    try {
      const subColRef = collection(db, 'users', cleanUid, 'vocabulary');
      const subSnap = await withFirestoreTimeout(getDocs(subColRef), 4000, null);
      if (subSnap && !subSnap.empty) {
        subSnap.forEach((docItem) => {
          const item = docItem.data() as StudentDictionaryEntry;
          if (item && item.word) {
            const key = item.word.toLowerCase().trim();
            entryMap.set(key, { ...(entryMap.get(key) || {}), ...item });
          }
        });
      }
    } catch {}

    // 3. Fallback to legacy document IDs if cleanUid had no words (READ ONLY)
    if (entryMap.size === 0) {
      const allDocIds = getLegacyReadDocIds(cleanUid, cleanEmail);
      for (const altId of allDocIds) {
        if (altId === cleanUid) continue;
        try {
          const altRef = doc(db, 'users', altId);
          const altSnap = await withFirestoreTimeout(getDoc(altRef), 2000, null);
          if (altSnap && altSnap.exists()) {
            const altData = altSnap.data();
            if (Array.isArray(altData?.vocabulary) && altData.vocabulary.length > 0) {
              altData.vocabulary.forEach((item: StudentDictionaryEntry) => {
                if (item?.word) entryMap.set(item.word.toLowerCase().trim(), item);
              });
              // Etapa 4: Strictly read-only recovery - no automatic migration write in this phase
              break;
            }
          }
        } catch {}
      }
    }

    const excluded = new Set(getCachedExcludedDictionaryWords(cleanUid, cleanEmail));
    const result = Array.from(entryMap.values())
      .filter((item) => !excluded.has(normalizeDictionaryWord(item.normalizedWord || item.word)))
      .sort((a, b) =>
        (a.word || '').localeCompare(b.word || '', ['en', 'pt'], { sensitivity: 'base' })
      );

    // CRITICAL: Only cache if we actually have words - NEVER wipe local cache with empty result!
    if (result.length > 0) {
      cacheVocabularyLocally(cleanUid, cleanEmail, result);
    }

    return result;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `users/${cleanUid}/vocabulary`);
    return getCachedLocalVocabulary(cleanUid, cleanEmail);
  }
}

/**
 * Delete a student vocabulary entry logically by persisting tombstones via backend Firebase Admin SDK.
 * Does not physically delete lesson records, routines, definitions, or practice metrics.
 */
export async function deleteStudentVocabularyFromFirestore(
  studentUid: string,
  word: string,
  studentEmail?: string
): Promise<boolean> {
  const norm = normalizeDictionaryWord(word);
  if (!norm) return false;
  const cleanEmail = (studentEmail || '').toLowerCase().trim();
  const cleanUid = normalizeUid(studentUid, cleanEmail);
  if (!cleanUid) return false;

  // 1. Update in-memory exclusions and filter local cache
  const currentEx = new Set(getCachedExcludedDictionaryWords(cleanUid, cleanEmail));
  currentEx.add(norm);
  const updatedExcluded = Array.from(currentEx);
  cacheExcludedWordsLocally(cleanUid, cleanEmail, updatedExcluded);

  const localVocab = getCachedLocalVocabulary(cleanUid, cleanEmail);
  const filteredVocab = localVocab.filter((e) => normalizeDictionaryWord(e.normalizedWord || e.word) !== norm);
  cacheVocabularyLocally(cleanUid, cleanEmail, filteredVocab);

  // 2. Call authenticated backend DELETE endpoint
  try {
    let token: string | null = null;
    try {
      token = await getAccessToken();
    } catch {}

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch('/api/student-dictionary', {
      method: 'DELETE',
      headers,
      body: JSON.stringify({
        word: norm,
        studentUid: cleanUid,
        studentEmail: cleanEmail,
      }),
    });

    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      throw new Error(errJson.message || errJson.error || `HTTP ${res.status}: Failed to delete dictionary entry.`);
    }

    const resData = await res.json().catch(() => ({}));
    if (Array.isArray(resData?.excludedWords)) {
      cacheExcludedWordsLocally(cleanUid, cleanEmail, resData.excludedWords);
    }
    return true;
  } catch (fetchErr) {
    // In Node / SSR / test environment without browser fetch to relative URL
    if (typeof window === 'undefined') {
      try {
        const serverModule = '../' + 'serverFirestore';
        const { getFirestoreDb, addExcludedDictionaryWordsServer } = await import(/* @vite-ignore */ serverModule);
        const serverDb = getFirestoreDb();
        if (serverDb) {
          await addExcludedDictionaryWordsServer(cleanUid, [norm]);
          return true;
        }
      } catch {}
    }
    throw fetchErr;
  }
}

/**
 * Returns cached excluded dictionary words for the student.
 */
export function getCachedExcludedDictionaryWords(studentUid?: string, studentEmail?: string): string[] {
  const cleanEmail = (studentEmail || '').toLowerCase().trim();
  const cleanUid = normalizeUid(studentUid, cleanEmail);
  const set = (cleanUid && inMemoryExcludedVocabularyWords.get(cleanUid)) ||
    (cleanEmail && inMemoryExcludedVocabularyWords.get(cleanEmail));
  return set ? Array.from(set) : [];
}

/**
 * Caches excluded dictionary words locally.
 */
export function cacheExcludedWordsLocally(studentUid: string, studentEmail: string | undefined, words: string[]): void {
  const cleanEmail = (studentEmail || '').toLowerCase().trim();
  const cleanUid = normalizeUid(studentUid, cleanEmail);
  const normalizedWords = new Set(words.map((w) => normalizeDictionaryWord(w)).filter(Boolean));
  if (cleanUid) inMemoryExcludedVocabularyWords.set(cleanUid, normalizedWords);
  if (cleanEmail) inMemoryExcludedVocabularyWords.set(cleanEmail, normalizedWords);
}

/**
 * Fetches excluded dictionary words from Firestore users/{cleanUid}.
 */
export async function fetchExcludedDictionaryWords(
  studentUid: string,
  studentEmail?: string
): Promise<string[]> {
  const db = getDb();
  const cleanEmail = (studentEmail || '').toLowerCase().trim();
  const cleanUid = normalizeUid(studentUid, cleanEmail);
  if (!cleanUid) {
    return getCachedExcludedDictionaryWords(cleanUid, cleanEmail);
  }

  if (typeof window === 'undefined') {
    try {
      const serverModule = '../' + 'serverFirestore';
      const { getFirestoreDb, fetchExcludedDictionaryWordsServer } = await import(/* @vite-ignore */ serverModule);
      const serverDb = getFirestoreDb();
      if (serverDb) {
        const serverWords = await fetchExcludedDictionaryWordsServer(cleanUid);
        if (serverWords.length > 0) {
          cacheExcludedWordsLocally(cleanUid, cleanEmail, serverWords);
          return serverWords;
        }
      }
    } catch {}
  }

  if (!db) {
    return getCachedExcludedDictionaryWords(cleanUid, cleanEmail);
  }

  try {
    const userRef = doc(db, 'users', cleanUid);
    const snap = await withFirestoreTimeout(getDoc(userRef), 2500, null);
    if (snap && snap.exists()) {
      const data = snap.data();
      if (Array.isArray(data?.excludedDictionaryWords)) {
        const list: string[] = data.excludedDictionaryWords
          .map((w: string) => normalizeDictionaryWord(w))
          .filter(Boolean);
        cacheExcludedWordsLocally(cleanUid, cleanEmail, list);
        return list;
      }
    }
  } catch {}

  return getCachedExcludedDictionaryWords(cleanUid, cleanEmail);
}

/**
 * Adds a word to the excluded dictionary words list using canonical deletion endpoint.
 */
export async function addExcludedDictionaryWord(
  studentUid: string,
  word: string,
  studentEmail?: string
): Promise<boolean> {
  return deleteStudentVocabularyFromFirestore(studentUid, word, studentEmail);
}

/**
 * Removes a word from the excluded dictionary words list (e.g. when re-added manually).
 */
export async function removeExcludedDictionaryWord(
  studentUid: string,
  word: string,
  studentEmail?: string
): Promise<boolean> {
  const norm = normalizeDictionaryWord(word);
  if (!norm) return false;
  const cleanEmail = (studentEmail || '').toLowerCase().trim();
  const cleanUid = normalizeUid(studentUid, cleanEmail);
  if (!cleanUid) return false;

  const current = new Set(getCachedExcludedDictionaryWords(cleanUid, cleanEmail));
  if (current.has(norm)) {
    current.delete(norm);
    const updatedList = Array.from(current);
    cacheExcludedWordsLocally(cleanUid, cleanEmail, updatedList);
  }

  if (typeof window === 'undefined') {
    try {
      const serverModule = '../' + 'serverFirestore';
      const { getFirestoreDb, removeExcludedDictionaryWordsServer } = await import(/* @vite-ignore */ serverModule);
      const serverDb = getFirestoreDb();
      if (serverDb) {
        await removeExcludedDictionaryWordsServer(cleanUid, [norm]);
        return true;
      }
    } catch {}
  }

  const db = getDb();
  if (!db || !cleanUid) return true;

  try {
    const userRef = doc(db, 'users', cleanUid);
    const updatedList = Array.from(current);
    await withFirestoreTimeout(
      setDoc(userRef, { excludedDictionaryWords: updatedList, updatedAt: new Date().toISOString() }, { merge: true }),
      3000,
      null
    );
    return true;
  } catch {
    return false;
  }
}


export type StudentVocabularySubscriptionStatus =
  | 'loading'
  | 'loaded_with_words'
  | 'loaded_empty'
  | 'error';

export interface StudentVocabularySnapshotResult {
  entries: StudentDictionaryEntry[];
  status: StudentVocabularySubscriptionStatus;
  studentUid: string;
  error?: string | null;
  excludedWords?: string[];
}

/**
 * Real-time subscription to student vocabulary on Firestore.
 * Immediately notifies when any word is added, updated, or removed by student, teacher, or routine across devices.
 * Firestore is the single authoritative source of truth.
 *
 * FASE 4B.3 (Estabilização da Leitura do My Dictionary):
 * - Differentiates explicitly: 'loading', 'loaded_with_words', 'loaded_empty', 'error'.
 * - First empty snapshot of subcollection is NEVER interpreted as consolidated empty while main doc read is pending.
 * - Read failures never display an empty dictionary.
 * - Strict isolation per canonical UID.
 */
export function subscribeToStudentVocabulary(
  studentUid: string,
  studentEmail: string | undefined,
  callback: (entries: StudentDictionaryEntry[], snapshotResult?: StudentVocabularySnapshotResult) => void
): () => void {
  const db = getDb();
  const cleanEmail = (studentEmail || '').toLowerCase().trim();
  const cleanUid = normalizeUid(studentUid, cleanEmail);

  if (!db || !cleanUid) {
    return () => {};
  }

  const vocabColRef = collection(db, 'users', cleanUid, 'vocabulary');
  const userDocRef = doc(db, 'users', cleanUid);

  let isUnsubscribed = false;
  let docReceived = false;
  let colReceived = false;
  let docError: any = null;
  let colError: any = null;

  let docVocab: StudentDictionaryEntry[] = [];
  const colMap = new Map<string, StudentDictionaryEntry>();

  const notify = () => {
    if (isUnsubscribed) return;

    const isDocPending = !docReceived && docError === null;
    const isColPending = !colReceived && colError === null;

    // Both sources failed with read error:
    if (docError !== null && colError !== null) {
      const cached = getCachedLocalVocabulary(cleanUid, cleanEmail);
      const excluded = new Set(getCachedExcludedDictionaryWords(cleanUid, cleanEmail));
      const filteredCached = cached.filter((item) => !excluded.has(normalizeDictionaryWord(item.normalizedWord || item.word)));
      callback(filteredCached, {
        entries: filteredCached,
        status: 'error',
        studentUid: cleanUid,
        error: docError?.message || colError?.message || 'Failed to read student vocabulary from Firestore',
      });
      return;
    }

    // While main doc is still pending:
    // If subcollection is empty (colMap.size === 0), DO NOT emit as consolidated empty!
    // We are still loading!
    if (isDocPending && colMap.size === 0) {
      const cached = getCachedLocalVocabulary(cleanUid, cleanEmail);
      const excluded = new Set(getCachedExcludedDictionaryWords(cleanUid, cleanEmail));
      const filteredCached = cached.filter((item) => !excluded.has(normalizeDictionaryWord(item.normalizedWord || item.word)));
      if (filteredCached.length > 0) {
        callback(filteredCached, {
          entries: filteredCached,
          status: 'loading',
          studentUid: cleanUid,
        });
      }
      return;
    }

    // While subcollection is pending:
    // If docVocab is empty, we must also wait for subcollection before concluding empty!
    if (isColPending && docVocab.length === 0) {
      const cached = getCachedLocalVocabulary(cleanUid, cleanEmail);
      const excluded = new Set(getCachedExcludedDictionaryWords(cleanUid, cleanEmail));
      const filteredCached = cached.filter((item) => !excluded.has(normalizeDictionaryWord(item.normalizedWord || item.word)));
      if (filteredCached.length > 0) {
        callback(filteredCached, {
          entries: filteredCached,
          status: 'loading',
          studentUid: cleanUid,
        });
      }
      return;
    }

    // Authoritative consolidation
    const mergedMap = new Map<string, StudentDictionaryEntry>();

    // 1. Authoritative userDocRef vocabulary array
    docVocab.forEach((item) => {
      if (item && item.word && item.word.trim()) {
        const norm = normalizeDictionaryWord(item.normalizedWord || item.word);
        if (norm) mergedMap.set(norm, item);
      }
    });

    // 2. Subcollection items
    colMap.forEach((item, key) => {
      if (!mergedMap.has(key)) {
        mergedMap.set(key, item);
      } else {
        const existing = mergedMap.get(key)!;
        const consolidated = consolidateDictionaryEntries([existing], [item]);
        if (consolidated[0]) {
          mergedMap.set(key, consolidated[0]);
        }
      }
    });

    const excluded = new Set(getCachedExcludedDictionaryWords(cleanUid, cleanEmail));
    const list = Array.from(mergedMap.values())
      .filter((item) => !excluded.has(normalizeDictionaryWord(item.normalizedWord || item.word)))
      .sort((a, b) =>
        (a.word || '').localeCompare(b.word || '', ['en', 'pt'], { sensitivity: 'base' })
      );

    const isInitialDone = (!isDocPending) && (!isColPending);

    let status: StudentVocabularySubscriptionStatus = 'loading';
    if (list.length > 0) {
      status = 'loaded_with_words';
      cacheVocabularyLocally(cleanUid, cleanEmail, list);
    } else if (isInitialDone) {
      if (docError !== null || colError !== null) {
        status = 'error';
      } else {
        status = 'loaded_empty';
      }
    }

    callback(list, {
      entries: list,
      status,
      studentUid: cleanUid,
      error: (docError || colError)?.message || null,
      excludedWords: Array.from(excluded),
    });
  };

  // Subcollection listener
  const unsubCol = onSnapshot(
    vocabColRef,
    (snapshot) => {
      if (isUnsubscribed) return;
      colReceived = true;
      colError = null;
      colMap.clear();
      snapshot.forEach((d) => {
        const item = d.data() as StudentDictionaryEntry;
        if (item && item.word && item.word.trim()) {
          const norm = normalizeDictionaryWord(item.normalizedWord || item.word);
          if (norm) {
            colMap.set(norm, item);
          }
        }
      });
      notify();
    },
    (err) => {
      if (isUnsubscribed) return;
      colReceived = true;
      colError = err;
      console.warn('Real-time vocabulary subcollection notice:', err);
      notify();
    }
  );

  // User document listener
  const unsubDoc = onSnapshot(
    userDocRef,
    (snap) => {
      if (isUnsubscribed) return;
      docReceived = true;
      docError = null;
      if (snap.exists()) {
        const data = snap.data();
        if (Array.isArray(data?.excludedDictionaryWords)) {
          const list: string[] = data.excludedDictionaryWords
            .map((w: string) => normalizeDictionaryWord(w))
            .filter(Boolean);
          cacheExcludedWordsLocally(cleanUid, cleanEmail, list);
        }
        if (Array.isArray(data?.vocabulary)) {
          docVocab = data.vocabulary;
        } else {
          docVocab = [];
        }
      } else {
        docVocab = [];
      }
      notify();
    },
    (err) => {
      if (isUnsubscribed) return;
      docReceived = true;
      docError = err;
      console.warn('Real-time vocabulary user doc notice:', err);
      notify();
    }
  );

  return () => {
    isUnsubscribed = true;
    unsubCol();
    unsubDoc();
  };
}

/**
/**
 * Persist student daily journal entry directly via secure backend API.
 * Uses POST /api/student-journal with verified Firebase ID Token.
 * Propagates real write failures, awaits confirmation, and avoids client-side rule denials.
 */
export async function saveStudentJournalEntryToFirestore(
  studentUid: string,
  entry: DailyJournalEntry,
  studentEmail?: string
): Promise<boolean> {
  const cleanEmail = (studentEmail || '').toLowerCase().trim();
  const cleanUid = normalizeUid(studentUid, cleanEmail);
  if (!cleanUid) {
    throw new Error('Valid student UID is required to save journal entry');
  }

  const currentUser = auth.currentUser;
  let idToken: string | null = null;
  if (currentUser) {
    idToken = await currentUser.getIdToken().catch(() => null);
  }
  if (!idToken) {
    throw new Error('User must be authenticated with Firebase to save journal entry');
  }

  const sanitizedEntry: DailyJournalEntry = JSON.parse(
    JSON.stringify({
      ...entry,
      studentUid: cleanUid,
      studentEmail: cleanEmail,
      createdAt: entry.createdAt || new Date().toISOString(),
    })
  );

  const response = await fetch('/api/student-journal', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${idToken}`,
    },
    body: JSON.stringify({
      studentUid: cleanUid,
      studentEmail: cleanEmail,
      entry: sanitizedEntry,
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData?.message || errorData?.error || `Failed to save journal entry (HTTP ${response.status})`);
  }

  const resJson = await response.json().catch(() => null);
  if (!resJson || !resJson.success) {
    throw new Error('Server did not confirm journal entry persistence');
  }

  return true;
}

/**
 * Fetch student daily journal entries directly via secure backend API.
 * Uses GET /api/student-journal with verified Firebase ID Token.
 */
export async function fetchStudentJournalFromFirestore(
  studentUid: string,
  studentEmail?: string
): Promise<DailyJournalEntry[]> {
  const cleanEmail = (studentEmail || '').toLowerCase().trim();
  const cleanUid = normalizeUid(studentUid, cleanEmail);
  if (!cleanUid) return [];

  try {
    const currentUser = auth.currentUser;
    if (!currentUser) return [];
    const idToken = await currentUser.getIdToken().catch(() => null);
    if (!idToken) return [];

    const response = await fetch('/api/student-journal', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${idToken}`,
        'Cache-Control': 'no-cache',
      },
    });

    if (!response.ok) {
      console.warn('[studentPersistence] Failed to fetch student journal:', response.status);
      return [];
    }

    const data = await response.json();
    if (!Array.isArray(data)) return [];

    // Sort newest first
    data.sort((a: DailyJournalEntry, b: DailyJournalEntry) => {
      const timeA = new Date(a.createdAt || a.date).getTime();
      const timeB = new Date(b.createdAt || b.date).getTime();
      return timeB - timeA;
    });

    return data;
  } catch (error) {
    console.warn('[studentPersistence] fetchStudentJournalFromFirestore error:', error);
    return [];
  }
}

// ARCH.2D.2: Legacy Client SDK lesson helpers (saveLiveLessonToFirestore, etc.) removed;
// canonical lessons reside exclusively in Firestore (default) `lessons/{lessonId}` via backend API `/api/lessons`.

export interface ScheduleLessonTransactionParams {
  lesson: LiveLesson;
  isTrialLesson?: boolean;
}

/**
 * ATOMIC FIRESTORE TRANSACTION FOR LESSON SCHEDULING (TRIAL & PACKAGE LESSONS)
 * Guarantees that:
 * 1. Lesson booking in root `lessons` and student/teacher subcollections occurs atomically.
 * 2. Balance decrement (or trial lesson allocation) happens synchronously with zero discrepancy.
 * 3. Exact student-teacher IDs (`teacherUid`, `studentUid`, `assignedNativeFriendUID`) are linked safely.
 * 4. Reverts completely in case of conflict or network error.
 */
export async function scheduleLessonWithTransaction(params: ScheduleLessonTransactionParams): Promise<{
  success: boolean;
  lesson?: LiveLesson;
  remainingLessons?: number;
  contractedLessons?: number;
  error?: string;
}> {
  const { lesson, isTrialLesson } = params;
  if (!lesson || !lesson.startDateTime || !lesson.endDateTime) {
    return { success: false, error: 'Dados obrigatórios do agendamento ausentes.' };
  }

  // 1. Authoritative Backend Scheduling: Execute privileged operations via Firebase Admin SDK
  try {
    const currentUser = auth?.currentUser;
    if (!currentUser) {
      return {
        success: false,
        error: 'Sessão não autenticada. Faça login com seu e-mail para agendar a aula.',
      };
    }

    const idToken = await currentUser.getIdToken();
    if (!idToken) {
      return {
        success: false,
        error: 'Token de autenticação ausente. Por favor, reconecte-se.',
      };
    }

    const payload = {
      requestId: lesson.id,
      id: lesson.id,
      teacherId: lesson.teacherUid || lesson.teacherEmail,
      teacherUid: lesson.teacherUid,
      teacherEmail: lesson.teacherEmail,
      teacherName: lesson.teacherName,
      meetLink: lesson.meetLink,
      startDateTime: lesson.startDateTime,
      endDateTime: lesson.endDateTime,
      title: lesson.title,
      description: lesson.description,
      isTrialLesson: Boolean(isTrialLesson),
      studentName: lesson.studentName || currentUser.displayName || 'Aluno',
      studentEmail: currentUser.email || lesson.studentEmail,
      studentUid: currentUser.uid,
    };

    const response = await fetch('/api/lessons/schedule', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json().catch(() => ({}));

    if (response.ok && data.success) {
      return {
        success: true,
        lesson: data.lesson,
        remainingLessons: data.remainingLessons,
        contractedLessons: data.contractedLessons,
      };
    }

    return {
      success: false,
      error: data.message || data.error || 'Falha ao agendar aula no servidor.',
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('Error in scheduleLessonWithTransaction (backend dispatch):', errorMsg);
    return {
      success: false,
      error: errorMsg || 'Erro de comunicação com o servidor de agendamento.',
    };
  }
}

export interface PurchasePackageTransactionParams {
  studentUid: string;
  studentEmail: string;
  teacherEmail?: string;
  teacherName?: string;
  teacherUid?: string | null;
  teacherId?: string | null;
  publicTutorId?: string | null;
  packageLessons: number;
  idempotencyKey?: string;
  isAdminAuditGrant?: boolean;
}

/**
 * ATOMIC TRANSACTION FOR LESSON PACKAGE PURCHASES
 * Strictly executed on authenticated backend with Firebase Admin SDK (never via Client SDK).
 * Safely adds package lessons to contracted and available balances, and binds teacher ID.
 */
export async function purchasePackageWithTransaction(params: PurchasePackageTransactionParams): Promise<{
  success: boolean;
  contractedLessons?: number;
  availableLessons?: number;
  teacherUid?: string;
  profile?: any;
  error?: string;
}> {
  const cleanStudentEmail = (params.studentEmail || '').toLowerCase().trim();
  const cleanTeacherEmail = (params.teacherEmail || '').toLowerCase().trim();

  const studentUid =
    (params.studentUid && isValidCanonicalUid(params.studentUid) ? params.studentUid.trim() : '') ||
    (auth?.currentUser?.uid && (!cleanStudentEmail || (auth.currentUser.email || '').toLowerCase().trim() === cleanStudentEmail)
      ? auth.currentUser.uid
      : '');

  if (!studentUid || !isValidCanonicalUid(studentUid)) {
    return { success: false, error: 'Student UID missing' };
  }

  const teacherRef =
    params.teacherId ||
    params.publicTutorId ||
    params.teacherUid ||
    cleanTeacherEmail;

  if (!teacherRef) {
    return { success: false, error: 'Teacher identifier missing' };
  }

  // BROWSER EXECUTION: Delegate exclusively to authenticated backend endpoint with Admin SDK
  if (typeof window !== 'undefined') {
    let idToken: string | null = null;
    try {
      idToken =
        (await getAccessToken().catch(() => null)) ||
        (await auth.currentUser?.getIdToken().catch(() => null)) ||
        null;
    } catch {}

    if (!idToken || typeof idToken !== 'string' || !idToken.trim()) {
      return {
        success: false,
        error: 'Sessão não autenticada. Faça login para contratar um pacote.',
      };
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${idToken.trim()}`,
    };

    const idempotencyKey =
      params.idempotencyKey ||
      `pkg-${studentUid}-${params.packageLessons}-${Date.now()}`;

    try {
      const response = await fetch('/api/students/purchase-package', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          studentUid,
          studentEmail: cleanStudentEmail,
          teacherId: params.teacherId || params.publicTutorId || teacherRef,
          publicTutorId: params.publicTutorId || params.teacherId || teacherRef,
          teacherUid: params.teacherUid || undefined,
          teacherEmail: cleanTeacherEmail,
          teacherName: params.teacherName,
          packageLessons: params.packageLessons,
          idempotencyKey,
        }),
      });

      const resData = await response.json().catch(() => ({}));
      if (!response.ok || !resData.success) {
        return {
          success: false,
          error: resData.error || resData.message || 'Falha ao contratar pacote no servidor.',
        };
      }

      const contracted = Number(resData.contractedLessons ?? params.packageLessons);
      const available = Number(resData.availableLessons ?? resData.profile?.availableLessons ?? contracted);

      return {
        success: true,
        contractedLessons: contracted,
        availableLessons: available,
        teacherUid: resData.teacherUid || resData.profile?.teacherUid,
        profile: resData.profile,
      };
    } catch (netErr: any) {
      console.error('Network error during purchasePackageWithTransaction:', netErr);
      return {
        success: false,
        error: netErr?.message || 'Erro de comunicação ao contratar pacote.',
      };
    }
  } else {
    // NODE.JS TEST ENVIRONMENT: Execute atomic transaction via Firebase Admin SDK
    // FASE FIN.2A.2B: Em modo pré-comercialização, somente concessão administrativa auditada é permitida
    if (process.env.PAYMENTS_ENABLED !== 'true' && !params.isAdminAuditGrant) {
      return {
        success: false,
        error: 'A contratação de pacotes está temporariamente indisponível (modo pré-comercialização). Nenhum crédito gerado.',
      };
    }

    if (![1, 4, 8, 12].includes(Number(params.packageLessons))) {
      return {
        success: false,
        error: 'Pacote inválido. Os pacotes comerciais aprovados são de 1, 4, 8 ou 12 aulas.',
      };
    }

    try {
      const serverModule = '../' + 'serverFirestore';
      const { getFirestoreDb, resolveTeacherCanonicalIdentity } = await import(/* @vite-ignore */ serverModule);
      const adminDb = getFirestoreDb();
      if (adminDb) {
        const teacherRes = await resolveTeacherCanonicalIdentity({
          teacherId: params.teacherId || params.publicTutorId || teacherRef,
          teacherEmail: cleanTeacherEmail,
          teacherUid: params.teacherUid || undefined,
          publicTutorId: params.publicTutorId || params.teacherId,
        });

        if (!teacherRes || !isValidCanonicalUid(teacherRes.canonicalUid)) {
          return { success: false, error: 'Amigo Nativo não encontrado ou identidade canônica inválida' };
        }
        if (!teacherRes.isApproved) {
          return { success: false, error: 'O Amigo Nativo selecionado ainda não foi aprovado para receber agendamentos.' };
        }

        const canonicalTeacherUid = teacherRes.canonicalUid;
        const studentDocRef = adminDb.collection('users').doc(studentUid);
        const teacherDocRef = adminDb.collection('users').doc(canonicalTeacherUid);
        const idempKey = params.idempotencyKey ? String(params.idempotencyKey).trim() : '';
        const txDocId = idempKey ? `pkg_${studentUid}_${idempKey.replace(/[^a-zA-Z0-9_-]/g, '_')}` : `pkg_${studentUid}_${Date.now()}`;
        const txDocRef = adminDb.collection('financial_transactions').doc(txDocId);

        let finalContracted = params.packageLessons;
        let finalAvailable = params.packageLessons;

        await adminDb.runTransaction(async (transaction: any) => {
          const [studentSnap, txSnap] = await Promise.all([
            transaction.get(studentDocRef),
            idempKey ? transaction.get(txDocRef) : Promise.resolve(null),
          ]);
          const studentData = studentSnap.exists ? (studentSnap.data() || {}) : {};
          const processedPurchases = studentData.processedPurchases || {};

          if (idempKey && ((txSnap && txSnap.exists) || processedPurchases[idempKey])) {
            finalContracted = typeof studentData.contractedLessons === 'number'
              ? studentData.contractedLessons
              : Number(processedPurchases[idempKey]?.contractedLessons ?? 0);
            finalAvailable = typeof studentData.availableLessons === 'number'
              ? studentData.availableLessons
              : Number(processedPurchases[idempKey]?.availableLessons ?? 0);
            return;
          }

          const currentContracted = Number(studentData.contractedLessons || 0);
          const currentAvailable = typeof studentData.availableLessons === 'number'
            ? studentData.availableLessons
            : 0;
          finalContracted = currentContracted + params.packageLessons;
          finalAvailable = currentAvailable + params.packageLessons;

          const nowIso = new Date().toISOString();
          const updatedProcessed = { ...processedPurchases };
          if (idempKey) {
            updatedProcessed[idempKey] = {
              transactionId: txDocId,
              lessonsAdded: params.packageLessons,
              contractedLessons: finalContracted,
              availableLessons: finalAvailable,
              teacherUid: canonicalTeacherUid,
              timestamp: nowIso,
            };
          }

          transaction.set(studentDocRef, {
            contractedLessons: finalContracted,
            availableLessons: finalAvailable,
            teacherUid: canonicalTeacherUid,
            assignedNativeFriendUID: canonicalTeacherUid,
            nativeFriendUID: canonicalTeacherUid,
            teacherEmail: teacherRes.email || cleanTeacherEmail,
            teacherName: teacherRes.name || params.teacherName || '',
            enrollmentStatus: 'active',
            subscriptionType: 'package',
            processedPurchases: updatedProcessed,
            updatedAt: nowIso,
          }, { merge: true });

          transaction.set(teacherDocRef, { updatedAt: nowIso }, { merge: true });
          transaction.set(txDocRef, {
            id: txDocId,
            type: 'package_purchase',
            idempotencyKey: idempKey || null,
            studentUid,
            studentEmail: cleanStudentEmail,
            teacherUid: canonicalTeacherUid,
            packageLessons: params.packageLessons,
            status: 'completed',
            createdAt: nowIso,
          });
        });

        return {
          success: true,
          contractedLessons: finalContracted,
          availableLessons: finalAvailable,
          teacherUid: canonicalTeacherUid,
          profile: {
            teacherUid: canonicalTeacherUid,
            contractedLessons: finalContracted,
            availableLessons: finalAvailable,
            teacherEmail: teacherRes.email || cleanTeacherEmail,
            teacherName: teacherRes.name || params.teacherName || '',
          },
        };
      }
    } catch (testErr: any) {
      console.warn('Node test purchase package transaction error:', testErr);
      return { success: false, error: testErr?.message || String(testErr) };
    }
    return { success: false, error: 'Ambiente sem suporte a transações' };
  }
}

export interface CancelLessonTransactionParams {
  lessonId: string;
  studentUid?: string;
  studentEmail?: string;
  cancelledBy?: 'student' | 'teacher' | 'admin';
  cancellationReason?: string;
}

/**
 * ATOMIC FIRESTORE TRANSACTION FOR LESSON CANCELLATION
 * Cancels lesson across collections and restores balance if cancelled by teacher or admin.
 */
export async function cancelLessonWithTransaction(params: CancelLessonTransactionParams): Promise<{
  success: boolean;
  error?: string;
}> {
  const db = getDb();
  if (!db || !params.lessonId) return { success: false, error: 'Lesson ID missing' };

  const lessonRef = doc(db, 'lessons', params.lessonId);
  const nowIso = new Date().toISOString();

  try {
    await runTransaction(db, async (transaction) => {
      const lessonSnap = await transaction.get(lessonRef);
      if (!lessonSnap.exists()) {
        throw new Error('Lesson document not found');
      }

      const lessonData = lessonSnap.data() as LiveLesson;
      const studentUid = normalizeUid(
        params.studentUid || lessonData.studentUid,
        params.studentEmail || lessonData.studentEmail
      );
      const studentRef = studentUid ? doc(db, 'users', studentUid) : null;
      const studentSnap = studentRef ? await transaction.get(studentRef) : null;

      const cancelledLesson: LiveLesson = {
        ...lessonData,
        status: 'cancelled',
        cancelledAt: nowIso,
        cancelledBy: params.cancelledBy || 'student',
        cancellationReason: params.cancellationReason || 'Cancelled',
        updatedAt: nowIso,
      };

      transaction.set(lessonRef, cancelledLesson, { merge: true });

      if (studentRef && studentSnap && studentSnap.exists()) {
        const studentData = studentSnap.data();
        const studentSubLessonRef = doc(db, 'users', studentUid, 'lessons', params.lessonId);
        transaction.set(studentSubLessonRef, cancelledLesson, { merge: true });

        // If cancelled by teacher/admin, restore the student's lesson balance
        const shouldRestoreBalance = params.cancelledBy === 'teacher' || params.cancelledBy === 'admin';
        if (shouldRestoreBalance) {
          const curAvail =
            studentData.availableLessons !== undefined
              ? Number(studentData.availableLessons)
              : Number(studentData.contractedLessons || 0);
          transaction.set(
            studentRef,
            {
              availableLessons: curAvail + 1,
              updatedAt: nowIso,
            },
            { merge: true }
          );
        }
      }
    });

    return { success: true };
  } catch (error) {
    console.error('Error in cancelLessonWithTransaction:', error);
    handleFirestoreError(error, OperationType.UPDATE, `lessons/${params.lessonId}`);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Fetch all Native Friend / Teacher profiles directly from the unified `users` collection
 * filtering by role == 'teacher'.
 * Also migrates any legacy documents from `tutors` into `users` to guarantee zero reference loss.
 */
export async function fetchTeachersFromFirestore(): Promise<NativeFriendTutor[]> {
  const db = getDb();
  if (!db) return [];

  try {
    const teachersMap = new Map<string, NativeFriendTutor>();

    // 1. Query unified users collection where role == 'teacher'
    try {
      const qTeachers = query(collection(db, 'users'), where('role', '==', 'teacher'));
      const snap = await withFirestoreTimeout(getDocs(qTeachers), 3500, null);
      if (snap && !snap.empty) {
        snap.forEach((d) => {
          const data = d.data();
          if (data && data.email && d.id !== 'test_user_id') {
            const key = (data.email || d.id).toLowerCase().trim();
            teachersMap.set(key, {
              id: d.id,
              uid: data.uid || d.id,
              name: data.name || key.split('@')[0],
              email: data.email,
              avatar: data.avatar || data.picture || '',
              picture: data.picture || data.avatar || '',
              country: data.country || 'Global',
              headline: data.headline || '',
              bio: data.bio || '',
              accent: data.accent || '',
              specialties: Array.isArray(data.specialties) ? data.specialties : [],
              videoUrl: data.videoUrl || '',
              youtubeVideoId: data.youtubeVideoId || '',
              meetUrl: data.meetUrl || data.meetLink || '',
              meetLink: data.meetLink || data.meetUrl || '',
              rating: typeof data.rating === 'number' ? data.rating : 5.0,
              reviewsCount: typeof data.reviewsCount === 'number' ? data.reviewsCount : 0,
              hourlyRate: typeof data.hourlyRate === 'number' ? data.hourlyRate : 0,
              approvalStatus: data.approvalStatus || 'approved',
              isAvailable: data.isAvailable !== undefined ? data.isAvailable : true,
              availableDays: Array.isArray(data.availableDays)
                ? data.availableDays
                : ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'],
              timezone: data.timezone || 'America/Sao_Paulo',
              role: 'teacher',
            } as unknown as NativeFriendTutor);
          }
        });
      }
    } catch (err) {
      console.warn('fetchTeachersFromFirestore users query notice:', err);
    }

    // 2. Migration check: If tutors collection has entries not in users, migrate them to users
    try {
      const snapTutors = await withFirestoreTimeout(getDocs(collection(db, 'tutors')), 2500, null);
      if (snapTutors && !snapTutors.empty) {
        for (const d of snapTutors.docs) {
          const data = d.data();
          if (data && data.email && d.id !== 'test_tutor_id') {
            const key = data.email.toLowerCase().trim();
            if (!teachersMap.has(key)) {
              const teacherObj: NativeFriendTutor = {
                id: d.id,
                uid: data.uid || d.id,
                name: data.name || key.split('@')[0],
                email: data.email,
                avatar: data.avatar || data.picture || '',
                picture: data.picture || data.avatar || '',
                country: data.country || 'Global',
                headline: data.headline || '',
                bio: data.bio || '',
                accent: data.accent || '',
                specialties: Array.isArray(data.specialties) ? data.specialties : [],
                videoUrl: data.videoUrl || '',
                youtubeVideoId: data.youtubeVideoId || '',
                meetUrl: data.meetUrl || data.meetLink || '',
                meetLink: data.meetLink || data.meetUrl || '',
                rating: typeof data.rating === 'number' ? data.rating : 5.0,
                reviewsCount: typeof data.reviewsCount === 'number' ? data.reviewsCount : 0,
                hourlyRate: typeof data.hourlyRate === 'number' ? data.hourlyRate : 0,
                approvalStatus: data.approvalStatus || 'approved',
                isAvailable: data.isAvailable !== undefined ? data.isAvailable : true,
                availableDays: Array.isArray(data.availableDays)
                  ? data.availableDays
                  : ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'],
                timezone: data.timezone || 'America/Sao_Paulo',
                role: 'teacher',
              } as unknown as NativeFriendTutor;
              teachersMap.set(key, teacherObj);

              // Seamless one-time write to users collection to unify
              const targetDocId = d.id;
              setDoc(
                doc(db, 'users', targetDocId),
                {
                  ...teacherObj,
                  role: 'teacher',
                  updatedAt: new Date().toISOString(),
                },
                { merge: true }
              ).catch(() => {});
            }
          }
        }
      }
    } catch {}

    return Array.from(teachersMap.values());
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'users');
    return [];
  }
}

/**
 * Real-time subscription to Native Friends / Teachers from the unified `users` collection.
 * Listens strictly to `users` where `role == 'teacher'`.
 */
export function subscribeToTeachers(callback: (teachers: NativeFriendTutor[]) => void): () => void {
  const db = getDb();
  if (!db) return () => {};

  try {
    const qTeachers = query(collection(db, 'users'), where('role', '==', 'teacher'));
    const unsub = onSnapshot(
      qTeachers,
      (snapshot) => {
        const teachersList: NativeFriendTutor[] = [];
        snapshot.forEach((d) => {
          const data = d.data();
          if (data && data.email && d.id !== 'test_user_id') {
            teachersList.push({
              id: d.id,
              uid: data.uid || d.id,
              name: data.name || (data.email || '').split('@')[0],
              email: data.email,
              avatar: data.avatar || data.picture || '',
              picture: data.picture || data.avatar || '',
              country: data.country || 'Global',
              headline: data.headline || '',
              bio: data.bio || '',
              accent: data.accent || '',
              specialties: Array.isArray(data.specialties) ? data.specialties : [],
              videoUrl: data.videoUrl || '',
              youtubeVideoId: data.youtubeVideoId || '',
              meetUrl: data.meetUrl || data.meetLink || '',
              meetLink: data.meetLink || data.meetUrl || '',
              rating: typeof data.rating === 'number' ? data.rating : 5.0,
              reviewsCount: typeof data.reviewsCount === 'number' ? data.reviewsCount : 0,
              hourlyRate: typeof data.hourlyRate === 'number' ? data.hourlyRate : 0,
              approvalStatus: data.approvalStatus || 'approved',
              isAvailable: data.isAvailable !== undefined ? data.isAvailable : true,
              availableDays: Array.isArray(data.availableDays)
                ? data.availableDays
                : ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'],
              timezone: data.timezone || 'America/Sao_Paulo',
              role: 'teacher',
            } as unknown as NativeFriendTutor);
          }
        });
        callback(teachersList);
      },
      (err) => {
        console.warn('Real-time teachers subscription notice:', err);
      }
    );

    return () => unsub();
  } catch (err) {
    console.warn('Error initiating subscribeToTeachers:', err);
    return () => {};
  }
}

/**
 * Persist student's assigned Native Friend and enrollment status directly to Firestore.
 * Updates all canonical user doc representations (UID, cleanEmail, emailDocId, hyphenDocId, usrDocId),
 * ensuring immediate and permanent persistence across reloads.
 */
export async function saveStudentNativeFriendToFirestore(
  studentUid: string,
  studentEmail?: string,
  teacherData?: {
    teacherEmail?: string | null;
    teacherName?: string | null;
    teacherUid?: string | null;
    teacherId?: string | null;
    publicTutorId?: string | null;
    assignedNativeFriendUID?: string | null;
    nativeFriendUID?: string | null;
    enrollmentStatus?: string;
  }
): Promise<boolean> {
  const cleanEmail = (studentEmail || '').toLowerCase().trim();
  const cleanUid = normalizeUid(studentUid, cleanEmail);
  if (!cleanUid) {
    console.error('[Firestore Error] Student UID missing');
    return false;
  }

  // Resolve canonical Native Friend UID strictly from explicit UID fields - NEVER manufacture from email!
  const explicitTeacherUid =
    (teacherData?.teacherUid && isValidCanonicalUid(teacherData.teacherUid) ? teacherData.teacherUid.trim() : null) ||
    (teacherData?.assignedNativeFriendUID && isValidCanonicalUid(teacherData.assignedNativeFriendUID) ? teacherData.assignedNativeFriendUID.trim() : null) ||
    (teacherData?.nativeFriendUID && isValidCanonicalUid(teacherData.nativeFriendUID) ? teacherData.nativeFriendUID.trim() : null);

  const isBecomingActive = teacherData?.enrollmentStatus === 'active';

  const hasTeacherRef = Boolean(
    explicitTeacherUid ||
    teacherData?.teacherId ||
    teacherData?.publicTutorId ||
    (teacherData?.teacherEmail && teacherData.teacherEmail.trim())
  );

  // Business rule: Every active Student must be associated with a valid Native Friend reference
  if (isBecomingActive && !hasTeacherRef) {
    console.error('[Firestore Error] Native Friend reference missing for active enrollment');
    return false;
  }

  // Auth Context Safety: Student UID and Native Friend UID must never be identical
  if (explicitTeacherUid && explicitTeacherUid === cleanUid) {
    console.error('[Firestore Error] Student UID and Native Friend UID cannot be identical');
    return false;
  }

  const payload: Record<string, any> = {
    updatedAt: new Date().toISOString(),
  };

  if (teacherData?.teacherEmail !== undefined) {
    payload.teacherEmail = teacherData.teacherEmail ? teacherData.teacherEmail.trim().toLowerCase() : null;
  }
  if (teacherData?.teacherName !== undefined) {
    payload.teacherName = teacherData.teacherName ? teacherData.teacherName.trim() : null;
  }
  if (teacherData?.teacherId) {
    payload.teacherId = teacherData.teacherId;
  }
  if (teacherData?.publicTutorId) {
    payload.publicTutorId = teacherData.publicTutorId;
  }

  if (explicitTeacherUid) {
    payload.teacherUid = explicitTeacherUid;
    payload.assignedNativeFriendUID = explicitTeacherUid;
    payload.nativeFriendUID = explicitTeacherUid;
  } else if (teacherData?.enrollmentStatus === 'cancelled' || teacherData?.teacherUid === null) {
    payload.teacherUid = null;
    payload.assignedNativeFriendUID = null;
    payload.nativeFriendUID = null;
  }

  if (teacherData?.enrollmentStatus !== undefined) {
    payload.enrollmentStatus = teacherData.enrollmentStatus;
    payload.status = teacherData.enrollmentStatus;
  }

  if (typeof window !== 'undefined') {
    const authUser = (await waitForAuthUser(3000).catch(() => null)) || auth.currentUser;
    if (!authUser || !authUser.uid || !isValidCanonicalUid(authUser.uid)) {
      console.warn(`[StudentPersistence] Unauthenticated Native Friend write blocked: No valid Firebase session for ${cleanUid}`);
      return false;
    }

    let token: string | null = null;
    try {
      token = (await authUser.getIdToken(true).catch(() => null)) || (await getAccessToken(true).catch(() => null));
    } catch {}

    if (!token || typeof token !== 'string' || token.trim().length === 0) {
      console.warn(`[StudentPersistence] Unauthenticated Native Friend write blocked: Missing Firebase ID token for ${cleanUid}`);
      return false;
    }

    if (authUser.uid !== cleanUid) {
      const isAuthorized = await isAuthorizedAdminUser(authUser).catch(() => false);
      if (!isAuthorized) {
        console.warn(`[StudentPersistence] Security violation: Session UID ${authUser.uid} does not match profile UID ${cleanUid}`);
        return false;
      }
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token.trim()}`,
    };

    try {
      const res = await fetch('/api/user-profile', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          uid: cleanUid,
          email: cleanEmail,
          profile: payload,
        }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        console.warn(`[StudentPersistence Error] Backend /api/user-profile returned ${res.status}:`, errJson);
        return false;
      }
      return true;
    } catch (error) {
      console.error(`[StudentPersistence Error] Failed to bind Native Friend for ${cleanUid} via backend:`, error);
      return false;
    }
  } else {
    // Node.js test environment support: direct write via Admin Firestore
    try {
      const serverModule = '../' + 'serverFirestore';
      const { getFirestoreDb } = await import(/* @vite-ignore */ serverModule);
      const adminDb = getFirestoreDb();
      if (adminDb) {
        await adminDb.collection('users').doc(cleanUid).set(payload, { merge: true });
        return true;
      }
    } catch (testErr) {
      console.warn('[studentPersistence] Node test backend fallback notice:', testErr);
    }
    return false;
  }
}

/**
 * Persist the entire student profile directly via authenticated backend API using Firebase Admin SDK
 * strictly writing to users/{cleanUid}.
 */
export async function saveStudentProfileToFirestore(
  studentUid: string,
  profile: Partial<UserProfile>,
  studentEmail?: string
): Promise<boolean> {
  const cleanEmail = (profile.email || studentEmail || '').toLowerCase().trim();
  const cleanUid = normalizeUid(studentUid, cleanEmail);
  if (!cleanUid) return false;

  const cleanTeacherEmail = (profile.teacherEmail || '').toLowerCase().trim();
  
  // Resolve canonical Native Friend UID strictly from explicit UID fields - NEVER manufacture from email!
  const explicitTeacherUid =
    (profile.teacherUid && isValidCanonicalUid(profile.teacherUid) ? profile.teacherUid.trim() : null) ||
    (profile.assignedNativeFriendUID && isValidCanonicalUid(profile.assignedNativeFriendUID) ? profile.assignedNativeFriendUID.trim() : null) ||
    (profile.nativeFriendUID && isValidCanonicalUid(profile.nativeFriendUID) ? profile.nativeFriendUID.trim() : null);

  const isTeacherAssignment =
    profile.teacherEmail !== undefined ||
    profile.teacherName !== undefined ||
    profile.teacherUid !== undefined ||
    (profile as any).teacherId !== undefined ||
    (profile as any).publicTutorId !== undefined;

  const hasTeacherRef = Boolean(
    explicitTeacherUid ||
    (profile as any).teacherId ||
    (profile as any).publicTutorId ||
    cleanTeacherEmail
  );

  // For NEW active assignments, require a valid Native Friend reference (UID, public ID, or email)
  if (profile.enrollmentStatus === 'active' && isTeacherAssignment && !hasTeacherRef) {
    console.error('[Firestore Error] Native Friend reference missing for active student assignment');
    return false;
  }

  if (explicitTeacherUid && explicitTeacherUid === cleanUid) {
    console.error('[Firestore Error] Student UID and Native Friend UID cannot be identical');
    return false;
  }

  const sanitized = JSON.parse(JSON.stringify(profile));
  const payload: Record<string, any> = {
    ...sanitized,
    id: cleanUid,
    uid: cleanUid,
    updatedAt: new Date().toISOString(),
  };

  if (cleanEmail || sanitized.email) {
    payload.email = cleanEmail || sanitized.email;
  }
  if (profile.teacherEmail !== undefined) {
    payload.teacherEmail = cleanTeacherEmail || null;
  }
  if (profile.teacherName !== undefined) {
    payload.teacherName = profile.teacherName ? profile.teacherName.trim() : null;
  }

  if (explicitTeacherUid) {
    payload.teacherUid = explicitTeacherUid;
    payload.assignedNativeFriendUID = explicitTeacherUid;
    payload.nativeFriendUID = explicitTeacherUid;
  } else if (profile.enrollmentStatus === 'cancelled' || profile.teacherUid === null) {
    payload.teacherUid = null;
    payload.assignedNativeFriendUID = null;
    payload.nativeFriendUID = null;
  } else {
    // Strip non-canonical teacher UIDs from new payload to prevent persisting manufactured UIDs
    if (payload.teacherUid && !isValidCanonicalUid(payload.teacherUid)) {
      delete payload.teacherUid;
    }
    if (payload.assignedNativeFriendUID && !isValidCanonicalUid(payload.assignedNativeFriendUID)) {
      delete payload.assignedNativeFriendUID;
    }
    if (payload.nativeFriendUID && !isValidCanonicalUid(payload.nativeFriendUID)) {
      delete payload.nativeFriendUID;
    }
  }

  if (profile.enrollmentStatus !== undefined) {
    payload.enrollmentStatus = profile.enrollmentStatus;
  }

  const stampedPayload = stampSchemaVersion(payload);

  // Authenticated persistence strictly via backend API with Firebase Admin SDK
  if (typeof window !== 'undefined') {
    const authUser = (await waitForAuthUser(3000).catch(() => null)) || auth.currentUser;
    if (!authUser || !authUser.uid || !isValidCanonicalUid(authUser.uid)) {
      console.warn(`[StudentPersistence Error] Unauthenticated write blocked: No active Firebase session for ${cleanUid}`);
      return false;
    }

    let token: string | null = null;
    try {
      token = (await authUser.getIdToken(true).catch(() => null)) || (await getAccessToken(true).catch(() => null));
    } catch {}

    if (!token || typeof token !== 'string' || token.trim().length === 0) {
      console.warn(`[StudentPersistence Error] Unauthenticated write blocked: Missing Firebase ID token for ${cleanUid}`);
      return false;
    }

    // Invariant: token user must match profile UID unless authorized admin
    if (authUser.uid !== cleanUid) {
      const isAuthorized = await isAuthorizedAdminUser(authUser).catch(() => false);
      if (!isAuthorized) {
        console.warn(`[StudentPersistence Error] Security violation: Session UID ${authUser.uid} does not match profile UID ${cleanUid}`);
        return false;
      }
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token.trim()}`,
    };

    try {
      const res = await fetch('/api/user-profile', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          uid: cleanUid,
          email: cleanEmail,
          profile: stampedPayload,
        }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        const msg = errJson.message || errJson.error || `HTTP ${res.status}: Falha ao persistir perfil no backend.`;
        console.error(`[StudentPersistence Error] Failed to persist profile for ${cleanUid}: ${msg}`);
        return false;
      }
      return true;
    } catch (error) {
      console.error(`[StudentPersistence Error] Network/API failure to persist profile for ${cleanUid}:`, error);
      return false;
    }
  } else {
    // Node.js test environment support: direct write via Admin Firestore
    try {
      const serverModule = '../' + 'serverFirestore';
      const { getFirestoreDb } = await import(/* @vite-ignore */ serverModule);
      const adminDb = getFirestoreDb();
      if (adminDb) {
        await adminDb.collection('users').doc(cleanUid).set(stampedPayload, { merge: true });
        return true;
      }
    } catch (testErr) {
      console.warn('[studentPersistence] Node test backend fallback notice:', testErr);
    }
    return false;
  }
}

/**
 * Fetch student profile directly from Firestore users/{cleanUid}.
 * Reads strictly from users/{cleanUid}. Performs one-time migration if a legacy
 * email-keyed document exists, ensuring data integrity without fragmenting records.
 */
export async function fetchStudentProfileFromFirestore(
  studentUid: string,
  studentEmail?: string
): Promise<Partial<UserProfile> | null> {
  const db = getDb();
  if (!db) return null;
  const cleanEmail = (studentEmail || '').toLowerCase().trim();
  const cleanUid = auth?.currentUser?.uid || normalizeUid(studentUid, cleanEmail);
  if (!cleanUid) return null;

  try {
    // 1. Strict primary read from users/{cleanUid}
    const snap = await withFirestoreTimeout(getDoc(doc(db, 'users', cleanUid)), 2500, null);
    if (snap && snap.exists()) {
      const data = snap.data() as Partial<UserProfile>;
      // Validate schema and detect if migration is needed
      validateFirestoreDocument('users', data, { path: `users/${cleanUid}` });

      if (data && (data.email || data.name || data.teacherEmail !== undefined)) {
        return {
          ...data,
          id: cleanUid,
          uid: cleanUid,
          email: cleanEmail || data.email,
        };
      }
    }

    // 2. One-time migration fallback for legacy accounts where user was created under an email doc
    if (cleanEmail) {
      const legacyDocIds = [
        `usr-${cleanEmail.replace(/[^a-zA-Z0-9]/g, '-')}`,
        cleanEmail.replace(/[^a-zA-Z0-9]/g, '-'),
        cleanEmail,
      ];
      for (const legacyId of legacyDocIds) {
        if (legacyId === cleanUid) continue;
        const legacySnap = await withFirestoreTimeout(getDoc(doc(db, 'users', legacyId)), 2000, null);
        if (legacySnap && legacySnap.exists()) {
          const legacyData = legacySnap.data() as Partial<UserProfile>;
          if (legacyData && (legacyData.email || legacyData.name || legacyData.teacherEmail !== undefined)) {
            // Migrate to users/{cleanUid}
            const migrated: Partial<UserProfile> = {
              ...legacyData,
              id: cleanUid,
              uid: cleanUid,
              email: cleanEmail,
              updatedAt: new Date().toISOString(),
            };
            await withFirestoreTimeout(setDoc(doc(db, 'users', cleanUid), migrated, { merge: true }), 2500, null);
            return migrated;
          }
        }
      }
    }

    return null;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `users/${cleanUid}`);
    return null;
  }
}

// ARCH.2D.2: Legacy Client SDK lesson read/mutation/subcollection fallbacks removed.
// All lesson queries and mutations route through authenticated backend API `/api/lessons*`.

/**
 * Subscribe to real-time student profile updates in Firestore strictly using users/{cleanUid}.
 */
export function subscribeToStudentProfile(
  studentUid: string,
  studentEmail: string | undefined,
  callback: (profile: Partial<UserProfile>) => void
): () => void {
  const db = getDb();
  const cleanEmail = (studentEmail || '').toLowerCase().trim();
  const cleanUid = normalizeUid(studentUid, cleanEmail);
  if (!db || !cleanUid) return () => {};

  try {
    const userRef = doc(db, 'users', cleanUid);
    const unsub = onSnapshot(
      userRef,
      (snap) => {
        if (snap.exists()) {
          const data = snap.data();
          if (data) {
            callback({
              ...data,
              id: cleanUid,
              uid: cleanUid,
            } as Partial<UserProfile>);
          }
        }
      },
      (err) => console.warn(`subscribeToStudentProfile notice for ${cleanUid}:`, err)
    );
    return unsub;
  } catch {
    return () => {};
  }
}

/**
 * Real-time subscription to student S-Path (Gráfico S) weekly checks.
 * Scoped to the requested week: users/{studentUID}/weeklyChecks/week-${cycle}.
 * Backward compatibility:
 * - If Week 1 requested (or resolved) and week-1 document does not exist yet, falls back to legacy root document users/{studentUID}.
 * - For Week 2+, strictly listens to users/{studentUID}/weeklyChecks/week-${cycle} and NEVER falls back to legacy root checks or homework/current_week.
 * - If week parameter omitted, resolves active weeklyCycle from user profile; refuses to silently default to Week 1 if unresolvable.
 */
export function subscribeToStudentWeeklyChecks(
  studentUid: string,
  studentEmail: string | undefined,
  callback: (data: {
    checks: Record<string, boolean>;
    weeklyNativeLessonsTarget?: number;
    weeklyStudyDaysTarget?: number;
    weekId?: string;
    weeklyCycle?: number;
  }) => void,
  week?: string | number | null
): () => void {
  const cleanEmail = (studentEmail || '').toLowerCase().trim();
  const cleanUid = normalizeUid(studentUid, cleanEmail);
  if (!cleanUid && !cleanEmail) return () => {};

  const isCurrentWeekAlias = week === undefined || week === null || (typeof week === 'string' && (week.trim() === '' || week.trim().toLowerCase() === 'current_week'));
  const explicitWeekId = isCurrentWeekAlias ? 'current_week' : normalizeWeekId(week);
  const explicitCycle = isCurrentWeekAlias ? null : parseWeekCycleNumber(week);

  if (!isCurrentWeekAlias && (!explicitWeekId || !explicitCycle)) {
    return () => {};
  }

  let isCancelled = false;

  const fetchLatest = async () => {
    if (isCancelled) return;
    try {
      const token = await getAccessToken().catch(() => null);
      if (isCancelled) return;
      if (typeof window !== 'undefined' && !token) return;

      const canonicalUid = auth?.currentUser?.uid || (isValidCanonicalUid(cleanUid) ? cleanUid : '');
      const currentAuthEmail = (auth?.currentUser?.email || '').toLowerCase().trim();
      const safeStudentEmail = (cleanEmail && cleanEmail.includes('@') && (!currentAuthEmail || currentAuthEmail === cleanEmail)) ? cleanEmail : '';

      const qParams = new URLSearchParams();
      if (canonicalUid) qParams.append('studentUid', canonicalUid);
      if (safeStudentEmail) qParams.append('studentEmail', safeStudentEmail);
      if (explicitWeekId === 'current_week') {
        qParams.append('weekId', 'current_week');
      } else {
        qParams.append('weeklyCycle', String(explicitCycle));
        qParams.append('weekId', explicitWeekId!);
      }

      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(`/api/routines/weekly-checks?${qParams.toString()}`, { headers });
      if (isCancelled || !res.ok) return;

      const sData = await res.json().catch(() => null);
      if (isCancelled || !sData || !sData.success) return;

      const resolvedWeekId = sData.weekId || (explicitWeekId !== 'current_week' ? explicitWeekId : 'week-1');
      const resolvedCycle = sData.weeklyCycle || explicitCycle || 1;
      const docChecks: Record<string, boolean> = sData.checks || {};

      cacheWeeklyChecksLocally(canonicalUid || cleanUid, cleanEmail, docChecks, resolvedWeekId);
      callback({
        checks: docChecks,
        weeklyNativeLessonsTarget: sData.weeklyNativeLessonsTarget,
        weeklyStudyDaysTarget: sData.weeklyStudyDaysTarget,
        weekId: resolvedWeekId,
        weeklyCycle: resolvedCycle,
      });
    } catch (err) {
      console.warn(`WeeklyChecks API sync notice for ${cleanUid}:`, err);
    }
  };

  fetchLatest();

  let unsubAuth: (() => void) | null = null;
  if (typeof window !== 'undefined' && auth) {
    try {
      unsubAuth = onAuthStateChanged(auth, (user) => {
        if (user && !isCancelled) {
          fetchLatest();
        }
      });
    } catch {}
  }

  const handleUpdatedEvent = (ev: Event) => {
    if (isCancelled) return;
    const detail = (ev as CustomEvent)?.detail;
    if (!detail) return;
    const detailUid = detail.studentUid || '';
    if (detailUid && cleanUid && detailUid !== cleanUid && detailUid !== auth?.currentUser?.uid) return;
    if (!isCurrentWeekAlias && detail.weeklyCycle && explicitCycle && detail.weeklyCycle !== explicitCycle) return;
    if (detail.checks && typeof detail.checks === 'object') {
      callback({
        checks: detail.checks,
        weeklyNativeLessonsTarget: detail.weeklyNativeLessonsTarget,
        weeklyStudyDaysTarget: detail.weeklyStudyDaysTarget,
        weekId: detail.weekId,
        weeklyCycle: detail.weeklyCycle,
      });
    }
  };

  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('its-simple:weekly-checks-updated', handleUpdatedEvent);
  }

  return () => {
    isCancelled = true;
    if (unsubAuth) unsubAuth();
    if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      window.removeEventListener('its-simple:weekly-checks-updated', handleUpdatedEvent);
    }
  };
}

/**
 * Persist student S-Path (Gráfico S) weekly checks via authenticated /api/routines/weekly-checks endpoint.
 * Writes exclusively to canonical Firestore users/{uid}/weeklyChecks/week-{cycle} (and goals on users/{uid}).
 */
export async function saveStudentWeeklyChecksToFirestore(
  studentUid: string,
  checks: Record<string, boolean>,
  studentEmail?: string,
  weeklyNativeLessonsTarget?: number,
  weeklyStudyDaysTarget?: number,
  week?: string | number | null,
  isNewWeekReset?: boolean
): Promise<boolean> {
  const cleanEmail = (studentEmail || '').toLowerCase().trim();
  const cleanUid = normalizeUid(studentUid, cleanEmail);

  if (!cleanUid && !cleanEmail) return false;

  try {
    const sanitizedChecks: Record<string, boolean> = JSON.parse(JSON.stringify(checks || {}));

    const isChecksEmpty = Object.keys(sanitizedChecks).length === 0;
    const hasGoals =
      (typeof weeklyNativeLessonsTarget === 'number' && weeklyNativeLessonsTarget > 0) ||
      (typeof weeklyStudyDaysTarget === 'number' && weeklyStudyDaysTarget >= 1 && weeklyStudyDaysTarget <= 7);
    if (isChecksEmpty && !isNewWeekReset && !hasGoals) {
      // Guard against race conditions and empty overwrites: do not wipe persisted checks without explicit new week reset
      return true;
    }

    const isCurrentWeekAlias =
      week === undefined ||
      week === null ||
      (typeof week === 'string' && (week.trim() === '' || week.trim().toLowerCase() === 'current_week'));

    let targetWeekId = isCurrentWeekAlias ? 'current_week' : normalizeWeekId(week);
    let targetCycle = isCurrentWeekAlias ? null : parseWeekCycleNumber(week);

    if (!isCurrentWeekAlias && (!targetWeekId || !targetCycle)) {
      console.warn(`[studentPersistence] saveStudentWeeklyChecksToFirestore: Invalid week identifier '${week}'.`);
      return false;
    }

    // In-memory cache fallback as baseline when weekId is explicit
    const localCached = targetWeekId !== 'current_week' ? getCachedWeeklyChecks(cleanUid, cleanEmail, targetWeekId!) : {};
    const mergedChecks: Record<string, boolean> = isNewWeekReset
      ? sanitizedChecks
      : {
          ...localCached,
          ...sanitizedChecks,
        };

    const token = await getAccessToken().catch(() => null);
    if (typeof window !== 'undefined' && !token) {
      console.warn('[studentPersistence] saveStudentWeeklyChecksToFirestore: missing Firebase ID token.');
      return false;
    }
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const canonicalUid = auth?.currentUser?.uid || cleanUid;
    const currentAuthEmail = (auth?.currentUser?.email || '').toLowerCase().trim();
    const safeStudentEmail = (cleanEmail && cleanEmail.includes('@') && (!currentAuthEmail || currentAuthEmail === cleanEmail)) ? cleanEmail : undefined;

    const payload: Record<string, any> = {
      studentUid: canonicalUid,
      ...(safeStudentEmail ? { studentEmail: safeStudentEmail } : {}),
      checks: mergedChecks,
      merge: !isNewWeekReset,
      reset: isNewWeekReset,
      weekId: targetWeekId,
      ...(targetCycle ? { weeklyCycle: targetCycle } : {}),
      weeklyNativeLessonsTarget,
      weeklyStudyDaysTarget,
    };

    const res = await fetch('/api/routines/weekly-checks', {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      console.error(`[studentPersistence] saveStudentWeeklyChecksToFirestore failed: HTTP ${res.status}`);
      return false;
    }

    const resData = await res.json().catch(() => null);
    if (!resData || resData.success === false) {
      console.error('[studentPersistence] saveStudentWeeklyChecksToFirestore server rejected:', resData);
      return false;
    }

    const confirmedWeekId = resData.weekId || (targetWeekId !== 'current_week' ? targetWeekId : 'week-1');
    const confirmedChecks = resData.checks || mergedChecks;
    cacheWeeklyChecksLocally(canonicalUid, cleanEmail, confirmedChecks, confirmedWeekId);

    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(
        new CustomEvent('its-simple:weekly-checks-updated', {
          detail: {
            studentUid: canonicalUid,
            weekId: confirmedWeekId,
            weeklyCycle: resData.weeklyCycle || targetCycle,
            checks: confirmedChecks,
            weeklyNativeLessonsTarget: resData.weeklyNativeLessonsTarget,
            weeklyStudyDaysTarget: resData.weeklyStudyDaysTarget,
          },
        })
      );
    }

    return true;
  } catch (error) {
    console.error(`[studentPersistence] saveStudentWeeklyChecksToFirestore error for ${cleanUid}:`, error);
    return false;
  }
}

/**
 * Persists the completion status of the Weekly Memorization Activity directly and permanently
 * to Firestore under users/{cleanUid}/weeklyChecks/week-${cycle} and users/{cleanUid}/memorization/{day}.
 * Writes:
 * 1. users/{cleanUid}/weeklyChecks/week-${cycle} (fields: checks, weeklyChecks, sPathChecks)
 * 2. users/{cleanUid}/memorization/{day} subcollection document ({ day, completed: isCompleted, completedAt: ISO, updatedAt: ISO })
 * 3. users/{cleanUid}/homework/{weekId} subcollection document ({ completedPartsByDay: { [day]: isCompleted }, isDayPartCompleted: isCompleted })
 * 4. users/{cleanUid}/studentJournal/memorization_{day}_{weekId} subcollection document & journal entry
 * 5. Mirrors to server API and week-scoped in-memory session cache
 */
export async function saveMemorizationCompletionToFirestore(
  studentUid: string,
  studentEmail: string | undefined,
  day: DayOfWeek,
  isCompleted: boolean = true,
  homeworkData?: WeeklyHomeworkData,
  weekId: string = 'current_week'
): Promise<boolean> {
  const cleanEmail = (studentEmail || '').toLowerCase().trim();
  const cleanUid = normalizeUid(studentUid, cleanEmail);

  if (!day || (!cleanUid && !cleanEmail)) return false;

  const checkKey = `memorization_${day}`;

  // 1. Resolve canonical week BEFORE performing any related persistence operation.
  const isCurrentWeekAlias = !weekId || weekId === 'current_week' || (typeof weekId === 'string' && weekId.trim() === '');
  let targetCycle: number | null = parseWeekCycleNumber(isCurrentWeekAlias ? homeworkData?.weeklyCycle : weekId);
  let targetWeekId: string | null = targetCycle !== null ? `week-${targetCycle}` : (isCurrentWeekAlias ? 'current_week' : null);

  if (!targetWeekId) {
    console.warn(
      `[studentPersistence] saveMemorizationCompletionToFirestore: Failed to resolve canonical week for student ${cleanUid} (weekId: '${weekId}'). Aborting safely.`
    );
    return false;
  }

  try {
    const token = await getAccessToken().catch(() => null);
    if (typeof window !== 'undefined' && !token) {
      console.warn('[studentPersistence] saveMemorizationCompletionToFirestore: missing Firebase ID token.');
      return false;
    }
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const canonicalUid = auth?.currentUser?.uid || cleanUid;
    const currentAuthEmail = (auth?.currentUser?.email || '').toLowerCase().trim();
    const safeStudentEmail = (cleanEmail && cleanEmail.includes('@') && (!currentAuthEmail || currentAuthEmail === cleanEmail)) ? cleanEmail : undefined;

    // 2a. S-Path weekly checks endpoint
    const weeklyChecksRes = await fetch('/api/routines/weekly-checks', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        studentUid: canonicalUid,
        ...(safeStudentEmail ? { studentEmail: safeStudentEmail } : {}),
        checks: { [checkKey]: isCompleted },
        merge: true,
        weekId: targetWeekId,
        ...(targetCycle !== null ? { weeklyCycle: targetCycle } : {}),
      }),
    });

    if (!weeklyChecksRes.ok) {
      console.error(`[studentPersistence] saveMemorizationCompletionToFirestore: weekly-checks failed HTTP ${weeklyChecksRes.status}`);
      return false;
    }

    const checksData = await weeklyChecksRes.json().catch(() => null);
    if (!checksData || checksData.success === false) {
      console.error('[studentPersistence] saveMemorizationCompletionToFirestore: weekly-checks server rejected:', checksData);
      return false;
    }

    const resolvedCycle = checksData.weeklyCycle || targetCycle || 1;
    const resolvedWeekId = checksData.weekId || (targetWeekId !== 'current_week' ? targetWeekId : `week-${resolvedCycle}`);

    // 2b. Homework completion endpoint
    const hwRes = await fetch('/api/homework', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        uid: canonicalUid,
        studentUid: canonicalUid,
        ...(safeStudentEmail ? { studentEmail: safeStudentEmail } : {}),
        weekId: resolvedWeekId,
        weeklyCycle: resolvedCycle,
        weeklyHomework: {
          completedPartsByDay: { [day]: isCompleted },
          isDayPartCompleted: isCompleted,
        },
      }),
    });

    if (!hwRes.ok) {
      console.error(`[studentPersistence] saveMemorizationCompletionToFirestore: homework failed HTTP ${hwRes.status}`);
      return false;
    }

    const hwData = await hwRes.json().catch(() => null);
    if (!hwData || hwData.success === false) {
      console.error('[studentPersistence] saveMemorizationCompletionToFirestore: homework server rejected:', hwData);
      return false;
    }

    // 2c. Multi-device studentJournal activity log
    const journalEntryId = `memorization_${day}_${resolvedCycle}`;
    const journalEntry: StudentJournalEntry = {
      id: journalEntryId,
      type: 'memorization',
      date: getDateForDayInCurrentWeek(day),
      dayOfWeek: day,
      week: resolvedCycle,
      timestamp: Date.now(),
      title: 'Weekly Memorization Activity',
      details: `Completed Memorization for ${day}`,
      studentUid: canonicalUid,
      studentEmail: cleanEmail,
    };

    fetch('/api/student-journal/activity', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        studentUid: canonicalUid,
        ...(safeStudentEmail ? { studentEmail: safeStudentEmail } : {}),
        entry: journalEntry,
      }),
    }).catch(() => {});

    // Update in-memory session cache scoped to resolvedWeekId upon confirmed persistence
    const currentCached = getCachedWeeklyChecks(canonicalUid, cleanEmail, resolvedWeekId);
    const updatedChecks = checksData.checks || { ...currentCached, [checkKey]: isCompleted };
    cacheWeeklyChecksLocally(canonicalUid, cleanEmail, updatedChecks, resolvedWeekId);

    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(
        new CustomEvent('its-simple:weekly-checks-updated', {
          detail: {
            studentUid: canonicalUid,
            weekId: resolvedWeekId,
            weeklyCycle: resolvedCycle,
            checks: updatedChecks,
          },
        })
      );
      if (hwData.weeklyHomework) {
        window.dispatchEvent(
          new CustomEvent('its-simple:homework-updated', {
            detail: {
              studentUid: canonicalUid,
              weekId: resolvedWeekId,
              weeklyCycle: resolvedCycle,
              homework: hwData.weeklyHomework,
            },
          })
        );
      }
    }

    return true;
  } catch (err) {
    console.error('[studentPersistence] saveMemorizationCompletionToFirestore error:', err);
    return false;
  }
}

/**
 * Fetch student S-Path (Gráfico S) weekly checks directly from Firestore.
 * Scoped to users/{studentUID}/weeklyChecks/week-${cycle}.
 * Backward compatibility:
 * - If Week 1 requested and week-1 document does not exist yet, falls back to legacy root document users/{studentUID}.
 * - If Week 2+ requested, strictly reads from users/{studentUID}/weeklyChecks/week-${cycle} and never falls back to root checks or homework/current_week.
 * - If week identity is unknown, refuses to silently default to Week 1.
 */
export async function fetchStudentWeeklyChecksFromFirestore(
  studentUid: string,
  studentEmail?: string,
  week?: string | number | null
): Promise<{
  checks: Record<string, boolean>;
  weeklyNativeLessonsTarget?: number;
  weeklyStudyDaysTarget?: number;
  weekId?: string;
  weeklyCycle?: number;
}> {
  const cleanEmail = (studentEmail || '').toLowerCase().trim();
  const cleanUid = normalizeUid(studentUid, cleanEmail);

  const isCurrentWeekAlias =
    week === undefined ||
    week === null ||
    (typeof week === 'string' && (week.trim() === '' || week.trim().toLowerCase() === 'current_week'));

  const targetWeekId = isCurrentWeekAlias ? 'current_week' : normalizeWeekId(week);
  const targetCycle = isCurrentWeekAlias ? null : parseWeekCycleNumber(week);

  if (!isCurrentWeekAlias && (!targetWeekId || !targetCycle)) {
    console.warn(
      `[studentPersistence] fetchStudentWeeklyChecksFromFirestore: Invalid week parameter '${week}' for ${cleanUid}. Refusing to default to Week 1.`
    );
    return { checks: {} };
  }

  if (!cleanUid && !cleanEmail) {
    return { checks: {} };
  }

  const localCached = targetWeekId !== 'current_week' ? getCachedWeeklyChecks(cleanUid, cleanEmail, targetWeekId!) : {};

  try {
    const token = await getAccessToken().catch(() => null);
    if (typeof window !== 'undefined' && !token) {
      return { checks: localCached };
    }

    const canonicalUid = auth?.currentUser?.uid || cleanUid;
    const currentAuthEmail = (auth?.currentUser?.email || '').toLowerCase().trim();
    const safeStudentEmail = (cleanEmail && cleanEmail.includes('@') && (!currentAuthEmail || currentAuthEmail === cleanEmail)) ? cleanEmail : '';

    const qParams = new URLSearchParams();
    if (canonicalUid) qParams.append('studentUid', canonicalUid);
    if (safeStudentEmail) qParams.append('studentEmail', safeStudentEmail);
    if (targetCycle) qParams.append('weeklyCycle', String(targetCycle));
    if (targetWeekId) qParams.append('weekId', targetWeekId);

    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const serverRes = await fetch(`/api/routines/weekly-checks?${qParams.toString()}`, { headers });
    if (serverRes.ok) {
      const sData = await serverRes.json().catch(() => null);
      if (sData && sData.success) {
        const resolvedWeekId = sData.weekId || (targetWeekId !== 'current_week' ? targetWeekId : undefined);
        const resolvedCycle = sData.weeklyCycle || targetCycle || undefined;
        const sChecks = sData.checks || {};
        const combinedChecks = { ...localCached, ...sChecks };
        if (resolvedWeekId) {
          cacheWeeklyChecksLocally(canonicalUid || cleanUid, cleanEmail, combinedChecks, resolvedWeekId);
        }
        return {
          checks: combinedChecks,
          weeklyNativeLessonsTarget: typeof sData.weeklyNativeLessonsTarget === 'number' && sData.weeklyNativeLessonsTarget > 0 ? sData.weeklyNativeLessonsTarget : undefined,
          weeklyStudyDaysTarget: typeof sData.weeklyStudyDaysTarget === 'number' && sData.weeklyStudyDaysTarget > 0 ? sData.weeklyStudyDaysTarget : undefined,
          weekId: resolvedWeekId,
          weeklyCycle: resolvedCycle,
        };
      }
    }
  } catch (serverErr) {
    console.warn('[studentPersistence] Notice fetching weeklyChecks from server API:', serverErr);
  }

  return {
    checks: localCached,
    weekId: targetWeekId !== 'current_week' ? targetWeekId! : undefined,
    weeklyCycle: targetCycle ?? undefined,
  };
}

/**
 * Helper to get the current date in YYYY-MM-DD format
 */
export function getTodayIsoDate(): string {
  return new Date().toISOString().split('T')[0];
}

/**
 * Calculates the calendar date (YYYY-MM-DD) for a specific day of the week in the current week,
 * respecting the application timezone.
 */
export function getDateForDayInCurrentWeek(
  targetDay: DayOfWeek,
  refDate: Date = new Date(),
  timeZone: string = DEFAULT_STUDENT_TIMEZONE
): string {
  return getDateForDayInCurrentWeekTz(targetDay, refDate, timeZone);
}


/**
 * Maps a routine row stepId to its corresponding StudentJournalActivityType
 */
export function mapStepIdToJournalType(
  stepId: 'video_day' | 'audio_day' | 'tutor_live' | 'memorization' | string
): StudentJournalActivityType {
  switch (stepId) {
    case 'video_day':
    case 'video':
      return 'video';
    case 'audio_day':
    case 'audio':
      return 'audio';
    case 'tutor_live':
    case 'lesson':
    case 'live_lesson':
      return 'lesson';
    case 'memorization':
      return 'memorization';
    default:
      return 'video';
  }
}

/**
 * Maps StudentJournalActivityType to routine stepId
 */
export function mapJournalTypeToStepId(
  type: StudentJournalActivityType | string
): 'video_day' | 'audio_day' | 'tutor_live' | 'memorization' | null {
  switch (type) {
    case 'video':
    case 'video_day':
      return 'video_day';
    case 'audio':
    case 'audio_day':
      return 'audio_day';
    case 'lesson':
    case 'live_lesson':
    case 'tutor_live':
      return 'tutor_live';
    case 'memorization':
    case 'homework':
      return 'memorization';
    case 'sentence':
    case 'daily_sentence':
      return null;
    default:
      return null;
  }
}

/**
 * Derives the weeklyChecks map (e.g. video_day_thursday: true) from studentJournal records for the given week.
 */
export function deriveWeeklyChecksFromJournal(
  journal: StudentJournalEntry[],
  targetWeek?: number
): Record<string, boolean> {
  const checks: Record<string, boolean> = {};
  if (!Array.isArray(journal)) return checks;

  journal.forEach((entry) => {
    if (!entry || !entry.type) return;
    if (entry.type === 'sentence' || (entry as any).type === 'daily_sentence') return;
    if (targetWeek !== undefined) {
      const entryCycle = parseWeekCycleNumber(entry.week);
      if (entryCycle !== null) {
        if (entryCycle !== Number(targetWeek)) return;
      } else if (Number(targetWeek) !== 1) {
        // Unversioned legacy entries strictly belong to Week 1 and never leak to Week 2+
        return;
      }
    }
    const stepId = mapJournalTypeToStepId(entry.type);
    if (stepId && stepId !== 'tutor_live' && entry.dayOfWeek) {
      checks[`${stepId}_${entry.dayOfWeek.toLowerCase()}`] = true;
    }
  });

  return checks;
}

/**
 * Recursively eliminates undefined properties from an object or array.
 * Ensures Firestore setDoc never encounters unsupported undefined values.
 */
export function eliminateUndefinedFields<T>(obj: T): T {
  if (obj === null || obj === undefined || typeof obj !== 'object') {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => eliminateUndefinedFields(item)) as unknown as T;
  }
  const result: Record<string, any> = {};
  for (const [key, val] of Object.entries(obj)) {
    if (val !== undefined) {
      result[key] = eliminateUndefinedFields(val);
    }
  }
  return result as T;
}

/**
 * Persist an activity record directly to the student profile document: users/{studentUID}
 * Maintains an array and subcollection `studentJournal`.
 * Each completed activity record saves: { id, type, date, week, timestamp, dayOfWeek, ... }
 */
export async function recordActivityInStudentJournal(
  studentUid: string,
  entry: StudentJournalEntry,
  studentEmail?: string
): Promise<{ success: boolean; updatedJournal: StudentJournalEntry[] }> {
  const db = getDb();
  const cleanUid = normalizeUid(studentUid, studentEmail);
  const cleanEmail = (studentEmail || '').toLowerCase().trim();

  try {
    let existingJournal: StudentJournalEntry[] = [];
    let userData: any = null;
    let userRef: any = null;

    // 1. Fetch current user document to resolve data and weeklyCycle
    if (db && cleanUid) {
      userRef = doc(db, 'users', cleanUid);
      const userSnap = await withFirestoreTimeout(getDoc(userRef), 2000, null);
      if (userSnap && userSnap.exists()) {
        userData = userSnap.data();
        if (Array.isArray(userData?.studentJournal)) {
          existingJournal = userData.studentJournal;
        }
      }
    }

    // 2. Strict week identity resolution:
    // First resolve an explicitly supplied valid week.
    // If the week is missing, resolve it from the student's persisted weeklyCycle.
    // If an explicitly supplied week is malformed, reject it rather than silently replacing it.
    // If no valid week can be determined, do not write or remove weekly completion checks.
    // Never substitute Week 1 automatically.
    const isExplicitWeekSupplied = entry.week !== undefined && entry.week !== null && (typeof entry.week !== 'string' || (entry.week as string).trim() !== '');

    let resolvedWeek: number | null = null;
    if (isExplicitWeekSupplied) {
      resolvedWeek = parseWeekCycleNumber(entry.week);
      if (resolvedWeek === null) {
        // Explicit week is malformed: reject rather than silently replacing
        console.warn(
          `[studentPersistence] recordActivityInStudentJournal: Explicit week '${entry.week}' is malformed. Rejecting operation without substituting Week 1 or weeklyCycle.`
        );
        return { success: false, updatedJournal: existingJournal };
      }
    } else {
      // Week is missing: resolve from student's persisted weeklyCycle
      resolvedWeek = parseWeekCycleNumber(userData?.weeklyCycle) ?? 1;
    }

    if (!resolvedWeek) {
      resolvedWeek = 1;
    }

    const sanitizedEntry: StudentJournalEntry = {
      id: String(
        entry.id && !entry.id.startsWith('video_') && !entry.id.startsWith('audio_') && !entry.id.startsWith('memorization_')
          ? `${entry.type}_${entry.dayOfWeek || 'any'}_${resolvedWeek}_${entry.id}`
          : (entry.id || `${entry.type}_${entry.dayOfWeek || 'any'}_${Date.now()}`)
      ).trim(),
      type: entry.type,
      date: entry.date || getTodayIsoDate(),
      timestamp: Number(entry.timestamp) || Date.now(),
      studentUid: cleanUid,
      ...(entry.dayOfWeek ? { dayOfWeek: entry.dayOfWeek } : {}),
      ...(cleanEmail ? { studentEmail: cleanEmail } : {}),
      week: resolvedWeek,
    };

    if (entry.title) sanitizedEntry.title = String(entry.title).trim();
    if (entry.artist) sanitizedEntry.artist = String(entry.artist).trim();
    if (entry.partNumber !== undefined && entry.partNumber !== null) sanitizedEntry.partNumber = Number(entry.partNumber);
    if (entry.url) sanitizedEntry.url = String(entry.url).trim();
    if (entry.details) sanitizedEntry.details = String(entry.details).trim();
    if ((entry as any).completedAt) (sanitizedEntry as any).completedAt = (entry as any).completedAt;

    if (db && cleanUid && userRef) {
      // Check if entry for same type + dayOfWeek + week already exists, or same id
      const filtered = existingJournal.filter((e) => {
        if (!e) return false;
        if (e.id && e.id === sanitizedEntry.id) return false;
        if (
          e.type === sanitizedEntry.type &&
          e.week === sanitizedEntry.week &&
          e.dayOfWeek &&
          sanitizedEntry.dayOfWeek &&
          e.dayOfWeek.toLowerCase() === sanitizedEntry.dayOfWeek.toLowerCase()
        ) {
          return false;
        }
        return true;
      });

      const updatedJournal = [sanitizedEntry, ...filtered];

      // Prepare updated weeklyChecks and watched/listened arrays for complete cross-compatibility
      const stepId = mapJournalTypeToStepId(sanitizedEntry.type);
      const checkKey = stepId && stepId !== 'tutor_live' && sanitizedEntry.dayOfWeek ? `${stepId}_${sanitizedEntry.dayOfWeek.toLowerCase()}` : null;
      const currentChecks = userData?.weeklyChecks || {};
      const updatedChecks = checkKey ? { ...currentChecks, [checkKey]: true } : currentChecks;

      const entryCycle = resolvedWeek;
      const targetWeekId = `week-${entryCycle}`;

      // Update week-specific weeklyChecks document users/{cleanUid}/weeklyChecks/{targetWeekId}
      if (checkKey) {
        try {
          const weekDocRef = doc(db, 'users', cleanUid, 'weeklyChecks', targetWeekId);
          let existingWeekChecks: Record<string, boolean> = {};
          const wSnap = await withFirestoreTimeout(getDoc(weekDocRef), 1500, null);
          if (wSnap && wSnap.exists()) {
            const wData = wSnap.data();
            existingWeekChecks = {
              ...(wData?.checks || {}),
              ...(wData?.weeklyChecks || {}),
              ...(wData?.sPathChecks || {}),
            };
          } else {
            existingWeekChecks = { ...(currentChecks || {}) };
          }

          const updatedWeekChecks = {
            ...existingWeekChecks,
            [checkKey]: true,
          };

          const cleanWeekChecksPayload = eliminateUndefinedFields(
            stampSchemaVersion({
              id: targetWeekId,
              weekId: targetWeekId,
              weeklyCycle: entryCycle,
              checks: updatedWeekChecks,
              weeklyChecks: updatedWeekChecks,
              sPathChecks: updatedWeekChecks,
              updatedAt: new Date().toISOString(),
              studentUid: cleanUid,
              studentEmail: cleanEmail || null,
            })
          );

          await withFirestoreTimeout(
            setDoc(weekDocRef, cleanWeekChecksPayload, { merge: true }),
            2000,
            null
          );

          cacheWeeklyChecksLocally(cleanUid, cleanEmail, updatedWeekChecks, targetWeekId);
        } catch (weekErr) {
          console.warn(`Notice updating weekDoc for ${targetWeekId}:`, weekErr);
        }
      }

      const payload: Record<string, any> = {
        studentJournal: updatedJournal,
        updatedAt: new Date().toISOString(),
        weeklyChecks: updatedChecks,
        sPathChecks: updatedChecks,
      };

      if (sanitizedEntry.type === 'video' && sanitizedEntry.id) {
        const curWatched = userData?.watchedVideosHistory || [];
        if (!curWatched.includes(sanitizedEntry.id)) {
          payload.watchedVideosHistory = [...curWatched, sanitizedEntry.id];
        }
      } else if (sanitizedEntry.type === 'audio' && sanitizedEntry.id) {
        const curListened = userData?.listenedTracksHistory || [];
        const exists = curListened.some((t: any) =>
          typeof t === 'string' ? t === sanitizedEntry.id : t?.id === sanitizedEntry.id || t?.trackId === sanitizedEntry.id
        );
        if (!exists) {
          payload.listenedTracksHistory = [
            ...curListened,
            { id: sanitizedEntry.id, trackId: sanitizedEntry.id, title: sanitizedEntry.title || '', artist: sanitizedEntry.artist || '' },
          ];
        }
      }

      const cleanUserPayload = eliminateUndefinedFields(payload);
      const cleanSanitizedEntry = eliminateUndefinedFields(sanitizedEntry);

      // Direct write to users/{cleanUid} with safe fallback
      if (cleanUid && isValidCanonicalUid(cleanUid) && userRef) {
        try {
          await withFirestoreTimeout(setDoc(userRef, cleanUserPayload, { merge: true }), 3500, null);

          // Write discrete entry to subcollection users/{cleanUid}/studentJournal/{entryId}
          const entryRef = doc(db, 'users', cleanUid, 'studentJournal', cleanSanitizedEntry.id);
          await withFirestoreTimeout(setDoc(entryRef, cleanSanitizedEntry, { merge: true }), 2000, null);
        } catch (fsErr) {
          console.warn('[studentPersistence] Firestore journal direct write notice:', fsErr);
        }
      }

      // Mirror to server backend API
      try {
        fetch('/api/student-journal/activity', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            studentUid: cleanUid,
            studentEmail: cleanEmail,
            entry: sanitizedEntry,
          }),
        }).catch(() => {});
      } catch {}

      return { success: true, updatedJournal };
    }

    return { success: false, updatedJournal: existingJournal };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `users/${cleanUid}/studentJournal`);
    return { success: false, updatedJournal: [] };
  }
}

/**
 * Remove an activity record from studentJournal (e.g. when unchecking an activity circle)
 */
export async function removeActivityFromStudentJournal(
  studentUid: string,
  type: StudentJournalActivityType,
  dayOfWeek: DayOfWeek,
  week?: number | string | null,
  studentEmail?: string
): Promise<{ success: boolean; updatedJournal: StudentJournalEntry[] }> {
  const db = getDb();
  const cleanEmail = (studentEmail || '').toLowerCase().trim();
  const cleanUid = normalizeUid(studentUid, cleanEmail);

  try {
    let updatedJournal: StudentJournalEntry[] = [];
    if (db && cleanUid) {
      const userRef = doc(db, 'users', cleanUid);
      const userSnap = await withFirestoreTimeout(getDoc(userRef), 2000, null);
      if (userSnap && userSnap.exists()) {
        const data = userSnap.data();
        const curJournal: StudentJournalEntry[] = Array.isArray(data?.studentJournal) ? data.studentJournal : [];

        // Strict week identity resolution:
        // First resolve an explicitly supplied valid week.
        // If the week is missing, resolve it from the student's persisted weeklyCycle.
        // If an explicitly supplied week is malformed, reject it rather than silently replacing it.
        // If no valid week can be determined, do not write or remove weekly completion checks.
        // Never substitute Week 1 automatically.
        const isExplicitWeekSupplied = week !== undefined && week !== null && (typeof week !== 'string' || (week as string).trim() !== '');

        let resolvedCycle: number | null = null;
        if (isExplicitWeekSupplied) {
          resolvedCycle = parseWeekCycleNumber(week);
          if (resolvedCycle === null) {
            // Explicitly supplied week is malformed: reject rather than silently replacing
            console.warn(
              `[studentPersistence] removeActivityFromStudentJournal: Explicit week '${week}' is malformed. Rejecting operation without substituting Week 1 or weeklyCycle.`
            );
            return { success: false, updatedJournal: curJournal };
          }
        } else {
          // Week is missing: resolve from student's persisted weeklyCycle
          resolvedCycle = parseWeekCycleNumber(data?.weeklyCycle);
        }

        if (!resolvedCycle) {
          console.warn(
            `[studentPersistence] removeActivityFromStudentJournal: Week identity cannot be determined for student ${cleanUid}. Refusing to remove weekly completion checks or default to Week 1.`
          );
          return { success: false, updatedJournal: curJournal };
        }

        const targetCycle = resolvedCycle;
        const targetWeekId = `week-${targetCycle}`;

        const toDelete: StudentJournalEntry[] = [];
        updatedJournal = curJournal.filter((e) => {
          if (e.type === type && e.week === targetCycle && e.dayOfWeek === dayOfWeek) {
            toDelete.push(e);
            return false;
          }
          return true;
        });

        const stepId = mapJournalTypeToStepId(type);
        const checkKey = stepId && dayOfWeek ? `${stepId}_${dayOfWeek}` : null;
        const curChecks = data.weeklyChecks || {};
        const updatedChecks = checkKey ? { ...curChecks, [checkKey]: false } : curChecks;

        // Update week-specific weeklyChecks document
        try {
          const weekDocRef = doc(db, 'users', cleanUid, 'weeklyChecks', targetWeekId);
          let existingWeekChecks: Record<string, boolean> = {};
          const wSnap = await withFirestoreTimeout(getDoc(weekDocRef), 1500, null);
          if (wSnap && wSnap.exists()) {
            const wData = wSnap.data();
            existingWeekChecks = {
              ...(wData?.checks || {}),
              ...(wData?.weeklyChecks || {}),
              ...(wData?.sPathChecks || {}),
            };
          }
          const updatedWeekChecks = checkKey
            ? {
                ...existingWeekChecks,
                [checkKey]: false,
              }
            : existingWeekChecks;
          await withFirestoreTimeout(
            setDoc(
              weekDocRef,
              stampSchemaVersion({
                id: targetWeekId,
                weekId: targetWeekId,
                weeklyCycle: targetCycle,
                checks: updatedWeekChecks,
                weeklyChecks: updatedWeekChecks,
                sPathChecks: updatedWeekChecks,
                updatedAt: new Date().toISOString(),
                studentUid: cleanUid,
                studentEmail: cleanEmail || null,
              }),
              { merge: true }
            ),
            2000,
            null
          );
          cacheWeeklyChecksLocally(cleanUid, cleanEmail, updatedWeekChecks, targetWeekId);
        } catch (weekErr) {
          console.warn(`Notice updating weekDoc in removeActivity:`, weekErr);
        }

        const payload: Record<string, any> = {
          studentJournal: updatedJournal,
          updatedAt: new Date().toISOString(),
        };

        // Only update legacy root weeklyChecks for Week 1 (backward compatibility)
        if (targetCycle === 1) {
          payload.weeklyChecks = updatedChecks;
          payload.sPathChecks = updatedChecks;
        }

        await withFirestoreTimeout(setDoc(userRef, payload, { merge: true }), 3000, null);

        // Delete from subcollection
        for (const item of toDelete) {
          if (item?.id) {
            const subRef = doc(db, 'users', cleanUid, 'studentJournal', item.id);
            await withFirestoreTimeout(deleteDoc(subRef), 1500, null);
          }
        }

        // Mirror delete to server
        fetch('/api/student-journal/activity', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            studentUid: cleanUid,
            studentEmail: cleanEmail,
            type,
            dayOfWeek,
            week: targetCycle,
          }),
        }).catch(() => {});

        return { success: true, updatedJournal };
      }
    }
    return { success: false, updatedJournal: [] };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `users/${cleanUid}/studentJournal/remove`);
    return { success: false, updatedJournal: [] };
  }
}

/**
 * Fetch the complete studentJournal array from Firestore users/{studentUID}
 */
export async function fetchStudentJournalActivitiesFromFirestore(
  studentUid: string,
  studentEmail?: string
): Promise<StudentJournalEntry[]> {
  const db = getDb();
  const cleanEmail = (studentEmail || '').toLowerCase().trim();
  const cleanUid = normalizeUid(studentUid, cleanEmail);
  if (!db || !cleanUid) return [];

  try {
    const journalMap = new Map<string, StudentJournalEntry>();

    // 1. Direct fetch from users/{cleanUid} document
    const userRef = doc(db, 'users', cleanUid);
    const userSnap = await withFirestoreTimeout(getDoc(userRef), 2500, null);
    if (userSnap && userSnap.exists()) {
      const data = userSnap.data();
      if (Array.isArray(data?.studentJournal)) {
        data.studentJournal.forEach((entry: StudentJournalEntry) => {
          if (entry && entry.id) journalMap.set(entry.id, entry);
        });
      }
    }

    // 2. Fetch from subcollection users/{cleanUid}/studentJournal
    const subColRef = collection(db, 'users', cleanUid, 'studentJournal');
    const subSnap = await withFirestoreTimeout(getDocs(subColRef), 2000, null);
    if (subSnap && !subSnap.empty) {
      subSnap.forEach((d) => {
        const entry = d.data() as StudentJournalEntry;
        if (entry && entry.id && !journalMap.has(entry.id)) {
          journalMap.set(entry.id, entry);
        }
      });
    }

    // 3. Fallback: check legacy email doc if different and migrate
    if (journalMap.size === 0 && cleanEmail) {
      const legacyDocId = `usr-${cleanEmail.replace(/[^a-zA-Z0-9]/g, '-')}`;
      if (legacyDocId !== cleanUid) {
        const altRef = doc(db, 'users', legacyDocId);
        const altSnap = await withFirestoreTimeout(getDoc(altRef), 2000, null);
        if (altSnap && altSnap.exists()) {
          const altData = altSnap.data();
          if (Array.isArray(altData?.studentJournal)) {
            altData.studentJournal.forEach((entry: StudentJournalEntry) => {
              if (entry && entry.id) journalMap.set(entry.id, entry);
            });
            // Migrate to cleanUid
            if (journalMap.size > 0 && cleanUid) {
              setDoc(doc(db, 'users', cleanUid), {
                studentJournal: Array.from(journalMap.values()),
                updatedAt: new Date().toISOString(),
              }, { merge: true }).catch(() => {});
            }
          }
        }
      }
    }

    // 4. Server API fallback if still empty
    if (journalMap.size === 0 && (cleanEmail || cleanUid)) {
      try {
        const res = await fetch(
          `/api/student-journal/activity?studentEmail=${encodeURIComponent(cleanEmail)}&studentUid=${encodeURIComponent(cleanUid)}`
        );
        if (res.ok) {
          const apiData = await res.json();
          if (Array.isArray(apiData?.entries)) {
            apiData.entries.forEach((e: StudentJournalEntry) => {
              if (e && e.id) journalMap.set(e.id, e);
            });
          }
        }
      } catch {}
    }

    const list = Array.from(journalMap.values());
    list.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    return list;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `users/${cleanUid}/studentJournal`);
    return [];
  }
}

/**
 * Real-time subscription to studentJournal on users/{studentUID}
 * Ensures instantaneous cross-device synchronization between mobile and desktop!
 */
export function subscribeToStudentJournal(
  studentUid: string,
  studentEmail: string | undefined,
  callback: (journal: StudentJournalEntry[]) => void
): () => void {
  const db = getDb();
  const cleanUid = normalizeUid(studentUid, studentEmail);
  if (!db || !cleanUid) {
    return () => {};
  }

  const userRef = doc(db, 'users', cleanUid);
  const unsubscribe = onSnapshot(
    userRef,
    (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        if (Array.isArray(data?.studentJournal)) {
          const entries = [...data.studentJournal];
          entries.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
          callback(entries);
        }
      }
    },
    (err) => {
      console.warn('Real-time notice for studentJournal listener:', err);
    }
  );

  return unsubscribe;
}

/**
 * Merges dailyActivities per-day ensuring that student answers, evaluations,
 * and exercise question lists (matchingPairs, fillInBlanks, sentenceWritingPrompts, readingPassage)
 * are never wiped or overwritten with empty arrays.
 */
export function mergeDailyActivities(
  fallbackDays: Record<string, DailyHomeworkActivity> = {},
  primaryDays: Record<string, DailyHomeworkActivity> = {},
  customWords?: Array<Partial<any> & { word: string }>
): Record<string, DailyHomeworkActivity> {
  const result: Record<string, DailyHomeworkActivity> = { ...(fallbackDays || {}) };

  for (const [dayKey, primaryAct] of Object.entries(primaryDays || {})) {
    if (!primaryAct) continue;
    const fallbackAct = result[dayKey];
    if (!fallbackAct) {
      result[dayKey] = primaryAct;
      continue;
    }

    let selectedWords =
      Array.isArray(primaryAct.selectedWords) && primaryAct.selectedWords.length > 0
        ? primaryAct.selectedWords
        : Array.isArray(fallbackAct.selectedWords) && fallbackAct.selectedWords.length > 0
        ? fallbackAct.selectedWords
        : [];

    if (selectedWords.length === 0 && Array.isArray(customWords) && customWords.length > 0) {
      selectedWords = resolveDailyMemorizationVocabulary({
        targetDay: dayKey as any,
        activityDate: getDateForDayInCurrentWeekTz(dayKey as any),
        customWords: customWords as any,
        studentUid: primaryAct.studentUid || fallbackAct.studentUid,
      });
    }

    const wordOrigins =
      Array.isArray(primaryAct.wordOrigins) && primaryAct.wordOrigins.length > 0
        ? primaryAct.wordOrigins
        : fallbackAct.wordOrigins || [];

    const matchingPairs =
      Array.isArray(primaryAct.matchingPairs) && primaryAct.matchingPairs.length > 0
        ? primaryAct.matchingPairs
        : Array.isArray(fallbackAct.matchingPairs) && fallbackAct.matchingPairs.length > 0
        ? fallbackAct.matchingPairs
        : selectedWords.map((v, idx) => ({
            id: `pair-${idx + 1}`,
            word: v.word,
            definition: v.definitionEn,
            translation: v.translationPt,
          }));

    const fillInBlanks =
      Array.isArray(primaryAct.fillInBlanks) && primaryAct.fillInBlanks.length > 0
        ? primaryAct.fillInBlanks
        : Array.isArray(fallbackAct.fillInBlanks) && fallbackAct.fillInBlanks.length > 0
        ? fallbackAct.fillInBlanks
        : selectedWords.length > 0
        ? synthesizeFillInBlanks(selectedWords.map((v) => typeof v === 'string' ? v : v.word), selectedWords)
        : [];

    const sentenceWritingPrompts =
      Array.isArray(primaryAct.sentenceWritingPrompts) && primaryAct.sentenceWritingPrompts.length > 0
        ? primaryAct.sentenceWritingPrompts
        : Array.isArray(fallbackAct.sentenceWritingPrompts) && fallbackAct.sentenceWritingPrompts.length > 0
        ? fallbackAct.sentenceWritingPrompts
        : selectedWords.length > 0
        ? selectedWords.map((v) => deriveContextualSentencePrompt({
            word: typeof v === 'string' ? v : v.word,
            definitionEn: v.definitionEn,
            translationPt: v.translationPt,
            exampleSentence: v.exampleSentence,
            sourceActivityName: v.sourceActivityName,
            partOfSpeech: v.partOfSpeech,
            cefrLevel: v.cefrLevel,
          }))
        : [];

    const readingPassage = primaryAct.readingPassage?.text
      ? primaryAct.readingPassage
      : fallbackAct.readingPassage?.text
      ? fallbackAct.readingPassage
      : primaryAct.readingPassage || fallbackAct.readingPassage;

    const mergedAnswers = {
      matching: { ...(fallbackAct.studentAnswers?.matching || {}), ...(primaryAct.studentAnswers?.matching || {}) },
      fillInBlanks: { ...(fallbackAct.studentAnswers?.fillInBlanks || {}), ...(primaryAct.studentAnswers?.fillInBlanks || {}) },
      sentences: { ...(fallbackAct.studentAnswers?.sentences || {}), ...(primaryAct.studentAnswers?.sentences || {}) },
      quizAnswers: { ...(fallbackAct.studentAnswers?.quizAnswers || {}), ...(primaryAct.studentAnswers?.quizAnswers || {}) },
    };

    const mergedPartsProgress = {
      matching: primaryAct.partsProgress?.matching || fallbackAct.partsProgress?.matching,
      fill: primaryAct.partsProgress?.fill || fallbackAct.partsProgress?.fill,
      writing: primaryAct.partsProgress?.writing || fallbackAct.partsProgress?.writing,
      reading: primaryAct.partsProgress?.reading || fallbackAct.partsProgress?.reading,
    };

    const finalAiEvaluation = primaryAct.aiEvaluation || fallbackAct.aiEvaluation;
    const finalScore =
      typeof primaryAct.score === 'number' && primaryAct.score > 0
        ? primaryAct.score
        : typeof fallbackAct.score === 'number' && fallbackAct.score > 0
        ? fallbackAct.score
        : typeof primaryAct.score === 'number'
        ? primaryAct.score
        : fallbackAct.score ?? 0;

    const isStarted = Boolean(
      primaryAct.isStarted ||
      fallbackAct.isStarted ||
      isActivityStartedOrAnswered(primaryAct) ||
      isActivityStartedOrAnswered(fallbackAct)
    );

    result[dayKey] = {
      ...fallbackAct,
      ...primaryAct,
      selectedWords,
      wordOrigins,
      matchingPairs,
      fillInBlanks,
      sentenceWritingPrompts,
      readingPassage,
      studentAnswers: mergedAnswers,
      partsProgress: mergedPartsProgress,
      aiEvaluation: finalAiEvaluation,
      score: finalScore,
      isCompleted: Boolean(primaryAct.isCompleted || fallbackAct.isCompleted),
      isStarted,
      createdAt: fallbackAct.createdAt || primaryAct.createdAt || new Date().toISOString(),
      updatedAt: primaryAct.updatedAt || fallbackAct.updatedAt || new Date().toISOString(),
    };
  }

  return result;
}

/**
 * Merges two homework objects ensuring student answers, genuine evaluations,
 * scores, per-part progress, and question lists are never wiped by empty fields or autosaves.
 */
export function mergeHomeworkRecords(primary: any, fallback: any): any {
  if (!primary && !fallback) return null;
  if (!primary) return fallback;
  if (!fallback) return primary;

  const mergedAnswers = {
    matching: { ...(fallback.studentAnswers?.matching || {}), ...(primary.studentAnswers?.matching || {}) },
    fillInBlanks: { ...(fallback.studentAnswers?.fillInBlanks || {}), ...(primary.studentAnswers?.fillInBlanks || {}) },
    sentences: { ...(fallback.studentAnswers?.sentences || {}), ...(primary.studentAnswers?.sentences || {}) },
    quizAnswers: { ...(fallback.studentAnswers?.quizAnswers || {}), ...(primary.studentAnswers?.quizAnswers || {}) },
  };

  // Merge per-part progress (HOTFIX 2.3.3)
  const fallbackParts = fallback.partsProgress || {};
  const primaryParts = primary.partsProgress || {};
  const mergePart = (key: 'matching' | 'fill' | 'writing' | 'reading', num: 1 | 2 | 3 | 4) => {
    const fPart = fallbackParts[key];
    const pPart = primaryParts[key];
    if (!fPart && !pPart) return undefined;
    if (!fPart) return pPart;
    if (!pPart) return fPart;
    const isCompleted = pPart.status === 'completed' || fPart.status === 'completed';
    const isPending = !isCompleted && (pPart.status === 'pending_evaluation' || fPart.status === 'pending_evaluation');
    const status = isCompleted ? 'completed' : isPending ? 'pending_evaluation' : (pPart.status || fPart.status || 'draft');
    return {
      partKey: key,
      partNumber: num,
      status,
      answers: { ...(fPart.answers || {}), ...(pPart.answers || {}) },
      evaluation: pPart.evaluation || fPart.evaluation,
      score: pPart.score ?? fPart.score,
      completedAt: pPart.completedAt || fPart.completedAt,
      updatedAt: pPart.updatedAt || fPart.updatedAt || new Date().toISOString(),
    };
  };

  const mergedPartsProgress = {
    matching: mergePart('matching', 1),
    fill: mergePart('fill', 2),
    writing: mergePart('writing', 3),
    reading: mergePart('reading', 4),
  };

  const finalAiEvaluation = primary.aiEvaluation || fallback.aiEvaluation;
  const finalScore =
    typeof primary.score === 'number' && primary.score > 0
      ? primary.score
      : typeof fallback.score === 'number' && fallback.score > 0
      ? fallback.score
      : typeof primary.score === 'number'
      ? primary.score
      : fallback.score ?? 0;
  const finalIsCompleted = Boolean(
    primary.isCompleted || fallback.isCompleted || (finalAiEvaluation && finalScore > 0)
  );

  const mergedDaily = mergeDailyActivities(fallback.dailyActivities, primary.dailyActivities);

  return {
    ...fallback,
    ...primary,
    matchingPairs:
      Array.isArray(primary.matchingPairs) && primary.matchingPairs.length > 0
        ? primary.matchingPairs
        : Array.isArray(fallback.matchingPairs) && fallback.matchingPairs.length > 0
        ? fallback.matchingPairs
        : [],
    fillInBlanks:
      Array.isArray(primary.fillInBlanks) && primary.fillInBlanks.length > 0
        ? primary.fillInBlanks
        : Array.isArray(fallback.fillInBlanks) && fallback.fillInBlanks.length > 0
        ? fallback.fillInBlanks
        : [],
    sentenceWritingPrompts:
      Array.isArray(primary.sentenceWritingPrompts) && primary.sentenceWritingPrompts.length > 0
        ? primary.sentenceWritingPrompts
        : Array.isArray(fallback.sentenceWritingPrompts) && fallback.sentenceWritingPrompts.length > 0
        ? fallback.sentenceWritingPrompts
        : [],
    readingPassage: primary.readingPassage?.text
      ? primary.readingPassage
      : fallback.readingPassage?.text
      ? fallback.readingPassage
      : primary.readingPassage,
    completedPartsByDay: {
      ...(fallback.completedPartsByDay || {}),
      ...(primary.completedPartsByDay || {}),
    },
    dailyActivities: mergedDaily,
    studentAnswers: mergedAnswers,
    partsProgress: mergedPartsProgress,
    aiEvaluation: finalAiEvaluation,
    score: finalScore,
    isCompleted: finalIsCompleted,
  };
}

/**
 * Sanitizes loaded homework data so that legacy synthetic evaluations are never
 * treated as valid evaluations, while preserving student answers, words, and history.
 * Defensively ensures that exercises on daily activities are never left as empty arrays.
 */
export function sanitizeLoadedHomeworkData(hw: any): WeeklyHomeworkData {
  if (!hw || typeof hw !== 'object') return hw;
  const clean = { ...hw };
  if (clean.aiEvaluation) {
    if (isSyntheticHomeworkEvaluation(clean.aiEvaluation) || !isValidHomeworkEvaluation(clean.aiEvaluation)) {
      delete clean.aiEvaluation;
      if (clean.isCompleted) {
        clean.isCompleted = false;
        delete clean.score;
      }
    }
  }

  // Defensively ensure dailyActivities exercises are never empty if selectedWords exist
  if (clean.dailyActivities && typeof clean.dailyActivities === 'object') {
    const sanitizedDays: Record<string, DailyHomeworkActivity> = {};
    for (const [dayKey, dayAct] of Object.entries(clean.dailyActivities as Record<string, DailyHomeworkActivity>)) {
      if (!dayAct) continue;
      const words = dayAct.selectedWords;
      if (Array.isArray(words) && words.length > 0) {
        const matchingPairs = (Array.isArray(dayAct.matchingPairs) && dayAct.matchingPairs.length > 0)
          ? dayAct.matchingPairs
          : words.map((v, idx) => ({
              id: `pair-${idx + 1}`,
              word: v.word,
              definition: v.definitionEn,
              translation: v.translationPt,
            }));
        const fillInBlanks = (Array.isArray(dayAct.fillInBlanks) && dayAct.fillInBlanks.length > 0)
          ? dayAct.fillInBlanks
          : synthesizeFillInBlanks(words.map((v) => typeof v === 'string' ? v : v.word), words);
        const sentenceWritingPrompts = (Array.isArray(dayAct.sentenceWritingPrompts) && dayAct.sentenceWritingPrompts.length > 0)
          ? dayAct.sentenceWritingPrompts
          : words.map((v) => deriveContextualSentencePrompt({
              word: typeof v === 'string' ? v : v.word,
              definitionEn: v.definitionEn,
              translationPt: v.translationPt,
              exampleSentence: v.exampleSentence,
              sourceActivityName: v.sourceActivityName,
              partOfSpeech: v.partOfSpeech,
              cefrLevel: v.cefrLevel,
            }));
        const readingPassage = dayAct.readingPassage?.text
          ? dayAct.readingPassage
          : synthesizeCohesiveStoryAndQuestions({
              words: words.map((v) => typeof v === 'string' ? v : v.word),
              studentName: clean.studentName,
              wordDetails: words,
            });

        sanitizedDays[dayKey] = {
          ...dayAct,
          matchingPairs,
          fillInBlanks,
          sentenceWritingPrompts,
          readingPassage,
        };
      } else {
        sanitizedDays[dayKey] = dayAct;
      }
    }
    clean.dailyActivities = sanitizedDays;
  }

  return clean as WeeklyHomeworkData;
}

/**
 * Persist student weekly homework and activity progress directly to Cloud Firestore.
 * Saves to:
 * 1. users/{studentUID}/homework/{weekId}
 * 2. users/{studentUID} (field: weeklyHomework)
 * 3. top-level student_homework/{studentUID} for fast cross-device queries
 * 4. Mirrors to /api/homework with studentEmail and uid
 */
export async function saveStudentHomeworkProgressToFirestore(
  studentUid: string,
  studentEmail: string | undefined,
  homework: WeeklyHomeworkData,
  weekId: string = 'current_week',
  options?: { submit?: boolean }
): Promise<boolean> {
  const cleanUid = normalizeUid(studentUid, studentEmail);
  const cleanEmail = (studentEmail || '').toLowerCase().trim();

  if (!homework || (!cleanUid && !cleanEmail)) return false;

  const isCurrentWeekAlias = !weekId || weekId === 'current_week' || (typeof weekId === 'string' && weekId.trim() === '');
  let targetCycle: number | null = isCurrentWeekAlias
    ? parseWeekCycleNumber(homework?.weeklyCycle)
    : parseWeekCycleNumber(weekId);
  let targetWeekId: string | null = targetCycle !== null ? `week-${targetCycle}` : (isCurrentWeekAlias ? 'current_week' : null);

  if (!targetWeekId) {
    console.warn(
      `[studentPersistence] saveStudentHomeworkProgressToFirestore: Failed to resolve canonical week for student ${cleanUid} (weekId: '${weekId}'). Aborting safely.`
    );
    return false;
  }

  try {
    const sanitizedHomework = JSON.parse(JSON.stringify(homework));

    // Strip synthetic or invalid evaluations before persisting (HOTFIX 2.2)
    if (sanitizedHomework.aiEvaluation) {
      if (isSyntheticHomeworkEvaluation(sanitizedHomework.aiEvaluation) || !isValidHomeworkEvaluation(sanitizedHomework.aiEvaluation)) {
        delete sanitizedHomework.aiEvaluation;
        if (sanitizedHomework.isCompleted) {
          sanitizedHomework.isCompleted = false;
          delete sanitizedHomework.score;
        }
      }
    }

    const canonicalUid = auth?.currentUser?.uid || cleanUid;
    const payload = stampSchemaVersion({
      ...sanitizedHomework,
      ...(targetWeekId !== 'current_week' ? { id: targetWeekId, weekId: targetWeekId } : {}),
      ...(targetCycle ? { weeklyCycle: targetCycle } : {}),
      studentUid: canonicalUid,
      studentEmail: cleanEmail,
      updatedAt: new Date().toISOString(),
    });

    const token = await getAccessToken().catch(() => null);
    if (typeof window !== 'undefined' && !token) {
      console.warn('[studentPersistence] saveStudentHomeworkProgressToFirestore: missing Firebase ID token.');
      return false;
    }

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const currentAuthEmail = (auth?.currentUser?.email || '').toLowerCase().trim();
    const safeStudentEmail = (cleanEmail && cleanEmail.includes('@') && (!currentAuthEmail || currentAuthEmail === cleanEmail)) ? cleanEmail : undefined;

    const endpoint = options?.submit ? '/api/homework/submit' : '/api/homework';
    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        uid: canonicalUid,
        studentUid: canonicalUid,
        ...(safeStudentEmail ? { studentEmail: safeStudentEmail } : {}),
        weekId: targetWeekId,
        ...(targetCycle ? { weeklyCycle: targetCycle } : {}),
        weeklyHomework: payload,
      }),
    });

    if (!res.ok) {
      console.error(`[studentPersistence] saveStudentHomeworkProgressToFirestore failed: HTTP ${res.status}`);
      return false;
    }

    const resData = await res.json().catch(() => null);
    if (!resData || resData.success === false) {
      console.error('[studentPersistence] saveStudentHomeworkProgressToFirestore server rejected:', resData);
      return false;
    }

    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(
        new CustomEvent('its-simple:homework-updated', {
          detail: {
            studentUid: canonicalUid,
            weekId: resData.weekId || targetWeekId,
            weeklyCycle: resData.weeklyCycle || targetCycle,
            homework: resData.weeklyHomework || payload,
          },
        })
      );
    }

    return true;
  } catch (error) {
    console.error(`[studentPersistence] Failed to save homework for ${cleanUid}:`, error);
    return false;
  }
}

/**
 * Fetch student weekly homework and activity progress exclusively via authenticated /api/homework endpoint.
 */
export async function fetchStudentHomeworkProgressFromFirestore(
  studentUid: string,
  studentEmail?: string,
  weekId: string = 'current_week'
): Promise<WeeklyHomeworkData | null> {
  const cleanEmail = (studentEmail || '').toLowerCase().trim();
  const cleanUid = normalizeUid(studentUid, cleanEmail);

  if (!cleanUid && !cleanEmail) return null;

  const isCurrentWeekAlias = !weekId || weekId === 'current_week' || (typeof weekId === 'string' && weekId.trim() === '');
  const targetCycle: number | null = isCurrentWeekAlias ? null : parseWeekCycleNumber(weekId);
  const targetWeekId: string | null = isCurrentWeekAlias
    ? 'current_week'
    : (targetCycle !== null ? `week-${targetCycle}` : null);

  if (!targetWeekId) {
    console.warn(
      `[studentPersistence] fetchStudentHomeworkProgressFromFirestore: Invalid week identifier '${weekId}' for ${cleanUid}.`
    );
    return null;
  }

  try {
    const token = await getAccessToken().catch(() => null);
    if (typeof window !== 'undefined' && !token) {
      return null;
    }

    const canonicalUid = auth?.currentUser?.uid || cleanUid;
    const currentAuthEmail = (auth?.currentUser?.email || '').toLowerCase().trim();
    const safeStudentEmail = (cleanEmail && cleanEmail.includes('@') && (!currentAuthEmail || currentAuthEmail === cleanEmail)) ? cleanEmail : '';

    const params = new URLSearchParams();
    if (canonicalUid) {
      params.append('uid', canonicalUid);
      params.append('studentUid', canonicalUid);
    }
    if (safeStudentEmail) {
      params.append('studentEmail', safeStudentEmail);
    }
    params.append('weekId', targetWeekId);
    if (targetCycle) {
      params.append('weeklyCycle', String(targetCycle));
    }

    const headers: Record<string, string> = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const res = await fetch(`/api/homework?${params.toString()}`, { headers });
    if (!res.ok) return null;

    const apiData = await res.json().catch(() => null);
    if (!apiData) return null;

    const hasSubstantiveFields = Boolean(
      apiData.completedPartsByDay ||
      apiData.studentAnswers ||
      apiData.dailyActivities ||
      (Array.isArray(apiData.matchingPairs) && apiData.matchingPairs.length > 0)
    );
    if (!hasSubstantiveFields) return null;

    if (targetCycle && targetCycle >= 2) {
      const apiCycle =
        parseWeekCycleNumber(apiData.weeklyCycle) ||
        parseWeekCycleNumber(apiData.weekId) ||
        parseWeekCycleNumber(apiData.id);
      if (apiCycle && apiCycle !== targetCycle) {
        return null;
      }
    }

    return sanitizeLoadedHomeworkData(apiData as WeeklyHomeworkData);
  } catch (apiErr) {
    console.warn('[studentPersistence] Notice fetching homework from backend API:', apiErr);
    return null;
  }
}

/**
 * Creates a clean, initialized homework state for a given student and week cycle.
 * Ensures answers, completed parts, and completion flags are cleared for an unstarted cycle,
 * while preserving valid dailyActivities, selectedWords, exercises, studentLevel, and structure.
 */
export function createCleanInitializedHomework(
  studentUid: string,
  studentEmail?: string,
  cycle: number = 1,
  partial?: Partial<WeeklyHomeworkData>
): WeeklyHomeworkData {
  const canonicalWeekId = normalizeWeekId(cycle) || `week-${cycle}`;

  // Defensively preserve and sanitize dailyActivities if present in partial
  let dailyActivities: Record<string, DailyHomeworkActivity> = {};
  if (partial?.dailyActivities && typeof partial.dailyActivities === 'object') {
    dailyActivities = { ...partial.dailyActivities };
    // Ensure activities with selectedWords have deterministically synthesized questions if questions are missing
    for (const [dayKey, dayAct] of Object.entries(dailyActivities)) {
      if (!dayAct) continue;
      const words = dayAct.selectedWords;
      if (Array.isArray(words) && words.length > 0) {
        const matchingPairs = (Array.isArray(dayAct.matchingPairs) && dayAct.matchingPairs.length > 0)
          ? dayAct.matchingPairs
          : words.map((v, idx) => ({
              id: `pair-${idx + 1}`,
              word: typeof v === 'string' ? v : v.word,
              definition: typeof v === 'string' ? '' : v.definitionEn,
              translation: typeof v === 'string' ? '' : v.translationPt,
            }));

        const fillInBlanks = (Array.isArray(dayAct.fillInBlanks) && dayAct.fillInBlanks.length > 0)
          ? dayAct.fillInBlanks
          : synthesizeFillInBlanks(words.map((v) => typeof v === 'string' ? v : v.word), words);

        const sentenceWritingPrompts = (Array.isArray(dayAct.sentenceWritingPrompts) && dayAct.sentenceWritingPrompts.length > 0)
          ? dayAct.sentenceWritingPrompts
          : words.map((v) => deriveContextualSentencePrompt({
              word: typeof v === 'string' ? v : v.word,
              definitionEn: typeof v === 'string' ? '' : v.definitionEn,
              translationPt: typeof v === 'string' ? '' : v.translationPt,
              exampleSentence: typeof v === 'string' ? '' : v.exampleSentence,
              sourceActivityName: typeof v === 'string' ? '' : v.sourceActivityName,
              partOfSpeech: typeof v === 'string' ? '' : v.partOfSpeech,
              cefrLevel: typeof v === 'string' ? '' : v.cefrLevel,
            }));

        dailyActivities[dayKey] = {
          ...dayAct,
          matchingPairs,
          fillInBlanks,
          sentenceWritingPrompts,
        };
      }
    }
  }

  const vocabularyList = Array.isArray(partial?.vocabularyList) ? partial.vocabularyList : [];
  const matchingPairs = (Array.isArray(partial?.matchingPairs) && partial.matchingPairs.length > 0)
    ? partial.matchingPairs
    : vocabularyList.map((v, idx) => ({
        id: `pair-${idx + 1}`,
        word: typeof v === 'string' ? v : v.word,
        definition: typeof v === 'string' ? '' : v.definitionEn,
        translation: typeof v === 'string' ? '' : v.translationPt,
      }));

  const fillInBlanks = (Array.isArray(partial?.fillInBlanks) && partial.fillInBlanks.length > 0)
    ? partial.fillInBlanks
    : vocabularyList.length > 0
    ? synthesizeFillInBlanks(vocabularyList.map((v) => typeof v === 'string' ? v : v.word), vocabularyList)
    : [];

  const sentenceWritingPrompts = (Array.isArray(partial?.sentenceWritingPrompts) && partial.sentenceWritingPrompts.length > 0)
    ? partial.sentenceWritingPrompts
    : vocabularyList.length > 0
    ? vocabularyList.map((v) => deriveContextualSentencePrompt({
        word: typeof v === 'string' ? v : v.word,
        definitionEn: typeof v === 'string' ? '' : v.definitionEn,
        translationPt: typeof v === 'string' ? '' : v.translationPt,
        exampleSentence: typeof v === 'string' ? '' : v.exampleSentence,
        sourceActivityName: typeof v === 'string' ? '' : v.sourceActivityName,
        partOfSpeech: typeof v === 'string' ? '' : v.partOfSpeech,
        cefrLevel: typeof v === 'string' ? '' : v.cefrLevel,
      }))
    : [];

  const studentLevel = partial?.studentLevel || (partial as any)?.level || (partial as any)?.englishLevel || 'intermediate';

  return {
    id: partial?.id || `hw-${canonicalWeekId}-${studentUid}`,
    weekId: canonicalWeekId,
    weeklyCycle: cycle,
    studentUid,
    studentEmail: studentEmail || partial?.studentEmail || '',
    studentName: partial?.studentName || 'Student',
    studentLevel,
    createdAt: partial?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    weekLabel: partial?.weekLabel || `Week ${cycle}`,
    totalWordsCollected: partial?.totalWordsCollected || vocabularyList.length,
    vocabularyList,
    allRoutineWords: Array.isArray(partial?.allRoutineWords) ? partial.allRoutineWords : [],
    matchingPairs,
    fillInBlanks,
    sentenceWritingPrompts,
    readingPassage: partial?.readingPassage
      ? {
          ...partial.readingPassage,
          questions: (Array.isArray(partial.readingPassage.questions) ? partial.readingPassage.questions : []).map(
            (q: any, qIdx: number) => ({
              ...q,
              id: q?.id || `q-${qIdx + 1}`,
              options: Array.isArray(q?.options) ? q.options : [],
            })
          ),
        }
      : {
          title: `Week ${cycle} Reading`,
          text: '',
          questions: [],
        },
    targetDay: partial?.targetDay,
    assignedPart: partial?.assignedPart,
    assignedPartKey: partial?.assignedPartKey,
    dailyActivities,
    // Explicitly clean / empty answers and completion state
    isCompleted: false,
    isDayPartCompleted: false,
    score: 0,
    completedPartsByDay: {},
    studentAnswers: {
      matching: {},
      fillInBlanks: {},
      sentences: {},
      quizAnswers: {},
    },
    isEmpty: partial?.isEmpty !== undefined ? partial.isEmpty : (vocabularyList.length === 0 && Object.keys(dailyActivities).length === 0),
    emptyWarning: partial?.emptyWarning,
    emptyWarningEn: partial?.emptyWarningEn,
  };
}

/**
 * Real-time subscription to student homework on Cloud Firestore.
 * Scoped strictly to the active week (users/{cleanUid}/homework/week-${cycle}).
 * Enables instant cross-device synchronization between PC, tablet, and mobile!
 */
export function subscribeToStudentHomeworkProgress(
  studentUid: string,
  studentEmail: string | undefined,
  callback: (homework: WeeklyHomeworkData) => void,
  weekId: string = 'current_week'
): () => void {
  const cleanEmail = (studentEmail || '').toLowerCase().trim();
  const cleanUid = normalizeUid(studentUid, cleanEmail);
  if (!cleanUid && !cleanEmail) {
    return () => {};
  }

  const isCurrentWeekAlias = !weekId || weekId === 'current_week' || (typeof weekId === 'string' && weekId.trim() === '');
  const explicitCycle = isCurrentWeekAlias ? null : parseWeekCycleNumber(weekId);
  if (!isCurrentWeekAlias && explicitCycle === null) {
    console.warn(
      `[studentPersistence] subscribeToStudentHomeworkProgress: Rejecting malformed explicit week identifier '${weekId}' for ${cleanUid}.`
    );
    return () => {};
  }

  let isCancelled = false;

  const hydrateNormalizedHomework = (data: Partial<WeeklyHomeworkData>, cycle: number): WeeklyHomeworkData => {
    const canonicalWeekId = `week-${cycle}`;
    const hasCompletedParts = data.completedPartsByDay && Object.keys(data.completedPartsByDay).length > 0;
    const hasAnswers = data.studentAnswers && (
      (data.studentAnswers.matching && Object.keys(data.studentAnswers.matching).length > 0) ||
      (data.studentAnswers.fillInBlanks && Object.keys(data.studentAnswers.fillInBlanks).length > 0) ||
      (data.studentAnswers.sentences && Object.keys(data.studentAnswers.sentences).length > 0) ||
      (data.studentAnswers.quizAnswers && Object.keys(data.studentAnswers.quizAnswers).length > 0)
    );
    const isCompleted = !!data.isCompleted || !!data.isDayPartCompleted;
    const hasExercises = Boolean(
      (Array.isArray(data.matchingPairs) && data.matchingPairs.length > 0) ||
      (Array.isArray(data.fillInBlanks) && data.fillInBlanks.length > 0) ||
      (Array.isArray(data.sentenceWritingPrompts) && data.sentenceWritingPrompts.length > 0) ||
      (data.dailyActivities && Object.values(data.dailyActivities).some((act: any) =>
        (Array.isArray(act?.matchingPairs) && act.matchingPairs.length > 0) ||
        (Array.isArray(act?.fillInBlanks) && act.fillInBlanks.length > 0) ||
        (Array.isArray(act?.sentenceWritingPrompts) && act.sentenceWritingPrompts.length > 0) ||
        (Array.isArray(act?.selectedWords) && act.selectedWords.length > 0)
      ))
    );

    if ((!hasCompletedParts && !hasAnswers && !isCompleted && !hasExercises) || (data.isEmpty && !hasExercises)) {
      return createCleanInitializedHomework(cleanUid, studentEmail, cycle, data);
    }

    const cleanBase = createCleanInitializedHomework(cleanUid, studentEmail, cycle, data);
    const mergedDaily = data.dailyActivities
      ? mergeDailyActivities(cleanBase.dailyActivities, data.dailyActivities)
      : cleanBase.dailyActivities;

    return sanitizeLoadedHomeworkData({
      ...cleanBase,
      ...data,
      dailyActivities: mergedDaily,
      matchingPairs: Array.isArray(data.matchingPairs) && data.matchingPairs.length > 0 ? data.matchingPairs : cleanBase.matchingPairs,
      fillInBlanks: Array.isArray(data.fillInBlanks) && data.fillInBlanks.length > 0 ? data.fillInBlanks : cleanBase.fillInBlanks,
      sentenceWritingPrompts: Array.isArray(data.sentenceWritingPrompts) && data.sentenceWritingPrompts.length > 0 ? data.sentenceWritingPrompts : cleanBase.sentenceWritingPrompts,
      vocabularyList: Array.isArray(data.vocabularyList) && data.vocabularyList.length > 0 ? data.vocabularyList : cleanBase.vocabularyList,
      allRoutineWords: Array.isArray(data.allRoutineWords) && data.allRoutineWords.length > 0 ? data.allRoutineWords : cleanBase.allRoutineWords,
      studentLevel: data.studentLevel || cleanBase.studentLevel,
      readingPassage: data.readingPassage
        ? {
            ...cleanBase.readingPassage,
            ...data.readingPassage,
            questions: Array.isArray(data.readingPassage.questions)
              ? data.readingPassage.questions.map((q: any, qIdx: number) => ({
                  ...q,
                  id: q?.id || `q-${qIdx + 1}`,
                  options: Array.isArray(q?.options) ? q.options : [],
                }))
              : (cleanBase.readingPassage?.questions || []),
          }
        : cleanBase.readingPassage,
      weekId: canonicalWeekId,
      weeklyCycle: cycle,
    } as WeeklyHomeworkData);
  };

  const fetchLatest = async () => {
    if (isCancelled) return;
    try {
      const token = await getAccessToken().catch(() => null);
      if (isCancelled) return;
      if (typeof window !== 'undefined' && !token) return;

      const canonicalUid = auth?.currentUser?.uid || (isValidCanonicalUid(cleanUid) ? cleanUid : '');
      const currentAuthEmail = (auth?.currentUser?.email || '').toLowerCase().trim();
      const safeStudentEmail = (cleanEmail && cleanEmail.includes('@') && (!currentAuthEmail || currentAuthEmail === cleanEmail)) ? cleanEmail : '';

      const params = new URLSearchParams();
      if (canonicalUid) {
        params.append('uid', canonicalUid);
        params.append('studentUid', canonicalUid);
      }
      if (safeStudentEmail) {
        params.append('studentEmail', safeStudentEmail);
      }
      if (isCurrentWeekAlias) {
        params.append('weekId', 'current_week');
      } else {
        params.append('weekId', `week-${explicitCycle}`);
        params.append('weeklyCycle', String(explicitCycle));
      }

      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(`/api/homework?${params.toString()}`, { headers });
      if (isCancelled || !res.ok) return;

      const data = await res.json().catch(() => null);
      if (isCancelled || !data) return;

      const resolvedCycle = parseWeekCycleNumber(data.weeklyCycle) || parseWeekCycleNumber(data.weekId) || explicitCycle || 1;
      callback(hydrateNormalizedHomework(data, resolvedCycle));
    } catch (err) {
      console.warn('Homework API sync notice:', err);
    }
  };

  fetchLatest();

  let unsubAuth: (() => void) | null = null;
  if (typeof window !== 'undefined' && auth) {
    try {
      unsubAuth = onAuthStateChanged(auth, (user) => {
        if (user && !isCancelled) {
          fetchLatest();
        }
      });
    } catch {}
  }

  const handleUpdatedEvent = (ev: Event) => {
    if (isCancelled) return;
    const detail = (ev as CustomEvent)?.detail;
    if (!detail?.homework) return;
    const detailUid = detail.studentUid || '';
    if (detailUid && cleanUid && detailUid !== cleanUid && detailUid !== auth?.currentUser?.uid) return;
    const detailCycle = parseWeekCycleNumber(detail.weeklyCycle) || parseWeekCycleNumber(detail.weekId) || explicitCycle || 1;
    if (!isCurrentWeekAlias && explicitCycle && detailCycle !== explicitCycle) return;
    callback(hydrateNormalizedHomework(detail.homework, detailCycle));
  };

  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('its-simple:homework-updated', handleUpdatedEvent);
  }

  return () => {
    isCancelled = true;
    if (unsubAuth) unsubAuth();
    if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      window.removeEventListener('its-simple:homework-updated', handleUpdatedEvent);
    }
  };
}

/**
 * Retrieve student daily journal entries via secure backend API.
 * Avoids client-side onSnapshot rule blocking while providing consistent data.
 */
export function subscribeToStudentDailyJournal(
  studentUid: string,
  studentEmail: string | undefined,
  callback: (entries: DailyJournalEntry[]) => void
): () => void {
  const cleanEmail = (studentEmail || '').toLowerCase().trim();
  const cleanUid = normalizeUid(studentUid, cleanEmail);
  if (!cleanUid) return () => {};

  let isSubscribed = true;
  fetchStudentJournalFromFirestore(cleanUid, cleanEmail)
    .then((entries) => {
      if (isSubscribed && Array.isArray(entries)) {
        callback(entries);
      }
    })
    .catch((err) => {
      console.warn('Initial journal load notice:', err);
    });

  return () => {
    isSubscribed = false;
  };
}

/**
 * Delete a student daily journal entry directly via secure backend API.
 * Uses DELETE /api/student-journal with verified Firebase ID Token.
 */
export async function deleteStudentJournalEntryFromFirestore(
  studentUid: string,
  entryId: string,
  studentEmail?: string
): Promise<boolean> {
  if (!entryId) return false;
  const cleanEmail = (studentEmail || '').toLowerCase().trim();
  const cleanUid = normalizeUid(studentUid, cleanEmail);
  if (!cleanUid) return false;

  try {
    const currentUser = auth.currentUser;
    let idToken: string | null = null;
    if (currentUser) {
      idToken = await currentUser.getIdToken().catch(() => null);
    }
    if (!idToken) {
      console.warn('deleteStudentJournalEntryFromFirestore: unauthenticated');
      return false;
    }

    const response = await fetch(`/api/student-journal?id=${encodeURIComponent(entryId)}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${idToken}`,
      },
    });

    if (!response.ok) {
      return false;
    }
    const resJson = await response.json().catch(() => null);
    return Boolean(resJson && resJson.success);
  } catch (error) {
    console.warn('deleteStudentJournalEntryFromFirestore error:', error);
    return false;
  }
}

export async function fetchStudentDailyRoutinesFromFirestore(
  studentUid: string
): Promise<{ success: boolean; routines: Partial<Record<DayOfWeek, any>>; error?: any }> {
  const db = getDb();
  const cleanUid = normalizeUid(studentUid);
  if (!db || !cleanUid) return { success: false, routines: {} };

  try {
    const routinesCol = collection(db, 'users', cleanUid, 'routines');
    const snap = await withFirestoreTimeout(getDocs(routinesCol), 3500, null);
    if (!snap) {
      return { success: false, routines: {}, error: new Error('Routines fetch timed out') };
    }
    const routinesMap: Partial<Record<DayOfWeek, any>> = {};
    snap.forEach((docSnap) => {
      routinesMap[docSnap.id as DayOfWeek] = docSnap.data();
    });
    return { success: true, routines: routinesMap };
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, `users/${cleanUid}/routines`);
    return { success: false, routines: {}, error: err };
  }
}

/**
 * Real-time subscription to student daily routine video/topic selections across Monday-Sunday.
 * Ensures that topic choices or custom video suggestions made on one device appear instantly on other devices.
 */
export function subscribeToStudentDailyRoutines(
  studentUid: string,
  callback: (routines: Partial<Record<DayOfWeek, any>>) => void,
  onError?: (err: any) => void
): () => void {
  const db = getDb();
  const cleanUid = normalizeUid(studentUid);
  if (!db || !cleanUid) return () => {};

  try {
    const routinesCol = collection(db, 'users', cleanUid, 'routines');
    const unsub = onSnapshot(
      routinesCol,
      (snapshot) => {
        const routinesMap: Partial<Record<DayOfWeek, any>> = {};
        snapshot.forEach((docSnap) => {
          routinesMap[docSnap.id as DayOfWeek] = docSnap.data();
        });
        callback(routinesMap);
      },
      (err) => {
        console.warn('Real-time student routines subscription notice:', err);
        if (onError) onError(err);
      }
    );
    return unsub;
  } catch (err) {
    console.warn('subscribeToStudentDailyRoutines error:', err);
    if (onError) onError(err);
    return () => {};
  }
}


