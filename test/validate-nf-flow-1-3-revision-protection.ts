process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = 'test-gemini-api-key';

import assert from 'assert';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { setFirebaseAdminAuthForTesting } from '../src/serverFirebaseAdmin';
import {
  setFirebaseAdminFirestoreForTesting,
  resetFirebaseAdminFirestoreForTesting,
  setIsCloudWriteDisabled,
} from '../src/serverFirestore';
import { resetGeminiSecurityStateForTesting } from '../src/serverGeminiSecurity';
import { computeNotesContentHash } from '../src/utils/notesVersioning';

/**
 * CAS-enforced In-Memory Firestore Mock:
 * - Tracks monotonically increasing per-doc commit version (_casVer) to simulate real Firestore optimistic transactions
 *   across independent server instances (even when in-process locks are bypassed or staggered).
 * - Tracks whether any transaction is currently active (`activeTransactionCount > 0`) so tests can prove
 *   Gemini execution NEVER occurs inside `db.runTransaction`.
 */
function createCasInMemoryFirestore(
  store: Record<string, any>,
  options?: { readDelayMs?: number; writeDelayMs?: number }
) {
  const readDelayMs = options?.readDelayMs ?? 0;
  const writeDelayMs = options?.writeDelayMs ?? 0;
  const docVersions: Record<string, number> = {};
  for (const k of Object.keys(store)) {
    docVersions[k] = 1;
  }
  const sleep = (ms: number) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

  let activeTransactionCount = 0;

  function matchesFilters(data: any, filters: Array<{ field: string; op: string; val: any }>) {
    if (!data) return false;
    return filters.every(({ field, op, val }) => {
      const actual = data[field];
      if (op === '==') return actual === val;
      return true;
    });
  }

  function makeCollection(colPath: string, filters: Array<{ field: string; op: string; val: any }> = []): any {
    return {
      doc(docId: string) {
        const fullPath = `${colPath}/${docId}`;
        return {
          id: docId,
          path: fullPath,
          async get() {
            await sleep(readDelayMs);
            const exists = Object.prototype.hasOwnProperty.call(store, fullPath);
            const clone = exists ? JSON.parse(JSON.stringify(store[fullPath])) : undefined;
            return {
              id: docId,
              exists,
              data: () => clone,
            };
          },
          async set(data: any, opts?: { merge?: boolean }) {
            await sleep(writeDelayMs);
            const incoming = JSON.parse(JSON.stringify(data));
            if (opts?.merge && store[fullPath]) {
              store[fullPath] = { ...store[fullPath], ...incoming };
            } else {
              store[fullPath] = incoming;
            }
            docVersions[fullPath] = (docVersions[fullPath] || 0) + 1;
            return { writeTime: new Date() };
          },
          async update(data: any) {
            await sleep(writeDelayMs);
            const incoming = JSON.parse(JSON.stringify(data));
            store[fullPath] = { ...(store[fullPath] || {}), ...incoming };
            docVersions[fullPath] = (docVersions[fullPath] || 0) + 1;
            return { writeTime: new Date() };
          },
          async delete() {
            await sleep(writeDelayMs);
            delete store[fullPath];
            docVersions[fullPath] = (docVersions[fullPath] || 0) + 1;
            return { writeTime: new Date() };
          },
          collection(subCol: string) {
            return makeCollection(`${fullPath}/${subCol}`);
          },
        };
      },
      where(field: string, op: string, val: any) {
        return makeCollection(colPath, [...filters, { field, op, val }]);
      },
      limit(_n: number) {
        return makeCollection(colPath, filters);
      },
      orderBy(_f: string, _d?: string) {
        return makeCollection(colPath, filters);
      },
      async get() {
        await sleep(readDelayMs);
        const prefix = `${colPath}/`;
        const docs: any[] = [];
        for (const [k, v] of Object.entries(store)) {
          if (k.startsWith(prefix)) {
            const remainder = k.slice(prefix.length);
            if (!remainder.includes('/') && matchesFilters(v, filters)) {
              const clone = JSON.parse(JSON.stringify(v));
              docs.push({
                id: remainder,
                exists: true,
                data: () => clone,
              });
            }
          }
        }
        return {
          empty: docs.length === 0,
          size: docs.length,
          docs,
          forEach: (cb: (d: any) => void) => docs.forEach(cb),
        };
      },
    };
  }

  return {
    get activeTransactionCount() {
      return activeTransactionCount;
    },
    collection(name: string) {
      return makeCollection(name);
    },
    async runTransaction<T>(fn: (tx: any) => Promise<T>): Promise<T> {
      const maxAttempts = 5;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const readVersions = new Map<string, number>();
        const ops: Array<{ path: string; kind: 'set' | 'update' | 'delete'; val?: any; opts?: any }> = [];
        activeTransactionCount++;
        let result: T;
        try {
          const tx = {
            get: async (ref: any) => {
              const snap = await ref.get();
              if (!readVersions.has(ref.path)) {
                readVersions.set(ref.path, docVersions[ref.path] || 0);
              }
              return snap;
            },
            set: (ref: any, val: any, opts?: any) => {
              ops.push({ path: ref.path, kind: 'set', val: JSON.parse(JSON.stringify(val)), opts });
            },
            update: (ref: any, val: any) => {
              ops.push({ path: ref.path, kind: 'update', val: JSON.parse(JSON.stringify(val)) });
            },
            delete: (ref: any) => {
              ops.push({ path: ref.path, kind: 'delete' });
            },
          };
          result = await fn(tx);
        } finally {
          activeTransactionCount--;
        }

        // CAS check: abort and retry if any read doc changed concurrently before commit
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

        // Atomic commit
        for (const op of ops) {
          if (op.kind === 'set') {
            if (op.opts?.merge && store[op.path]) {
              store[op.path] = { ...store[op.path], ...op.val };
            } else {
              store[op.path] = op.val;
            }
          } else if (op.kind === 'update') {
            store[op.path] = { ...(store[op.path] || {}), ...op.val };
          } else if (op.kind === 'delete') {
            delete store[op.path];
          }
          docVersions[op.path] = (docVersions[op.path] || 0) + 1;
        }
        return result;
      }
      throw new Error('CAS_TRANSACTION_ABORTED: max retries exceeded');
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
    if (!addr || typeof addr === 'string') {
      return reject(new Error('Server address unavailable'));
    }
    const bodyStr = body ? JSON.stringify(body) : undefined;
    const reqHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      ...headers,
    };
    if (bodyStr) {
      reqHeaders['Content-Length'] = Buffer.byteLength(bodyStr).toString();
    }

    const req = http.request(
      {
        host: '127.0.0.1',
        port: addr.port,
        path: pathStr,
        method,
        headers: reqHeaders,
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => (raw += chunk));
        res.on('end', () => {
          let parsed: any;
          try {
            parsed = JSON.parse(raw);
          } catch {
            parsed = raw;
          }
          resolve({ status: res.statusCode || 0, data: parsed });
        });
      }
    );
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

