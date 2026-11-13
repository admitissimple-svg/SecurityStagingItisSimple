import assert from 'assert';
import http from 'http';
import type { Firestore } from 'firebase-admin/firestore';
import {
  app as serverApp,
  initCloudPersistence,
  readDb,
} from '../serverApp';
import {
  fetchAppStateFromFirestore,
  fetchTutorDocumentFromFirestore,
  resolveCanonicalUserRoleAndIdentity,
  setFirebaseAdminFirestoreForTesting,
  resetFirebaseAdminFirestoreForTesting,
} from '../src/serverFirestore';
import {
  ALLOWED_STAGING_PROJECT_ID,
  setFirebaseAdminAuthForTesting,
  resetFirebaseAdminForTesting,
} from '../src/serverFirebaseAdmin';

class MockArch2AFirestore {
  public projectId = ALLOWED_STAGING_PROJECT_ID;
  public databaseId = '(default)';
  public store = new Map<string, any>();
  public writeLog: Array<{ op: 'set' | 'delete'; path: string }> = [];
  public failUsersQuery = false;
  public failTutorsQuery = false;

  private getKey(col: string, id: string) {
    return `${col}::${id}`;
  }

  public collection(colName: string) {
    const self = this;
    const makeDocRef = (docId: string) => ({
      id: docId,
      path: `${colName}/${docId}`,
      async get() {
        if (colName === 'users' && self.failUsersQuery) {
          throw new Error('PERMISSION_DENIED: Simulated users read failure');
        }
        if (colName === 'tutors' && self.failTutorsQuery) {
          throw new Error('PERMISSION_DENIED: Simulated tutors read failure');
        }
        const data = self.store.get(self.getKey(colName, docId));
        return {
          id: docId,
          exists: data !== undefined,
          data: () => (data ? JSON.parse(JSON.stringify(data)) : undefined),
        };
      },
      async set(data: any, options?: { merge?: boolean }) {
        self.writeLog.push({ op: 'set', path: `${colName}/${docId}` });
        const key = self.getKey(colName, docId);
        if (options?.merge && self.store.has(key)) {
          const prev = self.store.get(key);
          self.store.set(key, { ...prev, ...JSON.parse(JSON.stringify(data)) });
        } else {
          self.store.set(key, JSON.parse(JSON.stringify(data)));
        }
        return { writeTime: new Date() };
      },
      async delete() {
        self.writeLog.push({ op: 'delete', path: `${colName}/${docId}` });
        self.store.delete(self.getKey(colName, docId));
      },
      collection(subColName: string) {
        return self.collection(`${colName}/${docId}/${subColName}`);
      },
    });

    const querySnapshotFromDocs = (docs: any[]) => ({
      empty: docs.length === 0,
      size: docs.length,
      docs,
      forEach(cb: (d: any) => void) {
        docs.forEach(cb);
      },
    });

    const buildQuery = (filters: Array<{ field: string; op: string; val: any }> = [], maxLimit?: number) => ({
      where(field: string, op: string, val: any) {
        return buildQuery([...filters, { field, op, val }], maxLimit);
      },
      limit(n: number) {
        return buildQuery(filters, n);
      },
      async get() {
        if (colName === 'users' && self.failUsersQuery) {
          throw new Error('PERMISSION_DENIED: Simulated users query failure');
        }
        if (colName === 'tutors' && self.failTutorsQuery) {
          throw new Error('PERMISSION_DENIED: Simulated tutors query failure');
        }
        const prefix = `${colName}::`;
        const docs: any[] = [];
        for (const [key, data] of self.store.entries()) {
          if (!key.startsWith(prefix)) continue;
          const rest = key.slice(prefix.length);
          if (rest.includes('/')) continue;
          const matches = filters.every((f) => f.op === '==' && data && data[f.field] === f.val);
          if (matches) {
            docs.push({
              id: rest,
              exists: true,
              data: () => JSON.parse(JSON.stringify(data)),
            });
          }
          if (maxLimit !== undefined && docs.length >= maxLimit) break;
        }
        return querySnapshotFromDocs(docs);
      },
    });

    return {
      doc: makeDocRef,
      where(field: string, op: string, val: any) {
        return buildQuery([{ field, op, val }]);
      },
      limit(n: number) {
        return buildQuery([], n);
      },
      async get() {
        return buildQuery().get();
      },
    };
  }
}

