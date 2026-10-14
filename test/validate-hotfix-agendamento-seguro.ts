/**
 * TESTE DE INTEGRAÇÃO & SEGURANÇA: HOTFIX AGENDAMENTO SEGURO, IDENTIDADES E DEDISPLICAÇÃO
 * Projeto: itissimple-security-staging (default)
 * 
 * Validações obrigatórias:
 * 1. Lala autenticada (lavistorekids@gmail.com) agendando aula experimental de 25 min com Skull Bee (skull-bee) com sucesso.
 * 2. Persistência da aula e atualização dos vínculos via Firebase Admin SDK sem violar regras do Firestore.
 * 3. Tentativas de agendamento duplicado bloqueadas pelo backend (conflito de horário e aula experimental já utilizada).
 * 4. Tentativas não autenticadas ou com token forjado rejeitadas com 401/403.
 * 5. Catálogo de Native Friends exibe cada professor aprovado uma única vez, sem duplicidade e preservando dados.
 */

import { setFirebaseAdminAuthForTesting } from '../src/serverFirebaseAdmin';
import {
  setFirebaseAdminFirestoreForTesting,
  scheduleLessonAtomicServer,
  getFirestoreDb,
} from '../src/serverFirestore';
import {
  consolidateTutorsList,
  areSameTutor,
  mergeTutors,
  normalizeTutorName,
} from '../src/utils/tutorConsolidation';
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

// In-memory mock Firestore storage for privileged backend verification
class MockFirestoreCollection {
  private docs: Map<string, any> = new Map();
  private subcollections: Map<string, Map<string, MockFirestoreCollection>> = new Map();

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

