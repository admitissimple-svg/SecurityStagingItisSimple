/**
 * SEC.FIX.3 — Privacidade em GET /api/auth/admin-status
 *
 * Valida:
 * 1. Ausência de exposição pública de adminEmail, adminName ou quaisquer dados
 *    pessoais/administrativos em GET /api/auth/admin-status (com e sem ADM).
 * 2. Preservação dos campos mínimos utilizados pela interface (hasAdmin, hasAdminRegistered).
 * 3. Consumidores (AuthModal.tsx e src/utils/auth.ts) não lêem nem exibem adminEmail/adminName.
 * 4. Compatibilidade integral do login ADM, custom claims, sync-admin-claims e RBAC.
 */

process.env.NODE_ENV = 'test';
process.env.FIREBASE_PROJECT_ID = 'itissimple-security-staging';
process.env.FIREBASE_DATABASE_ID = '(default)';

import assert from 'node:assert';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { app as serverApp, readDb, resetInMemoryDbForTesting } from '../serverApp';
import { setFirebaseAdminAuthForTesting, resetFirebaseAdminForTesting } from '../src/serverFirebaseAdmin';
import {
  isAuthorizedAdminUser,
  getAdminAccessToken,
  clearAuthClientMemoryCache,
} from '../src/utils/auth';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`  ✅ PASS: ${name}`);
    passed++;
  } catch (err: any) {
    console.error(`  ❌ FAIL: ${name}`);
    console.error(`         ${err?.stack || err?.message || err}`);
    failed++;
  }
}

function makeRequest(
  server: http.Server,
  method: string,
  reqPath: string,
  body?: any,
  headers: Record<string, string> = {}
): Promise<{ status: number; data: any }> {
  return new Promise((resolve, reject) => {
    const addr = server.address() as any;
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: addr.port,
        path: reqPath,
        method,
        headers: {
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
          ...headers,
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => (raw += chunk));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode || 0, data: raw ? JSON.parse(raw) : null });
          } catch {
            resolve({ status: res.statusCode || 0, data: raw });
          }
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const ALLOWED_KEYS = ['hasAdmin', 'hasAdminRegistered'];
const FORBIDDEN_KEYS = ['adminEmail', 'adminName', 'email', 'name', 'uid', 'id', 'role'];

function assertAdminStatusPrivacy(data: Record<string, any>, expectedHasAdmin: boolean, label: string) {
  assert.ok(data && typeof data === 'object', `${label}: response must be a JSON object`);
  const keys = Object.keys(data).sort();
  assert.deepStrictEqual(keys, ALLOWED_KEYS, `${label}: keys must strictly match allowlist (${JSON.stringify(keys)})`);
  assert.strictEqual(data.hasAdmin, expectedHasAdmin, `${label}: hasAdmin must be ${expectedHasAdmin}`);
  assert.strictEqual(data.hasAdminRegistered, expectedHasAdmin, `${label}: hasAdminRegistered must be ${expectedHasAdmin}`);

  for (const forbidden of FORBIDDEN_KEYS) {
    assert.strictEqual(
      Object.prototype.hasOwnProperty.call(data, forbidden),
      false,
      `${label}: forbidden key "${forbidden}" must not be present`
    );
  }
}

