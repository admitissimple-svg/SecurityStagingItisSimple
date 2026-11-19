import assert from 'assert';
import http from 'http';
import { app as serverApp, readDb, resetInMemoryDbForTesting } from '../serverApp';
import {
  setFirebaseAdminFirestoreForTesting,
  resetFirebaseAdminFirestoreForTesting,
  setIsCloudWriteDisabled,
} from '../src/serverFirestore';
import { setFirebaseAdminAuthForTesting, resetFirebaseAdminForTesting } from '../src/serverFirebaseAdmin';

function createTestFirestoreMock() {
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
      set: async (data: Record<string, any>, opts?: { merge?: boolean }) => {
        if (failOnSetCollection && (fullCol === failOnSetCollection || failOnSetCollection === '*')) {
          throw new Error(`Simulated Firestore write error on ${fullCol}/${id}`);
        }
        const prev = opts?.merge ? (store.get(key) || {}) : {};
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

  return {
    collection: (col: string) => makeCollectionRef(col),
    batch: () => {
      const staged: Array<{ type: 'set' | 'update' | 'delete'; col: string; id: string; data?: Record<string, any>; merge?: boolean }> = [];
      return {
        set: (ref: any, data: Record<string, any>, opts?: { merge?: boolean }) => {
          staged.push({ type: 'set', col: ref._col, id: ref._id, data: JSON.parse(JSON.stringify(data)), merge: Boolean(opts?.merge) });
        },
        update: (ref: any, data: Record<string, any>) => {
          staged.push({ type: 'update', col: ref._col, id: ref._id, data: JSON.parse(JSON.stringify(data)), merge: true });
        },
        delete: (ref: any) => {
          staged.push({ type: 'delete', col: ref._col, id: ref._id });
        },
        commit: async () => {
          for (const op of staged) {
            if (failOnSetCollection && (op.col === failOnSetCollection || failOnSetCollection === '*')) {
              throw new Error(`Simulated Firestore batch commit error on ${op.col}/${op.id}`);
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
          return [];
        },
      };
    },
    runTransaction: async (fn: (tx: any) => Promise<any>) => {
      const staged: Array<{ type: 'set' | 'update' | 'delete'; col: string; id: string; data?: Record<string, any>; merge?: boolean }> = [];
      const tx = {
        get: async (ref: any) => ref.get(),
        set: (ref: any, data: Record<string, any>, opts?: { merge?: boolean }) => {
          staged.push({
            type: 'set',
            col: ref._col,
            id: ref._id,
            data: JSON.parse(JSON.stringify(data)),
            merge: Boolean(opts?.merge),
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
      // Atomic validation before committing any staged mutation
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
    },
    _store: store,
    _setDoc: (col: string, id: string, data: Record<string, any>) => {
      store.set(`${col}::${id}`, JSON.parse(JSON.stringify(data)));
    },
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
  console.log('PERSIST.1A — PERSISTÊNCIA CANÔNICA DE ALUNOS (POST /api/students & /profile)');
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

  const ADMIN_UID = 'persist1aAdminUid00000000001';
  const ADMIN_EMAIL = 'adm.itissimple@gmail.com';
  const TEACHER_UID = 'persist1aTeacherUid0000000002';
  const TEACHER_EMAIL = 'teacher.persist1a@itissimple-test.com';
  const STUDENT_A_UID = 'persist1aStudentAUid000000003';
  const STUDENT_A_EMAIL = 'student.a.persist1a@itissimple-test.com';
  const STUDENT_B_UID = 'persist1aStudentBUid000000004';
  const STUDENT_B_EMAIL = 'student.b.persist1a@itissimple-test.com';

  const mockFs = createTestFirestoreMock();
  setFirebaseAdminFirestoreForTesting(mockFs as any);
  setIsCloudWriteDisabled(false);

  setFirebaseAdminAuthForTesting({
    verifyIdToken: async (token: string) => {
      if (token === 'tok-admin') return { uid: ADMIN_UID, email: ADMIN_EMAIL, role: 'admin', admin: true };
      if (token === 'tok-teacher') return { uid: TEACHER_UID, email: TEACHER_EMAIL };
      if (token === 'tok-student-a') return { uid: STUDENT_A_UID, email: STUDENT_A_EMAIL };
      if (token === 'tok-student-b') return { uid: STUDENT_B_UID, email: STUDENT_B_EMAIL };
      throw new Error('Invalid token');
    },
    getUser: async (uid: string) => {
      if (uid === TEACHER_UID) return { uid: TEACHER_UID, email: TEACHER_EMAIL };
      if (uid === STUDENT_A_UID) return { uid: STUDENT_A_UID, email: STUDENT_A_EMAIL };
      if (uid === STUDENT_B_UID) return { uid: STUDENT_B_UID, email: STUDENT_B_EMAIL };
      throw new Error('Not found');
    },
    getUserByEmail: async (email: string) => {
      if (email === TEACHER_EMAIL) return { uid: TEACHER_UID, email: TEACHER_EMAIL };
      if (email === STUDENT_A_UID) return { uid: STUDENT_A_UID, email: STUDENT_A_EMAIL };
      if (email === STUDENT_A_EMAIL) return { uid: STUDENT_A_UID, email: STUDENT_A_EMAIL };
      if (email === STUDENT_B_EMAIL) return { uid: STUDENT_B_UID, email: STUDENT_B_EMAIL };
      throw new Error('Not found');
    },
  } as any);

  const seedCanonicalTeacher = () => {
    mockFs._setDoc('tutors', TEACHER_UID, {
      id: TEACHER_UID,
      uid: TEACHER_UID,
      authUid: TEACHER_UID,
      publicTutorId: 'teacher-persist1a',
      email: TEACHER_EMAIL,
      name: 'Teacher Persist 1A',
      role: 'teacher',
      approvalStatus: 'approved',
      isApproved: true,
      approved: true,
      status: 'approved',
    });
    mockFs._setDoc('users', TEACHER_UID, {
      id: TEACHER_UID,
      uid: TEACHER_UID,
      authUid: TEACHER_UID,
      email: TEACHER_EMAIL,
      name: 'Teacher Persist 1A',
      role: 'teacher',
      approvalStatus: 'approved',
      isApproved: true,
    });
  };

  seedCanonicalTeacher();

  const server = http.createServer(serverApp);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    await test('1. POST /api/students persiste aluno e vínculo em users/{uid} e student_assignments/{uid}, sobrevivendo a reset de RAM', async () => {
      resetInMemoryDbForTesting();

      const res = await makeRequest(
        server,
        'POST',
        '/api/students',
        {
          uid: STUDENT_A_UID,
          email: STUDENT_A_EMAIL,
          name: 'Aluna Persist 1A',
          level: 'intermediate',
          learningGoal: 'Business English',
          routineVideoTime: '08:30',
          routineAudioTime: '13:15',
          dailyPhraseTime: '21:00',
          teacherUid: TEACHER_UID,
          contractedLessons: 999,
          availableLessons: 999,
          role: 'admin',
        },
        { Authorization: 'Bearer tok-admin' }
      );
      assert.strictEqual(res.status, 200);
      assert(Array.isArray(res.data));

      const fsUser = mockFs._getDoc('users', STUDENT_A_UID);
      assert(fsUser, 'users/{uid} deve existir no Firestore');
      assert.strictEqual(fsUser.uid, STUDENT_A_UID);
      assert.strictEqual(fsUser.email, STUDENT_A_EMAIL);
      assert.strictEqual(fsUser.name, 'Aluna Persist 1A');
      assert.strictEqual(fsUser.level, 'intermediate');
      assert.strictEqual(fsUser.learningGoal, 'Business English');
      assert.strictEqual(fsUser.role, 'student');
      assert.strictEqual(fsUser.contractedLessons, 0);
      assert.strictEqual(fsUser.availableLessons, 0);
      assert.strictEqual(fsUser.teacherUid, TEACHER_UID);
      assert.strictEqual(fsUser.assignedNativeFriendUID, TEACHER_UID);
      assert.strictEqual(fsUser.nativeFriendUID, TEACHER_UID);
      assert.strictEqual(fsUser.teacherEmail, TEACHER_EMAIL);
      assert.strictEqual(fsUser.status, 'active');
      assert.strictEqual(fsUser.enrollmentStatus, 'active');

      const fsAssign = mockFs._getDoc('student_assignments', STUDENT_A_UID);
      assert(fsAssign, 'student_assignments/{uid} deve existir no Firestore');
      assert.strictEqual(fsAssign.studentUid, STUDENT_A_UID);
      assert.strictEqual(fsAssign.teacherUid, TEACHER_UID);
      assert.strictEqual(fsAssign.assignedNativeFriendUID, TEACHER_UID);
      assert.strictEqual(fsAssign.nativeFriendUID, TEACHER_UID);
      assert.strictEqual(fsAssign.teacherEmail, TEACHER_EMAIL);

      // Wipe RAM completely and verify GET /api/students & GET /api/user-profile read persisted state from Firestore
      resetInMemoryDbForTesting();

      const adminListRes = await makeRequest(server, 'GET', '/api/students', undefined, {
        Authorization: 'Bearer tok-admin',
      });
      assert.strictEqual(adminListRes.status, 200);
      const foundAdmin = adminListRes.data.find((s: any) => s.uid === STUDENT_A_UID);
      assert(foundAdmin, 'Admin visualiza aluno persistido após reset de RAM');
      assert.strictEqual(foundAdmin.name, 'Aluna Persist 1A');
      assert.strictEqual(foundAdmin.teacherUid, TEACHER_UID);

      const teacherListRes = await makeRequest(server, 'GET', '/api/students', undefined, {
        Authorization: 'Bearer tok-teacher',
      });
      assert.strictEqual(teacherListRes.status, 200);
      const foundTeacher = teacherListRes.data.find((s: any) => s.uid === STUDENT_A_UID);
      assert(foundTeacher, 'Teacher vinculado visualiza aluno após reset de RAM');

      const profRes = await makeRequest(
        server,
        'GET',
        `/api/user-profile?uid=${STUDENT_A_UID}&email=${encodeURIComponent(STUDENT_A_EMAIL)}`,
        undefined,
        { Authorization: 'Bearer tok-student-a' }
      );
      assert.strictEqual(profRes.status, 200);
      assert.strictEqual(profRes.data.profile?.name, 'Aluna Persist 1A');
      assert.strictEqual(profRes.data.profile?.teacherUid, TEACHER_UID);
    });

    await test('2. POST /api/students preserva créditos, contadores e vínculo existentes quando atualizado sem teacher/créditos', async () => {
      // Seed authoritative balances directly in Firestore, keeping RAM empty
      mockFs._setDoc('users', STUDENT_A_UID, {
        ...mockFs._getDoc('users', STUDENT_A_UID),
        contractedLessons: 12,
        availableLessons: 8,
        completedLessonsCount: 4,
        hasCompletedTrialLesson: true,
        subscriptionType: 'package',
      });
      resetInMemoryDbForTesting();

      const updateRes = await makeRequest(
        server,
        'POST',
        '/api/students',
        {
          uid: STUDENT_A_UID,
          email: STUDENT_A_EMAIL,
          name: 'Aluna Atualizada ADM',
          level: 'advanced',
        },
        { Authorization: 'Bearer tok-admin' }
      );
      assert.strictEqual(updateRes.status, 200);

      const fsUser = mockFs._getDoc('users', STUDENT_A_UID);
      assert(fsUser, 'users/{uid} deve existir no Firestore');
      assert.strictEqual(fsUser.name, 'Aluna Atualizada ADM');
      assert.strictEqual(fsUser.level, 'advanced');
      assert.strictEqual(fsUser.contractedLessons, 12);
      assert.strictEqual(fsUser.availableLessons, 8);
      assert.strictEqual(fsUser.completedLessonsCount, 4);
      assert.strictEqual(fsUser.hasCompletedTrialLesson, true);
      assert.strictEqual(fsUser.teacherUid, TEACHER_UID);
      assert.strictEqual(fsUser.status, 'active');

      const cachedStu = readDb().students.find((s) => s.uid === STUDENT_A_UID);
      assert(cachedStu);
      assert.strictEqual(cachedStu.contractedLessons, 12);
      assert.strictEqual(cachedStu.teacherUid, TEACHER_UID);
    });

    await test('3. POST /api/students/profile persiste alterações em users/{uid} e student_assignments/{uid}, preserva vínculo/créditos e sobrevive a reset de RAM', async () => {
      resetInMemoryDbForTesting();

      const saveRes = await makeRequest(
        server,
        'POST',
        '/api/students/profile',
        {
          uid: STUDENT_A_UID,
          picture: 'https://cdn.example.com/avatar-a.png',
          profile: {
            email: STUDENT_A_EMAIL,
            name: 'Aluna Perfil Canônico',
            level: 'intermediate',
            learningGoal: 'Fluency & Travel',
            dailyGoalMinutes: 45,
            weeklyNativeLessonsTarget: 3,
            weeklyStudyDays: ['monday', 'wednesday', 'friday'],
            weeklyStudyDaysTarget: 3,
            routineVideoTime: '07:45',
            routineAudioTime: '12:30',
            dailyPhraseTime: '19:15',
            contractedLessons: 777,
            availableLessons: 777,
            hasCompletedTrialLesson: false,
            role: 'admin',
            teacherUid: 'some-other-teacher-uid-attempt',
          },
        },
        { Authorization: 'Bearer tok-student-a' }
      );
      assert.strictEqual(saveRes.status, 200);
      assert.strictEqual(saveRes.data.success, true);
      assert.strictEqual(saveRes.data.persistedToFirestore, true);
      assert.strictEqual(saveRes.data.profile?.name, 'Aluna Perfil Canônico');
      assert.strictEqual(saveRes.data.profile?.weeklyNativeLessonsTarget, 3);
      assert.strictEqual(saveRes.data.profile?.contractedLessons, 12);
      assert.strictEqual(saveRes.data.profile?.availableLessons, 8);
      assert.strictEqual(saveRes.data.profile?.hasCompletedTrialLesson, true);
      assert.strictEqual(saveRes.data.profile?.role, 'student');
      assert.strictEqual(saveRes.data.profile?.teacherUid, TEACHER_UID);

      const fsUser = mockFs._getDoc('users', STUDENT_A_UID);
      assert(fsUser, 'users/{uid} deve existir no Firestore');
      assert.strictEqual(fsUser.name, 'Aluna Perfil Canônico');
      assert.strictEqual(fsUser.level, 'intermediate');
      assert.strictEqual(fsUser.learningGoal, 'Fluency & Travel');
      assert.strictEqual(fsUser.dailyGoalMinutes, 45);
      assert.strictEqual(fsUser.weeklyNativeLessonsTarget, 3);
      assert.deepStrictEqual(fsUser.weeklyStudyDays, ['monday', 'wednesday', 'friday']);
      assert.strictEqual(fsUser.weeklyStudyDaysTarget, 3);
      assert.strictEqual(fsUser.routineVideoTime, '07:45');
      assert.strictEqual(fsUser.routineAudioTime, '12:30');
      assert.strictEqual(fsUser.dailyPhraseTime, '19:15');
      assert.strictEqual(fsUser.picture, 'https://cdn.example.com/avatar-a.png');
      assert.strictEqual(fsUser.contractedLessons, 12);
      assert.strictEqual(fsUser.availableLessons, 8);
      assert.strictEqual(fsUser.teacherUid, TEACHER_UID);
      assert.strictEqual(fsUser.role, 'student');

      const fsAssign = mockFs._getDoc('student_assignments', STUDENT_A_UID);
      assert(fsAssign, 'student_assignments/{uid} deve existir no Firestore');
      assert.strictEqual(fsAssign.level, 'intermediate');
      assert.deepStrictEqual(fsAssign.weeklyStudyDays, ['monday', 'wednesday', 'friday']);
      assert.strictEqual(fsAssign.weeklyStudyDaysTarget, 3);
      assert.strictEqual(fsAssign.teacherUid, TEACHER_UID);

      // Wipe RAM completely and read back via GET /api/user-profile
      resetInMemoryDbForTesting();

      const getRes = await makeRequest(
        server,
        'GET',
        `/api/user-profile?uid=${STUDENT_A_UID}&email=${encodeURIComponent(STUDENT_A_EMAIL)}`,
        undefined,
        { Authorization: 'Bearer tok-student-a' }
      );
      assert.strictEqual(getRes.status, 200);
      assert.strictEqual(getRes.data.profile?.name, 'Aluna Perfil Canônico');
      assert.strictEqual(getRes.data.profile?.learningGoal, 'Fluency & Travel');
      assert.strictEqual(getRes.data.profile?.weeklyNativeLessonsTarget, 3);
      assert.strictEqual(getRes.data.profile?.routineVideoTime, '07:45');
      assert.strictEqual(getRes.data.profile?.contractedLessons, 12);
      assert.strictEqual(getRes.data.profile?.teacherUid, TEACHER_UID);
    });

    await test('4. Falha de gravação no Firestore NÃO atualiza caches em RAM (POST /api/students e /profile)', async () => {
      resetInMemoryDbForTesting();

      // Seed baseline student B in Firestore and RAM
      mockFs._setDoc('users', STUDENT_B_UID, {
        id: STUDENT_B_UID,
        uid: STUDENT_B_UID,
        email: STUDENT_B_EMAIL,
        name: 'Aluna B Original',
        role: 'student',
        level: 'beginner',
        learningGoal: 'Original Goal',
        weeklyNativeLessonsTarget: 1,
        contractedLessons: 2,
      });
      const dbBefore = readDb();
      dbBefore.students.push({
        id: STUDENT_B_UID,
        uid: STUDENT_B_UID,
        email: STUDENT_B_EMAIL,
        studentEmail: STUDENT_B_EMAIL,
        name: 'Aluna B Original',
        level: 'beginner',
        contractedLessons: 2,
      } as any);
      dbBefore.userProfiles[STUDENT_B_EMAIL] = {
        id: STUDENT_B_UID,
        uid: STUDENT_B_UID,
        email: STUDENT_B_EMAIL,
        name: 'Aluna B Original',
        learningGoal: 'Original Goal',
        weeklyNativeLessonsTarget: 1,
        contractedLessons: 2,
      };

      // Simulate Firestore write failure
      mockFs._setFailOnSet('users');
      try {
        const failStudentsRes = await makeRequest(
          server,
          'POST',
          '/api/students',
          {
            uid: STUDENT_B_UID,
            email: STUDENT_B_EMAIL,
            name: 'Aluna B Contaminada RAM',
          },
          { Authorization: 'Bearer tok-admin' }
        );
        assert.strictEqual(failStudentsRes.status, 500);
        assert.strictEqual(
          readDb().students.find((s) => s.uid === STUDENT_B_UID)?.name,
          'Aluna B Original',
          'Cache db.students não pode ser mutado após falha do Firestore'
        );

        const failProfileRes = await makeRequest(
          server,
          'POST',
          '/api/students/profile',
          {
            uid: STUDENT_B_UID,
            profile: {
              email: STUDENT_B_EMAIL,
              name: 'Aluna B Perfil Contaminado',
              learningGoal: 'Contaminated Goal',
              weeklyNativeLessonsTarget: 5,
            },
          },
          { Authorization: 'Bearer tok-student-b' }
        );
        assert.strictEqual(failProfileRes.status, 500);
        assert.strictEqual(
          readDb().userProfiles[STUDENT_B_EMAIL]?.name,
          'Aluna B Original',
          'Cache db.userProfiles não pode ser mutado após falha do Firestore'
        );
        assert.strictEqual(
          readDb().userProfiles[STUDENT_B_EMAIL]?.learningGoal,
          'Original Goal'
        );
        assert.strictEqual(
          readDb().weeklyNativeTargets[STUDENT_B_EMAIL],
          undefined,
          'Cache db.weeklyNativeTargets não pode ser mutado após falha do Firestore'
        );
      } finally {
        mockFs._setFailOnSet(null);
      }
    });

    await test('5. Firestore indisponível retorna 503 sem gravação em RAM', async () => {
      setFirebaseAdminFirestoreForTesting(null);
      try {
        const resStudents503 = await makeRequest(
          server,
          'POST',
          '/api/students',
          {
            uid: STUDENT_B_UID,
            email: STUDENT_B_EMAIL,
            name: 'Sem Firestore',
          },
          { Authorization: 'Bearer tok-admin' }
        );
        assert.strictEqual(resStudents503.status, 503);
        assert.strictEqual(resStudents503.data.error, 'FIRESTORE_UNAVAILABLE');

        const resProfile503 = await makeRequest(
          server,
          'POST',
          '/api/students/profile',
          {
            uid: STUDENT_B_UID,
            profile: {
              email: STUDENT_B_EMAIL,
              name: 'Sem Firestore Profile',
            },
          },
          { Authorization: 'Bearer tok-student-b' }
        );
        assert.strictEqual(resProfile503.status, 503);
        assert.strictEqual(resProfile503.data.error, 'FIRESTORE_UNAVAILABLE');
      } finally {
        setFirebaseAdminFirestoreForTesting(mockFs as any);
      }
    });

    await test('6. RBAC e rejeição de UIDs sintéticos preservados em ambos os endpoints', async () => {
      assert.strictEqual((await makeRequest(server, 'POST', '/api/students', { uid: STUDENT_A_UID, email: STUDENT_A_EMAIL })).status, 401);
      assert.strictEqual(
        (await makeRequest(server, 'POST', '/api/students', { uid: STUDENT_A_UID, email: STUDENT_A_EMAIL }, { Authorization: 'Bearer tok-student-a' })).status,
        403
      );
      assert.strictEqual(
        (await makeRequest(server, 'POST', '/api/students', { uid: STUDENT_A_UID, email: STUDENT_A_EMAIL }, { Authorization: 'Bearer tok-teacher' })).status,
        403
      );
      assert.strictEqual(
        (await makeRequest(server, 'POST', '/api/students', { uid: 'st-1234', email: 'synth@test.com' }, { Authorization: 'Bearer tok-admin' })).status,
        400
      );

      assert.strictEqual((await makeRequest(server, 'POST', '/api/students/profile', { profile: { email: STUDENT_A_EMAIL } })).status, 401);
      assert.strictEqual(
        (await makeRequest(server, 'POST', '/api/students/profile', { uid: STUDENT_A_UID, profile: { email: STUDENT_A_EMAIL } }, { Authorization: 'Bearer tok-student-b' })).status,
        403
      );
      assert.strictEqual(
        (await makeRequest(server, 'POST', '/api/students/profile', { uid: TEACHER_UID, profile: { email: TEACHER_EMAIL } }, { Authorization: 'Bearer tok-teacher' })).status,
        403
      );
      assert.strictEqual(
        (await makeRequest(server, 'POST', '/api/students/profile', { uid: 'st-1234', profile: { email: 'synth@test.com' } }, { Authorization: 'Bearer tok-admin' })).status,
        400
      );
    });

    await test('7. Admin atualizando perfil de aluno por e-mail sem uid explícito resolve UID do aluno sem sobrescrever admin', async () => {
      const admDocBefore = mockFs._getDoc('users', ADMIN_UID);
      assert.strictEqual(admDocBefore, undefined);

      const admProfRes = await makeRequest(
        server,
        'POST',
        '/api/students/profile',
        {
          profile: {
            email: STUDENT_B_EMAIL,
            name: 'Aluna B Editada pelo Admin',
            weeklyNativeLessonsTarget: 2,
          },
        },
        { Authorization: 'Bearer tok-admin' }
      );
      assert.strictEqual(admProfRes.status, 200);
      assert.strictEqual(admProfRes.data.profile?.uid, STUDENT_B_UID);
      assert.strictEqual(admProfRes.data.profile?.name, 'Aluna B Editada pelo Admin');
      assert.strictEqual(mockFs._getDoc('users', STUDENT_B_UID)?.name, 'Aluna B Editada pelo Admin');
      assert.strictEqual(mockFs._getDoc('users', ADMIN_UID), undefined, 'Nunca deve gravar perfil do aluno no doc do Admin');
    });

    await test('8. PERSIST.1A.1 — Falha atômica em student_assignments/{uid} impede gravação parcial em users/{uid} e mutação em RAM (POST /api/students e /profile)', async () => {
      resetInMemoryDbForTesting();

      const ATOMIC_STU_UID = 'persist1aAtomicStuUid00000005';
      const ATOMIC_STU_EMAIL = 'atomic.persist1a@itissimple-test.com';

      // 8a. POST /api/students with failure on second write (student_assignments) must NOT persist users/{uid} or mutate RAM
      mockFs._setFailOnSet('student_assignments');
      try {
        const failNewStudentRes = await makeRequest(
          server,
          'POST',
          '/api/students',
          {
            uid: ATOMIC_STU_UID,
            email: ATOMIC_STU_EMAIL,
            name: 'Aluna Rollback Novo',
            level: 'intermediate',
            teacherUid: TEACHER_UID,
          },
          { Authorization: 'Bearer tok-admin' }
        );
        assert.strictEqual(failNewStudentRes.status, 500);
        assert.strictEqual(
          mockFs._getDoc('users', ATOMIC_STU_UID),
          undefined,
          'users/{uid} NÃO pode ser gravado parcialmente quando student_assignments/{uid} falha'
        );
        assert.strictEqual(
          mockFs._getDoc('student_assignments', ATOMIC_STU_UID),
          undefined,
          'student_assignments/{uid} deve permanecer ausente'
        );
        assert.strictEqual(
          readDb().students.find((s) => s.uid === ATOMIC_STU_UID),
          undefined,
          'Cache RAM db.students não pode ser atualizado em falha atômica'
        );
      } finally {
        mockFs._setFailOnSet(null);
      }

      // 8b. Seed baseline for STUDENT_B and test POST /api/students/profile failure on student_assignments (student self-update)
      const rawUserBefore = mockFs._getDoc('users', STUDENT_B_UID);
      const userBefore = rawUserBefore ? JSON.parse(JSON.stringify(rawUserBefore)) : undefined;
      const rawAssignBefore = mockFs._getDoc('student_assignments', STUDENT_B_UID);
      const assignBefore = rawAssignBefore ? JSON.parse(JSON.stringify(rawAssignBefore)) : undefined;
      readDb().userProfiles[STUDENT_B_EMAIL] = {
        ...(userBefore || {}),
        name: 'Aluna B Pre-Atomic',
        learningGoal: 'Pre-Atomic Goal',
        weeklyNativeLessonsTarget: 2,
      };
      readDb().weeklyNativeTargets[STUDENT_B_EMAIL] = 2;

      mockFs._setFailOnSet('student_assignments');
      try {
        const failAtomicProfileRes = await makeRequest(
          server,
          'POST',
          '/api/students/profile',
          {
            uid: STUDENT_B_UID,
            profile: {
              email: STUDENT_B_EMAIL,
              name: 'Aluna B Parcial Indevido',
              level: 'advanced',
              learningGoal: 'Broken Partial Goal',
              weeklyNativeLessonsTarget: 6,
              weeklyStudyDays: ['tuesday', 'thursday'],
              weeklyStudyDaysTarget: 2,
            },
          },
          { Authorization: 'Bearer tok-student-b' }
        );
        assert.strictEqual(failAtomicProfileRes.status, 500);
        assert.deepStrictEqual(
          mockFs._getDoc('users', STUDENT_B_UID),
          userBefore,
          'users/{uid} NÃO pode ser alterado quando student_assignments/{uid} falha em POST /api/students/profile'
        );
        assert.deepStrictEqual(
          mockFs._getDoc('student_assignments', STUDENT_B_UID),
          assignBefore,
          'student_assignments/{uid} deve permanecer inalterado'
        );
        assert.strictEqual(readDb().userProfiles[STUDENT_B_EMAIL]?.name, 'Aluna B Pre-Atomic');
        assert.strictEqual(readDb().userProfiles[STUDENT_B_EMAIL]?.learningGoal, 'Pre-Atomic Goal');
        assert.strictEqual(readDb().weeklyNativeTargets[STUDENT_B_EMAIL], 2);
        assert.strictEqual(readDb().weeklyStudyDays?.[STUDENT_B_EMAIL], undefined);
      } finally {
        mockFs._setFailOnSet(null);
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
  console.log(`PERSIST.1A SUITE: ${passed} PASSED, ${failed} FAILED`);
  console.log('======================================================================');
  process.exit(failed > 0 ? 1 : 0);
}

runSuite().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
