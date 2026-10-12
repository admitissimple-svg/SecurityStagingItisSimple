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
import { getDb, auth } from '../firebase';
import {
  StudentDictionaryEntry,
  DailyJournalEntry,
  LiveLesson,
  StudentJournalEntry,
  StudentJournalActivityType,
  DayOfWeek,
  WeeklyHomeworkData,
  UserProfile,
  NativeFriendTutor,
} from '../types';
import { handleFirestoreError, OperationType, withFirestoreTimeout } from './routineSync';
import { DAYS_OF_WEEK, getTodayDayOfWeek } from './notifications';
import { getAccessToken } from './auth';
import {
  assertSafeFirestoreWrite,
  validateFirestoreDocument,
  stampSchemaVersion,
  CURRENT_SCHEMA_VERSION,
  migrateLegacyLocalStorageToFirestore,
} from './firestoreSchemaValidator';

// Pure in-memory session caches to provide instant zero-delay UI rendering during active session
// ZERO dependency on localStorage: 100% of persistent data is stored in Cloud Firestore
const inMemoryVocabularyCache = new Map<string, StudentDictionaryEntry[]>();
const inMemoryWeeklyChecksCache = new Map<string, Record<string, boolean>>();

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

export { migrateLegacyLocalStorageToFirestore };

/**
 * Validates whether an identity represents an explicit canonical Firebase Auth UID.
 * Rejects empty strings, emails, synthesized usr-* IDs, temporary prefixes, and placeholders.
 */
export function isValidCanonicalUid(uid?: string | null): boolean {
  if (!uid || typeof uid !== 'string') return false;
  const clean = uid.trim();
  if (!clean) return false;
  if (clean.includes('@')) return false;
  if (clean.startsWith('usr-')) return false;
  if (clean.startsWith('teacher-') || clean.startsWith('st-') || clean.startsWith('lesson-')) return false;
  if (clean === 'user-default' || clean === 'anonymous_student' || clean === 'undefined' || clean === 'null') return false;
  return true;
}

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
 * Persist student vocabulary entries directly and permanently to Cloud Firestore.
 * CUMULATIVE: Loads existing words first and merges, ensuring words accumulate permanently over time
 * and are never overwritten or cleared.
 * Stores in both users/{studentUID} (consolidated vocabulary array) and subcollection users/{studentUID}/vocabulary/{wordId}.
 */
export async function saveStudentVocabularyToFirestore(
  studentUid: string,
  entries: StudentDictionaryEntry[],
  studentEmail?: string
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

    // 3. Check legacy doc IDs if masterMap is still small or for accounts migrated from email
    const allDocIds = getUserDocIds(cleanUid, cleanEmail);
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

    // 4. Merge new entries into masterMap (strictly accumulating, never dropping existing ones)
    sanitizedEntries.forEach((entry) => {
      if (!entry || !entry.word || !entry.word.trim()) return;
      const key = entry.word.toLowerCase().trim();
      const existing = masterMap.get(key);

      const mergedEntry: StudentDictionaryEntry = {
        id: entry.id || existing?.id || `dict_${key.replace(/[^a-zA-Z0-9_-]/g, '_')}_${Date.now()}`,
        word: entry.word.trim(),
        partOfSpeech: entry.partOfSpeech || existing?.partOfSpeech || '',
        definitionEn: entry.definitionEn || existing?.definitionEn || '',
        exampleSentenceEn: entry.exampleSentenceEn || existing?.exampleSentenceEn || '',
        translationPt: entry.translationPt || existing?.translationPt || '',
        phonetic: entry.phonetic || existing?.phonetic || '',
        cefrLevel: entry.cefrLevel || existing?.cefrLevel || '',
        sourceActivityName: entry.sourceActivityName || existing?.sourceActivityName || 'Personal Dictionary',
        sourceDay: entry.sourceDay || existing?.sourceDay,
        source: entry.source || existing?.source || 'api',
        learnedAt: entry.learnedAt || existing?.learnedAt || new Date().toISOString(),
        notFound: entry.notFound ?? existing?.notFound ?? false,
        practiceCount: entry.practiceCount !== undefined ? entry.practiceCount : existing?.practiceCount,
        lastPracticedAt: entry.lastPracticedAt || existing?.lastPracticedAt,
      };

      masterMap.set(key, mergedEntry);
    });

    const accumulatedList = Array.from(masterMap.values()).sort((a, b) =>
      (a.word || '').localeCompare(b.word || '', ['en', 'pt'], { sensitivity: 'base' })
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
    sanitizedEntries.forEach((entry) => {
      if (!entry || !entry.word || !entry.word.trim()) return;
      const key = entry.word.toLowerCase().trim();
      const fullItem = masterMap.get(key);
      if (!fullItem) return;
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

    // Mirror to backend server API for disk persistence
    if (cleanEmail || cleanUid) {
      fetch('/api/student-dictionary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentEmail: cleanEmail,
          studentUid: cleanUid,
          entries: accumulatedList,
        }),
      }).catch(() => {});
    }

    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `users/${cleanUid}/vocabulary`);
    return false;
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
  const targetWordsSet = new Set(words.map((w) => (w || '').trim().toLowerCase()).filter(Boolean));

  let modifiedCount = 0;
  const updatedVocab = currentVocab.map((entry) => {
    if (!entry || !entry.word) return entry;
    const norm = entry.word.trim().toLowerCase();
    if (targetWordsSet.has(norm)) {
      modifiedCount++;
      const currentCount = typeof entry.practiceCount === 'number' ? entry.practiceCount : 0;
      return {
        ...entry,
        practiceCount: currentCount + 1,
        lastPracticedAt: nowIso,
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

    // 3. Fallback to legacy document IDs if cleanUid had no words
    if (entryMap.size === 0) {
      const allDocIds = getUserDocIds(cleanUid, cleanEmail);
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
              // Migrate to cleanUid
              setDoc(doc(db, 'users', cleanUid), { vocabulary: altData.vocabulary, updatedAt: new Date().toISOString() }, { merge: true }).catch(() => {});
              break;
            }
          }
        } catch {}
      }
    }

    const result = Array.from(entryMap.values()).sort((a, b) =>
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
 * Delete a student vocabulary entry directly from Cloud Firestore and clean up local cache.
 */
export async function deleteStudentVocabularyFromFirestore(
  studentUid: string,
  word: string,
  studentEmail?: string
): Promise<boolean> {
  const db = getDb();
  if (!db || !word) return false;
  const cleanEmail = (studentEmail || '').toLowerCase().trim();
  const cleanUid = normalizeUid(studentUid, cleanEmail);
  if (!cleanUid) return false;

  const cleanWord = word.trim().toLowerCase();
  const wordDocId = cleanWord.replace(/[^a-zA-Z0-9_-]/g, '_');

  try {
    // 1. Delete from subcollection by predictable wordDocId
    const itemRef = doc(db, 'users', cleanUid, 'vocabulary', wordDocId);
    await withFirestoreTimeout(deleteDoc(itemRef), 3000, null);

    // Also remove any documents in the subcollection where word matches cleanWord
    try {
      const subCol = collection(db, 'users', cleanUid, 'vocabulary');
      const subSnap = await withFirestoreTimeout(getDocs(subCol), 2500, null);
      if (subSnap && !subSnap.empty) {
        for (const docItem of subSnap.docs) {
          const itemData = docItem.data();
          if ((itemData?.word || '').trim().toLowerCase() === cleanWord) {
            await deleteDoc(docItem.ref).catch(() => {});
          }
        }
      }
    } catch {}

    // 2. Remove from users/{cleanUid}.vocabulary array
    const userRef = doc(db, 'users', cleanUid);
    const snap = await withFirestoreTimeout(getDoc(userRef), 2500, null);
    if (snap && snap.exists()) {
      const data = snap.data();
      if (Array.isArray(data?.vocabulary)) {
        const filtered = data.vocabulary.filter(
          (item: StudentDictionaryEntry) => (item?.word || '').trim().toLowerCase() !== cleanWord
        );
        await withFirestoreTimeout(
          setDoc(userRef, { vocabulary: filtered, updatedAt: new Date().toISOString() }, { merge: true }),
          3000,
          null
        );
        cacheVocabularyLocally(cleanUid, cleanEmail, filtered);
      }
    }

    // Also remove from any legacy doc IDs
    const allDocIds = getUserDocIds(cleanUid, cleanEmail);
    for (const altId of allDocIds) {
      if (altId === cleanUid) continue;
      try {
        const altRef = doc(db, 'users', altId);
        const altSnap = await withFirestoreTimeout(getDoc(altRef), 2000, null);
        if (altSnap && altSnap.exists()) {
          const altData = altSnap.data();
          if (Array.isArray(altData?.vocabulary)) {
            const filtered = altData.vocabulary.filter(
              (item: StudentDictionaryEntry) => (item?.word || '').trim().toLowerCase() !== cleanWord
            );
            await setDoc(altRef, { vocabulary: filtered, updatedAt: new Date().toISOString() }, { merge: true });
          }
        }
      } catch {}
    }

    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `users/${cleanUid}/vocabulary/${wordDocId}`);
    return false;
  }
}

/**
 * Real-time subscription to student vocabulary on Firestore.
 * Immediately notifies when any word is added, updated, or removed by student, teacher, or routine across devices.
 * Firestore is the single authoritative source of truth.
 */
export function subscribeToStudentVocabulary(
  studentUid: string,
  studentEmail: string | undefined,
  callback: (entries: StudentDictionaryEntry[]) => void
): () => void {
  const db = getDb();
  const cleanEmail = (studentEmail || '').toLowerCase().trim();
  const cleanUid = normalizeUid(studentUid, cleanEmail);

  if (!db || !cleanUid) {
    return () => {};
  }

  const vocabColRef = collection(db, 'users', cleanUid, 'vocabulary');
  const userDocRef = doc(db, 'users', cleanUid);

  let docVocab: StudentDictionaryEntry[] = [];
  const colMap = new Map<string, StudentDictionaryEntry>();
  let hasReceivedSnapshot = false;

  const notify = () => {
    const mergedMap = new Map<string, StudentDictionaryEntry>();

    // Pre-populate with local cache if we haven't received remote data yet
    if (!hasReceivedSnapshot) {
      const cached = getCachedLocalVocabulary(cleanUid, cleanEmail);
      cached.forEach((item) => {
        if (item && item.word) {
          mergedMap.set(item.word.toLowerCase().trim(), item);
        }
      });
    }

    // Authoritative userDocRef vocabulary array
    docVocab.forEach((item) => {
      if (item && item.word) {
        mergedMap.set(item.word.toLowerCase().trim(), item);
      }
    });

    // Subcollection items
    colMap.forEach((item, key) => {
      if (!mergedMap.has(key)) {
        mergedMap.set(key, item);
      }
    });

    const list = Array.from(mergedMap.values()).sort((a, b) =>
      (a.word || '').localeCompare(b.word || '', ['en', 'pt'], { sensitivity: 'base' })
    );

    if (list.length > 0) {
      cacheVocabularyLocally(cleanUid, cleanEmail, list);
    }
    callback(list);
  };

  // Subcollection listener
  const unsubCol = onSnapshot(
    vocabColRef,
    (snapshot) => {
      hasReceivedSnapshot = true;
      colMap.clear();
      snapshot.forEach((d) => {
        const item = d.data() as StudentDictionaryEntry;
        if (item && item.word) {
          colMap.set(item.word.toLowerCase().trim(), item);
        }
      });
      notify();
    },
    (err) => {
      console.warn('Real-time vocabulary subcollection notice:', err);
    }
  );

  // User document listener
  const unsubDoc = onSnapshot(
    userDocRef,
    (snap) => {
      hasReceivedSnapshot = true;
      if (snap.exists()) {
        const data = snap.data();
        if (Array.isArray(data?.vocabulary)) {
          docVocab = data.vocabulary;
          notify();
        }
      }
    },
    (err) => {
      console.warn('Real-time vocabulary user doc notice:', err);
    }
  );

  return () => {
    unsubCol();
    unsubDoc();
  };
}

/**
 * Persist student daily journal entry directly to Firestore.
 * Saves to users/{studentUID} and subcollection users/{studentUID}/journal/{entryId}.
 */
export async function saveStudentJournalEntryToFirestore(
  studentUid: string,
  entry: DailyJournalEntry,
  studentEmail?: string
): Promise<boolean> {
  const db = getDb();
  if (!db) return false;
  const cleanEmail = (studentEmail || '').toLowerCase().trim();
  const cleanUid = normalizeUid(studentUid, cleanEmail);
  if (!cleanUid) return false;

  try {
    const sanitizedEntry: DailyJournalEntry = JSON.parse(
      JSON.stringify({
        ...entry,
        studentUid: cleanUid,
        studentEmail: cleanEmail,
        createdAt: entry.createdAt || new Date().toISOString(),
      })
    );

    // 1. Save in dedicated subcollection
    const stampedEntry = stampSchemaVersion(sanitizedEntry);
    assertSafeFirestoreWrite(`users/${cleanUid}/journal/${sanitizedEntry.id}`, stampedEntry, undefined, true);
    const entryRef = doc(db, 'users', cleanUid, 'journal', sanitizedEntry.id);
    await withFirestoreTimeout(setDoc(entryRef, stampedEntry, { merge: true }), 3000, null);

    // 2. Also retrieve and update list in user profile doc for single-fetch efficiency
    const userRef = doc(db, 'users', cleanUid);
    const userSnap = await withFirestoreTimeout(getDoc(userRef), 2000, null);
    let existingList: DailyJournalEntry[] = [];
    if (userSnap && userSnap.exists()) {
      const data = userSnap.data();
      if (Array.isArray(data?.dailyJournalEntries)) {
        existingList = data.dailyJournalEntries;
      }
    }

    const filtered = existingList.filter((e) => e.id !== sanitizedEntry.id);
    const updatedList = [sanitizedEntry, ...filtered];
    const stampedUserUpdate = stampSchemaVersion({
      dailyJournalEntries: updatedList,
      updatedAt: new Date().toISOString(),
    });
    assertSafeFirestoreWrite(`users/${cleanUid}`, stampedUserUpdate, userSnap?.data(), true);

    await withFirestoreTimeout(
      setDoc(userRef, stampedUserUpdate, { merge: true }),
      2500,
      null
    );

    // 3. Mirror to server backend API
    fetch('/api/student-journal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        studentEmail: cleanEmail,
        studentUid: cleanUid,
        entry: sanitizedEntry,
      }),
    }).catch(() => {});

    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `users/${cleanUid}/journal/${entry.id}`);
    return false;
  }
}

