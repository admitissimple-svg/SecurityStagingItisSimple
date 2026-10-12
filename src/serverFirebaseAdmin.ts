import { initializeApp, getApps, applicationDefault, App } from 'firebase-admin/app';
import { getAuth, Auth } from 'firebase-admin/auth';

/**
 * Strictly authorized Firebase Project ID for staging.
 * No other project ID is permitted to run under Firebase Admin SDK.
 */
export const ALLOWED_STAGING_PROJECT_ID = 'itissimple-security-staging';

let adminAppInstance: App | null = null;
let adminAuthInstance: Auth | null = null;

/**
 * Resolves the Firebase project ID exclusively from FIREBASE_PROJECT_ID env var.
 * Strictly requires its value to match 'itissimple-security-staging'.
 * All fallbacks to config files, GOOGLE_CLOUD_PROJECT, GCLOUD_PROJECT,
 * and legacy project IDs (e.g. itissimple-security-staging) are completely removed.
 */
export function resolveProjectId(): string {
  const envProjectId = process.env.FIREBASE_PROJECT_ID;

  if (!envProjectId || envProjectId.trim() === '') {
    throw new Error(
      `[FirebaseAdmin Security] Environment variable FIREBASE_PROJECT_ID is missing. Firebase Admin SDK can only initialize in the authorized staging project: '${ALLOWED_STAGING_PROJECT_ID}'.`
    );
  }

  const trimmedProjectId = envProjectId.trim();
  if (trimmedProjectId !== ALLOWED_STAGING_PROJECT_ID) {
    throw new Error(
      `[FirebaseAdmin Security] Unauthorized Firebase project ID '${trimmedProjectId}'. Firebase Admin SDK is strictly restricted to '${ALLOWED_STAGING_PROJECT_ID}'.`
    );
  }

  return trimmedProjectId;
}

/**
 * Initializes Firebase Admin SDK once using Application Default Credentials (ADC).
 * Strictly bound to ALLOWED_STAGING_PROJECT_ID.
 * Validates that any cached or pre-existing Firebase Admin instance belongs
 * to the authorized staging project before reusing it.
 * Never reads or downloads service account JSON keys.
 */
export function getFirebaseAdminApp(): App {
  const expectedProjectId = resolveProjectId();

  if (adminAppInstance) {
    const cachedProjectId = adminAppInstance.options?.projectId;
    if (cachedProjectId !== expectedProjectId) {
      throw new Error(
        `[FirebaseAdmin Security] Existing cached Firebase Admin instance belongs to unauthorized project '${cachedProjectId}'. Expected '${expectedProjectId}'. Refusing to reuse.`
      );
    }
    return adminAppInstance;
  }

  const existingApps = getApps();
  if (existingApps.length > 0) {
    const matchingApp = existingApps.find(
      (app) => app.options?.projectId === expectedProjectId
    );

    if (matchingApp) {
      adminAppInstance = matchingApp;
      return adminAppInstance;
    }

    const unauthorizedList = existingApps
      .map((app) => `'${app.options?.projectId || app.name || 'unknown'}'`)
      .join(', ');
    throw new Error(
      `[FirebaseAdmin Security] Existing Firebase Admin instance(s) [${unauthorizedList}] do not belong to authorized project '${expectedProjectId}'. Refusing to reuse.`
    );
  }

  adminAppInstance = initializeApp({
    credential: applicationDefault(),
    projectId: expectedProjectId,
  });

  return adminAppInstance;
}

/**
 * Exposes a safe singleton accessor for Firebase Admin Auth service.
 */
export function getFirebaseAdminAuth(): Auth {
  if (adminAuthInstance) {
    return adminAuthInstance;
  }

  const app = getFirebaseAdminApp();
  adminAuthInstance = getAuth(app);
  return adminAuthInstance;
}

/**
 * Test helper allowing unit/integration tests to inject mock Auth instances.
 */
export function setFirebaseAdminAuthForTesting(mockAuth: Auth | null): void {
  adminAuthInstance = mockAuth;
}

/**
 * Test helper allowing unit/integration tests to inject mock App instances.
 */
export function setFirebaseAdminAppForTesting(mockApp: App | null): void {
  adminAppInstance = mockApp;
}

/**
 * Test helper allowing unit/integration tests to reset internal singleton state.
 */
export function resetFirebaseAdminForTesting(): void {
  adminAppInstance = null;
  adminAuthInstance = null;
}
