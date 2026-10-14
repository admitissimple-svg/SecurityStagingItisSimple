/**
 * BATERIA DE TESTES DE INTEGRAÇÃO E SEGURANÇA
 * HOTFIX CONTROLADO — GET /api/lessons & DISPONIBILIDADE DE HORÁRIOS
 * Projeto Exclusivo: itissimple-security-staging (default)
 *
 * Verificações Obrigatórias:
 * 1. serverApp.ts: remoção do import duplicado de getFirestoreDb na linha 5 e preservação na linha 79.
 * 2. src/App.tsx e LiveLessonScheduleModal.tsx: envio de Firebase ID Token no header Authorization: Bearer,
 *    uso de apiClient e tratamento explícito de erros 401, 403 e 500 sem conversão silenciosa em [].
 * 3. Identificação do papel de Native Friend no backend via cadastro confiável no Firestore e vínculo
 *    ao Firebase Auth UID. Sem privilégios administrativos automáticos e sem confiar em query/body.
 * 4. GET /api/lessons: Lala autenticada consulta sua aula com Skull Bee.
 * 5. GET /api/lessons: Skull Bee autenticada consulta a mesma aula como professora.
 * 6. Isolamento estrito: outro estudante autenticado NÃO acessa dados ou aulas de Lala.
 * 7. Endpoint seguro de disponibilidade (/api/teachers/:teacherId/busy-slots e /api/lessons/busy-slots):
 *    retorna exclusivamente intervalos ocupados (startDateTime e endDateTime), com ZERO PII de outros estudantes.
 * 8. Consultas filtradas: sem varredura irrestrita de toda a coleção lessons.
 * 9. Rejeição com 401 para requisições não autenticadas ou com token inválido.
 */

process.env.NODE_ENV = 'test';
process.env.FIREBASE_PROJECT_ID = 'itissimple-security-staging';
process.env.FIREBASE_DATABASE_ID = '(default)';

import fs from 'fs';
import path from 'path';
import { setFirebaseAdminAuthForTesting } from '../src/serverFirebaseAdmin';
import {
  setFirebaseAdminFirestoreForTesting,
  getFirestoreDb,
} from '../src/serverFirestore';
import { firebaseAuthMiddleware } from '../src/middleware/firebaseAuth';

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

// Mock Firestore storage with query tracking
class MockFirestoreCollection {
  public docs: Map<string, any> = new Map();
  public subcollections: Map<string, Map<string, MockFirestoreCollection>> = new Map();
  public static totalUnrestrictedCollectionGets = 0;
  public static totalFilteredWhereGets = 0;

  constructor(public collectionPath: string) {}

  doc(id: string) {
    const self = this;
    return {
      id,
      path: `${self.collectionPath}/${id}`,
      get: async () => {
        const data = self.docs.get(id);
        return {
          exists: Boolean(data),
          id,
          data: () => (data ? JSON.parse(JSON.stringify(data)) : undefined),
        };
      },
      set: async (data: any, options?: { merge?: boolean }) => {
        const existing = self.docs.get(id) || {};
        const merged = options?.merge ? { ...existing, ...data } : data;
        self.docs.set(id, JSON.parse(JSON.stringify(merged)));
        return { writeTime: new Date() };
      },
      collection: (subName: string) => {
        if (!self.subcollections.has(id)) {
          self.subcollections.set(id, new Map());
        }
        const docSubs = self.subcollections.get(id)!;
        if (!docSubs.has(subName)) {
          docSubs.set(subName, new MockFirestoreCollection(`${self.collectionPath}/${id}/${subName}`));
        }
        return docSubs.get(subName)!;
      },
    };
  }

