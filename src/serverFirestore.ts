import { getFirestore, Firestore, FieldValue } from 'firebase-admin/firestore';
import { getFirebaseAdminApp, ALLOWED_STAGING_PROJECT_ID } from './serverFirebaseAdmin';
import { normalizeDictionaryWord } from './utils/studentDictionaryLibrary';
import { isGenericPedagogicalDefinition } from './serverGeminiSecurity';

/**
 * Active identifiers for staging persistence.
 * Strictly bound to ALLOWED_STAGING_PROJECT_ID ('itissimple-security-staging').
 * All references to legacy projects, Web SDK configs, and external API keys are eliminated.
 */
export const ACTIVE_FIREBASE_PROJECT_ID = ALLOWED_STAGING_PROJECT_ID;
export const ACTIVE_FIREBASE_DATABASE_ID = '(default)';
export const ACTIVE_FIRESTORE_DATABASE_ID = '(default)';

let adminFirestoreInstance: Firestore | null = null;

/**
 * Returns a validated Firestore instance from Firebase Admin SDK.
 * Strictly checks that the underlying app is initialized with ALLOWED_STAGING_PROJECT_ID.
 * Uses exclusively the '(default)' database.
 */
export function getFirestoreDb(): Firestore | null {
  if (adminFirestoreInstance) {
    const cachedProjectId = (adminFirestoreInstance as any).projectId;
    if (cachedProjectId && cachedProjectId !== ALLOWED_STAGING_PROJECT_ID) {
      throw new Error(
        `[serverFirestore Security] Unauthorized Firestore instance detected for project '${cachedProjectId}'. Strictly expected '${ALLOWED_STAGING_PROJECT_ID}'.`
      );
    }
    const cachedDatabaseId = (adminFirestoreInstance as any).databaseId;
    if (cachedDatabaseId && cachedDatabaseId !== '(default)') {
      throw new Error(
        `[serverFirestore Security] Unauthorized Firestore database '${cachedDatabaseId}' detected. Strictly expected '(default)'.`
      );
    }
    return adminFirestoreInstance;
  }

  try {
    const app = getFirebaseAdminApp();
    const appProjectId = app.options?.projectId;
    if (appProjectId !== ALLOWED_STAGING_PROJECT_ID) {
      throw new Error(
        `[serverFirestore Security] Firebase Admin App is bound to unauthorized project '${appProjectId}'. Refusing to create Firestore client.`
      );
    }
    // Architecture decision HOTFIX 4B.18: Strictly target canonical '(default)' database
    const targetDatabaseId = '(default)';
    adminFirestoreInstance = getFirestore(app, targetDatabaseId);
    return adminFirestoreInstance;
  } catch (err) {
    console.warn('[serverFirestore] Failed to initialize Firebase Admin Firestore:', err);
    return null;
  }
}

export function getDefaultFirestoreDb(): Firestore | null {
  return getFirestoreDb();
}

export function getAllServerFirestoreDbs(): Firestore[] {
  const db = getFirestoreDb();
  return db ? [db] : [];
}

/**
 * Testing helpers for injecting mocks and resetting state
 */
export function setFirebaseAdminFirestoreForTesting(mockDb: Firestore | null): void {
  adminFirestoreInstance = mockDb;
}

let isCloudWriteDisabled = false;

export function isPermissionError(err: any): boolean {
  if (!err) return false;
  const msg = String(err.message || '');
  const note = String(err.note || '');
  const code = err.code;
  return (
    code === 7 ||
    code === 'permission-denied' ||
    msg.includes('PERMISSION_DENIED') ||
    msg.includes('Missing or insufficient permissions') ||
    msg.includes('permission denied') ||
    note.includes('not classified as transient')
  );
}

export function getIsCloudWriteDisabled(): boolean {
  return isCloudWriteDisabled;
}

export function setIsCloudWriteDisabled(disabled: boolean): void {
  isCloudWriteDisabled = disabled;
}

export function resetFirebaseAdminFirestoreForTesting(): void {
  adminFirestoreInstance = null;
  isCloudWriteDisabled = false;
}

// Authoritative in-memory DB provider to prevent circular import problems
type DbReaderFn = () => any;
let authoritativeDbReader: DbReaderFn | null = null;

export function registerDbReader(reader: DbReaderFn): void {
  authoritativeDbReader = reader;
}

export function getAuthoritativeDb(): any | null {
  if (authoritativeDbReader) {
    try {
      return authoritativeDbReader();
    } catch {}
  }
  // HOTFIX PONTUAL: Remoção de dependência e fallback para app_db.json.
  // app_db.json não é utilizado como fonte de dados, identidade ou fallback.
  return null;
}


// Timeout helper so remote Firestore never blocks an Express API response indefinitely
function withTimeout<T>(promise: Promise<T>, ms: number = 1500): Promise<T | null> {
  let timer: NodeJS.Timeout;
  const timeoutPromise = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  return Promise.race([
    promise.then((res) => {
      clearTimeout(timer);
      return res;
    }),
    timeoutPromise,
  ]);
}

import {
  normalizeTutorName,
  areSameTutor,
  mergeTutors,
  consolidateTutorsList,
  isValidCanonicalUid,
  isGenericTutorId,
  type CanonicalTutorRecord,
} from './utils/tutorConsolidation';

export {
  normalizeTutorName,
  areSameTutor,
  mergeTutors,
  consolidateTutorsList,
  isValidCanonicalUid,
  isGenericTutorId,
  type CanonicalTutorRecord,
};

export interface ResolvedTeacherIdentity {
  canonicalUid: string;
  email: string;
  name: string;
  publicTutorId: string;
  isApproved: boolean;
  role: string;
  rawDoc?: any;
}

/**
 * Resolves the unequivocal canonical Firebase Auth UID of a Native Friend (Teacher) on the trusted backend.
 * Checks Firebase Admin Auth and canonical Firestore records.
 * Resolves public identifiers, legacy slugs, and emails to the genuine Auth UID.
 * Rejects unapproved, non-existent, or unproven tutor identities.
 */
export async function resolveTeacherCanonicalIdentity(
  target: string | { teacherId?: string; teacherUid?: string; teacherEmail?: string; publicTutorId?: string; teacherName?: string; selectedTutorName?: string; name?: string; dbState?: any }
): Promise<ResolvedTeacherIdentity | null> {
  const db = getFirestoreDb();
  let queryStr = '';
  let candidateEmail = '';
  let candidateUid = '';
  let candidatePublicId = '';

  let candidateName = '';

  if (typeof target === 'string') {
    const raw = target.trim();
    if (!isGenericTutorId(raw)) {
      queryStr = raw;
      if (queryStr.includes('@')) {
        candidateEmail = queryStr.toLowerCase();
      } else if (isValidCanonicalUid(queryStr)) {
        candidateUid = queryStr;
      } else {
        candidatePublicId = queryStr.toLowerCase();
        candidateName = normalizeTutorName(queryStr);
      }
    }
  } else if (target && typeof target === 'object') {
    if (target.teacherEmail) {
      const cleanEm = target.teacherEmail.trim().toLowerCase();
      if (!isGenericTutorId(cleanEm)) {
        if (cleanEm.includes('@')) {
          if (!candidateEmail) candidateEmail = cleanEm;
        } else if (isValidCanonicalUid(cleanEm)) {
          if (!candidateUid) candidateUid = cleanEm;
        } else if (!candidatePublicId) {
          candidatePublicId = cleanEm;
        }
      }
    }
    if (target.teacherUid) {
      const clean = target.teacherUid.trim();
      if (!isGenericTutorId(clean)) {
        if (clean.includes('@')) {
          if (!candidateEmail) candidateEmail = clean.toLowerCase();
        } else if (isValidCanonicalUid(clean)) {
          if (!candidateUid) candidateUid = clean;
        } else if (!candidatePublicId) {
          candidatePublicId = clean.toLowerCase();
        }
      }
    }
    if (target.teacherId) {
      const clean = target.teacherId.trim();
      if (!isGenericTutorId(clean)) {
        if (clean.includes('@')) {
          if (!candidateEmail) candidateEmail = clean.toLowerCase();
        } else if (isValidCanonicalUid(clean)) {
          if (!candidateUid) candidateUid = clean;
        } else if (!candidatePublicId) {
          candidatePublicId = clean.toLowerCase();
        }
      }
    }
    if (target.publicTutorId && !candidatePublicId) {
      const clean = target.publicTutorId.trim().toLowerCase();
      if (!isGenericTutorId(clean)) {
        candidatePublicId = clean;
      }
    }
    const rawName = (target as any).teacherName || (target as any).selectedTutorName || (target as any).name;
    if (rawName && typeof rawName === 'string') {
      const norm = normalizeTutorName(rawName);
      if (!isGenericTutorId(norm)) {
        candidateName = norm;
      }
    }
  }

  // Reject generic or empty queries immediately
  if (!candidateEmail && !candidateUid && !candidatePublicId && !candidateName) {
    return null;
  }



  let adminAuth: any = null;
  try {
    const { getFirebaseAdminAuth } = await import('./serverFirebaseAdmin');
    adminAuth = getFirebaseAdminAuth();
  } catch {}

  const candidateDocs: any[] = [];

  if (db) {
    try {
      if (candidateUid) {
        const [uSnap, tSnap] = await Promise.all([
          db.collection('users').doc(candidateUid).get().catch(() => null),
          db.collection('tutors').doc(candidateUid).get().catch(() => null),
        ]);
        if (uSnap && uSnap.exists) candidateDocs.push({ id: uSnap.id, ...uSnap.data() });
        if (tSnap && tSnap.exists) candidateDocs.push({ id: tSnap.id, ...tSnap.data() });
      }

      if (candidatePublicId) {
        const [tPubSnap, uPubSnap, tDocSnap, uDocSnap] = await Promise.all([
          db.collection('tutors').where('publicTutorId', '==', candidatePublicId).get().catch(() => null),
          db.collection('users').where('publicTutorId', '==', candidatePublicId).get().catch(() => null),
          db.collection('tutors').doc(candidatePublicId).get().catch(() => null),
          db.collection('users').doc(candidatePublicId).get().catch(() => null),
        ]);
        if (tPubSnap) tPubSnap.forEach((d) => candidateDocs.push({ id: d.id, ...d.data() }));
        if (uPubSnap) uPubSnap.forEach((d) => candidateDocs.push({ id: d.id, ...d.data() }));
        if (tDocSnap && tDocSnap.exists) candidateDocs.push({ id: tDocSnap.id, ...tDocSnap.data() });
        if (uDocSnap && uDocSnap.exists) candidateDocs.push({ id: uDocSnap.id, ...uDocSnap.data() });
      }

      if (candidateEmail) {
        const [uEmSnap, tEmSnap] = await Promise.all([
          db.collection('users').where('email', '==', candidateEmail).get().catch(() => null),
          db.collection('tutors').where('email', '==', candidateEmail).get().catch(() => null),
        ]);
        if (uEmSnap) uEmSnap.forEach((d) => candidateDocs.push({ id: d.id, ...d.data() }));
        if (tEmSnap) tEmSnap.forEach((d) => candidateDocs.push({ id: d.id, ...d.data() }));
      }

      if (candidateName && candidateDocs.length === 0) {
        const rawGivenName = String((target as any)?.teacherName || (target as any)?.selectedTutorName || (target as any)?.name || candidateName).trim();
        const candidateNames = Array.from(new Set([rawGivenName, candidateName].filter(Boolean)));
        for (const nm of candidateNames) {
          const [uNameSnap, tNameSnap] = await Promise.all([
            db.collection('users').where('name', '==', nm).get().catch(() => null),
            db.collection('tutors').where('name', '==', nm).get().catch(() => null),
          ]);
          if (uNameSnap) uNameSnap.forEach((d) => candidateDocs.push({ id: d.id, ...d.data() }));
          if (tNameSnap) tNameSnap.forEach((d) => candidateDocs.push({ id: d.id, ...d.data() }));
          if (candidateDocs.length > 0) break;
        }
      }
    } catch (err) {
      console.warn('[resolveTeacherCanonicalIdentity] Firestore query notice:', err);
    }
  }

  // Fallback to in-memory state or local DB if Firestore queries returned no candidate docs
  if (candidateDocs.length === 0) {
    try {
      const dbState = (target && typeof target === 'object' && (target as any).dbState) || null;
      let localTutors = dbState?.tutorsList || [];
      let localTeachers = dbState?.teachers || [];
      // HOTFIX PONTUAL: Remoção da dependência e fallback para src/data/app_db.json.
      // Apenas dbState em memória explicitamente fornecido (ex: testes isolados) é consultado.
      // O arquivo legado src/data/app_db.json nunca é lido no runtime.
      const allLocal = [...localTutors, ...localTeachers];
      for (const item of allLocal) {
        if (!item) continue;
        const itemEmail = (item.email || '').toLowerCase().trim();
        const itemPubId = (item.publicTutorId || item.id || '').toLowerCase().trim();
        const itemUid = (item.uid || item.authUid || '').trim();
        const itemNameNorm = normalizeTutorName(item.name);
        const itemSlug = itemNameNorm.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        const matches =
          (candidateUid && (itemUid === candidateUid || item.id === candidateUid)) ||
          (candidatePublicId && (itemPubId === candidatePublicId || item.id === candidatePublicId || itemSlug === candidatePublicId)) ||
          (candidateEmail && itemEmail === candidateEmail) ||
          (candidateName && !isGenericTutorId(candidateName) && (itemNameNorm === candidateName || itemSlug === candidateName));
        if (matches) {
          candidateDocs.push(item);
        }
      }
    } catch {}
  }

  let consolidated: CanonicalTutorRecord | null = null;
  if (candidateDocs.length > 0) {
    const list = consolidateTutorsList(candidateDocs);
    if (list.length > 0) {
      consolidated = list[0];
    }
  }

  let resolvedUid = '';
  const email = (consolidated?.email || candidateEmail || '').toLowerCase().trim();

  if (adminAuth) {
    if (candidateUid) {
      try {
        const userRec = await adminAuth.getUser(candidateUid);
        if (userRec && userRec.uid) {
          resolvedUid = userRec.uid;
        }
      } catch {}
    }
    if (!resolvedUid && email) {
      try {
        const userRec = await adminAuth.getUserByEmail(email);
        if (userRec && userRec.uid && isValidCanonicalUid(userRec.uid)) {
          resolvedUid = userRec.uid;
        }
      } catch {}
    }
  }

  if (!resolvedUid && consolidated) {
    if (consolidated.authUid && isValidCanonicalUid(consolidated.authUid)) {
      resolvedUid = consolidated.authUid;
    } else if (consolidated.uid && isValidCanonicalUid(consolidated.uid)) {
      resolvedUid = consolidated.uid;
    } else if (consolidated.id && isValidCanonicalUid(consolidated.id)) {
      resolvedUid = consolidated.id;
    }
  }

  if (!resolvedUid || !isValidCanonicalUid(resolvedUid)) {
    return null;
  }

  const isApproved = Boolean(
    consolidated?.approvalStatus === 'approved' ||
    consolidated?.isApproved === true ||
    consolidated?.status === 'approved' ||
    consolidated?.approved === true
  );

  const name = consolidated?.name || 'Native Friend';

  const publicTutorId =
    (consolidated?.publicTutorId && !isGenericTutorId(consolidated.publicTutorId) ? consolidated.publicTutorId : null) ||
    (candidatePublicId && !isGenericTutorId(candidatePublicId) ? candidatePublicId : null) ||
    (email ? `tutor-${email.replace(/[^a-zA-Z0-9]/g, '-')}` : null) ||
    (name && !isGenericTutorId(name) ? normalizeTutorName(name).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : null) ||
    resolvedUid;

  return {
    canonicalUid: resolvedUid,
    email: email,
    name,
    publicTutorId,
    isApproved,
    role: 'teacher',
    rawDoc: consolidated,
  };
}

/**
 * Direct canonical persistence for individual Native Friend / Tutor profiles exclusively in /tutors/{authUid} and /users/{authUid}.
 * Multiple writes to tutor-email, sanitized email or public slug documents are completely eliminated.
 * If the canonical UID cannot be proven, throws an explicit error and NEVER generates an alternative UID.
 */
export async function saveTutorToFirestore(tutor: any, _legacyDocId?: string): Promise<boolean> {
  if (isCloudWriteDisabled) return false;
  const db = getFirestoreDb();
  if (!db || !tutor) return false;

  const cleanEmail = (tutor.email || '').toLowerCase().trim();

  // 1. Resolve canonical Firebase Auth UID
  let canonicalAuthUid = '';

  if (tutor.authUid && isValidCanonicalUid(tutor.authUid)) {
    canonicalAuthUid = tutor.authUid.trim();
  } else if (tutor.uid && isValidCanonicalUid(tutor.uid)) {
    canonicalAuthUid = tutor.uid.trim();
  } else if (tutor.id && isValidCanonicalUid(tutor.id)) {
    canonicalAuthUid = tutor.id.trim();
  }

  // Attempt resolution via Firebase Admin Auth
  let adminAuth: any = null;
  try {
    const { getFirebaseAdminAuth } = await import('./serverFirebaseAdmin');
    adminAuth = getFirebaseAdminAuth();
  } catch {}

  if (adminAuth) {
    if (canonicalAuthUid) {
      try {
        const userRec = await adminAuth.getUser(canonicalAuthUid);
        if (userRec && userRec.uid) {
          canonicalAuthUid = userRec.uid;
        }
      } catch {
        // Keep candidate canonicalAuthUid; do not wipe out valid UID if adminAuth fails
      }
    }
    if (!canonicalAuthUid && cleanEmail) {
      try {
        const userRec = await adminAuth.getUserByEmail(cleanEmail);
        if (userRec && userRec.uid && isValidCanonicalUid(userRec.uid)) {
          canonicalAuthUid = userRec.uid;
        }
      } catch {}
    }
  }

  // Check existing canonical records in Firestore
  if (!canonicalAuthUid && cleanEmail) {
    try {
      const uSnap = await db.collection('users').where('email', '==', cleanEmail).get();
      for (const doc of uSnap.docs) {
        if (isValidCanonicalUid(doc.id)) {
          canonicalAuthUid = doc.id;
          break;
        }
        const data = doc.data();
        if (data?.uid && isValidCanonicalUid(data.uid)) {
          canonicalAuthUid = data.uid;
          break;
        }
        if (data?.authUid && isValidCanonicalUid(data.authUid)) {
          canonicalAuthUid = data.authUid;
          break;
        }
      }
    } catch {}
  }

  if (!canonicalAuthUid && cleanEmail) {
    try {
      const tSnap = await db.collection('tutors').where('email', '==', cleanEmail).get();
      for (const doc of tSnap.docs) {
        if (isValidCanonicalUid(doc.id)) {
          canonicalAuthUid = doc.id;
          break;
        }
        const data = doc.data();
        if (data?.authUid && isValidCanonicalUid(data.authUid)) {
          canonicalAuthUid = data.authUid;
          break;
        }
        if (data?.uid && isValidCanonicalUid(data.uid)) {
          canonicalAuthUid = data.uid;
          break;
        }
      }
    } catch {}
  }

  // Critical requirement: If UID cannot be proven, halt persistence with explicit error. NEVER generate alternative UID!
  if (!canonicalAuthUid || !isValidCanonicalUid(canonicalAuthUid)) {
    const errorMsg = `[serverFirestore] Cannot unequivocally prove canonical Firebase Auth UID for tutor '${cleanEmail || tutor.name || 'unknown'}'. Refusing to save to prevent duplicate unlinked records.`;
    console.error(errorMsg);
    throw new Error(errorMsg);
  }

  try {
    const approvalStatus = tutor.approvalStatus || (tutor.isApproved ? 'approved' : 'pending');
    const isApproved = approvalStatus === 'approved' || tutor.isApproved === true || tutor.status === 'approved' || tutor.approved === true;

    // Public ID and legacy IDs preserved strictly as metadata inside the document
    const publicTutorId =
      (tutor.publicTutorId && !isGenericTutorId(tutor.publicTutorId) ? tutor.publicTutorId : null) ||
      (tutor.id && !isValidCanonicalUid(tutor.id) && !isGenericTutorId(tutor.id) ? tutor.id : null) ||
      (cleanEmail ? `tutor-${cleanEmail.replace(/[^a-zA-Z0-9]/g, '-')}` : null) ||
      (tutor.name && typeof tutor.name === 'string' && !isGenericTutorId(tutor.name) ? tutor.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : null) ||
      canonicalAuthUid;
    const legacyIds = Array.from(new Set([
      ...(Array.isArray(tutor.legacyIds) ? tutor.legacyIds : []),
      (tutor.legacyId && tutor.legacyId !== canonicalAuthUid ? tutor.legacyId : null),
      (_legacyDocId && _legacyDocId !== canonicalAuthUid ? _legacyDocId : null),
      (tutor.id && tutor.id !== canonicalAuthUid ? tutor.id : null),
    ].filter(Boolean)));

    const sanitized = JSON.parse(JSON.stringify({
      ...tutor,
      id: canonicalAuthUid,
      uid: canonicalAuthUid,
      authUid: canonicalAuthUid,
      publicTutorId,
      legacyIds,
      email: cleanEmail,
      role: 'teacher',
      approvalStatus,
      isApproved,
      status: approvalStatus,
      approved: isApproved,
      updatedAt: new Date().toISOString(),
    }));

    // Exclusively write to tutors/{canonicalAuthUid} and users/{canonicalAuthUid}
    // ELIMINATED: multiple writes to routeDocId, tutor-email, cleanEmailDocId or publicId
    const writePromises: Promise<any>[] = [
      db.collection('tutors').doc(canonicalAuthUid).set(sanitized, { merge: true }),
      db.collection('users').doc(canonicalAuthUid).set(sanitized, { merge: true }),
    ];

    const savePromise = Promise.all(writePromises).then(() => true);
    const result = await withTimeout(savePromise, 8000);
    return !!result;
  } catch (err: any) {
    if (isPermissionError(err)) {
      isCloudWriteDisabled = true;
      console.info('[serverFirestore] Remote tutor save restricted by cloud IAM credentials, continuing with local state.');
      return false;
    } else {
      console.warn('Firestore saveTutor error:', err);
      throw err;
    }
  }
}

/**
 * Fetch all Native Friend / Teacher profiles directly from unified /users collection (role == 'teacher')
 * with fallback to legacy /tutors collection, consolidated canonically to prevent any duplication.
 * Executes strictly against canonical (default) Firestore database.
 * Does not silently swallow query errors.
 */
export async function fetchTutorsFromFirestore(): Promise<any[]> {
  const db = getFirestoreDb();
  if (!db) {
    throw new Error('[serverFirestore] Canonical Firestore database (default) client is not initialized');
  }

  const fetchPromise = async () => {
    const rawList: any[] = [];

    const [usersSnap, legacySnap] = await Promise.all([
      db.collection('users').where('role', '==', 'teacher').get(),
      db.collection('tutors').get(),
    ]);

    if (usersSnap) {
      usersSnap.forEach((d) => {
        const data = d.data();
        if (data && (data.email || data.name)) {
          rawList.push({ id: d.id, ...data, role: 'teacher' });
        }
      });
    }

    if (legacySnap) {
      legacySnap.forEach((d) => {
        const data = d.data();
        if (data && (data.email || data.name)) {
          rawList.push({ id: d.id, ...data, role: 'teacher' });
        }
      });
    }

    const results = consolidateTutorsList(rawList);
    const approvedIds = results
      .filter((t) => t.approvalStatus === 'approved' || t.isApproved === true)
      .map((t) => t.publicTutorId || t.id || t.email);
    console.log('[NativeFriends Server] Retrieved consolidated Firestore tutor IDs:', approvedIds);
    return results;
  };

  const result = await withTimeout(fetchPromise(), 10000);
  if (result === null) {
    throw new Error('[serverFirestore] Timed out querying Firestore database (default) for tutors');
  }
  return result;
}

