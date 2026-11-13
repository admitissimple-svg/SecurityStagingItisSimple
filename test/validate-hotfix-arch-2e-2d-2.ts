/**
 * HOTFIX ARCH.2E.2D.2 — Proteção contra avanço duplo e perda de dados na recuperação semanal
 *
 * Bateria direcionada cobrindo os 12 cenários obrigatórios:
 * 1. Wrapper de flags não avança ciclo.
 * 2. Ausência/invalidade de attemptId retorna 400 sem gravar no Firestore.
 * 3. Ausência/invalidade de expectedCycle retorna 400 sem gravar no Firestore.
 * 4. Duas requisições concorrentes de instâncias diferentes não produzem avanço duplo.
 * 5. Replay do mesmo attemptId retorna o resultado original (mesmo com expectedCycle que ficou antigo pelo próprio avanço).
 * 6. Falha após preparação parcial pode ser recuperada retomando do passo pendente.
 * 7. Recuperação repetida não apaga checks já válidos.
 * 8. Recuperação repetida não apaga vídeos, áudios ou palavras válidas do novo ciclo.
 * 9. POST e GET de recuperação simultâneos não executam resets conflitantes.
 * 10. Recuperação atrasada (fencing / ciclo antigo) não sobrescreve dados de uma preparação mais recente ou do novo ciclo.
 * 11. Histórico anterior permanece intacto (weeklyHistory, homework, weeklyChecks, watchedVideos, listenedTracks, studentJournal).
 * 12. Segurança 401/403/409/422 preservada.
 */

process.env.NODE_ENV = 'test';
process.env.FIREBASE_PROJECT_ID = 'itissimple-security-staging';
process.env.FIREBASE_DATABASE_ID = '(default)';

import fs from 'fs';
import path from 'path';
import { setFirebaseAdminAuthForTesting } from '../src/serverFirebaseAdmin';
import {
  setFirebaseAdminFirestoreForTesting,
  advanceWeeklyCycleTransactionServer,
  prepareNewWeeklyCycleServer,
  closeWeeklyHistorySnapshotServer,
  saveWeeklyHistoryServer,
  saveStudentRoutineDayFieldsServer,
  saveCanonicalWeeklyChecksServer,
} from '../src/serverFirestore';
import { resetRepeatFlagsInFirestore, resetDailyRoutinesForNewWeekInFirestore } from '../src/hooks/useRoutine';
import { executeStartNewWeek } from '../src/utils/StartNewWeekHandler';

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

class MockConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MockConflictError';
  }
}

class MockDocRef {
  public id: string;
  public path: string;
  constructor(private col: MockCollection, id: string) {
    this.id = id;
    this.path = `${col.collectionPath}/${id}`;
  }

  getVersion(): number {
    return this.col.versions.get(this.id) || 0;
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
    await this.col.db.beforeWrite(this.path, data);
    this.setSync(data, options);
    return { writeTime: new Date() };
  }

  setSync(data: any, options?: { merge?: boolean }) {
    this.col.db.recordWrite(this.path, data);
    const existing = this.col.docs.get(this.id) || {};
    const merged = options?.merge ? deepMergeObjects(existing, data) : deepClone(data);
    this.col.docs.set(this.id, merged);
    this.col.versions.set(this.id, this.getVersion() + 1);
  }

  async update(data: any) {
    await this.col.db.beforeWrite(this.path, data);
    this.updateSync(data);
    return { writeTime: new Date() };
  }

  updateSync(data: any) {
    this.col.db.recordWrite(this.path, data);
    const existing = this.col.docs.get(this.id);
    if (!existing) throw new Error(`NOT_FOUND: ${this.path}`);
    this.col.docs.set(this.id, deepMergeObjects(existing, data));
    this.col.versions.set(this.id, this.getVersion() + 1);
  }

  async delete() {
    await this.col.db.beforeWrite(this.path, { __deleted: true });
    this.deleteSync();
    return { writeTime: new Date() };
  }

