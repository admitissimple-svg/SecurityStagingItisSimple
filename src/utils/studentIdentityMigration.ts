/**
 * CANONICAL STUDENT IDENTITY RESOLUTION MODULE
 * Projeto exclusivo: itissimple-security-staging
 * Referência: FASE 4B.14A
 *
 * Directives:
 * 1. Exclusive canonical identity: Firebase Authentication UID.
 * 2. Absolute prohibition of synthetic identifiers (usr-*, st-*, student-*, etc.).
 * 3. Absolute prohibition of deriving Firestore paths from student email or name.
 * 4. Safe failure: If identity is unavailable or ambiguous, abort operation cleanly.
 * 5. Read-only legacy compatibility: Legacy documents may be read, but NEVER written to.
 */

import { isValidCanonicalUid } from './tutorConsolidation';

export { isValidCanonicalUid };

/**
 * Checks whether an identifier is an email address, synthetic ID, or invalid placeholder.
 */
export function isEmailOrSyntheticIdentifier(id?: string | null): boolean {
  if (!id || typeof id !== 'string') return true;
  const clean = id.trim().toLowerCase();
  if (!clean || clean === 'undefined' || clean === 'null') return true;
  if (clean.includes('@') || clean.includes('.')) return true;
  if (
    clean.startsWith('usr-') ||
    clean.startsWith('st-') ||
    clean.startsWith('tutor-') ||
    clean.startsWith('teacher-') ||
    clean.startsWith('google-') ||
    clean.startsWith('student-') ||
    clean === 'user-default' ||
    clean === 'user_default' ||
    clean === 'anonymous_student' ||
    clean === 'anonymous'
  ) {
    return true;
  }
  return false;
}

/**
 * Validates that an identifier is strictly a canonical student Firebase Auth UID.
 */
export function isValidCanonicalStudentUid(uid?: string | null): boolean {
  if (!uid || typeof uid !== 'string') return false;
  if (isEmailOrSyntheticIdentifier(uid)) return false;
  return isValidCanonicalUid(uid);
}

/**
 * Safely resolves a canonical student UID without ever generating artificial fallback IDs.
 * If the input is not a valid canonical UID, returns empty string ('').
 */
export function sanitizeCanonicalStudentUid(uid?: string | null): string {
  if (!uid || typeof uid !== 'string') return '';
  const clean = uid.trim();
  return isValidCanonicalStudentUid(clean) ? clean : '';
}

/**
 * Strictly ensures that a Firestore path targets a canonical student UID.
 * Throws an error or returns false if a non-canonical path is attempted.
 */
export function assertCanonicalStudentPath(path: string): boolean {
  const parts = path.split('/').filter(Boolean);
  if (parts.length >= 2 && parts[0] === 'users') {
    const docId = parts[1];
    if (!isValidCanonicalStudentUid(docId)) {
      throw new Error(
        `[Security Violation] Attempted write to non-canonical user path: users/${docId}. Operations must strictly target users/{canonicalAuthUid}.`
      );
    }
  }
  return true;
}
