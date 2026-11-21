/**
 * SEC.FIX.6A.2 — Proteção contra Sobrescrita do Template ADM
 *
 * Valida:
 * 1. Inicialização sem hidratação (ou após falha/omissão de hidratação de app_state/routines):
 *    saveAppStateToFirestore / writeDb / writeDbSync não sobrescrevem app_state/routines.routinesByDay
 *    com defaultRoutinesByDay, objeto vazio {} ou RAM não hidratada/desatualizada.
 * 2. Preservação do template existente do ADM no Firestore (default), incluindo dias customizados
 *    e ausência de dias removidos (sem reintroduzir dias de defaultRoutinesByDay via merge).
 * 3. Gravações legítimas de saveAppStateToFirestore preservadas, incluindo campos irmãos em
 *    app_state/routines (studentRoutinesMap, studentCurrentRoutines, weeklyNativeTargets, updatedAt)
 *    e demais documentos (main_data, tutors, assignments, lessons, youtube_playlists).
 * 4. Reinício simulado completo com GET/POST /api/routines: template canônico do ADM sobrevive
 *    a reinício + gravações concorrentes/não hidratadas de saveAppStateToFirestore e writeDbSync.
 */

process.env.NODE_ENV = 'test';
process.env.FIREBASE_PROJECT_ID = 'itissimple-security-staging';
process.env.FIREBASE_DATABASE_ID = '(default)';

import assert from 'node:assert';
import http from 'node:http';
import type { Firestore } from 'firebase-admin/firestore';
import {
  app as serverApp,
  readDb,
  writeDbSync,
  initCloudPersistence,
  resetInMemoryDbForTesting,
  resetResidualCachesForTesting,
} from '../serverApp';
import { setFirebaseAdminAuthForTesting, resetFirebaseAdminForTesting } from '../src/serverFirebaseAdmin';
import {
  setFirebaseAdminFirestoreForTesting,
  resetFirebaseAdminFirestoreForTesting,
  setIsCloudWriteDisabled,
  saveAppStateToFirestore,
  fetchAppStateFromFirestore,
} from '../src/serverFirestore';
import { defaultRoutinesByDay } from '../src/data/defaultRoutines';

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

function deepMergeFirestore(target: Record<string, any>, source: Record<string, any>): Record<string, any> {
  const out = { ...target };
  for (const [k, v] of Object.entries(source)) {
    if (
      v &&
      typeof v === 'object' &&
      !Array.isArray(v) &&
      out[k] &&
      typeof out[k] === 'object' &&
      !Array.isArray(out[k])
    ) {
      out[k] = deepMergeFirestore(out[k], v);
    } else {
      out[k] = deepClone(v);
    }
  }
  return out;
}

