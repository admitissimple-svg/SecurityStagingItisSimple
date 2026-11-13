/**
 * ARCH.2E.2D — Consolidação Canônica de Start a New Week e Histórico Semanal
 *
 * Bateria de testes cobrindo os 11 cenários obrigatórios:
 * 1. Preservação do histórico da semana anterior (sem inventar conclusões, sem sobrescrever históricos anteriores, sem perder dados com seções vazias).
 * 2. Avanço correto do weeklyCycle (ignorando weeklyCycle enviado pelo cliente como autoridade).
 * 3. Idempotência de chamadas repetidas (mesmo attemptId e chamadas concorrentes).
 * 4. Recuperação após falha intermediária (cycleTransition pending_preparation recuperado via retry, cycle-status e student-routines sem duplo avanço).
 * 5. Preservação integral de Homework anterior (users/{uid}/homework/week-{prev}).
 * 6. Reset correto dos checks e rotinas da nova semana (users/{uid}/weeklyChecks/week-{next} e routines/{day}).
 * 7. Isolamento estrito entre alunos.
 * 8. Segurança 401/403 e rejeição de UIDs sintéticos (usr-*, st-*, tutor-*) + proteção de RBAC.
 * 9. Recuperação após reinicialização simulada (wipe/envenenamento de inMemoryDb e ausência de app_state).
 * 10. Ausência de duplicação de vídeos e Spotify, limpeza de teacherSpotify/teacherVideos antigos e preservação de watchedVideos/listenedTracks.
 * 11. Preservação das regressões ARCH.2E.2A/2B/2C e roteamento frontend (StartNewWeekHandler.ts e useStudentHistory.ts).
 */

process.env.NODE_ENV = 'test';
process.env.FIREBASE_PROJECT_ID = 'itissimple-security-staging';
process.env.FIREBASE_DATABASE_ID = '(default)';

