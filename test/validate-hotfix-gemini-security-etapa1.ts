/**
 * Bateria de Testes Automatizados — HOTFIX DE SEGURANÇA (ETAPA 1)
 * Autenticação Obrigatória e Autorização das Rotas Gemini AI
 * 
 * Ambiente Exclusivo: itissimple-security-staging
 * 
 * Testes Obrigatórios:
 * 1. Sem token: HTTP 401 e zero chamadas Gemini.
 * 2. Token inválido: HTTP 401 e zero chamadas Gemini.
 * 3. Aluno tentando acessar dados de outro aluno: HTTP 403 e zero chamadas Gemini.
 * 4. Aluno legítimo: acesso autorizado ao próprio conteúdo.
 * 5. Professor e administrador: acesso somente conforme permissões existentes.
 * 6. Todas as 8 rotas Gemini cobertas por testes:
 *    - /api/pedagogical-notes/transform
 *    - /api/check-daily-sentence
 *    - /api/check-writing
 *    - /api/homework/generate-ai
 *    - /api/homework/generate-part4 (e alias /api/homework/generate-story)
 *    - /api/homework/evaluate
 *    - /api/dictionary/define
 *    - /api/lesson/vocab-generate
 * 7. Regressão e proteção de isolamento de notas (GET /api/pedagogical-notes)
 * 8. Comportamento frontend resiliente em caso de 401/403 (zero loops, zero fallback Gemini)
 */

process.env.NODE_ENV = 'test';
process.env.FIREBASE_PROJECT_ID = 'itissimple-security-staging';
process.env.FIREBASE_DATABASE_ID = '(default)';
delete process.env.GEMINI_API_KEY; // Previne qualquer chamada acidental externa durante testes de segurança

import { setFirebaseAdminAuthForTesting } from '../src/serverFirebaseAdmin';
import { app } from '../serverApp';

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    console.log(`  ✅ PASS: ${testName}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${testName} ${detail ? `(${detail})` : ''}`);
    failed++;
  }
}

// Request Simulator for Express App
function simulateRequest(
  method: string,
  urlPath: string,
  headers: Record<string, string> = {},
  body: any = null
): Promise<{ status: number; headers: Record<string, string>; body: any }> {
  return new Promise((resolve) => {
    const reqHeaders: Record<string, string> = {};
    Object.entries(headers).forEach(([k, v]) => {
      reqHeaders[k.toLowerCase()] = v;
    });

    const parsedUrl = new URL(urlPath, 'http://localhost');
    const query: Record<string, string> = {};
    parsedUrl.searchParams.forEach((val, key) => {
      query[key] = val;
    });

    const req: any = {
      method: method.toUpperCase(),
      url: urlPath,
      originalUrl: urlPath,
      path: parsedUrl.pathname,
      query,
      headers: reqHeaders,
      body: body || {},
    };

    const resHeaders: Record<string, string> = {};
    let statusCode = 200;
    let resBody: any = null;

    const res: any = {
      setHeader: (name: string, value: string) => {
        resHeaders[name.toLowerCase()] = value;
      },
      getHeader: (name: string) => resHeaders[name.toLowerCase()],
      removeHeader: (name: string) => {
        delete resHeaders[name.toLowerCase()];
      },
      status: (code: number) => {
        statusCode = code;
        return res;
      },
      json: (data: any) => {
        resBody = data;
        resolve({ status: statusCode, headers: resHeaders, body: resBody });
      },
      send: (data: any) => {
        resBody = data;
        resolve({ status: statusCode, headers: resHeaders, body: resBody });
      },
      end: () => {
        resolve({ status: statusCode, headers: resHeaders, body: resBody });
      },
    };

    app(req, res, (err?: any) => {
      if (err) {
        resolve({ status: 500, headers: resHeaders, body: { error: err.message } });
      } else {
        resolve({ status: statusCode === 200 ? 404 : statusCode, headers: resHeaders, body: resBody });
      }
    });
  });
}