  deleteSync() {
    this.col.db.recordWrite(this.path, { __deleted: true });
    this.col.docs.delete(this.id);
    this.col.versions.set(this.id, this.getVersion() + 1);
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
  public versions: Map<string, number> = new Map();
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

/**
 * Isolated Mock Firestore supporting optimistic concurrency versions + retries
 * as well as async write hooks to deterministically test fencing and cross-instance contention.
 */
class MockFirestoreDb {
  private collections: Map<string, MockCollection> = new Map();
  public failWriteMatcher: ((path: string) => boolean) | null = null;
  public beforeWriteHook: ((path: string, data: any) => Promise<void>) | null = null;
  public suspendWriteLog = false;
  public writeLog: Array<{ path: string; keys: string[]; data?: any }> = [];

  collection(name: string): MockCollection {
    if (!this.collections.has(name)) {
      this.collections.set(name, new MockCollection(name, this));
    }
    return this.collections.get(name)!;
  }

  async beforeWrite(path: string, data: any) {
    if (this.beforeWriteHook) {
      await this.beforeWriteHook(path, data);
    }
  }

  recordWrite(path: string, data: any) {
    if (this.failWriteMatcher && this.failWriteMatcher(path)) {
      throw new Error(`Simulated Firestore write failure on ${path}`);
    }
    if (!this.suspendWriteLog) {
      this.writeLog.push({
        path,
        keys: data && typeof data === 'object' ? Object.keys(data) : [],
        data: deepClone(data),
      });
    }
  }

  async runTransaction<T>(fn: (tx: any) => Promise<T>): Promise<T> {
    const maxAttempts = 5;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const readVersions = new Map<string, { ref: MockDocRef; version: number }>();
      const ops: Array<{ ref: MockDocRef; runSync: () => void }> = [];
      const tx = {
        get: async (target: MockDocRef) => {
          readVersions.set(target.path, { ref: target, version: target.getVersion() });
          return target.get();
        },
        set: (ref: MockDocRef, data: any, options?: { merge?: boolean }) => {
          ops.push({ ref, runSync: () => ref.setSync(data, options) });
        },
        update: (ref: MockDocRef, data: any) => {
          ops.push({ ref, runSync: () => ref.updateSync(data) });
        },
        delete: (ref: MockDocRef) => {
          ops.push({ ref, runSync: () => ref.deleteSync() });
        },
      };

      const res = await fn(tx);

      // Run async hook before optimistic commit check so we can simulate slow workers losing lease/fencing
      if (this.beforeWriteHook && ops.length > 0) {
        await this.beforeWriteHook(ops[0].ref.path, { __txAttempt: attempt, __ops: ops.length });
      }

      // Check optimistic concurrency across all read docs and apply synchronously (atomic commit section)
      let conflicted = false;
      for (const { ref, version } of readVersions.values()) {
        if (ref.getVersion() !== version) {
          conflicted = true;
          break;
        }
      }
      if (conflicted) {
        if (attempt === maxAttempts) {
          throw new MockConflictError('ABORTED: Firestore optimistic concurrency conflict after max retries.');
        }
        await new Promise((r) => setTimeout(r, 2 * attempt));
        continue;
      }

      for (const op of ops) {
        op.runSync();
      }
      return res;
    }
    throw new Error('Unreachable');
  }
}

async function runTests() {
  console.log('================================================================================');
  console.log(" IT'S SIMPLE — HOTFIX ARCH.2E.2D.2: VALIDAÇÃO DE CONCORRÊNCIA E RECUPERAÇÃO");
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

  try {
    const STUDENT_UID = 'authUidStudent2d2Main001';
    const STUDENT_EMAIL = 'student2d2@test.com';
    const OTHER_STUDENT_UID = 'authUidStudent2d2Other02';
    const OTHER_STUDENT_EMAIL = 'other2d2@test.com';
    const TEACHER_LINKED_UID = 'authUidTeacher2d2Linked01';
    const TEACHER_LINKED_EMAIL = 'teacherlinked2d2@test.com';
    const TEACHER_UNLINKED_UID = 'authUidTeacher2d2Unlink02';
    const TEACHER_UNLINKED_EMAIL = 'teacherunlinked2d2@test.com';
    const ADMIN_UID = 'authUidAdmin2d2Tester0001';
    const ADMIN_EMAIL = 'admin2d2@test.com';

    const mockDb = new MockFirestoreDb();
    mockDb.suspendWriteLog = true;

    await mockDb.collection('users').doc(STUDENT_UID).set({
      uid: STUDENT_UID,
      email: STUDENT_EMAIL,
      role: 'student',
      englishLevel: 'intermediate',
      weeklyCycle: 1,
      weeklyStudyDaysTarget: 5,
      weeklyStudyDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
      assignedNativeFriendUID: TEACHER_LINKED_UID,
      watchedVideosHistory: [{ videoId: 'vidPrevWeek0', videoTitle: 'Intro Vid', watchedAt: '2026-10-01T10:00:00.000Z' }],
      listenedTracksHistory: [{ trackId: 'trkPrevWeek0', id: 'trkPrevWeek0', title: 'Intro Audio', artist: 'Host 0', listenedAt: '2026-10-01T10:00:00.000Z' }],
      studentJournal: [
        {
          id: 'vidMonWeek1',
          type: 'video',
          title: 'Monday Real Video',
          url: 'https://www.youtube.com/watch?v=vidMonWeek1',
          week: 1,
          dayOfWeek: 'monday',
          timestamp: Date.parse('2026-10-10T10:00:00.000Z'),
        },
        {
          id: 'trkMonWeek1',
          type: 'audio',
          title: 'Monday Real Audio',
          artist: 'Host M',
          url: 'https://open.spotify.com/track/trkMonWeek1',
          week: 1,
          dayOfWeek: 'monday',
          timestamp: Date.parse('2026-10-10T11:00:00.000Z'),
        },
      ],
    });

    await mockDb.collection('users').doc(STUDENT_UID).collection('routines').doc('monday').set({
      dayOfWeek: 'monday',
      weeklyCycle: 1,
      videoId: 'vidMonWeek1',
      videoTitle: 'Monday Real Video',
      title: 'Monday Real Video',
      url: 'https://www.youtube.com/watch?v=vidMonWeek1',
      completedToday: true,
      completedVideoToday: true,
      completedAudioToday: true,
      learnedWords: ['itinerary', 'resilience'],
      teacherSpotify: {
        id: 'trkMonWeek1',
        trackId: 'trkMonWeek1',
        url: 'https://open.spotify.com/track/trkMonWeek1',
        title: 'Monday Real Audio',
        artistOrHost: 'Host M',
        type: 'music',
      },
      updatedAt: '2026-10-10T11:30:00.000Z',
    });

    await mockDb.collection('users').doc(STUDENT_UID).collection('weeklyChecks').doc('week-1').set({
      id: 'week-1',
      weekId: 'week-1',
      weeklyCycle: 1,
      checks: { video_day_monday: true, audio_day_monday: true },
      studentUid: STUDENT_UID,
    });

    await mockDb.collection('users').doc(STUDENT_UID).collection('homework').doc('week-1').set({
      id: 'week-1',
      weekId: 'week-1',
      weeklyCycle: 1,
      isCompleted: true,
      score: 98,
      studentAnswers: { matching: { m1: 'itinerary' } },
    });

    await mockDb.collection('student_assignments').doc(STUDENT_UID).set({
      uid: STUDENT_UID,
      email: STUDENT_EMAIL,
      level: 'intermediate',
      weeklyCycle: 1,
      videoAssignments: [{ day: 'monday', videoId: 'vidMonWeek1', weeklyCycle: 1 }],
      spotifyAssignments: [{ day: 'monday', trackId: 'trkMonWeek1', weeklyCycle: 1 }],
      watchedVideos: ['vidPrevWeek0'],
      listenedTracks: ['trkPrevWeek0'],
    });

    await mockDb.collection('users').doc(OTHER_STUDENT_UID).set({
      uid: OTHER_STUDENT_UID,
      email: OTHER_STUDENT_EMAIL,
      role: 'student',
      weeklyCycle: 1,
    });

    await mockDb.collection('users').doc(TEACHER_LINKED_UID).set({
      uid: TEACHER_LINKED_UID,
      email: TEACHER_LINKED_EMAIL,
      role: 'teacher',
      nativeFriendStatus: 'approved',
      isApprovedNativeFriend: true,
      assignedStudents: [STUDENT_UID],
    });

    await mockDb.collection('users').doc(TEACHER_UNLINKED_UID).set({
      uid: TEACHER_UNLINKED_UID,
      email: TEACHER_UNLINKED_EMAIL,
      role: 'teacher',
      nativeFriendStatus: 'approved',
      isApprovedNativeFriend: true,
      assignedStudents: [OTHER_STUDENT_UID],
    });

    await mockDb.collection('users').doc(ADMIN_UID).set({
      uid: ADMIN_UID,
      email: ADMIN_EMAIL,
      role: 'admin',
    });

    mockDb.suspendWriteLog = false;

    setFirebaseAdminFirestoreForTesting(mockDb as any);
    setFirebaseAdminAuthForTesting({
      verifyIdToken: async (token: string) => {
        if (token === 'tok_student') return { uid: STUDENT_UID, email: STUDENT_EMAIL, role: 'student' } as any;
        if (token === 'tok_other') return { uid: OTHER_STUDENT_UID, email: OTHER_STUDENT_EMAIL, role: 'student' } as any;
        if (token === 'tok_teacher_linked') return { uid: TEACHER_LINKED_UID, email: TEACHER_LINKED_EMAIL, role: 'teacher' } as any;
        if (token === 'tok_teacher_unlinked') return { uid: TEACHER_UNLINKED_UID, email: TEACHER_UNLINKED_EMAIL, role: 'teacher' } as any;
        if (token === 'tok_admin') return { uid: ADMIN_UID, email: ADMIN_EMAIL, role: 'admin' } as any;
        throw new Error('Invalid token');
      },
    } as any);

    const { app } = await import('../serverApp');

    function simulateRequest(
      method: string,
      url: string,
      headers: Record<string, string> = {},
      body?: any
    ): Promise<{ status: number; body: any }> {
      return new Promise((resolve) => {
        const lowerHeaders: Record<string, string> = {};
        for (const [k, v] of Object.entries(headers)) {
          lowerHeaders[k.toLowerCase()] = v;
        }
        const [pathname, search = ''] = url.split('?');
        const query: Record<string, string> = {};
        if (search) {
          const sp = new URLSearchParams(search);
          sp.forEach((val, key) => {
            query[key] = val;
          });
        }
        const req: any = {
          method: method.toUpperCase(),
          url,
          originalUrl: url,
          path: pathname,
          headers: lowerHeaders,
          query,
          body: body !== undefined ? deepClone(body) : {},
          header(name: string) {
            return lowerHeaders[name.toLowerCase()];
          },
        };
        const res: any = {
          statusCode: 200,
          _headers: {} as Record<string, string>,
          setHeader(k: string, v: string) {
            this._headers[k.toLowerCase()] = v;
          },
          status(code: number) {
            this.statusCode = code;
            return this;
          },
          json(payload: any) {
            resolve({ status: this.statusCode, body: deepClone(payload) });
            return this;
          },
          send(payload: any) {
            resolve({ status: this.statusCode, body: payload });
            return this;
          },
          end(payload?: any) {
            resolve({ status: this.statusCode, body: payload });
            return this;
          },
        };
        app(req, res, (err: any) => {
          if (err) resolve({ status: 500, body: { error: err.message } });
          else resolve({ status: 404, body: { error: 'Route not found' } });
        });
      });
    }

    // =========================================================================
    // TESTE 1: Wrapper de flags não avança ciclo
    // =========================================================================
    console.log('--- Teste 1: Wrappers legados de flags não avançam weeklyCycle nem chamam start-new-week ---');
    let fetchCallsDuringLegacyWrapper = 0;
    globalThis.fetch = (async () => {
      fetchCallsDuringLegacyWrapper++;
      return { ok: true, status: 200, json: async () => ({}) } as any;
    }) as any;

    const rFlagsOk = await resetRepeatFlagsInFirestore(STUDENT_UID, ['monday', 'tuesday']);
    const rDailyOk = await resetDailyRoutinesForNewWeekInFirestore(STUDENT_UID, ['monday', 'tuesday']);
    const userAfterLegacyWrappers = (await mockDb.collection('users').doc(STUDENT_UID).get()).data();

    const useRoutineSrc = fs.readFileSync(path.join(process.cwd(), 'src/hooks/useRoutine.ts'), 'utf8');
    const routineGuideSrc = fs.readFileSync(path.join(process.cwd(), 'src/components/StudentRoutineGuideSection.tsx'), 'utf8');
    assert(
      rFlagsOk === false &&
      rDailyOk === false &&
      fetchCallsDuringLegacyWrapper === 0 &&
      userAfterLegacyWrappers?.weeklyCycle === 1,
      'Wrappers legados retornam false, não disparam fetch para start-new-week e não avançam weeklyCycle'
    );
    assert(
      !useRoutineSrc.includes("fetch('/api/student-routines/start-new-week'") &&
      !routineGuideSrc.includes('resetRepeatFlags') &&
      !routineGuideSrc.includes('resetRoutinesForNewWeek'),
      'useRoutine.ts não redireciona wrappers para start-new-week e StudentRoutineGuideSection não referencia wrappers obsoletos'
    );

    // =========================================================================
    // TESTE 2: Ausência ou invalidade de attemptId retorna 400 sem gravar no Firestore
    // =========================================================================
    console.log('\n--- Teste 2: Ausência/invalidade de attemptId retorna 400 sem gravação ---');
    const writesBeforeTest2 = mockDb.writeLog.length;
    const missingAttStart = await simulateRequest(
      'POST',
      '/api/student-routines/start-new-week',
      { Authorization: 'Bearer tok_student' },
      { studentUid: STUDENT_UID, expectedCycle: 1 }
    );
    const blankAttReset = await simulateRequest(
      'POST',
      '/api/student/reset-week',
      { Authorization: 'Bearer tok_student' },
      { studentUid: STUDENT_UID, expectedCycle: 1, attemptId: '   ' }
    );
    const nonStrAttStart = await simulateRequest(
      'POST',
      '/api/student-routines/start-new-week',
      { Authorization: 'Bearer tok_student' },
      { studentUid: STUDENT_UID, expectedCycle: 1, attemptId: 12345 }
    );
    assert(
      missingAttStart.status === 400 &&
      blankAttReset.status === 400 &&
      nonStrAttStart.status === 400 &&
      mockDb.writeLog.length === writesBeforeTest2 &&
      (await mockDb.collection('users').doc(STUDENT_UID).get()).data()?.weeklyCycle === 1,
      'Ausência/invalidade de attemptId retorna HTTP 400 em ambas as rotas e realiza zero gravações'
    );

    // =========================================================================
    // TESTE 3: Ausência ou invalidade de expectedCycle retorna 400 sem gravar no Firestore
    // =========================================================================
    console.log('\n--- Teste 3: Ausência/invalidade de expectedCycle retorna 400 sem gravação ---');
    const writesBeforeTest3 = mockDb.writeLog.length;
    const missingExpStart = await simulateRequest(
      'POST',
      '/api/student-routines/start-new-week',
      { Authorization: 'Bearer tok_student' },
      { studentUid: STUDENT_UID, attemptId: 'att_no_exp_1' }
    );
    const zeroExpReset = await simulateRequest(
      'POST',
      '/api/student/reset-week',
      { Authorization: 'Bearer tok_student' },
      { studentUid: STUDENT_UID, expectedCycle: 0, attemptId: 'att_zero_exp' }
    );
    const floatExpStart = await simulateRequest(
      'POST',
      '/api/student-routines/start-new-week',
      { Authorization: 'Bearer tok_student' },
      { studentUid: STUDENT_UID, expectedCycle: 1.5, attemptId: 'att_float_exp' }
    );
    const strWeekExpStart = await simulateRequest(
      'POST',
      '/api/student/reset-week',
      { Authorization: 'Bearer tok_student' },
      { studentUid: STUDENT_UID, expectedCycle: 'week-1', attemptId: 'att_strweek_exp' }
    );
    assert(
      missingExpStart.status === 400 &&
      zeroExpReset.status === 400 &&
      floatExpStart.status === 400 &&
      strWeekExpStart.status === 400 &&
      mockDb.writeLog.length === writesBeforeTest3 &&
      (await mockDb.collection('users').doc(STUDENT_UID).get()).data()?.weeklyCycle === 1,
      'Ausência/invalidade de expectedCycle (missing, 0, 1.5, week-1) retorna HTTP 400 sem gravações'
    );

    // =========================================================================
    // TESTE 4: Duas requisições concorrentes de instâncias diferentes não produzem avanço duplo
    // =========================================================================
    console.log('\n--- Teste 4: Concorrência entre instâncias diferentes sem avanço duplo ---');
    // Close week-1 first and race two cross-instance transactions directly (bypassing inProcessCycleLocks)
    const close1 = await closeWeeklyHistorySnapshotServer({
      uid: STUDENT_UID,
      closingCycle: 1,
      attemptId: 'att_cross_inst_a',
      studentEmail: STUDENT_EMAIL,
    });
    assert(close1.ok === true, 'Fechamento de snapshot week-1 bem-sucedido antes da corrida entre instâncias');

    const [instATx, instBTx] = await Promise.all([
      advanceWeeklyCycleTransactionServer(STUDENT_UID, 1, 'att_cross_inst_a', 2),
      advanceWeeklyCycleTransactionServer(STUDENT_UID, 1, 'att_cross_inst_b', 2),
    ]);
    const txWinners = [instATx, instBTx].filter((r) => r.success && !r.conflict);
    const txConflicts = [instATx, instBTx].filter((r) => r.conflict && r.statusCode === 409);
    const userAfterTxRace = (await mockDb.collection('users').doc(STUDENT_UID).get()).data();
    assert(
      txWinners.length === 1 &&
      txConflicts.length === 1 &&
      userAfterTxRace?.weeklyCycle === 2,
      `Corrida direta entre instâncias no Firestore: 1 vence (ciclo ${userAfterTxRace?.weeklyCycle}), 1 recebe conflito 409`
    );

    // Finish preparation of winning attempt
    const winnerAttemptId = txWinners[0].cycleTransition?.attemptId || 'att_cross_inst_a';
    const prepWin = await prepareNewWeeklyCycleServer({
      uid: STUDENT_UID,
      studentEmail: STUDENT_EMAIL,
      targetCycle: 2,
      previousCycle: 1,
      attemptId: winnerAttemptId,
    });
    assert(prepWin.ok === true && prepWin.result?.weeklyCycle === 2, 'Preparação da instância vencedora conclui no ciclo 2');

    // Also test concurrent HTTP route race for Cycle 2 -> 3
    const [httpRace1, httpRace2] = await Promise.all([
      simulateRequest(
        'POST',
        '/api/student-routines/start-new-week',
        { Authorization: 'Bearer tok_student' },
        { studentUid: STUDENT_UID, expectedCycle: 2, attemptId: 'att_http_race_1' }
      ),
      simulateRequest(
        'POST',
        '/api/student/reset-week',
        { Authorization: 'Bearer tok_student' },
        { studentUid: STUDENT_UID, expectedCycle: 2, attemptId: 'att_http_race_2' }
      ),
    ]);
    const httpOk = [httpRace1, httpRace2].filter((r) => r.status === 200);
    const httpConflict = [httpRace1, httpRace2].filter((r) => r.status === 409);
    assert(
      httpOk.length === 1 &&
      httpConflict.length === 1 &&
      (await mockDb.collection('users').doc(STUDENT_UID).get()).data()?.weeklyCycle === 3,
      `Corrida HTTP concorrente entre rotas: 1 retorna 200 (ciclo 3) e 1 retorna 409`
    );

    // =========================================================================
    // TESTE 5: Replay do mesmo attemptId retorna resultado original (mesmo com expectedCycle antigo)
    // =========================================================================
    console.log('\n--- Teste 5: Replay idempotente do mesmo attemptId retorna resultado original ---');
    const wonAttempt2to3 = httpOk[0].body.attemptId;
    const replaySameAttempt = await simulateRequest(
      'POST',
      '/api/student-routines/start-new-week',
      { Authorization: 'Bearer tok_student' },
      { studentUid: STUDENT_UID, expectedCycle: 2, attemptId: wonAttempt2to3 }
    );
    const replayResetWeekSameAttempt = await simulateRequest(
      'POST',
      '/api/student/reset-week',
      { Authorization: 'Bearer tok_student' },
      { studentUid: STUDENT_UID, expectedCycle: 2, attemptId: wonAttempt2to3 }
    );
    const mismatchCycleForUsedAttempt = await simulateRequest(
      'POST',
      '/api/student-routines/start-new-week',
      { Authorization: 'Bearer tok_student' },
      { studentUid: STUDENT_UID, expectedCycle: 3, attemptId: wonAttempt2to3 }
    );
    assert(
      replaySameAttempt.status === 200 &&
      replaySameAttempt.body.weeklyCycle === 3 &&
      replayResetWeekSameAttempt.status === 200 &&
      replayResetWeekSameAttempt.body.weeklyCycle === 3 &&
      mismatchCycleForUsedAttempt.status === 409 &&
      (await mockDb.collection('users').doc(STUDENT_UID).get()).data()?.weeklyCycle === 3,
      'Replay com mesmo attemptId e expectedCycle original (2) retorna 200 ciclo 3; reuso em expectedCycle 3 retorna 409'
    );

    // =========================================================================
    // TESTE 6: Falha após preparação parcial pode ser recuperada retomando do passo pendente
    // =========================================================================
    console.log('\n--- Teste 6: Recuperação de falha parcial sem repetir etapas concluídas ---');
    const partialAttempt = 'att_partial_step_3_to_4';
    // Fail mid-7-days on thursday
    mockDb.failWriteMatcher = (p) => p.endsWith('/routines/thursday');
    const failMidDays = await simulateRequest(
      'POST',
      '/api/student-routines/start-new-week',
      { Authorization: 'Bearer tok_student' },
      { studentUid: STUDENT_UID, expectedCycle: 3, attemptId: partialAttempt }
    );
    mockDb.failWriteMatcher = null;

    const uMidDays = (await mockDb.collection('users').doc(STUDENT_UID).get()).data();
    assert(
      failMidDays.status === 500 &&
      failMidDays.body.success === false &&
      failMidDays.body.preparationPending === true &&
      uMidDays?.weeklyCycle === 4 &&
      uMidDays?.cycleTransition?.status === 'pending_preparation' &&
      uMidDays?.cycleTransition?.steps?.routinesReset === false &&
      Array.isArray(uMidDays?.cycleTransition?.steps?.routinesResetDays) &&
      uMidDays.cycleTransition.steps.routinesResetDays.includes('monday') &&
      uMidDays.cycleTransition.steps.routinesResetDays.includes('wednesday') &&
      !uMidDays.cycleTransition.steps.routinesResetDays.includes('thursday'),
      'Falha em routines/thursday preserva progresso parcial (mon..wed) e mantém status pending_preparation com erro 500'
    );

    // Count how many writes touch monday during recovery (must be 0 since monday already finished!)
    const writesStartResume = mockDb.writeLog.length;
    mockDb.failWriteMatcher = (p) => p.includes('weeklyChecks/week-4');
    const failChecks = await simulateRequest(
      'POST',
      '/api/student-routines/start-new-week',
      { Authorization: 'Bearer tok_student' },
      { studentUid: STUDENT_UID, expectedCycle: 3, attemptId: partialAttempt }
    );
    mockDb.failWriteMatcher = null;

    const monRewrittenDuringResume = mockDb.writeLog
      .slice(writesStartResume)
      .some((w) => w.path.endsWith('/routines/monday'));
    const uAfterChecksFail = (await mockDb.collection('users').doc(STUDENT_UID).get()).data();
    assert(
      failChecks.status === 500 &&
      failChecks.body.preparationPending === true &&
      !monRewrittenDuringResume &&
      uAfterChecksFail?.cycleTransition?.steps?.routinesReset === true &&
      uAfterChecksFail?.cycleTransition?.steps?.weeklyChecksInitialized === false &&
      uAfterChecksFail?.cycleTransition?.status === 'pending_preparation',
      'Retomada completa apenas thursday..sunday sem reescrever monday e falha em weeklyChecks mantendo pending_preparation'
    );

    // =========================================================================
    // TESTE 7 e 8: Recuperação repetida não apaga checks, vídeos, áudios ou palavras válidas do targetCycle
    // =========================================================================
    console.log('\n--- Testes 7 e 8: Recuperação repetida preserva checks, vídeos, Spotify e palavras válidas de Cycle 4 ---');
    // Simulate normal Cycle 4 progress written AFTER partial failure, BEFORE recovery completes
    await saveCanonicalWeeklyChecksServer({
      studentUid: STUDENT_UID,
      studentEmail: STUDENT_EMAIL,
      canonicalWeekId: 'week-4',
      cycle: 4,
      checks: { video_day_monday: true, audio_day_monday: true },
    });
    await saveStudentRoutineDayFieldsServer(
      STUDENT_UID,
      'monday',
      {
        videoId: 'vidCycle4Real',
        videoTitle: 'Cycle 4 Real Video',
        title: 'Cycle 4 Real Video',
        url: 'https://www.youtube.com/watch?v=vidCycle4Real',
        teacherSpotify: {
          id: 'trkCycle4Real',
          trackId: 'trkCycle4Real',
          url: 'https://open.spotify.com/track/trkCycle4Real',
          title: 'Cycle 4 Real Audio',
          artistOrHost: 'Real Host',
          type: 'music',
        },
        learnedWords: ['ephemeral', 'ubiquitous'],
        completedToday: true,
        completedVideoToday: true,
      },
      4
    );
    await mockDb.collection('student_assignments').doc(STUDENT_UID).set(
      {
        videoAssignments: [
          { day: 'monday', videoId: 'vidCycle4Real', weeklyCycle: 4 },
          { day: 'tuesday', videoId: 'vidStaleCycle3', weeklyCycle: 3 },
        ],
        spotifyAssignments: [
          { day: 'monday', trackId: 'trkCycle4Real', weeklyCycle: 4 },
          { day: 'tuesday', trackId: 'trkStaleCycle3', weeklyCycle: 3 },
        ],
      },
      { merge: true }
    );

    // Trigger recovery via cycle-status
    const recoverCycle4 = await simulateRequest(
      'GET',
      `/api/student-routines/cycle-status?studentUid=${STUDENT_UID}&attemptId=${partialAttempt}`,
      { Authorization: 'Bearer tok_student' }
    );
    // Repeat recovery call via cycle-status AND POST replay
    const repeatRecoveryStatus = await simulateRequest(
      'GET',
      `/api/student-routines/cycle-status?studentUid=${STUDENT_UID}&attemptId=${partialAttempt}`,
      { Authorization: 'Bearer tok_student' }
    );
    const repeatRecoveryPost = await simulateRequest(
      'POST',
      '/api/student-routines/start-new-week',
      { Authorization: 'Bearer tok_student' },
      { studentUid: STUDENT_UID, expectedCycle: 3, attemptId: partialAttempt }
    );

    const checks4After = (await mockDb.collection('users').doc(STUDENT_UID).collection('weeklyChecks').doc('week-4').get()).data();
    const mon4After = (await mockDb.collection('users').doc(STUDENT_UID).collection('routines').doc('monday').get()).data();
    const assign4After = (await mockDb.collection('student_assignments').doc(STUDENT_UID).get()).data();
    const user4After = (await mockDb.collection('users').doc(STUDENT_UID).get()).data();

    assert(
      recoverCycle4.status === 200 &&
      recoverCycle4.body.preparationPending === false &&
      recoverCycle4.body.attemptConfirmed === true &&
      repeatRecoveryStatus.body.currentCycle === 4 &&
      repeatRecoveryPost.status === 200 &&
      repeatRecoveryPost.body.weeklyCycle === 4 &&
      user4After?.cycleTransition?.status === 'completed',
      'Recuperação conclui status=completed no ciclo 4 e chamadas repetidas permanecem idempotentes'
    );
    assert(
      checks4After?.checks?.video_day_monday === true && checks4After?.checks?.audio_day_monday === true,
      'Teste 7: Recuperação repetida NÃO apaga checks já válidos de week-4'
    );
    assert(
      mon4After?.videoId === 'vidCycle4Real' &&
      mon4After?.teacherSpotify?.trackId === 'trkCycle4Real' &&
      Array.isArray(mon4After?.learnedWords) &&
      mon4After.learnedWords.includes('ephemeral') &&
      mon4After?.completedToday === true &&
      assign4After?.videoAssignments?.length === 1 &&
      assign4After?.videoAssignments?.[0]?.videoId === 'vidCycle4Real' &&
      assign4After?.spotifyAssignments?.length === 1 &&
      assign4After?.spotifyAssignments?.[0]?.trackId === 'trkCycle4Real',
      'Teste 8: Recuperação repetida preserva vídeo, Spotify, palavras e assignments do Cycle 4 enquanto limpa apenas Ciclo 3 antigo'
    );

    // =========================================================================
    // TESTE 9: POST e GET de recuperação simultâneos não executam resets conflitantes
    // =========================================================================
    console.log('\n--- Teste 9: POST e GET de recuperação simultâneos não executam resets conflitantes ---');
    // Put Cycle 5 in pending_preparation (simulating crash right after cycle transaction 4 -> 5)
    const attCycle5 = 'att_concurrent_post_get_c5';
    await closeWeeklyHistorySnapshotServer({ uid: STUDENT_UID, closingCycle: 4, attemptId: attCycle5, studentEmail: STUDENT_EMAIL });
    const tx5 = await advanceWeeklyCycleTransactionServer(STUDENT_UID, 4, attCycle5, 5);
    assert(tx5.success && tx5.persistedCycle === 5, 'Transição transacional 4 -> 5 criada com status pending_preparation');

    let releasePausedPost!: () => void;
    let enteredPausedWrite!: () => void;
    const postWritePausedPromise = new Promise<void>((r) => {
      enteredPausedWrite = r;
    });
    let pauseTriggered = false;
    mockDb.beforeWriteHook = async (docPath) => {
      if (!pauseTriggered && docPath.endsWith('/routines/tuesday')) {
        pauseTriggered = true;
        enteredPausedWrite();
        await new Promise<void>((r) => {
          releasePausedPost = r;
        });
      }
    };

    const postRecoveryPromise = simulateRequest(
      'POST',
      '/api/student-routines/start-new-week',
      { Authorization: 'Bearer tok_student' },
      { studentUid: STUDENT_UID, expectedCycle: 4, attemptId: attCycle5 }
    );

    await postWritePausedPromise;
    const writesDuringGetOnlyStart = mockDb.writeLog.length;

    // While POST holds the Firestore lease and is paused mid-step, fire simultaneous GET cycle-status recovery
    const getWhilePostActive = await simulateRequest(
      'GET',
      `/api/student-routines/cycle-status?studentUid=${STUDENT_UID}&attemptId=${attCycle5}`,
      { Authorization: 'Bearer tok_student' }
    );
    const writesByConcurrentGet = mockDb.writeLog.slice(writesDuringGetOnlyStart);
    const getDidConflictingReset = writesByConcurrentGet.some(
      (w) => w.path.includes('/routines/') || w.path.includes('/weeklyChecks/') || w.path.includes('student_assignments/')
    );

    // Release POST so it finishes cleanly
    mockDb.beforeWriteHook = null;
    releasePausedPost();
    const postDone = await postRecoveryPromise;

    assert(
      getWhilePostActive.status === 200 &&
      getWhilePostActive.body.preparationPending === true &&
      getWhilePostActive.body.recoveryInProgress === true &&
      getWhilePostActive.body.attemptConfirmed === false &&
      !getDidConflictingReset &&
      postDone.status === 200 &&
      postDone.body.weeklyCycle === 5,
      'GET simultâneo respeita o lease ativo sem executar resets conflitantes e POST conclui ciclo 5'
    );

    // =========================================================================
    // TESTE 10: Recuperação atrasada não sobrescreve dados de preparação mais recente
    // =========================================================================
    console.log('\n--- Teste 10: Recuperação atrasada (fencing token perdido e ciclo antigo) é bloqueada ---');
    // Setup Cycle 5 -> 6 with pending_preparation
    const attCycle6 = 'att_fencing_c6';
    await closeWeeklyHistorySnapshotServer({ uid: STUDENT_UID, closingCycle: 5, attemptId: attCycle6, studentEmail: STUDENT_EMAIL });
    const tx6 = await advanceWeeklyCycleTransactionServer(STUDENT_UID, 5, attCycle6, 6);
    assert(tx6.success && tx6.persistedCycle === 6, 'Transição 5 -> 6 criada para teste de fencing');

    // Start Stale Worker A with short leaseTtlMs (25ms), pause before writing routines/tuesday
    let releaseStaleWorker!: () => void;
    let staleWorkerEnteredPause!: () => void;
    const staleEnteredPromise = new Promise<void>((r) => {
      staleWorkerEnteredPause = r;
    });
    let stalePauseArmed = true;
    mockDb.beforeWriteHook = async (docPath) => {
      if (stalePauseArmed && docPath.endsWith('/routines/tuesday')) {
        stalePauseArmed = false;
        staleWorkerEnteredPause();
        await new Promise<void>((r) => {
          releaseStaleWorker = r;
        });
      }
    };

    const staleWorkerPromise = prepareNewWeeklyCycleServer({
      uid: STUDENT_UID,
      studentEmail: STUDENT_EMAIL,
      targetCycle: 6,
      previousCycle: 5,
      attemptId: attCycle6,
      leaseTtlMs: 25,
    });

    await staleEnteredPromise;
    // Wait until Worker A's 25ms lease has definitely expired
    await new Promise((r) => setTimeout(r, 45));

    // Worker B takes over expired lease with higher fencingToken and completes Cycle 6 preparation
    mockDb.beforeWriteHook = null;
    const freshWorkerRes = await prepareNewWeeklyCycleServer({
      uid: STUDENT_UID,
      studentEmail: STUDENT_EMAIL,
      targetCycle: 6,
      previousCycle: 5,
      attemptId: attCycle6,
    });
    assert(freshWorkerRes.ok === true && freshWorkerRes.result?.weeklyCycle === 6, 'Worker B assume lease expirado e conclui ciclo 6');

    // Now normal Cycle 6 user operation saves data on tuesday
    await saveStudentRoutineDayFieldsServer(
      STUDENT_UID,
      'tuesday',
      { videoId: 'vidCycle6Fresh', learnedWords: ['serendipity'], completedToday: true },
      6
    );
    const writesBeforeStaleWakes = mockDb.writeLog.length;

    // Wake up Stale Worker A — its fencingToken MUST fail assertion and NOT overwrite Cycle 6 data!
    releaseStaleWorker();
    const staleWorkerRes = await staleWorkerPromise;
    const writesAfterStaleWakes = mockDb.writeLog.slice(writesBeforeStaleWakes);
    const tue6AfterStale = (await mockDb.collection('users').doc(STUDENT_UID).collection('routines').doc('tuesday').get()).data();

    // Also test stale recovery targeting an older cycle (targetCycle: 5 when persisted cycle is 6)
    const olderCycleRecovery = await prepareNewWeeklyCycleServer({
      uid: STUDENT_UID,
      studentEmail: STUDENT_EMAIL,
      targetCycle: 5,
      previousCycle: 4,
    });

    assert(
      staleWorkerRes.ok === false &&
      staleWorkerRes.statusCode === 409 &&
      writesAfterStaleWakes.length === 0 &&
      tue6AfterStale?.videoId === 'vidCycle6Fresh' &&
      tue6AfterStale?.learnedWords?.includes('serendipity') &&
      olderCycleRecovery.ok === false &&
      olderCycleRecovery.code === 'STALE_RECOVERY_CYCLE',
      'Worker atrasado perde fencing (zero gravações) e recuperação de ciclo anterior (5 vs 6) é bloqueada com 409 STALE_RECOVERY_CYCLE'
    );

    // =========================================================================
    // TESTE 11: Histórico anterior permanece intacto
    // =========================================================================
    console.log('\n--- Teste 11: Histórico semanal anterior e dados relacionados permanecem íntegros ---');
    const attemptReopen = await closeWeeklyHistorySnapshotServer({
      uid: STUDENT_UID,
      closingCycle: 1,
      attemptId: 'att_malicious_reopen',
      studentEmail: STUDENT_EMAIL,
    });
    const overwriteAttempt = await saveWeeklyHistoryServer(STUDENT_UID, 'week-1', {
      weeklyCycle: 1,
      consumedVideoIds: [{ id: 'vidHack', videoId: 'vidHack', title: 'Hacked' }],
    });
    const hist1Final = (await mockDb.collection('users').doc(STUDENT_UID).collection('weeklyHistory').doc('week-1').get()).data();
    const hw1Final = (await mockDb.collection('users').doc(STUDENT_UID).collection('homework').doc('week-1').get()).data();
    const checks1Final = (await mockDb.collection('users').doc(STUDENT_UID).collection('weeklyChecks').doc('week-1').get()).data();
    const userFinal = (await mockDb.collection('users').doc(STUDENT_UID).get()).data();

    assert(
      attemptReopen.alreadyClosed === true &&
      overwriteAttempt.ok === false &&
      overwriteAttempt.statusCode === 409 &&
      Boolean(hist1Final?.closedAt) &&
      hist1Final?.consumedVideoIds?.some((v: any) => v.videoId === 'vidMonWeek1') &&
      !hist1Final?.consumedVideoIds?.some((v: any) => v.videoId === 'vidHack') &&
      hw1Final?.score === 98 &&
      checks1Final?.checks?.video_day_monday === true &&
      userFinal?.watchedVideosHistory?.some((v: any) => v.videoId === 'vidPrevWeek0') &&
      userFinal?.listenedTracksHistory?.some((t: any) => t.trackId === 'trkPrevWeek0') &&
      Array.isArray(userFinal?.studentJournal) &&
      userFinal.studentJournal.length === 2,
      'Históricos week-1, homework, checks, vídeos/áudios consumidos e studentJournal permanecem 100% íntegros e bloqueados contra reabertura'
    );

    // =========================================================================
    // TESTE 12: Segurança 401/403/409/422 preservada
    // =========================================================================
    console.log('\n--- Teste 12: Segurança 401/403/409/422 preservada ---');
    const sec401 = await simulateRequest('POST', '/api/student-routines/start-new-week', {}, { expectedCycle: 6, attemptId: 'att_sec' });
    const secCross403 = await simulateRequest(
      'POST',
      '/api/student/reset-week',
      { Authorization: 'Bearer tok_other' },
      { studentUid: STUDENT_UID, expectedCycle: 6, attemptId: 'att_sec' }
    );
    const secTeacher403 = await simulateRequest(
      'POST',
      '/api/student-routines/start-new-week',
      { Authorization: 'Bearer tok_teacher_linked' },
      { studentUid: STUDENT_UID, expectedCycle: 6, attemptId: 'att_sec' }
    );
    const secUnlinked403 = await simulateRequest(
      'GET',
      `/api/student-routines/cycle-status?studentUid=${STUDENT_UID}`,
      { Authorization: 'Bearer tok_teacher_unlinked' }
    );
    const secSynthetic422 = await simulateRequest(
      'POST',
      '/api/student-routines/start-new-week',
      { Authorization: 'Bearer tok_admin' },
      { studentUid: 'usr-synthetic-999', expectedCycle: 6, attemptId: 'att_sec' }
    );
    const secConflict409 = await simulateRequest(
      'POST',
      '/api/student-routines/start-new-week',
      { Authorization: 'Bearer tok_student' },
      { studentUid: STUDENT_UID, expectedCycle: 1, attemptId: 'att_brand_new_conflict' }
    );

    assert(
      sec401.status === 401 &&
      secCross403.status === 403 &&
      secTeacher403.status === 403 &&
      secUnlinked403.status === 403 &&
      secSynthetic422.status === 422 &&
      secConflict409.status === 409,
      `Segurança preservada: 401(${sec401.status}), 403 cross(${secCross403.status}), 403 teacher(${secTeacher403.status}), 403 unlinked(${secUnlinked403.status}), 422(${secSynthetic422.status}), 409(${secConflict409.status})`
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
  console.log(` RESULTADO HOTFIX ARCH.2E.2D.2: ${passed} passou(aram), ${failed} falhou(aram).`);
  console.log('================================================================================');
  if (failed > 0) process.exit(1);
  process.exit(0);
}

runTests().catch((err) => {
  console.error('Fatal error in validate-hotfix-arch-2e-2d-2:', err);
  process.exit(1);
});
