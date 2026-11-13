process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = 'test-gemini-api-key';

import assert from 'assert';
import http from 'http';
import fs from 'fs';
import path from 'path';
import {
  app as serverApp,
  executePedagogicalTransformationCore,
  setSessionNoteTransformAttemptExecutorForTesting,
} from '../serverApp';
import { setFirebaseAdminAuthForTesting } from '../src/serverFirebaseAdmin';
import {
  setFirebaseAdminFirestoreForTesting,
  resetFirebaseAdminFirestoreForTesting,
  setIsCloudWriteDisabled,
} from '../src/serverFirestore';
import {
  DEFAULT_GEMINI_MODEL,
  DEFAULT_CONTINGENCY_POOL,
  GEMINI_POLICIES,
  resetGeminiSecurityStateForTesting,
} from '../src/serverGeminiSecurity';

/**
 * IT'S SIMPLE — NF-DOC.2F Validation Suite
 * Gemini Output Language | Surgical Hotfix | Isolated Tests (Zero Real API Calls)
 *
 * Verifies:
 * 1. Gemini instructions for Native Friends Notes mandate 100% English output across all 4 parts
 *    (Analyze Mistakes, Grammar Points, Vocabulary & Expressions, Quick Review) even when request
 *    body passes language='pt' or raw notes contain Portuguese/bilingual annotations.
 * 2. Titles, rules, explanations, created examples, definitions (definitionEn & simpleDefinition),
 *    pitfalls, comparisons, and review summaries (keyRules, rememberThis) are strictly instructed in English.
 * 3. Literal student and teacher excerpts are preserved verbatim when presented as quotes/examples,
 *    and raw original notes are never translated or modified.
 * 4. JSON contract, CELTA pedagogical validators, and teacher review/approval workflow remain intact.
 * 5. UIDs, RBAC, authentication, Firestore paths, models, token policies, timeouts, and other Gemini
 *    features remain completely untouched.
 */