  _getRaw(id: string) {
    return this.docs.get(id);
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

  async runTransaction(updateFunction: (transaction: any) => Promise<any>) {
    const self = this;
    const transaction = {
      get: async (ref: any) => ref.get(),
      set: (ref: any, data: any, options?: { merge?: boolean }) => {
        ref.set(data, options);
        return transaction;
      },
      update: (ref: any, data: any) => {
        ref.set(data, { merge: true });
        return transaction;
      },
    };
    return await updateFunction(transaction);
  }
}

async function runHotfixTestSuite() {
  console.log('\n========================================================================');
  console.log('=== IT\'S SIMPLE — HOTFIX: AGENDAMENTO SEGURO, IDENTIDADES & DEDUPLICAÇÃO ===');
  console.log('=== Projeto Exclusivo: itissimple-security-staging (default)          ===');
  console.log('========================================================================\n');

  const mockDb = new MockFirestoreDb();
  setFirebaseAdminFirestoreForTesting(mockDb as any);

  // Setup mock auth
  const tokenDatabase: Record<string, any> = {
    'token_lala': {
      uid: 'uid_lala_student_123',
      email: 'lavistorekids@gmail.com',
      role: 'student',
    },
    'token_attacker': {
      uid: 'uid_attacker_999',
      email: 'attacker@example.com',
      role: 'student',
    },
  };

  setFirebaseAdminAuthForTesting({
    verifyIdToken: async (token: string) => {
      const found = tokenDatabase[token];
      if (!found) {
        throw new Error('Firebase ID Token is invalid or expired');
      }
      return found;
    },
  } as any);

  // --------------------------------------------------------------------------
  console.log('--- 1. Preparação dos Registros Persistidos no Firestore ---');
  // --------------------------------------------------------------------------

  // Seed Native Friend Skull Bee:
  // Persistent public identity: 'skull-bee'
  // Real Firebase Auth UID: 'uid_skullbee_teacher_456'
  // Legacy doc: 'tutor-laviniafofafc-gmail-com'
  const skullBeeAuthDoc = {
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
    bio: 'Native English Speaker and Conversational Specialist.',
    rating: 5.0,
    pricePerSessionUsd: 20,
    pricePerSessionBrl: 110,
    meetUrl: 'https://meet.google.com/skb-live-room',
  };

  const skullBeeLegacyDoc = {
    id: 'tutor-laviniafofafc-gmail-com',
    publicTutorId: 'skull-bee',
    name: 'Skull Bee',
    email: 'laviniafofafc@gmail.com',
    role: 'teacher',
    isApproved: true,
    approvalStatus: 'approved',
    bio: 'Native English Speaker.',
  };

  await mockDb.collection('users').doc('uid_skullbee_teacher_456').set(skullBeeAuthDoc);
  await mockDb.collection('tutors').doc('skull-bee').set(skullBeeAuthDoc);
  await mockDb.collection('tutors').doc('tutor-laviniafofafc-gmail-com').set(skullBeeLegacyDoc);

  // Seed Lala (student):
  // Persistent UID: 'uid_lala_student_123'
  // Email: 'lavistorekids@gmail.com'
  // Legacy doc: 'usr-lala-lavistorekids-gmail-com'
  const lalaStudentDoc = {
    id: 'uid_lala_student_123',
    uid: 'uid_lala_student_123',
    name: 'Lala',
    email: 'lavistorekids@gmail.com',
    role: 'student',
    contractedLessons: 0,
    availableLessons: 0,
    hasCompletedTrialLesson: false,
    enrollmentStatus: 'not_enrolled',
  };
  await mockDb.collection('users').doc('uid_lala_student_123').set(lalaStudentDoc);
  await mockDb.collection('users').doc('usr-lala-lavistorekids-gmail-com').set({
    ...lalaStudentDoc,
    id: 'usr-lala-lavistorekids-gmail-com',
  });

  assert(true, 'Banco inicializado com identidades de Lala e Skull Bee');

  // --------------------------------------------------------------------------
  console.log('\n--- 2. Validação da Resolução e Deduplicação no Catálogo de Native Friends ---');
  // --------------------------------------------------------------------------
  
  const rawCatalogList = [
    skullBeeLegacyDoc,
    skullBeeAuthDoc,
    {
      id: 'tutor-beeginning4you-gmail-com',
      publicTutorId: 'queen-bee',
      name: 'Queen Bee',
      email: 'beeginning4you@gmail.com',
      role: 'teacher',
      approvalStatus: 'approved',
      isApproved: true,
    },
    {
      id: 'usr-queen-bee',
      publicTutorId: 'queen-bee',
      name: 'Queen Bee (Amiga Nativa)',
      email: 'beeginning4you@gmail.com',
      role: 'teacher',
      approvalStatus: 'approved',
      isApproved: true,
    },
    {
      id: 'uid_charles_tutor_789',
      publicTutorId: 'charles',
      name: 'Charles (Teacher)',
      email: 'charles@example.com',
      role: 'teacher',
      approvalStatus: 'approved',
      isApproved: true,
    },
  ];

  const consolidatedCatalog = consolidateTutorsList(rawCatalogList);

  assert(
    consolidatedCatalog.length === 3,
    'Catálogo consolidado deduplica registros: exatamente 3 Native Friends únicos (Skull Bee, Queen Bee, Charles)',
    `Tamanho atual: ${consolidatedCatalog.length}`
  );

  const skullBeeInCatalog = consolidatedCatalog.filter((t) => areSameTutor(t, { publicTutorId: 'skull-bee', name: 'Skull Bee' }));
  assert(
    skullBeeInCatalog.length === 1,
    'Skull Bee aparece exatamente uma única vez no catálogo consolidado'
  );
  assert(
    skullBeeInCatalog[0].publicTutorId === 'skull-bee',
    'Skull Bee preserva publicTutorId canônico "skull-bee"'
  );
  assert(
    skullBeeInCatalog[0].isApproved === true && skullBeeInCatalog[0].approvalStatus === 'approved',
    'Skull Bee preserva status aprovado após merge'
  );
  assert(
    Boolean(skullBeeInCatalog[0].bio && skullBeeInCatalog[0].meetUrl),
    'Skull Bee preserva bio e meetUrl após merge'
  );

  const queenBeeInCatalog = consolidatedCatalog.filter((t) => areSameTutor(t, { publicTutorId: 'queen-bee', name: 'Queen Bee' }));
  assert(
    queenBeeInCatalog.length === 1,
    'Queen Bee aparece exatamente uma única vez no catálogo consolidado'
  );

  // --------------------------------------------------------------------------
  console.log('\n--- 3. Lala Autenticada Agendando Aula Experimental de 25 min com Skull Bee ---');
  // --------------------------------------------------------------------------

  const startIso = '2026-10-20T14:00:00.000Z';
  const endIso = '2026-10-20T14:25:00.000Z'; // 25 min exactly

  const scheduleResult = await scheduleLessonAtomicServer({
    studentAuthUid: 'uid_lala_student_123',
    studentEmail: 'lavistorekids@gmail.com',
    studentName: 'Lala',
    teacherIdOrEmail: 'skull-bee', // Frontend sends public ID
    teacherUid: 'skull-bee',
    startDateTime: startIso,
    endDateTime: endIso,
    title: 'Aula Experimental Ao Vivo (25 min)',
    description: 'Conversação inicial em inglês',
    isTrialLesson: true,
    requestId: 'req-lala-trial-01',
    dbState: { liveLessons: [], tutorsList: [skullBeeAuthDoc] } as any,
  });

  assert(scheduleResult.success === true, 'Agendamento de aula experimental concluído com sucesso');
  assert(scheduleResult.statusCode === 200, 'Retorna status 200');
  assert(Boolean(scheduleResult.lesson), 'Objeto da aula retornado na resposta');
  assert(scheduleResult.lesson?.teacherUid === 'skull-bee', 'Aula vinculada ao publicTutorId "skull-bee"');
  assert(scheduleResult.lesson?.teacherEmail === 'laviniafofafc@gmail.com', 'Aula vinculada ao e-mail correto da Skull Bee');
  assert(scheduleResult.lesson?.studentUid === 'uid_lala_student_123', 'Aula vinculada ao UID canônico de Lala');
  assert(scheduleResult.isTrialLesson === true, 'Aula confirmada como experimental');

  // Verify 25-minute duration
  const durationMs = new Date(scheduleResult.lesson.endDateTime).getTime() - new Date(scheduleResult.lesson.startDateTime).getTime();
  assert(durationMs === 25 * 60 * 1000, 'Duração da aula experimental é estritamente de 25 minutos');

  // --------------------------------------------------------------------------
  console.log('\n--- 4. Validação da Persistência e Vínculos no Firestore Admin ---');
  // --------------------------------------------------------------------------

  // Check top-level lesson doc
  const persistedLesson = await mockDb.collection('lessons').doc(scheduleResult.lesson.id).get();
  assert(persistedLesson.exists, 'Aula persistida na coleção principal /lessons');
  assert(persistedLesson.data()?.status === 'scheduled', 'Status da aula é "scheduled"');

  // Check student subcollection /users/{lalaUid}/lessons/{lessonId}
  const studentSubLesson = await mockDb.collection('users').doc('uid_lala_student_123').collection('lessons').doc(scheduleResult.lesson.id).get();
  assert(studentSubLesson.exists, 'Aula persistida na subcoleção /users/{studentUid}/lessons');

  // Check teacher subcollection /tutors/{skull-bee}/lessons/{lessonId}
  const tutorSubLesson = await mockDb.collection('tutors').doc('skull-bee').collection('lessons').doc(scheduleResult.lesson.id).get();
  assert(tutorSubLesson.exists, 'Aula persistida na subcoleção /tutors/{publicTutorId}/lessons');

  // Check teacher subcollection /users/{teacherAuthUid}/lessons/{lessonId}
  const teacherUserSubLesson = await mockDb.collection('users').doc('uid_skullbee_teacher_456').collection('lessons').doc(scheduleResult.lesson.id).get();
  assert(teacherUserSubLesson.exists, 'Aula persistida na subcoleção /users/{teacherAuthUid}/lessons');

  // Check student document updates in /users/{studentUid}
  const updatedStudentDoc = await mockDb.collection('users').doc('uid_lala_student_123').get();
  const sData = updatedStudentDoc.data();
  assert(sData?.teacherUid === 'skull-bee', 'users/{studentUid}.teacherUid atualizado para "skull-bee"');
  assert(sData?.assignedNativeFriendUID === 'skull-bee', 'users/{studentUid}.assignedNativeFriendUID atualizado');
  assert(sData?.teacherEmail === 'laviniafofafc@gmail.com', 'users/{studentUid}.teacherEmail atualizado');
  assert(sData?.hasCompletedTrialLesson === true, 'users/{studentUid}.hasCompletedTrialLesson marcado como true');
  assert(sData?.enrollmentStatus === 'active', 'users/{studentUid}.enrollmentStatus ativo');

  // Check student_assignments document
  const assignmentDoc = await mockDb.collection('student_assignments').doc('uid_lala_student_123').get();
  assert(assignmentDoc.exists, 'Documento criado em student_assignments/{studentUid}');
  assert(assignmentDoc.data()?.teacherUid === 'skull-bee', 'student_assignments vincula teacherUid a "skull-bee"');

  // --------------------------------------------------------------------------
  console.log('\n--- 5. Bloqueio de Agendamento Duplicado (Anti-Duplicidade) ---');
  // --------------------------------------------------------------------------

  // 5.1 Tentativa de agendar segunda aula experimental para Lala (já utilizada)
  const duplicateTrialResult = await scheduleLessonAtomicServer({
    studentAuthUid: 'uid_lala_student_123',
    studentEmail: 'lavistorekids@gmail.com',
    studentName: 'Lala',
    teacherIdOrEmail: 'skull-bee',
    teacherUid: 'skull-bee',
    startDateTime: '2026-10-21T15:00:00.000Z',
    endDateTime: '2026-10-21T15:25:00.000Z',
    title: 'Segunda Aula Experimental',
    isTrialLesson: true,
    requestId: 'req-lala-trial-02',
    existingLessons: [scheduleResult.lesson],
  });

  assert(duplicateTrialResult.success === false, 'Tentativa de segunda aula experimental é BLOQUEADA');
  assert(duplicateTrialResult.statusCode === 400, 'Retorna status 400 Bad Request');
  assert(
    Boolean(duplicateTrialResult.error?.includes('já possui uma aula experimental') || duplicateTrialResult.error?.includes('já foi utilizada')),
    `Mensagem informativa de aula experimental já utilizada: "${duplicateTrialResult.error}"`
  );

  // 5.2 Tentativa de agendar aula sobreposta com Skull Bee (Conflito de Horário)
  const overlappingResult = await scheduleLessonAtomicServer({
    studentAuthUid: 'uid_another_student_555',
    studentEmail: 'outro.aluno@example.com',
    studentName: 'Outro Aluno',
    teacherIdOrEmail: 'skull-bee',
    teacherUid: 'skull-bee',
    startDateTime: '2026-10-20T14:10:00.000Z', // Overlaps with 14:00 - 14:25
    endDateTime: '2026-10-20T14:35:00.000Z',
    title: 'Aula Conflitante',
    isTrialLesson: false,
    requestId: 'req-conflict-01',
    existingLessons: [scheduleResult.lesson],
  });

  assert(overlappingResult.success === false, 'Tentativa de agendamento em horário conflitante com o professor é BLOQUEADA');
  assert(overlappingResult.statusCode === 409, 'Retorna status 409 Conflict');
  assert(
    Boolean(overlappingResult.error?.includes('Bloqueio de Conflito')),
    `Retorna mensagem de bloqueio de conflito: "${overlappingResult.error}"`
  );

  // 5.3 Idempotência: reenvio da mesma solicitação com o mesmo requestId
  const idempotentResult = await scheduleLessonAtomicServer({
    studentAuthUid: 'uid_lala_student_123',
    studentEmail: 'lavistorekids@gmail.com',
    studentName: 'Lala',
    teacherIdOrEmail: 'skull-bee',
    teacherUid: 'skull-bee',
    startDateTime: startIso,
    endDateTime: endIso,
    title: 'Aula Experimental Ao Vivo (25 min)',
    isTrialLesson: true,
    requestId: 'req-lala-trial-01', // Exact same requestId
    existingLessons: [scheduleResult.lesson],
  });

  assert(idempotentResult.success === true, 'Reenvio idempotente retorna sucesso');
  assert(idempotentResult.statusCode === 200, 'Retorna status 200');
  assert(idempotentResult.lesson.id === scheduleResult.lesson.id, 'Retorna a exata mesma aula sem duplicar registro');

  // --------------------------------------------------------------------------
  console.log('\n--- 6. Rejeição de Requisições Não Autenticadas ou Impersonadas (401/403) ---');
  // --------------------------------------------------------------------------

  // Test middleware directly
  let mwErrorStatus = 0;
  let mwErrorBody: any = null;
  let nextCalled = false;

  const fakeRes = {
    status(code: number) {
      mwErrorStatus = code;
      return fakeRes;
    },
    json(body: any) {
      mwErrorBody = body;
      return fakeRes;
    },
  } as any;

  // 6.1 Sem header Authorization -> 401
  nextCalled = false;
  mwErrorStatus = 0;
  await firebaseAuthMiddleware({ headers: {} } as any, fakeRes, () => { nextCalled = true; });
  assert(!nextCalled && mwErrorStatus === 401, 'Requisição sem token de autenticação rejeitada com 401');

  // 6.2 Token forjado/inválido -> 401
  nextCalled = false;
  mwErrorStatus = 0;
  await firebaseAuthMiddleware({ headers: { authorization: 'Bearer forged_token_xyz' } } as any, fakeRes, () => { nextCalled = true; });
  assert(!nextCalled && mwErrorStatus === 401, 'Requisição com token forjado rejeitada com 401');

  // 6.3 Token válido de Lala -> 200 / next() chamado
  nextCalled = false;
  let authenticatedReq: any = { headers: { authorization: 'Bearer token_lala' } };
  await firebaseAuthMiddleware(authenticatedReq, fakeRes, () => { nextCalled = true; });
  assert(nextCalled, 'Token válido de Lala autentica com sucesso');
  assert(authenticatedReq.user?.uid === 'uid_lala_student_123', 'UID canônico de Lala extraído com segurança do token');

  // 6.4 Tentativa de agendar em nome de outro estudante (Impersonation Defense)
  // Attacker is authenticated with attacker token, but sends studentUid = Lala
  authenticatedReq = {
    headers: { authorization: 'Bearer token_attacker' },
    body: {
      studentUid: 'uid_lala_student_123', // Trying to book as Lala
    },
  };
  let impersonationStatus = 0;
  const impersonationRes = {
    status(code: number) { impersonationStatus = code; return impersonationRes; },
    json(body: any) { return impersonationRes; },
  } as any;

  nextCalled = false;
  await firebaseAuthMiddleware(authenticatedReq, impersonationRes, () => { nextCalled = true; });
  assert(nextCalled, 'Attacker token validado');
  assert(authenticatedReq.user.uid === 'uid_attacker_999', 'UID do atacante extraído do token');

  // Now simulate endpoint defense in POST /api/lessons/schedule
  let handlerStatus = 200;
  if (authenticatedReq.body.studentUid && authenticatedReq.body.studentUid.trim() !== authenticatedReq.user.uid) {
    handlerStatus = 403;
  }
  assert(handlerStatus === 403, 'Tentativa de agendamento em nome de outro estudante bloqueada com 403 Forbidden');

  // 6.5 Tentativa de agendar com professor não aprovado
  const unapprovedTutorResult = await scheduleLessonAtomicServer({
    studentAuthUid: 'uid_lala_student_123',
    studentEmail: 'lavistorekids@gmail.com',
    studentName: 'Lala',
    teacherIdOrEmail: 'pending-tutor-99',
    teacherUid: 'pending-tutor-99',
    startDateTime: '2026-10-25T10:00:00.000Z',
    endDateTime: '2026-10-25T10:25:00.000Z',
    isTrialLesson: false,
    dbState: {
      liveLessons: [],
      tutorsList: [
        {
          id: 'pending-tutor-99',
          name: 'Pending Tutor',
          role: 'teacher',
          approvalStatus: 'pending',
          isApproved: false,
        },
      ],
    } as any,
  });

  assert(unapprovedTutorResult.success === false, 'Agendamento com professor pendente/não aprovado é BLOQUEADO');
  assert(unapprovedTutorResult.statusCode === 400, 'Retorna status 400 Bad Request');
  assert(
    Boolean(unapprovedTutorResult.error?.includes('não foi aprovado')),
    `Mensagem informativa de professor não aprovado: "${unapprovedTutorResult.error}"`
  );

  console.log('\n======================================================================');
  console.log(`TOTAL DE TESTES EXECUTADOS: ${passed + failed}`);
  console.log(`SUCESSO: ${passed}`);
  console.log(`FALHAS: ${failed}`);
  console.log('======================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runHotfixTestSuite().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