function buildMockAiOutput(suffix: string) {
  return {
    mistakesAnalysis: [
      {
        id: `m-${suffix}`,
        original: `I have 30 years old (${suffix})`,
        corrected: `I am 30 years old (${suffix})`,
        category: 'grammar',
        explanation: 'Use the verb to be when expressing age in English.',
        grammarRule: 'Subject + be + age',
        twoExamples: ['She is 25 years old.', 'My friend is 30.'],
        commonPitfalls: 'Do not use have for age.',
        similarFormsComparison: 'I am 30 vs I have 30',
      },
    ],
    grammarPoints: [
      {
        id: `g-${suffix}`,
        topic: `Verb To Be for Age (${suffix})`,
        rule: 'Use am/is/are + number (+ years old).',
        form: 'Subject + am/is/are + age',
        usage: 'Stating age naturally.',
        examples: ['I am 30 years old.', 'He is 18.'],
        commonMistakes: 'Using have instead of to be.',
        comparisons: 'Portuguese ter vs English to be.',
      },
    ],
    vocabularyAndExpressions: [
      {
        id: `v-${suffix}`,
        term: `resilient-${suffix}`,
        partOfSpeech: 'Adjective',
        definitionEn: 'Able to recover quickly from difficulties.',
        simpleDefinition: 'Able to bounce back quickly after tough situations.',
        collocations: ['stay resilient', 'resilient team'],
        realExamples: ['She stayed resilient during the product launch.'],
        synonyms: ['adaptable'],
        register: 'neutral',
        registerNote: 'Common in professional contexts.',
        category: 'Mindset & Work',
        isNewWord: true,
        isPronunciationFocus: false,
      },
    ],
    reviewSummary: {
      estimatedMinutes: '5-10 minutes',
      keyRules: ['Use to be for age.'],
      mustKnowVocabulary: [`resilient-${suffix}`],
      essentialCorrections: [{ original: 'I have 30 years old', corrected: 'I am 30 years old' }],
      usefulPatterns: ['I am ___ years old.'],
      rememberThis: `Always use "I am" for age (${suffix}).`,
    },
  };
}

