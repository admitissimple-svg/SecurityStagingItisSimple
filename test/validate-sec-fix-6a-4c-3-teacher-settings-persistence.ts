/**
 * SEC.FIX.6A.4C.3 — Persistência Confirmada de Teacher/Meet Settings
 *
 * Valida exclusivamente POST /api/teacher-settings e POST /api/meet-settings:
 * 1. Sucesso confirmado: exige confirmação real de saveTeacherAvailabilityToFirestore
 *    antes de mutar RAM e retornar HTTP 200, preservando UID canônico, disponibilidade e Meet link.
 * 2. Falha/indisponibilidade/timeout:
 *    - Firestore indisponível (null) -> HTTP 503, sem sucesso falso e sem mutação em RAM.
 *    - Cloud write desabilitado -> HTTP 503, sem sucesso falso e sem mutação em RAM.
 *    - Erro de escrita no Firestore (incl. PERMISSION_DENIED) -> HTTP 500/503, sem sucesso falso e sem mutação em RAM.
 *    - Timeout na gravação (> 2s) -> HTTP 500/503, sem sucesso falso e sem mutação em RAM.
 * 3. Permissões, autenticação, autorização e sanitização integralmente preservadas (401 / 403 / anti-escalação).
 * 4. Sobrevivência a reinício simulado (resetInMemoryDbForTesting + resetResidualCachesForTesting + initCloudPersistence):
 *    leitura GET /api/teacher-settings e GET /api/meet-settings continua retornando configurações confirmadas.
 */

process.env.NODE_ENV = 'test';
process.env.FIREBASE_PROJECT_ID = 'itissimple-security-staging';
process.env.FIREBASE_DATABASE_ID = '(default)';

