/**
 * ARCH.2E.2C — Consolidação Canônica de Homework e Checks Semanais
 *
 * Bateria de testes cobrindo os 10 cenários obrigatórios:
 * 1. Persistência do homework após nova sessão (users/{uid}/homework/week-{cycle}).
 * 2. Submissão (/api/homework/submit) e avaliação (/api/homework/evaluate) sem perda de respostas,
 *    preservando completedPartsByDay, partsProgress, dailyActivities e submittedAt.
 * 3. Checks e metas do S-Path preservados após reinicialização simulada (wipe de inMemoryDb + envenenamento legado).
 * 4. Isolamento estrito entre alunos (UID case-sensitive, tentativa cruzada em query/body/aninhado -> 403).
 * 5. Professor aprovado vinculado (sem custom claim 'teacher') lê homework e checks do aluno vinculado (200),
 *    mas é bloqueado em escrita (403); Admin mantém acesso completo.
 * 6. Bloqueio de acesso sem token (401), token inválido (401), professor não vinculado (403),
 *    professor pendente (403) e UID sintético usr-* (403/422).
 * 7. Idempotência de operações repetidas (POST /api/homework, POST /api/homework/submit, POST /api/routines/weekly-checks)
 *    e proteção contra sobrescrita por payload vazio sem reset: true.
 * 8. Proteção contra ciclos antigos (weeklyCycle < activeCycle -> 409 STALE_CYCLE), isolamento de ciclos,
 *    e fallback legado somente leitura apenas em cycle === 1 sem sobrescrever dados canônicos.
 * 9. Falha de escrita no Firestore retorna erro real HTTP 500 (success: false), nunca falso sucesso.
 * 10. Preservação dos fluxos ARCH.2E.2A (vídeos) e ARCH.2E.2B (Spotify), ausência de gravações redundantes
 *     (student_homework, current_week, users/{uid}.weeklyHomework/weeklyChecks/sPathChecks, app_state)
 *     e roteamento do frontend (studentPersistence.ts) via APIs autenticadas.
 */

process.env.NODE_ENV = 'test';
process.env.FIREBASE_PROJECT_ID = 'itissimple-security-staging';
process.env.FIREBASE_DATABASE_ID = '(default)';

import { setFirebaseAdminAuthForTesting } from '../src/serverFirebaseAdmin';
import { setFirebaseAdminFirestoreForTesting } from '../src/serverFirestore';

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

function isPlainObject(val: any): val is Record<string, any> {
  return Boolean(val) && typeof val === 'object' && !Array.isArray(val) && !(val instanceof Date);
}

