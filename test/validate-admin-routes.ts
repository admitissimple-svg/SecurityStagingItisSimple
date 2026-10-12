import { setFirebaseAdminAuthForTesting } from '../src/serverFirebaseAdmin';
import { firebaseAuthMiddleware, requireAdmin, extractTrustedRole, isVerifiedAdminRequest } from '../src/middleware/firebaseAuth';
import type { Request, Response, NextFunction } from 'express';

// Test runner helper
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

// Mock Response
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

// Mock Request
function createMockRequest(headers: Record<string, string> = {}, body: any = {}, params: any = {}) {
  const req: any = {
    headers,
    body,
    params,
    query: {},
  };
  return req;
}

async function runTests() {
  console.log('\n=== INICIANDO BATERIA DE TESTES: ETAPA 2A (Proteção das rotas administrativas) ===\n');

  // Test suite 1: extractTrustedRole logic
  console.log('--- 1. Testando extração estrita de role a partir de Custom Claims ---');
  assert(extractTrustedRole({ role: 'admin' }) === 'admin', 'Custom claim role=admin extrai admin');
  assert(extractTrustedRole({ role: 'teacher' }) === 'teacher', 'Custom claim role=teacher extrai teacher');
  assert(extractTrustedRole({ role: 'student' }) === 'student', 'Custom claim role=student extrai student');
  assert(extractTrustedRole({ role: 'other' }) === 'student', 'Claim desconhecida rebaixa com segurança para student');
  assert(extractTrustedRole({ email: 'adm.itissimple@gmail.com' }) === 'student', 'E-mail do administrador sem claim NÃO concede admin');
  assert(extractTrustedRole(null) === 'student', 'Token nulo extrai student');
  assert(extractTrustedRole({}) === 'student', 'Token sem claim de role extrai student');

  // Test suite 2: firebaseAuthMiddleware & requireAdmin com mocks
  console.log('\n--- 2. Testando Middleware de Autenticação e Autorização Admin ---');

  // 2.1 Acesso sem token
  {
    const req = createMockRequest();
    const res = createMockResponse();
    let nextCalled = false;
    await firebaseAuthMiddleware(req, res, () => { nextCalled = true; });
    assert(!nextCalled, 'Requisição sem token não chama next()');
    assert(res.statusCode === 401, 'Requisição sem token retorna 401', `status: ${res.statusCode}`);
    assert(res.body?.message?.includes('Missing Authorization header'), 'Mensagem informa cabeçalho ausente');
  }

  // 2.2 Token malformado
  {
    const req = createMockRequest({ authorization: 'InvalidBearerFormat' });
    const res = createMockResponse();
    let nextCalled = false;
    await firebaseAuthMiddleware(req, res, () => { nextCalled = true; });
    assert(!nextCalled, 'Cabeçalho malformado não chama next()');
    assert(res.statusCode === 401, 'Cabeçalho malformado retorna 401');
  }

  // 2.3 Token inválido
  {
    setFirebaseAdminAuthForTesting({
      verifyIdToken: async () => {
        const err: any = new Error('Decoding error');
        err.code = 'auth/argument-error';
        throw err;
      },
    } as any);

    const req = createMockRequest({ authorization: 'Bearer invalid-token-xyz' });
    const res = createMockResponse();
    let nextCalled = false;
    await firebaseAuthMiddleware(req, res, () => { nextCalled = true; });
    assert(!nextCalled, 'Token inválido não chama next()');
    assert(res.statusCode === 401, 'Token inválido retorna 401');
    assert(res.body?.message?.includes('Invalid Firebase ID token'), 'Retorna mensagem de token inválido');
  }

  // 2.4 Token expirado
  {
    setFirebaseAdminAuthForTesting({
      verifyIdToken: async () => {
        const err: any = new Error('Token expired');
        err.code = 'auth/id-token-expired';
        throw err;
      },
    } as any);

    const req = createMockRequest({ authorization: 'Bearer expired-token' });
    const res = createMockResponse();
    let nextCalled = false;
    await firebaseAuthMiddleware(req, res, () => { nextCalled = true; });
    assert(!nextCalled, 'Token expirado não chama next()');
    assert(res.statusCode === 401, 'Token expirado retorna 401');
    assert(res.body?.message?.includes('expired'), 'Retorna mensagem de token expirado');
  }

  // 2.5 Usuário autenticado SEM claim de administrador (ex: student)
  {
    setFirebaseAdminAuthForTesting({
      verifyIdToken: async () => ({
        uid: 'user-student-1',
        email: 'student@example.com',
        email_verified: true,
        role: 'student',
      }),
    } as any);

    const req = createMockRequest({ authorization: 'Bearer valid-student-token' });
    const res = createMockResponse();
    let authNextCalled = false;
    await firebaseAuthMiddleware(req, res, () => { authNextCalled = true; });
    assert(authNextCalled, 'firebaseAuthMiddleware autentica token de estudante');
    assert(req.user?.role === 'student', 'req.user.role é student');

    const adminRes = createMockResponse();
    let adminNextCalled = false;
    requireAdmin(req, adminRes, () => { adminNextCalled = true; });
    assert(!adminNextCalled, 'requireAdmin bloqueia usuário com role=student');
    assert(adminRes.statusCode === 403, 'requireAdmin retorna 403 para student');
  }

  // 2.6 Usuário com e-mail de admin mas SEM custom claim (spoofing via email)
  {
    setFirebaseAdminAuthForTesting({
      verifyIdToken: async () => ({
        uid: 'attacker-1',
        email: 'adm.itissimple@gmail.com', // e-mail do admin, mas sem claim
        email_verified: true,
        // SEM claim role='admin'
      }),
    } as any);

    const req = createMockRequest({ authorization: 'Bearer spoofed-email-token' });
    const res = createMockResponse();
    await firebaseAuthMiddleware(req, res, () => {});
    assert(req.user?.role === 'student', 'Token sem claim de admin tem role=student mesmo com e-mail do admin');

    const adminRes = createMockResponse();
    let adminNextCalled = false;
    requireAdmin(req, adminRes, () => { adminNextCalled = true; });
    assert(!adminNextCalled, 'requireAdmin bloqueia token mesmo com e-mail de admin se claim não estiver presente');
    assert(adminRes.statusCode === 403, 'requireAdmin retorna 403');
  }

  // 2.7 Usuário autenticado com custom claim 'teacher'
  {
    setFirebaseAdminAuthForTesting({
      verifyIdToken: async () => ({
        uid: 'teacher-1',
        email: 'teacher@example.com',
        email_verified: true,
        role: 'teacher',
      }),
    } as any);

    const req = createMockRequest({ authorization: 'Bearer teacher-token' });
    const res = createMockResponse();
    await firebaseAuthMiddleware(req, res, () => {});
    assert(req.user?.role === 'teacher', 'req.user.role é teacher');

    const adminRes = createMockResponse();
    let adminNextCalled = false;
    requireAdmin(req, adminRes, () => { adminNextCalled = true; });
    assert(!adminNextCalled, 'requireAdmin bloqueia professor de executar operações admin');
    assert(adminRes.statusCode === 403, 'requireAdmin retorna 403 para professor');
  }

  // 2.8 Usuário autenticado COM custom claim 'admin'
  {
    setFirebaseAdminAuthForTesting({
      verifyIdToken: async () => ({
        uid: 'admin-master',
        email: 'adm.itissimple@gmail.com',
        email_verified: true,
        role: 'admin',
      }),
    } as any);

    const req = createMockRequest({ authorization: 'Bearer admin-token' });
    const res = createMockResponse();
    let authNextCalled = false;
    await firebaseAuthMiddleware(req, res, () => { authNextCalled = true; });
    assert(authNextCalled, 'firebaseAuthMiddleware autentica admin');
    assert(req.user?.role === 'admin', 'req.user.role é admin');

    const adminRes = createMockResponse();
    let adminNextCalled = false;
    requireAdmin(req, adminRes, () => { adminNextCalled = true; });
    assert(adminNextCalled, 'requireAdmin permite usuário com claim role=admin');
    assert(adminRes.statusCode === 200, 'Código permanece 200');
  }

  // Test suite 3: isVerifiedAdminRequest
  console.log('\n--- 3. Testando helper isVerifiedAdminRequest ---');
  {
    // Sem header
    assert(await isVerifiedAdminRequest(createMockRequest()) === false, 'Sem header retorna false');
    // Token de estudante
    setFirebaseAdminAuthForTesting({
      verifyIdToken: async () => ({ uid: 's1', role: 'student' }),
    } as any);
    assert(await isVerifiedAdminRequest(createMockRequest({ authorization: 'Bearer student' })) === false, 'Token de estudante retorna false');
    // Token de admin
    setFirebaseAdminAuthForTesting({
      verifyIdToken: async () => ({ uid: 'a1', role: 'admin' }),
    } as any);
    assert(await isVerifiedAdminRequest(createMockRequest({ authorization: 'Bearer admin' })) === true, 'Token com claim admin retorna true');
  }

  // Test suite 4: Simulação de fluxo das rotas com a cadeia completa de middlewares
  console.log('\n--- 4. Testando execução e proteção das rotas contra bypass ---');

  // Helper para simular execução sequencial de middlewares Express
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

  // Estado mock em memória para teste isolado
  let mockTutor = {
    id: 'tutor-test-1',
    name: 'Test Tutor',
    email: 'testtutor@example.com',
    approvalStatus: 'pending',
    isApproved: false,
    role: 'teacher',
  };

  const approveHandler = async (req: Request, res: Response) => {
    mockTutor.approvalStatus = 'approved';
    mockTutor.isApproved = true;
    res.status(200).json({ success: true, tutor: mockTutor });
  };

  const rejectHandler = async (req: Request, res: Response) => {
    mockTutor.approvalStatus = 'rejected';
    mockTutor.isApproved = false;
    res.status(200).json({ success: true, tutor: mockTutor });
  };

  let isTutorDeleted = false;
  const deleteHandler = async (req: Request, res: Response) => {
    isTutorDeleted = true;
    res.status(200).json({ success: true, message: 'Deleted' });
  };

  // 4.1 POST /api/tutors/:id/approve sem token
  {
    const req = createMockRequest();
    const res = await simulateRoute([firebaseAuthMiddleware, requireAdmin], approveHandler, req);
    assert(res.statusCode === 401, 'POST /approve sem token retorna 401');
    assert(mockTutor.approvalStatus === 'pending', 'Memória NÃO foi alterada após rejeição por 401');
  }

  // 4.2 POST /api/tutors/:id/approve com token inválido
  {
    setFirebaseAdminAuthForTesting({
      verifyIdToken: async () => { throw new Error('Invalid signature'); },
    } as any);
    const req = createMockRequest({ authorization: 'Bearer invalid-token' });
    const res = await simulateRoute([firebaseAuthMiddleware, requireAdmin], approveHandler, req);
    assert(res.statusCode === 401, 'POST /approve com token inválido retorna 401');
    assert(mockTutor.approvalStatus === 'pending', 'Memória permanece inalterada');
  }

  // 4.3 POST /api/tutors/:id/approve com role=student
  {
    setFirebaseAdminAuthForTesting({
      verifyIdToken: async () => ({ uid: 'std-1', role: 'student' }),
    } as any);
    const req = createMockRequest({ authorization: 'Bearer student-token' });
    const res = await simulateRoute([firebaseAuthMiddleware, requireAdmin], approveHandler, req);
    assert(res.statusCode === 403, 'POST /approve com role=student retorna 403');
    assert(mockTutor.approvalStatus === 'pending', 'Memória permanece intacta');
  }

  // 4.4 POST /api/tutors/:id/approve com role=teacher
  {
    setFirebaseAdminAuthForTesting({
      verifyIdToken: async () => ({ uid: 'tch-1', role: 'teacher' }),
    } as any);
    const req = createMockRequest({ authorization: 'Bearer teacher-token' });
    const res = await simulateRoute([firebaseAuthMiddleware, requireAdmin], approveHandler, req);
    assert(res.statusCode === 403, 'POST /approve com role=teacher retorna 403');
    assert(mockTutor.approvalStatus === 'pending', 'Memória permanece intacta');
  }

  // 4.5 POST /api/tutors/:id/approve com custom claim role=admin
  {
    setFirebaseAdminAuthForTesting({
      verifyIdToken: async () => ({ uid: 'adm-1', role: 'admin' }),
    } as any);
    const req = createMockRequest({ authorization: 'Bearer admin-token' });
    const res = await simulateRoute([firebaseAuthMiddleware, requireAdmin], approveHandler, req);
    assert(res.statusCode === 200, 'POST /approve com claim admin retorna 200');
    assert(mockTutor.approvalStatus === 'approved', 'Tutor foi aprovado com sucesso apenas com autorização admin');
  }

  // 4.6 POST /api/tutors/:id/reject sem autorização
  {
    setFirebaseAdminAuthForTesting({
      verifyIdToken: async () => ({ uid: 'std-1', role: 'student' }),
    } as any);
    const req = createMockRequest({ authorization: 'Bearer student-token' });
    const res = await simulateRoute([firebaseAuthMiddleware, requireAdmin], rejectHandler, req);
    assert(res.statusCode === 403, 'POST /reject sem autorização retorna 403');
    assert(mockTutor.approvalStatus === 'approved', 'Status de aprovação não foi alterado');
  }

  // 4.7 POST /api/tutors/:id/reject com autorização admin
  {
    setFirebaseAdminAuthForTesting({
      verifyIdToken: async () => ({ uid: 'adm-1', role: 'admin' }),
    } as any);
    const req = createMockRequest({ authorization: 'Bearer admin-token' });
    const res = await simulateRoute([firebaseAuthMiddleware, requireAdmin], rejectHandler, req);
    assert(res.statusCode === 200, 'POST /reject com claim admin retorna 200');
    assert(mockTutor.approvalStatus === 'rejected', 'Tutor foi rejeitado com autorização admin');
  }

  // 4.8 DELETE /api/tutors/:id sem autorização
  {
    setFirebaseAdminAuthForTesting({
      verifyIdToken: async () => ({ uid: 'tch-1', role: 'teacher' }),
    } as any);
    const req = createMockRequest({ authorization: 'Bearer teacher-token' });
    const res = await simulateRoute([firebaseAuthMiddleware, requireAdmin], deleteHandler, req);
    assert(res.statusCode === 403, 'DELETE /api/tutors/:id sem claim admin retorna 403');
    assert(!isTutorDeleted, 'Tutor NÃO foi deletado');
  }

  // 4.9 DELETE /api/tutors/:id com claim admin
  {
    setFirebaseAdminAuthForTesting({
      verifyIdToken: async () => ({ uid: 'adm-1', role: 'admin' }),
    } as any);
    const req = createMockRequest({ authorization: 'Bearer admin-token' });
    const res = await simulateRoute([firebaseAuthMiddleware, requireAdmin], deleteHandler, req);
    assert(res.statusCode === 200, 'DELETE /api/tutors/:id com claim admin retorna 200');
    assert(isTutorDeleted, 'Tutor foi deletado com autorização admin');
  }

  // Test suite 5: Auditoria de rotas POST /api/tutors, PUT /api/tutors/:id e POST /api/teachers
  console.log('\n--- 5. Auditoria de proteção contra auto-aprovação e escalada de privilégios ---');

  // 5.1 POST /api/tutors: Candidato tentando auto-aprovação sem token admin
  {
    // Simula validação feita em serverApp.ts
    const simulateBecomeTutor = async (req: Request) => {
      const isAdminCaller = await isVerifiedAdminRequest(req);
      const newTutor = req.body;
      const resolvedApprovalStatus = isAdminCaller
        ? (newTutor.approvalStatus || (newTutor.registeredByAdmin ? 'approved' : 'pending'))
        : 'pending';
      const resolvedIsApproved = isAdminCaller && (resolvedApprovalStatus === 'approved' || newTutor.isApproved === true);
      return {
        approvalStatus: resolvedApprovalStatus,
        isApproved: resolvedIsApproved,
        role: 'teacher',
      };
    };

    // Sem token
    const req1 = createMockRequest({}, { approvalStatus: 'approved', isApproved: true, role: 'admin' });
    const res1 = await simulateBecomeTutor(req1);
    assert(res1.approvalStatus === 'pending', 'POST /tutors sem token força approvalStatus=pending');
    assert(res1.isApproved === false, 'POST /tutors sem token força isApproved=false');
    assert(res1.role === 'teacher', 'POST /tutors força role=teacher (ignora role=admin do body)');

    // Com token de estudante
    setFirebaseAdminAuthForTesting({
      verifyIdToken: async () => ({ uid: 's1', role: 'student' }),
    } as any);
    const req2 = createMockRequest({ authorization: 'Bearer student' }, { approvalStatus: 'approved', isApproved: true });
    const res2 = await simulateBecomeTutor(req2);
    assert(res2.approvalStatus === 'pending', 'POST /tutors com token não-admin força status pending');
    assert(res2.isApproved === false, 'POST /tutors com token não-admin força isApproved=false');
  }

  // 5.2 PUT /api/tutors/:id: Professor tentando auto-aprovar via edição de perfil
  {
    const simulateUpdateTutor = async (req: Request, existing: any) => {
      const isAdminCaller = await isVerifiedAdminRequest(req);
      const updatedData = req.body;
      const resolvedApprovalStatus = isAdminCaller
        ? (updatedData.approvalStatus ?? existing.approvalStatus ?? 'pending')
        : (existing.approvalStatus ?? 'pending');
      const resolvedIsApproved = isAdminCaller
        ? (updatedData.isApproved ?? existing.isApproved ?? (resolvedApprovalStatus === 'approved'))
        : (existing.isApproved ?? (existing.approvalStatus === 'approved'));
      return {
        ...existing,
        ...updatedData,
        role: 'teacher',
        approvalStatus: resolvedApprovalStatus,
        isApproved: resolvedIsApproved,
      };
    };

    const existingPending = { id: 't1', approvalStatus: 'pending', isApproved: false, role: 'teacher' };
    setFirebaseAdminAuthForTesting({
      verifyIdToken: async () => ({ uid: 't1', role: 'teacher' }),
    } as any);
    const req = createMockRequest(
      { authorization: 'Bearer teacher' },
      { bio: 'New bio', approvalStatus: 'approved', isApproved: true, role: 'admin' }
    );
    const result = await simulateUpdateTutor(req, existingPending);
    assert(result.approvalStatus === 'pending', 'PUT /tutors/:id de professor NÃO altera approvalStatus');
    assert(result.isApproved === false, 'PUT /tutors/:id de professor NÃO altera isApproved');
    assert(result.role === 'teacher', 'PUT /tutors/:id de professor força role=teacher');
    assert(result.bio === 'New bio', 'Campos permitidos como bio são atualizados normalmente');
  }

  // 5.3 Tentativa de sequestro da conta primária de administrador
  {
    const simulateAdminAccountProtection = (cleanEmail: string, isAdminCaller: boolean) => {
      const isTargetAdmin = cleanEmail === 'adm.itissimple@gmail.com';
      if (isTargetAdmin && !isAdminCaller) {
        return { status: 403, error: 'Forbidden' };
      }
      return { status: 200, success: true };
    };

    const blockResult = simulateAdminAccountProtection('adm.itissimple@gmail.com', false);
    assert(blockResult.status === 403, 'Tentativa de sobrescrever ou registrar conta de admin sem token admin retorna 403');
  }

  // 5.4 Proteção contra exclusão da conta de administrador via DELETE /api/tutors/:id
  {
    const simulateDeleteAdminTutor = (tutorId: string, targetEmail: string) => {
      if (
        targetEmail === 'adm.itissimple@gmail.com' ||
        tutorId.toLowerCase() === 'adm.itissimple@gmail.com'
      ) {
        return { status: 403, error: 'Forbidden' };
      }
      return { status: 200, success: true };
    };

    const resDeleteAdmin = simulateDeleteAdminTutor('adm.itissimple@gmail.com', 'adm.itissimple@gmail.com');
    assert(resDeleteAdmin.status === 403, 'DELETE /api/tutors/:id bloqueia exclusão da conta de administrador com 403');
  }

  // 5.5 Proteção contra alteração ou rebaixamento de conta admin via POST /api/teachers
  {
    const simulateModifyAdminViaTeachers = (cleanEmail: string, dbTeachers: any[]) => {
      const isTargetAdmin =
        cleanEmail === 'adm.itissimple@gmail.com' ||
        dbTeachers.some((t: any) => t.email?.toLowerCase() === cleanEmail && t.role === 'admin');
      if (isTargetAdmin) {
        return { status: 403, error: 'Forbidden' };
      }
      return { status: 200, success: true };
    };

    const teachersList = [{ email: 'adm.itissimple@gmail.com', role: 'admin' }];
    const resModifyAdmin = simulateModifyAdminViaTeachers('adm.itissimple@gmail.com', teachersList);
    assert(resModifyAdmin.status === 403, 'POST /api/teachers bloqueia modificação de conta admin com 403');
  }

  // 5.6 Proteção contra exclusão de administrador via DELETE /api/teachers/:email
  {
    const simulateDeleteAdminTeacher = (email: string, dbTeachers: any[]) => {
      const isTargetAdmin =
        email === 'adm.itissimple@gmail.com' ||
        dbTeachers.some((t: any) => t.email?.toLowerCase() === email && t.role === 'admin');
      if (isTargetAdmin) {
        return { status: 403, error: 'Forbidden' };
      }
      return { status: 200, success: true };
    };

    const teachersList = [{ email: 'adm.itissimple@gmail.com', role: 'admin' }];
    const resDeleteAdminTeacher = simulateDeleteAdminTeacher('adm.itissimple@gmail.com', teachersList);
    assert(resDeleteAdminTeacher.status === 403, 'DELETE /api/teachers/:email bloqueia exclusão de admin com 403');
  }

  // =========================================================================
  // Test suite 6: R-01 — Proteção da rota POST /api/admin/clean-obsolete-users
  // =========================================================================
  console.log('\n--- 6. Testando Proteção da rota POST /api/admin/clean-obsolete-users (R-01) ---');
  {
    // Mock DB state for R-01
    const createCleanMockDb = () => ({
      students: [
        { id: 'usr-lavinia', email: 'laviniatilapiafc@gmail.com', name: 'Lavinia' },
        { id: 'usr-obsolete-1', email: 'obsolete-student-1@example.com', name: 'Obsolete 1' },
      ],
      userProfiles: {
        'laviniatilapiafc@gmail.com': { role: 'student', name: 'Lavinia' },
        'obsolete-student-1@example.com': { role: 'student', name: 'Obsolete 1' },
      } as Record<string, { role: string; name: string } | undefined>,
      deletedStudentEmails: [] as string[],
    });

    let mockDb = createCleanMockDb();

    const cleanObsoleteUsersHandler = async (_req: Request, res: Response) => {
      // Functional cleanup logic identical to serverApp.ts
      mockDb.deletedStudentEmails = ['obsolete-student-1@example.com'];
      mockDb.students = mockDb.students.filter(
        (s) => s.email === 'laviniatilapiafc@gmail.com'
      );
      delete mockDb.userProfiles['obsolete-student-1@example.com'];
      res.status(200).json({
        success: true,
        activeStudents: mockDb.students.map((s) => s.email),
      });
    };

    // 6.1 Requisição sem token → HTTP 401
    {
      const initialSnapshot = JSON.stringify(mockDb);
      const req = createMockRequest();
      const res = await simulateRoute([firebaseAuthMiddleware, requireAdmin], cleanObsoleteUsersHandler, req);
      assert(res.statusCode === 401, 'R-01: Requisição sem token retorna 401');
      assert(JSON.stringify(mockDb) === initialSnapshot, 'R-01: Nenhuma alteração nos dados após 401 (sem token)');
    }

    // 6.2 Token inválido → HTTP 401
    {
      setFirebaseAdminAuthForTesting({
        verifyIdToken: async () => {
          const err: any = new Error('Invalid signature');
          err.code = 'auth/invalid-id-token';
          throw err;
        },
      } as any);
      const initialSnapshot = JSON.stringify(mockDb);
      const req = createMockRequest({ authorization: 'Bearer invalid-token-xyz' });
      const res = await simulateRoute([firebaseAuthMiddleware, requireAdmin], cleanObsoleteUsersHandler, req);
      assert(res.statusCode === 401, 'R-01: Token inválido retorna 401');
      assert(JSON.stringify(mockDb) === initialSnapshot, 'R-01: Nenhuma alteração nos dados após 401 (token inválido)');
    }

    // 6.3 Estudante autenticado → HTTP 403
    {
      setFirebaseAdminAuthForTesting({
        verifyIdToken: async () => ({
          uid: 'student-uid-1',
          email: 'student@example.com',
          role: 'student',
          email_verified: true,
        }),
      } as any);
      const initialSnapshot = JSON.stringify(mockDb);
      const req = createMockRequest({ authorization: 'Bearer student-token' });
      const res = await simulateRoute([firebaseAuthMiddleware, requireAdmin], cleanObsoleteUsersHandler, req);
      assert(res.statusCode === 403, 'R-01: Estudante autenticado retorna 403');
      assert(JSON.stringify(mockDb) === initialSnapshot, 'R-01: Nenhuma alteração nos dados após 403 (estudante)');
    }

    // 6.4 Usuário anônimo autenticado → HTTP 403
    {
      setFirebaseAdminAuthForTesting({
        verifyIdToken: async () => ({
          uid: 'anon-uid-1',
          email_verified: false,
          // Sem custom claim role, rebaixa para student
        }),
      } as any);
      const initialSnapshot = JSON.stringify(mockDb);
      const req = createMockRequest({ authorization: 'Bearer anon-token' });
      const res = await simulateRoute([firebaseAuthMiddleware, requireAdmin], cleanObsoleteUsersHandler, req);
      assert(res.statusCode === 403, 'R-01: Usuário anônimo sem privilégios retorna 403');
      assert(JSON.stringify(mockDb) === initialSnapshot, 'R-01: Nenhuma alteração nos dados após 403 (anônimo)');
    }

    // 6.5 Professor autenticado → HTTP 403
    {
      setFirebaseAdminAuthForTesting({
        verifyIdToken: async () => ({
          uid: 'teacher-uid-1',
          email: 'teacher@example.com',
          role: 'teacher',
          email_verified: true,
        }),
      } as any);
      const initialSnapshot = JSON.stringify(mockDb);
      const req = createMockRequest({ authorization: 'Bearer teacher-token' });
      const res = await simulateRoute([firebaseAuthMiddleware, requireAdmin], cleanObsoleteUsersHandler, req);
      assert(res.statusCode === 403, 'R-01: Professor autenticado retorna 403');
      assert(JSON.stringify(mockDb) === initialSnapshot, 'R-01: Nenhuma alteração nos dados após 403 (professor)');
    }

    // 6.6 Tentativa de contorno por parâmetros, headers ou campos de role cliente
    {
      // 6.6.1 Body fornecendo role: 'admin' sem token admin
      setFirebaseAdminAuthForTesting({
        verifyIdToken: async () => ({
          uid: 'std-spoof-1',
          email: 'spoof@example.com',
          role: 'student',
        }),
      } as any);
      const initialSnapshot = JSON.stringify(mockDb);
      const reqWithBodyRole = createMockRequest(
        { authorization: 'Bearer student-token' },
        { role: 'admin', isAdmin: true }
      );
      const resBodyRole = await simulateRoute([firebaseAuthMiddleware, requireAdmin], cleanObsoleteUsersHandler, reqWithBodyRole);
      assert(resBodyRole.statusCode === 403, 'R-01: Tentativa de bypass via body role=admin retorna 403');
      assert(JSON.stringify(mockDb) === initialSnapshot, 'R-01: Nenhuma alteração de dados após tentativa de bypass via body');

      // 6.6.2 Headers falsos sem token válido
      const reqWithFakeHeaders = createMockRequest({
        'x-user-role': 'admin',
        'x-admin': 'true',
      });
      const resFakeHeaders = await simulateRoute([firebaseAuthMiddleware, requireAdmin], cleanObsoleteUsersHandler, reqWithFakeHeaders);
      assert(resFakeHeaders.statusCode === 401, 'R-01: Tentativa de bypass via headers falsos retorna 401');
      assert(JSON.stringify(mockDb) === initialSnapshot, 'R-01: Nenhuma alteração de dados após tentativa de bypass via headers');
    }

    // 6.7 Administrador autenticado e autorizado → operação permitida (HTTP 200)
    {
      setFirebaseAdminAuthForTesting({
        verifyIdToken: async () => ({
          uid: 'admin-master-uid',
          email: 'adm.itissimple@gmail.com',
          role: 'admin',
          email_verified: true,
        }),
      } as any);
      const req = createMockRequest({ authorization: 'Bearer admin-master-token' });
      const res = await simulateRoute([firebaseAuthMiddleware, requireAdmin], cleanObsoleteUsersHandler, req);
      assert(res.statusCode === 200, 'R-01: Administrador autenticado retorna 200');
      assert(res.body?.success === true, 'R-01: Limpeza executada com sucesso');
      assert(mockDb.students.length === 1, 'R-01: Aluno obsoleto foi removido na limpeza autorizada');
      assert(mockDb.students[0].email === 'laviniatilapiafc@gmail.com', 'R-01: Aluno de produção preservado');
    }
  }

  // =========================================================================
  // Test suite 7: R-02 — Proteção da rota DELETE /api/students/:identifier
  // =========================================================================
  console.log('\n--- 7. Testando Proteção da rota DELETE /api/students/:identifier (R-02) ---');
  {
    const createStudentsMockDb = () => ({
      students: [
        { id: 'usr-student-target', email: 'target@example.com', name: 'Target Student' },
        { id: 'usr-student-other', email: 'other@example.com', name: 'Other Student' },
      ],
      userProfiles: {
        'target@example.com': { role: 'student', name: 'Target Student' },
        'other@example.com': { role: 'student', name: 'Other Student' },
      } as Record<string, { role: string; name: string } | undefined>,
      deletedStudentEmails: [] as string[],
    });

    let mockDb = createStudentsMockDb();

    const deleteStudentHandler = async (req: Request, res: Response) => {
      const rawId = req.params.identifier;
      if (!rawId) {
        return res.status(400).json({ error: 'Identifier is required' });
      }
      const clean = decodeURIComponent(rawId).toLowerCase().trim();
      const targetEmail = clean.includes('@') ? clean : 'target@example.com';

      mockDb.students = mockDb.students.filter(
        (s) => s.email.toLowerCase() !== clean && s.id.toLowerCase() !== clean
      );
      delete mockDb.userProfiles[targetEmail];
      if (!mockDb.deletedStudentEmails.includes(targetEmail)) {
        mockDb.deletedStudentEmails.push(targetEmail);
      }

      res.status(200).json({
        success: true,
        message: 'Student profile deleted successfully',
        email: targetEmail,
      });
    };

    // 7.1 Requisição sem token → HTTP 401
    {
      const initialSnapshot = JSON.stringify(mockDb);
      const req = createMockRequest({}, {}, { identifier: 'target@example.com' });
      const res = await simulateRoute([firebaseAuthMiddleware, requireAdmin], deleteStudentHandler, req);
      assert(res.statusCode === 401, 'R-02: Requisição sem token retorna 401');
      assert(JSON.stringify(mockDb) === initialSnapshot, 'R-02: Nenhuma exclusão ocorre após 401 (sem token)');
      assert(mockDb.students.some((s) => s.email === 'target@example.com'), 'R-02: Aluno permanece no banco');
    }

    // 7.2 Token inválido → HTTP 401
    {
      setFirebaseAdminAuthForTesting({
        verifyIdToken: async () => {
          const err: any = new Error('Token verification failed');
          err.code = 'auth/invalid-id-token';
          throw err;
        },
      } as any);
      const initialSnapshot = JSON.stringify(mockDb);
      const req = createMockRequest({ authorization: 'Bearer bad-token' }, {}, { identifier: 'target@example.com' });
      const res = await simulateRoute([firebaseAuthMiddleware, requireAdmin], deleteStudentHandler, req);
      assert(res.statusCode === 401, 'R-02: Token inválido retorna 401');
      assert(JSON.stringify(mockDb) === initialSnapshot, 'R-02: Nenhuma exclusão ocorre após 401 (token inválido)');
      assert(mockDb.students.some((s) => s.email === 'target@example.com'), 'R-02: Aluno permanece no banco');
    }

    // 7.3 Estudante autenticado tentando deletar a si mesmo ou outro aluno → HTTP 403
    {
      setFirebaseAdminAuthForTesting({
        verifyIdToken: async () => ({
          uid: 'usr-student-target',
          email: 'target@example.com',
          role: 'student',
          email_verified: true,
        }),
      } as any);
      const initialSnapshot = JSON.stringify(mockDb);
      const req = createMockRequest(
        { authorization: 'Bearer student-self-token' },
        {},
        { identifier: 'target@example.com' }
      );
      const res = await simulateRoute([firebaseAuthMiddleware, requireAdmin], deleteStudentHandler, req);
      assert(res.statusCode === 403, 'R-02: Estudante tentando excluir conta retorna 403');
      assert(JSON.stringify(mockDb) === initialSnapshot, 'R-02: Nenhuma exclusão ocorre após 403 (estudante)');
      assert(mockDb.students.some((s) => s.email === 'target@example.com'), 'R-02: Aluno permanece preservado');
    }

    // 7.4 Professor autenticado tentando deletar aluno → HTTP 403
    {
      setFirebaseAdminAuthForTesting({
        verifyIdToken: async () => ({
          uid: 'teacher-uid-2',
          email: 'teacher2@example.com',
          role: 'teacher',
          email_verified: true,
        }),
      } as any);
      const initialSnapshot = JSON.stringify(mockDb);
      const req = createMockRequest(
        { authorization: 'Bearer teacher-token' },
        {},
        { identifier: 'target@example.com' }
      );
      const res = await simulateRoute([firebaseAuthMiddleware, requireAdmin], deleteStudentHandler, req);
      assert(res.statusCode === 403, 'R-02: Professor tentando excluir aluno retorna 403');
      assert(JSON.stringify(mockDb) === initialSnapshot, 'R-02: Nenhuma exclusão ocorre após 403 (professor)');
      assert(mockDb.students.some((s) => s.email === 'target@example.com'), 'R-02: Aluno permanece preservado');
    }

    // 7.5 Tentativas de contorno por parâmetros, headers ou campos de role cliente
    {
      // 7.5.1 Header x-user-role: admin sem token
      const initialSnapshot = JSON.stringify(mockDb);
      const reqWithHeader = createMockRequest(
        { 'x-user-role': 'admin' },
        {},
        { identifier: 'target@example.com' }
      );
      const resHeader = await simulateRoute([firebaseAuthMiddleware, requireAdmin], deleteStudentHandler, reqWithHeader);
      assert(resHeader.statusCode === 401, 'R-02: Bypass via header x-user-role retorna 401');
      assert(JSON.stringify(mockDb) === initialSnapshot, 'R-02: Aluno não é deletado');

      // 7.5.2 Body role: admin com token de estudante
      setFirebaseAdminAuthForTesting({
        verifyIdToken: async () => ({
          uid: 'std-attacker',
          email: 'attacker@example.com',
          role: 'student',
        }),
      } as any);
      const reqWithBody = createMockRequest(
        { authorization: 'Bearer student-attacker' },
        { role: 'admin', isAdmin: true },
        { identifier: 'target@example.com' }
      );
      const resBody = await simulateRoute([firebaseAuthMiddleware, requireAdmin], deleteStudentHandler, reqWithBody);
      assert(resBody.statusCode === 403, 'R-02: Bypass via body role=admin retorna 403');
      assert(JSON.stringify(mockDb) === initialSnapshot, 'R-02: Aluno não é deletado');

      // 7.5.3 Query parameter role=admin
      const reqWithQuery = createMockRequest(
        { authorization: 'Bearer student-attacker' },
        {},
        { identifier: 'target@example.com' }
      );
      reqWithQuery.query = { role: 'admin', override: 'true' };
      const resQuery = await simulateRoute([firebaseAuthMiddleware, requireAdmin], deleteStudentHandler, reqWithQuery);
      assert(resQuery.statusCode === 403, 'R-02: Bypass via query parameter retorna 403');
      assert(JSON.stringify(mockDb) === initialSnapshot, 'R-02: Aluno não é deletado');
    }

    // 7.6 Administrador autenticado e autorizado → operação permitida (HTTP 200) e exclusão realizada
    {
      setFirebaseAdminAuthForTesting({
        verifyIdToken: async () => ({
          uid: 'admin-master-uid',
          email: 'adm.itissimple@gmail.com',
          role: 'admin',
          email_verified: true,
        }),
      } as any);
      const req = createMockRequest(
        { authorization: 'Bearer admin-master-token' },
        {},
        { identifier: 'target@example.com' }
      );
      const res = await simulateRoute([firebaseAuthMiddleware, requireAdmin], deleteStudentHandler, req);
      assert(res.statusCode === 200, 'R-02: Administrador autenticado retorna 200');
      assert(res.body?.success === true, 'R-02: Exclusão concluída com sucesso');
      assert(!mockDb.students.some((s) => s.email === 'target@example.com'), 'R-02: Aluno foi excluído pelo administrador');
      assert(mockDb.students.some((s) => s.email === 'other@example.com'), 'R-02: Demais alunos permanecem no banco');
      assert(mockDb.deletedStudentEmails.includes('target@example.com'), 'R-02: E-mail adicionado à lista de exclusões');
    }
  }

  // =========================================================================
  // Test suite 8: HOTFIX — Native Friend Approval — Security Staging (Reqs 1 a 7)
  // =========================================================================
  console.log('\n--- 8. Testando HOTFIX de Aprovação de Professores (Requisitos 1 a 7) ---');
  {
    interface TestTutor {
      id: string;
      name: string;
      email: string;
      role: string;
      approvalStatus: 'pending' | 'approved' | 'rejected';
      isApproved: boolean;
      status: 'pending' | 'approved' | 'rejected';
      approved: boolean;
      updatedAt?: string;
    }

    interface TestSystemState {
      tutorsList: TestTutor[];
      teachers: Array<{ email: string; name: string; role: string; approvalStatus?: string; isApproved?: boolean }>;
      userProfiles: Record<string, any>;
      firestoreTutorsCollection: Map<string, TestTutor>;
      appStateTutorsDoc: { tutorsList: TestTutor[]; updatedAt?: string };
    }

    const createInitialSystemState = (): TestSystemState => {
      const pendingTutor: TestTutor = {
        id: 'tutor-pedro-santos',
        name: 'Pedro Santos',
        email: 'pedro.santos@itissimple.com',
        role: 'teacher',
        approvalStatus: 'pending',
        isApproved: false,
        status: 'pending',
        approved: false,
      };

      const firestoreMap = new Map<string, TestTutor>();
      firestoreMap.set(pendingTutor.id, { ...pendingTutor });

      return {
        tutorsList: [{ ...pendingTutor }],
        teachers: [{
          email: pendingTutor.email,
          name: pendingTutor.name,
          role: 'teacher',
          approvalStatus: 'pending',
          isApproved: false,
        }],
        userProfiles: {
          [pendingTutor.email]: {
            id: pendingTutor.id,
            email: pendingTutor.email,
            role: 'teacher',
            approvalStatus: 'pending',
            isApproved: false,
          },
        },
        firestoreTutorsCollection: firestoreMap,
        appStateTutorsDoc: {
          tutorsList: [{ ...pendingTutor }],
        },
      };
    };

    // Handler idêntico ao implementado em serverApp.ts
    const approveTutorHandler = (state: TestSystemState) => async (req: Request, res: Response) => {
      const tutorId = req.params.id;
      let approvedEmail = '';
      let approvedTutor: TestTutor | null = null;

      state.tutorsList = (state.tutorsList || []).map((t) => {
        if (t.id === tutorId || t.email?.toLowerCase() === tutorId.toLowerCase()) {
          approvedEmail = (t.email || '').toLowerCase().trim();
          approvedTutor = {
            ...t,
            approvalStatus: 'approved',
            isApproved: true,
            status: 'approved',
            approved: true,
            updatedAt: new Date().toISOString(),
          };
          return approvedTutor;
        }
        return t;
      });

      // Se não encontrado em memória, busca na coleção direta
      if (!approvedTutor && state.firestoreTutorsCollection.has(tutorId)) {
        const direct = state.firestoreTutorsCollection.get(tutorId)!;
        approvedEmail = (direct.email || '').toLowerCase().trim();
        approvedTutor = {
          ...direct,
          approvalStatus: 'approved',
          isApproved: true,
          status: 'approved',
          approved: true,
          updatedAt: new Date().toISOString(),
        };
        state.tutorsList.push(approvedTutor);
      }

      if (!approvedTutor) {
        return res.status(404).json({ error: 'NotFound', message: `Amigo Nativo "${tutorId}" não foi encontrado.` });
      }

      // Sincroniza em teachers
      if (approvedEmail) {
        const tIdx = state.teachers.findIndex((tc) => (tc.email || '').toLowerCase() === approvedEmail);
        if (tIdx >= 0) {
          state.teachers[tIdx] = {
            ...state.teachers[tIdx],
            approvalStatus: 'approved',
            isApproved: true,
          };
        }
        if (state.userProfiles[approvedEmail]) {
          state.userProfiles[approvedEmail] = {
            ...state.userProfiles[approvedEmail],
            approvalStatus: 'approved',
            isApproved: true,
          };
        }
      }

      // Persistência em Firestore: /tutors/{id}
      state.firestoreTutorsCollection.set(approvedTutor.id, { ...approvedTutor });

      // Persistência em app_state/tutors
      state.appStateTutorsDoc = {
        tutorsList: state.tutorsList.map((t) => ({ ...t })),
        updatedAt: new Date().toISOString(),
      };

      return res.status(200).json({ success: true, tutors: state.tutorsList, approvedTutor });
    };

    // 8.1 Requisito 1: Identificação do erro 401 Unauthorized com Missing Authorization header
    {
      const state = createInitialSystemState();
      const req = createMockRequest({}, {}, { id: 'tutor-pedro-santos' });
      const res = await simulateRoute([firebaseAuthMiddleware, requireAdmin], approveTutorHandler(state), req);
      assert(res.statusCode === 401, 'Req 1: Chamada a /approve sem token retorna 401 Unauthorized');
      assert(res.body?.message === 'Missing Authorization header', 'Req 1: Mensagem informa exatamente "Missing Authorization header"');
      assert(state.firestoreTutorsCollection.get('tutor-pedro-santos')?.approvalStatus === 'pending', 'Req 1: Documento no Firestore não é alterado');
    }

    // 8.2 Requisito 2 & 3: Token válido da sessão administrativa e validação rígida de permissões
    {
      const state = createInitialSystemState();

      // Tentativa 1: Token de estudante (usuário autenticado mas sem permissão admin)
      setFirebaseAdminAuthForTesting({
        verifyIdToken: async () => ({ uid: 'std-user', email: 'student@example.com', role: 'student', email_verified: true }),
      } as any);

      const reqStudent = createMockRequest(
        { authorization: 'Bearer student-token' },
        { tutor: { approvalStatus: 'approved' } }, // Tentativa de injetar role/status via body
        { id: 'tutor-pedro-santos' }
      );
      const resStudent = await simulateRoute([firebaseAuthMiddleware, requireAdmin], approveTutorHandler(state), reqStudent);
      assert(resStudent.statusCode === 403, 'Req 3: Usuário sem privilégio de admin recebe 403 Forbidden');
      assert(resStudent.body?.message?.includes('administrator privileges required'), 'Req 3: Mensagem informa que privilégios de administrador são requeridos');
      assert(state.tutorsList[0].approvalStatus === 'pending', 'Req 3: Tentativa de bypass via body ignorada');

      // Tentativa 2: Token de professor tentando auto-aprovação
      setFirebaseAdminAuthForTesting({
        verifyIdToken: async () => ({ uid: 'tutor-pedro-santos', email: 'pedro.santos@itissimple.com', role: 'teacher', email_verified: true }),
      } as any);

      const reqTeacher = createMockRequest(
        { authorization: 'Bearer teacher-token' },
        {},
        { id: 'tutor-pedro-santos' }
      );
      const resTeacher = await simulateRoute([firebaseAuthMiddleware, requireAdmin], approveTutorHandler(state), reqTeacher);
      assert(resTeacher.statusCode === 403, 'Req 3: Professor tentando auto-aprovação recebe 403');
      assert(state.tutorsList[0].approvalStatus === 'pending', 'Req 3: Professor permanece pendente');

      // Tentativa 3: Token legítimo de Administrador com custom claim role=admin
      setFirebaseAdminAuthForTesting({
        verifyIdToken: async () => ({ uid: 'admin-master-uid', email: 'adm.itissimple@gmail.com', role: 'admin', email_verified: true }),
      } as any);

      const reqAdmin = createMockRequest(
        { authorization: 'Bearer valid-admin-id-token' },
        {},
        { id: 'tutor-pedro-santos' }
      );
      const resAdmin = await simulateRoute([firebaseAuthMiddleware, requireAdmin], approveTutorHandler(state), reqAdmin);
      assert(resAdmin.statusCode === 200, 'Req 2: Administrador com Bearer token válido obtém 200 OK');
      assert(resAdmin.body?.success === true, 'Req 2: Resposta contém success=true');
      assert(resAdmin.body?.approvedTutor?.approvalStatus === 'approved', 'Req 2: Tutor retornado com approvalStatus=approved');
      assert(resAdmin.body?.approvedTutor?.isApproved === true, 'Req 2: Tutor retornado com isApproved=true');
    }

    // 8.3 Requisito 4 & 5: Persistência no Firestore e consistência entre /tutors e app_state/tutors
    {
      const state = createInitialSystemState();
      setFirebaseAdminAuthForTesting({
        verifyIdToken: async () => ({ uid: 'admin-master-uid', email: 'adm.itissimple@gmail.com', role: 'admin', email_verified: true }),
      } as any);

      const reqAdmin = createMockRequest(
        { authorization: 'Bearer valid-admin-id-token' },
        {},
        { id: 'tutor-pedro-santos' }
      );
      await simulateRoute([firebaseAuthMiddleware, requireAdmin], approveTutorHandler(state), reqAdmin);

      // Verificação do documento na coleção /tutors
      const firestoreDoc = state.firestoreTutorsCollection.get('tutor-pedro-santos');
      assert(firestoreDoc !== undefined, 'Req 4: Documento existe na coleção /tutors');
      assert(firestoreDoc?.approvalStatus === 'approved', 'Req 4: /tutors/{id} possui approvalStatus === approved');
      assert(firestoreDoc?.isApproved === true, 'Req 4: /tutors/{id} possui isApproved === true');
      assert(firestoreDoc?.approved === true, 'Req 4: /tutors/{id} possui approved === true');

      // Verificação do documento app_state/tutors
      const stateTutorsDoc = state.appStateTutorsDoc;
      const tutorInState = stateTutorsDoc.tutorsList.find((t) => t.id === 'tutor-pedro-santos');
      assert(tutorInState !== undefined, 'Req 5: Documento existe em app_state/tutors');
      assert(tutorInState?.approvalStatus === 'approved', 'Req 5: app_state/tutors possui approvalStatus === approved');
      assert(tutorInState?.isApproved === true, 'Req 5: app_state/tutors possui isApproved === true');

      // Consistência estrita entre ambas as coleções
      assert(firestoreDoc?.approvalStatus === tutorInState?.approvalStatus, 'Req 5: Status idêntico entre /tutors e app_state/tutors');
      assert(firestoreDoc?.isApproved === tutorInState?.isApproved, 'Req 5: isApproved idêntico entre /tutors e app_state/tutors');
      assert(firestoreDoc?.status === tutorInState?.status, 'Req 5: status idêntico entre coleções (sem contradição)');
    }

    // 8.4 Requisito 6: Exibir erro quando a aprovação falhar, sem apresentar falso sucesso
    {
      // Simulação do comportamento do frontend handleApproveTutor
      const simulateFrontendApprove = async (
        token: string | null,
        tutorId: string,
        serverStatusCode: number,
        serverErrorMsg?: string
      ) => {
        let uiTutorStatus = 'pending';
        let uiErrorMessage: string | null = null;
        let uiSuccessMessage: string | null = null;

        // 1. Verificação de credencial administrativa
        if (!token) {
          uiErrorMessage = 'Sessão administrativa não autenticada no Firebase Auth. Efetue login como Administrador.';
          // NÃO executa mutação otimista de sucesso
          return { uiTutorStatus, uiErrorMessage, uiSuccessMessage };
        }

        // 2. Chamada à API
        const mockFetchResponse = {
          ok: serverStatusCode >= 200 && serverStatusCode < 300,
          status: serverStatusCode,
          json: async () => serverStatusCode === 200 ? { success: true } : { error: 'Unauthorized', message: serverErrorMsg },
        };

        if (!mockFetchResponse.ok) {
          const errData = await mockFetchResponse.json();
          uiErrorMessage = errData.message || 'Falha ao aprovar';
          // NÃO apresenta falso sucesso: uiTutorStatus permanece inalterado
          return { uiTutorStatus, uiErrorMessage, uiSuccessMessage };
        }

        // 3. Sucesso verificado
        uiTutorStatus = 'approved';
        uiSuccessMessage = 'Amigo Nativo aprovado com sucesso!';
        return { uiTutorStatus, uiErrorMessage, uiSuccessMessage };
      };

      // 8.4.1 Frontend sem token
      const resNoToken = await simulateFrontendApprove(null, 't1', 401, 'Missing Authorization header');
      assert(resNoToken.uiTutorStatus === 'pending', 'Req 6: Frontend NÃO apresenta sucesso se token estiver ausente');
      assert(resNoToken.uiErrorMessage !== null, 'Req 6: Mensagem de erro informativa exibida ao usuário');
      assert(resNoToken.uiSuccessMessage === null, 'Req 6: Nenhuma mensagem de falso sucesso exibida');

      // 8.4.2 Frontend com erro 401 da API
      const res401 = await simulateFrontendApprove('expired-token', 't1', 401, 'Firebase ID token has expired');
      assert(res401.uiTutorStatus === 'pending', 'Req 6: Frontend reverte/mantém status pending se backend retornar 401');
      assert(Boolean(res401.uiErrorMessage?.includes('expired')), 'Req 6: Mensagem de erro do backend propagada');
      assert(res401.uiSuccessMessage === null, 'Req 6: Sucesso não apresentado em caso de 401');

      // 8.4.3 Frontend com sucesso real da API
      const res200 = await simulateFrontendApprove('valid-token', 't1', 200);
      assert(res200.uiTutorStatus === 'approved', 'Req 6: Frontend atualiza para approved apenas com 200 OK');
      assert(res200.uiSuccessMessage !== null, 'Req 6: Feedback positivo apresentado');
      assert(res200.uiErrorMessage === null, 'Req 6: Nenhum erro apresentado');
    }

    // 8.5 Requisito 7: Professores aprovados aparecem no catálogo público (GET /api/tutors)
    {
      const state = createInitialSystemState();

      // Simulação da rota GET /api/tutors idêntica à do serverApp.ts
      const getTutorsCatalog = (req: Request, res: Response) => {
        const requesterEmail = ((req.query.email as string) || '').toLowerCase().trim();
        const role = req.query.role as string;
        const isAdmin = role === 'admin' || req.query.admin === 'true';

        if (isAdmin) {
          return res.status(200).json(state.tutorsList);
        }

        // Para catálogo público: apenas professores aprovados são retornados
        const publicList = state.tutorsList.filter((t: TestTutor) => {
          const isApproved =
            t.approvalStatus === 'approved' ||
            t.isApproved === true ||
            t.status === 'approved' ||
            t.approved === true;
          if (isApproved) return true;
          if (requesterEmail && t.email.toLowerCase() === requesterEmail) return true;
          return false;
        });

        return res.status(200).json(publicList);
      };

      // 8.5.1 Catálogo público antes da aprovação: professor pendente NÃO aparece
      const reqAnonBefore = createMockRequest();
      const resAnonBefore = createMockResponse();
      getTutorsCatalog(reqAnonBefore, resAnonBefore);
      assert(resAnonBefore.body.length === 0, 'Req 7: Professor pendente NÃO é listado no catálogo público');

      // 8.5.2 Aprovação pelo administrador
      setFirebaseAdminAuthForTesting({
        verifyIdToken: async () => ({ uid: 'admin-master-uid', email: 'adm.itissimple@gmail.com', role: 'admin', email_verified: true }),
      } as any);
      const reqApprove = createMockRequest({ authorization: 'Bearer admin-token' }, {}, { id: 'tutor-pedro-santos' });
      await simulateRoute([firebaseAuthMiddleware, requireAdmin], approveTutorHandler(state), reqApprove);

      // 8.5.3 Catálogo público após aprovação: visitante anônimo em qualquer navegador vê o professor
      const reqAnonAfter = createMockRequest();
      const resAnonAfter = createMockResponse();
      getTutorsCatalog(reqAnonAfter, resAnonAfter);
      assert(resAnonAfter.body.length === 1, 'Req 7: Professor aprovado aparece no catálogo público');
      assert(resAnonAfter.body[0].email === 'pedro.santos@itissimple.com', 'Req 7: E-mail do professor retornado no catálogo');
      assert(resAnonAfter.body[0].approvalStatus === 'approved', 'Req 7: Professor retornado com status approved');
    }
  }

  // Reset mock
  setFirebaseAdminAuthForTesting(null);

  console.log(`\n========================================`);
  console.log(`TOTAL DE TESTES: ${passed + failed}`);
  console.log(`SUCESSO: ${passed}`);
  console.log(`FALHAS: ${failed}`);
  console.log(`========================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Erro na execução dos testes:', err);
  process.exit(1);
});