/**
 * Fetch student daily journal entries directly from Firestore.
 */
export async function fetchStudentJournalFromFirestore(
  studentUid: string,
  studentEmail?: string
): Promise<DailyJournalEntry[]> {
  const db = getDb();
  const cleanEmail = (studentEmail || '').toLowerCase().trim();
  const cleanUid = normalizeUid(studentUid, cleanEmail);
  if (!db || !cleanUid) return [];

  try {
    const journalMap = new Map<string, DailyJournalEntry>();

    // 1. Try subcollection
    const colRef = collection(db, 'users', cleanUid, 'journal');
    const colSnap = await withFirestoreTimeout(getDocs(colRef), 2500, null);
    if (colSnap && !colSnap.empty) {
      colSnap.forEach((d) => {
        const item = d.data() as DailyJournalEntry;
        if (item?.id) journalMap.set(item.id, item);
      });
    }

    // 2. Also check parent user doc
    const userRef = doc(db, 'users', cleanUid);
    const userSnap = await withFirestoreTimeout(getDoc(userRef), 2000, null);
    if (userSnap && userSnap.exists()) {
      const data = userSnap.data();
      if (Array.isArray(data?.dailyJournalEntries)) {
        data.dailyJournalEntries.forEach((item: DailyJournalEntry) => {
          if (item?.id) journalMap.set(item.id, item);
        });
      }
    }

    // Check email doc if UID doc was empty
    if (journalMap.size === 0 && studentEmail) {
      const emailDocId = normalizeUid(null, studentEmail);
      if (emailDocId !== cleanUid) {
        const altRef = doc(db, 'users', emailDocId);
        const altSnap = await withFirestoreTimeout(getDoc(altRef), 2000, null);
        if (altSnap && altSnap.exists()) {
          const altData = altSnap.data();
          if (Array.isArray(altData?.dailyJournalEntries)) {
            altData.dailyJournalEntries.forEach((item: DailyJournalEntry) => {
              if (item?.id) journalMap.set(item.id, item);
            });
          }
        }
      }
    }

    // Sort newest first
    const list = Array.from(journalMap.values());
    list.sort((a, b) => {
      const timeA = new Date(a.createdAt || a.date).getTime();
      const timeB = new Date(b.createdAt || b.date).getTime();
      return timeB - timeA;
    });

    return list;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `users/${cleanUid}/journal`);
    return [];
  }
}

/**
 * Persist a scheduled Live or Trial lesson directly to Firestore.
 * Saves to root `lessons/{lessonId}` and mirrors to `users/{studentUID}/lessons/{lessonId}`.
 */
export async function saveLiveLessonToFirestore(lesson: LiveLesson): Promise<boolean> {
  const db = getDb();
  if (!db || !lesson?.id) return false;

  try {
    const cleanStudentEmail = (lesson.studentEmail || '').toLowerCase().trim();
    const cleanTeacherEmail = (lesson.teacherEmail || '').toLowerCase().trim();
    const studentUid = normalizeUid(lesson.studentUid, cleanStudentEmail);
    const teacherUid = normalizeUid(lesson.teacherUid, cleanTeacherEmail);

    const sanitizedLesson: LiveLesson = stampSchemaVersion({
      ...JSON.parse(JSON.stringify(lesson)),
      id: lesson.id,
      studentUid: studentUid || lesson.studentUid,
      teacherUid: teacherUid || lesson.teacherUid,
      studentEmail: cleanStudentEmail,
      teacherEmail: cleanTeacherEmail,
      updatedAt: lesson.updatedAt || new Date().toISOString(),
    });

    assertSafeFirestoreWrite(`lessons/${sanitizedLesson.id}`, sanitizedLesson, undefined, true);

    // 1. Root lessons collection
    const lessonRef = doc(db, 'lessons', sanitizedLesson.id);
    await withFirestoreTimeout(setDoc(lessonRef, sanitizedLesson, { merge: true }), 2500, null);

    // 2. Student user subcollections across canonical student doc IDs (concurrent execution)
    const studentDocIds = getUserDocIds(studentUid, cleanStudentEmail);
    const studentPromises = studentDocIds.map(async (sDocId) => {
      try {
        const userLessonRef = doc(db, 'users', sDocId, 'lessons', sanitizedLesson.id);
        await withFirestoreTimeout(setDoc(userLessonRef, sanitizedLesson, { merge: true }), 2000, null);

        // Also update scheduledLessons array on user doc
        const userRef = doc(db, 'users', sDocId);
        const userSnap = await withFirestoreTimeout(getDoc(userRef), 1500, null);
        if (userSnap && userSnap.exists()) {
          const data = userSnap.data();
          const prevLessons: LiveLesson[] = Array.isArray(data?.scheduledLessons) ? data.scheduledLessons : [];
          const filtered = prevLessons.filter((l) => l.id !== sanitizedLesson.id);
          await withFirestoreTimeout(
            setDoc(userRef, { scheduledLessons: [sanitizedLesson, ...filtered], updatedAt: new Date().toISOString() }, { merge: true }),
            1500,
            null
          );
        }
      } catch (subErr) {
        console.warn(`Notice persisting lesson to student doc ${sDocId}:`, subErr);
      }
    });

    // 3. Teacher user subcollections across canonical teacher doc IDs (concurrent execution)
    const teacherDocIds = getUserDocIds(teacherUid, cleanTeacherEmail);
    const teacherPromises = teacherDocIds.map(async (tDocId) => {
      try {
        const teacherLessonRef = doc(db, 'users', tDocId, 'lessons', sanitizedLesson.id);
        await withFirestoreTimeout(setDoc(teacherLessonRef, sanitizedLesson, { merge: true }), 2000, null);

        const tUserRef = doc(db, 'users', tDocId);
        const tUserSnap = await withFirestoreTimeout(getDoc(tUserRef), 1500, null);
        if (tUserSnap && tUserSnap.exists()) {
          const tData = tUserSnap.data();
          const prevLessons: LiveLesson[] = Array.isArray(tData?.scheduledLessons) ? tData.scheduledLessons : [];
          const filtered = prevLessons.filter((l) => l.id !== sanitizedLesson.id);
          await withFirestoreTimeout(
            setDoc(tUserRef, { scheduledLessons: [sanitizedLesson, ...filtered], updatedAt: new Date().toISOString() }, { merge: true }),
            1500,
            null
          );
        }
      } catch (tErr) {
        console.warn(`Notice persisting lesson to teacher doc ${tDocId}:`, tErr);
      }
    });

    await Promise.allSettled([...studentPromises, ...teacherPromises]);

    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `lessons/${lesson.id}`);
    return false;
  }
}

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
  const db = getDb();
  if (!db || !params.lesson?.id) {
    return { success: false, error: 'Database or lesson ID missing' };
  }

  const { lesson, isTrialLesson } = params;
  const cleanStudentEmail = (lesson.studentEmail || '').toLowerCase().trim();
  const cleanTeacherEmail = (lesson.teacherEmail || '').toLowerCase().trim();

  // Canonical Student UID resolution (explicit canonical UID, never manufactured from email)
  const studentUid =
    (lesson.studentUid && isValidCanonicalUid(lesson.studentUid) ? lesson.studentUid.trim() : '') ||
    (auth?.currentUser?.uid && (!cleanStudentEmail || (auth.currentUser.email || '').toLowerCase().trim() === cleanStudentEmail)
      ? auth.currentUser.uid
      : '');

  if (!studentUid || !isValidCanonicalUid(studentUid)) {
    return { success: false, error: 'Student UID missing' };
  }

  // Canonical Native Friend UID resolution: MUST be explicit canonical UID, NEVER derived from email or auth.currentUser
  const teacherUid =
    lesson.teacherUid && isValidCanonicalUid(lesson.teacherUid) ? lesson.teacherUid.trim() : '';

  if (!teacherUid) {
    return { success: false, error: 'Canonical Native Friend UID missing' };
  }

  // Auth Context Safety: Student and Native Friend cannot have the same UID
  if (studentUid === teacherUid) {
    return { success: false, error: 'Student UID and Native Friend UID cannot be identical' };
  }

  const nowIso = new Date().toISOString();
  const lessonRef = doc(db, 'lessons', lesson.id);
  const studentRef = doc(db, 'users', studentUid);
  const teacherRef = doc(db, 'users', teacherUid);
  const studentSubLessonRef = doc(db, 'users', studentUid, 'lessons', lesson.id);

  try {
    const result = await runTransaction(db, async (transaction) => {
      // 1. All transaction reads first
      const studentSnap = await transaction.get(studentRef);
      const teacherSnap = await transaction.get(teacherRef);
      const lessonSnap = await transaction.get(lessonRef);

      // Validate teacher account existence in users/{teacherUid}
      if (!teacherSnap.exists()) {
        throw new Error('Native Friend UID does not resolve to an existing user');
      }

      const teacherData = (teacherSnap.data() || {}) as Record<string, any>;

      // Validate teacher role convention
      const isTeacherRole =
        teacherData.role === 'teacher' ||
        teacherData.role === 'admin' ||
        teacherData.isTeacher === true;

      if (!isTeacherRole) {
        throw new Error('User account is not a Native Friend');
      }

      // Validate teacher approval status
      const isApproved =
        teacherData.approvalStatus === 'approved' ||
        teacherData.isApproved === true ||
        teacherData.status === 'approved' ||
        teacherData.approved === true ||
        (teacherData.approvalStatus === undefined && teacherData.isApproved === undefined && teacherData.status === 'active');

      if (!isApproved || teacherData.approvalStatus === 'rejected' || teacherData.approvalStatus === 'pending') {
        throw new Error('Native Friend account is not approved');
      }

      const studentData = studentSnap.exists() ? (studentSnap.data() as Partial<UserProfile>) : {};
      const currentContracted = Number(studentData.contractedLessons ?? 0);
      const currentAvailable =
        studentData.availableLessons !== undefined ? Number(studentData.availableLessons) : currentContracted;

      let newContracted = currentContracted;
      let newAvailable = currentAvailable;

      if (isTrialLesson) {
        // Trial lesson grant: ensure at least 1 contracted lesson and mark trial completed/booked
        newContracted = Math.max(currentContracted, 1);
        newAvailable = Math.max(0, currentAvailable);
      } else {
        // Decrement available lesson balance atomically
        newContracted = currentContracted;
        newAvailable = Math.max(0, currentAvailable - 1);
      }

      // Resolve authoritative teacher details from teacher user document if available
      const effectiveTeacherName = lesson.teacherName || teacherData.name || studentData.teacherName || null;
      const effectiveTeacherEmail = cleanTeacherEmail || teacherData.email || studentData.teacherEmail || null;
      const effectiveTeacherMeet = lesson.meetLink || teacherData.meetUrl || teacherData.meetLink || '';

      const sanitizedLesson: LiveLesson = stampSchemaVersion({
        ...lesson,
        id: lesson.id,
        studentUid,
        studentEmail: cleanStudentEmail,
        studentName: lesson.studentName || studentData.name || cleanStudentEmail.split('@')[0],
        teacherUid,
        teacherEmail: effectiveTeacherEmail,
        teacherName: effectiveTeacherName,
        meetLink: effectiveTeacherMeet || lesson.meetLink || '',
        status: 'scheduled',
        isTrialLesson: Boolean(isTrialLesson),
        createdAt: lesson.createdAt || nowIso,
        updatedAt: nowIso,
      });

      // 2. Transaction writes
      transaction.set(lessonRef, sanitizedLesson, { merge: true });
      transaction.set(studentSubLessonRef, sanitizedLesson, { merge: true });

      // Student main document update with decremented balance and canonical teacher UID binding
      const studentUpdate: Record<string, any> = stampSchemaVersion({
        contractedLessons: newContracted,
        availableLessons: newAvailable,
        teacherUid,
        teacherEmail: effectiveTeacherEmail,
        teacherName: effectiveTeacherName,
        teacherMeetUrl: effectiveTeacherMeet,
        assignedNativeFriendUID: teacherUid,
        nativeFriendUID: teacherUid,
        enrollmentStatus: 'active',
        hasCompletedTrialLesson: isTrialLesson ? true : (studentData.hasCompletedTrialLesson ?? false),
        updatedAt: nowIso,
      });
      transaction.set(studentRef, studentUpdate, { merge: true });

      // Teacher user doc update
      const teacherSubLessonRef = doc(db, 'users', teacherUid, 'lessons', lesson.id);
      transaction.set(teacherSubLessonRef, sanitizedLesson, { merge: true });
      transaction.set(teacherRef, { updatedAt: nowIso }, { merge: true });

      return {
        lesson: sanitizedLesson,
        contractedLessons: newContracted,
        remainingLessons: newAvailable,
      };
    });

    return {
      success: true,
      lesson: result.lesson,
      contractedLessons: result.contractedLessons,
      remainingLessons: result.remainingLessons,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('Error in scheduleLessonWithTransaction:', errorMsg);
    if (
      !errorMsg.includes('Native Friend UID does not resolve') &&
      !errorMsg.includes('Native Friend account is not approved') &&
      !errorMsg.includes('User account is not a Native Friend')
    ) {
      handleFirestoreError(error, OperationType.WRITE, `lessons/${lesson.id}`);
    }
    return {
      success: false,
      error: errorMsg,
    };
  }
}

export interface PurchasePackageTransactionParams {
  studentUid: string;
  studentEmail: string;
  teacherEmail: string;
  teacherName: string;
  teacherUid?: string | null;
  packageLessons: number;
}

/**
 * ATOMIC FIRESTORE TRANSACTION FOR LESSON PACKAGE PURCHASES
 * Safely adds package lessons to contracted and available balances, and binds teacher ID.
 */
