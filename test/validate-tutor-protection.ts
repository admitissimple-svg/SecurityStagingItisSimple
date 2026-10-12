import { setFirebaseAdminAuthForTesting } from '../src/serverFirebaseAdmin';
import { firebaseAuthMiddleware, extractTrustedRole } from '../src/middleware/firebaseAuth';
import type { Request, Response, NextFunction } from 'express';

// Test runner tracking
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

// Mock Response helper
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

// Mock Request helper
function createMockRequest(options: {
  headers?: Record<string, string>;
  body?: any;
  params?: Record<string, string>;
  user?: any;
} = {}) {
  const req: any = {
    headers: options.headers || {},
    body: options.body || {},
    params: options.params || {},
    query: {},
    user: options.user,
  };
  return req;
}

// Execute middleware pipeline followed by route handler
async function executeRouteWithMiddlewares(
  middlewares: Array<(req: Request, res: Response, next: NextFunction) => any>,
  handler: (req: Request, res: Response) => any,
  req: Request
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

// In-memory isolated state for tests
interface MockDb {
  tutorsList: any[];
  teachers: any[];
  authUsers: Record<string, any>;
  teacherSettings: Record<string, any>;
}

function createInitialTestDb(): MockDb {
  return {
    tutorsList: [
      {
        id: 'tutor-teacher-a',
        uid: 'uid-teacher-a',
        email: 'teachera@example.com',
        name: 'Teacher Alice',
        role: 'teacher',
        approvalStatus: 'pending',
        isApproved: false,
        status: 'pending',
        approved: false,
        headline: 'Friendly Native Tutor',
        bio: 'Hello I love teaching',
        pricePerSessionUsd: 20,
        registeredByAdmin: false,
      },
      {
        id: 'tutor-teacher-b',
        uid: 'uid-teacher-b',
        email: 'teacherb@example.com',
        name: 'Teacher Bob',
        role: 'teacher',
        approvalStatus: 'approved',
        isApproved: true,
        status: 'approved',
        approved: true,
        headline: 'Experienced English Coach',
        bio: 'Bob bio',
        pricePerSessionUsd: 25,
        registeredByAdmin: false,
      },
    ],
    teachers: [
      {
        email: 'teachera@example.com',
        uid: 'uid-teacher-a',
        name: 'Teacher Alice',
        role: 'teacher',
        approvalStatus: 'pending',
        isApproved: false,
      },
      {
        email: 'teacherb@example.com',
        uid: 'uid-teacher-b',
        name: 'Teacher Bob',
        role: 'teacher',
        approvalStatus: 'approved',
        isApproved: true,
      },
      {
        email: 'adm.itissimple@gmail.com',
        uid: 'uid-admin',
        name: 'Admin Master',
        role: 'admin',
      },
    ],
    authUsers: {
      'teachera@example.com': {
        uid: 'uid-teacher-a',
        email: 'teachera@example.com',
        name: 'Teacher Alice',
        role: 'teacher',
      },
    },
    teacherSettings: {},
  };
}

// Implementation of the handlers under test, identical to serverApp.ts logic
function createRouteHandlers(db: MockDb) {
  const TEACHER_EDITABLE_FIELDS = new Set([
    'name',
    'avatar',
    'photoUrl',
    'country',
    'countryCode',
    'flag',
    'accent',
    'headline',
    'bio',
    'specialties',
    'videoIntroUrl',
    'youtubeUrl',
    'videoUrl',
    'introVideoUrl',
    'youtubeEmbedId',
    'pricePerSessionUsd',
    'pricePerSessionBrl',
    'languagesSpoken',
    'timezone',
    'meetUrl',
    'meetLink',
    'availableDays',
    'availableHours',
    'availability',
    'availableHoursByDay',
  ]);

  const postTutorsHandler = async (req: Request, res: Response) => {
    const rawTutor = req.body.tutor || req.body;
    if (!rawTutor || !rawTutor.email || typeof rawTutor.email !== 'string') {
      return res.status(400).json({ error: 'Invalid tutor data: email is required' });
    }
    const cleanEmail = rawTutor.email.toLowerCase().trim();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      return res.status(400).json({ error: 'Invalid tutor email' });
    }
    const cleanName = (rawTutor.name || '').trim();
    if (!cleanName) {
      return res.status(400).json({ error: 'Invalid tutor name' });
    }
    const cleanNameLower = cleanName.toLowerCase();
    const tutorId = rawTutor.id || `tutor-${cleanEmail.replace(/[^a-zA-Z0-9]/g, '-')}`;

    // Target admin check
    const isTargetAdmin =
      cleanEmail === 'adm.itissimple@gmail.com' ||
      (db.teachers || []).some((t: any) => t.email?.toLowerCase() === cleanEmail && t.role === 'admin');
    if (isTargetAdmin) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Access denied: Cannot register or overwrite an administrator account',
      });
    }

    const incomingUid = (rawTutor.uid || '').trim();
    const incomingId = (rawTutor.id || '').trim();

    // Check if tutor already exists by email, ID or UID
    const existingEmailIdx = (db.tutorsList || []).findIndex(
      (t: any) =>
        (t.email && t.email.toLowerCase() === cleanEmail) ||
        (incomingId && t.id && t.id === incomingId) ||
        (incomingUid && ((t.uid && t.uid === incomingUid) || (t.id && t.id === incomingUid)))
    );

    const existingTeacherIdx = (db.teachers || []).findIndex(
      (t: any) =>
        (t.email && t.email.toLowerCase() === cleanEmail) ||
        (incomingUid && t.uid && t.uid === incomingUid)
    );

    if (existingEmailIdx >= 0 || existingTeacherIdx >= 0) {
      return res.status(409).json({
        error: 'Este e-mail ou identificador já está cadastrado no sistema como Amigo Nativo. Não é permitido atualizar ou sobrescrever registros existentes através deste cadastro público.',
        duplicateField: 'email',
        isExistingUser: true,
      });
    }

    // Check if tutor already exists by name
    const existingName = (db.tutorsList || []).some(
      (t: any) => (t.name || '').trim().toLowerCase() === cleanNameLower && t.email?.toLowerCase() !== cleanEmail
    );

    if (existingName) {
      return res.status(409).json({
        error: 'Já existe um Amigo Nativo cadastrado com este nome na plataforma. Por favor, inclua seu sobrenome ou use um nome distintivo.',
        duplicateField: 'name',
        isExistingUser: true,
      });
    }

    // Server-enforced status: non-admin public registration MUST be pending
    const resolvedApprovalStatus = 'pending';
    const resolvedIsApproved = false;

    const tutorEntry = {
      ...rawTutor,
      name: cleanName,
      id: tutorId,
      email: cleanEmail,
      role: 'teacher',
      approvalStatus: resolvedApprovalStatus,
      isApproved: resolvedIsApproved,
      status: resolvedApprovalStatus,
      approved: resolvedIsApproved,
      registeredByAdmin: false,
      appliedAt: rawTutor.appliedAt || new Date().toISOString(),
    };

    // Strip non-permitted privileged/administrative keys
    delete (tutorEntry as any).isAdmin;
    delete (tutorEntry as any).permissions;
    delete (tutorEntry as any).credits;
    delete (tutorEntry as any).isUpdate;
    delete (tutorEntry as any).adminSettings;
    delete (tutorEntry as any).assignedStudents;

    db.tutorsList.push(tutorEntry);
    db.teachers.push({
      email: cleanEmail,
      name: cleanName,
      role: 'teacher',
      approvalStatus: resolvedApprovalStatus,
      isApproved: resolvedIsApproved,
      status: resolvedApprovalStatus,
      approved: resolvedIsApproved,
    });

    res.status(200).json({ success: true, tutor: tutorEntry });
  };

  const putTutorsHandler = async (req: Request, res: Response) => {
    const caller = req.user;
    if (!caller || !caller.uid) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Authentication required: verified user token missing',
      });
    }

    const tutorIdParam = decodeURIComponent(req.params.id || '').trim();
    if (!tutorIdParam) {
      return res.status(400).json({ error: 'Invalid tutor id' });
    }

    const rawBody = req.body;
    const updatedData = rawBody?.tutor ? { ...rawBody.tutor } : { ...rawBody };
    if ((updatedData as any).tutor) delete (updatedData as any).tutor;

    const existingIdx = (db.tutorsList || []).findIndex(
      (t: any) =>
        (t.id && t.id.toLowerCase() === tutorIdParam.toLowerCase()) ||
        (t.uid && t.uid === tutorIdParam) ||
        (t.email && t.email.toLowerCase() === tutorIdParam.toLowerCase())
    );

    if (existingIdx === -1) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Tutor não encontrado',
      });
    }

    const existingTutor = db.tutorsList[existingIdx];
    const existingEmail = (existingTutor.email || '').toLowerCase().trim();
    const existingUid = (existingTutor.uid || '').trim();
    const existingId = (existingTutor.id || '').trim();

    const callerEmail = (caller.email || '').toLowerCase().trim();
    const callerUid = (caller.uid || '').trim();

    const isAdmin = caller.role === 'admin';

    // Ownership strictly verified from server token and existing trusted record
    const isOwner = Boolean(
      (existingUid && existingUid === callerUid) ||
      (existingId && existingId === callerUid) ||
      (callerEmail && existingEmail && callerEmail === existingEmail)
    );

    const isAuthorized = isAdmin || (caller.role === 'teacher' && isOwner);
    if (!isAuthorized) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Access denied: You are not authorized to update this tutor profile',
      });
    }

    // Target admin check
    const isTargetAdmin =
      existingEmail === 'adm.itissimple@gmail.com' ||
      (db.teachers || []).some((t: any) => t.email?.toLowerCase() === existingEmail && t.role === 'admin');

    if (isTargetAdmin && !isAdmin) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Access denied: Cannot modify administrator account through tutor endpoint',
      });
    }

    const fieldsToApply: Record<string, any> = {};

    if (isAdmin) {
      const ADMIN_ADDITIONAL_FIELDS = new Set([
        'approvalStatus',
        'isApproved',
        'status',
        'approved',
        'registeredByAdmin',
        'isSuperTutor',
        'rating',
        'reviewsCount',
        'activeStudents',
        'lessonsTaught',
      ]);

      for (const [key, val] of Object.entries(updatedData)) {
        if (TEACHER_EDITABLE_FIELDS.has(key) || ADMIN_ADDITIONAL_FIELDS.has(key)) {
          fieldsToApply[key] = val;
        }
      }

      if (fieldsToApply.approvalStatus !== undefined) {
        const isApp = fieldsToApply.approvalStatus === 'approved';
        fieldsToApply.isApproved = fieldsToApply.isApproved ?? isApp;
        fieldsToApply.status = fieldsToApply.status ?? fieldsToApply.approvalStatus;
        fieldsToApply.approved = fieldsToApply.approved ?? isApp;
      }
    } else {
      // Regular teacher: strictly allowed profile fields only
      for (const [key, val] of Object.entries(updatedData)) {
        if (TEACHER_EDITABLE_FIELDS.has(key)) {
          fieldsToApply[key] = val;
        }
      }
    }

    const resolvedApprovalStatus = isAdmin
      ? (fieldsToApply.approvalStatus ?? existingTutor.approvalStatus ?? 'pending')
      : (existingTutor.approvalStatus ?? 'pending');
    const resolvedIsApproved = isAdmin
      ? (fieldsToApply.isApproved ?? existingTutor.isApproved ?? (resolvedApprovalStatus === 'approved'))
      : (existingTutor.isApproved ?? (existingTutor.approvalStatus === 'approved'));
    const resolvedStatus = isAdmin
      ? (fieldsToApply.status ?? existingTutor.status ?? resolvedApprovalStatus)
      : (existingTutor.status ?? existingTutor.approvalStatus ?? 'pending');
    const resolvedApproved = isAdmin
      ? (fieldsToApply.approved ?? existingTutor.approved ?? resolvedIsApproved)
      : (existingTutor.approved ?? existingTutor.isApproved ?? false);

    const updatedTutor = {
      ...existingTutor,
      ...fieldsToApply,
      id: existingTutor.id,
      email: existingTutor.email,
      uid: existingTutor.uid || caller.uid,
      role: 'teacher',
      approvalStatus: resolvedApprovalStatus,
      isApproved: resolvedIsApproved,
      status: resolvedStatus,
      approved: resolvedApproved,
      registeredByAdmin: isAdmin
        ? (fieldsToApply.registeredByAdmin ?? existingTutor.registeredByAdmin ?? false)
        : (existingTutor.registeredByAdmin ?? false),
      updatedAt: new Date().toISOString(),
    };

    db.tutorsList[existingIdx] = updatedTutor;

    // Sync with db.teachers
    const teacherIdx = (db.teachers || []).findIndex((tc: any) => tc.email?.toLowerCase() === existingEmail);
    if (teacherIdx >= 0) {
      db.teachers[teacherIdx] = {
        ...db.teachers[teacherIdx],
        name: updatedTutor.name,
        avatar: updatedTutor.avatar,
        approvalStatus: resolvedApprovalStatus,
        isApproved: resolvedIsApproved,
        status: resolvedStatus,
        approved: resolvedApproved,
      };
    }

    return res.status(200).json({ success: true, tutor: updatedTutor, tutors: db.tutorsList });
  };

  return { postTutorsHandler, putTutorsHandler };
}

