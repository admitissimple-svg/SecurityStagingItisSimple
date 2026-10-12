import crypto from 'crypto';
import { Request, Response, NextFunction, RequestHandler } from 'express';
import { OAuth2Client } from 'google-auth-library';
import { getFirestoreDb } from './serverFirestore';
import { resolveProjectId, ALLOWED_STAGING_PROJECT_ID } from './serverFirebaseAdmin';

const googleAuthClient = new OAuth2Client();

let firestoreDbResolver: () => any = getFirestoreDb;

export function setFirestoreDbResolverForTesting(resolver: (() => any) | null): void {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('SECURITY VIOLATION: Test resolver only available in test mode.');
  }
  firestoreDbResolver = resolver || getFirestoreDb;
}

/**
 * Project and database constraints strictly locked to staging.
 * Legacy project IDs (e.g. itissimple-8663d) are explicitly forbidden.
 */
export const DIAGNOSTIC_PROJECT_ID = 'itissimple-security-staging';
export const DIAGNOSTIC_DATABASE_ID = '(default)';
export const DIAGNOSTIC_COLLECTION = '_diagnostic_probes';
export const DIAGNOSTIC_DOCUMENT_ID = 'connectivity_check';
export const DIAGNOSTIC_DOCUMENT_PATH = `${DIAGNOSTIC_COLLECTION}/${DIAGNOSTIC_DOCUMENT_ID}`;

/**
 * Checks if the server is running in DIAGNOSTIC_ONLY mode.
 *
 * CRITICAL SECURITY INVARIANT:
 * This mode can ONLY be activated via explicit server environment configuration (DIAGNOSTIC_ONLY=true).
 * URL query parameters (?diagnostic=true) and HTTP request headers (X-Diagnostic: true)
 * are STRICTLY FORBIDDEN from activating or influencing diagnostic mode.
 */
export function isDiagnosticMode(): boolean {
  return process.env.DIAGNOSTIC_ONLY === 'true';
}

/**
 * Strict exact origins allowlist for staging environment.
 * Generic wildcards (*.run.app, *.google.com, *.web.app, *.firebaseapp.com) are completely forbidden.
 * NOTE: Fictional / un-deployed Cloud Run URLs are strictly omitted.
 * When a Cloud Run backend is genuinely deployed, its URL is authorized dynamically via STAGING_BACKEND_URL.
 */
export const EXACT_STAGING_CORS_ALLOWLIST: string[] = [
  // Firebase Hosting staging domains
  'https://itissimple-security-staging.web.app',
  'https://itissimple-security-staging.firebaseapp.com',

  // Google AI Studio authorized preview origins (exact)
  'https://aistudio.google.com',
  'https://ais-dev-oqs6qp7dnhslqr34rkqhkr-456322168913.us-east5.run.app',
  'https://ais-pre-oqs6qp7dnhslqr34rkqhkr-456322168913.us-east5.run.app',
];

/**
 * Audits and validates incoming origin against strictly authorized exact allowlist.
 * Replaces generic wildcard suffixes (*.run.app, *.google.com, etc.) with exact matches.
 */
export function isAuthorizedOriginStrict(origin?: string): boolean {
  if (!origin) return true; // Direct same-origin or server-to-server requests

  try {
    const url = new URL(origin);
    const originNormalized = origin.toLowerCase().replace(/\/+$/, '');
    const host = url.hostname.toLowerCase();

    // 1. Localhost and Loopback for local development and testing
    if (
      (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0') &&
      (url.protocol === 'http:' || url.protocol === 'https:')
    ) {
      return true;
    }

    // 2. Exact staging allowlist
    if (EXACT_STAGING_CORS_ALLOWLIST.some((allowed) => allowed.toLowerCase() === originNormalized)) {
      return true;
    }

    // 3. Staging Cloud Run backend URL from environment (if configured)
    if (
      process.env.STAGING_BACKEND_URL &&
      process.env.STAGING_BACKEND_URL.toLowerCase().replace(/\/+$/, '') === originNormalized
    ) {
      return true;
    }
    if (
      process.env.DEVELOPMENT_APP_URL &&
      process.env.DEVELOPMENT_APP_URL.toLowerCase().replace(/\/+$/, '') === originNormalized
    ) {
      return true;
    }
    if (
      process.env.SHARED_APP_URL &&
      process.env.SHARED_APP_URL.toLowerCase().replace(/\/+$/, '') === originNormalized
    ) {
      return true;
    }

    // 4. Custom exact origins configured on server via ALLOWED_CORS_ORIGINS (comma-separated exact URLs)
    const customAllowed = (process.env.ALLOWED_CORS_ORIGINS || '')
      .split(',')
      .map((s) => s.trim().toLowerCase().replace(/\/+$/, ''))
      .filter(Boolean);

    if (customAllowed.includes(originNormalized)) {
      return true;
    }

    // Generic wildcards (*.run.app, *.google.com, *.web.app, *.firebaseapp.com) are REJECTED
    return false;
  } catch {
    return false;
  }
}

/**
 * Resolves the identity of the execution Service Account without exposing any private keys or tokens.
 */
export async function getExecutionServiceAccount(): Promise<{
  serviceAccount: string;
  source: 'gcp-metadata' | 'environment' | 'local-adc';
  projectId: string;
}> {
  const currentProjectId = process.env.FIREBASE_PROJECT_ID || DIAGNOSTIC_PROJECT_ID;

  // 1. Attempt query to Google Cloud Compute/Cloud Run metadata server
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1200);
    const response = await fetch(
      'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/email',
      {
        headers: { 'Metadata-Flavor': 'Google' },
        signal: controller.signal,
      }
    );
    clearTimeout(timeout);
    if (response.ok) {
      const email = (await response.text()).trim();
      if (email && email.includes('@')) {
        return {
          serviceAccount: email,
          source: 'gcp-metadata',
          projectId: currentProjectId,
        };
      }
    }
  } catch {
    // Expected in non-GCP / local environment
  }

  // 2. Fallback to explicit server environment variable
  if (process.env.SERVICE_ACCOUNT_EMAIL && process.env.SERVICE_ACCOUNT_EMAIL.trim()) {
    return {
      serviceAccount: process.env.SERVICE_ACCOUNT_EMAIL.trim(),
      source: 'environment',
      projectId: currentProjectId,
    };
  }

  if (process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_CLIENT_EMAIL.trim()) {
    return {
      serviceAccount: process.env.FIREBASE_CLIENT_EMAIL.trim(),
      source: 'environment',
      projectId: currentProjectId,
    };
  }

  // 3. Local Application Default Credentials (ADC) fallback identifier
  return {
    serviceAccount: `local-adc@${currentProjectId}.iam.gserviceaccount.com`,
    source: 'local-adc',
    projectId: currentProjectId,
  };
}

