/**
 * ARCH.2D.2 — Consolidação das Leituras de Aulas no Firestore
 *
 * Bateria de testes abrangente cobrindo:
 * 1. GET /api/lessons e GET /api/live-lessons: leitura canônica exclusiva de lessons/{lessonId}
 *    no Firestore (default) para aluno, professor aprovado e admin; ignora subcoleções legadas
 *    (users/{uid}/lessons, tutors/{id}/lessons) e db.liveLessons.
 * 2. Consultas de horários ocupados (/api/teachers/:id/busy-slots, /api/tutors/:id/busy-slots,
 *    /api/lessons/busy-slots, /api/lessons/busy): leitura canônica de lessons/{lessonId},
 *    sem depender de subcoleções, db.tutorsList ou db.liveLessons, e com zero PII.
 * 3. POST /api/lessons/:id/notes: desacoplado de db.liveLessons e writeDbSync (não dispara
 *    escrita em app_state/lessons), ignora users/{studentUid}/lessons e preserva Native Friends Notes.
 * 4. Inicialização (fetchAppStateFromFirestore + initCloudPersistence): nunca reintroduz aulas
 *    a partir de app_state/lessons (liveLessons, lessons, scheduledLessons) preservando contractedLessons/homework.
 * 5. Ciclo transacional ARCH.2D completo via HTTP (schedule -> GET -> busy-slots -> reschedule ->
 *    decline-reschedule -> accept-reschedule -> notes -> cancel -> DELETE) sem depender de
 *    db.liveLessons ou app_state/lessons.
 */

process.env.NODE_ENV = 'test';
process.env.FIREBASE_PROJECT_ID = 'itissimple-security-staging';
process.env.FIREBASE_DATABASE_ID = '(default)';

import { setFirebaseAdminAuthForTesting } from '../src/serverFirebaseAdmin';
import {
  setFirebaseAdminFirestoreForTesting,
  fetchAppStateFromFirestore,
  saveAppStateToFirestore,
} from '../src/serverFirestore';

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    console.log(`  ✅ PASS: ${testName}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${testName}${detail ? ` (${detail})` : ''}`);
    failed++;
  }
}

function deepClone<T>(val: T): T {
  return val === undefined ? val : JSON.parse(JSON.stringify(val));
}

function matchesFilter(data: any, field: string, op: string, value: any): boolean {
  const actual = data?.[field];
  if (op === '==') return actual === value;
  if (op === 'in' && Array.isArray(value)) return value.includes(actual);
  if (op === 'array-contains' && Array.isArray(actual)) return actual.includes(value);
  return false;
}

class MockDocRef {
  public id: string;
  public path: string;
  constructor(private col: MockCollection, id: string) {
    this.id = id;
    this.path = `${col.collectionPath}/${id}`;
  }

  async get() {
    this.col.onDocGet(this.id);
    const data = this.col.docs.get(this.id);
    return {
      exists: Boolean(data),
      id: this.id,
      ref: this,
      data: () => (data ? deepClone(data) : undefined),
    };
  }

  async set(data: any, options?: { merge?: boolean }) {
    this.col.onDocWrite(this.id);
    const existing = this.col.docs.get(this.id) || {};
    const merged = options?.merge ? { ...existing, ...data } : data;
    this.col.docs.set(this.id, deepClone(merged));
    return { writeTime: new Date() };
  }

  async update(data: any) {
    this.col.onDocWrite(this.id);
    const existing = this.col.docs.get(this.id);
    if (!existing) throw new Error(`NOT_FOUND: ${this.path}`);
    this.col.docs.set(this.id, deepClone({ ...existing, ...data }));
    return { writeTime: new Date() };
  }

  async delete() {
    this.col.onDocWrite(this.id);
    this.col.docs.delete(this.id);
    return { writeTime: new Date() };
  }

  collection(subName: string): MockCollection {
    if (!this.col.subcollections.has(this.id)) {
      this.col.subcollections.set(this.id, new Map());
    }
    const map = this.col.subcollections.get(this.id)!;
    if (!map.has(subName)) {
      map.set(subName, new MockCollection(`${this.col.collectionPath}/${this.id}/${subName}`, this.col.db));
    }
    return map.get(subName)!;
  }
}

class MockQuery {
  constructor(
    private col: MockCollection,
    private filters: Array<{ field: string; op: string; value: any }>,
    private limitCount?: number
  ) {}