export async function purchasePackageWithTransaction(params: PurchasePackageTransactionParams): Promise<{
  success: boolean;
  contractedLessons?: number;
  availableLessons?: number;
  error?: string;
}> {
  const db = getDb();
  if (!db || !params.studentUid) {
    return { success: false, error: 'Database or student UID missing' };
  }

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

  // Canonical Native Friend UID: MUST be explicit canonical UID, NEVER derived from email or auth.currentUser
  const teacherUid =
    params.teacherUid && isValidCanonicalUid(params.teacherUid) ? params.teacherUid.trim() : '';

  if (!teacherUid) {
    return { success: false, error: 'Canonical Native Friend UID missing' };
  }

  if (studentUid === teacherUid) {
    return { success: false, error: 'Student UID and Native Friend UID cannot be identical' };
  }

  const studentRef = doc(db, 'users', studentUid);
  const teacherRef = doc(db, 'users', teacherUid);
  const nowIso = new Date().toISOString();

  // Align weekly live lesson target with purchased frequency (4 -> 1x, 8 -> 2x, 12 -> 3x)
  let newWeeklyTarget = 1;
  if (params.packageLessons === 4) newWeeklyTarget = 1;
  else if (params.packageLessons === 8) newWeeklyTarget = 2;
  else if (params.packageLessons === 12) newWeeklyTarget = 3;
  else if (params.packageLessons > 0) newWeeklyTarget = Math.min(7, Math.ceil(params.packageLessons / 4));

  try {
    const result = await runTransaction(db, async (transaction) => {
      const studentSnap = await transaction.get(studentRef);
      const teacherSnap = await transaction.get(teacherRef);

      // Validate teacher account existence in users/{teacherUid}
      if (!teacherSnap.exists()) {
        throw new Error('Native Friend UID does not resolve to an existing user');
      }

      const teacherData = (teacherSnap.data() || {}) as Record<string, any>;
      const isTeacherRole =
        teacherData.role === 'teacher' ||
        teacherData.role === 'admin' ||
        teacherData.isTeacher === true;

      if (!isTeacherRole) {
        throw new Error('User account is not a Native Friend');
      }

      const isApproved =
        teacherData.approvalStatus === 'approved' ||
        teacherData.isApproved === true ||
        teacherData.status === 'approved' ||
        teacherData.approved === true ||
        (teacherData.approvalStatus === undefined && teacherData.isApproved === undefined && teacherData.status === 'active');

      if (!isApproved || teacherData.approvalStatus === 'rejected' || teacherData.approvalStatus === 'pending') {
        throw new Error('Native Friend account is not approved');
      }

      const studentData = studentSnap.exists() ? (studentSnap.data() as Partial<UserProfile>) : {};
      const currentContracted = Number(studentData.contractedLessons ?? 0);
      const currentAvailable =
        studentData.availableLessons !== undefined ? Number(studentData.availableLessons) : currentContracted;

      const newContracted = currentContracted + params.packageLessons;
      const newAvailable = currentAvailable + params.packageLessons;

      const studentUpdate: Record<string, any> = stampSchemaVersion({
        contractedLessons: newContracted,
        availableLessons: newAvailable,
        teacherUid,
        teacherEmail: cleanTeacherEmail || teacherData.email || '',
        teacherName: params.teacherName || teacherData.name || '',
        assignedNativeFriendUID: teacherUid,
        nativeFriendUID: teacherUid,
        enrollmentStatus: 'active',
        weeklyNativeLessonsTarget: newWeeklyTarget,
        subscriptionType: 'package',
        updatedAt: nowIso,
      });

      transaction.set(studentRef, studentUpdate, { merge: true });
      transaction.set(teacherRef, { updatedAt: nowIso }, { merge: true });

      return {
        contractedLessons: newContracted,
        availableLessons: newAvailable,
      };
    });

    return {
      success: true,
      contractedLessons: result.contractedLessons,
      availableLessons: result.availableLessons,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('Error in purchasePackageWithTransaction:', errorMsg);
    if (
      !errorMsg.includes('Native Friend UID does not resolve') &&
      !errorMsg.includes('Native Friend account is not approved') &&
      !errorMsg.includes('User account is not a Native Friend')
    ) {
      handleFirestoreError(error, OperationType.WRITE, `users/${studentUid}`);
    }
    return {
      success: false,
      error: errorMsg,
    };
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
    assignedNativeFriendUID?: string | null;
    nativeFriendUID?: string | null;
    enrollmentStatus?: string;
  }
): Promise<boolean> {
  const db = getDb();
  if (!db) return false;
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

  // Business rule: Every active Student must be associated with a real, existing canonical Native Friend UID.
  // If enrollmentStatus is becoming "active" and no canonical Native Friend UID is supplied, reject safely.
  if (isBecomingActive && !explicitTeacherUid) {
    console.error('[Firestore Error] Canonical Native Friend UID missing for active enrollment');
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

  try {
    // Strictly write to doc(db, 'users', cleanUid) - authenticated user UID single source of truth
    await withFirestoreTimeout(setDoc(doc(db, 'users', cleanUid), payload, { merge: true }), 3000, null);
    return true;
  } catch (error) {
    console.error(`[Firestore Error] Failed to save student Native Friend for ${cleanUid}:`, error);
    handleFirestoreError(error, OperationType.WRITE, `users/${cleanUid}`);
    return false;
  }
}

/**
 * Persist the entire student profile directly to Firestore strictly using users/{cleanUid}.
 */
export async function saveStudentProfileToFirestore(
  studentUid: string,
  profile: Partial<UserProfile>,
  studentEmail?: string
): Promise<boolean> {
  const db = getDb();
  if (!db) return false;
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
    profile.teacherEmail !== undefined || profile.teacherName !== undefined || profile.teacherUid !== undefined;

  // For NEW active assignments, require a canonical Native Friend UID
  if (profile.enrollmentStatus === 'active' && isTeacherAssignment && !explicitTeacherUid) {
    console.error('[Firestore Error] Canonical Native Friend UID missing for active student assignment');
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

  try {
    const stampedPayload = stampSchemaVersion(payload);
    assertSafeFirestoreWrite(`users/${cleanUid}`, stampedPayload, undefined, true);

    // Strictly write to doc(db, 'users', cleanUid) - authenticated user UID single source of truth
    await withFirestoreTimeout(setDoc(doc(db, 'users', cleanUid), stampedPayload, { merge: true }), 3000, null);
    return true;
  } catch (error) {
    console.error(`[Firestore Error] Failed to save student profile for ${cleanUid}:`, error);
    handleFirestoreError(error, OperationType.WRITE, `users/${cleanUid}`);
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

/**
 * Update an existing lesson in Firestore.
 * Automatically mirrors the updated or cancelled status across root `lessons`,
 * the student's subcollection `users/{studentUid}/lessons`, user doc `scheduledLessons`,
 * teacher subcollection, and eliminates any duplicate/conflicting active slots.
 */
export async function updateLiveLessonInFirestore(
  lessonId: string,
  updates: Partial<LiveLesson>,
  studentUid?: string,
  teacherUid?: string,
  lessonData?: Partial<LiveLesson>,
  studentEmail?: string
): Promise<boolean> {
  const db = getDb();
  if (!db || !lessonId) return false;

  try {
    const sanitized = JSON.parse(JSON.stringify(updates));
    const nowIso = new Date().toISOString();
    const isCancelling = sanitized.status === 'cancelled' || sanitized.status === 'canceled' || Boolean(sanitized.cancelledAt);
    const fullUpdates = {
      ...sanitized,
      ...(isCancelling ? { status: 'cancelled', cancelledAt: sanitized.cancelledAt || nowIso } : {}),
      updatedAt: nowIso,
    };

    // 1. Fetch current lesson doc if studentUid or teacherUid is missing
    let effStudentUid = studentUid ? normalizeUid(studentUid, studentEmail) : '';
    let effStudentEmail = (studentEmail || '').toLowerCase().trim();
    let effTeacherUid = teacherUid ? normalizeUid(teacherUid) : '';
    let effTeacherEmail = (lessonData?.teacherEmail || '').toLowerCase().trim();
    let effStartDateTime = lessonData?.startDateTime || '';

    const lessonRef = doc(db, 'lessons', lessonId);
    const lessonSnap = await withFirestoreTimeout(getDoc(lessonRef), 2000, null);
    if (lessonSnap && lessonSnap.exists()) {
      const lData = lessonSnap.data();
      if (!effStudentUid && lData.studentUid) effStudentUid = normalizeUid(lData.studentUid, lData.studentEmail);
      if (!effStudentEmail && lData.studentEmail) effStudentEmail = (lData.studentEmail || '').toLowerCase().trim();
      if (!effTeacherUid && lData.teacherUid) effTeacherUid = normalizeUid(lData.teacherUid, lData.teacherEmail);
      if (!effTeacherEmail && lData.teacherEmail) effTeacherEmail = (lData.teacherEmail || '').toLowerCase().trim();
      if (!effStartDateTime && lData.startDateTime) effStartDateTime = lData.startDateTime;
    } else if (lessonData) {
      if (!effStudentUid && lessonData.studentUid) effStudentUid = normalizeUid(lessonData.studentUid, lessonData.studentEmail);
      if (!effStudentEmail && lessonData.studentEmail) effStudentEmail = (lessonData.studentEmail || '').toLowerCase().trim();
      if (!effTeacherUid && lessonData.teacherUid) effTeacherUid = normalizeUid(lessonData.teacherUid, lessonData.teacherEmail);
      if (!effTeacherEmail && lessonData.teacherEmail) effTeacherEmail = (lessonData.teacherEmail || '').toLowerCase().trim();
      if (!effStartDateTime && lessonData.startDateTime) effStartDateTime = lessonData.startDateTime;
    }

    // 2. Prepare complete root lesson payload
    const rootPayload = stampSchemaVersion({
      ...(lessonData || {}),
      id: lessonId,
      ...(effStudentUid ? { studentUid: effStudentUid } : {}),
      ...(effStudentEmail ? { studentEmail: effStudentEmail } : {}),
      ...(effTeacherUid ? { teacherUid: effTeacherUid } : {}),
      ...(effTeacherEmail ? { teacherEmail: effTeacherEmail } : {}),
      ...(effStartDateTime ? { startDateTime: effStartDateTime } : {}),
      ...fullUpdates,
    });

    assertSafeFirestoreWrite(`lessons/${lessonId}`, rootPayload, lessonSnap?.data(), true);

    // Update root lessons/{lessonId}
    await withFirestoreTimeout(setDoc(lessonRef, rootPayload, { merge: true }), 3000, null);

    // 3. Update student subcollection and scheduledLessons array across all canonical doc IDs
    const studentDocIds = Array.from(
      new Set(
        [
          effStudentUid,
          effStudentEmail,
          effStudentEmail ? normalizeUid(null, effStudentEmail) : '',
          effStudentEmail ? effStudentEmail.replace(/[^a-zA-Z0-9]/g, '-') : '',
          effStudentEmail ? `usr-${effStudentEmail.replace(/[^a-zA-Z0-9]/g, '-')}` : '',
        ].filter(Boolean)
      )
    );

    for (const docId of studentDocIds) {
      try {
        const userLessonRef = doc(db, 'users', docId, 'lessons', lessonId);
        await withFirestoreTimeout(setDoc(userLessonRef, rootPayload, { merge: true }), 2500, null);

        // Also update scheduledLessons array on student user doc
        const userRef = doc(db, 'users', docId);
        const userSnap = await withFirestoreTimeout(getDoc(userRef), 2000, null);
        if (userSnap && userSnap.exists()) {
          const uData = userSnap.data();
          if (Array.isArray(uData?.scheduledLessons)) {
            let updatedScheduled: LiveLesson[];
            if (isCancelling) {
              // Remove cancelled lesson from scheduledLessons array permanently so it never reappears on reload
              updatedScheduled = uData.scheduledLessons.filter((l: LiveLesson) => l.id !== lessonId);
            } else {
              updatedScheduled = uData.scheduledLessons.map((l: LiveLesson) =>
                l.id === lessonId ? { ...l, ...fullUpdates } : l
              );
            }
            await withFirestoreTimeout(
              setDoc(userRef, { scheduledLessons: updatedScheduled, updatedAt: nowIso }, { merge: true }),
              2000,
              null
            );
          }
        }
      } catch (subErr) {
        console.warn(`Notice updating student doc ${docId} for lesson:`, subErr);
      }
    }

    // 4. Update teacher subcollection and scheduledLessons array if applicable
    const teacherDocIds = Array.from(
      new Set(
        [
          effTeacherUid,
          effTeacherEmail,
          effTeacherEmail ? normalizeUid(null, effTeacherEmail) : '',
          effTeacherEmail ? effTeacherEmail.replace(/[^a-zA-Z0-9]/g, '-') : '',
          effTeacherEmail ? `usr-${effTeacherEmail.replace(/[^a-zA-Z0-9]/g, '-')}` : '',
        ].filter(Boolean)
      )
    );

    for (const tDocId of teacherDocIds) {
      try {
        const teacherLessonRef = doc(db, 'users', tDocId, 'lessons', lessonId);
        await withFirestoreTimeout(setDoc(teacherLessonRef, rootPayload, { merge: true }), 2000, null);

        const tUserRef = doc(db, 'users', tDocId);
        const tUserSnap = await withFirestoreTimeout(getDoc(tUserRef), 2000, null);
        if (tUserSnap && tUserSnap.exists()) {
          const tData = tUserSnap.data();
          if (Array.isArray(tData?.scheduledLessons)) {
            const updatedScheduled = isCancelling
              ? tData.scheduledLessons.filter((l: LiveLesson) => l.id !== lessonId)
              : tData.scheduledLessons.map((l: LiveLesson) => (l.id === lessonId ? { ...l, ...fullUpdates } : l));
            await withFirestoreTimeout(
              setDoc(tUserRef, { scheduledLessons: updatedScheduled, updatedAt: nowIso }, { merge: true }),
              2000,
              null
            );
          }
        }
      } catch {}
    }

    // 5. If cancelling, also cancel any duplicate root lesson entries for this student at the same startDateTime
    if (isCancelling && effStudentEmail && effStartDateTime) {
      try {
        const qDuplicate = query(
          collection(db, 'lessons'),
          where('studentEmail', '==', effStudentEmail),
          where('startDateTime', '==', effStartDateTime)
        );
        const dupSnap = await withFirestoreTimeout(getDocs(qDuplicate), 2000, null);
        if (dupSnap && !dupSnap.empty) {
          for (const d of dupSnap.docs) {
            if (d.id !== lessonId) {
              await withFirestoreTimeout(
                setDoc(
                  d.ref,
                  {
                    status: 'cancelled',
                    cancelledAt: nowIso,
                    cancelledBy: fullUpdates.cancelledBy || 'user',
                    cancellationReason: fullUpdates.cancellationReason || 'Cancelled',
                    updatedAt: nowIso,
                  },
                  { merge: true }
                ),
                1500,
                null
              );
            }
          }
        }
      } catch {}
    }

    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `lessons/${lessonId}`);
    return false;
  }
}

/**
 * Delete a lesson in Firestore permanently.
 */
export async function deleteLiveLessonFromFirestore(
  lessonId: string,
  studentUid?: string,
  studentEmail?: string
): Promise<boolean> {
  const db = getDb();
  if (!db || !lessonId) return false;

  try {
    let effStudentUid = studentUid ? normalizeUid(studentUid, studentEmail) : '';
    let effStudentEmail = (studentEmail || '').toLowerCase().trim();
    const lessonRef = doc(db, 'lessons', lessonId);
    if (!effStudentUid) {
      const lessonSnap = await withFirestoreTimeout(getDoc(lessonRef), 2000, null);
      if (lessonSnap && lessonSnap.exists()) {
        const lData = lessonSnap.data();
        effStudentUid = normalizeUid(lData.studentUid, lData.studentEmail);
        if (!effStudentEmail && lData.studentEmail) effStudentEmail = (lData.studentEmail || '').toLowerCase().trim();
      }
    }

    await withFirestoreTimeout(deleteDoc(lessonRef), 2500, null);

    const studentDocIds = Array.from(
      new Set(
        [
          effStudentUid,
          effStudentEmail,
          effStudentEmail ? normalizeUid(null, effStudentEmail) : '',
          effStudentEmail ? effStudentEmail.replace(/[^a-zA-Z0-9]/g, '-') : '',
          effStudentEmail ? `usr-${effStudentEmail.replace(/[^a-zA-Z0-9]/g, '-')}` : '',
        ].filter(Boolean)
      )
    );

    for (const docId of studentDocIds) {
      try {
        const userLessonRef = doc(db, 'users', docId, 'lessons', lessonId);
        await withFirestoreTimeout(deleteDoc(userLessonRef), 2000, null);

        // Remove from user doc scheduledLessons
        const userRef = doc(db, 'users', docId);
        const userSnap = await withFirestoreTimeout(getDoc(userRef), 2000, null);
        if (userSnap && userSnap.exists()) {
          const uData = userSnap.data();
          if (Array.isArray(uData?.scheduledLessons)) {
            const filtered = uData.scheduledLessons.filter((l: LiveLesson) => l.id !== lessonId);
            await withFirestoreTimeout(
              setDoc(userRef, { scheduledLessons: filtered, updatedAt: new Date().toISOString() }, { merge: true }),
              2000,
              null
            );
          }
        }
      } catch {}
    }
    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `lessons/${lessonId}`);
    return false;
  }
}

/**
 * Fetch all lessons for a student or teacher directly from Firestore.
 * Supports both student and teacher queries, prioritizing root `lessons` and
 * ensuring cancelled status is never overwritten by stale local snapshots.
 */
export async function fetchStudentLessonsFromFirestore(
  uid: string,
  email?: string,
  isTeacher?: boolean
): Promise<LiveLesson[]> {
  const db = getDb();
  const cleanUid = normalizeUid(uid, email);
  const cleanEmail = (email || '').toLowerCase().trim();
  const hyphenUid = cleanEmail ? `usr-${cleanEmail.replace(/[^a-zA-Z0-9]/g, '-')}` : '';
  const rawHyphen = cleanEmail ? cleanEmail.replace(/[^a-zA-Z0-9]/g, '-') : '';
  if (!db) return [];

  try {
    const lessonsMap = new Map<string, LiveLesson>();

    const addOrUpdate = (item: LiveLesson) => {
      if (!item || !item.id) return;
      const isItemCancelled = item.status === 'cancelled' || (item.status as string) === 'canceled' || Boolean(item.cancelledAt);
      const normalizedItem: LiveLesson = {
        ...item,
        ...(isItemCancelled ? { status: 'cancelled', cancelledAt: item.cancelledAt || new Date().toISOString() } : {}),
      };

      const existing = lessonsMap.get(normalizedItem.id);
      if (existing) {
        // Strict invariant: If existing or item is cancelled, strictly keep cancelled!
        const isCancelled = existing.status === 'cancelled' || normalizedItem.status === 'cancelled' || Boolean(existing.cancelledAt) || Boolean(normalizedItem.cancelledAt);
        const cancelledAt = existing.cancelledAt || normalizedItem.cancelledAt;
        const cancelledBy = existing.cancelledBy || normalizedItem.cancelledBy;
        const cancellationReason = existing.cancellationReason || normalizedItem.cancellationReason;
        const merged: LiveLesson = { ...existing, ...normalizedItem };
        if (isCancelled) {
          merged.status = 'cancelled';
          merged.cancelledAt = cancelledAt || new Date().toISOString();
          if (cancelledBy) merged.cancelledBy = cancelledBy;
          if (cancellationReason) merged.cancellationReason = cancellationReason;
        }
        lessonsMap.set(normalizedItem.id, merged);
      } else {
        lessonsMap.set(normalizedItem.id, normalizedItem);
      }
    };

    // 1. If teacher or admin, query root lessons by teacherUid / teacherEmail
    if (isTeacher) {
      if (cleanUid) {
        try {
          const qTeacherUid = query(collection(db, 'lessons'), where('teacherUid', '==', cleanUid));
          const snap = await withFirestoreTimeout(getDocs(qTeacherUid), 2500, null);
          if (snap && !snap.empty) {
            snap.forEach((d) => addOrUpdate(d.data() as LiveLesson));
          }
        } catch {}
      }
      if (cleanEmail) {
        try {
          const qTeacherEmail = query(collection(db, 'lessons'), where('teacherEmail', '==', cleanEmail));
          const snap = await withFirestoreTimeout(getDocs(qTeacherEmail), 2500, null);
          if (snap && !snap.empty) {
            snap.forEach((d) => addOrUpdate(d.data() as LiveLesson));
          }
        } catch {}
      }
      if (hyphenUid && hyphenUid !== cleanUid) {
        try {
          const qTeacherHyphen = query(collection(db, 'lessons'), where('teacherUid', '==', hyphenUid));
          const snap = await withFirestoreTimeout(getDocs(qTeacherHyphen), 2500, null);
          if (snap && !snap.empty) {
            snap.forEach((d) => addOrUpdate(d.data() as LiveLesson));
          }
        } catch {}
      }
    }

    // 2. Query root collection by studentUid
    if (cleanUid) {
      try {
        const qUid = query(collection(db, 'lessons'), where('studentUid', '==', cleanUid));
        const snapUid = await withFirestoreTimeout(getDocs(qUid), 2500, null);
        if (snapUid && !snapUid.empty) {
          snapUid.forEach((d) => addOrUpdate(d.data() as LiveLesson));
        }
      } catch {}
    }

    // 3. Query root collection by studentEmail
    if (cleanEmail) {
      try {
        const qEmail = query(collection(db, 'lessons'), where('studentEmail', '==', cleanEmail));
        const snapEmail = await withFirestoreTimeout(getDocs(qEmail), 2500, null);
        if (snapEmail && !snapEmail.empty) {
          snapEmail.forEach((d) => addOrUpdate(d.data() as LiveLesson));
        }
      } catch {}
    }

    // 3b. Query root collection by hyphenUid (legacy format e.g. usr-reginahelena1980-gmail-com)
    if (hyphenUid && hyphenUid !== cleanUid) {
      try {
        const qHyphen = query(collection(db, 'lessons'), where('studentUid', '==', hyphenUid));
        const snapHyphen = await withFirestoreTimeout(getDocs(qHyphen), 2500, null);
        if (snapHyphen && !snapHyphen.empty) {
          snapHyphen.forEach((d) => addOrUpdate(d.data() as LiveLesson));
        }
      } catch {}
    }

    // 4. Query student's subcollection users/{cleanUid}/lessons
    const targetStudentDocIds = Array.from(new Set([cleanUid, hyphenUid, rawHyphen, cleanEmail].filter(Boolean)));
    for (const sDocId of targetStudentDocIds) {
      try {
        const subCol = collection(db, 'users', sDocId, 'lessons');
        const subSnap = await withFirestoreTimeout(getDocs(subCol), 2000, null);
        if (subSnap && !subSnap.empty) {
          subSnap.forEach((d) => addOrUpdate(d.data() as LiveLesson));
        }
      } catch {}

      // 5. Query user doc scheduledLessons
      try {
        const userRef = doc(db, 'users', sDocId);
        const userSnap = await withFirestoreTimeout(getDoc(userRef), 2000, null);
        if (userSnap && userSnap.exists()) {
          const data = userSnap.data();
          if (Array.isArray(data?.scheduledLessons)) {
            data.scheduledLessons.forEach((l: LiveLesson) => addOrUpdate(l));
          }
        }
      } catch {}
    }

    // Invariant: If a student has a cancelled lesson at a specific startDateTime,
    // any duplicate active lesson at that startDateTime must also be marked cancelled!
    const cancelledSlots = new Set<string>();
    lessonsMap.forEach((l) => {
      if (l.status === 'cancelled' || l.cancelledAt) {
        const slotKey = `${(l.studentEmail || '').toLowerCase().trim()}_${l.startDateTime}`;
        cancelledSlots.add(slotKey);
      }
    });

    lessonsMap.forEach((l, id) => {
      const slotKey = `${(l.studentEmail || '').toLowerCase().trim()}_${l.startDateTime}`;
      if (cancelledSlots.has(slotKey) && l.status !== 'cancelled') {
        lessonsMap.set(id, {
          ...l,
          status: 'cancelled',
          cancelledAt: l.cancelledAt || new Date().toISOString(),
        });
      }
    });

    const list = Array.from(lessonsMap.values());
    list.sort((a, b) => {
      const tA = new Date(a.startDateTime).getTime();
      const tB = new Date(b.startDateTime).getTime();
      return tB - tA;
    });

    return list;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'lessons');
    return [];
  }
}

/**
 * Subscribe to real-time lessons updates in Firestore for a student or teacher.
 * Robust cross-device sync with query doc mapping across root lessons and user subcollections.
 */
export function subscribeToStudentLessons(
  studentUid: string,
  studentEmail: string | undefined,
  isTeacher: boolean,
  callback: (lessons: LiveLesson[]) => void
): () => void {
  const db = getDb();
  if (!db) return () => {};
  const cleanUid = normalizeUid(studentUid, studentEmail);
  const cleanEmail = (studentEmail || '').toLowerCase().trim();
  const hyphenUid = cleanEmail ? `usr-${cleanEmail.replace(/[^a-zA-Z0-9]/g, '-')}` : '';

  const unsubscribers: (() => void)[] = [];
  const queryDocsMap = new Map<string, Map<string, LiveLesson>>();
  let notifyTimer: any = null;

  const rebuildAndNotify = () => {
    if (notifyTimer) clearTimeout(notifyTimer);
    notifyTimer = setTimeout(() => {
      const consolidatedMap = new Map<string, LiveLesson>();

      // Merge docs across all active query snapshots, respecting latest updatedAt and strictly preserving cancelled state
      queryDocsMap.forEach((docsMap) => {
        docsMap.forEach((item, id) => {
          if (!item || !id) return;
          const isItemCancelled =
            item.status === 'cancelled' ||
            (item.status as string) === 'canceled' ||
            Boolean(item.cancelledAt);
          const normalizedItem: LiveLesson = {
            ...item,
            id,
            ...(isItemCancelled
              ? { status: 'cancelled', cancelledAt: item.cancelledAt || new Date().toISOString() }
              : {}),
          };
          const existing = consolidatedMap.get(id);
          if (existing) {
            const isCancelled =
              existing.status === 'cancelled' ||
              normalizedItem.status === 'cancelled' ||
              Boolean(existing.cancelledAt) ||
              Boolean(normalizedItem.cancelledAt);
            const cancelledAt = existing.cancelledAt || normalizedItem.cancelledAt;
            const cancelledBy = existing.cancelledBy || normalizedItem.cancelledBy;
            const cancellationReason = existing.cancellationReason || normalizedItem.cancellationReason;
            const timeExisting = new Date(existing.updatedAt || existing.startDateTime || 0).getTime();
            const timeItem = new Date(normalizedItem.updatedAt || normalizedItem.startDateTime || 0).getTime();
            const latest =
              timeItem >= timeExisting ? { ...existing, ...normalizedItem } : { ...normalizedItem, ...existing };
            if (isCancelled) {
              latest.status = 'cancelled';
              latest.cancelledAt = cancelledAt || new Date().toISOString();
              if (cancelledBy) latest.cancelledBy = cancelledBy;
              if (cancellationReason) latest.cancellationReason = cancellationReason;
            }
            consolidatedMap.set(id, latest);
          } else {
            consolidatedMap.set(id, normalizedItem);
          }
        });
      });

      // Invariant: If a student has a cancelled lesson at a specific startDateTime,
      // any duplicate active lesson at that startDateTime must also be marked cancelled
      const cancelledSlots = new Set<string>();
      consolidatedMap.forEach((l) => {
        if (l.status === 'cancelled' || l.cancelledAt) {
          const slotKey = `${(l.studentEmail || '').toLowerCase().trim()}_${l.startDateTime}`;
          cancelledSlots.add(slotKey);
        }
      });

      consolidatedMap.forEach((l, id) => {
        const slotKey = `${(l.studentEmail || '').toLowerCase().trim()}_${l.startDateTime}`;
        if (cancelledSlots.has(slotKey) && l.status !== 'cancelled') {
          consolidatedMap.set(id, {
            ...l,
            status: 'cancelled',
            cancelledAt: l.cancelledAt || new Date().toISOString(),
          });
        }
      });

      const list = Array.from(consolidatedMap.values());
      list.sort((a, b) => {
        const tA = new Date(a.startDateTime).getTime();
        const tB = new Date(b.startDateTime).getTime();
        return tB - tA;
      });

      callback(list);
    }, 50);
  };

  const handleQuerySnap = (queryKey: string, snap: any) => {
    const docsMap = new Map<string, LiveLesson>();
    snap.forEach((d: any) => {
      const data = d.data() as LiveLesson;
      const lessonId = data.id || d.id;
      docsMap.set(lessonId, { ...data, id: lessonId });
    });
    queryDocsMap.set(queryKey, docsMap);
    rebuildAndNotify();
  };

  try {
    if (isTeacher) {
      if (cleanUid) {
        const qUid = query(collection(db, 'lessons'), where('teacherUid', '==', cleanUid));
        unsubscribers.push(
          onSnapshot(
            qUid,
            (snap) => handleQuerySnap('t_uid', snap),
            (err) => console.warn('Teacher UID lessons snapshot notice:', err)
          )
        );
      }
      if (cleanEmail && cleanEmail !== cleanUid) {
        const qEmail = query(collection(db, 'lessons'), where('teacherEmail', '==', cleanEmail));
        unsubscribers.push(
          onSnapshot(
            qEmail,
            (snap) => handleQuerySnap('t_email', snap),
            (err) => console.warn('Teacher email lessons snapshot notice:', err)
          )
        );
      }
    } else {
      if (cleanUid) {
        const qUid = query(collection(db, 'lessons'), where('studentUid', '==', cleanUid));
        unsubscribers.push(
          onSnapshot(
            qUid,
            (snap) => handleQuerySnap('s_uid', snap),
            (err) => console.warn('Student UID lessons snapshot notice:', err)
          )
        );
      }
      if (cleanEmail && cleanEmail !== cleanUid) {
        const qEmail = query(collection(db, 'lessons'), where('studentEmail', '==', cleanEmail));
        unsubscribers.push(
          onSnapshot(
            qEmail,
            (snap) => handleQuerySnap('s_email', snap),
            (err) => console.warn('Student email lessons snapshot notice:', err)
          )
        );
      }
    }
  } catch (err) {
    console.warn('subscribeToStudentLessons init notice:', err);
  }

  return () => {
    if (notifyTimer) clearTimeout(notifyTimer);
    unsubscribers.forEach((unsub) => unsub());
  };
}

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
  const db = getDb();
  const cleanEmail = (studentEmail || '').toLowerCase().trim();
  const cleanUid = normalizeUid(studentUid, cleanEmail);
  if (!db || !cleanUid) return () => {};

  const explicitWeekId = normalizeWeekId(week);
  const explicitCycle = parseWeekCycleNumber(week);

  let activeWeekUnsub: (() => void) | null = null;
  let profileUnsub: (() => void) | null = null;
  let currentSubscribedWeekId: string | null = null;

  const subscribeToSpecificWeek = (targetWeekId: string, cycleNumber: number, fallbackToLegacyRoot: boolean = false) => {
    if (currentSubscribedWeekId === targetWeekId && activeWeekUnsub) {
      return;
    }
    if (activeWeekUnsub) {
      activeWeekUnsub();
      activeWeekUnsub = null;
    }
    currentSubscribedWeekId = targetWeekId;

    const weekDocRef = doc(db, 'users', cleanUid, 'weeklyChecks', targetWeekId);
    activeWeekUnsub = onSnapshot(
      weekDocRef,
      async (weekSnap) => {
        if (weekSnap.exists()) {
          const wData = weekSnap.data();
          const docChecks: Record<string, boolean> = {
            ...(wData?.checks || {}),
            ...(wData?.weeklyChecks || {}),
            ...(wData?.sPathChecks || {}),
          };
          cacheWeeklyChecksLocally(cleanUid, cleanEmail, docChecks, targetWeekId);
          callback({
            checks: docChecks,
            weeklyNativeLessonsTarget: wData?.weeklyNativeLessonsTarget,
            weeklyStudyDaysTarget: wData?.weeklyStudyDaysTarget,
            weekId: targetWeekId,
            weeklyCycle: cycleNumber,
          });
        } else if (fallbackToLegacyRoot && cycleNumber === 1) {
          // Backward compatibility for Week 1 only when no week-1 document exists yet
          try {
            const userRef = doc(db, 'users', cleanUid);
            const userSnap = await withFirestoreTimeout(getDoc(userRef), 2000, null);
            if (userSnap && userSnap.exists()) {
              const uData = userSnap.data();
              const baseChecks: Record<string, boolean> = {
                ...(uData?.weeklyChecks || {}),
                ...(uData?.sPathChecks || {}),
              };
              if (uData?.weeklyHomework?.completedPartsByDay && typeof uData.weeklyHomework.completedPartsByDay === 'object') {
                Object.entries(uData.weeklyHomework.completedPartsByDay).forEach(([day, isDone]) => {
                  if (isDone) baseChecks[`memorization_${day}`] = true;
                });
              }
              try {
                const memoCol = collection(db, 'users', cleanUid, 'memorization');
                const memoSnaps = await withFirestoreTimeout(getDocs(memoCol), 1500, null);
                if (memoSnaps && !memoSnaps.empty) {
                  memoSnaps.forEach((d) => {
                    if (d.data()?.completed) {
                      baseChecks[`memorization_${d.id}`] = true;
                    }
                  });
                }
              } catch {}
              try {
                const hwDoc = doc(db, 'users', cleanUid, 'homework', 'current_week');
                const hwSnap = await withFirestoreTimeout(getDoc(hwDoc), 1500, null);
                if (hwSnap && hwSnap.exists()) {
                  const hwData = hwSnap.data();
                  if (hwData?.completedPartsByDay && typeof hwData.completedPartsByDay === 'object') {
                    Object.entries(hwData.completedPartsByDay).forEach(([day, isDone]) => {
                      if (isDone) baseChecks[`memorization_${day}`] = true;
                    });
                  }
                }
              } catch {}

              cacheWeeklyChecksLocally(cleanUid, cleanEmail, baseChecks, targetWeekId);
              callback({
                checks: baseChecks,
                weeklyNativeLessonsTarget: uData?.weeklyNativeLessonsTarget,
                weeklyStudyDaysTarget: uData?.weeklyStudyDaysTarget,
                weekId: targetWeekId,
                weeklyCycle: 1,
              });
              return;
            }
          } catch {}
          cacheWeeklyChecksLocally(cleanUid, cleanEmail, {}, targetWeekId);
          callback({ checks: {}, weekId: targetWeekId, weeklyCycle: 1 });
        } else {
          // Week 2 onward: NEVER fall back to legacy root checks. Start clean.
          cacheWeeklyChecksLocally(cleanUid, cleanEmail, {}, targetWeekId);
          callback({
            checks: {},
            weekId: targetWeekId,
            weeklyCycle: cycleNumber,
          });
        }
      },
      (err) => {
        console.warn(`Real-time weeklyChecks notice for ${cleanUid}/${targetWeekId}:`, err);
      }
    );
  };

  if (explicitWeekId && explicitCycle) {
    subscribeToSpecificWeek(explicitWeekId, explicitCycle, explicitCycle === 1);
  } else {
    // Week identity not explicitly passed: observe user profile to resolve active cycle
    // CRITICAL: If weeklyCycle cannot be determined, do NOT silently default to Week 1!
    const userRef = doc(db, 'users', cleanUid);
    profileUnsub = onSnapshot(
      userRef,
      (uSnap) => {
        if (uSnap.exists()) {
          const uData = uSnap.data();
          const resolvedCycle = typeof uData?.weeklyCycle === 'number' && uData.weeklyCycle > 0 ? uData.weeklyCycle : null;
          if (resolvedCycle) {
            const resolvedWeekId = `week-${resolvedCycle}`;
            subscribeToSpecificWeek(resolvedWeekId, resolvedCycle, resolvedCycle === 1);
          } else {
            console.warn(
              `[studentPersistence] subscribeToStudentWeeklyChecks: User ${cleanUid} has no weeklyCycle defined. Caller must provide explicit week parameter (Phase 02-B dependency). Refusing to default to Week 1.`
            );
          }
        }
      },
      (err) => console.warn(`Real-time notice for profile user ${cleanUid}:`, err)
    );
  }

  return () => {
    if (activeWeekUnsub) activeWeekUnsub();
    if (profileUnsub) profileUnsub();
  };
}

/**
 * Persist student S-Path (Gráfico S) weekly checks to Firestore under users/{studentUID}/weeklyChecks/week-${cycle}.
 * Requirements:
 * - Scoped to the requested week (users/{uid}/weeklyChecks/week-${cycle}).
 * - Prevents checks from previous weeks from being merged into the current week.
 * - Week 1: preserves backward compatibility by reading root doc if week-1 doc does not exist yet.
 * - Week 2+: never falls back to legacy root-level checks or merges previous weeks.
 * - Refuses to silently default to Week 1 when week identity is unknown.
 */
export async function saveStudentWeeklyChecksToFirestore(
  studentUid: string,
  checks: Record<string, boolean>,
  studentEmail?: string,
  weeklyNativeLessonsTarget?: number,
  weeklyStudyDaysTarget?: number,
  week?: string | number | null
): Promise<boolean> {
  const db = getDb();
  const cleanEmail = (studentEmail || '').toLowerCase().trim();
  const cleanUid = normalizeUid(studentUid, cleanEmail);

  try {
    const sanitizedChecks: Record<string, boolean> = JSON.parse(JSON.stringify(checks || {}));

    let targetWeekId = normalizeWeekId(week);
    let targetCycle = parseWeekCycleNumber(week);

    // If caller omitted week identity, attempt to resolve from user profile
    if (!targetWeekId && db && cleanUid) {
      try {
        const userRef = doc(db, 'users', cleanUid);
        const uSnap = await withFirestoreTimeout(getDoc(userRef), 2000, null);
        if (uSnap && uSnap.exists()) {
          const uData = uSnap.data();
          if (typeof uData?.weeklyCycle === 'number' && uData.weeklyCycle > 0) {
            targetCycle = uData.weeklyCycle;
            targetWeekId = `week-${targetCycle}`;
          }
        }
      } catch {}
    }

    if (!targetWeekId || !targetCycle) {
      console.warn(
        `[studentPersistence] saveStudentWeeklyChecksToFirestore: Week identity is unknown for ${cleanUid}. Explicit week parameter required (Phase 02-B dependency). Refusing to default to Week 1.`
      );
      return false;
    }

    if (db && cleanUid) {
      const weekDocRef = doc(db, 'users', cleanUid, 'weeklyChecks', targetWeekId);

      // Fetch existing checks for THIS WEEK ONLY to prevent previous weeks from being merged
      let existingWeekChecks: Record<string, boolean> = {};
      try {
        const weekSnap = await withFirestoreTimeout(getDoc(weekDocRef), 2000, null);
        if (weekSnap && weekSnap.exists()) {
          const wData = weekSnap.data();
          existingWeekChecks = {
            ...(wData?.checks || {}),
            ...(wData?.weeklyChecks || {}),
            ...(wData?.sPathChecks || {}),
          };
        } else if (targetCycle === 1) {
          // Backward compatibility for Week 1 only when no week-1 document exists yet
          const userRef = doc(db, 'users', cleanUid);
          const uSnap = await withFirestoreTimeout(getDoc(userRef), 2000, null);
          if (uSnap && uSnap.exists()) {
            const uData = uSnap.data();
            existingWeekChecks = {
              ...(uData?.weeklyChecks || {}),
              ...(uData?.sPathChecks || {}),
            };
            if (uData?.weeklyHomework?.completedPartsByDay) {
              Object.entries(uData.weeklyHomework.completedPartsByDay).forEach(([day, isDone]) => {
                if (isDone) existingWeekChecks[`memorization_${day}`] = true;
              });
            }
          }
        }
      } catch {}

      const mergedChecks: Record<string, boolean> = {
        ...existingWeekChecks,
        ...sanitizedChecks,
      };

      const weekPayload: Record<string, any> = {
        id: targetWeekId,
        weekId: targetWeekId,
        weeklyCycle: targetCycle,
        checks: mergedChecks,
        weeklyChecks: mergedChecks,
        sPathChecks: mergedChecks,
        updatedAt: new Date().toISOString(),
        studentUid: cleanUid,
        studentEmail: cleanEmail || null,
      };
      if (typeof weeklyNativeLessonsTarget === 'number') {
        weekPayload.weeklyNativeLessonsTarget = weeklyNativeLessonsTarget;
      }
      if (typeof weeklyStudyDaysTarget === 'number') {
        weekPayload.weeklyStudyDaysTarget = weeklyStudyDaysTarget;
      }

      const stampedWeekPayload = stampSchemaVersion(weekPayload);
      assertSafeFirestoreWrite(`users/${cleanUid}/weeklyChecks/${targetWeekId}`, stampedWeekPayload, existingWeekChecks, true);

      // 1. Write strictly to users/{uid}/weeklyChecks/week-${cycle}
      await withFirestoreTimeout(setDoc(weekDocRef, stampedWeekPayload, { merge: true }), 3500, null);

      // 2. Update user profile root document: targets, and for Week 1 ONLY keep legacy root checks for backward compatibility
      const userRef = doc(db, 'users', cleanUid);
      const userUpdate: Record<string, any> = {
        updatedAt: new Date().toISOString(),
      };
      if (typeof weeklyNativeLessonsTarget === 'number') {
        userUpdate.weeklyNativeLessonsTarget = weeklyNativeLessonsTarget;
      }
      if (typeof weeklyStudyDaysTarget === 'number') {
        userUpdate.weeklyStudyDaysTarget = weeklyStudyDaysTarget;
      }
      if (targetCycle === 1) {
        userUpdate.weeklyChecks = mergedChecks;
        userUpdate.sPathChecks = mergedChecks;
      }

      await withFirestoreTimeout(setDoc(userRef, stampSchemaVersion(userUpdate), { merge: true }), 2500, null);

      // Ensure memorization checkmarks are also recorded in users/{cleanUid}/memorization/{day} subcollection
      const memoPromises: Promise<any>[] = [];
      Object.entries(mergedChecks).forEach(([key, isDone]) => {
        if (key.startsWith('memorization_') && isDone) {
          const day = key.replace('memorization_', '');
          const memoDocRef = doc(db, 'users', cleanUid, 'memorization', day);
          memoPromises.push(
            setDoc(
              memoDocRef,
              stampSchemaVersion({
                day,
                completed: true,
                completedAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              }),
              { merge: true }
            )
          );
        }
      });
      if (memoPromises.length > 0) {
        await Promise.all(memoPromises).catch(() => {});
      }

      // Update in-memory session cache scoped to targetWeekId
      cacheWeeklyChecksLocally(cleanUid, cleanEmail, mergedChecks, targetWeekId);
    }

    // Mirror to backend server API for disk persistence & multi-device sync
    if (cleanEmail || cleanUid) {
      getAccessToken().then((token) => {
        if (!token) return;
        const currentAuthEmail = (auth?.currentUser?.email || '').toLowerCase().trim();
        const safeStudentEmail = (cleanEmail && cleanEmail.includes('@') && (!currentAuthEmail || currentAuthEmail === cleanEmail)) ? cleanEmail : undefined;
        fetch('/api/routines/weekly-checks', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            studentUid: cleanUid,
            ...(safeStudentEmail ? { studentEmail: safeStudentEmail } : {}),
            checks: sanitizedChecks,
            weekId: targetWeekId,
            weeklyCycle: targetCycle,
            weeklyNativeLessonsTarget,
            weeklyStudyDaysTarget,
          }),
        }).catch(() => {});
      }).catch(() => {});
    }

    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `users/${cleanUid}/weeklyChecks`);
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
  const db = getDb();
  const cleanEmail = (studentEmail || '').toLowerCase().trim();
  const cleanUid = normalizeUid(studentUid, cleanEmail);

  if (!day || !cleanUid || !db) return false;

  const checkKey = `memorization_${day}`;
  const nowIso = new Date().toISOString();

  // 1. Resolve canonical week BEFORE performing any related persistence operation.
  // Treat the legacy "current_week" value (or omitted/empty weekId) as an alias that requires resolution
  // from the student's persisted weeklyCycle, NOT as a canonical week.
  const isCurrentWeekAlias = !weekId || weekId === 'current_week' || (typeof weekId === 'string' && weekId.trim() === '');
  let targetCycle: number | null = null;
  let targetWeekId: string | null = null;
  let existingData: any = {};
  const userRef = doc(db, 'users', cleanUid);

  try {
    const userSnap = await withFirestoreTimeout(getDoc(userRef), 2000, null);
    if (userSnap && userSnap.exists()) {
      existingData = userSnap.data() || {};
    }
  } catch (readErr) {
    console.warn(`[studentPersistence] saveMemorizationCompletionToFirestore read error for ${cleanUid}:`, readErr);
  }

  if (isCurrentWeekAlias) {
    targetCycle = parseWeekCycleNumber(existingData?.weeklyCycle);
  } else {
    // Explicit week parameter supplied by caller
    targetCycle = parseWeekCycleNumber(weekId);
  }

  if (targetCycle !== null) {
    targetWeekId = `week-${targetCycle}`;
  }

  // If resolution fails, abort safely without partially updating weekly checks, homework completion, or journal entries.
  // Never create a Week 1 journal entry as a fallback!
  if (!targetCycle || !targetWeekId) {
    console.warn(
      `[studentPersistence] saveMemorizationCompletionToFirestore: Failed to resolve canonical week for student ${cleanUid} (weekId: '${weekId}'). Aborting safely without partially updating weekly checks, homework, or journal.`
    );
    return false;
  }

  // 2. Perform all persistence operations strictly scoped to the canonical week
  try {
    // Update in-memory session cache scoped to the canonical week
    const currentCached = getCachedWeeklyChecks(cleanUid, cleanEmail, targetWeekId);
    cacheWeeklyChecksLocally(
      cleanUid,
      cleanEmail,
      {
        ...currentCached,
        [checkKey]: isCompleted,
      },
      targetWeekId
    );

    // 2a. Update week-specific weeklyChecks document users/{cleanUid}/weeklyChecks/week-${cycle}
    const weekDocRef = doc(db, 'users', cleanUid, 'weeklyChecks', targetWeekId);
    let existingWeekChecks: Record<string, boolean> = {};
    try {
      const weekSnap = await withFirestoreTimeout(getDoc(weekDocRef), 1500, null);
      if (weekSnap && weekSnap.exists()) {
        const wData = weekSnap.data();
        existingWeekChecks = {
          ...(wData?.checks || {}),
          ...(wData?.weeklyChecks || {}),
          ...(wData?.sPathChecks || {}),
        };
      } else if (targetCycle === 1) {
        existingWeekChecks = {
          ...(existingData?.weeklyChecks || {}),
          ...(existingData?.sPathChecks || {}),
        };
      }
    } catch {}

    const updatedWeekChecks = {
      ...existingWeekChecks,
      [checkKey]: isCompleted,
    };

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
          updatedAt: nowIso,
          studentUid: cleanUid,
          studentEmail: cleanEmail || null,
        }),
        { merge: true }
      ),
      2500,
      null
    );

    cacheWeeklyChecksLocally(cleanUid, cleanEmail, updatedWeekChecks, targetWeekId);

    // 2b. Update user root document: homework and (for Week 1 only) legacy root checks for backward compatibility
    const existingHw = existingData?.weeklyHomework || homeworkData || {};
    const existingParts = existingHw?.completedPartsByDay || {};
    const updatedParts = {
      ...existingParts,
      [day]: isCompleted,
    };
    const updatedHw = {
      ...existingHw,
      isDayPartCompleted: isCompleted,
      completedPartsByDay: updatedParts,
      updatedAt: nowIso,
    };

    const userDocUpdate: Record<string, any> = {
      updatedAt: nowIso,
    };

    // Only update root weeklyHomework and weeklyChecks if Week 1 (backward compatibility)
    if (targetCycle === 1) {
      userDocUpdate.weeklyHomework = updatedHw;
      const rootChecks = {
        ...(existingData?.weeklyChecks || {}),
        ...(existingData?.sPathChecks || {}),
        [checkKey]: isCompleted,
      };
      userDocUpdate.weeklyChecks = rootChecks;
      userDocUpdate.sPathChecks = rootChecks;
    }

    // 2c. Write to users/{cleanUid}/memorization/{day}
    const memoDocRef = doc(db, 'users', cleanUid, 'memorization', day);
    await withFirestoreTimeout(
      setDoc(
        memoDocRef,
        {
          day,
          completed: isCompleted,
          completedAt: nowIso,
          updatedAt: nowIso,
        },
        { merge: true }
      ),
      2500,
      null
    );

    // 2d. Write to users/{cleanUid}/homework/{targetWeekId} (using canonical week ID)
    const hwDocRef = doc(db, 'users', cleanUid, 'homework', targetWeekId);
    await withFirestoreTimeout(
      setDoc(
        hwDocRef,
        {
          id: targetWeekId,
          completedPartsByDay: updatedParts,
          isDayPartCompleted: isCompleted,
          studentUid: cleanUid,
          studentEmail: cleanEmail,
          updatedAt: nowIso,
        },
        { merge: true }
      ),
      2500,
      null
    );

    // 2e. Record in studentJournal strictly using canonical targetCycle (NO silent Week 1 fallback!)
    const journalEntryId = `memorization_${day}_${targetCycle}`;
    const journalEntry: StudentJournalEntry = {
      id: journalEntryId,
      type: 'memorization',
      date: getDateForDayInCurrentWeek(day),
      dayOfWeek: day,
      week: targetCycle,
      timestamp: Date.now(),
      title: 'Weekly Memorization Activity',
      details: `Completed Memorization for ${day}`,
      studentUid: cleanUid,
      studentEmail: cleanEmail,
    };

    const existingJournal: StudentJournalEntry[] = Array.isArray(existingData?.studentJournal)
      ? existingData.studentJournal
      : [];
    const filteredJournal = existingJournal.filter(
      (e) => !(e.type === 'memorization' && e.dayOfWeek === day && e.week === targetCycle)
    );
    const updatedJournal = isCompleted ? [journalEntry, ...filteredJournal] : filteredJournal;

    userDocUpdate.studentJournal = updatedJournal;

    await withFirestoreTimeout(
      setDoc(userRef, userDocUpdate, { merge: true }),
      3000,
      null
    );

    const journalEntryRef = doc(db, 'users', cleanUid, 'studentJournal', journalEntryId);
    if (isCompleted) {
      await withFirestoreTimeout(setDoc(journalEntryRef, journalEntry, { merge: true }), 2000, null);
    } else {
      await withFirestoreTimeout(deleteDoc(journalEntryRef), 2000, null);
    }

    // 2f. Top-level student_homework partition for cross-device synchronization (Week 1 legacy only)
    if (targetCycle === 1) {
      const topLevelRef = doc(db, 'student_homework', cleanUid);
      await withFirestoreTimeout(
        setDoc(
          topLevelRef,
          {
            completedPartsByDay: updatedParts,
            isDayPartCompleted: isCompleted,
            updatedAt: nowIso,
          },
          { merge: true }
        ),
        2000,
        null
      );
    }

    // 3. Mirror to server API endpoints with week identifier
    if (cleanEmail || cleanUid) {
      getAccessToken().then((token) => {
        if (!token) return;
        const currentAuthEmail = (auth?.currentUser?.email || '').toLowerCase().trim();
        const safeStudentEmail = (cleanEmail && cleanEmail.includes('@') && (!currentAuthEmail || currentAuthEmail === cleanEmail)) ? cleanEmail : undefined;

        fetch('/api/routines/weekly-checks', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            studentUid: cleanUid,
            ...(safeStudentEmail ? { studentEmail: safeStudentEmail } : {}),
            checks: { [checkKey]: isCompleted },
            weekId: targetWeekId,
            weeklyCycle: targetCycle,
          }),
        }).catch(() => {});

        fetch('/api/homework', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            uid: cleanUid,
            studentUid: cleanUid,
            ...(safeStudentEmail ? { studentEmail: safeStudentEmail } : {}),
            weekId: targetWeekId,
            weeklyCycle: targetCycle,
            weeklyHomework: {
              completedPartsByDay: { [day]: isCompleted },
              isDayPartCompleted: isCompleted,
            },
          }),
        }).catch(() => {});
      }).catch(() => {});
    }

    return true;
  } catch (err) {
    console.warn('saveMemorizationCompletionToFirestore notice:', err);
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
  const db = getDb();
  const cleanEmail = (studentEmail || '').toLowerCase().trim();
  const cleanUid = normalizeUid(studentUid, cleanEmail);

  let targetWeekId = normalizeWeekId(week);
  let targetCycle = parseWeekCycleNumber(week);

  // If week was not provided by caller, attempt to resolve from user profile
  if (!targetWeekId && db && cleanUid) {
    try {
      const userRef = doc(db, 'users', cleanUid);
      const userSnap = await withFirestoreTimeout(getDoc(userRef), 2000, null);
      if (userSnap && userSnap.exists()) {
        const uData = userSnap.data();
        if (typeof uData?.weeklyCycle === 'number' && uData.weeklyCycle > 0) {
          targetCycle = uData.weeklyCycle;
          targetWeekId = `week-${targetCycle}`;
        }
      }
    } catch {}
  }

  // CRITICAL: If week identity is unknown, refuse to silently default to Week 1!
  if (!targetWeekId || !targetCycle) {
    console.warn(
      `[studentPersistence] fetchStudentWeeklyChecksFromFirestore: Week identity is unknown for ${cleanUid}. Explicit week parameter required (Phase 02-B dependency). Refusing to default to Week 1.`
    );
    return { checks: {} };
  }

  // Check in-memory session cache for this specific week
  const localCached = getCachedWeeklyChecks(cleanUid, cleanEmail, targetWeekId);

  // 1. Read week-specific document users/{cleanUid}/weeklyChecks/{targetWeekId}
  if (db && cleanUid) {
    try {
      const weekDocRef = doc(db, 'users', cleanUid, 'weeklyChecks', targetWeekId);
      const weekSnap = await withFirestoreTimeout(getDoc(weekDocRef), 2500, null);
      if (weekSnap && weekSnap.exists()) {
        const wData = weekSnap.data();
        const docChecks: Record<string, boolean> = {
          ...(wData?.checks || {}),
          ...(wData?.weeklyChecks || {}),
          ...(wData?.sPathChecks || {}),
        };
        const mergedChecks = {
          ...localCached,
          ...docChecks,
        };

        cacheWeeklyChecksLocally(cleanUid, cleanEmail, mergedChecks, targetWeekId);

        return {
          checks: mergedChecks,
          weeklyNativeLessonsTarget: wData?.weeklyNativeLessonsTarget,
          weeklyStudyDaysTarget: wData?.weeklyStudyDaysTarget,
          weekId: targetWeekId,
          weeklyCycle: targetCycle,
        };
      }

      // If document does NOT exist:
      // Requirement 5: Preserve backward compatibility for Week 1 only, when no week-specific document exists.
      // Requirement 6: For Week 2 onward, never fall back to legacy root-level checks or homework/current_week.
      if (targetCycle === 1) {
        const userRef = doc(db, 'users', cleanUid);
        const userSnap = await withFirestoreTimeout(getDoc(userRef), 2500, null);
        if (userSnap && userSnap.exists()) {
          const data = userSnap.data();
          validateFirestoreDocument('users', data, { path: `users/${cleanUid}` });
          const mergedChecks: Record<string, boolean> = {
            ...localCached,
            ...(data?.weeklyChecks || {}),
            ...(data?.sPathChecks || {}),
          };

          if (data?.weeklyHomework?.completedPartsByDay && typeof data.weeklyHomework.completedPartsByDay === 'object') {
            Object.entries(data.weeklyHomework.completedPartsByDay).forEach(([day, isDone]) => {
              if (isDone) mergedChecks[`memorization_${day}`] = true;
            });
          }

          try {
            const memoCol = collection(db, 'users', cleanUid, 'memorization');
            const memoSnaps = await withFirestoreTimeout(getDocs(memoCol), 1500, null);
            if (memoSnaps && !memoSnaps.empty) {
              memoSnaps.forEach((d) => {
                if (d.data()?.completed) {
                  mergedChecks[`memorization_${d.id}`] = true;
                }
              });
            }
          } catch {}

          try {
            const hwSubDoc = doc(db, 'users', cleanUid, 'homework', 'current_week');
            const hwSubSnap = await withFirestoreTimeout(getDoc(hwSubDoc), 1500, null);
            if (hwSubSnap && hwSubSnap.exists()) {
              const hwData = hwSubSnap.data();
              if (hwData?.completedPartsByDay && typeof hwData.completedPartsByDay === 'object') {
                Object.entries(hwData.completedPartsByDay).forEach(([day, isDone]) => {
                  if (isDone) mergedChecks[`memorization_${day}`] = true;
                });
              }
            }
          } catch {}

          cacheWeeklyChecksLocally(cleanUid, cleanEmail, mergedChecks, targetWeekId);

          return {
            checks: mergedChecks,
            weeklyNativeLessonsTarget: data?.weeklyNativeLessonsTarget,
            weeklyStudyDaysTarget: data?.weeklyStudyDaysTarget,
            weekId: targetWeekId,
            weeklyCycle: 1,
          };
        }
      } else {
        // Week 2 onward: NEVER fall back to legacy root checks or past weeks!
        cacheWeeklyChecksLocally(cleanUid, cleanEmail, localCached, targetWeekId);
        return {
          checks: localCached,
          weekId: targetWeekId,
          weeklyCycle: targetCycle,
        };
      }
    } catch (err) {
      console.warn(`Notice fetching weeklyChecks from Firestore for ${targetWeekId}:`, err);
    }
  }

  // 2. Week 1 legacy email doc check (strictly for cycle === 1)
  if (targetCycle === 1 && db && cleanEmail) {
    const legacyDocId = `usr-${cleanEmail.replace(/[^a-zA-Z0-9]/g, '-')}`;
    if (legacyDocId !== cleanUid) {
      try {
        const altRef = doc(db, 'users', legacyDocId);
        const altSnap = await withFirestoreTimeout(getDoc(altRef), 2000, null);
        if (altSnap && altSnap.exists()) {
          const altData = altSnap.data();
          const altChecks: Record<string, boolean> = {
            ...localCached,
            ...(altData?.weeklyChecks || {}),
            ...(altData?.sPathChecks || {}),
          };
          if (altData?.weeklyHomework?.completedPartsByDay) {
            Object.entries(altData.weeklyHomework.completedPartsByDay).forEach(([day, isDone]) => {
              if (isDone) altChecks[`memorization_${day}`] = true;
            });
          }
          const result = {
            checks: altChecks,
            weeklyNativeLessonsTarget: altData.weeklyNativeLessonsTarget,
            weeklyStudyDaysTarget: altData.weeklyStudyDaysTarget,
            weekId: targetWeekId,
            weeklyCycle: 1,
          };
          cacheWeeklyChecksLocally(cleanUid, cleanEmail, result.checks, targetWeekId);
          return result;
        }
      } catch {}
    }
  }

  return {
    checks: localCached,
    weekId: targetWeekId,
    weeklyCycle: targetCycle,
  };
}