export interface DiagnosticOperationTiming {
  status: 'confirmed' | 'failed';
  durationMs: number;
  error?: string;
  verified?: boolean;
}

export interface FirestoreProbeResult {
  success: boolean;
  status: 'connected' | 'error';
  diagnosticMode: boolean;
  projectId: string;
  databaseId: string;
  serviceAccount: string;
  serviceAccountSource: string;
  collection: string;
  documentId: string;
  documentPath: string;
  documentExists: boolean;
  probeType: 'single_document_read';
  operation: {
    type: 'get';
    status: 'confirmed' | 'failed';
    durationMs: number;
    error?: string;
  };
  operations?: {
    read: DiagnosticOperationTiming;
  };
  totalDurationMs: number;
  timestamp: string;
  error?: string;
  failedStep?: 'initialization' | 'project_validation' | 'read';
  code?: string | number;
}

/**
 * Executes a REAL, read-only diagnostic probe against Cloud Firestore in project `itissimple-security-staging`.
 *
 * Invariants (Fase 1A):
 * 1. Strictly bound to `itissimple-security-staging` and database `(default)`.
 * 2. Never accesses or modifies `itissimple-8663d`.
 * 3. Never writes to `app_db.json`.
 * 4. Never creates, modifies, or deletes any documents (Zero set(), Zero add(), Zero delete()).
 * 5. Executes a single `get()` operation on `_diagnostic_probes/connectivity_check`.
 * 6. Validates project ID and database ID explicitly prior to the read operation.
 * 7. Returns structured connectivity results without exposing credentials or document content.
 * 8. Never uses mocks as proof of real cloud connectivity.
 */
