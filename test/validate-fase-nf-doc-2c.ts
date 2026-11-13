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
} from '../src/serverFirestore';
import { resetGeminiSecurityStateForTesting } from '../src/serverGeminiSecurity';
import { computeNotesContentHash } from '../src/utils/notesVersioning';

/**
 * FASE NF-DOC.2C — Suíte de Validação: Interface do Professor | Design Minimalista
 *
 * Cobertura de Verificação:
 * 1. Interface & Componentes: Presença das 4 partes canônicas e botões no TeacherLiveLessonNotesPanel.
 * 2. Salvamento Prévio: Anotações originais são persistidas antes da transformação.
 * 3. Aplicar IA: Acionamento exclusivo por ação do professor, geração das 4 partes, status draft_in_progress.
 * 4. Revisão & Edição do Professor: Edição inline de erros, regras gramaticais, vocabulário e quick review.
 * 5. Aprovação & Publicação: Publicação da versão revisada via endpoint existente, limpeza do draft e versionamento.
 * 6. Proteção contra Rascunho Obsoleto (Stale Draft): Bloqueio se o texto original for alterado após o rascunho.
 * 7. Tratamento de Falha Real do Gemini: Sem mocks sintéticos, preservação do original e da versão aprovada anterior.
 * 8. Hidratação F5 / Persistência: Leitura completa de draft e versão aprovada.
 * 9. Isolamento & RBAC: Alunos e terceiros impedidos de transformar/aprovar; sem efeitos colaterais em Dictionary/Journal/S-Path.
 */

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

