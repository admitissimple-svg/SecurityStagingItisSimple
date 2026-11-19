/**
 * SEC.FIX.5 — Proteção de GET/POST/DELETE /api/chat-messages e consumidores
 *
 * Valida:
 * 1. Bloqueio estrito (HTTP 401) para acessos anônimos, cabeçalhos malformados e tokens inválidos/expirados em GET/POST/DELETE.
 * 2. Autorização por RBAC canônico e vínculos no Firestore (default):
 *    - Aluno vinculado lê, envia e exclui mensagens APENAS da conversa com seu Amigo Nativo canonicamente vinculado (ou aula ativa).
 *    - Aluno é bloqueado (HTTP 403) ao tentar ler/enviar/excluir conversas de outros alunos, professores não vinculados, aulas canceladas, bulk overwrite ou DELETE global.
 *    - Bloqueio de spoofing de senderUid, senderRole e sobrescrita de ID de mensagem de terceiros.
 *    - Professor aprovado lê, envia e exclui mensagens APENAS de alunos canonicamente vinculados; perde acesso após troca de Native Friend (A -> B).
 *    - Professor pendente, rejeitado ou conta em conflito/spoof recebem HTTP 403.
 *    - ADM autenticado e canônico acessa listagem, envia recado administrativo e executa exclusão pontual ou global.
 * 3. Preservação funcional de histórico, envio, recebimento, exclusão e contratos dos consumidores (directMessages.ts / HeaderMessagesPopover.tsx).
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
    _setDoc: (col: string, id: string, data: Record<string, any>) => {
      store.set(`${col}::${id}`, JSON.parse(JSON.stringify(data)));
    },
    _deleteDoc: (col: string, id: string) => {
      store.delete(`${col}::${id}`);
    },
    _getCollectionDocs: (col: string) => {
      const result: Record<string, any>[] = [];
      for (const [k, v] of store.entries()) {
        if (k.startsWith(`${col}::`)) {
          result.push(JSON.parse(JSON.stringify(v)));
        }
      }
      return result;
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
const ADMIN_EMAIL = 'admin.secfix5@itissimple.com';

const TEACHER_A_UID = 'teacherACanonicalUid1234567';
const TEACHER_A_EMAIL = 'teacher.a.chat@itissimple.com';

const TEACHER_B_UID = 'teacherBCanonicalUid1234567';
const TEACHER_B_EMAIL = 'teacher.b.chat@itissimple.com';

const PENDING_TEACHER_UID = 'pendingTeacherUid1234567890';
const PENDING_TEACHER_EMAIL = 'pending.chat@itissimple.com';

const REJECTED_TEACHER_UID = 'rejectedTeacherUid123456789';
const REJECTED_TEACHER_EMAIL = 'rejected.chat@itissimple.com';

const STUDENT_1_UID = 'student1CanonicalUid1234567';
const STUDENT_1_EMAIL = 'student.one.chat@itissimple.com';

const STUDENT_2_UID = 'student2CanonicalUid1234567';
const STUDENT_2_EMAIL = 'student.two.chat@itissimple.com';

const STUDENT_UNLINKED_UID = 'studentUnlinkedUid123456789';
const STUDENT_UNLINKED_EMAIL = 'student.unlinked.chat@itissimple.com';

const CONFLICT_ADMIN_UID = 'conflictAdminUid12345678901';
const CONFLICT_ADMIN_EMAIL = 'conflict.admin.chat@itissimple.com';

const SPOOF_TEACHER_STUDENT_UID = 'spoofTeacherStudentUid12345';
const SPOOF_TEACHER_STUDENT_EMAIL = 'spoof.student.chat@itissimple.com';

function seedBaseline(mockFs: ReturnType<typeof createMockFirestore>) {
  resetInMemoryDbForTesting();
  resetResidualCachesForTesting();
  mockFs._clearWriteLog();
  for (const existingDoc of mockFs._getCollectionDocs('direct_messages')) {
    if (existingDoc?.id) mockFs._deleteDoc('direct_messages', String(existingDoc.id));
  }
  for (const existingLesson of mockFs._getCollectionDocs('lessons')) {
    if (existingLesson?.id) mockFs._deleteDoc('lessons', String(existingLesson.id));
  }

  mockFs._setDoc('tutors', TEACHER_A_UID, {
    id: TEACHER_A_UID,
    uid: TEACHER_A_UID,
    authUid: TEACHER_A_UID,
    publicTutorId: 'teacher-a-chat',
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
    publicTutorId: 'teacher-b-chat',
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

  // Student 1 linked canonically to Teacher A
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
  });
  mockFs._setDoc('student_assignments', STUDENT_2_UID, {
    uid: STUDENT_2_UID,
    studentUid: STUDENT_2_UID,
    email: STUDENT_2_EMAIL,
    teacherUid: TEACHER_B_UID,
    assignedNativeFriendUID: TEACHER_B_UID,
    teacherEmail: TEACHER_B_EMAIL,
  });

  // Unlinked Student
  mockFs._setDoc('users', STUDENT_UNLINKED_UID, {
    id: STUDENT_UNLINKED_UID,
    uid: STUDENT_UNLINKED_UID,
    email: STUDENT_UNLINKED_EMAIL,
    name: 'Unlinked Student',
    role: 'student',
    enrollmentStatus: 'not_enrolled',
  });

  // Conflict Admin & Spoof Student
  mockFs._setDoc('users', CONFLICT_ADMIN_UID, {
    id: CONFLICT_ADMIN_UID,
    uid: CONFLICT_ADMIN_UID,
    email: CONFLICT_ADMIN_EMAIL,
    name: 'Conflict Admin',
    role: 'student',
  });
  mockFs._setDoc('users', SPOOF_TEACHER_STUDENT_UID, {
    id: SPOOF_TEACHER_STUDENT_UID,
    uid: SPOOF_TEACHER_STUDENT_UID,
    email: SPOOF_TEACHER_STUDENT_EMAIL,
    name: 'Spoof Student',
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
  const baselineMessages = [
    {
      id: 'msg-s1-ta-1',
      studentUid: STUDENT_1_UID,
      studentEmail: STUDENT_1_EMAIL,
      studentName: 'Student One',
      nativeFriendUid: TEACHER_A_UID,
      nativeFriendEmail: TEACHER_A_EMAIL,
      nativeFriendName: 'Teacher Alpha',
      senderUid: STUDENT_1_UID,
      senderEmail: STUDENT_1_EMAIL,
      senderName: 'Student One',
      senderRole: 'student',
      recipientUid: TEACHER_A_UID,
      text: 'Secret question from Student 1 to Teacher A',
      createdAt: '2026-11-19T10:00:00.000Z',
      read: false,
    },
    {
      id: 'msg-s1-ta-2',
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
      text: 'Reply from Teacher A to Student 1',
      createdAt: '2026-11-19T10:01:00.000Z',
      read: false,
    },
    {
      id: 'msg-s2-tb-1',
      studentUid: STUDENT_2_UID,
      studentEmail: STUDENT_2_EMAIL,
      studentName: 'Student Two',
      nativeFriendUid: TEACHER_B_UID,
      nativeFriendEmail: TEACHER_B_EMAIL,
      nativeFriendName: 'Teacher Beta',
      senderUid: STUDENT_2_UID,
      senderEmail: STUDENT_2_EMAIL,
      senderName: 'Student Two',
      senderRole: 'student',
      recipientUid: TEACHER_B_UID,
      text: 'Private message from Student 2 to Teacher B',
      createdAt: '2026-11-19T10:02:00.000Z',
      read: false,
    },
  ];
  for (const msg of baselineMessages) {
    mockFs._setDoc('direct_messages', msg.id, msg);
  }
}

async function run() {
  console.log('\n=== SEC.FIX.5: Validação de Proteção do Chat (/api/chat-messages) ===\n');

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
        case 'token-student-unlinked':
          return { uid: STUDENT_UNLINKED_UID, email: STUDENT_UNLINKED_EMAIL, email_verified: true, role: 'student' };
        case 'token-conflict-admin':
          return { uid: CONFLICT_ADMIN_UID, email: CONFLICT_ADMIN_EMAIL, email_verified: true, role: 'admin' };
        case 'token-spoof-student':
          return { uid: SPOOF_TEACHER_STUDENT_UID, email: SPOOF_TEACHER_STUDENT_EMAIL, email_verified: true, role: 'teacher' };
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
    // 1. Anonymous & Invalid Auth -> 401
    await test('1. Acessos anônimos, cabeçalhos malformados e tokens inválidos/expirados em GET/POST/DELETE retornam 401 sem mutação', async () => {
      seedBaseline(mockFs);
      const initialCount = mockFs._getCollectionDocs('direct_messages').length;

      for (const method of ['GET', 'POST', 'DELETE']) {
        const body = method === 'POST' ? { message: { id: 'anon-1', studentUid: STUDENT_1_UID, nativeFriendUid: TEACHER_A_UID, text: 'hack' } } : undefined;
        const anon = await makeRequest(server, method, '/api/chat-messages', body);
        assert.strictEqual(anon.status, 401, `${method} anon -> 401`);
        assert.strictEqual(JSON.stringify(anon.data).includes('Secret question'), false);

        const badHeader = await makeRequest(server, method, '/api/chat-messages', body, { Authorization: 'Basic xyz' });
        assert.strictEqual(badHeader.status, 401, `${method} malformed header -> 401`);

        const expired = await makeRequest(server, method, '/api/chat-messages', body, { Authorization: 'Bearer token-expired' });
        assert.strictEqual(expired.status, 401, `${method} expired token -> 401`);

        const invalid = await makeRequest(server, method, '/api/chat-messages', body, { Authorization: 'Bearer invalid-tok' });
        assert.strictEqual(invalid.status, 401, `${method} invalid token -> 401`);
      }

      assert.strictEqual(mockFs._getCollectionDocs('direct_messages').length, initialCount, 'Nenhuma mutação no Firestore após bloqueios 401');
      assert.strictEqual(readDb().chatMessages.length, 0, 'RAM chatMessages permanece vazia');
    });

    // 2. Student Isolation & Link Verification
    await test('2. Aluno vinculado lê/envia/exclui apenas sua conversa legítima; terceiros, spoofing e bulk overwrite retornam 403', async () => {
      seedBaseline(mockFs);

      // 2a. GET returns ONLY Student 1 <-> Teacher A messages
      const s1Get = await makeRequest(server, 'GET', '/api/chat-messages', undefined, {
        Authorization: 'Bearer token-student-1',
      });
      assert.strictEqual(s1Get.status, 200);
      assert.strictEqual(s1Get.data.messages.length, 2);
      assert.ok(s1Get.data.messages.every((m: any) => m.studentUid === STUDENT_1_UID && m.nativeFriendUid === TEACHER_A_UID));
      assert.strictEqual(JSON.stringify(s1Get.data).includes('Student 2'), false, 'Sem vazamento de outro aluno');

      // 2b. Student 1 querying Student 2 or Teacher B -> 403
      const s1QueryS2 = await makeRequest(server, 'GET', `/api/chat-messages?studentUid=${STUDENT_2_UID}`, undefined, {
        Authorization: 'Bearer token-student-1',
      });
      assert.strictEqual(s1QueryS2.status, 403);

      const s1QueryTB = await makeRequest(server, 'GET', `/api/chat-messages?nativeFriendUid=${TEACHER_B_UID}`, undefined, {
        Authorization: 'Bearer token-student-1',
      });
      assert.strictEqual(s1QueryTB.status, 403);

      // 2c. Student 1 sends valid message to linked Teacher A -> 200 (and response contains only own messages)
      const s1Post = await makeRequest(
        server,
        'POST',
        '/api/chat-messages',
        {
          message: {
            id: 'msg-s1-ta-3',
            studentUid: STUDENT_1_UID,
            studentEmail: STUDENT_1_EMAIL,
            nativeFriendUid: TEACHER_A_UID,
            nativeFriendEmail: TEACHER_A_EMAIL,
            senderUid: STUDENT_1_UID,
            senderRole: 'student',
            recipientUid: TEACHER_A_UID,
            text: 'Hello Teacher A!',
            createdAt: '2026-11-19T10:05:00.000Z',
          },
        },
        { Authorization: 'Bearer token-student-1' }
      );
      assert.strictEqual(s1Post.status, 200);
      assert.strictEqual(s1Post.data.success, true);
      assert.strictEqual(s1Post.data.messages.length, 3);
      assert.strictEqual(JSON.stringify(s1Post.data).includes('msg-s2-tb-1'), false, 'Resposta POST não vaza mensagens de terceiros');

      // 2d. Attack attempts by Student 1 -> all 403
      const attackUnlinkedTeacher = await makeRequest(
        server,
        'POST',
        '/api/chat-messages',
        {
          message: {
            id: 'msg-attack-1',
            studentUid: STUDENT_1_UID,
            nativeFriendUid: TEACHER_B_UID,
            senderUid: STUDENT_1_UID,
            senderRole: 'student',
            recipientUid: TEACHER_B_UID,
            text: 'Spam to unlinked Teacher B',
          },
        },
        { Authorization: 'Bearer token-student-1' }
      );
      assert.strictEqual(attackUnlinkedTeacher.status, 403);

      const attackOtherStudent = await makeRequest(
        server,
        'POST',
        '/api/chat-messages',
        {
          message: {
            id: 'msg-attack-2',
            studentUid: STUDENT_2_UID,
            nativeFriendUid: TEACHER_B_UID,
            senderUid: STUDENT_2_UID,
            senderRole: 'student',
            recipientUid: TEACHER_B_UID,
            text: 'Impersonating Student 2',
          },
        },
        { Authorization: 'Bearer token-student-1' }
      );
      assert.strictEqual(attackOtherStudent.status, 403);

      const attackSpoofRole = await makeRequest(
        server,
        'POST',
        '/api/chat-messages',
        {
          message: {
            id: 'msg-attack-3',
            studentUid: STUDENT_1_UID,
            nativeFriendUid: TEACHER_A_UID,
            senderUid: STUDENT_1_UID,
            senderRole: 'admin',
            recipientUid: TEACHER_A_UID,
            text: 'Spoofed admin notice',
          },
        },
        { Authorization: 'Bearer token-student-1' }
      );
      assert.strictEqual(attackSpoofRole.status, 403);

      const attackOverwriteOtherMsg = await makeRequest(
        server,
        'POST',
        '/api/chat-messages',
        {
          message: {
            id: 'msg-s1-ta-2', // Teacher A's message ID!
            studentUid: STUDENT_1_UID,
            nativeFriendUid: TEACHER_A_UID,
            senderUid: STUDENT_1_UID,
            senderRole: 'student',
            recipientUid: TEACHER_A_UID,
            text: 'Tampered teacher message',
          },
        },
        { Authorization: 'Bearer token-student-1' }
      );
      assert.strictEqual(attackOverwriteOtherMsg.status, 403);

      const attackBulkOverwrite = await makeRequest(
        server,
        'POST',
        '/api/chat-messages',
        { messages: [] },
        { Authorization: 'Bearer token-student-1' }
      );
      assert.strictEqual(attackBulkOverwrite.status, 403);

      // 2e. DELETE: bare global delete -> 403; deleting Student 2's message -> 403; deleting own message -> 200 without affecting Student 2
      const bareDelete = await makeRequest(server, 'DELETE', '/api/chat-messages', undefined, {
        Authorization: 'Bearer token-student-1',
      });
      assert.strictEqual(bareDelete.status, 403);

      const deleteOtherConvoMsg = await makeRequest(server, 'DELETE', '/api/chat-messages?id=msg-s2-tb-1', undefined, {
        Authorization: 'Bearer token-student-1',
      });
      assert.strictEqual(deleteOtherConvoMsg.status, 403);

      const deleteOwnMsg = await makeRequest(server, 'DELETE', '/api/chat-messages?id=msg-s1-ta-3', undefined, {
        Authorization: 'Bearer token-student-1',
      });
      assert.strictEqual(deleteOwnMsg.status, 200);
      assert.strictEqual(deleteOwnMsg.data.messages.length, 2);
      assert.ok(mockFs._getCollectionDocs('direct_messages').some((m) => m.id === 'msg-s2-tb-1'), 'Mensagem de terceiro preservada no Firestore');
      assert.strictEqual(readDb().chatMessages.length, 0, 'RAM chatMessages permanece vazia');
    });

    // 3. Teacher RBAC, Switch Native Friend, Pending/Rejected/Spoof Block
    await test('3. Professor aprovado acessa apenas alunos vinculados; troca de Native Friend revoga acesso anterior; pendente/rejeitado/spoof bloqueados', async () => {
      seedBaseline(mockFs);

      // 3a. Teacher A gets only Student 1 messages
      const taGet = await makeRequest(server, 'GET', '/api/chat-messages', undefined, {
        Authorization: 'Bearer token-teacher-a',
      });
      assert.strictEqual(taGet.status, 200);
      assert.strictEqual(taGet.data.messages.length, 2);
      assert.ok(taGet.data.messages.every((m: any) => m.nativeFriendUid === TEACHER_A_UID));

      // 3b. Teacher A cannot access Student 2 or impersonate Teacher B
      const taQueryS2 = await makeRequest(server, 'GET', `/api/chat-messages?studentUid=${STUDENT_2_UID}`, undefined, {
        Authorization: 'Bearer token-teacher-a',
      });
      assert.strictEqual(taQueryS2.status, 403);

      const taPostS2 = await makeRequest(
        server,
        'POST',
        '/api/chat-messages',
        {
          message: {
            id: 'msg-ta-s2-attack',
            studentUid: STUDENT_2_UID,
            nativeFriendUid: TEACHER_A_UID,
            senderUid: TEACHER_A_UID,
            senderRole: 'teacher',
            recipientUid: STUDENT_2_UID,
            text: 'Unauthorized teacher message',
          },
        },
        { Authorization: 'Bearer token-teacher-a' }
      );
      assert.strictEqual(taPostS2.status, 403);

      // 3c. Teacher A sends valid reply to Student 1 -> 200
      const taPostS1 = await makeRequest(
        server,
        'POST',
        '/api/chat-messages',
        {
          message: {
            id: 'msg-ta-s1-valid',
            studentUid: STUDENT_1_UID,
            nativeFriendUid: TEACHER_A_UID,
            senderUid: TEACHER_A_UID,
            senderRole: 'teacher',
            recipientUid: STUDENT_1_UID,
            text: 'Great job on today routine!',
          },
        },
        { Authorization: 'Bearer token-teacher-a' }
      );
      assert.strictEqual(taPostS1.status, 200);
      assert.strictEqual(taPostS1.data.messages.length, 3);

      // 3d. Pending, Rejected -> 403; Spoof Teacher Claim on Student -> blocked from teacher/other access
      for (const tok of ['token-pending-teacher', 'token-rejected-teacher']) {
        const g = await makeRequest(server, 'GET', '/api/chat-messages', undefined, { Authorization: `Bearer ${tok}` });
        assert.strictEqual(g.status, 403, `${tok} GET -> 403`);
        const p = await makeRequest(
          server,
          'POST',
          '/api/chat-messages',
          {
            message: {
              id: `msg-${tok}`,
              studentUid: STUDENT_1_UID,
              nativeFriendUid: TEACHER_A_UID,
              text: 'blocked',
            },
          },
          { Authorization: `Bearer ${tok}` }
        );
        assert.strictEqual(p.status, 403, `${tok} POST -> 403`);
      }

      const spoofBareGet = await makeRequest(server, 'GET', '/api/chat-messages', undefined, {
        Authorization: 'Bearer token-spoof-student',
      });
      assert.ok(
        spoofBareGet.status === 403 || (spoofBareGet.status === 200 && Array.isArray(spoofBareGet.data?.messages) && spoofBareGet.data.messages.length === 0),
        'Spoof student bare GET leaks zero messages'
      );
      const spoofTargetGet = await makeRequest(
        server,
        'GET',
        `/api/chat-messages?studentUid=${STUDENT_1_UID}`,
        undefined,
        { Authorization: 'Bearer token-spoof-student' }
      );
      assert.strictEqual(spoofTargetGet.status, 403, 'Spoof student targeted GET -> 403');
      const spoofPost = await makeRequest(
        server,
        'POST',
        '/api/chat-messages',
        {
          message: {
            id: 'msg-spoof-student',
            studentUid: STUDENT_1_UID,
            nativeFriendUid: TEACHER_A_UID,
            senderUid: SPOOF_TEACHER_STUDENT_UID,
            senderRole: 'teacher',
            text: 'blocked',
          },
        },
        { Authorization: 'Bearer token-spoof-student' }
      );
      assert.strictEqual(spoofPost.status, 403, 'Spoof student POST -> 403');

      // 3e. Switch Native Friend: Student 1 switches from Teacher A to Teacher B (with completed historical lesson under A)
      mockFs._setDoc('lessons', 'lesson-old-completed-a', {
        id: 'lesson-old-completed-a',
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
      });
      mockFs._setDoc('student_assignments', STUDENT_1_UID, {
        uid: STUDENT_1_UID,
        studentUid: STUDENT_1_UID,
        email: STUDENT_1_EMAIL,
        teacherUid: TEACHER_B_UID,
        assignedNativeFriendUID: TEACHER_B_UID,
        teacherEmail: TEACHER_B_EMAIL,
      });

      const taAfterSwitchGet = await makeRequest(server, 'GET', '/api/chat-messages', undefined, {
        Authorization: 'Bearer token-teacher-a',
      });
      assert.strictEqual(taAfterSwitchGet.status, 200);
      assert.strictEqual(taAfterSwitchGet.data.messages.length, 0, 'Professor anterior não lê mais mensagens após troca');

      const taAfterSwitchPost = await makeRequest(
        server,
        'POST',
        '/api/chat-messages',
        {
          message: {
            id: 'msg-ta-after-switch',
            studentUid: STUDENT_1_UID,
            nativeFriendUid: TEACHER_A_UID,
            senderUid: TEACHER_A_UID,
            senderRole: 'teacher',
            text: 'Should be blocked after switch',
          },
        },
        { Authorization: 'Bearer token-teacher-a' }
      );
      assert.strictEqual(taAfterSwitchPost.status, 403);

      const taAfterSwitchDel = await makeRequest(server, 'DELETE', '/api/chat-messages?id=msg-s1-ta-1', undefined, {
        Authorization: 'Bearer token-teacher-a',
      });
      assert.strictEqual(taAfterSwitchDel.status, 403);

      const tbAfterSwitchPost = await makeRequest(
        server,
        'POST',
        '/api/chat-messages',
        {
          message: {
            id: 'msg-tb-s1-welcome',
            studentUid: STUDENT_1_UID,
            nativeFriendUid: TEACHER_B_UID,
            senderUid: TEACHER_B_UID,
            senderRole: 'teacher',
            recipientUid: STUDENT_1_UID,
            text: 'Welcome as your new Native Friend!',
          },
        },
        { Authorization: 'Bearer token-teacher-b' }
      );
      assert.strictEqual(tbAfterSwitchPost.status, 200, 'Novo Native Friend B pode conversar com Student 1');
    });

    // 4. Unlinked Student & Active vs Cancelled Trial Lesson
    await test('4. Aluno sem vínculo e aula cancelada não concedem acesso; aula trial ativa permite chat entre participantes', async () => {
      seedBaseline(mockFs);

      const unlinkedGet = await makeRequest(server, 'GET', '/api/chat-messages', undefined, {
        Authorization: 'Bearer token-student-unlinked',
      });
      assert.strictEqual(unlinkedGet.status, 200);
      assert.deepStrictEqual(unlinkedGet.data.messages, []);

      // Cancelled lesson with Teacher B -> 403
      mockFs._setDoc('lessons', 'lesson-cancelled-trial', {
        id: 'lesson-cancelled-trial',
        studentUid: STUDENT_UNLINKED_UID,
        teacherUid: TEACHER_B_UID,
        teacherEmail: TEACHER_B_EMAIL,
        status: 'cancelled',
        isTrialLesson: true,
      });
      const cancelledPost = await makeRequest(
        server,
        'POST',
        '/api/chat-messages',
        {
          message: {
            id: 'msg-cancelled-trial',
            studentUid: STUDENT_UNLINKED_UID,
            nativeFriendUid: TEACHER_B_UID,
            senderUid: STUDENT_UNLINKED_UID,
            senderRole: 'student',
            text: 'Should be blocked on cancelled lesson',
          },
        },
        { Authorization: 'Bearer token-student-unlinked' }
      );
      assert.strictEqual(cancelledPost.status, 403);

      // Active scheduled trial lesson with Teacher B -> 200
      mockFs._setDoc('lessons', 'lesson-active-trial', {
        id: 'lesson-active-trial',
        studentUid: STUDENT_UNLINKED_UID,
        teacherUid: TEACHER_B_UID,
        teacherEmail: TEACHER_B_EMAIL,
        status: 'scheduled',
        isTrialLesson: true,
      });
      const activeTrialPost = await makeRequest(
        server,
        'POST',
        '/api/chat-messages',
        {
          message: {
            id: 'msg-active-trial',
            studentUid: STUDENT_UNLINKED_UID,
            nativeFriendUid: TEACHER_B_UID,
            senderUid: STUDENT_UNLINKED_UID,
            senderRole: 'student',
            recipientUid: TEACHER_B_UID,
            text: 'Looking forward to my trial class!',
          },
        },
        { Authorization: 'Bearer token-student-unlinked' }
      );
      assert.strictEqual(activeTrialPost.status, 200);
      assert.strictEqual(activeTrialPost.data.messages.length, 1);

      const tbReadTrial = await makeRequest(
        server,
        'GET',
        `/api/chat-messages?studentUid=${STUDENT_UNLINKED_UID}`,
        undefined,
        { Authorization: 'Bearer token-teacher-b' }
      );
      assert.strictEqual(tbReadTrial.status, 200);
      assert.strictEqual(tbReadTrial.data.messages[0]?.id, 'msg-active-trial');
    });

    // 5. Admin RBAC & Conflict Block & Conversation-Scoped Delete
    await test('5. ADM verificado lê/envia/exclui (pontual ou global); claim admin em conta student retorna 403', async () => {
      seedBaseline(mockFs);

      const conflictGet = await makeRequest(server, 'GET', '/api/chat-messages', undefined, {
        Authorization: 'Bearer token-conflict-admin',
      });
      assert.strictEqual(conflictGet.status, 403);

      const adminGet = await makeRequest(server, 'GET', '/api/chat-messages', undefined, {
        Authorization: 'Bearer token-admin',
      });
      assert.strictEqual(adminGet.status, 200);
      assert.strictEqual(adminGet.data.messages.length, 3);

      const adminPost = await makeRequest(
        server,
        'POST',
        '/api/chat-messages',
        {
          message: {
            id: 'msg-admin-notice',
            studentUid: STUDENT_1_UID,
            nativeFriendUid: TEACHER_A_UID,
            senderRole: 'admin',
            text: 'Admin system notice',
          },
        },
        { Authorization: 'Bearer token-admin' }
      );
      assert.strictEqual(adminPost.status, 200);
      assert.strictEqual(adminPost.data.messages.length, 4);

      const adminDeleteOne = await makeRequest(server, 'DELETE', '/api/chat-messages?id=msg-admin-notice', undefined, {
        Authorization: 'Bearer token-admin',
      });
      assert.strictEqual(adminDeleteOne.status, 200);
      assert.strictEqual(adminDeleteOne.data.messages.length, 3);

      const adminClearAll = await makeRequest(server, 'DELETE', '/api/chat-messages', undefined, {
        Authorization: 'Bearer token-admin',
      });
      assert.strictEqual(adminClearAll.status, 200);
      assert.deepStrictEqual(adminClearAll.data.messages, []);
      assert.strictEqual(mockFs._getCollectionDocs('direct_messages').length, 0);
      assert.strictEqual(readDb().chatMessages.length, 0);
    });

    // 6. Consumer verification
    await test('6. Consumidor src/utils/directMessages.ts envia Authorization Bearer e preserva contratos da UI', async () => {
      const dmSource = fs.readFileSync(path.join(process.cwd(), 'src/utils/directMessages.ts'), 'utf-8');
      assert.ok(dmSource.includes("import { getAccessToken } from './auth';"), 'directMessages importa getAccessToken');
      assert.ok(dmSource.includes('Authorization: `Bearer ${token}`'), 'directMessages envia Bearer token em GET/POST');
      assert.ok(dmSource.includes("fetch('/api/chat-messages'"), 'directMessages preserva endpoint /api/chat-messages');

      const popoverSource = fs.readFileSync(path.join(process.cwd(), 'src/components/HeaderMessagesPopover.tsx'), 'utf-8');
      assert.ok(popoverSource.includes('subscribeDirectMessages('), 'HeaderMessagesPopover preserva subscribeDirectMessages');
      assert.ok(popoverSource.includes('sendDirectMessage('), 'HeaderMessagesPopover preserva sendDirectMessage');
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    resetFirebaseAdminForTesting();
    resetFirebaseAdminFirestoreForTesting();
    resetInMemoryDbForTesting();
    resetResidualCachesForTesting();
  }

  console.log(`\nResumo SEC.FIX.5: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('Fatal error in validate-sec-fix-5:', err);
  process.exit(1);
});
