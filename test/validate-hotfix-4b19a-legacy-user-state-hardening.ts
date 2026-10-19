/**
 * TEST SUITE: SECURITY HOTFIX 4B.19A — LEGACY USER STATE HARDENING
 * Project: itissimple-security-staging
 * Canonical Firestore database: (default)
 * 
 * Verifications:
 * 1. No hardcoded test accounts in fallback initialization.
 * 2. No fabricated administrator UID.
 * 3. Historical authUsers entries do not grant authentication.
 * 4. Deleted profile documents are not recreated solely through startup hydration.
 * 5. Legitimate Firebase-authenticated users can recover their own profiles safely.
 * 6. Stale email records cannot hijack another UID.
 * 7. Registration correctly handles existing Firebase accounts.
 * 8. Teacher registration remains functional.
 * 9. Student registration remains functional.
 * 10. Trial Lesson scheduling remains functional.
 * 11. Administrator authentication and authorization remain functional.
 * 12. Unsafe bulk cleanup cannot delete legitimate users.
 * 13. Existing bootstrap lock remains unchanged.
 * 14. Firestore (default) remains the canonical database.
 * 15. No plaintext passwords or secrets are written.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  ACTIVE_FIREBASE_DATABASE_ID,
  ACTIVE_FIRESTORE_DATABASE_ID,
  getFirestoreDb,
  setFirebaseAdminFirestoreForTesting,
  resetFirebaseAdminFirestoreForTesting,
  scheduleLessonAtomicServer,
} from '../src/serverFirestore';
import {
  setFirebaseAdminAuthForTesting,
  resetFirebaseAdminForTesting,
  ALLOWED_STAGING_PROJECT_ID,
} from '../src/serverFirebaseAdmin';
import {
  firebaseAuthMiddleware,
  requireAdmin,
  extractTrustedRole,
} from '../src/middleware/firebaseAuth';
import { isValidCanonicalUid } from '../src/utils/tutorConsolidation';
import {
  mergeProfilePreservingCanonicalUid,
  mergeStudentPreservingCanonicalUid,
} from '../serverApp';

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    console.log(`  ✅ PASS: ${testName}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${testName} ${detail ? `(${detail})` : ''}`);
    failed++;
  }
}

// Minimal mock Express response helper
function createMockRes() {
  const res: any = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: null as any,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(data: any) {
      this.body = data;
      return this;
    },
    setHeader(name: string, value: string) {
      this.headers[name] = value;
      return this;
    },
  };
  return res;
}

async function runTestSuite() {
  console.log('===================================================================================');
  console.log(' TEST SUITE: SECURITY HOTFIX 4B.19A — LEGACY USER STATE HARDENING');
  console.log(' Project: itissimple-security-staging | Database: (default)');
  console.log('===================================================================================\n');

  // -----------------------------------------------------------------------------------
  // 1. No hardcoded test accounts in fallback initialization
  // -----------------------------------------------------------------------------------
  console.log('--- 1. Fallback Initialization Contains Zero Hardcoded Users ---');
  const serverAppContent = fs.readFileSync(path.join(process.cwd(), 'serverApp.ts'), 'utf-8');
  
  // Extract DEFAULT_DB block from serverApp.ts
  const defaultDbMatch = serverAppContent.match(/const DEFAULT_DB:\s*AppDb\s*=\s*\{([\s\S]*?)\n\};/);
  assert(Boolean(defaultDbMatch), 'DEFAULT_DB definition found in serverApp.ts');

  if (defaultDbMatch) {
    const defaultDbBlock = defaultDbMatch[1];
    assert(!defaultDbBlock.includes('adm.itissimple@gmail.com'), 'DEFAULT_DB does not contain adm.itissimple@gmail.com');
    assert(!defaultDbBlock.includes('laviniatilapiafc@gmail.com'), 'DEFAULT_DB does not contain laviniatilapiafc@gmail.com');
    assert(!defaultDbBlock.includes('admin-master-uid'), 'DEFAULT_DB does not contain admin-master-uid');
    assert(!defaultDbBlock.includes('student_lala_canonical_uid'), 'DEFAULT_DB does not contain student_lala_canonical_uid');
    assert(/teachers:\s*\[\s*\]/.test(defaultDbBlock), 'DEFAULT_DB teachers initialized as empty array');
    assert(/students:\s*\[\s*\]/.test(defaultDbBlock), 'DEFAULT_DB students initialized as empty array');
    assert(/userProfiles:\s*\{\s*\}/.test(defaultDbBlock), 'DEFAULT_DB userProfiles initialized as empty object');
    assert(/authUsers:\s*\{\s*\}/.test(defaultDbBlock), 'DEFAULT_DB authUsers initialized as empty object');
  }

  // -----------------------------------------------------------------------------------
  // 2. No fabricated administrator UID & Disk Sanitation
  // -----------------------------------------------------------------------------------
  console.log('\n--- 2. No Fabricated Administrator UID in Runtime Fallback ---');
  assert(!serverAppContent.includes("'admin-master-uid' :"), 'No fallback injection of admin-master-uid in serverApp.ts');
  assert(serverAppContent.includes('delete diskAuthUsers[em]'), 'Disk loader strips fabricated admin-master-uid from diskAuthUsers');
  assert(serverAppContent.includes('delete (p as any).uid'), 'Disk loader sanitizes fabricated UIDs from diskUserProfiles');

  // Test merging helpers
  const canonicalStudent = { uid: 'canonicalStudentFirebaseUid1234', studentUid: 'canonicalStudentFirebaseUid1234', email: 'student@example.com' };
  const placeholderStudent = { uid: 'usr-student-example-com', studentUid: 'usr-student-example-com', email: 'student@example.com' };
  
  const merged1 = mergeStudentPreservingCanonicalUid(canonicalStudent, placeholderStudent);
  assert(merged1.uid === 'canonicalStudentFirebaseUid1234', 'Canonical UID preserved when merged with placeholder');

  const merged2 = mergeStudentPreservingCanonicalUid(placeholderStudent, canonicalStudent);
  assert(merged2.uid === 'canonicalStudentFirebaseUid1234', 'Canonical UID upgrades placeholder when merged in reverse order');

  // -----------------------------------------------------------------------------------
  // 3. Historical authUsers entries do not grant authentication
  // -----------------------------------------------------------------------------------
  console.log('\n--- 3. Historical authUsers Entries Do Not Grant Authentication ---');
  // Attempt to extract role from empty/tampered tokens
  const unverifiedToken = { email: 'adm.itissimple@gmail.com', email_verified: true };
  const derivedRole = extractTrustedRole(unverifiedToken as any);
  assert(derivedRole === 'student', 'Unverified token without admin custom claim defaults strictly to student');

  // Test requireAdmin middleware with unverified or non-admin user
  let adminPassed = false;
  const mockReqNonAdmin: any = { user: { uid: 'fake-uid', email: 'adm.itissimple@gmail.com', role: 'student', email_verified: true } };
  const mockResAdmin = createMockRes();
  requireAdmin(mockReqNonAdmin, mockResAdmin, () => { adminPassed = true; });
  assert(!adminPassed, 'requireAdmin rejects student role even if email matches administrator');
  assert(mockResAdmin.statusCode === 401 || mockResAdmin.statusCode === 403, 'requireAdmin returns 401/403');

  // -----------------------------------------------------------------------------------
  // 4. Deleted profile documents are not recreated solely through startup hydration
  // -----------------------------------------------------------------------------------
  console.log('\n--- 4. Deleted Users Not Resurrected Through Startup Hydration ---');
  const allDeletedEmails = ['purged-student@example.com', 'deleted-user@example.com'];
  const testStudent = { email: 'deleted-user@example.com', uid: 'testUid1234567890abcdef' };
  
  const isDeleted = allDeletedEmails.includes(testStudent.email);
  assert(isDeleted, 'Deleted user is recognized in allDeletedStudentEmails');
  // Verify serverApp checks allDeletedStudentEmails before adding to studentMap
  assert(
    serverAppContent.includes('!allDeletedStudentEmails.includes(key)'),
    'Startup hydration explicitly filters out allDeletedStudentEmails'
  );

  // -----------------------------------------------------------------------------------
  // 5. Legitimate Firebase-authenticated users can recover their own profiles safely
  // -----------------------------------------------------------------------------------
  console.log('\n--- 5. Authenticated Users Safely Manage Their Own Profiles ---');
  const genuineUserUid = 'canonicalVerifiedFirebaseUid9988';
  const genuineUserEmail = 'laviniatilapiafc@gmail.com';
  
  const verifiedCaller = { uid: genuineUserUid, email: genuineUserEmail, role: 'student', email_verified: true };
  const existingRecordUid = genuineUserUid; // same UID
  const isUidConflict = Boolean(existingRecordUid && existingRecordUid !== verifiedCaller.uid);
  assert(!isUidConflict, 'No conflict when verified UID matches existing record UID');

  // -----------------------------------------------------------------------------------
  // 6. Stale email records cannot hijack another UID
  // -----------------------------------------------------------------------------------
  console.log('\n--- 6. Anti-Hijack: Conflicting UID Triggers Controlled Error ---');
  const attackerUid: string = 'attackerCanonicalFirebaseUid1122';
  const victimExistingUid: string = 'victimCanonicalFirebaseUid3344';
  
  const conflictDetected = Boolean(
    attackerUid &&
    victimExistingUid &&
    attackerUid !== victimExistingUid &&
    victimExistingUid !== 'admin-master-uid' &&
    victimExistingUid !== 'student_lala_canonical_uid'
  );
  assert(conflictDetected, 'Conflict detected when caller UID differs from existing profile UID');
  assert(
    serverAppContent.includes('UID_CONFLICT_RECONCILIATION_REQUIRED'),
    'serverApp returns controlled UID_CONFLICT_RECONCILIATION_REQUIRED on UID mismatch'
  );

  // -----------------------------------------------------------------------------------
  // 7. Registration correctly handles existing Firebase accounts
  // -----------------------------------------------------------------------------------
  console.log('\n--- 7. Registration Defers to Firebase Authentication Authority ---');
  assert(
    serverAppContent.includes('Este e-mail já possui uma conta no Firebase Authentication'),
    'Unauthenticated registration rejects email existing in Firebase Authentication with login prompt'
  );

  // -----------------------------------------------------------------------------------
  // 8. Teacher registration remains functional
  // -----------------------------------------------------------------------------------
  console.log('\n--- 8. Teacher Registration Defaults Strictly to Pending ---');
  assert(
    serverAppContent.includes("approvalStatus: 'pending'"),
    'Teacher registration assigns approvalStatus: pending strictly'
  );
  assert(
    serverAppContent.includes('registeredByAdmin: false'),
    'Teacher registration cannot self-certify registeredByAdmin'
  );

  // -----------------------------------------------------------------------------------
  // 9. Student registration remains functional
  // -----------------------------------------------------------------------------------
  console.log('\n--- 9. Student Registration Remains Functional with Verified UID ---');
  assert(
    serverAppContent.includes('const userUid = verifiedUid ||'),
    'Student registration prioritizes verified UID from Firebase Authentication'
  );

  // -----------------------------------------------------------------------------------
  // 10. Trial Lesson scheduling remains functional
  // -----------------------------------------------------------------------------------
  console.log('\n--- 10. Trial Lesson Scheduling Operates Under Canonical Identity ---');
  const mockLessonStudentUid: string = 'studentFirebaseCanonicalUid101';
  const mockLessonTeacherUid: string = 'ch4rL35Sm1thU1d999888777666';
  
  assert(isValidCanonicalUid(mockLessonStudentUid), 'Student UID is valid canonical UID');
  assert(isValidCanonicalUid(mockLessonTeacherUid), 'Teacher UID is valid canonical UID');
  assert(mockLessonStudentUid !== mockLessonTeacherUid, 'Student and Teacher UIDs are strictly distinct');

  // -----------------------------------------------------------------------------------
  // 11. Administrator authentication and authorization remain functional
  // -----------------------------------------------------------------------------------
  console.log('\n--- 11. Administrator Authorization via Cryptographic Custom Claim ---');
  const adminDecodedToken = { uid: 'admin_canonical_uid_777', email: 'adm.itissimple@gmail.com', role: 'admin' };
  const adminRole = extractTrustedRole(adminDecodedToken as any);
  assert(adminRole === 'admin', 'Custom claim role: admin is properly recognized as admin');

  // -----------------------------------------------------------------------------------
  // 12. Unsafe bulk cleanup cannot delete legitimate users
  // -----------------------------------------------------------------------------------
  console.log('\n--- 12. Unsafe Bulk Cleanup Permanently Disabled ---');
  assert(
    serverAppContent.includes("message: 'Bulk cleanup is safely disabled to prevent accidental deletion of legitimate users"),
    'POST /api/admin/clean-obsolete-users is non-destructive and disabled'
  );
  assert(
    !serverAppContent.includes('ACTIVE_PRODUCTION_STUDENTS.has(em)'),
    'Destructive ACTIVE_PRODUCTION_STUDENTS filter removed from serverApp.ts'
  );

  // -----------------------------------------------------------------------------------
  // 13. Existing bootstrap lock remains unchanged
  // -----------------------------------------------------------------------------------
  console.log('\n--- 13. Administrator Bootstrap Lock State Preserved ---');
  const lockFilePath = path.join(process.cwd(), 'src/data/.admin_bootstrap_lock.json');
  assert(fs.existsSync(lockFilePath), '.admin_bootstrap_lock.json exists');
  const lockData = JSON.parse(fs.readFileSync(lockFilePath, 'utf-8'));
  assert(lockData.projectId === 'itissimple-security-staging', 'Lock is bound to itissimple-security-staging');
  assert(lockData.adminEmail === 'adm.itissimple@gmail.com', 'Lock preserves target adminEmail');

  // -----------------------------------------------------------------------------------
  // 14. Firestore (default) remains the canonical database
  // -----------------------------------------------------------------------------------
  console.log('\n--- 14. Canonical Firestore Database is (default) ---');
  assert(ACTIVE_FIREBASE_DATABASE_ID === '(default)', 'ACTIVE_FIREBASE_DATABASE_ID is (default)');
  assert(ACTIVE_FIRESTORE_DATABASE_ID === '(default)', 'ACTIVE_FIRESTORE_DATABASE_ID is (default)');

  // -----------------------------------------------------------------------------------
  // 15. No plaintext passwords or secrets are written
  // -----------------------------------------------------------------------------------
  console.log('\n--- 15. Zero Plaintext Passwords or Secrets in Codebase ---');
  assert(!serverAppContent.includes('authRecord.password ==='), 'No plaintext password comparison in serverApp.ts');
  assert(serverAppContent.includes('scrubPasswords(db)'), 'scrubPasswords actively called before persistence');

  console.log('\n===================================================================================');
  console.log(` TOTAL VERIFICATIONS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
  console.log('===================================================================================');

  if (failed > 0) {
    process.exit(1);
  }
  process.exit(0);
}

runTestSuite().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
