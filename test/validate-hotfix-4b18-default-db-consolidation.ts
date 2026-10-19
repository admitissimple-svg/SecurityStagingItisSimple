/**
 * TEST SUITE: HOTFIX 4B.18 — FIRESTORE DEFAULT DATABASE CONSOLIDATION
 *
 * Verifies all 10 requirements:
 * 1. Application reads use (default).
 * 2. Application writes use (default).
 * 3. New teacher registrations are persisted correctly.
 * 4. Pending teachers are returned to the approval center.
 * 5. Read failures produce explicit errors.
 * 6. Duplicate records are not created.
 * 7. Existing administrator permissions remain intact.
 * 8. Bootstrap completion remains protected.
 * 9. Plaintext passwords are never migrated or persisted.
 * 10. Student onboarding and Trial Lesson flows remain compatible.
 */

import {
  getFirestoreDb,
  setFirebaseAdminFirestoreForTesting,
  resetFirebaseAdminFirestoreForTesting,
  saveTutorToFirestore,
  fetchTutorsFromFirestore,
  saveUserToFirestore,
  fetchUserFromFirestore,
  saveAppStateToFirestore,
  fetchAppStateFromFirestore,
  ACTIVE_FIREBASE_PROJECT_ID,
  ACTIVE_FIREBASE_DATABASE_ID,
  ACTIVE_FIRESTORE_DATABASE_ID,
} from '../src/serverFirestore';
import {
  ALLOWED_STAGING_PROJECT_ID,
  setFirebaseAdminAppForTesting,
  setFirebaseAdminAuthForTesting,
  resetFirebaseAdminForTesting,
} from '../src/serverFirebaseAdmin';
import {
  sanitizeDocumentPayload,
  compareDocumentVersions,
  planAndMigrateDatabases,
  DEFAULT_SOURCE_DB_ID,
  CANONICAL_DEST_DB_ID,
} from '../scripts/migrate-firestore-to-default';
import {
  getPersistentLock,
  acquirePersistentLock,
} from '../scripts/bootstrap-admin';
import { consolidateTutorsList } from '../src/utils/tutorConsolidation';

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

/**
 * High-fidelity in-memory Mock Firestore instance for default database testing
 */
class MockFirestoreDb {
  public projectId: string = ALLOWED_STAGING_PROJECT_ID;
  public databaseId: string = '(default)';
  public store: Map<string, any> = new Map();
  public simulateFailure: boolean = false;
  public failureError: Error = new Error('PERMISSION_DENIED: Simulated Firestore query failure');

  constructor(databaseId: string = '(default)') {
    this.databaseId = databaseId;
  }

  private getKey(col: string, id: string): string {
    return `${col}::${id}`;
  }

  public collection(colName: string) {
    const self = this;
    return {
      doc(docId: string) {
        return {
          id: docId,
          path: `${colName}/${docId}`,
          async get() {
            if (self.simulateFailure) throw self.failureError;
            const key = self.getKey(colName, docId);
            const data = self.store.get(key);
            return {
              id: docId,
              exists: data !== undefined,
              data: () => (data ? JSON.parse(JSON.stringify(data)) : undefined),
            };
          },
          async set(data: any, options?: { merge?: boolean }) {
            if (self.simulateFailure) throw self.failureError;
            const key = self.getKey(colName, docId);
            if (options?.merge && self.store.has(key)) {
              const prev = self.store.get(key);
              self.store.set(key, { ...prev, ...JSON.parse(JSON.stringify(data)) });
            } else {
              self.store.set(key, JSON.parse(JSON.stringify(data)));
            }
            return { writeTime: new Date() };
          },
          async delete() {
            if (self.simulateFailure) throw self.failureError;
            const key = self.getKey(colName, docId);
            self.store.delete(key);
          },
        };
      },
      where(field: string, op: string, val: any) {
        return {
          async get() {
            if (self.simulateFailure) throw self.failureError;
            const prefix = `${colName}::`;
            const docs: any[] = [];
            for (const [key, data] of self.store.entries()) {
              if (key.startsWith(prefix)) {
                const id = key.slice(prefix.length);
                if (op === '==' && data && data[field] === val) {
                  docs.push({
                    id,
                    exists: true,
                    data: () => JSON.parse(JSON.stringify(data)),
                  });
                }
              }
            }
            return {
              empty: docs.length === 0,
              size: docs.length,
              docs,
              forEach(cb: (d: any) => void) {
                docs.forEach(cb);
              },
            };
          },
        };
      },
      async get() {
        if (self.simulateFailure) throw self.failureError;
        const prefix = `${colName}::`;
        const docs: any[] = [];
        for (const [key, data] of self.store.entries()) {
          if (key.startsWith(prefix)) {
            const id = key.slice(prefix.length);
            docs.push({
              id,
              exists: true,
              data: () => JSON.parse(JSON.stringify(data)),
            });
          }
        }
        return {
          empty: docs.length === 0,
          size: docs.length,
          docs,
          forEach(cb: (d: any) => void) {
            docs.forEach(cb);
          },
        };
      },
    };
  }
}

