/**
 * SECURE ADMINISTRATOR BOOTSTRAP UTILITY
 * 
 * Requirements:
 * 1. Creates administrator privileges through a trusted, server-controlled operation.
 * 2. Strictly one-time execution: refuses to run if an administrator already exists.
 * 3. Binds administrator privileges directly to the verified Firebase Authentication UID.
 * 4. Assigns Firebase custom claims { role: 'admin' }.
 * 5. Requires the administrator identity to already exist in Firebase Authentication
 *    with a brand-new password that has never been used in the previous system.
 * 6. Never stores, logs, or handles plaintext passwords.
 * 7. Cannot be executed via public unauthenticated HTTP endpoints.
 */

import fs from 'fs';
import path from 'path';
import { getFirebaseAdminAuth } from '../src/serverFirebaseAdmin';

const LOCAL_DB_PATH = path.join(process.cwd(), 'src', 'data', 'app_db.json');

export interface BootstrapResult {
  success: boolean;
  message: string;
  adminUid?: string;
  adminEmail?: string;
  error?: string;
}

export async function bootstrapFirstAdministrator(
  adminEmail: string,
  adminName = 'Administrator'
): Promise<BootstrapResult> {
  const cleanEmail = (adminEmail || '').toLowerCase().trim();

  if (!cleanEmail || !cleanEmail.includes('@')) {
    return {
      success: false,
      message: 'Invalid email address provided for administrator bootstrap.',
      error: 'INVALID_EMAIL',
    };
  }

  // 1. Read persistent database
  let db: any = {};
  if (fs.existsSync(LOCAL_DB_PATH)) {
    try {
      db = JSON.parse(fs.readFileSync(LOCAL_DB_PATH, 'utf-8'));
    } catch {
      db = {};
    }
  }

  // 2. Strictly one-time enforcement: Verify no administrator already exists in system records
  const existingTeacherAdmin = (db.teachers || []).find((t: any) => t.role === 'admin');
  const existingAuthAdmin = Object.values(db.authUsers || {}).find(
    (u: any) => (u as any).role === 'admin'
  );

  if (existingTeacherAdmin || existingAuthAdmin) {
    const existingEmail = existingTeacherAdmin?.email || (existingAuthAdmin as any)?.email;
    return {
      success: false,
      message: `Administrator bootstrap is strictly one-time. An administrator (${existingEmail}) is already configured.`,
      error: 'ALREADY_BOOTSTRAPPED',
    };
  }

  // 3. Query Firebase Authentication via Firebase Admin SDK
  const adminAuth = getFirebaseAdminAuth();
  let firebaseUser: any = null;
  try {
    firebaseUser = await adminAuth.getUserByEmail(cleanEmail);
  } catch (err: any) {
    if (err?.code === 'auth/user-not-found') {
      return {
        success: false,
        message: `User '${cleanEmail}' does not exist in Firebase Authentication. The operator must create the account in Firebase Authentication first with a brand-new, strong password before running bootstrap.`,
        error: 'USER_NOT_FOUND_IN_AUTH',
      };
    }
    return {
      success: false,
      message: `Failed to inspect Firebase Authentication user: ${err?.message || err}`,
      error: 'AUTH_LOOKUP_FAILED',
    };
  }

  const verifiedUid = firebaseUser.uid;

  // 4. Assign Firebase Custom Claims role='admin'
  try {
    await adminAuth.setCustomUserClaims(verifiedUid, { role: 'admin' });
  } catch (claimErr: any) {
    return {
      success: false,
      message: `Failed to set custom claim role='admin' on UID ${verifiedUid}: ${claimErr?.message || claimErr}`,
      error: 'CLAIM_ASSIGNMENT_FAILED',
    };
  }

  // 5. Bind administrator role to verified Firebase UID in persistent database (NO PASSWORDS!)
  if (!db.teachers) db.teachers = [];
  const tIdx = db.teachers.findIndex((t: any) => (t.email || '').toLowerCase() === cleanEmail);
  const adminRecord = {
    id: verifiedUid,
    uid: verifiedUid,
    authUid: verifiedUid,
    name: adminName,
    email: cleanEmail,
    role: 'admin',
    isBootstrappedAdmin: true,
    bootstrappedAt: new Date().toISOString(),
  };

  if (tIdx >= 0) {
    db.teachers[tIdx] = { ...db.teachers[tIdx], ...adminRecord };
  } else {
    db.teachers.push(adminRecord);
  }

  if (!db.authUsers) db.authUsers = {};
  db.authUsers[cleanEmail] = {
    uid: verifiedUid,
    email: cleanEmail,
    name: adminName,
    role: 'admin',
    createdAt: new Date().toISOString(),
  };

  if (!db.userProfiles) db.userProfiles = {};
  db.userProfiles[cleanEmail] = {
    id: verifiedUid,
    uid: verifiedUid,
    email: cleanEmail,
    name: adminName,
    role: 'admin',
    createdAt: new Date().toISOString(),
  };

  // Mark bootstrap as permanently locked
  db.isAdministratorBootstrapped = true;
  db.bootstrappedAdminUid = verifiedUid;

  // Scrub any legacy password fields defensively
  if (db.authUsers) {
    for (const k of Object.keys(db.authUsers)) {
      if (db.authUsers[k]) delete db.authUsers[k].password;
    }
  }

  fs.writeFileSync(LOCAL_DB_PATH, JSON.stringify(db, null, 2), 'utf-8');

  return {
    success: true,
    message: `Administrator '${cleanEmail}' successfully bootstrapped and bound to canonical UID '${verifiedUid}' with custom claim role='admin'.`,
    adminUid: verifiedUid,
    adminEmail: cleanEmail,
  };
}

// CLI Execution support
if (process.argv[1] && process.argv[1].endsWith('bootstrap-admin.ts')) {
  const targetEmail = process.argv[2];
  const targetName = process.argv[3] || 'Administrator';

  if (!targetEmail) {
    console.error('Usage: npx tsx scripts/bootstrap-admin.ts <adminEmail> [adminName]');
    process.exit(1);
  }

  bootstrapFirstAdministrator(targetEmail, targetName)
    .then((res) => {
      if (res.success) {
        console.log(`[BOOTSTRAP SUCCESS] ${res.message}`);
        process.exit(0);
      } else {
        console.error(`[BOOTSTRAP FAILED] ${res.message} (${res.error})`);
        process.exit(1);
      }
    })
    .catch((err) => {
      console.error('[BOOTSTRAP ERROR]', err);
      process.exit(1);
    });
}
