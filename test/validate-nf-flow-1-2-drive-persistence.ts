process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = 'test-gemini-api-key';

import assert from 'assert';
import http from 'http';
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
import { clearInMemoryDriveStore } from '../src/serverGoogleDrive';
import { resetGeminiSecurityStateForTesting } from '../src/serverGeminiSecurity';
import { computeNotesContentHash } from '../src/utils/notesVersioning';

interface WriteLogEntry {
  path: string;
  inTransaction: boolean;
  op: 'set' | 'update';
  keys: string[];
}

function createTrackedInMemoryFirestore(
  store: Record<string, any>,
  options?: { readDelayMs?: number; writeDelayMs?: number }
) {
  const readDelayMs = options?.readDelayMs ?? 0;
  const writeDelayMs = options?.writeDelayMs ?? 0;
  const sleep = (ms: number) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());
  const writeLog: WriteLogEntry[] = [];

  function matchesFilters(data: any, filters: Array<{ field: string; op: string; val: any }>) {
    if (!data) return false;
    return filters.every(({ field, op, val }) => {
      const actual = data[field];
      if (op === '==') return actual === val;
      return true;
    });
  }

  function writeDoc(fullPath: string, data: any, opts: { merge?: boolean } | undefined, inTransaction: boolean, op: 'set' | 'update') {
    const incoming = JSON.parse(JSON.stringify(data));
    writeLog.push({
      path: fullPath,
      inTransaction,
      op,
      keys: Object.keys(incoming || {}),
    });
    if ((opts?.merge || op === 'update') && store[fullPath]) {
      store[fullPath] = { ...store[fullPath], ...incoming };
    } else {
      store[fullPath] = incoming;
    }
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
            writeDoc(fullPath, data, opts, false, 'set');
            return { writeTime: new Date() };
          },
          async update(data: any) {
            await sleep(writeDelayMs);
            writeDoc(fullPath, data, { merge: true }, false, 'update');
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
    writeLog,
    clearWriteLog() {
      writeLog.length = 0;
    },
    collection(name: string) {
      return makeCollection(name);
    },
    async runTransaction(fn: any) {
      const ops: Array<() => Promise<void>> = [];
      const tx = {
        get: async (ref: any) => ref.get(),
        set: (ref: any, val: any, opts?: any) => {
          ops.push(async () => {
            await sleep(writeDelayMs);
            writeDoc(ref.path, val, opts, true, 'set');
          });
        },
        update: (ref: any, val: any) => {
          ops.push(async () => {
            await sleep(writeDelayMs);
            writeDoc(ref.path, val, { merge: true }, true, 'update');
          });
        },
        delete: (ref: any) => {
          ops.push(async () => {
            await sleep(writeDelayMs);
            delete store[ref.path];
          });
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
      {
        id: `v2-${suffix}`,
        term: 'articulate',
        partOfSpeech: 'Adjective',
        definitionEn: 'Able to express thoughts clearly and effectively.',
        simpleDefinition: 'Able to speak and explain ideas clearly.',
        collocations: ['articulate speaker', 'clearly articulate'],
        realExamples: ['He gave an articulate explanation during the meeting.'],
        synonyms: ['eloquent'],
        register: 'neutral',
        registerNote: 'Useful in academic and workplace contexts.',
        category: 'Mindset & Work',
        isNewWord: true,
        isPronunciationFocus: false,
      },
    ],
    reviewSummary: {
      estimatedMinutes: '5-10 minutes',
      keyRules: ['Use to be for age.'],
      mustKnowVocabulary: ['resilient', 'articulate'],
      essentialCorrections: [{ original: 'I have 30 years old', corrected: 'I am 30 years old' }],
      usefulPatterns: ['I am ___ years old.'],
      rememberThis: `Always use "I am" for age (${suffix}).`,
    },
  };
}

async function runTests() {
  console.log('======================================================================');
  console.log('NF.FLOW.1.2 — SEGURANÇA DA PERSISTÊNCIA PÓS-DRIVE (TESTES DIRECIONADOS)');
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
  const studentUid = `student-nfflow12-${ts}`;
  const studentEmail = `student.nfflow12.${ts}@example.com`;
  const otherStudentUid = `student-other-${ts}`;
  const otherStudentEmail = `student.other.${ts}@example.com`;
  const teacherUid = `teacher-nfflow12-${ts}`;
  const teacherEmail = `teacher.nfflow12.${ts}@example.com`;
  const otherTeacherUid = `teacher-other-${ts}`;
  const otherTeacherEmail = `teacher.other.${ts}@example.com`;

  const tokenMap: Record<string, any> = {
    'tok-teacher': { uid: teacherUid, email: teacherEmail, email_verified: true, role: 'teacher' },
    'tok-teacher-other': { uid: otherTeacherUid, email: otherTeacherEmail, email_verified: true, role: 'teacher' },
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

  const LESSON_NEW = `lesson_new_${ts}`;
  const LESSON_RACE = `lesson_race_${ts}`;
  const LESSON_DELAYED_V2 = `lesson_delayed_v2_${ts}`;
  const LESSON_DIV_KEY = `lesson_div_${ts}`;
  const LESSON_PREFIX_BARE = `bare_${ts}`;
  const LESSON_STANDALONE_LINKED = `lesson_standalone_linked_${ts}`;
  const LESSON_CONCURRENT_VARIANT = `lesson_variant_${ts}`;

  const makeLesson = (id: string, title: string) => ({
    id,
    studentUid,
    studentEmail,
    teacherUid,
    teacherEmail,
    title,
    sessionDate: '2026-11-16',
    startDateTime: '2026-11-16T14:00:00Z',
    status: 'scheduled',
  });

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
    [`users/${otherStudentUid}`]: {
      uid: otherStudentUid,
      email: otherStudentEmail,
      role: 'student',
      level: 'basico',
      teacherUid: otherTeacherUid,
      teacherEmail: otherTeacherEmail,
      assignedNativeFriendUID: otherTeacherUid,
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
      name: 'Teacher NF12',
      approvalStatus: 'approved',
      isApproved: true,
    },
    [`users/${otherTeacherUid}`]: {
      uid: otherTeacherUid,
      email: otherTeacherEmail,
      role: 'teacher',
      approvalStatus: 'approved',
      isApproved: true,
    },
    [`tutors/${otherTeacherUid}`]: {
      uid: otherTeacherUid,
      email: otherTeacherEmail,
      name: 'Other Teacher',
      approvalStatus: 'approved',
      isApproved: true,
    },
    [`lessons/${LESSON_NEW}`]: makeLesson(LESSON_NEW, 'New Drive Lesson'),
    [`lessons/${LESSON_RACE}`]: makeLesson(LESSON_RACE, 'Race Lesson V1'),
    [`lessons/${LESSON_DELAYED_V2}`]: makeLesson(LESSON_DELAYED_V2, 'Delayed V2 Lesson'),
    [`lessons/${LESSON_DIV_KEY}`]: makeLesson(LESSON_DIV_KEY, 'Divergent Key Lesson'),
    [`lessons/${LESSON_PREFIX_BARE}`]: makeLesson(LESSON_PREFIX_BARE, 'Prefix Variant Lesson'),
    [`lessons/${LESSON_STANDALONE_LINKED}`]: makeLesson(LESSON_STANDALONE_LINKED, 'Standalone Linked Lesson'),
    [`lessons/${LESSON_CONCURRENT_VARIANT}`]: makeLesson(LESSON_CONCURRENT_VARIANT, 'Concurrent Variant Lesson'),
  };

  const trackedDb = createTrackedInMemoryFirestore(firestoreStore, { readDelayMs: 5, writeDelayMs: 5 });
  setFirebaseAdminFirestoreForTesting(trackedDb as any);
  setIsCloudWriteDisabled(false);
  clearInMemoryDriveStore();

  const server = http.createServer(serverApp);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  const teacherHeaders = { Authorization: 'Bearer tok-teacher' };
  const otherTeacherHeaders = { Authorization: 'Bearer tok-teacher-other' };
  const studentHeaders = { Authorization: 'Bearer tok-student' };

  const RAW_V1 = `
    <div>
      <span data-tag-type="incorrect">✗</span> I have 30 years old <span data-tag-type="correct">✓</span> I am 30 years old<br/>
      <span data-tag-type="new-word">✦ New Word</span> resilient
    </div>
  `;
  const RAW_V2 = RAW_V1 + '<div><span data-tag-type="new-word">✦ New Word</span> articulate</div>';
  const HASH_V1 = computeNotesContentHash(RAW_V1);
  const HASH_V2 = computeNotesContentHash(RAW_V2);

  const originalFetch = globalThis.fetch;
  const originalDriveToken = process.env.GOOGLE_DRIVE_TOKEN;

  try {
    // -----------------------------------------------------------------------
    // 1. Funcionamento normal + zero gravações redundantes fora da transação
    // -----------------------------------------------------------------------
    await test('1.1 Sync inicial no Drive cria nota canônica e grava lessons/{lessonId} exclusivamente dentro da transação (zero writes fora de tx)', async () => {
      trackedDb.clearWriteLog();

      const res = await makeRequest(
        server,
        'POST',
        '/api/drive/sync-session-notes',
        {
          studentUid,
          studentEmail,
          studentName: 'Student NF12',
          lessonId: LESSON_NEW,
          sessionDate: '2026-11-16',
          topic: 'Initial Drive Topic',
          content: RAW_V1,
        },
        teacherHeaders
      );

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data?.success, true);
      assert.ok(res.data?.fileId, 'fileId deve ser retornado');
      assert.ok(res.data?.webViewLink, 'webViewLink deve ser retornado');
      assert.ok(res.data?.folderName, 'folderName deve ser retornado');

      const storedNote = firestoreStore[`session_notes/${LESSON_NEW}`];
      assert.ok(storedNote, 'Nota canônica criada em session_notes/{lessonId}');
      assert.strictEqual(storedNote.rawContent, RAW_V1);
      assert.strictEqual(storedNote.driveFileId, res.data.fileId);
      assert.strictEqual(storedNote.approvalStatus, 'unapproved');

      const storedLesson = firestoreStore[`lessons/${LESSON_NEW}`];
      assert.strictEqual(storedLesson.driveFileId, res.data.fileId);
      assert.strictEqual(storedLesson.sessionNotesDocument, RAW_V1);

      const lessonWrites = trackedDb.writeLog.filter((w) => w.path === `lessons/${LESSON_NEW}`);
      const noteWrites = trackedDb.writeLog.filter((w) => w.path === `session_notes/${LESSON_NEW}`);
      assert.strictEqual(noteWrites.length, 1, 'Exatamente 1 escrita em session_notes/{id}');
      assert.strictEqual(lessonWrites.length, 1, 'Exatamente 1 escrita em lessons/{lessonId} (sem escrita redundante)');
      assert.strictEqual(noteWrites[0].inTransaction, true, 'Escrita em session_notes ocorreu dentro da transação');
      assert.strictEqual(lessonWrites[0].inTransaction, true, 'Escrita em lessons ocorreu dentro da transação');

      const driveView = await makeRequest(server, 'GET', `/api/drive/files/${res.data.fileId}`, undefined, studentHeaders);
      assert.strictEqual(driveView.status, 200);
      assert.ok(String(driveView.data).includes('resilient'), 'GET /api/drive/files/:fileId preserva leitura pelo aluno');
    });

    // -----------------------------------------------------------------------
    // 2. Upload ao Drive lento: edição mais recente V2 + Transform + Approve ocorrem DURANTE o upload
    // -----------------------------------------------------------------------
    await test('2.1 Concorrência real: edição V2 + Transform + Approve durante upload lento do Drive NÃO são sobrescritas quando o Drive termina', async () => {
      resetGeminiSecurityStateForTesting();
      setSessionNoteTransformAttemptExecutorForTesting(async () => JSON.stringify(buildMockAiOutput('race-v2')));

      // Seed V1 before Drive sync starts
      const seedRes = await makeRequest(
        server,
        'POST',
        '/api/session-notes',
        {
          id: LESSON_RACE,
          lessonId: LESSON_RACE,
          studentUid,
          studentEmail,
          sessionDate: '2026-11-16',
          topic: 'Race Topic V1',
          rawContent: RAW_V1,
          content: RAW_V1,
        },
        teacherHeaders
      );
      assert.strictEqual(seedRes.status, 200);

      // Pause mocked Drive API upload mid-flight so concurrent V2 save + transform + approve finish first
      let signalDriveUploadStarted!: () => void;
      const driveUploadStartedPromise = new Promise<void>((r) => (signalDriveUploadStarted = r));
      let releaseDriveUpload!: () => void;
      const driveUploadReleasePromise = new Promise<void>((r) => (releaseDriveUpload = r));

      process.env.GOOGLE_DRIVE_TOKEN = 'mock-drive-token';
      globalThis.fetch = (async (input: any, init?: any) => {
        const url = String(input);
        if (url.includes('googleapis.com/drive/v3/files?q=')) {
          if (url.includes('vnd.google-apps.folder')) {
            return new Response(JSON.stringify({ files: [{ id: 'mock_folder_1', name: "It's Simple - Session Notes" }] }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          return new Response(JSON.stringify({ files: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (url.includes('googleapis.com/upload/drive/v3/files')) {
          signalDriveUploadStarted();
          await driveUploadReleasePromise;
          return new Response(
            JSON.stringify({
              id: 'drive_mock_race_file_1',
              name: 'Session Notes - Race',
              webViewLink: 'https://drive.google.com/file/d/drive_mock_race_file_1/view',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return originalFetch(input, init);
      }) as any;

      try {
        // Start Drive sync with STALE V1 payload
        const driveSyncPromise = makeRequest(
          server,
          'POST',
          '/api/drive/sync-session-notes',
          {
            studentUid,
            studentEmail,
            studentName: 'Student NF12',
            lessonId: LESSON_RACE,
            sessionDate: '2026-11-16',
            topic: 'Race Topic V1',
            content: RAW_V1,
          },
          teacherHeaders
        );

        await driveUploadStartedPromise;

        // While Drive upload is paused in flight: Teacher edits to V2, runs Transform, and Approves V2!
        const v2Save = await makeRequest(
          server,
          'POST',
          '/api/session-notes',
          {
            id: LESSON_RACE,
            lessonId: LESSON_RACE,
            studentUid,
            studentEmail,
            sessionDate: '2026-11-16',
            topic: 'Race Topic V2 Updated',
            rawContent: RAW_V2,
            content: RAW_V2,
          },
          teacherHeaders
        );
        assert.strictEqual(v2Save.status, 200);

        const tfRes = await makeRequest(
          server,
          'POST',
          `/api/session-notes/${LESSON_RACE}/transform`,
          { studentUid, teacherUid, language: 'en' },
          teacherHeaders
        );
        assert.strictEqual(tfRes.status, 200);
        const draftId = tfRes.data.draftTransformation.draftId;

        const apprRes = await makeRequest(
          server,
          'POST',
          `/api/session-notes/${LESSON_RACE}/approve`,
          {
            studentUid,
            teacherUid,
            draftId,
            transformation: tfRes.data.draftTransformation.transformation,
            changeSummary: 'Approved V2 during Drive upload',
          },
          teacherHeaders
        );
        assert.strictEqual(apprRes.status, 200);

        trackedDb.clearWriteLog();
        // Now let the slow Drive upload finish and commit!
        releaseDriveUpload();
        const driveSyncRes = await driveSyncPromise;
        assert.strictEqual(driveSyncRes.status, 200);
        assert.strictEqual(driveSyncRes.data.fileId, 'drive_mock_race_file_1');

        const afterNote = firestoreStore[`session_notes/${LESSON_RACE}`];
        assert.strictEqual(afterNote.rawContent, RAW_V2, 'rawContent V2 NÃO pode ser sobrescrito por V1 do Drive sync');
        assert.strictEqual(afterNote.content, RAW_V2, 'content V2 preservado');
        assert.strictEqual(afterNote.topic, 'Race Topic V2 Updated', 'topic V2 preservado');
        assert.strictEqual(afterNote.approvalStatus, 'approved', 'approvalStatus approved preservado');
        assert.strictEqual(afterNote.lastApprovedVersion?.contentHash, HASH_V2, 'lastApprovedVersion V2 preservada');
        assert.strictEqual(afterNote.driveFileId, 'drive_mock_race_file_1', 'Metadado driveFileId anexado');
        assert.strictEqual(
          afterNote.driveFileUrl,
          'https://drive.google.com/file/d/drive_mock_race_file_1/view',
          'Metadado driveFileUrl anexado'
        );
        assert.ok(
          Array.isArray(afterNote.versionHistory) &&
            afterNote.versionHistory.some((v: any) => v.type === 'approved_published' && v.contentHash === HASH_V2),
          'versionHistory preservado integralmente'
        );

        const afterLesson = firestoreStore[`lessons/${LESSON_RACE}`];
        assert.strictEqual(afterLesson.sessionNotesDocument, RAW_V2, 'lessons/{lessonId}.sessionNotesDocument mantém V2');
        assert.strictEqual(afterLesson.title, 'Race Topic V2 Updated', 'lessons/{lessonId}.title mantém Topic V2');
        assert.strictEqual(afterLesson.driveFileId, 'drive_mock_race_file_1', 'lessons/{lessonId} recebe driveFileId');

        const outsideWrites = trackedDb.writeLog.filter((w) => !w.inTransaction);
        assert.strictEqual(outsideWrites.length, 0, 'Zero escritas fora da transação pós-Drive');
      } finally {
        globalThis.fetch = originalFetch;
        if (originalDriveToken === undefined) delete process.env.GOOGLE_DRIVE_TOKEN;
        else process.env.GOOGLE_DRIVE_TOKEN = originalDriveToken;
      }
    });

    // -----------------------------------------------------------------------
    // 3. Sincronização atrasada após ciclo completo v1 aprovada -> novo rascunho -> v2 aprovada
    // -----------------------------------------------------------------------
    await test('3.1 Sincronização atrasada pós-ciclo v1 -> rascunho -> v2 aprovada NÃO reverte rawContent, rascunho, lastApprovedVersion ou versionHistory', async () => {
      resetGeminiSecurityStateForTesting();
      setSessionNoteTransformAttemptExecutorForTesting(async () => JSON.stringify(buildMockAiOutput('v1-step')));

      // v1 save -> transform -> approve
      await makeRequest(
        server,
        'POST',
        '/api/session-notes',
        {
          id: LESSON_DELAYED_V2,
          lessonId: LESSON_DELAYED_V2,
          studentUid,
          studentEmail,
          sessionDate: '2026-11-16',
          topic: 'Cycle V1',
          rawContent: RAW_V1,
          content: RAW_V1,
        },
        teacherHeaders
      );
      const tf1 = await makeRequest(
        server,
        'POST',
        `/api/session-notes/${LESSON_DELAYED_V2}/transform`,
        { studentUid, teacherUid, language: 'en' },
        teacherHeaders
      );
      const ap1 = await makeRequest(
        server,
        'POST',
        `/api/session-notes/${LESSON_DELAYED_V2}/approve`,
        {
          studentUid,
          teacherUid,
          draftId: tf1.data.draftTransformation.draftId,
          transformation: tf1.data.draftTransformation.transformation,
        },
        teacherHeaders
      );
      assert.strictEqual(ap1.status, 200);
      const v1ApprovedId = ap1.data.approvedVersion.approvedVersionId;

      // v2 edit -> transform (creates draftTransformation) -> approve v2
      setSessionNoteTransformAttemptExecutorForTesting(async () => JSON.stringify(buildMockAiOutput('v2-step')));
      await makeRequest(
        server,
        'POST',
        '/api/session-notes',
        {
          id: LESSON_DELAYED_V2,
          lessonId: LESSON_DELAYED_V2,
          studentUid,
          studentEmail,
          sessionDate: '2026-11-16',
          topic: 'Cycle V2',
          rawContent: RAW_V2,
          content: RAW_V2,
        },
        teacherHeaders
      );
      const tf2 = await makeRequest(
        server,
        'POST',
        `/api/session-notes/${LESSON_DELAYED_V2}/transform`,
        { studentUid, teacherUid, language: 'en' },
        teacherHeaders
      );
      assert.strictEqual(tf2.status, 200);
      const ap2 = await makeRequest(
        server,
        'POST',
        `/api/session-notes/${LESSON_DELAYED_V2}/approve`,
        {
          studentUid,
          teacherUid,
          draftId: tf2.data.draftTransformation.draftId,
          transformation: tf2.data.draftTransformation.transformation,
        },
        teacherHeaders
      );
      assert.strictEqual(ap2.status, 200);
      const v2ApprovedId = ap2.data.approvedVersion.approvedVersionId;
      assert.notStrictEqual(v2ApprovedId, v1ApprovedId);

      // Also create a new post-v2 draft so draftTransformation is non-null
      setSessionNoteTransformAttemptExecutorForTesting(async () => JSON.stringify(buildMockAiOutput('v3-draft')));
      const tf3 = await makeRequest(
        server,
        'POST',
        `/api/session-notes/${LESSON_DELAYED_V2}/transform`,
        { studentUid, teacherUid, language: 'en' },
        teacherHeaders
      );
      assert.strictEqual(tf3.status, 200);

      const snapshotBeforeDelayedSync = JSON.parse(JSON.stringify(firestoreStore[`session_notes/${LESSON_DELAYED_V2}`]));

      // Now a delayed Drive sync carrying old V1 content & divergent sessionKey arrives!
      const delayedDriveRes = await makeRequest(
        server,
        'POST',
        '/api/drive/sync-session-notes',
        {
          studentUid,
          studentEmail,
          lessonId: LESSON_DELAYED_V2,
          sessionKey: `stale_session_key_${ts}`,
          sessionDate: '2026-11-16',
          topic: 'Cycle V1',
          content: RAW_V1,
        },
        teacherHeaders
      );
      assert.strictEqual(delayedDriveRes.status, 200);

      const afterDelayed = firestoreStore[`session_notes/${LESSON_DELAYED_V2}`];
      assert.strictEqual(afterDelayed.rawContent, RAW_V2, 'rawContent V2 mantido');
      assert.strictEqual(afterDelayed.topic, 'Cycle V2', 'topic V2 mantido');
      assert.strictEqual(afterDelayed.approvalStatus, 'approved', 'approvalStatus mantido como approved');
      assert.strictEqual(
        afterDelayed.lastApprovedVersion?.approvedVersionId,
        v2ApprovedId,
        'lastApprovedVersion v2 preservada (sem reversão para v1)'
      );
      assert.strictEqual(
        afterDelayed.draftTransformation?.draftId,
        snapshotBeforeDelayedSync.draftTransformation?.draftId,
        'draftTransformation preservado intacto'
      );
      assert.strictEqual(
        afterDelayed.versionHistory.length,
        snapshotBeforeDelayedSync.versionHistory.length,
        'versionHistory preservado com todas as entradas'
      );
      assert.strictEqual(
        afterDelayed.currentVersionNumber,
        snapshotBeforeDelayedSync.currentVersionNumber,
        'currentVersionNumber preservado sem regressão'
      );
      assert.strictEqual(afterDelayed.driveFileId, delayedDriveRes.data.fileId, 'driveFileId atualizado');
      assert.strictEqual(
        firestoreStore[`session_notes/stale_session_key_${ts}`],
        undefined,
        'Nenhuma nota duplicada criada sob a sessionKey divergente'
      );
    });

    // -----------------------------------------------------------------------
    // 4. Divergência de chaves & ausência de duplicação
    // -----------------------------------------------------------------------
    await test('4.1 Divergência entre sessionKey, lessonId e prefixo lesson_ sempre converge para o documento canônico único', async () => {
      // 4A: /api/session-notes saves under LESSON_DIV_KEY, Drive sync passes divergent sessionKey
      await makeRequest(
        server,
        'POST',
        '/api/session-notes',
        {
          id: LESSON_DIV_KEY,
          lessonId: LESSON_DIV_KEY,
          studentUid,
          studentEmail,
          sessionDate: '2026-11-16',
          topic: 'Div Canonical',
          rawContent: RAW_V2,
          content: RAW_V2,
        },
        teacherHeaders
      );
      const resA = await makeRequest(
        server,
        'POST',
        '/api/drive/sync-session-notes',
        {
          studentUid,
          studentEmail,
          lessonId: LESSON_DIV_KEY,
          sessionKey: `session_2026-11-16_${studentUid}_divergent`,
          sessionDate: '2026-11-16',
          topic: 'Div Stale',
          content: RAW_V1,
        },
        teacherHeaders
      );
      assert.strictEqual(resA.status, 200);
      assert.strictEqual(firestoreStore[`session_notes/session_2026-11-16_${studentUid}_divergent`], undefined, 'Zero doc duplicado (4A)');
      assert.strictEqual(firestoreStore[`session_notes/${LESSON_DIV_KEY}`].driveFileId, resA.data.fileId);
      assert.strictEqual(firestoreStore[`session_notes/${LESSON_DIV_KEY}`].rawContent, RAW_V2);

      // 4B: Existing note stored without `lesson_` prefix (`bare_{ts}`), Drive sync passes `lesson_bare_{ts}`
      firestoreStore[`session_notes/${LESSON_PREFIX_BARE}`] = {
        id: LESSON_PREFIX_BARE,
        sessionKey: LESSON_PREFIX_BARE,
        lessonId: LESSON_PREFIX_BARE,
        studentUid,
        studentEmail,
        teacherUid,
        teacherEmail,
        sessionDate: '2026-11-16',
        topic: 'Bare Existing Topic',
        rawContent: RAW_V2,
        content: RAW_V2,
        approvalStatus: 'approved',
        lastApprovedVersion: { approvedVersionId: 'appr_bare_1', versionNumber: 1, contentHash: HASH_V2 },
        versionHistory: [{ versionId: 'v1', versionNumber: 1, type: 'approved_published', contentHash: HASH_V2 }],
        currentVersionNumber: 1,
      };

      const resB = await makeRequest(
        server,
        'POST',
        '/api/drive/sync-session-notes',
        {
          studentUid,
          studentEmail,
          lessonId: `lesson_${LESSON_PREFIX_BARE}`,
          sessionKey: `lesson_${LESSON_PREFIX_BARE}`,
          sessionDate: '2026-11-16',
          topic: 'Prefixed Stale',
          content: RAW_V1,
        },
        teacherHeaders
      );
      assert.strictEqual(resB.status, 200);
      assert.strictEqual(
        firestoreStore[`session_notes/lesson_${LESSON_PREFIX_BARE}`],
        undefined,
        'Zero documento duplicado para divergência com prefixo lesson_ (4B)'
      );
      assert.strictEqual(firestoreStore[`session_notes/${LESSON_PREFIX_BARE}`].driveFileId, resB.data.fileId);
      assert.strictEqual(firestoreStore[`session_notes/${LESSON_PREFIX_BARE}`].rawContent, RAW_V2);
      assert.strictEqual(firestoreStore[`session_notes/${LESSON_PREFIX_BARE}`].lastApprovedVersion.approvedVersionId, 'appr_bare_1');

      // 4C: Standalone session doc `session_2026-11-16_{studentUid}` already exists with `lessonId: LESSON_STANDALONE_LINKED`
      const standaloneDocId = `session_2026-11-16_${studentUid}`;
      firestoreStore[`session_notes/${standaloneDocId}`] = {
        id: standaloneDocId,
        sessionKey: standaloneDocId,
        lessonId: LESSON_STANDALONE_LINKED,
        studentUid,
        studentEmail,
        teacherUid,
        teacherEmail,
        sessionDate: '2026-11-16',
        topic: 'Standalone With Lesson Link',
        rawContent: RAW_V2,
        content: RAW_V2,
        approvalStatus: 'unapproved',
        versionHistory: [],
        currentVersionNumber: 1,
      };

      const resC = await makeRequest(
        server,
        'POST',
        '/api/drive/sync-session-notes',
        {
          studentUid,
          studentEmail,
          lessonId: LESSON_STANDALONE_LINKED,
          sessionDate: '2026-11-16',
          topic: 'Stale Topic',
          content: RAW_V1,
        },
        teacherHeaders
      );
      assert.strictEqual(resC.status, 200);
      assert.strictEqual(
        firestoreStore[`session_notes/${LESSON_STANDALONE_LINKED}`],
        undefined,
        'Zero documento duplicado quando nota já existe sob session_{date}_{uid} vinculada ao lessonId (4C)'
      );
      assert.strictEqual(firestoreStore[`session_notes/${standaloneDocId}`].driveFileId, resC.data.fileId);
      assert.strictEqual(firestoreStore[`session_notes/${standaloneDocId}`].rawContent, RAW_V2);
    });

    await test('4.2 Re-resolução pós-Drive converge para nota criada sob chave variante durante o upload', async () => {
      let signalStarted!: () => void;
      const startedPromise = new Promise<void>((r) => (signalStarted = r));
      let releaseDrive!: () => void;
      const releasePromise = new Promise<void>((r) => (releaseDrive = r));

      process.env.GOOGLE_DRIVE_TOKEN = 'mock-drive-token';
      globalThis.fetch = (async (input: any, init?: any) => {
        const url = String(input);
        if (url.includes('googleapis.com/drive/v3/files?q=')) {
          if (url.includes('vnd.google-apps.folder')) {
            return new Response(JSON.stringify({ files: [{ id: 'mock_folder_var', name: "It's Simple - Session Notes" }] }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          return new Response(JSON.stringify({ files: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (url.includes('googleapis.com/upload/drive/v3/files')) {
          signalStarted();
          await releasePromise;
          return new Response(
            JSON.stringify({
              id: 'drive_mock_variant_1',
              name: 'Session Notes - Variant',
              webViewLink: 'https://drive.google.com/file/d/drive_mock_variant_1/view',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return originalFetch(input, init);
      }) as any;

      try {
        const syncPromise = makeRequest(
          server,
          'POST',
          '/api/drive/sync-session-notes',
          {
            studentUid,
            studentEmail,
            lessonId: LESSON_CONCURRENT_VARIANT,
            sessionDate: '2026-11-16',
            topic: 'V1 Variant',
            content: RAW_V1,
          },
          teacherHeaders
        );

        await startedPromise;

        // Simulate concurrent creation of a standalone-named doc linked to LESSON_CONCURRENT_VARIANT during Drive upload
        const concurrentVariantDocId = `session_2026-11-17_${studentUid}`;
        firestoreStore[`session_notes/${concurrentVariantDocId}`] = {
          id: concurrentVariantDocId,
          sessionKey: concurrentVariantDocId,
          lessonId: LESSON_CONCURRENT_VARIANT,
          studentUid,
          studentEmail,
          teacherUid,
          teacherEmail,
          sessionDate: '2026-11-16',
          topic: 'V2 Variant Created Mid-Upload',
          rawContent: RAW_V2,
          content: RAW_V2,
          approvalStatus: 'draft_in_progress',
          draftTransformation: { draftId: 'draft_mid_var', versionNumber: 2, status: 'draft', contentHash: HASH_V2 },
          versionHistory: [
            { versionId: 'v1', versionNumber: 1, type: 'teacher_raw', contentHash: HASH_V2 },
            { versionId: 'v2', versionNumber: 2, type: 'ai_draft', contentHash: HASH_V2 },
          ],
          currentVersionNumber: 2,
        };

        releaseDrive();
        const res = await syncPromise;
        assert.strictEqual(res.status, 200);
        assert.strictEqual(
          firestoreStore[`session_notes/${LESSON_CONCURRENT_VARIANT}`],
          undefined,
          'Não cria segundo documento quando uma nota vinculada ao lessonId apareceu durante o upload'
        );
        assert.strictEqual(
          firestoreStore[`session_notes/${concurrentVariantDocId}`].rawContent,
          RAW_V2,
          'Conteúdo V2 da nota variante preservado'
        );
        assert.strictEqual(
          firestoreStore[`session_notes/${concurrentVariantDocId}`].driveFileId,
          'drive_mock_variant_1',
          'Metadado do Drive gravado no documento canônico encontrado pós-upload'
        );
      } finally {
        globalThis.fetch = originalFetch;
        if (originalDriveToken === undefined) delete process.env.GOOGLE_DRIVE_TOKEN;
        else process.env.GOOGLE_DRIVE_TOKEN = originalDriveToken;
      }
    });

    // -----------------------------------------------------------------------
    // 5. Proteção multi-instância via db.runTransaction (sem depender de lock em memória)
    // -----------------------------------------------------------------------
    await test('5.1 Multi-instância: db.runTransaction com preserveExistingContent protege rawContent e versionamento mesmo sem lock em memória', async () => {
      const multiKey = `lesson_multi_inst_${ts}`;
      firestoreStore[`lessons/${multiKey}`] = makeLesson(multiKey, 'Multi-Instance Topic V2');
      firestoreStore[`lessons/${multiKey}`].sessionNotesDocument = RAW_V2;
      firestoreStore[`session_notes/${multiKey}`] = {
        id: multiKey,
        sessionId: multiKey,
        sessionKey: multiKey,
        lessonId: multiKey,
        sessionDate: '2026-11-16',
        studentUid,
        studentEmail,
        teacherUid,
        teacherEmail,
        topic: 'Multi-Instance Topic V2',
        rawContent: RAW_V2,
        content: RAW_V2,
        approvalStatus: 'approved',
        draftTransformation: {
          draftId: 'draft_multi_keep',
          versionNumber: 3,
          status: 'draft',
          contentHash: HASH_V2,
          transformation: buildMockAiOutput('multi-draft'),
        },
        lastApprovedVersion: {
          approvedVersionId: 'appr_multi_keep_v2',
          versionNumber: 2,
          status: 'approved',
          contentHash: HASH_V2,
          transformation: buildMockAiOutput('multi-appr'),
        },
        versionHistory: [
          { versionId: 'm1', versionNumber: 1, type: 'teacher_raw', contentHash: HASH_V1, rawContent: RAW_V1 },
          { versionId: 'm2', versionNumber: 2, type: 'approved_published', contentHash: HASH_V2, rawContent: RAW_V2 },
          { versionId: 'm3', versionNumber: 3, type: 'ai_draft', contentHash: HASH_V2, rawContent: RAW_V2 },
        ],
        currentVersionNumber: 3,
      };

      // Simulate another Cloud Run instance finishing Drive sync with stale V1 (bypassing in-memory withSessionNoteWriteLock)
      const ok = await saveSessionNotesToFirestoreServer(
        multiKey,
        {
          id: multiKey,
          sessionDate: '2026-11-16',
          lessonId: multiKey,
          studentUid,
          teacherUid,
          topic: 'Stale Topic V1',
          content: RAW_V1,
          rawContent: RAW_V1,
          driveFileId: 'drive_multi_inst_file',
          driveFileUrl: '/api/drive/files/drive_multi_inst_file',
          driveFolderName: "It's Simple - Session Notes",
          driveLastSyncedAt: new Date().toISOString(),
        },
        {
          preserveExistingVersioningFields: true,
          preserveExistingContent: true,
        }
      );
      assert.strictEqual(ok, true);

      const after = firestoreStore[`session_notes/${multiKey}`];
      assert.strictEqual(after.rawContent, RAW_V2, 'Transação preservou rawContent V2');
      assert.strictEqual(after.content, RAW_V2, 'Transação preservou content V2');
      assert.strictEqual(after.topic, 'Multi-Instance Topic V2', 'Transação preservou topic V2');
      assert.strictEqual(after.draftTransformation?.draftId, 'draft_multi_keep', 'draftTransformation preservado');
      assert.strictEqual(after.lastApprovedVersion?.approvedVersionId, 'appr_multi_keep_v2', 'lastApprovedVersion preservada');
      assert.strictEqual(after.approvalStatus, 'approved', 'approvalStatus preservado');
      assert.strictEqual(after.versionHistory.length, 3, 'versionHistory preservado');
      assert.strictEqual(after.currentVersionNumber, 3, 'currentVersionNumber preservado');
      assert.strictEqual(after.driveFileId, 'drive_multi_inst_file', 'Metadado do Drive gravado');
      assert.strictEqual(firestoreStore[`lessons/${multiKey}`].sessionNotesDocument, RAW_V2, 'lessons/{lessonId}.sessionNotesDocument preservou V2');
      assert.strictEqual(firestoreStore[`lessons/${multiKey}`].driveFileId, 'drive_multi_inst_file', 'lessons/{lessonId} recebeu driveFileId');
    });

    // -----------------------------------------------------------------------
    // 6. Auth, RBAC e Ownership preservados
    // -----------------------------------------------------------------------
    await test('6.1 RBAC, UID canônico e ownership continuam bloqueando acesso indevido no Drive sync', async () => {
      const studentDenied = await makeRequest(
        server,
        'POST',
        '/api/drive/sync-session-notes',
        { studentUid, lessonId: LESSON_NEW, content: 'Student hijack' },
        studentHeaders
      );
      assert.strictEqual(studentDenied.status, 403);

      const wrongTeacherDenied = await makeRequest(
        server,
        'POST',
        '/api/drive/sync-session-notes',
        { studentUid, lessonId: LESSON_NEW, content: 'Wrong teacher' },
        otherTeacherHeaders
      );
      assert.strictEqual(wrongTeacherDenied.status, 403);

      const wrongStudentNoteDenied = await makeRequest(
        server,
        'POST',
        '/api/drive/sync-session-notes',
        { studentUid, sessionKey: LESSON_NEW, lessonId: undefined, content: 'Mismatch check' },
        teacherHeaders
      );
      assert.strictEqual(wrongStudentNoteDenied.status, 200);

      // Simulate existing note owned by otherStudentUid
      firestoreStore[`session_notes/foreign_note_${ts}`] = {
        id: `foreign_note_${ts}`,
        studentUid: otherStudentUid,
        teacherUid: otherTeacherUid,
        rawContent: 'Private foreign note',
        content: 'Private foreign note',
      };
      const studentMismatch = await makeRequest(
        server,
        'POST',
        '/api/drive/sync-session-notes',
        { studentUid, sessionKey: `foreign_note_${ts}`, content: 'Attempt overwrite' },
        teacherHeaders
      );
      assert.strictEqual(studentMismatch.status, 403);
      assert.strictEqual(firestoreStore[`session_notes/foreign_note_${ts}`].rawContent, 'Private foreign note');
    });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalDriveToken === undefined) delete process.env.GOOGLE_DRIVE_TOKEN;
    else process.env.GOOGLE_DRIVE_TOKEN = originalDriveToken;
    clearInMemoryDriveStore();
    resetFirebaseAdminFirestoreForTesting();
    setSessionNoteTransformAttemptExecutorForTesting(null);
    resetGeminiSecurityStateForTesting();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  console.log('\n======================================================================');
  console.log(`RESULTADO NF.FLOW.1.2: ${passed} PASSOU | ${failed} FALHOU`);
  console.log('======================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
  process.exit(0);
}

runTests().catch((err) => {
  console.error('Fatal NF.FLOW.1.2 test error:', err);
  process.exit(1);
});
