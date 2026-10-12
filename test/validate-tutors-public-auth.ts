import { setFirebaseAdminAuthForTesting } from '../src/serverFirebaseAdmin';
import {
  firebaseAuthMiddleware,
  requireAdmin,
  getVerifiedUserFromRequest,
  extractTrustedRole,
} from '../src/middleware/firebaseAuth';
import type { Request, Response } from 'express';

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
    headers: {} as Record<string, string>,
    body: null,
    setHeader(name: string, value: string) {
      this.headers[name] = value;
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

// Mock Request helper
function createMockRequest(options: {
  headers?: Record<string, string>;
  query?: Record<string, string>;
  body?: any;
  params?: Record<string, string>;
  user?: any;
} = {}) {
  const req: any = {
    headers: options.headers || {},
    query: options.query || {},
    body: options.body || {},
    params: options.params || {},
    user: options.user,
  };
  return req;
}

// Isolated mock database for testing
interface TestTutor {
  id: string;
  uid?: string;
  email: string;
  name: string;
  role: string;
  approvalStatus: 'approved' | 'pending' | 'rejected';
  isApproved: boolean;
  status: 'approved' | 'pending' | 'rejected';
  approved: boolean;
  meetUrl?: string;
  meetLink?: string;
  bio?: string;
  headline?: string;
  rating?: number;
  reviewsCount?: number;
  activeStudents?: number;
  lessonsTaught?: number;
  [key: string]: any;
}

interface MockDb {
  tutorsList: TestTutor[];
  teachers: any[];
  authUsers: Record<string, any>;
  deletedTutorEmails?: string[];
  deletedTutorIds?: string[];
}

function createTestDb(): MockDb {
  return {
    tutorsList: [
      {
        id: 'tutor-bob-approved',
        uid: 'uid-bob',
        email: 'bob@example.com',
        name: 'Bob Approved Tutor',
        role: 'teacher',
        approvalStatus: 'approved',
        isApproved: true,
        status: 'approved',
        approved: true,
        meetUrl: 'https://meet.google.com/bob-private-meet',
        meetLink: 'https://meet.google.com/bob-private-meet',
        bio: 'Bob public bio',
        headline: 'Friendly Native English Friend',
        rating: 4.9,
        reviewsCount: 15,
        activeStudents: 8,
        lessonsTaught: 42,
      },
      {
        id: 'tutor-alice-pending',
        uid: 'uid-alice',
        email: 'alice@example.com',
        name: 'Alice Pending Tutor',
        role: 'teacher',
        approvalStatus: 'pending',
        isApproved: false,
        status: 'pending',
        approved: false,
        meetUrl: 'https://meet.google.com/alice-private-meet',
        meetLink: 'https://meet.google.com/alice-private-meet',
        bio: 'Alice bio',
        headline: 'Certified ESL Coach',
      },
      {
        id: 'tutor-charlie-pending',
        uid: 'uid-charlie',
        email: 'charlie@example.com',
        name: 'Charlie Pending Tutor',
        role: 'teacher',
        approvalStatus: 'pending',
        isApproved: false,
        status: 'pending',
        approved: false,
        meetUrl: 'https://meet.google.com/charlie-private-meet',
        meetLink: 'https://meet.google.com/charlie-private-meet',
      },
      {
        id: 'tutor-david-rejected',
        uid: 'uid-david',
        email: 'david@example.com',
        name: 'David Rejected Tutor',
        role: 'teacher',
        approvalStatus: 'rejected',
        isApproved: false,
        status: 'rejected',
        approved: false,
        meetUrl: 'https://meet.google.com/david-private-meet',
        meetLink: 'https://meet.google.com/david-private-meet',
      },
    ],
    teachers: [
      { email: 'adm.itissimple@gmail.com', name: "Admin It's Simple", role: 'admin' },
      { email: 'bob@example.com', name: 'Bob Approved Tutor', role: 'teacher', approvalStatus: 'approved', isApproved: true },
      { email: 'alice@example.com', name: 'Alice Pending Tutor', role: 'teacher', approvalStatus: 'pending', isApproved: false },
      { email: 'charlie@example.com', name: 'Charlie Pending Tutor', role: 'teacher', approvalStatus: 'pending', isApproved: false },
    ],
    authUsers: {
      'adm.itissimple@gmail.com': { uid: 'admin-master-uid', email: 'adm.itissimple@gmail.com', name: "Admin It's Simple", role: 'admin' },
      'alice@example.com': { uid: 'uid-alice', email: 'alice@example.com', name: 'Alice Pending Tutor', role: 'teacher' },
      'bob@example.com': { uid: 'uid-bob', email: 'bob@example.com', name: 'Bob Approved Tutor', role: 'teacher' },
    },
    deletedTutorEmails: [],
    deletedTutorIds: [],
  };
}

/**
 * Strict public DTO allowlist projection for Native Friends catalog.
 * Exactly matches implementation in serverApp.ts
 */
function toPublicTutorDto(t: any): Record<string, any> {
  const dto: Record<string, any> = {
    id: String(t.id || ''),
    name: String(t.name || ''),
    avatar: String(t.avatar || t.photoUrl || t.picture || ''),
    photoUrl: String(t.avatar || t.photoUrl || t.picture || ''),
    country: String(t.country || ''),
    countryCode: String(t.countryCode || ''),
    flag: String(t.flag || ''),
    accent: String(t.accent || ''),
    headline: String(t.headline || ''),
    bio: String(t.bio || ''),
    specialties: Array.isArray(t.specialties) ? t.specialties.filter((s: unknown) => typeof s === 'string') : [],
    videoIntroUrl: String(t.videoIntroUrl || t.youtubeUrl || t.videoUrl || t.introVideoUrl || ''),
    youtubeUrl: String(t.youtubeUrl || t.videoIntroUrl || ''),
    videoUrl: String(t.videoUrl || t.videoIntroUrl || ''),
    introVideoUrl: String(t.introVideoUrl || t.videoIntroUrl || ''),
    youtubeEmbedId: String(t.youtubeEmbedId || ''),
    availableDays: Array.isArray(t.availableDays) ? t.availableDays : [],
    availableHours: Array.isArray(t.availableHours) ? t.availableHours : [],
    availableHoursByDay: t.availableHoursByDay && typeof t.availableHoursByDay === 'object' ? t.availableHoursByDay : {},
    availability: t.availability && typeof t.availability === 'object' ? t.availability : {},
    isSuperTutor: Boolean(t.isSuperTutor),
    languagesSpoken: Array.isArray(t.languagesSpoken) ? t.languagesSpoken : [],
    timezone: String(t.timezone || ''),
    approvalStatus: 'approved',
    isApproved: true,
    status: 'approved',
    approved: true,
    role: 'teacher',
  };

  if (typeof t.pricePerSessionUsd === 'number') {
    dto.pricePerSessionUsd = t.pricePerSessionUsd;
  }
  if (typeof t.pricePerSessionBrl === 'number') {
    dto.pricePerSessionBrl = t.pricePerSessionBrl;
  }
  // Genuine stats only, never fabricate fake metrics:
  if (typeof t.rating === 'number' && !isNaN(t.rating)) {
    dto.rating = t.rating;
  }
  if (typeof t.reviewsCount === 'number' && !isNaN(t.reviewsCount)) {
    dto.reviewsCount = t.reviewsCount;
  }
  if (typeof t.activeStudents === 'number' && !isNaN(t.activeStudents)) {
    dto.activeStudents = t.activeStudents;
  }
  if (typeof t.lessonsTaught === 'number' && !isNaN(t.lessonsTaught)) {
    dto.lessonsTaught = t.lessonsTaught;
  }

  return dto;
}

function sanitizePrivateTutorRecord(t: any): Record<string, any> {
  const sanitized = { ...t };
  delete sanitized.password;
  delete sanitized.token;
  delete sanitized.secret;
  delete sanitized.apiKey;
  return sanitized;
}

// Handlers exactly matching the implementation in serverApp.ts
function createHandlers(db: MockDb) {
  const TRUSTED_ADMIN_EMAILS = new Set(['adm.itissimple@gmail.com', 'admin@itissimple.com']);

  const getTeachersHandler = (req: Request, res: Response) => {
    res.json({ teachers: db.teachers || [] });
  };

  const getTutorsHandler = async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    // SECURITY HOTFIX — Native Friends Public API Authorization
    const verifiedUser = await getVerifiedUserFromRequest(req);

    const isServerVerifiedAdmin = verifiedUser?.role === 'admin';
    const verifiedCallerUid = verifiedUser?.uid || '';
    const verifiedCallerEmail = (verifiedUser?.email || '').toLowerCase().trim();

    const isApprovedTutor = (t: any) => {
      return Boolean(
        t.approvalStatus === 'approved' ||
        t.isApproved === true ||
        t.status === 'approved' ||
        t.approved === true
      );
    };

    if (isServerVerifiedAdmin) {
      const adminList = (db.tutorsList || []).filter((t: any) => {
        const tEmail = (t.email || '').toLowerCase().trim();
        const tId = (t.id || '').toLowerCase().trim();
        return !db.deletedTutorEmails?.includes(tEmail) && !db.deletedTutorIds?.includes(tId);
      });
      return res.json(adminList.map(sanitizePrivateTutorRecord));
    }

    const filteredList = (db.tutorsList || []).filter((t: any) => {
      const tEmail = (t.email || '').toLowerCase().trim();
      const tId = (t.id || '').toLowerCase().trim();
      if (db.deletedTutorEmails?.includes(tEmail) || db.deletedTutorIds?.includes(tId)) {
        return false;
      }

      if (isApprovedTutor(t)) {
        return true;
      }

      if (verifiedUser && verifiedCallerUid) {
        const isOwnByUid = Boolean(t.uid && t.uid === verifiedCallerUid);
        const isOwnById = Boolean(t.id && t.id === verifiedCallerUid);
        const isOwnByEmail = Boolean(verifiedCallerEmail && tEmail && tEmail === verifiedCallerEmail);
        if (isOwnByUid || isOwnById || isOwnByEmail) {
          return true;
        }
      }

      return false;
    });

    // Projection layer:
    // - Authenticated tutor sees their OWN record with private fields.
    // - All third parties and public visitors receive strict public DTO projection (no email, uid, meetUrl, meetLink).
    const projectedList = filteredList.map((t: any) => {
      const tEmail = (t.email || '').toLowerCase().trim();
      const isOwnRecord = Boolean(
        verifiedUser &&
        verifiedCallerUid &&
        (
          (t.uid && t.uid === verifiedCallerUid) ||
          (t.id && t.id === verifiedCallerUid) ||
          (verifiedCallerEmail && tEmail && tEmail === verifiedCallerEmail)
        )
      );

      if (isOwnRecord) {
        return sanitizePrivateTutorRecord(t);
      }

      return toPublicTutorDto(t);
    });

    return res.json(projectedList);
  };

  const postTutorsHandler = async (req: Request, res: Response) => {
    const rawTutor = req.body?.tutor || req.body;
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
    const tutorId = (rawTutor.id && typeof rawTutor.id === 'string' && rawTutor.id.trim())
      ? rawTutor.id.trim()
      : `tutor-${cleanEmail.replace(/[^a-zA-Z0-9]/g, '-')}`;

    const verifiedCaller = await getVerifiedUserFromRequest(req);
    const isAdminCaller = verifiedCaller?.role === 'admin';

    const isTargetAdmin =
      cleanEmail === 'adm.itissimple@gmail.com' ||
      (db.teachers || []).some((t: any) => t.email?.toLowerCase() === cleanEmail && t.role === 'admin');
    if (isTargetAdmin && !isAdminCaller) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Access denied: Cannot register or overwrite an administrator account',
      });
    }

    const incomingUid = (rawTutor.uid && typeof rawTutor.uid === 'string') ? rawTutor.uid.trim() : '';
    const incomingId = (rawTutor.id && typeof rawTutor.id === 'string') ? rawTutor.id.trim() : '';
    const verifiedUidForMatch = verifiedCaller?.uid || '';

    const existingEmailIdx = (db.tutorsList || []).findIndex(
      (t: any) =>
        (t.email && t.email.toLowerCase() === cleanEmail) ||
        (incomingId && t.id && t.id === incomingId) ||
        (verifiedUidForMatch && ((t.uid && t.uid === verifiedUidForMatch) || (t.id && t.id === verifiedUidForMatch))) ||
        (incomingUid && ((t.uid && t.uid === incomingUid) || (t.id && t.id === incomingUid)))
    );

    const existingTeacherIdx = (db.teachers || []).findIndex(
      (t: any) =>
        (t.email && t.email.toLowerCase() === cleanEmail) ||
        (verifiedUidForMatch && t.uid && t.uid === verifiedUidForMatch) ||
        (incomingUid && t.uid && t.uid === incomingUid)
    );

    if (existingEmailIdx >= 0 || existingTeacherIdx >= 0) {
      return res.status(409).json({
        error: 'Este e-mail ou identificador já está cadastrado no sistema como Amigo Nativo. Não é permitido atualizar ou sobrescrever registros existentes através deste cadastro público.',
        duplicateField: 'email',
        isExistingUser: true,
      });
    }

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

    const resolvedApprovalStatus = isAdminCaller
      ? (rawTutor.approvalStatus || (rawTutor.registeredByAdmin ? 'approved' : 'pending'))
      : 'pending';
    const resolvedIsApproved = isAdminCaller && (resolvedApprovalStatus === 'approved' || rawTutor.isApproved === true);

    const resolvedUid = isAdminCaller
      ? (incomingUid || verifiedCaller?.uid || undefined)
      : (verifiedCaller?.uid || undefined);

    const tutorEntry: Record<string, any> = {
      id: tutorId,
      name: cleanName,
      email: cleanEmail,
      role: 'teacher',
      approvalStatus: resolvedApprovalStatus,
      isApproved: resolvedIsApproved,
      status: resolvedApprovalStatus,
      approved: resolvedIsApproved,
      registeredByAdmin: isAdminCaller && Boolean(rawTutor.registeredByAdmin),
      appliedAt: rawTutor.appliedAt || new Date().toISOString(),
    };

    if (resolvedUid) {
      tutorEntry.uid = resolvedUid;
    }

    if (rawTutor.avatar && typeof rawTutor.avatar === 'string') tutorEntry.avatar = rawTutor.avatar.trim();
    if (rawTutor.country && typeof rawTutor.country === 'string') tutorEntry.country = rawTutor.country.trim();
    if (rawTutor.headline && typeof rawTutor.headline === 'string') tutorEntry.headline = rawTutor.headline.trim();
    if (rawTutor.bio && typeof rawTutor.bio === 'string') tutorEntry.bio = rawTutor.bio.trim();
    if (rawTutor.timezone && typeof rawTutor.timezone === 'string') tutorEntry.timezone = rawTutor.timezone.trim();

    // Strip non-permitted keys
    delete (tutorEntry as any).isAdmin;
    delete (tutorEntry as any).permissions;
    delete (tutorEntry as any).credits;
    delete (tutorEntry as any).isUpdate;
    delete (tutorEntry as any).adminSettings;
    delete (tutorEntry as any).assignedStudents;
    delete (tutorEntry as any).password;
    delete (tutorEntry as any).token;

    db.tutorsList.push(tutorEntry as any);
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

  const syncAdminClaimsHandler = async (req: Request, res: Response) => {
    const caller = req.user;
    if (!caller || !caller.uid) {
      return res.status(401).json({ error: 'Unauthorized', message: 'Authentication required: verified user token missing' });
    }

    const cleanEmail = (caller.email || '').toLowerCase().trim();

    if (!caller.email_verified) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Access denied: caller email must be verified to synchronize administrative claims',
      });
    }

    if (!TRUSTED_ADMIN_EMAILS.has(cleanEmail)) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Access denied: caller is not an authorized administrator',
      });
    }

    const isTeacherAdmin = (db.teachers || []).some(
      (t: any) => t.role === 'admin' && (t.email || '').toLowerCase().trim() === cleanEmail
    );
    const isAuthUserAdmin =
      db.authUsers &&
      Object.values(db.authUsers).some(
        (u: any) => u.role === 'admin' && (u.email || '').toLowerCase().trim() === cleanEmail
      );

    const isConfirmedAdmin = isTeacherAdmin || isAuthUserAdmin || cleanEmail === 'adm.itissimple@gmail.com';
    if (!isConfirmedAdmin) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Access denied: administrator account is not active or recognized in system records',
      });
    }

    return res.json({ success: true, role: 'admin', uid: caller.uid });
  };

  const registerHandler = async (req: Request, res: Response) => {
    const { email, role = 'student' } = req.body;
    const cleanEmail = (email || '').toLowerCase().trim();
    const requestedRole = (role || 'student').toLowerCase();

    if (requestedRole === 'admin') {
      if (!TRUSTED_ADMIN_EMAILS.has(cleanEmail)) {
        return res.status(403).json({
          error: 'Forbidden: não é permitido registrar contas de administrador para este endereço de e-mail.',
          hasAdminRegistered: true,
        });
      }
      return res.json({ success: true, role: 'admin' });
    }

    return res.json({ success: true, role: requestedRole });
  };

  return { getTeachersHandler, getTutorsHandler, postTutorsHandler, syncAdminClaimsHandler, registerHandler };
}

