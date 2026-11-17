/**
 * TEST SUITE: FIN.2D.1A — HARDENING MÍNIMO DE SEGURANÇA
 * Behavioral HTTP integration test suite against serverApp (never source-only checks).
 * Uses strictly isolated in-memory Firestore (default) and Firebase Admin Auth mocks.
 */

process.env.NODE_ENV = 'test';
process.env.FIREBASE_PROJECT_ID = 'itissimple-security-staging';
process.env.FIREBASE_DATABASE_ID = '(default)';
process.env.PAYMENTS_ENABLED = 'false';

import assert from 'assert';
import http from 'http';
import { app as serverApp, readDb } from '../serverApp';
import {
  setFirebaseAdminFirestoreForTesting,
  resetFirebaseAdminFirestoreForTesting,
} from '../src/serverFirestore';
import {
  setFirebaseAdminAuthForTesting,
  resetFirebaseAdminForTesting,
} from '../src/serverFirebaseAdmin';

function createIsolatedFirestoreMock() {
  const store = new Map<string, Record<string, any>>();

  const matchFilters = (data: Record<string, any>, filters: Array<{ field: string; op: string; val: any }>) => {
    return filters.every((f) => {
      const val = data[f.field];
      if (f.op === '==') return val === f.val;
      return false;
    });
  };

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
      set: async (data: Record<string, any>, opts?: { merge?: boolean }) => {
        const prev = opts?.merge ? (store.get(key) || {}) : {};
        store.set(key, JSON.parse(JSON.stringify({ ...prev, ...data })));
        return { writeTime: new Date() };
      },
      update: async (data: Record<string, any>) => {
        const prev = store.get(key) || {};
        store.set(key, JSON.parse(JSON.stringify({ ...prev, ...data })));
        return { writeTime: new Date() };
      },
      delete: async () => {
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

  return {
    collection: (col: string) => makeCollectionRef(col),
    runTransaction: async (fn: (tx: any) => Promise<any>) => {
      const staged: Array<{ key: string; data: Record<string, any>; merge: boolean }> = [];
      const tx = {
        get: async (ref: any) => ref.get(),
        set: (ref: any, data: Record<string, any>, opts?: { merge?: boolean }) => {
          staged.push({
            key: `${ref._col}::${ref._id}`,
            data: JSON.parse(JSON.stringify(data)),
            merge: Boolean(opts?.merge),
          });
        },
        update: (ref: any, data: Record<string, any>) => {
          staged.push({
            key: `${ref._col}::${ref._id}`,
            data: JSON.parse(JSON.stringify(data)),
            merge: true,
          });
        },
      };
      const result = await fn(tx);
      for (const w of staged) {
        const prev = w.merge ? (store.get(w.key) || {}) : {};
        store.set(w.key, JSON.parse(JSON.stringify({ ...prev, ...w.data })));
      }
      return result;
    },
    _store: store,
    _setDoc: (col: string, id: string, data: Record<string, any>) => {
      store.set(`${col}::${id}`, JSON.parse(JSON.stringify(data)));
    },
    _getDoc: (col: string, id: string) => store.get(`${col}::${id}`),
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
  console.log('FIN.2D.1A — HARDENING MÍNIMO DE SEGURANÇA (TESTES COMPORTAMENTAIS)');
  console.log('======================================================================\n');

  let passed = 0;
  let failed = 0;

  async function test(name: string, fn: () => void | Promise<void>) {
    try {
      await fn();
      console.log(`  ✅ PASS: ${name}`);
      passed++;
    } catch (err: any) {
      console.error(`  ❌ FAIL: ${name}`);
      console.error(`         ${err?.message || err}`);
      failed++;
    }
  }

  const mockFs = createIsolatedFirestoreMock();
  setFirebaseAdminFirestoreForTesting(mockFs as any);

  // Canonical test identities (28+ chars Firebase-like UIDs)
  const ADMIN_UID = 'Fin2dAdminCanonicalUid000001';
  const ADMIN_EMAIL = 'adm.itissimple@gmail.com';
  const LINKED_TEACHER_UID = 'Fin2dLinkedTeacherUid0000002';
  const LINKED_TEACHER_EMAIL = 'charles.fin2d@itissimple-test.com';
  const UNLINKED_TEACHER_UID = 'Fin2dUnlinkedTeacherUid00003';
  const UNLINKED_TEACHER_EMAIL = 'other.fin2d@itissimple-test.com';
  const STUDENT_A_UID = 'Fin2dStudentACanonicalUid004';
  const STUDENT_A_EMAIL = 'aluna.a.fin2d@itissimple-test.com';
  const STUDENT_B_UID = 'Fin2dStudentBCanonicalUid005';
  const STUDENT_B_EMAIL = 'aluna.b.fin2d@itissimple-test.com';
  const NEW_SIGNUP_UID = 'Fin2dNewSignupStudentUid0006';
  const NEW_SIGNUP_EMAIL = 'nova.aluna.fin2d@itissimple-test.com';
  const GOOGLE_NEW_UID = 'Fin2dGoogleNewStudentUid0007';
  const GOOGLE_NEW_EMAIL = 'google.nova.fin2d@itissimple-test.com';

  // Seed Firestore (default) state
  mockFs._setDoc('users', ADMIN_UID, {
    id: ADMIN_UID,
    uid: ADMIN_UID,
    email: ADMIN_EMAIL,
    name: 'Admin Principal',
    role: 'admin',
  });

  mockFs._setDoc('tutors', LINKED_TEACHER_UID, {
    id: LINKED_TEACHER_UID,
    uid: LINKED_TEACHER_UID,
    authUid: LINKED_TEACHER_UID,
    publicTutorId: 'charles-fin2d',
    email: LINKED_TEACHER_EMAIL,
    name: 'Charles Native Friend',
    role: 'teacher',
    approvalStatus: 'approved',
    isApproved: true,
    approved: true,
    status: 'approved',
    adminCommissionPercent: 25,
    commissionModel: 'MARKUP',
    pricePerSessionUsd: 18,
    bio: 'Initial teacher bio',
    headline: 'Native Coach',
    meetUrl: 'https://meet.google.com/charles-fin2d',
    availableDays: ['monday', 'wednesday', 'friday'],
    availableHours: ['09:00', '10:00', '14:00'],
  });
  mockFs._setDoc('users', LINKED_TEACHER_UID, {
    id: LINKED_TEACHER_UID,
    uid: LINKED_TEACHER_UID,
    authUid: LINKED_TEACHER_UID,
    email: LINKED_TEACHER_EMAIL,
    name: 'Charles Native Friend',
    role: 'teacher',
    approvalStatus: 'approved',
    isApproved: true,
  });

  mockFs._setDoc('tutors', UNLINKED_TEACHER_UID, {
    id: UNLINKED_TEACHER_UID,
    uid: UNLINKED_TEACHER_UID,
    authUid: UNLINKED_TEACHER_UID,
    publicTutorId: 'other-fin2d',
    email: UNLINKED_TEACHER_EMAIL,
    name: 'Other Approved Tutor',
    role: 'teacher',
    approvalStatus: 'approved',
    isApproved: true,
    approved: true,
    status: 'approved',
    adminCommissionPercent: 20,
    commissionModel: 'MARKUP',
  });
  mockFs._setDoc('users', UNLINKED_TEACHER_UID, {
    id: UNLINKED_TEACHER_UID,
    uid: UNLINKED_TEACHER_UID,
    authUid: UNLINKED_TEACHER_UID,
    email: UNLINKED_TEACHER_EMAIL,
    name: 'Other Approved Tutor',
    role: 'teacher',
    approvalStatus: 'approved',
    isApproved: true,
  });

  // Student A: linked to LINKED_TEACHER_UID, has completed trial & 4/3 existing paid credits
  mockFs._setDoc('users', STUDENT_A_UID, {
    id: STUDENT_A_UID,
    uid: STUDENT_A_UID,
    email: STUDENT_A_EMAIL,
    name: 'Aluna A',
    role: 'student',
    level: 'intermediario',
    learningGoal: 'Fluency',
    teacherUid: LINKED_TEACHER_UID,
    assignedNativeFriendUID: LINKED_TEACHER_UID,
    nativeFriendUID: LINKED_TEACHER_UID,
    teacherEmail: LINKED_TEACHER_EMAIL,
    teacherName: 'Charles Native Friend',
    teacherMeetUrl: 'https://meet.google.com/charles-fin2d',
    enrollmentStatus: 'active',
    contractedLessons: 4,
    availableLessons: 3,
    completedLessonsCount: 1,
    hasCompletedTrialLesson: true,
    subscriptionType: 'package',
    onboardingCompleted: true,
    weeklyStudyDays: ['monday', 'wednesday', 'friday'],
    weeklyStudyDaysTarget: 3,
    routineVideoTime: '09:00',
    routineAudioTime: '14:00',
    dailyPhraseTime: '20:00',
  });
  mockFs._setDoc('student_assignments', STUDENT_A_UID, {
    studentUid: STUDENT_A_UID,
    teacherUid: LINKED_TEACHER_UID,
    teacherAuthUid: LINKED_TEACHER_UID,
    assignedNativeFriendUID: LINKED_TEACHER_UID,
    nativeFriendUID: LINKED_TEACHER_UID,
    teacherEmail: LINKED_TEACHER_EMAIL,
    teacherName: 'Charles Native Friend',
    weeklyStudyDays: ['monday', 'wednesday', 'friday'],
    weeklyStudyDaysTarget: 3,
  });

  // Student B: linked to UNLINKED_TEACHER_UID, 6/5 credits
  mockFs._setDoc('users', STUDENT_B_UID, {
    id: STUDENT_B_UID,
    uid: STUDENT_B_UID,
    email: STUDENT_B_EMAIL,
    name: 'Aluna B',
    role: 'student',
    level: 'iniciante',
    teacherUid: UNLINKED_TEACHER_UID,
    assignedNativeFriendUID: UNLINKED_TEACHER_UID,
    teacherEmail: UNLINKED_TEACHER_EMAIL,
    teacherName: 'Other Approved Tutor',
    enrollmentStatus: 'active',
    contractedLessons: 6,
    availableLessons: 5,
    completedLessonsCount: 1,
    hasCompletedTrialLesson: true,
    subscriptionType: 'package',
  });

  const TOKEN_MAP: Record<string, any> = {
    'admin-token': { uid: ADMIN_UID, email: ADMIN_EMAIL, email_verified: true, role: 'admin', admin: true },
    'linked-teacher-token': { uid: LINKED_TEACHER_UID, email: LINKED_TEACHER_EMAIL, email_verified: true },
    'unlinked-teacher-token': { uid: UNLINKED_TEACHER_UID, email: UNLINKED_TEACHER_EMAIL, email_verified: true },
    'student-a-token': { uid: STUDENT_A_UID, email: STUDENT_A_EMAIL, email_verified: true },
    'student-b-token': { uid: STUDENT_B_UID, email: STUDENT_B_EMAIL, email_verified: true },
    'new-signup-token': { uid: NEW_SIGNUP_UID, email: NEW_SIGNUP_EMAIL, email_verified: true },
    'google-new-token': { uid: GOOGLE_NEW_UID, email: GOOGLE_NEW_EMAIL, email_verified: true },
  };

  setFirebaseAdminAuthForTesting({
    verifyIdToken: async (token: string) => {
      if (TOKEN_MAP[token]) return TOKEN_MAP[token];
      throw new Error('Invalid test token');
    },
    getUser: async (uid: string) => {
      const entry = Object.values(TOKEN_MAP).find((u: any) => u.uid === uid);
      if (entry) return entry;
      const err: any = new Error('User not found');
      err.code = 'auth/user-not-found';
      throw err;
    },
    getUserByEmail: async (email: string) => {
      const entry = Object.values(TOKEN_MAP).find((u: any) => u.email === email);
      if (entry) return entry;
      const err: any = new Error('User not found');
      err.code = 'auth/user-not-found';
      throw err;
    },
  } as any);

  const server = http.createServer(serverApp);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    // -----------------------------------------------------------------------
    // 1. Auth & Role Isolation on GET /api/user-profile
    // -----------------------------------------------------------------------
    await test('1. GET /api/user-profile exige token, bloqueia acesso cruzado, preserva vínculo e oculta comissão', async () => {
      const unauth = await makeRequest(server, 'GET', `/api/user-profile?uid=${STUDENT_A_UID}`);
      assert.strictEqual(unauth.status, 401);

      const synthUid = await makeRequest(server, 'GET', '/api/user-profile?uid=st-123456', undefined, {
        Authorization: 'Bearer student-a-token',
      });
      assert.strictEqual(synthUid.status, 400);

      // Student A reads own profile
      const ownRes = await makeRequest(server, 'GET', `/api/user-profile?uid=${STUDENT_A_UID}`, undefined, {
        Authorization: 'Bearer student-a-token',
      });
      assert.strictEqual(ownRes.status, 200);
      assert.strictEqual(ownRes.data.profile?.uid, STUDENT_A_UID);
      assert.strictEqual(ownRes.data.profile?.contractedLessons, 4);
      assert.strictEqual(ownRes.data.profile?.availableLessons, 3);

      // Student A cannot read Student B
      const crossStu = await makeRequest(
        server,
        'GET',
        `/api/user-profile?uid=${STUDENT_B_UID}&email=${encodeURIComponent(STUDENT_B_EMAIL)}`,
        undefined,
        { Authorization: 'Bearer student-a-token' }
      );
      assert.strictEqual(crossStu.status, 403);

      // Unlinked teacher cannot read Student A
      const unlinkedTch = await makeRequest(
        server,
        'GET',
        `/api/user-profile?uid=${STUDENT_A_UID}&email=${encodeURIComponent(STUDENT_A_EMAIL)}`,
        undefined,
        { Authorization: 'Bearer unlinked-teacher-token' }
      );
      assert.strictEqual(unlinkedTch.status, 403);

      // Linked teacher CAN read Student A
      const linkedTch = await makeRequest(
        server,
        'GET',
        `/api/user-profile?uid=${STUDENT_A_UID}&email=${encodeURIComponent(STUDENT_A_EMAIL)}`,
        undefined,
        { Authorization: 'Bearer linked-teacher-token' }
      );
      assert.strictEqual(linkedTch.status, 200);
      assert.strictEqual(linkedTch.data.profile?.uid, STUDENT_A_UID);

      // Teacher cannot inspect another teacher or admin
      const tchInspectOtherTch = await makeRequest(
        server,
        'GET',
        `/api/user-profile?uid=${UNLINKED_TEACHER_UID}&email=${encodeURIComponent(UNLINKED_TEACHER_EMAIL)}`,
        undefined,
        { Authorization: 'Bearer linked-teacher-token' }
      );
      assert.strictEqual(tchInspectOtherTch.status, 403);

      // Teacher reading own profile succeeds and strips adminCommissionPercent
      const tchSelf = await makeRequest(
        server,
        'GET',
        `/api/user-profile?uid=${LINKED_TEACHER_UID}&email=${encodeURIComponent(LINKED_TEACHER_EMAIL)}`,
        undefined,
        { Authorization: 'Bearer linked-teacher-token' }
      );
      assert.strictEqual(tchSelf.status, 200);
      assert.strictEqual(tchSelf.data.isTeacher, true);
      assert.strictEqual(tchSelf.data.tutor?.adminCommissionPercent, undefined);
      assert.strictEqual(tchSelf.data.tutor?.commissionModel, undefined);

      // Admin reading teacher profile receives adminCommissionPercent
      const adminReadTch = await makeRequest(
        server,
        'GET',
        `/api/user-profile?uid=${LINKED_TEACHER_UID}&email=${encodeURIComponent(LINKED_TEACHER_EMAIL)}`,
        undefined,
        { Authorization: 'Bearer admin-token' }
      );
      assert.strictEqual(adminReadTch.status, 200);
      assert.strictEqual(adminReadTch.data.tutor?.adminCommissionPercent, 25);
    });

    // -----------------------------------------------------------------------
    // 2. POST /api/user-profile Privilege, Trial, Credits & Persistence Hardening
    // -----------------------------------------------------------------------
    await test('2. POST /api/user-profile impede escalada de papel, reinício de trial e injeção de créditos preservando preferências', async () => {
      // Unauth -> 401
      const unauth = await makeRequest(server, 'POST', '/api/user-profile', {
        uid: STUDENT_A_UID,
        profile: { level: 'avancado' },
      });
      assert.strictEqual(unauth.status, 401);

      // Student B trying to overwrite Student A -> 403
      const crossWrite = await makeRequest(
        server,
        'POST',
        '/api/user-profile',
        {
          uid: STUDENT_A_UID,
          email: STUDENT_A_EMAIL,
          profile: { learningGoal: 'Hacked' },
        },
        { Authorization: 'Bearer student-b-token' }
      );
      assert.strictEqual(crossWrite.status, 403);

      // Student A trying to escalate role, reset trial, alter subscriptionType, and inject credits while changing legitimate preferences
      const stuTamper = await makeRequest(
        server,
        'POST',
        '/api/user-profile',
        {
          uid: STUDENT_A_UID,
          email: STUDENT_A_EMAIL,
          profile: {
            level: 'avancado',
            learningGoal: 'Executive Interviews',
            routineVideoTime: '08:30',
            weeklyStudyDays: ['monday', 'tuesday', 'thursday'],
            weeklyStudyDaysTarget: 3,
            // Malicious privileged fields
            role: 'admin',
            isApproved: true,
            approvalStatus: 'approved',
            adminCommissionPercent: 0,
            contractedLessons: 999,
            availableLessons: 999,
            completedLessonsCount: 50,
            hasCompletedTrialLesson: false,
            subscriptionType: 'unlimited_vip',
          },
        },
        { Authorization: 'Bearer student-a-token' }
      );
      assert.strictEqual(stuTamper.status, 200);
      assert.strictEqual(stuTamper.data.profile?.role, 'student');
      assert.strictEqual(stuTamper.data.profile?.level, 'avancado');
      assert.strictEqual(stuTamper.data.profile?.learningGoal, 'Executive Interviews');
      assert.strictEqual(stuTamper.data.profile?.routineVideoTime, '08:30');
      assert.strictEqual(stuTamper.data.profile?.contractedLessons, 4, 'Must preserve authoritative contractedLessons');
      assert.strictEqual(stuTamper.data.profile?.availableLessons, 3, 'Must preserve authoritative availableLessons');
      assert.strictEqual(stuTamper.data.profile?.completedLessonsCount, 1, 'Must preserve completedLessonsCount');
      assert.strictEqual(stuTamper.data.profile?.hasCompletedTrialLesson, true, 'Cannot reset hasCompletedTrialLesson to false');
      assert.strictEqual(stuTamper.data.profile?.subscriptionType, 'package', 'Cannot forge subscriptionType');

      const fsStudentA = mockFs._getDoc('users', STUDENT_A_UID);
      assert.strictEqual(fsStudentA?.role, 'student');
      assert.strictEqual(fsStudentA?.level, 'avancado');
      assert.strictEqual(fsStudentA?.learningGoal, 'Executive Interviews');
      assert.strictEqual(fsStudentA?.contractedLessons, 4);
      assert.strictEqual(fsStudentA?.availableLessons, 3);
      assert.strictEqual(fsStudentA?.hasCompletedTrialLesson, true);
      assert.strictEqual(fsStudentA?.subscriptionType, 'package');

      // Teacher trying to escalate role/approval/commission while updating bio/headline
      const tchTamper = await makeRequest(
        server,
        'POST',
        '/api/user-profile',
        {
          uid: LINKED_TEACHER_UID,
          email: LINKED_TEACHER_EMAIL,
          profile: {
            bio: 'Updated authentic bio',
            headline: 'Updated Native Coach',
            role: 'admin',
            approvalStatus: 'pending',
            isApproved: false,
            registeredByAdmin: true,
            adminCommissionPercent: 1,
            commissionModel: 'PERCENTAGE',
          },
        },
        { Authorization: 'Bearer linked-teacher-token' }
      );
      assert.strictEqual(tchTamper.status, 200);
      assert.strictEqual(tchTamper.data.isTeacher, true);
      assert.strictEqual(tchTamper.data.tutor?.bio, 'Updated authentic bio');
      assert.strictEqual(tchTamper.data.tutor?.role, 'teacher');
      assert.strictEqual(tchTamper.data.tutor?.approvalStatus, 'approved');
      assert.strictEqual(tchTamper.data.tutor?.isApproved, true);
      assert.strictEqual(tchTamper.data.tutor?.adminCommissionPercent, undefined);

      const fsTutor = mockFs._getDoc('tutors', LINKED_TEACHER_UID);
      assert.strictEqual(fsTutor?.bio, 'Updated authentic bio');
      assert.strictEqual(fsTutor?.role, 'teacher');
      assert.strictEqual(fsTutor?.approvalStatus, 'approved');
      assert.strictEqual(fsTutor?.adminCommissionPercent, 25);
      assert.strictEqual(fsTutor?.commissionModel, 'MARKUP');
    });

    // -----------------------------------------------------------------------
    // 3. /api/auth/signup & /api/auth/register Credit Injection & Balance Preservation
    // -----------------------------------------------------------------------
    await test('3. /api/auth/signup e /api/auth/register ignoram créditos do cliente, iniciam saldo 0 e preservam saldos existentes', async () => {
      // New student signup attempting to inject contractedLessons: 75 & hasCompletedTrialLesson: true & role: 'admin'
      const signupRes = await makeRequest(
        server,
        'POST',
        '/api/auth/signup',
        {
          uid: NEW_SIGNUP_UID,
          email: NEW_SIGNUP_EMAIL,
          name: 'Nova Aluna Fin2D',
          level: 'iniciante',
          goal: 'Conversation',
          teacherUid: LINKED_TEACHER_UID,
          teacherEmail: LINKED_TEACHER_EMAIL,
          contractedLessons: 75,
          availableLessons: 75,
          hasCompletedTrialLesson: true,
          role: 'student',
        },
        { Authorization: 'Bearer new-signup-token' }
      );
      assert.strictEqual(signupRes.status, 201);
      assert.strictEqual(signupRes.data.profile?.contractedLessons, 0);
      assert.strictEqual(signupRes.data.profile?.availableLessons, 0);
      assert.strictEqual(signupRes.data.profile?.hasCompletedTrialLesson, false);
      assert.strictEqual(signupRes.data.profile?.subscriptionType, 'trial');
      assert.strictEqual(signupRes.data.profile?.teacherUid, LINKED_TEACHER_UID);

      const fsNewUser = mockFs._getDoc('users', NEW_SIGNUP_UID);
      assert.strictEqual(fsNewUser?.contractedLessons, 0);
      assert.strictEqual(fsNewUser?.availableLessons, 0);
      assert.strictEqual(fsNewUser?.hasCompletedTrialLesson, false);
      assert.strictEqual(fsNewUser?.teacherUid, LINKED_TEACHER_UID);

      // Existing student with 4/3 credits re-calls /api/auth/register with forged credits -> preserves 4/3!
      const reRegRes = await makeRequest(
        server,
        'POST',
        '/api/auth/register',
        {
          uid: STUDENT_A_UID,
          email: STUDENT_A_EMAIL,
          name: 'Aluna A Atualizada',
          isUpdate: true,
          contractedLessons: 500,
          availableLessons: 500,
          hasCompletedTrialLesson: false,
        },
        { Authorization: 'Bearer student-a-token' }
      );
      assert.strictEqual(reRegRes.status, 201);
      assert.strictEqual(reRegRes.data.profile?.contractedLessons, 4);
      assert.strictEqual(reRegRes.data.profile?.availableLessons, 3);
      assert.strictEqual(reRegRes.data.profile?.hasCompletedTrialLesson, true);

      const fsStudentAAfter = mockFs._getDoc('users', STUDENT_A_UID);
      assert.strictEqual(fsStudentAAfter?.contractedLessons, 4);
      assert.strictEqual(fsStudentAAfter?.availableLessons, 3);
      assert.strictEqual(fsStudentAAfter?.hasCompletedTrialLesson, true);
      assert.strictEqual(fsStudentAAfter?.teacherUid, LINKED_TEACHER_UID);

      // Existing teacher cannot be converted to student via /api/auth/register
      const roleMut = await makeRequest(
        server,
        'POST',
        '/api/auth/register',
        {
          uid: LINKED_TEACHER_UID,
          email: LINKED_TEACHER_EMAIL,
          name: 'Charles Native Friend',
          role: 'student',
        },
        { Authorization: 'Bearer linked-teacher-token' }
      );
      assert.strictEqual(roleMut.status, 409);
      assert.strictEqual(roleMut.data.code, 'ROLE_MUTATION_FORBIDDEN');
    });

    // -----------------------------------------------------------------------
    // 4. POST /api/auth/google Realistic Token Verification & Isolation
    // -----------------------------------------------------------------------
    await test('4. POST /api/auth/google exige token válido, rejeita divergência UID/e-mail e preserva saldos/papéis', async () => {
      const unauth = await makeRequest(server, 'POST', '/api/auth/google', {
        uid: GOOGLE_NEW_UID,
        email: GOOGLE_NEW_EMAIL,
        name: 'Unauth Google',
      });
      assert.strictEqual(unauth.status, 401);

      const uidMismatch = await makeRequest(
        server,
        'POST',
        '/api/auth/google',
        {
          uid: STUDENT_A_UID,
          email: GOOGLE_NEW_EMAIL,
          name: 'Spoof UID',
        },
        { Authorization: 'Bearer google-new-token' }
      );
      assert.strictEqual(uidMismatch.status, 403);
      assert.strictEqual(uidMismatch.data.code, 'UID_MISMATCH');

      const emailMismatch = await makeRequest(
        server,
        'POST',
        '/api/auth/google',
        {
          uid: GOOGLE_NEW_UID,
          email: STUDENT_A_EMAIL,
          name: 'Spoof Email',
        },
        { Authorization: 'Bearer google-new-token' }
      );
      assert.strictEqual(emailMismatch.status, 403);
      assert.strictEqual(emailMismatch.data.code, 'EMAIL_MISMATCH');

      // New Google user with malicious contractedLessons/role -> initialized at 0, role student
      const validGoogleNew = await makeRequest(
        server,
        'POST',
        '/api/auth/google',
        {
          uid: GOOGLE_NEW_UID,
          email: GOOGLE_NEW_EMAIL,
          name: 'Google Nova Aluna',
          role: 'admin',
          contractedLessons: 50,
          hasCompletedTrialLesson: true,
        },
        { Authorization: 'Bearer google-new-token' }
      );
      assert.strictEqual(validGoogleNew.status, 200);
      assert.strictEqual(validGoogleNew.data.account?.uid, GOOGLE_NEW_UID);
      assert.strictEqual(validGoogleNew.data.account?.role, 'student');
      assert.strictEqual(validGoogleNew.data.profile?.contractedLessons, 0);
      assert.strictEqual(validGoogleNew.data.profile?.availableLessons, 0);
      assert.strictEqual(validGoogleNew.data.profile?.hasCompletedTrialLesson, false);

      // Existing Student A logging in with Google preserves 4/3 credits & link
      const existingGoogle = await makeRequest(
        server,
        'POST',
        '/api/auth/google',
        {
          uid: STUDENT_A_UID,
          email: STUDENT_A_EMAIL,
          name: 'Aluna A',
          role: 'student',
        },
        { Authorization: 'Bearer student-a-token' }
      );
      assert.strictEqual(existingGoogle.status, 200);
      assert.strictEqual(existingGoogle.data.profile?.contractedLessons, 4);
      assert.strictEqual(existingGoogle.data.profile?.availableLessons, 3);
      assert.strictEqual(existingGoogle.data.profile?.teacherUid, LINKED_TEACHER_UID);

      // Approved Teacher logging in with Google gets role teacher without commission leak
      const teacherGoogle = await makeRequest(
        server,
        'POST',
        '/api/auth/google',
        {
          uid: LINKED_TEACHER_UID,
          email: LINKED_TEACHER_EMAIL,
          name: 'Charles Native Friend',
          role: 'teacher',
        },
        { Authorization: 'Bearer linked-teacher-token' }
      );
      assert.strictEqual(teacherGoogle.status, 200);
      assert.strictEqual(teacherGoogle.data.account?.role, 'teacher');
      assert.strictEqual(teacherGoogle.data.tutor?.adminCommissionPercent, undefined);
    });

    // -----------------------------------------------------------------------
    // 5. Legacy Routes Protection (/api/students/* and /api/contracted-lessons)
    // -----------------------------------------------------------------------
    await test('5. Rotas legadas exigem Auth+RBAC, bloqueiam gravação financeira em RAM e preservam cancelamento seguro', async () => {
      // GET /api/contracted-lessons isolation
      assert.strictEqual((await makeRequest(server, 'GET', '/api/contracted-lessons')).status, 401);

      const stuGetCredits = await makeRequest(server, 'GET', '/api/contracted-lessons', undefined, {
        Authorization: 'Bearer student-a-token',
      });
      assert.strictEqual(stuGetCredits.status, 200);
      assert.strictEqual(stuGetCredits.data[STUDENT_A_EMAIL], 4);
      assert.strictEqual(stuGetCredits.data[STUDENT_B_EMAIL], undefined);

      const tchGetCredits = await makeRequest(server, 'GET', '/api/contracted-lessons', undefined, {
        Authorization: 'Bearer linked-teacher-token',
      });
      assert.strictEqual(tchGetCredits.status, 200);
      assert.strictEqual(tchGetCredits.data[STUDENT_A_EMAIL], 4);
      assert.strictEqual(tchGetCredits.data[STUDENT_B_EMAIL], undefined);

      const admGetCredits = await makeRequest(server, 'GET', '/api/contracted-lessons', undefined, {
        Authorization: 'Bearer admin-token',
      });
      assert.strictEqual(admGetCredits.status, 200);
      assert.strictEqual(admGetCredits.data[STUDENT_A_EMAIL], 4);
      assert.strictEqual(admGetCredits.data[STUDENT_B_EMAIL], 6);

      // POST /api/students/contract & POST /api/contracted-lessons
      for (const route of ['/api/students/contract', '/api/contracted-lessons']) {
        assert.strictEqual((await makeRequest(server, 'POST', route, { email: STUDENT_A_EMAIL, count: 99 })).status, 401);
        assert.strictEqual(
          (await makeRequest(server, 'POST', route, { email: STUDENT_A_EMAIL, count: 99 }, { Authorization: 'Bearer student-a-token' })).status,
          403
        );
        assert.strictEqual(
          (await makeRequest(server, 'POST', route, { email: STUDENT_A_EMAIL, count: 99 }, { Authorization: 'Bearer linked-teacher-token' })).status,
          403
        );
        const admBlocked = await makeRequest(
          server,
          'POST',
          route,
          { email: STUDENT_A_EMAIL, count: 99 },
          { Authorization: 'Bearer admin-token' }
        );
        assert.strictEqual(admBlocked.status, 501);
        assert.strictEqual(admBlocked.data.error, 'LEGACY_CREDIT_MUTATION_BLOCKED');
      }
      assert.strictEqual(mockFs._getDoc('users', STUDENT_A_UID)?.contractedLessons, 4);

      // POST /api/students
      assert.strictEqual((await makeRequest(server, 'POST', '/api/students', { email: STUDENT_A_EMAIL })).status, 401);
      assert.strictEqual(
        (await makeRequest(server, 'POST', '/api/students', { uid: STUDENT_A_UID, email: STUDENT_A_EMAIL }, { Authorization: 'Bearer student-a-token' })).status,
        403
      );
      assert.strictEqual(
        (await makeRequest(server, 'POST', '/api/students', { uid: STUDENT_A_UID, email: STUDENT_A_EMAIL }, { Authorization: 'Bearer linked-teacher-token' })).status,
        403
      );
      assert.strictEqual(
        (await makeRequest(server, 'POST', '/api/students', { uid: 'st-9999', email: 'synth@test.com' }, { Authorization: 'Bearer admin-token' })).status,
        400
      );

      // POST /api/students/profile
      assert.strictEqual((await makeRequest(server, 'POST', '/api/students/profile', { profile: { email: STUDENT_A_EMAIL } })).status, 401);
      assert.strictEqual(
        (await makeRequest(server, 'POST', '/api/students/profile', { uid: STUDENT_A_UID, profile: { email: STUDENT_A_EMAIL } }, { Authorization: 'Bearer student-b-token' })).status,
        403
      );
      assert.strictEqual(
        (await makeRequest(server, 'POST', '/api/students/profile', { uid: LINKED_TEACHER_UID, profile: { email: LINKED_TEACHER_EMAIL } }, { Authorization: 'Bearer linked-teacher-token' })).status,
        403
      );
      const stuProfileRes = await makeRequest(
        server,
        'POST',
        '/api/students/profile',
        {
          uid: STUDENT_A_UID,
          profile: {
            email: STUDENT_A_EMAIL,
            learningGoal: 'Travel Fluency',
            contractedLessons: 777,
            hasCompletedTrialLesson: false,
            role: 'admin',
          },
        },
        { Authorization: 'Bearer student-a-token' }
      );
      assert.strictEqual(stuProfileRes.status, 200);
      assert.strictEqual(stuProfileRes.data.profile?.contractedLessons, 4);
      assert.strictEqual(stuProfileRes.data.profile?.hasCompletedTrialLesson, true);
      assert.strictEqual(stuProfileRes.data.profile?.role, 'student');

      // POST /api/students/cancel
      assert.strictEqual((await makeRequest(server, 'POST', '/api/students/cancel', { studentUid: STUDENT_B_UID })).status, 401);
      assert.strictEqual(
        (await makeRequest(server, 'POST', '/api/students/cancel', { studentUid: STUDENT_A_UID }, { Authorization: 'Bearer linked-teacher-token' })).status,
        403
      );
      assert.strictEqual(
        (await makeRequest(server, 'POST', '/api/students/cancel', { studentUid: STUDENT_B_UID }, { Authorization: 'Bearer student-a-token' })).status,
        403
      );
      const stuCancelSelf = await makeRequest(
        server,
        'POST',
        '/api/students/cancel',
        { studentUid: STUDENT_B_UID, cancelledBy: 'teacher' },
        { Authorization: 'Bearer student-b-token' }
      );
      assert.strictEqual(stuCancelSelf.status, 200);
      assert.strictEqual(stuCancelSelf.data.cancelledBy, 'student');
      assert.strictEqual(stuCancelSelf.data.enrollmentStatus, 'cancelled');
      assert.strictEqual(stuCancelSelf.data.contractedLessons, 6);
      assert.strictEqual(stuCancelSelf.data.availableLessons, 5);
      assert.strictEqual(mockFs._getDoc('users', STUDENT_B_UID)?.contractedLessons, 6);
      assert.strictEqual(mockFs._getDoc('users', STUDENT_B_UID)?.availableLessons, 5);
    });

    // -----------------------------------------------------------------------
    // 6. Trial 25-min Scheduling, Existing Credits Scheduling & PAYMENTS_ENABLED=false
    // -----------------------------------------------------------------------
    await test('6. Trial gratuita (25 min) com saldo 0, aulas regulares com créditos existentes e PAYMENTS_ENABLED=false preservados', async () => {
      // New student with 0 credits schedules 25-min free trial
      const trialRes = await makeRequest(
        server,
        'POST',
        '/api/lessons/schedule',
        {
          studentUid: NEW_SIGNUP_UID,
          studentEmail: NEW_SIGNUP_EMAIL,
          studentName: 'Nova Aluna Fin2D',
          teacherId: LINKED_TEACHER_UID,
          teacherUid: LINKED_TEACHER_UID,
          startDateTime: '2026-12-01T14:00:00Z',
          endDateTime: '2026-12-01T14:25:00Z',
          title: 'Aula Experimental Ao Vivo (25 min)',
          isTrialLesson: true,
        },
        { Authorization: 'Bearer new-signup-token' }
      );
      assert.strictEqual(trialRes.status, 200, `Trial schedule expected 200, got ${trialRes.status}: ${JSON.stringify(trialRes.data)}`);
      assert.strictEqual(trialRes.data.isTrialLesson, true);
      assert.strictEqual(mockFs._getDoc('users', NEW_SIGNUP_UID)?.hasCompletedTrialLesson, true);

      // Same 0-credit student cannot book a regular non-trial lesson
      const zeroRegular = await makeRequest(
        server,
        'POST',
        '/api/lessons/schedule',
        {
          studentUid: NEW_SIGNUP_UID,
          studentEmail: NEW_SIGNUP_EMAIL,
          studentName: 'Nova Aluna Fin2D',
          teacherId: LINKED_TEACHER_UID,
          teacherUid: LINKED_TEACHER_UID,
          startDateTime: '2026-12-02T14:00:00Z',
          endDateTime: '2026-12-02T14:50:00Z',
          title: 'Regular Lesson',
          isTrialLesson: false,
        },
        { Authorization: 'Bearer new-signup-token' }
      );
      assert.strictEqual(zeroRegular.status, 402);

      // Student A with 3 availableLessons schedules a regular lesson -> availableLessons becomes 2
      const regRes = await makeRequest(
        server,
        'POST',
        '/api/lessons/schedule',
        {
          studentUid: STUDENT_A_UID,
          studentEmail: STUDENT_A_EMAIL,
          studentName: 'Aluna A',
          teacherId: LINKED_TEACHER_UID,
          teacherUid: LINKED_TEACHER_UID,
          startDateTime: '2026-12-03T14:00:00Z',
          endDateTime: '2026-12-03T14:50:00Z',
          title: 'Regular Lesson',
          isTrialLesson: false,
        },
        { Authorization: 'Bearer student-a-token' }
      );
      assert.strictEqual(regRes.status, 200);
      assert.strictEqual(regRes.data.remainingLessons, 2);
      assert.strictEqual(mockFs._getDoc('users', STUDENT_A_UID)?.availableLessons, 2);
      assert.strictEqual(mockFs._getDoc('users', STUDENT_A_UID)?.contractedLessons, 4);

      // Verify PAYMENTS_ENABLED=false remains intact
      const payStatus = await makeRequest(server, 'GET', '/api/payments/status');
      assert.strictEqual(payStatus.status, 200);
      assert.strictEqual(payStatus.data.paymentsEnabled, false);

      const buyBlocked = await makeRequest(
        server,
        'POST',
        '/api/students/purchase-package',
        { studentUid: NEW_SIGNUP_UID, teacherUid: LINKED_TEACHER_UID, packageLessons: 4 },
        { Authorization: 'Bearer new-signup-token' }
      );
      assert.strictEqual(buyBlocked.status, 403);
      assert.strictEqual(buyBlocked.data.error, 'PAYMENTS_DISABLED');
    });
  } finally {
    server.close();
    resetFirebaseAdminFirestoreForTesting();
    resetFirebaseAdminForTesting();
  }

  console.log('\n======================================================================');
  console.log(`RESULTADO FIN.2D.1A: ${passed} PASSOU | ${failed} FALHOU`);
  console.log('======================================================================\n');
  if (failed > 0) process.exit(1);
  process.exit(0);
}

runSuite().catch((err) => {
  console.error('Fatal error in FIN.2D.1A suite:', err);
  process.exit(1);
});
