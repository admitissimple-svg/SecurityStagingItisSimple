/**
 * TESTE DE VALIDAÇÃO LOCALIZADA: HOTFIX 4B.10.1 — CADASTRO SEGURO E CATÁLOGO SEM DUPLICAÇÕES
 * Projeto exclusivo: itissimple-security-staging (default)
 *
 * Validações obrigatórias:
 * 1. Cadastro de aluno novo e conclusão de conta já autenticada sem duplicar usuário.
 * 2. Falha de persistência impede avanço do Wizard (permanece no Step 5).
 * 3. Aluno não consegue alterar perfil de outro usuário (403 Forbidden).
 * 4. Skull Bee aparece uma única vez antes e depois do login.
 * 5. Dados privados continuam ausentes do catálogo público.
 */

process.env.NODE_ENV = 'test';

import http from 'http';
import { setFirebaseAdminAuthForTesting } from '../src/serverFirebaseAdmin';
import {
  setFirebaseAdminFirestoreForTesting,
  getFirestoreDb,
} from '../src/serverFirestore';
import {
  consolidateTutorsList,
  areSameTutor,
} from '../src/utils/tutorConsolidation';
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

// In-memory Mock Firestore Collection for testing
class MockFirestoreCollection {
  private docs: Map<string, any> = new Map();
  public shouldFailWrite = false;

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
        if (self.shouldFailWrite) {
          throw new Error('Firestore write simulated failure: permission-denied or database unavailable');
        }
        const existing = self.docs.get(id) || {};
        const merged = options?.merge ? { ...existing, ...data } : data;
        self.docs.set(id, JSON.parse(JSON.stringify(merged)));
        return { writeTime: new Date() };
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

  _getAllDocs() {
    return Array.from(this.docs.entries());
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

async function runHotfixValidation() {
  console.log('===========================================================================');
  console.log(' IT\'S SIMPLE — VALIDAÇÃO HOTFIX 4B.10.1: CADASTRO SEGURO & CATÁLOGO       ');
  console.log(' Projeto Exclusivo: itissimple-security-staging (default)                  ');
  console.log('===========================================================================\n');

  // Setup Mock Firebase Admin Auth
  const validTokens: Record<string, { uid: string; email: string; role?: string }> = {
    'token_new_student': {
      uid: 'student_uid_new_101',
      email: 'newstudent@example.com',
      role: 'student',
    },
    'token_existing_student': {
      uid: 'student_uid_existing_202',
      email: 'existinguser@example.com',
      role: 'student',
    },
    'token_student_alice': {
      uid: 'student_uid_alice',
      email: 'alice@example.com',
      role: 'student',
    },
    'token_student_bob': {
      uid: 'student_uid_bob',
      email: 'bob@example.com',
      role: 'student',
    },
    'token_admin': {
      uid: 'admin_uid_777',
      email: 'adm.itissimple@gmail.com',
      role: 'admin',
    },
  };

  const mockAdminAuth: any = {
    verifyIdToken: async (token: string) => {
      const match = validTokens[token];
      if (!match) {
        const err: any = new Error('Invalid Firebase ID token');
        err.code = 'auth/argument-error';
        throw err;
      }
      return {
        uid: match.uid,
        email: match.email,
        email_verified: true,
        role: match.role || 'student',
      };
    },
  };

  setFirebaseAdminAuthForTesting(mockAdminAuth);

  const mockDb = new MockFirestoreDb();
  setFirebaseAdminFirestoreForTesting(mockDb as any);

  // Start test server on ephemeral port
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // =========================================================================
    // 1. CADASTRO DE ALUNO NOVO E CONCLUSÃO DE CONTA JÁ AUTENTICADA (SEM DUPLICAÇÃO)
    // =========================================================================
    console.log('--- 1. Cadastro de Aluno Novo & Conclusão de Conta Autenticada ---');

    const newStudentChoices = {
      learningGoal: 'Carreira & Trabalho - Entrevistas e reuniões globais',
      level: 'intermediario',
      englishLevel: 'intermediario',
      userLevel: 'intermediario',
      weeklyStudyDaysTarget: 5,
      weeklyStudyDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
      routineVideoTime: '07:30',
      routineAudioTime: '12:00',
      dailyPhraseTime: '21:00',
      teacherEmail: 'laviniafofafc@gmail.com',
      teacherName: 'Skull Bee',
      teacherUid: 'skull-bee',
      assignedNativeFriendUID: 'skull-bee',
      nativeFriendUID: 'skull-bee',
      teacherMeetUrl: 'https://meet.google.com/skb-live-room',
      enrollmentStatus: 'active',
      contractedLessons: 1,
      hasCompletedTrialLesson: false,
      subscriptionType: 'trial',
      onboardingCompleted: true,
    };

    // 1.1 Cadastro de aluno novo via backend autenticado
    const resNew = await fetch(`${baseUrl}/api/user-profile`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token_new_student',
      },
      body: JSON.stringify({
        uid: 'student_uid_new_101',
        email: 'newstudent@example.com',
        profile: newStudentChoices,
      }),
    });

