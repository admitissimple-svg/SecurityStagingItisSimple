import assert from 'assert';
import http from 'http';
import { app as serverApp, readDb, resetInMemoryDbForTesting } from '../serverApp';
import {
  setFirebaseAdminFirestoreForTesting,
  resetFirebaseAdminFirestoreForTesting,
  setIsCloudWriteDisabled,
} from '../src/serverFirestore';
import { setFirebaseAdminAuthForTesting, resetFirebaseAdminForTesting } from '../src/serverFirebaseAdmin';

function createTestFirestoreMock(opts: { disableTransactions?: boolean } = {}) {
  const store = new Map<string, Record<string, any>>();
  let failOnSetCollection: string | null = null;

  const matchFilters = (data: Record<string, any>, filters: Array<{ field: string; op: string; val: any }>) =>
    filters.every((f) => (f.op === '==' ? data[f.field] === f.val : false));

  const makeDocRef = (col: string, id: string, parentPath = ''): any => {
    const fullCol = parentPath ? `${parentPath}/${col}` : col;
    const key = `${fullCol}::${id}`;
    return {
      _col: fullCol,
      _id: id,
      id,
      path: `${fullCol}/${id}`,
      collection: (subCol: string) => makeCollectionRef(subCol, `${fullCol}/${id}`),
      get: async () => {
        const val = store.get(key);
        return {
          id,
          exists: Boolean(val),
          ref: makeDocRef(col, id, parentPath),
          data: () => (val ? JSON.parse(JSON.stringify(val)) : undefined),
        };
      },
      set: async (data: Record<string, any>, setOpts?: { merge?: boolean }) => {
        if (failOnSetCollection && (fullCol === failOnSetCollection || failOnSetCollection === '*')) {
          throw new Error(`Simulated Firestore write error on ${fullCol}/${id}`);
        }
        const prev = setOpts?.merge ? (store.get(key) || {}) : {};
        store.set(key, JSON.parse(JSON.stringify({ ...prev, ...data })));
        return { writeTime: new Date() };
      },
      update: async (data: Record<string, any>) => {
        if (failOnSetCollection && (fullCol === failOnSetCollection || failOnSetCollection === '*')) {
          throw new Error(`Simulated Firestore update error on ${fullCol}/${id}`);
        }
        const prev = store.get(key) || {};
        store.set(key, JSON.parse(JSON.stringify({ ...prev, ...data })));
        return { writeTime: new Date() };
      },
      delete: async () => {
        store.delete(key);
        return { writeTime: new Date() };
      },
    };
  };

  const makeQuery = (
    col: string,
    parentPath = '',
    filters: Array<{ field: string; op: string; val: any }> = [],
    maxLimit?: number
  ): any => {
    const fullCol = parentPath ? `${parentPath}/${col}` : col;
    return {
      where: (field: string, op: string, val: any) =>
        makeQuery(col, parentPath, [...filters, { field, op, val }], maxLimit),
      limit: (n: number) => makeQuery(col, parentPath, filters, n),
      orderBy: () => makeQuery(col, parentPath, filters, maxLimit),
      get: async () => {
        const docs: any[] = [];
        for (const [k, v] of store.entries()) {
          if (!k.startsWith(`${fullCol}::`)) continue;
          const docId = k.slice(`${fullCol}::`.length);
          if (docId.includes('/')) continue;
          if (matchFilters(v, filters)) {
            docs.push({
              id: docId,
              exists: true,
              ref: makeDocRef(col, docId, parentPath),
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
    };
  };

  const makeCollectionRef = (col: string, parentPath = ''): any => ({
    doc: (id: string) => makeDocRef(col, id, parentPath),
    where: (field: string, op: string, val: any) => makeQuery(col, parentPath, [{ field, op, val }]),
    limit: (n: number) => makeQuery(col, parentPath, [], n),
    orderBy: () => makeQuery(col, parentPath, []),
    get: async () => makeQuery(col, parentPath).get(),
  });

  const base: any = {
    collection: (col: string) => makeCollectionRef(col),
    _store: store,
    _setDoc: (col: string, id: string, data: Record<string, any>) => {
      store.set(`${col}::${id}`, JSON.parse(JSON.stringify(data)));
    },
    _getDoc: (col: string, id: string) => store.get(`${col}::${id}`),
    _setFailOnSet: (col: string | null) => {
      failOnSetCollection = col;
    },
  };

  if (!opts.disableTransactions) {
    base.runTransaction = async (fn: (tx: any) => Promise<any>) => {
      const staged: Array<{ type: 'set' | 'update' | 'delete'; col: string; id: string; data?: Record<string, any>; merge?: boolean }> = [];
      const tx = {
        get: async (ref: any) => ref.get(),
        set: (ref: any, data: Record<string, any>, setOpts?: { merge?: boolean }) => {
          staged.push({
            type: 'set',
            col: ref._col,
            id: ref._id,
            data: JSON.parse(JSON.stringify(data)),
            merge: Boolean(setOpts?.merge),
          });
        },
        update: (ref: any, data: Record<string, any>) => {
          staged.push({
            type: 'update',
            col: ref._col,
            id: ref._id,
            data: JSON.parse(JSON.stringify(data)),
            merge: true,
          });
        },
        delete: (ref: any) => {
          staged.push({ type: 'delete', col: ref._col, id: ref._id });
        },
      };
      const result = await fn(tx);
      for (const op of staged) {
        if (failOnSetCollection && (op.col === failOnSetCollection || failOnSetCollection === '*')) {
          throw new Error(`Simulated Firestore transaction error on ${op.col}/${op.id}`);
        }
      }
      for (const op of staged) {
        const key = `${op.col}::${op.id}`;
        if (op.type === 'delete') {
          store.delete(key);
        } else {
          const prev = op.merge ? (store.get(key) || {}) : {};
          store.set(key, JSON.parse(JSON.stringify({ ...prev, ...(op.data || {}) })));
        }
      }
      return result;
    };
  }

  return base;
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
  console.log('PERSIST.1B — CONFIRMAÇÃO DE ESCRITAS CRÍTICAS');
  console.log('(/api/auth/register, /api/auth/signup, POST /api/tutors pendente)');
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

  const APPROVED_TEACHER_UID = 'persist1bApprovedTch00000001';
  const APPROVED_TEACHER_EMAIL = 'approved.tch.p1b@itissimple-test.com';

  const STU_REG_UID = 'persist1bStudentReg000000002';
  const STU_REG_EMAIL = 'student.reg.p1b@itissimple-test.com';
  const STU_SIGNUP_UID = 'persist1bStudentSig000000003';
  const STU_SIGNUP_EMAIL = 'student.sig.p1b@itissimple-test.com';
  const STU_FAIL_UID = 'persist1bStudentFail00000004';
  const STU_FAIL_EMAIL = 'student.fail.p1b@itissimple-test.com';
  const STU_ATOMIC_UID = 'persist1bStudentAtom00000005';
  const STU_ATOMIC_EMAIL = 'student.atom.p1b@itissimple-test.com';
  const STU_NOTX_UID = 'persist1bStudentNoTx00000006';
  const STU_NOTX_EMAIL = 'student.notx.p1b@itissimple-test.com';

  const TCH_REG_UID = 'persist1bTeacherReg000000007';
  const TCH_REG_EMAIL = 'teacher.reg.p1b@itissimple-test.com';
  const TCH_REG_FAIL_UID = 'persist1bTeacherFail00000008';
  const TCH_REG_FAIL_EMAIL = 'teacher.fail.p1b@itissimple-test.com';

  const TUTOR_PEND_UID = 'persist1bTutorPend0000000009';
  const TUTOR_PEND_EMAIL = 'tutor.pend.p1b@itissimple-test.com';
  const TUTOR_FAIL_UID = 'persist1bTutorFail0000000010';
  const TUTOR_FAIL_EMAIL = 'tutor.fail.p1b@itissimple-test.com';
  const TUTOR_AVAIL_FAIL_UID = 'persist1bTutorAvFail00000011';
  const TUTOR_AVAIL_FAIL_EMAIL = 'tutor.avfail.p1b@itissimple-test.com';
  const TUTOR_NOTX_UID = 'persist1bTutorNoTx0000000012';
  const TUTOR_NOTX_EMAIL = 'tutor.notx.p1b@itissimple-test.com';

  const tokenUsers: Record<string, { uid: string; email: string }> = {
    'tok-stu-reg': { uid: STU_REG_UID, email: STU_REG_EMAIL },
    'tok-stu-sig': { uid: STU_SIGNUP_UID, email: STU_SIGNUP_EMAIL },
    'tok-stu-fail': { uid: STU_FAIL_UID, email: STU_FAIL_EMAIL },
    'tok-stu-atom': { uid: STU_ATOMIC_UID, email: STU_ATOMIC_EMAIL },
    'tok-stu-notx': { uid: STU_NOTX_UID, email: STU_NOTX_EMAIL },
    'tok-tch-reg': { uid: TCH_REG_UID, email: TCH_REG_EMAIL },
    'tok-tch-fail': { uid: TCH_REG_FAIL_UID, email: TCH_REG_FAIL_EMAIL },
    'tok-tutor-pend': { uid: TUTOR_PEND_UID, email: TUTOR_PEND_EMAIL },
    'tok-tutor-fail': { uid: TUTOR_FAIL_UID, email: TUTOR_FAIL_EMAIL },
    'tok-tutor-avfail': { uid: TUTOR_AVAIL_FAIL_UID, email: TUTOR_AVAIL_FAIL_EMAIL },
    'tok-tutor-notx': { uid: TUTOR_NOTX_UID, email: TUTOR_NOTX_EMAIL },
  };

  const mockFs = createTestFirestoreMock();
  setFirebaseAdminFirestoreForTesting(mockFs as any);
  setIsCloudWriteDisabled(false);

  setFirebaseAdminAuthForTesting({
    verifyIdToken: async (token: string) => {
      if (tokenUsers[token]) return tokenUsers[token];
      throw new Error('Invalid token');
    },
    getUser: async (uid: string) => {
      if (uid === APPROVED_TEACHER_UID) return { uid: APPROVED_TEACHER_UID, email: APPROVED_TEACHER_EMAIL };
      const found = Object.values(tokenUsers).find((u) => u.uid === uid);
      if (found) return found;
      throw new Error('Not found');
    },
    getUserByEmail: async (email: string) => {
      if (email === APPROVED_TEACHER_EMAIL) return { uid: APPROVED_TEACHER_UID, email: APPROVED_TEACHER_EMAIL };
      const found = Object.values(tokenUsers).find((u) => u.email === email);
      if (found) return found;
      const err: any = new Error('Not found');
      err.code = 'auth/user-not-found';
      throw err;
    },
  } as any);

  const seedApprovedTeacher = (targetFs: any) => {
    targetFs._setDoc('tutors', APPROVED_TEACHER_UID, {
      id: APPROVED_TEACHER_UID,
      uid: APPROVED_TEACHER_UID,
      authUid: APPROVED_TEACHER_UID,
      publicTutorId: 'approved-tch-p1b',
      email: APPROVED_TEACHER_EMAIL,
      name: 'Approved Teacher Persist 1B',
      role: 'teacher',
      approvalStatus: 'approved',
      isApproved: true,
      approved: true,
      status: 'approved',
    });
    targetFs._setDoc('users', APPROVED_TEACHER_UID, {
      id: APPROVED_TEACHER_UID,
      uid: APPROVED_TEACHER_UID,
      authUid: APPROVED_TEACHER_UID,
      email: APPROVED_TEACHER_EMAIL,
      name: 'Approved Teacher Persist 1B',
      role: 'teacher',
      approvalStatus: 'approved',
      isApproved: true,
    });
  };

  seedApprovedTeacher(mockFs);

  const server = http.createServer(serverApp);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    await test('1. POST /api/auth/register e /signup (aluno) confirmam gravação em users/{uid} e student_assignments/{uid} e preservam saldos', async () => {
      resetInMemoryDbForTesting();

      const regRes = await makeRequest(
        server,
        'POST',
        '/api/auth/register',
        {
          uid: STU_REG_UID,
          email: STU_REG_EMAIL,
          name: 'Aluno Register 1B',
          role: 'student',
          level: 'intermediate',
          learningGoal: 'Career Growth',
          teacherUid: APPROVED_TEACHER_UID,
          contractedLessons: 50,
          availableLessons: 50,
          hasCompletedTrialLesson: true,
        },
        { Authorization: 'Bearer tok-stu-reg' }
      );
      assert.strictEqual(regRes.status, 201);
      assert.strictEqual(regRes.data.success, true);
      assert.strictEqual(regRes.data.account?.uid, STU_REG_UID);
      assert.strictEqual(regRes.data.profile?.contractedLessons, 0);
      assert.strictEqual(regRes.data.profile?.availableLessons, 0);
      assert.strictEqual(regRes.data.profile?.teacherUid, APPROVED_TEACHER_UID);

      const fsUserReg = mockFs._getDoc('users', STU_REG_UID);
      const fsAssignReg = mockFs._getDoc('student_assignments', STU_REG_UID);
      assert(fsUserReg, 'users/{uid} deve existir no Firestore após POST /api/auth/register');
      assert(fsAssignReg, 'student_assignments/{uid} deve existir no Firestore após POST /api/auth/register');
      assert.strictEqual(fsUserReg.uid, STU_REG_UID);
      assert.strictEqual(fsUserReg.teacherUid, APPROVED_TEACHER_UID);
      assert.strictEqual(fsUserReg.contractedLessons, 0);
      assert.strictEqual(fsAssignReg.uid, STU_REG_UID);
      assert(fsAssignReg.routines, 'rotinas iniciais devem estar persistidas em student_assignments/{uid}');

      const sigRes = await makeRequest(
        server,
        'POST',
        '/api/auth/signup',
        {
          uid: STU_SIGNUP_UID,
          email: STU_SIGNUP_EMAIL,
          name: 'Aluna Signup 1B',
          role: 'student',
          level: 'beginner',
          teacherUid: APPROVED_TEACHER_UID,
        },
        { Authorization: 'Bearer tok-stu-sig' }
      );
      assert.strictEqual(sigRes.status, 201);
      assert.strictEqual(sigRes.data.success, true);
      assert(mockFs._getDoc('users', STU_SIGNUP_UID), 'users/{uid} persistido em /api/auth/signup');
      assert(mockFs._getDoc('student_assignments', STU_SIGNUP_UID), 'student_assignments/{uid} persistido em /api/auth/signup');

      // Re-register with existing authoritative balances in Firestore -> preserved
      mockFs._setDoc('users', STU_REG_UID, {
        ...fsUserReg,
        contractedLessons: 6,
        availableLessons: 4,
        completedLessonsCount: 2,
        hasCompletedTrialLesson: true,
      });
      resetInMemoryDbForTesting();

      const reRegRes = await makeRequest(
        server,
        'POST',
        '/api/auth/register',
        {
          uid: STU_REG_UID,
          email: STU_REG_EMAIL,
          name: 'Aluno Register Atualizado',
          isUpdate: true,
          contractedLessons: 999,
          availableLessons: 999,
          hasCompletedTrialLesson: false,
        },
        { Authorization: 'Bearer tok-stu-reg' }
      );
      assert.strictEqual(reRegRes.status, 201);
      assert.strictEqual(reRegRes.data.profile?.contractedLessons, 6);
      assert.strictEqual(reRegRes.data.profile?.availableLessons, 4);
      assert.strictEqual(reRegRes.data.profile?.hasCompletedTrialLesson, true);
      assert.strictEqual(mockFs._getDoc('users', STU_REG_UID)?.contractedLessons, 6);
      assert.strictEqual(mockFs._getDoc('users', STU_REG_UID)?.availableLessons, 4);
    });

    await test('2. Falha de escrita em users/{uid} no /api/auth/register e /signup retorna 500 sem resposta falsa nem mutação em RAM', async () => {
      resetInMemoryDbForTesting();
      mockFs._setFailOnSet('users');
      try {
        const failReg = await makeRequest(
          server,
          'POST',
          '/api/auth/register',
          {
            uid: STU_FAIL_UID,
            email: STU_FAIL_EMAIL,
            name: 'Aluno Falha Users',
            role: 'student',
            teacherUid: APPROVED_TEACHER_UID,
          },
          { Authorization: 'Bearer tok-stu-fail' }
        );
        assert.strictEqual(failReg.status, 500);
        assert.notStrictEqual(failReg.data?.success, true);
        assert.strictEqual(mockFs._getDoc('users', STU_FAIL_UID), undefined);
        assert.strictEqual(mockFs._getDoc('student_assignments', STU_FAIL_UID), undefined);
        assert.strictEqual(readDb().authUsers?.[STU_FAIL_EMAIL], undefined, 'authUsers RAM não pode ser mutado');
        assert.strictEqual(readDb().userProfiles?.[STU_FAIL_EMAIL], undefined, 'userProfiles RAM não pode ser mutado');
        assert.strictEqual(readDb().students.find((s) => s.uid === STU_FAIL_UID), undefined, 'students RAM não pode ser mutado');

        const failSig = await makeRequest(
          server,
          'POST',
          '/api/auth/signup',
          {
            uid: STU_FAIL_UID,
            email: STU_FAIL_EMAIL,
            name: 'Aluno Falha Signup',
            role: 'student',
          },
          { Authorization: 'Bearer tok-stu-fail' }
        );
        assert.strictEqual(failSig.status, 500);
        assert.notStrictEqual(failSig.data?.success, true);
        assert.strictEqual(readDb().userProfiles?.[STU_FAIL_EMAIL], undefined);
      } finally {
        mockFs._setFailOnSet(null);
      }
    });

    await test('3. Falha atômica em student_assignments/{uid} impede gravação parcial em users/{uid} e mutação em RAM no /register e /signup', async () => {
      resetInMemoryDbForTesting();
      mockFs._setFailOnSet('student_assignments');
      try {
        const failAtom = await makeRequest(
          server,
          'POST',
          '/api/auth/signup',
          {
            uid: STU_ATOMIC_UID,
            email: STU_ATOMIC_EMAIL,
            name: 'Aluno Falha Atômica',
            role: 'student',
            teacherUid: APPROVED_TEACHER_UID,
          },
          { Authorization: 'Bearer tok-stu-atom' }
        );
        assert.strictEqual(failAtom.status, 500);
        assert.notStrictEqual(failAtom.data?.success, true);
        assert.strictEqual(
          mockFs._getDoc('users', STU_ATOMIC_UID),
          undefined,
          'users/{uid} NÃO pode ser gravado parcialmente quando student_assignments/{uid} falha'
        );
        assert.strictEqual(mockFs._getDoc('student_assignments', STU_ATOMIC_UID), undefined);
        assert.strictEqual(readDb().authUsers?.[STU_ATOMIC_EMAIL], undefined);
        assert.strictEqual(readDb().userProfiles?.[STU_ATOMIC_EMAIL], undefined);
        assert.strictEqual(readDb().students.find((s) => s.uid === STU_ATOMIC_UID), undefined);
      } finally {
        mockFs._setFailOnSet(null);
      }
    });

    await test('4. Cadastro pendente de teacher via /api/auth/register e /signup confirma users/{uid} e falha sem mutação em RAM', async () => {
      resetInMemoryDbForTesting();

      const okRes = await makeRequest(
        server,
        'POST',
        '/api/auth/register',
        {
          uid: TCH_REG_UID,
          email: TCH_REG_EMAIL,
          name: 'Teacher Pending Register 1B',
          role: 'teacher',
          headline: 'Native Coach',
          bio: 'Bio text',
        },
        { Authorization: 'Bearer tok-tch-reg' }
      );
      assert.strictEqual(okRes.status, 201);
      assert.strictEqual(okRes.data.success, true);
      assert.strictEqual(okRes.data.approvalStatus, 'pending');
      assert.strictEqual(okRes.data.tutor?.isApproved, false);

      const fsPendingTeacher = mockFs._getDoc('users', TCH_REG_UID);
      assert(fsPendingTeacher, 'users/{uid} do teacher pendente deve estar gravado no Firestore');
      assert.strictEqual(fsPendingTeacher.role, 'teacher');
      assert.strictEqual(fsPendingTeacher.approvalStatus, 'pending');
      assert.strictEqual(fsPendingTeacher.isApproved, false);

      mockFs._setFailOnSet('users');
      try {
        const failRes = await makeRequest(
          server,
          'POST',
          '/api/auth/signup',
          {
            uid: TCH_REG_FAIL_UID,
            email: TCH_REG_FAIL_EMAIL,
            name: 'Teacher Pending Fail 1B',
            role: 'teacher',
          },
          { Authorization: 'Bearer tok-tch-fail' }
        );
        assert.strictEqual(failRes.status, 500);
        assert.notStrictEqual(failRes.data?.success, true);
        assert.strictEqual(mockFs._getDoc('users', TCH_REG_FAIL_UID), undefined);
        assert.strictEqual(
          readDb().tutorsList.find((t: any) => t.uid === TCH_REG_FAIL_UID || t.email === TCH_REG_FAIL_EMAIL),
          undefined,
          'tutorsList RAM não pode ser mutado após falha'
        );
        assert.strictEqual(readDb().authUsers?.[TCH_REG_FAIL_EMAIL], undefined, 'authUsers RAM não pode ser mutado');
      } finally {
        mockFs._setFailOnSet(null);
      }
    });

    await test('5. POST /api/tutors (cadastro pendente) confirma tutors/{uid} e teacher_availability/{uid}, e falha atomicamente sem mutação em RAM', async () => {
      resetInMemoryDbForTesting();

      // 5a. Success case with meetUrl (persists both tutors/{uid} and teacher_availability/{uid})
      const okTutorRes = await makeRequest(
        server,
        'POST',
        '/api/tutors',
        {
          uid: TUTOR_PEND_UID,
          email: TUTOR_PEND_EMAIL,
          name: 'Tutor Pendente Sucesso 1B',
          availableDays: ['monday', 'wednesday'],
          availableHours: ['09:00', '10:00'],
          meetUrl: 'https://meet.google.com/p1b-tutor-ok',
        },
        { Authorization: 'Bearer tok-tutor-pend' }
      );
      assert.strictEqual(okTutorRes.status, 200);
      assert.strictEqual(okTutorRes.data.success, true);
      assert.strictEqual(okTutorRes.data.tutor?.approvalStatus, 'pending');
      assert.strictEqual(okTutorRes.data.tutor?.isApproved, false);

      const fsTutor = mockFs._getDoc('tutors', TUTOR_PEND_UID);
      const fsAvail = mockFs._getDoc('teacher_availability', TUTOR_PEND_UID);
      assert(fsTutor, 'tutors/{uid} deve existir no Firestore após POST /api/tutors pendente');
      assert.strictEqual(fsTutor.approvalStatus, 'pending');
      assert.strictEqual(fsTutor.isApproved, false);
      assert(fsAvail, 'teacher_availability/{uid} deve existir no Firestore quando meetUrl é informado');
      assert.strictEqual(fsAvail.meetLink, 'https://meet.google.com/p1b-tutor-ok');

      // 5b. Failure on tutors/{uid}
      mockFs._setFailOnSet('tutors');
      try {
        const failTutorRes = await makeRequest(
          server,
          'POST',
          '/api/tutors',
          {
            uid: TUTOR_FAIL_UID,
            email: TUTOR_FAIL_EMAIL,
            name: 'Tutor Pendente Falha 1B',
            availableDays: ['tuesday'],
            availableHours: ['11:00'],
            meetUrl: 'https://meet.google.com/p1b-tutor-fail',
          },
          { Authorization: 'Bearer tok-tutor-fail' }
        );
        assert.strictEqual(failTutorRes.status, 500);
        assert.notStrictEqual(failTutorRes.data?.success, true);
        assert.strictEqual(mockFs._getDoc('tutors', TUTOR_FAIL_UID), undefined);
        assert.strictEqual(mockFs._getDoc('teacher_availability', TUTOR_FAIL_UID), undefined);
        assert.strictEqual(readDb().tutorsList.find((t: any) => t.uid === TUTOR_FAIL_UID), undefined);
        assert.strictEqual(readDb().authUsers?.[TUTOR_FAIL_EMAIL], undefined);
        assert.strictEqual(readDb().meetSettings?.[TUTOR_FAIL_EMAIL], undefined);
      } finally {
        mockFs._setFailOnSet(null);
      }

      // 5c. Atomic failure on teacher_availability/{uid} prevents partial tutors/{uid} and RAM mutation
      mockFs._setFailOnSet('teacher_availability');
      try {
        const failAvailRes = await makeRequest(
          server,
          'POST',
          '/api/tutors',
          {
            uid: TUTOR_AVAIL_FAIL_UID,
            email: TUTOR_AVAIL_FAIL_EMAIL,
            name: 'Tutor Avail Falha 1B',
            availableDays: ['friday'],
            availableHours: ['15:00'],
            meetUrl: 'https://meet.google.com/p1b-avail-fail',
          },
          { Authorization: 'Bearer tok-tutor-avfail' }
        );
        assert.strictEqual(failAvailRes.status, 500);
        assert.notStrictEqual(failAvailRes.data?.success, true);
        assert.strictEqual(
          mockFs._getDoc('tutors', TUTOR_AVAIL_FAIL_UID),
          undefined,
          'tutors/{uid} NÃO pode ser gravado parcialmente quando teacher_availability/{uid} falha'
        );
        assert.strictEqual(mockFs._getDoc('teacher_availability', TUTOR_AVAIL_FAIL_UID), undefined);
        assert.strictEqual(readDb().tutorsList.find((t: any) => t.uid === TUTOR_AVAIL_FAIL_UID), undefined);
        assert.strictEqual(readDb().meetSettings?.[TUTOR_AVAIL_FAIL_EMAIL], undefined);
      } finally {
        mockFs._setFailOnSet(null);
      }
    });

    await test('6. Firestore indisponível retorna 503 FIRESTORE_UNAVAILABLE sem gravação em RAM em todos os 3 fluxos', async () => {
      resetInMemoryDbForTesting();
      setFirebaseAdminFirestoreForTesting(null);
      try {
        const resStuReg503 = await makeRequest(
          server,
          'POST',
          '/api/auth/register',
          {
            uid: STU_FAIL_UID,
            email: STU_FAIL_EMAIL,
            name: 'Stu 503',
            role: 'student',
          },
          { Authorization: 'Bearer tok-stu-fail' }
        );
        assert.strictEqual(resStuReg503.status, 503);
        assert.strictEqual(resStuReg503.data.error, 'FIRESTORE_UNAVAILABLE');

        const resTchSig503 = await makeRequest(
          server,
          'POST',
          '/api/auth/signup',
          {
            uid: TCH_REG_FAIL_UID,
            email: TCH_REG_FAIL_EMAIL,
            name: 'Tch 503',
            role: 'teacher',
          },
          { Authorization: 'Bearer tok-tch-fail' }
        );
        assert.strictEqual(resTchSig503.status, 503);
        assert.strictEqual(resTchSig503.data.error, 'FIRESTORE_UNAVAILABLE');

        const resTutor503 = await makeRequest(
          server,
          'POST',
          '/api/tutors',
          {
            uid: TUTOR_FAIL_UID,
            email: TUTOR_FAIL_EMAIL,
            name: 'Tutor 503',
            availableDays: ['monday'],
          },
          { Authorization: 'Bearer tok-tutor-fail' }
        );
        assert.strictEqual(resTutor503.status, 503);
        assert.strictEqual(resTutor503.data.error, 'FIRESTORE_UNAVAILABLE');

        assert.strictEqual(readDb().students.length, 0);
        assert.strictEqual(readDb().tutorsList.length, 0);
        assert.strictEqual(Object.keys(readDb().authUsers || {}).length, 0);
      } finally {
        setFirebaseAdminFirestoreForTesting(mockFs as any);
      }
    });

    await test('7. RBAC, rejeição de admin público, comissão não-admin e UID canônico preservados', async () => {
      resetInMemoryDbForTesting();

      const adminRegRes = await makeRequest(server, 'POST', '/api/auth/register', {
        uid: 'anyUid00000000000000000001',
        email: 'admin.attempt@itissimple-test.com',
        name: 'Admin Attempt',
        role: 'admin',
      });
      assert.strictEqual(adminRegRes.status, 403);

      const mismatchRes = await makeRequest(
        server,
        'POST',
        '/api/auth/signup',
        {
          uid: STU_FAIL_UID,
          email: 'other.email@itissimple-test.com',
          name: 'Mismatch',
          role: 'student',
        },
        { Authorization: 'Bearer tok-stu-fail' }
      );
      assert.strictEqual(mismatchRes.status, 403);

      const synthRes = await makeRequest(server, 'POST', '/api/auth/register', {
        uid: 'st-1234',
        email: 'synth@itissimple-test.com',
        name: 'Synth',
        role: 'student',
      });
      assert.strictEqual(synthRes.status, 400);

      const commRes = await makeRequest(
        server,
        'POST',
        '/api/tutors',
        {
          uid: TUTOR_FAIL_UID,
          email: TUTOR_FAIL_EMAIL,
          name: 'Tutor Commission Attempt',
          availableDays: ['monday'],
          adminCommissionPercent: 10,
        },
        { Authorization: 'Bearer tok-tutor-fail' }
      );
      assert.strictEqual(commRes.status, 403);
      assert.strictEqual(commRes.data.code, 'COMMISSION_ADMIN_ONLY');

      // Existing student cannot register as pending tutor via POST /api/tutors
      const stuAsTutorRes = await makeRequest(
        server,
        'POST',
        '/api/tutors',
        {
          uid: STU_REG_UID,
          email: STU_REG_EMAIL,
          name: 'Student Hijack Tutor',
          availableDays: ['monday'],
        },
        { Authorization: 'Bearer tok-stu-reg' }
      );
      assert.strictEqual(stuAsTutorRes.status, 409);
      assert.strictEqual(stuAsTutorRes.data.error, 'ROLE_MUTATION_FORBIDDEN');
    });

    await test('8. Fallback sem runTransaction (mock simplificado) também aguarda e propaga falha de escrita', async () => {
      resetInMemoryDbForTesting();
      const noTxFs = createTestFirestoreMock({ disableTransactions: true });
      seedApprovedTeacher(noTxFs);
      setFirebaseAdminFirestoreForTesting(noTxFs as any);

      try {
        const okStu = await makeRequest(
          server,
          'POST',
          '/api/auth/register',
          {
            uid: STU_NOTX_UID,
            email: STU_NOTX_EMAIL,
            name: 'Student NoTx Ok',
            role: 'student',
            teacherUid: APPROVED_TEACHER_UID,
          },
          { Authorization: 'Bearer tok-stu-notx' }
        );
        assert.strictEqual(okStu.status, 201);
        assert(noTxFs._getDoc('users', STU_NOTX_UID));
        assert(noTxFs._getDoc('student_assignments', STU_NOTX_UID));

        noTxFs._setFailOnSet('tutors');
        const failTutor = await makeRequest(
          server,
          'POST',
          '/api/tutors',
          {
            uid: TUTOR_NOTX_UID,
            email: TUTOR_NOTX_EMAIL,
            name: 'Tutor NoTx Fail',
            availableDays: ['monday'],
          },
          { Authorization: 'Bearer tok-tutor-notx' }
        );
        assert.strictEqual(failTutor.status, 500);
        assert.strictEqual(readDb().tutorsList.find((t: any) => t.uid === TUTOR_NOTX_UID), undefined);
      } finally {
        noTxFs._setFailOnSet(null);
        setFirebaseAdminFirestoreForTesting(mockFs as any);
      }
    });
  } finally {
    resetFirebaseAdminFirestoreForTesting();
    resetFirebaseAdminForTesting();
    resetInMemoryDbForTesting();
    server.closeAllConnections?.();
    server.close();
  }

  console.log('\n======================================================================');
  console.log(`PERSIST.1B SUITE: ${passed} PASSED, ${failed} FAILED`);
  console.log('======================================================================');
  process.exit(failed > 0 ? 1 : 0);
}

runSuite().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