/**
 * Delete a tutor profile from /users/{tutorId} and /tutors/{tutorId}
 */
export async function deleteTutorFromFirestore(tutorId: string): Promise<boolean> {
  const db = getFirestoreDb();
  if (!db || !tutorId) return false;
  try {
    const delFromUsers = db.collection('users').doc(tutorId).delete().catch(() => null);
    const delFromTutors = db.collection('tutors').doc(tutorId).delete().catch(() => null);
    const delPromise = Promise.all([delFromUsers, delFromTutors]).then(() => true);
    const result = await withTimeout(delPromise, 6000);
    return !!result;
  } catch (err) {
    console.warn('Firestore deleteTutor error:', err);
    return false;
  }
}

/**
 * Delete user records matching a target email or doc ID across the /users collection
 */
export async function deleteUserByEmailFromFirestore(targetEmail: string): Promise<boolean> {
  const db = getFirestoreDb();
  if (!db || !targetEmail) return false;
  try {
    const cleanEmail = targetEmail.toLowerCase().trim();
    const snap = await db.collection('users').get();
    const batch = db.batch();
    let hasDeletions = false;
    for (const d of snap.docs) {
      const u = d.data();
      if ((u.email || '').toLowerCase().trim() === cleanEmail || d.id.toLowerCase() === cleanEmail) {
        batch.delete(d.ref);
        hasDeletions = true;
      }
    }
    if (hasDeletions) {
      await batch.commit();
    }
    return true;
  } catch (e) {
    console.warn('Could not delete user from Firestore users collection:', e);
    return false;
  }
}

export async function fetchAppStateFromFirestore(): Promise<any | null> {
  const db = getFirestoreDb();
  if (!db) return null;
  try {
    const fetchDoc = async (docName: string) => {
      try {
        const snap = await db.collection('app_state').doc(docName).get().catch(() => null);
        return snap && snap.exists ? snap.data() : null;
      } catch {
        return null;
      }
    };

    const fetchAllPromise = Promise.all([
      fetchDoc('main_data'),
      fetchDoc('routines'),
      fetchDoc('tutors'),
      fetchDoc('assignments'),
      fetchDoc('lessons'),
      fetchDoc('youtube_playlists'),
      fetchTutorsFromFirestore().catch(() => []),
      fetchUsersFromFirestore().catch(() => []),
    ]).then(([mainData, routines, tutors, assignments, lessons, ytPlaylists, directTutors, directUsers]) => {
      if (!mainData && !routines && !tutors && !assignments && !lessons && !ytPlaylists && (!directTutors || directTutors.length === 0) && (!directUsers || directUsers.length === 0)) {
        return null;
      }

      // Merge direct users from /users collection into userProfiles, authUsers, and students
      const mergedUserProfiles = { ...(mainData?.userProfiles || {}) };
      const mergedAuthUsers = { ...(mainData?.authUsers || {}) };
      const studentMap = new Map<string, any>();
      (mainData?.students || []).forEach((s: any) => {
        const key = (s.studentEmail || s.email || '').toLowerCase().trim();
        if (key) studentMap.set(key, s);
      });

      (directUsers || []).forEach((u: any) => {
        const key = (u.email || '').toLowerCase().trim();
        if (key) {
          const canonicalUid = (u.uid && isValidCanonicalUid(u.uid)) ? u.uid : (u.id && isValidCanonicalUid(u.id) ? u.id : null);
          if (!mergedUserProfiles[key]) {
            mergedUserProfiles[key] = {
              id: canonicalUid || u.uid || u.id,
              uid: canonicalUid || u.uid || u.id,
              name: u.name || key.split('@')[0],
              email: key,
              level: u.level || u.englishLevel || 'iniciante',
              enrollmentStatus: u.enrollmentStatus || 'active',
              learningGoal: u.learningGoal || u.goal || 'English for everyday life & work',
              weeklyStudyDaysTarget: u.weeklyStudyDaysTarget ?? 7,
              weeklyStudyDays: u.weeklyStudyDays || ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
              createdAt: u.createdAt || new Date().toISOString(),
            };
          } else if (canonicalUid) {
            mergedUserProfiles[key] = {
              ...mergedUserProfiles[key],
              ...u,
              id: canonicalUid,
              uid: canonicalUid,
            };
          }

          if (!mergedAuthUsers[key]) {
            if (canonicalUid) {
              mergedAuthUsers[key] = {
                uid: canonicalUid,
                id: canonicalUid,
                email: key,
                name: u.name || key.split('@')[0],
                role: u.role || 'student',
                createdAt: u.createdAt || new Date().toISOString(),
              };
            }
          } else if (canonicalUid) {
            mergedAuthUsers[key] = {
              ...mergedAuthUsers[key],
              uid: canonicalUid,
              id: canonicalUid,
            };
          }

          if (u.role === 'student' || !u.role) {
            const existingStudent = studentMap.get(key);
            if (!existingStudent) {
              if (canonicalUid) {
                studentMap.set(key, {
                  id: canonicalUid,
                  studentUid: canonicalUid,
                  uid: canonicalUid,
                  name: u.name || key.split('@')[0],
                  studentName: u.name || key.split('@')[0],
                  email: key,
                  studentEmail: key,
                  level: u.level || u.englishLevel || 'iniciante',
                  studentLevel: u.level || u.englishLevel || 'iniciante',
                  goal: u.learningGoal || u.goal || 'English for everyday life & work',
                  learningGoal: u.learningGoal || u.goal || 'English for everyday life & work',
                  contractedLessons: u.contractedLessons || 5,
                  completedLessonsCount: u.completedLessonsCount || 0,
                  status: 'active',
                  activeSince: (u.createdAt || new Date().toISOString()).split('T')[0],
                  createdAt: u.createdAt || new Date().toISOString(),
                });
              }
            } else if (canonicalUid) {
              studentMap.set(key, {
                ...existingStudent,
                ...u,
                id: canonicalUid,
                studentUid: canonicalUid,
                uid: canonicalUid,
              });
            }
          }
        }
      });

      const hydratedMainData = {
        ...(mainData || {}),
        userProfiles: mergedUserProfiles,
        authUsers: mergedAuthUsers,
        students: Array.from(studentMap.values()),
      };

      // Canonical consolidation of tutors from /tutors collection with app_state/tutors
      const stateTutors = Array.isArray(tutors?.tutorsList) ? tutors.tutorsList : [];
      const consolidatedTutorsList = consolidateTutorsList([...stateTutors, ...(directTutors || [])]);
      const mergedTutorsDoc = {
        ...(tutors || {}),
        tutorsList: consolidatedTutorsList,
      };

      return {
        ...hydratedMainData,
        ...(routines || {}),
        ...mergedTutorsDoc,
        ...(assignments || {}),
        ...(lessons || {}),
        ...(ytPlaylists && ytPlaylists.playlists ? { youtubePlaylists: ytPlaylists.playlists } : {}),
      };
    });
    return await withTimeout(fetchAllPromise, 15000);
  } catch (err: any) {
    const isPerm =
      err?.code === 7 ||
      err?.code === 'permission-denied' ||
      String(err?.message || '').includes('PERMISSION_DENIED');
    if (!isPerm) {
      console.info('[serverFirestore] fetchAppState notice:', err?.message || String(err));
    }
  }
  return null;
}

export async function saveYouTubePlaylistsToFirestore(playlists: any[]): Promise<boolean> {
  if (isCloudWriteDisabled) return false;
  const db = getFirestoreDb();
  if (!db || !Array.isArray(playlists) || playlists.length === 0) return false;
  try {
    const sanitized = JSON.parse(JSON.stringify(playlists));
    const totalVideos = sanitized.reduce(
      (acc: number, p: any) => acc + (Array.isArray(p.videos) ? p.videos.length : 0),
      0
    );
    const savePromise = db.collection('app_state').doc('youtube_playlists').set(
      {
        playlists: sanitized,
        count: sanitized.length,
        totalVideos,
        updatedAt: new Date().toISOString(),
        lastSyncSuccess: new Date().toISOString(),
        channelId: 'UCdimJysdxd2Hu9YmlVHB98A',
        channelTitle: 'Adm Itissimple',
      },
      { merge: true }
    ).then(() => true);
    const result = await withTimeout(savePromise, 4000);
    return !!result;
  } catch (err: any) {
    if (isPermissionError(err)) {
      isCloudWriteDisabled = true;
      console.info('[serverFirestore] Remote YouTube playlists cloud write restricted by environment IAM credentials. Playlists saved to local server storage.');
    } else {
      console.warn('Firestore saveYouTubePlaylists error:', err);
    }
    return false;
  }
}

export async function fetchYouTubePlaylistsDocFromFirestore(): Promise<{
  playlists: any[];
  count: number;
  totalVideos: number;
  updatedAt?: string;
  lastSyncSuccess?: string;
} | null> {
  const db = getFirestoreDb();
  if (!db) return null;
  try {
    const fetchPromise = async () => {
      const snap = await db.collection('app_state').doc('youtube_playlists').get();
      if (snap.exists) {
        const data = snap.data();
        if (Array.isArray(data?.playlists) && data.playlists.length > 0) {
          return {
            playlists: data.playlists,
            count: data.playlists.length,
            totalVideos: data.totalVideos || 0,
            updatedAt: data.updatedAt,
            lastSyncSuccess: data.lastSyncSuccess,
          };
        }
      }
      return null;
    };
    return await withTimeout(fetchPromise(), 4000);
  } catch (err) {
    console.warn('Firestore fetchYouTubePlaylistsDoc error:', err);
    return null;
  }
}

export async function fetchYouTubePlaylistsFromFirestore(): Promise<any[] | null> {
  const doc = await fetchYouTubePlaylistsDocFromFirestore();
  return doc?.playlists || null;
}

export async function saveYouTubeAuthToFirestore(authData: { token: string; updatedAt?: string }): Promise<boolean> {
  if (isCloudWriteDisabled) return false;
  const db = getFirestoreDb();
  if (!db || !authData?.token) return false;
  try {
    const savePromise = db.collection('app_state').doc('youtube_auth').set(
      {
        token: authData.token,
        updatedAt: authData.updatedAt || new Date().toISOString(),
        account: 'adm.itissimple@gmail.com',
      },
      { merge: true }
    ).then(() => true);
    const result = await withTimeout(savePromise, 3000);
    return !!result;
  } catch (err: any) {
    if (isPermissionError(err)) {
      isCloudWriteDisabled = true;
    }
    return false;
  }
}

export async function fetchYouTubeAuthFromFirestore(): Promise<{ token: string; updatedAt?: string } | null> {
  const db = getFirestoreDb();
  if (!db) return null;
  try {
    const fetchPromise = async () => {
      const snap = await db.collection('app_state').doc('youtube_auth').get();
      if (snap.exists) {
        const data = snap.data();
        if (data?.token) {
          return {
            token: data.token,
            updatedAt: data.updatedAt,
          };
        }
      }
      return null;
    };
    return await withTimeout(fetchPromise(), 3000);
  } catch (err) {
    return null;
  }
}

export async function saveAppStateToFirestore(data: any): Promise<boolean> {
  if (isCloudWriteDisabled) return false;
  const db = getFirestoreDb();
  if (!db || !data) return false;
  try {
    const sanitized = JSON.parse(JSON.stringify(data));
    const cachedYtPlaylists = Array.isArray(sanitized.youtubePlaylists) ? sanitized.youtubePlaylists : null;

    // Strip out external API caches that must not be stored in main Firestore documents
    delete sanitized.youtubePlaylists;

    const routinesData = {
      studentRoutinesMap: sanitized.studentRoutinesMap || {},
      studentCurrentRoutines: sanitized.studentCurrentRoutines || {},
      routinesByDay: sanitized.routinesByDay || {},
      studentWeeklyChecks: sanitized.studentWeeklyChecks || {},
      weeklyNativeTargets: sanitized.weeklyNativeTargets || {},
      updatedAt: new Date().toISOString(),
    };

    // HOTFIX PONTUAL: Isolamento do JSON de Testes — impedir que registros originados do JSON local sejam gravados no Firestore
    const isLocalJsonOrTestRecord = (item: any): boolean => {
      if (!item || typeof item !== 'object') return false;
      if (item.isLocalJsonRecord || item.origin === 'local_json' || item.source === 'app_db.json') return true;
      const email = String(item.email || item.studentEmail || item.teacherEmail || '').toLowerCase().trim();
      if (email.endsWith('@example.com') || email.endsWith('@test.com')) return true;
      const uid = String(item.authUid || item.uid || item.studentUid || item.id || '').trim();
      if (uid && !isValidCanonicalUid(uid) && !uid.includes('@')) {
        return true;
      }
      return false;
    };

    const tutorsData = {
      tutorsList: (sanitized.tutorsList || []).filter((t: any) => !isLocalJsonOrTestRecord(t)),
      teachers: (sanitized.teachers || []).filter((t: any) => !isLocalJsonOrTestRecord(t)),
      deletedTutorEmails: sanitized.deletedTutorEmails || [],
      deletedTutorIds: sanitized.deletedTutorIds || [],
      updatedAt: new Date().toISOString(),
    };

    const assignmentsData = {
      studentVideoAssignments: sanitized.studentVideoAssignments || {},
      studentSpotifyAssignments: sanitized.studentSpotifyAssignments || {},
      studentWatchedVideos: sanitized.studentWatchedVideos || {},
      studentListenedTracks: sanitized.studentListenedTracks || {},
      studentAwaitingTopicSelection: sanitized.studentAwaitingTopicSelection || {},
      weeklyStudyDays: sanitized.weeklyStudyDays || {},
      weeklyStudyDaysTargets: sanitized.weeklyStudyDaysTargets || {},
      updatedAt: new Date().toISOString(),
    };

    const lessonsData = {
      liveLessons: (sanitized.liveLessons || []).filter((l: any) => !isLocalJsonOrTestRecord(l)),
      contractedLessons: sanitized.contractedLessons || {},
      weeklyHomework: sanitized.weeklyHomework || {},
      studentHomeworkMap: sanitized.studentHomeworkMap || {},
      updatedAt: new Date().toISOString(),
    };

    const mainData = { ...sanitized };
    delete mainData.studentRoutinesMap;
    delete mainData.studentCurrentRoutines;
    delete mainData.routinesByDay;
    delete mainData.studentWeeklyChecks;
    delete mainData.weeklyNativeTargets;
    delete mainData.tutorsList;
    delete mainData.teachers;
    delete mainData.deletedTutorEmails;
    delete mainData.deletedTutorIds;
    delete mainData.studentVideoAssignments;
    delete mainData.studentSpotifyAssignments;
    delete mainData.studentWatchedVideos;
    delete mainData.studentListenedTracks;
    delete mainData.studentAwaitingTopicSelection;
    delete mainData.weeklyStudyDays;
    delete mainData.weeklyStudyDaysTargets;
    delete mainData.liveLessons;
    delete mainData.contractedLessons;
    delete mainData.weeklyHomework;
    delete mainData.studentHomeworkMap;
    mainData.updatedAt = new Date().toISOString();

    // Security Hardening 4B.17B & Isolamento do JSON de Testes: Eliminate plaintext passwords & local JSON from state trees
    if (mainData.authUsers && typeof mainData.authUsers === 'object') {
      const cleanAuthUsers: Record<string, any> = {};
      for (const [k, v] of Object.entries(mainData.authUsers)) {
        if (v && typeof v === 'object' && !isLocalJsonOrTestRecord(v)) {
          const userObj = { ...(v as any) };
          delete userObj.password;
          const uUid = userObj.uid || userObj.id;
          if (uUid && isValidCanonicalUid(uUid)) {
            cleanAuthUsers[k] = userObj;
          }
        }
      }
      mainData.authUsers = cleanAuthUsers;
    }
    if (mainData.userProfiles && typeof mainData.userProfiles === 'object') {
      const cleanProfiles: Record<string, any> = {};
      for (const [k, v] of Object.entries(mainData.userProfiles)) {
        if (v && typeof v === 'object' && !isLocalJsonOrTestRecord(v)) {
          const profObj = { ...(v as any) };
          delete profObj.password;
          const pUid = profObj.uid || profObj.id;
          if (pUid && isValidCanonicalUid(pUid)) {
            cleanProfiles[k] = profObj;
          }
        }
      }
      mainData.userProfiles = cleanProfiles;
    }
    if (Array.isArray(mainData.students)) {
      mainData.students = mainData.students
        .filter((s: any) => !isLocalJsonOrTestRecord(s))
        .map((s: any) => {
          if (s) delete s.password;
          return s;
        });
    }
    if (Array.isArray(tutorsData.tutorsList)) {
      for (const t of tutorsData.tutorsList) {
        if (t) delete t.password;
      }
    }
    if (Array.isArray(tutorsData.teachers)) {
      for (const t of tutorsData.teachers) {
        if (t) delete t.password;
      }
    }

    let tutorsDocToWrite = tutorsData;
    const hasIntentionalDeletion = Array.isArray(tutorsData.deletedTutorEmails) && tutorsData.deletedTutorEmails.length > 0;
    if ((!tutorsData.tutorsList || tutorsData.tutorsList.length === 0) && !hasIntentionalDeletion) {
      try {
        const existingSnap = await db.collection('app_state').doc('tutors').get().catch(() => null);
        if (existingSnap && existingSnap.exists) {
          const exData = existingSnap.data();
          if (Array.isArray(exData?.tutorsList) && exData.tutorsList.length > 0) {
            tutorsDocToWrite = {
              ...tutorsData,
              tutorsList: exData.tutorsList,
              teachers: (tutorsData.teachers && tutorsData.teachers.length > 1) ? tutorsData.teachers : (exData.teachers || tutorsData.teachers),
              updatedAt: new Date().toISOString(),
            };
          }
        }
      } catch {}
    }

    if (Array.isArray(tutorsDocToWrite.tutorsList)) {
      for (const t of tutorsDocToWrite.tutorsList) {
        if (t) delete t.password;
      }
    }
    if (Array.isArray(tutorsDocToWrite.teachers)) {
      for (const t of tutorsDocToWrite.teachers) {
        if (t) delete t.password;
      }
    }

    const tutorSavePromises = (Array.isArray(tutorsDocToWrite.tutorsList) ? tutorsDocToWrite.tutorsList : []).map((tut: any) => {
      if (tut && (tut.authUid || tut.uid || tut.id || tut.email)) {
        const cEmail = (tut.email || '').toLowerCase().trim();
        const candidateAuthUid = (tut.authUid && isValidCanonicalUid(tut.authUid) ? tut.authUid : null) ||
          (tut.uid && isValidCanonicalUid(tut.uid) ? tut.uid : null) ||
          (tut.id && isValidCanonicalUid(tut.id) ? tut.id : null);

        if (candidateAuthUid) {
          const nameSlug = tut.name && typeof tut.name === 'string' && !isGenericTutorId(tut.name)
            ? normalizeTutorName(tut.name).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
            : '';
          const publicTutorId =
            (tut.publicTutorId && !isGenericTutorId(tut.publicTutorId) ? tut.publicTutorId : null) ||
            (tut.id && !isValidCanonicalUid(tut.id) && !isGenericTutorId(tut.id) ? tut.id : null) ||
            (cEmail ? `tutor-${cEmail.replace(/[^a-zA-Z0-9]/g, '-')}` : null) ||
            (nameSlug && !isGenericTutorId(nameSlug) ? nameSlug : null) ||
            candidateAuthUid;
          const teacherData = {
            ...tut,
            id: candidateAuthUid,
            uid: candidateAuthUid,
            authUid: candidateAuthUid,
            publicTutorId,
            email: cEmail,
            role: 'teacher',
            updatedAt: tut.updatedAt || new Date().toISOString(),
          };
          delete teacherData.password;
          const p1 = db.collection('users').doc(candidateAuthUid).set(teacherData, { merge: true }).catch(() => null);
          const p2 = db.collection('tutors').doc(candidateAuthUid).set(teacherData, { merge: true }).catch(() => null);
          return Promise.all([p1, p2]);
        }
      }
      return Promise.resolve();
    });

    const savePromises = Promise.all([
      db.collection('app_state').doc('main_data').set(mainData, { merge: true }),
      db.collection('app_state').doc('routines').set(routinesData, { merge: true }),
      db.collection('app_state').doc('tutors').set(tutorsDocToWrite, { merge: true }),
      db.collection('app_state').doc('assignments').set(assignmentsData, { merge: true }),
      db.collection('app_state').doc('lessons').set(lessonsData, { merge: true }),
      ...tutorSavePromises,
      ...(cachedYtPlaylists ? [saveYouTubePlaylistsToFirestore(cachedYtPlaylists)] : []),
    ]).then(() => true);

    const result = await withTimeout(savePromises, 15000);
    return !!result;
  } catch (err: any) {
    if (isPermissionError(err)) {
      isCloudWriteDisabled = true;
      console.info('[serverFirestore] Remote app_state cloud write restricted by environment IAM credentials. App state safely preserved in local disk storage.');
    } else {
      console.warn('Firestore saveAppState error:', err);
    }
    return false;
  }
}

export async function saveUserToFirestore(user: any): Promise<boolean> {
  if (isCloudWriteDisabled) return false;
  const db = getFirestoreDb();
  if (!db || !user?.email) return false;
  try {
    const sanitized = JSON.parse(JSON.stringify(user));
    // Security Hardening 4B.17B: Never write credentials or passwords to Firestore documents
    delete sanitized.password;
    delete sanitized.confirmPassword;
    delete sanitized.newPassword;

    const cleanEmail = user.email.toLowerCase().trim();
    const docId = user.uid || (user.id && !user.id.includes('@') && !user.id.startsWith('usr-') ? user.id : '');
    if (!docId) {
      console.warn('saveUserToFirestore skipped: user has no valid Auth UID');
      return false;
    }

    sanitized.email = cleanEmail;
    sanitized.uid = docId;
    sanitized.id = docId;

    const savePromise = db.collection('users').doc(docId).set(sanitized, { merge: true });
    const result = await withTimeout(savePromise.then(() => true), 10000);
    return !!result;
  } catch (err: any) {
    if (isPermissionError(err)) {
      isCloudWriteDisabled = true;
      console.info('[serverFirestore] Remote user cloud save restricted by environment IAM credentials, continuing with local state.');
    } else {
      console.warn('Firestore saveUser error:', err);
    }
    return false;
  }
}

