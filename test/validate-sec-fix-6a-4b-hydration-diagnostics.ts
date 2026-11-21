/**
 * SEC.FIX.6A.4B — Diagnóstico Confiável da Hidratação
 *
 * Valida exclusivamente a distinção implementada em src/serverFirestore.ts entre:
 * 1. Firestore lido com dados (`hydrated_with_data`)
 * 2. Firestore comprovadamente vazio (`confirmed_empty`)
 * 3. Falha, timeout ou leitura parcial (`failed_or_partial`)
 *
 * Cobre também:
 * - Regra obrigatória: nunca considerar banco vazio quando qualquer leitura obrigatória falhar.
 * - Falhas parciais em `users`, `tutors` (tanto /tutors quanto query role=='teacher' em /users)
 *   e em cada documento de `app_state/*` (main_data, routines, tutors, assignments, lessons, youtube_playlists).
 * - Timeouts (global e por fonte).
 * - Preservação integral da assinatura e comportamento de `fetchAppStateFromFirestore`
 *   e compatibilidade com `initCloudPersistence` e consumidores existentes.
 */

process.env.NODE_ENV = 'test';
process.env.FIREBASE_PROJECT_ID = 'itissimple-security-staging';
process.env.FIREBASE_DATABASE_ID = '(default)';

import assert from 'node:assert';
import type { Firestore } from 'firebase-admin/firestore';
import {
  fetchAppStateFromFirestore,
  fetchAppStateWithDiagnosticFromFirestore,
  getLastAppStateHydrationDiagnostic,
  fetchTutorsFromFirestore,
  fetchUsersFromFirestoreCanonical,
  setFirebaseAdminFirestoreForTesting,
  resetFirebaseAdminFirestoreForTesting,
  type FirestoreHydrationSourceName,
} from '../src/serverFirestore';
import {
  initCloudPersistence,
  readDb,
  resetInMemoryDbForTesting,
  resetResidualCachesForTesting,
} from '../serverApp';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`  ✅ PASS: ${name}`);
    passed++;
  } catch (err: any) {
    console.error(`  ❌ FAIL: ${name}`);
    console.error(`         ${err?.stack || err?.message || err}`);
    failed++;
  }
}

function deepClone<T>(val: T): T {
  return val === undefined ? val : JSON.parse(JSON.stringify(val));
}

