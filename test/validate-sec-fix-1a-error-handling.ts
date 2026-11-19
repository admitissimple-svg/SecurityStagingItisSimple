/**
 * SEC.FIX.1A — Error Handling & Compatibility Validation Suite
 *
 * Validates structured HTTP 500 / 503 error responses on Firestore failures
 * while preserving success flows for:
 * - POST /api/session-notes/reminder/claim
 * - POST /api/student-dictionary
 */

process.env.NODE_ENV = 'test';
process.env.FIREBASE_PROJECT_ID = 'itissimple-security-staging';
process.env.FIREBASE_DATABASE_ID = '(default)';

import http from 'http';
import { setFirebaseAdminAuthForTesting } from '../src/serverFirebaseAdmin';
import {
  setFirebaseAdminFirestoreForTesting,
  resetFirebaseAdminFirestoreForTesting,
  setIsCloudWriteDisabled,
} from '../src/serverFirestore';
import { app as serverApp } from '../serverApp';

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

class MockDocRef {
  public id: string;
  public path: string;
  constructor(private col: MockCollection, id: string) {
    this.id = id;
    this.path = `${col.collectionPath}/${id}`;
  }

  async get() {
    this.col.db.maybeFailRead(this.path);
    const data = this.col.docs.get(this.id);
    return {
      exists: Boolean(data),
      id: this.id,
      ref: this,
      data: () => (data ? deepClone(data) : undefined),
    };
  }

