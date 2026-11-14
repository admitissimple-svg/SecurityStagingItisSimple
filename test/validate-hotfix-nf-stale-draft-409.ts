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
  fetchPedagogicalTransformationFromFirestoreServer,
  savePedagogicalTransformationToFirestoreServer,
} from '../src/serverFirestore';
import { resetGeminiSecurityStateForTesting } from '../src/serverGeminiSecurity';
import { computeNotesContentHash } from '../src/utils/notesVersioning';
import { buildPedagogicalCacheKey, PEDAGOGICAL_PROMPT_VERSION } from '../src/utils/pedagogicalTransformer';

function makeRequest(
  server: http.Server,
  method: string,
  pathStr: string,
  body?: any,
  headers: Record<string, string> = {}
): Promise<{ status: number; data: any; headers: any }> {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    if (!addr || typeof addr === 'string') {
      return reject(new Error('Server address not available'));
    }
    const port = addr.port;
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
        port,
        path: pathStr,
        method,
        headers: reqHeaders,
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => {
          raw += chunk;
        });
        res.on('end', () => {
          let parsed: any;
          try {
            parsed = JSON.parse(raw);
          } catch {
            parsed = raw;
          }
          resolve({
            status: res.statusCode || 0,
            data: parsed,
            headers: res.headers,
          });
        });
      }
    );

    req.on('error', reject);
    if (bodyStr) {
      req.write(bodyStr);
    }
    req.end();
  });
}

