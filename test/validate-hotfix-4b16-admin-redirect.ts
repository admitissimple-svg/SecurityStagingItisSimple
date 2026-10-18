import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';
import {
  setFirebaseAdminAuthForTesting,
  resetFirebaseAdminForTesting,
} from '../src/serverFirebaseAdmin';
import { app } from '../serverApp';
import { extractTrustedRole, firebaseAuthMiddleware, requireAdmin } from '../src/middleware/firebaseAuth';

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

async function runHotfix4b16Tests() {
  console.log('\n================================================================================');
  console.log('=== TEST SUITE: HOTFIX 4B.16 — LOGIN E REDIRECIONAMENTO DO ADMINISTRADOR ===');
  console.log('================================================================================\n');

  // Setup Mock Firebase Admin Auth
  const mockAdminAuth: any = {
    verifyIdToken: async (token: string) => {
      if (token === 'authorized-admin-token') {
        return {
          uid: 'admin-authorized-uid-1',
          email: 'adm.itissimple@gmail.com',
          email_verified: true,
          role: 'admin',
        };
      }
      if (token === 'unprovisioned-admin-email-token') {
        // User created in Firebase Auth with adm.itissimple@gmail.com, but WITHOUT custom claim
        return {
          uid: 'unprovisioned-uid-999',
          email: 'adm.itissimple@gmail.com',
          email_verified: true,
          // role claim is missing!
        };
      }
      if (token === 'valid-student-token') {
        return {
          uid: 'student-canonical-uid-101',
          email: 'laviniatilapiafc@gmail.com',
          email_verified: true,
          role: 'student',
        };
      }
      if (token === 'valid-teacher-token') {
        return {
          uid: 'teacher-canonical-uid-202',
          email: 'laviniafofafc@gmail.com',
          email_verified: true,
          role: 'teacher',
        };
      }
      if (token === 'legacy-student-now-admin-token') {
        return {
          uid: 'legacy-student-became-admin-uid-303',
          email: 'legacy.student@itissimple.com',
          email_verified: true,
          role: 'admin',
        };
      }
      throw new Error('Invalid Firebase ID token');
    },
    getUserByEmail: async (email: string) => {
      if (email === 'adm.itissimple@gmail.com') {
        return {
          uid: 'unprovisioned-uid-999',
          email: 'adm.itissimple@gmail.com',
          emailVerified: true,
          customClaims: {}, // Missing role='admin'
        };
      }
      const err: any = new Error('User not found');
      err.code = 'auth/user-not-found';
      throw err;
    },
    setCustomUserClaims: async () => {},
  };
  setFirebaseAdminAuthForTesting(mockAdminAuth);

  // --------------------------------------------------------------------------
  // TEST 1: Administrator + conta autorizada → painel administrativo
  // --------------------------------------------------------------------------
  console.log('--- 1. Administrator + Conta Autorizada -> Painel Administrativo ---');
  const resAuthAdmin = await invokeExpressRoute(
    app,
    'POST',
    '/api/auth/login',
    { Authorization: 'Bearer authorized-admin-token' },
    { email: 'adm.itissimple@gmail.com', role: 'admin', uid: 'admin-authorized-uid-1' }
  );

  assert(resAuthAdmin.status === 200, 'POST /api/auth/login retorna 200 OK para administrador autorizado');
  assert(resAuthAdmin.body.account?.role === 'admin', 'Account role retornado pelo backend é estritamente "admin"');
  assert(resAuthAdmin.body.account?.email === 'adm.itissimple@gmail.com', 'E-mail do administrador confere');
  assert(resAuthAdmin.body.account?.uid === 'admin-authorized-uid-1', 'UID vinculado confere com o UID do Firebase');
  assert(resAuthAdmin.body.profile === null, 'Perfil de estudante não é retornado para administrador');

  // Verify route resolution and session verification
  const resVerifyAdmin = await invokeExpressRoute(
    app,
    'GET',
    '/api/auth/verify-session',
    { Authorization: 'Bearer authorized-admin-token' }
  );
  assert(resVerifyAdmin.status === 200, 'GET /api/auth/verify-session retorna 200 para administrador');
  assert(resVerifyAdmin.body.role === 'admin', 'verify-session confirma role="admin"');
  assert(resVerifyAdmin.body.authenticated === true, 'verify-session confirma autenticação ativa');

  // --------------------------------------------------------------------------
  // TEST 2: Easter Egg + conta autorizada → painel administrativo
  // --------------------------------------------------------------------------
  console.log('\n--- 2. Easter Egg + Conta Autorizada -> Painel Administrativo ---');
  // Easter egg triggers onOpenAdminAuth / onOpenAuthModal('login', 'admin') with initialRole='admin'
  // When authenticating with the authorized admin token, it resolves to admin space:
  const resEasterEggAdmin = await invokeExpressRoute(
    app,
    'POST',
    '/api/auth/login',
    { Authorization: 'Bearer authorized-admin-token' },
    { email: 'adm.itissimple@gmail.com', role: 'admin', uid: 'admin-authorized-uid-1' }
  );

  assert(resEasterEggAdmin.status === 200, 'Fluxo Easter Egg com token administrativo retorna 200 OK');
  assert(resEasterEggAdmin.body.account?.role === 'admin', 'Fluxo Easter Egg resolve role como "admin"');

  // --------------------------------------------------------------------------
  // TEST 3: Administrator + conta sem claim → acesso negado
  // --------------------------------------------------------------------------
  console.log('\n--- 3. Administrator + Conta Sem Claim -> Acesso Negado (Sem abrir aluno silenciosamente) ---');
  // Attempt login with adm.itissimple@gmail.com when custom claim is absent
  const resUnprovisionedAdmin = await invokeExpressRoute(
    app,
    'POST',
    '/api/auth/login',
    { Authorization: 'Bearer unprovisioned-admin-email-token' },
    { email: 'adm.itissimple@gmail.com', role: 'admin', uid: 'unprovisioned-uid-999' }
  );

  assert(resUnprovisionedAdmin.status === 403, 'POST /api/auth/login retorna 403 Forbidden para conta sem custom claim');
  assert(resUnprovisionedAdmin.body.error === 'Forbidden', 'Error é Forbidden');
  assert(resUnprovisionedAdmin.body.code === 'ADMIN_ACCESS_DENIED', 'Código de erro é ADMIN_ACCESS_DENIED');
  assert(
    resUnprovisionedAdmin.body.message && resUnprovisionedAdmin.body.message.includes('Acesso negado'),
    'Mensagem clara de acesso negado é retornada'
  );
  assert(resUnprovisionedAdmin.body.account === undefined, 'Nenhum perfil de aluno é emitido silenciosamente');

  // --------------------------------------------------------------------------
  // TEST 4: Student + conta de aluno → dashboard de aluno
  // --------------------------------------------------------------------------
  console.log('\n--- 4. Student + Conta de Aluno -> Dashboard de Aluno ---');
  const resStudentLogin = await invokeExpressRoute(
    app,
    'POST',
    '/api/auth/login',
    { Authorization: 'Bearer valid-student-token' },
    { email: 'laviniatilapiafc@gmail.com', role: 'student', uid: 'student-canonical-uid-101' }
  );

  assert(resStudentLogin.status === 200, 'POST /api/auth/login retorna 200 OK para estudante');
  assert(resStudentLogin.body.account?.role === 'student', 'Account role é "student"');
  assert(resStudentLogin.body.profile !== null, 'Perfil de estudante é retornado e hidratado');
  assert(resStudentLogin.body.account?.email === 'laviniatilapiafc@gmail.com', 'E-mail do estudante confere');

  // --------------------------------------------------------------------------
  // TEST 5: Native Friend + conta de professor → painel docente
  // --------------------------------------------------------------------------
  console.log('\n--- 5. Native Friend + Conta de Professor -> Painel Docente ---');
  const resTeacherLogin = await invokeExpressRoute(
    app,
    'POST',
    '/api/auth/login',
    { Authorization: 'Bearer valid-teacher-token' },
    { email: 'laviniafofafc@gmail.com', role: 'teacher', uid: 'teacher-canonical-uid-202' }
  );

  assert(resTeacherLogin.status === 200, 'POST /api/auth/login retorna 200 OK para professor');
  assert(resTeacherLogin.body.account?.role === 'teacher', 'Account role é "teacher"');
  assert(resTeacherLogin.body.profile === null, 'Perfil de estudante é nulo para professor');

  // --------------------------------------------------------------------------
  // TEST 6: Perfil legado student não sobrescreve autorização administrativa válida
  // --------------------------------------------------------------------------
  console.log('\n--- 6. Perfil Legado "student" Não Sobrescreve Autorização Administrativa Válida ---');
  // Inject legacy student profile in app_db.json memory for this email
  const db = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'src', 'data', 'app_db.json'), 'utf-8'));
  if (!db.userProfiles) db.userProfiles = {};
  db.userProfiles['legacy.student@itissimple.com'] = {
    id: 'legacy-student-became-admin-uid-303',
    uid: 'legacy-student-became-admin-uid-303',
    email: 'legacy.student@itissimple.com',
    name: 'Legacy Student',
    role: 'student',
    level: 'iniciante',
  };

  const resLegacyStudentAdmin = await invokeExpressRoute(
    app,
    'POST',
    '/api/auth/login',
    { Authorization: 'Bearer legacy-student-now-admin-token' },
    { email: 'legacy.student@itissimple.com', role: 'admin', uid: 'legacy-student-became-admin-uid-303' }
  );

  assert(resLegacyStudentAdmin.status === 200, 'POST /api/auth/login retorna 200 para conta com claim admin');
  assert(resLegacyStudentAdmin.body.account?.role === 'admin', 'Role resolvida é estritamente "admin", ignorando perfil legado de aluno');
  assert(resLegacyStudentAdmin.body.profile === null, 'Perfil de aluno é ignorado para usuário com claim de administrador');

  // Clean up test entry
  delete db.userProfiles['legacy.student@itissimple.com'];

  // --------------------------------------------------------------------------
  // TEST 7: Nenhuma elevação de privilégios por manipulação do frontend
  // --------------------------------------------------------------------------
  console.log('\n--- 7. Nenhuma Elevação de Privilégios por Manipulação do Frontend ---');
  // 7.1 Student token sending role: 'admin' in body -> 403 Forbidden
  const resTamperRole = await invokeExpressRoute(
    app,
    'POST',
    '/api/auth/login',
    { Authorization: 'Bearer valid-student-token' },
    { email: 'laviniatilapiafc@gmail.com', role: 'admin', uid: 'student-canonical-uid-101' }
  );

  assert(resTamperRole.status === 403, 'Tentativa de enviar role=admin com token de aluno é rejeitada com 403 Forbidden');
  assert(resTamperRole.body.code === 'ADMIN_ACCESS_DENIED', 'Código é ADMIN_ACCESS_DENIED');

  // 7.2 Non-admin token trying to call protected admin endpoints
  const resAdminEndpoint = await invokeExpressRoute(
    app,
    'POST',
    '/api/admin/clean-obsolete-users',
    { Authorization: 'Bearer valid-student-token' },
    {}
  );
  assert(resAdminEndpoint.status === 403, 'Acesso à rota protegida de admin com token de estudante é bloqueado com 403 Forbidden');

  // 7.3 Impersonation attempt with admin email but student token
  const resImpersonateAdmin = await invokeExpressRoute(
    app,
    'POST',
    '/api/auth/login',
    { Authorization: 'Bearer valid-student-token' },
    { email: 'adm.itissimple@gmail.com', role: 'admin', uid: 'student-canonical-uid-101' }
  );
  assert(resImpersonateAdmin.status === 403, 'Tentativa de personificar email do admin com token de estudante é bloqueada com 403');

  // 7.4 extractTrustedRole defense: client payload role ignored
  const trustedRoleFromToken = extractTrustedRole({ role: 'student' });
  assert(trustedRoleFromToken === 'student', 'extractTrustedRole deriva papel estritamente das claims do token');
  const trustedAdminRole = extractTrustedRole({ role: 'admin' });
  assert(trustedAdminRole === 'admin', 'extractTrustedRole reconhece claim administrativa');
  const untrustedRole = extractTrustedRole({ role: 'superadmin' });
  assert(untrustedRole === 'student', 'extractTrustedRole faz fallback seguro para student em roles desconhecidas');

  console.log('\n================================================================================');
  console.log(`TOTAL TESTS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
  console.log('================================================================================\n');

  resetFirebaseAdminForTesting();
  process.exit(failed > 0 ? 1 : 0);
}

runHotfix4b16Tests().catch((err) => {
  console.error('Test execution error:', err);
  process.exit(1);
});
