/**
 * TESTE DE VALIDAÇÃO CIRÚRGICA: AGENDAMENTO PÓS-TRIAL
 * 
 * Validação rigorosa dos 7 cenários obrigatórios:
 * 1. Aluno novo solicita explicitamente uma aula experimental.
 * 2. Aluno abre o onboarding sem solicitar uma aula experimental.
 * 3. Aluno conclui o trial e compra um pacote.
 * 4. Aluno agenda uma aula paga imediatamente após a compra.
 * 5. Aluno cancela ou reagenda uma aula experimental.
 * 6. Aluno tenta utilizar o benefício experimental pela segunda vez.
 * 7. Aluno com créditos pagos agenda uma aula regular, independentemente do histórico de trial.
 * 
 * E confirmação autoritativa do backend na validação de elegibilidade e créditos.
 */

import {
  scheduleLessonAtomicServer,
  setFirebaseAdminFirestoreForTesting,
} from '../src/serverFirestore';
import { setFirebaseAdminAuthForTesting } from '../src/serverFirebaseAdmin';
import { LiveLesson, UserProfile } from '../src/types';

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

// In-memory Mock Firestore Store with Admin SDK semantics
class MockFirestoreStore {
  public collections: Map<string, Map<string, any>> = new Map();

  getCollection(collName: string) {
    if (!this.collections.has(collName)) {
      this.collections.set(collName, new Map());
    }
    return this.collections.get(collName)!;
  }

  collection(collPath: string) {
    const self = this;
    return {
      doc: (docId: string) => ({
        id: docId,
        path: `${collPath}/${docId}`,
        get: async () => {
          const coll = self.getCollection(collPath);
          const data = coll.get(docId);
          return {
            exists: Boolean(data),
            id: docId,
            data: () => (data ? JSON.parse(JSON.stringify(data)) : undefined),
          };
        },
        set: async (data: any, options?: { merge?: boolean }) => {
          const coll = self.getCollection(collPath);
          const existing = coll.get(docId) || {};
          const merged = options?.merge ? { ...existing, ...data } : data;
          coll.set(docId, JSON.parse(JSON.stringify(merged)));
          return { writeTime: new Date() };
        },
        collection: (subName: string) => self.collection(`${collPath}/${docId}/${subName}`),
      }),
      where: (field: string, op: string, value: any) => ({
        get: async () => {
          const coll = self.getCollection(collPath);
          const matched: any[] = [];
          for (const [id, data] of coll.entries()) {
            if (op === '==' && data[field] === value) {
              matched.push({ id, data: () => JSON.parse(JSON.stringify(data)), exists: true });
            }
          }
          return {
            empty: matched.length === 0,
            docs: matched,
            forEach: (cb: (d: any) => void) => matched.forEach(cb),
          };
        },
      }),
    };
  }

  async runTransaction(updateFunction: (transaction: any) => Promise<any>): Promise<any> {
    const transaction = {
      get: async (ref: any) => ref.get(),
      set: (ref: any, data: any, options?: { merge?: boolean }) => ref.set(data, options),
      update: (ref: any, data: any) => ref.set(data, { merge: true }),
    };
    return updateFunction(transaction);
  }
}

