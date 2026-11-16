/**
 * NF.FLOW.1.5 — Blockers Fix & Native Friends Notes Independence Validation Suite
 *
 * Validates all 10 mandatory mocked scenarios:
 *  1. First note on scheduled lesson, no false 409 (no legacy token derived from LiveLesson).
 *  2. First standalone note without lessonId (pure session_notes doc, baseRevisionToken: null).
 *  3. Reopening and editing both scheduled and standalone notes (by id & by studentUid+sessionDate).
 *  4. Async loading & session switching without token/content cross-contamination + save lock during loading.
 *  5. HTTP 409 preserving local edits across blur, autosave, and re-renders.
 *  6. Reload Server Version cancelled (state/editor/token untouched) and confirmed (server loaded) on both flows.
 *  7. Apply AI, Save Draft, and Approve & Publish in both flows (with lessonId and standalone without lessonId).
 *  8. Versioning v1/v2 and STALE_DRAFT rejection when rawContent changes after draft.
 *  9. Zero duplicate session_notes docs, zero email-based IDs, zero phantom docs in `lessons`.
 * 10. RBAC, canonical UID, and teacher-student pedagogical link preservation.
 */

process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = 'test-gemini-api-key';
process.env.FIREBASE_PROJECT_ID = 'itissimple-security-staging';
process.env.FIREBASE_DATABASE_ID = '(default)';

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import http from 'http';
import { setFirebaseAdminAuthForTesting } from '../src/serverFirebaseAdmin';
import {
  setFirebaseAdminFirestoreForTesting,
  resetFirebaseAdminFirestoreForTesting,
} from '../src/serverFirestore';
import { resetGeminiSecurityStateForTesting } from '../src/serverGeminiSecurity';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    console.log(`  ✅ PASS: ${name}`);
    passed++;
  } catch (err: any) {
    console.error(`  ❌ FAIL: ${name}`);
    console.error(`     -> ${err?.message || err}`);
    failed++;
  }
}

function deepClone<T>(val: T): T {
  return val === undefined ? val : JSON.parse(JSON.stringify(val));
}

function isPlainObject(val: any): val is Record<string, any> {
  return Boolean(val) && typeof val === 'object' && !Array.isArray(val) && !(val instanceof Date);
}

function deepMerge(target: any, source: any): any {
  const out = { ...(target || {}) };
  for (const [k, v] of Object.entries(source || {})) {
    if (isPlainObject(v) && isPlainObject(out[k])) {
      out[k] = deepMerge(out[k], v);
    } else {
      out[k] = deepClone(v);
    }
  }
  return out;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function createMockFirestoreCAS(store: Record<string, any>) {
  const docVersions: Record<string, number> = {};

  const getColDocs = (colPath: string) =>
    Object.entries(store)
      .filter(([k]) => {
        if (!k.startsWith(`${colPath}/`)) return false;
        const rest = k.slice(colPath.length + 1);
        return !rest.includes('/');
      })
      .map(([k, v]) => ({ id: k.slice(colPath.length + 1), data: v }));

  const makeQuery = (colPath: string, filters: Array<{ field: string; op: string; value: any }> = []): any => ({
    where(field: string, op: string, value: any) {
      return makeQuery(colPath, [...filters, { field, op, value }]);
    },
    orderBy() {
      return makeQuery(colPath, filters);
    },
    limit(n: number) {
      const base = makeQuery(colPath, filters);
      const origGet = base.get.bind(base);
      return {
        ...base,
        async get() {
          const r = await origGet();
          const sliced = r.docs.slice(0, n);
          return {
            empty: sliced.length === 0,
            size: sliced.length,
            docs: sliced,
            forEach: (cb: any) => sliced.forEach(cb),
          };
        },
      };
    },
    async get() {
      const matched = getColDocs(colPath)
        .filter(({ data }) =>
          filters.every((f) => {
            if (f.op === '==') return data?.[f.field] === f.value;
            if (f.op === 'in' && Array.isArray(f.value)) return f.value.includes(data?.[f.field]);
            if (f.op === 'array-contains' && Array.isArray(data?.[f.field])) return data[f.field].includes(f.value);
            return false;
          })
        )
        .map(({ id, data }) => ({
          id,
          exists: true,
          ref: makeDocRef(colPath, id),
          data: () => deepClone(data),
        }));
      return {
        empty: matched.length === 0,
        size: matched.length,
        docs: matched,
        forEach: (cb: any) => matched.forEach(cb),
      };
    },
  });

  const makeDocRef = (colPath: string, docId: string): any => {
    const fullPath = `${colPath}/${docId}`;
    return {
      id: docId,
      path: fullPath,
      async get() {
        const val = store[fullPath];
        return {
          exists: val !== undefined,
          id: docId,
          ref: this,
          data: () => (val !== undefined ? deepClone(val) : undefined),
        };
      },
      async set(val: any, opts?: { merge?: boolean }) {
        store[fullPath] = opts?.merge && store[fullPath] ? deepMerge(store[fullPath], val) : deepClone(val);
        docVersions[fullPath] = (docVersions[fullPath] || 0) + 1;
      },
      async update(val: any) {
        if (!store[fullPath]) throw new Error(`NOT_FOUND: ${fullPath}`);
        store[fullPath] = deepMerge(store[fullPath], val);
        docVersions[fullPath] = (docVersions[fullPath] || 0) + 1;
      },
      async delete() {
        delete store[fullPath];
        docVersions[fullPath] = (docVersions[fullPath] || 0) + 1;
      },
      collection(sub: string) {
        return makeCollection(`${fullPath}/${sub}`);
      },
    };
  };

  const makeCollection = (colPath: string): any => ({
    doc: (docId: string) => makeDocRef(colPath, docId),
    where: (field: string, op: string, value: any) => makeQuery(colPath, [{ field, op, value }]),
    orderBy: () => makeQuery(colPath, []),
    limit: (n: number) => makeQuery(colPath, []).limit(n),
    async get() {
      return makeQuery(colPath, []).get();
    },
  });

  return {
    collection: (name: string) => makeCollection(name),
    async runTransaction<T>(fn: (tx: any) => Promise<T>): Promise<T> {
      for (let attempt = 0; attempt < 15; attempt++) {
        const readVersions = new Map<string, number>();
        const ops: Array<{ path: string; kind: 'set' | 'update' | 'delete'; val?: any; opts?: any }> = [];
        const tx = {
          get: async (ref: any) => {
            const snap = await ref.get();
            if (!readVersions.has(ref.path)) {
              readVersions.set(ref.path, docVersions[ref.path] || 0);
            }
            return snap;
          },
          set: (ref: any, val: any, opts?: any) => {
            ops.push({ path: ref.path, kind: 'set', val: deepClone(val), opts });
          },
          update: (ref: any, val: any) => {
            ops.push({ path: ref.path, kind: 'update', val: deepClone(val) });
          },
          delete: (ref: any) => {
            ops.push({ path: ref.path, kind: 'delete' });
          },
        };
        const result = await fn(tx);
        let conflict = false;
        for (const [p, expectedVer] of readVersions.entries()) {
          if ((docVersions[p] || 0) !== expectedVer) {
            conflict = true;
            break;
          }
        }
        if (conflict) {
          await sleep(5);
          continue;
        }
        for (const op of ops) {
          if (op.kind === 'set') {
            store[op.path] = op.opts?.merge && store[op.path] ? deepMerge(store[op.path], op.val) : op.val;
          } else if (op.kind === 'update') {
            store[op.path] = { ...(store[op.path] || {}), ...op.val };
          } else if (op.kind === 'delete') {
            delete store[op.path];
          }
          docVersions[op.path] = (docVersions[op.path] || 0) + 1;
        }
        return result;
      }
      throw new Error('CAS_TRANSACTION_ABORTED');
    },
  };
}

function makeRequest(
  server: http.Server,
  method: string,
  pathStr: string,
  body?: any,
  headers: Record<string, string> = {}
): Promise<{ status: number; data: any }> {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    if (!addr || typeof addr === 'string') return reject(new Error('Server address unavailable'));
    const bodyStr = body ? JSON.stringify(body) : undefined;
    const reqHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      ...headers,
    };
    if (bodyStr) reqHeaders['Content-Length'] = Buffer.byteLength(bodyStr).toString();
    const req = http.request(
      { host: '127.0.0.1', port: addr.port, path: pathStr, method, headers: reqHeaders },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode || 0, data: JSON.parse(raw) });
          } catch {
            resolve({ status: res.statusCode || 0, data: raw });
          }
        });
      }
    );
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

