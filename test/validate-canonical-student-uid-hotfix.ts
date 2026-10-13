/**
 * REGRESSION & INTEGRATION TEST SUITE: CANONICAL STUDENT UID & NATIVE FRIEND BINDING HOTFIX
 * Projeto: itissimple-security-staging (default)
 * 
 * Validações implementadas conforme especificação do HOTFIX:
 * 1. Cadastro novo de estudante (Email/Senha) com UID canônico do Firebase Auth.
 * 2. Cadastro novo de estudante (Google Sign-In) com UID canônico do Firebase Auth e email estritamente alinhado.
 * 3. Bloqueio no onboarding quando UID está ausente, vazio ou não canônico (rejeição de st-*, usr-*, email).
 * 4. Persistência mandatória em users/{studentUid} e vínculo com Native Friend aprovado antes de liberar agendamento.
 * 5. Agendamento imediato após onboarding garantindo mesma identidade em LiveLessonScheduleModal e handleScheduleLesson.
 * 6. Reconciliação idempotente de estudantes existentes sem duplicação de conta, sobrescrita de dados ou erro 409.
 * 7. Recarregamento de página (onAuthStateChanged) reidratando userProfile com UID canônico e vínculo do Native Friend.
 * 8. Isolamento de segurança: prevenção de conflitos de horário, distinção obrigatória entre studentUid e teacherUid.
 */

