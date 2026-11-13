import { getFirestore, Firestore, FieldValue } from 'firebase-admin/firestore';
import { getFirebaseAdminApp, ALLOWED_STAGING_PROJECT_ID } from './serverFirebaseAdmin';
import { normalizeDictionaryWord } from './utils/studentDictionaryLibrary';
import { isGenericPedagogicalDefinition } from './serverGeminiSecurity';
import { isLegacyGenericTransformation } from './utils/pedagogicalTransformer';
import { createCleanStudentRoutines } from './data/defaultRoutines';

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
        // Rule 1 & 2: Query canonical user doc users/{candidateUid} first
        const uSnap = await db.collection('users').doc(candidateUid).get().catch(() => null);
        if (uSnap && uSnap.exists) {
          const uData = uSnap.data();
          const uRole = (uData?.role || uData?.userRole || '').toLowerCase();
          // STRICT RULE 4: If canonical user is registered as a student, reject immediately!
          if (uRole === 'student') {
            console.warn(`[resolveTeacherCanonicalIdentity] Account ${candidateUid} is canonically registered as student. Rejecting teacher identity resolution.`);
            return null;
          }
          if ((uRole === 'teacher' || uRole === 'tutor' || uRole === 'native_friend') && uRole !== 'student') {
            candidateDocs.push({ id: uSnap.id, ...uData });
          }
        }

        // Only inspect tutors/{candidateUid} and linked tutors records if users/{candidateUid} is NOT a student
        const tSnap = await db.collection('tutors').doc(candidateUid).get().catch(() => null);
        if (tSnap && tSnap.exists) {
          const tData = tSnap.data();
          if (tData && tData.role !== 'student') {
            candidateDocs.push({ id: tSnap.id, ...tData });
          }
        } else {
          const [qUid, qAuthUid] = await Promise.all([
            db.collection('tutors').where('uid', '==', candidateUid).limit(1).get().catch(() => null),
            db.collection('tutors').where('authUid', '==', candidateUid).limit(1).get().catch(() => null),
          ]);
          if (qUid && !qUid.empty) {
            const d = qUid.docs[0];
            const data = d.data();
            if (data?.role !== 'student') candidateDocs.push({ id: d.id, ...data });
          }
          if (qAuthUid && !qAuthUid.empty) {
            const d = qAuthUid.docs[0];
            const data = d.data();
            if (data?.role !== 'student') candidateDocs.push({ id: d.id, ...data });
          }
        }
      }

      if (candidatePublicId) {
        const [uPubSnap, tPubSnap, uDocSnap, tDocSnap] = await Promise.all([
          db.collection('users').where('publicTutorId', '==', candidatePublicId).get().catch(() => null),
          db.collection('tutors').where('publicTutorId', '==', candidatePublicId).get().catch(() => null),
          db.collection('users').doc(candidatePublicId).get().catch(() => null),
          db.collection('tutors').doc(candidatePublicId).get().catch(() => null),
        ]);
        if (uPubSnap) uPubSnap.forEach((d) => { const data = d.data(); if (data && (data.role === 'teacher' || data.role === 'tutor' || data.role === 'native_friend') && data.role !== 'student') candidateDocs.push({ id: d.id, ...data }); });
        if (tPubSnap) tPubSnap.forEach((d) => { const data = d.data(); if (data?.role !== 'student') candidateDocs.push({ id: d.id, ...data }); });
        if (uDocSnap && uDocSnap.exists) { const data = uDocSnap.data(); if (data && (data.role === 'teacher' || data.role === 'tutor' || data.role === 'native_friend') && data.role !== 'student') candidateDocs.push({ id: uDocSnap.id, ...data }); }
        if (tDocSnap && tDocSnap.exists) { const data = tDocSnap.data(); if (data?.role !== 'student') candidateDocs.push({ id: tDocSnap.id, ...data }); }
      }

      if (candidateEmail) {
        const [uEmSnap, tEmSnap] = await Promise.all([
          db.collection('users').where('email', '==', candidateEmail).get().catch(() => null),
          db.collection('tutors').where('email', '==', candidateEmail).get().catch(() => null),
        ]);
        if (uEmSnap) {
          for (const d of uEmSnap.docs) {
            const data = d.data();
            if (data?.role === 'student') {
              console.warn(`[resolveTeacherCanonicalIdentity] Email ${candidateEmail} is canonically registered as student in users/${d.id}. Rejecting teacher resolution.`);
              return null;
            }
            if (data && (data.role === 'teacher' || data.role === 'tutor' || data.role === 'native_friend')) {
              candidateDocs.push({ id: d.id, ...data });
            }
          }
        }
        if (tEmSnap) tEmSnap.forEach((d) => { const data = d.data(); if (data?.role !== 'student') candidateDocs.push({ id: d.id, ...data }); });
      }

      if (candidateName && candidateDocs.length === 0) {
        const rawGivenName = String((target as any)?.teacherName || (target as any)?.selectedTutorName || (target as any)?.name || candidateName).trim();
        const candidateNames = Array.from(new Set([rawGivenName, candidateName].filter(Boolean)));
        for (const nm of candidateNames) {
          const [uNameSnap, tNameSnap] = await Promise.all([
            db.collection('users').where('name', '==', nm).get().catch(() => null),
            db.collection('tutors').where('name', '==', nm).get().catch(() => null),
          ]);
          if (uNameSnap) uNameSnap.forEach((d) => { const data = d.data(); if (data && (data.role === 'teacher' || data.role === 'tutor' || data.role === 'native_friend') && data.role !== 'student') candidateDocs.push({ id: d.id, ...data }); });
          if (tNameSnap) tNameSnap.forEach((d) => { const data = d.data(); if (data?.role !== 'student') candidateDocs.push({ id: d.id, ...data }); });
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
        if (!item || item.role === 'student') continue;
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

  if (!resolvedUid && candidateUid && isValidCanonicalUid(candidateUid)) {
    resolvedUid = candidateUid;
  }

  if (!resolvedUid || !isValidCanonicalUid(resolvedUid)) {
    return null;
  }

  // Rule 1, 2 & 4: Strict canonical verification against Firestore users/{resolvedUid}
  if (db) {
    try {
      const canonicalUserSnap = await db.collection('users').doc(resolvedUid).get().catch(() => null);
      if (canonicalUserSnap && canonicalUserSnap.exists) {
        const canonicalRole = (canonicalUserSnap.data()?.role || canonicalUserSnap.data()?.userRole || '').toLowerCase();
        if (canonicalRole === 'student') {
          console.warn(`[resolveTeacherCanonicalIdentity] Account ${resolvedUid} is canonically a student in users/{uid}. Refusing teacher resolution.`);
          return null;
        }
        if (canonicalRole !== 'teacher' && canonicalRole !== 'native_friend' && canonicalRole !== 'tutor') {
          console.warn(`[resolveTeacherCanonicalIdentity] Account ${resolvedUid} has non-teacher canonical role '${canonicalRole}'.`);
          return null;
        }
      } else {
        // Teacher without users/{resolvedUid} doc: verify canonical record in tutors/{resolvedUid}
        const tutorSnap = await db.collection('tutors').doc(resolvedUid).get().catch(() => null);
        let confirmedInTutors = Boolean(
          tutorSnap && tutorSnap.exists && (tutorSnap.data()?.role !== 'student') &&
          (tutorSnap.data()?.approvalStatus === 'approved' || tutorSnap.data()?.status === 'approved') &&
          (tutorSnap.data()?.isApproved === true || tutorSnap.data()?.approved === true)
        );
        if (!confirmedInTutors) {
          const qTutorUid = await db.collection('tutors').where('uid', '==', resolvedUid).limit(1).get().catch(() => null);
          if (qTutorUid && !qTutorUid.empty) {
            const tDoc = qTutorUid.docs[0].data();
            if ((tDoc?.approvalStatus === 'approved' || tDoc?.status === 'approved') && (tDoc?.isApproved === true || tDoc?.approved === true) && tDoc?.role !== 'student') {
              confirmedInTutors = true;
            }
          }
        }
        if (!confirmedInTutors) {
          const qTutorAuthUid = await db.collection('tutors').where('authUid', '==', resolvedUid).limit(1).get().catch(() => null);
          if (qTutorAuthUid && !qTutorAuthUid.empty) {
            const tDoc = qTutorAuthUid.docs[0].data();
            if ((tDoc?.approvalStatus === 'approved' || tDoc?.status === 'approved') && (tDoc?.isApproved === true || tDoc?.approved === true) && tDoc?.role !== 'student') {
              confirmedInTutors = true;
            }
          }
        }
        if (!confirmedInTutors) {
          const dbState = (target && typeof target === 'object' && (target as any).dbState) || null;
          const allMemoryTutors = [...(dbState?.tutorsList || []), ...(dbState?.teachers || [])];
          const memoryTeacher = allMemoryTutors.find(
            (t: any) =>
              t &&
              (t.uid === resolvedUid || t.authUid === resolvedUid || t.id === resolvedUid || (t.email || '').toLowerCase() === email) &&
              t.role !== 'student' &&
              (t.approvalStatus === 'approved' || t.status === 'approved') &&
              (t.isApproved === true || t.approved === true)
          );
          if (!memoryTeacher) {
            console.warn(`[resolveTeacherCanonicalIdentity] Canonical profile users/${resolvedUid} does not exist and no approved tutors record was found. Blocking unverified teacher resolution.`);
            return null;
          }
        }
      }
    } catch (fsErr) {
      console.warn(`[resolveTeacherCanonicalIdentity] Error inspecting canonical user profile:`, fsErr);
      return null;
    }
  }

  // Check in-memory dbState if provided to guarantee no student is promoted
  const dbState = (target && typeof target === 'object' && (target as any).dbState) || null;
  if (dbState) {
    try {
      const allMemoryTutors = [...(dbState.tutorsList || []), ...(dbState.teachers || [])];
      const isMemoryApprovedTeacher = allMemoryTutors.some(
        (t: any) =>
          t &&
          (t.uid === resolvedUid || t.authUid === resolvedUid || t.id === resolvedUid || (t.email || '').toLowerCase() === email) &&
          t.role !== 'student' &&
          (t.role === 'teacher' || t.role === 'native_friend' || t.role === 'tutor' || !t.role || t.isTeacher === true) &&
          (t.approvalStatus === 'approved' || t.status === 'approved') &&
          (t.isApproved === true || t.approved === true)
      );
      const isLocalStudent = !isMemoryApprovedTeacher && (
        (dbState.students || []).some((s: any) => (s.uid === resolvedUid || (s.email || '').toLowerCase() === email)) ||
        (dbState.userProfiles && Object.entries(dbState.userProfiles).some(([k, p]: any) => (p?.uid === resolvedUid || k.toLowerCase() === email) && p?.role === 'student')) ||
        (dbState.authUsers && Object.entries(dbState.authUsers).some(([k, u]: any) => (u?.uid === resolvedUid || k.toLowerCase() === email) && u?.role === 'student'))
      );
      if (isLocalStudent) {
        console.warn(`[resolveTeacherCanonicalIdentity] Account ${resolvedUid} is registered as student in memory dbState. Blocking teacher resolution.`);
        return null;
      }
    } catch (memErr) {
      console.warn(`[resolveTeacherCanonicalIdentity] Skipping memory dbState inspection due to read error:`, memErr);
    }
  }

  const isApproved = Boolean(
    (consolidated?.role === 'teacher' || consolidated?.role === 'native_friend' || consolidated?.role === 'tutor' || consolidated?.isTeacher === true) &&
    (consolidated?.approvalStatus === 'approved' || consolidated?.isApproved === true || consolidated?.status === 'approved' || consolidated?.approved === true)
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

export interface CanonicalIdentityResolutionResult {
  role: 'student' | 'teacher' | 'admin' | 'pending_teacher' | 'conflict' | 'unregistered';
  identityStatus: 'authorized' | 'pending_approval' | 'conflict' | 'unregistered' | 'divergent_uid';
  uid: string;
  email?: string;
  name?: string;
  approvalStatus?: 'approved' | 'pending' | 'rejected' | null;
  publicTutorId?: string;
  isApproved?: boolean;
  message?: string;
  rawDoc?: any;
}

/**
 * FASE IDENTITY-CRITICAL.2: Resolução Canônica e Autoritativa de Identidade.
 * UID verificado do Firebase Authentication é a chave canônica única.
 * Inspeciona users/{auth.uid} e o registro tutors comprovadamente vinculado ao mesmo UID.
 * Reconhece teacher somente se o vínculo for inequívoco, aprovado e ativo, sem conflitos.
 * Na existência de conflito ou divergência de UID, retorna estado explícito pendente/conflito
 * sem assumir automaticamente student e sem promover a teacher.
 */
export async function resolveCanonicalUserRoleAndIdentity(params: {
  uid: string;
  email?: string;
  tokenRole?: string;
  dbState?: any;
}): Promise<CanonicalIdentityResolutionResult> {
  const { uid, email, tokenRole, dbState } = params;
  const cleanUid = (uid || '').trim();
  const cleanEmail = (email || '').trim().toLowerCase();

  // 1. Princípio de Identidade: UID canônico é a chave obrigatória
  if (!cleanUid || !isValidCanonicalUid(cleanUid)) {
    return {
      role: 'unregistered',
      identityStatus: 'unregistered',
      uid: cleanUid,
      email: cleanEmail,
      message: 'UID canônico inválido ou ausente.',
    };
  }

  const db = getFirestoreDb();

  // 2. Resolução de Administrador
  const isServerAdmin =
    tokenRole === 'admin' ||
    (dbState?.teachers || []).some(
      (t: any) => t.role === 'admin' && (t.uid === cleanUid || t.id === cleanUid)
    );

  if (isServerAdmin) {
    if (db) {
      try {
        const uSnap = await db.collection('users').doc(cleanUid).get().catch(() => null);
        if (uSnap && uSnap.exists) {
          const uRole = (uSnap.data()?.role || uSnap.data()?.userRole || '').toLowerCase().trim();
          if (uRole === 'student') {
            console.warn(`[resolveCanonicalUserRoleAndIdentity] Inconsistência: admin claim vs student em users/${cleanUid}.`);
            return {
              role: 'conflict',
              identityStatus: 'conflict',
              uid: cleanUid,
              email: cleanEmail,
              message: 'Inconsistência de identidade detectada: credencial administrativa em conta de aluno.',
            };
          }
        }
      } catch {}
    }
    return {
      role: 'admin',
      identityStatus: 'authorized',
      uid: cleanUid,
      email: cleanEmail,
      name: 'Admin',
    };
  }

  // 3. Verificação de UID Divergente: Documento com mesmo e-mail mas UID divergente
  if (cleanEmail && db) {
    try {
      const qEmail = await db.collection('users').where('email', '==', cleanEmail).get().catch(() => null);
      if (qEmail && !qEmail.empty) {
        for (const docSnap of qEmail.docs) {
          const dData = docSnap.data();
          const docStoredUid = dData?.uid || dData?.id || docSnap.id;
          if (docStoredUid && isValidCanonicalUid(docStoredUid) && docStoredUid !== cleanUid) {
            console.warn(`[resolveCanonicalUserRoleAndIdentity] Divergent UID detected in users: doc ${docSnap.id} has uid ${docStoredUid} vs authenticated ${cleanUid}`);
            return {
              role: 'conflict',
              identityStatus: 'divergent_uid',
              uid: cleanUid,
              email: cleanEmail,
              message: 'Perfil com UID divergente detectado. Operação suspensa para reconciliação.',
            };
          }
        }
      }

      const qTutorEmail = await db.collection('tutors').where('email', '==', cleanEmail).get().catch(() => null);
      if (qTutorEmail && !qTutorEmail.empty) {
        for (const docSnap of qTutorEmail.docs) {
          const dData = docSnap.data();
          const docStoredUid = dData?.uid || dData?.authUid;
          if (docStoredUid && isValidCanonicalUid(docStoredUid) && docStoredUid !== cleanUid) {
            console.warn(`[resolveCanonicalUserRoleAndIdentity] Divergent UID detected in tutors: doc ${docSnap.id} has uid ${docStoredUid} vs authenticated ${cleanUid}`);
            return {
              role: 'conflict',
              identityStatus: 'divergent_uid',
              uid: cleanUid,
              email: cleanEmail,
              message: 'Perfil de tutor com UID divergente detectado. Operação suspensa para reconciliação.',
            };
          }
        }
      }
    } catch (e) {
      console.warn('[resolveCanonicalUserRoleAndIdentity] Notice checking divergent UID:', e);
    }
  }

  // Verificação de UID divergente em memória
  if (cleanEmail && dbState) {
    const allMemoryTutors = [...(dbState.tutorsList || []), ...(dbState.teachers || [])];
    const divergentMemTutor = allMemoryTutors.find(
      (t: any) =>
        t &&
        (t.email || '').toLowerCase() === cleanEmail &&
        (t.uid || t.authUid) &&
        (t.uid !== cleanUid && t.authUid !== cleanUid)
    );
    if (divergentMemTutor) {
      return {
        role: 'conflict',
        identityStatus: 'divergent_uid',
        uid: cleanUid,
        email: cleanEmail,
        message: 'Perfil com UID divergente detectado em memória. Operação suspensa para reconciliação.',
      };
    }
  }

  // 4. Inspeção autoritativa pontual em users/{cleanUid} e registro tutors vinculado ao mesmo UID
  let userData: any = null;
  let linkedTutorData: any = null;

  if (db) {
    try {
      // 4.1 Inspecionar users/{cleanUid}
      const userSnap = await db.collection('users').doc(cleanUid).get().catch(() => null);
      if (userSnap && userSnap.exists) {
        userData = userSnap.data();
      }

      // 4.2 Inspecionar tutors/{cleanUid}
      const tutorSnap = await db.collection('tutors').doc(cleanUid).get().catch(() => null);
      if (tutorSnap && tutorSnap.exists) {
        linkedTutorData = { id: tutorSnap.id, ...tutorSnap.data() };
      }

      // 4.3 Inspecionar tutors where uid == cleanUid
      if (!linkedTutorData) {
        const qUid = await db.collection('tutors').where('uid', '==', cleanUid).limit(1).get().catch(() => null);
        if (qUid && !qUid.empty) {
          linkedTutorData = { id: qUid.docs[0].id, ...qUid.docs[0].data() };
        }
      }

      // 4.4 Inspecionar tutors where authUid == cleanUid
      if (!linkedTutorData) {
        const qAuthUid = await db.collection('tutors').where('authUid', '==', cleanUid).limit(1).get().catch(() => null);
        if (qAuthUid && !qAuthUid.empty) {
          linkedTutorData = { id: qAuthUid.docs[0].id, ...qAuthUid.docs[0].data() };
        }
      }
    } catch (fsErr) {
      console.warn('[resolveCanonicalUserRoleAndIdentity] Notice querying Firestore identity:', fsErr);
    }
  }

  // Fallback para memória em dbState se Firestore não estiver instanciado ou em ambiente de teste isolado
  if (!userData && dbState) {
    const memStudent = (dbState.students || []).find(
      (s: any) => (s.uid === cleanUid || s.id === cleanUid || (s.email || s.studentEmail || '').toLowerCase() === cleanEmail)
    );
    if (memStudent) {
      userData = { ...memStudent, role: 'student' };
    } else {
      const memProfile = dbState.userProfiles?.[cleanEmail] || (cleanUid && Object.values(dbState.userProfiles || {}).find((p: any) => p?.uid === cleanUid));
      if (memProfile && (memProfile.role === 'student' || !memProfile.role)) {
        userData = { ...memProfile, role: 'student' };
      }
    }
  }

  if (!linkedTutorData && dbState) {
    const allMemoryTutors = [...(dbState.tutorsList || []), ...(dbState.teachers || [])];
    const memTutor = allMemoryTutors.find(
      (t: any) =>
        t &&
        (t.uid === cleanUid || t.authUid === cleanUid || (t.id === cleanUid && isValidCanonicalUid(t.id))) &&
        t.role !== 'student'
    );
    if (memTutor) {
      linkedTutorData = memTutor;
    }
  }

  const userRole = (userData?.role || userData?.userRole || '').toLowerCase().trim();
  const tutorRole = (linkedTutorData?.role || (linkedTutorData?.isTeacher ? 'teacher' : '')).toLowerCase().trim();

  const isTokenTeacher = tokenRole === 'teacher';

  const isUserApprovedTeacher = Boolean(
    userData &&
    (userRole === 'teacher' || userRole === 'native_friend' || userRole === 'tutor') &&
    (userData.approvalStatus === 'approved' || userData.status === 'approved') &&
    (userData.isApproved === true || userData.approved === true)
  );

  const hasValidTutorProfileRole = Boolean(
    linkedTutorData &&
    tutorRole !== 'student' &&
    (tutorRole === 'teacher' || tutorRole === 'native_friend' || tutorRole === 'tutor' || !tutorRole || linkedTutorData.isTeacher === true)
  );

  const isTutorApproved = Boolean(
    (hasValidTutorProfileRole &&
      (linkedTutorData.approvalStatus === 'approved' || linkedTutorData.status === 'approved') &&
      (linkedTutorData.isApproved === true || linkedTutorData.approved === true)) ||
    (isTokenTeacher && (!linkedTutorData || linkedTutorData.approvalStatus !== 'pending'))
  );

  const isTutorPending = Boolean(
    (linkedTutorData &&
      !isTutorApproved &&
      (linkedTutorData.approvalStatus === 'pending' || linkedTutorData.isApproved === false || linkedTutorData.status === 'pending')) ||
    (userData &&
      !isUserApprovedTeacher &&
      !isTutorApproved &&
      (userRole === 'teacher' || userRole === 'native_friend' || userRole === 'tutor') &&
      (userData.approvalStatus === 'pending' || userData.isApproved === false || userData.status === 'pending'))
  );

  // 5. Conflito de Identidade: Registro em users/{uid} como student mas aprovado em tutors
  if (userData && userRole === 'student') {
    if (isTutorApproved || isTokenTeacher) {
      console.warn(`[resolveCanonicalUserRoleAndIdentity] Conflito de identidade detectado para ${cleanUid}: aluno em users vs professor aprovado em tutors.`);
      return {
        role: 'conflict',
        identityStatus: 'conflict',
        uid: cleanUid,
        email: cleanEmail,
        message: 'Conflito de identidade não resolvido entre perfil de aluno e tutor aprovado.',
        rawDoc: { user: userData, tutor: linkedTutorData },
      };
    }
    // Aluno legítimo com documento residual ou não-aprovado em tutors -> Permanece student sem promoção
    return {
      role: 'student',
      identityStatus: 'authorized',
      uid: cleanUid,
      email: userData.email || cleanEmail,
      name: userData.name || cleanEmail.split('@')[0],
      rawDoc: userData,
    };
  }

  // 6. Professor Aprovado com vínculo inequívoco ao UID autenticado
  if (isUserApprovedTeacher || isTutorApproved || isTokenTeacher) {
    const effectiveTutorDoc = linkedTutorData || userData;
    const name = effectiveTutorDoc?.name || userData?.name || 'Native Friend';
    const publicTutorId =
      effectiveTutorDoc?.publicTutorId ||
      effectiveTutorDoc?.id ||
      cleanUid;

    return {
      role: 'teacher',
      identityStatus: 'authorized',
      uid: cleanUid,
      email: effectiveTutorDoc?.email || userData?.email || cleanEmail,
      name,
      publicTutorId,
      approvalStatus: 'approved',
      isApproved: true,
      rawDoc: effectiveTutorDoc,
    };
  }

  // 7. Conta de tutor ainda não aprovada (sem privilégios de professor)
  if (isTutorPending) {
    return {
      role: 'pending_teacher',
      identityStatus: 'pending_approval',
      uid: cleanUid,
      email: linkedTutorData?.email || cleanEmail,
      name: linkedTutorData?.name,
      approvalStatus: 'pending',
      isApproved: false,
      message: 'Seu cadastro de Amigo Nativo está em análise e aguarda aprovação da administração.',
      rawDoc: linkedTutorData,
    };
  }

  // 7.1 Aluno autenticado com custom claim ou papel verificado de student no token Firebase
  if (tokenRole === 'student' && !isTutorApproved && !isUserApprovedTeacher) {
    return {
      role: 'student',
      identityStatus: 'authorized',
      uid: cleanUid,
      email: cleanEmail,
      name: userData?.name || cleanEmail.split('@')[0],
      rawDoc: userData || { uid: cleanUid, email: cleanEmail, role: 'student' },
    };
  }

  // 8. Aluno registrado em dbState em memória
  if (dbState) {
    const memoryStudent = (dbState.students || []).find(
      (s: any) => s.uid === cleanUid || (s.email || s.studentEmail || '').toLowerCase() === cleanEmail
    );
    if (memoryStudent) {
      return {
        role: 'student',
        identityStatus: 'authorized',
        uid: cleanUid,
        email: memoryStudent.email || cleanEmail,
        name: memoryStudent.name || cleanEmail.split('@')[0],
        rawDoc: memoryStudent,
      };
    }
  }

  // 9. Perfil ausente na base canônica (NUNCA assume student como fallback silencioso)
  return {
    role: 'unregistered',
    identityStatus: 'unregistered',
    uid: cleanUid,
    email: cleanEmail,
    message: 'Perfil não encontrado na base canônica.',
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
    const approvalStatus = tutor.approvalStatus === 'approved' ? 'approved' : (tutor.approvalStatus || 'pending');
    const isApproved = Boolean(approvalStatus === 'approved' && tutor.isApproved === true);

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

    // Rule 1, 2, 3 & 4: Check if account is a student in users/{canonicalAuthUid}
    const uSnap = await db.collection('users').doc(canonicalAuthUid).get().catch(() => null);
    if (uSnap && uSnap.exists) {
      const uData = uSnap.data();
      const currentRole = (uData?.role || uData?.userRole || '').toLowerCase();
      if (currentRole === 'student') {
        const errorMsg = `[saveTutorToFirestore] Account '${canonicalAuthUid}' is canonically registered as student in users/{uid}. Refusing to overwrite role with teacher.`;
        console.error(errorMsg);
        throw new Error(errorMsg);
      }
    }

    // Exclusively write catalog profile to tutors/{canonicalAuthUid}.
    // Only write role: 'teacher' to users/{canonicalAuthUid} if legitimately approved by admin.
    const writePromises: Promise<any>[] = [
      db.collection('tutors').doc(canonicalAuthUid).set(sanitized, { merge: true }),
    ];

    if (isApproved) {
      writePromises.push(db.collection('users').doc(canonicalAuthUid).set(sanitized, { merge: true }));
    } else {
      // For pending or unapproved tutors, ensure users/{canonicalAuthUid} does NOT receive elevated role
      if (uSnap && uSnap.exists) {
        const pendingUserUpdate = { ...sanitized, role: uSnap.data()?.role || 'student' };
        writePromises.push(db.collection('users').doc(canonicalAuthUid).set(pendingUserUpdate, { merge: true }));
      }
    }

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
      .filter((t) => t.approvalStatus === 'approved' && t.isApproved === true)
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
  } catch (err: any) {
    if (isPermissionError(err)) {
      isCloudWriteDisabled = true;
      console.info('[serverFirestore] Remote tutor delete restricted by cloud IAM credentials, continuing with local state.');
      return false;
    }
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

    const fetchTutorsStatus = async (): Promise<{ ok: boolean; tutors: any[] }> => {
      try {
        const tutors = await fetchTutorsFromFirestore();
        return { ok: true, tutors: Array.isArray(tutors) ? tutors : [] };
      } catch {
        return { ok: false, tutors: [] };
      }
    };

    const fetchAllPromise = Promise.all([
      fetchDoc('main_data'),
      fetchDoc('routines'),
      fetchDoc('tutors'),
      fetchDoc('assignments'),
      fetchDoc('lessons'),
      fetchDoc('youtube_playlists'),
      fetchTutorsStatus(),
      fetchUsersFromFirestoreCanonical(),
    ]).then(([mainData, routines, tutors, assignments, lessons, ytPlaylists, directTutorsResult, directUsersResult]) => {
      const directTutors = directTutorsResult.tutors;
      const directUsers = directUsersResult.users;

      if (
        !mainData &&
        !routines &&
        !tutors &&
        !assignments &&
        !lessons &&
        !ytPlaylists &&
        directTutors.length === 0 &&
        directUsers.length === 0
      ) {
        return null;
      }

      // ARCH.2A: Canonical persistence strictly in (default) /users and /tutors.
      // Never reconstruct userProfiles, authUsers, or students from unconfirmed app_state/main_data caches
      // or isolated activity maps (studentRoutinesMap, studentVideoAssignments, studentSpotifyAssignments, studentWeeklyChecks).
      const mergedUserProfiles: Record<string, any> = {};
      const mergedAuthUsers: Record<string, any> = {};
      const studentMap = new Map<string, any>();

      const legacyProfilesMap = (mainData?.userProfiles && typeof mainData.userProfiles === 'object') ? mainData.userProfiles : {};
      const legacyStudentsByEmail = new Map<string, any>();
      if (Array.isArray(mainData?.students)) {
        mainData.students.forEach((s: any) => {
          const sKey = (s?.studentEmail || s?.email || '').toLowerCase().trim();
          if (sKey) legacyStudentsByEmail.set(sKey, s);
        });
      }

      if (directUsersResult.ok) {
        directUsers.forEach((u: any) => {
          const key = (u.email || '').toLowerCase().trim();
          if (!key) return;

          const canonicalUid =
            (u.uid && isValidCanonicalUid(u.uid))
              ? u.uid
              : (u.id && isValidCanonicalUid(u.id) ? u.id : null);
          if (!canonicalUid) return;

          const uRole = (u.role || u.userRole || '').toLowerCase().trim();

          // Optional enrichment from main_data ONLY when canonical /users doc exists and UID is compatible
          const rawLegacyProfile = legacyProfilesMap[key];
          const legacyProfUid = rawLegacyProfile?.uid || rawLegacyProfile?.id;
          const isLegacyProfCompatible =
            rawLegacyProfile &&
            typeof rawLegacyProfile === 'object' &&
            (!legacyProfUid || !isValidCanonicalUid(legacyProfUid) || legacyProfUid === canonicalUid);

          if (uRole !== 'teacher' && uRole !== 'tutor' && uRole !== 'native_friend') {
            mergedUserProfiles[key] = {
              ...(isLegacyProfCompatible ? rawLegacyProfile : {}),
              ...u,
              id: canonicalUid,
              uid: canonicalUid,
              name: u.name || (isLegacyProfCompatible ? rawLegacyProfile?.name : undefined) || key.split('@')[0],
              email: key,
              level: u.level || u.englishLevel || (isLegacyProfCompatible ? rawLegacyProfile?.level : undefined) || 'iniciante',
              enrollmentStatus: u.enrollmentStatus || (isLegacyProfCompatible ? rawLegacyProfile?.enrollmentStatus : undefined) || 'active',
              learningGoal: u.learningGoal || u.goal || (isLegacyProfCompatible ? rawLegacyProfile?.learningGoal : undefined) || 'English for everyday life & work',
              weeklyStudyDaysTarget: u.weeklyStudyDaysTarget ?? (isLegacyProfCompatible ? rawLegacyProfile?.weeklyStudyDaysTarget : undefined) ?? 7,
              weeklyStudyDays: u.weeklyStudyDays || (isLegacyProfCompatible ? rawLegacyProfile?.weeklyStudyDays : undefined) || ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
              createdAt: u.createdAt || (isLegacyProfCompatible ? rawLegacyProfile?.createdAt : undefined) || new Date().toISOString(),
            };
          } else {
            mergedUserProfiles[key] = {
              ...u,
              id: canonicalUid,
              uid: canonicalUid,
              email: key,
              role: uRole || 'teacher',
            };
          }

          mergedAuthUsers[key] = {
            uid: canonicalUid,
            id: canonicalUid,
            email: key,
            name: u.name || key.split('@')[0],
            role: uRole || 'student',
            createdAt: u.createdAt || new Date().toISOString(),
          };

          if (uRole === 'student' || !uRole) {
            const rawLegacyStudent = legacyStudentsByEmail.get(key);
            const legacyStudentUid = rawLegacyStudent?.uid || rawLegacyStudent?.studentUid || rawLegacyStudent?.id;
            const isLegacyStudentCompatible =
              rawLegacyStudent &&
              typeof rawLegacyStudent === 'object' &&
              (!legacyStudentUid || !isValidCanonicalUid(legacyStudentUid) || legacyStudentUid === canonicalUid);

            studentMap.set(key, {
              ...(isLegacyStudentCompatible ? rawLegacyStudent : {}),
              ...u,
              id: canonicalUid,
              studentUid: canonicalUid,
              uid: canonicalUid,
              name: u.name || (isLegacyStudentCompatible ? (rawLegacyStudent?.name || rawLegacyStudent?.studentName) : undefined) || key.split('@')[0],
              studentName: u.name || (isLegacyStudentCompatible ? (rawLegacyStudent?.studentName || rawLegacyStudent?.name) : undefined) || key.split('@')[0],
              email: key,
              studentEmail: key,
              level: u.level || u.englishLevel || (isLegacyStudentCompatible ? (rawLegacyStudent?.level || rawLegacyStudent?.studentLevel) : undefined) || 'iniciante',
              studentLevel: u.level || u.englishLevel || (isLegacyStudentCompatible ? (rawLegacyStudent?.studentLevel || rawLegacyStudent?.level) : undefined) || 'iniciante',
              goal: u.learningGoal || u.goal || (isLegacyStudentCompatible ? (rawLegacyStudent?.goal || rawLegacyStudent?.learningGoal) : undefined) || 'English for everyday life & work',
              learningGoal: u.learningGoal || u.goal || (isLegacyStudentCompatible ? (rawLegacyStudent?.learningGoal || rawLegacyStudent?.goal) : undefined) || 'English for everyday life & work',
              contractedLessons: u.contractedLessons ?? (isLegacyStudentCompatible ? rawLegacyStudent?.contractedLessons : undefined) ?? 5,
              completedLessonsCount: u.completedLessonsCount ?? (isLegacyStudentCompatible ? rawLegacyStudent?.completedLessonsCount : undefined) ?? 0,
              status: u.status || 'active',
              activeSince: (u.createdAt || new Date().toISOString()).split('T')[0],
              createdAt: u.createdAt || new Date().toISOString(),
            });
          }
        });
      }

      // Preserve legitimate administrators configured in teachers (with valid canonical UID)
      const confirmedAdminTeachers = Array.isArray(tutors?.teachers)
        ? tutors.teachers.filter((t: any) => {
            if (!t || t.role !== 'admin') return false;
            const adminUid = t.uid || t.id;
            return Boolean(adminUid && isValidCanonicalUid(adminUid));
          })
        : [];

      confirmedAdminTeachers.forEach((adminTeacher: any) => {
        const key = (adminTeacher.email || '').toLowerCase().trim();
        const adminUid = (adminTeacher.uid || adminTeacher.id).trim();
        if (key && !mergedAuthUsers[key]) {
          mergedAuthUsers[key] = {
            uid: adminUid,
            id: adminUid,
            email: key,
            name: adminTeacher.name || 'Admin',
            role: 'admin',
            createdAt: adminTeacher.createdAt || new Date().toISOString(),
          };
        }
      });

      const hydratedMainData = {
        ...(mainData || {}),
        userProfiles: mergedUserProfiles,
        authUsers: mergedAuthUsers,
        students: Array.from(studentMap.values()),
      };

      // Canonical consolidation of tutors strictly anchored in /tutors and /users (role=='teacher').
      // app_state/tutors entries without canonical confirmation in directTutors are never resurrected.
      const stateTutors = Array.isArray(tutors?.tutorsList) ? tutors.tutorsList : [];
      const confirmedStateTutors = directTutorsResult.ok
        ? stateTutors.filter((st: any) => {
            const stEmail = (st?.email || '').toLowerCase().trim();
            const stUid = (st?.authUid || st?.uid || st?.id || '').trim();
            return directTutors.some((dt: any) => {
              const dtEmail = (dt?.email || '').toLowerCase().trim();
              const dtUid = (dt?.authUid || dt?.uid || dt?.id || '').trim();
              return (stUid && dtUid && stUid === dtUid) || (stEmail && dtEmail && stEmail === dtEmail);
            });
          })
        : [];
      const consolidatedTutorsList = directTutorsResult.ok
        ? consolidateTutorsList([...confirmedStateTutors, ...directTutors])
        : [];

      const existingStateTeachers = Array.isArray(tutors?.teachers) ? tutors.teachers : [];
      const confirmedStateTeachers = existingStateTeachers.filter((tc: any) => {
        if (!tc) return false;
        if (tc.role === 'admin') {
          const adminUid = tc.uid || tc.id;
          return Boolean(adminUid && isValidCanonicalUid(adminUid));
        }
        if (!directTutorsResult.ok) return false;
        const tcEmail = (tc.email || '').toLowerCase().trim();
        const tcUid = (tc.authUid || tc.uid || tc.id || '').trim();
        return consolidatedTutorsList.some((dt: any) => {
          const dtEmail = (dt?.email || '').toLowerCase().trim();
          const dtUid = (dt?.authUid || dt?.uid || dt?.id || '').trim();
          return (tcUid && dtUid && tcUid === dtUid) || (tcEmail && dtEmail && tcEmail === dtEmail);
        });
      });

      const mergedTutorsDoc = {
        ...(tutors || {}),
        tutorsList: consolidatedTutorsList,
        teachers: confirmedStateTeachers,
      };

      const sanitizedMainData: Record<string, any> = { ...hydratedMainData };
      delete sanitizedMainData.liveLessons;
      delete sanitizedMainData.lessons;
      delete sanitizedMainData.scheduledLessons;

      const sanitizedLessonsDoc: Record<string, any> = lessons ? { ...lessons } : {};
      delete sanitizedLessonsDoc.liveLessons;
      delete sanitizedLessonsDoc.lessons;
      delete sanitizedLessonsDoc.scheduledLessons;

      return {
        ...sanitizedMainData,
        ...(routines || {}),
        ...mergedTutorsDoc,
        ...(assignments || {}),
        ...sanitizedLessonsDoc,
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
  if (isCloudWriteDisabled) return null;
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
  } catch (err: any) {
    if (isPermissionError(err)) {
      isCloudWriteDisabled = true;
      console.info('[serverFirestore] Remote YouTube playlists access restricted by cloud IAM credentials, continuing with local state.');
      return null;
    }
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
      contractedLessons: sanitized.contractedLessons || {},
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
    delete mainData.lessons;
    delete mainData.scheduledLessons;
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

    const tutorSavePromises = (Array.isArray(tutorsDocToWrite.tutorsList) ? tutorsDocToWrite.tutorsList : []).map(async (tut: any) => {
      if (tut && (tut.authUid || tut.uid || tut.id || tut.email)) {
        const cEmail = (tut.email || '').toLowerCase().trim();
        const candidateAuthUid = (tut.authUid && isValidCanonicalUid(tut.authUid) ? tut.authUid : null) ||
          (tut.uid && isValidCanonicalUid(tut.uid) ? tut.uid : null) ||
          (tut.id && isValidCanonicalUid(tut.id) ? tut.id : null);

        if (candidateAuthUid) {
          // Rule 1, 2, 3 & 4: Inspect canonical user document in users/{candidateAuthUid}
          const userSnap = await db.collection('users').doc(candidateAuthUid).get().catch(() => null);
          const existingUser = userSnap && userSnap.exists ? userSnap.data() : null;
          const canonicalRole = (existingUser?.role || existingUser?.userRole || '').toLowerCase();

          // STRICT RULE 4: If canonical user is a student, app_state/tutors sync MUST NEVER overwrite role or promote to teacher!
          if (canonicalRole === 'student') {
            console.warn(`[saveAppStateToFirestore] Skipping teacher role write for registered student ${candidateAuthUid} (${cEmail}) during tutors sync.`);
            return;
          }

          const nameSlug = tut.name && typeof tut.name === 'string' && !isGenericTutorId(tut.name)
            ? normalizeTutorName(tut.name).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
            : '';
          const publicTutorId =
            (tut.publicTutorId && !isGenericTutorId(tut.publicTutorId) ? tut.publicTutorId : null) ||
            (tut.id && !isValidCanonicalUid(tut.id) && !isGenericTutorId(tut.id) ? tut.id : null) ||
            (cEmail ? `tutor-${cEmail.replace(/[^a-zA-Z0-9]/g, '-')}` : null) ||
            (nameSlug && !isGenericTutorId(nameSlug) ? nameSlug : null) ||
            candidateAuthUid;

          // Rule 6: If canonical profile does not exist or user is not an approved teacher,
          // do NOT elevate or create users/{candidateAuthUid} with role 'teacher'!
          // Only sync public catalog data to tutors/{candidateAuthUid}.
          const isLegitimateTeacher = Boolean(
            existingUser &&
            canonicalRole === 'teacher' &&
            existingUser.approvalStatus === 'approved' &&
            existingUser.isApproved === true
          );

          const tutorDocData = {
            ...tut,
            id: candidateAuthUid,
            uid: candidateAuthUid,
            authUid: candidateAuthUid,
            publicTutorId,
            email: cEmail,
            role: 'teacher',
            approvalStatus: existingUser?.approvalStatus || tut.approvalStatus || 'pending',
            isApproved: Boolean(existingUser?.isApproved === true || tut.isApproved === true),
            updatedAt: tut.updatedAt || new Date().toISOString(),
          };
          delete tutorDocData.password;

          // Sync public catalog record in tutors/{candidateAuthUid}
          const pTutors = db.collection('tutors').doc(candidateAuthUid).set(tutorDocData, { merge: true }).catch(() => null);

          if (!isLegitimateTeacher) {
            // Non-teacher or unverified user: NEVER grant privileges in users/{candidateAuthUid}
            return pTutors;
          }

          // Legitimate approved teacher: sync tutor metadata to users/{candidateAuthUid} while preserving canonical role
          const teacherUserData = {
            ...tutorDocData,
            role: canonicalRole, // strictly preserve existing canonical role
            approvalStatus: existingUser?.approvalStatus || 'approved',
            isApproved: Boolean(existingUser?.isApproved),
          };
          const pUsers = db.collection('users').doc(candidateAuthUid).set(teacherUserData, { merge: true }).catch(() => null);
          return Promise.all([pTutors, pUsers]);
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

    // Identity Hardening: Prevent routine profile saves or client hydration from mutating established user roles
    try {
      const existingSnap = await db.collection('users').doc(docId).get();
      if (existingSnap && existingSnap.exists) {
        const existingData = existingSnap.data();
        if (existingData?.role) {
          sanitized.role = existingData.role;
          if (existingData.approvalStatus !== undefined) {
            sanitized.approvalStatus = existingData.approvalStatus;
          }
          if (existingData.isApproved !== undefined) {
            sanitized.isApproved = existingData.isApproved;
          }
        }
      }
    } catch {}

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

export async function fetchUsersFromFirestoreCanonical(): Promise<{ ok: boolean; users: any[] }> {
  const db = getFirestoreDb();
  if (!db) return { ok: false, users: [] };
  try {
    const fetchPromise = async () => {
      let queryError: any = null;
      const snap = await db.collection('users').get().catch((queryErr: any) => {
        queryError = queryErr;
        const isPerm =
          queryErr?.code === 7 ||
          queryErr?.code === 'permission-denied' ||
          String(queryErr?.message || '').includes('PERMISSION_DENIED') ||
          String(queryErr?.message || '').includes('Missing or insufficient permissions');
        if (isPerm) {
          console.info('[serverFirestore] Users collection read restricted by cloud IAM credentials.');
        } else {
          console.info('[serverFirestore] Users collection query notice:', queryErr?.message || String(queryErr));
        }
        return null;
      });
      if (!snap || queryError) return { ok: false, users: [] };
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
      return { ok: true, users: list };
    };
    const result = await withTimeout(fetchPromise(), 10000);
    return result || { ok: false, users: [] };
  } catch (err: any) {
    const isPerm =
      err?.code === 7 ||
      err?.code === 'permission-denied' ||
      String(err?.message || '').includes('PERMISSION_DENIED') ||
      String(err?.message || '').includes('Missing or insufficient permissions');
    if (isPerm) {
      console.info('[serverFirestore] Users collection read restricted by cloud IAM credentials.');
    } else {
      console.info('[serverFirestore] Users collection query notice:', err?.message || String(err));
    }
    return { ok: false, users: [] };
  }
}

export async function fetchUsersFromFirestore(): Promise<any[]> {
  const res = await fetchUsersFromFirestoreCanonical();
  return res.users;
}

export async function fetchUserFromFirestore(email: string, uid?: string): Promise<any | null> {
  const db = getFirestoreDb();
  if (!db || (!email && !uid)) return null;
  try {
    const cleanDocId = email ? email.toLowerCase().trim().replace(/[^a-zA-Z0-9]/g, '-') : '';
    const cleanEmail = email ? email.toLowerCase().trim() : '';

    const fetchPromise = (async () => {
      if (uid && isValidCanonicalUid(uid)) {
        const snapUid = await db.collection('users').doc(uid).get().catch(() => null);
        if (snapUid && snapUid.exists) return snapUid.data();
      }
      if (cleanDocId) {
        const snapEmail = await db.collection('users').doc(cleanDocId).get().catch(() => null);
        if (snapEmail && snapEmail.exists) {
          const data = snapEmail.data();
          // Rule D & 6: Legacy email-keyed doc cannot confer teacher privileges without UID verification
          if (data && (data.role === 'teacher' || data.role === 'native_friend') && uid && (data.uid ? data.uid !== uid : snapEmail.id !== uid)) {
            return { ...data, role: 'conflict', identityStatus: 'conflict' };
          }
          return data;
        }
      }
      if (cleanEmail) {
        try {
          const qSnap = await db.collection('users').where('email', '==', cleanEmail).get().catch(() => null);
          if (qSnap && !qSnap.empty) {
            const data = qSnap.docs[0].data();
            // Rule D & 6: Document found by email cannot confer teacher privileges over canonical UID
            if (data && (data.role === 'teacher' || data.role === 'native_friend') && uid && (data.uid ? data.uid !== uid : qSnap.docs[0].id !== uid)) {
              return { ...data, role: 'conflict', identityStatus: 'conflict' };
            }
            return data;
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

function extractYouTubeIdInternal(urlOrId: string | null | undefined): string | null {
  if (!urlOrId) return null;
  const clean = urlOrId.trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(clean)) return clean;
  const match = clean.match(
    /(?:youtube(?:-nocookie)?\.com\/(?:[^\/\n\s]+\/\S+\/|(?:v|e(?:mbed)?|shorts)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i
  );
  return match && match[1] && match[1].length === 11 ? match[1] : null;
}

function parsePositiveCycleInternal(raw: any): number | null {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw === 'number') {
    return Number.isFinite(raw) && Number.isSafeInteger(raw) && raw > 0 ? raw : null;
  }
  if (typeof raw === 'string') {
    const clean = raw.trim().toLowerCase().replace(/^week-/, '');
    if (!/^\d+$/.test(clean)) return null;
    const parsed = Number(clean);
    return Number.isFinite(parsed) && Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

function extractSpotifyTrackIdInternal(urlOrId: string | null | undefined): string | null {
  if (!urlOrId || typeof urlOrId !== 'string') return null;
  const clean = urlOrId.trim();
  if (!clean) return null;
  if (/^[a-zA-Z0-9]{15,35}$/.test(clean)) return clean;
  const webMatch = clean.match(
    /^(?:https?:\/\/)?(?:[a-zA-Z0-9-]+\.)*spotify\.com(?::\d+)?\/(?:intl-[a-z]{2,3}(?:-[a-z]{2,4})?\/)?(?:embed\/)?(?:track|episode|show|playlist|album)\/([a-zA-Z0-9]{15,35})(?:[?#].*)?$/i
  );
  if (webMatch && webMatch[1]) return webMatch[1];
  const uriMatch = clean.match(/^spotify:(?:track|episode|show|playlist|album):([a-zA-Z0-9]{15,35})$/i);
  if (uriMatch && uriMatch[1]) return uriMatch[1];
  if (/^[a-zA-Z0-9_-]{3,80}$/.test(clean) && !clean.includes('http')) return clean;
  return null;
}

/**
 * Persists daily routine video selection to users/{uid}/routines/{dayOfWeek}
 * and mirrors to users/{uid}.routinesByDay with strict active weekly cycle protection.
 */
export async function saveRoutineVideoSubcollection(
  uid: string,
  dayOfWeek: string,
  data: any,
  weeklyCycle?: number | string
): Promise<boolean> {
  if (isCloudWriteDisabled) return false;
  const db = getFirestoreDb();
  if (!db || !uid || !dayOfWeek) return false;
  const cleanDay = dayOfWeek.toLowerCase().trim();

  try {
    const userRef = db.collection('users').doc(uid);

    const passedCycle =
      parsePositiveCycleInternal(weeklyCycle) ??
      parsePositiveCycleInternal(data?.weeklyCycle);

    let canonicalUserCycle: number | null = null;
    const uSnap = await withTimeout(userRef.get(), 3500);
    if (uSnap && uSnap.exists) {
      const uData = uSnap.data();
      canonicalUserCycle = parsePositiveCycleInternal(uData?.weeklyCycle);
    }

    // ARCH.2E.2A Stale-Cycle Guard: never allow an older weekly cycle payload to overwrite the active cycle
    if (passedCycle !== null && canonicalUserCycle !== null && passedCycle < canonicalUserCycle) {
      console.warn(
        `[serverFirestore] Stale cycle write blocked for users/${uid}/routines/${cleanDay}: passed weeklyCycle=${passedCycle} < active weeklyCycle=${canonicalUserCycle}`
      );
      return false;
    }

    const targetCycle =
      canonicalUserCycle !== null
        ? Math.max(canonicalUserCycle, passedCycle ?? canonicalUserCycle)
        : (passedCycle ?? 1);

    const dayRef = userRef.collection('routines').doc(cleanDay);
    const dSnap = await withTimeout(dayRef.get(), 3500);
    const dData = dSnap && dSnap.exists ? (dSnap.data() || {}) : null;
    const existingDayCycle = parsePositiveCycleInternal(dData?.weeklyCycle);
    const isMigratingFromOlderCycle = existingDayCycle !== null && existingDayCycle < targetCycle;

    const firstVideo = (Array.isArray(data?.teacherVideos) && data.teacherVideos.length > 0) ? data.teacherVideos[0] : null;
    const rawVidId = data?.videoId ?? firstVideo?.videoId ?? firstVideo?.id ?? data?.url ?? firstVideo?.url ?? '';
    const cleanVidId = data?.videoId === ''
      ? ''
      : (extractYouTubeIdInternal(rawVidId) || (typeof rawVidId === 'string' && !rawVidId.startsWith('vid-') && !rawVidId.startsWith('act-') ? rawVidId : '')).trim();
    const cleanTitle = (data?.title || data?.videoTitle || firstVideo?.title || firstVideo?.videoTitle || (cleanVidId ? 'Daily Video Practice' : 'Video of the Day')).trim();
    const cleanUrl = data?.url !== undefined
      ? String(data.url || '')
      : (firstVideo?.url || (cleanVidId ? `https://www.youtube.com/watch?v=${cleanVidId}` : ''));
    const cleanPlaylistId = data?.playlistId ?? firstVideo?.playlistId ?? '';
    const cleanPlaylistTitle = data?.playlistTitle ?? firstVideo?.playlistTitle ?? (cleanPlaylistId === 'custom_suggestion' ? 'Your Suggestion' : '');
    const isRepeat = Boolean(data?.isRepeatVideo || firstVideo?.isRepeatVideo || cleanPlaylistId === 'repeat_previous_video');
    const isCustom = Boolean(data?.isCustomSuggestion || firstVideo?.isCustomSuggestion || cleanPlaylistId === 'custom_suggestion' || cleanPlaylistTitle === 'Your Suggestion' || cleanPlaylistTitle === 'Sua Sugestão');

    const olderCycleResetFields = isMigratingFromOlderCycle
      ? {
          teacherVideos: [],
          teacherSpotify: null,
          teacherOverrideTrack: null,
          teacherFeedback: null,
          teacherNotes: '',
          completed: false,
          completedToday: false,
          completedVideoToday: false,
          completedAudioToday: false,
          learnedWords: [],
        }
      : {};

    const sanitized = removeUndefinedFields({
      ...olderCycleResetFields,
      ...(data && typeof data === 'object' ? data : {}),
      id: data?.id || (cleanVidId ? `vid-${cleanVidId}` : `vid-${cleanDay}`),
      videoId: cleanVidId,
      title: cleanTitle,
      videoTitle: cleanTitle,
      url: cleanUrl,
      playlistId: cleanPlaylistId,
      playlistTitle: cleanPlaylistTitle,
      dayOfWeek: cleanDay,
      activityId: data?.activityId || 'act-1',
      isRepeatVideo: isRepeat,
      isCustomSuggestion: isCustom,
      instructions: data?.instructions ?? firstVideo?.instructions ?? '',
      duration: data?.duration ?? firstVideo?.duration ?? '5-10 min',
      weeklyCycle: targetCycle,
      updatedAt: data?.updatedAt || new Date().toISOString(),
    });

    const savePromise = dayRef.set(sanitized, { merge: !isMigratingFromOlderCycle }).then(() => true);
    const saveResult = await withTimeout(savePromise, 4500);
    if (!saveResult) return false;

    // Also mirror to user doc routinesByDay for instant multi-device hydration
    const rootSavePromise = userRef
      .set(
        {
          routinesByDay: {
            [cleanDay]: sanitized,
          },
          weeklyCycle: targetCycle,
          updatedAt: sanitized.updatedAt,
        },
        { merge: true }
      )
      .then(() => true);
    const rootResult = await withTimeout(rootSavePromise, 4500);

    return Boolean(saveResult && rootResult);
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

export interface CanonicalRoutineContext {
  uid: string;
  studentEmail: string;
  userProfile: Record<string, any> | null;
  activeCycle: number;
  level: string;
  studyDays: string[];
  routinesByDayRaw: Record<string, any>;
  videoAssignments: any[];
  spotifyAssignments: any[];
  spotifyCycles: Record<string, any>;
  listenedTracks: string[];
  listenedTracksHistory: any[];
  lastSpotifyDistributionAttempt: any | null;
  watchedVideosHistory: string[];
  awaitingTopicSelection: boolean;
  studentJournal: any[];
}

/**
 * ARCH.2E.2A: Resolves a student profile directly from Firestore (default) users/{uid} or users email query.
 */
export async function fetchStudentProfileFromFirestoreServer(
  uid?: string,
  email?: string
): Promise<{ uid: string; email: string; profile: Record<string, any> | null }> {
  const db = getFirestoreDb();
  const cleanUid = (uid || '').trim();
  const cleanEmail = (email || '').toLowerCase().trim();
  if (!db) return { uid: cleanUid, email: cleanEmail, profile: null };

  try {
    if (cleanUid && isValidCanonicalUid(cleanUid)) {
      const snap = await withTimeout(db.collection('users').doc(cleanUid).get(), 3500);
      if (snap && snap.exists) {
        const data = snap.data() || {};
        return {
          uid: cleanUid,
          email: (data.email || cleanEmail || '').toLowerCase().trim(),
          profile: { ...data, uid: cleanUid },
        };
      }
    }

    if (cleanEmail) {
      const qSnap = await withTimeout(db.collection('users').where('email', '==', cleanEmail).limit(1).get(), 3500);
      if (qSnap && !qSnap.empty) {
        const docSnap = qSnap.docs[0];
        const data = docSnap.data() || {};
        const resolvedUid = (data.uid && isValidCanonicalUid(data.uid) ? data.uid : (isValidCanonicalUid(docSnap.id) ? docSnap.id : cleanUid));
        return {
          uid: resolvedUid,
          email: cleanEmail,
          profile: { ...data, uid: resolvedUid },
        };
      }
    }
  } catch (err) {
    if (!isPermissionError(err)) {
      console.warn('[serverFirestore] fetchStudentProfileFromFirestoreServer error:', err);
    }
  }

  return { uid: cleanUid, email: cleanEmail, profile: null };
}

/**
 * ARCH.2E.2A: Canonical Firestore (default) reader for student routines, video assignments,
 * active weekly cycle, and watched video history. Never reads inMemoryDb or app_state caches.
 */
export async function fetchCanonicalRoutineContextServer(
  uid: string,
  requestedCycle?: number | string
): Promise<CanonicalRoutineContext | null> {
  const db = getFirestoreDb();
  if (!db || !uid) return null;

  const parsedRequestedCycle = parsePositiveCycleInternal(requestedCycle);
  const ALL_DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

  try {
    const userRef = db.collection('users').doc(uid);
    const assignRef = db.collection('student_assignments').doc(uid);

    const [userSnap, routinesSnap, assignSnap, activityJournalSnap] = await Promise.all([
      withTimeout(userRef.get(), 4500),
      withTimeout(userRef.collection('routines').get(), 4500),
      withTimeout(assignRef.get(), 4500),
      withTimeout(userRef.collection('activity_journal').get(), 4500).catch(() => null),
    ]);

    const uData = (userSnap && userSnap.exists ? userSnap.data() : null) || {};
    const aData = (assignSnap && assignSnap.exists ? assignSnap.data() : null) || {};

    const uCycle = parsePositiveCycleInternal(uData.weeklyCycle);
    const aCycle = parsePositiveCycleInternal(aData.weeklyCycle);

    let activeCycle = 1;
    if (uCycle !== null) {
      activeCycle = parsedRequestedCycle !== null ? Math.max(uCycle, parsedRequestedCycle) : uCycle;
    } else if (aCycle !== null) {
      activeCycle = parsedRequestedCycle !== null ? Math.max(aCycle, parsedRequestedCycle) : aCycle;
    } else if (parsedRequestedCycle !== null) {
      activeCycle = parsedRequestedCycle;
    }

    const routinesByDayRaw: Record<string, any> = {};
    if (uData.routinesByDay && typeof uData.routinesByDay === 'object') {
      for (const [day, item] of Object.entries(uData.routinesByDay)) {
        if (!item || typeof item !== 'object') continue;
        const rawItemCycle = parsePositiveCycleInternal((item as any).weeklyCycle);
        const itemCycle = rawItemCycle ?? activeCycle;
        if (itemCycle === activeCycle) {
          routinesByDayRaw[day] = { ...(item as any), dayOfWeek: day, weeklyCycle: activeCycle };
        }
      }
    }

    if (routinesSnap && !routinesSnap.empty) {
      routinesSnap.forEach((docSnap: any) => {
        const data = docSnap.data();
        if (!data) return;
        const day = docSnap.id;
        const rawDocCycle = parsePositiveCycleInternal(data.weeklyCycle);
        const docCycle = rawDocCycle ?? activeCycle;
        if (docCycle === activeCycle) {
          routinesByDayRaw[day] = {
            ...(routinesByDayRaw[day] || {}),
            ...data,
            dayOfWeek: day,
            weeklyCycle: activeCycle,
          };
        }
      });
    }

    const rawVideoAssigns: any[] = Array.isArray(aData.videoAssignments) ? aData.videoAssignments : [];
    const activeVideoAssigns = rawVideoAssigns.filter((a: any) => {
      if (!a || typeof a !== 'object') return false;
      const c = parsePositiveCycleInternal(a.weeklyCycle);
      return c === null || c === activeCycle;
    });

    // Reconcile per-day video data from subcollection into videoAssignments view if missing in student_assignments
    const assignByDay = new Map<string, any>();
    for (const a of activeVideoAssigns) {
      const d = (a.day || a.dayOfWeek || '').toLowerCase().trim();
      if (d) assignByDay.set(d, { ...a, day: d, weeklyCycle: parsePositiveCycleInternal(a.weeklyCycle) ?? activeCycle });
    }
    for (const d of ALL_DAYS) {
      const rDoc = routinesByDayRaw[d];
      const existingA = assignByDay.get(d);
      const rVid = rDoc?.videoId ? extractYouTubeIdInternal(rDoc.videoId || rDoc.url) || rDoc.videoId : '';
      if (rVid && (!existingA || (!existingA.videoId && !existingA.videoUrl))) {
        assignByDay.set(d, {
          id: existingA?.id || rDoc.id || `assign-${d}-${activeCycle}`,
          activityId: rDoc.activityId || 'act-1',
          studentEmail: (uData.email || aData.email || '').toLowerCase().trim(),
          studentUid: uid,
          teacherUid: rDoc.teacherUid || existingA?.teacherUid || '',
          teacherEmail: rDoc.teacherEmail || existingA?.teacherEmail || '',
          day: d,
          playlistId: rDoc.playlistId || '',
          playlistTitle: rDoc.playlistTitle || '',
          videoId: rVid,
          videoTitle: rDoc.videoTitle || rDoc.title || 'Daily Video Practice',
          videoUrl: rDoc.url || `https://www.youtube.com/watch?v=${rVid}`,
          isRepeatVideo: Boolean(rDoc.isRepeatVideo),
          instructions: rDoc.instructions || '',
          duration: rDoc.duration || '5-10 min',
          weeklyCycle: activeCycle,
          assignedAt: rDoc.updatedAt || new Date().toISOString(),
        });
      }
    }

    const watchedSet = new Set<string>();
    const addWatchedId = (raw: any) => {
      const rawStr = typeof raw === 'string' ? raw : (raw?.videoId || raw?.id || raw?.url || '');
      const clean = extractYouTubeIdInternal(rawStr) || (typeof rawStr === 'string' ? rawStr.trim() : '');
      if (clean) watchedSet.add(clean);
    };
    (Array.isArray(uData.watchedVideosHistory) ? uData.watchedVideosHistory : []).forEach(addWatchedId);
    (Array.isArray(uData.watchedVideos) ? uData.watchedVideos : []).forEach(addWatchedId);
    (Array.isArray(aData.watchedVideos) ? aData.watchedVideos : []).forEach(addWatchedId);

    const activityJournalMap = new Map<string, any>();
    if (activityJournalSnap && !activityJournalSnap.empty) {
      activityJournalSnap.forEach((docSnap: any) => {
        const d = docSnap.data();
        if (d) {
          const eid = String(d.id || docSnap.id || '').trim();
          if (eid) activityJournalMap.set(eid, { ...d, id: eid });
        }
      });
    }
    const legacyJournal = Array.isArray(uData.studentJournal) ? uData.studentJournal : [];
    legacyJournal.forEach((entry: any) => {
      if (entry && entry.id) {
        const eid = String(entry.id).trim();
        if (eid && !activityJournalMap.has(eid)) {
          activityJournalMap.set(eid, entry);
        }
      }
    });
    const journal = Array.from(activityJournalMap.values());
    journal.forEach((entry: any) => {
      if (entry && entry.type === 'video') {
        addWatchedId(entry.id);
        if (entry.url) addWatchedId(entry.url);
      }
    });

    const rawSpotifyAssigns: any[] = Array.isArray(aData.spotifyAssignments) ? aData.spotifyAssignments : [];
    const activeSpotifyAssigns = rawSpotifyAssigns.filter((a: any) => {
      if (!a || typeof a !== 'object') return false;
      const c = parsePositiveCycleInternal(a.weeklyCycle);
      return c === null || c === activeCycle;
    });

    const spotifyByDay = new Map<string, any>();
    for (const a of activeSpotifyAssigns) {
      const d = (a.day || a.dayOfWeek || '').toLowerCase().trim();
      if (d) {
        spotifyByDay.set(d, {
          ...a,
          day: d,
          weeklyCycle: parsePositiveCycleInternal(a.weeklyCycle) ?? activeCycle,
        });
      }
    }
    for (const d of ALL_DAYS) {
      const rDoc = routinesByDayRaw[d];
      const spot = rDoc?.teacherSpotify;
      const existingS = spotifyByDay.get(d);
      if (spot && typeof spot === 'object' && spot.url && (!existingS || (!existingS.url && !existingS.trackUrl))) {
        const sTrackId = extractSpotifyTrackIdInternal(spot.trackId || spot.url || spot.id) || spot.trackId || spot.id || '';
        spotifyByDay.set(d, {
          id: existingS?.id || spot.id || `spot-assign-${d}-${activeCycle}`,
          activityId: rDoc.activityId || 'act-2',
          studentEmail: (uData.email || aData.email || '').toLowerCase().trim(),
          studentUid: uid,
          teacherUid: spot.teacherUid || rDoc.teacherUid || existingS?.teacherUid || '',
          teacherEmail: spot.teacherEmail || rDoc.teacherEmail || existingS?.teacherEmail || '',
          day: d,
          trackId: sTrackId,
          trackTitle: spot.title || 'Teacher Recommended Audio',
          trackUrl: spot.url,
          url: spot.url,
          embedUrl: spot.embedUrl || '',
          title: spot.title || 'Teacher Recommended Audio',
          artistOrHost: spot.artistOrHost || spot.artist || 'Spotify',
          type: spot.type || 'music',
          instructions: spot.instructions || rDoc.teacherNotes || '',
          level: spot.level || '',
          playlistId: spot.playlistId || '',
          playlistTitle: spot.playlistTitle || '',
          weeklyCycle: activeCycle,
          assignedAt: spot.addedAt || rDoc.updatedAt || new Date().toISOString(),
        });
      }
    }

    const listenedSet = new Set<string>();
    const listenedHistoryItems: any[] = [];
    const seenListenedLower = new Set<string>();
    const addListenedEntry = (raw: any) => {
      const rawStr = typeof raw === 'string' ? raw : (raw?.trackId || raw?.id || raw?.trackUrl || raw?.url || '');
      const cleanId = extractSpotifyTrackIdInternal(rawStr);
      if (cleanId) {
        listenedSet.add(cleanId);
        const lower = cleanId.toLowerCase();
        if (!seenListenedLower.has(lower)) {
          seenListenedLower.add(lower);
          if (raw && typeof raw === 'object') {
            listenedHistoryItems.push({ ...raw, trackId: cleanId, id: cleanId });
          } else {
            listenedHistoryItems.push({
              trackId: cleanId,
              id: cleanId,
              trackTitle: 'Daily Spotify Listening',
              artist: 'Spotify Artist',
              listenedAt: '',
            });
          }
        }
      }
    };
    (Array.isArray(uData.listenedTracksHistory) ? uData.listenedTracksHistory : []).forEach(addListenedEntry);
    (Array.isArray(uData.listenedTracks) ? uData.listenedTracks : []).forEach(addListenedEntry);
    (Array.isArray(aData.listenedTracks) ? aData.listenedTracks : []).forEach(addListenedEntry);
    journal.forEach((entry: any) => {
      if (entry && entry.type === 'audio') {
        addListenedEntry(entry);
      }
    });

    const studyDaysSource =
      (Array.isArray(uData.weeklyStudyDays) && uData.weeklyStudyDays.length > 0 && uData.weeklyStudyDays) ||
      (Array.isArray(uData.selectedStudyDays) && uData.selectedStudyDays.length > 0 && uData.selectedStudyDays) ||
      (Array.isArray(aData.weeklyStudyDays) && aData.weeklyStudyDays.length > 0 && aData.weeklyStudyDays) ||
      ALL_DAYS;

    const studentEmail = (uData.email || aData.email || '').toLowerCase().trim();
    const level = (uData.englishLevel || uData.level || uData.userLevel || aData.level || 'beginner').toString();

    return {
      uid,
      studentEmail,
      userProfile: Object.keys(uData).length > 0 ? { ...uData, uid } : null,
      activeCycle,
      level,
      studyDays: ALL_DAYS.filter((d) => studyDaysSource.includes(d)),
      routinesByDayRaw,
      videoAssignments: Array.from(assignByDay.values()),
      spotifyAssignments: Array.from(spotifyByDay.values()),
      spotifyCycles: (aData.spotifyCycles && typeof aData.spotifyCycles === 'object') ? aData.spotifyCycles : {},
      listenedTracks: Array.from(listenedSet),
      listenedTracksHistory: listenedHistoryItems,
      lastSpotifyDistributionAttempt: aData.lastSpotifyDistributionAttempt || null,
      watchedVideosHistory: Array.from(watchedSet),
      awaitingTopicSelection: Boolean(aData.awaitingTopicSelection ?? uData.awaitingTopicSelection ?? (assignByDay.size === 0)),
      studentJournal: journal,
    };
  } catch (err: any) {
    if (!isPermissionError(err)) {
      console.warn('[serverFirestore] Error in fetchCanonicalRoutineContextServer:', err);
    }
    return null;
  }
}

/**
 * ARCH.2E.2A: Canonical Firestore merge write for daily routine fields (words, toggle, time)
 * directly to users/{uid}/routines/{dayOfWeek} and mirrored to users/{uid}.routinesByDay.{dayOfWeek}.
 */
export async function saveStudentRoutineDayFieldsServer(
  uid: string,
  dayOfWeek: string,
  fields: Record<string, any>,
  expectedCycle?: number | string
): Promise<{ success: boolean; activeCycle: number; error?: string; code?: string }> {
  if (isCloudWriteDisabled) {
    return { success: false, activeCycle: 1, error: 'Firestore writes disabled by IAM', code: 'CLOUD_WRITE_DISABLED' };
  }
  const db = getFirestoreDb();
  if (!db || !uid || !dayOfWeek) {
    return { success: false, activeCycle: 1, error: 'Firestore or target document invalid', code: 'FIRESTORE_UNAVAILABLE' };
  }
  const cleanDay = dayOfWeek.toLowerCase().trim();

  try {
    const userRef = db.collection('users').doc(uid);
    const dayRef = userRef.collection('routines').doc(cleanDay);

    const [uSnap, dSnap] = await Promise.all([
      withTimeout(userRef.get(), 3500),
      withTimeout(dayRef.get(), 3500),
    ]);

    const uData = (uSnap && uSnap.exists ? uSnap.data() : null) || {};
    const dData = (dSnap && dSnap.exists ? dSnap.data() : null) || {};

    const canonicalUserCycle = parsePositiveCycleInternal(uData.weeklyCycle);
    const passedCycle = parsePositiveCycleInternal(expectedCycle);

    if (passedCycle !== null && canonicalUserCycle !== null && passedCycle < canonicalUserCycle) {
      return {
        success: false,
        activeCycle: canonicalUserCycle,
        error: `Stale cycle ${passedCycle} rejected; active cycle is ${canonicalUserCycle}.`,
        code: 'STALE_CYCLE',
      };
    }

    const activeCycle = canonicalUserCycle ?? passedCycle ?? 1;
    const now = new Date().toISOString();
    const existingDayCycle = parsePositiveCycleInternal(dData.weeklyCycle);
    const isMigratingFromOlderCycle = existingDayCycle !== null && existingDayCycle < activeCycle;

    const olderCycleDefaults = isMigratingFromOlderCycle
      ? {
          videoId: '',
          title: '',
          videoTitle: '',
          url: '',
          playlistId: '',
          playlistTitle: '',
          isRepeatVideo: false,
          isCustomSuggestion: false,
          teacherVideos: [],
          teacherSpotify: null,
          teacherOverrideTrack: null,
          teacherFeedback: null,
          teacherNotes: '',
          activityId: 'act-1',
          instructions: '',
          duration: '',
          completed: false,
          completedToday: false,
          completedVideoToday: false,
          completedAudioToday: false,
          learnedWords: [],
        }
      : {};

    const sanitizedFields = removeUndefinedFields({
      ...olderCycleDefaults,
      dayOfWeek: cleanDay,
      weeklyCycle: activeCycle,
      ...fields,
      updatedAt: now,
    });

    const daySaved = await withTimeout(dayRef.set(sanitizedFields, { merge: !isMigratingFromOlderCycle }).then(() => true), 4500);
    if (!daySaved) {
      return { success: false, activeCycle, error: 'Timeout saving daily routine document', code: 'WRITE_FAILED' };
    }

    const rootSaved = await withTimeout(
      userRef
        .set(
          {
            routinesByDay: {
              [cleanDay]: sanitizedFields,
            },
            updatedAt: now,
          },
          { merge: true }
        )
        .then(() => true),
      4500
    );

    if (!rootSaved) {
      return { success: false, activeCycle, error: 'Timeout mirroring routine to user document', code: 'WRITE_FAILED' };
    }

    return { success: true, activeCycle };
  } catch (err: any) {
    if (isPermissionError(err)) {
      isCloudWriteDisabled = true;
    } else {
      console.warn('[serverFirestore] saveStudentRoutineDayFieldsServer error:', err);
    }
    return { success: false, activeCycle: 1, error: err?.message || 'Firestore write failed', code: 'WRITE_FAILED' };
  }
}

/**
 * ARCH.2E.2A: Canonical server write to student_assignments/{uid} awaiting completion.
 */
export async function saveStudentAssignmentsCanonicalServer(
  uid: string,
  data: Record<string, any>
): Promise<boolean> {
  if (isCloudWriteDisabled) return false;
  const db = getFirestoreDb();
  if (!db || !uid) return false;
  try {
    const sanitized = removeUndefinedFields({
      ...data,
      uid,
      updatedAt: data.updatedAt || new Date().toISOString(),
    });
    const savePromise = db.collection('student_assignments').doc(uid).set(sanitized, { merge: true }).then(() => true);
    const result = await withTimeout(savePromise, 4500);
    return Boolean(result);
  } catch (err: any) {
    if (isPermissionError(err)) {
      isCloudWriteDisabled = true;
      console.info('[serverFirestore] Remote student assignments write restricted by IAM.');
    } else {
      console.warn('[serverFirestore] saveStudentAssignmentsCanonicalServer error:', err);
    }
    return false;
  }
}

/**
 * ARCH.2E.2A: Canonical awaited append to users/{uid}.watchedVideosHistory and student_assignments/{uid}.watchedVideos.
 */
export async function addWatchedVideoCanonicalServer(
  uid: string,
  videoId: string,
  videoTitle?: string
): Promise<{ success: boolean; watchedVideos: string[]; error?: string }> {
  if (isCloudWriteDisabled) {
    return { success: false, watchedVideos: [], error: 'Firestore writes disabled by IAM' };
  }
  const db = getFirestoreDb();
  const cleanVid = (extractYouTubeIdInternal(videoId) || videoId || '').trim();
  if (!db || !uid || !cleanVid) {
    return { success: false, watchedVideos: [], error: 'Firestore unavailable or invalid uid/videoId' };
  }

  try {
    const userRef = db.collection('users').doc(uid);
    const assignRef = db.collection('student_assignments').doc(uid);

    const [userSnap, assignSnap] = await Promise.all([
      withTimeout(userRef.get(), 4000),
      withTimeout(assignRef.get(), 4000),
    ]);

    const uData = (userSnap && userSnap.exists ? userSnap.data() : null) || {};
    const aData = (assignSnap && assignSnap.exists ? assignSnap.data() : null) || {};

    const existingHistory = Array.isArray(uData.watchedVideosHistory)
      ? [...uData.watchedVideosHistory]
      : (Array.isArray(uData.watchedVideos) ? [...uData.watchedVideos] : []);

    const cleanTitle = (videoTitle || 'Daily Video Practice').trim();
    const alreadyInHistory = existingHistory.some((item: any) => {
      const id = typeof item === 'string' ? item : (item?.videoId || item?.id || '');
      return id.toLowerCase() === cleanVid.toLowerCase();
    });

    const now = new Date().toISOString();
    if (!alreadyInHistory) {
      existingHistory.push({
        videoId: cleanVid,
        videoTitle: cleanTitle,
        watchedAt: now,
      });
    }

    const existingAssignWatched = Array.isArray(aData.watchedVideos) ? [...aData.watchedVideos] : [];
    const watchedIdSet = new Set<string>(
      existingAssignWatched
        .map((item: any) => (typeof item === 'string' ? item : (item?.videoId || item?.id || '')).trim())
        .filter(Boolean)
    );
    existingHistory.forEach((item: any) => {
      const id = (typeof item === 'string' ? item : (item?.videoId || item?.id || '')).trim();
      if (id) watchedIdSet.add(id);
    });
    watchedIdSet.add(cleanVid);
    const mergedWatchedIds = Array.from(watchedIdSet);

    const [userOk, assignOk] = await Promise.all([
      withTimeout(
        userRef.set({ watchedVideosHistory: existingHistory, updatedAt: now }, { merge: true }).then(() => true),
        4500
      ),
      withTimeout(
        assignRef.set({ uid, watchedVideos: mergedWatchedIds, updatedAt: now }, { merge: true }).then(() => true),
        4500
      ),
    ]);

    if (!userOk || !assignOk) {
      return { success: false, watchedVideos: [], error: 'Failed to confirm watched video persistence in Firestore' };
    }

    return { success: true, watchedVideos: mergedWatchedIds };
  } catch (err: any) {
    if (isPermissionError(err)) {
      isCloudWriteDisabled = true;
    } else {
      console.warn('[serverFirestore] addWatchedVideoCanonicalServer error:', err);
    }
    return { success: false, watchedVideos: [], error: err?.message || 'Firestore write failed' };
  }
}

/**
 * ARCH.2E.2B: Canonical awaited append to users/{uid}.listenedTracksHistory and student_assignments/{uid}.listenedTracks.
 * Guarantees idempotency (no duplicate entries) and strict error propagation.
 */
export async function addListenedTrackCanonicalServer(
  uid: string,
  trackId: string,
  trackTitle?: string,
  artist?: string
): Promise<{ success: boolean; listenedTracks: string[]; alreadyRecorded?: boolean; error?: string }> {
  if (isCloudWriteDisabled) {
    return { success: false, listenedTracks: [], error: 'Firestore writes disabled by IAM' };
  }
  const db = getFirestoreDb();
  const cleanTrackId = (extractSpotifyTrackIdInternal(trackId) || trackId || '').trim();
  if (!db || !uid || !cleanTrackId) {
    return { success: false, listenedTracks: [], error: 'Firestore unavailable or invalid uid/trackId' };
  }

  try {
    const userRef = db.collection('users').doc(uid);
    const assignRef = db.collection('student_assignments').doc(uid);

    const [userSnap, assignSnap] = await Promise.all([
      withTimeout(userRef.get(), 4000),
      withTimeout(assignRef.get(), 4000),
    ]);

    const uData = (userSnap && userSnap.exists ? userSnap.data() : null) || {};
    const aData = (assignSnap && assignSnap.exists ? assignSnap.data() : null) || {};

    const existingHistory = Array.isArray(uData.listenedTracksHistory)
      ? [...uData.listenedTracksHistory]
      : (Array.isArray(uData.listenedTracks) ? [...uData.listenedTracks] : []);

    const cleanTitle = (trackTitle || 'Daily Spotify Listening').trim();
    const cleanArtist = (artist || 'Spotify Artist').trim();
    const alreadyInHistory = existingHistory.some((item: any) => {
      const id = typeof item === 'string' ? item : (item?.trackId || item?.id || '');
      return id.toLowerCase() === cleanTrackId.toLowerCase();
    });

    const now = new Date().toISOString();
    if (!alreadyInHistory) {
      existingHistory.push({
        trackId: cleanTrackId,
        id: cleanTrackId,
        trackTitle: cleanTitle,
        title: cleanTitle,
        artist: cleanArtist,
        listenedAt: now,
      });
    }

    const existingAssignListened = Array.isArray(aData.listenedTracks) ? [...aData.listenedTracks] : [];
    const alreadyInAssign = existingAssignListened.some((item: any) => {
      const id = (typeof item === 'string' ? item : (item?.trackId || item?.id || '')).trim();
      return id.toLowerCase() === cleanTrackId.toLowerCase();
    });
    const listenedIdSet = new Set<string>(
      existingAssignListened
        .map((item: any) => (typeof item === 'string' ? item : (item?.trackId || item?.id || '')).trim())
        .filter(Boolean)
    );
    existingHistory.forEach((item: any) => {
      const id = (typeof item === 'string' ? item : (item?.trackId || item?.id || '')).trim();
      if (id) listenedIdSet.add(id);
    });
    listenedIdSet.add(cleanTrackId);
    const mergedListenedIds = Array.from(listenedIdSet);

    if (alreadyInHistory && alreadyInAssign) {
      return { success: true, listenedTracks: mergedListenedIds, alreadyRecorded: true };
    }

    const [userOk, assignOk] = await Promise.all([
      withTimeout(
        userRef.set({ listenedTracksHistory: existingHistory, updatedAt: now }, { merge: true }).then(() => true),
        4500
      ),
      withTimeout(
        assignRef.set({ uid, listenedTracks: mergedListenedIds, updatedAt: now }, { merge: true }).then(() => true),
        4500
      ),
    ]);

    if (!userOk || !assignOk) {
      return { success: false, listenedTracks: [], error: 'Failed to confirm listened track persistence in Firestore' };
    }

    return {
      success: true,
      listenedTracks: mergedListenedIds,
      alreadyRecorded: alreadyInHistory && alreadyInAssign,
    };
  } catch (err: any) {
    if (isPermissionError(err)) {
      isCloudWriteDisabled = true;
    } else {
      console.warn('[serverFirestore] addListenedTrackCanonicalServer error:', err);
    }
    return { success: false, listenedTracks: [], error: err?.message || 'Firestore write failed' };
  }
}

/**
 * ARCH.2E.2B: Canonical Firestore (default) reader for users/{uid}/currentRoutine/weekData,
 * users/{uid}/currentRoutine/{weekId}, and users/{uid}/routines/* feedback/overrides.
 */
export async function fetchStudentCurrentRoutineServer(
  uid: string,
  weekId?: string,
  requestedCycle?: number | string
): Promise<{ routine: Record<string, any> | null; activeCycle: number } | null> {
  const db = getFirestoreDb();
  if (!db || !uid) return null;

  const safeWeekId = (weekId || '').trim();
  const parsedRequestedCycle = parsePositiveCycleInternal(requestedCycle);

  try {
    const userRef = db.collection('users').doc(uid);
    const currentRoutineCol = userRef.collection('currentRoutine');

    const [userSnap, weekDataSnap, weekDocSnap, routinesSnap] = await Promise.all([
      withTimeout(userRef.get(), 4000),
      withTimeout(currentRoutineCol.doc('weekData').get(), 4000),
      safeWeekId && safeWeekId !== 'weekData'
        ? withTimeout(currentRoutineCol.doc(safeWeekId).get(), 4000)
        : Promise.resolve(null),
      withTimeout(userRef.collection('routines').get(), 4000),
    ]);

    const uData = (userSnap && userSnap.exists ? userSnap.data() : null) || {};
    const uCycle = parsePositiveCycleInternal(uData.weeklyCycle);
    const activeCycle = uCycle !== null
      ? (parsedRequestedCycle !== null ? Math.max(uCycle, parsedRequestedCycle) : uCycle)
      : (parsedRequestedCycle ?? 1);

    const rawWeekData = weekDataSnap && weekDataSnap.exists ? weekDataSnap.data() : null;
    const rawWeekDoc = weekDocSnap && weekDocSnap.exists ? weekDocSnap.data() : null;

    const filterCycleData = (d: any): any | null => {
      if (!d || typeof d !== 'object') return null;
      const docCycle = parsePositiveCycleInternal(d.weeklyCycle);
      if (docCycle !== null && docCycle < activeCycle) return null;
      return d;
    };

    const weekData = filterCycleData(rawWeekData);
    const weekDoc = filterCycleData(rawWeekDoc);

    const routinesTeacherFeedback: Record<string, any> = {};
    const routinesTeacherOverrides: Record<string, any> = {};
    let routinesCurrentTrack: any = null;
    let routinesTrackUpdatedAt = 0;

    if (routinesSnap && !routinesSnap.empty) {
      routinesSnap.forEach((docSnap: any) => {
        const dData = docSnap.data();
        if (!dData || typeof dData !== 'object') return;
        const docCycle = parsePositiveCycleInternal(dData.weeklyCycle);
        if (docCycle !== null && docCycle < activeCycle) return;
        const dayKey = docSnap.id;

        if (dData.teacherFeedback && typeof dData.teacherFeedback === 'object') {
          Object.entries(dData.teacherFeedback).forEach(([fbDay, fbVal]) => {
            if (fbVal) routinesTeacherFeedback[fbDay] = fbVal;
          });
        }
        if (dData.teacherOverrideTrack !== undefined) {
          routinesTeacherOverrides[dayKey] = dData.teacherOverrideTrack;
        }
        if (dData.currentSpotifyTrack && typeof dData.currentSpotifyTrack === 'object') {
          const ts = new Date(dData.updatedAt || 0).getTime() || 0;
          if (!routinesCurrentTrack || ts >= routinesTrackUpdatedAt) {
            routinesCurrentTrack = dData.currentSpotifyTrack;
            routinesTrackUpdatedAt = ts;
          }
        }
      });
    }

    const mergedFeedback = {
      ...(weekDoc?.teacherFeedback || {}),
      ...(weekData?.teacherFeedback || {}),
      ...routinesTeacherFeedback,
    };
    const mergedOverrides = {
      ...(weekDoc?.teacherOverrides || {}),
      ...(weekData?.teacherOverrides || {}),
      ...routinesTeacherOverrides,
    };

    const currentSpotifyTrack =
      (weekData && weekData.currentSpotifyTrack !== undefined ? weekData.currentSpotifyTrack : undefined) ??
      (weekDoc && weekDoc.currentSpotifyTrack !== undefined ? weekDoc.currentSpotifyTrack : undefined) ??
      routinesCurrentTrack ??
      null;

    const hasAnyData = Boolean(
      weekData ||
      weekDoc ||
      currentSpotifyTrack ||
      Object.keys(mergedFeedback).length > 0 ||
      Object.keys(mergedOverrides).length > 0
    );

    if (!hasAnyData) {
      return { routine: null, activeCycle };
    }

    const baseDoc = weekData || weekDoc || {};
    const routine: Record<string, any> = {
      ...baseDoc,
      studentUid: uid,
      weekId: safeWeekId || baseDoc.weekId || `week-${activeCycle}`,
      weeklyCycle: activeCycle,
      currentSpotifyTrack,
      teacherFeedback: mergedFeedback,
      teacherOverrides: mergedOverrides,
      updatedAt: baseDoc.updatedAt || new Date().toISOString(),
    };

    return { routine, activeCycle };
  } catch (err: any) {
    if (!isPermissionError(err)) {
      console.warn('[serverFirestore] fetchStudentCurrentRoutineServer error:', err);
    }
    return null;
  }
}

/**
 * ARCH.2E.2B: Canonical awaited write for users/{uid}/currentRoutine/weekData, {weekId}, and daily routines/{dayOfWeek}.
 */
export async function saveStudentCurrentRoutineServer(
  uid: string,
  weekId: string,
  data: {
    currentSpotifyTrack?: any;
    studentEmail?: string;
    nativeFriendUid?: string;
    nativeFriendEmail?: string;
    dayOfWeek?: string;
  },
  expectedCycle?: number | string
): Promise<{ success: boolean; routine?: Record<string, any>; activeCycle: number; error?: string; code?: string }> {
  if (isCloudWriteDisabled) {
    return { success: false, activeCycle: 1, error: 'Firestore writes disabled by IAM', code: 'CLOUD_WRITE_DISABLED' };
  }
  const db = getFirestoreDb();
  if (!db || !uid) {
    return { success: false, activeCycle: 1, error: 'Firestore or target document invalid', code: 'FIRESTORE_UNAVAILABLE' };
  }

  try {
    const userRef = db.collection('users').doc(uid);
    const uSnap = await withTimeout(userRef.get(), 3500);
    const uData = (uSnap && uSnap.exists ? uSnap.data() : null) || {};
    const canonicalUserCycle = parsePositiveCycleInternal(uData.weeklyCycle);
    const passedCycle = parsePositiveCycleInternal(expectedCycle) ?? parsePositiveCycleInternal(weekId);

    if (passedCycle !== null && canonicalUserCycle !== null && passedCycle < canonicalUserCycle) {
      return {
        success: false,
        activeCycle: canonicalUserCycle,
        error: `Stale cycle ${passedCycle} rejected; active cycle is ${canonicalUserCycle}.`,
        code: 'STALE_CYCLE',
      };
    }

    const activeCycle = canonicalUserCycle !== null
      ? Math.max(canonicalUserCycle, passedCycle ?? canonicalUserCycle)
      : (passedCycle ?? 1);

    const safeWeekId = (weekId || `week-${activeCycle}`).trim();
    const now = new Date().toISOString();
    const cleanDay = (data.dayOfWeek || data.currentSpotifyTrack?.dayOfWeek || '').toLowerCase().trim();

    const payload = removeUndefinedFields({
      studentUid: uid,
      weekId: safeWeekId,
      weeklyCycle: activeCycle,
      ...(data.currentSpotifyTrack !== undefined ? { currentSpotifyTrack: data.currentSpotifyTrack } : {}),
      ...(data.studentEmail ? { studentEmail: data.studentEmail.toLowerCase().trim() } : {}),
      ...(data.nativeFriendUid ? { nativeFriendUid: data.nativeFriendUid.trim() } : {}),
      ...(data.nativeFriendEmail ? { nativeFriendEmail: data.nativeFriendEmail.toLowerCase().trim() } : {}),
      updatedAt: now,
    });

    const currentRoutineCol = userRef.collection('currentRoutine');
    const writes: Promise<boolean | null>[] = [
      withTimeout(currentRoutineCol.doc('weekData').set(payload, { merge: true }).then(() => true), 4500),
    ];
    if (safeWeekId && safeWeekId !== 'weekData') {
      writes.push(withTimeout(currentRoutineCol.doc(safeWeekId).set(payload, { merge: true }).then(() => true), 4500));
    }
    if (cleanDay && data.currentSpotifyTrack !== undefined) {
      writes.push(
        withTimeout(
          userRef
            .collection('routines')
            .doc(cleanDay)
            .set(
              removeUndefinedFields({
                currentSpotifyTrack: data.currentSpotifyTrack,
                dayOfWeek: cleanDay,
                weeklyCycle: activeCycle,
                updatedAt: now,
              }),
              { merge: true }
            )
            .then(() => true),
          4500
        )
      );
    }

    const results = await Promise.all(writes);
    if (results.some((r) => !r)) {
      return { success: false, activeCycle, error: 'Failed to confirm current routine write in Firestore', code: 'WRITE_FAILED' };
    }

    return { success: true, routine: payload, activeCycle };
  } catch (err: any) {
    if (isPermissionError(err)) {
      isCloudWriteDisabled = true;
    } else {
      console.warn('[serverFirestore] saveStudentCurrentRoutineServer error:', err);
    }
    return { success: false, activeCycle: 1, error: err?.message || 'Firestore write failed', code: 'WRITE_FAILED' };
  }
}

/**
 * ARCH.2E.2B: Canonical awaited write for teacher audio feedback across weekData, {weekId}, and routines/{dayOfWeek}.
 */
export async function saveCurrentRoutineFeedbackServer(
  uid: string,
  weekId: string,
  feedback: Record<string, any>,
  expectedCycle?: number | string
): Promise<{ success: boolean; routine?: Record<string, any>; activeCycle: number; error?: string; code?: string }> {
  if (isCloudWriteDisabled) {
    return { success: false, activeCycle: 1, error: 'Firestore writes disabled by IAM', code: 'CLOUD_WRITE_DISABLED' };
  }
  const db = getFirestoreDb();
  const cleanDay = String(feedback?.dayOfWeek || '').toLowerCase().trim();
  if (!db || !uid || !cleanDay) {
    return { success: false, activeCycle: 1, error: 'Firestore or target document invalid', code: 'FIRESTORE_UNAVAILABLE' };
  }

  try {
    const userRef = db.collection('users').doc(uid);
    const uSnap = await withTimeout(userRef.get(), 3500);
    const uData = (uSnap && uSnap.exists ? uSnap.data() : null) || {};
    const canonicalUserCycle = parsePositiveCycleInternal(uData.weeklyCycle);
    const passedCycle = parsePositiveCycleInternal(expectedCycle) ?? parsePositiveCycleInternal(weekId);

    if (passedCycle !== null && canonicalUserCycle !== null && passedCycle < canonicalUserCycle) {
      return {
        success: false,
        activeCycle: canonicalUserCycle,
        error: `Stale cycle ${passedCycle} rejected; active cycle is ${canonicalUserCycle}.`,
        code: 'STALE_CYCLE',
      };
    }

    const activeCycle = canonicalUserCycle !== null
      ? Math.max(canonicalUserCycle, passedCycle ?? canonicalUserCycle)
      : (passedCycle ?? 1);

    const safeWeekId = (weekId || `week-${activeCycle}`).trim();
    const now = new Date().toISOString();

    const sanitizedFeedback: Record<string, any> = removeUndefinedFields({
      ...feedback,
      studentUid: uid,
      dayOfWeek: cleanDay,
      createdAt: feedback.createdAt || now,
      updatedAt: now,
    });

    const payload = removeUndefinedFields({
      studentUid: uid,
      weekId: safeWeekId,
      weeklyCycle: activeCycle,
      ...(sanitizedFeedback.teacherUid ? { nativeFriendUid: sanitizedFeedback.teacherUid } : {}),
      ...(sanitizedFeedback.teacherEmail ? { nativeFriendEmail: sanitizedFeedback.teacherEmail } : {}),
      teacherFeedback: {
        [cleanDay]: sanitizedFeedback,
      },
      updatedAt: now,
    });

    const currentRoutineCol = userRef.collection('currentRoutine');
    const writes: Promise<boolean | null>[] = [
      withTimeout(currentRoutineCol.doc('weekData').set(payload, { merge: true }).then(() => true), 4500),
      withTimeout(
        userRef
          .collection('routines')
          .doc(cleanDay)
          .set(
            {
              teacherFeedback: { [cleanDay]: sanitizedFeedback },
              dayOfWeek: cleanDay,
              weeklyCycle: activeCycle,
              updatedAt: now,
            },
            { merge: true }
          )
          .then(() => true),
        4500
      ),
    ];

    if (safeWeekId && safeWeekId !== 'weekData') {
      writes.push(withTimeout(currentRoutineCol.doc(safeWeekId).set(payload, { merge: true }).then(() => true), 4500));
    }

    const results = await Promise.all(writes);
    if (results.some((r) => !r)) {
      return { success: false, activeCycle, error: 'Failed to confirm feedback write in Firestore', code: 'WRITE_FAILED' };
    }

    return { success: true, routine: payload, activeCycle };
  } catch (err: any) {
    if (isPermissionError(err)) {
      isCloudWriteDisabled = true;
    } else {
      console.warn('[serverFirestore] saveCurrentRoutineFeedbackServer error:', err);
    }
    return { success: false, activeCycle: 1, error: err?.message || 'Firestore write failed', code: 'WRITE_FAILED' };
  }
}

/**
 * ARCH.2E.2B: Canonical awaited write for teacher Spotify override track across routines/{dayOfWeek},
 * users/{uid}.routinesByDay.{dayOfWeek}, and currentRoutine/weekData.
 */
export async function saveTeacherSpotifyOverrideServer(
  uid: string,
  dayOfWeek: string,
  overrideTrack: Record<string, any> | null,
  expectedCycle?: number | string
): Promise<{ success: boolean; activeCycle: number; error?: string; code?: string }> {
  if (isCloudWriteDisabled) {
    return { success: false, activeCycle: 1, error: 'Firestore writes disabled by IAM', code: 'CLOUD_WRITE_DISABLED' };
  }
  const db = getFirestoreDb();
  const cleanDay = String(dayOfWeek || '').toLowerCase().trim();
  if (!db || !uid || !cleanDay) {
    return { success: false, activeCycle: 1, error: 'Firestore or target document invalid', code: 'FIRESTORE_UNAVAILABLE' };
  }

  try {
    const userRef = db.collection('users').doc(uid);
    const uSnap = await withTimeout(userRef.get(), 3500);
    const uData = (uSnap && uSnap.exists ? uSnap.data() : null) || {};
    const canonicalUserCycle = parsePositiveCycleInternal(uData.weeklyCycle);
    const passedCycle = parsePositiveCycleInternal(expectedCycle);

    if (passedCycle !== null && canonicalUserCycle !== null && passedCycle < canonicalUserCycle) {
      return {
        success: false,
        activeCycle: canonicalUserCycle,
        error: `Stale cycle ${passedCycle} rejected; active cycle is ${canonicalUserCycle}.`,
        code: 'STALE_CYCLE',
      };
    }

    const activeCycle = canonicalUserCycle ?? passedCycle ?? 1;
    const now = new Date().toISOString();
    const sanitizedOverride = overrideTrack === null ? null : removeUndefinedFields({ ...overrideTrack, updatedAt: now });

    const dayRes = await saveStudentRoutineDayFieldsServer(
      uid,
      cleanDay,
      {
        teacherOverrideTrack: sanitizedOverride,
      },
      activeCycle
    );

    if (!dayRes.success) {
      return dayRes;
    }

    const weekDataOk = await withTimeout(
      userRef
        .collection('currentRoutine')
        .doc('weekData')
        .set(
          {
            studentUid: uid,
            weeklyCycle: activeCycle,
            teacherOverrides: {
              [cleanDay]: sanitizedOverride,
            },
            updatedAt: now,
          },
          { merge: true }
        )
        .then(() => true),
      4500
    );

    if (!weekDataOk) {
      return { success: false, activeCycle, error: 'Failed to confirm override write on currentRoutine/weekData', code: 'WRITE_FAILED' };
    }

    return { success: true, activeCycle };
  } catch (err: any) {
    if (isPermissionError(err)) {
      isCloudWriteDisabled = true;
    } else {
      console.warn('[serverFirestore] saveTeacherSpotifyOverrideServer error:', err);
    }
    return { success: false, activeCycle: 1, error: err?.message || 'Firestore write failed', code: 'WRITE_FAILED' };
  }
}

/**
 * Retrieves persisted daily routine video selections from users/{uid}/routines/{dayOfWeek}
 * filtered strictly by the student's active weekly cycle.
 */
export async function fetchRoutineVideosFromFirestoreServer(
  uid: string,
  weeklyCycle?: number | string
): Promise<{
  routinesByDay: Record<string, any>;
  weeklyCycle: number;
  watchedVideosHistory: string[];
}> {
  const parsedPassedCycle = typeof weeklyCycle === 'number' ? weeklyCycle : typeof weeklyCycle === 'string' ? parseInt(weeklyCycle.replace(/\D/g, ''), 10) : 1;
  const result: {
    routinesByDay: Record<string, any>;
    weeklyCycle: number;
    watchedVideosHistory: string[];
  } = {
    routinesByDay: {},
    weeklyCycle: !isNaN(parsedPassedCycle) && parsedPassedCycle > 0 ? parsedPassedCycle : 1,
    watchedVideosHistory: [],
  };

  const db = getFirestoreDb();
  if (!db || !uid) return result;

  try {
    const userRef = db.collection('users').doc(uid);
    const [userSnap, activityJournalSnap, routinesSnap] = await Promise.all([
      withTimeout(userRef.get(), 4000),
      withTimeout(userRef.collection('activity_journal').get(), 4000).catch(() => null),
      withTimeout(userRef.collection('routines').get(), 4000),
    ]);

    let activeCycle = result.weeklyCycle;
    const journalMap = new Map<string, any>();
    if (activityJournalSnap && !activityJournalSnap.empty) {
      activityJournalSnap.forEach((docSnap: any) => {
        const d = docSnap.data();
        if (d) {
          const eid = String(d.id || docSnap.id || '').trim();
          if (eid) journalMap.set(eid, { ...d, id: eid });
        }
      });
    }

    if (userSnap && userSnap.exists) {
      const uData = userSnap.data() || {};
      const uCycle = typeof uData.weeklyCycle === 'number' ? uData.weeklyCycle : typeof uData.weeklyCycle === 'string' ? parseInt(uData.weeklyCycle.replace(/\D/g, ''), 10) : NaN;
      if (!isNaN(uCycle) && uCycle > 0) {
        if (!isNaN(parsedPassedCycle) && parsedPassedCycle > 0) {
          activeCycle = Math.max(parsedPassedCycle, uCycle);
        } else {
          activeCycle = uCycle;
        }
      }
      result.weeklyCycle = activeCycle;

      const history = uData.watchedVideosHistory || uData.watchedVideos || [];
      const legacyJournal = Array.isArray(uData.studentJournal) ? uData.studentJournal : [];
      legacyJournal.forEach((entry: any) => {
        if (entry && entry.id && !journalMap.has(String(entry.id).trim())) {
          journalMap.set(String(entry.id).trim(), entry);
        }
      });
      const journal = Array.from(journalMap.values());
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
            const rawCycle = item.weeklyCycle;
            const itemCycle = typeof rawCycle === 'number' ? rawCycle : typeof rawCycle === 'string' ? parseInt(rawCycle.replace(/\D/g, ''), 10) : activeCycle;
            // Strict weekly cycle matching to prevent cross-cycle bleeding
            if (itemCycle === activeCycle) {
              result.routinesByDay[day] = { ...item, dayOfWeek: day, weeklyCycle: activeCycle };
            }
          }
        });
      }
    } else if (journalMap.size > 0) {
      result.watchedVideosHistory = Array.from(journalMap.values())
        .filter((entry: any) => entry && entry.type === 'video' && entry.id)
        .map((entry: any) => (typeof entry.id === 'string' ? entry.id : entry.id?.videoId || ''))
        .filter(Boolean);
    }

    if (routinesSnap && !routinesSnap.empty) {
      routinesSnap.forEach((docSnap: any) => {
        const data = docSnap.data();
        if (data) {
          const day = docSnap.id;
          const rawCycle = data.weeklyCycle;
          const itemCycle = typeof rawCycle === 'number' ? rawCycle : typeof rawCycle === 'string' ? parseInt(rawCycle.replace(/\D/g, ''), 10) : activeCycle;
          // Strict weekly cycle matching
          if (itemCycle === activeCycle) {
            const hasVideoField = data.videoId !== undefined || data.url !== undefined || data.isRepeatVideo !== undefined;
            if (hasVideoField) {
              result.routinesByDay[day] = {
                ...(result.routinesByDay[day] || {}),
                ...data,
                dayOfWeek: day,
                weeklyCycle: activeCycle,
              };
            } else if (!result.routinesByDay[day]) {
              result.routinesByDay[day] = {
                ...data,
                dayOfWeek: day,
                weeklyCycle: activeCycle,
              };
            }
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

export interface VideoContextForPart4 {
  studentUid: string;
  weeklyCycle: number;
  referenceDay: string;
  hasVideo: boolean;
  videoId?: string;
  videoUrl?: string;
  videoTitle?: string;
  themeOrCategory?: string;
  isWatched: boolean;
  fiveWordsVocab?: string[];
  legitimateWeeklyVocab?: string[];
}


/**
 * Resolves verified, structured video and vocabulary context from Firestore
 * for grounding Part 4 (Mini-Story & Comprehension Questions).
 *
 * Strict requirements:
 * 1. Uses canonical student Firebase Auth UID.
 * 2. Cycle-isolated: only matches routines from the student's active weekly cycle.
 * 3. Never asserts a video was watched unless proven by watchedVideosHistory or studentJournal.
 * 4. Gathers genuine 5 Words / routine vocabulary recorded for this day/video.
 */
export async function resolveStudentVideoContextForPart4(
  studentUid: string,
  referenceDay?: string,
  targetWeeklyCycle?: number
): Promise<VideoContextForPart4> {
  const defaultResult: VideoContextForPart4 = {
    studentUid: studentUid || '',
    weeklyCycle: targetWeeklyCycle || 1,
    referenceDay: (referenceDay || 'monday').toLowerCase(),
    hasVideo: false,
    isWatched: false,
    fiveWordsVocab: [],
    legitimateWeeklyVocab: [],
  };

  if (!studentUid || typeof studentUid !== 'string' || !isValidCanonicalUid(studentUid)) {
    return defaultResult;
  }

  try {
    const routineData = await fetchRoutineVideosFromFirestoreServer(studentUid, targetWeeklyCycle);
    const activeCycle = routineData.weeklyCycle || targetWeeklyCycle || 1;
    defaultResult.weeklyCycle = activeCycle;

    const requestedDay = (referenceDay || '').toLowerCase().trim();
    const candidateDays = requestedDay
      ? [requestedDay, 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
      : ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

    let matchedDay = requestedDay || 'monday';
    let matchedRoutine: any = null;

    if (requestedDay && routineData.routinesByDay[requestedDay]?.videoId) {
      matchedDay = requestedDay;
      matchedRoutine = routineData.routinesByDay[requestedDay];
    } else {
      // Find the first configured day in current cycle
      for (const d of candidateDays) {
        if (routineData.routinesByDay[d]?.videoId) {
          matchedDay = d;
          matchedRoutine = routineData.routinesByDay[d];
          break;
        }
      }
    }

    // Retrieve legitimate vocabulary from Firestore
    let allVocab: any[] = [];
    try {
      allVocab = await fetchStudentVocabularyFromFirestoreServer(studentUid);
    } catch {}

    const legitimateWeeklyVocab = Array.from(
      new Set(
        allVocab
          .map((v: any) => (v?.word || '').trim())
          .filter((w: string) => Boolean(w))
      )
    ).slice(0, 30);

    if (!matchedRoutine || !matchedRoutine.videoId) {
      return {
        ...defaultResult,
        weeklyCycle: activeCycle,
        referenceDay: matchedDay,
        hasVideo: false,
        isWatched: false,
        legitimateWeeklyVocab,
      };
    }

    const rawVidId = matchedRoutine.videoId || '';
    const cleanVidId = extractYouTubeIdInternal(rawVidId || matchedRoutine.url) || rawVidId;
    const title = (matchedRoutine.videoTitle || matchedRoutine.title || '').trim();
    const theme = (matchedRoutine.playlistTitle || matchedRoutine.theme || matchedRoutine.category || '').trim();
    const url = matchedRoutine.url || (cleanVidId ? `https://www.youtube.com/watch?v=${cleanVidId}` : '');

    // Watch status: ONLY true if proven in watchedVideosHistory
    const isWatched = Boolean(
      cleanVidId &&
      Array.isArray(routineData.watchedVideosHistory) &&
      routineData.watchedVideosHistory.includes(cleanVidId)
    );

    // 5 Words vocabulary linked specifically to this day, activity, or video
    const fiveWordsVocab = Array.from(
      new Set(
        allVocab
          .filter((item: any) => {
            if (!item) return false;
            const itemDay = (item.sourceDay || item.routineRef?.day || '').toLowerCase().trim();
            const itemVid = item.routineRef?.videoId || '';
            const matchesVideo = cleanVidId && itemVid === cleanVidId;
            const matchesDay = itemDay === matchedDay;
            const hasRoutineOrigin = Array.isArray(item.origins) && item.origins.some((o: any) =>
              (cleanVidId && o.videoId === cleanVidId) || (o.dayOfWeek && o.dayOfWeek.toLowerCase() === matchedDay)
            );
            return matchesVideo || matchesDay || hasRoutineOrigin;
          })
          .map((item: any) => (item.word || '').trim())
          .filter(Boolean)
      )
    ).slice(0, 15);

    return {
      studentUid,
      weeklyCycle: activeCycle,
      referenceDay: matchedDay,
      hasVideo: Boolean(cleanVidId),
      videoId: cleanVidId,
      videoUrl: url,
      videoTitle: title,
      themeOrCategory: theme,
      isWatched,
      fiveWordsVocab,
      legitimateWeeklyVocab,
    };
  } catch (err) {
    console.warn('[serverFirestore] Error in resolveStudentVideoContextForPart4:', err);
    return defaultResult;
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
  if (isCloudWriteDisabled) return false;
  const db = getFirestoreDb();
  if (!db || !uid) return false;

  try {
    const userRef = db.collection('users').doc(uid);
    const routinesCol = userRef.collection('routines');
    const nowIso = new Date().toISOString();

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
        isCustomSuggestion: false,
        teacherVideos: [],
        teacherSpotify: null,
        teacherOverrideTrack: null,
        teacherFeedback: null,
        teacherNotes: '',
        dayOfWeek: day,
        activityId: 'act-1',
        instructions: '',
        duration: '',
        completed: false,
        completedToday: false,
        completedVideoToday: false,
        completedAudioToday: false,
        learnedWords: [],
        weeklyCycle: targetCycle,
        updatedAt: nowIso,
      };
      emptyRoutinesByDay[day] = resetPayload;
      return routinesCol.doc(day).set(resetPayload, { merge: true });
    });

    const daysRes = await withTimeout(Promise.all(resetPromises).then(() => true), 5000);
    if (!daysRes) return false;

    const rootRes = await withTimeout(
      userRef
        .set(
          {
            weeklyCycle: targetCycle,
            routinesByDay: emptyRoutinesByDay,
            updatedAt: nowIso,
          },
          { merge: true }
        )
        .then(() => true),
      3500
    );

    return Boolean(rootRes);
  } catch (err: any) {
    if (isPermissionError(err)) {
      isCloudWriteDisabled = true;
    } else {
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

  const db = getFirestoreDb();

  // Determine effective caller role with Firestore + in-memory tutor validation fallback
  let callerRole = caller.role;
  if (callerRole === 'student' && db) {
    try {
      const uCallerSnap = await withTimeout(db.collection('users').doc(callerUid).get(), 2500);
      if (uCallerSnap && uCallerSnap.exists) {
        const uData = uCallerSnap.data() || {};
        const uRole = String(uData.role || '').toLowerCase().trim();
        const isExplicitlyApproved =
          uData.approvalStatus !== 'pending' &&
          uData.approvalStatus !== 'rejected' &&
          uData.status !== 'pending' &&
          uData.status !== 'rejected' &&
          uData.isApproved !== false &&
          (uData.approvalStatus === 'approved' || uData.status === 'approved' || uData.isApproved === true || uData.approved === true);
        if ((uRole === 'teacher' || uRole === 'tutor' || uRole === 'native_friend' || uData.isTeacher === true) && isExplicitlyApproved) {
          callerRole = 'teacher';
        }
      }
      if (callerRole === 'student') {
        const tCallerSnap = await withTimeout(db.collection('tutors').doc(callerUid).get(), 2500);
        const tData = tCallerSnap && tCallerSnap.exists ? tCallerSnap.data() : null;
        if (
          tData &&
          tData.role !== 'student' &&
          tData.approvalStatus !== 'pending' &&
          tData.approvalStatus !== 'rejected' &&
          tData.status !== 'pending' &&
          tData.status !== 'rejected' &&
          tData.isApproved !== false &&
          (tData.approvalStatus === 'approved' || tData.status === 'approved' || tData.isApproved === true || tData.approved === true)
        ) {
          callerRole = 'teacher';
        }
      }
    } catch {}
  }

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
        error: 'Cross-student access prohibited. Students may only access their own routines.',
        statusCode: 403,
      };
    }
    if (cleanReqEmail && callerEmail && cleanReqEmail !== callerEmail) {
      return {
        authorized: false,
        canonicalStudentUid: '',
        studentEmail: '',
        error: 'Cross-student access prohibited. Students may only access their own routines.',
        statusCode: 403,
      };
    }
    return {
      authorized: true,
      canonicalStudentUid: caller.uid,
      studentEmail: callerEmail || cleanReqEmail,
    };
  }
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

      // Query user profile directly by UID doc AND by email/uid query for assigned native friend relationship
      if (!hasAuthorizedLink) {
        try {
          const docsToInspect: any[] = [];
          if (candidateUid && isValidCanonicalUid(candidateUid)) {
            const directSnap = await db.collection('users').doc(candidateUid).get().catch(() => null);
            if (directSnap && directSnap.exists) {
              docsToInspect.push(directSnap);
            }
          }
          if (docsToInspect.length === 0 && (authorizedEmail || candidateUid)) {
            const profileQuery = authorizedEmail
              ? db.collection('users').where('email', '==', authorizedEmail)
              : db.collection('users').where('uid', '==', candidateUid);
            const pSnap = await profileQuery.get();
            if (pSnap && !pSnap.empty) {
              docsToInspect.push(...pSnap.docs);
            }
          }
          for (const pDoc of docsToInspect) {
            const pData = pDoc.data();
            const assignedUid = pData?.assignedNativeFriendUID || pData?.teacherUid || pData?.assignedTeacherId;
            const assignedEmail = (pData?.teacherEmail || '').toLowerCase().trim();
            if ((assignedUid && (assignedUid === caller.uid || assignedUid === `tutor-${caller.uid}`)) || (assignedEmail && callerEmail && assignedEmail === callerEmail)) {
              hasAuthorizedLink = true;
              if (!authorizedEmail && pData.email) authorizedEmail = pData.email.toLowerCase().trim();
              const resolvedDocUid = (pData.uid && isValidCanonicalUid(pData.uid) ? pData.uid : (isValidCanonicalUid(pDoc.id) ? pDoc.id : ''));
              if ((!candidateUid || candidateUid.includes('@') || !isValidCanonicalUid(candidateUid) || candidateUid.startsWith('usr-')) && resolvedDocUid && resolvedDocUid !== caller.uid) {
                candidateUid = resolvedDocUid;
              }
              break;
            }
          }
        } catch {}
      }
    }

    // B2. Check server authoritative store (getAuthoritativeDb) for assigned student profile link
    if (!hasAuthorizedLink && dbLocal && authorizedEmail) {
      try {
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
          const lUid = (profile?.uid && isValidCanonicalUid(profile.uid) ? profile.uid : '') ||
            (student?.uid && isValidCanonicalUid(student.uid) ? student.uid : '') ||
            (student?.studentUid && isValidCanonicalUid(student.studentUid) ? student.studentUid : '');
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
      if (adminAuth && typeof adminAuth.getUser === 'function') {
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
      }
      if (db) {
        try {
          const uDoc = await db.collection('users').doc(candidateUid).get();
          if (uDoc && uDoc.exists) {
            const uData = uDoc.data() || {};
            return {
              authorized: true,
              canonicalStudentUid: uDoc.id,
              studentEmail: (uData.email || targetEmail || '').toLowerCase().trim(),
            };
          }
        } catch {}
      }
      if (!adminAuth) {
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
export function consolidateServerEntries(existingEntries: any[], newEntries: any[]): any[] {
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
      const resolvedNewDef = (item.definitionEn || item.meaningOrTip || '').trim();
      const isNewGeneric = !resolvedNewDef || isGenericPedagogicalDefinition(resolvedNewDef);
      const initialEnrichmentStatus = (item.enrichmentStatus === 'enriched' || (!isNewGeneric && Boolean(resolvedNewDef))) && !isItemProvisional
        ? 'enriched'
        : 'pending';

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
        practiceHistory: Array.isArray(item.practiceHistory) ? item.practiceHistory : [],
        origins: singleOrigins.map(removeUndefinedFields),
        enrichmentStatus: initialEnrichmentStatus,
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
    const resolvedTranslationPt = (item.translationPt || existing.translationPt || '').trim();
    const resolvedPartOfSpeech = (item.partOfSpeech || existing.partOfSpeech || '').trim();

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
    if (resolvedTranslationPt) {
      mergedEntry.translationPt = resolvedTranslationPt;
    }
    if (resolvedPartOfSpeech) {
      mergedEntry.partOfSpeech = resolvedPartOfSpeech;
    }
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
 * Semantically compares two values for dictionary entry properties.
 * Handles strings (trimmed), numbers, booleans, objects, arrays, and null/undefined.
 */
export function areValuesSemanticallyEqual(val1: any, val2: any): boolean {
  if (val1 === val2) return true;

  // Treat undefined, null, empty string, empty array, and empty plain object as semantically empty
  const isVal1Empty =
    val1 === undefined ||
    val1 === null ||
    val1 === '' ||
    (Array.isArray(val1) && val1.length === 0) ||
    (typeof val1 === 'object' && val1 !== null && !Array.isArray(val1) && Object.keys(val1).length === 0);
  const isVal2Empty =
    val2 === undefined ||
    val2 === null ||
    val2 === '' ||
    (Array.isArray(val2) && val2.length === 0) ||
    (typeof val2 === 'object' && val2 !== null && !Array.isArray(val2) && Object.keys(val2).length === 0);
  if (isVal1Empty && isVal2Empty) return true;
  if (isVal1Empty !== isVal2Empty) return false;

  // Handle strings with trimmed comparison
  if (typeof val1 === 'string' && typeof val2 === 'string') {
    return val1.trim() === val2.trim();
  }

  // Handle numbers
  if (typeof val1 === 'number' && typeof val2 === 'number') {
    return val1 === val2;
  }

  // Handle booleans
  if (typeof val1 === 'boolean' || typeof val2 === 'boolean') {
    return Boolean(val1) === Boolean(val2);
  }

  // Handle arrays
  if (Array.isArray(val1) && Array.isArray(val2)) {
    if (val1.length !== val2.length) return false;
    for (let i = 0; i < val1.length; i++) {
      if (!areValuesSemanticallyEqual(val1[i], val2[i])) return false;
    }
    return true;
  }
  if (Array.isArray(val1) || Array.isArray(val2)) {
    return false;
  }

  // Handle plain objects
  if (typeof val1 === 'object' && typeof val2 === 'object') {
    const keys1 = Object.keys(val1).filter(
      (k) => k !== 'updatedAt' && val1[k] !== undefined && val1[k] !== null && val1[k] !== ''
    );
    const keys2 = Object.keys(val2).filter(
      (k) => k !== 'updatedAt' && val2[k] !== undefined && val2[k] !== null && val2[k] !== ''
    );

    const keySet = new Set([...keys1, ...keys2]);
    for (const key of keySet) {
      if (!areValuesSemanticallyEqual(val1[key], val2[key])) {
        return false;
      }
    }
    return true;
  }

  return false;
}

/**
 * Determines whether a dictionary entry has materially changed compared to its existing Firestore document.
 * Compares:
 * 1. Word & Canonical identification (word, normalizedWord, originalWord, id, studentUid)
 * 2. Definitions & Translations (definitionEn, simpleDefinition, translationPt, translations, explanations, partOfSpeech, phonetic, ipa, audio, audioUrl)
 * 3. Examples (exampleSentenceEn, exampleSentence, examples array)
 * 4. Origins & Lesson references (origins array, lessonRefId, routineRef, source, sourceActivityName, sourceDay, learnedAt, firstSeenAt)
 * 5. Practice metrics (practiceCount, lastPracticedAt, practiceHistory)
 * 6. Pedagogical metadata (enrichmentStatus, isProvisional, isFallback, cefrLevel, customNotes, notFound, aiMetadata)
 * Excludes timestamp fields generated at persistence time (e.g. updatedAt).
 */
export function hasVocabularyEntryChanged(existingDoc: any, targetDoc: any): boolean {
  if (!existingDoc) return true;
  if (!targetDoc) return false;

  // 1. Core word & canonical identity
  const word1 = (existingDoc.word || '').trim();
  const word2 = (targetDoc.word || '').trim();
  if (word1.toLowerCase() !== word2.toLowerCase()) return true;

  const norm1 = (existingDoc.normalizedWord || word1).toLowerCase().trim();
  const norm2 = (targetDoc.normalizedWord || word2).toLowerCase().trim();
  if (norm1 !== norm2) return true;

  const origWord1 = (existingDoc.originalWord || word1).trim();
  const origWord2 = (targetDoc.originalWord || word2).trim();
  if (origWord1 !== origWord2) return true;

  // 2. Definitions and translations
  const def1 = (existingDoc.definitionEn || '').trim();
  const def2 = (targetDoc.definitionEn || '').trim();
  if (def1 !== def2) return true;

  const simpleDef1 = (existingDoc.simpleDefinition || '').trim();
  const simpleDef2 = (targetDoc.simpleDefinition || '').trim();
  if (simpleDef1 !== simpleDef2) return true;

  const transPt1 = (existingDoc.translationPt || '').trim();
  const transPt2 = (targetDoc.translationPt || '').trim();
  if (transPt1 !== transPt2) return true;

  const pos1 = (existingDoc.partOfSpeech || '').trim();
  const pos2 = (targetDoc.partOfSpeech || '').trim();
  if (pos1 !== pos2) return true;

  const phon1 = (existingDoc.phonetic || existingDoc.ipa || '').trim();
  const phon2 = (targetDoc.phonetic || targetDoc.ipa || '').trim();
  if (phon1 !== phon2) return true;

  const audio1 = (existingDoc.audio || existingDoc.audioUrl || '').trim();
  const audio2 = (targetDoc.audio || targetDoc.audioUrl || '').trim();
  if (audio1 !== audio2) return true;

  if (!areValuesSemanticallyEqual(existingDoc.translations, targetDoc.translations)) return true;
  if (!areValuesSemanticallyEqual(existingDoc.explanations, targetDoc.explanations)) return true;

  // 3. Examples
  const ex1 = (existingDoc.exampleSentenceEn || existingDoc.exampleSentence || '').trim();
  const ex2 = (targetDoc.exampleSentenceEn || targetDoc.exampleSentence || '').trim();
  if (ex1 !== ex2) return true;

  if (!areValuesSemanticallyEqual(existingDoc.examples, targetDoc.examples)) return true;

  // 4. Origins and lesson references
  if (!areValuesSemanticallyEqual(existingDoc.origins, targetDoc.origins)) return true;
  if (!areValuesSemanticallyEqual(existingDoc.routineRef, targetDoc.routineRef)) return true;

  const lessonRef1 = (existingDoc.lessonRefId || '').trim();
  const lessonRef2 = (targetDoc.lessonRefId || '').trim();
  if (lessonRef1 !== lessonRef2) return true;

  const source1 = (existingDoc.source || '').trim();
  const source2 = (targetDoc.source || '').trim();
  if (source1 !== source2) return true;

  const srcAct1 = (existingDoc.sourceActivityName || '').trim();
  const srcAct2 = (targetDoc.sourceActivityName || '').trim();
  if (srcAct1 !== srcAct2) return true;

  const srcDay1 = (existingDoc.sourceDay || '').trim();
  const srcDay2 = (targetDoc.sourceDay || '').trim();
  if (srcDay1 !== srcDay2) return true;

  // 5. Practice metrics
  const pCount1 = typeof existingDoc.practiceCount === 'number' ? existingDoc.practiceCount : 0;
  const pCount2 = typeof targetDoc.practiceCount === 'number' ? targetDoc.practiceCount : 0;
  if (pCount1 !== pCount2) return true;

  const lastPrac1 = (existingDoc.lastPracticedAt || '').trim();
  const lastPrac2 = (targetDoc.lastPracticedAt || '').trim();
  if (lastPrac1 !== lastPrac2) return true;

  if (!areValuesSemanticallyEqual(existingDoc.practiceHistory, targetDoc.practiceHistory)) return true;

  // 6. Pedagogical metadata
  const enrich1 = (existingDoc.enrichmentStatus || '').trim();
  const enrich2 = (targetDoc.enrichmentStatus || '').trim();
  if (enrich1 !== enrich2) return true;

  if (Boolean(existingDoc.isProvisional) !== Boolean(targetDoc.isProvisional)) return true;
  if (Boolean(existingDoc.isFallback) !== Boolean(targetDoc.isFallback)) return true;
  if (Boolean(existingDoc.notFound) !== Boolean(targetDoc.notFound)) return true;

  const cefr1 = (existingDoc.cefrLevel || '').trim();
  const cefr2 = (targetDoc.cefrLevel || '').trim();
  if (cefr1 !== cefr2) return true;

  const notes1 = (existingDoc.customNotes || '').trim();
  const notes2 = (targetDoc.customNotes || '').trim();
  if (notes1 !== notes2) return true;

  if (!areValuesSemanticallyEqual(existingDoc.aiMetadata, targetDoc.aiMetadata)) return true;

  // 7. General equality for any additional custom keys (ignoring updatedAt, studentUid, studentEmail)
  const ignoredKeys = new Set(['updatedAt', 'studentUid', 'studentEmail']);
  const allKeys = new Set([
    ...Object.keys(existingDoc || {}),
    ...Object.keys(targetDoc || {}),
  ]);

  for (const k of allKeys) {
    if (ignoredKeys.has(k)) continue;
    if (k === 'id') {
      const id1 = (existingDoc.id || '').trim();
      const id2 = (targetDoc.id || '').trim();
      if (id1 && id2 && id1 !== id2) return true;
      if (!id1 && id2) return true;
      continue;
    }
    if (!areValuesSemanticallyEqual(existingDoc[k], targetDoc[k])) {
      return true;
    }
  }

  return false;
}

/**
 * Server-side persistent storage of student vocabulary in Cloud Firestore.
 * Strictly requires a canonical student Firebase Auth UID (rejects synthetic usr-* / st-* or teacher UID).
 * Persists to canonical document users/{canonicalStudentUid} and subcollection users/{canonicalStudentUid}/vocabulary/{wordDocId}.
 * HOTFIX: Eliminates redundant writes to both root document and subcollection when documents are unchanged.
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
    let existingRootVocab: any[] = [];
    let rootDocExists = false;
    let rootUserData: any = null;

    try {
      const userSnap = await db.collection('users').doc(cleanUid).get();
      if (userSnap.exists) {
        rootDocExists = true;
        rootUserData = userSnap.data();
        if (Array.isArray(rootUserData?.vocabulary)) {
          existingRootVocab = rootUserData.vocabulary;
          existingList = [...existingRootVocab];
        }
      }
    } catch {}

    // 2. Fetch existing entries from canonical subcollection
    const existingSubcollectionByDocId = new Map<string, any>();
    const existingSubcollectionByNormWord = new Map<string, any>();

    try {
      const subSnap = await db.collection('users').doc(cleanUid).collection('vocabulary').get();
      if (!subSnap.empty) {
        subSnap.forEach((docItem) => {
          const item = docItem.data();
          if (item && item.word) {
            existingSubcollectionByDocId.set(docItem.id, item);
            const norm = (item.normalizedWord || item.word).toLowerCase().trim();
            if (norm) {
              existingSubcollectionByNormWord.set(norm, item);
            }
            existingList.push(item);
          }
        });
      }
    } catch {}

    // 3. Consolidate entries cumulatively and recursively eliminate all undefined fields
    const consolidated = removeUndefinedFields(consolidateServerEntries(existingList, sanitizedEntries));

    // 4. Save to canonical root document users/{cleanUid} ONLY if vocabulary content has changed
    let rootChanged = !rootDocExists || !Array.isArray(rootUserData?.vocabulary);
    if (!rootChanged) {
      if (existingRootVocab.length !== consolidated.length) {
        rootChanged = true;
      } else {
        const rootMap = new Map<string, any>();
        for (const item of existingRootVocab) {
          if (item && item.word) {
            const k = (item.normalizedWord || item.word).toLowerCase().trim();
            rootMap.set(k, item);
          }
        }
        if (rootMap.size !== consolidated.length) {
          rootChanged = true;
        } else {
          for (const item of consolidated) {
            const k = (item.normalizedWord || item.word).toLowerCase().trim();
            const existingRootItem = rootMap.get(k);
            if (!existingRootItem || hasVocabularyEntryChanged(existingRootItem, item)) {
              rootChanged = true;
              break;
            }
          }
        }
      }
    }

    if (rootChanged) {
      const rootPayload = removeUndefinedFields({
        vocabulary: consolidated,
        updatedAt: new Date().toISOString(),
      });
      await db.collection('users').doc(cleanUid).set(rootPayload, { merge: true });
    }

    // 5. Save individual entries to subcollection users/{cleanUid}/vocabulary/{wordDocId}
    // HOTFIX: Only persist new or effectively modified documents to eliminate redundant Firestore writes!
    for (const item of consolidated) {
      if (item && item.word) {
        const rawWord = (item.normalizedWord || item.word).toLowerCase().trim();
        const wordDocId = rawWord.replace(/[^a-zA-Z0-9_-]/g, '_');
        const existingSubDoc = existingSubcollectionByDocId.get(wordDocId) || existingSubcollectionByNormWord.get(rawWord);

        const targetDocData = removeUndefinedFields({
          ...item,
          studentUid: cleanUid,
          ...(cleanEmail || item.studentEmail ? { studentEmail: cleanEmail || item.studentEmail } : {}),
        });

        const isNewDoc = !existingSubDoc;
        const isModified = isNewDoc || hasVocabularyEntryChanged(existingSubDoc, targetDocData);

        if (isModified) {
          const docPayload = removeUndefinedFields({
            ...targetDocData,
            updatedAt: new Date().toISOString(),
          });
          await db.collection('users').doc(cleanUid).collection('vocabulary').doc(wordDocId).set(
            docPayload,
            { merge: true }
          );
        }
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
  } catch (err: any) {
    if (isPermissionError(err)) {
      isCloudWriteDisabled = true;
      return [];
    }
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
  } catch (err: any) {
    if (isPermissionError(err)) {
      isCloudWriteDisabled = true;
      return [];
    }
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
    studentEmail?: string;
    studentUid?: string;
    teacherEmail?: string;
    teacherUid?: string;
    teacherName?: string;
    topic?: string;
    content: string;
    rawContent?: string;
    originalTeacherNotes?: any;
    draftTransformation?: any;
    lastApprovedVersion?: any;
    approvalStatus?: 'unapproved' | 'draft_in_progress' | 'approved';
    versionHistory?: any[];
    currentVersionNumber?: number;
    createdAt?: string;
    updatedAt?: string;
    lastSavedByUid?: string;
    driveFileId?: string;
    driveFileUrl?: string;
    driveFolderName?: string;
    driveLastSyncedAt?: string;
  }
): Promise<boolean> {
  if (isCloudWriteDisabled) return false;
  const db = getFirestoreDb();
  if (!db || !sessionKey || !data) return false;

  // Canonical Identity Contract: studentUid and teacherUid must be valid canonical UIDs
  const studentUid = (data.studentUid || '').trim();
  const teacherUid = (data.teacherUid || '').trim();

  if (!studentUid || !isValidCanonicalUid(studentUid)) {
    console.warn('[serverFirestore] saveSessionNotesToFirestoreServer rejected: studentUid is missing or non-canonical.');
    return false;
  }
  if (!teacherUid || !isValidCanonicalUid(teacherUid)) {
    console.warn('[serverFirestore] saveSessionNotesToFirestoreServer rejected: teacherUid is missing or non-canonical.');
    return false;
  }

  try {
    const cleanKey = sessionKey.replace(/[^a-zA-Z0-9_-]/g, '_');

    // Idempotency check: preserve original createdAt and lastApprovedVersion if doc exists
    let existingCreatedAt = data.createdAt;
    let existingApprovedVersion = data.lastApprovedVersion;
    let existingOriginalNotes = data.originalTeacherNotes;
    let existingDraft = data.draftTransformation;
    let existingHistory = data.versionHistory;
    let existingApprovalStatus = data.approvalStatus;

    try {
      const existingDoc = await db.collection('session_notes').doc(cleanKey).get();
      if (existingDoc && existingDoc.exists) {
        const exData = existingDoc.data() || {};
        existingCreatedAt = exData.createdAt || existingCreatedAt;
        // FASE NF-DOC.2A: A new edit MUST NOT erase or unpublish the previously approved version
        if (existingApprovedVersion === undefined && exData.lastApprovedVersion) {
          existingApprovedVersion = exData.lastApprovedVersion;
        }
        if (!existingOriginalNotes && exData.originalTeacherNotes) {
          existingOriginalNotes = exData.originalTeacherNotes;
        }
        if (existingDraft === undefined && exData.draftTransformation) {
          existingDraft = exData.draftTransformation;
        }
        if ((!existingHistory || existingHistory.length === 0) && Array.isArray(exData.versionHistory)) {
          existingHistory = exData.versionHistory;
        }
        if (!existingApprovalStatus && exData.approvalStatus) {
          existingApprovalStatus = exData.approvalStatus;
        }
      }
    } catch {}

    const nowIso = new Date().toISOString();
    const effectiveCreatedAt = existingCreatedAt || nowIso;
    const rawContent = data.rawContent || data.content || '';

    const effectiveApprovedVersion = data.lastApprovedVersion !== undefined ? data.lastApprovedVersion : (existingApprovedVersion || null);
    const effectiveDraft = data.draftTransformation !== undefined ? data.draftTransformation : (existingDraft || null);
    const effectiveApprovalStatus = effectiveApprovedVersion ? 'approved' : effectiveDraft ? 'draft_in_progress' : (data.approvalStatus || existingApprovalStatus || 'unapproved');

    const sanitized = JSON.parse(JSON.stringify({
      ...data,
      id: cleanKey,
      sessionId: cleanKey,
      sessionKey: cleanKey,
      lessonId: data.lessonId || '',
      studentUid,
      teacherUid,
      sessionDate: data.sessionDate,
      rawContent,
      content: data.content || rawContent,
      topic: data.topic || '',
      originalTeacherNotes: data.originalTeacherNotes || existingOriginalNotes || null,
      draftTransformation: effectiveDraft,
      lastApprovedVersion: effectiveApprovedVersion,
      approvalStatus: effectiveApprovalStatus,
      versionHistory: data.versionHistory || existingHistory || [],
      currentVersionNumber: data.currentVersionNumber || (Array.isArray(existingHistory) && existingHistory.length > 0 ? Math.max(...existingHistory.map((v: any) => v.versionNumber || 0)) : 1),
      createdAt: effectiveCreatedAt,
      updatedAt: data.updatedAt || nowIso,
      lastSavedByUid: teacherUid,
    }));

    const savePromises: Promise<any>[] = [
      db.collection('session_notes').doc(cleanKey).set(sanitized, { merge: true }),
      db.collection('users').doc(studentUid).collection('session_notes').doc(cleanKey).set(sanitized, { merge: true }),
    ];

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
            studentUid,
            teacherUid,
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
 * Canonical retrieval of session notes for a verified student directly from Firestore (default).
 * FASE NF-NOTES.6: Queries root session_notes where studentUid == studentUid and
 * users/{studentUid}/session_notes, merging and deduplicating by session key.
 * Guarantees that rawContent is preserved regardless of AI status.
 */
export async function fetchSessionNotesForStudentServer(studentUid: string, sessionKey?: string): Promise<any[]> {
  const db = getFirestoreDb();
  if (!db || !studentUid || !isValidCanonicalUid(studentUid)) return [];
  try {
    const resultsMap = new Map<string, any>();

    if (sessionKey) {
      const cleanKey = sessionKey.replace(/[^a-zA-Z0-9_-]/g, '_');
      // 1. Check user subcollection
      const snap = await db.collection('users').doc(studentUid).collection('session_notes').doc(cleanKey).get();
      if (snap && snap.exists) {
        const d = snap.data();
        if (d && (d.studentUid === studentUid || !d.studentUid)) {
          return [{
            id: snap.id,
            ...d,
            rawContent: d.rawContent || d.content,
            content: d.content || d.rawContent,
          }];
        }
      }
      // 2. Check root collection session_notes
      const globalSnap = await db.collection('session_notes').doc(cleanKey).get();
      if (globalSnap && globalSnap.exists) {
        const d = globalSnap.data();
        if (d && d.studentUid === studentUid) {
          return [{
            id: globalSnap.id,
            ...d,
            rawContent: d.rawContent || d.content,
            content: d.content || d.rawContent,
          }];
        }
      }
      return [];
    }

    // 1. Query root session_notes collection by studentUid
    try {
      const rootSnap = await db.collection('session_notes').where('studentUid', '==', studentUid).get();
      if (rootSnap && !rootSnap.empty) {
        rootSnap.forEach((docSnap) => {
          const d = docSnap.data();
          if (d && d.studentUid === studentUid) {
            const rawContent = d.rawContent || d.content || '';
            const key = docSnap.id;
            resultsMap.set(key, {
              id: key,
              ...d,
              rawContent,
              content: d.content || rawContent,
            });
          }
        });
      }
    } catch (rootErr) {
      if (!isPermissionError(rootErr)) {
        console.warn('[serverFirestore] root session_notes query notice:', rootErr);
      }
    }

    // 2. Query subcollection users/{studentUid}/session_notes
    try {
      const colSnap = await db.collection('users').doc(studentUid).collection('session_notes').get();
      if (colSnap && !colSnap.empty) {
        colSnap.forEach((docSnap) => {
          if (docSnap.id === 'review_cycle') return;
          const d = docSnap.data();
          // In user subcollection: accept matches or historical records with no conflicting studentUid
          if (d && (d.studentUid === studentUid || !d.studentUid)) {
            const key = docSnap.id;
            if (!resultsMap.has(key)) {
              const rawContent = d.rawContent || d.content || '';
              resultsMap.set(key, {
                id: key,
                ...d,
                rawContent,
                content: d.content || rawContent,
              });
            }
          }
        });
      }
    } catch (colErr) {
      if (!isPermissionError(colErr)) {
        console.warn('[serverFirestore] users/{studentUid}/session_notes query notice:', colErr);
      }
    }

    return Array.from(resultsMap.values());
  } catch (err: any) {
    if (!isPermissionError(err)) {
      console.warn('[serverFirestore] fetchSessionNotesForStudentServer notice:', err);
    }
    return [];
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
  transformation: any,
  options?: { rawNotes?: string }
): Promise<boolean> {
  if (isCloudWriteDisabled) return false;
  const db = getFirestoreDb();
  if (!db || !compositeCacheKey || !transformation) return false;

  const rawNotesContext = options?.rawNotes || transformation?.rawNotesSnippet;

  // HOTFIX 2.1 — Persist ONLY valid pedagogical transformations (zero provisional, zero fallback, zero generic)
  if (
    !transformation.isAiGenerated ||
    transformation.isFallback ||
    transformation.isProvisional ||
    isLegacyGenericTransformation(transformation, rawNotesContext)
  ) {
    console.info('[serverFirestore] Refusing to persist invalid or generic transformation to Firestore');
    return false;
  }

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
  } catch (err: any) {
    if (isPermissionError(err)) {
      isCloudWriteDisabled = true;
      return false;
    }
    console.warn('Firestore savePedagogicalTransformation error:', err);
    return false;
  }
}

/**
 * Retrieve pedagogical transformation from Cloud Firestore
 */
export async function fetchPedagogicalTransformationFromFirestoreServer(
  compositeCacheKeyOrSessionKey: string,
  options?: { language?: string; contentHash?: string; rawNotes?: string }
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
        const noteCtx = options?.rawNotes || data?.rawNotesSnippet;
        if (data && data.isAiGenerated && !data.isProvisional && !isLegacyGenericTransformation(data, noteCtx)) {
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
        const noteCtx = options?.rawNotes || data?.rawNotesSnippet;
        if (data && data.isAiGenerated && !data.isProvisional && !isLegacyGenericTransformation(data, noteCtx)) {
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
    mistakesAnalysis: Array.isArray(transformation.mistakesAnalysis) ? transformation.mistakesAnalysis : [],
    grammarPoints: Array.isArray(transformation.grammarPoints) ? transformation.grammarPoints : [],
  };

  const sanitized = removeUndefinedFields(journalEntry);

  const db = getFirestoreDb();
  if (db && !isCloudWriteDisabled) {
    try {
      const userRef = db.collection('users').doc(cleanUid);
      const subDocRef = userRef.collection('journal').doc(entryId);
      // ARCH.2F.2A: Persist exclusively in users/{studentUid}/journal/{entryId} (no root array mirror)
      await subDocRef.set(sanitized, { merge: true });
    } catch (fsErr) {
      if (!isPermissionError(fsErr)) {
        console.warn('Firestore recordLessonReviewInStudentJournal notice:', fsErr);
      }
    }
  }

  return { success: true, entry: sanitized };
}

function sanitizeJournalDocId(rawId: string): string {
  const clean = String(rawId || '').trim().replace(/\//g, '_');
  if (!clean) return `entry_${Date.now()}`;
  const safe = clean.replace(/[^a-zA-Z0-9._-]/g, '_');
  return safe || `entry_${Date.now()}`;
}

function buildActivitySlotKey(entry: any): string | null {
  const type = String(entry?.type || '').toLowerCase().trim();
  const day = String(entry?.dayOfWeek || '').toLowerCase().trim();
  const cycle = parsePositiveCycleFromFirestore(entry?.week);
  if (!type || !day || cycle === null) return null;
  return `${type}__${day}__${cycle}`;
}

/**
 * ARCH.2F.2A: Canonical Daily Journal save helper.
 * Persists strictly in users/{uid}/journal/{entryId} without root array mirrors.
 */
export async function saveStudentDailyJournalEntryServer(
  uid: string,
  entry: any
): Promise<{ ok: boolean; entry?: any; error?: string; statusCode?: number }> {
  if (isCloudWriteDisabled) {
    return { ok: false, statusCode: 500, error: 'Firestore writes disabled by IAM credentials.' };
  }
  const db = getFirestoreDb();
  if (!db || !uid) {
    return { ok: false, statusCode: 503, error: 'Canonical Firestore database unavailable.' };
  }
  if (!entry || !entry.id || String(entry.id).trim() === '') {
    return { ok: false, statusCode: 400, error: 'Valid entry with id is required.' };
  }

  try {
    const cleanUid = uid.trim();
    const docId = sanitizeJournalDocId(String(entry.id));
    const nowIso = new Date().toISOString();
    const cleanEntry = removeUndefinedFields({
      ...entry,
      id: String(entry.id).trim(),
      studentUid: cleanUid,
      createdAt: entry.createdAt || nowIso,
      updatedAt: nowIso,
    });
    await db.collection('users').doc(cleanUid).collection('journal').doc(docId).set(cleanEntry, { merge: true });
    return { ok: true, entry: cleanEntry };
  } catch (err: any) {
    if (isPermissionError(err)) {
      isCloudWriteDisabled = true;
      return { ok: false, statusCode: 500, error: 'Firestore write restricted by IAM credentials.' };
    }
    console.warn('[serverFirestore] saveStudentDailyJournalEntryServer error:', err);
    return { ok: false, statusCode: 500, error: err?.message || 'Failed to save journal entry to Firestore.' };
  }
}

/**
 * ARCH.2F.2A: Fetch Activity Journal from canonical users/{uid}/activity_journal/{entryId}
 * with read-only legacy fallback (users/{uid}/studentJournal & users/{uid}.studentJournal).
 */
export async function fetchStudentActivityJournalFromServerFirestore(
  uid: string
): Promise<{ ok: boolean; entries: any[]; error?: string; statusCode?: number }> {
  const db = getFirestoreDb();
  if (!db || !uid) {
    return { ok: false, entries: [], statusCode: 503, error: 'Canonical Firestore database unavailable.' };
  }

  try {
    const cleanUid = uid.trim();
    const userRef = db.collection('users').doc(cleanUid);
    const [canonicalSnap, legacySubSnap, userSnap] = await Promise.all([
      withTimeout(userRef.collection('activity_journal').get(), 4500),
      withTimeout(userRef.collection('studentJournal').get(), 4500).catch(() => null),
      withTimeout(userRef.get(), 4500).catch(() => null),
    ]);

    if (canonicalSnap === null) {
      return { ok: false, entries: [], statusCode: 503, error: 'Timed out reading Activity Journal from Firestore.' };
    }

    const byId = new Map<string, any>();
    const occupiedSlots = new Set<string>();

    const addEntryIfNovel = (raw: any, isCanonical: boolean) => {
      if (!raw || typeof raw !== 'object') return;
      const eid = String(raw.id || '').trim();
      if (!eid) return;
      const normalized = { ...raw, id: eid };
      const slotKey = buildActivitySlotKey(normalized);

      if (isCanonical) {
        if (!byId.has(eid)) {
          byId.set(eid, normalized);
          if (slotKey) occupiedSlots.add(slotKey);
        }
        return;
      }

      if (byId.has(eid)) return;
      if (slotKey && occupiedSlots.has(slotKey)) return;
      byId.set(eid, normalized);
      if (slotKey) occupiedSlots.add(slotKey);
    };

    canonicalSnap.forEach((docSnap: any) => {
      const d = docSnap.data();
      if (d) {
        addEntryIfNovel({ ...d, id: d.id || docSnap.id }, true);
      }
    });

    if (legacySubSnap && !legacySubSnap.empty) {
      legacySubSnap.forEach((docSnap: any) => {
        const d = docSnap.data();
        if (d) {
          addEntryIfNovel({ ...d, id: d.id || docSnap.id }, false);
        }
      });
    }

    if (userSnap && userSnap.exists) {
      const uData = userSnap.data() || {};
      if (Array.isArray(uData.studentJournal)) {
        uData.studentJournal.forEach((item: any) => addEntryIfNovel(item, false));
      }
    }

    const entries = Array.from(byId.values()).sort((a, b) => (Number(b.timestamp) || 0) - (Number(a.timestamp) || 0));
    return { ok: true, entries };
  } catch (err: any) {
    if (isPermissionError(err)) {
      isCloudWriteDisabled = true;
      return { ok: false, entries: [], statusCode: 500, error: 'Firestore read restricted by IAM.' };
    }
    console.warn('[serverFirestore] fetchStudentActivityJournalFromServerFirestore error:', err);
    return { ok: false, entries: [], statusCode: 500, error: err?.message || 'Failed to read Activity Journal from Firestore.' };
  }
}

const VALID_ACTIVITY_JOURNAL_TYPES = new Set(['video', 'audio', 'memorization', 'live_lesson']);

/**
 * ARCH.2F.2A: Persist Activity Journal entry strictly in users/{uid}/activity_journal/{entryId}.
 * Guarantees idempotency on (id) and (type, dayOfWeek, week) slot without writing root arrays, RAM, or app_state.
 */
export async function upsertStudentActivityJournalEntryServer(
  uid: string,
  rawEntry: any,
  fallbackEmail?: string
): Promise<{ ok: boolean; entry?: any; entries?: any[]; error?: string; statusCode?: number }> {
  if (isCloudWriteDisabled) {
    return { ok: false, statusCode: 500, error: 'Firestore writes disabled by IAM credentials.' };
  }
  const db = getFirestoreDb();
  if (!db || !uid) {
    return { ok: false, statusCode: 503, error: 'Canonical Firestore database unavailable.' };
  }
  if (!rawEntry || typeof rawEntry !== 'object' || !rawEntry.type) {
    return { ok: false, statusCode: 400, error: 'Valid activity entry with type is required.' };
  }

  const normalizedType = String(rawEntry.type).trim();
  if (!VALID_ACTIVITY_JOURNAL_TYPES.has(normalizedType)) {
    return { ok: false, statusCode: 400, error: `Invalid activity type '${normalizedType}'.` };
  }

  try {
    const cleanUid = uid.trim();
    const userRef = db.collection('users').doc(cleanUid);
    const activityCol = userRef.collection('activity_journal');

    const isExplicitWeekSupplied =
      rawEntry.week !== undefined &&
      rawEntry.week !== null &&
      (typeof rawEntry.week !== 'string' || rawEntry.week.trim() !== '');

    let resolvedWeek: number | null = null;
    if (isExplicitWeekSupplied) {
      resolvedWeek = parsePositiveCycleFromFirestore(rawEntry.week);
      if (resolvedWeek === null) {
        return {
          ok: false,
          statusCode: 400,
          error: `Explicit week '${rawEntry.week}' is malformed.`,
        };
      }
    } else {
      const userSnap = await withTimeout(userRef.get(), 4000).catch(() => null);
      const uData = userSnap && userSnap.exists ? userSnap.data() : null;
      resolvedWeek = parsePositiveCycleFromFirestore(uData?.weeklyCycle) ?? 1;
    }

    const cleanDay = rawEntry.dayOfWeek ? String(rawEntry.dayOfWeek).toLowerCase().trim() : undefined;
    const cleanEmail = (rawEntry.studentEmail || fallbackEmail || '').toLowerCase().trim();
    const rawId = rawEntry.id ? String(rawEntry.id).trim() : '';
    const canonicalEntryId = rawId
      ? rawId
      : `${normalizedType}_${cleanDay || 'any'}_${resolvedWeek}_${Date.now()}`;
    const docId = sanitizeJournalDocId(canonicalEntryId);
    const nowIso = new Date().toISOString();

    const sanitizedEntry = removeUndefinedFields({
      id: canonicalEntryId,
      type: normalizedType,
      date: rawEntry.date || nowIso.split('T')[0],
      timestamp: Number(rawEntry.timestamp) || Date.now(),
      studentUid: cleanUid,
      week: resolvedWeek,
      ...(cleanDay ? { dayOfWeek: cleanDay } : {}),
      ...(cleanEmail ? { studentEmail: cleanEmail } : {}),
      ...(rawEntry.title ? { title: String(rawEntry.title).trim() } : {}),
      ...(rawEntry.artist ? { artist: String(rawEntry.artist).trim() } : {}),
      ...(rawEntry.partNumber !== undefined && rawEntry.partNumber !== null ? { partNumber: Number(rawEntry.partNumber) } : {}),
      ...(rawEntry.url ? { url: String(rawEntry.url).trim() } : {}),
      ...(rawEntry.details ? { details: String(rawEntry.details).trim() } : {}),
      ...(rawEntry.completedAt ? { completedAt: rawEntry.completedAt } : {}),
      ...(rawEntry.isRepeat !== undefined ? { isRepeat: Boolean(rawEntry.isRepeat) } : {}),
      ...(rawEntry.isRepeatVideo !== undefined ? { isRepeatVideo: Boolean(rawEntry.isRepeatVideo) } : {}),
      updatedAt: nowIso,
    });

    await activityCol.doc(docId).set(sanitizedEntry, { merge: true });

    // Remove superseded docs for the same (type, dayOfWeek, week) slot in activity_journal to maintain strict idempotency
    if (cleanDay) {
      const existingSnap = await withTimeout(activityCol.where('type', '==', normalizedType).get(), 4000).catch(() => null);
      if (existingSnap && !existingSnap.empty) {
        const cleanupPromises: Promise<any>[] = [];
        existingSnap.forEach((docSnap: any) => {
          if (docSnap.id === docId) return;
          const d = docSnap.data();
          const dDay = d?.dayOfWeek ? String(d.dayOfWeek).toLowerCase().trim() : '';
          const dWeek = parsePositiveCycleFromFirestore(d?.week);
          if (dDay === cleanDay && dWeek === resolvedWeek) {
            cleanupPromises.push(docSnap.ref.delete().catch(() => {}));
          }
        });
        if (cleanupPromises.length > 0) {
          await Promise.all(cleanupPromises);
        }
      }
    }

    const refreshed = await fetchStudentActivityJournalFromServerFirestore(cleanUid);
    return {
      ok: true,
      entry: sanitizedEntry,
      entries: refreshed.ok ? refreshed.entries : [sanitizedEntry],
    };
  } catch (err: any) {
    if (isPermissionError(err)) {
      isCloudWriteDisabled = true;
      return { ok: false, statusCode: 500, error: 'Firestore writes disabled by IAM credentials.' };
    }
    console.warn('[serverFirestore] upsertStudentActivityJournalEntryServer error:', err);
    return { ok: false, statusCode: 500, error: err?.message || 'Failed to save activity journal entry.' };
  }
}

/**
 * ARCH.2F.2A: Delete Activity Journal entry from users/{uid}/activity_journal/{entryId}.
 * Also removes matching legacy entry from users/{uid}/studentJournal or users/{uid}.studentJournal ONLY if present,
 * ensuring deleted activities never reappear while never creating new root mirrors.
 */
export async function deleteStudentActivityJournalEntryServer(
  uid: string,
  params: { entryId?: string; id?: string; type?: string; dayOfWeek?: string; week?: number | string | null }
): Promise<{ ok: boolean; deletedIds?: string[]; entries?: any[]; error?: string; statusCode?: number }> {
  if (isCloudWriteDisabled) {
    return { ok: false, statusCode: 500, error: 'Firestore writes disabled by IAM credentials.' };
  }
  const db = getFirestoreDb();
  if (!db || !uid) {
    return { ok: false, statusCode: 503, error: 'Canonical Firestore database unavailable.' };
  }

  const targetEntryId = String(params.entryId || params.id || '').trim();
  const targetType = params.type ? String(params.type).trim() : '';
  const targetDay = params.dayOfWeek ? String(params.dayOfWeek).toLowerCase().trim() : '';
  const isExplicitWeekSupplied =
    params.week !== undefined &&
    params.week !== null &&
    (typeof params.week !== 'string' || params.week.trim() !== '');

  let resolvedCycle: number | null = null;
  if (isExplicitWeekSupplied) {
    resolvedCycle = parsePositiveCycleFromFirestore(params.week);
    if (resolvedCycle === null) {
      return { ok: false, statusCode: 400, error: `Explicit week '${params.week}' is malformed.` };
    }
  }

  if (!targetEntryId && !targetType) {
    return { ok: false, statusCode: 400, error: 'entryId/id or type is required to delete activity.' };
  }

  try {
    const cleanUid = uid.trim();
    const userRef = db.collection('users').doc(cleanUid);
    const activityCol = userRef.collection('activity_journal');
    const legacySubCol = userRef.collection('studentJournal');

    const [canonicalSnap, legacySubSnap, userSnap] = await Promise.all([
      withTimeout(activityCol.get(), 4500),
      withTimeout(legacySubCol.get(), 4500).catch(() => null),
      withTimeout(userRef.get(), 4500).catch(() => null),
    ]);

    if (canonicalSnap === null) {
      return { ok: false, statusCode: 503, error: 'Timed out accessing Activity Journal in Firestore.' };
    }

    const uData = userSnap && userSnap.exists ? (userSnap.data() || {}) : null;

    if (!targetEntryId && resolvedCycle === null) {
      resolvedCycle = parsePositiveCycleFromFirestore(uData?.weeklyCycle);
      if (resolvedCycle === null) {
        return {
          ok: false,
          statusCode: 400,
          error: 'Week identity cannot be determined for activity deletion without entryId.',
        };
      }
    }

    const sanitizedTargetDocId = targetEntryId ? sanitizeJournalDocId(targetEntryId) : '';
    const matchesTarget = (d: any, docId?: string): boolean => {
      if (!d && !docId) return false;
      const eid = String(d?.id || docId || '').trim();
      if (targetEntryId && (eid === targetEntryId || docId === targetEntryId || docId === sanitizedTargetDocId)) {
        return true;
      }
      if (!targetType) return false;
      const dType = String(d?.type || '').trim();
      if (dType !== targetType) return false;
      const dDay = String(d?.dayOfWeek || '').toLowerCase().trim();
      if (targetDay && dDay !== targetDay) return false;
      if (resolvedCycle !== null) {
        const dCycle = parsePositiveCycleFromFirestore(d?.week);
        if (dCycle !== resolvedCycle && !(resolvedCycle === 1 && dCycle === null)) {
          return false;
        }
      }
      return true;
    };

    const deletedIds: string[] = [];
    const deletePromises: Promise<any>[] = [];

    canonicalSnap.forEach((docSnap: any) => {
      const d = docSnap.data();
      if (matchesTarget(d, docSnap.id)) {
        deletedIds.push(String(d?.id || docSnap.id));
        deletePromises.push(docSnap.ref.delete());
      }
    });

    if (legacySubSnap && !legacySubSnap.empty) {
      legacySubSnap.forEach((docSnap: any) => {
        const d = docSnap.data();
        if (matchesTarget(d, docSnap.id)) {
          deletePromises.push(docSnap.ref.delete().catch(() => {}));
        }
      });
    }

    await Promise.all(deletePromises);

    // Strip deleted item(s) from legacy users/{uid}.studentJournal ONLY if the legacy array already exists and contains matches
    if (uData && Array.isArray(uData.studentJournal) && uData.studentJournal.some((e: any) => matchesTarget(e))) {
      const filteredLegacy = uData.studentJournal.filter((e: any) => !matchesTarget(e));
      await userRef.set({ studentJournal: filteredLegacy, updatedAt: new Date().toISOString() }, { merge: true });
    }

    const refreshed = await fetchStudentActivityJournalFromServerFirestore(cleanUid);
    return {
      ok: true,
      deletedIds,
      entries: refreshed.ok ? refreshed.entries : [],
    };
  } catch (err: any) {
    if (isPermissionError(err)) {
      isCloudWriteDisabled = true;
      return { ok: false, statusCode: 500, error: 'Firestore delete restricted by IAM credentials.' };
    }
    console.warn('[serverFirestore] deleteStudentActivityJournalEntryServer error:', err);
    return { ok: false, statusCode: 500, error: err?.message || 'Failed to delete activity journal entry.' };
  }
}

/**
 * Legacy helper retained only for backwards export compatibility (no-op mirror avoided).
 */
export async function saveStudentJournalToFirestore(_docId: string, _journal: any[]): Promise<boolean> {
  return true;
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
        if (d) {
          const entryId = (d.id && String(d.id).trim()) || docSnap.id;
          if (entryId) {
            map.set(entryId, { ...d, id: entryId });
          }
        }
      });
    }
    const userSnap = await userRef.get();
    if (userSnap.exists) {
      const data = userSnap.data();
      if (Array.isArray(data?.dailyJournalEntries)) {
        data.dailyJournalEntries.forEach((e: any) => {
          if (e) {
            const entryId = (e.id && String(e.id).trim()) || '';
            if (entryId && !map.has(entryId)) {
              map.set(entryId, { ...e, id: entryId });
            }
          }
        });
      }
    }
    const list = Array.from(map.values()).sort((a, b) => {
      const tA = new Date(a.createdAt || a.date).getTime();
      const tB = new Date(b.createdAt || b.date).getTime();
      return tB - tA;
    });
    return list;
  } catch (err: any) {
    if (isPermissionError(err)) {
      isCloudWriteDisabled = true;
      return [];
    }
    console.warn('fetchStudentDailyJournalFromServerFirestore error:', err);
    return [];
  }
}

/**
 * Delete a student daily journal entry directly from Cloud Firestore (users/{studentUid}/journal/{entryId} and users/{studentUid}.dailyJournalEntries)
 */
export async function deleteStudentJournalEntryFromServerFirestore(
  studentUid: string,
  entryId: string
): Promise<boolean> {
  const db = getFirestoreDb();
  if (!db || !studentUid || !entryId) return false;
  try {
    const cleanUid = studentUid.trim();
    const userRef = db.collection('users').doc(cleanUid);
    const sanitizedId = sanitizeJournalDocId(entryId);

    // 1. Delete from canonical subcollection users/{studentUid}/journal/{entryId}
    await userRef.collection('journal').doc(entryId).delete();
    if (sanitizedId && sanitizedId !== entryId) {
      await userRef.collection('journal').doc(sanitizedId).delete().catch(() => {});
    }

    // 2. Clean legacy dailyJournalEntries array ONLY if it already exists and contains this entryId
    const userSnap = await userRef.get().catch(() => null);
    if (userSnap && userSnap.exists) {
      const data = userSnap.data();
      if (Array.isArray(data?.dailyJournalEntries) && data.dailyJournalEntries.some((e: any) => e?.id === entryId)) {
        const filtered = data.dailyJournalEntries.filter((e: any) => e?.id !== entryId);
        await userRef.set(
          { dailyJournalEntries: filtered, updatedAt: new Date().toISOString() },
          { merge: true }
        );
      }
    }
    return true;
  } catch (err: any) {
    if (isPermissionError(err)) {
      isCloudWriteDisabled = true;
      return false;
    }
    console.warn('deleteStudentJournalEntryFromServerFirestore error:', err);
    return false;
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
    const cleanRootPayload: Record<string, any> = fsRootPayload && typeof fsRootPayload === 'object'
      ? JSON.parse(JSON.stringify(fsRootPayload))
      : {};
    // ARCH.2E.2C: Eliminate redundant check mirrors on root users/{uid}
    delete cleanRootPayload.weeklyChecks;
    delete cleanRootPayload.sPathChecks;

    const writes: Promise<any>[] = [
      subRef.set(JSON.parse(JSON.stringify(weekDocPayload)), { merge: true }),
    ];
    if (Object.keys(cleanRootPayload).length > 0) {
      writes.push(userRef.set(cleanRootPayload, { merge: true }));
    }
    await Promise.all(writes);
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
 * Merges two homework objects ensuring student answers, genuine evaluations,
 * scores, per-part progress, daily activities, and question lists are never wiped by empty fields or autosaves.
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

  // Merge dailyActivities per day without wiping existing days
  const mergedDailyActivities: Record<string, any> = {
    ...(fallback.dailyActivities && typeof fallback.dailyActivities === 'object' ? fallback.dailyActivities : {}),
  };
  if (primary.dailyActivities && typeof primary.dailyActivities === 'object') {
    for (const [dayKey, pDay] of Object.entries(primary.dailyActivities)) {
      if (!pDay) continue;
      const fDay = mergedDailyActivities[dayKey];
      if (!fDay) {
        mergedDailyActivities[dayKey] = pDay;
      } else {
        mergedDailyActivities[dayKey] = {
          ...fDay,
          ...(pDay as any),
          studentAnswers: {
            matching: { ...(fDay.studentAnswers?.matching || {}), ...((pDay as any).studentAnswers?.matching || {}) },
            fillInBlanks: { ...(fDay.studentAnswers?.fillInBlanks || {}), ...((pDay as any).studentAnswers?.fillInBlanks || {}) },
            sentences: { ...(fDay.studentAnswers?.sentences || {}), ...((pDay as any).studentAnswers?.sentences || {}) },
            quizAnswers: { ...(fDay.studentAnswers?.quizAnswers || {}), ...((pDay as any).studentAnswers?.quizAnswers || {}) },
          },
          isCompleted: Boolean((pDay as any).isCompleted || fDay.isCompleted),
          isStarted: Boolean((pDay as any).isStarted || fDay.isStarted),
        };
      }
    }
  }

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
    dailyActivities: Object.keys(mergedDailyActivities).length > 0 ? mergedDailyActivities : primary.dailyActivities,
    completedPartsByDay: {
      ...(fallback.completedPartsByDay || {}),
      ...(primary.completedPartsByDay || {}),
    },
    studentAnswers: mergedAnswers,
    partsProgress: mergedPartsProgress,
    aiEvaluation: finalAiEvaluation,
    score: finalScore,
    isCompleted: finalIsCompleted,
    submittedAt: primary.submittedAt || fallback.submittedAt,
    status: primary.status || fallback.status,
  };
}

function hasHomeworkSubstantiveContent(hw: any): boolean {
  if (!hw || typeof hw !== 'object') return false;
  if (hw.aiEvaluation) return true;
  if (hw.isCompleted || hw.isDayPartCompleted) return true;
  if (hw.completedPartsByDay && Object.values(hw.completedPartsByDay).some(Boolean)) return true;
  if (hw.studentAnswers) {
    if (
      Object.keys(hw.studentAnswers.matching || {}).length > 0 ||
      Object.keys(hw.studentAnswers.fillInBlanks || {}).length > 0 ||
      Object.keys(hw.studentAnswers.sentences || {}).length > 0 ||
      Object.keys(hw.studentAnswers.quizAnswers || {}).length > 0
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Canonical-first homework fetch with strictly read-only legacy fallback when absent in canonical path.
 * Never overwrites existing canonical data with legacy data.
 */
export async function fetchHomeworkFromFirestore(
  docIds: string | string[],
  canonicalWeekId: string,
  cycle: number = 1
): Promise<any | null> {
  const db = getFirestoreDb();
  const idList = (Array.isArray(docIds) ? docIds : [docIds]).filter(Boolean);
  if (!db || !idList.length) return null;

  let canonicalResult: any = null;

  // 1. Authoritative canonical path: users/{uid}/homework/week-{cycle}
  for (const dId of idList) {
    try {
      const hwSnap = await db.collection('users').doc(dId).collection('homework').doc(canonicalWeekId).get();
      if (hwSnap.exists) {
        canonicalResult = mergeHomeworkRecords(canonicalResult, hwSnap.data());
      }
    } catch {}
  }

  // If canonical exists and already contains intentional reset or real answers/evaluation/progress,
  // return immediately without consulting legacy collections.
  if (
    canonicalResult &&
    (canonicalResult.isReset || canonicalResult.resetAt || hasHomeworkSubstantiveContent(canonicalResult))
  ) {
    return canonicalResult;
  }

  // 2. Read-only legacy fallback ONLY when substantive data is absent in canonical path
  let legacyResult: any = null;
  for (const dId of idList) {
    try {
      const weekSpecificSnap = await db.collection('student_homework').doc(`${dId}_${canonicalWeekId}`).get().catch(() => null);
      if (weekSpecificSnap && weekSpecificSnap.exists) {
        legacyResult = mergeHomeworkRecords(legacyResult, weekSpecificSnap.data());
      }

      const topSnap = await db.collection('student_homework').doc(dId).get().catch(() => null);
      if (topSnap && topSnap.exists) {
        const topData = topSnap.data();
        if (topData) {
          if (topData.cycles && topData.cycles[canonicalWeekId]) {
            legacyResult = mergeHomeworkRecords(legacyResult, topData.cycles[canonicalWeekId]);
          }
          const topCycle =
            topData.weeklyCycle !== undefined
              ? Number(topData.weeklyCycle)
              : typeof topData.weekId === 'string'
              ? parseInt(topData.weekId.replace(/\D/g, ''), 10)
              : cycle === 1
              ? 1
              : null;
          if (topCycle === cycle || (cycle === 1 && !topCycle)) {
            legacyResult = mergeHomeworkRecords(legacyResult, topData);
          }
        }
      }
    } catch {}
  }

  // Week 1 legacy backward compatibility only
  if (cycle === 1) {
    for (const dId of idList) {
      try {
        const hwSubSnap = await db.collection('users').doc(dId).collection('homework').doc('current_week').get().catch(() => null);
        if (hwSubSnap && hwSubSnap.exists) {
          legacyResult = mergeHomeworkRecords(legacyResult, hwSubSnap.data());
        }
        const userSnap = await db.collection('users').doc(dId).get().catch(() => null);
        if (userSnap && userSnap.exists && userSnap.data()?.weeklyHomework) {
          legacyResult = mergeHomeworkRecords(legacyResult, userSnap.data()?.weeklyHomework);
        }
      } catch {}
    }
  }

  if (canonicalResult && legacyResult) {
    // Canonical ALWAYS stays primary and is never overwritten by legacy values
    return mergeHomeworkRecords(canonicalResult, legacyResult);
  }
  return canonicalResult || legacyResult;
}

export async function saveHomeworkToFirestore(
  docId: string,
  canonicalWeekId: string,
  _cycle: number,
  hwPayload: any
): Promise<boolean> {
  if (isCloudWriteDisabled) return false;
  const db = getFirestoreDb();
  if (!db || !docId) return false;
  try {
    const sanitized = JSON.parse(JSON.stringify(hwPayload));
    // ARCH.2E.2C: Write exclusively to canonical users/{docId}/homework/week-{cycle}
    await db
      .collection('users')
      .doc(docId)
      .collection('homework')
      .doc(canonicalWeekId)
      .set(sanitized, { merge: true });
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

export interface CanonicalWeeklyChecksContextResult {
  checks: Record<string, boolean>;
  weeklyNativeLessonsTarget: number;
  weeklyStudyDaysTarget: number;
  weeklyStudyDays: string[];
  activeCycle: number | null;
  source: 'canonical' | 'legacy_fallback' | 'empty';
}

const DEFAULT_STUDY_DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

function parsePositiveCycleFromFirestore(val: any): number | null {
  if (typeof val === 'number' && Number.isInteger(val) && val > 0) return val;
  if (typeof val === 'string') {
    const trimmed = val.trim();
    const match = trimmed.match(/^(?:week-)?([1-9]\d*)$/i);
    if (match) {
      const n = Number(match[1]);
      if (Number.isInteger(n) && n > 0) return n;
    }
  }
  return null;
}

export async function fetchCanonicalUserWeeklyCycleServer(studentUid: string): Promise<{
  activeCycle: number | null;
  userData: Record<string, any> | null;
}> {
  const db = getFirestoreDb();
  if (!db || !studentUid) return { activeCycle: null, userData: null };
  try {
    const userSnap = await db.collection('users').doc(studentUid).get();
    if (!userSnap || !userSnap.exists) return { activeCycle: null, userData: null };
    const uData = userSnap.data() || {};
    return {
      activeCycle: parsePositiveCycleFromFirestore(uData.weeklyCycle),
      userData: uData,
    };
  } catch {
    return { activeCycle: null, userData: null };
  }
}

export async function fetchCanonicalWeeklyChecksServer(
  studentUid: string,
  canonicalWeekId: string,
  cycle: number
): Promise<CanonicalWeeklyChecksContextResult | null> {
  const db = getFirestoreDb();
  if (!db || !studentUid) return null;

  const userRef = db.collection('users').doc(studentUid);
  const weekRef = userRef.collection('weeklyChecks').doc(canonicalWeekId);

  const [userSnap, weekSnap] = await Promise.all([
    userRef.get().catch(() => null),
    weekRef.get().catch(() => null),
  ]);

  const uData = userSnap && userSnap.exists ? (userSnap.data() || {}) : {};
  const wData = weekSnap && weekSnap.exists ? (weekSnap.data() || {}) : null;

  const activeCycle = parsePositiveCycleFromFirestore(uData.weeklyCycle);

  const weeklyNativeLessonsTarget =
    typeof uData.weeklyNativeLessonsTarget === 'number' && uData.weeklyNativeLessonsTarget > 0
      ? uData.weeklyNativeLessonsTarget
      : typeof wData?.weeklyNativeLessonsTarget === 'number' && wData.weeklyNativeLessonsTarget > 0
      ? wData.weeklyNativeLessonsTarget
      : 1;

  const weeklyStudyDaysTarget =
    typeof uData.weeklyStudyDaysTarget === 'number' && uData.weeklyStudyDaysTarget >= 1 && uData.weeklyStudyDaysTarget <= 7
      ? uData.weeklyStudyDaysTarget
      : typeof wData?.weeklyStudyDaysTarget === 'number' && wData.weeklyStudyDaysTarget >= 1 && wData.weeklyStudyDaysTarget <= 7
      ? wData.weeklyStudyDaysTarget
      : 7;

  const weeklyStudyDays =
    Array.isArray(uData.weeklyStudyDays) && uData.weeklyStudyDays.length > 0
      ? uData.weeklyStudyDays
      : DEFAULT_STUDY_DAYS;

  if (wData) {
    const canonicalChecks: Record<string, boolean> = {
      ...(wData.weeklyChecks || {}),
      ...(wData.sPathChecks || {}),
      ...(wData.checks || {}),
    };
    return {
      checks: canonicalChecks,
      weeklyNativeLessonsTarget,
      weeklyStudyDaysTarget,
      weeklyStudyDays,
      activeCycle,
      source: 'canonical',
    };
  }

  // Read-only legacy fallback strictly for cycle === 1 when canonical doc does not exist
  if (cycle === 1 && (uData.weeklyChecks || uData.sPathChecks)) {
    const legacyChecks: Record<string, boolean> = {
      ...(uData.weeklyChecks || {}),
      ...(uData.sPathChecks || {}),
    };
    return {
      checks: legacyChecks,
      weeklyNativeLessonsTarget,
      weeklyStudyDaysTarget,
      weeklyStudyDays,
      activeCycle,
      source: 'legacy_fallback',
    };
  }

  return {
    checks: {},
    weeklyNativeLessonsTarget,
    weeklyStudyDaysTarget,
    weeklyStudyDays,
    activeCycle,
    source: 'empty',
  };
}

export async function saveCanonicalWeeklyChecksServer(params: {
  studentUid: string;
  studentEmail?: string;
  canonicalWeekId: string;
  cycle: number;
  checks?: Record<string, boolean>;
  reset?: boolean;
  weeklyNativeLessonsTarget?: number;
  weeklyStudyDaysTarget?: number;
  weeklyStudyDays?: string[];
}): Promise<{
  ok: boolean;
  statusCode?: number;
  errorCode?: string;
  error?: string;
  activeCycle?: number | null;
  checks?: Record<string, boolean>;
  weeklyNativeLessonsTarget?: number;
  weeklyStudyDaysTarget?: number;
  weeklyStudyDays?: string[];
}> {
  if (isCloudWriteDisabled) {
    return { ok: false, statusCode: 500, errorCode: 'CLOUD_WRITE_DISABLED', error: 'Firestore cloud writes are disabled.' };
  }
  const db = getFirestoreDb();
  if (!db || !params.studentUid) {
    return { ok: false, statusCode: 503, errorCode: 'FIRESTORE_UNAVAILABLE', error: 'Canonical Firestore database unavailable.' };
  }

  const userRef = db.collection('users').doc(params.studentUid);
  const weekRef = userRef.collection('weeklyChecks').doc(params.canonicalWeekId);

  try {
    const [userSnap, weekSnap] = await Promise.all([
      userRef.get().catch(() => null),
      weekRef.get().catch(() => null),
    ]);

    const uData = userSnap && userSnap.exists ? (userSnap.data() || {}) : {};
    const activeCycle = parsePositiveCycleFromFirestore(uData.weeklyCycle);

    if (activeCycle !== null && params.cycle < activeCycle) {
      return {
        ok: false,
        statusCode: 409,
        errorCode: 'STALE_CYCLE',
        error: `Stale cycle ${params.cycle} rejected; active cycle is ${activeCycle}.`,
        activeCycle,
      };
    }

    const wData = weekSnap && weekSnap.exists ? (weekSnap.data() || {}) : null;
    const existingChecks: Record<string, boolean> = wData
      ? {
          ...(wData.weeklyChecks || {}),
          ...(wData.sPathChecks || {}),
          ...(wData.checks || {}),
        }
      : {};

    const sanitizedIncoming: Record<string, boolean> = {};
    if (params.checks && typeof params.checks === 'object') {
      for (const [k, v] of Object.entries(params.checks)) {
        if (typeof v === 'boolean') {
          sanitizedIncoming[k] = v;
        }
      }
    }

    const finalChecks: Record<string, boolean> =
      params.reset === true
        ? sanitizedIncoming
        : {
            ...existingChecks,
            ...sanitizedIncoming,
          };

    const nowIso = new Date().toISOString();
    const weekDocPayload: Record<string, any> = {
      id: params.canonicalWeekId,
      weekId: params.canonicalWeekId,
      weeklyCycle: params.cycle,
      checks: finalChecks,
      studentUid: params.studentUid,
      ...(params.studentEmail ? { studentEmail: params.studentEmail } : {}),
      updatedAt: nowIso,
    };

    const writes: Promise<any>[] = [
      weekRef.set(JSON.parse(JSON.stringify(weekDocPayload)), { merge: params.reset !== true }),
    ];

    // Write S-Path goal configurations exclusively to users/{uid} (never mirror checks on root users/{uid})
    const rootGoalsUpdate: Record<string, any> = {};
    if (typeof params.weeklyNativeLessonsTarget === 'number' && params.weeklyNativeLessonsTarget > 0) {
      rootGoalsUpdate.weeklyNativeLessonsTarget = params.weeklyNativeLessonsTarget;
    }
    if (typeof params.weeklyStudyDaysTarget === 'number' && params.weeklyStudyDaysTarget >= 1 && params.weeklyStudyDaysTarget <= 7) {
      rootGoalsUpdate.weeklyStudyDaysTarget = params.weeklyStudyDaysTarget;
    }
    if (Array.isArray(params.weeklyStudyDays) && params.weeklyStudyDays.length > 0) {
      rootGoalsUpdate.weeklyStudyDays = params.weeklyStudyDays;
    }
    if (Object.keys(rootGoalsUpdate).length > 0) {
      rootGoalsUpdate.updatedAt = nowIso;
      writes.push(userRef.set(JSON.parse(JSON.stringify(rootGoalsUpdate)), { merge: true }));
    }

    await Promise.all(writes);

    return {
      ok: true,
      checks: finalChecks,
      weeklyNativeLessonsTarget:
        rootGoalsUpdate.weeklyNativeLessonsTarget ??
        (typeof uData.weeklyNativeLessonsTarget === 'number' && uData.weeklyNativeLessonsTarget > 0
          ? uData.weeklyNativeLessonsTarget
          : 1),
      weeklyStudyDaysTarget:
        rootGoalsUpdate.weeklyStudyDaysTarget ??
        (typeof uData.weeklyStudyDaysTarget === 'number' && uData.weeklyStudyDaysTarget >= 1 && uData.weeklyStudyDaysTarget <= 7
          ? uData.weeklyStudyDaysTarget
          : 7),
      weeklyStudyDays:
        rootGoalsUpdate.weeklyStudyDays ??
        (Array.isArray(uData.weeklyStudyDays) && uData.weeklyStudyDays.length > 0
          ? uData.weeklyStudyDays
          : DEFAULT_STUDY_DAYS),
    };
  } catch (err: any) {
    if (isPermissionError(err)) {
      isCloudWriteDisabled = true;
    }
    console.warn('[serverFirestore] saveCanonicalWeeklyChecksServer error:', err);
    return {
      ok: false,
      statusCode: 500,
      errorCode: 'WRITE_FAILED',
      error: err?.message || 'Firestore write failed.',
    };
  }
}

export async function saveCanonicalHomeworkServer(params: {
  studentUid: string;
  studentEmail?: string;
  canonicalWeekId: string;
  cycle: number;
  homeworkPayload: any;
  isSubmit?: boolean;
  enforceStaleCycle?: boolean;
}): Promise<{
  ok: boolean;
  statusCode?: number;
  errorCode?: string;
  error?: string;
  activeCycle?: number | null;
  weeklyHomework?: any;
}> {
  if (isCloudWriteDisabled) {
    return { ok: false, statusCode: 500, errorCode: 'CLOUD_WRITE_DISABLED', error: 'Firestore cloud writes are disabled.' };
  }
  const db = getFirestoreDb();
  if (!db || !params.studentUid) {
    return { ok: false, statusCode: 503, errorCode: 'FIRESTORE_UNAVAILABLE', error: 'Canonical Firestore database unavailable.' };
  }

  const userRef = db.collection('users').doc(params.studentUid);
  const hwRef = userRef.collection('homework').doc(params.canonicalWeekId);

  try {
    const [userSnap, existingHwSnap] = await Promise.all([
      userRef.get().catch(() => null),
      hwRef.get().catch(() => null),
    ]);

    const uData = userSnap && userSnap.exists ? (userSnap.data() || {}) : {};
    const activeCycle = parsePositiveCycleFromFirestore(uData.weeklyCycle);

    if (params.enforceStaleCycle !== false && activeCycle !== null && params.cycle < activeCycle) {
      return {
        ok: false,
        statusCode: 409,
        errorCode: 'STALE_CYCLE',
        error: `Stale cycle ${params.cycle} rejected; active cycle is ${activeCycle}.`,
        activeCycle,
      };
    }

    const existingCanonical = existingHwSnap && existingHwSnap.exists ? existingHwSnap.data() : null;
    const incomingSanitized = JSON.parse(JSON.stringify(params.homeworkPayload || {}));
    const merged = existingCanonical
      ? mergeHomeworkRecords(incomingSanitized, existingCanonical)
      : incomingSanitized;

    const nowIso = new Date().toISOString();
    const submittedAt =
      existingCanonical?.submittedAt ||
      incomingSanitized.submittedAt ||
      (params.isSubmit ? nowIso : undefined);
    const status =
      incomingSanitized.status ||
      existingCanonical?.status ||
      (params.isSubmit ? (merged.aiEvaluation ? 'graded' : 'submitted') : undefined);

    const finalPayload: Record<string, any> = {
      ...merged,
      id: params.canonicalWeekId,
      weekId: params.canonicalWeekId,
      weeklyCycle: params.cycle,
      uid: params.studentUid,
      studentUid: params.studentUid,
      ...(params.studentEmail ? { studentEmail: params.studentEmail, email: params.studentEmail } : {}),
      ...(submittedAt ? { submittedAt } : {}),
      ...(status ? { status } : {}),
      updatedAt: nowIso,
    };

    // ARCH.2E.2C: Write exclusively to canonical users/{uid}/homework/week-{cycle}
    await hwRef.set(JSON.parse(JSON.stringify(finalPayload)), { merge: true });

    return {
      ok: true,
      weeklyHomework: finalPayload,
    };
  } catch (err: any) {
    if (isPermissionError(err)) {
      isCloudWriteDisabled = true;
    }
    console.warn('[serverFirestore] saveCanonicalHomeworkServer error:', err);
    return {
      ok: false,
      statusCode: 500,
      errorCode: 'WRITE_FAILED',
      error: err?.message || 'Firestore write failed.',
    };
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

export class SchedulingTransactionError extends Error {
  statusCode: number;
  constructor(message: string, statusCode: number = 500) {
    super(message);
    this.name = 'SchedulingTransactionError';
    this.statusCode = statusCode;
  }
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
 * 6. Balance verification and atomic decrement inside Firestore runTransaction for paid lessons.
 * 7. Authoritative balance in users/{studentAuthUid}: rejects missing/undefined balances (HTTP 422) and insufficient balance (HTTP 402).
 * 8. Idempotent execution within transaction preventing duplicate lessons on repeated submission.
 * 9. Safe handling of persistence failures without permissive fallbacks or false successes.
 * 10. Local synchronized state updated exclusively after confirmed atomic commit in Firestore (default).
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

  // 3. Validate Firestore database readiness
  const db = getFirestoreDb();
  if (!db || isCloudWriteDisabled) {
    return {
      success: false,
      error: 'Serviço de persistência Firestore (default) indisponível no momento.',
      statusCode: 503,
    };
  }

  // 4. Resolve Native Friend (Teacher) profile using canonical identity resolver
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
  if (!teacherConfiguredMeetUrl) {
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

  // 5. Deterministic Lesson ID for exact deduplication and idempotency
  const deterministicLessonId = requestId || `lesson-${studentAuthUid}-${startTime}`;

  // 6. Gather existing lessons for conflict check (canonical Firestore lessons)
  const allExistingLessons: any[] = [];
  if (Array.isArray(existingLessons)) {
    allExistingLessons.push(...existingLessons);
  }
  try {
    const [tSnap, tAuthSnap, tPubSnap, tEmailSnap, sSnap, sEmailSnap] = await Promise.all([
      db.collection('lessons').where('teacherUid', '==', canonicalTeacherUid).get().catch(() => null),
      db.collection('lessons').where('teacherAuthUid', '==', canonicalTeacherUid).get().catch(() => null),
      (resolvedPublicTutorId && resolvedPublicTutorId !== canonicalTeacherUid
        ? db.collection('lessons').where('teacherUid', '==', resolvedPublicTutorId).get().catch(() => null)
        : null),
      (resolvedTeacherEmail
        ? db.collection('lessons').where('teacherEmail', '==', resolvedTeacherEmail).get().catch(() => null)
        : null),
      db.collection('lessons').where('studentUid', '==', studentAuthUid).get().catch(() => null),
      (cleanStudentEmail
        ? db.collection('lessons').where('studentEmail', '==', cleanStudentEmail).get().catch(() => null)
        : null),
    ]);
    if (tSnap) tSnap.forEach((d) => allExistingLessons.push({ id: d.id, ...d.data() }));
    if (tAuthSnap) tAuthSnap.forEach((d) => allExistingLessons.push({ id: d.id, ...d.data() }));
    if (tPubSnap) tPubSnap.forEach((d) => allExistingLessons.push({ id: d.id, ...d.data() }));
    if (tEmailSnap) tEmailSnap.forEach((d) => allExistingLessons.push({ id: d.id, ...d.data() }));
    if (sSnap) sSnap.forEach((d) => allExistingLessons.push({ id: d.id, ...d.data() }));
    if (sEmailSnap) sEmailSnap.forEach((d) => allExistingLessons.push({ id: d.id, ...d.data() }));
  } catch (queryErr) {
    console.warn('[serverFirestore] Warning: Querying existing lessons encountered error:', queryErr);
  }

  // Deduplicate existing lessons by id
  const existingLessonsMap = new Map<string, any>();
  allExistingLessons.forEach((l) => {
    if (l && l.id) existingLessonsMap.set(l.id, l);
  });
  const consolidatedLessons = Array.from(existingLessonsMap.values());

  // 7. Check Overlapping Conflicts (Anti-Duplicity Rule: teacher or student cannot have overlapping slots)
  const candidateConflict = consolidatedLessons.find((l) => {
    const isCancelled = l.status === 'cancelled' || l.status === 'canceled' || Boolean(l.cancelledAt);
    if (isCancelled) return false;
    if (l.status && l.status !== 'scheduled' && l.status !== 'confirmed') return false;

    // The exact same lesson ID (e.g. repeated idempotent submission) is not an overlapping conflict
    if (l.id === deterministicLessonId) return false;

    // Check time overlap
    if (!l.startDateTime || !l.endDateTime) return false;
    const lStart = new Date(l.startDateTime).getTime();
    const lEnd = new Date(l.endDateTime).getTime();
    const overlaps = lStart < endTime && lEnd > startTime;
    if (!overlaps) return false;

    // Teacher conflict
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

  // 8. ATOMIC EXECUTION IN CLOUD FIRESTORE VIA runTransaction
  const nowIso = new Date().toISOString();
  let txData: {
    isIdempotent: boolean;
    lesson: any;
    remainingLessons: number;
    contractedLessons: number;
    hasCompletedTrialLesson: boolean;
    onboardingCompleted: boolean;
  };

  try {
    txData = await db.runTransaction(async (transaction) => {
      const studentRef = db.collection('users').doc(studentAuthUid);
      const lessonRef = db.collection('lessons').doc(deterministicLessonId);
      const studentSubLessonRef = db.collection('users').doc(studentAuthUid).collection('lessons').doc(deterministicLessonId);
      const teacherUserSubLessonRef = db.collection('users').doc(canonicalTeacherUid).collection('lessons').doc(deterministicLessonId);
      const tutorSubLessonRef = db.collection('tutors').doc(canonicalTeacherUid).collection('lessons').doc(deterministicLessonId);
      const assignmentRef = db.collection('student_assignments').doc(studentAuthUid);

      // A. ALL READS OCCUR BEFORE WRITES
      const [studentSnap, lessonSnap] = await Promise.all([
        transaction.get(studentRef),
        transaction.get(lessonRef),
      ]);

      // B. IDEMPOTENCY CHECK INSIDE TRANSACTION
      // If the lesson already exists with status 'scheduled', return existing state without debiting
      if (lessonSnap.exists) {
        const existingData = lessonSnap.data();
        if (existingData && existingData.status === 'scheduled') {
          const studentData = studentSnap.exists ? (studentSnap.data() || {}) : {};
          const currentAvailable = typeof studentData.availableLessons === 'number'
            ? studentData.availableLessons
            : 0;
          const currentContracted = typeof studentData.contractedLessons === 'number'
            ? studentData.contractedLessons
            : currentAvailable;
          return {
            isIdempotent: true,
            lesson: { id: lessonSnap.id, ...existingData },
            remainingLessons: currentAvailable,
            contractedLessons: currentContracted,
            hasCompletedTrialLesson: Boolean(studentData.hasCompletedTrialLesson),
            onboardingCompleted: Boolean(studentData.onboardingCompleted ?? true),
          };
        }
      }

      // C. VALIDATE AUTHORITATIVE STUDENT DOCUMENT
      if (!studentSnap.exists) {
        throw new SchedulingTransactionError(
          'Registro do aluno não encontrado no Firestore.',
          404
        );
      }

      const studentData = studentSnap.data() || {};

      // D. VALIDATE BALANCE AND ELIGIBILITY INSIDE TRANSACTION
      let newAvailable: number;
      let newContracted: number;

      if (isTrialLesson) {
        if (studentData.hasCompletedTrialLesson === true) {
          throw new SchedulingTransactionError(
            'Aula experimental já foi utilizada anteriormente por este estudante.',
            400
          );
        }
        // Trial lesson does not consume regular paid credits
        newAvailable = typeof studentData.availableLessons === 'number'
          ? studentData.availableLessons
          : 0;
        newContracted = Math.max(Number(studentData.contractedLessons || 0), 1);
      } else {
        // Regular lesson: authoritatively check availableLessons in Firestore
        // Strict requirement: Never invent credits, never substitute undefined with contractedLessons
        if (
          studentData.availableLessons === undefined ||
          studentData.availableLessons === null ||
          typeof studentData.availableLessons !== 'number'
        ) {
          throw new SchedulingTransactionError(
            'Saldo de aulas ausente ou não definido no documento do aluno.',
            422
          );
        }

        // Authoritative zero balance is strictly preserved and blocks scheduling
        if (studentData.availableLessons <= 0) {
          throw new SchedulingTransactionError(
            'Saldo de aulas insuficiente. Por favor, adquira créditos de aulas antes de agendar.',
            402
          );
        }

        newAvailable = studentData.availableLessons - 1;
        newContracted = typeof studentData.contractedLessons === 'number'
          ? studentData.contractedLessons
          : studentData.availableLessons;
      }

      // E. SANITIZED LESSON DATA
      const sanitizedLesson = {
        id: deterministicLessonId,
        title: title || (isTrialLesson ? 'Aula Experimental Ao Vivo (Google Meet)' : 'Aula Ao Vivo 1-on-1'),
        description: description || '',
        startDateTime,
        endDateTime,
        studentUid: studentAuthUid,
        studentEmail: cleanStudentEmail || studentData.email || '',
        studentName: studentName || studentData.name || (cleanStudentEmail ? cleanStudentEmail.split('@')[0] : 'Aluno'),
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

      // F. ATOMIC WRITES
      transaction.set(lessonRef, sanitizedLesson, { merge: true });
      transaction.set(studentSubLessonRef, sanitizedLesson, { merge: true });
      transaction.set(teacherUserSubLessonRef, sanitizedLesson, { merge: true });
      transaction.set(tutorSubLessonRef, sanitizedLesson, { merge: true });
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
      transaction.set(
        studentRef,
        {
          uid: studentAuthUid,
          id: studentAuthUid,
          email: cleanStudentEmail || studentData.email || '',
          name: sanitizedLesson.studentName,
          teacherUid: canonicalTeacherUid,
          assignedNativeFriendUID: canonicalTeacherUid,
          nativeFriendUID: canonicalTeacherUid,
          teacherEmail: resolvedTeacherEmail,
          teacherName: resolvedTeacherName,
          teacherMeetUrl: resolvedMeetLink,
          enrollmentStatus: 'active',
          hasCompletedTrialLesson: isTrialLesson ? true : Boolean(studentData.hasCompletedTrialLesson),
          onboardingCompleted: isTrialLesson ? true : Boolean(studentData.onboardingCompleted ?? true),
          contractedLessons: newContracted,
          availableLessons: newAvailable,
          updatedAt: nowIso,
        },
        { merge: true }
      );

      // Idempotent reconciliation of legacy student doc without deletion
      if (studentData.id && studentData.id !== studentAuthUid) {
        const legacyStudentRef = db.collection('users').doc(studentData.id);
        transaction.set(legacyStudentRef, { canonicalUid: studentAuthUid, updatedAt: nowIso }, { merge: true });
      }

      return {
        isIdempotent: false,
        lesson: sanitizedLesson,
        remainingLessons: newAvailable,
        contractedLessons: newContracted,
        hasCompletedTrialLesson: isTrialLesson ? true : Boolean(studentData.hasCompletedTrialLesson),
        onboardingCompleted: isTrialLesson ? true : Boolean(studentData.onboardingCompleted ?? true),
      };
    });
  } catch (txErr: any) {
    if (txErr instanceof SchedulingTransactionError) {
      return {
        success: false,
        error: txErr.message,
        statusCode: txErr.statusCode,
      };
    }

    const msg = String(txErr?.message || '');
    const code = txErr?.code;

    if (isPermissionError(txErr)) {
      console.error('[serverFirestore] Firestore runTransaction permission error during schedule:', msg);
      return {
        success: false,
        error: 'Permissão negada para persistência da aula no Firestore.',
        statusCode: 403,
      };
    }

    const isTimeout =
      code === 4 ||
      code === 'deadline-exceeded' ||
      msg.includes('DEADLINE_EXCEEDED') ||
      msg.includes('timeout') ||
      msg.includes('ETIMEDOUT');

    if (isTimeout) {
      console.error('[serverFirestore] Firestore runTransaction timeout during schedule:', msg);
      return {
        success: false,
        error: 'Tempo limite esgotado ao persistir agendamento no Firestore. Tente novamente.',
        statusCode: 504,
      };
    }

    const isUnavailable =
      code === 14 ||
      code === 'unavailable' ||
      msg.includes('UNAVAILABLE') ||
      msg.includes('ECONNREFUSED');

    if (isUnavailable) {
      console.error('[serverFirestore] Firestore service unavailable during schedule:', msg);
      return {
        success: false,
        error: 'Serviço Firestore temporariamente indisponível.',
        statusCode: 503,
      };
    }

    console.error('[serverFirestore] Unexpected transaction error in scheduleLessonAtomicServer:', msg);
    return {
      success: false,
      error: 'Falha de persistência atômica no banco de dados. Agendamento não confirmado.',
      statusCode: 500,
    };
  }

  // 9. Synchronize in-memory student profile metadata exclusively AFTER confirmed Firestore transaction
  if (dbState) {
    try {
      const effectiveLesson = txData.lesson;
      if (!dbState.userProfiles) dbState.userProfiles = {};
      const profileKey = cleanStudentEmail || studentAuthUid;
      dbState.userProfiles[profileKey] = {
        ...(dbState.userProfiles[profileKey] || {}),
        id: studentAuthUid,
        uid: studentAuthUid,
        email: cleanStudentEmail,
        name: effectiveLesson.studentName,
        teacherUid: canonicalTeacherUid,
        assignedNativeFriendUID: canonicalTeacherUid,
        nativeFriendUID: canonicalTeacherUid,
        teacherEmail: resolvedTeacherEmail,
        teacherName: resolvedTeacherName,
        teacherMeetUrl: resolvedMeetLink,
        enrollmentStatus: 'active',
        hasCompletedTrialLesson: isTrialLesson ? true : Boolean(txData.hasCompletedTrialLesson),
        onboardingCompleted: isTrialLesson ? true : Boolean(txData.onboardingCompleted ?? true),
        contractedLessons: txData.contractedLessons,
        availableLessons: txData.remainingLessons,
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
          contractedLessons: txData.contractedLessons,
          availableLessons: txData.remainingLessons,
          hasCompletedTrialLesson: isTrialLesson ? true : Boolean(txData.hasCompletedTrialLesson),
          onboardingCompleted: isTrialLesson ? true : Boolean(txData.onboardingCompleted ?? true),
          teacherMeetUrl: resolvedMeetLink,
        };
      } else {
        dbState.students.push({
          id: studentAuthUid,
          uid: studentAuthUid,
          studentUid: studentAuthUid,
          name: effectiveLesson.studentName,
          studentName: effectiveLesson.studentName,
          email: cleanStudentEmail,
          studentEmail: cleanStudentEmail,
          teacherUid: canonicalTeacherUid,
          assignedNativeFriendUID: canonicalTeacherUid,
          nativeFriendUID: canonicalTeacherUid,
          teacherEmail: resolvedTeacherEmail,
          teacherName: resolvedTeacherName,
          teacherMeetUrl: resolvedMeetLink,
          status: 'active',
          contractedLessons: txData.contractedLessons,
          availableLessons: txData.remainingLessons,
          hasCompletedTrialLesson: isTrialLesson ? true : false,
          onboardingCompleted: isTrialLesson ? true : false,
          createdAt: nowIso,
        });
      }
    } catch (syncErr) {
      console.warn('[serverFirestore] Aviso: Falha na sincronização local de dbState pós-commit Firestore:', syncErr);
    }
  }

  return {
    success: true,
    lesson: txData.lesson,
    remainingLessons: txData.remainingLessons,
    contractedLessons: txData.contractedLessons,
    isTrialLesson: Boolean(isTrialLesson),
    onboardingCompleted: txData.onboardingCompleted,
    statusCode: 200,
  };
}

export interface LessonLifecycleCallerParams {
  lessonId: string;
  callerUid: string;
  callerEmail?: string;
  callerRole?: string;
  callerEmailVerified?: boolean;
}

export interface LessonLifecycleResult {
  success: boolean;
  statusCode: number;
  error?: string;
  code?: string;
  isIdempotent?: boolean;
  lesson?: any;
  remainingLessons?: number;
  creditRefunded?: boolean;
  deletedId?: string;
}

interface LessonCallerContext {
  isAuthorized: boolean;
  isAdmin: boolean;
  isStudent: boolean;
  isTeacher: boolean;
  teacherResolution: ResolvedTeacherIdentity | null;
}

async function resolveLessonCallerContext(
  lessonData: any,
  callerUid: string,
  callerEmail?: string,
  callerRole?: string,
  callerEmailVerified?: boolean
): Promise<LessonCallerContext> {
  const cleanCallerUid = (callerUid || '').trim();
  const cleanCallerEmail = (callerEmail || '').toLowerCase().trim();
  const isAdmin = callerRole === 'admin';

  const lessonStudentUid = (lessonData?.studentUid || '').trim();
  const lessonStudentEmail = (lessonData?.studentEmail || '').toLowerCase().trim();
  const isStudent = Boolean(
    cleanCallerUid &&
      (lessonStudentUid
        ? lessonStudentUid === cleanCallerUid
        : Boolean(cleanCallerEmail && callerEmailVerified !== false && lessonStudentEmail === cleanCallerEmail))
  );

  let teacherResolution: ResolvedTeacherIdentity | null = null;
  let isTeacher = false;
  if (cleanCallerUid) {
    try {
      teacherResolution = await resolveTeacherCanonicalIdentity({
        teacherUid: cleanCallerUid,
        teacherEmail: cleanCallerEmail || undefined,
      });
    } catch {
      teacherResolution = null;
    }

    if (teacherResolution && teacherResolution.isApproved) {
      const lessonTeacherIds = new Set(
        [
          lessonData?.teacherUid,
          lessonData?.teacherAuthUid,
          lessonData?.tutorUid,
          lessonData?.teacherPublicId,
        ]
          .filter((v) => typeof v === 'string' && v.trim().length > 0)
          .map((v) => String(v).trim())
      );

      const lessonTeacherEmail = (lessonData?.teacherEmail || lessonData?.tutorEmail || '').toLowerCase().trim();
      const matchesId =
        lessonTeacherIds.has(cleanCallerUid) ||
        lessonTeacherIds.has(teacherResolution.canonicalUid) ||
        Boolean(teacherResolution.publicTutorId && lessonTeacherIds.has(teacherResolution.publicTutorId));
      const matchesEmail = Boolean(
        lessonTeacherEmail &&
          ((teacherResolution.email && teacherResolution.email.toLowerCase().trim() === lessonTeacherEmail) ||
            (cleanCallerEmail && callerEmailVerified !== false && cleanCallerEmail === lessonTeacherEmail))
      );

      isTeacher = matchesId || matchesEmail;
    }
  }

  return {
    isAuthorized: isAdmin || isStudent || isTeacher,
    isAdmin,
    isStudent,
    isTeacher,
    teacherResolution,
  };
}

function collectLessonParticipantRefs(db: Firestore, lessonData: any, lessonId: string) {
  const studentUid = (lessonData?.studentUid || '').trim();
  const validStudentUid = studentUid && isValidCanonicalUid(studentUid) ? studentUid : '';

  const teacherUserUids = Array.from(
    new Set(
      [lessonData?.teacherAuthUid, lessonData?.teacherUid]
        .filter((v): v is string => typeof v === 'string' && isValidCanonicalUid(v.trim()) && v.trim() !== validStudentUid)
        .map((v) => v.trim())
    )
  );

  const tutorSubIds = Array.from(
    new Set(
      [lessonData?.teacherAuthUid, lessonData?.teacherUid, lessonData?.teacherPublicId]
        .filter((v): v is string => typeof v === 'string' && v.trim().length > 0 && !isGenericTutorId(v.trim()))
        .map((v) => v.trim())
    )
  );

  return {
    validStudentUid,
    studentRef: validStudentUid ? db.collection('users').doc(validStudentUid) : null,
    studentSubLessonRef: validStudentUid
      ? db.collection('users').doc(validStudentUid).collection('lessons').doc(lessonId)
      : null,
    teacherUserRefs: teacherUserUids.map((uid) => ({
      uid,
      userRef: db.collection('users').doc(uid),
      subLessonRef: db.collection('users').doc(uid).collection('lessons').doc(lessonId),
    })),
    tutorSubRefs: tutorSubIds.map((id) => ({
      id,
      subLessonRef: db.collection('tutors').doc(id).collection('lessons').doc(lessonId),
    })),
  };
}

async function hasFirestoreLessonConflict(params: {
  db: Firestore;
  excludeLessonId: string;
  startTime: number;
  endTime: number;
  lessonData: any;
}): Promise<{ conflict: boolean; isTeacherConflict?: boolean }> {
  const { db, excludeLessonId, startTime, endTime, lessonData } = params;

  const teacherIds = Array.from(
    new Set(
      [lessonData?.teacherAuthUid, lessonData?.teacherUid, lessonData?.tutorUid, lessonData?.teacherPublicId]
        .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
        .map((v) => v.trim())
    )
  );
  const teacherEmails = Array.from(
    new Set(
      [lessonData?.teacherEmail, lessonData?.tutorEmail]
        .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
        .map((v) => v.toLowerCase().trim())
    )
  );
  const studentUid = (lessonData?.studentUid || '').trim();
  const studentEmail = (lessonData?.studentEmail || '').toLowerCase().trim();

  const queries: Promise<any>[] = [];
  for (const tId of teacherIds) {
    queries.push(db.collection('lessons').where('teacherUid', '==', tId).get().catch(() => null));
    queries.push(db.collection('lessons').where('teacherAuthUid', '==', tId).get().catch(() => null));
  }
  for (const tEmail of teacherEmails) {
    queries.push(db.collection('lessons').where('teacherEmail', '==', tEmail).get().catch(() => null));
  }
  if (studentUid) {
    queries.push(db.collection('lessons').where('studentUid', '==', studentUid).get().catch(() => null));
  }
  if (studentEmail) {
    queries.push(db.collection('lessons').where('studentEmail', '==', studentEmail).get().catch(() => null));
  }

  const snaps = await Promise.all(queries);
  const byId = new Map<string, any>();
  for (const snap of snaps) {
    if (!snap) continue;
    snap.forEach((doc: any) => {
      if (doc && doc.id) {
        byId.set(doc.id, { id: doc.id, ...doc.data() });
      }
    });
  }

  for (const l of byId.values()) {
    if (!l || l.id === excludeLessonId) continue;
    const isCancelled = l.status === 'cancelled' || l.status === 'canceled' || Boolean(l.cancelledAt);
    if (isCancelled) continue;
    if (l.status && l.status !== 'scheduled' && l.status !== 'confirmed') continue;
    if (!l.startDateTime || !l.endDateTime) continue;

    const lStart = new Date(l.startDateTime).getTime();
    const lEnd = new Date(l.endDateTime).getTime();
    if (isNaN(lStart) || isNaN(lEnd)) continue;
    if (!(lStart < endTime && lEnd > startTime)) continue;

    const lTeacherIds = [l.teacherUid, l.teacherAuthUid, l.tutorUid, l.teacherPublicId]
      .filter(Boolean)
      .map((v: any) => String(v).trim());
    const lTeacherEmail = (l.teacherEmail || l.tutorEmail || '').toLowerCase().trim();
    const isSameTeacher =
      teacherIds.some((id) => lTeacherIds.includes(id)) ||
      (lTeacherEmail !== '' && teacherEmails.includes(lTeacherEmail));

    const lStudentUid = (l.studentUid || '').trim();
    const lStudentEmail = (l.studentEmail || '').toLowerCase().trim();
    const isSameStudent =
      (studentUid !== '' && lStudentUid === studentUid) ||
      (studentEmail !== '' && lStudentEmail === studentEmail);

    if (isSameTeacher || isSameStudent) {
      return { conflict: true, isTeacherConflict: isSameTeacher };
    }
  }

  return { conflict: false };
}

function mapLessonTxError(err: any, actionLabel: string): LessonLifecycleResult {
  if (err instanceof SchedulingTransactionError) {
    return {
      success: false,
      error: err.message,
      statusCode: err.statusCode,
    };
  }

  const msg = String(err?.message || '');
  const code = err?.code;

  if (isPermissionError(err)) {
    return {
      success: false,
      error: `Permissão negada no Firestore ao executar ${actionLabel}.`,
      statusCode: 403,
    };
  }

  const isTimeout =
    code === 4 ||
    code === 'deadline-exceeded' ||
    msg.includes('DEADLINE_EXCEEDED') ||
    msg.includes('timeout') ||
    msg.includes('ETIMEDOUT');
  if (isTimeout) {
    return {
      success: false,
      error: `Tempo limite esgotado ao persistir ${actionLabel} no Firestore.`,
      statusCode: 504,
    };
  }

  const isUnavailable =
    code === 14 ||
    code === 'unavailable' ||
    msg.includes('UNAVAILABLE') ||
    msg.includes('ECONNREFUSED');
  if (isUnavailable) {
    return {
      success: false,
      error: 'Serviço Firestore temporariamente indisponível.',
      statusCode: 503,
    };
  }

  console.error(`[serverFirestore] Unexpected error in ${actionLabel}:`, msg);
  return {
    success: false,
    error: `Falha de persistência atômica ao processar ${actionLabel}.`,
    statusCode: 500,
  };
}

function updateUserScheduledLessonsArray(
  userData: any,
  lessonId: string,
  updates: Record<string, any> | null,
  removeFromArray: boolean
): any[] | undefined {
  if (!userData || !Array.isArray(userData.scheduledLessons)) return undefined;
  if (removeFromArray) {
    return userData.scheduledLessons.filter((l: any) => l?.id !== lessonId);
  }
  if (!updates) return userData.scheduledLessons;
  return userData.scheduledLessons.map((l: any) => (l?.id === lessonId ? { ...l, ...updates } : l));
}

/**
 * ARCH.2D: Atomic lesson completion in Firestore (default).
 * Preserves Native Friends Notes, prevents invalid status transitions, and is idempotent.
 */
export async function completeLessonAtomicServer(
  params: LessonLifecycleCallerParams
): Promise<LessonLifecycleResult> {
  const lessonId = (params.lessonId || '').trim();
  const callerUid = (params.callerUid || '').trim();
  if (!callerUid) {
    return { success: false, statusCode: 401, error: 'Autenticação necessária.' };
  }
  if (!lessonId) {
    return { success: false, statusCode: 400, error: 'Identificador da aula ausente.' };
  }

  const db = getFirestoreDb();
  if (!db || isCloudWriteDisabled) {
    return { success: false, statusCode: 503, error: 'Serviço de persistência Firestore (default) indisponível.' };
  }

  const lessonRef = db.collection('lessons').doc(lessonId);
  const preSnap = await lessonRef.get().catch(() => null);
  if (!preSnap || !preSnap.exists) {
    return { success: false, statusCode: 404, error: 'Aula não encontrada no Firestore.' };
  }

  const preData = preSnap.data() || {};
  const auth = await resolveLessonCallerContext(
    preData,
    callerUid,
    params.callerEmail,
    params.callerRole,
    params.callerEmailVerified
  );
  if (!auth.isAuthorized) {
    return { success: false, statusCode: 403, error: 'Acesso negado: você não tem permissão para concluir esta aula.' };
  }

  const refs = collectLessonParticipantRefs(db, preData, lessonId);
  const nowIso = new Date().toISOString();

  try {
    const txRes = await db.runTransaction(async (transaction) => {
      const [lessonSnap, studentSnap, ...teacherUserSnaps] = await Promise.all([
        transaction.get(lessonRef),
        refs.studentRef ? transaction.get(refs.studentRef) : Promise.resolve(null),
        ...refs.teacherUserRefs.map((t) => transaction.get(t.userRef)),
      ]);

      if (!lessonSnap.exists) {
        throw new SchedulingTransactionError('Aula não encontrada no Firestore.', 404);
      }

      const latest = lessonSnap.data() || {};
      if (latest.status === 'completed') {
        return {
          isIdempotent: true,
          lesson: { ...latest, id: lessonId },
        };
      }

      if (
        latest.status === 'cancelled' ||
        latest.status === 'canceled' ||
        latest.status === 'not_completed' ||
        Boolean(latest.cancelledAt)
      ) {
        throw new SchedulingTransactionError(
          'Transição inválida: não é possível concluir uma aula cancelada ou marcada como não realizada.',
          409
        );
      }

      const updates: Record<string, any> = {
        status: 'completed',
        completedAt: latest.completedAt || nowIso,
        completedBy: auth.isAdmin ? 'admin' : auth.isTeacher ? 'teacher' : 'student',
        updatedAt: nowIso,
      };

      const mergedLesson = { ...latest, ...updates, id: lessonId };
      transaction.set(lessonRef, updates, { merge: true });
      if (refs.studentSubLessonRef) {
        transaction.set(refs.studentSubLessonRef, mergedLesson, { merge: true });
      }
      for (const tRef of refs.teacherUserRefs) {
        transaction.set(tRef.subLessonRef, mergedLesson, { merge: true });
      }
      for (const tuRef of refs.tutorSubRefs) {
        transaction.set(tuRef.subLessonRef, mergedLesson, { merge: true });
      }

      if (refs.studentRef && studentSnap && studentSnap.exists) {
        const nextScheduled = updateUserScheduledLessonsArray(studentSnap.data(), lessonId, updates, true);
        if (nextScheduled !== undefined) {
          transaction.set(refs.studentRef, { scheduledLessons: nextScheduled, updatedAt: nowIso }, { merge: true });
        }
      }
      refs.teacherUserRefs.forEach((tRef, idx) => {
        const tSnap = teacherUserSnaps[idx];
        if (tSnap && tSnap.exists) {
          const nextScheduled = updateUserScheduledLessonsArray(tSnap.data(), lessonId, updates, true);
          if (nextScheduled !== undefined) {
            transaction.set(tRef.userRef, { scheduledLessons: nextScheduled, updatedAt: nowIso }, { merge: true });
          }
        }
      });

      return {
        isIdempotent: false,
        lesson: mergedLesson,
      };
    });

    return {
      success: true,
      statusCode: 200,
      isIdempotent: txRes.isIdempotent,
      lesson: txRes.lesson,
    };
  } catch (err) {
    return mapLessonTxError(err, 'conclusão da aula');
  }
}

/**
 * ARCH.2D: Atomic non-completion in Firestore (default).
 * Restores +1 paid credit once (and only once) when teacher is responsible on a non-trial lesson.
 */
export async function markLessonNotCompletedAtomicServer(
  params: LessonLifecycleCallerParams & {
    responsible: 'student' | 'teacher';
    reason?: string;
  }
): Promise<LessonLifecycleResult> {
  const lessonId = (params.lessonId || '').trim();
  const callerUid = (params.callerUid || '').trim();
  const responsible = params.responsible;
  const reason = typeof params.reason === 'string' ? params.reason.trim() : '';

  if (!callerUid) {
    return { success: false, statusCode: 401, error: 'Autenticação necessária.' };
  }
  if (!lessonId) {
    return { success: false, statusCode: 400, error: 'Identificador da aula ausente.' };
  }
  if (responsible !== 'student' && responsible !== 'teacher') {
    return { success: false, statusCode: 400, error: 'Responsável inválido. Informe "student" ou "teacher".' };
  }

  const db = getFirestoreDb();
  if (!db || isCloudWriteDisabled) {
    return { success: false, statusCode: 503, error: 'Serviço de persistência Firestore (default) indisponível.' };
  }

  const lessonRef = db.collection('lessons').doc(lessonId);
  const preSnap = await lessonRef.get().catch(() => null);
  if (!preSnap || !preSnap.exists) {
    return { success: false, statusCode: 404, error: 'Aula não encontrada no Firestore.' };
  }

  const preData = preSnap.data() || {};
  const auth = await resolveLessonCallerContext(
    preData,
    callerUid,
    params.callerEmail,
    params.callerRole,
    params.callerEmailVerified
  );
  if (!auth.isAuthorized) {
    return { success: false, statusCode: 403, error: 'Acesso negado: você não tem permissão para atualizar esta aula.' };
  }

  if (responsible === 'teacher' && !auth.isAdmin && !auth.isTeacher) {
    return {
      success: false,
      statusCode: 403,
      error: 'Proibido: apenas o Amigo Nativo ou administrador pode registrar não realização por responsabilidade do professor com estorno de crédito.',
    };
  }

  const refs = collectLessonParticipantRefs(db, preData, lessonId);
  const nowIso = new Date().toISOString();

  try {
    const txRes = await db.runTransaction(async (transaction) => {
      const [lessonSnap, studentSnap, ...teacherUserSnaps] = await Promise.all([
        transaction.get(lessonRef),
        refs.studentRef ? transaction.get(refs.studentRef) : Promise.resolve(null),
        ...refs.teacherUserRefs.map((t) => transaction.get(t.userRef)),
      ]);

      if (!lessonSnap.exists) {
        throw new SchedulingTransactionError('Aula não encontrada no Firestore.', 404);
      }

      const latest = lessonSnap.data() || {};
      const studentData = studentSnap && studentSnap.exists ? (studentSnap.data() || {}) : null;

      if (latest.status === 'not_completed') {
        if (latest.notCompletedResponsible === responsible) {
          return {
            isIdempotent: true,
            lesson: { ...latest, id: lessonId },
            remainingLessons: typeof studentData?.availableLessons === 'number' ? studentData.availableLessons : undefined,
            creditRefunded: Boolean(latest.creditRefunded),
          };
        }
        throw new SchedulingTransactionError(
          'Transição inválida: esta aula já foi registrada como não realizada com outra responsabilidade.',
          409
        );
      }

      if (
        latest.status === 'completed' ||
        latest.status === 'cancelled' ||
        latest.status === 'canceled' ||
        Boolean(latest.cancelledAt)
      ) {
        throw new SchedulingTransactionError(
          'Transição inválida: não é possível marcar como não realizada uma aula já concluída ou cancelada.',
          409
        );
      }

      const shouldRefund =
        responsible === 'teacher' &&
        !Boolean(latest.isTrialLesson) &&
        latest.creditRefunded !== true;

      let nextAvailable = typeof studentData?.availableLessons === 'number' ? studentData.availableLessons : undefined;
      let actuallyRefunded = false;

      if (shouldRefund && refs.studentRef && studentData && typeof studentData.availableLessons === 'number') {
        nextAvailable = studentData.availableLessons + 1;
        actuallyRefunded = true;
      }

      const updates: Record<string, any> = {
        status: 'not_completed',
        notCompletedResponsible: responsible,
        notCompletedReason: reason,
        notCompletedAt: latest.notCompletedAt || nowIso,
        notCompletedRecordedBy: auth.isAdmin ? 'admin' : auth.isTeacher ? 'teacher' : 'student',
        updatedAt: nowIso,
      };
      if (actuallyRefunded) {
        updates.creditRefunded = true;
        updates.creditRefundedAt = nowIso;
      }

      const mergedLesson = { ...latest, ...updates, id: lessonId };
      transaction.set(lessonRef, updates, { merge: true });
      if (refs.studentSubLessonRef) {
        transaction.set(refs.studentSubLessonRef, mergedLesson, { merge: true });
      }
      for (const tRef of refs.teacherUserRefs) {
        transaction.set(tRef.subLessonRef, mergedLesson, { merge: true });
      }
      for (const tuRef of refs.tutorSubRefs) {
        transaction.set(tuRef.subLessonRef, mergedLesson, { merge: true });
      }

      if (refs.studentRef && studentData) {
        const studentPatch: Record<string, any> = { updatedAt: nowIso };
        if (actuallyRefunded && nextAvailable !== undefined) {
          studentPatch.availableLessons = nextAvailable;
        }
        const nextScheduled = updateUserScheduledLessonsArray(studentData, lessonId, updates, true);
        if (nextScheduled !== undefined) {
          studentPatch.scheduledLessons = nextScheduled;
        }
        if (Object.keys(studentPatch).length > 1) {
          transaction.set(refs.studentRef, studentPatch, { merge: true });
        }
      }

      refs.teacherUserRefs.forEach((tRef, idx) => {
        const tSnap = teacherUserSnaps[idx];
        if (tSnap && tSnap.exists) {
          const nextScheduled = updateUserScheduledLessonsArray(tSnap.data(), lessonId, updates, true);
          if (nextScheduled !== undefined) {
            transaction.set(tRef.userRef, { scheduledLessons: nextScheduled, updatedAt: nowIso }, { merge: true });
          }
        }
      });

      return {
        isIdempotent: false,
        lesson: mergedLesson,
        remainingLessons: nextAvailable,
        creditRefunded: actuallyRefunded,
      };
    });

    return {
      success: true,
      statusCode: 200,
      isIdempotent: txRes.isIdempotent,
      lesson: txRes.lesson,
      remainingLessons: txRes.remainingLessons,
      creditRefunded: txRes.creditRefunded,
    };
  } catch (err) {
    return mapLessonTxError(err, 'registro de aula não realizada');
  }
}

/**
 * ARCH.2D: Atomic reschedule proposal in Firestore (default).
 * Checks Firestore slot conflicts and derives proposedBy from verified caller role.
 */
export async function proposeRescheduleAtomicServer(
  params: LessonLifecycleCallerParams & {
    newStartIso: string;
    newEndIso: string;
    reason?: string;
    requestedProposedBy?: string;
  }
): Promise<LessonLifecycleResult> {
  const lessonId = (params.lessonId || '').trim();
  const callerUid = (params.callerUid || '').trim();
  const newStartIso = (params.newStartIso || '').trim();
  const newEndIso = (params.newEndIso || '').trim();
  const reason = typeof params.reason === 'string' ? params.reason.trim() : '';

  if (!callerUid) {
    return { success: false, statusCode: 401, error: 'Autenticação necessária.' };
  }
  if (!lessonId) {
    return { success: false, statusCode: 400, error: 'Identificador da aula ausente.' };
  }

  const newStartMs = new Date(newStartIso).getTime();
  const newEndMs = new Date(newEndIso).getTime();
  if (!newStartIso || !newEndIso || isNaN(newStartMs) || isNaN(newEndMs) || newStartMs >= newEndMs) {
    return { success: false, statusCode: 400, error: 'Novo horário de início ou término inválido.' };
  }

  const db = getFirestoreDb();
  if (!db || isCloudWriteDisabled) {
    return { success: false, statusCode: 503, error: 'Serviço de persistência Firestore (default) indisponível.' };
  }

  const lessonRef = db.collection('lessons').doc(lessonId);
  const preSnap = await lessonRef.get().catch(() => null);
  if (!preSnap || !preSnap.exists) {
    return { success: false, statusCode: 404, error: 'Aula não encontrada no Firestore.' };
  }

  const preData = preSnap.data() || {};
  const auth = await resolveLessonCallerContext(
    preData,
    callerUid,
    params.callerEmail,
    params.callerRole,
    params.callerEmailVerified
  );
  if (!auth.isAuthorized) {
    return { success: false, statusCode: 403, error: 'Acesso negado: você não tem permissão para propor reagendamento desta aula.' };
  }

  const conflictCheck = await hasFirestoreLessonConflict({
    db,
    excludeLessonId: lessonId,
    startTime: newStartMs,
    endTime: newEndMs,
    lessonData: preData,
  });
  if (conflictCheck.conflict) {
    return {
      success: false,
      statusCode: 409,
      error: conflictCheck.isTeacherConflict
        ? 'Bloqueio de Conflito: O Amigo Nativo já possui outra aula agendada neste horário.'
        : 'Bloqueio de Conflito: O aluno já possui outra aula agendada neste horário.',
    };
  }

  const effectiveProposedBy: 'teacher' | 'student' = auth.isAdmin
    ? params.requestedProposedBy === 'student'
      ? 'student'
      : 'teacher'
    : auth.isTeacher
    ? 'teacher'
    : 'student';

  const refs = collectLessonParticipantRefs(db, preData, lessonId);
  const nowIso = new Date().toISOString();

  try {
    const txRes = await db.runTransaction(async (transaction) => {
      const [lessonSnap, studentSnap, ...teacherUserSnaps] = await Promise.all([
        transaction.get(lessonRef),
        refs.studentRef ? transaction.get(refs.studentRef) : Promise.resolve(null),
        ...refs.teacherUserRefs.map((t) => transaction.get(t.userRef)),
      ]);

      if (!lessonSnap.exists) {
        throw new SchedulingTransactionError('Aula não encontrada no Firestore.', 404);
      }

      const latest = lessonSnap.data() || {};
      if (
        latest.status === 'cancelled' ||
        latest.status === 'canceled' ||
        latest.status === 'completed' ||
        latest.status === 'not_completed' ||
        Boolean(latest.cancelledAt)
      ) {
        throw new SchedulingTransactionError(
          'Não é possível reagendar uma aula já concluída, cancelada ou marcada como não realizada.',
          409
        );
      }

      const proposalFields = {
        proposedNewStartDateTime: newStartIso,
        proposedNewEndDateTime: newEndIso,
        rescheduleNotes: reason,
        proposedBy: effectiveProposedBy,
        proposalStatus:
          effectiveProposedBy === 'teacher'
            ? 'pending_student_reschedule'
            : 'pending_teacher_reschedule',
        proposedAt: nowIso,
        updatedAt: nowIso,
      };

      const mergedLesson = { ...latest, ...proposalFields, id: lessonId };
      transaction.set(lessonRef, proposalFields, { merge: true });
      if (refs.studentSubLessonRef) {
        transaction.set(refs.studentSubLessonRef, mergedLesson, { merge: true });
      }
      for (const tRef of refs.teacherUserRefs) {
        transaction.set(tRef.subLessonRef, mergedLesson, { merge: true });
      }
      for (const tuRef of refs.tutorSubRefs) {
        transaction.set(tuRef.subLessonRef, mergedLesson, { merge: true });
      }

      if (refs.studentRef && studentSnap && studentSnap.exists) {
        const nextScheduled = updateUserScheduledLessonsArray(studentSnap.data(), lessonId, proposalFields, false);
        if (nextScheduled !== undefined) {
          transaction.set(refs.studentRef, { scheduledLessons: nextScheduled, updatedAt: nowIso }, { merge: true });
        }
      }
      refs.teacherUserRefs.forEach((tRef, idx) => {
        const tSnap = teacherUserSnaps[idx];
        if (tSnap && tSnap.exists) {
          const nextScheduled = updateUserScheduledLessonsArray(tSnap.data(), lessonId, proposalFields, false);
          if (nextScheduled !== undefined) {
            transaction.set(tRef.userRef, { scheduledLessons: nextScheduled, updatedAt: nowIso }, { merge: true });
          }
        }
      });

      return { lesson: mergedLesson };
    });

    return {
      success: true,
      statusCode: 200,
      lesson: txRes.lesson,
    };
  } catch (err) {
    return mapLessonTxError(err, 'proposta de reagendamento');
  }
}

/**
 * ARCH.2D: Atomic reschedule acceptance in Firestore (default).
 * Validates pending proposal, counterparty authorization, and conflict check without creating duplicate lessons or debiting credits.
 */
export async function acceptRescheduleAtomicServer(
  params: LessonLifecycleCallerParams
): Promise<LessonLifecycleResult> {
  const lessonId = (params.lessonId || '').trim();
  const callerUid = (params.callerUid || '').trim();

  if (!callerUid) {
    return { success: false, statusCode: 401, error: 'Autenticação necessária.' };
  }
  if (!lessonId) {
    return { success: false, statusCode: 400, error: 'Identificador da aula ausente.' };
  }

  const db = getFirestoreDb();
  if (!db || isCloudWriteDisabled) {
    return { success: false, statusCode: 503, error: 'Serviço de persistência Firestore (default) indisponível.' };
  }

  const lessonRef = db.collection('lessons').doc(lessonId);
  const preSnap = await lessonRef.get().catch(() => null);
  if (!preSnap || !preSnap.exists) {
    return { success: false, statusCode: 404, error: 'Aula não encontrada no Firestore.' };
  }

  const preData = preSnap.data() || {};
  const auth = await resolveLessonCallerContext(
    preData,
    callerUid,
    params.callerEmail,
    params.callerRole,
    params.callerEmailVerified
  );
  if (!auth.isAuthorized) {
    return { success: false, statusCode: 403, error: 'Acesso negado: você não tem permissão para aceitar reagendamento desta aula.' };
  }

  if (
    preData.status === 'cancelled' ||
    preData.status === 'canceled' ||
    preData.status === 'completed' ||
    preData.status === 'not_completed' ||
    Boolean(preData.cancelledAt)
  ) {
    return { success: false, statusCode: 409, error: 'Esta aula não está mais ativa para reagendamento.' };
  }

  if (!preData.proposedNewStartDateTime) {
    return { success: false, statusCode: 409, error: 'Nenhuma proposta de reagendamento pendente encontrada.' };
  }

  // Only the receiving party (or admin) can accept a reschedule proposal
  const awaitingStudent =
    preData.proposedBy === 'teacher' || preData.proposalStatus === 'pending_student_reschedule';
  const awaitingTeacher =
    preData.proposedBy === 'student' || preData.proposalStatus === 'pending_teacher_reschedule';

  if (!auth.isAdmin) {
    if (awaitingStudent && !auth.isStudent) {
      return {
        success: false,
        statusCode: 403,
        error: 'Proibido: aguardando confirmação do aluno para esta proposta de reagendamento.',
      };
    }
    if (awaitingTeacher && !auth.isTeacher) {
      return {
        success: false,
        statusCode: 403,
        error: 'Proibido: aguardando confirmação do Amigo Nativo para esta proposta de reagendamento.',
      };
    }
  }

  const newStartIso = String(preData.proposedNewStartDateTime);
  const newEndIso = String(preData.proposedNewEndDateTime || preData.endDateTime || '');
  const newStartMs = new Date(newStartIso).getTime();
  const newEndMs = new Date(newEndIso).getTime();
  if (isNaN(newStartMs) || isNaN(newEndMs) || newStartMs >= newEndMs) {
    return { success: false, statusCode: 400, error: 'Horário proposto inválido para aceite.' };
  }

  const conflictCheck = await hasFirestoreLessonConflict({
    db,
    excludeLessonId: lessonId,
    startTime: newStartMs,
    endTime: newEndMs,
    lessonData: preData,
  });
  if (conflictCheck.conflict) {
    return {
      success: false,
      statusCode: 409,
      error: conflictCheck.isTeacherConflict
        ? 'Bloqueio de Conflito: O horário proposto já foi ocupado na agenda do Amigo Nativo.'
        : 'Bloqueio de Conflito: O aluno já possui outra aula agendada neste horário.',
    };
  }

  const refs = collectLessonParticipantRefs(db, preData, lessonId);
  const nowIso = new Date().toISOString();

  try {
    const txRes = await db.runTransaction(async (transaction) => {
      const [lessonSnap, studentSnap, ...teacherUserSnaps] = await Promise.all([
        transaction.get(lessonRef),
        refs.studentRef ? transaction.get(refs.studentRef) : Promise.resolve(null),
        ...refs.teacherUserRefs.map((t) => transaction.get(t.userRef)),
      ]);

      if (!lessonSnap.exists) {
        throw new SchedulingTransactionError('Aula não encontrada no Firestore.', 404);
      }

      const latest = lessonSnap.data() || {};
      if (
        latest.status === 'cancelled' ||
        latest.status === 'canceled' ||
        latest.status === 'completed' ||
        latest.status === 'not_completed' ||
        Boolean(latest.cancelledAt)
      ) {
        throw new SchedulingTransactionError('Esta aula não está mais ativa para reagendamento.', 409);
      }
      if (!latest.proposedNewStartDateTime) {
        throw new SchedulingTransactionError('Proposta de reagendamento não está mais pendente.', 409);
      }

      const acceptUpdates = {
        startDateTime: latest.proposedNewStartDateTime,
        endDateTime: latest.proposedNewEndDateTime || latest.endDateTime,
        rescheduledFrom: {
          startDateTime: latest.startDateTime,
          endDateTime: latest.endDateTime,
        },
        rescheduledAt: nowIso,
        rescheduledBy: latest.proposedBy,
        rescheduledReason: latest.rescheduleNotes || '',
        proposedNewStartDateTime: null,
        proposedNewEndDateTime: null,
        proposalStatus: null,
        updatedAt: nowIso,
      };

      const mergedLesson = { ...latest, ...acceptUpdates, id: lessonId };
      transaction.set(lessonRef, acceptUpdates, { merge: true });
      if (refs.studentSubLessonRef) {
        transaction.set(refs.studentSubLessonRef, mergedLesson, { merge: true });
      }
      for (const tRef of refs.teacherUserRefs) {
        transaction.set(tRef.subLessonRef, mergedLesson, { merge: true });
      }
      for (const tuRef of refs.tutorSubRefs) {
        transaction.set(tuRef.subLessonRef, mergedLesson, { merge: true });
      }

      if (refs.studentRef && studentSnap && studentSnap.exists) {
        const nextScheduled = updateUserScheduledLessonsArray(studentSnap.data(), lessonId, acceptUpdates, false);
        if (nextScheduled !== undefined) {
          transaction.set(refs.studentRef, { scheduledLessons: nextScheduled, updatedAt: nowIso }, { merge: true });
        }
      }
      refs.teacherUserRefs.forEach((tRef, idx) => {
        const tSnap = teacherUserSnaps[idx];
        if (tSnap && tSnap.exists) {
          const nextScheduled = updateUserScheduledLessonsArray(tSnap.data(), lessonId, acceptUpdates, false);
          if (nextScheduled !== undefined) {
            transaction.set(tRef.userRef, { scheduledLessons: nextScheduled, updatedAt: nowIso }, { merge: true });
          }
        }
      });

      return { lesson: mergedLesson };
    });

    return {
      success: true,
      statusCode: 200,
      lesson: txRes.lesson,
    };
  } catch (err) {
    return mapLessonTxError(err, 'aceite de reagendamento');
  }
}

/**
 * ARCH.2D: Atomic reschedule decline in Firestore (default).
 * Clears proposed schedule fields while preserving original lesson time and notes.
 */
export async function declineRescheduleAtomicServer(
  params: LessonLifecycleCallerParams
): Promise<LessonLifecycleResult> {
  const lessonId = (params.lessonId || '').trim();
  const callerUid = (params.callerUid || '').trim();

  if (!callerUid) {
    return { success: false, statusCode: 401, error: 'Autenticação necessária.' };
  }
  if (!lessonId) {
    return { success: false, statusCode: 400, error: 'Identificador da aula ausente.' };
  }

  const db = getFirestoreDb();
  if (!db || isCloudWriteDisabled) {
    return { success: false, statusCode: 503, error: 'Serviço de persistência Firestore (default) indisponível.' };
  }

  const lessonRef = db.collection('lessons').doc(lessonId);
  const preSnap = await lessonRef.get().catch(() => null);
  if (!preSnap || !preSnap.exists) {
    return { success: false, statusCode: 404, error: 'Aula não encontrada no Firestore.' };
  }

  const preData = preSnap.data() || {};
  const auth = await resolveLessonCallerContext(
    preData,
    callerUid,
    params.callerEmail,
    params.callerRole,
    params.callerEmailVerified
  );
  if (!auth.isAuthorized) {
    return { success: false, statusCode: 403, error: 'Acesso negado: você não tem permissão para recusar reagendamento desta aula.' };
  }

  const refs = collectLessonParticipantRefs(db, preData, lessonId);
  const nowIso = new Date().toISOString();

  try {
    const txRes = await db.runTransaction(async (transaction) => {
      const [lessonSnap, studentSnap, ...teacherUserSnaps] = await Promise.all([
        transaction.get(lessonRef),
        refs.studentRef ? transaction.get(refs.studentRef) : Promise.resolve(null),
        ...refs.teacherUserRefs.map((t) => transaction.get(t.userRef)),
      ]);

      if (!lessonSnap.exists) {
        throw new SchedulingTransactionError('Aula não encontrada no Firestore.', 404);
      }

      const latest = lessonSnap.data() || {};
      if (
        latest.status === 'cancelled' ||
        latest.status === 'canceled' ||
        latest.status === 'completed' ||
        latest.status === 'not_completed' ||
        Boolean(latest.cancelledAt)
      ) {
        throw new SchedulingTransactionError('Esta aula não está mais ativa para alteração de reagendamento.', 409);
      }

      if (!latest.proposedNewStartDateTime && !latest.proposalStatus) {
        return { isIdempotent: true, lesson: { ...latest, id: lessonId } };
      }

      const declineUpdates = {
        proposedNewStartDateTime: null,
        proposedNewEndDateTime: null,
        proposalStatus: null,
        rescheduleDeclinedAt: nowIso,
        rescheduleDeclinedBy: auth.isAdmin ? 'admin' : auth.isTeacher ? 'teacher' : 'student',
        updatedAt: nowIso,
      };

      const mergedLesson = { ...latest, ...declineUpdates, id: lessonId };
      transaction.set(lessonRef, declineUpdates, { merge: true });
      if (refs.studentSubLessonRef) {
        transaction.set(refs.studentSubLessonRef, mergedLesson, { merge: true });
      }
      for (const tRef of refs.teacherUserRefs) {
        transaction.set(tRef.subLessonRef, mergedLesson, { merge: true });
      }
      for (const tuRef of refs.tutorSubRefs) {
        transaction.set(tuRef.subLessonRef, mergedLesson, { merge: true });
      }

      if (refs.studentRef && studentSnap && studentSnap.exists) {
        const nextScheduled = updateUserScheduledLessonsArray(studentSnap.data(), lessonId, declineUpdates, false);
        if (nextScheduled !== undefined) {
          transaction.set(refs.studentRef, { scheduledLessons: nextScheduled, updatedAt: nowIso }, { merge: true });
        }
      }
      refs.teacherUserRefs.forEach((tRef, idx) => {
        const tSnap = teacherUserSnaps[idx];
        if (tSnap && tSnap.exists) {
          const nextScheduled = updateUserScheduledLessonsArray(tSnap.data(), lessonId, declineUpdates, false);
          if (nextScheduled !== undefined) {
            transaction.set(tRef.userRef, { scheduledLessons: nextScheduled, updatedAt: nowIso }, { merge: true });
          }
        }
      });

      return { isIdempotent: false, lesson: mergedLesson };
    });

    return {
      success: true,
      statusCode: 200,
      isIdempotent: txRes.isIdempotent,
      lesson: txRes.lesson,
    };
  } catch (err) {
    return mapLessonTxError(err, 'recusa de reagendamento');
  }
}

/**
 * ARCH.2D: Atomic lesson cancellation in Firestore (default).
 * Derives cancelledBy safely from caller role, enforces idempotency, and restores +1 paid credit
 * once when cancelled by teacher or admin on a non-trial lesson.
 */
export async function cancelLessonAtomicServer(
  params: LessonLifecycleCallerParams & {
    requestedCancelledBy?: string;
    reason?: string;
  }
): Promise<LessonLifecycleResult> {
  const lessonId = (params.lessonId || '').trim();
  const callerUid = (params.callerUid || '').trim();
  const reason = typeof params.reason === 'string' ? params.reason.trim() : '';

  if (!callerUid) {
    return { success: false, statusCode: 401, error: 'Autenticação necessária.' };
  }
  if (!lessonId) {
    return { success: false, statusCode: 400, error: 'Identificador da aula ausente.' };
  }

  const db = getFirestoreDb();
  if (!db || isCloudWriteDisabled) {
    return { success: false, statusCode: 503, error: 'Serviço de persistência Firestore (default) indisponível.' };
  }

  const lessonRef = db.collection('lessons').doc(lessonId);
  const preSnap = await lessonRef.get().catch(() => null);
  if (!preSnap || !preSnap.exists) {
    return { success: false, statusCode: 404, error: 'Aula não encontrada no Firestore.' };
  }

  const preData = preSnap.data() || {};
  const auth = await resolveLessonCallerContext(
    preData,
    callerUid,
    params.callerEmail,
    params.callerRole,
    params.callerEmailVerified
  );
  if (!auth.isAuthorized) {
    return { success: false, statusCode: 403, error: 'Acesso negado: você não tem permissão para cancelar esta aula.' };
  }

  // Server-authoritative responsibility derivation: students cannot self-authorize teacher fault refunds
  const effectiveCancelledBy: 'student' | 'teacher' | 'admin' = auth.isAdmin
    ? params.requestedCancelledBy === 'teacher'
      ? 'teacher'
      : params.requestedCancelledBy === 'student'
      ? 'student'
      : 'admin'
    : auth.isTeacher
    ? 'teacher'
    : 'student';

  const refs = collectLessonParticipantRefs(db, preData, lessonId);
  const nowIso = new Date().toISOString();

  try {
    const txRes = await db.runTransaction(async (transaction) => {
      const [lessonSnap, studentSnap, ...teacherUserSnaps] = await Promise.all([
        transaction.get(lessonRef),
        refs.studentRef ? transaction.get(refs.studentRef) : Promise.resolve(null),
        ...refs.teacherUserRefs.map((t) => transaction.get(t.userRef)),
      ]);

      if (!lessonSnap.exists) {
        throw new SchedulingTransactionError('Aula não encontrada no Firestore.', 404);
      }

      const latest = lessonSnap.data() || {};
      const studentData = studentSnap && studentSnap.exists ? (studentSnap.data() || {}) : null;

      if (latest.status === 'completed' || latest.status === 'not_completed') {
        throw new SchedulingTransactionError(
          'Transição inválida: não é possível cancelar uma aula já concluída ou marcada como não realizada.',
          409
        );
      }

      if (latest.status === 'cancelled' || latest.status === 'canceled' || Boolean(latest.cancelledAt)) {
        return {
          isIdempotent: true,
          lesson: { ...latest, id: lessonId },
          remainingLessons: typeof studentData?.availableLessons === 'number' ? studentData.availableLessons : undefined,
          creditRefunded: Boolean(latest.creditRefunded),
        };
      }

      const shouldRefund =
        (effectiveCancelledBy === 'teacher' || effectiveCancelledBy === 'admin') &&
        !Boolean(latest.isTrialLesson) &&
        latest.creditRefunded !== true;

      let nextAvailable = typeof studentData?.availableLessons === 'number' ? studentData.availableLessons : undefined;
      let actuallyRefunded = false;

      if (shouldRefund && refs.studentRef && studentData && typeof studentData.availableLessons === 'number') {
        nextAvailable = studentData.availableLessons + 1;
        actuallyRefunded = true;
      }

      const cancelUpdates: Record<string, any> = {
        status: 'cancelled',
        cancelledAt: nowIso,
        cancelledBy: effectiveCancelledBy,
        cancellationReason: reason || 'Cancelled by user',
        proposalStatus: null,
        proposedNewStartDateTime: null,
        proposedNewEndDateTime: null,
        updatedAt: nowIso,
      };
      if (actuallyRefunded) {
        cancelUpdates.creditRefunded = true;
        cancelUpdates.creditRefundedAt = nowIso;
      }

      const mergedLesson = { ...latest, ...cancelUpdates, id: lessonId };
      transaction.set(lessonRef, cancelUpdates, { merge: true });
      if (refs.studentSubLessonRef) {
        transaction.set(refs.studentSubLessonRef, mergedLesson, { merge: true });
      }
      for (const tRef of refs.teacherUserRefs) {
        transaction.set(tRef.subLessonRef, mergedLesson, { merge: true });
      }
      for (const tuRef of refs.tutorSubRefs) {
        transaction.set(tuRef.subLessonRef, mergedLesson, { merge: true });
      }

      if (refs.studentRef && studentData) {
        const studentPatch: Record<string, any> = { updatedAt: nowIso };
        if (actuallyRefunded && nextAvailable !== undefined) {
          studentPatch.availableLessons = nextAvailable;
        }
        const nextScheduled = updateUserScheduledLessonsArray(studentData, lessonId, cancelUpdates, true);
        if (nextScheduled !== undefined) {
          studentPatch.scheduledLessons = nextScheduled;
        }
        if (Object.keys(studentPatch).length > 1) {
          transaction.set(refs.studentRef, studentPatch, { merge: true });
        }
      }

      refs.teacherUserRefs.forEach((tRef, idx) => {
        const tSnap = teacherUserSnaps[idx];
        if (tSnap && tSnap.exists) {
          const nextScheduled = updateUserScheduledLessonsArray(tSnap.data(), lessonId, cancelUpdates, true);
          if (nextScheduled !== undefined) {
            transaction.set(tRef.userRef, { scheduledLessons: nextScheduled, updatedAt: nowIso }, { merge: true });
          }
        }
      });

      return {
        isIdempotent: false,
        lesson: mergedLesson,
        remainingLessons: nextAvailable,
        creditRefunded: actuallyRefunded,
      };
    });

    return {
      success: true,
      statusCode: 200,
      isIdempotent: txRes.isIdempotent,
      lesson: txRes.lesson,
      remainingLessons: txRes.remainingLessons,
      creditRefunded: txRes.creditRefunded,
    };
  } catch (err) {
    return mapLessonTxError(err, 'cancelamento da aula');
  }
}

/**
 * ARCH.2D: Atomic lesson deletion in Firestore (default).
 * Removes root lesson and participant subcollection links; restores +1 paid credit if an admin
 * deletes an active scheduled non-trial lesson that has not yet been refunded.
 */
export async function deleteLessonAtomicServer(
  params: LessonLifecycleCallerParams
): Promise<LessonLifecycleResult> {
  const lessonId = (params.lessonId || '').trim();
  const callerUid = (params.callerUid || '').trim();

  if (!callerUid) {
    return { success: false, statusCode: 401, error: 'Autenticação necessária.' };
  }
  if (!lessonId) {
    return { success: false, statusCode: 400, error: 'Identificador da aula ausente.' };
  }

  const db = getFirestoreDb();
  if (!db || isCloudWriteDisabled) {
    return { success: false, statusCode: 503, error: 'Serviço de persistência Firestore (default) indisponível.' };
  }

  const lessonRef = db.collection('lessons').doc(lessonId);
  const preSnap = await lessonRef.get().catch(() => null);
  if (!preSnap || !preSnap.exists) {
    return { success: false, statusCode: 404, error: 'Aula não encontrada no Firestore.' };
  }

  const preData = preSnap.data() || {};
  const auth = await resolveLessonCallerContext(
    preData,
    callerUid,
    params.callerEmail,
    params.callerRole,
    params.callerEmailVerified
  );
  if (!auth.isAuthorized) {
    return { success: false, statusCode: 403, error: 'Acesso negado: você não tem permissão para excluir esta aula.' };
  }

  // Only admin may delete active/completed lessons; participants may only delete already-cancelled records
  const isAlreadyCancelled =
    preData.status === 'cancelled' || preData.status === 'canceled' || Boolean(preData.cancelledAt);
  if (!auth.isAdmin && !isAlreadyCancelled) {
    return {
      success: false,
      statusCode: 403,
      error: 'Proibido: utilize a rota de cancelamento para cancelar aulas ativas. Apenas administradores podem excluir registros ativos.',
    };
  }

  const refs = collectLessonParticipantRefs(db, preData, lessonId);
  const nowIso = new Date().toISOString();

  try {
    const txRes = await db.runTransaction(async (transaction) => {
      const [lessonSnap, studentSnap, ...teacherUserSnaps] = await Promise.all([
        transaction.get(lessonRef),
        refs.studentRef ? transaction.get(refs.studentRef) : Promise.resolve(null),
        ...refs.teacherUserRefs.map((t) => transaction.get(t.userRef)),
      ]);

      if (!lessonSnap.exists) {
        throw new SchedulingTransactionError('Aula não encontrada no Firestore.', 404);
      }

      const latest = lessonSnap.data() || {};
      const studentData = studentSnap && studentSnap.exists ? (studentSnap.data() || {}) : null;

      const isActiveScheduled =
        (!latest.status || latest.status === 'scheduled' || latest.status === 'confirmed') &&
        !Boolean(latest.cancelledAt);

      const shouldRefund =
        auth.isAdmin &&
        isActiveScheduled &&
        !Boolean(latest.isTrialLesson) &&
        latest.creditRefunded !== true;

      let nextAvailable = typeof studentData?.availableLessons === 'number' ? studentData.availableLessons : undefined;
      let actuallyRefunded = false;

      if (shouldRefund && refs.studentRef && studentData && typeof studentData.availableLessons === 'number') {
        nextAvailable = studentData.availableLessons + 1;
        actuallyRefunded = true;
      }

      transaction.delete(lessonRef);
      if (refs.studentSubLessonRef) {
        transaction.delete(refs.studentSubLessonRef);
      }
      for (const tRef of refs.teacherUserRefs) {
        transaction.delete(tRef.subLessonRef);
      }
      for (const tuRef of refs.tutorSubRefs) {
        transaction.delete(tuRef.subLessonRef);
      }

      if (refs.studentRef && studentData) {
        const studentPatch: Record<string, any> = { updatedAt: nowIso };
        if (actuallyRefunded && nextAvailable !== undefined) {
          studentPatch.availableLessons = nextAvailable;
        }
        const nextScheduled = updateUserScheduledLessonsArray(studentData, lessonId, null, true);
        if (nextScheduled !== undefined) {
          studentPatch.scheduledLessons = nextScheduled;
        }
        if (Object.keys(studentPatch).length > 1) {
          transaction.set(refs.studentRef, studentPatch, { merge: true });
        }
      }

      refs.teacherUserRefs.forEach((tRef, idx) => {
        const tSnap = teacherUserSnaps[idx];
        if (tSnap && tSnap.exists) {
          const nextScheduled = updateUserScheduledLessonsArray(tSnap.data(), lessonId, null, true);
          if (nextScheduled !== undefined) {
            transaction.set(tRef.userRef, { scheduledLessons: nextScheduled, updatedAt: nowIso }, { merge: true });
          }
        }
      });

      return {
        remainingLessons: nextAvailable,
        creditRefunded: actuallyRefunded,
      };
    });

    return {
      success: true,
      statusCode: 200,
      deletedId: lessonId,
      remainingLessons: txRes.remainingLessons,
      creditRefunded: txRes.creditRefunded,
    };
  } catch (err) {
    return mapLessonTxError(err, 'exclusão da aula');
  }
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

  // 5. Fallback verification via server authoritative in-memory db (getAuthoritativeDb) for student/tutor profile assignment
  const dbLocal = getAuthoritativeDb();
  if (dbLocal) {
    try {
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
 * FASE NF-NOTES.6: Canonical verification of the pedagogical link between Student and Native Friend.
 * Reuses the existing Student <-> Teacher pedagogical relationship already in Firestore (default)
 * without creating parallel collections or secondary links.
 * Identifies the student EXCLUSIVELY by their canonical Firebase Auth UID.
 * Never uses email, display name, or lessonId as authorization credentials.
 */
export async function verifyCanonicalPedagogicalLinkServer(
  teacherUid: string,
  studentUid: string
): Promise<boolean> {
  const cleanTeacherUid = (teacherUid || '').trim();
  const cleanStudentUid = (studentUid || '').trim();

  // 1. Strict validation of canonical UIDs
  if (
    !cleanTeacherUid ||
    !cleanStudentUid ||
    !isValidCanonicalUid(cleanTeacherUid) ||
    !isValidCanonicalUid(cleanStudentUid) ||
    cleanTeacherUid === cleanStudentUid
  ) {
    return false;
  }

  const db = getFirestoreDb();
  const dbLocal = getAuthoritativeDb();
  const allowedTeacherIds = new Set<string>([cleanTeacherUid, `tutor-${cleanTeacherUid}`]);
  try {
    const teacherIdent = await resolveTeacherCanonicalIdentity({ teacherUid: cleanTeacherUid, dbState: dbLocal }).catch(() => null);
    if (teacherIdent?.publicTutorId) {
      allowedTeacherIds.add(teacherIdent.publicTutorId);
      allowedTeacherIds.add(`tutor-${teacherIdent.publicTutorId}`);
    }
    if (teacherIdent?.canonicalUid) {
      allowedTeacherIds.add(teacherIdent.canonicalUid);
      allowedTeacherIds.add(`tutor-${teacherIdent.canonicalUid}`);
    }
  } catch {}

  // 2. Check canonical Firestore (default): users/{studentUid}
  if (db) {
    try {
      const userSnap = await db.collection('users').doc(cleanStudentUid).get();
      if (userSnap.exists) {
        const uData = userSnap.data();
        const assignedUid = (
          uData?.assignedNativeFriendUID ||
          uData?.teacherUid ||
          uData?.assignedTeacherId ||
          uData?.assignedTutorId ||
          uData?.teacherId ||
          ''
        ).trim();
        if (assignedUid && allowedTeacherIds.has(assignedUid)) {
          return true;
        }
      }
    } catch (fsErr) {
      if (!isPermissionError(fsErr)) {
        console.warn('[serverFirestore] verifyCanonicalPedagogicalLinkServer user doc notice:', fsErr);
      }
    }

    // 3. Check canonical Firestore (default): lessons collection
    try {
      for (const tId of allowedTeacherIds) {
        const [lessonSnap, lessonAuthSnap] = await Promise.all([
          db
            .collection('lessons')
            .where('studentUid', '==', cleanStudentUid)
            .where('teacherUid', '==', tId)
            .get(),
          db
            .collection('lessons')
            .where('studentUid', '==', cleanStudentUid)
            .where('teacherAuthUid', '==', tId)
            .get(),
        ]);
        const allDocs = [...(lessonSnap?.docs || []), ...(lessonAuthSnap?.docs || [])];
        if (allDocs.length > 0) {
          const hasValidLesson = allDocs.some((d) => {
            const lData = d.data();
            return lData.status !== 'cancelled' && lData.status !== 'canceled';
          });
          if (hasValidLesson || allDocs.length > 0) {
            return true;
          }
        }
      }
    } catch (fsErr) {
      if (!isPermissionError(fsErr)) {
        console.warn('[serverFirestore] verifyCanonicalPedagogicalLinkServer lessons notice:', fsErr);
      }
    }
  }

  // 4. Check authoritative in-memory / local state (getAuthoritativeDb) for profile assignment
  if (dbLocal) {
    // 4a. Check student profile in dbLocal.students or dbLocal.userProfiles
    const student = (dbLocal.students || []).find(
      (s: any) =>
        (s.uid && s.uid === cleanStudentUid) ||
        (s.id && s.id === cleanStudentUid) ||
        (s.studentUid && s.studentUid === cleanStudentUid)
    );
    const profile = Object.values(dbLocal.userProfiles || {}).find(
      (p: any) => p.uid && p.uid === cleanStudentUid
    ) as any;

    const assignedUid = (
      student?.assignedNativeFriendUID ||
      student?.teacherUid ||
      student?.assignedTeacherId ||
      student?.assignedTutorId ||
      student?.teacherId ||
      profile?.assignedNativeFriendUID ||
      profile?.teacherUid ||
      profile?.assignedTeacherId ||
      profile?.teacherId ||
      ''
    ).trim();

    if (assignedUid && allowedTeacherIds.has(assignedUid)) {
      return true;
    }
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

  const parseActivityTimeMs = (raw: any, fallbackDate?: any, isEndOfDayDateFallback: boolean = false): number => {
    if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return raw;
    if (typeof raw === 'string' && raw.trim()) {
      const t = new Date(raw.trim()).getTime();
      if (!isNaN(t) && t > 0) return t;
    }
    if (typeof fallbackDate === 'string' && fallbackDate.trim()) {
      const s = fallbackDate.trim();
      const iso = /^\d{4}-\d{2}-\d{2}$/.test(s)
        ? `${s}T${isEndOfDayDateFallback ? '23:59:59.999' : '12:00:00.000'}Z`
        : s;
      const t = new Date(iso).getTime();
      if (!isNaN(t) && t > 0) return t;
    }
    return 0;
  };

  const cutoffIso = prevLesson?.startDateTime || (prevLesson?.date ? `${prevLesson.date}T00:00:00.000Z` : null);
  const cutoffTime = cutoffIso ? new Date(cutoffIso).getTime() : 0;
  const hasExactCurrentStart = Boolean(currentLesson?.startDateTime);
  const currentIso = currentLesson?.startDateTime || (currentLesson?.date ? `${currentLesson.date}T23:59:59.999Z` : new Date().toISOString());
  const currentTime = new Date(currentIso).getTime();
  const upperWindowTime = hasExactCurrentStart ? currentTime + 3 * 3600000 : currentTime + 86400000;

  // 3. Query Studied Videos and Vocabulary from canonical Firestore (default)
  const rawVideos: Array<{ id?: string; title: string; dayOfWeek?: string; date?: string; timestamp: number; sourceRank: number }> = [];
  const rawWords: any[] = [];

  const targetDocIds = Array.from(
    new Set([canonicalUid, ...(isValidCanonicalUid(cleanUid) ? [cleanUid] : [])].filter(Boolean))
  );
  if (targetDocIds.length === 0 && cleanUid && !cleanUid.includes('@')) {
    targetDocIds.push(cleanUid);
  }

  let userDocData: any = null;
  for (const docId of targetDocIds) {
    if (db) {
      try {
        const userRef = db.collection('users').doc(docId);
        const [activitySnap, legacySubSnap, whSnap, vocabSnap, uSnap] = await Promise.all([
          withTimeout(userRef.collection('activity_journal').get(), 4500).catch(() => null),
          withTimeout(userRef.collection('studentJournal').get(), 4500).catch(() => null),
          withTimeout(userRef.collection('weeklyHistory').get(), 4500).catch(() => null),
          withTimeout(userRef.collection('vocabulary').get(), 4500).catch(() => null),
          withTimeout(userRef.get(), 4500).catch(() => null),
        ]);

        if (activitySnap && !activitySnap.empty) {
          activitySnap.forEach((docSnap: any) => {
            const d = docSnap.data();
            if (d && (d.type === 'video' || d.activityType === 'video') && (d.title || d.videoTitle)) {
              rawVideos.push({
                id: d.id || d.videoId || docSnap.id,
                title: d.title || d.videoTitle,
                dayOfWeek: d.dayOfWeek,
                date: d.date,
                timestamp: parseActivityTimeMs(d.timestamp ?? d.completedAt ?? d.createdAt ?? d.updatedAt, d.date),
                sourceRank: 1,
              });
            }
          });
        }

        if (legacySubSnap && !legacySubSnap.empty) {
          legacySubSnap.forEach((docSnap: any) => {
            const d = docSnap.data();
            if (d && (d.type === 'video' || d.activityType === 'video') && (d.title || d.videoTitle)) {
              rawVideos.push({
                id: d.id || d.videoId || docSnap.id,
                title: d.title || d.videoTitle,
                dayOfWeek: d.dayOfWeek,
                date: d.date,
                timestamp: parseActivityTimeMs(d.timestamp ?? d.completedAt ?? d.createdAt, d.date),
                sourceRank: 2,
              });
            }
          });
        }

        if (whSnap && !whSnap.empty) {
          whSnap.forEach((docSnap: any) => {
            const wh = docSnap.data();
            if (Array.isArray(wh?.consumedVideoIds)) {
              wh.consumedVideoIds.forEach((v: any) => {
                if (v && (v.title || v.videoTitle)) {
                  rawVideos.push({
                    id: v.id || v.videoId,
                    title: v.title || v.videoTitle,
                    dayOfWeek: v.dayOfWeek,
                    date: v.date,
                    timestamp: parseActivityTimeMs(v.timestamp ?? v.watchedAt, v.date),
                    sourceRank: 3,
                  });
                }
              });
            }
            if (Array.isArray(wh?.weeklyVocabulary)) {
              wh.weeklyVocabulary.forEach((w: any) => {
                if (w && w.word && !rawWords.some((rw) => (rw.word || '').toLowerCase() === (w.word || '').toLowerCase())) {
                  rawWords.push(w);
                }
              });
            }
          });
        }

        if (vocabSnap && !vocabSnap.empty) {
          vocabSnap.forEach((docSnap: any) => rawWords.push(docSnap.data()));
        }

        if (uSnap && uSnap.exists) {
          userDocData = uSnap.data();
          if (Array.isArray(userDocData?.studentJournal)) {
            userDocData.studentJournal.forEach((d: any) => {
              if (d && (d.type === 'video' || d.activityType === 'video') && (d.title || d.videoTitle)) {
                rawVideos.push({
                  id: d.id || d.videoId,
                  title: d.title || d.videoTitle,
                  dayOfWeek: d.dayOfWeek,
                  date: d.date,
                  timestamp: parseActivityTimeMs(d.timestamp ?? d.completedAt ?? d.createdAt, d.date),
                  sourceRank: 4,
                });
              }
            });
          }
          if (Array.isArray(userDocData?.vocabulary)) {
            userDocData.vocabulary.forEach((item: any) => {
              if (item?.word && !rawWords.some((w) => (w.word || '').toLowerCase().trim() === (item.word || '').toLowerCase().trim())) {
                rawWords.push(item);
              }
            });
          }
        }
      } catch {}
    }
  }

  // Prioritize canonical activity_journal entries and newest timestamps first
  rawVideos.sort((a, b) => {
    if (a.sourceRank !== b.sourceRank) return a.sourceRank - b.sourceRank;
    return (b.timestamp || 0) - (a.timestamp || 0);
  });

  // Filter videos between cutoffTime and currentTime
  const filteredVideos: Array<{ id?: string; title: string; dayOfWeek?: string; date?: string }> = [];
  const seenVideoKeys = new Set<string>();

  for (const v of rawVideos) {
    if (!v.title) continue;
    const normTitle = v.title.toLowerCase().trim();
    const normId = (v.id ? String(v.id).toLowerCase().trim() : '') || normTitle;
    if (seenVideoKeys.has(normTitle) || (v.id && seenVideoKeys.has(normId))) continue;

    const itemTime = v.timestamp || parseActivityTimeMs(undefined, v.date, true);
    if (cutoffTime > 0 && itemTime > 0) {
      if (itemTime < cutoffTime || itemTime > upperWindowTime) {
        continue;
      }
    } else if (currentTime > 0 && itemTime > upperWindowTime) {
      continue;
    }

    seenVideoKeys.add(normTitle);
    if (v.id) seenVideoKeys.add(normId);
    filteredVideos.push({
      id: v.id,
      title: v.title,
      dayOfWeek: v.dayOfWeek,
      date: v.date,
    });
    if (filteredVideos.length >= 5) break;
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

    const learnedTime = parseActivityTimeMs(w.learnedAt ?? w.createdAt ?? w.updatedAt, w.date, true);
    if (cutoffTime > 0 && learnedTime > 0) {
      if (learnedTime < cutoffTime || learnedTime > upperWindowTime) {
        continue;
      }
    } else if (currentTime > 0 && learnedTime > upperWindowTime) {
      continue;
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

/**
 * HOTFIX 2.3.5E: Transactional Cycle Conflict Error
 */
export class CycleConflictError extends Error {
  public actualCycle: number;
  public expectedCycle?: number;
  constructor(actualCycle: number, expectedCycle?: number, message?: string) {
    super(
      message ||
        `Cycle conflict: expected cycle ${expectedCycle !== undefined ? expectedCycle : 'unknown'} does not match persisted cycle ${actualCycle}`
    );
    this.name = 'CycleConflictError';
    this.actualCycle = actualCycle;
    this.expectedCycle = expectedCycle;
  }
}

export interface CyclePreparationSteps {
  routinesReset?: boolean;
  routinesResetDays?: string[];
  weeklyChecksInitialized?: boolean;
  assignmentsCleared?: boolean;
  weeklyHistoryInitialized?: boolean;
}

export interface CyclePreparationLease {
  ownerId: string;
  fencingToken: number;
  attemptId?: string | null;
  targetCycle: number;
  acquiredAt: string;
  expiresAt: string;
  heartbeatAt?: string;
}

export class PreparationFencingError extends Error {
  public code: string;
  public statusCode: number;
  constructor(code: string, message: string, statusCode = 409) {
    super(message);
    this.name = 'PreparationFencingError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export interface CycleTransitionRecord {
  attemptId?: string | null;
  previousCycle: number;
  targetCycle: number;
  status: 'pending_preparation' | 'completed';
  startedAt?: string;
  completedAt?: string;
  lastError?: string | null;
  steps?: CyclePreparationSteps;
  lease?: CyclePreparationLease | null;
  fencingEpoch?: number;
}

export interface CycleStatusRecord {
  currentCycle: number;
  lastCycleAttemptId?: string;
  lastCycleResult?: any;
  cycleTransition?: CycleTransitionRecord | null;
  weeklyStudyDaysTarget?: number;
  weeklyStudyDays?: string[];
  studentEmail?: string;
  level?: string;
  routineVideoTime?: string;
  updatedAt?: string;
}

/**
 * HOTFIX 2.3.5E / ARCH.2E.2D: Fetches current persisted cycle, transition state, and last confirmed attempt from Firestore
 */
export async function fetchStudentCycleStatusFromServerFirestore(
  studentUid: string
): Promise<CycleStatusRecord | null> {
  const db = getFirestoreDb();
  if (!db || !studentUid) return null;
  try {
    const userDoc = await withTimeout(db.collection('users').doc(studentUid).get(), 4500);
    if (!userDoc || !userDoc.exists) return null;
    const d = userDoc.data() || {};
    return {
      currentCycle: parsePositiveCycleFromFirestore(d.weeklyCycle) ?? 1,
      lastCycleAttemptId: d.lastCycleAttemptId || undefined,
      lastCycleResult: d.lastCycleResult || null,
      cycleTransition: d.cycleTransition || null,
      weeklyStudyDaysTarget:
        typeof d.weeklyStudyDaysTarget === 'number' && d.weeklyStudyDaysTarget >= 1 && d.weeklyStudyDaysTarget <= 7
          ? d.weeklyStudyDaysTarget
          : 7,
      weeklyStudyDays:
        Array.isArray(d.weeklyStudyDays) && d.weeklyStudyDays.length > 0
          ? d.weeklyStudyDays
          : [...DEFAULT_STUDY_DAYS],
      studentEmail: (d.email || '').toLowerCase().trim(),
      level: (d.englishLevel || d.level || d.userLevel || 'intermediate').toString(),
      routineVideoTime: d.routineVideoTime || undefined,
      updatedAt: d.updatedAt,
    };
  } catch {
    return null;
  }
}

/**
 * HOTFIX 2.3.5E / ARCH.2E.2D: Persists the confirmed cycle advance result on users/{studentUID}
 */
export async function saveLastCycleResultToFirestore(
  studentUid: string,
  attemptId: string,
  result: any
): Promise<boolean> {
  const db = getFirestoreDb();
  if (!db || !studentUid || getIsCloudWriteDisabled()) return false;
  try {
    const ok = await withTimeout(
      db
        .collection('users')
        .doc(studentUid)
        .set(
          removeUndefinedFields({
            lastCycleAttemptId: attemptId,
            lastCycleResult: result,
            updatedAt: new Date().toISOString(),
          }),
          { merge: true }
        )
        .then(() => true),
      4500
    );
    return Boolean(ok);
  } catch (err: any) {
    if (isPermissionError(err)) {
      setIsCloudWriteDisabled(true);
    }
    return false;
  }
}

/**
 * ARCH.2E.2D: Fetches a single weeklyHistory document from users/{uid}/weeklyHistory/{weekId}
 */
export async function fetchWeeklyHistoryServer(
  studentUid: string,
  weekId: string
): Promise<any | null> {
  const db = getFirestoreDb();
  if (!db || !studentUid) return null;
  const cleanWeek = (weekId || 'week-1').trim();
  try {
    const snap = await withTimeout(
      db.collection('users').doc(studentUid).collection('weeklyHistory').doc(cleanWeek).get(),
      4500
    );
    if (!snap || !snap.exists) return null;
    return snap.data() || null;
  } catch (err: any) {
    if (!isPermissionError(err)) {
      console.warn('[serverFirestore] fetchWeeklyHistoryServer notice:', err);
    }
    return null;
  }
}

/**
 * ARCH.2E.2D: Fetches all weeklyHistory documents from users/{uid}/weeklyHistory
 */
export async function fetchAllWeeklyHistoriesServer(studentUid: string): Promise<any[]> {
  const db = getFirestoreDb();
  if (!db || !studentUid) return [];
  try {
    const snap = await withTimeout(
      db.collection('users').doc(studentUid).collection('weeklyHistory').get(),
      4500
    );
    if (!snap || snap.empty) return [];
    const list: any[] = [];
    snap.forEach((docSnap: any) => {
      const data = docSnap.data();
      if (data) {
        list.push({
          ...data,
          weekId: data.weekId || docSnap.id,
          studentUid: data.studentUid || studentUid,
        });
      }
    });
    list.sort((a, b) => {
      const ca = parsePositiveCycleFromFirestore(a.weeklyCycle ?? a.weekId) ?? 0;
      const cb = parsePositiveCycleFromFirestore(b.weeklyCycle ?? b.weekId) ?? 0;
      return ca - cb;
    });
    return list;
  } catch (err: any) {
    if (!isPermissionError(err)) {
      console.warn('[serverFirestore] fetchAllWeeklyHistoriesServer notice:', err);
    }
    return [];
  }
}

function mergeConsumedVideos(existing: any[] = [], incoming: any[] = []): any[] {
  const byId = new Map<string, any>();
  const orderedKeys: string[] = [];
  const ingest = (item: any) => {
    if (!item || typeof item !== 'object') return;
    const rawId = item.videoId || item.id || item.url || '';
    const cleanId = (extractYouTubeIdInternal(rawId) || String(rawId || '')).trim();
    if (!cleanId) return;
    const key = cleanId.toLowerCase();
    const prev = byId.get(key);
    const normalized = {
      ...(prev || {}),
      ...item,
      id: cleanId,
      videoId: cleanId,
      videoTitle: (item.videoTitle || item.title || prev?.videoTitle || prev?.title || 'Daily Video Practice').trim(),
      title: (item.title || item.videoTitle || prev?.title || prev?.videoTitle || 'Daily Video Practice').trim(),
    };
    if (!prev) orderedKeys.push(key);
    byId.set(key, normalized);
  };
  existing.forEach(ingest);
  incoming.forEach(ingest);
  return orderedKeys.map((k) => byId.get(k));
}

function mergeConsumedTracks(existing: any[] = [], incoming: any[] = []): any[] {
  const byId = new Map<string, any>();
  const orderedKeys: string[] = [];
  const ingest = (item: any) => {
    if (!item || typeof item !== 'object') return;
    const rawId = item.trackId || item.id || item.trackUrl || item.url || '';
    const cleanId = (extractSpotifyTrackIdInternal(rawId) || String(rawId || '')).trim();
    if (!cleanId) return;
    const key = cleanId.toLowerCase();
    const prev = byId.get(key);
    const normalized = {
      ...(prev || {}),
      ...item,
      id: cleanId,
      trackId: cleanId,
      title: (item.title || item.trackTitle || prev?.title || prev?.trackTitle || 'Daily Track').trim(),
      artist: (item.artist || item.artistOrHost || prev?.artist || prev?.artistOrHost || 'Spotify Artist').trim(),
    };
    if (!prev) orderedKeys.push(key);
    byId.set(key, normalized);
  };
  existing.forEach(ingest);
  incoming.forEach(ingest);
  return orderedKeys.map((k) => byId.get(k));
}

function mergeWeeklyVocabularyItems(existing: any[] = [], incoming: any[] = []): any[] {
  const byWord = new Map<string, any>();
  const orderedKeys: string[] = [];
  const ingest = (item: any) => {
    if (!item) return;
    const rawWord = typeof item === 'string' ? item : item.word || '';
    const cleanWord = String(rawWord || '').trim();
    if (!cleanWord) return;
    const key = cleanWord.toLowerCase();
    const prev = byWord.get(key);
    const itemObj = typeof item === 'string' ? { word: cleanWord } : item;
    const normalized = {
      ...(prev || {}),
      ...itemObj,
      word: cleanWord,
    };
    if (!prev) orderedKeys.push(key);
    byWord.set(key, normalized);
  };
  existing.forEach(ingest);
  incoming.forEach(ingest);
  return orderedKeys.map((k) => byWord.get(k));
}

/**
 * ARCH.2E.2D: Safe merge write to users/{uid}/weeklyHistory/{weekId}
 */
export async function saveWeeklyHistoryServer(
  studentUid: string,
  weekId: string,
  data: Partial<Record<string, any>>,
  options?: { createOnlyIfMissing?: boolean; skipIfClosed?: boolean }
): Promise<{ ok: boolean; skipped?: boolean; data?: any; error?: string; statusCode?: number }> {
  if (getIsCloudWriteDisabled()) {
    return { ok: false, statusCode: 500, error: 'Firestore cloud writes disabled by IAM.' };
  }
  const db = getFirestoreDb();
  if (!db || !studentUid) {
    return { ok: false, statusCode: 503, error: 'Canonical Firestore database unavailable.' };
  }

  const cleanWeek = (weekId || 'week-1').trim();
  const parsedCycle = parsePositiveCycleFromFirestore(data.weeklyCycle ?? cleanWeek) ?? 1;
  const docRef = db.collection('users').doc(studentUid).collection('weeklyHistory').doc(cleanWeek);

  try {
    const existingSnap = await withTimeout(docRef.get(), 4500);
    const existing = existingSnap && existingSnap.exists ? (existingSnap.data() || {}) : null;

    if (options?.createOnlyIfMissing && existing) {
      return { ok: true, skipped: true, data: existing };
    }

    if (existing?.closedAt) {
      if (options?.skipIfClosed) {
        return { ok: true, skipped: true, data: existing };
      }
      return {
        ok: false,
        statusCode: 409,
        error: `Weekly history ${cleanWeek} is already closed and cannot be overwritten.`,
      };
    }

    const nowIso = new Date().toISOString();
    const mergedVideos = mergeConsumedVideos(
      Array.isArray(existing?.consumedVideoIds) ? existing.consumedVideoIds : [],
      Array.isArray(data.consumedVideoIds) ? data.consumedVideoIds : []
    );
    const mergedTracks = mergeConsumedTracks(
      Array.isArray(existing?.consumedTrackIds) ? existing.consumedTrackIds : [],
      Array.isArray(data.consumedTrackIds) ? data.consumedTrackIds : []
    );
    const mergedVocab = mergeWeeklyVocabularyItems(
      Array.isArray(existing?.weeklyVocabulary) ? existing.weeklyVocabulary : [],
      Array.isArray(data.weeklyVocabulary) ? data.weeklyVocabulary : []
    );

    const payload = removeUndefinedFields({
      ...(existing || {}),
      ...data,
      studentUid,
      weekId: cleanWeek,
      weeklyCycle: parsedCycle,
      consumedVideoIds: mergedVideos,
      consumedTrackIds: mergedTracks,
      weeklyVocabulary: mergedVocab,
      ...(existing?.weeklyChecks || data.weeklyChecks
        ? { weeklyChecks: { ...(existing?.weeklyChecks || {}), ...(data.weeklyChecks || {}) } }
        : {}),
      ...(existing?.activitiesSnapshot || data.activitiesSnapshot
        ? { activitiesSnapshot: { ...(existing?.activitiesSnapshot || {}), ...(data.activitiesSnapshot || {}) } }
        : {}),
      updatedAt: nowIso,
    });

    const saved = await withTimeout(docRef.set(payload, { merge: true }).then(() => true), 4500);
    if (!saved) {
      return { ok: false, statusCode: 500, error: 'Failed to persist weeklyHistory in Firestore.' };
    }
    return { ok: true, data: payload };
  } catch (err: any) {
    if (isPermissionError(err)) {
      setIsCloudWriteDisabled(true);
    }
    console.warn('[serverFirestore] saveWeeklyHistoryServer error:', err);
    return { ok: false, statusCode: 500, error: err?.message || 'Firestore write failed.' };
  }
}

/**
 * ARCH.2E.2D: Fetches accumulated consumed video IDs, track IDs, and vocabulary from canonical Firestore (default) ONLY.
 */
export async function fetchAccumulatedConsumedHistoryServer(studentUid: string): Promise<{
  videoIds: string[];
  trackIds: string[];
  allVideos: any[];
  allTracks: any[];
  allVocabulary: any[];
}> {
  const db = getFirestoreDb();
  if (!db || !studentUid) {
    return { videoIds: [], trackIds: [], allVideos: [], allTracks: [], allVocabulary: [] };
  }

  const videoSet = new Set<string>();
  const trackSet = new Set<string>();
  let allVideos: any[] = [];
  let allTracks: any[] = [];
  let allVocabulary: any[] = [];

  try {
    const [histories, userSnap, assignSnap, activityJournalSnap] = await Promise.all([
      fetchAllWeeklyHistoriesServer(studentUid),
      withTimeout(db.collection('users').doc(studentUid).get(), 4500).catch(() => null),
      withTimeout(db.collection('student_assignments').doc(studentUid).get(), 4500).catch(() => null),
      withTimeout(db.collection('users').doc(studentUid).collection('activity_journal').get(), 4500).catch(() => null),
    ]);

    for (const hist of histories) {
      if (Array.isArray(hist.consumedVideoIds)) {
        allVideos = mergeConsumedVideos(allVideos, hist.consumedVideoIds);
        for (const v of hist.consumedVideoIds) {
          const clean = (extractYouTubeIdInternal(v?.videoId || v?.id || v?.url || '') || v?.videoId || v?.id || '').trim();
          if (clean) videoSet.add(clean);
        }
      }
      if (Array.isArray(hist.consumedTrackIds)) {
        allTracks = mergeConsumedTracks(allTracks, hist.consumedTrackIds);
        for (const t of hist.consumedTrackIds) {
          const clean = (extractSpotifyTrackIdInternal(t?.trackId || t?.id || t?.url || '') || t?.trackId || t?.id || '').trim();
          if (clean) trackSet.add(clean);
        }
      }
      if (Array.isArray(hist.weeklyVocabulary)) {
        allVocabulary = mergeWeeklyVocabularyItems(allVocabulary, hist.weeklyVocabulary);
      }
    }

    const uData = userSnap && userSnap.exists ? (userSnap.data() || {}) : {};
    const aData = assignSnap && assignSnap.exists ? (assignSnap.data() || {}) : {};

    const journalMap = new Map<string, any>();
    if (activityJournalSnap && !activityJournalSnap.empty) {
      activityJournalSnap.forEach((docSnap: any) => {
        const d = docSnap.data();
        if (d) {
          const eid = String(d.id || docSnap.id || '').trim();
          if (eid) journalMap.set(eid, { ...d, id: eid });
        }
      });
    }
    if (Array.isArray(uData.studentJournal)) {
      for (const entry of uData.studentJournal) {
        if (entry && entry.id && !journalMap.has(String(entry.id).trim())) {
          journalMap.set(String(entry.id).trim(), entry);
        }
      }
    }

    for (const entry of journalMap.values()) {
      if (!entry || !entry.id) continue;
      if (entry.type === 'video') {
        const vid = (extractYouTubeIdInternal(entry.id || entry.url || '') || String(entry.id)).trim();
          if (vid) {
            videoSet.add(vid);
            allVideos = mergeConsumedVideos(allVideos, [
              {
                id: vid,
                videoId: vid,
                videoTitle: entry.title || 'Daily Routine Video',
                title: entry.title || 'Daily Routine Video',
                watchedAt: (entry.timestamp ? new Date(entry.timestamp).toISOString() : entry.date) || '',
                dayOfWeek: entry.dayOfWeek,
              },
            ]);
          }
        } else if (entry.type === 'audio') {
          const tid = (extractSpotifyTrackIdInternal(entry.id || entry.url || '') || String(entry.id)).trim();
          if (tid) {
            trackSet.add(tid);
            allTracks = mergeConsumedTracks(allTracks, [
              {
                id: tid,
                trackId: tid,
                title: entry.title || 'Daily Track',
                artist: entry.artist || 'Spotify Artist',
                listenedAt: (entry.timestamp ? new Date(entry.timestamp).toISOString() : entry.date) || '',
                dayOfWeek: entry.dayOfWeek,
                url: entry.url || '',
              },
            ]);
          }
        }
      }

    const watchedSources = [
      ...(Array.isArray(uData.watchedVideosHistory) ? uData.watchedVideosHistory : []),
      ...(Array.isArray(uData.watchedVideos) ? uData.watchedVideos : []),
      ...(Array.isArray(aData.watchedVideos) ? aData.watchedVideos : []),
    ];
    for (const item of watchedSources) {
      const raw = typeof item === 'string' ? item : item?.videoId || item?.id || item?.url || '';
      const vid = (extractYouTubeIdInternal(raw) || String(raw || '')).trim();
      if (vid) {
        videoSet.add(vid);
        if (!allVideos.some((v) => (v.videoId || v.id || '').toLowerCase() === vid.toLowerCase())) {
          allVideos = mergeConsumedVideos(allVideos, [
            {
              id: vid,
              videoId: vid,
              videoTitle: (typeof item === 'object' && (item.videoTitle || item.title)) || 'Daily Video Practice',
              title: (typeof item === 'object' && (item.title || item.videoTitle)) || 'Daily Video Practice',
              watchedAt: (typeof item === 'object' && item.watchedAt) || '',
            },
          ]);
        }
      }
    }

    const listenedSources = [
      ...(Array.isArray(uData.listenedTracksHistory) ? uData.listenedTracksHistory : []),
      ...(Array.isArray(uData.listenedTracks) ? uData.listenedTracks : []),
      ...(Array.isArray(aData.listenedTracks) ? aData.listenedTracks : []),
    ];
    for (const item of listenedSources) {
      const raw = typeof item === 'string' ? item : item?.trackId || item?.id || item?.trackUrl || item?.url || '';
      const tid = (extractSpotifyTrackIdInternal(raw) || String(raw || '')).trim();
      if (tid) {
        trackSet.add(tid);
        if (!allTracks.some((t) => (t.trackId || t.id || '').toLowerCase() === tid.toLowerCase())) {
          allTracks = mergeConsumedTracks(allTracks, [
            {
              id: tid,
              trackId: tid,
              title: (typeof item === 'object' && (item.title || item.trackTitle)) || 'Daily Spotify Listening',
              artist: (typeof item === 'object' && (item.artist || item.artistOrHost)) || 'Spotify Artist',
              listenedAt: (typeof item === 'object' && item.listenedAt) || '',
            },
          ]);
        }
      }
    }
  } catch (err: any) {
    if (!isPermissionError(err)) {
      console.warn('[serverFirestore] fetchAccumulatedConsumedHistoryServer notice:', err);
    }
  }

  return {
    videoIds: Array.from(videoSet),
    trackIds: Array.from(trackSet),
    allVideos,
    allTracks,
    allVocabulary,
  };
}

/**
 * ARCH.2E.2D: Closes the outgoing cycle snapshot in users/{uid}/weeklyHistory/week-{closingCycle}
 * BEFORE advancing weeklyCycle.
 * - Preserves existing videos, tracks, activities, checks, and homework summary.
 * - Never invents completed activities.
 * - Never overwrites past closed histories.
 * - Never deletes or modifies Homework.
 */
export async function closeWeeklyHistorySnapshotServer(params: {
  uid: string;
  closingCycle: number;
  attemptId?: string;
  studentEmail?: string;
  clientWatchedVideos?: string[];
  clientListenedTracks?: string[];
}): Promise<{ ok: boolean; alreadyClosed?: boolean; history?: any; error?: string; statusCode?: number }> {
  if (getIsCloudWriteDisabled()) {
    return { ok: false, statusCode: 500, error: 'Firestore writes disabled by IAM.' };
  }
  const db = getFirestoreDb();
  if (!db || !params.uid) {
    return { ok: false, statusCode: 503, error: 'Canonical Firestore database unavailable.' };
  }

  const { uid, closingCycle, attemptId, studentEmail } = params;
  const weekId = `week-${closingCycle}`;
  const userRef = db.collection('users').doc(uid);

  try {
    const [userSnap, routinesSnap, assignSnap, checksCtx, hwSnap, historySnap, activityJournalSnap] = await Promise.all([
      withTimeout(userRef.get(), 4500),
      withTimeout(userRef.collection('routines').get(), 4500),
      withTimeout(db.collection('student_assignments').doc(uid).get(), 4500),
      fetchCanonicalWeeklyChecksServer(uid, weekId, closingCycle),
      withTimeout(userRef.collection('homework').doc(weekId).get(), 4500),
      withTimeout(userRef.collection('weeklyHistory').doc(weekId).get(), 4500),
      withTimeout(userRef.collection('activity_journal').get(), 4500).catch(() => null),
    ]);

    const uData = userSnap && userSnap.exists ? (userSnap.data() || {}) : {};
    const aData = assignSnap && assignSnap.exists ? (assignSnap.data() || {}) : {};
    const existingHistory = historySnap && historySnap.exists ? (historySnap.data() || {}) : null;
    const hwData = hwSnap && hwSnap.exists ? (hwSnap.data() || {}) : null;

    const currentPersistedCycle = parsePositiveCycleFromFirestore(uData.weeklyCycle) ?? 1;

    // Never reopen or overwrite an already closed history snapshot
    if (existingHistory?.closedAt) {
      return { ok: true, alreadyClosed: true, history: existingHistory };
    }
    if (currentPersistedCycle > closingCycle && existingHistory) {
      return { ok: true, alreadyClosed: true, history: existingHistory };
    }

    const nowIso = new Date().toISOString();
    const checksMap: Record<string, boolean> = checksCtx?.checks ? { ...checksCtx.checks } : {};
    const watchedHistoryIds = new Set<string>();
    const addWatchedId = (raw: any) => {
      const s = typeof raw === 'string' ? raw : raw?.videoId || raw?.id || raw?.url || '';
      const clean = (extractYouTubeIdInternal(s) || String(s || '')).trim();
      if (clean) watchedHistoryIds.add(clean);
    };
    (Array.isArray(uData.watchedVideosHistory) ? uData.watchedVideosHistory : []).forEach(addWatchedId);
    (Array.isArray(uData.watchedVideos) ? uData.watchedVideos : []).forEach(addWatchedId);
    (Array.isArray(aData.watchedVideos) ? aData.watchedVideos : []).forEach(addWatchedId);

    const listenedHistoryIds = new Set<string>();
    const addListenedId = (raw: any) => {
      const s = typeof raw === 'string' ? raw : raw?.trackId || raw?.id || raw?.trackUrl || raw?.url || '';
      const clean = (extractSpotifyTrackIdInternal(s) || String(s || '')).trim();
      if (clean) listenedHistoryIds.add(clean);
    };
    (Array.isArray(uData.listenedTracksHistory) ? uData.listenedTracksHistory : []).forEach(addListenedId);
    (Array.isArray(uData.listenedTracks) ? uData.listenedTracks : []).forEach(addListenedId);
    (Array.isArray(aData.listenedTracks) ? aData.listenedTracks : []).forEach(addListenedId);

    // Collect day routines belonging strictly to closingCycle
    const dayRoutinesMap: Record<string, any> = {};
    if (uData.routinesByDay && typeof uData.routinesByDay === 'object') {
      for (const [day, r] of Object.entries(uData.routinesByDay)) {
        if (!r || typeof r !== 'object') continue;
        const rCycle = parsePositiveCycleFromFirestore((r as any).weeklyCycle);
        if (rCycle === null || rCycle === closingCycle) {
          dayRoutinesMap[day] = { ...(r as any), dayOfWeek: day };
        }
      }
    }
    if (routinesSnap && !routinesSnap.empty) {
      routinesSnap.forEach((docSnap: any) => {
        const d = docSnap.data();
        if (!d) return;
        const rCycle = parsePositiveCycleFromFirestore(d.weeklyCycle);
        if (rCycle === null || rCycle === closingCycle) {
          dayRoutinesMap[docSnap.id] = { ...(dayRoutinesMap[docSnap.id] || {}), ...d, dayOfWeek: docSnap.id };
        }
      });
    }

    const collectedVideos: any[] = [];
    const collectedTracks: any[] = [];
    const collectedVocab: any[] = [];
    const activitiesSnapshot: Record<string, any> = {};
    const wordsToSaveToDictionary: any[] = [];

    // 1. Journal entries explicitly belonging to closingCycle (canonical activity_journal + legacy fallback)
    const closingJournalMap = new Map<string, any>();
    if (activityJournalSnap && !activityJournalSnap.empty) {
      activityJournalSnap.forEach((docSnap: any) => {
        const d = docSnap.data();
        if (d) {
          const eid = String(d.id || docSnap.id || '').trim();
          if (eid) closingJournalMap.set(eid, { ...d, id: eid });
        }
      });
    }
    if (Array.isArray(uData.studentJournal)) {
      for (const entry of uData.studentJournal) {
        if (entry && entry.id && !closingJournalMap.has(String(entry.id).trim())) {
          closingJournalMap.set(String(entry.id).trim(), entry);
        }
      }
    }
    const journal = Array.from(closingJournalMap.values());
    for (const entry of journal) {
      if (!entry || !entry.id) continue;
      const entryWeek = parsePositiveCycleFromFirestore(entry.week);
      const belongsToCycle = entryWeek !== null ? entryWeek === closingCycle : closingCycle === 1;
      if (!belongsToCycle) continue;

      if (entry.type === 'video') {
        const vid = (extractYouTubeIdInternal(entry.id || entry.url || '') || String(entry.id)).trim();
        if (vid) {
          watchedHistoryIds.add(vid);
          collectedVideos.push({
            id: vid,
            videoId: vid,
            videoTitle: entry.title || 'Daily Routine Video',
            title: entry.title || 'Daily Routine Video',
            watchedAt: (entry.timestamp ? new Date(entry.timestamp).toISOString() : entry.date) || nowIso,
            dayOfWeek: entry.dayOfWeek,
            url: entry.url || `https://www.youtube.com/watch?v=${vid}`,
          });
        }
      } else if (entry.type === 'audio') {
        const tid = (extractSpotifyTrackIdInternal(entry.id || entry.url || '') || String(entry.id)).trim();
        if (tid) {
          listenedHistoryIds.add(tid);
          collectedTracks.push({
            id: tid,
            trackId: tid,
            title: entry.title || 'Daily Track',
            artist: entry.artist || 'Spotify Artist',
            listenedAt: (entry.timestamp ? new Date(entry.timestamp).toISOString() : entry.date) || nowIso,
            dayOfWeek: entry.dayOfWeek,
            url: entry.url || '',
          });
        }
      }
    }

    // 2. Routine day snapshots (strictly preserving real completions — never inventing completions)
    for (const day of DEFAULT_STUDY_DAYS) {
      const r = dayRoutinesMap[day];
      if (!r) continue;

      const rawVid = r.videoId || (Array.isArray(r.teacherVideos) && r.teacherVideos[0]?.videoId) || (Array.isArray(r.teacherVideos) && r.teacherVideos[0]?.url) || r.url || '';
      const cleanVid = (extractYouTubeIdInternal(rawVid) || (typeof r.videoId === 'string' ? r.videoId : '')).trim();
      const videoCompleted = Boolean(r.completedVideoToday || r.completedToday || r.completed || checksMap[`video_day_${day}`]);

      const spot = r.teacherSpotify && typeof r.teacherSpotify === 'object' ? r.teacherSpotify : null;
      const spotRawId = spot ? (spot.trackId || spot.id || spot.url || spot.trackUrl || '') : '';
      const cleanTrackId = spotRawId ? (extractSpotifyTrackIdInternal(spotRawId) || String(spotRawId)).trim() : '';
      const audioCompleted = Boolean(r.completedAudioToday || checksMap[`audio_day_${day}`]);

      const dayWords: string[] = Array.isArray(r.learnedWords)
        ? r.learnedWords.map((w: any) => String(w || '').trim()).filter(Boolean)
        : [];

      if (cleanVid && (videoCompleted || watchedHistoryIds.has(cleanVid))) {
        watchedHistoryIds.add(cleanVid);
        collectedVideos.push({
          id: cleanVid,
          videoId: cleanVid,
          videoTitle: r.videoTitle || r.title || 'Daily Video Practice',
          title: r.title || r.videoTitle || 'Daily Video Practice',
          watchedAt: r.updatedAt || nowIso,
          dayOfWeek: day,
          url: r.url || `https://www.youtube.com/watch?v=${cleanVid}`,
        });
      }

      if (cleanTrackId && (audioCompleted || listenedHistoryIds.has(cleanTrackId))) {
        listenedHistoryIds.add(cleanTrackId);
        collectedTracks.push({
          id: cleanTrackId,
          trackId: cleanTrackId,
          title: spot?.title || spot?.trackTitle || 'Daily Track',
          artist: spot?.artistOrHost || spot?.artist || 'Spotify Artist',
          listenedAt: r.updatedAt || nowIso,
          dayOfWeek: day,
          url: spot?.url || spot?.trackUrl || '',
        });
      }

      dayWords.forEach((word) => {
        collectedVocab.push({
          word,
          definitionEn: '',
          translationPt: '',
          learnedAt: r.updatedAt || nowIso,
          sourceDay: day,
        });
        wordsToSaveToDictionary.push({
          id: `routine_${normalizeDictionaryWord(word).replace(/[^a-zA-Z0-9_-]/g, '_')}_c${closingCycle}`,
          word,
          originalWord: word,
          normalizedWord: normalizeDictionaryWord(word),
          learnedAt: r.updatedAt || nowIso,
          source: 'routine',
          sourceActivityName: `${r.playlistTitle || r.title || 'Daily Routine'} (${day})`,
          sourceDay: day,
          routineRef: { day, activityName: r.playlistTitle || r.title || 'Video of the Day', activityId: r.activityId || 'act-1' },
        });
      });

      if (cleanVid || cleanTrackId || dayWords.length > 0 || videoCompleted || audioCompleted) {
        activitiesSnapshot[day] = removeUndefinedFields({
          dayOfWeek: day,
          videoId: cleanVid || '',
          videoTitle: cleanVid ? (r.videoTitle || r.title || '') : '',
          playlistId: r.playlistId || '',
          playlistTitle: r.playlistTitle || '',
          videoCompleted,
          audioTrackId: cleanTrackId || '',
          audioTitle: cleanTrackId ? (spot?.title || spot?.trackTitle || '') : '',
          audioCompleted,
          learnedWords: dayWords,
        });
      }
    }

    // 3. Also check spotifyAssignments belonging to closingCycle ONLY if already completed/listened
    if (Array.isArray(aData.spotifyAssignments)) {
      for (const sa of aData.spotifyAssignments) {
        if (!sa || typeof sa !== 'object') continue;
        const saCycle = parsePositiveCycleFromFirestore(sa.weeklyCycle);
        if (saCycle !== null && saCycle !== closingCycle) continue;
        const tid = (extractSpotifyTrackIdInternal(sa.trackId || sa.id || sa.trackUrl || sa.url || '') || '').trim();
        const day = (sa.day || sa.dayOfWeek || '').toLowerCase().trim();
        if (tid && (listenedHistoryIds.has(tid) || (day && checksMap[`audio_day_${day}`]))) {
          listenedHistoryIds.add(tid);
          collectedTracks.push({
            id: tid,
            trackId: tid,
            title: sa.trackTitle || sa.title || 'Daily Track',
            artist: sa.artistOrHost || sa.artist || 'Spotify Artist',
            listenedAt: sa.listenedAt || nowIso,
            dayOfWeek: day || undefined,
            url: sa.trackUrl || sa.url || '',
          });
        }
      }
    }

    // 4. Preserve client-provided watched/listened exclusivity hints ONLY into exclusivity sets (not as fake completions in history)
    if (Array.isArray(params.clientWatchedVideos)) {
      params.clientWatchedVideos.forEach((raw) => {
        const clean = (extractYouTubeIdInternal(raw) || String(raw || '')).trim();
        if (clean) watchedHistoryIds.add(clean);
      });
    }
    if (Array.isArray(params.clientListenedTracks)) {
      params.clientListenedTracks.forEach((raw) => {
        const clean = (extractSpotifyTrackIdInternal(raw) || String(raw || '')).trim();
        if (clean) listenedHistoryIds.add(clean);
      });
    }

    // 5. Read-only Homework summary (NEVER deletes or modifies homework)
    const homeworkProgress = hwData
      ? removeUndefinedFields({
          hasHomework: true,
          isCompleted: Boolean(hwData.isCompleted),
          score: typeof hwData.score === 'number' ? hwData.score : undefined,
          totalWordsCollected:
            typeof hwData.totalWordsCollected === 'number'
              ? hwData.totalWordsCollected
              : Array.isArray(hwData.vocabularyList)
              ? hwData.vocabularyList.length
              : 0,
          completedPartsByDay: hwData.completedPartsByDay || {},
          submittedAt: hwData.submittedAt || null,
        })
      : null;

    const assignedTeacherUid = uData.assignedNativeFriendUID || uData.nativeFriendUID || uData.teacherUid || undefined;
    const resolvedEmail = (studentEmail || uData.email || '').toLowerCase().trim();

    const histRef = userRef.collection('weeklyHistory').doc(weekId);
    const closeTxResult = await withTimeout(
      db.runTransaction(async (tx) => {
        const [uTxSnap, hTxSnap] = await Promise.all([tx.get(userRef), tx.get(histRef)]);
        const existingTx = hTxSnap && hTxSnap.exists ? (hTxSnap.data() || {}) : null;
        if (existingTx?.closedAt) {
          return { ok: true, alreadyClosed: true, data: existingTx };
        }
        const txPersistedCycle = parsePositiveCycleFromFirestore(uTxSnap?.data()?.weeklyCycle) ?? 1;
        if (txPersistedCycle > closingCycle && existingTx) {
          return { ok: true, alreadyClosed: true, data: existingTx };
        }

        const mergedVideos = mergeConsumedVideos(
          Array.isArray(existingTx?.consumedVideoIds) ? existingTx.consumedVideoIds : [],
          collectedVideos
        );
        const mergedTracks = mergeConsumedTracks(
          Array.isArray(existingTx?.consumedTrackIds) ? existingTx.consumedTrackIds : [],
          collectedTracks
        );
        const mergedVocab = mergeWeeklyVocabularyItems(
          Array.isArray(existingTx?.weeklyVocabulary) ? existingTx.weeklyVocabulary : [],
          collectedVocab
        );

        const histPayload = removeUndefinedFields({
          ...(existingTx || {}),
          studentUid: uid,
          ...(resolvedEmail ? { studentEmail: resolvedEmail } : {}),
          ...(assignedTeacherUid ? { assignedNativeFriendUID: assignedTeacherUid, nativeFriendUID: assignedTeacherUid } : {}),
          weekId,
          weeklyCycle: closingCycle,
          consumedVideoIds: mergedVideos,
          consumedTrackIds: mergedTracks,
          weeklyVocabulary: mergedVocab,
          weeklyChecks: { ...(existingTx?.weeklyChecks || {}), ...checksMap },
          homeworkProgress,
          activitiesSnapshot: { ...(existingTx?.activitiesSnapshot || {}), ...activitiesSnapshot },
          weeklyStudyDaysTarget: checksCtx?.weeklyStudyDaysTarget || uData.weeklyStudyDaysTarget || 7,
          weeklyStudyDays: checksCtx?.weeklyStudyDays || uData.weeklyStudyDays || [...DEFAULT_STUDY_DAYS],
          closedAt: nowIso,
          closedForAttemptId: attemptId || existingTx?.closedForAttemptId || null,
          updatedAt: nowIso,
        });

        tx.set(histRef, histPayload, { merge: true });
        return { ok: true, alreadyClosed: false, data: histPayload };
      }),
      4500
    );

    if (!closeTxResult || !closeTxResult.ok) {
      return { ok: false, statusCode: 500, error: 'Failed to persist weeklyHistory snapshot.' };
    }
    if (closeTxResult.alreadyClosed) {
      return { ok: true, alreadyClosed: true, history: closeTxResult.data };
    }
    const saveRes = { ok: true, data: closeTxResult.data };

    // Preserve genuinely learned routine words in My Dictionary if present
    if (wordsToSaveToDictionary.length > 0) {
      try {
        await saveStudentVocabularyToFirestoreServer(uid, wordsToSaveToDictionary, resolvedEmail || undefined);
      } catch (vocabErr) {
        console.warn('[serverFirestore] Notice preserving routine vocabulary into dictionary during week close:', vocabErr);
      }
    }

    // Persist exclusivity history sets in users/{uid} & student_assignments/{uid}
    const existingUserWatched = Array.isArray(uData.watchedVideosHistory) ? [...uData.watchedVideosHistory] : [];
    const seenWatchedLower = new Set(
      existingUserWatched
        .map((item: any) => (typeof item === 'string' ? item : item?.videoId || item?.id || '').toLowerCase().trim())
        .filter(Boolean)
    );
    watchedHistoryIds.forEach((vid) => {
      if (!seenWatchedLower.has(vid.toLowerCase())) {
        seenWatchedLower.add(vid.toLowerCase());
        const meta = collectedVideos.find((v) => v.videoId.toLowerCase() === vid.toLowerCase());
        existingUserWatched.push({
          videoId: vid,
          videoTitle: meta?.videoTitle || 'Daily Video Practice',
          watchedAt: meta?.watchedAt || nowIso,
        });
      }
    });

    const existingUserListened = Array.isArray(uData.listenedTracksHistory) ? [...uData.listenedTracksHistory] : [];
    const seenListenedLower = new Set(
      existingUserListened
        .map((item: any) => (typeof item === 'string' ? item : item?.trackId || item?.id || '').toLowerCase().trim())
        .filter(Boolean)
    );
    listenedHistoryIds.forEach((tid) => {
      if (!seenListenedLower.has(tid.toLowerCase())) {
        seenListenedLower.add(tid.toLowerCase());
        const meta = collectedTracks.find((t) => t.trackId.toLowerCase() === tid.toLowerCase());
        existingUserListened.push({
          trackId: tid,
          id: tid,
          trackTitle: meta?.title || 'Daily Spotify Listening',
          title: meta?.title || 'Daily Spotify Listening',
          artist: meta?.artist || 'Spotify Artist',
          listenedAt: meta?.listenedAt || nowIso,
        });
      }
    });

    await Promise.all([
      withTimeout(
        userRef
          .set(
            {
              watchedVideosHistory: existingUserWatched,
              listenedTracksHistory: existingUserListened,
              updatedAt: nowIso,
            },
            { merge: true }
          )
          .then(() => true),
        4500
      ),
      saveStudentAssignmentsCanonicalServer(uid, {
        watchedVideos: Array.from(watchedHistoryIds),
        listenedTracks: Array.from(listenedHistoryIds),
      }),
    ]);

    return { ok: true, history: saveRes.data };
  } catch (err: any) {
    if (isPermissionError(err)) {
      setIsCloudWriteDisabled(true);
    }
    console.warn('[serverFirestore] closeWeeklyHistorySnapshotServer error:', err);
    return { ok: false, statusCode: 500, error: err?.message || 'Failed to close weekly history snapshot.' };
  }
}

/**
 * HOTFIX 2.3.5E / ARCH.2E.2D: Atomically validates and commits weeklyCycle advance in Firestore using runTransaction.
 * Guarantees cross-instance protection against duplicate or concurrent cycle increments,
 * marks cycleTransition as 'pending_preparation' for crash/partial-failure recovery,
 * and never returns fake success when Firestore is unavailable or errors.
 */
export async function advanceWeeklyCycleTransactionServer(
  studentUid: string,
  expectedCycle: number | undefined,
  attemptId: string | undefined,
  _requestedNewCycle?: number,
  metadata?: {
    weeklyStudyDaysTarget?: number;
    weeklyStudyDays?: string[];
  }
): Promise<{
  success: boolean;
  persistedCycle: number;
  previousCycle?: number;
  isIdempotentReplay?: boolean;
  conflict?: boolean;
  cycleTransition?: CycleTransitionRecord | null;
  lastCycleResult?: any;
  error?: string;
  statusCode?: number;
}> {
  const db = getFirestoreDb();
  if (!db || !studentUid) {
    return {
      success: false,
      persistedCycle: expectedCycle ?? 1,
      error: 'Canonical Firestore database unavailable.',
      statusCode: 503,
    };
  }
  if (getIsCloudWriteDisabled()) {
    return {
      success: false,
      persistedCycle: expectedCycle ?? 1,
      error: 'Firestore writes disabled by IAM.',
      statusCode: 500,
    };
  }

  try {
    const userRef = db.collection('users').doc(studentUid);
    const result = await db.runTransaction(async (transaction) => {
      const userSnap = await transaction.get(userRef);
      const fsData = (userSnap && userSnap.exists ? userSnap.data() : null) || {};
      const persistedCycle = parsePositiveCycleFromFirestore(fsData.weeklyCycle) ?? 1;

      // 1. Idempotency check FIRST (before cycle conflict check on expectedCycle that became old due to this advance)
      if (
        attemptId &&
        (fsData.lastCycleAttemptId === attemptId || fsData.cycleTransition?.attemptId === attemptId)
      ) {
        const recordedPrevCycle = parsePositiveCycleFromFirestore(fsData.cycleTransition?.previousCycle);
        if (expectedCycle !== undefined && recordedPrevCycle !== null && expectedCycle !== recordedPrevCycle) {
          throw new CycleConflictError(
            persistedCycle,
            expectedCycle,
            `Attempt ${attemptId} was already committed for cycle ${recordedPrevCycle} -> ${persistedCycle}.`
          );
        }
        return {
          success: true,
          persistedCycle,
          previousCycle: recordedPrevCycle ?? Math.max(1, persistedCycle - 1),
          isIdempotentReplay: true,
          cycleTransition: fsData.cycleTransition || null,
          lastCycleResult: fsData.lastCycleResult || null,
        };
      }

      // 2. Conflict check: if expectedCycle is provided and differs from persistedCycle
      if (expectedCycle !== undefined && persistedCycle !== expectedCycle) {
        throw new CycleConflictError(persistedCycle, expectedCycle);
      }

      // 3. Always compute targetCycle from persistedCycle (client weeklyCycle is never authoritative)
      const targetCycle = persistedCycle + 1;
      const nowIso = new Date().toISOString();
      const prevEpoch =
        typeof fsData.cycleTransition?.fencingEpoch === 'number' && Number.isFinite(fsData.cycleTransition.fencingEpoch)
          ? fsData.cycleTransition.fencingEpoch
          : 0;
      const transition: CycleTransitionRecord = {
        attemptId: attemptId || null,
        previousCycle: persistedCycle,
        targetCycle,
        status: 'pending_preparation',
        startedAt: nowIso,
        lastError: null,
        steps: {
          routinesReset: false,
          routinesResetDays: [],
          weeklyChecksInitialized: false,
          assignmentsCleared: false,
          weeklyHistoryInitialized: false,
        },
        lease: null,
        fencingEpoch: prevEpoch,
      };

      transaction.set(
        userRef,
        {
          weeklyCycle: targetCycle,
          lastCycleAttemptId: attemptId || null,
          weeklyStudyDaysTarget: metadata?.weeklyStudyDaysTarget || fsData.weeklyStudyDaysTarget || 7,
          weeklyStudyDays:
            metadata?.weeklyStudyDays && metadata.weeklyStudyDays.length > 0
              ? metadata.weeklyStudyDays
              : Array.isArray(fsData.weeklyStudyDays) && fsData.weeklyStudyDays.length > 0
              ? fsData.weeklyStudyDays
              : [...DEFAULT_STUDY_DAYS],
          awaitingTopicSelection: true,
          cycleTransition: transition,
          updatedAt: nowIso,
        },
        { merge: true }
      );

      return {
        success: true,
        persistedCycle: targetCycle,
        previousCycle: persistedCycle,
        isIdempotentReplay: false,
        cycleTransition: transition,
      };
    });

    return result;
  } catch (err: any) {
    if (err instanceof CycleConflictError) {
      return { success: false, conflict: true, persistedCycle: err.actualCycle, statusCode: 409 };
    }
    if (isPermissionError(err)) {
      setIsCloudWriteDisabled(true);
    }
    console.warn('[serverFirestore] advanceWeeklyCycleTransactionServer error:', err);
    return {
      success: false,
      persistedCycle: expectedCycle ?? 1,
      error: err?.message || 'Weekly cycle transaction failed.',
      statusCode: 500,
    };
  }
}

function assertPreparationFencing(
  uData: Record<string, any>,
  expectedTargetCycle: number,
  expectedOwnerId: string,
  expectedFencingToken: number,
  expectedAttemptId?: string
): CycleTransitionRecord {
  const persistedCycle = parsePositiveCycleFromFirestore(uData?.weeklyCycle) ?? 1;
  if (persistedCycle !== expectedTargetCycle) {
    throw new PreparationFencingError(
      'STALE_RECOVERY_CYCLE',
      `Fencing rejected preparation: persisted cycle ${persistedCycle} !== targetCycle ${expectedTargetCycle}.`,
      409
    );
  }
  const tr = uData?.cycleTransition as CycleTransitionRecord | undefined;
  if (!tr || tr.targetCycle !== expectedTargetCycle || tr.status !== 'pending_preparation') {
    throw new PreparationFencingError(
      'TRANSITION_NOT_PENDING',
      `Fencing rejected preparation: cycleTransition status is ${tr?.status || 'missing'}.`,
      409
    );
  }
  if (expectedAttemptId && tr.attemptId && tr.attemptId !== expectedAttemptId) {
    throw new PreparationFencingError(
      'ATTEMPT_MISMATCH',
      `Fencing rejected preparation: attemptId mismatch.`,
      409
    );
  }
  if (!tr.lease || tr.lease.ownerId !== expectedOwnerId || tr.lease.fencingToken !== expectedFencingToken) {
    throw new PreparationFencingError(
      'LEASE_LOST_FENCED',
      `Fencing rejected preparation: lease ownership lost (active owner=${tr.lease?.ownerId || 'none'}, token=${tr.lease?.fencingToken ?? 'none'}).`,
      409
    );
  }
  return tr;
}

/**
 * ARCH.2E.2D / ARCH.2E.2D.2: Non-destructive, fenced, and durably step-tracked post-transaction
 * preparation for the new weekly cycle.
 * - Acquires a Firestore-persisted lease with monotonic fencingToken on users/{uid}.cycleTransition.
 * - Validates fencing ownership inside every step's Firestore transaction.
 * - Skips already-completed steps and never overwrites valid data already persisted for targetCycle.
 * - Marks cycleTransition.status = 'completed' ONLY after all 4 steps are durably confirmed.
 */
export async function prepareNewWeeklyCycleServer(params: {
  uid: string;
  studentEmail?: string;
  targetCycle: number;
  previousCycle?: number;
  attemptId?: string;
  weeklyStudyDaysTarget?: number;
  weeklyStudyDays?: string[];
  level?: string;
  routineVideoTime?: string;
  leaseTtlMs?: number;
}): Promise<{
  ok: boolean;
  result?: any;
  alreadyPrepared?: boolean;
  inProgress?: boolean;
  code?: string;
  error?: string;
  statusCode?: number;
}> {
  if (getIsCloudWriteDisabled()) {
    return { ok: false, statusCode: 500, error: 'Firestore writes disabled by IAM.' };
  }
  const db = getFirestoreDb();
  if (!db || !params.uid) {
    return { ok: false, statusCode: 503, error: 'Canonical Firestore database unavailable.' };
  }

  const { uid, targetCycle, attemptId } = params;
  const userRef = db.collection('users').doc(uid);
  const effectiveLeaseTtlMs =
    typeof params.leaseTtlMs === 'number' && Number.isFinite(params.leaseTtlMs) && params.leaseTtlMs >= 20
      ? params.leaseTtlMs
      : 15000;
  const executionOwnerId = `prep_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  let acquiredFencingToken: number | null = null;

  try {
    // 0. Acquire distributed Firestore lease + monotonic fencing token via transaction
    const leaseAcquireRes = await withTimeout(
      db.runTransaction(async (tx) => {
        const uSnap = await tx.get(userRef);
        if (!uSnap || !uSnap.exists) {
          return { action: 'user_not_found' as const };
        }
        const uData = uSnap.data() || {};
        const persistedCycle = parsePositiveCycleFromFirestore(uData.weeklyCycle) ?? 1;

        if (persistedCycle > targetCycle) {
          return { action: 'stale_cycle' as const, persistedCycle };
        }
        if (persistedCycle < targetCycle) {
          return { action: 'cycle_not_advanced' as const, persistedCycle };
        }

        const tr = uData.cycleTransition as CycleTransitionRecord | undefined;
        if (!tr || tr.targetCycle !== targetCycle) {
          return { action: 'invalid_transition' as const };
        }
        if (attemptId && tr.attemptId && tr.attemptId !== attemptId) {
          return { action: 'attempt_mismatch' as const };
        }
        if (tr.status === 'completed') {
          return {
            action: 'already_completed' as const,
            result: uData.lastCycleResult || null,
            uData,
          };
        }
        if (tr.status !== 'pending_preparation') {
          return { action: 'invalid_transition' as const };
        }

        const nowMs = Date.now();
        const nowIso = new Date(nowMs).toISOString();
        const existingLease = tr.lease;
        if (existingLease && existingLease.ownerId && existingLease.ownerId !== executionOwnerId) {
          const expiresMs = Date.parse(existingLease.expiresAt);
          if (!Number.isNaN(expiresMs) && expiresMs > nowMs) {
            return {
              action: 'in_progress' as const,
              ownerId: existingLease.ownerId,
              expiresAt: existingLease.expiresAt,
            };
          }
        }

        const nextToken =
          (typeof tr.fencingEpoch === 'number' && Number.isFinite(tr.fencingEpoch) ? tr.fencingEpoch : 0) + 1;
        const newLease: CyclePreparationLease = {
          ownerId: executionOwnerId,
          fencingToken: nextToken,
          attemptId: attemptId || tr.attemptId || null,
          targetCycle,
          acquiredAt: nowIso,
          expiresAt: new Date(nowMs + effectiveLeaseTtlMs).toISOString(),
          heartbeatAt: nowIso,
        };

        const nextTransition: CycleTransitionRecord = {
          ...tr,
          steps: {
            routinesReset: Boolean(tr.steps?.routinesReset),
            routinesResetDays: Array.isArray(tr.steps?.routinesResetDays) ? [...tr.steps!.routinesResetDays!] : [],
            weeklyChecksInitialized: Boolean(tr.steps?.weeklyChecksInitialized),
            assignmentsCleared: Boolean(tr.steps?.assignmentsCleared),
            weeklyHistoryInitialized: Boolean(tr.steps?.weeklyHistoryInitialized),
          },
          fencingEpoch: nextToken,
          lease: newLease,
        };

        tx.set(
          userRef,
          removeUndefinedFields({
            cycleTransition: nextTransition,
            updatedAt: nowIso,
          }),
          { merge: true }
        );

        return {
          action: 'acquired' as const,
          fencingToken: nextToken,
          transition: nextTransition,
          uData,
        };
      }),
      4500
    );

    if (!leaseAcquireRes) {
      return { ok: false, statusCode: 500, error: 'Failed to acquire preparation lease in Firestore.' };
    }
    if (leaseAcquireRes.action === 'already_completed') {
      if (leaseAcquireRes.result) {
        return { ok: true, alreadyPrepared: true, result: leaseAcquireRes.result };
      }
      return {
        ok: true,
        alreadyPrepared: true,
        result: {
          success: true,
          weeklyCycle: targetCycle,
          previousCycle: params.previousCycle ?? Math.max(1, targetCycle - 1),
          message: 'New weekly cycle activated successfully',
          ...(attemptId ? { attemptId } : {}),
        },
      };
    }
    if (leaseAcquireRes.action === 'in_progress') {
      return {
        ok: false,
        inProgress: true,
        statusCode: 409,
        code: 'PREPARATION_IN_PROGRESS',
        error: 'New week preparation is already in progress on another worker.',
      };
    }
    if (leaseAcquireRes.action === 'stale_cycle') {
      return {
        ok: false,
        statusCode: 409,
        code: 'STALE_RECOVERY_CYCLE',
        error: `Stale recovery rejected: persisted cycle ${leaseAcquireRes.persistedCycle} is newer than targetCycle ${targetCycle}.`,
      };
    }
    if (leaseAcquireRes.action !== 'acquired') {
      return {
        ok: false,
        statusCode: 409,
        code: 'INVALID_PREPARATION_STATE',
        error: `Preparation cannot proceed (${leaseAcquireRes.action}).`,
      };
    }

    acquiredFencingToken = leaseAcquireRes.fencingToken;
    const fencingToken = leaseAcquireRes.fencingToken;
    const initialUData = leaseAcquireRes.uData;
    const initialSteps = leaseAcquireRes.transition.steps || {};

    const assignSnapPre = await withTimeout(db.collection('student_assignments').doc(uid).get(), 4500).catch(() => null);
    const aDataPre = assignSnapPre && assignSnapPre.exists ? (assignSnapPre.data() || {}) : {};

    const effectiveStudyTarget =
      params.weeklyStudyDaysTarget ||
      (typeof initialUData.weeklyStudyDaysTarget === 'number' &&
      initialUData.weeklyStudyDaysTarget >= 1 &&
      initialUData.weeklyStudyDaysTarget <= 7
        ? initialUData.weeklyStudyDaysTarget
        : 7);
    const effectiveStudyDays =
      params.weeklyStudyDays && params.weeklyStudyDays.length > 0
        ? params.weeklyStudyDays
        : Array.isArray(initialUData.weeklyStudyDays) && initialUData.weeklyStudyDays.length > 0
        ? initialUData.weeklyStudyDays
        : [...DEFAULT_STUDY_DAYS];
    const resolvedEmail = (params.studentEmail || initialUData.email || aDataPre.email || '').toLowerCase().trim();
    const resolvedLevel = (
      params.level ||
      initialUData.englishLevel ||
      initialUData.level ||
      aDataPre.level ||
      'intermediate'
    ).toString();
    const videoTime = params.routineVideoTime || initialUData.routineVideoTime;
    const newWeekId = `week-${targetCycle}`;

    const makeRenewedLease = (existingLease?: CyclePreparationLease | null): CyclePreparationLease => {
      const nowMs = Date.now();
      const nowIso = new Date(nowMs).toISOString();
      return {
        ownerId: executionOwnerId,
        fencingToken,
        attemptId: attemptId || existingLease?.attemptId || null,
        targetCycle,
        acquiredAt: existingLease?.acquiredAt || nowIso,
        expiresAt: new Date(nowMs + effectiveLeaseTtlMs).toISOString(),
        heartbeatAt: nowIso,
      };
    };

    // 1. Non-destructive daily routines reset per day (fenced transaction per un-migrated day)
    if (!initialSteps.routinesReset) {
      const routinesCol = userRef.collection('routines');
      const alreadyDoneDays = new Set<string>(
        Array.isArray(initialSteps.routinesResetDays) ? initialSteps.routinesResetDays : []
      );

      for (const day of DEFAULT_STUDY_DAYS) {
        if (alreadyDoneDays.has(day)) continue;

        const dayRef = routinesCol.doc(day);
        const dayOk = await withTimeout(
          db.runTransaction(async (tx) => {
            const [uTxSnap, dTxSnap] = await Promise.all([tx.get(userRef), tx.get(dayRef)]);
            const uTxData = (uTxSnap && uTxSnap.exists ? uTxSnap.data() : null) || {};
            const tr = assertPreparationFencing(uTxData, targetCycle, executionOwnerId, fencingToken, attemptId);

            const currentDaysSet = new Set<string>(
              Array.isArray(tr.steps?.routinesResetDays) ? tr.steps!.routinesResetDays! : []
            );
            if (tr.steps?.routinesReset || currentDaysSet.has(day)) {
              return true;
            }

            const nowIso = new Date().toISOString();
            const dData = dTxSnap && dTxSnap.exists ? (dTxSnap.data() || {}) : null;
            const dCycle = parsePositiveCycleFromFirestore(dData?.weeklyCycle);
            const rootDay = uTxData.routinesByDay?.[day] && typeof uTxData.routinesByDay[day] === 'object'
              ? uTxData.routinesByDay[day]
              : null;
            const rootDayCycle = parsePositiveCycleFromFirestore(rootDay?.weeklyCycle);

            // Preserve any day already belonging to targetCycle (e.g., partial resume or user already saved new cycle video/audio/words)
            const dayAlreadyAtTarget = dCycle === targetCycle;
            let rootDayUpdate: Record<string, any> | undefined;

            if (!dayAlreadyAtTarget) {
              const resetPayload = {
                videoId: '',
                title: '',
                videoTitle: '',
                url: '',
                playlistId: '',
                playlistTitle: '',
                isRepeatVideo: false,
                isCustomSuggestion: false,
                teacherVideos: [],
                teacherSpotify: null,
                teacherOverrideTrack: null,
                teacherFeedback: null,
                teacherNotes: '',
                dayOfWeek: day,
                activityId: 'act-1',
                instructions: '',
                duration: '',
                completed: false,
                completedToday: false,
                completedVideoToday: false,
                completedAudioToday: false,
                learnedWords: [],
                weeklyCycle: targetCycle,
                updatedAt: nowIso,
              };
              tx.set(dayRef, resetPayload, { merge: false });
              rootDayUpdate = resetPayload;
            } else if (rootDayCycle !== targetCycle && dData) {
              rootDayUpdate = dData;
            }

            currentDaysSet.add(day);
            const updatedDays = DEFAULT_STUDY_DAYS.filter((d) => currentDaysSet.has(d));
            const allDaysDone = updatedDays.length === DEFAULT_STUDY_DAYS.length;

            const userPatch: Record<string, any> = {
              cycleTransition: {
                ...tr,
                steps: {
                  ...(tr.steps || {}),
                  routinesResetDays: updatedDays,
                  routinesReset: allDaysDone,
                },
                lease: makeRenewedLease(tr.lease),
              },
              updatedAt: nowIso,
            };
            if (rootDayUpdate) {
              userPatch.routinesByDay = { [day]: rootDayUpdate };
            }
            tx.set(userRef, removeUndefinedFields(userPatch), { merge: true });
            return true;
          }),
          4500
        );
        if (!dayOk) {
          throw new Error(`Timed out resetting daily routine for ${day}.`);
        }
      }
    }

    // 2. Non-destructive S-Path weeklyChecks initialization for week-{targetCycle} (never overwrite existing checks with {})
    if (!initialSteps.weeklyChecksInitialized) {
      const weekRef = userRef.collection('weeklyChecks').doc(newWeekId);
      const checksOk = await withTimeout(
        db.runTransaction(async (tx) => {
          const [uTxSnap, wTxSnap] = await Promise.all([tx.get(userRef), tx.get(weekRef)]);
          const uTxData = (uTxSnap && uTxSnap.exists ? uTxSnap.data() : null) || {};
          const tr = assertPreparationFencing(uTxData, targetCycle, executionOwnerId, fencingToken, attemptId);

          if (tr.steps?.weeklyChecksInitialized) {
            return true;
          }

          const nowIso = new Date().toISOString();
          const wData = wTxSnap && wTxSnap.exists ? (wTxSnap.data() || {}) : null;
          const preservedChecks: Record<string, boolean> = wData
            ? {
                ...(wData.weeklyChecks || {}),
                ...(wData.sPathChecks || {}),
                ...(wData.checks || {}),
              }
            : {};

          const weekDocPayload = removeUndefinedFields({
            id: newWeekId,
            weekId: newWeekId,
            weeklyCycle: targetCycle,
            checks: preservedChecks,
            studentUid: uid,
            ...(resolvedEmail ? { studentEmail: resolvedEmail } : {}),
            updatedAt: nowIso,
          });

          // Write target check doc first so mock failure never marks userRef step complete
          tx.set(weekRef, weekDocPayload, { merge: true });
          tx.set(
            userRef,
            removeUndefinedFields({
              weeklyStudyDaysTarget: effectiveStudyTarget,
              weeklyStudyDays: effectiveStudyDays,
              cycleTransition: {
                ...tr,
                steps: {
                  ...(tr.steps || {}),
                  weeklyChecksInitialized: true,
                },
                lease: makeRenewedLease(tr.lease),
              },
              updatedAt: nowIso,
            }),
            { merge: true }
          );
          return true;
        }),
        4500
      );
      if (!checksOk) {
        throw new Error(`Timed out initializing weeklyChecks/${newWeekId}.`);
      }
    }

    // 3. Non-destructive student_assignments/{uid} cleanup: remove ONLY older-cycle assignments, preserve targetCycle & history
    const cleanRoutines = createCleanStudentRoutines(videoTime);
    if (!initialSteps.assignmentsCleared) {
      const assignRef = db.collection('student_assignments').doc(uid);
      const assignOk = await withTimeout(
        db.runTransaction(async (tx) => {
          const [uTxSnap, aTxSnap] = await Promise.all([tx.get(userRef), tx.get(assignRef)]);
          const uTxData = (uTxSnap && uTxSnap.exists ? uTxSnap.data() : null) || {};
          const tr = assertPreparationFencing(uTxData, targetCycle, executionOwnerId, fencingToken, attemptId);

          if (tr.steps?.assignmentsCleared) {
            return true;
          }

          const nowIso = new Date().toISOString();
          const aData = aTxSnap && aTxSnap.exists ? (aTxSnap.data() || {}) : {};

          const keptVideoAssignments = (Array.isArray(aData.videoAssignments) ? aData.videoAssignments : []).filter(
            (item: any) => parsePositiveCycleFromFirestore(item?.weeklyCycle) === targetCycle
          );
          const keptSpotifyAssignments = (Array.isArray(aData.spotifyAssignments) ? aData.spotifyAssignments : []).filter(
            (item: any) => parsePositiveCycleFromFirestore(item?.weeklyCycle) === targetCycle
          );

          const hasTargetVideo = keptVideoAssignments.some((a: any) => Boolean(a.videoId || a.videoUrl));
          const mergedRoutines: Record<string, any> = {};
          const aDataCycle = parsePositiveCycleFromFirestore(aData.weeklyCycle);
          for (const day of DEFAULT_STUDY_DAYS) {
            const hasDayTargetAssign =
              keptVideoAssignments.some((a: any) => (a.day || a.dayOfWeek) === day) ||
              keptSpotifyAssignments.some((s: any) => (s.day || s.dayOfWeek) === day);
            const existingRoutineDayCycle = parsePositiveCycleFromFirestore(aData.routines?.[day]?.weeklyCycle);
            if (
              aData.routines?.[day] &&
              (existingRoutineDayCycle === targetCycle || (hasDayTargetAssign && aDataCycle === targetCycle))
            ) {
              mergedRoutines[day] = aData.routines[day];
            } else {
              mergedRoutines[day] = (cleanRoutines as any)[day];
            }
          }

          const assignPayload = removeUndefinedFields({
            uid,
            ...(resolvedEmail ? { email: resolvedEmail } : {}),
            level: resolvedLevel,
            weeklyCycle: targetCycle,
            weeklyStudyDaysTarget: effectiveStudyTarget,
            weeklyStudyDays: effectiveStudyDays,
            videoAssignments: keptVideoAssignments,
            spotifyAssignments: keptSpotifyAssignments,
            awaitingTopicSelection: !hasTargetVideo,
            routines: mergedRoutines,
            watchedVideos: Array.isArray(aData.watchedVideos) ? aData.watchedVideos : [],
            listenedTracks: Array.isArray(aData.listenedTracks) ? aData.listenedTracks : [],
            ...(aData.spotifyCycles ? { spotifyCycles: aData.spotifyCycles } : {}),
            updatedAt: nowIso,
          });

          tx.set(assignRef, assignPayload, { merge: true });
          tx.set(
            userRef,
            removeUndefinedFields({
              awaitingTopicSelection: !hasTargetVideo,
              cycleTransition: {
                ...tr,
                steps: {
                  ...(tr.steps || {}),
                  assignmentsCleared: true,
                },
                lease: makeRenewedLease(tr.lease),
              },
              updatedAt: nowIso,
            }),
            { merge: true }
          );
          return true;
        }),
        4500
      );
      if (!assignOk) {
        throw new Error('Timed out updating student_assignments for new cycle.');
      }
    }

    // 4. Non-destructive weeklyHistory/week-{targetCycle} creation (create only if missing)
    if (!initialSteps.weeklyHistoryInitialized) {
      const histRef = userRef.collection('weeklyHistory').doc(newWeekId);
      const histOk = await withTimeout(
        db.runTransaction(async (tx) => {
          const [uTxSnap, hTxSnap] = await Promise.all([tx.get(userRef), tx.get(histRef)]);
          const uTxData = (uTxSnap && uTxSnap.exists ? uTxSnap.data() : null) || {};
          const tr = assertPreparationFencing(uTxData, targetCycle, executionOwnerId, fencingToken, attemptId);

          if (tr.steps?.weeklyHistoryInitialized) {
            return true;
          }

          const nowIso = new Date().toISOString();
          if (!hTxSnap || !hTxSnap.exists) {
            tx.set(
              histRef,
              removeUndefinedFields({
                studentUid: uid,
                ...(resolvedEmail ? { studentEmail: resolvedEmail } : {}),
                weekId: newWeekId,
                weeklyCycle: targetCycle,
                consumedVideoIds: [],
                consumedTrackIds: [],
                weeklyVocabulary: [],
                weeklyStudyDaysTarget: effectiveStudyTarget,
                weeklyStudyDays: effectiveStudyDays,
                updatedAt: nowIso,
              }),
              { merge: true }
            );
          }

          tx.set(
            userRef,
            removeUndefinedFields({
              cycleTransition: {
                ...tr,
                steps: {
                  ...(tr.steps || {}),
                  weeklyHistoryInitialized: true,
                },
                lease: makeRenewedLease(tr.lease),
              },
              updatedAt: nowIso,
            }),
            { merge: true }
          );
          return true;
        }),
        4500
      );
      if (!histOk) {
        throw new Error(`Timed out initializing weeklyHistory/${newWeekId}.`);
      }
    }

    // 5. Finalize cycleTransition.status = 'completed' ONLY after confirming all 4 steps inside fenced transaction
    const assignRefFinal = db.collection('student_assignments').doc(uid);
    const finalizedResult = await withTimeout(
      db.runTransaction(async (tx) => {
        const [uTxSnap, aTxSnap] = await Promise.all([tx.get(userRef), tx.get(assignRefFinal)]);
        const uTxData = (uTxSnap && uTxSnap.exists ? uTxSnap.data() : null) || {};
        const tr = assertPreparationFencing(uTxData, targetCycle, executionOwnerId, fencingToken, attemptId);

        const steps = tr.steps || {};
        if (
          !steps.routinesReset ||
          !steps.weeklyChecksInitialized ||
          !steps.assignmentsCleared ||
          !steps.weeklyHistoryInitialized
        ) {
          throw new Error('Cannot mark cycleTransition completed before all preparation steps are confirmed.');
        }

        const nowIso = new Date().toISOString();
        const aDataFinal = aTxSnap && aTxSnap.exists ? (aTxSnap.data() || {}) : {};
        const finalVideoAssignments = (Array.isArray(aDataFinal.videoAssignments) ? aDataFinal.videoAssignments : []).filter(
          (item: any) => parsePositiveCycleFromFirestore(item?.weeklyCycle) === targetCycle
        );
        const finalSpotifyAssignments = (Array.isArray(aDataFinal.spotifyAssignments) ? aDataFinal.spotifyAssignments : []).filter(
          (item: any) => parsePositiveCycleFromFirestore(item?.weeklyCycle) === targetCycle
        );

        const confirmedResult = removeUndefinedFields({
          success: true,
          weeklyCycle: targetCycle,
          previousCycle: params.previousCycle ?? tr.previousCycle ?? Math.max(1, targetCycle - 1),
          weeklyStudyDaysTarget: effectiveStudyTarget,
          weeklyStudyDays: effectiveStudyDays,
          message: 'New weekly cycle activated successfully',
          routines: cleanRoutines,
          videoAssignments: finalVideoAssignments,
          spotifyAssignments: finalSpotifyAssignments,
          ...(attemptId ? { attemptId } : {}),
        });

        const completedTransition: CycleTransitionRecord = {
          attemptId: attemptId || tr.attemptId || null,
          previousCycle: params.previousCycle ?? tr.previousCycle ?? Math.max(1, targetCycle - 1),
          targetCycle,
          status: 'completed',
          startedAt: tr.startedAt || nowIso,
          completedAt: nowIso,
          lastError: null,
          steps,
          lease: null,
          fencingEpoch: tr.fencingEpoch,
        };

        tx.set(
          userRef,
          removeUndefinedFields({
            weeklyCycle: targetCycle,
            weeklyStudyDaysTarget: effectiveStudyTarget,
            weeklyStudyDays: effectiveStudyDays,
            awaitingTopicSelection: !finalVideoAssignments.some((a: any) => Boolean(a.videoId || a.videoUrl)),
            lastCycleAttemptId: attemptId || uTxData.lastCycleAttemptId || null,
            lastCycleResult: confirmedResult,
            cycleTransition: completedTransition,
            updatedAt: nowIso,
          }),
          { merge: true }
        );

        return confirmedResult;
      }),
      4500
    );

    if (!finalizedResult) {
      return { ok: false, statusCode: 500, error: 'Failed to finalize cycleTransition status in Firestore.' };
    }

    return { ok: true, result: finalizedResult };
  } catch (err: any) {
    if (err instanceof PreparationFencingError) {
      console.warn('[serverFirestore] prepareNewWeeklyCycleServer fenced:', err.message);
      return { ok: false, statusCode: err.statusCode, code: err.code, error: err.message };
    }
    if (isPermissionError(err)) {
      setIsCloudWriteDisabled(true);
    }

    // Best-effort lease release ONLY if we still hold the fencingToken, preserving pending_preparation
    if (acquiredFencingToken !== null) {
      const tokenToRelease = acquiredFencingToken;
      await withTimeout(
        db
          .runTransaction(async (tx) => {
            const uSnap = await tx.get(userRef);
            if (!uSnap || !uSnap.exists) return;
            const uData = uSnap.data() || {};
            const tr = uData.cycleTransition as CycleTransitionRecord | undefined;
            if (
              tr &&
              tr.targetCycle === targetCycle &&
              tr.status === 'pending_preparation' &&
              tr.lease?.ownerId === executionOwnerId &&
              tr.lease?.fencingToken === tokenToRelease
            ) {
              tx.set(
                userRef,
                {
                  cycleTransition: {
                    ...tr,
                    lease: null,
                    lastError: err?.message || 'Preparation failed',
                  },
                  updatedAt: new Date().toISOString(),
                },
                { merge: true }
              );
            }
          })
          .catch(() => {}),
        2000
      ).catch(() => {});
    }

    console.warn('[serverFirestore] prepareNewWeeklyCycleServer error:', err);
    return { ok: false, statusCode: 500, error: err?.message || 'Failed to prepare new weekly cycle.' };
  }
}


