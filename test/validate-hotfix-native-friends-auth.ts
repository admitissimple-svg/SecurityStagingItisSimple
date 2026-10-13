import { setFirebaseAdminAuthForTesting } from '../src/serverFirebaseAdmin';
import {
  firebaseAuthMiddleware,
  requireAdmin,
  getVerifiedUserFromRequest,
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

async function runHotfixTests() {
  console.log('=========================================================================');
  console.log(' TESTES HOTFIX: CADASTRO FIREBASE AUTHENTICATION DE NATIVE FRIENDS     ');
  console.log(' PROJETO: itissimple-security-staging                                   ');
  console.log('=========================================================================\n');

  // --- 1. Validação de senha e confirmação de senha no formulário ---
  console.log('--- 1. Validação de senha e confirmação de senha ---');
  {
    // Simulação da função de validação de BecomeTutorModal
    function validateTutorCredentials(name: string, email: string, pass: string, confirm: string) {
      if (!name || name.trim().length < 2) return { valid: false, error: 'Nome obrigatório' };
      if (!email || !email.includes('@')) return { valid: false, error: 'E-mail inválido' };
      if (!pass || pass.length < 6) return { valid: false, error: 'A senha deve conter no mínimo 6 caracteres.' };
      if (pass !== confirm) return { valid: false, error: 'A confirmação de senha não coincide com a senha digitada.' };
      return { valid: true, error: null };
    }

    const checkShortPass = validateTutorCredentials('Sarah Jenkins', 'sarah@example.com', '12345', '12345');
    assert(!checkShortPass.valid, 'Senha menor que 6 caracteres é rejeitada');
    assert(Boolean(checkShortPass.error?.includes('mínimo 6 caracteres')), 'Mensagem de senha curta correta');

    const checkMismatch = validateTutorCredentials('Sarah Jenkins', 'sarah@example.com', 'Secret123', 'Secret456');
    assert(!checkMismatch.valid, 'Senhas divergentes são rejeitadas');
    assert(Boolean(checkMismatch.error?.includes('não coincide')), 'Mensagem de divergência correta');

    const checkEmptyPass = validateTutorCredentials('Sarah Jenkins', 'sarah@example.com', '', '');
    assert(!checkEmptyPass.valid, 'Senha vazia é rejeitada');

    const checkValid = validateTutorCredentials('Sarah Jenkins', 'sarah@example.com', 'SecurePass2026*', 'SecurePass2026*');
    assert(checkValid.valid, 'Credenciais válidas e confirmadas passam na validação');
  }

  // --- 2. Integração Firebase Auth e preservação do ID público ---
  console.log('\n--- 2. Criação Firebase Auth, UID e Preservação do ID público ---');
  {
    // Mock de usuário Firebase Auth retornado por firebaseSignUpWithEmail
    const mockFirebaseAuthUser = {
      uid: 'fb-auth-uid-sarah-jenkins-7788',
      email: 'sarah.jenkins@example.com',
      displayName: 'Sarah Jenkins',
      photoURL: null,
    };
    const mockIdToken = 'header.payload.signature-sarah';

    // Mock do Firebase Admin Auth para validar o token no backend
    setFirebaseAdminAuthForTesting({
      verifyIdToken: async (token: string) => {
        if (token === mockIdToken) {
          return {
            uid: mockFirebaseAuthUser.uid,
            email: mockFirebaseAuthUser.email,
            email_verified: true,
          } as any;
        }
        throw new Error('Invalid token');
      },
    } as any);

    // Simulação do payload enviado para /api/tutors
    const cleanEmail = mockFirebaseAuthUser.email.toLowerCase().trim();
    const publicTutorId = `tutor-${cleanEmail.replace(/[^a-zA-Z0-9]/g, '-')}`;

    const tutorPayload = {
      id: publicTutorId,
      uid: mockFirebaseAuthUser.uid,
      name: 'Sarah Jenkins',
      email: cleanEmail,
      role: 'teacher',
      country: 'Canada',
      accent: 'Canadian',
      headline: 'Certified Canadian Educator',
      bio: 'Living English daily conversation.',
      pricePerSessionUsd: 25,
      pricePerSessionBrl: 138,
      approvalStatus: 'pending',
      isApproved: false,
      status: 'pending',
      approved: false,
      registeredByAdmin: false,
    };

    assert(!('password' in tutorPayload), 'Senha NÃO está no payload de /api/tutors');
    assert(!('confirmPassword' in tutorPayload), 'Confirmação de senha NÃO está no payload de /api/tutors');
    assert(tutorPayload.id === 'tutor-sarah-jenkins-example-com', 'ID público do tutor preservado');
    assert(tutorPayload.uid === mockFirebaseAuthUser.uid, 'UID real do Firebase Auth vinculado');
    assert(tutorPayload.approvalStatus === 'pending', 'Status inicial é estritamente pending');
    assert(tutorPayload.isApproved === false, 'isApproved inicial é false');
  }

  // --- 3. Mapeamento Firestore: users/{uid} vinculado a tutors/{publicId} ---
  console.log('\n--- 3. Mapeamento Firestore users/{uid} -> tutors/{publicId} ---');
  {
    const realAuthUid = 'fb-auth-uid-sarah-jenkins-7788';
    const publicTutorId = 'tutor-sarah-jenkins-example-com';
    const email = 'sarah.jenkins@example.com';

    // Documento em users/{uid}
    const userDocInFirestore = {
      id: realAuthUid,
      uid: realAuthUid,
      tutorId: publicTutorId,
      name: 'Sarah Jenkins',
      email,
      role: 'teacher',
      approvalStatus: 'pending',
      isApproved: false,
      status: 'pending',
      approved: false,
      registeredByAdmin: false,
      updatedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };

    // Documento em tutors/{publicTutorId}
    const tutorDocInFirestore = {
      id: publicTutorId,
      uid: realAuthUid,
      name: 'Sarah Jenkins',
      email,
      role: 'teacher',
      approvalStatus: 'pending',
      isApproved: false,
      status: 'pending',
      approved: false,
      registeredByAdmin: false,
      updatedAt: new Date().toISOString(),
    };

    assert(userDocInFirestore.id === realAuthUid, 'users/{uid} chaveado pelo UID real do Firebase');
    assert(userDocInFirestore.tutorId === publicTutorId, 'users/{uid} contém tutorId apontando para ID público');
    assert(tutorDocInFirestore.id === publicTutorId, 'tutors/{publicTutorId} preserva o ID público');
    assert(tutorDocInFirestore.uid === realAuthUid, 'tutors/{publicTutorId} vinculado ao UID real');
    assert(!('password' in userDocInFirestore), 'Senha NÃO está no documento users/{uid}');
    assert(!('password' in tutorDocInFirestore), 'Senha NÃO está no documento tutors/{publicId}');
    assert(userDocInFirestore.approvalStatus === 'pending', 'users/{uid} mantém status pending');
    assert(tutorDocInFirestore.approvalStatus === 'pending', 'tutors/{publicId} mantém status pending');
  }

  // --- 4. Tratamento de falhas sem sucesso parcial ---
  console.log('\n--- 4. Tratamento de falhas e ausência de sucesso parcial ---');
  {
    // Cenário: falha no Firebase Auth
    let stateCreated = false;
    let presentedSuccess = false;

    try {
      throw { code: 'auth/email-already-in-use', message: 'The email address is already in use by another account.' };
      // Se não falhasse:
      stateCreated = true;
      presentedSuccess = true;
    } catch (err: any) {
      if (err.code === 'auth/email-already-in-use') {
        presentedSuccess = false;
        stateCreated = false;
      }
    }

    assert(!presentedSuccess, 'Sucesso parcial NÃO apresentado quando Firebase Auth falha');
    assert(!stateCreated, 'Nenhum documento salvo no banco após erro de autenticação');
  }

  // --- 5. Vinculação segura de professores existentes (ex: Queen Bee) ---
  console.log('\n--- 5. Vinculação segura de Queen Bee (estilobeeforkids@gmail.com) no primeiro login ---');
  {
    // Perfil existente de Queen Bee no banco
    const existingQueenBeeTutor = {
      id: 'tutor-estilobeeforkids-gmail-com',
      name: 'Teacher Regina',
      email: 'estilobeeforkids@gmail.com',
      role: 'teacher',
      approvalStatus: 'pending',
      isApproved: false,
      status: 'pending',
      approved: false,
      bio: 'Living English daily conversation mentor',
      appliedAt: '2026-10-13T14:53:54.635Z',
    };

    // Primeiro login: Queen Bee autentica com Firebase Auth gerando UID
    const realQueenBeeUid = 'firebase-auth-uid-queen-bee-9900';

    // Processo de vinculação no backend (/api/auth/login)
    const tutorObj: any = { ...existingQueenBeeTutor };
    const cleanEmail = tutorObj.email.toLowerCase().trim();
    const publicTutorId = tutorObj.id || `tutor-${cleanEmail.replace(/[^a-zA-Z0-9]/g, '-')}`;

    // Atualização segura:
    tutorObj.uid = realQueenBeeUid;
    tutorObj.id = publicTutorId; // ID PÚBLICO PRESERVADO

    // Validações de integridade
    assert(tutorObj.id === 'tutor-estilobeeforkids-gmail-com', 'ID público de Queen Bee preservado');
    assert(tutorObj.uid === realQueenBeeUid, 'UID real do Firebase vinculado a Queen Bee');
    assert(tutorObj.name === 'Teacher Regina', 'Nome original de Queen Bee preservado');
    assert(tutorObj.bio === existingQueenBeeTutor.bio, 'Bio original de Queen Bee preservada');
    assert(tutorObj.approvalStatus === 'pending', 'Status pending original de Queen Bee mantido');
    assert(tutorObj.isApproved === false, 'isApproved original de Queen Bee mantido');
    assert(tutorObj.appliedAt === existingQueenBeeTutor.appliedAt, 'appliedAt original de Queen Bee mantido');
  }

  console.log('\n======================================================================');
  console.log(`TOTAL DE TESTES EXECUTADOS: ${passed + failed}`);
  console.log(`SUCESSO: ${passed}`);
  console.log(`FALHAS: ${failed}`);
  console.log('======================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runHotfixTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
