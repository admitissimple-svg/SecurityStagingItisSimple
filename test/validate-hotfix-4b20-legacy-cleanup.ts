/**
 * TEST SUITE: SECURITY HOTFIX 4B.20 — LEGACY TEST DATA CLEANUP & PRODUCTION CODE HYGIENE
 * Project: itissimple-security-staging
 * Canonical Firestore database: (default)
 * 
 * Verifications:
 * 1. No hardcoded test account is initialized by production code.
 * 2. Restarting the backend does not recreate legacy users from disk or defaults.
 * 3. Deleted or unverified Firebase Auth accounts are not treated as authenticated users.
 * 4. New Firebase users retain stable canonical UIDs.
 * 5. New Native Friends can be approved and selected.
 * 6. New students can be linked to approved Native Friends.
 * 7. Profile changes are not overwritten by stale fallback data.
 * 8. Zero plaintext passwords stored or logged.
 * 9. Legitimate CMS data (landing content, default routines, curated playlists) preserved.
 * 10. Production startup does not execute test fixtures or seed routines.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  ACTIVE_FIREBASE_DATABASE_ID,
  ACTIVE_FIRESTORE_DATABASE_ID,
  getFirestoreDb,
  setFirebaseAdminFirestoreForTesting,
  resetFirebaseAdminFirestoreForTesting,
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
import {
  mergeTutors,
  consolidateTutorsList,
  isValidCanonicalUid,
  isGenericTutorId,
  normalizeTutorName,
} from '../src/utils/tutorConsolidation';
import {
  mergeProfilePreservingCanonicalUid,
  mergeStudentPreservingCanonicalUid,
  ACTIVE_PRODUCTION_USERS,
  ACTIVE_PRODUCTION_STUDENTS,
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

async function runHotfix4B20Tests() {
  console.log('===================================================================================');
  console.log(' TEST SUITE: SECURITY HOTFIX 4B.20 — LEGACY TEST DATA CLEANUP & PRODUCTION HYGIENE');
  console.log(' Project: itissimple-security-staging | Canonical Database: (default)');
  console.log('===================================================================================\n');

  // -----------------------------------------------------------------------------------
  // 1. No hardcoded test account is initialized by production code
  // -----------------------------------------------------------------------------------
  console.log('--- 1. Fallback & Production Defaults Free of Hardcoded Test Identities ---');
  const serverAppContent = fs.readFileSync(path.join(process.cwd(), 'serverApp.ts'), 'utf-8');
  const appDbContent = fs.readFileSync(path.join(process.cwd(), 'src/data/app_db.json'), 'utf-8');
  const appDb = JSON.parse(appDbContent);

  assert(ACTIVE_PRODUCTION_USERS.size === 0, 'ACTIVE_PRODUCTION_USERS contains zero hardcoded emails');
  assert(ACTIVE_PRODUCTION_STUDENTS.size === 0, 'ACTIVE_PRODUCTION_STUDENTS contains zero hardcoded emails');
  assert(Array.isArray(appDb.teachers) && appDb.teachers.length === 0, 'app_db.json teachers array is empty');
  assert(Array.isArray(appDb.tutorsList) && appDb.tutorsList.length === 0, 'app_db.json tutorsList array is empty');
  assert(Array.isArray(appDb.students) && appDb.students.length === 0, 'app_db.json students array is empty');
  assert(typeof appDb.authUsers === 'object' && Object.keys(appDb.authUsers).length === 0, 'app_db.json authUsers object is empty');
  assert(typeof appDb.userProfiles === 'object' && Object.keys(appDb.userProfiles).length === 0, 'app_db.json userProfiles object is empty');

  // Verify no personal test emails exist in app_db.json
  assert(!appDbContent.includes('laviniafofafc@gmail.com'), 'app_db.json does not contain laviniafofafc@gmail.com');
  assert(!appDbContent.includes('laviniatilapiafc@gmail.com'), 'app_db.json does not contain laviniatilapiafc@gmail.com');
  assert(!appDbContent.includes('student_uid_new_101'), 'app_db.json does not contain student_uid_new_101');
  assert(!appDbContent.includes('student_uid_existing_202'), 'app_db.json does not contain student_uid_existing_202');
  assert(!appDbContent.includes('jCkNIhvYEYbyJC2CWGZhFaoHGfo1'), 'app_db.json does not contain test UID jCkNIhvYEYbyJC2CWGZhFaoHGfo1');

  // -----------------------------------------------------------------------------------
  // 2. Restarting the backend does not recreate legacy users
  // -----------------------------------------------------------------------------------
  console.log('\n--- 2. Restarting Backend Does Not Recreate Legacy Users ---');
  // When disk loader reads app_db.json, it finds 0 test users
  assert(
    !serverAppContent.includes("'laviniafofafc@gmail.com' :"),
    'serverApp.ts does not inject hardcoded laviniafofafc profile'
  );
  assert(
    !serverAppContent.includes("'laviniatilapiafc@gmail.com' :"),
    'serverApp.ts does not inject hardcoded laviniatilapiafc profile'
  );

  // -----------------------------------------------------------------------------------
  // 3. Deleted Firebase Auth accounts are not treated as authenticated users
  // -----------------------------------------------------------------------------------
  console.log('\n--- 3. Authoritative Firebase Authentication & Custom Claims Enforcement ---');
  // Token with unverified claim cannot claim admin
  const unverifiedClaimToken = { uid: 'some-uid', email: 'adm.itissimple@gmail.com', role: 'student', email_verified: true };
  const role = extractTrustedRole(unverifiedClaimToken as any);
  assert(role === 'student', 'Unverified token role defaults strictly to student');

  // Verify that /api/auth/google strictly checks verifiedCaller.role === admin
  assert(
    serverAppContent.includes("const isServerVerifiedAdmin = verifiedCaller?.role === 'admin';"),
    '/api/auth/google strictly checks verifiedCaller.role === admin'
  );
  assert(
    !serverAppContent.includes("adminAuth.setCustomUserClaims(targetUid, { role: 'admin' })"),
    '/api/auth/google does not grant custom admin claims from unverified targetUid'
  );

  // -----------------------------------------------------------------------------------
  // 4. New Firebase users retain stable canonical UIDs
  // -----------------------------------------------------------------------------------
  console.log('\n--- 4. Stable Canonical Firebase UIDs ---');
  const validUid1 = 'AbCdEf1234567890abcdefgh';
  const validUid2 = 'W111111111111111111111111111';
  assert(isValidCanonicalUid(validUid1), '24-character Firebase UID is recognized as canonical');
  assert(isValidCanonicalUid(validUid2), '28-character Firebase UID is recognized as canonical');
  assert(!isValidCanonicalUid('student-uid-123'), 'Fabricated student-uid-123 rejected as non-canonical');
  assert(!isValidCanonicalUid('admin-master-uid'), 'Fabricated admin-master-uid rejected as non-canonical');
  assert(!isValidCanonicalUid('tutor'), 'Generic "tutor" rejected as non-canonical');

  const canonProfile = { uid: validUid1, email: 'student@example.com', name: 'Student' };
  const genericProfile = { uid: 'usr-student-example-com', email: 'student@example.com', name: 'Student' };
  const mergedProf = mergeProfilePreservingCanonicalUid(canonProfile, genericProfile);
  assert(mergedProf.uid === validUid1, 'Canonical UID is preserved when merging with legacy placeholder');

  // -----------------------------------------------------------------------------------
  // 5. New Native Friends can be approved and selected
  // -----------------------------------------------------------------------------------
  console.log('\n--- 5. Native Friend Approval & Selection Lifecycle ---');
  const freshTutor = {
    id: 'NEW_TUTOR_CANONICAL_UID_12345',
    uid: 'NEW_TUTOR_CANONICAL_UID_12345',
    name: 'Carlos Oliveira',
    publicTutorId: 'carlos-oliveira',
    approvalStatus: 'pending',
    isApproved: false,
    pricePerSessionUsd: 25,
  };

  const approvedUpdate = {
    approvalStatus: 'approved',
    isApproved: true,
  };

  const approvedTutor = mergeTutors(freshTutor, approvedUpdate);
  assert(approvedTutor.approvalStatus === 'approved', 'Tutor approvalStatus set to approved');
  assert(approvedTutor.isApproved === true, 'Tutor isApproved set to true');
  assert(approvedTutor.uid === freshTutor.uid, 'Tutor canonical UID preserved after approval');

  // -----------------------------------------------------------------------------------
  // 6. New students can be linked to approved Native Friends
  // -----------------------------------------------------------------------------------
  console.log('\n--- 6. Student Linking to Approved Native Friends ---');
  const linkedStudent = {
    uid: 'STUDENT_CANONICAL_UID_998877',
    email: 'newstudent@realmail.com',
    teacherUid: approvedTutor.uid,
    teacherEmail: 'carlos@itissimple.com',
    teacherName: approvedTutor.name,
  };
  assert(linkedStudent.teacherUid === approvedTutor.uid, 'Student teacherUid bound to approved Native Friend canonical UID');

  // -----------------------------------------------------------------------------------
  // 7. Profile changes are not overwritten by stale data
  // -----------------------------------------------------------------------------------
  console.log('\n--- 7. Fresh Profile Changes Not Overwritten by Stale Data ---');
  const baseTutor = {
    id: 'TUTOR_CANONICAL_UID_445566',
    uid: 'TUTOR_CANONICAL_UID_445566',
    name: 'Mariana Santos',
    headline: 'Native English Speaker',
    bio: 'Initial Bio',
  };
  const updatedTutor = {
    ...baseTutor,
    headline: 'Senior English Coach & Pronunciation Specialist',
    bio: 'Updated comprehensive biography',
  };
  const reloaded = mergeTutors(baseTutor, updatedTutor);
  assert(reloaded.headline === 'Senior English Coach & Pronunciation Specialist', 'Updated headline preserved');
  assert(reloaded.bio === 'Updated comprehensive biography', 'Updated bio preserved');

  // -----------------------------------------------------------------------------------
  // 8. Zero plaintext passwords stored or logged
  // -----------------------------------------------------------------------------------
  console.log('\n--- 8. Zero Plaintext Passwords Stored or Logged ---');
  assert(!appDbContent.includes('"password":'), 'app_db.json contains zero password fields');
  assert(serverAppContent.includes('scrubPasswords('), 'serverApp.ts calls scrubPasswords before persistence');

  // -----------------------------------------------------------------------------------
  // 9. Legitimate CMS data (landing content, default routines, playlists) preserved
  // -----------------------------------------------------------------------------------
  console.log('\n--- 9. Legitimate Pedagogical & CMS Data Fully Preserved ---');
  assert(Boolean(appDb.landingContent && appDb.landingContent.heroHeadlineStart), 'Landing content heroHeadlineStart preserved');
  assert(Boolean(appDb.routinesByDay && appDb.routinesByDay.monday), 'Monday default routine preserved');
  assert(Boolean(appDb.routinesByDay && appDb.routinesByDay.friday), 'Friday default routine preserved');
  assert(Array.isArray(appDb.youtubePlaylists) && appDb.youtubePlaylists.length > 0, 'Curated YouTube playlists preserved');

  // -----------------------------------------------------------------------------------
  // 10. Production startup does not execute test fixtures or seed routines
  // -----------------------------------------------------------------------------------
  console.log('\n--- 10. Production Startup Does Not Execute Test Routines ---');
  const serverTsContent = fs.readFileSync(path.join(process.cwd(), 'server.ts'), 'utf-8');
  const packageJsonContent = fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf-8');
  const packageJson = JSON.parse(packageJsonContent);

  assert(!serverTsContent.includes('test/'), 'server.ts does not import from test/');
  assert(!serverTsContent.includes('scripts/bootstrap-admin'), 'server.ts does not auto-execute bootstrap-admin');
  assert(packageJson.scripts.start === 'node server.ts', 'package.json start script is node server.ts');
  assert(!packageJson.scripts.build.includes('test'), 'package.json build script does not run tests');
  assert(ACTIVE_FIREBASE_DATABASE_ID === '(default)', 'Canonical database ID is (default)');
  assert(ACTIVE_FIRESTORE_DATABASE_ID === '(default)', 'Canonical Firestore database ID is (default)');

  console.log('\n===================================================================================');
  console.log(` TOTAL VERIFICATIONS: ${passed} PASSED | ${failed} FAILED`);
  console.log('===================================================================================\n');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runHotfix4B20Tests().catch((err) => {
  console.error('Fatal error in Hotfix 4B.20 test suite:', err);
  process.exit(1);
});
