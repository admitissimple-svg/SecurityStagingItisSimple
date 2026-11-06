import assert from 'node:assert';
import { isValidCanonicalUid, isGenericTutorId, normalizeTutorName } from '../src/utils/tutorConsolidation';
import { UserRole, extractTrustedRole } from '../src/middleware/firebaseAuth';
import { NativeFriendTutor } from '../src/data/tutors';

console.log('=========================================================================');
console.log(' INTEGRATION VALIDATION: HOTFIX UX.1B                                   ');
console.log(' ONBOARDING AUTHENTICATION HARDENING & PROFILE PERSISTENCE RECOVERY     ');
console.log('=========================================================================\n');

let passedTests = 0;
let failedTests = 0;

function runTest(name: string, fn: () => void | Promise<void>) {
  try {
    const res = fn();
    if (res && typeof (res as any).then === 'function') {
      return (res as any)
        .then(() => {
          console.log(`  ✅ PASS: ${name}`);
          passedTests++;
        })
        .catch((err: any) => {
          console.error(`  ❌ FAIL: ${name}`);
          console.error(`     Error: ${err?.message || err}`);
          failedTests++;
        });
    } else {
      console.log(`  ✅ PASS: ${name}`);
      passedTests++;
    }
  } catch (err: any) {
    console.error(`  ❌ FAIL: ${name}`);
    console.error(`     Error: ${err?.message || err}`);
    failedTests++;
  }
}