async function runHotfixStaleDraftTests() {
  console.log('======================================================================');
  console.log("HOTFIX NF — VALIDAÇÃO STALE_DRAFT 409 (CACHE H1/H2, DRAFT, APPROVE)");
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
        console.error(err.stack.split('\n').slice(1, 4).join('\n'));
      }
    }
  }

  const ts = Date.now();
  const studentUid = `student-stale409-${ts}`;
  const studentEmail = `student.stale409.${ts}@example.com`;
  const teacherUid = `teacher-stale409-${ts}`;
  const teacherEmail = `teacher.stale409.${ts}@example.com`;

  const tokenMap: Record<string, any> = {
    'tok-student': { uid: studentUid, email: studentEmail, email_verified: true, role: 'student' },
    'tok-teacher': { uid: teacherUid, email: teacherEmail, email_verified: true, role: 'teacher' },
  };

  setFirebaseAdminAuthForTesting({
    verifyIdToken: async (token: string) => {
      const match = tokenMap[token];
      if (match) return match;
      throw new Error(`Invalid token: ${token}`);
    },
    getUser: async (uid: string) => {
      const found = Object.values(tokenMap).find((u) => u.uid === uid);
      if (found) return found;
      throw new Error(`User not found: ${uid}`);
    },
    getUserByEmail: async (email: string) => {
      const found = Object.values(tokenMap).find((u) => u.email === email);
      if (found) return found;
      throw new Error('User not found');
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
      name: 'Teacher Native Friend',
      approvalStatus: 'approved',
      isApproved: true,
    },
  };

  setFirebaseAdminFirestoreForTesting({
    collection: (colName: string) => ({
      doc: (docId: string) => ({
        get: async () => {
          const key = `${colName}/${docId}`;
          const data = firestoreStore[key];
          return {
            exists: Boolean(data),
            id: docId,
            data: () => (data ? JSON.parse(JSON.stringify(data)) : undefined),
          };
        },
        set: async (val: any, opts?: any) => {
          const key = `${colName}/${docId}`;
          if (opts?.merge && firestoreStore[key]) {
            firestoreStore[key] = { ...firestoreStore[key], ...JSON.parse(JSON.stringify(val)) };
          } else {
            firestoreStore[key] = JSON.parse(JSON.stringify(val));
          }
          return { writeTime: new Date() };
        },
        update: async (val: any) => {
          const key = `${colName}/${docId}`;
          if (!firestoreStore[key]) firestoreStore[key] = {};
          firestoreStore[key] = { ...firestoreStore[key], ...JSON.parse(JSON.stringify(val)) };
          return { writeTime: new Date() };
        },
        delete: async () => {
          const key = `${colName}/${docId}`;
          delete firestoreStore[key];
          return { writeTime: new Date() };
        },
        collection: (subCol: string) => ({
          doc: (subId: string) => ({
            get: async () => {
              const key = `${colName}/${docId}/${subCol}/${subId}`;
              const data = firestoreStore[key];
              return {
                exists: Boolean(data),
                id: subId,
                data: () => (data ? JSON.parse(JSON.stringify(data)) : undefined),
              };
            },
            set: async (val: any, opts?: any) => {
              const key = `${colName}/${docId}/${subCol}/${subId}`;
              if (opts?.merge && firestoreStore[key]) {
                firestoreStore[key] = { ...firestoreStore[key], ...JSON.parse(JSON.stringify(val)) };
              } else {
                firestoreStore[key] = JSON.parse(JSON.stringify(val));
              }
              return { writeTime: new Date() };
            },
          }),
          get: async () => {
            const prefix = `${colName}/${docId}/${subCol}/`;
            const matchingDocs = Object.keys(firestoreStore)
              .filter((k) => k.startsWith(prefix))
              .map((k) => ({
                id: k.slice(prefix.length),
                data: () => JSON.parse(JSON.stringify(firestoreStore[k])),
              }));
            return {
              empty: matchingDocs.length === 0,
              size: matchingDocs.length,
              docs: matchingDocs,
            };
          },
        }),
      }),
      where: (field: string, _op: string, val: any) => {
        const createQuery = (filters: Array<{ field: string; val: any }>) => ({
          where: (f2: string, _op2: string, v2: any) => createQuery([...filters, { field: f2, val: v2 }]),
          get: async () => {
            const prefix = `${colName}/`;
            const matching = Object.keys(firestoreStore)
              .filter((k) => k.startsWith(prefix) && !k.slice(prefix.length).includes('/'))
              .filter((k) => filters.every((flt) => firestoreStore[k]?.[flt.field] === flt.val))
              .map((k) => ({
                id: k.slice(prefix.length),
                data: () => JSON.parse(JSON.stringify(firestoreStore[k])),
              }));
            return {
              empty: matching.length === 0,
              size: matching.length,
              docs: matching,
              forEach: (fn: any) => matching.forEach(fn),
            };
          },
        });
        return createQuery([{ field, val }]);
      },
      get: async () => {
        const prefix = `${colName}/`;
        const matching = Object.keys(firestoreStore)
          .filter((k) => k.startsWith(prefix) && !k.slice(prefix.length).includes('/'))
          .map((k) => ({
            id: k.slice(prefix.length),
            data: () => JSON.parse(JSON.stringify(firestoreStore[k])),
          }));
        return { empty: matching.length === 0, size: matching.length, docs: matching };
      },
    }),
    runTransaction: async (fn: any) => {
      const tx = {
        get: async (ref: any) => ref.get(),
        set: (ref: any, val: any, opts?: any) => ref.set(val, opts),
        update: (ref: any, val: any) => ref.update(val),
      };
      return fn(tx);
    },
  } as any);
  setIsCloudWriteDisabled(false);

  const server = http.createServer(serverApp);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  const NOTE_ID = `session_2026-11-14_${studentUid}`;
  const RAW_H1 = `
Lesson H1 - Interview Prep
(Alt+N) I have 30 years old (Alt+Y) I am 30 years old
(Alt+W) resilient
(Alt+P) comfortable
`;
  const RAW_H2 = `
Lesson H2 - Updated with New Vocabulary
(Alt+N) I have 30 years old (Alt+Y) I am 30 years old
(Alt+N) I am agree with you (Alt+Y) I agree with you
(Alt+W) resilient
(Alt+W) streamline
(Alt+P) comfortable
`;
  const RAW_H3 = RAW_H2 + '\n(Alt+W) synergy';

  const H1 = computeNotesContentHash(RAW_H1);
  const H2 = computeNotesContentHash(RAW_H2);
  const H3 = computeNotesContentHash(RAW_H3);
  assert(H1 !== H2 && H2 !== H3 && H1 !== H3, 'Hashes H1, H2, H3 must be distinct');

  const makeMockAiOutput = (includeH2: boolean) => ({
    mistakesAnalysis: [
      {
        id: 'mistake-1',
        original: 'I have 30 years old',
        corrected: 'I am 30 years old',
        category: 'grammar',
        explanation: 'In English, use the verb "to be" for age.',
        grammarRule: 'Subject + be + age',
        twoExamples: ['She is 25 years old.', 'My brother is 30.'],
        commonPitfalls: 'Avoid using "have" for age.',
        similarFormsComparison: 'I am 30 vs I have 30',
      },
      ...(includeH2
        ? [
            {
              id: 'mistake-2',
              original: 'I am agree with you',
              corrected: 'I agree with you',
              category: 'grammar',
              explanation: '"Agree" is a verb, not an adjective, so do not use "am".',
              grammarRule: 'Subject + agree (no auxiliary be)',
              twoExamples: ['I completely agree with your point.', 'We agree on the timeline.'],
              commonPitfalls: 'Avoid "I am agree".',
              similarFormsComparison: 'I agree vs I am in agreement',
            },
          ]
        : []),
    ],
    grammarPoints: [
      {
        id: 'grammar-1',
        topic: 'Verb To Be for Age',
        rule: 'Use be + number (+ years old) to express age.',
        form: 'Subject + am/is/are + age',
        usage: 'Describing age naturally.',
        examples: ['I am 30 years old.', 'He is 22.'],
        commonMistakes: 'Using have instead of be.',
        comparisons: 'Portuguese uses ter, English uses to be.',
      },
    ],
    vocabularyAndExpressions: [
      {
        id: 'vocab-1',
        term: 'resilient',
        partOfSpeech: 'Adjective',
        definitionEn: 'Able to recover quickly from difficulties.',
        simpleDefinition: 'Able to bounce back quickly after tough situations.',
        collocations: ['resilient team', 'stay resilient'],
        realExamples: ['She stayed resilient throughout the restructuring.'],
        synonyms: ['adaptable', 'tough'],
        register: 'neutral',
        registerNote: 'Great in interviews.',
        category: 'Work & Mindset',
        isNewWord: true,
        isPronunciationFocus: false,
      },
      {
        id: 'vocab-2',
        term: 'comfortable',
        partOfSpeech: 'Adjective',
        definitionEn: 'Providing physical or emotional ease.',
        simpleDefinition: 'Feeling relaxed and at ease.',
        collocations: ['feel comfortable'],
        realExamples: ['I feel comfortable presenting in English now.'],
        synonyms: ['at ease'],
        register: 'neutral',
        category: 'Pronunciation Focus',
        phoneticGuide: '/ˈkʌmf.tə.bəl/ (3 syllables)',
        isNewWord: false,
        isPronunciationFocus: true,
      },
      ...(includeH2
        ? [
            {
              id: 'vocab-3',
              term: 'streamline',
              partOfSpeech: 'Verb',
              definitionEn: 'Make a process simpler and more efficient.',
              simpleDefinition: 'Make work faster and simpler by removing extra steps.',
              collocations: ['streamline a workflow'],
              realExamples: ['We streamlined our onboarding workflow this quarter.'],
              synonyms: ['simplify'],
              register: 'neutral',
              category: 'Work & Mindset',
              isNewWord: true,
              isPronunciationFocus: false,
            },
          ]
        : []),
    ],
    reviewSummary: {
      estimatedMinutes: '5–10 minutes',
      keyRules: ['Use to be for age, not have.'],
      mustKnowVocabulary: includeH2 ? ['resilient', 'comfortable', 'streamline'] : ['resilient', 'comfortable'],
      essentialCorrections: [{ original: 'I have 30 years old', corrected: 'I am 30 years old' }],
      usefulPatterns: ['I am ___ years old.', 'We streamlined ___'],
      rememberThis: includeH2
        ? 'Say "I am 30" and "I agree with you", and use "streamline" for process improvements!'
        : 'Say "I am 30 years old", never "I have 30 years old".',
    },
  });

  const teacherHeaders = { Authorization: 'Bearer tok-teacher' };

  try {
    console.log('--- Bloco 1: fetchPedagogicalTransformationFromFirestoreServer exige contentHash exato ---');

    await test('1.1: Salva transformação H1 no cache e retorna apenas para contentHash H1; H2 retorna null', async () => {
      const cacheKeyH1 = buildPedagogicalCacheKey({
        canonicalSessionKey: NOTE_ID,
        contentHash: H1,
        language: 'en',
        cefrLevel: 'B1',
      });
      const cacheKeyH2 = buildPedagogicalCacheKey({
        canonicalSessionKey: NOTE_ID,
        contentHash: H2,
        language: 'en',
        cefrLevel: 'B1',
      });

      const h1Trans = {
        ...makeMockAiOutput(false),
        sessionKey: NOTE_ID,
        sessionDate: '2026-11-14',
        studentUid,
        studentEmail,
        teacherUid,
        teacherEmail,
        cefrLevel: 'B1',
        contentHash: H1,
        language: 'pt',
        promptVersion: PEDAGOGICAL_PROMPT_VERSION,
        isAiGenerated: true,
        isFallback: false,
        isProvisional: false,
        rawNotesSnippet: RAW_H1.slice(0, 300),
      };

      const saved = await savePedagogicalTransformationToFirestoreServer(cacheKeyH1, h1Trans, { rawNotes: RAW_H1 });
      assert.strictEqual(saved, true);

      const hitH1 = await fetchPedagogicalTransformationFromFirestoreServer(cacheKeyH1, {
        language: 'en',
        contentHash: H1,
        rawNotes: RAW_H1,
      });
      assert.ok(hitH1, 'H1 deve ser encontrado no cache');
      assert.strictEqual(hitH1.contentHash, H1);

      // Querying with H2 composite key or session key + H2 must return null (NEVER H1)
      const missH2Composite = await fetchPedagogicalTransformationFromFirestoreServer(cacheKeyH2, {
        language: 'en',
        contentHash: H2,
        rawNotes: RAW_H2,
      });
      assert.strictEqual(missH2Composite, null, 'H2 sem correspondência no cache deve retornar null');

      const missH2BySession = await fetchPedagogicalTransformationFromFirestoreServer(NOTE_ID, {
        language: 'pt',
        contentHash: H2,
        rawNotes: RAW_H2,
      });
      assert.strictEqual(missH2BySession, null, 'Busca por sessionKey com contentHash H2 deve retornar null quando só existe H1');

      // Querying exact H1 doc with mismatched contentHash option H2 must also return null
      const missH1DocWithH2Option = await fetchPedagogicalTransformationFromFirestoreServer(cacheKeyH1, {
        language: 'pt',
        contentHash: H2,
        rawNotes: RAW_H2,
      });
      assert.strictEqual(missH1DocWithH2Option, null, 'Doc H1 consultado com option contentHash=H2 deve retornar null');
    });

    console.log('\n--- Bloco 2: Fluxo real H1 -> Approve & Publish -> Edit H2 -> Apply AI -> Save Draft -> Approve & Publish ---');

    let draftH1Id = '';

    await test('2.1: Salva notas H1, gera transformação H1 (cache hit sem Gemini) e aprova H1', async () => {
      const saveH1 = await makeRequest(
        server,
        'POST',
        '/api/session-notes',
        {
          id: NOTE_ID,
          studentUid,
          studentEmail,
          sessionDate: '2026-11-14',
          topic: 'Interview Prep',
          content: RAW_H1,
          rawContent: RAW_H1,
        },
        teacherHeaders
      );
      assert.strictEqual(saveH1.status, 200);

      // Clear test executor to exercise production cache reuse path for H1
      resetGeminiSecurityStateForTesting();
      setSessionNoteTransformAttemptExecutorForTesting(null);

      const transformH1 = await makeRequest(
        server,
        'POST',
        `/api/session-notes/${NOTE_ID}/transform`,
        { language: 'pt', studentUid, teacherUid },
        teacherHeaders
      );
      assert.strictEqual(transformH1.status, 200, `Expected 200 for cached H1, got ${transformH1.status}`);
      assert.strictEqual(transformH1.data.cached, true);
      assert.strictEqual(transformH1.data.draftTransformation.contentHash, H1);
      assert.strictEqual(transformH1.data.draftTransformation.transformation.contentHash, H1);
      draftH1Id = transformH1.data.draftTransformation.draftId;

      const approveH1 = await makeRequest(
        server,
        'POST',
        `/api/session-notes/${NOTE_ID}/approve`,
        {
          draftId: draftH1Id,
          transformation: transformH1.data.draftTransformation.transformation,
          studentUid,
          teacherUid,
        },
        teacherHeaders
      );
      assert.strictEqual(approveH1.status, 200);
      assert.strictEqual(approveH1.data.approvalStatus, 'approved');
      assert.strictEqual(approveH1.data.approvedVersion.contentHash, H1);
      assert.strictEqual(approveH1.data.sessionNote.draftTransformation, null);
    });

    await test('2.2: Edita notas para H2; handleSessionNoteTransformInternal NÃO reutiliza cache H1 (tenta nova geração Gemini)', async () => {
      const saveH2 = await makeRequest(
        server,
        'POST',
        '/api/session-notes',
        {
          id: NOTE_ID,
          studentUid,
          studentEmail,
          sessionDate: '2026-11-14',
          topic: 'Interview Prep Updated',
          content: RAW_H2,
          rawContent: RAW_H2,
        },
        teacherHeaders
      );
      assert.strictEqual(saveH2.status, 200);
      // Preserves lastApprovedVersion H1 while rawContent is now H2
      assert.strictEqual(saveH2.data.sessionNote.lastApprovedVersion.contentHash, H1);
      assert.strictEqual(saveH2.data.sessionNote.draftTransformation, null);

      // Even with test mock executor DISABLED (so cache path runs) and no real Gemini network,
      // transform MUST NOT reuse H1 cache! Remove API key temporarily to verify it reaches Gemini step (503) instead of returning cached H1 (200).
      const prevKey = process.env.GEMINI_API_KEY;
      process.env.GEMINI_API_KEY = '';
      setSessionNoteTransformAttemptExecutorForTesting(null);
      try {
        const noCacheReuseRes = await makeRequest(
          server,
          'POST',
          `/api/session-notes/${NOTE_ID}/transform`,
          { language: 'pt', studentUid, teacherUid },
          teacherHeaders
        );
        assert.strictEqual(
          noCacheReuseRes.status,
          503,
          `Transform com H2 não pode reutilizar cache H1 (esperado 503 sem API key, obtido ${noCacheReuseRes.status})`
        );
        assert.strictEqual(noCacheReuseRes.data.code, 'AI_TRANSFORMATION_FAILED');
      } finally {
        process.env.GEMINI_API_KEY = prevKey;
      }
    });

    await test('2.3: handleSessionNoteTransformInternal rejeita draft corrompido cujo wrapper tem H2 mas transformation.contentHash === H1', async () => {
      const docKey = `session_notes/${NOTE_ID}`;
      const prevDoc = JSON.parse(JSON.stringify(firestoreStore[docKey]));
      firestoreStore[docKey] = {
        ...prevDoc,
        draftTransformation: {
          draftId: 'corrupted_draft_h2_wrapping_h1',
          versionNumber: 99,
          status: 'draft',
          contentHash: H2,
          transformation: {
            ...makeMockAiOutput(false),
            contentHash: H1, // mismatched inner hash!
            isAiGenerated: true,
            isFallback: false,
            isProvisional: false,
            promptVersion: PEDAGOGICAL_PROMPT_VERSION,
            language: 'pt',
          },
        },
      };

      const prevKey = process.env.GEMINI_API_KEY;
      process.env.GEMINI_API_KEY = '';
      setSessionNoteTransformAttemptExecutorForTesting(null);
      try {
        const res = await makeRequest(
          server,
          'POST',
          `/api/session-notes/${NOTE_ID}/transform`,
          { language: 'pt', studentUid, teacherUid },
          teacherHeaders
        );
        assert.strictEqual(
          res.status,
          503,
          `Não deve reutilizar cand quando cand.contentHash (${H1}) !== contentHash (${H2})`
        );
      } finally {
        process.env.GEMINI_API_KEY = prevKey;
        firestoreStore[docKey] = prevDoc;
      }
    });

    let draftH2: any = null;

    await test('2.4: Nova geração Gemini para H2 -> Save Draft -> Approve & Publish (200 OK) + versionHistory completo', async () => {
      resetGeminiSecurityStateForTesting();
      let geminiCalls = 0;
      setSessionNoteTransformAttemptExecutorForTesting(async () => {
        geminiCalls++;
        return JSON.stringify(makeMockAiOutput(true));
      });

      const transformH2 = await makeRequest(
        server,
        'POST',
        `/api/session-notes/${NOTE_ID}/transform`,
        { language: 'pt', studentUid, teacherUid },
        teacherHeaders
      );
      assert.strictEqual(transformH2.status, 200);
      assert.strictEqual(geminiCalls, 1, 'Deve gerar nova transformação via Gemini');
      assert.strictEqual(transformH2.data.draftTransformation.contentHash, H2);
      assert.strictEqual(transformH2.data.draftTransformation.transformation.contentHash, H2);
      draftH2 = transformH2.data.draftTransformation;

      // Save Draft with inline teacher edit
      const editedTrans = JSON.parse(JSON.stringify(draftH2.transformation));
      editedTrans.reviewSummary.rememberThis = 'Edited for H2: I agree with you & streamline!';

      const saveDraftRes = await makeRequest(
        server,
        'POST',
        `/api/session-notes/${NOTE_ID}/draft`,
        {
          draftId: draftH2.draftId,
          transformation: editedTrans,
          studentUid,
          teacherUid,
          changeSummary: 'Teacher edited H2 draft',
        },
        teacherHeaders
      );
      assert.strictEqual(saveDraftRes.status, 200);
      assert.strictEqual(saveDraftRes.data.sessionNote.draftTransformation.contentHash, H2);
      assert.strictEqual(saveDraftRes.data.sessionNote.draftTransformation.transformation.contentHash, H2);

      // Approve & Publish H2
      const activeDraftId = saveDraftRes.data.sessionNote.draftTransformation.draftId;
      const approveH2 = await makeRequest(
        server,
        'POST',
        `/api/session-notes/${NOTE_ID}/approve`,
        {
          draftId: activeDraftId,
          transformation: editedTrans,
          studentUid,
          teacherUid,
        },
        teacherHeaders
      );
      assert.strictEqual(approveH2.status, 200, `Approve H2 deve retornar 200, obtido ${approveH2.status}`);
      assert.strictEqual(approveH2.data.approvedVersion.contentHash, H2);
      assert.strictEqual(approveH2.data.sessionNote.draftTransformation, null);

      // Verify cache hit on H2 now works with 0 Gemini calls
      setSessionNoteTransformAttemptExecutorForTesting(null);
      const cacheHitH2 = await makeRequest(
        server,
        'POST',
        `/api/session-notes/${NOTE_ID}/transform`,
        { language: 'pt', studentUid, teacherUid },
        teacherHeaders
      );
      assert.strictEqual(cacheHitH2.status, 200);
      assert.strictEqual(cacheHitH2.data.cached, true);
      assert.strictEqual(cacheHitH2.data.draftTransformation.contentHash, H2);
      assert.strictEqual(cacheHitH2.data.draftTransformation.transformation.contentHash, H2);

      // Verify versionHistory integrity
      const versionsRes = await makeRequest(
        server,
        'GET',
        `/api/session-notes/${NOTE_ID}/versions`,
        undefined,
        teacherHeaders
      );
      assert.strictEqual(versionsRes.status, 200);
      const history = versionsRes.data.versionHistory || [];
      const approvedEntries = history.filter((v: any) => v.type === 'approved_published');
      assert(approvedEntries.length >= 2, `Histórico deve registrar ambas aprovações (H1 e H2), obtido ${approvedEntries.length}`);
      assert.strictEqual(approvedEntries[0].contentHash, H1);
      assert.strictEqual(approvedEntries[1].contentHash, H2);
    });

    console.log('\n--- Bloco 3: Preservação rigorosa do 409 STALE_DRAFT no backend ---');

    await test('3.1: Backend retorna 409 STALE_DRAFT quando notas mudam para H3 e tenta aprovar transformação H2 (com ou sem draft)', async () => {
      // Approve H2 cleanly first so draftTransformation becomes null
      const versionsBefore = await makeRequest(server, 'GET', `/api/session-notes/${NOTE_ID}/versions`, undefined, teacherHeaders);
      const activeDraft = versionsBefore.data.draftTransformation;
      const cleanApprove = await makeRequest(
        server,
        'POST',
        `/api/session-notes/${NOTE_ID}/approve`,
        {
          draftId: activeDraft.draftId,
          transformation: activeDraft.transformation,
          studentUid,
          teacherUid,
        },
        teacherHeaders
      );
      assert.strictEqual(cleanApprove.status, 200);

      // Now modify raw notes to H3 (no draft exists, lastApprovedVersion has H2)
      const saveH3 = await makeRequest(
        server,
        'POST',
        '/api/session-notes',
        {
          id: NOTE_ID,
          studentUid,
          studentEmail,
          sessionDate: '2026-11-14',
          topic: 'Interview Prep H3',
          content: RAW_H3,
          rawContent: RAW_H3,
        },
        teacherHeaders
      );
      assert.strictEqual(saveH3.status, 200);
      assert.strictEqual(saveH3.data.sessionNote.draftTransformation, null);

      // Direct API call trying to approve H2 transformation when raw notes are H3 MUST return 409 STALE_DRAFT
      const staleApproveNoDraft = await makeRequest(
        server,
        'POST',
        `/api/session-notes/${NOTE_ID}/approve`,
        {
          transformation: cleanApprove.data.approvedVersion.transformation,
          studentUid,
          teacherUid,
        },
        teacherHeaders
      );
      assert.strictEqual(staleApproveNoDraft.status, 409, 'Backend deve preservar 409 STALE_DRAFT sem mascarar conflito');
      assert.strictEqual(staleApproveNoDraft.data.code, 'STALE_DRAFT');
    });

    console.log('\n--- Bloco 4: Verificação de guarda no frontend (TeacherLiveLessonNotesPanel.tsx) ---');

    await test('4.1: Frontend impede Approve & Publish quando não há draft atual e transformação aprovada pertence a outro contentHash', () => {
      const panelPath = path.resolve(process.cwd(), 'src/components/TeacherLiveLessonNotesPanel.tsx');
      const panelSrc = fs.readFileSync(panelPath, 'utf8');

      assert(panelSrc.includes('isApprovedTransformationStale'), 'Deve existir estado derivado isApprovedTransformationStale');
      assert(panelSrc.includes('isTransformationOutdated'), 'Deve existir guarda combinada isTransformationOutdated');
      assert(
        panelSrc.includes('if (draftTransformation) return false;') &&
          panelSrc.includes('lastApprovedVersion?.contentHash') &&
          panelSrc.includes('approvedHash !== currentNotesHash'),
        'Deve bloquear quando não há draft atual e a transformação aprovada pertence a outro contentHash'
      );
      assert(
        panelSrc.includes('disabled={isApproving || isTransformationOutdated}') &&
          panelSrc.includes('disabled={isSavingDraft || isApproving || isTransformationOutdated}'),
        'Botões Save Draft e Approve & Publish devem ficar desabilitados quando isTransformationOutdated for true'
      );
      assert(
        panelSrc.includes('if (isTransformationOutdated)'),
        'handleSaveDraft e handleApproveAndPublish devem bloquear chamada ao backend quando desatualizado'
      );
      // Ensure backend never artificially overwrites incoming transformation contentHash
      const serverSrc = fs.readFileSync(path.resolve(process.cwd(), 'serverApp.ts'), 'utf8');
      assert(
        !serverSrc.includes('req.body.transformation.contentHash = currentContentHash'),
        'Backend nunca deve substituir artificialmente contentHash da transformação recebida'
      );
    });
  } finally {
    resetFirebaseAdminFirestoreForTesting();
    setSessionNoteTransformAttemptExecutorForTesting(null);
    resetGeminiSecurityStateForTesting();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  console.log('\n======================================================================');
  console.log(`RESULTADO HOTFIX NF STALE_DRAFT 409: ${passed} PASSOU | ${failed} FALHOU`);
  console.log('======================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
  process.exit(0);
}

runHotfixStaleDraftTests().catch((err) => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});