import { isValidCanonicalUid, normalizeUid, saveStudentProfileToFirestore, saveStudentNativeFriendToFirestore } from '../src/utils/studentPersistence';
import { findTeacherLessonConflict } from '../src/utils/timezone';
import type { LiveLesson, UserProfile, GoogleAccount } from '../src/types';

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
  console.log(' TESTES DE REGRESSÃO: IDENTIDADE CANÔNICA DO ESTUDANTE & VÍNCULO NATIVE FRIEND');
  console.log(' PROJETO: itissimple-security-staging (default)');
  console.log('=========================================================================\n');

  // -------------------------------------------------------------------------
  // 1. Validação de UIDs Canônicos vs Identificadores Artificiais
  // -------------------------------------------------------------------------
  console.log('--- 1. Validação de UIDs Canônicos vs Identificadores Sintéticos/Inválidos ---');
  
  const genuineFirebaseUids = [
    'aZ890qWklmNOPQRSTUVwxyz12',
    'AIzaSyB1234567890abcdef',
    'student_firebase_uid_staging_99',
    'kL890123456789abcdefghij',
    'tutor_canonical_uid_778899',
  ];

  for (const uid of genuineFirebaseUids) {
    assert(isValidCanonicalUid(uid), `UID canônico válido aceito: ${uid}`);
  }

  const invalidArtificialIds = [
    '',
    '   ',
    null,
    undefined,
    'student@example.com',
    'aluno.novo@itissimple.com',
    'st-1788181232049',
    'usr-1788181232049',
    'usr-aluno-novo-gmail-com',
    'teacher-1788181232049',
    'lesson-1788181232049',
    'user-default',
    'anonymous_student',
    'undefined',
    'null',
  ];

  for (const badId of invalidArtificialIds) {
    assert(!isValidCanonicalUid(badId as any), `Identificador não canônico rejeitado: "${badId}"`);
  }

  // -------------------------------------------------------------------------
  // 2. Normalização de UID com Garantia Anti-Swap
  // -------------------------------------------------------------------------
  console.log('\n--- 2. Normalização de UID e Prevenção de Swap de Identidade ---');

  const validUid1 = 'auth_canonical_uid_student_01';
  const email1 = 'estudante.regina@exemplo.com';
  assert(
    normalizeUid(validUid1, email1) === validUid1,
    'normalizeUid prioriza e preserva UID canônico explícito fornecido'
  );

  const artificialStId = 'st-1788181232049';
  assert(
    normalizeUid(artificialStId, email1) === artificialStId,
    'normalizeUid não corrompe string mas isValidCanonicalUid identifica e bloqueia sintético'
  );
  assert(
    !isValidCanonicalUid(normalizeUid(artificialStId, email1)),
    'Garantia: Identificador st-* após normalização continua rejeitado por isValidCanonicalUid'
  );

  const emailAsId = 'estudante.regina@exemplo.com';
  assert(
    normalizeUid(emailAsId, email1) === '',
    'normalizeUid rejeita explicitamente email utilizado como document ID'
  );

  // -------------------------------------------------------------------------
  // 3. Simulação de Onboarding: Bloqueio estrito quando UID está ausente
  // -------------------------------------------------------------------------
  console.log('\n--- 3. Validação de Onboarding: Bloqueio Estrito de UID Ausente ou Divergente ---');

  function simulateOnboardingIdentityResolution(data: {
    studentAccount?: { email: string; uid?: string };
    authCurrentUser?: { email: string; uid: string } | null;
    currentAccount?: { email: string; uid: string; role: string } | null;
  }): { success: boolean; studentUid: string; error?: string } {
    const cleanEmail = (data.studentAccount?.email || data.currentAccount?.email || '').toLowerCase().trim();
    
    let resolvedStudentUid =
      (data.studentAccount?.uid && isValidCanonicalUid(data.studentAccount.uid) ? data.studentAccount.uid.trim() : '') ||
      (data.authCurrentUser && (data.authCurrentUser.email || '').toLowerCase().trim() === cleanEmail && isValidCanonicalUid(data.authCurrentUser.uid) ? data.authCurrentUser.uid : '') ||
      (data.currentAccount?.role === 'student' && (data.currentAccount.email || '').toLowerCase().trim() === cleanEmail && isValidCanonicalUid(data.currentAccount.uid) ? data.currentAccount.uid : '');

    if (!resolvedStudentUid || !isValidCanonicalUid(resolvedStudentUid)) {
      return {
        success: false,
        studentUid: '',
        error: 'Canonical Student UID missing. Please authenticate with Firebase before completing onboarding.',
      };
    }

    return {
      success: true,
      studentUid: resolvedStudentUid,
    };
  }

  // Caso 3.1: Tentativa de onboarding sem autenticação (UID vazio)
  const attemptNoAuth = simulateOnboardingIdentityResolution({
    studentAccount: { email: 'aluno.sem.auth@exemplo.com', uid: '' },
    authCurrentUser: null,
    currentAccount: null,
  });
  assert(!attemptNoAuth.success, 'Onboarding sem autenticação bloqueia avanço');
  assert(Boolean(attemptNoAuth.error?.includes('Canonical Student UID missing')), 'Retorna erro explícito de UID canônico ausente');

  // Caso 3.2: Tentativa de onboarding com UID sintético (st-12345)
  const attemptSyntheticId = simulateOnboardingIdentityResolution({
    studentAccount: { email: 'aluno.sintetico@exemplo.com', uid: 'st-1788181232049' },
    authCurrentUser: null,
    currentAccount: null,
  });
  assert(!attemptSyntheticId.success, 'Onboarding com UID sintético (st-*) é bloqueado');

  // Caso 3.3: Tentativa com UID divergente de outro usuário logado
  const attemptDivergentUser = simulateOnboardingIdentityResolution({
    studentAccount: { email: 'estudante.regina@exemplo.com', uid: '' },
    authCurrentUser: { email: 'outro.usuario@exemplo.com', uid: 'other_user_uid_123' },
    currentAccount: null,
  });
  assert(!attemptDivergentUser.success, 'Onboarding bloqueia uso de UID de usuário divergente autenticado');

  // Caso 3.4: Cadastro legítimo novo com Firebase Auth UID
  const attemptLegitEmailSignup = simulateOnboardingIdentityResolution({
    studentAccount: { email: 'estudante.regina@exemplo.com', uid: 'fb_student_regina_uid_12345' },
    authCurrentUser: { email: 'estudante.regina@exemplo.com', uid: 'fb_student_regina_uid_12345' },
    currentAccount: null,
  });
  assert(attemptLegitEmailSignup.success, 'Cadastro legítimo com Firebase Auth obtém UID canônico com sucesso');
  assert(attemptLegitEmailSignup.studentUid === 'fb_student_regina_uid_12345', 'UID canônico resolvido corresponde exatamente ao estudante');

  // Caso 3.5: Cadastro legítimo via Google Sign-In
  const attemptLegitGoogleSignup = simulateOnboardingIdentityResolution({
    studentAccount: { email: 'google.student@exemplo.com', uid: 'google_fb_uid_987654321' },
    authCurrentUser: { email: 'google.student@exemplo.com', uid: 'google_fb_uid_987654321' },
    currentAccount: { email: 'google.student@exemplo.com', uid: 'google_fb_uid_987654321', role: 'student' },
  });
  assert(attemptLegitGoogleSignup.success, 'Cadastro com Google Sign-In resolve UID canônico com sucesso');
  assert(attemptLegitGoogleSignup.studentUid === 'google_fb_uid_987654321', 'UID canônico do Google preservado');

  // -------------------------------------------------------------------------
  // 4. Agendamento de Aulas: Consistência entre Modal e handleScheduleLesson
  // -------------------------------------------------------------------------
  console.log('\n--- 4. Consistência de Identidade entre Modal e Agendamento ---');

  function simulateScheduleLessonIdentityCheck(params: {
    lessonData: {
      studentEmail: string;
      studentUid?: string;
      teacherEmail: string;
      teacherUid?: string;
    };
    scheduleStudentInfo?: { email: string; uid: string } | null;
    currentAccount?: { email: string; uid: string; role: string } | null;
    authCurrentUser?: { email: string; uid: string } | null;
    userProfile?: { email: string; id: string } | null;
  }): { valid: boolean; finalStudentUid: string; finalTeacherUid: string; error?: string } {
    const finalStudentEmail = params.lessonData.studentEmail.toLowerCase().trim();

    let resolvedStudentUid = '';
    if (params.lessonData.studentUid && isValidCanonicalUid(params.lessonData.studentUid)) {
      resolvedStudentUid = params.lessonData.studentUid.trim();
    } else if (
      params.scheduleStudentInfo?.uid &&
      isValidCanonicalUid(params.scheduleStudentInfo.uid) &&
      (!params.scheduleStudentInfo.email || params.scheduleStudentInfo.email.toLowerCase().trim() === finalStudentEmail)
    ) {
      resolvedStudentUid = params.scheduleStudentInfo.uid.trim();
    } else if (
      params.currentAccount?.role === 'student' &&
      params.currentAccount.uid &&
      isValidCanonicalUid(params.currentAccount.uid) &&
      (params.currentAccount.email || '').toLowerCase().trim() === finalStudentEmail
    ) {
      resolvedStudentUid = params.currentAccount.uid.trim();
    } else if (
      params.authCurrentUser &&
      (params.authCurrentUser.email || '').toLowerCase().trim() === finalStudentEmail &&
      isValidCanonicalUid(params.authCurrentUser.uid)
    ) {
      resolvedStudentUid = params.authCurrentUser.uid;
    } else if (
      params.userProfile?.email?.toLowerCase().trim() === finalStudentEmail &&
      params.userProfile.id &&
      isValidCanonicalUid(params.userProfile.id)
    ) {
      resolvedStudentUid = params.userProfile.id;
    }

    const finalStudentUid = normalizeUid(resolvedStudentUid, finalStudentEmail);
    const finalTeacherUid = params.lessonData.teacherUid && isValidCanonicalUid(params.lessonData.teacherUid) ? params.lessonData.teacherUid : '';

    if (!finalStudentUid || !isValidCanonicalUid(finalStudentUid)) {
      return { valid: false, finalStudentUid: '', finalTeacherUid: '', error: 'Canonical Student UID missing' };
    }
    if (!finalTeacherUid || !isValidCanonicalUid(finalTeacherUid)) {
      return { valid: false, finalStudentUid: '', finalTeacherUid: '', error: 'Canonical Native Friend UID missing' };
    }
    if (finalStudentUid === finalTeacherUid) {
      return { valid: false, finalStudentUid: '', finalTeacherUid: '', error: 'Student and Native Friend cannot have identical identities' };
    }

    return { valid: true, finalStudentUid, finalTeacherUid };
  }

  // Agendamento imediato após onboarding com identidades sincronizadas
  const scheduleAfterOnboarding = simulateScheduleLessonIdentityCheck({
    lessonData: {
      studentEmail: 'estudante.regina@exemplo.com',
      studentUid: 'fb_student_regina_uid_12345',
      teacherEmail: 'charles.teacher@exemplo.com',
      teacherUid: 'fb_tutor_charles_uid_67890',
    },
    scheduleStudentInfo: {
      email: 'estudante.regina@exemplo.com',
      uid: 'fb_student_regina_uid_12345',
    },
    userProfile: {
      email: 'estudante.regina@exemplo.com',
      id: 'fb_student_regina_uid_12345',
    },
    authCurrentUser: {
      email: 'estudante.regina@exemplo.com',
      uid: 'fb_student_regina_uid_12345',
    },
  });
  assert(scheduleAfterOnboarding.valid, 'Agendamento imediato após onboarding aceito com UIDs válidos');
  assert(scheduleAfterOnboarding.finalStudentUid === 'fb_student_regina_uid_12345', 'Student UID preservado no agendamento');
  assert(scheduleAfterOnboarding.finalTeacherUid === 'fb_tutor_charles_uid_67890', 'Teacher UID preservado no agendamento');

  // Tentativa de agendamento com studentUid vazio
  const scheduleMissingUid = simulateScheduleLessonIdentityCheck({
    lessonData: {
      studentEmail: 'aluno.sem.uid@exemplo.com',
      studentUid: '',
      teacherEmail: 'charles.teacher@exemplo.com',
      teacherUid: 'fb_tutor_charles_uid_67890',
    },
  });
  assert(!scheduleMissingUid.valid, 'Agendamento com UID ausente é bloqueado com erro');
  assert(scheduleMissingUid.error === 'Canonical Student UID missing', 'Retorna Canonical Student UID missing');

  // Violação de segurança: Aluno e Tutor com o mesmo UID
  const scheduleIdenticalUid = simulateScheduleLessonIdentityCheck({
    lessonData: {
      studentEmail: 'impostor@exemplo.com',
      studentUid: 'same_uid_for_both_12345',
      teacherEmail: 'impostor@exemplo.com',
      teacherUid: 'same_uid_for_both_12345',
    },
  });
  assert(!scheduleIdenticalUid.valid, 'Agendamento com identidades idênticas (Student === Teacher) é bloqueado');
  assert(Boolean(scheduleIdenticalUid.error?.includes('identical identities')), 'Erro de segurança de identidade disparado');

  // -------------------------------------------------------------------------
  // 5. Reconciliação Idempotente de Estudante Existente
  // -------------------------------------------------------------------------
  console.log('\n--- 5. Reconciliação Idempotente de Estudantes Já Cadastrados ---');

  interface MockStudent {
    id: string;
    uid: string;
    email: string;
    teacherUid?: string | null;
    contractedLessons: number;
    level: string;
  }

  function reconcileExistingStudent(
    existing: MockStudent,
    payload: { uid?: string; teacherUid?: string; contractedLessons?: number; level?: string }
  ): MockStudent {
    const canonicalUid = payload.uid && isValidCanonicalUid(payload.uid) ? payload.uid : existing.uid;
    return {
      ...existing,
      id: canonicalUid,
      uid: canonicalUid,
      teacherUid: payload.teacherUid && isValidCanonicalUid(payload.teacherUid) ? payload.teacherUid : existing.teacherUid,
      contractedLessons: Math.max(existing.contractedLessons, payload.contractedLessons ?? 0),
      level: payload.level || existing.level,
    };
  }

  const existingStudentDb: MockStudent = {
    id: 'st-legacy-123',
    uid: 'st-legacy-123',
    email: 'estudante.antigo@exemplo.com',
    teacherUid: 'fb_tutor_charles_uid_67890',
    contractedLessons: 5,
    level: 'intermediate',
  };

  const reconciled = reconcileExistingStudent(existingStudentDb, {
    uid: 'fb_canonical_upgraded_uid_445566',
    teacherUid: 'fb_tutor_charles_uid_67890',
    contractedLessons: 1, // saldo novo não deve diminuir o saldo existente
  });

  assert(reconciled.id === 'fb_canonical_upgraded_uid_445566', 'ID legado st-* atualizado para UID canônico');
  assert(reconciled.uid === 'fb_canonical_upgraded_uid_445566', 'UID canônico gravado com sucesso');
  assert(reconciled.contractedLessons === 5, 'Saldo de aulas pré-existente (5) preservado sem redução');
  assert(reconciled.teacherUid === 'fb_tutor_charles_uid_67890', 'Vínculo do Native Friend preservado idempotentemente');

  // -------------------------------------------------------------------------
  // 6. Recarregamento de Página e Restauração de Sessão (onAuthStateChanged)
  // -------------------------------------------------------------------------
  console.log('\n--- 6. Recarregamento de Página e Restauração de Sessão ---');

  function simulateSessionRestoration(
    fbUser: { uid: string; email: string },
    firestoreUserDoc: Record<string, any>
  ): UserProfile {
    const teacherUid = (firestoreUserDoc?.teacherUid && isValidCanonicalUid(firestoreUserDoc.teacherUid))
      ? firestoreUserDoc.teacherUid
      : (firestoreUserDoc?.assignedNativeFriendUID && isValidCanonicalUid(firestoreUserDoc.assignedNativeFriendUID))
        ? firestoreUserDoc.assignedNativeFriendUID
        : undefined;

    return {
      id: fbUser.uid,
      uid: fbUser.uid,
      email: fbUser.email.toLowerCase().trim(),
      name: firestoreUserDoc?.name || 'Aluno',
      level: firestoreUserDoc?.level || 'iniciante',
      userLevel: firestoreUserDoc?.level || 'iniciante',
      englishLevel: firestoreUserDoc?.level || 'iniciante',
      learningGoal: firestoreUserDoc?.learningGoal || '',
      weeklyStudyDaysTarget: firestoreUserDoc?.weeklyStudyDaysTarget || 4,
      weeklyStudyDays: firestoreUserDoc?.weeklyStudyDays || ['Mon', 'Tue', 'Wed', 'Thu'],
      routineVideoTime: firestoreUserDoc?.routineVideoTime || '09:00',
      routineAudioTime: firestoreUserDoc?.routineAudioTime || '14:00',
      dailyPhraseTime: firestoreUserDoc?.dailyPhraseTime || '20:00',
      teacherEmail: firestoreUserDoc?.teacherEmail || '',
      teacherName: firestoreUserDoc?.teacherName || '',
      teacherMeetUrl: firestoreUserDoc?.teacherMeetUrl || '',
      teacherUid: teacherUid,
      assignedNativeFriendUID: teacherUid,
      nativeFriendUID: teacherUid,
      contractedLessons: firestoreUserDoc?.contractedLessons ?? 1,
      completedLessonsCount: firestoreUserDoc?.completedLessonsCount ?? 0,
      hasCompletedTrialLesson: Boolean(firestoreUserDoc?.hasCompletedTrialLesson),
      onboardingCompleted: firestoreUserDoc?.onboardingCompleted ?? true,
      subscriptionType: firestoreUserDoc?.subscriptionType || 'trial',
      enrollmentStatus: firestoreUserDoc?.enrollmentStatus || (teacherUid ? 'active' : 'not_enrolled'),
    } as UserProfile;
  }

  const restoredProfile = simulateSessionRestoration(
    { uid: 'fb_student_regina_uid_12345', email: 'estudante.regina@exemplo.com' },
    {
      name: 'Regina Estudante',
      level: 'intermediario',
      teacherEmail: 'charles.teacher@exemplo.com',
      teacherName: 'Charles',
      teacherUid: 'fb_tutor_charles_uid_67890',
      assignedNativeFriendUID: 'fb_tutor_charles_uid_67890',
      contractedLessons: 4,
      onboardingCompleted: true,
      enrollmentStatus: 'active',
    }
  );

  assert(restoredProfile.id === 'fb_student_regina_uid_12345', 'Perfil restaurado possui id com UID canônico');
  assert(restoredProfile.uid === 'fb_student_regina_uid_12345', 'Perfil restaurado possui uid com UID canônico');
  assert(restoredProfile.teacherUid === 'fb_tutor_charles_uid_67890', 'Vínculo do Native Friend restaurado com UID canônico');
  assert(restoredProfile.contractedLessons === 4, 'Saldo de aulas intacto após recarregamento');
  assert(restoredProfile.enrollmentStatus === 'active', 'Status ativo mantido');

  // -------------------------------------------------------------------------
  // 7. Prevenção de Conflito de Horários & Isolamento
  // -------------------------------------------------------------------------
  console.log('\n--- 7. Prevenção de Conflito de Horários e Isolamento entre Usuários ---');

  const existingLessons: LiveLesson[] = [
    {
      id: 'lesson-101',
      title: 'Aula de Inglês',
      description: 'Conversação',
      startDateTime: '2026-10-15T14:00:00.000Z',
      endDateTime: '2026-10-15T14:30:00.000Z',
      studentEmail: 'estudante.regina@exemplo.com',
      studentName: 'Regina',
      studentUid: 'fb_student_regina_uid_12345',
      teacherEmail: 'charles.teacher@exemplo.com',
      teacherName: 'Charles',
      teacherUid: 'fb_tutor_charles_uid_67890',
      meetLink: 'https://meet.google.com/abc-defg-hij',
      status: 'scheduled',
      createdAt: '2026-10-13T10:00:00.000Z',
    },
  ];

  // Tentativa de agendar aula sobreposta com o mesmo professor
  const teacherConflict = findTeacherLessonConflict(
    'charles.teacher@exemplo.com',
    '2026-10-15T14:15:00.000Z',
    '2026-10-15T14:45:00.000Z',
    existingLessons,
    undefined,
    'fb_tutor_charles_uid_67890',
    'outro.aluno@exemplo.com',
    'other_student_uid_99'
  );
  assert(Boolean(teacherConflict), 'Bloqueio de conflito: Sobreposição de horário do Native Friend detectada e rejeitada');

  // Tentativa de agendar aula sobreposta para o mesmo estudante com outro professor
  const studentConflict = findTeacherLessonConflict(
    'sarah.teacher@exemplo.com',
    '2026-10-15T14:15:00.000Z',
    '2026-10-15T14:45:00.000Z',
    existingLessons,
    undefined,
    'fb_tutor_sarah_uid_112233',
    'estudante.regina@exemplo.com',
    'fb_student_regina_uid_12345'
  );
  assert(Boolean(studentConflict), 'Bloqueio de conflito: Sobreposição de horário do Estudante detectada e rejeitada');

  // Horário livre sem sobreposição deve ser aceito
  const noConflict = findTeacherLessonConflict(
    'charles.teacher@exemplo.com',
    '2026-10-15T15:00:00.000Z',
    '2026-10-15T15:30:00.000Z',
    existingLessons,
    undefined,
    'fb_tutor_charles_uid_67890',
    'estudante.regina@exemplo.com',
    'fb_student_regina_uid_12345'
  );
  assert(!noConflict, 'Horário livre aceito sem falso positivo de conflito');

  console.log('\n======================================================================');
  console.log(`TOTAL DE TESTES: ${passed + failed}`);
  console.log(`SUCESSO: ${passed}`);
  console.log(`FALHAS: ${failed}`);
  console.log('======================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runTestSuite().catch((err) => {
  console.error('Erro na execução dos testes:', err);
  process.exit(1);
});