  where(field: string, op: string, value: any): MockQuery {
    return new MockQuery(this.col, [...this.filters, { field, op, value }], this.limitCount);
  }

  limit(n: number): MockQuery {
    return new MockQuery(this.col, this.filters, n);
  }

  async get() {
    const matched: any[] = [];
    for (const [id, data] of this.col.docs.entries()) {
      const ok = this.filters.every((f) => matchesFilter(data, f.field, f.op, f.value));
      if (ok) {
        const ref = this.col.doc(id);
        matched.push({
          id,
          exists: true,
          ref,
          data: () => deepClone(data),
        });
        if (this.limitCount !== undefined && matched.length >= this.limitCount) break;
      }
    }
    return {
      empty: matched.length === 0,
      size: matched.length,
      docs: matched,
      forEach: (cb: (d: any) => void) => matched.forEach(cb),
    };
  }
}

class MockCollection {
  public docs: Map<string, any> = new Map();
  public subcollections: Map<string, Map<string, MockCollection>> = new Map();

  constructor(public collectionPath: string, public db: MockFirestoreDb) {}

  onDocGet(_id: string) {
    if (this.collectionPath.endsWith('/lessons') && this.collectionPath !== 'lessons') {
      this.db.legacySubcollectionLessonReads++;
    }
  }

  onDocWrite(id: string) {
    if (this.collectionPath === 'app_state' && id === 'lessons') {
      this.db.appStateLessonsWrites++;
    }
  }

  doc(id: string): MockDocRef {
    return new MockDocRef(this, id);
  }

  where(field: string, op: string, value: any): MockQuery {
    if (this.collectionPath === 'lessons') {
      this.db.filteredLessonsQueries++;
    }
    return new MockQuery(this, [{ field, op, value }]);
  }

  limit(n: number): MockQuery {
    return new MockQuery(this, [], n);
  }

  async get() {
    if (this.collectionPath === 'lessons') {
      this.db.unrestrictedLessonsGets++;
    } else if (this.collectionPath.endsWith('/lessons')) {
      this.db.legacySubcollectionLessonReads++;
    }
    const matched: any[] = [];
    for (const [id, data] of this.docs.entries()) {
      const ref = this.doc(id);
      matched.push({
        id,
        exists: true,
        ref,
        data: () => deepClone(data),
      });
    }
    return {
      empty: matched.length === 0,
      size: matched.length,
      docs: matched,
      forEach: (cb: (d: any) => void) => matched.forEach(cb),
    };
  }
}

class MockFirestoreDb {
  private collections: Map<string, MockCollection> = new Map();
  public legacySubcollectionLessonReads = 0;
  public appStateLessonsWrites = 0;
  public unrestrictedLessonsGets = 0;
  public filteredLessonsQueries = 0;

  collection(name: string): MockCollection {
    if (!this.collections.has(name)) {
      this.collections.set(name, new MockCollection(name, this));
    }
    return this.collections.get(name)!;
  }

  resetCounters() {
    this.legacySubcollectionLessonReads = 0;
    this.appStateLessonsWrites = 0;
    this.unrestrictedLessonsGets = 0;
    this.filteredLessonsQueries = 0;
  }

  async runTransaction<T>(fn: (tx: any) => Promise<T>): Promise<T> {
    const ops: Array<() => Promise<void>> = [];
    const tx = {
      get: async (target: any) => target.get(),
      set: (ref: MockDocRef, data: any, options?: { merge?: boolean }) => {
        ops.push(() => ref.set(data, options).then(() => undefined));
      },
      update: (ref: MockDocRef, data: any) => {
        ops.push(() => ref.update(data).then(() => undefined));
      },
      delete: (ref: MockDocRef) => {
        ops.push(() => ref.delete().then(() => undefined));
      },
    };
    const res = await fn(tx);
    for (const op of ops) {
      await op();
    }
    return res;
  }
}