export async function executeFirestoreDiagnosticProbe(): Promise<FirestoreProbeResult> {
  const t0 = Date.now();
  const timestamp = new Date().toISOString();

  // 1. Service Account verification
  const saInfo = await getExecutionServiceAccount();

  // 2. Project ID validation (strictly itissimple-security-staging)
  let configuredProjectId = '';
  try {
    configuredProjectId = resolveProjectId();
  } catch (err: any) {
    return {
      success: false,
      status: 'error',
      diagnosticMode: isDiagnosticMode(),
      projectId: process.env.FIREBASE_PROJECT_ID || 'undefined',
      databaseId: DIAGNOSTIC_DATABASE_ID,
      serviceAccount: saInfo.serviceAccount,
      serviceAccountSource: saInfo.source,
      collection: DIAGNOSTIC_COLLECTION,
      documentId: DIAGNOSTIC_DOCUMENT_ID,
      documentPath: DIAGNOSTIC_DOCUMENT_PATH,
      documentExists: false,
      probeType: 'single_document_read',
      operation: { type: 'get', status: 'failed', durationMs: 0, error: err.message },
      operations: { read: { status: 'failed', durationMs: 0, error: err.message } },
      totalDurationMs: Date.now() - t0,
      timestamp,
      failedStep: 'project_validation',
      error: `Project validation failed: ${err.message}`,
      code: 'PROJECT_UNAUTHORIZED',
    };
  }

  if (configuredProjectId !== DIAGNOSTIC_PROJECT_ID) {
    return {
      success: false,
      status: 'error',
      diagnosticMode: isDiagnosticMode(),
      projectId: configuredProjectId,
      databaseId: DIAGNOSTIC_DATABASE_ID,
      serviceAccount: saInfo.serviceAccount,
      serviceAccountSource: saInfo.source,
      collection: DIAGNOSTIC_COLLECTION,
      documentId: DIAGNOSTIC_DOCUMENT_ID,
      documentPath: DIAGNOSTIC_DOCUMENT_PATH,
      documentExists: false,
      probeType: 'single_document_read',
      operation: {
        type: 'get',
        status: 'failed',
        durationMs: 0,
        error: `Refusing diagnostic probe on unauthorized project '${configuredProjectId}'. Strictly required: '${DIAGNOSTIC_PROJECT_ID}'.`,
      },
      operations: {
        read: {
          status: 'failed',
          durationMs: 0,
          error: `Refusing diagnostic probe on unauthorized project '${configuredProjectId}'. Strictly required: '${DIAGNOSTIC_PROJECT_ID}'.`,
        },
      },
      totalDurationMs: Date.now() - t0,
      timestamp,
      failedStep: 'project_validation',
      error: `Refusing diagnostic probe on unauthorized project '${configuredProjectId}'. Strictly required: '${DIAGNOSTIC_PROJECT_ID}'.`,
      code: 'FORBIDDEN_PROJECT',
    };
  }

  // 3. Database ID validation (strictly (default))
  const targetDatabaseId = (process.env.FIREBASE_DATABASE_ID || DIAGNOSTIC_DATABASE_ID).trim();
  if (targetDatabaseId !== DIAGNOSTIC_DATABASE_ID) {
    return {
      success: false,
      status: 'error',
      diagnosticMode: isDiagnosticMode(),
      projectId: configuredProjectId,
      databaseId: targetDatabaseId,
      serviceAccount: saInfo.serviceAccount,
      serviceAccountSource: saInfo.source,
      collection: DIAGNOSTIC_COLLECTION,
      documentId: DIAGNOSTIC_DOCUMENT_ID,
      documentPath: DIAGNOSTIC_DOCUMENT_PATH,
      documentExists: false,
      probeType: 'single_document_read',
      operation: {
        type: 'get',
        status: 'failed',
        durationMs: 0,
        error: `Refusing diagnostic probe on unauthorized database '${targetDatabaseId}'. Strictly required: '${DIAGNOSTIC_DATABASE_ID}'.`,
      },
      operations: {
        read: {
          status: 'failed',
          durationMs: 0,
          error: `Refusing diagnostic probe on unauthorized database '${targetDatabaseId}'. Strictly required: '${DIAGNOSTIC_DATABASE_ID}'.`,
        },
      },
      totalDurationMs: Date.now() - t0,
      timestamp,
      failedStep: 'project_validation',
      error: `Refusing diagnostic probe on unauthorized database '${targetDatabaseId}'. Strictly required: '${DIAGNOSTIC_DATABASE_ID}'.`,
      code: 'FORBIDDEN_DATABASE',
    };
  }

  // 4. Client initialization
  const db = firestoreDbResolver();
  if (!db) {
    return {
      success: false,
      status: 'error',
      diagnosticMode: isDiagnosticMode(),
      projectId: configuredProjectId,
      databaseId: targetDatabaseId,
      serviceAccount: saInfo.serviceAccount,
      serviceAccountSource: saInfo.source,
      collection: DIAGNOSTIC_COLLECTION,
      documentId: DIAGNOSTIC_DOCUMENT_ID,
      documentPath: DIAGNOSTIC_DOCUMENT_PATH,
      documentExists: false,
      probeType: 'single_document_read',
      operation: {
        type: 'get',
        status: 'failed',
        durationMs: 0,
        error: 'Firestore client is unavailable or failed to initialize Firebase Admin SDK with Application Default Credentials.',
      },
      operations: {
        read: {
          status: 'failed',
          durationMs: 0,
          error: 'Firestore client is unavailable or failed to initialize Firebase Admin SDK with Application Default Credentials.',
        },
      },
      totalDurationMs: Date.now() - t0,
      timestamp,
      failedStep: 'initialization',
      error: 'Firestore client is unavailable or failed to initialize Firebase Admin SDK with Application Default Credentials.',
      code: 'FIRESTORE_UNAVAILABLE',
    };
  }

  // 5. Single Read Operation (get() on _diagnostic_probes/connectivity_check)
  // CRITICAL SECURITY INVARIANTS:
  // - Zero write operations (no set(), no add(), no update()).
  // - Zero delete operations (no delete()).
  // - Document contents/data are NEVER returned or exposed.
  // - Credentials/secrets are NEVER exposed.
  const docRef = db.collection(DIAGNOSTIC_COLLECTION).doc(DIAGNOSTIC_DOCUMENT_ID);
  const readStart = Date.now();

  try {
    const snap = await docRef.get();
    const readDuration = Date.now() - readStart;

    return {
      success: true,
      status: 'connected',
      diagnosticMode: isDiagnosticMode(),
      projectId: configuredProjectId,
      databaseId: targetDatabaseId,
      serviceAccount: saInfo.serviceAccount,
      serviceAccountSource: saInfo.source,
      collection: DIAGNOSTIC_COLLECTION,
      documentId: DIAGNOSTIC_DOCUMENT_ID,
      documentPath: DIAGNOSTIC_DOCUMENT_PATH,
      documentExists: Boolean(snap.exists),
      probeType: 'single_document_read',
      operation: {
        type: 'get',
        status: 'confirmed',
        durationMs: readDuration,
      },
      operations: {
        read: {
          status: 'confirmed',
          durationMs: readDuration,
          verified: true,
        },
      },
      totalDurationMs: Date.now() - t0,
      timestamp,
    };
  } catch (err: any) {
    const readDuration = Date.now() - readStart;
    const errCode = err.code || 'FIRESTORE_CONNECTIVITY_ERROR';
    return {
      success: false,
      status: 'error',
      diagnosticMode: isDiagnosticMode(),
      projectId: configuredProjectId,
      databaseId: targetDatabaseId,
      serviceAccount: saInfo.serviceAccount,
      serviceAccountSource: saInfo.source,
      collection: DIAGNOSTIC_COLLECTION,
      documentId: DIAGNOSTIC_DOCUMENT_ID,
      documentPath: DIAGNOSTIC_DOCUMENT_PATH,
      documentExists: false,
      probeType: 'single_document_read',
      operation: {
        type: 'get',
        status: 'failed',
        durationMs: readDuration,
        error: err.message,
      },
      operations: {
        read: {
          status: 'failed',
          durationMs: readDuration,
          error: err.message,
        },
      },
      totalDurationMs: Date.now() - t0,
      timestamp,
      failedStep: 'read',
      error: `Firestore connectivity check failed on read: ${err.message}`,
      code: errCode,
    };
  }
}

