/**
 * ARCH.2E.2B — Consolidação Canônica de Spotify e Rotinas de Áudio do S-Path
 *
 * Bateria de testes cobrindo os 10 cenários obrigatórios:
 * 1. Professor aprovado (sem custom claim 'teacher') atribui áudio ao aluno vinculado.
 * 2. Aluno recupera atribuições, rotina, currentRoutine, feedback e override após nova sessão (sem auto-redistribuição no GET vazio).
 * 3. Dois alunos (A e B) mantêm atribuições, ciclos, histórico e currentRoutine isolados (UID case-sensitive preservado).
 * 4. Dados persistem após simulação de reinicialização (wipe de inMemoryDb + envenenamento de campos legados).
 * 5. Distribuição repetida (distribute-week) e atribuição repetida (assign) são idempotentes e não duplicam áudios.
 * 6. Registro repetido de áudio escutado (/listen e /toggle audio) é idempotente e não duplica histórico.
 * 7. Requisições sem token (401), token inválido (401), aluno cruzado (403), professor não vinculado (403),
 *    professor pendente (403) e UID sintético (403/422) são rejeitadas sem gravações.
 * 8. Falha do Firestore retorna HTTP 500 (success: false), nunca falso sucesso.
 * 9. Ciclos antigos (weeklyCycle < activeCycle ou weekId antigo) retornam 409 STALE_CYCLE e não sobrescrevem o ciclo ativo.
 * 10. Funcionalidades de vídeo ARCH.2E.2A e ocultação SHOW_SPOTIFY_AUDIO_ASSIGNMENT = false continuam intactas.
 */

process.env.NODE_ENV = 'test';
process.env.FIREBASE_PROJECT_ID = 'itissimple-security-staging';
process.env.FIREBASE_DATABASE_ID = '(default)';

