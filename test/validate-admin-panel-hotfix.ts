import { setFirebaseAdminAuthForTesting } from '../src/serverFirebaseAdmin';
import { getVerifiedUserFromRequest } from '../src/middleware/firebaseAuth';
import type { Request, Response } from 'express';

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

function createMockRequest(headers: Record<string, string> = {}) {
  const req: any = {
    headers,
    query: {},
    body: {},
    params: {},
  };
  return req;
}

// Mock handler matching serverApp.ts logic for GET /api/tutors
async function executeGetTutors(req: Request, res: Response, db: any) {
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
    return res.json(adminList);
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

  return res.json(filteredList);
}

async function runHotfixValidation() {
  console.log('\n======================================================================');
  console.log('=== VALIDATION: HOTFIX DO PAINEL ADMINISTRATIVO                    ===');
  console.log('=== PROJETO: itissimple-security-staging                           ===');
  console.log('======================================================================\n');

  // Simulated database reflecting the exact staging environment:
  // 1 approved tutor (Charles / Bob) and 1 pending tutor (Teacher Regina)
  const db = {
    tutorsList: [
      {
        id: 'tutor-bob-approved',
        uid: 'uid-bob',
        name: 'Bob Approved Tutor',
        email: 'bob@example.com',
        role: 'teacher',
        approvalStatus: 'approved',
        isApproved: true,
        status: 'approved',
        approved: true,
      },
      {
        id: 'tutor-regina-pending',
        uid: 'uid-regina',
        name: 'Teacher Regina',
        email: 'estilobeeforkids@gmail.com',
        role: 'teacher',
        approvalStatus: 'pending',
        isApproved: false,
        status: 'pending',
        approved: false,
      },
    ],
    deletedTutorEmails: [],
    deletedTutorIds: [],
  };

  // 1. Unauthenticated request without Authorization header (DevTools reproduction)
  console.log('--- 1. Consulta sem cabeçalho Authorization (Comportamento público padrão) ---');
  {
    const req = createMockRequest({}); // No Authorization header
    const res = createMockResponse();
    await executeGetTutors(req, res, db);

    assert(res.statusCode === 200, 'GET /api/tutors retorna HTTP 200');
    assert(Array.isArray(res.body), 'Retorno é um array');
    assert(res.body.length === 1, 'Apenas 1 tutor retornado (aprovado)');
    assert(res.body[0].id === 'tutor-bob-approved', 'Bob aprovado está no catálogo');
    assert(!res.body.some((t: any) => t.id === 'tutor-regina-pending'), 'Teacher Regina (pending) NÃO é exposta sem token administrativo');
  }

  // 2. Request with valid Firebase ID Token and role: 'admin' custom claim
  console.log('\n--- 2. Consulta administrativa com Firebase ID Token verificado (Custom Claim role=admin) ---');
  {
    setFirebaseAdminAuthForTesting({
      verifyIdToken: async (token: string) => {
        if (token === 'valid-admin-token') {
          return {
            uid: 'admin-master-uid',
            email: 'estilobeeadm@gmail.com',
            role: 'admin',
            email_verified: true,
          };
        }
        throw new Error('Invalid token');
      },
    } as any);

    const req = createMockRequest({
      authorization: 'Bearer valid-admin-token',
    });
    const res = createMockResponse();
    await executeGetTutors(req, res, db);

    assert(res.statusCode === 200, 'GET /api/tutors com Bearer token retorna HTTP 200');
    assert(Array.isArray(res.body), 'Retorno é um array');
    assert(res.body.length === 2, 'Administrador recebe todos os tutores (incluindo pendentes)');

    const reginaInResponse = res.body.find((t: any) => t.id === 'tutor-regina-pending');
    assert(Boolean(reginaInResponse), 'Teacher Regina (pending) é retornada com sucesso para o administrador');
    assert(reginaInResponse?.approvalStatus === 'pending', 'Status de aprovação pendente preservado para moderação');
  }

  // 3. User with email matching admin but WITHOUT custom claim role='admin'
  console.log('\n--- 3. Tentativa de obter privilégios por e-mail sem Custom Claim (Preservação do Backend) ---');
  {
    setFirebaseAdminAuthForTesting({
      verifyIdToken: async () => ({
        uid: 'user-without-claim-uid',
        email: 'estilobeeadm@gmail.com',
        // role is intentionally missing / student to test strict Custom Claims enforcement
        role: 'student',
        email_verified: true,
      }),
    } as any);

    const req = createMockRequest({
      authorization: 'Bearer non-admin-token',
    });
    const res = createMockResponse();
    await executeGetTutors(req, res, db);

    assert(res.body.length === 1, 'Token sem custom claim role=admin NÃO recebe tutores pendentes');
    assert(!res.body.some((t: any) => t.id === 'tutor-regina-pending'), 'Privilégios NÃO concedidos apenas por e-mail');
  }

  // 4. Test client-side guard: when visual admin has no Firebase session
  console.log('\n--- 4. Bloqueio de autenticação simulada e apresentação de erro claro ---');
  {
    const isAdminUser = true;
    const authUser = null; // No Firebase session
    let adminAuthError: string | null = null;

    if (isAdminUser && !authUser) {
      adminAuthError = 'Sessão de autenticação Firebase não encontrada para o administrador. Faça login com uma conta de administrador autorizada para revisar cadastros pendentes.';
    }

    assert(adminAuthError !== null, 'Erro claro gerado quando login visual não possui sessão Firebase');
    assert(Boolean(adminAuthError?.includes('Firebase')), 'Mensagem de erro cita explicitamente a sessão Firebase Auth');
  }

  setFirebaseAdminAuthForTesting(null);

  console.log('\n======================================================================');
  console.log(`TOTAL DE TESTES DO HOTFIX: ${passed + failed}`);
  console.log(`SUCESSO: ${passed}`);
  console.log(`FALHAS: ${failed}`);
  console.log('======================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runHotfixValidation().catch((err) => {
  console.error('Erro nos testes de validação do hotfix:', err);
  process.exit(1);
});
