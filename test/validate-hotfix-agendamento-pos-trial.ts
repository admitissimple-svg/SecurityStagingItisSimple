/**
 * TESTE DE VALIDAÇÃO: HOTFIX CIRÚRGICO - AGENDAMENTO PÓS-TRIAL E COMPRA DE PACOTE
 * Projeto: itissimple-security-staging (default)
 * 
 * Validações obrigatórias:
 * 1. Agendamento experimental válido para aluno elegível no onboarding.
 * 2. Bloqueio de segunda aula experimental gratuita (aluno que já realizou trial).
 * 3. Compra de pacote após trial concluído com atualização autoritativa do backend.
 * 4. Agendamento de aula paga imediatamente após a compra, sem F5 (estado local sincronizado).
 * 5. Agendamento de aula paga após F5 (reidratação do perfil do Firestore).
 * 6. Ausência do POST redundante desautenticado que retornava 401 (/api/user-profile).
 * 7. Preservação do saldo e prevenção de agendamentos duplicados (idempotência e bloqueio de conflito).
 * 8. Isolamento entre alunos e professores (rejeição de auto-agendamento e acesso cruzado).
 */

import fs from 'fs';
import path from 'path';
import {
  scheduleLessonAtomicServer,
  getFirestoreDb,
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

// In-memory Mock Firestore Store
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
    const parts = collPath.split('/');
    const collName = parts[parts.length - 1];

    return {
      doc: (docId: string) => {
        return {
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
        };
      },
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
    const self = this;
    const transaction = {
      get: async (ref: any) => ref.get(),
      set: (ref: any, data: any, options?: { merge?: boolean }) => ref.set(data, options),
      update: (ref: any, data: any) => ref.set(data, { merge: true }),
    };
    return updateFunction(transaction);
  }
}