import { setFirebaseAdminAuthForTesting } from '../src/serverFirebaseAdmin';
import { setFirebaseAdminFirestoreForTesting } from '../src/serverFirestore';
import { SHOW_SPOTIFY_AUDIO_ASSIGNMENT } from '../src/components/NativeFriendSpotifyTable';

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
  console.log(" IT'S SIMPLE — ARCH.2E.2B: CONSOLIDAÇÃO CANÔNICA DE SPOTIFY E ROTINAS DE ÁUDIO");
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

  const STUDENT_A_UID = 'StuA_SpotUid12345678901234';
  const STUDENT_A_EMAIL = 'student.a.arch2e2b@gmail.com';
  const STUDENT_B_UID = 'StuB_SpotUid12345678901234';
  const STUDENT_B_EMAIL = 'student.b.arch2e2b@gmail.com';
  const TEACHER_LINKED_UID = 'TchL_SpotUid12345678901234';
  const TEACHER_LINKED_EMAIL = 'teacher.linked.arch2e2b@gmail.com';
  const TEACHER_LINKED_PUBLIC_ID = 'tutor-linked-arch2e2b';
  const TEACHER_UNLINKED_UID = 'TchU_SpotUid12345678901234';
  const TEACHER_UNLINKED_EMAIL = 'teacher.unlinked.arch2e2b@gmail.com';
  const TEACHER_PENDING_UID = 'TchP_SpotUid12345678901234';
  const TEACHER_PENDING_EMAIL = 'teacher.pending.arch2e2b@gmail.com';
  const ADMIN_UID = 'Adm_SpotUid123456789012345';
  const ADMIN_EMAIL = 'admin.arch2e2b@gmail.com';

  const tokensDb = new Map<string, any>();
  tokensDb.set('tok_student_a', { uid: STUDENT_A_UID, email: STUDENT_A_EMAIL, email_verified: true, role: 'student' });
  tokensDb.set('tok_student_b', { uid: STUDENT_B_UID, email: STUDENT_B_EMAIL, email_verified: true, role: 'student' });
  // Linked teacher intentionally WITHOUT custom 'teacher' claim in JWT
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
    name: 'Student Alpha Spotify',
    role: 'student',
    level: 'beginner',
    englishLevel: 'beginner',
    weeklyCycle: 3,
    weeklyStudyDays: ['monday', 'wednesday', 'friday'],
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
    name: 'Student Beta Spotify',
    role: 'student',
    level: 'intermediate',
    englishLevel: 'intermediate',
    weeklyCycle: 1,
    weeklyStudyDays: ['tuesday', 'thursday'],
    routineVideoTime: '09:30',
    routineAudioTime: '21:15',
    assignedNativeFriendUID: TEACHER_UNLINKED_UID,
    teacherUid: TEACHER_UNLINKED_UID,
    teacherEmail: TEACHER_UNLINKED_EMAIL,
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

  await mockDb.collection('tutors').doc('tutor-unlinked-arch2e2b').set({
    id: 'tutor-unlinked-arch2e2b',
    authUid: TEACHER_UNLINKED_UID,
    uid: TEACHER_UNLINKED_UID,
    email: TEACHER_UNLINKED_EMAIL,
    name: 'Unlinked Approved Native Friend',
    role: 'teacher',
    isApproved: true,
    approvalStatus: 'approved',
  });

  await mockDb.collection('tutors').doc('tutor-pending-arch2e2b').set({
    id: 'tutor-pending-arch2e2b',
    authUid: TEACHER_PENDING_UID,
    uid: TEACHER_PENDING_UID,
    email: TEACHER_PENDING_EMAIL,
    name: 'Pending Native Friend',
    role: 'teacher',
    isApproved: false,
    approvalStatus: 'pending',
  });

  // Seed legacy Cycle 1 Spotify assignment for Student A to assert cycle filtering
  await mockDb.collection('student_assignments').doc(STUDENT_A_UID).set({
    uid: STUDENT_A_UID,
    email: STUDENT_A_EMAIL,
    level: 'beginner',
    weeklyCycle: 3,
    spotifyAssignments: [
      {
        id: 'old_cycle1_spot',
        day: 'monday',
        trackId: '4cOdK2wGLETKBW3PvgPWqT',
        trackUrl: 'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT',
        title: 'Old Cycle 1 Track (Should Not Leak)',
        weeklyCycle: 1,
      },
    ],
    listenedTracks: [],
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

  function seedCatalogPlaylists() {
    const db = readDb();
    db.spotifyPlaylists = {
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
          {
            trackId: '3SdTKo2uVsxFblQjpScoHy',
            title: 'Stand By Me',
            artist: 'Ben E. King',
            url: 'https://open.spotify.com/track/3SdTKo2uVsxFblQjpScoHy',
            embedUrl: 'https://open.spotify.com/embed/track/3SdTKo2uVsxFblQjpScoHy',
            durationMs: 180000,
            playlistId: '37i9dQZF1DXcBWIGoYBM5M',
            playlistTitle: 'Beginner Audio Official',
            level: 'beginner',
          },
          {
            trackId: '2Qoi96v3tL8yR9V7K1yXQp',
            title: 'What a Wonderful World',
            artist: 'Louis Armstrong',
            url: 'https://open.spotify.com/track/2Qoi96v3tL8yR9V7K1yXQp',
            embedUrl: 'https://open.spotify.com/embed/track/2Qoi96v3tL8yR9V7K1yXQp',
            durationMs: 139000,
            playlistId: '37i9dQZF1DXcBWIGoYBM5M',
            playlistTitle: 'Beginner Audio Official',
            level: 'beginner',
          },
          {
            trackId: '4bN5W5QhC8j34V0g8pE6mF',
            title: 'Three Little Birds',
            artist: 'Bob Marley',
            url: 'https://open.spotify.com/track/4bN5W5QhC8j34V0g8pE6mF',
            embedUrl: 'https://open.spotify.com/embed/track/4bN5W5QhC8j34V0g8pE6mF',
            durationMs: 180000,
            playlistId: '37i9dQZF1DXcBWIGoYBM5M',
            playlistTitle: 'Beginner Audio Official',
            level: 'beginner',
          },
        ],
      },
      intermediate: {
        tracks: [
          {
            trackId: '1mea3bSkSGXuIRvnydlB5b',
            title: 'Viva La Vida',
            artist: 'Coldplay',
            url: 'https://open.spotify.com/track/1mea3bSkSGXuIRvnydlB5b',
            embedUrl: 'https://open.spotify.com/embed/track/1mea3bSkSGXuIRvnydlB5b',
            durationMs: 242000,
            playlistId: '5MMU9H5oXDd7FCWr0gkzHE',
            playlistTitle: 'Intermediate Audio Official',
            level: 'intermediate',
          },
          {
            trackId: '1CkvWZme3RKiZJNXZe47ci',
            title: 'Rolling in the Deep',
            artist: 'Adele',
            url: 'https://open.spotify.com/track/1CkvWZme3RKiZJNXZe47ci',
            embedUrl: 'https://open.spotify.com/embed/track/1CkvWZme3RKiZJNXZe47ci',
            durationMs: 228000,
            playlistId: '5MMU9H5oXDd7FCWr0gkzHE',
            playlistTitle: 'Intermediate Audio Official',
            level: 'intermediate',
          },
        ],
      },
    };
  }

  function wipeInMemoryState() {
    const db = readDb();
    db.studentRoutinesMap = {};
    db.studentSpotifyAssignments = {};
    db.studentSpotifyCycles = {};
    db.studentListenedTracks = {};
    (db as any).studentCurrentRoutines = {};
    db.studentVideoAssignments = {};
    db.routinesByDay = {} as any;
    db.studentWatchedVideos = {};
    db.userProfiles = {};
    db.students = [];
    seedCatalogPlaylists();
  }

  wipeInMemoryState();

  // =========================================================================
  // CENÁRIO 2 (Pré-check): GET vazio NÃO auto-redistribui
  // =========================================================================
  console.log('--- Pré-check: GET vazio em Spotify não auto-redistribui ---');
  const writesBeforeEmptyGet = mockDb.writeCount;
  const emptySpotGet = await simulateRequest(
    'GET',
    `/api/student-spotify-assignments?uid=${encodeURIComponent(STUDENT_A_UID)}`,
    { Authorization: 'Bearer tok_student_a' }
  );
  assert(emptySpotGet.status === 200 && emptySpotGet.body?.success === true, 'GET /api/student-spotify-assignments returns 200');
  assert(
    Array.isArray(emptySpotGet.body?.assignments) && emptySpotGet.body.assignments.length === 0,
    'GET does NOT auto-distribute and filters out Cycle 1 assignment (0 active assignments)'
  );
  assert(mockDb.writeCount === writesBeforeEmptyGet, 'Empty GET performs zero Firestore writes');

  // =========================================================================
  // CENÁRIO 1: Professor aprovado (sem custom claim 'teacher') atribui áudio ao aluno vinculado
  // =========================================================================
  console.log('\n--- Cenário 1: Professor aprovado (sem custom claim teacher) atribui áudio ---');
  const assignSpotRes = await simulateRequest(
    'POST',
    '/api/student-spotify-assignments/assign',
    { Authorization: 'Bearer tok_teacher_linked_no_claim' },
    {
      studentUid: STUDENT_A_UID,
      studentEmail: STUDENT_A_EMAIL,
      day: 'monday',
      level: 'beginner',
      idempotencyKey: 'spot-assign-key-1',
    }
  );
  assert(assignSpotRes.status === 200 && assignSpotRes.body?.success === true, 'Approved teacher without teacher claim assigns Spotify track on monday');
  assert(assignSpotRes.body?.weeklyCycle === 3, 'Assigned Spotify track preserves activeCycle=3');
  assert(assignSpotRes.body?.studentUid === STUDENT_A_UID, 'Canonical case-sensitive studentUid preserved');
  const mondayAssignedTrackId = assignSpotRes.body?.track?.trackId;
  assert(Boolean(mondayAssignedTrackId), 'Assigned trackId returned');

  const teacherSpotRes = await simulateRequest(
    'POST',
    '/api/routines/teacher-spotify',
    { Authorization: 'Bearer tok_teacher_linked_no_claim' },
    {
      studentUid: STUDENT_A_UID,
      activityId: 'act-2',
      day: 'wednesday',
      days: ['wednesday'],
      spotify: {
        url: 'https://open.spotify.com/track/7qiZfU4dY1lWllzX7mPBI3',
        title: 'Shape of You',
        artistOrHost: 'Ed Sheeran',
        type: 'music',
      },
      teacherNotes: 'Focus on rhythm and pronunciation.',
    }
  );
  assert(teacherSpotRes.status === 200 && teacherSpotRes.body?.success === true, 'POST /api/routines/teacher-spotify succeeds for linked approved teacher');

  const overrideRes = await simulateRequest(
    'POST',
    '/api/routines/override-track',
    { Authorization: 'Bearer tok_teacher_linked_no_claim' },
    {
      studentUid: STUDENT_A_UID,
      dayOfWeek: 'monday',
      teacherOverrideTrack: {
        url: 'https://open.spotify.com/track/2ixOvtAoMgGmgCsBGqxjh8',
        title: 'Budapest',
        artist: 'George Ezra',
        instructions: 'Listen to conditional phrases.',
      },
    }
  );
  assert(overrideRes.status === 200 && overrideRes.body?.success === true, 'POST /api/routines/override-track succeeds for linked approved teacher');

  const feedbackRes = await simulateRequest(
    'POST',
    '/api/routines/current-routine/feedback',
    { Authorization: 'Bearer tok_teacher_linked_no_claim' },
    {
      studentUid: STUDENT_A_UID,
      weekId: 'week-3',
      feedback: {
        dayOfWeek: 'monday',
        trackId: mondayAssignedTrackId,
        comment: 'Great listening consistency this week!',
        recommendation: 'Review phrasal verbs.',
      },
    }
  );
  assert(feedbackRes.status === 200 && feedbackRes.body?.success === true, 'POST /api/routines/current-routine/feedback succeeds for linked approved teacher');

  // Verify verify-link survives empty inMemoryDb via Firestore fallback
  const verifyLinkRes = await simulateRequest(
    'GET',
    `/api/students/verify-link?studentUid=${encodeURIComponent(STUDENT_A_UID)}&teacherUid=${encodeURIComponent(TEACHER_LINKED_UID)}`,
    { Authorization: 'Bearer tok_teacher_linked_no_claim' }
  );
  assert(verifyLinkRes.status === 200 && verifyLinkRes.body?.isLinked === true, 'GET /api/students/verify-link verifies Firestore canonical link');

  // =========================================================================
  // CENÁRIO 2 & 4: Recuperação em nova sessão + persistência após reinicialização (wipe + poison)
  // =========================================================================
  console.log('\n--- Cenários 2 & 4: Nova sessão + simulação de reinicialização ---');
  // Student posts current-routine live track
  const postCurrentRoutine = await simulateRequest(
    'POST',
    '/api/routines/current-routine',
    { Authorization: 'Bearer tok_student_a' },
    {
      studentUid: STUDENT_A_UID,
      weekId: 'week-3',
      dayOfWeek: 'monday',
      currentSpotifyTrack: {
        id: mondayAssignedTrackId,
        title: 'Count On Me',
        artist: 'Bruno Mars',
        coverUrl: 'https://example.com/cover.jpg',
        dayOfWeek: 'monday',
        url: 'https://open.spotify.com/track/3H04Y8V3L2aVf7f2b1d3kK',
      },
    }
  );
  assert(postCurrentRoutine.status === 200 && postCurrentRoutine.body?.success === true, 'Student saves currentRoutine to Firestore (default)');

  // Wipe and POISON legacy inMemoryDb fields!
  wipeInMemoryState();
  const dbPoison = readDb();
  (dbPoison as any).studentSpotifyAssignments = {
    [STUDENT_A_UID]: [{ day: 'monday', trackId: 'POISONED', url: 'https://open.spotify.com/track/POISON000000000000' }],
  };
  (dbPoison as any).studentCurrentRoutines = {
    [`${STUDENT_A_UID.toLowerCase()}:weekData`]: { currentSpotifyTrack: { id: 'POISONED_CURR', title: 'POISONED' } },
  };

  const spotAfterRestart = await simulateRequest(
    'GET',
    `/api/student-spotify-assignments?uid=${encodeURIComponent(STUDENT_A_UID)}`,
    { Authorization: 'Bearer tok_student_a' }
  );
  assert(
    spotAfterRestart.status === 200 && spotAfterRestart.body?.assignments?.length === 2,
    'Student A recovers both monday & wednesday Spotify assignments after restart (ignores poisoned memory)',
    `got ${spotAfterRestart.body?.assignments?.length}`
  );
  const wedSpot = spotAfterRestart.body?.assignments?.find((a: any) => a.day === 'wednesday');
  assert(wedSpot?.trackId === '7qiZfU4dY1lWllzX7mPBI3', 'Wednesday teacher-spotify track matches Firestore, not poison');

  const routinesAfterRestart = await simulateRequest(
    'GET',
    `/api/student-routines?uid=${encodeURIComponent(STUDENT_A_UID)}`,
    { Authorization: 'Bearer tok_student_a' }
  );
  const monAudioSlot =
    routinesAfterRestart.body?.monday?.find((i: any) => i?.teacherSpotify) || routinesAfterRestart.body?.monday?.[0];
  const wedAudioSlot =
    routinesAfterRestart.body?.wednesday?.find((i: any) => i?.teacherSpotify) || routinesAfterRestart.body?.wednesday?.[0];
  assert(monAudioSlot?.teacherSpotify?.url?.includes(mondayAssignedTrackId), 'GET /api/student-routines hydrates Monday audio slot');
  assert(monAudioSlot?.teacherOverrideTrack?.title === 'Budapest', 'GET /api/student-routines hydrates teacherOverrideTrack');
  assert(monAudioSlot?.teacherFeedback?.monday?.comment === 'Great listening consistency this week!', 'GET /api/student-routines hydrates teacherFeedback');
  assert(wedAudioSlot?.teacherSpotify?.title === 'Shape of You', 'GET /api/student-routines hydrates Wednesday custom Spotify');

  const currRoutineAfterRestart = await simulateRequest(
    'GET',
    `/api/routines/current-routine?studentUid=${encodeURIComponent(STUDENT_A_UID)}&weekId=week-3`,
    { Authorization: 'Bearer tok_student_a' }
  );
  assert(
    currRoutineAfterRestart.status === 200 && currRoutineAfterRestart.body?.routine?.currentSpotifyTrack?.id === mondayAssignedTrackId,
    'GET /api/routines/current-routine recovers canonical track from Firestore (ignores poisoned memory)'
  );
  assert(
    currRoutineAfterRestart.body?.routine?.teacherFeedback?.monday?.comment === 'Great listening consistency this week!',
    'GET /api/routines/current-routine recovers teacher feedback from Firestore'
  );
  assert(
    currRoutineAfterRestart.body?.routine?.teacherOverrides?.monday?.title === 'Budapest',
    'GET /api/routines/current-routine recovers teacher override from Firestore'
  );

  // Also test removing override
  const removeOverrideRes = await simulateRequest(
    'POST',
    '/api/routines/override-track',
    { Authorization: 'Bearer tok_teacher_linked_no_claim' },
    { studentUid: STUDENT_A_UID, dayOfWeek: 'monday', teacherOverrideTrack: null }
  );
  assert(removeOverrideRes.status === 200 && removeOverrideRes.body?.teacherOverrideTrack === null, 'Removing override sets teacherOverrideTrack to null');

  // =========================================================================
  // CENÁRIO 3: Isolamento entre dois alunos (A e B)
  // =========================================================================
  console.log('\n--- Cenário 3: Isolamento estrito entre dois alunos ---');
  const assignBRes = await simulateRequest(
    'POST',
    '/api/student-spotify-assignments/assign',
    { Authorization: 'Bearer tok_admin' },
    { studentUid: STUDENT_B_UID, day: 'tuesday', level: 'intermediate' }
  );
  assert(assignBRes.status === 200 && assignBRes.body?.success === true, 'Admin assigns Intermediate track to Student B');

  const getARes = await simulateRequest(
    'GET',
    `/api/student-spotify-assignments?uid=${encodeURIComponent(STUDENT_A_UID)}`,
    { Authorization: 'Bearer tok_student_a' }
  );
  const getBRes = await simulateRequest(
    'GET',
    `/api/student-spotify-assignments?uid=${encodeURIComponent(STUDENT_B_UID)}`,
    { Authorization: 'Bearer tok_student_b' }
  );
  assert(
    getARes.body?.assignments?.every((a: any) => a.studentUid === STUDENT_A_UID) &&
      !getARes.body?.assignments?.some((a: any) => a.trackId === assignBRes.body?.track?.trackId),
    'Student A never sees Student B audio assignments'
  );
  assert(
    getBRes.body?.assignments?.length === 1 && getBRes.body?.assignments?.[0]?.studentUid === STUDENT_B_UID,
    'Student B never sees Student A audio assignments'
  );

  // Verify mixed-case canonical doc IDs (no lowercased doc keys!)
  const assignmentsCol = mockDb.collection('student_assignments');
  assert(!assignmentsCol.docs.has(STUDENT_A_UID.toLowerCase()), 'student_assignments does NOT use lowercased UID');
  assert(assignmentsCol.docs.has(STUDENT_A_UID), 'student_assignments strictly keyed by canonical mixed-case UID');

  // =========================================================================
  // CENÁRIO 5: Idempotência na distribuição e atribuição repetida
  // =========================================================================
  console.log('\n--- Cenário 5: Idempotência em assign e distribute-week ---');
  const replayAssign = await simulateRequest(
    'POST',
    '/api/student-spotify-assignments/assign',
    { Authorization: 'Bearer tok_teacher_linked_no_claim' },
    {
      studentUid: STUDENT_A_UID,
      day: 'monday',
      level: 'beginner',
      idempotencyKey: 'spot-assign-key-1',
    }
  );
  assert(
    replayAssign.status === 200 && replayAssign.body?.idempotentReplay === true && replayAssign.body?.track?.trackId === mondayAssignedTrackId,
    'Repeated assign returns idempotentReplay: true with identical track'
  );

  const distB1 = await simulateRequest(
    'POST',
    '/api/student-spotify-assignments/distribute-week',
    { Authorization: 'Bearer tok_admin' },
    { studentUid: STUDENT_B_UID, level: 'intermediate', days: ['tuesday', 'thursday'], idempotencyKey: 'dist-b-week-1' }
  );
  assert(distB1.status === 200 && distB1.body?.success === true && distB1.body?.assignments?.length === 2, 'First distribute-week distributes 2 days');

  const distB2 = await simulateRequest(
    'POST',
    '/api/student-spotify-assignments/distribute-week',
    { Authorization: 'Bearer tok_admin' },
    { studentUid: STUDENT_B_UID, level: 'intermediate', days: ['tuesday', 'thursday'], idempotencyKey: 'dist-b-week-1' }
  );
  assert(
    distB2.status === 200 &&
      distB2.body?.idempotentReplay === true &&
      distB2.body?.assignments?.[1]?.trackId === distB1.body?.assignments?.[1]?.trackId,
    'Repeated distribute-week returns idempotentReplay: true and does not duplicate tracks'
  );

  // =========================================================================
  // CENÁRIO 6: Idempotência em registro de áudio escutado
  // =========================================================================
  console.log('\n--- Cenário 6: Idempotência em listenedTracks e toggle audio ---');
  const listen1 = await simulateRequest(
    'POST',
    '/api/student-spotify-assignments/listen',
    { Authorization: 'Bearer tok_student_a' },
    {
      studentUid: STUDENT_A_UID,
      trackId: '3H04Y8V3L2aVf7f2b1d3kK',
      trackTitle: 'Count On Me',
      artist: 'Bruno Mars',
    }
  );
  assert(listen1.status === 200 && listen1.body?.success === true && listen1.body?.alreadyRecorded === false, 'First /listen persists track');

  const listen2 = await simulateRequest(
    'POST',
    '/api/student-spotify-assignments/listen',
    { Authorization: 'Bearer tok_student_a' },
    {
      studentUid: STUDENT_A_UID,
      trackUrl: 'https://open.spotify.com/track/3H04Y8V3L2aVf7f2b1d3kK',
      trackTitle: 'Count On Me',
    }
  );
  assert(listen2.status === 200 && listen2.body?.alreadyRecorded === true, 'Repeated /listen reports alreadyRecorded: true');

  const toggleAudio = await simulateRequest(
    'POST',
    '/api/routines/toggle',
    { Authorization: 'Bearer tok_student_a' },
    {
      studentUid: STUDENT_A_UID,
      day: 'monday',
      activityId: 'act-2',
      activityType: 'audio',
      completedToday: true,
    }
  );
  assert(toggleAudio.status === 200 && toggleAudio.body?.completedToday === true, 'POST /api/routines/toggle marks audio completed');

  const userADocSnap = await mockDb.collection('users').doc(STUDENT_A_UID).get();
  const assignADocSnap = await mockDb.collection('student_assignments').doc(STUDENT_A_UID).get();
  const historyList = userADocSnap.data()?.listenedTracksHistory || [];
  const assignListened = assignADocSnap.data()?.listenedTracks || [];
  assert(
    historyList.filter((t: any) => (t.trackId || t) === '3H04Y8V3L2aVf7f2b1d3kK').length === 1,
    'users/{uid}.listenedTracksHistory contains exactly 1 entry after repeated listen + toggle'
  );
  assert(
    assignListened.filter((id: string) => id === '3H04Y8V3L2aVf7f2b1d3kK').length === 1,
    'student_assignments/{uid}.listenedTracks contains exactly 1 entry'
  );

  // =========================================================================
  // CENÁRIO 7: Segurança — 401, 403, vínculo e UID sintético sem gravações
  // =========================================================================
  console.log('\n--- Cenário 7: Segurança (sem token, token inválido, cruzado, sem vínculo, pendente, sintético) ---');
  const writesBeforeSecurity = mockDb.writeCount;

  const noTokenGet = await simulateRequest('GET', `/api/student-spotify-assignments?uid=${STUDENT_A_UID}`);
  assert(noTokenGet.status === 401, 'GET /api/student-spotify-assignments without token returns 401');

  const badTokenPost = await simulateRequest(
    'POST',
    '/api/student-spotify-assignments/listen',
    { Authorization: 'Bearer invalid_token_xyz' },
    { trackId: '3H04Y8V3L2aVf7f2b1d3kK' }
  );
  assert(badTokenPost.status === 401, 'POST /listen with invalid token returns 401');

  const crossStudentGet = await simulateRequest(
    'GET',
    `/api/routines/current-routine?studentUid=${encodeURIComponent(STUDENT_A_UID)}`,
    { Authorization: 'Bearer tok_student_b' }
  );
  assert(crossStudentGet.status === 403, 'Student B reading Student A current-routine returns 403');

  const crossStudentPost = await simulateRequest(
    'POST',
    '/api/student-spotify-assignments/assign',
    { Authorization: 'Bearer tok_student_b' },
    { studentUid: STUDENT_A_UID, day: 'monday' }
  );
  assert(crossStudentPost.status === 403, 'Student B assigning to Student A returns 403');

  const unlinkedTeacherAssign = await simulateRequest(
    'POST',
    '/api/routines/teacher-spotify',
    { Authorization: 'Bearer tok_teacher_unlinked' },
    {
      studentUid: STUDENT_A_UID,
      day: 'monday',
      spotify: { url: 'https://open.spotify.com/track/3H04Y8V3L2aVf7f2b1d3kK', title: 'X' },
    }
  );
  assert(unlinkedTeacherAssign.status === 403, 'Unlinked teacher posting teacher-spotify to Student A returns 403');

  const pendingTeacherFeedback = await simulateRequest(
    'POST',
    '/api/routines/current-routine/feedback',
    { Authorization: 'Bearer tok_teacher_pending' },
    {
      studentUid: STUDENT_A_UID,
      feedback: { dayOfWeek: 'monday', trackId: 'x', comment: 'hack' },
    }
  );
  assert(pendingTeacherFeedback.status === 403, 'Pending/unapproved teacher posting feedback returns 403');

  const syntheticUidOverride = await simulateRequest(
    'POST',
    '/api/routines/override-track',
    { Authorization: 'Bearer tok_admin' },
    {
      studentUid: 'usr-synthetic-fake-123',
      dayOfWeek: 'monday',
      teacherOverrideTrack: { url: 'https://open.spotify.com/track/3H04Y8V3L2aVf7f2b1d3kK' },
    }
  );
  assert(
    syntheticUidOverride.status === 403 || syntheticUidOverride.status === 422,
    `Synthetic UID rejected (${syntheticUidOverride.status})`
  );

  assert(mockDb.writeCount === writesBeforeSecurity, 'Unauthorized requests performed ZERO Firestore writes');

  // =========================================================================
  // CENÁRIO 8: Falha do Firestore nunca retorna falso sucesso
  // =========================================================================
  console.log('\n--- Cenário 8: Falha real do Firestore propaga HTTP 500 ---');
  mockDb.failWriteMatcher = () => true;
  try {
    const failAssign = await simulateRequest(
      'POST',
      '/api/student-spotify-assignments/assign',
      { Authorization: 'Bearer tok_teacher_linked_no_claim' },
      { studentUid: STUDENT_A_UID, day: 'friday', level: 'beginner', forceNewTrack: true }
    );
    assert(failAssign.status === 500 && failAssign.body?.success === false, 'assign returns 500 on Firestore write failure');

    const failListen = await simulateRequest(
      'POST',
      '/api/student-spotify-assignments/listen',
      { Authorization: 'Bearer tok_student_a' },
      { studentUid: STUDENT_A_UID, trackId: '4bN5W5QhC8j34V0g8pE6mF' }
    );
    assert(failListen.status === 500 && failListen.body?.success === false, 'listen returns 500 on Firestore write failure');

    const failCurrent = await simulateRequest(
      'POST',
      '/api/routines/current-routine',
      { Authorization: 'Bearer tok_student_a' },
      { studentUid: STUDENT_A_UID, weekId: 'week-3', currentSpotifyTrack: { id: 'x', title: 'X', artist: 'Y', coverUrl: '', dayOfWeek: 'friday' } }
    );
    assert(failCurrent.status === 500 && failCurrent.body?.success === false, 'current-routine returns 500 on Firestore write failure');

    const failOverride = await simulateRequest(
      'POST',
      '/api/routines/override-track',
      { Authorization: 'Bearer tok_teacher_linked_no_claim' },
      { studentUid: STUDENT_A_UID, dayOfWeek: 'friday', teacherOverrideTrack: { url: 'https://open.spotify.com/track/4bN5W5QhC8j34V0g8pE6mF' } }
    );
    assert(failOverride.status === 500 && failOverride.body?.success === false, 'override-track returns 500 on Firestore write failure');
  } finally {
    mockDb.failWriteMatcher = null;
  }

  // =========================================================================
  // CENÁRIO 9: Ciclos antigos não sobrescrevem o ciclo ativo (409 STALE_CYCLE)
  // =========================================================================
  console.log('\n--- Cenário 9: Bloqueio de ciclos antigos (409 STALE_CYCLE) ---');
  const staleAssign = await simulateRequest(
    'POST',
    '/api/student-spotify-assignments/assign',
    { Authorization: 'Bearer tok_teacher_linked_no_claim' },
    { studentUid: STUDENT_A_UID, day: 'monday', weeklyCycle: 1, forceNewTrack: true }
  );
  assert(staleAssign.status === 409 && staleAssign.body?.error === 'STALE_CYCLE', 'Stale weeklyCycle=1 rejected with 409 STALE_CYCLE on assign');

  const staleDist = await simulateRequest(
    'POST',
    '/api/student-spotify-assignments/distribute-week',
    { Authorization: 'Bearer tok_teacher_linked_no_claim' },
    { studentUid: STUDENT_A_UID, weeklyCycle: 2, forceRedistribute: true }
  );
  assert(staleDist.status === 409 && staleDist.body?.error === 'STALE_CYCLE', 'Stale weeklyCycle=2 rejected with 409 STALE_CYCLE on distribute-week');

  const staleCurrent = await simulateRequest(
    'POST',
    '/api/routines/current-routine',
    { Authorization: 'Bearer tok_student_a' },
    {
      studentUid: STUDENT_A_UID,
      weekId: 'week-1',
      currentSpotifyTrack: { id: 'staleTrack', title: 'Stale', artist: 'X', coverUrl: '', dayOfWeek: 'monday' },
    }
  );
  assert(staleCurrent.status === 409 && staleCurrent.body?.error === 'STALE_CYCLE', 'Stale weekId=week-1 rejected with 409 STALE_CYCLE on current-routine');

  const staleFeedback = await simulateRequest(
    'POST',
    '/api/routines/current-routine/feedback',
    { Authorization: 'Bearer tok_teacher_linked_no_claim' },
    {
      studentUid: STUDENT_A_UID,
      weekId: 'week-2',
      feedback: { dayOfWeek: 'monday', trackId: 'x', comment: 'stale' },
    }
  );
  assert(staleFeedback.status === 409 && staleFeedback.body?.error === 'STALE_CYCLE', 'Stale weekId=week-2 rejected with 409 STALE_CYCLE on feedback');

  const staleOverride = await simulateRequest(
    'POST',
    '/api/routines/override-track',
    { Authorization: 'Bearer tok_teacher_linked_no_claim' },
    {
      studentUid: STUDENT_A_UID,
      dayOfWeek: 'monday',
      weeklyCycle: 1,
      teacherOverrideTrack: { url: 'https://open.spotify.com/track/4bN5W5QhC8j34V0g8pE6mF' },
    }
  );
  assert(staleOverride.status === 409 && staleOverride.body?.error === 'STALE_CYCLE', 'Stale weeklyCycle=1 rejected with 409 STALE_CYCLE on override-track');

  // Verify active Cycle 3 track remained untouched after all stale rejections
  const afterStaleCurr = await simulateRequest(
    'GET',
    `/api/routines/current-routine?studentUid=${encodeURIComponent(STUDENT_A_UID)}&weekId=week-3`,
    { Authorization: 'Bearer tok_student_a' }
  );
  assert(
    afterStaleCurr.body?.routine?.currentSpotifyTrack?.id === mondayAssignedTrackId,
    'Active Cycle 3 track untouched after stale cycle attempts'
  );

  // =========================================================================
  // CENÁRIO 10: Funcionalidades de vídeo ARCH.2E.2A e ocultação UI-NF.1 intactas
  // =========================================================================
  console.log('\n--- Cenário 10: Integridade ARCH.2E.2A (vídeos) e SHOW_SPOTIFY_AUDIO_ASSIGNMENT ---');
  assert(SHOW_SPOTIFY_AUDIO_ASSIGNMENT === false, 'SHOW_SPOTIFY_AUDIO_ASSIGNMENT remains false');

  const videoAssign = await simulateRequest(
    'POST',
    '/api/student-video-assignments/assign',
    { Authorization: 'Bearer tok_teacher_linked_no_claim' },
    {
      studentUid: STUDENT_A_UID,
      day: 'monday',
      playlistId: 'PLUj52KVM_CdY',
      videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      idempotencyKey: 'vid-check-2b',
    }
  );
  assert(videoAssign.status === 200 && videoAssign.body?.success === true, 'ARCH.2E.2A video assign still works on Cycle 3');

  const dailyVidRes = await simulateRequest(
    'GET',
    `/api/routines/daily-video?studentUid=${encodeURIComponent(STUDENT_A_UID)}`,
    { Authorization: 'Bearer tok_student_a' }
  );
  assert(
    dailyVidRes.status === 200 && dailyVidRes.body?.routinesByDay?.monday?.videoId === 'dQw4w9WgXcQ',
    'ARCH.2E.2A GET /api/routines/daily-video returns persisted video alongside Spotify state'
  );

  const combinedRoutines = await simulateRequest(
    'GET',
    `/api/student-routines?uid=${encodeURIComponent(STUDENT_A_UID)}`,
    { Authorization: 'Bearer tok_student_a' }
  );
  const monVideoSlot = combinedRoutines.body?.monday?.[0];
  const monAudioAfterVideo =
    combinedRoutines.body?.monday?.find((i: any) => i?.teacherSpotify) || combinedRoutines.body?.monday?.[0];
  assert(
    monVideoSlot?.teacherVideos?.[0]?.videoId === 'dQw4w9WgXcQ' &&
      monAudioAfterVideo?.teacherSpotify?.url?.includes(mondayAssignedTrackId),
    'GET /api/student-routines preserves both video and audio data simultaneously'
  );

  console.log('\n================================================================================');
  console.log(` RESULTADO ARCH.2E.2B: ${passed} PASSOU | ${failed} FALHOU`);
  console.log('================================================================================');
  } finally {
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
}

runTests().catch((err) => {
  console.error('Fatal test failure:', err);
  process.exit(1);
});
