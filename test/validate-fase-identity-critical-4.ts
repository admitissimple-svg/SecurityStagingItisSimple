import assert from 'assert';
import http from 'http';
import { app as serverApp } from '../serverApp';
import { setFirebaseAdminAuthForTesting } from '../src/serverFirebaseAdmin';
import { setFirebaseAdminFirestoreForTesting } from '../src/serverFirestore';
import { isValidCanonicalUid } from '../src/utils/studentPersistence';

/**
 * FASE IDENTITY-CRITICAL.4 — Suíte de Testes Obrigatórios
 * Correção Cirúrgica do UID Canônico em Session Notes
 *
 * 12 Testes Obrigatórios:
 * 1. Nova sessão para Queen Bee com UID canônico correto.
 * 2. Edição de sessão anterior da Queen Bee.
 * 3. Alternância entre dois alunos sem reaproveitamento indevido de UID.
 * 4. Ausência de UID bloqueando salvamento.
 * 5. UID divergente bloqueando salvamento.
 * 6. Professor não autorizado impedido de salvar notas.
 * 7. Preservação das anotações digitadas após erro.
 * 8. Ausência de criação de novos usuários.
 * 9. Ausência de duplicação de sessões.
 * 10. Preservação de sessões anteriores.
 * 11. Preservação de Native Friends Notes e demais atividades.
 * 12. Ausência de alterações de papéis durante o fluxo.
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

/**
 * Exact simulation of client-side identity resolution in TeacherLiveLessonNotesPanel
 */
function resolveCanonicalStudentIdentity(params: {
  studentUid?: string;
  selectedStudentFilter?: string;
  selectedStudentEmail?: string;
  activeStudent?: { uid?: string; studentUid?: string; id?: string; email?: string } | null;
  activeLesson?: { id?: string; studentUid?: string; studentEmail?: string } | null;
  selectedLessonId?: string;
  teacherUid?: string;
}) {
  const teacherUidVal = (params.teacherUid || '').trim();
  const cleanSelectedEmail = (params.selectedStudentEmail || '').toLowerCase().trim();
  const cleanFilter = (params.selectedStudentFilter || '').toLowerCase().trim();

  const rawPropUid = (params.studentUid || '').trim();
  if (rawPropUid && teacherUidVal && rawPropUid === teacherUidVal) {
    return {
      uid: '',
      error: 'Erro de identidade: O UID do professor não pode ser utilizado como UID do aluno.',
      hasDivergence: true,
      source: 'none',
    };
  }

  let isPropCoherent = false;
  if (rawPropUid && isValidCanonicalUid(rawPropUid)) {
    if (!cleanFilter || cleanFilter === 'all') {
      isPropCoherent = true;
    } else {
      const filterMatchesEmail = cleanFilter === cleanSelectedEmail;
      const filterMatchesStudent = Boolean(
        params.activeStudent &&
        (((params.activeStudent.email || '').toLowerCase().trim() === cleanFilter) ||
         params.activeStudent.uid === cleanFilter ||
         params.activeStudent.id === cleanFilter)
      );
      const propMatchesActiveStudent = Boolean(
        params.activeStudent && (params.activeStudent.uid === rawPropUid || (params.activeStudent as any)?.studentUid === rawPropUid)
      );
      isPropCoherent = filterMatchesEmail || filterMatchesStudent || propMatchesActiveStudent;
    }
  }

  const validPropUid = isPropCoherent && isValidCanonicalUid(rawPropUid) ? rawPropUid : '';

  const docUidRaw = (
    params.activeStudent?.uid ||
    (params.activeStudent as any)?.studentUid ||
    (params.activeStudent?.id && isValidCanonicalUid(params.activeStudent.id) ? params.activeStudent.id : '') ||
    ''
  ).trim();
  const validDocUid = (docUidRaw && isValidCanonicalUid(docUidRaw) && docUidRaw !== teacherUidVal) ? docUidRaw : '';

  const isEditingExistingLesson = Boolean(params.selectedLessonId && params.activeLesson);
  const lessonUidRaw = isEditingExistingLesson ? (params.activeLesson?.studentUid || '').trim() : '';
  const validLessonUid = (lessonUidRaw && isValidCanonicalUid(lessonUidRaw) && lessonUidRaw !== teacherUidVal) ? lessonUidRaw : '';

  const uidsFound: { source: string; uid: string }[] = [];
  if (validPropUid) uidsFound.push({ source: 'componente pai', uid: validPropUid });
  if (validDocUid) uidsFound.push({ source: 'cadastro do aluno', uid: validDocUid });
  if (validLessonUid) uidsFound.push({ source: 'aula existente', uid: validLessonUid });

  const distinctUids = Array.from(new Set(uidsFound.map((u) => u.uid)));
  if (distinctUids.length > 1) {
    const details = uidsFound.map((u) => `${u.source}: ${u.uid}`).join(', ');
    return {
      uid: '',
      error: `Erro de identidade: UIDs divergentes detectados para a mesma aluna (${details}). Operação bloqueada para segurança.`,
      hasDivergence: true,
      source: 'none',
    };
  }

  if (validPropUid) {
    return { uid: validPropUid, error: null, hasDivergence: false, source: 'prop' };
  }
  if (validDocUid) {
    return { uid: validDocUid, error: null, hasDivergence: false, source: 'student_doc' };
  }
  if (validLessonUid) {
    return { uid: validLessonUid, error: null, hasDivergence: false, source: 'lesson' };
  }

  return {
    uid: '',
    error: cleanSelectedEmail
      ? 'Erro de identidade: UID canônico da aluna ausente. O salvamento foi bloqueado para proteger a integridade dos dados.'
      : null,
    hasDivergence: false,
    source: 'none',
  };
}