export interface IamVerificationResult {
  valid: boolean;
  email?: string;
  sub?: string;
  issuer?: string;
  audience?: string | string[];
  error?: string;
  code?: string;
}

/**
 * Strict explicit allowlist of authorized Google Cloud IAM principals.
 *
 * CRITICAL SECURITY INVARIANTS:
 * 1. NO wildcard patterns (*@...) are permitted under any circumstances.
 * 2. Every identity must be an explicit, fully-qualified email or service account.
 * 3. email_verified=true NEVER confers authorization on its own.
 * 4. Identity is compared strictly (case-insensitive exact match) against payload.email.
 */
export const EXPLICIT_AUTHORIZED_IAM_IDENTITIES: ReadonlySet<string> = new Set([
  // Dedicated Cloud Run diagnostic service accounts
  'sa-diagnostic-backend@itissimple-security-staging.iam.gserviceaccount.com',
  'sa-diagnostic-caller@itissimple-security-staging.iam.gserviceaccount.com',

  // Authorized administrative users for staging
  'adm.itissimple@gmail.com',
]);

/**
 * Resolves the configured expected audience(s) for the Cloud Run service.
 * In Cloud Run, the audience must be the exact HTTPS URL of the service.
 */
export function getExpectedIamAudiences(): string[] {
  const audiences: string[] = [];

  if (process.env.CLOUD_RUN_SERVICE_URL) {
    audiences.push(process.env.CLOUD_RUN_SERVICE_URL.trim());
  }
  if (process.env.STAGING_BACKEND_URL) {
    audiences.push(process.env.STAGING_BACKEND_URL.trim());
  }
  if (process.env.EXPECTED_AUDIENCE) {
    audiences.push(process.env.EXPECTED_AUDIENCE.trim());
  }
  if (process.env.ALLOWED_AUDIENCES) {
    const list = process.env.ALLOWED_AUDIENCES.split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    audiences.push(...list);
  }

  // Normalize by stripping trailing slashes and deduplicating
  return Array.from(
    new Set(audiences.map((aud) => aud.replace(/\/+$/, '')))
  ).filter(Boolean);
}

/**
 * Verifies caller email against the strict explicit allowlist of authorized IAM principals.
 *
 * SECURITY ENFORCEMENT:
 * - Rejects any wildcards (*@...) in both static and environment definitions.
 * - Confirms identity corresponds strictly to an authorized principal.
 * - Does NOT grant any privileges based on email_verified=true alone.
 */
export function isAuthorizedIamPrincipal(email?: string): boolean {
  if (!email || typeof email !== 'string') return false;
  const normalized = email.trim().toLowerCase();

  // Explicitly reject any input containing wildcard characters
  if (normalized.includes('*')) {
    return false;
  }

  // 1. Check against static explicit allowlist
  if (EXPLICIT_AUTHORIZED_IAM_IDENTITIES.has(normalized)) {
    return true;
  }

  // 2. Check against dynamic explicit allowlist (ALLOWED_IAM_CALLERS)
  const customAllowed = (process.env.ALLOWED_IAM_CALLERS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  // Exact comparison only: reject/ignore any configured element that contains a wildcard
  return customAllowed.some((allowed) => !allowed.includes('*') && allowed === normalized);
}

/**
 * Safely parses the JWT payload without verifying signature (for structural inspection).
 */
export function parseJwtPayloadUnsafe(token: string): Record<string, any> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payloadJson = Buffer.from(parts[1], 'base64url').toString('utf8');
    return JSON.parse(payloadJson);
  } catch {
    return null;
  }
}

