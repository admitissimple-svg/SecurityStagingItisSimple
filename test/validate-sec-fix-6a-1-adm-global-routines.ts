/**
 * SEC.FIX.6A.1 — Persistência do Template Global ADM (GET/POST /api/routines)
 *
 * Valida:
 * 1. POST /api/routines (ADM sem aluno-alvo) confirma gravação em app_state/routines.routinesByDay no Firestore (default)
 *    antes de atualizar RAM ou retornar HTTP 200, preservando outros campos de app_state/routines e substituindo routinesByDay sem merge residual.
 * 2. Persistência após reinício simulado (resetInMemoryDbForTesting + resetResidualCachesForTesting):
 *    GET /api/routines (ADM sem aluno-alvo) retorna integralmente o template persistido em formato Record<DayOfWeek, RoutineItem[]>.
 * 3. GET /api/routines (ADM sem aluno-alvo) nunca prioriza RAM desatualizada quando Firestore possui outro template ou está vazio.
 * 4. Falha ou indisponibilidade do Firestore em POST e GET retorna erro (500/503) sem sucesso aparente e sem mutar RAM.
 * 5. Isolamento ADM/aluno/professor preservado: aluno, professor e ADM com aluno-alvo não alteram nem vazam app_state/routines.routinesByDay.
 */

process.env.NODE_ENV = 'test';
process.env.FIREBASE_PROJECT_ID = 'itissimple-security-staging';
process.env.FIREBASE_DATABASE_ID = '(default)';

import assert from 'node:assert';
import http from 'node:http';
import type { Firestore } from 'firebase-admin/firestore';
import {
  app as serverApp,
  readDb,
  resetInMemoryDbForTesting,
  resetResidualCachesForTesting,
} from '../serverApp';
import { setFirebaseAdminAuthForTesting, resetFirebaseAdminForTesting } from '../src/serverFirebaseAdmin';
import {
  setFirebaseAdminFirestoreForTesting,
  resetFirebaseAdminFirestoreForTesting,
  setIsCloudWriteDisabled,
  fetchAppStateFromFirestore,
} from '../src/serverFirestore';

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

function deepClone<T>(val: T): T {
  return val === undefined ? val : JSON.parse(JSON.stringify(val));
}

function deepMergeFirestore(target: Record<string, any>, source: Record<string, any>): Record<string, any> {
  const out = { ...target };
  for (const [k, v] of Object.entries(source)) {
    if (
      v &&
      typeof v === 'object' &&
      !Array.isArray(v) &&
      out[k] &&
      typeof out[k] === 'object' &&
      !Array.isArray(out[k])
    ) {
      out[k] = deepMergeFirestore(out[k], v);
    } else {
      out[k] = deepClone(v);
    }
  }
  return out;
}