function createDiagnosticMockFirestore() {
  const store = new Map<string, Record<string, any>>();
  const failRules = new Set<string>();
  const hangRules = new Set<string>();

  const matchesFailure = (target: string, rules: Set<string>) => {
    if (rules.has('*')) return true;
    if (rules.has(target)) return true;
    return false;
  };

  const getCollectionEntries = (colPath: string) => {
    const prefix = `${colPath}::`;
    const items: Array<{ id: string; data: Record<string, any> }> = [];
    for (const [k, v] of store.entries()) {
      if (k.startsWith(prefix)) {
        const id = k.slice(prefix.length);
        if (!id.includes('::') && !id.includes('/')) {
          items.push({ id, data: deepClone(v) });
        }
      }
    }
    return items;
  };

  const makeDocRef = (colPath: string, id: string): any => {
    const key = `${colPath}::${id}`;
    const docPath = `${colPath}/${id}`;
    return {
      id,
      path: docPath,
      get: async () => {
        if (matchesFailure(docPath, hangRules) || matchesFailure(colPath, hangRules)) {
          return new Promise(() => {});
        }
        if (matchesFailure(docPath, failRules) || matchesFailure(colPath, failRules)) {
          const err: any = new Error(`PERMISSION_DENIED: Simulated read error on ${docPath}`);
          err.code = 7;
          throw err;
        }
        const val = store.get(key);
        return {
          id,
          exists: Boolean(val),
          ref: makeDocRef(colPath, id),
          data: () => (val ? deepClone(val) : undefined),
        };
      },
      set: async (data: Record<string, any>) => {
        store.set(key, deepClone(data));
        return { writeTime: new Date() };
      },
      collection: (sub: string) => makeCollectionRef(`${colPath}/${id}/${sub}`),
    };
  };

  const makeQuery = (colPath: string, filters: Array<{ field: string; op: string; value: any }>) => ({
    where: (field: string, op: string, value: any) => makeQuery(colPath, [...filters, { field, op, value }]),
    limit: () => makeQuery(colPath, filters),
    get: async () => {
      const queryTarget =
        filters.length > 0
          ? `${colPath}?${filters.map((f) => `${f.field}${f.op}${f.value}`).join('&')}`
          : colPath;

      if (matchesFailure(queryTarget, hangRules) || matchesFailure(colPath, hangRules)) {
        return new Promise(() => {});
      }
      if (matchesFailure(queryTarget, failRules) || matchesFailure(colPath, failRules)) {
        const err: any = new Error(`Simulated query failure on ${queryTarget}`);
        err.code = 14;
        throw err;
      }

      const docs: any[] = [];
      for (const { id, data } of getCollectionEntries(colPath)) {
        const matchesAll = filters.every((f) => {
          const actual = data?.[f.field];
          if (f.op === '==') return actual === f.value;
          if (f.op === 'in' && Array.isArray(f.value)) return f.value.includes(actual);
          return false;
        });
        if (matchesAll) {
          docs.push({
            id,
            exists: true,
            ref: makeDocRef(colPath, id),
            data: () => deepClone(data),
          });
        }
      }
      return {
        empty: docs.length === 0,
        size: docs.length,
        docs,
        forEach: (cb: (d: any) => void) => docs.forEach(cb),
      };
    },
  });

  const makeCollectionRef = (colPath: string): any => ({
    doc: (id: string) => makeDocRef(colPath, id),
    where: (field: string, op: string, value: any) => makeQuery(colPath, [{ field, op, value }]),
    get: async () => makeQuery(colPath, []).get(),
  });

  return {
    projectId: 'itissimple-security-staging',
    databaseId: '(default)',
    collection: (col: string) => makeCollectionRef(col),
    _setDoc: (colPath: string, id: string, data: Record<string, any>) => {
      store.set(`${colPath}::${id}`, deepClone(data));
    },
    _clearAll: () => {
      store.clear();
      failRules.clear();
      hangRules.clear();
    },
    _setFailTargets: (targets: string[]) => {
      failRules.clear();
      targets.forEach((t) => failRules.add(t));
    },
    _setHangTargets: (targets: string[]) => {
      hangRules.clear();
      targets.forEach((t) => hangRules.add(t));
    },
  };
}

const STUDENT_UID = 'StudentCanonUidSecFix6a4b001';
const STUDENT_EMAIL = 'student.6a4b@itissimple.com';
const TUTOR_UID = 'TutorCanonUidSecFix6a4b0001';
const TUTOR_EMAIL = 'tutor.6a4b@itissimple.com';

function seedFullFirestoreData(mockFs: ReturnType<typeof createDiagnosticMockFirestore>) {
  mockFs._setDoc('users', STUDENT_UID, {
    id: STUDENT_UID,
    uid: STUDENT_UID,
    email: STUDENT_EMAIL,
    name: 'Student 6A4B',
    role: 'student',
    enrollmentStatus: 'active',
    createdAt: '2026-11-01T00:00:00.000Z',
  });
  mockFs._setDoc('tutors', TUTOR_UID, {
    id: TUTOR_UID,
    uid: TUTOR_UID,
    authUid: TUTOR_UID,
    email: TUTOR_EMAIL,
    name: 'Tutor 6A4B',
    role: 'teacher',
    approvalStatus: 'approved',
    isApproved: true,
    appliedAt: '2026-11-01T00:00:00.000Z',
    createdAt: '2026-11-01T00:00:00.000Z',
  });
  mockFs._setDoc('app_state', 'main_data', {
    landingContent: { heroBadge: 'SecFix6A4B Badge' },
  });
  mockFs._setDoc('app_state', 'routines', {
    routinesByDay: {
      monday: [{ id: 'adm-6a4b-mon', time: '08:00', activityName: 'Morning Listening' }],
    },
  });
  mockFs._setDoc('app_state', 'tutors', {
    teachers: [],
    tutorsList: [],
    deletedTutorIds: [],
    deletedTutorEmails: [],
  });
  mockFs._setDoc('app_state', 'assignments', {
    studentVideoAssignments: { [STUDENT_UID]: [{ videoId: 'abc12345678' }] },
  });
  mockFs._setDoc('app_state', 'lessons', {
    contractedLessons: { [STUDENT_UID]: 4 },
  });
  mockFs._setDoc('app_state', 'youtube_playlists', {
    playlists: [{ id: 'pl-1', title: 'Playlist 6A4B', videos: [] }],
  });
}