function deepMergeObjects(target: Record<string, any>, source: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = { ...target };
  for (const [key, val] of Object.entries(source)) {
    if (isPlainObject(val) && isPlainObject(out[key])) {
      out[key] = deepMergeObjects(out[key], val);
    } else {
      out[key] = deepClone(val);
    }
  }
  return out;
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
    const data = this.col.docs.get(this.id);
    return {
      exists: Boolean(data),
      id: this.id,
      ref: this,
      data: () => (data ? deepClone(data) : undefined),
    };
  }

  async set(data: any, options?: { merge?: boolean }) {
    this.col.db.recordWrite(this.path, data);
    const existing = this.col.docs.get(this.id) || {};
    const merged = options?.merge ? deepMergeObjects(existing, data) : deepClone(data);
    this.col.docs.set(this.id, merged);
    return { writeTime: new Date() };
  }

  async update(data: any) {
    this.col.db.recordWrite(this.path, data);
    const existing = this.col.docs.get(this.id);
    if (!existing) throw new Error(`NOT_FOUND: ${this.path}`);
    this.col.docs.set(this.id, deepMergeObjects(existing, data));
    return { writeTime: new Date() };
  }

  async delete() {
    this.col.db.recordWrite(this.path, { __deleted: true });
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

  doc(id: string): MockDocRef {
    return new MockDocRef(this, id);
  }

  where(field: string, op: string, value: any): MockQuery {
    return new MockQuery(this, [{ field, op, value }]);
  }

  limit(n: number): MockQuery {
    return new MockQuery(this, [], n);
  }

  async get() {
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
  public failWriteMatcher: ((path: string) => boolean) | null = null;
  public suspendWriteLog = false;
  public writeLog: Array<{ path: string; keys: string[] }> = [];

  collection(name: string): MockCollection {
    if (!this.collections.has(name)) {
      this.collections.set(name, new MockCollection(name, this));
    }
    return this.collections.get(name)!;
  }

  recordWrite(path: string, data: any) {
    if (this.failWriteMatcher && this.failWriteMatcher(path)) {
      throw new Error(`Simulated Firestore write failure on ${path}`);
    }
    if (!this.suspendWriteLog) {
      this.writeLog.push({
        path,
        keys: data && typeof data === 'object' ? Object.keys(data) : [],
      });
    }
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
  console.log('================================================================================');
  console.log(" IT'S SIMPLE — ARCH.2E.2C: CONSOLIDAÇÃO CANÔNICA DE HOMEWORK E CHECKS SEMANAIS");
  console.log('================================================================================\n');

  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const originalFetch = globalThis.fetch;
  const trackedIntervals = new Set<ReturnType<typeof setInterval>>();
  const trackedTimeouts = new Set<ReturnType<typeof setTimeout>>();

  globalThis.setInterval = ((handler: any, timeout?: any, ...args: any[]) => {
    const handle = originalSetInterval(handler, timeout, ...args);
    trackedIntervals.add(handle);
    return handle;
  }) as typeof setInterval;

  globalThis.clearInterval = ((handle?: ReturnType<typeof setInterval>) => {
    if (handle !== undefined) trackedIntervals.delete(handle);
    return originalClearInterval(handle as any);
  }) as typeof clearInterval;

  globalThis.setTimeout = ((handler: any, timeout?: any, ...args: any[]) => {
    if (typeof handler === 'function') {
      let handle: ReturnType<typeof setTimeout>;
      handle = originalSetTimeout(
        (...cbArgs: any[]) => {
          trackedTimeouts.delete(handle);
          return handler(...cbArgs);
        },
        timeout,
        ...args
      );
      trackedTimeouts.add(handle);
      return handle;
    }
    const handle = originalSetTimeout(handler, timeout, ...args);
    trackedTimeouts.add(handle);
    return handle;
  }) as typeof setTimeout;

  globalThis.clearTimeout = ((handle?: ReturnType<typeof setTimeout>) => {
    if (handle !== undefined) trackedTimeouts.delete(handle);
    return originalClearTimeout(handle as any);
  }) as typeof clearTimeout;

  const mockDb = new MockFirestoreDb();

  try {
    setFirebaseAdminFirestoreForTesting(mockDb as any);

    const STUDENT_A_UID = 'StuA_HwCheckUid12345678901';
    const STUDENT_A_EMAIL = 'student.a.arch2e2c@gmail.com';
    const STUDENT_B_UID = 'StuB_HwCheckUid12345678901';
    const STUDENT_B_EMAIL = 'student.b.arch2e2c@gmail.com';
    const STUDENT_LEGACY_UID = 'StuL_LegacyUid12345678901';
    const STUDENT_LEGACY_EMAIL = 'student.legacy.arch2e2c@gmail.com';
    const TEACHER_LINKED_UID = 'TchL_HwCheckUid12345678901';
    const TEACHER_LINKED_EMAIL = 'teacher.linked.arch2e2c@gmail.com';
    const TEACHER_LINKED_PUBLIC_ID = 'tutor-linked-arch2e2c';
    const TEACHER_UNLINKED_UID = 'TchU_HwCheckUid12345678901';
    const TEACHER_UNLINKED_EMAIL = 'teacher.unlinked.arch2e2c@gmail.com';
    const TEACHER_PENDING_UID = 'TchP_HwCheckUid12345678901';
    const TEACHER_PENDING_EMAIL = 'teacher.pending.arch2e2c@gmail.com';
    const ADMIN_UID = 'Adm_HwCheckUid123456789012';
    const ADMIN_EMAIL = 'admin.arch2e2c@gmail.com';

    const tokensDb = new Map<string, any>();
    tokensDb.set('tok_student_a', { uid: STUDENT_A_UID, email: STUDENT_A_EMAIL, email_verified: true, role: 'student' });
    tokensDb.set('tok_student_b', { uid: STUDENT_B_UID, email: STUDENT_B_EMAIL, email_verified: true, role: 'student' });
    tokensDb.set('tok_student_legacy', { uid: STUDENT_LEGACY_UID, email: STUDENT_LEGACY_EMAIL, email_verified: true, role: 'student' });
    // Approved linked teacher explicitly WITHOUT custom claim 'teacher'
    tokensDb.set('tok_teacher_linked_no_claim', { uid: TEACHER_LINKED_UID, email: TEACHER_LINKED_EMAIL, email_verified: true, role: 'student' });
    tokensDb.set('tok_teacher_unlinked', { uid: TEACHER_UNLINKED_UID, email: TEACHER_UNLINKED_EMAIL, email_verified: true });
    tokensDb.set('tok_teacher_pending', { uid: TEACHER_PENDING_UID, email: TEACHER_PENDING_EMAIL, email_verified: true });
    tokensDb.set('tok_admin', { uid: ADMIN_UID, email: ADMIN_EMAIL, email_verified: true, role: 'admin', admin: true });

    setFirebaseAdminAuthForTesting({
      verifyIdToken: async (token: string) => {
        const decoded = tokensDb.get(token);
        if (!decoded) throw new Error('Invalid or expired Firebase ID token');
        return decoded;
      },
    } as any);

    await mockDb.collection('users').doc(STUDENT_A_UID).set({
      id: STUDENT_A_UID,
      uid: STUDENT_A_UID,
      email: STUDENT_A_EMAIL,
      name: 'Student Alpha Hw',
      role: 'student',
      level: 'beginner',
      englishLevel: 'beginner',
      weeklyCycle: 3,
      weeklyNativeLessonsTarget: 2,
      weeklyStudyDaysTarget: 5,
      weeklyStudyDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
      routineVideoTime: '08:00',
      routineAudioTime: '20:00',
      assignedNativeFriendUID: TEACHER_LINKED_UID,
      teacherUid: TEACHER_LINKED_UID,
      teacherEmail: TEACHER_LINKED_EMAIL,
    });

    await mockDb.collection('users').doc(STUDENT_B_UID).set({
      id: STUDENT_B_UID,
      uid: STUDENT_B_UID,
      email: STUDENT_B_EMAIL,
      name: 'Student Beta Hw',
      role: 'student',
      level: 'intermediate',
      englishLevel: 'intermediate',
      weeklyCycle: 1,
      weeklyNativeLessonsTarget: 1,
      weeklyStudyDaysTarget: 3,
      weeklyStudyDays: ['monday', 'wednesday', 'friday'],
      assignedNativeFriendUID: TEACHER_UNLINKED_UID,
      teacherUid: TEACHER_UNLINKED_UID,
      teacherEmail: TEACHER_UNLINKED_EMAIL,
    });

    await mockDb.collection('users').doc(STUDENT_LEGACY_UID).set({
      id: STUDENT_LEGACY_UID,
      uid: STUDENT_LEGACY_UID,
      email: STUDENT_LEGACY_EMAIL,
      name: 'Student Legacy Cycle 1',
      role: 'student',
      level: 'beginner',
      weeklyCycle: 1,
      // Legacy root mirrors only used when canonical subdoc does not exist (cycle === 1 read-only fallback)
      weeklyChecks: { video_day_monday: true, memorization_monday: true },
      weeklyHomework: {
        id: 'week-1',
        weekId: 'week-1',
        weeklyCycle: 1,
        completedPartsByDay: { monday: true },
        studentAnswers: {
          matching: { m1: 'coffee' },
          fillInBlanks: {},
          sentences: {},
          quizAnswers: {},
        },
      },
    });

    await mockDb.collection('tutors').doc(TEACHER_LINKED_PUBLIC_ID).set({
      id: TEACHER_LINKED_PUBLIC_ID,
      publicTutorId: TEACHER_LINKED_PUBLIC_ID,
      authUid: TEACHER_LINKED_UID,
      uid: TEACHER_LINKED_UID,
      email: TEACHER_LINKED_EMAIL,
      name: 'Linked Approved Native Friend',
      isApproved: true,
      approvalStatus: 'approved',
    });
    await mockDb.collection('users').doc(TEACHER_LINKED_UID).set({
      id: TEACHER_LINKED_UID,
      uid: TEACHER_LINKED_UID,
      email: TEACHER_LINKED_EMAIL,
      name: 'Linked Approved Native Friend',
      role: 'teacher',
      isTeacher: true,
      isApproved: true,
      approvalStatus: 'approved',
    });

    await mockDb.collection('tutors').doc('tutor-unlinked-arch2e2c').set({
      id: 'tutor-unlinked-arch2e2c',
      authUid: TEACHER_UNLINKED_UID,
      uid: TEACHER_UNLINKED_UID,
      email: TEACHER_UNLINKED_EMAIL,
      name: 'Unlinked Approved Native Friend',
      role: 'teacher',
      isApproved: true,
      approvalStatus: 'approved',
    });

    await mockDb.collection('tutors').doc('tutor-pending-arch2e2c').set({
      id: 'tutor-pending-arch2e2c',
      authUid: TEACHER_PENDING_UID,
      uid: TEACHER_PENDING_UID,
      email: TEACHER_PENDING_EMAIL,
      name: 'Pending Native Friend',
      role: 'teacher',
      isApproved: false,
      approvalStatus: 'pending',
    });

    // Clear write log after initial fixture seeding
    mockDb.writeLog = [];

    const { app, readDb } = await import('../serverApp');

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

    function wipeAndPoisonInMemoryDb() {
      const db = readDb();
      db.weeklyHomework = {
        [STUDENT_A_UID]: {
          id: 'week-3',
          weekId: 'week-3',
          weeklyCycle: 99,
          studentAnswers: { matching: { fake: 'POISONED_MEMORY' }, fillInBlanks: {}, sentences: {}, quizAnswers: {} },
        },
      };
      db.studentHomeworkMap = {
        [STUDENT_A_UID]: {
          'week-3': {
            id: 'week-3',
            studentAnswers: { matching: { fake: 'POISONED_MAP' }, fillInBlanks: {}, sentences: {}, quizAnswers: {} },
          },
        },
      };
      (db as any).studentWeeklyChecks = {
        [STUDENT_A_UID]: {
          'week-3': { video_day_sunday: true, poisoned_key: true },
        },
      };
    }

    // =========================================================================
    // CENÁRIO 1: Persistência do homework após nova sessão
    // =========================================================================
    console.log('--- Cenário 1: Persistência do homework após nova sessão ---');
    const initialHwPayload = {
      studentUid: STUDENT_A_UID,
      weekId: 'week-3',
      weeklyCycle: 3,
      weeklyHomework: {
        id: 'week-3',
        weekId: 'week-3',
        weeklyCycle: 3,
        studentUid: STUDENT_A_UID,
        studentName: 'Student Alpha Hw',
        studentLevel: 'beginner',
        vocabularyList: [{ word: 'schedule', meaning: 'agenda' }],
        matchingPairs: [{ id: 'm1', word: 'schedule', translation: 'agenda', definition: 'plan of events' }],
        fillInBlanks: [{ id: 'f1', sentence: 'Check your ______.', correctWord: 'schedule' }],
        sentenceWritingPrompts: [{ id: 's1', word: 'schedule', hintEn: 'Daily plan' }],
        readingPassage: {
          title: 'Morning Routine',
          text: 'Every morning Maya checks her schedule.',
          questions: [{ id: 'q1', question: 'What does Maya check?', options: ['Schedule', 'Email', 'Phone', 'Weather'], correctAnswer: 0 }],
        },
        completedPartsByDay: { monday: true },
        partsProgress: {
          matching: { partKey: 'matching', partNumber: 1, status: 'completed', score: 100 },
        },
        studentAnswers: {
          matching: { m1: 'schedule' },
          fillInBlanks: { f1: 'schedule' },
          sentences: { schedule: 'I organize my daily schedule every morning.' },
          quizAnswers: { q1: 0 },
        },
        dailyActivities: {
          monday: {
            id: 'hw-monday-3',
            day: 'monday',
            weeklyCycle: 3,
            studentUid: STUDENT_A_UID,
            isStarted: true,
            isCompleted: true,
            studentAnswers: {
              matching: { m1: 'schedule' },
              fillInBlanks: { f1: 'schedule' },
              sentences: { schedule: 'I organize my daily schedule every morning.' },
              quizAnswers: { q1: 0 },
            },
          },
        },
      },
    };

    const saveHwRes = await simulateRequest(
      'POST',
      '/api/homework',
      { Authorization: 'Bearer tok_student_a' },
      initialHwPayload
    );
    assert(
      saveHwRes.status === 200 && saveHwRes.body?.success === true && saveHwRes.body?.firestoreConfirmed === true,
      'POST /api/homework confirms Firestore persistence'
    );

    // Verify canonical path and ZERO legacy writes
    const canonicalHwDoc = await mockDb
      .collection('users')
      .doc(STUDENT_A_UID)
      .collection('homework')
      .doc('week-3')
      .get();
    assert(canonicalHwDoc.exists, 'Canonical document users/{uid}/homework/week-3 exists');

    // Simulate new session / server restart + poison inMemoryDb
    wipeAndPoisonInMemoryDb();

    const getHwSession2 = await simulateRequest(
      'GET',
      `/api/homework?studentUid=${encodeURIComponent(STUDENT_A_UID)}&weekId=week-3`,
      { Authorization: 'Bearer tok_student_a' }
    );
    assert(
      getHwSession2.status === 200 &&
        getHwSession2.body?.studentAnswers?.matching?.m1 === 'schedule' &&
        getHwSession2.body?.studentAnswers?.sentences?.schedule === 'I organize my daily schedule every morning.' &&
        getHwSession2.body?.completedPartsByDay?.monday === true &&
        !getHwSession2.body?.studentAnswers?.matching?.fake,
      'GET /api/homework restores canonical homework after new session ignoring poisoned inMemoryDb'
    );

    // =========================================================================
    // CENÁRIO 2: Submissão e avaliação sem perda de respostas
    // =========================================================================
    console.log('\n--- Cenário 2: Submissão e avaliação sem perda de respostas ---');
    const submitRes = await simulateRequest(
      'POST',
      '/api/homework/submit',
      { Authorization: 'Bearer tok_student_a' },
      {
        studentUid: STUDENT_A_UID,
        weekId: 'week-3',
        weeklyCycle: 3,
        weeklyHomework: {
          ...initialHwPayload.weeklyHomework,
          completedPartsByDay: { tuesday: true },
          partsProgress: {
            fill: { partKey: 'fill', partNumber: 2, status: 'completed', score: 100 },
          },
          studentAnswers: {
            matching: {},
            fillInBlanks: { f1: 'schedule' },
            sentences: {},
            quizAnswers: { q1: 0 },
          },
        },
      }
    );
    const firstSubmittedAt = submitRes.body?.weeklyHomework?.submittedAt;
    assert(
      submitRes.status === 200 &&
        Boolean(firstSubmittedAt) &&
        submitRes.body?.weeklyHomework?.status === 'submitted' &&
        submitRes.body?.weeklyHomework?.studentAnswers?.matching?.m1 === 'schedule' &&
        submitRes.body?.weeklyHomework?.studentAnswers?.sentences?.schedule === 'I organize my daily schedule every morning.' &&
        submitRes.body?.weeklyHomework?.completedPartsByDay?.monday === true &&
        submitRes.body?.weeklyHomework?.completedPartsByDay?.tuesday === true &&
        submitRes.body?.weeklyHomework?.partsProgress?.matching?.status === 'completed' &&
        submitRes.body?.weeklyHomework?.partsProgress?.fill?.status === 'completed',
      'POST /api/homework/submit preserves prior answers, partsProgress and completedPartsByDay'
    );

    // Test /api/homework/evaluate preserving responses even if GEMINI_API_KEY is missing (503 persisted: true)
    // AND preserving pre-persisted valid evaluation cache hit (200)
    const savedGeminiKey = process.env.GEMINI_API_KEY;
    const savedApiKey = process.env.API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.API_KEY;

    const evalNoKeyRes = await simulateRequest(
      'POST',
      '/api/homework/evaluate',
      { Authorization: 'Bearer tok_student_a' },
      {
        studentUid: STUDENT_A_UID,
        weekId: 'week-3',
        weeklyCycle: 3,
        homework: initialHwPayload.weeklyHomework,
        studentAnswers: {
          matching: { m1: 'schedule' },
          fillInBlanks: { f1: 'schedule' },
          sentences: { schedule: 'I organize my daily schedule every morning.' },
          quizAnswers: { q1: 0 },
        },
      }
    );
    assert(
      evalNoKeyRes.status === 503 && evalNoKeyRes.body?.persisted === true,
      'POST /api/homework/evaluate without AI key fails transparently with persisted: true (zero synthetic evaluation)'
    );

    // Seed a genuine evaluation on canonical doc and confirm cached hit + non-loss on subsequent GET
    const genuineEval = {
      overallScore: 95,
      evaluatedAt: '2026-11-10T10:00:00.000Z',
      studentLevel: 'Beginner',
      tutorFeedbackSummaryPt: 'Excelente construção de frase com schedule.',
      tutorFeedbackSummaryEn: 'Great sentence structure using schedule.',
      levelStrengthsPt: 'Boa clareza.',
      levelStrengthsEn: 'Clear usage.',
      levelNextStepsPt: 'Continue praticando.',
      levelNextStepsEn: 'Keep practicing.',
      matchingFeedback: [{ id: 'm1', isCorrect: true, userAnswer: 'schedule', correctAnswer: 'schedule' }],
      fillFeedback: [{ id: 'f1', isCorrect: true, userAnswer: 'schedule', correctAnswer: 'schedule' }],
      sentenceFeedback: [
        {
          word: 'schedule',
          originalSentence: 'I organize my daily schedule every morning.',
          isCorrect: true,
          correctedSentence: 'I organize my daily schedule every morning.',
          explanationPt: 'Uso correto e natural.',
          explanationEn: 'Correct and natural usage.',
          levelAdvicePt: 'Bom domínio de presente simples.',
          levelAdviceEn: 'Good command of simple present.',
        },
      ],
      readingFeedback: [{ id: 'q1', isCorrect: true, userAnswer: 'Schedule', correctAnswer: 'Schedule' }],
    };
    await mockDb.collection('users').doc(STUDENT_A_UID).collection('homework').doc('week-3').set(
      { aiEvaluation: genuineEval, score: 95, isCompleted: true },
      { merge: true }
    );

    const evalCachedRes = await simulateRequest(
      'POST',
      '/api/homework/evaluate',
      { Authorization: 'Bearer tok_student_a' },
      {
        studentUid: STUDENT_A_UID,
        weekId: 'week-3',
        weeklyCycle: 3,
        homework: initialHwPayload.weeklyHomework,
        studentAnswers: {
          matching: { m1: 'schedule' },
          fillInBlanks: { f1: 'schedule' },
          sentences: { schedule: 'I organize my daily schedule every morning.' },
          quizAnswers: { q1: 0 },
        },
      }
    );
    if (savedGeminiKey !== undefined) process.env.GEMINI_API_KEY = savedGeminiKey;
    if (savedApiKey !== undefined) process.env.API_KEY = savedApiKey;

    assert(
      evalCachedRes.status === 200 &&
        evalCachedRes.body?.success === true &&
        evalCachedRes.body?.cached === true &&
        evalCachedRes.body?.evaluation?.overallScore === 95,
      'POST /api/homework/evaluate returns persisted genuine evaluation idempotently'
    );

    const afterEvalGet = await simulateRequest(
      'GET',
      `/api/homework?studentUid=${encodeURIComponent(STUDENT_A_UID)}&weekId=week-3`,
      { Authorization: 'Bearer tok_student_a' }
    );
    assert(
      afterEvalGet.status === 200 &&
        afterEvalGet.body?.aiEvaluation?.overallScore === 95 &&
        afterEvalGet.body?.studentAnswers?.sentences?.schedule === 'I organize my daily schedule every morning.' &&
        afterEvalGet.body?.submittedAt === firstSubmittedAt,
      'GET /api/homework preserves evaluation, score, submittedAt and all student responses'
    );

    // =========================================================================
    // CENÁRIO 3: Checks preservados após reinicialização simulada
    // =========================================================================
    console.log('\n--- Cenário 3: Checks preservados após reinicialização simulada ---');
    const saveChecksRes = await simulateRequest(
      'POST',
      '/api/routines/weekly-checks',
      { Authorization: 'Bearer tok_student_a' },
      {
        studentUid: STUDENT_A_UID,
        weekId: 'week-3',
        weeklyCycle: 3,
        checks: { video_day_monday: true, audio_day_monday: true, memorization_monday: true },
        weeklyNativeLessonsTarget: 3,
        weeklyStudyDaysTarget: 6,
        weeklyStudyDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'],
      }
    );
    assert(
      saveChecksRes.status === 200 &&
        saveChecksRes.body?.success === true &&
        saveChecksRes.body?.checks?.video_day_monday === true &&
        saveChecksRes.body?.weeklyNativeLessonsTarget === 3 &&
        saveChecksRes.body?.weeklyStudyDaysTarget === 6,
      'POST /api/routines/weekly-checks persists checks and S-Path targets canonically'
    );

    // Poison inMemoryDb and verify root users/{uid} has NO check mirrors written
    wipeAndPoisonInMemoryDb();
    const userRootSnap = await mockDb.collection('users').doc(STUDENT_A_UID).get();
    const userRootData = userRootSnap.data() || {};
    assert(
      userRootData.weeklyChecks === undefined && userRootData.sPathChecks === undefined && userRootData.weeklyHomework === undefined,
      'Root users/{uid} has ZERO weeklyChecks, sPathChecks or weeklyHomework mirrors'
    );

    const getChecksRestart = await simulateRequest(
      'GET',
      `/api/routines/weekly-checks?studentUid=${encodeURIComponent(STUDENT_A_UID)}&weekId=week-3`,
      { Authorization: 'Bearer tok_student_a' }
    );
    assert(
      getChecksRestart.status === 200 &&
        getChecksRestart.body?.checks?.video_day_monday === true &&
        getChecksRestart.body?.checks?.audio_day_monday === true &&
        getChecksRestart.body?.checks?.memorization_monday === true &&
        !getChecksRestart.body?.checks?.poisoned_key &&
        getChecksRestart.body?.weeklyNativeLessonsTarget === 3 &&
        getChecksRestart.body?.weeklyStudyDaysTarget === 6,
      'GET /api/routines/weekly-checks recovers canonical checks after restart simulation ignoring poisoned inMemoryDb'
    );

    // =========================================================================
    // CENÁRIO 4: Isolamento entre alunos
    // =========================================================================
    console.log('\n--- Cenário 4: Isolamento entre alunos ---');
    const saveStudentBChecks = await simulateRequest(
      'POST',
      '/api/routines/weekly-checks',
      { Authorization: 'Bearer tok_student_b' },
      {
        studentUid: STUDENT_B_UID,
        weekId: 'week-1',
        weeklyCycle: 1,
        checks: { tutor_live_wednesday: true },
      }
    );
    assert(saveStudentBChecks.status === 200, 'Student B saves own cycle 1 checks');

    const crossGetChecks = await simulateRequest(
      'GET',
      `/api/routines/weekly-checks?studentUid=${encodeURIComponent(STUDENT_B_UID)}&weekId=week-1`,
      { Authorization: 'Bearer tok_student_a' }
    );
    const crossPostChecks = await simulateRequest(
      'POST',
      '/api/routines/weekly-checks',
      { Authorization: 'Bearer tok_student_a' },
      { studentUid: STUDENT_B_UID, weekId: 'week-1', checks: { hacked: true } }
    );
    const crossGetHw = await simulateRequest(
      'GET',
      `/api/homework?studentUid=${encodeURIComponent(STUDENT_B_UID)}&weekId=week-1`,
      { Authorization: 'Bearer tok_student_a' }
    );
    const crossNestedHw = await simulateRequest(
      'POST',
      '/api/homework',
      { Authorization: 'Bearer tok_student_a' },
      {
        studentUid: STUDENT_A_UID,
        weekId: 'week-1',
        weeklyHomework: {
          studentUid: STUDENT_B_UID,
          weekId: 'week-1',
          studentAnswers: { matching: { hack: '1' } },
        },
      }
    );
    assert(
      crossGetChecks.status === 403 &&
        crossPostChecks.status === 403 &&
        crossGetHw.status === 403 &&
        crossNestedHw.status === 403,
      'Cross-student read/write and conflicting nested studentUid rejected with 403'
    );

    // Verify Student B data untouched
    const verifyBChecks = await simulateRequest(
      'GET',
      `/api/routines/weekly-checks?studentUid=${encodeURIComponent(STUDENT_B_UID)}&weekId=week-1`,
      { Authorization: 'Bearer tok_student_b' }
    );
    assert(
      verifyBChecks.status === 200 &&
        verifyBChecks.body?.checks?.tutor_live_wednesday === true &&
        !verifyBChecks.body?.checks?.hacked,
      'Student B checks completely isolated and unmodified'
    );

    // =========================================================================
    // CENÁRIO 5: Professor aprovado vinculado (sem custom claim) e Admin
    // =========================================================================
    console.log('\n--- Cenário 5: Professor aprovado vinculado e Admin ---');
    const teacherReadChecks = await simulateRequest(
      'GET',
      `/api/routines/weekly-checks?studentUid=${encodeURIComponent(STUDENT_A_UID)}&weekId=week-3`,
      { Authorization: 'Bearer tok_teacher_linked_no_claim' }
    );
    const teacherReadHw = await simulateRequest(
      'GET',
      `/api/homework?studentUid=${encodeURIComponent(STUDENT_A_UID)}&weekId=week-3`,
      { Authorization: 'Bearer tok_teacher_linked_no_claim' }
    );
    assert(
      teacherReadChecks.status === 200 &&
        teacherReadChecks.body?.checks?.video_day_monday === true &&
        teacherReadHw.status === 200 &&
        teacherReadHw.body?.studentAnswers?.matching?.m1 === 'schedule',
      'Approved linked teacher without custom teacher claim reads linked student checks and homework (200)'
    );

    // Teacher write should remain blocked (403)
    const teacherWriteChecks = await simulateRequest(
      'POST',
      '/api/routines/weekly-checks',
      { Authorization: 'Bearer tok_teacher_linked_no_claim' },
      { studentUid: STUDENT_A_UID, weekId: 'week-3', checks: { video_day_tuesday: true } }
    );
    const teacherWriteHw = await simulateRequest(
      'POST',
      '/api/homework',
      { Authorization: 'Bearer tok_teacher_linked_no_claim' },
      { studentUid: STUDENT_A_UID, weekId: 'week-3', weeklyHomework: { completedPartsByDay: { friday: true } } }
    );
    const teacherSubmitHw = await simulateRequest(
      'POST',
      '/api/homework/submit',
      { Authorization: 'Bearer tok_teacher_linked_no_claim' },
      { studentUid: STUDENT_A_UID, weekId: 'week-3', weeklyHomework: {} }
    );
    assert(
      teacherWriteChecks.status === 403 && teacherWriteHw.status === 403 && teacherSubmitHw.status === 403,
      'Teacher write operations on student checks/homework blocked with 403'
    );

    // Admin retains read & write access
    const adminReadHw = await simulateRequest(
      'GET',
      `/api/homework?studentUid=${encodeURIComponent(STUDENT_A_UID)}&weekId=week-3`,
      { Authorization: 'Bearer tok_admin' }
    );
    const adminWriteChecks = await simulateRequest(
      'POST',
      '/api/routines/weekly-checks',
      { Authorization: 'Bearer tok_admin' },
      { studentUid: STUDENT_A_UID, weekId: 'week-3', checks: { tutor_live_tuesday: true } }
    );
    assert(
      adminReadHw.status === 200 && adminWriteChecks.status === 200,
      'Admin retains read and write permissions'
    );

    // =========================================================================
    // CENÁRIO 6: Bloqueio sem token, token inválido, sem vínculo e UID sintético
    // =========================================================================
    console.log('\n--- Cenário 6: Bloqueios de autenticação, vínculo e UID sintético ---');
    const noToken = await simulateRequest('GET', `/api/homework?studentUid=${encodeURIComponent(STUDENT_A_UID)}&weekId=week-3`);
    const badToken = await simulateRequest('POST', '/api/routines/weekly-checks', { Authorization: 'Bearer invalid_tok' }, { weekId: 'week-3', checks: {} });
    const unlinkedTeacher = await simulateRequest(
      'GET',
      `/api/homework?studentUid=${encodeURIComponent(STUDENT_A_UID)}&weekId=week-3`,
      { Authorization: 'Bearer tok_teacher_unlinked' }
    );
    const pendingTeacher = await simulateRequest(
      'GET',
      `/api/routines/weekly-checks?studentUid=${encodeURIComponent(STUDENT_A_UID)}&weekId=week-3`,
      { Authorization: 'Bearer tok_teacher_pending' }
    );
    const syntheticUidReq = await simulateRequest(
      'POST',
      '/api/homework',
      { Authorization: 'Bearer tok_student_a' },
      { studentUid: 'usr-synthetic-123', weekId: 'week-3', weeklyHomework: {} }
    );
    assert(
      noToken.status === 401 &&
        badToken.status === 401 &&
        unlinkedTeacher.status === 403 &&
        pendingTeacher.status === 403 &&
        (syntheticUidReq.status === 403 || syntheticUidReq.status === 422),
      'Unauthenticated (401), invalid token (401), unlinked/pending teacher (403) and synthetic UID rejected'
    );

    // =========================================================================
    // CENÁRIO 7: Idempotência de operações repetidas
    // =========================================================================
    console.log('\n--- Cenário 7: Idempotência de operações repetidas ---');
    const repeatSubmit = await simulateRequest(
      'POST',
      '/api/homework/submit',
      { Authorization: 'Bearer tok_student_a' },
      {
        studentUid: STUDENT_A_UID,
        weekId: 'week-3',
        weeklyCycle: 3,
        weeklyHomework: {
          completedPartsByDay: { monday: true },
          studentAnswers: { matching: {}, fillInBlanks: {}, sentences: {}, quizAnswers: {} },
        },
      }
    );
    assert(
      repeatSubmit.status === 200 &&
        repeatSubmit.body?.weeklyHomework?.submittedAt === firstSubmittedAt &&
        repeatSubmit.body?.weeklyHomework?.studentAnswers?.matching?.m1 === 'schedule' &&
        repeatSubmit.body?.weeklyHomework?.studentAnswers?.sentences?.schedule === 'I organize my daily schedule every morning.',
      'Repeated POST /api/homework/submit is idempotent and preserves original submittedAt and responses'
    );

    // Empty checks payload WITHOUT reset: true must NOT wipe existing checks
    const emptyChecksNoReset = await simulateRequest(
      'POST',
      '/api/routines/weekly-checks',
      { Authorization: 'Bearer tok_student_a' },
      {
        studentUid: STUDENT_A_UID,
        weekId: 'week-3',
        weeklyCycle: 3,
        checks: {},
      }
    );
    assert(
      emptyChecksNoReset.status === 200 &&
        emptyChecksNoReset.body?.checks?.video_day_monday === true &&
        emptyChecksNoReset.body?.checks?.tutor_live_tuesday === true,
      'POST /api/routines/weekly-checks with empty checks (reset != true) preserves existing checks'
    );

    // =========================================================================
    // CENÁRIO 8: Proteção contra ciclos antigos e fallback legado read-only
    // =========================================================================
    console.log('\n--- Cenário 8: Proteção contra ciclos antigos & fallback read-only ---');
    const staleChecksPost = await simulateRequest(
      'POST',
      '/api/routines/weekly-checks',
      { Authorization: 'Bearer tok_student_a' },
      { studentUid: STUDENT_A_UID, weekId: 'week-2', weeklyCycle: 2, checks: { video_day_monday: true } }
    );
    const staleHwPost = await simulateRequest(
      'POST',
      '/api/homework',
      { Authorization: 'Bearer tok_student_a' },
      { studentUid: STUDENT_A_UID, weekId: 'week-1', weeklyCycle: 1, weeklyHomework: { completedPartsByDay: { friday: true } } }
    );
    const staleSubmitPost = await simulateRequest(
      'POST',
      '/api/homework/submit',
      { Authorization: 'Bearer tok_student_a' },
      { studentUid: STUDENT_A_UID, weekId: 'week-2', weeklyCycle: 2, weeklyHomework: {} }
    );
    const staleEvalPost = await simulateRequest(
      'POST',
      '/api/homework/evaluate',
      { Authorization: 'Bearer tok_student_a' },
      { studentUid: STUDENT_A_UID, weekId: 'week-1', weeklyCycle: 1, homework: initialHwPayload.weeklyHomework, studentAnswers: {} }
    );
    assert(
      staleChecksPost.status === 409 &&
        staleChecksPost.body?.error === 'STALE_CYCLE' &&
        staleHwPost.status === 409 &&
        staleHwPost.body?.error === 'STALE_CYCLE' &&
        staleSubmitPost.status === 409 &&
        staleSubmitPost.body?.error === 'STALE_CYCLE' &&
        staleEvalPost.status === 409 &&
        staleEvalPost.body?.error === 'STALE_CYCLE',
      'All write routes reject old cycles with 409 STALE_CYCLE'
    );

    // Seed legacy data on Student A (cycle 3) as test fixture and assert week-2/week-3 NEVER inherit it
    mockDb.suspendWriteLog = true;
    await mockDb.collection('users').doc(STUDENT_A_UID).set(
      {
        weeklyChecks: { leaked_legacy_check: true },
        weeklyHomework: { studentAnswers: { matching: { leaked: 'YES' } } },
      },
      { merge: true }
    );
    mockDb.suspendWriteLog = false;
    const week2GetChecks = await simulateRequest(
      'GET',
      `/api/routines/weekly-checks?studentUid=${encodeURIComponent(STUDENT_A_UID)}&weekId=week-2`,
      { Authorization: 'Bearer tok_student_a' }
    );
    const week3GetHwAfterPoison = await simulateRequest(
      'GET',
      `/api/homework?studentUid=${encodeURIComponent(STUDENT_A_UID)}&weekId=week-3`,
      { Authorization: 'Bearer tok_student_a' }
    );
    assert(
      week2GetChecks.status === 200 &&
        !week2GetChecks.body?.checks?.leaked_legacy_check &&
        !week3GetHwAfterPoison.body?.studentAnswers?.matching?.leaked,
      'Non-cycle-1 GET and existing canonical docs never absorb legacy root fields'
    );

    // Read-only fallback on cycle 1 when canonical doc is absent (Student Legacy)
    const writesBeforeLegacyGet = mockDb.writeLog.length;
    const legacyGetChecks = await simulateRequest(
      'GET',
      `/api/routines/weekly-checks?studentUid=${encodeURIComponent(STUDENT_LEGACY_UID)}&weekId=week-1`,
      { Authorization: 'Bearer tok_student_legacy' }
    );
    const legacyGetHw = await simulateRequest(
      'GET',
      `/api/homework?studentUid=${encodeURIComponent(STUDENT_LEGACY_UID)}&weekId=week-1`,
      { Authorization: 'Bearer tok_student_legacy' }
    );
    assert(
      legacyGetChecks.status === 200 &&
        legacyGetChecks.body?.checks?.video_day_monday === true &&
        legacyGetHw.status === 200 &&
        legacyGetHw.body?.studentAnswers?.matching?.m1 === 'coffee' &&
        mockDb.writeLog.length === writesBeforeLegacyGet,
      'Legacy cycle 1 fallback works read-only without creating canonical writes on GET'
    );

    // =========================================================================
    // CENÁRIO 9: Falha de escrita retorna erro real HTTP 500
    // =========================================================================
    console.log('\n--- Cenário 9: Falha de escrita no Firestore retorna erro real ---');
    mockDb.failWriteMatcher = (path) => path.includes(`users/${STUDENT_A_UID}/`);

    const failChecks = await simulateRequest(
      'POST',
      '/api/routines/weekly-checks',
      { Authorization: 'Bearer tok_student_a' },
      { studentUid: STUDENT_A_UID, weekId: 'week-3', weeklyCycle: 3, checks: { audio_day_tuesday: true } }
    );
    const failHw = await simulateRequest(
      'POST',
      '/api/homework',
      { Authorization: 'Bearer tok_student_a' },
      { studentUid: STUDENT_A_UID, weekId: 'week-3', weeklyCycle: 3, weeklyHomework: { completedPartsByDay: { wednesday: true } } }
    );
    const failSubmit = await simulateRequest(
      'POST',
      '/api/homework/submit',
      { Authorization: 'Bearer tok_student_a' },
      { studentUid: STUDENT_A_UID, weekId: 'week-3', weeklyCycle: 3, weeklyHomework: {} }
    );
    const failEval = await simulateRequest(
      'POST',
      '/api/homework/evaluate',
      { Authorization: 'Bearer tok_student_a' },
      {
        studentUid: STUDENT_A_UID,
        weekId: 'week-3',
        weeklyCycle: 3,
        homework: initialHwPayload.weeklyHomework,
        studentAnswers: {
          matching: { m1: 'schedule' },
          fillInBlanks: { f1: 'schedule' },
          sentences: { schedule: 'I organize a new schedule today.' },
          quizAnswers: { q1: 0 },
        },
      }
    );
    mockDb.failWriteMatcher = null;

    assert(
      failChecks.status === 500 &&
        failChecks.body?.success === false &&
        failHw.status === 500 &&
        failHw.body?.success === false &&
        failSubmit.status === 500 &&
        failSubmit.body?.success === false &&
        failEval.status === 500 &&
        failEval.body?.success === false,
      'Write failure returns HTTP 500 (success: false) on all 4 write routes'
    );

    // =========================================================================
    // CENÁRIO 10: Preservação ARCH.2E.2A / 2B, zero gravações redundantes e frontend client
    // =========================================================================
    console.log('\n--- Cenário 10: Preservação ARCH.2E.2A / 2B & auditoria de gravações ---');
    const forbiddenWrites = mockDb.writeLog.filter(
      (w) =>
        w.path.startsWith('student_homework/') ||
        w.path.includes('/current_week') ||
        w.path.startsWith('app_state/') ||
        (w.path === `users/${STUDENT_A_UID}` &&
          (w.keys.includes('weeklyChecks') || w.keys.includes('sPathChecks') || w.keys.includes('weeklyHomework')))
    );
    assert(
      forbiddenWrites.length === 0,
      `Zero redundant writes to student_homework, current_week, app_state or users/{uid} mirrors (found ${forbiddenWrites.length})`
    );

    // Verify ARCH.2E.2A video assign & get + ARCH.2E.2B Spotify assign & get remain operational
    readDb().spotifyPlaylists = {
      beginner: {
        tracks: [
          {
            trackId: '3H04Y8V3L2aVf7f2b1d3kK',
            title: 'Count On Me',
            artist: 'Bruno Mars',
            url: 'https://open.spotify.com/track/3H04Y8V3L2aVf7f2b1d3kK',
            embedUrl: 'https://open.spotify.com/embed/track/3H04Y8V3L2aVf7f2b1d3kK',
            durationMs: 197000,
            playlistId: '37i9dQZF1DXcBWIGoYBM5M',
            playlistTitle: 'Beginner Audio Official',
            level: 'beginner',
          },
        ],
      },
    };
    const videoAssign = await simulateRequest(
      'POST',
      '/api/student-video-assignments/assign',
      { Authorization: 'Bearer tok_teacher_linked_no_claim' },
      {
        studentUid: STUDENT_A_UID,
        day: 'monday',
        playlistId: 'PLUj52KVM_CdY',
        videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        idempotencyKey: 'vid-check-2c',
      }
    );
    const spotAssign = await simulateRequest(
      'POST',
      '/api/student-spotify-assignments/assign',
      { Authorization: 'Bearer tok_teacher_linked_no_claim' },
      {
        studentUid: STUDENT_A_UID,
        studentEmail: STUDENT_A_EMAIL,
        day: 'monday',
        level: 'beginner',
        idempotencyKey: 'spot-check-2c',
      }
    );
    const dailyVidRes = await simulateRequest(
      'GET',
      `/api/routines/daily-video?studentUid=${encodeURIComponent(STUDENT_A_UID)}`,
      { Authorization: 'Bearer tok_student_a' }
    );
    const spotGetRes = await simulateRequest(
      'GET',
      `/api/student-spotify-assignments?uid=${encodeURIComponent(STUDENT_A_UID)}`,
      { Authorization: 'Bearer tok_student_a' }
    );
    assert(
      videoAssign.status === 200 &&
        dailyVidRes.status === 200 &&
        dailyVidRes.body?.routinesByDay?.monday?.videoId === 'dQw4w9WgXcQ' &&
        spotAssign.status === 200 &&
        spotGetRes.status === 200 &&
        spotGetRes.body?.assignments?.some((a: any) => a.trackId === '3H04Y8V3L2aVf7f2b1d3kK'),
      'ARCH.2E.2A (video) and ARCH.2E.2B (Spotify) flows remain intact'
    );

    // Verify studentPersistence helpers route strictly through authenticated APIs
    const {
      saveStudentHomeworkProgressToFirestore,
      fetchStudentHomeworkProgressFromFirestore,
      saveStudentWeeklyChecksToFirestore,
      fetchStudentWeeklyChecksFromFirestore,
    } = await import('../src/utils/studentPersistence');

    const capturedFetchCalls: Array<{ url: string; method: string; body?: any }> = [];
    globalThis.fetch = (async (input: any, init?: any) => {
      const url = typeof input === 'string' ? input : input?.url || '';
      const method = (init?.method || 'GET').toUpperCase();
      const parsedBody = init?.body ? JSON.parse(String(init.body)) : undefined;
      capturedFetchCalls.push({ url, method, body: parsedBody });
      const res = await simulateRequest(
        method,
        url,
        { Authorization: 'Bearer tok_student_a', 'Content-Type': 'application/json' },
        parsedBody
      );
      return new Response(JSON.stringify(res.body), {
        status: res.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const feSaveHwOk = await saveStudentHomeworkProgressToFirestore(
      STUDENT_A_UID,
      STUDENT_A_EMAIL,
      { ...initialHwPayload.weeklyHomework, id: 'week-3', weekId: 'week-3', weeklyCycle: 3 } as any,
      'week-3',
      { submit: true }
    );
    const feFetchHw = await fetchStudentHomeworkProgressFromFirestore(STUDENT_A_UID, STUDENT_A_EMAIL, 'week-3');
    const feSaveChecksOk = await saveStudentWeeklyChecksToFirestore(
      STUDENT_A_UID,
      { video_day_wednesday: true },
      STUDENT_A_EMAIL,
      3,
      6,
      3
    );
    const feFetchChecks = await fetchStudentWeeklyChecksFromFirestore(STUDENT_A_UID, STUDENT_A_EMAIL, 3);

    assert(
      feSaveHwOk === true &&
        Boolean(feFetchHw?.studentAnswers?.matching?.m1) &&
        feSaveChecksOk === true &&
        feFetchChecks?.checks?.video_day_wednesday === true &&
        capturedFetchCalls.some((c) => c.url === '/api/homework/submit' && c.method === 'POST') &&
        capturedFetchCalls.some((c) => c.url.startsWith('/api/homework?') && c.method === 'GET') &&
        capturedFetchCalls.some((c) => c.url === '/api/routines/weekly-checks' && c.method === 'POST') &&
        capturedFetchCalls.some((c) => c.url.startsWith('/api/routines/weekly-checks?') && c.method === 'GET'),
      'Frontend studentPersistence helpers operate exclusively via authenticated HTTP APIs'
    );

    console.log('\n================================================================================');
    console.log(` RESULTADO ARCH.2E.2C: ${passed} PASSOU | ${failed} FALHOU`);
    console.log('================================================================================');
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;

    for (const handle of trackedIntervals) {
      originalClearInterval(handle);
    }
    trackedIntervals.clear();

    for (const handle of trackedTimeouts) {
      originalClearTimeout(handle);
    }
    trackedTimeouts.clear();

    mockDb.failWriteMatcher = null;
    setFirebaseAdminAuthForTesting(null);
    setFirebaseAdminFirestoreForTesting(null);
  }

  if (failed > 0) {
    process.exit(1);
  }
  process.exit(0);
}

runTests().catch((err) => {
  console.error('Fatal test failure:', err);
  process.exit(1);
});
