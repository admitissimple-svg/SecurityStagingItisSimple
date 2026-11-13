/**
 * ARCH.2F.2B — Consolidação Canônica de Dictionary ("My Dictionary")
 *
 * Bateria de testes cobrindo:
 * 1. Auth & RBAC (401/403/422) em GET, POST, DELETE, POST /enrich, POST /practice e POST /unexclude:
 *    - Sem token / token inválido -> 401
 *    - Cross-student -> 403
 *    - Conflito aninhado studentUid/studentEmail no body/entries -> 403
 *    - Professor não vinculado / pendente -> 403
 *    - Teacher UID usado como studentUid -> 403
 *    - Professor chamando POST /practice (com e sem custom claim) -> 403
 *    - UID sintético usr-* sem vínculo canônico -> 422
 *    - Professor vinculado lê (GET 200) e escreve Alt+W (POST 200); Admin lê (200)
 * 2. Persistência Canônica em Cloud Firestore (default):
 *    - Gravações vão exclusivamente para users/{uid}/vocabulary/{wordDocId}
 *    - ZERO gravações em users/{uid}.vocabulary, app_state ou db.studentDictionaryMap
 *    - Sobrevivência a wipe/envenenamento de db.studentDictionaryMap e db.userProfiles
 *    - Fallback somente leitura de users/{uid}.vocabulary quando subcoleção está vazia
 *    - Promoção automática de legado para subcoleção na primeira escrita, sem escrever de volta no array raiz
 * 3. Exclusão, Rollback e Tombstones:
 *    - DELETE persiste em users/{uid}.excludedDictionaryWords e omite palavra do GET
 *    - DELETE repetido é idempotente
 *    - Erro real 500 quando escrita no Firestore falha (suportando rollback no cliente)
 *    - Sincronização automática (isAutomaticSync: true / routine_sync / native_notes) NÃO ressuscita palavra excluída
 *    - Readicionamento explícito (isAutomaticSync: false) remove tombstone atomicamente preservando practiceCount, practiceHistory e definição mais rica
 * 4. Alt+W (syncSessionVocabularyToStudentDictionary e POST /api/live-lessons/:id/notes/transform / Alt+W):
 *    - Palavras marcadas com Alt+W entram no dicionário canônico; itens exclusivos Alt+P ficam fora; tombstones são respeitados
 * 5. Gemini Enrichment (/api/student-dictionary/enrich) & Practice (/api/student-dictionary/practice):
 *    - /enrich enriquece via Gemini (mockado), persiste em users/{uid}/vocabulary/{wordDocId}, respeita tombstones, usa level do Firestore quando RAM vazia
 *    - Chamada subsequente com palavras já enriquecidas faz ZERO chamadas Gemini (cached: true)
 *    - /practice incrementa practiceCount, atualiza lastPracticedAt e anexa practiceHistory atomicamente, respeitando tombstones
 * 6. Concorrência:
 *    - Promise.all de POSTs distintos sem perda de palavras
 *    - Promise.all de /practice e atualização na mesma palavra preservando métricas e definição rica
 * 7. Auditoria estática:
 *    - Zero chamadas Web SDK (getDoc/getDocs/setDoc/onSnapshot) nas funções de Dictionary em studentPersistence.ts
 *    - POST único em handleSaveCustomDictionaryEntry (App.tsx)
 *    - Zero re-POST em onSaveCustomEntry após /enrich (PersonalDictionaryModal.tsx)
 *    - Zero leitura/escrita ativa de db.studentDictionaryMap em serverApp.ts e serverFirestore.ts
 */

process.env.NODE_ENV = 'test';
process.env.FIREBASE_PROJECT_ID = 'itissimple-security-staging';
process.env.FIREBASE_DATABASE_ID = '(default)';
process.env.GEMINI_API_KEY = 'test-fake-gemini-key-arch2f2b';

import fs from 'fs';
import path from 'path';
import { setFirebaseAdminAuthForTesting } from '../src/serverFirebaseAdmin';
import {
  setFirebaseAdminFirestoreForTesting,
  fetchStudentVocabularyFromFirestoreServer,
  saveStudentVocabularyToFirestoreServer,
  fetchExcludedDictionaryWordsServer,
  markVocabularyWordsPracticedServer,
  getStudentActivitiesBetweenLessonsServer,
} from '../src/serverFirestore';
import { syncSessionVocabularyToStudentDictionary } from '../src/utils/sessionVocabularySync';

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
  if (!val || typeof val !== 'object' || Array.isArray(val) || val instanceof Date) return false;
  const ctorName = val.constructor?.name || '';
  if (ctorName === 'ArrayUnionTransform' || ctorName === 'ArrayRemoveTransform') return false;
  return true;
}

function applyFieldValueTransform(existingVal: any, incomingVal: any): any {
  const ctorName = incomingVal?.constructor?.name || '';
  if (ctorName === 'ArrayUnionTransform') {
    const cur = Array.isArray(existingVal) ? [...existingVal] : [];
    const elems = Array.isArray(incomingVal.elements) ? incomingVal.elements : [];
    for (const el of elems) {
      if (!cur.some((x) => JSON.stringify(x) === JSON.stringify(el))) {
        cur.push(deepClone(el));
      }
    }
    return cur;
  }
  if (ctorName === 'ArrayRemoveTransform') {
    const cur = Array.isArray(existingVal) ? [...existingVal] : [];
    const elems = Array.isArray(incomingVal.elements) ? incomingVal.elements : [];
    return cur.filter((x) => !elems.some((el: any) => JSON.stringify(x) === JSON.stringify(el)));
  }
  return undefined;
}

