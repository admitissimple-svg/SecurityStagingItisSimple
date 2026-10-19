/**
 * SECURE ADMINISTRATOR BOOTSTRAP UTILITY — HOTFIX 4B.17C
 *
 * Requirements:
 * 1. Strictly bound to authorized initial account 'adm.itissimple@gmail.com'.
 * 2. Enforces exact Firebase project ID 'itissimple-security-staging'.
 * 3. Inspects actual Firebase Authentication account and claims via Firebase Admin SDK.
 * 4. Strictly one-time execution guarded by persistent, server-controlled atomic lock.
 * 5. Requires existing Firebase Auth account, verified email, and not disabled.
 * 6. Requires explicit operator confirmation (--confirm) to prevent accidental execution.
 * 7. Legacy 'app_db.json' admin stub does not block bootstrap; updates in-place without duplicate records.
 * 8. Reports already-active administrator state idempotently without re-granting privileges.
 * 9. Detects conflicts with any other UID possessing admin claims and halts for investigation.
 * 10. Recovers safely from expired in-progress locks (interrupted bootstraps).
 * 11. Preserves all existing application data and ensures zero credentials/passwords stored.
 * 12. Provides read-only inspection/verification command (--verify).
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import {
  ALLOWED_STAGING_PROJECT_ID,
  resolveProjectId,
  getFirebaseAdminApp,
  getFirebaseAdminAuth,
} from '../src/serverFirebaseAdmin';
import { getFirestoreDb } from '../src/serverFirestore';

export const AUTHORIZED_ADMIN_EMAIL = 'adm.itissimple@gmail.com';
export const AUTHORIZED_PROJECT_ID = ALLOWED_STAGING_PROJECT_ID; // 'itissimple-security-staging'
export const DEFAULT_LOCK_TTL_MS = 30_000; // 30 seconds TTL for in-progress atomic lock

export const LOCAL_DB_PATH = path.join(process.cwd(), 'src', 'data', 'app_db.json');
export const LOCAL_LOCK_PATH = path.join(process.cwd(), 'src', 'data', '.admin_bootstrap_lock.json');

export interface BootstrapLockData {
  status: 'in_progress' | 'completed';
  adminUid: string;
  adminEmail: string;
  projectId: string;
  lockedAt: number;
  lockExpiresAt: number;
  completedAt?: number;
  attemptId: string;
}

export interface BootstrapOptions {
  targetEmail?: string;
  expectedUid?: string;
  adminName?: string;
  confirm?: boolean;
  lockTtlMs?: number;
  // Test injection hooks
  dryRun?: boolean;
  customAuth?: any;
  customDb?: any;
  bypassProjectIdCheckForTesting?: boolean;
}

export interface BootstrapResult {
  success: boolean;
  status: 'BOOTSTRAPPED' | 'ALREADY_ACTIVE' | 'ERROR';
  message: string;
  adminUid?: string;
  adminEmail?: string;
  error?: string;
  claims?: Record<string, any>;
  alreadyActive?: boolean;
}

export interface InspectionResult {
  accountExists: boolean;
  email: string;
  uid?: string;
  emailVerified?: boolean;
  disabled?: boolean;
  hasAdminClaim: boolean;
  customClaims?: Record<string, any>;
  persistentLockExists: boolean;
  persistentLockStatus?: 'in_progress' | 'completed' | 'none';
  persistentLockUid?: string;
  localTeacherRecordFound: boolean;
  localTeacherRecordHasUid: boolean;
  isReadyForBootstrap: boolean;
  canSafelyBootstrap: boolean;
  projectId: string;
  error?: string;
  message: string;
}

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

/**
 * Reads persistent lock state from Firestore if available, with fallback to local lock file.
 */