    assert(resNew.status === 200, '1.1 Cadastro de aluno novo retorna HTTP 200');
    const dataNew = await resNew.json();
    assert(dataNew.success === true, '1.1 Resposta confirma success === true');
    assert(dataNew.persistedToFirestore === true, '1.1 Resposta confirma persistência no Firestore Admin');

    // Verificar se persistiu efetivamente no Firestore Admin em users/{studentUid}
    const usersCol = mockDb.collection('users');
    const persistedNewStudent = usersCol._getRaw('student_uid_new_101');
    assert(Boolean(persistedNewStudent), '1.1 Documento gravado com sucesso em users/{studentUid}');
    assert(persistedNewStudent?.uid === 'student_uid_new_101', '1.1 UID canônico preservado no documento');
    assert(persistedNewStudent?.email === 'newstudent@example.com', '1.1 E-mail preservado no documento');
    assert(persistedNewStudent?.learningGoal === newStudentChoices.learningGoal, '1.1 Escolha de learningGoal preservada');
    assert(persistedNewStudent?.level === 'intermediario', '1.1 Escolha de level preservada');
    assert(persistedNewStudent?.routineVideoTime === '07:30', '1.1 Horário do vídeo diário preservado');
    assert(persistedNewStudent?.routineAudioTime === '12:00', '1.1 Horário do áudio diário preservado');
    assert(persistedNewStudent?.dailyPhraseTime === '21:00', '1.1 Horário da frase diária preservado');
    assert(persistedNewStudent?.teacherEmail === 'laviniafofafc@gmail.com', '1.1 Vínculo com Native Friend gravado');
    assert(persistedNewStudent?.teacherUid === 'skull-bee', '1.1 UID do Amigo Nativo vinculado');

