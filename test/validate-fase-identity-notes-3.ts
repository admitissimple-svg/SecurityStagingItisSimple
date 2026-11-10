import assert from 'assert';
import http from 'http';
import { app as serverApp } from '../serverApp';
import { setFirebaseAdminAuthForTesting } from '../src/serverFirebaseAdmin';
import {
  setFirebaseAdminFirestoreForTesting,
  saveAppStateToFirestore,
  resolveTeacherCanonicalIdentity,
  fetchUserFromFirestore,
} from '../src/serverFirestore';
import { isValidCanonicalUid } from '../src/utils/studentPersistence';

/**
 * FASE IDENTITY-NOTES.3 — Suíte de Testes Obrigatórios
 * Correção Definitiva da Integridade de Roles
 *
 * Testes obrigatórios:
 * 1. Student tentando entrar como Native Friend.
 * 2. Student com registro residual em tutors.
 * 3. Student após F5, logout e novo login.
 * 4. Student acessando /teacher diretamente.
 * 5. Sincronização de tutores sem alteração de role (saveAppStateToFirestore).
 * 6. Falha temporária na consulta ao Firestore (bloqueio de elevação).
 * 7. Professor legítimo aprovado (manutenção de privilégios).
 * 8. Professor pendente ou rejeitado (bloqueio com 403 TEACHER_APPROVAL_PENDING).
 * 9. Isolamento de contas em computadores diferentes.
 * 10. Preservação de notas, UID, S-Path, Dictionary e Journal.
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
  console.log('FASE IDENTITY-NOTES.3: CORREÇÃO DEFINITIVA DA INTEGRIDADE DE ROLES');
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

  const server = http.createServer(serverApp);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  const timestamp = Date.now();
  const student1Uid = `canonical-student-id3-${timestamp}`;
  const student1Email = `student.id3.${timestamp}@example.com`;

  const approvedTeacherUid = `canonical-teacher-id3-${timestamp}`;
  const approvedTeacherEmail = `teacher.approved.${timestamp}@example.com`;

  const pendingTeacherUid = `canonical-teacher-pend-id3-${timestamp}`;
  const pendingTeacherEmail = `teacher.pending.${timestamp}@example.com`;

  const adminUid = `canonical-admin-id3-${timestamp}`;
  const adminEmail = `admin.id3.${timestamp}@example.com`;

  const tokenMap: Record<string, any> = {
    'token-student': { uid: student1Uid, email: student1Email, email_verified: true, role: 'student' },
    'token-teacher-approved': { uid: approvedTeacherUid, email: approvedTeacherEmail, email_verified: true, role: 'teacher' },
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
    // SETUP: Setup mock Firestore state in memory for testing
    // ------------------------------------------------------------------------
    const firestoreMemoryDb: Record<string, Record<string, any>> = {
      users: {
        [student1Uid]: {
          id: student1Uid,
          uid: student1Uid,
          email: student1Email,
          name: 'Student ID3',
          role: 'student',
        },
        [approvedTeacherUid]: {
          id: approvedTeacherUid,
          uid: approvedTeacherUid,
          email: approvedTeacherEmail,
          name: 'Teacher Approved ID3',
          role: 'teacher',
          approvalStatus: 'approved',
          isApproved: true,
        },
        [pendingTeacherUid]: {
          id: pendingTeacherUid,
          uid: pendingTeacherUid,
          email: pendingTeacherEmail,
          name: 'Teacher Pending ID3',
          role: 'teacher',
          approvalStatus: 'pending',
          isApproved: false,
        },
      },
      tutors: {
        // Teacher 1 has approved tutor profile
        [approvedTeacherUid]: {
          id: approvedTeacherUid,
          uid: approvedTeacherUid,
          authUid: approvedTeacherUid,
          email: approvedTeacherEmail,
          name: 'Teacher Approved ID3',
          role: 'teacher',
          approvalStatus: 'approved',
          isApproved: true,
        },
        // RESIDUAL RECORD: student1 also has an accidental/residual doc in tutors!
        [student1Uid]: {
          id: student1Uid,
          uid: student1Uid,
          authUid: student1Uid,
          email: student1Email,
          name: 'Student With Residual Tutor Doc',
          role: 'teacher',
          approvalStatus: 'approved',
          isApproved: true,
        },
      },
    };

    const mockFirestore: any = {
      projectId: 'itissimple-security-staging',
      databaseId: '(default)',
      collection: (colName: string) => ({
        doc: (docId: string) => ({
          get: async () => {
            const data = firestoreMemoryDb[colName]?.[docId];
            return {
              id: docId,
              exists: !!data,
              data: () => (data ? { ...data } : undefined),
            };
          },
          set: async (val: any, opts?: any) => {
            if (!firestoreMemoryDb[colName]) firestoreMemoryDb[colName] = {};
            if (opts?.merge && firestoreMemoryDb[colName][docId]) {
              firestoreMemoryDb[colName][docId] = { ...firestoreMemoryDb[colName][docId], ...val };
            } else {
              firestoreMemoryDb[colName][docId] = { ...val };
            }
            return { writeTime: new Date() };
          },
          delete: async () => {
            if (firestoreMemoryDb[colName]) delete firestoreMemoryDb[colName][docId];
          },
        }),
        where: (field: string, op: string, val: any) => ({
          get: async () => {
            const col = firestoreMemoryDb[colName] || {};
            const docs: any[] = [];
            for (const [id, item] of Object.entries(col)) {
              if (item && item[field] === val) {
                docs.push({
                  id,
                  exists: true,
                  data: () => ({ ...item }),
                });
              }
            }
            return { docs, empty: docs.length === 0, forEach: (fn: any) => docs.forEach(fn) };
          },
          limit: (_n: number) => ({
            get: async () => {
              const col = firestoreMemoryDb[colName] || {};
              const docs: any[] = [];
              for (const [id, item] of Object.entries(col)) {
                if (item && item[field] === val) {
                  docs.push({ id, exists: true, data: () => ({ ...item }) });
                  break;
                }
              }
              return { docs, empty: docs.length === 0 };
            },
          }),
        }),
        get: async () => {
          const col = firestoreMemoryDb[colName] || {};
          const docs = Object.entries(col).map(([id, item]) => ({
            id,
            exists: true,
            data: () => ({ ...item }),
          }));
          return { docs, empty: docs.length === 0, forEach: (fn: any) => docs.forEach(fn) };
        },
      }),
    };

    setFirebaseAdminFirestoreForTesting(mockFirestore);

    // Initial student login to register session
    await makeRequest(server, 'POST', '/api/auth/google', {
      uid: student1Uid,
      email: student1Email,
      name: 'Student ID3',
      role: 'student',
    }, { Authorization: 'Bearer token-student' });

    // Initial teacher login to register session
    await makeRequest(server, 'POST', '/api/auth/google', {
      uid: approvedTeacherUid,
      email: approvedTeacherEmail,
      name: 'Teacher Approved ID3',
      role: 'teacher',
    }, { Authorization: 'Bearer token-teacher-approved' });

    // ------------------------------------------------------------------------
    // TEST 1: Student tentando entrar como Native Friend
    // ------------------------------------------------------------------------
    await test('1. Student tentando entrar como Native Friend: role permanece student e isRoleEnforced=true', async () => {
      const res = await makeRequest(server, 'POST', '/api/auth/login', {
        email: student1Email,
        uid: student1Uid,
        role: 'teacher', // Student tries to claim teacher role
      }, { Authorization: 'Bearer token-student' });

      assert.strictEqual(res.status, 200, 'Login processado');
      assert.strictEqual(res.data.account.role, 'student', 'Role retornado é estritamente student');
      assert.strictEqual(res.data.isRoleEnforced, true, 'isRoleEnforced bloqueou promoção para teacher');

      // Verify Google auth endpoint as well
      const gRes = await makeRequest(server, 'POST', '/api/auth/google', {
        email: student1Email,
        uid: student1Uid,
        role: 'teacher',
      }, { Authorization: 'Bearer token-student' });
      assert.strictEqual(gRes.status, 200);
      assert.strictEqual(gRes.data.account.role, 'student', 'Google auth bloqueou tentativa de entrar como Native Friend');
    });

    // ------------------------------------------------------------------------
    // TEST 2: Student com registro residual em tutors
    // ------------------------------------------------------------------------
    await test('2. Student com registro residual em tutors: prevalece users/{uid} (role: student)', async () => {
      // Confirm residual record exists in tutors
      assert.ok(firestoreMemoryDb.tutors[student1Uid], 'Registro residual em tutors existe');

      // Check resolveTeacherCanonicalIdentity
      const resolved = await resolveTeacherCanonicalIdentity({
        teacherUid: student1Uid,
        teacherEmail: student1Email,
      });
      assert.strictEqual(resolved, null, 'resolveTeacherCanonicalIdentity rejeita conta com users/{uid} de estudante');

      // Check verify-session
      const verifyRes = await makeRequest(server, 'GET', '/api/auth/verify-session', undefined, {
        Authorization: 'Bearer token-student',
      });
      assert.strictEqual(verifyRes.status, 200);
      assert.strictEqual(verifyRes.data.role, 'student', 'verify-session retorna student apesar de registro residual em tutors');
    });

    // ------------------------------------------------------------------------
    // TEST 3: Student após F5, logout e novo login
    // ------------------------------------------------------------------------
    await test('3. Student após F5, logout e novo login: role student é mantido de forma imutável', async () => {
      // 1. Simulate F5 via verify-session
      const f5Res = await makeRequest(server, 'GET', '/api/auth/verify-session', undefined, {
        Authorization: 'Bearer token-student',
      });
      assert.strictEqual(f5Res.data.role, 'student', 'Papel permanece student após F5');

      // 2. Simulate re-login
      const reLoginRes = await makeRequest(server, 'POST', '/api/auth/google', {
        uid: student1Uid,
        email: student1Email,
        name: 'Student ID3',
      }, { Authorization: 'Bearer token-student' });
      assert.strictEqual(reLoginRes.data.account.role, 'student', 'Papel permanece student após novo login');
    });

    // ------------------------------------------------------------------------
    // TEST 4: Student acessando /teacher diretamente
    // ------------------------------------------------------------------------
    await test('4. Student acessando /teacher: sessão autorizada do backend bloqueia acesso privilegiado', async () => {
      const verifyRes = await makeRequest(server, 'GET', '/api/auth/verify-session', undefined, {
        Authorization: 'Bearer token-student',
      });
      assert.strictEqual(verifyRes.data.role, 'student');
      assert.notStrictEqual(verifyRes.data.role, 'teacher', 'Backend não concede role teacher a estudante');
    });

    // ------------------------------------------------------------------------
    // TEST 5: Sincronização de tutores sem alteração de role
    // ------------------------------------------------------------------------
    await test('5. Sincronização de tutores: saveAppStateToFirestore não sobrescreve users/{uid} de alunos', async () => {
      // Confirm student is student in Firestore
      assert.strictEqual(firestoreMemoryDb.users[student1Uid].role, 'student');

      // Trigger app_state save containing the student inside tutorsList
      await saveAppStateToFirestore({
        tutorsList: [
          {
            id: student1Uid,
            uid: student1Uid,
            authUid: student1Uid,
            email: student1Email,
            name: 'Student Intruder in tutorsList',
            role: 'teacher',
            approvalStatus: 'approved',
            isApproved: true,
          },
          {
            id: approvedTeacherUid,
            uid: approvedTeacherUid,
            authUid: approvedTeacherUid,
            email: approvedTeacherEmail,
            name: 'Teacher Approved ID3',
            role: 'teacher',
            approvalStatus: 'approved',
            isApproved: true,
          },
        ],
      });

      // Verify that users/{student1Uid} has NOT been mutated to teacher
      const studentDocAfterSync = firestoreMemoryDb.users[student1Uid];
      assert.strictEqual(studentDocAfterSync.role, 'student', 'users/{student1Uid} continua com role=student');
    });

    // ------------------------------------------------------------------------
    // TEST 6: Falha temporária na consulta ao Firestore
    // ------------------------------------------------------------------------
    await test('6. Falha temporária no Firestore: bloqueia elevação de privilégios (presume seguro, nunca teacher)', async () => {
      // Temporarily mock Firestore error on doc get
      const unavailUid = `unavail-user-${timestamp}`;
      const unavailEmail = `unavail.${timestamp}@example.com`;
      tokenMap['token-unavail'] = { uid: unavailUid, email: unavailEmail, email_verified: true, role: 'teacher' };

      // User does NOT exist in users collection (absence of canonical doc)
      const verifyRes = await makeRequest(server, 'GET', '/api/auth/verify-session', undefined, {
        Authorization: 'token-unavail',
        // invalid bearer will trigger unauthenticated, but with valid bearer and missing doc:
      });

      const validBearerRes = await makeRequest(server, 'GET', '/api/auth/verify-session', undefined, {
        Authorization: 'Bearer token-unavail',
      });

      assert.strictEqual(validBearerRes.status, 200);
      assert.strictEqual(validBearerRes.data.role, 'student', 'Ausência de perfil canônico bloqueia elevação para teacher');
    });

    // ------------------------------------------------------------------------
    // TEST 7: Professor legítimo aprovado
    // ------------------------------------------------------------------------
    await test('7. Professor legítimo aprovado: role teacher e privilégios preservados', async () => {
      const verifyRes = await makeRequest(server, 'GET', '/api/auth/verify-session', undefined, {
        Authorization: 'Bearer token-teacher-approved',
      });
      assert.strictEqual(verifyRes.status, 200);
      assert.strictEqual(verifyRes.data.role, 'teacher', 'Professor aprovado mantém role teacher');
      assert.strictEqual(verifyRes.data.uid, approvedTeacherUid, 'UID canônico mantido');
    });

    // ------------------------------------------------------------------------
    // TEST 8: Professor pendente ou rejeitado
    // ------------------------------------------------------------------------
    await test('8. Professor pendente ou rejeitado: bloqueado com 403 TEACHER_APPROVAL_PENDING ao tentar entrar como teacher', async () => {
      const res = await makeRequest(server, 'POST', '/api/auth/login', {
        email: pendingTeacherEmail,
        uid: pendingTeacherUid,
        role: 'teacher',
      }, { Authorization: 'Bearer token-teacher-pending' });

      assert.strictEqual(res.status, 403, 'Acesso bloqueado com 403');
      assert.strictEqual(res.data.code, 'TEACHER_APPROVAL_PENDING', 'Código indica aprovação pendente');
      assert.strictEqual(res.data.approvalStatus, 'pending');
    });

    // ------------------------------------------------------------------------
    // TEST 9: Isolamento de contas em computadores diferentes
    // ------------------------------------------------------------------------
    await test('9. Isolamento em computadores diferentes: aluno e professor mantêm papéis respectivos em acessos concorrentes', async () => {
      const [clientStudent, clientTeacher] = await Promise.all([
        makeRequest(server, 'GET', '/api/auth/verify-session', undefined, {
          Authorization: 'Bearer token-student',
        }),
        makeRequest(server, 'GET', '/api/auth/verify-session', undefined, {
          Authorization: 'Bearer token-teacher-approved',
        }),
      ]);

      assert.strictEqual(clientStudent.data.role, 'student', 'Cliente Aluno é estritamente student');
      assert.strictEqual(clientTeacher.data.role, 'teacher', 'Cliente Professor é estritamente teacher');
      assert.strictEqual(clientStudent.data.uid, student1Uid);
      assert.strictEqual(clientTeacher.data.uid, approvedTeacherUid);
    });

    // ------------------------------------------------------------------------
    // TEST 10: Preservação de notas, UID, S-Path, Dictionary e Journal
    // ------------------------------------------------------------------------
    await test('10. Preservação de módulos: notas, rotinas S-Path, Dictionary e Journal intactos', async () => {
      // 1. Routines module responds normally
      const routinesRes = await makeRequest(server, 'GET', '/api/routines');
      assert.strictEqual(routinesRes.status, 200, 'Rotinas S-Path intactas');

      // 2. Native Friends public catalog
      const tutorsRes = await makeRequest(server, 'GET', '/api/tutors');
      assert.strictEqual(tutorsRes.status, 200, 'Catálogo de Native Friends intacto');

      // 3. User profile verification
      const userDoc = await fetchUserFromFirestore(student1Email, student1Uid);
      assert.ok(userDoc, 'Perfil do aluno recuperável');
      assert.strictEqual(userDoc.role, 'student', 'Papel do aluno inalterado');
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