function makeRequest(
  server: http.Server,
  method: string,
  path: string,
  body?: any,
  headers: Record<string, string> = {}
): Promise<{ status: number; data: any }> {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    if (!addr || typeof addr === 'string') {
      return reject(new Error('Server address not available'));
    }
    const bodyStr = body ? JSON.stringify(body) : undefined;
    const reqHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      ...headers,
    };
    if (bodyStr) {
      reqHeaders['Content-Length'] = Buffer.byteLength(bodyStr).toString();
    }
    const req = http.request(
      { host: '127.0.0.1', port: addr.port, path, method, headers: reqHeaders },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => {
          raw += chunk;
        });
        res.on('end', () => {
          let parsed: any;
          try {
            parsed = JSON.parse(raw);
          } catch {
            parsed = raw;
          }
          resolve({ status: res.statusCode || 0, data: parsed });
        });
      }
    );
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

async function runArch2ATests() {
  console.log('======================================================================');
  console.log("IT'S SIMPLE — ARCH.2A MANDATORY TEST SUITE");
  console.log('======================================================================\n');

  let passed = 0;
  let failed = 0;

  async function test(name: string, fn: () => void | Promise<void>) {
    try {
      await fn();
      passed++;
      console.log(`  [PASS] ${name}`);
    } catch (err: any) {
      failed++;
      console.error(`  [FAIL] ${name}`);
      console.error(`         ${err?.stack || err?.message || err}`);
    }
  }

  const origProjectId = process.env.FIREBASE_PROJECT_ID;
  process.env.FIREBASE_PROJECT_ID = ALLOWED_STAGING_PROJECT_ID;

  const server = http.createServer(serverApp);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const LEGIT_STUDENT_UID = 'StudentCanonUid1234567890123';
    const LEGIT_STUDENT_EMAIL = 'legit.student@itissimple.com';
    const LEGIT_TEACHER_UID = 'TeacherCanonUid1234567890123';
    const LEGIT_TEACHER_EMAIL = 'legit.teacher@itissimple.com';
    const ADMIN_UID = 'AdminCanonUid123456789012345';
    const ADMIN_EMAIL = 'adm.itissimple@gmail.com';

    const ORPHAN_ROUTINE_EMAIL = 'deleted.routine@itissimple.com';
    const ORPHAN_VIDEO_EMAIL = 'deleted.video@itissimple.com';
    const ORPHAN_SPOTIFY_EMAIL = 'deleted.spotify@itissimple.com';
    const ORPHAN_CHECKS_EMAIL = 'deleted.checks@itissimple.com';
    const LEGACY_CACHE_STUDENT_EMAIL = 'deleted.legacy.cache@itissimple.com';
    const LEGACY_CACHE_STUDENT_UID = 'DeletedLegacyUid123456789012';
    const LEGACY_CACHE_TUTOR_EMAIL = 'deleted.tutor.cache@itissimple.com';
    const LEGACY_CACHE_TUTOR_UID = 'DeletedTutorUid1234567890123';

    const setupCanonicalAndLegacyDb = () => {
      const mockDb = new MockArch2AFirestore();

      // Canonical /users records (ONLY legitimate student and teacher)
      mockDb.store.set(`users::${LEGIT_STUDENT_UID}`, {
        id: LEGIT_STUDENT_UID,
        uid: LEGIT_STUDENT_UID,
        email: LEGIT_STUDENT_EMAIL,
        name: 'Legit Student',
        role: 'student',
        level: 'intermediate',
        contractedLessons: 4,
      });

      mockDb.store.set(`users::${LEGIT_TEACHER_UID}`, {
        id: LEGIT_TEACHER_UID,
        uid: LEGIT_TEACHER_UID,
        authUid: LEGIT_TEACHER_UID,
        email: LEGIT_TEACHER_EMAIL,
        name: 'Legit Native Friend',
        role: 'teacher',
        approvalStatus: 'approved',
        isApproved: true,
        status: 'approved',
        approved: true,
        publicTutorId: 'legit-native-friend',
      });

      mockDb.store.set(`tutors::${LEGIT_TEACHER_UID}`, {
        id: LEGIT_TEACHER_UID,
        uid: LEGIT_TEACHER_UID,
        authUid: LEGIT_TEACHER_UID,
        email: LEGIT_TEACHER_EMAIL,
        name: 'Legit Native Friend',
        role: 'teacher',
        approvalStatus: 'approved',
        isApproved: true,
        status: 'approved',
        approved: true,
        publicTutorId: 'legit-native-friend',
      });

      // Legacy app_state containing deleted users + orphaned activity maps
      mockDb.store.set('app_state::main_data', {
        userProfiles: {
          [LEGACY_CACHE_STUDENT_EMAIL]: {
            id: LEGACY_CACHE_STUDENT_UID,
            uid: LEGACY_CACHE_STUDENT_UID,
            email: LEGACY_CACHE_STUDENT_EMAIL,
            name: 'Ghost Cache Student',
            role: 'student',
          },
          [ORPHAN_ROUTINE_EMAIL]: {
            id: 'OrphanRoutineUid123456789012',
            uid: 'OrphanRoutineUid123456789012',
            email: ORPHAN_ROUTINE_EMAIL,
            name: 'Ghost Routine Student',
            role: 'student',
          },
        },
        authUsers: {
          [LEGACY_CACHE_STUDENT_EMAIL]: {
            uid: LEGACY_CACHE_STUDENT_UID,
            email: LEGACY_CACHE_STUDENT_EMAIL,
            name: 'Ghost Cache Student',
            role: 'student',
          },
        },
        students: [
          {
            id: LEGACY_CACHE_STUDENT_UID,
            uid: LEGACY_CACHE_STUDENT_UID,
            studentUid: LEGACY_CACHE_STUDENT_UID,
            email: LEGACY_CACHE_STUDENT_EMAIL,
            studentEmail: LEGACY_CACHE_STUDENT_EMAIL,
            name: 'Ghost Cache Student',
          },
        ],
      });

      mockDb.store.set('app_state::tutors', {
        tutorsList: [
          {
            id: LEGACY_CACHE_TUTOR_UID,
            uid: LEGACY_CACHE_TUTOR_UID,
            authUid: LEGACY_CACHE_TUTOR_UID,
            email: LEGACY_CACHE_TUTOR_EMAIL,
            name: 'Ghost Cache Tutor',
            role: 'teacher',
            approvalStatus: 'approved',
            isApproved: true,
          },
        ],
        teachers: [
          {
            id: ADMIN_UID,
            uid: ADMIN_UID,
            email: ADMIN_EMAIL,
            name: 'Admin Itissimple',
            role: 'admin',
          },
          {
            id: LEGACY_CACHE_TUTOR_UID,
            uid: LEGACY_CACHE_TUTOR_UID,
            email: LEGACY_CACHE_TUTOR_EMAIL,
            name: 'Ghost Cache Tutor',
            role: 'teacher',
            approvalStatus: 'approved',
            isApproved: true,
          },
        ],
      });

      mockDb.store.set('app_state::routines', {
        studentRoutinesMap: {
          [ORPHAN_ROUTINE_EMAIL]: { monday: [{ id: 'act-1', title: 'Watch Video' }] },
          [LEGIT_STUDENT_EMAIL]: { monday: [{ id: 'act-legit', title: 'Legit Routine' }] },
        },
        studentWeeklyChecks: {
          [ORPHAN_CHECKS_EMAIL]: { 'monday-video': true },
          [`${ORPHAN_CHECKS_EMAIL}::week-1`]: { 'monday-video': true },
        },
      });

      mockDb.store.set('app_state::assignments', {
        studentVideoAssignments: {
          [ORPHAN_VIDEO_EMAIL]: [{ id: 'vid-1', title: 'Orphan Video' }],
        },
        studentSpotifyAssignments: {
          [ORPHAN_SPOTIFY_EMAIL]: [{ id: 'sp-1', title: 'Orphan Track' }],
        },
      });

      return mockDb;
    };

    // ------------------------------------------------------------------------
    // 1. Atividades órfãs e caches legados NÃO recriam usuários
    // ------------------------------------------------------------------------
    await test('1. Atividades órfãs (routines/videos/spotify/weeklyChecks) e caches legados não recriam usuários', async () => {
      const mockDb = setupCanonicalAndLegacyDb();
      setFirebaseAdminFirestoreForTesting(mockDb as unknown as Firestore);

      const appState = await fetchAppStateFromFirestore();
      assert(appState !== null, 'fetchAppStateFromFirestore retorna estado');

      assert(!appState.userProfiles?.[ORPHAN_ROUTINE_EMAIL], 'userProfiles não recria usuário via studentRoutinesMap');
      assert(!appState.userProfiles?.[ORPHAN_VIDEO_EMAIL], 'userProfiles não recria usuário via studentVideoAssignments');
      assert(!appState.userProfiles?.[ORPHAN_SPOTIFY_EMAIL], 'userProfiles não recria usuário via studentSpotifyAssignments');
      assert(!appState.userProfiles?.[ORPHAN_CHECKS_EMAIL], 'userProfiles não recria usuário via studentWeeklyChecks');
      assert(!appState.userProfiles?.[LEGACY_CACHE_STUDENT_EMAIL], 'userProfiles não ressuscita usuário excluído de app_state/main_data');
      assert(!appState.authUsers?.[LEGACY_CACHE_STUDENT_EMAIL], 'authUsers não ressuscita usuário excluído de app_state/main_data');
      assert(
        !(appState.students || []).some((s: any) => (s.email || s.studentEmail) === LEGACY_CACHE_STUDENT_EMAIL),
        'students não ressuscita aluno excluído de app_state/main_data'
      );
      assert(
        !(appState.tutorsList || []).some((t: any) => t.email === LEGACY_CACHE_TUTOR_EMAIL),
        'tutorsList não ressuscita tutor excluído de app_state/tutors'
      );

      // Agora testar initCloudPersistence() end-to-end
      await initCloudPersistence();
      const db = readDb();

      for (const orphanEmail of [
        ORPHAN_ROUTINE_EMAIL,
        ORPHAN_VIDEO_EMAIL,
        ORPHAN_SPOTIFY_EMAIL,
        ORPHAN_CHECKS_EMAIL,
        LEGACY_CACHE_STUDENT_EMAIL,
      ]) {
        assert(!db.userProfiles?.[orphanEmail], `inMemoryDb.userProfiles não contém ${orphanEmail}`);
        assert(!db.authUsers?.[orphanEmail], `inMemoryDb.authUsers não contém ${orphanEmail}`);
        assert(
          !(db.students || []).some((s: any) => (s.email || s.studentEmail) === orphanEmail),
          `inMemoryDb.students não contém ${orphanEmail}`
        );
      }

      assert(
        !(db.tutorsList || []).some((t: any) => t.email === LEGACY_CACHE_TUTOR_EMAIL),
        'inMemoryDb.tutorsList não ressuscita tutor excluído'
      );

      // Legitimate accounts and non-identity routines remain intact
      assert(Boolean(db.userProfiles?.[LEGIT_STUDENT_EMAIL]), 'Aluno legítimo preservado em userProfiles');
      assert(
        (db.students || []).some((s: any) => (s.email || s.studentEmail) === LEGIT_STUDENT_EMAIL),
        'Aluno legítimo preservado em students'
      );
      assert(
        (db.tutorsList || []).some((t: any) => t.email === LEGIT_TEACHER_EMAIL),
        'Professor legítimo preservado em tutorsList'
      );
      assert(
        (db.teachers || []).some((t: any) => t.role === 'admin' && t.email === ADMIN_EMAIL),
        'Administrador legítimo preservado em teachers'
      );
      assert(
        Boolean(db.studentRoutinesMap?.[LEGIT_STUDENT_EMAIL]),
        'Rotina pedagógica do aluno legítimo preservada'
      );

      // fetchTutorDocumentFromFirestore must NOT resurrect deleted tutor from app_state/tutors
      const ghostTutorDoc = await fetchTutorDocumentFromFirestore(LEGACY_CACHE_TUTOR_EMAIL, 500);
      assert(ghostTutorDoc === null, 'fetchTutorDocumentFromFirestore não usa app_state/tutors como fallback de existência');
    });

    // ------------------------------------------------------------------------
    // 2. /api/auth/check-user é estritamente somente leitura e ignora app_state-only
    // ------------------------------------------------------------------------
    await test('2. /api/auth/check-user não grava dados e não considera app_state exclusivo como conta ativa', async () => {
      const mockDb = setupCanonicalAndLegacyDb();
      setFirebaseAdminFirestoreForTesting(mockDb as unknown as Firestore);
      await initCloudPersistence();

      // Inject stale app_state/inMemoryDb entry for a deleted user to verify check-user ignores it
      const dbBefore = readDb();
      const staleDeletedEmail = 'stale.appstate.only@itissimple.com';
      dbBefore.authUsers[staleDeletedEmail] = {
        uid: 'StaleDeletedUid1234567890123',
        email: staleDeletedEmail,
        name: 'Stale AppState User',
        role: 'student',
      };
      dbBefore.userProfiles[staleDeletedEmail] = {
        id: 'StaleDeletedUid1234567890123',
        uid: 'StaleDeletedUid1234567890123',
        email: staleDeletedEmail,
        name: 'Stale AppState User',
        role: 'student',
      };

      const snapshotBefore = JSON.stringify({
        authKeys: Object.keys(dbBefore.authUsers || {}).sort(),
        profileKeys: Object.keys(dbBefore.userProfiles || {}).sort(),
        studentCount: (dbBefore.students || []).length,
      });

      mockDb.writeLog = [];

      setFirebaseAdminAuthForTesting({
        getUserByEmail: async (em: string) => {
          if (em === LEGIT_STUDENT_EMAIL) {
            return { uid: LEGIT_STUDENT_UID, email: LEGIT_STUDENT_EMAIL, displayName: 'Legit Student' };
          }
          const notFoundErr: any = new Error('There is no user record corresponding to the provided identifier.');
          notFoundErr.code = 'auth/user-not-found';
          throw notFoundErr;
        },
      } as any);

      // 2a. Querying stale app_state-only email where Firebase Auth returns auth/user-not-found
      const resStale = await makeRequest(
        server,
        'GET',
        `/api/auth/check-user?email=${encodeURIComponent(staleDeletedEmail)}`
      );
      assert.strictEqual(resStale.status, 200, 'check-user retorna 200 quando Firebase Auth confirma ausência');
      assert.strictEqual(resStale.data.emailExists, false, 'Registro apenas em app_state/cache NÃO confirma conta ativa');
      assert.strictEqual(resStale.data.exists, false, 'exists é false quando Auth retorna user-not-found');
      assert.strictEqual(resStale.data.profile, null, 'Não expõe perfil stale de cache');

      // 2b. Querying existing user in Firebase Auth whose Firestore record is checked read-only
      const brandNewAuthOnlyEmail = 'auth.only.new@itissimple.com';
      const brandNewAuthOnlyUid = 'AuthOnlyUserUid1234567890123';
      mockDb.store.set(`users::${brandNewAuthOnlyUid}`, {
        id: brandNewAuthOnlyUid,
        uid: brandNewAuthOnlyUid,
        email: brandNewAuthOnlyEmail,
        name: 'Auth Only Student',
        role: 'student',
      });
      setFirebaseAdminAuthForTesting({
        getUserByEmail: async (em: string) => {
          if (em === brandNewAuthOnlyEmail) {
            return { uid: brandNewAuthOnlyUid, email: brandNewAuthOnlyEmail, displayName: 'Auth Only Student' };
          }
          const notFoundErr: any = new Error('Not found');
          notFoundErr.code = 'auth/user-not-found';
          throw notFoundErr;
        },
      } as any);

      const resFound = await makeRequest(
        server,
        'GET',
        `/api/auth/check-user?email=${encodeURIComponent(brandNewAuthOnlyEmail)}`
      );
      assert.strictEqual(resFound.status, 200, 'check-user retorna 200 para usuário existente');
      assert.strictEqual(resFound.data.emailExists, true, 'emailExists é true');

      // Verify zero writes to Firestore and zero mutations to inMemoryDb
      assert.strictEqual(mockDb.writeLog.length, 0, 'check-user não executa nenhuma escrita no Firestore');
      const dbAfter = readDb();
      const snapshotAfter = JSON.stringify({
        authKeys: Object.keys(dbAfter.authUsers || {}).sort(),
        profileKeys: Object.keys(dbAfter.userProfiles || {}).sort(),
        studentCount: (dbAfter.students || []).length,
      });
      assert.strictEqual(snapshotAfter, snapshotBefore, 'check-user não muta inMemoryDb (authUsers/userProfiles/students)');
      assert(!dbAfter.authUsers[brandNewAuthOnlyEmail], 'check-user não hidrata authUsers em memória');
      assert(!dbAfter.userProfiles[brandNewAuthOnlyEmail], 'check-user não hidrata userProfiles em memória');
    });

    // ------------------------------------------------------------------------
    // 3. Falha de acesso ao Auth NÃO é interpretada como usuário inexistente
    // ------------------------------------------------------------------------
    await test('3. Falha de acesso ao Firebase Auth retorna estado indisponível (503) sem declarar exists=false', async () => {
      const mockDb = setupCanonicalAndLegacyDb();
      setFirebaseAdminFirestoreForTesting(mockDb as unknown as Firestore);

      // 3a. Auth error (permission/network)
      setFirebaseAdminAuthForTesting({
        getUserByEmail: async () => {
          const err: any = new Error('IAM Permission denied calling identitytoolkit');
          err.code = 'auth/insufficient-permission';
          throw err;
        },
      } as any);

      const resIam = await makeRequest(
        server,
        'GET',
        `/api/auth/check-user?email=${encodeURIComponent(LEGIT_STUDENT_EMAIL)}`
      );
      assert.strictEqual(resIam.status, 503, 'Erro no Auth retorna HTTP 503');
      assert.strictEqual(resIam.data.verificationStatus, 'unavailable', 'verificationStatus é unavailable');
      assert.strictEqual(resIam.data.verificationAvailable, false, 'verificationAvailable é false');
      assert.strictEqual(resIam.data.exists, null, 'exists é null (não false)');
      assert.strictEqual(resIam.data.emailExists, null, 'emailExists é null (não false)');

      // 3b. Partial/uninitialized Auth mock without getUserByEmail
      setFirebaseAdminAuthForTesting({ verifyIdToken: async () => ({}) } as any);
      const resNoMethod = await makeRequest(
        server,
        'GET',
        `/api/auth/check-user?email=${encodeURIComponent(LEGIT_STUDENT_EMAIL)}`
      );
      assert.strictEqual(resNoMethod.status, 503, 'Auth sem getUserByEmail retorna HTTP 503');
      assert.strictEqual(resNoMethod.data.emailExists, null, 'emailExists permanece null');

      // 3c. Name-only query when Firestore users query fails
      mockDb.failUsersQuery = true;
      const resNameUnavailable = await makeRequest(
        server,
        'GET',
        `/api/auth/check-user?name=${encodeURIComponent('Legit Student')}&role=student`
      );
      assert.strictEqual(resNameUnavailable.status, 503, 'Falha no Firestore durante verificação de nome retorna HTTP 503');
      assert.strictEqual(resNameUnavailable.data.nameExists, null, 'nameExists é null quando verificação está indisponível');
      assert.strictEqual(resNameUnavailable.data.exists, null, 'exists é null');
    });

    // ------------------------------------------------------------------------
    // 4. Contas legítimas continuam reconhecidas
    // ------------------------------------------------------------------------
    await test('4. Contas legítimas continuam reconhecidas no check-user e no login/verify-session', async () => {
      const mockDb = setupCanonicalAndLegacyDb();
      setFirebaseAdminFirestoreForTesting(mockDb as unknown as Firestore);
      await initCloudPersistence();

      setFirebaseAdminAuthForTesting({
        getUserByEmail: async (em: string) => {
          if (em === LEGIT_STUDENT_EMAIL) {
            return { uid: LEGIT_STUDENT_UID, email: LEGIT_STUDENT_EMAIL, displayName: 'Legit Student' };
          }
          if (em === LEGIT_TEACHER_EMAIL) {
            return { uid: LEGIT_TEACHER_UID, email: LEGIT_TEACHER_EMAIL, displayName: 'Legit Native Friend' };
          }
          const e: any = new Error('not found');
          e.code = 'auth/user-not-found';
          throw e;
        },
        verifyIdToken: async (tok: string) => {
          if (tok === 'legit-student-tok') {
            return { uid: LEGIT_STUDENT_UID, email: LEGIT_STUDENT_EMAIL, email_verified: true };
          }
          throw new Error('Invalid token');
        },
      } as any);

      const checkStudent = await makeRequest(
        server,
        'GET',
        `/api/auth/check-user?email=${encodeURIComponent(LEGIT_STUDENT_EMAIL)}`
      );
      assert.strictEqual(checkStudent.status, 200, 'check-user retorna 200 para aluno legítimo');
      assert.strictEqual(checkStudent.data.emailExists, true, 'Aluno legítimo reconhecido');
      assert.strictEqual(checkStudent.data.role, 'student', 'Role student preservado');

      const checkTeacher = await makeRequest(
        server,
        'GET',
        `/api/auth/check-user?email=${encodeURIComponent(LEGIT_TEACHER_EMAIL)}`
      );
      assert.strictEqual(checkTeacher.status, 200, 'check-user retorna 200 para professor legítimo');
      assert.strictEqual(checkTeacher.data.emailExists, true, 'Professor legítimo reconhecido');
      assert.strictEqual(checkTeacher.data.role, 'teacher', 'Role teacher preservado');

      const checkName = await makeRequest(
        server,
        'GET',
        `/api/auth/check-user?name=${encodeURIComponent('Legit Student')}&role=student`
      );
      assert.strictEqual(checkName.status, 200, 'check-user por nome retorna 200');
      assert.strictEqual(checkName.data.nameExists, true, 'Nome de aluno legítimo encontrado no Firestore canônico');

      const verifyRes = await makeRequest(server, 'GET', '/api/auth/verify-session', undefined, {
        Authorization: 'Bearer legit-student-tok',
      });
      assert.strictEqual(verifyRes.status, 200, 'verify-session retorna 200 para aluno legítimo');
      assert.strictEqual(verifyRes.data.role, 'student', 'verify-session confirma role student');
    });

    // ------------------------------------------------------------------------
    // 5. Professor sem teacher custom claim continua autorizado pela resolução canônica
    // ------------------------------------------------------------------------
    await test('5. Professor sem teacher custom claim continua autorizado pela resolução canônica', async () => {
      const mockDb = setupCanonicalAndLegacyDb();
      setFirebaseAdminFirestoreForTesting(mockDb as unknown as Firestore);
      await initCloudPersistence();

      // Token WITHOUT role custom claim (no `role: 'teacher'` in decoded token!)
      setFirebaseAdminAuthForTesting({
        verifyIdToken: async (tok: string) => {
          if (tok === 'teacher-no-claim-tok') {
            return {
              uid: LEGIT_TEACHER_UID,
              email: LEGIT_TEACHER_EMAIL,
              email_verified: true,
              // intentionally NO role custom claim
            };
          }
          throw new Error('Invalid token');
        },
        getUser: async (uid: string) => ({ uid, email: LEGIT_TEACHER_EMAIL }),
        getUserByEmail: async (em: string) => ({ uid: LEGIT_TEACHER_UID, email: em }),
      } as any);

      const resolution = await resolveCanonicalUserRoleAndIdentity({
        uid: LEGIT_TEACHER_UID,
        email: LEGIT_TEACHER_EMAIL,
        // tokenRole omitted intentionally
      });
      assert.strictEqual(resolution.role, 'teacher', 'resolveCanonicalUserRoleAndIdentity resolve teacher sem custom claim');
      assert.strictEqual(resolution.identityStatus, 'authorized', 'identityStatus é authorized');

      const verifyRes = await makeRequest(server, 'GET', '/api/auth/verify-session', undefined, {
        Authorization: 'Bearer teacher-no-claim-tok',
      });
      assert.strictEqual(verifyRes.status, 200, 'verify-session autoriza professor sem custom claim');
      assert.strictEqual(verifyRes.data.role, 'teacher', 'verify-session retorna role=teacher');

      const loginRes = await makeRequest(
        server,
        'POST',
        '/api/auth/login',
        { uid: LEGIT_TEACHER_UID, email: LEGIT_TEACHER_EMAIL, role: 'teacher' },
        { Authorization: 'Bearer teacher-no-claim-tok' }
      );
      assert.strictEqual(loginRes.status, 200, 'POST /api/auth/login autoriza professor sem custom claim');
      assert.strictEqual(loginRes.data.role, 'teacher', 'login retorna role=teacher');
    });

    // ------------------------------------------------------------------------
    // 6. Nenhuma regressão nos fluxos de login e cadastro
    // ------------------------------------------------------------------------
    await test('6. Nenhuma regressão nos fluxos de cadastro, login e-mail/senha e login Google', async () => {
      const mockDb = setupCanonicalAndLegacyDb();
      setFirebaseAdminFirestoreForTesting(mockDb as unknown as Firestore);
      await initCloudPersistence();

      const NEW_STUDENT_UID = 'NewRegStudentUid123456789012';
      const NEW_STUDENT_EMAIL = 'new.signup.student@itissimple.com';

      setFirebaseAdminAuthForTesting({
        verifyIdToken: async (tok: string) => {
          if (tok === 'new-student-tok') {
            return { uid: NEW_STUDENT_UID, email: NEW_STUDENT_EMAIL, email_verified: true };
          }
          if (tok === 'legit-student-tok') {
            return { uid: LEGIT_STUDENT_UID, email: LEGIT_STUDENT_EMAIL, email_verified: true };
          }
          throw new Error('Invalid token');
        },
        getUserByEmail: async (em: string) => {
          if (em === LEGIT_STUDENT_EMAIL) return { uid: LEGIT_STUDENT_UID, email: LEGIT_STUDENT_EMAIL };
          const e: any = new Error('not found');
          e.code = 'auth/user-not-found';
          throw e;
        },
      } as any);

      // 6a. Register new student
      const regRes = await makeRequest(
        server,
        'POST',
        '/api/auth/register',
        {
          uid: NEW_STUDENT_UID,
          email: NEW_STUDENT_EMAIL,
          name: 'New Signup Student',
          role: 'student',
          level: 'iniciante',
          learningGoal: 'Travel',
        },
        { Authorization: 'Bearer new-student-tok' }
      );
      assert.strictEqual(regRes.status, 201, 'POST /api/auth/register cria novo aluno com 201');
      assert.strictEqual(regRes.data.account?.uid, NEW_STUDENT_UID, 'UID canônico preservado no cadastro');

      // 6b. Email/password login
      const loginRes = await makeRequest(
        server,
        'POST',
        '/api/auth/login',
        { uid: NEW_STUDENT_UID, email: NEW_STUDENT_EMAIL, role: 'student' },
        { Authorization: 'Bearer new-student-tok' }
      );
      assert.strictEqual(loginRes.status, 200, 'POST /api/auth/login retorna 200');
      assert.strictEqual(loginRes.data.account?.role, 'student', 'Login retorna role=student');

      // 6c. Google login
      const googleRes = await makeRequest(
        server,
        'POST',
        '/api/auth/google',
        { uid: LEGIT_STUDENT_UID, email: LEGIT_STUDENT_EMAIL, name: 'Legit Student', role: 'student' },
        { Authorization: 'Bearer legit-student-tok' }
      );
      assert.strictEqual(googleRes.status, 200, 'POST /api/auth/google retorna 200');
      assert.strictEqual(googleRes.data.account?.uid, LEGIT_STUDENT_UID, 'Google login preserva UID canônico');
      assert.strictEqual(googleRes.data.role, 'student', 'Google login preserva role student');
    });
  } finally {
    server.close();
    if (typeof (server as any).closeAllConnections === 'function') {
      (server as any).closeAllConnections();
    }
    resetFirebaseAdminFirestoreForTesting();
    resetFirebaseAdminForTesting();
    if (origProjectId === undefined) {
      delete process.env.FIREBASE_PROJECT_ID;
    } else {
      process.env.FIREBASE_PROJECT_ID = origProjectId;
    }
  }

  console.log('\n======================================================================');
  console.log(`ARCH.2A TEST SUMMARY: ${passed} PASSED | ${failed} FAILED`);
  console.log('======================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
  process.exit(0);
}

runArch2ATests().catch((err) => {
  console.error('Fatal error in ARCH.2A test suite:', err);
  process.exit(1);
});