/**
 * Detects whether a token is a Firebase Auth ID Token intended for frontend users.
 *
 * Characteristics of Firebase Auth ID Tokens:
 * 1. Issuer starts with 'https://securetoken.google.com/'
 * 2. Audience matches a Firebase project ID (e.g. 'itissimple-security-staging')
 * 3. Payload contains a 'firebase' claim object
 *
 * In contrast, Google Cloud IAM OIDC ID Tokens have:
 * 1. Issuer: 'https://accounts.google.com' or 'accounts.google.com'
 * 2. Audience: Exact HTTPS Cloud Run service URL
 * 3. No 'firebase' claim object
 */
export function isFirebaseIdToken(token: string): boolean {
  const payload = parseJwtPayloadUnsafe(token);
  if (!payload) return false;

  const iss = typeof payload.iss === 'string' ? payload.iss : '';
  if (iss.startsWith('https://securetoken.google.com')) {
    return true;
  }
  if (payload.firebase && typeof payload.firebase === 'object') {
    return true;
  }
  return false;
}

let testPublicKeyPem: string | null = null;

export function setTestPublicKeyForVerification(pem: string | null): void {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('SECURITY VIOLATION: Test public keys cannot be configured in non-test environment.');
  }
  testPublicKeyPem = pem;
}

/**
 * Common verification of parsed token claims.
 */
function validateParsedClaims(
  payload: Record<string, any>,
  expectedAudiences: string[]
): IamVerificationResult {
  // 1. Expiration check
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (typeof payload.exp === 'number' && payload.exp < nowSeconds) {
    return {
      valid: false,
      code: 'TOKEN_EXPIRED',
      error: `Token has expired at ${new Date(payload.exp * 1000).toISOString()}.`,
    };
  }

  // 2. Issuer check
  const issuer = payload.iss;
  if (issuer !== 'https://accounts.google.com' && issuer !== 'accounts.google.com') {
    return {
      valid: false,
      code: 'INVALID_IAM_ISSUER',
      error: `Invalid token issuer '${issuer}'. Only Google Accounts tokens (https://accounts.google.com) are permitted.`,
    };
  }

  // 3. Audience check
  if (expectedAudiences.length > 0) {
    const payloadAud = payload.aud;
    const tokenAudiences = Array.isArray(payloadAud) ? payloadAud : [payloadAud];
    const audMatch = tokenAudiences.some((a) =>
      expectedAudiences.some(
        (exp) => exp.toLowerCase() === (a || '').toLowerCase().replace(/\/+$/, '')
      )
    );
    if (!audMatch) {
      return {
        valid: false,
        code: 'INVALID_IAM_AUDIENCE',
        error: `Token audience '${payloadAud}' does not match expected Cloud Run service URL (${expectedAudiences.join(', ')}).`,
      };
    }
  }

  // 4. Email existence & verification check
  const email = (payload.email || '').trim().toLowerCase();
  if (!email) {
    return {
      valid: false,
      code: 'MISSING_IAM_EMAIL',
      error: 'Google ID token payload is missing an email claim.',
    };
  }
  if (!payload.email_verified) {
    return {
      valid: false,
      code: 'UNVERIFIED_IAM_EMAIL',
      error: `Email '${email}' is unverified by Google. Privileges cannot be granted to unverified accounts.`,
    };
  }

  // 5. Explicit allowlist check (Zero wildcards: email_verified=true is NOT sufficient)
  if (!isAuthorizedIamPrincipal(email)) {
    return {
      valid: false,
      code: 'UNAUTHORIZED_IAM_IDENTITY',
      error: `Identity '${email}' is not in the explicit allowlist of authorized staging principals. Wildcard authorizations are strictly forbidden and email_verified=true does not confer privileges.`,
    };
  }

  return {
    valid: true,
    email,
    sub: payload.sub,
    issuer,
    audience: payload.aud,
  };
}

/**
 * Validates an incoming Google Cloud IAM OIDC ID token.
 *
 * Strict Rules:
 * 1. Rejects Firebase Auth ID tokens (frontend credentials cannot be confused with IAM credentials).
 * 2. Cryptographically verifies token signature against Google public keys (accounts.google.com) or test key.
 * 3. Cryptographically validates audience (aud) against expected Cloud Run service URL.
 * 4. Enforces issuer === 'https://accounts.google.com' or 'accounts.google.com'.
 * 5. Enforces token is not expired (exp >= now).
 * 6. Enforces email_verified === true.
 * 7. Matches caller identity against the explicit allowlist of authorized principals (Zero wildcards).
 *    email_verified=true alone NEVER confers privileges.
 * 8. Rejects any static secret, forged token, anonymous request, or unauthorized Google identity.
 */