/**
 * Helper to get the current date in YYYY-MM-DD format
 */
export function getTodayIsoDate(): string {
  return new Date().toISOString().split('T')[0];
}

/**
 * Calculates the calendar date (YYYY-MM-DD) for a specific day of the week in the current week.
 * Reference week starts Monday (index 0) and ends Sunday (index 6).
 */
export function getDateForDayInCurrentWeek(targetDay: DayOfWeek, refDate: Date = new Date()): string {
  const dayIndexMap: Record<DayOfWeek, number> = {
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
    sunday: 0,
  };
  const currentDayIndex = refDate.getDay(); // 0 is Sunday, 1 is Monday...
  const targetDayIndex = dayIndexMap[targetDay];

  // In Monday-first week: Mon=0, Tue=1, Wed=2, Thu=3, Fri=4, Sat=5, Sun=6
  const currentMonFirst = (currentDayIndex + 6) % 7;
  const targetMonFirst = (targetDayIndex + 6) % 7;
  const diffDays = targetMonFirst - currentMonFirst;

  const targetDate = new Date(refDate);
  targetDate.setDate(refDate.getDate() + diffDays);
  return targetDate.toISOString().split('T')[0];
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
  type: StudentJournalActivityType
): 'video_day' | 'audio_day' | 'tutor_live' | 'memorization' {
  switch (type) {
    case 'video':
      return 'video_day';
    case 'audio':
      return 'audio_day';
    case 'lesson':
      return 'tutor_live';
    case 'memorization':
      return 'memorization';
    default:
      return 'video_day';
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
    if (targetWeek !== undefined && entry.week !== undefined && entry.week !== targetWeek) {
      return;
    }
    // Do not mark past/retroactive day reviews, but do mark the scheduled day even if it was a repeated video
    if ((entry as any).reviewedPastDay) {
      return;
    }
    const stepId = mapJournalTypeToStepId(entry.type);
    if (entry.dayOfWeek) {
      checks[`${stepId}_${entry.dayOfWeek}`] = true;
    }
  });

  return checks;
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
      resolvedWeek = parseWeekCycleNumber(userData?.weeklyCycle);
    }

    if (!resolvedWeek) {
      console.warn(
        `[studentPersistence] recordActivityInStudentJournal: Week identity cannot be determined for student ${cleanUid}. Refusing to write weekly completion checks or default to Week 1.`
      );
      return { success: false, updatedJournal: existingJournal };
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
      dayOfWeek: entry.dayOfWeek,
      title: entry.title ? String(entry.title).trim() : undefined,
      artist: entry.artist ? String(entry.artist).trim() : undefined,
      partNumber: entry.partNumber !== undefined ? Number(entry.partNumber) : undefined,
      url: entry.url ? String(entry.url).trim() : undefined,
      details: entry.details ? String(entry.details).trim() : undefined,
      studentUid: cleanUid,
      studentEmail: cleanEmail,
      ...(entry as any),
      week: resolvedWeek,
    };

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
      const todayDay = getTodayDayOfWeek();
      const entryDay = sanitizedEntry.dayOfWeek;
      const dayIndex = entryDay ? DAYS_OF_WEEK.indexOf(entryDay) : -1;
      const todayIndex = DAYS_OF_WEEK.indexOf(todayDay);
      const isPastDay = Boolean(
        (sanitizedEntry as any).reviewedPastDay ||
        (dayIndex !== -1 && todayIndex !== -1 && dayIndex < todayIndex)
      );

      const stepId = mapJournalTypeToStepId(sanitizedEntry.type);
      const checkKey = sanitizedEntry.dayOfWeek ? `${stepId}_${sanitizedEntry.dayOfWeek}` : null;
      const currentChecks = userData?.weeklyChecks || {};

      // S-Path rule: Ensure completing an activity on a given day marks that day completed.
      // Do not mark past/retroactive days, but do mark active/current day.
      const updatedChecks = (checkKey && !isPastDay)
        ? { ...currentChecks, [checkKey]: true }
        : currentChecks;

      const entryCycle = resolvedWeek;
      const targetWeekId = `week-${entryCycle}`;

      // Update week-specific weeklyChecks document users/{cleanUid}/weeklyChecks/{targetWeekId}
      if (checkKey && !isPastDay) {
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
          } else if (entryCycle === 1) {
            existingWeekChecks = { ...(currentChecks || {}) };
          }

          const updatedWeekChecks = {
            ...existingWeekChecks,
            [checkKey]: true,
          };

          await withFirestoreTimeout(
            setDoc(
              weekDocRef,
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
              }),
              { merge: true }
            ),
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
      };

      // Only update legacy root weeklyChecks for Week 1 (backward compatibility)
      if (entryCycle === 1) {
        payload.weeklyChecks = updatedChecks;
        payload.sPathChecks = updatedChecks;
      }

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

      // Direct write to users/{cleanUid}
      await withFirestoreTimeout(setDoc(userRef, payload, { merge: true }), 3500, null);

      // Write discrete entry to subcollection users/{cleanUid}/studentJournal/{entryId}
      const entryRef = doc(db, 'users', cleanUid, 'studentJournal', sanitizedEntry.id);
      await withFirestoreTimeout(setDoc(entryRef, sanitizedEntry, { merge: true }), 2000, null);

      // Mirror to server backend API
      fetch('/api/student-journal/activity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentUid: cleanUid,
          studentEmail: cleanEmail,
          entry: sanitizedEntry,
        }),
      }).catch(() => {});

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
        const checkKey = `${stepId}_${dayOfWeek}`;
        const curChecks = data.weeklyChecks || {};
        const updatedChecks = { ...curChecks, [checkKey]: false };

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
          const updatedWeekChecks = {
            ...existingWeekChecks,
            [checkKey]: false,
          };
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
  weekId: string = 'current_week'
): Promise<boolean> {
  const db = getDb();
  const cleanUid = normalizeUid(studentUid, studentEmail);
  const cleanEmail = (studentEmail || '').toLowerCase().trim();

  if (!homework) return false;

  // Resolve canonical week cycle.
  // Treat "current_week" (or omitted/empty) as an alias requiring resolution from persisted weeklyCycle.
  const isCurrentWeekAlias = !weekId || weekId === 'current_week' || (typeof weekId === 'string' && weekId.trim() === '');
  let targetCycle: number | null = null;
  let targetWeekId: string | null = null;
  let existingHomework: any = {};
  let existingUserDoc: any = {};

  if (db && cleanUid) {
    try {
      const userRef = doc(db, 'users', cleanUid);
      const uSnap = await withFirestoreTimeout(getDoc(userRef), 2000, null);
      if (uSnap && uSnap.exists()) {
        existingUserDoc = uSnap.data() || {};
        existingHomework = existingUserDoc?.weeklyHomework || {};
      }
    } catch {}
  }

  if (isCurrentWeekAlias) {
    targetCycle =
      parseWeekCycleNumber(homework?.weeklyCycle) ||
      parseWeekCycleNumber(existingUserDoc?.weeklyCycle) ||
      parseWeekCycleNumber(existingHomework?.weeklyCycle);
  } else {
    targetCycle = parseWeekCycleNumber(weekId);
  }

  if (targetCycle !== null) {
    targetWeekId = `week-${targetCycle}`;
  }

  if (!targetCycle || !targetWeekId) {
    console.warn(
      `[studentPersistence] saveStudentHomeworkProgressToFirestore: Failed to resolve canonical week for student ${cleanUid} (weekId: '${weekId}'). Aborting safely without partially updating homework. Refusing to default to Week 1.`
    );
    return false;
  }

  try {
    const sanitizedHomework = JSON.parse(JSON.stringify(homework));

    // For existing homework, also check week-specific doc
    if (db && cleanUid) {
      try {
        const hwSnap = await withFirestoreTimeout(getDoc(doc(db, 'users', cleanUid, 'homework', targetWeekId)), 1500, null);
        if (hwSnap && hwSnap.exists()) {
          existingHomework = hwSnap.data() || existingHomework;
        }
      } catch {}
    }

    const mergedCompletedParts = {
      ...(existingHomework?.completedPartsByDay || {}),
      ...(sanitizedHomework?.completedPartsByDay || {}),
    };

    const mergedStudentAnswers = {
      matching: { ...(existingHomework?.studentAnswers?.matching || {}), ...(sanitizedHomework?.studentAnswers?.matching || {}) },
      fillInBlanks: { ...(existingHomework?.studentAnswers?.fillInBlanks || {}), ...(sanitizedHomework?.studentAnswers?.fillInBlanks || {}) },
      sentences: { ...(existingHomework?.studentAnswers?.sentences || {}), ...(sanitizedHomework?.studentAnswers?.sentences || {}) },
      quizAnswers: { ...(existingHomework?.studentAnswers?.quizAnswers || {}), ...(sanitizedHomework?.studentAnswers?.quizAnswers || {}) },
    };

    const payload = stampSchemaVersion({
      ...existingHomework,
      ...sanitizedHomework,
      id: targetWeekId,
      weekId: targetWeekId,
      weeklyCycle: targetCycle,
      studentUid: cleanUid,
      studentEmail: cleanEmail,
      completedPartsByDay: mergedCompletedParts,
      studentAnswers: mergedStudentAnswers,
      updatedAt: new Date().toISOString(),
    });

    if (db && cleanUid) {
      assertSafeFirestoreWrite(`users/${cleanUid}/homework/${targetWeekId}`, payload, undefined, true);

      // 1. Save directly to canonical subcollection users/{cleanUid}/homework/week-${cycle}
      const hwDocRef = doc(db, 'users', cleanUid, 'homework', targetWeekId);
      await withFirestoreTimeout(
        setDoc(hwDocRef, payload, { merge: true }),
        3500,
        null
      );

      // 2. Week 1 backward compatibility only:
      if (targetCycle === 1) {
        const userRef = doc(db, 'users', cleanUid);
        await withFirestoreTimeout(
          setDoc(userRef, { weeklyHomework: payload, updatedAt: new Date().toISOString() }, { merge: true }),
          3000,
          null
        );

        const currentWeekRef = doc(db, 'users', cleanUid, 'homework', 'current_week');
        await withFirestoreTimeout(
          setDoc(currentWeekRef, payload, { merge: true }),
          2500,
          null
        );

        const topLevelRef = doc(db, 'student_homework', cleanUid);
        await withFirestoreTimeout(
          setDoc(topLevelRef, payload, { merge: true }),
          3000,
          null
        );
      }
      // For Week 2+: NEVER write to root users/{cleanUid}.weeklyHomework or homework/current_week!
    }

    // 3. Mirror to server API for backup persistence with weekId & weeklyCycle
    if (cleanEmail || cleanUid) {
      getAccessToken().then((token) => {
        if (!token) return;
        const currentAuthEmail = (auth?.currentUser?.email || '').toLowerCase().trim();
        const safeStudentEmail = (cleanEmail && cleanEmail.includes('@') && (!currentAuthEmail || currentAuthEmail === cleanEmail)) ? cleanEmail : undefined;

        fetch('/api/homework', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            uid: cleanUid,
            studentUid: cleanUid,
            ...(safeStudentEmail ? { studentEmail: safeStudentEmail } : {}),
            weekId: targetWeekId,
            weeklyCycle: targetCycle,
            weeklyHomework: payload,
          }),
        }).catch(() => {});
      }).catch(() => {});
    }

    return true;
  } catch (error) {
    console.error(`[Firestore Error] Failed to save homework for ${cleanUid}:`, error);
    handleFirestoreError(error, OperationType.WRITE, `users/${cleanUid}/homework/${targetWeekId}`);
    return false;
  }
}

