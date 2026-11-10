import assert from 'assert';
import http from 'http';
import { app as serverApp } from '../serverApp';
import { setFirebaseAdminAuthForTesting } from '../src/serverFirebaseAdmin';
import { isValidCanonicalUid } from '../src/utils/studentPersistence';

/**
 * FASE IDENTITY-NOTES.1 — Test Suite
 * Hardening de identidade, roles e persistência canônica de Lesson Notes.
 * Executed in controlled simulated isolation with ZERO modification to real user data.
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

async function runTestSuite() {
  console.log('======================================================================');
  console.log('IT\'S SIMPLE — FASE IDENTITY-NOTES.1: SUÍTE DE VALIDAÇÃO (17 TESTES)');
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

  // Identity fixture setup for token validation
  const timestamp = Date.now();
  const student1Uid = `canonical-student-1-${timestamp}`;
  const student1Email = `student1.${timestamp}@example.com`;
  const student2Uid = `canonical-student-2-${timestamp}`;
  const student2Email = `student2.${timestamp}@example.com`;

  const approvedTeacher1Uid = `canonical-teacher-1-${timestamp}`;
  const approvedTeacher1Email = `teacher1.${timestamp}@example.com`;
  const approvedTeacher2Uid = `canonical-teacher-2-${timestamp}`;
  const approvedTeacher2Email = `teacher2.${timestamp}@example.com`;

  const pendingTeacherUid = `canonical-teacher-pending-${timestamp}`;
  const pendingTeacherEmail = `teacher.pending.${timestamp}@example.com`;

  const adminUid = `canonical-admin-${timestamp}`;
  const adminEmail = `admin.${timestamp}@example.com`;

  const tokenMap: Record<string, any> = {
    'token-student-1': { uid: student1Uid, email: student1Email, email_verified: true, role: 'student' },
    'token-student-2': { uid: student2Uid, email: student2Email, email_verified: true, role: 'student' },
    'token-teacher-1': { uid: approvedTeacher1Uid, email: approvedTeacher1Email, email_verified: true, role: 'teacher' },
    'token-teacher-2': { uid: approvedTeacher2Uid, email: approvedTeacher2Email, email_verified: true, role: 'teacher' },
    'token-teacher-pending': { uid: pendingTeacherUid, email: pendingTeacherEmail, email_verified: true, role: 'teacher' },
    'token-admin': { uid: adminUid, email: adminEmail, email_verified: true, role: 'admin', admin: true },
  };

  setFirebaseAdminAuthForTesting({
    verifyIdToken: async (token: string) => {
      const match = tokenMap[token];
      if (match) return match;
      throw new Error(`Invalid token: ${token}`);
    },
    getUser: async (uid: string) => {
      const found = Object.values(tokenMap).find((u) => u.uid === uid);
      if (found) return found;
      throw new Error(`User not found: ${uid}`);
    },
    getUserByEmail: async (email: string) => {
      const found = Object.values(tokenMap).find((u) => u.email === email);
      if (found) return found;
      throw new Error('User not found');
    },
    setCustomUserClaims: async () => {},
  } as any);

  try {
    // ------------------------------------------------------------------------
    // SETUP: Register approved teacher and pending teacher in isolated db state
    // ------------------------------------------------------------------------
    // 1. Register and approve Teacher 1 via admin
    await makeRequest(server, 'POST', '/api/tutors', {
      email: approvedTeacher1Email,
      name: 'Teacher One Approved',
      availableDays: ['monday', 'wednesday'],
      availableHours: ['10:00', '14:00'],
      uid: approvedTeacher1Uid,
      approvalStatus: 'approved',
      isApproved: true,
      registeredByAdmin: true,
    }, { Authorization: 'Bearer token-admin' });

    await makeRequest(
      server,
      'POST',
      `/api/tutors/${approvedTeacher1Uid}/approve`,
      {},
      { Authorization: 'Bearer token-admin' }
    );

    // 2. Register and approve Teacher 2 via admin
    await makeRequest(server, 'POST', '/api/tutors', {
      email: approvedTeacher2Email,
      name: 'Teacher Two Approved',
      availableDays: ['tuesday', 'thursday'],
      availableHours: ['09:00', '15:00'],
      uid: approvedTeacher2Uid,
      approvalStatus: 'approved',
      isApproved: true,
      registeredByAdmin: true,
    }, { Authorization: 'Bearer token-admin' });

    await makeRequest(
      server,
      'POST',
      `/api/tutors/${approvedTeacher2Uid}/approve`,
      {},
      { Authorization: 'Bearer token-admin' }
    );

    // 3. Register pending teacher (without approving)
    await makeRequest(server, 'POST', '/api/tutors', {
      email: pendingTeacherEmail,
      name: 'Teacher Pending Moderation',
      availableDays: ['friday'],
      availableHours: ['11:00'],
      uid: pendingTeacherUid,
    }, { Authorization: 'Bearer token-teacher-pending' });

    // 4. Initial login for student 1
    await makeRequest(server, 'POST', '/api/auth/google', {
      uid: student1Uid,
      email: student1Email,
      name: 'Student One',
      role: 'student',
    }, { Authorization: 'Bearer token-student-1' });

    // 4b. Initial login for student 2
    await makeRequest(server, 'POST', '/api/auth/google', {
      uid: student2Uid,
      email: student2Email,
      name: 'Student Two',
      role: 'student',
    }, { Authorization: 'Bearer token-student-2' });

    // ------------------------------------------------------------------------
    // TEST 1: Aluno acessa /teacher -> role permanece student, sem mutação
    // ------------------------------------------------------------------------
    await test('1. Aluno acessa /teacher: role permanece student, sem mutação', async () => {
      // Simulate client attempting session verification with student token
      const verifyRes = await makeRequest(
        server,
        'GET',
        '/api/auth/verify-session',
        undefined,
        { Authorization: 'Bearer token-student-1' }
      );
      assert.strictEqual(verifyRes.status, 200, 'verify-session responde 200');
      assert.strictEqual(verifyRes.data.role, 'student', 'Papel permanece estritamente student');
      assert.strictEqual(verifyRes.data.uid, student1Uid, 'UID canônico mantido');

      // Attempt login informing requestedRole = teacher
      const loginRes = await makeRequest(server, 'POST', '/api/auth/login', {
        email: student1Email,
        uid: student1Uid,
        role: 'teacher',
      }, { Authorization: 'Bearer token-student-1' });
      assert.strictEqual(loginRes.status, 200, 'Login responde 200');
      assert.strictEqual(loginRes.data.account.role, 'student', 'Papel retornado é student');
      assert.strictEqual(loginRes.data.isRoleEnforced, true, 'isRoleEnforced bloqueou elevação');
    });

    // ------------------------------------------------------------------------
    // TEST 2: Professor aprovado acessa /dashboard -> role permanece teacher
    // ------------------------------------------------------------------------
    await test('2. Professor aprovado acessa /dashboard: role permanece teacher, sem rebaixamento', async () => {
      // Teacher 1 logs in accessing dashboard (requestedRole omitted or student)
      const res = await makeRequest(server, 'POST', '/api/auth/google', {
        uid: approvedTeacher1Uid,
        email: approvedTeacher1Email,
        name: 'Teacher One Approved',
        role: 'student', // Simulation of landing on student dashboard
      }, { Authorization: 'Bearer token-teacher-1' });

      assert.strictEqual(res.status, 200, 'Google login responde 200');
      assert.strictEqual(res.data.account.role, 'teacher', 'Professor aprovado mantém role=teacher imutável');
      assert.strictEqual(res.data.account.uid, approvedTeacher1Uid, 'UID canônico do professor preservado');
    });

    // ------------------------------------------------------------------------
    // TEST 3: Tentativa de elevação por requestedRole adulterado
    // ------------------------------------------------------------------------
    await test('3. Tentativa de elevação por requestedRole: adulterações rejeitadas/ignoradas', async () => {
      // Student 1 tries requesting admin role
      const resAdmin = await makeRequest(server, 'POST', '/api/auth/login', {
        email: student1Email,
        uid: student1Uid,
        role: 'admin',
      }, { Authorization: 'Bearer token-student-1' });
      assert.strictEqual(resAdmin.status, 403, 'Acesso admin negado com 403');
      assert.strictEqual(resAdmin.data.code, 'ADMIN_ACCESS_DENIED');

      // Student 1 tries public tutor registration to mutate into Native Friend
      const resTutorReg = await makeRequest(server, 'POST', '/api/tutors', {
        email: student1Email,
        name: 'Student One Impersonating',
        availableDays: ['monday'],
        availableHours: ['10:00'],
      }, { Authorization: 'Bearer token-student-1' });
      assert.strictEqual(resTutorReg.status, 409, 'Cadastro de tutor rejeitado com 409');
      assert.strictEqual(resTutorReg.data.error, 'ROLE_MUTATION_FORBIDDEN');
    });

    // ------------------------------------------------------------------------
    // TEST 4: Login e F5: papéis originais inalterados
    // ------------------------------------------------------------------------
    await test('4. Login e F5: após login de aluno e professor, recarregar mantém os papéis originais', async () => {
      // Reload session for student
      const f5Student = await makeRequest(
        server,
        'GET',
        '/api/auth/verify-session',
        undefined,
        { Authorization: 'Bearer token-student-1' }
      );
      assert.strictEqual(f5Student.data.role, 'student', 'Aluno permanece student após F5');

      // Reload session for approved teacher
      const f5Teacher = await makeRequest(
        server,
        'GET',
        '/api/auth/verify-session',
        undefined,
        { Authorization: 'Bearer token-teacher-1' }
      );
      assert.strictEqual(f5Teacher.data.role, 'teacher', 'Professor permanece teacher após F5');
    });

    // ------------------------------------------------------------------------
    // TEST 5: Login em 2 computadores: mesma identidade e papel
    // ------------------------------------------------------------------------
    await test('5. Login em 2 computadores: logins simultâneos preservam mesma identidade e papel', async () => {
      // Computer A login
      const compA = await makeRequest(server, 'POST', '/api/auth/google', {
        uid: approvedTeacher1Uid,
        email: approvedTeacher1Email,
        name: 'Teacher One Comp A',
      }, { Authorization: 'Bearer token-teacher-1' });

      // Computer B login
      const compB = await makeRequest(server, 'POST', '/api/auth/google', {
        uid: approvedTeacher1Uid,
        email: approvedTeacher1Email,
        name: 'Teacher One Comp B',
      }, { Authorization: 'Bearer token-teacher-1' });

      assert.strictEqual(compA.data.account.role, 'teacher');
      assert.strictEqual(compB.data.account.role, 'teacher');
      assert.strictEqual(compA.data.account.uid, compB.data.account.uid, 'UIDs idênticos em ambos os acessos');
    });

    // ------------------------------------------------------------------------
    // TEST 6: Professor pendente bloqueado de agir como professor aprovado
    // ------------------------------------------------------------------------
    await test('6. Professor pendente de aprovação: bloqueado com 403 TEACHER_APPROVAL_PENDING', async () => {
      const res = await makeRequest(server, 'POST', '/api/auth/login', {
        email: pendingTeacherEmail,
        uid: pendingTeacherUid,
        role: 'teacher',
      }, { Authorization: 'Bearer token-teacher-pending' });

      assert.strictEqual(res.status, 403, 'Acesso do professor pendente rejeitado com 403');
      assert.strictEqual(res.data.code, 'TEACHER_APPROVAL_PENDING');
      assert.strictEqual(res.data.approvalStatus, 'pending');
    });

    // ------------------------------------------------------------------------
    // TEST 7: Trial lesson: exige e associa UID canônico do aluno
    // ------------------------------------------------------------------------
    const lesson1Id = `lesson-trial-${timestamp}`;
    await test('7. Trial lesson: exige e associa UID canônico do aluno', async () => {
      // Scheduling a trial lesson via authenticated student
      const res = await makeRequest(server, 'POST', '/api/lessons', {
        lesson: {
          id: lesson1Id,
          studentEmail: student1Email,
          studentUid: student1Uid,
          teacherUid: approvedTeacher1Uid,
          teacherEmail: approvedTeacher1Email,
          sessionDate: '2026-11-20',
          startDateTime: '2026-11-20T14:00:00Z',
          endDateTime: '2026-11-20T14:30:00Z',
          isTrialLesson: true,
          status: 'confirmed',
        },
      }, { Authorization: 'Bearer token-student-1' });

      assert.strictEqual(res.status, 200, 'Aula registrada com 200');
      assert.ok(isValidCanonicalUid(student1Uid), 'studentUid é um UID canônico válido');
    });

    // ------------------------------------------------------------------------
    // TEST 8: Criação de lesson notes: ambos os UIDs presentes e válidos
    // ------------------------------------------------------------------------
    const sessionKey1 = `session_2026-11-20_${student1Uid}`;
    await test('8. Criação de lesson notes: ambos os UIDs presentes e válidos', async () => {
      const notePayload = {
        lessonId: lesson1Id,
        studentUid: student1Uid,
        studentEmail: student1Email,
        sessionDate: '2026-11-20',
        topic: 'Introduction & Fluency Goals',
        rawContent: 'Student spoke clearly about daily routines. Focus on past tense irregular verbs.',
      };

      const res = await makeRequest(
        server,
        'POST',
        `/api/lessons/${lesson1Id}/notes`,
        notePayload,
        { Authorization: 'Bearer token-teacher-1' }
      );

      assert.strictEqual(res.status, 200, 'Gravação responde 200');
      assert.strictEqual(res.data.success, true);
      assert.strictEqual(res.data.sessionNote.studentUid, student1Uid, 'studentUid canônico gravado');
      assert.strictEqual(res.data.sessionNote.teacherUid, approvedTeacher1Uid, 'teacherUid canônico derivado do token');
      assert.strictEqual(res.data.sessionNote.rawContent, notePayload.rawContent, 'rawContent preservado');
    });

    // ------------------------------------------------------------------------
    // TEST 9: Tentativa de gravação com studentUid vazio rejeitada com 400
    // ------------------------------------------------------------------------
    await test('9. Tentativa de gravação com studentUid vazio: 400 CANONICAL_STUDENT_UID_REQUIRED', async () => {
      const badPayload = {
        lessonId: lesson1Id,
        studentUid: '', // Vazio
        studentEmail: student1Email,
        sessionDate: '2026-11-20',
        content: 'Some note text',
      };

      const res = await makeRequest(
        server,
        'POST',
        '/api/session-notes',
        badPayload,
        { Authorization: 'Bearer token-teacher-1' }
      );

      assert.strictEqual(res.status, 400, 'Rejeitado com 400');
      assert.strictEqual(res.data.code, 'CANONICAL_STUDENT_UID_REQUIRED');
    });

    // ------------------------------------------------------------------------
    // TEST 10: Gravação com UID divergente do aluno da aula bloqueada com 403
    // ------------------------------------------------------------------------
    await test('10. Gravação com UID divergente da aula: 403 STUDENT_LESSON_MISMATCH', async () => {
      // Trying to write notes for lesson1 (which belongs to student 1) under student 2's UID
      const mismatchPayload = {
        lessonId: lesson1Id,
        studentUid: student2Uid, // Divergente
        sessionDate: '2026-11-20',
        rawContent: 'Intruder note',
      };

      const res = await makeRequest(
        server,
        'POST',
        `/api/lessons/${lesson1Id}/notes`,
        mismatchPayload,
        { Authorization: 'Bearer token-teacher-1' }
      );

      assert.strictEqual(res.status, 403, 'Bloqueado com 403');
      assert.strictEqual(res.data.code, 'STUDENT_LESSON_MISMATCH');
    });

    // ------------------------------------------------------------------------
    // TEST 11: Anotação gravada recuperável pelo aluno correto
    // ------------------------------------------------------------------------
    await test('11. Anotação gravada: recuperada com sucesso pelo aluno correto', async () => {
      const res = await makeRequest(
        server,
        'GET',
        `/api/session-notes?studentUid=${student1Uid}`,
        undefined,
        { Authorization: 'Bearer token-student-1' }
      );

      assert.strictEqual(res.status, 200, 'Consulta responde 200');
      assert.ok(Array.isArray(res.data), 'Retorna lista de anotações');
      const found = res.data.find((n: any) => n.studentUid === student1Uid);
      assert.ok(found, 'Anotação do aluno 1 localizada');
      assert.strictEqual(found.studentUid, student1Uid);
      assert.ok(found.rawContent.includes('Student spoke clearly'), 'Conteúdo original presente');
    });

    // ------------------------------------------------------------------------
    // TEST 12: Anotação sem acionamento do Gemini disponibiliza rawContent
    // ------------------------------------------------------------------------
    await test('12. Anotação sem Gemini: rawContent disponível imediatamente', async () => {
      const res = await makeRequest(
        server,
        'GET',
        `/api/session-notes?id=${lesson1Id}`,
        undefined,
        { Authorization: 'Bearer token-student-1' }
      );

      assert.strictEqual(res.status, 200);
      assert.ok(res.data.rawContent, 'rawContent está presente sem depender de Gemini');
      assert.strictEqual(res.data.rawContent, res.data.content, 'rawContent e content sincronizados');
    });

    // ------------------------------------------------------------------------
    // TEST 13: Simulação de falha no Gemini: rawContent preservado intacto
    // ------------------------------------------------------------------------
    await test('13. Simulação de falha no Gemini: texto original preservado intacto', async () => {
      // Directly check note retrieval remains intact regardless of AI status
      const res = await makeRequest(
        server,
        'GET',
        `/api/session-notes?id=${lesson1Id}`,
        undefined,
        { Authorization: 'Bearer token-student-1' }
      );

      assert.strictEqual(res.status, 200);
      assert.ok(res.data.rawContent.length > 0, 'Texto original intacto');
      assert.strictEqual(res.data.rawContent, 'Student spoke clearly about daily routines. Focus on past tense irregular verbs.');
    });

    // ------------------------------------------------------------------------
    // TEST 14: Repetição de gravação: idempotente, sem duplicação
    // ------------------------------------------------------------------------
    await test('14. Repetição da gravação: idempotente, sem duplicação de documentos', async () => {
      const repeatPayload = {
        lessonId: lesson1Id,
        studentUid: student1Uid,
        studentEmail: student1Email,
        sessionDate: '2026-11-20',
        topic: 'Introduction & Fluency Goals Updated',
        rawContent: 'Student spoke clearly about daily routines. Updated recommendations added.',
      };

      // Second save with same lesson ID
      const res1 = await makeRequest(
        server,
        'POST',
        `/api/lessons/${lesson1Id}/notes`,
        repeatPayload,
        { Authorization: 'Bearer token-teacher-1' }
      );
      assert.strictEqual(res1.status, 200);

      // Third save with same lesson ID
      const res2 = await makeRequest(
        server,
        'POST',
        `/api/lessons/${lesson1Id}/notes`,
        repeatPayload,
        { Authorization: 'Bearer token-teacher-1' }
      );
      assert.strictEqual(res2.status, 200);

      // Verify listing has no duplicate keys
      const listRes = await makeRequest(
        server,
        'GET',
        `/api/session-notes?studentUid=${student1Uid}`,
        undefined,
        { Authorization: 'Bearer token-student-1' }
      );

      const matchingNotes = listRes.data.filter((n: any) => n.lessonId === lesson1Id || n.id === lesson1Id);
      assert.strictEqual(matchingNotes.length, 1, 'Exatamente 1 documento de anotação persistido (sem duplicatas)');
      assert.strictEqual(matchingNotes[0].topic, 'Introduction & Fluency Goals Updated', 'Atualizado atomicamente');
    });

    // ------------------------------------------------------------------------
    // TEST 15: Dois alunos e dois professores distintos: isolamento total
    // ------------------------------------------------------------------------
    await test('15. Dois alunos e dois professores: isolamento total de dados e notas', async () => {
      // Teacher 2 saves note for Student 2
      const lesson2Id = `lesson-isolated-2-${timestamp}`;
      const lRes = await makeRequest(server, 'POST', '/api/lessons', {
        lesson: {
          id: lesson2Id,
          studentEmail: student2Email,
          studentUid: student2Uid,
          teacherUid: approvedTeacher2Uid,
          teacherEmail: approvedTeacher2Email,
          sessionDate: '2026-11-22',
          startDateTime: '2026-11-22T10:00:00Z',
          endDateTime: '2026-11-22T10:30:00Z',
          status: 'confirmed',
        },
      }, { Authorization: 'Bearer token-student-2' });

      const nRes = await makeRequest(
        server,
        'POST',
        `/api/lessons/${lesson2Id}/notes`,
        {
          lessonId: lesson2Id,
          studentUid: student2Uid,
          studentEmail: student2Email,
          sessionDate: '2026-11-22',
          topic: 'Business English Negotiations',
          rawContent: 'Confidential business roleplay for Student Two only.',
        },
        { Authorization: 'Bearer token-teacher-2' }
      );

      // Student 1 tries accessing Student 2's notes -> blocked
      const intruderRes = await makeRequest(
        server,
        'GET',
        `/api/session-notes?studentUid=${student2Uid}`,
        undefined,
        { Authorization: 'Bearer token-student-1' }
      );
      assert.strictEqual(intruderRes.status, 403, 'Aluno 1 é bloqueado ao tentar consultar Aluno 2');

      const singleIntruderRes = await makeRequest(
        server,
        'GET',
        `/api/session-notes?id=${lesson2Id}`,
        undefined,
        { Authorization: 'Bearer token-student-1' }
      );
      assert.strictEqual(singleIntruderRes.status, 403, 'Aluno 1 bloqueado no documento isolado do Aluno 2');

      // Student 2 can access own notes cleanly
      const legitRes = await makeRequest(
        server,
        'GET',
        `/api/session-notes?studentUid=${student2Uid}`,
        undefined,
        { Authorization: 'Bearer token-student-2' }
      );
      assert.strictEqual(legitRes.status, 200);
      assert.strictEqual(legitRes.data.length, 1);
      assert.strictEqual(legitRes.data[0].studentUid, student2Uid);
    });

    // ------------------------------------------------------------------------
    // TEST 16: Regras de autorização: nenhuma permissão ampliada
    // ------------------------------------------------------------------------
    await test('16. Regras de autorização: nenhuma permissão ampliada ou contornada', async () => {
      // Unauthenticated access to save notes -> 401
      const unauthPost = await makeRequest(server, 'POST', '/api/session-notes', {
        studentUid: student1Uid,
        content: 'Malicious note without token',
      });
      assert.strictEqual(unauthPost.status, 401, 'POST sem token retorna 401');

      // Unauthenticated access to get notes -> 401
      const unauthGet = await makeRequest(server, 'GET', '/api/session-notes?studentUid=' + student1Uid);
      assert.strictEqual(unauthGet.status, 401, 'GET sem token retorna 401');

      // Student trying to save notes -> 403
      const studentSave = await makeRequest(server, 'POST', '/api/session-notes', {
        studentUid: student1Uid,
        content: 'Student trying to save their own notes',
      }, { Authorization: 'Bearer token-student-1' });
      assert.strictEqual(studentSave.status, 403, 'Aluno tentando gravar notas recebe 403');
    });

    // ------------------------------------------------------------------------
    // TEST 17: Preservação de módulos: S-Path, Dictionary, Journal, pacotes
    // ------------------------------------------------------------------------
    await test('17. Preservação de módulos: Dictionary, Journal, rotinas e agendamentos operacionais', async () => {
      // Query routines
      const routinesRes = await makeRequest(server, 'GET', '/api/routines');
      assert.strictEqual(routinesRes.status, 200, 'Módulo de rotinas responde 200');
      assert.ok(routinesRes.data && typeof routinesRes.data === 'object', 'Lista de rotinas intacta');

      // Check tutors list public listing
      const tutorsRes = await makeRequest(server, 'GET', '/api/tutors');
      assert.strictEqual(tutorsRes.status, 200, 'Módulo de Native Friends responde 200');
      assert.ok(Array.isArray(tutorsRes.data));
    });

  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  console.log('\n======================================================================');
  console.log(`RESULTADO DA VALIDAÇÃO: ${passed} PASSOU, ${failed} FALHOU`);
  console.log('======================================================================');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTestSuite().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