async function runTests() {
  console.log('\n================================================================================');
  console.log('=== TEST SUITE: HOTFIX 4B.18 — FIRESTORE DEFAULT DATABASE CONSOLIDATION ===');
  console.log('================================================================================\n');

  try {
    // --------------------------------------------------------------------------
    // TEST 1: Application reads use (default)
    // --------------------------------------------------------------------------
    console.log('--- 1. Application Reads Use (default) ---');
    assert(ACTIVE_FIREBASE_DATABASE_ID === '(default)', 'ACTIVE_FIREBASE_DATABASE_ID is (default)');
    assert(ACTIVE_FIRESTORE_DATABASE_ID === '(default)', 'ACTIVE_FIRESTORE_DATABASE_ID is (default)');
    assert(CANONICAL_DEST_DB_ID === '(default)', 'CANONICAL_DEST_DB_ID is (default)');

    const mockDefaultDb = new MockFirestoreDb('(default)') as any;
    setFirebaseAdminFirestoreForTesting(mockDefaultDb);

    const mockAuth: any = {
      getUser: async (uid: string) => ({ uid }),
      getUserByEmail: async (email: string) => ({ uid: 'UserByEmailUid123456789012', email }),
    };
    setFirebaseAdminAuthForTesting(mockAuth);

    // Seed a tutor in (default)
    mockDefaultDb.store.set('users::jCkNIhvYEYbyJC2CWGZhFaoHGfo1', {
      id: 'jCkNIhvYEYbyJC2CWGZhFaoHGfo1',
      uid: 'jCkNIhvYEYbyJC2CWGZhFaoHGfo1',
      email: 'laviniafofafc@gmail.com',
      name: 'Skull Bee',
      publicTutorId: 'skull-bee',
      role: 'teacher',
      approvalStatus: 'pending',
    });

    const retrievedTutors = await fetchTutorsFromFirestore();
    assert(Array.isArray(retrievedTutors), 'fetchTutorsFromFirestore returns array from (default)');
    assert(retrievedTutors.length === 1, 'Reads exactly 1 tutor from (default)');
    assert(retrievedTutors[0].email === 'laviniafofafc@gmail.com', 'Reads Skull Bee from (default)');

    // --------------------------------------------------------------------------
    // TEST 2: Application writes use (default)
    // --------------------------------------------------------------------------
    console.log('\n--- 2. Application Writes Use (default) ---');
    const newTutor = {
      id: 'SarahConnorAuthUid1234567890',
      uid: 'SarahConnorAuthUid1234567890',
      authUid: 'SarahConnorAuthUid1234567890',
      email: 'sarah.english@example.com',
      name: 'Sarah Connor',
      publicTutorId: 'sarah-connor',
      approvalStatus: 'pending',
      role: 'teacher',
    };

    const saved = await saveTutorToFirestore(newTutor);
    assert(saved === true, 'saveTutorToFirestore completes successfully');

    const inUsers = mockDefaultDb.store.get('users::SarahConnorAuthUid1234567890');
    const inTutors = mockDefaultDb.store.get('tutors::SarahConnorAuthUid1234567890');
    assert(Boolean(inUsers), 'Write targeted users/{canonicalUid} in (default)');
    assert(Boolean(inTutors), 'Write targeted tutors/{canonicalUid} in (default)');
    assert(inUsers.name === 'Sarah Connor', 'Written profile preserves name');
    assert(inUsers.approvalStatus === 'pending', 'New teacher approval status is pending');

    // --------------------------------------------------------------------------
    // TEST 3: New teacher registrations are persisted correctly
    // --------------------------------------------------------------------------
    console.log('\n--- 3. New Teacher Registrations Persisted Correctly ---');
    const registeredTeacher = {
      uid: 'JohnSmithAuthUid123456789012',
      authUid: 'JohnSmithAuthUid123456789012',
      email: 'john.smith@example.com',
      name: 'John Smith',
      headline: 'Native American English Expert',
      availableDays: ['monday', 'wednesday', 'friday'],
      approvalStatus: 'pending',
      role: 'teacher',
    };

    const regSaved = await saveTutorToFirestore(registeredTeacher);
    assert(regSaved === true, 'Registration saved successfully in (default)');
    const regCheck = mockDefaultDb.store.get('users::JohnSmithAuthUid123456789012');
    assert(regCheck?.role === 'teacher', 'Persisted role is teacher');
    assert(regCheck?.approvalStatus === 'pending', 'Registration status is strictly pending');
    assert(regCheck?.headline === 'Native American English Expert', 'Profile headline preserved');

    // --------------------------------------------------------------------------
    // TEST 4: Pending teachers are returned to the approval center
    // --------------------------------------------------------------------------
    console.log('\n--- 4. Pending Teachers Returned to Approval Center ---');
    const allPending = await fetchTutorsFromFirestore();
    const pendingList = allPending.filter((t) => t.approvalStatus === 'pending' || t.status === 'pending');
    assert(pendingList.length >= 2, `Approval center receives pending teachers (found: ${pendingList.length})`);
    const skullBeeFound = pendingList.find((t) => t.email === 'laviniafofafc@gmail.com');
    assert(Boolean(skullBeeFound), 'Skull Bee is present in the pending approval queue');
    assert(skullBeeFound?.approvalStatus === 'pending', 'Skull Bee status is confirmed as pending');

    // --------------------------------------------------------------------------
    // TEST 5: Read failures produce explicit errors
    // --------------------------------------------------------------------------
    console.log('\n--- 5. Read Failures Produce Explicit Errors ---');
    mockDefaultDb.simulateFailure = true;

    let caughtError: any = null;
    try {
      await fetchTutorsFromFirestore();
    } catch (err: any) {
      caughtError = err;
    }

    assert(caughtError !== null, 'Read failure throws an explicit Error');
    assert(
      caughtError?.message.includes('PERMISSION_DENIED') ||
      caughtError?.message.includes('Simulated Firestore query failure'),
      `Error contains specific failure reason: ${caughtError?.message}`
    );
    mockDefaultDb.simulateFailure = false;

    // --------------------------------------------------------------------------
    // TEST 6: Duplicate records are not created
    // --------------------------------------------------------------------------
    console.log('\n--- 6. Duplicate Records Are Not Created ---');
    const existingListBefore = await fetchTutorsFromFirestore();
    // Re-saving the same tutor
    await saveTutorToFirestore(newTutor);
    const existingListAfter = await fetchTutorsFromFirestore();
    const sarahMatches = existingListAfter.filter((t) => t.email === 'sarah.english@example.com');
    assert(sarahMatches.length === 1, 'Re-saving tutor maintains exactly 1 canonical record without duplication');

    // --------------------------------------------------------------------------
    // TEST 7: Existing administrator permissions remain intact
    // --------------------------------------------------------------------------
    console.log('\n--- 7. Existing Administrator Permissions Remain Intact ---');
    const adminUser = {
      uid: 'AdminCanonicalUid001234567890',
      id: 'AdminCanonicalUid001234567890',
      email: 'adm.itissimple@gmail.com',
      role: 'admin',
      name: 'Admin It\'s Simple',
    };
    await saveUserToFirestore(adminUser);
    const savedAdmin = mockDefaultDb.store.get('users::AdminCanonicalUid001234567890');
    assert(savedAdmin?.role === 'admin', 'Administrator role is intact');
    assert(savedAdmin?.email === 'adm.itissimple@gmail.com', 'Admin email matches authorized admin');

    // --------------------------------------------------------------------------
    // TEST 8: Bootstrap completion remains protected
    // --------------------------------------------------------------------------
    console.log('\n--- 8. Bootstrap Completion Remains Protected ---');
    // Seed completed lock in (default)
    mockDefaultDb.store.set('app_state::admin_bootstrap', {
      status: 'completed',
      adminUid: 'AdminCanonicalUid001234567890',
      adminEmail: 'adm.itissimple@gmail.com',
      projectId: ALLOWED_STAGING_PROJECT_ID,
      lockedAt: Date.now() - 100000,
      completedAt: Date.now() - 50000,
    });

    const lock = await getPersistentLock(mockDefaultDb);
    assert(lock !== null, 'Persistent lock is successfully retrieved from app_state/admin_bootstrap');
    assert(lock?.status === 'completed', 'Lock status is completed');
    assert(lock?.adminUid === 'AdminCanonicalUid001234567890', 'Lock preserves canonical admin UID');

    // Attempt concurrent lock acquisition on completed lock
    const attempt = await acquirePersistentLock(
      {
        adminUid: 'AttackerCanonicalUid666777888',
        adminEmail: 'adm.itissimple@gmail.com',
        projectId: ALLOWED_STAGING_PROJECT_ID,
      },
      mockDefaultDb
    );
    assert(attempt.acquired === false, 'Cannot acquire lock when already completed');
    assert(attempt.error === 'ALREADY_COMPLETED', 'Lock rejects with ALREADY_COMPLETED');

    // --------------------------------------------------------------------------
    // TEST 9: Plaintext passwords are never migrated or persisted
    // --------------------------------------------------------------------------
    console.log('\n--- 9. Plaintext Passwords Never Migrated or Persisted ---');
    const dirtyPayload = {
      uid: 'UserWithPasswords1234567890',
      email: 'student@example.com',
      name: 'Student Test',
      password: 'PlaintextPassword123!',
      confirmPassword: 'PlaintextPassword123!',
      token: 'secret-token-xyz',
      apiKey: 'api-key-abc',
      nested: {
        rawPassword: 'nested-secret-password',
        hash: 'sha256-hash',
        validField: 'allowedValue',
      },
    };

    const { sanitized, removedCount } = sanitizeDocumentPayload(dirtyPayload);
    assert(sanitized.password === undefined, 'password stripped from sanitized payload');
    assert(sanitized.confirmPassword === undefined, 'confirmPassword stripped');
    assert(sanitized.token === undefined, 'token stripped');
    assert(sanitized.apiKey === undefined, 'apiKey stripped');
    assert(sanitized.nested.rawPassword === undefined, 'nested rawPassword stripped');
    assert(sanitized.nested.hash === undefined, 'nested hash stripped');
    assert(sanitized.nested.validField === 'allowedValue', 'valid fields preserved');
    assert(removedCount === 6, `Total 6 sensitive credential fields stripped (found: ${removedCount})`);

    // --------------------------------------------------------------------------
    // TEST 10: Student onboarding & Trial Lesson flows compatible
    // --------------------------------------------------------------------------
    console.log('\n--- 10. Student Onboarding & Trial Lesson Flows Compatible ---');
    const studentUser = {
      uid: 'StudentCanonicalUid777888999',
      id: 'StudentCanonicalUid777888999',
      email: 'lala.student@example.com',
      name: 'Lala Student',
      role: 'student',
      level: 'iniciante',
      assignedNativeFriendUID: 'skull-bee',
    };
    const studentSaved = await saveUserToFirestore(studentUser);
    assert(studentSaved === true, 'Student user saved to (default)');
    const studentInDb = mockDefaultDb.store.get('users::StudentCanonicalUid777888999');
    assert(studentInDb?.role === 'student', 'Student role verified');
    assert(studentInDb?.assignedNativeFriendUID === 'skull-bee', 'Student trial friend assigned correctly');

    // --------------------------------------------------------------------------
    // TEST 11: Safe Migration Dry-Run & Conflict Detection
    // --------------------------------------------------------------------------
    console.log('\n--- 11. Safe Migration Dry-Run & Conflict Detection ---');
    const mockSourceDb = new MockFirestoreDb(DEFAULT_SOURCE_DB_ID) as any;
    // Source DB has Skull Bee (as found in named DB)
    mockSourceDb.store.set('users::jCkNIhvYEYbyJC2CWGZhFaoHGfo1', {
      uid: 'jCkNIhvYEYbyJC2CWGZhFaoHGfo1',
      id: 'jCkNIhvYEYbyJC2CWGZhFaoHGfo1',
      name: 'Skull Bee',
      email: 'laviniafofafc@gmail.com',
      role: 'teacher',
      approvalStatus: 'pending',
      password: 'historical-plaintext-password', // To be stripped!
    });
    // Source DB has app_state/tutors with Skull Bee
    mockSourceDb.store.set('app_state::tutors', {
      tutorsList: [
        {
          id: 'jCkNIhvYEYbyJC2CWGZhFaoHGfo1',
          name: 'Skull Bee',
          email: 'laviniafofafc@gmail.com',
          approvalStatus: 'pending',
        },
      ],
    });

    const migrationPlan = await planAndMigrateDatabases({
      sourceDbId: DEFAULT_SOURCE_DB_ID,
      destDbId: CANONICAL_DEST_DB_ID,
      dryRun: true,
      confirm: false,
      customSourceDb: mockSourceDb,
      customDestDb: mockDefaultDb,
    });

    assert(migrationPlan.mode === 'DRY_RUN', 'Migration plan runs in DRY_RUN mode');
    assert(migrationPlan.sanitizedFieldsTotal > 0, 'Sensitive historical password stripped during plan');
    assert(migrationPlan.bootstrapProtected === true, 'Administrator bootstrap state strictly protected');

  } finally {
    resetFirebaseAdminFirestoreForTesting();
    resetFirebaseAdminForTesting();
  }

  console.log('\n================================================================================');
  console.log(`=== TEST SUMMARY: ${passed} PASSED | ${failed} FAILED ===`);
  console.log('================================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
