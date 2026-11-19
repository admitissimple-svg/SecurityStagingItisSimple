import assert from 'assert';
import http from 'http';
import { app as serverApp, readDb, resetInMemoryDbForTesting } from '../serverApp';
import {
  setFirebaseAdminFirestoreForTesting,
  resetFirebaseAdminFirestoreForTesting,
  setIsCloudWriteDisabled,
  fetchAppStateFromFirestore,
} from '../src/serverFirestore';
import { setFirebaseAdminAuthForTesting, resetFirebaseAdminForTesting } from '../src/serverFirebaseAdmin';

function createTestFirestoreMock(opts: { disableTransactions?: boolean } = {}) {
  const store = new Map<string, Record<string, any>>();
  let failOnSetCollection: string | null = null;
  let failOnDeleteCollection: string | null = null;

  const matchFilters = (data: Record<string, any>, filters: Array<{ field: string; op: string; val: any }>) =>
    filters.every((f) => (f.op === '==' ? data[f.field] === f.val : false));

  const makeDocRef = (col: string, id: string, parentPath = ''): any => {
    const fullCol = parentPath ? `${parentPath}/${col}` : col;
    const key = `${fullCol}::${id}`;
    return {
      _col: fullCol,
      _id: id,
      id,
      path: `${fullCol}/${id}`,
      collection: (subCol: string) => makeCollectionRef(subCol, `${fullCol}/${id}`),
      get: async () => {
        const val = store.get(key);
        return {
          id,
          exists: Boolean(val),
          ref: makeDocRef(col, id, parentPath),
          data: () => (val ? JSON.parse(JSON.stringify(val)) : undefined),
        };
      },
      set: async (data: Record<string, any>, setOpts?: { merge?: boolean }) => {
        if (failOnSetCollection && (fullCol === failOnSetCollection || failOnSetCollection === '*')) {
          throw new Error(`Simulated Firestore write error on ${fullCol}/${id}`);
        }
        const prev = setOpts?.merge ? (store.get(key) || {}) : {};
        store.set(key, JSON.parse(JSON.stringify({ ...prev, ...data })));
        return { writeTime: new Date() };
      },
      update: async (data: Record<string, any>) => {
        if (failOnSetCollection && (fullCol === failOnSetCollection || failOnSetCollection === '*')) {
          throw new Error(`Simulated Firestore update error on ${fullCol}/${id}`);
        }
        const prev = store.get(key) || {};
        store.set(key, JSON.parse(JSON.stringify({ ...prev, ...data })));
        return { writeTime: new Date() };
      },
      delete: async () => {
        if (failOnDeleteCollection && (fullCol === failOnDeleteCollection || failOnDeleteCollection === '*')) {
          throw new Error(`Simulated Firestore delete error on ${fullCol}/${id}`);
        }
        store.delete(key);
        return { writeTime: new Date() };
      },
    };
  };

  const makeQuery = (
    col: string,
    parentPath = '',
    filters: Array<{ field: string; op: string; val: any }> = [],
    maxLimit?: number
  ): any => {
    const fullCol = parentPath ? `${parentPath}/${col}` : col;
    return {
      where: (field: string, op: string, val: any) =>
        makeQuery(col, parentPath, [...filters, { field, op, val }], maxLimit),
      limit: (n: number) => makeQuery(col, parentPath, filters, n),
      orderBy: () => makeQuery(col, parentPath, filters, maxLimit),
      get: async () => {
        const docs: any[] = [];
        for (const [k, v] of store.entries()) {
          if (!k.startsWith(`${fullCol}::`)) continue;
          const docId = k.slice(`${fullCol}::`.length);
          if (docId.includes('/')) continue;
          if (matchFilters(v, filters)) {
            docs.push({
              id: docId,
              exists: true,
              ref: makeDocRef(col, docId, parentPath),
              data: () => JSON.parse(JSON.stringify(v)),
            });
          }
        }
        const sliced = typeof maxLimit === 'number' ? docs.slice(0, maxLimit) : docs;
        return {
          empty: sliced.length === 0,
          docs: sliced,
          size: sliced.length,
          forEach: (cb: (d: any) => void) => sliced.forEach(cb),
        };
      },
    };
  };

  const makeCollectionRef = (col: string, parentPath = ''): any => ({
    doc: (id: string) => makeDocRef(col, id, parentPath),
    where: (field: string, op: string, val: any) => makeQuery(col, parentPath, [{ field, op, val }]),
    limit: (n: number) => makeQuery(col, parentPath, [], n),
    orderBy: () => makeQuery(col, parentPath, []),
    get: async () => makeQuery(col, parentPath).get(),
  });

  const base: any = {
    collection: (col: string) => makeCollectionRef(col),
    _store: store,
    _setDoc: (col: string, id: string, data: Record<string, any>) => {
      store.set(`${col}::${id}`, JSON.parse(JSON.stringify(data)));
    },
    _getDoc: (col: string, id: string) => store.get(`${col}::${id}`),
    _setFailOnSet: (col: string | null) => {
      failOnSetCollection = col;
    },
    _setFailOnDelete: (col: string | null) => {
      failOnDeleteCollection = col;
    },
  };

  if (!opts.disableTransactions) {
    base.runTransaction = async (fn: (tx: any) => Promise<any>) => {
      const staged: Array<{ type: 'set' | 'update' | 'delete'; col: string; id: string; data?: Record<string, any>; merge?: boolean }> = [];
      const tx = {
        get: async (ref: any) => ref.get(),
        set: (ref: any, data: Record<string, any>, setOpts?: { merge?: boolean }) => {
          staged.push({
            type: 'set',
            col: ref._col,
            id: ref._id,
            data: JSON.parse(JSON.stringify(data)),
            merge: Boolean(setOpts?.merge),
          });
        },
        update: (ref: any, data: Record<string, any>) => {
          staged.push({
            type: 'update',
            col: ref._col,
            id: ref._id,
            data: JSON.parse(JSON.stringify(data)),
            merge: true,
          });
        },
        delete: (ref: any) => {
          staged.push({ type: 'delete', col: ref._col, id: ref._id });
        },
      };
      const result = await fn(tx);
      for (const op of staged) {
        if (op.type === 'delete') {
          if (failOnDeleteCollection && (op.col === failOnDeleteCollection || failOnDeleteCollection === '*')) {
            throw new Error(`Simulated Firestore transaction delete error on ${op.col}/${op.id}`);
          }
        } else {
          if (failOnSetCollection && (op.col === failOnSetCollection || failOnSetCollection === '*')) {
            throw new Error(`Simulated Firestore transaction write error on ${op.col}/${op.id}`);
          }
        }
      }
      for (const op of staged) {
        const key = `${op.col}::${op.id}`;
        if (op.type === 'delete') {
          store.delete(key);
        } else {
          const prev = op.merge ? (store.get(key) || {}) : {};
          store.set(key, JSON.parse(JSON.stringify({ ...prev, ...(op.data || {}) })));
        }
      }
      return result;
    };
  }

  return base;
}