    // 1.2 Conclusão de onboarding para conta já criada no Firebase Auth
    // Aluno já existe e apenas completa/atualiza o onboarding
    const resExisting = await fetch(`${baseUrl}/api/user-profile`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token_existing_student',
      },
      body: JSON.stringify({
        uid: 'student_uid_existing_202',
        email: 'existinguser@example.com',
        profile: {
          ...newStudentChoices,
          name: 'Existing Student Account',
          level: 'avancado',
        },
      }),
    });

    assert(resExisting.status === 200, '1.2 Conclusão de onboarding para conta já existente retorna HTTP 200');
    const dataExisting = await resExisting.json();
    assert(dataExisting.success === true, '1.2 Resposta confirma success === true');

    const persistedExisting = usersCol._getRaw('student_uid_existing_202');
    assert(Boolean(persistedExisting), '1.2 Documento de conta existente atualizado em users/{student_uid_existing_202}');
    assert(persistedExisting?.name === 'Existing Student Account', '1.2 Dados atualizados com sucesso');
    assert(persistedExisting?.level === 'avancado', '1.2 Nível atualizado com sucesso');

    // Verificar que não houve duplicação de usuário
    const allUsers = usersCol._getAllDocs();
    const existingDocsForEmail = allUsers.filter(([, d]) => d.email === 'existinguser@example.com');
    assert(existingDocsForEmail.length === 1, '1.2 Nenhum usuário duplicado no Firestore: exatamente 1 documento por UID');

    // =========================================================================
    // 2. FALHA DE PERSISTÊNCIA IMPEDE AVANÇO DO WIZARD
    // =========================================================================
    console.log('\n--- 2. Falha de Persistência Impede Avanço do Wizard ---');

    // Simula falha na gravação do Firestore Admin
    usersCol.shouldFailWrite = true;

    const resFailure = await fetch(`${baseUrl}/api/user-profile`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token_new_student',
      },
      body: JSON.stringify({
        uid: 'student_uid_new_101',
        email: 'newstudent@example.com',
        profile: { level: 'fluente' },
      }),
    });

    assert(resFailure.status === 500, '2. Falha de persistência no Firestore retorna status HTTP 500');
    const failureJson = await resFailure.json();
    assert(failureJson.error === 'Failed to persist user profile to Firestore', '2. Retorna mensagem informativa de falha');

    // Simulação do comportamento do OnboardingWizardModal:
    // O wizard chama onCompleteOnboarding. Se a API falhar, o erro é capturado e o Wizard NÃO avança para Step 6!
    let simulatedCurrentStep = 5;
    let simulatedErrorMessage = '';
    try {
      if (!resFailure.ok) {
        throw new Error(failureJson.message || 'Falha ao salvar configuração do perfil.');
      }
      simulatedCurrentStep = 6;
    } catch (err: any) {
      simulatedErrorMessage = err.message;
    }

    assert(simulatedCurrentStep === 5, '2. Wizard permanece no Passo 5 (não avança para o Passo 6)');
    assert(Boolean(simulatedErrorMessage), '2. Mensagem de erro exibida no modal para o usuário tentar novamente');

    // Restaura estado do mock
    usersCol.shouldFailWrite = false;

    // =========================================================================
    // 3. ALUNO NÃO CONSEGUE ALTERAR PERFIL DE OUTRO USUÁRIO (403 FORBIDDEN)
    // =========================================================================
    console.log('\n--- 3. Aluno Não Consegue Alterar Perfil de Outro Usuário ---');

    // Alice tenta alterar o perfil de Bob enviando o UID de Bob no corpo da requisição
    const resTamperUid = await fetch(`${baseUrl}/api/user-profile`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token_student_alice', // Token de Alice
      },
      body: JSON.stringify({
        uid: 'student_uid_bob', // Alvo: Bob
        email: 'bob@example.com',
        profile: { level: 'avancado', learningGoal: 'Hacked Goal' },
      }),
    });

    assert(resTamperUid.status === 403, '3. Tentativa de alterar perfil de outro usuário bloqueada com 403 Forbidden');
    const tamperJson = await resTamperUid.json();
    assert(tamperJson.error === 'Forbidden', '3. Retorna erro Forbidden');
    assert(
      tamperJson.message === 'Students can only update their own profile',
      '3. Retorna mensagem: Students can only update their own profile'
    );

    // Alice tenta enviar seu UID mas o e-mail de Bob
    const resTamperEmail = await fetch(`${baseUrl}/api/user-profile`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token_student_alice',
      },
      body: JSON.stringify({
        uid: 'student_uid_alice',
        email: 'bob@example.com',
        profile: { level: 'avancado' },
      }),
    });

    assert(resTamperEmail.status === 403, '3. Tentativa de alterar perfil com e-mail de outro usuário bloqueada com 403');

    // Requisição sem autenticação
    const resNoAuth = await fetch(`${baseUrl}/api/user-profile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        uid: 'student_uid_alice',
        email: 'alice@example.com',
        profile: { level: 'iniciante' },
      }),
    });

    assert(resNoAuth.status === 401, '3. Requisição sem token de autenticação rejeitada com 401 Unauthorized');

    // =========================================================================
    // 4. SKULL BEE APARECE UMA ÚNICA VEZ ANTES E DEPOIS DO LOGIN
    // =========================================================================
    console.log('\n--- 4. Deduplicação de Skull Bee Antes e Depois do Login ---');

    // Seed dos registros heterogêneos de Skull Bee
    const skullBeeAuthDoc = {
      id: 'uid_skullbee_teacher_456',
      uid: 'uid_skullbee_teacher_456',
      authUid: 'uid_skullbee_teacher_456',
      publicTutorId: 'skull-bee',
      name: 'Skull Bee (Amiga Nativa)',
      email: 'laviniafofafc@gmail.com',
      role: 'teacher',
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

    const skullBeePublicDoc = {
      id: 'skull-bee',
      publicTutorId: 'skull-bee',
      name: 'Skull Bee',
      role: 'teacher',
      isApproved: true,
      approvalStatus: 'approved',
      avatar: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2',
    };

    const rawTutorList = [skullBeePublicDoc, skullBeeAuthDoc, skullBeeLegacyDoc];

    // 4.1 Catálogo consolidado antes do login (Guest/Visitante)
    const consolidatedBeforeLogin = consolidateTutorsList(rawTutorList);
    const skullBeeCountBefore = consolidatedBeforeLogin.filter((t) =>
      areSameTutor(t, { publicTutorId: 'skull-bee', name: 'Skull Bee' })
    );

    assert(skullBeeCountBefore.length === 1, '4.1 Skull Bee aparece exatamente 1 vez no catálogo antes do login');
    assert(skullBeeCountBefore[0].publicTutorId === 'skull-bee', '4.1 Preserva publicTutorId canônico "skull-bee"');
    assert(skullBeeCountBefore[0].isApproved === true, '4.1 Preserva status de aprovação (isApproved: true)');

    // 4.2 Catálogo consolidado após login do aluno (simulando useNativeFriends onAuthStateChanged)
    const prevTutorsInHook = consolidatedBeforeLogin; // Dados que o hook já tinha antes do login
    const liveFirestoreTutors = [skullBeeAuthDoc]; // Dados recebidos de listeners ou re-fetch autenticado
    const consolidatedAfterLogin = consolidateTutorsList([...prevTutorsInHook, ...liveFirestoreTutors]);

    const skullBeeCountAfter = consolidatedAfterLogin.filter((t) =>
      areSameTutor(t, { publicTutorId: 'skull-bee', name: 'Skull Bee' })
    );

    assert(skullBeeCountAfter.length === 1, '4.2 Skull Bee aparece exatamente 1 vez no catálogo após o login');
    assert(skullBeeCountAfter[0].id === 'skull-bee', '4.2 Preserva id público canônico "skull-bee"');
    assert(
      skullBeeCountAfter[0].bio === 'Native English Speaker and Conversational Specialist.',
      '4.2 Preserva bio e informações detalhadas após merge'
    );

    // =========================================================================
    // 5. DADOS PRIVADOS CONTINUAM AUSENTES DO CATÁLOGO PÚBLICO
    // =========================================================================
    console.log('\n--- 5. Dados Privados Ausentes do Catálogo Público ---');

    // Requisição pública para GET /api/tutors sem autenticação
    const resPublicTutors = await fetch(`${baseUrl}/api/tutors`);
    assert(resPublicTutors.status === 200, '5. GET /api/tutors público retorna status 200');

    const publicCatalog = await resPublicTutors.json();
    assert(Array.isArray(publicCatalog), '5. Catálogo retornado é um array');

    for (const tutor of publicCatalog) {
      assert(tutor.email === undefined || tutor.email === '', `5. E-mail privado ausente para tutor "${tutor.name}"`);
      assert(tutor.uid === undefined || tutor.uid === '', `5. UID de autenticação ausente para tutor "${tutor.name}"`);
      assert(tutor.authUid === undefined, `5. authUid privado ausente para tutor "${tutor.name}"`);
      assert(tutor.meetUrl === undefined, `5. meetUrl privado ausente para tutor "${tutor.name}"`);
      assert(tutor.meetLink === undefined, `5. meetLink privado ausente para tutor "${tutor.name}"`);
      assert(tutor.password === undefined, `5. Campo password ausente para tutor "${tutor.name}"`);
      assert(tutor.secret === undefined, `5. Campo secret ausente para tutor "${tutor.name}"`);

      // Preservação de dados públicos necessários
      assert(Boolean(tutor.id || tutor.publicTutorId), `5. ID público preservado para tutor "${tutor.name}"`);
      assert(Boolean(tutor.name), `5. Nome de exibição presente para tutor "${tutor.name}"`);
    }

  } finally {
    server.close();
  }

  console.log('\n======================================================================');
  console.log(` TOTAL DE TESTES EXECUTADOS: ${passed + failed}`);
  console.log(` SUCESSO: ${passed}`);
  console.log(` FALHAS: ${failed}`);
  console.log('======================================================================');

  if (failed > 0) {
    process.exit(1);
  }
  process.exit(0);
}

runHotfixValidation().catch((err) => {
  console.error('Fatal test execution error:', err);
  process.exit(1);
});