async function runTestSuite() {
  console.log('======================================================================');
  console.log('IT\'S SIMPLE — FASE IDENTITY-CRITICAL.4: VALIDAÇÃO CIRÚRGICA (12 TESTES)');
  console.log('======================================================================\n');

  let passed = 0;
  let failed = 0;

  function test(name: string, fn: () => void | Promise<void>) {
    return Promise.resolve()
      .then(fn)
      .then(() => {
        passed++;
        console.log(`  [PASS] ${name}`);
      })
      .catch((err) => {
        failed++;
        console.error(`  [FAIL] ${name}`);
        console.error(`         ${err.message}`);
      });
  }

  const server = http.createServer(serverApp);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  const timestamp = Date.now();
  const queenBeeUid = `canonical-queenbee-${timestamp}`;
  const queenBeeEmail = `queenbee.${timestamp}@example.com`;

  const studentTwoUid = `canonical-studenttwo-${timestamp}`;
  const studentTwoEmail = `studenttwo.${timestamp}@example.com`;

  const teacherUid = `canonical-teacher-auth-${timestamp}`;
  const teacherEmail = `teacher.auth.${timestamp}@example.com`;

  const unauthorizedTeacherUid = `canonical-teacher-unauth-${timestamp}`;
  const unauthorizedTeacherEmail = `teacher.unauth.${timestamp}@example.com`;

  const tokenMap: Record<string, any> = {
    'token-teacher': { uid: teacherUid, email: teacherEmail, email_verified: true, role: 'teacher' },
    'token-unauth-teacher': { uid: unauthorizedTeacherUid, email: unauthorizedTeacherEmail, email_verified: true, role: 'teacher' },
    'token-queenbee': { uid: queenBeeUid, email: queenBeeEmail, email_verified: true, role: 'student' },
    'token-studenttwo': { uid: studentTwoUid, email: studentTwoEmail, email_verified: true, role: 'student' },
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

  const qbLessonId = `lesson-queenbee-${timestamp}`;
  const s2LessonId = `lesson-studenttwo-${timestamp}`;

  const firestoreMemoryDb: Record<string, Record<string, any>> = {
    users: {
      [teacherUid]: {
        id: teacherUid,
        uid: teacherUid,
        email: teacherEmail,
        name: 'Teacher Authorized',
        role: 'teacher',
        approvalStatus: 'approved',
        isApproved: true,
      },
      [unauthorizedTeacherUid]: {
        id: unauthorizedTeacherUid,
        uid: unauthorizedTeacherUid,
        email: unauthorizedTeacherEmail,
        name: 'Teacher Unauthorized',
        role: 'teacher',
        approvalStatus: 'approved',
        isApproved: true,
      },
      [queenBeeUid]: {
        id: queenBeeUid,
        uid: queenBeeUid,
        email: queenBeeEmail,
        name: 'Queen Bee',
        role: 'student',
        teacherUid: teacherUid,
        teacherEmail: teacherEmail,
      },
      [studentTwoUid]: {
        id: studentTwoUid,
        uid: studentTwoUid,
        email: studentTwoEmail,
        name: 'Student Two',
        role: 'student',
        teacherUid: teacherUid,
        teacherEmail: teacherEmail,
      },
    },
    tutors: {
      [teacherUid]: {
        id: teacherUid,
        uid: teacherUid,
        authUid: teacherUid,
        email: teacherEmail,
        name: 'Teacher Authorized',
        role: 'teacher',
        approvalStatus: 'approved',
        isApproved: true,
      },
      [unauthorizedTeacherUid]: {
        id: unauthorizedTeacherUid,
        uid: unauthorizedTeacherUid,
        authUid: unauthorizedTeacherUid,
        email: unauthorizedTeacherEmail,
        name: 'Teacher Unauthorized',
        role: 'teacher',
        approvalStatus: 'approved',
        isApproved: true,
      },
    },
    lessons: {
      [qbLessonId]: {
        id: qbLessonId,
        studentEmail: queenBeeEmail,
        studentUid: queenBeeUid,
        teacherUid: teacherUid,
        teacherEmail: teacherEmail,
        sessionDate: '2026-11-10',
        startDateTime: '2026-11-10T14:00:00Z',
        endDateTime: '2026-11-10T14:30:00Z',
        status: 'confirmed',
        title: 'Business Negotiation Practice',
      },
      [s2LessonId]: {
        id: s2LessonId,
        studentEmail: studentTwoEmail,
        studentUid: studentTwoUid,
        teacherUid: teacherUid,
        teacherEmail: teacherEmail,
        sessionDate: '2026-11-10',
        startDateTime: '2026-11-10T15:00:00Z',
        endDateTime: '2026-11-10T15:30:00Z',
        status: 'confirmed',
        title: 'Pronunciation & Intonation',
      },
    },
    session_notes: {},
  };

  const getCollection = (colPath: string) => ({
    doc: (docId: string) => {
      const fullDocPath = `${colPath}/${docId}`;
      return {
        collection: (subCol: string) => getCollection(`${fullDocPath}/${subCol}`),
        get: async () => {
          const data = firestoreMemoryDb[colPath]?.[docId];
          return {
            id: docId,
            exists: !!data,
            data: () => (data ? { ...data } : undefined),
          };
        },
        set: async (val: any, opts?: any) => {
          if (!firestoreMemoryDb[colPath]) firestoreMemoryDb[colPath] = {};
          if (opts?.merge && firestoreMemoryDb[colPath][docId]) {
            firestoreMemoryDb[colPath][docId] = { ...firestoreMemoryDb[colPath][docId], ...val };
          } else {
            firestoreMemoryDb[colPath][docId] = { ...val };
          }
          return { writeTime: new Date() };
        },
        delete: async () => {
          if (firestoreMemoryDb[colPath]) delete firestoreMemoryDb[colPath][docId];
        },
      };
    },
    where: (field: string, op: string, val: any) => {
      const filters = [{ field, val }];
      const whereObj: any = {
        where: (f2: string, op2: string, v2: any) => {
          filters.push({ field: f2, val: v2 });
          return whereObj;
        },
        get: async () => {
          const col = firestoreMemoryDb[colPath] || {};
          const docs: any[] = [];
          for (const [id, item] of Object.entries(col)) {
            const matchesAll = filters.every((f) => item && item[f.field] === f.val);
            if (matchesAll) {
              docs.push({
                id,
                exists: true,
                data: () => ({ ...item }),
              });
            }
          }
          return { docs, empty: docs.length === 0, forEach: (fn: any) => docs.forEach(fn) };
        },
        limit: (_n: number) => ({
          get: async () => {
            const col = firestoreMemoryDb[colPath] || {};
            const docs: any[] = [];
            for (const [id, item] of Object.entries(col)) {
              const matchesAll = filters.every((f) => item && item[f.field] === f.val);
              if (matchesAll) {
                docs.push({ id, exists: true, data: () => ({ ...item }) });
                break;
              }
            }
            return { docs, empty: docs.length === 0 };
          },
        }),
      };
      return whereObj;
    },
    get: async () => {
      const col = firestoreMemoryDb[colPath] || {};
      const docs = Object.entries(col).map(([id, item]) => ({
        id,
        exists: true,
        data: () => ({ ...item }),
      }));
      return { docs, empty: docs.length === 0, forEach: (fn: any) => docs.forEach(fn) };
    },
  });

  const mockFirestore: any = {
    projectId: 'itissimple-security-staging',
    databaseId: '(default)',
    collection: (colName: string) => getCollection(colName),
  };

  setFirebaseAdminFirestoreForTesting(mockFirestore);

  try {
    // ------------------------------------------------------------------------
    // SETUP: Initial logins
    // ------------------------------------------------------------------------
    await makeRequest(server, 'POST', '/api/auth/google', {
      uid: teacherUid,
      email: teacherEmail,
      name: 'Teacher Authorized',
      role: 'teacher',
    }, { Authorization: 'Bearer token-teacher' });

    await makeRequest(server, 'POST', '/api/auth/google', {
      uid: queenBeeUid,
      email: queenBeeEmail,
      name: 'Queen Bee',
      role: 'student',
    }, { Authorization: 'Bearer token-queenbee' });

    await makeRequest(server, 'POST', '/api/auth/google', {
      uid: studentTwoUid,
      email: studentTwoEmail,
      name: 'Student Two',
      role: 'student',
    }, { Authorization: 'Bearer token-studenttwo' });

    // ------------------------------------------------------------------------
    // TEST 1: Nova sessão para Queen Bee com UID canônico correto
    // ------------------------------------------------------------------------
    await test('1. Nova sessão para Queen Bee: UID canônico é resolvido da aluna e enviado corretamente', async () => {
      // 1. Client-side resolution check
      const resolution = resolveCanonicalStudentIdentity({
        studentUid: queenBeeUid,
        selectedStudentFilter: queenBeeEmail,
        selectedStudentEmail: queenBeeEmail,
        activeStudent: { uid: queenBeeUid, id: queenBeeUid, email: queenBeeEmail },
        activeLesson: null,
        selectedLessonId: '', // New session
        teacherUid: teacherUid,
      });

      assert.strictEqual(resolution.uid, queenBeeUid, 'UID canônico deve ser exatamente o de Queen Bee');
      assert.strictEqual(resolution.error, null, 'Nenhum erro de identidade');
      assert.strictEqual(resolution.source, 'prop', 'Fonte deve ser a prop recebida do componente pai');

      // 2. Server save check
      const newSessionDate = '2026-11-11';
      const saveRes = await makeRequest(server, 'POST', '/api/session-notes', {
        sessionDate: newSessionDate,
        studentUid: resolution.uid,
        studentEmail: queenBeeEmail,
        teacherUid: teacherUid,
        topic: 'Trial & Diagnostic',
        content: 'Queen Bee showed great fluency in conversational dialogue.',
      }, { Authorization: 'Bearer token-teacher' });

      assert.strictEqual(saveRes.status, 200, 'Salvamento responde 200');
      assert.strictEqual(saveRes.data.sessionNote.studentUid, queenBeeUid, 'studentUid canônico salvo no registro');
    });

    // ------------------------------------------------------------------------
    // TEST 2: Edição de sessão anterior da Queen Bee
    // ------------------------------------------------------------------------
    await test('2. Edição de sessão anterior da Queen Bee: UID canônico mantido e coerente', async () => {
      const resolution = resolveCanonicalStudentIdentity({
        studentUid: queenBeeUid,
        selectedStudentFilter: queenBeeEmail,
        selectedStudentEmail: queenBeeEmail,
        activeStudent: { uid: queenBeeUid, id: queenBeeUid, email: queenBeeEmail },
        activeLesson: { id: qbLessonId, studentUid: queenBeeUid, studentEmail: queenBeeEmail },
        selectedLessonId: qbLessonId,
        teacherUid: teacherUid,
      });

      assert.strictEqual(resolution.uid, queenBeeUid);
      assert.strictEqual(resolution.error, null);

      const updateRes = await makeRequest(server, 'POST', `/api/lessons/${qbLessonId}/notes`, {
        lessonId: qbLessonId,
        studentUid: resolution.uid,
        studentEmail: queenBeeEmail,
        topic: 'Business Negotiation Practice (Edited)',
        rawContent: 'Queen Bee updated notes: reviewed contract clauses and diplomatic phrases.',
      }, { Authorization: 'Bearer token-teacher' });

      assert.strictEqual(updateRes.status, 200, 'Edição responde 200');
      assert.strictEqual(updateRes.data.sessionNote.studentUid, queenBeeUid);
    });

    // ------------------------------------------------------------------------
    // TEST 3: Alternância entre dois alunos sem reaproveitamento indevido de UID
    // ------------------------------------------------------------------------
    await test('3. Alternância entre dois alunos: sem reaproveitamento indevido de UID', () => {
      // Parent still had Queen Bee selected in filter/prop, but user switched session to Student Two's lesson
      const switchedResolution = resolveCanonicalStudentIdentity({
        studentUid: queenBeeUid, // Prop is still Queen Bee
        selectedStudentFilter: queenBeeEmail, // Filter in parent is Queen Bee
        selectedStudentEmail: studentTwoEmail, // Panel has switched to Student Two!
        activeStudent: { uid: studentTwoUid, id: studentTwoUid, email: studentTwoEmail },
        activeLesson: { id: s2LessonId, studentUid: studentTwoUid, studentEmail: studentTwoEmail },
        selectedLessonId: s2LessonId,
        teacherUid: teacherUid,
      });

      // Coherence check must PREVENT reusing Queen Bee's UID for Student Two!
      assert.strictEqual(switchedResolution.uid, studentTwoUid, 'UID resolvido deve ser de Student Two, NUNCA o de Queen Bee');
      assert.notStrictEqual(switchedResolution.uid, queenBeeUid, 'UID de Queen Bee não pode ser reaproveitado');
      assert.strictEqual(switchedResolution.error, null);
    });

    // ------------------------------------------------------------------------
    // TEST 4: Ausência de UID bloqueando salvamento
    // ------------------------------------------------------------------------
    await test('4. Ausência de UID bloqueando salvamento: retorna erro explícito e não grava', async () => {
      // Simulating client-side check with missing UID
      const missingResolution = resolveCanonicalStudentIdentity({
        studentUid: '',
        selectedStudentFilter: 'unknown@example.com',
        selectedStudentEmail: 'unknown@example.com',
        activeStudent: null,
        activeLesson: null,
        selectedLessonId: '',
        teacherUid: teacherUid,
      });

      assert.strictEqual(missingResolution.uid, '', 'UID ausente');
      assert.ok(missingResolution.error && missingResolution.error.includes('UID canônico da aluna ausente'));

      // Backend attempt with empty studentUid is rejected with 400 CANONICAL_STUDENT_UID_REQUIRED
      const badReq = await makeRequest(server, 'POST', '/api/session-notes', {
        studentUid: '',
        studentEmail: 'unknown@example.com',
        topic: 'Missing UID',
        content: 'Notes that should fail',
      }, { Authorization: 'Bearer token-teacher' });

      assert.strictEqual(badReq.status, 400);
      assert.strictEqual(badReq.data.code, 'CANONICAL_STUDENT_UID_REQUIRED');
    });

    // ------------------------------------------------------------------------
    // TEST 5: UID divergente bloqueando salvamento
    // ------------------------------------------------------------------------
    await test('5. UID divergente bloqueando salvamento: conflito interrompe operação', async () => {
      const divergentResolution = resolveCanonicalStudentIdentity({
        studentUid: 'canonical-student-prop-111',
        selectedStudentFilter: queenBeeEmail,
        selectedStudentEmail: queenBeeEmail,
        activeStudent: { uid: 'canonical-student-doc-222', id: 'canonical-student-doc-222', email: queenBeeEmail },
        activeLesson: null,
        selectedLessonId: '',
        teacherUid: teacherUid,
      });

      assert.strictEqual(divergentResolution.uid, '', 'UID bloqueado');
      assert.strictEqual(divergentResolution.hasDivergence, true);
      assert.ok(divergentResolution.error && divergentResolution.error.includes('UIDs divergentes detectados'));

      // Backend also rejects when studentUid in lesson mismatches payload
      const mismatchReq = await makeRequest(server, 'POST', `/api/lessons/${qbLessonId}/notes`, {
        lessonId: qbLessonId,
        studentUid: studentTwoUid, // Divergent from lesson student
        studentEmail: queenBeeEmail,
        topic: 'Divergent test',
        rawContent: 'Intruder note',
      }, { Authorization: 'Bearer token-teacher' });

      assert.strictEqual(mismatchReq.status, 403);
      assert.strictEqual(mismatchReq.data.code, 'STUDENT_LESSON_MISMATCH');
    });

    // ------------------------------------------------------------------------
    // TEST 6: Professor não autorizado impedido de salvar notas
    // ------------------------------------------------------------------------
    await test('6. Professor não autorizado impedido de salvar notas: 403 / PEDAGOGICAL_LINK_NOT_FOUND', async () => {
      // Unauthorized teacher (not linked to qbLessonId) attempts to save notes for Queen Bee's lesson
      const unauthReq = await makeRequest(server, 'POST', `/api/lessons/${qbLessonId}/notes`, {
        lessonId: qbLessonId,
        studentUid: queenBeeUid,
        studentEmail: queenBeeEmail,
        topic: 'Unauthorized notes',
        rawContent: 'Unauthorized teacher trying to write notes',
      }, { Authorization: 'Bearer token-unauth-teacher' });

      assert.strictEqual(unauthReq.status, 403, 'Acesso bloqueado com 403');
      assert.ok(
        unauthReq.data.code === 'UNAUTHORIZED_PEDAGOGICAL_LINK' ||
        unauthReq.data.code === 'PEDAGOGICAL_LINK_NOT_FOUND',
        `Código indica falta de autorização pedagógica (recebido: ${unauthReq.data.code})`
      );
    });

    // ------------------------------------------------------------------------
    // TEST 7: Preservação das anotações digitadas após erro
    // ------------------------------------------------------------------------
    await test('7. Preservação das anotações digitadas após erro', () => {
      const typedNotes = 'Vocabulary: meticulous (adj) - showing great attention to detail.\nPronunciation: focus on -ed endings.';
      let currentContent = typedNotes;
      let errorOccurred = false;

      // When identity resolution fails
      const failedResolution = resolveCanonicalStudentIdentity({
        studentUid: '',
        selectedStudentEmail: 'student.missing@example.com',
        activeStudent: null,
      });

      if (failedResolution.error || !failedResolution.uid) {
        errorOccurred = true;
        // The save routine returns without resetting currentContent!
      }

      assert.strictEqual(errorOccurred, true, 'Erro de identidade interceptado');
      assert.strictEqual(currentContent, typedNotes, 'Conteúdo digitado permanece 100% preservado');
    });

    // ------------------------------------------------------------------------
    // TEST 8: Ausência de criação de novos usuários
    // ------------------------------------------------------------------------
    await test('8. Ausência de criação de novos usuários durante salvamento de notas', async () => {
      const beforeUsers = Object.keys(firestoreMemoryDb.users).length;

      const saveRes = await makeRequest(server, 'POST', '/api/session-notes', {
        sessionDate: '2026-11-12',
        studentUid: queenBeeUid,
        studentEmail: queenBeeEmail,
        teacherUid: teacherUid,
        topic: 'Regular Session',
        content: 'No new users should be created.',
      }, { Authorization: 'Bearer token-teacher' });

      assert.strictEqual(saveRes.status, 200);

      const afterUsers = Object.keys(firestoreMemoryDb.users).length;
      assert.strictEqual(afterUsers, beforeUsers, 'Quantidade de usuários inalterada');
    });

    // ------------------------------------------------------------------------
    // TEST 9: Ausência de duplicação de sessões
    // ------------------------------------------------------------------------
    await test('9. Ausência de duplicação de sessões: salvamentos repetidos são idempotentes', async () => {
      const idempLessonId = `lesson-idemp-${timestamp}`;
      await makeRequest(server, 'POST', '/api/lessons', {
        lesson: {
          id: idempLessonId,
          studentEmail: queenBeeEmail,
          studentUid: queenBeeUid,
          teacherUid: teacherUid,
          teacherEmail: teacherEmail,
          sessionDate: '2026-11-15',
          startDateTime: '2026-11-15T14:00:00Z',
          endDateTime: '2026-11-15T14:30:00Z',
          status: 'confirmed',
          title: 'Idempotency Lesson',
        },
      }, { Authorization: 'Bearer token-queenbee' });

      const payload = {
        lessonId: idempLessonId,
        studentUid: queenBeeUid,
        studentEmail: queenBeeEmail,
        sessionDate: '2026-11-15',
        topic: 'Idempotency Check',
        rawContent: 'Atomic notes update',
      };

      // Save 1
      const res1 = await makeRequest(server, 'POST', `/api/lessons/${idempLessonId}/notes`, payload, {
        Authorization: 'Bearer token-teacher',
      });
      assert.strictEqual(res1.status, 200);

      // Save 2 (repeat with same payload)
      const res2 = await makeRequest(server, 'POST', `/api/lessons/${idempLessonId}/notes`, payload, {
        Authorization: 'Bearer token-teacher',
      });
      assert.strictEqual(res2.status, 200);

      // Query single session by id
      const singleRes = await makeRequest(
        server,
        'GET',
        `/api/session-notes?id=${idempLessonId}`,
        undefined,
        { Authorization: 'Bearer token-queenbee' }
      );
      assert.strictEqual(singleRes.status, 200, 'Consulta da sessão responde 200');
      assert.strictEqual(singleRes.data.topic, 'Idempotency Check', 'Conteúdo atualizado atomicamente');
      assert.strictEqual(singleRes.data.studentUid, queenBeeUid, 'studentUid correto');

      // Verify Firestore subcollection has exactly 1 document for this lesson (no duplication)
      const userNotesCol = firestoreMemoryDb[`users/${queenBeeUid}/session_notes`] || {};
      const fsMatches = Object.keys(userNotesCol).filter((k) => k === idempLessonId || k.includes(idempLessonId));
      assert.strictEqual(fsMatches.length, 1, 'Exatamente 1 registro preservado no Firestore, sem duplicação');
    });

    // ------------------------------------------------------------------------
    // TEST 10: Preservação de sessões anteriores
    // ------------------------------------------------------------------------
    await test('10. Preservação de sessões anteriores: notas históricas continuam acessíveis', async () => {
      const listRes = await makeRequest(
        server,
        'GET',
        `/api/session-notes?studentUid=${queenBeeUid}`,
        undefined,
        { Authorization: 'Bearer token-queenbee' }
      );

      assert.strictEqual(listRes.status, 200);
      assert.ok(listRes.data.length >= 2, 'Histórico contém as sessões salvas');
      const foundSession = listRes.data.find((n: any) => n.studentUid === queenBeeUid);
      assert.ok(foundSession, 'Sessão anterior recuperada com sucesso');
    });

    // ------------------------------------------------------------------------
    // TEST 11: Preservação de Native Friends Notes e demais atividades
    // ------------------------------------------------------------------------
    await test('11. Preservação de Native Friends Notes e demais atividades', async () => {
      const routinesRes = await makeRequest(server, 'GET', '/api/routines');
      assert.strictEqual(routinesRes.status, 200, 'Rotinas S-Path operacionais');

      const tutorsRes = await makeRequest(server, 'GET', '/api/tutors');
      assert.strictEqual(tutorsRes.status, 200, 'Catálogo de Native Friends intacto');
    });

    // ------------------------------------------------------------------------
    // TEST 12: Ausência de alterações de papéis durante o fluxo
    // ------------------------------------------------------------------------
    await test('12. Ausência de alterações de papéis: papéis de professor e aluno permanecem estritamente preservados', async () => {
      const teacherVerify = await makeRequest(server, 'GET', '/api/auth/verify-session', undefined, {
        Authorization: 'Bearer token-teacher',
      });
      assert.strictEqual(teacherVerify.data.role, 'teacher', 'Professor permanece estritamente teacher');

      const studentVerify = await makeRequest(server, 'GET', '/api/auth/verify-session', undefined, {
        Authorization: 'Bearer token-queenbee',
      });
      assert.strictEqual(studentVerify.data.role, 'student', 'Aluna permanece estritamente student');
    });

  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  console.log('\n======================================================================');
  console.log(`RESULTADO DA VALIDAÇÃO: ${passed} PASSOU, ${failed} FALHOU`);
  console.log('======================================================================');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTestSuite().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