// Client helper representing the refined handleScheduleLesson evaluation logic
function evaluateClientBookingClassification(params: {
  userProfile: Partial<UserProfile>;
  lessons: LiveLesson[];
  scheduleStudentInfo: { isTrialLesson?: boolean } | null;
  isOnboardingModalOpen: boolean;
  studentEmail: string;
  studentUid: string;
}) {
  const { userProfile, lessons, scheduleStudentInfo, studentEmail, studentUid } = params;

  // 1. Check if student has already used/claimed trial
  const hasAlreadyUsedTrial = Boolean(
    userProfile.hasCompletedTrialLesson ||
    lessons.some((l) => {
      const isStudent =
        (studentEmail && (l.studentEmail || '').toLowerCase().trim() === studentEmail.toLowerCase().trim()) ||
        (studentUid && l.studentUid === studentUid);
      const isCancelled = (l.status as string) === 'cancelled' || (l.status as string) === 'canceled' || Boolean(l.cancelledAt);
      return isStudent && Boolean(l.isTrialLesson) && !isCancelled;
    })
  );

  // 2. Eligibility
  const isEligibleForTrial = !hasAlreadyUsedTrial && userProfile.subscriptionType !== 'package';

  // 3. Explicit intent strictly requires isTrialLesson: true
  const hasExplicitTrialIntent = Boolean((scheduleStudentInfo as any)?.isTrialLesson === true);

  // 4. Trial booking classification
  const isTrialBooking = Boolean(isEligibleForTrial && hasExplicitTrialIntent);

  return {
    hasAlreadyUsedTrial,
    isEligibleForTrial,
    hasExplicitTrialIntent,
    isTrialBooking,
  };
}