/**
 * Fetch student weekly homework and activity progress directly from Cloud Firestore.
 * Prioritizes Firestore users/{cleanUid}/homework/week-${cycle}.
 * - Week 1: Falls back to users/{cleanUid}.weeklyHomework, current_week, and student_homework/{cleanUid} for backward compatibility.
 * - Week 2+: Strictly reads from users/{cleanUid}/homework/week-${cycle}. Never falls back to Week 1 or legacy root homework.
 * - Refuses to silently default to Week 1 when week identity cannot be determined.
 */
export async function fetchStudentHomeworkProgressFromFirestore(
  studentUid: string,
  studentEmail?: string,
  weekId: string = 'current_week'
): Promise<WeeklyHomeworkData | null> {
  const db = getDb();
  const cleanEmail = (studentEmail || '').toLowerCase().trim();
  const cleanUid = normalizeUid(studentUid, cleanEmail);

  if (!db || !cleanUid) return null;

  // Resolve canonical week identifier
  const isCurrentWeekAlias = !weekId || weekId === 'current_week' || (typeof weekId === 'string' && weekId.trim() === '');
  let targetCycle: number | null = null;
  let targetWeekId: string | null = null;

  if (isCurrentWeekAlias) {
    try {
      const userRef = doc(db, 'users', cleanUid);
      const userSnap = await withFirestoreTimeout(getDoc(userRef), 2000, null);
      if (userSnap && userSnap.exists()) {
        const uData = userSnap.data();
        targetCycle = parseWeekCycleNumber(uData?.weeklyCycle);
      }
    } catch {}
  } else {
    targetCycle = parseWeekCycleNumber(weekId);
  }

  if (targetCycle !== null) {
    targetWeekId = `week-${targetCycle}`;
  }

  if (!targetCycle || !targetWeekId) {
    console.warn(
      `[studentPersistence] fetchStudentHomeworkProgressFromFirestore: Week identity is unknown for ${cleanUid} (weekId: '${weekId}'). Explicit week parameter required. Refusing to default to Week 1.`
    );
    return null;
  }

  try {
    // 1. Fetch from canonical subcollection users/{cleanUid}/homework/week-${cycle}
    const hwDocRef = doc(db, 'users', cleanUid, 'homework', targetWeekId);
    const hwSnap = await withFirestoreTimeout(getDoc(hwDocRef), 2500, null);
    if (hwSnap && hwSnap.exists()) {
      // Requirement 2: If canonical document exists, return its data even when empty or unanswered.
      // Never consult legacy Week 1 storage when the canonical document exists.
      const data = hwSnap.data();
      return (data || {}) as WeeklyHomeworkData;
    }

    // 2. Week 1 backward compatibility only (consulted ONLY when canonical document does NOT exist):
    if (targetCycle === 1) {
      // Check legacy subcollection document 'current_week'
      const legacyHwRef = doc(db, 'users', cleanUid, 'homework', 'current_week');
      const legacySnap = await withFirestoreTimeout(getDoc(legacyHwRef), 2000, null);
      if (legacySnap && legacySnap.exists()) {
        const lData = legacySnap.data();
        if (lData && (lData.completedPartsByDay || lData.studentAnswers || lData.matchingPairs)) {
          return lData as WeeklyHomeworkData;
        }
      }

      // Check users/{cleanUid} document
      const userRef = doc(db, 'users', cleanUid);
      const userSnap = await withFirestoreTimeout(getDoc(userRef), 2500, null);
      if (userSnap && userSnap.exists()) {
        const data = userSnap.data();
        if (data?.weeklyHomework && (data.weeklyHomework.completedPartsByDay || data.weeklyHomework.studentAnswers)) {
          return data.weeklyHomework as WeeklyHomeworkData;
        }
      }

      // Check top-level student_homework/{cleanUid}
      const topRef = doc(db, 'student_homework', cleanUid);
      const topSnap = await withFirestoreTimeout(getDoc(topRef), 2000, null);
      if (topSnap && topSnap.exists()) {
        const data = topSnap.data();
        if (data && (data.completedPartsByDay || data.studentAnswers || data.matchingPairs)) {
          return data as WeeklyHomeworkData;
        }
      }
    }

    // 3. Server API fallback: strictly request targetWeekId & targetCycle
    if (cleanEmail || cleanUid) {
      try {
        const token = await getAccessToken();
        if (!token) {
          // Authentication initializing or unavailable: do not execute unauthenticated fallback
          return null;
        }

        const currentAuthEmail = (auth?.currentUser?.email || '').toLowerCase().trim();
        const safeStudentEmail = (cleanEmail && cleanEmail.includes('@') && (!currentAuthEmail || currentAuthEmail === cleanEmail)) ? cleanEmail : '';

        const params = new URLSearchParams();
        if (cleanUid) {
          params.append('uid', cleanUid);
          params.append('studentUid', cleanUid);
        }
        if (safeStudentEmail) {
          params.append('studentEmail', safeStudentEmail);
        }
        params.append('weekId', targetWeekId);
        params.append('weeklyCycle', String(targetCycle));

        const res = await fetch(`/api/homework?${params.toString()}`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        if (res.ok) {
          const apiData = await res.json();
          // Requirement 9: Prevent an unscoped legacy server response from being treated as valid Week 2+ completion data!
          if (apiData && (apiData.completedPartsByDay || apiData.studentAnswers)) {
            if (targetCycle >= 2) {
              const apiCycle =
                parseWeekCycleNumber(apiData.weeklyCycle) ||
                parseWeekCycleNumber(apiData.weekId) ||
                parseWeekCycleNumber(apiData.id);
              if (apiCycle !== targetCycle) {
                // Discard legacy unscoped data or mismatching week data
                return null;
              }
            }
            return apiData as WeeklyHomeworkData;
          }
        }
      } catch {}
    }

    return null;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `users/${cleanUid}/homework/${targetWeekId}`);
    return null;
  }
}

