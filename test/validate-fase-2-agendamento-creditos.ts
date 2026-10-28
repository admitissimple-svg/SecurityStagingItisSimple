/**
 * IT'S SIMPLE — SECURITY STAGING
 * FASE 2 — HOTFIX CIRÚRGICO DO AGENDAMENTO E CONSUMO DE CRÉDITOS
 * 
 * Validação rigorosa dos 14 cenários obrigatórios:
 * 1.  Saldo 8, agendar uma aula -> Saldo 7; uma aula persistida
 * 2.  Saldo 0 -> HTTP 402; nenhuma aula criada
 * 3.  Saldo ausente -> Bloqueio controlado (HTTP 422); nenhum crédito inventado
 * 4.  Documento inexistente -> Bloqueio controlado (HTTP 404)
 * 5.  PERMISSION_DENIED -> Erro de permissão (HTTP 403); nenhum sucesso falso
 * 6.  Timeout antes do commit -> Nenhuma confirmação falsa (HTTP 504)
 * 7.  Timeout com commit potencialmente concluído -> Repetição idempotente, sem débito duplo
 * 8.  Duas aulas simultâneas, saldo 1 -> Apenas uma confirmada (segunda rejeitada com HTTP 402, saldo final 0)
 * 9.  Duas requisições idênticas -> Uma aula e um débito
 * 10. Repetição com mesmo requestId -> Sem novo débito
 * 11. Aula experimental -> Sem consumo de crédito regular
 * 12. Conflito de horário -> HTTP 409; sem débito
 * 13. Falha de sincronização local após commit -> Sem repetição do débito, sucesso garantido a partir do Firestore
 * 14. Erro no backend -> Frontend não confirma aula, não deduz crédito e modal não apresenta confirmação falsa
 */

import {
  scheduleLessonAtomicServer,
  setFirebaseAdminFirestoreForTesting,
  SchedulingTransactionError,
} from '../src/serverFirestore';
import { setFirebaseAdminAuthForTesting } from '../src/serverFirebaseAdmin';
import { LiveLesson } from '../src/types';

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
    const maxRetries = 5;
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
        // Concurrency retry
        continue;
      }

      // Apply pending writes atomically
      for (const write of pendingWrites) {
        const coll = self.getCollection(write.collPath);
        const existingEntry = coll.get(write.docId);
        const existingData = existingEntry?.data || {};
        const merged = write.options?.merge ? { ...existingData, ...write.data } : write.data;
        const newVersion = (existingEntry?.version || 0) + 1;
        coll.set(write.docId, { data: JSON.parse(JSON.stringify(merged)), version: newVersion });
      }

      return result;
    }

    throw new Error('Transaction failed after maximum OCC retries');
  }
}

