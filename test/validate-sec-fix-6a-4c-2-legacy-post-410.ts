/**
 * SEC.FIX.6A.4C.2 — Desativação Segura do POST Legado de Rotinas (Opção B)
 *
 * Valida:
 * 1. Os três ramos direcionados de POST /api/routines retornam HTTP 410 Gone
 *    com orientação explícita aos endpoints granulares canônicos:
 *    - ADM com aluno-alvo (studentUid / studentEmail em body ou query)
 *    - Professor aprovado com aluno vinculado
 *    - Aluno (com ou sem target próprio explícito)
 * 2. Nenhuma gravação em RAM (db.studentRoutinesMap, db.routinesByDay) ou Firestore após HTTP 410.
 * 3. Autorização e segurança integralmente preservadas:
 *    - 401 para anônimo, token inválido/expirado/revogado e UID não canônico
 *    - 403 para contas bloqueadas (conflict, pending_teacher, rejected, unregistered, deleted)
 *    - 403 para professor sem alvo, auto-alvo, não vinculado ou pós-troca de Native Friend
 *    - 403 para aluno tentando alvo de terceiro (studentUid / studentEmail)
 *    - 403/422 para ADM tentando alvo não-aluno ou UID não canônico
 * 4. Preservação integral de POST /api/routines global do ADM, GET /api/routines e fluxos granulares canônicos.
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

function createMockFirestore() {
  const store = new Map<string, Record<string, any>>();
  const writeLog: Array<{ op: 'set' | 'update' | 'delete'; path: string }> = [];

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
        const val = store.get(key);
        return {
          id,
          exists: Boolean(val),
          ref: makeDocRef(colPath, id),
          data: () => (val ? deepClone(val) : undefined),
        };
      },
      set: async (data: Record<string, any>, opts?: { merge?: boolean }) => {
        writeLog.push({ op: 'set', path: docPath });
        const prev = opts?.merge ? store.get(key) || {} : {};
        store.set(key, deepClone({ ...prev, ...data }));
        return { writeTime: new Date() };
      },
      update: async (data: Record<string, any>) => {
        writeLog.push({ op: 'update', path: docPath });
        const prev = store.get(key);
        if (!prev) throw new Error(`NOT_FOUND: ${docPath}`);
        store.set(key, deepClone({ ...prev, ...data }));
        return { writeTime: new Date() };
      },
      delete: async () => {
        writeLog.push({ op: 'delete', path: docPath });
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
    runTransaction: async (fn: (tx: any) => Promise<any>) => {
      const tx = {
        get: async (ref: any) => ref.get(),
        set: (ref: any, data: Record<string, any>, opts?: { merge?: boolean }) => ref.set(data, opts),
        update: (ref: any, data: Record<string, any>) => ref.update(data),
        delete: (ref: any) => ref.delete(),
      };
      return fn(tx);
    },
    _setDoc: (colPath: string, id: string, data: Record<string, any>) => {
      store.set(`${colPath}::${id}`, deepClone(data));
    },
    _getDoc: (colPath: string, id: string) => deepClone(store.get(`${colPath}::${id}`)),
    _clearAll: () => {
      store.clear();
      writeLog.length = 0;
    },
    _writeLog: writeLog,
    _clearWriteLog: () => {
      writeLog.length = 0;
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

const ADMIN_UID = 'adminUidSecFix6a4c200000001';
const ADMIN_EMAIL = 'admin.6a4c2@itissimple.com';
const TEACHER_A_UID = 'teacherAUidSecFix6a4c2000001';
const TEACHER_A_EMAIL = 'teacher.a.6a4c2@itissimple.com';
const TEACHER_B_UID = 'teacherBUidSecFix6a4c2000001';
const TEACHER_B_EMAIL = 'teacher.b.6a4c2@itissimple.com';
const STUDENT_1_UID = 'student1UidSecFix6a4c2000001';
const STUDENT_1_EMAIL = 'student1.6a4c2@itissimple.com';
const STUDENT_2_UID = 'student2UidSecFix6a4c2000001';
const STUDENT_2_EMAIL = 'student2.6a4c2@itissimple.com';

function seedBaseline(mockFs: ReturnType<typeof createMockFirestore>) {
  resetInMemoryDbForTesting();
  resetResidualCachesForTesting();
  mockFs._clearAll();

  mockFs._setDoc('tutors', TEACHER_A_UID, {
    id: TEACHER_A_UID,
    uid: TEACHER_A_UID,
    authUid: TEACHER_A_UID,
    email: TEACHER_A_EMAIL,
    name: 'Teacher A',
    role: 'teacher',
    approvalStatus: 'approved',
    isApproved: true,
  });

  mockFs._setDoc('tutors', TEACHER_B_UID, {
    id: TEACHER_B_UID,
    uid: TEACHER_B_UID,
    authUid: TEACHER_B_UID,
    email: TEACHER_B_EMAIL,
    name: 'Teacher B',
    role: 'teacher',
    approvalStatus: 'approved',
    isApproved: true,
  });

  mockFs._setDoc('users', STUDENT_1_UID, {
    id: STUDENT_1_UID,
    uid: STUDENT_1_UID,
    email: STUDENT_1_EMAIL,
    name: 'Student One',
    role: 'student',
    teacherUid: TEACHER_A_UID,
    assignedNativeFriendUID: TEACHER_A_UID,
    teacherEmail: TEACHER_A_EMAIL,
    enrollmentStatus: 'active',
    weeklyCycle: 1,
  });
  mockFs._setDoc(`users/${STUDENT_1_UID}/routines`, 'monday', {
    dayOfWeek: 'monday',
    weeklyCycle: 1,
    videoId: 'dQw4w9WgXcQ',
    title: 'Initial Student 1 Video',
    learnedWords: ['baseline-word'],
  });

  mockFs._setDoc('users', STUDENT_2_UID, {
    id: STUDENT_2_UID,
    uid: STUDENT_2_UID,
    email: STUDENT_2_EMAIL,
    name: 'Student Two',
    role: 'student',
    teacherUid: TEACHER_B_UID,
    assignedNativeFriendUID: TEACHER_B_UID,
    teacherEmail: TEACHER_B_EMAIL,
    enrollmentStatus: 'active',
    weeklyCycle: 1,
  });

  const db = readDb();
  db.tutorsList = [
    { id: TEACHER_A_UID, uid: TEACHER_A_UID, authUid: TEACHER_A_UID, email: TEACHER_A_EMAIL, name: 'Teacher A', role: 'teacher', approvalStatus: 'approved', isApproved: true },
    { id: TEACHER_B_UID, uid: TEACHER_B_UID, authUid: TEACHER_B_UID, email: TEACHER_B_EMAIL, name: 'Teacher B', role: 'teacher', approvalStatus: 'approved', isApproved: true },
  ];
  db.teachers = [
    { id: ADMIN_UID, uid: ADMIN_UID, email: ADMIN_EMAIL, role: 'admin', name: 'Admin' },
    ...db.tutorsList,
  ];
  mockFs._clearWriteLog();
}

function assertGoneResponse(res: { status: number; data: any }, context: string) {
  assert.strictEqual(res.status, 410, `${context}: deve retornar HTTP 410`);
  assert.strictEqual(res.data?.error, 'Gone', `${context}: error deve ser Gone`);
  assert.strictEqual(res.data?.code, 'LEGACY_TARGETED_ROUTINES_POST_DISABLED', `${context}: code canônico`);
  assert.ok(
    typeof res.data?.message === 'string' && res.data.message.includes('/api/routines/daily-video'),
    `${context}: mensagem deve orientar uso dos endpoints granulares canônicos`
  );
  assert.ok(Array.isArray(res.data?.canonicalEndpoints) && res.data.canonicalEndpoints.length >= 5);
}

async function run() {
  console.log('\n=== SEC.FIX.6A.4C.2: Desativação Segura do POST Legado de Rotinas (Opção B) ===\n');

  const mockFs = createMockFirestore();
  setFirebaseAdminFirestoreForTesting(mockFs as unknown as Firestore);
  setFirebaseAdminAuthForTesting({
    verifyIdToken: async (token: string) => {
      switch (token) {
        case 'tok-admin':
          return { uid: ADMIN_UID, email: ADMIN_EMAIL, email_verified: true, role: 'admin', admin: true };
        case 'tok-teacher-a':
          return { uid: TEACHER_A_UID, email: TEACHER_A_EMAIL, email_verified: true, role: 'teacher' };
        case 'tok-student-1':
          return { uid: STUDENT_1_UID, email: STUDENT_1_EMAIL, email_verified: true, role: 'student' };
        default:
          throw new Error('Invalid token');
      }
    },
  } as any);

  const server = http.createServer(serverApp);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));

  try {
    await test('1. Os 3 ramos direcionados retornam HTTP 410 sem mutar RAM ou Firestore', async () => {
      seedBaseline(mockFs);
      const initialGlobal = JSON.stringify(readDb().routinesByDay);
      const payload = { monday: [{ id: 'legacy-mon', time: '08:00', activityName: 'Legacy Overwrite' }] };

      // 1a. ADM com aluno-alvo (body studentUid, query uid, body studentEmail)
      const admByUid = await makeRequest(
        server,
        'POST',
        '/api/routines',
        { studentUid: STUDENT_1_UID, routinesByDay: payload },
        { Authorization: 'Bearer tok-admin' }
      );
      assertGoneResponse(admByUid, 'ADM com studentUid');

      const admByQuery = await makeRequest(
        server,
        'POST',
        `/api/routines?studentUid=${STUDENT_1_UID}`,
        payload,
        { Authorization: 'Bearer tok-admin' }
      );
      assertGoneResponse(admByQuery, 'ADM com query studentUid');

      const admByEmail = await makeRequest(
        server,
        'POST',
        '/api/routines',
        { studentEmail: STUDENT_1_EMAIL, routinesByDay: payload },
        { Authorization: 'Bearer tok-admin' }
      );
      assertGoneResponse(admByEmail, 'ADM com studentEmail');

      // 1b. Professor aprovado com aluno vinculado
      const teacherTargetUid = await makeRequest(
        server,
        'POST',
        '/api/routines',
        { studentUid: STUDENT_1_UID, routinesByDay: payload },
        { Authorization: 'Bearer tok-teacher-a' }
      );
      assertGoneResponse(teacherTargetUid, 'Professor com aluno vinculado');

      // 1c. Aluno (sem target e com auto-target explícito)
      const stuBare = await makeRequest(server, 'POST', '/api/routines', payload, {
        Authorization: 'Bearer tok-student-1',
      });
      assertGoneResponse(stuBare, 'Aluno sem target explícito');

      const stuSelfTarget = await makeRequest(
        server,
        'POST',
        '/api/routines',
        { studentUid: STUDENT_1_UID, studentEmail: STUDENT_1_EMAIL, routinesByDay: payload },
        { Authorization: 'Bearer tok-student-1' }
      );
      assertGoneResponse(stuSelfTarget, 'Aluno com auto-target explícito');

      // Assert ZERO Firestore writes and ZERO RAM mutations
      assert.strictEqual(mockFs._writeLog.length, 0, 'Nenhuma escrita no Firestore após HTTP 410');
      assert.strictEqual(Object.keys(readDb().studentRoutinesMap || {}).length, 0, 'studentRoutinesMap intacto');
      assert.strictEqual(JSON.stringify(readDb().routinesByDay), initialGlobal, 'routinesByDay global intacto');
    });

    await test('2. Autorização preservada: 401/403/422 precedem 410 para acessos indevidos', async () => {
      seedBaseline(mockFs);
      const payload = { monday: [{ id: 'unauth', time: '09:00', activityName: 'Denied' }] };

      const anon = await makeRequest(server, 'POST', '/api/routines', payload);
      assert.strictEqual(anon.status, 401);

      const teacherBare = await makeRequest(server, 'POST', '/api/routines', payload, {
        Authorization: 'Bearer tok-teacher-a',
      });
      assert.strictEqual(teacherBare.status, 403);

      const teacherSelf = await makeRequest(
        server,
        'POST',
        '/api/routines',
        { studentUid: TEACHER_A_UID, routinesByDay: payload },
        { Authorization: 'Bearer tok-teacher-a' }
      );
      assert.strictEqual(teacherSelf.status, 403);

      const teacherUnlinked = await makeRequest(
        server,
        'POST',
        '/api/routines',
        { studentUid: STUDENT_2_UID, routinesByDay: payload },
        { Authorization: 'Bearer tok-teacher-a' }
      );
      assert.strictEqual(teacherUnlinked.status, 403);

      const studentCross = await makeRequest(
        server,
        'POST',
        '/api/routines',
        { studentUid: STUDENT_2_UID, routinesByDay: payload },
        { Authorization: 'Bearer tok-student-1' }
      );
      assert.strictEqual(studentCross.status, 403);

      const admNonStudent = await makeRequest(
        server,
        'POST',
        '/api/routines',
        { studentUid: TEACHER_A_UID, routinesByDay: payload },
        { Authorization: 'Bearer tok-admin' }
      );
      assert.strictEqual(admNonStudent.status, 403);

      const admSynthetic = await makeRequest(
        server,
        'POST',
        '/api/routines',
        { studentUid: 'usr-synthetic-123', routinesByDay: payload },
        { Authorization: 'Bearer tok-admin' }
      );
      assert.strictEqual(admSynthetic.status, 422);

      assert.strictEqual(mockFs._writeLog.length, 0);
    });

    await test('3. Preservação integral: POST global ADM, GET /api/routines e endpoints granulares canônicos', async () => {
      seedBaseline(mockFs);

      // ADM global POST /api/routines still works (200) and persists to app_state/routines
      const admGlobalPost = await makeRequest(
        server,
        'POST',
        '/api/routines',
        { monday: [{ id: 'adm-global-v1', time: '07:00', activityName: 'Global ADM Template' }] },
        { Authorization: 'Bearer tok-admin' }
      );
      assert.strictEqual(admGlobalPost.status, 200);
      assert.strictEqual(mockFs._getDoc('app_state', 'routines')?.routinesByDay?.monday?.[0]?.id, 'adm-global-v1');

      // GET /api/routines still works for ADM, Teacher, Student
      const admGet = await makeRequest(server, 'GET', '/api/routines', undefined, { Authorization: 'Bearer tok-admin' });
      assert.strictEqual(admGet.status, 200);
      assert.strictEqual(admGet.data?.monday?.[0]?.id, 'adm-global-v1');

      const stuGet = await makeRequest(server, 'GET', '/api/routines', undefined, { Authorization: 'Bearer tok-student-1' });
      assert.strictEqual(stuGet.status, 200);
      assert.strictEqual(stuGet.data?.monday?.[0]?.learnedWords?.[0], 'baseline-word');

      // Granular canonical endpoints still work and persist to Firestore
      const granularVideo = await makeRequest(
        server,
        'POST',
        '/api/routines/daily-video',
        {
          studentUid: STUDENT_1_UID,
          day: 'tuesday',
          videoId: 'M7lc1UVf-VE',
          videoTitle: 'Canonical Granular Video',
          weeklyCycle: 1,
        },
        { Authorization: 'Bearer tok-student-1' }
      );
      assert.strictEqual(granularVideo.status, 200);

      const granularWords = await makeRequest(
        server,
        'POST',
        '/api/routines/words',
        { studentUid: STUDENT_1_UID, day: 'tuesday', words: ['resilient', 'fluent'], weeklyCycle: 1 },
        { Authorization: 'Bearer tok-student-1' }
      );
      assert.strictEqual(granularWords.status, 200);

      const granularToggle = await makeRequest(
        server,
        'POST',
        '/api/routines/toggle',
        { studentUid: STUDENT_1_UID, day: 'tuesday', activityId: 'tue1', completedToday: true, weeklyCycle: 1 },
        { Authorization: 'Bearer tok-student-1' }
      );
      assert.strictEqual(granularToggle.status, 200);

      const stuGetAfter = await makeRequest(server, 'GET', '/api/routines', undefined, { Authorization: 'Bearer tok-student-1' });
      assert.strictEqual(stuGetAfter.status, 200);
      assert.strictEqual(stuGetAfter.data?.tuesday?.[0]?.teacherVideos?.[0]?.videoId, 'M7lc1UVf-VE');
      assert.deepStrictEqual(stuGetAfter.data?.tuesday?.[0]?.learnedWords, ['resilient', 'fluent']);
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    resetFirebaseAdminForTesting();
    resetFirebaseAdminFirestoreForTesting();
    resetInMemoryDbForTesting();
    resetResidualCachesForTesting();
  }

  console.log(`\nResumo SEC.FIX.6A.4C.2: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('Fatal error in validate-sec-fix-6a-4c-2:', err);
  process.exit(1);
});