function createInMemoryFirestore(store: Record<string, any>) {
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
            const exists = Object.prototype.hasOwnProperty.call(store, fullPath);
            const clone = exists ? JSON.parse(JSON.stringify(store[fullPath])) : undefined;
            return {
              id: docId,
              exists,
              data: () => clone,
            };
          },
          async set(data: any, opts?: { merge?: boolean }) {
            const incoming = JSON.parse(JSON.stringify(data));
            if (opts?.merge && store[fullPath]) {
              store[fullPath] = { ...store[fullPath], ...incoming };
            } else {
              store[fullPath] = incoming;
            }
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

async function runSuite() {
  console.log('======================================================================');
  console.log("IT'S SIMPLE — NF-DOC.2F: GEMINI OUTPUT LANGUAGE (ENGLISH-ONLY) SUITE");
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
      console.error(`     ${err?.message || err}`);
    }
  }

  const teacherUid = 'jCkNIhvYEYbyJC2CWGZhFaoHGfo1';
  const teacherEmail = 'laviniafofafc@gmail.com';
  const studentUid = 'studentCanonicalUidDoc2f0001';
  const studentEmail = 'student.doc2f@example.com';

  const firestoreStore: Record<string, any> = {
    [`users/${teacherUid}`]: {
      uid: teacherUid,
      email: teacherEmail,
      name: 'Skull Bee',
      role: 'teacher',
    },
    'tutors/skull-bee': {
      id: 'skull-bee',
      publicTutorId: 'skull-bee',
      uid: teacherUid,
      authUid: teacherUid,
      email: teacherEmail,
      name: 'Skull Bee',
      approvalStatus: 'approved',
      isApproved: true,
    },
    [`users/${studentUid}`]: {
      uid: studentUid,
      email: studentEmail,
      name: 'Lucas Mendes',
      role: 'student',
      level: 'intermediario',
      teacherUid,
      assignedNativeFriendUID: teacherUid,
      teacherId: 'skull-bee',
    },
    'lessons/lesson-doc2f-001': {
      id: 'lesson-doc2f-001',
      studentUid,
      studentEmail,
      teacherUid,
      teacherEmail,
      teacherName: 'Skull Bee',
      title: 'Modal Verbs & Daily Work',
      status: 'scheduled',
      startDateTime: '2026-11-12T16:00:00.000Z',
    },
  };

  setIsCloudWriteDisabled(false);
  setFirebaseAdminFirestoreForTesting(createInMemoryFirestore(firestoreStore) as any);

  const tokenMap: Record<string, any> = {
    'token-teacher': { uid: teacherUid, email: teacherEmail, email_verified: true },
    'token-student': { uid: studentUid, email: studentEmail, email_verified: true },
  };

  setFirebaseAdminAuthForTesting({
    verifyIdToken: async (token: string) => {
      if (tokenMap[token]) return tokenMap[token];
      throw new Error('Invalid token');
    },
    getUser: async (uid: string) => {
      const entry = Object.values(tokenMap).find((u: any) => u.uid === uid);
      if (entry) return entry;
      throw new Error('User not found');
    },
    getUserByEmail: async (email: string) => {
      const entry = Object.values(tokenMap).find((u: any) => u.email === email);
      if (entry) return entry;
      throw new Error('User not found');
    },
  } as any);

  const bilingualRawNotes = [
    'In-Session Notes — Observação da professora em português: aluno traduziu "poder ter" literalmente.',
    '(Alt+N) We can\'t to have (Alt+Y) We can\'t have',
    '(Alt+W) follow up',
    '(Alt+P) schedule',
    'Teacher classroom example quoted: "We can\'t have a meeting without an agenda."',
    'Student literal comment: "Eu sempre confundo can to have no trabalho."',
  ].join('\n');

  const englishGeminiOutput = {
    mistakesAnalysis: [
      {
        id: 'mistake-1',
        original: "We can't to have",
        corrected: "We can't have",
        category: 'grammar',
        explanation: "Modal verbs like 'can' and 'can't' are followed directly by the base form of the main verb (bare infinitive), without 'to'.",
        twoExamples: [
          "We can't have a meeting without an agenda.",
          'She can finish the report before Friday.',
        ],
        commonPitfalls: "Adding 'to' after modal verbs due to literal translation from first-language infinitive structures.",
      },
    ],
    grammarPoints: [
      {
        id: 'grammar-1',
        topic: 'Modal Verbs (Can / Cannot + Bare Infinitive)',
        rule: "After modal auxiliaries such as 'can' or 'can't', always use the base verb without 'to'.",
        form: "Subject + can / can't + base verb",
        usage: 'Used to express ability, possibility, or permission in natural spoken and written English.',
        examples: [
          "We can't have delays during the product launch.",
          'Can you join the call at three?',
        ],
        commonMistakes: "Saying 'can to have' or 'can't to go' instead of 'can have' or 'can't go'.",
        comparisons: "Unlike verbs such as 'want' or 'need' (which take 'to' + verb), modal verbs never take 'to'.",
      },
    ],
    vocabularyAndExpressions: [
      {
        id: 'vocab-1',
        term: 'follow up',
        partOfSpeech: 'Phrasal Verb',
        definitionEn: 'To take further action or check progress after an earlier discussion or message.',
        simpleDefinition: 'To check back with someone about an earlier topic, email, or task.',
        collocations: ['follow up on an email', 'follow up with a client'],
        realExamples: ['Let me follow up with the engineering team tomorrow morning.'],
        synonyms: ['check back', 'pursue'],
        register: 'neutral',
        category: 'New Words & Expressions (Alt+W)',
        isNewWord: true,
      },
      {
        id: 'vocab-2',
        term: 'schedule',
        partOfSpeech: 'Pronunciation Focus',
        definitionEn: 'A plan for carrying out a process or procedure, giving lists of intended events and times.',
        simpleDefinition: 'Pronounce clearly with initial /sk/ in American English: SKED-jool.',
        collocations: ['ahead of schedule', 'tight schedule'],
        realExamples: ['Our team is working on a very tight schedule this week.'],
        synonyms: ['timetable', 'agenda'],
        register: 'neutral',
        category: 'Pronunciation & Phonetics (Alt+P)',
        phoneticGuide: '/ˈskedʒ.uːl/ — Primary stress on the first syllable (SKED-jool)',
        isPronunciationFocus: true,
      },
    ],
    reviewSummary: {
      estimatedMinutes: '5–10 minutes',
      keyRules: ["Modal Verbs (Can / Cannot + Bare Infinitive): Always use the base verb without 'to' after 'can' or 'can't'."],
      mustKnowVocabulary: ['follow up', 'schedule'],
      essentialCorrections: [{ original: "We can't to have", corrected: "We can't have" }],
      rememberThis: "Remember: Never place 'to' right after 'can' or 'can't' — always jump straight to the base verb!",
    },
  };

  const server = http.createServer(serverApp);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    let capturedSystemInstruction = '';
    let capturedUserPrompt = '';

    await test('1.1: Gemini instructions in executePedagogicalTransformationCore enforce 100% English output even when language="pt" and notes contain Portuguese', async () => {
      resetGeminiSecurityStateForTesting();
      const result = await executePedagogicalTransformationCore({
        rawNotes: bilingualRawNotes,
        topic: 'Modal Verbs & Daily Work',
        sessionDate: '2026-11-12',
        teacherName: 'Skull Bee',
        authoritativeLevel: 'intermediario',
        language: 'pt', // Simulates client sending 'pt' or student default locale
        callerRole: 'teacher',
        canonicalSessionKey: 'lesson_lesson-doc2f-001',
        lessonId: 'lesson-doc2f-001',
        studentUid,
        studentEmail,
        effectiveTeacherUid: teacherUid,
        effectiveTeacherEmail: teacherEmail,
        customAttemptExecutor: async (_model: string, params: any) => {
          capturedSystemInstruction = params.systemInstruction;
          capturedUserPrompt = params.untrustedUserDataPrompt;
          return JSON.stringify(englishGeminiOutput);
        },
      });

      assert.strictEqual(result.success, true, 'Core transformation must succeed');
      assert(capturedSystemInstruction.length > 100, 'systemInstruction must be captured');
      assert(capturedUserPrompt.length > 100, 'untrustedUserDataPrompt must be captured');

      // Must NOT instruct Gemini to output in Portuguese
      assert(!capturedSystemInstruction.includes('Português'), 'systemInstruction must not reference Português');
      assert(!capturedSystemInstruction.includes('MUST be written in Portuguese'), 'systemInstruction must not request Portuguese output');
      assert(!capturedUserPrompt.includes('Target Language: Portuguese'), 'prompt must not set Target Language: Portuguese');
      assert(!capturedUserPrompt.includes('Português'), 'prompt must not request Português outside raw notes');

      // Must explicitly instruct English across all 4 canonical parts and all required fields
      assert(capturedSystemInstruction.includes('STRICT 100% ENGLISH OUTPUT'), 'systemInstruction must enforce strict 100% English output');
      assert(capturedSystemInstruction.includes('Analyze Mistakes'), 'systemInstruction must cover Analyze Mistakes');
      assert(capturedSystemInstruction.includes('Grammar Points'), 'systemInstruction must cover Grammar Points');
      assert(capturedSystemInstruction.includes('Vocabulary & Expressions'), 'systemInstruction must cover Vocabulary & Expressions');
      assert(capturedSystemInstruction.includes('Quick Review'), 'systemInstruction must cover Quick Review');
      assert(
        capturedSystemInstruction.includes('"definitionEn" AND "simpleDefinition"'),
        'systemInstruction must require both definitionEn and simpleDefinition in English'
      );
      assert(
        capturedUserPrompt.includes('Output Language: English (en)'),
        'prompt must explicitly specify Output Language: English (en)'
      );
    });

    await test('1.2: Gemini instructions explicitly require literal preservation of student/teacher quotes and forbid translating/modifying raw notes', () => {
      assert(
        capturedSystemInstruction.includes('Preserve literally (verbatim) the original excerpts from the student and the teacher'),
        'systemInstruction must require verbatim preservation of student and teacher excerpts'
      );
      assert(
        capturedSystemInstruction.includes('Do NOT translate, paraphrase, rewrite, or modify the original session notes'),
        'systemInstruction must forbid translating or modifying original notes'
      );
      assert(
        capturedUserPrompt.includes('Preserve literally (verbatim) the original excerpts from the student and the teacher'),
        'prompt must require verbatim preservation of student and teacher excerpts'
      );
      assert(
        capturedUserPrompt.includes('Do NOT translate or modify the original notes'),
        'prompt must forbid translating or modifying original notes'
      );
      // Verify the raw notes passed inside the prompt were NOT translated or altered prior to calling Gemini
      assert(
        capturedUserPrompt.includes(bilingualRawNotes),
        'Raw notes including Portuguese comments and literal student/teacher quotes must be passed verbatim without modification'
      );
    });

    await test('1.3: Unified Native Friends Notes Gemini prompt in serverApp.ts enforces 100% English output with zero duplicated blocks or targetLang Portuguese interpolations', () => {
      const serverAppContent = fs.readFileSync(path.resolve(process.cwd(), 'serverApp.ts'), 'utf8');
      const matches = serverAppContent.match(/LANGUAGE REQUIREMENT \(STRICT 100% ENGLISH OUTPUT\):/g) || [];
      assert.strictEqual(
        matches.length,
        1,
        `Expected unified Native Friends Notes Gemini prompt in serverApp.ts to have STRICT 100% ENGLISH OUTPUT once (no duplicated prompt blocks), found ${matches.length}`
      );
      const coreCallMatches = serverAppContent.match(/executePedagogicalTransformationCore\(/g) || [];
      assert(
        coreCallMatches.length >= 3,
        'Both /api/session-notes/:id/transform and /api/pedagogical-notes/transform must delegate to executePedagogicalTransformationCore'
      );
      assert(
        !serverAppContent.includes('Ensure reviewSummary and rememberThis are fully provided in ${targetLang.nameEn}'),
        'Legacy targetLang prompt directive must be completely removed from Native Friends Notes prompts'
      );
    });

    await test('2.1: Full isolated HTTP workflow (Save -> Transform -> Review -> Approve) preserves raw notes, literal quotes, JSON contract, and English 4-part output', async () => {
      const saveRes = await makeRequest(
        server,
        'POST',
        '/api/session-notes',
        {
          id: 'lesson-doc2f-001',
          lessonId: 'lesson-doc2f-001',
          studentUid,
          studentEmail,
          teacherUid,
          teacherEmail,
          teacherName: 'Skull Bee',
          sessionDate: '2026-11-12',
          topic: 'Modal Verbs & Daily Work',
          content: bilingualRawNotes,
          rawContent: bilingualRawNotes,
        },
        { Authorization: 'Bearer token-teacher' }
      );
      assert.strictEqual(saveRes.status, 200, 'Saving initial bilingual notes must return 200');

      let httpCapturedPrompt = '';
      resetGeminiSecurityStateForTesting();
      setSessionNoteTransformAttemptExecutorForTesting(async (_model: string, params: any) => {
        httpCapturedPrompt = params.untrustedUserDataPrompt;
        return JSON.stringify(englishGeminiOutput);
      });

      const transformRes = await makeRequest(
        server,
        'POST',
        '/api/session-notes/lesson-doc2f-001/transform',
        {
          studentUid,
          teacherUid,
          language: 'pt', // Teacher panel sends language: 'pt'; output instructions must still be 100% English
        },
        { Authorization: 'Bearer token-teacher' }
      );

      assert.strictEqual(transformRes.status, 200, `Expected 200 on transform, got ${transformRes.status}`);
      assert(httpCapturedPrompt.includes('Output Language: English (en)'), 'HTTP transform prompt must enforce English (en)');

      // Original notes untouched & untranslated
      assert.strictEqual(transformRes.data.sessionNote.rawContent, bilingualRawNotes, 'rawContent must remain untouched');
      assert.strictEqual(transformRes.data.sessionNote.content, bilingualRawNotes, 'content must remain untouched');
      assert.strictEqual(
        transformRes.data.sessionNote.originalTeacherNotes.rawContent,
        bilingualRawNotes,
        'originalTeacherNotes baseline must remain untouched'
      );

      // Verify all 4 sections & literal quote preservation
      const draft = transformRes.data.draftTransformation;
      assert.strictEqual(draft.status, 'draft');
      const t = draft.transformation;
      assert.strictEqual(t.mistakesAnalysis.length, 1);
      assert.strictEqual(t.mistakesAnalysis[0].original, "We can't to have", 'Literal student utterance preserved');
      assert.strictEqual(t.mistakesAnalysis[0].corrected, "We can't have");
      assert(t.mistakesAnalysis[0].explanation.includes('Modal verbs'), 'Explanation in English');

      assert.strictEqual(t.grammarPoints.length, 1);
      assert.strictEqual(t.grammarPoints[0].topic, 'Modal Verbs (Can / Cannot + Bare Infinitive)', 'Grammar topic in English');
      assert(t.grammarPoints[0].rule.includes('After modal auxiliaries'), 'Grammar rule in English');

      assert.strictEqual(t.vocabularyAndExpressions.length, 2);
      assert.strictEqual(t.vocabularyAndExpressions[0].simpleDefinition, 'To check back with someone about an earlier topic, email, or task.');
      assert.strictEqual(t.vocabularyAndExpressions[1].isPronunciationFocus, true);

      assert(t.reviewSummary.rememberThis.startsWith('Remember:'), 'Quick Review rememberThis in English');
      assert(t.reviewSummary.keyRules[0].startsWith('Modal Verbs'), 'Quick Review keyRules in English');

      // Teacher approves & publishes
      const approveRes = await makeRequest(
        server,
        'POST',
        '/api/session-notes/lesson-doc2f-001/approve',
        {
          draftId: draft.draftId,
          transformation: t,
        },
        { Authorization: 'Bearer token-teacher' }
      );
      assert.strictEqual(approveRes.status, 200, 'Approval must succeed with 200');
      assert.strictEqual(approveRes.data.approvalStatus, 'approved');
      assert.strictEqual(approveRes.data.sessionNote.rawContent, bilingualRawNotes, 'rawContent still untouched after approval');
      assert.strictEqual(
        approveRes.data.approvedVersion.transformation.grammarPoints[0].topic,
        'Modal Verbs (Can / Cannot + Bare Infinitive)'
      );
    });

    await test('3.1: Non-regression check — models, token limits, timeouts, RBAC, and other Gemini prompts remain completely untouched', async () => {
      assert.strictEqual(DEFAULT_GEMINI_MODEL, 'gemini-3.8-flash');
      assert.deepStrictEqual([...DEFAULT_CONTINGENCY_POOL], [
        'gemini-3.8-flash',
        'gemini-3.5-flash-lite',
        'gemini-3.1-flash-lite',
      ]);
      assert.strictEqual(GEMINI_POLICIES.pedagogical_transform.maxOutputTokens, 4000);
      assert.strictEqual(GEMINI_POLICIES.pedagogical_transform.timeoutMs, 15000);
      assert.strictEqual(GEMINI_POLICIES.pedagogical_transform.totalDeadlineMs, 36000);

      // Student RBAC lock still intact
      const studentTransformRes = await makeRequest(
        server,
        'POST',
        '/api/session-notes/lesson-doc2f-001/transform',
        { studentUid },
        { Authorization: 'Bearer token-student' }
      );
      assert.strictEqual(studentTransformRes.status, 403);
      assert.strictEqual(studentTransformRes.data.code, 'STUDENTS_CANNOT_TRANSFORM');
    });
  } finally {
    setSessionNoteTransformAttemptExecutorForTesting(null);
    resetGeminiSecurityStateForTesting();
    resetFirebaseAdminFirestoreForTesting();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  console.log('\n======================================================================');
  console.log(`NF-DOC.2F VALIDATION RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('======================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
  process.exit(0);
}

runSuite().catch((err) => {
  console.error('Fatal error in NF-DOC.2F validation:', err);
  process.exit(1);
});
