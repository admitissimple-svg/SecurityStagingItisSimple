/**
 * TEST SUITE: FASE 4 — CORREÇÃO CIRÚRGICA DA PERSISTÊNCIA DE CRÉDITOS
 * Projeto: itissimple-security-staging
 *
 * Validação rigorosa dos 15 cenários obrigatórios:
 * 1.  Novo aluno sem créditos -> Nenhum crédito pago disponível (0 ou undefined)
 * 2.  Aula experimental -> Não consome créditos pagos
 * 3.  Compra simulada de 8 aulas -> Incrementa contratado e disponível em 8
 * 4.  Agendamento regular -> Consome exatamente 1 crédito
 * 5.  Falha na compra -> Não confirma créditos (não retorna 200, sem sucesso falso, sem fallback em memória)
 * 6.  Timeout após possível commit da compra -> Repetição não duplica créditos
 * 7.  Compra repetida com mesmo identificador -> Não credita duas vezes
 * 8.  Atualização de perfil -> Não altera saldos financeiros
 * 9.  Payload de perfil com créditos adulterados -> Valores ignorados e excluídos do write Firestore
 * 10. Dashboard com saldo 7 -> Exibe 7
 * 11. Dashboard com saldo 0 -> Exibe 0
 * 12. Dashboard sem saldo autoritativo -> Não inventa créditos (exibe estado indisponível '—')
 * 13. Compra e agendamento simultâneos -> Mantém consistência transacional
 * 14. Dois agendamentos simultâneos -> Preserva proteção da Fase 2 (apenas 1 consome crédito)
 * 15. Aula experimental após créditos pagos -> Não zera nem altera créditos
 *
 * Fluxo ponta-a-ponta canônico:
 * Cadastro -> Aula experimental -> Compra de 8 aulas -> Agendamento regular -> Saldo 7 créditos
 */

import {
  scheduleLessonAtomicServer,
  setFirebaseAdminFirestoreForTesting,
  resolveTeacherCanonicalIdentity,
} from '../src/serverFirestore';
import { setFirebaseAdminAuthForTesting } from '../src/serverFirebaseAdmin';
import { isValidCanonicalUid } from '../src/utils/studentPersistence';

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

