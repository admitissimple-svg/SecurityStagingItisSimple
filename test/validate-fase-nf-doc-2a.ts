process.env.NODE_ENV = 'test';

import assert from 'assert';
import http from 'http';
import { app as serverApp } from '../serverApp';
import { setFirebaseAdminAuthForTesting } from '../src/serverFirebaseAdmin';
import {
  setFirebaseAdminFirestoreForTesting,
  resetFirebaseAdminFirestoreForTesting,
  setIsCloudWriteDisabled,
} from '../src/serverFirestore';
import { isValidCanonicalUid } from '../src/utils/studentPersistence';
import {
  mergeSessionNoteWithVersioning,
  computeNotesContentHash,
} from '../src/utils/notesVersioning';
import { PedagogicalLessonTransformation } from '../src/utils/pedagogicalTransformer';

/**
 * FASE NF-DOC.2A — Test Suite: Contrato Canônico e Versionamento
 * 
 * 1. Imutabilidade dos UIDs e vínculos (FASE IDENTITY-CRITICAL.2)
 *    - Rejeição expressa de studentUid vazio ou ausente
 *    - Rejeição de professor sem vínculo pedagógico autorizado
 *    - Imutabilidade absoluta: UIDs não são substituídos por email ou tutor ID
 * 2. Preservação da última versão aprovada
 *    - Nova edição de anotações brutas NÃO apaga nem despublica a versão aprovada
 *    - Novo rascunho de IA em elaboração NÃO despublica a versão aprovada
 * 3. Preservação do histórico de versões
 *    - Incremento monotônico de versões (v1, v2, v3...)
 *    - Rastreabilidade de authorUid, contentHash, timestamps e tipos (teacher_raw, ai_draft, approved_published)
 * 4. Compatibilidade com registros legados
 *    - Registro legado sem versionamento carrega com integridade
 *    - Conteúdo legado NÃO é aprovado automaticamente (approvalStatus = 'unapproved')
 *    - Atualização de registro legado migra suavemente preservando sessionId, lessonId, studentUid, teacherUid
 * 5. Ausência de alterações nos fluxos existentes
 *    - POST /api/session-notes mantém contrato funcional completo
 *    - GET /api/session-notes mantém isolamento estrito de aluno e retorno consistente
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

async function runNFDoc2aTestSuite() {
  console.log('======================================================================');
  console.log('IT\'S SIMPLE — FASE NF-DOC.2A: CONTRATO CANÔNICO E VERSIONAMENTO');
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
  const canonicalStudentUid = `canonical-student-nfdoc-${timestamp}`;
  const studentEmail = `student.nfdoc.${timestamp}@example.com`;

  const canonicalOtherStudentUid = `canonical-other-nfdoc-${timestamp}`;
  const otherStudentEmail = `other.student.${timestamp}@example.com`;

  const authorizedTeacherUid = `canonical-teacher-auth-${timestamp}`;
  const authorizedTeacherEmail = `teacher.auth.${timestamp}@example.com`;

  const unauthorizedTeacherUid = `canonical-teacher-unauth-${timestamp}`;
  const unauthorizedTeacherEmail = `teacher.unauth.${timestamp}@example.com`;

  const adminUid = `canonical-admin-nfdoc-${timestamp}`;
  const adminEmail = `admin.nfdoc.${timestamp}@example.com`;

  const tokenMap: Record<string, any> = {
    'token-student': { uid: canonicalStudentUid, email: studentEmail, email_verified: true, role: 'student' },
    'token-other-student': { uid: canonicalOtherStudentUid, email: otherStudentEmail, email_verified: true, role: 'student' },
    'token-teacher-auth': { uid: authorizedTeacherUid, email: authorizedTeacherEmail, email_verified: true, role: 'teacher' },
    'token-teacher-unauth': { uid: unauthorizedTeacherUid, email: unauthorizedTeacherEmail, email_verified: true, role: 'teacher' },
    'token-admin': { uid: adminUid, email: adminEmail, email_verified: true, role: 'admin', admin: true },
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

  // In-memory Firestore store for testing isolation
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
      where: (field: string, op: string, val: any) => {
        const createQuery = (filters: Array<{ field: string; val: any }>) => ({
          where: (f2: string, op2: string, v2: any) => createQuery([...filters, { field: f2, val: v2 }]),
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

  try {
    // ------------------------------------------------------------------------
    // GRUPO 1: Identidade Inviolável (FASE IDENTITY-CRITICAL.2)
    // ------------------------------------------------------------------------
    await test('1.1. Tentativa de gravar anotações com studentUid vazio é rejeitada com 400', async () => {
      const res = await makeRequest(
        server,
        'POST',
        '/api/session-notes',
        {
          studentUid: '',
          content: 'Teacher notes content',
          sessionDate: '2026-11-12',
        },
        { Authorization: 'Bearer token-teacher-auth' }
      );
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.data.code, 'CANONICAL_STUDENT_UID_REQUIRED');
    });

    await test('1.2. Professor sem vínculo pedagógico autorizado com aluno recebe 403', async () => {
      const res = await makeRequest(
        server,
        'POST',
        '/api/session-notes',
        {
          studentUid: canonicalStudentUid,
          content: 'Intruder teacher note',
          sessionDate: '2026-11-12',
        },
        { Authorization: 'Bearer token-teacher-unauth' }
      );
      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.data.code, 'UNAUTHORIZED_PEDAGOGICAL_LINK');
    });

    await test('1.3. Gravação com studentUid e teacherUid canônicos autorizados tem sucesso', async () => {
      const res = await makeRequest(
        server,
        'POST',
        '/api/session-notes',
        {
          id: `session_2026-11-12_${canonicalStudentUid}`,
          studentUid: canonicalStudentUid,
          teacherUid: authorizedTeacherUid,
          teacherName: 'Teacher Authorized',
          topic: 'Business English & Operations',
          content: 'Initial live notes Alt+N: He can to go -> He can go. Alt+W: streamline',
          rawContent: 'Initial live notes Alt+N: He can to go -> He can go. Alt+W: streamline',
          sessionDate: '2026-11-12',
        },
        { Authorization: 'Bearer token-teacher-auth' }
      );
      assert.strictEqual(res.status, 200);
      assert.ok(res.data.success);
      assert.strictEqual(res.data.sessionNote.studentUid, canonicalStudentUid);
      assert.strictEqual(res.data.sessionNote.teacherUid, authorizedTeacherUid);
      assert.strictEqual(res.data.sessionNote.approvalStatus, 'unapproved');
    });

    // ------------------------------------------------------------------------
    // GRUPO 2: Estrutura do Contrato Canônico e Compatibilidade Legada
    // ------------------------------------------------------------------------
    await test('2.1. Registro legado sem versionamento é preservado sem auto-aprovação', async () => {
      const legacySessionKey = `session_2026-10-01_${canonicalStudentUid}`;
      firestoreStore[`session_notes/${legacySessionKey}`] = {
        id: legacySessionKey,
        sessionKey: legacySessionKey,
        sessionDate: '2026-10-01',
        studentUid: canonicalStudentUid,
        studentEmail: studentEmail,
        teacherUid: authorizedTeacherUid,
        teacherEmail: authorizedTeacherEmail,
        teacherName: 'Teacher Authorized',
        content: 'Legacy notes without AI',
        rawContent: 'Legacy notes without AI',
        topic: 'Legacy Session',
        createdAt: '2026-10-01T10:00:00.000Z',
        updatedAt: '2026-10-01T10:30:00.000Z',
      };

      const versionsRes = await makeRequest(
        server,
        'GET',
        `/api/session-notes/${legacySessionKey}/versions`,
        undefined,
        { Authorization: 'Bearer token-student' }
      );

      assert.strictEqual(versionsRes.status, 200);
      assert.strictEqual(versionsRes.data.approvalStatus, 'unapproved', 'Legado permanece unapproved');
      assert.strictEqual(versionsRes.data.lastApprovedVersion, null, 'Legado tem lastApprovedVersion null');
      assert.strictEqual(versionsRes.data.draftTransformation, null, 'Legado tem draftTransformation null');
    });

    await test('2.2. Atualização de registro legado estabelece baseline originalTeacherNotes', async () => {
      const legacySessionKey = `session_2026-10-01_${canonicalStudentUid}`;
      const updateRes = await makeRequest(
        server,
        'POST',
        '/api/session-notes',
        {
          id: legacySessionKey,
          studentUid: canonicalStudentUid,
          teacherUid: authorizedTeacherUid,
          content: 'Updated content preserving legacy baseline',
          rawContent: 'Updated content preserving legacy baseline',
          sessionDate: '2026-10-01',
          changeSummary: 'Teacher refreshed legacy notes',
        },
        { Authorization: 'Bearer token-teacher-auth' }
      );

      assert.strictEqual(updateRes.status, 200);
      const note = updateRes.data.sessionNote;
      assert.ok(note.originalTeacherNotes, 'originalTeacherNotes estabelecido');
      assert.strictEqual(note.originalTeacherNotes.rawContent, 'Legacy notes without AI', 'Baseline original preservado');
      assert.strictEqual(note.approvalStatus, 'unapproved', 'Ainda unapproved');
      assert.strictEqual(note.currentVersionNumber, 1);
      assert.strictEqual(note.versionHistory.length, 1);
    });

    // ------------------------------------------------------------------------
    // GRUPO 3: Rascunho IA em Elaboração e Aprovação pelo Professor
    // ------------------------------------------------------------------------
    const sessionKey = `session_2026-11-12_${canonicalStudentUid}`;

    const sampleTransformation: PedagogicalLessonTransformation = {
      sessionKey,
      sessionDate: '2026-11-12',
      topic: 'Business English & Operations',
      studentLevel: 'intermediate',
      cefrLevel: 'B1',
      isAiGenerated: true,
      isFallback: false,
      isProvisional: false,
      rawNotesSnippet: 'Initial live notes',
      mistakesAnalysis: [
        {
          id: 'm1',
          original: 'He can to go',
          corrected: 'He can go',
          category: 'grammar',
          explanation: 'Modals like "can" take bare infinitives.',
          twoExamples: ['She can swim', 'They can attend'],
          commonPitfalls: 'Do not use "to" after can.',
        },
      ],
      grammarPoints: [],
      vocabularyAndExpressions: [
        {
          id: 'v1',
          term: 'streamline',
          partOfSpeech: 'verb',
          simpleDefinition: 'Make an organization or process more efficient',
          collocations: ['streamline operations'],
          realExamples: ['We need to streamline the workflow.'],
          synonyms: ['simplify'],
          register: 'formal',
          category: 'Business',
        },
      ],
      reviewSummary: {
        estimatedMinutes: '5 minutes',
        keyRules: ['Modals take bare infinitives'],
        mustKnowVocabulary: ['streamline'],
        essentialCorrections: [{ original: 'He can to go', corrected: 'He can go' }],
        rememberThis: 'Always use bare infinitive after can.',
      },
      correctStampsCount: 0,
      incorrectStampsCount: 1,
      newWordStampsCount: 1,
      pronounceStampsCount: 0,
      generatedAt: new Date().toISOString(),
    };

    await test('3.1. Salvar rascunho de IA (draft) atualiza draftTransformation sem aprovação', async () => {
      const draftRes = await makeRequest(
        server,
        'POST',
        `/api/session-notes/${sessionKey}/draft`,
        {
          transformation: sampleTransformation,
          customTeacherNotes: 'Professor revisando ponto sobre modal verbs.',
        },
        { Authorization: 'Bearer token-teacher-auth' }
      );

      assert.strictEqual(draftRes.status, 200);
      const note = draftRes.data.sessionNote;
      assert.strictEqual(note.approvalStatus, 'draft_in_progress');
      assert.ok(note.draftTransformation);
      assert.strictEqual(note.draftTransformation.status, 'draft');
      assert.strictEqual(note.draftTransformation.editorUid, authorizedTeacherUid);
      assert.strictEqual(note.lastApprovedVersion, null, 'Ainda não aprovado');
      assert.ok(note.versionHistory.some((v: any) => v.type === 'ai_draft'));
    });

    await test('3.2. Professor aprova conteúdo: publica lastApprovedVersion e marca status approved', async () => {
      const approveRes = await makeRequest(
        server,
        'POST',
        `/api/session-notes/${sessionKey}/approve`,
        {
          transformation: sampleTransformation,
          notesSummary: 'Conteúdo validado com foco em modal verbs e vocabulary.',
        },
        { Authorization: 'Bearer token-teacher-auth' }
      );

      assert.strictEqual(approveRes.status, 200);
      const note = approveRes.data.sessionNote;
      assert.strictEqual(note.approvalStatus, 'approved');
      assert.ok(note.lastApprovedVersion, 'lastApprovedVersion criado');
      assert.strictEqual(note.lastApprovedVersion.status, 'approved');
      assert.strictEqual(note.lastApprovedVersion.approvedByUid, authorizedTeacherUid);
      assert.strictEqual(note.draftTransformation, null, 'Draft limpo após publicação');
      assert.ok(note.versionHistory.some((v: any) => v.type === 'approved_published'));
    });

    // ------------------------------------------------------------------------
    // GRUPO 4: REGRA INVIOLÁVEL: Nova edição NÃO apaga nem despublica versão aprovada
    // ------------------------------------------------------------------------
    await test('4.1. Edição de anotações brutas do professor NÃO despublica a versão aprovada', async () => {
      const preCheck = await makeRequest(
        server,
        'GET',
        `/api/session-notes/${sessionKey}/versions`,
        undefined,
        { Authorization: 'Bearer token-student' }
      );
      assert.strictEqual(preCheck.data.approvalStatus, 'approved');
      const approvedSnapshot = JSON.parse(JSON.stringify(preCheck.data.lastApprovedVersion));
      assert.ok(approvedSnapshot, 'Versão aprovada confirmada antes da nova edição');

      // Professor volta e digita uma nova frase ou correção bruta
      const newEditRes = await makeRequest(
        server,
        'POST',
        '/api/session-notes',
        {
          id: sessionKey,
          studentUid: canonicalStudentUid,
          teacherUid: authorizedTeacherUid,
          content: 'Teacher added an extra correction: She doesn\'t have -> She doesn\'t have',
          rawContent: 'Teacher added an extra correction: She doesn\'t have -> She doesn\'t have',
          sessionDate: '2026-11-12',
          changeSummary: 'Teacher added extra correction post-approval',
        },
        { Authorization: 'Bearer token-teacher-auth' }
      );

      assert.strictEqual(newEditRes.status, 200);
      const updatedNote = newEditRes.data.sessionNote;

      // REGRA INVIOLÁVEL: A edição nova NÃO PODE apagar nem despublicar a versão anteriormente aprovada
      assert.ok(updatedNote.lastApprovedVersion, 'lastApprovedVersion CONTINUA PRESENTE');
      assert.strictEqual(
        updatedNote.lastApprovedVersion.approvedVersionId,
        approvedSnapshot.approvedVersionId,
        'approvedVersionId mantido intacto'
      );
      assert.strictEqual(updatedNote.approvalStatus, 'approved', 'approvalStatus permanece approved');

      // O histórico de versões aumentou com uma nova entrada teacher_raw
      const latestHistoryEntry = updatedNote.versionHistory[updatedNote.versionHistory.length - 1];
      assert.strictEqual(latestHistoryEntry.type, 'teacher_raw');
      assert.strictEqual(latestHistoryEntry.authorUid, authorizedTeacherUid);
    });

    await test('4.2. Novo rascunho de IA (draft) em elaboração também NÃO despublica versão aprovada', async () => {
      const secondDraftTransformation: PedagogicalLessonTransformation = {
        ...sampleTransformation,
        topic: 'Business English & Extra Review',
      };

      const draft2Res = await makeRequest(
        server,
        'POST',
        `/api/session-notes/${sessionKey}/draft`,
        {
          transformation: secondDraftTransformation,
          customTeacherNotes: 'Elaborando rascunho da v2...',
        },
        { Authorization: 'Bearer token-teacher-auth' }
      );

      assert.strictEqual(draft2Res.status, 200);
      const note = draft2Res.data.sessionNote;

      // O rascunho existe...
      assert.ok(note.draftTransformation, 'draftTransformation presente');
      assert.strictEqual(note.draftTransformation.status, 'draft');

      // E a última versão aprovada para o aluno PERMANECE INTACTA!
      assert.ok(note.lastApprovedVersion, 'lastApprovedVersion PERMANECE INTACTA durante elaboração de draft');
      assert.strictEqual(note.approvalStatus, 'approved');
    });

    // ------------------------------------------------------------------------
    // GRUPO 5: Isolamento de Acesso e Histórico
    // ------------------------------------------------------------------------
    await test('5.1. Aluno só pode consultar histórico de suas próprias notas', async () => {
      const forbiddenRes = await makeRequest(
        server,
        'GET',
        `/api/session-notes/${sessionKey}/versions`,
        undefined,
        { Authorization: 'Bearer token-other-student' }
      );
      assert.strictEqual(forbiddenRes.status, 403);
    });

    await test('5.2. Aluno legítimo recupera histórico completo e ordenado', async () => {
      const historyRes = await makeRequest(
        server,
        'GET',
        `/api/session-notes/${sessionKey}/versions`,
        undefined,
        { Authorization: 'Bearer token-student' }
      );
      assert.strictEqual(historyRes.status, 200);
      assert.strictEqual(historyRes.data.sessionId, sessionKey);
      assert.strictEqual(historyRes.data.studentUid, canonicalStudentUid);
      assert.strictEqual(historyRes.data.teacherUid, authorizedTeacherUid);
      assert.ok(Array.isArray(historyRes.data.versionHistory));
      assert.ok(historyRes.data.versionHistory.length >= 3, 'Histórico acumula versões sucessivas');

      // Verifica monotonicidade
      const numbers = historyRes.data.versionHistory.map((v: any) => v.versionNumber);
      for (let i = 1; i < numbers.length; i++) {
        assert.ok(numbers[i] > numbers[i - 1], 'Números de versão são estritamente crescentes');
      }
    });

  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    resetFirebaseAdminFirestoreForTesting();
  }

  console.log('\n======================================================================');
  console.log(`RESULTADO DA SUÍTE: ${passed} PASSOU / ${failed} FALHOU`);
  console.log('======================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
  process.exit(0);
}

runNFDoc2aTestSuite().catch((err) => {
  console.error('Fatal test error in NF-DOC.2A:', err);
  process.exit(1);
});