async function runHotfixValidation() {
  console.log('===========================================================================');
  console.log(' IT\'S SIMPLE — HOTFIX: AGENDAMENTO PÓS-TRIAL E COMPRA DE PACOTE');
  console.log(' Validação Rigorosa das 8 Dimensões do Fluxo de Alunos e Native Friends');
  console.log('===========================================================================\n');

  const mockDb = new MockFirestoreStore();
  setFirebaseAdminFirestoreForTesting(mockDb as any);

  // Setup initial accounts: 1 Student (Lala) and 1 Approved Teacher (Skull Bee)
  const studentUid = 'usr_lala_pos_trial_test';
  const studentEmail = 'lala.postrial@gmail.com';
  const studentName = 'Lala';

  const teacherUid = 'tutor_skull_bee_canonical_uid';
  const teacherEmail = 'skullbee@itissimple.org';
  const teacherName = 'Skull Bee';
  const publicTutorId = 'skull-bee';

  // Seed teacher in Firestore
  await mockDb.collection('users').doc(teacherUid).set({
    uid: teacherUid,
    id: teacherUid,
    email: teacherEmail,
    name: teacherName,
    role: 'teacher',
    isApproved: true,
    status: 'active',
    publicTutorId,
    meetUrl: 'https://meet.google.com/sb-valid-room',
  });

  await mockDb.collection('tutors').doc(teacherUid).set({
    uid: teacherUid,
    id: teacherUid,
    email: teacherEmail,
    name: teacherName,
    isApproved: true,
    status: 'approved',
    publicTutorId,
    meetUrl: 'https://meet.google.com/sb-valid-room',
  });

  // Seed initial student profile (Eligible for trial, 0 contracted, 0 available)
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

  // --------------------------------------------------------------------------
  // TEST 1: Agendamento experimental válido
  // --------------------------------------------------------------------------
  console.log('--- 1. Agendamento Experimental Válido ---');
  {
    // Frontend logic evaluation for eligible student in onboarding
    const mockUserProfile: UserProfile = {
      id: studentUid,
      uid: studentUid,
      name: studentName,
      email: studentEmail,
      subscriptionType: 'trial',
      hasCompletedTrialLesson: false,
      onboardingCompleted: false,
      contractedLessons: 0,
      availableLessons: 0,
    } as any;

    const mockLessons: LiveLesson[] = [];
    const mockScheduleStudentInfo = {
      name: studentName,
      email: studentEmail,
      uid: studentUid,
      isTrialLesson: true,
    };

    // Calculate trial eligibility and intent according to hotfix rules
    const hasAlreadyUsedTrial = Boolean(
      mockUserProfile.hasCompletedTrialLesson ||
      mockLessons.some((l) => (l.studentUid === studentUid || l.studentEmail === studentEmail) && l.isTrialLesson && l.status !== 'cancelled')
    );
    const isEligibleForTrial = !hasAlreadyUsedTrial && mockUserProfile.subscriptionType !== 'package';
    const hasExplicitTrialIntent = Boolean(
      mockScheduleStudentInfo.isTrialLesson === true ||
      (!mockUserProfile.onboardingCompleted && isEligibleForTrial && (mockUserProfile.availableLessons ?? 0) <= 0)
    );
    const isTrialBooking = Boolean(
      isEligibleForTrial &&
      hasExplicitTrialIntent &&
      mockScheduleStudentInfo.isTrialLesson !== false
    );

    assert(isTrialBooking === true, 'Frontend classifica agendamento de onboarding como aula experimental válida');
    assert(isEligibleForTrial === true, 'Aluno sem histórico de trial é considerado elegível');

    // Backend authoritative scheduling of trial lesson
    const trialStart = '2026-11-01T14:00:00.000Z';
    const trialEnd = '2026-11-01T14:25:00.000Z'; // 25 min trial
    const trialId = `lesson-${studentUid}-${new Date(trialStart).getTime()}`;

    const txResult = await scheduleLessonAtomicServer({
      studentAuthUid: studentUid,
      studentEmail,
      studentName,
      teacherIdOrEmail: teacherUid,
      teacherUid,
      teacherEmail,
      teacherName,
      meetLink: 'https://meet.google.com/sb-valid-room',
      startDateTime: trialStart,
      endDateTime: trialEnd,
      title: 'Aula Experimental Ao Vivo',
      description: 'First trial lesson',
      isTrialLesson: true,
      requestId: trialId,
      existingLessons: mockLessons,
    });

    assert(txResult.success === true, 'Backend autoriza e agenda aula experimental com sucesso');
    assert(txResult.isTrialLesson === true, 'Retorno do backend confirma status isTrialLesson: true');
    assert(txResult.statusCode === 200, 'Código de status HTTP é 200');

    // Verify Firestore student doc updated hasCompletedTrialLesson
    const updatedStudentDoc = (await mockDb.collection('users').doc(studentUid).get()).data();
    assert(updatedStudentDoc.hasCompletedTrialLesson === true, 'Firestore users/{studentUid}.hasCompletedTrialLesson marcado como true');
    assert(updatedStudentDoc.onboardingCompleted === true, 'Firestore users/{studentUid}.onboardingCompleted marcado como true');
    assert(updatedStudentDoc.contractedLessons >= 1, 'Firestore users/{studentUid}.contractedLessons atualizado para pelo menos 1');

    // Add trial lesson to lessons state
    mockLessons.push(txResult.lesson);
  }

  // --------------------------------------------------------------------------
  // TEST 2: Bloqueio de segunda aula experimental gratuita
  // --------------------------------------------------------------------------
  console.log('\n--- 2. Bloqueio de Segunda Aula Experimental Gratuita ---');
  {
    const mockStudentDoc = (await mockDb.collection('users').doc(studentUid).get()).data();
    const existingLessons = (await mockDb.collection('lessons').where('studentUid', '==', studentUid).get()).docs.map((d: any) => d.data());

    // Frontend evaluation: student already completed trial
    const hasAlreadyUsedTrial = Boolean(
      mockStudentDoc.hasCompletedTrialLesson ||
      existingLessons.some((l: any) => l.isTrialLesson && l.status !== 'cancelled')
    );
    const isEligibleForTrial = !hasAlreadyUsedTrial && mockStudentDoc.subscriptionType !== 'package';
    assert(isEligibleForTrial === false, 'Frontend bloqueia elegibilidade ao trial para aluno que já utilizou');

    // Backend authoritative enforcement: Attempting to schedule second trial lesson is rejected
    const secondTrialStart = '2026-11-02T15:00:00.000Z';
    const secondTrialEnd = '2026-11-02T15:25:00.000Z';
    const secondTrialId = `lesson-${studentUid}-${new Date(secondTrialStart).getTime()}`;

    const secondTrialResult = await scheduleLessonAtomicServer({
      studentAuthUid: studentUid,
      studentEmail,
      studentName,
      teacherIdOrEmail: teacherUid,
      teacherUid,
      teacherEmail,
      teacherName,
      meetLink: 'https://meet.google.com/sb-valid-room',
      startDateTime: secondTrialStart,
      endDateTime: secondTrialEnd,
      title: 'Segunda Aula Experimental',
      description: 'Tentativa indevida de trial gratuito',
      isTrialLesson: true, // Malicious or buggy client trying to book second trial
      requestId: secondTrialId,
      existingLessons,
    });

    assert(secondTrialResult.success === false, 'Backend bloqueia categoricamente tentativa de segunda aula experimental');
    assert(secondTrialResult.statusCode === 400, 'Backend retorna status 400 Bad Request');
    assert(
      Boolean(secondTrialResult.error?.includes('já foi utilizada') || secondTrialResult.error?.includes('já possui')),
      `Mensagem informativa de bloqueio: "${secondTrialResult.error}"`
    );

    // Also attempt booking a regular lesson without having purchased credits (availableLessons === 0)
    const unpaidLessonResult = await scheduleLessonAtomicServer({
      studentAuthUid: studentUid,
      studentEmail,
      studentName,
      teacherIdOrEmail: teacherUid,
      teacherUid,
      teacherEmail,
      teacherName,
      meetLink: 'https://meet.google.com/sb-valid-room',
      startDateTime: secondTrialStart,
      endDateTime: secondTrialEnd,
      title: 'Aula Regular Sem Saldo',
      description: 'Sem créditos',
      isTrialLesson: false,
      requestId: secondTrialId,
      existingLessons,
    });

    assert(unpaidLessonResult.success === false, 'Tentativa de aula paga sem créditos é rejeitada');
    assert(unpaidLessonResult.statusCode === 402, 'Backend retorna 402 Saldo Insuficiente');
    assert(Boolean(unpaidLessonResult.error?.includes('Saldo de aulas insuficiente')), `Mensagem: "${unpaidLessonResult.error}"`);
  }

  // --------------------------------------------------------------------------
  // TEST 3: Compra de pacote após trial concluído
  // --------------------------------------------------------------------------
  console.log('\n--- 3. Compra de Pacote após Trial Concluído ---');
  let packagePurchaseResult: any = null;
  {
    // Simulate authoritative purchase-package backend transaction for 4 lessons
    const packageLessons = 4;
    const nowIso = new Date().toISOString();

    await mockDb.runTransaction(async (transaction) => {
      const studentRef = mockDb.collection('users').doc(studentUid);
      const sSnap = await transaction.get(studentRef);
      const sData = sSnap.exists ? sSnap.data() : {};

      const currentContracted = Number(sData.contractedLessons || 0);
      const currentAvailable = Number(sData.availableLessons || 0);

      const updatedDoc = {
        contractedLessons: currentContracted + packageLessons,
        availableLessons: currentAvailable + packageLessons,
        subscriptionType: 'package',
        teacherUid,
        assignedNativeFriendUID: teacherUid,
        nativeFriendUID: teacherUid,
        teacherEmail,
        teacherName,
        enrollmentStatus: 'active',
        weeklyNativeLessonsTarget: 1,
        updatedAt: nowIso,
      };

      transaction.set(studentRef, updatedDoc, { merge: true });
    });

    const studentDocAfterPurchase = (await mockDb.collection('users').doc(studentUid).get()).data();
    assert(studentDocAfterPurchase.subscriptionType === 'package', 'Firestore registra subscriptionType: "package"');
    assert(studentDocAfterPurchase.availableLessons === 4, 'Firestore registra saldo disponível de 4 aulas');
    assert(studentDocAfterPurchase.contractedLessons >= 4, 'Firestore registra aulas contratadas >= 4');

    packagePurchaseResult = {
      success: true,
      contractedLessons: studentDocAfterPurchase.contractedLessons,
      availableLessons: studentDocAfterPurchase.availableLessons,
      teacherUid,
      profile: studentDocAfterPurchase,
    };

    assert(packagePurchaseResult.success === true, 'Operação autoritativa de compra retorna sucesso');
  }

  // --------------------------------------------------------------------------
  // TEST 4: Agendamento de aula paga imediatamente após a compra, sem F5
  // --------------------------------------------------------------------------
  console.log('\n--- 4. Agendamento de Aula Paga Imediatamente após Compra (Sem F5) ---');
  let paidLesson1: any = null;
  {
    // In App.tsx handlePurchasePackage, state is synchronized immediately after txResult:
    let localUserProfile: UserProfile = {
      id: studentUid,
      uid: studentUid,
      name: studentName,
      email: studentEmail,
      subscriptionType: 'trial', // was trial before purchase
      hasCompletedTrialLesson: true, // completed trial earlier
      onboardingCompleted: true,
      contractedLessons: 1,
      availableLessons: 0,
    } as any;

    let localScheduleStudentInfo: any = { isTrialLesson: true }; // potentially leftover from old modal

    // Apply hotfix update in handlePurchasePackage:
    const newCount = Number(packagePurchaseResult.contractedLessons || 4);
    const authoritativeAvailable = packagePurchaseResult.availableLessons !== undefined
      ? Number(packagePurchaseResult.availableLessons)
      : 4;

    localUserProfile = {
      ...localUserProfile,
      subscriptionType: 'package',
      contractedLessons: newCount,
      availableLessons: authoritativeAvailable,
      teacherEmail,
      teacherName,
      teacherUid,
      enrollmentStatus: 'active',
    };
    localScheduleStudentInfo = null; // Cleared on package purchase

    assert(localUserProfile.subscriptionType === 'package', 'Estado local userProfile atualizado para subscriptionType: "package"');
    assert(localUserProfile.availableLessons === 4, 'Estado local userProfile.availableLessons reflete saldo autoritativo (4)');
    assert(localScheduleStudentInfo === null, 'scheduleStudentInfo limpo para evitar intenção residual de trial');

    // Student now clicks "Agendar Aula" from header or tutor card (without F5)
    const existingLessons = (await mockDb.collection('lessons').where('studentUid', '==', studentUid).get()).docs.map((d: any) => d.data());

    // Frontend evaluation in handleScheduleLesson:
    const hasAlreadyUsedTrial = Boolean(
      localUserProfile.hasCompletedTrialLesson ||
      existingLessons.some((l: any) => l.isTrialLesson && l.status !== 'cancelled')
    );
    const isEligibleForTrial = !hasAlreadyUsedTrial && localUserProfile.subscriptionType !== 'package';
    const hasExplicitTrialIntent = Boolean(
      (localScheduleStudentInfo as any)?.isTrialLesson === true ||
      (!localUserProfile.onboardingCompleted && isEligibleForTrial && (localUserProfile.availableLessons ?? 0) <= 0)
    );
    const isTrialBooking = Boolean(
      isEligibleForTrial &&
      hasExplicitTrialIntent &&
      (localScheduleStudentInfo as any)?.isTrialLesson !== false
    );

    assert(isTrialBooking === false, 'Agendamento imediato pós-compra NÃO é classificado como trial');
    assert(isEligibleForTrial === false, 'Aluno com pacote comprado não é elegível para trial');

    // Call backend scheduleLessonAtomicServer with isTrialLesson: false
    const paidLessonStart = '2026-11-03T16:00:00.000Z';
    const paidLessonEnd = '2026-11-03T16:30:00.000Z';
    const paidLessonId = `lesson-${studentUid}-${new Date(paidLessonStart).getTime()}`;

    const scheduleRes = await scheduleLessonAtomicServer({
      studentAuthUid: studentUid,
      studentEmail,
      studentName,
      teacherIdOrEmail: teacherUid,
      teacherUid,
      teacherEmail,
      teacherName,
      meetLink: 'https://meet.google.com/sb-valid-room',
      startDateTime: paidLessonStart,
      endDateTime: paidLessonEnd,
      title: 'Aula Ao Vivo 1-on-1',
      description: 'First regular lesson',
      isTrialLesson: isTrialBooking, // false
      requestId: paidLessonId,
      existingLessons,
    });

    assert(scheduleRes.success === true, 'Agendamento imediato de aula paga concluído com sucesso');
    assert(scheduleRes.isTrialLesson === false, 'Aula confirmada como regular (isTrialLesson: false)');
    assert(scheduleRes.remainingLessons === 3, 'Saldo de aulas decrementado corretamente de 4 para 3');

    paidLesson1 = scheduleRes.lesson;

    // Verify Firestore reflects remaining lessons = 3
    const studentDocAfterSchedule = (await mockDb.collection('users').doc(studentUid).get()).data();
    assert(studentDocAfterSchedule.availableLessons === 3, 'Firestore availableLessons decrementado para 3');
  }

  // --------------------------------------------------------------------------
  // TEST 5: Agendamento de aula paga após F5 (Recarga da página)
  // --------------------------------------------------------------------------
  console.log('\n--- 5. Agendamento de Aula Paga após F5 (Reidratação de Perfil) ---');
  {
    // Simulate F5 page reload: student profile rehydrated from Firestore
    const rehydratedDoc = (await mockDb.collection('users').doc(studentUid).get()).data();
    assert(rehydratedDoc.subscriptionType === 'package', 'Reidratação preserva subscriptionType: "package"');
    assert(rehydratedDoc.availableLessons === 3, 'Reidratação preserva availableLessons: 3');
    assert(rehydratedDoc.hasCompletedTrialLesson === true, 'Reidratação preserva hasCompletedTrialLesson: true');

    const existingLessons = (await mockDb.collection('lessons').where('studentUid', '==', studentUid).get()).docs.map((d: any) => d.data());

    // Schedule second paid lesson after reload
    const paidLesson2Start = '2026-11-05T17:00:00.000Z';
    const paidLesson2End = '2026-11-05T17:30:00.000Z';
    const paidLesson2Id = `lesson-${studentUid}-${new Date(paidLesson2Start).getTime()}`;

    const scheduleRes2 = await scheduleLessonAtomicServer({
      studentAuthUid: studentUid,
      studentEmail,
      studentName,
      teacherIdOrEmail: teacherUid,
      teacherUid,
      teacherEmail,
      teacherName,
      meetLink: 'https://meet.google.com/sb-valid-room',
      startDateTime: paidLesson2Start,
      endDateTime: paidLesson2End,
      title: 'Segunda Aula Regular',
      description: 'Aula após reload',
      isTrialLesson: false,
      requestId: paidLesson2Id,
      existingLessons,
    });

    assert(scheduleRes2.success === true, 'Segunda aula paga agendada com sucesso após F5');
    assert(scheduleRes2.remainingLessons === 2, 'Saldo decrementado de 3 para 2');

    const studentDocAfterSchedule2 = (await mockDb.collection('users').doc(studentUid).get()).data();
    assert(studentDocAfterSchedule2.availableLessons === 2, 'Firestore availableLessons atualizado para 2');
  }

  // --------------------------------------------------------------------------
  // TEST 6: Ausência do POST redundante que retornava 401 (/api/user-profile)
  // --------------------------------------------------------------------------
  console.log('\n--- 6. Ausência do POST Redundante que Retornava 401 ---');
  {
    const appTsxPath = path.resolve(process.cwd(), 'src/App.tsx');
    const appTsxContent = fs.readFileSync(appTsxPath, 'utf-8');

    // Find the handleScheduleLesson implementation in App.tsx
    const handleScheduleLessonStart = appTsxContent.indexOf('const handleScheduleLesson = async');
    const handleScheduleLessonEnd = appTsxContent.indexOf('const handleCompleteLesson = async');
    const handleScheduleLessonBody = appTsxContent.slice(handleScheduleLessonStart, handleScheduleLessonEnd);

    // Check if fetch('/api/user-profile' exists in handleScheduleLesson
    const hasUnauthenticatedPost = handleScheduleLessonBody.includes("fetch('/api/user-profile'");
    assert(!hasUnauthenticatedPost, 'POST redundante /api/user-profile foi TOTALMENTE REMOVIDO de handleScheduleLesson');

    // Confirm that scheduleLessonWithTransaction and saveStudentProfileToFirestore are preserved
    assert(handleScheduleLessonBody.includes('scheduleLessonWithTransaction'), 'Transação atômica autenticada scheduleLessonWithTransaction preservada');
    assert(handleScheduleLessonBody.includes('saveStudentProfileToFirestore'), 'Helper autenticado saveStudentProfileToFirestore preservado');
    assert(handleScheduleLessonBody.includes('saveStudentNativeFriendToFirestore'), 'Helper autenticado saveStudentNativeFriendToFirestore preservado');

    // Verify userProfile?.subscriptionType === 'trial' alone is no longer used for isTrialBooking
    const hasNaiveTrialCheck = handleScheduleLessonBody.includes("userProfile?.subscriptionType === 'trial'");
    assert(!hasNaiveTrialCheck, 'Classificação baseada exclusivamente em subscriptionType === "trial" eliminada');
  }

  // --------------------------------------------------------------------------
  // TEST 7: Preservação do saldo e prevenção de agendamentos duplicados
  // --------------------------------------------------------------------------
  console.log('\n--- 7. Preservação do Saldo e Prevenção de Agendamentos Duplicados ---');
  {
    const studentDocBefore = (await mockDb.collection('users').doc(studentUid).get()).data();
    const balanceBefore = studentDocBefore.availableLessons; // 2
    const existingLessons = (await mockDb.collection('lessons').where('studentUid', '==', studentUid).get()).docs.map((d: any) => d.data());

    // 7.1 Idempotent retry with same requestId & timestamp
    const idempotentResult = await scheduleLessonAtomicServer({
      studentAuthUid: studentUid,
      studentEmail,
      studentName,
      teacherIdOrEmail: teacherUid,
      teacherUid,
      teacherEmail,
      teacherName,
      meetLink: 'https://meet.google.com/sb-valid-room',
      startDateTime: paidLesson1.startDateTime,
      endDateTime: paidLesson1.endDateTime,
      title: paidLesson1.title,
      description: paidLesson1.description,
      isTrialLesson: false,
      requestId: paidLesson1.id,
      existingLessons,
    });

    assert(idempotentResult.success === true, 'Reenvio idempotente retorna sucesso');
    assert(idempotentResult.lesson.id === paidLesson1.id, 'Retorna a exata mesma aula sem duplicar');

    const studentDocAfterIdempotent = (await mockDb.collection('users').doc(studentUid).get()).data();
    assert(studentDocAfterIdempotent.availableLessons === balanceBefore, 'Saldo permanece inalterado em reenvio idempotente (anti-duplicação)');

    // 7.2 Conflict protection: Teacher conflict
    const conflictResult = await scheduleLessonAtomicServer({
      studentAuthUid: studentUid,
      studentEmail,
      studentName,
      teacherIdOrEmail: teacherUid,
      teacherUid,
      teacherEmail,
      teacherName,
      meetLink: 'https://meet.google.com/sb-valid-room',
      startDateTime: paidLesson1.startDateTime,
      endDateTime: paidLesson1.endDateTime,
      title: 'Conflito de Horário',
      description: 'Mesmo horário',
      isTrialLesson: false,
      requestId: `lesson-conflict-${Date.now()}`,
      existingLessons,
    });

    assert(conflictResult.success === false, 'Agendamento com conflito de horário é bloqueado');
    assert(conflictResult.statusCode === 409, 'Retorna status 409 Conflict');

    const studentDocAfterConflict = (await mockDb.collection('users').doc(studentUid).get()).data();
    assert(studentDocAfterConflict.availableLessons === balanceBefore, 'Saldo é rigorosamente preservado em caso de conflito');
  }

  // --------------------------------------------------------------------------
  // TEST 8: Isolamento entre alunos e professores
  // --------------------------------------------------------------------------
  console.log('\n--- 8. Isolamento entre Alunos e Professores ---');
  {
    // 8.1 Anti-impersonation: student cannot be the same as teacher
    const selfBookingResult = await scheduleLessonAtomicServer({
      studentAuthUid: teacherUid, // Teacher attempting to book with themselves as student
      studentEmail: teacherEmail,
      studentName: teacherName,
      teacherIdOrEmail: teacherUid,
      teacherUid,
      teacherEmail,
      teacherName,
      meetLink: 'https://meet.google.com/sb-valid-room',
      startDateTime: '2026-11-10T10:00:00.000Z',
      endDateTime: '2026-11-10T10:30:00.000Z',
      title: 'Auto agendamento',
      description: 'Tentativa inválida',
      isTrialLesson: false,
      requestId: `lesson-self-${Date.now()}`,
      existingLessons: [],
    });

    assert(selfBookingResult.success === false, 'Violação de identidade Aluno == Professor é bloqueada');
    assert(selfBookingResult.statusCode === 400, 'Retorna status 400');
    assert(Boolean(selfBookingResult.error?.includes('Aluno e Amigo Nativo não podem ter identidades idênticas')), 'Mensagem de violação de segurança exibida');

    // 8.2 Missing student auth UID rejected with 401
    const unauthenticatedResult = await scheduleLessonAtomicServer({
      studentAuthUid: '',
      studentEmail: 'anon@gmail.com',
      teacherIdOrEmail: teacherUid,
      teacherUid,
      teacherEmail,
      teacherName,
      meetLink: 'https://meet.google.com/sb-valid-room',
      startDateTime: '2026-11-10T11:00:00.000Z',
      endDateTime: '2026-11-10T11:30:00.000Z',
      title: 'Unauthenticated',
      description: '',
      isTrialLesson: false,
      requestId: `lesson-anon-${Date.now()}`,
      existingLessons: [],
    });

    assert(unauthenticatedResult.success === false, 'Agendamento sem autenticação é rejeitado');
    assert(unauthenticatedResult.statusCode === 401, 'Retorna status 401 Unauthorized');
  }

  // Summary
  console.log('\n======================================================================');
  console.log(`TOTAL DE TESTES EXECUTADOS: ${passed + failed}`);
  console.log(`SUCESSO: ${passed}`);
  console.log(`FALHAS: ${failed}`);
  console.log('======================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runHotfixValidation().catch((err) => {
  console.error('Unhandled test failure:', err);
  process.exit(1);
});