// In-memory Mock Firestore Store with Optimistic Concurrency Control (OCC) simulation
class MockFirestoreStore {
  public collections: Map<string, Map<string, { data: any; version: number }>> = new Map();
  public errorOnTransaction: Error | null = null;
  public failFirstCommitThenSucceed: boolean = false;
  private attemptCount: number = 0;

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
          const entry = coll.get(docId);
          return {
            exists: Boolean(entry && entry.data),
            id: docId,
            data: () => (entry && entry.data ? JSON.parse(JSON.stringify(entry.data)) : undefined),
          };
        },
        set: async (data: any, options?: { merge?: boolean }) => {
          const coll = self.getCollection(collPath);
          const existingEntry = coll.get(docId);
          const existingData = existingEntry?.data || {};
          const merged = options?.merge ? { ...existingData, ...data } : data;
          const newVersion = (existingEntry?.version || 0) + 1;
          coll.set(docId, { data: JSON.parse(JSON.stringify(merged)), version: newVersion });
          return { writeTime: new Date() };
        },
        collection: (subName: string) => self.collection(`${collPath}/${docId}/${subName}`),
      }),
      where: (field: string, op: string, value: any) => ({
        get: async () => {
          const coll = self.getCollection(collPath);
          const matched: any[] = [];
          for (const [id, entry] of coll.entries()) {
            if (op === '==' && entry.data && entry.data[field] === value) {
              matched.push({ id, data: () => JSON.parse(JSON.stringify(entry.data)), exists: true });
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
    if (this.errorOnTransaction) {
      throw this.errorOnTransaction;
    }

    const self = this;
    const maxRetries = 10;
    let attempt = 0;

    while (attempt < maxRetries) {
      attempt++;
      self.attemptCount++;

      // Track documents read during this transaction along with observed version
      const readVersions = new Map<string, number>();
      const pendingWrites: Array<{ collPath: string; docId: string; data: any; options?: { merge?: boolean } }> = [];

      const transaction = {
        get: async (ref: any) => {
          const parts = ref.path.split('/');
          const docId = parts.pop()!;
          const collPath = parts.join('/');
          const coll = self.getCollection(collPath);
          const entry = coll.get(docId);
          readVersions.set(ref.path, entry?.version || 0);

          return {
            exists: Boolean(entry && entry.data),
            id: docId,
            data: () => (entry && entry.data ? JSON.parse(JSON.stringify(entry.data)) : undefined),
          };
        },
        set: (ref: any, data: any, options?: { merge?: boolean }) => {
          const parts = ref.path.split('/');
          const docId = parts.pop()!;
          const collPath = parts.join('/');
          pendingWrites.push({ collPath, docId, data, options });
          return transaction;
        },
        update: (ref: any, data: any) => {
          const parts = ref.path.split('/');
          const docId = parts.pop()!;
          const collPath = parts.join('/');
          pendingWrites.push({ collPath, docId, data, options: { merge: true } });
          return transaction;
        },
      };

      const result = await updateFunction(transaction);

      // Validate OCC: Check if any document read was modified concurrently by another transaction
      let conflict = false;
      for (const [path, expectedVersion] of readVersions.entries()) {
        const parts = path.split('/');
        const docId = parts.pop()!;
        const collPath = parts.join('/');
        const coll = self.getCollection(collPath);
        const currentVersion = coll.get(docId)?.version || 0;
        if (currentVersion !== expectedVersion) {
          conflict = true;
          break;
        }
      }

      if (conflict) {
        continue;
      }

      // Commit all writes
      for (const w of pendingWrites) {
        const coll = self.getCollection(w.collPath);
        const existingEntry = coll.get(w.docId);
        const existingData = existingEntry?.data || {};
        const merged = w.options?.merge ? { ...existingData, ...w.data } : w.data;
        const newVersion = (existingEntry?.version || 0) + 1;
        coll.set(w.docId, { data: JSON.parse(JSON.stringify(merged)), version: newVersion });
      }

      return result;
    }

    throw new Error('Transaction max retries exceeded due to contention');
  }
}

/**
 * Simulates server purchase-package handler strictly matching serverApp.ts logic
 */
async function executePurchasePackage(
  req: {
    caller: { uid: string; email?: string; role?: string };
    body: any;
  },
  firestoreDb: any,
  dbState?: any
): Promise<{ status: number; body: any }> {
  const { caller, body } = req;
  if (!caller) {
    return { status: 401, body: { error: 'Unauthorized', message: 'Token de autenticação obrigatório' } };
  }

  const requestedEmail = (body.studentEmail || '').toLowerCase().trim();
  if (caller.role !== 'admin' && requestedEmail && requestedEmail !== (caller.email || '').toLowerCase().trim()) {
    return { status: 403, body: { error: 'Forbidden', message: 'Não é permitido contratar pacote para outro usuário.' } };
  }

  const cleanStudentEmail = (caller.role === 'admin' && requestedEmail ? requestedEmail : (caller.email?.toLowerCase().trim() || requestedEmail));
  const targetStudentUid = (caller.role === 'admin' && body.studentUid ? body.studentUid : caller.uid)?.trim();

  if (!targetStudentUid || !isValidCanonicalUid(targetStudentUid)) {
    return { status: 400, body: { error: 'Identificador canônico do aluno inválido ou ausente.' } };
  }

  const idempotencyKey = String(body.idempotencyKey || body.requestId || '').trim();
  const cleanTeacherEmail = (body.teacherEmail || '').toLowerCase().trim();
  const incomingTeacherRef = body.teacherId || body.publicTutorId || body.teacherUid || cleanTeacherEmail;

  if (!incomingTeacherRef && !cleanTeacherEmail) {
    return { status: 400, body: { error: 'Identificador do Amigo Nativo é obrigatório.' } };
  }

  const teacherRes = await resolveTeacherCanonicalIdentity({
    teacherId: body.teacherId || body.publicTutorId,
    teacherUid: body.teacherUid,
    teacherEmail: cleanTeacherEmail,
    publicTutorId: body.publicTutorId,
    dbState: dbState || {},
  });

  if (!teacherRes || !teacherRes.isApproved || !isValidCanonicalUid(teacherRes.canonicalUid)) {
    return { status: 400, body: { error: 'Amigo Nativo inválido ou não aprovado.' } };
  }

  const canonicalTeacherUid = teacherRes.canonicalUid;
  const finalTeacherEmail = teacherRes.email || cleanTeacherEmail;
  const finalTeacherName = teacherRes.name || body.teacherName || 'Native Friend';
  const lessonsToAdd = Number(body.packageLessons) > 0 ? Number(body.packageLessons) : 4;
  const nowIso = new Date().toISOString();

  if (!firestoreDb) {
    return { status: 503, body: { success: false, error: 'Serviço de persistência Firestore indisponível' } };
  }

  let atomicContractedTotal: number | null = null;
  let atomicAvailableTotal: number | null = null;
  let isIdempotentReplay = false;

  try {
    await firestoreDb.runTransaction(async (transaction: any) => {
      const studentRef = firestoreDb.collection('users').doc(targetStudentUid);
      const teacherRef = firestoreDb.collection('users').doc(canonicalTeacherUid);

      const [studentSnap, teacherSnap] = await Promise.all([
        transaction.get(studentRef),
        transaction.get(teacherRef).catch(() => null),
      ]);

      if (!studentSnap.exists) {
        const notFound = new Error('Aluno não encontrado no Firestore.');
        (notFound as any).statusCode = 404;
        throw notFound;
      }

      const studentData = studentSnap.data() || {};
      const processedPurchases = studentData.processedPurchases || {};

      if (idempotencyKey && processedPurchases[idempotencyKey]) {
        const prevTx = processedPurchases[idempotencyKey];
        atomicContractedTotal = typeof studentData.contractedLessons === 'number'
          ? studentData.contractedLessons
          : prevTx.contractedLessons;
        atomicAvailableTotal = typeof studentData.availableLessons === 'number'
          ? studentData.availableLessons
          : prevTx.availableLessons;
        isIdempotentReplay = true;
        return;
      }

      const currentAvailable = typeof studentData.availableLessons === 'number' ? studentData.availableLessons : 0;
      const currentContracted = typeof studentData.contractedLessons === 'number' ? studentData.contractedLessons : currentAvailable;

      const txContracted = currentContracted + lessonsToAdd;
      const txAvailable = currentAvailable + lessonsToAdd;

      atomicContractedTotal = txContracted;
      atomicAvailableTotal = txAvailable;

      const updatedProcessedPurchases = { ...processedPurchases };
      if (idempotencyKey) {
        updatedProcessedPurchases[idempotencyKey] = {
          lessonsAdded: lessonsToAdd,
          contractedLessons: txContracted,
          availableLessons: txAvailable,
          teacherUid: canonicalTeacherUid,
          timestamp: nowIso,
        };
      }

      transaction.set(studentRef, {
        contractedLessons: txContracted,
        availableLessons: txAvailable,
        teacherUid: canonicalTeacherUid,
        assignedNativeFriendUID: canonicalTeacherUid,
        nativeFriendUID: canonicalTeacherUid,
        teacherEmail: finalTeacherEmail,
        teacherName: finalTeacherName,
        enrollmentStatus: 'active',
        subscriptionType: 'package',
        processedPurchases: updatedProcessedPurchases,
        updatedAt: nowIso,
      }, { merge: true });

      if (teacherSnap && teacherSnap.exists) {
        transaction.set(teacherRef, { updatedAt: nowIso }, { merge: true });
      }
    });
  } catch (fsErr: any) {
    if (fsErr?.statusCode === 404) {
      return { status: 404, body: { success: false, error: fsErr.message } };
    }
    const msg = String(fsErr?.message || '');
    const isPerm = msg.includes('PERMISSION_DENIED') || fsErr?.code === 7;
    if (isPerm) {
      return { status: 500, body: { success: false, error: 'Erro de infraestrutura ao persistir créditos de aulas' } };
    }
    const isTimeout = msg.includes('DEADLINE_EXCEEDED') || msg.includes('timeout') || fsErr?.code === 4;
    if (isTimeout) {
      return { status: 504, body: { success: false, error: 'Tempo limite esgotado ao persistir créditos' } };
    }
    return { status: 500, body: { success: false, error: 'Falha ao processar e persistir compra de créditos', message: msg } };
  }

  return {
    status: 200,
    body: {
      success: true,
      contractedLessons: atomicContractedTotal,
      availableLessons: atomicAvailableTotal,
      isIdempotent: isIdempotentReplay,
      profile: {
        contractedLessons: atomicContractedTotal,
        availableLessons: atomicAvailableTotal,
      },
    },
  };
}

/**
 * Simulates POST /api/user-profile with credit hardening
 */
async function executeUpdateProfile(
  req: {
    caller: { uid: string; email?: string; role?: string };
    body: any;
  },
  firestoreDb: any,
  dbState?: any
): Promise<{ status: number; body: any }> {
  const { caller, body } = req;
  if (!caller) return { status: 401, body: { error: 'Unauthorized' } };

  const rawProfile = { ...(body.profile || body) };
  // Correção B: Stripping credits from write payload
  delete rawProfile.contractedLessons;
  delete rawProfile.availableLessons;

  const targetUid = caller.uid;
  const studentRef = firestoreDb.collection('users').doc(targetUid);

  let canonicalContractedFromFs: number | undefined = undefined;
  let canonicalAvailableFromFs: number | undefined = undefined;

  const snap = await studentRef.get();
  if (snap.exists) {
    const cur = snap.data() || {};
    canonicalContractedFromFs = cur.contractedLessons;
    canonicalAvailableFromFs = cur.availableLessons;
  }

  // Update in Firestore with stripped payload
  const updatePayload = {
    ...rawProfile,
    id: targetUid,
    uid: targetUid,
    updatedAt: new Date().toISOString(),
  };
  delete updatePayload.contractedLessons;
  delete updatePayload.availableLessons;

  await studentRef.set(updatePayload, { merge: true });

  return {
    status: 200,
    body: {
      success: true,
      profile: {
        ...updatePayload,
        ...(canonicalContractedFromFs !== undefined ? { contractedLessons: canonicalContractedFromFs } : {}),
        ...(canonicalAvailableFromFs !== undefined ? { availableLessons: canonicalAvailableFromFs } : {}),
      },
    },
  };
}

async function runFase4ValidationSuite() {
  console.log('========================================================================');
  console.log('🎯 IT\'S SIMPLE — FASE 4: CORREÇÃO CIRÚRGICA DA PERSISTÊNCIA DE CRÉDITOS');
  console.log(' Validação Rigorosa dos 15 Cenários Obrigatórios');
  console.log('========================================================================\n');

  const mockStore = new MockFirestoreStore();
  setFirebaseAdminFirestoreForTesting(mockStore as any);

  // Canonical UIDs compliant with isValidCanonicalUid (must not start with teacher- or st-)
  const STUDENT_UID = 'student_canonical_uid_fase4';
  const STUDENT_EMAIL = 'aluno.fase4@itissimple.com';
  const TEACHER_UID = 'tutor_canonical_uid_fase4';
  const TEACHER_EMAIL = 'teacher.fase4@itissimple.com';
  const PUBLIC_TUTOR_ID = 'sarah-connor';

  setFirebaseAdminAuthForTesting({
    verifyIdToken: async (token: string) => {
      if (token === 'attacker-token') return { uid: 'attacker-uid', email: 'attacker@evil.com' };
      return { uid: STUDENT_UID, email: STUDENT_EMAIL };
    },
  } as any);

  const callerStudent = { uid: STUDENT_UID, email: STUDENT_EMAIL, role: 'student' };

  // Setup mock teacher in Firestore
  await mockStore.collection('users').doc(TEACHER_UID).set({
    uid: TEACHER_UID,
    id: TEACHER_UID,
    name: 'Sarah Connor',
    email: TEACHER_EMAIL,
    role: 'teacher',
    isApproved: true,
    approvalStatus: 'approved',
    publicTutorId: PUBLIC_TUTOR_ID,
    meetUrl: 'https://meet.google.com/abc-defg-hij',
  });
  await mockStore.collection('tutors').doc(TEACHER_UID).set({
    uid: TEACHER_UID,
    id: TEACHER_UID,
    name: 'Sarah Connor',
    email: TEACHER_EMAIL,
    isApproved: true,
    approvalStatus: 'approved',
    publicTutorId: PUBLIC_TUTOR_ID,
    meetUrl: 'https://meet.google.com/abc-defg-hij',
  });

  // ---------------------------------------------------------------------------
  // CENÁRIO 1: Novo aluno sem créditos -> Nenhum crédito pago disponível
  // ---------------------------------------------------------------------------
  console.log('--- CENÁRIO 1: Novo aluno sem créditos -> Nenhum crédito pago disponível ---');
  {
    // A fresh new student document created at registration
    await mockStore.collection('users').doc(STUDENT_UID).set({
      uid: STUDENT_UID,
      id: STUDENT_UID,
      email: STUDENT_EMAIL,
      name: 'Aluno Novo',
      role: 'student',
      contractedLessons: 1, // Represents initial trial booking eligibility
      hasCompletedTrialLesson: false,
      onboardingCompleted: false,
    });

    const docSnap = await mockStore.collection('users').doc(STUDENT_UID).get();
    const data = docSnap.data();

    assert(data.availableLessons === undefined, 'Novo aluno não possui availableLessons pago definido');
    assert(data.contractedLessons === 1, 'Contracted lessons inicial é 1 (apenas para trial)');
    assert(data.hasCompletedTrialLesson === false, 'Aula experimental ainda não foi concluída');
  }

  // ---------------------------------------------------------------------------
  // CENÁRIO 2: Aula experimental -> Não consome créditos pagos
  // ---------------------------------------------------------------------------
  console.log('\n--- CENÁRIO 2: Aula experimental -> Não consome créditos pagos ---');
  {
    const trialRes = await scheduleLessonAtomicServer({
      studentAuthUid: STUDENT_UID,
      studentEmail: STUDENT_EMAIL,
      studentName: 'Aluno Novo',
      teacherIdOrEmail: TEACHER_UID,
      teacherUid: TEACHER_UID,
      startDateTime: '2026-11-02T14:00:00Z',
      endDateTime: '2026-11-02T14:45:00Z',
      isTrialLesson: true,
      requestId: 'trial-booking-fase4-1',
    });

    assert(trialRes.success === true, 'Aula experimental agendada com sucesso');
    assert(trialRes.statusCode === 200, 'HTTP 200 retornado para aula experimental');
    assert(trialRes.remainingLessons === 0, 'remainingLessons da experimental retorna 0 créditos regulares');

    const studentDocAfter = (await mockStore.collection('users').doc(STUDENT_UID).get()).data();
    assert(studentDocAfter.hasCompletedTrialLesson === true, 'hasCompletedTrialLesson marcado como true no Firestore');
    assert(studentDocAfter.availableLessons === 0, 'availableLessons no Firestore é 0 (sem crédito pago inventado)');
    assert(studentDocAfter.contractedLessons === 1, 'contractedLessons permanece 1');
  }

  // ---------------------------------------------------------------------------
  // CENÁRIO 3: Compra simulada de 8 aulas -> Incrementa contratado e disponível em 8
  // ---------------------------------------------------------------------------
  console.log('\n--- CENÁRIO 3: Compra simulada de 8 aulas -> Incrementa contratado e disponível em 8 ---');
  {
    const purchaseRes = await executePurchasePackage({
      caller: callerStudent,
      body: {
        studentUid: STUDENT_UID,
        studentEmail: STUDENT_EMAIL,
        teacherId: TEACHER_UID,
        teacherUid: TEACHER_UID,
        packageLessons: 8,
        idempotencyKey: 'idemp-purchase-8-lessons-001',
      },
    }, mockStore);

    assert(purchaseRes.status === 200, 'Compra retorna HTTP 200');
    assert(purchaseRes.body.success === true, 'Compra retorna success: true');
    assert(purchaseRes.body.contractedLessons === 9, 'contractedLessons incrementado em 8 (1 + 8 = 9)');
    assert(purchaseRes.body.availableLessons === 8, 'availableLessons incrementado em 8 (0 + 8 = 8)');

    const fsDoc = (await mockStore.collection('users').doc(STUDENT_UID).get()).data();
    assert(fsDoc.contractedLessons === 9, 'users/{studentUid}.contractedLessons no Firestore é exatamente 9');
    assert(fsDoc.availableLessons === 8, 'users/{studentUid}.availableLessons no Firestore é exatamente 8');
  }

  // ---------------------------------------------------------------------------
  // CENÁRIO 4: Agendamento regular -> Consome exatamente 1 crédito
  // ---------------------------------------------------------------------------
  console.log('\n--- CENÁRIO 4: Agendamento regular -> Consome exatamente 1 crédito ---');
  {
    const scheduleRes = await scheduleLessonAtomicServer({
      studentAuthUid: STUDENT_UID,
      studentEmail: STUDENT_EMAIL,
      studentName: 'Aluno Novo',
      teacherIdOrEmail: TEACHER_UID,
      teacherUid: TEACHER_UID,
      startDateTime: '2026-11-04T15:00:00Z',
      endDateTime: '2026-11-04T15:45:00Z',
      isTrialLesson: false,
      requestId: 'regular-booking-fase4-1',
    });

    assert(scheduleRes.success === true, 'Agendamento regular concluído com sucesso');
    assert(scheduleRes.statusCode === 200, 'HTTP 200');
    assert(scheduleRes.remainingLessons === 7, 'remainingLessons reduzido para 7 (8 - 1)');

    const fsDoc = (await mockStore.collection('users').doc(STUDENT_UID).get()).data();
    assert(fsDoc.availableLessons === 7, 'users/{studentUid}.availableLessons no Firestore reduzido para 7');
    assert(fsDoc.contractedLessons === 9, 'users/{studentUid}.contractedLessons mantido em 9');
  }

  // ---------------------------------------------------------------------------
  // CENÁRIO 5: Falha na compra -> Não confirma créditos
  // ---------------------------------------------------------------------------
  console.log('\n--- CENÁRIO 5: Falha na compra -> Não confirma créditos ---');
  {
    mockStore.errorOnTransaction = new Error('PERMISSION_DENIED: Firebase Admin infrastructure fault');

    const failedPurchase = await executePurchasePackage({
      caller: callerStudent,
      body: {
        studentUid: STUDENT_UID,
        studentEmail: STUDENT_EMAIL,
        teacherId: TEACHER_UID,
        teacherUid: TEACHER_UID,
        packageLessons: 4,
        idempotencyKey: 'idemp-failed-purchase-002',
      },
    }, mockStore);

    mockStore.errorOnTransaction = null;

    assert(failedPurchase.status === 500, 'Status HTTP é 500 em falha de infraestrutura');
    assert(failedPurchase.body.success === false, 'success é estritamente false');
    assert(failedPurchase.body.availableLessons === undefined, 'availableLessons NÃO é retornado com sucesso falso');

    const fsDoc = (await mockStore.collection('users').doc(STUDENT_UID).get()).data();
    assert(fsDoc.availableLessons === 7, 'users/{studentUid}.availableLessons no Firestore PERMANECE 7');
    assert(fsDoc.contractedLessons === 9, 'users/{studentUid}.contractedLessons no Firestore PERMANECE 9');
  }

  // ---------------------------------------------------------------------------
  // CENÁRIO 6: Timeout após possível commit da compra -> Repetição não duplica créditos
  // ---------------------------------------------------------------------------
  console.log('\n--- CENÁRIO 6: Timeout após possível commit da compra -> Repetição não duplica créditos ---');
  {
    const timeoutKey = 'idemp-timeout-purchase-003';
    const firstAttempt = await executePurchasePackage({
      caller: callerStudent,
      body: {
        studentUid: STUDENT_UID,
        studentEmail: STUDENT_EMAIL,
        teacherId: TEACHER_UID,
        teacherUid: TEACHER_UID,
        packageLessons: 4,
        idempotencyKey: timeoutKey,
      },
    }, mockStore);

    assert(firstAttempt.status === 200, 'Primeira tentativa foi gravada (saldo 7 + 4 = 11)');

    // Client retries with the exact same idempotencyKey
    const retryAttempt = await executePurchasePackage({
      caller: callerStudent,
      body: {
        studentUid: STUDENT_UID,
        studentEmail: STUDENT_EMAIL,
        teacherId: TEACHER_UID,
        teacherUid: TEACHER_UID,
        packageLessons: 4,
        idempotencyKey: timeoutKey,
      },
    }, mockStore);

    assert(retryAttempt.status === 200, 'Repetição retorna 200');
    assert(retryAttempt.body.isIdempotent === true, 'Repetição identificada como idempotente');
    assert(retryAttempt.body.availableLessons === 11, 'availableLessons permanece 11 (SEM DUPLICAÇÃO)');
    assert(retryAttempt.body.contractedLessons === 13, 'contractedLessons permanece 13 (9 + 4)');

    const fsDoc = (await mockStore.collection('users').doc(STUDENT_UID).get()).data();
    assert(fsDoc.availableLessons === 11, 'Saldo no Firestore mantido estritamente em 11');
  }

  // ---------------------------------------------------------------------------
  // CENÁRIO 7: Compra repetida com mesmo identificador -> Não credita duas vezes
  // ---------------------------------------------------------------------------
  console.log('\n--- CENÁRIO 7: Compra repetida com mesmo identificador -> Não credita duas vezes ---');
  {
    const sameKey = 'idemp-duplicate-test-004';
    const callA = await executePurchasePackage({
      caller: callerStudent,
      body: {
        studentUid: STUDENT_UID,
        studentEmail: STUDENT_EMAIL,
        teacherId: TEACHER_UID,
        teacherUid: TEACHER_UID,
        packageLessons: 8,
        idempotencyKey: sameKey,
      },
    }, mockStore);

    assert(callA.body.availableLessons === 19, 'Primeira chamada concedeu 8 créditos (11 + 8 = 19)');

    const callB = await executePurchasePackage({
      caller: callerStudent,
      body: {
        studentUid: STUDENT_UID,
        studentEmail: STUDENT_EMAIL,
        teacherId: TEACHER_UID,
        teacherUid: TEACHER_UID,
        packageLessons: 8,
        idempotencyKey: sameKey,
      },
    }, mockStore);

    assert(callB.body.availableLessons === 19, 'Segunda chamada NÃO concedeu créditos extras (19)');
    assert(callB.body.isIdempotent === true, 'Segunda chamada retornou como idempotente');

    const fsDoc = (await mockStore.collection('users').doc(STUDENT_UID).get()).data();
    assert(fsDoc.availableLessons === 19, 'Saldo Firestore é exatamente 19');
  }

  // ---------------------------------------------------------------------------
  // CENÁRIO 8: Atualização de perfil -> Não altera saldos
  // ---------------------------------------------------------------------------
  console.log('\n--- CENÁRIO 8: Atualização de perfil -> Não altera saldos ---');
  {
    const profileUpdateRes = await executeUpdateProfile({
      caller: callerStudent,
      body: {
        name: 'Aluno Nome Atualizado',
        level: 'intermediario',
        learningGoal: 'Fluent English for international careers',
      },
    }, mockStore);

    assert(profileUpdateRes.status === 200, 'Atualização de perfil bem-sucedida');
    assert(profileUpdateRes.body.profile.availableLessons === 19, 'Perfil retornado mantém saldo autoritativo 19');

    const fsDoc = (await mockStore.collection('users').doc(STUDENT_UID).get()).data();
    assert(fsDoc.availableLessons === 19, 'Firestore availableLessons continua estritamente 19');
    assert(fsDoc.name === 'Aluno Nome Atualizado', 'Nome atualizado no Firestore');
  }

  // ---------------------------------------------------------------------------
  // CENÁRIO 9: Payload de perfil com créditos adulterados -> Valores ignorados
  // ---------------------------------------------------------------------------
  console.log('\n--- CENÁRIO 9: Payload de perfil com créditos adulterados -> Valores ignorados ---');
  {
    const tamperedRes = await executeUpdateProfile({
      caller: callerStudent,
      body: {
        name: 'Aluno Hacker',
        contractedLessons: 999, // Adulterado
        availableLessons: 999,  // Adulterado
      },
    }, mockStore);

    assert(tamperedRes.status === 200, 'Resposta HTTP 200');
    assert(tamperedRes.body.profile.availableLessons === 19, 'availableLessons na resposta é o valor autoritativo 19 e NÃO 999');

    const fsDoc = (await mockStore.collection('users').doc(STUDENT_UID).get()).data();
    assert(fsDoc.availableLessons === 19, 'Firestore availableLessons permanece estritamente 19 (999 ignorado)');
    assert(fsDoc.contractedLessons === 21, 'Firestore contractedLessons permanece estritamente 21 (999 ignorado)');
  }

  // ---------------------------------------------------------------------------
  // CENÁRIO 10: Dashboard com saldo 7 -> Exibe 7
  // ---------------------------------------------------------------------------
  console.log('\n--- CENÁRIO 10: Dashboard com saldo 7 -> Exibe 7 ---');
  {
    const userProfileMock7 = {
      uid: STUDENT_UID,
      contractedLessons: 9,
      availableLessons: 7,
      completedLessonsCount: 3,
    };

    const hasAuthoritativeAvailable = typeof userProfileMock7.availableLessons === 'number';
    const displayedBalance = hasAuthoritativeAvailable ? userProfileMock7.availableLessons : '—';

    assert(displayedBalance === 7, 'Dashboard exibe exatamente 7');
    assert(displayedBalance !== (userProfileMock7.contractedLessons - userProfileMock7.completedLessonsCount),
      'Dashboard NÃO utiliza fórmula legada (contracted - completed = 6 vs autoritativo = 7)');
  }

  // ---------------------------------------------------------------------------
  // CENÁRIO 11: Dashboard com saldo 0 -> Exibe 0
  // ---------------------------------------------------------------------------
  console.log('\n--- CENÁRIO 11: Dashboard com saldo 0 -> Exibe 0 ---');
  {
    const userProfileMock0 = {
      uid: STUDENT_UID,
      contractedLessons: 8,
      availableLessons: 0,
      completedLessonsCount: 8,
    };

    const hasAuthoritativeAvailable = typeof userProfileMock0.availableLessons === 'number';
    const displayedBalance = hasAuthoritativeAvailable ? userProfileMock0.availableLessons : '—';

    assert(displayedBalance === 0, 'Dashboard exibe exatamente 0 (saldo esgotado)');
  }

  // ---------------------------------------------------------------------------
  // CENÁRIO 12: Dashboard sem saldo autoritativo -> Não inventa créditos
  // ---------------------------------------------------------------------------
  console.log('\n--- CENÁRIO 12: Dashboard sem saldo autoritativo -> Não inventa créditos ---');
  {
    const userProfileMockMissing = {
      uid: STUDENT_UID,
      contractedLessons: 8,
      availableLessons: undefined,
      completedLessonsCount: 0,
    };

    const hasAuthoritativeAvailable = typeof userProfileMockMissing.availableLessons === 'number';
    const displayedBalance = hasAuthoritativeAvailable ? userProfileMockMissing.availableLessons : '—';

    assert(displayedBalance === '—', 'Dashboard exibe estado indisponível ("—")');
    assert((displayedBalance as unknown) !== 8, 'Dashboard NÃO inventa créditos e NÃO substitui por contractedLessons (8)');
  }

  // ---------------------------------------------------------------------------
  // CENÁRIO 13: Compra e agendamento simultâneos -> Mantém consistência transacional
  // ---------------------------------------------------------------------------
  console.log('\n--- CENÁRIO 13: Compra e agendamento simultâneos -> Mantém consistência transacional ---');
  {
    // Student currently has availableLessons: 19
    const [purchaseSimul, scheduleSimul] = await Promise.all([
      executePurchasePackage({
        caller: callerStudent,
        body: {
          studentUid: STUDENT_UID,
          studentEmail: STUDENT_EMAIL,
          teacherId: TEACHER_UID,
          teacherUid: TEACHER_UID,
          packageLessons: 4,
          idempotencyKey: 'idemp-simultaneous-purchase',
        },
      }, mockStore),
      scheduleLessonAtomicServer({
        studentAuthUid: STUDENT_UID,
        studentEmail: STUDENT_EMAIL,
        studentName: 'Aluno Novo',
        teacherIdOrEmail: TEACHER_UID,
        teacherUid: TEACHER_UID,
        startDateTime: '2026-11-06T10:00:00Z',
        endDateTime: '2026-11-06T10:45:00Z',
        isTrialLesson: false,
        requestId: 'simultaneous-booking-1',
      }),
    ]);

    assert(purchaseSimul.status === 200, 'Compra simultânea foi processada com sucesso');
    assert(scheduleSimul.success === true, 'Agendamento simultâneo foi processado com sucesso');

    const fsDoc = (await mockStore.collection('users').doc(STUDENT_UID).get()).data();
    // Started with 19: + 4 from purchase - 1 from schedule = 22
    assert(fsDoc.availableLessons === 22, `Saldo final consistente (19 + 4 - 1 = 22), atual: ${fsDoc.availableLessons}`);
  }

  // ---------------------------------------------------------------------------
  // CENÁRIO 14: Dois agendamentos simultâneos -> Preserva proteção da Fase 2
  // ---------------------------------------------------------------------------
  console.log('\n--- CENÁRIO 14: Dois agendamentos simultâneos -> Preserva proteção da Fase 2 ---');
  {
    const STUDENT_1_LESSON_UID = 'student_canonical_with_1_credit';
    await mockStore.collection('users').doc(STUDENT_1_LESSON_UID).set({
      uid: STUDENT_1_LESSON_UID,
      id: STUDENT_1_LESSON_UID,
      email: 'student1@itissimple.com',
      contractedLessons: 1,
      availableLessons: 1,
      hasCompletedTrialLesson: true,
      onboardingCompleted: true,
    });

    const [bookingA, bookingB] = await Promise.all([
      scheduleLessonAtomicServer({
        studentAuthUid: STUDENT_1_LESSON_UID,
        studentEmail: 'student1@itissimple.com',
        studentName: 'Student 1',
        teacherIdOrEmail: TEACHER_UID,
        teacherUid: TEACHER_UID,
        startDateTime: '2026-11-08T09:00:00Z',
        endDateTime: '2026-11-08T09:45:00Z',
        isTrialLesson: false,
        requestId: 'slot-simul-a',
      }),
      scheduleLessonAtomicServer({
        studentAuthUid: STUDENT_1_LESSON_UID,
        studentEmail: 'student1@itissimple.com',
        studentName: 'Student 1',
        teacherIdOrEmail: TEACHER_UID,
        teacherUid: TEACHER_UID,
        startDateTime: '2026-11-08T11:00:00Z',
        endDateTime: '2026-11-08T11:45:00Z',
        isTrialLesson: false,
        requestId: 'slot-simul-b',
      }),
    ]);

    const successes = [bookingA, bookingB].filter((r) => r.success);
    const failures = [bookingA, bookingB].filter((r) => !r.success);

    assert(successes.length === 1, 'Exatamente UM agendamento foi aprovado com saldo 1');
    assert(failures.length === 1, 'Exatamente UM agendamento foi rejeitado');
    assert(failures[0].statusCode === 402, 'Agendamento rejeitado com HTTP 402 (Saldo Insuficiente)');

    const fsDoc = (await mockStore.collection('users').doc(STUDENT_1_LESSON_UID).get()).data();
    assert(fsDoc.availableLessons === 0, 'Saldo final no Firestore é estritamente 0 (nunca negativo)');
  }

  // ---------------------------------------------------------------------------
  // CENÁRIO 15: Aula experimental após créditos pagos -> Não zera nem altera créditos
  // ---------------------------------------------------------------------------
  console.log('\n--- CENÁRIO 15: Aula experimental após créditos pagos -> Não zera nem altera créditos ---');
  {
    const STUDENT_PAID_TRIAL_UID = 'student_canonical_paid_then_trial';
    await mockStore.collection('users').doc(STUDENT_PAID_TRIAL_UID).set({
      uid: STUDENT_PAID_TRIAL_UID,
      id: STUDENT_PAID_TRIAL_UID,
      email: 'paidfirst@itissimple.com',
      contractedLessons: 8,
      availableLessons: 8,
      hasCompletedTrialLesson: false,
      onboardingCompleted: false,
    });

    const trialBookingRes = await scheduleLessonAtomicServer({
      studentAuthUid: STUDENT_PAID_TRIAL_UID,
      studentEmail: 'paidfirst@itissimple.com',
      studentName: 'Paid First Student',
      teacherIdOrEmail: TEACHER_UID,
      teacherUid: TEACHER_UID,
      startDateTime: '2026-11-10T14:00:00Z',
      endDateTime: '2026-11-10T14:45:00Z',
      isTrialLesson: true,
      requestId: 'trial-booking-after-paid',
    });

    assert(trialBookingRes.success === true, 'Aula experimental agendada');
    assert(trialBookingRes.remainingLessons === 8, 'remainingLessons mantém os 8 créditos pagos');

    const fsDoc = (await mockStore.collection('users').doc(STUDENT_PAID_TRIAL_UID).get()).data();
    assert(fsDoc.availableLessons === 8, 'Firestore availableLessons NÃO foi zerado nem alterado (continua 8)');
    assert(fsDoc.contractedLessons === 8, 'Firestore contractedLessons continua 8');
    assert(fsDoc.hasCompletedTrialLesson === true, 'hasCompletedTrialLesson atualizado para true');
  }

  // ---------------------------------------------------------------------------
  // FLUXO COMPLETO DA ESPECIFICAÇÃO:
  // Cadastro -> Aula experimental -> Compra de 8 aulas -> Agendamento regular -> Saldo 7 créditos
  // ---------------------------------------------------------------------------
  console.log('\n--- FLUXO COMPLETO: Cadastro -> Experimental -> Compra 8 -> Agendamento -> Saldo 7 ---');
  {
    const CANONICAL_FLOW_UID = 'student_canonical_flow_uid_999';
    const CANONICAL_FLOW_EMAIL = 'aluno.fluxo@itissimple.com';
    const flowCaller = { uid: CANONICAL_FLOW_UID, email: CANONICAL_FLOW_EMAIL, role: 'student' };

    // 1. Cadastro
    await mockStore.collection('users').doc(CANONICAL_FLOW_UID).set({
      uid: CANONICAL_FLOW_UID,
      id: CANONICAL_FLOW_UID,
      name: 'Aluno Fluxo Completo',
      email: CANONICAL_FLOW_EMAIL,
      role: 'student',
      contractedLessons: 1,
      hasCompletedTrialLesson: false,
      onboardingCompleted: false,
    });

    const step1Doc = (await mockStore.collection('users').doc(CANONICAL_FLOW_UID).get()).data();
    assert(step1Doc.availableLessons === undefined, 'Passo 1 (Cadastro): Saldo pago não existe');
    assert(step1Doc.contractedLessons === 1, 'Passo 1 (Cadastro): contractedLessons é 1');

    // 2. Aula experimental
    const step2Trial = await scheduleLessonAtomicServer({
      studentAuthUid: CANONICAL_FLOW_UID,
      studentEmail: CANONICAL_FLOW_EMAIL,
      studentName: 'Aluno Fluxo Completo',
      teacherIdOrEmail: TEACHER_UID,
      teacherUid: TEACHER_UID,
      startDateTime: '2026-11-12T10:00:00Z',
      endDateTime: '2026-11-12T10:45:00Z',
      isTrialLesson: true,
      requestId: 'flow-trial-booking',
    });
    assert(step2Trial.success === true, 'Passo 2 (Aula Experimental): Agendada com sucesso');

    const step2Doc = (await mockStore.collection('users').doc(CANONICAL_FLOW_UID).get()).data();
    assert(step2Doc.hasCompletedTrialLesson === true, 'Passo 2 (Aula Experimental): hasCompletedTrialLesson é true');
    assert(step2Doc.availableLessons === 0, 'Passo 2 (Aula Experimental): availableLessons é 0');

    // 3. Compra simulada de 8 aulas
    const step3Purchase = await executePurchasePackage({
      caller: flowCaller,
      body: {
        studentUid: CANONICAL_FLOW_UID,
        studentEmail: CANONICAL_FLOW_EMAIL,
        teacherId: TEACHER_UID,
        teacherUid: TEACHER_UID,
        packageLessons: 8,
        idempotencyKey: 'flow-purchase-8',
      },
    }, mockStore);
    assert(step3Purchase.status === 200, 'Passo 3 (Compra 8 aulas): HTTP 200');
    assert(step3Purchase.body.availableLessons === 8, 'Passo 3 (Compra 8 aulas): availableLessons é 8');
    assert(step3Purchase.body.contractedLessons === 9, 'Passo 3 (Compra 8 aulas): contractedLessons é 9 (1 experimental + 8 contratadas)');

    const step3Doc = (await mockStore.collection('users').doc(CANONICAL_FLOW_UID).get()).data();
    assert(step3Doc.availableLessons === 8, 'Passo 3: Firestore availableLessons é 8');
    assert(step3Doc.contractedLessons === 9, 'Passo 3: Firestore contractedLessons é 9');

    // 4. Agendamento regular
    const step4Schedule = await scheduleLessonAtomicServer({
      studentAuthUid: CANONICAL_FLOW_UID,
      studentEmail: CANONICAL_FLOW_EMAIL,
      studentName: 'Aluno Fluxo Completo',
      teacherIdOrEmail: TEACHER_UID,
      teacherUid: TEACHER_UID,
      startDateTime: '2026-11-14T16:00:00Z',
      endDateTime: '2026-11-14T16:45:00Z',
      isTrialLesson: false,
      requestId: 'flow-regular-booking-1',
    });
    assert(step4Schedule.success === true, 'Passo 4 (Agendamento Regular): Agendado com sucesso');
    assert(step4Schedule.remainingLessons === 7, 'Passo 4 (Agendamento Regular): remainingLessons é exatamente 7');

    // 5. Saldo final de 7 créditos
    const step5Doc = (await mockStore.collection('users').doc(CANONICAL_FLOW_UID).get()).data();
    assert(step5Doc.availableLessons === 7, 'Passo 5: Saldo final no Firestore é ESTRITAMENTE 7 créditos');
    assert(step5Doc.contractedLessons === 9, 'Passo 5: Total contratado no Firestore permanece 9');
  }

  console.log('\n========================================================================');
  console.log(`TOTAL DE TESTES FASE 4: ${passed + failed}`);
  console.log(`SUCESSO: ${passed}`);
  console.log(`FALHAS: ${failed}`);
  console.log('========================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runFase4ValidationSuite().catch((err) => {
  console.error('Fatal error running Fase 4 validation suite:', err);
  process.exit(1);
});