async function runSuite() {
  console.log('======================================================================');
  console.log('SEC.FIX.3 — PRIVACIDADE EM GET /api/auth/admin-status');
  console.log('======================================================================\n');

  const ADMIN_UID = 'SecFix3AdminUid123456789012';
  const ADMIN_EMAIL = 'adm.itissimple@gmail.com';
  const ADMIN_NAME = 'Secret Administrator Name';
  const CUSTOM_ADMIN_UID = 'SecFix3CustomAdminUid123456';
  const CUSTOM_ADMIN_EMAIL = 'custom.admin.secfix3@example.com';
  const STUDENT_UID = 'SecFix3StudentUid123456789';
  const STUDENT_EMAIL = 'student.secfix3@example.com';

  let customClaimsAssigned: Record<string, any> = {};

  resetInMemoryDbForTesting();
  clearAuthClientMemoryCache();

  setFirebaseAdminAuthForTesting({
    verifyIdToken: async (token: string) => {
      if (token === 'tok-admin-secfix3') {
        return { uid: ADMIN_UID, email: ADMIN_EMAIL, email_verified: true };
      }
      if (token === 'tok-admin-claimed-secfix3') {
        return { uid: ADMIN_UID, email: ADMIN_EMAIL, email_verified: true, role: 'admin', admin: true };
      }
      if (token === 'tok-custom-admin-secfix3') {
        return { uid: CUSTOM_ADMIN_UID, email: CUSTOM_ADMIN_EMAIL, email_verified: true };
      }
      if (token === 'tok-student-secfix3') {
        return { uid: STUDENT_UID, email: STUDENT_EMAIL, email_verified: true };
      }
      throw new Error('Invalid token');
    },
    setCustomUserClaims: async (uid: string, claims: Record<string, any>) => {
      customClaimsAssigned[uid] = claims;
    },
  } as any);

  const server = http.createServer(serverApp);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as any;
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  const originalFetch = globalThis.fetch;

  try {
    await test('1. Sem ADM cadastrado: GET /api/auth/admin-status retorna apenas booleanos sem vazar campos pessoais', async () => {
      const db = readDb();
      db.teachers = (db.teachers || []).filter((t: any) => t.role !== 'admin');

      const res = await makeRequest(server, 'GET', '/api/auth/admin-status');
      assert.strictEqual(res.status, 200);
      assertAdminStatusPrivacy(res.data, false, 'no-admin');
    });

    await test('2. Com ADM cadastrado: GET /api/auth/admin-status oculta adminEmail e adminName e preserva hasAdmin', async () => {
      const db = readDb();
      db.teachers = [
        ...(db.teachers || []).filter((t: any) => t.role !== 'admin'),
        {
          id: ADMIN_UID,
          uid: ADMIN_UID,
          email: ADMIN_EMAIL,
          name: ADMIN_NAME,
          role: 'admin',
        },
      ];

      const res = await makeRequest(server, 'GET', '/api/auth/admin-status');
      assert.strictEqual(res.status, 200);
      assertAdminStatusPrivacy(res.data, true, 'with-admin');
      const serialized = JSON.stringify(res.data);
      assert.strictEqual(serialized.includes(ADMIN_EMAIL), false, 'Must not contain admin email');
      assert.strictEqual(serialized.includes(ADMIN_NAME), false, 'Must not contain admin name');
      assert.strictEqual(serialized.includes(ADMIN_UID), false, 'Must not contain admin UID');
    });

    await test('3. Consumidores (AuthModal.tsx e src/utils/auth.ts) não consomem adminEmail nem adminName de admin-status', () => {
      const authModalSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/components/AuthModal.tsx'), 'utf8');
      assert.strictEqual(authModalSrc.includes('/api/auth/admin-status'), true, 'AuthModal still checks /api/auth/admin-status');
      assert.strictEqual(authModalSrc.includes('data.hasAdmin'), true, 'AuthModal still reads data.hasAdmin');
      assert.strictEqual(authModalSrc.includes('data.adminEmail'), false, 'AuthModal must not read data.adminEmail');
      assert.strictEqual(authModalSrc.includes('data.adminName'), false, 'AuthModal must not read data.adminName');

      const authUtilSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/utils/auth.ts'), 'utf8');
      assert.strictEqual(authUtilSrc.includes('/api/auth/admin-status'), false, 'src/utils/auth.ts must not fetch /api/auth/admin-status');
      assert.strictEqual(authUtilSrc.includes('adminEmail'), false, 'src/utils/auth.ts must not reference adminEmail');
      assert.strictEqual(authUtilSrc.includes('adminName'), false, 'src/utils/auth.ts must not reference adminName');
    });

    await test('4. Login ADM, verify-session, sync-admin-claims e RBAC permanecem íntegros', async () => {
      // A. Admin login via POST /api/auth/login
      const loginRes = await makeRequest(
        server,
        'POST',
        '/api/auth/login',
        { uid: ADMIN_UID, email: ADMIN_EMAIL, role: 'admin' },
        { Authorization: 'Bearer tok-admin-secfix3' }
      );
      assert.strictEqual(loginRes.status, 200);
      assert.strictEqual(loginRes.data.account?.role, 'admin');
      assert.strictEqual(customClaimsAssigned[ADMIN_UID]?.role, 'admin', 'Custom claim role=admin assigned on ADM login');

      // B. Verify session returns role='admin' for ADM
      const verifyAdmin = await makeRequest(server, 'GET', '/api/auth/verify-session', undefined, {
        Authorization: 'Bearer tok-admin-claimed-secfix3',
      });
      assert.strictEqual(verifyAdmin.status, 200);
      assert.strictEqual(verifyAdmin.data.role, 'admin');

      // C. Sync admin claims works for verified ADM
      const syncRes = await makeRequest(server, 'POST', '/api/auth/sync-admin-claims', {}, {
        Authorization: 'Bearer tok-admin-secfix3',
      });
      assert.strictEqual(syncRes.status, 200);
      assert.strictEqual(syncRes.data.role, 'admin');

      // D. Student RBAC remains blocked from admin login & sync-admin-claims
      const db = readDb();
      db.students = [
        ...(db.students || []),
        { id: STUDENT_UID, uid: STUDENT_UID, email: STUDENT_EMAIL, name: 'Regular Student', role: 'student' },
      ];
      const studentAdminLogin = await makeRequest(
        server,
        'POST',
        '/api/auth/login',
        { uid: STUDENT_UID, email: STUDENT_EMAIL, role: 'admin' },
        { Authorization: 'Bearer tok-student-secfix3' }
      );
      assert.strictEqual(studentAdminLogin.status, 403);

      const studentSyncRes = await makeRequest(server, 'POST', '/api/auth/sync-admin-claims', {}, {
        Authorization: 'Bearer tok-student-secfix3',
      });
      assert.strictEqual(studentSyncRes.status, 403);
    });

    await test('5. isAuthorizedAdminUser e getAdminAccessToken reconhecem ADM customizado via verify-session sem expor adminEmail', async () => {
      clearAuthClientMemoryCache();
      const db = readDb();
      db.teachers = [
        ...(db.teachers || []),
        {
          id: CUSTOM_ADMIN_UID,
          uid: CUSTOM_ADMIN_UID,
          email: CUSTOM_ADMIN_EMAIL,
          name: 'Custom Admin',
          role: 'admin',
        },
      ];

      globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const urlStr = typeof input === 'string' ? input : input.toString();
        if (urlStr.startsWith('/api/')) {
          return originalFetch(`${baseUrl}${urlStr}`, init);
        }
        return originalFetch(input, init);
      };

      const customAdminUser: any = {
        uid: CUSTOM_ADMIN_UID,
        email: CUSTOM_ADMIN_EMAIL,
        emailVerified: true,
        getIdToken: async (forceRefresh?: boolean) =>
          forceRefresh ? 'header.eyJ1aWQiOiJTZWNGaXgzQ3VzdG9tQWRtaW5VaWQxMjM0NTYiLCJyb2xlIjoiYWRtaW4ifQ.sig' : 'tok-custom-admin-secfix3',
      };

      const isAdm = await isAuthorizedAdminUser(customAdminUser);
      assert.strictEqual(isAdm, true, 'Server-configured admin (even outside KNOWN_ADMIN_EMAILS) is authorized via authenticated verify-session');

      const studentUser: any = {
        uid: STUDENT_UID,
        email: STUDENT_EMAIL,
        emailVerified: true,
        getIdToken: async () => 'tok-student-secfix3',
      };
      const isStudentAdm = await isAuthorizedAdminUser(studentUser);
      assert.strictEqual(isStudentAdm, false, 'Regular student is NOT authorized as admin');
    });
  } finally {
    globalThis.fetch = originalFetch;
    clearAuthClientMemoryCache();
    resetInMemoryDbForTesting();
    resetFirebaseAdminForTesting();
    server.closeAllConnections?.();
    server.close();
  }

  console.log('\n======================================================================');
  console.log(`SEC.FIX.3 SUITE: ${passed} PASSED, ${failed} FAILED`);
  console.log('======================================================================');
  process.exit(failed > 0 ? 1 : 0);
}

runSuite().catch((err) => {
  console.error('Fatal error running SEC.FIX.3 suite:', err);
  process.exit(1);
});