import fs from 'fs';
import path from 'path';
import { setFirebaseAdminAuthForTesting } from '../src/serverFirebaseAdmin';
import { setFirebaseAdminFirestoreForTesting } from '../src/serverFirestore';
import { executeStartNewWeek } from '../src/utils/StartNewWeekHandler';
import {
  fetchWeeklyHistory,
  fetchAllWeeklyHistories,
  fetchAccumulatedConsumedIds,
  recordConsumedVideo,
  recordConsumedTrack,
  recordWeeklyVocabulary,
} from '../src/hooks/useStudentHistory';

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
  console.log(" IT'S SIMPLE — ARCH.2E.2D: START A NEW WEEK E HISTÓRICO SEMANAL CANÔNICO");
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

    const STUDENT_A_UID = 'StuA_NewWeekUid1234567890';
    const STUDENT_A_EMAIL = 'student.a.arch2e2d@gmail.com';
    const STUDENT_B_UID = 'StuB_NewWeekUid1234567890';
    const STUDENT_B_EMAIL = 'student.b.arch2e2d@gmail.com';
    const TEACHER_LINKED_UID = 'TchL_NewWeekUid1234567890';
    const TEACHER_LINKED_EMAIL = 'teacher.linked.arch2e2d@gmail.com';
    const TEACHER_UNLINKED_UID = 'TchU_NewWeekUid1234567890';
    const TEACHER_UNLINKED_EMAIL = 'teacher.unlinked.arch2e2d@gmail.com';
    const ADMIN_UID = 'Adm_NewWeekUid12345678901';
    const ADMIN_EMAIL = 'admin.arch2e2d@gmail.com';

    const tokensDb = new Map<string, any>();
    tokensDb.set('tok_student_a', { uid: STUDENT_A_UID, email: STUDENT_A_EMAIL, email_verified: true, role: 'student' });
    tokensDb.set('tok_student_b', { uid: STUDENT_B_UID, email: STUDENT_B_EMAIL, email_verified: true, role: 'student' });
    tokensDb.set('tok_teacher_linked', { uid: TEACHER_LINKED_UID, email: TEACHER_LINKED_EMAIL, email_verified: true, role: 'student' });
    tokensDb.set('tok_teacher_unlinked', { uid: TEACHER_UNLINKED_UID, email: TEACHER_UNLINKED_EMAIL, email_verified: true });
    tokensDb.set('tok_admin', { uid: ADMIN_UID, email: ADMIN_EMAIL, email_verified: true, role: 'admin', admin: true });

    setFirebaseAdminAuthForTesting({
      verifyIdToken: async (token: string) => {
        const decoded = tokensDb.get(token);
        if (!decoded) throw new Error('Invalid or expired Firebase ID token');
        return decoded;
      },
    } as any);

    // Seed Student A in Cycle 1 with Monday completed, Tuesday NOT completed (must not invent completion!),
    // Spotify track on Monday completed, Homework in week-1, weeklyChecks in week-1, and student_assignments
    await mockDb.collection('users').doc(STUDENT_A_UID).set({
      id: STUDENT_A_UID,
      uid: STUDENT_A_UID,
      email: STUDENT_A_EMAIL,
      name: 'Student Alpha Week',
      role: 'student',
      level: 'intermediate',
      englishLevel: 'intermediate',
      weeklyCycle: 1,
      weeklyNativeLessonsTarget: 1,
      weeklyStudyDaysTarget: 5,
      weeklyStudyDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
      routineVideoTime: '08:30',
      assignedNativeFriendUID: TEACHER_LINKED_UID,
      teacherUid: TEACHER_LINKED_UID,
      teacherEmail: TEACHER_LINKED_EMAIL,
      watchedVideosHistory: [{ videoId: 'vidPrev0001', videoTitle: 'Previous Watched', watchedAt: '2026-10-01T10:00:00Z' }],
      listenedTracksHistory: [{ trackId: 'trkPrev0001', id: 'trkPrev0001', title: 'Previous Track', artist: 'Artist Prev' }],
      studentJournal: [
        { id: 'vidMonWeek1', type: 'video', dayOfWeek: 'monday', week: 1, title: 'Monday Cycle 1 Video', date: '2026-10-12' },
        { id: 'trkMonWeek1', type: 'audio', dayOfWeek: 'monday', week: 1, title: 'Monday Track', artist: 'Artist A', date: '2026-10-12' },
      ],
    });

    await mockDb.collection('users').doc(STUDENT_A_UID).collection('routines').doc('monday').set({
      dayOfWeek: 'monday',
      weeklyCycle: 1,
      videoId: 'vidMonWeek1',
      title: 'Monday Cycle 1 Video',
      videoTitle: 'Monday Cycle 1 Video',
      playlistId: 'pl_travel',
      playlistTitle: 'Travel English',
      completedToday: true,
      completedVideoToday: true,
      completedAudioToday: true,
      learnedWords: ['itinerary', 'boarding'],
      teacherSpotify: {
        id: 'trkMonWeek1',
        trackId: 'trkMonWeek1',
        url: 'https://open.spotify.com/track/trkMonWeek1',
        title: 'Monday Track',
        artistOrHost: 'Artist A',
      },
      teacherFeedback: { comment: 'Great pronunciation!' },
    });

    // Tuesday has a selected video that was NOT watched/completed — closing must NOT invent completion!
    await mockDb.collection('users').doc(STUDENT_A_UID).collection('routines').doc('tuesday').set({
      dayOfWeek: 'tuesday',
      weeklyCycle: 1,
      videoId: 'vidTueUnwatched',
      title: 'Tuesday Unwatched Video',
      videoTitle: 'Tuesday Unwatched Video',
      playlistId: 'pl_tech',
      playlistTitle: 'Tech Talk',
      completedToday: false,
      completedVideoToday: false,
      completedAudioToday: false,
      learnedWords: [],
      teacherSpotify: {
        id: 'trkTueUnlistened',
        trackId: 'trkTueUnlistened',
        url: 'https://open.spotify.com/track/trkTueUnlistened',
        title: 'Tuesday Unlistened Track',
        artistOrHost: 'Artist B',
      },
    });

    await mockDb.collection('users').doc(STUDENT_A_UID).collection('weeklyChecks').doc('week-1').set({
      id: 'week-1',
      weekId: 'week-1',
      weeklyCycle: 1,
      studentUid: STUDENT_A_UID,
      checks: {
        video_day_monday: true,
        audio_day_monday: true,
      },
    });

    await mockDb.collection('users').doc(STUDENT_A_UID).collection('homework').doc('week-1').set({
      id: 'week-1',
      weekId: 'week-1',
      weeklyCycle: 1,
      studentUid: STUDENT_A_UID,
      isCompleted: true,
      score: 95,
      totalWordsCollected: 2,
      vocabularyList: [{ word: 'itinerary' }, { word: 'boarding' }],
      completedPartsByDay: { monday: true, tuesday: true },
      studentAnswers: { matching: { m1: 'itinerary' }, fillInBlanks: { f1: 'boarding' } },
      submittedAt: '2026-10-16T18:00:00Z',
    });

    await mockDb.collection('student_assignments').doc(STUDENT_A_UID).set({
      uid: STUDENT_A_UID,
      email: STUDENT_A_EMAIL,
      weeklyCycle: 1,
      videoAssignments: [{ day: 'monday', videoId: 'vidMonWeek1', weeklyCycle: 1 }],
      spotifyAssignments: [{ day: 'monday', trackId: 'trkMonWeek1', weeklyCycle: 1 }],
      watchedVideos: ['vidPrev0001', 'vidMonWeek1'],
      listenedTracks: ['trkPrev0001', 'trkMonWeek1'],
      spotifyCycles: { 'cycle-1': ['trkMonWeek1'] },
    });

    // Seed Student B (completely isolated)
    await mockDb.collection('users').doc(STUDENT_B_UID).set({
      id: STUDENT_B_UID,
      uid: STUDENT_B_UID,
      email: STUDENT_B_EMAIL,
      name: 'Student Beta Week',
      role: 'student',
      level: 'beginner',
      weeklyCycle: 1,
      assignedNativeFriendUID: TEACHER_UNLINKED_UID,
    });
    await mockDb.collection('users').doc(STUDENT_B_UID).collection('weeklyChecks').doc('week-1').set({
      id: 'week-1',
      weekId: 'week-1',
      weeklyCycle: 1,
      studentUid: STUDENT_B_UID,
      checks: { video_day_monday: true },
    });

    // Seed Tutors
    await mockDb.collection('users').doc(TEACHER_LINKED_UID).set({
      id: TEACHER_LINKED_UID,
      uid: TEACHER_LINKED_UID,
      email: TEACHER_LINKED_EMAIL,
      role: 'teacher',
      isTeacher: true,
      isApproved: true,
      approvalStatus: 'approved',
    });
    await mockDb.collection('tutors').doc('tutor-linked-2d').set({
      id: 'tutor-linked-2d',
      authUid: TEACHER_LINKED_UID,
      uid: TEACHER_LINKED_UID,
      email: TEACHER_LINKED_EMAIL,
      isApproved: true,
      approvalStatus: 'approved',
    });
    await mockDb.collection('tutors').doc('tutor-unlinked-2d').set({
      id: 'tutor-unlinked-2d',
      authUid: TEACHER_UNLINKED_UID,
      uid: TEACHER_UNLINKED_UID,
      email: TEACHER_UNLINKED_EMAIL,
      isApproved: true,
      approvalStatus: 'approved',
    });

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

    // =========================================================================
    // CENÁRIO 8 (Pré-checagem de Segurança): 401/403, RBAC e UIDs sintéticos
    // =========================================================================
    console.log('--- Cenário 8: Segurança 401/403, RBAC e Rejeição de UIDs Sintéticos ---');
    const noTokenStart = await simulateRequest('POST', '/api/student-routines/start-new-week', {}, { expectedCycle: 1 });
    assert(noTokenStart.status === 401, 'POST start-new-week sem token retorna 401');

    const badTokenStart = await simulateRequest(
      'POST',
      '/api/student-routines/start-new-week',
      { Authorization: 'Bearer invalid_tok' },
      { expectedCycle: 1 }
    );
    assert(badTokenStart.status === 401, 'POST start-new-week com token inválido retorna 401');

    const noTokenStatus = await simulateRequest('GET', `/api/student-routines/cycle-status?studentUid=${STUDENT_A_UID}`);
    assert(noTokenStatus.status === 401, 'GET cycle-status sem token retorna 401');

    const crossStudentStart = await simulateRequest(
      'POST',
      '/api/student-routines/start-new-week',
      { Authorization: 'Bearer tok_student_b' },
      { studentUid: STUDENT_A_UID, expectedCycle: 1 }
    );
    assert(crossStudentStart.status === 403, 'Aluno B não pode avançar ciclo do Aluno A (403)');

    const teacherStart = await simulateRequest(
      'POST',
      '/api/student-routines/start-new-week',
      { Authorization: 'Bearer tok_teacher_linked' },
      { studentUid: STUDENT_A_UID, expectedCycle: 1 }
    );
    assert(teacherStart.status === 403, 'Professor não pode avançar ciclo do aluno (403)');

    const unlinkedTeacherHistory = await simulateRequest(
      'GET',
      `/api/student-history?studentUid=${STUDENT_A_UID}&weekId=week-1`,
      { Authorization: 'Bearer tok_teacher_unlinked' }
    );
    assert(unlinkedTeacherHistory.status === 403, 'Professor não vinculado é bloqueado ao ler histórico (403)');

    const linkedTeacherHistory = await simulateRequest(
      'GET',
      `/api/student-history?studentUid=${STUDENT_A_UID}&includeAll=true`,
      { Authorization: 'Bearer tok_teacher_linked' }
    );
    assert(linkedTeacherHistory.status === 200, 'Professor aprovado vinculado pode ler histórico do aluno (200)');

    const syntheticStart = await simulateRequest(
      'POST',
      '/api/student-routines/start-new-week',
      { Authorization: 'Bearer tok_admin' },
      { studentUid: 'usr-synthetic-123', expectedCycle: 1 }
    );
    assert(syntheticStart.status === 422, 'UID sintético usr-* é rejeitado com 422 mesmo para Admin');

    const syntheticStStatus = await simulateRequest(
      'GET',
      '/api/student-routines/cycle-status?studentUid=st-synthetic-99',
      { Authorization: 'Bearer tok_admin' }
    );
    assert(syntheticStStatus.status === 422, 'UID sintético st-* é rejeitado em cycle-status com 422');

    // =========================================================================
    // CENÁRIOS 1, 2, 5, 6, 10: Encerramento, Avanço de Ciclo, Preservação HW, Reset Checks, Sem Duplicação
    // =========================================================================
    console.log('\n--- Cenários 1, 2, 5, 6, 10: Start New Week Canônico (Semana 1 -> 2) ---');
    const attempt1 = 'att_2d_cycle1_to_2';
    // Poison client weeklyCycle = 99 to verify server ignores it as authority
    const start1Res = await simulateRequest(
      'POST',
      '/api/student-routines/start-new-week',
      { Authorization: 'Bearer tok_student_a' },
      {
        studentUid: STUDENT_A_UID,
        expectedCycle: 1,
        weeklyCycle: 99,
        attemptId: attempt1,
        weeklyStudyDaysTarget: 4,
        weeklyStudyDays: ['monday', 'tuesday', 'thursday', 'friday'],
      }
    );

    assert(start1Res.status === 200 && start1Res.body.success === true, 'Start New Week retorna 200 com success: true');
    assert(start1Res.body.weeklyCycle === 2, `weeklyCycle avançou estritamente de 1 para 2 ignorando 99 do cliente (got ${start1Res.body.weeklyCycle})`);
    assert(
      Array.isArray(start1Res.body.spotifyAssignments) && start1Res.body.spotifyAssignments.length === 0 &&
      Array.isArray(start1Res.body.videoAssignments) && start1Res.body.videoAssignments.length === 0,
      'Não redistribui nem duplica automaticamente vídeos ou áudios Spotify no avanço'
    );

    // Check Cenário 1: users/{uid}/weeklyHistory/week-1 preserved accurately without inventing completions
    const hist1Snap = await mockDb.collection('users').doc(STUDENT_A_UID).collection('weeklyHistory').doc('week-1').get();
    const hist1 = hist1Snap.data();
    assert(Boolean(hist1 && hist1.closedAt), 'Histórico week-1 encerrado com closedAt antes de avançar ciclo');
    assert(
      Array.isArray(hist1?.consumedVideoIds) &&
      hist1.consumedVideoIds.some((v: any) => v.videoId === 'vidMonWeek1') &&
      !hist1.consumedVideoIds.some((v: any) => v.videoId === 'vidTueUnwatched'),
      'Histórico week-1 registra vídeo concluído (vidMonWeek1) e NÃO inventa conclusão para vídeo não assistido (vidTueUnwatched)'
    );
    assert(
      Array.isArray(hist1?.consumedTrackIds) &&
      hist1.consumedTrackIds.some((t: any) => t.trackId === 'trkMonWeek1') &&
      !hist1.consumedTrackIds.some((t: any) => t.trackId === 'trkTueUnlistened'),
      'Histórico week-1 registra áudio concluído (trkMonWeek1) e NÃO inventa conclusão para áudio não ouvido'
    );
    assert(
      hist1?.activitiesSnapshot?.tuesday?.videoCompleted === false &&
      hist1?.activitiesSnapshot?.monday?.videoCompleted === true,
      'activitiesSnapshot preserva conclusão real de segunda e não marca terça como concluída'
    );
    assert(
      hist1?.weeklyChecks?.video_day_monday === true && hist1?.weeklyChecks?.audio_day_monday === true,
      'Histórico week-1 preserva checks da semana encerrada'
    );
    assert(
      Array.isArray(hist1?.weeklyVocabulary) && hist1.weeklyVocabulary.some((w: any) => w.word === 'itinerary'),
      'Histórico week-1 preserva vocabulário aprendido na rotina'
    );
    assert(
      hist1?.homeworkProgress?.hasHomework === true && hist1?.homeworkProgress?.score === 95,
      'Histórico week-1 registra resumo de progresso do Homework anterior'
    );

    // Check Cenário 5: Homework anterior intacto
    const hw1Snap = await mockDb.collection('users').doc(STUDENT_A_UID).collection('homework').doc('week-1').get();
    const hw1 = hw1Snap.data();
    assert(
      Boolean(hw1 && hw1.isCompleted === true && hw1.score === 95 && hw1.studentAnswers?.matching?.m1 === 'itinerary'),
      'Homework de week-1 permanece 100% intacto após iniciar Semana 2'
    );

    // Check Cenário 6: Reset de checks da nova semana e rotinas limpas
    const checks2Snap = await mockDb.collection('users').doc(STUDENT_A_UID).collection('weeklyChecks').doc('week-2').get();
    const checks1Snap = await mockDb.collection('users').doc(STUDENT_A_UID).collection('weeklyChecks').doc('week-1').get();
    assert(
      checks2Snap.exists && Object.keys(checks2Snap.data()?.checks || {}).length === 0,
      'users/{uid}/weeklyChecks/week-2 inicializado vazio ({}) para a nova semana'
    );
    assert(
      checks1Snap.data()?.checks?.video_day_monday === true,
      'users/{uid}/weeklyChecks/week-1 da semana anterior permanece preservado'
    );

    const mon2Snap = await mockDb.collection('users').doc(STUDENT_A_UID).collection('routines').doc('monday').get();
    const mon2 = mon2Snap.data();
    assert(
      mon2?.weeklyCycle === 2 &&
      mon2?.videoId === '' &&
      mon2?.teacherSpotify === null &&
      Array.isArray(mon2?.teacherVideos) && mon2.teacherVideos.length === 0 &&
      mon2?.teacherFeedback === null &&
      mon2?.completedToday === false &&
      Array.isArray(mon2?.learnedWords) && mon2.learnedWords.length === 0,
      'Rotina monday da nova semana limpa videoId, teacherSpotify, teacherVideos, teacherFeedback, learnedWords e flags de conclusão'
    );

    // Check student_assignments/{uid} cleared old assignments while preserving history
    const assignAfter = (await mockDb.collection('student_assignments').doc(STUDENT_A_UID).get()).data();
    assert(
      assignAfter?.weeklyCycle === 2 &&
      Array.isArray(assignAfter?.videoAssignments) && assignAfter.videoAssignments.length === 0 &&
      Array.isArray(assignAfter?.spotifyAssignments) && assignAfter.spotifyAssignments.length === 0 &&
      assignAfter?.watchedVideos?.includes('vidPrev0001') &&
      assignAfter?.watchedVideos?.includes('vidMonWeek1') &&
      assignAfter?.listenedTracks?.includes('trkPrev0001') &&
      assignAfter?.listenedTracks?.includes('trkMonWeek1'),
      'student_assignments/{uid} limpa atribuições antigas e preserva watchedVideos/listenedTracks sem duplicar'
    );

    // =========================================================================
    // CENÁRIO 3: Idempotência de chamadas repetidas e concorrentes
    // =========================================================================
    console.log('\n--- Cenário 3: Idempotência de Chamadas Repetidas e Concorrentes ---');
    const replayRes = await simulateRequest(
      'POST',
      '/api/student-routines/start-new-week',
      { Authorization: 'Bearer tok_student_a' },
      { studentUid: STUDENT_A_UID, expectedCycle: 1, attemptId: attempt1 }
    );
    assert(
      replayRes.status === 200 && replayRes.body.weeklyCycle === 2,
      'Chamada repetida com mesmo attemptId retorna 200 e mantém weeklyCycle === 2'
    );

    const userAfterReplay = (await mockDb.collection('users').doc(STUDENT_A_UID).get()).data();
    assert(userAfterReplay?.weeklyCycle === 2, 'Ciclo no Firestore permanece estritamente em 2 após replay');

    // Concurrent calls for Cycle 2 -> 3 with different attemptIds
    const [conc1, conc2] = await Promise.all([
      simulateRequest(
        'POST',
        '/api/student/reset-week',
        { Authorization: 'Bearer tok_student_a' },
        { studentUid: STUDENT_A_UID, expectedCycle: 2, attemptId: 'att_conc_1' }
      ),
      simulateRequest(
        'POST',
        '/api/student-routines/start-new-week',
        { Authorization: 'Bearer tok_student_a' },
        { studentUid: STUDENT_A_UID, expectedCycle: 2, attemptId: 'att_conc_2' }
      ),
    ]);
    const okConc = [conc1, conc2].filter((r) => r.status === 200);
    const conflictConc = [conc1, conc2].filter((r) => r.status === 409);
    assert(
      okConc.length === 1 && conflictConc.length === 1 && okConc[0].body.weeklyCycle === 3,
      `Chamadas concorrentes (incluindo /api/student/reset-week): 1 vence (200, ciclo 3) e 1 recebe 409 (got ${conc1.status}/${conc2.status})`
    );

    // Ensure week-1 closed history was NOT overwritten when advancing 2 -> 3, and empty week-2 didn't crash
    const hist1AfterCycle3 = (await mockDb.collection('users').doc(STUDENT_A_UID).collection('weeklyHistory').doc('week-1').get()).data();
    const hist2AfterCycle3 = (await mockDb.collection('users').doc(STUDENT_A_UID).collection('weeklyHistory').doc('week-2').get()).data();
    assert(
      hist1AfterCycle3?.closedForAttemptId === attempt1 &&
      hist1AfterCycle3?.consumedVideoIds?.some((v: any) => v.videoId === 'vidMonWeek1'),
      'Histórico anterior week-1 não foi sobrescrito ao encerrar semana 2 -> 3'
    );
    assert(
      Boolean(hist2AfterCycle3?.closedAt) && Array.isArray(hist2AfterCycle3?.consumedVideoIds) && hist2AfterCycle3.consumedVideoIds.length === 0,
      'Semana 2 vazia encerra cleanly sem erro e sem inventar atividades concluídas'
    );

    // =========================================================================
    // CENÁRIO 4: Recuperação após falha intermediária
    // =========================================================================
    console.log('\n--- Cenário 4: Recuperação Após Falha Intermediária ---');
    // Simulate failure during prepareNewWeeklyCycleServer (e.g. writing weeklyChecks/week-4 fails)
    mockDb.failWriteMatcher = (docPath) => docPath.includes('weeklyChecks/week-4');
    const partialAttemptId = 'att_partial_fail_3_to_4';
    const partialFailRes = await simulateRequest(
      'POST',
      '/api/student-routines/start-new-week',
      { Authorization: 'Bearer tok_student_a' },
      { studentUid: STUDENT_A_UID, expectedCycle: 3, attemptId: partialAttemptId }
    );
    mockDb.failWriteMatcher = null;

    assert(
      partialFailRes.status === 500 && partialFailRes.body.success === false && partialFailRes.body.preparationPending === true,
      'Falha intermediária retorna erro real HTTP 500 com preparationPending: true (sem falso sucesso)'
    );

    const userMidFail = (await mockDb.collection('users').doc(STUDENT_A_UID).get()).data();
    assert(
      userMidFail?.weeklyCycle === 4 && userMidFail?.cycleTransition?.status === 'pending_preparation',
      'Transação avançou para 4 e registrou cycleTransition.status = pending_preparation'
    );

    // Now recover via GET /api/student-routines/cycle-status (simulating client timeout/retry inquiry)
    const recoveredStatusRes = await simulateRequest(
      'GET',
      `/api/student-routines/cycle-status?studentUid=${STUDENT_A_UID}&attemptId=${partialAttemptId}`,
      { Authorization: 'Bearer tok_student_a' }
    );
    assert(
      recoveredStatusRes.status === 200 &&
      recoveredStatusRes.body.currentCycle === 4 &&
      recoveredStatusRes.body.attemptConfirmed === true &&
      recoveredStatusRes.body.preparationPending === false,
      'GET cycle-status recupera preparação pendente sem avançar ciclo novamente (mantém ciclo 4)'
    );

    // Replay same attemptId on POST start-new-week — must stay at cycle 4
    const postRecoveryReplay = await simulateRequest(
      'POST',
      '/api/student-routines/start-new-week',
      { Authorization: 'Bearer tok_student_a' },
      { studentUid: STUDENT_A_UID, expectedCycle: 3, attemptId: partialAttemptId }
    );
    assert(
      postRecoveryReplay.status === 200 && postRecoveryReplay.body.weeklyCycle === 4,
      'Retry após recuperação com mesmo attemptId retorna ciclo 4 sem avançar para 5'
    );

    // =========================================================================
    // CENÁRIO 7: Isolamento estrito entre alunos
    // =========================================================================
    console.log('\n--- Cenário 7: Isolamento Estrito Entre Alunos ---');
    const studentBStatus = await simulateRequest(
      'GET',
      `/api/student-routines/cycle-status?studentUid=${STUDENT_B_UID}`,
      { Authorization: 'Bearer tok_student_b' }
    );
    const studentBChecks1 = (await mockDb.collection('users').doc(STUDENT_B_UID).collection('weeklyChecks').doc('week-1').get()).data();
    assert(
      studentBStatus.status === 200 &&
      studentBStatus.body.currentCycle === 1 &&
      studentBChecks1?.checks?.video_day_monday === true,
      'Aluno B permanece estritamente isolado no ciclo 1 com seus checks intactos'
    );

    // =========================================================================
    // CENÁRIO 9: Recuperação após reinicialização simulada (poison inMemoryDb + sem app_state)
    // =========================================================================
    console.log('\n--- Cenário 9: Recuperação Após Reinicialização Simulada ---');
    const memDb = readDb();
    if (!memDb.userProfiles) memDb.userProfiles = {};
    memDb.userProfiles[STUDENT_A_EMAIL] = { weeklyCycle: 99, email: STUDENT_A_EMAIL, uid: STUDENT_A_UID };
    (memDb as any).cycleAttempts = { [STUDENT_A_UID]: { attemptId: 'poisoned', result: { weeklyCycle: 99 } } };
    (memDb as any).studentWeeklyChecks = { [STUDENT_A_UID]: { video_day_sunday: true } };

    const afterRestartStatus = await simulateRequest(
      'GET',
      `/api/student-routines/cycle-status?studentUid=${STUDENT_A_UID}`,
      { Authorization: 'Bearer tok_student_a' }
    );
    const afterRestartHist = await simulateRequest(
      'GET',
      `/api/student-history?studentUid=${STUDENT_A_UID}&includeAll=true`,
      { Authorization: 'Bearer tok_student_a' }
    );
    assert(
      afterRestartStatus.status === 200 && afterRestartStatus.body.currentCycle === 4,
      `cycle-status lê estritamente do Firestore (ciclo 4) ignorando inMemoryDb envenenado (got ${afterRestartStatus.body.currentCycle})`
    );
    assert(
      afterRestartHist.status === 200 &&
      Array.isArray(afterRestartHist.body.allHistories) &&
      afterRestartHist.body.allHistories.some((h: any) => h.weekId === 'week-1'),
      'Históricos semanais permanecem íntegros via Firestore após wipe/poison de inMemoryDb'
    );

    const appStateWrites = mockDb.writeLog.filter((w) => w.path.startsWith('app_state/'));
    assert(appStateWrites.length === 0, `Nenhuma escrita em app_state/ foi executada (got ${appStateWrites.length})`);

    // =========================================================================
    // CENÁRIO 10 (cont.): Deduplicação em /api/student-history/record + Proteção STALE_CYCLE
    // =========================================================================
    console.log('\n--- Cenário 10 (cont.): Deduplicação de Vídeo/Spotify e Proteção de Histórico Fechado ---');
    await simulateRequest(
      'POST',
      '/api/student-history/record',
      { Authorization: 'Bearer tok_student_a' },
      {
        studentUid: STUDENT_A_UID,
        weekId: 'week-4',
        type: 'video',
        video: { videoId: 'vidCycle4_AAA', videoTitle: 'Cycle 4 Vid' },
      }
    );
    await simulateRequest(
      'POST',
      '/api/student-history/record',
      { Authorization: 'Bearer tok_student_a' },
      {
        studentUid: STUDENT_A_UID,
        weekId: 'week-4',
        type: 'video',
        video: { videoId: 'vidCycle4_AAA', videoTitle: 'Cycle 4 Vid' },
      }
    );
    await simulateRequest(
      'POST',
      '/api/student-history/record',
      { Authorization: 'Bearer tok_student_a' },
      {
        studentUid: STUDENT_A_UID,
        weekId: 'week-4',
        type: 'track',
        track: { id: 'trkCycle4_BBB', trackId: 'trkCycle4_BBB', title: 'Cycle 4 Track', artist: 'Artist 4' },
      }
    );
    await simulateRequest(
      'POST',
      '/api/student-history/record',
      { Authorization: 'Bearer tok_student_a' },
      {
        studentUid: STUDENT_A_UID,
        weekId: 'week-4',
        type: 'track',
        track: { id: 'trkCycle4_BBB', trackId: 'trkCycle4_BBB', title: 'Cycle 4 Track', artist: 'Artist 4' },
      }
    );
    const hist4Data = (await mockDb.collection('users').doc(STUDENT_A_UID).collection('weeklyHistory').doc('week-4').get()).data();
    assert(
      hist4Data?.consumedVideoIds?.filter((v: any) => v.videoId === 'vidCycle4_AAA').length === 1 &&
      hist4Data?.consumedTrackIds?.filter((t: any) => t.trackId === 'trkCycle4_BBB').length === 1,
      'Gravação repetida de vídeo e track no histórico não gera duplicação'
    );

    const staleHistoryWrite = await simulateRequest(
      'POST',
      '/api/student-history/record',
      { Authorization: 'Bearer tok_student_a' },
      {
        studentUid: STUDENT_A_UID,
        weekId: 'week-1',
        type: 'video',
        video: { videoId: 'vidHackOld', videoTitle: 'Overwrite Attempt' },
      }
    );
    assert(staleHistoryWrite.status === 409, 'Tentativa de sobrescrever histórico fechado de ciclo anterior retorna 409 STALE_CYCLE');

    // =========================================================================
    // CENÁRIO 11: Preservação ARCH.2E.2A/2B/2C e Roteamento Frontend (StartNewWeekHandler & useStudentHistory)
    // =========================================================================
    console.log('\n--- Cenário 11: Preservação ARCH.2E.2A/2B/2C e Roteamento Frontend ---');
    // Verify ARCH.2E.2A GET /api/student-routines still works cleanly on Cycle 4
    const routinesGet = await simulateRequest(
      'GET',
      `/api/student-routines?studentUid=${STUDENT_A_UID}`,
      { Authorization: 'Bearer tok_student_a' }
    );
    assert(
      routinesGet.status === 200 &&
      routinesGet.body?.monday?.[0]?.teacherVideos?.length === 0 &&
      !routinesGet.body?.monday?.[1]?.teacherSpotify,
      'GET /api/student-routines (ARCH.2E.2A) retorna rotina limpa para o ciclo 4 sem vídeos/áudios antigos'
    );

    // Verify ARCH.2E.2C GET /api/routines/weekly-checks returns empty checks for week-4 and preserved checks for week-1
    const checks4Get = await simulateRequest(
      'GET',
      `/api/routines/weekly-checks?studentUid=${STUDENT_A_UID}&weekId=week-4`,
      { Authorization: 'Bearer tok_student_a' }
    );
    const hw1Get = await simulateRequest(
      'GET',
      `/api/homework?studentUid=${STUDENT_A_UID}&weekId=week-1`,
      { Authorization: 'Bearer tok_student_a' }
    );
    assert(
      checks4Get.status === 200 && Object.keys(checks4Get.body.checks || {}).length === 0,
      'GET /api/routines/weekly-checks (ARCH.2E.2C) retorna checks vazios para week-4'
    );
    assert(
      hw1Get.status === 200 &&
      hw1Get.body?.score === 95 &&
      hw1Get.body?.studentAnswers?.matching?.m1 === 'itinerary',
      'GET /api/homework (ARCH.2E.2C) mantém Homework da week-1 acessível e íntegro'
    );

    // Verify StartNewWeekHandler.ts rejects synthetic UIDs without calling backend
    let calledOnSynthetic = false;
    globalThis.fetch = (async () => {
      calledOnSynthetic = true;
      return { ok: true, status: 200, json: async () => ({}) } as any;
    }) as any;
    const syntheticFrontendRes = await executeStartNewWeek({
      studentUid: 'usr-fake-frontend',
      studentEmail: 'fake@test.com',
      currentCycle: 1,
    });
    assert(
      syntheticFrontendRes?.success === false && calledOnSynthetic === false,
      'StartNewWeekHandler rejeita UID sintético no frontend sem chamar backend'
    );

    // Verify StartNewWeekHandler.ts & useStudentHistory.ts route through backend APIs (no Web SDK Firestore imports)
    const startHandlerSrc = fs.readFileSync(path.join(process.cwd(), 'src/utils/StartNewWeekHandler.ts'), 'utf8');
    const historyHookSrc = fs.readFileSync(path.join(process.cwd(), 'src/hooks/useStudentHistory.ts'), 'utf8');
    assert(
      !startHandlerSrc.includes('firebase/firestore') &&
      !historyHookSrc.includes('firebase/firestore') &&
      !historyHookSrc.includes('onSnapshot') &&
      !historyHookSrc.includes('getDb('),
      'StartNewWeekHandler.ts e useStudentHistory.ts não possuem chamadas diretas ao Firebase Web SDK Firestore'
    );

    // Verify useStudentHistory exported functions work via /api/student-history
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const urlStr = String(input);
      const method = (init?.method || 'GET').toUpperCase();
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      const r = await simulateRequest(method, urlStr, { Authorization: 'Bearer tok_student_a' }, body);
      return {
        ok: r.status >= 200 && r.status < 300,
        status: r.status,
        json: async () => r.body,
      } as any;
    }) as any;

    const fetchedH1 = await fetchWeeklyHistory(STUDENT_A_UID, 'week-1');
    const fetchedAll = await fetchAllWeeklyHistories(STUDENT_A_UID);
    const accIds = await fetchAccumulatedConsumedIds(STUDENT_A_UID);
    const recVidOk = await recordConsumedVideo(STUDENT_A_UID, 'week-4', { id: 'vidHook1', videoId: 'vidHook1', videoTitle: 'Hook Vid', title: 'Hook Vid', watchedAt: '2026-10-22T10:00:00.000Z' });
    const recTrkOk = await recordConsumedTrack(STUDENT_A_UID, 'week-4', { id: 'trkHook1', trackId: 'trkHook1', title: 'Hook Track', artist: 'Artist H', listenedAt: '2026-10-22T10:05:00.000Z' });
    const recVocOk = await recordWeeklyVocabulary(STUDENT_A_UID, 'week-4', [{ word: 'resilience', learnedAt: '2026-10-22' }]);

    assert(
      fetchedH1?.weekId === 'week-1' &&
      fetchedAll.length >= 2 &&
      accIds.videoIds.has('vidMonWeek1') &&
      accIds.trackIds.has('trkMonWeek1') &&
      recVidOk &&
      recTrkOk &&
      recVocOk,
      'Funções exportadas de useStudentHistory.ts operam integralmente via /api/student-history*'
    );
  } finally {
    globalThis.fetch = originalFetch;
    for (const h of trackedIntervals) originalClearInterval(h);
    for (const h of trackedTimeouts) originalClearTimeout(h);
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }

  console.log('\n================================================================================');
  console.log(` RESULTADO ARCH.2E.2D: ${passed} PASSARAM / ${failed} FALHARAM`);
  console.log('================================================================================');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests().catch((err) => {
  console.error('Erro fatal na execução dos testes ARCH.2E.2D:', err);
  process.exit(1);
});