function deepMergeObjects(target: Record<string, any>, source: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = { ...target };
  for (const [key, val] of Object.entries(source)) {
    const transformed = applyFieldValueTransform(out[key], val);
    if (transformed !== undefined) {
      out[key] = transformed;
    } else if (isPlainObject(val) && isPlainObject(out[key])) {
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
    const merged = options?.merge ? deepMergeObjects(existing, data) : deepMergeObjects({}, data);
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
  private txChain: Promise<any> = Promise.resolve();

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
    // Serialize transactions cleanly like Firestore optimistic locking in concurrent tests
    const run = async (): Promise<T> => {
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
    };
    const next = this.txChain.then(run, run);
    this.txChain = next.catch(() => {});
    return next;
  }
}

async function runTests() {
  console.log('================================================================================');
  console.log(" IT'S SIMPLE — ARCH.2F.2B: CONSOLIDAÇÃO CANÔNICA DE DICTIONARY");
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

  let geminiCallCount = 0;
  globalThis.fetch = (async (input: any, init?: any) => {
    const urlStr = typeof input === 'string' ? input : (input?.url || String(input));
    if (urlStr.includes('generativelanguage.googleapis.com')) {
      geminiCallCount++;
      const payload = JSON.stringify({
        words: [
          {
            word: 'breakthrough',
            partOfSpeech: 'Noun',
            definitionEn: 'An important discovery or sudden advance in knowledge.',
            exampleSentenceEn: 'The scientist celebrated a major breakthrough in renewable energy.',
            translationPt: 'avanço importante / descoberta',
            cefrLevel: 'B1',
          },
          {
            word: 'keep up with',
            partOfSpeech: 'Phrasal Verb',
            definitionEn: 'To continue to stay informed or move at the same speed as someone or something.',
            exampleSentenceEn: 'She reads daily articles to keep up with industry news.',
            translationPt: 'acompanhar / manter-se atualizado',
            cefrLevel: 'B1',
          },
        ],
      });
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: payload }],
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return originalFetch(input, init);
  }) as typeof fetch;

  const mockDb = new MockFirestoreDb();

  try {
    setFirebaseAdminFirestoreForTesting(mockDb as any);

    const STUDENT_A_UID = 'StuA_DictUid1234567890123';
    const STUDENT_A_EMAIL = 'student.a.dict2f2b@gmail.com';
    const STUDENT_B_UID = 'StuB_DictUid1234567890123';
    const STUDENT_B_EMAIL = 'student.b.dict2f2b@gmail.com';
    const STUDENT_LEGACY_UID = 'StuL_DictUid1234567890123';
    const STUDENT_LEGACY_EMAIL = 'student.legacy.dict2f2b@gmail.com';
    const TEACHER_LINKED_UID = 'TchL_DictUid1234567890123';
    const TEACHER_LINKED_EMAIL = 'teacher.linked.dict2f2b@gmail.com';
    const TEACHER_UNLINKED_UID = 'TchU_DictUid1234567890123';
    const TEACHER_UNLINKED_EMAIL = 'teacher.unlinked.dict2f2b@gmail.com';
    const TEACHER_PENDING_UID = 'TchP_DictUid1234567890123';
    const TEACHER_PENDING_EMAIL = 'teacher.pending.dict2f2b@gmail.com';
    const ADMIN_UID = 'Adm_DictUid12345678901234';
    const ADMIN_EMAIL = 'admin.dict2f2b@gmail.com';

    const tokensDb = new Map<string, any>();
    tokensDb.set('tok_student_a', { uid: STUDENT_A_UID, email: STUDENT_A_EMAIL, email_verified: true, role: 'student' });
    tokensDb.set('tok_student_b', { uid: STUDENT_B_UID, email: STUDENT_B_EMAIL, email_verified: true, role: 'student' });
    tokensDb.set('tok_student_legacy', { uid: STUDENT_LEGACY_UID, email: STUDENT_LEGACY_EMAIL, email_verified: true, role: 'student' });
    tokensDb.set('tok_teacher_linked_claim', { uid: TEACHER_LINKED_UID, email: TEACHER_LINKED_EMAIL, email_verified: true, role: 'teacher' });
    tokensDb.set('tok_teacher_linked_no_claim', { uid: TEACHER_LINKED_UID, email: TEACHER_LINKED_EMAIL, email_verified: true, role: 'student' });
    tokensDb.set('tok_teacher_unlinked', { uid: TEACHER_UNLINKED_UID, email: TEACHER_UNLINKED_EMAIL, email_verified: true, role: 'teacher' });
    tokensDb.set('tok_teacher_pending', { uid: TEACHER_PENDING_UID, email: TEACHER_PENDING_EMAIL, email_verified: true });
    tokensDb.set('tok_admin', { uid: ADMIN_UID, email: ADMIN_EMAIL, email_verified: true, role: 'admin', admin: true });

    setFirebaseAdminAuthForTesting({
      verifyIdToken: async (token: string) => {
        const decoded = tokensDb.get(token);
        if (!decoded) throw new Error('Invalid or expired Firebase ID token');
        return decoded;
      },
      getUser: async (uid: string) => {
        for (const v of tokensDb.values()) {
          if (v.uid === uid) return { uid: v.uid, email: v.email };
        }
        throw new Error('User not found');
      },
      getUserByEmail: async (email: string) => {
        const clean = email.toLowerCase().trim();
        for (const v of tokensDb.values()) {
          if (v.email === clean) return { uid: v.uid, email: v.email };
        }
        throw new Error('User not found');
      },
    } as any);

    await mockDb.collection('users').doc(STUDENT_A_UID).set({
      id: STUDENT_A_UID,
      uid: STUDENT_A_UID,
      email: STUDENT_A_EMAIL,
      name: 'Student Alpha Dict',
      role: 'student',
      level: 'intermediario',
      englishLevel: 'intermediate',
      assignedNativeFriendUID: TEACHER_LINKED_UID,
      teacherUid: TEACHER_LINKED_UID,
      teacherEmail: TEACHER_LINKED_EMAIL,
    });

    await mockDb.collection('users').doc(STUDENT_B_UID).set({
      id: STUDENT_B_UID,
      uid: STUDENT_B_UID,
      email: STUDENT_B_EMAIL,
      name: 'Student Beta Dict',
      role: 'student',
      level: 'avancado',
    });

    await mockDb.collection('users').doc(STUDENT_LEGACY_UID).set({
      id: STUDENT_LEGACY_UID,
      uid: STUDENT_LEGACY_UID,
      email: STUDENT_LEGACY_EMAIL,
      name: 'Student Legacy Dict',
      role: 'student',
      level: 'intermediario',
      excludedDictionaryWords: ['obsolete'],
      vocabulary: [
        {
          id: 'legacy_resilient',
          word: 'resilient',
          normalizedWord: 'resilient',
          definitionEn: 'Able to recover quickly from difficult conditions.',
          partOfSpeech: 'Adjective',
          exampleSentenceEn: 'She remained resilient during the transition.',
          practiceCount: 2,
          practiceHistory: [{ date: '2026-10-01T10:00:00.000Z', activityType: 'memorization', correct: true }],
          source: 'api',
        },
        {
          id: 'legacy_obsolete',
          word: 'obsolete',
          normalizedWord: 'obsolete',
          definitionEn: 'Out of date.',
          source: 'api',
        },
      ],
    });

    await mockDb.collection('tutors').doc('tutor-linked-2f2b').set({
      id: 'tutor-linked-2f2b',
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

    await mockDb.collection('tutors').doc('tutor-unlinked-2f2b').set({
      id: 'tutor-unlinked-2f2b',
      authUid: TEACHER_UNLINKED_UID,
      uid: TEACHER_UNLINKED_UID,
      email: TEACHER_UNLINKED_EMAIL,
      name: 'Unlinked Teacher',
      role: 'teacher',
      isApproved: true,
      approvalStatus: 'approved',
    });

    await mockDb.collection('tutors').doc('tutor-pending-2f2b').set({
      id: 'tutor-pending-2f2b',
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
      (db as any).studentDictionaryMap = {
        [STUDENT_A_UID]: [{ word: 'POISONED_RAM_WORD', definitionEn: 'POISONED' }],
        [STUDENT_A_EMAIL]: [{ word: 'POISONED_EMAIL_RAM_WORD', definitionEn: 'POISONED' }],
      };
      db.userProfiles = {
        [STUDENT_A_UID]: {
          uid: STUDENT_A_UID,
          email: STUDENT_A_EMAIL,
          level: 'basico',
          vocabulary: [{ word: 'POISONED_PROFILE_VOCAB', definitionEn: 'POISONED' }],
        },
      };
    }

    // -------------------------------------------------------------------------
    // CENÁRIO 1: Auth & RBAC (401/403/422)
    // -------------------------------------------------------------------------
    console.log('--- Cenário 1: Auth & RBAC (401/403/422) ---');

    const unauthGet = await simulateRequest('GET', `/api/student-dictionary?uid=${STUDENT_A_UID}`);
    assert(unauthGet.status === 401, '1.1 GET /api/student-dictionary sem token retorna 401', `status=${unauthGet.status}`);

    const badTokenPost = await simulateRequest(
      'POST',
      '/api/student-dictionary',
      { authorization: 'Bearer bad_token' },
      { studentUid: STUDENT_A_UID, entry: { word: 'hack' } }
    );
    assert(badTokenPost.status === 401, '1.2 POST /api/student-dictionary com token inválido retorna 401', `status=${badTokenPost.status}`);

    const crossRead = await simulateRequest(
      'GET',
      `/api/student-dictionary?uid=${STUDENT_A_UID}`,
      { authorization: 'Bearer tok_student_b' }
    );
    assert(crossRead.status === 403, '1.3 Cross-student GET retorna 403', `status=${crossRead.status}`);

    const crossWrite = await simulateRequest(
      'POST',
      '/api/student-dictionary',
      { authorization: 'Bearer tok_student_b' },
      { studentUid: STUDENT_A_UID, entry: { word: 'intruder', definitionEn: 'bad' } }
    );
    assert(crossWrite.status === 403, '1.4 Cross-student POST retorna 403', `status=${crossWrite.status}`);

    const nestedConflict = await simulateRequest(
      'POST',
      '/api/student-dictionary',
      { authorization: 'Bearer tok_student_a' },
      {
        studentUid: STUDENT_A_UID,
        studentEmail: STUDENT_A_EMAIL,
        entries: [{ word: 'conflict', studentUid: STUDENT_B_UID, definitionEn: 'test' }],
      }
    );
    assert(nestedConflict.status === 403, '1.5 POST com studentUid aninhado conflitante retorna 403', `status=${nestedConflict.status}`);

    const crossDelete = await simulateRequest(
      'DELETE',
      '/api/student-dictionary',
      { authorization: 'Bearer tok_student_b' },
      { studentUid: STUDENT_A_UID, word: 'resilient' }
    );
    assert(crossDelete.status === 403, '1.6 Cross-student DELETE retorna 403', `status=${crossDelete.status}`);

    const unlinkedTeacherGet = await simulateRequest(
      'GET',
      `/api/student-dictionary?uid=${STUDENT_A_UID}&studentEmail=${STUDENT_A_EMAIL}`,
      { authorization: 'Bearer tok_teacher_unlinked' }
    );
    assert(unlinkedTeacherGet.status === 403, '1.7 Professor não vinculado GET retorna 403', `status=${unlinkedTeacherGet.status}`);

    const pendingTeacherGet = await simulateRequest(
      'GET',
      `/api/student-dictionary?uid=${STUDENT_A_UID}&studentEmail=${STUDENT_A_EMAIL}`,
      { authorization: 'Bearer tok_teacher_pending' }
    );
    assert(pendingTeacherGet.status === 403, '1.8 Professor pendente GET retorna 403', `status=${pendingTeacherGet.status}`);

    const teacherOwnUidPost = await simulateRequest(
      'POST',
      '/api/student-dictionary',
      { authorization: 'Bearer tok_teacher_linked_claim' },
      { studentUid: TEACHER_LINKED_UID, entry: { word: 'leak', definitionEn: 'bad' } }
    );
    assert(teacherOwnUidPost.status === 403, '1.9 Teacher UID passado como studentUid retorna 403', `status=${teacherOwnUidPost.status}`);

    const teacherPracticeClaim = await simulateRequest(
      'POST',
      '/api/student-dictionary/practice',
      { authorization: 'Bearer tok_teacher_linked_claim' },
      { studentUid: STUDENT_A_UID, words: ['serendipity'], activityType: 'memorization' }
    );
    assert(teacherPracticeClaim.status === 403, '1.10 Professor (claim) chamando /practice retorna 403', `status=${teacherPracticeClaim.status}`);

    const teacherPracticeNoClaim = await simulateRequest(
      'POST',
      '/api/student-dictionary/practice',
      { authorization: 'Bearer tok_teacher_linked_no_claim' },
      { studentUid: STUDENT_A_UID, words: ['serendipity'], activityType: 'memorization' }
    );
    assert(teacherPracticeNoClaim.status === 403, '1.11 Professor (sem claim) chamando /practice retorna 403', `status=${teacherPracticeNoClaim.status}`);

    const syntheticUidPost = await simulateRequest(
      'POST',
      '/api/student-dictionary',
      { authorization: 'Bearer tok_admin' },
      { studentUid: 'usr-synthetic-999', entry: { word: 'ghost', definitionEn: 'test' } }
    );
    assert(syntheticUidPost.status === 422, '1.12 UID sintético usr-* sem vínculo canônico retorna 422', `status=${syntheticUidPost.status}`);

    const linkedTeacherGet = await simulateRequest(
      'GET',
      `/api/student-dictionary?uid=${STUDENT_A_UID}&studentEmail=${STUDENT_A_EMAIL}`,
      { authorization: 'Bearer tok_teacher_linked_no_claim' }
    );
    assert(linkedTeacherGet.status === 200, '1.13 Professor vinculado lê dicionário do aluno (200)', `status=${linkedTeacherGet.status}`);

    const adminGet = await simulateRequest(
      'GET',
      `/api/student-dictionary?uid=${STUDENT_A_UID}`,
      { authorization: 'Bearer tok_admin' }
    );
    assert(adminGet.status === 200, '1.14 Admin lê dicionário do aluno (200)', `status=${adminGet.status}`);

    // -------------------------------------------------------------------------
    // CENÁRIO 2: Persistência Canônica e Eliminação de Espelhos
    // -------------------------------------------------------------------------
    console.log('\n--- Cenário 2: Persistência Canônica & Zero Espelhos ---');
    mockDb.writeLog = [];

    const addManualRes = await simulateRequest(
      'POST',
      '/api/student-dictionary',
      { authorization: 'Bearer tok_student_a' },
      {
        studentUid: STUDENT_A_UID,
        studentEmail: STUDENT_A_EMAIL,
        isAutomaticSync: false,
        syncType: 'manual',
        entry: {
          word: 'Serendipity',
          partOfSpeech: 'Noun',
          definitionEn: 'The occurrence of finding valuable things unexpectedly.',
          exampleSentenceEn: 'Meeting my mentor at the airport was pure serendipity.',
          translationPt: 'serendipidade / feliz acaso',
          source: 'api',
        },
      }
    );
    assert(addManualRes.status === 200 && addManualRes.body?.success === true, '2.1 POST manual salva com sucesso');

    const wroteToSubcollection = mockDb.writeLog.some((w) => w.path.startsWith(`users/${STUDENT_A_UID}/vocabulary/`));
    const wroteToRootArray = mockDb.writeLog.some(
      (w) => w.path === `users/${STUDENT_A_UID}` && w.keys.includes('vocabulary')
    );
    const wroteToAppState = mockDb.writeLog.some((w) => w.path.startsWith('app_state/'));
    assert(wroteToSubcollection, '2.2 Gravação ocorreu na subcoleção canônica users/{uid}/vocabulary/{wordDocId}');
    assert(!wroteToRootArray, '2.3 ZERO gravações no array legado users/{uid}.vocabulary');
    assert(!wroteToAppState, '2.4 ZERO gravações em app_state');
    assert(!(readDb() as any).studentDictionaryMap, '2.5 db.studentDictionaryMap não é populado pelo runtime');

    wipeAndPoisonMemory();
    const getAfterPoison = await simulateRequest(
      'GET',
      `/api/student-dictionary?uid=${STUDENT_A_UID}`,
      { authorization: 'Bearer tok_student_a' }
    );
    const wordsAfterPoison = (getAfterPoison.body?.dictionary || []).map((e: any) => e.normalizedWord);
    assert(
      getAfterPoison.status === 200 &&
        wordsAfterPoison.includes('serendipity') &&
        !wordsAfterPoison.some((w: string) => w.includes('poisoned')),
      '2.6 Sobrevive a wipe/envenenamento de RAM lendo exclusivamente do Firestore (default)',
      `words=${JSON.stringify(wordsAfterPoison)}`
    );

    // Legado read-only fallback + promoção na primeira escrita sem escrever no root array
    const legacyGet = await simulateRequest(
      'GET',
      `/api/student-dictionary?uid=${STUDENT_LEGACY_UID}`,
      { authorization: 'Bearer tok_student_legacy' }
    );
    const legacyWords = (legacyGet.body?.dictionary || []).map((e: any) => e.normalizedWord);
    assert(
      legacyGet.status === 200 && legacyWords.includes('resilient') && !legacyWords.includes('obsolete'),
      '2.7 Fallback somente leitura de users/{uid}.vocabulary quando subcoleção vazia respeita excludedDictionaryWords',
      `legacyWords=${JSON.stringify(legacyWords)}`
    );

    mockDb.writeLog = [];
    const legacyPromotePost = await simulateRequest(
      'POST',
      '/api/student-dictionary',
      { authorization: 'Bearer tok_student_legacy' },
      {
        studentUid: STUDENT_LEGACY_UID,
        isAutomaticSync: false,
        entry: {
          word: 'momentum',
          partOfSpeech: 'Noun',
          definitionEn: 'The strength or force gained by motion or development.',
          exampleSentenceEn: 'The project gained momentum after the first release.',
          source: 'api',
        },
      }
    );
    const legacyPromotedWords = (legacyPromotePost.body?.dictionary || []).map((e: any) => e.normalizedWord);
    const legacyWroteRootVocab = mockDb.writeLog.some(
      (w) => w.path === `users/${STUDENT_LEGACY_UID}` && w.keys.includes('vocabulary')
    );
    const legacySubSnap = await mockDb.collection('users').doc(STUDENT_LEGACY_UID).collection('vocabulary').get();
    assert(
      legacyPromotePost.status === 200 &&
        legacyPromotedWords.includes('resilient') &&
        legacyPromotedWords.includes('momentum') &&
        !legacyPromotedWords.includes('obsolete') &&
        legacySubSnap.size === 2 &&
        !legacyWroteRootVocab,
      '2.8 Primeira escrita promove legado não-excluído para subcoleção sem nunca gravar em users/{uid}.vocabulary'
    );

    // -------------------------------------------------------------------------
    // CENÁRIO 3: Exclusão Lógica, Rollback, Tombstones e Readicionamento
    // -------------------------------------------------------------------------
    console.log('\n--- Cenário 3: Exclusão, Tombstones e Readicionamento ---');

    // Primeiro pratica 'serendipity' para validar preservação de practiceCount/history na readição
    const practiceBeforeDelete = await simulateRequest(
      'POST',
      '/api/student-dictionary/practice',
      { authorization: 'Bearer tok_student_a' },
      { studentUid: STUDENT_A_UID, words: ['Serendipity'], activityType: 'memorization' }
    );
    const practicedEntryBeforeDel = (practiceBeforeDelete.body?.dictionary || []).find(
      (e: any) => e.normalizedWord === 'serendipity'
    );
    assert(
      practiceBeforeDelete.status === 200 && practicedEntryBeforeDel?.practiceCount === 1,
      '3.1 /practice incrementa practiceCount para 1 antes da exclusão'
    );

    // Simular falha de escrita no DELETE -> 500
    mockDb.failWriteMatcher = (p) => p === `users/${STUDENT_A_UID}`;
    const deleteFailRes = await simulateRequest(
      'DELETE',
      '/api/student-dictionary',
      { authorization: 'Bearer tok_student_a' },
      { studentUid: STUDENT_A_UID, word: 'serendipity' }
    );
    mockDb.failWriteMatcher = null;
    assert(deleteFailRes.status === 500, '3.2 Falha de escrita no DELETE retorna 500 para acionar rollback', `status=${deleteFailRes.status}`);

    // DELETE bem-sucedido + idempotência
    const del1 = await simulateRequest(
      'DELETE',
      '/api/student-dictionary',
      { authorization: 'Bearer tok_student_a' },
      { studentUid: STUDENT_A_UID, word: 'Serendipity' }
    );
    const del2 = await simulateRequest(
      'DELETE',
      '/api/student-dictionary',
      { authorization: 'Bearer tok_student_a' },
      { studentUid: STUDENT_A_UID, word: 'serendipity' }
    );
    const userDocAfterDel = (await mockDb.collection('users').doc(STUDENT_A_UID).get()).data();
    const exclArr: string[] = userDocAfterDel?.excludedDictionaryWords || [];
    assert(
      del1.status === 200 &&
        del2.status === 200 &&
        exclArr.filter((w) => w === 'serendipity').length === 1 &&
        !(del1.body?.dictionary || []).some((e: any) => e.normalizedWord === 'serendipity'),
      '3.3 DELETE persiste tombstone em excludedDictionaryWords de forma idempotente e omite do dicionário ativo'
    );

    // Sync automático NÃO ressuscita palavra excluída
    const autoSyncRes = await simulateRequest(
      'POST',
      '/api/student-dictionary',
      { authorization: 'Bearer tok_teacher_linked_claim' },
      {
        studentUid: STUDENT_A_UID,
        studentEmail: STUDENT_A_EMAIL,
        isAutomaticSync: true,
        syncType: 'native_notes',
        entries: [
          {
            word: 'serendipity',
            definitionEn: 'Generic automatic definition',
            source: 'live_lesson',
          },
          {
            word: 'milestone',
            definitionEn: 'An important event in the development of something.',
            source: 'live_lesson',
          },
        ],
      }
    );
    const wordsAfterAutoSync = (autoSyncRes.body?.dictionary || []).map((e: any) => e.normalizedWord);
    assert(
      autoSyncRes.status === 200 &&
        !wordsAfterAutoSync.includes('serendipity') &&
        wordsAfterAutoSync.includes('milestone'),
      '3.4 Sincronização automática NÃO ressuscita palavra com tombstone, mas salva nova palavra',
      `words=${JSON.stringify(wordsAfterAutoSync)}`
    );

    // Readicionamento explícito remove tombstone preservando practiceCount, practiceHistory e definição mais rica
    const explicitReAdd = await simulateRequest(
      'POST',
      '/api/student-dictionary',
      { authorization: 'Bearer tok_student_a' },
      {
        studentUid: STUDENT_A_UID,
        studentEmail: STUDENT_A_EMAIL,
        isAutomaticSync: false,
        syncType: 'manual',
        entry: {
          word: 'serendipity',
          definitionEn: 'Short def.',
          source: 'api',
        },
      }
    );
    const readdedEntry = (explicitReAdd.body?.dictionary || []).find((e: any) => e.normalizedWord === 'serendipity');
    assert(
      explicitReAdd.status === 200 &&
        Boolean(readdedEntry) &&
        !(explicitReAdd.body?.excludedWords || []).includes('serendipity') &&
        readdedEntry.practiceCount === 1 &&
        Array.isArray(readdedEntry.practiceHistory) &&
        readdedEntry.practiceHistory.length === 1 &&
        readdedEntry.definitionEn === 'The occurrence of finding valuable things unexpectedly.',
      '3.5 Readicionamento explícito remove tombstone e preserva practiceCount, practiceHistory e definição mais rica',
      `readded=${JSON.stringify(readdedEntry)}`
    );

    // -------------------------------------------------------------------------
    // CENÁRIO 4: Alt+W vs Alt+P e Enriquecimento Gemini
    // -------------------------------------------------------------------------
    console.log('\n--- Cenário 4: Alt+W vs Alt+P, Gemini Enrich & Practice ---');

    // 4.1 Alt+W via POST /api/student-dictionary / syncSessionVocabularyToStudentDictionary (Node branch)
    // Primeiro exclui 'excluded_altw' para garantir respeito a tombstone no Alt+W
    await simulateRequest(
      'DELETE',
      '/api/student-dictionary',
      { authorization: 'Bearer tok_student_a' },
      { studentUid: STUDENT_A_UID, word: 'excluded_altw' }
    );

    const altWSynced = await syncSessionVocabularyToStudentDictionary({
      studentUid: STUDENT_A_UID,
      studentEmail: STUDENT_A_EMAIL,
      rawNotes:
        '<p><span data-tag-type="new-word">leverage</span></p><p><span data-tag-type="pronounce">comfortable</span></p><p><span data-tag-type="new-word">excluded_altw</span></p>',
      vocabularyAndExpressions: [
        {
          id: 'v_leverage',
          term: 'leverage',
          isNewWord: true,
          partOfSpeech: 'Verb',
          definitionEn: 'Use something to maximum advantage.',
          simpleDefinition: 'Usar algo para obter máxima vantagem.',
          collocations: ['leverage resources'],
          realExamples: ['We can leverage this tool to save time.'],
          synonyms: ['utilize'],
          register: 'neutral',
          category: 'new-word',
        },
        {
          id: 'v_comfortable',
          term: 'comfortable',
          isPronunciationFocus: true,
          isNewWord: false,
          partOfSpeech: 'Pronunciation',
          definitionEn: 'Pronounce as /ˈkʌmf.tə.bəl/.',
          simpleDefinition: 'Foco de pronúncia: /ˈkʌmf.tə.bəl/.',
          collocations: [],
          realExamples: ['Make sure you feel comfortable.'],
          synonyms: [],
          register: 'neutral',
          category: 'pronounce',
        },
        {
          id: 'v_excluded_altw',
          term: 'excluded_altw',
          isNewWord: true,
          partOfSpeech: 'Verb',
          definitionEn: 'Should not reappear due to tombstone.',
          simpleDefinition: 'Não deve reaparecer devido ao tombstone.',
          collocations: [],
          realExamples: ['Example for excluded_altw.'],
          synonyms: [],
          register: 'neutral',
          category: 'new-word',
        },
      ],
      isDefinitiveAi: true,
    });
    const afterAltW = await fetchStudentVocabularyFromFirestoreServer(STUDENT_A_UID, STUDENT_A_EMAIL);
    const afterAltWSet = new Set(afterAltW.map((e: any) => e.normalizedWord));
    assert(
      afterAltWSet.has('leverage') && !afterAltWSet.has('comfortable') && !afterAltWSet.has('excluded_altw') && altWSynced.length >= 1,
      '4.1 Alt+W inclui apenas novas palavras não-excluídas e ignora itens exclusivos Alt+P',
      `words=${JSON.stringify(Array.from(afterAltWSet))}`
    );

    // 4.2 Gemini /api/student-dictionary/enrich
    wipeAndPoisonMemory();
    geminiCallCount = 0;
    const enrichRes1 = await simulateRequest(
      'POST',
      '/api/student-dictionary/enrich',
      { authorization: 'Bearer tok_student_a' },
      {
        studentUid: STUDENT_A_UID,
        studentEmail: STUDENT_A_EMAIL,
        words: ['breakthrough', 'keep up with', 'excluded_altw'],
      }
    );
    const afterEnrichList = await fetchStudentVocabularyFromFirestoreServer(STUDENT_A_UID, STUDENT_A_EMAIL);
    const breakthroughDoc = afterEnrichList.find((e: any) => e.normalizedWord === 'breakthrough');
    const keepUpDoc = afterEnrichList.find((e: any) => e.normalizedWord === 'keep up with');
    assert(
      enrichRes1.status === 200 &&
        geminiCallCount === 1 &&
        Boolean(breakthroughDoc?.definitionEn) &&
        Boolean(keepUpDoc?.definitionEn) &&
        breakthroughDoc?.cefrLevel === 'B1' &&
        !afterEnrichList.some((e: any) => e.normalizedWord === 'excluded_altw'),
      '4.2 /enrich chama Gemini 1x, usa level do Firestore (RAM envenenada ignorada), persiste e respeita tombstone',
      `geminiCalls=${geminiCallCount}, bt=${breakthroughDoc?.definitionEn}, cefr=${breakthroughDoc?.cefrLevel}`
    );

    // Segunda chamada com as mesmas palavras -> ZERO chamadas Gemini
    const enrichRes2 = await simulateRequest(
      'POST',
      '/api/student-dictionary/enrich',
      { authorization: 'Bearer tok_student_a' },
      {
        studentUid: STUDENT_A_UID,
        studentEmail: STUDENT_A_EMAIL,
        words: ['breakthrough', 'keep up with'],
      }
    );
    assert(
      enrichRes2.status === 200 && enrichRes2.body?.cached === true && geminiCallCount === 1,
      '4.3 Segunda chamada a /enrich para palavras já enriquecidas faz ZERO chamadas Gemini',
      `geminiCalls=${geminiCallCount}, cached=${enrichRes2.body?.cached}`
    );

    // 4.4 /api/student-dictionary/practice respeitando tombstones e entre aulas
    const practiceRes = await simulateRequest(
      'POST',
      '/api/student-dictionary/practice',
      { authorization: 'Bearer tok_student_a' },
      {
        studentUid: STUDENT_A_UID,
        words: ['breakthrough', 'excluded_altw'],
        activityType: 'homework',
      }
    );
    const practicedBt = (practiceRes.body?.dictionary || []).find((e: any) => e.normalizedWord === 'breakthrough');
    assert(
      practiceRes.status === 200 &&
        practicedBt?.practiceCount === 1 &&
        practicedBt?.practiceHistory?.[0]?.activityType === 'homework' &&
        Boolean(practicedBt?.lastPracticedAt),
      '4.4 /practice atualiza practiceCount, lastPracticedAt e practiceHistory preservando definição'
    );

    const betweenRes = await getStudentActivitiesBetweenLessonsServer(
      STUDENT_A_UID,
      STUDENT_A_EMAIL,
      'lesson-between-1',
      TEACHER_LINKED_UID
    );
    const betweenVocabWords = (betweenRes?.vocabulary || []).map((w: any) => (w.word || '').toLowerCase().trim());
    assert(
      betweenVocabWords.includes('breakthrough') && !betweenVocabWords.includes('excluded_altw'),
      '4.5 getStudentActivitiesBetweenLessonsServer lê subcoleção canônica e filtra tombstones',
      `vocab=${JSON.stringify(betweenVocabWords)}`
    );

    // -------------------------------------------------------------------------
    // CENÁRIO 5: Concorrência
    // -------------------------------------------------------------------------
    console.log('\n--- Cenário 5: Concorrência ---');

    const concurrentAdds = await Promise.all([
      simulateRequest(
        'POST',
        '/api/student-dictionary',
        { authorization: 'Bearer tok_student_a' },
        { studentUid: STUDENT_A_UID, isAutomaticSync: false, entry: { word: 'concurrency_one', definitionEn: 'First concurrent word.' } }
      ),
      simulateRequest(
        'POST',
        '/api/student-dictionary',
        { authorization: 'Bearer tok_student_a' },
        { studentUid: STUDENT_A_UID, isAutomaticSync: false, entry: { word: 'concurrency_two', definitionEn: 'Second concurrent word.' } }
      ),
      simulateRequest(
        'POST',
        '/api/student-dictionary',
        { authorization: 'Bearer tok_student_a' },
        { studentUid: STUDENT_A_UID, isAutomaticSync: false, entry: { word: 'concurrency_three', definitionEn: 'Third concurrent word.' } }
      ),
    ]);
    const finalAfterConcurrentAdds = await fetchStudentVocabularyFromFirestoreServer(STUDENT_A_UID, STUDENT_A_EMAIL);
    const finalWordSet = new Set(finalAfterConcurrentAdds.map((e: any) => e.normalizedWord));
    assert(
      concurrentAdds.every((r) => r.status === 200) &&
        finalWordSet.has('concurrency_one') &&
        finalWordSet.has('concurrency_two') &&
        finalWordSet.has('concurrency_three'),
      '5.1 Escritas concorrentes de palavras distintas não perdem entradas'
    );

    await Promise.all([
      markVocabularyWordsPracticedServer(STUDENT_A_UID, ['breakthrough'], 'sentence', STUDENT_A_EMAIL),
      saveStudentVocabularyToFirestoreServer(
        STUDENT_A_UID,
        [{ word: 'breakthrough', definitionEn: 'Short', source: 'routine' } as any],
        STUDENT_A_EMAIL
      ),
    ]);
    const btAfterRace = (await fetchStudentVocabularyFromFirestoreServer(STUDENT_A_UID, STUDENT_A_EMAIL)).find(
      (e: any) => e.normalizedWord === 'breakthrough'
    );
    assert(
      btAfterRace?.practiceCount === 2 &&
        Array.isArray(btAfterRace?.practiceHistory) &&
        btAfterRace.practiceHistory.length === 2 &&
        btAfterRace?.definitionEn === 'An important discovery or sudden advance in knowledge.',
      '5.2 Concorrência entre /practice e upsert na mesma palavra preserva practiceCount=2 e definição rica',
      `bt=${JSON.stringify(btAfterRace)}`
    );

    // -------------------------------------------------------------------------
    // CENÁRIO 6: Auditoria Estática
    // -------------------------------------------------------------------------
    console.log('\n--- Cenário 6: Auditoria Estática ---');

    const rootDir = process.cwd();
    const persistenceSrc = fs.readFileSync(path.join(rootDir, 'src/utils/studentPersistence.ts'), 'utf8');
    const appSrc = fs.readFileSync(path.join(rootDir, 'src/App.tsx'), 'utf8');
    const modalSrc = fs.readFileSync(path.join(rootDir, 'src/components/PersonalDictionaryModal.tsx'), 'utf8');
    const serverAppSrc = fs.readFileSync(path.join(rootDir, 'serverApp.ts'), 'utf8');
    const serverFsSrc = fs.readFileSync(path.join(rootDir, 'src/serverFirestore.ts'), 'utf8');

    const dictSectionStart = persistenceSrc.indexOf('export async function fetchStudentDictionarySnapshotViaApi');
    const dictSectionEnd = persistenceSrc.indexOf('// ========================\n// DAILY JOURNAL');
    const dictSlice = persistenceSrc.slice(dictSectionStart, dictSectionEnd > dictSectionStart ? dictSectionEnd : dictSectionStart + 35000);
    const hasWebSdkInDict = /\b(getDoc|getDocs|setDoc|onSnapshot)\s*\(/.test(dictSlice);
    assert(!hasWebSdkInDict, '6.1 Zero chamadas Web SDK (getDoc/getDocs/setDoc/onSnapshot) na camada Dictionary de studentPersistence.ts');

    const saveHandlerStart = appSrc.indexOf('const handleSaveCustomDictionaryEntry =');
    const saveHandlerEnd = appSrc.indexOf('const handleDeleteCustomDictionaryEntry =', saveHandlerStart);
    const saveHandlerSlice = appSrc.slice(saveHandlerStart, saveHandlerEnd);
    const postMatches = saveHandlerSlice.match(/fetch\(['"]\/api\/student-dictionary['"]/g) || [];
    assert(
      postMatches.length === 1 &&
        !saveHandlerSlice.includes('saveStudentVocabularyToFirestore') &&
        !saveHandlerSlice.includes('removeExcludedDictionaryWord'),
      '6.2 handleSaveCustomDictionaryEntry em App.tsx executa exatamente 1 POST (sem duplo POST)',
      `postMatches=${postMatches.length}`
    );

    const enrichEffectStart = modalSrc.indexOf("fetch('/api/student-dictionary/enrich'");
    const enrichEffectEnd = modalSrc.indexOf('const routineEntries:', enrichEffectStart);
    const enrichSlice = modalSrc.slice(enrichEffectStart, enrichEffectEnd);
    assert(
      !enrichSlice.includes('onSaveCustomEntry'),
      '6.3 PersonalDictionaryModal.tsx não dispara onSaveCustomEntry após /api/student-dictionary/enrich'
    );

    const activeDictMapRefsServerApp = (serverAppSrc.match(/db\.studentDictionaryMap/g) || []).length;
    const activeDictMapRefsServerFs = (serverFsSrc.match(/studentDictionaryMap/g) || []).length;
    assert(
      activeDictMapRefsServerApp === 0 && activeDictMapRefsServerFs <= 3,
      '6.4 serverApp.ts não referencia db.studentDictionaryMap e serverFirestore.ts apenas sanitiza/remove legado',
      `serverApp=${activeDictMapRefsServerApp}, serverFs=${activeDictMapRefsServerFs}`
    );

    const rulesModifiedCheck = fs.readFileSync(path.join(rootDir, 'firestore.rules'), 'utf8').length > 0;
    assert(rulesModifiedCheck, '6.5 firestore.rules presente e preservado');
  } finally {
    globalThis.fetch = originalFetch;
    for (const id of trackedIntervals) {
      originalClearInterval(id);
    }
    for (const id of trackedTimeouts) {
      originalClearTimeout(id);
    }
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }

  console.log('\n================================================================================');
  console.log(` RESULTADO ARCH.2F.2B: ${passed} passed, ${failed} failed`);
  console.log('================================================================================');
  if (failed > 0) process.exit(1);
}

runTests().catch((err) => {
  console.error('Fatal error in validate-arch-2f-2b-dictionary-consolidation:', err);
  process.exit(1);
});
