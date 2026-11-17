/**
 * TEST SUITE: IT'S SIMPLE — FASE FIN.2B
 * Comissão individual obrigatória na aprovação de Native Friends
 *
 * Cobre integralmente os 13 cenários obrigatórios:
 * 1. Aprovação com 20%.
 * 2. Aprovação com 0% explícito.
 * 3. Rejeição de comissão ausente, vazia, negativa, acima de 100, NaN e Infinity.
 * 4. Bloqueio de aprovação via rotas alternativas (PUT /api/tutors/:id, POST /api/tutors, POST /api/teachers).
 * 5. Usuário não-admin tentando definir comissão.
 * 6. Persistência no UID canônico (tutors/{uid} e users/{uid}).
 * 7. Recarregamento preservando comissão.
 * 8. Atualização administrativa criando nova versão.
 * 9. Preservação do histórico imutável.
 * 10. Falhas parciais e concorrência (runTransaction).
 * 11. Ausência de comissão em DTOs públicos e visão do próprio professor.
 * 12. Professores antigos sem comissão (pendente de configuração financeira, configurável depois).
 * 13. Fluxos pedagógicos e motor financeiro não afetados + verificação estrutural frontend.
 */

process.env.NODE_ENV = 'test';
process.env.FIREBASE_PROJECT_ID = 'itissimple-security-staging';
process.env.FIREBASE_DATABASE_ID = '(default)';

import http from 'http';
import { AddressInfo } from 'net';
import fs from 'fs';
import path from 'path';
import { app, isPaymentsEnabled } from '../serverApp';
import { setFirebaseAdminAuthForTesting } from '../src/serverFirebaseAdmin';
import {
  setFirebaseAdminFirestoreForTesting,
  resetFirebaseAdminFirestoreForTesting,
} from '../src/serverFirestore';
import {
  validateAdminCommissionPercent,
  validateCommissionModel,
  hasValidPersistedCommission,
  isTutorCommercializable,
  ADMIN_COMMISSION_KEYS,
} from '../src/utils/tutorCommission';
import { consolidateTutorsList, mergeTutors } from '../src/utils/tutorConsolidation';
import { calculateFinancialPricingQuote } from '../src/utils/financialEngine';

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    console.log(`  ✅ PASS: ${testName}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${testName}${detail ? ` (${detail})` : ''}`);
    failed++;
  }
}

interface MockFirestoreOptions {
  failTransactionOnWrite?: boolean;
  failTransactionErrorMsg?: string;
}

function createTransactionalMockFirestore(
  initialStore: Record<string, any> = {},
  options: MockFirestoreOptions = {}
) {
  const store: Record<string, any> = {};
  for (const [k, v] of Object.entries(initialStore)) {
    store[k] = JSON.parse(JSON.stringify(v));
  }

  // Serializes transactions asynchronously to emulate real Firestore optimistic concurrency / lock behavior
  let txQueue = Promise.resolve();

  const makeDocRef = (col: string, id: string) => ({
    _path: `${col}/${id}`,
    id,
    get: async () => {
      const val = store[`${col}/${id}`];
      return {
        exists: Boolean(val),
        id,
        data: () => (val ? JSON.parse(JSON.stringify(val)) : undefined),
      };
    },
    set: async (data: any, opts?: any) => {
      if (options.failTransactionOnWrite) {
        throw new Error(options.failTransactionErrorMsg || 'Simulated Firestore write failure');
      }
      const prev = opts?.merge && store[`${col}/${id}`] ? store[`${col}/${id}`] : {};
      store[`${col}/${id}`] = JSON.parse(JSON.stringify({ ...prev, ...data }));
      return true;
    },
    delete: async () => {
      delete store[`${col}/${id}`];
      return true;
    },
  });

  const makeCollection = (col: string) => {
    const queryFilter = (filters: Array<{ field: string; val: any }>) => ({
      where: (field: string, _op: string, val: any) =>
        queryFilter([...filters, { field, val }]),
      limit: (_n: number) => queryFilter(filters),
      get: async () => {
        const docs: any[] = [];
        for (const [key, val] of Object.entries(store)) {
          if (!key.startsWith(`${col}/`) || !val) continue;
          const matches = filters.every((f) => val[f.field] === f.val);
          if (matches) {
            const docId = key.slice(col.length + 1);
            docs.push({
              id: docId,
              exists: true,
              data: () => JSON.parse(JSON.stringify(val)),
            });
          }
        }
        return {
          docs,
          empty: docs.length === 0,
          forEach: (cb: any) => docs.forEach(cb),
        };
      },
    });

    return {
      doc: (id: string) => makeDocRef(col, id),
      where: (field: string, _op: string, val: any) => queryFilter([{ field, val }]),
      get: async () => queryFilter([]).get(),
    };
  };

  const dbMock: any = {
    _store: store,
    collection: (col: string) => makeCollection(col),
    runTransaction: async (fn: (tx: any) => Promise<any>) => {
      const run = txQueue.then(async () => {
        const stagedWrites: Array<{ path: string; data: any; merge?: boolean }> = [];
        const tx = {
          get: async (docRef: any) => {
            const val = store[docRef._path];
            return {
              exists: Boolean(val),
              id: docRef.id,
              data: () => (val ? JSON.parse(JSON.stringify(val)) : undefined),
            };
          },
          set: (docRef: any, data: any, opts?: any) => {
            stagedWrites.push({ path: docRef._path, data, merge: opts?.merge });
          },
        };
        const result = await fn(tx);
        if (options.failTransactionOnWrite) {
          throw new Error(options.failTransactionErrorMsg || 'Simulated atomic commit failure');
        }
        // Atomic commit of all staged writes
        for (const w of stagedWrites) {
          const prev = w.merge && store[w.path] ? store[w.path] : {};
          store[w.path] = JSON.parse(JSON.stringify({ ...prev, ...w.data }));
        }
        return result;
      });
      txQueue = run.catch(() => {});
      return run;
    },
  };

  return dbMock;
}