export async function fetchUsersFromFirestore(): Promise<any[]> {
  const db = getFirestoreDb();
  if (!db) return [];
  try {
    const fetchPromise = async () => {
      const snap = await db.collection('users').get().catch((queryErr: any) => {
        const isPerm =
          queryErr?.code === 7 ||
          queryErr?.code === 'permission-denied' ||
          String(queryErr?.message || '').includes('PERMISSION_DENIED') ||
          String(queryErr?.message || '').includes('Missing or insufficient permissions');
        if (isPerm) {
          console.info('[serverFirestore] Users collection read restricted by cloud IAM credentials, continuing with local state.');
        } else {
          console.info('[serverFirestore] Users collection query notice:', queryErr?.message || String(queryErr));
        }
        return null;
      });
      if (!snap) return [];
      const list: any[] = [];
      snap.forEach((d: any) => {
        const data = d.data();
        if (data && (data.email || data.id)) {
          list.push({
            id: d.id,
            ...data,
          });
        }
      });
      return list;
    };
    const result = await withTimeout(fetchPromise(), 10000);
    return result || [];
  } catch (err: any) {
    const isPerm =
      err?.code === 7 ||
      err?.code === 'permission-denied' ||
      String(err?.message || '').includes('PERMISSION_DENIED') ||
      String(err?.message || '').includes('Missing or insufficient permissions');
    if (isPerm) {
      console.info('[serverFirestore] Users collection read restricted by cloud IAM credentials, continuing with local state.');
    } else {
      console.info('[serverFirestore] Users collection query notice:', err?.message || String(err));
    }
    return [];
  }
}

export async function fetchUserFromFirestore(email: string, uid?: string): Promise<any | null> {
  const db = getFirestoreDb();
  if (!db || (!email && !uid)) return null;
  try {
    const cleanDocId = email ? email.toLowerCase().trim().replace(/[^a-zA-Z0-9]/g, '-') : '';
    const cleanEmail = email ? email.toLowerCase().trim() : '';

    const fetchPromise = (async () => {
      if (uid) {
        const snapUid = await db.collection('users').doc(uid).get().catch(() => null);
        if (snapUid && snapUid.exists) return snapUid.data();
      }
      if (cleanDocId) {
        const snapEmail = await db.collection('users').doc(cleanDocId).get().catch(() => null);
        if (snapEmail && snapEmail.exists) return snapEmail.data();
      }
      if (cleanEmail) {
        try {
          const qSnap = await db.collection('users').where('email', '==', cleanEmail).get().catch(() => null);
          if (qSnap && !qSnap.empty) {
            return qSnap.docs[0].data();
          }
        } catch {}
      }
      return null;
    })();
    return await withTimeout(fetchPromise, 8000);
  } catch (err: any) {
    const isPerm =
      err?.code === 7 ||
      err?.code === 'permission-denied' ||
      String(err?.message || '').includes('PERMISSION_DENIED');
    if (!isPerm) {
      console.info('[serverFirestore] fetchUser notice:', err?.message || String(err));
    }
    return null;
  }
}

export async function checkUserExistsInFirestore(email: string): Promise<boolean> {
  if (!email) return false;
  const user = await fetchUserFromFirestore(email);
  return Boolean(user);
}

/**
 * Fast direct fetch of user document by docId (UID or sanitized email)
 */
export async function fetchUserDocumentFromFirestore(docId: string, timeoutMs: number = 500): Promise<any | null> {
  const db = getFirestoreDb();
  if (!db || !docId) return null;
  try {
    const snap = await withTimeout(db.collection('users').doc(docId).get(), timeoutMs);
    return snap && snap.exists ? snap.data() : null;
  } catch {
    return null;
  }
}

/**
 * Fast direct fetch of tutor document by docId (UID or tutor ID)
 */
