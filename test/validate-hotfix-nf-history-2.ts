process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = 'test-gemini-api-key';

import assert from 'assert';
import http from 'http';
import fs from 'fs';
import path from 'path';
import {
  app as serverApp,
  setSessionNoteTransformAttemptExecutorForTesting,
} from '../serverApp';
import { setFirebaseAdminAuthForTesting } from '../src/serverFirebaseAdmin';
import {
  setFirebaseAdminFirestoreForTesting,
  resetFirebaseAdminFirestoreForTesting,
  setIsCloudWriteDisabled,
  fetchSessionNotesFromFirestoreServer,
  fetchSessionNotesForStudentServer,
  fetchAllSessionNotesServer,
} from '../src/serverFirestore';
import { resetGeminiSecurityStateForTesting } from '../src/serverGeminiSecurity';
import { computeNotesContentHash } from '../src/utils/notesVersioning';

function createInMemoryFirestore(store: Record<string, any>) {
  function matchesFilters(data: any, filters: Array<{ field: string; op: string; val: any }>) {
    if (!data) return false;
    return filters.every(({ field, op, val }) => {
      const actual = data[field];
      if (op === '==') return actual === val;
      return true;
    });
  }

  function makeCollection(colPath: string, filters: Array<{ field: string; op: string; val: any }> = []): any {
    return {
      doc(docId: string) {
        const fullPath = `${colPath}/${docId}`;
        return {
          id: docId,
          path: fullPath,
          async get() {
            const exists = Object.prototype.hasOwnProperty.call(store, fullPath);
            const clone = exists ? JSON.parse(JSON.stringify(store[fullPath])) : undefined;
            return {
              id: docId,
              exists,
              data: () => clone,
            };
          },
          async set(data: any, opts?: { merge?: boolean }) {
            const incoming = JSON.parse(JSON.stringify(data));
            if (opts?.merge && store[fullPath]) {
              store[fullPath] = { ...store[fullPath], ...incoming };
            } else {
              store[fullPath] = incoming;
            }
            return { writeTime: new Date() };
          },
          async update(data: any) {
            const incoming = JSON.parse(JSON.stringify(data));
            store[fullPath] = { ...(store[fullPath] || {}), ...incoming };
            return { writeTime: new Date() };
          },
          async delete() {
            delete store[fullPath];
            return { writeTime: new Date() };
          },
          collection(subCol: string) {
            return makeCollection(`${fullPath}/${subCol}`);
          },
        };
      },
      where(field: string, op: string, val: any) {
        return makeCollection(colPath, [...filters, { field, op, val }]);
      },
      limit(_n: number) {
        return makeCollection(colPath, filters);
      },
      orderBy(_f: string, _d?: string) {
        return makeCollection(colPath, filters);
      },
      async get() {
        const prefix = `${colPath}/`;
        const docs: any[] = [];
        for (const [k, v] of Object.entries(store)) {
          if (k.startsWith(prefix)) {
            const remainder = k.slice(prefix.length);
            if (!remainder.includes('/') && matchesFilters(v, filters)) {
              const clone = JSON.parse(JSON.stringify(v));
              docs.push({
                id: remainder,
                exists: true,
                data: () => clone,
              });
            }
          }
        }
        return {
          empty: docs.length === 0,
          size: docs.length,
          docs,
          forEach: (cb: (d: any) => void) => docs.forEach(cb),
        };
      },
    };
  }

  return {
    collection(name: string) {
      return makeCollection(name);
    },
    async runTransaction(fn: any) {
      const tx = {
        get: async (ref: any) => ref.get(),
        set: (ref: any, val: any, opts?: any) => ref.set(val, opts),
        update: (ref: any, val: any) => ref.update(val),
      };
      return fn(tx);
    },
  };
}