  where(field: string, op: string, value: any) {
    const self = this;
    MockFirestoreCollection.totalFilteredWhereGets++;
    return {
      limit: (n: number) => ({
        get: async () => {
          const matched: any[] = [];
          for (const [id, data] of self.docs.entries()) {
            if (op === '==' && data[field] === value) {
              matched.push({ id, data: () => JSON.parse(JSON.stringify(data)), exists: true });
              if (matched.length >= n) break;
            }
          }
          return {
            empty: matched.length === 0,
            docs: matched,
            forEach: (cb: (d: any) => void) => matched.forEach(cb),
          };
        },
      }),
      get: async () => {
        const matched: any[] = [];
        for (const [id, data] of self.docs.entries()) {
          if (op === '==' && data[field] === value) {
            matched.push({ id, data: () => JSON.parse(JSON.stringify(data)), exists: true });
          }
        }
        return {
          empty: matched.length === 0,
          docs: matched,
          forEach: (cb: (d: any) => void) => matched.forEach(cb),
        };
      },
    };
  }

  async get() {
    if (this.collectionPath === 'lessons') {
      MockFirestoreCollection.totalUnrestrictedCollectionGets++;
    }
    const matched: any[] = [];
    for (const [id, data] of this.docs.entries()) {
      matched.push({ id, data: () => JSON.parse(JSON.stringify(data)), exists: true });
    }
    return {
      empty: matched.length === 0,
      docs: matched,
      forEach: (cb: (d: any) => void) => matched.forEach(cb),
    };
  }
}

class MockFirestoreDb {
  private collections: Map<string, MockFirestoreCollection> = new Map();

  collection(name: string): MockFirestoreCollection {
    if (!this.collections.has(name)) {
      this.collections.set(name, new MockFirestoreCollection(name));
    }
    return this.collections.get(name)!;
  }
}