  async set(data: any, options?: { merge?: boolean }) {
    this.col.db.maybeFailWrite(this.path);
    const existing = this.col.docs.get(this.id) || {};
    const merged = options?.merge ? deepMergeObjects(existing, data) : deepClone(data);
    this.col.docs.set(this.id, merged);
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

class MockCollection {
  public docs: Map<string, any> = new Map();
  public subcollections: Map<string, Map<string, MockCollection>> = new Map();

  constructor(public collectionPath: string, public db: MockFirestoreDb) {}

  doc(id: string): MockDocRef {
    return new MockDocRef(this, id);
  }

  where(field: string, _op: string, value: any) {
    const col = this;
    return {
      limit: () => ({
        get: async () => col.filterDocs(field, value),
      }),
      get: async () => col.filterDocs(field, value),
    };
  }

  async get() {
    this.db.maybeFailRead(this.collectionPath);
    const matched = Array.from(this.docs.entries()).map(([id, data]) => ({
      id,
      exists: true,
      ref: this.doc(id),
      data: () => deepClone(data),
    }));
    return {
      empty: matched.length === 0,
      size: matched.length,
      docs: matched,
      forEach: (cb: (d: any) => void) => matched.forEach(cb),
    };
  }

  private filterDocs(field: string, value: any) {
    this.db.maybeFailRead(this.collectionPath);
    const matched: any[] = [];
    for (const [id, data] of this.docs.entries()) {
      if (data?.[field] === value) {
        matched.push({
          id,
          exists: true,
          ref: this.doc(id),
          data: () => deepClone(data),
        });
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

class MockFirestoreDb {
  private collections: Map<string, MockCollection> = new Map();
  public failWriteError: ((path: string) => Error | null) | null = null;
  public failReadError: ((path: string) => Error | null) | null = null;
  public failTxError: (() => Error | null) | null = null;

  collection(name: string): MockCollection {
    if (!this.collections.has(name)) {
      this.collections.set(name, new MockCollection(name, this));
    }
    return this.collections.get(name)!;
  }

  maybeFailWrite(path: string) {
    if (this.failWriteError) {
      const err = this.failWriteError(path);
      if (err) throw err;
    }
  }

  maybeFailRead(path: string) {
    if (this.failReadError) {
      const err = this.failReadError(path);
      if (err) throw err;
    }
  }

  async runTransaction<T>(fn: (tx: any) => Promise<T>): Promise<T> {
    if (this.failTxError) {
      const err = this.failTxError();
      if (err) throw err;
    }
    const pendingWrites: Array<() => Promise<any>> = [];
    const tx = {
      get: async (ref: MockDocRef) => ref.get(),
      set: (ref: MockDocRef, data: any, options?: { merge?: boolean }) => {
        pendingWrites.push(() => ref.set(data, options));
        return tx;
      },
    };
    const result = await fn(tx);
    for (const writeOp of pendingWrites) {
      await writeOp();
    }
    return result;
  }
}

async function makeRequest(
  server: http.Server,
  method: string,
  reqPath: string,
  body?: any,
  headers: Record<string, string> = {}
): Promise<{ status: number; data: any }> {
  const addr = server.address() as any;
  const payload = body !== undefined ? JSON.stringify(body) : undefined;
  return new Promise((resolve, reject) => {
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

async function runTests() {
  console.log('======================================================================');
  console.log('SEC.FIX.1A — ERROR HANDLING & COMPATIBILITY VALIDATION');
  console.log('======================================================================\n');

  const STUDENT_UID = 'SecFix1A_StudentUid1234567890';
  const STUDENT_EMAIL = 'secfix1a.student@example.com';

  const mockDb = new MockFirestoreDb();
  await mockDb.collection('users').doc(STUDENT_UID).set({
    uid: STUDENT_UID,
    email: STUDENT_EMAIL,
    role: 'student',
    name: 'SecFix Student',
    excludedDictionaryWords: ['resilient'],
  });

  setFirebaseAdminFirestoreForTesting(mockDb as any);
  setFirebaseAdminAuthForTesting({
    verifyIdToken: async (token: string) => {
      if (token === 'tok_student') {
        return { uid: STUDENT_UID, email: STUDENT_EMAIL, role: 'student' } as any;
      }
      throw new Error('Invalid token');
    },
    getUser: async (uid: string) => ({ uid, email: STUDENT_EMAIL }),
    getUserByEmail: async (email: string) => ({ uid: STUDENT_UID, email }),
  } as any);

  const server = http.createServer(serverApp);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    // ------------------------------------------------------------------------
    // 1. POST /api/session-notes/reminder/claim
    // ------------------------------------------------------------------------
    console.log('--- 1. POST /api/session-notes/reminder/claim ---');

    // 1.1 Success flow preserved
    const claimOk1 = await makeRequest(
      server,
      'POST',
      '/api/session-notes/reminder/claim',
      { studentUid: STUDENT_UID, studentEmail: STUDENT_EMAIL, dateStr: '2026-11-19', timeZone: 'America/Sao_Paulo' },
      { Authorization: 'Bearer tok_student' }
    );
    assert(
      claimOk1.status === 200 &&
        claimOk1.data?.success === true &&
        claimOk1.data?.canShow === true &&
        claimOk1.data?.alreadyShown === false &&
        claimOk1.data?.lastReminderShownDate === '2026-11-19',
      '1.1 Reminder claim success flow preserved (200, canShow=true)',
      `status=${claimOk1.status} data=${JSON.stringify(claimOk1.data)}`
    );

    const claimOk2 = await makeRequest(
      server,
      'POST',
      '/api/session-notes/reminder/claim',
      { studentUid: STUDENT_UID, studentEmail: STUDENT_EMAIL, dateStr: '2026-11-19', timeZone: 'America/Sao_Paulo' },
      { Authorization: 'Bearer tok_student' }
    );
    assert(
      claimOk2.status === 200 &&
        claimOk2.data?.success === true &&
        claimOk2.data?.canShow === false &&
        claimOk2.data?.alreadyShown === true,
      '1.2 Reminder claim idempotency preserved (200, alreadyShown=true)',
      `status=${claimOk2.status} data=${JSON.stringify(claimOk2.data)}`
    );

    // 1.3 Firestore write/transaction failure -> HTTP 500 structured
    mockDb.failTxError = () => new Error('Simulated Firestore transaction failure');
    const claimErr500 = await makeRequest(
      server,
      'POST',
      '/api/session-notes/reminder/claim',
      { studentUid: STUDENT_UID, studentEmail: STUDENT_EMAIL, dateStr: '2026-11-20', timeZone: 'America/Sao_Paulo' },
      { Authorization: 'Bearer tok_student' }
    );
    mockDb.failTxError = null;
    assert(
      claimErr500.status === 500 &&
        claimErr500.data?.success === false &&
        claimErr500.data?.code === 'FIRESTORE_SAVE_FAILED' &&
        claimErr500.data?.error === 'FIRESTORE_SAVE_FAILED' &&
        Boolean(claimErr500.data?.message),
      '1.3 Reminder claim Firestore write/tx failure returns structured HTTP 500',
      `status=${claimErr500.status} data=${JSON.stringify(claimErr500.data)}`
    );

    // 1.4 Firestore gRPC UNAVAILABLE error -> HTTP 503 structured
    mockDb.failTxError = () => Object.assign(new Error('14 UNAVAILABLE: Connection reset'), { code: 14 });
    const claimErr503Grpc = await makeRequest(
      server,
      'POST',
      '/api/session-notes/reminder/claim',
      { studentUid: STUDENT_UID, studentEmail: STUDENT_EMAIL, dateStr: '2026-11-20', timeZone: 'America/Sao_Paulo' },
      { Authorization: 'Bearer tok_student' }
    );
    mockDb.failTxError = null;
    assert(
      claimErr503Grpc.status === 503 &&
        claimErr503Grpc.data?.success === false &&
        claimErr503Grpc.data?.code === 'FIRESTORE_UNAVAILABLE' &&
        claimErr503Grpc.data?.error === 'FirestoreUnavailable',
      '1.4 Reminder claim Firestore gRPC UNAVAILABLE returns structured HTTP 503',
      `status=${claimErr503Grpc.status} data=${JSON.stringify(claimErr503Grpc.data)}`
    );

    // 1.5 Cloud writes disabled -> HTTP 503 structured
    setIsCloudWriteDisabled(true);
    const claimErr503Disabled = await makeRequest(
      server,
      'POST',
      '/api/session-notes/reminder/claim',
      { studentUid: STUDENT_UID, studentEmail: STUDENT_EMAIL, dateStr: '2026-11-20', timeZone: 'America/Sao_Paulo' },
      { Authorization: 'Bearer tok_student' }
    );
    setIsCloudWriteDisabled(false);
    assert(
      claimErr503Disabled.status === 503 &&
        claimErr503Disabled.data?.success === false &&
        claimErr503Disabled.data?.code === 'FIRESTORE_UNAVAILABLE' &&
        claimErr503Disabled.data?.error === 'FirestoreUnavailable',
      '1.5 Reminder claim with cloud writes disabled returns structured HTTP 503',
      `status=${claimErr503Disabled.status} data=${JSON.stringify(claimErr503Disabled.data)}`
    );

    // ------------------------------------------------------------------------
    // 2. POST /api/student-dictionary
    // ------------------------------------------------------------------------
    console.log('\n--- 2. POST /api/student-dictionary ---');

    // 2.1 Success flow (manual add reintroducing previously excluded word)
    const dictOkManual = await makeRequest(
      server,
      'POST',
      '/api/student-dictionary',
      {
        studentUid: STUDENT_UID,
        studentEmail: STUDENT_EMAIL,
        isAutomaticSync: false,
        entry: { word: 'resilient', definitionEn: 'Able to recover quickly from difficulties.' },
      },
      { Authorization: 'Bearer tok_student' }
    );
    assert(
      dictOkManual.status === 200 &&
        dictOkManual.data?.success === true &&
        Array.isArray(dictOkManual.data?.dictionary) &&
        dictOkManual.data.dictionary.some((e: any) => e.normalizedWord === 'resilient') &&
        !(dictOkManual.data?.excludedWords || []).includes('resilient'),
      '2.1 Dictionary manual POST success flow preserved (200, word added & tombstone removed)',
      `status=${dictOkManual.status} data=${JSON.stringify(dictOkManual.data)}`
    );

    // 2.2 Failure during removeExcludedDictionaryWordsServer (tombstone removal) -> HTTP 500 structured
    mockDb.failWriteError = (p: string) =>
      p === `users/${STUDENT_UID}` ? new Error('Simulated Firestore tombstone write failure') : null;
    const dictTombstoneErr500 = await makeRequest(
      server,
      'POST',
      '/api/student-dictionary',
      {
        studentUid: STUDENT_UID,
        studentEmail: STUDENT_EMAIL,
        isAutomaticSync: false,
        entry: { word: 'breakthrough', definitionEn: 'A sudden important discovery.' },
      },
      { Authorization: 'Bearer tok_student' }
    );
    mockDb.failWriteError = null;
    assert(
      dictTombstoneErr500.status === 500 &&
        dictTombstoneErr500.data?.success === false &&
        dictTombstoneErr500.data?.code === 'FIRESTORE_SAVE_FAILED' &&
        dictTombstoneErr500.data?.error === 'Internal Server Error' &&
        Boolean(dictTombstoneErr500.data?.message),
      '2.2 Dictionary tombstone removal Firestore failure returns structured HTTP 500',
      `status=${dictTombstoneErr500.status} data=${JSON.stringify(dictTombstoneErr500.data)}`
    );

    // 2.3 Failure during saveStudentVocabularyToFirestoreServer -> HTTP 500 structured
    mockDb.failWriteError = (p: string) =>
      p.includes('/vocabulary/') ? new Error('Simulated Firestore subcollection write failure') : null;
    const dictSaveErr500 = await makeRequest(
      server,
      'POST',
      '/api/student-dictionary',
      {
        studentUid: STUDENT_UID,
        studentEmail: STUDENT_EMAIL,
        isAutomaticSync: true,
        entries: [{ word: 'leverage', definitionEn: 'Use something to maximum advantage.' }],
      },
      { Authorization: 'Bearer tok_student' }
    );
    mockDb.failWriteError = null;
    assert(
      dictSaveErr500.status === 500 &&
        dictSaveErr500.data?.success === false &&
        dictSaveErr500.data?.code === 'FIRESTORE_SAVE_FAILED' &&
        dictSaveErr500.data?.error === 'Internal Server Error' &&
        Boolean(dictSaveErr500.data?.message),
      '2.3 Dictionary vocabulary subcollection write failure returns structured HTTP 500',
      `status=${dictSaveErr500.status} data=${JSON.stringify(dictSaveErr500.data)}`
    );

    // 2.4 Firestore gRPC UNAVAILABLE error -> HTTP 503 structured
    mockDb.failWriteError = () => Object.assign(new Error('14 UNAVAILABLE: Firestore unreachable'), { code: 14 });
    const dictErr503Grpc = await makeRequest(
      server,
      'POST',
      '/api/student-dictionary',
      {
        studentUid: STUDENT_UID,
        studentEmail: STUDENT_EMAIL,
        isAutomaticSync: true,
        entries: [{ word: 'momentum', definitionEn: 'Strength or force gained by motion.' }],
      },
      { Authorization: 'Bearer tok_student' }
    );
    mockDb.failWriteError = null;
    assert(
      dictErr503Grpc.status === 503 &&
        dictErr503Grpc.data?.success === false &&
        dictErr503Grpc.data?.code === 'FIRESTORE_UNAVAILABLE' &&
        dictErr503Grpc.data?.error === 'FirestoreUnavailable',
      '2.4 Dictionary Firestore gRPC UNAVAILABLE returns structured HTTP 503',
      `status=${dictErr503Grpc.status} data=${JSON.stringify(dictErr503Grpc.data)}`
    );

    // 2.5 Cloud writes disabled -> HTTP 503 structured
    setIsCloudWriteDisabled(true);
    const dictErr503Disabled = await makeRequest(
      server,
      'POST',
      '/api/student-dictionary',
      {
        studentUid: STUDENT_UID,
        studentEmail: STUDENT_EMAIL,
        isAutomaticSync: false,
        entry: { word: 'clarity', definitionEn: 'Quality of being clear.' },
      },
      { Authorization: 'Bearer tok_student' }
    );
    setIsCloudWriteDisabled(false);
    assert(
      dictErr503Disabled.status === 503 &&
        dictErr503Disabled.data?.success === false &&
        dictErr503Disabled.data?.code === 'FIRESTORE_UNAVAILABLE' &&
        dictErr503Disabled.data?.error === 'FirestoreUnavailable',
      '2.5 Dictionary POST with cloud writes disabled returns structured HTTP 503',
      `status=${dictErr503Disabled.status} data=${JSON.stringify(dictErr503Disabled.data)}`
    );

    // 2.6 Firestore instance completely null -> HTTP 503 structured on both endpoints
    resetFirebaseAdminFirestoreForTesting();
    process.env.FIREBASE_PROJECT_ID = '';

    const claimNullDb = await makeRequest(
      server,
      'POST',
      '/api/session-notes/reminder/claim',
      { studentUid: STUDENT_UID, dateStr: '2026-11-21' },
      { Authorization: 'Bearer tok_student' }
    );
    assert(
      claimNullDb.status === 503 &&
        claimNullDb.data?.success === false &&
        claimNullDb.data?.code === 'FIRESTORE_UNAVAILABLE' &&
        claimNullDb.data?.error === 'FirestoreUnavailable',
      '2.6 Reminder claim with null Firestore returns structured HTTP 503',
      `status=${claimNullDb.status} data=${JSON.stringify(claimNullDb.data)}`
    );

    const dictNullDb = await makeRequest(
      server,
      'POST',
      '/api/student-dictionary',
      {
        studentUid: STUDENT_UID,
        isAutomaticSync: true,
        entries: [{ word: 'focus', definitionEn: 'Center of interest or activity.' }],
      },
      { Authorization: 'Bearer tok_student' }
    );
    assert(
      dictNullDb.status === 503 &&
        dictNullDb.data?.success === false &&
        dictNullDb.data?.code === 'FIRESTORE_UNAVAILABLE' &&
        dictNullDb.data?.error === 'FirestoreUnavailable',
      '2.7 Dictionary POST with null Firestore returns structured HTTP 503',
      `status=${dictNullDb.status} data=${JSON.stringify(dictNullDb.data)}`
    );
  } finally {
    setIsCloudWriteDisabled(false);
    resetFirebaseAdminFirestoreForTesting();
    server.close();
  }

  console.log('\n======================================================================');
  console.log(`SEC.FIX.1A SUMMARY: ${passed} passed, ${failed} failed`);
  console.log('======================================================================');
  if (failed > 0) process.exit(1);
}

runTests().catch((err) => {
  console.error('Fatal error running SEC.FIX.1A validation:', err);
  process.exit(1);
});