function makeRequest(
  server: http.Server,
  method: string,
  pathStr: string,
  body?: any,
  headers: Record<string, string> = {}
): Promise<{ status: number; data: any }> {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    if (!addr || typeof addr === 'string') {
      return reject(new Error('Server address unavailable'));
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
      {
        host: '127.0.0.1',
        port: addr.port,
        path: pathStr,
        method,
        headers: reqHeaders,
      },
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

function makeSampleTransformation(tag: string) {
  return {
    mistakesAnalysis: [
      {
        id: `m-${tag}`,
        original: 'I am work here',
        corrected: 'I work here',
        explanation: 'Simple present does not use am + base verb.',
        grammarRule: 'Present Simple',
        twoExamples: ['I work at a bank.', 'She lives in Lisbon.'],
        commonPitfalls: 'Adding am before regular verbs.',
        similarFormsComparison: 'I am working = happening right now.',
        category: 'grammar',
      },
      {
        id: `m2-${tag}`,
        original: 'I am agree with you',
        corrected: 'I agree with you',
        explanation: 'Agree is a verb, so do not use am.',
        grammarRule: 'Verb Agree',
        twoExamples: ['I agree with your suggestion.', 'We agree on the plan.'],
        commonPitfalls: 'Adding auxiliary be before agree.',
        similarFormsComparison: 'I agree vs I am in agreement.',
        category: 'grammar',
      },
    ],
    grammarPoints: [
      {
        id: `g-${tag}`,
        topic: `Present Simple (${tag})`,
        rule: 'Use base verb for routines.',
        form: 'Subject + verb',
        usage: 'Daily habits and states',
        examples: ['I teach English every Tuesday.'],
        commonMistakes: 'Inserting to be unnecessarily.',
        comparisons: 'Compare with Present Continuous.',
      },
    ],
    vocabularyAndExpressions: [
      {
        id: `v-${tag}`,
        term: 'catch up',
        partOfSpeech: 'Phrasal Verb',
        category: 'Conversational Expressions',
        definitionEn: 'Talk with someone to learn recent news.',
        simpleDefinition: 'Talk with someone to learn recent news.',
        collocations: ['catch up soon', 'catch up with friends'],
        realExamples: ['Let us catch up this weekend!'],
        synonyms: ['reconnect'],
        register: 'conversational',
        registerNote: 'Very common in friendly chats.',
        isNewWord: true,
        isPronunciationFocus: false,
      },
    ],
    reviewSummary: {
      estimatedMinutes: '5-10 minutes',
      keyRules: [`Focus on Present Simple (${tag}).`],
      mustKnowVocabulary: ['catch up'],
      essentialCorrections: [{ original: 'I am work here', corrected: 'I work here' }],
      mainTakeaways: [`Focus on Present Simple (${tag}).`],
      recallPrompts: ['Correct: I am work here -> ?'],
      rememberThis: 'Drop "am" in Present Simple habits.',
    },
  };
}

async function runTests() {
  console.log('======================================================================');
  console.log('HOTFIX NF.HISTORY.2 — CONSULTA DE DOCUMENTOS HISTÓRICOS');
  console.log('======================================================================\n');

  let passed = 0;
  let failed = 0;

  async function test(name: string, fn: () => void | Promise<void>) {
    try {
      await fn();
      passed++;
      console.log(`  ✅ [PASS] ${name}`);
    } catch (err: any) {
      failed++;
      console.error(`  ❌ [FAIL] ${name}`);
      console.error(`     Error: ${err?.message || err}`);
      if (err?.stack) {
        console.error(err.stack.split('\n').slice(1, 4).join('\n'));
      }
    }
  }

  const ts = Date.now();
  const studentAUid = `student-hist2-a-${ts}`;
  const studentAEmail = `student.a.${ts}@example.com`;
  const studentBUid = `student-hist2-b-${ts}`;
  const studentBEmail = `student.b.${ts}@example.com`;
  const teacherUid = `teacher-hist2-auth-${ts}`;
  const teacherEmail = `teacher.auth.${ts}@example.com`;
  const otherTeacherUid = `teacher-hist2-other-${ts}`;
  const otherTeacherEmail = `teacher.other.${ts}@example.com`;
  const adminUid = `admin-hist2-${ts}`;
  const adminEmail = `admin.hist2.${ts}@example.com`;

  const tokenMap: Record<string, any> = {
    'tok-student-a': { uid: studentAUid, email: studentAEmail, email_verified: true, role: 'student' },
    'tok-student-b': { uid: studentBUid, email: studentBEmail, email_verified: true, role: 'student' },
    'tok-teacher': { uid: teacherUid, email: teacherEmail, email_verified: true, role: 'teacher' },
    'tok-other-teacher': { uid: otherTeacherUid, email: otherTeacherEmail, email_verified: true, role: 'teacher' },
    'tok-admin': { uid: adminUid, email: adminEmail, email_verified: true, role: 'admin' },
  };

  setFirebaseAdminAuthForTesting({
    verifyIdToken: async (token: string) => {
      if (tokenMap[token]) return tokenMap[token];
      throw new Error(`Invalid token: ${token}`);
    },
    getUser: async (uid: string) => {
      const found = Object.values(tokenMap).find((u) => u.uid === uid);
      if (found) return found;
      throw new Error(`User not found: ${uid}`);
    },
    getUserByEmail: async (email: string) => {
      const found = Object.values(tokenMap).find((u) => u.email === email);
      if (found) return found;
      throw new Error('User not found');
    },
    setCustomUserClaims: async () => {},
  } as any);

  const sanitizedStudentAEmail = studentAEmail.replace(/[^a-zA-Z0-9_-]/g, '_');

  const standaloneNoteId = `session_2026-09-10_${studentAUid}`;
  const standaloneRaw = '✗ I am work here (standalone)\n✦ catch up (standalone)';
  const standaloneApprovedTrans = makeSampleTransformation('standalone');

  const emailKeyedNoteId = `session_2026-09-15_${sanitizedStudentAEmail}`;
  const emailKeyedLessonId = `lesson-abc-20260915`;
  const emailKeyedRaw = '✗ I go yesterday\n✦ wrap up';
  const emailKeyedDraftTrans = makeSampleTransformation('draft-legacy');

  const prefixedDocLessonId = `lesson-prefixed-20260920`;
  const prefixedDocId = `lesson_${prefixedDocLessonId}`;
  const prefixedRaw = '✗ She don’t like coffee';

  const legacySubDocId = `legacy_note_20260901`;
  const legacySubLessonId = `lesson-legacy-sub-20260901`;
  const legacySubRaw = '✗ He have two dogs (legacy subcollection)';
  const legacySubApprovedTrans = makeSampleTransformation('legacy-sub');

  const studentBNoteId = `session_2026-10-01_${studentBUid}`;
  const studentBRaw = 'Private student B note content';

  const initialStore = (): Record<string, any> => ({
    [`users/${studentAUid}`]: {
      uid: studentAUid,
      email: studentAEmail,
      name: 'Student Alpha',
      role: 'student',
      level: 'intermediario',
      teacherUid,
      teacherEmail,
      assignedNativeFriendUID: teacherUid,
    },
    [`users/${studentBUid}`]: {
      uid: studentBUid,
      email: studentBEmail,
      name: 'Student Beta',
      role: 'student',
      level: 'intermediario',
    },
    [`users/${teacherUid}`]: {
      uid: teacherUid,
      email: teacherEmail,
      role: 'teacher',
      approvalStatus: 'approved',
      isApproved: true,
    },
    [`tutors/${teacherUid}`]: {
      uid: teacherUid,
      email: teacherEmail,
      name: 'Authorized Native Friend',
      approvalStatus: 'approved',
      isApproved: true,
    },
    [`users/${otherTeacherUid}`]: {
      uid: otherTeacherUid,
      email: otherTeacherEmail,
      role: 'teacher',
      approvalStatus: 'approved',
      isApproved: true,
    },
    [`tutors/${otherTeacherUid}`]: {
      uid: otherTeacherUid,
      email: otherTeacherEmail,
      name: 'Unlinked Native Friend',
      approvalStatus: 'approved',
      isApproved: true,
    },
    [`users/${adminUid}`]: {
      uid: adminUid,
      email: adminEmail,
      role: 'admin',
    },
    // 1. Standalone note without lessonId (Approved v1)
    [`session_notes/${standaloneNoteId}`]: {
      id: standaloneNoteId,
      sessionKey: standaloneNoteId,
      lessonId: '',
      sessionDate: '2026-09-10',
      studentUid: studentAUid,
      studentEmail: studentAEmail,
      teacherUid,
      teacherEmail,
      topic: 'Standalone Past Conversation',
      content: standaloneRaw,
      rawContent: standaloneRaw,
      approvalStatus: 'approved',
      lastApprovedVersion: {
        approvedVersionId: 'appr-v1-standalone',
        versionNumber: 1,
        status: 'approved',
        approvedAt: '2026-09-10T18:00:00.000Z',
        approvedByUid: teacherUid,
        rawNotesHash: computeNotesContentHash(standaloneRaw),
        transformation: standaloneApprovedTrans,
      },
      versionHistory: [
        {
          versionId: 'v1-appr-standalone',
          versionNumber: 1,
          type: 'approved_published',
          createdAt: '2026-09-10T18:00:00.000Z',
          createdByUid: teacherUid,
          rawContent: standaloneRaw,
          contentHash: computeNotesContentHash(standaloneRaw),
          changeSummary: 'Initial approval',
          transformation: standaloneApprovedTrans,
        },
      ],
      updatedAt: '2026-09-10T18:00:00.000Z',
    },
    // 2. Email-keyed note WITH lessonId (Draft in progress)
    [`session_notes/${emailKeyedNoteId}`]: {
      id: emailKeyedNoteId,
      sessionKey: emailKeyedNoteId,
      lessonId: emailKeyedLessonId,
      sessionDate: '2026-09-15',
      studentUid: studentAUid,
      studentEmail: studentAEmail,
      teacherUid,
      teacherEmail,
      topic: 'Business Travel Prep',
      content: emailKeyedRaw,
      rawContent: emailKeyedRaw,
      approvalStatus: 'draft_in_progress',
      draftTransformation: {
        draftId: 'draft-email-keyed',
        status: 'draft_in_progress',
        createdAt: '2026-09-15T15:00:00.000Z',
        rawNotesHash: computeNotesContentHash(emailKeyedRaw),
        transformation: emailKeyedDraftTrans,
      },
      versionHistory: [
        {
          versionId: 'v1-draft-email',
          versionNumber: 1,
          type: 'ai_draft',
          createdAt: '2026-09-15T15:00:00.000Z',
          createdByUid: teacherUid,
          rawContent: emailKeyedRaw,
          contentHash: computeNotesContentHash(emailKeyedRaw),
          changeSummary: 'Generated AI draft',
        },
      ],
      updatedAt: '2026-09-15T15:00:00.000Z',
    },
    // Scheduled lesson matching emailKeyedLessonId (to test deduplication & key unification)
    [`lessons/${emailKeyedLessonId}`]: {
      id: emailKeyedLessonId,
      studentUid: studentAUid,
      studentEmail: studentAEmail,
      teacherUid,
      teacherEmail,
      title: 'Business Travel Prep',
      startDateTime: '2026-09-15T14:00:00.000Z',
      sessionNotesDocument: emailKeyedRaw,
      status: 'completed',
    },
    // 3. lesson_-prefixed doc matching a lesson doc
    [`session_notes/${prefixedDocId}`]: {
      id: prefixedDocId,
      sessionKey: prefixedDocId,
      lessonId: prefixedDocLessonId,
      sessionDate: '2026-09-20',
      studentUid: studentAUid,
      studentEmail: studentAEmail,
      teacherUid,
      teacherEmail,
      topic: 'Pronunciation Drill',
      content: prefixedRaw,
      rawContent: prefixedRaw,
      approvalStatus: 'unapproved',
      versionHistory: [],
      updatedAt: '2026-09-20T16:00:00.000Z',
    },
    [`lessons/${prefixedDocLessonId}`]: {
      id: prefixedDocLessonId,
      studentUid: studentAUid,
      studentEmail: studentAEmail,
      teacherUid,
      teacherEmail,
      title: 'Pronunciation Drill',
      startDateTime: '2026-09-20T15:00:00.000Z',
      sessionNotesDocument: prefixedRaw,
      status: 'completed',
    },
    // 4. Legacy user subcollection note + review_cycle metadata (must NOT be returned as session)
    [`users/${studentAUid}/session_notes/${legacySubDocId}`]: {
      id: legacySubDocId,
      lessonId: legacySubLessonId,
      sessionDate: '2026-09-01',
      studentUid: studentAUid,
      studentEmail: studentAEmail,
      teacherUid,
      teacherEmail,
      topic: 'Legacy Subcollection Session',
      content: legacySubRaw,
      rawContent: legacySubRaw,
      approvalStatus: 'approved',
      lastApprovedVersion: {
        approvedVersionId: 'appr-legacy-sub',
        versionNumber: 1,
        status: 'approved',
        approvedAt: '2026-09-01T17:00:00.000Z',
        approvedByUid: teacherUid,
        rawNotesHash: computeNotesContentHash(legacySubRaw),
        transformation: legacySubApprovedTrans,
      },
      updatedAt: '2026-09-01T17:00:00.000Z',
    },
    [`users/${studentAUid}/session_notes/review_cycle`]: {
      lastSessionKey: standaloneNoteId,
      stepIndex: 1,
      lastAssignedDate: '2026-11-15',
    },
    // 5. Student B private doc for RBAC isolation
    [`session_notes/${studentBNoteId}`]: {
      id: studentBNoteId,
      sessionDate: '2026-10-01',
      studentUid: studentBUid,
      studentEmail: studentBEmail,
      teacherUid: otherTeacherUid,
      teacherEmail: otherTeacherEmail,
      topic: 'Beta Private Session',
      content: studentBRaw,
      rawContent: studentBRaw,
      approvalStatus: 'unapproved',
      updatedAt: '2026-10-01T12:00:00.000Z',
    },
  });

  let firestoreStore = initialStore();
  setFirebaseAdminFirestoreForTesting(createInMemoryFirestore(firestoreStore) as any);
  setIsCloudWriteDisabled(false);
  resetGeminiSecurityStateForTesting();

  const server = http.createServer(serverApp);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    // -----------------------------------------------------------------------
    // SECTION 1: UNIFIED BACKEND RESOLUTION (sessionKey / lessonId / legacy)
    // -----------------------------------------------------------------------
    await test('1.1 Standalone note without lessonId resolved via /api/session-notes?id=...', async () => {
      const res = await makeRequest(
        server,
        'GET',
        `/api/session-notes?id=${encodeURIComponent(standaloneNoteId)}`,
        undefined,
        { Authorization: 'Bearer tok-student-a' }
      );
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.id, standaloneNoteId);
      assert.strictEqual(res.data.lessonId, '');
      assert.strictEqual(res.data.lastApprovedVersion?.versionNumber, 1);
      assert.strictEqual(res.data.lastApprovedVersion?.transformation?.mistakesAnalysis?.[0]?.id, 'm-standalone');
    });

    await test('1.2 Email-keyed note resolved interchangeably by doc id, bare lessonId, or lesson_ prefix', async () => {
      const headers = { Authorization: 'Bearer tok-teacher' };

      const byId = await makeRequest(
        server,
        'GET',
        `/api/session-notes?id=${encodeURIComponent(emailKeyedNoteId)}`,
        undefined,
        headers
      );
      assert.strictEqual(byId.status, 200);
      assert.strictEqual(byId.data.id, emailKeyedNoteId);
      assert.strictEqual(byId.data.draftTransformation?.draftId, 'draft-email-keyed');

      const byLessonParam = await makeRequest(
        server,
        'GET',
        `/api/session-notes?lessonId=${encodeURIComponent(emailKeyedLessonId)}&studentUid=${encodeURIComponent(studentAUid)}`,
        undefined,
        headers
      );
      assert.strictEqual(byLessonParam.status, 200);
      assert.strictEqual(byLessonParam.data.id, emailKeyedNoteId);
      assert.strictEqual(byLessonParam.data.draftTransformation?.draftId, 'draft-email-keyed');

      const byLessonPrefix = await makeRequest(
        server,
        'GET',
        `/api/session-notes?id=${encodeURIComponent(`lesson_${emailKeyedLessonId}`)}&lessonId=${encodeURIComponent(emailKeyedLessonId)}`,
        undefined,
        headers
      );
      assert.strictEqual(byLessonPrefix.status, 200);
      assert.strictEqual(byLessonPrefix.data.id, emailKeyedNoteId);
    });

    await test('1.3 Prefixed lesson_ doc resolved even when queried by bare lessonId', async () => {
      const res = await makeRequest(
        server,
        'GET',
        `/api/session-notes?id=${encodeURIComponent(prefixedDocLessonId)}`,
        undefined,
        { Authorization: 'Bearer tok-teacher' }
      );
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.id, prefixedDocId);
      assert.strictEqual(res.data.rawContent, prefixedRaw);
    });

    await test('1.4 Legacy users/{uid}/session_notes doc resolved by id or lessonId, excluding review_cycle', async () => {
      const byId = await makeRequest(
        server,
        'GET',
        `/api/session-notes?id=${encodeURIComponent(legacySubDocId)}`,
        undefined,
        { Authorization: 'Bearer tok-student-a' }
      );
      assert.strictEqual(byId.status, 200);
      assert.strictEqual(byId.data.id, legacySubDocId);
      assert.strictEqual(byId.data.lastApprovedVersion?.approvedVersionId, 'appr-legacy-sub');

      const byLesson = await makeRequest(
        server,
        'GET',
        `/api/session-notes?lessonId=${encodeURIComponent(legacySubLessonId)}`,
        undefined,
        { Authorization: 'Bearer tok-student-a' }
      );
      assert.strictEqual(byLesson.status, 200);
      assert.strictEqual(byLesson.data.id, legacySubDocId);

      // Direct server query skips review_cycle
      const allStudentDocs = await fetchSessionNotesForStudentServer(studentAUid);
      assert(!allStudentDocs.some((d) => d.id === 'review_cycle'), 'review_cycle must never be exposed as a session note');
    });

    await test('1.5 Student list deduplicates canonical session_notes, legacy subcollection, and lessons overlay', async () => {
      // Also seed a matching user subcollection duplicate of standaloneNoteId to confirm deduplication
      firestoreStore[`users/${studentAUid}/session_notes/${standaloneNoteId}`] = {
        id: standaloneNoteId,
        sessionDate: '2026-09-10',
        studentUid: studentAUid,
        content: 'older duplicate copy',
      };

      const res = await makeRequest(
        server,
        'GET',
        `/api/session-notes?studentUid=${encodeURIComponent(studentAUid)}`,
        undefined,
        { Authorization: 'Bearer tok-teacher' }
      );
      assert.strictEqual(res.status, 200);
      assert(Array.isArray(res.data));

      const ids = res.data.map((d: any) => d.id);
      assert.strictEqual(new Set(ids).size, ids.length, `Duplicate IDs returned: ${ids.join(', ')}`);
      assert.strictEqual(ids.filter((id: string) => id === standaloneNoteId).length, 1);
      assert.strictEqual(ids.filter((id: string) => id === emailKeyedNoteId).length, 1);
      assert.strictEqual(ids.filter((id: string) => id === prefixedDocId).length, 1);
      assert.strictEqual(ids.filter((id: string) => id === legacySubDocId).length, 1);
      // Should NOT add a separate synthetic row for emailKeyedLessonId or prefixedDocLessonId
      assert(!ids.includes(emailKeyedLessonId), 'lessons overlay must not duplicate email-keyed note');
      assert(!ids.includes(prefixedDocLessonId), 'lessons overlay must not duplicate prefixed note');
      assert(!ids.includes('review_cycle'));

      // Check standalone doc keeps canonical approved version (not overwritten by legacy subcollection copy)
      const standaloneRow = res.data.find((d: any) => d.id === standaloneNoteId);
      assert.strictEqual(standaloneRow.lastApprovedVersion?.approvedVersionId, 'appr-v1-standalone');
    });

    await test('1.6 Admin fetchAllSessionNotesServer avoids duplicating lesson_-prefixed notes against lessons overlay', async () => {
      const allNotes = await fetchAllSessionNotesServer();
      const ids = allNotes.map((n) => n.id);
      assert(ids.includes(prefixedDocId));
      assert(!ids.includes(prefixedDocLessonId), 'fetchAllSessionNotesServer must normalize lesson_ prefix on overlay check');
    });

    // -----------------------------------------------------------------------
    // SECTION 2: NON-DESTRUCTIVE CONSULTATION & IN-PLACE HISTORICAL MUTATIONS
    // -----------------------------------------------------------------------
    await test('2.1 Selecting/reading historical notes is non-destructive (zero new docs or mutations)', async () => {
      const snapshotBefore = JSON.stringify(firestoreStore);

      const res1 = await makeRequest(
        server,
        'GET',
        `/api/session-notes?id=${encodeURIComponent(standaloneNoteId)}`,
        undefined,
        { Authorization: 'Bearer tok-teacher' }
      );
      const res2 = await makeRequest(
        server,
        'GET',
        `/api/session-notes/${encodeURIComponent(standaloneNoteId)}/versions`,
        undefined,
        { Authorization: 'Bearer tok-teacher' }
      );
      assert.strictEqual(res1.status, 200);
      assert.strictEqual(res2.status, 200);
      assert.strictEqual(res2.data.versionHistory.length, 1);
      assert.strictEqual(JSON.stringify(firestoreStore), snapshotBefore, 'Read operations must not mutate Firestore');
    });

    await test('2.2 Updating historical email-keyed doc via bare lessonId updates existing doc in place without creating duplicates', async () => {
      const docCountBefore = Object.keys(firestoreStore).filter((k) => k.startsWith('session_notes/')).length;
      const updatedNotes = `${emailKeyedRaw}\n✓ Safe flight tomorrow`;

      const saveRes = await makeRequest(
        server,
        'POST',
        '/api/session-notes',
        {
          id: emailKeyedLessonId,
          lessonId: emailKeyedLessonId,
          sessionDate: '2026-09-15',
          studentUid: studentAUid,
          studentEmail: studentAEmail,
          teacherUid,
          teacherEmail,
          topic: 'Business Travel Prep (Updated)',
          content: updatedNotes,
          rawContent: updatedNotes,
          skipDriveSync: true,
        },
        { Authorization: 'Bearer tok-teacher' }
      );

      assert.strictEqual(saveRes.status, 200);
      assert.strictEqual(saveRes.data.sessionNote.id, emailKeyedNoteId, 'Must update canonical emailKeyedNoteId in place');

      const docCountAfter = Object.keys(firestoreStore).filter((k) => k.startsWith('session_notes/')).length;
      assert.strictEqual(docCountAfter, docCountBefore, 'Must NOT fork a duplicate session_notes document');
      assert.strictEqual(firestoreStore[`session_notes/${emailKeyedNoteId}`].rawContent, updatedNotes);
    });

    await test('2.3 Save Draft, Transform, Approve & Publish, and Versions work on standalone historical docs without lessonId', async () => {
      // Save draft edits on email-keyed doc after refreshing transform via stub
      setSessionNoteTransformAttemptExecutorForTesting(async () =>
        JSON.stringify(makeSampleTransformation('standalone-v2'))
      );

      const newStandaloneRaw = `${standaloneRaw}\n✗ I am agree with you`;
      const saveRaw = await makeRequest(
        server,
        'POST',
        '/api/session-notes',
        {
          id: standaloneNoteId,
          sessionDate: '2026-09-10',
          studentUid: studentAUid,
          studentEmail: studentAEmail,
          teacherUid,
          teacherEmail,
          topic: 'Standalone Past Conversation',
          content: newStandaloneRaw,
          rawContent: newStandaloneRaw,
          skipDriveSync: true,
        },
        { Authorization: 'Bearer tok-teacher' }
      );
      assert.strictEqual(saveRaw.status, 200);
      // Existing approved v1 must remain intact before approve!
      assert.strictEqual(
        firestoreStore[`session_notes/${standaloneNoteId}`].lastApprovedVersion.approvedVersionId,
        'appr-v1-standalone'
      );

      const tfRes = await makeRequest(
        server,
        'POST',
        `/api/session-notes/${encodeURIComponent(standaloneNoteId)}/transform`,
        {
          id: standaloneNoteId,
          rawNotes: newStandaloneRaw,
          topic: 'Standalone Past Conversation',
          studentUid: studentAUid,
          teacherUid,
        },
        { Authorization: 'Bearer tok-teacher' }
      );
      assert.strictEqual(tfRes.status, 200);
      assert(tfRes.data.draftTransformation?.draftId);

      // Save edited draft
      const editedTrans = JSON.parse(JSON.stringify(tfRes.data.draftTransformation.transformation));
      editedTrans.reviewSummary.rememberThis = 'Teacher-edited takeaway for standalone note.';

      const draftRes = await makeRequest(
        server,
        'POST',
        `/api/session-notes/${encodeURIComponent(standaloneNoteId)}/draft`,
        {
          id: standaloneNoteId,
          draftId: tfRes.data.draftTransformation.draftId,
          transformation: editedTrans,
          studentUid: studentAUid,
          teacherUid,
          changeSummary: 'Edited draft on standalone historical note',
        },
        { Authorization: 'Bearer tok-teacher' }
      );
      assert.strictEqual(draftRes.status, 200, `draftRes failed (${draftRes.status}): ${JSON.stringify(draftRes.data)}`);
      assert.strictEqual(
        draftRes.data.sessionNote.draftTransformation.transformation.reviewSummary.rememberThis,
        'Teacher-edited takeaway for standalone note.'
      );

      // Approve & Publish -> increments to versionNumber 2
      const activeDraftId = draftRes.data.sessionNote.draftTransformation.draftId || tfRes.data.draftTransformation.draftId;
      const approveRes = await makeRequest(
        server,
        'POST',
        `/api/session-notes/${encodeURIComponent(standaloneNoteId)}/approve`,
        {
          id: standaloneNoteId,
          draftId: activeDraftId,
          transformation: editedTrans,
          studentUid: studentAUid,
          teacherUid,
          changeSummary: 'Published standalone v2',
        },
        { Authorization: 'Bearer tok-teacher' }
      );
      assert.strictEqual(approveRes.status, 200);
      assert(approveRes.data.approvedVersion.versionNumber > 1, 'Approved versionNumber must increment past initial v1');

      const verRes = await makeRequest(
        server,
        'GET',
        `/api/session-notes/${encodeURIComponent(standaloneNoteId)}/versions`,
        undefined,
        { Authorization: 'Bearer tok-teacher' }
      );
      assert.strictEqual(verRes.status, 200);
      assert(verRes.data.versionHistory.length >= 4, 'Version history must retain historical entries and new v2');
    });

    // -----------------------------------------------------------------------
    // SECTION 3: RBAC ON HISTORICAL DOCUMENTS
    // -----------------------------------------------------------------------
    await test('3.1 Student B blocked (403) from reading Student A historical notes (direct & legacy)', async () => {
      const r1 = await makeRequest(
        server,
        'GET',
        `/api/session-notes?id=${encodeURIComponent(standaloneNoteId)}`,
        undefined,
        { Authorization: 'Bearer tok-student-b' }
      );
      assert.strictEqual(r1.status, 403);

      const r2 = await makeRequest(
        server,
        'GET',
        `/api/session-notes?studentUid=${encodeURIComponent(studentAUid)}`,
        undefined,
        { Authorization: 'Bearer tok-student-b' }
      );
      assert.strictEqual(r2.status, 403);
    });

    await test('3.2 Unlinked teacher blocked (403) from reading, listing, editing, or viewing versions of Student A notes', async () => {
      const rGet = await makeRequest(
        server,
        'GET',
        `/api/session-notes?id=${encodeURIComponent(standaloneNoteId)}`,
        undefined,
        { Authorization: 'Bearer tok-other-teacher' }
      );
      assert.strictEqual(rGet.status, 403);

      const rList = await makeRequest(
        server,
        'GET',
        `/api/session-notes?studentUid=${encodeURIComponent(studentAUid)}`,
        undefined,
        { Authorization: 'Bearer tok-other-teacher' }
      );
      assert.strictEqual(rList.status, 403);

      const rVersions = await makeRequest(
        server,
        'GET',
        `/api/session-notes/${encodeURIComponent(standaloneNoteId)}/versions`,
        undefined,
        { Authorization: 'Bearer tok-other-teacher' }
      );
      assert.strictEqual(rVersions.status, 403);

      const rDraft = await makeRequest(
        server,
        'POST',
        `/api/session-notes/${encodeURIComponent(emailKeyedLessonId)}/draft`,
        {
          transformation: emailKeyedDraftTrans,
          studentUid: studentAUid,
          teacherUid: otherTeacherUid,
        },
        { Authorization: 'Bearer tok-other-teacher' }
      );
      assert.strictEqual(rDraft.status, 403);
    });

    await test('3.3 Admin can inspect historical notes and versions (200)', async () => {
      const rAdmin = await makeRequest(
        server,
        'GET',
        `/api/session-notes?studentUid=${encodeURIComponent(studentAUid)}`,
        undefined,
        { Authorization: 'Bearer tok-admin' }
      );
      assert.strictEqual(rAdmin.status, 200);
      assert(Array.isArray(rAdmin.data) && rAdmin.data.length >= 4);

      const rAdminVer = await makeRequest(
        server,
        'GET',
        `/api/session-notes/${encodeURIComponent(standaloneNoteId)}/versions`,
        undefined,
        { Authorization: 'Bearer tok-admin' }
      );
      assert.strictEqual(rAdminVer.status, 200);
    });

    // -----------------------------------------------------------------------
    // SECTION 4: STUDENT MODAL HISTORICAL SELECTION & NO AUTO-REVERT
    // -----------------------------------------------------------------------
    const studentModalSrc = fs.readFileSync(
      path.join(process.cwd(), 'src/components/NativeFriendsNotesModal.tsx'),
      'utf8'
    );

    await test('4.1 Student modal fetchStudentSessions does not depend on selectedSessionKey and preserves manual selection', () => {
      const fetchMatch = studentModalSrc.match(/const fetchStudentSessions = useCallback\(async \(\) => \{[\s\S]*?\}, \[([^\]]*)\]\);/);
      assert(fetchMatch, 'fetchStudentSessions callback must exist');
      assert(!fetchMatch[1].includes('selectedSessionKey'), 'fetchStudentSessions must NOT depend on selectedSessionKey');

      assert(studentModalSrc.includes('hasManualSelectionRef.current = true'), 'Manual select must mark hasManualSelectionRef');
      assert(studentModalSrc.includes('if (!wasOpen || uidChanged)'), 'Fresh open flags must reset only on open or UID change');
      assert(studentModalSrc.includes('(isFreshOpenRef.current && !hasManualSelectionRef.current) || !currentSelectedKey || !selectionStillExists'));
      assert(studentModalSrc.includes('prevLoadedSessionKeyRef.current !== activeSession.key'), 'Switching session must clear stale transformation');
      assert(!studentModalSrc.includes('sessionNotesModalMemoryCache'), 'Redundant sessionNotesModalMemoryCache must be removed');
    });

    await test('4.2 Student modal auto-selection simulation preserves historical choice across background refreshes and resets on reopen', () => {
      // Pure state-machine simulation mirroring NativeFriendsNotesModal lines 469-516
      let isOpen = false;
      let prevIsOpen = false;
      let hasManualSelection = false;
      let isFreshOpen = true;
      let selectedKey = '';

      const runRefresh = (list: Array<{ key: string }>) => {
        const selectionStillExists = Boolean(selectedKey && list.some((i) => i.key === selectedKey));
        if (list.length > 0) {
          if ((isFreshOpen && !hasManualSelection) || !selectedKey || !selectionStillExists) {
            selectedKey = list[0].key;
          }
          isFreshOpen = false;
        } else {
          selectedKey = '';
        }
      };

      const onOpenEffect = (open: boolean, list: Array<{ key: string }>) => {
        const wasOpen = prevIsOpen;
        prevIsOpen = open;
        isOpen = open;
        if (!open) {
          hasManualSelection = false;
          isFreshOpen = true;
          return;
        }
        if (!wasOpen) {
          hasManualSelection = false;
          isFreshOpen = true;
        }
        runRefresh(list);
      };

      const sessions = [{ key: 'session-latest' }, { key: 'session-mid' }, { key: 'session-old' }];

      // 1. Fresh open -> picks newest
      onOpenEffect(true, sessions);
      assert.strictEqual(selectedKey, 'session-latest');

      // 2. Student selects older historical doc
      hasManualSelection = true;
      isFreshOpen = false;
      selectedKey = 'session-old';

      // 3. Background lessons prop update triggers fetchStudentSessions -> must stay on 'session-old'!
      onOpenEffect(true, [{ key: 'session-brand-new' }, ...sessions]);
      assert.strictEqual(selectedKey, 'session-old', 'Manual historical selection must survive lessons refresh while open');

      // 4. Student clicks "Check Updates" -> must stay on 'session-old'!
      runRefresh([{ key: 'session-brand-new' }, ...sessions]);
      assert.strictEqual(selectedKey, 'session-old', 'Manual historical selection must survive manual refresh');

      // 5. Close and reopen -> resets to newest
      onOpenEffect(false, sessions);
      onOpenEffect(true, [{ key: 'session-brand-new' }, ...sessions]);
      assert.strictEqual(selectedKey, 'session-brand-new', 'Reopening modal must default back to latest lesson');
    });

    // -----------------------------------------------------------------------
    // SECTION 5: TEACHER PANEL HISTORICAL CONSULTATION & STUDENT SWITCHING
    // -----------------------------------------------------------------------
    const teacherPanelSrc = fs.readFileSync(
      path.join(process.cwd(), 'src/components/TeacherLiveLessonNotesPanel.tsx'),
      'utf8'
    );

    await test('5.1 TeacherLiveLessonNotesPanel integrates session_notes (with/without lessonId), Approval badges, and safe student switch', () => {
      assert(teacherPanelSrc.includes('const refreshStudentSessionNotes = useCallback'));
      assert(teacherPanelSrc.includes('/api/session-notes?studentUid=${encodeURIComponent(targetUid)}'));
      assert(teacherPanelSrc.includes('const unifiedStudentSessions = useMemo<UnifiedTeacherSessionOption[]>'));
      assert(teacherPanelSrc.includes("statusLabel: n.lessonId ? 'lesson note' : 'standalone note'"));
      assert(teacherPanelSrc.includes('Standalone Note'));
      assert(teacherPanelSrc.includes('handleSelectUnifiedSession'));
      assert(teacherPanelSrc.includes('setSelectedSessionNoteKey(\'\')'));
      assert(teacherPanelSrc.includes('loadedSessionKeyRef.current = \'\''));
      assert(teacherPanelSrc.includes('loadedSessionKeyRef.current = `note_${savedNote.id}`'), 'Canonical ID sync must guard against spurious reload');
      assert(teacherPanelSrc.includes('loadedSessionKeyRef.current = `note_${savedPayload.sessionNote.id}`'), 'Persist ID sync must guard against spurious reload');
      assert(teacherPanelSrc.includes('activeTab !== \'editor\''), 'Editor DOM sync effect must run when returning from history tab');
    });

    // -----------------------------------------------------------------------
    // SECTION 6: MANDATORY REMINDER PROTECTION REGRESSION CHECK
    // -----------------------------------------------------------------------
    const reminderSrc = fs.readFileSync(
      path.join(process.cwd(), 'src/hooks/useNativeFriendsNotesReminder.ts'),
      'utf8'
    );

    await test('6.1 useNativeFriendsNotesReminder preserves review_cycle, sequential review, Quick Review today, and latest-lesson logic', () => {
      assert(reminderSrc.includes('review_cycle'));
      assert(reminderSrc.includes('stepIndex'));
      assert(reminderSrc.includes("tab: 'mistakes'"));
      assert(reminderSrc.includes("tab: 'grammar'"));
      assert(reminderSrc.includes("tab: 'vocab'"));
      assert(reminderSrc.includes("tab: 'summary'"));
      assert(reminderSrc.includes('advanceSequentialStep'));
      assert(reminderSrc.includes('lastApprovedVersion'));
      assert(reminderSrc.includes('extractRealLessonDateAndTimestamp'));
    });

    await test('6.2 review_cycle document stored under users/{uid}/session_notes/review_cycle remains untouched across historical queries', async () => {
      const beforeCycle = JSON.stringify(firestoreStore[`users/${studentAUid}/session_notes/review_cycle`]);
      await makeRequest(
        server,
        'GET',
        `/api/session-notes?id=${encodeURIComponent(legacySubDocId)}`,
        undefined,
        { Authorization: 'Bearer tok-student-a' }
      );
      await makeRequest(
        server,
        'GET',
        `/api/session-notes?studentUid=${encodeURIComponent(studentAUid)}`,
        undefined,
        { Authorization: 'Bearer tok-student-a' }
      );
      const afterCycle = JSON.stringify(firestoreStore[`users/${studentAUid}/session_notes/review_cycle`]);
      assert.strictEqual(afterCycle, beforeCycle, 'Historical browsing must never alter review_cycle');
    });
  } finally {
    resetFirebaseAdminFirestoreForTesting();
    setSessionNoteTransformAttemptExecutorForTesting(null);
    resetGeminiSecurityStateForTesting();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  console.log('\n======================================================================');
  console.log(`RESULTADO: ${passed} passed, ${failed} failed`);
  console.log('======================================================================');
  if (failed > 0) {
    process.exit(1);
  }
  process.exit(0);
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
