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
} from '../src/serverFirestore';
import { resetGeminiSecurityStateForTesting } from '../src/serverGeminiSecurity';

/**
 * FASE NF-DOC.2B — Suíte de Validação Cirúrgica: Backend de Transformação e Aprovação
 *
 * Cobertura:
 * 1. Autorização por UID, Identidade Canônica e Vínculo Pedagógico
 * 2. Transformação Válida/Inválida, Preservação de Marcações, Falha Gemini e Concorrência
 * 3. Aprovação Explícita, Proteção contra Rascunho Desatualizado (Stale Draft),
 *    Idempotência, Ausência de Duplicação, Preservação de Histórico, Isolamento e Consistência Firestore
 */

function makeRequest(
  server: http.Server,
  method: string,
  path: string,
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
        path,
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

async function runNFDoc2bTestSuite() {
  console.log('======================================================================');
  console.log("IT'S SIMPLE — FASE NF-DOC.2B: TRANSFORMAÇÃO E APROVAÇÃO");
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
      console.error(`         ${err.message}`);
    }
  }

  const server = http.createServer(serverApp);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  const timestamp = Date.now();
  const canonicalStudentUid = `canonical-student-doc2b-${timestamp}`;
  const studentEmail = `student.doc2b.${timestamp}@example.com`;

  const canonicalOtherStudentUid = `canonical-other-doc2b-${timestamp}`;
  const otherStudentEmail = `other.doc2b.${timestamp}@example.com`;

  const authorizedTeacherUid = `canonical-teacher-doc2b-auth-${timestamp}`;
  const authorizedTeacherEmail = `teacher.doc2b.auth.${timestamp}@example.com`;

  const coLinkedTeacherUid = `canonical-teacher-doc2b-colink-${timestamp}`;
  const coLinkedTeacherEmail = `teacher.doc2b.colink.${timestamp}@example.com`;

  const unauthorizedTeacherUid = `canonical-teacher-doc2b-unauth-${timestamp}`;
  const unauthorizedTeacherEmail = `teacher.doc2b.unauth.${timestamp}@example.com`;

  const tokenMap: Record<string, any> = {
    'token-student': { uid: canonicalStudentUid, email: studentEmail, email_verified: true, role: 'student' },
    'token-other-student': { uid: canonicalOtherStudentUid, email: otherStudentEmail, email_verified: true, role: 'student' },
    'token-teacher-auth': { uid: authorizedTeacherUid, email: authorizedTeacherEmail, email_verified: true, role: 'teacher' },
    'token-teacher-colink': { uid: coLinkedTeacherUid, email: coLinkedTeacherEmail, email_verified: true, role: 'teacher' },
    'token-teacher-unauth': { uid: unauthorizedTeacherUid, email: unauthorizedTeacherEmail, email_verified: true, role: 'teacher' },
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

  // In-memory Firestore store for complete test isolation (zero production Firestore writes)
  const firestoreStore: Record<string, any> = {
    [`users/${canonicalStudentUid}`]: {
      uid: canonicalStudentUid,
      email: studentEmail,
      role: 'student',
      teacherUid: authorizedTeacherUid,
      teacherEmail: authorizedTeacherEmail,
      assignedNativeFriendUID: authorizedTeacherUid,
    },
    [`users/${canonicalOtherStudentUid}`]: {
      uid: canonicalOtherStudentUid,
      email: otherStudentEmail,
      role: 'student',
      teacherUid: unauthorizedTeacherUid,
    },
    [`users/${authorizedTeacherUid}`]: {
      uid: authorizedTeacherUid,
      email: authorizedTeacherEmail,
      role: 'teacher',
      approvalStatus: 'approved',
      isApproved: true,
    },
    [`tutors/${authorizedTeacherUid}`]: {
      uid: authorizedTeacherUid,
      email: authorizedTeacherEmail,
      name: 'Teacher Authorized',
      approvalStatus: 'approved',
      isApproved: true,
    },
    [`users/${coLinkedTeacherUid}`]: {
      uid: coLinkedTeacherUid,
      email: coLinkedTeacherEmail,
      role: 'teacher',
      approvalStatus: 'approved',
      isApproved: true,
    },
    [`tutors/${coLinkedTeacherUid}`]: {
      uid: coLinkedTeacherUid,
      email: coLinkedTeacherEmail,
      name: 'Teacher CoLinked',
      approvalStatus: 'approved',
      isApproved: true,
    },
    [`lessons/lesson_colink_${timestamp}`]: {
      id: `lesson_colink_${timestamp}`,
      studentUid: canonicalStudentUid,
      teacherUid: coLinkedTeacherUid,
      status: 'scheduled',
    },
    [`users/${unauthorizedTeacherUid}`]: {
      uid: unauthorizedTeacherUid,
      email: unauthorizedTeacherEmail,
      role: 'teacher',
      approvalStatus: 'approved',
      isApproved: true,
    },
    [`tutors/${unauthorizedTeacherUid}`]: {
      uid: unauthorizedTeacherUid,
      email: unauthorizedTeacherEmail,
      name: 'Teacher Unauthorized',
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
        return {
          empty: matching.length === 0,
          size: matching.length,
          docs: matching,
        };
      },
    }),
  } as any);

  setIsCloudWriteDisabled(false);

  const mockTransformationOutput = {
    mistakesAnalysis: [
      {
        id: 'mistake-1',
        original: 'I have 25 years old',
        corrected: 'I am 25 years old',
        explanation: 'Em inglês, expressamos idade com o verbo to be, nunca com have.',
        examples: ['I am 25 years old and my sister is 28.', 'She is thirty years old.'],
        category: 'Grammar',
      },
    ],
    grammarPoints: [
      {
        id: 'grammar-1',
        topic: 'Expressing Age with "to be"',
        rule: 'Em inglês, a idade é expressa com subject + verb to be + age.',
        examples: ['I am 25 years old.', 'How old are you?'],
      },
    ],
    vocabularyAndExpressions: [
      {
        id: 'vocab-1',
        term: 'break the ice',
        definitionEn: 'To say or do something that makes people feel more relaxed in a social setting.',
        simpleDefinition: 'Iniciar uma conversa de forma leve para quebrar a timidez.',
        realExamples: ['He told a funny story at the start of the call to break the ice.'],
        isNewWord: true,
      },
      {
        id: 'vocab-2',
        term: 'comfortable',
        definitionEn: 'Providing physical ease and relaxation; feeling at ease.',
        simpleDefinition: 'Confortável. Atenção à redução vocálica na pronúncia em 3 sílabas.',
        realExamples: ['These chairs are very comfortable for working all day.'],
        phoneticGuide: '/ˈkʌmftərbəl/ (COMF-ter-ble)',
        isPronunciationFocus: true,
      },
    ],
    reviewSummary: {
      estimatedMinutes: '5–10 minutes',
      keyRules: ['Use o verbo to be para informar idade em inglês.'],
      mustKnowVocabulary: ['break the ice', 'comfortable'],
      essentialCorrections: [{ original: 'I have 25 years old', corrected: 'I am 25 years old' }],
      rememberThis: 'Lembre-se: I AM 25 years old, nunca I have 25!',
    },
  };

  try {
    // -------------------------------------------------------------
    // GRUPO 1: Identidade, Autorização por UID e Vínculo Pedagógico
    // -------------------------------------------------------------
    console.log('--- GRUPO 1: IDENTIDADE, UID E VÍNCULO PEDAGÓGICO ---');

    const rawPedagogicalNotes = `
Lesson 1 - Real Notes
(Alt+N) I have 25 years old (Alt+Y) I am 25 years old
(Alt+W) break the ice
(Alt+P) comfortable
Discussed travel, hobbies, and weekend routines.
`;

    const sessionIdA = `session_2026-11-12_${canonicalStudentUid}`;

    const postNoteRes = await makeRequest(
      server,
      'POST',
      '/api/session-notes',
      {
        id: sessionIdA,
        studentUid: canonicalStudentUid,
        teacherUid: authorizedTeacherUid,
        teacherName: 'Teacher Authorized',
        topic: 'Business English & Operations',
        content: rawPedagogicalNotes,
        rawContent: rawPedagogicalNotes,
        sessionDate: '2026-11-12',
      },
      { Authorization: 'Bearer token-teacher-auth' }
    );
    assert.strictEqual(postNoteRes.status, 200, 'Baseline note creation should succeed');

    await test('1.1: Aluno é impedido de executar transformação (403 STUDENTS_CANNOT_TRANSFORM)', async () => {
      const res = await makeRequest(
        server,
        'POST',
        `/api/session-notes/${sessionIdA}/transform`,
        { studentUid: canonicalStudentUid },
        { Authorization: 'Bearer token-student' }
      );
      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.data.code, 'STUDENTS_CANNOT_TRANSFORM');
    });

    await test('1.2: Aluno é impedido de executar aprovação (403 STUDENTS_CANNOT_APPROVE)', async () => {
      const res = await makeRequest(
        server,
        'POST',
        `/api/session-notes/${sessionIdA}/approve`,
        { studentUid: canonicalStudentUid },
        { Authorization: 'Bearer token-student' }
      );
      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.data.code, 'STUDENTS_CANNOT_APPROVE');
    });

    await test('1.3: Aluno é impedido de salvar rascunho pedagógico (403 STUDENTS_CANNOT_DRAFT)', async () => {
      const res = await makeRequest(
        server,
        'POST',
        `/api/session-notes/${sessionIdA}/draft`,
        { customTeacherNotes: 'Attempt by student' },
        { Authorization: 'Bearer token-student' }
      );
      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.data.code, 'STUDENTS_CANNOT_DRAFT');
    });

    await test('1.4: Professor sem vínculo pedagógico é impedido de transformar (403 UNAUTHORIZED_PEDAGOGICAL_LINK)', async () => {
      const res = await makeRequest(
        server,
        'POST',
        `/api/session-notes/${sessionIdA}/transform`,
        {},
        { Authorization: 'Bearer token-teacher-unauth' }
      );
      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.data.code, 'UNAUTHORIZED_PEDAGOGICAL_LINK');
    });

    await test('1.5: Professor sem vínculo pedagógico é impedido de aprovar (403 UNAUTHORIZED_PEDAGOGICAL_LINK)', async () => {
      const res = await makeRequest(
        server,
        'POST',
        `/api/session-notes/${sessionIdA}/approve`,
        {},
        { Authorization: 'Bearer token-teacher-unauth' }
      );
      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.data.code, 'UNAUTHORIZED_PEDAGOGICAL_LINK');
    });

    await test('1.6: Professor com vínculo pedagógico mas não titular da nota recebe 403 TEACHER_MISMATCH', async () => {
      const resTransform = await makeRequest(
        server,
        'POST',
        `/api/session-notes/${sessionIdA}/transform`,
        {},
        { Authorization: 'Bearer token-teacher-colink' }
      );
      assert.strictEqual(resTransform.status, 403);
      assert.strictEqual(resTransform.data.code, 'TEACHER_MISMATCH');

      const resApprove = await makeRequest(
        server,
        'POST',
        `/api/session-notes/${sessionIdA}/approve`,
        {},
        { Authorization: 'Bearer token-teacher-colink' }
      );
      assert.strictEqual(resApprove.status, 403);
      assert.strictEqual(resApprove.data.code, 'TEACHER_MISMATCH');
    });

    await test('1.7: Parâmetros adulterados no body (studentUid/teacherUid) ou documento sem UID canônico são bloqueados', async () => {
      const mismatchStudentRes = await makeRequest(
        server,
        'POST',
        `/api/session-notes/${sessionIdA}/transform`,
        { studentUid: canonicalOtherStudentUid },
        { Authorization: 'Bearer token-teacher-auth' }
      );
      assert.strictEqual(mismatchStudentRes.status, 403);
      assert.strictEqual(mismatchStudentRes.data.code, 'STUDENT_UID_MISMATCH');

      const mismatchTeacherRes = await makeRequest(
        server,
        'POST',
        `/api/session-notes/${sessionIdA}/transform`,
        { teacherUid: unauthorizedTeacherUid },
        { Authorization: 'Bearer token-teacher-auth' }
      );
      assert.strictEqual(mismatchTeacherRes.status, 403);
      assert.strictEqual(mismatchTeacherRes.data.code, 'TEACHER_MISMATCH');

      const corruptedKey = `session_corrupted_uid_${timestamp}`;
      firestoreStore[`session_notes/${corruptedKey}`] = {
        id: corruptedKey,
        sessionDate: '2026-11-12',
        studentUid: 'not@canonical.com',
        teacherUid: authorizedTeacherUid,
        content: rawPedagogicalNotes,
        rawContent: rawPedagogicalNotes,
      };
      const corruptedRes = await makeRequest(
        server,
        'POST',
        `/api/session-notes/${corruptedKey}/transform`,
        {},
        { Authorization: 'Bearer token-teacher-auth' }
      );
      assert.strictEqual(corruptedRes.status, 400);
      assert.strictEqual(corruptedRes.data.code, 'CANONICAL_STUDENT_UID_REQUIRED');
    });

    // -------------------------------------------------------------
    // GRUPO 2: Transformação Válida/Inválida, Falha Gemini e Concorrência
    // -------------------------------------------------------------
    console.log('\n--- GRUPO 2: TRANSFORMAÇÃO, VALIDAÇÃO CELTA, FALHA GEMINI E CONCORRÊNCIA ---');

    await test('2.1: Rejeição de anotações sem conteúdo pedagógico válido (400 NO_PEDAGOGICAL_CONTENT)', async () => {
      const emptySessionId = `session_2026-11-13_${canonicalStudentUid}`;
      await makeRequest(
        server,
        'POST',
        '/api/session-notes',
        {
          id: emptySessionId,
          studentUid: canonicalStudentUid,
          teacherUid: authorizedTeacherUid,
          content: '   ...   ',
          rawContent: '   ...   ',
          sessionDate: '2026-11-13',
        },
        { Authorization: 'Bearer token-teacher-auth' }
      );

      const res = await makeRequest(
        server,
        'POST',
        `/api/session-notes/${emptySessionId}/transform`,
        {},
        { Authorization: 'Bearer token-teacher-auth' }
      );
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.data.code, 'NO_PEDAGOGICAL_CONTENT');
    });

    await test('2.2: Falha do Gemini retorna erro explícito (503), mantém original intacto e não cria rascunho nem publica', async () => {
      resetGeminiSecurityStateForTesting();
      setSessionNoteTransformAttemptExecutorForTesting(async () => {
        throw new Error('Simulated Gemini 503 Service Unavailable');
      });

      const res = await makeRequest(
        server,
        'POST',
        `/api/session-notes/${sessionIdA}/transform`,
        {},
        { Authorization: 'Bearer token-teacher-auth' }
      );

      assert.strictEqual(res.status, 503);
      assert.strictEqual(res.data.error, 'AI_TRANSFORMATION_FAILED');
      assert.strictEqual(res.data.code, 'AI_TRANSFORMATION_FAILED');

      const getRes = await makeRequest(
        server,
        'GET',
        `/api/session-notes/${sessionIdA}/versions`,
        undefined,
        { Authorization: 'Bearer token-teacher-auth' }
      );
      assert.strictEqual(getRes.status, 200);
      assert.strictEqual(getRes.data.draftTransformation, null);
      assert.strictEqual(getRes.data.lastApprovedVersion, null);
      assert.strictEqual(getRes.data.approvalStatus, 'unapproved');
    });

    await test('2.3: Resposta inválida/genérica da IA (omitindo marcações do professor) é rejeitada sem gerar rascunho local', async () => {
      resetGeminiSecurityStateForTesting();
      setSessionNoteTransformAttemptExecutorForTesting(async () => {
        // Omits teacher's Alt+N error and Alt+W vocabulary
        return JSON.stringify({
          mistakesAnalysis: [],
          grammarPoints: [],
          vocabularyAndExpressions: [],
          reviewSummary: { estimatedMinutes: '5 min', keyRules: [], mustKnowVocabulary: [], essentialCorrections: [], rememberThis: '' },
        });
      });

      const res = await makeRequest(
        server,
        'POST',
        `/api/session-notes/${sessionIdA}/transform`,
        {},
        { Authorization: 'Bearer token-teacher-auth' }
      );

      assert.strictEqual(res.status, 503);
      assert.strictEqual(res.data.code, 'AI_TRANSFORMATION_FAILED');
      assert.strictEqual(res.data.category, 'INVALID_RESPONSE');

      const getRes = await makeRequest(
        server,
        'GET',
        `/api/session-notes/${sessionIdA}/versions`,
        undefined,
        { Authorization: 'Bearer token-teacher-auth' }
      );
      assert.strictEqual(getRes.data.draftTransformation, null, 'Invalid AI response must never create draft');
      assert.strictEqual(getRes.data.lastApprovedVersion, null, 'Invalid AI response must never publish');
    });

    let generatedDraft: any = null;

    await test('2.4: Transformação válida gera as 4 partes preservando marcações e persiste EXCLUSIVAMENTE como draftTransformation', async () => {
      resetGeminiSecurityStateForTesting();
      setSessionNoteTransformAttemptExecutorForTesting(async () => {
        return JSON.stringify(mockTransformationOutput);
      });

      const res = await makeRequest(
        server,
        'POST',
        `/api/session-notes/${sessionIdA}/transform`,
        {},
        { Authorization: 'Bearer token-teacher-auth' }
      );

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.success, true);
      assert.ok(res.data.draftTransformation);
      assert.strictEqual(res.data.draftTransformation.status, 'draft');

      const t = res.data.draftTransformation.transformation;
      assert.strictEqual(t.mistakesAnalysis.length, 1);
      assert.strictEqual(t.mistakesAnalysis[0].original, 'I have 25 years old');
      assert.strictEqual(t.mistakesAnalysis[0].corrected, 'I am 25 years old');
      assert.strictEqual(t.grammarPoints.length, 1);
      assert.strictEqual(t.vocabularyAndExpressions.length, 2);
      assert.ok(t.vocabularyAndExpressions.some((v: any) => v.term === 'break the ice' && v.isNewWord));
      assert.ok(t.vocabularyAndExpressions.some((v: any) => v.term === 'comfortable' && v.isPronunciationFocus));
      assert.ok(t.reviewSummary);

      generatedDraft = res.data.draftTransformation;

      const getRes = await makeRequest(
        server,
        'GET',
        `/api/session-notes/${sessionIdA}/versions`,
        undefined,
        { Authorization: 'Bearer token-teacher-auth' }
      );
      assert.strictEqual(getRes.status, 200);
      assert.strictEqual(getRes.data.draftTransformation.draftId, generatedDraft.draftId);
      assert.strictEqual(getRes.data.lastApprovedVersion, null, 'Não deve publicar sem aprovação explícita');
      assert.strictEqual(getRes.data.approvalStatus, 'draft_in_progress');
    });

    await test('2.5: Proteção de concorrência (single-flight lock) bloqueia chamadas simultâneas duplicadas (429)', async () => {
      resetGeminiSecurityStateForTesting();
      setSessionNoteTransformAttemptExecutorForTesting(async () => {
        await new Promise((r) => setTimeout(r, 120));
        return JSON.stringify(mockTransformationOutput);
      });

      const [res1, res2] = await Promise.all([
        makeRequest(
          server,
          'POST',
          `/api/session-notes/${sessionIdA}/transform`,
          {},
          { Authorization: 'Bearer token-teacher-auth' }
        ),
        makeRequest(
          server,
          'POST',
          `/api/session-notes/${sessionIdA}/transform`,
          {},
          { Authorization: 'Bearer token-teacher-auth' }
        ),
      ]);

      const statuses = [res1.status, res2.status].sort();
      assert.deepStrictEqual(statuses, [200, 429], 'Uma chamada deve concluir (200) e a concorrente ser bloqueada (429)');
      const rejected = res1.status === 429 ? res1 : res2;
      assert.strictEqual(rejected.data.code, 'CONCURRENT_TRANSFORMATION');
      const succeeded = res1.status === 200 ? res1 : res2;
      generatedDraft = succeeded.data.draftTransformation;
    });

    // -------------------------------------------------------------
    // GRUPO 3: Aprovação Explícita, Stale Draft, Idempotência, Histórico e Isolamento
    // -------------------------------------------------------------
    console.log('\n--- GRUPO 3: APROVAÇÃO, STALE DRAFT, IDEMPOTÊNCIA, HISTÓRICO E ISOLAMENTO ---');

    await test('3.1: Proteção contra rascunho desatualizado (409 STALE_DRAFT) quando anotações brutas foram alteradas', async () => {
      const updatedNotes = rawPedagogicalNotes + '\nTeacher note: student was attentive and engaged throughout.';
      const updateRes = await makeRequest(
        server,
        'POST',
        '/api/session-notes',
        {
          id: sessionIdA,
          studentUid: canonicalStudentUid,
          content: updatedNotes,
          rawContent: updatedNotes,
          sessionDate: '2026-11-12',
        },
        { Authorization: 'Bearer token-teacher-auth' }
      );
      assert.strictEqual(updateRes.status, 200);

      const approveRes = await makeRequest(
        server,
        'POST',
        `/api/session-notes/${sessionIdA}/approve`,
        {
          draftId: generatedDraft.draftId,
          transformation: generatedDraft,
        },
        { Authorization: 'Bearer token-teacher-auth' }
      );

      assert.strictEqual(approveRes.status, 409);
      assert.strictEqual(approveRes.data.code, 'STALE_DRAFT');
    });

    await test('3.2: Rejeição de draftId divergente (409 DRAFT_ID_MISMATCH) e estrutura inválida (400)', async () => {
      resetGeminiSecurityStateForTesting();
      setSessionNoteTransformAttemptExecutorForTesting(async () => JSON.stringify(mockTransformationOutput));
      const freshDraftRes = await makeRequest(
        server,
        'POST',
        `/api/session-notes/${sessionIdA}/transform`,
        {},
        { Authorization: 'Bearer token-teacher-auth' }
      );
      assert.strictEqual(freshDraftRes.status, 200);
      const activeDraft = freshDraftRes.data.draftTransformation;

      const approveWrongIdRes = await makeRequest(
        server,
        'POST',
        `/api/session-notes/${sessionIdA}/approve`,
        {
          draftId: 'wrong-or-old-draft-id-xyz',
          transformation: activeDraft,
        },
        { Authorization: 'Bearer token-teacher-auth' }
      );
      assert.strictEqual(approveWrongIdRes.status, 409);
      assert.strictEqual(approveWrongIdRes.data.code, 'DRAFT_ID_MISMATCH');

      const invalidStructRes = await makeRequest(
        server,
        'POST',
        `/api/session-notes/${sessionIdA}/approve`,
        {
          draftId: activeDraft.draftId,
          transformation: { mistakesAnalysis: [] }, // missing grammarPoints, vocabularyAndExpressions, reviewSummary
        },
        { Authorization: 'Bearer token-teacher-auth' }
      );
      assert.strictEqual(invalidStructRes.status, 400);
      assert.strictEqual(invalidStructRes.data.code, 'INVALID_TRANSFORMATION_STRUCTURE');
    });

    let approvedTransformation: any = null;
    let historyLengthAfterApproval = 0;

    await test('3.3: Aprovação explícita do professor publica lastApprovedVersion, limpa draftTransformation e registra histórico', async () => {
      const currentDocRes = await makeRequest(
        server,
        'GET',
        `/api/session-notes/${sessionIdA}/versions`,
        undefined,
        { Authorization: 'Bearer token-teacher-auth' }
      );
      const activeDraft = currentDocRes.data.draftTransformation;
      assert.ok(activeDraft, 'Active draft must exist');

      const approveRes = await makeRequest(
        server,
        'POST',
        `/api/session-notes/${sessionIdA}/approve`,
        {
          draftId: activeDraft.draftId,
          transformation: activeDraft,
        },
        { Authorization: 'Bearer token-teacher-auth' }
      );

      assert.strictEqual(approveRes.status, 200);
      assert.strictEqual(approveRes.data.success, true);
      assert.strictEqual(approveRes.data.approvalStatus, 'approved');
      assert.ok(approveRes.data.approvedVersion);
      assert.strictEqual(approveRes.data.approvedVersion.status, 'approved');
      assert.strictEqual(approveRes.data.approvedVersion.approvedByUid, authorizedTeacherUid);

      approvedTransformation = approveRes.data.approvedVersion;

      const verifiedDocRes = await makeRequest(
        server,
        'GET',
        `/api/session-notes/${sessionIdA}/versions`,
        undefined,
        { Authorization: 'Bearer token-teacher-auth' }
      );
      assert.strictEqual(verifiedDocRes.status, 200);
      assert.strictEqual(verifiedDocRes.data.approvalStatus, 'approved');
      assert.strictEqual(verifiedDocRes.data.draftTransformation, null);
      assert.ok(verifiedDocRes.data.lastApprovedVersion);
      assert.strictEqual(verifiedDocRes.data.lastApprovedVersion.contentHash, activeDraft.contentHash);

      const history = verifiedDocRes.data.versionHistory || [];
      historyLengthAfterApproval = history.length;
      const approvedHistoryEntry = history.find((h: any) => h.type === 'approved_published');
      assert.ok(approvedHistoryEntry, 'versionHistory must record approved_published event');
      assert.strictEqual(approvedHistoryEntry.authorUid, authorizedTeacherUid);
    });

    await test('3.4: Idempotência e ausência de duplicação ao repetir aprovação da mesma versão', async () => {
      const reApproveRes = await makeRequest(
        server,
        'POST',
        `/api/session-notes/${sessionIdA}/approve`,
        {
          draftId: approvedTransformation.draftId,
          transformation: approvedTransformation,
        },
        { Authorization: 'Bearer token-teacher-auth' }
      );

      assert.strictEqual(reApproveRes.status, 200);
      assert.strictEqual(reApproveRes.data.success, true);
      assert.strictEqual(reApproveRes.data.alreadyApproved, true);

      const verifiedDocRes = await makeRequest(
        server,
        'GET',
        `/api/session-notes/${sessionIdA}/versions`,
        undefined,
        { Authorization: 'Bearer token-teacher-auth' }
      );
      assert.strictEqual(
        verifiedDocRes.data.versionHistory.length,
        historyLengthAfterApproval,
        'Re-aprovação idempotente não deve duplicar entradas em versionHistory'
      );
    });

    await test('3.5: Preservação do original, da última versão aprovada e do histórico monotônico após novas edições e rascunhos', async () => {
      const notesV3 = rawPedagogicalNotes + '\nPost-approval teacher note.';
      const editRes = await makeRequest(
        server,
        'POST',
        '/api/session-notes',
        {
          id: sessionIdA,
          studentUid: canonicalStudentUid,
          content: notesV3,
          rawContent: notesV3,
          sessionDate: '2026-11-12',
        },
        { Authorization: 'Bearer token-teacher-auth' }
      );
      assert.strictEqual(editRes.status, 200);

      // Generate a new draft on top of V3 without approving yet
      resetGeminiSecurityStateForTesting();
      setSessionNoteTransformAttemptExecutorForTesting(async () => JSON.stringify(mockTransformationOutput));
      const draftV4Res = await makeRequest(
        server,
        'POST',
        `/api/session-notes/${sessionIdA}/transform`,
        {},
        { Authorization: 'Bearer token-teacher-auth' }
      );
      assert.strictEqual(draftV4Res.status, 200);

      const verifyRes = await makeRequest(
        server,
        'GET',
        `/api/session-notes/${sessionIdA}/versions`,
        undefined,
        { Authorization: 'Bearer token-student' }
      );
      assert.strictEqual(verifyRes.status, 200);
      assert.ok(verifyRes.data.originalTeacherNotes, 'Original teacher notes baseline preserved');
      assert.strictEqual(verifyRes.data.originalTeacherNotes.rawContent, rawPedagogicalNotes);
      assert.ok(verifyRes.data.lastApprovedVersion, 'lastApprovedVersion preserved intact');
      assert.strictEqual(
        verifyRes.data.lastApprovedVersion.approvedVersionId,
        approvedTransformation.approvedVersionId
      );
      assert.ok(verifyRes.data.draftTransformation, 'New draft coexists without overwriting lastApprovedVersion');
      assert.strictEqual(verifyRes.data.approvalStatus, 'approved');

      const versionNumbers = verifyRes.data.versionHistory.map((v: any) => v.versionNumber);
      for (let i = 1; i < versionNumbers.length; i++) {
        assert.ok(versionNumbers[i] > versionNumbers[i - 1], 'versionHistory numbers must be strictly monotonic');
      }
    });

    await test('3.6: Consistência entre caminhos Firestore existentes e isolamento estrito (sem segunda fonte ou escrita em Dictionary/Journal)', async () => {
      const cleanKey = sessionIdA.replace(/[^a-zA-Z0-9_-]/g, '_');
      const rootDoc = firestoreStore[`session_notes/${cleanKey}`];
      const studentSubDoc = firestoreStore[`users/${canonicalStudentUid}/session_notes/${cleanKey}`];

      assert.ok(rootDoc, 'Root collection session_notes doc must exist');
      assert.ok(studentSubDoc, 'Student subcollection session_notes doc must exist');
      assert.strictEqual(rootDoc.approvalStatus, studentSubDoc.approvalStatus);
      assert.strictEqual(
        rootDoc.lastApprovedVersion.approvedVersionId,
        studentSubDoc.lastApprovedVersion.approvedVersionId
      );
      assert.strictEqual(
        rootDoc.draftTransformation.draftId,
        studentSubDoc.draftTransformation.draftId
      );
      assert.strictEqual(rootDoc.studentUid, canonicalStudentUid);
      assert.strictEqual(studentSubDoc.studentUid, canonicalStudentUid);
      assert.strictEqual(rootDoc.teacherUid, authorizedTeacherUid);
      assert.strictEqual(studentSubDoc.teacherUid, authorizedTeacherUid);

      // Verify no second source of truth or cross-activity writes occurred in Firestore
      const storeKeys = Object.keys(firestoreStore);
      assert.strictEqual(
        storeKeys.some((k) => k.startsWith('pedagogical_transformations/')),
        false,
        'Must not create second source of truth in pedagogical_transformations'
      );
      assert.strictEqual(
        storeKeys.some((k) => k.includes('/dictionary') || k.includes('/journal')),
        false,
        'Must not mutate Dictionary or Journal collections in NF-DOC.2B'
      );
    });
  } finally {
    setSessionNoteTransformAttemptExecutorForTesting(null);
    resetGeminiSecurityStateForTesting();
    resetFirebaseAdminFirestoreForTesting();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  console.log('\n======================================================================');
  console.log(`FASE NF-DOC.2B TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('======================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
  process.exit(0);
}

runNFDoc2bTestSuite().catch((err) => {
  console.error('Fatal error in NF-DOC.2B test suite:', err);
  process.exit(1);
});
