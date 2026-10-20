/**
 * TEST SUITE: HOTFIX PONTUAL — NATIVE FRIEND LOGIN & REDIRECTION
 *
 * Verifies:
 * 1. POST /api/auth/login with role='teacher' returns role='teacher', null student profile, and valid tutor object.
 * 2. POST /api/auth/login with role='teacher' registers and links tutor in tutorsList and teachers.
 * 3. GET /api/user-profile for teacher returns isTeacher=true, role='teacher'.
 * 4. POST /api/auth/google with role='teacher' returns role='teacher' without student demotion.
 * 5. Strict RBAC: Administrator login still requires admin claims (403 for unauthorized).
 * 6. Student login continues to open student profile normally without regressions.
 */

import 'dotenv/config';
import { EventEmitter } from 'events';
import { app } from '../serverApp';
import {
  setFirebaseAdminAuthForTesting,
  resetFirebaseAdminForTesting,
} from '../src/serverFirebaseAdmin';

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
    const [pathPart, queryPart] = url.split('?');
    req.method = method.toUpperCase();
    req.url = url;
    req.path = pathPart;
    req.headers = {
      'content-type': 'application/json',
      ...Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])),
    };
    req.body = body;
    req.query = {};
    if (queryPart) {
      const sp = new URLSearchParams(queryPart);
      for (const [k, v] of sp.entries()) {
        req.query[k] = v;
      }
    }
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

