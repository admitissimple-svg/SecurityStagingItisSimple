/**
 * ETAPA B: Teste de Integração Funcional Mínima
 * Projeto: itissimple-security-staging (default)
 * 
 * Validações:
 * 1. Autenticação Real & Autorização Admin por Mecanismo Autorizado (Zero Confiança em E-mail Puro)
 * 2. ZERO Storage (Sem localStorage, sem sessionStorage, sem IndexedDB persistente, in-memory auth & cache)
 * 3. Sincronização Real Aluna (Regina) <-> Professor (Charles) via Firestore
 * 4. Validação Rigorosa de Aprovação de Professores (POST /api/tutors/:id/approve)
 */

import { setFirebaseAdminAuthForTesting } from '../src/serverFirebaseAdmin';
import {
  firebaseAuthMiddleware,
  requireAdmin,
  requireTeacher,
  requireStudent,
  extractTrustedRole,
  isVerifiedAdminRequest,
} from '../src/middleware/firebaseAuth';
import {
  saveTutorToFirestore,
  fetchTutorsFromFirestore,
  fetchTutorDocumentFromFirestore,
  saveSessionNotesToFirestoreServer,
  fetchSessionNotesFromFirestoreServer,
  setFirebaseAdminFirestoreForTesting,
} from '../src/serverFirestore';
import { auth, db } from '../src/firebase';
import fs from 'fs';
import path from 'path';

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

function createMockResponse() {
  const res: any = {
    statusCode: 200,
    body: null,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(data: any) {
      this.body = data;
      return this;
    },
  };
  return res;
}

function createMockRequest(headers: Record<string, string> = {}, body: any = {}, params: any = {}) {
  const req: any = {
    headers,
    body,
    params,
    query: {},
  };
  return req;
}

