import { setFirebaseAdminAuthForTesting } from '../src/serverFirebaseAdmin';
import { setFirebaseAdminFirestoreForTesting } from '../src/serverFirestore';
import { firebaseAuthMiddleware } from '../src/middleware/firebaseAuth';
import { mergeTutors, consolidateTutorsList, areSameTutor, isValidCanonicalUid } from '../src/utils/tutorConsolidation';
import type { Request, Response, NextFunction } from 'express';
import fs from 'fs';
import path from 'path';

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

function createMockResponse() {
  const res: any = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: null,
    setHeader(name: string, value: string) {
      this.headers[name] = value;
      return this;
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(data: any) {
      this.body = data;
      return this;
    },
  };
  return res;
}

function createMockRequest(options: {
  headers?: Record<string, string>;
  params?: Record<string, string>;
  body?: any;
  user?: any;
} = {}) {
  const req: any = {
    headers: options.headers || {},
    params: options.params || {},
    body: options.body || {},
    query: {},
    user: options.user,
  };
  return req;
}

async function runHotfix4B19CTests() {
  console.log('=========================================================================');
  console.log(' REGRESSION TEST SUITE: HOTFIX 4B.19C                                   ');
  console.log(' NATIVE FRIEND PROFILE PERSISTENCE & SYNCHRONIZATION                    ');
  console.log(' Canonical Database: Firestore (default)                                ');
  console.log('=========================================================================\n');

  // Load handler logic from serverApp
  const serverAppModule = await import('../serverApp');
  const app = (serverAppModule as any).app;

  // Extract PUT /api/tutors/:id handler from Express app stack
  let putTutorHandler: any = null;
  const router = app._router || (app as any).router;
  if (router && router.stack) {
    for (const layer of router.stack) {
      if (layer.route && layer.route.path === '/api/tutors/:id' && layer.route.methods.put) {
        // layer.route.stack has [middleware, handler]
        const stack = layer.route.stack;
        putTutorHandler = stack[stack.length - 1].handle;
        break;
      }
    }
  }

  // --- Test 1: Editing a tutor present in Firestore but absent from app_db.json ---
  console.log('--- 1. Editing a tutor present in Firestore but absent from app_db.json ---');
  {
    const firestoreTutorUid = 'W111111111111111111111111111';
    const mockTutorData = {
      id: firestoreTutorUid,
      uid: firestoreTutorUid,
      email: 'remote-teacher@example.com',
      name: 'Remote Teacher',
      role: 'teacher',
      approvalStatus: 'approved',
      isApproved: true,
      bio: 'Remote bio from Firestore only',
      headline: 'Remote Headline',
      pricePerSessionUsd: 30,
      meetUrl: 'https://meet.google.com/rem-ote-tea',
    };

    // Mock Firestore holding this tutor
    const firestoreStore: Record<string, any> = {
      [`tutors/${firestoreTutorUid}`]: { ...mockTutorData },
      [`users/${firestoreTutorUid}`]: { ...mockTutorData },
    };

    const mockFsDb: any = {
      collection: (colName: string) => ({
        doc: (docId: string) => ({
          get: async () => ({
            exists: Boolean(firestoreStore[`${colName}/${docId}`]),
            id: docId,
            data: () => firestoreStore[`${colName}/${docId}`],
          }),
          set: async (data: any, opt?: any) => {
            firestoreStore[`${colName}/${docId}`] = {
              ...(opt?.merge ? firestoreStore[`${colName}/${docId}`] : {}),
              ...data,
            };
            return true;
          },
        }),
        where: (field: string, op: string, val: any) => ({
          get: async () => {
            const matches: any[] = [];
            for (const [key, doc] of Object.entries(firestoreStore)) {
              if (key.startsWith(`${colName}/`) && doc && doc[field] === val) {
                matches.push({
                  id: key.replace(`${colName}/`, ''),
                  data: () => doc,
                });
              }
            }
            return {
              docs: matches,
              forEach: (cb: any) => matches.forEach(cb),
              empty: matches.length === 0,
            };
          },
        }),
      }),
    };

    setFirebaseAdminFirestoreForTesting(mockFsDb);

    // Call PUT /api/tutors/:id with the authenticated tutor's token
    const req = createMockRequest({
      params: { id: firestoreTutorUid },
      user: {
        uid: firestoreTutorUid,
        email: 'remote-teacher@example.com',
        role: 'student', // Notice: regular teachers don't have custom claim 'teacher', role defaults to 'student'
        email_verified: true,
      },
      body: {
        name: 'Remote Teacher Updated',
        bio: 'Updated remote bio',
      },
    });
    const res = createMockResponse();

    await putTutorHandler(req, res);

    assert(res.statusCode === 200, 'Tutor present in Firestore but absent from app_db.json succeeds with 200 OK');
    assert(res.body?.tutor?.name === 'Remote Teacher Updated', 'Updated name persisted in response');
    assert(firestoreStore[`tutors/${firestoreTutorUid}`]?.name === 'Remote Teacher Updated', 'Updated name saved to Firestore tutors collection');
  }

  // --- Test 2: Verified tutor updating their own profile ---
  console.log('\n--- 2. Verified tutor updating their own profile ---');
  {
    const tutorUid = 'A222222222222222222222222222';
    const tutorStore: Record<string, any> = {
      [`tutors/${tutorUid}`]: {
        id: tutorUid,
        uid: tutorUid,
        email: 'tutor2@example.com',
        name: 'Tutor Two',
        role: 'teacher',
        approvalStatus: 'approved',
        isApproved: true,
        headline: 'Old Headline',
        bio: 'Old Bio',
        pricePerSessionUsd: 20,
      },
      [`users/${tutorUid}`]: {
        id: tutorUid,
        uid: tutorUid,
        email: 'tutor2@example.com',
        name: 'Tutor Two',
        role: 'teacher',
      },
    };

    setFirebaseAdminFirestoreForTesting({
      collection: (col: string) => ({
        doc: (id: string) => ({
          get: async () => ({
            exists: Boolean(tutorStore[`${col}/${id}`]),
            id,
            data: () => tutorStore[`${col}/${id}`],
          }),
          set: async (data: any) => {
            tutorStore[`${col}/${id}`] = { ...tutorStore[`${col}/${id}`], ...data };
            return true;
          },
        }),
        where: () => ({ get: async () => ({ docs: [], forEach: () => {}, empty: true }) }),
      }),
    } as any);

    const req = createMockRequest({
      params: { id: tutorUid },
      user: {
        uid: tutorUid,
        email: 'tutor2@example.com',
        role: 'student', // Verified UID matches canonical owner UID, no teacher custom claim needed!
        email_verified: true,
      },
      body: {
        headline: 'New Exciting Headline',
        bio: 'New Exciting Bio',
        pricePerSessionUsd: 25,
      },
    });
    const res = createMockResponse();

    await putTutorHandler(req, res);

    assert(res.statusCode === 200, 'Verified tutor updating own profile returns 200 OK without teacher custom claim');
    assert(res.body?.tutor?.headline === 'New Exciting Headline', 'Headline updated successfully');
    assert(res.body?.tutor?.bio === 'New Exciting Bio', 'Bio updated successfully');
    assert(res.body?.tutor?.pricePerSessionUsd === 25, 'Price updated successfully');
  }

  // --- Test 3: Tutor attempting to edit another tutor\'s profile — 403 ---
  console.log('\n--- 3. Tutor attempting to edit another tutor\'s profile — 403 ---');
  {
    const victimUid = 'V333333333333333333333333333';
    const attackerUid = 'A444444444444444444444444444';

    const tutorStore: Record<string, any> = {
      [`tutors/${victimUid}`]: {
        id: victimUid,
        uid: victimUid,
        email: 'victim@example.com',
        name: 'Victim Teacher',
        bio: 'Original Victim Bio',
      },
    };

    setFirebaseAdminFirestoreForTesting({
      collection: (col: string) => ({
        doc: (id: string) => ({
          get: async () => ({
            exists: Boolean(tutorStore[`${col}/${id}`]),
            id,
            data: () => tutorStore[`${col}/${id}`],
          }),
          set: async () => true,
        }),
        where: () => ({ get: async () => ({ docs: [], forEach: () => {}, empty: true }) }),
      }),
    } as any);

    const req = createMockRequest({
      params: { id: victimUid },
      user: {
        uid: attackerUid,
        email: 'attacker@example.com',
        role: 'teacher',
        email_verified: true,
      },
      body: {
        bio: 'Defaced Bio',
      },
    });
    const res = createMockResponse();

    await putTutorHandler(req, res);

    assert(res.statusCode === 403, 'Tutor attempting to edit another tutor profile returns 403 Forbidden');
    assert(tutorStore[`tutors/${victimUid}`].bio === 'Original Victim Bio', 'Victim profile remained untouched');
  }

  // --- Test 4: Unauthenticated profile update — 401 ---
  console.log('\n--- 4. Unauthenticated profile update — 401 ---');
  {
    const req = createMockRequest({
      params: { id: 'some-tutor-id' },
      user: undefined, // No user attached by middleware
      body: { bio: 'Hacked bio' },
    });
    const res = createMockResponse();

    await putTutorHandler(req, res);

    assert(res.statusCode === 401, 'Unauthenticated profile update returns 401 Unauthorized');
  }

  // --- Test 5: Administrator updating an existing tutor ---
  console.log('\n--- 5. Administrator updating an existing tutor ---');
  {
    const tutorUid = 'T555555555555555555555555555';
    const adminUid = 'ADMIN_MASTER_UID_999999999999';

    const tutorStore: Record<string, any> = {
      [`tutors/${tutorUid}`]: {
        id: tutorUid,
        uid: tutorUid,
        email: 'managed-tutor@example.com',
        name: 'Managed Tutor',
        approvalStatus: 'pending',
        isApproved: false,
      },
    };

    setFirebaseAdminFirestoreForTesting({
      collection: (col: string) => ({
        doc: (id: string) => ({
          get: async () => ({
            exists: Boolean(tutorStore[`${col}/${id}`]),
            id,
            data: () => tutorStore[`${col}/${id}`],
          }),
          set: async (data: any) => {
            tutorStore[`${col}/${id}`] = { ...tutorStore[`${col}/${id}`], ...data };
            return true;
          },
        }),
        where: () => ({ get: async () => ({ docs: [], forEach: () => {}, empty: true }) }),
      }),
    } as any);

    const req = createMockRequest({
      params: { id: tutorUid },
      user: {
        uid: adminUid,
        email: 'adm.itissimple@gmail.com',
        role: 'admin',
        email_verified: true,
      },
      body: {
        headline: 'Superb Educator',
        approvalStatus: 'approved',
        isSuperTutor: true,
      },
    });
    const res = createMockResponse();

    await putTutorHandler(req, res);

    assert(res.statusCode === 200, 'Administrator can update tutor profile (200 OK)');
    assert(res.body?.tutor?.headline === 'Superb Educator', 'Admin updated headline');
    assert(res.body?.tutor?.approvalStatus === 'approved', 'Admin updated approvalStatus to approved');
    assert(res.body?.tutor?.isApproved === true, 'isApproved synchronized to true');
  }

  // --- Test 6: Legacy ID mapping to canonical UID ---
  console.log('\n--- 6. Legacy ID mapping to canonical UID ---');
  {
    const canonicalUid = 'L666666666666666666666666666';
    const legacyPublicSlug = 'cool-tutor';

    const tutorStore: Record<string, any> = {
      [`tutors/${canonicalUid}`]: {
        id: legacyPublicSlug,
        publicTutorId: legacyPublicSlug,
        uid: canonicalUid,
        email: 'cool.tutor@example.com',
        name: 'Cool Tutor',
      },
    };

    setFirebaseAdminFirestoreForTesting({
      collection: (col: string) => ({
        doc: (id: string) => ({
          get: async () => ({
            exists: Boolean(tutorStore[`${col}/${id}`]),
            id,
            data: () => tutorStore[`${col}/${id}`],
          }),
          set: async (data: any) => {
            tutorStore[`${col}/${id}`] = { ...tutorStore[`${col}/${id}`], ...data };
            return true;
          },
        }),
        where: (f: string, op: string, val: any) => ({
          get: async () => {
            const matches: any[] = [];
            for (const [key, doc] of Object.entries(tutorStore)) {
              if (key.startsWith(`${col}/`) && doc && doc[f] === val) {
                matches.push({ id: key.replace(`${col}/`, ''), data: () => doc });
              }
            }
            return { docs: matches, forEach: (cb: any) => matches.forEach(cb), empty: matches.length === 0 };
          },
        }),
      }),
    } as any);

    const req = createMockRequest({
      params: { id: legacyPublicSlug }, // Legacy slug in path
      user: {
        uid: canonicalUid, // Verified token UID matches canonical document UID
        email: 'cool.tutor@example.com',
        role: 'student',
        email_verified: true,
      },
      body: {
        headline: 'Mastering Everyday English',
      },
    });
    const res = createMockResponse();

    await putTutorHandler(req, res);

    assert(res.statusCode === 200, 'Legacy ID mapping to canonical UID successfully resolves and persists');
    assert(res.body?.tutor?.uid === canonicalUid, 'Canonical UID preserved in response');
    assert(res.body?.tutor?.headline === 'Mastering Everyday English', 'Headline updated via legacy route param');
  }

  // --- Test 7: Ambiguous or conflicting UID mapping — controlled rejection (409) ---
  console.log('\n--- 7. Ambiguous or conflicting UID mapping — controlled rejection ---');
  {
    const ambiguousSlug = 'ambiguous-alias';
    const doc1Uid = 'UID_DOC1_111111111111111111111';
    const doc2Uid = 'UID_DOC2_222222222222222222222';

    // Mock Firestore returning two docs with DIFFERENT canonical UIDs for the same slug
    const mockFsDb: any = {
      collection: (col: string) => ({
        doc: (id: string) => ({ get: async () => ({ exists: false }) }),
        where: (f: string, op: string, val: any) => ({
          get: async () => ({
            docs: [
              { id: doc1Uid, data: () => ({ uid: doc1Uid, publicTutorId: ambiguousSlug, name: 'Teacher 1' }) },
              { id: doc2Uid, data: () => ({ uid: doc2Uid, publicTutorId: ambiguousSlug, name: 'Teacher 2' }) },
            ],
            forEach: (cb: any) => {
              cb({ id: doc1Uid, data: () => ({ uid: doc1Uid, publicTutorId: ambiguousSlug, name: 'Teacher 1' }) });
              cb({ id: doc2Uid, data: () => ({ uid: doc2Uid, publicTutorId: ambiguousSlug, name: 'Teacher 2' }) });
            },
            empty: false,
          }),
        }),
      }),
    };

    setFirebaseAdminFirestoreForTesting(mockFsDb);

    const req = createMockRequest({
      params: { id: ambiguousSlug },
      user: {
        uid: doc1Uid,
        email: 't1@example.com',
        role: 'student',
        email_verified: true,
      },
      body: { name: 'New Name' },
    });
    const res = createMockResponse();

    await putTutorHandler(req, res);

    assert(res.statusCode === 409, 'Ambiguous mapping returning conflicting canonical UIDs returns 409 Conflict');
    assert(res.body?.error === 'Conflict', 'Controlled Conflict error reported');
  }

  // --- Test 8: Firestore read failure — explicit error (503) ---
  console.log('\n--- 8. Firestore read failure — explicit error ---');
  {
    setFirebaseAdminFirestoreForTesting({
      collection: () => ({
        doc: () => ({
          get: async () => {
            throw new Error('Firestore connection timed out');
          },
        }),
        where: () => ({
          get: async () => {
            throw new Error('Firestore connection timed out');
          },
        }),
      }),
    } as any);

    const req = createMockRequest({
      params: { id: 'F888888888888888888888888888' },
      user: {
        uid: 'F888888888888888888888888888',
        email: 'error-test@example.com',
        role: 'student',
        email_verified: true,
      },
      body: { name: 'Name' },
    });
    const res = createMockResponse();

    await putTutorHandler(req, res);

    assert(res.statusCode === 503, 'Firestore read failure returns 503 Service Unavailable');
    assert(res.body?.message?.includes('Firestore is unavailable'), 'Explicit error message returned rather than empty DB assumption');
  }

  // --- Test 9: Firestore write failure — no false success ---
  console.log('\n--- 9. Firestore write failure — no false success ---');
  {
    const tutorUid = 'W999999999999999999999999999';
    setFirebaseAdminFirestoreForTesting({
      collection: (col: string) => ({
        doc: (id: string) => ({
          get: async () => ({
            exists: true,
            id: tutorUid,
            data: () => ({
              id: tutorUid,
              uid: tutorUid,
              email: 'write-fail@example.com',
              name: 'Write Fail',
            }),
          }),
          set: async () => {
            throw new Error('Firestore quota exceeded or write failed');
          },
        }),
        where: () => ({ get: async () => ({ docs: [], forEach: () => {}, empty: true }) }),
      }),
    } as any);

    const req = createMockRequest({
      params: { id: tutorUid },
      user: {
        uid: tutorUid,
        email: 'write-fail@example.com',
        role: 'student',
        email_verified: true,
      },
      body: { bio: 'New bio that should fail' },
    });
    const res = createMockResponse();

    await putTutorHandler(req, res);

    assert(res.statusCode === 500, 'Firestore write failure returns 500 Persistence Error');
    assert(res.statusCode !== 200, 'NO false success returned when write fails');
  }

  // --- Test 10: Successful profile edit persists after reload (mergeTutors + consolidateTutorsList) ---
  console.log('\n--- 10. Successful profile edit persists after reload ---');
  {
    const baseTutor = {
      id: 'P101010101010101010101010101',
      uid: 'P101010101010101010101010101',
      name: 'John Native',
      headline: 'Old Headline',
      bio: 'Old Bio',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    const updatedTutor = {
      id: 'P101010101010101010101010101',
      uid: 'P101010101010101010101010101',
      name: 'John Native',
      headline: 'Brand New Headline',
      bio: 'Brand New Bio',
      updatedAt: '2026-01-02T00:00:00.000Z',
    };

    const merged = mergeTutors(baseTutor, updatedTutor);
    assert(merged.headline === 'Brand New Headline', 'Updated headline retained in mergeTutors');
    assert(merged.bio === 'Brand New Bio', 'Updated bio retained in mergeTutors');

    // Simulate reload where server returns updatedTutor and local cache had baseTutor
    const reloadedList = consolidateTutorsList([baseTutor, updatedTutor]);
    assert(reloadedList.length === 1, 'Exactly one consolidated tutor card after reload');
    assert(reloadedList[0].headline === 'Brand New Headline', 'Server updated headline persists after list consolidation');
  }

  // --- Test 11: Public directory displays updated fields ---
  console.log('\n--- 11. Public directory displays updated fields ---');
  {
    const initialTutor = {
      id: 'DIR11111111111111111111111111',
      uid: 'DIR11111111111111111111111111',
      name: 'Initial Name',
      headline: 'Initial Headline',
      accent: 'British',
      pricePerSessionUsd: 20,
      approvalStatus: 'approved',
      isApproved: true,
      updatedAt: '2026-01-01T00:00:00Z',
    };

    const incomingUpdate = {
      id: 'DIR11111111111111111111111111',
      uid: 'DIR11111111111111111111111111',
      name: 'Updated Name',
      headline: 'Updated Headline',
      accent: 'Australian',
      pricePerSessionUsd: 28,
      updatedAt: '2026-01-02T00:00:00Z',
    };

    const consolidated = consolidateTutorsList([initialTutor, incomingUpdate]);
    assert(consolidated[0].name === 'Updated Name', 'Public directory name reflects updated field');
    assert(consolidated[0].headline === 'Updated Headline', 'Public directory headline reflects updated field');
    assert(consolidated[0].accent === 'Australian', 'Public directory accent reflects updated field');
    assert(consolidated[0].pricePerSessionUsd === 28, 'Public directory pricing reflects updated field');
  }

  // --- Test 12: Old cache cannot override updated fields ---
  console.log('\n--- 12. Old cache cannot override updated fields ---');
  {
    const oldCachedRecord = {
      id: 'C121212121212121212121212121',
      uid: 'C121212121212121212121212121',
      name: 'Stale Cached Name',
      headline: 'Stale Cached Headline',
      bio: 'Stale Cached Bio',
      updatedAt: '2025-12-01T00:00:00Z',
    };

    const freshServerRecord = {
      id: 'C121212121212121212121212121',
      uid: 'C121212121212121212121212121',
      name: 'Fresh Server Name',
      headline: 'Fresh Server Headline',
      bio: 'Fresh Server Bio',
      updatedAt: '2026-01-01T00:00:00Z',
    };

    // Even if oldCachedRecord is passed first or second, freshServerRecord must dominate
    const mergedA = consolidateTutorsList([oldCachedRecord, freshServerRecord]);
    const mergedB = consolidateTutorsList([freshServerRecord, oldCachedRecord]);

    assert(mergedA[0].headline === 'Fresh Server Headline', 'Fresh server headline wins when passed [old, fresh]');
    assert(mergedB[0].headline === 'Fresh Server Headline', 'Fresh server headline wins when passed [fresh, old]');
    assert(mergedA[0].name === 'Fresh Server Name', 'Fresh server name wins');
  }

  // --- Test 13: Queen Bee\'s name can be edited ---
  console.log('\n--- 13. Queen Bee\'s name can be edited ---');
  {
    const queenBeeExisting = {
      id: 'queen-bee',
      publicTutorId: 'queen-bee',
      uid: 'Xpmq4l50aUOE0Jh4UTHwGAtw65B2',
      email: 'beeginning4you@gmail.com',
      name: 'Queen Bee',
      headline: 'Founder & Native Friend',
      approvalStatus: 'approved',
      isApproved: true,
      updatedAt: '2026-01-01T00:00:00Z',
    };

    const queenBeeUpdated = {
      id: 'queen-bee',
      publicTutorId: 'queen-bee',
      uid: 'Xpmq4l50aUOE0Jh4UTHwGAtw65B2',
      email: 'beeginning4you@gmail.com',
      name: 'Regina (Queen Bee)', // Changed name!
      headline: 'Lead Language Mentor & Founder',
      updatedAt: '2026-01-02T00:00:00Z',
    };

    const merged = mergeTutors(queenBeeExisting, queenBeeUpdated);
    assert(merged.name === 'Regina (Queen Bee)', "Queen Bee's name can be edited and is not hardcoded to 'Queen Bee'");
    assert(merged.uid === 'Xpmq4l50aUOE0Jh4UTHwGAtw65B2', "Queen Bee canonical UID preserved");
    assert(merged.publicTutorId === 'queen-bee', "Queen Bee public slug preserved");

    const consolidated = consolidateTutorsList([queenBeeExisting, queenBeeUpdated]);
    assert(consolidated[0].name === 'Regina (Queen Bee)', "Consolidated list reflects Queen Bee's edited name");
  }

  // --- Test 14: Existing meeting URLs remain unchanged ---
  console.log('\n--- 14. Existing meeting URLs remain unchanged ---');
  {
    const existingWithMeet = {
      id: 'M141414141414141414141414141',
      uid: 'M141414141414141414141414141',
      name: 'Meet Teacher',
      meetUrl: 'https://meet.google.com/abc-defg-hij',
      meetLink: 'https://meet.google.com/abc-defg-hij',
    };

    const incomingOmittedMeet = {
      id: 'M141414141414141414141414141',
      uid: 'M141414141414141414141414141',
      name: 'Meet Teacher Updated',
      // meetUrl omitted
    };

    const merged = mergeTutors(existingWithMeet, incomingOmittedMeet);
    assert(merged.meetUrl === 'https://meet.google.com/abc-defg-hij', 'Existing meeting URL preserved when omitted in incoming update');
  }

  // --- Test 15: Existing student assignments and Trial Lessons remain unchanged ---
  console.log('\n--- 15. Existing student assignments and Trial Lessons remain unchanged ---');
  {
    // Verify saveTutorToFirestore uses { merge: true } so related fields and subcollections are untouched
    const serverFirestoreContent = fs.readFileSync(path.join(process.cwd(), 'src/serverFirestore.ts'), 'utf-8');
    assert(
      serverFirestoreContent.includes("doc(canonicalAuthUid).set(sanitized, { merge: true })"),
      'saveTutorToFirestore performs set with { merge: true } to preserve student assignments and trial lessons'
    );
  }

  // --- Test 16: Administrator approval status remains protected ---
  console.log('\n--- 16. Administrator approval status remains protected ---');
  {
    const approvedTutor = {
      id: 'A161616161616161616161616161',
      uid: 'A161616161616161616161616161',
      name: 'Approved Tutor',
      approvalStatus: 'approved',
      isApproved: true,
      status: 'approved',
      approved: true,
    };

    // Client attempts to modify or payload omitted approvalStatus
    const unprivilegedPayload = {
      id: 'A161616161616161616161616161',
      uid: 'A161616161616161616161616161',
      name: 'Approved Tutor Updated',
      approvalStatus: 'pending', // Attacker/client payload trying to tamper status
      isApproved: false,
    };

    const merged = mergeTutors(approvedTutor, unprivilegedPayload);
    assert(merged.approvalStatus === 'approved', 'approvalStatus cannot be downgraded by client payload');
    assert(merged.isApproved === true, 'isApproved remains true');
    assert(merged.status === 'approved', 'status remains approved');
    assert(merged.approved === true, 'approved remains true');
  }

  // --- Test 17: No plaintext credentials are persisted ---
  console.log('\n--- 17. No plaintext credentials are persisted ---');
  {
    const payloadWithPassword = {
      id: 'P171717171717171717171717171',
      uid: 'P171717171717171717171717171',
      name: 'Security Test',
      password: 'PlaintextSecret123!',
      confirmPassword: 'PlaintextSecret123!',
    };

    const scrubbed = serverAppModule.scrubPasswords({
      tutorsList: [payloadWithPassword],
    });

    assert(!('password' in scrubbed.tutorsList[0]), 'Password scrubbed from tutorsList');
    assert(!('password' in (serverAppModule.mergeProfilePreservingCanonicalUid({}, payloadWithPassword) as any)), 'Password scrubbed during merge');
  }

  // --- Test 18: Firestore `(default)` remains the only application database ---
  console.log('\n--- 18. Firestore (default) remains the only application database ---');
  {
    const serverAppContent = fs.readFileSync(path.join(process.cwd(), 'serverApp.ts'), 'utf-8');
    assert(
      serverAppContent.includes("process.env.FIREBASE_DATABASE_ID = '(default)';"),
      "FIREBASE_DATABASE_ID strictly set to '(default)'"
    );
    assert(
      serverAppContent.includes("process.env.VITE_FIREBASE_DATABASE_ID = '(default)';"),
      "VITE_FIREBASE_DATABASE_ID strictly set to '(default)'"
    );
  }

  console.log('\n=========================================================================');
  console.log(` TOTAL TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('=========================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runHotfix4B19CTests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
