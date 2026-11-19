/**
 * SEC.FIX.4 — Proteção de GET/POST /api/meet-settings e /api/teacher-settings
 *
 * Valida:
 * 1. Bloqueio estrito (HTTP 401) para acessos anônimos, cabeçalhos malformados e tokens inválidos/expirados em GET e POST.
 * 2. Autorização por RBAC canônico e titularidade:
 *    - ADM autenticado e canônico acessa listagem filtrada e configurações específicas e pode atualizar configurações.
 *    - Professor aprovado e professor pendente (fluxo BecomeTutorModal) podem consultar e atualizar EXCLUSIVAMENTE suas próprias configurações.
 *    - Bloqueio (HTTP 403) para professor tentando ler/alterar configurações de terceiros ou de ADM, e para contas rejeitadas ou em conflito.
 *    - Aluno autenticado não pode alterar configurações (HTTP 403 em POST), só pode ler configurações do Amigo Nativo canonicamente vinculado (ou aula ativa), e recebe HTTP 403 para professores não vinculados.
 * 3. Preservação integral de links do Meet, disponibilidade, agendamentos, trial, troca de Native Friend e contratos dos consumidores.
 * 4. Verificação de leitura estritamente read-only e filtragem de tutores excluídos.
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

function createMockFirestore() {
  const store = new Map<string, Record<string, any>>();
  const writeLog: Array<{ op: 'set' | 'update' | 'delete'; path: string }> = [];

  const makeDocRef = (col: string, id: string): any => {
    const key = `${col}::${id}`;
    return {
      id,
      path: `${col}/${id}`,
      get: async () => {
        const val = store.get(key);
        return {
          id,
          exists: Boolean(val),
          ref: makeDocRef(col, id),
          data: () => (val ? JSON.parse(JSON.stringify(val)) : undefined),
        };
      },
      set: async (data: Record<string, any>, opts?: { merge?: boolean }) => {
        writeLog.push({ op: 'set', path: `${col}/${id}` });
        const prev = opts?.merge ? store.get(key) || {} : {};
        store.set(key, JSON.parse(JSON.stringify({ ...prev, ...data })));
        return { writeTime: new Date() };
      },
      update: async (data: Record<string, any>) => {
        writeLog.push({ op: 'update', path: `${col}/${id}` });
        const prev = store.get(key) || {};
        store.set(key, JSON.parse(JSON.stringify({ ...prev, ...data })));
        return { writeTime: new Date() };
      },
      delete: async () => {
        writeLog.push({ op: 'delete', path: `${col}/${id}` });
        store.delete(key);
        return { writeTime: new Date() };
      },
      collection: (sub: string) => ({
        doc: (subId: string) => makeDocRef(`${col}/${id}/${sub}`, subId),
        get: async () => ({ empty: true, docs: [], size: 0, forEach: () => {} }),
      }),
    };
  };

  const makeQuery = (col: string, filters: Array<{ field: string; value: any }>) => ({
    where: (field: string, _op: string, value: any) => makeQuery(col, [...filters, { field, value }]),
    limit: () => makeQuery(col, filters),
    get: async () => {
      const docs: any[] = [];
      for (const [k, v] of store.entries()) {
        if (!k.startsWith(`${col}::`)) continue;
        const matchesAll = filters.every((f) => v?.[f.field] === f.value);
        if (matchesAll) {
          const id = k.split('::')[1];
          docs.push({ id, exists: true, ref: makeDocRef(col, id), data: () => JSON.parse(JSON.stringify(v)) });
        }
      }
      return { empty: docs.length === 0, size: docs.length, docs, forEach: (cb: any) => docs.forEach(cb) };
    },
  });

  return {
    projectId: 'itissimple-security-staging',
    databaseId: '(default)',
    collection: (col: string) => ({
      doc: (id: string) => makeDocRef(col, id),
      where: (field: string, _op: string, value: any) => makeQuery(col, [{ field, value }]),
      get: async () => {
        const docs: any[] = [];
        for (const [k, v] of store.entries()) {
          if (k.startsWith(`${col}::`)) {
            const id = k.split('::')[1];
            docs.push({ id, exists: true, ref: makeDocRef(col, id), data: () => JSON.parse(JSON.stringify(v)) });
          }
        }
        return { empty: docs.length === 0, size: docs.length, docs, forEach: (cb: any) => docs.forEach(cb) };
      },
    }),
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
      store.set(`${col}::${id}`, JSON.parse(JSON.stringify(data)));
    },
    _getDoc: (col: string, id: string) => {
      const v = store.get(`${col}::${id}`);
      return v ? JSON.parse(JSON.stringify(v)) : undefined;
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

const ADMIN_UID = 'adminCanonicalUid1234567890';
const ADMIN_EMAIL = 'admin.secfix4@itissimple.com';

const TEACHER_A_UID = 'teacherACanonicalUid1234567';
const TEACHER_A_EMAIL = 'teacher.a@itissimple.com';

const TEACHER_B_UID = 'teacherBCanonicalUid1234567';
const TEACHER_B_EMAIL = 'teacher.b@itissimple.com';

const PENDING_TEACHER_UID = 'pendingTeacherUid1234567890';
const PENDING_TEACHER_EMAIL = 'pending.tutor@itissimple.com';

const REJECTED_TEACHER_UID = 'rejectedTeacherUid123456789';
const REJECTED_TEACHER_EMAIL = 'rejected.tutor@itissimple.com';

const STUDENT_LINKED_UID = 'studentLinkedUid12345678901';
const STUDENT_LINKED_EMAIL = 'student.linked@itissimple.com';

const STUDENT_UNLINKED_UID = 'studentUnlinkedUid123456789';
const STUDENT_UNLINKED_EMAIL = 'student.unlinked@itissimple.com';

const CONFLICT_ADMIN_UID = 'conflictAdminUid12345678901';
const CONFLICT_ADMIN_EMAIL = 'conflict.admin@itissimple.com';

const SPOOFED_TEACHER_CLAIM_STUDENT_UID = 'spoofClaimStudentUid1234567';
const SPOOFED_TEACHER_CLAIM_STUDENT_EMAIL = 'spoof.student@itissimple.com';

const DELETED_TUTOR_UID = 'deletedTutorUid123456789012';
const DELETED_TUTOR_EMAIL = 'deleted.tutor@itissimple.com';

function seedBaseline(mockFs: ReturnType<typeof createMockFirestore>) {
  resetInMemoryDbForTesting();
  resetResidualCachesForTesting();
  mockFs._clearWriteLog();

  mockFs._setDoc('tutors', TEACHER_A_UID, {
    id: TEACHER_A_UID,
    uid: TEACHER_A_UID,
    authUid: TEACHER_A_UID,
    publicTutorId: 'teacher-a-slug',
    email: TEACHER_A_EMAIL,
    name: 'Teacher Alpha',
    role: 'teacher',
    approvalStatus: 'approved',
    isApproved: true,
    status: 'approved',
    approved: true,
    meetUrl: 'https://meet.google.com/alpha-private-room',
    meetLink: 'https://meet.google.com/alpha-private-room',
    timezone: 'America/Toronto',
    availableDays: ['monday', 'wednesday'],
    availability: { monday: ['09:00', '10:00'] },
    availableHoursByDay: { monday: ['09:00', '10:00'] },
  });

  mockFs._setDoc('tutors', TEACHER_B_UID, {
    id: TEACHER_B_UID,
    uid: TEACHER_B_UID,
    authUid: TEACHER_B_UID,
    publicTutorId: 'teacher-b-slug',
    email: TEACHER_B_EMAIL,
    name: 'Teacher Beta',
    role: 'teacher',
    approvalStatus: 'approved',
    isApproved: true,
    status: 'approved',
    approved: true,
    meetUrl: 'https://meet.google.com/beta-secret-room',
    meetLink: 'https://meet.google.com/beta-secret-room',
    timezone: 'America/New_York',
    availableDays: ['tuesday', 'thursday'],
    availability: { tuesday: ['14:00', '15:00'] },
    availableHoursByDay: { tuesday: ['14:00', '15:00'] },
  });

  mockFs._setDoc('tutors', PENDING_TEACHER_UID, {
    id: PENDING_TEACHER_UID,
    uid: PENDING_TEACHER_UID,
    authUid: PENDING_TEACHER_UID,
    publicTutorId: 'pending-tutor-slug',
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

  mockFs._setDoc('users', STUDENT_UNLINKED_UID, {
    id: STUDENT_UNLINKED_UID,
    uid: STUDENT_UNLINKED_UID,
    email: STUDENT_UNLINKED_EMAIL,
    name: 'Unlinked Student',
    role: 'student',
    enrollmentStatus: 'not_enrolled',
  });

  mockFs._setDoc('users', CONFLICT_ADMIN_UID, {
    id: CONFLICT_ADMIN_UID,
    uid: CONFLICT_ADMIN_UID,
    email: CONFLICT_ADMIN_EMAIL,
    name: 'Conflict Admin Claim User',
    role: 'student',
  });

  mockFs._setDoc('users', SPOOFED_TEACHER_CLAIM_STUDENT_UID, {
    id: SPOOFED_TEACHER_CLAIM_STUDENT_UID,
    uid: SPOOFED_TEACHER_CLAIM_STUDENT_UID,
    email: SPOOFED_TEACHER_CLAIM_STUDENT_EMAIL,
    name: 'Student With Spoofed Teacher Claim',
    role: 'student',
  });

  const db = readDb();
  db.tutorsList = [
    mockFs._getDoc('tutors', TEACHER_A_UID),
    mockFs._getDoc('tutors', TEACHER_B_UID),
    mockFs._getDoc('tutors', PENDING_TEACHER_UID),
  ];
  db.teachers = [
    { id: ADMIN_UID, uid: ADMIN_UID, email: ADMIN_EMAIL, role: 'admin', name: 'Admin' },
    { id: TEACHER_A_UID, uid: TEACHER_A_UID, email: TEACHER_A_EMAIL, role: 'teacher', name: 'Teacher Alpha' },
    { id: TEACHER_B_UID, uid: TEACHER_B_UID, email: TEACHER_B_EMAIL, role: 'teacher', name: 'Teacher Beta' },
  ];
  db.deletedTutorEmails = [DELETED_TUTOR_EMAIL];
  db.deletedTutorIds = [DELETED_TUTOR_UID];

  const entryA = {
    teacherEmail: TEACHER_A_EMAIL,
    uid: TEACHER_A_UID,
    meetLink: 'https://meet.google.com/alpha-private-room',
    timezone: 'America/Toronto',
    availableDays: ['monday', 'wednesday'],
    availability: { monday: ['09:00', '10:00'] },
    availableHoursByDay: { monday: ['09:00', '10:00'] },
  };
  const entryB = {
    teacherEmail: TEACHER_B_EMAIL,
    uid: TEACHER_B_UID,
    meetLink: 'https://meet.google.com/beta-secret-room',
    timezone: 'America/New_York',
    availableDays: ['tuesday', 'thursday'],
    availability: { tuesday: ['14:00', '15:00'] },
    availableHoursByDay: { tuesday: ['14:00', '15:00'] },
  };
  const entryDeleted = {
    teacherEmail: DELETED_TUTOR_EMAIL,
    uid: DELETED_TUTOR_UID,
    meetLink: 'https://meet.google.com/deleted-room',
  };

  db.meetSettings = {
    [TEACHER_A_EMAIL]: entryA,
    [TEACHER_A_UID]: entryA,
    [TEACHER_B_EMAIL]: entryB,
    [TEACHER_B_UID]: entryB,
    [DELETED_TUTOR_EMAIL]: entryDeleted,
    [DELETED_TUTOR_UID]: entryDeleted,
  };
  db.teacherSettings = {
    [TEACHER_A_EMAIL]: entryA,
    [TEACHER_A_UID]: entryA,
    [TEACHER_B_EMAIL]: entryB,
    [TEACHER_B_UID]: entryB,
    [DELETED_TUTOR_EMAIL]: entryDeleted,
    [DELETED_TUTOR_UID]: entryDeleted,
  };
}

async function run() {
  console.log('\n=== SEC.FIX.4: Validação de Proteção Meet & Teacher Settings ===\n');

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
        case 'token-student-linked':
          return { uid: STUDENT_LINKED_UID, email: STUDENT_LINKED_EMAIL, email_verified: true, role: 'student' };
        case 'token-student-unlinked':
          return { uid: STUDENT_UNLINKED_UID, email: STUDENT_UNLINKED_EMAIL, email_verified: true, role: 'student' };
        case 'token-conflict-admin':
          return { uid: CONFLICT_ADMIN_UID, email: CONFLICT_ADMIN_EMAIL, email_verified: true, role: 'admin' };
        case 'token-spoof-student':
          return { uid: SPOOFED_TEACHER_CLAIM_STUDENT_UID, email: SPOOFED_TEACHER_CLAIM_STUDENT_EMAIL, email_verified: true, role: 'teacher' };
        case 'token-expired': {
          const e: any = new Error('Token expired');
          e.code = 'auth/id-token-expired';
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
    // 1. Anonymous / Invalid Auth
    await test('1. Acessos anônimos, malformados ou inválidos em GET/POST /api/meet-settings e /api/teacher-settings retornam 401 sem mutação', async () => {
      seedBaseline(mockFs);
      const beforeLink = readDb().meetSettings[TEACHER_A_EMAIL].meetLink;

      for (const endpoint of ['/api/meet-settings', '/api/teacher-settings']) {
        const anonList = await makeRequest(server, 'GET', endpoint);
        assert.strictEqual(anonList.status, 401, `${endpoint} anon GET list -> 401`);

        const anonSpecific = await makeRequest(server, 'GET', `${endpoint}?teacherEmail=${encodeURIComponent(TEACHER_A_EMAIL)}`);
        assert.strictEqual(anonSpecific.status, 401, `${endpoint} anon GET specific -> 401`);
        assert.strictEqual(JSON.stringify(anonSpecific.data).includes('alpha-private-room'), false);

        const badHeader = await makeRequest(server, 'GET', endpoint, undefined, { Authorization: 'Basic invalid' });
        assert.strictEqual(badHeader.status, 401, `${endpoint} malformed header -> 401`);

        const expiredToken = await makeRequest(server, 'GET', endpoint, undefined, { Authorization: 'Bearer token-expired' });
        assert.strictEqual(expiredToken.status, 401, `${endpoint} expired token -> 401`);

        const anonPost = await makeRequest(server, 'POST', endpoint, {
          teacherEmail: TEACHER_A_EMAIL,
          uid: TEACHER_A_UID,
          meetLink: 'https://meet.google.com/hijacked',
        });
        assert.strictEqual(anonPost.status, 401, `${endpoint} anon POST -> 401`);

        const invalidPost = await makeRequest(
          server,
          'POST',
          endpoint,
          { teacherEmail: TEACHER_A_EMAIL, meetLink: 'https://meet.google.com/hijacked' },
          { Authorization: 'Bearer bad-token' }
        );
        assert.strictEqual(invalidPost.status, 401, `${endpoint} invalid token POST -> 401`);
      }

      assert.strictEqual(readDb().meetSettings[TEACHER_A_EMAIL].meetLink, beforeLink, 'Nenhuma mutação após bloqueios 401');
      assert.strictEqual(mockFs._writeLog.length, 0, 'Zero escritas no Firestore após bloqueios 401');
    });

    // 2. Admin RBAC & Filtering
    await test('2. ADM verificado acessa GET (filtrado contra excluídos, read-only) e atualiza configurações via POST', async () => {
      seedBaseline(mockFs);

      const listRes = await makeRequest(server, 'GET', '/api/teacher-settings', undefined, {
        Authorization: 'Bearer token-admin',
      });
      assert.strictEqual(listRes.status, 200);
      assert.strictEqual(listRes.data[TEACHER_A_EMAIL]?.meetLink, 'https://meet.google.com/alpha-private-room');
      assert.strictEqual(listRes.data[TEACHER_B_EMAIL]?.meetLink, 'https://meet.google.com/beta-secret-room');
      assert.strictEqual(listRes.data[DELETED_TUTOR_EMAIL], undefined, 'Tutor excluído filtrado');
      assert.strictEqual(listRes.data[DELETED_TUTOR_UID], undefined, 'UID excluído filtrado');
      assert.strictEqual(mockFs._writeLog.length, 0, 'GET é estritamente read-only');

      const specificRes = await makeRequest(
        server,
        'GET',
        `/api/meet-settings?teacherEmail=${encodeURIComponent(TEACHER_B_EMAIL)}`,
        undefined,
        { Authorization: 'Bearer token-admin' }
      );
      assert.strictEqual(specificRes.status, 200);
      assert.strictEqual(specificRes.data.meetLink, 'https://meet.google.com/beta-secret-room');

      const updateRes = await makeRequest(
        server,
        'POST',
        '/api/teacher-settings',
        {
          teacherEmail: TEACHER_B_EMAIL,
          meetLink: 'https://meet.google.com/beta-admin-updated',
          timezone: 'America/Sao_Paulo',
          availableDays: ['monday', 'friday'],
          availability: { monday: ['11:00'] },
        },
        { Authorization: 'Bearer token-admin' }
      );
      assert.strictEqual(updateRes.status, 200);
      assert.strictEqual(updateRes.data.success, true);
      assert.strictEqual(readDb().meetSettings[TEACHER_B_EMAIL].meetLink, 'https://meet.google.com/beta-admin-updated');
      assert.strictEqual(readDb().meetSettings[TEACHER_B_UID].meetLink, 'https://meet.google.com/beta-admin-updated');
      const fsAvail = mockFs._getDoc('teacher_availability', TEACHER_B_UID);
      assert.strictEqual(fsAvail?.meetLink, 'https://meet.google.com/beta-admin-updated');

      const conflictRes = await makeRequest(server, 'GET', '/api/teacher-settings', undefined, {
        Authorization: 'Bearer token-conflict-admin',
      });
      assert.strictEqual(conflictRes.status, 403, 'Claim admin em conta student retorna 403');
    });

    // 3. Approved Teacher Ownership & Cross-Teacher Isolation
    await test('3. Professor aprovado lê/atualiza apenas os próprios dados, sem vazamento cruzado e com 403 contra terceiros/ADM', async () => {
      seedBaseline(mockFs);

      // 3a. Listagem sem query retorna somente o próprio professor
      const ownList = await makeRequest(server, 'GET', '/api/teacher-settings', undefined, {
        Authorization: 'Bearer token-teacher-a',
      });
      assert.strictEqual(ownList.status, 200);
      assert.strictEqual(ownList.data[TEACHER_A_EMAIL]?.meetLink, 'https://meet.google.com/alpha-private-room');
      assert.strictEqual(ownList.data[TEACHER_B_EMAIL], undefined, 'Professor A não recebe Teacher B na listagem');
      assert.strictEqual(ownList.data[TEACHER_B_UID], undefined, 'Professor A não recebe UID de Teacher B');

      // 3b. Leitura específica própria -> 200
      const ownSpecific = await makeRequest(
        server,
        'GET',
        `/api/meet-settings?teacherEmail=${encodeURIComponent(TEACHER_A_EMAIL)}&uid=${encodeURIComponent(TEACHER_A_UID)}`,
        undefined,
        { Authorization: 'Bearer token-teacher-a' }
      );
      assert.strictEqual(ownSpecific.status, 200);
      assert.strictEqual(ownSpecific.data.meetLink, 'https://meet.google.com/alpha-private-room');

      // 3c. Leitura específica de terceiro -> 403
      const otherByEmail = await makeRequest(
        server,
        'GET',
        `/api/teacher-settings?teacherEmail=${encodeURIComponent(TEACHER_B_EMAIL)}`,
        undefined,
        { Authorization: 'Bearer token-teacher-a' }
      );
      assert.strictEqual(otherByEmail.status, 403);

      const otherByUid = await makeRequest(
        server,
        'GET',
        `/api/meet-settings?uid=${encodeURIComponent(TEACHER_B_UID)}`,
        undefined,
        { Authorization: 'Bearer token-teacher-a' }
      );
      assert.strictEqual(otherByUid.status, 403);

      // 3d. POST próprio -> 200 e sem vazamento de Teacher B na resposta; campos privilegiados removidos
      const ownPost = await makeRequest(
        server,
        'POST',
        '/api/teacher-settings',
        {
          teacherEmail: TEACHER_A_EMAIL,
          uid: TEACHER_A_UID,
          meetLink: 'https://meet.google.com/alpha-updated-room',
          availableDays: ['monday', 'tuesday'],
          availability: { monday: ['08:00', '09:00'] },
          role: 'admin',
          adminCommissionPercent: 99,
        },
        { Authorization: 'Bearer token-teacher-a' }
      );
      assert.strictEqual(ownPost.status, 200);
      assert.strictEqual(ownPost.data.settings.meetLink, 'https://meet.google.com/alpha-updated-room');
      assert.strictEqual(ownPost.data.settings.role, undefined, 'Campo role é removido da entrada');
      assert.strictEqual(ownPost.data.settings.adminCommissionPercent, undefined, 'Campo comissão é removido');
      assert.strictEqual(ownPost.data.meetSettings[TEACHER_B_EMAIL], undefined, 'POST não vaza meetSettings de terceiros');
      assert.strictEqual(ownPost.data.teacherSettings[TEACHER_B_EMAIL], undefined, 'POST não vaza teacherSettings de terceiros');
      assert.strictEqual(mockFs._getDoc('teacher_availability', TEACHER_A_UID)?.meetLink, 'https://meet.google.com/alpha-updated-room');

      // 3e. POST tentando alterar Teacher B (por email ou uid) -> 403 e sem mutação
      const attackEmail = await makeRequest(
        server,
        'POST',
        '/api/meet-settings',
        { teacherEmail: TEACHER_B_EMAIL, meetLink: 'https://meet.google.com/pwned' },
        { Authorization: 'Bearer token-teacher-a' }
      );
      assert.strictEqual(attackEmail.status, 403);

      const attackUid = await makeRequest(
        server,
        'POST',
        '/api/teacher-settings',
        { teacherEmail: TEACHER_A_EMAIL, uid: TEACHER_B_UID, meetLink: 'https://meet.google.com/pwned' },
        { Authorization: 'Bearer token-teacher-a' }
      );
      assert.strictEqual(attackUid.status, 403);

      const attackAdmin = await makeRequest(
        server,
        'POST',
        '/api/teacher-settings',
        { teacherEmail: ADMIN_EMAIL, meetLink: 'https://meet.google.com/pwned-admin' },
        { Authorization: 'Bearer token-teacher-a' }
      );
      assert.strictEqual(attackAdmin.status, 403);

      assert.strictEqual(readDb().meetSettings[TEACHER_B_EMAIL].meetLink, 'https://meet.google.com/beta-secret-room');
      assert.strictEqual(readDb().meetSettings[TEACHER_B_UID].meetLink, 'https://meet.google.com/beta-secret-room');
    });

    // 4. Pending Teacher (BecomeTutorModal flow) & Rejected Teacher
    await test('4. Professor pendente (fluxo BecomeTutorModal) salva próprias configurações (200); professor rejeitado é bloqueado (403)', async () => {
      seedBaseline(mockFs);

      const pendingPost = await makeRequest(
        server,
        'POST',
        '/api/meet-settings',
        {
          teacherEmail: PENDING_TEACHER_EMAIL,
          uid: PENDING_TEACHER_UID,
          settings: {
            meetLink: 'https://meet.google.com/pending-own-room',
            workingHoursStart: '08:00',
            workingHoursEnd: '18:00',
            slotDurationMinutes: 30,
            availableDays: ['monday', 'friday'],
            timezone: 'America/Toronto',
          },
        },
        { Authorization: 'Bearer token-pending-teacher' }
      );
      assert.strictEqual(pendingPost.status, 200);
      assert.strictEqual(pendingPost.data.settings.meetLink, 'https://meet.google.com/pending-own-room');
      assert.strictEqual(mockFs._getDoc('teacher_availability', PENDING_TEACHER_UID)?.meetLink, 'https://meet.google.com/pending-own-room');

      const pendingAttackOther = await makeRequest(
        server,
        'POST',
        '/api/meet-settings',
        { teacherEmail: TEACHER_A_EMAIL, settings: { meetLink: 'https://meet.google.com/hack' } },
        { Authorization: 'Bearer token-pending-teacher' }
      );
      assert.strictEqual(pendingAttackOther.status, 403);

      const rejectedGet = await makeRequest(
        server,
        'GET',
        `/api/teacher-settings?teacherEmail=${encodeURIComponent(REJECTED_TEACHER_EMAIL)}`,
        undefined,
        { Authorization: 'Bearer token-rejected-teacher' }
      );
      assert.strictEqual(rejectedGet.status, 403);

      const rejectedPost = await makeRequest(
        server,
        'POST',
        '/api/meet-settings',
        { teacherEmail: REJECTED_TEACHER_EMAIL, meetLink: 'https://meet.google.com/rejected-room' },
        { Authorization: 'Bearer token-rejected-teacher' }
      );
      assert.strictEqual(rejectedPost.status, 403);
    });

    // 5. Student RBAC, Linked Native Friend Access, Switch Native Friend, Active Lesson vs Cancelled, Anti-Spoof
    await test('5. Aluno lê apenas Native Friend canonicamente vinculado (ou aula ativa), recebe 403 para terceiros e 403 em qualquer POST', async () => {
      seedBaseline(mockFs);

      // 5a. Linked student GET list -> only Teacher A
      const linkedList = await makeRequest(server, 'GET', '/api/teacher-settings', undefined, {
        Authorization: 'Bearer token-student-linked',
      });
      assert.strictEqual(linkedList.status, 200);
      assert.strictEqual(linkedList.data[TEACHER_A_EMAIL]?.meetLink, 'https://meet.google.com/alpha-private-room');
      assert.strictEqual(linkedList.data[TEACHER_B_EMAIL], undefined, 'Aluno vinculado não recebe Teacher B');

      // 5b. Linked student GET specific Teacher A -> 200; Teacher B -> 403
      const linkedSpecA = await makeRequest(
        server,
        'GET',
        `/api/meet-settings?teacherEmail=${encodeURIComponent(TEACHER_A_EMAIL)}`,
        undefined,
        { Authorization: 'Bearer token-student-linked' }
      );
      assert.strictEqual(linkedSpecA.status, 200);
      assert.strictEqual(linkedSpecA.data.meetLink, 'https://meet.google.com/alpha-private-room');

      const linkedSpecB = await makeRequest(
        server,
        'GET',
        `/api/meet-settings?teacherEmail=${encodeURIComponent(TEACHER_B_EMAIL)}`,
        undefined,
        { Authorization: 'Bearer token-student-linked' }
      );
      assert.strictEqual(linkedSpecB.status, 403, 'Aluno não pode consultar teacher B não vinculado');

      // 5c. Unlinked student GET list -> {}, GET specific -> 403
      const unlinkedList = await makeRequest(server, 'GET', '/api/teacher-settings', undefined, {
        Authorization: 'Bearer token-student-unlinked',
      });
      assert.strictEqual(unlinkedList.status, 200);
      assert.deepStrictEqual(unlinkedList.data, {}, 'Aluno sem vínculo recebe mapa vazio');

      const unlinkedSpecA = await makeRequest(
        server,
        'GET',
        `/api/teacher-settings?teacherEmail=${encodeURIComponent(TEACHER_A_EMAIL)}`,
        undefined,
        { Authorization: 'Bearer token-student-unlinked' }
      );
      assert.strictEqual(unlinkedSpecA.status, 403);

      // 5d. Student POST -> 403 (inclusive com claim forjada de teacher)
      for (const tok of ['token-student-linked', 'token-student-unlinked', 'token-spoof-student']) {
        const postAttempt = await makeRequest(
          server,
          'POST',
          '/api/teacher-settings',
          {
            teacherEmail: TEACHER_A_EMAIL,
            uid: TEACHER_A_UID,
            meetLink: 'https://meet.google.com/student-hijack',
          },
          { Authorization: `Bearer ${tok}` }
        );
        assert.strictEqual(postAttempt.status, 403, `${tok} POST -> 403`);
      }
      assert.strictEqual(readDb().meetSettings[TEACHER_A_EMAIL].meetLink, 'https://meet.google.com/alpha-private-room');

      // 5e. Cancelled lesson with Teacher B does NOT grant access; active trial lesson with Teacher B DOES grant read access
      mockFs._setDoc('lessons', 'lesson-cancelled-b', {
        id: 'lesson-cancelled-b',
        studentUid: STUDENT_UNLINKED_UID,
        teacherUid: TEACHER_B_UID,
        teacherEmail: TEACHER_B_EMAIL,
        status: 'cancelled',
      });
      const cancelledCheck = await makeRequest(
        server,
        'GET',
        `/api/meet-settings?teacherEmail=${encodeURIComponent(TEACHER_B_EMAIL)}`,
        undefined,
        { Authorization: 'Bearer token-student-unlinked' }
      );
      assert.strictEqual(cancelledCheck.status, 403, 'Aula cancelada não concede acesso');

      mockFs._setDoc('lessons', 'lesson-active-trial-b', {
        id: 'lesson-active-trial-b',
        studentUid: STUDENT_UNLINKED_UID,
        teacherUid: TEACHER_B_UID,
        teacherEmail: TEACHER_B_EMAIL,
        status: 'scheduled',
        isTrialLesson: true,
      });
      const activeTrialCheck = await makeRequest(
        server,
        'GET',
        `/api/meet-settings?teacherEmail=${encodeURIComponent(TEACHER_B_EMAIL)}`,
        undefined,
        { Authorization: 'Bearer token-student-unlinked' }
      );
      assert.strictEqual(activeTrialCheck.status, 200, 'Aula trial ativa preserva leitura de disponibilidade/Meet do tutor da aula');
      assert.strictEqual(activeTrialCheck.data.meetLink, 'https://meet.google.com/beta-secret-room');

      // 5f. Switch Native Friend (Teacher A -> Teacher B): linked student switches access from A to B
      mockFs._setDoc('users', STUDENT_LINKED_UID, {
        id: STUDENT_LINKED_UID,
        uid: STUDENT_LINKED_UID,
        email: STUDENT_LINKED_EMAIL,
        name: 'Linked Student',
        role: 'student',
        teacherUid: TEACHER_B_UID,
        assignedNativeFriendUID: TEACHER_B_UID,
        teacherEmail: TEACHER_B_EMAIL,
      });
      mockFs._setDoc('student_assignments', STUDENT_LINKED_UID, {
        uid: STUDENT_LINKED_UID,
        studentUid: STUDENT_LINKED_UID,
        email: STUDENT_LINKED_EMAIL,
        teacherUid: TEACHER_B_UID,
        assignedNativeFriendUID: TEACHER_B_UID,
        teacherEmail: TEACHER_B_EMAIL,
      });

      const afterSwitchList = await makeRequest(server, 'GET', '/api/teacher-settings', undefined, {
        Authorization: 'Bearer token-student-linked',
      });
      assert.strictEqual(afterSwitchList.status, 200);
      assert.strictEqual(afterSwitchList.data[TEACHER_B_EMAIL]?.meetLink, 'https://meet.google.com/beta-secret-room');
      assert.strictEqual(afterSwitchList.data[TEACHER_A_EMAIL], undefined, 'Após troca de Native Friend, tutor anterior deixa de estar exposto');
    });

    // 6. Compatibility: Scheduling preserves updated Meet link & consumers send Authorization headers
    await test('6. Compatibilidade: atualização de Meet preserva agendamento em /api/lessons/schedule e consumidores enviam Authorization', async () => {
      seedBaseline(mockFs);
      // Simular tutor sem meetUrl fixa em tutors/{uid}, configurando sala exclusivamente via /api/teacher-settings
      const baseTutorDoc = mockFs._getDoc('tutors', TEACHER_A_UID);
      delete baseTutorDoc.meetUrl;
      delete baseTutorDoc.meetLink;
      mockFs._setDoc('tutors', TEACHER_A_UID, baseTutorDoc);

      const postRes = await makeRequest(
        server,
        'POST',
        '/api/teacher-settings',
        {
          teacherEmail: TEACHER_A_EMAIL,
          uid: TEACHER_A_UID,
          meetLink: 'https://meet.google.com/alpha-fresh-meet-2026',
          availableDays: ['monday', 'wednesday', 'friday'],
          availability: { monday: ['09:00', '10:00'], friday: ['15:00'] },
          timezone: 'America/Toronto',
        },
        { Authorization: 'Bearer token-teacher-a' }
      );
      assert.strictEqual(postRes.status, 200);

      // Update mockFs student credit balance so scheduling succeeds
      mockFs._setDoc('users', STUDENT_LINKED_UID, {
        id: STUDENT_LINKED_UID,
        uid: STUDENT_LINKED_UID,
        email: STUDENT_LINKED_EMAIL,
        name: 'Linked Student',
        role: 'student',
        teacherUid: TEACHER_A_UID,
        assignedNativeFriendUID: TEACHER_A_UID,
        teacherEmail: TEACHER_A_EMAIL,
        availableLessons: 3,
        contractedLessons: 3,
        enrollmentStatus: 'active',
      });

      const startIso = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
      const endIso = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000 + 25 * 60 * 1000).toISOString();

      const schedRes = await makeRequest(
        server,
        'POST',
        '/api/lessons/schedule',
        {
          studentUid: STUDENT_LINKED_UID,
          studentEmail: STUDENT_LINKED_EMAIL,
          teacherUid: TEACHER_A_UID,
          teacherEmail: TEACHER_A_EMAIL,
          startDateTime: startIso,
          endDateTime: endIso,
          durationMinutes: 25,
        },
        { Authorization: 'Bearer token-student-linked' }
      );
      assert.strictEqual(schedRes.status, 200, `Expected 200 scheduling lesson, got ${schedRes.status}: ${JSON.stringify(schedRes.data)}`);
      assert.strictEqual(schedRes.data?.lesson?.meetLink, 'https://meet.google.com/alpha-fresh-meet-2026');

      // Static verification of consumers
      const appSource = fs.readFileSync(path.join(process.cwd(), 'src/App.tsx'), 'utf-8');
      assert.ok(
        appSource.includes("tutorToken ? fetch('/api/teacher-settings', { headers: tutorHeaders })"),
        'App.tsx loadInitialData envia Authorization em /api/teacher-settings apenas com token'
      );
      assert.ok(
        appSource.includes("headers: { Authorization: `Bearer ${teacherToken}` }"),
        'App.tsx role === teacher envia Authorization em /api/teacher-settings'
      );
      assert.ok(
        appSource.includes("studentToken ? fetch('/api/teacher-settings', { headers: profileHeaders })"),
        'App.tsx role === student envia Authorization em /api/teacher-settings'
      );
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    resetFirebaseAdminForTesting();
    resetFirebaseAdminFirestoreForTesting();
    resetInMemoryDbForTesting();
    resetResidualCachesForTesting();
  }

  console.log(`\nResumo SEC.FIX.4: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('Fatal error in validate-sec-fix-4:', err);
  process.exit(1);
});
