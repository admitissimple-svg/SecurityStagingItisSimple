/**
 * SEC.FIX.6 — Proteção das Rotinas (GET/POST /api/routines e consumidores)
 *
 * Valida:
 * 1. Bloqueio estrito (HTTP 401) para acessos anônimos, cabeçalhos malformados, tokens expirados/revogados/inválidos e UID não canônico em GET/POST /api/routines, sem mutação.
 * 2. Bloqueio (HTTP 403) para contas conflict, pending_teacher, rejected, unregistered e excluídas/desativadas.
 * 3. Isolamento estrito de aluno: lê e atualiza apenas a própria rotina em studentRoutinesMap (nunca sobrescreve db.routinesByDay global); acesso cruzado por studentUid/studentEmail retorna 403.
 * 4. RBAC e vínculo canônico de professor aprovado:
 *    - GET sem alvo retorna template limpo defaultRoutinesByDay (sem vazamento de alunos); POST sem alvo retorna 403.
 *    - Acessa/atualiza rotina apenas de aluno canonicamente vinculado (sem alterar db.routinesByDay global).
 *    - Bloqueia aluno não vinculado (403), aula cancelada (403), self-UID (403), UID sintético (422).
 *    - Troca de Native Friend (A -> B) revoga imediatamente Teacher A (mesmo com aula concluída histórica) e libera Teacher B.
 *    - Aula trial ativa (scheduled) libera acesso; aula trial cancelada bloqueia.
 * 5. RBAC de ADM: lê/atualiza template global db.routinesByDay sem alvo; lê/atualiza aluno específico sem contaminar global; payload inválido retorna 400; alvo não-aluno/inválido retorna 403/422.
 * 6. Compatibilidade funcional: hidratação via Firestore (default) (vídeos, Spotify, learnedWords), coexistência com /api/student-routines e /api/routines/daily-video, e contrato seguro em src/App.tsx.
 */

process.env.NODE_ENV = 'test';
process.env.FIREBASE_PROJECT_ID = 'itissimple-security-staging';
process.env.FIREBASE_DATABASE_ID = '(default)';

import assert from 'node:assert';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
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
    get: async () => {
      const docs = getCollectionEntries(colPath).map(({ id, data }) => ({
        id,
        exists: true,
        ref: makeDocRef(colPath, id),
        data: () => deepClone(data),
      }));
      return { empty: docs.length === 0, size: docs.length, docs, forEach: (cb: any) => docs.forEach(cb) };
    },
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
    _setDoc: (colPath: string, id: string, data: Record<string, any>) => {
      store.set(`${colPath}::${id}`, deepClone(data));
    },
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

const ADMIN_UID = 'adminCanonicalUidSecFix6001';
const ADMIN_EMAIL = 'admin.secfix6@itissimple.com';

const TEACHER_A_UID = 'teacherACanonicalSecFix6001';
const TEACHER_A_EMAIL = 'teacher.a.secfix6@itissimple.com';

const TEACHER_B_UID = 'teacherBCanonicalSecFix6001';
const TEACHER_B_EMAIL = 'teacher.b.secfix6@itissimple.com';

const PENDING_TEACHER_UID = 'pendingTeacherUidSecFix6001';
const PENDING_TEACHER_EMAIL = 'pending.secfix6@itissimple.com';

const REJECTED_TEACHER_UID = 'rejectedTeacherUidSecFix601';
const REJECTED_TEACHER_EMAIL = 'rejected.secfix6@itissimple.com';

const STUDENT_1_UID = 'student1CanonicalSecFix6001';
const STUDENT_1_EMAIL = 'student.one.secfix6@itissimple.com';

const STUDENT_2_UID = 'student2CanonicalSecFix6001';
const STUDENT_2_EMAIL = 'student.two.secfix6@itissimple.com';

const STUDENT_TRIAL_UID = 'studentTrialUidSecFix600001';
const STUDENT_TRIAL_EMAIL = 'student.trial.secfix6@itissimple.com';

const DELETED_STUDENT_UID = 'deletedStudentUidSecFix6001';
const DELETED_STUDENT_EMAIL = 'deleted.student.secfix6@itissimple.com';

