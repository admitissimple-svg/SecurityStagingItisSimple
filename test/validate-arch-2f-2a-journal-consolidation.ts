/**
 * ARCH.2F.2A — Consolidação Canônica de Journal (Daily Journal & Activity Journal)
 *
 * Bateria de testes cobrindo:
 * 1. Segurança 401/403/422 em /api/student-journal/activity e /api/student-journal
 *    (sem token, token inválido, cross-student, UID sintético usr-*, conflito aninhado,
 *    professor não vinculado/pendente, professor vinculado lê 200 e escrita bloqueada 403, admin 200).
 * 2. Persistência canônica estrita em Firestore (default):
 *    - Activity Journal em users/{uid}/activity_journal/{entryId}
 *    - Daily Journal e lesson_review em users/{uid}/journal/{entryId}
 *    - Zero novos espelhos em app_state, RAM (studentActivityJournal/studentJournalMap/userProfiles)
 *      ou arrays na raiz users/{uid} (studentJournal / dailyJournalEntries).
 *    - Sobrevivência a wipe/envenenamento de RAM + preservação de frases e avaliações de IA.
 * 3. Idempotência e validação estrita de week (rejeita week malformada sem fallback para Semana 1).
 * 4. Remoção definitiva (DELETE por slot ou entryId, inclusive limpeza de legado pré-existente sem ressuscitar,
 *    e sem criar arrays vazios na raiz; erro real 500 em falha de escrita).
 * 5. Consulta entre aulas (getStudentActivitiesBetweenLessonsServer), S-Path e histórico semanal
 *    (fetchAccumulatedConsumedHistoryServer, closeWeeklyHistorySnapshotServer, fetchCanonicalRoutineContextServer).
 * 6. Auditoria estática do frontend (zero Web SDK em helpers de Journal, memorização uncheck -> DELETE,
 *    CustomEvents reativos e ausência de ressurreição em StudentWeeklyActivitySection/App.tsx).
 */

process.env.NODE_ENV = 'test';
process.env.FIREBASE_PROJECT_ID = 'itissimple-security-staging';
process.env.FIREBASE_DATABASE_ID = '(default)';

