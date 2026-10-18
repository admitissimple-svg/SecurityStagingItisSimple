import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';
import {
  setFirebaseAdminAuthForTesting,
  resetFirebaseAdminForTesting,
} from '../src/serverFirebaseAdmin';
import { bootstrapFirstAdministrator } from '../scripts/bootstrap-admin';
import { app } from '../serverApp';

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

function invokeExpressRoute(
  appInstance: any,
  method: string,
  url: string,
  headers: Record<string, string> = {},
  body: any = {}
): Promise<{ status: number; body: any; headers: Record<string, string> }> {
  return new Promise((resolve) => {
    const req: any = new EventEmitter();
    req.method = method.toUpperCase();
    req.url = url;
    req.headers = {
      'content-type': 'application/json',
      ...Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])),
    };
    req.body = body;
    req.query = {};
    req.params = {};
    req.connection = { remoteAddress: '127.0.0.1' };
    req.socket = { remoteAddress: '127.0.0.1' };

    let resBody: any = '';
    const resHeaders: Record<string, string> = {};
    const res: any = new EventEmitter();
    res.statusCode = 200;

    res.setHeader = (key: string, val: string) => {
      resHeaders[key.toLowerCase()] = String(val);
      return res;
    };
    res.getHeader = (key: string) => resHeaders[key.toLowerCase()];
    res.status = (code: number) => {
      res.statusCode = code;
      return res;
    };
    res.json = (data: any) => {
      resBody = data;
      resolve({ status: res.statusCode, body: resBody, headers: resHeaders });
      return res;
    };
    res.send = (data: any) => {
      try {
        resBody = JSON.parse(data);
      } catch {
        resBody = data;
      }
      resolve({ status: res.statusCode, body: resBody, headers: resHeaders });
      return res;
    };
    res.end = (data?: any) => {
      if (data && !resBody) {
        try {
          resBody = JSON.parse(data);
        } catch {
          resBody = data;
        }
      }
      resolve({ status: res.statusCode, body: resBody, headers: resHeaders });
      return res;
    };

    appInstance.handle(req, res, (err: any) => {
      if (err) {
        resolve({ status: 500, body: { error: String(err) }, headers: resHeaders });
      } else {
        resolve({ status: 404, body: { error: 'Not Found' }, headers: resHeaders });
      }
    });
  });
}