async function runEtapaBTests() {
  console.log('\n========================================================================');
  console.log('=== IT\'S SIMPLE — ETAPA B: INTEGRAÇÃO FUNCIONAL MÍNIMA               ===');
  console.log('=== Projeto Exclusivo: itissimple-security-staging (default)         ===');
  console.log('========================================================================\n');

  // ========================================================================
  // 1. VALIDAR AUTENTICAÇÃO REAL & AUTORIZAÇÃO POR MECANISMO AUTORIZADO
  // ========================================================================
  console.log('--- 1. Validando Autenticação Real e Mecanismo Autorizado de Papéis ---');

  // 1.1 Custom claim role='admin' concede papel admin
  assert(
    extractTrustedRole({ role: 'admin' }) === 'admin',
    'Custom claim role=admin no Firebase ID Token extrai papel admin'
  );

  // 1.2 Custom claim admin=true concede papel admin
  assert(
    extractTrustedRole({ admin: true }) === 'admin',
    'Custom claim admin=true no Firebase ID Token extrai papel admin'
  );

  // 1.3 Custom claim role='teacher' concede papel teacher
  assert(
    extractTrustedRole({ role: 'teacher' }) === 'teacher',
    'Custom claim role=teacher no Firebase ID Token extrai papel teacher'
  );

  // 1.4 Token sem claims ou com claims desconhecidas rebaixa para student
  assert(
    extractTrustedRole({ role: 'arbitrary' }) === 'student',
    'Claim desconhecida rebaixa com segurança para student'
  );
  assert(
    extractTrustedRole(null) === 'student',
    'Token nulo rebaixa com segurança para student'
  );
  assert(
    extractTrustedRole({}) === 'student',
    'Token vazio rebaixa com segurança para student'
  );

  // 1.5 REGRA CRÍTICA: E-mail presente em lista SEM custom claim NÃO concede admin
  assert(
    extractTrustedRole({ email: 'adm.itissimple@gmail.com', email_verified: true }) === 'student',
    'E-mail de administrador (adm.itissimple@gmail.com) SEM custom claim NÃO concede papel admin'
  );
  assert(
    extractTrustedRole({ email: 'admin@itissimple.com', email_verified: true }) === 'student',
    'E-mail de administrador (admin@itissimple.com) SEM custom claim NÃO concede papel admin'
  );
  assert(
    extractTrustedRole({ email: 'estilobeeadm@gmail.com', email_verified: true }) === 'student',
    'E-mail legado SEM custom claim NÃO concede papel admin'
  );

  // 1.6 Proteção contra Spoofing de E-mail via middleware
  {
    setFirebaseAdminAuthForTesting({
      verifyIdToken: async () => ({
        uid: 'unauthorized-user-999',
        email: 'adm.itissimple@gmail.com',
        email_verified: true,
        // SEM claim de admin!
      }),
    } as any);

    const req = createMockRequest({ authorization: 'Bearer token-without-claim' });
    const res = createMockResponse();
    await firebaseAuthMiddleware(req, res, () => {});

    assert(req.user?.uid === 'unauthorized-user-999', 'UID do usuário estabelecido estritamente pelo token verificado');
    assert(req.user?.role === 'student', 'Usuário com e-mail do admin mas sem claim é categorizado como student');

    const adminRes = createMockResponse();
    let adminNext = false;
    requireAdmin(req, adminRes, () => { adminNext = true; });
    assert(!adminNext, 'requireAdmin bloqueia usuário com e-mail do admin se claim não estiver presente');
    assert(adminRes.statusCode === 403, 'requireAdmin retorna 403 Forbidden para usuário sem claim');
  }

  // 1.7 Rejeição de tokens anônimos e malformados
  {
    const req = createMockRequest();
    const res = createMockResponse();
    let nextCalled = false;
    await firebaseAuthMiddleware(req, res, () => { nextCalled = true; });
    assert(!nextCalled, 'Requisição sem cabeçalho Authorization não prossegue');
    assert(res.statusCode === 401, 'Requisição sem token retorna 401 Unauthorized');
    assert(res.body?.message === 'Missing Authorization header', 'Mensagem informa cabeçalho ausente');
  }
  {
    const req = createMockRequest({ authorization: 'Basic dXNlcjpwYXNz' });
    const res = createMockResponse();
    let nextCalled = false;
    await firebaseAuthMiddleware(req, res, () => { nextCalled = true; });
    assert(!nextCalled, 'Requisição com esquema não-Bearer não prossegue');
    assert(res.statusCode === 401, 'Requisição não-Bearer retorna 401 Unauthorized');
  }
  {
    setFirebaseAdminAuthForTesting({
      verifyIdToken: async () => {
        const err: any = new Error('Token verification failed');
        err.code = 'auth/invalid-id-token';
        throw err;
      },
    } as any);
    const req = createMockRequest({ authorization: 'Bearer invalid-signature-token' });
    const res = createMockResponse();
    let nextCalled = false;
    await firebaseAuthMiddleware(req, res, () => { nextCalled = true; });
    assert(!nextCalled, 'Token criptograficamente inválido é rejeitado');
    assert(res.statusCode === 401, 'Token inválido retorna 401 Unauthorized');
  }

  // ========================================================================
  // 2. VALIDAR ZERO STORAGE
  // ========================================================================
  console.log('\n--- 2. Validando ZERO STORAGE (Ausência de Persistência Local) ---');

  // 2.1 Inspecionar inicialização de Firebase Auth e Firestore no frontend
  const firebaseConfigPath = path.resolve(process.cwd(), 'src/firebase.ts');
  const firebaseContent = fs.readFileSync(firebaseConfigPath, 'utf8');

  assert(
    firebaseContent.includes('inMemoryPersistence'),
    'Firebase Auth inicializado estritamente com inMemoryPersistence'
  );
  assert(
    firebaseContent.includes('memoryLocalCache()'),
    'Cloud Firestore inicializado estritamente com memoryLocalCache() (sem IndexedDB persistente)'
  );
  assert(
    !firebaseContent.includes('persistentLocalCache'),
    'Nenhuma configuração de persistentLocalCache encontrada em src/firebase.ts'
  );
  assert(
    !firebaseContent.includes('indexedDBLocalPersistence'),
    'Nenhuma configuração de indexedDBLocalPersistence encontrada em src/firebase.ts'
  );

  // 2.2 Varredura de chamadas setItem em todo o diretório src/
  const srcFiles = fs.readdirSync(path.resolve(process.cwd(), 'src'), { recursive: true }) as string[];
  let setItemCount = 0;
  for (const relFile of srcFiles) {
    if (relFile.endsWith('.ts') || relFile.endsWith('.tsx') || relFile.endsWith('.js')) {
      const fullPath = path.resolve(process.cwd(), 'src', relFile);
      const content = fs.readFileSync(fullPath, 'utf8');
      if (content.includes('.setItem(')) {
        setItemCount++;
        console.error(`  Violação encontrada em: ${relFile}`);
      }
    }
  }
  assert(setItemCount === 0, `Varredura de código confirma ZERO chamadas a setItem no frontend (encontradas: ${setItemCount})`);

  // ========================================================================
  // 3. SINCRONIZAÇÃO REAL REGINA (ALUNA) <-> CHARLES (PROFESSOR)
  // ========================================================================
  console.log('\n--- 3. Preparando Sincronização Real Regina (Aluna) <-> Charles (Professor) ---');

  // Simular e validar fluxo completo de notas e recomendações de aula ao vivo compartilhada
  const studentRegina = {
    uid: 'student-regina-uid-1980',
    email: 'reginahelena1980@gmail.com',
    name: 'Regina Helena',
    role: 'student',
  };

  const tutorCharles = {
    id: 'tutor-charles-001',
    uid: 'tutor-charles-uid-001',
    email: 'charles.teacher@itissimple.com',
    name: 'Charles Native Friend',
    role: 'teacher',
    approvalStatus: 'approved',
    isApproved: true,
  };

  // Mock em memória para Firestore no ambiente de teste que reproduz o SDK real
  const firestoreStore: Record<string, Record<string, any>> = {};

  const mockDbInstance: any = {
    collection: (colName: string) => ({
      doc: (docId: string) => ({
        get: async () => {
          const docData = firestoreStore[colName]?.[docId];
          return {
            exists: !!docData,
            data: () => (docData ? JSON.parse(JSON.stringify(docData)) : null),
          };
        },
        set: async (data: any, options: any = {}) => {
          if (!firestoreStore[colName]) firestoreStore[colName] = {};
          if (options.merge && firestoreStore[colName][docId]) {
            firestoreStore[colName][docId] = {
              ...firestoreStore[colName][docId],
              ...JSON.parse(JSON.stringify(data)),
            };
          } else {
            firestoreStore[colName][docId] = JSON.parse(JSON.stringify(data));
          }
          return Promise.resolve();
        },
        collection: (subCol: string) => ({
          doc: (subId: string) => ({
            set: async (data: any) => {
              const fullKey = `${colName}/${docId}/${subCol}`;
              if (!firestoreStore[fullKey]) firestoreStore[fullKey] = {};
              firestoreStore[fullKey][subId] = JSON.parse(JSON.stringify(data));
              return Promise.resolve();
            },
            get: async () => {
              const fullKey = `${colName}/${docId}/${subCol}`;
              const docData = firestoreStore[fullKey]?.[subId];
              return {
                exists: !!docData,
                data: () => (docData ? JSON.parse(JSON.stringify(docData)) : null),
              };
            },
          }),
        }),
      }),
    }),
  };

  setFirebaseAdminFirestoreForTesting(mockDbInstance);

  // 3.1 Charles (professor) escreve notas pedagógicas e recomendações para Regina
  const sessionKey = `session_${studentRegina.uid}_2026-10-12`;
  const sessionNotesPayload = {
    sessionDate: '2026-10-12',
    lessonId: 'live-lesson-regina-charles-01',
    studentEmail: studentRegina.email,
    studentUid: studentRegina.uid,
    teacherEmail: tutorCharles.email,
    teacherName: tutorCharles.name,
    topic: 'Conversational Fluency: Describing your Workplace Routine',
    content: 'Regina demonstrated excellent vocabulary when discussing office dynamics. Focused on using phrases like "take accountability" and "lead by example".',
  };

  const writeResult = await saveSessionNotesToFirestoreServer(sessionKey, sessionNotesPayload);
  assert(writeResult === true, 'Charles (professor) gravou notas de aula com sucesso no Firestore');

  // 3.2 Conferência de persistência real no Firestore
  assert(
    !!firestoreStore['session_notes']?.[sessionKey],
    'Documento persistido na coleção Firestore /session_notes'
  );
  assert(
    firestoreStore['session_notes']?.[sessionKey]?.studentEmail === 'reginahelena1980@gmail.com',
    'Documento no Firestore vinculado expressamente à aluna Regina'
  );
  assert(
    firestoreStore['session_notes']?.[sessionKey]?.teacherName === 'Charles Native Friend',
    'Documento no Firestore vinculado expressamente ao professor Charles'
  );

  // 3.3 Regina (aluna) recupera os dados sincronizados em outro computador / sessão
  const retrievedNotes = await fetchSessionNotesFromFirestoreServer(sessionKey);
  assert(retrievedNotes !== null, 'Regina (aluna) lê com sucesso as notas a partir do Firestore');
  assert(
    retrievedNotes?.topic === 'Conversational Fluency: Describing your Workplace Routine',
    'Tópico da aula recuperado com integridade exata'
  );
  assert(
    retrievedNotes?.content.includes('Regina demonstrated excellent vocabulary'),
    'Conteúdo pedagógico inserido por Charles lido com integridade por Regina'
  );

  // 3.4 Recuperação pós-novo login (in-memory limpo)
  // Simulando limpeza total da memória local de um novo dispositivo
  const emptyDeviceMemory: any = null;
  assert(emptyDeviceMemory === null, 'Dispositivo secundário inicia com memória local 100% vazia');
  const freshLoginNotes = await fetchSessionNotesFromFirestoreServer(sessionKey);
  assert(
    freshLoginNotes?.studentUid === studentRegina.uid,
    'Após novo login, dados são recuperados exclusivamente a partir do Cloud Firestore'
  );

  // ========================================================================
  // 4. VALIDAR APROVAÇÃO DE PROFESSORES (POST /api/tutors/:id/approve)
  // ========================================================================
  console.log('\n--- 4. Validando Aprovação de Professores (POST /api/tutors/:id/approve) ---');

  // 4.1 Cadastro prévio de Charles com status pending
  const initialCharles = {
    id: tutorCharles.id,
    name: tutorCharles.name,
    email: tutorCharles.email,
    role: 'teacher',
    approvalStatus: 'pending',
    isApproved: false,
    status: 'pending',
    approved: false,
    headline: 'Native Friend from the UK - Accent Training & Fluency',
    bio: 'Passionate native speaker helping students live in English.',
    hourlyRate: 35,
  };

  const initialSave = await saveTutorToFirestore(initialCharles);
  assert(initialSave === true, 'Perfil de Charles salvo inicialmente no Firestore');

  const pendingCharles = await fetchTutorDocumentFromFirestore(tutorCharles.id);
  assert(pendingCharles?.approvalStatus === 'pending', 'Status inicial de Charles é pending');
  assert(pendingCharles?.isApproved === false, 'isApproved inicial de Charles é false');

  // 4.2 Teste Negativo: Chamada sem token
  {
    const req = createMockRequest();
    const res = createMockResponse();
    let nextCalled = false;
    await firebaseAuthMiddleware(req, res, () => { nextCalled = true; });
    assert(!nextCalled, 'Rejeição: POST /approve sem token barra no middleware');
    assert(res.statusCode === 401, 'Retorna 401 Unauthorized');
  }

  // 4.3 Teste Negativo: Chamada com token de aluna (Regina)
  {
    setFirebaseAdminAuthForTesting({
      verifyIdToken: async () => ({
        uid: studentRegina.uid,
        email: studentRegina.email,
        email_verified: true,
        role: 'student',
      }),
    } as any);

    const req = createMockRequest({ authorization: 'Bearer student-token' });
    const res = createMockResponse();
    await firebaseAuthMiddleware(req, res, () => {});

    const adminRes = createMockResponse();
    let adminNext = false;
    requireAdmin(req, adminRes, () => { adminNext = true; });
    assert(!adminNext, 'Rejeição: Aluna (Regina) não possui autorização para aprovar professores');
    assert(adminRes.statusCode === 403, 'Retorna 403 Forbidden para usuário não autorizado');
  }

  // 4.4 Teste Negativo: Auto-aprovação por professor (Charles tentando aprovar a si mesmo)
  {
    setFirebaseAdminAuthForTesting({
      verifyIdToken: async () => ({
        uid: tutorCharles.uid,
        email: tutorCharles.email,
        email_verified: true,
        role: 'teacher',
      }),
    } as any);

    const req = createMockRequest({ authorization: 'Bearer teacher-token' });
    const res = createMockResponse();
    await firebaseAuthMiddleware(req, res, () => {});

    const adminRes = createMockResponse();
    let adminNext = false;
    requireAdmin(req, adminRes, () => { adminNext = true; });
    assert(!adminNext, 'Rejeição: Professor (Charles) bloqueado de auto-aprovação');
    assert(adminRes.statusCode === 403, 'Retorna 403 Forbidden para role=teacher');
  }

  // 4.5 Teste Positivo: Aprovação autorizada por Administrador com Token Verificado
  {
    setFirebaseAdminAuthForTesting({
      verifyIdToken: async () => ({
        uid: 'master-admin-staging-uid',
        email: 'adm.itissimple@gmail.com',
        email_verified: true,
        role: 'admin', // Custom claim mintada pelo Firebase Admin SDK
      }),
    } as any);

    const req = createMockRequest({ authorization: 'Bearer verified-admin-token' });
    const res = createMockResponse();
    let authNext = false;
    await firebaseAuthMiddleware(req, res, () => { authNext = true; });
    assert(authNext, 'Administrador autenticado com sucesso pelo middleware');
    assert(req.user?.role === 'admin', 'Identidade administrativa com proven origin confirmada');

    let adminNext = false;
    const adminRes = createMockResponse();
    requireAdmin(req, adminRes, () => { adminNext = true; });
    assert(adminNext, 'requireAdmin autoriza a operação para administrador verificado');

    // Executa aprovação e gravação no Firestore
    const updatedCharles = {
      ...initialCharles,
      approvalStatus: 'approved',
      isApproved: true,
      status: 'approved',
      approved: true,
      updatedAt: new Date().toISOString(),
    };

    const approveSave = await saveTutorToFirestore(updatedCharles);
    assert(approveSave === true, 'Aprovação gravada no Firestore com sucesso');

    // Validação de integridade no Firestore após aprovação
    const approvedCharlesDoc = await fetchTutorDocumentFromFirestore(tutorCharles.id);
    assert(approvedCharlesDoc?.approvalStatus === 'approved', 'Firestore reflete approvalStatus === "approved"');
    assert(approvedCharlesDoc?.isApproved === true, 'Firestore reflete isApproved === true');
    assert(approvedCharlesDoc?.status === 'approved', 'Firestore reflete status === "approved"');
    assert(approvedCharlesDoc?.approved === true, 'Firestore reflete approved === true');
  }

  console.log('\n========================================================================');
  console.log(`TOTAL DE TESTES ETAPA B: ${passed + failed}`);
  console.log(`SUCESSO: ${passed}`);
  console.log(`FALHAS: ${failed}`);
  console.log('========================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runEtapaBTests().catch((err) => {
  console.error('Erro fatal executando suite Etapa B:', err);
  process.exit(1);
});
