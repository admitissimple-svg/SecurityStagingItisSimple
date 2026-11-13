process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = 'test-gemini-api-key';

import assert from 'assert';
import http from 'http';
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
import { resetGeminiSecurityStateForTesting } from '../src/serverGeminiSecurity';
import {
  parseNotesHtml,
  validatePedagogicalAiResponse,
} from '../src/utils/pedagogicalTransformer';

/**
 * Surgical Validation Suite:
 * API Transform - Native Friend Notes — Pedagogical Rules & Anti-Duplication Simplification
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
  console.log('SURGICAL VALIDATION: NATIVE FRIEND NOTES — 4-PART PEDAGOGICAL RULES');
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
  const studentUid = 'studentPedRulesUid00001';
  const studentEmail = 'student.pedrules@example.com';

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
      name: 'Camila Costa',
      role: 'student',
      level: 'intermediario',
      teacherUid,
      assignedNativeFriendUID: teacherUid,
      teacherId: 'skull-bee',
    },
    'lessons/lesson-ped-rules-01': {
      id: 'lesson-ped-rules-01',
      studentUid,
      studentEmail,
      teacherUid,
      teacherEmail,
      teacherName: 'Skull Bee',
      title: 'Workplace Updates & Prepositions',
      status: 'scheduled',
      startDateTime: '2026-11-12T17:00:00.000Z',
    },
  };

  setIsCloudWriteDisabled(false);
  setFirebaseAdminFirestoreForTesting(createInMemoryFirestore(firestoreStore) as any);

  const tokenMap: Record<string, any> = {
    'token-teacher': { uid: teacherUid, email: teacherEmail, email_verified: true },
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

  const sampleRawNotes = [
    '(Alt+N) I am responsible of the budget (Alt+Y) I am responsible for the budget',
    '(Alt+W) keep someone in the loop',
    '(Alt+P) budget',
    'Unstamped teacher header: Session wrap-up notes',
  ].join('\n');

  const richGeminiResponse = {
    mistakesAnalysis: [
      {
        id: 'mistake-1',
        original: 'I am responsible of the budget',
        corrected: 'I am responsible for the budget',
        category: 'preposition',
        explanation: "The adjective 'responsible' never takes 'of' in English; it requires the preposition 'for' before a noun or '-ing' verb.",
        grammarRule: 'Adjective + Preposition Collocation: be responsible + for + noun / gerund (-ing).',
        twoExamples: [
          'She is responsible for managing the marketing budget.',
          'Who is responsible for client onboarding this quarter?',
          'I am responsible for reviewing every contract before signing.',
        ],
        commonPitfalls: "Using 'responsible of' or 'responsible to manage' instead of 'responsible for managing'.",
        similarFormsComparison: "'Responsible for' names the duty or task, whereas 'in charge of' takes 'of' (e.g. 'I am in charge of the budget').",
      },
    ],
    grammarPoints: [
      {
        id: 'grammar-1',
        topic: "Dependent Prepositions: 'Responsible for' vs 'In charge of'",
        rule: "Use 'be responsible for' followed by a noun or an -ing verb to describe duties.",
        form: 'Subject + be + responsible for + noun / verb-ing',
        usage: 'Used in professional and everyday contexts to explain roles, tasks, and accountability.',
        examples: [
          'Our team is responsible for launching the mobile update.',
          'He is responsible for coordinating weekly status meetings.',
        ],
        commonMistakes: "Saying 'responsible of' (interference from 'in charge of' or Romance languages) or 'responsible to do'.",
        comparisons: "Compare 'responsible for + noun/-ing' with 'in charge of + noun/-ing' — same meaning, different fixed prepositions.",
      },
    ],
    vocabularyAndExpressions: [
      {
        id: 'vocab-1',
        term: 'keep someone in the loop',
        partOfSpeech: 'Idiomatic Expression',
        // Intentionally omit definitionEn here to verify streamlined validation mirrors simpleDefinition without retrying!
        simpleDefinition: 'To keep someone informed and updated about important progress or decisions.',
        collocations: ['keep the team in the loop', 'stay in the loop'],
        realExamples: [
          'Please keep me in the loop if the client changes the deadline.',
          'We hold a quick stand-up to keep everyone in the loop.',
        ],
        synonyms: ['keep someone posted', 'keep someone updated'],
        register: 'conversational',
        registerNote: 'Very natural in everyday workplace conversations and emails; slightly informal for legal documents.',
        category: 'Workplace Communication & Updates',
        isNewWord: true,
      },
      {
        id: 'vocab-2',
        term: 'budget',
        partOfSpeech: 'Noun',
        simpleDefinition: 'The amount of money available for a specific project, department, or period.',
        collocations: ['within budget', 'over budget', 'annual budget'],
        realExamples: ['We finished the campaign on time and within budget.'],
        synonyms: ['financial plan', 'allocation'],
        register: 'neutral',
        registerNote: 'Standard across both casual and formal business English.',
        // Intentionally organized under a thematic category rather than 'Pronunciation' to verify zero false validation failure!
        category: 'Finance & Project Planning',
        phoneticGuide: '/ˈbʌdʒ.ɪt/ — Short "uh" vowel in the first syllable (BUHJ-it)',
      },
    ],
    reviewSummary: {
      estimatedMinutes: '5–10 minutes',
      keyRules: [
        "Always pair 'responsible' with 'for' (+ noun or -ing), never 'of'.",
      ],
      mustKnowVocabulary: ['keep someone in the loop', 'budget (/ˈbʌdʒ.ɪt/)'],
      essentialCorrections: [
        {
          original: 'I am responsible of the budget',
          corrected: 'I am responsible for the budget',
        },
      ],
      usefulPatterns: [
        'I am responsible for + [noun / verb-ing]...',
        'Please keep [someone] in the loop about + [topic].',
      ],
      rememberThis: "Remember this: You are 'in charge OF' something, but 'responsible FOR' it — lock in that pair!",
    },
  };

  const server = http.createServer(serverApp);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    let capturedSystem = '';
    let capturedPrompt = '';
    let callCount = 0;

    await test('1: Pedagogical prompt contains the exact 4-part instructions (Alt+N Part 1, Alt+N Part 2, Alt+W/Alt+P Part 3, Part 4 5–10 min review)', async () => {
      resetGeminiSecurityStateForTesting();
      const result = await executePedagogicalTransformationCore({
        rawNotes: sampleRawNotes,
        topic: 'Workplace Updates & Prepositions',
        sessionDate: '2026-11-12',
        teacherName: 'Skull Bee',
        authoritativeLevel: 'intermediario',
        language: 'en',
        callerRole: 'teacher',
        canonicalSessionKey: 'lesson_lesson-ped-rules-01',
        lessonId: 'lesson-ped-rules-01',
        studentUid,
        studentEmail,
        effectiveTeacherUid: teacherUid,
        effectiveTeacherEmail: teacherEmail,
        customAttemptExecutor: async (_model: string, params: any) => {
          callCount++;
          capturedSystem = params.systemInstruction;
          capturedPrompt = params.untrustedUserDataPrompt;
          return JSON.stringify(richGeminiResponse);
        },
      });

      assert.strictEqual(result.success, true, 'Transformation must succeed');
      assert.strictEqual(callCount, 1, 'Must succeed on the very first Gemini call with zero retry rework');

      const combinedInstructions = `${capturedSystem}\n${capturedPrompt}`.replace(/’/g, "'");
      assert(combinedInstructions.includes("Alt+N = Part 1. Analyze the student's mistakes"), 'Must include Alt+N = Part 1 header');
      assert(combinedInstructions.includes('Do not simply correct the sentence. Teach the grammar behind the correction.'), 'Must include Part 1 teaching mandate');
      assert(combinedInstructions.includes('Alt+N = Part 2. Teach the grammar points'), 'Must include Alt+N = Part 2 header');
      assert(combinedInstructions.includes("Prioritize the grammar that is actually connected to the student's mistakes rather than adding unrelated grammar."), 'Must include Part 2 prioritization rule');
      assert(combinedInstructions.includes('Alt + W or Alt + P = Part 3. Teach the vocabulary and expressions'), 'Must include Alt+W / Alt+P = Part 3 header');
      assert(combinedInstructions.includes('Organize the vocabulary into useful categories rather than giving one long alphabetical list.'), 'Must include Part 3 categorization rule');
      assert(combinedInstructions.includes('4. Create a 5–10 minute review summary'), 'Must include Part 4 header');
      assert(combinedInstructions.includes('Useful sentence patterns'), 'Must include Useful sentence patterns in Part 4');

      // Verify post-processed fields are preserved without destructive overwriting
      const t = result.transformation;
      assert(t, 'result.transformation must be defined');
      assert.strictEqual(t.mistakesAnalysis[0].grammarRule, richGeminiResponse.mistakesAnalysis[0].grammarRule);
      assert.strictEqual(t.mistakesAnalysis[0].twoExamples.length, 3, 'All 3 natural examples (2–4 range) preserved');
      assert.strictEqual(t.mistakesAnalysis[0].similarFormsComparison, richGeminiResponse.mistakesAnalysis[0].similarFormsComparison);
      assert.strictEqual(t.grammarPoints[0].comparisons, richGeminiResponse.grammarPoints[0].comparisons);
      assert.strictEqual(t.vocabularyAndExpressions[0].category, 'Workplace Communication & Updates', 'Thematic category preserved');
      assert.strictEqual(t.vocabularyAndExpressions[0].definitionEn, richGeminiResponse.vocabularyAndExpressions[0].simpleDefinition, 'definitionEn mirrored from simpleDefinition');
      assert.strictEqual(t.vocabularyAndExpressions[0].registerNote, richGeminiResponse.vocabularyAndExpressions[0].registerNote);
      assert.strictEqual(t.vocabularyAndExpressions[1].category, 'Finance & Project Planning', 'Thematic category preserved on Alt+P item');
      assert.strictEqual(t.vocabularyAndExpressions[1].isPronunciationFocus, true, 'Alt+P pronunciation focus auto-tagged');
      assert.deepStrictEqual(t.reviewSummary.usefulPatterns, richGeminiResponse.reviewSummary.usefulPatterns);
    });

    await test('2: Streamlined validatePedagogicalAiResponse accepts thematic Alt+P categories and unstamped comments without triggering false failover retries', () => {
      const markings = parseNotesHtml(sampleRawNotes);
      const validationClone = JSON.parse(JSON.stringify(richGeminiResponse));
      const check = validatePedagogicalAiResponse(validationClone, markings, 'B1', 'en');
      assert.strictEqual(check.valid, true, `Expected valid=true, got reason: ${check.reason}`);
      assert.strictEqual(validationClone.vocabularyAndExpressions[1].isPronunciationFocus, true);
      assert.strictEqual(
        validationClone.vocabularyAndExpressions[0].definitionEn,
        validationClone.vocabularyAndExpressions[0].simpleDefinition
      );
    });

    await test('3: Duplicate AI call prevention — repeated POST /api/session-notes/:id/transform on unchanged notes reuses validated draft when not in test-mock override', async () => {
      // Save initial notes
      const saveRes = await makeRequest(
        server,
        'POST',
        '/api/session-notes',
        {
          id: 'lesson-ped-rules-01',
          lessonId: 'lesson-ped-rules-01',
          studentUid,
          studentEmail,
          teacherUid,
          teacherEmail,
          teacherName: 'Skull Bee',
          sessionDate: '2026-11-12',
          topic: 'Workplace Updates & Prepositions',
          content: sampleRawNotes,
          rawContent: sampleRawNotes,
        },
        { Authorization: 'Bearer token-teacher' }
      );
      assert.strictEqual(saveRes.status, 200);

      let executorCalls = 0;
      resetGeminiSecurityStateForTesting();
      setSessionNoteTransformAttemptExecutorForTesting(async () => {
        executorCalls++;
        return JSON.stringify(richGeminiResponse);
      });

      // First call populates draftTransformation & pedagogicalTransformationsMap
      const firstTransform = await makeRequest(
        server,
        'POST',
        '/api/session-notes/lesson-ped-rules-01/transform',
        { studentUid, teacherUid },
        { Authorization: 'Bearer token-teacher' }
      );
      assert.strictEqual(firstTransform.status, 200);
      assert.strictEqual(executorCalls, 1);

      // Clear test executor so production cache-reuse branch is active, then call again on identical rawNotes
      setSessionNoteTransformAttemptExecutorForTesting(null);
      const secondTransform = await makeRequest(
        server,
        'POST',
        '/api/session-notes/lesson-ped-rules-01/transform',
        { studentUid, teacherUid, forceRegenerate: false },
        { Authorization: 'Bearer token-teacher' }
      );
      assert.strictEqual(secondTransform.status, 200);
      assert.strictEqual(secondTransform.data.cached, true, 'Second call with identical contentHash must return cached=true without calling Gemini');
      assert.strictEqual(
        secondTransform.data.draftTransformation.transformation.mistakesAnalysis[0].corrected,
        'I am responsible for the budget'
      );
    });
  } finally {
    setSessionNoteTransformAttemptExecutorForTesting(null);
    resetGeminiSecurityStateForTesting();
    resetFirebaseAdminFirestoreForTesting();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  console.log('\n======================================================================');
  console.log(`SURGICAL VALIDATION RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('======================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
  process.exit(0);
}

runSuite().catch((err) => {
  console.error('Fatal error in surgical validation:', err);
  process.exit(1);
});