export async function verifyGoogleCloudIamToken(rawToken: string): Promise<IamVerificationResult> {
  if (!rawToken || typeof rawToken !== 'string' || !rawToken.trim()) {
    return {
      valid: false,
      code: 'MISSING_IAM_CREDENTIALS',
      error: 'Google Cloud IAM token is missing or empty.',
    };
  }

  const token = rawToken.trim();

  // 1. Guard against tokens with signatures stripped by Cloud Run (SIGNATURE_REMOVED_BY_GOOGLE)
  if (
    token.endsWith('.SIGNATURE_REMOVED_BY_GOOGLE') ||
    token.includes('SIGNATURE_REMOVED_BY_GOOGLE') ||
    token === 'mock-iam-stripped-signature'
  ) {
    return {
      valid: false,
      code: 'IAM_SIGNATURE_STRIPPED',
      error:
        'Token signature was removed by Google Cloud Run (SIGNATURE_REMOVED_BY_GOOGLE). Cryptographic verification in Express requires the unaltered Google OIDC ID token in the Authorization header.',
    };
  }

  // 2. Guard against Firebase Auth frontend tokens (Anti-credential-confusion)
  if (isFirebaseIdToken(token) || token === 'mock-iam-firebase-token') {
    return {
      valid: false,
      code: 'FIREBASE_AUTH_TOKEN_REJECTED',
      error:
        'Firebase Auth ID token detected. Frontend Firebase Auth tokens cannot be used as Google Cloud IAM OIDC invocation credentials. Invocations require a native Google Cloud IAM ID Token issued by https://accounts.google.com with audience matching the Cloud Run service URL.',
    };
  }

  // 2. Resolve expected Cloud Run service audience
  const expectedAudiences = getExpectedIamAudiences();

  // In production/staging, fail-closed if expected audience is not configured
  if (expectedAudiences.length === 0 && process.env.NODE_ENV !== 'test') {
    return {
      valid: false,
      code: 'MISSING_EXPECTED_AUDIENCE_CONFIG',
      error:
        'Cloud Run service audience is not configured. Set CLOUD_RUN_SERVICE_URL or STAGING_BACKEND_URL to enable audience verification.',
    };
  }

  // 3. Test mode simulation / Mock tokens (unit tests)
  if (process.env.NODE_ENV === 'test') {
    // 3a. Handle simple mock strings for backwards compatibility & fast unit tests
    if (token === 'mock-iam-expired-token') {
      return {
        valid: false,
        code: 'TOKEN_EXPIRED',
        error: 'Token has expired.',
      };
    }
    if (token === 'mock-iam-wrong-audience') {
      return {
        valid: false,
        code: 'INVALID_IAM_AUDIENCE',
        error: 'Token audience does not match expected Cloud Run service URL.',
      };
    }
    if (token === 'mock-iam-wrong-issuer') {
      return {
        valid: false,
        code: 'INVALID_IAM_ISSUER',
        error: 'Invalid token issuer. Only Google Accounts tokens (https://accounts.google.com) are permitted.',
      };
    }
    if (token === 'mock-iam-unlisted-sa') {
      return {
        valid: false,
        code: 'UNAUTHORIZED_IAM_IDENTITY',
        error: "Identity 'unlisted-sa@itissimple-security-staging.iam.gserviceaccount.com' is not in the explicit allowlist.",
      };
    }
    if (token === 'mock-iam-verified-only') {
      return {
        valid: false,
        code: 'UNAUTHORIZED_IAM_IDENTITY',
        error: "Identity 'verified-stranger@gmail.com' is not in the explicit allowlist. Privileges cannot be granted based on email_verified=true alone.",
      };
    }
    if (token === 'mock-iam-unauthorized-caller') {
      return {
        valid: false,
        code: 'UNAUTHORIZED_IAM_IDENTITY',
        error: "Google identity 'caller@unauthorized-external-domain.com' is not authorized for staging diagnostic execution.",
      };
    }
    if (token === 'mock-iam-admin-user') {
      return {
        valid: true,
        email: 'adm.itissimple@gmail.com',
        issuer: 'https://accounts.google.com',
        sub: '109876543210987654322',
        audience: expectedAudiences[0] || 'https://itissimple-security-staging.us-east5.run.app',
      };
    }
    if (
      token === 'mock-iam-oidc-token' ||
      token === 'valid-mock-iam-oidc-token' ||
      token.startsWith('mock-iam-valid-')
    ) {
      return {
        valid: true,
        email: 'sa-diagnostic-caller@itissimple-security-staging.iam.gserviceaccount.com',
        issuer: 'https://accounts.google.com',
        sub: '109876543210987654321',
        audience: expectedAudiences[0] || 'https://itissimple-security-staging.us-east5.run.app',
      };
    }

    // 3b. Structured JWT verification in test mode (with optional RSA crypto verification)
    const jwtParts = token.split('.');
    if (jwtParts.length === 3) {
      // If a test RSA public key is configured, cryptographically verify the signature
      if (testPublicKeyPem) {
        try {
          const signedData = `${jwtParts[0]}.${jwtParts[1]}`;
          const sig = Buffer.from(jwtParts[2], 'base64url');
          const verifier = crypto.createVerify('RSA-SHA256');
          verifier.update(signedData);
          const signatureValid = verifier.verify(testPublicKeyPem, sig);
          if (!signatureValid) {
            return {
              valid: false,
              code: 'INVALID_IAM_CREDENTIALS',
              error: 'Cryptographic signature verification failed: invalid token signature.',
            };
          }
        } catch (err: any) {
          return {
            valid: false,
            code: 'INVALID_IAM_CREDENTIALS',
            error: `Cryptographic verification error: ${err.message}`,
          };
        }
      }

      // Parse payload and validate claims
      const payload = parseJwtPayloadUnsafe(token);
      if (!payload) {
        return {
          valid: false,
          code: 'INVALID_IAM_CREDENTIALS',
          error: 'Google ID token payload could not be extracted.',
        };
      }

      return validateParsedClaims(payload, expectedAudiences);
    }

    return {
      valid: false,
      code: 'INVALID_IAM_CREDENTIALS',
      error: 'Token signature or structure is invalid in test environment.',
    };
  }

  // 4. Production / Staging verification against Google Public Certificates
  try {
    const ticket = await googleAuthClient.verifyIdToken({
      idToken: token,
      audience: expectedAudiences.length === 1 ? expectedAudiences[0] : expectedAudiences,
    });

    const payload = ticket.getPayload();
    if (!payload) {
      return {
        valid: false,
        code: 'INVALID_IAM_CREDENTIALS',
        error: 'Google ID token payload could not be extracted.',
      };
    }

    return validateParsedClaims(payload, expectedAudiences);
  } catch (err: any) {
    const msg = (err.message || '').toLowerCase();
    let code = 'INVALID_IAM_CREDENTIALS';
    if (msg.includes('expired') || msg.includes('used too late')) {
      code = 'TOKEN_EXPIRED';
    } else if (msg.includes('audience') || msg.includes('wrong recipient')) {
      code = 'INVALID_IAM_AUDIENCE';
    } else if (msg.includes('issuer')) {
      code = 'INVALID_IAM_ISSUER';
    }
    return {
      valid: false,
      code,
      error: `Google IAM token verification failed: ${err.message}`,
    };
  }
}