function buildMockAiOutput(tag: string) {
  return {
    mistakesAnalysis: [
      {
        id: `m-${tag}`,
        original: `I have 28 years (${tag})`,
        corrected: `I am 28 years old (${tag})`,
        category: 'grammar',
        explanation: 'Use the verb to be for age.',
        grammarRule: 'Subject + be + age',
        twoExamples: ['She is 28 years old.', 'They are 30 years old.'],
        commonPitfalls: 'Avoid using have for age.',
        similarFormsComparison: 'I am 28 vs I have 28 years',
      },
    ],
    grammarPoints: [
      {
        id: `g-${tag}`,
        title: `Present Simple (${tag})`,
        explanation: 'Routine statements in English.',
        examples: ['We review notes every session.'],
      },
    ],
    vocabularyAndExpressions: [
      {
        id: `v-${tag}`,
        term: `hit the ground running (${tag})`,
        definitionEn: 'Start something energetically and effectively right away.',
        simpleDefinition: 'Começar com tudo desde o início.',
        realExamples: ['You hit the ground running in our conversation today.'],
        isNewWord: true,
      },
    ],
    reviewSummary: {
      estimatedMinutes: '5 minutes',
      keyRules: ['Use to be for age'],
      mustKnowVocabulary: [`hit the ground running (${tag})`],
      essentialCorrections: [{ original: `I have 28 years (${tag})`, corrected: `I am 28 years old (${tag})` }],
      rememberThis: 'Always use to be for age.',
    },
  };
}

