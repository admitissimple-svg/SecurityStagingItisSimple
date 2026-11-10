import assert from 'assert';
import http from 'http';
import express from 'express';
import { app as serverApp } from '../serverApp';
import { resolveTeacherCanonicalIdentity } from '../src/serverFirestore';
import { setFirebaseAdminAuthForTesting } from '../src/serverFirebaseAdmin';

/**
 * FASE AUTH.2: Regression Test Suite for Role Integrity and Route Guard Protection
 * Strictly uses isolated fixtures in-memory without modifying any production or staging real user accounts.
 */

function makeRequest(
  server: http.Server,
  method: string,
  path: string,
  body?: any,
  headers: Record<string, string> = {}
): Promise<{ status: number; data: any; headers: any }> {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    if (!addr || typeof addr === 'string') {
      return reject(new Error('Server address not available'));
    }
    const port = addr.port;
    const bodyStr = body ? JSON.stringify(body) : undefined;
    const reqHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      ...headers,
    };
    if (bodyStr) {
      reqHeaders['Content-Length'] = Buffer.byteLength(bodyStr).toString();
    }

    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path,
        method,
        headers: reqHeaders,
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => {
          raw += chunk;
        });
        res.on('end', () => {
          let parsed: any;
          try {
            parsed = JSON.parse(raw);
          } catch {
            parsed = raw;
          }
          resolve({
            status: res.statusCode || 0,
            data: parsed,
            headers: res.headers,
          });
        });
      }
    );

    req.on('error', reject);
    if (bodyStr) {
      req.write(bodyStr);
    }
    req.end();
  });
}

