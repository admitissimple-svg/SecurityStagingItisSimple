import assert from 'assert';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { app as serverApp, readDb, resetInMemoryDbForTesting } from '../serverApp';
import {
  setFirebaseAdminFirestoreForTesting,
  resetFirebaseAdminFirestoreForTesting,
  setIsCloudWriteDisabled,
  fetchAppStateFromFirestore,
} from '../src/serverFirestore';
import { setFirebaseAdminAuthForTesting, resetFirebaseAdminForTesting } from '../src/serverFirebaseAdmin';

function createTestFirestoreMock() {
  const store = new Map<string, Record<string, any>>();
  let failOnSetCollection: string | null = null;

  const makeDocRef = (col: string, id: string): any => {
    const key = `${col}::${id}`;
    return {
      _col: col,
      _id: id,
      id,
      path: `${col}/${id}`,
      get: async () => {
        const val = store.get(key);
        return {
          id,
          exists: Boolean(val),
          ref: makeDocRef(col, id),
          data: () => (val ? JSON.parse(JSON.stringify(val)) : undefined),
        };
      },
      set: async (data: Record<string, any>, setOpts?: { merge?: boolean }) => {
        if (failOnSetCollection && (col === failOnSetCollection || failOnSetCollection === '*')) {
          throw new Error(`Simulated Firestore write error on ${col}/${id}`);
        }
        const prev = setOpts?.merge ? store.get(key) || {} : {};
        store.set(key, JSON.parse(JSON.stringify({ ...prev, ...data })));
        return { writeTime: new Date() };
      },
    };
  };

  return {
    collection: (col: string) => ({
      doc: (id: string) => makeDocRef(col, id),
      get: async () => ({ empty: true, docs: [], size: 0, forEach: () => {} }),
    }),
    _getDoc: (col: string, id: string) => store.get(`${col}::${id}`),
    _setFailOnSet: (col: string | null) => {
      failOnSetCollection = col;
    },
  };
}

function makeRequest(
  server: http.Server,
  method: string,
  reqPath: string,
  body?: any,
  headers: Record<string, string> = {}
): Promise<{ status: number; data: any }> {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    if (!addr || typeof addr === 'string') {
      return reject(new Error('Server address unavailable'));
    }
    const bodyStr = body !== undefined ? JSON.stringify(body) : undefined;
    const reqHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      Connection: 'close',
      ...headers,
    };
    if (bodyStr) {
      reqHeaders['Content-Length'] = Buffer.byteLength(bodyStr).toString();
    }
    const req = http.request(
      { host: '127.0.0.1', port: addr.port, path: reqPath, method, headers: reqHeaders },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => (raw += chunk));
        res.on('end', () => {
          let parsed: any;
          try {
            parsed = JSON.parse(raw);
          } catch {
            parsed = raw;
          }
          resolve({ status: res.statusCode || 0, data: parsed });
        });
      }
    );
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