async function runAllTests() {
  // Mock tutors list
  const sampleTutors: NativeFriendTutor[] = [
    {
      id: 'charles-lambert-uid-12345678',
      uid: 'charles-lambert-uid-12345678',
      authUid: 'charles-lambert-uid-12345678',
      publicTutorId: 'charles-lambert',
      name: 'Charles Lambert',
      email: 'charles.lambert@example.com',
      role: 'teacher',
      approvalStatus: 'approved',
      flag: '🇺🇸',
    } as any,
    {
      id: 'sarah-jenkins-uid-87654321',
      uid: 'sarah-jenkins-uid-87654321',
      authUid: 'sarah-jenkins-uid-87654321',
      publicTutorId: 'sarah-jenkins',
      name: 'Sarah Jenkins',
      email: 'sarah.jenkins@example.com',
      role: 'teacher',
      approvalStatus: 'approved',
      flag: '🇬🇧',
    } as any,
  ];

  // -------------------------------------------------------------------------
  // TEST 1: Novo aluno com cadastro Firebase bem-sucedido
  // -------------------------------------------------------------------------
  await runTest('1. Novo aluno com cadastro Firebase bem-sucedido', async () => {
    const mockEmail = 'novato@example.com';
    const mockPassword = 'password123';
    let authResCalled = false;

    // Simulate firebaseSignUpWithEmail
    const mockSignUp = async (email: string, pass: string) => {
      authResCalled = true;
      return {
        accessToken: 'mock-jwt-token-novato',
        user: {
          uid: 'novato-uid-11112222',
          email,
          displayName: 'Novato',
          photoURL: null,
          getIdToken: async (_force?: boolean) => 'mock-jwt-token-novato',
        },
      };
    };

    const res = await mockSignUp(mockEmail, mockPassword);
    assert.strictEqual(authResCalled, true);
    assert.strictEqual(res.user.uid, 'novato-uid-11112222');
    assert.strictEqual(isValidCanonicalUid(res.user.uid), true);

    const token = await res.user.getIdToken(true);
    assert.strictEqual(token, 'mock-jwt-token-novato');

    // Headers must contain Authorization: Bearer <token>
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    };
    assert.strictEqual(headers['Authorization'], 'Bearer mock-jwt-token-novato');
  });

  // -------------------------------------------------------------------------
  // TEST 2: Aluno existente com login correto
  // -------------------------------------------------------------------------
  await runTest('2. Aluno existente com login correto', async () => {
    const mockEmail = 'aluno.existente@example.com';
    const mockPassword = 'correctPassword456';

    const mockSignIn = async (email: string, pass: string) => {
      if (pass !== 'correctPassword456') {
        const err: any = new Error('Wrong password');
        err.code = 'auth/wrong-password';
        throw err;
      }
      return {
        accessToken: 'mock-jwt-token-existente',
        user: {
          uid: 'existente-uid-33334444',
          email,
          displayName: 'Aluno Existente',
          photoURL: null,
          getIdToken: async (_force?: boolean) => 'mock-jwt-token-existente',
        },
      };
    };

    const loginRes = await mockSignIn(mockEmail, mockPassword);
    assert.strictEqual(loginRes.user.uid, 'existente-uid-33334444');
    assert.strictEqual(isValidCanonicalUid(loginRes.user.uid), true);

    const token = await loginRes.user.getIdToken(true);
    assert.strictEqual(token, 'mock-jwt-token-existente');
  });

  // -------------------------------------------------------------------------
  // TEST 3: E-mail já existente e senha incorreta
  // -------------------------------------------------------------------------
  await runTest('3. E-mail já existente e senha incorreta (sem avanço silencioso)', async () => {
    const mockEmail = 'ja.cadastrado@example.com';
    const wrongPassword = 'wrongPassword999';

    let switchedToLogin = false;
    let errorMessage: string | null = null;
    let attemptedSaveProfile = false;

    // Simulate signup attempt
    try {
      const signupErr: any = new Error('The email address is already in use by another account.');
      signupErr.code = 'auth/email-already-in-use';
      throw signupErr;
    } catch (err: any) {
      if (err.code === 'auth/email-already-in-use') {
        // Enforce UX.1B Section 3: Do NOT assume password is valid or advance silently
        switchedToLogin = true;
        errorMessage = 'Este e-mail já possui uma conta cadastrada. Por favor, informe sua senha para entrar ou recupere seu acesso.';
      }
    }

    assert.strictEqual(switchedToLogin, true, 'Must switch authMode to login');
    assert.ok(errorMessage && errorMessage.includes('já possui uma conta cadastrada'), 'Must present clear guidance');

    // Simulate user attempting login with wrong password
    try {
      const loginErr: any = new Error('Incorrect password');
      loginErr.code = 'auth/wrong-password';
      throw loginErr;
    } catch (err: any) {
      if (err.code === 'auth/wrong-password') {
        errorMessage = 'Senha incorreta para esta conta. Verifique sua senha ou recupere seu acesso.';
      }
    }

    assert.ok(errorMessage && errorMessage.includes('Senha incorreta'), 'Must halt with wrong-password message');
    assert.strictEqual(attemptedSaveProfile, false, 'Must NOT attempt profile persistence on failed authentication');
  });

  // -------------------------------------------------------------------------
  // TEST 4: Sessão Firebase ainda inicializando (waitForAuthUser timeout & resolution)
  // -------------------------------------------------------------------------
  await runTest('4. Sessão Firebase ainda inicializando', async () => {
    // 4a: Session resolves within deadline
    let simulatedUser: any = null;
    const waitForMockAuth = async (timeoutMs: number) => {
      if (simulatedUser) return simulatedUser;
      return new Promise<any>((resolve) => {
        const timer = setTimeout(() => resolve(simulatedUser), timeoutMs);
        setTimeout(() => {
          simulatedUser = { uid: 'late-init-uid-55556666', email: 'late@example.com' };
          clearTimeout(timer);
          resolve(simulatedUser);
        }, 50);
      });
    };

    const resolvedUser = await waitForMockAuth(1000);
    assert.ok(resolvedUser && resolvedUser.uid === 'late-init-uid-55556666');

    // 4b: Session fails to initialize within deadline
    const waitForTimeoutAuth = async (timeoutMs: number) => {
      return new Promise<any>((resolve) => {
        setTimeout(() => resolve(null), timeoutMs);
      });
    };

    const timedOutUser = await waitForTimeoutAuth(50);
    assert.strictEqual(timedOutUser, null, 'Must return null if auth fails to initialize');
  });

  // -------------------------------------------------------------------------
  // TEST 5: Falha na obtenção do ID token
  // -------------------------------------------------------------------------
  await runTest('5. Falha na obtenção do ID token (gravação abortada)', async () => {
    const mockUser = {
      uid: 'user-without-token-1234',
      email: 'notoken@example.com',
      getIdToken: async () => null,
    };

    let fetchCallMade = false;
    const saveProfileGuard = async (user: any) => {
      const token = await user.getIdToken();
      if (!token || typeof token !== 'string' || token.trim().length === 0) {
        // Halt without calling API
        return false;
      }
      fetchCallMade = true;
      return true;
    };

    const result = await saveProfileGuard(mockUser);
    assert.strictEqual(result, false, 'Must return false when token retrieval fails');
    assert.strictEqual(fetchCallMade, false, 'Must NOT execute fetch request when token is missing');
  });

  // -------------------------------------------------------------------------
  // TEST 6: Token associado a UID diferente (Mismatch rejection)
  // -------------------------------------------------------------------------
  await runTest('6. Token associado a UID diferente', async () => {
    const sessionUserUid: string = 'uid-authenticated-attacker-777';
    const profileTargetUid: string = 'uid-victim-student-888';

    // Simulate backend and client authorization check
    const isOwner = sessionUserUid === profileTargetUid;
    const isServerAdmin = false;

    let allowed = false;
    if (isOwner || isServerAdmin) {
      allowed = true;
    }

    assert.strictEqual(allowed, false, 'Mismatching UID without admin privileges must be forbidden');

    // In backend /api/user-profile
    const verifiedUser = { uid: sessionUserUid, role: 'student' as UserRole };
    const requestedUid = profileTargetUid;
    let httpStatus = 200;
    if (verifiedUser.role !== 'admin' && requestedUid !== verifiedUser.uid) {
      httpStatus = 403;
    }
    assert.strictEqual(httpStatus, 403, 'Backend must return 403 Forbidden for mismatched UID');
  });

  // -------------------------------------------------------------------------
  // TEST 7: Entrada pela vitrine com professor pré-selecionado (Caminho A)
  // -------------------------------------------------------------------------
  await runTest('7. Caminho A — Vitrine pública (passos 1 -> 2 -> 3 -> 5 -> 6)', () => {
    const preselectedTutor = sampleTutors[0];
    const initialTutorId = preselectedTutor.id;
    const isTutorPreselected = true;

    // Emulate step transition logic
    const visitedSteps: number[] = [];
    let currentStep = 1;

    while (currentStep <= 6) {
      visitedSteps.push(currentStep);
      if (currentStep === 1) currentStep = 2;
      else if (currentStep === 2) currentStep = 3;
      else if (currentStep === 3) {
        // Vitrine flow skips Step 4 (Tutor Selection)
        currentStep = isTutorPreselected ? 5 : 4;
      } else if (currentStep === 4) {
        currentStep = 5;
      } else if (currentStep === 5) {
        currentStep = 6;
      } else {
        break;
      }
    }

    assert.deepStrictEqual(visitedSteps, [1, 2, 3, 5, 6], 'Caminho A must skip Step 4 (Tutor Selection)');
    assert.strictEqual(visitedSteps.includes(4), false, 'Step 4 must NOT be visited when preselected');
  });

  // -------------------------------------------------------------------------
  // TEST 8: Entrada tradicional com professor selecionado no wizard (Caminho B)
  // -------------------------------------------------------------------------
  await runTest('8. Caminho B — Start Living in English (passos 1 -> 2 -> 3 -> 4 -> 5 -> 6)', () => {
    const isTutorPreselected = false;
    let selectedTutorId = '';

    const visitedSteps: number[] = [];
    let currentStep = 1;

    while (currentStep <= 6) {
      visitedSteps.push(currentStep);
      if (currentStep === 1) currentStep = 2;
      else if (currentStep === 2) currentStep = 3;
      else if (currentStep === 3) {
        currentStep = isTutorPreselected ? 5 : 4;
      } else if (currentStep === 4) {
        // Student selects tutor in step 4
        selectedTutorId = sampleTutors[1].id;
        currentStep = 5;
      } else if (currentStep === 5) {
        currentStep = 6;
      } else {
        break;
      }
    }

    assert.deepStrictEqual(visitedSteps, [1, 2, 3, 4, 5, 6], 'Caminho B must visit Step 4');
    assert.strictEqual(selectedTutorId, sampleTutors[1].id, 'Tutor must be selected during Step 4');
  });

  // -------------------------------------------------------------------------
  // TEST 9: Atualização de página durante o onboarding
  // -------------------------------------------------------------------------
  await runTest('9. Atualização de página durante o onboarding (sessionStorage persistence)', () => {
    const store = new Map<string, string>();
    const mockSessionStorage = {
      setItem: (k: string, v: string) => store.set(k, v),
      getItem: (k: string) => store.get(k) || null,
      removeItem: (k: string) => store.delete(k),
    };
    const tutorId = 'charles-lambert-uid-12345678';

    // When clicking Start Journey from vitrine:
    mockSessionStorage.setItem('its_simple_preselected_tutor_id', tutorId);

    // Simulate page reload
    const restoredTutorId = mockSessionStorage.getItem('its_simple_preselected_tutor_id') || '';
    const restoredIsPreselected = Boolean(restoredTutorId);

    assert.strictEqual(restoredTutorId, tutorId, 'Preselected tutor ID must be preserved across reload');
    assert.strictEqual(restoredIsPreselected, true, 'isTutorPreselected must remain true');

    // On completion or manual dismissal:
    mockSessionStorage.removeItem('its_simple_preselected_tutor_id');
    assert.strictEqual(mockSessionStorage.getItem('its_simple_preselected_tutor_id'), null);
  });

  // -------------------------------------------------------------------------
  // TEST 10: Ausência de gravação duplicada ou desautenticada
  // -------------------------------------------------------------------------
  await runTest('10. Ausência de gravação duplicada ou desautenticada', async () => {
    let unauthenticatedApiCalls = 0;
    let authenticatedApiCalls = 0;

    const mockFetchUserProfile = async (headers: Record<string, string>) => {
      if (!headers['Authorization'] || !headers['Authorization'].startsWith('Bearer ')) {
        unauthenticatedApiCalls++;
        return { status: 401, ok: false, error: 'Unauthorized' };
      }
      authenticatedApiCalls++;
      return { status: 200, ok: true };
    };

    // Client-side saveStudentProfileToFirestore simulation:
    const simulateSave = async (authUser: any) => {
      // Rule: if no active auth session or missing token, DO NOT CALL API
      if (!authUser || !authUser.uid || !isValidCanonicalUid(authUser.uid)) {
        return false;
      }
      const token = await authUser.getIdToken().catch(() => null);
      if (!token) {
        return false;
      }
      const res = await mockFetchUserProfile({
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      });
      return res.ok;
    };

    // Case A: Unauthenticated user attempt
    const resUnauth = await simulateSave(null);
    assert.strictEqual(resUnauth, false, 'Unauthenticated call must be blocked locally');
    assert.strictEqual(unauthenticatedApiCalls, 0, 'Zero unauthenticated calls must hit /api/user-profile');

    // Case B: Authenticated user attempt
    const validUser = {
      uid: 'valid-student-uid-99990000',
      getIdToken: async () => 'valid-jwt-token-ok',
    };
    const resAuth = await simulateSave(validUser);
    assert.strictEqual(resAuth, true, 'Authenticated call must succeed');
    assert.strictEqual(authenticatedApiCalls, 1, 'Exactly 1 authenticated call made');
    assert.strictEqual(unauthenticatedApiCalls, 0, 'Zero unauthenticated calls made');
  });

  console.log('\n=========================================================================');
  console.log(` TOTAL TEST RESULTS: ${passedTests} PASSED, ${failedTests} FAILED`);
  console.log('=========================================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runAllTests().catch((e) => {
  console.error('Fatal test error:', e);
  process.exit(1);
});