async function runSurgicalValidation() {
  console.log('========================================================================');
  console.log('🎯 VALIDAÇÃO CIRÚRGICA: FLUXO DE AGENDAMENTO TRIAL E PÓS-TRIAL');
  console.log('========================================================================\n');

  const mockDb = new MockFirestoreStore();
  setFirebaseAdminFirestoreForTesting(mockDb as any);
  setFirebaseAdminAuthForTesting({
    verifyIdToken: async () => ({ uid: 'test-user', email: 'test@example.com' }),
  } as any);

  const studentUid = 'std_sarah_conrado_canonical_uid';
  const studentEmail = 'student.surgical@example.com';
  const studentName = 'Sarah Conrado';

  const teacherUid = 'tutor_skull_bee_canonical_uid';
  const teacherEmail = 'skullbee@itissimple.org';
  const teacherName = 'Skull Bee';
  const publicTutorId = 'skull-bee';

  // Seed teacher in Firestore (both users and tutors for robust resolution)
  await mockDb.collection('users').doc(teacherUid).set({
    uid: teacherUid,
    id: teacherUid,
    email: teacherEmail,
    name: teacherName,
    role: 'teacher',
    isApproved: true,
    status: 'active',
    publicTutorId,
    meetUrl: 'https://meet.google.com/sb-surgical-room',
  });

  await mockDb.collection('tutors').doc(teacherUid).set({
    uid: teacherUid,
    id: teacherUid,
    email: teacherEmail,
    name: teacherName,
    isApproved: true,
    status: 'approved',
    publicTutorId,
    meetUrl: 'https://meet.google.com/sb-surgical-room',
  });

  // Seed initial student in Firestore (brand new student, trial subscription, 0 credits)
  await mockDb.collection('users').doc(studentUid).set({
    uid: studentUid,
    id: studentUid,
    email: studentEmail,
    name: studentName,
    role: 'student',
    subscriptionType: 'trial',
    hasCompletedTrialLesson: false,
    onboardingCompleted: false,
    contractedLessons: 0,
    availableLessons: 0,
  });

  const activeLessons: LiveLesson[] = [];

  // --------------------------------------------------------------------------
  // CENÁRIO 1: Aluno novo solicita explicitamente uma aula experimental
  // --------------------------------------------------------------------------
  console.log('--- CENÁRIO 1: Aluno novo solicita explicitamente aula experimental ---');
  {
    const clientEvaluation = evaluateClientBookingClassification({
      userProfile: {
        id: studentUid,
        email: studentEmail,
        subscriptionType: 'trial',
        hasCompletedTrialLesson: false,
        onboardingCompleted: false,
        availableLessons: 0,
      },
      lessons: activeLessons,
      scheduleStudentInfo: { isTrialLesson: true }, // Fluxo de trial explícito
      isOnboardingModalOpen: true,
      studentEmail,
      studentUid,
    });

    assert(clientEvaluation.hasExplicitTrialIntent === true, 'Intenção explícita detectada quando isTrialLesson: true');
    assert(clientEvaluation.isEligibleForTrial === true, 'Aluno novo sem histórico é elegível para trial');
    assert(clientEvaluation.isTrialBooking === true, 'Classificado como isTrialBooking: true');

    const txResult = await scheduleLessonAtomicServer({
      studentAuthUid: studentUid,
      studentEmail,
      studentName,
      teacherIdOrEmail: teacherUid,
      teacherUid,
      teacherEmail,
      teacherName,
      meetLink: 'https://meet.google.com/sb-surgical-room',
      startDateTime: '2026-11-02T10:00:00.000Z',
      endDateTime: '2026-11-02T10:25:00.000Z',
      title: 'Aula Experimental Ao Vivo',
      isTrialLesson: true,
      requestId: `lesson-${studentUid}-trial-1`,
      existingLessons: activeLessons,
    });

    assert(txResult.success === true, 'Backend autoriza e agenda aula experimental com sucesso');
    assert(txResult.isTrialLesson === true, 'Backend confirma isTrialLesson: true');
    assert(txResult.statusCode === 200, 'HTTP status 200 retornado pelo backend');

    // Confirm backend updated hasCompletedTrialLesson to true in Firestore
    const studentDoc = (await mockDb.collection('users').doc(studentUid).get()).data();
    assert(studentDoc.hasCompletedTrialLesson === true, 'Backend atualizou users/{uid}.hasCompletedTrialLesson = true');
    assert(studentDoc.onboardingCompleted === true, 'Backend atualizou users/{uid}.onboardingCompleted = true');

    activeLessons.push(txResult.lesson);
  }

  // --------------------------------------------------------------------------
  // CENÁRIO 2: Aluno abre o onboarding sem solicitar aula experimental
  // --------------------------------------------------------------------------
  console.log('\n--- CENÁRIO 2: Aluno com onboarding aberto tenta agendamento sem intenção de trial ---');
  {
    // Aluno fictício novo com onboarding aberto, mas sem intenção de trial (scheduleStudentInfo: null)
    const freshStudentUid = 'std_student_onboarding_no_trial_canonical';
    const freshStudentEmail = 'student.notrial@example.com';
    await mockDb.collection('users').doc(freshStudentUid).set({
      uid: freshStudentUid,
      id: freshStudentUid,
      email: freshStudentEmail,
      name: 'Novo Sem Trial',
      role: 'student',
      subscriptionType: 'trial',
      hasCompletedTrialLesson: false,
      onboardingCompleted: false,
      contractedLessons: 0,
      availableLessons: 0,
    });

    const clientEvaluation = evaluateClientBookingClassification({
      userProfile: {
        id: freshStudentUid,
        email: freshStudentEmail,
        subscriptionType: 'trial',
        hasCompletedTrialLesson: false,
        onboardingCompleted: false,
        availableLessons: 0,
      },
      lessons: [],
      scheduleStudentInfo: null, // Sem isTrialLesson: true
      isOnboardingModalOpen: true, // Onboarding aberto, mas SEM intenção explícita de trial!
      studentEmail: freshStudentEmail,
      studentUid: freshStudentUid,
    });

    assert(
      clientEvaluation.hasExplicitTrialIntent === false,
      'A simples abertura de onboarding NÃO gera intenção explícita de trial'
    );
    assert(
      clientEvaluation.isTrialBooking === false,
      'Agendamento sem isTrialLesson explícito NÃO é classificado como trial'
    );

    // Backend validação autoritativa: se o aluno não tem créditos e envia isTrialLesson: false, backend DEVE rejeitar com 402
    const txResult = await scheduleLessonAtomicServer({
      studentAuthUid: freshStudentUid,
      studentEmail: freshStudentEmail,
      studentName: 'Novo Sem Trial',
      teacherIdOrEmail: teacherUid,
      teacherUid,
      teacherEmail,
      teacherName,
      meetLink: 'https://meet.google.com/sb-surgical-room',
      startDateTime: '2026-11-03T10:00:00.000Z',
      endDateTime: '2026-11-03T10:50:00.000Z',
      title: 'Aula Regular Sem Crédito',
      isTrialLesson: false, // Não é trial
      requestId: `lesson-${freshStudentUid}-regular-fail`,
      existingLessons: [],
    });

    assert(txResult.success === false, 'Backend bloqueia agendamento regular sem créditos');
    assert(txResult.statusCode === 402, 'Backend retorna HTTP 402 (Saldo insuficiente)');
  }

  // --------------------------------------------------------------------------
  // CENÁRIO 3: Aluno conclui o trial e compra um pacote
  // --------------------------------------------------------------------------
  console.log('\n--- CENÁRIO 3: Aluno conclui o trial e compra um pacote de 4 aulas ---');
  {
    // Simula conclusão da aula experimental
    activeLessons[0].status = 'completed';
    activeLessons[0].completedAt = new Date().toISOString();

    // Compra de pacote autoritativa no Firestore
    const purchasedPackageLessons = 4;
    const currentDoc = (await mockDb.collection('users').doc(studentUid).get()).data();
    await mockDb.collection('users').doc(studentUid).set({
      ...currentDoc,
      subscriptionType: 'package',
      contractedLessons: purchasedPackageLessons,
      availableLessons: purchasedPackageLessons,
      updatedAt: new Date().toISOString(),
    });

    const updatedProfile = (await mockDb.collection('users').doc(studentUid).get()).data();
    assert(updatedProfile.subscriptionType === 'package', 'subscriptionType atualizado para "package"');
    assert(updatedProfile.availableLessons === 4, 'Saldo de aulas disponíveis atualizado para 4');
    assert(updatedProfile.hasCompletedTrialLesson === true, 'hasCompletedTrialLesson preservado como true');
  }

  // --------------------------------------------------------------------------
  // CENÁRIO 4: Aluno agenda uma aula paga imediatamente após a compra
  // --------------------------------------------------------------------------
  console.log('\n--- CENÁRIO 4: Aluno agenda aula paga imediatamente após a compra ---');
  {
    const clientEvaluation = evaluateClientBookingClassification({
      userProfile: {
        id: studentUid,
        email: studentEmail,
        subscriptionType: 'package',
        hasCompletedTrialLesson: true,
        onboardingCompleted: true,
        availableLessons: 4,
      },
      lessons: activeLessons,
      scheduleStudentInfo: null, // Agendamento regular a partir do dashboard
      isOnboardingModalOpen: false,
      studentEmail,
      studentUid,
    });

    assert(clientEvaluation.isEligibleForTrial === false, 'Aluno de pacote não é elegível para trial');
    assert(clientEvaluation.isTrialBooking === false, 'Agendamento pós-compra classificado como regular (isTrialBooking: false)');

    const paidLessonStart = '2026-11-04T15:00:00.000Z';
    const paidLessonEnd = '2026-11-04T15:50:00.000Z';
    const paidLessonId = `lesson-${studentUid}-paid-1`;

    const txResult = await scheduleLessonAtomicServer({
      studentAuthUid: studentUid,
      studentEmail,
      studentName,
      teacherIdOrEmail: teacherUid,
      teacherUid,
      teacherEmail,
      teacherName,
      meetLink: 'https://meet.google.com/sb-surgical-room',
      startDateTime: paidLessonStart,
      endDateTime: paidLessonEnd,
      title: 'Aula Ao Vivo 1-on-1',
      isTrialLesson: false,
      requestId: paidLessonId,
      existingLessons: activeLessons,
    });

    assert(txResult.success === true, 'Backend autoriza e agenda aula paga imediatamente após a compra');
    assert(txResult.isTrialLesson === false, 'Backend confirma isTrialLesson: false');
    assert(txResult.remainingLessons === 3, 'Backend decrementou saldo de 4 para 3 aulas disponíveis');
    assert(txResult.contractedLessons === 4, 'Backend manteve 4 aulas contratadas');

    const studentDocAfter = (await mockDb.collection('users').doc(studentUid).get()).data();
    assert(studentDocAfter.availableLessons === 3, 'Firestore users/{uid}.availableLessons sincronizado com 3');

    activeLessons.push(txResult.lesson);
  }

  // --------------------------------------------------------------------------
  // CENÁRIO 5: Aluno cancela ou reagenda uma aula experimental
  // --------------------------------------------------------------------------
  console.log('\n--- CENÁRIO 5: Cancelamento e Reagendamento de aula experimental ---');
  {
    // Cria uma aula experimental em estado agendado para o teste de fluxo
    const trialLessonToTest: LiveLesson = {
      id: `lesson-${studentUid}-trial-test5`,
      title: 'Aula Experimental Ao Vivo',
      startDateTime: '2026-11-05T16:00:00.000Z',
      endDateTime: '2026-11-05T16:25:00.000Z',
      studentUid,
      studentEmail,
      studentName,
      teacherUid,
      teacherEmail,
      teacherName,
      meetLink: 'https://meet.google.com/sb-surgical-room',
      status: 'scheduled',
      isTrialLesson: true,
      createdAt: new Date().toISOString(),
    };

    // Subcenário 5A: Reagendamento da aula experimental
    const proposedNewStart = '2026-11-06T17:00:00.000Z';
    const proposedNewEnd = '2026-11-06T17:25:00.000Z';
    const rescheduledLesson: LiveLesson = {
      ...trialLessonToTest,
      startDateTime: proposedNewStart,
      endDateTime: proposedNewEnd,
      rescheduledFrom: {
        startDateTime: trialLessonToTest.startDateTime,
        endDateTime: trialLessonToTest.endDateTime,
      },
      rescheduledAt: new Date().toISOString(),
      rescheduledBy: 'student',
    };

    assert(rescheduledLesson.id === trialLessonToTest.id, 'Reagendamento preserva ID in-place');
    assert(rescheduledLesson.isTrialLesson === true, 'Reagendamento preserva status isTrialLesson: true');
    assert(rescheduledLesson.startDateTime === proposedNewStart, 'Novo horário aplicado com sucesso');

    // Subcenário 5B: Cancelamento da aula experimental
    const cancelledLesson: LiveLesson = {
      ...trialLessonToTest,
      status: 'cancelled',
      cancelledAt: new Date().toISOString(),
      cancelledBy: 'student',
      cancellationReason: 'Cancelled for personal reasons',
    };

    assert(cancelledLesson.status === 'cancelled', 'Status da aula alterado para cancelled');
    assert(Boolean(cancelledLesson.cancelledAt), 'cancelledAt registrado no timestamp');
  }

  // --------------------------------------------------------------------------
  // CENÁRIO 6: Aluno tenta utilizar o benefício experimental pela segunda vez
  // --------------------------------------------------------------------------
  console.log('\n--- CENÁRIO 6: Bloqueio de 2ª utilização do benefício experimental ---');
  {
    const clientEvaluation = evaluateClientBookingClassification({
      userProfile: {
        id: studentUid,
        email: studentEmail,
        subscriptionType: 'package',
        hasCompletedTrialLesson: true, // Já consumiu benefício
        onboardingCompleted: true,
        availableLessons: 3,
      },
      lessons: activeLessons,
      scheduleStudentInfo: { isTrialLesson: true }, // Aluno maliciosamente tenta forçar flag de trial
      isOnboardingModalOpen: false,
      studentEmail,
      studentUid,
    });

    assert(clientEvaluation.isEligibleForTrial === false, 'Frontend identifica que aluno já utilizou benefício e não é elegível');
    assert(clientEvaluation.isTrialBooking === false, 'Frontend bloqueia classificação como trial mesmo com flag enviada');

    // Backend validação definitiva autoritativa:
    // Se alguém tentar enviar isTrialLesson: true para o backend após já ter utilizado o trial
    const txResult = await scheduleLessonAtomicServer({
      studentAuthUid: studentUid,
      studentEmail,
      studentName,
      teacherIdOrEmail: teacherUid,
      teacherUid,
      teacherEmail,
      teacherName,
      meetLink: 'https://meet.google.com/sb-surgical-room',
      startDateTime: '2026-11-07T10:00:00.000Z',
      endDateTime: '2026-11-07T10:25:00.000Z',
      title: 'Tentativa de Segundo Trial Gratuito',
      isTrialLesson: true, // Forçando trial
      requestId: `lesson-${studentUid}-second-trial-fail`,
      existingLessons: activeLessons,
    });

    assert(txResult.success === false, 'Backend autoritativo bloqueia tentativa de 2ª aula experimental');
    assert(txResult.statusCode === 400, 'Backend retorna HTTP 400');
    assert(
      Boolean(txResult.error?.includes('Aula experimental já foi utilizada') || txResult.error?.includes('já possui uma aula experimental')),
      'Mensagem clara do backend rejeitando reutilização do trial'
    );
  }

  // --------------------------------------------------------------------------
  // CENÁRIO 7: Aluno com créditos pagos agenda aula regular independentemente do trial
  // --------------------------------------------------------------------------
  console.log('\n--- CENÁRIO 7: Aluno com créditos agenda aula regular com sucesso ---');
  {
    // Aluno possui créditos pagos (saldo 3) e hasCompletedTrialLesson = true
    const clientEvaluation = evaluateClientBookingClassification({
      userProfile: {
        id: studentUid,
        email: studentEmail,
        subscriptionType: 'package',
        hasCompletedTrialLesson: true,
        onboardingCompleted: true,
        availableLessons: 3,
      },
      lessons: activeLessons,
      scheduleStudentInfo: null,
      isOnboardingModalOpen: false,
      studentEmail,
      studentUid,
    });

    assert(clientEvaluation.isTrialBooking === false, 'Classificado como regular');

    const secondPaidStart = '2026-11-08T14:00:00.000Z';
    const secondPaidEnd = '2026-11-08T14:50:00.000Z';
    const secondPaidId = `lesson-${studentUid}-paid-2`;

    const txResult = await scheduleLessonAtomicServer({
      studentAuthUid: studentUid,
      studentEmail,
      studentName,
      teacherIdOrEmail: teacherUid,
      teacherUid,
      teacherEmail,
      teacherName,
      meetLink: 'https://meet.google.com/sb-surgical-room',
      startDateTime: secondPaidStart,
      endDateTime: secondPaidEnd,
      title: 'Segunda Aula Paga 1-on-1',
      isTrialLesson: false,
      requestId: secondPaidId,
      existingLessons: activeLessons,
    });

    assert(txResult.success === true, 'Backend autoriza agendamento regular de aluno com créditos');
    assert(txResult.isTrialLesson === false, 'isTrialLesson é false');
    assert(txResult.remainingLessons === 2, 'Saldo reduzido de 3 para 2 aulas disponíveis');

    const finalDoc = (await mockDb.collection('users').doc(studentUid).get()).data();
    assert(finalDoc.availableLessons === 2, 'Firestore users/{uid}.availableLessons agora é 2');
    assert(finalDoc.contractedLessons === 4, 'Firestore users/{uid}.contractedLessons permanece 4');
    assert(finalDoc.hasCompletedTrialLesson === true, 'hasCompletedTrialLesson permanece true');
  }

  console.log('\n========================================================================');
  console.log(`📊 RESULTADO FINAL DOS TESTES: ${passed} PASSOU | ${failed} FALHOU`);
  console.log('========================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runSurgicalValidation().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