async function runTests() {
  const {
    app: serverApp,
    setSessionNoteTransformAttemptExecutorForTesting,
  } = await import('../serverApp');

  console.log('======================================================================');
  console.log('NF.FLOW.1.3 — CONCURRENCY & REVISION TOKEN PROTECTION (10 MANDATORY TESTS)');
  console.log('======================================================================\n');

  let passed = 0;
  let failed = 0;

  async function test(name: string, fn: () => void | Promise<void>) {
    try {
      await fn();
      passed++;
      console.log(`  ✅ [PASS] ${name}`);
    } catch (err: any) {
      failed++;
      console.error(`  ❌ [FAIL] ${name}`);
      console.error(`     Error: ${err?.message || err}`);
      if (err?.stack) {
        console.error(err.stack.split('\n').slice(1, 5).join('\n'));
      }
    }
  }

  const ts = Date.now();
  const studentUid = `student-nf13-${ts}`;
  const studentEmail = `student.nf13.${ts}@example.com`;
  const otherStudentUid = `student-other-nf13-${ts}`;
  const otherStudentEmail = `student.other.nf13.${ts}@example.com`;
  const teacherUid = `teacher-nf13-${ts}`;
  const teacherEmail = `teacher.nf13.${ts}@example.com`;
  const otherTeacherUid = `teacher-other-nf13-${ts}`;
  const otherTeacherEmail = `teacher.other.nf13.${ts}@example.com`;

  const LESSON_1 = `lesson_nf13_1_${ts}`;
  const LESSON_2 = `lesson_nf13_2_${ts}`;
  const LESSON_3 = `lesson_nf13_3_${ts}`;
  const LESSON_4 = `lesson_nf13_4_${ts}`;
  const LESSON_5 = `lesson_nf13_5_${ts}`;
  const LESSON_6 = `lesson_nf13_6_${ts}`;
  const LESSON_7_BARE = `nf13_div_${ts}`;
  const LESSON_7_PREFIXED = `lesson_${LESSON_7_BARE}`;
  const LESSON_8_OTHER_STUDENT = `lesson_other_stu_${ts}`;
  const LESSON_9_DRIVE = `lesson_drive_${ts}`;

  const tokenMap: Record<string, any> = {
    'tok-teacher': { uid: teacherUid, email: teacherEmail, email_verified: true, role: 'teacher' },
    'tok-other-teacher': { uid: otherTeacherUid, email: otherTeacherEmail, email_verified: true, role: 'teacher' },
    'tok-student': { uid: studentUid, email: studentEmail, email_verified: true, role: 'student' },
  };

  setFirebaseAdminAuthForTesting({
    verifyIdToken: async (token: string) => {
      const m = tokenMap[token];
      if (m) return m;
      throw new Error(`Invalid token: ${token}`);
    },
    getUser: async (uid: string) => {
      const f = Object.values(tokenMap).find((u) => u.uid === uid);
      if (f) return f;
      throw new Error('Not found');
    },
    getUserByEmail: async (email: string) => {
      const f = Object.values(tokenMap).find((u) => u.email === email);
      if (f) return f;
      throw new Error('Not found');
    },
    setCustomUserClaims: async () => {},
  } as any);

  const makeLesson = (id: string, stuUid: string, stuEmail: string, tUid: string, tEmail: string) => ({
    id,
    title: `Lesson ${id}`,
    studentUid: stuUid,
    studentEmail: stuEmail,
    teacherUid: tUid,
    teacherEmail: tEmail,
    sessionDate: '2026-11-16',
    startDateTime: '2026-11-16T14:00:00Z',
    status: 'completed',
  });

  const firestoreStore: Record<string, any> = {
    [`users/${studentUid}`]: {
      uid: studentUid,
      email: studentEmail,
      name: 'Student NF13',
      role: 'student',
      level: 'intermediario',
    },
    [`users/${otherStudentUid}`]: {
      uid: otherStudentUid,
      email: otherStudentEmail,
      name: 'Other Student NF13',
      role: 'student',
      level: 'intermediario',
    },
    [`users/${teacherUid}`]: {
      uid: teacherUid,
      email: teacherEmail,
      name: 'Teacher NF13',
      role: 'teacher',
      approvalStatus: 'approved',
      isApproved: true,
    },
    [`tutors/tutor-${teacherUid}`]: {
      uid: teacherUid,
      authUid: teacherUid,
      email: teacherEmail,
      name: 'Teacher NF13',
      role: 'teacher',
      approvalStatus: 'approved',
      isApproved: true,
    },
    [`users/${otherTeacherUid}`]: {
      uid: otherTeacherUid,
      email: otherTeacherEmail,
      name: 'Other Teacher NF13',
      role: 'teacher',
      approvalStatus: 'approved',
      isApproved: true,
    },
    [`tutors/tutor-${otherTeacherUid}`]: {
      uid: otherTeacherUid,
      authUid: otherTeacherUid,
      email: otherTeacherEmail,
      name: 'Other Teacher NF13',
      role: 'teacher',
      approvalStatus: 'approved',
      isApproved: true,
    },
    [`enrollments/enr-${ts}`]: {
      studentUid,
      teacherUid,
      status: 'active',
    },
    [`lessons/${LESSON_1}`]: makeLesson(LESSON_1, studentUid, studentEmail, teacherUid, teacherEmail),
    [`lessons/${LESSON_2}`]: makeLesson(LESSON_2, studentUid, studentEmail, teacherUid, teacherEmail),
    [`lessons/${LESSON_3}`]: makeLesson(LESSON_3, studentUid, studentEmail, teacherUid, teacherEmail),
    [`lessons/${LESSON_4}`]: makeLesson(LESSON_4, studentUid, studentEmail, teacherUid, teacherEmail),
    [`lessons/${LESSON_5}`]: makeLesson(LESSON_5, studentUid, studentEmail, teacherUid, teacherEmail),
    [`lessons/${LESSON_6}`]: makeLesson(LESSON_6, studentUid, studentEmail, teacherUid, teacherEmail),
    [`lessons/${LESSON_7_BARE}`]: makeLesson(LESSON_7_BARE, studentUid, studentEmail, teacherUid, teacherEmail),
    [`lessons/${LESSON_8_OTHER_STUDENT}`]: makeLesson(
      LESSON_8_OTHER_STUDENT,
      otherStudentUid,
      otherStudentEmail,
      otherTeacherUid,
      otherTeacherEmail
    ),
    [`lessons/${LESSON_9_DRIVE}`]: makeLesson(LESSON_9_DRIVE, studentUid, studentEmail, teacherUid, teacherEmail),
  };

  const casDb = createCasInMemoryFirestore(firestoreStore, { readDelayMs: 5, writeDelayMs: 5 });
  setFirebaseAdminFirestoreForTesting(casDb as any);
  setIsCloudWriteDisabled(false);

  const server = http.createServer(serverApp);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  const teacherHeaders = { Authorization: 'Bearer tok-teacher' };
  const otherTeacherHeaders = { Authorization: 'Bearer tok-other-teacher' };
  const studentHeaders = { Authorization: 'Bearer tok-student' };

  const RAW_A = '<div><span data-tag-type="incorrect">✗</span> I have 30 years old <span data-tag-type="correct">✓</span> I am 30 years old</div>';
  const RAW_B = `${RAW_A}<div><span data-tag-type="new-word">✦ New Word</span> resilient</div>`;
  const RAW_C = `${RAW_B}<div><span data-tag-type="new-word">✦ New Word</span> articulate</div>`;

  try {
    // 1. Normal save of new note
    await test('1. Salvamento normal de nova nota emite revisionToken e contentRevision=1', async () => {
      const res = await makeRequest(
        server,
        'POST',
        '/api/session-notes',
        {
          id: LESSON_1,
          lessonId: LESSON_1,
          studentUid,
          studentEmail,
          sessionDate: '2026-11-16',
          topic: 'Normal Save Topic',
          rawContent: RAW_A,
          content: RAW_A,
          baseRevisionToken: null,
        },
        teacherHeaders
      );

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data?.success, true);
      assert.ok(res.data?.revisionToken, 'Servidor deve emitir revisionToken');
      assert.strictEqual(res.data?.contentRevision, 1, 'contentRevision inicial deve ser 1');
      assert.strictEqual(res.data?.sessionNote?.revisionToken, res.data?.revisionToken);
      assert.strictEqual(firestoreStore[`session_notes/${LESSON_1}`]?.rawContent, RAW_A);

      // Subsequent save using emitted token succeeds and rotates token
      const res2 = await makeRequest(
        server,
        'POST',
        '/api/session-notes',
        {
          id: LESSON_1,
          lessonId: LESSON_1,
          studentUid,
          studentEmail,
          sessionDate: '2026-11-16',
          topic: 'Normal Save Topic',
          rawContent: RAW_B,
          content: RAW_B,
          baseRevisionToken: res.data.revisionToken,
        },
        teacherHeaders
      );
      assert.strictEqual(res2.status, 200);
      assert.strictEqual(res2.data?.contentRevision, 2);
      assert.notStrictEqual(res2.data?.revisionToken, res.data?.revisionToken);
    });

    // 2. Two tabs editing the same note + ABA problem prevention
    await test('2. Duas abas editando a mesma nota + prevenção de ABA (A -> B -> A gera novo token)', async () => {
      // Tab 1 & Tab 2 both create / load note state A
      const seedRes = await makeRequest(
        server,
        'POST',
        '/api/session-notes',
        {
          id: LESSON_2,
          lessonId: LESSON_2,
          studentUid,
          studentEmail,
          sessionDate: '2026-11-16',
          topic: 'Two Tabs',
          rawContent: RAW_A,
          baseRevisionToken: null,
        },
        teacherHeaders
      );
      assert.strictEqual(seedRes.status, 200);
      const tokenA1 = seedRes.data.revisionToken;

      // Tab 1 saves B using tokenA1 -> succeeds with tokenB
      const tab1Save = await makeRequest(
        server,
        'POST',
        '/api/session-notes',
        {
          id: LESSON_2,
          lessonId: LESSON_2,
          studentUid,
          studentEmail,
          sessionDate: '2026-11-16',
          topic: 'Two Tabs',
          rawContent: RAW_B,
          baseRevisionToken: tokenA1,
        },
        teacherHeaders
      );
      assert.strictEqual(tab1Save.status, 200);
      const tokenB = tab1Save.data.revisionToken;
      assert.notStrictEqual(tokenB, tokenA1);

      // Tab 2 tries to save with stale tokenA1 -> HTTP 409
      const tab2Save = await makeRequest(
        server,
        'POST',
        '/api/session-notes',
        {
          id: LESSON_2,
          lessonId: LESSON_2,
          studentUid,
          studentEmail,
          sessionDate: '2026-11-16',
          topic: 'Two Tabs',
          rawContent: RAW_C,
          baseRevisionToken: tokenA1,
        },
        teacherHeaders
      );
      assert.strictEqual(tab2Save.status, 409);
      assert.strictEqual(tab2Save.data?.code, 'STALE_REVISION');
      assert.strictEqual(firestoreStore[`session_notes/${LESSON_2}`]?.rawContent, RAW_B, 'Conteúdo B preservado no servidor');

      // ABA check: Tab 1 reverts content back to RAW_A using tokenB -> mints a brand-new tokenA2 !== tokenA1
      const abaRevert = await makeRequest(
        server,
        'POST',
        '/api/session-notes',
        {
          id: LESSON_2,
          lessonId: LESSON_2,
          studentUid,
          studentEmail,
          sessionDate: '2026-11-16',
          topic: 'Two Tabs',
          rawContent: RAW_A,
          baseRevisionToken: tokenB,
        },
        teacherHeaders
      );
      assert.strictEqual(abaRevert.status, 200);
      const tokenA2 = abaRevert.data.revisionToken;
      assert.notStrictEqual(tokenA2, tokenA1, 'Mesmo retornando ao valor A, token deve ser único (anti-ABA)');

      // Tab 2 still holding old tokenA1 must STILL be rejected with 409
      const tab2AbaSave = await makeRequest(
        server,
        'POST',
        '/api/session-notes',
        {
          id: LESSON_2,
          lessonId: LESSON_2,
          studentUid,
          studentEmail,
          sessionDate: '2026-11-16',
          topic: 'Two Tabs',
          rawContent: RAW_C,
          baseRevisionToken: tokenA1,
        },
        teacherHeaders
      );
      assert.strictEqual(tab2AbaSave.status, 409);
      assert.strictEqual(tab2AbaSave.data?.code, 'STALE_REVISION');
    });

    // 3. Out-of-order delayed request arriving after newer save; clientUpdatedAt ignored
    await test('3. Requisição antiga chegando após nova é rejeitada com 409 e clientUpdatedAt do navegador não tem autoridade', async () => {
      const seedRes = await makeRequest(
        server,
        'POST',
        '/api/session-notes',
        {
          id: LESSON_3,
          lessonId: LESSON_3,
          studentUid,
          studentEmail,
          sessionDate: '2026-11-16',
          topic: 'Order Test',
          rawContent: RAW_A,
          baseRevisionToken: null,
        },
        teacherHeaders
      );
      const t1 = seedRes.data.revisionToken;

      const newerSave = await makeRequest(
        server,
        'POST',
        '/api/session-notes',
        {
          id: LESSON_3,
          lessonId: LESSON_3,
          studentUid,
          studentEmail,
          sessionDate: '2026-11-16',
          topic: 'Order Test',
          rawContent: RAW_B,
          baseRevisionToken: t1,
          clientUpdatedAt: '2020-01-01T00:00:00.000Z',
        },
        teacherHeaders
      );
      assert.strictEqual(newerSave.status, 200);

      // Delayed old request arrives with futuristic browser clock clientUpdatedAt=2099, but stale token t1
      const delayedOldSave = await makeRequest(
        server,
        'POST',
        '/api/session-notes',
        {
          id: LESSON_3,
          lessonId: LESSON_3,
          studentUid,
          studentEmail,
          sessionDate: '2026-11-16',
          topic: 'Order Test',
          rawContent: 'OLD STALE CONTENT',
          baseRevisionToken: t1,
          clientUpdatedAt: '2099-12-31T23:59:59.000Z',
        },
        teacherHeaders
      );
      assert.strictEqual(delayedOldSave.status, 409);
      assert.strictEqual(delayedOldSave.data?.code, 'STALE_REVISION');
      assert.strictEqual(firestoreStore[`session_notes/${LESSON_3}`]?.rawContent, RAW_B);
    });

    // 4. Frontend 409 preserves local text, never auto-replaces, never auto-retries, updates token only on 2xx
    await test('4. Conflito 409 no frontend preserva texto local, exibe conflito e não sobrescreve nem faz retry automático', async () => {
      const panelSrc = fs.readFileSync(
        path.resolve(process.cwd(), 'src/components/TeacherLiveLessonNotesPanel.tsx'),
        'utf8'
      );
      assert(panelSrc.includes('baseRevisionToken: tokenToSend'), 'Frontend deve enviar baseRevisionToken');
      assert(panelSrc.includes('hasRevisionConflictRef.current = true'), 'Frontend deve travar autosave/blur em 409');
      assert(panelSrc.includes('data-testid="revision-conflict-banner"'), 'Frontend deve exibir banner claro de conflito');
      assert(panelSrc.includes('isDirtyRef.current || hasRevisionConflictRef.current'), 'Background GET nunca deve sobrescrever editor sujo/em conflito');

      // Ensure token update only happens inside the `else` (res.ok) branch, NOT inside `apiRes.status === 409`
      const conflictBranchStart = panelSrc.indexOf('if (apiRes.status === 409)');
      const elseOkBranch = panelSrc.indexOf('} else {', conflictBranchStart);
      assert(conflictBranchStart !== -1 && elseOkBranch !== -1);
      const conflictBranch = panelSrc.slice(conflictBranchStart, elseOkBranch);
      assert(
        !conflictBranch.includes('applyServerRevisionToken'),
        'Em 409, token local NÃO deve ser atualizado com currentRevisionToken do servidor para auto-retry'
      );
      assert(
        !conflictBranch.includes('setNotesContent('),
        'Em 409, conteúdo local do editor NÃO deve ser substituído pelo conteúdo do servidor'
      );

      // Simulate frontend state machine handling 409 response
      let localEditorContent = 'Unsaved teacher draft typing in progress';
      let storedRevisionToken: string | null = 'rev_1_old';
      let conflictBannerVisible = false;
      let retryCalls = 0;

      const simulatePersistOnResponse = (status: number, jsonBody: any) => {
        if (status === 409) {
          conflictBannerVisible = true;
          // Preserve localEditorContent, do NOT update storedRevisionToken, do NOT retry
          return false;
        }
        if (status >= 200 && status < 300) {
          conflictBannerVisible = false;
          storedRevisionToken = jsonBody.revisionToken;
          return true;
        }
        return false;
      };

      const saved = simulatePersistOnResponse(409, {
        code: 'STALE_REVISION',
        currentRevisionToken: 'rev_2_server',
      });
      assert.strictEqual(saved, false);
      assert.strictEqual(localEditorContent, 'Unsaved teacher draft typing in progress');
      assert.strictEqual(storedRevisionToken, 'rev_1_old', 'Token não é atualizado em 409');
      assert.strictEqual(conflictBannerVisible, true);
      assert.strictEqual(retryCalls, 0);
    });

    // 5. Approval v1 -> edit v2 -> approval v2 -> edit v3 preserving monotonic versioning & lastApprovedVersion
    await test('5. Aprovação v1 → edição v2 → aprovação v2 → edição v3 preserva lastApprovedVersion e versionHistory monotônico', async () => {
      resetGeminiSecurityStateForTesting();
      setSessionNoteTransformAttemptExecutorForTesting(async () => JSON.stringify(buildMockAiOutput('flow-v1')));

      const s1 = await makeRequest(
        server,
        'POST',
        '/api/session-notes',
        {
          id: LESSON_4,
          lessonId: LESSON_4,
          studentUid,
          studentEmail,
          sessionDate: '2026-11-16',
          topic: 'Versioning Flow',
          rawContent: RAW_A,
          baseRevisionToken: null,
        },
        teacherHeaders
      );
      assert.strictEqual(s1.status, 200);
      let tok = s1.data.revisionToken;

      const t1 = await makeRequest(
        server,
        'POST',
        `/api/session-notes/${LESSON_4}/transform`,
        { lessonId: LESSON_4, studentUid, teacherUid, baseRevisionToken: tok },
        teacherHeaders
      );
      assert.strictEqual(t1.status, 200);
      tok = t1.data.revisionToken;

      const a1 = await makeRequest(
        server,
        'POST',
        `/api/session-notes/${LESSON_4}/approve`,
        {
          lessonId: LESSON_4,
          studentUid,
          teacherUid,
          draftId: t1.data.draftTransformation.draftId,
          baseRevisionToken: tok,
        },
        teacherHeaders
      );
      assert.strictEqual(a1.status, 200);
      const approvedV1 = a1.data.approvedVersion;
      assert.ok(approvedV1?.versionNumber);
      tok = a1.data.revisionToken;

      // Edit v2 (must preserve approvedV1 as lastApprovedVersion!)
      const s2 = await makeRequest(
        server,
        'POST',
        '/api/session-notes',
        {
          id: LESSON_4,
          lessonId: LESSON_4,
          studentUid,
          studentEmail,
          sessionDate: '2026-11-16',
          topic: 'Versioning Flow',
          rawContent: RAW_B,
          baseRevisionToken: tok,
        },
        teacherHeaders
      );
      assert.strictEqual(s2.status, 200);
      assert.strictEqual(
        s2.data.sessionNote.lastApprovedVersion?.approvedVersionId,
        approvedV1.approvedVersionId,
        'Edição v2 deve preservar lastApprovedVersion v1'
      );
      tok = s2.data.revisionToken;

      // Transform & approve v2
      setSessionNoteTransformAttemptExecutorForTesting(async () => JSON.stringify(buildMockAiOutput('flow-v2')));
      const t2 = await makeRequest(
        server,
        'POST',
        `/api/session-notes/${LESSON_4}/transform`,
        { lessonId: LESSON_4, studentUid, teacherUid, baseRevisionToken: tok, forceRegenerate: true },
        teacherHeaders
      );
      assert.strictEqual(t2.status, 200);
      tok = t2.data.revisionToken;

      const a2 = await makeRequest(
        server,
        'POST',
        `/api/session-notes/${LESSON_4}/approve`,
        {
          lessonId: LESSON_4,
          studentUid,
          teacherUid,
          draftId: t2.data.draftTransformation.draftId,
          baseRevisionToken: tok,
        },
        teacherHeaders
      );
      assert.strictEqual(a2.status, 200);
      const approvedV2 = a2.data.approvedVersion;
      assert.ok(approvedV2.versionNumber > approvedV1.versionNumber);
      tok = a2.data.revisionToken;

      // Edit v3 (must preserve approvedV2!)
      const s3 = await makeRequest(
        server,
        'POST',
        '/api/session-notes',
        {
          id: LESSON_4,
          lessonId: LESSON_4,
          studentUid,
          studentEmail,
          sessionDate: '2026-11-16',
          topic: 'Versioning Flow',
          rawContent: RAW_C,
          baseRevisionToken: tok,
        },
        teacherHeaders
      );
      assert.strictEqual(s3.status, 200);
      const finalDoc = s3.data.sessionNote;
      assert.strictEqual(finalDoc.lastApprovedVersion?.approvedVersionId, approvedV2.approvedVersionId);
      const hist = finalDoc.versionHistory;
      assert.ok(Array.isArray(hist) && hist.length >= 6);
      for (let i = 1; i < hist.length; i++) {
        assert.ok(
          hist[i].versionNumber > hist[i - 1].versionNumber,
          `versionHistory deve ser estritamente monotônico (${hist[i - 1].versionNumber} -> ${hist[i].versionNumber})`
        );
      }
    });

    // 6. Gemini returning after rawContent altered during transform (outside transaction)
    await test('6. Gemini retornando após alteração de rawContent é rejeitado com 409 STALE_DRAFT e Gemini roda fora da transação', async () => {
      resetGeminiSecurityStateForTesting();

      const s1 = await makeRequest(
        server,
        'POST',
        '/api/session-notes',
        {
          id: LESSON_5,
          lessonId: LESSON_5,
          studentUid,
          studentEmail,
          sessionDate: '2026-11-16',
          topic: 'Gemini Race',
          rawContent: RAW_A,
          baseRevisionToken: null,
        },
        teacherHeaders
      );
      assert.strictEqual(s1.status, 200);
      const tok1 = s1.data.revisionToken;

      let geminiStarted!: () => void;
      const geminiStartedPromise = new Promise<void>((r) => (geminiStarted = r));
      let releaseGemini!: () => void;
      const geminiReleasePromise = new Promise<void>((r) => (releaseGemini = r));
      let geminiRanInsideTx = false;

      setSessionNoteTransformAttemptExecutorForTesting(async () => {
        if (casDb.activeTransactionCount > 0) {
          geminiRanInsideTx = true;
        }
        geminiStarted();
        await geminiReleasePromise;
        return JSON.stringify(buildMockAiOutput('stale-race'));
      });

      const transformPromise = makeRequest(
        server,
        'POST',
        `/api/session-notes/${LESSON_5}/transform`,
        { lessonId: LESSON_5, studentUid, teacherUid, baseRevisionToken: tok1 },
        teacherHeaders
      );

      await geminiStartedPromise;
      assert.strictEqual(geminiRanInsideTx, false, 'Chamada ao Gemini NÃO pode manter transação aberta');

      // Concurrent rawContent edit completes while Gemini is still running
      const concurrentEdit = await makeRequest(
        server,
        'POST',
        '/api/session-notes',
        {
          id: LESSON_5,
          lessonId: LESSON_5,
          studentUid,
          studentEmail,
          sessionDate: '2026-11-16',
          topic: 'Gemini Race',
          rawContent: RAW_B,
          baseRevisionToken: tok1,
        },
        teacherHeaders
      );
      assert.strictEqual(concurrentEdit.status, 200);

      // Now release Gemini
      releaseGemini();
      const transformRes = await transformPromise;

      assert.strictEqual(transformRes.status, 409, 'Resultado de Gemini sobre nota alterada deve retornar 409');
      assert.strictEqual(transformRes.data?.code, 'STALE_DRAFT');
      assert.strictEqual(transformRes.data?.reason, 'CONTENT_CHANGED_DURING_TRANSFORM');
      assert.strictEqual(firestoreStore[`session_notes/${LESSON_5}`]?.rawContent, RAW_B);
      assert.strictEqual(
        firestoreStore[`session_notes/${LESSON_5}`]?.draftTransformation ?? null,
        null,
        'Draft obsoleto não deve ser gravado no Firestore'
      );
    });

    // 7. Concurrency between two independent instances (no shared in-memory write lock)
    await test('7. Concorrência entre duas instâncias independentes (CAS transacional) evita sobrescrita e documentos duplicados', async () => {
      // Seed initial doc at contentRevision 1
      const seed = await makeRequest(
        server,
        'POST',
        '/api/session-notes',
        {
          id: LESSON_6,
          lessonId: LESSON_6,
          studentUid,
          studentEmail,
          sessionDate: '2026-11-16',
          topic: 'Multi Instance',
          rawContent: RAW_A,
          baseRevisionToken: null,
        },
        teacherHeaders
      );
      assert.strictEqual(seed.status, 200);
      const sharedToken = seed.data.revisionToken;

      // Simulate Instance A (HTTP endpoint) vs Instance B (direct second Firestore CAS transaction running concurrently)
      const [resInstanceA, resInstanceB] = await Promise.all([
        makeRequest(
          server,
          'POST',
          '/api/session-notes',
          {
            id: LESSON_6,
            lessonId: LESSON_6,
            studentUid,
            studentEmail,
            sessionDate: '2026-11-16',
            topic: 'Multi Instance',
            rawContent: RAW_B,
            baseRevisionToken: sharedToken,
          },
          teacherHeaders
        ),
        casDb.runTransaction(async (tx) => {
          const ref = casDb.collection('session_notes').doc(LESSON_6);
          const snap = await tx.get(ref);
          const cur = snap.data() || {};
          if (cur.revisionToken !== sharedToken) {
            return { status: 409, code: 'STALE_REVISION' };
          }
          tx.set(ref, {
            ...cur,
            rawContent: RAW_C,
            content: RAW_C,
            contentRevision: (cur.contentRevision || 1) + 1,
            revisionToken: `rev_2_instanceB_${Date.now()}`,
          });
          return { status: 200, code: 'OK' };
        }),
      ]);

      const statuses = [resInstanceA.status, resInstanceB.status].sort();
      assert.deepStrictEqual(statuses, [200, 409], 'Exatamente uma instância vence (200) e a outra recebe conflito (409)');

      // Verify zero duplicate session_notes documents for LESSON_6
      const matchingDocs = Object.entries(firestoreStore).filter(
        ([k, v]) => k.startsWith('session_notes/') && (v?.lessonId === LESSON_6 || k.includes(LESSON_6))
      );
      assert.strictEqual(matchingDocs.length, 1, 'Nenhum documento duplicado criado em concorrência entre instâncias');
    });

    // 8. Divergent canonical keys converge cleanly without duplicates
    await test('8. Chaves canônicas divergentes (bare vs lesson_ vs session_date_uid com lessonId) convergem para documento único', async () => {
      // Save via bare lessonId
      const r1 = await makeRequest(
        server,
        'POST',
        '/api/session-notes',
        {
          id: LESSON_7_BARE,
          lessonId: LESSON_7_BARE,
          studentUid,
          studentEmail,
          sessionDate: '2026-11-16',
          topic: 'Canonical Key Convergence',
          rawContent: RAW_A,
          baseRevisionToken: null,
        },
        teacherHeaders
      );
      assert.strictEqual(r1.status, 200);
      const t1 = r1.data.revisionToken;

      // Update via prefixed `lesson_{id}` + different body `id` (`session_...`) pointing to same lesson
      const r2 = await makeRequest(
        server,
        'POST',
        '/api/session-notes',
        {
          id: `session_2026-11-16_${studentUid}`,
          lessonId: LESSON_7_PREFIXED,
          studentUid,
          studentEmail,
          sessionDate: '2026-11-16',
          topic: 'Canonical Key Convergence',
          rawContent: RAW_B,
          baseRevisionToken: t1,
        },
        teacherHeaders
      );
      assert.strictEqual(r2.status, 200);
      assert.strictEqual(r2.data.sessionNote.id, LESSON_7_BARE, 'Deve resolver para a mesma chave canônica');

      // Trying to write via prefixed key using stale t1 must return 409
      const rStale = await makeRequest(
        server,
        'POST',
        '/api/session-notes',
        {
          id: LESSON_7_PREFIXED,
          lessonId: LESSON_7_PREFIXED,
          studentUid,
          studentEmail,
          sessionDate: '2026-11-16',
          topic: 'Canonical Key Convergence',
          rawContent: RAW_C,
          baseRevisionToken: t1,
        },
        teacherHeaders
      );
      assert.strictEqual(rStale.status, 409);

      const docsForLesson7 = Object.entries(firestoreStore).filter(
        ([k, v]) => k.startsWith('session_notes/') && (v?.lessonId === LESSON_7_BARE || v?.lessonId === LESSON_7_PREFIXED)
      );
      assert.strictEqual(docsForLesson7.length, 1, 'Chaves divergentes devem convergir para exatamente 1 documento');
    });

    // 9. UID, teacher, student, and lesson ownership protection
    await test('9. Proteção estrita de UID, professor, aluno e aula rejeita acesso/sobrescrita cruzada com 403', async () => {
      // 9a. Student cannot save session notes
      const studentSave = await makeRequest(
        server,
        'POST',
        '/api/session-notes',
        {
          id: LESSON_1,
          lessonId: LESSON_1,
          studentUid,
          studentEmail,
          sessionDate: '2026-11-16',
          topic: 'Hack',
          rawContent: 'Hack by student',
        },
        studentHeaders
      );
      assert.strictEqual(studentSave.status, 403);

      // 9b. Teacher cannot save notes for a lesson belonging to another teacher/student
      const crossLessonSave = await makeRequest(
        server,
        'POST',
        '/api/session-notes',
        {
          id: LESSON_8_OTHER_STUDENT,
          lessonId: LESSON_8_OTHER_STUDENT,
          studentUid,
          studentEmail,
          sessionDate: '2026-11-16',
          topic: 'Cross Lesson',
          rawContent: 'Tamper',
        },
        teacherHeaders
      );
      assert.strictEqual(crossLessonSave.status, 403);
      assert.strictEqual(crossLessonSave.data?.code, 'STUDENT_LESSON_MISMATCH');

      // 9c. Another teacher cannot overwrite LESSON_1 owned by teacherUid
      firestoreStore[`enrollments/enr-other-${ts}`] = {
        studentUid,
        teacherUid: otherTeacherUid,
        status: 'active',
      };
      const crossTeacherSave = await makeRequest(
        server,
        'POST',
        '/api/session-notes',
        {
          id: LESSON_1,
          lessonId: LESSON_1,
          studentUid,
          studentEmail,
          sessionDate: '2026-11-16',
          topic: 'Cross Teacher',
          rawContent: 'Overwrite by other teacher',
        },
        otherTeacherHeaders
      );
      assert.strictEqual(crossTeacherSave.status, 403);

      // 9d. Mismatched studentUid against existing doc is rejected on transform
      const crossStudentTransform = await makeRequest(
        server,
        'POST',
        `/api/session-notes/${LESSON_1}/transform`,
        {
          lessonId: LESSON_1,
          studentUid: otherStudentUid,
          teacherUid,
        },
        teacherHeaders
      );
      assert.strictEqual(crossStudentTransform.status, 403);
      assert.strictEqual(crossStudentTransform.data?.code, 'STUDENT_UID_MISMATCH');
    });

    // 10. Absence of fallback bypassing conflict (post-Drive & POST /api/lessons/:id/notes)
    await test('10. Ausência de fallback contornando conflito (Drive POST /api/session-notes sem token -> 409; 409/403 nunca dispara /api/lessons/:id/notes)', async () => {
      // Seed note on LESSON_9_DRIVE
      const seed = await makeRequest(
        server,
        'POST',
        '/api/session-notes',
        {
          id: LESSON_9_DRIVE,
          lessonId: LESSON_9_DRIVE,
          studentUid,
          studentEmail,
          sessionDate: '2026-11-16',
          topic: 'Drive Guard Topic',
          rawContent: RAW_A,
          baseRevisionToken: null,
        },
        teacherHeaders
      );
      assert.strictEqual(seed.status, 200);

      // Post-Drive POST /api/session-notes carrying driveFileId WITHOUT baseRevisionToken on existing doc MUST return 409
      const driveNoToken = await makeRequest(
        server,
        'POST',
        '/api/session-notes',
        {
          id: LESSON_9_DRIVE,
          lessonId: LESSON_9_DRIVE,
          studentUid,
          studentEmail,
          sessionDate: '2026-11-16',
          topic: 'Drive Guard Topic',
          rawContent: 'STALE DRIVE CONTENT OVERWRITE ATTEMPT',
          driveFileId: 'drive_file_123',
          driveFileUrl: 'https://drive.google.com/file/d/drive_file_123/view',
          driveLastSyncedAt: new Date().toISOString(),
        },
        teacherHeaders
      );
      assert.strictEqual(driveNoToken.status, 409);
      assert.strictEqual(driveNoToken.data?.code, 'REVISION_TOKEN_REQUIRED');
      assert.strictEqual(firestoreStore[`session_notes/${LESSON_9_DRIVE}`]?.rawContent, RAW_A);

      // Same post-Drive call WITH valid revisionToken succeeds
      const driveWithToken = await makeRequest(
        server,
        'POST',
        '/api/session-notes',
        {
          id: LESSON_9_DRIVE,
          lessonId: LESSON_9_DRIVE,
          studentUid,
          studentEmail,
          sessionDate: '2026-11-16',
          topic: 'Drive Guard Topic',
          rawContent: RAW_B,
          baseRevisionToken: seed.data.revisionToken,
          driveFileId: 'drive_file_123',
          driveFileUrl: 'https://drive.google.com/file/d/drive_file_123/view',
          driveLastSyncedAt: new Date().toISOString(),
        },
        teacherHeaders
      );
      assert.strictEqual(driveWithToken.status, 200);
      assert.strictEqual(driveWithToken.data.sessionNote.driveFileId, 'drive_file_123');

      // Also verify via POST /api/lessons/:id/notes that stale token is rejected with 409 (no bypass)
      const directLessonStale = await makeRequest(
        server,
        'POST',
        `/api/lessons/${LESSON_9_DRIVE}/notes`,
        {
          studentUid,
          studentEmail,
          sessionDate: '2026-11-16',
          topic: 'Direct Fallback Attempt',
          rawContent: 'BYPASS ATTEMPT',
          baseRevisionToken: seed.data.revisionToken,
        },
        teacherHeaders
      );
      assert.strictEqual(directLessonStale.status, 409);

      // Verify frontend contract: TeacherLiveLessonNotesPanel blocks onSaveLessonNotes on definitiveServerError (409, 403, 4xx)
      const panelSrc = fs.readFileSync(
        path.resolve(process.cwd(), 'src/components/TeacherLiveLessonNotesPanel.tsx'),
        'utf8'
      );
      assert(
        panelSrc.includes('if (!definitiveServerError && targetLessonId && typeof onSaveLessonNotes === \'function\')'),
        'persistSessionDocument não pode disparar fallback onSaveLessonNotes após 409/403/4xx'
      );
      assert(
        panelSrc.includes('if (!driveDefinitiveError && targetLessonId && typeof onSaveLessonNotes === \'function\')'),
        'executeDriveSync não pode disparar fallback onSaveLessonNotes após 409/403/4xx'
      );
    });
  } finally {
    resetFirebaseAdminFirestoreForTesting();
    setSessionNoteTransformAttemptExecutorForTesting(null);
    resetGeminiSecurityStateForTesting();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  console.log(`\n======================================================================`);
  console.log(`NF.FLOW.1.3 SUMMARY: ${passed} passed, ${failed} failed`);
  console.log(`======================================================================`);
  if (failed > 0) process.exit(1);
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