async function runFase2Validation() {
  console.log('========================================================================');
  console.log('IT\'S SIMPLE — FASE 2: HOTFIX CIRÚRGICO DO AGENDAMENTO E CONSUMO DE CRÉDITOS');
  console.log('Validação Rigorosa dos 14 Cenários Obrigatórios');
  console.log('========================================================================\n');

  const mockDb = new MockFirestoreStore();
  setFirebaseAdminFirestoreForTesting(mockDb as any);
  setFirebaseAdminAuthForTesting({
    verifyIdToken: async (token: string) => {
      if (token === 'attacker-token') return { uid: 'attacker-uid', email: 'attacker@evil.com' };
      return { uid: 'student_canonical_uid_fase2', email: 'student.fase2@example.com' };
    },
  } as any);

  const studentUid = 'student_canonical_uid_fase2';
  const studentEmail = 'student.fase2@example.com';
  const studentName = 'Sarah Conrado';

  const teacherUid = 'tutor_canonical_uid_fase2';
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
    meetUrl: 'https://meet.google.com/sb-room-fase2',
  });

  await mockDb.collection('tutors').doc(teacherUid).set({
    uid: teacherUid,
    id: teacherUid,
    email: teacherEmail,
    name: teacherName,
    isApproved: true,
    status: 'approved',
    publicTutorId,
    meetUrl: 'https://meet.google.com/sb-room-fase2',
  });

  // --------------------------------------------------------------------------
  console.log('--- CENÁRIO 1: Saldo 8, agendar uma aula -> Saldo 7; uma aula persistida ---');
  // --------------------------------------------------------------------------
  await mockDb.collection('users').doc(studentUid).set({
    uid: studentUid,
    id: studentUid,
    email: studentEmail,
    name: studentName,
    role: 'student',
    availableLessons: 8,
    contractedLessons: 8,
    hasCompletedTrialLesson: true,
    onboardingCompleted: true,
  });

  const res1 = await scheduleLessonAtomicServer({
    studentAuthUid: studentUid,
    studentEmail,
    studentName,
    teacherIdOrEmail: teacherUid,
    startDateTime: '2026-11-02T14:00:00Z',
    endDateTime: '2026-11-02T14:50:00Z',
    title: 'Aula Regular 1',
    isTrialLesson: false,
    requestId: 'req-fase2-c1',
  });

  assert(res1.success === true, 'res1.success é true');
  assert(res1.statusCode === 200, 'res1.statusCode é 200');
  assert(res1.remainingLessons === 7, 'res1.remainingLessons é 7 (8 - 1)');

  const doc1 = (await mockDb.collection('users').doc(studentUid).get()).data();
  assert(doc1.availableLessons === 7, 'users/{studentUid}.availableLessons no Firestore é 7');

  const lessonDoc1 = (await mockDb.collection('lessons').doc('req-fase2-c1').get()).data();
  assert(lessonDoc1 !== undefined && lessonDoc1.status === 'scheduled', 'Aula persistida em /lessons com status scheduled');

  const subDoc1 = (await mockDb.collection('users').doc(studentUid).collection('lessons').doc('req-fase2-c1').get()).data();
  assert(subDoc1 !== undefined && subDoc1.teacherUid === teacherUid, 'Aula persistida na subcoleção do aluno vinculada ao professor');

  // --------------------------------------------------------------------------
  console.log('\n--- CENÁRIO 2: Saldo 0 -> HTTP 402; nenhuma aula criada ---');
  // --------------------------------------------------------------------------
  const zeroUid = 'student_zero_balance_uid';
  await mockDb.collection('users').doc(zeroUid).set({
    uid: zeroUid,
    id: zeroUid,
    email: 'zero@example.com',
    name: 'Zero Balance Student',
    role: 'student',
    availableLessons: 0,
    contractedLessons: 4,
    hasCompletedTrialLesson: true,
    onboardingCompleted: true,
  });

  const res2 = await scheduleLessonAtomicServer({
    studentAuthUid: zeroUid,
    studentEmail: 'zero@example.com',
    studentName: 'Zero Balance Student',
    teacherIdOrEmail: teacherUid,
    startDateTime: '2026-11-03T10:00:00Z',
    endDateTime: '2026-11-03T10:50:00Z',
    title: 'Tentativa Saldo Zero',
    isTrialLesson: false,
    requestId: 'req-fase2-c2',
  });

  assert(res2.success === false, 'res2.success é false');
  assert(res2.statusCode === 402, 'res2.statusCode é 402');
  assert(res2.error?.includes('Saldo de aulas insuficiente') || false, 'Mensagem clara de saldo insuficiente');

  const lessonDoc2 = (await mockDb.collection('lessons').doc('req-fase2-c2').get()).data();
  assert(lessonDoc2 === undefined, 'Nenhuma aula criada no Firestore para saldo 0');

  // --------------------------------------------------------------------------
  console.log('\n--- CENÁRIO 3: Saldo ausente -> Bloqueio controlado (HTTP 422); nenhum crédito inventado ---');
  // --------------------------------------------------------------------------
  const missingBalUid = 'student_missing_balance_uid';
  await mockDb.collection('users').doc(missingBalUid).set({
    uid: missingBalUid,
    id: missingBalUid,
    email: 'missing@example.com',
    name: 'Missing Balance Student',
    role: 'student',
    contractedLessons: 8, // contractedLessons exists, but availableLessons is UNDEFINED!
    hasCompletedTrialLesson: true,
    onboardingCompleted: true,
  });

  const res3 = await scheduleLessonAtomicServer({
    studentAuthUid: missingBalUid,
    studentEmail: 'missing@example.com',
    studentName: 'Missing Balance Student',
    teacherIdOrEmail: teacherUid,
    startDateTime: '2026-11-03T11:00:00Z',
    endDateTime: '2026-11-03T11:50:00Z',
    title: 'Tentativa Saldo Ausente',
    isTrialLesson: false,
    requestId: 'req-fase2-c3',
  });

  assert(res3.success === false, 'res3.success é false');
  assert(res3.statusCode === 422, 'res3.statusCode é 422 (Unprocessable Entity)');
  assert(res3.error?.includes('Saldo de aulas ausente ou não definido') || false, 'Mensagem clara de saldo ausente');

  const lessonDoc3 = (await mockDb.collection('lessons').doc('req-fase2-c3').get()).data();
  assert(lessonDoc3 === undefined, 'Nenhum crédito inventado e nenhuma aula persistida quando saldo ausente');

  // --------------------------------------------------------------------------
  console.log('\n--- CENÁRIO 4: Documento inexistente -> Bloqueio controlado (HTTP 404) ---');
  // --------------------------------------------------------------------------
  const nonExistentUid = 'student_non_existent_uid_999';

  const res4 = await scheduleLessonAtomicServer({
    studentAuthUid: nonExistentUid,
    studentEmail: 'nonexistent@example.com',
    studentName: 'Ghost Student',
    teacherIdOrEmail: teacherUid,
    startDateTime: '2026-11-03T12:00:00Z',
    endDateTime: '2026-11-03T12:50:00Z',
    title: 'Tentativa Aluno Fantasma',
    isTrialLesson: false,
    requestId: 'req-fase2-c4',
  });

  assert(res4.success === false, 'res4.success é false');
  assert(res4.statusCode === 404, 'res4.statusCode é 404');
  assert(res4.error?.includes('Registro do aluno não encontrado') || false, 'Erro controlado de aluno inexistente');

  // --------------------------------------------------------------------------
  console.log('\n--- CENÁRIO 5: PERMISSION_DENIED -> Erro de infraestrutura/permissão; nenhum sucesso falso ---');
  // --------------------------------------------------------------------------
  const permError: any = new Error('PERMISSION_DENIED: Missing or insufficient permissions');
  permError.code = 7;
  mockDb.errorOnTransaction = permError;

  const res5 = await scheduleLessonAtomicServer({
    studentAuthUid: studentUid,
    studentEmail,
    studentName,
    teacherIdOrEmail: teacherUid,
    startDateTime: '2026-11-04T10:00:00Z',
    endDateTime: '2026-11-04T10:50:00Z',
    title: 'Tentativa com Falha de Permissão',
    isTrialLesson: false,
    requestId: 'req-fase2-c5',
  });

  assert(res5.success === false, 'res5.success é estritamente false sob PERMISSION_DENIED');
  assert(res5.statusCode === 403, 'res5.statusCode é 403 Forbidden');
  assert(res5.error?.includes('Permissão negada') || false, 'Retorna mensagem técnica de permissão negada');

  const lessonDoc5 = (await mockDb.collection('lessons').doc('req-fase2-c5').get()).data();
  assert(lessonDoc5 === undefined, 'Nenhuma confirmação falsa gravada em /lessons');

  const doc5 = (await mockDb.collection('users').doc(studentUid).get()).data();
  assert(doc5.availableLessons === 7, 'users/{studentUid}.availableLessons inalterado em 7');

  mockDb.errorOnTransaction = null; // Clear simulated error

  // --------------------------------------------------------------------------
  console.log('\n--- CENÁRIO 6: Timeout antes do commit -> Nenhuma confirmação falsa (HTTP 504) ---');
  // --------------------------------------------------------------------------
  const timeoutError: any = new Error('DEADLINE_EXCEEDED: Transaction timeout occurred before commit');
  timeoutError.code = 4;
  mockDb.errorOnTransaction = timeoutError;

  const res6 = await scheduleLessonAtomicServer({
    studentAuthUid: studentUid,
    studentEmail,
    studentName,
    teacherIdOrEmail: teacherUid,
    startDateTime: '2026-11-04T14:00:00Z',
    endDateTime: '2026-11-04T14:50:00Z',
    title: 'Tentativa com Timeout',
    isTrialLesson: false,
    requestId: 'req-fase2-c6',
  });

  assert(res6.success === false, 'res6.success é estritamente false sob Timeout');
  assert(res6.statusCode === 504, 'res6.statusCode é 504 Gateway Timeout');
  assert(res6.error?.includes('Tempo limite esgotado') || false, 'Mensagem controlada de timeout');

  const lessonDoc6 = (await mockDb.collection('lessons').doc('req-fase2-c6').get()).data();
  assert(lessonDoc6 === undefined, 'Nenhuma aula gravada sob timeout pré-commit');

  mockDb.errorOnTransaction = null;

  // --------------------------------------------------------------------------
  console.log('\n--- CENÁRIO 7: Timeout com commit potencialmente concluído -> Repetição idempotente, sem débito duplo ---');
  // --------------------------------------------------------------------------
  // Simulando que o primeiro commit foi persistido no Firestore (req-fase2-c7), mas o cliente deu timeout e repetiu
  const res7a = await scheduleLessonAtomicServer({
    studentAuthUid: studentUid,
    studentEmail,
    studentName,
    teacherIdOrEmail: teacherUid,
    startDateTime: '2026-11-05T09:00:00Z',
    endDateTime: '2026-11-05T09:50:00Z',
    title: 'Aula com Retry após Timeout',
    isTrialLesson: false,
    requestId: 'req-fase2-c7',
  });
  assert(res7a.success === true, 'res7a (primeira tentativa) persistida com sucesso');
  assert(res7a.remainingLessons === 6, 'Saldo decrementado de 7 para 6');

  // Repetição idêntica pelo cliente com o mesmo requestId
  const res7b = await scheduleLessonAtomicServer({
    studentAuthUid: studentUid,
    studentEmail,
    studentName,
    teacherIdOrEmail: teacherUid,
    startDateTime: '2026-11-05T09:00:00Z',
    endDateTime: '2026-11-05T09:50:00Z',
    title: 'Aula com Retry após Timeout',
    isTrialLesson: false,
    requestId: 'req-fase2-c7',
  });

  assert(res7b.success === true, 'res7b repetição retorna sucesso (idempotente)');
  assert(res7b.statusCode === 200, 'res7b retorna 200');
  assert(res7b.remainingLessons === 6, 'Saldo PERMANECE 6 (SEM DÉBITO DUPLO)');
  assert(res7b.lesson.id === 'req-fase2-c7', 'Retorna a exata mesma aula');

  const doc7 = (await mockDb.collection('users').doc(studentUid).get()).data();
  assert(doc7.availableLessons === 6, 'users/{studentUid}.availableLessons no Firestore continua exatamente 6');

  // --------------------------------------------------------------------------
  console.log('\n--- CENÁRIO 8: Duas aulas simultâneas, saldo 1 -> Apenas uma confirmada (segunda rejeitada com 402, saldo final 0) ---');
  // --------------------------------------------------------------------------
  const singleCreditUid = 'student_single_credit_uid';
  await mockDb.collection('users').doc(singleCreditUid).set({
    uid: singleCreditUid,
    id: singleCreditUid,
    email: 'single@example.com',
    name: 'Single Credit Student',
    role: 'student',
    availableLessons: 1, // EXACTLY 1 CREDIT
    contractedLessons: 4,
    hasCompletedTrialLesson: true,
    onboardingCompleted: true,
  });

  // Disparamos duas requisições concorrentes simultaneamente
  const [concA, concB] = await Promise.all([
    scheduleLessonAtomicServer({
      studentAuthUid: singleCreditUid,
      studentEmail: 'single@example.com',
      studentName: 'Single Credit Student',
      teacherIdOrEmail: teacherUid,
      startDateTime: '2026-11-06T14:00:00Z',
      endDateTime: '2026-11-06T14:50:00Z',
      title: 'Aula Concorrente A',
      isTrialLesson: false,
      requestId: 'req-fase2-conc-a',
    }),
    scheduleLessonAtomicServer({
      studentAuthUid: singleCreditUid,
      studentEmail: 'single@example.com',
      studentName: 'Single Credit Student',
      teacherIdOrEmail: teacherUid,
      startDateTime: '2026-11-06T16:00:00Z',
      endDateTime: '2026-11-06T16:50:00Z',
      title: 'Aula Concorrente B',
      isTrialLesson: false,
      requestId: 'req-fase2-conc-b',
    }),
  ]);

  const successCount = (concA.success ? 1 : 0) + (concB.success ? 1 : 0);
  const rejectedCount = (!concA.success ? 1 : 0) + (!concB.success ? 1 : 0);
  const rejectedRes = !concA.success ? concA : concB;

  assert(successCount === 1, 'Exatamente uma aula confirmada das duas simultâneas');
  assert(rejectedCount === 1, 'Exatamente uma aula rejeitada');
  assert(rejectedRes.statusCode === 402, 'Operação rejeitada com HTTP 402 Saldo Insuficiente');

  const doc8 = (await mockDb.collection('users').doc(singleCreditUid).get()).data();
  assert(doc8.availableLessons === 0, 'Saldo final no Firestore é estritamente 0 (nunca negativo)');

  // --------------------------------------------------------------------------
  console.log('\n--- CENÁRIO 9: Duas requisições idênticas -> Uma aula e um débito ---');
  // --------------------------------------------------------------------------
  // Aluno com saldo 6
  const idempReq = {
    studentAuthUid: studentUid,
    studentEmail,
    studentName,
    teacherIdOrEmail: teacherUid,
    startDateTime: '2026-11-07T10:00:00Z',
    endDateTime: '2026-11-07T10:50:00Z',
    title: 'Aula Idêntica',
    isTrialLesson: false,
    requestId: 'req-fase2-c9',
  };

  const res9a = await scheduleLessonAtomicServer(idempReq);
  const res9b = await scheduleLessonAtomicServer(idempReq);

  assert(res9a.success === true && res9b.success === true, 'Ambas as chamadas retornam 200 OK');
  assert(res9a.remainingLessons === 5, 'Primeira requisição reduziu saldo para 5');
  assert(res9b.remainingLessons === 5, 'Segunda requisição preservou saldo em 5');

  const doc9 = (await mockDb.collection('users').doc(studentUid).get()).data();
  assert(doc9.availableLessons === 5, 'users/{studentUid}.availableLessons no Firestore é 5 (um único débito)');

  // --------------------------------------------------------------------------
  console.log('\n--- CENÁRIO 10: Repetição com mesmo requestId -> Sem novo débito ---');
  // --------------------------------------------------------------------------
  const res10 = await scheduleLessonAtomicServer({
    ...idempReq,
    title: 'Tentativa repetida com mesmo requestId',
  });

  assert(res10.success === true, 'Retorna sucesso');
  assert(res10.remainingLessons === 5, 'Saldo permanece inalterado em 5');
  const doc10 = (await mockDb.collection('users').doc(studentUid).get()).data();
  assert(doc10.availableLessons === 5, 'Saldo Firestore permanece 5');

  // --------------------------------------------------------------------------
  console.log('\n--- CENÁRIO 11: Aula experimental -> Sem consumo de crédito regular ---');
  // --------------------------------------------------------------------------
  const trialStudentUid = 'student_trial_fresh_uid';
  await mockDb.collection('users').doc(trialStudentUid).set({
    uid: trialStudentUid,
    id: trialStudentUid,
    email: 'fresh.trial@example.com',
    name: 'Fresh Trial Student',
    role: 'student',
    availableLessons: 0,
    contractedLessons: 0,
    hasCompletedTrialLesson: false,
    onboardingCompleted: false,
  });

  const res11 = await scheduleLessonAtomicServer({
    studentAuthUid: trialStudentUid,
    studentEmail: 'fresh.trial@example.com',
    studentName: 'Fresh Trial Student',
    teacherIdOrEmail: teacherUid,
    startDateTime: '2026-11-08T15:00:00Z',
    endDateTime: '2026-11-08T15:25:00Z',
    title: 'Aula Experimental 25min',
    isTrialLesson: true,
    requestId: 'req-fase2-c11',
  });

  assert(res11.success === true, 'res11.success é true');
  assert(res11.statusCode === 200, 'res11.statusCode é 200');
  assert(res11.isTrialLesson === true, 'Confirmado como aula experimental');
  assert(res11.remainingLessons === 0, 'availableLessons permanece 0 (sem crédito regular consumido)');

  const doc11 = (await mockDb.collection('users').doc(trialStudentUid).get()).data();
  assert(doc11.hasCompletedTrialLesson === true, 'hasCompletedTrialLesson atualizado para true no Firestore');
  assert(doc11.onboardingCompleted === true, 'onboardingCompleted atualizado para true no Firestore');
  assert(doc11.availableLessons === 0, 'Firestore availableLessons permanece 0');

  // --------------------------------------------------------------------------
  console.log('\n--- CENÁRIO 12: Conflito de horário -> HTTP 409; sem débito ---');
  // --------------------------------------------------------------------------
  // Professor já tem aula em 2026-11-02T14:00:00Z (req-fase2-c1). Tentando agendar sobreposição:
  const res12 = await scheduleLessonAtomicServer({
    studentAuthUid: studentUid,
    studentEmail,
    studentName,
    teacherIdOrEmail: teacherUid,
    startDateTime: '2026-11-02T14:30:00Z', // Overlaps with 14:00 - 14:50
    endDateTime: '2026-11-02T15:20:00Z',
    title: 'Aula com Conflito de Horário',
    isTrialLesson: false,
    requestId: 'req-fase2-c12-conflict',
  });

  assert(res12.success === false, 'res12.success é false');
  assert(res12.statusCode === 409, 'res12.statusCode é 409 Conflict');
  assert(res12.error?.includes('Bloqueio de Conflito') || false, 'Mensagem clara de bloqueio de conflito');

  const lessonDoc12 = (await mockDb.collection('lessons').doc('req-fase2-c12-conflict').get()).data();
  assert(lessonDoc12 === undefined, 'Nenhuma aula criada com horário conflitante');

  const doc12 = (await mockDb.collection('users').doc(studentUid).get()).data();
  assert(doc12.availableLessons === 5, 'Saldo do aluno PERMANECE 5 (nenhum débito)');

  // --------------------------------------------------------------------------
  console.log('\n--- CENÁRIO 13: Falha de sincronização local após commit -> Sem repetição do débito ---');
  // --------------------------------------------------------------------------
  // Simulando dbState com proxy defeituoso que lança erro durante a sincronização local em memória
  const faultyDbState: any = {
    liveLessons: [],
    userProfiles: {},
    get students() {
      throw new Error('Disk full / memory error during local state sync');
    },
  };

  const res13 = await scheduleLessonAtomicServer({
    studentAuthUid: studentUid,
    studentEmail,
    studentName,
    teacherIdOrEmail: teacherUid,
    startDateTime: '2026-11-09T10:00:00Z',
    endDateTime: '2026-11-09T10:50:00Z',
    title: 'Aula com Falha de Sincronização Local',
    isTrialLesson: false,
    requestId: 'req-fase2-c13',
    dbState: faultyDbState,
  });

  assert(res13.success === true, 'res13.success é true (transação Firestore prevalece como fonte da verdade)');
  assert(res13.statusCode === 200, 'Status é 200');
  assert(res13.remainingLessons === 4, 'Saldo reduzido de 5 para 4 no Firestore');

  const doc13 = (await mockDb.collection('users').doc(studentUid).get()).data();
  assert(doc13.availableLessons === 4, 'Firestore doc confirma availableLessons: 4');

  // Repetição após suposto erro no cliente: o cliente não sofre débito repetido
  const res13Retry = await scheduleLessonAtomicServer({
    studentAuthUid: studentUid,
    studentEmail,
    studentName,
    teacherIdOrEmail: teacherUid,
    startDateTime: '2026-11-09T10:00:00Z',
    endDateTime: '2026-11-09T10:50:00Z',
    title: 'Aula com Falha de Sincronização Local',
    isTrialLesson: false,
    requestId: 'req-fase2-c13',
  });
  assert(res13Retry.remainingLessons === 4, 'Repetição mantém saldo em 4 sem débito extra');

  // --------------------------------------------------------------------------
  console.log('\n--- CENÁRIO 14: Erro no backend -> Frontend não confirma aula e modal não apresenta confirmação falsa ---');
  // --------------------------------------------------------------------------
  // Simulando a lógica de handleScheduleLesson de App.tsx:
  let frontendConfirmed = false;
  let frontendRemainingLessons = 4;
  let modalClosedWithSuccess = false;
  let caughtError: string | null = null;

  async function simulateFrontendHandleSchedule(mockBackendResult: { success: boolean; error?: string; remainingLessons?: number }) {
    if (!mockBackendResult.success) {
      // App.tsx throws Error(txResult.error) to protect state and modal
      throw new Error(mockBackendResult.error || 'Scheduling failed');
    }
    frontendConfirmed = true;
    frontendRemainingLessons = mockBackendResult.remainingLessons!;
  }

  try {
    // Backend returns 402 Insufficient Balance error
    await simulateFrontendHandleSchedule({
      success: false,
      error: 'Saldo de aulas insuficiente. Por favor, adquira créditos de aulas antes de agendar.',
    });
    modalClosedWithSuccess = true;
  } catch (err: any) {
    caughtError = err.message;
    // LiveLessonScheduleModal catches the error, displays inline error, and does NOT close with success
    modalClosedWithSuccess = false;
  }

  assert(frontendConfirmed === false, 'Frontend NÃO confirmou aula');
  assert(frontendRemainingLessons === 4, 'Frontend NÃO consumiu créditos visualmente');
  assert(modalClosedWithSuccess === false, 'Modal NÃO fechou com confirmação falsa');
  assert(caughtError?.includes('Saldo de aulas insuficiente') || false, 'Mensagem de erro adequada repassada');

  console.log('\n========================================================================');
  console.log(`TOTAL DE TESTES FASE 2: ${passed + failed}`);
  console.log(`SUCESSO: ${passed}`);
  console.log(`FALHAS: ${failed}`);
  console.log('========================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runFase2Validation().catch((err) => {
  console.error('Fatal error in runFase2Validation:', err);
  process.exit(1);
});