const TOKENS = {
  ADMIN: 'admin-token-fin2b',
  TEACHER_A: 'teacher-a-token-fin2b',
  TEACHER_B: 'teacher-b-token-fin2b',
  STUDENT: 'student-token-fin2b',
};

const UIDS = {
  ADMIN: 'ADMIN_UID_FIN2B_000000000001',
  TEACHER_20: 'TEACHER_20_UID_0000000000002',
  TEACHER_0: 'TEACHER_0_UID_00000000000003',
  TEACHER_ALT: 'TEACHER_ALT_UID_000000000004',
  TEACHER_LEGACY: 'TEACHER_LEGACY_UID_000000005',
  TEACHER_FAIL: 'TEACHER_FAIL_UID_00000000006',
  TEACHER_POST: 'TEACHER_POST_UID_00000000007',
  TEACHER_LEGACY_ROUTE: 'TEACHER_LGCY_RT_0000000008',
  STUDENT_ONLY: 'STUDENT_ONLY_UID_00000000009',
};

function setupAuthMock() {
  setFirebaseAdminAuthForTesting({
    verifyIdToken: async (token: string) => {
      if (token === TOKENS.ADMIN) {
        return {
          uid: UIDS.ADMIN,
          email: 'adm.itissimple@gmail.com',
          role: 'admin',
          email_verified: true,
        };
      }
      if (token === TOKENS.TEACHER_A) {
        return {
          uid: UIDS.TEACHER_20,
          email: 'teacher20@example.com',
          role: 'teacher',
          email_verified: true,
        };
      }
      if (token === TOKENS.TEACHER_B) {
        return {
          uid: UIDS.TEACHER_ALT,
          email: 'teacheralt@example.com',
          role: 'teacher',
          email_verified: true,
        };
      }
      if (token === TOKENS.STUDENT) {
        return {
          uid: UIDS.STUDENT_ONLY,
          email: 'student.only@example.com',
          role: 'student',
          email_verified: true,
        };
      }
      throw new Error('Invalid token');
    },
    getUser: async (uid: string) => ({ uid }),
    getUserByEmail: async (email: string) => {
      if (email === 'teacher-post@example.com') return { uid: UIDS.TEACHER_POST, email };
      if (email === 'teacher-legacy-rt@example.com') return { uid: UIDS.TEACHER_LEGACY_ROUTE, email };
      throw new Error('User not found');
    },
  } as any);
}

