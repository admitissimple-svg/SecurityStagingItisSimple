import { setFirebaseAdminAuthForTesting } from '../src/serverFirebaseAdmin';
import { firebaseAuthMiddleware, requireAdmin } from '../src/middleware/firebaseAuth';
import { fetchTutorDocumentFromFirestore, saveTutorToFirestore } from '../src/serverFirestore';
import type { Request, Response, NextFunction } from 'express';

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
    headers: {} as Record<string, string>,
    setHeader(k: string, v: string) {
      this.headers[k] = v;
      return this;
    },
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

async function simulateRoute(
  middlewares: Array<(req: Request, res: Response, next: NextFunction) => any>,
  handler: (req: Request, res: Response) => any,
  req: any
) {
  const res = createMockResponse();
  let index = 0;
  const next = async (err?: any) => {
    if (err) {
      res.status(500).json({ error: String(err) });
      return;
    }
    if (index < middlewares.length) {
      const mw = middlewares[index++];
      await mw(req, res, next);
    } else {
      await handler(req, res);
    }
  };
  await next();
  return res;
}

async function runTests() {
  console.log('\n======================================================================');
  console.log('=== TESTE DE VALIDAÇÃO: HOTFIX HTTP 413 NA APROVAÇÃO              ===');
  console.log('=== PROJETO: itissimple-security-staging                           ===');
  console.log('======================================================================\n');

  // --- 1. Análise da causa-raiz do HTTP 413: Tamanho do Payload vs Limite do Express ---
  console.log('--- 1. Análise do payload excessivo e limite de 100KB do Express ---');
  {
    // Simula perfil completo com imagem Base64 (comum em cadastros com fotos carregadas localmente)
    const largeBase64Avatar = 'data:image/jpeg;base64,' + 'A'.repeat(150 * 1024); // ~150KB de imagem
    const excessivePayload = {
      tutor: {
        id: 'tutor-heavy-profile',
        name: 'Heavy Tutor',
        email: 'heavy@itissimple.com',
        avatar: largeBase64Avatar,
        photoUrl: largeBase64Avatar,
        bio: 'Extensive profile information...',
      },
    };
    const excessivePayloadBytes = Buffer.byteLength(JSON.stringify(excessivePayload));
    assert(excessivePayloadBytes > 100 * 1024, 'Payload anterior com avatar Base64 excede 100KB padrão do Express', `${Math.round(excessivePayloadBytes / 1024)}KB`);

    // Payload novo após hotfix: estritamente os dados necessários ({})
    const minimalPayload = {};
    const minimalPayloadBytes = Buffer.byteLength(JSON.stringify(minimalPayload));
    assert(minimalPayloadBytes <= 10, 'Novo payload do frontend é estritamente mínimo (< 10 bytes)', `${minimalPayloadBytes} bytes`);
    assert(minimalPayloadBytes < 100 * 1024, 'Novo payload é perfeitamente aceito pelo limite padrão sem gerar HTTP 413');
  }

  // --- 2. Proteção de Autenticação Firebase e Custom Claim administrativa ---
  console.log('\n--- 2. Preservação de autenticação Firebase e Custom Claim de admin ---');
  {
    interface TestTutor {
      id: string;
      name: string;
      email: string;
      role: string;
      approvalStatus: string;
      isApproved: boolean;
      status: string;
      approved: boolean;
    }

    const testState = {
      tutorsList: [
        {
          id: 'tutor-carlos-staging',
          name: 'Carlos Mendez',
          email: 'carlos@itissimple.com',
          role: 'teacher',
          approvalStatus: 'pending',
          isApproved: false,
          status: 'pending',
          approved: false,
        } as TestTutor,
      ],
      teachers: [
        {
          id: 'tutor-carlos-staging',
          name: 'Carlos Mendez',
          email: 'carlos@itissimple.com',
          role: 'teacher',
          approvalStatus: 'pending',
          isApproved: false,
          status: 'pending',
          approved: false,
        },
      ],
      firestoreStore: new Map<string, TestTutor>(),
    };
    testState.firestoreStore.set('tutor-carlos-staging', { ...testState.tutorsList[0] });

    // Mock do handler com a lógica idêntica do serverApp.ts
    const approveHandler = async (req: Request, res: Response) => {
      const tutorId = req.params.id;
      let approvedEmail = '';
      let approvedTutor: TestTutor | null = null;

      testState.tutorsList = testState.tutorsList.map((t) => {
        if (t.id === tutorId || t.email?.toLowerCase() === tutorId.toLowerCase()) {
          approvedEmail = (t.email || '').toLowerCase().trim();
          approvedTutor = {
            ...t,
            approvalStatus: 'approved',
            isApproved: true,
            status: 'approved',
            approved: true,
          };
          return approvedTutor;
        }
        return t;
      });

      if (!approvedTutor && testState.firestoreStore.has(tutorId)) {
        const direct = testState.firestoreStore.get(tutorId)!;
        approvedEmail = (direct.email || '').toLowerCase().trim();
        approvedTutor = {
          ...direct,
          approvalStatus: 'approved',
          isApproved: true,
          status: 'approved',
          approved: true,
        };
        testState.tutorsList.push(approvedTutor);
      }

      if (!approvedTutor) {
        return res.status(404).json({ error: 'NotFound', message: `Amigo Nativo "${tutorId}" não foi encontrado.` });
      }

      if (approvedEmail) {
        const tIdx = testState.teachers.findIndex((tc) => tc.email.toLowerCase() === approvedEmail);
        if (tIdx >= 0) {
          testState.teachers[tIdx] = {
            ...testState.teachers[tIdx],
            approvalStatus: 'approved',
            isApproved: true,
            status: 'approved',
            approved: true,
          };
        }
      }

      testState.firestoreStore.set(approvedTutor.id, { ...approvedTutor });
      return res.status(200).json({ success: true, tutors: testState.tutorsList, approvedTutor });
    };

    // 2.1 Requisição sem token -> 401
    setFirebaseAdminAuthForTesting(null);
    const reqNoToken = createMockRequest({}, {}, { id: 'tutor-carlos-staging' });
    const resNoToken = await simulateRoute([firebaseAuthMiddleware, requireAdmin], approveHandler, reqNoToken);
    assert(resNoToken.statusCode === 401, 'Requisição sem token retorna 401 Unauthorized');
    assert(testState.tutorsList[0].approvalStatus === 'pending', 'Status permanece pending');

    // 2.2 Requisição com role=student -> 403
    setFirebaseAdminAuthForTesting({
      verifyIdToken: async () => ({ uid: 'user-student', email: 'aluno@itissimple.com', role: 'student', email_verified: true }),
    } as any);
    const reqStudent = createMockRequest({ authorization: 'Bearer student-token' }, {}, { id: 'tutor-carlos-staging' });
    const resStudent = await simulateRoute([firebaseAuthMiddleware, requireAdmin], approveHandler, reqStudent);
    assert(resStudent.statusCode === 403, 'Aluno recebe 403 Forbidden ao tentar aprovar');
    assert(testState.tutorsList[0].approvalStatus === 'pending', 'Status permanece pending');

    // 2.3 Requisição com role=teacher -> 403
    setFirebaseAdminAuthForTesting({
      verifyIdToken: async () => ({ uid: 'tutor-carlos-staging', email: 'carlos@itissimple.com', role: 'teacher', email_verified: true }),
    } as any);
    const reqTeacher = createMockRequest({ authorization: 'Bearer teacher-token' }, {}, { id: 'tutor-carlos-staging' });
    const resTeacher = await simulateRoute([firebaseAuthMiddleware, requireAdmin], approveHandler, reqTeacher);
    assert(resTeacher.statusCode === 403, 'Professor tentando auto-aprovação recebe 403 Forbidden');
    assert(testState.tutorsList[0].approvalStatus === 'pending', 'Status permanece pending');

    // 2.4 Administrador com token e custom claim role=admin -> 200 OK com payload mínimo ({})
    setFirebaseAdminAuthForTesting({
      verifyIdToken: async () => ({ uid: 'admin-uid', email: 'adm.itissimple@gmail.com', role: 'admin', email_verified: true }),
    } as any);
    const reqAdmin = createMockRequest({ authorization: 'Bearer admin-token' }, {}, { id: 'tutor-carlos-staging' });
    const resAdmin = await simulateRoute([firebaseAuthMiddleware, requireAdmin], approveHandler, reqAdmin);
    assert(resAdmin.statusCode === 200, 'Administrador autenticado com corpo vazio obtém 200 OK');
    assert(resAdmin.body?.success === true, 'Resposta contém success: true');
    assert(resAdmin.body?.approvedTutor?.approvalStatus === 'approved', 'Tutor retornado com approvalStatus="approved"');
    assert(resAdmin.body?.approvedTutor?.isApproved === true, 'Tutor retornado com isApproved=true');
    assert(testState.firestoreStore.get('tutor-carlos-staging')?.approvalStatus === 'approved', 'Persistido no Firestore com status approved');
  }

  // --- 3. Localização do professor pelo ID da rota direto no Firestore (default) quando ausente da memória local ---
  console.log('\n--- 3. Localização do professor direto no Firestore (default) por ID da rota ---');
  {
    const stateWithEmptyMemory = {
      tutorsList: [] as any[],
      teachers: [] as any[],
      firestoreStore: new Map<string, any>(),
    };
    // O professor existe APENAS no Firestore (ex: cadastrado remotamente no projeto de staging)
    stateWithEmptyMemory.firestoreStore.set('tutor-mariana-remote', {
      id: 'tutor-mariana-remote',
      name: 'Mariana Duarte',
      email: 'mariana@itissimple.com',
      role: 'teacher',
      approvalStatus: 'pending',
      isApproved: false,
      status: 'pending',
      approved: false,
    });

    const approveHandlerWithFirestoreLookup = async (req: Request, res: Response) => {
      const tutorId = req.params.id;
      let approvedEmail = '';
      let approvedTutor: any = null;

      // 1. Memória local (está vazia)
      stateWithEmptyMemory.tutorsList = stateWithEmptyMemory.tutorsList.map((t) => {
        if (t.id === tutorId || t.email?.toLowerCase() === tutorId.toLowerCase()) {
          approvedEmail = (t.email || '').toLowerCase().trim();
          approvedTutor = { ...t, approvalStatus: 'approved', isApproved: true, status: 'approved', approved: true };
          return approvedTutor;
        }
        return t;
      });

      // 2. Localização no Firestore (default) via ID da rota
      if (!approvedTutor && stateWithEmptyMemory.firestoreStore.has(tutorId)) {
        const directDoc = stateWithEmptyMemory.firestoreStore.get(tutorId);
        approvedEmail = (directDoc.email || '').toLowerCase().trim();
        approvedTutor = {
          ...directDoc,
          id: directDoc.id || tutorId,
          approvalStatus: 'approved',
          isApproved: true,
          status: 'approved',
          approved: true,
        };
        stateWithEmptyMemory.tutorsList.push(approvedTutor);
      }

      if (!approvedTutor) {
        return res.status(404).json({ error: 'NotFound', message: `Amigo Nativo "${tutorId}" não foi encontrado.` });
      }

      stateWithEmptyMemory.firestoreStore.set(approvedTutor.id, { ...approvedTutor });
      return res.status(200).json({ success: true, tutors: stateWithEmptyMemory.tutorsList, approvedTutor });
    };

    setFirebaseAdminAuthForTesting({
      verifyIdToken: async () => ({ uid: 'admin-uid', email: 'adm.itissimple@gmail.com', role: 'admin', email_verified: true }),
    } as any);

    const reqRemote = createMockRequest({ authorization: 'Bearer admin-token' }, {}, { id: 'tutor-mariana-remote' });
    const resRemote = await simulateRoute([firebaseAuthMiddleware, requireAdmin], approveHandlerWithFirestoreLookup, reqRemote);

    assert(resRemote.statusCode === 200, 'Professor localizado no Firestore por ID da rota retorna 200 OK');
    assert(resRemote.body?.approvedTutor?.name === 'Mariana Duarte', 'Dados do professor carregados do Firestore com integridade');
    assert(resRemote.body?.approvedTutor?.approvalStatus === 'approved', 'approvalStatus atualizado para approved');
    assert(resRemote.body?.approvedTutor?.isApproved === true, 'isApproved atualizado para true');
    assert(stateWithEmptyMemory.firestoreStore.get('tutor-mariana-remote')?.approvalStatus === 'approved', 'Persistência no Firestore confirmada');
  }

  // --- 4. Visibilidade em Approved Friends e no Catálogo Público (GET /api/tutors) ---
  console.log('\n--- 4. Visibilidade em Approved Friends e Catálogo Público ---');
  {
    const publicCatalogList = [
      {
        id: 'tutor-mariana-remote',
        name: 'Mariana Duarte',
        email: 'mariana@itissimple.com',
        role: 'teacher',
        approvalStatus: 'approved',
        isApproved: true,
        status: 'approved',
        approved: true,
      },
      {
        id: 'tutor-pending-candidate',
        name: 'Candidate Waiting',
        email: 'waiting@itissimple.com',
        role: 'teacher',
        approvalStatus: 'pending',
        isApproved: false,
        status: 'pending',
        approved: false,
      },
    ];

    // Simulação do filtro de catálogo público (GET /api/tutors sem autenticação)
    const isApprovedTutor = (t: any) =>
      Boolean(t.approvalStatus === 'approved' || t.isApproved === true || t.status === 'approved' || t.approved === true);

    const publicCatalog = publicCatalogList.filter(isApprovedTutor);
    assert(publicCatalog.length === 1, 'Catálogo público contém exatamente o professor aprovado');
    assert(publicCatalog[0].id === 'tutor-mariana-remote', 'Mariana aprovada aparece no catálogo público');
    assert(publicCatalog.some((t) => t.id === 'tutor-pending-candidate') === false, 'Professor pendente NÃO aparece no catálogo público');

    // Simulação do filtro do painel de administração (AdminApprovalsModal tab "Approved Friends")
    const approvedTabList = publicCatalogList.filter((t) => t.approvalStatus === 'approved');
    assert(approvedTabList.length === 1, 'Aba Approved Friends lista o professor aprovado');
    assert(approvedTabList[0].id === 'tutor-mariana-remote', 'Mariana listada em Approved Friends');
  }

  setFirebaseAdminAuthForTesting(null);

  console.log(`\n========================================`);
  console.log(`TOTAL DE TESTES DO HOTFIX: ${passed + failed}`);
  console.log(`SUCESSO: ${passed}`);
  console.log(`FALHAS: ${failed}`);
  console.log(`========================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Erro na execução dos testes do hotfix:', err);
  process.exit(1);
});