export async function fetchTutorDocumentFromFirestore(docId: string, timeoutMs: number = 3500): Promise<any | null> {
  const db = getFirestoreDb();
  if (!db || !docId) return null;
  try {
    // 1. Direct lookup in /tutors/{docId}
    const snap = await withTimeout(db.collection('tutors').doc(docId).get(), timeoutMs);
    if (snap && snap.exists) {
      return { id: docId, ...snap.data() };
    }

    // 2. Direct lookup in /users/{docId}
    const userSnap = await withTimeout(db.collection('users').doc(docId).get(), timeoutMs);
    if (userSnap && userSnap.exists) {
      const uData = userSnap.data();
      if (uData && (uData.role === 'teacher' || uData.role === 'tutor' || uData.role === 'native_friend' || uData.approvalStatus)) {
        return { id: docId, ...uData };
      }
    }

    // 3. Sanitized email doc ID
    const cleanDocId = docId.toLowerCase().trim().replace(/[^a-zA-Z0-9]/g, '-');
    if (cleanDocId && cleanDocId !== docId) {
      const cleanTutorSnap = await withTimeout(db.collection('tutors').doc(cleanDocId).get(), timeoutMs);
      if (cleanTutorSnap && cleanTutorSnap.exists) {
        return { id: cleanDocId, ...cleanTutorSnap.data() };
      }
      const cleanUserSnap = await withTimeout(db.collection('users').doc(cleanDocId).get(), timeoutMs);
      if (cleanUserSnap && cleanUserSnap.exists) {
        return { id: cleanDocId, ...cleanUserSnap.data() };
      }
    }

    // 4. Query by id, email, or uid in tutors and users
    const queryPromises: Promise<any>[] = [
      db.collection('tutors').where('id', '==', docId).limit(1).get().catch(() => null),
      db.collection('users').where('id', '==', docId).limit(1).get().catch(() => null),
    ];
    if (docId.includes('@')) {
      const lowerEmail = docId.toLowerCase().trim();
      queryPromises.push(db.collection('tutors').where('email', '==', lowerEmail).limit(1).get().catch(() => null));
      queryPromises.push(db.collection('users').where('email', '==', lowerEmail).limit(1).get().catch(() => null));
    }
    const querySnaps = await withTimeout(Promise.all(queryPromises), timeoutMs);
    if (querySnaps) {
      for (const qSnap of querySnaps) {
        if (qSnap && !qSnap.empty && qSnap.docs[0]?.exists) {
          const matchedDoc = qSnap.docs[0];
          return { id: matchedDoc.id, ...matchedDoc.data() };
        }
      }
    }

    // 5. Check app_state/tutors
    const appStateSnap = await withTimeout(db.collection('app_state').doc('tutors').get(), timeoutMs);
    if (appStateSnap && appStateSnap.exists) {
      const stateData = appStateSnap.data();
      if (stateData && Array.isArray(stateData.tutorsList)) {
        const found = stateData.tutorsList.find(
          (t: any) => t.id === docId || (t.email && t.email.toLowerCase() === docId.toLowerCase())
        );
        if (found) return found;
      }
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Dedicated persistence for Student Media Assignments (YouTube & Spotify) directly linked to UID.
 */
export async function saveStudentAssignmentsByUid(
  uid: string,
  data: {
    uid?: string;
    email?: string;
    level?: string;
    weeklyCycle?: number;
    weeklyStudyDaysTarget?: number;
    weeklyStudyDays?: string[];
    videoAssignments?: any[];
    spotifyAssignments?: any[];
    routines?: any;
    watchedVideos?: string[];
    listenedTracks?: string[];
    updatedAt?: string;
  }
): Promise<boolean> {
  if (isCloudWriteDisabled) return false;
  const db = getFirestoreDb();
  if (!db || !uid) return false;
  try {
    const sanitized = JSON.parse(JSON.stringify({
      ...data,
      uid,
      updatedAt: data.updatedAt || new Date().toISOString(),
    }));
    const savePromise = db.collection('student_assignments').doc(uid).set(sanitized, { merge: true }).then(() => true);
    const result = await withTimeout(savePromise, 2000);
    return !!result;
  } catch (err: any) {
    if (isPermissionError(err)) {
      isCloudWriteDisabled = true;
      console.info('[serverFirestore] Remote student assignments write restricted by IAM, continuing with local state.');
    } else {
      console.warn('Firestore saveStudentAssignmentsByUid error:', err);
    }
    return false;
  }
}

export async function fetchStudentAssignmentsByUid(uid: string): Promise<any | null> {
  const db = getFirestoreDb();
  if (!db || !uid) return null;
  try {
    const fetchPromise = db.collection('student_assignments').doc(uid).get().then((snap) => {
      if (snap.exists) {
        return snap.data();
      }
      return null;
    });
    return await withTimeout(fetchPromise, 2000);
  } catch (err: any) {
    if (!isPermissionError(err)) {
      console.warn('Firestore fetchStudentAssignmentsByUid error:', err);
    }
    return null;
  }
}

/**
 * Dedicated persistence for Teacher Availability Schedule directly linked to UID and Email.
 */
export async function saveTeacherAvailabilityToFirestore(
  uidOrEmail: string,
  data: {
    uid?: string;
    teacherEmail?: string;
    meetLink?: string;
    timezone?: string;
    availableDays?: string[];
    availableHours?: string[];
    availableHoursByDay?: Record<string, string[]>;
    availability?: Record<string, string[]>;
    workingHoursStart?: string;
    workingHoursEnd?: string;
    updatedAt?: string;
  }
): Promise<boolean> {
  if (isCloudWriteDisabled) return false;
  const db = getFirestoreDb();
  if (!db || !uidOrEmail) return false;
  try {
    const sanitized = JSON.parse(JSON.stringify({
      ...data,
      updatedAt: data.updatedAt || new Date().toISOString(),
    }));

    // Resolve canonical document ID:
    // If a canonical UID is provided (in data.uid or uidOrEmail without '@'),
    // preserve its exact case (Firebase Auth UID). Never lowercase canonical UIDs.
    const isUid = (data.uid && !data.uid.includes('@')) || (!uidOrEmail.includes('@'));
    const canonicalDocId = isUid
      ? (data.uid || uidOrEmail).trim()
      : uidOrEmail.toLowerCase().trim().replace(/[^a-zA-Z0-9_-]/g, '_');

    const savePromise = db.collection('teacher_availability').doc(canonicalDocId).set(sanitized, { merge: true }).then(() => true);

    const result = await withTimeout(savePromise, 2000);
    return !!result;
  } catch (err: any) {
    if (isPermissionError(err)) {
      isCloudWriteDisabled = true;
      console.info('[serverFirestore] Remote teacher availability write restricted by IAM, continuing with local state.');
    } else {
      console.warn('Firestore saveTeacherAvailabilityToFirestore error:', err);
    }
    return false;
  }
}

export async function fetchTeacherAvailabilityFromFirestore(uidOrEmail: string): Promise<any | null> {
  const db = getFirestoreDb();
  if (!db || !uidOrEmail) return null;
  try {
    const rawId = uidOrEmail.trim();
    const fetchPromise = db.collection('teacher_availability').doc(rawId).get().then(async (snap) => {
      if (snap.exists) {
        return snap.data();
      }
      // For backward compatibility: if not found and input has uppercase letters, check lowercase doc
      const lowerId = rawId.toLowerCase();
      if (lowerId !== rawId) {
        const snapLower = await db.collection('teacher_availability').doc(lowerId).get();
        if (snapLower.exists) return snapLower.data();
      }
      // If email, try sanitized email format
      if (rawId.includes('@')) {
        const cleanEmailId = lowerId.replace(/[^a-zA-Z0-9_-]/g, '_');
        if (cleanEmailId !== rawId && cleanEmailId !== lowerId) {
          const snapEmail = await db.collection('teacher_availability').doc(cleanEmailId).get();
          if (snapEmail.exists) return snapEmail.data();
        }
      }
      return null;
    });
    return await withTimeout(fetchPromise, 2000);
  } catch (err: any) {
    if (!isPermissionError(err)) {
      console.warn('Firestore fetchTeacherAvailabilityFromFirestore error:', err);
    }
    return null;
  }
}

/**
 * Persists daily routine video selection to users/{uid}/routines/{dayOfWeek}
 * and mirrors to users/{uid}.routinesByDay with weekly cycle binding
 */
export async function saveRoutineVideoSubcollection(
  uid: string,
  dayOfWeek: string,
  data: any,
  weeklyCycle?: number
): Promise<boolean> {
  if (isCloudWriteDisabled) return false;
  const db = getFirestoreDb();
  if (!db || !uid || !dayOfWeek) return false;
  try {
    const userRef = db.collection('users').doc(uid);
    let targetCycle = typeof weeklyCycle === 'number' && weeklyCycle > 0 ? weeklyCycle : 1;
    try {
      const uSnap = await withTimeout(userRef.get(), 2500);
      if (uSnap && uSnap.exists) {
        const uData = uSnap.data();
        if (typeof uData?.weeklyCycle === 'number' && uData.weeklyCycle > 0) {
          targetCycle = Math.max(targetCycle, uData.weeklyCycle);
        }
      }
    } catch {}

    const cleanVidId = (data.videoId || '').trim();
    const cleanTitle = (data.title || data.videoTitle || (cleanVidId ? 'Daily Video Practice' : 'Video of the Day')).trim();
    const cleanUrl = data.url || (cleanVidId ? `https://www.youtube.com/watch?v=${cleanVidId}` : '');

    const sanitized = JSON.parse(JSON.stringify({
      ...data,
      id: data.id || (cleanVidId ? `vid-${cleanVidId}` : `vid-${dayOfWeek}`),
      videoId: cleanVidId,
      title: cleanTitle,
      videoTitle: cleanTitle,
      url: cleanUrl,
      playlistId: data.playlistId || '',
      playlistTitle: data.playlistTitle || '',
      dayOfWeek,
      activityId: data.activityId || 'act-1',
      isRepeatVideo: Boolean(data.isRepeatVideo),
      instructions: data.instructions || '',
      duration: data.duration || '5-10 min',
      weeklyCycle: targetCycle,
      updatedAt: data.updatedAt || new Date().toISOString(),
    }));

    const savePromise = userRef.collection('routines').doc(dayOfWeek).set(sanitized, { merge: true }).then(() => true);
    const saveResult = await withTimeout(savePromise, 4500);

    // Also mirror to user doc routinesByDay for instant multi-device hydration
    await withTimeout(
      userRef.set(
        {
          routinesByDay: {
            [dayOfWeek]: sanitized,
          },
          weeklyCycle: targetCycle,
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      ),
      3500
    );

    return !!saveResult;
  } catch (err: any) {
    if (isPermissionError(err)) {
      isCloudWriteDisabled = true;
      console.info('[serverFirestore] Remote routine video write restricted by IAM, continuing with local state.');
    } else {
      console.warn('Firestore saveRoutineVideoSubcollection error:', err);
    }
    return false;
  }
}

/**
 * Retrieves persisted daily routine video selections from users/{uid}/routines/{dayOfWeek}
 * filtered strictly by the student's active weekly cycle.
 */
export async function fetchRoutineVideosFromFirestoreServer(
  uid: string,
  weeklyCycle?: number
): Promise<{
  routinesByDay: Record<string, any>;
  weeklyCycle: number;
  watchedVideosHistory: string[];
}> {
  const result: {
    routinesByDay: Record<string, any>;
    weeklyCycle: number;
    watchedVideosHistory: string[];
  } = {
    routinesByDay: {},
    weeklyCycle: weeklyCycle || 1,
    watchedVideosHistory: [],
  };

  const db = getFirestoreDb();
  if (!db || !uid) return result;

  try {
    const userRef = db.collection('users').doc(uid);
    const userSnap = await withTimeout(userRef.get(), 4000);

    let activeCycle = weeklyCycle || 1;
    if (userSnap && userSnap.exists) {
      const uData = userSnap.data() || {};
      if (typeof uData.weeklyCycle === 'number' && uData.weeklyCycle > 0) {
        activeCycle = uData.weeklyCycle;
      }
      result.weeklyCycle = activeCycle;

      const history = uData.watchedVideosHistory || uData.watchedVideos || [];
      const journal = Array.isArray(uData.studentJournal) ? uData.studentJournal : [];
      const idsFromHistory = Array.isArray(history)
        ? history.map((item: any) => (typeof item === 'string' ? item : item?.videoId || item?.id || '')).filter(Boolean)
        : [];
      const idsFromJournal = journal
        .filter((entry: any) => entry && entry.type === 'video' && entry.id)
        .map((entry: any) => (typeof entry.id === 'string' ? entry.id : entry.id?.videoId || ''))
        .filter(Boolean);
      result.watchedVideosHistory = Array.from(new Set([...idsFromHistory, ...idsFromJournal]));

      if (uData.routinesByDay && typeof uData.routinesByDay === 'object') {
        Object.entries(uData.routinesByDay).forEach(([day, item]: [string, any]) => {
          if (item && typeof item === 'object') {
            const itemCycle = typeof item.weeklyCycle === 'number' ? item.weeklyCycle : activeCycle;
            const hasConfiguredVideo = Boolean((item.videoId && item.videoId.trim() !== '') || (item.url && item.url.trim() !== ''));
            if (itemCycle === activeCycle || hasConfiguredVideo) {
              result.routinesByDay[day] = item;
            }
          }
        });
      }
    }

    const routinesSnap = await withTimeout(userRef.collection('routines').get(), 4000);
    if (routinesSnap && !routinesSnap.empty) {
      routinesSnap.forEach((docSnap: any) => {
        const data = docSnap.data();
        if (data) {
          const day = docSnap.id;
          const itemCycle = typeof data.weeklyCycle === 'number' ? data.weeklyCycle : activeCycle;
          const hasConfiguredVideo = Boolean((data.videoId && data.videoId.trim() !== '') || (data.url && data.url.trim() !== ''));
          if (itemCycle === activeCycle || hasConfiguredVideo) {
            result.routinesByDay[day] = {
              ...data,
              dayOfWeek: day,
            };
          }
        }
      });
    }

    return result;
  } catch (err: any) {
    if (!isPermissionError(err)) {
      console.warn('[serverFirestore] Error in fetchRoutineVideosFromFirestoreServer:', err);
    }
    return result;
  }
}

/**
 * Resets daily routines in Firestore for a new weekly cycle:
 * Clears videoId, title, playlistId, and repeat flags so all days start cleanly on "Choose a Topic".
 * Preserves past cycle history in weeklyHistory.
 */
export async function resetDailyRoutinesForNewWeekInFirestoreServer(
  uid: string,
  targetCycle: number,
  days: string[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
): Promise<boolean> {
  const db = getFirestoreDb();
  if (!db || !uid) return false;

  try {
    const userRef = db.collection('users').doc(uid);
    const routinesCol = userRef.collection('routines');

    const emptyRoutinesByDay: Record<string, any> = {};

    const resetPromises = days.map((day) => {
      const resetPayload = {
        videoId: '',
        title: '',
        videoTitle: '',
        url: '',
        playlistId: '',
        playlistTitle: '',
        isRepeatVideo: false,
        dayOfWeek: day,
        activityId: 'act-1',
        instructions: '',
        duration: '',
        completed: false,
        completedToday: false,
        weeklyCycle: targetCycle,
        updatedAt: new Date().toISOString(),
      };
      emptyRoutinesByDay[day] = resetPayload;
      return routinesCol.doc(day).set(resetPayload, { merge: true });
    });

    await withTimeout(Promise.all(resetPromises), 5000);

    await withTimeout(
      userRef.set(
        {
          weeklyCycle: targetCycle,
          routinesByDay: emptyRoutinesByDay,
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      ),
      3500
    );

    return true;
  } catch (err: any) {
    if (!isPermissionError(err)) {
      console.warn('[serverFirestore] Error in resetDailyRoutinesForNewWeekInFirestoreServer:', err);
    }
    return false;
  }
}

/**
 * Resets isRepeatVideo: false for all days in users/{uid}/routines/{dayOfWeek}
 */
export async function resetRepeatFlagsSubcollection(
  uid: string,
  days: string[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
): Promise<boolean> {
  if (isCloudWriteDisabled) return false;
  const db = getFirestoreDb();
  if (!db || !uid) return false;
  try {
    await Promise.all(
      days.map((day) =>
        db.collection('users').doc(uid).collection('routines').doc(day).set(
          { isRepeatVideo: false, updatedAt: new Date().toISOString() },
          { merge: true }
        )
      )
    );
    return true;
  } catch (err: any) {
    if (isPermissionError(err)) {
      isCloudWriteDisabled = true;
      console.info('[serverFirestore] Remote repeat flags reset restricted by IAM, continuing with local state.');
    } else {
      console.warn('Firestore resetRepeatFlagsSubcollection error:', err);
    }
    return false;
  }
}

/**
 * Appends videoId to users/{uid} watchedVideosHistory array
 */
export async function addWatchedVideoToUserDoc(
  uid: string,
  videoId: string,
  videoTitle?: string
): Promise<boolean> {
  if (isCloudWriteDisabled) return false;
  const db = getFirestoreDb();
  if (!db || !uid || !videoId) return false;
  try {
    const cleanVid = (videoId || '').trim();
    const cleanTitle = (videoTitle || 'Daily Video Practice').trim();
    const userRef = db.collection('users').doc(uid);
    const snap = await userRef.get();
    const existing = snap.exists ? (snap.data()?.watchedVideosHistory || snap.data()?.watchedVideos || []) : [];
    const list = Array.isArray(existing) ? [...existing] : [];

    const alreadyExists = list.some((item) => {
      if (typeof item === 'string') return item.toLowerCase() === cleanVid.toLowerCase();
      if (item && typeof item === 'object') {
        const id = item.videoId || item.id || '';
        return id.toLowerCase() === cleanVid.toLowerCase();
      }
      return false;
    });

    if (!alreadyExists) {
      list.push({
        videoId: cleanVid,
        videoTitle: cleanTitle,
        watchedAt: new Date().toISOString(),
      });
      await userRef.set({ watchedVideosHistory: list, updatedAt: new Date().toISOString() }, { merge: true });
    }
    return true;
  } catch (err: any) {
    if (isPermissionError(err)) {
      isCloudWriteDisabled = true;
      console.info('[serverFirestore] Remote watched video append restricted by IAM, continuing with local state.');
    } else {
      console.warn('Firestore addWatchedVideoToUserDoc error:', err);
    }
    return false;
  }
}


export interface ResolveStudentIdentityParams {
  caller: {
    uid: string;
    email?: string;
    role: 'admin' | 'teacher' | 'student';
  };
  studentEmail?: string;
  studentUid?: string;
  lessonId?: string;
}

export interface ResolvedStudentIdentityResult {
  authorized: boolean;
  canonicalStudentUid: string;
  studentEmail: string;
  error?: string;
  statusCode?: number;
}

/**
 * Resolves the unequivocal canonical Firebase Auth UID of a student on the trusted backend.
 * Enforces strict authorization:
 * - Students can only access/modify their own dictionary.
 * - Teachers must have an existing authorized pedagogical link (verified lesson or assigned student profile).
 * - Teacher UID can NEVER be substituted as student UID.
 * - Synthetic IDs (usr-*, st-*) are rejected.
 * - If canonical UID cannot be unequivocally verified, recording is aborted with an explicit error.
 */
export async function resolveCanonicalStudentIdentity(
  params: ResolveStudentIdentityParams
): Promise<ResolvedStudentIdentityResult> {
  const { caller, studentEmail, studentUid, lessonId } = params;

  if (!caller || !caller.uid) {
    return {
      authorized: false,
      canonicalStudentUid: '',
      studentEmail: '',
      error: 'Authentication required: verified user token missing.',
      statusCode: 401,
    };
  }

  const cleanReqEmail = (studentEmail || '').toLowerCase().trim();
  const cleanReqUid = (studentUid || '').trim();
  const callerEmail = (caller.email || '').toLowerCase().trim();
  const callerUid = (caller.uid || '').trim();

  // Authoritative DB access
  const dbLocal = getAuthoritativeDb();

  // Determine effective caller role with in-memory tutor validation fallback
  let callerRole = caller.role;
  if (callerRole === 'student' && dbLocal) {
    const isTutor =
      (dbLocal.tutorsList || []).some((t: any) => (t.uid && t.uid === callerUid) || (t.id && (t.id === callerUid || t.id === `tutor-${callerUid}`)) || (t.authUid && t.authUid === callerUid) || (callerEmail && t.email && t.email.toLowerCase().trim() === callerEmail)) ||
      (dbLocal.teachers || []).some((t: any) => (t.uid && t.uid === callerUid) || (t.id && (t.id === callerUid || t.id === `tutor-${callerUid}`)) || (t.authUid && t.authUid === callerUid) || (callerEmail && t.email && t.email.toLowerCase().trim() === callerEmail));
    if (isTutor) {
      callerRole = 'teacher';
    }
  }

  // 1. Caller is Student: Strict self-access only
  if (callerRole === 'student') {
    if (cleanReqUid && cleanReqUid !== caller.uid) {
      return {
        authorized: false,
        canonicalStudentUid: '',
        studentEmail: '',
        error: 'Cross-student access prohibited. Students may only access their own dictionary.',
        statusCode: 403,
      };
    }
    if (cleanReqEmail && callerEmail && cleanReqEmail !== callerEmail) {
      return {
        authorized: false,
        canonicalStudentUid: '',
        studentEmail: '',
        error: 'Cross-student access prohibited. Students may only access their own dictionary.',
        statusCode: 403,
      };
    }
    return {
      authorized: true,
      canonicalStudentUid: caller.uid,
      studentEmail: callerEmail || cleanReqEmail,
    };
  }

  const db = getFirestoreDb();
  let adminAuth: any = null;
  try {
    const { getFirebaseAdminAuth } = await import('./serverFirebaseAdmin');
    adminAuth = getFirebaseAdminAuth();
  } catch {}

  // 2. Caller is Teacher: Verify authorized pedagogical link
  if (callerRole === 'teacher' || (callerRole as string) === 'native_friend') {
    let hasAuthorizedLink = false;
    // CRITICAL: A teacher's own UID must NEVER be treated as a student's candidate UID!
    let candidateUid = (cleanReqUid && cleanReqUid !== caller.uid && !cleanReqUid.startsWith('tutor-')) ? cleanReqUid : '';
    let authorizedEmail = cleanReqEmail || (cleanReqUid.includes('@') ? cleanReqUid.toLowerCase() : '');

    // A. Check lesson authorization by lessonId
    if (lessonId) {
      try {
        if (db) {
          const lessonSnap = await db.collection('lessons').doc(lessonId).get();
          if (lessonSnap.exists) {
            const lData = lessonSnap.data();
            const lTeacherUid = lData?.teacherUid;
            const lTeacherEmail = (lData?.teacherEmail || '').toLowerCase().trim();
            const isLessonTeacher =
              (lTeacherUid && (lTeacherUid === caller.uid || lTeacherUid === `tutor-${caller.uid}`)) ||
              (lTeacherEmail && lTeacherEmail === callerEmail);

            if (isLessonTeacher) {
              const lStudentEmail = (lData?.studentEmail || '').toLowerCase().trim();
              const lStudentUid = (lData?.studentUid || '').trim();
              if (
                (!authorizedEmail || authorizedEmail === lStudentEmail) &&
                (!candidateUid || candidateUid.includes('@') || !isValidCanonicalUid(candidateUid) || candidateUid === lStudentUid || candidateUid.startsWith('usr-'))
              ) {
                hasAuthorizedLink = true;
                if (!authorizedEmail) authorizedEmail = lStudentEmail;
                if ((!candidateUid || candidateUid.includes('@') || !isValidCanonicalUid(candidateUid) || candidateUid.startsWith('usr-')) && lStudentUid && isValidCanonicalUid(lStudentUid) && lStudentUid !== caller.uid) {
                  candidateUid = lStudentUid;
                }
              }
            } else {
              return {
                authorized: false,
                canonicalStudentUid: '',
                studentEmail: '',
                error: 'Teacher is not authorized for this lesson.',
                statusCode: 403,
              };
            }
          }
        }
      } catch (err) {
        console.warn('Notice checking lesson authorization in Firestore:', err);
      }
    }

    // B. Check authorized relationship via lessons collection or student profile
    if (!hasAuthorizedLink && db && (authorizedEmail || candidateUid)) {
      try {
        // Query lessons for authorized link between teacher and student
        const lessonQuery = authorizedEmail
          ? db.collection('lessons').where('studentEmail', '==', authorizedEmail)
          : db.collection('lessons').where('studentUid', '==', candidateUid);
        const lSnap = await lessonQuery.get();
        if (!lSnap.empty) {
          for (const lDoc of lSnap.docs) {
            const data = lDoc.data();
            const tUid = data.teacherUid;
            const tEmail = (data.teacherEmail || '').toLowerCase().trim();
            if ((tUid && (tUid === caller.uid || tUid === `tutor-${caller.uid}`)) || (tEmail && tEmail === callerEmail)) {
              hasAuthorizedLink = true;
              if (!authorizedEmail && data.studentEmail) authorizedEmail = data.studentEmail.toLowerCase().trim();
              if ((!candidateUid || candidateUid.includes('@') || !isValidCanonicalUid(candidateUid) || candidateUid.startsWith('usr-')) && data.studentUid && isValidCanonicalUid(data.studentUid) && data.studentUid !== caller.uid) {
                candidateUid = data.studentUid;
              }
              break;
            }
          }
        }
      } catch {}

      // Query user profile for assigned native friend relationship
      if (!hasAuthorizedLink) {
        try {
          const profileQuery = authorizedEmail
            ? db.collection('users').where('email', '==', authorizedEmail)
            : db.collection('users').where('uid', '==', candidateUid);
          const pSnap = await profileQuery.get();
          if (!pSnap.empty) {
            for (const pDoc of pSnap.docs) {
              const pData = pDoc.data();
              const assignedUid = pData.assignedNativeFriendUID || pData.teacherUid;
              const assignedEmail = (pData.teacherEmail || '').toLowerCase().trim();
              if ((assignedUid && (assignedUid === caller.uid || assignedUid === `tutor-${caller.uid}`)) || (assignedEmail && assignedEmail === callerEmail)) {
                hasAuthorizedLink = true;
                if (!authorizedEmail && pData.email) authorizedEmail = pData.email.toLowerCase().trim();
                const resolvedDocUid = (pData.uid && isValidCanonicalUid(pData.uid) ? pData.uid : (isValidCanonicalUid(pDoc.id) ? pDoc.id : ''));
                if ((!candidateUid || candidateUid.includes('@') || !isValidCanonicalUid(candidateUid) || candidateUid.startsWith('usr-')) && resolvedDocUid && resolvedDocUid !== caller.uid) {
                  candidateUid = resolvedDocUid;
                }
                break;
              }
            }
          }
        } catch {}
      }
    }

    // B2. Check server authoritative store (getAuthoritativeDb) for authorized link
    if (!hasAuthorizedLink && dbLocal && (authorizedEmail || candidateUid)) {
      try {
        const matchingLesson = (dbLocal.liveLessons || []).find((l: any) => {
          if (!l || l.status === 'cancelled') return false;
          const lStudentEmail = (l.studentEmail || '').toLowerCase().trim();
          const lStudentUid = (l.studentUid || '').trim();
          const lTeacherUid = (l.teacherUid || (l as any).tutorUid || '').trim();
          const lTeacherEmail = (l.teacherEmail || (l as any).tutorEmail || '').toLowerCase().trim();
          const teacherMatches = (lTeacherUid && (lTeacherUid === caller.uid || lTeacherUid === `tutor-${caller.uid}`)) || (lTeacherEmail && lTeacherEmail === callerEmail);
          const studentMatches = (authorizedEmail && lStudentEmail === authorizedEmail) || (candidateUid && lStudentUid === candidateUid);
          return teacherMatches && studentMatches;
        });
        if (matchingLesson) {
          hasAuthorizedLink = true;
          if (!authorizedEmail && matchingLesson.studentEmail) authorizedEmail = matchingLesson.studentEmail.toLowerCase().trim();
          if ((!candidateUid || candidateUid.includes('@') || !isValidCanonicalUid(candidateUid)) && matchingLesson.studentUid && isValidCanonicalUid(matchingLesson.studentUid) && matchingLesson.studentUid !== caller.uid) {
            candidateUid = matchingLesson.studentUid;
          }
        }

        if (!hasAuthorizedLink && authorizedEmail) {
          const p = dbLocal.userProfiles?.[authorizedEmail];
          const s = (dbLocal.students || []).find((st: any) => (st.email || st.studentEmail || '').toLowerCase().trim() === authorizedEmail);
          const pTeacherUid = (p?.teacherUid || p?.assignedNativeFriendUID || s?.teacherUid || s?.assignedTeacherId || '').trim();
          const pTeacherEmail = (p?.teacherEmail || s?.teacherEmail || '').toLowerCase().trim();
          const isDirectMatch = (pTeacherUid && (pTeacherUid === caller.uid || pTeacherUid === `tutor-${caller.uid}`)) || (pTeacherEmail && pTeacherEmail === callerEmail);

          const isApprovedTutor = (dbLocal.teachers || []).some((t: any) =>
            (t.uid && (t.uid === caller.uid || t.id === caller.uid)) ||
            (t.id && (t.id === caller.uid || t.id === `tutor-${caller.uid}`)) ||
            (t.authUid && t.authUid === caller.uid) ||
            (callerEmail && t.email && t.email.toLowerCase().trim() === callerEmail)
          ) || (dbLocal.tutorsList || []).some((t: any) =>
            (t.uid && (t.uid === caller.uid || t.id === caller.uid)) ||
            (t.id && (t.id === caller.uid || t.id === `tutor-${caller.uid}`)) ||
            (t.authUid && t.authUid === caller.uid) ||
            (callerEmail && t.email && t.email.toLowerCase().trim() === callerEmail)
          );
          const isConflict = Boolean(
            pTeacherEmail && callerEmail && pTeacherEmail !== callerEmail &&
            pTeacherUid && pTeacherUid !== caller.uid && pTeacherUid !== `tutor-${caller.uid}`
          );

          if (isDirectMatch || (isApprovedTutor && !isConflict)) {
            hasAuthorizedLink = true;
            const foundUid = p?.uid || s?.uid || s?.studentUid;
            if ((!candidateUid || candidateUid.includes('@') || !isValidCanonicalUid(candidateUid)) && foundUid && isValidCanonicalUid(foundUid) && foundUid !== caller.uid) {
              candidateUid = foundUid;
            }
          }
        }
      } catch {}
    }

    if (!hasAuthorizedLink) {
      return {
        authorized: false,
        canonicalStudentUid: '',
        studentEmail: '',
        error: 'Teacher has no authorized pedagogical link with this student.',
        statusCode: 403,
      };
    }

    // Resolve CANONICAL student UID via Firebase Admin Auth & authoritative sources
    // Candidate 1: candidateUid if valid canonical UID (and strictly not teacher's own UID)
    if (candidateUid && isValidCanonicalUid(candidateUid) && candidateUid !== caller.uid) {
      if (adminAuth) {
        try {
          const userRec = await adminAuth.getUser(candidateUid);
          if (userRec && userRec.uid && userRec.uid !== caller.uid) {
            const recEmail = (userRec.email || '').toLowerCase().trim();
            if (!authorizedEmail || !recEmail || recEmail === authorizedEmail) {
              return {
                authorized: true,
                canonicalStudentUid: userRec.uid,
                studentEmail: recEmail || authorizedEmail,
              };
            }
          }
        } catch {}
      }
      // If candidateUid is already a proven valid canonical UID, return directly
      return {
        authorized: true,
        canonicalStudentUid: candidateUid,
        studentEmail: authorizedEmail,
      };
    }

    // Candidate 2: resolve by authorized student email from Firebase Admin Auth
    if (authorizedEmail) {
      if (adminAuth) {
        try {
          const userRec = await adminAuth.getUserByEmail(authorizedEmail);
          if (userRec && userRec.uid && isValidCanonicalUid(userRec.uid) && userRec.uid !== caller.uid) {
            return {
              authorized: true,
              canonicalStudentUid: userRec.uid,
              studentEmail: userRec.email || authorizedEmail,
            };
          }
        } catch {}
      }

      // Candidate 3: Search Firestore /users for student document with canonical UID
      if (db) {
        try {
          const uSnap = await db.collection('users').where('email', '==', authorizedEmail).get();
          for (const uDoc of uSnap.docs) {
            const uData = uDoc.data();
            const resolvedUid = (isValidCanonicalUid(uDoc.id) ? uDoc.id : (uData?.uid && isValidCanonicalUid(uData.uid) ? uData.uid : ''));
            if (resolvedUid && resolvedUid !== caller.uid) {
              return {
                authorized: true,
                canonicalStudentUid: resolvedUid,
                studentEmail: authorizedEmail,
              };
            }
          }
        } catch {}
      }

      // Candidate 4: Search lessons collection for canonical studentUid
      if (db) {
        try {
          const lSnap = await db.collection('lessons').where('studentEmail', '==', authorizedEmail).get();
          for (const lDoc of lSnap.docs) {
            const lData = lDoc.data();
            if (lData?.studentUid && isValidCanonicalUid(lData.studentUid) && lData.studentUid !== caller.uid) {
              return {
                authorized: true,
                canonicalStudentUid: lData.studentUid,
                studentEmail: authorizedEmail,
              };
            }
          }
        } catch {}
      }

      // Candidate 5: Search server authoritative store (getAuthoritativeDb)
      if (dbLocal) {
        try {
          const profile = dbLocal.userProfiles?.[authorizedEmail];
          const student = (dbLocal.students || []).find((s: any) => (s.email || s.studentEmail || '').toLowerCase().trim() === authorizedEmail);
          const lesson = (dbLocal.liveLessons || []).find((l: any) => (l.studentEmail || '').toLowerCase().trim() === authorizedEmail && l.studentUid && isValidCanonicalUid(l.studentUid));
          const lUid = (profile?.uid && isValidCanonicalUid(profile.uid) ? profile.uid : '') ||
            (student?.uid && isValidCanonicalUid(student.uid) ? student.uid : '') ||
            (student?.studentUid && isValidCanonicalUid(student.studentUid) ? student.studentUid : '') ||
            (lesson?.studentUid && isValidCanonicalUid(lesson.studentUid) ? lesson.studentUid : '');
          if (lUid && lUid !== caller.uid) {
            return {
              authorized: true,
              canonicalStudentUid: lUid,
              studentEmail: authorizedEmail,
            };
          }
        } catch {}
      }
    }

    return {
      authorized: false,
      canonicalStudentUid: '',
      studentEmail: '',
      error: 'Cannot unequivocally resolve canonical student UID from Firebase Auth. Recording aborted.',
      statusCode: 422,
    };
  }

  // 3. Caller is Admin
  if (caller.role === 'admin') {
    let candidateUid = cleanReqUid;
    let targetEmail = cleanReqEmail;

    if (candidateUid && isValidCanonicalUid(candidateUid)) {
      if (adminAuth) {
        try {
          const userRec = await adminAuth.getUser(candidateUid);
          if (userRec && userRec.uid) {
            return {
              authorized: true,
              canonicalStudentUid: userRec.uid,
              studentEmail: (userRec.email || targetEmail).toLowerCase().trim(),
            };
          }
        } catch {}
      } else {
        return {
          authorized: true,
          canonicalStudentUid: candidateUid,
          studentEmail: targetEmail,
        };
      }
    }

    if (targetEmail && adminAuth) {
      try {
        const userRec = await adminAuth.getUserByEmail(targetEmail);
        if (userRec && userRec.uid && isValidCanonicalUid(userRec.uid)) {
          return {
            authorized: true,
            canonicalStudentUid: userRec.uid,
            studentEmail: userRec.email || targetEmail,
          };
        }
      } catch {}
    }

    if (targetEmail && db) {
      try {
        const uSnap = await db.collection('users').where('email', '==', targetEmail).get();
        for (const uDoc of uSnap.docs) {
          if (isValidCanonicalUid(uDoc.id)) {
            return {
              authorized: true,
              canonicalStudentUid: uDoc.id,
              studentEmail: targetEmail,
            };
          }
        }
      } catch {}
    }

    return {
      authorized: false,
      canonicalStudentUid: '',
      studentEmail: '',
      error: 'Cannot unequivocally resolve canonical student UID from Firebase Auth. Recording aborted.',
      statusCode: 422,
    };
  }

  return {
    authorized: false,
    canonicalStudentUid: '',
    studentEmail: '',
    error: 'Unauthorized identity role.',
    statusCode: 403,
  };
}

/**
 * Recursively strips all keys with `undefined` values from an object, nested objects, and arrays.
 * Guarantees that Firestore Admin SDK never throws:
 * "Cannot use "undefined" as a Firestore value".
 * Preserves all valid types: strings, numbers, booleans, dates, nulls, arrays, and Firestore FieldValues.
 * Does NOT invent definitions or replace undefined with placeholder strings.
 */
export function removeUndefinedFields<T = any>(val: T): T {
  if (val === undefined) {
    return undefined as any;
  }
  if (val === null || typeof val !== 'object') {
    return val;
  }
  if (val instanceof Date) {
    return val;
  }
  if (typeof (val as any).isEqual === 'function') {
    return val;
  }
  if (Array.isArray(val)) {
    return (val as any[])
      .filter((item) => item !== undefined)
      .map((item) => removeUndefinedFields(item)) as any;
  }
  const result: Record<string, any> = {};
  for (const [key, v] of Object.entries(val as Record<string, any>)) {
    if (v !== undefined) {
      const sanitized = removeUndefinedFields(v);
      if (sanitized !== undefined) {
        result[key] = sanitized;
      }
    }
  }
  return result as T;
}

/**
 * Server-side consolidation of student dictionary entries.
 * Guarantees:
 * - Richer definitions and authentic examples are preserved.
 * - Multi-origin history is accumulated.
 * - practiceCount is never decreased or reset.
 * - lastPracticedAt is strictly preserved (most recent timestamp kept).
 * - Deduplicated deterministically by normalized word.
 * - Strips any undefined fields so Firestore Admin SDK never encounters undefined.
 */
function consolidateServerEntries(existingEntries: any[], newEntries: any[]): any[] {
  const masterMap = new Map<string, any>();

  (existingEntries || []).forEach((e) => {
    if (!e || !e.word) return;
    const rawWord = (e.word || '').trim();
    const key = (e.normalizedWord || rawWord).toLowerCase().trim();
    if (!key) return;
    masterMap.set(key, removeUndefinedFields({ ...e, word: rawWord, normalizedWord: key }));
  });

  (newEntries || []).forEach((item) => {
    if (!item || !item.word) return;
    const rawWord = (item.word || '').trim();
    const key = (item.normalizedWord || rawWord).toLowerCase().trim();
    if (!key) return;

    const existing = masterMap.get(key);

    if (!existing) {
      const isItemProvisional = Boolean(item.isProvisional || item.isFallback || item.enrichmentStatus === 'pending');
      const singleOrigins = Array.isArray(item.origins)
        ? item.origins
        : (item.source
          ? [
              removeUndefinedFields({
                source: item.source,
                activityName: item.sourceActivityName,
                dayOfWeek: item.sourceDay,
                date: item.learnedAt ? item.learnedAt.split('T')[0] : new Date().toISOString().split('T')[0],
                lessonId: item.lessonRefId,
                videoId: item.routineRef?.videoId,
                videoTitle: item.routineRef?.videoTitle,
              }),
            ]
          : []);

      const newEntry: Record<string, any> = {
        ...item,
        id: item.id || `dict_${key.replace(/[^a-zA-Z0-9_-]/g, '_')}_${Date.now()}`,
        word: rawWord,
        originalWord: item.originalWord || rawWord,
        normalizedWord: key,
        practiceCount: typeof item.practiceCount === 'number' ? item.practiceCount : 0,
        origins: singleOrigins.map(removeUndefinedFields),
        enrichmentStatus: item.enrichmentStatus === 'enriched' && !isItemProvisional ? 'enriched' : 'pending',
        isProvisional: isItemProvisional,
      };
      if (item.simpleDefinition && typeof item.simpleDefinition === 'string' && item.simpleDefinition.trim()) {
        newEntry.simpleDefinition = item.simpleDefinition.trim();
      }
      if (item.lastPracticedAt) {
        newEntry.lastPracticedAt = item.lastPracticedAt;
      }

      masterMap.set(key, removeUndefinedFields(newEntry));
      return;
    }

    // Richer definition & Provisional protection (HOTFIX 4B.8.1)
    const existingDef = (existing.definitionEn || '').trim();
    const newDef = (item.definitionEn || item.meaningOrTip || '').trim();
    const isItemProvisional = Boolean(item.isProvisional || item.isFallback || item.enrichmentStatus === 'pending');
    const isExistingEnriched = Boolean(existing.enrichmentStatus === 'enriched' || (existingDef && !existing.isProvisional));

    const isNewGeneric = !newDef || isGenericPedagogicalDefinition(newDef);
    const isExistingGeneric = !existingDef || isGenericPedagogicalDefinition(existingDef);

    // Rule: Legitimate definitions always replace generic placeholders; generic definitions never overwrite legitimate ones
    let resolvedDef = '';
    if (!isExistingGeneric && isNewGeneric) {
      resolvedDef = existingDef;
    } else if (!isNewGeneric) {
      resolvedDef = newDef;
    } else {
      resolvedDef = ''; // both are generic, do not persist generic text
    }

    const resolvedEnrichmentStatus = Boolean(resolvedDef) && !isGenericPedagogicalDefinition(resolvedDef)
      ? 'enriched'
      : 'pending';
    const resolvedExample = existing.exampleSentenceEn && (!item.exampleSentenceEn || item.exampleSentenceEn.length < existing.exampleSentenceEn.length)
      ? existing.exampleSentenceEn
      : (item.exampleSentenceEn || item.exampleSentence || existing.exampleSentenceEn || '');

    // Accumulate origins without duplication
    const mergedOrigins = [...(existing.origins || [])];
    if (Array.isArray(item.origins)) {
      item.origins.forEach((orig: any) => {
        const isDup = mergedOrigins.some(
          (m: any) => m.source === orig.source && m.activityName === orig.activityName && m.date === orig.date
        );
        if (!isDup) mergedOrigins.push(orig);
      });
    } else if (item.source) {
      const isDup = mergedOrigins.some((m: any) => m.source === item.source && m.activityName === item.sourceActivityName);
      if (!isDup) {
        mergedOrigins.push(
          removeUndefinedFields({
            source: item.source,
            activityName: item.sourceActivityName,
            dayOfWeek: item.sourceDay,
            date: item.learnedAt ? item.learnedAt.split('T')[0] : new Date().toISOString().split('T')[0],
            lessonId: item.lessonRefId,
            videoId: item.routineRef?.videoId,
            videoTitle: item.routineRef?.videoTitle,
          })
        );
      }
    }

    // Practice count: NEVER decrease or reset
    const exCount = typeof existing.practiceCount === 'number' ? existing.practiceCount : 0;
    const inCount = typeof item.practiceCount === 'number' ? item.practiceCount : 0;
    const mergedPracticeCount = Math.max(exCount, inCount);

    let mergedLastPracticedAt = existing.lastPracticedAt;
    if (item.lastPracticedAt) {
      if (!existing.lastPracticedAt || new Date(item.lastPracticedAt) > new Date(existing.lastPracticedAt)) {
        mergedLastPracticedAt = item.lastPracticedAt;
      }
    }

    // Practice history: NEVER drop or overwrite existing history
    const mergedPracticeHistory = [...(existing.practiceHistory || [])];
    if (Array.isArray(item.practiceHistory)) {
      item.practiceHistory.forEach((h: any) => {
        const isDup = mergedPracticeHistory.some(
          (m: any) => m.date === h.date && m.activityType === h.activityType
        );
        if (!isDup) mergedPracticeHistory.push(h);
      });
    }

    const resolvedSimpleDef = (item.simpleDefinition || existing.simpleDefinition || '').trim();
    const mergedEntry: Record<string, any> = {
      ...existing,
      ...item,
      id: existing.id || item.id,
      word: rawWord,
      originalWord: item.originalWord || existing.originalWord || rawWord,
      normalizedWord: key,
      definitionEn: resolvedDef,
      exampleSentenceEn: resolvedExample,
      origins: mergedOrigins.map(removeUndefinedFields),
      practiceCount: mergedPracticeCount,
      practiceHistory: mergedPracticeHistory,
      enrichmentStatus: resolvedEnrichmentStatus,
      isProvisional: isItemProvisional && !isExistingEnriched,
    };
    if (resolvedSimpleDef) {
      mergedEntry.simpleDefinition = resolvedSimpleDef;
    }
    if (mergedLastPracticedAt) {
      mergedEntry.lastPracticedAt = mergedLastPracticedAt;
    }

    masterMap.set(key, removeUndefinedFields(mergedEntry));
  });

  return Array.from(masterMap.values())
    .map(removeUndefinedFields)
    .sort((a, b) => (a.word || '').localeCompare(b.word || ''));
}

/**
 * Server-side persistent storage of student vocabulary in Cloud Firestore.
 * Strictly requires a canonical student Firebase Auth UID (rejects synthetic usr-* / st-* or teacher UID).
 * Persists to canonical document users/{canonicalStudentUid} and subcollection users/{canonicalStudentUid}/vocabulary/{wordDocId}.
 */
export async function saveStudentVocabularyToFirestoreServer(
  studentUid: string,
  entries: any[],
  studentEmail?: string
): Promise<boolean> {
  if (isCloudWriteDisabled) return false;
  const db = getFirestoreDb();
  if (!db || !studentUid) return false;

  const cleanUid = studentUid.trim();
  if (!isValidCanonicalUid(cleanUid)) {
    throw new Error(
      `[saveStudentVocabularyToFirestoreServer] Rejected non-canonical student UID: "${cleanUid}". Persistence strictly requires a canonical Firebase Auth UID.`
    );
  }
  if (!entries || entries.length === 0) return true;

  try {
    const cleanEmail = (studentEmail || '').toLowerCase().trim();
    const sanitizedEntries = removeUndefinedFields(JSON.parse(JSON.stringify(entries || [])));

    // 1. Fetch existing entries from canonical user document
    let existingList: any[] = [];
    try {
      const userSnap = await db.collection('users').doc(cleanUid).get();
      if (userSnap.exists && Array.isArray(userSnap.data()?.vocabulary)) {
        existingList = userSnap.data()?.vocabulary;
      }
    } catch {}

    // 2. Fetch existing entries from canonical subcollection
    try {
      const subSnap = await db.collection('users').doc(cleanUid).collection('vocabulary').get();
      if (!subSnap.empty) {
        subSnap.forEach((docItem) => {
          const item = docItem.data();
          if (item && item.word) {
            existingList.push(item);
          }
        });
      }
    } catch {}

    // 3. Consolidate entries cumulatively and recursively eliminate all undefined fields
    const consolidated = removeUndefinedFields(consolidateServerEntries(existingList, sanitizedEntries));

    // 4. Save to canonical root document users/{cleanUid} with guaranteed zero undefined values
    const rootPayload = removeUndefinedFields({
      vocabulary: consolidated,
      updatedAt: new Date().toISOString(),
    });
    await db.collection('users').doc(cleanUid).set(rootPayload, { merge: true });

    // 5. Save individual entries to subcollection users/{cleanUid}/vocabulary/{wordDocId}
    for (const item of consolidated) {
      if (item && item.word) {
        const rawWord = (item.normalizedWord || item.word).toLowerCase().trim();
        const wordDocId = rawWord.replace(/[^a-zA-Z0-9_-]/g, '_');
        const docPayload = removeUndefinedFields({
          ...item,
          studentUid: cleanUid,
          ...(cleanEmail || item.studentEmail ? { studentEmail: cleanEmail || item.studentEmail } : {}),
          updatedAt: new Date().toISOString(),
        });
        await db.collection('users').doc(cleanUid).collection('vocabulary').doc(wordDocId).set(
          docPayload,
          { merge: true }
        );
      }
    }

    return true;
  } catch (err: any) {
    if (isPermissionError(err)) {
      isCloudWriteDisabled = true;
      console.info('[serverFirestore] Remote vocabulary save restricted by IAM, continuing with local state.');
      return false;
    } else {
      console.warn('Firestore server vocabulary save notice:', err);
      throw err;
    }
  }
}

/**
 * Server-side read of student personal dictionary directly from canonical Firestore path.
 * Implements Etapa 4: Safe, read-only recovery of legacy records when unequivocal identity link is proven.
 * CRITICAL: Strictly read-only! Never performs automatic migration writes (no setDoc).
 * CRITICAL: Canonical records are never overwritten by legacy records.
 */
export async function fetchStudentVocabularyFromFirestoreServer(
  canonicalStudentUid: string,
  studentEmail?: string
): Promise<any[]> {
  const db = getFirestoreDb();
  if (!db || !canonicalStudentUid) return [];

  const entryMap = new Map<string, any>();

  try {
    // 1. Fetch from canonical document users/{canonicalStudentUid}
    const userDocRef = db.collection('users').doc(canonicalStudentUid);
    const userSnap = await userDocRef.get();
    let excludedWords: string[] = [];
    if (userSnap.exists) {
      const data = userSnap.data();
      if (Array.isArray(data?.excludedDictionaryWords)) {
        excludedWords = data.excludedDictionaryWords;
      }
      if (Array.isArray(data?.vocabulary)) {
        data.vocabulary.forEach((item: any) => {
          if (item && item.word) {
            const key = (item.normalizedWord || item.word).toLowerCase().trim();
            entryMap.set(key, item);
          }
        });
      }
    }

    // 2. Fetch from canonical subcollection users/{canonicalStudentUid}/vocabulary
    const subColRef = db.collection('users').doc(canonicalStudentUid).collection('vocabulary');
    const subSnap = await subColRef.get();
    if (!subSnap.empty) {
      subSnap.forEach((docItem) => {
        const item = docItem.data();
        if (item && item.word) {
          const key = (item.normalizedWord || item.word).toLowerCase().trim();
          entryMap.set(key, { ...(entryMap.get(key) || {}), ...item });
        }
      });
    }

    // 3. Etapa 4: Read-only check of legacy doc IDs if canonical doc has no vocabulary
    if (studentEmail && entryMap.size === 0) {
      const cleanEmail = studentEmail.toLowerCase().trim();
      const legacyDocIds = [
        `usr-${cleanEmail.replace(/[^a-zA-Z0-9]/g, '-')}`,
        cleanEmail.replace(/[^a-zA-Z0-9_-]/g, '_'),
        cleanEmail,
      ].filter((id) => id !== canonicalStudentUid);

      for (const legId of legacyDocIds) {
        try {
          const legSnap = await db.collection('users').doc(legId).get();
          if (legSnap.exists) {
            const legData = legSnap.data();
            const emailMatches = (legData?.email || '').toLowerCase().trim() === cleanEmail;
            const uidMatches = !legData?.uid || legData?.uid === canonicalStudentUid || legData?.uid === legId;
            if (emailMatches && uidMatches && Array.isArray(legData?.vocabulary)) {
              legData.vocabulary.forEach((item: any) => {
                if (item && item.word) {
                  const key = (item.normalizedWord || item.word).toLowerCase().trim();
                  if (!entryMap.has(key)) {
                    entryMap.set(key, item);
                  }
                }
              });
              break; // Only read the first matching legacy document
            }
          }
        } catch {}
      }
    }

    // Filter out all logically excluded words (tombstones)
    const excludedSet = new Set(
      excludedWords.map((w: string) => normalizeDictionaryWord(w)).filter(Boolean)
    );

    return Array.from(entryMap.values())
      .filter((item) => {
        const norm = normalizeDictionaryWord(item.normalizedWord || item.word);
        return Boolean(norm && !excludedSet.has(norm));
      })
      .sort((a, b) => (a.word || '').localeCompare(b.word || ''));
  } catch (err) {
    console.warn('fetchStudentVocabularyFromFirestoreServer error:', err);
    return [];
  }
}

/**
 * Fetches canonical list of excluded dictionary words from Firestore users/{canonicalStudentUid}.
 */
export async function fetchExcludedDictionaryWordsServer(
  canonicalStudentUid: string
): Promise<string[]> {
  const db = getFirestoreDb();
  if (!db || !canonicalStudentUid || !isValidCanonicalUid(canonicalStudentUid)) return [];

  try {
    const userDocRef = db.collection('users').doc(canonicalStudentUid);
    const userSnap = await userDocRef.get();
    if (userSnap.exists) {
      const data = userSnap.data();
      if (Array.isArray(data?.excludedDictionaryWords)) {
        return Array.from(
          new Set(
            data.excludedDictionaryWords
              .map((w: string) => normalizeDictionaryWord(w))
              .filter(Boolean)
          )
        );
      }
    }
    return [];
  } catch (err) {
    console.warn('fetchExcludedDictionaryWordsServer error:', err);
    return [];
  }
}

/**
 * Persists normalized dictionary exclusions logically in users/{canonicalStudentUid}.excludedDictionaryWords.
 * Uses atomic arrayUnion (or transaction) to preserve concurrent exclusions and prevent race conditions.
 * Idempotent: adding already-excluded words produces no duplicates.
 * Preserves all pedagogical history, definitions, examples, and practice metrics without physical deletion.
 * Never modifies legacy documents.
 */
export async function addExcludedDictionaryWordsServer(
  canonicalStudentUid: string,
  words: string[]
): Promise<string[]> {
  if (!isValidCanonicalUid(canonicalStudentUid)) {
    throw new Error(
      `[addExcludedDictionaryWordsServer] Rejected non-canonical student UID: "${canonicalStudentUid}". Exclusions strictly require a canonical Firebase Auth UID.`
    );
  }
  const normalizedWords = Array.from(
    new Set(words.map((w) => normalizeDictionaryWord(w)).filter(Boolean))
  );
  if (normalizedWords.length === 0) {
    return fetchExcludedDictionaryWordsServer(canonicalStudentUid);
  }

  const db = getFirestoreDb();
  if (!db) {
    return normalizedWords;
  }

  try {
    const userDocRef = db.collection('users').doc(canonicalStudentUid);

    if (typeof FieldValue !== 'undefined' && FieldValue.arrayUnion) {
      try {
        await userDocRef.set(
          {
            excludedDictionaryWords: FieldValue.arrayUnion(...normalizedWords),
            updatedAt: new Date().toISOString(),
          },
          { merge: true }
        );
      } catch {
        const snap = await userDocRef.get();
        const existing: string[] = snap.exists && Array.isArray(snap.data()?.excludedDictionaryWords)
          ? snap.data()?.excludedDictionaryWords
          : [];
        const merged = Array.from(new Set([...existing.map(normalizeDictionaryWord), ...normalizedWords]));
        await userDocRef.set(
          {
            excludedDictionaryWords: merged,
            updatedAt: new Date().toISOString(),
          },
          { merge: true }
        );
      }
    } else {
      const snap = await userDocRef.get();
      const existing: string[] = snap.exists && Array.isArray(snap.data()?.excludedDictionaryWords)
        ? snap.data()?.excludedDictionaryWords
        : [];
      const merged = Array.from(new Set([...existing.map(normalizeDictionaryWord), ...normalizedWords]));
      await userDocRef.set(
        {
          excludedDictionaryWords: merged,
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );
    }

    return fetchExcludedDictionaryWordsServer(canonicalStudentUid);
  } catch (err: any) {
    if (isPermissionError(err)) {
      isCloudWriteDisabled = true;
      console.info('[serverFirestore] Remote exclusion save restricted by IAM, continuing with local state.');
      return normalizedWords;
    }
    console.warn('Firestore server addExcludedDictionaryWordsServer error:', err);
    throw err;
  }
}

/**
 * Removes words from users/{canonicalStudentUid}.excludedDictionaryWords upon explicit intentional re-addition.
 * Uses atomic arrayRemove (or transaction) to preserve concurrent exclusions and prevent race conditions.
 * Idempotent: removing non-excluded words produces no inconsistencies.
 */
export async function removeExcludedDictionaryWordsServer(
  canonicalStudentUid: string,
  words: string[]
): Promise<string[]> {
  if (!isValidCanonicalUid(canonicalStudentUid)) {
    throw new Error(
      `[removeExcludedDictionaryWordsServer] Rejected non-canonical student UID: "${canonicalStudentUid}". Exclusions strictly require a canonical Firebase Auth UID.`
    );
  }
  const normalizedWords = Array.from(
    new Set(words.map((w) => normalizeDictionaryWord(w)).filter(Boolean))
  );
  if (normalizedWords.length === 0) {
    return fetchExcludedDictionaryWordsServer(canonicalStudentUid);
  }

  const db = getFirestoreDb();
  if (!db) return [];

  try {
    const userDocRef = db.collection('users').doc(canonicalStudentUid);

    if (typeof FieldValue !== 'undefined' && FieldValue.arrayRemove) {
      try {
        await userDocRef.set(
          {
            excludedDictionaryWords: FieldValue.arrayRemove(...normalizedWords),
            updatedAt: new Date().toISOString(),
          },
          { merge: true }
        );
      } catch {
        const snap = await userDocRef.get();
        const existing: string[] = snap.exists && Array.isArray(snap.data()?.excludedDictionaryWords)
          ? snap.data()?.excludedDictionaryWords
          : [];
        const normToRemove = new Set(normalizedWords);
        const filtered = existing.map(normalizeDictionaryWord).filter((w) => w && !normToRemove.has(w));
        await userDocRef.set(
          {
            excludedDictionaryWords: filtered,
            updatedAt: new Date().toISOString(),
          },
          { merge: true }
        );
      }
    } else {
      const snap = await userDocRef.get();
      const existing: string[] = snap.exists && Array.isArray(snap.data()?.excludedDictionaryWords)
        ? snap.data()?.excludedDictionaryWords
        : [];
      const normToRemove = new Set(normalizedWords);
      const filtered = existing.map(normalizeDictionaryWord).filter((w) => w && !normToRemove.has(w));
      await userDocRef.set(
        {
          excludedDictionaryWords: filtered,
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );
    }

    return fetchExcludedDictionaryWordsServer(canonicalStudentUid);
  } catch (err: any) {
    if (isPermissionError(err)) {
      isCloudWriteDisabled = true;
      console.info('[serverFirestore] Remote exclusion removal restricted by IAM, continuing with local state.');
      return [];
    }
    console.warn('Firestore server removeExcludedDictionaryWordsServer error:', err);
    throw err;
  }
}


/**
 * Server-side persistent storage of Native Friend In-Session Notes & Recommendations in Cloud Firestore.
 */
export async function saveSessionNotesToFirestoreServer(
  sessionKey: string,
  data: {
    id?: string;
    sessionDate: string;
    lessonId?: string;
    studentEmail: string;
    studentUid?: string;
    teacherEmail?: string;
    teacherName?: string;
    topic?: string;
    content: string;
    updatedAt?: string;
    driveFileId?: string;
    driveFileUrl?: string;
    driveFolderName?: string;
    driveLastSyncedAt?: string;
  }
): Promise<boolean> {
  if (isCloudWriteDisabled) return false;
  const db = getFirestoreDb();
  if (!db || !sessionKey || !data) return false;

  try {
    const cleanKey = sessionKey.replace(/[^a-zA-Z0-9_-]/g, '_');
    const sanitized = JSON.parse(JSON.stringify({
      ...data,
      id: cleanKey,
      updatedAt: data.updatedAt || new Date().toISOString(),
    }));

    const savePromises: Promise<any>[] = [
      db.collection('session_notes').doc(cleanKey).set(sanitized, { merge: true }),
    ];

    const studentId = (data.studentUid && isValidCanonicalUid(data.studentUid))
      ? data.studentUid
      : (data.studentEmail ? data.studentEmail.toLowerCase().trim().replace(/[^a-zA-Z0-9_-]/g, '_') : '');
    if (studentId) {
      savePromises.push(
        db.collection('users').doc(studentId).collection('session_notes').doc(cleanKey).set(sanitized, { merge: true })
      );
    }

    if (data.lessonId) {
      savePromises.push(
        db.collection('lessons').doc(data.lessonId).set(
          {
            sessionNotesDocument: data.content,
            liveNotes: data.content,
            recommendations: data.content,
            title: data.topic,
            notesLastSavedAt: sanitized.updatedAt,
            updatedAt: sanitized.updatedAt,
            ...(data.driveFileId ? { driveFileId: data.driveFileId } : {}),
            ...(data.driveFileUrl ? { driveFileUrl: data.driveFileUrl } : {}),
            ...(data.driveFolderName ? { driveFolderName: data.driveFolderName } : {}),
            ...(data.driveLastSyncedAt ? { driveLastSyncedAt: data.driveLastSyncedAt } : {}),
          },
          { merge: true }
        )
      );
    }

    await Promise.all(savePromises);
    return true;
  } catch (err: any) {
    if (isPermissionError(err)) {
      isCloudWriteDisabled = true;
      console.info('[serverFirestore] Remote session notes save restricted by IAM, continuing with local state.');
    } else {
      console.warn('Firestore server session notes save notice:', err);
    }
    return false;
  }
}

export async function fetchSessionNotesFromFirestoreServer(sessionKey: string): Promise<any | null> {
  const db = getFirestoreDb();
  if (!db || !sessionKey) return null;
  try {
    const cleanKey = sessionKey.replace(/[^a-zA-Z0-9_-]/g, '_');
    const snap = await db.collection('session_notes').doc(cleanKey).get();
    if (snap.exists) {
      return snap.data();
    }
    return null;
  } catch (err: any) {
    if (!isPermissionError(err)) {
      console.warn('Firestore fetch session notes notice:', err);
    }
    return null;
  }
}

/**
 * Direct persistence for Native Friend notes review progress
 */
export async function saveSessionNotesProgressToFirestore(key: string, cyclePayload: any): Promise<boolean> {
  if (isCloudWriteDisabled) return false;
  const db = getFirestoreDb();
  if (!db || !key) return false;
  try {
    const sanitized = JSON.parse(JSON.stringify(cyclePayload));
    const userRef = db.collection('users').doc(key);
    const subRef = userRef.collection('session_notes').doc('review_cycle');
    await Promise.all([
      subRef.set(sanitized, { merge: true }),
      userRef.set(
        {
          nativeNotesReview: sanitized,
          updatedAt: sanitized.updatedAt || new Date().toISOString(),
        },
        { merge: true }
      ),
    ]);
    return true;
  } catch (err: any) {
    if (isPermissionError(err)) {
      isCloudWriteDisabled = true;
      console.info('[serverFirestore] Remote session notes progress save restricted by IAM, continuing with local state.');
    } else {
      console.warn('Firestore saveSessionNotesProgress error:', err);
    }
    return false;
  }
}

/**
 * Atomic registration of daily reminder presentation.
 * Ensures the Native Friends Notes reminder is presented AT MOST ONCE per day per student UID,
 * immune to page reload, component remount, or switching devices.
 */
export async function recordDailyReminderShownServer(
  studentUid: string,
  todayInTz: string
): Promise<{ canShow: boolean; alreadyShown: boolean; lastReminderShownDate: string }> {
  if (!studentUid || !todayInTz) {
    return { canShow: false, alreadyShown: true, lastReminderShownDate: todayInTz };
  }

  const cleanUid = studentUid.trim();
  const db = getFirestoreDb();
  if (db && !isCloudWriteDisabled) {
    try {
      const userRef = db.collection('users').doc(cleanUid);
      const subRef = userRef.collection('session_notes').doc('review_cycle');

      if (typeof (db as any).runTransaction === 'function') {
        const result = await (db as any).runTransaction(async (tx: any) => {
          const snap = await tx.get(subRef);
          let lastDate = '';
          if (snap && snap.exists) {
            const data = snap.data() || {};
            lastDate = data.lastReminderShownDate || '';
          } else {
            const uSnap = await tx.get(userRef);
            if (uSnap && uSnap.exists) {
              const uData = uSnap.data() || {};
              lastDate = uData.nativeNotesReview?.lastReminderShownDate || uData.lastReminderShownDate || '';
            }
          }

          if (lastDate === todayInTz) {
            return { canShow: false, alreadyShown: true, lastReminderShownDate: lastDate };
          }

          tx.set(
            subRef,
            {
              lastReminderShownDate: todayInTz,
              reminderShownAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
            { merge: true }
          );

          tx.set(
            userRef,
            {
              lastReminderShownDate: todayInTz,
              'nativeNotesReview.lastReminderShownDate': todayInTz,
              updatedAt: new Date().toISOString(),
            },
            { merge: true }
          );

          return { canShow: true, alreadyShown: false, lastReminderShownDate: todayInTz };
        });
        return result;
      } else {
        // Mock / non-transactional fallback
        const snap = await subRef.get();
        const data = snap && snap.exists ? snap.data() : null;
        const lastDate = data?.lastReminderShownDate || '';
        if (lastDate === todayInTz) {
          return { canShow: false, alreadyShown: true, lastReminderShownDate: lastDate };
        }
        await subRef.set({ lastReminderShownDate: todayInTz, updatedAt: new Date().toISOString() }, { merge: true });
        await userRef.set({ lastReminderShownDate: todayInTz, 'nativeNotesReview.lastReminderShownDate': todayInTz }, { merge: true });
        return { canShow: true, alreadyShown: false, lastReminderShownDate: todayInTz };
      }
    } catch (err) {
      console.warn('Firestore recordDailyReminderShownServer notice:', err);
    }
  }

  return { canShow: true, alreadyShown: false, lastReminderShownDate: todayInTz };
}

/**
 * Retrieve session notes progress from Firestore
 */
export async function fetchSessionNotesProgressServer(key: string): Promise<any> {
  const cleanKey = (key || '').trim();
  if (!cleanKey) return null;
  const db = getFirestoreDb();
  if (!db) return null;
  try {
    const userRef = db.collection('users').doc(cleanKey);
    const subRef = userRef.collection('session_notes').doc('review_cycle');
    const snap = await subRef.get();
    if (snap && snap.exists) {
      return snap.data();
    }
    const uSnap = await userRef.get();
    if (uSnap && uSnap.exists) {
      const data = uSnap.data() || {};
      return data.nativeNotesReview || null;
    }
  } catch (err) {
    if (!isPermissionError(err)) {
      console.warn('fetchSessionNotesProgressServer notice:', err);
    }
  }
  return null;
}

/**
 * Persist pedagogical transformation in Cloud Firestore
 */
export async function savePedagogicalTransformationToFirestoreServer(
  compositeCacheKey: string,
  transformation: any
): Promise<boolean> {
  if (isCloudWriteDisabled) return false;
  const db = getFirestoreDb();
  if (!db || !compositeCacheKey || !transformation) return false;
  try {
    const sanitized = JSON.parse(JSON.stringify(transformation));
    const sessionKey = transformation.sessionKey || compositeCacheKey.split('__')[0];
    const sessionRef = db.collection('session_notes').doc(sessionKey);
    await sessionRef.collection('pedagogical_cache').doc(compositeCacheKey).set(
      {
        ...sanitized,
        cacheKey: compositeCacheKey,
        savedAt: new Date().toISOString(),
      },
      { merge: true }
    );
    return true;
  } catch (err) {
    console.warn('Firestore savePedagogicalTransformation error:', err);
    return false;
  }
}

/**
 * Retrieve pedagogical transformation from Cloud Firestore
 */
export async function fetchPedagogicalTransformationFromFirestoreServer(
  compositeCacheKeyOrSessionKey: string,
  options?: { language?: string; contentHash?: string }
): Promise<any | null> {
  const db = getFirestoreDb();
  if (!db || !compositeCacheKeyOrSessionKey) return null;
  try {
    const rawKey = compositeCacheKeyOrSessionKey.trim();
    const sessionKey = rawKey.split('__')[0];
    const sessionRef = db.collection('session_notes').doc(sessionKey);

    // 1. If exact compositeCacheKey doc exists, check it directly
    if (rawKey.includes('__')) {
      const snap = await sessionRef.collection('pedagogical_cache').doc(rawKey).get();
      if (snap && snap.exists) {
        const data = snap.data();
        if (data && data.isAiGenerated && !data.isProvisional) {
          return data;
        }
      }
    }

    // 2. Query pedagogical_cache subcollection for the session
    const cacheCol = sessionRef.collection('pedagogical_cache');
    const colSnap = await cacheCol.get();
    if (colSnap && !colSnap.empty) {
      let candidate: any = null;
      for (const d of colSnap.docs) {
        const data = d.data();
        if (data && data.isAiGenerated && !data.isProvisional) {
          const matchLang = !options?.language || data.language === options.language;
          const matchHash = !options?.contentHash || data.contentHash === options.contentHash;
          if (matchLang && matchHash) {
            return data;
          }
          if (matchLang && !candidate) {
            candidate = data;
          } else if (!candidate) {
            candidate = data;
          }
        }
      }
      if (candidate) return candidate;
    }
  } catch (err) {
    if (!isPermissionError(err)) {
      console.warn('Firestore fetchPedagogicalTransformation notice:', err);
    }
  }
  return null;
}

/**
 * FASE 4B.9 — Record an idempotent, validated Native Friends Notes lesson review in Student's My Journal.
 * 
 * Strict invariants:
 * 1. Saved only after validated definitive AI generation (zero provisional/fallback summaries).
 * 2. Exactly one entry per student and session (deterministic ID: idempotent, opening again never duplicates).
 * 3. Uses solely the already validated reviewSummary from transformation (zero additional Gemini calls).
 * 4. Stored in users/{studentUid}/journal/{entryId} and users/{studentUid}.dailyJournalEntries.
 */
export async function recordLessonReviewInStudentJournalServer(params: {
  studentUid: string;
  studentEmail?: string;
  transformation: any;
  compositeCacheKey: string;
}): Promise<{ success: boolean; entry?: any }> {
  const { studentUid, studentEmail, transformation, compositeCacheKey } = params;
  if (!studentUid || !transformation) {
    return { success: false };
  }

  // Reject provisional or fallback transformations from entering My Journal as definitive reviews
  if (!transformation.isAiGenerated || transformation.isProvisional || transformation.isFallback) {
    return { success: false };
  }

  const cleanUid = studentUid.trim();
  const cleanEmail = (studentEmail || transformation.studentEmail || '').toLowerCase().trim();
  const sessionKey = transformation.sessionKey || compositeCacheKey.split('__')[0] || 'session';
  const cleanSessionId = sessionKey.replace(/[^a-zA-Z0-9_-]/g, '_');

  // Deterministic entry ID guaranteeing strict idempotency
  const entryId = `journal_lesson_${cleanSessionId}_${cleanUid.replace(/[^a-zA-Z0-9_-]/g, '_')}`;

  const review = transformation.reviewSummary || {};
  const essentialCorrections = Array.isArray(review.essentialCorrections) ? review.essentialCorrections : [];
  const keyRules = Array.isArray(review.keyRules) ? review.keyRules : [];
  const mustKnowVocabulary = Array.isArray(review.mustKnowVocabulary) ? review.mustKnowVocabulary : [];

  // Filter pronunciation points specifically when present
  const pronunciationPoints: string[] = [];
  (transformation.vocabularyAndExpressions || []).forEach((v: any) => {
    if (v.isPronunciationFocus || v.partOfSpeech === 'Pronunciation Focus') {
      pronunciationPoints.push(v.term);
    }
  });

  const wordsUsed: string[] = Array.from(
    new Set([
      ...(transformation.vocabularyAndExpressions || []).map((v: any) => v.term).filter(Boolean),
      ...pronunciationPoints,
    ])
  );

  const primaryCorrection = essentialCorrections[0] || null;
  const rememberThis = (typeof review.rememberThis === 'string' && review.rememberThis.trim()) || '';

  const journalEntry: any = {
    id: entryId,
    entryType: 'lesson_review',
    date: transformation.sessionDate || new Date().toISOString().split('T')[0],
    sentence: rememberThis || `Native Friends Notes Quick Review (${transformation.topic || 'Live Coaching'})`,
    correctedSentence: primaryCorrection ? `✓ ${primaryCorrection.corrected} (instead of "${primaryCorrection.original}")` : undefined,
    explanation: [
      transformation.teacherName ? `Native Friend: ${transformation.teacherName}` : '',
      essentialCorrections.length > 0 ? `Corrections: ${essentialCorrections.map((c: any) => `${c.original} ➜ ${c.corrected}`).join('; ')}` : '',
      keyRules.length > 0 ? `Grammar: ${keyRules.join(' | ')}` : '',
      pronunciationPoints.length > 0 ? `Pronunciation: ${pronunciationPoints.join(', ')}` : '',
    ].filter(Boolean).join(' • '),
    wordsUsed,
    hasErrors: false,
    createdAt: transformation.generatedAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    studentUid: cleanUid,
    studentEmail: cleanEmail,
    teacherName: transformation.teacherName || 'Native Friend',
    lessonId: transformation.lessonId || sessionKey,
    sessionKey,
    cacheKeyRef: compositeCacheKey,
    reviewSummary: {
      rememberThis,
      keyRules,
      mustKnowVocabulary,
      essentialCorrections,
      estimatedMinutes: review.estimatedMinutes || '5–10 min',
    },
    keyCorrections: essentialCorrections,
    grammarRules: keyRules,
    pronunciationPoints,
  };

  const sanitized = removeUndefinedFields(journalEntry);

  const db = getFirestoreDb();
  if (db && !isCloudWriteDisabled) {
    try {
      const userRef = db.collection('users').doc(cleanUid);
      const subDocRef = userRef.collection('journal').doc(entryId);

      await subDocRef.set(sanitized, { merge: true });

      // Atomically update dailyJournalEntries array in users/{studentUid}
      const userSnap = await userRef.get();
      let currentList: any[] = [];
      if (userSnap.exists) {
        const uData = userSnap.data();
        if (Array.isArray(uData?.dailyJournalEntries)) {
          currentList = uData.dailyJournalEntries;
        }
      }

      const filtered = currentList.filter((e: any) => e.id !== entryId);
      const updatedList = [sanitized, ...filtered];

      await userRef.set(
        {
          dailyJournalEntries: updatedList,
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );
    } catch (fsErr) {
      if (!isPermissionError(fsErr)) {
        console.warn('Firestore recordLessonReviewInStudentJournal notice:', fsErr);
      }
    }
  }

  return { success: true, entry: sanitized };
}

/**
 * Direct persistence for Student Journal entries to users/{docId}
 */
export async function saveStudentJournalToFirestore(docId: string, journal: any[]): Promise<boolean> {
  if (isCloudWriteDisabled) return false;
  const db = getFirestoreDb();
  if (!db || !docId) return false;
  try {
    const sanitized = JSON.parse(JSON.stringify(journal || []));
    await db.collection('users').doc(docId).set(
      {
        studentJournal: sanitized,
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );
    return true;
  } catch (err: any) {
    if (isPermissionError(err)) {
      isCloudWriteDisabled = true;
      console.info('[serverFirestore] Remote student journal save restricted by IAM, continuing with local state.');
    } else {
      console.warn('Firestore saveStudentJournal error:', err);
    }
    return false;
  }
}

/**
 * Reconstructs a full pedagogical transformation object from a student's recorded journal review
 * and dictionary vocabulary entries when cached transformation is missing or provisional.
 */
export async function reconstructTransformationFromJournalAndDictionaryServer(
  studentUid: string,
  sessionKey: string
): Promise<any | null> {
  if (!studentUid || !sessionKey) return null;
  const cleanUid = studentUid.trim();
  const cleanSessionKey = sessionKey.trim();
  const cleanSessionId = cleanSessionKey.replace(/[^a-zA-Z0-9_-]/g, '_');
  const expectedEntryId = `journal_lesson_${cleanSessionId}_${cleanUid.replace(/[^a-zA-Z0-9_-]/g, '_')}`;

  try {
    const journalList = await fetchStudentDailyJournalFromServerFirestore(cleanUid);
    const bareKey = cleanSessionKey.replace(/^session_/, '').replace(/^lesson_/, '');
    const dateMatch = cleanSessionKey.match(/\d{4}-\d{2}-\d{2}/)?.[0];

    const matchingJournal = (journalList || []).find((entry: any) => {
      if (!entry) return false;
      if (entry.id === expectedEntryId) return true;
      if (entry.sessionKey === cleanSessionKey || entry.lessonId === cleanSessionKey) return true;
      if (typeof entry.id === 'string' && entry.id.includes(cleanSessionId)) return true;
      if (bareKey && (entry.lessonId === bareKey || entry.sessionKey === bareKey || (typeof entry.id === 'string' && entry.id.includes(bareKey)))) return true;
      if (dateMatch && entry.date === dateMatch && (entry.entryType === 'lesson_review' || entry.reviewSummary || entry.sentence?.includes('Quick Review'))) return true;
      return false;
    });

    if (!matchingJournal) {
      return null;
    }

    // Attempt to enrich vocabulary items from student's dictionary
    let dictionaryVocab: any[] = [];
    try {
      dictionaryVocab = await fetchStudentVocabularyFromFirestoreServer(cleanUid);
    } catch {}

    const reviewVocab: string[] = Array.isArray(matchingJournal.reviewSummary?.mustKnowVocabulary)
      ? matchingJournal.reviewSummary.mustKnowVocabulary
      : [];
    const wordsUsed: string[] = Array.from(
      new Set([
        ...(Array.isArray(matchingJournal.wordsUsed) ? matchingJournal.wordsUsed : []),
        ...reviewVocab,
      ])
    );
    const pronunciationPoints: string[] = Array.isArray(matchingJournal.pronunciationPoints) ? matchingJournal.pronunciationPoints : [];

    const vocabItems: any[] = [];
    const seenWords = new Set<string>();

    // 1. Check for dictionary entries linked to this session
    (dictionaryVocab || []).forEach((dictItem: any) => {
      if (!dictItem || !dictItem.word) return;
      const wLower = dictItem.word.toLowerCase().trim();
      const isSessionMatch =
        dictItem.lessonRefId === cleanSessionKey ||
        (Array.isArray(dictItem.origins) && dictItem.origins.some((orig: any) => orig?.lessonId === cleanSessionKey)) ||
        wordsUsed.some((w) => w.toLowerCase().trim() === wLower);

      if (isSessionMatch && !seenWords.has(wLower)) {
        seenWords.add(wLower);
        vocabItems.push({
          id: dictItem.id || `vocab_${wLower.replace(/[^a-zA-Z0-9_-]/g, '_')}`,
          term: dictItem.word,
          partOfSpeech: dictItem.partOfSpeech || (pronunciationPoints.some((p) => p.toLowerCase().trim() === wLower) ? 'Pronunciation Focus' : 'Vocabulary'),
          definitionEn: dictItem.definitionEn || dictItem.meaningOrTip || '',
          simpleDefinition: dictItem.simpleDefinition || dictItem.definitionEn || '',
          collocations: Array.isArray(dictItem.collocations) ? dictItem.collocations : [],
          realExamples: dictItem.exampleSentenceEn ? [dictItem.exampleSentenceEn] : (Array.isArray(dictItem.realExamples) ? dictItem.realExamples : []),
          synonyms: Array.isArray(dictItem.synonyms) ? dictItem.synonyms : [],
          register: dictItem.register || 'neutral',
          category: dictItem.category || (pronunciationPoints.some((p) => p.toLowerCase().trim() === wLower) ? 'Pronunciation & Phonetics (Alt+P)' : 'New Words & Expressions (Alt+W)'),
          phoneticGuide: dictItem.phoneticGuide || '',
          isPronunciationFocus: Boolean(dictItem.isPronunciationFocus || pronunciationPoints.some((p) => p.toLowerCase().trim() === wLower)),
          isNewWord: true,
        });
      }
    });

    // 2. Add any words from wordsUsed that were not found in dictionary
    wordsUsed.forEach((term) => {
      const wLower = (term || '').toLowerCase().trim();
      if (wLower && !seenWords.has(wLower)) {
        seenWords.add(wLower);
        const isPron = pronunciationPoints.some((p) => p.toLowerCase().trim() === wLower);
        vocabItems.push({
          id: `vocab_${wLower.replace(/[^a-zA-Z0-9_-]/g, '_')}`,
          term,
          partOfSpeech: isPron ? 'Pronunciation Focus' : 'Vocabulary',
          definitionEn: '',
          simpleDefinition: '',
          collocations: [],
          realExamples: [],
          synonyms: [],
          register: 'neutral',
          category: isPron ? 'Pronunciation & Phonetics (Alt+P)' : 'New Words & Expressions (Alt+W)',
          phoneticGuide: '',
          isPronunciationFocus: isPron,
          isNewWord: true,
        });
      }
    });

    const mistakesAnalysis = (matchingJournal.keyCorrections || matchingJournal.reviewSummary?.essentialCorrections || []).map((c: any, idx: number) => ({
      id: `mistake-${idx + 1}`,
      original: c.original || '',
      corrected: c.corrected || '',
      category: 'grammar',
      explanation: c.explanation || c.rule || '',
      twoExamples: [c.corrected].filter(Boolean),
      commonPitfalls: '',
    }));

    const grammarPoints = (matchingJournal.grammarRules || matchingJournal.reviewSummary?.keyRules || []).map((rule: string, idx: number) => ({
      id: `grammar-${idx + 1}`,
      topic: rule.split(':')[0] || `Grammar Rule ${idx + 1}`,
      rule,
      form: '',
      usage: rule,
      examples: [],
      commonMistakes: '',
      comparisons: '',
    }));

    const reviewSummary = matchingJournal.reviewSummary || {
      rememberThis: matchingJournal.sentence || '',
      keyRules: matchingJournal.grammarRules || [],
      mustKnowVocabulary: matchingJournal.wordsUsed || [],
      essentialCorrections: matchingJournal.keyCorrections || [],
      estimatedMinutes: '5–10 min',
    };

    return {
      sessionKey: cleanSessionKey,
      lessonId: matchingJournal.lessonId || cleanSessionKey,
      topic: matchingJournal.topic || (matchingJournal.sentence?.includes('Quick Review (') ? matchingJournal.sentence.split('Quick Review (')[1]?.replace(')', '') : 'Live Coaching Session'),
      teacherName: matchingJournal.teacherName || 'Native Friend',
      sessionDate: matchingJournal.date || new Date().toISOString().split('T')[0],
      isAiGenerated: true,
      isProvisional: false,
      reviewSummary,
      mistakesAnalysis,
      grammarPoints,
      vocabularyAndExpressions: vocabItems,
      generatedAt: matchingJournal.createdAt || matchingJournal.updatedAt || new Date().toISOString(),
      studentUid: cleanUid,
      studentEmail: matchingJournal.studentEmail || '',
      language: 'pt',
    };
  } catch (err) {
    console.warn('[serverFirestore] reconstructTransformationFromJournalAndDictionaryServer error:', err);
    return null;
  }
}

/**
 * Fetch student daily journal entries directly from Cloud Firestore (users/{docId}/journal and doc.dailyJournalEntries)
 */
export async function fetchStudentDailyJournalFromServerFirestore(docId: string): Promise<any[]> {
  const db = getFirestoreDb();
  if (!db || !docId) return [];
  try {
    const userRef = db.collection('users').doc(docId);
    const subCol = await userRef.collection('journal').get();
    const map = new Map<string, any>();
    if (!subCol.empty) {
      subCol.forEach((docSnap) => {
        const d = docSnap.data();
        if (d && d.id) map.set(d.id, d);
      });
    }
    const userSnap = await userRef.get();
    if (userSnap.exists) {
      const data = userSnap.data();
      if (Array.isArray(data?.dailyJournalEntries)) {
        data.dailyJournalEntries.forEach((e: any) => {
          if (e && e.id) map.set(e.id, e);
        });
      }
    }
    const list = Array.from(map.values()).sort((a, b) => {
      const tA = new Date(a.createdAt || a.date).getTime();
      const tB = new Date(b.createdAt || b.date).getTime();
      return tB - tA;
    });
    return list;
  } catch (err) {
    console.warn('fetchStudentDailyJournalFromServerFirestore error:', err);
    return [];
  }
}

/**
 * Subcollection-scoped persistence for routine checks
 */
export async function fetchWeeklyChecksFromFirestore(
  docIds: string[],
  canonicalWeekId: string,
  cycle: number
): Promise<Record<string, boolean> | null> {
  const db = getFirestoreDb();
  if (!db || !docIds.length) return null;

  for (const dId of docIds.filter(Boolean)) {
    try {
      const weekSnap = await db.collection('users').doc(dId).collection('weeklyChecks').doc(canonicalWeekId).get();
      if (weekSnap.exists) {
        const wData = weekSnap.data();
        return {
          ...(wData?.checks || {}),
          ...(wData?.weeklyChecks || {}),
          ...(wData?.sPathChecks || {}),
        };
      }
    } catch {}
  }

  // Week 1 legacy backward compatibility only
  if (cycle === 1) {
    for (const dId of docIds.filter(Boolean)) {
      try {
        const userSnap = await db.collection('users').doc(dId).get();
        if (userSnap.exists) {
          const uData = userSnap.data();
          if (uData?.weeklyChecks || uData?.sPathChecks) {
            return {
              ...(uData?.weeklyChecks || {}),
              ...(uData?.sPathChecks || {}),
            };
          }
        }
      } catch {}
    }
  }

  return null;
}

export async function saveWeeklyChecksToFirestore(
  docId: string,
  canonicalWeekId: string,
  weekDocPayload: any,
  fsRootPayload: any
): Promise<boolean> {
  if (isCloudWriteDisabled) return false;
  const db = getFirestoreDb();
  if (!db || !docId) return false;
  try {
    const userRef = db.collection('users').doc(docId);
    const subRef = userRef.collection('weeklyChecks').doc(canonicalWeekId);
    await Promise.all([
      subRef.set(JSON.parse(JSON.stringify(weekDocPayload)), { merge: true }),
      userRef.set(JSON.parse(JSON.stringify(fsRootPayload)), { merge: true }),
    ]);
    return true;
  } catch (err: any) {
    if (isPermissionError(err)) {
      isCloudWriteDisabled = true;
      console.info('[serverFirestore] Remote weekly checks save restricted by IAM, continuing with local state.');
    } else {
      console.warn('Firestore saveWeeklyChecks error:', err);
    }
    return false;
  }
}

/**
 * Subcollection-scoped persistence for homework
 */
export async function fetchHomeworkFromFirestore(
  docIds: string[],
  canonicalWeekId: string,
  cycle: number
): Promise<any | null> {
  const db = getFirestoreDb();
  if (!db || !docIds.length) return null;

  for (const dId of docIds.filter(Boolean)) {
    try {
      const hwSnap = await db.collection('users').doc(dId).collection('homework').doc(canonicalWeekId).get();
      if (hwSnap.exists) {
        return hwSnap.data();
      }
    } catch {}
  }

  // Week 1 legacy backward compatibility only
  if (cycle === 1) {
    for (const dId of docIds.filter(Boolean)) {
      try {
        const hwSubSnap = await db.collection('users').doc(dId).collection('homework').doc('current_week').get();
        if (hwSubSnap.exists) {
          return hwSubSnap.data();
        }
        const userSnap = await db.collection('users').doc(dId).get();
        if (userSnap.exists && userSnap.data()?.weeklyHomework) {
          return userSnap.data()?.weeklyHomework;
        }
      } catch {}
    }
  }

  return null;
}

export async function saveHomeworkToFirestore(
  docId: string,
  canonicalWeekId: string,
  cycle: number,
  hwPayload: any
): Promise<boolean> {
  if (isCloudWriteDisabled) return false;
  const db = getFirestoreDb();
  if (!db || !docId) return false;
  try {
    const sanitized = JSON.parse(JSON.stringify(hwPayload));
    const userRef = db.collection('users').doc(docId);
    const promises: Promise<any>[] = [
      userRef.collection('homework').doc(canonicalWeekId).set(sanitized, { merge: true }),
    ];
    if (cycle === 1) {
      promises.push(
        userRef.set(
          {
            weeklyHomework: sanitized,
            updatedAt: new Date().toISOString(),
          },
          { merge: true }
        )
      );
      promises.push(
        userRef.collection('homework').doc('current_week').set(sanitized, { merge: true })
      );
      promises.push(
        db.collection('student_homework').doc(docId).set(sanitized, { merge: true })
      );
    }
    await Promise.all(promises);
    return true;
  } catch (err: any) {
    if (isPermissionError(err)) {
      isCloudWriteDisabled = true;
      console.info('[serverFirestore] Remote homework save restricted by IAM, continuing with local state.');
    } else {
      console.warn('Firestore saveHomework error:', err);
    }
    return false;
  }
}

export interface ScheduleLessonServerParams {
  studentAuthUid: string;
  studentEmail?: string;
  studentName?: string;
  teacherIdOrEmail: string;
  teacherUid?: string;
  teacherEmail?: string;
  teacherName?: string;
  meetLink?: string;
  startDateTime: string;
  endDateTime: string;
  title?: string;
  description?: string;
  isTrialLesson?: boolean;
  requestId?: string;
  existingLessons?: any[];
  dbState?: any;
}

export interface ScheduleLessonServerResult {
  success: boolean;
  lesson?: any;
  remainingLessons?: number;
  contractedLessons?: number;
  isTrialLesson?: boolean;
  onboardingCompleted?: boolean;
  error?: string;
  statusCode: number;
}

/**
 * Server-authoritative atomic scheduling service using Firebase Admin SDK.
 * 
 * Guarantees:
 * 1. Authenticated canonical student UID derived strictly from server-verified token.
 * 2. Resolution of Native Friend across users, tutors, and consolidated catalog.
 * 3. Verification of tutor role and approved status (rejects unapproved/pending tutors).
 * 4. Conflict detection: blocks overlapping slots for both teacher and student.
 * 5. Trial lesson eligibility enforcement (prevents duplicate trial usage).
 * 6. Balance verification and atomic decrement for paid lessons.
 * 7. Idempotent execution preventing duplicate lessons on repeated submission.
 * 8. Atomic persistence in Cloud Firestore via Firebase Admin SDK runTransaction.
 */
export async function scheduleLessonAtomicServer(
  params: ScheduleLessonServerParams
): Promise<ScheduleLessonServerResult> {
  const {
    studentAuthUid,
    studentEmail,
    studentName,
    teacherIdOrEmail,
    teacherUid,
    teacherEmail,
    teacherName,
    meetLink,
    startDateTime,
    endDateTime,
    title,
    description,
    isTrialLesson,
    requestId,
    existingLessons,
    dbState,
  } = params;

  // 1. Validate student identity
  if (!studentAuthUid || typeof studentAuthUid !== 'string' || studentAuthUid.trim().length === 0) {
    return {
      success: false,
      error: 'Identidade de estudante não autenticada ou token inválido.',
      statusCode: 401,
    };
  }

  const cleanStudentEmail = (studentEmail || '').toLowerCase().trim();
  const cleanTeacherTarget = (teacherIdOrEmail || teacherUid || teacherEmail || '').trim();

  if (!cleanTeacherTarget) {
    return {
      success: false,
      error: 'Identificador do Amigo Nativo não informado.',
      statusCode: 400,
    };
  }

  // 2. Validate timestamps
  const startTime = new Date(startDateTime).getTime();
  const endTime = new Date(endDateTime).getTime();
  if (isNaN(startTime) || isNaN(endTime) || startTime >= endTime) {
    return {
      success: false,
      error: 'Horário de início ou término inválido. O horário inicial deve ser anterior ao término.',
      statusCode: 400,
    };
  }

  const db = getFirestoreDb();

  // 3. Resolve Native Friend (Teacher) profile using canonical identity resolver
  const isTargetUid = isValidCanonicalUid(cleanTeacherTarget);
  const isTargetEmail = cleanTeacherTarget.includes('@');
  const teacherResolution = await resolveTeacherCanonicalIdentity({
    teacherId: cleanTeacherTarget,
    teacherUid: isTargetUid ? cleanTeacherTarget : teacherUid,
    teacherEmail: isTargetEmail ? cleanTeacherTarget : teacherEmail,
    publicTutorId: (!isTargetUid && !isTargetEmail) ? cleanTeacherTarget : undefined,
    dbState: dbState,
  });

  if (!teacherResolution) {
    return {
      success: false,
      error: 'Amigo Nativo não encontrado no sistema.',
      statusCode: 404,
    };
  }

  // Validate teacher approval status
  if (!teacherResolution.isApproved) {
    return {
      success: false,
      error: 'O Amigo Nativo selecionado ainda não foi aprovado para receber agendamentos.',
      statusCode: 400,
    };
  }

  const canonicalTeacherUid = teacherResolution.canonicalUid;
  const resolvedPublicTutorId = teacherResolution.publicTutorId;
  const resolvedTeacherEmail = teacherResolution.email;
  const resolvedTeacherName = teacherResolution.name;

  const isGenericMeetUrl = (url?: string | null) =>
    !url || typeof url !== 'string' || !url.trim() || url.toLowerCase().includes('meet.google.com/new');

  // Retrieve the meeting URL belonging to the selected teacher
  let teacherConfiguredMeetUrl = '';
  const rawMeet = (teacherResolution.rawDoc?.meetUrl || teacherResolution.rawDoc?.meetLink || '').trim();
  if (rawMeet && !isGenericMeetUrl(rawMeet)) {
    teacherConfiguredMeetUrl = rawMeet;
  }

  // Check centralized settings in in-memory state or database
  if (!teacherConfiguredMeetUrl && dbState) {
    const rawId = (teacherResolution.rawDoc as any)?.id;
    const settingsCand =
      (canonicalTeacherUid ? (dbState.meetSettings?.[canonicalTeacherUid] || dbState.teacherSettings?.[canonicalTeacherUid]) : null) ||
      (resolvedTeacherEmail ? (dbState.meetSettings?.[resolvedTeacherEmail] || dbState.teacherSettings?.[resolvedTeacherEmail]) : null) ||
      (resolvedPublicTutorId ? (dbState.meetSettings?.[resolvedPublicTutorId] || dbState.teacherSettings?.[resolvedPublicTutorId]) : null) ||
      (rawId ? (dbState.meetSettings?.[rawId] || dbState.teacherSettings?.[rawId]) : null);
    const candLink = (settingsCand?.meetLink || settingsCand?.meetUrl || '').trim();
    if (candLink && !isGenericMeetUrl(candLink)) {
      teacherConfiguredMeetUrl = candLink;
    }
  }

  // Check in-memory tutors and teachers list
  if (!teacherConfiguredMeetUrl && dbState) {
    const allKnownTutors = [...(dbState.tutorsList || []), ...(dbState.teachers || [])];
    const matchedTutorItem = allKnownTutors.find((t: any) =>
      (canonicalTeacherUid && (t.uid === canonicalTeacherUid || t.id === canonicalTeacherUid || t.authUid === canonicalTeacherUid)) ||
      (resolvedTeacherEmail && (t.email || '').toLowerCase().trim() === resolvedTeacherEmail) ||
      (resolvedPublicTutorId && (t.publicTutorId === resolvedPublicTutorId || t.id === resolvedPublicTutorId))
    );
    const candLink = (matchedTutorItem?.meetUrl || matchedTutorItem?.meetLink || '').trim();
    if (candLink && !isGenericMeetUrl(candLink)) {
      teacherConfiguredMeetUrl = candLink;
    }
  }

  // Check Firestore if available across tutors, users, and teacher_availability
  if (!teacherConfiguredMeetUrl && db) {
    try {
      const emailDocId = resolvedTeacherEmail ? resolvedTeacherEmail.replace(/[^a-zA-Z0-9_-]/g, '_') : '';
      const [tUidDoc, tPubDoc, uUidDoc, aUidDoc, aEmailDoc] = await Promise.all([
        canonicalTeacherUid ? db.collection('tutors').doc(canonicalTeacherUid).get().catch(() => null) : null,
        resolvedPublicTutorId ? db.collection('tutors').doc(resolvedPublicTutorId).get().catch(() => null) : null,
        canonicalTeacherUid ? db.collection('users').doc(canonicalTeacherUid).get().catch(() => null) : null,
        canonicalTeacherUid ? db.collection('teacher_availability').doc(canonicalTeacherUid).get().catch(() => null) : null,
        emailDocId ? db.collection('teacher_availability').doc(emailDocId).get().catch(() => null) : null,
      ]);
      const candT = (tUidDoc && tUidDoc.exists) ? (tUidDoc.data()?.meetUrl || tUidDoc.data()?.meetLink) : null;
      const candTPub = (tPubDoc && tPubDoc.exists) ? (tPubDoc.data()?.meetUrl || tPubDoc.data()?.meetLink) : null;
      const candU = (uUidDoc && uUidDoc.exists) ? (uUidDoc.data()?.meetUrl || uUidDoc.data()?.meetLink) : null;
      const candA = (aUidDoc && aUidDoc.exists) ? (aUidDoc.data()?.meetLink || aUidDoc.data()?.meetUrl) : null;
      const candAEm = (aEmailDoc && aEmailDoc.exists) ? (aEmailDoc.data()?.meetLink || aEmailDoc.data()?.meetUrl) : null;
      const valid = [candT, candTPub, candU, candA, candAEm].find((c) => c && typeof c === 'string' && !isGenericMeetUrl(c));
      if (valid) {
        teacherConfiguredMeetUrl = valid.trim();
      }
    } catch {}
  }

  // Maintain student/teacher authorization boundaries: student cannot arbitrarily override teacher's room
  let resolvedMeetLink = teacherConfiguredMeetUrl;
  if (!resolvedMeetLink && meetLink && !isGenericMeetUrl(meetLink)) {
    resolvedMeetLink = meetLink.trim();
  }
  // Never fabricate a generic system URL like meet.google.com/new
  if (isGenericMeetUrl(resolvedMeetLink)) {
    resolvedMeetLink = '';
  }

  // Anti-impersonation: Student cannot be the same as Native Friend
  if (
    studentAuthUid === canonicalTeacherUid ||
    (resolvedTeacherEmail && cleanStudentEmail && resolvedTeacherEmail === cleanStudentEmail)
  ) {
    return {
      success: false,
      error: 'Violação de segurança: Aluno e Amigo Nativo não podem ter identidades idênticas.',
      statusCode: 400,
    };
  }

  // 4. Locate Student Profile
  let studentDoc: any = null;
  if (db) {
    studentDoc = await fetchUserDocumentFromFirestore(studentAuthUid, 2500);
    if (!studentDoc && cleanStudentEmail) {
      const emailDocId = cleanStudentEmail.replace(/[^a-zA-Z0-9]/g, '-');
      studentDoc = await fetchUserDocumentFromFirestore(emailDocId, 2000);
    }
  }
  if (!studentDoc && dbState) {
    studentDoc =
      (cleanStudentEmail ? dbState.userProfiles?.[cleanStudentEmail] : null) ||
      (dbState.students || []).find((s: any) => (s.email || '').toLowerCase().trim() === cleanStudentEmail || s.uid === studentAuthUid || s.id === studentAuthUid);
  }

  const currentContracted = Number(studentDoc?.contractedLessons ?? 0);
  const currentAvailable = studentDoc?.availableLessons !== undefined ? Number(studentDoc.availableLessons) : currentContracted;
  const hasAlreadyCompletedTrial = Boolean(studentDoc?.hasCompletedTrialLesson);

  // 5. Gather existing lessons for conflict and trial checks
  const allExistingLessons: any[] = [];
  if (Array.isArray(existingLessons)) {
    allExistingLessons.push(...existingLessons);
  }
  if (dbState && Array.isArray(dbState.liveLessons)) {
    allExistingLessons.push(...dbState.liveLessons);
  }
  if (db) {
    try {
      const [tSnap, tPubSnap, sSnap] = await Promise.all([
        db.collection('lessons').where('teacherUid', '==', canonicalTeacherUid).get().catch(() => null),
        (resolvedPublicTutorId && resolvedPublicTutorId !== canonicalTeacherUid ? db.collection('lessons').where('teacherUid', '==', resolvedPublicTutorId).get().catch(() => null) : null),
        db.collection('lessons').where('studentUid', '==', studentAuthUid).get().catch(() => null),
      ]);
      if (tSnap) tSnap.forEach((d) => allExistingLessons.push({ id: d.id, ...d.data() }));
      if (tPubSnap) tPubSnap.forEach((d) => allExistingLessons.push({ id: d.id, ...d.data() }));
      if (sSnap) sSnap.forEach((d) => allExistingLessons.push({ id: d.id, ...d.data() }));
    } catch {}
  }

  // Deduplicate existing lessons by id
  const existingLessonsMap = new Map<string, any>();
  allExistingLessons.forEach((l) => {
    if (l && l.id) existingLessonsMap.set(l.id, l);
  });
  const consolidatedLessons = Array.from(existingLessonsMap.values());

  // 6. Deterministic Lesson ID & Idempotency Check (Anti-Duplication on retry/rapid clicks)
  const deterministicLessonId = requestId || `lesson-${studentAuthUid}-${startTime}`;
  const existingExactLesson = consolidatedLessons.find((l) => l.id === deterministicLessonId);
  if (existingExactLesson && existingExactLesson.status === 'scheduled') {
    return {
      success: true,
      lesson: existingExactLesson,
      remainingLessons: currentAvailable,
      contractedLessons: currentContracted,
      isTrialLesson: Boolean(isTrialLesson),
      statusCode: 200,
    };
  }

  // 7. Check Overlapping Conflicts (Anti-Duplicity Rule: teacher or student cannot have overlapping slots)
  const candidateConflict = consolidatedLessons.find((l) => {
    const isCancelled = l.status === 'cancelled' || l.status === 'canceled' || Boolean(l.cancelledAt);
    if (isCancelled) return false;
    if (l.status && l.status !== 'scheduled') return false;

    // Check time overlap
    if (!l.startDateTime || !l.endDateTime) return false;
    const lStart = new Date(l.startDateTime).getTime();
    const lEnd = new Date(l.endDateTime).getTime();
    const overlaps = lStart < endTime && lEnd > startTime;
    if (!overlaps) return false;

    // Teacher conflict - supports canonical UID and legacy public ID for backwards compatibility
    const isSameTeacher =
      (l.teacherUid && (
        l.teacherUid === canonicalTeacherUid ||
        (resolvedPublicTutorId && l.teacherUid === resolvedPublicTutorId)
      )) ||
      (l.teacherAuthUid && l.teacherAuthUid === canonicalTeacherUid) ||
      (resolvedTeacherEmail && (l.teacherEmail || '').toLowerCase().trim() === resolvedTeacherEmail);

    // Student conflict
    const isSameStudent =
      (l.studentUid && l.studentUid === studentAuthUid) ||
      (cleanStudentEmail && (l.studentEmail || '').toLowerCase().trim() === cleanStudentEmail);

    return isSameTeacher || isSameStudent;
  });

  if (candidateConflict) {
    const isTeacher =
      (candidateConflict.teacherUid && (
        candidateConflict.teacherUid === canonicalTeacherUid ||
        candidateConflict.teacherUid === resolvedPublicTutorId
      )) ||
      (candidateConflict.teacherAuthUid && candidateConflict.teacherAuthUid === canonicalTeacherUid) ||
      (resolvedTeacherEmail && (candidateConflict.teacherEmail || '').toLowerCase().trim() === resolvedTeacherEmail);

    return {
      success: false,
      error: isTeacher
        ? 'Bloqueio de Conflito: O Amigo Nativo já possui outra aula agendada neste horário. Por favor, selecione outro horário.'
        : 'Bloqueio de Conflito: Você já possui outra aula agendada neste horário. Por favor, selecione outro horário.',
      statusCode: 409,
    };
  }

  // 8. Check Trial Lesson Eligibility & Balance
  if (isTrialLesson) {
    if (hasAlreadyCompletedTrial) {
      return {
        success: false,
        error: 'Aula experimental já foi utilizada anteriormente por este estudante.',
        statusCode: 400,
      };
    }

    const existingActiveTrial = consolidatedLessons.find((l) => {
      const isCancelled = l.status === 'cancelled' || l.status === 'canceled' || Boolean(l.cancelledAt);
      if (isCancelled) return false;
      const isSameStudent =
        l.studentUid === studentAuthUid ||
        (cleanStudentEmail && (l.studentEmail || '').toLowerCase().trim() === cleanStudentEmail);
      return isSameStudent && Boolean(l.isTrialLesson);
    });

    if (existingActiveTrial) {
      return {
        success: false,
        error: 'Você já possui uma aula experimental agendada ou realizada.',
        statusCode: 400,
      };
    }
  } else {
    // Check balance for regular lesson
    if (currentAvailable <= 0) {
      return {
        success: false,
        error: 'Saldo de aulas insuficiente. Por favor, adquira créditos de aulas antes de agendar.',
        statusCode: 402,
      };
    }
  }

  // 9. Compute updated balances
  let newContracted = currentContracted;
  let newAvailable = currentAvailable;
  if (isTrialLesson) {
    newContracted = Math.max(currentContracted, 1);
    newAvailable = Math.max(0, currentAvailable);
  } else {
    newContracted = currentContracted;
    newAvailable = Math.max(0, currentAvailable - 1);
  }

  const nowIso = new Date().toISOString();
  const sanitizedLesson = {
    id: deterministicLessonId,
    title: title || (isTrialLesson ? 'Aula Experimental Ao Vivo (Google Meet)' : 'Aula Ao Vivo 1-on-1'),
    description: description || '',
    startDateTime,
    endDateTime,
    studentUid: studentAuthUid,
    studentEmail: cleanStudentEmail || studentDoc?.email || '',
    studentName: studentName || studentDoc?.name || (cleanStudentEmail ? cleanStudentEmail.split('@')[0] : 'Aluno'),
    teacherUid: canonicalTeacherUid, // STRICTLY Firebase Auth UID!
    teacherAuthUid: canonicalTeacherUid,
    teacherPublicId: resolvedPublicTutorId,
    teacherEmail: resolvedTeacherEmail,
    teacherName: resolvedTeacherName,
    meetLink: resolvedMeetLink,
    status: 'scheduled',
    isTrialLesson: Boolean(isTrialLesson),
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  // 10. Atomic Execution: Firebase Admin SDK runTransaction when available
  if (db && !isCloudWriteDisabled) {
    try {
      await db.runTransaction(async (transaction) => {
        const studentRef = db.collection('users').doc(studentAuthUid);
        const lessonRef = db.collection('lessons').doc(deterministicLessonId);
        const studentSubLessonRef = db.collection('users').doc(studentAuthUid).collection('lessons').doc(deterministicLessonId);

        transaction.set(lessonRef, sanitizedLesson, { merge: true });
        transaction.set(studentSubLessonRef, sanitizedLesson, { merge: true });

        // Update teacher subcollection in /users and /tutors strictly with canonical UID
        const teacherUserSubLesson = db.collection('users').doc(canonicalTeacherUid).collection('lessons').doc(deterministicLessonId);
        transaction.set(teacherUserSubLesson, sanitizedLesson, { merge: true });

        const tutorSubLesson = db.collection('tutors').doc(canonicalTeacherUid).collection('lessons').doc(deterministicLessonId);
        transaction.set(tutorSubLesson, sanitizedLesson, { merge: true });

        // Student assignments record
        const assignmentRef = db.collection('student_assignments').doc(studentAuthUid);
        transaction.set(
          assignmentRef,
          {
            studentUid: studentAuthUid,
            teacherUid: canonicalTeacherUid,
            teacherAuthUid: canonicalTeacherUid,
            teacherPublicId: resolvedPublicTutorId,
            assignedNativeFriendUID: canonicalTeacherUid,
            nativeFriendUID: canonicalTeacherUid,
            teacherEmail: resolvedTeacherEmail,
            teacherName: resolvedTeacherName,
            updatedAt: nowIso,
          },
          { merge: true }
        );

        // Student document update
        transaction.set(
          studentRef,
          {
            uid: studentAuthUid,
            id: studentAuthUid,
            email: cleanStudentEmail || studentDoc?.email || '',
            name: sanitizedLesson.studentName,
            teacherUid: canonicalTeacherUid,
            assignedNativeFriendUID: canonicalTeacherUid,
            nativeFriendUID: canonicalTeacherUid,
            teacherEmail: resolvedTeacherEmail,
            teacherName: resolvedTeacherName,
            teacherMeetUrl: resolvedMeetLink,
            enrollmentStatus: 'active',
            hasCompletedTrialLesson: isTrialLesson ? true : hasAlreadyCompletedTrial,
            onboardingCompleted: isTrialLesson ? true : (studentDoc?.onboardingCompleted ?? true),
            contractedLessons: newContracted,
            availableLessons: newAvailable,
            updatedAt: nowIso,
          },
          { merge: true }
        );

        // Idempotent reconciliation of legacy student doc without deletion
        if (studentDoc && studentDoc.id && studentDoc.id !== studentAuthUid) {
          const legacyStudentRef = db.collection('users').doc(studentDoc.id);
          transaction.set(legacyStudentRef, { canonicalUid: studentAuthUid, updatedAt: nowIso }, { merge: true });
        }
      });
    } catch (txErr: any) {
      if (isPermissionError(txErr)) {
        isCloudWriteDisabled = true;
        console.info('[serverFirestore] Remote schedule transaction restricted by IAM, committing to synchronized state.');
      } else {
        console.warn('[serverFirestore] Firestore admin transaction warning:', txErr);
      }
    }
  }

  // 11. Synchronize in-memory AppDb if provided
  if (dbState) {
    if (!Array.isArray(dbState.liveLessons)) dbState.liveLessons = [];
    const existingIdx = dbState.liveLessons.findIndex((l: any) => l.id === deterministicLessonId);
    if (existingIdx >= 0) {
      dbState.liveLessons[existingIdx] = sanitizedLesson;
    } else {
      dbState.liveLessons.unshift(sanitizedLesson);
    }

    if (!dbState.userProfiles) dbState.userProfiles = {};
    const profileKey = cleanStudentEmail || studentAuthUid;
    dbState.userProfiles[profileKey] = {
      ...(dbState.userProfiles[profileKey] || {}),
      id: studentAuthUid,
      uid: studentAuthUid,
      email: cleanStudentEmail,
      name: sanitizedLesson.studentName,
      teacherUid: canonicalTeacherUid,
      assignedNativeFriendUID: canonicalTeacherUid,
      nativeFriendUID: canonicalTeacherUid,
      teacherEmail: resolvedTeacherEmail,
      teacherName: resolvedTeacherName,
      teacherMeetUrl: resolvedMeetLink,
      enrollmentStatus: 'active',
      hasCompletedTrialLesson: isTrialLesson ? true : hasAlreadyCompletedTrial,
      onboardingCompleted: isTrialLesson ? true : (dbState.userProfiles[profileKey]?.onboardingCompleted ?? true),
      contractedLessons: newContracted,
      availableLessons: newAvailable,
      updatedAt: nowIso,
    };

    if (!Array.isArray(dbState.students)) dbState.students = [];
    const stIdx = dbState.students.findIndex(
      (s: any) => (s.email || '').toLowerCase().trim() === cleanStudentEmail || s.uid === studentAuthUid || s.id === studentAuthUid
    );
    if (stIdx >= 0) {
      dbState.students[stIdx] = {
        ...dbState.students[stIdx],
        uid: studentAuthUid,
        studentUid: studentAuthUid,
        teacherUid: canonicalTeacherUid,
        assignedNativeFriendUID: canonicalTeacherUid,
        nativeFriendUID: canonicalTeacherUid,
        teacherEmail: resolvedTeacherEmail,
        teacherName: resolvedTeacherName,
        status: 'active',
        contractedLessons: newContracted,
        hasCompletedTrialLesson: isTrialLesson ? true : hasAlreadyCompletedTrial,
        onboardingCompleted: isTrialLesson ? true : ((dbState.students[stIdx] as any)?.onboardingCompleted ?? true),
        teacherMeetUrl: resolvedMeetLink,
      };
    } else {
      dbState.students.push({
        id: studentAuthUid,
        uid: studentAuthUid,
        studentUid: studentAuthUid,
        name: sanitizedLesson.studentName,
        studentName: sanitizedLesson.studentName,
        email: cleanStudentEmail,
        studentEmail: cleanStudentEmail,
        teacherUid: canonicalTeacherUid,
        assignedNativeFriendUID: canonicalTeacherUid,
        nativeFriendUID: canonicalTeacherUid,
        teacherEmail: resolvedTeacherEmail,
        teacherName: resolvedTeacherName,
        teacherMeetUrl: resolvedMeetLink,
        status: 'active',
        contractedLessons: newContracted,
        hasCompletedTrialLesson: isTrialLesson ? true : false,
        onboardingCompleted: isTrialLesson ? true : false,
        createdAt: nowIso,
      });
    }
  }

  return {
    success: true,
    lesson: sanitizedLesson,
    remainingLessons: newAvailable,
    contractedLessons: newContracted,
    isTrialLesson: Boolean(isTrialLesson),
    onboardingCompleted: isTrialLesson ? true : Boolean(studentDoc?.onboardingCompleted ?? true),
    statusCode: 200,
  };
}

/**
 * HOTFIX PONTUAL — Insights & Icebreakers Persistence
 */
const localInsightsMap = new Map<string, any>();

/**
 * Fetches saved lesson insights snapshot from Firestore collection 'lesson_insights'
 */
export async function fetchLessonInsightsFromFirestoreServer(lessonId: string): Promise<any | null> {
  const cleanId = (lessonId || '').trim();
  if (!cleanId) return null;

  const db = getFirestoreDb();
  if (db && !isCloudWriteDisabled) {
    try {
      const snap = await db.collection('lesson_insights').doc(cleanId).get();
      if (snap.exists) {
        const data = { id: snap.id, ...snap.data() };
        localInsightsMap.set(cleanId, data);
        return data;
      }
    } catch (err: any) {
      if (!isPermissionError(err)) {
        console.warn('[serverFirestore] fetchLessonInsights notice:', err);
      }
    }
  }

  return localInsightsMap.get(cleanId) || null;
}

/**
 * Saves lesson insights snapshot to Firestore collection 'lesson_insights'
 */
export async function saveLessonInsightsToFirestoreServer(lessonId: string, data: any): Promise<boolean> {
  const cleanId = (lessonId || '').trim();
  if (!cleanId) return false;

  const payload = removeUndefinedFields({
    ...data,
    lessonId: cleanId,
    updatedAt: new Date().toISOString(),
  });
  localInsightsMap.set(cleanId, payload);

  const db = getFirestoreDb();
  if (db && !isCloudWriteDisabled) {
    try {
      await db.collection('lesson_insights').doc(cleanId).set(payload, { merge: true });
      return true;
    } catch (err: any) {
      if (isPermissionError(err)) {
        isCloudWriteDisabled = true;
      } else {
        console.warn('[serverFirestore] saveLessonInsights notice:', err);
      }
    }
  }

  return true;
}

/**
 * Verifies that a teacher is authorized to access a given student and lesson
 */
export async function verifyTeacherLessonAccessServer(
  callerUid: string,
  callerEmail: string | undefined,
  studentUid: string,
  lessonId: string,
  callerRole?: string,
  studentEmail?: string
): Promise<boolean> {
  if (callerRole === 'admin') return true;
  const db = getFirestoreDb();

  const cleanTeacherUid = (callerUid || '').trim();
  const cleanTeacherEmail = (callerEmail || '').toLowerCase().trim();
  const cleanStudentUid = (studentUid || '').trim();
  const cleanStudentEmail = (studentEmail || (cleanStudentUid.includes('@') ? cleanStudentUid : '')).toLowerCase().trim();
  const cleanLessonId = (lessonId || '').trim();

  // 1. Direct lesson check by lessonId
  if (cleanLessonId && db) {
    try {
      const snap = await db.collection('lessons').doc(cleanLessonId).get();
      if (snap.exists) {
        const l = snap.data();
        const lTeacherUid = (l?.teacherUid || l?.tutorUid || '').trim();
        const lTeacherEmail = (l?.teacherEmail || l?.tutorEmail || '').toLowerCase().trim();
        const lStudentUid = (l?.studentUid || '').trim();
        const lStudentEmail = (l?.studentEmail || '').toLowerCase().trim();

        const teacherMatches =
          (cleanTeacherUid && (lTeacherUid === cleanTeacherUid || lTeacherUid === `tutor-${cleanTeacherUid}`)) ||
          (cleanTeacherEmail && lTeacherEmail === cleanTeacherEmail);

        const studentMatches =
          (cleanStudentUid && lStudentUid === cleanStudentUid) ||
          (cleanStudentEmail && lStudentEmail === cleanStudentEmail) ||
          (cleanStudentUid && lStudentEmail === cleanStudentUid);

        if (teacherMatches && studentMatches) {
          return true;
        }
      }
    } catch {}
  }

  // 2. Check lessons collection for any active lesson between this teacher and student
  if (db && (cleanStudentUid || cleanStudentEmail)) {
    try {
      const lQuery = cleanStudentEmail
        ? db.collection('lessons').where('studentEmail', '==', cleanStudentEmail)
        : db.collection('lessons').where('studentUid', '==', cleanStudentUid);
      const lSnap = await lQuery.get();
      if (!lSnap.empty) {
        for (const doc of lSnap.docs) {
          const l = doc.data();
          if (l.status === 'cancelled' || l.status === 'canceled') continue;
          const lTeacherUid = (l?.teacherUid || l?.tutorUid || '').trim();
          const lTeacherEmail = (l?.teacherEmail || l?.tutorEmail || '').toLowerCase().trim();
          const teacherMatches =
            (cleanTeacherUid && (lTeacherUid === cleanTeacherUid || lTeacherUid === `tutor-${cleanTeacherUid}`)) ||
            (cleanTeacherEmail && lTeacherEmail === cleanTeacherEmail);
          if (teacherMatches) return true;
        }
      }
    } catch {}
  }

  // 3. Check users collection by doc ID (canonical UID)
  if (db && cleanStudentUid && !cleanStudentUid.includes('@')) {
    try {
      const stSnap = await db.collection('users').doc(cleanStudentUid).get();
      if (stSnap.exists) {
        const stData = stSnap.data();
        const assignedTeacher = (stData?.assignedNativeFriendUID || stData?.assignedTutorId || stData?.teacherUid || '').trim();
        const assignedEmail = (stData?.teacherEmail || '').toLowerCase().trim();
        if (
          (cleanTeacherUid && (assignedTeacher === cleanTeacherUid || assignedTeacher === `tutor-${cleanTeacherUid}`)) ||
          (cleanTeacherEmail && assignedEmail === cleanTeacherEmail)
        ) {
          return true;
        }
      }
    } catch {}
  }

  // 4. Check users collection by email
  if (db && cleanStudentEmail) {
    try {
      const pSnap = await db.collection('users').where('email', '==', cleanStudentEmail).get();
      if (!pSnap.empty) {
        for (const doc of pSnap.docs) {
          const stData = doc.data();
          const assignedTeacher = (stData?.assignedNativeFriendUID || stData?.assignedTutorId || stData?.teacherUid || '').trim();
          const assignedEmail = (stData?.teacherEmail || '').toLowerCase().trim();
          if (
            (cleanTeacherUid && (assignedTeacher === cleanTeacherUid || assignedTeacher === `tutor-${cleanTeacherUid}`)) ||
            (cleanTeacherEmail && assignedEmail === cleanTeacherEmail)
          ) {
            return true;
          }
        }
      }
    } catch {}
  }

  // 5. Fallback verification via server authoritative in-memory db (getAuthoritativeDb)
  const dbLocal = getAuthoritativeDb();
  if (dbLocal) {
    try {
      const hasLesson = (dbLocal.liveLessons || []).some((l: any) => {
        if (!l || l.status === 'cancelled') return false;
        const lTeacherUid = (l.teacherUid || (l as any).tutorUid || '').trim();
        const lTeacherEmail = (l.teacherEmail || (l as any).tutorEmail || '').toLowerCase().trim();
        const lStudentEmail = (l.studentEmail || '').toLowerCase().trim();
        const lStudentUid = (l.studentUid || '').trim();
        const tMatch = (cleanTeacherUid && (lTeacherUid === cleanTeacherUid || lTeacherUid === `tutor-${cleanTeacherUid}`)) || (cleanTeacherEmail && lTeacherEmail === cleanTeacherEmail);
        const sMatch = (cleanStudentEmail && lStudentEmail === cleanStudentEmail) || (cleanStudentUid && lStudentUid === cleanStudentUid);
        return tMatch && sMatch;
      });
      if (hasLesson) return true;

      const student = (dbLocal.students || []).find((s: any) => {
        const sEmail = (s.email || s.studentEmail || '').toLowerCase().trim();
        const sUid = (s.uid || s.studentUid || s.id || '').trim();
        return (cleanStudentEmail && sEmail === cleanStudentEmail) || (cleanStudentUid && sUid === cleanStudentUid);
      });
      const prof = cleanStudentEmail ? dbLocal.userProfiles?.[cleanStudentEmail] : null;
      if (student || prof) {
        const sTeacherUid = (student?.teacherUid || (student as any)?.assignedTeacherId || (student as any)?.assignedNativeFriendUID || prof?.teacherUid || prof?.assignedNativeFriendUID || '').trim();
        const sTeacherEmail = (student?.teacherEmail || prof?.teacherEmail || '').toLowerCase().trim();
        const isDirect =
          (cleanTeacherUid && (sTeacherUid === cleanTeacherUid || sTeacherUid === `tutor-${cleanTeacherUid}`)) ||
          (cleanTeacherEmail && sTeacherEmail === cleanTeacherEmail);
        const isConflict = Boolean(
          sTeacherEmail && cleanTeacherEmail && sTeacherEmail !== cleanTeacherEmail &&
          sTeacherUid && cleanTeacherUid && sTeacherUid !== cleanTeacherUid && sTeacherUid !== `tutor-${cleanTeacherUid}`
        );
        const isApprovedTutor = (dbLocal.teachers || []).some((t: any) =>
          (cleanTeacherUid && (t.uid === cleanTeacherUid || t.id === cleanTeacherUid || t.authUid === cleanTeacherUid || t.id === `tutor-${cleanTeacherUid}`)) ||
          (cleanTeacherEmail && t.email?.toLowerCase().trim() === cleanTeacherEmail)
        ) || (dbLocal.tutorsList || []).some((t: any) =>
          (cleanTeacherUid && (t.uid === cleanTeacherUid || t.id === cleanTeacherUid || t.authUid === cleanTeacherUid || t.id === `tutor-${cleanTeacherUid}`)) ||
          (cleanTeacherEmail && t.email?.toLowerCase().trim() === cleanTeacherEmail)
        );
        if (isDirect || (isApprovedTutor && !isConflict)) {
          return true;
        }
      } else if (cleanStudentEmail || cleanStudentUid) {
        const isApprovedTutor = (dbLocal.teachers || []).some((t: any) =>
          (cleanTeacherUid && (t.uid === cleanTeacherUid || t.id === cleanTeacherUid || t.authUid === cleanTeacherUid || t.id === `tutor-${cleanTeacherUid}`)) ||
          (cleanTeacherEmail && t.email?.toLowerCase().trim() === cleanTeacherEmail)
        ) || (dbLocal.tutorsList || []).some((t: any) =>
          (cleanTeacherUid && (t.uid === cleanTeacherUid || t.id === cleanTeacherUid || t.authUid === cleanTeacherUid || t.id === `tutor-${cleanTeacherUid}`)) ||
          (cleanTeacherEmail && t.email?.toLowerCase().trim() === cleanTeacherEmail)
        );
        if (isApprovedTutor) {
          return true;
        }
      }
    } catch {}
  }

  return false;
}

/**
 * Queries student's real completed activities (videos & 5 Words) between previous lesson and current lesson.
 * Strictly checks Firestore '(default)'.
 */
export async function getStudentActivitiesBetweenLessonsServer(
  studentUid: string,
  studentEmail: string | undefined,
  lessonId: string,
  callerTeacherUid: string
): Promise<{
  videos: Array<{ id?: string; title: string; dayOfWeek?: string; date?: string }>;
  vocabulary: Array<{ word: string; context?: string; translation?: string }>;
  prevLesson: any | null;
  currentLesson: any | null;
  hasActivities: boolean;
}> {
  const db = getFirestoreDb();
  if (!studentUid && !studentEmail) {
    return { videos: [], vocabulary: [], prevLesson: null, currentLesson: null, hasActivities: false };
  }

  const cleanUid = (studentUid || '').trim();
  const cleanEmail = (studentEmail || (cleanUid.includes('@') ? cleanUid : '')).toLowerCase().trim();
  const cleanLessonId = (lessonId || '').trim();

  // Resolve authentic canonical student UID
  let canonicalUid = (isValidCanonicalUid(cleanUid) ? cleanUid : '');
  if (!canonicalUid && cleanEmail) {
    if (db) {
      try {
        const uSnap = await db.collection('users').where('email', '==', cleanEmail).limit(1).get();
        if (!uSnap.empty && isValidCanonicalUid(uSnap.docs[0].id)) {
          canonicalUid = uSnap.docs[0].id;
        }
      } catch {}
    }

    if (!canonicalUid) {
      try {
        const { getFirebaseAdminAuth } = await import('./serverFirebaseAdmin');
        const adminAuth = getFirebaseAdminAuth();
        if (adminAuth) {
          const rec = await adminAuth.getUserByEmail(cleanEmail);
          if (rec?.uid && isValidCanonicalUid(rec.uid)) {
            canonicalUid = rec.uid;
          }
        }
      } catch {}
    }

    if (!canonicalUid) {
      const dbLocal = getAuthoritativeDb();
      if (dbLocal) {
        const profile = dbLocal.userProfiles?.[cleanEmail];
        const student = (dbLocal.students || []).find((s: any) => (s.email || s.studentEmail || '').toLowerCase().trim() === cleanEmail);
        const foundUid = (profile?.uid && isValidCanonicalUid(profile.uid) ? profile.uid : '') ||
          (student?.uid && isValidCanonicalUid(student.uid) ? student.uid : '') ||
          (student?.studentUid && isValidCanonicalUid(student.studentUid) ? student.studentUid : '');
        if (foundUid) canonicalUid = foundUid;
      }
    }
  }

  const effectiveUid = canonicalUid || cleanUid;

  // 1. Fetch current lesson
  let currentLesson: any = null;
  if (cleanLessonId && db) {
    try {
      const snap = await db.collection('lessons').doc(cleanLessonId).get();
      if (snap.exists) {
        currentLesson = { id: snap.id, ...snap.data() };
      }
    } catch {}
  }

  // 2. Fetch all student lessons to establish chronological sequence
  const studentLessons: any[] = [];
  try {
    if (db && effectiveUid && !effectiveUid.includes('@')) {
      const q1 = await db.collection('lessons').where('studentUid', '==', effectiveUid).get();
      q1.forEach((docSnap) => studentLessons.push({ id: docSnap.id, ...docSnap.data() }));
    }

    if (db && cleanEmail) {
      const q2 = await db.collection('lessons').where('studentEmail', '==', cleanEmail).get();
      q2.forEach((docSnap) => {
        if (!studentLessons.some((l) => l.id === docSnap.id)) {
          studentLessons.push({ id: docSnap.id, ...docSnap.data() });
        }
      });
    }
  } catch {}

  // Filter out cancelled lessons and sort chronologically
  const activeLessons = studentLessons
    .filter((l) => l && l.status !== 'cancelled' && l.status !== 'canceled')
    .sort((a, b) => {
      const timeA = new Date(a.startDateTime || a.date || 0).getTime();
      const timeB = new Date(b.startDateTime || b.date || 0).getTime();
      return timeA - timeB;
    });

  let prevLesson: any = null;
  if (currentLesson) {
    const currIdx = activeLessons.findIndex((l) => l.id === currentLesson.id);
    if (currIdx > 0) {
      prevLesson = activeLessons[currIdx - 1];
    } else if (currIdx === -1 && activeLessons.length > 0) {
      const currTime = new Date(currentLesson.startDateTime || currentLesson.date || 0).getTime();
      const earlier = activeLessons.filter((l) => new Date(l.startDateTime || l.date || 0).getTime() < currTime);
      if (earlier.length > 0) {
        prevLesson = earlier[earlier.length - 1];
      }
    }
  } else if (activeLessons.length > 0) {
    currentLesson = activeLessons[activeLessons.length - 1];
    if (activeLessons.length > 1) {
      prevLesson = activeLessons[activeLessons.length - 2];
    }
  }

  const cutoffIso = prevLesson?.startDateTime || (prevLesson?.date ? `${prevLesson.date}T00:00:00.000Z` : null);
  const cutoffTime = cutoffIso ? new Date(cutoffIso).getTime() : 0;
  const currentIso = currentLesson?.startDateTime || (currentLesson?.date ? `${currentLesson.date}T23:59:59.999Z` : new Date().toISOString());
  const currentTime = new Date(currentIso).getTime();

  // 3. Query Studied Videos and Vocabulary
  const rawVideos: Array<{ id?: string; title: string; dayOfWeek?: string; date?: string; timestamp?: number }> = [];
  const rawWords: any[] = [];

  const targetDocIds = Array.from(new Set([effectiveUid, cleanUid].filter(Boolean)));
  for (const docId of targetDocIds) {
    if (db) {
      try {
        const journalSnap = await db.collection('users').doc(docId).collection('journal').get();
        journalSnap.forEach((docSnap) => {
          const d = docSnap.data();
          if (d && (d.type === 'video' || d.activityType === 'video') && (d.title || d.videoTitle)) {
            rawVideos.push({
              id: d.id || d.videoId,
              title: d.title || d.videoTitle,
              dayOfWeek: d.dayOfWeek,
              date: d.date,
              timestamp: d.timestamp || (d.date ? new Date(d.date).getTime() : 0),
            });
          }
        });
      } catch {}

      try {
        const whSnap = await db.collection('users').doc(docId).collection('weeklyHistory').get();
        whSnap.forEach((docSnap) => {
          const wh = docSnap.data();
          if (Array.isArray(wh?.consumedVideoIds)) {
            wh.consumedVideoIds.forEach((v: any) => {
              if (v && (v.title || v.videoTitle)) {
                rawVideos.push({
                  id: v.id || v.videoId,
                  title: v.title || v.videoTitle,
                  dayOfWeek: v.dayOfWeek,
                  date: v.date,
                  timestamp: v.timestamp || (v.watchedAt ? new Date(v.watchedAt).getTime() : 0),
                });
              }
            });
          }
        });
      } catch {}
    }
  }

  let userDocData: any = null;
  for (const docId of targetDocIds) {
    if (db) {
      try {
        const uSnap = await db.collection('users').doc(docId).get();
        if (uSnap.exists) {
          userDocData = uSnap.data();
          if (Array.isArray(userDocData?.studentJournal)) {
            userDocData.studentJournal.forEach((d: any) => {
              if (d && (d.type === 'video' || d.activityType === 'video') && (d.title || d.videoTitle)) {
                rawVideos.push({
                  id: d.id || d.videoId,
                  title: d.title || d.videoTitle,
                  dayOfWeek: d.dayOfWeek,
                  date: d.date,
                  timestamp: d.timestamp || (d.date ? new Date(d.date).getTime() : 0),
                });
              }
            });
          }
          break;
        }
      } catch {}
    }
  }

  // Also inspect in-memory/server profile for studentJournal, watchedVideosHistory, and vocabulary
  if (cleanEmail) {
    try {
      const dbLocal = getAuthoritativeDb();
      const prof = dbLocal?.userProfiles?.[cleanEmail];
      if (prof) {
        if (Array.isArray(prof.studentJournal)) {
          prof.studentJournal.forEach((d: any) => {
            if (d && (d.type === 'video' || d.activityType === 'video') && (d.title || d.videoTitle)) {
              rawVideos.push({
                id: d.id || d.videoId,
                title: d.title || d.videoTitle,
                dayOfWeek: d.dayOfWeek,
                date: d.date,
                timestamp: d.timestamp || (d.date ? new Date(d.date).getTime() : 0),
              });
            }
          });
        }
        if (Array.isArray(prof.watchedVideosHistory)) {
          prof.watchedVideosHistory.forEach((item: any) => {
            const vTitle = typeof item === 'string' ? item : item?.title || item?.videoTitle;
            if (vTitle) {
              rawVideos.push({
                id: item?.id || item?.videoId || 'video',
                title: vTitle,
                date: item?.date || item?.watchedAt,
                timestamp: item?.timestamp || (item?.watchedAt ? new Date(item.watchedAt).getTime() : 0),
              });
            }
          });
        }
        if (Array.isArray(prof.vocabulary)) {
          prof.vocabulary.forEach((item: any) => {
            if (item?.word && !rawWords.some((w) => (w.word || '').toLowerCase().trim() === item.word.toLowerCase().trim())) {
              rawWords.push(item);
            }
          });
        }
      }
    } catch {}
  }

  // Filter videos between cutoffTime and currentTime
  const filteredVideos: Array<{ id?: string; title: string; dayOfWeek?: string; date?: string }> = [];
  const seenVideoTitles = new Set<string>();

  for (const v of rawVideos) {
    if (!v.title) continue;
    const norm = v.title.toLowerCase().trim();
    if (seenVideoTitles.has(norm)) continue;

    if (cutoffTime > 0) {
      const itemTime = v.timestamp || (v.date ? new Date(v.date).getTime() : 0);
      if (itemTime > 0 && (itemTime < cutoffTime || itemTime > currentTime + 86400000)) {
        continue;
      }
    }
    seenVideoTitles.add(norm);
    filteredVideos.push({
      id: v.id,
      title: v.title,
      dayOfWeek: v.dayOfWeek,
      date: v.date,
    });
    if (filteredVideos.length >= 5) break;
  }

  // 4. Query 5 Words activity vocabulary
  for (const docId of targetDocIds) {
    if (db) {
      try {
        const vocabSnap = await db.collection('users').doc(docId).collection('vocabulary').get();
        vocabSnap.forEach((docSnap) => rawWords.push(docSnap.data()));
      } catch {}

      try {
        const whSnap = await db.collection('users').doc(docId).collection('weeklyHistory').get();
        whSnap.forEach((docSnap) => {
          const wh = docSnap.data();
          if (Array.isArray(wh?.weeklyVocabulary)) {
            wh.weeklyVocabulary.forEach((w: any) => {
              if (w && w.word && !rawWords.some((rw) => (rw.word || '').toLowerCase() === (w.word || '').toLowerCase())) {
                rawWords.push(w);
              }
            });
          }
        });
      } catch {}
    }
  }

  if (Array.isArray(userDocData?.vocabulary)) {
    userDocData.vocabulary.forEach((item: any) => {
      if (!rawWords.some((w) => (w.word || '').toLowerCase().trim() === (item.word || '').toLowerCase().trim())) {
        rawWords.push(item);
      }
    });
  }

  // Filter 5 Words: routine words studied between cutoffTime and currentTime
  const filteredWords: Array<{ word: string; context?: string; translation?: string }> = [];
  const seenWords = new Set<string>();

  for (const w of rawWords) {
    if (!w || !w.word) continue;
    const cleanW = w.word.toLowerCase().trim();
    if (seenWords.has(cleanW)) continue;

    // Check if origin is routine / 5 Words
    const isRoutine =
      w.source === 'routine' ||
      (Array.isArray(w.origins) && w.origins.some((o: any) => o.source === 'routine' || (o.context && o.context.includes('5 Words')))) ||
      (w.sourceActivityName && w.sourceActivityName.toLowerCase().includes('routine'));

    if (!isRoutine) continue;

    if (cutoffTime > 0) {
      const learnedTime = new Date(w.learnedAt || w.date || w.createdAt || w.updatedAt || 0).getTime();
      if (learnedTime > 0 && (learnedTime < cutoffTime || learnedTime > currentTime + 86400000)) {
        continue;
      }
    }

    seenWords.add(cleanW);
    const routineContext =
      w.context ||
      w.origins?.find((o: any) => o.context)?.context ||
      w.sourceActivityName ||
      w.exampleSentenceEn ||
      'Routine 5 Words study';

    filteredWords.push({
      word: w.word,
      context: routineContext,
      translation: w.translationPt || w.translation || '',
    });
    if (filteredWords.length >= 5) break;
  }

  const hasActivities = filteredVideos.length > 0 || filteredWords.length > 0;

  return {
    videos: filteredVideos,
    vocabulary: filteredWords,
    prevLesson,
    currentLesson,
    hasActivities,
  };
}