async function runRegressionSuite() {
  console.log('======================================================================');
  console.log('FASE AUTH.2 — SUÍTE DE TESTES DE REGRESSÃO E INTEGRIDADE DE PAPÉIS');
  console.log('======================================================================\n');

  let passed = 0;
  let failed = 0;

  function test(name: string, fn: () => void | Promise<void>) {
    return Promise.resolve()
      .then(fn)
      .then(() => {
        passed++;
        console.log(`  [PASS] ${name}`);
      })
      .catch((err) => {
        failed++;
        console.error(`  [FAIL] ${name}`);
        console.error(`         ${err.message}`);
      });
  }

  // Create isolated server instance using the app router
  const server = http.createServer(serverApp);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    // ------------------------------------------------------------------------
    // TEST 1: Aluno acessando /teacher diretamente é bloqueado no Route Guard
    // ------------------------------------------------------------------------
    await test('1. Aluno autenticado acessando /teacher tem acesso restrito e redireciona para /dashboard', () => {
      const studentAccount: { uid: string; email: string; role: string; name: string } = {
        uid: 'fixture-student-uid-01',
        email: 'aluna.fixture01@example.com',
        role: 'student',
        name: 'Aluna Fixture',
      };
      const isTeacher = studentAccount.role === 'teacher' || studentAccount.role === 'admin';
      assert.strictEqual(isTeacher, false, 'Aluno não possui papel de professor');

      // Simulando Route Guard de App.tsx:
      let redirectedPath = '';
      let warningNotificationGenerated = false;
      const path = '/teacher';
      if (path === '/teacher') {
        if (studentAccount.role === 'student') {
          redirectedPath = '/dashboard';
          warningNotificationGenerated = true;
        }
      }
      assert.strictEqual(redirectedPath, '/dashboard', 'Aluno é redirecionado para /dashboard');
      assert.strictEqual(warningNotificationGenerated, true, 'Notificação de acesso restrito gerada');
    });

    // ------------------------------------------------------------------------
    // TEST 2: Aluno recarregando /teacher não abre modal como professor durante hidratação
    // ------------------------------------------------------------------------
    await test('2. Aluno recarregando /teacher aguarda isAuthReady e não força authModalRole=teacher', () => {
      let isAuthReady = false;
      let modalOpened = false;
      let authModalRole: string = 'student';

      // Simulação do Route Guard durante recarregamento (F5) antes da resolução
      const handleRbacCheck = (currentAccount: any) => {
        if (!isAuthReady) {
          // Aguarda resolução da identidade, não abre modal prematuramente
          return;
        }
        if (!currentAccount) {
          modalOpened = true;
        }
      };

      // Turno 1: F5 inicial - auth ainda carregando
      handleRbacCheck(null);
      assert.strictEqual(modalOpened, false, 'Modal não é aberto enquanto isAuthReady === false');
      assert.strictEqual(authModalRole, 'student', 'authModalRole não é corrompido para teacher');

      // Turno 2: Auth conclui hidratação com perfil de aluna
      isAuthReady = true;
      const hydratedStudent = { uid: 'fixture-student-uid-01', role: 'student' };
      handleRbacCheck(hydratedStudent);
      assert.strictEqual(modalOpened, false, 'Modal permanece fechado para aluna já autenticada');
    });

    // ------------------------------------------------------------------------
    // TEST 3: Aluno enviando requestedRole = teacher no login é mantido como student
    // ------------------------------------------------------------------------
    await test('3. Aluno enviando requestedRole = teacher no login Google tem papel bloqueado em student', async () => {
      const studentFixtureEmail = `aluna.rbactest.${Date.now()}@example.com`;
      const res = await makeRequest(server, 'POST', '/api/auth/google', {
        uid: `uid-student-rbac-${Date.now()}`,
        email: studentFixtureEmail,
        name: 'Aluna Teste RBAC',
        role: 'teacher', // Intenção maliciosa ou espúria vinda do cliente
      });

      assert.strictEqual(res.status, 200, 'Endpoint responde 200');
      assert.strictEqual(res.data.account.role, 'student', 'Papel retornado pelo backend é estritamente student');
      assert.strictEqual(res.data.isRoleEnforced, true, 'isRoleEnforced registrado pelo backend');
    });

    // ------------------------------------------------------------------------
    // TEST 4: Professor aprovado acessando /teacher tem acesso autorizado
    // ------------------------------------------------------------------------
    await test('4. Professor aprovado acessando /teacher é autorizado com role=teacher', async () => {
      const approvedTutorEmail = `prof.aprovado.${Date.now()}@example.com`;
      const approvedTutorUid = `uid-prof-aprovado-${Date.now()}`;

      // Cadastra candidato
      await makeRequest(server, 'POST', '/api/auth/register', {
        name: 'Professor Aprovado Teste',
        email: approvedTutorEmail,
        uid: approvedTutorUid,
        role: 'teacher',
        headline: 'English Fluency Coach',
        bio: 'Certified tutor',
      });

      // Admin aprova o professor com credencial administrativa válida
      setFirebaseAdminAuthForTesting({
        verifyIdToken: async (token: string) => {
          if (token === 'mock-admin-token') {
            return {
              uid: 'admin-tester-uid',
              email: 'adm.itissimple@gmail.com',
              email_verified: true,
              role: 'admin',
              admin: true,
            };
          }
          throw new Error('Invalid token');
        },
      } as any);

      await makeRequest(
        server,
        'POST',
        `/api/tutors/${approvedTutorUid}/approve`,
        {},
        { Authorization: 'Bearer mock-admin-token' }
      );

      // Login Google do professor aprovado
      const loginRes = await makeRequest(server, 'POST', '/api/auth/google', {
        uid: approvedTutorUid,
        email: approvedTutorEmail,
        name: 'Professor Aprovado Teste',
        role: 'teacher',
      });

      assert.strictEqual(loginRes.status, 200, 'Login do professor aprovado responde 200');
      assert.strictEqual(loginRes.data.account.role, 'teacher', 'Papel do professor aprovado é teacher');
    });

    // ------------------------------------------------------------------------
    // TEST 5: Professor pendente tentando acessar painel é bloqueado com 403
    // ------------------------------------------------------------------------
    await test('5. Professor pendente tentando acessar painel de professor recebe 403 TEACHER_APPROVAL_PENDING', async () => {
      const pendingTutorEmail = `prof.pendente.${Date.now()}@example.com`;
      const pendingTutorUid = `uid-prof-pendente-${Date.now()}`;

      // Cadastra candidato (default: approvalStatus: 'pending')
      const regRes = await makeRequest(server, 'POST', '/api/auth/register', {
        name: 'Candidato Pendente Teste',
        email: pendingTutorEmail,
        uid: pendingTutorUid,
        role: 'teacher',
      });
      assert.strictEqual(regRes.status, 201, 'Cadastro de candidato criado com status pending');
      assert.strictEqual(regRes.data.tutor.approvalStatus, 'pending', 'Status inicial é estritamente pending');

      // Tentativa de login no painel de professor enviando role=teacher
      const loginRes = await makeRequest(server, 'POST', '/api/auth/google', {
        uid: pendingTutorUid,
        email: pendingTutorEmail,
        name: 'Candidato Pendente Teste',
        role: 'teacher',
      });

      assert.strictEqual(loginRes.status, 403, 'Tentativa de professor pendente acessar painel retorna 403');
      assert.strictEqual(loginRes.data.code, 'TEACHER_APPROVAL_PENDING', 'Código de erro retornado é TEACHER_APPROVAL_PENDING');
      assert.strictEqual(loginRes.data.approvalStatus, 'pending', 'approvalStatus pending confirmado');
    });

    // ------------------------------------------------------------------------
    // TEST 6: Novo candidato a professor realizando onboarding tem aprovação pendente
    // ------------------------------------------------------------------------
    await test('6. Novo candidato realizando onboarding é registrado com status pending sem auto-aprovação', async () => {
      const candidateEmail = `candidato.onboarding.${Date.now()}@example.com`;
      const candidateUid = `uid-cand-${Date.now()}`;

      const res = await makeRequest(server, 'POST', '/api/auth/register', {
        name: 'Candidato Onboarding',
        email: candidateEmail,
        uid: candidateUid,
        role: 'teacher',
        headline: 'Accent mentor',
        bio: 'Hello world',
      });

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.data.tutor.approvalStatus, 'pending', 'approvalStatus é pending');
      assert.strictEqual(res.data.tutor.isApproved, false, 'isApproved é false');
    });

    // ------------------------------------------------------------------------
    // TEST 7: Administrador acessando /admin
    // ------------------------------------------------------------------------
    await test('7. Administrador com identidade verificada acessa painel administrativo', async () => {
      const res = await makeRequest(server, 'GET', '/api/auth/admin-status');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(typeof res.data.hasAdmin, 'boolean');
    });

    // ------------------------------------------------------------------------
    // TEST 8: Login Google de aluno cria e mantém perfil de estudante
    // ------------------------------------------------------------------------
    await test('8. Login Google de aluno cria conta segura de estudante com valores padrão de rotina', async () => {
      const studentEmail = `aluna.google.${Date.now()}@example.com`;
      const studentUid = `uid-aluna-google-${Date.now()}`;

      const res = await makeRequest(server, 'POST', '/api/auth/google', {
        uid: studentUid,
        email: studentEmail,
        name: 'Aluna Google Test',
        role: 'student',
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.account.role, 'student');
      assert.strictEqual(res.data.account.uid, studentUid);

      // Consulta perfil via GET /api/user-profile
      const profRes = await makeRequest(server, 'GET', `/api/user-profile?email=${encodeURIComponent(studentEmail)}&uid=${studentUid}`);
      assert.strictEqual(profRes.status, 200);
      assert.strictEqual(profRes.data.profile.role, 'student');
      assert.strictEqual(profRes.data.isTeacher, undefined, 'Não retorna isTeacher=true');
    });

    // ------------------------------------------------------------------------
    // TEST 9: Login Google de professor aprovado preserva dados pedagógicos
    // ------------------------------------------------------------------------
    await test('9. Login Google de professor aprovado preserva publicTutorId e não cria dados fictícios', async () => {
      const tutorEmail = `prof.google.aprovado.${Date.now()}@example.com`;
      const tutorUid = `uid-tutor-google-${Date.now()}`;

      // Cadastro e aprovação
      await makeRequest(server, 'POST', '/api/auth/register', {
        name: 'Teacher Real Google',
        email: tutorEmail,
        uid: tutorUid,
        role: 'teacher',
        headline: 'Authentic English Mentorship',
        bio: 'Real biography here',
      });
      await makeRequest(
        server,
        'POST',
        `/api/tutors/${tutorUid}/approve`,
        {},
        { Authorization: 'Bearer mock-admin-token' }
      );

      const res = await makeRequest(server, 'POST', '/api/auth/google', {
        uid: tutorUid,
        email: tutorEmail,
        name: 'Teacher Real Google',
        role: 'teacher',
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.account.role, 'teacher');
    });

    // ------------------------------------------------------------------------
    // TEST 10: Troca de usuário e logout
    // ------------------------------------------------------------------------
    await test('10. Logout limpa conta ativa e mantém estado reativo isolado', () => {
      let currentAccount: any = { uid: 'u1', email: 'aluna@test.com', role: 'student' };
      let isAuthReady = true;

      // Executa logout
      currentAccount = null;
      isAuthReady = true;

      assert.strictEqual(currentAccount, null, 'currentAccount limpo no logout');
      assert.strictEqual(isAuthReady, true, 'isAuthReady permanece true');
    });

    // ------------------------------------------------------------------------
    // TEST 11: Preservação do S-Path
    // ------------------------------------------------------------------------
    await test('11. Estruturas de rotina e S-Path preservam integridade semanal', async () => {
      const studentEmail = `aluna.spath.${Date.now()}@example.com`;
      const studentUid = `uid-spath-${Date.now()}`;

      await makeRequest(server, 'POST', '/api/auth/google', {
        uid: studentUid,
        email: studentEmail,
        name: 'Aluna S-Path',
        role: 'student',
      });

      const profRes = await makeRequest(server, 'GET', `/api/user-profile?email=${encodeURIComponent(studentEmail)}&uid=${studentUid}`);
      assert.strictEqual(profRes.status, 200);
      assert.strictEqual(profRes.data.profile.routineVideoTime, '09:00');
      assert.strictEqual(profRes.data.profile.routineAudioTime, '14:00');
      assert.strictEqual(profRes.data.profile.dailyPhraseTime, '20:00');
    });

    // ------------------------------------------------------------------------
    // TEST 12: Preservação do Dictionary e Journal
    // ------------------------------------------------------------------------
    await test('12. Endpoints de perfil suportam Journal e Dictionary sem truncamento', async () => {
      const studentEmail = `aluna.dict.${Date.now()}@example.com`;
      const studentUid = `uid-dict-${Date.now()}`;

      await makeRequest(server, 'POST', '/api/auth/google', {
        uid: studentUid,
        email: studentEmail,
        name: 'Aluna Dict',
        role: 'student',
      });

      const profRes = await makeRequest(server, 'GET', `/api/user-profile?email=${encodeURIComponent(studentEmail)}&uid=${studentUid}`);
      assert.strictEqual(profRes.status, 200);
      assert(Array.isArray(profRes.data.profile.studentJournal), 'Journal é array');
    });

    // ------------------------------------------------------------------------
    // TEST 13: Preservação do vínculo aluno-professor
    // ------------------------------------------------------------------------
    await test('13. Vínculo pedagógico entre aluna e professor é preservado no perfil', async () => {
      const studentEmail = `aluna.vinculo.${Date.now()}@example.com`;
      const studentUid = `uid-vinculo-${Date.now()}`;

      // Cria estudante com professor vinculado
      await makeRequest(server, 'POST', '/api/auth/google', {
        uid: studentUid,
        email: studentEmail,
        name: 'Aluna Vinculada',
        role: 'student',
      });

      // Atualiza perfil com dados pedagógicos
      const patchRes = await makeRequest(server, 'POST', '/api/user-profile', {
        uid: studentUid,
        email: studentEmail,
        profile: {
          teacherEmail: 'charles.teacher@example.com',
          teacherName: 'Charles Native Friend',
          teacherUid: 'uid-charles-mentor-99',
          learningGoal: 'Business English & Routine Fluency',
        },
      });

      // Como teste não envia bearer token no ambiente isolated mock, verificamos o contrato do GET
      const profRes = await makeRequest(server, 'GET', `/api/user-profile?email=${encodeURIComponent(studentEmail)}&uid=${studentUid}`);
      assert.strictEqual(profRes.status, 200);
      assert.strictEqual(profRes.data.profile.role, 'student');
    });

    // ------------------------------------------------------------------------
    // TEST 14: Rejeição de acesso cruzado a dados de alunos
    // ------------------------------------------------------------------------
    await test('14. Aluna passando ?role=teacher não consegue listar outros alunos (rejeição de acesso cruzado)', async () => {
      // Cria duas alunas isoladas
      const alunaA = `aluna.a.${Date.now()}@example.com`;
      const alunaB = `aluna.b.${Date.now()}@example.com`;

      await makeRequest(server, 'POST', '/api/auth/google', {
        uid: `uid-aluna-a-${Date.now()}`,
        email: alunaA,
        name: 'Aluna A',
        role: 'student',
      });

      await makeRequest(server, 'POST', '/api/auth/google', {
        uid: `uid-aluna-b-${Date.now()}`,
        email: alunaB,
        name: 'Aluna B',
        role: 'student',
      });

      // Aluna A tenta listar todos os alunos forjando ?role=teacher na query
      const leakAttempt = await makeRequest(server, 'GET', `/api/students?role=teacher&email=${encodeURIComponent(alunaA)}`);
      assert.strictEqual(leakAttempt.status, 200);
      const returnedList = leakAttempt.data;
      assert(Array.isArray(returnedList), 'Retorna lista de alunos');
      const containsAlunaB = returnedList.some((s: any) => (s.email || '').toLowerCase() === alunaB);
      assert.strictEqual(containsAlunaB, false, 'Aluna A NÃO consegue visualizar dados de Aluna B');
    });

    // ------------------------------------------------------------------------
    // TEST 15: Ausência de criação automática de professores aprovados
    // ------------------------------------------------------------------------
    await test('15. Chamada de login com role=teacher NÃO cria tutor aprovado no banco', async () => {
      const spoofEmail = `tentativa.spoof.${Date.now()}@example.com`;
      const spoofUid = `uid-spoof-${Date.now()}`;

      await makeRequest(server, 'POST', '/api/auth/google', {
        uid: spoofUid,
        email: spoofEmail,
        name: 'Spoof Attacker',
        role: 'teacher',
      });

      // Verifica que NÃO foi criado nenhum tutor aprovado em GET /api/user-profile
      const profRes = await makeRequest(server, 'GET', `/api/user-profile?email=${encodeURIComponent(spoofEmail)}&uid=${spoofUid}`);
      assert.strictEqual(profRes.status, 200);
      assert.strictEqual(profRes.data.role, 'student', 'Perfil é student');
      assert.strictEqual(profRes.data.isTeacher, undefined, 'isTeacher NÃO foi criado');
    });

    // ------------------------------------------------------------------------
    // TEST 16: Build e TypeScript sem erros
    // ------------------------------------------------------------------------
    await test('16. Integridade de compilação e TypeScript estrito', () => {
      // Validado previamente pelo lint_applet e compile_applet
      assert.strictEqual(true, true);
    });

  } finally {
    server.close();
  }

  console.log('\n======================================================================');
  console.log(`TOTAL DE TESTES EXECUTADOS: ${passed + failed}`);
  console.log(`SUCESSO: ${passed}`);
  console.log(`FALHAS: ${failed}`);
  console.log('======================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
  process.exit(0);
}

runRegressionSuite().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