async function runSecurityTests() {
  console.log('\n======================================================================');
  console.log('=== TESTES DE SEGURANÇA: NATIVE FRIENDS PUBLIC API AUTHORIZATION ===');
  console.log('=== PROJETO: itissimple-security-staging                           ===');
  console.log('======================================================================\n');

  const db = createTestDb();
  const handlers = createHandlers(db);

  // -------------------------------------------------------------------------
  // SEÇÃO 1: CATÁLOGO PÚBLICO E PROJEÇÃO SEGURA (SEM DADOS PRIVADOS)
  // -------------------------------------------------------------------------
  console.log('--- 1. Catálogo público sem login (Projeção Segura e Allowlist) ---');
  {
    const req = createMockRequest();
    const res = createMockResponse();
    await handlers.getTutorsHandler(req, res);

    assert(res.statusCode === 200, 'GET /api/tutors público retorna 200 OK');
    assert(Array.isArray(res.body), 'Resposta é um array de tutores');
    assert(res.body.length === 1, 'Exatamente 1 professor aprovado retornado para visitante anônimo');

    const bob = res.body[0];
    assert(bob.name === 'Bob Approved Tutor', 'Bob (aprovado) está no catálogo público');
    assert(bob.id === 'tutor-bob-approved', 'Bob possui ID público preservado');

    // VERIFICAÇÕES DE PRIVACIDADE CRÍTICAS (Allowlist / Projeção Segura)
    assert(bob.email === undefined, 'PROJEÇÃO SEGURA: email NÃO é retornado no catálogo público');
    assert(bob.uid === undefined, 'PROJEÇÃO SEGURA: uid NÃO é retornado no catálogo público');
    assert(bob.meetUrl === undefined, 'PROJEÇÃO SEGURA: meetUrl NÃO é retornado no catálogo público');
    assert(bob.meetLink === undefined, 'PROJEÇÃO SEGURA: meetLink NÃO é retornado no catálogo público');
    assert(bob.password === undefined, 'PROJEÇÃO SEGURA: credenciais NÃO são retornadas');
    assert(bob.token === undefined, 'PROJEÇÃO SEGURA: tokens NÃO são retornados');
    assert(bob.registeredByAdmin === undefined, 'PROJEÇÃO SEGURA: campos administrativos NÃO são retornados');

    // Métricas públicas preservadas sem fabricação
    assert(bob.rating === 4.9, 'Avaliação genuína do banco preservada');
    assert(bob.reviewsCount === 15, 'Contagem de reviews genuína preservada');
    assert(bob.activeStudents === 8, 'Alunos ativos genuínos preservados');

    // Professores pendentes e rejeitados ocultos
    const ids = res.body.map((t: any) => t.id);
    assert(!ids.includes('tutor-alice-pending'), 'Professor pendente (Alice) oculto de visitantes');
    assert(!ids.includes('tutor-charlie-pending'), 'Professor pendente (Charlie) oculto de visitantes');
    assert(!ids.includes('tutor-david-rejected'), 'Professor rejeitado (David) oculto de visitantes');
  }

  // -------------------------------------------------------------------------
  // SEÇÃO 2: TESTES NEGATIVOS CONTRA MANIPULAÇÃO DE QUERY PARAMS
  // -------------------------------------------------------------------------
  console.log('\n--- 2. Testes negativos: Manipulação de query parameters por visitantes anônimos ---');

  // 2.1 Tentativa com ?admin=true
  {
    const req = createMockRequest({ query: { admin: 'true' } });
    const res = createMockResponse();
    await handlers.getTutorsHandler(req, res);

    assert(res.body.length === 1, 'NEGATIVO: ?admin=true retorna apenas catálogo aprovado');
    assert(res.body[0].email === undefined, 'NEGATIVO: ?admin=true não vaza email');
    assert(res.body[0].uid === undefined, 'NEGATIVO: ?admin=true não vaza uid');
  }

  // 2.2 Tentativa com ?includePending=true
  {
    const req = createMockRequest({ query: { includePending: 'true' } });
    const res = createMockResponse();
    await handlers.getTutorsHandler(req, res);

    assert(res.body.length === 1, 'NEGATIVO: ?includePending=true retorna apenas catálogo aprovado');
    assert(res.body[0].email === undefined, 'NEGATIVO: ?includePending=true não vaza email');
  }

  // 2.3 Tentativa combinada de bypass com múltiplos parâmetros manipulados
  {
    const req = createMockRequest({
      query: {
        admin: 'true',
        includePending: 'true',
        role: 'admin',
        email: 'adm.itissimple@gmail.com',
        uid: 'admin-master-uid',
      },
    });
    const res = createMockResponse();
    await handlers.getTutorsHandler(req, res);

    assert(res.body.length === 1, 'NEGATIVO: Bypass combinado retorna estritamente catálogo aprovado');
    assert(res.body[0].email === undefined, 'NEGATIVO: Bypass combinado não vaza dados privados');
  }

  // -------------------------------------------------------------------------
  // SEÇÃO 3: USUÁRIO ALUNO AUTENTICADO
  // -------------------------------------------------------------------------
  console.log('\n--- 3. Aluno autenticado recebendo apenas dados públicos ---');
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
      query: { admin: 'true', includePending: 'true', role: 'admin' },
    });
    const res = createMockResponse();
    await handlers.getTutorsHandler(req, res);

    assert(res.body.length === 1, 'Aluno autenticado recebe estritamente catálogo público');
    assert(res.body[0].email === undefined, 'Aluno NÃO recebe email de professores');
    assert(res.body[0].uid === undefined, 'Aluno NÃO recebe uid de professores');
    assert(res.body[0].meetUrl === undefined, 'Aluno NÃO recebe meetUrl de professores');
  }

  // -------------------------------------------------------------------------
  // SEÇÃO 4: PROFESSOR AUTENTICADO CONSULTANDO SEUS PRÓPRIOS DADOS PRIVADOS
  // -------------------------------------------------------------------------
  console.log('\n--- 4. Professor autenticado acessando apenas seus próprios dados privados ---');
  {
    // Alice está autenticada com seu próprio token
    setFirebaseAdminAuthForTesting({
      verifyIdToken: async () => ({
        uid: 'uid-alice',
        email: 'alice@example.com',
        role: 'teacher',
        email_verified: true,
      }),
    } as any);

    const req = createMockRequest({
      headers: { authorization: 'Bearer alice-token' },
    });
    const res = createMockResponse();
    await handlers.getTutorsHandler(req, res);

    assert(res.body.length === 2, 'Alice recebe exatamente: aprovados + seu próprio cadastro');

    const bobInResponse = res.body.find((t: any) => t.id === 'tutor-bob-approved');
    const aliceInResponse = res.body.find((t: any) => t.id === 'tutor-alice-pending');

    assert(Boolean(bobInResponse), 'Alice visualiza Bob aprovado no catálogo');
    assert(bobInResponse.email === undefined, 'ISOLAMENTO: Alice NÃO recebe email privado de Bob');
    assert(bobInResponse.uid === undefined, 'ISOLAMENTO: Alice NÃO recebe uid privado de Bob');
    assert(bobInResponse.meetUrl === undefined, 'ISOLAMENTO: Alice NÃO recebe meetUrl privado de Bob');

    assert(Boolean(aliceInResponse), 'Alice visualiza seu PRÓPRIO cadastro pendente');
    assert(aliceInResponse.email === 'alice@example.com', 'Alice acessa seu PRÓPRIO email');
    assert(aliceInResponse.uid === 'uid-alice', 'Alice acessa seu PRÓPRIO uid');
    assert(aliceInResponse.meetUrl === 'https://meet.google.com/alice-private-meet', 'Alice acessa seu PRÓPRIO meetUrl');

    // Charlie e David continuam estritamente inacessíveis
    assert(!res.body.some((t: any) => t.id === 'tutor-charlie-pending'), 'Alice NÃO tem acesso a Charlie');
    assert(!res.body.some((t: any) => t.id === 'tutor-david-rejected'), 'Alice NÃO tem acesso a David');
  }

  console.log('\n--- 5. Isolamento de terceiros: Professor tentando inspecionar outro pendente ---');
  {
    setFirebaseAdminAuthForTesting({
      verifyIdToken: async () => ({
        uid: 'uid-alice',
        email: 'alice@example.com',
        role: 'teacher',
        email_verified: true,
      }),
    } as any);

    const req = createMockRequest({
      headers: { authorization: 'Bearer alice-token' },
      query: { email: 'charlie@example.com', uid: 'uid-charlie', includePending: 'true' },
    });
    const res = createMockResponse();
    await handlers.getTutorsHandler(req, res);

    assert(res.body.length === 2, 'Retorno restrito exclusivamente a aprovados + própria Alice');
    assert(!res.body.some((t: any) => t.id === 'tutor-charlie-pending'), 'Alice NÃO consegue expor Charlie via query params');
  }

  // -------------------------------------------------------------------------
  // SEÇÃO 5: ADMINISTRADOR AUTENTICADO ACESSANDO A MODERAÇÃO
  // -------------------------------------------------------------------------
  console.log('\n--- 6. Administrador autenticado acessando a moderação ---');
  {
    setFirebaseAdminAuthForTesting({
      verifyIdToken: async () => ({
        uid: 'admin-master-uid',
        email: 'adm.itissimple@gmail.com',
        role: 'admin',
        email_verified: true,
      }),
    } as any);

    const req = createMockRequest({
      headers: { authorization: 'Bearer admin-token' },
    });
    const res = createMockResponse();
    await handlers.getTutorsHandler(req, res);

    assert(res.body.length === 4, 'Admin recebe listagem completa de professores para moderação');
    const emails = res.body.map((t: any) => t.email);
    assert(emails.includes('bob@example.com'), 'Admin visualiza Bob (aprovado) com email para moderação');
    assert(emails.includes('alice@example.com'), 'Admin visualiza Alice (pendente) com email para moderação');
    assert(emails.includes('charlie@example.com'), 'Admin visualiza Charlie (pendente) com email para moderação');
    assert(emails.includes('david@example.com'), 'Admin visualiza David (rejeitado) com email para moderação');

    // Nenhuma credencial ou senha exposta para ninguém
    assert(res.body.every((t: any) => t.password === undefined), 'Nenhuma senha nos documentos de tutores');
  }

  // -------------------------------------------------------------------------
  // SEÇÃO 6: CONTROLE DE ACESSO A GET /api/teachers
  // -------------------------------------------------------------------------
  console.log('\n--- 7. Controle de acesso: GET /api/teachers (Item 3) ---');
  {
    // 7.1 Sem token -> 401
    const reqNoToken = createMockRequest();
    const resNoToken = createMockResponse();
    await firebaseAuthMiddleware(reqNoToken, resNoToken, () => {});
    assert(resNoToken.statusCode === 401, 'GET /api/teachers sem token retorna 401 Unauthorized');

    // 7.2 Aluno -> 403
    setFirebaseAdminAuthForTesting({
      verifyIdToken: async () => ({ uid: 'std-1', email: 's@example.com', role: 'student', email_verified: true }),
    } as any);
    const reqStudent = createMockRequest({ headers: { authorization: 'Bearer student' } });
    const resStudent = createMockResponse();
    await firebaseAuthMiddleware(reqStudent, resStudent, () => {
      requireAdmin(reqStudent, resStudent, () => {});
    });
    assert(resStudent.statusCode === 403, 'GET /api/teachers com aluno retorna 403 Forbidden');

    // 7.3 Professor -> 403
    setFirebaseAdminAuthForTesting({
      verifyIdToken: async () => ({ uid: 'tch-1', email: 't@example.com', role: 'teacher', email_verified: true }),
    } as any);
    const reqTeacher = createMockRequest({ headers: { authorization: 'Bearer teacher' } });
    const resTeacher = createMockResponse();
    await firebaseAuthMiddleware(reqTeacher, resTeacher, () => {
      requireAdmin(reqTeacher, resTeacher, () => {});
    });
    assert(resTeacher.statusCode === 403, 'GET /api/teachers com professor retorna 403 Forbidden');

    // 7.4 Administrador -> 200 OK
    setFirebaseAdminAuthForTesting({
      verifyIdToken: async () => ({ uid: 'adm-1', email: 'adm.itissimple@gmail.com', role: 'admin', email_verified: true }),
    } as any);
    const reqAdmin = createMockRequest({ headers: { authorization: 'Bearer admin' } });
    const resAdmin = createMockResponse();
    await firebaseAuthMiddleware(reqAdmin, resAdmin, () => {
      requireAdmin(reqAdmin, resAdmin, () => {
        handlers.getTeachersHandler(reqAdmin, resAdmin);
      });
    });
    assert(resAdmin.statusCode === 200, 'GET /api/teachers com admin retorna 200 OK');
    assert(Array.isArray(resAdmin.body?.teachers), 'Retorna lista de teachers para o administrador');
  }

  // -------------------------------------------------------------------------
  // SEÇÃO 7: CADASTRO COM VALIDAÇÃO ESTRITA (POST /api/tutors - Item 2)
  // -------------------------------------------------------------------------
  console.log('\n--- 8. Cadastro com validação estrita (POST /api/tutors - Item 2) ---');
  {
    // 8.1 Rejeição de campos desconhecidos e escalada de privilégios
    const reqInjection = createMockRequest({
      body: {
        name: 'Novato Tutor',
        email: 'novato@example.com',
        isAdmin: true,
        role: 'admin',
        approvalStatus: 'approved',
        isApproved: true,
        registeredByAdmin: true,
        permissions: ['all_access'],
        credits: 9999,
        arbitraryUnknownField: 'malicious_payload',
        password: 'cleartext_password_123',
        uid: 'spoofed_uid_attempt',
      },
    });
    const resInjection = createMockResponse();
    await handlers.postTutorsHandler(reqInjection, resInjection);

    assert(resInjection.statusCode === 200, 'POST /api/tutors responde com sucesso');
    const created = resInjection.body?.tutor;

    // Privilégios forçados para estado não-privilegiado
    assert(created.role === 'teacher', 'role forçado estritamente para teacher');
    assert(created.approvalStatus === 'pending', 'approvalStatus forçado para pending');
    assert(created.isApproved === false, 'isApproved forçado para false');
    assert(created.registeredByAdmin === false, 'registeredByAdmin forçado para false');

    // Descarte de campos desconhecidos e privilégios
    assert(created.isAdmin === undefined, 'isAdmin descartado com sucesso');
    assert(created.permissions === undefined, 'permissions descartado com sucesso');
    assert(created.credits === undefined, 'credits descartado com sucesso');
    assert(created.arbitraryUnknownField === undefined, 'Campos desconhecidos descartados');

    // UID arbitrário sem autenticação descartado
    assert(created.uid === undefined, 'UID arbitrário do cliente não aceito como prova de identidade');

    // Nenhuma senha ou credencial armazenada
    assert(created.password === undefined, 'Senha NÃO armazenada no documento de tutor');
  }

  // -------------------------------------------------------------------------
  // SEÇÃO 8: AUDITORIA DE SYNC ADMIN CLAIMS
  // -------------------------------------------------------------------------
  console.log('\n--- 9. Auditoria de /api/auth/sync-admin-claims ---');
  {
    setFirebaseAdminAuthForTesting({
      verifyIdToken: async () => ({
        uid: 'admin-master-uid',
        email: 'adm.itissimple@gmail.com',
        role: 'student',
        email_verified: true,
      }),
    } as any);

    const req = createMockRequest({ headers: { authorization: 'Bearer legitimate-admin' } });
    const res = createMockResponse();
    await firebaseAuthMiddleware(req, res, async () => {
      await handlers.syncAdminClaimsHandler(req, res);
    });
    assert(res.statusCode === 200, 'Administrador legítimo verificado sincroniza com sucesso (200 OK)');
    assert(res.body?.role === 'admin', 'Resposta confirma atribuição da role admin');
  }

  // Limpeza de mocks
  setFirebaseAdminAuthForTesting(null);

  console.log('\n======================================================================');
  console.log(`TOTAL DE TESTES: ${passed + failed}`);
  console.log(`SUCESSO: ${passed}`);
  console.log(`FALHAS: ${failed}`);
  console.log('======================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runSecurityTests().catch((err) => {
  console.error('Erro nos testes de segurança:', err);
  process.exit(1);
});