async function runTests() {
  console.log('=========================================================================');
  console.log(' TEST SUITE: FASE FIN.2B — COMISSÃO INDIVIDUAL OBRIGATÓRIA NA APROVAÇÃO');
  console.log('=========================================================================\n');

  setupAuthMock();

  const initialFirestore: Record<string, any> = {
    [`tutors/${UIDS.TEACHER_20}`]: {
      id: UIDS.TEACHER_20,
      uid: UIDS.TEACHER_20,
      authUid: UIDS.TEACHER_20,
      publicTutorId: 'tutor-teacher20',
      email: 'teacher20@example.com',
      name: 'Teacher Twenty',
      role: 'teacher',
      pricePerSessionUsd: 25,
      availableDays: ['monday', 'wednesday'],
      approvalStatus: 'pending',
      isApproved: false,
      status: 'pending',
      approved: false,
    },
    [`tutors/${UIDS.TEACHER_0}`]: {
      id: UIDS.TEACHER_0,
      uid: UIDS.TEACHER_0,
      authUid: UIDS.TEACHER_0,
      publicTutorId: 'tutor-teacher0',
      email: 'teacher0@example.com',
      name: 'Teacher Zero Percent',
      role: 'teacher',
      pricePerSessionUsd: 30,
      availableDays: ['tuesday', 'thursday'],
      approvalStatus: 'pending',
      isApproved: false,
      status: 'pending',
      approved: false,
    },
    [`tutors/${UIDS.TEACHER_ALT}`]: {
      id: UIDS.TEACHER_ALT,
      uid: UIDS.TEACHER_ALT,
      authUid: UIDS.TEACHER_ALT,
      publicTutorId: 'tutor-alt-routes',
      email: 'teacheralt@example.com',
      name: 'Teacher Alternative Routes',
      role: 'teacher',
      pricePerSessionUsd: 18,
      availableDays: ['friday'],
      approvalStatus: 'pending',
      isApproved: false,
      status: 'pending',
      approved: false,
    },
    [`tutors/${UIDS.TEACHER_LEGACY}`]: {
      id: UIDS.TEACHER_LEGACY,
      uid: UIDS.TEACHER_LEGACY,
      authUid: UIDS.TEACHER_LEGACY,
      publicTutorId: 'tutor-legacy-approved',
      email: 'teacherlegacy@example.com',
      name: 'Teacher Legacy Approved',
      role: 'teacher',
      pricePerSessionUsd: 22,
      availableDays: ['monday'],
      approvalStatus: 'approved',
      isApproved: true,
      status: 'approved',
      approved: true,
      bio: 'Original legacy bio',
      // Sem comissão definida (pré-FIN.2B)
    },
    [`users/${UIDS.TEACHER_LEGACY}`]: {
      id: UIDS.TEACHER_LEGACY,
      uid: UIDS.TEACHER_LEGACY,
      authUid: UIDS.TEACHER_LEGACY,
      email: 'teacherlegacy@example.com',
      name: 'Teacher Legacy Approved',
      role: 'teacher',
      approvalStatus: 'approved',
      isApproved: true,
    },
    [`tutors/${UIDS.TEACHER_FAIL}`]: {
      id: UIDS.TEACHER_FAIL,
      uid: UIDS.TEACHER_FAIL,
      authUid: UIDS.TEACHER_FAIL,
      publicTutorId: 'tutor-fail-tx',
      email: 'teacherfail@example.com',
      name: 'Teacher Tx Fail',
      role: 'teacher',
      pricePerSessionUsd: 20,
      availableDays: ['monday'],
      approvalStatus: 'pending',
      isApproved: false,
      status: 'pending',
      approved: false,
    },
    [`users/${UIDS.STUDENT_ONLY}`]: {
      id: UIDS.STUDENT_ONLY,
      uid: UIDS.STUDENT_ONLY,
      email: 'student.only@example.com',
      name: 'Student Only',
      role: 'student',
    },
  };

  let activeMockFs = createTransactionalMockFirestore(initialFirestore);
  setFirebaseAdminFirestoreForTesting(activeMockFs);

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // -------------------------------------------------------------------------
    // CENÁRIO 3 (Unit + Route): Rejeição de comissão ausente, vazia, negativa, >100, NaN, Infinity e modelo inválido
    // -------------------------------------------------------------------------
    console.log('--- 3. Validação estrita: rejeição de comissão ausente, vazia, negativa, >100, NaN, Infinity ---');
    {
      const invalidCases: Array<[string, unknown]> = [
        ['undefined', undefined],
        ['null', null],
        ['string vazia', ''],
        ['espaços em branco', '   '],
        ['negativa -0.01', -0.01],
        ['negativa -20', -20],
        ['acima de 100 (100.01)', 100.01],
        ['acima de 100 (150)', 150],
        ['NaN', Number.NaN],
        ['Infinity', Number.POSITIVE_INFINITY],
        ['-Infinity', Number.NEGATIVE_INFINITY],
        ['string "NaN"', 'NaN'],
        ['string "Infinity"', 'Infinity'],
        ['boolean true', true],
        ['objeto {}', {}],
        ['string "20%"', '20%'],
      ];

      for (const [label, val] of invalidCases) {
        const res = validateAdminCommissionPercent(val);
        assert(!res.valid, `Helper rejeita comissão inválida (${label})`);
      }

      assert(validateAdminCommissionPercent(0).valid === true && (validateAdminCommissionPercent(0) as any).value === 0, 'Helper aceita 0 explícito');
      assert(validateAdminCommissionPercent(-0).valid === true && Object.is((validateAdminCommissionPercent(-0) as any).value, 0), 'Helper normaliza -0 para 0');
      assert(validateAdminCommissionPercent(100).valid === true && (validateAdminCommissionPercent(100) as any).value === 100, 'Helper aceita 100 explícito');
      assert(validateCommissionModel('MARKUP').valid === true, 'Modelo MARKUP aceito');
      assert(!validateCommissionModel('TAKE_RATE').valid, 'Modelo diferente de MARKUP rejeitado');

      // HTTP tests against POST /api/tutors/:id/approve
      const badPayloads: Array<[string, any]> = [
        ['ausente', {}],
        ['vazia ""', { adminCommissionPercent: '' }],
        ['null', { adminCommissionPercent: null }],
        ['negativa -5', { adminCommissionPercent: -5 }],
        ['acima de 100 (105)', { adminCommissionPercent: 105 }],
        ['string "NaN"', { adminCommissionPercent: 'NaN' }],
        ['string "Infinity"', { adminCommissionPercent: 'Infinity' }],
        ['modelo inválido TAKE_RATE', { adminCommissionPercent: 20, commissionModel: 'TAKE_RATE' }],
      ];

      for (const [label, body] of badPayloads) {
        const r = await fetch(`${baseUrl}/api/tutors/${UIDS.TEACHER_20}/approve`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${TOKENS.ADMIN}`,
          },
          body: JSON.stringify(body),
        });
        assert(r.status === 400, `POST /approve rejeita comissão ${label} com HTTP 400 (got ${r.status})`);
      }

      // Garante que teacher20 continuou pending no Firestore
      const docAfterRejects = activeMockFs._store[`tutors/${UIDS.TEACHER_20}`];
      assert(docAfterRejects.approvalStatus === 'pending' && docAfterRejects.isApproved === false, 'Professor permanece pending após rejeições de comissão');
      assert(docAfterRejects.adminCommissionPercent === undefined, 'Nenhuma comissão padrão/fallback foi gravada');
    }

    // -------------------------------------------------------------------------
    // CENÁRIO 1 & 6: Aprovação com 20% + persistência no UID canônico
    // -------------------------------------------------------------------------
    console.log('\n--- 1 & 6. Aprovação com 20% e persistência no UID canônico ---');
    {
      const r = await fetch(`${baseUrl}/api/tutors/${UIDS.TEACHER_20}/approve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${TOKENS.ADMIN}`,
        },
        body: JSON.stringify({
          adminCommissionPercent: 20,
          commissionModel: 'MARKUP',
        }),
      });
      const data = await r.json();
      assert(r.status === 200, `Aprovação com 20% retorna 200 OK (got ${r.status})`);
      assert(data.success === true, 'Resposta indica success=true');
      assert(data.approvedTutor?.adminCommissionPercent === 20, 'approvedTutor retorna adminCommissionPercent=20 para ADM');
      assert(data.approvedTutor?.commissionModel === 'MARKUP', 'approvedTutor retorna commissionModel=MARKUP');
      assert(data.approvedTutor?.commissionVersion === 1, 'commissionVersion inicial é 1');
      assert(data.approvedTutor?.updatedByUid === UIDS.ADMIN, 'updatedByUid registra UID canônico do ADM');
      assert(typeof data.approvedTutor?.effectiveFrom === 'string' && data.approvedTutor.effectiveFrom.length > 0, 'effectiveFrom preenchido');
      assert(typeof data.approvedTutor?.updatedAt === 'string' && data.approvedTutor.updatedAt.length > 0, 'updatedAt preenchido');
      assert(Array.isArray(data.approvedTutor?.commissionHistory) && data.approvedTutor.commissionHistory.length === 1, 'commissionHistory v1 registrado');

      // Verifica persistência exclusiva no UID canônico em Firestore tutors/{uid} e users/{uid}
      const fsTutor = activeMockFs._store[`tutors/${UIDS.TEACHER_20}`];
      const fsUser = activeMockFs._store[`users/${UIDS.TEACHER_20}`];
      assert(fsTutor?.uid === UIDS.TEACHER_20 && fsTutor?.adminCommissionPercent === 20, 'Persistido em tutors/{canonicalUid}');
      assert(fsUser?.uid === UIDS.TEACHER_20 && fsUser?.adminCommissionPercent === 20 && fsUser?.role === 'teacher', 'Persistido em users/{canonicalUid}');
      assert(activeMockFs._store[`users/${UIDS.STUDENT_ONLY}`]?.adminCommissionPercent === undefined, 'Nenhuma comissão gravada em documento de aluno');
    }

    // -------------------------------------------------------------------------
    // CENÁRIO 2: Aprovação com 0% explícito
    // -------------------------------------------------------------------------
    console.log('\n--- 2. Aprovação com 0% explícito ---');
    {
      const r = await fetch(`${baseUrl}/api/tutors/${UIDS.TEACHER_0}/approve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${TOKENS.ADMIN}`,
        },
        body: JSON.stringify({
          adminCommissionPercent: 0,
          commissionModel: 'MARKUP',
        }),
      });
      const data = await r.json();
      assert(r.status === 200, `Aprovação com 0% explícito retorna 200 OK (got ${r.status})`);
      assert(data.approvedTutor?.adminCommissionPercent === 0, '0% é preservado numericamente (não tratado como falsy)');
      assert(data.approvedTutor?.commissionModel === 'MARKUP', 'Modelo MARKUP mantido para 0%');
      assert(data.approvedTutor?.commissionVersion === 1, 'Versão 1 registrada para 0%');
      assert(data.approvedTutor?.isCommercializable === true, 'Professor aprovado com 0% explícito é comercializável');
      const fsTutor0 = activeMockFs._store[`tutors/${UIDS.TEACHER_0}`];
      assert(fsTutor0?.adminCommissionPercent === 0 && fsTutor0?.approvalStatus === 'approved', '0% persistido no Firestore');
    }

    // -------------------------------------------------------------------------
    // CENÁRIO 4: Bloqueio de aprovação via rotas alternativas
    // -------------------------------------------------------------------------
    console.log('\n--- 4. Bloqueio de aprovação via rotas alternativas ---');
    {
      // 4.1 PUT /api/tutors/:id tentando aprovar sem comissão
      const rPut = await fetch(`${baseUrl}/api/tutors/${UIDS.TEACHER_ALT}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${TOKENS.ADMIN}`,
        },
        body: JSON.stringify({
          approvalStatus: 'approved',
          isApproved: true,
        }),
      });
      assert(rPut.status === 400, `PUT /api/tutors/:id sem comissão bloqueia aprovação com 400 (got ${rPut.status})`);
      assert(activeMockFs._store[`tutors/${UIDS.TEACHER_ALT}`].approvalStatus === 'pending', 'PUT rejeitado manteve status pending');

      // 4.2 PUT /api/tutors/:id com isApproved: true apenas (bypass sem approvalStatus)
      const rPutFlag = await fetch(`${baseUrl}/api/tutors/${UIDS.TEACHER_ALT}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${TOKENS.ADMIN}`,
        },
        body: JSON.stringify({ isApproved: true }),
      });
      assert(rPutFlag.status === 400, `PUT /api/tutors/:id com isApproved=true sem comissão bloqueia com 400 (got ${rPutFlag.status})`);

      // 4.3 POST /api/tutors como admin tentando criar já aprovado sem comissão
      const rPostTutor = await fetch(`${baseUrl}/api/tutors`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${TOKENS.ADMIN}`,
        },
        body: JSON.stringify({
          uid: UIDS.TEACHER_POST,
          email: 'teacher-post@example.com',
          name: 'Teacher Post Direct',
          availableDays: ['monday'],
          approvalStatus: 'approved',
          isApproved: true,
          registeredByAdmin: true,
        }),
      });
      assert(rPostTutor.status === 400, `POST /api/tutors aprovado sem comissão bloqueia com 400 (got ${rPostTutor.status})`);
      assert(!activeMockFs._store[`tutors/${UIDS.TEACHER_POST}`], 'Nenhum registro aprovado criado após 400 em POST /api/tutors');

      // 4.4 POST /api/teachers (rota legada) tentando criar/ativar aprovado sem comissão
      const rPostLegacy = await fetch(`${baseUrl}/api/teachers`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${TOKENS.ADMIN}`,
        },
        body: JSON.stringify({
          uid: UIDS.TEACHER_LEGACY_ROUTE,
          email: 'teacher-legacy-rt@example.com',
          name: 'Teacher Legacy Route',
          approvalStatus: 'approved',
          isApproved: true,
        }),
      });
      assert(rPostLegacy.status === 400, `POST /api/teachers aprovado sem comissão bloqueia com 400 (got ${rPostLegacy.status})`);
      assert(!activeMockFs._store[`tutors/${UIDS.TEACHER_LEGACY_ROUTE}`], 'POST /api/teachers rejeitado não gravou professor aprovado');

      // 4.5 PUT /api/tutors/:id COM comissão válida (15%) aprova usando a mesma validação centralizada
      const rPutValid = await fetch(`${baseUrl}/api/tutors/${UIDS.TEACHER_ALT}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${TOKENS.ADMIN}`,
        },
        body: JSON.stringify({
          approvalStatus: 'approved',
          adminCommissionPercent: 15,
          commissionModel: 'MARKUP',
        }),
      });
      const putValidData = await rPutValid.json();
      assert(rPutValid.status === 200 && putValidData.tutor?.adminCommissionPercent === 15, 'PUT /api/tutors/:id com comissão válida (15%) aprova e versiona');
    }

    // -------------------------------------------------------------------------
    // CENÁRIO 5: Usuário não-admin tentando definir comissão
    // -------------------------------------------------------------------------
    console.log('\n--- 5. Usuário não-admin tentando definir comissão ---');
    {
      // Estudante tentando POST /approve
      const rStdApprove = await fetch(`${baseUrl}/api/tutors/${UIDS.TEACHER_20}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKENS.STUDENT}` },
        body: JSON.stringify({ adminCommissionPercent: 5 }),
      });
      assert(rStdApprove.status === 403, `Estudante tentando POST /approve recebe 403 (got ${rStdApprove.status})`);

      // Professor tentando PUT /commission
      const rTchComm = await fetch(`${baseUrl}/api/tutors/${UIDS.TEACHER_20}/commission`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKENS.TEACHER_A}` },
        body: JSON.stringify({ adminCommissionPercent: 1 }),
      });
      assert(rTchComm.status === 403, `Professor tentando PUT /commission recebe 403 (got ${rTchComm.status})`);

      // Professor tentando injetar adminCommissionPercent no próprio PUT /api/tutors/:id
      const rTchSelfPut = await fetch(`${baseUrl}/api/tutors/${UIDS.TEACHER_20}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKENS.TEACHER_A}` },
        body: JSON.stringify({ bio: 'Bio update attempt', adminCommissionPercent: 1 }),
      });
      assert(rTchSelfPut.status === 403, `Professor tentando alterar comissão via PUT /api/tutors/:id recebe 403 (got ${rTchSelfPut.status})`);
      assert(activeMockFs._store[`tutors/${UIDS.TEACHER_20}`].adminCommissionPercent === 20, 'Comissão original (20%) permanece intacta após tentativa não-admin');

      // Anônimo tentando POST /api/tutors com adminCommissionPercent
      const rAnonPost = await fetch(`${baseUrl}/api/tutors`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'sneaky@example.com',
          name: 'Sneaky Tutor',
          availableDays: ['monday'],
          adminCommissionPercent: 5,
        }),
      });
      assert(rAnonPost.status === 403, `Anônimo tentando definir adminCommissionPercent em POST /api/tutors recebe 403 (got ${rAnonPost.status})`);
    }

    // -------------------------------------------------------------------------
    // CENÁRIO 7: Recarregamento preservando comissão
    // -------------------------------------------------------------------------
    console.log('\n--- 7. Recarregamento preservando comissão ---');
    {
      const rAdminGet = await fetch(`${baseUrl}/api/tutors`, {
        headers: { Authorization: `Bearer ${TOKENS.ADMIN}` },
      });
      const adminList = await rAdminGet.json();
      const t20 = adminList.find((t: any) => t.uid === UIDS.TEACHER_20);
      const t0 = adminList.find((t: any) => t.uid === UIDS.TEACHER_0);
      assert(t20?.adminCommissionPercent === 20 && t20?.commissionVersion === 1, 'GET /api/tutors (admin) preserva 20% e v1 após recarga');
      assert(t0?.adminCommissionPercent === 0 && t0?.commissionModel === 'MARKUP', 'GET /api/tutors (admin) preserva 0% e MARKUP após recarga');

      // Consolidação e merge preservam 0% sem falsy fallback
      const consolidated = consolidateTutorsList([
        { id: UIDS.TEACHER_0, uid: UIDS.TEACHER_0, email: 'teacher0@example.com', name: 'Teacher Zero Percent', adminCommissionPercent: 0, commissionModel: 'MARKUP', commissionVersion: 1, updatedAt: '2026-11-17T00:00:00Z' },
        { id: UIDS.TEACHER_0, uid: UIDS.TEACHER_0, email: 'teacher0@example.com', name: 'Teacher Zero Percent', bio: 'Extra bio', updatedAt: '2026-11-16T00:00:00Z' },
      ]);
      assert(consolidated.length === 1 && consolidated[0].adminCommissionPercent === 0, 'consolidateTutorsList preserva adminCommissionPercent=0');

      const mergedZero = mergeTutors(
        { id: UIDS.TEACHER_0, uid: UIDS.TEACHER_0, adminCommissionPercent: 0, commissionVersion: 1 },
        { id: UIDS.TEACHER_0, uid: UIDS.TEACHER_0, headline: 'Updated' }
      );
      assert(mergedZero.adminCommissionPercent === 0, 'mergeTutors preserva 0% quando update omite campos administrativos');
    }

    // -------------------------------------------------------------------------
    // CENÁRIO 8 & 9: Atualização administrativa criando nova versão e preservando histórico
    // -------------------------------------------------------------------------
    console.log('\n--- 8 & 9. Atualização administrativa criando nova versão e preservando histórico imutável ---');
    {
      // v1 (20%) -> v2 (25%)
      const rV2 = await fetch(`${baseUrl}/api/tutors/${UIDS.TEACHER_20}/commission`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKENS.ADMIN}` },
        body: JSON.stringify({ adminCommissionPercent: 25, commissionModel: 'MARKUP' }),
      });
      const dV2 = await rV2.json();
      assert(rV2.status === 200 && dV2.tutor?.adminCommissionPercent === 25, 'Atualização para 25% retorna 200');
      assert(dV2.tutor?.commissionVersion === 2, 'Versão incrementada para v2');
      assert(dV2.tutor?.commissionHistory?.length === 2, 'Histórico contém 2 entradas');
      assert(dV2.tutor?.commissionHistory[0]?.adminCommissionPercent === 20 && dV2.tutor?.commissionHistory[0]?.version === 1, 'Versão 1 (20%) preservada intacta no histórico');
      assert(dV2.tutor?.commissionHistory[1]?.adminCommissionPercent === 25 && dV2.tutor?.commissionHistory[1]?.previousPercent === 20, 'Versão 2 (25%) aponta previousPercent=20');

      // v2 (25%) -> v3 (0%)
      const rV3 = await fetch(`${baseUrl}/api/tutors/${UIDS.TEACHER_20}/commission`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKENS.ADMIN}` },
        body: JSON.stringify({ adminCommissionPercent: 0, commissionModel: 'MARKUP' }),
      });
      const dV3 = await rV3.json();
      assert(rV3.status === 200 && dV3.tutor?.adminCommissionPercent === 0 && dV3.tutor?.commissionVersion === 3, 'Atualização para 0% cria v3');
      assert(dV3.tutor?.commissionHistory?.length === 3, 'Histórico imutável possui todas as 3 versões (20% -> 25% -> 0%)');

      // Endpoint GET /api/tutors/:id/commission-history (somente admin)
      const rHistAdmin = await fetch(`${baseUrl}/api/tutors/${UIDS.TEACHER_20}/commission-history`, {
        headers: { Authorization: `Bearer ${TOKENS.ADMIN}` },
      });
      const dHist = await rHistAdmin.json();
      assert(rHistAdmin.status === 200 && dHist.commissionHistory?.length === 3, 'GET /commission-history retorna histórico completo para ADM');

      const rHistTeacher = await fetch(`${baseUrl}/api/tutors/${UIDS.TEACHER_20}/commission-history`, {
        headers: { Authorization: `Bearer ${TOKENS.TEACHER_A}` },
      });
      assert(rHistTeacher.status === 403, 'GET /commission-history bloqueia professor com 403');
    }

    // -------------------------------------------------------------------------
    // CENÁRIO 11: Ausência de comissão em DTOs públicos e visão do próprio professor
    // -------------------------------------------------------------------------
    console.log('\n--- 11. Ausência de comissão em DTOs públicos e visão não-admin ---');
    {
      // Visitante anônimo
      const rAnon = await fetch(`${baseUrl}/api/tutors`);
      const listAnon = await rAnon.json();
      const leakedAnon = listAnon.some((t: any) =>
        ADMIN_COMMISSION_KEYS.some((k) => t[k] !== undefined)
      );
      assert(!leakedAnon && listAnon.length >= 2, 'Catálogo público anônimo NÃO expõe nenhum campo de comissão');

      // Aluno autenticado
      const rStd = await fetch(`${baseUrl}/api/tutors`, {
        headers: { Authorization: `Bearer ${TOKENS.STUDENT}` },
      });
      const listStd = await rStd.json();
      const leakedStd = listStd.some((t: any) =>
        ADMIN_COMMISSION_KEYS.some((k) => t[k] !== undefined)
      );
      assert(!leakedStd, 'Aluno autenticado NÃO recebe campos administrativos de comissão');

      // Próprio professor autenticado (teacher20)
      const rSelf = await fetch(`${baseUrl}/api/tutors`, {
        headers: { Authorization: `Bearer ${TOKENS.TEACHER_A}` },
      });
      const listSelf = await rSelf.json();
      const selfDoc = listSelf.find((t: any) => t.uid === UIDS.TEACHER_20);
      const leakedSelf = listSelf.some((t: any) =>
        ADMIN_COMMISSION_KEYS.some((k) => t[k] !== undefined)
      );
      assert(Boolean(selfDoc) && !leakedSelf, 'Professor consultando próprio perfil NÃO recebe comissão administrativa');
    }

    // -------------------------------------------------------------------------
    // CENÁRIO 12: Professores antigos sem comissão
    // -------------------------------------------------------------------------
    console.log('\n--- 12. Professores antigos sem comissão ---');
    {
      // 12.1 Listagem admin identifica pendente sem inventar valor
      const rAdm = await fetch(`${baseUrl}/api/tutors`, {
        headers: { Authorization: `Bearer ${TOKENS.ADMIN}` },
      });
      const admList = await rAdm.json();
      const legacyTutor = admList.find((t: any) => t.uid === UIDS.TEACHER_LEGACY);
      assert(legacyTutor?.approvalStatus === 'approved' && legacyTutor?.isApproved === true, 'Aprovação existente do professor legado NÃO foi revogada');
      assert(legacyTutor?.adminCommissionPercent === undefined, 'Nenhuma comissão automática ou padrão foi atribuída ao legado');
      assert(legacyTutor?.financialConfigurationPending === true, 'Professor antigo identificado com financialConfigurationPending=true');
      assert(legacyTutor?.isCommercializable === false, 'Comercialização bloqueada (isCommercializable=false) enquanto sem comissão');

      // 12.2 Edição de bio por ADM ou professor não inventa comissão nem revoga aprovação
      const rEditLegacyBio = await fetch(`${baseUrl}/api/tutors/${UIDS.TEACHER_LEGACY}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKENS.ADMIN}` },
        body: JSON.stringify({ bio: 'Updated legacy bio without commission' }),
      });
      const dEditLegacy = await rEditLegacyBio.json();
      assert(rEditLegacyBio.status === 200 && dEditLegacy.tutor?.approvalStatus === 'approved', 'Edição de perfil legado preserva aprovação');
      assert(dEditLegacy.tutor?.adminCommissionPercent === undefined && dEditLegacy.tutor?.financialConfigurationPending === true, 'Edição de bio legado não inventa comissão');

      // 12.3 Configuração administrativa posterior gera v1 sem revogar aprovação
      const rCfgLegacy = await fetch(`${baseUrl}/api/tutors/${UIDS.TEACHER_LEGACY}/commission`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKENS.ADMIN}` },
        body: JSON.stringify({ adminCommissionPercent: 18, commissionModel: 'MARKUP' }),
      });
      const dCfgLegacy = await rCfgLegacy.json();
      assert(rCfgLegacy.status === 200, 'Configuração posterior de comissão no legado retorna 200');
      assert(dCfgLegacy.tutor?.adminCommissionPercent === 18 && dCfgLegacy.tutor?.commissionVersion === 1, 'Configuração posterior gera v1 com 18%');
      assert(dCfgLegacy.tutor?.financialConfigurationPending === false && dCfgLegacy.tutor?.isCommercializable === true, 'Após configuração, legado torna-se comercializável');
      assert(dCfgLegacy.tutor?.approvalStatus === 'approved' && dCfgLegacy.tutor?.isApproved === true, 'Aprovação do legado mantida');

      // Atualização seguinte gera v2 preservando v1
      const rCfgLegacyV2 = await fetch(`${baseUrl}/api/tutors/${UIDS.TEACHER_LEGACY}/commission`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKENS.ADMIN}` },
        body: JSON.stringify({ adminCommissionPercent: 22, commissionModel: 'MARKUP' }),
      });
      const dCfgLegacyV2 = await rCfgLegacyV2.json();
      assert(dCfgLegacyV2.tutor?.commissionVersion === 2 && dCfgLegacyV2.tutor?.commissionHistory?.length === 2, 'Nova atualização no legado gera v2 preservando v1 no histórico');
    }

    // -------------------------------------------------------------------------
    // CENÁRIO 10: Falhas parciais e concorrência
    // -------------------------------------------------------------------------
    console.log('\n--- 10. Falhas parciais e concorrência ---');
    {
      // 10.1 Concorrência em duas atualizações simultâneas no mesmo professor
      const [c1, c2] = await Promise.all([
        fetch(`${baseUrl}/api/tutors/${UIDS.TEACHER_20}/commission`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKENS.ADMIN}` },
          body: JSON.stringify({ adminCommissionPercent: 30, commissionModel: 'MARKUP' }),
        }),
        fetch(`${baseUrl}/api/tutors/${UIDS.TEACHER_20}/commission`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKENS.ADMIN}` },
          body: JSON.stringify({ adminCommissionPercent: 35, commissionModel: 'MARKUP' }),
        }),
      ]);
      assert(c1.status === 200 && c2.status === 200, 'Atualizações concorrentes serializam com sucesso na transação');
      const finalTutor20 = activeMockFs._store[`tutors/${UIDS.TEACHER_20}`];
      assert(finalTutor20?.commissionVersion === 5 && finalTutor20?.commissionHistory?.length === 5, 'Nenhuma versão perdida sob concorrência (v3 -> v4 -> v5)');

      // 10.2 Falha parcial simulada no commit da transação Firestore durante aprovação
      const failingMockFs = createTransactionalMockFirestore(
        {
          [`tutors/${UIDS.TEACHER_FAIL}`]: initialFirestore[`tutors/${UIDS.TEACHER_FAIL}`],
        },
        { failTransactionOnWrite: true, failTransactionErrorMsg: 'Simulated partial commit failure' }
      );
      setFirebaseAdminFirestoreForTesting(failingMockFs);

      const rFail = await fetch(`${baseUrl}/api/tutors/${UIDS.TEACHER_FAIL}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKENS.ADMIN}` },
        body: JSON.stringify({ adminCommissionPercent: 20, commissionModel: 'MARKUP' }),
      });
      assert(rFail.status === 500, `Falha na transação retorna erro explícito 500 (got ${rFail.status})`);
      const storeFail = failingMockFs._store[`tutors/${UIDS.TEACHER_FAIL}`];
      assert(storeFail?.approvalStatus === 'pending' && storeFail?.isApproved === false, 'Rollback atômico: professor NÃO ficou aprovado após falha');
      assert(storeFail?.adminCommissionPercent === undefined, 'Rollback atômico: comissão NÃO foi parcialmente persistida');
      assert(!failingMockFs._store[`users/${UIDS.TEACHER_FAIL}`], 'Rollback atômico: users/{uid} NÃO foi criado/promovido');

      // Verifica também que listagem pública NÃO enxerga teacherfail como aprovado
      setFirebaseAdminFirestoreForTesting(activeMockFs);
      const rPublicCheck = await fetch(`${baseUrl}/api/tutors`);
      const publicAfterFail = await rPublicCheck.json();
      assert(!publicAfterFail.some((t: any) => t.id === UIDS.TEACHER_FAIL || t.name === 'Teacher Tx Fail'), 'Professor falho na transação não vaza no estado em memória nem catálogo público');
    }

    // -------------------------------------------------------------------------
    // CENÁRIO 13: Fluxos pedagógicos e motor financeiro não afetados + UI check
    // -------------------------------------------------------------------------
    console.log('\n--- 13. Fluxos pedagógicos, financialEngine, pagamentos desativados e UI ---');
    {
      assert(isPaymentsEnabled() === false, 'Pagamentos permanecem desativados');

      // Motor financeiro FIN.2A intacto
      const quote = calculateFinancialPricingQuote({
        basePriceUsd: 20,
        adminCommissionPercent: 20,
        ptaxRate: 5,
        commissionModel: 'MARKUP',
      });
      assert(
        quote.allInvariantsPassed &&
          quote.unit.finalPriceUsd === 24 &&
          quote.unit.finalPriceBrl === 120,
        'financialEngine.ts permanece intacto (20 USD + 20% MARKUP = 24 USD / 120 BRL)'
      );

      // Verificação estrutural na UI: sem pré-preenchimento padrão e enviando comissão explícita
      const modalContent = fs.readFileSync(path.join(process.cwd(), 'src/components/AdminApprovalsModal.tsx'), 'utf-8');
      const appContent = fs.readFileSync(path.join(process.cwd(), 'src/App.tsx'), 'utf-8');
      assert(
        modalContent.includes("commissionInputs[tutorKey] ?? ''") &&
        modalContent.includes('Comissão da Plataforma (%)'),
        'AdminApprovalsModal exibe campo obrigatório "Comissão da Plataforma (%)" vazio por padrão (sem pré-preenchimento)'
      );
      assert(
        modalContent.includes('inFlightIdsRef.current.has(tutor.id)'),
        'AdminApprovalsModal bloqueia envio duplicado durante aprovação'
      );
      assert(
        appContent.includes('adminCommissionPercent: commissionCheck.value') &&
        appContent.includes('commissionModel: ALLOWED_COMMISSION_MODEL'),
        'App.tsx transmite adminCommissionPercent e commissionModel=MARKUP explicitamente na aprovação'
      );
    }
  } finally {
    resetFirebaseAdminFirestoreForTesting();
    setFirebaseAdminAuthForTesting(null);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  console.log('\n=========================================================================');
  console.log(` TOTAL FIN.2B: ${passed} PASSED, ${failed} FAILED`);
  console.log('=========================================================================');

  if (failed > 0) {
    process.exit(1);
  }
  process.exit(0);
}

runTests().catch((err) => {
  console.error('Erro inesperado na suite FIN.2B:', err);
  process.exit(1);
});
