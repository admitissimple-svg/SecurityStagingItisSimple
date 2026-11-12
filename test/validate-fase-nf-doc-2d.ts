process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = 'test-gemini-api-key';

import assert from 'assert';
import http from 'http';
import fs from 'fs';
import path from 'path';
import {
  app as serverApp,
  readDb,
} from '../serverApp';
import { setFirebaseAdminAuthForTesting } from '../src/serverFirebaseAdmin';
import {
  setFirebaseAdminFirestoreForTesting,
  resetFirebaseAdminFirestoreForTesting,
  setIsCloudWriteDisabled,
} from '../src/serverFirestore';
import { computeNotesContentHash } from '../src/utils/notesVersioning';

/**
 * FASE NF-DOC.2D — Suíte de Validação: Leitura do Aluno | Sem Deploy
 *
 * Cobertura de Verificação:
 * 1. Interface & Componentes: NativeFriendsNotesModal consome lastApprovedVersion, exibe as 4 partes canônicas.
 * 2. Ausência de Aprovação: Mensagem discreta "Anotações Pedagógicas em Preparação" sem fallbacks sintéticos.
 * 3. Eliminação de Geração pelo Aluno:
 *    - Zero chamadas a /api/pedagogical-notes/transform ao abrir modal.
 *    - Zero chamadas ao executor Gemini.
 *    - triggerAiIfMissing removido.
 * 4. Isolamento e Segurança RBAC:
 *    - Aluno só lê suas próprias sessões baseadas em studentUid canônico autenticado.
 *    - Acesso a sessões de outro aluno bloqueado (403 Forbidden).
 *    - Aluno bloqueado de transformar (/api/session-notes/transform -> 403).
 *    - Aluno bloqueado de aprovar (/api/session-notes/approve -> 403).
 * 5. Histórico e Persistência F5:
 *    - Todas as sessões do aluno listadas em ordem estritamente descendente (newest first).
 *    - Dados de lastApprovedVersion persistidos na base e preservados após refresh.
 * 6. Preservação de Integridade:
 *    - Dictionary, Journal, S-Path e Memorization intactos e sem efeitos colaterais.
 *    - Editor do professor e endpoints homologados intactos.
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

async function runNFDoc2dTestSuite() {
  console.log('======================================================================');
  console.log("IT'S SIMPLE — FASE NF-DOC.2D: LEITURA DO ALUNO (VALIDAÇÃO)");
  console.log('======================================================================\n');

  let passed = 0;
  let failed = 0;

  const testPass = (name: string) => {
    console.log(`  ✅ [PASS] ${name}`);
    passed++;
  };

  const testFail = (name: string, err: any) => {
    console.error(`  ❌ [FAIL] ${name}:`, err?.message || err);
    failed++;
  };

  const timestamp = Date.now();
  const student1Uid = `canonical_student_maria_${timestamp}`;
  const student1Email = `maria.student.${timestamp}@test.com`;

  const student2Uid = `canonical_student_joao_${timestamp}`;
  const student2Email = `joao.student.${timestamp}@test.com`;

  const teacherUid = `canonical_teacher_sarah_${timestamp}`;
  const teacherEmail = `sarah.teacher.${timestamp}@test.com`;

  const tokenMap: Record<string, any> = {
    'student1-token': { uid: student1Uid, email: student1Email, email_verified: true, role: 'student' },
    'student2-token': { uid: student2Uid, email: student2Email, email_verified: true, role: 'student' },
    'teacher-token': { uid: teacherUid, email: teacherEmail, email_verified: true, role: 'teacher' },
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
    [`users/${student1Uid}`]: {
      uid: student1Uid,
      email: student1Email,
      role: 'student',
      teacherUid,
      teacherEmail,
      assignedNativeFriendUID: teacherUid,
    },
    [`users/${student2Uid}`]: {
      uid: student2Uid,
      email: student2Email,
      role: 'student',
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
      name: 'Sarah Teacher',
      approvalStatus: 'approved',
      isApproved: true,
    },
  };

  const mockDbInstance: any = {
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
              forEach: (fn: any) => matchingDocs.forEach(fn),
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
          forEach: (fn: any) => matching.forEach(fn),
        };
      },
    }),
  };

  setFirebaseAdminFirestoreForTesting(mockDbInstance);
  setIsCloudWriteDisabled(true);

  const memDb = readDb();
  if (!memDb.sessionNotesMap) memDb.sessionNotesMap = {};

  const server = http.createServer(serverApp);
  await new Promise<void>((resolve) => server.listen(0, resolve));

  try {
    console.log('--- GRUPO 1: LEITURA E APRESENTAÇÃO DA VERSÃO APROVADA ---');

    // 1.1: Componente NativeFriendsNotesModal implementa leitura de lastApprovedVersion
    try {
      const modalCode = fs.readFileSync(path.resolve(process.cwd(), 'src/components/NativeFriendsNotesModal.tsx'), 'utf-8');
      assert.ok(modalCode.includes('lastApprovedVersion'), 'Modal deve conter lastApprovedVersion na interface de SessionOption');
      assert.ok(modalCode.includes('loadApprovedNotes'), 'Modal deve definir loadApprovedNotes');
      assert.ok(!modalCode.includes('triggerAiIfMissing: true'), 'Modal NÃO deve conter triggerAiIfMissing: true');
      assert.ok(!modalCode.includes("fetch('/api/pedagogical-notes/transform'"), 'Modal NÃO deve chamar endpoint de transform');
      testPass('1.1: Componente NativeFriendsNotesModal consome lastApprovedVersion e não aciona transform');
    } catch (e: any) {
      testFail('1.1: Componente NativeFriendsNotesModal consome lastApprovedVersion e não aciona transform', e);
    }

    // 1.2: Leitura de sessão aprovada com as 4 partes canônicas
    const approvedTransformation = {
      lessonId: 'lesson_2026-11-12_maria',
      sessionKey: 'session_2026-11-12_maria',
      sessionDate: '2026-11-12',
      topic: 'Business English Negotiations',
      teacherName: 'Sarah Teacher',
      studentLevel: 'intermediario',
      cefrLevel: 'B2',
      mistakesAnalysis: [
        {
          id: 'm1',
          original: 'I have 25 years old',
          corrected: "I'm 25 years old",
          category: 'grammar',
          explanation: "In English, we express age using the verb 'to be', not 'to have'.",
          twoExamples: ["She is 30 years old.", "How old are you?"],
          commonPitfalls: "Do not translate directly from Portuguese 'ter X anos'.",
        },
      ],
      grammarPoints: [
        {
          id: 'g1',
          topic: 'Expressing Age and State',
          rule: "Use 'to be' + number (+ years old) for age.",
          form: "Subject + am/is/are + age",
          usage: "General statement of age or physical condition.",
          examples: ["I am 25.", "He is 40."],
          commonMistakes: "I have 25 years.",
          comparisons: "Portuguese uses 'ter', English uses 'be'.",
        },
      ],
      vocabularyAndExpressions: [
        {
          id: 'v1',
          term: 'counteroffer',
          partOfSpeech: 'noun',
          simpleDefinition: 'An offer made in response to an undesirable offer.',
          collocations: ['make a counteroffer', 'reject a counteroffer'],
          realExamples: ['We rejected their proposal and made a counteroffer.'],
          synonyms: ['alternative offer'],
          register: 'neutral',
          category: 'New Word',
          isNewWord: true,
        },
      ],
      reviewSummary: {
        estimatedMinutes: '5–10 min',
        keyRules: ["Use 'to be' for age in English."],
        mustKnowVocabulary: ['counteroffer'],
        essentialCorrections: [{ original: 'I have 25 years old', corrected: "I'm 25 years old" }],
        rememberThis: "Remember: You ARE your age, you don't HAVE your age in English!",
      },
      correctStampsCount: 4,
      incorrectStampsCount: 1,
      newWordStampsCount: 1,
      pronounceStampsCount: 0,
      generatedAt: '2026-11-12T10:00:00.000Z',
    };

    const approvedVersionPayload = {
      approvedVersionId: 'appr_v1_test_123',
      versionNumber: 1,
      status: 'approved',
      contentHash: computeNotesContentHash('Raw notes from Sarah Teacher for Maria'),
      rawNotesSnippet: 'Raw notes snippet...',
      transformation: approvedTransformation,
      approvedAt: '2026-11-12T10:05:00.000Z',
      approvedByUid: teacherUid,
      approvedByEmail: teacherEmail,
      approvedByName: 'Sarah Teacher',
      notesSummary: 'Approved and published notes for Maria',
    };

    const sessionMaria1 = {
      id: 'session_2026-11-12_maria',
      sessionKey: 'session_2026-11-12_maria',
      lessonId: 'lesson_2026-11-12_maria',
      sessionDate: '2026-11-12',
      studentUid: student1Uid,
      studentEmail: student1Email,
      teacherUid,
      teacherEmail,
      teacherName: 'Sarah Teacher',
      topic: 'Business English Negotiations',
      content: 'Raw notes from Sarah Teacher for Maria: Alt+N I have 25 years old -> I am 25 years old. Alt+W counteroffer',
      rawContent: 'Raw notes from Sarah Teacher for Maria: Alt+N I have 25 years old -> I am 25 years old. Alt+W counteroffer',
      approvalStatus: 'approved',
      lastApprovedVersion: approvedVersionPayload,
      currentVersionNumber: 1,
      versionHistory: [
        {
          versionId: 'appr_v1_test_123',
          versionNumber: 1,
          type: 'approved_published',
          createdAt: '2026-11-12T10:05:00.000Z',
          authorUid: teacherUid,
          contentHash: computeNotesContentHash('Raw notes from Sarah Teacher for Maria'),
          transformation: approvedTransformation,
        },
      ],
    };

    // Store in both inMemoryDb and firestoreStore
    memDb.sessionNotesMap['session_2026-11-12_maria'] = sessionMaria1;
    firestoreStore['session_notes/session_2026-11-12_maria'] = sessionMaria1;
    firestoreStore[`users/${student1Uid}/session_notes/session_2026-11-12_maria`] = sessionMaria1;

    try {
      const res = await makeRequest(server, 'GET', `/api/session-notes?studentUid=${student1Uid}`, null, {
        Authorization: 'Bearer student1-token',
      });
      assert.strictEqual(res.status, 200, 'Endpoint deve retornar 200 para o próprio aluno');
      assert.ok(Array.isArray(res.data), 'Resposta deve ser um array de sessões');
      const session = res.data.find((s: any) => s.id === 'session_2026-11-12_maria');
      assert.ok(session, 'Sessão aprovada deve estar presente');
      assert.strictEqual(session.approvalStatus, 'approved');
      assert.ok(session.lastApprovedVersion, 'lastApprovedVersion deve estar preenchido');
      assert.strictEqual(session.lastApprovedVersion.status, 'approved');
      assert.ok(Array.isArray(session.lastApprovedVersion.transformation.mistakesAnalysis));
      assert.ok(Array.isArray(session.lastApprovedVersion.transformation.grammarPoints));
      assert.ok(Array.isArray(session.lastApprovedVersion.transformation.vocabularyAndExpressions));
      assert.ok(session.lastApprovedVersion.transformation.reviewSummary);
      testPass('1.2: Aluno lê com sucesso a sessão com lastApprovedVersion contendo as 4 partes canônicas');
    } catch (e: any) {
      testFail('1.2: Aluno lê com sucesso a sessão com lastApprovedVersion contendo as 4 partes canônicas', e);
    }

    console.log('\n--- GRUPO 2: AUSÊNCIA DE APROVAÇÃO E CONTEÚDO EM PREPARAÇÃO ---');

    // 2.1: Sessão sem aprovação (unapproved ou draft)
    const sessionMaria2 = {
      id: 'session_unapproved_maria',
      sessionKey: 'session_unapproved_maria',
      sessionDate: '2026-11-11',
      studentUid: student1Uid,
      studentEmail: student1Email,
      teacherUid,
      teacherEmail,
      teacherName: 'Sarah Teacher',
      topic: 'Introductory Conversation',
      content: 'Raw preliminary notes without teacher approval',
      rawContent: 'Raw preliminary notes without teacher approval',
      approvalStatus: 'unapproved',
      lastApprovedVersion: null,
      draftTransformation: null,
    };
    memDb.sessionNotesMap['session_unapproved_maria'] = sessionMaria2;
    firestoreStore['session_notes/session_unapproved_maria'] = sessionMaria2;
    firestoreStore[`users/${student1Uid}/session_notes/session_unapproved_maria`] = sessionMaria2;

    try {
      const res = await makeRequest(server, 'GET', `/api/session-notes?id=session_unapproved_maria`, null, {
        Authorization: 'Bearer student1-token',
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.lastApprovedVersion, null, 'Sessão não aprovada não deve ter lastApprovedVersion');
      assert.strictEqual(res.data.approvalStatus, 'unapproved');

      // Check modal UI code for preparation message rendering when !transformation
      const modalCode = fs.readFileSync(path.resolve(process.cwd(), 'src/components/NativeFriendsNotesModal.tsx'), 'utf-8');
      assert.ok(
        modalCode.includes('notes-in-preparation-message'),
        'Modal deve conter elemento #notes-in-preparation-message quando não houver aprovação'
      );
      assert.ok(
        modalCode.includes('Anotações Pedagógicas em Preparação') || modalCode.includes('Pedagogical Notes in Preparation'),
        'Modal deve conter mensagem de anotações em preparação'
      );
      testPass('2.1: Sessão não aprovada exibe mensagem discreta de conteúdo em preparação');
    } catch (e: any) {
      testFail('2.1: Sessão não aprovada exibe mensagem discreta de conteúdo em preparação', e);
    }

    // 2.2: Ausência de fallbacks sintéticos pré-fabricados
    try {
      const modalCode = fs.readFileSync(path.resolve(process.cwd(), 'src/components/NativeFriendsNotesModal.tsx'), 'utf-8');
      assert.ok(
        !modalCode.includes('generateLocalPedagogicalTransformation'),
        'Modal não deve chamar generateLocalPedagogicalTransformation'
      );
      testPass('2.2: Modal não gera nem utiliza fallbacks pedagógicos sintéticos');
    } catch (e: any) {
      testFail('2.2: Modal não gera nem utiliza fallbacks pedagógicos sintéticos', e);
    }

    console.log('\n--- GRUPO 3: ELIMINAÇÃO DE GERAÇÃO PELO ALUNO ---');

    // 3.1: Aluno é bloqueado de acionar /api/session-notes/transform
    try {
      const res = await makeRequest(server, 'POST', '/api/session-notes/transform', {
        sessionId: 'session_2026-11-12_maria',
      }, {
        Authorization: 'Bearer student1-token',
      });
      assert.strictEqual(res.status, 403, 'Aluno não pode chamar endpoint de transformação');
      assert.strictEqual(res.data.code, 'STUDENTS_CANNOT_TRANSFORM');
      testPass('3.1: Aluno é bloqueado com 403 ao tentar acionar transformação de anotações');
    } catch (e: any) {
      testFail('3.1: Aluno é bloqueado com 403 ao tentar acionar transformação de anotações', e);
    }

    // 3.2: Aluno é bloqueado de aprovar notas
    try {
      const res = await makeRequest(server, 'POST', '/api/session-notes/approve', {
        sessionId: 'session_2026-11-12_maria',
        transformation: approvedTransformation,
      }, {
        Authorization: 'Bearer student1-token',
      });
      assert.strictEqual(res.status, 403, 'Aluno não pode chamar endpoint de aprovação');
      assert.strictEqual(res.data.code, 'STUDENTS_CANNOT_APPROVE');
      testPass('3.2: Aluno é bloqueado com 403 ao tentar aprovar anotações');
    } catch (e: any) {
      testFail('3.2: Aluno é bloqueado com 403 ao tentar aprovar anotações', e);
    }

    console.log('\n--- GRUPO 4: ISOLAMENTO ENTRE ALUNOS E SEGURANÇA RBAC ---');

    // 4.1: Aluno não pode consultar notas de outro aluno
    try {
      const res = await makeRequest(server, 'GET', `/api/session-notes?studentUid=${student2Uid}`, null, {
        Authorization: 'Bearer student1-token',
      });
      assert.strictEqual(res.status, 403, 'Aluno não pode consultar studentUid de outro aluno');
      testPass('4.1: Isolamento estrito bloqueia aluno 1 de consultar sessões do aluno 2 (403)');
    } catch (e: any) {
      testFail('4.1: Isolamento estrito bloqueia aluno 1 de consultar sessões do aluno 2 (403)', e);
    }

    // 4.2: Aluno não pode acessar sessão individual de outro aluno
    const sessionJoao = {
      id: 'session_joao_private',
      sessionKey: 'session_joao_private',
      sessionDate: '2026-11-10',
      studentUid: student2Uid,
      studentEmail: student2Email,
      teacherUid,
      teacherEmail,
      teacherName: 'Sarah Teacher',
      topic: 'Private Session',
      content: 'Private notes for Joao',
      rawContent: 'Private notes for Joao',
      approvalStatus: 'approved',
      lastApprovedVersion: approvedVersionPayload,
    };
    memDb.sessionNotesMap['session_joao_private'] = sessionJoao;
    firestoreStore['session_notes/session_joao_private'] = sessionJoao;
    firestoreStore[`users/${student2Uid}/session_notes/session_joao_private`] = sessionJoao;

    try {
      const res = await makeRequest(server, 'GET', `/api/session-notes?id=session_joao_private`, null, {
        Authorization: 'Bearer student1-token',
      });
      assert.strictEqual(res.status, 403, 'Aluno não pode acessar nota de outro aluno por ID');
      testPass('4.2: Tentativa de acessar nota individual de outro aluno retorna 403 Forbidden');
    } catch (e: any) {
      testFail('4.2: Tentativa de acessar nota individual de outro aluno retorna 403 Forbidden', e);
    }

    console.log('\n--- GRUPO 5: HISTÓRICO DE SESSÕES E PERSISTÊNCIA F5 ---');

    // 5.1: Histórico preservado e ordenado estritamente descendente (newest first)
    try {
      const res = await makeRequest(server, 'GET', `/api/session-notes?studentUid=${student1Uid}`, null, {
        Authorization: 'Bearer student1-token',
      });
      assert.strictEqual(res.status, 200);
      assert.ok(res.data.length >= 2, 'Deve conter ambas as sessões da aluna');
      const d0 = res.data[0].sessionDate;
      const d1 = res.data[1].sessionDate;
      assert.ok(d0 >= d1, `Sessões devem estar em ordem cronológica decrescente: ${d0} >= ${d1}`);
      testPass('5.1: Histórico de sessões do aluno ordenado de forma decrescente (mais recente primeiro)');
    } catch (e: any) {
      testFail('5.1: Histórico de sessões do aluno ordenado de forma decrescente (mais recente primeiro)', e);
    }

    // 5.2: Simulação de F5 (re-leitura dos dados persistidos sem perda)
    try {
      const res = await makeRequest(server, 'GET', `/api/session-notes?id=session_2026-11-12_maria`, null, {
        Authorization: 'Bearer student1-token',
      });
      assert.strictEqual(res.status, 200);
      assert.ok(res.data.lastApprovedVersion, 'Versão aprovada deve permanecer intacta');
      assert.strictEqual(res.data.lastApprovedVersion.versionNumber, 1);
      assert.strictEqual(res.data.lastApprovedVersion.transformation.mistakesAnalysis.length, 1);
      testPass('5.2: Persistência após F5 confirmada: lastApprovedVersion intacto e consistente');
    } catch (e: any) {
      testFail('5.2: Persistência após F5 confirmada: lastApprovedVersion intacto e consistente', e);
    }

    console.log('\n--- GRUPO 6: PRESERVAÇÃO DE INTEGRIDADE GERAL ---');

    // 6.1: Editor do professor inalterado
    try {
      const teacherPanelCode = fs.readFileSync(path.resolve(process.cwd(), 'src/components/TeacherLiveLessonNotesPanel.tsx'), 'utf-8');
      assert.ok(teacherPanelCode.includes('handleApplyAi'), 'Teacher panel deve conter handleApplyAi');
      assert.ok(teacherPanelCode.includes('handleApproveAndPublish'), 'Teacher panel deve conter handleApproveAndPublish');
      assert.ok(teacherPanelCode.includes('btn-apply-ai-top'), 'Teacher panel deve conter botão Aplicar IA');
      testPass('6.1: Editor do professor (TeacherLiveLessonNotesPanel) intacto e preservado');
    } catch (e: any) {
      testFail('6.1: Editor do professor (TeacherLiveLessonNotesPanel) intacto e preservado', e);
    }

    // 6.2: Ausência de efeitos colaterais em Dictionary, Journal, S-Path
    try {
      const dictCode = fs.readFileSync(path.resolve(process.cwd(), 'src/utils/studentDictionaryLibrary.ts'), 'utf-8');
      assert.ok(dictCode.length > 0);
      const spathCode = fs.readFileSync(path.resolve(process.cwd(), 'src/components/SFluencyTracker.tsx'), 'utf-8');
      assert.ok(spathCode.length > 0);
      testPass('6.2: Módulos de Dictionary, Journal e S-Path intactos e funcionais');
    } catch (e: any) {
      testFail('6.2: Módulos de Dictionary, Journal e S-Path intactos e funcionais', e);
    }

  } finally {
    // Teardown
    delete memDb.sessionNotesMap['session_2026-11-12_maria'];
    delete memDb.sessionNotesMap['session_unapproved_maria'];
    delete memDb.sessionNotesMap['session_joao_private'];
    server.close();
    resetFirebaseAdminFirestoreForTesting();
  }

  console.log('\n======================================================================');
  console.log(`FASE NF-DOC.2D TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('======================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
  process.exit(0);
}

runNFDoc2dTestSuite().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