async function runHotfixGetLessonsTests() {
  console.log('===========================================================================');
  console.log(" IT'S SIMPLE — HOTFIX: GET /api/lessons, ROLES & DISPONIBILIDADE SEGURO    ");
  console.log(' Projeto Exclusivo: itissimple-security-staging (default)                  ');
  console.log('===========================================================================\n');

  // --------------------------------------------------------------------------
  console.log('--- 1. Auditoria Estática dos Arquivos Modificados ---');
  // --------------------------------------------------------------------------
  const serverAppContent = fs.readFileSync(path.join(process.cwd(), 'serverApp.ts'), 'utf-8');
  const serverAppLines = serverAppContent.split('\n');

  // Verifica que não há getFirestoreDb importado na linha 5
  const line5 = serverAppLines[4] || '';
  assert(
    !line5.includes('getFirestoreDb'),
    'serverApp.ts: linha 5 NÃO possui import duplicado de getFirestoreDb'
  );

  // Verifica que o import no bloco de serverFirestore existe
  const hasServerFirestoreImportBlock = serverAppContent.includes("from './src/serverFirestore'") &&
    serverAppContent.includes('getFirestoreDb,');
  assert(
    hasServerFirestoreImportBlock,
    'serverApp.ts: getFirestoreDb é importado corretamente no bloco unificado de serverFirestore'
  );

  // Verifica que src/App.tsx usa apiClient e trata erros
  const appContent = fs.readFileSync(path.join(process.cwd(), 'src/App.tsx'), 'utf-8');
  assert(
    appContent.includes("apiClient.get<LiveLesson[]>('/api/lessons')"),
    'src/App.tsx: consome /api/lessons via apiClient.get com Bearer Token'
  );
  assert(
    !appContent.includes("fetch(`/api/lessons?${queryParams}`).then((r) => (r.ok ? r.json() : [])).catch(() => [])"),
    'src/App.tsx: queryParams inseguros e conversão silenciosa em [] foram removidos'
  );
  assert(
    appContent.includes('api-err-401') && appContent.includes('api-err-403') && appContent.includes('api-err-500'),
    'src/App.tsx: tratamento explícito de respostas 401, 403 e 500 com notificações ao usuário'
  );

  // Verifica que LiveLessonScheduleModal.tsx consome busy-slots sem PII
  const modalContent = fs.readFileSync(path.join(process.cwd(), 'src/components/LiveLessonScheduleModal.tsx'), 'utf-8');
  assert(
    modalContent.includes('busy-slots'),
    'LiveLessonScheduleModal.tsx: consome endpoint seguro de intervalos ocupados (busy-slots)'
  );
  assert(
    !modalContent.includes("fetch(`/api/lessons?teacherEmail=${encodeURIComponent(cleanTeacherEmail)}&role=teacher`)"),
    'LiveLessonScheduleModal.tsx: não requisita mais a lista inteira de aulas de outros alunos com dados sensíveis'
  );

  // --------------------------------------------------------------------------
  console.log('\n--- 2. Preparação de Dados Confiáveis no Firestore Staging ---');
  // --------------------------------------------------------------------------
  const mockDb = new MockFirestoreDb();
  setFirebaseAdminFirestoreForTesting(mockDb as any);

  // Setup Mock Firebase Admin Auth
  const tokensDb = new Map<string, any>();

  // Token de Lala (Student)
  tokensDb.set('token_lala_student_123', {
    uid: 'uid_lala_student_123',
    email: 'lavistorekids@gmail.com',
    email_verified: true,
    role: 'student',
  });

  // Token de Skull Bee (Teacher / Native Friend)
  tokensDb.set('token_skullbee_teacher_456', {
    uid: 'uid_skullbee_teacher_456',
    email: 'laviniafofafc@gmail.com',
    email_verified: true,
    role: 'student', // Custom claim not set in auth token, verified via Firestore!
  });

  // Token de Outro Aluno (Other Student)
  tokensDb.set('token_other_student_999', {
    uid: 'uid_other_student_999',
    email: 'otherstudent@gmail.com',
    email_verified: true,
    role: 'student',
  });

  // Token de Admin
  tokensDb.set('token_admin_777', {
    uid: 'uid_admin_777',
    email: 'adm.itissimple@gmail.com',
    email_verified: true,
    role: 'admin',
    admin: true,
  });

  setFirebaseAdminAuthForTesting({
    verifyIdToken: async (token: string) => {
      const decoded = tokensDb.get(token);
      if (!decoded) {
        throw new Error('auth/argument-error: Firebase ID token is invalid');
      }
      return decoded;
    },
  } as any);

  // Cadastro de Skull Bee no Firestore:
  // /users/uid_skullbee_teacher_456
  const skullBeeUserDoc = {
    id: 'uid_skullbee_teacher_456',
    uid: 'uid_skullbee_teacher_456',
    authUid: 'uid_skullbee_teacher_456',
    publicTutorId: 'skull-bee',
    name: 'Skull Bee (Amiga Nativa)',
    email: 'laviniafofafc@gmail.com',
    role: 'teacher',
    isTeacher: true,
    isApproved: true,
    approvalStatus: 'approved',
    bio: 'Conversational Native Friend.',
    meetUrl: 'https://meet.google.com/skb-live-room',
  };
  await mockDb.collection('users').doc('uid_skullbee_teacher_456').set(skullBeeUserDoc);

  // /tutors/skull-bee
  await mockDb.collection('tutors').doc('skull-bee').set(skullBeeUserDoc);

  // Cadastro de Lala no Firestore:
  const lalaUserDoc = {
    id: 'uid_lala_student_123',
    uid: 'uid_lala_student_123',
    name: 'Lala',
    email: 'lavistorekids@gmail.com',
    role: 'student',
  };
  await mockDb.collection('users').doc('uid_lala_student_123').set(lalaUserDoc);

  // Cadastro de Outro Aluno:
  const otherUserDoc = {
    id: 'uid_other_student_999',
    uid: 'uid_other_student_999',
    name: 'Other Student',
    email: 'otherstudent@gmail.com',
    role: 'student',
  };
  await mockDb.collection('users').doc('uid_other_student_999').set(otherUserDoc);

  // Aula Canônica de Lala com Skull Bee (persistida em /lessons):
  const lalaLessonId = 'lesson_lala_skullbee_001';
  const lalaLessonDoc = {
    id: lalaLessonId,
    title: 'Aula Experimental Ao Vivo',
    startDateTime: '2026-10-20T14:00:00.000Z',
    endDateTime: '2026-10-20T14:25:00.000Z',
    studentUid: 'uid_lala_student_123',
    studentEmail: 'lavistorekids@gmail.com',
    studentName: 'Lala',
    teacherUid: 'skull-bee',
    teacherEmail: 'laviniafofafc@gmail.com',
    teacherName: 'Skull Bee',
    meetLink: 'https://meet.google.com/skb-live-room',
    status: 'scheduled',
    isTrialLesson: true,
  };
  await mockDb.collection('lessons').doc(lalaLessonId).set(lalaLessonDoc);

  // Aula de OUTRO aluno com Skull Bee:
  const otherLessonId = 'lesson_other_skullbee_002';
  const otherLessonDoc = {
    id: otherLessonId,
    title: 'Aula Regular 1-on-1',
    startDateTime: '2026-10-20T16:00:00.000Z',
    endDateTime: '2026-10-20T16:50:00.000Z',
    studentUid: 'uid_other_student_999',
    studentEmail: 'otherstudent@gmail.com',
    studentName: 'Private Student X',
    teacherUid: 'skull-bee',
    teacherEmail: 'laviniafofafc@gmail.com',
    teacherName: 'Skull Bee',
    meetLink: 'https://meet.google.com/private-secret-meet-link',
    status: 'scheduled',
    isTrialLesson: false,
  };
  await mockDb.collection('lessons').doc(otherLessonId).set(otherLessonDoc);

  // Import app express routes from serverApp.ts
  const { app } = await import('../serverApp');

  // Helper para simular requisições HTTP locais contra o app Express
  async function simulateRequest(
    method: string,
    url: string,
    headers: Record<string, string> = {}
  ): Promise<{ status: number; body: any }> {
    return new Promise((resolve) => {
      const [pathOnly, queryString] = url.split('?');
      const query: Record<string, string> = {};
      if (queryString) {
        new URLSearchParams(queryString).forEach((v, k) => {
          query[k] = v;
        });
      }

      const reqHeaders: Record<string, string> = {};
      Object.entries(headers).forEach(([k, v]) => {
        reqHeaders[k.toLowerCase()] = v;
      });

      const req: any = {
        method: method.toUpperCase(),
        url,
        originalUrl: url,
        path: pathOnly,
        query,
        headers: reqHeaders,
        body: {},
      };

      let statusCode = 200;
      let responseBody: any = null;
      const resHeaders: Record<string, string> = {};

      const res: any = {
        _headerNames: {},
        _headers: {},
        setHeader: (name: string, value: string) => {
          resHeaders[name.toLowerCase()] = value;
          return res;
        },
        getHeader: (n: string) => resHeaders[n.toLowerCase()],
        removeHeader: (name: string) => {
          delete resHeaders[name.toLowerCase()];
          return res;
        },
        status: (code: number) => {
          statusCode = code;
          return res;
        },
        json: (data: any) => {
          responseBody = data;
          resolve({ status: statusCode, body: responseBody });
          return res;
        },
        send: (data: any) => {
          responseBody = data;
          resolve({ status: statusCode, body: responseBody });
          return res;
        },
      };

      app(req, res, (err: any) => {
        if (err) {
          resolve({ status: 500, body: { error: err.message } });
        } else {
          resolve({ status: 404, body: { error: 'Route not found' } });
        }
      });
    });
  }

  // --------------------------------------------------------------------------
  console.log('\n--- 3. Validação: Lala Consulta sua Aula Agendada com Skull Bee ---');
  // --------------------------------------------------------------------------
  const lalaResponse = await simulateRequest('GET', '/api/lessons', {
    authorization: 'Bearer token_lala_student_123',
  });

  assert(lalaResponse.status === 200, 'Lala recebe status 200 de GET /api/lessons');
  assert(Array.isArray(lalaResponse.body), 'Resposta de GET /api/lessons é um array');
  assert(lalaResponse.body.length === 1, 'Lala recebe exatamente 1 aula (sua própria aula)');
  assert(
    lalaResponse.body[0]?.id === lalaLessonId,
    'Aula retornada para Lala é a aula lala_skullbee_001'
  );
  assert(
    lalaResponse.body[0]?.teacherName === 'Skull Bee',
    'Aula vinculada com sucesso à professora Skull Bee'
  );

  // --------------------------------------------------------------------------
  console.log('\n--- 4. Validação: Skull Bee Consulta a Mesma Aula como Professora ---');
  // --------------------------------------------------------------------------
  const skullBeeResponse = await simulateRequest('GET', '/api/lessons', {
    authorization: 'Bearer token_skullbee_teacher_456',
  });

  assert(skullBeeResponse.status === 200, 'Skull Bee recebe status 200 de GET /api/lessons');
  assert(Array.isArray(skullBeeResponse.body), 'Resposta de Skull Bee é um array');
  // Skull Bee tem 2 aulas (com Lala e com Other Student)
  assert(skullBeeResponse.body.length === 2, 'Skull Bee consulta suas 2 aulas como professora');
  const skullBeeLessonIds = skullBeeResponse.body.map((l: any) => l.id);
  assert(
    skullBeeLessonIds.includes(lalaLessonId),
    'Skull Bee consulta com sucesso a aula agendada com Lala'
  );
  assert(
    skullBeeLessonIds.includes(otherLessonId),
    'Skull Bee consulta com sucesso a aula agendada com Other Student'
  );

  // --------------------------------------------------------------------------
  console.log('\n--- 5. Validação: Isolamento — Outro Estudante NÃO Acessa Dados de Lala ---');
  // --------------------------------------------------------------------------
  const otherStudentResponse = await simulateRequest('GET', '/api/lessons', {
    authorization: 'Bearer token_other_student_999',
  });

  assert(otherStudentResponse.status === 200, 'Outro estudante recebe status 200');
  assert(otherStudentResponse.body.length === 1, 'Outro estudante recebe apenas sua própria aula');
  assert(
    otherStudentResponse.body[0]?.id === otherLessonId,
    'Outro estudante consulta exclusivamente sua aula'
  );
  assert(
    !otherStudentResponse.body.some((l: any) => l.id === lalaLessonId),
    'Outro estudante NÃO TEM ACESSO à aula de Lala'
  );
  assert(
    !otherStudentResponse.body.some((l: any) => (l.studentEmail || '').includes('lavistorekids')),
    'Outro estudante NÃO RECEBE nenhum e-mail ou PII de Lala'
  );

  // Tentativa de outro estudante forjar parâmetros na query (?email=lavistorekids@gmail.com&role=teacher)
  const spoofAttemptResponse = await simulateRequest(
    'GET',
    '/api/lessons?email=lavistorekids%40gmail.com&role=admin&uid=uid_lala_student_123',
    {
      authorization: 'Bearer token_other_student_999',
    }
  );
  assert(
    !spoofAttemptResponse.body.some((l: any) => l.id === lalaLessonId),
    'Tentativa de spoofing via URL params (?email, ?role, ?uid) é 100% BLOQUEADA'
  );

  // --------------------------------------------------------------------------
  console.log('\n--- 6. Validação: Consulta Segura de Disponibilidade (Zero PII) ---');
  // --------------------------------------------------------------------------
  // Lala consulta horários indisponíveis de Skull Bee via endpoint seguro
  const busySlotsResponse = await simulateRequest(
    'GET',
    '/api/teachers/skull-bee/busy-slots?teacherEmail=laviniafofafc%40gmail.com'
  );

  assert(busySlotsResponse.status === 200, 'Endpoint busy-slots retorna status 200');
  assert(Array.isArray(busySlotsResponse.body), 'Resposta de busy-slots é um array');
  assert(busySlotsResponse.body.length === 2, 'Retorna os 2 intervalos ocupados de Skull Bee');

  // Validação estrita de isolamento de PII:
  for (let i = 0; i < busySlotsResponse.body.length; i++) {
    const slot = busySlotsResponse.body[i];
    assert(
      Boolean(slot.startDateTime) && Boolean(slot.endDateTime),
      `Intervalo #${i + 1} contém startDateTime e endDateTime válidos`
    );
    assert(
      slot.studentName === undefined,
      `Intervalo #${i + 1} NÃO contém studentName`
    );
    assert(
      slot.studentEmail === undefined,
      `Intervalo #${i + 1} NÃO contém studentEmail`
    );
    assert(
      slot.studentUid === undefined,
      `Intervalo #${i + 1} NÃO contém studentUid`
    );
    assert(
      slot.meetLink === undefined,
      `Intervalo #${i + 1} NÃO contém meetLink`
    );
    assert(
      slot.id === undefined,
      `Intervalo #${i + 1} NÃO contém id da aula`
    );
    assert(
      slot.title === undefined,
      `Intervalo #${i + 1} NÃO contém título da aula`
    );
  }

  // Teste de rota alternativa /api/lessons/busy-slots
  const busySlotsAltResponse = await simulateRequest(
    'GET',
    '/api/lessons/busy-slots?teacherId=skull-bee'
  );
  assert(busySlotsAltResponse.status === 200, 'Rota alternativa /api/lessons/busy-slots responde 200');
  assert(busySlotsAltResponse.body.length === 2, 'Rota alternativa retorna exatamente os 2 intervalos');

  // --------------------------------------------------------------------------
  console.log('\n--- 7. Validação: Tratamento de Respostas 401, 403 e 500 ---');
  // --------------------------------------------------------------------------
  // 7.1 Sem cabeçalho Authorization -> 401
  const unauthResponse = await simulateRequest('GET', '/api/lessons');
  assert(unauthResponse.status === 401, 'Requisição sem token é rejeitada com 401');
  assert(
    unauthResponse.body?.error === 'Unauthorized' || unauthResponse.body?.error === 'Authentication required',
    'Corpo de resposta 401 contém mensagem explicativa'
  );

  // 7.2 Com token forjado / inválido -> 401
  const forgedTokenResponse = await simulateRequest('GET', '/api/lessons', {
    authorization: 'Bearer forger_fake_token_xyz',
  });
  assert(forgedTokenResponse.status === 401, 'Requisição com token inválido/forjado rejeitada com 401');

  // 7.3 Verificação de falha 500 quando Firestore lança erro
  const failingDb = {
    collection: () => {
      throw new Error('Simulated database offline');
    },
  };
  setFirebaseAdminFirestoreForTesting(failingDb as any);
  const error500Response = await simulateRequest('GET', '/api/lessons', {
    authorization: 'Bearer token_lala_student_123',
  });
  assert(
    error500Response.status === 500,
    'Erro de infraestrutura do Firestore retorna status 500'
  );
  // Restaura banco
  setFirebaseAdminFirestoreForTesting(mockDb as any);

  // --------------------------------------------------------------------------
  console.log('\n--- 8. Validação: Consultas Filtradas (Sem Varredura Irrestrita) ---');
  // --------------------------------------------------------------------------
  const prevUnrestricted = MockFirestoreCollection.totalUnrestrictedCollectionGets;
  const prevFiltered = MockFirestoreCollection.totalFilteredWhereGets;

  // Lala faz requisição
  await simulateRequest('GET', '/api/lessons', {
    authorization: 'Bearer token_lala_student_123',
  });

  const diffUnrestricted = MockFirestoreCollection.totalUnrestrictedCollectionGets - prevUnrestricted;
  const diffFiltered = MockFirestoreCollection.totalFilteredWhereGets - prevFiltered;

  assert(
    diffUnrestricted === 0,
    'Consulta de estudante NÃO realizou varredura irrestrita da coleção lessons'
  );
  assert(
    diffFiltered > 0,
    'Consulta de estudante utilizou consultas filtradas indexadas (where)'
  );

  console.log('\n======================================================================');
  console.log(`TOTAL DE TESTES EXECUTADOS: ${passed + failed}`);
  console.log(`SUCESSO: ${passed}`);
  console.log(`FALHAS: ${failed}`);
  console.log('======================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
  process.exit(0);
}

runHotfixGetLessonsTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