function makeRequest(
  server: http.Server,
  method: string,
  reqPath: string,
  body?: any,
  headers: Record<string, string> = {}
): Promise<{ status: number; data: any }> {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    if (!addr || typeof addr === 'string') {
      return reject(new Error('Server address unavailable'));
    }
    const bodyStr = body !== undefined ? JSON.stringify(body) : undefined;
    const reqHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      Connection: 'close',
      ...headers,
    };
    if (bodyStr) {
      reqHeaders['Content-Length'] = Buffer.byteLength(bodyStr).toString();
    }
    const req = http.request(
      { host: '127.0.0.1', port: addr.port, path: reqPath, method, headers: reqHeaders },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => (raw += chunk));
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

async function runSuite() {
  console.log('======================================================================');
  console.log('PERSIST.1C — PERSISTÊNCIA ADMINISTRATIVA EM FIRESTORE (default)');
  console.log('======================================================================\n');

  let passed = 0;
  let failed = 0;

  async function test(name: string, fn: () => void | Promise<void>) {
    try {
      await fn();
      console.log(`  [PASS] ${name}`);
      passed++;
    } catch (err: any) {
      console.error(`  [FAIL] ${name}`);
      console.error(`         ${err?.stack || err?.message || err}`);
      failed++;
    }
  }

  const ADMIN_UID = 'persist1cAdminUid00000000001';
  const ADMIN_EMAIL = 'adm.itissimple@gmail.com';
  const TUTOR_PEND_UID = 'persist1cTutorPend0000000002';
  const TUTOR_PEND_EMAIL = 'tutor.pend.p1c@itissimple-test.com';
  const TUTOR_DEL_UID = 'persist1cTutorDel00000000003';
  const TUTOR_DEL_EMAIL = 'tutor.del.p1c@itissimple-test.com';
  const TEACHER_POST_UID = 'persist1cTeacherPost00000004';
  const TEACHER_POST_EMAIL = 'teacher.post.p1c@itissimple-test.com';
  const STU_DEL_UID = 'persist1cStudentDel000000005';
  const STU_DEL_EMAIL = 'student.del.p1c@itissimple-test.com';
  const STU_HIJACK_UID = 'persist1cStudentHijack000006';
  const STU_HIJACK_EMAIL = 'student.hijack.p1c@itissimple-test.com';
  const TUTOR_NOTX_UID = 'persist1cTutorNoTx0000000007';
  const TUTOR_NOTX_EMAIL = 'tutor.notx.p1c@itissimple-test.com';

  const mockFs = createTestFirestoreMock();
  setFirebaseAdminFirestoreForTesting(mockFs as any);
  setIsCloudWriteDisabled(false);

  const authUsersMap: Record<string, any> = {
    'tok-admin': { uid: ADMIN_UID, email: ADMIN_EMAIL, role: 'admin', admin: true },
    'tok-student': { uid: STU_HIJACK_UID, email: STU_HIJACK_EMAIL, role: 'student' },
    'tok-teacher': { uid: TUTOR_DEL_UID, email: TUTOR_DEL_EMAIL, role: 'teacher' },
  };

  setFirebaseAdminAuthForTesting({
    verifyIdToken: async (token: string) => {
      if (authUsersMap[token]) return authUsersMap[token];
      throw new Error('Invalid token');
    },
    getUser: async (uid: string) => {
      const map: Record<string, { uid: string; email: string }> = {
        [ADMIN_UID]: { uid: ADMIN_UID, email: ADMIN_EMAIL },
        [TUTOR_PEND_UID]: { uid: TUTOR_PEND_UID, email: TUTOR_PEND_EMAIL },
        [TUTOR_DEL_UID]: { uid: TUTOR_DEL_UID, email: TUTOR_DEL_EMAIL },
        [TEACHER_POST_UID]: { uid: TEACHER_POST_UID, email: TEACHER_POST_EMAIL },
        [STU_DEL_UID]: { uid: STU_DEL_UID, email: STU_DEL_EMAIL },
        [STU_HIJACK_UID]: { uid: STU_HIJACK_UID, email: STU_HIJACK_EMAIL },
        [TUTOR_NOTX_UID]: { uid: TUTOR_NOTX_UID, email: TUTOR_NOTX_EMAIL },
      };
      if (map[uid]) return map[uid];
      throw new Error('Not found');
    },
    getUserByEmail: async (email: string) => {
      const em = email.toLowerCase().trim();
      const map: Record<string, { uid: string; email: string }> = {
        [ADMIN_EMAIL]: { uid: ADMIN_UID, email: ADMIN_EMAIL },
        [TUTOR_PEND_EMAIL]: { uid: TUTOR_PEND_UID, email: TUTOR_PEND_EMAIL },
        [TUTOR_DEL_EMAIL]: { uid: TUTOR_DEL_UID, email: TUTOR_DEL_EMAIL },
        [TEACHER_POST_EMAIL]: { uid: TEACHER_POST_UID, email: TEACHER_POST_EMAIL },
        [STU_DEL_EMAIL]: { uid: STU_DEL_UID, email: STU_DEL_EMAIL },
        [STU_HIJACK_EMAIL]: { uid: STU_HIJACK_UID, email: STU_HIJACK_EMAIL },
        [TUTOR_NOTX_EMAIL]: { uid: TUTOR_NOTX_UID, email: TUTOR_NOTX_EMAIL },
      };
      if (map[em]) return map[em];
      const err: any = new Error('Not found');
      err.code = 'auth/user-not-found';
      throw err;
    },
  } as any);

  const server = http.createServer(serverApp);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    await test('1. POST /api/landing-content confirma gravação em app_state/main_data antes de atualizar RAM e falha sem mutar RAM', async () => {
      resetInMemoryDbForTesting();
      const originalHeadline = readDb().landingContent.heroHeadlineHighlight;

      // 1a. Simulated Firestore failure -> 500 and RAM untouched
      mockFs._setFailOnSet('app_state');
      try {
        const failRes = await makeRequest(
          server,
          'POST',
          '/api/landing-content',
          {
            heroHeadlineHighlight: 'Corrupted Headline',
            footerSlogan: 'Corrupted Footer',
          },
          { Authorization: 'Bearer tok-admin' }
        );
        assert.strictEqual(failRes.status, 500);
        assert.notStrictEqual(failRes.data?.success, true);
        assert.strictEqual(readDb().landingContent.heroHeadlineHighlight, originalHeadline, 'RAM não pode mudar após falha');
        assert.strictEqual(mockFs._getDoc('app_state', 'main_data'), undefined);
      } finally {
        mockFs._setFailOnSet(null);
      }

      // 1b. Success -> Firestore confirmed and rehydrated by fetchAppStateFromFirestore
      const okRes = await makeRequest(
        server,
        'POST',
        '/api/landing-content',
        {
          heroHeadlineHighlight: 'Living Persist 1C',
          footerSlogan: 'Confirmed in Firestore!',
        },
        { Authorization: 'Bearer tok-admin' }
      );
      assert.strictEqual(okRes.status, 200);
      assert.strictEqual(okRes.data.success, true);
      assert.strictEqual(okRes.data.landingContent.heroHeadlineHighlight, 'Living Persist 1C');
      assert.strictEqual(readDb().landingContent.heroHeadlineHighlight, 'Living Persist 1C');

      const fsMain = mockFs._getDoc('app_state', 'main_data');
      assert(fsMain?.landingContent, 'app_state/main_data deve conter landingContent');
      assert.strictEqual(fsMain.landingContent.heroHeadlineHighlight, 'Living Persist 1C');

      const hydrated = await fetchAppStateFromFirestore();
      assert.strictEqual(hydrated?.landingContent?.heroHeadlineHighlight, 'Living Persist 1C');
    });

    await test('2. POST /api/tutors/:id/reject confirma tutors/{uid}, suporta pendentes sem users/{uid}, e falha sem mutar RAM', async () => {
      resetInMemoryDbForTesting();

      // Seed pending tutor only in /tutors/{uid} and RAM (no users/{uid} yet)
      const pendingDoc = {
        id: TUTOR_PEND_UID,
        uid: TUTOR_PEND_UID,
        authUid: TUTOR_PEND_UID,
        publicTutorId: 'tutor-pend-p1c',
        email: TUTOR_PEND_EMAIL,
        name: 'Tutor Pendente Reject',
        role: 'teacher',
        approvalStatus: 'pending',
        isApproved: false,
        status: 'pending',
        approved: false,
      };
      mockFs._setDoc('tutors', TUTOR_PEND_UID, pendingDoc);
      readDb().tutorsList.push({ ...pendingDoc });
      readDb().teachers.push({
        id: TUTOR_PEND_UID,
        uid: TUTOR_PEND_UID,
        email: TUTOR_PEND_EMAIL,
        name: 'Tutor Pendente Reject',
        role: 'teacher',
        approvalStatus: 'pending',
        isApproved: false,
      });

      // 2a. Failure on Firestore -> 500, RAM and Firestore stay pending
      mockFs._setFailOnSet('tutors');
      try {
        const failRes = await makeRequest(
          server,
          'POST',
          `/api/tutors/${TUTOR_PEND_UID}/reject`,
          {},
          { Authorization: 'Bearer tok-admin' }
        );
        assert.strictEqual(failRes.status, 500);
        assert.notStrictEqual(failRes.data?.success, true);
        assert.strictEqual(
          readDb().tutorsList.find((t: any) => t.uid === TUTOR_PEND_UID)?.approvalStatus,
          'pending',
          'db.tutorsList não pode mudar após falha em /reject'
        );
        assert.strictEqual(
          readDb().teachers.find((t: any) => t.email === TUTOR_PEND_EMAIL)?.approvalStatus,
          'pending',
          'db.teachers não pode mudar após falha em /reject'
        );
        assert.strictEqual(mockFs._getDoc('tutors', TUTOR_PEND_UID)?.approvalStatus, 'pending');
      } finally {
        mockFs._setFailOnSet(null);
      }

      // 2b. Success -> Firestore tutors/{uid} and RAM updated
      const okRes = await makeRequest(
        server,
        'POST',
        '/api/tutors/tutor-pend-p1c/reject',
        {},
        { Authorization: 'Bearer tok-admin' }
      );
      assert.strictEqual(okRes.status, 200);
      assert.strictEqual(okRes.data.success, true);
      assert.strictEqual(okRes.data.rejectedTutor?.approvalStatus, 'rejected');
      assert.strictEqual(mockFs._getDoc('tutors', TUTOR_PEND_UID)?.approvalStatus, 'rejected');
      assert.strictEqual(mockFs._getDoc('tutors', TUTOR_PEND_UID)?.isApproved, false);
      assert.strictEqual(readDb().tutorsList.find((t: any) => t.uid === TUTOR_PEND_UID)?.approvalStatus, 'rejected');
      assert.strictEqual(readDb().teachers.find((t: any) => t.email === TUTOR_PEND_EMAIL)?.approvalStatus, 'rejected');

      // 2c. Cannot reject student account (409) & unknown returns 404
      mockFs._setDoc('users', STU_HIJACK_UID, {
        id: STU_HIJACK_UID,
        uid: STU_HIJACK_UID,
        email: STU_HIJACK_EMAIL,
        role: 'student',
      });
      const hijackRes = await makeRequest(
        server,
        'POST',
        `/api/tutors/${STU_HIJACK_UID}/reject`,
        { tutor: { uid: STU_HIJACK_UID, email: STU_HIJACK_EMAIL, name: 'Hijack' } },
        { Authorization: 'Bearer tok-admin' }
      );
      assert.strictEqual(hijackRes.status, 409);

      const notFoundRes = await makeRequest(
        server,
        'POST',
        '/api/tutors/nonexistent-tutor-p1c/reject',
        {},
        { Authorization: 'Bearer tok-admin' }
      );
      assert.strictEqual(notFoundRes.status, 404);
    });

    await test('3. DELETE /api/tutors/:id confirma remoção e blacklist antes de mutar RAM, e rollback em falha parcial', async () => {
      resetInMemoryDbForTesting();

      const tutorToDelete = {
        id: TUTOR_DEL_UID,
        uid: TUTOR_DEL_UID,
        authUid: TUTOR_DEL_UID,
        publicTutorId: 'tutor-del-p1c',
        email: TUTOR_DEL_EMAIL,
        name: 'Tutor Delete P1C',
        role: 'teacher',
        approvalStatus: 'approved',
        isApproved: true,
      };
      mockFs._setDoc('tutors', TUTOR_DEL_UID, tutorToDelete);
      mockFs._setDoc('users', TUTOR_DEL_UID, tutorToDelete);
      readDb().tutorsList.push({ ...tutorToDelete });
      readDb().teachers.push({ ...tutorToDelete });
      readDb().meetSettings[TUTOR_DEL_EMAIL] = { meetLink: 'https://meet.google.com/abc-defg-hij' } as any;
      readDb().authUsers[TUTOR_DEL_EMAIL] = { uid: TUTOR_DEL_UID, email: TUTOR_DEL_EMAIL, name: 'Tutor Delete P1C', role: 'teacher' };

      // 3a. Atomic failure on app_state after staged deletes -> users/{uid} & tutors/{uid} NOT deleted & RAM untouched
      mockFs._setFailOnSet('app_state');
      try {
        const failStateRes = await makeRequest(
          server,
          'DELETE',
          `/api/tutors/${TUTOR_DEL_UID}?email=${encodeURIComponent(TUTOR_DEL_EMAIL)}`,
          undefined,
          { Authorization: 'Bearer tok-admin' }
        );
        assert.strictEqual(failStateRes.status, 500);
        assert.notStrictEqual(failStateRes.data?.success, true);
        assert(mockFs._getDoc('tutors', TUTOR_DEL_UID), 'tutors/{uid} não pode ser removido quando app_state falha');
        assert(mockFs._getDoc('users', TUTOR_DEL_UID), 'users/{uid} não pode ser removido quando app_state falha');
        assert(readDb().tutorsList.some((t: any) => t.uid === TUTOR_DEL_UID), 'RAM db.tutorsList intacta');
        assert(readDb().teachers.some((t: any) => t.email === TUTOR_DEL_EMAIL), 'RAM db.teachers intacta');
        assert(!readDb().deletedTutorEmails?.includes(TUTOR_DEL_EMAIL), 'RAM deletedTutorEmails intacta');
        assert(readDb().meetSettings[TUTOR_DEL_EMAIL], 'RAM meetSettings intacta');
        assert(readDb().authUsers[TUTOR_DEL_EMAIL], 'RAM authUsers intacta');
      } finally {
        mockFs._setFailOnSet(null);
      }

      // 3b. Simulated delete failure on tutors -> 500 and RAM untouched
      mockFs._setFailOnDelete('tutors');
      try {
        const failDelRes = await makeRequest(
          server,
          'DELETE',
          `/api/tutors/${TUTOR_DEL_UID}`,
          undefined,
          { Authorization: 'Bearer tok-admin' }
        );
        assert.strictEqual(failDelRes.status, 500);
        assert(readDb().tutorsList.some((t: any) => t.uid === TUTOR_DEL_UID), 'RAM db.tutorsList intacta após falha de delete');
      } finally {
        mockFs._setFailOnDelete(null);
      }

      // 3c. Admin protection (403)
      mockFs._setDoc('users', ADMIN_UID, { id: ADMIN_UID, uid: ADMIN_UID, email: ADMIN_EMAIL, role: 'admin' });
      const adminDelRes = await makeRequest(
        server,
        'DELETE',
        `/api/tutors/${ADMIN_UID}`,
        undefined,
        { Authorization: 'Bearer tok-admin' }
      );
      assert.strictEqual(adminDelRes.status, 403);

      // 3d. Success -> deleted from Firestore /tutors, /users, recorded in app_state/tutors & RAM cleaned
      const okDelRes = await makeRequest(
        server,
        'DELETE',
        `/api/tutors/${TUTOR_DEL_UID}?email=${encodeURIComponent(TUTOR_DEL_EMAIL)}`,
        undefined,
        { Authorization: 'Bearer tok-admin' }
      );
      assert.strictEqual(okDelRes.status, 200);
      assert.strictEqual(okDelRes.data.success, true);
      assert.strictEqual(mockFs._getDoc('tutors', TUTOR_DEL_UID), undefined);
      assert.strictEqual(mockFs._getDoc('users', TUTOR_DEL_UID), undefined);
      const fsTutorsState = mockFs._getDoc('app_state', 'tutors');
      assert(fsTutorsState?.deletedTutorIds?.includes(TUTOR_DEL_UID.toLowerCase()));
      assert(fsTutorsState?.deletedTutorEmails?.includes(TUTOR_DEL_EMAIL));
      assert(!readDb().tutorsList.some((t: any) => t.uid === TUTOR_DEL_UID));
      assert(!readDb().teachers.some((t: any) => t.email === TUTOR_DEL_EMAIL));
      assert.strictEqual(readDb().authUsers[TUTOR_DEL_EMAIL], undefined);
    });

    await test('4. POST /api/teachers (pendente não-FIN.2B) e DELETE /api/teachers/:email confirmam Firestore antes da RAM e preservam FIN.2B', async () => {
      resetInMemoryDbForTesting();

      // 4a. FIN.2B guard preserved: approved without commission -> 400
      const finGuardRes = await makeRequest(
        server,
        'POST',
        '/api/teachers',
        { uid: TEACHER_POST_UID, email: TEACHER_POST_EMAIL, name: 'No Comm', approvalStatus: 'approved' },
        { Authorization: 'Bearer tok-admin' }
      );
      assert.strictEqual(finGuardRes.status, 400);

      // 4b. Failure on Firestore -> 500 and RAM untouched
      mockFs._setFailOnSet('app_state');
      try {
        const failPostRes = await makeRequest(
          server,
          'POST',
          '/api/teachers',
          { uid: TEACHER_POST_UID, email: TEACHER_POST_EMAIL, name: 'Pending Fail Teacher' },
          { Authorization: 'Bearer tok-admin' }
        );
        assert.strictEqual(failPostRes.status, 500);
        assert.notStrictEqual(failPostRes.data?.success, true);
        assert.strictEqual(mockFs._getDoc('tutors', TEACHER_POST_UID), undefined, 'tutors/{uid} não gravado em falha atômica');
        assert(!readDb().teachers.some((t: any) => t.email === TEACHER_POST_EMAIL), 'db.teachers não pode mudar após falha');
      } finally {
        mockFs._setFailOnSet(null);
      }

      // 4c. Success pending POST /api/teachers -> persists tutors/{uid} and app_state/tutors.teachers
      const okPostRes = await makeRequest(
        server,
        'POST',
        '/api/teachers',
        { uid: TEACHER_POST_UID, email: TEACHER_POST_EMAIL, name: 'Pending OK Teacher' },
        { Authorization: 'Bearer tok-admin' }
      );
      assert.strictEqual(okPostRes.status, 200);
      assert.strictEqual(okPostRes.data.success, true);
      assert.strictEqual(mockFs._getDoc('tutors', TEACHER_POST_UID)?.name, 'Pending OK Teacher');
      assert.strictEqual(mockFs._getDoc('tutors', TEACHER_POST_UID)?.approvalStatus, 'pending');
      assert.strictEqual(mockFs._getDoc('tutors', TEACHER_POST_UID)?.isApproved, false);
      assert(
        mockFs._getDoc('app_state', 'tutors')?.teachers?.some((t: any) => t.email === TEACHER_POST_EMAIL),
        'app_state/tutors.teachers deve persistir professor pendente'
      );
      assert(readDb().teachers.some((t: any) => t.email === TEACHER_POST_EMAIL));

      // 4d. DELETE /api/teachers/:email failure -> 500 and RAM untouched
      mockFs._setFailOnSet('app_state');
      try {
        const failDelTeacherRes = await makeRequest(
          server,
          'DELETE',
          `/api/teachers/${encodeURIComponent(TEACHER_POST_EMAIL)}`,
          undefined,
          { Authorization: 'Bearer tok-admin' }
        );
        assert.strictEqual(failDelTeacherRes.status, 500);
        assert(readDb().teachers.some((t: any) => t.email === TEACHER_POST_EMAIL), 'db.teachers intacto em falha');
        assert(mockFs._getDoc('tutors', TEACHER_POST_UID), 'tutors/{uid} preservado em rollback');
      } finally {
        mockFs._setFailOnSet(null);
      }

      // 4e. DELETE /api/teachers/:email admin safeguard -> 403
      const delAdminRes = await makeRequest(
        server,
        'DELETE',
        `/api/teachers/${encodeURIComponent(ADMIN_EMAIL)}`,
        undefined,
        { Authorization: 'Bearer tok-admin' }
      );
      assert.strictEqual(delAdminRes.status, 403);

      // 4f. DELETE /api/teachers/:email success -> removes from Firestore and RAM
      const okDelTeacherRes = await makeRequest(
        server,
        'DELETE',
        `/api/teachers/${encodeURIComponent(TEACHER_POST_EMAIL)}`,
        undefined,
        { Authorization: 'Bearer tok-admin' }
      );
      assert.strictEqual(okDelTeacherRes.status, 200);
      assert.strictEqual(okDelTeacherRes.data.success, true);
      assert.strictEqual(mockFs._getDoc('tutors', TEACHER_POST_UID), undefined);
      assert(!mockFs._getDoc('app_state', 'tutors')?.teachers?.some((t: any) => t.email === TEACHER_POST_EMAIL));
      assert(!readDb().teachers.some((t: any) => t.email === TEACHER_POST_EMAIL));
    });

    await test('5. DELETE /api/students/:identifier confirma users/{uid}, student_assignments/{uid} e deletedStudentEmails antes de mutar RAM', async () => {
      resetInMemoryDbForTesting();

      const stuDoc = {
        id: STU_DEL_UID,
        uid: STU_DEL_UID,
        studentUid: STU_DEL_UID,
        email: STU_DEL_EMAIL,
        studentEmail: STU_DEL_EMAIL,
        name: 'Aluno Delete P1C',
        role: 'student',
      };
      mockFs._setDoc('users', STU_DEL_UID, stuDoc);
      mockFs._setDoc('student_assignments', STU_DEL_UID, { uid: STU_DEL_UID, studentUid: STU_DEL_UID, email: STU_DEL_EMAIL });
      readDb().students.push({ ...stuDoc } as any);
      readDb().userProfiles[STU_DEL_EMAIL] = { ...stuDoc };
      readDb().contractedLessons[STU_DEL_EMAIL] = 5;
      readDb().authUsers[STU_DEL_EMAIL] = { uid: STU_DEL_UID, email: STU_DEL_EMAIL, name: 'Aluno Delete P1C', role: 'student' };
      readDb().studentRoutinesMap[STU_DEL_EMAIL] = { monday: [] };

      // 5a. Failure on app_state -> users/{uid} & student_assignments/{uid} NOT deleted & RAM untouched
      mockFs._setFailOnSet('app_state');
      try {
        const failRes = await makeRequest(
          server,
          'DELETE',
          `/api/students/${encodeURIComponent(STU_DEL_EMAIL)}`,
          undefined,
          { Authorization: 'Bearer tok-admin' }
        );
        assert.strictEqual(failRes.status, 500);
        assert.notStrictEqual(failRes.data?.success, true);
        assert(mockFs._getDoc('users', STU_DEL_UID), 'users/{uid} preservado em falha');
        assert(mockFs._getDoc('student_assignments', STU_DEL_UID), 'student_assignments/{uid} preservado em falha');
        assert(readDb().students.some((s) => s.uid === STU_DEL_UID), 'RAM db.students intacta');
        assert(readDb().userProfiles[STU_DEL_EMAIL], 'RAM db.userProfiles intacto');
        assert.strictEqual(readDb().contractedLessons[STU_DEL_EMAIL], 5, 'RAM db.contractedLessons intacto');
        assert(readDb().authUsers[STU_DEL_EMAIL], 'RAM db.authUsers intacto');
        assert(readDb().studentRoutinesMap[STU_DEL_EMAIL], 'RAM db.studentRoutinesMap intacto');
        assert(!readDb().deletedStudentEmails?.includes(STU_DEL_EMAIL), 'RAM deletedStudentEmails intacto');
      } finally {
        mockFs._setFailOnSet(null);
      }

      // 5b. Failure on users delete -> 500 and RAM untouched
      mockFs._setFailOnDelete('users');
      try {
        const failUsersRes = await makeRequest(
          server,
          'DELETE',
          `/api/students/${STU_DEL_UID}`,
          undefined,
          { Authorization: 'Bearer tok-admin' }
        );
        assert.strictEqual(failUsersRes.status, 500);
        assert(readDb().students.some((s) => s.uid === STU_DEL_UID), 'RAM db.students intacta após falha de delete em users');
      } finally {
        mockFs._setFailOnDelete(null);
      }

      // 5c. Admin safeguard -> 403
      const delAdminStuRes = await makeRequest(
        server,
        'DELETE',
        `/api/students/${encodeURIComponent(ADMIN_EMAIL)}`,
        undefined,
        { Authorization: 'Bearer tok-admin' }
      );
      assert.strictEqual(delAdminStuRes.status, 403);

      // 5d. Success -> users/{uid} & student_assignments/{uid} deleted, deletedStudentEmails persisted, RAM cleaned
      const okDelRes = await makeRequest(
        server,
        'DELETE',
        `/api/students/${encodeURIComponent(STU_DEL_EMAIL)}`,
        undefined,
        { Authorization: 'Bearer tok-admin' }
      );
      assert.strictEqual(okDelRes.status, 200);
      assert.strictEqual(okDelRes.data.success, true);
      assert.strictEqual(okDelRes.data.email, STU_DEL_EMAIL);
      assert.strictEqual(mockFs._getDoc('users', STU_DEL_UID), undefined);
      assert.strictEqual(mockFs._getDoc('student_assignments', STU_DEL_UID), undefined);
      assert(mockFs._getDoc('app_state', 'main_data')?.deletedStudentEmails?.includes(STU_DEL_EMAIL));
      assert(!readDb().students.some((s) => s.uid === STU_DEL_UID));
      assert.strictEqual(readDb().userProfiles[STU_DEL_EMAIL], undefined);
      assert.strictEqual(readDb().contractedLessons[STU_DEL_EMAIL], undefined);
      assert.strictEqual(readDb().authUsers[STU_DEL_EMAIL], undefined);
      assert.strictEqual(readDb().studentRoutinesMap[STU_DEL_EMAIL], undefined);
      assert(readDb().deletedStudentEmails?.includes(STU_DEL_EMAIL));
    });

    await test('6. Firestore indisponível (503) e RBAC (401/403) preservados em todas as rotas administrativas corrigidas', async () => {
      resetInMemoryDbForTesting();

      // RBAC checks
      assert.strictEqual((await makeRequest(server, 'POST', '/api/landing-content', { heroHeadlineHighlight: 'X' })).status, 401);
      assert.strictEqual((await makeRequest(server, 'POST', '/api/landing-content', { heroHeadlineHighlight: 'X' }, { Authorization: 'Bearer tok-student' })).status, 403);
      assert.strictEqual((await makeRequest(server, 'POST', '/api/landing-content', { heroHeadlineHighlight: 'X' }, { Authorization: 'Bearer tok-teacher' })).status, 403);
      assert.strictEqual((await makeRequest(server, 'DELETE', `/api/tutors/${TUTOR_DEL_UID}`)).status, 401);
      assert.strictEqual((await makeRequest(server, 'DELETE', `/api/tutors/${TUTOR_DEL_UID}`, undefined, { Authorization: 'Bearer tok-student' })).status, 403);
      assert.strictEqual((await makeRequest(server, 'POST', `/api/tutors/${TUTOR_PEND_UID}/reject`)).status, 401);
      assert.strictEqual((await makeRequest(server, 'POST', `/api/tutors/${TUTOR_PEND_UID}/reject`, {}, { Authorization: 'Bearer tok-teacher' })).status, 403);
      assert.strictEqual((await makeRequest(server, 'POST', '/api/teachers', { email: 'x@y.com' })).status, 401);
      assert.strictEqual((await makeRequest(server, 'POST', '/api/teachers', { email: 'x@y.com' }, { Authorization: 'Bearer tok-student' })).status, 403);
      assert.strictEqual((await makeRequest(server, 'DELETE', '/api/teachers/x@y.com')).status, 401);
      assert.strictEqual((await makeRequest(server, 'DELETE', '/api/teachers/x@y.com', undefined, { Authorization: 'Bearer tok-student' })).status, 403);
      assert.strictEqual((await makeRequest(server, 'DELETE', '/api/students/x@y.com')).status, 401);
      assert.strictEqual((await makeRequest(server, 'DELETE', '/api/students/x@y.com', undefined, { Authorization: 'Bearer tok-teacher' })).status, 403);

      // 503 checks when Firestore is null
      setFirebaseAdminFirestoreForTesting(null);
      try {
        const r1 = await makeRequest(server, 'POST', '/api/landing-content', { heroHeadlineHighlight: 'X' }, { Authorization: 'Bearer tok-admin' });
        assert.strictEqual(r1.status, 503);
        assert.strictEqual(r1.data.error, 'FIRESTORE_UNAVAILABLE');

        const r2 = await makeRequest(server, 'DELETE', `/api/tutors/${TUTOR_DEL_UID}`, undefined, { Authorization: 'Bearer tok-admin' });
        assert.strictEqual(r2.status, 503);
        assert.strictEqual(r2.data.error, 'FIRESTORE_UNAVAILABLE');

        const r3 = await makeRequest(server, 'POST', `/api/tutors/${TUTOR_PEND_UID}/reject`, {}, { Authorization: 'Bearer tok-admin' });
        assert.strictEqual(r3.status, 503);
        assert.strictEqual(r3.data.error, 'FIRESTORE_UNAVAILABLE');

        const r4 = await makeRequest(server, 'POST', '/api/teachers', { email: 'x@y.com' }, { Authorization: 'Bearer tok-admin' });
        assert.strictEqual(r4.status, 503);
        assert.strictEqual(r4.data.error, 'FIRESTORE_UNAVAILABLE');

        const r5 = await makeRequest(server, 'DELETE', '/api/teachers/x@y.com', undefined, { Authorization: 'Bearer tok-admin' });
        assert.strictEqual(r5.status, 503);
        assert.strictEqual(r5.data.error, 'FIRESTORE_UNAVAILABLE');

        const r6 = await makeRequest(server, 'DELETE', '/api/students/x@y.com', undefined, { Authorization: 'Bearer tok-admin' });
        assert.strictEqual(r6.status, 503);
        assert.strictEqual(r6.data.error, 'FIRESTORE_UNAVAILABLE');
      } finally {
        setFirebaseAdminFirestoreForTesting(mockFs as any);
      }
    });

    await test('7. Fallback sem runTransaction também aguarda e propaga falhas sem mutar RAM', async () => {
      resetInMemoryDbForTesting();
      const noTxFs = createTestFirestoreMock({ disableTransactions: true });
      setFirebaseAdminFirestoreForTesting(noTxFs as any);

      try {
        // Seed tutor for reject & delete fallback
        const noTxTutor = {
          id: TUTOR_NOTX_UID,
          uid: TUTOR_NOTX_UID,
          authUid: TUTOR_NOTX_UID,
          email: TUTOR_NOTX_EMAIL,
          name: 'Tutor NoTx P1C',
          role: 'teacher',
          approvalStatus: 'pending',
          isApproved: false,
        };
        noTxFs._setDoc('tutors', TUTOR_NOTX_UID, noTxTutor);
        readDb().tutorsList.push({ ...noTxTutor });

        // Reject success without runTransaction
        const okReject = await makeRequest(
          server,
          'POST',
          `/api/tutors/${TUTOR_NOTX_UID}/reject`,
          {},
          { Authorization: 'Bearer tok-admin' }
        );
        assert.strictEqual(okReject.status, 200);
        assert.strictEqual(noTxFs._getDoc('tutors', TUTOR_NOTX_UID)?.approvalStatus, 'rejected');

        // POST /api/teachers pending without UID (legacy fallback) failure propagates 500 without RAM mutation
        noTxFs._setFailOnSet('app_state');
        const failTeacher = await makeRequest(
          server,
          'POST',
          '/api/teachers',
          { email: 'legacy.notx@itissimple-test.com', name: 'Legacy NoTx' },
          { Authorization: 'Bearer tok-admin' }
        );
        assert.strictEqual(failTeacher.status, 500);
        assert(!readDb().teachers.some((t: any) => t.email === 'legacy.notx@itissimple-test.com'));
        noTxFs._setFailOnSet(null);

        // Delete tutor failure on app_state propagates 500 without RAM mutation
        noTxFs._setFailOnSet('app_state');
        const failDel = await makeRequest(
          server,
          'DELETE',
          `/api/tutors/${TUTOR_NOTX_UID}`,
          undefined,
          { Authorization: 'Bearer tok-admin' }
        );
        assert.strictEqual(failDel.status, 500);
        assert(readDb().tutorsList.some((t: any) => t.uid === TUTOR_NOTX_UID));
      } finally {
        noTxFs._setFailOnSet(null);
        noTxFs._setFailOnDelete(null);
        setFirebaseAdminFirestoreForTesting(mockFs as any);
      }
    });
  } finally {
    resetFirebaseAdminFirestoreForTesting();
    resetFirebaseAdminForTesting();
    resetInMemoryDbForTesting();
    server.closeAllConnections?.();
    server.close();
  }

  console.log('\n======================================================================');
  console.log(`PERSIST.1C SUITE: ${passed} PASSED, ${failed} FAILED`);
  console.log('======================================================================');
  process.exit(failed > 0 ? 1 : 0);
}

runSuite().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