async function runTests() {
  console.log('===========================================================================');
  console.log(" IT'S SIMPLE — ARCH.2D.2: CONSOLIDAÇÃO DAS LEITURAS DE AULAS NO FIRESTORE ");
  console.log('===========================================================================\n');

  const mockDb = new MockFirestoreDb();
  setFirebaseAdminFirestoreForTesting(mockDb as any);

  const STUDENT_UID = 'StuCanonUid1234567890123456';
  const STUDENT_EMAIL = 'student.arch2d2@gmail.com';
  const OTHER_STUDENT_UID = 'OtherStuUid1234567890123456';
  const OTHER_STUDENT_EMAIL = 'other.arch2d2@gmail.com';
  const TEACHER_UID = 'TchCanonUid1234567890123456';
  const TEACHER_EMAIL = 'teacher.arch2d2@gmail.com';
  const PUBLIC_TUTOR_ID = 'tutor-arch2d2';
  const ADMIN_UID = 'AdmCanonUid1234567890123456';
  const ADMIN_EMAIL = 'admin.arch2d2@gmail.com';

  const tokensDb = new Map<string, any>();
  tokensDb.set('tok_student', { uid: STUDENT_UID, email: STUDENT_EMAIL, email_verified: true, role: 'student' });
  tokensDb.set('tok_other_student', { uid: OTHER_STUDENT_UID, email: OTHER_STUDENT_EMAIL, email_verified: true, role: 'student' });
  tokensDb.set('tok_teacher', { uid: TEACHER_UID, email: TEACHER_EMAIL, email_verified: true, role: 'student' });
  tokensDb.set('tok_admin', { uid: ADMIN_UID, email: ADMIN_EMAIL, email_verified: true, role: 'admin', admin: true });

  setFirebaseAdminAuthForTesting({
    verifyIdToken: async (token: string) => {
      const decoded = tokensDb.get(token);
      if (!decoded) throw new Error('Invalid token');
      return decoded;
    },
  } as any);

  // Seed canonical users and approved tutor in Firestore (default)
  await mockDb.collection('users').doc(STUDENT_UID).set({
    id: STUDENT_UID,
    uid: STUDENT_UID,
    email: STUDENT_EMAIL,
    name: 'Canonical Student',
    role: 'student',
    contractedLessons: 5,
    availableLessons: 5,
    scheduledLessonsCount: 0,
    completedLessonsCount: 0,
    teacherUid: TEACHER_UID,
    teacherEmail: TEACHER_EMAIL,
    teacherName: 'Arch Teacher',
    hasUsedTrialLesson: false,
  });

  await mockDb.collection('users').doc(OTHER_STUDENT_UID).set({
    id: OTHER_STUDENT_UID,
    uid: OTHER_STUDENT_UID,
    email: OTHER_STUDENT_EMAIL,
    name: 'Other Student',
    role: 'student',
    contractedLessons: 5,
    availableLessons: 5,
  });

  await mockDb.collection('users').doc(TEACHER_UID).set({
    id: TEACHER_UID,
    uid: TEACHER_UID,
    authUid: TEACHER_UID,
    publicTutorId: PUBLIC_TUTOR_ID,
    email: TEACHER_EMAIL,
    name: 'Arch Teacher',
    role: 'teacher',
    isTeacher: true,
    isApproved: true,
    approvalStatus: 'approved',
  });

  await mockDb.collection('tutors').doc(PUBLIC_TUTOR_ID).set({
    id: PUBLIC_TUTOR_ID,
    publicTutorId: PUBLIC_TUTOR_ID,
    authUid: TEACHER_UID,
    uid: TEACHER_UID,
    email: TEACHER_EMAIL,
    name: 'Arch Teacher',
    role: 'teacher',
    isTeacher: true,
    isApproved: true,
    approvalStatus: 'approved',
    availableDays: [
      { day: 'Monday', slots: ['09:00', '10:00', '11:00', '14:00'] },
      { day: 'Wednesday', slots: ['10:00', '15:00'] },
    ],
  });

  // Seed legacy app_state/lessons & app_state/main_data BEFORE startup hydration test
  await mockDb.collection('app_state').doc('lessons').set({
    contractedLessons: { [STUDENT_EMAIL]: 5 },
    weeklyHomework: { title: 'Keep Me' },
    studentHomeworkMap: { [STUDENT_UID]: { ok: true } },
    liveLessons: [{ id: 'legacy_app_state_lesson_1', studentUid: STUDENT_UID, status: 'scheduled' }],
    lessons: [{ id: 'legacy_app_state_lesson_2', studentUid: STUDENT_UID, status: 'scheduled' }],
    scheduledLessons: [{ id: 'legacy_app_state_lesson_3', studentUid: STUDENT_UID, status: 'scheduled' }],
  });

  await mockDb.collection('app_state').doc('main_data').set({
    liveLessons: [{ id: 'legacy_main_data_lesson_1', studentUid: STUDENT_UID, status: 'scheduled' }],
    lessons: [{ id: 'legacy_main_data_lesson_2', studentUid: STUDENT_UID, status: 'scheduled' }],
    scheduledLessons: [{ id: 'legacy_main_data_lesson_3', studentUid: STUDENT_UID, status: 'scheduled' }],
  });

  const { app, initCloudPersistence } = await import('../serverApp');

  function simulateRequest(
    method: string,
    url: string,
    headers: Record<string, string> = {},
    body?: any
  ): Promise<{ status: number; body: any }> {
    return new Promise((resolve) => {
      const [pathOnly, queryString] = url.split('?');
      const query: Record<string, string> = {};
      if (queryString) {
        new URLSearchParams(queryString).forEach((v, k) => {
          query[k] = v;
        });
      }
      const reqHeaders: Record<string, string> = {};
      Object.entries(headers).forEach(([k, v]) => {
        reqHeaders[k.toLowerCase()] = v;
      });
      const req: any = {
        method: method.toUpperCase(),
        url,
        originalUrl: url,
        path: pathOnly,
        query,
        headers: reqHeaders,
        body: body ?? {},
        _body: true,
      };
      let statusCode = 200;
      const resHeaders: Record<string, string> = {};
      const res: any = {
        _headerNames: {},
        _headers: {},
        setHeader: (name: string, value: string) => {
          resHeaders[name.toLowerCase()] = value;
          return res;
        },
        getHeader: (n: string) => resHeaders[n.toLowerCase()],
        removeHeader: (name: string) => {
          delete resHeaders[name.toLowerCase()];
          return res;
        },
        status: (code: number) => {
          statusCode = code;
          return res;
        },
        json: (data: any) => {
          resolve({ status: statusCode, body: data });
          return res;
        },
        send: (data: any) => {
          resolve({ status: statusCode, body: data });
          return res;
        },
      };
      app(req, res, (err: any) => {
        if (err) resolve({ status: 500, body: { error: err.message } });
        else resolve({ status: 404, body: { error: 'Route not found' } });
      });
    });
  }

  // ==========================================================================
  console.log('--- 1. Inicialização & Bloqueio de app_state/lessons ---');
  // ==========================================================================
  const fetchedAppState = await fetchAppStateFromFirestore();
  assert(
    fetchedAppState !== null &&
      fetchedAppState.liveLessons === undefined &&
      fetchedAppState.lessons === undefined &&
      fetchedAppState.scheduledLessons === undefined,
    'fetchAppStateFromFirestore remove liveLessons, lessons e scheduledLessons de app_state/lessons e main_data'
  );
  assert(
    fetchedAppState?.contractedLessons?.[STUDENT_EMAIL] === 5 &&
      fetchedAppState?.weeklyHomework?.title === 'Keep Me' &&
      fetchedAppState?.studentHomeworkMap?.[STUDENT_UID]?.ok === true,
    'fetchAppStateFromFirestore preserva contractedLessons, weeklyHomework e studentHomeworkMap intactos'
  );

  await initCloudPersistence();
  const afterHydrationLessons = await simulateRequest('GET', '/api/lessons', {
    authorization: 'Bearer tok_student',
  });
  assert(
    afterHydrationLessons.status === 200 && Array.isArray(afterHydrationLessons.body) && afterHydrationLessons.body.length === 0,
    'initCloudPersistence não reintroduz aulas legadas de app_state/lessons'
  );

  mockDb.collection('app_state').docs.delete('main_data');
  await saveAppStateToFirestore({
    contractedLessons: { [STUDENT_EMAIL]: 5 },
    liveLessons: [{ id: 'should_never_be_saved' }],
    lessons: [{ id: 'should_never_be_saved_2' }],
    scheduledLessons: [{ id: 'should_never_be_saved_3' }],
  });
  const savedMain = (await mockDb.collection('app_state').doc('main_data').get()).data();
  const savedLessonsAppState = (await mockDb.collection('app_state').doc('lessons').get()).data();
  // Verify saveAppStateToFirestore never writes liveLessons/lessons/scheduledLessons into main_data or lessonsData
  assert(
    savedMain?.liveLessons === undefined && savedMain?.lessons === undefined && savedMain?.scheduledLessons === undefined,
    'saveAppStateToFirestore remove campos legados de aulas de main_data'
  );
  assert(
    savedLessonsAppState?.contractedLessons?.[STUDENT_EMAIL] === 5,
    'saveAppStateToFirestore mantém contractedLessons em app_state/lessons'
  );

  // ==========================================================================
  console.log('\n--- 2. GET /api/lessons & GET /api/live-lessons (Canônico + Ignora Subcoleções) ---');
  // ==========================================================================
  const canonLessonId = 'lesson_canon_arch2d2_1';
  const canonLessonOtherId = 'lesson_canon_arch2d2_other';

  await mockDb.collection('lessons').doc(canonLessonId).set({
    id: canonLessonId,
    studentUid: STUDENT_UID,
    studentEmail: STUDENT_EMAIL,
    studentName: 'Canonical Student',
    teacherUid: TEACHER_UID,
    teacherAuthUid: TEACHER_UID,
    teacherPublicId: PUBLIC_TUTOR_ID,
    teacherEmail: TEACHER_EMAIL,
    teacherName: 'Arch Teacher',
    startDateTime: '2026-12-01T14:00:00.000Z',
    endDateTime: '2026-12-01T14:50:00.000Z',
    status: 'scheduled',
    title: 'Canonical Root Lesson',
  });

  await mockDb.collection('lessons').doc(canonLessonOtherId).set({
    id: canonLessonOtherId,
    studentUid: OTHER_STUDENT_UID,
    studentEmail: OTHER_STUDENT_EMAIL,
    studentName: 'Other Student',
    teacherUid: TEACHER_UID,
    teacherAuthUid: TEACHER_UID,
    teacherPublicId: PUBLIC_TUTOR_ID,
    teacherEmail: TEACHER_EMAIL,
    teacherName: 'Arch Teacher',
    startDateTime: '2026-12-02T15:00:00.000Z',
    endDateTime: '2026-12-02T15:50:00.000Z',
    status: 'confirmed',
    title: 'Other Canonical Root Lesson',
  });

  // Seed stale phantom lessons in legacy subcollections ONLY (not in canonical `lessons`)
  await mockDb.collection('users').doc(STUDENT_UID).collection('lessons').doc('stale_sub_student').set({
    id: 'stale_sub_student',
    studentUid: STUDENT_UID,
    startDateTime: '2026-12-03T10:00:00.000Z',
    endDateTime: '2026-12-03T10:50:00.000Z',
    status: 'scheduled',
  });
  await mockDb.collection('users').doc(TEACHER_UID).collection('lessons').doc('stale_sub_teacher').set({
    id: 'stale_sub_teacher',
    teacherUid: TEACHER_UID,
    startDateTime: '2026-12-04T10:00:00.000Z',
    endDateTime: '2026-12-04T10:50:00.000Z',
    status: 'scheduled',
  });
  await mockDb.collection('tutors').doc(PUBLIC_TUTOR_ID).collection('lessons').doc('stale_sub_tutor').set({
    id: 'stale_sub_tutor',
    teacherUid: PUBLIC_TUTOR_ID,
    startDateTime: '2026-12-05T10:00:00.000Z',
    endDateTime: '2026-12-05T10:50:00.000Z',
    status: 'scheduled',
  });

  mockDb.resetCounters();

  const stuGet = await simulateRequest('GET', '/api/lessons', { authorization: 'Bearer tok_student' });
  assert(
    stuGet.status === 200 && stuGet.body.length === 1 && stuGet.body[0].id === canonLessonId,
    'Aluno lê apenas sua aula canônica de lessons/{lessonId} (ignora users/{uid}/lessons)'
  );

  const stuLiveGet = await simulateRequest('GET', '/api/live-lessons', { authorization: 'Bearer tok_student' });
  assert(
    stuLiveGet.status === 200 && stuLiveGet.body.length === 1 && stuLiveGet.body[0].id === canonLessonId,
    'Alias GET /api/live-lessons para aluno lê exclusivamente de lessons/{lessonId}'
  );

  const tchGet = await simulateRequest('GET', '/api/lessons', { authorization: 'Bearer tok_teacher' });
  assert(
    tchGet.status === 200 &&
      tchGet.body.length === 2 &&
      tchGet.body.some((l: any) => l.id === canonLessonId) &&
      tchGet.body.some((l: any) => l.id === canonLessonOtherId) &&
      !tchGet.body.some((l: any) => String(l.id).startsWith('stale_sub_')),
    'Professor aprovado lê apenas aulas canônicas vinculadas (ignora tutors/*/lessons e users/*/lessons)'
  );

  assert(
    mockDb.legacySubcollectionLessonReads === 0,
    'Zero leituras em subcoleções legadas (tutors/*/lessons e users/*/lessons) durante GET /api/lessons'
  );
  assert(
    mockDb.unrestrictedLessonsGets === 0 && mockDb.filteredLessonsQueries > 0,
    'Consultas de aluno e professor são estritamente filtradas (zero varredura irrestrita)'
  );

  const admGet = await simulateRequest('GET', '/api/live-lessons', { authorization: 'Bearer tok_admin' });
  assert(
    admGet.status === 200 && admGet.body.length === 2,
    'Admin consulta todas as aulas canônicas via GET /api/live-lessons'
  );

  // ==========================================================================
  console.log('\n--- 3. Busy-Slots Canônico (Sem subcoleções, sem db.tutorsList, Zero PII) ---');
  // ==========================================================================
  // Seed a cancelled canonical lesson (must NOT appear in busy-slots)
  await mockDb.collection('lessons').doc('lesson_cancelled_canon').set({
    id: 'lesson_cancelled_canon',
    studentUid: STUDENT_UID,
    teacherUid: TEACHER_UID,
    teacherPublicId: PUBLIC_TUTOR_ID,
    teacherEmail: TEACHER_EMAIL,
    startDateTime: '2026-12-06T12:00:00.000Z',
    endDateTime: '2026-12-06T12:50:00.000Z',
    status: 'cancelled',
    cancelledAt: new Date().toISOString(),
  });

  mockDb.resetCounters();
  const busyBySlug = await simulateRequest('GET', `/api/teachers/${PUBLIC_TUTOR_ID}/busy-slots`);
  const busyByEmail = await simulateRequest('GET', `/api/lessons/busy?teacherEmail=${encodeURIComponent(TEACHER_EMAIL)}`);
  const busyByTutorRoute = await simulateRequest('GET', `/api/tutors/${PUBLIC_TUTOR_ID}/busy-slots`);

  assert(
    busyBySlug.status === 200 &&
      Array.isArray(busyBySlug.body) &&
      busyBySlug.body.length === 2 &&
      busyBySlug.body.some((s: any) => s.startDateTime === '2026-12-01T14:00:00.000Z') &&
      busyBySlug.body.some((s: any) => s.startDateTime === '2026-12-02T15:00:00.000Z'),
    'GET /api/teachers/:teacherId/busy-slots retorna apenas slots ativos canônicos (inclui confirmed, exclui cancelled e subcoleções)'
  );
  assert(
    busyByEmail.status === 200 && busyByEmail.body.length === 2 && busyByTutorRoute.status === 200 && busyByTutorRoute.body.length === 2,
    'Rotas /api/lessons/busy e /api/tutors/:tutorId/busy-slots resolvem professor via Firestore sem db.tutorsList'
  );
  assert(
    mockDb.legacySubcollectionLessonReads === 0,
    'Zero leituras em subcoleções legadas durante consulta de busy-slots'
  );
  assert(
    busyBySlug.body.every((s: any) => s.studentName === undefined && s.studentEmail === undefined && s.studentUid === undefined && s.id === undefined),
    'Busy-slots mantém isolamento estrito de PII'
  );

  // ==========================================================================
  console.log('\n--- 4. POST /api/lessons/:id/notes Desacoplado (Sem db.liveLessons / writeDbSync) ---');
  // ==========================================================================
  // Seed a lesson ONLY in legacy users/{studentUid}/lessons to ensure fallback is gone
  await mockDb.collection('users').doc(STUDENT_UID).collection('lessons').doc('legacy_only_note_lesson').set({
    id: 'legacy_only_note_lesson',
    studentUid: OTHER_STUDENT_UID, // If legacy fallback ran, this mismatch would trigger 403!
    teacherUid: TEACHER_UID,
    startDateTime: '2026-12-07T10:00:00.000Z',
  });

  mockDb.resetCounters();
  const noteWithExplicitDate = await simulateRequest(
    'POST',
    '/api/lessons/legacy_only_note_lesson/notes',
    { authorization: 'Bearer tok_teacher' },
    {
      studentUid: STUDENT_UID,
      sessionDate: '2026-12-07',
      topic: 'Decoupled Notes Test',
      rawContent: 'Remember this: Practice speaking daily.',
    }
  );
  assert(
    noteWithExplicitDate.status === 200 && noteWithExplicitDate.body?.success === true,
    'POST /api/lessons/:id/notes ignora subcoleção legada users/{uid}/lessons'
  );

  mockDb.resetCounters();
  const noteCanonRes = await simulateRequest(
    'POST',
    `/api/lessons/${canonLessonId}/notes`,
    { authorization: 'Bearer tok_teacher' },
    {
      studentUid: STUDENT_UID,
      topic: 'Canonical Lesson Feedback',
      rawContent: 'Great progress! New words: resilience, fluency.',
    }
  );
  assert(
    noteCanonRes.status === 200 &&
      noteCanonRes.body?.success === true &&
      noteCanonRes.body?.sessionNote?.lessonId === canonLessonId &&
      noteCanonRes.body?.sessionNote?.sessionDate === '2026-12-01',
    'POST /api/lessons/:id/notes deriva sessionDate de lessons/{lessonId} e preserva Native Friends Notes'
  );
  assert(
    mockDb.appStateLessonsWrites === 0,
    'POST /api/lessons/:id/notes NÃO aciona writeDbSync / escrita em app_state/lessons'
  );

  const canonicalNoteSnap = await mockDb.collection('session_notes').doc(canonLessonId).get();
  const lessonAfterNoteSnap = await mockDb.collection('lessons').doc(canonLessonId).get();
  assert(
    canonicalNoteSnap.exists &&
      canonicalNoteSnap.data()?.rawContent?.includes('resilience') &&
      lessonAfterNoteSnap.data()?.sessionNotesDocument?.includes('resilience'),
    'Notas salvas atomicamente em session_notes/{lessonId} e refletidas em lessons/{lessonId}'
  );

  // Verify student can read Native Friends Notes via GET /api/session-notes
  const getNotesRes = await simulateRequest('GET', `/api/session-notes?studentUid=${STUDENT_UID}`, {
    authorization: 'Bearer tok_student',
  });
  assert(
    getNotesRes.status === 200 &&
      Array.isArray(getNotesRes.body) &&
      getNotesRes.body.some((n: any) => n.lessonId === canonLessonId),
    'GET /api/session-notes retorna normalmente as anotações do Native Friend para o aluno'
  );

  // ==========================================================================
  console.log('\n--- 5. Ciclo Transacional ARCH.2D Completo via HTTP (Sem db.liveLessons) ---');
  // ==========================================================================
  const schedStart = '2026-12-10T14:00:00.000Z';
  const schedEnd = '2026-12-10T14:50:00.000Z';
  mockDb.resetCounters();
  const schedRes = await simulateRequest(
    'POST',
    '/api/lessons/schedule',
    { authorization: 'Bearer tok_student' },
    {
      tutorId: PUBLIC_TUTOR_ID,
      teacherUid: TEACHER_UID,
      teacherEmail: TEACHER_EMAIL,
      teacherName: 'Arch Teacher',
      startDateTime: schedStart,
      endDateTime: schedEnd,
      durationMinutes: 50,
      title: 'E2E Canonical Lesson',
      isTrial: false,
    }
  );
  const newLessonId = schedRes.body?.lesson?.id;
  assert(
    schedRes.status === 200 && schedRes.body?.success === true && Boolean(newLessonId),
    'POST /api/lessons/schedule cria aula canônica em lessons/{lessonId}'
  );

  const listAfterSched = await simulateRequest('GET', '/api/lessons', { authorization: 'Bearer tok_student' });
  assert(
    listAfterSched.status === 200 && listAfterSched.body.some((l: any) => l.id === newLessonId),
    'GET /api/lessons reflete imediatamente a nova aula agendada'
  );

  const busyAfterSched = await simulateRequest('GET', `/api/teachers/${PUBLIC_TUTOR_ID}/busy-slots`);
  assert(
    busyAfterSched.status === 200 && busyAfterSched.body.some((s: any) => s.startDateTime === schedStart),
    'Busy-slots reflete imediatamente o novo horário ocupado'
  );

  // Propose reschedule (by student)
  const proposedStart1 = '2026-12-11T16:00:00.000Z';
  const proposedEnd1 = '2026-12-11T16:50:00.000Z';
  const reschedRes = await simulateRequest(
    'POST',
    `/api/lessons/${newLessonId}/reschedule`,
    { authorization: 'Bearer tok_student' },
    { newStartIso: proposedStart1, newEndIso: proposedEnd1, reason: 'Need to shift day' }
  );
  assert(
    reschedRes.status === 200 && reschedRes.body?.lesson?.proposedNewStartDateTime === proposedStart1,
    'POST /api/lessons/:id/reschedule registra proposta no documento canônico'
  );

  // Decline reschedule (by teacher)
  const declineRes = await simulateRequest(
    'POST',
    `/api/lessons/${newLessonId}/decline-reschedule`,
    { authorization: 'Bearer tok_teacher' },
    { reason: 'Not available then' }
  );
  assert(
    declineRes.status === 200 && !declineRes.body?.lesson?.proposedNewStartDateTime,
    'POST /api/lessons/:id/decline-reschedule limpa proposta preservando horário original'
  );

  // Re-propose & accept reschedule
  const proposedStart2 = '2026-12-12T17:00:00.000Z';
  const proposedEnd2 = '2026-12-12T17:50:00.000Z';
  await simulateRequest(
    'POST',
    `/api/lessons/${newLessonId}/reschedule`,
    { authorization: 'Bearer tok_student' },
    { newStartIso: proposedStart2, newEndIso: proposedEnd2 }
  );
  const acceptRes = await simulateRequest(
    'POST',
    `/api/lessons/${newLessonId}/accept-reschedule`,
    { authorization: 'Bearer tok_teacher' }
  );
  assert(
    acceptRes.status === 200 && acceptRes.body?.lesson?.startDateTime === proposedStart2,
    'POST /api/lessons/:id/accept-reschedule atualiza startDateTime/endDateTime no documento canônico'
  );

  // Busy slots reflects rescheduled time
  const busyAfterResched = await simulateRequest('GET', `/api/teachers/${PUBLIC_TUTOR_ID}/busy-slots`);
  assert(
    busyAfterResched.status === 200 &&
      busyAfterResched.body.some((s: any) => s.startDateTime === proposedStart2) &&
      !busyAfterResched.body.some((s: any) => s.startDateTime === schedStart),
    'Busy-slots reflete o horário reagendado e libera o horário antigo'
  );

  // Save notes on scheduled lesson
  const notesOnNewLesson = await simulateRequest(
    'POST',
    `/api/lessons/${newLessonId}/notes`,
    { authorization: 'Bearer tok_teacher' },
    { studentUid: STUDENT_UID, rawContent: 'Rescheduled session notes' }
  );
  assert(
    notesOnNewLesson.status === 200 && mockDb.appStateLessonsWrites === 0,
    'POST /api/lessons/:id/notes funciona no fluxo completo sem escrever em app_state/lessons'
  );

  // Cancel lesson
  const cancelRes = await simulateRequest(
    'POST',
    `/api/lessons/${newLessonId}/cancel`,
    { authorization: 'Bearer tok_student' },
    { reason: 'E2E cancellation test' }
  );
  assert(
    cancelRes.status === 200 && cancelRes.body?.lesson?.status === 'cancelled',
    'POST /api/lessons/:id/cancel atualiza status para cancelled no Firestore canônico'
  );

  // Busy slots frees cancelled slot
  const busyAfterCancel = await simulateRequest('GET', `/api/teachers/${PUBLIC_TUTOR_ID}/busy-slots`);
  assert(
    busyAfterCancel.status === 200 && !busyAfterCancel.body.some((s: any) => s.startDateTime === proposedStart2),
    'Busy-slots libera o horário após cancelamento'
  );

  // Delete lesson (admin or participant)
  const delRes = await simulateRequest(
    'DELETE',
    `/api/lessons/${newLessonId}`,
    { authorization: 'Bearer tok_admin' }
  );
  assert(
    delRes.status === 200 && !(await mockDb.collection('lessons').doc(newLessonId).get()).exists,
    'DELETE /api/lessons/:id remove documento canônico do Firestore'
  );

  console.log('\n===========================================================================');
  console.log(`TOTAL ARCH.2D.2 TESTS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
  console.log('===========================================================================\n');

  if (failed > 0) process.exit(1);
  process.exit(0);
}

runTests().catch((err) => {
  console.error('Fatal error in validate-arch-2d-2-lessons-consolidation:', err);
  process.exit(1);
});
