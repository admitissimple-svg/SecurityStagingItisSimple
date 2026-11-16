process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = 'test-gemini-api-key';

import assert from 'assert';
import http from 'http';
import fs from 'fs';
import path from 'path';
import {
  app as serverApp,
  setSessionNoteTransformAttemptExecutorForTesting,
} from '../serverApp';
import { setFirebaseAdminAuthForTesting } from '../src/serverFirebaseAdmin';
import {
  setFirebaseAdminFirestoreForTesting,
  resetFirebaseAdminFirestoreForTesting,
  setIsCloudWriteDisabled,
  saveSessionNotesToFirestoreServer,
} from '../src/serverFirestore';
import { resetGeminiSecurityStateForTesting } from '../src/serverGeminiSecurity';
import { computeNotesContentHash } from '../src/utils/notesVersioning';

function createDelayedInMemoryFirestore(store: Record<string, any>, options?: { readDelayMs?: number; writeDelayMs?: number }) {
  const readDelayMs = options?.readDelayMs ?? 0;
  const writeDelayMs = options?.writeDelayMs ?? 0;
  const sleep = (ms: number) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

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
            return { writeTime: new Date() };
          },
          async update(data: any) {
            await sleep(writeDelayMs);
            const incoming = JSON.parse(JSON.stringify(data));
            store[fullPath] = { ...(store[fullPath] || {}), ...incoming };
            return { writeTime: new Date() };
          },
          async delete() {
            await sleep(writeDelayMs);
            delete store[fullPath];
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
    collection(name: string) {
      return makeCollection(name);
    },
    async runTransaction(fn: any) {
      const ops: Array<() => Promise<void>> = [];
      const tx = {
        get: async (ref: any) => ref.get(),
        set: (ref: any, val: any, opts?: any) => {
          ops.push(() => ref.set(val, opts).then(() => undefined));
        },
        update: (ref: any, val: any) => {
          ops.push(() => ref.update(val).then(() => undefined));
        },
        delete: (ref: any) => {
          ops.push(() => ref.delete().then(() => undefined));
        },
      };
      const result = await fn(tx);
      for (const op of ops) {
        await op();
      }
      return result;
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
        original: 'I have 30 years old',
        corrected: 'I am 30 years old',
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
        term: 'resilient',
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
      mustKnowVocabulary: ['resilient'],
      essentialCorrections: [{ original: 'I have 30 years old', corrected: 'I am 30 years old' }],
      usefulPatterns: ['I am ___ years old.'],
      rememberThis: `Always use "I am" for age (${suffix}).`,
    },
  };
}