const CONFLICT_ADMIN_UID = 'conflictAdminUidSecFix60001';
const CONFLICT_ADMIN_EMAIL = 'conflict.admin.secfix6@itissimple.com';

const UNREGISTERED_UID = 'unregisteredUidSecFix600001';
const UNREGISTERED_EMAIL = 'unregistered.secfix6@itissimple.com';

function seedBaseline(mockFs: ReturnType<typeof createMockFirestore>) {
  resetInMemoryDbForTesting();
  resetResidualCachesForTesting();
  mockFs._clearAll();

  mockFs._setDoc('tutors', TEACHER_A_UID, {
    id: TEACHER_A_UID,
    uid: TEACHER_A_UID,
    authUid: TEACHER_A_UID,
    publicTutorId: 'teacher-a-secfix6',
    email: TEACHER_A_EMAIL,
    name: 'Teacher Alpha',
    role: 'teacher',
    approvalStatus: 'approved',
    isApproved: true,
    status: 'approved',
    approved: true,
  });

  mockFs._setDoc('tutors', TEACHER_B_UID, {
    id: TEACHER_B_UID,
    uid: TEACHER_B_UID,
    authUid: TEACHER_B_UID,
    publicTutorId: 'teacher-b-secfix6',
    email: TEACHER_B_EMAIL,
    name: 'Teacher Beta',
    role: 'teacher',
    approvalStatus: 'approved',
    isApproved: true,
    status: 'approved',
    approved: true,
  });

  mockFs._setDoc('tutors', PENDING_TEACHER_UID, {
    id: PENDING_TEACHER_UID,
    uid: PENDING_TEACHER_UID,
    authUid: PENDING_TEACHER_UID,
    email: PENDING_TEACHER_EMAIL,
    name: 'Pending Tutor',
    role: 'teacher',
    approvalStatus: 'pending',
    isApproved: false,
    status: 'pending',
    approved: false,
  });

  mockFs._setDoc('tutors', REJECTED_TEACHER_UID, {
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
  });

  // Student 1 linked canonically to Teacher A with Firestore routine + Spotify + video assignment
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
    routineVideoTime: '08:30',
  });
  mockFs._setDoc(`users/${STUDENT_1_UID}/routines`, 'monday', {
    dayOfWeek: 'monday',
    weeklyCycle: 1,
    videoId: 'dQw4w9WgXcQ',
    title: 'Student 1 Secret Monday Video',
    learnedWords: ['secret-s1-word'],
    completedToday: false,
    teacherNotes: 'Private note for Student 1',
  });
  mockFs._setDoc('student_assignments', STUDENT_1_UID, {
    uid: STUDENT_1_UID,
    studentUid: STUDENT_1_UID,
    email: STUDENT_1_EMAIL,
    teacherUid: TEACHER_A_UID,
    assignedNativeFriendUID: TEACHER_A_UID,
    teacherEmail: TEACHER_A_EMAIL,
    weeklyCycle: 1,
    spotifyAssignments: [
      {
        day: 'monday',
        trackId: 'spot-s1-mon',
        url: 'https://open.spotify.com/track/1111111111111111111111',
        title: 'Student 1 Private Podcast',
        artistOrHost: 'Host S1',
      },
    ],
  });

  // Student 2 linked canonically to Teacher B
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
  mockFs._setDoc(`users/${STUDENT_2_UID}/routines`, 'monday', {
    dayOfWeek: 'monday',
    weeklyCycle: 1,
    videoId: '9bZkp7q19f0',
    title: 'Student 2 Private Monday Video',
    learnedWords: ['confidential-s2-word'],
  });
  mockFs._setDoc('student_assignments', STUDENT_2_UID, {
    uid: STUDENT_2_UID,
    studentUid: STUDENT_2_UID,
    email: STUDENT_2_EMAIL,
    teacherUid: TEACHER_B_UID,
    assignedNativeFriendUID: TEACHER_B_UID,
    teacherEmail: TEACHER_B_EMAIL,
    weeklyCycle: 1,
  });

  // Unlinked Trial Student
  mockFs._setDoc('users', STUDENT_TRIAL_UID, {
    id: STUDENT_TRIAL_UID,
    uid: STUDENT_TRIAL_UID,
    email: STUDENT_TRIAL_EMAIL,
    name: 'Trial Student',
    role: 'student',
    enrollmentStatus: 'not_enrolled',
  });

  // Deleted Student
  mockFs._setDoc('users', DELETED_STUDENT_UID, {
    id: DELETED_STUDENT_UID,
    uid: DELETED_STUDENT_UID,
    email: DELETED_STUDENT_EMAIL,
    name: 'Deleted Student',
    role: 'student',
  });

  // Conflict Admin (has student doc in users/{uid} + admin claim in token)
  mockFs._setDoc('users', CONFLICT_ADMIN_UID, {
    id: CONFLICT_ADMIN_UID,
    uid: CONFLICT_ADMIN_UID,
    email: CONFLICT_ADMIN_EMAIL,
    name: 'Conflict Admin',
    role: 'student',
  });

  const db = readDb();
  db.tutorsList = [
    { id: TEACHER_A_UID, uid: TEACHER_A_UID, authUid: TEACHER_A_UID, email: TEACHER_A_EMAIL, name: 'Teacher Alpha', role: 'teacher', approvalStatus: 'approved', isApproved: true },
    { id: TEACHER_B_UID, uid: TEACHER_B_UID, authUid: TEACHER_B_UID, email: TEACHER_B_EMAIL, name: 'Teacher Beta', role: 'teacher', approvalStatus: 'approved', isApproved: true },
  ];
  db.teachers = [
    { id: ADMIN_UID, uid: ADMIN_UID, email: ADMIN_EMAIL, role: 'admin', name: 'Admin' },
    ...db.tutorsList,
  ];
  db.deletedStudentEmails = [DELETED_STUDENT_EMAIL];
}

