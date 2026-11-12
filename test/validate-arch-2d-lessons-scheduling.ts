import assert from 'assert';
import fs from 'fs';
import http from 'http';
import path from 'path';
import {
  app as serverApp,
  readDb,
} from '../serverApp';
import {
  setFirebaseAdminFirestoreForTesting,
  resetFirebaseAdminFirestoreForTesting,
} from '../src/serverFirestore';
import {
  ALLOWED_STAGING_PROJECT_ID,
  setFirebaseAdminAuthForTesting,
  resetFirebaseAdminForTesting,
} from '../src/serverFirebaseAdmin';

/**
 * In-memory Firestore (default) mock with OCC + transaction.delete support
 */
class MockArch2DFirestore {
  public projectId = ALLOWED_STAGING_PROJECT_ID;
  public databaseId = '(default)';
  public store = new Map<string, { data: any; version: number }>();

  private getKey(col: string, id: string) {
    return `${col}::${id}`;
  }

  public getDocSync(colPath: string, docId: string) {
    const entry = this.store.get(this.getKey(colPath, docId));
    return entry ? JSON.parse(JSON.stringify(entry.data)) : undefined;
  }

  public countCollectionDocs(colPath: string): number {
    const prefix = `${colPath}::`;
    let count = 0;
    for (const key of this.store.keys()) {
      const rest = key.slice(prefix.length);
      if (key.startsWith(prefix) && !rest.includes('/')) {
        count++;
      }
    }
    return count;
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
      { host: '127.0.0.1', port: addr.port, path: reqPath, method, headers: reqHeaders },
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

function clearInMemoryLegacyState() {
  const db = readDb() as any;
  db.liveLessons = [];
  db.students = [];
  db.userProfiles = {};
  db.authUsers = {};
  db.tutorsList = [];
  db.teachers = [];
  db.contractedLessons = {};
}

async function runArch2DTests() {
  console.log('======================================================================');
  console.log("IT'S SIMPLE — ARCH.2D MANDATORY VALIDATION SUITE");
  console.log('Consolidação de Aulas e Agendamentos no Firestore (default)');
  console.log('======================================================================\n');

  let passed = 0;
  let failed = 0;

  async function test(name: string, fn: () => void | Promise<void>) {
    try {
      await fn();
      passed++;
      console.log(`  [PASS] ${name}`);
    } catch (err: any) {
      failed++;
      console.error(`  [FAIL] ${name}`);
      console.error(`         ${err?.stack || err?.message || err}`);
    }
  }

  const origProjectId = process.env.FIREBASE_PROJECT_ID;
  process.env.FIREBASE_PROJECT_ID = ALLOWED_STAGING_PROJECT_ID;

  const STUDENT_A_UID = 'StudentACanonUid123456789012';
  const STUDENT_A_EMAIL = 'student.a@itissimple.com';
  const STUDENT_B_UID = 'StudentBCanonUid123456789012';
  const STUDENT_B_EMAIL = 'student.b@itissimple.com';
  const TEACHER_1_UID = 'Teacher1CanonUid123456789012';
  const TEACHER_1_EMAIL = 'teacher.one@itissimple.com';
  const TEACHER_2_UID = 'Teacher2CanonUid123456789012';
  const TEACHER_2_EMAIL = 'teacher.two@itissimple.com';
  const ADMIN_UID = 'AdminCanonUid123456789012345';
  const ADMIN_EMAIL = 'admin@itissimple.com';

  const mockDb = new MockArch2DFirestore();
  setFirebaseAdminFirestoreForTesting(mockDb as any);

  const tokenMap: Record<string, any> = {
    'tok-student-a': { uid: STUDENT_A_UID, email: STUDENT_A_EMAIL, email_verified: true, role: 'student' },
    'tok-student-b': { uid: STUDENT_B_UID, email: STUDENT_B_EMAIL, email_verified: true, role: 'student' },
    'tok-teacher-1': { uid: TEACHER_1_UID, email: TEACHER_1_EMAIL, email_verified: true }, // no teacher custom claim!
    'tok-teacher-2': { uid: TEACHER_2_UID, email: TEACHER_2_EMAIL, email_verified: true }, // no teacher custom claim!
    'tok-admin': { uid: ADMIN_UID, email: ADMIN_EMAIL, email_verified: true, role: 'admin' },
  };

  setFirebaseAdminAuthForTesting({
    verifyIdToken: async (token: string) => {
      const u = tokenMap[token];
      if (!u) throw new Error('Invalid Firebase ID Token');
      return u;
    },
    getUser: async (uid: string) => {
      const found = Object.values(tokenMap).find((u) => u.uid === uid);
      if (!found) throw new Error('User not found');
      return found;
    },
    getUserByEmail: async (email: string) => {
      const found = Object.values(tokenMap).find((u) => u.email === email.toLowerCase());
      if (!found) throw new Error('User not found');
      return found;
    },
  } as any);

  // Seed canonical Firestore users & tutors
  await mockDb.collection('users').doc(STUDENT_A_UID).set({
    uid: STUDENT_A_UID,
    id: STUDENT_A_UID,
    email: STUDENT_A_EMAIL,
    name: 'Student A',
    role: 'student',
    availableLessons: 5,
    contractedLessons: 5,
    hasCompletedTrialLesson: true,
    onboardingCompleted: true,
  });

  await mockDb.collection('users').doc(STUDENT_B_UID).set({
    uid: STUDENT_B_UID,
    id: STUDENT_B_UID,
    email: STUDENT_B_EMAIL,
    name: 'Student B',
    role: 'student',
    availableLessons: 3,
    contractedLessons: 3,
    hasCompletedTrialLesson: false,
    onboardingCompleted: false,
  });

  await mockDb.collection('users').doc(TEACHER_1_UID).set({
    uid: TEACHER_1_UID,
    id: TEACHER_1_UID,
    authUid: TEACHER_1_UID,
    email: TEACHER_1_EMAIL,
    name: 'Teacher One',
    role: 'teacher',
    approvalStatus: 'approved',
    isApproved: true,
    status: 'approved',
    publicTutorId: 'teacher-one',
    meetUrl: 'https://meet.google.com/teacher-one-room',
  });
  await mockDb.collection('tutors').doc(TEACHER_1_UID).set({
    uid: TEACHER_1_UID,
    id: TEACHER_1_UID,
    authUid: TEACHER_1_UID,
    email: TEACHER_1_EMAIL,
    name: 'Teacher One',
    role: 'teacher',
    approvalStatus: 'approved',
    isApproved: true,
    status: 'approved',
    publicTutorId: 'teacher-one',
    meetUrl: 'https://meet.google.com/teacher-one-room',
  });

  await mockDb.collection('users').doc(TEACHER_2_UID).set({
    uid: TEACHER_2_UID,
    id: TEACHER_2_UID,
    authUid: TEACHER_2_UID,
    email: TEACHER_2_EMAIL,
    name: 'Teacher Two',
    role: 'teacher',
    approvalStatus: 'approved',
    isApproved: true,
    status: 'approved',
    publicTutorId: 'teacher-two',
    meetUrl: 'https://meet.google.com/teacher-two-room',
  });
  await mockDb.collection('tutors').doc(TEACHER_2_UID).set({
    uid: TEACHER_2_UID,
    id: TEACHER_2_UID,
    authUid: TEACHER_2_UID,
    email: TEACHER_2_EMAIL,
    name: 'Teacher Two',
    role: 'teacher',
    approvalStatus: 'approved',
    isApproved: true,
    status: 'approved',
    publicTutorId: 'teacher-two',
    meetUrl: 'https://meet.google.com/teacher-two-room',
  });

  clearInMemoryLegacyState();

  const server = http.createServer(serverApp);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  let lesson1Id = 'lesson-arch2d-1';
  let lesson2Id = 'lesson-arch2d-2';
  let lesson3Id = 'lesson-arch2d-3';
  let lessonTrialId = 'lesson-arch2d-trial';
  let lessonDeleteId = 'lesson-arch2d-delete';

  try {
    // -----------------------------------------------------------------------
    // 1. Agendamento de aula no Firestore (sem db.liveLessons / sem mecanismo paralelo)
    // -----------------------------------------------------------------------
    await test('1. Agendamento no Firestore via /schedule, /lessons e /live-lessons (sem db.liveLessons)', async () => {
      // 1A: POST /api/lessons/schedule
      const res1 = await makeRequest(
        server,
        'POST',
        '/api/lessons/schedule',
        {
          requestId: lesson1Id,
          teacherUid: TEACHER_1_UID,
          startDateTime: '2026-12-01T14:00:00.000Z',
          endDateTime: '2026-12-01T14:50:00.000Z',
          title: 'Arch2D Lesson 1',
          isTrialLesson: false,
        },
        { Authorization: 'Bearer tok-student-a' }
      );
      assert.strictEqual(res1.status, 200);
      assert.strictEqual(res1.data.success, true);
      assert.strictEqual(res1.data.remainingLessons, 4);
      assert.strictEqual(readDb().liveLessons.length, 0, 'POST /api/lessons/schedule NÃO escreve em db.liveLessons');

      const fsLesson1 = mockDb.getDocSync('lessons', lesson1Id);
      const fsStudentSub1 = mockDb.getDocSync(`users/${STUDENT_A_UID}/lessons`, lesson1Id);
      const fsTeacherSub1 = mockDb.getDocSync(`users/${TEACHER_1_UID}/lessons`, lesson1Id);
      assert.ok(fsLesson1, 'Persistida em lessons/{lessonId}');
      assert.ok(fsStudentSub1, 'Vínculo persistido em users/{studentUid}/lessons/{lessonId}');
      assert.ok(fsTeacherSub1, 'Vínculo persistido em users/{teacherUid}/lessons/{lessonId}');

      // 1B: POST /api/lessons delega ao mecanismo transacional único
      const res2 = await makeRequest(
        server,
        'POST',
        '/api/lessons',
        {
          lesson: {
            id: lesson2Id,
            teacherUid: TEACHER_1_UID,
            startDateTime: '2026-12-02T14:00:00.000Z',
            endDateTime: '2026-12-02T14:50:00.000Z',
            title: 'Arch2D Lesson 2',
          },
        },
        { Authorization: 'Bearer tok-student-a' }
      );
      assert.strictEqual(res2.status, 200);
      assert.strictEqual(res2.data.remainingLessons, 3);
      assert.strictEqual(readDb().liveLessons.length, 0, 'POST /api/lessons NÃO escreve em db.liveLessons');
      assert.strictEqual(readDb().students.length, 0, 'POST /api/lessons NÃO cria IDs sintéticos em db.students');

      // 1C: POST /api/live-lessons delega ao mecanismo transacional único + bloqueia array em massa
      const bulkAttempt = await makeRequest(
        server,
        'POST',
        '/api/live-lessons',
        { lessons: [{ id: 'fake-1' }] },
        { Authorization: 'Bearer tok-admin' }
      );
      assert.strictEqual(bulkAttempt.status, 403, 'Sobrescrita em massa de db.liveLessons bloqueada com 403');

      const res3 = await makeRequest(
        server,
        'POST',
        '/api/live-lessons',
        {
          lesson: {
            id: lesson3Id,
            teacherUid: TEACHER_1_UID,
            startDateTime: '2026-12-03T14:00:00.000Z',
            endDateTime: '2026-12-03T14:50:00.000Z',
            title: 'Arch2D Lesson 3',
          },
        },
        { Authorization: 'Bearer tok-student-a' }
      );
      assert.strictEqual(res3.status, 200);
      assert.strictEqual(res3.data.remainingLessons, 2);
      assert.strictEqual(readDb().liveLessons.length, 0, 'POST /api/live-lessons NÃO escreve em db.liveLessons');
    });

    // -----------------------------------------------------------------------
    // 2. Conclusão e não conclusão + Preservação de Native Friends Notes (8)
    // -----------------------------------------------------------------------
    await test('2 & 8. Conclusão, não conclusão e preservação de vínculos Native Friends Notes', async () => {
      // Seed Native Friends Notes links onto lesson1 and lesson2 in Firestore
      await mockDb.collection('lessons').doc(lesson1Id).set(
        {
          liveNotes: 'Excellent progress with phrasal verbs',
          recommendations: 'Practice daily 15 min',
          sessionNotesDocument: 'Approved Note v1',
          vocabularyNotes: [{ word: 'break down', definition: 'stop working', portuguese: 'quebrar' }],
          driveFileId: 'drive-file-123',
          driveFileUrl: 'https://drive.google.com/file/d/drive-file-123',
          approvedVersion: 1,
        },
        { merge: true }
      );
      await mockDb.collection('session_notes').doc(lesson1Id).set({
        id: lesson1Id,
        lessonId: lesson1Id,
        studentUid: STUDENT_A_UID,
        teacherUid: TEACHER_1_UID,
        rawContent: 'Approved session notes content',
        approved: true,
      });

      // Complete lesson 1 as Teacher 1
      const completeRes = await makeRequest(
        server,
        'POST',
        `/api/lessons/${lesson1Id}/complete`,
        {},
        { Authorization: 'Bearer tok-teacher-1' }
      );
      assert.strictEqual(completeRes.status, 200);
      assert.strictEqual(completeRes.data.lesson.status, 'completed');
      assert.strictEqual(completeRes.data.lesson.liveNotes, 'Excellent progress with phrasal verbs', 'liveNotes preservado');
      assert.strictEqual(completeRes.data.lesson.driveFileId, 'drive-file-123', 'driveFileId preservado');
      assert.strictEqual(completeRes.data.lesson.approvedVersion, 1, 'approvedVersion preservado');
      assert.ok(mockDb.getDocSync('session_notes', lesson1Id)?.approved === true, 'session_notes vinculada preservada');

      const studentDocAfterComplete = mockDb.getDocSync('users', STUDENT_A_UID);
      assert.strictEqual(studentDocAfterComplete.availableLessons, 2, 'Conclusão não debita crédito duplicado');

      // Non-completion: Teacher 1 marks lesson2 as not_completed (responsible: teacher) -> refunds +1 (2 -> 3)
      const notCompTeacherRes = await makeRequest(
        server,
        'POST',
        `/api/lessons/${lesson2Id}/not-completed`,
        { responsible: 'teacher', reason: 'Internet outage' },
        { Authorization: 'Bearer tok-teacher-1' }
      );
      assert.strictEqual(notCompTeacherRes.status, 200);
      assert.strictEqual(notCompTeacherRes.data.lesson.status, 'not_completed');
      assert.strictEqual(notCompTeacherRes.data.remainingLessons, 3, 'Imprevisto do professor estorna +1 crédito pago');
      assert.strictEqual(notCompTeacherRes.data.creditRefunded, true);

      // Non-completion: Student A tries marking lesson3 as teacher responsible -> 403 Forbidden!
      const studentBlameTeacher = await makeRequest(
        server,
        'POST',
        `/api/lessons/${lesson3Id}/not-completed`,
        { responsible: 'teacher', reason: 'Trying to self-refund' },
        { Authorization: 'Bearer tok-student-a' }
      );
      assert.strictEqual(studentBlameTeacher.status, 403, 'Aluno não pode conceder autoestorno via not-completed');

      // Non-completion: responsible student -> keeps balance at 3 (no refund)
      const notCompStudentRes = await makeRequest(
        server,
        'POST',
        `/api/lessons/${lesson3Id}/not-completed`,
        { responsible: 'student', reason: 'Student missed session' },
        { Authorization: 'Bearer tok-teacher-1' }
      );
      assert.strictEqual(notCompStudentRes.status, 200);
      assert.strictEqual(notCompStudentRes.data.remainingLessons, 3, 'Falta do aluno não estorna crédito');
      assert.strictEqual(notCompStudentRes.data.creditRefunded, false);
    });

    // -----------------------------------------------------------------------
    // 3. Reagendamento aceito e recusado (sem duplicidade e sem débito extra)
    // -----------------------------------------------------------------------
    await test('3. Reagendamento aceito e recusado no Firestore (conflito + idempotência + notas preservadas)', async () => {
      // Schedule a fresh paid lesson for reschedule tests (balance: 3 -> 2)
      const reschedLessonId = 'lesson-arch2d-reschedule';
      const bookRes = await makeRequest(
        server,
        'POST',
        '/api/lessons/schedule',
        {
          requestId: reschedLessonId,
          teacherUid: TEACHER_1_UID,
          startDateTime: '2026-12-04T14:00:00.000Z',
          endDateTime: '2026-12-04T14:50:00.000Z',
          title: 'Reschedule Test Lesson',
          isTrialLesson: false,
        },
        { Authorization: 'Bearer tok-student-a' }
      );
      assert.strictEqual(bookRes.status, 200);
      assert.strictEqual(bookRes.data.remainingLessons, 2);

      // Preserve notes field before reschedule
      await mockDb.collection('lessons').doc(reschedLessonId).set(
        {
          liveNotes: 'Pre-reschedule teacher note',
          vocabularyNotes: [{ word: 'reschedule', definition: 'change time', portuguese: 'reagendar' }],
        },
        { merge: true }
      );

      // Student B schedules another lesson with Teacher 1 at 2026-12-05T16:00Z (trial)
      const conflictBook = await makeRequest(
        server,
        'POST',
        '/api/lessons/schedule',
        {
          requestId: lessonTrialId,
          teacherUid: TEACHER_1_UID,
          startDateTime: '2026-12-05T16:00:00.000Z',
          endDateTime: '2026-12-05T16:25:00.000Z',
          title: 'Trial Student B',
          isTrialLesson: true,
        },
        { Authorization: 'Bearer tok-student-b' }
      );
      assert.strictEqual(conflictBook.status, 200);

      // Propose conflicting reschedule -> 409
      const conflictProp = await makeRequest(
        server,
        'POST',
        `/api/lessons/${reschedLessonId}/reschedule`,
        {
          newStartIso: '2026-12-05T16:05:00.000Z',
          newEndIso: '2026-12-05T16:55:00.000Z',
          reason: 'Overlap attempt',
        },
        { Authorization: 'Bearer tok-student-a' }
      );
      assert.strictEqual(conflictProp.status, 409, 'Conflito de horário bloqueia proposta de reagendamento');

      // Student A proposes valid reschedule
      const prop1 = await makeRequest(
        server,
        'POST',
        `/api/lessons/${reschedLessonId}/reschedule`,
        {
          newStartIso: '2026-12-06T15:00:00.000Z',
          newEndIso: '2026-12-06T15:50:00.000Z',
          reason: 'Work conflict',
        },
        { Authorization: 'Bearer tok-student-a' }
      );
      assert.strictEqual(prop1.status, 200);
      assert.strictEqual(prop1.data.lesson.proposalStatus, 'pending_teacher_reschedule');

      // Student A cannot self-accept their own proposal -> 403
      const selfAccept = await makeRequest(
        server,
        'POST',
        `/api/lessons/${reschedLessonId}/accept-reschedule`,
        {},
        { Authorization: 'Bearer tok-student-a' }
      );
      assert.strictEqual(selfAccept.status, 403, 'Proponente não pode auto-aceitar reagendamento');

      // Teacher 1 declines proposal -> keeps original time
      const declineRes = await makeRequest(
        server,
        'POST',
        `/api/lessons/${reschedLessonId}/decline-reschedule`,
        {},
        { Authorization: 'Bearer tok-teacher-1' }
      );
      assert.strictEqual(declineRes.status, 200);
      assert.strictEqual(declineRes.data.lesson.startDateTime, '2026-12-04T14:00:00.000Z');
      assert.strictEqual(declineRes.data.lesson.proposedNewStartDateTime, null);

      // Teacher 1 proposes new time -> Student A accepts
      const prop2 = await makeRequest(
        server,
        'POST',
        `/api/lessons/${reschedLessonId}/reschedule`,
        {
          newStartIso: '2026-12-07T18:00:00.000Z',
          newEndIso: '2026-12-07T18:50:00.000Z',
          reason: 'Better slot',
        },
        { Authorization: 'Bearer tok-teacher-1' }
      );
      assert.strictEqual(prop2.status, 200);
      assert.strictEqual(prop2.data.lesson.proposalStatus, 'pending_student_reschedule');

      const lessonCountBefore = mockDb.countCollectionDocs('lessons');
      const acceptRes = await makeRequest(
        server,
        'POST',
        `/api/lessons/${reschedLessonId}/accept-reschedule`,
        {},
        { Authorization: 'Bearer tok-student-a' }
      );
      assert.strictEqual(acceptRes.status, 200);
      assert.strictEqual(acceptRes.data.lesson.startDateTime, '2026-12-07T18:00:00.000Z');
      assert.strictEqual(acceptRes.data.lesson.liveNotes, 'Pre-reschedule teacher note', 'Notas preservadas após reagendamento');
      assert.strictEqual(mockDb.countCollectionDocs('lessons'), lessonCountBefore, 'Nenhuma aula duplicada criada');
      assert.strictEqual(mockDb.getDocSync('users', STUDENT_A_UID).availableLessons, 2, 'Nenhum crédito extra debitado');
    });

    // -----------------------------------------------------------------------
    // 4 & 5. Cancelamento, consistência de créditos e exclusão (DELETE)
    // -----------------------------------------------------------------------
    await test('4 & 5. Cancelamento, DELETE e consistência sem estorno/débito duplicado', async () => {
      // Student A schedules a paid lesson (balance: 2 -> 1)
      const cancelPaidId = 'lesson-arch2d-cancel-paid';
      const bookPaid = await makeRequest(
        server,
        'POST',
        '/api/lessons/schedule',
        {
          requestId: cancelPaidId,
          teacherUid: TEACHER_1_UID,
          startDateTime: '2026-12-08T14:00:00.000Z',
          endDateTime: '2026-12-08T14:50:00.000Z',
          title: 'Paid Cancel Test',
          isTrialLesson: false,
        },
        { Authorization: 'Bearer tok-student-a' }
      );
      assert.strictEqual(bookPaid.status, 200);
      assert.strictEqual(bookPaid.data.remainingLessons, 1);

      // Teacher 1 cancels -> refunds +1 once (1 -> 2)
      const teacherCancel1 = await makeRequest(
        server,
        'POST',
        `/api/lessons/${cancelPaidId}/cancel`,
        { cancelledBy: 'teacher', reason: 'Teacher illness' },
        { Authorization: 'Bearer tok-teacher-1' }
      );
      assert.strictEqual(teacherCancel1.status, 200);
      assert.strictEqual(teacherCancel1.data.remainingLessons, 2);
      assert.strictEqual(teacherCancel1.data.creditRefunded, true);

      // Idempotent repeat cancel -> NO duplicate refund!
      const teacherCancel2 = await makeRequest(
        server,
        'POST',
        `/api/lessons/${cancelPaidId}/cancel`,
        { cancelledBy: 'teacher', reason: 'Retry' },
        { Authorization: 'Bearer tok-teacher-1' }
      );
      assert.strictEqual(teacherCancel2.status, 200);
      assert.strictEqual(teacherCancel2.data.isIdempotent, true);
      assert.strictEqual(mockDb.getDocSync('users', STUDENT_A_UID).availableLessons, 2, 'Sem estorno duplicado');

      // Student A schedules another paid lesson (2 -> 1), tries to cancel claiming cancelledBy: 'teacher' -> server forces 'student' & NO refund!
      const studentCancelId = 'lesson-arch2d-cancel-student';
      await makeRequest(
        server,
        'POST',
        '/api/lessons/schedule',
        {
          requestId: studentCancelId,
          teacherUid: TEACHER_1_UID,
          startDateTime: '2026-12-09T14:00:00.000Z',
          endDateTime: '2026-12-09T14:50:00.000Z',
          title: 'Student Cancel Test',
          isTrialLesson: false,
        },
        { Authorization: 'Bearer tok-student-a' }
      );
      assert.strictEqual(mockDb.getDocSync('users', STUDENT_A_UID).availableLessons, 1);

      const studentSpoofCancel = await makeRequest(
        server,
        'POST',
        `/api/lessons/${studentCancelId}/cancel`,
        { cancelledBy: 'teacher', reason: 'Spoof attempt' },
        { Authorization: 'Bearer tok-student-a' }
      );
      assert.strictEqual(studentSpoofCancel.status, 200);
      assert.strictEqual(studentSpoofCancel.data.lesson.cancelledBy, 'student', 'Backend força cancelledBy=student');
      assert.strictEqual(studentSpoofCancel.data.creditRefunded, false);
      assert.strictEqual(mockDb.getDocSync('users', STUDENT_A_UID).availableLessons, 1, 'Sem autoestorno por aluno');

      // Trial lesson cancelled by teacher must NOT mint paid credits!
      const studentBBalanceBeforeTrialCancel = mockDb.getDocSync('users', STUDENT_B_UID).availableLessons;
      const trialCancelRes = await makeRequest(
        server,
        'POST',
        `/api/lessons/${lessonTrialId}/cancel`,
        { cancelledBy: 'teacher', reason: 'Teacher reschedule' },
        { Authorization: 'Bearer tok-teacher-1' }
      );
      assert.strictEqual(trialCancelRes.status, 200);
      assert.strictEqual(trialCancelRes.data.creditRefunded, false);
      assert.strictEqual(
        mockDb.getDocSync('users', STUDENT_B_UID).availableLessons,
        studentBBalanceBeforeTrialCancel,
        'Cancelamento de trial não gera crédito pago'
      );

      // Admin DELETE on active scheduled paid lesson restores +1 credit and deletes root + subcollections
      await makeRequest(
        server,
        'POST',
        '/api/lessons/schedule',
        {
          requestId: lessonDeleteId,
          teacherUid: TEACHER_1_UID,
          startDateTime: '2026-12-10T14:00:00.000Z',
          endDateTime: '2026-12-10T14:50:00.000Z',
          title: 'Delete Test Lesson',
          isTrialLesson: false,
        },
        { Authorization: 'Bearer tok-student-a' }
      );
      assert.strictEqual(mockDb.getDocSync('users', STUDENT_A_UID).availableLessons, 0);

      const studentDeleteActive = await makeRequest(
        server,
        'DELETE',
        `/api/lessons/${lessonDeleteId}`,
        undefined,
        { Authorization: 'Bearer tok-student-a' }
      );
      assert.strictEqual(studentDeleteActive.status, 403, 'Aluno não pode deletar aula ativa via DELETE');

      const adminDeleteRes = await makeRequest(
        server,
        'DELETE',
        `/api/lessons/${lessonDeleteId}`,
        undefined,
        { Authorization: 'Bearer tok-admin' }
      );
      assert.strictEqual(adminDeleteRes.status, 200);
      assert.strictEqual(adminDeleteRes.data.creditRefunded, true);
      assert.strictEqual(adminDeleteRes.data.remainingLessons, 1);
      assert.strictEqual(mockDb.getDocSync('lessons', lessonDeleteId), undefined, 'Documento removido de lessons/{id}');
      assert.strictEqual(mockDb.getDocSync(`users/${STUDENT_A_UID}/lessons`, lessonDeleteId), undefined, 'Vínculo removido do aluno');
      assert.strictEqual(mockDb.getDocSync(`users/${TEACHER_1_UID}/lessons`, lessonDeleteId), undefined, 'Vínculo removido do professor');
    });

    // -----------------------------------------------------------------------
    // 6. Autorização por aluno, professor e administrador
    // -----------------------------------------------------------------------
    await test('6. Autorização estrita por aluno, professor e administrador (401/403)', async () => {
      const targetId = 'lesson-arch2d-authz';
      await makeRequest(
        server,
        'POST',
        '/api/lessons/schedule',
        {
          requestId: targetId,
          teacherUid: TEACHER_1_UID,
          startDateTime: '2026-12-11T14:00:00.000Z',
          endDateTime: '2026-12-11T14:50:00.000Z',
          title: 'AuthZ Lesson',
          isTrialLesson: false,
        },
        { Authorization: 'Bearer tok-student-a' }
      );

      // Unauthenticated -> 401 across all consolidated endpoints
      for (const [m, p] of [
        ['POST', '/api/lessons/schedule'],
        ['POST', '/api/lessons'],
        ['POST', '/api/live-lessons'],
        ['POST', `/api/lessons/${targetId}/complete`],
        ['POST', `/api/lessons/${targetId}/not-completed`],
        ['POST', `/api/lessons/${targetId}/reschedule`],
        ['POST', `/api/lessons/${targetId}/accept-reschedule`],
        ['POST', `/api/lessons/${targetId}/decline-reschedule`],
        ['POST', `/api/lessons/${targetId}/cancel`],
        ['DELETE', `/api/lessons/${targetId}`],
      ]) {
        const unauth = await makeRequest(server, m, p, {});
        assert.strictEqual(unauth.status, 401, `${m} ${p} sem token retorna 401`);
      }

      // Student B cannot complete/cancel/reschedule/delete Student A's lesson
      const sBComplete = await makeRequest(
        server,
        'POST',
        `/api/lessons/${targetId}/complete`,
        {},
        { Authorization: 'Bearer tok-student-b' }
      );
      assert.strictEqual(sBComplete.status, 403, 'Outro aluno recebe 403 em complete');

      const sBCancel = await makeRequest(
        server,
        'POST',
        `/api/lessons/${targetId}/cancel`,
        {},
        { Authorization: 'Bearer tok-student-b' }
      );
      assert.strictEqual(sBCancel.status, 403, 'Outro aluno recebe 403 em cancel');

      // Teacher 2 (approved, but NOT assigned to this lesson) receives 403
      const t2Complete = await makeRequest(
        server,
        'POST',
        `/api/lessons/${targetId}/complete`,
        {},
        { Authorization: 'Bearer tok-teacher-2' }
      );
      assert.strictEqual(t2Complete.status, 403, 'Outro professor recebe 403 em complete');

      const t2Resched = await makeRequest(
        server,
        'POST',
        `/api/lessons/${targetId}/reschedule`,
        {
          newStartIso: '2026-12-12T14:00:00.000Z',
          newEndIso: '2026-12-12T14:50:00.000Z',
        },
        { Authorization: 'Bearer tok-teacher-2' }
      );
      assert.strictEqual(t2Resched.status, 403, 'Outro professor recebe 403 em reschedule');

      // Admin can reschedule/complete/cancel
      const adminResched = await makeRequest(
        server,
        'POST',
        `/api/lessons/${targetId}/reschedule`,
        {
          newStartIso: '2026-12-12T14:00:00.000Z',
          newEndIso: '2026-12-12T14:50:00.000Z',
          reason: 'Admin adjustment',
        },
        { Authorization: 'Bearer tok-admin' }
      );
      assert.strictEqual(adminResched.status, 200, 'Admin autorizado a operar aula');

      const adminAccept = await makeRequest(
        server,
        'POST',
        `/api/lessons/${targetId}/accept-reschedule`,
        {},
        { Authorization: 'Bearer tok-admin' }
      );
      assert.strictEqual(adminAccept.status, 200, 'Admin autorizado a aceitar reagendamento');
    });

    // -----------------------------------------------------------------------
    // 7. Persistência após reinicialização simulada (inMemoryDb totalmente limpo)
    // -----------------------------------------------------------------------
    await test('7. Persistência após reinicialização simulada (inMemoryDb limpo)', async () => {
      // Simulate server restart by wiping all inMemoryDb structures and verifying operations still work from Firestore
      clearInMemoryLegacyState();

      const afterRestartComplete = await makeRequest(
        server,
        'POST',
        '/api/lessons/lesson-arch2d-authz/complete',
        {},
        { Authorization: 'Bearer tok-teacher-1' }
      );
      assert.strictEqual(afterRestartComplete.status, 200);
      assert.strictEqual(afterRestartComplete.data.lesson.status, 'completed');
      assert.strictEqual(afterRestartComplete.data.lesson.startDateTime, '2026-12-12T14:00:00.000Z');
      assert.strictEqual(readDb().liveLessons.length, 0, 'inMemoryDb.liveLessons permanece vazio após conclusão');
    });

    // -----------------------------------------------------------------------
    // 9. Ausência de dependência de db.liveLessons nas rotas consolidadas
    // -----------------------------------------------------------------------
    await test('9. Ausência de dependência de db.liveLessons nas rotas consolidadas', async () => {
      // Inject phantom conflicting lesson ONLY into inMemoryDb.liveLessons (not in Firestore)
      (readDb() as any).liveLessons = [
        {
          id: 'phantom-memory-only',
          teacherUid: TEACHER_1_UID,
          studentUid: STUDENT_B_UID,
          startDateTime: '2026-12-15T14:00:00.000Z',
          endDateTime: '2026-12-15T14:50:00.000Z',
          status: 'scheduled',
        },
      ];

      // Student B tries to complete the phantom memory-only lesson -> MUST return 404 from Firestore!
      const completePhantom = await makeRequest(
        server,
        'POST',
        '/api/lessons/phantom-memory-only/complete',
        {},
        { Authorization: 'Bearer tok-student-b' }
      );
      assert.strictEqual(completePhantom.status, 404, 'Rota consolidada ignora aula fantasma apenas em db.liveLessons');

      // Student B can book at 2026-12-15T14:00:00.000Z because Firestore has no conflict there
      const bookReal = await makeRequest(
        server,
        'POST',
        '/api/lessons/schedule',
        {
          requestId: 'lesson-real-no-memory-dep',
          teacherUid: TEACHER_1_UID,
          startDateTime: '2026-12-15T14:00:00.000Z',
          endDateTime: '2026-12-15T14:50:00.000Z',
          title: 'Real Firestore Slot',
          isTrialLesson: false,
        },
        { Authorization: 'Bearer tok-student-b' }
      );
      assert.strictEqual(bookReal.status, 200, 'Agendamento ignora conflito fantasma em db.liveLessons');

      // Clean phantom
      clearInMemoryLegacyState();

      // Static verification of consolidated routes in serverApp.ts
      const serverAppSrc = fs.readFileSync(path.join(process.cwd(), 'serverApp.ts'), 'utf8');
      const scheduleBlockStart = serverAppSrc.indexOf("app.post('/api/lessons/schedule'");
      const cancelBlockEnd = serverAppSrc.indexOf('export function invalidatePedagogicalCache');
      const consolidatedSection = serverAppSrc.slice(scheduleBlockStart, cancelBlockEnd);
      assert.ok(!consolidatedSection.includes('db.liveLessons'), 'Seção consolidada de rotas POST não referencia db.liveLessons');
      assert.ok(!consolidatedSection.includes('writeDbSync'), 'Seção consolidada de rotas POST não chama writeDbSync');
      assert.ok(!consolidatedSection.includes('st-${Date.now()}'), 'Sem criação de IDs sintéticos de usuários');

      const deleteStart = serverAppSrc.indexOf("app.delete(['/api/lessons/:id', '/api/live-lessons/:id']");
      const deleteEnd = serverAppSrc.indexOf("// 6. Chat Messages Endpoints");
      const deleteSection = serverAppSrc.slice(deleteStart, deleteEnd);
      assert.ok(!deleteSection.includes('db.liveLessons'), 'Rota DELETE consolidada não referencia db.liveLessons');
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    clearInMemoryLegacyState();
    resetFirebaseAdminFirestoreForTesting();
    resetFirebaseAdminForTesting();
    if (origProjectId === undefined) delete process.env.FIREBASE_PROJECT_ID;
    else process.env.FIREBASE_PROJECT_ID = origProjectId;
  }

  console.log('\n======================================================================');
  console.log(`ARCH.2D TEST SUMMARY: ${passed} PASSED | ${failed} FAILED`);
  console.log('======================================================================');

  if (failed > 0) process.exit(1);
}

runArch2DTests().catch((err) => {
  console.error('Fatal error in ARCH.2D suite:', err);
  process.exit(1);
});