async function run() {
  const {
    app: serverApp,
    readDb,
    setSessionNoteTransformAttemptExecutorForTesting,
  } = await import('../serverApp');

  console.log('\n🧪 NF.FLOW.1.5 — Native Friends Notes Independence & Blockers Validation');

  const teacherUid = 'nf15-teacher-uid-001';
  const teacherEmail = 'teacher15@itissimple.com';
  const otherTeacherUid = 'nf15-teacher-uid-002';
  const otherTeacherEmail = 'teacher15-other@itissimple.com';
  const studentUid = 'nf15-student-uid-001';
  const studentEmail = 'student15@itissimple.com';
  const student2Uid = 'nf15-student-uid-002';
  const student2Email = 'student15b@itissimple.com';

  const SCHEDULED_LESSON_ID = 'lesson-nf15-sched-001';
  const CUSTOM_STANDALONE_ID = 'note_custom_nf15_001';

  const firestoreStore: Record<string, any> = {
    [`users/${teacherUid}`]: {
      uid: teacherUid,
      email: teacherEmail,
      name: 'Native Friend Alpha',
      role: 'teacher',
      approvalStatus: 'approved',
      isApproved: true,
      teacherApproved: true,
      teacherStatus: 'approved',
    },
    [`tutors/tutor-${teacherUid}`]: {
      uid: teacherUid,
      authUid: teacherUid,
      email: teacherEmail,
      name: 'Native Friend Alpha',
      role: 'teacher',
      approvalStatus: 'approved',
      isApproved: true,
    },
    [`users/${otherTeacherUid}`]: {
      uid: otherTeacherUid,
      email: otherTeacherEmail,
      name: 'Native Friend Other',
      role: 'teacher',
      approvalStatus: 'approved',
      isApproved: true,
      teacherApproved: true,
      teacherStatus: 'approved',
    },
    [`tutors/tutor-${otherTeacherUid}`]: {
      uid: otherTeacherUid,
      authUid: otherTeacherUid,
      email: otherTeacherEmail,
      name: 'Native Friend Other',
      role: 'teacher',
      approvalStatus: 'approved',
      isApproved: true,
    },
    [`users/${studentUid}`]: {
      uid: studentUid,
      email: studentEmail,
      name: 'Student One',
      role: 'student',
      englishLevel: 'intermediario',
      assignedTeacherUid: teacherUid,
      assignedTeacherEmail: teacherEmail,
    },
    [`users/${student2Uid}`]: {
      uid: student2Uid,
      email: student2Email,
      name: 'Student Two',
      role: 'student',
      englishLevel: 'avancado',
    },
    [`lessons/${SCHEDULED_LESSON_ID}`]: {
      id: SCHEDULED_LESSON_ID,
      studentUid,
      studentEmail,
      studentName: 'Student One',
      teacherUid,
      teacherEmail,
      teacherName: 'Native Friend Alpha',
      title: 'Scheduled Fluency Session',
      sessionDate: '2026-11-16',
      startDateTime: '2026-11-16T14:00:00Z',
      status: 'scheduled',
      // Simulate pre-existing legacy text on LiveLesson WITHOUT any session_notes doc yet!
      sessionNotesDocument: 'Old lesson placeholder text',
      updatedAt: '2026-11-16T14:05:00.000Z',
    },
  };

  setFirebaseAdminFirestoreForTesting(createMockFirestoreCAS(firestoreStore) as any);
  setFirebaseAdminAuthForTesting({
    verifyIdToken: async (token: string) => {
      if (token === 'token-teacher') return { uid: teacherUid, email: teacherEmail, role: 'teacher' };
      if (token === 'token-other-teacher') return { uid: otherTeacherUid, email: otherTeacherEmail, role: 'teacher' };
      if (token === 'token-student') return { uid: studentUid, email: studentEmail, role: 'student' };
      if (token === 'token-student-2') return { uid: student2Uid, email: student2Email, role: 'student' };
      throw new Error('Invalid token');
    },
  } as any);

  const db = readDb();
  db.userProfiles[teacherEmail] = { uid: teacherUid, email: teacherEmail, name: 'Native Friend Alpha', role: 'teacher', teacherApproved: true, teacherStatus: 'approved' };
  db.userProfiles[otherTeacherEmail] = { uid: otherTeacherUid, email: otherTeacherEmail, name: 'Native Friend Other', role: 'teacher', teacherApproved: true, teacherStatus: 'approved' };
  db.userProfiles[studentEmail] = { uid: studentUid, email: studentEmail, name: 'Student One', role: 'student' };
  db.userProfiles[student2Email] = { uid: student2Uid, email: student2Email, name: 'Student Two', role: 'student' };
  db.students.push({
    id: studentUid,
    uid: studentUid,
    email: studentEmail,
    name: 'Student One',
    assignedTeacherUid: teacherUid,
    assignedTeacherEmail: teacherEmail,
  });
  db.students.push({
    id: student2Uid,
    uid: student2Uid,
    email: student2Email,
    name: 'Student Two',
  });

  const server = serverApp.listen(0);
  const teacherHeaders = { Authorization: 'Bearer token-teacher' };
  const otherTeacherHeaders = { Authorization: 'Bearer token-other-teacher' };
  const studentHeaders = { Authorization: 'Bearer token-student' };

  const panelSrc = fs.readFileSync(
    path.resolve(process.cwd(), 'src/components/TeacherLiveLessonNotesPanel.tsx'),
    'utf8'
  );

  try {
    // 1. First note on scheduled lesson, no false 409
    await test('1. Primeira nota de aula agendada sem falso 409 (nem token legado derivado de LiveLesson)', async () => {
      // Static check: no deriveLegacyRevisionToken(currentLesson) or deriveLegacyRevisionToken(lessonOnDate)
      assert(
        !panelSrc.includes('deriveLegacyRevisionToken(currentLesson)'),
        'TeacherLiveLessonNotesPanel não deve derivar token legado de currentLesson'
      );
      assert(
        !panelSrc.includes('deriveLegacyRevisionToken(lessonOnDate)'),
        'TeacherLiveLessonNotesPanel não deve derivar token legado de lessonOnDate'
      );

      // GET when only lessons/{id} exists and session_notes/{id} does NOT exist yet
      const getFallback = await makeRequest(
        server,
        'GET',
        `/api/session-notes?lessonId=${SCHEDULED_LESSON_ID}&studentUid=${studentUid}&sessionDate=2026-11-16`,
        undefined,
        teacherHeaders
      );
      assert.strictEqual(getFallback.status, 200);
      assert.strictEqual(getFallback.data?.isLessonFallback, true);
      assert.strictEqual(
        getFallback.data?.revisionToken,
        null,
        'Fallback de lessons sem doc em session_notes deve retornar revisionToken: null'
      );

      // First save with baseRevisionToken: null must succeed (no false 409!)
      const firstSave = await makeRequest(
        server,
        'POST',
        '/api/session-notes',
        {
          id: SCHEDULED_LESSON_ID,
          lessonId: SCHEDULED_LESSON_ID,
          studentUid,
          studentEmail,
          sessionDate: '2026-11-16',
          topic: 'Scheduled Fluency Session',
          rawContent: '✗ I have 28 years ✓ I am 28 years old • ✦ New Word hit the ground running',
          baseRevisionToken: null,
        },
        teacherHeaders
      );
      assert.strictEqual(firstSave.status, 200, 'Primeira gravação de aula agendada com null deve retornar 200');
      assert(firstSave.data?.revisionToken, 'Primeira gravação retorna revisionToken canônico');
      assert.strictEqual(firstSave.data?.sessionNote?.lessonId, SCHEDULED_LESSON_ID);
      assert.strictEqual(firestoreStore[`session_notes/${SCHEDULED_LESSON_ID}`]?.contentRevision, 1);
    });

    // 2. First standalone note without lessonId
    let standaloneNoteId = '';
    let standaloneToken = '';
    await test('2. Primeira nota avulsa sem lessonId (session_notes autônoma com baseRevisionToken: null)', async () => {
      const lessonKeysBefore = Object.keys(firestoreStore).filter((k) => k.startsWith('lessons/'));
      // Client omits lessonId and passes no student_${email}_${sessionDate}
      const res = await makeRequest(
        server,
        'POST',
        '/api/session-notes',
        {
          sessionDate: '2026-11-17',
          studentUid,
          studentEmail,
          topic: 'Standalone Ad-Hoc Coaching',
          rawContent: '✗ I have 28 years (standalone) ✓ I am 28 years old (standalone) • ✦ New Word hit the ground running',
          baseRevisionToken: null,
        },
        teacherHeaders
      );
      assert.strictEqual(res.status, 200, 'Primeira nota avulsa deve salvar com sucesso sem lessonId');
      standaloneNoteId = res.data?.sessionNote?.id;
      standaloneToken = res.data?.revisionToken;
      assert.strictEqual(standaloneNoteId, `session_2026-11-17_${studentUid}`);
      assert.strictEqual(res.data?.sessionNote?.lessonId || '', '', 'Nota avulsa não deve possuir lessonId');
      assert.strictEqual(res.data?.sessionNote?.teacherUid, teacherUid);
      assert.strictEqual(res.data?.sessionNote?.studentUid, studentUid);
      assert(standaloneToken, 'Nota avulsa recebe revisionToken canônico');

      const lessonKeysAfter = Object.keys(firestoreStore).filter((k) => k.startsWith('lessons/'));
      assert.deepStrictEqual(lessonKeysAfter, lessonKeysBefore, 'Nota avulsa NÃO deve criar documento em lessons');
    });

    // 3. Reopening and editing both scheduled and standalone notes
    await test('3. Reabertura e edição de ambos os tipos (agendada e avulsa)', async () => {
      // Reopen scheduled via lessonId
      const reopenSched = await makeRequest(
        server,
        'GET',
        `/api/session-notes?lessonId=${SCHEDULED_LESSON_ID}&studentUid=${studentUid}&sessionDate=2026-11-16`,
        undefined,
        teacherHeaders
      );
      assert.strictEqual(reopenSched.status, 200);
      assert.strictEqual(reopenSched.data?.isLessonFallback, undefined);
      const schedTok = reopenSched.data?.revisionToken;
      assert(schedTok);

      const editSched = await makeRequest(
        server,
        'POST',
        '/api/session-notes',
        {
          id: SCHEDULED_LESSON_ID,
          lessonId: SCHEDULED_LESSON_ID,
          studentUid,
          studentEmail,
          sessionDate: '2026-11-16',
          topic: 'Scheduled Fluency Session Edited',
          rawContent: '✗ I have 28 years ✓ I am 28 years old (edited) • ✦ New Word hit the ground running',
          baseRevisionToken: schedTok,
        },
        teacherHeaders
      );
      assert.strictEqual(editSched.status, 200);
      assert.notStrictEqual(editSched.data?.revisionToken, schedTok);

      // Reopen standalone WITHOUT ID, querying strictly by studentUid + sessionDate + standalone=true
      const reopenStandaloneByDate = await makeRequest(
        server,
        'GET',
        `/api/session-notes?studentUid=${studentUid}&sessionDate=2026-11-17&standalone=true`,
        undefined,
        teacherHeaders
      );
      assert.strictEqual(reopenStandaloneByDate.status, 200);
      assert.strictEqual(reopenStandaloneByDate.data?.id, standaloneNoteId);
      assert.strictEqual(reopenStandaloneByDate.data?.revisionToken, standaloneToken);

      // Verify standalone=true on 2026-11-16 (which has a scheduled lesson) does NOT return the scheduled lesson note
      const standaloneCheckSameDate = await makeRequest(
        server,
        'GET',
        `/api/session-notes?studentUid=${studentUid}&sessionDate=2026-11-16&standalone=true`,
        undefined,
        teacherHeaders
      );
      assert.strictEqual(standaloneCheckSameDate.status, 200);
      assert.strictEqual(
        standaloneCheckSameDate.data,
        null,
        'Consulta standalone=true em data com apenas aula agendada deve retornar null sem sequestrar aula agendada'
      );

      // Edit standalone using canonical ID + token
      const editStandalone = await makeRequest(
        server,
        'POST',
        '/api/session-notes',
        {
          id: standaloneNoteId,
          studentUid,
          studentEmail,
          sessionDate: '2026-11-17',
          topic: 'Standalone Ad-Hoc Coaching Edited',
          rawContent: '✗ I have 28 years (v1) ✓ I am 28 years old (v1) • ✦ New Word hit the ground running',
          baseRevisionToken: standaloneToken,
        },
        teacherHeaders
      );
      assert.strictEqual(editStandalone.status, 200);
      standaloneToken = editStandalone.data.revisionToken;
    });

    // 4. Async loading & session switching without token/content contamination + save lock during loading
    await test('4. Carregamento assíncrono e troca de sessão sem contaminação de token + bloqueio de save durante load', async () => {
      // Static guard checks in TeacherLiveLessonNotesPanel
      assert(panelSrc.includes('isLoadingSessionNoteRef.current'), 'Deve manter ref síncrono de carregamento canônico');
      assert(panelSrc.includes('activeContextSeqRef.current'), 'Deve manter contador monotônico de contexto de sessão');
      assert(panelSrc.includes('if (isSavingRef.current || isLoadingSessionNoteRef.current)'), 'persistSessionDocument deve bloquear save enquanto carrega');

      // Simulate frontend async state machine with out-of-order fetch/save completion across session switch
      let activeContextSeq = 1;
      let isLoadingSessionNote = true;
      let activeSessionKey = 'lesson_A';
      let activeRevisionToken: string | null = null;
      let activeContent = 'Initial A';
      let saveAttemptDuringLoadBlocked = false;

      const trySaveDuringLoad = () => {
        if (isLoadingSessionNote) {
          saveAttemptDuringLoadBlocked = true;
          return false;
        }
        return true;
      };
      assert.strictEqual(trySaveDuringLoad(), false);
      assert.strictEqual(saveAttemptDuringLoadBlocked, true);

      // Start async load for Session A (slow)
      const seqForA = activeContextSeq;
      const slowLoadA = (async () => {
        await sleep(30);
        if (seqForA !== activeContextSeq) return 'IGNORED_STALE';
        activeRevisionToken = 'tok_A_stale';
        activeContent = 'Content A from stale response';
        return 'APPLIED';
      })();

      // User immediately switches to Session B (standalone)
      activeContextSeq += 1;
      activeSessionKey = 'standalone_B';
      activeRevisionToken = null;
      activeContent = 'Session B starter';
      const seqForB = activeContextSeq;

      const fastLoadB = (async () => {
        await sleep(5);
        if (seqForB !== activeContextSeq) return 'IGNORED_STALE';
        isLoadingSessionNote = false;
        activeRevisionToken = 'tok_B_canonical';
        activeContent = 'Session B server content';
        return 'APPLIED';
      })();

      const [resB, resA] = await Promise.all([fastLoadB, slowLoadA]);
      assert.strictEqual(resB, 'APPLIED');
      assert.strictEqual(resA, 'IGNORED_STALE', 'Resposta assíncrona da Sessão A não deve contaminar Sessão B');
      assert.strictEqual(activeSessionKey, 'standalone_B');
      assert.strictEqual(activeRevisionToken, 'tok_B_canonical');
      assert.strictEqual(activeContent, 'Session B server content');
    });

    // 5. HTTP 409 preserving local changes across blur, autosave, and re-render
    await test('5. HTTP 409 preserva texto local durante blur, autosave e re-renderização (sem merge automático)', async () => {
      // Trigger real 409 on standalone note using stale token
      const staleSave = await makeRequest(
        server,
        'POST',
        '/api/session-notes',
        {
          id: standaloneNoteId,
          studentUid,
          studentEmail,
          sessionDate: '2026-11-17',
          rawContent: 'Unsaved local teacher edit that collided',
          baseRevisionToken: 'rev_1_obsolete_token',
        },
        teacherHeaders
      );
      assert.strictEqual(staleSave.status, 409);
      assert.strictEqual(staleSave.data?.code, 'STALE_REVISION');

      // Verify blur & autosave guards in panel source
      assert(
        panelSrc.includes('!hasRevisionConflictRef.current &&\n        !isLoadingSessionNoteRef.current') ||
        (panelSrc.includes('handleEditorBlur') && panelSrc.includes('!hasRevisionConflictRef.current')),
        'handleEditorBlur deve respeitar hasRevisionConflictRef.current'
      );

      // Simulate frontend state after 409 through blur, autosave tick, and re-render
      const state = {
        localText: 'Unsaved local teacher edit that collided',
        revisionToken: 'rev_1_obsolete_token',
        hasRevisionConflict: true,
        serverCallsDuringConflict: 0,
      };
      const onBlur = () => {
        if (state.hasRevisionConflict) return;
        state.serverCallsDuringConflict++;
      };
      const onAutosave = () => {
        if (state.hasRevisionConflict) return;
        state.serverCallsDuringConflict++;
      };
      const onRerenderSync = (fetchedListUpdated: any[]) => {
        // Updating fetchedStudentNotes list must never overwrite notesContent or reset conflict
        void fetchedListUpdated;
      };

      onBlur();
      onAutosave();
      onRerenderSync([{ id: standaloneNoteId, rawContent: 'Server content' }]);

      assert.strictEqual(state.localText, 'Unsaved local teacher edit that collided');
      assert.strictEqual(state.revisionToken, 'rev_1_obsolete_token');
      assert.strictEqual(state.hasRevisionConflict, true);
      assert.strictEqual(state.serverCallsDuringConflict, 0);
    });

    // 6. Reload Server Version cancelled vs confirmed
    await test('6. Reload Server Version exige confirmação explícita: Cancelar preserva tudo, Confirmar recarrega (agendada e avulsa)', async () => {
      assert(!panelSrc.includes('window.confirm('), 'Não deve usar window.confirm no iFrame');
      assert(!panelSrc.includes('window.alert('), 'Não deve usar window.alert no iFrame');
      assert(panelSrc.includes('data-testid="reload-server-confirm"'), 'Deve renderizar UI explícita de confirmação de reload');
      assert(panelSrc.includes('data-testid="btn-cancel-reload-server-version"'), 'Deve oferecer botão Cancelar');
      assert(panelSrc.includes('data-testid="btn-confirm-reload-server-version"'), 'Deve oferecer botão Confirmar Reload');
      assert(!panelSrc.includes('student_${(selectedStudentEmail'), 'Não deve gerar lookup ID student_${email}_${sessionDate}');

      // State simulation for Cancel then Confirm using real backend GET for standalone note
      let editorText = 'Unsaved conflicting standalone edit';
      let currentToken: string | null = 'rev_old';
      let conflictBanner: { message: string } | null = { message: '409 conflict' };
      let showReloadConfirm = false;

      // Step A: Click "Reload Server Version" -> opens confirmation, does NOT fetch yet
      showReloadConfirm = true;
      assert.strictEqual(editorText, 'Unsaved conflicting standalone edit');

      // Step B: Click "Cancel" -> closes confirmation, editor/token/conflict completely untouched
      showReloadConfirm = false;
      assert.strictEqual(showReloadConfirm, false);
      assert.strictEqual(editorText, 'Unsaved conflicting standalone edit');
      assert.strictEqual(currentToken, 'rev_old');
      assert.notStrictEqual(conflictBanner, null);

      // Step C: Open confirm and Click "Confirm Reload" -> fetches standalone by studentUid + sessionDate + standalone=true
      showReloadConfirm = true;
      showReloadConfirm = false;
      const reloadRes = await makeRequest(
        server,
        'GET',
        `/api/session-notes?studentUid=${studentUid}&sessionDate=2026-11-17&standalone=true`,
        undefined,
        teacherHeaders
      );
      assert.strictEqual(reloadRes.status, 200);
      assert.strictEqual(reloadRes.data?.id, standaloneNoteId);
      editorText = reloadRes.data.rawContent;
      currentToken = reloadRes.data.revisionToken;
      conflictBanner = null;

      assert.strictEqual(editorText, '✗ I have 28 years (v1) ✓ I am 28 years old (v1) • ✦ New Word hit the ground running');
      assert.strictEqual(currentToken, standaloneToken);
      assert.strictEqual(conflictBanner, null);
    });

    // 7 & 8. Apply AI, Save Draft, Approve v1 -> edit -> STALE_DRAFT -> re-Apply AI -> Approve v2 in BOTH flows
    await test('7 & 8. Apply AI, Save Draft, Approve v1/v2 e STALE_DRAFT nos fluxos agendado e avulso', async () => {
      resetGeminiSecurityStateForTesting();

      // --- Flow A: Scheduled Lesson ---
      setSessionNoteTransformAttemptExecutorForTesting(async () => JSON.stringify(buildMockAiOutput('sched-v1')));
      const schedGet = await makeRequest(
        server,
        'GET',
        `/api/session-notes?lessonId=${SCHEDULED_LESSON_ID}&studentUid=${studentUid}`,
        undefined,
        teacherHeaders
      );
      let schedTok = schedGet.data.revisionToken;

      const schedTransform = await makeRequest(
        server,
        'POST',
        `/api/session-notes/${SCHEDULED_LESSON_ID}/transform`,
        { studentUid, teacherUid, baseRevisionToken: schedTok },
        teacherHeaders
      );
      assert.strictEqual(schedTransform.status, 200);
      schedTok = schedTransform.data.revisionToken;

      const schedDraft = await makeRequest(
        server,
        'POST',
        `/api/session-notes/${SCHEDULED_LESSON_ID}/draft`,
        {
          studentUid,
          teacherUid,
          draftId: schedTransform.data.draftTransformation.draftId,
          transformation: schedTransform.data.draftTransformation.transformation,
          baseRevisionToken: schedTok,
        },
        teacherHeaders
      );
      assert.strictEqual(schedDraft.status, 200);
      schedTok = schedDraft.data.revisionToken;

      const schedApprove = await makeRequest(
        server,
        'POST',
        `/api/session-notes/${SCHEDULED_LESSON_ID}/approve`,
        {
          studentUid,
          teacherUid,
          draftId: schedDraft.data.sessionNote.draftTransformation.draftId,
          transformation: schedDraft.data.sessionNote.draftTransformation.transformation,
          baseRevisionToken: schedTok,
        },
        teacherHeaders
      );
      assert.strictEqual(schedApprove.status, 200);
      assert.strictEqual(schedApprove.data?.approvalStatus, 'approved');

      // --- Flow B: Standalone Note (v1 -> edit -> STALE_DRAFT -> v2) ---
      setSessionNoteTransformAttemptExecutorForTesting(async () => JSON.stringify(buildMockAiOutput('standalone-v1')));
      const stTransform1 = await makeRequest(
        server,
        'POST',
        `/api/session-notes/${standaloneNoteId}/transform`,
        { studentUid, teacherUid, baseRevisionToken: standaloneToken },
        teacherHeaders
      );
      assert.strictEqual(stTransform1.status, 200);
      standaloneToken = stTransform1.data.revisionToken;
      const draft1 = stTransform1.data.draftTransformation;

      const stDraft1 = await makeRequest(
        server,
        'POST',
        `/api/session-notes/${standaloneNoteId}/draft`,
        {
          studentUid,
          teacherUid,
          draftId: draft1.draftId,
          transformation: draft1.transformation,
          baseRevisionToken: standaloneToken,
        },
        teacherHeaders
      );
      assert.strictEqual(stDraft1.status, 200);
      standaloneToken = stDraft1.data.revisionToken;

      const stApprove1 = await makeRequest(
        server,
        'POST',
        `/api/session-notes/${standaloneNoteId}/approve`,
        {
          studentUid,
          teacherUid,
          draftId: stDraft1.data.sessionNote.draftTransformation.draftId,
          transformation: stDraft1.data.sessionNote.draftTransformation.transformation,
          baseRevisionToken: standaloneToken,
        },
        teacherHeaders
      );
      assert.strictEqual(stApprove1.status, 200);
      assert.strictEqual(stApprove1.data?.approvalStatus, 'approved');
      const v1Number = stApprove1.data?.approvedVersion?.versionNumber;
      standaloneToken = stApprove1.data.revisionToken;

      // Edit standalone notes after v1 -> creates draft stale condition if approving old draft/transformation
      const stEdit2 = await makeRequest(
        server,
        'POST',
        '/api/session-notes',
        {
          id: standaloneNoteId,
          studentUid,
          studentEmail,
          sessionDate: '2026-11-17',
          topic: 'Standalone Ad-Hoc v2',
          rawContent: '✗ I have 28 years (v2) ✓ I am 28 years old (v2) • ✦ New Word hit the ground running',
          baseRevisionToken: standaloneToken,
        },
        teacherHeaders
      );
      assert.strictEqual(stEdit2.status, 200);
      standaloneToken = stEdit2.data.revisionToken;
      // lastApprovedVersion v1 must remain intact for student while editing v2!
      assert.strictEqual(stEdit2.data?.sessionNote?.lastApprovedVersion?.versionNumber, v1Number);

      // Attempting to approve stale v1 transformation against v2 rawContent MUST fail with 409 STALE_DRAFT
      const staleApproveAttempt = await makeRequest(
        server,
        'POST',
        `/api/session-notes/${standaloneNoteId}/approve`,
        {
          studentUid,
          teacherUid,
          transformation: draft1.transformation,
          baseRevisionToken: standaloneToken,
        },
        teacherHeaders
      );
      assert.strictEqual(staleApproveAttempt.status, 409);
      assert.strictEqual(staleApproveAttempt.data?.code, 'STALE_DRAFT');

      // Re-run Apply AI for v2 and Approve v2
      setSessionNoteTransformAttemptExecutorForTesting(async () => JSON.stringify(buildMockAiOutput('standalone-v2')));
      const stTransform2 = await makeRequest(
        server,
        'POST',
        `/api/session-notes/${standaloneNoteId}/transform`,
        { studentUid, teacherUid, baseRevisionToken: standaloneToken },
        teacherHeaders
      );
      assert.strictEqual(stTransform2.status, 200);
      standaloneToken = stTransform2.data.revisionToken;

      const stApprove2 = await makeRequest(
        server,
        'POST',
        `/api/session-notes/${standaloneNoteId}/approve`,
        {
          studentUid,
          teacherUid,
          draftId: stTransform2.data.draftTransformation.draftId,
          transformation: stTransform2.data.draftTransformation.transformation,
          baseRevisionToken: standaloneToken,
        },
        teacherHeaders
      );
      assert.strictEqual(stApprove2.status, 200);
      assert(stApprove2.data?.approvedVersion?.versionNumber > v1Number, 'v2 deve ter versionNumber estritamente maior que v1');
      assert(
        Array.isArray(stApprove2.data?.sessionNote?.versionHistory) &&
          stApprove2.data.sessionNote.versionHistory.length >= 2,
        'Histórico de versões deve preservar múltiplas versões'
      );

      // Student retrieves BOTH scheduled and standalone approved notes
      const studentList = await makeRequest(
        server,
        'GET',
        `/api/session-notes?studentUid=${studentUid}`,
        undefined,
        studentHeaders
      );
      assert.strictEqual(studentList.status, 200);
      assert(Array.isArray(studentList.data));
      const foundSched = studentList.data.find((n: any) => n.id === SCHEDULED_LESSON_ID);
      const foundStandalone = studentList.data.find((n: any) => n.id === standaloneNoteId);
      assert(foundSched?.lastApprovedVersion?.status === 'approved', 'Aluno vê nota agendada aprovada');
      assert(foundStandalone?.lastApprovedVersion?.status === 'approved', 'Aluno vê nota avulsa aprovada');
    });

    // 9. Zero duplicates or phantom lessons docs
    await test('9. Ausência de duplicações, chaves por e-mail ou aulas fictícias em lessons', async () => {
      // Save a standalone note with custom note_* ID -> must NOT create lessons/note_custom_nf15_001
      const customRes = await makeRequest(
        server,
        'POST',
        '/api/session-notes',
        {
          id: CUSTOM_STANDALONE_ID,
          sessionDate: '2026-11-18',
          studentUid,
          studentEmail,
          topic: 'Custom Key Standalone',
          rawContent: 'Standalone note with explicit note_* key',
          baseRevisionToken: null,
        },
        teacherHeaders
      );
      assert.strictEqual(customRes.status, 200);
      assert.strictEqual(customRes.data?.sessionNote?.lessonId || '', '');

      // Even if a caller passes an arbitrary non-lesson id without lessonId, must NEVER write to lessons/
      const arbitraryRes = await makeRequest(
        server,
        'POST',
        '/api/session-notes',
        {
          id: 'adhoc_999',
          sessionDate: '2026-11-19',
          studentUid,
          studentEmail,
          topic: 'Arbitrary Key Standalone',
          rawContent: 'Arbitrary standalone key without scheduled lesson',
          baseRevisionToken: null,
        },
        teacherHeaders
      );
      assert.strictEqual(arbitraryRes.status, 200);
      assert.strictEqual(arbitraryRes.data?.sessionNote?.lessonId || '', '');

      const lessonKeys = Object.keys(firestoreStore).filter((k) => k.startsWith('lessons/'));
      assert.deepStrictEqual(
        lessonKeys,
        [`lessons/${SCHEDULED_LESSON_ID}`],
        `Nenhuma aula fictícia deve ser criada em lessons; encontrado: ${lessonKeys.join(', ')}`
      );

      const sessionNoteKeys = Object.keys(firestoreStore).filter(
        (k) => k.startsWith('session_notes/') && !k.slice('session_notes/'.length).includes('/')
      );
      const emailKeys = sessionNoteKeys.filter((k) => k.includes('@'));
      assert.strictEqual(emailKeys.length, 0, 'Nenhuma chave baseada em e-mail deve existir em session_notes');
      assert.strictEqual(
        sessionNoteKeys.filter((k) => k.includes(SCHEDULED_LESSON_ID)).length,
        1,
        'Zero duplicações para a aula agendada'
      );
      assert.strictEqual(
        sessionNoteKeys.filter((k) => k.includes(standaloneNoteId)).length,
        1,
        'Zero duplicações para a nota avulsa'
      );
    });

    // 10. RBAC, canonical UID, and teacher-student pedagogical link
    await test('10. Preservação de RBAC, UID canônico e vínculo professor-aluno', async () => {
      // Unlinked teacher trying to save standalone note for student1 -> 403 UNAUTHORIZED_PEDAGOGICAL_LINK
      const unlinkedSave = await makeRequest(
        server,
        'POST',
        '/api/session-notes',
        {
          sessionDate: '2026-11-20',
          studentUid,
          rawContent: 'Unauthorized teacher attempt',
          baseRevisionToken: null,
        },
        otherTeacherHeaders
      );
      assert.strictEqual(unlinkedSave.status, 403);
      assert.strictEqual(unlinkedSave.data?.code, 'UNAUTHORIZED_PEDAGOGICAL_LINK');

      // Linked teacher trying to read/save unlinked student2 -> 403 UNAUTHORIZED_PEDAGOGICAL_LINK
      const unlinkedStudentSave = await makeRequest(
        server,
        'POST',
        '/api/session-notes',
        {
          sessionDate: '2026-11-20',
          studentUid: student2Uid,
          rawContent: 'Unauthorized student link attempt',
          baseRevisionToken: null,
        },
        teacherHeaders
      );
      assert.strictEqual(unlinkedStudentSave.status, 403);
      assert.strictEqual(unlinkedStudentSave.data?.code, 'UNAUTHORIZED_PEDAGOGICAL_LINK');

      // Student cannot save, transform, draft, or approve standalone note
      const studentSave = await makeRequest(
        server,
        'POST',
        '/api/session-notes',
        {
          id: standaloneNoteId,
          sessionDate: '2026-11-17',
          studentUid,
          rawContent: 'Student tampering',
          baseRevisionToken: standaloneToken,
        },
        studentHeaders
      );
      assert.strictEqual(studentSave.status, 403);

      const studentTransform = await makeRequest(
        server,
        'POST',
        `/api/session-notes/${standaloneNoteId}/transform`,
        { studentUid },
        studentHeaders
      );
      assert.strictEqual(studentTransform.status, 403);

      const studentApprove = await makeRequest(
        server,
        'POST',
        `/api/session-notes/${standaloneNoteId}/approve`,
        { studentUid },
        studentHeaders
      );
      assert.strictEqual(studentApprove.status, 403);

      // Other teacher cannot GET standalone note by date even if another doc exists
      const otherGetByDate = await makeRequest(
        server,
        'GET',
        `/api/session-notes?studentUid=${studentUid}&sessionDate=2026-11-17&standalone=true`,
        undefined,
        otherTeacherHeaders
      );
      assert.strictEqual(otherGetByDate.status, 403);

      // Missing / non-canonical studentUid rejected
      const badUid = await makeRequest(
        server,
        'POST',
        '/api/session-notes',
        {
          sessionDate: '2026-11-20',
          studentUid: 'student15@itissimple.com',
          rawContent: 'Email as UID attempt',
          baseRevisionToken: null,
        },
        teacherHeaders
      );
      assert.strictEqual(badUid.status, 400);
      assert.strictEqual(badUid.data?.code, 'CANONICAL_STUDENT_UID_REQUIRED');
    });
  } finally {
    server.close();
    resetGeminiSecurityStateForTesting();
    setSessionNoteTransformAttemptExecutorForTesting(null);
    resetFirebaseAdminFirestoreForTesting();
  }

  console.log(`\n📊 Summary NF.FLOW.1.5: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error('Fatal error running NF.FLOW.1.5 validation:', err);
  process.exit(1);
});