async function run() {
  console.log('\n=== SEC.FIX.6: Validação de Proteção das Rotinas (GET/POST /api/routines) ===\n');

  const mockFs = createMockFirestore();
  setFirebaseAdminFirestoreForTesting(mockFs as unknown as Firestore);

  setFirebaseAdminAuthForTesting({
    verifyIdToken: async (token: string) => {
      switch (token) {
        case 'token-admin':
          return { uid: ADMIN_UID, email: ADMIN_EMAIL, email_verified: true, role: 'admin', admin: true };
        case 'token-teacher-a':
          return { uid: TEACHER_A_UID, email: TEACHER_A_EMAIL, email_verified: true, role: 'teacher' };
        case 'token-teacher-b':
          return { uid: TEACHER_B_UID, email: TEACHER_B_EMAIL, email_verified: true, role: 'teacher' };
        case 'token-pending-teacher':
          return { uid: PENDING_TEACHER_UID, email: PENDING_TEACHER_EMAIL, email_verified: true, role: 'student' };
        case 'token-rejected-teacher':
          return { uid: REJECTED_TEACHER_UID, email: REJECTED_TEACHER_EMAIL, email_verified: true, role: 'teacher' };
        case 'token-student-1':
          return { uid: STUDENT_1_UID, email: STUDENT_1_EMAIL, email_verified: true, role: 'student' };
        case 'token-student-2':
          return { uid: STUDENT_2_UID, email: STUDENT_2_EMAIL, email_verified: true, role: 'student' };
        case 'token-student-trial':
          return { uid: STUDENT_TRIAL_UID, email: STUDENT_TRIAL_EMAIL, email_verified: true, role: 'student' };
        case 'token-deleted-student':
          return { uid: DELETED_STUDENT_UID, email: DELETED_STUDENT_EMAIL, email_verified: true, role: 'student' };
        case 'token-conflict-admin':
          return { uid: CONFLICT_ADMIN_UID, email: CONFLICT_ADMIN_EMAIL, email_verified: true, role: 'admin' };
        case 'token-unregistered':
          return { uid: UNREGISTERED_UID, email: UNREGISTERED_EMAIL, email_verified: true, role: 'student' };
        case 'token-noncanonical-uid':
          return { uid: 'usr-local-123', email: 'local@itissimple.com', email_verified: true, role: 'student' };
        case 'token-expired': {
          const e: any = new Error('Token expired');
          e.code = 'auth/id-token-expired';
          throw e;
        }
        case 'token-revoked': {
          const e: any = new Error('Token revoked');
          e.code = 'auth/id-token-revoked';
          throw e;
        }
        default:
          throw new Error('Invalid token');
      }
    },
  } as any);

  const server = http.createServer(serverApp);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));

  try {
    // 1. Anonymous & Invalid Auth -> 401
    await test('1. Acessos anônimos, cabeçalhos malformados, tokens inválidos/expirados/revogados e UID não canônico retornam 401 sem mutação', async () => {
      seedBaseline(mockFs);
      const initialGlobalSnapshot = JSON.stringify(readDb().routinesByDay);
      const customBody = { monday: [{ id: 'mon-pwn', activityName: 'Hacked Global' }] };

      for (const method of ['GET', 'POST'] as const) {
        const payload = method === 'POST' ? customBody : undefined;

        const anon = await makeRequest(server, method, '/api/routines', payload);
        assert.strictEqual(anon.status, 401, `${method} anon -> 401`);
        assert.strictEqual(JSON.stringify(anon.data).includes('secret-s1-word'), false);

        const badHeader = await makeRequest(server, method, '/api/routines', payload, { Authorization: 'Basic xyz' });
        assert.strictEqual(badHeader.status, 401, `${method} Basic header -> 401`);

        const expired = await makeRequest(server, method, '/api/routines', payload, { Authorization: 'Bearer token-expired' });
        assert.strictEqual(expired.status, 401, `${method} expired token -> 401`);

        const revoked = await makeRequest(server, method, '/api/routines', payload, { Authorization: 'Bearer token-revoked' });
        assert.strictEqual(revoked.status, 401, `${method} revoked token -> 401`);

        const invalid = await makeRequest(server, method, '/api/routines', payload, { Authorization: 'Bearer invalid-tok' });
        assert.strictEqual(invalid.status, 401, `${method} invalid token -> 401`);

        const nonCanonical = await makeRequest(server, method, '/api/routines', payload, { Authorization: 'Bearer token-noncanonical-uid' });
        assert.strictEqual(nonCanonical.status, 401, `${method} non-canonical UID -> 401`);
      }

      assert.strictEqual(JSON.stringify(readDb().routinesByDay), initialGlobalSnapshot, 'Global routinesByDay intacto');
      assert.strictEqual(Object.keys(readDb().studentRoutinesMap || {}).length, 0, 'studentRoutinesMap vazio');
    });

    // 2. Blocked Identities -> 403
    await test('2. Contas conflict, pending_teacher, rejected, unregistered e excluídas recebem HTTP 403 em GET e POST', async () => {
      seedBaseline(mockFs);
      const payload = { monday: [{ id: 'mon-blocked', activityName: 'Blocked Update' }] };
      const blockedTokens = [
        'token-conflict-admin',
        'token-pending-teacher',
        'token-rejected-teacher',
        'token-unregistered',
        'token-deleted-student',
      ];

      for (const tok of blockedTokens) {
        const g = await makeRequest(server, 'GET', '/api/routines', undefined, { Authorization: `Bearer ${tok}` });
        assert.strictEqual(g.status, 403, `GET ${tok} -> 403`);
        const p = await makeRequest(server, 'POST', '/api/routines', payload, { Authorization: `Bearer ${tok}` });
        assert.strictEqual(p.status, 403, `POST ${tok} -> 403`);
      }

      assert.strictEqual(Object.keys(readDb().studentRoutinesMap || {}).length, 0, 'Nenhuma mutação após bloqueios 403');
    });

    // 3. Student Ownership & Isolation
    await test('3. Aluno acessa/atualiza apenas a própria rotina sem sobrescrever global e é bloqueado (403) ao tentar acessar terceiro', async () => {
      seedBaseline(mockFs);
      const initialGlobalSnapshot = JSON.stringify(readDb().routinesByDay);

      // 3a. Student 1 GET returns own Firestore-backed routines (secret-s1-word), never Student 2
      const s1Get = await makeRequest(server, 'GET', '/api/routines', undefined, {
        Authorization: 'Bearer token-student-1',
      });
      assert.strictEqual(s1Get.status, 200);
      assert.strictEqual(s1Get.data?.monday?.[0]?.learnedWords?.[0], 'secret-s1-word');
      assert.strictEqual(s1Get.data?.monday?.[0]?.teacherVideos?.[0]?.videoId, 'dQw4w9WgXcQ');
      assert.strictEqual(s1Get.data?.monday?.[0]?.teacherSpotify?.trackId, 'spot-s1-mon');
      assert.strictEqual(JSON.stringify(s1Get.data).includes('confidential-s2-word'), false);

      // 3b. Student 1 POST updates ONLY Student 1 map entry without touching global db.routinesByDay
      const s1UpdatedPayload = {
        monday: [{ id: 'mon-s1-custom', time: '09:00', activityName: 'S1 Custom Routine', learnedWords: ['s1-custom-word'] }],
      };
      const s1Post = await makeRequest(server, 'POST', '/api/routines', s1UpdatedPayload, {
        Authorization: 'Bearer token-student-1',
      });
      assert.strictEqual(s1Post.status, 200);
      assert.strictEqual(s1Post.data?.monday?.[0]?.id, 'mon-s1-custom');
      assert.strictEqual(JSON.stringify(readDb().routinesByDay), initialGlobalSnapshot, 'POST de aluno não altera db.routinesByDay global');

      // 3c. Subsequent GET for Student 1 returns updated routine; Student 2 still sees Student 2 routine
      const s1GetAfter = await makeRequest(server, 'GET', '/api/routines', undefined, {
        Authorization: 'Bearer token-student-1',
      });
      assert.strictEqual(s1GetAfter.status, 200);
      assert.strictEqual(s1GetAfter.data?.monday?.[0]?.id, 'mon-s1-custom');

      const s2Get = await makeRequest(server, 'GET', '/api/routines', undefined, {
        Authorization: 'Bearer token-student-2',
      });
      assert.strictEqual(s2Get.status, 200);
      assert.strictEqual(s2Get.data?.monday?.[0]?.learnedWords?.[0], 'confidential-s2-word');
      assert.strictEqual(JSON.stringify(s2Get.data).includes('s1-custom-word'), false);

      // 3d. Cross-student attempts by Student 1 -> 403
      const crossGetUid = await makeRequest(server, 'GET', `/api/routines?studentUid=${STUDENT_2_UID}`, undefined, {
        Authorization: 'Bearer token-student-1',
      });
      assert.strictEqual(crossGetUid.status, 403);

      const crossGetEmail = await makeRequest(server, 'GET', `/api/routines?studentEmail=${encodeURIComponent(STUDENT_2_EMAIL)}`, undefined, {
        Authorization: 'Bearer token-student-1',
      });
      assert.strictEqual(crossGetEmail.status, 403);

      const crossPostUid = await makeRequest(
        server,
        'POST',
        '/api/routines',
        { studentUid: STUDENT_2_UID, routinesByDay: s1UpdatedPayload },
        { Authorization: 'Bearer token-student-1' }
      );
      assert.strictEqual(crossPostUid.status, 403);

      const crossPostEmail = await makeRequest(
        server,
        'POST',
        '/api/routines',
        { studentEmail: STUDENT_2_EMAIL, routinesByDay: s1UpdatedPayload },
        { Authorization: 'Bearer token-student-1' }
      );
      assert.strictEqual(crossPostEmail.status, 403);

      // Verify Student 2 remains unaffected
      const s2Check = await makeRequest(server, 'GET', '/api/routines', undefined, {
        Authorization: 'Bearer token-student-2',
      });
      assert.strictEqual(s2Check.data?.monday?.[0]?.learnedWords?.[0], 'confidential-s2-word');
    });

    // 4. Approved Teacher RBAC, Canonical Links, Switch Native Friend, Trial Lesson
    await test('4. Professor aprovado acessa apenas alunos vinculados, nunca muta global, e perde acesso após troca de Native Friend', async () => {
      seedBaseline(mockFs);
      const initialGlobalSnapshot = JSON.stringify(readDb().routinesByDay);

      // 4a. Teacher A bare GET returns clean base template (no student secrets)
      const taBareGet = await makeRequest(server, 'GET', '/api/routines', undefined, {
        Authorization: 'Bearer token-teacher-a',
      });
      assert.strictEqual(taBareGet.status, 200);
      assert.ok(Array.isArray(taBareGet.data?.monday), 'Retorna estrutura semanal padrão');
      assert.strictEqual(JSON.stringify(taBareGet.data).includes('secret-s1-word'), false, 'GET sem alvo não vaza rotina de aluno');
      assert.strictEqual(JSON.stringify(taBareGet.data).includes('confidential-s2-word'), false);

      // 4b. Teacher A bare POST -> 403 (cannot mutate global template)
      const taBarePost = await makeRequest(
        server,
        'POST',
        '/api/routines',
        { monday: [{ id: 'mon-ta-global', activityName: 'Blocked Global' }] },
        { Authorization: 'Bearer token-teacher-a' }
      );
      assert.strictEqual(taBarePost.status, 403);
      assert.strictEqual(JSON.stringify(readDb().routinesByDay), initialGlobalSnapshot);

      // 4c. Teacher A reads and updates linked Student 1 -> 200 without modifying global
      const taGetS1 = await makeRequest(server, 'GET', `/api/routines?studentUid=${STUDENT_1_UID}`, undefined, {
        Authorization: 'Bearer token-teacher-a',
      });
      assert.strictEqual(taGetS1.status, 200);
      assert.strictEqual(taGetS1.data?.monday?.[0]?.learnedWords?.[0], 'secret-s1-word');

      const taPostS1 = await makeRequest(
        server,
        'POST',
        '/api/routines',
        {
          studentUid: STUDENT_1_UID,
          routinesByDay: {
            monday: [{ id: 'mon-ta-updated-s1', time: '09:30', activityName: 'Assigned by Teacher A' }],
          },
        },
        { Authorization: 'Bearer token-teacher-a' }
      );
      assert.strictEqual(taPostS1.status, 200);
      assert.strictEqual(taPostS1.data?.monday?.[0]?.id, 'mon-ta-updated-s1');
      assert.strictEqual(JSON.stringify(readDb().routinesByDay), initialGlobalSnapshot, 'POST de professor não muta global');

      // 4d. Teacher A blocked on unlinked Student 2, self-UID, synthetic UID
      const taGetS2 = await makeRequest(server, 'GET', `/api/routines?studentUid=${STUDENT_2_UID}`, undefined, {
        Authorization: 'Bearer token-teacher-a',
      });
      assert.strictEqual(taGetS2.status, 403);

      const taPostS2 = await makeRequest(
        server,
        'POST',
        '/api/routines',
        { studentUid: STUDENT_2_UID, monday: [{ id: 'pwn-s2', activityName: 'Unauthorized' }] },
        { Authorization: 'Bearer token-teacher-a' }
      );
      assert.strictEqual(taPostS2.status, 403);

      const taSelfGet = await makeRequest(server, 'GET', `/api/routines?studentUid=${TEACHER_A_UID}`, undefined, {
        Authorization: 'Bearer token-teacher-a',
      });
      assert.strictEqual(taSelfGet.status, 403);

      const taSyntheticGet = await makeRequest(server, 'GET', '/api/routines?studentUid=usr-synthetic-123', undefined, {
        Authorization: 'Bearer token-teacher-a',
      });
      assert.strictEqual(taSyntheticGet.status, 422);

      // 4e. Switch Native Friend: Student 1 moves from Teacher A to Teacher B (even with historical completed lesson under Teacher A)
      mockFs._setDoc('lessons', 'lesson-completed-ta', {
        id: 'lesson-completed-ta',
        studentUid: STUDENT_1_UID,
        teacherUid: TEACHER_A_UID,
        teacherEmail: TEACHER_A_EMAIL,
        status: 'completed',
      });
      mockFs._setDoc('users', STUDENT_1_UID, {
        id: STUDENT_1_UID,
        uid: STUDENT_1_UID,
        email: STUDENT_1_EMAIL,
        name: 'Student One',
        role: 'student',
        teacherUid: TEACHER_B_UID,
        assignedNativeFriendUID: TEACHER_B_UID,
        teacherEmail: TEACHER_B_EMAIL,
        enrollmentStatus: 'active',
        weeklyCycle: 1,
      });
      mockFs._setDoc('student_assignments', STUDENT_1_UID, {
        uid: STUDENT_1_UID,
        studentUid: STUDENT_1_UID,
        email: STUDENT_1_EMAIL,
        teacherUid: TEACHER_B_UID,
        assignedNativeFriendUID: TEACHER_B_UID,
        teacherEmail: TEACHER_B_EMAIL,
        weeklyCycle: 1,
      });

      const taAfterSwitchGet = await makeRequest(server, 'GET', `/api/routines?studentUid=${STUDENT_1_UID}`, undefined, {
        Authorization: 'Bearer token-teacher-a',
      });
      assert.strictEqual(taAfterSwitchGet.status, 403, 'Professor anterior perde acesso GET imediatamente após troca');

      const taAfterSwitchPost = await makeRequest(
        server,
        'POST',
        '/api/routines',
        { studentUid: STUDENT_1_UID, monday: [{ id: 'pwn-after-switch', activityName: 'Revoked' }] },
        { Authorization: 'Bearer token-teacher-a' }
      );
      assert.strictEqual(taAfterSwitchPost.status, 403, 'Professor anterior perde acesso POST imediatamente após troca');

      const tbAfterSwitchGet = await makeRequest(server, 'GET', `/api/routines?studentUid=${STUDENT_1_UID}`, undefined, {
        Authorization: 'Bearer token-teacher-b',
      });
      assert.strictEqual(tbAfterSwitchGet.status, 200, 'Novo Native Friend B acessa Student 1');

      // 4f. Cancelled trial lesson denies Teacher B; scheduled trial lesson grants Teacher B
      mockFs._setDoc('lessons', 'lesson-trial-cancelled', {
        id: 'lesson-trial-cancelled',
        studentUid: STUDENT_TRIAL_UID,
        teacherUid: TEACHER_B_UID,
        teacherEmail: TEACHER_B_EMAIL,
        status: 'cancelled',
        isTrialLesson: true,
      });
      const tbCancelledTrialGet = await makeRequest(server, 'GET', `/api/routines?studentUid=${STUDENT_TRIAL_UID}`, undefined, {
        Authorization: 'Bearer token-teacher-b',
      });
      assert.strictEqual(tbCancelledTrialGet.status, 403);

      mockFs._setDoc('lessons', 'lesson-trial-active', {
        id: 'lesson-trial-active',
        studentUid: STUDENT_TRIAL_UID,
        teacherUid: TEACHER_B_UID,
        teacherEmail: TEACHER_B_EMAIL,
        status: 'scheduled',
        isTrialLesson: true,
      });
      const tbActiveTrialGet = await makeRequest(server, 'GET', `/api/routines?studentUid=${STUDENT_TRIAL_UID}`, undefined, {
        Authorization: 'Bearer token-teacher-b',
      });
      assert.strictEqual(tbActiveTrialGet.status, 200);
    });

    // 5. Admin RBAC & Global / Targeted Management & Validation
    await test('5. ADM gerencia template global ou rotina de aluno específico sem contaminar global; payloads e alvos inválidos são rejeitados', async () => {
      seedBaseline(mockFs);

      const adminGetGlobal = await makeRequest(server, 'GET', '/api/routines', undefined, {
        Authorization: 'Bearer token-admin',
      });
      assert.strictEqual(adminGetGlobal.status, 200);

      const adminPostGlobal = await makeRequest(
        server,
        'POST',
        '/api/routines',
        { monday: [{ id: 'mon-admin-global', time: '07:00', activityName: 'Admin Global Template' }] },
        { Authorization: 'Bearer token-admin' }
      );
      assert.strictEqual(adminPostGlobal.status, 200);
      assert.strictEqual(readDb().routinesByDay?.monday?.[0]?.id, 'mon-admin-global');

      // Admin targeted update for Student 1 does NOT overwrite global template
      const adminPostStudent1 = await makeRequest(
        server,
        'POST',
        '/api/routines',
        {
          studentEmail: STUDENT_1_EMAIL,
          routinesByDay: {
            monday: [{ id: 'mon-admin-s1', time: '10:00', activityName: 'Admin Tailored for S1' }],
          },
        },
        { Authorization: 'Bearer token-admin' }
      );
      assert.strictEqual(adminPostStudent1.status, 200);
      assert.strictEqual(readDb().routinesByDay?.monday?.[0]?.id, 'mon-admin-global', 'Template global preservado após update direcionado do ADM');

      const adminGetStudent1 = await makeRequest(server, 'GET', `/api/routines?studentUid=${STUDENT_1_UID}`, undefined, {
        Authorization: 'Bearer token-admin',
      });
      assert.strictEqual(adminGetStudent1.status, 200);
      assert.strictEqual(adminGetStudent1.data?.monday?.[0]?.id, 'mon-admin-s1');

      // Invalid payload -> 400
      const invalidPayload1 = await makeRequest(server, 'POST', '/api/routines', {}, { Authorization: 'Bearer token-admin' });
      assert.strictEqual(invalidPayload1.status, 400);

      const invalidPayload2 = await makeRequest(
        server,
        'POST',
        '/api/routines',
        { monday: 'not-an-array' },
        { Authorization: 'Bearer token-admin' }
      );
      assert.strictEqual(invalidPayload2.status, 400);

      // Non-student target -> 403; non-canonical target -> 422
      const targetTeacher = await makeRequest(server, 'GET', `/api/routines?studentUid=${TEACHER_A_UID}`, undefined, {
        Authorization: 'Bearer token-admin',
      });
      assert.strictEqual(targetTeacher.status, 403);

      const targetSynthetic = await makeRequest(server, 'GET', '/api/routines?studentUid=usr-bad-id', undefined, {
        Authorization: 'Bearer token-admin',
      });
      assert.strictEqual(targetSynthetic.status, 422);
    });

    // 6. Compatibility & Consumer Verification
    await test('6. Compatibilidade funcional com /api/student-routines, /api/routines/daily-video e contrato seguro em src/App.tsx', async () => {
      seedBaseline(mockFs);

      // Student 1 assigns daily video via /api/routines/daily-video (persists in Firestore default)
      const saveDailyVideo = await makeRequest(
        server,
        'POST',
        '/api/routines/daily-video',
        {
          studentUid: STUDENT_1_UID,
          day: 'tuesday',
          videoId: 'M7lc1UVf-VE',
          videoTitle: 'Tuesday Practice Video',
          weeklyCycle: 1,
        },
        { Authorization: 'Bearer token-student-1' }
      );
      assert.strictEqual(saveDailyVideo.status, 200);

      // Verify /api/student-routines returns the canonical video
      const studentRoutinesRes = await makeRequest(
        server,
        'GET',
        `/api/student-routines?uid=${STUDENT_1_UID}`,
        undefined,
        { Authorization: 'Bearer token-student-1' }
      );
      assert.strictEqual(studentRoutinesRes.status, 200);
      assert.strictEqual(studentRoutinesRes.data?.tuesday?.[0]?.teacherVideos?.[0]?.videoId, 'M7lc1UVf-VE');

      // Verify /api/routines also sees canonical Firestore update seamlessly
      const s1GetAfterVideo = await makeRequest(server, 'GET', '/api/routines', undefined, {
        Authorization: 'Bearer token-student-1',
      });
      assert.strictEqual(s1GetAfterVideo.status, 200);
      assert.strictEqual(s1GetAfterVideo.data?.tuesday?.[0]?.teacherVideos?.[0]?.videoId, 'M7lc1UVf-VE');

      // Static consumer audit on src/App.tsx
      const appSource = fs.readFileSync(path.join(process.cwd(), 'src/App.tsx'), 'utf-8');
      assert.ok(
        appSource.includes("tutorToken ? fetch('/api/routines', { headers: tutorHeaders })"),
        'src/App.tsx só consulta /api/routines com tutorToken e Authorization Bearer'
      );
      assert.ok(
        appSource.includes('activeRoutinesHydrationUidRef.current !== initialAuthUid'),
        'src/App.tsx protege setRoutinesByDay contra race condition de troca de sessão'
      );
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    resetFirebaseAdminForTesting();
    resetFirebaseAdminFirestoreForTesting();
    resetInMemoryDbForTesting();
    resetResidualCachesForTesting();
  }

  console.log(`\nResumo SEC.FIX.6: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('Fatal error in validate-sec-fix-6:', err);
  process.exit(1);
});