function createRealisticMockFirestore() {
  const store = new Map<string, Record<string, any>>();
  let failOnReadDoc: string | null = null;
  let failOnWriteCol: string | null = null;

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

  const makeQuery = (colPath: string, filters: Array<{ field: string; op: string; value: any }>) => ({
    where: (field: string, op: string, value: any) => makeQuery(colPath, [...filters, { field, op, value }]),
    limit: () => makeQuery(colPath, filters),
    get: async () => {
      const docs: any[] = [];
      for (const { id, data } of getCollectionEntries(colPath)) {
        const matchesAll = filters.every((f) => {
          const actual = data?.[f.field];
          if (f.op === '==') return actual === f.value;
          if (f.op === 'in' && Array.isArray(f.value)) return f.value.includes(actual);
          if (f.op === 'array-contains' && Array.isArray(actual)) return actual.includes(f.value);
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
      return { empty: docs.length === 0, size: docs.length, docs, forEach: (cb: any) => docs.forEach(cb) };
    },
  });

  const makeCollectionRef = (colPath: string): any => ({
    doc: (id: string) => makeDocRef(colPath, id),
    where: (field: string, op: string, value: any) => makeQuery(colPath, [{ field, op, value }]),
    get: async () => makeQuery(colPath, []).get(),
  });

  const makeDocRef = (colPath: string, id: string): any => {
    const key = `${colPath}::${id}`;
    const docPath = `${colPath}/${id}`;
    return {
      id,
      path: docPath,
      get: async () => {
        if (failOnReadDoc && (docPath === failOnReadDoc || colPath === failOnReadDoc || failOnReadDoc === '*')) {
          throw new Error(`Simulated Firestore read error on ${docPath}`);
        }
        const val = store.get(key);
        return {
          id,
          exists: Boolean(val),
          ref: makeDocRef(colPath, id),
          data: () => (val ? deepClone(val) : undefined),
        };
      },
      set: async (data: Record<string, any>, opts?: { merge?: boolean }) => {
        if (failOnWriteCol && (colPath === failOnWriteCol || failOnWriteCol === '*')) {
          throw new Error(`Simulated Firestore set error on ${docPath}`);
        }
        if (opts?.merge) {
          const prev = store.get(key) || {};
          store.set(key, deepMergeFirestore(prev, data));
        } else {
          store.set(key, deepClone(data));
        }
        return { writeTime: new Date() };
      },
      update: async (data: Record<string, any>) => {
        if (failOnWriteCol && (colPath === failOnWriteCol || failOnWriteCol === '*')) {
          throw new Error(`Simulated Firestore update error on ${docPath}`);
        }
        const prev = store.get(key);
        if (!prev) throw new Error(`NOT_FOUND: ${docPath}`);
        store.set(key, deepClone({ ...prev, ...data }));
        return { writeTime: new Date() };
      },
      delete: async () => {
        store.delete(key);
        return { writeTime: new Date() };
      },
      collection: (sub: string) => makeCollectionRef(`${colPath}/${id}/${sub}`),
    };
  };

  return {
    projectId: 'itissimple-security-staging',
    databaseId: '(default)',
    collection: (col: string) => makeCollectionRef(col),
    _setDoc: (colPath: string, id: string, data: Record<string, any>) => {
      store.set(`${colPath}::${id}`, deepClone(data));
    },
    _getDoc: (colPath: string, id: string) => deepClone(store.get(`${colPath}::${id}`)),
    _clearAll: () => {
      store.clear();
      failOnReadDoc = null;
      failOnWriteCol = null;
    },
    _setFailOnRead: (target: string | null) => {
      failOnReadDoc = target;
    },
    _setFailOnWrite: (col: string | null) => {
      failOnWriteCol = col;
    },
  };
}

function makeRequest(
  server: http.Server,
  method: string,
  reqPath: string,
  body?: any,
  headers: Record<string, string> = {}
): Promise<{ status: number; data: any }> {
  return new Promise((resolve, reject) => {
    const addr = server.address() as any;
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: addr.port,
        path: reqPath,
        method,
        headers: {
          Connection: 'close',
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
          ...headers,
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => (raw += chunk));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode || 0, data: raw ? JSON.parse(raw) : null });
          } catch {
            resolve({ status: res.statusCode || 0, data: raw });
          }
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const ADMIN_UID = 'adminUidSecFix6a20000000001';
const ADMIN_EMAIL = 'admin.secfix6a2@itissimple.com';
const STUDENT_UID = 'studentUidSecFix6a2000000001';
const STUDENT_EMAIL = 'student.secfix6a2@itissimple.com';

const CANONICAL_ADM_TEMPLATE: Record<string, any> = {
  monday: [
    {
      id: 'adm-mon-canonical',
      dayOfWeek: 'monday',
      dayType: 'weekdays',
      time: '07:15',
      activityName: 'Canonical ADM Monday',
      category: 'morning',
      isMandatory: true,
      teacherVideos: [],
      teacherNotes: 'Canonical note',
      learnedWords: [],
      completedToday: false,
    },
  ],
  wednesday: [
    {
      id: 'adm-wed-canonical',
      dayOfWeek: 'wednesday',
      dayType: 'weekdays',
      time: '19:30',
      activityName: 'Canonical ADM Wednesday',
      category: 'evening',
      isMandatory: false,
      teacherVideos: [],
      teacherNotes: '',
      learnedWords: [],
      completedToday: false,
    },
  ],
};

function setupCanonicalSeed(mockFs: ReturnType<typeof createRealisticMockFirestore>) {
  resetInMemoryDbForTesting();
  resetResidualCachesForTesting();
  setIsCloudWriteDisabled(false);
  mockFs._clearAll();

  mockFs._setDoc('users', STUDENT_UID, {
    id: STUDENT_UID,
    uid: STUDENT_UID,
    email: STUDENT_EMAIL,
    name: 'Student SecFix6A2',
    role: 'student',
    enrollmentStatus: 'active',
    weeklyCycle: 1,
  });

  mockFs._setDoc('app_state', 'tutors', {
    teachers: [{ id: ADMIN_UID, uid: ADMIN_UID, email: ADMIN_EMAIL, role: 'admin', name: 'Admin SecFix6A2' }],
    tutorsList: [],
    deletedTutorIds: [],
    deletedTutorEmails: [],
  });

  mockFs._setDoc('app_state', 'routines', {
    routinesByDay: deepClone(CANONICAL_ADM_TEMPLATE),
    weeklyNativeTargets: { [STUDENT_UID]: 4 },
    studentRoutinesMap: {
      [STUDENT_UID]: {
        monday: [{ id: 'stu-existing', time: '09:00', activityName: 'Existing Student Routine' }],
      },
    },
  });
}

async function run() {
  console.log('\n=== SEC.FIX.6A.2: Proteção contra Sobrescrita do Template ADM ===\n');

  const mockFs = createRealisticMockFirestore();
  setFirebaseAdminFirestoreForTesting(mockFs as unknown as Firestore);
  setFirebaseAdminAuthForTesting({
    verifyIdToken: async (token: string) => {
      if (token === 'tok-admin') {
        return { uid: ADMIN_UID, email: ADMIN_EMAIL, email_verified: true, role: 'admin', admin: true };
      }
      if (token === 'tok-student') {
        return { uid: STUDENT_UID, email: STUDENT_EMAIL, email_verified: true, role: 'student' };
      }
      throw new Error('Invalid token');
    },
  } as any);

  const server = http.createServer(serverApp);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));

  try {
    await test('1. Inicialização sem hidratação (RAM padrão/vazia) não sobrescreve app_state/routines.routinesByDay', async () => {
      setupCanonicalSeed(mockFs);

      // RAM is freshly reset and unhydrated -> readDb().routinesByDay equals defaultRoutinesByDay
      const unhydratedRam = readDb();
      assert.strictEqual(unhydratedRam.routinesByDay?.monday?.[0]?.id, defaultRoutinesByDay.monday[0].id);

      // Direct saveAppStateToFirestore from unhydrated RAM
      const ok1 = await saveAppStateToFirestore(unhydratedRam);
      assert.strictEqual(ok1, true);

      // Direct saveAppStateToFirestore with empty/omitted routinesByDay
      const ok2 = await saveAppStateToFirestore({
        routinesByDay: {},
        landingContent: { heroBadge: 'Badge Updated Unhydrated' },
      });
      assert.strictEqual(ok2, true);

      // Canonical ADM template in Firestore must remain 100% intact (no default days added, no overwrite)
      const fsRoutines = mockFs._getDoc('app_state', 'routines');
      assert.deepStrictEqual(
        fsRoutines?.routinesByDay,
        CANONICAL_ADM_TEMPLATE,
        'app_state/routines.routinesByDay deve permanecer idêntico ao template canônico do ADM'
      );
      assert.strictEqual(fsRoutines?.routinesByDay?.tuesday, undefined, 'Dias ausentes no template ADM não podem ser reinseridos');
    });

    await test('2. Falha parcial de hidratação no boot + writeDbSync não sobrescreve template canônico do ADM', async () => {
      setupCanonicalSeed(mockFs);

      // Simulate transient read failure specifically on app_state/routines during boot hydration
      mockFs._setFailOnRead('app_state/routines');
      await initCloudPersistence();
      mockFs._setFailOnRead(null);

      // RAM fell back to defaultRoutinesByDay while isCloudHydrated became true
      assert.strictEqual(readDb().routinesByDay?.monday?.[0]?.id, defaultRoutinesByDay.monday[0].id);

      // Subsequent legitimate writeDbSync (e.g. updating landingContent or studentWeeklyChecks)
      const db = readDb();
      db.landingContent = { ...(db.landingContent || {}), heroBadge: 'Saved After Partial Hydration' };
      db.weeklyNativeTargets = { ...(db.weeklyNativeTargets || {}), [STUDENT_UID]: 6 };
      await writeDbSync(db);

      // Wait small tick for background saveAppStateToFirestore promise inside writeDbSync
      await new Promise((r) => setTimeout(r, 50));

      const fsRoutines = mockFs._getDoc('app_state', 'routines');
      assert.deepStrictEqual(
        fsRoutines?.routinesByDay,
        CANONICAL_ADM_TEMPLATE,
        'writeDbSync após hidratação parcial nunca pode sobrescrever app_state/routines.routinesByDay'
      );
      assert.strictEqual(
        fsRoutines?.weeklyNativeTargets?.[STUDENT_UID],
        6,
        'Campo irmão weeklyNativeTargets deve continuar sendo persistido normalmente'
      );
      assert.strictEqual(
        mockFs._getDoc('app_state', 'main_data')?.landingContent?.heroBadge,
        'Saved After Partial Hydration',
        'app_state/main_data deve continuar sendo persistido normalmente'
      );
    });

    await test('3. Preservação integral de todas as gravações legítimas e campos irmãos de saveAppStateToFirestore', async () => {
      setupCanonicalSeed(mockFs);

      const saved = await saveAppStateToFirestore({
        routinesByDay: deepClone(defaultRoutinesByDay),
        studentRoutinesMap: {
          [STUDENT_UID]: { monday: [{ id: 'stu-updated', time: '10:00', activityName: 'Student Updated' }] },
        },
        studentCurrentRoutines: {
          [STUDENT_UID]: { dayOfWeek: 'monday', activityId: 'stu-updated' },
        },
        weeklyNativeTargets: { [STUDENT_UID]: 7 },
        landingContent: { heroBadge: 'Legitimate Sibling Save' },
        spotifyPlaylists: { beginner: { id: 'sp-beg' } },
        deletedStudentEmails: ['purged@example.com'],
        tutorsList: [],
        teachers: [{ id: ADMIN_UID, uid: ADMIN_UID, email: ADMIN_EMAIL, role: 'admin' }],
        deletedTutorEmails: ['removed-tutor@example.com'],
        deletedTutorIds: ['removed-tutor-id'],
        studentVideoAssignments: { [STUDENT_UID]: [{ videoId: 'dQw4w9WgXcQ' }] },
        studentSpotifyAssignments: { [STUDENT_UID]: [{ trackId: 'tr-1' }] },
        studentWatchedVideos: { [STUDENT_UID]: ['dQw4w9WgXcQ'] },
        studentListenedTracks: { [STUDENT_UID]: ['tr-1'] },
        studentAwaitingTopicSelection: { [STUDENT_UID]: true },
        weeklyStudyDays: { [STUDENT_UID]: ['monday', 'wednesday'] },
        weeklyStudyDaysTargets: { [STUDENT_UID]: 2 },
        contractedLessons: { [STUDENT_UID]: 8 },
        youtubePlaylists: [{ id: 'yt-1', title: 'Playlist 1', videos: [{ id: 'v1' }] }],
      });
      assert.strictEqual(saved, true);

      // 3a. app_state/routines preserves canonical ADM template and updates all sibling fields
      const fsRoutines = mockFs._getDoc('app_state', 'routines');
      assert.deepStrictEqual(fsRoutines?.routinesByDay, CANONICAL_ADM_TEMPLATE, 'routinesByDay canônico preservado');
      assert.strictEqual(
        fsRoutines?.studentRoutinesMap?.[STUDENT_UID]?.monday?.[0]?.id,
        'stu-updated',
        'studentRoutinesMap atualizado'
      );
      assert.strictEqual(
        fsRoutines?.studentCurrentRoutines?.[STUDENT_UID]?.activityId,
        'stu-updated',
        'studentCurrentRoutines atualizado'
      );
      assert.strictEqual(fsRoutines?.weeklyNativeTargets?.[STUDENT_UID], 7, 'weeklyNativeTargets atualizado');
      assert.ok(typeof fsRoutines?.updatedAt === 'string' && fsRoutines.updatedAt.length > 0, 'updatedAt gravado');

      // 3b. All other app_state docs persisted legitimately
      const fsMain = mockFs._getDoc('app_state', 'main_data');
      assert.strictEqual(fsMain?.landingContent?.heroBadge, 'Legitimate Sibling Save');
      assert.strictEqual(fsMain?.spotifyPlaylists?.beginner?.id, 'sp-beg');
      assert.deepStrictEqual(fsMain?.deletedStudentEmails, ['purged@example.com']);

      const fsTutors = mockFs._getDoc('app_state', 'tutors');
      assert.deepStrictEqual(fsTutors?.deletedTutorEmails, ['removed-tutor@example.com']);
      assert.deepStrictEqual(fsTutors?.deletedTutorIds, ['removed-tutor-id']);

      const fsAssignments = mockFs._getDoc('app_state', 'assignments');
      assert.strictEqual(fsAssignments?.studentVideoAssignments?.[STUDENT_UID]?.[0]?.videoId, 'dQw4w9WgXcQ');
      assert.strictEqual(fsAssignments?.studentSpotifyAssignments?.[STUDENT_UID]?.[0]?.trackId, 'tr-1');
      assert.deepStrictEqual(fsAssignments?.weeklyStudyDays?.[STUDENT_UID], ['monday', 'wednesday']);
      assert.strictEqual(fsAssignments?.weeklyStudyDaysTargets?.[STUDENT_UID], 2);

      const fsLessons = mockFs._getDoc('app_state', 'lessons');
      assert.strictEqual(fsLessons?.contractedLessons?.[STUDENT_UID], 8);

      const fsYt = mockFs._getDoc('app_state', 'youtube_playlists');
      assert.strictEqual(fsYt?.playlists?.[0]?.id, 'yt-1');

      // 3c. When app_state/routines starts empty, saveAppStateToFirestore writes sibling fields without polluting routinesByDay
      mockFs._clearAll();
      await saveAppStateToFirestore({
        routinesByDay: deepClone(defaultRoutinesByDay),
        weeklyNativeTargets: { [STUDENT_UID]: 3 },
      });
      const freshFsRoutines = mockFs._getDoc('app_state', 'routines');
      assert.strictEqual(freshFsRoutines?.weeklyNativeTargets?.[STUDENT_UID], 3);
      assert.strictEqual(
        freshFsRoutines?.routinesByDay,
        undefined,
        'app_state/routines novo não deve ser poluído com defaultRoutinesByDay'
      );
    });

    await test('4. Reinício simulado: POST/GET /api/routines preservado mesmo após writeDbSync/saveAppStateToFirestore com RAM antiga ou padrão', async () => {
      setupCanonicalSeed(mockFs);

      // 4a. Admin updates template via canonical POST /api/routines (removing wednesday, adding friday)
      const admNewTemplate = {
        monday: [{ id: 'adm-v3-mon', time: '06:45', activityName: 'ADM V3 Mon' }],
        friday: [{ id: 'adm-v3-fri', time: '18:00', activityName: 'ADM V3 Fri' }],
      };
      const postRes = await makeRequest(server, 'POST', '/api/routines', admNewTemplate, {
        Authorization: 'Bearer tok-admin',
      });
      assert.strictEqual(postRes.status, 200);
      assert.strictEqual(postRes.data?.monday?.[0]?.id, 'adm-v3-mon');
      assert.strictEqual(postRes.data?.friday?.[0]?.id, 'adm-v3-fri');

      // 4b. Simulated stale RAM (e.g. another instance or pre-update cache) calls saveAppStateToFirestore
      await saveAppStateToFirestore({
        routinesByDay: CANONICAL_ADM_TEMPLATE,
        weeklyNativeTargets: { [STUDENT_UID]: 5 },
      });
      assert.strictEqual(
        mockFs._getDoc('app_state', 'routines')?.routinesByDay?.monday?.[0]?.id,
        'adm-v3-mon',
        'RAM desatualizada não sobrescreve template salvo via POST /api/routines'
      );
      assert.strictEqual(
        mockFs._getDoc('app_state', 'routines')?.routinesByDay?.wednesday,
        undefined,
        'Dia removido pelo ADM não reaparece após saveAppStateToFirestore'
      );

      // 4c. Simulated server restart (clear RAM completely) + unhydrated save + student POST /api/routines + Admin GET /api/routines
      resetInMemoryDbForTesting();
      resetResidualCachesForTesting();

      // Unhydrated RAM write attempt before initCloudPersistence
      await saveAppStateToFirestore(readDb());

      // Student legacy POST /api/routines returns 410 Gone without mutating RAM/Firestore; subsequent writeDbSync preserves ADM template
      await initCloudPersistence();
      const stuPost = await makeRequest(
        server,
        'POST',
        '/api/routines',
        { monday: [{ id: 'stu-after-restart', time: '11:00', activityName: 'Student Only' }] },
        { Authorization: 'Bearer tok-student' }
      );
      assert.strictEqual(stuPost.status, 410);
      assert.strictEqual(stuPost.data?.code, 'LEGACY_TARGETED_ROUTINES_POST_DISABLED');
      await writeDbSync(readDb());
      await new Promise((r) => setTimeout(r, 100));

      // Admin GET after simulated restart must return exact ADM V3 template
      const admGet = await makeRequest(server, 'GET', '/api/routines', undefined, {
        Authorization: 'Bearer tok-admin',
      });
      assert.strictEqual(admGet.status, 200);
      assert.strictEqual(admGet.data?.monday?.[0]?.id, 'adm-v3-mon');
      assert.strictEqual(admGet.data?.friday?.[0]?.id, 'adm-v3-fri');
      assert.strictEqual(admGet.data?.tuesday, undefined);
      assert.strictEqual(admGet.data?.wednesday, undefined);

      // fetchAppStateFromFirestore also retrieves intact canonical template
      const hydrated = await fetchAppStateFromFirestore();
      assert.strictEqual(hydrated?.routinesByDay?.monday?.[0]?.id, 'adm-v3-mon');
      assert.strictEqual(hydrated?.routinesByDay?.friday?.[0]?.id, 'adm-v3-fri');
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    resetFirebaseAdminForTesting();
    resetFirebaseAdminFirestoreForTesting();
    resetInMemoryDbForTesting();
    resetResidualCachesForTesting();
  }

  console.log(`\nResumo SEC.FIX.6A.2: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('Fatal error in validate-sec-fix-6a-2:', err);
  process.exit(1);
});