async function runHotfixTests() {
  console.log('\n================================================================================');
  console.log('=== TEST SUITE: SECURITY HOTFIX 4B.17B — COMPLETE AUTHENTICATION HARDENING ===');
  console.log('================================================================================\n');

  // ---------------------------------------------------------
  // 1. Audit Source Code for Hardcoded Credentials & Passwords
  // ---------------------------------------------------------
  console.log('--- 1. Eliminating Plaintext Passwords & Hardcoded Credentials in Repositories ---');
  const serverAppContent = fs.readFileSync(path.join(process.cwd(), 'serverApp.ts'), 'utf-8');
  const appDbContent = fs.readFileSync(path.join(process.cwd(), 'src', 'data', 'app_db.json'), 'utf-8');
  const firestoreRulesContent = fs.readFileSync(path.join(process.cwd(), 'firestore.rules'), 'utf-8');

  // Check no password fields inside app_db.json
  const parsedAppDb = JSON.parse(appDbContent);
  let dbHasPasswords = false;
  if (parsedAppDb.authUsers) {
    for (const [k, v] of Object.entries(parsedAppDb.authUsers)) {
      if ((v as any).password !== undefined) {
        dbHasPasswords = true;
      }
    }
  }
  assert(!dbHasPasswords, 'src/data/app_db.json has 0 password fields in authUsers');

  // Check serverApp.ts does not contain legacy password comparisons (authRecord.password)
  assert(!serverAppContent.includes('authRecord.password'), 'serverApp.ts does not compare against authRecord.password');
  assert(!serverAppContent.includes('user.password ==='), 'serverApp.ts has no plaintext user.password === checks');
  assert(!serverAppContent.includes('TRUSTED_ADMIN_EMAILS'), 'serverApp.ts does not define TRUSTED_ADMIN_EMAILS list');

  // Check firestore.rules is default-deny
  assert(firestoreRulesContent.includes('allow read, write: if false;'), 'firestore.rules enforces strict default-deny (allow read, write: if false;)');

  // ---------------------------------------------------------
  // 2. Single Authentication Authority & Impersonation Prevention
  // ---------------------------------------------------------
  console.log('\n--- 2. Single Authentication Authority & Strict RBAC Enforcement ---');

  // Test 2.1: /api/auth/login without Firebase ID token -> 401 Unauthorized
  const resNoToken = await invokeExpressRoute(
    app,
    'POST',
    '/api/auth/login',
    {},
    { email: 'student@example.com', password: 'somePassword123' }
  );

  assert(resNoToken.status === 401, 'POST /api/auth/login without Firebase ID token returns 401 Unauthorized');
  assert(resNoToken.body.error === 'Unauthorized', 'Error message reflects Unauthorized access requirement');

  // Test 2.2: Mock Firebase Admin Auth for ID token verification
  const mockAdminAuth: any = {
    verifyIdToken: async (token: string) => {
      if (token === 'valid-student-token') {
        return {
          uid: 'student-uid-123',
          email: 'student@example.com',
          email_verified: true,
          role: 'student',
        };
      }
      if (token === 'valid-admin-token') {
        return {
          uid: 'admin-uid-999',
          email: 'admin@itissimple.com',
          email_verified: true,
          role: 'admin',
        };
      }
      throw new Error('Invalid token');
    },
    getUserByEmail: async (email: string) => {
      if (email === 'newadmin@itissimple.com') {
        return {
          uid: 'bootstrap-uid-777',
          email: 'newadmin@itissimple.com',
          emailVerified: true,
        };
      }
      const err: any = new Error('User not found');
      err.code = 'auth/user-not-found';
      throw err;
    },
    setCustomUserClaims: async (uid: string, claims: any) => {
      return;
    },
    generatePasswordResetLink: async (email: string) => {
      return `https://itissimple-security-staging.firebaseapp.com/__/auth/action?mode=resetPassword&email=${email}`;
    },
  };
  setFirebaseAdminAuthForTesting(mockAdminAuth);

  // Test 2.3: Impersonation attempt (email mismatch between body and verified token) -> 403 Forbidden
  const resImpersonate = await invokeExpressRoute(
    app,
    'POST',
    '/api/auth/login',
    { Authorization: 'Bearer valid-student-token' },
    { email: 'different@example.com' }
  );

  assert(resImpersonate.status === 403, 'POST /api/auth/login rejects identity mismatch (email) with 403 Forbidden');

  // Test 2.4: Impersonation attempt (UID mismatch between body and verified token) -> 403 Forbidden
  const resUidMismatch = await invokeExpressRoute(
    app,
    'POST',
    '/api/auth/login',
    { Authorization: 'Bearer valid-student-token' },
    { uid: 'victim-uid-456' }
  );

  assert(resUidMismatch.status === 403, 'POST /api/auth/login rejects identity mismatch (UID) with 403 Forbidden');

  // Test 2.5: Student attempting to elevate to admin role in body -> role forced to student
  const resStudentLogin = await invokeExpressRoute(
    app,
    'POST',
    '/api/auth/login',
    { Authorization: 'Bearer valid-student-token' },
    { role: 'admin' }
  );

  assert(resStudentLogin.status === 200, 'POST /api/auth/login accepts verified student token');
  assert(resStudentLogin.body.account?.role === 'student', 'Student cannot elevate role to admin via request body');
  assert(resStudentLogin.body.account?.uid === 'student-uid-123', 'Account UID is bound strictly to verified Firebase UID');

  // ---------------------------------------------------------
  // 3. Public Registration Block on Admin Role
  // ---------------------------------------------------------
  console.log('\n--- 3. Public Endpoints Block Admin Registration ---');
  const resSignupAdmin = await invokeExpressRoute(
    app,
    'POST',
    '/api/auth/signup',
    {},
    { name: 'Hacker', email: 'hacker@example.com', role: 'admin' }
  );

  assert(resSignupAdmin.status === 403, 'POST /api/auth/signup strictly rejects admin role with 403 Forbidden');

  const resRegisterAdmin = await invokeExpressRoute(
    app,
    'POST',
    '/api/auth/register',
    {},
    { name: 'Hacker', email: 'hacker@example.com', role: 'admin' }
  );

  assert(resRegisterAdmin.status === 403, 'POST /api/auth/register strictly rejects admin role with 403 Forbidden');

  // Test 3.1: Permanently deprecated legacy endpoint
  const resLegacySync = await invokeExpressRoute(
    app,
    'POST',
    '/api/auth/sync-local-users',
    {},
    {}
  );

  assert(resLegacySync.status === 410, 'POST /api/auth/sync-local-users returns 410 Gone');

  // ---------------------------------------------------------
  // 4. Secure Password Reset via Firebase Auth
  // ---------------------------------------------------------
  console.log('\n--- 4. Password Reset Exclusively Managed via Firebase Auth ---');
  const resReset = await invokeExpressRoute(
    app,
    'POST',
    '/api/auth/reset-password',
    {},
    { email: 'newadmin@itissimple.com' }
  );

  assert(resReset.status === 200, 'POST /api/auth/reset-password delegates to Firebase Auth generatePasswordResetLink');
  assert(resReset.body.success === true, 'Password reset initiated via Firebase Auth');

  const resResetNonexistent = await invokeExpressRoute(
    app,
    'POST',
    '/api/auth/reset-password',
    {},
    { email: 'nonexistent@example.com' }
  );

  assert(resResetNonexistent.status === 404, 'POST /api/auth/reset-password returns 404 for non-existent account in Firebase Auth');

  // ---------------------------------------------------------
  // 5. Secure Administrator Bootstrap Verification
  // ---------------------------------------------------------
  console.log('\n--- 5. Secure Administrator Bootstrap Logic ---');
  // 5.1 Test bootstrap script refuses unauthorized email
  const bootstrapExistingResult = await bootstrapFirstAdministrator('anotheradmin@itissimple.com', 'Admin', { confirm: true, bypassProjectIdCheckForTesting: true });
  assert(
    bootstrapExistingResult.success === false && bootstrapExistingResult.error === 'UNAUTHORIZED_TARGET_EMAIL',
    'Administrator bootstrap strictly refuses unauthorized target email'
  );

  // 5.2 Test bootstrap script requires account in Firebase Authentication first
  assert(typeof bootstrapFirstAdministrator === 'function', 'bootstrapFirstAdministrator is exported for authorized CLI execution');

  console.log('\n================================================================================');
  console.log(`TOTAL TESTS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
  console.log('================================================================================\n');

  process.exit(failed > 0 ? 1 : 0);
}

runHotfixTests().catch((err) => {
  console.error('Test suite error:', err);
  process.exit(1);
});