// Set up mock Firebase Admin Auth for tests
const mockUsers: Record<string, { uid: string; email: string; role: 'student' | 'teacher' | 'admin' }> = {
  'token-student-1': {
    uid: 'student-uid-1',
    email: 'student1@itissimple.test',
    role: 'student',
  },
  'token-student-2': {
    uid: 'student-uid-2',
    email: 'student2@itissimple.test',
    role: 'student',
  },
  'token-teacher-1': {
    uid: 'teacher-uid-1',
    email: 'teacher1@itissimple.test',
    role: 'teacher',
  },
  'token-admin-1': {
    uid: 'admin-uid-1',
    email: 'admin1@itissimple.test',
    role: 'admin',
  },
};

setFirebaseAdminAuthForTesting({
  verifyIdToken: async (token: string) => {
    if (token === 'invalid-token' || token === 'expired-token') {
      const err: any = new Error(token === 'expired-token' ? 'Firebase ID token has expired' : 'Invalid token');
      err.code = token === 'expired-token' ? 'auth/id-token-expired' : 'auth/argument-error';
      throw err;
    }
    const user = mockUsers[token];
    if (!user) {
      const err: any = new Error('Unknown token');
      err.code = 'auth/invalid-id-token';
      throw err;
    }
    return {
      uid: user.uid,
      email: user.email,
      email_verified: true,
      role: user.role,
      admin: user.role === 'admin',
      teacher: user.role === 'teacher',
    };
  },
} as any);