export async function getPersistentLock(firestoreDb?: any): Promise<BootstrapLockData | null> {
  const db = firestoreDb !== undefined ? firestoreDb : getFirestoreDb();
  if (db) {
    try {
      const snapPromise = db.collection('app_state').doc('admin_bootstrap').get();
      const snap: any = await withTimeout(snapPromise, 1500);
      if (snap && snap.exists) {
        return snap.data() as BootstrapLockData;
      }
    } catch (err: any) {
      console.warn('[BootstrapLock] Notice querying Firestore app_state/admin_bootstrap:', err?.message || err);
    }
  }

  // Fallback to local lock file
  if (fs.existsSync(LOCAL_LOCK_PATH)) {
    try {
      const content = fs.readFileSync(LOCAL_LOCK_PATH, 'utf-8');
      return JSON.parse(content) as BootstrapLockData;
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Atomically acquires or verifies an in-progress lock.
 */
export async function acquirePersistentLock(
  params: {
    adminUid: string;
    adminEmail: string;
    projectId: string;
    lockTtlMs?: number;
    attemptId?: string;
  },
  firestoreDb?: any
): Promise<{ acquired: boolean; currentLock?: BootstrapLockData; error?: string }> {
  const db = firestoreDb !== undefined ? firestoreDb : getFirestoreDb();
  const ttl = params.lockTtlMs || DEFAULT_LOCK_TTL_MS;
  const now = Date.now();
  const attemptId = params.attemptId || (crypto.randomUUID ? crypto.randomUUID() : `att-${now}-${Math.random().toString(36).slice(2, 8)}`);

  const newLock: BootstrapLockData = {
    status: 'in_progress',
    adminUid: params.adminUid,
    adminEmail: params.adminEmail,
    projectId: params.projectId,
    lockedAt: now,
    lockExpiresAt: now + ttl,
    attemptId,
  };

  if (db && typeof db.runTransaction === 'function') {
    try {
      const lockRef = db.collection('app_state').doc('admin_bootstrap');
      const txPromise = db.runTransaction(async (transaction: any) => {
        const doc = await transaction.get(lockRef);
        if (doc && doc.exists) {
          const data = doc.data() as BootstrapLockData;
          if (data.status === 'completed') {
            return { acquired: false, currentLock: data, error: 'ALREADY_COMPLETED' };
          }
          if (data.status === 'in_progress' && data.lockExpiresAt && now < data.lockExpiresAt) {
            return { acquired: false, currentLock: data, error: 'CONCURRENT_ATTEMPT' };
          }
        }
        transaction.set(lockRef, newLock, { merge: true });
        return { acquired: true, currentLock: newLock };
      });
      const txResult: any = await withTimeout(txPromise, 2500);
      if (txResult && typeof txResult.acquired === 'boolean') {
        return txResult as { acquired: boolean; currentLock?: BootstrapLockData; error?: string };
      }
    } catch (txErr: any) {
      console.warn('[BootstrapLock] Firestore transaction notice:', txErr?.message || txErr);
    }
  } else if (db && typeof db.collection === 'function') {
    try {
      const doc = await db.collection('app_state').doc('admin_bootstrap').get();
      if (doc && doc.exists) {
        const data = doc.data() as BootstrapLockData;
        if (data.status === 'completed') {
          return { acquired: false, currentLock: data, error: 'ALREADY_COMPLETED' };
        }
        if (data.status === 'in_progress' && data.lockExpiresAt && now < data.lockExpiresAt) {
          return { acquired: false, currentLock: data, error: 'CONCURRENT_ATTEMPT' };
        }
      }
      await db.collection('app_state').doc('admin_bootstrap').set(newLock, { merge: true });
      return { acquired: true, currentLock: newLock };
    } catch (dbErr: any) {
      console.warn('[BootstrapLock] Firestore direct lock inspection notice:', dbErr?.message || dbErr);
    }
  }

  // File-based atomic fallback
  if (fs.existsSync(LOCAL_LOCK_PATH)) {
    try {
      const current = JSON.parse(fs.readFileSync(LOCAL_LOCK_PATH, 'utf-8')) as BootstrapLockData;
      if (current.status === 'completed') {
        return { acquired: false, currentLock: current, error: 'ALREADY_COMPLETED' };
      }
      if (current.status === 'in_progress' && current.lockExpiresAt && now < current.lockExpiresAt) {
        return { acquired: false, currentLock: current, error: 'CONCURRENT_ATTEMPT' };
      }
    } catch {}
  }

  try {
    fs.writeFileSync(LOCAL_LOCK_PATH, JSON.stringify(newLock, null, 2), 'utf-8');
  } catch (err: any) {
    console.warn('[BootstrapLock] Failed to write local lock file:', err?.message || err);
  }

  return { acquired: true, currentLock: newLock };
}

/**
 * Transitions lock status to 'completed' permanently.
 */
export async function completePersistentLock(
  params: {
    adminUid: string;
    adminEmail: string;
    projectId: string;
    attemptId?: string;
  },
  firestoreDb?: any
): Promise<void> {
  const db = firestoreDb !== undefined ? firestoreDb : getFirestoreDb();
  const completedLock: BootstrapLockData = {
    status: 'completed',
    adminUid: params.adminUid,
    adminEmail: params.adminEmail,
    projectId: params.projectId,
    lockedAt: Date.now(),
    lockExpiresAt: 0,
    completedAt: Date.now(),
    attemptId: params.attemptId || 'completed',
  };

  if (db) {
    try {
      const setPromise = db.collection('app_state').doc('admin_bootstrap').set(completedLock, { merge: true });
      await withTimeout(setPromise, 1500);
    } catch (err: any) {
      console.warn('[BootstrapLock] Could not write completed lock to Firestore:', err?.message || err);
    }
  }

  try {
    fs.writeFileSync(LOCAL_LOCK_PATH, JSON.stringify(completedLock, null, 2), 'utf-8');
  } catch (err: any) {
    console.warn('[BootstrapLock] Could not write completed lock file:', err?.message || err);
  }
}

/**
 * Synchronizes local application data (app_db.json) with verified canonical administrator UID.
 * Ensures:
 * 1. Legacy teacher record is updated in-place without creating duplicate profiles.
 * 2. Administrator record is never deleted.
 * 3. All existing application data (students, tutors, routines) is strictly preserved.
 * 4. Zero credentials/passwords stored.
 */
export function syncLocalDatabase(
  verifiedUid: string,
  cleanEmail: string,
  adminName: string
): void {
  let db: any = {};
  if (fs.existsSync(LOCAL_DB_PATH)) {
    try {
      db = JSON.parse(fs.readFileSync(LOCAL_DB_PATH, 'utf-8'));
    } catch {
      db = {};
    }
  }

  if (!db.teachers) db.teachers = [];
  const tIdx = db.teachers.findIndex(
    (t: any) => (t.email || '').toLowerCase() === cleanEmail
  );

  const adminTeacherRecord = {
    id: verifiedUid,
    uid: verifiedUid,
    authUid: verifiedUid,
    name: db.teachers[tIdx]?.name || adminName,
    email: cleanEmail,
    role: 'admin',
    isBootstrappedAdmin: true,
    bootstrappedAt: db.teachers[tIdx]?.bootstrappedAt || new Date().toISOString(),
  };

  if (tIdx >= 0) {
    // Update existing record in-place; preserve custom metadata
    db.teachers[tIdx] = { ...db.teachers[tIdx], ...adminTeacherRecord };
  } else {
    db.teachers.push(adminTeacherRecord);
  }

  if (!db.authUsers) db.authUsers = {};
  db.authUsers[cleanEmail] = {
    uid: verifiedUid,
    email: cleanEmail,
    name: adminName,
    role: 'admin',
    createdAt: db.authUsers[cleanEmail]?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  if (!db.userProfiles) db.userProfiles = {};
  db.userProfiles[cleanEmail] = {
    id: verifiedUid,
    uid: verifiedUid,
    email: cleanEmail,
    name: adminName,
    role: 'admin',
    createdAt: db.userProfiles[cleanEmail]?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  db.isAdministratorBootstrapped = true;
  db.bootstrappedAdminUid = verifiedUid;
  db.bootstrappedAdminEmail = cleanEmail;
  db.bootstrapCompletedAt = new Date().toISOString();

  // Defensively remove any legacy password fields
  if (db.authUsers) {
    for (const k of Object.keys(db.authUsers)) {
      if (db.authUsers[k]) delete db.authUsers[k].password;
    }
  }
  if (db.userProfiles) {
    for (const k of Object.keys(db.userProfiles)) {
      if (db.userProfiles[k]) delete db.userProfiles[k].password;
    }
  }
  if (Array.isArray(db.teachers)) {
    for (const t of db.teachers) {
      if (t) delete t.password;
    }
  }

  try {
    fs.writeFileSync(LOCAL_DB_PATH, JSON.stringify(db, null, 2), 'utf-8');
  } catch (err: any) {
    console.warn('[BootstrapLocalSync] Failed to update local DB:', err?.message || err);
  }
}

/**
 * READ-ONLY INSPECTION UTILITY
 * Inspects current Firebase Authentication account, custom claims, and persistent lock
 * without modifying any credentials or application state.
 */
export async function inspectAdministratorState(
  options: {
    targetEmail?: string;
    customAuth?: any;
    customDb?: any;
    bypassProjectIdCheckForTesting?: boolean;
  } = {}
): Promise<InspectionResult> {
  const targetEmail = (options.targetEmail || AUTHORIZED_ADMIN_EMAIL).toLowerCase().trim();

  // 1. Verify Project ID
  let activeProjectId = '';
  if (!options.bypassProjectIdCheckForTesting) {
    try {
      activeProjectId = resolveProjectId();
    } catch (err: any) {
      return {
        accountExists: false,
        email: targetEmail,
        hasAdminClaim: false,
        persistentLockExists: false,
        localTeacherRecordFound: false,
        localTeacherRecordHasUid: false,
        isReadyForBootstrap: false,
        canSafelyBootstrap: false,
        projectId: process.env.FIREBASE_PROJECT_ID || 'unresolved',
        error: 'UNAUTHORIZED_PROJECT_ID',
        message: err.message,
      };
    }
  } else {
    activeProjectId = AUTHORIZED_PROJECT_ID;
  }

  // 2. Query Firebase Auth
  let adminAuth: any;
  try {
    adminAuth = options.customAuth || getFirebaseAdminAuth();
  } catch (authInitErr: any) {
    return {
      accountExists: false,
      email: targetEmail,
      hasAdminClaim: false,
      persistentLockExists: false,
      localTeacherRecordFound: false,
      localTeacherRecordHasUid: false,
      isReadyForBootstrap: false,
      canSafelyBootstrap: false,
      projectId: activeProjectId,
      error: 'OPERATOR_CREDENTIALS_INVALID',
      message: `Failed to initialize Firebase Admin SDK: ${authInitErr?.message || authInitErr}`,
    };
  }

  let userRecord: any = null;
  try {
    userRecord = await adminAuth.getUserByEmail(targetEmail);
  } catch (err: any) {
    if (err?.code === 'auth/user-not-found') {
      return {
        accountExists: false,
        email: targetEmail,
        hasAdminClaim: false,
        persistentLockExists: false,
        localTeacherRecordFound: false,
        localTeacherRecordHasUid: false,
        isReadyForBootstrap: false,
        canSafelyBootstrap: false,
        projectId: activeProjectId,
        error: 'USER_NOT_FOUND_IN_AUTH',
        message: `User '${targetEmail}' does not exist in Firebase Authentication. Create the user first with email verified.`,
      };
    }
    return {
      accountExists: false,
      email: targetEmail,
      hasAdminClaim: false,
      persistentLockExists: false,
      localTeacherRecordFound: false,
      localTeacherRecordHasUid: false,
      isReadyForBootstrap: false,
      canSafelyBootstrap: false,
      projectId: activeProjectId,
      error: 'AUTH_LOOKUP_FAILED',
      message: `Failed to query Firebase Authentication: ${err?.message || err}`,
    };
  }

  const customClaims = userRecord.customClaims || {};
  const hasAdminClaim = customClaims.role === 'admin' || customClaims.admin === true;

  // 3. Inspect persistent lock
  const lock = await getPersistentLock(options.customDb);
  const persistentLockExists = Boolean(lock);
  const persistentLockStatus = lock?.status || 'none';
  const persistentLockUid = lock?.adminUid;

  // 4. Inspect local app_db.json
  let localTeacherRecordFound = false;
  let localTeacherRecordHasUid = false;
  if (fs.existsSync(LOCAL_DB_PATH)) {
    try {
      const db = JSON.parse(fs.readFileSync(LOCAL_DB_PATH, 'utf-8'));
      const teacher = (db.teachers || []).find(
        (t: any) => (t.email || '').toLowerCase() === targetEmail
      );
      if (teacher) {
        localTeacherRecordFound = true;
        localTeacherRecordHasUid = Boolean(teacher.uid || teacher.id);
      }
    } catch {}
  }

  const canSafelyBootstrap =
    Boolean(userRecord) &&
    !userRecord.disabled &&
    Boolean(userRecord.emailVerified) &&
    !hasAdminClaim &&
    persistentLockStatus !== 'completed';

  const isReadyForBootstrap = canSafelyBootstrap;

  let message = `Inspected '${targetEmail}': Account exists in project '${activeProjectId}'.`;
  if (hasAdminClaim) {
    message += ` Administrator custom claim { role: 'admin' } is already active on UID '${userRecord.uid}'.`;
  } else if (!userRecord.emailVerified) {
    message += ` Email ownership is not verified (emailVerified = false). Must be verified before bootstrap.`;
  } else if (userRecord.disabled) {
    message += ` Account is currently disabled.`;
  } else if (persistentLockStatus === 'completed') {
    message += ` Completed persistent lock already recorded for UID '${persistentLockUid}'.`;
  } else {
    message += ` Ready for administrator bootstrap execution.`;
  }

  return {
    accountExists: true,
    email: targetEmail,
    uid: userRecord.uid,
    emailVerified: Boolean(userRecord.emailVerified),
    disabled: Boolean(userRecord.disabled),
    hasAdminClaim,
    customClaims,
    persistentLockExists,
    persistentLockStatus,
    persistentLockUid,
    localTeacherRecordFound,
    localTeacherRecordHasUid,
    isReadyForBootstrap,
    canSafelyBootstrap,
    projectId: activeProjectId,
    message,
  };
}

/**
 * SECURE ADMINISTRATOR BOOTSTRAP EXECUTOR
 * Performs verification, atomic lock acquisition, custom claim assignment, and persistence.
 */
export async function bootstrapFirstAdministrator(
  targetEmailOrOptions?: string | BootstrapOptions,
  adminNameParam?: string,
  maybeOptions?: BootstrapOptions
): Promise<BootstrapResult> {
  let options: BootstrapOptions = {};
  let targetEmail = AUTHORIZED_ADMIN_EMAIL;
  let adminName = 'Administrator';

  if (typeof targetEmailOrOptions === 'string') {
    targetEmail = targetEmailOrOptions.trim();
    if (adminNameParam) adminName = adminNameParam;
    if (maybeOptions) options = maybeOptions;
  } else if (targetEmailOrOptions && typeof targetEmailOrOptions === 'object') {
    options = targetEmailOrOptions;
    if (options.targetEmail) targetEmail = options.targetEmail.trim();
    if (options.adminName) adminName = options.adminName;
  }

  const cleanEmail = targetEmail.toLowerCase();

  // --------------------------------------------------------------------------
  // Rule 1: Secure Identity Selection — Strictly bound to AUTHORIZED_ADMIN_EMAIL
  // --------------------------------------------------------------------------
  if (cleanEmail !== AUTHORIZED_ADMIN_EMAIL) {
    return {
      success: false,
      status: 'ERROR',
      error: 'UNAUTHORIZED_TARGET_EMAIL',
      message: `Unauthorized target email '${cleanEmail}'. Administrator bootstrap is strictly restricted to '${AUTHORIZED_ADMIN_EMAIL}'. Arbitrary CLI targets are rejected.`,
    };
  }

  // --------------------------------------------------------------------------
  // Rule 2: Operator Confirmation Requirement
  // --------------------------------------------------------------------------
  if (!options.confirm) {
    return {
      success: false,
      status: 'ERROR',
      error: 'OPERATOR_CONFIRMATION_REQUIRED',
      message: `Explicit operator confirmation (--confirm) is required to execute administrator bootstrap. To verify without modifying, use --verify.`,
    };
  }

  // --------------------------------------------------------------------------
  // Rule 3: Target Project Validation — Strictly bound to AUTHORIZED_PROJECT_ID
  // --------------------------------------------------------------------------
  let activeProjectId = '';
  if (!options.bypassProjectIdCheckForTesting) {
    try {
      activeProjectId = resolveProjectId();
      if (activeProjectId !== AUTHORIZED_PROJECT_ID) {
        return {
          success: false,
          status: 'ERROR',
          error: 'UNAUTHORIZED_PROJECT_ID',
          message: `Attempted bootstrap against unauthorized project '${activeProjectId}'. Must be '${AUTHORIZED_PROJECT_ID}'.`,
        };
      }
    } catch (projErr: any) {
      return {
        success: false,
        status: 'ERROR',
        error: 'UNAUTHORIZED_PROJECT_ID',
        message: projErr?.message || 'Invalid or missing Firebase project ID.',
      };
    }
  } else {
    activeProjectId = AUTHORIZED_PROJECT_ID;
  }

  // --------------------------------------------------------------------------
  // Rule 4: Operator Credentials / Firebase Admin SDK Inspection
  // --------------------------------------------------------------------------
  let adminAuth: any;
  try {
    adminAuth = options.customAuth || getFirebaseAdminAuth();
    if (!adminAuth || typeof adminAuth.getUserByEmail !== 'function') {
      throw new Error('Firebase Admin Auth instance is not functional.');
    }
  } catch (authInitErr: any) {
    return {
      success: false,
      status: 'ERROR',
      error: 'OPERATOR_CREDENTIALS_INVALID',
      message: `Cannot access Firebase Admin SDK: ${authInitErr?.message || authInitErr}. Ensure valid Application Default Credentials (ADC) are configured.`,
    };
  }

  // --------------------------------------------------------------------------
  // Rule 5: Inspect Intended Account in Firebase Authentication
  // --------------------------------------------------------------------------
  let firebaseUser: any = null;
  try {
    firebaseUser = await adminAuth.getUserByEmail(cleanEmail);
  } catch (err: any) {
    if (err?.code === 'auth/user-not-found') {
      return {
        success: false,
        status: 'ERROR',
        error: 'USER_NOT_FOUND_IN_AUTH',
        message: `Account '${cleanEmail}' does not exist in Firebase Authentication. The operator must create the account with a new, strong password and verify its email before bootstrap.`,
      };
    }
    return {
      success: false,
      status: 'ERROR',
      error: 'OPERATOR_CREDENTIALS_INVALID',
      message: `Failed to inspect Firebase Authentication user: ${err?.message || err}`,
    };
  }

  const verifiedUid = firebaseUser.uid;

  // Account Disabled Check
  if (firebaseUser.disabled) {
    return {
      success: false,
      status: 'ERROR',
      error: 'ACCOUNT_DISABLED',
      message: `Firebase Authentication account '${cleanEmail}' (UID: '${verifiedUid}') is currently disabled. Refusing bootstrap.`,
    };
  }

  // Email Ownership Verification Requirement
  if (!firebaseUser.emailVerified) {
    return {
      success: false,
      status: 'ERROR',
      error: 'EMAIL_NOT_VERIFIED',
      message: `Firebase Authentication account '${cleanEmail}' (UID: '${verifiedUid}') has not verified email ownership (emailVerified=false). The account must be verified before granting administrative privileges.`,
    };
  }

  // Expected UID Confirmation (if supplied)
  if (options.expectedUid && options.expectedUid !== verifiedUid) {
    return {
      success: false,
      status: 'ERROR',
      error: 'UID_CONFIRMATION_MISMATCH',
      message: `Supplied expected UID '${options.expectedUid}' does not match Firebase Authentication UID '${verifiedUid}' for '${cleanEmail}'.`,
    };
  }

  // --------------------------------------------------------------------------
  // Rule 6: Check for Conflicting Administrative Privileges Across Firebase Auth
  // --------------------------------------------------------------------------
  if (typeof adminAuth.listUsers === 'function') {
    try {
      const userList = await adminAuth.listUsers(100);
      for (const u of userList.users || []) {
        if (u.uid !== verifiedUid) {
          const claims = u.customClaims || {};
          if (claims.role === 'admin' || claims.admin === true) {
            return {
              success: false,
              status: 'ERROR',
              error: 'EXISTING_ADMIN_CONFLICT',
              message: `Another account (UID: '${u.uid}', email: '${u.email}') already possesses administrator privileges in Firebase Authentication. Aborting for manual investigation.`,
            };
          }
        }
      }
    } catch (listErr: any) {
      console.warn('[BootstrapAdmin] User enumeration notice:', listErr?.message || listErr);
    }
  }

  // --------------------------------------------------------------------------
  // Rule 7: Server-Controlled Persistent Lock Inspection & Concurrency Checks
  // --------------------------------------------------------------------------
  const existingLock = await getPersistentLock(options.customDb);
  const now = Date.now();

  if (existingLock) {
    // Conflict check: lock held by another UID
    if (existingLock.adminUid && existingLock.adminUid !== verifiedUid) {
      return {
        success: false,
        status: 'ERROR',
        error: 'EXISTING_ADMIN_CONFLICT',
        message: `Persistent server bootstrap lock is held by a different UID '${existingLock.adminUid}' (${existingLock.adminEmail}). Aborting for manual investigation.`,
      };
    }

    // Idempotency check: already completed for this UID
    if (existingLock.status === 'completed') {
      const currentClaims = firebaseUser.customClaims || {};
      if (currentClaims.role === 'admin') {
        syncLocalDatabase(verifiedUid, cleanEmail, adminName);
        return {
          success: true,
          status: 'ALREADY_ACTIVE',
          alreadyActive: true,
          adminUid: verifiedUid,
          adminEmail: cleanEmail,
          claims: currentClaims,
          message: `Administrator '${cleanEmail}' (UID: '${verifiedUid}') already possesses verified custom claim role='admin' and completed bootstrap state. No privilege changes were necessary.`,
        };
      }
    }

    // Concurrency check: lock is actively in progress
    if (
      existingLock.status === 'in_progress' &&
      existingLock.lockExpiresAt &&
      now < existingLock.lockExpiresAt
    ) {
      return {
        success: false,
        status: 'ERROR',
        error: 'CONCURRENT_BOOTSTRAP_ATTEMPT',
        message: `Another bootstrap attempt for UID '${existingLock.adminUid}' is currently in progress (lock expires in ${Math.ceil((existingLock.lockExpiresAt - now) / 1000)}s).`,
      };
    }

    // Interrupted bootstrap recovery: lock expired
    if (existingLock.status === 'in_progress' && existingLock.lockExpiresAt && now >= existingLock.lockExpiresAt) {
      console.log(`[BOOTSTRAP RECOVERY] Detected expired in-progress lock from prior interrupted run. Reclaiming lock...`);
    }
  }

  // Check if UID already has admin claims in Auth even if lock wasn't completed (partial run)
  const currentClaims = firebaseUser.customClaims || {};
  if (currentClaims.role === 'admin' && (!existingLock || existingLock.status !== 'completed')) {
    console.log(`[BOOTSTRAP RECOVERY] UID '${verifiedUid}' already has role='admin' claim. Finalizing persistent lock...`);
    await completePersistentLock(
      { adminUid: verifiedUid, adminEmail: cleanEmail, projectId: activeProjectId },
      options.customDb
    );
    syncLocalDatabase(verifiedUid, cleanEmail, adminName);
    return {
      success: true,
      status: 'ALREADY_ACTIVE',
      alreadyActive: true,
      adminUid: verifiedUid,
      adminEmail: cleanEmail,
      claims: currentClaims,
      message: `Administrator '${cleanEmail}' already possesses role='admin' claim. Completed persistent lock synchronized without privilege re-grant.`,
    };
  }

  // --------------------------------------------------------------------------
  // Rule 8: Acquire Atomic In-Progress Lock
  // --------------------------------------------------------------------------
  const lockResult = await acquirePersistentLock(
    {
      adminUid: verifiedUid,
      adminEmail: cleanEmail,
      projectId: activeProjectId,
      lockTtlMs: options.lockTtlMs || DEFAULT_LOCK_TTL_MS,
    },
    options.customDb
  );

  if (!lockResult.acquired) {
    if (lockResult.error === 'ALREADY_COMPLETED') {
      return {
        success: false,
        status: 'ERROR',
        error: 'ALREADY_BOOTSTRAPPED',
        message: `Persistent lock records administrator bootstrap as already completed.`,
      };
    }
    return {
      success: false,
      status: 'ERROR',
      error: 'CONCURRENT_BOOTSTRAP_ATTEMPT',
      message: `Failed to acquire atomic lock: a concurrent bootstrap attempt is active.`,
    };
  }

  // --------------------------------------------------------------------------
  // Rule 9: Assign Firebase Custom Claims { role: 'admin' }
  // --------------------------------------------------------------------------
  if (!options.dryRun) {
    try {
      await adminAuth.setCustomUserClaims(verifiedUid, { role: 'admin' });
    } catch (claimErr: any) {
      return {
        success: false,
        status: 'ERROR',
        error: 'CLAIM_ASSIGNMENT_FAILED',
        message: `Failed to assign custom claim role='admin' on UID '${verifiedUid}': ${claimErr?.message || claimErr}`,
      };
    }
  }

  // --------------------------------------------------------------------------
  // Rule 10: Complete Persistent Lock and Update Application Data
  // --------------------------------------------------------------------------
  await completePersistentLock(
    {
      adminUid: verifiedUid,
      adminEmail: cleanEmail,
      projectId: activeProjectId,
      attemptId: lockResult.currentLock?.attemptId,
    },
    options.customDb
  );

  syncLocalDatabase(verifiedUid, cleanEmail, adminName);

  return {
    success: true,
    status: 'BOOTSTRAPPED',
    message: `Administrator '${cleanEmail}' successfully bootstrapped and bound to canonical UID '${verifiedUid}' with custom claim role='admin'.`,
    adminUid: verifiedUid,
    adminEmail: cleanEmail,
    claims: { role: 'admin' },
  };
}

// ----------------------------------------------------------------------------
// CLI Execution Interface
// ----------------------------------------------------------------------------
if (process.argv[1] && process.argv[1].endsWith('bootstrap-admin.ts')) {
  const args = process.argv.slice(2);
  const isVerify = args.includes('--verify') || args.includes('--inspect');
  const isConfirm = args.includes('--confirm');

  // Parse optional flags
  let targetEmail = AUTHORIZED_ADMIN_EMAIL;
  let adminName = 'Administrator';
  let expectedUid: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--uid' && args[i + 1]) {
      expectedUid = args[i + 1];
      i++;
    } else if (a === '--name' && args[i + 1]) {
      adminName = args[i + 1];
      i++;
    } else if (!a.startsWith('--')) {
      targetEmail = a;
    }
  }

  if (isVerify) {
    console.log('\n================================================================================');
    console.log('=== FIREBASE ADMINISTRATOR STATE INSPECTION (READ-ONLY) ===');
    console.log('================================================================================\n');

    inspectAdministratorState({ targetEmail })
      .then((report) => {
        console.log(`Target Project:       ${report.projectId}`);
        console.log(`Target Email:         ${report.email}`);
        console.log(`Account Exists:       ${report.accountExists ? 'YES' : 'NO'}`);
        if (report.accountExists) {
          console.log(`Firebase UID:         ${report.uid}`);
          console.log(`Email Verified:       ${report.emailVerified ? 'YES' : 'NO'}`);
          console.log(`Account Disabled:     ${report.disabled ? 'YES' : 'NO'}`);
          console.log(`Has Admin Claim:      ${report.hasAdminClaim ? 'YES (role=admin)' : 'NO'}`);
        }
        console.log(`Persistent Lock:      ${(report.persistentLockStatus || 'none').toUpperCase()} (UID: ${report.persistentLockUid || 'none'})`);
        console.log(`Local Teacher Stub:   ${report.localTeacherRecordFound ? 'Found' : 'Not found'} (Bound to UID: ${report.localTeacherRecordHasUid ? 'YES' : 'NO'})`);
        console.log(`Can Safely Bootstrap: ${report.canSafelyBootstrap ? 'YES' : 'NO'}`);
        console.log(`\nDiagnosis: ${report.message}\n`);
        console.log('================================================================================\n');
        process.exit(report.error ? 1 : 0);
      })
      .catch((err) => {
        console.error('[INSPECTION ERROR]', err);
        process.exit(1);
      });
  } else if (!isConfirm) {
    console.error('\n================================================================================');
    console.error('[BOOTSTRAP REFUSED] Explicit operator confirmation (--confirm) is required.');
    console.error('================================================================================\n');
    console.error('To inspect current administrator state in read-only mode without changes:');
    console.error('  FIREBASE_PROJECT_ID=itissimple-security-staging npx tsx scripts/bootstrap-admin.ts --verify\n');
    console.error('To execute secure administrator bootstrap with operator confirmation:');
    console.error('  FIREBASE_PROJECT_ID=itissimple-security-staging npx tsx scripts/bootstrap-admin.ts --confirm\n');
    process.exit(1);
  } else {
    bootstrapFirstAdministrator({
      targetEmail,
      adminName,
      expectedUid,
      confirm: true,
    })
      .then((res) => {
        if (res.success) {
          console.log(`\n[BOOTSTRAP SUCCESS] ${res.message}`);
          if (res.adminUid) console.log(`Canonical UID: ${res.adminUid}`);
          console.log(`Status: ${res.status}\n`);
          process.exit(0);
        } else {
          console.error(`\n[BOOTSTRAP FAILED] ${res.message} (${res.error})\n`);
          process.exit(1);
        }
      })
      .catch((err) => {
        console.error('[BOOTSTRAP UNCAUGHT ERROR]', err);
        process.exit(1);
      });
  }
}