async function runNativeFriendLoginTests() {
  console.log('\n================================================================================');
  console.log('=== TEST SUITE: HOTFIX PONTUAL — LOGIN E REDIRECIONAMENTO DE NATIVE FRIEND ===');
  console.log('================================================================================\n');

  const testTeacherUid = 'canonical-teacher-uid-test-889';
  const testTeacherEmail = 'estilobeeadm@gmail.com';

  const mockAdminAuth: any = {
    verifyIdToken: async (token: string) => {
      if (token === 'valid-teacher-token') {
        return {
          uid: testTeacherUid,
          email: testTeacherEmail,
          email_verified: true,
        };
      }
      if (token === 'valid-student-token') {
        return {
          uid: 'student-uid-999',
          email: 'student@simpleenglish.com',
          email_verified: true,
          role: 'student',
        };
      }
      if (token === 'valid-admin-token') {
        return {
          uid: 'admin-uid-111',
          email: 'adm.itissimple@gmail.com',
          email_verified: true,
          role: 'admin',
        };
      }
      throw new Error('Invalid token');
    },
    getUserByEmail: async (email: string) => {
      return { uid: 'some-uid', email, emailVerified: true };
    },
    setCustomUserClaims: async () => {},
  };
  setFirebaseAdminAuthForTesting(mockAdminAuth);

  // ---------------------------------------------------------------------------
  // 1. Native Friend Login (/api/auth/login with role='teacher')
  // ---------------------------------------------------------------------------
  console.log('--- 1. Login com Credenciais de Native Friend (Amigo Nativo) ---');
  const resTeacherLogin = await invokeExpressRoute(
    app,
    'POST',
    '/api/auth/login',
    { Authorization: 'Bearer valid-teacher-token' },
    { email: testTeacherEmail, role: 'teacher', uid: testTeacherUid }
  );

  assert(resTeacherLogin.status === 200, 'POST /api/auth/login com role=teacher retorna 200 OK');
  assert(resTeacherLogin.body.account?.role === 'teacher', 'Account role retornado é estritamente "teacher"');
  assert(resTeacherLogin.body.account?.email === testTeacherEmail, 'Account email confere com o e-mail do Native Friend');
  assert(resTeacherLogin.body.profile === null, 'Perfil de estudante é estritamente nulo (não abre espaço do aluno)');
  assert(resTeacherLogin.body.student === null, 'Objeto student retornado é nulo para Native Friend');
  assert(Boolean(resTeacherLogin.body.tutor), 'Objeto tutor é retornado e populado com sucesso');
  assert(resTeacherLogin.body.tutor?.email === testTeacherEmail, 'Tutor retornado possui o email correto');

  // ---------------------------------------------------------------------------
  // 2. Checagem de Perfil do Professor (/api/user-profile)
  // ---------------------------------------------------------------------------
  console.log('\n--- 2. Consulta de Perfil do Usuário (/api/user-profile) ---');
  const resProfile = await invokeExpressRoute(
    app,
    'GET',
    `/api/user-profile?email=${encodeURIComponent(testTeacherEmail)}&uid=${encodeURIComponent(testTeacherUid)}`,
    {},
    {}
  );

  assert(resProfile.status === 200, 'GET /api/user-profile retorna 200 OK');
  assert(resProfile.body.isTeacher === true, 'Perfil identifica isTeacher === true');
  assert(resProfile.body.role === 'teacher', 'Perfil identifica role === "teacher"');
  assert(Boolean(resProfile.body.tutor), 'Perfil devolve dados do tutor corretamente');

  // ---------------------------------------------------------------------------
  // 3. Login com Google para Native Friend (/api/auth/google with role='teacher')
  // ---------------------------------------------------------------------------
  console.log('\n--- 3. Login com Google para Native Friend ---');
  const resGoogleTeacher = await invokeExpressRoute(
    app,
    'POST',
    '/api/auth/google',
    { Authorization: 'Bearer valid-teacher-token' },
    { email: testTeacherEmail, role: 'teacher', uid: testTeacherUid, name: 'Estilo Bee Teacher' }
  );

  assert(resGoogleTeacher.status === 200, 'POST /api/auth/google com role=teacher retorna 200 OK');
  assert(resGoogleTeacher.body.account?.role === 'teacher', 'Google login preserva papel de "teacher"');
  assert(Boolean(resGoogleTeacher.body.tutor), 'Google login retorna tutor configurado');

  // ---------------------------------------------------------------------------
  // 4. Preservação de Regras Existentes: Segurança do Administrador
  // ---------------------------------------------------------------------------
  console.log('\n--- 4. Preservação de Regras Existentes: Proteção Estrita do Administrador ---');
  const resUnauthAdmin = await invokeExpressRoute(
    app,
    'POST',
    '/api/auth/login',
    { Authorization: 'Bearer valid-teacher-token' },
    { email: testTeacherEmail, role: 'admin', uid: testTeacherUid }
  );

  assert(resUnauthAdmin.status === 403, 'Tentativa de acessar como admin sem claim retorna 403 Forbidden');
  assert(resUnauthAdmin.body.code === 'ADMIN_ACCESS_DENIED', 'Código de erro ADMIN_ACCESS_DENIED retornado');

  // ---------------------------------------------------------------------------
  // 5. Preservação de Regras Existentes: Acesso do Estudante Legítimo
  // ---------------------------------------------------------------------------
  console.log('\n--- 5. Preservação de Regras Existentes: Estudante Autêntico ---');
  const resStudentLogin = await invokeExpressRoute(
    app,
    'POST',
    '/api/auth/login',
    { Authorization: 'Bearer valid-student-token' },
    { email: 'student@simpleenglish.com', role: 'student', uid: 'student-uid-999' }
  );

  assert(resStudentLogin.status === 200, 'POST /api/auth/login de estudante retorna 200 OK');
  assert(resStudentLogin.body.account?.role === 'student', 'Estudante acessa com role="student"');
  assert(Boolean(resStudentLogin.body.profile), 'Perfil de estudante devidamente gerado e mantido');

  resetFirebaseAdminForTesting();

  console.log('\n================================================================================');
  console.log(`TOTAL DE TESTES: ${passed + failed} | SUCESSO: ${passed} | FALHAS: ${failed}`);
  console.log('================================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
  process.exit(0);
}

runNativeFriendLoginTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
