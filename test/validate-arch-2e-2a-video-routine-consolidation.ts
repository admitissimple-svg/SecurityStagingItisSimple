/**
 * ARCH.2E.2A — Consolidação Canônica de Vídeos e Rotinas do S-Path
 *
 * Bateria de testes direcionada cobrindo os 8 requisitos obrigatórios e todas as 10 rotas consolidadas:
 * 1. Professor aprovado (mesmo sem custom claim de teacher no token) atribui vídeo a aluno vinculado.
 * 2. Aluno recupera vídeo atribuído e rotina após nova sessão.
 * 3. Dois alunos (A e B) não compartilham rotinas, vídeos, palavras ou progresso.
 * 4. Atribuição não desaparece após simulação de reinicialização (limpeza de inMemoryDb).
 * 5. Repetição da mesma requisição (assign / distribute-week) é idempotente e não duplica atribuições.
 * 6. Acesso sem token (401), token inválido (401), aluno cruzado (403), professor não vinculado (403)
 *    e professor pendente/não aprovado (403) são negados sem gravações.
 * 7. Falha de escrita no Firestore retorna HTTP 500 (success: false), nunca falso sucesso.
 * 8. Vídeos e rotinas do ciclo ativo (weeklyCycle: 3) não são sobrescritos por ciclos antigos (409 STALE_CYCLE)
 *    nem por memória vazia.
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
    this.col.db.checkWriteFailure(this.path);
    const existing = this.col.docs.get(this.id) || {};
    const merged = options?.merge ? deepMergeObjects(existing, data) : deepClone(data);
    this.col.docs.set(this.id, merged);
    return { writeTime: new Date() };
  }

  async update(data: any) {
    this.col.db.checkWriteFailure(this.path);
    const existing = this.col.docs.get(this.id);
    if (!existing) throw new Error(`NOT_FOUND: ${this.path}`);
    this.col.docs.set(this.id, deepMergeObjects(existing, data));
    return { writeTime: new Date() };
  }

  async delete() {
    this.col.db.checkWriteFailure(this.path);
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
  public writeCount = 0;

  collection(name: string): MockCollection {
    if (!this.collections.has(name)) {
      this.collections.set(name, new MockCollection(name, this));
    }
    return this.collections.get(name)!;
  }

  checkWriteFailure(path: string) {
    if (this.failWriteMatcher && this.failWriteMatcher(path)) {
      throw new Error(`Simulated Firestore write failure on ${path}`);
    }
    this.writeCount++;
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
  console.log(" IT'S SIMPLE — ARCH.2E.2A: CONSOLIDAÇÃO CANÔNICA DE VÍDEOS E ROTINAS DO S-PATH");
  console.log('================================================================================\n');

  const mockDb = new MockFirestoreDb();
  setFirebaseAdminFirestoreForTesting(mockDb as any);

  const STUDENT_A_UID = 'StuA_CanonUid12345678901234';
  const STUDENT_A_EMAIL = 'student.a.arch2e2a@gmail.com';
  const STUDENT_B_UID = 'StuB_CanonUid12345678901234';
  const STUDENT_B_EMAIL = 'student.b.arch2e2a@gmail.com';
  const TEACHER_LINKED_UID = 'TchL_CanonUid12345678901234';
  const TEACHER_LINKED_EMAIL = 'teacher.linked.arch2e2a@gmail.com';
  const TEACHER_LINKED_PUBLIC_ID = 'tutor-linked-arch2e2a';
  const TEACHER_UNLINKED_UID = 'TchU_CanonUid12345678901234';
  const TEACHER_UNLINKED_EMAIL = 'teacher.unlinked.arch2e2a@gmail.com';
  const TEACHER_PENDING_UID = 'TchP_CanonUid12345678901234';
  const TEACHER_PENDING_EMAIL = 'teacher.pending.arch2e2a@gmail.com';
  const ADMIN_UID = 'Adm_CanonUid123456789012345';
  const ADMIN_EMAIL = 'admin.arch2e2a@gmail.com';

  const tokensDb = new Map<string, any>();
  tokensDb.set('tok_student_a', { uid: STUDENT_A_UID, email: STUDENT_A_EMAIL, email_verified: true, role: 'student' });
  tokensDb.set('tok_student_b', { uid: STUDENT_B_UID, email: STUDENT_B_EMAIL, email_verified: true, role: 'student' });
  // Linked teacher token deliberately WITHOUT custom 'teacher' claim (simulates real production Firebase token!)
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

  // Seed canonical Firestore (default) profiles and tutors
  await mockDb.collection('users').doc(STUDENT_A_UID).set({
    id: STUDENT_A_UID,
    uid: STUDENT_A_UID,
    email: STUDENT_A_EMAIL,
    name: 'Student Alpha',
    role: 'student',
    level: 'beginner',
    englishLevel: 'beginner',
    weeklyCycle: 3,
    weeklyStudyDays: ['monday', 'wednesday', 'friday'],
    routineVideoTime: '08:00',
    routineAudioTime: '19:30',
    assignedNativeFriendUID: TEACHER_LINKED_UID,
    teacherUid: TEACHER_LINKED_UID,
    teacherEmail: TEACHER_LINKED_EMAIL,
  });

  await mockDb.collection('users').doc(STUDENT_B_UID).set({
    id: STUDENT_B_UID,
    uid: STUDENT_B_UID,
    email: STUDENT_B_EMAIL,
    name: 'Student Beta',
    role: 'student',
    level: 'intermediate',
    englishLevel: 'intermediate',
    weeklyCycle: 1,
    weeklyStudyDays: ['tuesday', 'thursday'],
    routineVideoTime: '10:00',
    routineAudioTime: '21:00',
    assignedNativeFriendUID: TEACHER_UNLINKED_UID,
    teacherUid: TEACHER_UNLINKED_UID,
    teacherEmail: TEACHER_UNLINKED_EMAIL,
  });

  // Linked approved teacher in /tutors (even without role field in /tutors, and no custom claim in Auth)
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

  // Unlinked approved teacher
  await mockDb.collection('tutors').doc('tutor-unlinked-arch2e2a').set({
    id: 'tutor-unlinked-arch2e2a',
    authUid: TEACHER_UNLINKED_UID,
    uid: TEACHER_UNLINKED_UID,
    email: TEACHER_UNLINKED_EMAIL,
    name: 'Unlinked Approved Native Friend',
    role: 'teacher',
    isApproved: true,
    approvalStatus: 'approved',
  });

  // Pending / unapproved teacher
  await mockDb.collection('tutors').doc('tutor-pending-arch2e2a').set({
    id: 'tutor-pending-arch2e2a',
    authUid: TEACHER_PENDING_UID,
    uid: TEACHER_PENDING_UID,
    email: TEACHER_PENDING_EMAIL,
    name: 'Pending Native Friend',
    role: 'teacher',
    isApproved: false,
    approvalStatus: 'pending',
  });

  // Seed legacy Cycle 1 assignment in student_assignments/{STUDENT_A_UID} to verify cycle isolation
  await mockDb.collection('student_assignments').doc(STUDENT_A_UID).set({
    uid: STUDENT_A_UID,
    email: STUDENT_A_EMAIL,
    level: 'beginner',
    weeklyCycle: 3,
    videoAssignments: [
      {
        id: 'old_cycle1_assign',
        day: 'monday',
        videoId: 'oldCyc1Vid0',
        videoTitle: 'Old Cycle 1 Video (Should Never Show)',
        weeklyCycle: 1,
      },
    ],
    watchedVideos: [],
    awaitingTopicSelection: true,
  });

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

  function wipeInMemoryState() {
    const db = readDb();
    db.studentRoutinesMap = {};
    db.studentVideoAssignments = {};
    db.routinesByDay = {} as any;
    db.studentWatchedVideos = {};
    db.userProfiles = {};
    db.students = [];
  }

  // Ensure in-memory state starts empty so Firestore (default) is tested exclusively
  wipeInMemoryState();

  // ==========================================================================
  console.log('--- 1. Professor aprovado (sem custom claim) atribui vídeo a aluno vinculado ---');
  // ==========================================================================
  const assignRes = await simulateRequest(
    'POST',
    '/api/student-video-assignments/assign',
    { authorization: 'Bearer tok_teacher_linked_no_claim' },
    {
      studentUid: STUDENT_A_UID,
      studentEmail: STUDENT_A_EMAIL,
      day: 'monday',
      playlistId: 'daily-english',
      videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      teacherNotes: 'Watch carefully and note 5 expressions.',
      weeklyCycle: 3,
      idempotencyKey: 'assign-stuA-mon-c3',
    }
  );
  assert(
    assignRes.status === 200 &&
      assignRes.body?.success === true &&
      assignRes.body?.studentUid === STUDENT_A_UID &&
      assignRes.body?.video?.videoId === 'dQw4w9WgXcQ' &&
      assignRes.body?.weeklyCycle === 3,
    'Professor aprovado sem custom claim atribui vídeo em POST /api/student-video-assignments/assign'
  );

  // Also test POST /api/routines/teacher-video on Wednesday
  const teacherVideoRes = await simulateRequest(
    'POST',
    '/api/routines/teacher-video',
    { authorization: 'Bearer tok_teacher_linked_no_claim' },
    {
      studentUid: STUDENT_A_UID,
      day: 'wednesday',
      playlistId: 'pronunciation',
      playlistTitle: 'Pronunciation Lab',
      teacherNotes: 'Focus on TH sounds.',
      weeklyCycle: 3,
      videos: [
        {
          videoId: '9bZkp7q19f0',
          title: 'Wednesday Pronunciation Video',
          url: 'https://www.youtube.com/watch?v=9bZkp7q19f0',
        },
      ],
    }
  );
  assert(
    teacherVideoRes.status === 200 && teacherVideoRes.body?.success === true && teacherVideoRes.body?.weeklyCycle === 3,
    'Professor vinculado atribui vídeo via POST /api/routines/teacher-video'
  );

  // Verify Firestore documents were written on users/{uid}/routines/{day} and student_assignments/{uid}
  const monSubSnap = await mockDb.collection('users').doc(STUDENT_A_UID).collection('routines').doc('monday').get();
  const wedSubSnap = await mockDb.collection('users').doc(STUDENT_A_UID).collection('routines').doc('wednesday').get();
  const stuAAssignSnap = await mockDb.collection('student_assignments').doc(STUDENT_A_UID).get();
  assert(
    monSubSnap.exists &&
      monSubSnap.data()?.videoId === 'dQw4w9WgXcQ' &&
      monSubSnap.data()?.weeklyCycle === 3 &&
      wedSubSnap.exists &&
      wedSubSnap.data()?.videoId === '9bZkp7q19f0',
    'Atribuições persistidas diretamente em users/{uid}/routines/{dayOfWeek}'
  );
  assert(
    stuAAssignSnap.exists &&
      Array.isArray(stuAAssignSnap.data()?.videoAssignments) &&
      stuAAssignSnap.data()?.videoAssignments.some((a: any) => a.day === 'monday' && a.videoId === 'dQw4w9WgXcQ') &&
      stuAAssignSnap.data()?.videoAssignments.some((a: any) => a.day === 'wednesday' && a.videoId === '9bZkp7q19f0'),
    'Atribuições persistidas em student_assignments/{uid}'
  );

  // ==========================================================================
  console.log('\n--- 2. Aluno recupera vídeo atribuído após nova sessão & fluxo completo de rotina ---');
  // ==========================================================================
  // Save words, toggle complete, watch, update-time as Student A
  const wordsRes = await simulateRequest(
    'POST',
    '/api/routines/words',
    { authorization: 'Bearer tok_student_a' },
    { day: 'monday', words: ['resilience', 'eloquent', 'breakthrough'], weeklyCycle: 3 }
  );
  assert(
    wordsRes.status === 200 && wordsRes.body?.success === true && wordsRes.body?.learnedWords?.length === 3,
    'Aluno salva palavras aprendidas via POST /api/routines/words'
  );

  const toggleRes = await simulateRequest(
    'POST',
    '/api/routines/toggle',
    { authorization: 'Bearer tok_student_a' },
    {
      day: 'monday',
      activityId: 'mon-1',
      activityType: 'video',
      completed: true,
      completedToday: true,
      videoId: 'dQw4w9WgXcQ',
      videoTitle: 'Teacher Selected Video',
      weeklyCycle: 3,
    }
  );
  assert(
    toggleRes.status === 200 && toggleRes.body?.completed === true && toggleRes.body?.completedToday === true,
    'Aluno alterna conclusão da rotina via POST /api/routines/toggle'
  );

  const watchRes = await simulateRequest(
    'POST',
    '/api/student-video-assignments/watch',
    { authorization: 'Bearer tok_student_a' },
    { videoId: '9bZkp7q19f0', videoTitle: 'Wednesday Pronunciation Video' }
  );
  assert(
    watchRes.status === 200 &&
      watchRes.body?.success === true &&
      watchRes.body?.watchedVideos?.includes('dQw4w9WgXcQ') &&
      watchRes.body?.watchedVideos?.includes('9bZkp7q19f0'),
    'Aluno registra vídeo assistido via POST /api/student-video-assignments/watch'
  );

  const timeRes = await simulateRequest(
    'POST',
    '/api/routines/update-time',
    { authorization: 'Bearer tok_student_a' },
    { day: 'monday', activityId: 'mon-1', time: '07:45', weeklyCycle: 3 }
  );
  assert(
    timeRes.status === 200 && timeRes.body?.success === true,
    'Aluno atualiza horário da rotina via POST /api/routines/update-time'
  );

  // Student A recovers everything in a fresh GET session
  const stuRoutinesRes = await simulateRequest('GET', '/api/student-routines', { authorization: 'Bearer tok_student_a' });
  const stuAssignGetRes = await simulateRequest('GET', '/api/student-video-assignments', { authorization: 'Bearer tok_student_a' });
  const stuDailyVideoRes = await simulateRequest('GET', '/api/routines/daily-video?day=monday', { authorization: 'Bearer tok_student_a' });

  const monSlot1 = stuRoutinesRes.body?.monday?.[0];
  const wedSlot1 = stuRoutinesRes.body?.wednesday?.[0];
  assert(
    stuRoutinesRes.status === 200 &&
      monSlot1?.teacherVideos?.[0]?.videoId === 'dQw4w9WgXcQ' &&
      wedSlot1?.teacherVideos?.[0]?.videoId === '9bZkp7q19f0' &&
      monSlot1?.learnedWords?.includes('resilience') &&
      monSlot1?.completedToday === true &&
      monSlot1?.time === '07:45',
    'GET /api/student-routines recupera vídeos atribuídos, palavras, status concluído e horário'
  );
  assert(
    stuAssignGetRes.status === 200 &&
      stuAssignGetRes.body?.weeklyCycle === 3 &&
      stuAssignGetRes.body?.assignments?.some((a: any) => a.videoId === 'dQw4w9WgXcQ') &&
      stuAssignGetRes.body?.watched?.includes('dQw4w9WgXcQ') &&
      stuAssignGetRes.body?.watched?.includes('9bZkp7q19f0'),
    'GET /api/student-video-assignments recupera atribuições e histórico assistido canônicos'
  );
  assert(
    stuDailyVideoRes.status === 200 &&
      stuDailyVideoRes.body?.currentDayRoutine?.videoId === 'dQw4w9WgXcQ' &&
      stuDailyVideoRes.body?.routinesByDay?.wednesday?.videoId === '9bZkp7q19f0',
    'GET /api/routines/daily-video recupera rotina diária e vídeo canônico do Firestore'
  );

  // ==========================================================================
  console.log('\n--- 3. Isolamento estrito entre dois alunos (Student A vs Student B) ---');
  // ==========================================================================
  // Student B selects their own video via POST /api/routines/daily-video
  const stuBDailyPost = await simulateRequest(
    'POST',
    '/api/routines/daily-video',
    { authorization: 'Bearer tok_student_b' },
    {
      dayOfWeek: 'monday',
      videoId: 'jNQXAC9IVRw',
      title: 'Student B Exclusive Video',
      url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw',
      playlistId: 'custom_suggestion',
      playlistTitle: 'Your Suggestion',
      weeklyCycle: 1,
    }
  );
  assert(
    stuBDailyPost.status === 200 && stuBDailyPost.body?.success === true && stuBDailyPost.body?.studentUid === STUDENT_B_UID,
    'Student B salva vídeo próprio em POST /api/routines/daily-video'
  );

  const stuBRoutines = await simulateRequest('GET', '/api/student-routines', { authorization: 'Bearer tok_student_b' });
  const stuARoutinesAfterB = await simulateRequest('GET', '/api/student-routines', { authorization: 'Bearer tok_student_a' });
  assert(
    stuBRoutines.status === 200 &&
      stuBRoutines.body?.monday?.[0]?.teacherVideos?.[0]?.videoId === 'jNQXAC9IVRw' &&
      !stuBRoutines.body?.monday?.[0]?.learnedWords?.includes('resilience') &&
      !stuBRoutines.body?.wednesday?.[0]?.teacherVideos?.length,
    'Student B vê apenas suas próprias rotinas/vídeos (zero vazamento de Student A)'
  );
  assert(
    stuARoutinesAfterB.status === 200 &&
      stuARoutinesAfterB.body?.monday?.[0]?.teacherVideos?.[0]?.videoId === 'dQw4w9WgXcQ' &&
      stuARoutinesAfterB.body?.monday?.[0]?.teacherVideos?.[0]?.videoId !== 'jNQXAC9IVRw',
    'Student A mantém suas rotinas intactas após escrita de Student B'
  );

  // ==========================================================================
  console.log('\n--- 4. Persistência após simulação de reinicialização (limpeza de inMemoryDb) ---');
  // ==========================================================================
  wipeInMemoryState();
  const dbAfterWipe = readDb();
  // Inject poison/empty legacy in-memory maps that must be completely ignored
  dbAfterWipe.routinesByDay = {} as any;
  dbAfterWipe.studentRoutinesMap = { [STUDENT_A_UID]: {}, [STUDENT_A_EMAIL]: {} };
  dbAfterWipe.studentVideoAssignments = { [STUDENT_A_UID]: [] };

  const afterRestartRoutines = await simulateRequest('GET', '/api/student-routines', { authorization: 'Bearer tok_student_a' });
  const afterRestartAssign = await simulateRequest('GET', '/api/student-video-assignments', { authorization: 'Bearer tok_student_a' });
  assert(
    afterRestartRoutines.status === 200 &&
      afterRestartRoutines.body?.monday?.[0]?.teacherVideos?.[0]?.videoId === 'dQw4w9WgXcQ' &&
      afterRestartRoutines.body?.wednesday?.[0]?.teacherVideos?.[0]?.videoId === '9bZkp7q19f0' &&
      afterRestartAssign.body?.assignments?.some((a: any) => a.videoId === 'dQw4w9WgXcQ'),
    'Atribuições persistem após limpeza total de inMemoryDb (memória vazia não sobrescreve Firestore)'
  );

  // ==========================================================================
  console.log('\n--- 5. Idempotência em /assign e /distribute-week ---');
  // ==========================================================================
  const assignRepeat = await simulateRequest(
    'POST',
    '/api/student-video-assignments/assign',
    { authorization: 'Bearer tok_teacher_linked_no_claim' },
    {
      studentUid: STUDENT_A_UID,
      studentEmail: STUDENT_A_EMAIL,
      day: 'monday',
      playlistId: 'daily-english',
      videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      weeklyCycle: 3,
      idempotencyKey: 'assign-stuA-mon-c3',
    }
  );
  const assignSnapAfterRepeat = await mockDb.collection('student_assignments').doc(STUDENT_A_UID).get();
  const mondayEntries = (assignSnapAfterRepeat.data()?.videoAssignments || []).filter((a: any) => a.day === 'monday' && Number(a.weeklyCycle || 3) === 3);
  assert(
    assignRepeat.status === 200 &&
      assignRepeat.body?.idempotentReplay === true &&
      assignRepeat.body?.video?.videoId === 'dQw4w9WgXcQ' &&
      mondayEntries.length === 1,
    'Repetição de POST /api/student-video-assignments/assign retorna idempotentReplay e não duplica dia'
  );

  // Distribute week first call and identical replay
  const dist1 = await simulateRequest(
    'POST',
    '/api/student-video-assignments/distribute-week',
    { authorization: 'Bearer tok_teacher_linked_no_claim' },
    {
      studentUid: STUDENT_A_UID,
      studentEmail: STUDENT_A_EMAIL,
      days: ['friday'],
      weeklyCycle: 3,
      idempotencyKey: 'dist-stuA-fri-c3',
    }
  );
  const dist2 = await simulateRequest(
    'POST',
    '/api/student-video-assignments/distribute-week',
    { authorization: 'Bearer tok_teacher_linked_no_claim' },
    {
      studentUid: STUDENT_A_UID,
      studentEmail: STUDENT_A_EMAIL,
      days: ['friday'],
      weeklyCycle: 3,
      idempotencyKey: 'dist-stuA-fri-c3',
    }
  );
  const assignSnapAfterDist = await mockDb.collection('student_assignments').doc(STUDENT_A_UID).get();
  const fridayEntries = (assignSnapAfterDist.data()?.videoAssignments || []).filter((a: any) => a.day === 'friday' && Number(a.weeklyCycle || 3) === 3);
  assert(
    dist1.status === 200 &&
      dist1.body?.success === true &&
      dist2.status === 200 &&
      dist2.body?.idempotentReplay === true &&
      dist1.body?.assignments?.[0]?.videoId === dist2.body?.assignments?.[0]?.videoId &&
      fridayEntries.length === 1,
    'Repetição de POST /api/student-video-assignments/distribute-week é idempotente sem duplicações'
  );

  // ==========================================================================
  console.log('\n--- 6. Segurança: Sem token, token inválido, sem vínculo e pendente ---');
  // ==========================================================================
  const writesBeforeSecurity = mockDb.writeCount;

  const noTokenGet = await simulateRequest('GET', '/api/student-routines');
  const invalidTokenAssign = await simulateRequest(
    'POST',
    '/api/student-video-assignments/assign',
    { authorization: 'Bearer bogus_invalid_token' },
    { studentUid: STUDENT_A_UID, day: 'monday' }
  );
  const crossStudentGet = await simulateRequest('GET', `/api/student-routines?studentUid=${STUDENT_B_UID}`, {
    authorization: 'Bearer tok_student_a',
  });
  const crossStudentWords = await simulateRequest(
    'POST',
    '/api/routines/words',
    { authorization: 'Bearer tok_student_a' },
    { studentUid: STUDENT_B_UID, day: 'monday', words: ['hacked'] }
  );
  const unlinkedTeacherAssign = await simulateRequest(
    'POST',
    '/api/student-video-assignments/assign',
    { authorization: 'Bearer tok_teacher_unlinked' },
    { studentUid: STUDENT_A_UID, day: 'monday', playlistId: 'daily-english' }
  );
  const pendingTeacherDist = await simulateRequest(
    'POST',
    '/api/student-video-assignments/distribute-week',
    { authorization: 'Bearer tok_teacher_pending' },
    { studentUid: STUDENT_A_UID, days: ['monday'] }
  );
  const syntheticUidAssign = await simulateRequest(
    'POST',
    '/api/student-video-assignments/assign',
    { authorization: 'Bearer tok_admin' },
    { studentUid: 'st-1792444489029', day: 'monday' }
  );

  assert(
    noTokenGet.status === 401 && invalidTokenAssign.status === 401,
    'Requisições sem token ou com token inválido retornam HTTP 401'
  );
  assert(
    crossStudentGet.status === 403 && crossStudentWords.status === 403,
    'Aluno tentando ler ou gravar rotina de outro aluno é negado com HTTP 403'
  );
  assert(
    unlinkedTeacherAssign.status === 403 && pendingTeacherDist.status === 403,
    'Professor sem vínculo e tutor pendente/não aprovado são negados com HTTP 403'
  );
  assert(
    syntheticUidAssign.status === 422 || syntheticUidAssign.status === 403,
    'UID sintético não canônico é rejeitado'
  );
  assert(
    mockDb.writeCount === writesBeforeSecurity,
    'Nenhuma escrita executada no Firestore durante falhas de autenticação/autorização'
  );

  // ==========================================================================
  console.log('\n--- 7. Falha de escrita no Firestore NÃO retorna falso sucesso ---');
  // ==========================================================================
  mockDb.failWriteMatcher = (path: string) => path.includes('/routines/') || path.includes('student_assignments/');

  const failAssign = await simulateRequest(
    'POST',
    '/api/student-video-assignments/assign',
    { authorization: 'Bearer tok_teacher_linked_no_claim' },
    {
      studentUid: STUDENT_A_UID,
      day: 'tuesday',
      playlistId: 'daily-english',
      forceNewVideo: true,
      weeklyCycle: 3,
    }
  );
  const failDailyPost = await simulateRequest(
    'POST',
    '/api/routines/daily-video',
    { authorization: 'Bearer tok_student_a' },
    {
      day: 'tuesday',
      videoId: 'abc123def45',
      title: 'Should Fail Write',
      weeklyCycle: 3,
    }
  );
  const failWords = await simulateRequest(
    'POST',
    '/api/routines/words',
    { authorization: 'Bearer tok_student_a' },
    { day: 'tuesday', words: ['failword'], weeklyCycle: 3 }
  );
  const failToggle = await simulateRequest(
    'POST',
    '/api/routines/toggle',
    { authorization: 'Bearer tok_student_a' },
    { day: 'tuesday', activityId: 'tue-1', completed: true, weeklyCycle: 3 }
  );
  const failWatch = await simulateRequest(
    'POST',
    '/api/student-video-assignments/watch',
    { authorization: 'Bearer tok_student_a' },
    { videoId: 'xyz987uvw65' }
  );
  const failUpdateTime = await simulateRequest(
    'POST',
    '/api/routines/update-time',
    { authorization: 'Bearer tok_student_a' },
    { day: 'tuesday', activityId: 'tue-1', time: '09:00', weeklyCycle: 3 }
  );

  mockDb.failWriteMatcher = null;

  assert(
    failAssign.status === 500 &&
      failAssign.body?.success === false &&
      failDailyPost.status === 500 &&
      failDailyPost.body?.success === false &&
      failWords.status === 500 &&
      failWords.body?.success === false &&
      failToggle.status === 500 &&
      failToggle.body?.success === false &&
      failWatch.status === 500 &&
      failWatch.body?.success === false &&
      failUpdateTime.status === 500 &&
      failUpdateTime.body?.success === false,
    'Todas as rotas retornam HTTP 500 e success: false quando a escrita no Firestore falha'
  );

  // ==========================================================================
  console.log('\n--- 8. Proteção contra ciclo antigo e exclusão de dados legados obsoletos ---');
  // ==========================================================================
  const staleAssign = await simulateRequest(
    'POST',
    '/api/student-video-assignments/assign',
    { authorization: 'Bearer tok_teacher_linked_no_claim' },
    {
      studentUid: STUDENT_A_UID,
      day: 'monday',
      videoUrl: 'https://www.youtube.com/watch?v=staleVid001',
      weeklyCycle: 2,
      forceNewVideo: true,
    }
  );
  const staleDaily = await simulateRequest(
    'POST',
    '/api/routines/daily-video',
    { authorization: 'Bearer tok_student_a' },
    {
      day: 'monday',
      videoId: 'staleVid002',
      weeklyCycle: 1,
    }
  );
  const staleTeacherVid = await simulateRequest(
    'POST',
    '/api/routines/teacher-video',
    { authorization: 'Bearer tok_teacher_linked_no_claim' },
    {
      studentUid: STUDENT_A_UID,
      day: 'monday',
      weeklyCycle: 2,
      videos: [{ videoId: 'staleVid003', title: 'Stale' }],
    }
  );
  const staleDistribute = await simulateRequest(
    'POST',
    '/api/student-video-assignments/distribute-week',
    { authorization: 'Bearer tok_teacher_linked_no_claim' },
    {
      studentUid: STUDENT_A_UID,
      days: ['monday'],
      weeklyCycle: 1,
      forceRedistribute: true,
    }
  );
  const staleWords = await simulateRequest(
    'POST',
    '/api/routines/words',
    { authorization: 'Bearer tok_student_a' },
    { day: 'monday', words: ['staleword'], weeklyCycle: 2 }
  );
  const staleToggle = await simulateRequest(
    'POST',
    '/api/routines/toggle',
    { authorization: 'Bearer tok_student_a' },
    { day: 'monday', activityId: 'mon-1', completed: false, weeklyCycle: 2 }
  );
  const staleTime = await simulateRequest(
    'POST',
    '/api/routines/update-time',
    { authorization: 'Bearer tok_student_a' },
    { day: 'monday', activityId: 'mon-1', time: '01:00', weeklyCycle: 2 }
  );

  assert(
    staleAssign.status === 409 &&
      staleAssign.body?.error === 'STALE_CYCLE' &&
      staleDaily.status === 409 &&
      staleTeacherVid.status === 409 &&
      staleDistribute.status === 409 &&
      staleWords.status === 409 &&
      staleToggle.status === 409 &&
      staleTime.status === 409,
    'Payloads de ciclos antigos (< activeCycle=3) são rejeitados com HTTP 409 STALE_CYCLE em todas as rotas'
  );

  const finalCheckRoutines = await simulateRequest('GET', '/api/student-routines', { authorization: 'Bearer tok_student_a' });
  const finalCheckAssign = await simulateRequest('GET', '/api/student-video-assignments', { authorization: 'Bearer tok_student_a' });
  const hasCycle1Video = (finalCheckAssign.body?.assignments || []).some((a: any) => a.videoId === 'oldCyc1Vid0');
  assert(
    finalCheckRoutines.body?.monday?.[0]?.teacherVideos?.[0]?.videoId === 'dQw4w9WgXcQ' &&
      finalCheckRoutines.body?.monday?.[0]?.completedToday === true &&
      finalCheckRoutines.body?.monday?.[0]?.time === '07:45' &&
      !hasCycle1Video,
    'Vídeos, progresso e horário do ciclo ativo (ciclo 3) permanecem íntegros e dados de ciclo 1 não contaminam retorno'
  );

  console.log('\n================================================================================');
  console.log(`TOTAL ARCH.2E.2A TESTS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
  console.log('================================================================================\n');

  if (failed > 0) process.exit(1);
  process.exit(0);
}

runTests().catch((err) => {
  console.error('Fatal error in validate-arch-2e-2a-video-routine-consolidation:', err);
  process.exit(1);
});
