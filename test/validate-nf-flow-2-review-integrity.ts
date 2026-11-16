/**
 * NF.FLOW.2 — Integridade das edições no Review e Approve & Publish
 *
 * Valida todos os 10 cenários obrigatórios:
 *  1. Primeira aprovação v1.
 *  2. Edição de Review após v1 aprovada (reconhecimento de alterações não salvas, v1 intacta).
 *  3. Approve & Publish com alterações não salvas (confirmação explícita, sem perda nem publicação antiga silenciosa).
 *  4. Save Draft seguido de Approve & Publish.
 *  5. Aprovação v2 preservando v1 no versionHistory.
 *  6. Aprovação sem alterações, sem criar versão duplicada (idempotência).
 *  7. Conflito 409 sem perda de texto/edições locais no Review.
 *  8. Concorrência entre duas abas (rotação de revisionToken em /draft e /approve -> 409 STALE_REVISION).
 *  9. Fluxo completo com aula agendada (lessonId).
 * 10. Fluxo completo de nota avulsa sem lessonId (sem criar aula fictícia em `lessons`).
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
import { arePedagogicalTransformationsEqual } from '../src/utils/notesVersioning';

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
        explanation: 'Use the verb to be for age in English.',
        grammarRule: 'Subject + be + age',
        twoExamples: ['She is 28 years old.', 'They are 30 years old.'],
        commonPitfalls: 'Avoid using have for age.',
        similarFormsComparison: 'I am 28 vs I have 28 years',
      },
    ],
    grammarPoints: [
      {
        id: `g-${tag}`,
        topic: `Verb to be for Age (${tag})`,
        rule: 'Use am/is/are instead of have when stating age.',
        form: 'Subject + be + number (+ years old)',
        usage: 'Everyday conversation.',
        examples: ['I am 28 years old.'],
        commonMistakes: 'Using have for age.',
        comparisons: 'Portuguese uses ter, English uses to be.',
      },
    ],
    vocabularyAndExpressions: [
      {
        id: `v-${tag}`,
        term: `hit the ground running (${tag})`,
        partOfSpeech: 'Idiom',
        category: 'Conversational Expressions',
        simpleDefinition: 'Start something energetically and effectively right away.',
        collocations: ['hit the ground running on a project'],
        realExamples: ['You hit the ground running in our conversation today.'],
        synonyms: ['start strong'],
        register: 'conversational',
        registerNote: 'Common in work and coaching',
        isNewWord: true,
        isPronunciationFocus: false,
      },
    ],
    reviewSummary: {
      estimatedMinutes: '5–10 min',
      keyRules: ['Use to be for age'],
      usefulPatterns: ['I am ___ years old.'],
      mustKnowVocabulary: [`hit the ground running (${tag})`],
      rememberThis: `Initial v1 takeaway (${tag})`,
    },
  };
}

async function run() {
  const {
    app: serverApp,
    readDb,
    setSessionNoteTransformAttemptExecutorForTesting,
  } = await import('../serverApp');

  console.log('\n🧪 NF.FLOW.2 — Integridade das edições no Review e Approve & Publish');

  const teacherUid = 'nf2-teacher-uid-001';
  const teacherEmail = 'teacher-nf2@itissimple.com';
  const studentUid = 'nf2-student-uid-001';
  const studentEmail = 'student-nf2@itissimple.com';

  const SCHEDULED_LESSON_ID = 'lesson-nf2-sched-001';
  const STANDALONE_DATE = '2026-11-16';
  const STANDALONE_ID = `session_${STANDALONE_DATE}_${studentUid}`;

  const firestoreStore: Record<string, any> = {
    [`users/${teacherUid}`]: {
      uid: teacherUid,
      email: teacherEmail,
      name: 'Native Friend Beta',
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
      name: 'Native Friend Beta',
      role: 'teacher',
      approvalStatus: 'approved',
      isApproved: true,
    },
    [`users/${studentUid}`]: {
      uid: studentUid,
      email: studentEmail,
      name: 'Student NF2',
      role: 'student',
      englishLevel: 'intermediario',
      assignedTeacherUid: teacherUid,
      assignedTeacherEmail: teacherEmail,
    },
    [`lessons/${SCHEDULED_LESSON_ID}`]: {
      id: SCHEDULED_LESSON_ID,
      studentUid,
      studentEmail,
      studentName: 'Student NF2',
      teacherUid,
      teacherEmail,
      teacherName: 'Native Friend Beta',
      title: 'Fluency Review NF2',
      sessionDate: '2026-11-16',
      startDateTime: '2026-11-16T15:00:00Z',
      status: 'scheduled',
      updatedAt: '2026-11-16T15:00:00.000Z',
    },
  };

  setFirebaseAdminFirestoreForTesting(createMockFirestoreCAS(firestoreStore) as any);
  setFirebaseAdminAuthForTesting({
    verifyIdToken: async (token: string) => {
      if (token === 'token-teacher') return { uid: teacherUid, email: teacherEmail, role: 'teacher' };
      if (token === 'token-student') return { uid: studentUid, email: studentEmail, role: 'student' };
      throw new Error('Invalid token');
    },
  } as any);

  const db = readDb();
  db.userProfiles[teacherEmail] = {
    uid: teacherUid,
    email: teacherEmail,
    name: 'Native Friend Beta',
    role: 'teacher',
    teacherApproved: true,
    teacherStatus: 'approved',
  };
  db.userProfiles[studentEmail] = {
    uid: studentUid,
    email: studentEmail,
    name: 'Student NF2',
    role: 'student',
    level: 'intermediario',
    assignedTeacherUid: teacherUid,
    assignedTeacherEmail: teacherEmail,
  };

  const server = serverApp.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));

  const teacherHeaders = { Authorization: 'Bearer token-teacher' };
  const studentHeaders = { Authorization: 'Bearer token-student' };

  const schedRawHtml =
    '<div><span data-tag-type="incorrect">✗</span> I have 28 years <span data-tag-type="correct">✓</span> I am 28 years old <span data-tag-type="new-word">✦ New Word</span> hit the ground running</div>';
  const standaloneRawHtml =
    '<div><span data-tag-type="incorrect">✗</span> I have 30 years <span data-tag-type="correct">✓</span> I am 30 years old <span data-tag-type="new-word">✦ New Word</span> hit the ground running</div>';

  let schedToken: string | null = null;
  let schedV1Trans: any = null;
  let schedV1VersionNumber = 0;

  let standaloneToken: string | null = null;
  let standaloneV1Trans: any = null;
  let standaloneV1VersionNumber = 0;

  try {
    // ------------------------------------------------------------------------
    // TEST 1: Primeira aprovação v1 (aula agendada com lessonId)
    // ------------------------------------------------------------------------
    await test('1. Primeira aprovação v1 funciona corretamente para aula agendada', async () => {
      setSessionNoteTransformAttemptExecutorForTesting(async () => JSON.stringify(buildMockAiOutput('sched')));

      const saveRes = await makeRequest(
        server,
        'POST',
        '/api/session-notes',
        {
          id: SCHEDULED_LESSON_ID,
          lessonId: SCHEDULED_LESSON_ID,
          studentUid,
          studentEmail,
          teacherUid,
          sessionDate: '2026-11-16',
          topic: 'Fluency Review NF2',
          content: schedRawHtml,
          rawContent: schedRawHtml,
          baseRevisionToken: null,
          skipDriveSync: true,
        },
        teacherHeaders
      );
      assert.strictEqual(saveRes.status, 200);
      schedToken = saveRes.data.revisionToken;
      assert.ok(schedToken);

      const trRes = await makeRequest(
        server,
        'POST',
        `/api/session-notes/${SCHEDULED_LESSON_ID}/transform`,
        { lessonId: SCHEDULED_LESSON_ID, studentUid, teacherUid, baseRevisionToken: schedToken },
        teacherHeaders
      );
      assert.strictEqual(trRes.status, 200);
      assert.ok(trRes.data.revisionToken && trRes.data.revisionToken !== schedToken, 'transform deve rotacionar revisionToken');
      schedToken = trRes.data.revisionToken;
      schedV1Trans = deepClone(trRes.data.draftTransformation.transformation);

      const appr1Res = await makeRequest(
        server,
        'POST',
        `/api/session-notes/${SCHEDULED_LESSON_ID}/approve`,
        {
          lessonId: SCHEDULED_LESSON_ID,
          studentUid,
          teacherUid,
          draftId: trRes.data.draftTransformation.draftId,
          transformation: schedV1Trans,
          baseRevisionToken: schedToken,
        },
        teacherHeaders
      );
      assert.strictEqual(appr1Res.status, 200);
      assert.strictEqual(appr1Res.data.approvalStatus, 'approved');
      assert.strictEqual(appr1Res.data.sessionNote.draftTransformation, null);
      assert.ok(appr1Res.data.revisionToken && appr1Res.data.revisionToken !== schedToken, 'approve v1 deve rotacionar revisionToken');
      schedToken = appr1Res.data.revisionToken;
      schedV1VersionNumber = appr1Res.data.approvedVersion.versionNumber;
      assert.ok(schedV1VersionNumber >= 2);
    });

    // ------------------------------------------------------------------------
    // TEST 2: Edição de Review após v1 aprovada (dirty tracking & preservação de v1)
    // ------------------------------------------------------------------------
    await test('2. Edição de Review após v1 aprovada reconhece alterações não salvas e preserva v1 intacta', () => {
      const panelSrc = fs.readFileSync(
        path.resolve(process.cwd(), 'src/components/TeacherLiveLessonNotesPanel.tsx'),
        'utf8'
      );

      assert(panelSrc.includes('hasUnsavedReviewChanges'), 'Frontend deve rastrear hasUnsavedReviewChanges');
      assert(panelSrc.includes('data-testid="review-unsaved-badge"'), 'Frontend deve sinalizar edições não salvas no Review');
      assert(panelSrc.includes('setAiSuccessMessage(null)'), 'Handlers de edição inline devem limpar aiSuccessMessage anterior');

      // Simulação fiel do baseline e edição no Review
      const editedV2 = deepClone(schedV1Trans);
      editedV2.reviewSummary.rememberThis = 'Edited by teacher after v1 approval';
      editedV2.mistakesAnalysis[0].corrected = 'I am 28 years old (teacher refined)';

      assert.strictEqual(
        arePedagogicalTransformationsEqual(schedV1Trans, schedV1Trans),
        true,
        'Sem edições -> sem alterações não salvas'
      );
      assert.strictEqual(
        arePedagogicalTransformationsEqual(editedV2, schedV1Trans),
        false,
        'Após edição no Review -> detecta alteração não salva em relação à v1 aprovada'
      );

      // Ordem diferente de chaves no objeto não gera falso positivo
      const reorderedCopy = Object.fromEntries(
        Object.keys(schedV1Trans).reverse().map((k) => [k, schedV1Trans[k]])
      );
      assert.strictEqual(
        arePedagogicalTransformationsEqual(reorderedCopy, schedV1Trans),
        true,
        'Reordenação de chaves não deve disparar falso dirty'
      );

      // Enquanto não salvar/aprovar, v1 no Firestore permanece intocada
      const doc = firestoreStore[`session_notes/${SCHEDULED_LESSON_ID}`];
      assert.strictEqual(
        doc.lastApprovedVersion.transformation.reviewSummary.rememberThis,
        'Initial v1 takeaway (sched)'
      );
    });

    // ------------------------------------------------------------------------
    // TEST 3: Approve & Publish com alterações não salvas
    // ------------------------------------------------------------------------
    await test('3. Approve & Publish com alterações não salvas exige ação explícita, não publica v1 silenciosamente e persiste v2 ao confirmar', async () => {
      const panelSrc = fs.readFileSync(
        path.resolve(process.cwd(), 'src/components/TeacherLiveLessonNotesPanel.tsx'),
        'utf8'
      );
      assert(panelSrc.includes('if (hasUnsavedReviewChanges)'), 'handleApproveAndPublish deve interceptar hasUnsavedReviewChanges');
      assert(panelSrc.includes('data-testid="review-unsaved-approve-confirm"'), 'Deve renderizar confirmação explícita inline sem window.confirm');
      assert(panelSrc.includes('data-testid="btn-save-draft-before-approve"'), 'Deve oferecer ação explícita Save Draft First');
      assert(panelSrc.includes('data-testid="btn-confirm-save-and-approve"'), 'Deve oferecer ação explícita Save & Approve Now');
      assert(panelSrc.includes('data-testid="btn-cancel-unsaved-approve"'), 'Deve oferecer Cancel sem descartar edições');
      assert(!panelSrc.includes('window.confirm(') && !panelSrc.includes('window.alert('), 'Proibido window.confirm/alert');

      // Simulação da máquina de estado ao clicar Approve & Publish com alterações não salvas:
      // 1) Clique inicial abre confirmação e NÃO chama /approve nem marca published
      const editedV2Direct = deepClone(schedV1Trans);
      editedV2Direct.reviewSummary.rememberThis = 'Unsaved Review edit saved-and-approved via confirmation';

      let showConfirm = false;
      let publishedSuccessBanner: string | null = null;
      const approveClickHasUnsaved = !arePedagogicalTransformationsEqual(editedV2Direct, schedV1Trans);
      if (approveClickHasUnsaved) {
        showConfirm = true;
        publishedSuccessBanner = null;
      }
      assert.strictEqual(showConfirm, true);
      assert.strictEqual(publishedSuccessBanner, null);

      // 2) Mesmo que o endpoint /approve fosse chamado diretamente com editedV2 (sem draft prévio),
      // o backend NÃO pode ignorá-la pela idempotência da v1!
      const directApproveV2 = await makeRequest(
        server,
        'POST',
        `/api/session-notes/${SCHEDULED_LESSON_ID}/approve`,
        {
          lessonId: SCHEDULED_LESSON_ID,
          studentUid,
          teacherUid,
          transformation: editedV2Direct,
          baseRevisionToken: schedToken,
        },
        teacherHeaders
      );
      assert.strictEqual(directApproveV2.status, 200);
      assert.notStrictEqual(directApproveV2.data.alreadyApproved, true, 'Edição no Review NÃO pode cair no atalho idempotente da v1');
      assert.strictEqual(
        directApproveV2.data.approvedVersion.transformation.reviewSummary.rememberThis,
        'Unsaved Review edit saved-and-approved via confirmation'
      );
      assert.ok(directApproveV2.data.approvedVersion.versionNumber > schedV1VersionNumber);
      schedToken = directApproveV2.data.revisionToken;
    });

    // ------------------------------------------------------------------------
    // TEST 4: Save Draft seguido de Approve & Publish
    // ------------------------------------------------------------------------
    await test('4. Save Draft após versão aprovada cria rascunho v3 preservando v2 publicada, e Approve & Publish publica v3', async () => {
      const preDraftDoc = firestoreStore[`session_notes/${SCHEDULED_LESSON_ID}`];
      const liveV2RememberThis = preDraftDoc.lastApprovedVersion.transformation.reviewSummary.rememberThis;

      const editedV3 = deepClone(preDraftDoc.lastApprovedVersion.transformation);
      editedV3.reviewSummary.rememberThis = 'Draft v3 saved prior to publishing';
      editedV3.grammarPoints[0].rule = 'Updated grammar rule in v3 draft';

      const draftRes = await makeRequest(
        server,
        'POST',
        `/api/session-notes/${SCHEDULED_LESSON_ID}/draft`,
        {
          lessonId: SCHEDULED_LESSON_ID,
          studentUid,
          teacherUid,
          transformation: editedV3,
          baseRevisionToken: schedToken,
        },
        teacherHeaders
      );
      assert.strictEqual(draftRes.status, 200);
      assert.ok(draftRes.data.sessionNote.draftTransformation, 'Draft deve ser salvo');
      assert.strictEqual(
        draftRes.data.sessionNote.draftTransformation.transformation.reviewSummary.rememberThis,
        'Draft v3 saved prior to publishing'
      );
      // Versão anteriormente aprovada permanece intacta para o aluno até aprovação efetiva!
      assert.strictEqual(
        draftRes.data.sessionNote.lastApprovedVersion.transformation.reviewSummary.rememberThis,
        liveV2RememberThis,
        'Versão anteriormente aprovada deve permanecer intacta enquanto draft v3 não for aprovado'
      );
      assert.ok(draftRes.data.revisionToken && draftRes.data.revisionToken !== schedToken, '/draft deve rotacionar revisionToken');
      schedToken = draftRes.data.revisionToken;
      const v3DraftId = draftRes.data.sessionNote.draftTransformation.draftId;

      // Agora aprova o draft v3
      const approveV3Res = await makeRequest(
        server,
        'POST',
        `/api/session-notes/${SCHEDULED_LESSON_ID}/approve`,
        {
          lessonId: SCHEDULED_LESSON_ID,
          studentUid,
          teacherUid,
          draftId: v3DraftId,
          transformation: editedV3,
          baseRevisionToken: schedToken,
        },
        teacherHeaders
      );
      assert.strictEqual(approveV3Res.status, 200);
      assert.strictEqual(approveV3Res.data.sessionNote.draftTransformation, null);
      assert.strictEqual(
        approveV3Res.data.approvedVersion.transformation.reviewSummary.rememberThis,
        'Draft v3 saved prior to publishing'
      );
      schedToken = approveV3Res.data.revisionToken;
    });

    // ------------------------------------------------------------------------
    // TEST 5: Aprovação v2/v3 preservando versões anteriores no histórico
    // ------------------------------------------------------------------------
    await test('5. Histórico preserva todas as versões aprovadas (v1 e posteriores) sem apagar histórico anterior', async () => {
      const verRes = await makeRequest(
        server,
        'GET',
        `/api/session-notes/${SCHEDULED_LESSON_ID}/versions`,
        undefined,
        studentHeaders
      );
      assert.strictEqual(verRes.status, 200);
      const approvedEntries = (verRes.data.versionHistory || []).filter((v: any) => v.type === 'approved_published');
      assert.strictEqual(approvedEntries.length, 3, 'Devem existir todas as versões aprovadas no histórico');
      assert.strictEqual(approvedEntries[0].transformation.reviewSummary.rememberThis, 'Initial v1 takeaway (sched)');
      assert.strictEqual(
        approvedEntries[1].transformation.reviewSummary.rememberThis,
        'Unsaved Review edit saved-and-approved via confirmation'
      );
      assert.strictEqual(
        approvedEntries[2].transformation.reviewSummary.rememberThis,
        'Draft v3 saved prior to publishing'
      );
      // Versão publicada visível para o aluno é a mais recente (v3)
      assert.strictEqual(
        verRes.data.lastApprovedVersion.transformation.reviewSummary.rememberThis,
        'Draft v3 saved prior to publishing'
      );
    });

    // ------------------------------------------------------------------------
    // TEST 6: Aprovação sem alterações (idempotência sem versão duplicada)
    // ------------------------------------------------------------------------
    await test('6. Aprovação sem alterações retorna idempotência sem criar versão duplicada nem alterar revisionToken', async () => {
      const beforeDoc = firestoreStore[`session_notes/${SCHEDULED_LESSON_ID}`];
      const beforeHistoryLen = beforeDoc.versionHistory.length;
      const beforeApprovedId = beforeDoc.lastApprovedVersion.approvedVersionId;

      const idemRes = await makeRequest(
        server,
        'POST',
        `/api/session-notes/${SCHEDULED_LESSON_ID}/approve`,
        {
          lessonId: SCHEDULED_LESSON_ID,
          studentUid,
          teacherUid,
          transformation: beforeDoc.lastApprovedVersion.transformation,
          baseRevisionToken: schedToken,
        },
        teacherHeaders
      );
      assert.strictEqual(idemRes.status, 200);
      assert.strictEqual(idemRes.data.alreadyApproved, true);
      assert.strictEqual(idemRes.data.approvedVersion.approvedVersionId, beforeApprovedId);
      assert.strictEqual(idemRes.data.revisionToken, schedToken);

      const afterDoc = firestoreStore[`session_notes/${SCHEDULED_LESSON_ID}`];
      assert.strictEqual(afterDoc.versionHistory.length, beforeHistoryLen, 'Não deve criar entrada duplicada no histórico');
    });

    // ------------------------------------------------------------------------
    // TEST 7: Conflito 409 sem perda de texto/edições locais
    // ------------------------------------------------------------------------
    await test('7. Conflito 409 em /draft e /approve rejeita escrita obsoleta e preserva texto local do professor', async () => {
      const currentDoc = firestoreStore[`session_notes/${SCHEDULED_LESSON_ID}`];
      const unsavedLocalEdit = deepClone(currentDoc.lastApprovedVersion.transformation);
      unsavedLocalEdit.reviewSummary.rememberThis = 'Local teacher review edit that must survive 409';

      const staleToken = 'rev_1_stale_from_other_session';
      const draft409 = await makeRequest(
        server,
        'POST',
        `/api/session-notes/${SCHEDULED_LESSON_ID}/draft`,
        {
          lessonId: SCHEDULED_LESSON_ID,
          studentUid,
          teacherUid,
          transformation: unsavedLocalEdit,
          baseRevisionToken: staleToken,
        },
        teacherHeaders
      );
      assert.strictEqual(draft409.status, 409);
      assert.strictEqual(draft409.data.code, 'STALE_REVISION');
      assert.strictEqual(draft409.data.currentRevisionToken, schedToken);

      const approve409 = await makeRequest(
        server,
        'POST',
        `/api/session-notes/${SCHEDULED_LESSON_ID}/approve`,
        {
          lessonId: SCHEDULED_LESSON_ID,
          studentUid,
          teacherUid,
          transformation: unsavedLocalEdit,
          baseRevisionToken: staleToken,
        },
        teacherHeaders
      );
      assert.strictEqual(approve409.status, 409);
      assert.strictEqual(approve409.data.code, 'STALE_REVISION');
      assert.strictEqual(approve409.data.currentRevisionToken, schedToken);

      // Verifica que o frontend não sobrescreve editableTransformation nem revisionTokenRef em 409
      const panelSrc = fs.readFileSync(
        path.resolve(process.cwd(), 'src/components/TeacherLiveLessonNotesPanel.tsx'),
        'utf8'
      );
      const saveDraftBlock = panelSrc.slice(
        panelSrc.indexOf('const saveReviewDraftToServer'),
        panelSrc.indexOf('const handleSaveDraft')
      );
      const saveDraftErrBranch = saveDraftBlock.slice(
        saveDraftBlock.indexOf('if (!res.ok)'),
        saveDraftBlock.indexOf('return { ok: false };\n        }')
      );
      assert(!saveDraftErrBranch.includes('setEditableTransformation('), '409 em Save Draft não pode apagar/sobrescrever editableTransformation');
      assert(!saveDraftErrBranch.includes('applyServerRevisionToken('), '409 em Save Draft não pode auto-atualizar token local');
      assert(!saveDraftErrBranch.includes('setAiSuccessMessage('), '409 em Save Draft nunca deve exibir sucesso');

      const approveBlock = panelSrc.slice(
        panelSrc.indexOf('const executeApproveWithServer'),
        panelSrc.indexOf('const handleApproveAndPublish')
      );
      const approveErrBranch = approveBlock.slice(
        approveBlock.indexOf('if (!res.ok)'),
        approveBlock.indexOf('return false;\n        }')
      );
      assert(!approveErrBranch.includes('setEditableTransformation('), '409 em Approve não pode apagar editableTransformation');
      assert(!approveErrBranch.includes('applyServerRevisionToken('), '409 em Approve não pode auto-atualizar token local');
      assert(!approveErrBranch.includes('setApprovalStatus(\'approved\')'), '409 em Approve não pode marcar aprovado');
      assert(!approveErrBranch.includes('setAiSuccessMessage('), '409 em Approve nunca deve exibir sucesso');
    });

    // ------------------------------------------------------------------------
    // TEST 8: Concorrência entre duas abas (Aba 1 salva draft/aprova -> Aba 2 recebe 409)
    // ------------------------------------------------------------------------
    await test('8. Concorrência entre duas abas: Aba 1 altera Review via /draft ou /approve e Aba 2 recebe 409 sem sobrescrever', async () => {
      const baseDoc = firestoreStore[`session_notes/${SCHEDULED_LESSON_ID}`];
      const tab1Token = schedToken;
      const tab2Token = schedToken;

      const tab1Edit = deepClone(baseDoc.lastApprovedVersion.transformation);
      tab1Edit.reviewSummary.rememberThis = 'Tab 1 draft update';

      const tab2Edit = deepClone(baseDoc.lastApprovedVersion.transformation);
      tab2Edit.reviewSummary.rememberThis = 'Tab 2 conflicting edit';

      // Aba 1 salva rascunho -> sucesso e novo token
      const tab1DraftRes = await makeRequest(
        server,
        'POST',
        `/api/session-notes/${SCHEDULED_LESSON_ID}/draft`,
        {
          lessonId: SCHEDULED_LESSON_ID,
          studentUid,
          teacherUid,
          transformation: tab1Edit,
          baseRevisionToken: tab1Token,
        },
        teacherHeaders
      );
      assert.strictEqual(tab1DraftRes.status, 200);
      const tokenAfterTab1Draft = tab1DraftRes.data.revisionToken;
      assert.notStrictEqual(tokenAfterTab1Draft, tab2Token, 'Token deve ter mudado após /draft da Aba 1');

      // Aba 2 tenta salvar rascunho com token antigo -> 409 STALE_REVISION
      const tab2DraftRes = await makeRequest(
        server,
        'POST',
        `/api/session-notes/${SCHEDULED_LESSON_ID}/draft`,
        {
          lessonId: SCHEDULED_LESSON_ID,
          studentUid,
          teacherUid,
          transformation: tab2Edit,
          baseRevisionToken: tab2Token,
        },
        teacherHeaders
      );
      assert.strictEqual(tab2DraftRes.status, 409);
      assert.strictEqual(tab2DraftRes.data.code, 'STALE_REVISION');

      // Aba 2 tenta aprovar diretamente com token antigo -> 409 STALE_REVISION
      const tab2ApproveRes = await makeRequest(
        server,
        'POST',
        `/api/session-notes/${SCHEDULED_LESSON_ID}/approve`,
        {
          lessonId: SCHEDULED_LESSON_ID,
          studentUid,
          teacherUid,
          transformation: tab2Edit,
          baseRevisionToken: tab2Token,
        },
        teacherHeaders
      );
      assert.strictEqual(tab2ApproveRes.status, 409);
      assert.strictEqual(tab2ApproveRes.data.code, 'STALE_REVISION');

      // Rascunho da Aba 1 permanece intacto
      assert.strictEqual(
        firestoreStore[`session_notes/${SCHEDULED_LESSON_ID}`].draftTransformation.transformation.reviewSummary.rememberThis,
        'Tab 1 draft update'
      );

      // Aba 1 aprova seu rascunho e rotaciona novamente
      const tab1ApproveRes = await makeRequest(
        server,
        'POST',
        `/api/session-notes/${SCHEDULED_LESSON_ID}/approve`,
        {
          lessonId: SCHEDULED_LESSON_ID,
          studentUid,
          teacherUid,
          draftId: tab1DraftRes.data.sessionNote.draftTransformation.draftId,
          transformation: tab1Edit,
          baseRevisionToken: tokenAfterTab1Draft,
        },
        teacherHeaders
      );
      assert.strictEqual(tab1ApproveRes.status, 200);
      assert.notStrictEqual(tab1ApproveRes.data.revisionToken, tokenAfterTab1Draft);
      schedToken = tab1ApproveRes.data.revisionToken;
    });

    // ------------------------------------------------------------------------
    // TEST 9: Fluxo completo com aula agendada (lessonId) verificado para aluno e professor
    // ------------------------------------------------------------------------
    await test('9. Fluxo completo com aula agendada (lessonId) consistente em GET /api/session-notes para professor e aluno', async () => {
      const teacherGet = await makeRequest(
        server,
        'GET',
        `/api/session-notes?lessonId=${SCHEDULED_LESSON_ID}&studentUid=${studentUid}`,
        undefined,
        teacherHeaders
      );
      assert.strictEqual(teacherGet.status, 200);
      assert.strictEqual(teacherGet.data.approvalStatus, 'approved');
      assert.strictEqual(teacherGet.data.draftTransformation, null);
      assert.strictEqual(teacherGet.data.lastApprovedVersion.transformation.reviewSummary.rememberThis, 'Tab 1 draft update');

      const studentGet = await makeRequest(
        server,
        'GET',
        `/api/session-notes?lessonId=${SCHEDULED_LESSON_ID}&studentUid=${studentUid}`,
        undefined,
        studentHeaders
      );
      assert.strictEqual(studentGet.status, 200);
      assert.strictEqual(studentGet.data.lastApprovedVersion.transformation.reviewSummary.rememberThis, 'Tab 1 draft update');
    });

    // ------------------------------------------------------------------------
    // TEST 10: Fluxo completo de nota avulsa SEM lessonId (identidade canônica em session_notes)
    // ------------------------------------------------------------------------
    await test('10. Nota avulsa sem lessonId suporta v1 -> edição Review -> Save Draft -> Approve v2 -> idempotência -> 409 sem criar aula fictícia', async () => {
      setSessionNoteTransformAttemptExecutorForTesting(async () => JSON.stringify(buildMockAiOutput('standalone')));
      const lessonsCountBefore = Object.keys(firestoreStore).filter((k) => k.startsWith('lessons/')).length;

      // Criar nota avulsa sem lessonId
      const saveSt = await makeRequest(
        server,
        'POST',
        '/api/session-notes',
        {
          id: STANDALONE_ID,
          studentUid,
          studentEmail,
          teacherUid,
          sessionDate: STANDALONE_DATE,
          topic: 'Standalone NF2 Topic',
          content: standaloneRawHtml,
          rawContent: standaloneRawHtml,
          baseRevisionToken: null,
          skipDriveSync: true,
        },
        teacherHeaders
      );
      assert.strictEqual(saveSt.status, 200);
      standaloneToken = saveSt.data.revisionToken;

      // Apply AI
      const trSt = await makeRequest(
        server,
        'POST',
        `/api/session-notes/${STANDALONE_ID}/transform`,
        { studentUid, teacherUid, baseRevisionToken: standaloneToken },
        teacherHeaders
      );
      assert.strictEqual(trSt.status, 200);
      standaloneToken = trSt.data.revisionToken;
      standaloneV1Trans = deepClone(trSt.data.draftTransformation.transformation);

      // Aprovação v1
      const appr1St = await makeRequest(
        server,
        'POST',
        `/api/session-notes/${STANDALONE_ID}/approve`,
        {
          studentUid,
          teacherUid,
          draftId: trSt.data.draftTransformation.draftId,
          transformation: standaloneV1Trans,
          baseRevisionToken: standaloneToken,
        },
        teacherHeaders
      );
      assert.strictEqual(appr1St.status, 200);
      standaloneV1VersionNumber = appr1St.data.approvedVersion.versionNumber;
      const staleTokenAfterV1 = appr1St.data.revisionToken;
      standaloneToken = appr1St.data.revisionToken;

      // Editar Review após v1 -> Save Draft -> v1 intacta -> Approve v2
      const editedStV2 = deepClone(standaloneV1Trans);
      editedStV2.reviewSummary.rememberThis = 'Standalone v2 edited after v1 approval';

      const draftStV2 = await makeRequest(
        server,
        'POST',
        `/api/session-notes/${STANDALONE_ID}/draft`,
        {
          studentUid,
          teacherUid,
          transformation: editedStV2,
          baseRevisionToken: standaloneToken,
        },
        teacherHeaders
      );
      assert.strictEqual(draftStV2.status, 200);
      assert.strictEqual(
        draftStV2.data.sessionNote.lastApprovedVersion.transformation.reviewSummary.rememberThis,
        'Initial v1 takeaway (standalone)',
        'v1 standalone deve permanecer intacta enquanto v2 é rascunho'
      );
      standaloneToken = draftStV2.data.revisionToken;

      const appr2St = await makeRequest(
        server,
        'POST',
        `/api/session-notes/${STANDALONE_ID}/approve`,
        {
          studentUid,
          teacherUid,
          draftId: draftStV2.data.sessionNote.draftTransformation.draftId,
          transformation: editedStV2,
          baseRevisionToken: standaloneToken,
        },
        teacherHeaders
      );
      assert.strictEqual(appr2St.status, 200);
      assert.ok(appr2St.data.approvedVersion.versionNumber > standaloneV1VersionNumber);
      assert.strictEqual(
        appr2St.data.approvedVersion.transformation.reviewSummary.rememberThis,
        'Standalone v2 edited after v1 approval'
      );
      standaloneToken = appr2St.data.revisionToken;

      // Histórico preserva v1 e v2
      const stHistoryApproved = (appr2St.data.sessionNote.versionHistory || []).filter(
        (v: any) => v.type === 'approved_published'
      );
      assert.strictEqual(stHistoryApproved.length, 2);
      assert.strictEqual(stHistoryApproved[0].transformation.reviewSummary.rememberThis, 'Initial v1 takeaway (standalone)');
      assert.strictEqual(stHistoryApproved[1].transformation.reviewSummary.rememberThis, 'Standalone v2 edited after v1 approval');

      // Idempotência sem alterações
      const idemSt = await makeRequest(
        server,
        'POST',
        `/api/session-notes/${STANDALONE_ID}/approve`,
        {
          studentUid,
          teacherUid,
          transformation: editedStV2,
          baseRevisionToken: standaloneToken,
        },
        teacherHeaders
      );
      assert.strictEqual(idemSt.status, 200);
      assert.strictEqual(idemSt.data.alreadyApproved, true);

      // Concorrência / 409 usando token antigo da v1
      const conflictSt = await makeRequest(
        server,
        'POST',
        `/api/session-notes/${STANDALONE_ID}/approve`,
        {
          studentUid,
          teacherUid,
          transformation: editedStV2,
          baseRevisionToken: staleTokenAfterV1,
        },
        teacherHeaders
      );
      assert.strictEqual(conflictSt.status, 409);
      assert.strictEqual(conflictSt.data.code, 'STALE_REVISION');

      // Nenhuma aula fictícia criada em `lessons/`
      const lessonsCountAfter = Object.keys(firestoreStore).filter((k) => k.startsWith('lessons/')).length;
      assert.strictEqual(lessonsCountAfter, lessonsCountBefore, 'Não pode criar aula fictícia em lessons');
      assert.strictEqual(firestoreStore[`session_notes/${STANDALONE_ID}`].lessonId, '');
    });
  } finally {
    resetFirebaseAdminFirestoreForTesting();
    setSessionNoteTransformAttemptExecutorForTesting(null);
    resetGeminiSecurityStateForTesting();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  console.log('\n======================================================================');
  console.log(`RESULTADO NF.FLOW.2: ${passed} PASSOU | ${failed} FALHOU`);
  console.log('======================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
  process.exit(0);
}

run().catch((err) => {
  console.error('Fatal error in NF.FLOW.2 validation:', err);
  process.exit(1);
});