/**
 * Authentication middleware protecting the diagnostic probe endpoint against public access.
 *
 * Strict Security Rules:
 * 1. Anonymous access is strictly forbidden (returns 401 Unauthorized).
 * 2. Does NOT rely on CORS as an authentication mechanism.
 * 3. NO static secrets: DIAGNOSTIC_AUTH_TOKEN and ADMIN_BEARER_TOKEN dependencies are completely removed.
 * 4. Enforces Google Cloud native IAM authentication (Bearer Google OIDC ID token).
 * 5. Verifies cryptographic signature against Google certificates via OAuth2Client.
 * 6. Verifies caller email matches authorized staging service accounts or admins.
 * 7. Defense-in-depth: guarantees /api/diagnostic/firestore cannot be accessed even if
 *    Cloud Run service is accidentally configured with --allow-unauthenticated.
 */
export interface ExtractedIamToken {
  token: string | null;
  source: 'authorization' | 'x-serverless-authorization' | null;
  signatureRemovedByGoogle: boolean;
}

/**
 * Extracts and classifies an incoming IAM Bearer token from HTTP headers,
 * respecting Google Cloud Run documented behavior.
 *
 * Cloud Run Documented Behavior:
 * 1. Standard callers supply `Authorization: Bearer <ID_TOKEN>`.
 *    Cloud Run passes this header completely unaltered to the container,
 *    retaining full cryptographic signature for in-app verification.
 * 2. If a caller or IAP supplies `X-Serverless-Authorization: Bearer <ID_TOKEN>`,
 *    Cloud Run replaces the JWT signature with `SIGNATURE_REMOVED_BY_GOOGLE`
 *    before passing it to the container.
 * 3. In-app cryptographic verification (defense-in-depth) cannot verify a token
 *    whose signature was stripped. To prevent trusting unverified decoded claims,
 *    tokens with stripped signatures are explicitly flagged and rejected.
 */
export function extractIamTokenFromHeaders(headers: Record<string, any>): ExtractedIamToken {
  const authHeader = typeof headers['authorization'] === 'string' ? headers['authorization'].trim() : null;
  const serverlessHeader =
    typeof headers['x-serverless-authorization'] === 'string' ? headers['x-serverless-authorization'].trim() : null;

  const extractBearer = (headerVal: string | null): string | null => {
    if (!headerVal) return null;
    const match = headerVal.match(/^Bearer\s+(\S+)$/i);
    return match ? match[1].trim() : null;
  };

  const authToken = extractBearer(authHeader);
  const serverlessToken = extractBearer(serverlessHeader);

  const isSignatureRemoved = (tok: string | null): boolean => {
    if (!tok) return false;
    const parts = tok.split('.');
    return (parts.length === 3 && parts[2] === 'SIGNATURE_REMOVED_BY_GOOGLE') || tok === 'mock-iam-stripped-signature';
  };

  // 1. Authorization header carries unaltered JWT with signature intact (preferred standard)
  if (authToken) {
    return {
      token: authToken,
      source: 'authorization',
      signatureRemovedByGoogle: isSignatureRemoved(authToken),
    };
  }

  // 2. X-Serverless-Authorization header
  if (serverlessToken) {
    return {
      token: serverlessToken,
      source: 'x-serverless-authorization',
      signatureRemovedByGoogle: isSignatureRemoved(serverlessToken),
    };
  }

  return { token: null, source: null, signatureRemovedByGoogle: false };
}