async function run() {
  console.log('\n=== SEC.FIX.6A.4B: Diagnóstico Confiável da Hidratação ===\n');

  const mockFs = createDiagnosticMockFirestore();
  setFirebaseAdminFirestoreForTesting(mockFs as unknown as Firestore);

  try {
    await test('1. Estado: Firestore lido com dados (hydrated_with_data)', async () => {
      mockFs._clearAll();
      seedFullFirestoreData(mockFs);

      const diag = await fetchAppStateWithDiagnosticFromFirestore();
      assert.strictEqual(diag.status, 'hydrated_with_data');
      assert.strictEqual(diag.hasData, true);
      assert.strictEqual(diag.isConfirmedEmpty, false);
      assert.strictEqual(diag.isPartialOrFailed, false);
      assert.strictEqual(diag.allRequiredReadsSucceeded, true);
      assert.strictEqual(diag.timedOut, false);
      assert.deepStrictEqual(diag.failedSources, []);
      assert.deepStrictEqual(diag.timedOutSources, []);
      assert.ok(diag.state && typeof diag.state === 'object');
      assert.strictEqual(diag.state.userProfiles?.[STUDENT_EMAIL]?.uid, STUDENT_UID);
      assert.strictEqual(diag.state.tutorsList?.[0]?.email, TUTOR_EMAIL);
      assert.strictEqual(diag.state.routinesByDay?.monday?.[0]?.id, 'adm-6a4b-mon');
      assert.strictEqual(diag.state.contractedLessons?.[STUDENT_UID], 4);
      assert.strictEqual(diag.state.youtubePlaylists?.[0]?.id, 'pl-1');

      // fetchAppStateFromFirestore preserves identical return value and records last diagnostic
      const legacyState = await fetchAppStateFromFirestore();
      assert.deepStrictEqual(legacyState, diag.state);
      assert.strictEqual(getLastAppStateHydrationDiagnostic()?.status, 'hydrated_with_data');
    });

    await test('2. Estado: Firestore comprovadamente vazio (confirmed_empty)', async () => {
      mockFs._clearAll();

      const diag = await fetchAppStateWithDiagnosticFromFirestore();
      assert.strictEqual(diag.status, 'confirmed_empty');
      assert.strictEqual(diag.state, null);
      assert.strictEqual(diag.hasData, false);
      assert.strictEqual(diag.isConfirmedEmpty, true);
      assert.strictEqual(diag.isPartialOrFailed, false);
      assert.strictEqual(diag.allRequiredReadsSucceeded, true);
      assert.strictEqual(diag.timedOut, false);
      assert.deepStrictEqual(diag.failedSources, []);
      assert.deepStrictEqual(diag.timedOutSources, []);

      for (const src of Object.values(diag.sources)) {
        assert.strictEqual(src.ok, true, `Fonte ${src.source} deve ter ok=true`);
        assert.strictEqual(src.empty, true, `Fonte ${src.source} deve ter empty=true`);
        assert.strictEqual(src.hasData, false, `Fonte ${src.source} deve ter hasData=false`);
      }

      const legacyState = await fetchAppStateFromFirestore();
      assert.strictEqual(legacyState, null);
      assert.strictEqual(getLastAppStateHydrationDiagnostic()?.status, 'confirmed_empty');
      assert.strictEqual(getLastAppStateHydrationDiagnostic()?.isConfirmedEmpty, true);
    });

    await test('3. Estado: Falha total (db null e falha global em todas as leituras)', async () => {
      // 3a. db === null
      setFirebaseAdminFirestoreForTesting(null);
      const noDbDiag = await fetchAppStateWithDiagnosticFromFirestore();
      assert.strictEqual(noDbDiag.status, 'failed_or_partial');
      assert.strictEqual(noDbDiag.state, null);
      assert.strictEqual(noDbDiag.isConfirmedEmpty, false);
      assert.strictEqual(noDbDiag.isPartialOrFailed, true);
      assert.strictEqual(noDbDiag.allRequiredReadsSucceeded, false);
      assert.strictEqual(noDbDiag.failedSources.length, 8);
      assert.strictEqual(await fetchAppStateFromFirestore(), null);

      // 3b. Global read failure across all collections/docs
      setFirebaseAdminFirestoreForTesting(mockFs as unknown as Firestore);
      mockFs._clearAll();
      mockFs._setFailTargets(['*']);

      const allFailDiag = await fetchAppStateWithDiagnosticFromFirestore();
      assert.strictEqual(allFailDiag.status, 'failed_or_partial');
      assert.strictEqual(allFailDiag.state, null);
      assert.strictEqual(allFailDiag.isConfirmedEmpty, false);
      assert.strictEqual(allFailDiag.isPartialOrFailed, true);
      assert.strictEqual(allFailDiag.allRequiredReadsSucceeded, false);
      assert.strictEqual(allFailDiag.failedSources.length, 8);
      assert.strictEqual(await fetchAppStateFromFirestore(), null);
      mockFs._setFailTargets([]);
    });

    await test('4. Falha parcial em users: nunca considera vazio e preserva retorno parcial quando há outros dados', async () => {
      // 4a. Demais fontes vazias + users falhando => NÃO pode ser confirmed_empty
      mockFs._clearAll();
      mockFs._setFailTargets(['users']);

      const emptyExceptUsersFail = await fetchAppStateWithDiagnosticFromFirestore();
      assert.strictEqual(emptyExceptUsersFail.status, 'failed_or_partial');
      assert.strictEqual(emptyExceptUsersFail.isConfirmedEmpty, false, 'Banco nunca é vazio quando users falha');
      assert.strictEqual(emptyExceptUsersFail.isPartialOrFailed, true);
      assert.strictEqual(emptyExceptUsersFail.allRequiredReadsSucceeded, false);
      assert.strictEqual(emptyExceptUsersFail.state, null);
      assert.ok(emptyExceptUsersFail.failedSources.includes('users'));
      assert.ok(emptyExceptUsersFail.failedSources.includes('tutors'), 'tutors também depende de query em users');

      // 4b. Demais fontes com dados + falha apenas na leitura canônica da coleção users
      mockFs._clearAll();
      seedFullFirestoreData(mockFs);
      mockFs._setFailTargets(['users']);

      const partialWithUsersFail = await fetchAppStateWithDiagnosticFromFirestore();
      assert.strictEqual(partialWithUsersFail.status, 'failed_or_partial');
      assert.strictEqual(partialWithUsersFail.isConfirmedEmpty, false);
      assert.strictEqual(partialWithUsersFail.isPartialOrFailed, true);
      assert.strictEqual(partialWithUsersFail.hasData, true);
      assert.ok(partialWithUsersFail.failedSources.includes('users'));
      assert.ok(partialWithUsersFail.state !== null, 'Estado parcial ainda é retornado para compatibilidade');
      assert.strictEqual(partialWithUsersFail.state.routinesByDay?.monday?.[0]?.id, 'adm-6a4b-mon');
      assert.deepStrictEqual(await fetchAppStateFromFirestore(), partialWithUsersFail.state);
      mockFs._setFailTargets([]);
    });

    await test('5. Falha parcial em tutors (coleção tutors e query users?role==teacher)', async () => {
      // 5a. Demais fontes vazias + coleção tutors falhando
      mockFs._clearAll();
      mockFs._setFailTargets(['tutors']);

      const diagEmptyTutorsFail = await fetchAppStateWithDiagnosticFromFirestore();
      assert.strictEqual(diagEmptyTutorsFail.status, 'failed_or_partial');
      assert.strictEqual(diagEmptyTutorsFail.isConfirmedEmpty, false, 'Banco nunca é vazio quando tutors falha');
      assert.strictEqual(diagEmptyTutorsFail.isPartialOrFailed, true);
      assert.deepStrictEqual(diagEmptyTutorsFail.failedSources, ['tutors']);
      assert.strictEqual(diagEmptyTutorsFail.state, null);

      // 5b. Demais fontes vazias + apenas query users?role==teacher falhando
      mockFs._clearAll();
      mockFs._setFailTargets(['users?role==teacher']);

      const diagTeacherQueryFail = await fetchAppStateWithDiagnosticFromFirestore();
      assert.strictEqual(diagTeacherQueryFail.status, 'failed_or_partial');
      assert.strictEqual(diagTeacherQueryFail.isConfirmedEmpty, false);
      assert.strictEqual(diagTeacherQueryFail.isPartialOrFailed, true);
      assert.deepStrictEqual(diagTeacherQueryFail.failedSources, ['tutors']);
      assert.strictEqual(diagTeacherQueryFail.sources.users.ok, true);
      assert.strictEqual(diagTeacherQueryFail.sources.tutors.ok, false);

      // 5c. Demais fontes com dados + tutors falhando => status failed_or_partial com estado parcial preservado
      mockFs._clearAll();
      seedFullFirestoreData(mockFs);
      mockFs._setFailTargets(['tutors']);

      const diagPartialTutors = await fetchAppStateWithDiagnosticFromFirestore();
      assert.strictEqual(diagPartialTutors.status, 'failed_or_partial');
      assert.strictEqual(diagPartialTutors.isConfirmedEmpty, false);
      assert.strictEqual(diagPartialTutors.isPartialOrFailed, true);
      assert.strictEqual(diagPartialTutors.hasData, true);
      assert.deepStrictEqual(diagPartialTutors.failedSources, ['tutors']);
      assert.strictEqual(diagPartialTutors.state?.userProfiles?.[STUDENT_EMAIL]?.uid, STUDENT_UID);
      mockFs._setFailTargets([]);
    });

    await test('6. Falha parcial em cada documento obrigatório de app_state/*', async () => {
      const appStateDocs: Array<{ docId: string; sourceName: FirestoreHydrationSourceName }> = [
        { docId: 'main_data', sourceName: 'app_state/main_data' },
        { docId: 'routines', sourceName: 'app_state/routines' },
        { docId: 'tutors', sourceName: 'app_state/tutors' },
        { docId: 'assignments', sourceName: 'app_state/assignments' },
        { docId: 'lessons', sourceName: 'app_state/lessons' },
        { docId: 'youtube_playlists', sourceName: 'app_state/youtube_playlists' },
      ];

      for (const { docId, sourceName } of appStateDocs) {
        // 6a. Banco vazio nas outras fontes + falha isolada em app_state/<docId> => nunca confirmed_empty
        mockFs._clearAll();
        mockFs._setFailTargets([`app_state/${docId}`]);

        const emptyFailDiag = await fetchAppStateWithDiagnosticFromFirestore();
        assert.strictEqual(emptyFailDiag.status, 'failed_or_partial', `${sourceName}: status deve ser failed_or_partial`);
        assert.strictEqual(emptyFailDiag.isConfirmedEmpty, false, `${sourceName}: não pode ser confirmed_empty`);
        assert.strictEqual(emptyFailDiag.isPartialOrFailed, true);
        assert.deepStrictEqual(emptyFailDiag.failedSources, [sourceName]);
        assert.strictEqual(emptyFailDiag.sources[sourceName].ok, false);
        assert.strictEqual(emptyFailDiag.state, null);

        // 6b. Outras fontes com dados + falha isolada em app_state/<docId> => partial read detectado + estado parcial preservado
        mockFs._clearAll();
        seedFullFirestoreData(mockFs);
        mockFs._setFailTargets([`app_state/${docId}`]);

        const dataFailDiag = await fetchAppStateWithDiagnosticFromFirestore();
        assert.strictEqual(dataFailDiag.status, 'failed_or_partial', `${sourceName} com dados: status failed_or_partial`);
        assert.strictEqual(dataFailDiag.isConfirmedEmpty, false);
        assert.strictEqual(dataFailDiag.isPartialOrFailed, true);
        assert.strictEqual(dataFailDiag.hasData, true);
        assert.deepStrictEqual(dataFailDiag.failedSources, [sourceName]);
        assert.ok(dataFailDiag.state !== null, `${sourceName}: estado parcial preservado`);
      }
      mockFs._setFailTargets([]);
    });

    await test('7. Timeout global e timeout por fonte (nunca classificado como vazio)', async () => {
      // 7a. Hang em app_state/routines dispara timeout global
      mockFs._clearAll();
      mockFs._setHangTargets(['app_state/routines']);

      const docTimeoutDiag = await fetchAppStateWithDiagnosticFromFirestore({ timeoutMs: 80 });
      assert.strictEqual(docTimeoutDiag.status, 'failed_or_partial');
      assert.strictEqual(docTimeoutDiag.timedOut, true);
      assert.strictEqual(docTimeoutDiag.isConfirmedEmpty, false);
      assert.strictEqual(docTimeoutDiag.isPartialOrFailed, true);
      assert.strictEqual(docTimeoutDiag.state, null);
      assert.ok(docTimeoutDiag.timedOutSources.includes('app_state/routines'));
      assert.ok(docTimeoutDiag.failedSources.includes('app_state/routines'));

      // 7b. Hang em tutors dispara timeout em tutors
      mockFs._clearAll();
      mockFs._setHangTargets(['tutors']);

      const tutorsTimeoutDiag = await fetchAppStateWithDiagnosticFromFirestore({ timeoutMs: 80 });
      assert.strictEqual(tutorsTimeoutDiag.status, 'failed_or_partial');
      assert.strictEqual(tutorsTimeoutDiag.timedOut, true);
      assert.strictEqual(tutorsTimeoutDiag.isConfirmedEmpty, false);
      assert.ok(tutorsTimeoutDiag.timedOutSources.includes('tutors'));
      assert.ok(tutorsTimeoutDiag.failedSources.includes('tutors'));

      // 7c. Hang em users dispara timeout em users e tutors
      mockFs._clearAll();
      mockFs._setHangTargets(['users']);

      const usersTimeoutDiag = await fetchAppStateWithDiagnosticFromFirestore({ timeoutMs: 80 });
      assert.strictEqual(usersTimeoutDiag.status, 'failed_or_partial');
      assert.strictEqual(usersTimeoutDiag.timedOut, true);
      assert.strictEqual(usersTimeoutDiag.isConfirmedEmpty, false);
      assert.ok(usersTimeoutDiag.timedOutSources.includes('users'));
      mockFs._setHangTargets([]);
    });

    await test('8. Compatibilidade integral com consumidores existentes (fetchTutorsFromFirestore, fetchUsersFromFirestoreCanonical, initCloudPersistence)', async () => {
      mockFs._clearAll();
      seedFullFirestoreData(mockFs);
      resetInMemoryDbForTesting();
      resetResidualCachesForTesting();

      // Contratos auxiliares preservados
      const tutors = await fetchTutorsFromFirestore();
      assert.strictEqual(tutors.length, 1);
      assert.strictEqual(tutors[0].email, TUTOR_EMAIL);

      const usersRes = await fetchUsersFromFirestoreCanonical();
      assert.strictEqual(usersRes.ok, true);
      assert.strictEqual(usersRes.users.length, 1);
      assert.strictEqual(usersRes.users[0].email, STUDENT_EMAIL);

      // initCloudPersistence no serverApp.ts continua hidratando normalmente
      await initCloudPersistence();
      const memDb = readDb();
      assert.strictEqual(memDb.userProfiles?.[STUDENT_EMAIL]?.uid, STUDENT_UID);
      assert.strictEqual(memDb.routinesByDay?.monday?.[0]?.id, 'adm-6a4b-mon');
      assert.strictEqual(memDb.tutorsList?.[0]?.email, TUTOR_EMAIL);
      assert.strictEqual(getLastAppStateHydrationDiagnostic()?.status, 'hydrated_with_data');
    });
  } finally {
    resetFirebaseAdminFirestoreForTesting();
    resetInMemoryDbForTesting();
    resetResidualCachesForTesting();
  }

  console.log(`\nResumo SEC.FIX.6A.4B: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('Fatal error in validate-sec-fix-6a-4b:', err);
  process.exit(1);
});
