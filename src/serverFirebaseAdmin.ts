import { initializeApp, getApps, App } from 'firebase-admin/app';
import { getAuth, Auth } from 'firebase-admin/auth';

/**
 * Strict constraint: Firebase Admin SDK is exclusively bound to itissimple-security-staging.
 * Legacy project IDs (e.g. itissimple-8663d) are explicitly forbidden.
 */
export const ALLOWED_STAGING_PROJECT_ID = 'itissimple-security-staging';

let cachedAdminApp: App | null = null;
let mockAdminAuth: Auth | null = null;

/**
 * Resolves and validates FIREBASE_PROJECT_ID against the authorized staging project.
 */
export function resolveProjectId(): string {
  const envProjectId = (process.env.FIREBASE_PROJECT_ID || '').trim();

  if (!envProjectId) {
    throw new Error(
      `[FirebaseAdmin Security] Environment variable FIREBASE_PROJECT_ID is missing. Firebase Admin SDK can only initialize in the authorized staging project: '${ALLOWED_STAGING_PROJECT_ID}'.`
    );
  }

  if (envProjectId !== ALLOWED_STAGING_PROJECT_ID) {
    throw new Error(
      `[FirebaseAdmin Security] Unauthorized Firebase project ID '${envProjectId}'. Refusing initialization. Only '${ALLOWED_STAGING_PROJECT_ID}' is permitted.`
    );
  }

  return ALLOWED_STAGING_PROJECT_ID;
}

/**
 * Returns a validated Firebase Admin App instance strictly bound to itissimple-security-staging.
 */
export function getFirebaseAdminApp(): App {
  const targetProjectId = resolveProjectId();

  if (cachedAdminApp) {
    const cachedProjectId = cachedAdminApp.options?.projectId;
    if (cachedProjectId !== targetProjectId) {
      throw new Error(
        `[FirebaseAdmin Security] Existing cached Firebase Admin instance belongs to unauthorized project '${cachedProjectId || 'undefined'}'. Expected '${targetProjectId}'.`
      );
    }
    return cachedAdminApp;
  }

  const existingApps = getApps();
  if (existingApps.length > 0) {
    const firstApp = existingApps[0];
    const firstProjectId = firstApp.options?.projectId;
    if (firstProjectId !== targetProjectId) {
      throw new Error(
        `[FirebaseAdmin Security] Existing cached Firebase Admin instance belongs to unauthorized project '${firstProjectId || 'undefined'}'. Expected '${targetProjectId}'.`
      );
    }
    cachedAdminApp = firstApp;
    return cachedAdminApp;
  }

  try {
    cachedAdminApp = initializeApp({
      projectId: targetProjectId,
    });
    return cachedAdminApp;
  } catch (err: any) {
    throw new Error(`[FirebaseAdmin] Failed to initialize Firebase Admin SDK: ${err.message}`);
  }
}

/**
 * Returns a validated Firebase Admin Auth instance.
 */
export function getFirebaseAdminAuth(): Auth {
  if (mockAdminAuth) {
    return mockAdminAuth;
  }
  const app = getFirebaseAdminApp();
  return getAuth(app);
}

/**
 * Testing helpers
 */
export function setFirebaseAdminAppForTesting(app: App | null): void {
  cachedAdminApp = app;
}

export function setFirebaseAdminAuthForTesting(mockAuth: Auth | null): void {
  mockAdminAuth = mockAuth;
}

export function resetFirebaseAdminForTesting(): void {
  cachedAdminApp = null;
  mockAdminAuth = null;
}
