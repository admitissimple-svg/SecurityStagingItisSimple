/**
 * SEC.FIX.5A — Persistência Canônica do Chat no Firestore (default)
 *
 * Valida:
 * 1. Persistência canônica exclusivamente no Firestore (default) (coleção direct_messages):
 *    - POST grava em direct_messages, mantém inMemoryDb.chatMessages vazio e não escreve em app_state.
 *    - Campos read/readAt/readByUid enviados pelo cliente no POST são ignorados (criação nasce read=false).
 *    - Reenvio pelo autor preserva createdAt e estado read existente.
 * 2. Sobrevivência ao reinício do servidor:
 *    - Após resetInMemoryDbForTesting() + resetResidualCachesForTesting() + initCloudPersistence() + clearDirectMessagesMemoryCache(),
 *      GET /api/chat-messages retorna todas as mensagens persistidas em ordem cronológica.
 * 3. Marcação de leitura via backend autenticado (PATCH /api/chat-messages):
 *    - Destinatário legítimo (aluno lendo msg do professor/admin; professor lendo msg do aluno) marca read=true com readAt/readByUid e sobrevive ao reinício.
 *    - Bloqueio 401 (anônimo, cabeçalho inválido, token inválido/expirado).
 *    - Bloqueio 403 (remetente tentando marcar própria mensagem, conversa de terceiros, vínculo revogado após troca A->B, pendente/rejeitado/spoof/não cadastrado).
 *    - Bloqueio 404 para ID inexistente sem mutação parcial em lotes mistos.
 *    - Bloqueio 400 para payload vazio ou ID inválido.
 * 4. Fail-closed HTTP 503 quando Firestore (default) está indisponível (sem fallback para RAM).
 * 5. Auditoria estática e execução E2E do consumidor src/utils/directMessages.ts:
 *    - Zero import/escrita/leitura direta via Firebase Client SDK (firebase/firestore).
 *    - subscribeDirectMessages, sendDirectMessage e markDirectMessagesAsRead operam 100% via /api/chat-messages e atualizam listeners sem cachear falhas.
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
  initCloudPersistence,
  readDb,
  resetInMemoryDbForTesting,
  resetResidualCachesForTesting,
} from '../serverApp';
import { setFirebaseAdminAuthForTesting, resetFirebaseAdminForTesting } from '../src/serverFirebaseAdmin';
import {
  setFirebaseAdminFirestoreForTesting,
  resetFirebaseAdminFirestoreForTesting,
} from '../src/serverFirestore';
import { auth as clientAuth } from '../src/firebase';
import {
  clearDirectMessagesMemoryCache,
  markDirectMessagesAsRead,
  sendDirectMessage,
  subscribeDirectMessages,
} from '../src/utils/directMessages';
import type { DirectMessage } from '../src/types';

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

function createPersistentMockFirestore() {
  // Simulates durable Cloud Firestore (default) storage that survives server restarts
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
        if (!store.has(key)) {
          const err: any = new Error(`NOT_FOUND: ${col}/${id}`);
          err.code = 5;
          throw err;
        }
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
    _setDoc: (col: string, id: string, data: Record<string, any>) => {
      store.set(`${col}::${id}`, JSON.parse(JSON.stringify(data)));
    },
    _deleteDoc: (col: string, id: string) => {
      store.delete(`${col}::${id}`);
    },
    _getDoc: (col: string, id: string) => {
      const val = store.get(`${col}::${id}`);
      return val ? JSON.parse(JSON.stringify(val)) : null;
    },
    _getCollectionDocs: (col: string) => {
      const docs: Record<string, any>[] = [];
      for (const [k, v] of store.entries()) {
        if (k.startsWith(`${col}::`)) {
          docs.push(JSON.parse(JSON.stringify(v)));
        }
      }
      return docs;
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

const ADMIN_UID = 'adminUid5aCanonical12345678';
const ADMIN_EMAIL = 'admin.5a@itissimple.com';

const TEACHER_A_UID = 'teacherAUid5aCanonical12345';
const TEACHER_A_EMAIL = 'teacher.a.5a@itissimple.com';

const TEACHER_B_UID = 'teacherBUid5aCanonical12345';
const TEACHER_B_EMAIL = 'teacher.b.5a@itissimple.com';

const PENDING_TEACHER_UID = 'pendingTeacher5aUid12345678';
const PENDING_TEACHER_EMAIL = 'pending.5a@itissimple.com';

const STUDENT_1_UID = 'student1Uid5aCanonical12345';
const STUDENT_1_EMAIL = 'student1.5a@itissimple.com';

const STUDENT_2_UID = 'student2Uid5aCanonical12345';
const STUDENT_2_EMAIL = 'student2.5a@itissimple.com';

const UNREGISTERED_UID = 'unregistered5aUid1234567890';
const UNREGISTERED_EMAIL = 'unregistered.5a@itissimple.com';

function seedWorld(mockFs: ReturnType<typeof createPersistentMockFirestore>) {
  mockFs._clearAll();
  resetInMemoryDbForTesting();
  resetResidualCachesForTesting();
  clearDirectMessagesMemoryCache();

  mockFs._setDoc('tutors', TEACHER_A_UID, {
    id: TEACHER_A_UID,
    uid: TEACHER_A_UID,
    authUid: TEACHER_A_UID,
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
  });
  mockFs._setDoc('student_assignments', STUDENT_1_UID, {
    uid: STUDENT_1_UID,
    studentUid: STUDENT_1_UID,
    email: STUDENT_1_EMAIL,
    teacherUid: TEACHER_A_UID,
    assignedNativeFriendUID: TEACHER_A_UID,
    teacherEmail: TEACHER_A_EMAIL,
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
  });
  mockFs._setDoc('student_assignments', STUDENT_2_UID, {
    uid: STUDENT_2_UID,
    studentUid: STUDENT_2_UID,
    email: STUDENT_2_EMAIL,
    teacherUid: TEACHER_B_UID,
    assignedNativeFriendUID: TEACHER_B_UID,
    teacherEmail: TEACHER_B_EMAIL,
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
}

async function simulateServerRestart(mockFs: ReturnType<typeof createPersistentMockFirestore>) {
  // Wipe all volatile server RAM & residual caches + client in-memory DM cache
  resetInMemoryDbForTesting();
  resetResidualCachesForTesting();
  clearDirectMessagesMemoryCache();
  await initCloudPersistence();
  // Ensure tutorsList/teachers fallback matches restarted process reading from Firestore tutors collection
  const db = readDb();
  db.teachers = [{ id: ADMIN_UID, uid: ADMIN_UID, email: ADMIN_EMAIL, role: 'admin', name: 'Admin' }, ...(db.tutorsList || [])];
  assert.strictEqual(readDb().chatMessages.length, 0, 'Após reinício, RAM chatMessages deve permanecer vazia');
  void mockFs;
}

async function run() {
  console.log('\n=== SEC.FIX.5A: Validação de Persistência Canônica do Chat ===\n');

  const mockFs = createPersistentMockFirestore();
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
        case 'tok-pending':
          return { uid: PENDING_TEACHER_UID, email: PENDING_TEACHER_EMAIL, email_verified: true, role: 'student' };
        case 'tok-student-1':
          return { uid: STUDENT_1_UID, email: STUDENT_1_EMAIL, email_verified: true, role: 'student' };
        case 'tok-student-2':
          return { uid: STUDENT_2_UID, email: STUDENT_2_EMAIL, email_verified: true, role: 'student' };
        case 'tok-unregistered':
          return { uid: UNREGISTERED_UID, email: UNREGISTERED_EMAIL, email_verified: true, role: 'student' };
        case 'tok-expired': {
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
    // 1. Canonical Firestore persistence & zero RAM / app_state writes
    await test('1. POST persiste exclusivamente em direct_messages no Firestore (default), ignora read do cliente e mantém RAM vazia', async () => {
      seedWorld(mockFs);
      mockFs._clearWriteLog();

      // Client tries to spoof read: true upon creation
      const res1 = await makeRequest(
        server,
        'POST',
        '/api/chat-messages',
        {
          message: {
            id: 'msg-5a-1',
            studentUid: STUDENT_1_UID,
            studentEmail: STUDENT_1_EMAIL,
            nativeFriendUid: TEACHER_A_UID,
            nativeFriendEmail: TEACHER_A_EMAIL,
            senderUid: STUDENT_1_UID,
            senderRole: 'student',
            recipientUid: TEACHER_A_UID,
            text: 'First persistent message',
            createdAt: '2026-11-19T08:00:00.000Z',
            read: true,
            readByUid: 'spoof-uid',
          },
        },
        { Authorization: 'Bearer tok-student-1' }
      );
      assert.strictEqual(res1.status, 200);
      assert.strictEqual(res1.data.message.read, false, 'Criação deve ignorar read=true enviado pelo cliente');
      assert.strictEqual(res1.data.message.readByUid, undefined, 'Criação deve descartar readByUid enviado pelo cliente');

      const res2 = await makeRequest(
        server,
        'POST',
        '/api/chat-messages',
        {
          message: {
            id: 'msg-5a-2',
            studentUid: STUDENT_1_UID,
            studentEmail: STUDENT_1_EMAIL,
            nativeFriendUid: TEACHER_A_UID,
            nativeFriendEmail: TEACHER_A_EMAIL,
            senderUid: TEACHER_A_UID,
            senderRole: 'teacher',
            recipientUid: STUDENT_1_UID,
            text: 'Teacher reply persisted',
            createdAt: '2026-11-19T08:01:00.000Z',
          },
        },
        { Authorization: 'Bearer tok-teacher-a' }
      );
      assert.strictEqual(res2.status, 200);

      // Separate conversation to verify isolation
      const res3 = await makeRequest(
        server,
        'POST',
        '/api/chat-messages',
        {
          message: {
            id: 'msg-5a-3',
            studentUid: STUDENT_2_UID,
            studentEmail: STUDENT_2_EMAIL,
            nativeFriendUid: TEACHER_B_UID,
            nativeFriendEmail: TEACHER_B_EMAIL,
            senderUid: STUDENT_2_UID,
            senderRole: 'student',
            recipientUid: TEACHER_B_UID,
            text: 'Conversation 2 private message',
            createdAt: '2026-11-19T08:02:00.000Z',
          },
        },
        { Authorization: 'Bearer tok-student-2' }
      );
      assert.strictEqual(res3.status, 200);

      assert.strictEqual(readDb().chatMessages.length, 0, 'RAM chatMessages nunca é usada como fonte de verdade');
      assert.strictEqual(mockFs._getCollectionDocs('direct_messages').length, 3, '3 docs gravados em direct_messages');
      assert.ok(
        mockFs._writeLog.some((w) => w.op === 'set' && w.path === 'direct_messages/msg-5a-1'),
        'Escrita explícita em direct_messages/msg-5a-1'
      );
      assert.strictEqual(
        mockFs._writeLog.some((w) => w.path.startsWith('app_state/')),
        false,
        'Nenhuma gravação em app_state/*'
      );
    });

    // 2. Server Restart Survival
    await test('2. Mensagens sobrevivem integralmente ao reinício simulado do servidor (RAM limpa + initCloudPersistence)', async () => {
      // Uses persisted messages from test 1, then resets RAM completely
      await simulateServerRestart(mockFs);

      const s1AfterRestart = await makeRequest(server, 'GET', '/api/chat-messages', undefined, {
        Authorization: 'Bearer tok-student-1',
      });
      assert.strictEqual(s1AfterRestart.status, 200);
      assert.deepStrictEqual(
        s1AfterRestart.data.messages.map((m: any) => m.id),
        ['msg-5a-1', 'msg-5a-2'],
        'Student 1 recupera histórico cronológico completo após reinício'
      );
      assert.strictEqual(s1AfterRestart.data.messages[0].text, 'First persistent message');
      assert.strictEqual(s1AfterRestart.data.messages[1].text, 'Teacher reply persisted');

      const taAfterRestart = await makeRequest(server, 'GET', '/api/chat-messages', undefined, {
        Authorization: 'Bearer tok-teacher-a',
      });
      assert.strictEqual(taAfterRestart.status, 200);
      assert.deepStrictEqual(
        taAfterRestart.data.messages.map((m: any) => m.id),
        ['msg-5a-1', 'msg-5a-2'],
        'Teacher A recupera histórico completo após reinício'
      );

      const s2AfterRestart = await makeRequest(server, 'GET', '/api/chat-messages', undefined, {
        Authorization: 'Bearer tok-student-2',
      });
      assert.strictEqual(s2AfterRestart.status, 200);
      assert.deepStrictEqual(
        s2AfterRestart.data.messages.map((m: any) => m.id),
        ['msg-5a-3'],
        'Isolamento preservado após reinício'
      );
    });

    // 3. Read Marking via PATCH /api/chat-messages + RBAC + Validation + Restart Survival
    await test('3. PATCH /api/chat-messages marca leitura apenas para destinatário autorizado, valida RBAC/404/400 e sobrevive ao reinício', async () => {
      // 3a. Auth 401 checks
      const patchAnon = await makeRequest(server, 'PATCH', '/api/chat-messages', { messageIds: ['msg-5a-1'] });
      assert.strictEqual(patchAnon.status, 401);
      const patchExpired = await makeRequest(
        server,
        'PATCH',
        '/api/chat-messages',
        { messageIds: ['msg-5a-1'] },
        { Authorization: 'Bearer tok-expired' }
      );
      assert.strictEqual(patchExpired.status, 401);

      // 3b. Unregistered & pending teacher -> 403
      const patchUnreg = await makeRequest(
        server,
        'PATCH',
        '/api/chat-messages',
        { messageIds: ['msg-5a-1'] },
        { Authorization: 'Bearer tok-unregistered' }
      );
      assert.strictEqual(patchUnreg.status, 403);
      const patchPending = await makeRequest(
        server,
        'PATCH',
        '/api/chat-messages',
        { messageIds: ['msg-5a-1'] },
        { Authorization: 'Bearer tok-pending' }
      );
      assert.strictEqual(patchPending.status, 403);

      // 3c. Bad inputs -> 400
      const patchEmpty = await makeRequest(
        server,
        'PATCH',
        '/api/chat-messages',
        { messageIds: [] },
        { Authorization: 'Bearer tok-student-1' }
      );
      assert.strictEqual(patchEmpty.status, 400);
      const patchInvalidId = await makeRequest(
        server,
        'PATCH',
        '/api/chat-messages',
        { messageIds: ['../bad'] },
        { Authorization: 'Bearer tok-student-1' }
      );
      assert.strictEqual(patchInvalidId.status, 400);

      // 3d. Sender CANNOT mark their own sent message as read (403)
      const selfReadStudent = await makeRequest(
        server,
        'PATCH',
        '/api/chat-messages',
        { messageIds: ['msg-5a-1'] },
        { Authorization: 'Bearer tok-student-1' }
      );
      assert.strictEqual(selfReadStudent.status, 403, 'Remetente aluno não pode marcar própria msg como lida');
      assert.strictEqual(mockFs._getDoc('direct_messages', 'msg-5a-1')?.read, false);

      const selfReadTeacher = await makeRequest(
        server,
        'PATCH',
        '/api/chat-messages',
        { messageIds: ['msg-5a-2'] },
        { Authorization: 'Bearer tok-teacher-a' }
      );
      assert.strictEqual(selfReadTeacher.status, 403, 'Remetente professor não pode marcar própria msg como lida');
      assert.strictEqual(mockFs._getDoc('direct_messages', 'msg-5a-2')?.read, false);

      // 3e. Cross-conversation isolation -> 403
      const crossConvoRead = await makeRequest(
        server,
        'PATCH',
        '/api/chat-messages',
        { messageIds: ['msg-5a-3'] },
        { Authorization: 'Bearer tok-student-1' }
      );
      assert.strictEqual(crossConvoRead.status, 403);
      assert.strictEqual(mockFs._getDoc('direct_messages', 'msg-5a-3')?.read, false);

      // 3f. Mixed batch with nonexistent ID -> 404 AND does NOT mutate valid sibling msg-5a-2
      const mixedBatch404 = await makeRequest(
        server,
        'PATCH',
        '/api/chat-messages',
        { messageIds: ['msg-5a-2', 'nonexistent-msg-999'] },
        { Authorization: 'Bearer tok-student-1' }
      );
      assert.strictEqual(mixedBatch404.status, 404);
      assert.strictEqual(mockFs._getDoc('direct_messages', 'msg-5a-2')?.read, false, '404 atômico não muta irmão válido');

      // 3g. Valid recipient read marking: Student 1 marks msg-5a-2 (from Teacher A) as read
      const validStudentRead = await makeRequest(
        server,
        'PATCH',
        '/api/chat-messages',
        { messageIds: ['msg-5a-2'] },
        { Authorization: 'Bearer tok-student-1' }
      );
      assert.strictEqual(validStudentRead.status, 200);
      assert.strictEqual(validStudentRead.data.success, true);
      assert.deepStrictEqual(validStudentRead.data.markedIds, ['msg-5a-2']);
      const docAfterRead = mockFs._getDoc('direct_messages', 'msg-5a-2');
      assert.strictEqual(docAfterRead?.read, true);
      assert.strictEqual(docAfterRead?.readByUid, STUDENT_1_UID);
      assert.ok(typeof docAfterRead?.readAt === 'string' && docAfterRead.readAt.length > 0);

      // Valid recipient read marking: Teacher A marks msg-5a-1 (from Student 1) as read
      const validTeacherRead = await makeRequest(
        server,
        'PATCH',
        '/api/chat-messages',
        { messageIds: ['msg-5a-1'] },
        { Authorization: 'Bearer tok-teacher-a' }
      );
      assert.strictEqual(validTeacherRead.status, 200);
      assert.strictEqual(mockFs._getDoc('direct_messages', 'msg-5a-1')?.read, true);

      // 3h. Verify read state survives simulated restart & preserves read when sender edits message
      await simulateServerRestart(mockFs);
      const getAfterReadRestart = await makeRequest(server, 'GET', '/api/chat-messages', undefined, {
        Authorization: 'Bearer tok-student-1',
      });
      assert.strictEqual(getAfterReadRestart.status, 200);
      assert.ok(getAfterReadRestart.data.messages.every((m: any) => m.read === true), 'read=true persiste após reinício');

      // Update by original sender preserves existing read=true & createdAt
      const editRes = await makeRequest(
        server,
        'POST',
        '/api/chat-messages',
        {
          message: {
            id: 'msg-5a-1',
            studentUid: STUDENT_1_UID,
            nativeFriendUid: TEACHER_A_UID,
            senderUid: STUDENT_1_UID,
            senderRole: 'student',
            recipientUid: TEACHER_A_UID,
            text: 'First persistent message (edited)',
          },
        },
        { Authorization: 'Bearer tok-student-1' }
      );
      assert.strictEqual(editRes.status, 200);
      assert.strictEqual(editRes.data.message.read, true, 'Edição preserva read=true já gravado');
      assert.strictEqual(editRes.data.message.createdAt, '2026-11-19T08:00:00.000Z', 'Edição preserva createdAt original');

      // 3i. Native Friend switch revokes PATCH read access for previous Teacher A
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
      });
      mockFs._setDoc('student_assignments', STUDENT_1_UID, {
        uid: STUDENT_1_UID,
        studentUid: STUDENT_1_UID,
        email: STUDENT_1_EMAIL,
        teacherUid: TEACHER_B_UID,
        assignedNativeFriendUID: TEACHER_B_UID,
        teacherEmail: TEACHER_B_EMAIL,
      });

      const oldTeacherPatch = await makeRequest(
        server,
        'PATCH',
        '/api/chat-messages',
        { messageIds: ['msg-5a-1'] },
        { Authorization: 'Bearer tok-teacher-a' }
      );
      assert.strictEqual(oldTeacherPatch.status, 403, 'Professor A perde acesso de PATCH após troca de vínculo');
    });

    // 4. Fail-closed 503 when Firestore (default) is unavailable (no RAM fallback)
    await test('4. Fail-closed (HTTP 503) em GET/POST/PATCH/DELETE quando Firestore (default) está indisponível', async () => {
      seedWorld(mockFs);
      // Even if RAM somehow held stale entries, backend must NOT read from RAM
      readDb().chatMessages = [
        {
          id: 'stale-ram-msg',
          studentUid: STUDENT_1_UID,
          nativeFriendUid: TEACHER_A_UID,
          text: 'Should never be returned',
        },
      ];

      setFirebaseAdminFirestoreForTesting(null);
      try {
        const g = await makeRequest(server, 'GET', '/api/chat-messages', undefined, {
          Authorization: 'Bearer tok-admin',
        });
        assert.strictEqual(g.status, 503, 'GET sem Firestore -> 503');

        const p = await makeRequest(
          server,
          'POST',
          '/api/chat-messages',
          {
            message: {
              id: 'msg-no-fs',
              studentUid: STUDENT_1_UID,
              nativeFriendUid: TEACHER_A_UID,
              senderRole: 'admin',
              text: 'Should fail closed',
            },
          },
          { Authorization: 'Bearer tok-admin' }
        );
        assert.strictEqual(p.status, 503, 'POST sem Firestore -> 503');

        const patch = await makeRequest(
          server,
          'PATCH',
          '/api/chat-messages',
          { messageIds: ['msg-no-fs'] },
          { Authorization: 'Bearer tok-admin' }
        );
        assert.strictEqual(patch.status, 503, 'PATCH sem Firestore -> 503');

        const del = await makeRequest(server, 'DELETE', '/api/chat-messages?id=msg-no-fs', undefined, {
          Authorization: 'Bearer tok-admin',
        });
        assert.strictEqual(del.status, 503, 'DELETE sem Firestore -> 503');
      } finally {
        setFirebaseAdminFirestoreForTesting(mockFs as unknown as Firestore);
        readDb().chatMessages = [];
      }
    });

    // 5. Client Utility Static Audit & E2E Consumer Execution
    await test('5. src/utils/directMessages.ts: zero client SDK Firestore, e fluxo completo subscribe -> send -> PATCH read funciona via API', async () => {
      const dmSource = fs.readFileSync(path.join(process.cwd(), 'src/utils/directMessages.ts'), 'utf-8');
      assert.strictEqual(dmSource.includes('firebase/firestore'), false, 'Sem import de firebase/firestore');
      assert.strictEqual(dmSource.includes('onSnapshot('), false, 'Sem listener onSnapshot direto no cliente');
      assert.strictEqual(dmSource.includes('setDoc('), false, 'Sem escrita setDoc direta no cliente');
      assert.strictEqual(dmSource.includes('getDb('), false, 'Sem acesso a getDb() do client SDK');

      seedWorld(mockFs);
      const addr = server.address() as any;
      const baseUrl = `http://127.0.0.1:${addr.port}`;

      const originalFetch = globalThis.fetch;
      const originalCurrentUserDesc = Object.getOwnPropertyDescriptor(clientAuth, 'currentUser');
      let activeToken = 'tok-teacher-a';

      Object.defineProperty(clientAuth, 'currentUser', {
        configurable: true,
        get: () => ({
          uid: activeToken === 'tok-student-1' ? STUDENT_1_UID : TEACHER_A_UID,
          getIdToken: async () => activeToken,
        }),
      });

      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const urlStr = typeof input === 'string' ? input : input.toString();
        const targetUrl = urlStr.startsWith('/') ? `${baseUrl}${urlStr}` : urlStr;
        return originalFetch(targetUrl, init);
      }) as typeof fetch;

      try {
        clearDirectMessagesMemoryCache();

        // Teacher A sends a message via sendDirectMessage -> persists to Firestore
        activeToken = 'tok-teacher-a';
        const sentFromTeacher = await sendDirectMessage({
          studentUid: STUDENT_1_UID,
          studentEmail: STUDENT_1_EMAIL,
          studentName: 'Student One',
          nativeFriendUid: TEACHER_A_UID,
          nativeFriendEmail: TEACHER_A_EMAIL,
          nativeFriendName: 'Teacher Alpha',
          senderUid: TEACHER_A_UID,
          senderEmail: TEACHER_A_EMAIL,
          senderName: 'Teacher Alpha',
          senderRole: 'teacher',
          recipientUid: STUDENT_1_UID,
          text: 'Hello via directMessages utility!',
        });
        assert.ok(sentFromTeacher, 'sendDirectMessage retorna mensagem persistida');
        assert.strictEqual(sentFromTeacher!.read, false);
        assert.ok(mockFs._getDoc('direct_messages', sentFromTeacher!.id), 'Mensagem persistida no Firestore');

        // Rejected send (spoofing another student's conversation) must return null & not pollute cache
        const rejectedSend = await sendDirectMessage({
          studentUid: STUDENT_2_UID,
          studentEmail: STUDENT_2_EMAIL,
          nativeFriendUid: TEACHER_A_UID,
          nativeFriendEmail: TEACHER_A_EMAIL,
          senderUid: TEACHER_A_UID,
          senderEmail: TEACHER_A_EMAIL,
          senderName: 'Teacher Alpha',
          senderRole: 'teacher',
          recipientUid: STUDENT_2_UID,
          text: 'Unauthorized send',
        });
        assert.strictEqual(rejectedSend, null, 'Envio rejeitado pelo servidor retorna null');

        // Clear cache, switch to Student 1, subscribe, and mark as read via markDirectMessagesAsRead
        clearDirectMessagesMemoryCache();
        activeToken = 'tok-student-1';

        const snapshots: DirectMessage[][] = [];
        const unsubscribe = subscribeDirectMessages(STUDENT_1_UID, TEACHER_A_UID, (msgs) => {
          snapshots.push(msgs);
        });

        // Wait for initial async fetchServerMessages
        await new Promise((r) => setTimeout(r, 80));
        assert.ok(snapshots.length >= 1, 'subscribeDirectMessages recebeu snapshot inicial do backend');
        const latestBeforeRead = snapshots[snapshots.length - 1];
        assert.strictEqual(latestBeforeRead.length, 1);
        assert.strictEqual(latestBeforeRead[0].id, sentFromTeacher!.id);
        assert.strictEqual(latestBeforeRead[0].read, false);

        // Mark as read through client utility (calls PATCH /api/chat-messages)
        await markDirectMessagesAsRead([sentFromTeacher!.id]);
        await new Promise((r) => setTimeout(r, 50));

        const latestAfterRead = snapshots[snapshots.length - 1];
        assert.strictEqual(latestAfterRead.length, 1);
        assert.strictEqual(latestAfterRead[0].read, true, 'Listener atualizado imediatamente para read=true');
        assert.strictEqual(
          mockFs._getDoc('direct_messages', sentFromTeacher!.id)?.read,
          true,
          'Firestore atualizado via PATCH sem client SDK'
        );

        unsubscribe();
      } finally {
        globalThis.fetch = originalFetch;
        if (originalCurrentUserDesc) {
          Object.defineProperty(clientAuth, 'currentUser', originalCurrentUserDesc);
        } else {
          delete (clientAuth as any).currentUser;
        }
        clearDirectMessagesMemoryCache();
      }
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    resetFirebaseAdminForTesting();
    resetFirebaseAdminFirestoreForTesting();
    resetInMemoryDbForTesting();
    resetResidualCachesForTesting();
    clearDirectMessagesMemoryCache();
  }

  console.log(`\nResumo SEC.FIX.5A: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('Fatal error in validate-sec-fix-5a:', err);
  process.exit(1);
});