/**
 * Creates a clean, initialized homework state for a given student and week cycle.
 * Ensures answers, completed parts, and completion flags are completely cleared,
 * while preserving the expected WeeklyHomeworkData structure and UI compatibility.
 */
export function createCleanInitializedHomework(
  studentUid: string,
  studentEmail?: string,
  cycle: number = 1,
  partial?: Partial<WeeklyHomeworkData>
): WeeklyHomeworkData {
  const canonicalWeekId = normalizeWeekId(cycle) || `week-${cycle}`;
  return {
    id: partial?.id || `hw-${canonicalWeekId}-${studentUid}`,
    weekId: canonicalWeekId,
    weeklyCycle: cycle,
    studentUid,
    studentEmail: studentEmail || partial?.studentEmail || '',
    studentName: partial?.studentName || 'Student',
    studentLevel: partial?.studentLevel || 'intermediate',
    createdAt: partial?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    weekLabel: partial?.weekLabel || `Week ${cycle}`,
    totalWordsCollected: partial?.totalWordsCollected || 0,
    vocabularyList: Array.isArray(partial?.vocabularyList) ? partial.vocabularyList : [],
    allRoutineWords: Array.isArray(partial?.allRoutineWords) ? partial.allRoutineWords : [],
    matchingPairs: Array.isArray(partial?.matchingPairs) ? partial.matchingPairs : [],
    fillInBlanks: Array.isArray(partial?.fillInBlanks) ? partial.fillInBlanks : [],
    sentenceWritingPrompts: Array.isArray(partial?.sentenceWritingPrompts) ? partial.sentenceWritingPrompts : [],
    readingPassage: partial?.readingPassage || {
      title: `Week ${cycle} Reading`,
      text: '',
      questions: [],
    },
    targetDay: partial?.targetDay,
    assignedPart: partial?.assignedPart,
    assignedPartKey: partial?.assignedPartKey,
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
    isEmpty: partial?.isEmpty !== undefined ? partial.isEmpty : true,
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
  const db = getDb();
  const cleanUid = normalizeUid(studentUid, studentEmail);
  if (!db || !cleanUid) {
    return () => {};
  }

  const unsubs: (() => void)[] = [];
  let activeHwUnsub: (() => void) | null = null;

  const attachWeekListener = (cycle: number, initialUserData?: any) => {
    if (activeHwUnsub) {
      activeHwUnsub();
      activeHwUnsub = null;
    }

    const canonicalWeekId = `week-${cycle}`;
    try {
      const hwDocRef = doc(db, 'users', cleanUid, 'homework', canonicalWeekId);
      activeHwUnsub = onSnapshot(
        hwDocRef,
        (snap) => {
          if (snap.exists()) {
            // Canonical document EXISTS:
            // Return its data even when empty or unanswered. Never consult legacy storage.
            const data = (snap.data() || {}) as Partial<WeeklyHomeworkData>;
            const hasCompletedParts = data.completedPartsByDay && Object.keys(data.completedPartsByDay).length > 0;
            const hasAnswers = data.studentAnswers && (
              (data.studentAnswers.matching && Object.keys(data.studentAnswers.matching).length > 0) ||
              (data.studentAnswers.fillInBlanks && Object.keys(data.studentAnswers.fillInBlanks).length > 0) ||
              (data.studentAnswers.sentences && Object.keys(data.studentAnswers.sentences).length > 0) ||
              (data.studentAnswers.quizAnswers && Object.keys(data.studentAnswers.quizAnswers).length > 0)
            );
            const isCompleted = !!data.isCompleted || !!data.isDayPartCompleted;

            if ((!hasCompletedParts && !hasAnswers && !isCompleted) || data.isEmpty) {
              // Document is empty, reset, or unanswered: notify subscriber with clean initialized state
              callback(createCleanInitializedHomework(cleanUid, studentEmail, cycle, data));
            } else {
              callback({
                ...createCleanInitializedHomework(cleanUid, studentEmail, cycle, data),
                ...data,
                weekId: canonicalWeekId,
                weeklyCycle: cycle,
              } as WeeklyHomeworkData);
            }
          } else {
            // Canonical document DOES NOT EXIST (deleted, missing, or not yet created)
            if (cycle === 1) {
              // Consult legacy Week 1 storage ONLY when canonical week-1 document does not exist
              let usedLegacy = false;
              if (
                initialUserData?.weeklyHomework &&
                (initialUserData.weeklyHomework.completedPartsByDay || initialUserData.weeklyHomework.studentAnswers)
              ) {
                callback(initialUserData.weeklyHomework as WeeklyHomeworkData);
                usedLegacy = true;
              }

              if (!usedLegacy) {
                // Check users/{cleanUid}/homework/current_week fallback
                getDoc(doc(db, 'users', cleanUid, 'homework', 'current_week'))
                  .then((legacySnap) => {
                    if (legacySnap.exists()) {
                      const lData = legacySnap.data() as WeeklyHomeworkData;
                      if (lData && (lData.completedPartsByDay || lData.studentAnswers || lData.matchingPairs)) {
                        callback(lData);
                        return;
                      }
                    }
                    callback(createCleanInitializedHomework(cleanUid, studentEmail, 1));
                  })
                  .catch(() => {
                    callback(createCleanInitializedHomework(cleanUid, studentEmail, 1));
                  });
              }
            } else {
              // Week 2 or later: NEVER consult legacy Week 1 storage!
              // Notify subscriber with clean initialized homework state
              callback(createCleanInitializedHomework(cleanUid, studentEmail, cycle));
            }
          }
        },
        (err) => {
          console.warn('Real-time notice for student homework subcollection listener:', err);
        }
      );
    } catch {}
  };

  const isCurrentWeekAlias = weekId === 'current_week';
  if (!isCurrentWeekAlias) {
    const explicitCycle = parseWeekCycleNumber(weekId);
    if (explicitCycle === null) {
      // Requirement 1: Reject malformed explicit week identifiers.
      // Do not silently interpret an invalid week as Week 1, and do not fall back to dynamic alias.
      console.warn(
        `[studentPersistence] subscribeToStudentHomeworkProgress: Rejecting malformed explicit week identifier '${weekId}' for ${cleanUid}. Refusing to default to Week 1.`
      );
      return () => {};
    }
    // Explicit valid week cycle confirmed
    attachWeekListener(explicitCycle);
  } else {
    // Dynamic alias 'current_week': resolve dynamically from student profile
    try {
      const userRef = doc(db, 'users', cleanUid);
      let currentResolvedCycle: number | null = null;
      unsubs.push(
        onSnapshot(
          userRef,
          (snap) => {
            if (snap.exists()) {
              const uData = snap.data();
              const newCycle = parseWeekCycleNumber(uData?.weeklyCycle);
              if (newCycle === null) {
                // Requirement 1: Do not silently interpret an invalid or missing weeklyCycle as Week 1
                if (activeHwUnsub) {
                  activeHwUnsub();
                  activeHwUnsub = null;
                }
                currentResolvedCycle = null;
                return;
              }
              // Preserve valid Week 1 behavior when the cycle is explicitly confirmed
              if (newCycle !== currentResolvedCycle) {
                currentResolvedCycle = newCycle;
                attachWeekListener(newCycle, uData);
              }
            }
          },
          () => {}
        )
      );
    } catch {}
  }

  return () => {
    if (activeHwUnsub) activeHwUnsub();
    unsubs.forEach((u) => u());
  };
}

/**
 * Real-time subscription to student daily journal entries (Sentence of the Day).
 * Synchronizes instantly across devices when sentences are created, edited, or deleted.
 */
export function subscribeToStudentDailyJournal(
  studentUid: string,
  studentEmail: string | undefined,
  callback: (entries: DailyJournalEntry[]) => void
): () => void {
  const db = getDb();
  const cleanEmail = (studentEmail || '').toLowerCase().trim();
  const cleanUid = normalizeUid(studentUid, cleanEmail);
  if (!db || !cleanUid) return () => {};

  const unsubscribers: (() => void)[] = [];
  const journalMap = new Map<string, DailyJournalEntry>();

  const rebuildAndNotify = () => {
    const list = Array.from(journalMap.values());
    list.sort((a, b) => {
      const timeA = new Date(a.createdAt || a.date).getTime();
      const timeB = new Date(b.createdAt || b.date).getTime();
      return timeB - timeA;
    });
    callback(list);
  };

  try {
    const subCol = collection(db, 'users', cleanUid, 'journal');
    unsubscribers.push(
      onSnapshot(
        subCol,
        (snap) => {
          journalMap.clear();
          snap.forEach((d) => {
            const item = d.data() as DailyJournalEntry;
            if (item?.id) journalMap.set(item.id, item);
          });
          rebuildAndNotify();
        },
        () => {}
      )
    );

    const userRef = doc(db, 'users', cleanUid);
    unsubscribers.push(
      onSnapshot(
        userRef,
        (snap) => {
          if (snap.exists()) {
            const data = snap.data();
            if (Array.isArray(data?.dailyJournalEntries)) {
              data.dailyJournalEntries.forEach((item: DailyJournalEntry) => {
                if (item?.id) journalMap.set(item.id, item);
              });
              rebuildAndNotify();
            }
          }
        },
        () => {}
      )
    );
  } catch {}

  return () => {
    unsubscribers.forEach((u) => u());
  };
}

/**
 * Delete a student daily journal entry directly from Cloud Firestore and sync across all devices.
 */
export async function deleteStudentJournalEntryFromFirestore(
  studentUid: string,
  entryId: string,
  studentEmail?: string
): Promise<boolean> {
  const db = getDb();
  if (!db || !entryId) return false;
  const cleanEmail = (studentEmail || '').toLowerCase().trim();
  const cleanUid = normalizeUid(studentUid, cleanEmail);
  if (!cleanUid) return false;

  try {
    // 1. Delete from subcollection
    const entryRef = doc(db, 'users', cleanUid, 'journal', entryId);
    await withFirestoreTimeout(deleteDoc(entryRef), 2000, null);

    // 2. Remove from user profile doc dailyJournalEntries array
    const userRef = doc(db, 'users', cleanUid);
    const userSnap = await withFirestoreTimeout(getDoc(userRef), 2000, null);
    if (userSnap && userSnap.exists()) {
      const data = userSnap.data();
      if (Array.isArray(data?.dailyJournalEntries)) {
        const filtered = data.dailyJournalEntries.filter((e: DailyJournalEntry) => e.id !== entryId);
        await withFirestoreTimeout(
          setDoc(userRef, { dailyJournalEntries: filtered, updatedAt: new Date().toISOString() }, { merge: true }),
          2000,
          null
        );
      }
    }
    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `users/${cleanUid}/journal/${entryId}`);
    return false;
  }
}

/**
 * Real-time subscription to student daily routine video/topic selections across Monday-Sunday.
 * Ensures that topic choices or custom video suggestions made on one device appear instantly on other devices.
 */
export function subscribeToStudentDailyRoutines(
  studentUid: string,
  callback: (routines: Partial<Record<DayOfWeek, any>>) => void
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
      (err) => console.warn('Real-time student routines subscription notice:', err)
    );
    return unsub;
  } catch (err) {
    console.warn('subscribeToStudentDailyRoutines error:', err);
    return () => {};
  }
}