async function runTests() {
  console.log('======================================================================');
  console.log('NF.FLOW.1 — ELIMINAR CONCORRÊNCIA DE SALVAMENTO (TESTES DIRECIONADOS)');
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

  // -----------------------------------------------------------------------
  // BLOCO 1: Contratos de Frontend (TeacherLiveLessonNotesPanel.tsx & App.tsx)
  // -----------------------------------------------------------------------
  console.log('--- Bloco 1: Frontend — Eliminação da segunda gravação redundante & preservação de lessons ---');

  await test('1.1 TeacherLiveLessonNotesPanel passa { skipServerSave: serverSaveOk } para onSaveLessonNotes após POST /api/session-notes', () => {
    const panelSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/components/TeacherLiveLessonNotesPanel.tsx'), 'utf8');
    assert(panelSrc.includes('skipServerSave?: boolean'), 'Prop onSaveLessonNotes deve aceitar skipServerSave?: boolean');
    assert(panelSrc.includes('{ skipServerSave: serverSaveOk }'), 'persistSessionDocument deve passar { skipServerSave: serverSaveOk }');
    assert(panelSrc.includes('{ skipServerSave: driveServerSaveOk }'), 'executeDriveSync deve passar { skipServerSave: driveServerSaveOk }');
  });

  await test('1.2 App.tsx handleSaveLessonNotes atualiza estado React lessons e só pula POST /api/lessons/:id/notes quando skipServerSave=true', async () => {
    const appSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/App.tsx'), 'utf8');
    const fnStart = appSrc.indexOf('const handleSaveLessonNotes = async (');
    const fnEnd = appSrc.indexOf('// Handler: Add words to Student Personal Dictionary', fnStart);
    assert(fnStart !== -1 && fnEnd !== -1, 'handleSaveLessonNotes deve existir em src/App.tsx');
    const fnSlice = appSrc.slice(fnStart, fnEnd);

    const setLessonsIdx = fnSlice.indexOf('setLessons(');
    const skipCheckIdx = fnSlice.indexOf('if (options?.skipServerSave)');
    const fetchLessonsIdx = fnSlice.indexOf('fetch(`/api/lessons/${lessonId}/notes`');

    assert(setLessonsIdx !== -1, 'setLessons deve estar presente em handleSaveLessonNotes');
    assert(skipCheckIdx !== -1, 'if (options?.skipServerSave) deve estar presente em handleSaveLessonNotes');
    assert(fetchLessonsIdx !== -1, 'fetch(/api/lessons/${lessonId}/notes) deve estar preservado para outros chamadores');
    assert(setLessonsIdx < skipCheckIdx, 'Atualização do estado React lessons deve ocorrer ANTES do return de skipServerSave');
    assert(skipCheckIdx < fetchLessonsIdx, 'skipServerSave deve impedir o fetch redundante para /api/lessons/:id/notes');
  });

  await test('1.3 Simulação do fluxo Save Notes -> Apply AI no cliente: 1 POST /api/session-notes + 1 POST /transform, zero POST /api/lessons/:id/notes, lessons atualizado', async () => {
    // Replicate exact client decision flow between persistSessionDocument and handleSaveLessonNotes
    const apiCalls: string[] = [];
    let lessonsState = [
      { id: 'lesson_flow_1', title: 'Old Topic', liveNotes: '', sessionNotesDocument: '', recommendations: '' },
    ];

    const simulatedHandleSaveLessonNotes = async (
      lessonId: string,
      notes: { topic?: string; liveNotes?: string; recommendations?: string; sessionNotesDocument?: string },
      options?: { skipServerSave?: boolean }
    ) => {
      lessonsState = lessonsState.map((l) =>
        l.id === lessonId
          ? {
              ...l,
              title: notes.topic || l.title,
              liveNotes: notes.liveNotes || notes.sessionNotesDocument || '',
              sessionNotesDocument: notes.sessionNotesDocument || notes.liveNotes || '',
            }
          : l
      );
      if (options?.skipServerSave) return;
      apiCalls.push(`POST /api/lessons/${lessonId}/notes`);
    };

    // Step A: Save Notes -> POST /api/session-notes succeeds
    apiCalls.push('POST /api/session-notes');
    const serverSaveOk = true;
    await simulatedHandleSaveLessonNotes(
      'lesson_flow_1',
      { topic: 'Interview Prep', liveNotes: 'Updated raw notes', sessionNotesDocument: 'Updated raw notes' },
      { skipServerSave: serverSaveOk }
    );

    // Step B: Apply AI -> POST /api/session-notes (sync) + POST /api/session-notes/:id/transform
    apiCalls.push('POST /api/session-notes');
    await simulatedHandleSaveLessonNotes(
      'lesson_flow_1',
      { topic: 'Interview Prep', liveNotes: 'Updated raw notes', sessionNotesDocument: 'Updated raw notes' },
      { skipServerSave: true }
    );
    apiCalls.push('POST /api/session-notes/lesson_flow_1/transform');

    assert.strictEqual(
      apiCalls.filter((c) => c.includes('/api/lessons/')).length,
      0,
      'Nenhuma gravação redundante em /api/lessons/:id/notes deve ser disparada quando /api/session-notes teve sucesso'
    );
    assert.strictEqual(lessonsState[0].sessionNotesDocument, 'Updated raw notes', 'Estado React lessons atualizado visualmente');
    assert.strictEqual(lessonsState[0].title, 'Interview Prep', 'Título atualizado no estado React lessons');

    // Step C: Outra funcionalidade chamando onSaveLessonNotes sem skipServerSave preserva comportamento original
    await simulatedHandleSaveLessonNotes('lesson_flow_1', { topic: 'External Save', liveNotes: 'External content' });
    assert.strictEqual(
      apiCalls.filter((c) => c === 'POST /api/lessons/lesson_flow_1/notes').length,
      1,
      'Chamadores sem skipServerSave mantêm comportamento original de POST /api/lessons/:id/notes'
    );
  });

  // -----------------------------------------------------------------------
  // BLOCO 2: Backend — Concorrência real entre endpoints e proteção transacional
  // -----------------------------------------------------------------------
  console.log('\n--- Bloco 2: Backend — Serialização & Atomicidade em cenários concorrentes ---');

  const ts = Date.now();
  const studentUid = `student-nfflow1-${ts}`;
  const studentEmail = `student.nfflow1.${ts}@example.com`;
  const teacherUid = `teacher-nfflow1-${ts}`;
  const teacherEmail = `teacher.nfflow1.${ts}@example.com`;
  const LESSON_ID = `lesson_nfflow1_${ts}`;
  const STANDALONE_ID = `session_2026-11-16_${studentUid}`;

  const tokenMap: Record<string, any> = {
    'tok-teacher': { uid: teacherUid, email: teacherEmail, email_verified: true, role: 'teacher' },
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

  const firestoreStore: Record<string, any> = {
    [`users/${studentUid}`]: {
      uid: studentUid,
      email: studentEmail,
      role: 'student',
      level: 'intermediario',
      teacherUid,
      teacherEmail,
      assignedNativeFriendUID: teacherUid,
    },
    [`users/${teacherUid}`]: {
      uid: teacherUid,
      email: teacherEmail,
      role: 'teacher',
      approvalStatus: 'approved',
      isApproved: true,
    },
    [`tutors/${teacherUid}`]: {
      uid: teacherUid,
      email: teacherEmail,
      name: 'Teacher Flow',
      approvalStatus: 'approved',
      isApproved: true,
    },
    [`lessons/${LESSON_ID}`]: {
      id: LESSON_ID,
      studentUid,
      studentEmail,
      teacherUid,
      teacherEmail,
      title: 'Concurrency Test Lesson',
      sessionDate: '2026-11-16',
      startDateTime: '2026-11-16T14:00:00Z',
      status: 'scheduled',
    },
  };

  // Artificial async latency on Firestore reads/writes to widen race condition windows
  setFirebaseAdminFirestoreForTesting(createDelayedInMemoryFirestore(firestoreStore, { readDelayMs: 12, writeDelayMs: 12 }) as any);
  setIsCloudWriteDisabled(false);

  const server = http.createServer(serverApp);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  const teacherHeaders = { Authorization: 'Bearer tok-teacher' };
  const RAW_V1 = `
    <div>
      <span data-tag-type="incorrect">✗</span> I have 30 years old <span data-tag-type="correct">✓</span> I am 30 years old<br/>
      <span data-tag-type="new-word">✦ New Word</span> resilient
    </div>
  `;
  const RAW_V2 = RAW_V1 + '<div><span data-tag-type="new-word">✦ New Word</span> streamline</div>';
  const HASH_V1 = computeNotesContentHash(RAW_V1);
  const HASH_V2 = computeNotesContentHash(RAW_V2);

  try {
    await test('2.1 Save Notes -> Apply AI + gravação concorrente em POST /api/lessons/:id/notes NÃO perde draftTransformation nem versionHistory', async () => {
      resetGeminiSecurityStateForTesting();
      setSessionNoteTransformAttemptExecutorForTesting(async () => JSON.stringify(buildMockAiOutput('v1')));

      // First save notes via canonical POST /api/session-notes
      const initialSave = await makeRequest(
        server,
        'POST',
        '/api/session-notes',
        {
          id: LESSON_ID,
          lessonId: LESSON_ID,
          studentUid,
          studentEmail,
          sessionDate: '2026-11-16',
          topic: 'Concurrency Test Lesson',
          content: RAW_V1,
          rawContent: RAW_V1,
          skipDriveSync: true,
        },
        teacherHeaders
      );
      assert.strictEqual(initialSave.status, 200);

      // Now fire transform AND concurrent legacy/duplicate saves on BOTH endpoints simultaneously!
      const [transformRes, concurrentLessonSave, concurrentSessionSave] = await Promise.all([
        makeRequest(
          server,
          'POST',
          `/api/session-notes/${LESSON_ID}/transform`,
          { studentUid, teacherUid, language: 'pt' },
          teacherHeaders
        ),
        makeRequest(
          server,
          'POST',
          `/api/lessons/${LESSON_ID}/notes`,
          {
            studentUid,
            studentEmail,
            sessionDate: '2026-11-16',
            topic: 'Concurrency Test Lesson',
            content: RAW_V1,
            rawContent: RAW_V1,
            // Even if a buggy payload tried to send null/empty versioning fields:
            draftTransformation: null,
            lastApprovedVersion: null,
            approvalStatus: 'unapproved',
            versionHistory: [],
          },
          teacherHeaders
        ),
        makeRequest(
          server,
          'POST',
          '/api/session-notes',
          {
            id: LESSON_ID,
            lessonId: LESSON_ID,
            studentUid,
            studentEmail,
            sessionDate: '2026-11-16',
            topic: 'Concurrency Test Lesson',
            content: RAW_V1,
            rawContent: RAW_V1,
          },
          teacherHeaders
        ),
      ]);

      assert.strictEqual(transformRes.status, 200, `Transform deve retornar 200 (obtido ${transformRes.status})`);
      assert.strictEqual(concurrentLessonSave.status, 200);
      assert.strictEqual(concurrentSessionSave.status, 200);

      const stored = firestoreStore[`session_notes/${LESSON_ID}`];
      assert.ok(stored?.draftTransformation?.draftId, 'draftTransformation NÃO pode ser sobrescrito por salvamento concorrente');
      assert.strictEqual(stored.draftTransformation.contentHash, HASH_V1);
      assert.strictEqual(stored.approvalStatus, 'draft_in_progress', 'approvalStatus deve permanecer draft_in_progress');
      assert.ok(
        Array.isArray(stored.versionHistory) &&
          stored.versionHistory.some((v: any) => v.type === 'teacher_raw') &&
          stored.versionHistory.some((v: any) => v.type === 'ai_draft'),
        'versionHistory deve preservar tanto teacher_raw quanto ai_draft'
      );
      assert.strictEqual(
        firestoreStore[`lessons/${LESSON_ID}`]?.sessionNotesDocument,
        RAW_V1,
        'Espelho lessons/{lessonId} deve permanecer consistente'
      );
    });

    await test('2.2 Approve v1 -> salvamentos concorrentes (POST /api/session-notes + POST /api/lessons/:id/notes) para v2 mantêm lastApprovedVersion intacta', async () => {
      const storedBeforeApprove = firestoreStore[`session_notes/${LESSON_ID}`];
      const approveRes = await makeRequest(
        server,
        'POST',
        `/api/session-notes/${LESSON_ID}/approve`,
        {
          studentUid,
          teacherUid,
          draftId: storedBeforeApprove.draftTransformation.draftId,
          transformation: storedBeforeApprove.draftTransformation.transformation,
          changeSummary: 'Approved v1 cleanly',
        },
        teacherHeaders
      );
      assert.strictEqual(approveRes.status, 200);
      assert.strictEqual(approveRes.data.approvalStatus, 'approved');
      const approvedId = approveRes.data.approvedVersion.approvedVersionId;

      // Now fire concurrent raw updates to v2 on both endpoints
      const [saveA, saveB] = await Promise.all([
        makeRequest(
          server,
          'POST',
          '/api/session-notes',
          {
            id: LESSON_ID,
            lessonId: LESSON_ID,
            studentUid,
            studentEmail,
            sessionDate: '2026-11-16',
            topic: 'Concurrency Test Lesson v2',
            content: RAW_V2,
            rawContent: RAW_V2,
          },
          teacherHeaders
        ),
        makeRequest(
          server,
          'POST',
          `/api/lessons/${LESSON_ID}/notes`,
          {
            studentUid,
            studentEmail,
            sessionDate: '2026-11-16',
            topic: 'Concurrency Test Lesson v2',
            content: RAW_V2,
            rawContent: RAW_V2,
            lastApprovedVersion: null,
            approvalStatus: 'unapproved',
            versionHistory: [],
          },
          teacherHeaders
        ),
      ]);

      assert.strictEqual(saveA.status, 200);
      assert.strictEqual(saveB.status, 200);

      const storedAfter = firestoreStore[`session_notes/${LESSON_ID}`];
      assert.strictEqual(storedAfter.rawContent, RAW_V2, 'Conteúdo bruto v2 deve ser salvo');
      assert.strictEqual(
        storedAfter.lastApprovedVersion?.approvedVersionId,
        approvedId,
        'lastApprovedVersion v1 deve permanecer 100% intacta após salvamentos concorrentes'
      );
      assert.strictEqual(storedAfter.lastApprovedVersion?.contentHash, HASH_V1);
      assert.strictEqual(storedAfter.approvalStatus, 'approved', 'approvalStatus deve permanecer approved');
      assert.ok(
        storedAfter.versionHistory.some((v: any) => v.type === 'approved_published') &&
          storedAfter.versionHistory.some((v: any) => v.type === 'teacher_raw' && v.contentHash === HASH_V2),
        'versionHistory deve preservar aprovação v1 e registrar edição v2'
      );
    });

    await test('2.3 STALE_DRAFT (409) continua bloqueando aprovação obsoleta após edição concorrente', async () => {
      const stored = firestoreStore[`session_notes/${LESSON_ID}`];
      const staleApprove = await makeRequest(
        server,
        'POST',
        `/api/session-notes/${LESSON_ID}/approve`,
        {
          studentUid,
          teacherUid,
          transformation: stored.lastApprovedVersion.transformation,
        },
        teacherHeaders
      );
      assert.strictEqual(staleApprove.status, 409, `Esperado 409 STALE_DRAFT, obtido ${staleApprove.status}`);
      assert.strictEqual(staleApprove.data.code, 'STALE_DRAFT');
    });

    await test('2.4 Nota avulsa (sem lessonId): Save Notes -> Apply AI concorrente preserva draftTransformation, review/draft e approve', async () => {
      resetGeminiSecurityStateForTesting();
      setSessionNoteTransformAttemptExecutorForTesting(async () => JSON.stringify(buildMockAiOutput('standalone')));

      const saveRes = await makeRequest(
        server,
        'POST',
        '/api/session-notes',
        {
          id: STANDALONE_ID,
          studentUid,
          studentEmail,
          sessionDate: '2026-11-16',
          topic: 'Standalone Session',
          content: RAW_V1,
          rawContent: RAW_V1,
        },
        teacherHeaders
      );
      assert.strictEqual(saveRes.status, 200);

      // Concurrent transform + raw save on standalone note
      const [tfRes, concurrentSaveRes] = await Promise.all([
        makeRequest(
          server,
          'POST',
          `/api/session-notes/${STANDALONE_ID}/transform`,
          { studentUid, teacherUid, language: 'pt' },
          teacherHeaders
        ),
        makeRequest(
          server,
          'POST',
          '/api/session-notes',
          {
            id: STANDALONE_ID,
            studentUid,
            studentEmail,
            sessionDate: '2026-11-16',
            topic: 'Standalone Session',
            content: RAW_V1,
            rawContent: RAW_V1,
          },
          teacherHeaders
        ),
      ]);

      assert.strictEqual(tfRes.status, 200);
      assert.strictEqual(concurrentSaveRes.status, 200);

      const storedStandalone = firestoreStore[`session_notes/${STANDALONE_ID}`];
      assert.ok(storedStandalone?.draftTransformation?.draftId, 'Nota avulsa preserva draftTransformation');
      assert.strictEqual(storedStandalone.approvalStatus, 'draft_in_progress');
      assert.strictEqual(storedStandalone.lessonId, '', 'Nota avulsa permanece sem lessonId');

      // Review / Save Draft -> Approve
      const editedTrans = JSON.parse(JSON.stringify(storedStandalone.draftTransformation.transformation));
      editedTrans.reviewSummary.rememberThis = 'Reviewed standalone note';

      const draftRes = await makeRequest(
        server,
        'POST',
        `/api/session-notes/${STANDALONE_ID}/draft`,
        {
          studentUid,
          teacherUid,
          draftId: storedStandalone.draftTransformation.draftId,
          transformation: editedTrans,
        },
        teacherHeaders
      );
      assert.strictEqual(draftRes.status, 200);

      const approveRes = await makeRequest(
        server,
        'POST',
        `/api/session-notes/${STANDALONE_ID}/approve`,
        {
          studentUid,
          teacherUid,
          draftId: draftRes.data.sessionNote.draftTransformation.draftId,
          transformation: editedTrans,
        },
        teacherHeaders
      );
      assert.strictEqual(approveRes.status, 200);
      assert.strictEqual(approveRes.data.approvalStatus, 'approved');
      assert.strictEqual(approveRes.data.approvedVersion.transformation.reviewSummary.rememberThis, 'Reviewed standalone note');
    });

    await test('2.5 Proteção transacional em saveSessionNotesToFirestoreServer (multi-instância): raw save com preserveExistingVersioningFields não sobrescreve draft/approved/history gravados no Firestore', async () => {
      const txKey = `session_tx_protect_${ts}`;
      firestoreStore[`session_notes/${txKey}`] = {
        id: txKey,
        sessionKey: txKey,
        sessionDate: '2026-11-16',
        studentUid,
        teacherUid,
        rawContent: RAW_V1,
        content: RAW_V1,
        approvalStatus: 'approved',
        draftTransformation: {
          draftId: 'draft_tx_keep',
          versionNumber: 3,
          status: 'draft',
          contentHash: HASH_V1,
          transformation: buildMockAiOutput('tx-draft'),
        },
        lastApprovedVersion: {
          approvedVersionId: 'appr_tx_keep',
          versionNumber: 2,
          status: 'approved',
          contentHash: HASH_V1,
          transformation: buildMockAiOutput('tx-appr'),
        },
        versionHistory: [
          { versionId: 'v_1', versionNumber: 1, type: 'teacher_raw', contentHash: HASH_V1, rawContent: RAW_V1 },
          { versionId: 'v_2', versionNumber: 2, type: 'approved_published', contentHash: HASH_V1, rawContent: RAW_V1 },
          { versionId: 'v_3', versionNumber: 3, type: 'ai_draft', contentHash: HASH_V1, rawContent: RAW_V1 },
        ],
        currentVersionNumber: 3,
      };

      // Simulate stale caller attempting to save with null draft/approved & truncated history
      const ok = await saveSessionNotesToFirestoreServer(
        txKey,
        {
          id: txKey,
          sessionDate: '2026-11-16',
          studentUid,
          teacherUid,
          topic: 'Updated Topic',
          content: RAW_V2,
          rawContent: RAW_V2,
          draftTransformation: null,
          lastApprovedVersion: null,
          approvalStatus: 'unapproved',
          versionHistory: [
            { versionId: 'v_4_stale', versionNumber: 2, type: 'teacher_raw', contentHash: HASH_V2, rawContent: RAW_V2 },
          ],
          currentVersionNumber: 2,
        },
        { preserveExistingVersioningFields: true }
      );
      assert.strictEqual(ok, true);

      const after = firestoreStore[`session_notes/${txKey}`];
      assert.strictEqual(after.draftTransformation?.draftId, 'draft_tx_keep', 'draftTransformation preservado na transação');
      assert.strictEqual(after.lastApprovedVersion?.approvedVersionId, 'appr_tx_keep', 'lastApprovedVersion preservada na transação');
      assert.strictEqual(after.approvalStatus, 'approved', 'approvalStatus preservado como approved');
      assert.strictEqual(after.versionHistory.length, 4, 'versionHistory mesclado monotonicamente sem perda (4 entradas)');
      assert.strictEqual(after.versionHistory[3].versionNumber, 4, 'Nova versão recebeu versionNumber monotônico = 4');
    });
  } finally {
    resetFirebaseAdminFirestoreForTesting();
    setSessionNoteTransformAttemptExecutorForTesting(null);
    resetGeminiSecurityStateForTesting();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  console.log('\n======================================================================');
  console.log(`RESULTADO NF.FLOW.1: ${passed} PASSOU | ${failed} FALHOU`);
  console.log('======================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
  process.exit(0);
}

runTests().catch((err) => {
  console.error('Fatal NF.FLOW.1 test error:', err);
  process.exit(1);
});