async function runSuite() {
  console.log('======================================================================');
  console.log('SEC.HOTFIX.1 — PROTEÇÃO DA LANDING PAGE (POST /api/landing-content)');
  console.log('======================================================================\n');

  let passed = 0;
  let failed = 0;

  async function test(name: string, fn: () => void | Promise<void>) {
    try {
      await fn();
      console.log(`  [PASS] ${name}`);
      passed++;
    } catch (err: any) {
      console.error(`  [FAIL] ${name}`);
      console.error(`         ${err?.stack || err?.message || err}`);
      failed++;
    }
  }

  const mockFs = createTestFirestoreMock();
  setFirebaseAdminFirestoreForTesting(mockFs as any);
  setIsCloudWriteDisabled(false);

  setFirebaseAdminAuthForTesting({
    verifyIdToken: async (token: string) => {
      if (token === 'tok-admin-role') {
        return {
          uid: 'sec1AdminUid000000000000001',
          email: 'adm.itissimple@gmail.com',
          email_verified: true,
          role: 'admin',
        };
      }
      if (token === 'tok-admin-bool') {
        return {
          uid: 'sec1AdminUid000000000000002',
          email: 'admin2@itissimple.com',
          email_verified: true,
          admin: true,
        };
      }
      if (token === 'tok-student') {
        return {
          uid: 'sec1StudentUid0000000000001',
          email: 'student@itissimple-test.com',
          email_verified: true,
          role: 'student',
        };
      }
      if (token === 'tok-teacher') {
        return {
          uid: 'sec1TeacherUid0000000000001',
          email: 'teacher@itissimple-test.com',
          email_verified: true,
          role: 'teacher',
        };
      }
      if (token === 'tok-admin-email-no-claim') {
        return {
          uid: 'sec1SpoofUid000000000000001',
          email: 'adm.itissimple@gmail.com',
          email_verified: true,
        };
      }
      if (token === 'tok-expired') {
        const err: any = new Error('Token expired');
        err.code = 'auth/id-token-expired';
        throw err;
      }
      const err: any = new Error('Invalid token');
      err.code = 'auth/argument-error';
      throw err;
    },
  } as any);

  const server = http.createServer(serverApp);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    await test('1. Rejeita acesso anônimo sem token (401) sem alterar RAM nem Firestore', async () => {
      resetInMemoryDbForTesting();
      const before = readDb().landingContent.heroHeadlineHighlight;

      const res = await makeRequest(server, 'POST', '/api/landing-content', {
        heroHeadlineHighlight: 'Hacked Headline',
      });
      assert.strictEqual(res.status, 401);
      assert.strictEqual(readDb().landingContent.heroHeadlineHighlight, before);
      assert.strictEqual(mockFs._getDoc('app_state', 'main_data'), undefined);
    });

    await test('2. Rejeita cabeçalho Authorization malformado e token inválido/expirado (401)', async () => {
      resetInMemoryDbForTesting();
      const before = readDb().landingContent.heroHeadlineHighlight;

      const resMalformed = await makeRequest(
        server,
        'POST',
        '/api/landing-content',
        { heroHeadlineHighlight: 'Hacked' },
        { Authorization: 'InvalidFormat xyz' }
      );
      assert.strictEqual(resMalformed.status, 401);

      const resInvalid = await makeRequest(
        server,
        'POST',
        '/api/landing-content',
        { heroHeadlineHighlight: 'Hacked' },
        { Authorization: 'Bearer invalid-token' }
      );
      assert.strictEqual(resInvalid.status, 401);

      const resExpired = await makeRequest(
        server,
        'POST',
        '/api/landing-content',
        { heroHeadlineHighlight: 'Hacked' },
        { Authorization: 'Bearer tok-expired' }
      );
      assert.strictEqual(resExpired.status, 401);

      assert.strictEqual(readDb().landingContent.heroHeadlineHighlight, before);
      assert.strictEqual(mockFs._getDoc('app_state', 'main_data'), undefined);
    });

    await test('3. Rejeita usuários não administrativos: student (403) e teacher (403)', async () => {
      resetInMemoryDbForTesting();
      const before = readDb().landingContent.heroHeadlineHighlight;

      const resStudent = await makeRequest(
        server,
        'POST',
        '/api/landing-content',
        { heroHeadlineHighlight: 'Student Override' },
        { Authorization: 'Bearer tok-student' }
      );
      assert.strictEqual(resStudent.status, 403);

      const resTeacher = await makeRequest(
        server,
        'POST',
        '/api/landing-content',
        { heroHeadlineHighlight: 'Teacher Override' },
        { Authorization: 'Bearer tok-teacher' }
      );
      assert.strictEqual(resTeacher.status, 403);

      assert.strictEqual(readDb().landingContent.heroHeadlineHighlight, before);
      assert.strictEqual(mockFs._getDoc('app_state', 'main_data'), undefined);
    });

    await test('4. Não autoriza por e-mail de admin sem custom claim nem por spoofing de headers/body', async () => {
      resetInMemoryDbForTesting();
      const before = readDb().landingContent.heroHeadlineHighlight;

      // E-mail de admin sem custom claim -> 403
      const resEmailOnly = await makeRequest(
        server,
        'POST',
        '/api/landing-content',
        { heroHeadlineHighlight: 'Email Spoof' },
        { Authorization: 'Bearer tok-admin-email-no-claim' }
      );
      assert.strictEqual(resEmailOnly.status, 403);

      // Headers falsos sem token -> 401
      const resFakeHeaders = await makeRequest(
        server,
        'POST',
        '/api/landing-content',
        { heroHeadlineHighlight: 'Header Spoof', role: 'admin', isAdmin: true },
        { 'x-user-role': 'admin', 'x-admin': 'true' }
      );
      assert.strictEqual(resFakeHeaders.status, 401);

      // Body com role=admin usando token de estudante -> 403
      const resBodyRole = await makeRequest(
        server,
        'POST',
        '/api/landing-content',
        { heroHeadlineHighlight: 'Body Spoof', role: 'admin', isAdmin: true },
        { Authorization: 'Bearer tok-student' }
      );
      assert.strictEqual(resBodyRole.status, 403);

      assert.strictEqual(readDb().landingContent.heroHeadlineHighlight, before);
      assert.strictEqual(mockFs._getDoc('app_state', 'main_data'), undefined);
    });

    await test('5. Admin autenticado com RBAC canônico (role=admin e admin=true) persiste no Firestore e preserva GET público', async () => {
      resetInMemoryDbForTesting();

      // GET /api/landing-content permanece público (sem Authorization)
      const getBefore = await makeRequest(server, 'GET', '/api/landing-content');
      assert.strictEqual(getBefore.status, 200);
      assert.strictEqual(getBefore.data.heroHeadlineHighlight, 'Living your Life');

      // POST com claim role=admin
      const ok1 = await makeRequest(
        server,
        'POST',
        '/api/landing-content',
        { heroHeadlineHighlight: 'Living Securely', footerSlogan: 'Saved by Admin RBAC' },
        { Authorization: 'Bearer tok-admin-role' }
      );
      assert.strictEqual(ok1.status, 200);
      assert.strictEqual(ok1.data.success, true);
      assert.strictEqual(ok1.data.landingContent.heroHeadlineHighlight, 'Living Securely');
      assert.strictEqual(readDb().landingContent.heroHeadlineHighlight, 'Living Securely');

      const fsMain = mockFs._getDoc('app_state', 'main_data');
      assert(fsMain?.landingContent, 'app_state/main_data deve persistir landingContent');
      assert.strictEqual(fsMain.landingContent.heroHeadlineHighlight, 'Living Securely');

      const rehydrated = await fetchAppStateFromFirestore();
      assert.strictEqual(rehydrated?.landingContent?.heroHeadlineHighlight, 'Living Securely');

      // POST com claim admin=true
      const ok2 = await makeRequest(
        server,
        'POST',
        '/api/landing-content',
        { heroBadge: 'Updated Badge via Admin Claim' },
        { Authorization: 'Bearer tok-admin-bool' }
      );
      assert.strictEqual(ok2.status, 200);
      assert.strictEqual(ok2.data.landingContent.heroBadge, 'Updated Badge via Admin Claim');
      assert.strictEqual(ok2.data.landingContent.heroHeadlineHighlight, 'Living Securely');

      // GET público retorna conteúdo atualizado
      const getAfter = await makeRequest(server, 'GET', '/api/landing-content');
      assert.strictEqual(getAfter.status, 200);
      assert.strictEqual(getAfter.data.heroBadge, 'Updated Badge via Admin Claim');
      assert.strictEqual(getAfter.data.heroHeadlineHighlight, 'Living Securely');
    });

    await test('6. Erro ou indisponibilidade de Firestore para admin não muta RAM (500 / 503)', async () => {
      resetInMemoryDbForTesting();
      const before = readDb().landingContent.heroHeadlineHighlight;

      mockFs._setFailOnSet('app_state');
      try {
        const res500 = await makeRequest(
          server,
          'POST',
          '/api/landing-content',
          { heroHeadlineHighlight: 'Should Not Persist' },
          { Authorization: 'Bearer tok-admin-role' }
        );
        assert.strictEqual(res500.status, 500);
        assert.strictEqual(readDb().landingContent.heroHeadlineHighlight, before);
      } finally {
        mockFs._setFailOnSet(null);
      }

      setFirebaseAdminFirestoreForTesting(null);
      try {
        const res503 = await makeRequest(
          server,
          'POST',
          '/api/landing-content',
          { heroHeadlineHighlight: 'Should Not Persist 503' },
          { Authorization: 'Bearer tok-admin-role' }
        );
        assert.strictEqual(res503.status, 503);
        assert.strictEqual(res503.data.error, 'FIRESTORE_UNAVAILABLE');
        assert.strictEqual(readDb().landingContent.heroHeadlineHighlight, before);
      } finally {
        setFirebaseAdminFirestoreForTesting(mockFs as any);
      }
    });

    await test('7. Clientes existentes (App.tsx e AdminLandingEditorModal.tsx) enviam Bearer token sem autorizar por e-mail/UI', async () => {
      const appSrc = fs.readFileSync(path.join(process.cwd(), 'src/App.tsx'), 'utf8');
      const modalSrc = fs.readFileSync(path.join(process.cwd(), 'src/components/AdminLandingEditorModal.tsx'), 'utf8');
      const serverSrc = fs.readFileSync(path.join(process.cwd(), 'serverApp.ts'), 'utf8');

      assert(
        serverSrc.includes("app.post('/api/landing-content', firebaseAuthMiddleware, requireAdmin,"),
        'serverApp.ts deve proteger POST /api/landing-content com firebaseAuthMiddleware e requireAdmin'
      );

      // App.tsx handleSaveLandingContent
      const appHandlerMatch = appSrc.match(/const handleSaveLandingContent = async[\s\S]*?\n  \};/);
      assert(appHandlerMatch, 'handleSaveLandingContent deve existir em src/App.tsx');
      assert(
        appHandlerMatch[0].includes('getAdminAccessToken') &&
          appHandlerMatch[0].includes('Authorization: `Bearer ${token}`'),
        'handleSaveLandingContent deve enviar Authorization Bearer token'
      );
      assert(
        appHandlerMatch[0].includes('if (res.ok)'),
        'handleSaveLandingContent só atualiza estado local quando o servidor confirma (res.ok)'
      );

      // AdminLandingEditorModal.tsx handleSave
      assert(
        modalSrc.includes('getAdminAccessToken') &&
          modalSrc.includes('Authorization: `Bearer ${token}`'),
        'AdminLandingEditorModal deve enviar Authorization Bearer token'
      );
      assert(
        modalSrc.includes('if (!res.ok)') && modalSrc.includes('setSaveError('),
        'AdminLandingEditorModal deve tratar erro de autorização/servidor sem simular sucesso'
      );
    });
  } finally {
    resetFirebaseAdminFirestoreForTesting();
    resetFirebaseAdminForTesting();
    resetInMemoryDbForTesting();
    server.closeAllConnections?.();
    server.close();
  }

  console.log('\n======================================================================');
  console.log(`SEC.HOTFIX.1 SUITE: ${passed} PASSED, ${failed} FAILED`);
  console.log('======================================================================');
  process.exit(failed > 0 ? 1 : 0);
}

runSuite().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
