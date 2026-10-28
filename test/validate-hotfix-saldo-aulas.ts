/**
 * TEST SUITE: HOTFIX CIRÚRGICO — PERSISTÊNCIA DO SALDO DE AULAS
 * Projeto: itissimple-security-staging
 *
 * 8 Testes Obrigatórios:
 * 1. Compra de 8 aulas registra 8 créditos disponíveis, partindo de saldo pago zero.
 * 2. Primeira aula regular reduz o saldo de 8 para 7.
 * 3. Segunda aula regular reduz de 7 para 6.
 * 4. Uma nova compra acrescenta créditos ao saldo existente sem sobrescrever nem duplicar.
 * 5. Uma compra repetida com a mesma chave de idempotência não concede créditos adicionais.
 * 6. Aula experimental não consome créditos pagos.
 * 7. A resposta HTTP retorna os saldos autoritativos.
 * 8. O perfil em memória e o documento canônico do Firestore permanecem consistentes.
 */

import {
  scheduleLessonAtomicServer,
  setFirebaseAdminFirestoreForTesting,
  saveUserToFirestore,
} from '../src/serverFirestore';
import { setFirebaseAdminAuthForTesting } from '../src/serverFirebaseAdmin';
import { markAsVerifiedUser } from '../src/middleware/firebaseAuth';

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

// In-Memory Mock Firestore Store for Transactional Verification
class MockFirestoreStore {
  public collections: Map<string, Map<string, any>> = new Map();