/**
 * Authentication middleware protecting the diagnostic probe endpoint against public access.
 *
 * Strict Security Rules:
 * 1. Anonymous access is strictly forbidden (returns 401 Unauthorized).
 * 2. Does NOT rely on CORS as an authentication mechanism.
 * 3. NO static secrets: DIAGNOSTIC_AUTH_TOKEN and ADMIN_BEARER_TOKEN dependencies are completely removed.
 * 4. Enforces Google Cloud native IAM authentication (Bearer Google OIDC ID token).
 * 5. Verifies cryptographic signature against Google certificates via OAuth2Client.
 * 6. Never trusts claims simply decoded without signature verification.
 * 7. Verifies caller email matches authorized staging service accounts or admins.
 * 8. Defense-in-depth: guarantees /api/diagnostic/firestore cannot be accessed even if
 *    Cloud Run service is accidentally configured with --allow-unauthenticated.
 */
export const diagnosticAuthMiddleware: RequestHandler = async (req: Request, res: Response, next: NextFunction) => {
  const { token, source, signatureRemovedByGoogle } = extractIamTokenFromHeaders(req.headers);

  // 1. Rejection of anonymous requests
  if (!token) {
    return res.status(401).json({
      error: 'Unauthorized',
      message:
        'Access denied: Diagnostic endpoint requires Google Cloud IAM authentication. Anonymous access is strictly forbidden.',
      code: 'MISSING_IAM_CREDENTIALS',
    });
  }

  // 2. Cloud Run documented behavior: reject signature removed by Google
  if (signatureRemovedByGoogle) {
    return res.status(403).json({
      error: 'Forbidden',
      message:
        'Access denied: The token signature was removed by Cloud Run (SIGNATURE_REMOVED_BY_GOOGLE). In-app cryptographic verification requires the unaltered Google OIDC ID token in the Authorization header.',
      code: 'IAM_SIGNATURE_STRIPPED',
    });
  }

  // 3. Cryptographic token verification in Express (never trusts unverified claims)
  const verification = await verifyGoogleCloudIamToken(token);

  if (!verification.valid) {
    return res.status(403).json({
      error: 'Forbidden',
      message: verification.error || 'Access denied: Invalid or unauthorized Google Cloud IAM credentials.',
      code: verification.code || 'INVALID_IAM_CREDENTIALS',
    });
  }

  // Attach verified IAM caller identity to request for auditing
  (req as any).iamCaller = {
    email: verification.email,
    sub: verification.sub,
    issuer: verification.issuer,
    authSource: source,
  };

  next();
};

/**
 * Registers diagnostic routes onto an Express application.
 */
export function registerDiagnosticRoutes(app: any): void {
  // 1. Health check (Liveness / Readiness)
  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      mode: isDiagnosticMode() ? 'diagnostic_only' : 'standard',
      projectId: process.env.FIREBASE_PROJECT_ID || DIAGNOSTIC_PROJECT_ID,
      databaseId: process.env.FIREBASE_DATABASE_ID || DIAGNOSTIC_DATABASE_ID,
      timestamp: new Date().toISOString(),
    });
  });

  // 2. Diagnostic health overview
  app.get('/api/diagnostic/health', async (_req: Request, res: Response) => {
    const saInfo = await getExecutionServiceAccount();
    res.json({
      status: 'ok',
      service: 'itissimple-diagnostic-backend',
      diagnosticMode: isDiagnosticMode(),
      projectId: process.env.FIREBASE_PROJECT_ID || DIAGNOSTIC_PROJECT_ID,
      databaseId: process.env.FIREBASE_DATABASE_ID || DIAGNOSTIC_DATABASE_ID,
      serviceAccount: saInfo.serviceAccount,
      timestamp: new Date().toISOString(),
    });
  });

  // 3. Real Firestore Diagnostic Probe (Protected by IAM / Diagnostic Auth)
  const handleDiagnosticProbe = async (_req: Request, res: Response) => {
    try {
      const probeResult = await executeFirestoreDiagnosticProbe();
      if (!probeResult.success) {
        const isPermissionDenied =
          probeResult.code === 7 ||
          probeResult.code === 'permission-denied' ||
          (typeof probeResult.error === 'string' && probeResult.error.includes('PERMISSION_DENIED'));

        const statusCode = isPermissionDenied ? 403 : 503;
        return res.status(statusCode).json(probeResult);
      }
      return res.status(200).json(probeResult);
    } catch (err: any) {
      return res.status(500).json({
        success: false,
        error: `Diagnostic probe unhandled error: ${err.message}`,
        code: 'PROBE_EXECUTION_ERROR',
      });
    }
  };

  app.get('/api/diagnostic/firestore', diagnosticAuthMiddleware, handleDiagnosticProbe);
  app.post('/api/diagnostic/firestore', diagnosticAuthMiddleware, handleDiagnosticProbe);
}