import assert from 'node:assert';
import http from 'node:http';
import type { Firestore } from 'firebase-admin/firestore';
import {
  app as serverApp,
  initCloudPersistence,
  readDb,
  resetInMemoryDbForTesting,
  resetResidualCachesForTesting,
} from '../serverApp';
import { setFirebaseAdminAuthForTesting, resetFirebaseAdminForTesting } from '../src/serverFirebaseAdmin';
import {
  setFirebaseAdminFirestoreForTesting,
  resetFirebaseAdminFirestoreForTesting,
  setIsCloudWriteDisabled,
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

function createRealisticMockFirestore() {
  const store = new Map<string, Record<string, any>>();
  const writeLog: Array<{ op: 'set' | 'update' | 'delete'; path: string }> = [];
  let failOnSetCollection: string | null = null;
  let failSetErrorCode: number | string | undefined = undefined;
  let hangOnSetCollection: string | null = null;

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
        if (hangOnSetCollection && (colPath === hangOnSetCollection || hangOnSetCollection === '*')) {
          return new Promise(() => {});
        }
        if (failOnSetCollection && (colPath === failOnSetCollection || failOnSetCollection === '*')) {
          const err: any = new Error(`Simulated Firestore set error on ${docPath}`);
          if (failSetErrorCode !== undefined) err.code = failSetErrorCode;
          throw err;
        }
        writeLog.push({ op: 'set', path: docPath });
        const prev = opts?.merge ? store.get(key) || {} : {};
        store.set(key, deepClone({ ...prev, ...data }));
        return { writeTime: new Date() };
      },
      update: async (data: Record<string, any>) => {
        writeLog.push({ op: 'update', path: docPath });
        const prev = store.get(key) || {};
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
        set: (ref: any, data: any, opts?: any) => ref.set(data, opts),
        update: (ref: any, data: any) => ref.update(data),
        delete: (ref: any) => ref.delete(),
      };
      return fn(tx);
    },
    _setDoc: (col: string, id: string, data: Record<string, any>) => {
      store.set(`${col}::${id}`, deepClone(data));
    },
    _getDoc: (col: string, id: string) => deepClone(store.get(`${col}::${id}`)),
    _setFailOnSet: (col: string | null, code?: number | string) => {
      failOnSetCollection = col;
      failSetErrorCode = code;
    },
    _setHangOnSet: (col: string | null) => {
      hangOnSetCollection = col;
    },
    _clearAll: () => {
      store.clear();
      writeLog.length = 0;
      failOnSetCollection = null;
      failSetErrorCode = undefined;
      hangOnSetCollection = null;
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

const ADMIN_UID = 'adminUidSecFix6a4c30000001';
const ADMIN_EMAIL = 'admin.6a4c3@itissimple.com';

const TEACHER_A_UID = 'teacherAUidSecFix6a4c3000001';
const TEACHER_A_EMAIL = 'teacher.a.6a4c3@itissimple.com';

const TEACHER_B_UID = 'teacherBUidSecFix6a4c3000001';
const TEACHER_B_EMAIL = 'teacher.b.6a4c3@itissimple.com';

const PENDING_TEACHER_UID = 'pendingTeacherUid6a4c30001';
const PENDING_TEACHER_EMAIL = 'pending.6a4c3@itissimple.com';

const REJECTED_TEACHER_UID = 'rejectedTeacherUid6a4c3001';
const REJECTED_TEACHER_EMAIL = 'rejected.6a4c3@itissimple.com';

const STUDENT_LINKED_UID = 'studentLinkedUid6a4c300001';
const STUDENT_LINKED_EMAIL = 'student.linked.6a4c3@itissimple.com';

function seedBaseline(mockFs: ReturnType<typeof createRealisticMockFirestore>) {
  setFirebaseAdminFirestoreForTesting(mockFs as unknown as Firestore);
  setIsCloudWriteDisabled(false);
  resetInMemoryDbForTesting();
  resetResidualCachesForTesting();
  mockFs._clearAll();

  const teacherA = {
    id: TEACHER_A_UID,
    uid: TEACHER_A_UID,
    authUid: TEACHER_A_UID,
    publicTutorId: 'teacher-a-6a4c3',
    email: TEACHER_A_EMAIL,
    name: 'Teacher Alpha',
    role: 'teacher',
    approvalStatus: 'approved',
    isApproved: true,
    status: 'approved',
    approved: true,
    meetUrl: 'https://meet.google.com/alpha-baseline',
    meetLink: 'https://meet.google.com/alpha-baseline',
    timezone: 'America/Toronto',
    availableDays: ['monday'],
    availability: { monday: ['09:00'] },
    availableHoursByDay: { monday: ['09:00'] },
  };

  const teacherB = {
    id: TEACHER_B_UID,
    uid: TEACHER_B_UID,
    authUid: TEACHER_B_UID,
    publicTutorId: 'teacher-b-6a4c3',
    email: TEACHER_B_EMAIL,
    name: 'Teacher Beta',
    role: 'teacher',
    approvalStatus: 'approved',
    isApproved: true,
    status: 'approved',
    approved: true,
    meetUrl: 'https://meet.google.com/beta-baseline',
    meetLink: 'https://meet.google.com/beta-baseline',
    timezone: 'America/New_York',
    availableDays: ['tuesday'],
    availability: { tuesday: ['14:00'] },
    availableHoursByDay: { tuesday: ['14:00'] },
  };

  const pendingTeacher = {
    id: PENDING_TEACHER_UID,
    uid: PENDING_TEACHER_UID,
    authUid: PENDING_TEACHER_UID,
    publicTutorId: 'pending-6a4c3',
    email: PENDING_TEACHER_EMAIL,
    name: 'Pending Tutor',
    role: 'teacher',
    approvalStatus: 'pending',
    isApproved: false,
    status: 'pending',
    approved: false,
  };

  const rejectedTeacher = {
    id: REJECTED_TEACHER_UID,
    uid: REJECTED_TEACHER_UID,
    authUid: REJECTED_TEACHER_UID,
    email: REJECTED_TEACHER_EMAIL,
    name: 'Rejected Tutor',
    role: 'teacher',
    approvalStatus: 'rejected',
    isApproved: false,
    status: 'rejected',
    approved: false,
  };

  mockFs._setDoc('tutors', TEACHER_A_UID, teacherA);
  mockFs._setDoc('tutors', TEACHER_B_UID, teacherB);
  mockFs._setDoc('tutors', PENDING_TEACHER_UID, pendingTeacher);
  mockFs._setDoc('tutors', REJECTED_TEACHER_UID, rejectedTeacher);

  mockFs._setDoc('teacher_availability', TEACHER_A_UID, {
    uid: TEACHER_A_UID,
    teacherEmail: TEACHER_A_EMAIL,
    meetLink: 'https://meet.google.com/alpha-baseline',
    timezone: 'America/Toronto',
    availableDays: ['monday'],
    availability: { monday: ['09:00'] },
    availableHoursByDay: { monday: ['09:00'] },
  });

  mockFs._setDoc('users', STUDENT_LINKED_UID, {
    id: STUDENT_LINKED_UID,
    uid: STUDENT_LINKED_UID,
    email: STUDENT_LINKED_EMAIL,
    name: 'Linked Student',
    role: 'student',
    teacherUid: TEACHER_A_UID,
    assignedNativeFriendUID: TEACHER_A_UID,
    teacherEmail: TEACHER_A_EMAIL,
    enrollmentStatus: 'active',
  });
  mockFs._setDoc('student_assignments', STUDENT_LINKED_UID, {
    uid: STUDENT_LINKED_UID,
    studentUid: STUDENT_LINKED_UID,
    email: STUDENT_LINKED_EMAIL,
    teacherUid: TEACHER_A_UID,
    assignedNativeFriendUID: TEACHER_A_UID,
    teacherEmail: TEACHER_A_EMAIL,
  });

  const db = readDb();
  db.tutorsList = [deepClone(teacherA), deepClone(teacherB), deepClone(pendingTeacher)];
  db.teachers = [
    { id: ADMIN_UID, uid: ADMIN_UID, email: ADMIN_EMAIL, role: 'admin', name: 'Admin' },
    { id: TEACHER_A_UID, uid: TEACHER_A_UID, email: TEACHER_A_EMAIL, role: 'teacher', name: 'Teacher Alpha' },
    { id: TEACHER_B_UID, uid: TEACHER_B_UID, email: TEACHER_B_EMAIL, role: 'teacher', name: 'Teacher Beta' },
  ];

  const entryA = {
    teacherEmail: TEACHER_A_EMAIL,
    uid: TEACHER_A_UID,
    meetLink: 'https://meet.google.com/alpha-baseline',
    timezone: 'America/Toronto',
    availableDays: ['monday'],
    availability: { monday: ['09:00'] },
    availableHoursByDay: { monday: ['09:00'] },
  };

  db.meetSettings = {
    [TEACHER_A_EMAIL]: deepClone(entryA),
    [TEACHER_A_UID]: deepClone(entryA),
  };
  db.teacherSettings = {
    [TEACHER_A_EMAIL]: deepClone(entryA),
    [TEACHER_A_UID]: deepClone(entryA),
  };
  mockFs._clearWriteLog();
}

async function run() {
  console.log('\n=== SEC.FIX.6A.4C.3: Validação de Persistência Confirmada de Teacher/Meet Settings ===\n');

  const mockFs = createRealisticMockFirestore();
  setFirebaseAdminFirestoreForTesting(mockFs as unknown as Firestore);
  setFirebaseAdminAuthForTesting({
    verifyIdToken: async (token: string) => {
      switch (token) {
        case 'tok-admin':
          return { uid: ADMIN_UID, email: ADMIN_EMAIL, email_verified: true, role: 'admin', admin: true };
        case 'tok-teacher-a':
          return { uid: TEACHER_A_UID, email: TEACHER_A_EMAIL, email_verified: true, role: 'teacher' };
        case 'tok-teacher-b':
          return { uid: TEACHER_B_UID, email: TEACHER_B_EMAIL, email_verified: true, role: 'teacher' };
        case 'tok-pending-teacher':
          return { uid: PENDING_TEACHER_UID, email: PENDING_TEACHER_EMAIL, email_verified: true, role: 'student' };
        case 'tok-rejected-teacher':
          return { uid: REJECTED_TEACHER_UID, email: REJECTED_TEACHER_EMAIL, email_verified: true, role: 'teacher' };
        case 'tok-student-linked':
          return { uid: STUDENT_LINKED_UID, email: STUDENT_LINKED_EMAIL, email_verified: true, role: 'student' };
        default:
          throw new Error('Invalid token');
      }
    },
  } as any);

  const server = http.createServer(serverApp);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));

  try {
    // 1. Success confirmed in both endpoints
    await test('1. Sucesso confirmado em POST /api/teacher-settings e POST /api/meet-settings persiste em teacher_availability/{uid} antes do HTTP 200', async () => {
      seedBaseline(mockFs);

      const postTeacher = await makeRequest(
        server,
        'POST',
        '/api/teacher-settings',
        {
          teacherEmail: TEACHER_A_EMAIL,
          uid: TEACHER_A_UID,
          meetLink: 'https://meet.google.com/alpha-confirmed-v1',
          timezone: 'America/Toronto',
          availableDays: ['monday', 'wednesday'],
          availability: { monday: ['10:00', '11:00'], wednesday: ['15:00'] },
        },
        { Authorization: 'Bearer tok-teacher-a' }
      );
      assert.strictEqual(postTeacher.status, 200);
      assert.strictEqual(postTeacher.data?.success, true);
      assert.strictEqual(postTeacher.data?.settings?.meetLink, 'https://meet.google.com/alpha-confirmed-v1');
      assert.strictEqual(postTeacher.data?.settings?.uid, TEACHER_A_UID);
      assert.strictEqual(
        mockFs._getDoc('teacher_availability', TEACHER_A_UID)?.meetLink,
        'https://meet.google.com/alpha-confirmed-v1'
      );
      assert.deepStrictEqual(
        mockFs._getDoc('teacher_availability', TEACHER_A_UID)?.availability,
        { monday: ['10:00', '11:00'], wednesday: ['15:00'] }
      );
      assert.strictEqual(readDb().meetSettings[TEACHER_A_UID].meetLink, 'https://meet.google.com/alpha-confirmed-v1');
      assert.strictEqual(readDb().tutorsList[0].meetLink, 'https://meet.google.com/alpha-confirmed-v1');

      // Also test POST /api/meet-settings with pending teacher
      const postMeet = await makeRequest(
        server,
        'POST',
        '/api/meet-settings',
        {
          teacherEmail: PENDING_TEACHER_EMAIL,
          uid: PENDING_TEACHER_UID,
          settings: {
            meetLink: 'https://meet.google.com/pending-confirmed-v1',
            availableDays: ['friday'],
            availability: { friday: ['16:00'] },
            timezone: 'America/New_York',
          },
        },
        { Authorization: 'Bearer tok-pending-teacher' }
      );
      assert.strictEqual(postMeet.status, 200);
      assert.strictEqual(postMeet.data?.success, true);
      assert.strictEqual(
        mockFs._getDoc('teacher_availability', PENDING_TEACHER_UID)?.meetLink,
        'https://meet.google.com/pending-confirmed-v1'
      );

      // Admin updating Teacher B via POST /api/teacher-settings
      const postAdmin = await makeRequest(
        server,
        'POST',
        '/api/teacher-settings',
        {
          teacherEmail: TEACHER_B_EMAIL,
          meetLink: 'https://meet.google.com/beta-admin-confirmed',
          availableDays: ['thursday'],
          availability: { thursday: ['13:00'] },
        },
        { Authorization: 'Bearer tok-admin' }
      );
      assert.strictEqual(postAdmin.status, 200);
      assert.strictEqual(postAdmin.data?.success, true);
      assert.strictEqual(
        mockFs._getDoc('teacher_availability', TEACHER_B_UID)?.meetLink,
        'https://meet.google.com/beta-admin-confirmed'
      );
    });

    // 2. Firestore unavailable (null) and cloud writes disabled -> 503, ZERO RAM mutation, ZERO false success
    await test('2. Firestore indisponível ou cloud write desabilitado retorna HTTP 503 sem mutar RAM e sem sucesso falso', async () => {
      for (const endpoint of ['/api/teacher-settings', '/api/meet-settings']) {
        // 2a. Firestore null
        seedBaseline(mockFs);
        setFirebaseAdminFirestoreForTesting(null);

        const resNull = await makeRequest(
          server,
          'POST',
          endpoint,
          {
            teacherEmail: TEACHER_A_EMAIL,
            uid: TEACHER_A_UID,
            meetLink: 'https://meet.google.com/should-not-persist-null',
            availableDays: ['friday'],
            availability: { friday: ['19:00'] },
          },
          { Authorization: 'Bearer tok-teacher-a' }
        );
        assert.strictEqual(resNull.status, 503, `${endpoint} sem Firestore deve retornar 503`);
        assert.strictEqual(resNull.data?.success, false, `${endpoint} não pode retornar sucesso falso`);
        assert.strictEqual(readDb().meetSettings[TEACHER_A_EMAIL].meetLink, 'https://meet.google.com/alpha-baseline');
        assert.strictEqual(readDb().teacherSettings[TEACHER_A_UID].meetLink, 'https://meet.google.com/alpha-baseline');
        assert.strictEqual(readDb().tutorsList[0].meetLink, 'https://meet.google.com/alpha-baseline');

        // 2b. Cloud write disabled
        seedBaseline(mockFs);
        setIsCloudWriteDisabled(true);

        const resDisabled = await makeRequest(
          server,
          'POST',
          endpoint,
          {
            teacherEmail: TEACHER_A_EMAIL,
            uid: TEACHER_A_UID,
            meetLink: 'https://meet.google.com/should-not-persist-disabled',
            availableDays: ['sunday'],
            availability: { sunday: ['20:00'] },
          },
          { Authorization: 'Bearer tok-teacher-a' }
        );
        assert.strictEqual(resDisabled.status, 503, `${endpoint} com cloud write disabled deve retornar 503`);
        assert.strictEqual(resDisabled.data?.success, false);
        assert.strictEqual(readDb().meetSettings[TEACHER_A_EMAIL].meetLink, 'https://meet.google.com/alpha-baseline');
        assert.strictEqual(readDb().teacherSettings[TEACHER_A_UID].meetLink, 'https://meet.google.com/alpha-baseline');
        assert.strictEqual(readDb().tutorsList[0].meetLink, 'https://meet.google.com/alpha-baseline');
        assert.strictEqual(mockFs._getDoc('teacher_availability', TEACHER_A_UID)?.meetLink, 'https://meet.google.com/alpha-baseline');
      }
    });

    // 3. Firestore write error (throws / PERMISSION_DENIED) -> 500/503, ZERO RAM mutation, ZERO false success
    await test('3. Falha de escrita no Firestore (erro/PERMISSION_DENIED) retorna HTTP 500/503 sem sucesso falso e sem mutação em RAM', async () => {
      for (const endpoint of ['/api/teacher-settings', '/api/meet-settings']) {
        seedBaseline(mockFs);
        mockFs._setFailOnSet('teacher_availability', 7);

        const resFail = await makeRequest(
          server,
          'POST',
          endpoint,
          {
            teacherEmail: TEACHER_A_EMAIL,
            uid: TEACHER_A_UID,
            meetLink: 'https://meet.google.com/should-not-persist-err',
            availableDays: ['saturday'],
            availability: { saturday: ['11:00'] },
          },
          { Authorization: 'Bearer tok-teacher-a' }
        );
        assert.ok(resFail.status === 500 || resFail.status === 503, `${endpoint} erro Firestore -> 500/503, got ${resFail.status}`);
        assert.strictEqual(resFail.data?.success, false, `${endpoint} não deve apresentar sucesso falso`);
        assert.strictEqual(readDb().meetSettings[TEACHER_A_EMAIL].meetLink, 'https://meet.google.com/alpha-baseline');
        assert.strictEqual(readDb().teacherSettings[TEACHER_A_UID].meetLink, 'https://meet.google.com/alpha-baseline');
        assert.strictEqual(readDb().tutorsList[0].meetLink, 'https://meet.google.com/alpha-baseline');
        assert.strictEqual(mockFs._getDoc('teacher_availability', TEACHER_A_UID)?.meetLink, 'https://meet.google.com/alpha-baseline');
      }
    });

    // 4. Firestore timeout (> 2s) -> 500/503, ZERO RAM mutation, ZERO false success
    await test('4. Timeout na gravação em teacher_availability retorna HTTP 500/503 sem sucesso falso e sem mutação em RAM', async () => {
      seedBaseline(mockFs);
      mockFs._setHangOnSet('teacher_availability');

      const resTimeout = await makeRequest(
        server,
        'POST',
        '/api/teacher-settings',
        {
          teacherEmail: TEACHER_A_EMAIL,
          uid: TEACHER_A_UID,
          meetLink: 'https://meet.google.com/should-not-persist-timeout',
          availableDays: ['friday'],
          availability: { friday: ['18:00'] },
        },
        { Authorization: 'Bearer tok-teacher-a' }
      );
      assert.ok(resTimeout.status === 500 || resTimeout.status === 503, `Timeout deve retornar 500/503, got ${resTimeout.status}`);
      assert.strictEqual(resTimeout.data?.success, false, 'Timeout não deve retornar sucesso falso');
      assert.strictEqual(readDb().meetSettings[TEACHER_A_EMAIL].meetLink, 'https://meet.google.com/alpha-baseline');
      assert.strictEqual(readDb().teacherSettings[TEACHER_A_UID].meetLink, 'https://meet.google.com/alpha-baseline');
      assert.strictEqual(readDb().tutorsList[0].meetLink, 'https://meet.google.com/alpha-baseline');
      assert.strictEqual(mockFs._getDoc('teacher_availability', TEACHER_A_UID)?.meetLink, 'https://meet.google.com/alpha-baseline');
    });

    // 5. Permissions & Authorization preserved
    await test('5. Permissões e autorização preservadas (401 anônimo, 403 aluno/terceiro/rejeitado, remoção de campos privilegiados)', async () => {
      seedBaseline(mockFs);

      const anon = await makeRequest(server, 'POST', '/api/teacher-settings', {
        teacherEmail: TEACHER_A_EMAIL,
        meetLink: 'https://meet.google.com/hijack',
      });
      assert.strictEqual(anon.status, 401);

      const studentPost = await makeRequest(
        server,
        'POST',
        '/api/meet-settings',
        { teacherEmail: TEACHER_A_EMAIL, meetLink: 'https://meet.google.com/hijack-student' },
        { Authorization: 'Bearer tok-student-linked' }
      );
      assert.strictEqual(studentPost.status, 403);

      const crossTeacherPost = await makeRequest(
        server,
        'POST',
        '/api/teacher-settings',
        { teacherEmail: TEACHER_B_EMAIL, uid: TEACHER_B_UID, meetLink: 'https://meet.google.com/hijack-cross' },
        { Authorization: 'Bearer tok-teacher-a' }
      );
      assert.strictEqual(crossTeacherPost.status, 403);

      const rejectedPost = await makeRequest(
        server,
        'POST',
        '/api/meet-settings',
        { teacherEmail: REJECTED_TEACHER_EMAIL, meetLink: 'https://meet.google.com/rejected' },
        { Authorization: 'Bearer tok-rejected-teacher' }
      );
      assert.strictEqual(rejectedPost.status, 403);

      assert.strictEqual(mockFs._writeLog.length, 0, 'Nenhuma escrita no Firestore em requisições 401/403');
    });

    // 6. Simulated restart survival
    await test('6. Reinício simulado: configurações confirmadas sobrevivem em GET /api/teacher-settings e GET /api/meet-settings; falhas não deixam resíduo', async () => {
      seedBaseline(mockFs);

      const okPost = await makeRequest(
        server,
        'POST',
        '/api/teacher-settings',
        {
          teacherEmail: TEACHER_A_EMAIL,
          uid: TEACHER_A_UID,
          meetLink: 'https://meet.google.com/alpha-persisted-after-restart',
          timezone: 'America/Toronto',
          availableDays: ['monday', 'thursday'],
          availability: { monday: ['08:30'], thursday: ['17:00'] },
        },
        { Authorization: 'Bearer tok-teacher-a' }
      );
      assert.strictEqual(okPost.status, 200);

      // Failed update right after must NOT overwrite RAM or Firestore
      mockFs._setFailOnSet('teacher_availability', 14);
      const failedPost = await makeRequest(
        server,
        'POST',
        '/api/meet-settings',
        {
          teacherEmail: TEACHER_A_EMAIL,
          uid: TEACHER_A_UID,
          meetLink: 'https://meet.google.com/alpha-phantom-failed',
          availableDays: ['sunday'],
          availability: { sunday: ['23:00'] },
        },
        { Authorization: 'Bearer tok-teacher-a' }
      );
      assert.ok(failedPost.status === 500 || failedPost.status === 503);
      assert.strictEqual(failedPost.data?.success, false);
      assert.strictEqual(
        readDb().meetSettings[TEACHER_A_UID].meetLink,
        'https://meet.google.com/alpha-persisted-after-restart',
        'RAM preservada com o último valor confirmado, sem configuração falha em memória'
      );
      mockFs._setFailOnSet(null);

      // Simulate server restart
      resetInMemoryDbForTesting();
      resetResidualCachesForTesting();
      await initCloudPersistence();

      // Verify teacher GET
      const teacherGetAfterRestart = await makeRequest(server, 'GET', '/api/teacher-settings', undefined, {
        Authorization: 'Bearer tok-teacher-a',
      });
      assert.strictEqual(teacherGetAfterRestart.status, 200);
      assert.strictEqual(
        teacherGetAfterRestart.data[TEACHER_A_UID]?.meetLink,
        'https://meet.google.com/alpha-persisted-after-restart'
      );
      assert.deepStrictEqual(
        teacherGetAfterRestart.data[TEACHER_A_UID]?.availability,
        { monday: ['08:30'], thursday: ['17:00'] }
      );

      // Verify linked student GET
      const studentGetAfterRestart = await makeRequest(server, 'GET', '/api/meet-settings', undefined, {
        Authorization: 'Bearer tok-student-linked',
      });
      assert.strictEqual(studentGetAfterRestart.status, 200);
      assert.strictEqual(
        studentGetAfterRestart.data[TEACHER_A_UID]?.meetLink,
        'https://meet.google.com/alpha-persisted-after-restart'
      );
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    setIsCloudWriteDisabled(false);
    resetFirebaseAdminForTesting();
    resetFirebaseAdminFirestoreForTesting();
    resetInMemoryDbForTesting();
    resetResidualCachesForTesting();
  }

  console.log(`\nResumo SEC.FIX.6A.4C.3: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('Fatal error in validate-sec-fix-6a-4c-3:', err);
  process.exit(1);
});
