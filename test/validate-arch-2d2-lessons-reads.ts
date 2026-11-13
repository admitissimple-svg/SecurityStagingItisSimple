import assert from 'assert';
import fs from 'fs';
import http from 'http';
import path from 'path';
import {
  app as serverApp,
  readDb,
  initCloudPersistence,
} from '../serverApp';
import {
  setFirebaseAdminFirestoreForTesting,
  resetFirebaseAdminFirestoreForTesting,
  fetchAppStateFromFirestore,
  saveAppStateToFirestore,
} from '../src/serverFirestore';
import {
  ALLOWED_STAGING_PROJECT_ID,
  setFirebaseAdminAuthForTesting,
  resetFirebaseAdminForTesting,
} from '../src/serverFirebaseAdmin';

/**
 * In-memory Firestore (default) mock with OCC + transaction.delete + query auditing
 */
class MockArch2D2Firestore {
  public projectId = ALLOWED_STAGING_PROJECT_ID;
  public databaseId = '(default)';
  public store = new Map<string, { data: any; version: number }>();
  public unrestrictedLessonsGets = 0;
  public appStateLessonsWrites = 0;

  private getKey(col: string, id: string) {
    return `${col}::${id}`;
  }

  public getDocSync(colPath: string, docId: string) {
    const entry = this.store.get(this.getKey(colPath, docId));
    return entry ? JSON.parse(JSON.stringify(entry.data)) : undefined;
  }

  public setDocSync(colPath: string, docId: string, data: any) {
    const key = this.getKey(colPath, docId);
    const prev = this.store.get(key);
    this.store.set(key, {
      data: JSON.parse(JSON.stringify(data)),
      version: (prev?.version || 0) + 1,
    });
  }

  public collection(colName: string) {
    const self = this;
    const makeDocRef = (docId: string) => ({
      id: docId,
      path: `${colName}/${docId}`,
      async get() {
        const entry = self.store.get(self.getKey(colName, docId));
        return {
          id: docId,
          exists: Boolean(entry && entry.data !== undefined),
          data: () => (entry && entry.data !== undefined ? JSON.parse(JSON.stringify(entry.data)) : undefined),
        };
      },
      async set(data: any, options?: { merge?: boolean }) {
        if (colName === 'app_state' && docId === 'lessons') {
          self.appStateLessonsWrites++;
        }
        const key = self.getKey(colName, docId);
        const prev = self.store.get(key);
        const nextData = options?.merge && prev?.data
          ? { ...prev.data, ...JSON.parse(JSON.stringify(data)) }
          : JSON.parse(JSON.stringify(data));
        self.store.set(key, { data: nextData, version: (prev?.version || 0) + 1 });
        return { writeTime: new Date() };
      },
      async delete() {
        self.store.delete(self.getKey(colName, docId));
      },
      collection(subColName: string) {
        return self.collection(`${colName}/${docId}/${subColName}`);
      },
    });

    const querySnapshotFromDocs = (docs: any[]) => ({
      empty: docs.length === 0,
      size: docs.length,
      docs,
      forEach(cb: (d: any) => void) {
        docs.forEach(cb);
      },
    });

    const buildQuery = (filters: Array<{ field: string; op: string; val: any }> = [], maxLimit?: number) => ({
      where(field: string, op: string, val: any) {
        return buildQuery([...filters, { field, op, val }], maxLimit);
      },
      limit(n: number) {
        return buildQuery(filters, n);
      },
      async get() {
        if (colName === 'lessons' && filters.length === 0) {
          self.unrestrictedLessonsGets++;
        }
        const prefix = `${colName}::`;
        const docs: any[] = [];
        for (const [key, entry] of self.store.entries()) {
          if (!key.startsWith(prefix)) continue;
          const rest = key.slice(prefix.length);
          if (rest.includes('/')) continue;
          const data = entry.data;
          const matches = filters.every((f) => f.op === '==' && data && data[f.field] === f.val);
          if (matches) {
            docs.push({
              id: rest,
              exists: true,
              data: () => JSON.parse(JSON.stringify(data)),
            });
          }
          if (maxLimit !== undefined && docs.length >= maxLimit) break;
        }
        return querySnapshotFromDocs(docs);
      },
    });

    return {
      doc: makeDocRef,
      where(field: string, op: string, val: any) {
        return buildQuery([{ field, op, val }]);
      },
      limit(n: number) {
        return buildQuery([], n);
      },
      async get() {
        return buildQuery().get();
      },
    };
  }