import fs from 'fs';
import path from 'path';
import { setFirebaseAdminAuthForTesting } from '../src/serverFirebaseAdmin';
import {
  setFirebaseAdminFirestoreForTesting,
  recordLessonReviewInStudentJournalServer,
  getStudentActivitiesBetweenLessonsServer,
  fetchAccumulatedConsumedHistoryServer,
  closeWeeklyHistorySnapshotServer,
  fetchCanonicalRoutineContextServer,
  fetchRoutineVideosFromFirestoreServer,
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

  orderBy(_field: string, _dir?: string): MockQuery {
    return this;
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

  orderBy(_field: string, _dir?: string): MockQuery {
    return new MockQuery(this, []);
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
  public writeLog: Array<{ path: string; keys: string[]; data: any }> = [];

  collection(name: string): MockCollection {
    if (!this.collections.has(name)) {
      this.collections.set(name, new MockCollection(name, this));
    }
    return this.collections.get(name)!;
  }

  recordWrite(pathStr: string, data: any) {
    if (this.failWriteMatcher && this.failWriteMatcher(pathStr)) {
      throw new Error(`Simulated Firestore write failure on ${pathStr}`);
    }
    if (!this.suspendWriteLog) {
      this.writeLog.push({
        path: pathStr,
        keys: data && typeof data === 'object' ? Object.keys(data) : [],
        data: deepClone(data),
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
  console.log(" IT'S SIMPLE — ARCH.2F.2A: CONSOLIDAÇÃO CANÔNICA DE JOURNAL");
  console.log('================================================================================\n');

  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
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

    const STUDENT_A_UID = 'StuA_JournalUid12345678901';
    const STUDENT_A_EMAIL = 'student.a.journal2f2a@gmail.com';
    const STUDENT_B_UID = 'StuB_JournalUid12345678901';
    const STUDENT_B_EMAIL = 'student.b.journal2f2a@gmail.com';
    const STUDENT_LEGACY_UID = 'StuL_JournalUid12345678901';
    const STUDENT_LEGACY_EMAIL = 'student.legacy.journal2f2a@gmail.com';
    const TEACHER_LINKED_UID = 'TchL_JournalUid12345678901';
    const TEACHER_LINKED_EMAIL = 'teacher.linked.journal2f2a@gmail.com';
    const TEACHER_UNLINKED_UID = 'TchU_JournalUid12345678901';
    const TEACHER_UNLINKED_EMAIL = 'teacher.unlinked.journal2f2a@gmail.com';
    const TEACHER_PENDING_UID = 'TchP_JournalUid12345678901';
    const TEACHER_PENDING_EMAIL = 'teacher.pending.journal2f2a@gmail.com';
    const ADMIN_UID = 'Adm_JournalUid123456789012';
    const ADMIN_EMAIL = 'admin.journal2f2a@gmail.com';

    const tokensDb = new Map<string, any>();
    tokensDb.set('tok_student_a', { uid: STUDENT_A_UID, email: STUDENT_A_EMAIL, email_verified: true, role: 'student' });
    tokensDb.set('tok_student_b', { uid: STUDENT_B_UID, email: STUDENT_B_EMAIL, email_verified: true, role: 'student' });
    tokensDb.set('tok_student_legacy', { uid: STUDENT_LEGACY_UID, email: STUDENT_LEGACY_EMAIL, email_verified: true, role: 'student' });
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
      name: 'Student Alpha Journal',
      role: 'student',
      level: 'beginner',
      englishLevel: 'beginner',
      weeklyCycle: 2,
      weeklyNativeLessonsTarget: 2,
      weeklyStudyDaysTarget: 5,
      weeklyStudyDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
      assignedNativeFriendUID: TEACHER_LINKED_UID,
      teacherUid: TEACHER_LINKED_UID,
      teacherEmail: TEACHER_LINKED_EMAIL,
    });

    await mockDb.collection('users').doc(STUDENT_B_UID).set({
      id: STUDENT_B_UID,
      uid: STUDENT_B_UID,
      email: STUDENT_B_EMAIL,
      name: 'Student Beta Journal',
      role: 'student',
      level: 'intermediate',
      weeklyCycle: 1,
      weeklyStudyDays: ['monday', 'wednesday', 'friday'],
    });

    await mockDb.collection('users').doc(STUDENT_LEGACY_UID).set({
      id: STUDENT_LEGACY_UID,
      uid: STUDENT_LEGACY_UID,
      email: STUDENT_LEGACY_EMAIL,
      name: 'Student Legacy Journal',
      role: 'student',
      weeklyCycle: 1,
      studentJournal: [
        {
          id: 'video_monday_1_legacy_vid_1',
          type: 'video',
          dayOfWeek: 'monday',
          week: 1,
          date: '2026-11-09',
          timestamp: Date.now() - 100000,
          title: 'Legacy Root Video',
          studentUid: STUDENT_LEGACY_UID,
        },
      ],
      dailyJournalEntries: [
        {
          id: 'daily_legacy_1',
          date: '2026-11-09',
          word: 'resilience',
          sentence: 'I build resilience every day.',
          correctedSentence: 'I build resilience every day.',
          feedback: 'Great sentence!',
          createdAt: '2026-11-09T10:00:00.000Z',
          studentUid: STUDENT_LEGACY_UID,
          studentEmail: STUDENT_LEGACY_EMAIL,
        },
      ],
    });

    await mockDb.collection('tutors').doc('tutor-linked-2f2a').set({
      id: 'tutor-linked-2f2a',
      authUid: TEACHER_LINKED_UID,
      uid: TEACHER_LINKED_UID,
      email: TEACHER_LINKED_EMAIL,
      name: 'Linked Approved Teacher',
      isApproved: true,
      approvalStatus: 'approved',
    });
    await mockDb.collection('users').doc(TEACHER_LINKED_UID).set({
      id: TEACHER_LINKED_UID,
      uid: TEACHER_LINKED_UID,
      email: TEACHER_LINKED_EMAIL,
      name: 'Linked Approved Teacher',
      role: 'teacher',
      isTeacher: true,
      isApproved: true,
      approvalStatus: 'approved',
    });

    await mockDb.collection('tutors').doc('tutor-unlinked-2f2a').set({
      id: 'tutor-unlinked-2f2a',
      authUid: TEACHER_UNLINKED_UID,
      uid: TEACHER_UNLINKED_UID,
      email: TEACHER_UNLINKED_EMAIL,
      name: 'Unlinked Teacher',
      role: 'teacher',
      isApproved: true,
      approvalStatus: 'approved',
    });

    await mockDb.collection('tutors').doc('tutor-pending-2f2a').set({
      id: 'tutor-pending-2f2a',
      authUid: TEACHER_PENDING_UID,
      uid: TEACHER_PENDING_UID,
      email: TEACHER_PENDING_EMAIL,
      name: 'Pending Teacher',
      role: 'teacher',
      isApproved: false,
      approvalStatus: 'pending',
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

    function wipeAndPoisonMemory() {
      const db = readDb();
      db.studentActivityJournal = {
        [STUDENT_A_UID]: [
          {
            id: 'POISONED_RAM_ACT',
            type: 'video',
            dayOfWeek: 'sunday',
            week: 99,
            title: 'POISONED_MEMORY',
            timestamp: Date.now() + 999999,
          },
        ],
      };
      db.studentJournalMap = {
        [STUDENT_A_UID]: [
          {
            id: 'POISONED_RAM_DAILY',
            word: 'poisoned',
            sentence: 'POISONED_DAILY',
            date: '2099-01-01',
          },
        ],
      };
      db.userProfiles = {
        [STUDENT_A_UID]: {
          uid: STUDENT_A_UID,
          email: STUDENT_A_EMAIL,
          studentJournal: [
            {
              id: 'POISONED_PROFILE_RAM',
              type: 'audio',
              dayOfWeek: 'sunday',
              week: 99,
              title: 'POISONED_PROFILE_RAM',
              timestamp: Date.now() + 999999,
            },
          ],
          watchedVideosHistory: ['POISONED_VIDEO_ID'],
          vocabulary: [{ word: 'poisoned_ram_word', dateAdded: new Date().toISOString() }],
        },
      };
    }

    // -------------------------------------------------------------------------
    // CENÁRIO 1: Segurança 401/403/422 e Isolamento RBAC
    // -------------------------------------------------------------------------
    console.log('--- Cenário 1: Segurança 401/403/422 e Isolamento RBAC ---');

    const unauthGetAct = await simulateRequest('GET', '/api/student-journal/activity');
    assert(unauthGetAct.status === 401, '1.1 GET /api/student-journal/activity sem token retorna 401', `status=${unauthGetAct.status}`);

    const unauthPostAct = await simulateRequest('POST', '/api/student-journal/activity', {}, { entry: { type: 'video' } });
    assert(unauthPostAct.status === 401, '1.2 POST /api/student-journal/activity sem token retorna 401', `status=${unauthPostAct.status}`);

    const unauthDelAct = await simulateRequest('DELETE', '/api/student-journal/activity', {}, { type: 'video', dayOfWeek: 'monday', week: 2 });
    assert(unauthDelAct.status === 401, '1.3 DELETE /api/student-journal/activity sem token retorna 401', `status=${unauthDelAct.status}`);

    const badTokenAct = await simulateRequest('GET', '/api/student-journal/activity', { authorization: 'Bearer bad_tok' });
    assert(badTokenAct.status === 401, '1.4 GET /api/student-journal/activity com token inválido retorna 401', `status=${badTokenAct.status}`);

    const unauthGetDaily = await simulateRequest('GET', '/api/student-journal');
    assert(unauthGetDaily.status === 401, '1.5 GET /api/student-journal sem token retorna 401', `status=${unauthGetDaily.status}`);

    const crossRead = await simulateRequest(
      'GET',
      `/api/student-journal/activity?studentUid=${encodeURIComponent(STUDENT_A_UID)}`,
      { authorization: 'Bearer tok_student_b' }
    );
    assert(crossRead.status === 403, '1.6 Aluno B tentando ler Activity Journal do Aluno A retorna 403', `status=${crossRead.status}`);

    const crossWrite = await simulateRequest(
      'POST',
      '/api/student-journal/activity',
      { authorization: 'Bearer tok_student_b' },
      {
        studentUid: STUDENT_A_UID,
        entry: { id: 'hack_1', type: 'video', dayOfWeek: 'monday', week: 2, date: '2026-11-10', timestamp: Date.now() },
      }
    );
    assert(crossWrite.status === 403, '1.7 Aluno B tentando gravar Activity Journal no Aluno A retorna 403', `status=${crossWrite.status}`);

    const nestedConflict = await simulateRequest(
      'POST',
      '/api/student-journal/activity',
      { authorization: 'Bearer tok_student_b' },
      {
        studentUid: STUDENT_B_UID,
        entry: { id: 'hack_2', type: 'video', dayOfWeek: 'monday', week: 1, studentUid: STUDENT_A_UID },
      }
    );
    assert(nestedConflict.status === 403, '1.8 Conflito aninhado entry.studentUid cruzado retorna 403', `status=${nestedConflict.status}`);

    const crossDelete = await simulateRequest(
      'DELETE',
      '/api/student-journal/activity',
      { authorization: 'Bearer tok_student_b' },
      { studentUid: STUDENT_A_UID, type: 'video', dayOfWeek: 'monday', week: 2 }
    );
    assert(crossDelete.status === 403, '1.9 Aluno B tentando excluir Activity Journal do Aluno A retorna 403', `status=${crossDelete.status}`);

    const syntheticRead = await simulateRequest(
      'GET',
      `/api/student-journal/activity?studentUid=${encodeURIComponent('usr-student-a-journal2f2a-gmail-com')}`,
      { authorization: 'Bearer tok_student_a' }
    );
    assert(syntheticRead.status === 403 || syntheticRead.status === 422, '1.10 UID sintético usr-* é rejeitado (403/422)', `status=${syntheticRead.status}`);

    const unlinkedTeacherGet = await simulateRequest(
      'GET',
      `/api/student-journal/activity?studentUid=${encodeURIComponent(STUDENT_A_UID)}`,
      { authorization: 'Bearer tok_teacher_unlinked' }
    );
    assert(unlinkedTeacherGet.status === 403, '1.11 Professor não vinculado tentando ler Activity Journal retorna 403', `status=${unlinkedTeacherGet.status}`);

    const pendingTeacherGet = await simulateRequest(
      'GET',
      `/api/student-journal/activity?studentUid=${encodeURIComponent(STUDENT_A_UID)}`,
      { authorization: 'Bearer tok_teacher_pending' }
    );
    assert(pendingTeacherGet.status === 403, '1.12 Professor pendente tentando ler Activity Journal retorna 403', `status=${pendingTeacherGet.status}`);

    const linkedTeacherWrite = await simulateRequest(
      'POST',
      '/api/student-journal/activity',
      { authorization: 'Bearer tok_teacher_linked_no_claim' },
      {
        studentUid: STUDENT_A_UID,
        entry: { id: 'tch_write_1', type: 'video', dayOfWeek: 'monday', week: 2 },
      }
    );
    assert(linkedTeacherWrite.status === 403, '1.13 Professor vinculado tentando gravar Activity Journal do aluno retorna 403', `status=${linkedTeacherWrite.status}`);

    const linkedTeacherDel = await simulateRequest(
      'DELETE',
      '/api/student-journal/activity',
      { authorization: 'Bearer tok_teacher_linked_no_claim' },
      { studentUid: STUDENT_A_UID, type: 'video', dayOfWeek: 'monday', week: 2 }
    );
    assert(linkedTeacherDel.status === 403, '1.14 Professor vinculado tentando excluir Activity Journal do aluno retorna 403', `status=${linkedTeacherDel.status}`);

    const linkedTeacherDailyWrite = await simulateRequest(
      'POST',
      '/api/student-journal',
      { authorization: 'Bearer tok_teacher_linked_no_claim' },
      {
        studentUid: STUDENT_A_UID,
        entry: { id: 'tch_daily_1', word: 'test', sentence: 'Teacher tried writing', date: '2026-11-10' },
      }
    );
    assert(linkedTeacherDailyWrite.status === 403, '1.15 Professor vinculado tentando gravar Daily Journal do aluno retorna 403', `status=${linkedTeacherDailyWrite.status}`);

    // -------------------------------------------------------------------------
    // CENÁRIO 2: Persistência Canônica + Zero Espelhos + Sobrevivência Pós-Wipe
    // -------------------------------------------------------------------------
    console.log('\n--- Cenário 2: Persistência Canônica e Ausência de Espelhos ---');
    mockDb.writeLog = [];

    const actTs1 = Date.now() - 2 * 60 * 60 * 1000;
    const postVideo = await simulateRequest(
      'POST',
      '/api/student-journal/activity',
      { authorization: 'Bearer tok_student_a' },
      {
        studentUid: STUDENT_A_UID,
        studentEmail: STUDENT_A_EMAIL,
        entry: {
          id: 'video_tuesday_2_vidYt99',
          type: 'video',
          date: '2026-11-10',
          dayOfWeek: 'tuesday',
          timestamp: actTs1,
          title: 'Daily Tech English',
          url: 'https://youtube.com/watch?v=vidYt99',
        },
      }
    );
    assert(postVideo.status === 200 && postVideo.body?.success === true, '2.1 POST /api/student-journal/activity grava vídeo com sucesso');
    assert(postVideo.body?.entry?.week === 2, '2.2 Week ausente resolve automaticamente do weeklyCycle (2) do aluno', `week=${postVideo.body?.entry?.week}`);

    const actDocSnap = await mockDb.collection('users').doc(STUDENT_A_UID).collection('activity_journal').doc('video_tuesday_2_vidYt99').get();
    assert(actDocSnap.exists && actDocSnap.data()?.title === 'Daily Tech English', '2.3 Documento gravado exclusivamente em users/{uid}/activity_journal/{entryId}');

    const dailySentenceRes = await simulateRequest(
      'POST',
      '/api/student-journal',
      { authorization: 'Bearer tok_student_a' },
      {
        studentUid: STUDENT_A_UID,
        studentEmail: STUDENT_A_EMAIL,
        entry: {
          id: 'sentence_2f2a_1',
          date: '2026-11-10',
          word: 'insight',
          sentence: 'Your feedback gave me a great insight.',
          correctedSentence: 'Your feedback gave me great insight.',
          feedback: 'Small article adjustment for natural flow.',
          hasErrors: true,
          evaluationResult: {
            hasAnyError: true,
            overallSummaryPt: 'Excelente construção com leve ajuste de artigo.',
            sentenceFeedback: { explanationEn: 'Use uncountable insight without "a".' },
          },
          createdAt: new Date(actTs1 + 30000).toISOString(),
        },
      }
    );
    assert(dailySentenceRes.status === 200 && dailySentenceRes.body?.success === true, '2.4 POST /api/student-journal salva frase com avaliação de IA');

    const dailyDocSnap = await mockDb.collection('users').doc(STUDENT_A_UID).collection('journal').doc('sentence_2f2a_1').get();
    assert(
      dailyDocSnap.exists &&
        dailyDocSnap.data()?.evaluationResult?.overallSummaryPt === 'Excelente construção com leve ajuste de artigo.',
      '2.5 Frase e avaliação de IA gravadas exclusivamente em users/{uid}/journal/{entryId}'
    );

    const reviewRes = await recordLessonReviewInStudentJournalServer({
      studentUid: STUDENT_A_UID,
      studentEmail: STUDENT_A_EMAIL,
      compositeCacheKey: 'sess_2f2a_1__hash1',
      transformation: {
        isAiGenerated: true,
        isProvisional: false,
        isFallback: false,
        sessionKey: 'sess_2f2a_1',
        lessonId: 'lesson_2f2a_1',
        topic: 'Business Meetings',
        teacherName: 'Linked Approved Teacher',
        sessionDate: '2026-11-10',
        generatedAt: '2026-11-10T15:00:00.000Z',
        vocabularyAndExpressions: [
          { term: 'agenda', partOfSpeech: 'noun' },
          { term: 'deadline', partOfSpeech: 'noun' },
        ],
        reviewSummary: {
          rememberThis: 'Great fluency during Q&A.',
          essentialCorrections: [{ original: 'I very like', corrected: 'I really like' }],
          keyRules: ['Use really instead of very with verbs.'],
          mustKnowVocabulary: ['agenda', 'deadline'],
        },
      },
    });
    assert(reviewRes.success === true, '2.6 recordLessonReviewInStudentJournalServer persiste lesson_review com sucesso');

    const expectedReviewDocId = `journal_lesson_sess_2f2a_1_${STUDENT_A_UID}`;
    const reviewDocSnap = await mockDb.collection('users').doc(STUDENT_A_UID).collection('journal').doc(expectedReviewDocId).get();
    assert(reviewDocSnap.exists && reviewDocSnap.data()?.entryType === 'lesson_review', '2.7 lesson_review salvo exclusivamente em users/{uid}/journal/{entryId}');

    const studentARootAfterWrites = (await mockDb.collection('users').doc(STUDENT_A_UID).get()).data();
    assert(
      studentARootAfterWrites?.studentJournal === undefined && studentARootAfterWrites?.dailyJournalEntries === undefined,
      '2.8 Zero espelhos em arrays na raiz users/{uid} (studentJournal e dailyJournalEntries ausentes)'
    );

    const forbiddenWrites = mockDb.writeLog.filter(
      (w) =>
        w.path.startsWith('app_state') ||
        (w.path === `users/${STUDENT_A_UID}` && (w.keys.includes('studentJournal') || w.keys.includes('dailyJournalEntries'))) ||
        w.path.includes('/studentJournal/')
    );
    assert(forbiddenWrites.length === 0, '2.9 Zero gravações em app_state, users/{uid}/studentJournal ou raiz users/{uid}', JSON.stringify(forbiddenWrites));

    // Simular reinício: envenenar RAM e verificar leitura canônica
    wipeAndPoisonMemory();

    const getActAfterWipe = await simulateRequest(
      'GET',
      `/api/student-journal/activity?studentUid=${encodeURIComponent(STUDENT_A_UID)}`,
      { authorization: 'Bearer tok_student_a' }
    );
    assert(
      getActAfterWipe.status === 200 &&
        Array.isArray(getActAfterWipe.body?.entries) &&
        getActAfterWipe.body.entries.length === 1 &&
        getActAfterWipe.body.entries[0]?.id === 'video_tuesday_2_vidYt99',
      '2.10 GET /api/student-journal/activity lê estritamente do Firestore após wipe/envenenamento de RAM'
    );

    const linkedTeacherReadAct = await simulateRequest(
      'GET',
      `/api/student-journal/activity?studentUid=${encodeURIComponent(STUDENT_A_UID)}`,
      { authorization: 'Bearer tok_teacher_linked_no_claim' }
    );
    assert(
      linkedTeacherReadAct.status === 200 && linkedTeacherReadAct.body?.entries?.length === 1,
      '2.11 Professor vinculado aprovado (sem claim teacher) lê Activity Journal do aluno (200)'
    );

    const adminReadAct = await simulateRequest(
      'GET',
      `/api/student-journal/activity?studentUid=${encodeURIComponent(STUDENT_A_UID)}`,
      { authorization: 'Bearer tok_admin' }
    );
    assert(adminReadAct.status === 200 && adminReadAct.body?.entries?.length === 1, '2.12 Admin lê Activity Journal do aluno (200)');

    const getDailyAfterWipe = await simulateRequest(
      'GET',
      '/api/student-journal',
      { authorization: 'Bearer tok_student_a' }
    );
    assert(
      getDailyAfterWipe.status === 200 &&
        Array.isArray(getDailyAfterWipe.body) &&
        getDailyAfterWipe.body.some((e: any) => e.id === 'sentence_2f2a_1' && e.evaluationResult?.hasAnyError === true) &&
        getDailyAfterWipe.body.some((e: any) => e.id === expectedReviewDocId && e.entryType === 'lesson_review'),
      '2.13 GET /api/student-journal retorna frases com avaliação de IA + lesson_review após wipe de RAM'
    );

    // -------------------------------------------------------------------------
    // CENÁRIO 3: Idempotência e Validação Estrita de Week
    // -------------------------------------------------------------------------
    console.log('\n--- Cenário 3: Idempotência e Validação Estrita de Week ---');

    const badWeekPost = await simulateRequest(
      'POST',
      '/api/student-journal/activity',
      { authorization: 'Bearer tok_student_a' },
      {
        studentUid: STUDENT_A_UID,
        entry: { id: 'bad_week_1', type: 'audio', dayOfWeek: 'wednesday', week: 'week-abc' },
      }
    );
    assert(badWeekPost.status === 400, '3.1 POST com week explícita malformada retorna 400 (nunca fallback para Semana 1)', `status=${badWeekPost.status}`);

    const memo1 = await simulateRequest(
      'POST',
      '/api/student-journal/activity',
      { authorization: 'Bearer tok_student_a' },
      {
        studentUid: STUDENT_A_UID,
        entry: {
          id: 'memorization_wednesday_2_first',
          type: 'memorization',
          dayOfWeek: 'wednesday',
          week: 2,
          date: '2026-11-11',
          timestamp: actTs1 + 1000,
          title: 'Weekly Memorization Activity',
        },
      }
    );
    const memo2 = await simulateRequest(
      'POST',
      '/api/student-journal/activity',
      { authorization: 'Bearer tok_student_a' },
      {
        studentUid: STUDENT_A_UID,
        entry: {
          id: 'memorization_wednesday_2_second',
          type: 'memorization',
          dayOfWeek: 'wednesday',
          week: 2,
          date: '2026-11-11',
          timestamp: actTs1 + 2000,
          title: 'Weekly Memorization Activity Updated',
        },
      }
    );
    assert(
      memo1.status === 200 &&
        memo2.status === 200 &&
        memo2.body?.entries?.filter((e: any) => e.type === 'memorization' && e.dayOfWeek === 'wednesday' && e.week === 2).length === 1 &&
        memo2.body?.entries?.find((e: any) => e.type === 'memorization')?.title === 'Weekly Memorization Activity Updated',
      '3.2 Repetição no mesmo slot (type, dayOfWeek, week) é idempotente e não duplica'
    );

    // -------------------------------------------------------------------------
    // CENÁRIO 4: Remoção Definitiva, Compatibilidade Legado e Erro Real
    // -------------------------------------------------------------------------
    console.log('\n--- Cenário 4: Remoção Definitiva, Legado e Erro Real ---');

    const delMemo = await simulateRequest(
      'DELETE',
      '/api/student-journal/activity',
      { authorization: 'Bearer tok_student_a' },
      {
        studentUid: STUDENT_A_UID,
        type: 'memorization',
        dayOfWeek: 'wednesday',
        week: 2,
      }
    );
    assert(
      delMemo.status === 200 &&
        delMemo.body?.success === true &&
        delMemo.body?.entries?.every((e: any) => e.type !== 'memorization'),
      '4.1 DELETE /api/student-journal/activity por (type, dayOfWeek, week) remove memorização permanentemente'
    );

    const getAfterDel = await simulateRequest(
      'GET',
      `/api/student-journal/activity?studentUid=${encodeURIComponent(STUDENT_A_UID)}`,
      { authorization: 'Bearer tok_student_a' }
    );
    assert(
      getAfterDel.status === 200 && getAfterDel.body?.entries?.length === 1 && getAfterDel.body.entries[0]?.id === 'video_tuesday_2_vidYt99',
      '4.2 Subsequente GET confirma remoção sem ressurreição'
    );

    // Aluno legado: lê array legado da raiz (somente leitura) e ao deletar impede ressurreição
    const getLegacyAct = await simulateRequest(
      'GET',
      `/api/student-journal/activity?studentUid=${encodeURIComponent(STUDENT_LEGACY_UID)}`,
      { authorization: 'Bearer tok_student_legacy' }
    );
    assert(
      getLegacyAct.status === 200 && getLegacyAct.body?.entries?.some((e: any) => e.id === 'video_monday_1_legacy_vid_1'),
      '4.3 Compatibilidade legado: aluno antigo lê atividade pré-existente de users/{uid}.studentJournal'
    );

    const delLegacyAct = await simulateRequest(
      'DELETE',
      '/api/student-journal/activity',
      { authorization: 'Bearer tok_student_legacy' },
      { studentUid: STUDENT_LEGACY_UID, type: 'video', dayOfWeek: 'monday', week: 1 }
    );
    assert(
      delLegacyAct.status === 200 && delLegacyAct.body?.entries?.length === 0,
      '4.4 DELETE remove atividade legada para que nunca ressuscite no GET'
    );

    const delLegacyDaily = await simulateRequest(
      'DELETE',
      '/api/student-journal?id=daily_legacy_1',
      { authorization: 'Bearer tok_student_legacy' }
    );
    const getLegacyDailyAfter = await simulateRequest(
      'GET',
      '/api/student-journal',
      { authorization: 'Bearer tok_student_legacy' }
    );
    assert(
      delLegacyDaily.status === 200 &&
        delLegacyDaily.body?.success === true &&
        Array.isArray(getLegacyDailyAfter.body) &&
        getLegacyDailyAfter.body.length === 0,
      '4.5 DELETE /api/student-journal remove entrada legada de dailyJournalEntries sem ressuscitar'
    );

    // Erro real de escrita no Firestore retorna 500
    mockDb.failWriteMatcher = (p) => p.includes('/activity_journal/');
    const failPost = await simulateRequest(
      'POST',
      '/api/student-journal/activity',
      { authorization: 'Bearer tok_student_a' },
      {
        studentUid: STUDENT_A_UID,
        entry: { id: 'audio_thursday_2_trk1', type: 'audio', dayOfWeek: 'thursday', week: 2, title: 'Fail Track' },
      }
    );
    mockDb.failWriteMatcher = null;
    assert(failPost.status === 500 && failPost.body?.success === false, '4.6 Falha no Firestore retorna erro real HTTP 500 (nunca falso sucesso)', `status=${failPost.status}`);

    // -------------------------------------------------------------------------
    // CENÁRIO 5: Consulta Entre Aulas, Rotina Canônica e Histórico Semanal
    // -------------------------------------------------------------------------
    console.log('\n--- Cenário 5: Consulta Entre Aulas, Rotina e Histórico Semanal ---');

    // Adicionar áudio recente + vocabulário no Firestore do Aluno A
    const audioTs = Date.now() - 30 * 60 * 1000;
    await simulateRequest(
      'POST',
      '/api/student-journal/activity',
      { authorization: 'Bearer tok_student_a' },
      {
        studentUid: STUDENT_A_UID,
        entry: {
          id: 'audio_thursday_2_trk77',
          type: 'audio',
          dayOfWeek: 'thursday',
          week: 2,
          date: '2026-11-12',
          timestamp: audioTs,
          title: 'Podcast Episode 77',
          artist: 'English Pod',
        },
      }
    );

    await mockDb.collection('users').doc(STUDENT_A_UID).collection('vocabulary').doc('insight').set({
      word: 'insight',
      translationPt: 'percepção',
      source: 'routine',
      learnedAt: new Date(audioTs).toISOString(),
    });

    // Semear aulas anterior e atual para testar consulta entre aulas
    await mockDb.collection('lessons').doc('lesson_prev_2f2a').set({
      id: 'lesson_prev_2f2a',
      studentUid: STUDENT_A_UID,
      studentEmail: STUDENT_A_EMAIL,
      teacherUid: TEACHER_LINKED_UID,
      startDateTime: new Date(actTs1 - 60000).toISOString(),
      status: 'completed',
    });
    await mockDb.collection('lessons').doc('lesson_curr_2f2a').set({
      id: 'lesson_curr_2f2a',
      studentUid: STUDENT_A_UID,
      studentEmail: STUDENT_A_EMAIL,
      teacherUid: TEACHER_LINKED_UID,
      startDateTime: new Date().toISOString(),
      status: 'scheduled',
    });

    // Envenenar RAM novamente antes da consulta entre aulas
    wipeAndPoisonMemory();

    const betweenRes = await getStudentActivitiesBetweenLessonsServer(
      STUDENT_A_UID,
      STUDENT_A_EMAIL,
      'lesson_curr_2f2a',
      TEACHER_LINKED_UID
    );
    assert(
      betweenRes.hasActivities === true &&
        betweenRes.videos.some((v: any) => v.id === 'video_tuesday_2_vidYt99' || v.title === 'Daily Tech English') &&
        !betweenRes.videos.some((v: any) => String(v.id || v.title).includes('POISONED')),
      '5.1 getStudentActivitiesBetweenLessonsServer lê users/{uid}/activity_journal e ignora RAM envenenada',
      JSON.stringify(betweenRes.videos)
    );
    assert(
      betweenRes.vocabulary.some((v: any) => v.word === 'insight') &&
        !betweenRes.vocabulary.some((v: any) => v.word === 'poisoned_ram_word'),
      '5.2 getStudentActivitiesBetweenLessonsServer preserva vocabulário do Firestore e ignora RAM'
    );

    const consumedRes = await fetchAccumulatedConsumedHistoryServer(STUDENT_A_UID);
    assert(
      consumedRes.videoIds.some((id) => id.includes('vidYt99')) &&
        consumedRes.trackIds.some((id) => id.includes('trk77')),
      '5.3 fetchAccumulatedConsumedHistoryServer contabiliza vídeo e áudio de activity_journal',
      JSON.stringify({ videoIds: consumedRes.videoIds, trackIds: consumedRes.trackIds })
    );

    const routineCtx = await fetchCanonicalRoutineContextServer(STUDENT_A_UID);
    assert(
      Array.isArray(routineCtx?.watchedVideosHistory) && routineCtx.watchedVideosHistory.length > 0,
      '5.4 fetchCanonicalRoutineContextServer lê atividades de activity_journal para contexto de rotina'
    );

    const routineVideos = await fetchRoutineVideosFromFirestoreServer(STUDENT_A_UID);
    assert(
      Array.isArray(routineVideos.watchedVideosHistory) && routineVideos.watchedVideosHistory.length > 0,
      '5.5 fetchRoutineVideosFromFirestoreServer lê atividades de activity_journal'
    );

    const closeRes = await closeWeeklyHistorySnapshotServer({
      uid: STUDENT_A_UID,
      closingCycle: 2,
      studentEmail: STUDENT_A_EMAIL,
    });
    assert(
      closeRes.ok === true && closeRes.history?.weekId === 'week-2',
      '5.6 closeWeeklyHistorySnapshotServer fecha ciclo semanal preservando histórico'
    );

    // -------------------------------------------------------------------------
    // CENÁRIO 6: Auditoria Estática do Frontend
    // -------------------------------------------------------------------------
    console.log('\n--- Cenário 6: Auditoria Estática do Frontend ---');

    const persistenceSrc = fs.readFileSync(path.resolve('src/utils/studentPersistence.ts'), 'utf8');
    const journalBlockStart = persistenceSrc.indexOf('export async function recordActivityInStudentJournal');
    const journalBlockEnd = persistenceSrc.indexOf('export function mergeDailyActivities');
    const activitySection = persistenceSrc.slice(journalBlockStart, journalBlockEnd);
    const activityCodeOnly = activitySection
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');

    assert(
      journalBlockStart !== -1 &&
        journalBlockEnd !== -1 &&
        !/\b(getDoc|setDoc|deleteDoc|getDocs|onSnapshot)\b/.test(activityCodeOnly),
      '6.1 Helpers de Activity Journal em studentPersistence.ts não utilizam Firebase Web SDK (getDoc/setDoc/deleteDoc/getDocs/onSnapshot)'
    );
    assert(
      activitySection.includes("Authorization") && activitySection.includes("/api/student-journal/activity"),
      '6.2 Helpers de Activity Journal usam Authorization Bearer e /api/student-journal/activity'
    );

    const memoFnStart = persistenceSrc.indexOf('export async function saveMemorizationCompletionToFirestore');
    const memoFnEnd = persistenceSrc.indexOf('export async function fetchStudentWeeklyChecksFromFirestore');
    const memoFn = persistenceSrc.slice(memoFnStart, memoFnEnd);
    assert(
      memoFn.includes("method: 'DELETE'") && memoFn.includes("its-simple:activity-journal-updated"),
      '6.3 saveMemorizationCompletionToFirestore executa DELETE ao desmarcar e emite evento reativo'
    );

    const dailySubStart = persistenceSrc.indexOf('export function subscribeToStudentDailyJournal');
    const dailySubEnd = persistenceSrc.indexOf('export async function fetchStudentDailyRoutinesFromFirestore');
    const dailySubSection = persistenceSrc.slice(dailySubStart, dailySubEnd);
    assert(
      dailySubSection.includes('onAuthStateChanged') && dailySubSection.includes('its-simple:daily-journal-updated'),
      '6.4 subscribeToStudentDailyJournal e deleteStudentJournalEntryFromFirestore possuem reatividade completa'
    );

    const weeklySectionSrc = fs.readFileSync(path.resolve('src/components/StudentWeeklyActivitySection.tsx'), 'utf8');
    assert(
      weeklySectionSrc.includes('hasServerJournalSync') && !weeklySectionSrc.includes('userProfile.studentJournal.forEach'),
      '6.5 StudentWeeklyActivitySection.tsx não ressuscita atividades removidas via userProfile.studentJournal'
    );

    const appSrc = fs.readFileSync(path.resolve('src/App.tsx'), 'utf8');
    assert(
      appSrc.includes('subscribeToStudentDailyJournal(uid, email') &&
        appSrc.includes('setWeeklyChecks((prev) => ({ ...currentCached, ...prev, ...derivedChecks }))'),
      '6.6 App.tsx assina Daily Journal reativamente e preserva desmarcações otimistas'
    );

    console.log('\n================================================================================');
    console.log(` RESULTADO ARCH.2F.2A: ${passed} passed, ${failed} failed`);
    console.log('================================================================================');

    if (failed > 0) {
      process.exitCode = 1;
    }
  } finally {
    setFirebaseAdminAuthForTesting(null);
    setFirebaseAdminFirestoreForTesting(null);
    trackedIntervals.forEach((h) => originalClearInterval(h));
    trackedTimeouts.forEach((h) => originalClearTimeout(h));
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
}

runTests().catch((err) => {
  console.error('Fatal error running ARCH.2F.2A tests:', err);
  process.exit(1);
});