  getCollection(collPath: string) {
    if (!this.collections.has(collPath)) {
      this.collections.set(collPath, new Map());
    }
    return this.collections.get(collPath)!;
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

/**
 * Simulates POST /api/students/purchase-package handler with identical logic to serverApp.ts
 */
async function simulatePurchasePackageEndpoint(
  req: {
    body: any;
    headers?: Record<string, string>;
    user?: any;
  },
  db: any,
  firestoreDb: any
): Promise<{ status: number; body: any }> {
  const verifiedCaller = req.user;
  if (!verifiedCaller) {
    return {
      status: 401,
      body: { error: 'Unauthorized', message: 'Token de autenticação obrigatório para contratação de pacote.' },
    };
  }

  const { studentEmail, teacherEmail, teacherName, packageLessons, packageName, packagePriceBrl, packagePriceUsd, paymentMethod } = req.body;
  const requestedEmail = (studentEmail || '').toLowerCase().trim();

  if (verifiedCaller.role !== 'admin' && requestedEmail && requestedEmail !== (verifiedCaller.email || '').toLowerCase().trim()) {
    return {
      status: 403,
      body: { error: 'Forbidden', message: 'Não é permitido contratar pacote para outro usuário.' },
    };
  }

  const cleanStudentEmail = (
    verifiedCaller.role === 'admin' && requestedEmail
      ? requestedEmail
      : (verifiedCaller.email?.toLowerCase().trim() || requestedEmail)
  );
  const targetStudentUid = verifiedCaller.role === 'admin' && req.body.studentUid ? req.body.studentUid : verifiedCaller.uid;

  if (!cleanStudentEmail && !targetStudentUid) {
    return { status: 400, body: { error: 'Identificador do aluno é obrigatório.' } };
  }

  // 3. Idempotency protection
  const idempotencyKey = String(req.body.idempotencyKey || req.body.requestId || req.headers?.['idempotency-key'] || '').trim();
  if (idempotencyKey && Array.isArray(db.transactions)) {
    const existingTx = db.transactions.find((tx: any) => tx.idempotencyKey === idempotencyKey);
    if (existingTx) {
      const authContracted = Number(db.contractedLessons?.[cleanStudentEmail] || db.userProfiles?.[cleanStudentEmail]?.contractedLessons || 0);
      const authAvailable = Number(db.userProfiles?.[cleanStudentEmail]?.availableLessons ?? authContracted);
      return {
        status: 200,
        body: {
          success: true,
          message: 'Package already purchased (idempotent)',
          contractedLessons: authContracted,
          availableLessons: authAvailable,
          profile: db.userProfiles?.[cleanStudentEmail],
          transaction: existingTx,
        },
      };
    }
  }

  const cleanTeacherEmail = (teacherEmail || '').toLowerCase().trim();
  const incomingTeacherRef = req.body.teacherId || req.body.publicTutorId || req.body.tutorId || req.body.teacherUid || cleanTeacherEmail;

  if (!incomingTeacherRef && !cleanTeacherEmail) {
    return { status: 400, body: { error: 'Identificador do Amigo Nativo é obrigatório.' } };
  }

  const canonicalTeacherUid = req.body.teacherUid || 'tutor_charles_canonical_uid_1234';
  const finalTeacherEmail = cleanTeacherEmail || 'charles@itissimple.org';
  const finalTeacherName = teacherName || 'Charles Lambert';

  const lessonsToAdd = Number(packageLessons) > 0 ? Number(packageLessons) : 4;
  let newWeeklyTarget = 1;
  if (lessonsToAdd === 4) newWeeklyTarget = 1;
  else if (lessonsToAdd === 8) newWeeklyTarget = 2;
  else if (lessonsToAdd === 12) newWeeklyTarget = 3;
  else if (lessonsToAdd > 0) newWeeklyTarget = Math.min(7, Math.ceil(lessonsToAdd / 4));

  const nowIso = new Date().toISOString();

  // 5. ATOMIC TRANSACTION IN FIRESTORE VIA FIREBASE ADMIN SDK
  let atomicContractedTotal: number | null = null;
  let atomicAvailableTotal: number | null = null;

  if (firestoreDb && targetStudentUid) {
    try {
      let txContracted: number | null = null;
      let txAvailable: number | null = null;

      await firestoreDb.runTransaction(async (transaction: any) => {
        const studentRef = firestoreDb.collection('users').doc(targetStudentUid);
        const teacherRef = firestoreDb.collection('users').doc(canonicalTeacherUid);

        const [studentSnap, teacherSnap] = await Promise.all([
          transaction.get(studentRef).catch(() => null),
          transaction.get(teacherRef).catch(() => null),
        ]);

        const studentData = (studentSnap && studentSnap.exists) ? (studentSnap.data() || {}) : {};
        const currentContracted = Number(studentData.contractedLessons ?? db.contractedLessons?.[cleanStudentEmail] ?? 0);
        const currentAvailable = Number(studentData.availableLessons ?? currentContracted);

        txContracted = currentContracted + lessonsToAdd;
        txAvailable = currentAvailable + lessonsToAdd;

        const studentUpdate: Record<string, any> = {
          contractedLessons: txContracted,
          availableLessons: txAvailable,
          teacherUid: canonicalTeacherUid,
          assignedNativeFriendUID: canonicalTeacherUid,
          nativeFriendUID: canonicalTeacherUid,
          teacherEmail: finalTeacherEmail,
          teacherName: finalTeacherName,
          enrollmentStatus: 'active',
          weeklyNativeLessonsTarget: newWeeklyTarget,
          subscriptionType: 'package',
          updatedAt: nowIso,
        };

        transaction.set(studentRef, studentUpdate, { merge: true });
        if (teacherSnap && teacherSnap.exists) {
          transaction.set(teacherRef, { updatedAt: nowIso }, { merge: true });
        }
      });

      // Assign atomic totals only upon successful transaction commit
      atomicContractedTotal = txContracted;
      atomicAvailableTotal = txAvailable;
    } catch (fsErr) {
      console.warn('[purchase-package] Firestore Admin transaction notice:', fsErr);
    }
  }

  // 6. Update local synchronized state
  if (!db.contractedLessons) db.contractedLessons = {};
  const currentContracted = Number(db.contractedLessons[cleanStudentEmail] || 0);
  const newTotal = atomicContractedTotal !== null ? atomicContractedTotal : (currentContracted + lessonsToAdd);
  db.contractedLessons[cleanStudentEmail] = newTotal;

  if (!db.userProfiles) db.userProfiles = {};
  const existingProfile = db.userProfiles[cleanStudentEmail] || {};
  const currentAvailableInProfile = Number(existingProfile.availableLessons ?? currentContracted);
  const authoritativeAvailable = atomicAvailableTotal !== null ? atomicAvailableTotal : (currentAvailableInProfile + lessonsToAdd);

  // Update student in db.students
  let studentFound = false;
  db.students = (db.students || []).map((s: any) => {
    if ((s.email || s.studentEmail || '').toLowerCase() === cleanStudentEmail || (targetStudentUid && (s.uid === targetStudentUid || s.id === targetStudentUid))) {
      studentFound = true;
      return {
        ...s,
        teacherEmail: finalTeacherEmail,
        teacherName: finalTeacherName,
        teacherUid: canonicalTeacherUid,
        assignedNativeFriendUID: canonicalTeacherUid,
        nativeFriendUID: canonicalTeacherUid,
        contractedLessons: newTotal,
        availableLessons: authoritativeAvailable,
        status: 'active',
      };
    }
    return s;
  });

  if (!studentFound) {
    db.students.push({
      id: targetStudentUid || `st-${Date.now()}`,
      uid: targetStudentUid || `st-${Date.now()}`,
      name: cleanStudentEmail.split('@')[0],
      studentName: cleanStudentEmail.split('@')[0],
      email: cleanStudentEmail,
      studentEmail: cleanStudentEmail,
      level: 'iniciante',
      studentLevel: 'iniciante',
      goal: 'English for everyday life & work',
      learningGoal: 'English for everyday life & work',
      contractedLessons: newTotal,
      availableLessons: authoritativeAvailable,
      completedLessonsCount: 0,
      teacherEmail: finalTeacherEmail,
      teacherName: finalTeacherName,
      teacherUid: canonicalTeacherUid,
      assignedNativeFriendUID: canonicalTeacherUid,
      nativeFriendUID: canonicalTeacherUid,
      routineVideoTime: '09:00',
      routineAudioTime: '14:00',
      dailyPhraseTime: '20:00',
      status: 'active',
      activeSince: new Date().toISOString().split('T')[0],
      createdAt: nowIso,
    });
  }

  // Update db.userProfiles
  db.userProfiles[cleanStudentEmail] = {
    ...existingProfile,
    id: targetStudentUid || existingProfile.id || `usr-${Date.now()}`,
    uid: targetStudentUid || existingProfile.uid || `usr-${Date.now()}`,
    email: cleanStudentEmail,
    name: existingProfile.name || cleanStudentEmail.split('@')[0],
    level: existingProfile.level || 'iniciante',
    teacherEmail: finalTeacherEmail,
    teacherName: finalTeacherName,
    teacherUid: canonicalTeacherUid,
    assignedNativeFriendUID: canonicalTeacherUid,
    nativeFriendUID: canonicalTeacherUid,
    enrollmentStatus: 'active',
    contractedLessons: newTotal,
    availableLessons: authoritativeAvailable,
    weeklyNativeLessonsTarget: newWeeklyTarget,
    subscriptionType: 'package',
    completedLessonsCount: existingProfile.completedLessonsCount || 0,
    updatedAt: nowIso,
  };

  // Record transaction
  if (!db.transactions) db.transactions = [];
  const transaction = {
    id: `tx-${Date.now()}`,
    idempotencyKey: idempotencyKey || undefined,
    studentUid: targetStudentUid,
    studentEmail: cleanStudentEmail,
    teacherUid: canonicalTeacherUid,
    teacherEmail: finalTeacherEmail,
    teacherName: finalTeacherName,
    packageLessons: lessonsToAdd,
    packageName: packageName || `${lessonsToAdd} Aulas`,
    packagePriceBrl: packagePriceBrl || lessonsToAdd * 90,
    packagePriceUsd: packagePriceUsd || lessonsToAdd * 16,
    paymentMethod: paymentMethod || 'credit_card',
    timestamp: nowIso,
    status: 'completed',
  };
  db.transactions.unshift(transaction);

  // Synchronize via saveUserToFirestore
  await saveUserToFirestore(db.userProfiles[cleanStudentEmail]).catch(() => {});

  return {
    status: 200,
    body: {
      success: true,
      message: 'Package purchased successfully and Native Friend assigned',
      contractedLessons: newTotal,
      availableLessons: authoritativeAvailable,
      teacherUid: canonicalTeacherUid,
      profile: db.userProfiles[cleanStudentEmail],
      transaction,
    },
  };
}

async function runTestSuite() {
  console.log('========================================================================');
  console.log('🎯 VALIDAÇÃO CIRÚRGICA: PERSISTÊNCIA DO SALDO DE AULAS (8 TESTES)');
  console.log('========================================================================\n');

  const mockDb = new MockFirestoreStore();
  setFirebaseAdminFirestoreForTesting(mockDb as any);
  setFirebaseAdminAuthForTesting({
    verifyIdToken: async () => ({ uid: 'std_regina_canonical_uid', email: 'regina@test.com' }),
  } as any);

  const studentUid = 'std_regina_canonical_uid';
  const studentEmail = 'regina@test.com';
  const studentName = 'Regina Student';

  const teacherUid = 'tutor_charles_canonical_uid_1234';
  const teacherEmail = 'charles@itissimple.org';
  const teacherName = 'Charles Lambert';
  const publicTutorId = 'charles-lambert';

  // Seed teacher in Mock Firestore
  await mockDb.collection('users').doc(teacherUid).set({
    uid: teacherUid,
    id: teacherUid,
    email: teacherEmail,
    name: teacherName,
    role: 'teacher',
    isApproved: true,
    status: 'active',
    publicTutorId,
    meetUrl: 'https://meet.google.com/test-charles-room',
  });
  await mockDb.collection('tutors').doc(teacherUid).set({
    uid: teacherUid,
    id: teacherUid,
    email: teacherEmail,
    name: teacherName,
    isApproved: true,
    status: 'approved',
    publicTutorId,
    meetUrl: 'https://meet.google.com/test-charles-room',
  });

  // Seed initial student with 0 credits and 0 contracted lessons
  await mockDb.collection('users').doc(studentUid).set({
    uid: studentUid,
    id: studentUid,
    email: studentEmail,
    name: studentName,
    role: 'student',
    contractedLessons: 0,
    availableLessons: 0,
    hasCompletedTrialLesson: false,
    enrollmentStatus: 'not_enrolled',
  });

  // Local app DB state
  const dbState: any = {
    contractedLessons: {},
    userProfiles: {
      [studentEmail]: {
        uid: studentUid,
        id: studentUid,
        email: studentEmail,
        name: studentName,
        role: 'student',
        contractedLessons: 0,
        availableLessons: 0,
        hasCompletedTrialLesson: false,
        enrollmentStatus: 'not_enrolled',
      },
    },
    students: [
      {
        uid: studentUid,
        id: studentUid,
        email: studentEmail,
        name: studentName,
        contractedLessons: 0,
        availableLessons: 0,
        status: 'not_enrolled',
      },
    ],
    transactions: [],
    liveLessons: [],
    tutorsList: [
      {
        id: teacherUid,
        uid: teacherUid,
        email: teacherEmail,
        name: teacherName,
        isApproved: true,
        publicTutorId,
      },
    ],
  };

  const verifiedUser = markAsVerifiedUser({
    uid: studentUid,
    email: studentEmail,
    email_verified: true,
    role: 'student',
  });

  // --------------------------------------------------------------------------
  // TESTE 1: Compra de 8 aulas registra 8 créditos disponíveis, partindo de saldo zero
  // --------------------------------------------------------------------------
  console.log('--- Teste 1: Compra de 8 aulas registra 8 créditos disponíveis, partindo de saldo zero ---');
  const res1 = await simulatePurchasePackageEndpoint(
    {
      body: {
        studentUid,
        studentEmail,
        teacherId: publicTutorId,
        teacherUid,
        teacherEmail,
        packageLessons: 8,
        idempotencyKey: 'tx-key-purchase-1-8lessons',
      },
      user: verifiedUser,
    },
    dbState,
    mockDb
  );

  assert(res1.status === 200, 'HTTP status é 200 OK');
  assert(res1.body.availableLessons === 8, 'Resposta HTTP contém availableLessons: 8 autoritativo');
  assert(res1.body.contractedLessons === 8, 'Resposta HTTP contém contractedLessons: 8');
  assert(res1.body.profile.availableLessons === 8, 'Perfil no retorno contém availableLessons: 8');
  assert(dbState.userProfiles[studentEmail].availableLessons === 8, 'dbState.userProfiles possui availableLessons: 8');
  assert(dbState.students[0].availableLessons === 8, 'dbState.students possui availableLessons: 8');

  const fsDocAfterT1 = (await mockDb.collection('users').doc(studentUid).get()).data();
  assert(fsDocAfterT1.availableLessons === 8, 'Firestore /users doc possui availableLessons: 8');
  assert(fsDocAfterT1.contractedLessons === 8, 'Firestore /users doc possui contractedLessons: 8');

  // --------------------------------------------------------------------------
  // TESTE 2: Primeira aula regular reduz o saldo de 8 para 7
  // --------------------------------------------------------------------------
  console.log('\n--- Teste 2: Primeira aula regular reduz o saldo de 8 para 7 ---');
  const lesson1Start = new Date(Date.now() + 86400000).toISOString();
  const lesson1End = new Date(Date.now() + 86400000 + 3600000).toISOString();

  const scheduleRes1 = await scheduleLessonAtomicServer({
    studentAuthUid: studentUid,
    studentEmail,
    studentName,
    teacherIdOrEmail: publicTutorId,
    teacherUid,
    teacherEmail,
    teacherName,
    meetLink: 'https://meet.google.com/test-charles-room',
    startDateTime: lesson1Start,
    endDateTime: lesson1End,
    isTrialLesson: false,
    requestId: 'lesson-regina-regular-1',
    existingLessons: dbState.liveLessons,
    dbState,
  });

  assert(scheduleRes1.success === true, 'Primeiro agendamento regular aprovado com sucesso');
  assert(scheduleRes1.remainingLessons === 7, 'scheduleLessonAtomicServer retorna remainingLessons: 7');

  const fsDocAfterT2 = (await mockDb.collection('users').doc(studentUid).get()).data();
  assert(fsDocAfterT2.availableLessons === 7, 'Firestore /users doc reduz saldo para availableLessons: 7');
  assert(dbState.userProfiles[studentEmail].availableLessons === 7, 'dbState.userProfiles atualizado para availableLessons: 7');

  // --------------------------------------------------------------------------
  // TESTE 3: Segunda aula regular reduz o saldo de 7 para 6
  // --------------------------------------------------------------------------
  console.log('\n--- Teste 3: Segunda aula regular reduz o saldo de 7 para 6 ---');
  const lesson2Start = new Date(Date.now() + 172800000).toISOString();
  const lesson2End = new Date(Date.now() + 172800000 + 3600000).toISOString();

  const scheduleRes2 = await scheduleLessonAtomicServer({
    studentAuthUid: studentUid,
    studentEmail,
    studentName,
    teacherIdOrEmail: publicTutorId,
    teacherUid,
    teacherEmail,
    teacherName,
    meetLink: 'https://meet.google.com/test-charles-room',
    startDateTime: lesson2Start,
    endDateTime: lesson2End,
    isTrialLesson: false,
    requestId: 'lesson-regina-regular-2',
    existingLessons: dbState.liveLessons,
    dbState,
  });

  assert(scheduleRes2.success === true, 'Segundo agendamento regular aprovado com sucesso');
  assert(scheduleRes2.remainingLessons === 6, 'scheduleLessonAtomicServer retorna remainingLessons: 6');

  const fsDocAfterT3 = (await mockDb.collection('users').doc(studentUid).get()).data();
  assert(fsDocAfterT3.availableLessons === 6, 'Firestore /users doc reduz saldo para availableLessons: 6');
  assert(dbState.userProfiles[studentEmail].availableLessons === 6, 'dbState.userProfiles atualizado para availableLessons: 6');

  // --------------------------------------------------------------------------
  // TESTE 4: Uma nova compra acrescenta créditos ao saldo existente sem sobrescrever nem duplicar
  // --------------------------------------------------------------------------
  console.log('\n--- Teste 4: Nova compra de 4 aulas soma aos 6 créditos restantes (saldo = 10, contratadas = 12) ---');
  const res2 = await simulatePurchasePackageEndpoint(
    {
      body: {
        studentUid,
        studentEmail,
        teacherId: publicTutorId,
        teacherUid,
        teacherEmail,
        packageLessons: 4,
        idempotencyKey: 'tx-key-purchase-2-4lessons',
      },
      user: verifiedUser,
    },
    dbState,
    mockDb
  );

  assert(res2.status === 200, 'HTTP status é 200 OK');
  assert(res2.body.availableLessons === 10, 'Saldo disponível aumentou de 6 para exatamente 10 (6 + 4)');
  assert(res2.body.contractedLessons === 12, 'Total contratado aumentou de 8 para exatamente 12 (8 + 4)');
  assert(res2.body.profile.availableLessons === 10, 'Perfil retornado possui availableLessons: 10');

  const fsDocAfterT4 = (await mockDb.collection('users').doc(studentUid).get()).data();
  assert(fsDocAfterT4.availableLessons === 10, 'Firestore /users doc registra availableLessons: 10 (sem sobrescrita por valores antigos)');
  assert(fsDocAfterT4.contractedLessons === 12, 'Firestore /users doc registra contractedLessons: 12');
  assert(dbState.userProfiles[studentEmail].availableLessons === 10, 'dbState.userProfiles possui availableLessons: 10');
  assert(dbState.students[0].availableLessons === 10, 'dbState.students possui availableLessons: 10');

  // --------------------------------------------------------------------------
  // TESTE 5: Uma compra repetida com a mesma chave de idempotência não concede créditos adicionais
  // --------------------------------------------------------------------------
  console.log('\n--- Teste 5: Compra repetida com mesma chave de idempotência não duplica créditos ---');
  const res2Duplicate = await simulatePurchasePackageEndpoint(
    {
      body: {
        studentUid,
        studentEmail,
        teacherId: publicTutorId,
        teacherUid,
        teacherEmail,
        packageLessons: 4,
        idempotencyKey: 'tx-key-purchase-2-4lessons', // MESMA CHAVE
      },
      user: verifiedUser,
    },
    dbState,
    mockDb
  );

  assert(res2Duplicate.status === 200, 'HTTP status idempotente é 200 OK');
  assert(res2Duplicate.body.message.includes('idempotent'), 'Mensagem confirma execução idempotente');
  assert(res2Duplicate.body.availableLessons === 10, 'Saldo permanece 10 (nenhum crédito extra concedido)');
  assert(res2Duplicate.body.contractedLessons === 12, 'Aulas contratadas permanecem 12');

  const fsDocAfterT5 = (await mockDb.collection('users').doc(studentUid).get()).data();
  assert(fsDocAfterT5.availableLessons === 10, 'Firestore doc inalterado: availableLessons continua 10');
  assert(fsDocAfterT5.contractedLessons === 12, 'Firestore doc inalterado: contractedLessons continua 12');

  // --------------------------------------------------------------------------
  // TESTE 6: Aula experimental não consome créditos pagos
  // --------------------------------------------------------------------------
  console.log('\n--- Teste 6: Aula experimental não consome créditos pagos ---');
  // Criamos uma aluna elegível com créditos para testar que trial não debita availableLessons
  const trialStudentUid = 'std_trial_student_with_credits';
  const trialStudentEmail = 'trial_with_credits@test.com';
  await mockDb.collection('users').doc(trialStudentUid).set({
    uid: trialStudentUid,
    id: trialStudentUid,
    email: trialStudentEmail,
    name: 'Trial Student',
    role: 'student',
    contractedLessons: 10,
    availableLessons: 10,
    hasCompletedTrialLesson: false,
    enrollmentStatus: 'active',
  });
  dbState.userProfiles[trialStudentEmail] = {
    uid: trialStudentUid,
    id: trialStudentUid,
    email: trialStudentEmail,
    name: 'Trial Student',
    contractedLessons: 10,
    availableLessons: 10,
    hasCompletedTrialLesson: false,
    enrollmentStatus: 'active',
  };

  const trialStart = new Date(Date.now() + 259200000).toISOString();
  const trialEnd = new Date(Date.now() + 259200000 + 3600000).toISOString();

  const trialScheduleRes = await scheduleLessonAtomicServer({
    studentAuthUid: trialStudentUid,
    studentEmail: trialStudentEmail,
    studentName: 'Trial Student',
    teacherIdOrEmail: publicTutorId,
    teacherUid,
    teacherEmail,
    teacherName,
    meetLink: 'https://meet.google.com/test-charles-room',
    startDateTime: trialStart,
    endDateTime: trialEnd,
    isTrialLesson: true,
    requestId: 'lesson-trial-test-credits',
    existingLessons: dbState.liveLessons,
    dbState,
  });

  assert(trialScheduleRes.success === true, 'Aula experimental agendada com sucesso');
  assert(trialScheduleRes.isTrialLesson === true, 'Aula classificada como trial');
  assert(trialScheduleRes.remainingLessons === 10, 'Saldo disponível permaneceu 10 (NÃO consumiu crédito pago)');

  const fsDocTrial = (await mockDb.collection('users').doc(trialStudentUid).get()).data();
  assert(fsDocTrial.availableLessons === 10, 'Firestore /users doc mantém availableLessons: 10');
  assert(dbState.userProfiles[trialStudentEmail].availableLessons === 10, 'Perfil em memória mantém availableLessons: 10');

  // --------------------------------------------------------------------------
  // TESTE 7: A resposta HTTP retorna os saldos autoritativos
  // --------------------------------------------------------------------------
  console.log('\n--- Teste 7: A resposta HTTP retorna os saldos autoritativos ---');
  assert(typeof res1.body.availableLessons === 'number', 'availableLessons é numérico no top-level da resposta');
  assert(typeof res1.body.contractedLessons === 'number', 'contractedLessons é numérico no top-level da resposta');
  assert(res1.body.profile.availableLessons === res1.body.availableLessons, 'profile.availableLessons é idêntico a availableLessons no top-level');
  assert(res1.body.profile.contractedLessons === res1.body.contractedLessons, 'profile.contractedLessons é idêntico a contractedLessons no top-level');

  assert(typeof res2.body.availableLessons === 'number', 'Compra 2: availableLessons é numérico no top-level');
  assert(typeof res2.body.contractedLessons === 'number', 'Compra 2: contractedLessons é numérico no top-level');
  assert(res2.body.profile.availableLessons === res2.body.availableLessons, 'Compra 2: profile.availableLessons idêntico ao top-level');
  assert(res2.body.profile.contractedLessons === res2.body.contractedLessons, 'Compra 2: profile.contractedLessons idêntico ao top-level');

  // --------------------------------------------------------------------------
  // TESTE 8: O perfil em memória e o documento canônico do Firestore permanecem consistentes
  // --------------------------------------------------------------------------
  console.log('\n--- Teste 8: Consistência entre perfil em memória e documento canônico Firestore ---');
  const finalFsDoc = (await mockDb.collection('users').doc(studentUid).get()).data();
  const finalLocalProfile = dbState.userProfiles[studentEmail];
  const finalLocalStudent = dbState.students.find((s: any) => s.email === studentEmail);

  assert(
    finalLocalProfile.availableLessons === finalFsDoc.availableLessons,
    `db.userProfiles (${finalLocalProfile.availableLessons}) strictly equals Firestore (${finalFsDoc.availableLessons})`
  );
  assert(
    finalLocalProfile.contractedLessons === finalFsDoc.contractedLessons,
    `db.userProfiles (${finalLocalProfile.contractedLessons}) strictly equals Firestore (${finalFsDoc.contractedLessons})`
  );
  assert(
    finalLocalStudent.availableLessons === finalFsDoc.availableLessons,
    `db.students (${finalLocalStudent.availableLessons}) strictly equals Firestore (${finalFsDoc.availableLessons})`
  );
  assert(
    finalLocalStudent.contractedLessons === finalFsDoc.contractedLessons,
    `db.students (${finalLocalStudent.contractedLessons}) strictly equals Firestore (${finalFsDoc.contractedLessons})`
  );

  // Test that a subsequent saveUserToFirestore does NOT overwrite availableLessons
  await saveUserToFirestore(finalLocalProfile);
  const docAfterSubsequentSave = (await mockDb.collection('users').doc(studentUid).get()).data();
  assert(
    docAfterSubsequentSave.availableLessons === 10,
    'saveUserToFirestore preserva os créditos confirmados sem reversão para valores antigos'
  );

  // --------------------------------------------------------------------------
  // TESTE 9: Preservação de um saldo autoritativo igual a zero, quando aplicável
  // --------------------------------------------------------------------------
  console.log('\n--- Teste 9: Preservação de saldo autoritativo igual a zero (zero não é tratado como ausência) ---');
  const zeroStudentUid = 'std_zero_balance_student';
  const zeroStudentEmail = 'zero_student@test.com';

  // Seed student with -4 available lessons (e.g. debt or overdraft) who buys 4 lessons -> net 0
  await mockDb.collection('users').doc(zeroStudentUid).set({
    uid: zeroStudentUid,
    id: zeroStudentUid,
    email: zeroStudentEmail,
    name: 'Zero Balance Student',
    role: 'student',
    contractedLessons: 4,
    availableLessons: -4,
    enrollmentStatus: 'active',
  });
  dbState.userProfiles[zeroStudentEmail] = {
    uid: zeroStudentUid,
    id: zeroStudentUid,
    email: zeroStudentEmail,
    name: 'Zero Balance Student',
    contractedLessons: 4,
    availableLessons: 99, // Stale in-memory value should NOT be used!
    enrollmentStatus: 'active',
  };

  const zeroVerifiedUser = markAsVerifiedUser({
    uid: zeroStudentUid,
    email: zeroStudentEmail,
    email_verified: true,
    role: 'student',
  });

  const resZero = await simulatePurchasePackageEndpoint(
    {
      body: {
        studentUid: zeroStudentUid,
        studentEmail: zeroStudentEmail,
        teacherId: publicTutorId,
        teacherUid,
        teacherEmail,
        packageLessons: 4,
        idempotencyKey: 'tx-key-zero-test',
      },
      user: zeroVerifiedUser,
    },
    dbState,
    mockDb
  );

  assert(resZero.status === 200, 'Compra concluída com status 200 OK');
  assert(resZero.body.availableLessons === 0, 'Saldo autoritativo 0 é estritamente preservado no top-level (não recalculado via fallback)');
  assert(resZero.body.profile.availableLessons === 0, 'Perfil retornado mantém availableLessons: 0');
  assert(dbState.userProfiles[zeroStudentEmail].availableLessons === 0, 'dbState.userProfiles atualizado para exactly 0');
  const fsDocZero = (await mockDb.collection('users').doc(zeroStudentUid).get()).data();
  assert(fsDocZero.availableLessons === 0, 'Firestore doc confirma availableLessons: 0');

  // --------------------------------------------------------------------------
  // TESTE 10: Ausência de sobrescrita por dados antigos do perfil em memória
  // --------------------------------------------------------------------------
  console.log('\n--- Teste 10: Ausência de sobrescrita por dados antigos do perfil em memória ---');
  const staleStudentUid = 'std_stale_profile_student';
  const staleStudentEmail = 'stale_student@test.com';

  // Firestore has authoritative available = 3, but in-memory profile has stale 15
  await mockDb.collection('users').doc(staleStudentUid).set({
    uid: staleStudentUid,
    id: staleStudentUid,
    email: staleStudentEmail,
    name: 'Stale Profile Student',
    role: 'student',
    contractedLessons: 8,
    availableLessons: 3,
    enrollmentStatus: 'active',
  });
  dbState.userProfiles[staleStudentEmail] = {
    uid: staleStudentUid,
    id: staleStudentUid,
    email: staleStudentEmail,
    name: 'Stale Profile Student',
    contractedLessons: 8,
    availableLessons: 15, // STALE outdated in-memory profile
    enrollmentStatus: 'active',
  };

  const staleVerifiedUser = markAsVerifiedUser({
    uid: staleStudentUid,
    email: staleStudentEmail,
    email_verified: true,
    role: 'student',
  });

  const resStale = await simulatePurchasePackageEndpoint(
    {
      body: {
        studentUid: staleStudentUid,
        studentEmail: staleStudentEmail,
        teacherId: publicTutorId,
        teacherUid,
        teacherEmail,
        packageLessons: 4,
        idempotencyKey: 'tx-key-stale-test',
      },
      user: staleVerifiedUser,
    },
    dbState,
    mockDb
  );

  // Authoritative should be Firestore (3) + 4 = 7, NOT stale profile (15) + 4 = 19
  assert(resStale.body.availableLessons === 7, 'authoritativeAvailable é 7 (baseado no Firestore atômico 3 + 4, e NÃO 15 + 4 = 19 do perfil antigo)');
  assert(resStale.body.profile.availableLessons === 7, 'profile.availableLessons é 7, ignorando dados antigos');
  assert(dbState.userProfiles[staleStudentEmail].availableLessons === 7, 'dbState.userProfiles sobreposto com o valor autoritativo 7');
  const fsDocStale = (await mockDb.collection('users').doc(staleStudentUid).get()).data();
  assert(fsDocStale.availableLessons === 7, 'Firestore doc confirma 7');

  console.log('\n========================================================================');
  console.log(`RESULTADO FINAL: ${passed} PASSOU | ${failed} FALHOU`);
  console.log('========================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTestSuite().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