function createRealisticMockFirestore() {
  const store = new Map<string, Record<string, any>>();
  let failOnReadCol: string | null = null;
  let failOnWriteCol: string | null = null;
  let failWriteAsPermission = false;

  const getCollectionEntries = (colPath: string) => {
    const prefix = `${colPath}::`;
    const items: Array<{ id: string; data: Record<string, any> }> = [];
    for (const [k, v] of store.entries()) {
      if (k.startsWith(prefix)) {
        const id = k.slice(prefix.length);
        if (!id.includes('::') && !id.includes('/')) {
          items.push({ id, data: deepClone(v) });
        }
      }
    }
    return items;
  };

  const makeQuery = (colPath: string, filters: Array<{ field: string; op: string; value: any }>) => ({
    where: (field: string, op: string, value: any) => makeQuery(colPath, [...filters, { field, op, value }]),
    limit: () => makeQuery(colPath, filters),
    get: async () => {
      if (failOnReadCol && (colPath === failOnReadCol || failOnReadCol === '*')) {
        throw new Error(`Simulated Firestore query error on ${colPath}`);
      }
      const docs: any[] = [];
      for (const { id, data } of getCollectionEntries(colPath)) {
        const matchesAll = filters.every((f) => {
          const actual = data?.[f.field];
          if (f.op === '==') return actual === f.value;
          if (f.op === 'in' && Array.isArray(f.value)) return f.value.includes(actual);
          if (f.op === 'array-contains' && Array.isArray(actual)) return actual.includes(f.value);
          return false;
        });
        if (matchesAll) {
          docs.push({
            id,
            exists: true,
            ref: makeDocRef(colPath, id),
            data: () => deepClone(data),
          });
        }
      }
      return { empty: docs.length === 0, size: docs.length, docs, forEach: (cb: any) => docs.forEach(cb) };
    },
  });

  const makeCollectionRef = (colPath: string): any => ({
    doc: (id: string) => makeDocRef(colPath, id),
    where: (field: string, op: string, value: any) => makeQuery(colPath, [{ field, op, value }]),
    get: async () => makeQuery(colPath, []).get(),
  });

  const makeDocRef = (colPath: string, id: string): any => {
    const key = `${colPath}::${id}`;
    const docPath = `${colPath}/${id}`;
    return {
      id,
      path: docPath,
      get: async () => {
        if (failOnReadCol && (colPath === failOnReadCol || failOnReadCol === '*')) {
          const err: any = new Error(`Simulated Firestore read error on ${docPath}`);
          if (failWriteAsPermission) err.code = 7;
          throw err;
        }
        const val = store.get(key);
        return {
          id,
          exists: Boolean(val),
          ref: makeDocRef(colPath, id),
          data: () => (val ? deepClone(val) : undefined),
        };
      },
      set: async (data: Record<string, any>, opts?: { merge?: boolean }) => {
        if (failOnWriteCol && (colPath === failOnWriteCol || failOnWriteCol === '*')) {
          const err: any = new Error(
            failWriteAsPermission ? `7 PERMISSION_DENIED: ${docPath}` : `Simulated Firestore set error on ${docPath}`
          );
          if (failWriteAsPermission) err.code = 7;
          throw err;
        }
        if (opts?.merge) {
          const prev = store.get(key) || {};
          // Realistic Firestore set({merge: true}) recursively merges nested maps
          store.set(key, deepMergeFirestore(prev, data));
        } else {
          store.set(key, deepClone(data));
        }
        return { writeTime: new Date() };
      },
      update: async (data: Record<string, any>) => {
        if (failOnWriteCol && (colPath === failOnWriteCol || failOnWriteCol === '*')) {
          const err: any = new Error(
            failWriteAsPermission ? `7 PERMISSION_DENIED: ${docPath}` : `Simulated Firestore update error on ${docPath}`
          );
          if (failWriteAsPermission) err.code = 7;
          throw err;
        }
        const prev = store.get(key);
        if (!prev) throw new Error(`NOT_FOUND: ${docPath}`);
        // Top-level field replacement semantics in Firestore update()
        store.set(key, deepClone({ ...prev, ...data }));
        return { writeTime: new Date() };
      },
      delete: async () => {
        store.delete(key);
        return { writeTime: new Date() };
      },
      collection: (sub: string) => makeCollectionRef(`${colPath}/${id}/${sub}`),
    };
  };

  return {
    projectId: 'itissimple-security-staging',
    databaseId: '(default)',
    collection: (col: string) => makeCollectionRef(col),
    _setDoc: (colPath: string, id: string, data: Record<string, any>) => {
      store.set(`${colPath}::${id}`, deepClone(data));
    },
    _getDoc: (colPath: string, id: string) => deepClone(store.get(`${colPath}::${id}`)),
    _clearAll: () => {
      store.clear();
      failOnReadCol = null;
      failOnWriteCol = null;
      failWriteAsPermission = false;
    },
    _setFailOnRead: (col: string | null, asPerm = false) => {
      failOnReadCol = col;
      failWriteAsPermission = asPerm;
    },
    _setFailOnWrite: (col: string | null, asPerm = false) => {
      failOnWriteCol = col;
      failWriteAsPermission = asPerm;
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
    const addr = server.address() as any;
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: addr.port,
        path: reqPath,
        method,
        headers: {
          Connection: 'close',
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

const ADMIN_UID = 'adminUidSecFix6a10000000001';
const ADMIN_EMAIL = 'admin.secfix6a1@itissimple.com';
const TEACHER_UID = 'teacherUidSecFix6a1000000001';
const TEACHER_EMAIL = 'teacher.secfix6a1@itissimple.com';
const STUDENT_UID = 'studentUidSecFix6a1000000001';
const STUDENT_EMAIL = 'student.secfix6a1@itissimple.com';

function seedUsers(mockFs: ReturnType<typeof createRealisticMockFirestore>) {
  resetInMemoryDbForTesting();
  resetResidualCachesForTesting();
  setIsCloudWriteDisabled(false);
  mockFs._clearAll();

  mockFs._setDoc('tutors', TEACHER_UID, {
    id: TEACHER_UID,
    uid: TEACHER_UID,
    authUid: TEACHER_UID,
    email: TEACHER_EMAIL,
    name: 'Teacher SecFix6A1',
    role: 'teacher',
    approvalStatus: 'approved',
    isApproved: true,
  });

  mockFs._setDoc('users', STUDENT_UID, {
    id: STUDENT_UID,
    uid: STUDENT_UID,
    email: STUDENT_EMAIL,
    name: 'Student SecFix6A1',
    role: 'student',
    teacherUid: TEACHER_UID,
    assignedNativeFriendUID: TEACHER_UID,
    teacherEmail: TEACHER_EMAIL,
    enrollmentStatus: 'active',
    weeklyCycle: 1,
  });
  mockFs._setDoc(`users/${STUDENT_UID}/routines`, 'monday', {
    dayOfWeek: 'monday',
    weeklyCycle: 1,
    videoId: 'dQw4w9WgXcQ',
    title: 'Student Isolated Video',
    learnedWords: ['student-only-word'],
  });

  const db = readDb();
  db.tutorsList = [
    {
      id: TEACHER_UID,
      uid: TEACHER_UID,
      authUid: TEACHER_UID,
      email: TEACHER_EMAIL,
      name: 'Teacher SecFix6A1',
      role: 'teacher',
      approvalStatus: 'approved',
      isApproved: true,
    },
  ];
  db.teachers = [
    { id: ADMIN_UID, uid: ADMIN_UID, email: ADMIN_EMAIL, role: 'admin', name: 'Admin SecFix6A1' },
    ...db.tutorsList,
  ];
}

async function run() {
  console.log('\n=== SEC.FIX.6A.1: Persistência do Template Global ADM (GET/POST /api/routines) ===\n');

  const mockFs = createRealisticMockFirestore();
  setFirebaseAdminFirestoreForTesting(mockFs as unknown as Firestore);

  setFirebaseAdminAuthForTesting({
    verifyIdToken: async (token: string) => {
      switch (token) {
        case 'tok-admin':
          return { uid: ADMIN_UID, email: ADMIN_EMAIL, email_verified: true, role: 'admin', admin: true };
        case 'tok-teacher':
          return { uid: TEACHER_UID, email: TEACHER_EMAIL, email_verified: true, role: 'teacher' };
        case 'tok-student':
          return { uid: STUDENT_UID, email: STUDENT_EMAIL, email_verified: true, role: 'student' };
        default:
          throw new Error('Invalid token');
      }
    },
  } as any);

  const server = http.createServer(serverApp);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));

  try {
    await test('1. POST ADM persiste em app_state/routines.routinesByDay, preserva outros campos e sobrevive a reinício simulado', async () => {
      seedUsers(mockFs);
      mockFs._setDoc('app_state', 'routines', {
        weeklyNativeTargets: { target1: 5 },
        studentRoutinesMap: { [STUDENT_UID]: { monday: [{ id: 'stu-existing', activityName: 'Keep Me' }] } },
      });

      const fullTemplate = {
        monday: [
          {
            id: 'm1-adm',
            dayOfWeek: 'monday',
            dayType: 'weekdays',
            time: '07:30',
            activityName: 'ADM Video Morning',
            category: 'morning',
            isMandatory: true,
            teacherVideos: [],
            teacherNotes: 'Global template note',
            learnedWords: [],
            completedToday: false,
          },
        ],
        tuesday: [
          {
            id: 't1-adm',
            dayOfWeek: 'tuesday',
            dayType: 'weekdays',
            time: '08:00',
            activityName: 'ADM Listening',
            category: 'morning',
            isMandatory: true,
          },
        ],
      };

      const postRes = await makeRequest(server, 'POST', '/api/routines', fullTemplate, {
        Authorization: 'Bearer tok-admin',
      });
      assert.strictEqual(postRes.status, 200);
      assert.strictEqual(postRes.data?.monday?.[0]?.id, 'm1-adm');
      assert.strictEqual(postRes.data?.tuesday?.[0]?.id, 't1-adm');

      // Canonical Firestore doc updated while preserving existing sibling fields
      const fsDoc = mockFs._getDoc('app_state', 'routines');
      assert.ok(fsDoc, 'app_state/routines deve existir no Firestore');
      assert.strictEqual(fsDoc.routinesByDay?.monday?.[0]?.id, 'm1-adm');
      assert.strictEqual(fsDoc.routinesByDay?.tuesday?.[0]?.id, 't1-adm');
      assert.deepStrictEqual(fsDoc.weeklyNativeTargets, { target1: 5 }, 'weeklyNativeTargets preservado');
      assert.strictEqual(
        fsDoc.studentRoutinesMap?.[STUDENT_UID]?.monday?.[0]?.id,
        'stu-existing',
        'studentRoutinesMap preservado'
      );

      // Update replacing template (only monday) must NOT retain stale tuesday inside Firestore map
      const replaceRes = await makeRequest(
        server,
        'POST',
        '/api/routines',
        { routinesByDay: { monday: [{ id: 'm1-adm-v2', time: '07:45', activityName: 'ADM V2' }] } },
        { Authorization: 'Bearer tok-admin' }
      );
      assert.strictEqual(replaceRes.status, 200);
      assert.strictEqual(replaceRes.data?.monday?.[0]?.id, 'm1-adm-v2');
      assert.strictEqual(replaceRes.data?.tuesday, undefined);

      const fsDocAfterReplace = mockFs._getDoc('app_state', 'routines');
      assert.ok(fsDocAfterReplace, 'app_state/routines deve existir após substituição');
      assert.strictEqual(fsDocAfterReplace.routinesByDay?.monday?.[0]?.id, 'm1-adm-v2');
      assert.strictEqual(
        fsDocAfterReplace.routinesByDay?.tuesday,
        undefined,
        'Substituição de routinesByDay não deixa dias antigos residuais no Firestore'
      );

      // Simulated server restart: wipe RAM completely
      resetInMemoryDbForTesting();
      resetResidualCachesForTesting();
      assert.notStrictEqual(readDb().routinesByDay?.monday?.[0]?.id, 'm1-adm-v2', 'RAM limpa após reinício simulado');

      // Admin GET must retrieve persisted template from Firestore (default)
      const getAfterRestart = await makeRequest(server, 'GET', '/api/routines', undefined, {
        Authorization: 'Bearer tok-admin',
      });
      assert.strictEqual(getAfterRestart.status, 200);
      assert.strictEqual(getAfterRestart.data?.monday?.[0]?.id, 'm1-adm-v2');
      assert.strictEqual(getAfterRestart.data?.tuesday, undefined);
      assert.strictEqual(readDb().routinesByDay?.monday?.[0]?.id, 'm1-adm-v2');

      // fetchAppStateFromFirestore also sees the canonical routinesByDay
      const hydrated = await fetchAppStateFromFirestore();
      assert.strictEqual(hydrated?.routinesByDay?.monday?.[0]?.id, 'm1-adm-v2');
    });

    await test('2. GET ADM nunca prioriza RAM desatualizada sobre app_state/routines no Firestore', async () => {
      seedUsers(mockFs);

      // Case 2a: Firestore has canonical persisted data, RAM has stale data
      mockFs._setDoc('app_state', 'routines', {
        routinesByDay: {
          monday: [{ id: 'canonical-fs-mon', time: '06:00', activityName: 'Canonical Firestore' }],
        },
      });
      readDb().routinesByDay = {
        monday: [{ id: 'stale-ram-mon', time: '23:59', activityName: 'Stale RAM' }],
      };

      const getRes = await makeRequest(server, 'GET', '/api/routines', undefined, {
        Authorization: 'Bearer tok-admin',
      });
      assert.strictEqual(getRes.status, 200);
      assert.strictEqual(getRes.data?.monday?.[0]?.id, 'canonical-fs-mon');
      assert.strictEqual(readDb().routinesByDay?.monday?.[0]?.id, 'canonical-fs-mon');

      // Case 2b: Firestore app_state/routines absent, RAM polluted -> never returns stale RAM
      mockFs._clearAll();
      seedUsers(mockFs);
      readDb().routinesByDay = {
        monday: [{ id: 'stale-unpersisted-ram', time: '23:59', activityName: 'Stale Unpersisted' }],
      };
      const getCleanFallback = await makeRequest(server, 'GET', '/api/routines', undefined, {
        Authorization: 'Bearer tok-admin',
      });
      assert.strictEqual(getCleanFallback.status, 200);
      assert.notStrictEqual(getCleanFallback.data?.monday?.[0]?.id, 'stale-unpersisted-ram');
      assert.strictEqual(getCleanFallback.data?.monday?.[0]?.id, 'm1');
      assert.ok(Array.isArray(getCleanFallback.data?.sunday), 'Preserva formato Record<DayOfWeek, RoutineItem[]>');
    });

    await test('3. Falhas e indisponibilidade do Firestore retornam erro sem sucesso aparente e sem mutar RAM', async () => {
      seedUsers(mockFs);
      const baselineTemplate = {
        monday: [{ id: 'persisted-baseline', time: '09:00', activityName: 'Baseline' }],
      };
      const initPost = await makeRequest(server, 'POST', '/api/routines', baselineTemplate, {
        Authorization: 'Bearer tok-admin',
      });
      assert.strictEqual(initPost.status, 200);

      // 3a. Write error on POST -> 500, RAM and Firestore untouched
      mockFs._setFailOnWrite('app_state');
      try {
        const failPost = await makeRequest(
          server,
          'POST',
          '/api/routines',
          { monday: [{ id: 'corrupted-post', time: '11:00', activityName: 'Should Fail' }] },
          { Authorization: 'Bearer tok-admin' }
        );
        assert.strictEqual(failPost.status, 500);
        assert.notStrictEqual(failPost.data?.success, true);
        assert.strictEqual(failPost.data?.monday, undefined);
        assert.strictEqual(readDb().routinesByDay?.monday?.[0]?.id, 'persisted-baseline', 'RAM intacta após falha de POST');
        assert.strictEqual(
          mockFs._getDoc('app_state', 'routines')?.routinesByDay?.monday?.[0]?.id,
          'persisted-baseline',
          'Firestore intacto após falha de POST'
        );
      } finally {
        mockFs._setFailOnWrite(null);
      }

      // 3b. Read error on GET -> 500/503, never returns stale RAM with 200
      mockFs._setFailOnRead('app_state');
      try {
        const failGet = await makeRequest(server, 'GET', '/api/routines', undefined, {
          Authorization: 'Bearer tok-admin',
        });
        assert.strictEqual(failGet.status, 500);
        assert.strictEqual(failGet.data?.monday, undefined);
      } finally {
        mockFs._setFailOnRead(null);
      }

      // 3c. Cloud writes disabled -> 503 on POST without mutating RAM
      setIsCloudWriteDisabled(true);
      try {
        const disabledPost = await makeRequest(
          server,
          'POST',
          '/api/routines',
          { monday: [{ id: 'disabled-post', time: '12:00', activityName: 'Disabled' }] },
          { Authorization: 'Bearer tok-admin' }
        );
        assert.strictEqual(disabledPost.status, 503);
        assert.strictEqual(disabledPost.data?.error, 'FIRESTORE_UNAVAILABLE');
        assert.strictEqual(readDb().routinesByDay?.monday?.[0]?.id, 'persisted-baseline');
      } finally {
        setIsCloudWriteDisabled(false);
      }

      // 3d. Firestore unavailable (null) -> 503 on both GET and POST
      setFirebaseAdminFirestoreForTesting(null);
      try {
        const nullGet = await makeRequest(server, 'GET', '/api/routines', undefined, {
          Authorization: 'Bearer tok-admin',
        });
        assert.strictEqual(nullGet.status, 503);
        assert.strictEqual(nullGet.data?.error, 'FIRESTORE_UNAVAILABLE');

        const nullPost = await makeRequest(
          server,
          'POST',
          '/api/routines',
          { monday: [{ id: 'null-post', time: '12:00', activityName: 'Null FS' }] },
          { Authorization: 'Bearer tok-admin' }
        );
        assert.strictEqual(nullPost.status, 503);
        assert.strictEqual(nullPost.data?.error, 'FIRESTORE_UNAVAILABLE');
        assert.strictEqual(readDb().routinesByDay?.monday?.[0]?.id, 'persisted-baseline');
      } finally {
        setFirebaseAdminFirestoreForTesting(mockFs as unknown as Firestore);
      }
    });

    await test('4. Isolamento ADM/aluno/professor preservado sem contaminação do template global', async () => {
      seedUsers(mockFs);

      // Admin saves custom global template
      const admGlobal = await makeRequest(
        server,
        'POST',
        '/api/routines',
        { monday: [{ id: 'adm-global-isolated', time: '07:00', activityName: 'ADM Global' }] },
        { Authorization: 'Bearer tok-admin' }
      );
      assert.strictEqual(admGlobal.status, 200);

      // Admin targeted POST returns HTTP 410 Gone and does NOT overwrite app_state/routines.routinesByDay or RAM
      const admTargetPost = await makeRequest(
        server,
        'POST',
        '/api/routines',
        {
          studentUid: STUDENT_UID,
          routinesByDay: { monday: [{ id: 'adm-student-only', time: '10:00', activityName: 'For Student Only' }] },
        },
        { Authorization: 'Bearer tok-admin' }
      );
      assert.strictEqual(admTargetPost.status, 410);
      assert.strictEqual(admTargetPost.data?.code, 'LEGACY_TARGETED_ROUTINES_POST_DISABLED');
      assert.strictEqual(
        mockFs._getDoc('app_state', 'routines')?.routinesByDay?.monday?.[0]?.id,
        'adm-global-isolated'
      );
      assert.strictEqual(Object.keys(readDb().studentRoutinesMap || {}).length, 0);

      // Student POST returns HTTP 410 Gone without mutating global template or RAM
      const stuPost = await makeRequest(
        server,
        'POST',
        '/api/routines',
        { monday: [{ id: 'stu-custom-isolated', time: '14:00', activityName: 'Student Custom' }] },
        { Authorization: 'Bearer tok-student' }
      );
      assert.strictEqual(stuPost.status, 410);
      assert.strictEqual(stuPost.data?.code, 'LEGACY_TARGETED_ROUTINES_POST_DISABLED');
      assert.strictEqual(
        mockFs._getDoc('app_state', 'routines')?.routinesByDay?.monday?.[0]?.id,
        'adm-global-isolated'
      );
      assert.strictEqual(Object.keys(readDb().studentRoutinesMap || {}).length, 0);

      // Teacher bare GET returns clean defaultRoutinesByDay (never admin custom template or student routine)
      const teacherBareGet = await makeRequest(server, 'GET', '/api/routines', undefined, {
        Authorization: 'Bearer tok-teacher',
      });
      assert.strictEqual(teacherBareGet.status, 200);
      assert.strictEqual(teacherBareGet.data?.monday?.[0]?.id, 'm1');
      assert.strictEqual(JSON.stringify(teacherBareGet.data).includes('adm-global-isolated'), false);
      assert.strictEqual(JSON.stringify(teacherBareGet.data).includes('stu-custom-isolated'), false);

      // Teacher bare POST blocked with 403
      const teacherBarePost = await makeRequest(
        server,
        'POST',
        '/api/routines',
        { monday: [{ id: 'teacher-global-attempt', time: '09:00', activityName: 'Blocked' }] },
        { Authorization: 'Bearer tok-teacher' }
      );
      assert.strictEqual(teacherBarePost.status, 403);
      assert.strictEqual(
        mockFs._getDoc('app_state', 'routines')?.routinesByDay?.monday?.[0]?.id,
        'adm-global-isolated'
      );

      // Admin GET still returns persisted global template
      const admGetCheck = await makeRequest(server, 'GET', '/api/routines', undefined, {
        Authorization: 'Bearer tok-admin',
      });
      assert.strictEqual(admGetCheck.status, 200);
      assert.strictEqual(admGetCheck.data?.monday?.[0]?.id, 'adm-global-isolated');
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    resetFirebaseAdminForTesting();
    resetFirebaseAdminFirestoreForTesting();
    resetInMemoryDbForTesting();
    resetResidualCachesForTesting();
  }

  console.log(`\nResumo SEC.FIX.6A.1: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('Fatal error in validate-sec-fix-6a-1:', err);
  process.exit(1);
});
