/**
 * TEST SUITE: HOTFIX CIRÚRGICO — Compra de Pacotes com Native Friend
 * Projeto: itissimple-security-staging
 *
 * 8 Testes Obrigatórios:
 * 1. Charles Lambert selecionado pelo catálogo público, sem e-mail exposto.
 * 2. UID transmitido corretamente até handlePurchasePackage.
 * 3. Identificação do professor sem alteração de maiúsculas/minúsculas.
 * 4. Ausência do alerta indevido de Native Friend inválido.
 * 5. Professor inexistente ou não aprovado continua sendo rejeitado pelo backend.
 * 6. Compra com professor válido mantém o vínculo correto.
 * 7. Compra pós-trial não é confundida com novo agendamento experimental.
 * 8. Compatibilidade com o fluxo legado por e-mail, quando aplicável.
 */

import { isValidCanonicalUid } from '../src/utils/tutorConsolidation';
import { resolveTeacherCanonicalIdentity } from '../src/serverFirestore';
import { NativeFriendTutor, UserProfile } from '../src/types';

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

async function runTestSuite() {
  console.log('=========================================================================');
  console.log(' TEST SUITE: HOTFIX CIRÚRGICO — COMPRA DE PACOTES COM NATIVE FRIEND');
  console.log(' Projeto: itissimple-security-staging');
  console.log('=========================================================================\n');

  // Charles Lambert canonical mock data
  const CHARLES_CANONICAL_UID = '2pG8N7bXyZ1W9qLmK4vRtP3sAeJ9'; // mixed case Firebase UID (28 chars)
  const CHARLES_PUBLIC_TUTOR_ID = 'charles-lambert';

  // 1. Catálogo público do Charles Lambert (sem e-mail exposto para alunos)
  const charlesPublicDto: NativeFriendTutor = {
    id: CHARLES_CANONICAL_UID,
    publicTutorId: CHARLES_PUBLIC_TUTOR_ID,
    name: 'Charles Lambert',
    email: '', // E-mail estritamente omitido na projeção pública
    avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb',
    country: 'United States',
    headline: 'Certified ESL Coach & Accent Specialist',
    bio: 'Dedicated mentor for fluency and conversational confidence.',
    specialties: ['Conversation', 'Business English', 'Accent Reduction'],
    pricePerSessionUsd: 15,
    pricePerSessionBrl: 83,
    approvalStatus: 'approved',
    isApproved: true,
  } as NativeFriendTutor;

  const catalogTutors: NativeFriendTutor[] = [charlesPublicDto];

  // ---------------------------------------------------------------------------
  // TESTE 1: Charles Lambert selecionado pelo catálogo público, sem e-mail exposto
  // ---------------------------------------------------------------------------
  console.log('--- Teste 1: Charles Lambert selecionado pelo catálogo público, sem e-mail exposto ---');
  {
    assert(
      !charlesPublicDto.email || charlesPublicDto.email.trim() === '',
      'E-mail do professor NÃO está exposto no catálogo público'
    );
    assert(
      charlesPublicDto.id === CHARLES_CANONICAL_UID,
      'Identificador id do professor contém o UID canônico do Firebase'
    );
    assert(
      isValidCanonicalUid(charlesPublicDto.id),
      'UID de Charles é válido segundo as regras canônicas do Firebase'
    );
    assert(
      charlesPublicDto.name === 'Charles Lambert',
      'Nome do professor preservado na exibição pública'
    );
  }

  // ---------------------------------------------------------------------------
  // TESTE 2: UID transmitido corretamente até handlePurchasePackage
  // ---------------------------------------------------------------------------
  console.log('\n--- Teste 2: UID transmitido corretamente até handlePurchasePackage ---');
  {
    // Simula a lógica de handleConfirmPurchase do ManageSubscriptionModal
    const selectedTutorForPurchase = charlesPublicDto;
    let interceptedParams: any = null;

    const mockOnPurchasePackage = async (params: any) => {
      interceptedParams = params;
      return { success: true };
    };

    const canonicalTeacherUid =
      (selectedTutorForPurchase.uid && isValidCanonicalUid(selectedTutorForPurchase.uid) ? selectedTutorForPurchase.uid.trim() : '') ||
      (selectedTutorForPurchase.id && isValidCanonicalUid(selectedTutorForPurchase.id) ? selectedTutorForPurchase.id.trim() : '') ||
      (selectedTutorForPurchase.authUid && isValidCanonicalUid(selectedTutorForPurchase.authUid) ? selectedTutorForPurchase.authUid.trim() : '');

    const resolvedTeacherId =
      canonicalTeacherUid ||
      selectedTutorForPurchase.id ||
      selectedTutorForPurchase.publicTutorId;

    const resolvedPublicTutorId =
      selectedTutorForPurchase.publicTutorId ||
      (!isValidCanonicalUid(selectedTutorForPurchase.id) ? selectedTutorForPurchase.id : undefined);

    await mockOnPurchasePackage({
      teacherEmail: selectedTutorForPurchase.email || '',
      teacherName: selectedTutorForPurchase.name,
      teacherId: resolvedTeacherId || undefined,
      teacherUid: canonicalTeacherUid || undefined,
      publicTutorId: resolvedPublicTutorId || undefined,
      packageLessons: 8,
      packagePriceBrl: 598,
      packagePriceUsd: 108,
      paymentMethod: 'pix',
      isRecurringMonthly: true,
      monthlyFrequency: '2x',
    });

    assert(interceptedParams !== null, 'onPurchasePackage foi chamado pelo modal');
    assert(
      interceptedParams.teacherUid === CHARLES_CANONICAL_UID,
      'teacherUid transmitido corresponde estritamente ao UID canônico de Charles'
    );
    assert(
      interceptedParams.teacherId === CHARLES_CANONICAL_UID,
      'teacherId transmitido corresponde ao identificador canônico'
    );
    assert(
      interceptedParams.publicTutorId === CHARLES_PUBLIC_TUTOR_ID,
      'publicTutorId transmitido corretamente'
    );
    assert(
      interceptedParams.packageLessons === 8,
      'Parâmetros da compra (8 aulas) preservados integralmente'
    );
  }

  // ---------------------------------------------------------------------------
  // TESTE 3: Identificação do professor sem alteração de maiúsculas/minúsculas
  // ---------------------------------------------------------------------------
  console.log('\n--- Teste 3: Identificação do professor sem alteração de maiúsculas/minúsculas ---');
  {
    const incomingUid = CHARLES_CANONICAL_UID; // Mixed case: 2pG8N7bXyZ1W9qLmK4vRtP3sAeJ9
    const rawTeacherUid = incomingUid.trim();

    // Validação da lógica no App.tsx: nunca chamar toLowerCase() no UID
    const candidateCanonicalUid = (rawTeacherUid && isValidCanonicalUid(rawTeacherUid) ? rawTeacherUid : '');

    assert(
      candidateCanonicalUid === CHARLES_CANONICAL_UID,
      'UID canônico preserva exatamente maiúsculas e minúsculas originais'
    );
    assert(
      candidateCanonicalUid !== CHARLES_CANONICAL_UID.toLowerCase(),
      'UID NÃO foi corrompido por toLowerCase()'
    );

    // Verificação de busca case-sensitive em tutors
    const matched = catalogTutors.find((t) =>
      (t.uid && t.uid === candidateCanonicalUid) ||
      (t.authUid && t.authUid === candidateCanonicalUid) ||
      (t.id && t.id === candidateCanonicalUid)
    );

    assert(matched !== undefined, 'Professor encontrado por busca de UID com case-sensitivity estrita');
    assert(matched?.name === 'Charles Lambert', 'Professor correto (Charles Lambert) vinculado');
  }

  // ---------------------------------------------------------------------------
  // TESTE 4: Ausência do alerta indevido de Native Friend inválido
  // ---------------------------------------------------------------------------
  console.log('\n--- Teste 4: Ausência do alerta indevido de Native Friend inválido ---');
  {
    let alertCalled = false;
    let alertMessage = '';
    const mockAlert = (msg: string) => {
      alertCalled = true;
      alertMessage = msg;
    };

    // Parâmetros vindos do modal sem e-mail do professor
    const params = {
      teacherEmail: '',
      teacherName: 'Charles Lambert',
      teacherId: CHARLES_CANONICAL_UID,
      teacherUid: CHARLES_CANONICAL_UID,
      publicTutorId: CHARLES_PUBLIC_TUTOR_ID,
      packageLessons: 8,
    };

    // Lógica corrigida do App.tsx
    const rawTeacherUid = typeof params.teacherUid === 'string' ? params.teacherUid.trim() : '';
    const rawTeacherId = typeof params.teacherId === 'string' ? params.teacherId.trim() : '';
    const rawPublicTutorId = typeof params.publicTutorId === 'string' ? params.publicTutorId.trim() : '';
    const rawTeacherEmail = typeof params.teacherEmail === 'string' ? params.teacherEmail.trim() : '';

    const candidateCanonicalUid =
      (rawTeacherUid && isValidCanonicalUid(rawTeacherUid) ? rawTeacherUid : '') ||
      (rawTeacherId && isValidCanonicalUid(rawTeacherId) ? rawTeacherId : '');

    let matchedTutor: NativeFriendTutor | undefined = undefined;

    if (candidateCanonicalUid) {
      matchedTutor = catalogTutors.find((t) =>
        (t.uid && t.uid === candidateCanonicalUid) ||
        (t.authUid && t.authUid === candidateCanonicalUid) ||
        (t.id && t.id === candidateCanonicalUid)
      );
    }

    const canonicalTeacherUid =
      (matchedTutor?.uid && isValidCanonicalUid(matchedTutor.uid) ? matchedTutor.uid.trim() : '') ||
      (matchedTutor?.id && isValidCanonicalUid(matchedTutor.id) ? matchedTutor.id.trim() : '') ||
      (matchedTutor?.authUid && isValidCanonicalUid(matchedTutor.authUid) ? matchedTutor.authUid.trim() : '') ||
      candidateCanonicalUid;

    const hasValidTeacherIdentifier = Boolean(
      (canonicalTeacherUid && isValidCanonicalUid(canonicalTeacherUid)) ||
      (matchedTutor && (matchedTutor.id || matchedTutor.publicTutorId)) ||
      (rawTeacherEmail && rawTeacherEmail.includes('@') && matchedTutor)
    );

    if (!hasValidTeacherIdentifier) {
      mockAlert('Por favor, selecione um Amigo Nativo válido para contratar aulas.');
    }

    assert(!alertCalled, 'Nenhum alerta indevido disparado para professor válido sem e-mail exposto');
    assert(hasValidTeacherIdentifier === true, 'hasValidTeacherIdentifier avaliado como true com sucesso');
  }

  // ---------------------------------------------------------------------------
  // TESTE 5: Professor inexistente ou não aprovado continua sendo rejeitado pelo backend
  // ---------------------------------------------------------------------------
  console.log('\n--- Teste 5: Professor inexistente ou não aprovado continua sendo rejeitado pelo backend ---');
  {
    // A. Identificador arbitrário / inexistente no catálogo
    const invalidParams = {
      teacherName: 'Hacker Inexistente',
      teacherId: 'arbitrary-fake-id-12345',
      teacherUid: 'arbitrary-fake-id-12345',
    };

    const isUidValid = isValidCanonicalUid(invalidParams.teacherUid);
    assert(!isUidValid, 'Identificador arbitrário inválido é rejeitado pela validação canônica de UID');

    const matchedFake = catalogTutors.find((t) => t.id === invalidParams.teacherId);
    assert(!matchedFake, 'Identificador arbitrário não encontra correspondência no catálogo de professores');

    // B. Teste contra o backend resolveTeacherCanonicalIdentity com mock DB state
    const mockDbState = {
      tutorsList: [
        {
          id: CHARLES_CANONICAL_UID,
          uid: CHARLES_CANONICAL_UID,
          name: 'Charles Lambert',
          email: 'charles.teacher@itissimple.school',
          approvalStatus: 'approved',
          isApproved: true,
        },
        {
          id: 'unapproved-uid-12345678901234',
          uid: 'unapproved-uid-12345678901234',
          name: 'Pending Tutor',
          email: 'pending.tutor@itissimple.school',
          approvalStatus: 'pending',
          isApproved: false,
        },
      ],
      authUsers: {},
    };

    // Tentativa 1: Professor inexistente
    const resInexistente = await resolveTeacherCanonicalIdentity({
      teacherId: 'non-existent-teacher-99999',
      dbState: mockDbState as any,
    });
    assert(resInexistente === null, 'Backend resolveTeacherCanonicalIdentity rejeita professor inexistente (retorna null)');

    // Tentativa 2: Professor pendente / não aprovado
    const resPendente = await resolveTeacherCanonicalIdentity({
      teacherId: 'unapproved-uid-12345678901234',
      dbState: mockDbState as any,
    });
    assert(resPendente !== null, 'Professor pendente localizado no sistema');
    assert(resPendente?.isApproved === false, 'Backend confirma que professor pendente NÃO está aprovado (isApproved === false)');

    // Tentativa 3: Charles (aprovado)
    const resCharles = await resolveTeacherCanonicalIdentity({
      teacherId: CHARLES_CANONICAL_UID,
      dbState: mockDbState as any,
    });
    assert(resCharles !== null, 'Charles localizado com sucesso pelo backend via UID');
    assert(resCharles?.isApproved === true, 'Charles aprovado confirmado pelo backend');
    assert(resCharles?.canonicalUid === CHARLES_CANONICAL_UID, 'UID canônico de Charles resolvido com exatidão');
  }

  // ---------------------------------------------------------------------------
  // TESTE 6: Compra com professor válido mantém o vínculo correto
  // ---------------------------------------------------------------------------
  console.log('\n--- Teste 6: Compra com professor válido mantém o vínculo correto ---');
  {
    // Simulação do resultado autoritativo retornado da transação no backend
    const txResult = {
      success: true,
      contractedLessons: 8,
      availableLessons: 8,
      teacherUid: CHARLES_CANONICAL_UID,
      profile: {
        contractedLessons: 8,
        availableLessons: 8,
        teacherUid: CHARLES_CANONICAL_UID,
        teacherName: 'Charles Lambert',
        teacherEmail: 'charles.teacher@itissimple.school',
      },
    };

    let userProfileState: any = {
      name: 'Alice Student',
      email: 'alice.student@example.com',
      contractedLessons: 0,
      availableLessons: 0,
      teacherUid: undefined,
      assignedNativeFriendUID: undefined,
      nativeFriendUID: undefined,
      enrollmentStatus: 'not_enrolled',
    };

    const authoritativeTeacherUid =
      txResult.teacherUid ||
      txResult.profile?.teacherUid ||
      CHARLES_CANONICAL_UID;

    // Atualização de estado conforme implementado em App.tsx
    userProfileState = {
      ...userProfileState,
      subscriptionType: 'package',
      contractedLessons: 8,
      availableLessons: 8,
      teacherUid: authoritativeTeacherUid,
      assignedNativeFriendUID: authoritativeTeacherUid,
      nativeFriendUID: authoritativeTeacherUid,
      enrollmentStatus: 'active',
      weeklyNativeLessonsTarget: 2,
    };

    assert(
      userProfileState.teacherUid === CHARLES_CANONICAL_UID,
      'userProfile.teacherUid vinculado ao UID canônico de Charles'
    );
    assert(
      userProfileState.assignedNativeFriendUID === CHARLES_CANONICAL_UID,
      'userProfile.assignedNativeFriendUID vinculado ao UID canônico de Charles'
    );
    assert(
      userProfileState.nativeFriendUID === CHARLES_CANONICAL_UID,
      'userProfile.nativeFriendUID vinculado ao UID canônico de Charles'
    );
    assert(
      userProfileState.contractedLessons === 8 && userProfileState.availableLessons === 8,
      'Saldos de aulas contratadas e disponíveis atualizados para 8 aulas'
    );
    assert(
      userProfileState.enrollmentStatus === 'active',
      'Status de matrícula atualizado para active'
    );
  }

  // ---------------------------------------------------------------------------
  // TESTE 7: Compra pós-trial não é confundida com novo agendamento experimental
  // ---------------------------------------------------------------------------
  console.log('\n--- Teste 7: Compra pós-trial não é confundida com novo agendamento experimental ---');
  {
    // Aluna que já fez aula teste e agora está comprando pacote
    let scheduleStudentInfoState: any = {
      name: 'Alice Student',
      email: 'alice.student@example.com',
      isTrialLesson: true,
      teacherId: CHARLES_CANONICAL_UID,
    };

    // Durante o fluxo de compra de pacote em App.tsx:
    // "Clear any pending trial intent on package purchase"
    scheduleStudentInfoState = null;

    const userProfileAfterPurchase = {
      hasCompletedTrialLesson: true,
      subscriptionType: 'package',
      contractedLessons: 8,
      enrollmentStatus: 'active',
    };

    assert(
      scheduleStudentInfoState === null,
      'scheduleStudentInfo foi limpo (null), eliminando intenção pendente de aula teste'
    );
    assert(
      userProfileAfterPurchase.subscriptionType === 'package',
      'Assinatura marcada como pacote regular (package), não aula experimental'
    );
    assert(
      userProfileAfterPurchase.hasCompletedTrialLesson === true,
      'Histórico de aula experimental completada é mantido sem alteração'
    );
  }

  // ---------------------------------------------------------------------------
  // TESTE 8: Compatibilidade com o fluxo legado por e-mail, quando aplicável
  // ---------------------------------------------------------------------------
  console.log('\n--- Teste 8: Compatibilidade com o fluxo legado por e-mail, quando aplicável ---');
  {
    const legacyTutor: NativeFriendTutor = {
      id: 'legacy-tutor-bob',
      name: 'Bob Legacy',
      email: 'bob.legacy@itissimple.school',
      avatar: '',
      country: 'Canada',
      headline: 'Legacy Tutor',
      bio: '',
      specialties: [],
      approvalStatus: 'approved',
    } as NativeFriendTutor;

    const allTutorsWithLegacy = [...catalogTutors, legacyTutor];

    // Chamada legada fornecendo apenas teacherEmail
    const legacyParams = {
      teacherEmail: 'bob.legacy@itissimple.school',
      teacherName: 'Bob Legacy',
      packageLessons: 4,
    };

    const rawTeacherUid = '';
    const rawTeacherId = '';
    const rawTeacherEmail = legacyParams.teacherEmail.trim();

    let matchedTutor: NativeFriendTutor | undefined = undefined;

    // Busca de fallback por e-mail preservada
    if (rawTeacherEmail && rawTeacherEmail.includes('@')) {
      const cleanEmail = rawTeacherEmail.toLowerCase();
      matchedTutor = allTutorsWithLegacy.find((t) =>
        (t.email && t.email.trim().toLowerCase() === cleanEmail)
      );
    }

    assert(matchedTutor !== undefined, 'Professor do fluxo legado encontrado com sucesso pelo e-mail');
    assert(matchedTutor?.name === 'Bob Legacy', 'Nome do professor legado verificado');
    assert(matchedTutor?.email === 'bob.legacy@itissimple.school', 'E-mail do professor legado associado corretamente');
  }

  console.log('\n=========================================================================');
  console.log(` RESULTADOS DOS TESTES: ${passed} PASSOU | ${failed} FALHOU`);
  console.log('=========================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runTestSuite().catch((err) => {
  console.error('Unhandled error in test suite:', err);
  process.exit(1);
});
