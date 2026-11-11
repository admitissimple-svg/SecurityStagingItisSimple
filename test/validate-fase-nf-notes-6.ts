process.env.NODE_ENV = 'test';

import assert from 'assert';
import http from 'http';
import { app as serverApp } from '../serverApp';
import { setFirebaseAdminAuthForTesting } from '../src/serverFirebaseAdmin';
import { isValidCanonicalUid } from '../src/utils/studentPersistence';
import { extractRealLessonDateAndTimestamp } from '../src/components/NativeFriendsNotesModal';
import { parseNotesHtml } from '../src/utils/notesHtmlParser';
import { generateLocalPedagogicalTransformation } from '../src/utils/pedagogicalTransformer';

/**
 * FASE NF-NOTES.6 — Test Suite Obrigatória
 * Integridade e Recuperação das Session Notes com Vínculo Pedagógico Canônico.
 * 
 * Caso de referência:
 * Aluno: dofH3QR7IrPJyV7DL9UgGnGeLQF3
 * Native Friend: Charles Lambert (UID canônico)
 * Anotações: 09/11/2026 e 10/11/2026 (sem lessonId obrigatório)
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

async function runTestSuite() {
  console.log('======================================================================');
  console.log('FASE NF-NOTES.6 — SUÍTE DE VALIDAÇÃO: INTEGRIDADE DAS SESSION NOTES');
  console.log('======================================================================\n');

  let passed = 0;
  let failed = 0;

  function test(name: string, fn: () => void | Promise<void>) {
    return Promise.resolve()
      .then(fn)
      .then(() => {
        passed++;
        console.log(`  ✅ [PASS] ${name}`);
      })
      .catch((err) => {
        failed++;
        console.error(`  ❌ [FAIL] ${name}`);
        console.error(`         ${err.message}`);
      });
  }

  const server = http.createServer(serverApp);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  // Canonical reference test constants
  const canonicalStudentUid = 'dofH3QR7IrPJyV7DL9UgGnGeLQF3';
  const canonicalStudentEmail = 'student.dofh3qr7@example.com';

  const charlesLambertUid = 'charles_lambert_auth_uid_1010';
  const charlesLambertEmail = 'charles.lambert@example.com';

  const unauthTeacherUid = 'unauthorized_teacher_uid_9999';
  const unauthTeacherEmail = 'unauth.teacher@example.com';

  const otherStudentUid = 'other_student_canonical_uid_7777';
  const otherStudentEmail = 'other.student@example.com';

  const adminUid = 'admin_canonical_uid_0001';
  const adminEmail = 'admin@example.com';

  const tokenMap: Record<string, any> = {
    'token-student-dof': { uid: canonicalStudentUid, email: canonicalStudentEmail, email_verified: true, role: 'student' },
    'token-other-student': { uid: otherStudentUid, email: otherStudentEmail, email_verified: true, role: 'student' },
    'token-charles-lambert': { uid: charlesLambertUid, email: charlesLambertEmail, email_verified: true, role: 'teacher' },
    'token-unauth-teacher': { uid: unauthTeacherUid, email: unauthTeacherEmail, email_verified: true, role: 'teacher' },
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

  try {
    // ------------------------------------------------------------------------
    // SETUP: Register teachers and student with authorized pedagogical link
    // ------------------------------------------------------------------------
    console.log('--- Setup: Cadastrando professores e aluno com vínculo pedagógico ---');

    // 1. Register and approve Charles Lambert
    await makeRequest(server, 'POST', '/api/tutors', {
      email: charlesLambertEmail,
      name: 'Charles Lambert',
      availableDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
      availableHours: ['09:00', '10:00', '14:00', '15:00'],
      uid: charlesLambertUid,
      approvalStatus: 'approved',
      isApproved: true,
      registeredByAdmin: true,
    }, { Authorization: 'Bearer token-admin' });

    await makeRequest(server, 'POST', `/api/tutors/${charlesLambertUid}/approve`, {}, { Authorization: 'Bearer token-admin' });

    // 2. Register and approve Unauthorized Teacher (with NO link to dofH3QR7IrPJyV7DL9UgGnGeLQF3)
    await makeRequest(server, 'POST', '/api/tutors', {
      email: unauthTeacherEmail,
      name: 'Unauthorized Teacher',
      availableDays: ['monday', 'wednesday'],
      availableHours: ['10:00'],
      uid: unauthTeacherUid,
      approvalStatus: 'approved',
      isApproved: true,
      registeredByAdmin: true,
    }, { Authorization: 'Bearer token-admin' });

    await makeRequest(server, 'POST', `/api/tutors/${unauthTeacherUid}/approve`, {}, { Authorization: 'Bearer token-admin' });

    // 3. Register Student dofH3QR7IrPJyV7DL9UgGnGeLQF3 with pedagogical link to Charles Lambert
    await makeRequest(server, 'POST', '/api/auth/google', {
      uid: canonicalStudentUid,
      email: canonicalStudentEmail,
      name: 'Student Reference dofH3QR7',
      assignedNativeFriendUID: charlesLambertUid,
      teacherUid: charlesLambertUid,
    }, { Authorization: 'Bearer token-student-dof' });

    // Ensure student profile in db has assignedNativeFriendUID
    await makeRequest(server, 'POST', '/api/user/profile', {
      uid: canonicalStudentUid,
      email: canonicalStudentEmail,
      name: 'Student Reference dofH3QR7',
      assignedNativeFriendUID: charlesLambertUid,
      teacherUid: charlesLambertUid,
      level: 'intermediate',
    }, { Authorization: 'Bearer token-student-dof' });

    // 4. Register Other Student (for cross-student isolation tests)
    await makeRequest(server, 'POST', '/api/auth/google', {
      uid: otherStudentUid,
      email: otherStudentEmail,
      name: 'Other Student',
    }, { Authorization: 'Bearer token-other-student' });

    console.log('Setup concluído com sucesso.\n');

    // ------------------------------------------------------------------------
    // TESTE 1: Anotações de 09/11 e 10/11 aparecem no histórico do aluno correto
    // ------------------------------------------------------------------------
    await test('1. Anotações de 09/11 e 10/11 aparecem no histórico do aluno correto', async () => {
      // Charles Lambert grava Session Note em 09/11/2026
      const note09 = await makeRequest(server, 'POST', '/api/session-notes', {
        studentUid: canonicalStudentUid,
        sessionDate: '2026-11-09',
        topic: 'Past simple vs present perfect discussion',
        content: `<div>Session Notes 09/11<br><span data-tag-type="new-word">✦ New Word</span>&nbsp;resilience</div>`,
      }, { Authorization: 'Bearer token-charles-lambert' });

      assert.strictEqual(note09.status, 200, `Gravação da nota de 09/11 deve retornar 200 (retornou ${note09.status})`);
      assert.strictEqual(note09.data.sessionNote?.studentUid, canonicalStudentUid);
      assert.strictEqual(note09.data.sessionNote?.sessionDate, '2026-11-09');

      // Charles Lambert grava Session Note em 10/11/2026
      const note10 = await makeRequest(server, 'POST', '/api/session-notes', {
        studentUid: canonicalStudentUid,
        sessionDate: '2026-11-10',
        topic: 'Advanced idioms and phrasal verbs in professional meetings',
        content: `<div>Session Notes 10/11<br><span data-tag-type="new-word">✦ New Word</span>&nbsp;streamline</div>`,
      }, { Authorization: 'Bearer token-charles-lambert' });

      assert.strictEqual(note10.status, 200, `Gravação da nota de 10/11 deve retornar 200 (retornou ${note10.status})`);
      assert.strictEqual(note10.data.sessionNote?.studentUid, canonicalStudentUid);
      assert.strictEqual(note10.data.sessionNote?.sessionDate, '2026-11-10');

      // Consulta de histórico pelo aluno
      const studentHistory = await makeRequest(
        server,
        'GET',
        `/api/session-notes?studentUid=${canonicalStudentUid}`,
        undefined,
        { Authorization: 'Bearer token-student-dof' }
      );

      assert.strictEqual(studentHistory.status, 200);
      assert(Array.isArray(studentHistory.data), 'Histórico retornado deve ser uma lista');
      assert.strictEqual(studentHistory.data.length, 2, 'Histórico deve conter exatamente as 2 notas registradas');

      const dates = studentHistory.data.map((n: any) => n.sessionDate);
      assert(dates.includes('2026-11-09'), 'Histórico deve conter a anotação de 09/11');
      assert(dates.includes('2026-11-10'), 'Histórico deve conter a anotação de 10/11');
    });

    // ------------------------------------------------------------------------
    // TESTE 2: A anotação de 10/11 é selecionada automaticamente como a mais recente
    // ------------------------------------------------------------------------
    await test('2. A anotação de 10/11 é selecionada automaticamente como a mais recente', async () => {
      const studentHistory = await makeRequest(
        server,
        'GET',
        `/api/session-notes?studentUid=${canonicalStudentUid}`,
        undefined,
        { Authorization: 'Bearer token-student-dof' }
      );

      assert.strictEqual(studentHistory.status, 200);
      const list = studentHistory.data;
      assert(list.length >= 2, 'Lista deve conter ao menos 2 notas');

      // O primeiro item (índice 0) deve ser a mais recente: 10/11/2026
      assert.strictEqual(list[0].sessionDate, '2026-11-10', 'Primeiro item retornado deve ser estritamente o de 10/11');
      assert.strictEqual(list[1].sessionDate, '2026-11-09', 'Segundo item retornado deve ser estritamente o de 09/11');

      // Simulação do comportamento do componente NativeFriendsNotesModal
      const parsedItems = list.map((item: any) => {
        const { timestamp, dateStr } = extractRealLessonDateAndTimestamp({
          sessionDate: item.sessionDate,
          id: item.id,
        });
        return { key: item.id, dateStr, timestamp, rawContent: item.content };
      });

      // Ordenação decrescente idêntica à do modal
      const sortedInModal = parsedItems.sort((a: any, b: any) => {
        const timeA = a.timestamp || 0;
        const timeB = b.timestamp || 0;
        if (timeB !== timeA) return timeB - timeA;
        const dateCmp = (b.dateStr || '').localeCompare(a.dateStr || '');
        if (dateCmp !== 0) return dateCmp;
        return (b.key || '').localeCompare(a.key || '');
      });

      assert.strictEqual(sortedInModal[0].dateStr, '2026-11-10', 'Auto-seleção do modal seleciona 10/11 como item[0]');
    });

    // ------------------------------------------------------------------------
    // TESTE 3: Anotações sem lessonId funcionam normalmente
    // ------------------------------------------------------------------------
    await test('3. Anotações sem lessonId funcionam normalmente', async () => {
      const studentHistory = await makeRequest(
        server,
        'GET',
        `/api/session-notes?studentUid=${canonicalStudentUid}`,
        undefined,
        { Authorization: 'Bearer token-student-dof' }
      );

      const note09 = studentHistory.data.find((n: any) => n.sessionDate === '2026-11-09');
      const note10 = studentHistory.data.find((n: any) => n.sessionDate === '2026-11-10');

      assert(note09, 'Nota de 09/11 deve existir');
      assert(note10, 'Nota de 10/11 deve existir');
      assert(!note09.lessonId || note09.lessonId === '', 'Nota de 09/11 funciona sem lessonId');
      assert(!note10.lessonId || note10.lessonId === '', 'Nota de 10/11 funciona sem lessonId');
      assert(note09.content.includes('resilience'), 'Conteúdo de 09/11 preservado sem lessonId');
      assert(note10.content.includes('streamline'), 'Conteúdo de 10/11 preservado sem lessonId');
    });

    // ------------------------------------------------------------------------
    // TESTE 4: Aluno e professor são identificados pelos UIDs canônicos
    // ------------------------------------------------------------------------
    await test('4. Aluno e professor são identificados pelos UIDs canônicos', async () => {
      // 4.1 Rejeição de studentUid vazio
      const emptyStudentUid = await makeRequest(server, 'POST', '/api/session-notes', {
        studentUid: '',
        sessionDate: '2026-11-10',
        content: 'Some notes',
      }, { Authorization: 'Bearer token-charles-lambert' });

      assert.strictEqual(emptyStudentUid.status, 400, 'studentUid vazio deve retornar 400');
      assert.strictEqual(emptyStudentUid.data.code, 'CANONICAL_STUDENT_UID_REQUIRED');

      // 4.2 Rejeição de studentUid inválido / sintético
      const invalidStudentUid = await makeRequest(server, 'POST', '/api/session-notes', {
        studentUid: 'usr-invalid-synthetic-1234',
        sessionDate: '2026-11-10',
        content: 'Some notes',
      }, { Authorization: 'Bearer token-charles-lambert' });

      assert.strictEqual(invalidStudentUid.status, 400, 'studentUid sintético deve retornar 400');
      assert.strictEqual(invalidStudentUid.data.code, 'CANONICAL_STUDENT_UID_REQUIRED');

      // 4.3 Rejeição quando teacherUid é igual a studentUid
      const selfTeacher = await makeRequest(server, 'POST', '/api/session-notes', {
        studentUid: charlesLambertUid,
        sessionDate: '2026-11-10',
        content: 'Self notes',
      }, { Authorization: 'Bearer token-charles-lambert' });

      assert.strictEqual(selfTeacher.status, 400, 'teacherUid == studentUid deve retornar 400');
      assert.strictEqual(selfTeacher.data.code, 'INVALID_PEDAGOGICAL_IDENTITY');

      // 4.4 UIDs canônicos verificados no payload salvo
      const noteCheck = await makeRequest(
        server,
        'GET',
        `/api/session-notes?studentUid=${canonicalStudentUid}&sessionDate=2026-11-10`,
        undefined,
        { Authorization: 'Bearer token-student-dof' }
      );
      assert.strictEqual(noteCheck.status, 200);
      assert.strictEqual(noteCheck.data?.studentUid, canonicalStudentUid);
      assert.strictEqual(noteCheck.data?.teacherUid, charlesLambertUid);
      assert(isValidCanonicalUid(noteCheck.data?.studentUid), 'studentUid é um UID canônico válido');
      assert(isValidCanonicalUid(noteCheck.data?.teacherUid), 'teacherUid é um UID canônico válido');
    });

    // ------------------------------------------------------------------------
    // TESTE 5: Professor não autorizado recebe HTTP 403
    // ------------------------------------------------------------------------
    await test('5. Professor não autorizado recebe HTTP 403', async () => {
      // Professor não autorizado tenta gravar Session Note para dofH3QR7IrPJyV7DL9UgGnGeLQF3
      const unauthSave = await makeRequest(server, 'POST', '/api/session-notes', {
        studentUid: canonicalStudentUid,
        sessionDate: '2026-11-10',
        topic: 'Illicit coaching attempt',
        content: 'Unauthorized content',
      }, { Authorization: 'Bearer token-unauth-teacher' });

      assert.strictEqual(unauthSave.status, 403, 'Professor sem vínculo deve receber 403 ao tentar salvar nota');
      assert.strictEqual(unauthSave.data.code, 'UNAUTHORIZED_PEDAGOGICAL_LINK');

      // Professor não autorizado tenta consultar Session Notes de dofH3QR7IrPJyV7DL9UgGnGeLQF3
      const unauthRead = await makeRequest(
        server,
        'GET',
        `/api/session-notes?studentUid=${canonicalStudentUid}`,
        undefined,
        { Authorization: 'Bearer token-unauth-teacher' }
      );

      assert.strictEqual(unauthRead.status, 403, 'Professor sem vínculo deve receber 403 ao tentar consultar notas');
      assert.strictEqual(unauthRead.data.code, 'UNAUTHORIZED_PEDAGOGICAL_LINK');
    });

    // ------------------------------------------------------------------------
    // TESTE 6: Registros históricos incompletos não provocam associação indevida
    // ------------------------------------------------------------------------
    await test('6. Registros históricos incompletos não provocam associação indevida', async () => {
      // Injeta diretamente um registro legado incompleto (sem studentUid, ou de outro aluno) no map interno do db
      const { readDb, writeDbSync } = await import('../serverApp');
      const db = readDb();
      if (!db.sessionNotesMap) db.sessionNotesMap = {};

      // Registro com e-mail similar ou genérico mas SEM studentUid
      db.sessionNotesMap['legacy_incomplete_session_1'] = {
        id: 'legacy_incomplete_session_1',
        sessionDate: '2026-04-12',
        studentEmail: canonicalStudentEmail, // E-mail igual, mas studentUid ausente
        studentUid: undefined,
        content: 'Incomplete historical record without canonical UID',
      };

      // Registro de outro aluno com studentUid explícito diferente
      db.sessionNotesMap['other_student_session_1'] = {
        id: 'other_student_session_1',
        sessionDate: '2026-11-05',
        studentEmail: 'other.student@example.com',
        studentUid: otherStudentUid,
        content: 'Confidential other student notes',
      };

      await writeDbSync(db);

      // Consulta de histórico pelo aluno canônico dofH3QR7IrPJyV7DL9UgGnGeLQF3
      const studentHistory = await makeRequest(
        server,
        'GET',
        `/api/session-notes?studentUid=${canonicalStudentUid}`,
        undefined,
        { Authorization: 'Bearer token-student-dof' }
      );

      assert.strictEqual(studentHistory.status, 200);
      const returnedIds = studentHistory.data.map((n: any) => n.id);

      assert(
        !returnedIds.includes('legacy_incomplete_session_1'),
        'Registro legado sem studentUid NÃO deve ser associado indevidamente ao aluno'
      );
      assert(
        !returnedIds.includes('other_student_session_1'),
        'Anotação de outro aluno NÃO deve vazar no histórico deste aluno'
      );
      assert.strictEqual(
        studentHistory.data.length,
        2,
        'Apenas as 2 anotações legítimas do aluno dofH3QR7IrPJyV7DL9UgGnGeLQF3 devem ser retornadas'
      );
    });

    // ------------------------------------------------------------------------
    // TESTE 7: Logout, F5 e troca de computador preservam os resultados
    // ------------------------------------------------------------------------
    await test('7. Logout, F5 e troca de computador preservam os resultados', async () => {
      // Simulação: Sessão do navegador é finalizada (token re-verificado)
      // Nova requisição sem depender de qualquer estado local ou em memória do cliente
      const freshSessionRequest = await makeRequest(
        server,
        'GET',
        `/api/session-notes?studentUid=${canonicalStudentUid}`,
        undefined,
        { Authorization: 'Bearer token-student-dof' }
      );

      assert.strictEqual(freshSessionRequest.status, 200);
      assert.strictEqual(freshSessionRequest.data.length, 2, 'Histórico recuperado idêntico');
      assert.strictEqual(freshSessionRequest.data[0].sessionDate, '2026-11-10', '10/11 é a mais recente');
      assert.strictEqual(freshSessionRequest.data[1].sessionDate, '2026-11-09', '09/11 é a anterior');
      assert(freshSessionRequest.data[0].content.includes('streamline'), 'Conteúdo de 10/11 intacto');
      assert(freshSessionRequest.data[1].content.includes('resilience'), 'Conteúdo de 09/11 intacto');
    });

    // ------------------------------------------------------------------------
    // TESTE 8: Nenhuma regressão nas funcionalidades existentes
    // ------------------------------------------------------------------------
    await test('8. Nenhuma regressão nas funcionalidades existentes (Parser, CEFR e Pedagogical Transformation)', async () => {
      const htmlSample = `
        <div>
          <span class="inline-coaching-tag new-word-tag font-bold" data-tag-type="new-word" contenteditable="false">✦ New Word</span>&nbsp;streamline
          <span class="inline-coaching-tag pronounce-tag font-bold" data-tag-type="pronounce" contenteditable="false">🎯 Pronounce</span>&nbsp;resilience
        </div>
      `;

      const parsed = parseNotesHtml(htmlSample);
      assert.strictEqual(parsed.newWordCount, 1, 'Parser extrai newWordCount');
      assert.strictEqual(parsed.pronounceCount, 1, 'Parser extrai pronounceCount');
      assert.strictEqual(parsed.newWords[0], 'streamline', 'newWord extraído');
      assert.strictEqual(parsed.pronounceItems[0], 'resilience', 'pronounce extraído');

      const transformation = generateLocalPedagogicalTransformation({
        rawNotes: htmlSample,
        topic: 'Professional English',
        sessionDate: '2026-11-10',
        teacherName: 'Charles Lambert',
        studentLevel: 'intermediate',
        studentUid: canonicalStudentUid,
        studentEmail: canonicalStudentEmail,
      });

      assert(transformation, 'Transformação pedagógica gerada com sucesso');
      assert.strictEqual(transformation.sessionDate, '2026-11-10');
      assert.strictEqual(transformation.studentUid, canonicalStudentUid);
      assert.strictEqual(transformation.teacherName, 'Charles Lambert');
      assert.strictEqual(transformation.vocabularyAndExpressions.length, 2);
    });

  } finally {
    server.close();
  }

  console.log('\n======================================================================');
  console.log(`TOTAL: ${passed + failed} | APROVADOS: ${passed} | FALHAS: ${failed}`);
  console.log('======================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
  process.exit(0);
}

runTestSuite().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