  async runTransaction<T>(updateFunction: (tx: any) => Promise<T>): Promise<T> {
    const self = this;
    for (let attempt = 0; attempt < 5; attempt++) {
      const readVersions = new Map<string, number>();
      const pendingOps: Array<
        | { type: 'set'; col: string; id: string; data: any; options?: { merge?: boolean } }
        | { type: 'delete'; col: string; id: string }
      > = [];

      const splitPath = (fullPath: string) => {
        const parts = fullPath.split('/');
        const id = parts.pop()!;
        const col = parts.join('/');
        return { col, id };
      };

      const tx = {
        get: async (ref: any) => {
          const { col, id } = splitPath(ref.path);
          const key = self.getKey(col, id);
          const entry = self.store.get(key);
          readVersions.set(key, entry?.version || 0);
          return {
            id,
            exists: Boolean(entry && entry.data !== undefined),
            data: () => (entry && entry.data !== undefined ? JSON.parse(JSON.stringify(entry.data)) : undefined),
          };
        },
        set: (ref: any, data: any, options?: { merge?: boolean }) => {
          const { col, id } = splitPath(ref.path);
          pendingOps.push({ type: 'set', col, id, data, options });
          return tx;
        },
        update: (ref: any, data: any) => {
          const { col, id } = splitPath(ref.path);
          pendingOps.push({ type: 'set', col, id, data, options: { merge: true } });
          return tx;
        },
        delete: (ref: any) => {
          const { col, id } = splitPath(ref.path);
          pendingOps.push({ type: 'delete', col, id });
          return tx;
        },
      };

      const result = await updateFunction(tx);

      let conflict = false;
      for (const [key, expectedVersion] of readVersions.entries()) {
        const currentVersion = self.store.get(key)?.version || 0;
        if (currentVersion !== expectedVersion) {
          conflict = true;
          break;
        }
      }
      if (conflict) continue;

      for (const op of pendingOps) {
        const key = self.getKey(op.col, op.id);
        if (op.type === 'delete') {
          self.store.delete(key);
        } else {
          const prev = self.store.get(key);
          const nextData =
            op.options?.merge && prev?.data
              ? { ...prev.data, ...JSON.parse(JSON.stringify(op.data)) }
              : JSON.parse(JSON.stringify(op.data));
          self.store.set(key, { data: nextData, version: (prev?.version || 0) + 1 });
        }
      }
      return result;
    }
    throw new Error('Transaction failed after max OCC retries');
  }
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
      return reject(new Error('Server address not available'));
    }
    const bodyStr = body !== undefined ? JSON.stringify(body) : undefined;
    const reqHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      ...headers,
    };
    if (bodyStr) {
      reqHeaders['Content-Length'] = Buffer.byteLength(bodyStr).toString();
    }

    const req = http.request(
      {
        host: '127.0.0.1',
        port: addr.port,
        path: reqPath,
        method,
        headers: reqHeaders,
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => {
          raw += chunk;
        });
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

function clearMemoryDb() {
  const db = readDb() as any;
  db.liveLessons = [];
  db.contractedLessons = {};
  db.students = [];
  db.tutorsList = [];
  db.teachers = [];
  db.authUsers = {};
  db.userProfiles = {};
  db.sessionNotesMap = {};
}

async function runArch2D2Tests() {
  console.log('======================================================================');
  console.log('ARCH.2D.2 — CONSOLIDAÇÃO DAS LEITURAS DE AULAS NO FIRESTORE (default)');
  console.log('======================================================================\n');

  const origProjectId = process.env.FIREBASE_PROJECT_ID;
  process.env.NODE_ENV = 'test';
  process.env.FIREBASE_PROJECT_ID = ALLOWED_STAGING_PROJECT_ID;
  resetFirebaseAdminFirestoreForTesting();

  const mockDb = new MockArch2D2Firestore();
  setFirebaseAdminFirestoreForTesting(mockDb as any);

  const STUDENT_A_UID = 'uid_arch2d2_student_a_1111';
  const STUDENT_A_EMAIL = 'arch2d2.studenta@example.com';
  const STUDENT_B_UID = 'uid_arch2d2_student_b_2222';
  const STUDENT_B_EMAIL = 'arch2d2.studentb@example.com';
  const TEACHER_1_UID = 'uid_arch2d2_teacher_1_3333';
  const TEACHER_1_PUBLIC_ID = 'tutor-arch2d2-teacher-1';
  const TEACHER_1_EMAIL = 'arch2d2.teacher1@example.com';
  const TEACHER_2_UID = 'uid_arch2d2_teacher_2_4444';
  const TEACHER_2_PUBLIC_ID = 'tutor-arch2d2-teacher-2';
  const TEACHER_2_EMAIL = 'arch2d2.teacher2@example.com';
  const ADMIN_UID = 'uid_arch2d2_admin_9999';
  const ADMIN_EMAIL = 'arch2d2.admin@example.com';

  const tokenMap: Record<string, any> = {
    'tok-student-a': { uid: STUDENT_A_UID, email: STUDENT_A_EMAIL, email_verified: true, role: 'student' },
    'tok-student-b': { uid: STUDENT_B_UID, email: STUDENT_B_EMAIL, email_verified: true, role: 'student' },
    'tok-teacher-1': { uid: TEACHER_1_UID, email: TEACHER_1_EMAIL, email_verified: true, role: 'student' },
    'tok-teacher-2': { uid: TEACHER_2_UID, email: TEACHER_2_EMAIL, email_verified: true, role: 'teacher' },
    'tok-admin': { uid: ADMIN_UID, email: ADMIN_EMAIL, email_verified: true, role: 'admin', admin: true },
  };

  setFirebaseAdminAuthForTesting({
    verifyIdToken: async (tok: string) => {
      const user = tokenMap[tok];
      if (!user) throw new Error('Invalid token');
      return user;
    },
    getUser: async (uid: string) => {
      const found = Object.values(tokenMap).find((u) => u.uid === uid);
      if (found) return found;
      throw new Error(`User not found: ${uid}`);
    },
    getUserByEmail: async (email: string) => {
      const found = Object.values(tokenMap).find((u) => u.email === email);
      if (found) return found;
      throw new Error(`User not found: ${email}`);
    },
    setCustomUserClaims: async () => {},
  } as any);

  const seedCanonicalActors = () => {
    mockDb.setDocSync('users', STUDENT_A_UID, {
      uid: STUDENT_A_UID,
      id: STUDENT_A_UID,
      email: STUDENT_A_EMAIL,
      name: 'Student A',
      role: 'student',
      availableLessons: 5,
      contractedLessons: 5,
      hasCompletedTrialLesson: true,
      onboardingCompleted: true,
      assignedNativeFriendUID: TEACHER_1_UID,
    });
    mockDb.setDocSync('users', STUDENT_B_UID, {
      uid: STUDENT_B_UID,
      id: STUDENT_B_UID,
      email: STUDENT_B_EMAIL,
      name: 'Student B',
      role: 'student',
      availableLessons: 5,
      contractedLessons: 5,
      hasCompletedTrialLesson: true,
      onboardingCompleted: true,
      assignedNativeFriendUID: TEACHER_2_UID,
    });
    mockDb.setDocSync('users', TEACHER_1_UID, {
      uid: TEACHER_1_UID,
      id: TEACHER_1_UID,
      authUid: TEACHER_1_UID,
      email: TEACHER_1_EMAIL,
      name: 'Teacher One',
      role: 'teacher',
      isTeacher: true,
      approvalStatus: 'approved',
      isApproved: true,
      status: 'approved',
      publicTutorId: TEACHER_1_PUBLIC_ID,
    });
    mockDb.setDocSync('tutors', TEACHER_1_PUBLIC_ID, {
      id: TEACHER_1_PUBLIC_ID,
      publicTutorId: TEACHER_1_PUBLIC_ID,
      authUid: TEACHER_1_UID,
      uid: TEACHER_1_UID,
      email: TEACHER_1_EMAIL,
      name: 'Teacher One',
      role: 'teacher',
      isTeacher: true,
      approvalStatus: 'approved',
      isApproved: true,
      status: 'approved',
      availableDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
      availableHours: ['09:00', '10:00', '11:00', '14:00', '15:00', '16:00'],
    });
    mockDb.setDocSync('users', TEACHER_2_UID, {
      uid: TEACHER_2_UID,
      id: TEACHER_2_UID,
      authUid: TEACHER_2_UID,
      email: TEACHER_2_EMAIL,
      name: 'Teacher Two',
      role: 'teacher',
      isTeacher: true,
      approvalStatus: 'approved',
      isApproved: true,
      status: 'approved',
      publicTutorId: TEACHER_2_PUBLIC_ID,
    });
    mockDb.setDocSync('tutors', TEACHER_2_PUBLIC_ID, {
      id: TEACHER_2_PUBLIC_ID,
      publicTutorId: TEACHER_2_PUBLIC_ID,
      authUid: TEACHER_2_UID,
      uid: TEACHER_2_UID,
      email: TEACHER_2_EMAIL,
      name: 'Teacher Two',
      role: 'teacher',
      isTeacher: true,
      approvalStatus: 'approved',
      isApproved: true,
      status: 'approved',
      availableDays: ['monday', 'wednesday', 'friday'],
      availableHours: ['10:00', '11:00'],
    });
  };

  seedCanonicalActors();
  clearMemoryDb();

  const server = http.createServer(serverApp);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  let passed = 0;
  let failed = 0;

  async function test(name: string, fn: () => Promise<void> | void) {
    try {
      await fn();
      passed++;
      console.log(`  ✅ [PASS] ${name}`);
    } catch (err: any) {
      failed++;
      console.error(`  ❌ [FAIL] ${name}`);
      console.error(`         ${err?.stack || err?.message || err}`);
    }
  }

  try {
    await test('1. GET /api/lessons e /api/live-lessons lêem exclusivamente de Firestore lessons/{id}, ignorando db.liveLessons e respeitando permissões', async () => {
      mockDb.setDocSync('lessons', 'lesson-canon-a1', {
        id: 'lesson-canon-a1',
        studentUid: STUDENT_A_UID,
        studentEmail: STUDENT_A_EMAIL,
        studentName: 'Student A',
        teacherUid: TEACHER_1_PUBLIC_ID,
        teacherAuthUid: TEACHER_1_UID,
        teacherPublicId: TEACHER_1_PUBLIC_ID,
        teacherEmail: TEACHER_1_EMAIL,
        teacherName: 'Teacher One',
        startDateTime: '2026-12-20T10:00:00.000Z',
        endDateTime: '2026-12-20T10:50:00.000Z',
        status: 'scheduled',
        title: 'Canonical Lesson A1',
      });
      mockDb.setDocSync('lessons', 'lesson-canon-b1', {
        id: 'lesson-canon-b1',
        studentUid: STUDENT_B_UID,
        studentEmail: STUDENT_B_EMAIL,
        studentName: 'Student B',
        teacherUid: TEACHER_2_PUBLIC_ID,
        teacherAuthUid: TEACHER_2_UID,
        teacherPublicId: TEACHER_2_PUBLIC_ID,
        teacherEmail: TEACHER_2_EMAIL,
        teacherName: 'Teacher Two',
        startDateTime: '2026-12-20T11:00:00.000Z',
        endDateTime: '2026-12-20T11:50:00.000Z',
        status: 'scheduled',
        title: 'Canonical Lesson B1',
      });

      // Inject phantom memory-only lesson + stale memory status overwrite
      (readDb() as any).liveLessons = [
        {
          id: 'lesson-phantom-mem',
          studentUid: STUDENT_A_UID,
          studentEmail: STUDENT_A_EMAIL,
          teacherUid: TEACHER_1_PUBLIC_ID,
          teacherEmail: TEACHER_1_EMAIL,
          startDateTime: '2026-12-21T10:00:00.000Z',
          endDateTime: '2026-12-21T10:50:00.000Z',
          status: 'scheduled',
        },
        {
          id: 'lesson-canon-a1',
          studentUid: STUDENT_A_UID,
          teacherUid: TEACHER_1_PUBLIC_ID,
          status: 'cancelled',
          cancelledAt: '2026-12-19T00:00:00.000Z',
        },
      ];

      mockDb.unrestrictedLessonsGets = 0;

      // Student A gets only canonical lesson A1, status stays 'scheduled', phantom ignored
      const resA = await makeRequest(server, 'GET', '/api/lessons', undefined, { Authorization: 'Bearer tok-student-a' });
      assert.strictEqual(resA.status, 200);
      assert.strictEqual(resA.data.length, 1);
      assert.strictEqual(resA.data[0].id, 'lesson-canon-a1');
      assert.strictEqual(resA.data[0].status, 'scheduled');
      assert.strictEqual(mockDb.unrestrictedLessonsGets, 0, 'Student NÃO executa scan irrestrito em lessons');

      // /api/live-lessons alias returns the same canonical set
      const resLiveAlias = await makeRequest(server, 'GET', '/api/live-lessons', undefined, { Authorization: 'Bearer tok-student-a' });
      assert.strictEqual(resLiveAlias.status, 200);
      assert.strictEqual(resLiveAlias.data.length, 1);
      assert.strictEqual(resLiveAlias.data[0].id, 'lesson-canon-a1');

      // Teacher 1 gets only lesson-canon-a1 (via authUid/publicTutorId), zero unrestricted scan
      const resT1 = await makeRequest(server, 'GET', '/api/lessons', undefined, { Authorization: 'Bearer tok-teacher-1' });
      assert.strictEqual(resT1.status, 200);
      assert.strictEqual(resT1.data.length, 1);
      assert.strictEqual(resT1.data[0].id, 'lesson-canon-a1');
      assert.strictEqual(mockDb.unrestrictedLessonsGets, 0, 'Teacher NÃO executa scan irrestrito em lessons');

      // Student B only sees lesson-canon-b1
      const resB = await makeRequest(server, 'GET', '/api/lessons', undefined, { Authorization: 'Bearer tok-student-b' });
      assert.strictEqual(resB.status, 200);
      assert.strictEqual(resB.data.length, 1);
      assert.strictEqual(resB.data[0].id, 'lesson-canon-b1');

      // Admin sees all canonical lessons (2) and zero phantom memory-only lesson
      const resAdmin = await makeRequest(server, 'GET', '/api/lessons', undefined, { Authorization: 'Bearer tok-admin' });
      assert.strictEqual(resAdmin.status, 200);
      assert.strictEqual(resAdmin.data.length, 2);
      assert.ok(!resAdmin.data.some((l: any) => l.id === 'lesson-phantom-mem'), 'Admin também não recebe aula fantasma de db.liveLessons');

      clearMemoryDb();
    });

    await test('2. Rotas de busy-slots lêem exclusivamente de Firestore, ignoram db.liveLessons e não expõem PII', async () => {
      // Inject phantom scheduled slot only in db.liveLessons
      (readDb() as any).liveLessons = [
        {
          id: 'phantom-busy-slot',
          teacherUid: TEACHER_1_PUBLIC_ID,
          teacherAuthUid: TEACHER_1_UID,
          teacherEmail: TEACHER_1_EMAIL,
          studentUid: STUDENT_A_UID,
          studentEmail: STUDENT_A_EMAIL,
          startDateTime: '2026-12-22T14:00:00.000Z',
          endDateTime: '2026-12-22T14:50:00.000Z',
          status: 'scheduled',
        },
      ];

      // Add a cancelled canonical lesson in Firestore (should NOT appear as busy)
      mockDb.setDocSync('lessons', 'lesson-canon-cancelled', {
        id: 'lesson-canon-cancelled',
        studentUid: STUDENT_A_UID,
        teacherUid: TEACHER_1_PUBLIC_ID,
        teacherAuthUid: TEACHER_1_UID,
        teacherEmail: TEACHER_1_EMAIL,
        startDateTime: '2026-12-23T14:00:00.000Z',
        endDateTime: '2026-12-23T14:50:00.000Z',
        status: 'cancelled',
      });

      const endpoints = [
        `/api/teachers/${TEACHER_1_PUBLIC_ID}/busy-slots`,
        `/api/tutors/${TEACHER_1_UID}/busy-slots`,
        `/api/lessons/busy-slots?teacherUid=${TEACHER_1_UID}`,
        `/api/lessons/busy?teacherEmail=${encodeURIComponent(TEACHER_1_EMAIL)}`,
      ];

      for (const ep of endpoints) {
        const res = await makeRequest(server, 'GET', ep);
        assert.strictEqual(res.status, 200, `${ep} deve retornar 200`);
        assert.strictEqual(res.data.length, 1, `${ep} deve retornar exatamente 1 slot ativo do Firestore`);
        assert.strictEqual(res.data[0].startDateTime, '2026-12-20T10:00:00.000Z');
        assert.strictEqual(res.data[0].endDateTime, '2026-12-20T10:50:00.000Z');
        assert.deepStrictEqual(Object.keys(res.data[0]).sort(), ['endDateTime', 'startDateTime'], `${ep} deve conter zero PII`);
      }

      clearMemoryDb();
    });

    await test('3. POST /api/lessons/:id/notes desacoplado de db.liveLessons e writeDbSync, preservando Native Friends Notes', async () => {
      mockDb.appStateLessonsWrites = 0;

      // Unauthorized teacher for lesson-canon-a1 (belongs to Teacher 1 in Firestore) must get 403 even with empty db.liveLessons
      // First give Teacher 2 an active lesson link or verify mismatch on lesson-canon-a1:
      mockDb.setDocSync('lessons', 'lesson-canon-a1-t2check', {
        id: 'lesson-canon-a1-t2check',
        studentUid: STUDENT_B_UID,
        studentEmail: STUDENT_B_EMAIL,
        teacherUid: TEACHER_1_PUBLIC_ID,
        teacherAuthUid: TEACHER_1_UID,
        teacherEmail: TEACHER_1_EMAIL,
        startDateTime: '2026-12-24T10:00:00.000Z',
        endDateTime: '2026-12-24T10:50:00.000Z',
        status: 'scheduled',
      });
      // Teacher 2 is linked to Student B, so step 5 passes, and step 6 must enforce TEACHER_LESSON_MISMATCH from Firestore lessons/{id}
      const mismatchRes = await makeRequest(
        server,
        'POST',
        '/api/lessons/lesson-canon-a1-t2check/notes',
        {
          studentUid: STUDENT_B_UID,
          sessionDate: '2026-12-24',
          topic: 'Mismatch Check',
          content: 'Should be blocked by Firestore lesson teacher check',
        },
        { Authorization: 'Bearer tok-teacher-2' }
      );
      assert.strictEqual(mismatchRes.status, 403);
      assert.strictEqual(mismatchRes.data.code, 'TEACHER_LESSON_MISMATCH');

      // Authorized Teacher 1 saves Native Friend notes for lesson-canon-a1
      const saveRes = await makeRequest(
        server,
        'POST',
        '/api/lessons/lesson-canon-a1/notes',
        {
          studentUid: STUDENT_A_UID,
          sessionDate: '2026-12-20',
          topic: 'ARCH.2D.2 Native Friends Flow',
          content: '<div>Session Notes<br><span data-tag-type="new-word">✦ New Word</span>&nbsp;resilience</div>',
        },
        { Authorization: 'Bearer tok-teacher-1' }
      );
      assert.strictEqual(saveRes.status, 200);
      assert.strictEqual(saveRes.data.success, true);
      assert.strictEqual('liveLessons' in saveRes.data, false, 'Resposta de /notes não deve expor nem depender de liveLessons');
      assert.strictEqual(mockDb.appStateLessonsWrites, 0, 'POST /api/lessons/:id/notes NÃO deve disparar writeDbSync / app_state/lessons');
      assert.strictEqual(readDb().liveLessons.length, 0, 'inMemoryDb.liveLessons permanece vazio');

      // Verify canonical Firestore writes: session_notes, users/{uid}/session_notes, and lessons/{lessonId}
      const savedSessionNote = mockDb.getDocSync('session_notes', 'lesson-canon-a1');
      assert.ok(savedSessionNote, 'session_notes/{lessonId} gravado no Firestore');
      assert.ok(savedSessionNote.rawContent.includes('resilience'));

      const savedLesson = mockDb.getDocSync('lessons', 'lesson-canon-a1');
      assert.ok(savedLesson.sessionNotesDocument.includes('resilience'), 'lessons/{lessonId} atualizado com notas');

      // Student A reads note via GET /api/session-notes
      const getNoteRes = await makeRequest(
        server,
        'GET',
        '/api/session-notes?lessonId=lesson-canon-a1',
        undefined,
        { Authorization: 'Bearer tok-student-a' }
      );
      assert.strictEqual(getNoteRes.status, 200);
      assert.ok(getNoteRes.data.rawContent.includes('resilience'));
    });

    await test('4. Inicialização e app_state/lessons não reintroduzem aulas antigas e preservam contractedLessons/homework', async () => {
      // Seed legacy app_state/lessons containing stale liveLessons alongside contractedLessons & weeklyHomework
      mockDb.setDocSync('app_state', 'lessons', {
        liveLessons: [
          {
            id: 'legacy-zombie-lesson-1',
            studentUid: STUDENT_A_UID,
            studentEmail: STUDENT_A_EMAIL,
            teacherUid: TEACHER_1_PUBLIC_ID,
            startDateTime: '2025-01-01T10:00:00.000Z',
            endDateTime: '2025-01-01T10:50:00.000Z',
            status: 'scheduled',
          },
        ],
        contractedLessons: {
          [STUDENT_A_EMAIL]: { credits: 4 },
        },
        weeklyHomework: [{ id: 'hw-1', title: 'Homework 1' }],
        studentHomeworkMap: { [STUDENT_A_UID]: { answer: 'ok' } },
      });
      mockDb.setDocSync('app_state', 'main', {
        liveLessons: [{ id: 'legacy-zombie-in-main', status: 'scheduled' }],
      });

      const fetchedState = await fetchAppStateFromFirestore();
      assert.ok(fetchedState, 'fetchAppStateFromFirestore retorna estado não nulo');
      assert.strictEqual('liveLessons' in fetchedState, false, 'fetchAppStateFromFirestore remove liveLessons legadas');
      assert.deepStrictEqual(fetchedState.contractedLessons, { [STUDENT_A_EMAIL]: { credits: 4 } }, 'contractedLessons preservado');
      assert.deepStrictEqual(fetchedState.weeklyHomework, [{ id: 'hw-1', title: 'Homework 1' }], 'weeklyHomework preservado');
      assert.deepStrictEqual(fetchedState.studentHomeworkMap, { [STUDENT_A_UID]: { answer: 'ok' } }, 'studentHomeworkMap preservado');

      // Ensure app_state/lessons document was NOT deleted
      const appStateLessonsDoc = mockDb.getDocSync('app_state', 'lessons');
      assert.ok(appStateLessonsDoc, 'Documento app_state/lessons NÃO deve ser excluído do Firestore');

      // Run initCloudPersistence and verify inMemoryDb.liveLessons remains empty
      (readDb() as any).liveLessons = [{ id: 'stale-local-zombie', status: 'scheduled' }];
      await initCloudPersistence();
      assert.strictEqual(readDb().liveLessons.length, 0, 'initCloudPersistence não reintroduz aulas legadas');

      // Verify saveAppStateToFirestore writes app_state/lessons without liveLessons when saving fresh state
      mockDb.store.delete('app_state::lessons');
      await saveAppStateToFirestore(readDb());
      const persistedAppStateLessons = mockDb.getDocSync('app_state', 'lessons');
      assert.ok(persistedAppStateLessons, 'app_state/lessons preservado após saveAppStateToFirestore');
      assert.strictEqual('liveLessons' in persistedAppStateLessons, false, 'app_state/lessons salvo sem campo liveLessons');
      assert.deepStrictEqual(persistedAppStateLessons.contractedLessons, { [STUDENT_A_EMAIL]: { credits: 4 } });

      clearMemoryDb();
    });

    await test('5. Fluxo completo (agendamento, consulta, reagendamento, notas, cancelamento) sem dependência de db.liveLessons ou app_state/lessons', async () => {
      mockDb.store.delete('app_state::lessons');
      mockDb.appStateLessonsWrites = 0;

      // Schedule
      const schedRes = await makeRequest(
        server,
        'POST',
        '/api/lessons/schedule',
        {
          requestId: 'lesson-e2e-arch2d2',
          teacherUid: TEACHER_1_UID,
          startDateTime: '2026-12-28T15:00:00.000Z',
          endDateTime: '2026-12-28T15:50:00.000Z',
          title: 'E2E ARCH.2D.2 Lesson',
          isTrialLesson: false,
        },
        { Authorization: 'Bearer tok-student-a' }
      );
      assert.strictEqual(schedRes.status, 200, `Agendamento deve retornar 200 (retornou ${schedRes.status}: ${JSON.stringify(schedRes.data)})`);
      assert.strictEqual(readDb().liveLessons.length, 0);

      // Query via GET /api/lessons & busy-slots
      const listRes = await makeRequest(server, 'GET', '/api/lessons', undefined, { Authorization: 'Bearer tok-student-a' });
      assert.strictEqual(listRes.status, 200);
      assert.ok(listRes.data.some((l: any) => l.id === 'lesson-e2e-arch2d2'));

      const busyRes = await makeRequest(server, 'GET', `/api/teachers/${TEACHER_1_PUBLIC_ID}/busy-slots`);
      assert.strictEqual(busyRes.status, 200);
      assert.ok(busyRes.data.some((s: any) => s.startDateTime === '2026-12-28T15:00:00.000Z'));

      // Propose + Accept Reschedule
      const propRes = await makeRequest(
        server,
        'POST',
        '/api/lessons/lesson-e2e-arch2d2/reschedule',
        {
          newStartIso: '2026-12-29T16:00:00.000Z',
          newEndIso: '2026-12-29T16:50:00.000Z',
          reason: 'Schedule update',
        },
        { Authorization: 'Bearer tok-student-a' }
      );
      assert.strictEqual(propRes.status, 200);

      const acceptRes = await makeRequest(
        server,
        'POST',
        '/api/lessons/lesson-e2e-arch2d2/accept-reschedule',
        {},
        { Authorization: 'Bearer tok-teacher-1' }
      );
      assert.strictEqual(acceptRes.status, 200);
      assert.strictEqual(acceptRes.data.lesson.startDateTime, '2026-12-29T16:00:00.000Z');

      // Notes
      const notesRes = await makeRequest(
        server,
        'POST',
        '/api/lessons/lesson-e2e-arch2d2/notes',
        {
          studentUid: STUDENT_A_UID,
          sessionDate: '2026-12-29',
          topic: 'Rescheduled Session Notes',
          content: '<div>Great progress!</div>',
        },
        { Authorization: 'Bearer tok-teacher-1' }
      );
      assert.strictEqual(notesRes.status, 200);

      // Cancel (more than 24h in advance -> credit refunded)
      const cancelRes = await makeRequest(
        server,
        'POST',
        '/api/lessons/lesson-e2e-arch2d2/cancel',
        { reason: 'E2E cleanup' },
        { Authorization: 'Bearer tok-student-a' }
      );
      assert.strictEqual(cancelRes.status, 200);
      assert.strictEqual(cancelRes.data.lesson.status, 'cancelled');

      // Confirm zero writes to app_state/lessons and empty db.liveLessons throughout entire lifecycle
      assert.strictEqual(mockDb.appStateLessonsWrites, 0, 'Ciclo completo não grava em app_state/lessons');
      assert.strictEqual(mockDb.getDocSync('app_state', 'lessons'), undefined, 'app_state/lessons não foi recriado');
      assert.strictEqual(readDb().liveLessons.length, 0, 'db.liveLessons permanece vazio');
    });

    await test('6. Auditoria estática confirma remoção de db.liveLessons nas rotas consolidadas de serverApp.ts', () => {
      const src = fs.readFileSync(path.join(process.cwd(), 'serverApp.ts'), 'utf8');
      const codeWithoutComments = src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      assert.ok(!codeWithoutComments.includes('db.liveLessons'), 'serverApp.ts não referencia db.liveLessons em código');
      assert.ok(!codeWithoutComments.includes('readDb().liveLessons'), 'serverApp.ts não referencia readDb().liveLessons em código');
      assert.ok(!codeWithoutComments.includes('inMemoryDb.liveLessons'), 'serverApp.ts não referencia inMemoryDb.liveLessons em código');
      assert.ok(!codeWithoutComments.includes('cloudState.liveLessons'), 'serverApp.ts não referencia cloudState.liveLessons em código');
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    clearMemoryDb();
    resetFirebaseAdminFirestoreForTesting();
    resetFirebaseAdminForTesting();
    if (origProjectId === undefined) delete process.env.FIREBASE_PROJECT_ID;
    else process.env.FIREBASE_PROJECT_ID = origProjectId;
  }

  console.log('\n======================================================================');
  console.log(`ARCH.2D.2 TEST SUMMARY: ${passed} PASSED | ${failed} FAILED`);
  console.log('======================================================================');

  process.exit(failed > 0 ? 1 : 0);
}

runArch2D2Tests().catch((err) => {
  console.error('Fatal error in ARCH.2D.2 suite:', err);
  process.exit(1);
});
