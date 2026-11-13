import assert from 'assert';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { app as serverApp, readDb } from '../serverApp';
import {
  setFirebaseAdminFirestoreForTesting,
  resetFirebaseAdminFirestoreForTesting,
} from '../src/serverFirestore';
import { setFirebaseAdminAuthForTesting } from '../src/serverFirebaseAdmin';

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
      return reject(new Error('Server address not available'));
    }
    const bodyStr = body ? JSON.stringify(body) : undefined;
    const reqHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      ...headers,
    };
    if (bodyStr) {
      reqHeaders['Content-Length'] = Buffer.byteLength(bodyStr).toString();
    }
    const req = http.request(
      { host: '127.0.0.1', port: addr.port, path: reqPath, method, headers: reqHeaders },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
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

function createInMemoryFirestoreMock() {
  const store = new Map<string, Record<string, any>>();
  let forceOutage = false;

  const setDoc = (col: string, id: string, data: Record<string, any>) => {
    store.set(`${col}::${id}`, JSON.parse(JSON.stringify(data)));
  };

  const matchFilters = (data: Record<string, any>, filters: Array<{ field: string; op: string; val: any }>) => {
    return filters.every((f) => {
      const val = data[f.field];
      if (f.op === '==') return val === f.val;
      return false;
    });
  };

  const makeQuery = (col: string, filters: Array<{ field: string; op: string; val: any }> = [], maxLimit?: number): any => ({
    where: (field: string, op: string, val: any) => makeQuery(col, [...filters, { field, op, val }], maxLimit),
    limit: (n: number) => makeQuery(col, filters, n),
    get: async () => {
      if (forceOutage) {
        const err: any = new Error('14 UNAVAILABLE: Firestore temporarily unreachable');
        err.code = 14;
        throw err;
      }
      const docs: any[] = [];
      for (const [k, v] of store.entries()) {
        if (!k.startsWith(`${col}::`)) continue;
        const docId = k.slice(`${col}::`.length);
        if (matchFilters(v, filters)) {
          docs.push({
            id: docId,
            exists: true,
            ref: { _col: col, _id: docId },
            data: () => JSON.parse(JSON.stringify(v)),
          });
        }
      }
      const sliced = typeof maxLimit === 'number' ? docs.slice(0, maxLimit) : docs;
      return {
        empty: sliced.length === 0,
        docs: sliced,
        size: sliced.length,
        forEach: (cb: (d: any) => void) => sliced.forEach(cb),
      };
    },
  });

  const dbMock: any = {
    collection: (col: string) => ({
      doc: (id: string) => ({
        _col: col,
        _id: id,
        get: async () => {
          if (forceOutage) {
            const err: any = new Error('14 UNAVAILABLE: Firestore temporarily unreachable');
            err.code = 14;
            throw err;
          }
          const val = store.get(`${col}::${id}`);
          return {
            id,
            exists: Boolean(val),
            ref: { _col: col, _id: id },
            data: () => (val ? JSON.parse(JSON.stringify(val)) : undefined),
          };
        },
        set: async (data: Record<string, any>, opts?: { merge?: boolean }) => {
          if (forceOutage) {
            const err: any = new Error('14 UNAVAILABLE: Firestore temporarily unreachable');
            err.code = 14;
            throw err;
          }
          const key = `${col}::${id}`;
          const prev = opts?.merge ? (store.get(key) || {}) : {};
          store.set(key, JSON.parse(JSON.stringify({ ...prev, ...data })));
          return { writeTime: new Date() };
        },
        delete: async () => {
          store.delete(`${col}::${id}`);
          return { writeTime: new Date() };
        },
      }),
      where: (field: string, op: string, val: any) => makeQuery(col, [{ field, op, val }]),
      limit: (n: number) => makeQuery(col, [], n),
      get: async () => makeQuery(col).get(),
    }),
    batch: () => {
      const ops: Array<() => void> = [];
      return {
        set: (ref: any, data: Record<string, any>, opts?: { merge?: boolean }) => {
          ops.push(() => {
            const key = `${ref._col}::${ref._id}`;
            const prev = opts?.merge ? (store.get(key) || {}) : {};
            store.set(key, JSON.parse(JSON.stringify({ ...prev, ...data })));
          });
        },
        delete: (ref: any) => {
          ops.push(() => {
            store.delete(`${ref._col}::${ref._id}`);
          });
        },
        commit: async () => {
          for (const op of ops) op();
          return [];
        },
      };
    },
    _store: store,
    _setDoc: setDoc,
    _setForceOutage: (v: boolean) => {
      forceOutage = v;
    },
  };

  return dbMock;
}

async function runSuite() {
  console.log('======================================================================');
  console.log('ARCH.2B — CONSOLIDAÇÃO DE IDENTIDADE E PERFIS NO FIRESTORE (DEFAULT)');
  console.log('======================================================================\n');

  let passed = 0;
  let failed = 0;

  async function test(name: string, fn: () => void | Promise<void>) {
    try {
      await fn();
      passed++;
      console.log(`  [PASS] ${name}`);
    } catch (err: any) {
      failed++;
      console.error(`  [FAIL] ${name}`);
      console.error(`         ${err?.message || err}`);
    }
  }

  const fsMock = createInMemoryFirestoreMock();
  setFirebaseAdminFirestoreForTesting(fsMock);

  const studentUid = 'arch2bStudentCanonicalUid0001';
  const studentEmail = 'aluna.arch2b@itissimple-test.com';
  const teacherNoClaimUid = 'arch2bTeacherNoClaimUid0002';
  const teacherNoClaimEmail = 'prof.noclaim.arch2b@itissimple-test.com';
  const adminUid = 'arch2bAdminCanonicalUid0003';
  const adminEmail = 'adm.itissimple@gmail.com';
  const deletedStudentUid = 'arch2bDeletedStudentUid0004';
  const deletedStudentEmail = 'excluida.arch2b@itissimple-test.com';

  setFirebaseAdminAuthForTesting({
    verifyIdToken: async (token: string) => {
      if (token === 'token-student-arch2b') {
        return { uid: studentUid, email: studentEmail, email_verified: true };
      }
      if (token === 'token-teacher-noclaim') {
        // Intentionally NO custom claim `role: 'teacher'`
        return { uid: teacherNoClaimUid, email: teacherNoClaimEmail, email_verified: true };
      }
      if (token === 'token-admin-arch2b') {
        return { uid: adminUid, email: adminEmail, email_verified: true, role: 'admin', admin: true };
      }
      if (token === 'token-deleted-student') {
        return { uid: deletedStudentUid, email: deletedStudentEmail, email_verified: true };
      }
      throw new Error('Invalid token');
    },
    getUser: async (uid: string) => {
      if (uid === teacherNoClaimUid) return { uid, email: teacherNoClaimEmail };
      if (uid === studentUid) return { uid, email: studentEmail };
      throw new Error('User not found');
    },
    getUserByEmail: async (email: string) => {
      if (email === teacherNoClaimEmail) return { uid: teacherNoClaimUid, email };
      if (email === studentEmail) return { uid: studentUid, email };
      throw new Error('User not found');
    },
  } as any);

  const server = http.createServer(serverApp);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    // 1. Rejeição de UIDs ausentes ou sintéticos em /api/auth/google e /api/user-profile
    await test('1. Rejeita identificadores sintéticos (google-*, st-*, usr-*) e UID ausente sem criar cadastro', async () => {
      const dbBefore = readDb();
      const synthEmails = ['synth1@arch2b.com', 'synth2@arch2b.com', 'synth3@arch2b.com'];

      const resMissing = await makeRequest(server, 'POST', '/api/auth/google', {
        email: synthEmails[0],
        name: 'No UID',
      });
      assert.strictEqual(resMissing.status, 400);

      const resGooglePrefix = await makeRequest(server, 'POST', '/api/auth/google', {
        uid: 'google-1788181232049',
        email: synthEmails[1],
        name: 'Synthetic Google',
      });
      assert.strictEqual(resGooglePrefix.status, 400);

      const resStPrefix = await makeRequest(server, 'POST', '/api/auth/google', {
        uid: 'st-1788181232049',
        email: synthEmails[2],
        name: 'Synthetic St',
      });
      assert.strictEqual(resStPrefix.status, 400);

      const resGetProfileSynth = await makeRequest(server, 'GET', '/api/user-profile?uid=usr-123456');
      assert.strictEqual(resGetProfileSynth.status, 400);

      for (const em of synthEmails) {
        assert.strictEqual(Boolean(dbBefore.authUsers?.[em]), false, `Nenhum cadastro criado para ${em}`);
        assert.strictEqual(Boolean(dbBefore.userProfiles?.[em]), false, `Nenhum userProfile criado para ${em}`);
      }
      assert.strictEqual(fsMock._store.has('users::google-1788181232049'), false);
      assert.strictEqual(fsMock._store.has('users::st-1788181232049'), false);
    });

    // 2. POST /api/auth/google persiste perfil canônico em Firestore users/{uid}
    await test('2. POST /api/auth/google persiste perfil de aluno em Firestore users/{uid}', async () => {
      const res = await makeRequest(
        server,
        'POST',
        '/api/auth/google',
        {
          uid: studentUid,
          email: studentEmail,
          name: 'Aluna Arch 2B',
          role: 'student',
        },
        { Authorization: 'Bearer token-student-arch2b' }
      );
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.account.uid, studentUid);
      assert.strictEqual(res.data.account.role, 'student');

      const storedUser = fsMock._store.get(`users::${studentUid}`);
      assert(storedUser, 'Documento users/{uid} criado no Firestore (default)');
      assert.strictEqual(storedUser.email, studentEmail);
      assert.strictEqual(storedUser.role, 'student');
      assert.strictEqual(storedUser.uid, studentUid);
    });

    // 3. Preservação de professor aprovado SEM custom claim `teacher`
    await test('3. Professor aprovado sem custom claim teacher permanece autorizado em Google login, user-profile e students', async () => {
      // Seed canonical approved teacher directly in Firestore tutors/{uid} and users/{uid} (WITHOUT inMemoryDb)
      fsMock._setDoc('tutors', teacherNoClaimUid, {
        id: teacherNoClaimUid,
        uid: teacherNoClaimUid,
        authUid: teacherNoClaimUid,
        publicTutorId: 'prof-noclaim-arch2b',
        email: teacherNoClaimEmail,
        name: 'Prof No Claim',
        role: 'teacher',
        approvalStatus: 'approved',
        isApproved: true,
        approved: true,
        headline: 'Canonical Teacher Headline',
      });
      fsMock._setDoc('users', teacherNoClaimUid, {
        id: teacherNoClaimUid,
        uid: teacherNoClaimUid,
        authUid: teacherNoClaimUid,
        email: teacherNoClaimEmail,
        name: 'Prof No Claim',
        role: 'teacher',
        approvalStatus: 'approved',
        isApproved: true,
      });

      const loginRes = await makeRequest(
        server,
        'POST',
        '/api/auth/google',
        { uid: teacherNoClaimUid, email: teacherNoClaimEmail, name: 'Prof No Claim', role: 'teacher' },
        { Authorization: 'Bearer token-teacher-noclaim' }
      );
      assert.strictEqual(loginRes.status, 200);
      assert.strictEqual(loginRes.data.account.role, 'teacher');
      assert.strictEqual(loginRes.data.tutor?.uid, teacherNoClaimUid);

      const getProfRes = await makeRequest(
        server,
        'GET',
        `/api/user-profile?email=${encodeURIComponent(teacherNoClaimEmail)}&uid=${teacherNoClaimUid}`,
        undefined,
        { Authorization: 'Bearer token-teacher-noclaim' }
      );
      assert.strictEqual(getProfRes.status, 200);
      assert.strictEqual(getProfRes.data.isTeacher, true);
      assert.strictEqual(getProfRes.data.role, 'teacher');

      // Update teacher bio via POST /api/user-profile and ensure persistence in tutors/{uid} & users/{uid}
      // Also verify client cannot tamper approvalStatus or role
      const postTeacherRes = await makeRequest(
        server,
        'POST',
        '/api/user-profile',
        {
          uid: teacherNoClaimUid,
          email: teacherNoClaimEmail,
          profile: {
            bio: 'Bio atualizada via Firestore ARCH.2B',
            approvalStatus: 'rejected',
            role: 'admin',
          },
        },
        { Authorization: 'Bearer token-teacher-noclaim' }
      );
      assert.strictEqual(postTeacherRes.status, 200);
      assert.strictEqual(postTeacherRes.data.isTeacher, true);
      assert.strictEqual(postTeacherRes.data.persistedToFirestore, true);
      const updatedFsTutor = fsMock._store.get(`tutors::${teacherNoClaimUid}`);
      assert.strictEqual(updatedFsTutor?.bio, 'Bio atualizada via Firestore ARCH.2B');
      assert.strictEqual(updatedFsTutor?.approvalStatus, 'approved');
      assert.strictEqual(updatedFsTutor?.role, 'teacher');
    });

    // 4. GET /api/user-profile e GET /api/students leem diretamente do Firestore (mesmo sem inMemoryDb) sem criar st-*
    await test('4. GET /api/user-profile e GET /api/students consultam Firestore (default) sem inMemoryDb e sem st-*', async () => {
      const firestoreOnlyUid = 'arch2bFsOnlyStudentUid0005';
      const firestoreOnlyEmail = 'fsonly.student@itissimple-test.com';

      fsMock._setDoc('users', firestoreOnlyUid, {
        id: firestoreOnlyUid,
        uid: firestoreOnlyUid,
        email: firestoreOnlyEmail,
        name: 'Firestore Only Student',
        role: 'student',
        level: 'intermediario',
        learningGoal: 'Travel & Career',
        teacherUid: teacherNoClaimUid,
        assignedNativeFriendUID: teacherNoClaimUid,
        teacherEmail: teacherNoClaimEmail,
        teacherName: 'Prof No Claim',
        enrollmentStatus: 'active',
        contractedLessons: 12,
        availableLessons: 10,
      });
      fsMock._setDoc('student_assignments', firestoreOnlyUid, {
        studentUid: firestoreOnlyUid,
        teacherUid: teacherNoClaimUid,
        teacherAuthUid: teacherNoClaimUid,
        teacherEmail: teacherNoClaimEmail,
        weeklyStudyDays: ['monday', 'wednesday', 'friday'],
        weeklyStudyDaysTarget: 3,
      });

      // Confirm student is NOT in inMemoryDb yet
      const memDb = readDb();
      memDb.students = (memDb.students || []).filter((s: any) => s.email !== firestoreOnlyEmail);
      if (memDb.userProfiles) delete memDb.userProfiles[firestoreOnlyEmail];

      // Teacher (without custom claim) lists students via GET /api/students
      const teacherListRes = await makeRequest(
        server,
        'GET',
        `/api/students?role=teacher&email=${encodeURIComponent(teacherNoClaimEmail)}`,
        undefined,
        { Authorization: 'Bearer token-teacher-noclaim' }
      );
      assert.strictEqual(teacherListRes.status, 200);
      assert(Array.isArray(teacherListRes.data));
      const foundStudent = teacherListRes.data.find((s: any) => s.email === firestoreOnlyEmail);
      assert(foundStudent, 'Professor sem custom claim visualiza aluna vinda diretamente do Firestore');
      assert.strictEqual(foundStudent.uid, firestoreOnlyUid);
      assert(!String(foundStudent.id).startsWith('st-'), 'ID nunca usa prefixo sintético st-');

      // Admin lists students via GET /api/students
      const adminListRes = await makeRequest(
        server,
        'GET',
        '/api/students',
        undefined,
        { Authorization: 'Bearer token-admin-arch2b' }
      );
      assert.strictEqual(adminListRes.status, 200);
      assert(adminListRes.data.some((s: any) => s.email === firestoreOnlyEmail && s.uid === firestoreOnlyUid));
      for (const s of adminListRes.data) {
        assert(!String(s.id || '').startsWith('st-'), 'Nenhum ID st-* retornado para admin');
      }

      // GET /api/user-profile resolves from Firestore + student_assignments cleanly
      if (memDb.userProfiles) delete memDb.userProfiles[firestoreOnlyEmail];
      const profileRes = await makeRequest(
        server,
        'GET',
        `/api/user-profile?email=${encodeURIComponent(firestoreOnlyEmail)}&uid=${firestoreOnlyUid}`
      );
      assert.strictEqual(profileRes.status, 200);
      assert.strictEqual(profileRes.data.profile?.uid, firestoreOnlyUid);
      assert.strictEqual(profileRes.data.profile?.contractedLessons, 12);
      assert.deepStrictEqual(profileRes.data.profile?.weeklyStudyDays, ['monday', 'wednesday', 'friday']);
    });

    // 5. Usuários excluídos não reaparecem em nenhum fluxo
    await test('5. Usuários excluídos não reaparecem via cache, user-profile, check-user ou Google login', async () => {
      // Seed deleted student and simulate admin deletion
      fsMock._setDoc('users', deletedStudentUid, {
        id: deletedStudentUid,
        uid: deletedStudentUid,
        email: deletedStudentEmail,
        name: 'Aluna Excluida',
        role: 'student',
        teacherUid: teacherNoClaimUid,
        teacherEmail: teacherNoClaimEmail,
        enrollmentStatus: 'active',
      });
      const memDb = readDb();
      memDb.students.push({
        id: deletedStudentUid,
        uid: deletedStudentUid,
        email: deletedStudentEmail,
        studentEmail: deletedStudentEmail,
        name: 'Aluna Excluida',
        teacherUid: teacherNoClaimUid,
        teacherEmail: teacherNoClaimEmail,
      });

      const delRes = await makeRequest(
        server,
        'DELETE',
        `/api/students/${encodeURIComponent(deletedStudentEmail)}`,
        undefined,
        { Authorization: 'Bearer token-admin-arch2b' }
      );
      assert.strictEqual(delRes.status, 200);

      const getProfAfter = await makeRequest(
        server,
        'GET',
        `/api/user-profile?email=${encodeURIComponent(deletedStudentEmail)}&uid=${deletedStudentUid}`
      );
      assert.strictEqual(getProfAfter.status, 200);
      assert.strictEqual(getProfAfter.data.profile, null, 'GET /api/user-profile não ressuscita usuária excluída');

      const getStudentsAfter = await makeRequest(
        server,
        'GET',
        '/api/students',
        undefined,
        { Authorization: 'Bearer token-admin-arch2b' }
      );
      assert.strictEqual(
        getStudentsAfter.data.some((s: any) => s.email === deletedStudentEmail),
        false,
        'GET /api/students não lista usuária excluída'
      );

      const checkAfter = await makeRequest(
        server,
        'GET',
        `/api/auth/check-user?email=${encodeURIComponent(deletedStudentEmail)}`
      );
      assert.strictEqual(checkAfter.status, 200);
      assert.strictEqual(checkAfter.data.emailExists, false, 'check-user não reporta usuária excluída');

      const googleAfter = await makeRequest(
        server,
        'POST',
        '/api/auth/google',
        { uid: deletedStudentUid, email: deletedStudentEmail, name: 'Aluna Excluida' },
        { Authorization: 'Bearer token-deleted-student' }
      );
      assert.strictEqual(googleAfter.status, 403);
      assert.strictEqual(googleAfter.data.code, 'ACCOUNT_DELETED');
    });

    // 6. HTTP 503 em /api/auth/check-user e tratamento no frontend
    await test('6. HTTP 503 em /api/auth/check-user e verificação do tratamento nos modais de frontend', async () => {
      fsMock._setForceOutage(true);
      try {
        const res503 = await makeRequest(
          server,
          'GET',
          `/api/auth/check-user?email=${encodeURIComponent('novo.outage@itissimple-test.com')}`
        );
        assert.strictEqual(res503.status, 503);
        assert.strictEqual(res503.data.error, 'FIRESTORE_QUERY_FAILED');
      } finally {
        fsMock._setForceOutage(false);
      }

      const startModal = fs.readFileSync(path.resolve(process.cwd(), 'src/components/StartLivingEmailModal.tsx'), 'utf8');
      assert(startModal.includes('503') && startModal.includes('return;'), 'StartLivingEmailModal bloqueia avanço em HTTP 503');

      const authModal = fs.readFileSync(path.resolve(process.cwd(), 'src/components/AuthModal.tsx'), 'utf8');
      assert(authModal.includes('res.status === 503'), 'AuthModal trata HTTP 503');

      const tutorModal = fs.readFileSync(path.resolve(process.cwd(), 'src/components/BecomeTutorModal.tsx'), 'utf8');
      assert(tutorModal.includes('res.status === 503'), 'BecomeTutorModal trata HTTP 503');
    });
  } finally {
    resetFirebaseAdminFirestoreForTesting();
    server.closeAllConnections?.();
    server.close();
  }

  console.log('\n======================================================================');
  console.log(`ARCH.2B SUITE: ${passed} PASSED, ${failed} FAILED`);
  console.log('======================================================================');
  process.exit(failed > 0 ? 1 : 0);
}

runSuite().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
