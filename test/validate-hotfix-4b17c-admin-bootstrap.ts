import fs from 'fs';
import path from 'path';
import {
  bootstrapFirstAdministrator,
  inspectAdministratorState,
  AUTHORIZED_ADMIN_EMAIL,
  AUTHORIZED_PROJECT_ID,
  LOCAL_DB_PATH,
  LOCAL_LOCK_PATH,
  BootstrapLockData,
} from '../scripts/bootstrap-admin';

let passed = 0;
let failed = 0;

function assert(condition: any, testName: string, detail?: string) {
  if (condition) {
    console.log(`  ✅ PASS: ${testName}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${testName} ${detail ? `(${detail})` : ''}`);
    failed++;
  }
}

async function runHotfix4B17CTests() {
  console.log('\n================================================================================');
  console.log('=== TEST SUITE: HOTFIX 4B.17C — SECURE ADMIN BOOTSTRAP CORRECTION ===');
  console.log('================================================================================\n');

  // Back up original files before tests
  const originalDbContent = fs.existsSync(LOCAL_DB_PATH) ? fs.readFileSync(LOCAL_DB_PATH, 'utf-8') : null;
  const originalLockContent = fs.existsSync(LOCAL_LOCK_PATH) ? fs.readFileSync(LOCAL_LOCK_PATH, 'utf-8') : null;

  try {
    // --------------------------------------------------------------------------
    // Scenario 1: Fresh Administrator Bootstrap
    // --------------------------------------------------------------------------
    console.log('--- 1. Fresh Administrator Bootstrap ---');
    if (fs.existsSync(LOCAL_LOCK_PATH)) fs.unlinkSync(LOCAL_LOCK_PATH);

    const assignedClaimsMap: Record<string, any> = {};
    const mockAuth1: any = {
      getUserByEmail: async (email: string) => {
        if (email === AUTHORIZED_ADMIN_EMAIL) {
          return {
            uid: 'admin-fresh-uid-101',
            email: AUTHORIZED_ADMIN_EMAIL,
            emailVerified: true,
            disabled: false,
            customClaims: assignedClaimsMap['admin-fresh-uid-101'] || {},
          };
        }
        const err: any = new Error('User not found');
        err.code = 'auth/user-not-found';
        throw err;
      },
      setCustomUserClaims: async (uid: string, claims: any) => {
        assignedClaimsMap[uid] = claims;
      },
      listUsers: async () => ({
        users: [
          {
            uid: 'admin-fresh-uid-101',
            email: AUTHORIZED_ADMIN_EMAIL,
            emailVerified: true,
            customClaims: assignedClaimsMap['admin-fresh-uid-101'] || {},
          },
        ],
      }),
    };

    const res1 = await bootstrapFirstAdministrator(
      AUTHORIZED_ADMIN_EMAIL,
      'Admin It\'s Simple',
      {
        confirm: true,
        customAuth: mockAuth1,
        customDb: null,
        bypassProjectIdCheckForTesting: true,
      }
    );

    assert(res1.success === true, 'Fresh bootstrap completes with success=true');
    assert(res1.status === 'BOOTSTRAPPED', 'Fresh bootstrap status is BOOTSTRAPPED');
    assert(res1.adminUid === 'admin-fresh-uid-101', 'Admin UID is bound to verified UID from Firebase Auth');
    assert(assignedClaimsMap['admin-fresh-uid-101']?.role === 'admin', 'Firebase custom claim role=\'admin\' is assigned via Admin SDK');

    // --------------------------------------------------------------------------
    // Scenario 2: Legacy app_db.json Admin Stub Present
    // --------------------------------------------------------------------------
    console.log('\n--- 2. Legacy app_db.json Admin Stub Does Not Block Bootstrap ---');
    // Seed app_db with legacy stub (role: 'admin', but no uid)
    const dbWithLegacyStub = JSON.parse(fs.readFileSync(LOCAL_DB_PATH, 'utf-8'));
    dbWithLegacyStub.teachers = [
      {
        email: AUTHORIZED_ADMIN_EMAIL,
        name: 'Admin It\'s Simple',
        role: 'admin',
        registeredByAdmin: true,
        // Notice: No uid or id!
      },
    ];
    fs.writeFileSync(LOCAL_DB_PATH, JSON.stringify(dbWithLegacyStub, null, 2), 'utf-8');
    if (fs.existsSync(LOCAL_LOCK_PATH)) fs.unlinkSync(LOCAL_LOCK_PATH);

    const mockAuth2: any = {
      getUserByEmail: async (email: string) => {
        if (email === AUTHORIZED_ADMIN_EMAIL) {
          return {
            uid: 'admin-canonical-uid-202',
            email: AUTHORIZED_ADMIN_EMAIL,
            emailVerified: true,
            disabled: false,
            customClaims: {},
          };
        }
        const err: any = new Error('User not found');
        err.code = 'auth/user-not-found';
        throw err;
      },
      setCustomUserClaims: async (uid: string, claims: any) => {
        assignedClaimsMap[uid] = claims;
      },
      listUsers: async () => ({ users: [] }),
    };

    const res2 = await bootstrapFirstAdministrator(
      AUTHORIZED_ADMIN_EMAIL,
      'Admin It\'s Simple',
      {
        confirm: true,
        customAuth: mockAuth2,
        customDb: null,
        bypassProjectIdCheckForTesting: true,
      }
    );

    assert(res2.success === true, 'Bootstrap succeeds despite legacy admin stub present in app_db.json');
    assert(res2.adminUid === 'admin-canonical-uid-202', 'Bound to canonical UID from Firebase Auth');

    const updatedDb = JSON.parse(fs.readFileSync(LOCAL_DB_PATH, 'utf-8'));
    const adminTeachers = (updatedDb.teachers || []).filter(
      (t: any) => (t.email || '').toLowerCase() === AUTHORIZED_ADMIN_EMAIL
    );
    assert(adminTeachers.length === 1, 'Legacy teacher record is updated in-place without duplicate profiles (length === 1)');
    assert(adminTeachers[0].uid === 'admin-canonical-uid-202', 'Legacy teacher record now has verified canonical UID');
    assert(adminTeachers[0].registeredByAdmin === true, 'Preserved legacy metadata (registeredByAdmin=true)');

    // --------------------------------------------------------------------------
    // Scenario 3: Repeated Bootstrap for the Same UID
    // --------------------------------------------------------------------------
    console.log('\n--- 3. Repeated Bootstrap for the Same UID (Idempotent ALREADY_ACTIVE) ---');
    let claimUpdateCount = 0;
    const mockAuth3: any = {
      getUserByEmail: async (email: string) => {
        if (email === AUTHORIZED_ADMIN_EMAIL) {
          return {
            uid: 'admin-canonical-uid-202',
            email: AUTHORIZED_ADMIN_EMAIL,
            emailVerified: true,
            disabled: false,
            customClaims: { role: 'admin' },
          };
        }
        throw new Error('Not found');
      },
      setCustomUserClaims: async () => {
        claimUpdateCount++;
      },
      listUsers: async () => ({
        users: [
          {
            uid: 'admin-canonical-uid-202',
            email: AUTHORIZED_ADMIN_EMAIL,
            customClaims: { role: 'admin' },
          },
        ],
      }),
    };

    const res3 = await bootstrapFirstAdministrator(
      AUTHORIZED_ADMIN_EMAIL,
      'Admin It\'s Simple',
      {
        confirm: true,
        customAuth: mockAuth3,
        customDb: null,
        bypassProjectIdCheckForTesting: true,
      }
    );

    assert(res3.success === true, 'Repeated bootstrap returns success=true');
    assert(res3.status === 'ALREADY_ACTIVE', 'Repeated bootstrap returns status=ALREADY_ACTIVE');
    assert(res3.alreadyActive === true, 'alreadyActive flag is true');
    assert(claimUpdateCount === 0, 'Does not re-grant claims unnecessarily when already active (claims write count === 0)');

    // --------------------------------------------------------------------------
    // Scenario 4: Attempted Bootstrap for an Unauthorized Email
    // --------------------------------------------------------------------------
    console.log('\n--- 4. Attempted Bootstrap for an Unauthorized Email ---');
    const res4 = await bootstrapFirstAdministrator(
      'attacker@malicious.com',
      'Attacker',
      {
        confirm: true,
        customDb: null,
        bypassProjectIdCheckForTesting: true,
      }
    );

    assert(res4.success === false, 'Unauthorized email bootstrap returns success=false');
    assert(res4.error === 'UNAUTHORIZED_TARGET_EMAIL', 'Rejection error is UNAUTHORIZED_TARGET_EMAIL');
    assert(res4.message.includes('strictly restricted to \'adm.itissimple@gmail.com\''), 'Error explains restriction to authorized administrator');

    // --------------------------------------------------------------------------
    // Scenario 5: Attempted Bootstrap Against Another Firebase Project
    // --------------------------------------------------------------------------
    console.log('\n--- 5. Attempted Bootstrap Against Another Firebase Project ---');
    const previousProjectId = process.env.FIREBASE_PROJECT_ID;
    process.env.FIREBASE_PROJECT_ID = 'malicious-other-project';

    const res5 = await bootstrapFirstAdministrator(
      AUTHORIZED_ADMIN_EMAIL,
      'Admin',
      {
        confirm: true,
        customDb: null,
        bypassProjectIdCheckForTesting: false, // strictly enforce project check
      }
    );

    assert(res5.success === false, 'Bootstrap against unauthorized project returns success=false');
    assert(res5.error === 'UNAUTHORIZED_PROJECT_ID', 'Rejection error is UNAUTHORIZED_PROJECT_ID');

    // Restore project ID
    if (previousProjectId !== undefined) {
      process.env.FIREBASE_PROJECT_ID = previousProjectId;
    } else {
      delete process.env.FIREBASE_PROJECT_ID;
    }

    // --------------------------------------------------------------------------
    // Scenario 6: Missing or Invalid Operator Credentials
    // --------------------------------------------------------------------------
    console.log('\n--- 6. Missing or Invalid Operator Credentials ---');
    const mockInvalidAuth: any = {
      getUserByEmail: async () => {
        const err: any = new Error('Could not load default credentials from environment.');
        err.code = 'auth/invalid-credential';
        throw err;
      },
    };

    const res6 = await bootstrapFirstAdministrator(
      AUTHORIZED_ADMIN_EMAIL,
      'Admin',
      {
        confirm: true,
        customAuth: mockInvalidAuth,
        customDb: null,
        bypassProjectIdCheckForTesting: true,
      }
    );

    assert(res6.success === false, 'Invalid credentials bootstrap returns success=false');
    assert(res6.error === 'OPERATOR_CREDENTIALS_INVALID', 'Error is OPERATOR_CREDENTIALS_INVALID');

    // --------------------------------------------------------------------------
    // Scenario 7: Existing Administrator Claim on Another UID
    // --------------------------------------------------------------------------
    console.log('\n--- 7. Existing Administrator Claim on Another UID (Conflict Halts) ---');
    const mockAuthConflict: any = {
      getUserByEmail: async (email: string) => {
        if (email === AUTHORIZED_ADMIN_EMAIL) {
          return {
            uid: 'admin-intended-uid-303',
            email: AUTHORIZED_ADMIN_EMAIL,
            emailVerified: true,
            disabled: false,
            customClaims: {},
          };
        }
        throw new Error('Not found');
      },
      listUsers: async () => ({
        users: [
          {
            uid: 'intruder-uid-999',
            email: 'intruder@example.com',
            customClaims: { role: 'admin' },
          },
        ],
      }),
    };

    const res7 = await bootstrapFirstAdministrator(
      AUTHORIZED_ADMIN_EMAIL,
      'Admin',
      {
        confirm: true,
        customAuth: mockAuthConflict,
        customDb: null,
        bypassProjectIdCheckForTesting: true,
      }
    );

    assert(res7.success === false, 'Existing admin claim on another UID halts execution with success=false');
    assert(res7.error === 'EXISTING_ADMIN_CONFLICT', 'Error is EXISTING_ADMIN_CONFLICT');
    assert(res7.message.includes('Another account') && res7.message.includes('intruder-uid-999'), 'Message identifies conflicting UID');

    // --------------------------------------------------------------------------
    // Scenario 8: Concurrent Bootstrap Attempts
    // --------------------------------------------------------------------------
    console.log('\n--- 8. Concurrent Bootstrap Attempts Blocked by Atomic Lock ---');
    // Simulate an active lock created by process A
    const activeLock: BootstrapLockData = {
      status: 'in_progress',
      adminUid: 'admin-uid-concurrent',
      adminEmail: AUTHORIZED_ADMIN_EMAIL,
      projectId: AUTHORIZED_PROJECT_ID,
      lockedAt: Date.now(),
      lockExpiresAt: Date.now() + 60_000, // active for 60 seconds
      attemptId: 'attempt-process-A',
    };
    fs.writeFileSync(LOCAL_LOCK_PATH, JSON.stringify(activeLock, null, 2), 'utf-8');

    const mockAuth8: any = {
      getUserByEmail: async () => ({
        uid: 'admin-uid-concurrent',
        email: AUTHORIZED_ADMIN_EMAIL,
        emailVerified: true,
        disabled: false,
        customClaims: {},
      }),
      listUsers: async () => ({ users: [] }),
    };

    const res8 = await bootstrapFirstAdministrator(
      AUTHORIZED_ADMIN_EMAIL,
      'Admin',
      {
        confirm: true,
        customAuth: mockAuth8,
        customDb: null,
        bypassProjectIdCheckForTesting: true,
      }
    );

    assert(res8.success === false, 'Concurrent attempt is rejected with success=false');
    assert(res8.error === 'CONCURRENT_BOOTSTRAP_ATTEMPT', 'Error is CONCURRENT_BOOTSTRAP_ATTEMPT');

    // --------------------------------------------------------------------------
    // Scenario 9: Interrupted Bootstrap and Safe Recovery
    // --------------------------------------------------------------------------
    console.log('\n--- 9. Interrupted Bootstrap and Safe Recovery ---');
    // Simulate an interrupted lock that expired (crashed process B 2 minutes ago)
    const expiredLock: BootstrapLockData = {
      status: 'in_progress',
      adminUid: 'admin-recovery-uid-505',
      adminEmail: AUTHORIZED_ADMIN_EMAIL,
      projectId: AUTHORIZED_PROJECT_ID,
      lockedAt: Date.now() - 120_000,
      lockExpiresAt: Date.now() - 60_000, // expired 60 seconds ago
      attemptId: 'crashed-attempt-B',
    };
    fs.writeFileSync(LOCAL_LOCK_PATH, JSON.stringify(expiredLock, null, 2), 'utf-8');

    const recoveryState = { claimsSet: false };
    const mockAuth9: any = {
      getUserByEmail: async () => ({
        uid: 'admin-recovery-uid-505',
        email: AUTHORIZED_ADMIN_EMAIL,
        emailVerified: true,
        disabled: false,
        customClaims: {},
      }),
      setCustomUserClaims: async (uid: string, claims: any) => {
        if (uid === 'admin-recovery-uid-505' && claims.role === 'admin') {
          recoveryState.claimsSet = true;
        }
      },
      listUsers: async () => ({ users: [] }),
    };

    const res9 = await bootstrapFirstAdministrator(
      AUTHORIZED_ADMIN_EMAIL,
      'Admin',
      {
        confirm: true,
        customAuth: mockAuth9,
        customDb: null,
        bypassProjectIdCheckForTesting: true,
      }
    );

    assert(res9.success === true, 'Interrupted bootstrap safely recovers and completes');
    assert(res9.status === 'BOOTSTRAPPED', 'Status is BOOTSTRAPPED');
    assert(recoveryState.claimsSet === true, 'Custom claims assigned during safe recovery');
    const finalLock = JSON.parse(fs.readFileSync(LOCAL_LOCK_PATH, 'utf-8'));
    assert(finalLock.status === 'completed', 'Lock successfully transitioned to completed');

    // --------------------------------------------------------------------------
    // Scenario 10: Preservation of Application Data
    // --------------------------------------------------------------------------
    console.log('\n--- 10. Preservation of Application Data & Zero Plaintext Passwords ---');
    const dbFinal = JSON.parse(fs.readFileSync(LOCAL_DB_PATH, 'utf-8'));

    // Check students are untouched
    assert(Array.isArray(dbFinal.students) && dbFinal.students.length > 0, 'students collection preserved intact');
    assert(dbFinal.students.some((s: any) => s.email === 'laviniatilapiafc@gmail.com'), 'Student Lavinia record preserved');

    // Check no passwords anywhere in database
    let foundAnyPassword = false;
    const checkNoPasswords = (obj: any) => {
      if (!obj || typeof obj !== 'object') return;
      for (const [k, v] of Object.entries(obj)) {
        if (k.toLowerCase() === 'password') foundAnyPassword = true;
        if (typeof v === 'object') checkNoPasswords(v);
      }
    };
    checkNoPasswords(dbFinal);
    assert(!foundAnyPassword, 'Zero password fields found across entire application database');

    // Check read-only inspection utility
    const inspection = await inspectAdministratorState({
      customAuth: mockAuth9,
      customDb: null,
      bypassProjectIdCheckForTesting: true,
    });
    assert(inspection.accountExists === true, 'inspectAdministratorState verifies account exists');
    assert(inspection.email === AUTHORIZED_ADMIN_EMAIL, 'inspectAdministratorState binds to authorized email');
    assert(inspection.persistentLockExists === true, 'inspectAdministratorState reports persistent lock');

    // --------------------------------------------------------------------------
    // Bonus Scenario: Transactional Lock using in-memory Firestore Mock
    // --------------------------------------------------------------------------
    console.log('\n--- Bonus: Transactional Lock with in-memory Firestore Transaction ---');
    if (fs.existsSync(LOCAL_LOCK_PATH)) fs.unlinkSync(LOCAL_LOCK_PATH);
    let memoryStore: Record<string, any> = {};
    const mockFirestore: any = {
      collection: (col: string) => ({
        doc: (docId: string) => ({
          get: async () => ({
            exists: Boolean(memoryStore[`${col}/${docId}`]),
            data: () => memoryStore[`${col}/${docId}`],
          }),
          set: async (val: any) => {
            memoryStore[`${col}/${docId}`] = val;
          },
        }),
      }),
      runTransaction: async (updateFunction: (tx: any) => Promise<any>) => {
        const tx: any = {
          get: async (ref: any) => {
            const data = memoryStore['app_state/admin_bootstrap'];
            return {
              exists: Boolean(data),
              data: () => data,
            };
          },
          set: (ref: any, val: any) => {
            memoryStore['app_state/admin_bootstrap'] = {
              ...(memoryStore['app_state/admin_bootstrap'] || {}),
              ...val,
            };
          },
        };
        return await updateFunction(tx);
      },
    };

    const resFirestoreTx = await bootstrapFirstAdministrator(
      AUTHORIZED_ADMIN_EMAIL,
      'Admin It\'s Simple',
      {
        confirm: true,
        customAuth: mockAuth1,
        customDb: mockFirestore,
        bypassProjectIdCheckForTesting: true,
      }
    );
    assert(resFirestoreTx.success === true, 'Bootstrap succeeds using Firestore atomic transaction');
    assert(memoryStore['app_state/admin_bootstrap']?.status === 'completed', 'Firestore document status is completed');
    assert(memoryStore['app_state/admin_bootstrap']?.adminUid === 'admin-fresh-uid-101', 'Firestore lock recorded canonical admin UID');

  } finally {
    // Restore original files
    if (originalDbContent !== null) {
      fs.writeFileSync(LOCAL_DB_PATH, originalDbContent, 'utf-8');
    }
    if (originalLockContent !== null) {
      fs.writeFileSync(LOCAL_LOCK_PATH, originalLockContent, 'utf-8');
    } else if (fs.existsSync(LOCAL_LOCK_PATH)) {
      fs.unlinkSync(LOCAL_LOCK_PATH);
    }
  }

  console.log('\n================================================================================');
  console.log(`HOTFIX 4B.17C TESTS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
  console.log('================================================================================\n');

  process.exit(failed > 0 ? 1 : 0);
}

runHotfix4B17CTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