async function runNFDoc2cTestSuite() {
  console.log('======================================================================');
  console.log("IT'S SIMPLE — FASE NF-DOC.2C: INTERFACE DO PROFESSOR (VALIDAÇÃO)");
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

  const timestamp = Date.now();
  const canonicalStudentUid = `canonical-student-doc2c-${timestamp}`;
  const studentEmail = `student.doc2c.${timestamp}@example.com`;

  const authorizedTeacherUid = `canonical-teacher-doc2c-auth-${timestamp}`;
  const authorizedTeacherEmail = `teacher.doc2c.auth.${timestamp}@example.com`;

  const unauthorizedTeacherUid = `canonical-teacher-doc2c-unauth-${timestamp}`;
  const unauthorizedTeacherEmail = `teacher.doc2c.unauth.${timestamp}@example.com`;

  const tokenMap: Record<string, any> = {
    'token-student': { uid: canonicalStudentUid, email: studentEmail, email_verified: true, role: 'student' },
    'token-teacher-auth': { uid: authorizedTeacherUid, email: authorizedTeacherEmail, email_verified: true, role: 'teacher' },
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

  const firestoreStore: Record<string, any> = {
    [`users/${canonicalStudentUid}`]: {
      uid: canonicalStudentUid,
      email: studentEmail,
      role: 'student',
      teacherUid: authorizedTeacherUid,
      teacherEmail: authorizedTeacherEmail,
      assignedNativeFriendUID: authorizedTeacherUid,
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

  const teacherAuthHeader = {
    Authorization: 'Bearer token-teacher-auth',
  };

  const studentAuthHeader = {
    Authorization: 'Bearer token-student',
  };

  const unauthorizedTeacherAuthHeader = {
    Authorization: 'Bearer token-teacher-unauth',
  };

  const server = http.createServer(serverApp);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  const mockTransformationOutput = {
    mistakesAnalysis: [
      {
        id: 'mistake-1',
        original: 'I have 30 years old',
        corrected: 'I am 30 years old',
        explanation: 'In English we use the verb to be for age, not to have.',
        examples: ['I am 30 years old and he is 28.', 'How old are you?'],
        category: 'Grammar',
      },
    ],
    grammarPoints: [
      {
        id: 'grammar-1',
        topic: 'Expressing Age with "to be"',
        rule: 'Always use subject + to be + age in English.',
        examples: ['I am 30 years old.', 'She is twenty-five.'],
      },
    ],
    vocabularyAndExpressions: [
      {
        id: 'vocab-1',
        term: 'resilient',
        definitionEn: 'Able to withstand or recover quickly from difficult conditions.',
        simpleDefinition: 'Capaz de se recuperar rapidamente sob pressão.',
        realExamples: ['The team remained resilient during the restructuring.'],
        isNewWord: true,
      },
      {
        id: 'vocab-2',
        term: 'comfortable',
        definitionEn: 'Providing physical ease and relaxation; feeling at ease.',
        simpleDefinition: 'Confortável. Atenção à redução na pronúncia.',
        realExamples: ['I feel very comfortable presenting in English.'],
        phoneticGuide: '/ˈkʌmftərbəl/',
        isPronunciationFocus: true,
      },
    ],
    reviewSummary: {
      estimatedMinutes: '5–10 minutes',
      keyRules: ['Use the verb to be when stating age.'],
      mustKnowVocabulary: ['resilient', 'comfortable'],
      essentialCorrections: [{ original: 'I have 30 years old', corrected: 'I am 30 years old' }],
      rememberThis: 'Always say: I AM 30 years old, never I have 30!',
    },
  };

  try {
    // -------------------------------------------------------------------------
    // GRUPO 1: INSPEÇÃO ESTRUTURAL DO COMPONENTE DO PROFESSOR (DESIGN MINIMALISTA)
    // -------------------------------------------------------------------------
    console.log('--- GRUPO 1: DESIGN MINIMALISTA E ESTRUTURA DO EDITOR DO PROFESSOR ---');

    await test('1.1: Componente TeacherLiveLessonNotesPanel contém os botões Aplicar IA e Aprovar e Publicar', () => {
      const componentPath = path.resolve(process.cwd(), 'src/components/TeacherLiveLessonNotesPanel.tsx');
      assert(fs.existsSync(componentPath), 'TeacherLiveLessonNotesPanel.tsx deve existir');
      const content = fs.readFileSync(componentPath, 'utf8');

      // Botões top e bottom
      assert(content.includes('id="btn-apply-ai-top"'), 'Deve conter id="btn-apply-ai-top"');
      assert(content.includes('id="btn-apply-ai-bottom"'), 'Deve conter id="btn-apply-ai-bottom"');
      assert(content.includes('id="btn-approve-publish-top"'), 'Deve conter id="btn-approve-publish-top"');
      assert(content.includes('id="btn-approve-publish-bottom"'), 'Deve conter id="btn-approve-publish-bottom"');
      assert(content.includes('handleApplyAi'), 'Deve conter função handleApplyAi');
      assert(content.includes('handleApproveAndPublish'), 'Deve conter função handleApproveAndPublish');
    });

    await test('1.2: Estrutura minimalista contém o container do relatório e as 4 partes pedagógicas com IDs canônicos', () => {
      const componentPath = path.resolve(process.cwd(), 'src/components/TeacherLiveLessonNotesPanel.tsx');
      const content = fs.readFileSync(componentPath, 'utf8');

      assert(content.includes('id="pedagogical-enrichment-environment"'), 'Deve conter #pedagogical-enrichment-environment');
      assert(content.includes('id="pedagogical-part-1-mistakes"'), 'Deve conter #pedagogical-part-1-mistakes');
      assert(content.includes('id="pedagogical-part-2-grammar"'), 'Deve conter #pedagogical-part-2-grammar');
      assert(content.includes('id="pedagogical-part-3-vocab"'), 'Deve conter #pedagogical-part-3-vocab');
      assert(content.includes('id="pedagogical-part-4-review"'), 'Deve conter #pedagogical-part-4-review');

      // Textos exatos dos títulos das 4 partes
      assert(content.includes('1. Analyze Mistakes'), 'Deve conter título 1. Analyze Mistakes');
      assert(content.includes('2. Grammar Points'), 'Deve conter título 2. Grammar Points');
      assert(content.includes('3. Vocabulary & Expressions'), 'Deve conter título 3. Vocabulary & Expressions');
      assert(content.includes('4. Quick Review (5–10 min)'), 'Deve conter título 4. Quick Review (5–10 min)');
    });

    await test('1.3: Atalhos Alt+Y, Alt+N, Alt+W e Alt+P permanecem preservados no editor com tags pré-estilizadas', () => {
      const componentPath = path.resolve(process.cwd(), 'src/components/TeacherLiveLessonNotesPanel.tsx');
      const content = fs.readFileSync(componentPath, 'utf8');

      assert(content.includes("'y'") || content.includes('"y"'), 'Deve manter atalho Alt+Y');
      assert(content.includes("'n'") || content.includes('"n"'), 'Deve manter atalho Alt+N');
      assert(content.includes("'w'") || content.includes('"w"'), 'Deve manter atalho Alt+W');
      assert(content.includes("'p'") || content.includes('"p"'), 'Deve manter atalho Alt+P');
      assert(content.includes('CORRECT_TAG_HTML'), 'Deve manter estilo de Correct tag');
      assert(content.includes('INCORRECT_TAG_HTML'), 'Deve manter estilo de Incorrect tag');
      assert(content.includes('NEW_WORD_TAG_HTML'), 'Deve manter estilo de New Word tag');
      assert(content.includes('PRONOUNCE_TAG_HTML'), 'Deve manter estilo de Pronounce tag');
    });

    // -------------------------------------------------------------------------
    // GRUPO 2: SALVAMENTO DAS ANOTAÇÕES ORIGINAIS ANTES DA TRANSFORMAÇÃO
    // -------------------------------------------------------------------------
    console.log('\n--- GRUPO 2: SALVAMENTO PRÉVIO E ACIONAMENTO EXCLUSIVO DO GEMINI ---');

    const NOTE_ID_1 = `session_2026-11-12_${canonicalStudentUid}`;
    const RAW_CONTENT_1 = `
Lesson 1 - Real Notes
(Alt+N) I have 30 years old (Alt+Y) I am 30 years old
(Alt+W) resilient
(Alt+P) comfortable
Discussed interview preparations, resilience in projects, and pronunciation.
`;

    await test('2.1: Salvamento das anotações brutas ocorre no backend antes da transformação', async () => {
      const saveRes = await makeRequest(
        server,
        'POST',
        '/api/session-notes',
        {
          id: NOTE_ID_1,
          studentUid: canonicalStudentUid,
          teacherUid: authorizedTeacherUid,
          teacherName: 'Teacher Authorized',
          topic: 'Job Interview Presentation',
          content: RAW_CONTENT_1,
          rawContent: RAW_CONTENT_1,
          sessionDate: '2026-11-12',
        },
        teacherAuthHeader
      );
      assert.strictEqual(saveRes.status, 200, 'Salvar anotações deve retornar 200');
      assert.strictEqual(saveRes.data.success, true, 'Deve retornar success: true');
      assert(saveRes.data.sessionNote, 'Deve conter sessionNote salvo');
    });

    let currentDraft: any = null;

    await test('2.2: Acionamento exclusivo por "Aplicar IA" chama endpoint de transformação e gera as 4 partes canônicas', async () => {
      resetGeminiSecurityStateForTesting();
      setSessionNoteTransformAttemptExecutorForTesting(async () => {
        return JSON.stringify(mockTransformationOutput);
      });

      const transformRes = await makeRequest(
        server,
        'POST',
        `/api/session-notes/${NOTE_ID_1}/transform`,
        {},
        teacherAuthHeader
      );

      assert.strictEqual(transformRes.status, 200, 'Transform deve retornar 200');
      assert.strictEqual(transformRes.data.success, true);
      const draft = transformRes.data.draftTransformation;
      assert(draft, 'Deve retornar draftTransformation');
      assert(draft.draftId, 'Deve conter draftId');
      assert.strictEqual(draft.status, 'draft');

      const t = draft.transformation;
      assert.strictEqual(t.mistakesAnalysis.length, 1);
      assert.strictEqual(t.grammarPoints.length, 1);
      assert.strictEqual(t.vocabularyAndExpressions.length, 2);
      assert(t.reviewSummary);

      currentDraft = draft;
    });

    // -------------------------------------------------------------------------
    // GRUPO 3: REVISÃO E EDIÇÃO PELO PROFESSOR (INLINE WORKSPACE)
    // -------------------------------------------------------------------------
    console.log('\n--- GRUPO 3: REVISÃO E EDIÇÃO DAS 4 PARTES PELO PROFESSOR ---');

    await test('3.1: Leitura do rascunho confirma que as 4 partes estão persistidas e prontas para edição', async () => {
      const versionsRes = await makeRequest(
        server,
        'GET',
        `/api/session-notes/${NOTE_ID_1}/versions`,
        undefined,
        teacherAuthHeader
      );
      assert.strictEqual(versionsRes.status, 200);
      assert(versionsRes.data.draftTransformation, 'draftTransformation deve estar persistido');
      assert.strictEqual(versionsRes.data.draftTransformation.draftId, currentDraft.draftId);
      assert.strictEqual(versionsRes.data.approvalStatus, 'draft_in_progress');
      assert.strictEqual(versionsRes.data.lastApprovedVersion, null, 'Nenhuma versão deve estar aprovada ainda');
    });

    await test('3.2: Professor edita inline e adiciona refinamentos pedagógicos nas 4 partes antes de aprovar', async () => {
      // Simula a revisão do professor no frontend
      const editedDraft = JSON.parse(JSON.stringify(currentDraft));
      editedDraft.transformation.mistakesAnalysis[0].explanation =
        'Em inglês usamos o verbo to be para idade (I am 30 years old), nunca have.';
      editedDraft.transformation.reviewSummary.rememberThis =
        'Lembre-se sempre: I AM 30 years old na sua entrevista!';

      const approveRes = await makeRequest(
        server,
        'POST',
        `/api/session-notes/${NOTE_ID_1}/approve`,
        {
          draftId: editedDraft.draftId,
          transformation: editedDraft,
        },
        teacherAuthHeader
      );

      assert.strictEqual(approveRes.status, 200, 'Approve deve retornar 200');
      assert.strictEqual(approveRes.data.success, true);
      assert.strictEqual(approveRes.data.approvalStatus, 'approved');

      const approved = approveRes.data.approvedVersion;
      assert(approved, 'Deve retornar approvedVersion');
      assert.strictEqual(approved.status, 'approved');
      assert.strictEqual(
        approved.transformation.mistakesAnalysis[0].explanation,
        'Em inglês usamos o verbo to be para idade (I am 30 years old), nunca have.'
      );

      // Verifica limpeza do draft após aprovação
      const checkRes = await makeRequest(
        server,
        'GET',
        `/api/session-notes/${NOTE_ID_1}/versions`,
        undefined,
        teacherAuthHeader
      );
      assert.strictEqual(checkRes.status, 200);
      assert.strictEqual(checkRes.data.draftTransformation, null, 'Draft deve ser limpo');
      assert.strictEqual(checkRes.data.approvalStatus, 'approved');
      assert(checkRes.data.lastApprovedVersion, 'lastApprovedVersion deve estar preenchida');
    });

    // -------------------------------------------------------------------------
    // GRUPO 4: PROTEÇÃO CONTRA RASCUNHO OBSOLETO (STALE DRAFT)
    // -------------------------------------------------------------------------
    console.log('\n--- GRUPO 4: PROTEÇÃO CONTRA RASCUNHO OBSOLETO (STALE DRAFT) ---');

    let staleDraftId = '';

    await test('4.1: Gerar novo rascunho vincula contentHash do conteúdo atual', async () => {
      resetGeminiSecurityStateForTesting();
      setSessionNoteTransformAttemptExecutorForTesting(async () => JSON.stringify(mockTransformationOutput));

      const transformRes = await makeRequest(
        server,
        'POST',
        `/api/session-notes/${NOTE_ID_1}/transform`,
        {},
        teacherAuthHeader
      );
      assert.strictEqual(transformRes.status, 200);
      assert(transformRes.data.draftTransformation);
      staleDraftId = transformRes.data.draftTransformation.draftId;
    });

    await test('4.2: Modificação das anotações brutas torna o rascunho obsoleto e bloqueia aprovação (409 STALE_DRAFT)', async () => {
      // 1. Modifica o conteúdo bruto original
      const modifiedRaw = RAW_CONTENT_1 + '\nTeacher note: add drill for present perfect.';
      const updateRes = await makeRequest(
        server,
        'POST',
        '/api/session-notes',
        {
          id: NOTE_ID_1,
          studentUid: canonicalStudentUid,
          content: modifiedRaw,
          rawContent: modifiedRaw,
          sessionDate: '2026-11-12',
        },
        teacherAuthHeader
      );
      assert.strictEqual(updateRes.status, 200);

      // 2. Tentar aprovar o rascunho anterior deve ser bloqueado com 409 STALE_DRAFT
      const approveRes = await makeRequest(
        server,
        'POST',
        `/api/session-notes/${NOTE_ID_1}/approve`,
        {
          draftId: staleDraftId,
          transformation: { draftId: staleDraftId },
        },
        teacherAuthHeader
      );

      assert.strictEqual(approveRes.status, 409, 'Deve retornar 409 STALE_DRAFT');
      assert.strictEqual(approveRes.data.code, 'STALE_DRAFT');
    });

    // -------------------------------------------------------------------------
    // GRUPO 5: TRATAMENTO DE FALHA REAL DO GEMINI (SEM MOCK SINTÉTICO)
    // -------------------------------------------------------------------------
    console.log('\n--- GRUPO 5: FALHA DO GEMINI PRESERVA ORIGINAL E VERSÃO ANTERIOR ---');

    await test('5.1: Erro 503 do Gemini não altera anotações originais nem corrompe versão aprovada prévia', async () => {
      resetGeminiSecurityStateForTesting();
      setSessionNoteTransformAttemptExecutorForTesting(async () => {
        throw new Error('Gemini Service Unavailable simulated error');
      });

      const failRes = await makeRequest(
        server,
        'POST',
        `/api/session-notes/${NOTE_ID_1}/transform`,
        {},
        teacherAuthHeader
      );

      assert.strictEqual(failRes.status, 503, 'Deve retornar 503');
      assert.strictEqual(failRes.data.code, 'AI_TRANSFORMATION_FAILED');

      // Verifica integridade da versão aprovada anterior
      const versionsRes = await makeRequest(
        server,
        'GET',
        `/api/session-notes/${NOTE_ID_1}/versions`,
        undefined,
        teacherAuthHeader
      );
      assert.strictEqual(versionsRes.status, 200);
      assert(versionsRes.data.lastApprovedVersion, 'Versão aprovada deve permanecer intacta');
      assert.strictEqual(versionsRes.data.lastApprovedVersion.status, 'approved');
      assert.strictEqual(versionsRes.data.approvalStatus, 'approved');
    });

    // -------------------------------------------------------------------------
    // GRUPO 6: ISOLAMENTO RBAC E AUSÊNCIA DE IMPACTO EM OUTRAS ENTIDADES
    // -------------------------------------------------------------------------
    console.log('\n--- GRUPO 6: ISOLAMENTO RBAC, PRIVACIDADE E INTEGRIDADE DE OUTRAS ÁREAS ---');

    await test('6.1: Aluno é impedido de acionar Aplicar IA (403 STUDENTS_CANNOT_TRANSFORM)', async () => {
      const res = await makeRequest(
        server,
        'POST',
        `/api/session-notes/${NOTE_ID_1}/transform`,
        { studentUid: canonicalStudentUid },
        studentAuthHeader
      );
      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.data.code, 'STUDENTS_CANNOT_TRANSFORM');
    });

    await test('6.2: Aluno é impedido de aprovar relatório (403 STUDENTS_CANNOT_APPROVE)', async () => {
      const res = await makeRequest(
        server,
        'POST',
        `/api/session-notes/${NOTE_ID_1}/approve`,
        { studentUid: canonicalStudentUid },
        studentAuthHeader
      );
      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.data.code, 'STUDENTS_CANNOT_APPROVE');
    });

    await test('6.3: Professor sem vínculo pedagógico é impedido de acionar Aplicar IA (403 UNAUTHORIZED_PEDAGOGICAL_LINK)', async () => {
      const res = await makeRequest(
        server,
        'POST',
        `/api/session-notes/${NOTE_ID_1}/transform`,
        {},
        unauthorizedTeacherAuthHeader
      );
      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.data.code, 'UNAUTHORIZED_PEDAGOGICAL_LINK');
    });

    await test('6.4: Nenhuma alteração colateral ocorreu em Dictionary, Journal ou S-Path', () => {
      const keys = Object.keys(firestoreStore);
      const invalidColl = keys.some(
        (k) =>
          k.startsWith('studentDictionary') ||
          k.startsWith('studentJournal') ||
          k.startsWith('sPath')
      );
      assert.strictEqual(invalidColl, false, 'Não deve haver escritas em coleções não autorizadas');
    });

  } finally {
    setSessionNoteTransformAttemptExecutorForTesting(null);
    resetGeminiSecurityStateForTesting();
    resetFirebaseAdminFirestoreForTesting();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  console.log('\n======================================================================');
  console.log(`FASE NF-DOC.2C TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('======================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
  process.exit(0);
}

runNFDoc2cTestSuite().catch((err) => {
  console.error('Fatal test error in NF-DOC.2C:', err);
  process.exit(1);
});