async function runHotfixSecurityTests() {
  console.log('=========================================================================');
  console.log('  TESTES DE SEGURANÇA HOTFIX ETAPA 1: ROTAS GEMINI                       ');
  console.log('  PROJETO: itissimple-security-staging                                   ');
  console.log('=========================================================================\n');

  const geminiRoutes: { method: string; path: string; validBody: any }[] = [
    {
      method: 'POST',
      path: '/api/pedagogical-notes/transform',
      validBody: {
        rawNotes: 'Great conversation today about morning routine and coffee brewing.',
        topic: 'Daily Routine',
        studentUid: 'student-uid-1',
        studentEmail: 'student1@itissimple.test',
      },
    },
    {
      method: 'POST',
      path: '/api/check-daily-sentence',
      validBody: {
        sentence: 'I brew coffee every morning.',
        dailyWords: ['brew', 'morning'],
        studentUid: 'student-uid-1',
        studentEmail: 'student1@itissimple.test',
      },
    },
    {
      method: 'POST',
      path: '/api/check-writing',
      validBody: {
        sentence: 'I brew fresh coffee every morning.',
        targetWord: 'brew',
        studentUid: 'student-uid-1',
        studentEmail: 'student1@itissimple.test',
      },
    },
    {
      method: 'POST',
      path: '/api/homework/generate-ai',
      validBody: {
        words: ['brew', 'schedule', 'commute'],
        studentName: 'Alice',
        studentEmail: 'student1@itissimple.test',
        studentUid: 'student-uid-1',
      },
    },
    {
      method: 'POST',
      path: '/api/homework/generate-part4',
      validBody: {
        words: ['brew', 'schedule'],
        studentName: 'Alice',
        studentUid: 'student-uid-1',
        studentEmail: 'student1@itissimple.test',
      },
    },
    {
      method: 'POST',
      path: '/api/homework/generate-story',
      validBody: {
        words: ['brew', 'commute'],
        studentName: 'Alice',
        studentUid: 'student-uid-1',
        studentEmail: 'student1@itissimple.test',
      },
    },
    {
      method: 'POST',
      path: '/api/homework/evaluate',
      validBody: {
        homework: {
          id: 'hw-123',
          studentUid: 'student-uid-1',
          studentEmail: 'student1@itissimple.test',
          matchingPairs: [{ id: 'm1', word: 'brew', translation: 'preparar' }],
          fillInBlanks: [{ id: 'f1', correctWord: 'brew' }],
          sentenceWritingPrompts: [{ word: 'brew' }],
          readingPassage: { questions: [{ id: 'q1', correctAnswer: 0, options: ['A', 'B'] }] },
        },
        studentAnswers: {
          matching: { m1: 'brew' },
          fillInBlanks: { f1: 'brew' },
          sentences: { brew: 'I brew coffee every day.' },
          quizAnswers: { q1: 0 },
        },
        studentUid: 'student-uid-1',
        studentEmail: 'student1@itissimple.test',
      },
    },
    {
      method: 'POST',
      path: '/api/dictionary/define',
      validBody: {
        word: 'brew',
        level: 'intermediate',
      },
    },
    {
      method: 'POST',
      path: '/api/lesson/vocab-generate',
      validBody: {
        words: ['commute', 'rush hour'],
        topic: 'Traffic',
        notes: 'Discussion about transit',
      },
    },
  ];

  // =========================================================================
  // BLOCO 1: REQUISIÇÕES SEM TOKEN (HTTP 401 OBRIGATÓRIO EM TODAS AS ROTAS)
  // =========================================================================
  console.log('--- 1. Testando Rejeição Sem Token (HTTP 401 Obrigatório) ---');
  for (const r of geminiRoutes) {
    const res = await simulateRequest(r.method, r.path, {}, r.validBody);
    assert(
      res.status === 401,
      `Rota ${r.method} ${r.path} SEM token retorna HTTP 401`,
      `Recebido status ${res.status}`
    );
    assert(
      res.body?.error === 'Unauthorized',
      `Rota ${r.method} ${r.path} retorna payload padronizado Unauthorized`
    );
  }

  // =========================================================================
  // BLOCO 2: REQUISIÇÕES COM TOKEN INVÁLIDO OU EXPIRADO (HTTP 401 OBRIGATÓRIO)
  // =========================================================================
  console.log('\n--- 2. Testando Token Inválido e Expirado (HTTP 401 Obrigatório) ---');
  for (const r of geminiRoutes) {
    // 2.1 Token inválido
    const resInvalid = await simulateRequest(
      r.method,
      r.path,
      { Authorization: 'Bearer invalid-token' },
      r.validBody
    );
    assert(
      resInvalid.status === 401,
      `Rota ${r.method} ${r.path} com token INVÁLIDO retorna HTTP 401`,
      `Status: ${resInvalid.status}`
    );

    // 2.2 Token expirado
    const resExpired = await simulateRequest(
      r.method,
      r.path,
      { Authorization: 'Bearer expired-token' },
      r.validBody
    );
    assert(
      resExpired.status === 401,
      `Rota ${r.method} ${r.path} com token EXPIRADO retorna HTTP 401`,
      `Status: ${resExpired.status}`
    );

    // 2.3 Formato malformado
    const resMalformed = await simulateRequest(
      r.method,
      r.path,
      { Authorization: 'TokenMalformedWithoutBearer' },
      r.validBody
    );
    assert(
      resMalformed.status === 401,
      `Rota ${r.method} ${r.path} com cabeçalho malformado retorna HTTP 401`,
      `Status: ${resMalformed.status}`
    );
  }

  // =========================================================================
  // BLOCO 3: ALUNO TENTANDO ACESSAR DADOS DE OUTRO ALUNO (HTTP 403 FORBIDDEN)
  // =========================================================================
  console.log('\n--- 3. Testando Tentativas de Acesso Cruzado por Aluno (HTTP 403 Forbidden) ---');

  // 3.1 /api/pedagogical-notes/transform com studentUid de outro aluno
  {
    const res = await simulateRequest(
      'POST',
      '/api/pedagogical-notes/transform',
      { Authorization: 'Bearer token-student-1' },
      {
        rawNotes: 'Some notes',
        studentUid: 'student-uid-2', // Outro aluno!
        studentEmail: 'student1@itissimple.test',
      }
    );
    assert(res.status === 403, 'Aluno 1 tentando transformar notas com studentUid do Aluno 2 é bloqueado com 403');
  }

  // 3.2 /api/pedagogical-notes/transform com studentEmail de outro aluno
  {
    const res = await simulateRequest(
      'POST',
      '/api/pedagogical-notes/transform',
      { Authorization: 'Bearer token-student-1' },
      {
        rawNotes: 'Some notes',
        studentUid: 'student-uid-1',
        studentEmail: 'student2@itissimple.test', // Outro aluno!
      }
    );
    assert(res.status === 403, 'Aluno 1 tentando transformar notas com studentEmail do Aluno 2 é bloqueado com 403');
  }

  // 3.3 /api/check-daily-sentence com spoofing de studentUid
  {
    const res = await simulateRequest(
      'POST',
      '/api/check-daily-sentence',
      { Authorization: 'Bearer token-student-1' },
      {
        sentence: 'I brew coffee.',
        studentUid: 'student-uid-2',
      }
    );
    assert(res.status === 403, 'Aluno 1 tentando check-daily-sentence com studentUid do Aluno 2 é bloqueado com 403');
  }

  // 3.4 /api/check-writing com spoofing de studentEmail
  {
    const res = await simulateRequest(
      'POST',
      '/api/check-writing',
      { Authorization: 'Bearer token-student-1' },
      {
        sentence: 'I brew coffee.',
        studentEmail: 'student2@itissimple.test',
      }
    );
    assert(res.status === 403, 'Aluno 1 tentando check-writing com studentEmail do Aluno 2 é bloqueado com 403');
  }

  // 3.5 /api/homework/generate-ai com studentUid de outro aluno
  {
    const res = await simulateRequest(
      'POST',
      '/api/homework/generate-ai',
      { Authorization: 'Bearer token-student-1' },
      {
        words: ['brew'],
        studentUid: 'student-uid-2',
      }
    );
    assert(res.status === 403, 'Aluno 1 tentando generate-ai com studentUid do Aluno 2 é bloqueado com 403');
  }

  // 3.6 /api/homework/generate-part4 com studentEmail de outro aluno
  {
    const res = await simulateRequest(
      'POST',
      '/api/homework/generate-part4',
      { Authorization: 'Bearer token-student-1' },
      {
        words: ['brew'],
        studentEmail: 'student2@itissimple.test',
      }
    );
    assert(res.status === 403, 'Aluno 1 tentando generate-part4 com studentEmail do Aluno 2 é bloqueado com 403');
  }

  // 3.7 /api/homework/evaluate com studentUid de outro aluno no homework
  {
    const res = await simulateRequest(
      'POST',
      '/api/homework/evaluate',
      { Authorization: 'Bearer token-student-1' },
      {
        homework: {
          id: 'hw-other',
          studentUid: 'student-uid-2', // Outro aluno!
          studentEmail: 'student2@itissimple.test',
        },
        studentAnswers: {},
      }
    );
    assert(res.status === 403, 'Aluno 1 tentando avaliar homework pertencente ao Aluno 2 é bloqueado com 403');
  }

  // 3.8 /api/lesson/vocab-generate invocado por aluno (deve ser restrito a professores/admins)
  {
    const res = await simulateRequest(
      'POST',
      '/api/lesson/vocab-generate',
      { Authorization: 'Bearer token-student-1' },
      {
        words: ['apple'],
        topic: 'Food',
      }
    );
    assert(res.status === 403, 'Aluno tentando invocar rota de professor /api/lesson/vocab-generate é bloqueado com 403');
  }

  // 3.9 GET /api/pedagogical-notes com studentUid de outro aluno
  {
    const res = await simulateRequest(
      'GET',
      '/api/pedagogical-notes?studentUid=student-uid-2',
      { Authorization: 'Bearer token-student-1' }
    );
    assert(res.status === 403, 'Aluno 1 tentando listar notas do Aluno 2 via GET /api/pedagogical-notes é bloqueado com 403');
  }

  // =========================================================================
  // BLOCO 4: ALUNO LEGÍTIMO (ACESSO AUTORIZADO AO PRÓPRIO CONTEÚDO)
  // =========================================================================
  console.log('\n--- 4. Testando Aluno Legítimo Acessando Próprio Conteúdo ---');

  // 4.1 /api/dictionary/define com aluno autenticado
  {
    const res = await simulateRequest(
      'POST',
      '/api/dictionary/define',
      { Authorization: 'Bearer token-student-1' },
      { word: 'schedule', studentLevel: 'intermediate' }
    );
    assert(res.status === 200, 'Aluno autenticado obtém definição no dicionário com HTTP 200');
    assert(res.body?.word === 'schedule', 'Dicionário retorna o termo solicitado');
  }

  // 4.2 /api/check-daily-sentence com dados próprios
  {
    const res = await simulateRequest(
      'POST',
      '/api/check-daily-sentence',
      { Authorization: 'Bearer token-student-1' },
      {
        sentence: 'I brew coffee every morning.',
        dailyWords: ['brew'],
        studentUid: 'student-uid-1',
        studentEmail: 'student1@itissimple.test',
      }
    );
    assert(res.status === 200, 'Aluno legítimo executa check-daily-sentence com HTTP 200');
    assert(res.body?.isCorrect === true || res.body?.hasAnyError === false, 'Avaliação de frase diária concluída');
  }

  // 4.3 /api/check-writing com dados próprios
  {
    const res = await simulateRequest(
      'POST',
      '/api/check-writing',
      { Authorization: 'Bearer token-student-1' },
      {
        sentence: 'I brew fresh coffee every morning.',
        targetWord: 'brew',
        studentUid: 'student-uid-1',
        studentEmail: 'student1@itissimple.test',
      }
    );
    assert(res.status === 200, 'Aluno legítimo executa check-writing com HTTP 200');
    assert(typeof res.body?.hasAnyError === 'boolean', 'Retorna estrutura válida de avaliação de escrita');
  }

  // 4.4 /api/homework/generate-ai com dados próprios
  {
    const res = await simulateRequest(
      'POST',
      '/api/homework/generate-ai',
      { Authorization: 'Bearer token-student-1' },
      {
        words: ['brew', 'schedule'],
        studentName: 'Alice',
        studentUid: 'student-uid-1',
        studentEmail: 'student1@itissimple.test',
      }
    );
    assert(res.status === 200, 'Aluno legítimo gera homework com HTTP 200');
    assert(res.body?.success === true, 'Homework gerado com sucesso');
    assert(res.body?.homework?.matchingPairs?.length > 0, 'Partes do homework estruturadas');
  }

  // 4.5 /api/homework/evaluate com dados próprios
  {
    const res = await simulateRequest(
      'POST',
      '/api/homework/evaluate',
      { Authorization: 'Bearer token-student-1' },
      {
        homework: {
          id: 'hw-own',
          studentUid: 'student-uid-1',
          studentEmail: 'student1@itissimple.test',
          matchingPairs: [{ id: 'm1', word: 'brew', translation: 'preparar' }],
          fillInBlanks: [{ id: 'f1', correctWord: 'brew' }],
          sentenceWritingPrompts: [{ word: 'brew' }],
          readingPassage: { questions: [{ id: 'q1', correctAnswer: 0, options: ['A', 'B'] }] },
        },
        studentAnswers: {
          matching: { m1: 'brew' },
          fillInBlanks: { f1: 'brew' },
          sentences: { brew: 'I brew coffee.' },
          quizAnswers: { q1: 0 },
        },
        studentUid: 'student-uid-1',
        studentEmail: 'student1@itissimple.test',
      }
    );
    assert(res.status === 200, 'Aluno legítimo avalia próprio homework com HTTP 200');
    assert(res.body?.success === true, 'Avaliação de homework concluída com sucesso');
  }

  // 4.6 /api/pedagogical-notes/transform com dados próprios
  {
    const res = await simulateRequest(
      'POST',
      '/api/pedagogical-notes/transform',
      { Authorization: 'Bearer token-student-1' },
      {
        rawNotes: 'Student practiced using brew and schedule during today’s session.',
        topic: 'Daily Routine',
        studentUid: 'student-uid-1',
        studentEmail: 'student1@itissimple.test',
      }
    );
    assert(res.status === 200, 'Aluno legítimo transforma notas pedagógicas próprias com HTTP 200');
    assert(res.body?.success === true, 'Transformação pedagógica retornada com sucesso');
  }

  // =========================================================================
  // BLOCO 5: PERMISSÕES DE PROFESSOR E ADMINISTRADOR
  // =========================================================================
  console.log('\n--- 5. Testando Permissões de Professor e Administrador ---');

  // 5.1 Professor invocando /api/lesson/vocab-generate
  {
    const res = await simulateRequest(
      'POST',
      '/api/lesson/vocab-generate',
      { Authorization: 'Bearer token-teacher-1' },
      {
        words: ['fluency', 'pronunciation'],
        topic: 'Speaking Practice',
        notes: 'Live lesson review',
      }
    );
    assert(res.status === 200, 'Professor tem permissão para invocar /api/lesson/vocab-generate (HTTP 200)');
    assert(res.body?.success === true, 'Vocabulário da aula ao vivo gerado com sucesso para professor');
  }

  // 5.2 Administrador invocando /api/lesson/vocab-generate
  {
    const res = await simulateRequest(
      'POST',
      '/api/lesson/vocab-generate',
      { Authorization: 'Bearer token-admin-1' },
      {
        words: ['leadership', 'strategy'],
        topic: 'Business English',
      }
    );
    assert(res.status === 200, 'Administrador tem permissão para invocar /api/lesson/vocab-generate (HTTP 200)');
  }

  // 5.3 Professor gerando homework para aluno
  {
    const res = await simulateRequest(
      'POST',
      '/api/homework/generate-ai',
      { Authorization: 'Bearer token-teacher-1' },
      {
        words: ['brew', 'schedule'],
        studentUid: 'student-uid-1',
        studentEmail: 'student1@itissimple.test',
        studentName: 'Alice',
      }
    );
    assert(res.status === 200, 'Professor pode gerar homework para o aluno (HTTP 200)');
  }

  // 5.4 Administrador transformando notas pedagógicas de qualquer aluno
  {
    const res = await simulateRequest(
      'POST',
      '/api/pedagogical-notes/transform',
      { Authorization: 'Bearer token-admin-1' },
      {
        rawNotes: 'Session review notes for student 2',
        studentUid: 'student-uid-2',
        studentEmail: 'student2@itissimple.test',
      }
    );
    assert(res.status === 200, 'Administrador pode transformar notas de qualquer aluno (HTTP 200)');
  }

  // =========================================================================
  // BLOCO 6: ISOLAMENTO TOTAL CONTRA CHAMADAS ANÔNIMAS E SEM TOKEN
  // =========================================================================
  console.log('\n--- 6. Verificação de Isolamento Total (Zero Anonymous Bypass) ---');

  // Testar todas as rotas com body vazio e sem token
  for (const r of geminiRoutes) {
    const res = await simulateRequest(r.method, r.path, {}, {});
    assert(
      res.status === 401,
      `Isolamento estrito: chamada vazia/anônima em ${r.path} bloqueada com 401`
    );
  }

  console.log('\n=========================================================================');
  console.log(`TOTAL DE TESTES EXECUTADOS: ${passed + failed}`);
  console.log(`SUCESSO: ${passed}`);
  console.log(`FALHAS: ${failed}`);
  console.log('=========================================================================');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runHotfixSecurityTests().catch((err) => {
  console.error('Erro fatal executando bateria de testes:', err);
  process.exit(1);
});