async function runTutorProtectionTests() {
  console.log('\n======================================================================');
  console.log('=== BATERIA DE TESTES DE SEGURANÇA: ETAPA 2A.1 (POST/PUT TUTORS) ===');
  console.log('======================================================================\n');

  let db = createInitialTestDb();
  let handlers = createRouteHandlers(db);

  // 1. Cadastro novo válido
  console.log('--- 1. Cadastro novo válido ---');
  {
    const initialTutorCount = db.tutorsList.length;
    const req = createMockRequest({
      body: {
        name: 'Carlos Oliveira',
        email: 'carlos@example.com',
        country: 'Brazil',
        headline: 'Conversational Native Friend',
        bio: 'Passionate about English',
      },
    });
    const res = createMockResponse();
    await handlers.postTutorsHandler(req, res);
    assert(res.statusCode === 200, 'POST /api/tutors com dados válidos retorna 200');
    assert(res.body?.success === true, 'Resposta contém success: true');
    assert(res.body?.tutor?.approvalStatus === 'pending', 'Status inicial é pending');
    assert(res.body?.tutor?.isApproved === false, 'isApproved inicial é false');
    assert(res.body?.tutor?.role === 'teacher', 'role é estritamente teacher');
    assert(db.tutorsList.length === initialTutorCount + 1, 'Novo tutor foi adicionado ao banco');
  }

  // 2. Cadastro duplicado com e sem isUpdate
  console.log('\n--- 2. Cadastro duplicado com e sem isUpdate ---');
  {
    const initialTutorCount = db.tutorsList.length;

    // 2.1 Sem isUpdate
    const reqDuplicateNoUpdate = createMockRequest({
      body: {
        name: 'Carlos Segundo',
        email: 'carlos@example.com',
      },
    });
    const resDuplicateNoUpdate = createMockResponse();
    await handlers.postTutorsHandler(reqDuplicateNoUpdate, resDuplicateNoUpdate);
    assert(resDuplicateNoUpdate.statusCode === 409, 'Cadastro duplicado sem isUpdate retorna 409 Conflict');
    assert(db.tutorsList.length === initialTutorCount, 'Nenhum registro adicionado em memória após 409');

    // 2.2 COM isUpdate: true (tentativa de bypass)
    const reqDuplicateWithUpdate = createMockRequest({
      body: {
        name: 'Carlos Hacker Bypass',
        email: 'carlos@example.com',
        isUpdate: true,
        bio: 'Sobrescrevendo dados...',
      },
    });
    const resDuplicateWithUpdate = createMockResponse();
    await handlers.postTutorsHandler(reqDuplicateWithUpdate, resDuplicateWithUpdate);
    assert(resDuplicateWithUpdate.statusCode === 409, 'Cadastro duplicado COM isUpdate=true retorna 409 Conflict (bypass bloqueado)');
    assert(db.tutorsList.length === initialTutorCount, 'Nenhuma alteração permitida por rota pública');

    // Verificar que os dados originais de Carlos não foram modificados
    const carlos = db.tutorsList.find((t) => t.email === 'carlos@example.com');
    assert(carlos?.name === 'Carlos Oliveira', 'Dados originais intactos após tentativa de overwrite com isUpdate');
  }

  // 3. Tentativa de sobrescrever cadastro por UID ou e-mail
  console.log('\n--- 3. Tentativa de sobrescrever cadastro por UID ou e-mail ---');
  {
    // 3.1 Pelo UID de Alice
    const reqOverwriteByUid = createMockRequest({
      body: {
        name: 'Impostor Alice',
        email: 'impostor@example.com',
        uid: 'uid-teacher-a',
      },
    });
    const resOverwriteByUid = createMockResponse();
    await handlers.postTutorsHandler(reqOverwriteByUid, resOverwriteByUid);
    assert(resOverwriteByUid.statusCode === 409, 'Tentativa de sobrescrever por UID existente retorna 409');

    // 3.2 Pelo ID de Alice
    const reqOverwriteById = createMockRequest({
      body: {
        name: 'Impostor Alice 2',
        email: 'impostor2@example.com',
        id: 'tutor-teacher-a',
      },
    });
    const resOverwriteById = createMockResponse();
    await handlers.postTutorsHandler(reqOverwriteById, resOverwriteById);
    assert(resOverwriteById.statusCode === 409, 'Tentativa de sobrescrever por ID existente retorna 409');

    // 3.3 Pelo e-mail do admin
    const reqAdminOverwrite = createMockRequest({
      body: {
        name: 'Admin Spoof',
        email: 'adm.itissimple@gmail.com',
      },
    });
    const resAdminOverwrite = createMockResponse();
    await handlers.postTutorsHandler(reqAdminOverwrite, resAdminOverwrite);
    assert(resAdminOverwrite.statusCode === 403, 'Tentativa de cadastrar e-mail do admin retorna 403');
  }

  // 4. PUT sem token
  console.log('\n--- 4. PUT sem token ---');
  {
    const req = createMockRequest({ params: { id: 'tutor-teacher-a' } });
    const res = await executeRouteWithMiddlewares([firebaseAuthMiddleware], handlers.putTutorsHandler, req);
    assert(res.statusCode === 401, 'PUT /api/tutors/:id sem token retorna 401');
    assert(res.body?.message?.includes('Missing Authorization header'), 'Informa cabeçalho ausente');
  }

  // 5. PUT com token inválido
  console.log('\n--- 5. PUT com token inválido ---');
  {
    setFirebaseAdminAuthForTesting({
      verifyIdToken: async () => {
        const err: any = new Error('Invalid signature');
        err.code = 'auth/invalid-id-token';
        throw err;
      },
    } as any);

    const req = createMockRequest({
      headers: { authorization: 'Bearer invalid-token' },
      params: { id: 'tutor-teacher-a' },
    });
    const res = await executeRouteWithMiddlewares([firebaseAuthMiddleware], handlers.putTutorsHandler, req);
    assert(res.statusCode === 401, 'PUT /api/tutors/:id com token inválido retorna 401');
    assert(res.body?.message?.includes('Invalid Firebase ID token'), 'Informa token inválido');
  }

  // 6. Aluno tentando editar professor
  console.log('\n--- 6. Aluno tentando editar professor ---');
  {
    setFirebaseAdminAuthForTesting({
      verifyIdToken: async () => ({
        uid: 'uid-student-1',
        email: 'student@example.com',
        role: 'student',
        email_verified: true,
      }),
    } as any);

    const req = createMockRequest({
      headers: { authorization: 'Bearer student-token' },
      params: { id: 'tutor-teacher-a' },
      body: { bio: 'Hacked by student' },
    });
    const res = await executeRouteWithMiddlewares([firebaseAuthMiddleware], handlers.putTutorsHandler, req);
    assert(res.statusCode === 403, 'Aluno autenticado tentando editar professor retorna 403');
    assert(res.body?.error === 'Forbidden', 'Erro é Forbidden');
    assert(db.tutorsList.find((t) => t.id === 'tutor-teacher-a')?.bio !== 'Hacked by student', 'Bio do professor não foi alterada');
  }

  // 7. Professor tentando editar outro professor
  console.log('\n--- 7. Professor tentando editar outro professor ---');
  {
    // Bob (uid-teacher-b) tentando editar Alice (tutor-teacher-a)
    setFirebaseAdminAuthForTesting({
      verifyIdToken: async () => ({
        uid: 'uid-teacher-b',
        email: 'teacherb@example.com',
        role: 'teacher',
        email_verified: true,
      }),
    } as any);

    const req = createMockRequest({
      headers: { authorization: 'Bearer teacher-b-token' },
      params: { id: 'tutor-teacher-a' },
      body: { bio: 'Bob editing Alice' },
    });
    const res = await executeRouteWithMiddlewares([firebaseAuthMiddleware], handlers.putTutorsHandler, req);
    assert(res.statusCode === 403, 'Professor tentando editar outro professor retorna 403');
    assert(db.tutorsList.find((t) => t.id === 'tutor-teacher-a')?.bio !== 'Bob editing Alice', 'Perfil de Alice intacto');
  }

  // 8. Professor editando o próprio perfil
  console.log('\n--- 8. Professor editando o próprio perfil ---');
  {
    // Alice (uid-teacher-a) editando o próprio perfil
    setFirebaseAdminAuthForTesting({
      verifyIdToken: async () => ({
        uid: 'uid-teacher-a',
        email: 'teachera@example.com',
        role: 'teacher',
        email_verified: true,
      }),
    } as any);

    const req = createMockRequest({
      headers: { authorization: 'Bearer teacher-a-token' },
      params: { id: 'tutor-teacher-a' },
      body: {
        bio: 'Updated bio by Alice herself',
        headline: 'New headline',
        pricePerSessionUsd: 35,
        timezone: 'America/Toronto',
      },
    });
    const res = await executeRouteWithMiddlewares([firebaseAuthMiddleware], handlers.putTutorsHandler, req);
    assert(res.statusCode === 200, 'Professor editando o próprio perfil retorna 200');
    assert(res.body?.tutor?.bio === 'Updated bio by Alice herself', 'Bio atualizada com sucesso');
    assert(res.body?.tutor?.headline === 'New headline', 'Headline atualizado com sucesso');
    assert(res.body?.tutor?.pricePerSessionUsd === 35, 'Preço atualizado com sucesso');
    assert(res.body?.tutor?.timezone === 'America/Toronto', 'Timezone atualizado com sucesso');
  }

  // 9. Professor tentando alterar campos privilegiados
  console.log('\n--- 9. Professor tentando alterar campos privilegiados ---');
  {
    // Alice tentando se auto-aprovar e virar admin
    setFirebaseAdminAuthForTesting({
      verifyIdToken: async () => ({
        uid: 'uid-teacher-a',
        email: 'teachera@example.com',
        role: 'teacher',
        email_verified: true,
      }),
    } as any);

    const req = createMockRequest({
      headers: { authorization: 'Bearer teacher-a-token' },
      params: { id: 'tutor-teacher-a' },
      body: {
        bio: 'Legitimate bio update',
        // Campos privilegiados maliciosos:
        approvalStatus: 'approved',
        isApproved: true,
        status: 'approved',
        approved: true,
        role: 'admin',
        registeredByAdmin: true,
        credits: 9999,
        permissions: ['all'],
        email: 'newemail@example.com',
        uid: 'new-uid-spoof',
      },
    });
    const res = await executeRouteWithMiddlewares([firebaseAuthMiddleware], handlers.putTutorsHandler, req);
    assert(res.statusCode === 200, 'Requisição responde com 200');
    assert(res.body?.tutor?.bio === 'Legitimate bio update', 'Campo legítimo (bio) foi atualizado');

    // Verificação estrita dos campos sensíveis
    const aliceInDb = db.tutorsList.find((t) => t.id === 'tutor-teacher-a');
    assert(aliceInDb?.approvalStatus === 'pending', 'approvalStatus PERMANECE pending (auto-aprovação ignorada)');
    assert(aliceInDb?.isApproved === false, 'isApproved PERMANECE false');
    assert(aliceInDb?.status === 'pending', 'status PERMANECE pending');
    assert(aliceInDb?.approved === false, 'approved PERMANECE false');
    assert(aliceInDb?.role === 'teacher', 'role PERMANECE teacher (tentativa de escalada para admin ignorada)');
    assert(aliceInDb?.registeredByAdmin === false, 'registeredByAdmin PERMANECE false');
    assert(aliceInDb?.email === 'teachera@example.com', 'email original PERMANECE inalterado');
    assert(aliceInDb?.uid === 'uid-teacher-a', 'uid original PERMANECE inalterado');
    assert((aliceInDb as any)?.credits === undefined, 'credits não foi inserido');
    assert((aliceInDb as any)?.permissions === undefined, 'permissions não foi inserido');
  }

  // 10. Administrador autenticado realizando alteração permitida
  console.log('\n--- 10. Administrador autenticado realizando alteração permitida ---');
  {
    setFirebaseAdminAuthForTesting({
      verifyIdToken: async () => ({
        uid: 'uid-admin',
        email: 'adm.itissimple@gmail.com',
        role: 'admin',
        email_verified: true,
      }),
    } as any);

    const req = createMockRequest({
      headers: { authorization: 'Bearer admin-token' },
      params: { id: 'tutor-teacher-a' },
      body: {
        approvalStatus: 'approved',
        isApproved: true,
        registeredByAdmin: true,
        isSuperTutor: true,
        headline: 'Approved by Administrator',
      },
    });
    const res = await executeRouteWithMiddlewares([firebaseAuthMiddleware], handlers.putTutorsHandler, req);
    assert(res.statusCode === 200, 'Admin autenticado atualizando tutor retorna 200');
    assert(res.body?.tutor?.approvalStatus === 'approved', 'Admin pode alterar approvalStatus para approved');
    assert(res.body?.tutor?.isApproved === true, 'Admin pode alterar isApproved para true');
    assert(res.body?.tutor?.isSuperTutor === true, 'Admin pode alterar isSuperTutor');
    assert(res.body?.tutor?.headline === 'Approved by Administrator', 'Headline atualizado por admin');

    const aliceInDb = db.tutorsList.find((t) => t.id === 'tutor-teacher-a');
    assert(aliceInDb?.approvalStatus === 'approved', 'Estado no banco reflete aprovação pelo admin');
  }

  // 11. Ausência de mutações após requisições rejeitadas
  console.log('\n--- 11. Ausência de mutações após requisições rejeitadas ---');
  {
    const snapshotBefore = JSON.stringify(db);

    // 11.1 Rejeição por 401 (sem token)
    const req401 = createMockRequest({ params: { id: 'tutor-teacher-b' } });
    await executeRouteWithMiddlewares([firebaseAuthMiddleware], handlers.putTutorsHandler, req401);
    assert(JSON.stringify(db) === snapshotBefore, 'Nenhuma mutação após 401');

    // 11.2 Rejeição por 403 (aluno tentando editar Bob)
    setFirebaseAdminAuthForTesting({
      verifyIdToken: async () => ({ uid: 'std-2', role: 'student', email_verified: true }),
    } as any);
    const req403 = createMockRequest({
      headers: { authorization: 'Bearer student' },
      params: { id: 'tutor-teacher-b' },
      body: { name: 'Compromised Name' },
    });
    await executeRouteWithMiddlewares([firebaseAuthMiddleware], handlers.putTutorsHandler, req403);
    assert(JSON.stringify(db) === snapshotBefore, 'Nenhuma mutação após 403');

    // 11.3 Rejeição por 409 (tentativa de POST com e-mail duplicado)
    const req409 = createMockRequest({
      body: { email: 'teacherb@example.com', name: 'Duplicate Bob' },
    });
    const res409 = createMockResponse();
    await handlers.postTutorsHandler(req409, res409);
    assert(JSON.stringify(db) === snapshotBefore, 'Nenhuma mutação após 409');
  }

  // Reset mock
  setFirebaseAdminAuthForTesting(null);

  console.log('\n======================================================================');
  console.log(`TOTAL DE TESTES EXECUTADOS: ${passed + failed}`);
  console.log(`SUCESSO: ${passed}`);
  console.log(`FALHAS: ${failed}`);
  console.log('======================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTutorProtectionTests().catch((err) => {
  console.error('Erro na execução dos testes:', err);
  process.exit(1);
});
