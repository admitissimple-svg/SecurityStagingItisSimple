/**
 * ARCH.2F.2C — Native Friends Notes Canonical Consolidation Validation Suite
 *
 * Validates:
 * 1. Canonical Firestore persistence in `session_notes/{sessionKey}` + `lessons/{lessonId}` link,
 *    and `users/{uid}/session_notes/review_cycle` for sequential progress & daily reminder claims.
 * 2. Zero writes to `app_state/*`, RAM (`db.sessionNotesMap`, `db.sessionNotesProgressMap`,
 *    `db.pedagogicalTransformationsMap`), root `users/{uid}.nativeNotesReview` / `lastReminderShownDate`,
 *    or mirror subcollection `users/{uid}/session_notes/{sessionKey}`.
 * 3. Survival across complete RAM wipe (server restart simulation) for notes, drafts, approved versions,
 *    version history (`GET /api/session-notes/:id/versions`), Drive file metadata & download authorization,
 *    pedagogical cache (`GET /api/pedagogical-notes`), progress, and reminder claims.
 * 4. Read-only legacy fallback (`users/{uid}/session_notes/{sessionKey}` and root `users/{uid}` progress/reminder).
 * 5. Teacher & Admin Firestore listings (`GET /api/session-notes` without studentUid) and strict RBAC
 *    isolation (student, linked teacher, unlinked teacher, pending teacher, admin, 401/403).
 * 6. Fail-closed write error propagation (HTTP 500 on Firestore write failure) and stale draft 409 conflict.
 * 7. Static code audit of frontend (`useNativeFriendsNotesReminder.ts`, `NativeFriendsNotesModal.tsx`,
 *    `TeacherLiveLessonNotesPanel.tsx`): zero Web SDK Firestore calls, zero `/api/pedagogical-notes` in reminder,
 *    and preservation of `Alt+Y/N/W/P`, `Apply AI -> Draft -> Approve & Publish`, version history,
 *    `Alt+W` vocabulary sync, and Google Drive integration.
 */

process.env.NODE_ENV = 'test';
process.env.FIREBASE_PROJECT_ID = 'itissimple-security-staging';
process.env.FIREBASE_DATABASE_ID = '(default)';

import fs from 'fs';
import path from 'path';
import http from 'http';
import { setFirebaseAdminAuthForTesting } from '../src/serverFirebaseAdmin';
import {
  setFirebaseAdminFirestoreForTesting,
  resetFirebaseAdminFirestoreForTesting,
  saveAppStateToFirestore,
  fetchAppStateFromFirestore,
} from '../src/serverFirestore';
import {
  app as serverApp,
  readDb,
  setSessionNoteTransformAttemptExecutorForTesting,
} from '../serverApp';

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

function deepClone<T>(val: T): T {
  return val === undefined ? val : JSON.parse(JSON.stringify(val));
}

function isPlainObject(val: any): val is Record<string, any> {
  return Boolean(val) && typeof val === 'object' && !Array.isArray(val) && !(val instanceof Date);
}

function deepMergeObjects(target: Record<string, any>, source: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = { ...target };
  for (const [key, val] of Object.entries(source)) {
    if (isPlainObject(val) && isPlainObject(out[key])) {
      out[key] = deepMergeObjects(out[key], val);
    } else {
      out[key] = deepClone(val);
    }
  }
  return out;
}

function matchesFilter(data: any, field: string, op: string, value: any): boolean {
  const actual = data?.[field];
  if (op === '==') return actual === value;
  if (op === 'in' && Array.isArray(value)) return value.includes(actual);
  if (op === 'array-contains' && Array.isArray(actual)) return actual.includes(value);
  return false;
}

class MockDocRef {
  public id: string;
  public path: string;
  constructor(private col: MockCollection, id: string) {
    this.id = id;
    this.path = `${col.collectionPath}/${id}`;
  }

  async get() {
    const data = this.col.docs.get(this.id);
    return {
      exists: Boolean(data),
      id: this.id,
      ref: this,
      data: () => (data ? deepClone(data) : undefined),
    };
  }

  async set(data: any, options?: { merge?: boolean }) {
    this.col.db.recordWrite(this.path, data);
    const existing = this.col.docs.get(this.id) || {};
    const merged = options?.merge ? deepMergeObjects(existing, data) : deepClone(data);
    this.col.docs.set(this.id, merged);
    return { writeTime: new Date() };
  }

  async update(data: any) {
    this.col.db.recordWrite(this.path, data);
    const existing = this.col.docs.get(this.id);
    if (!existing) throw new Error(`NOT_FOUND: ${this.path}`);
    this.col.docs.set(this.id, deepMergeObjects(existing, data));
    return { writeTime: new Date() };
  }

  async delete() {
    this.col.db.recordWrite(this.path, { __deleted: true });
    this.col.docs.delete(this.id);
    return { writeTime: new Date() };
  }

  collection(subName: string): MockCollection {
    if (!this.col.subcollections.has(this.id)) {
      this.col.subcollections.set(this.id, new Map());
    }
    const map = this.col.subcollections.get(this.id)!;
    if (!map.has(subName)) {
      map.set(subName, new MockCollection(`${this.col.collectionPath}/${this.id}/${subName}`, this.col.db));
    }
    return map.get(subName)!;
  }
}

class MockQuery {
  constructor(
    private getCols: () => MockCollection[],
    private filters: Array<{ field: string; op: string; value: any }>,
    private limitCount?: number
  ) {}

  where(field: string, op: string, value: any): MockQuery {
    return new MockQuery(this.getCols, [...this.filters, { field, op, value }], this.limitCount);
  }

  orderBy(_field: string, _dir?: string): MockQuery {
    return this;
  }

  limit(n: number): MockQuery {
    return new MockQuery(this.getCols, this.filters, n);
  }

  async get() {
    const matched: any[] = [];
    for (const col of this.getCols()) {
      for (const [id, data] of col.docs.entries()) {
        const ok = this.filters.every((f) => matchesFilter(data, f.field, f.op, f.value));
        if (ok) {
          const ref = col.doc(id);
          matched.push({
            id,
            exists: true,
            ref,
            data: () => deepClone(data),
          });
          if (this.limitCount !== undefined && matched.length >= this.limitCount) break;
        }
      }
      if (this.limitCount !== undefined && matched.length >= this.limitCount) break;
    }
    return {
      empty: matched.length === 0,
      size: matched.length,
      docs: matched,
      forEach: (cb: (d: any) => void) => matched.forEach(cb),
    };
  }
}

class MockCollection {
  public docs: Map<string, any> = new Map();
  public subcollections: Map<string, Map<string, MockCollection>> = new Map();

  constructor(public collectionPath: string, public db: MockFirestoreDb) {}

  doc(id: string): MockDocRef {
    return new MockDocRef(this, id);
  }

  where(field: string, op: string, value: any): MockQuery {
    return new MockQuery(() => [this], [{ field, op, value }]);
  }

  orderBy(_field: string, _dir?: string): MockQuery {
    return new MockQuery(() => [this], []);
  }

  limit(n: number): MockQuery {
    return new MockQuery(() => [this], [], n);
  }

  async get() {
    return new MockQuery(() => [this], []).get();
  }

  collectNamedSubcollections(targetName: string, out: MockCollection[]) {
    for (const subMap of this.subcollections.values()) {
      for (const [name, subCol] of subMap.entries()) {
        if (name === targetName) out.push(subCol);
        subCol.collectNamedSubcollections(targetName, out);
      }
    }
  }
}

class MockFirestoreDb {
  private collections: Map<string, MockCollection> = new Map();
  public failWriteMatcher: ((path: string) => boolean) | null = null;
  public suspendWriteLog = false;
  public writeLog: Array<{ path: string; keys: string[]; data: any }> = [];

  collection(name: string): MockCollection {
    if (!this.collections.has(name)) {
      this.collections.set(name, new MockCollection(name, this));
    }
    return this.collections.get(name)!;
  }

  collectionGroup(name: string): MockQuery {
    const getCols = () => {
      const cols: MockCollection[] = [];
      for (const [colName, col] of this.collections.entries()) {
        if (colName === name) cols.push(col);
        col.collectNamedSubcollections(name, cols);
      }
      return cols;
    };
    return new MockQuery(getCols, []);
  }

  recordWrite(pathStr: string, data: any) {
    if (this.failWriteMatcher && this.failWriteMatcher(pathStr)) {
      throw new Error(`Simulated Firestore write failure on ${pathStr}`);
    }
    if (!this.suspendWriteLog) {
      this.writeLog.push({
        path: pathStr,
        keys: data && typeof data === 'object' ? Object.keys(data) : [],
        data: deepClone(data),
      });
    }
  }

  async runTransaction<T>(fn: (tx: any) => Promise<T>): Promise<T> {
    const ops: Array<() => Promise<void>> = [];
    const tx = {
      get: async (target: any) => target.get(),
      set: (ref: MockDocRef, data: any, options?: { merge?: boolean }) => {
        ops.push(() => ref.set(data, options).then(() => undefined));
      },
      update: (ref: MockDocRef, data: any) => {
        ops.push(() => ref.update(data).then(() => undefined));
      },
      delete: (ref: MockDocRef) => {
        ops.push(() => ref.delete().then(() => undefined));
      },
    };
    const res = await fn(tx);
    for (const op of ops) {
      await op();
    }
    return res;
  }
}

function makeRequest(
  server: http.Server,
  method: string,
  reqPath: string,
  body?: any,
  headers: Record<string, string> = {}
): Promise<{ status: number; data: any; headers: any }> {
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
      {
        host: '127.0.0.1',
        port: addr.port,
        path: reqPath,
        method,
        headers: reqHeaders,
      },
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
          resolve({ status: res.statusCode || 0, data: parsed, headers: res.headers });
        });
      }
    );

    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

function buildValidTransformation(sessionDate: string, teacherName: string, studentUid: string) {
  return {
    sessionDate,
    topic: 'Business Storytelling & Phrasal Verbs',
    teacherName,
    studentUid,
    cefrLevel: 'B1',
    levelAdaptation: {
      cefrLevel: 'B1',
      levelLabel: 'Intermediate',
      explanationLanguage: 'English',
    },
    mistakesAnalysis: [
      {
        id: 'mistake-1',
        original: 'I am agree with you',
        corrected: 'I agree with you',
        category: 'grammar',
        explanation: 'Agree is an action verb in English, so never put am/is/are before agree.',
        twoExamples: ['I agree with your point.', 'We completely agree with the plan.'],
        commonPitfalls: 'Adding to be before agree due to literal translation.',
      },
    ],
    grammarPoints: [
      {
        id: 'grammar-1',
        topic: 'Action Verbs vs. Adjectives (Agree)',
        rule: 'Use subject + agree directly without the verb to be.',
        form: 'Subject + agree / agrees + with + object',
        usage: 'Used to express shared opinions in conversation and meetings.',
        examples: ['I agree with you.', 'She agrees with the timeline.'],
        commonMistakes: 'Saying I am agree instead of I agree.',
        comparisons: 'Unlike adjectives such as happy (I am happy), agree is a main verb.',
      },
    ],
    vocabularyAndExpressions: [
      {
        id: 'vocab-1',
        term: 'streamline',
        partOfSpeech: 'Verb',
        definitionEn: 'To simplify and make a process faster and more efficient.',
        simpleDefinition: 'To make work simpler and smoother.',
        collocations: ['streamline a process', 'streamline workflows'],
        realExamples: ['Let us streamline this weekly process.'],
        synonyms: ['simplify', 'optimize'],
        register: 'neutral',
        category: 'New Words & Expressions (Alt+W)',
        isNewWord: true,
      },
      {
        id: 'vocab-2',
        term: 'hierarchy',
        partOfSpeech: 'Noun',
        definitionEn: 'A system in which people or things are ranked by authority or importance.',
        simpleDefinition: 'Pronounced HIGH-er-ar-kee with primary stress on the first syllable.',
        collocations: ['flat hierarchy', 'corporate hierarchy'],
        realExamples: ['Our team has a relatively flat hierarchy.'],
        synonyms: ['structure', 'ranking'],
        register: 'neutral',
        category: 'Pronunciation & Phonetics (Alt+P)',
        phoneticGuide: '/ˈhaɪ.rɑːr.ki/ — Stress on HIGH',
        isPronunciationFocus: true,
      },
    ],
    reviewSummary: {
      estimatedMinutes: '5–10 minutes',
      rememberThis: 'Say "I agree with you" and practice "streamline" in work meetings.',
      essentialCorrections: [{ original: 'I am agree with you', corrected: 'I agree with you' }],
      keyRules: ['Agree is a verb, not an adjective.'],
      mustKnowVocabulary: ['streamline', 'hierarchy'],
    },
    isAiGenerated: true,
    isFallback: false,
    isProvisional: false,
    promptVersion: 'v3-pedagogical-2026',
    generatedAt: new Date().toISOString(),
  };
}

async function runTests() {
  console.log('================================================================================');
  console.log(" IT'S SIMPLE — ARCH.2F.2C: NATIVE FRIENDS NOTES CANONICAL CONSOLIDATION");
  console.log('================================================================================\n');

  const server = http.createServer(serverApp);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  const mockDb = new MockFirestoreDb();

  const STUDENT_A_UID = 'StuA_NotesUid1234567890123';
  const STUDENT_A_EMAIL = 'student.a.notes2f2c@example.com';
  const STUDENT_B_UID = 'StuB_NotesUid1234567890123';
  const STUDENT_B_EMAIL = 'student.b.notes2f2c@example.com';
  const STUDENT_LEGACY_UID = 'StuL_NotesUid1234567890123';
  const STUDENT_LEGACY_EMAIL = 'student.legacy.notes2f2c@example.com';

  const TEACHER_A_UID = 'TchA_NotesUid1234567890123';
  const TEACHER_A_EMAIL = 'teacher.a.notes2f2c@example.com';
  const TEACHER_B_UID = 'TchB_NotesUid1234567890123';
  const TEACHER_B_EMAIL = 'teacher.b.notes2f2c@example.com';
  const TEACHER_PENDING_UID = 'TchP_NotesUid1234567890123';
  const TEACHER_PENDING_EMAIL = 'teacher.pending.notes2f2c@example.com';
  const ADMIN_UID = 'Adm_NotesUid12345678901234';
  const ADMIN_EMAIL = 'admin.notes2f2c@example.com';

  const tokenMap: Record<string, any> = {
    tok_student_a: { uid: STUDENT_A_UID, email: STUDENT_A_EMAIL, email_verified: true, role: 'student' },
    tok_student_b: { uid: STUDENT_B_UID, email: STUDENT_B_EMAIL, email_verified: true, role: 'student' },
    tok_student_legacy: { uid: STUDENT_LEGACY_UID, email: STUDENT_LEGACY_EMAIL, email_verified: true, role: 'student' },
    tok_teacher_a: { uid: TEACHER_A_UID, email: TEACHER_A_EMAIL, email_verified: true, role: 'teacher' },
    tok_teacher_b: { uid: TEACHER_B_UID, email: TEACHER_B_EMAIL, email_verified: true, role: 'teacher' },
    tok_teacher_pending: { uid: TEACHER_PENDING_UID, email: TEACHER_PENDING_EMAIL, email_verified: true, role: 'teacher' },
    tok_admin: { uid: ADMIN_UID, email: ADMIN_EMAIL, email_verified: true, role: 'admin', admin: true },
  };

  try {
    setFirebaseAdminFirestoreForTesting(mockDb as any);
    setFirebaseAdminAuthForTesting({
      verifyIdToken: async (token: string) => {
        const match = tokenMap[token];
        if (match) return match;
        throw new Error(`Invalid token: ${token}`);
      },
      getUser: async (uid: string) => {
        const match = Object.values(tokenMap).find((u) => u.uid === uid);
        if (match) return match;
        throw new Error(`User not found: ${uid}`);
      },
    } as any);

    mockDb.suspendWriteLog = true;

    // Seed canonical users & tutors in Firestore
    await mockDb.collection('users').doc(TEACHER_A_UID).set({
      id: TEACHER_A_UID,
      uid: TEACHER_A_UID,
      email: TEACHER_A_EMAIL,
      name: 'Teacher Alpha',
      role: 'teacher',
      isApproved: true,
      approvalStatus: 'approved',
    });
    await mockDb.collection('tutors').doc(TEACHER_A_UID).set({
      id: TEACHER_A_UID,
      uid: TEACHER_A_UID,
      email: TEACHER_A_EMAIL,
      name: 'Teacher Alpha',
      role: 'teacher',
      isApproved: true,
      approvalStatus: 'approved',
    });

    await mockDb.collection('users').doc(TEACHER_B_UID).set({
      id: TEACHER_B_UID,
      uid: TEACHER_B_UID,
      email: TEACHER_B_EMAIL,
      name: 'Teacher Beta',
      role: 'teacher',
      isApproved: true,
      approvalStatus: 'approved',
    });
    await mockDb.collection('tutors').doc(TEACHER_B_UID).set({
      id: TEACHER_B_UID,
      uid: TEACHER_B_UID,
      email: TEACHER_B_EMAIL,
      name: 'Teacher Beta',
      role: 'teacher',
      isApproved: true,
      approvalStatus: 'approved',
    });

    await mockDb.collection('users').doc(TEACHER_PENDING_UID).set({
      id: TEACHER_PENDING_UID,
      uid: TEACHER_PENDING_UID,
      email: TEACHER_PENDING_EMAIL,
      name: 'Teacher Pending',
      role: 'teacher',
      isApproved: false,
      approvalStatus: 'pending',
    });
    await mockDb.collection('tutors').doc(TEACHER_PENDING_UID).set({
      id: TEACHER_PENDING_UID,
      uid: TEACHER_PENDING_UID,
      email: TEACHER_PENDING_EMAIL,
      name: 'Teacher Pending',
      role: 'teacher',
      isApproved: false,
      approvalStatus: 'pending',
    });

    await mockDb.collection('users').doc(STUDENT_A_UID).set({
      id: STUDENT_A_UID,
      uid: STUDENT_A_UID,
      email: STUDENT_A_EMAIL,
      name: 'Student Alpha',
      role: 'student',
      level: 'intermediate',
      assignedNativeFriendUID: TEACHER_A_UID,
      teacherUid: TEACHER_A_UID,
    });

    await mockDb.collection('users').doc(STUDENT_B_UID).set({
      id: STUDENT_B_UID,
      uid: STUDENT_B_UID,
      email: STUDENT_B_EMAIL,
      name: 'Student Beta',
      role: 'student',
      level: 'advanced',
      assignedNativeFriendUID: TEACHER_B_UID,
      teacherUid: TEACHER_B_UID,
    });

    await mockDb.collection('users').doc(STUDENT_LEGACY_UID).set({
      id: STUDENT_LEGACY_UID,
      uid: STUDENT_LEGACY_UID,
      email: STUDENT_LEGACY_EMAIL,
      name: 'Student Legacy',
      role: 'student',
      level: 'beginner',
      assignedNativeFriendUID: TEACHER_A_UID,
      teacherUid: TEACHER_A_UID,
      nativeNotesReview: {
        lastSessionKey: 'legacy_sess_2026_10_15',
        stepIndex: 2,
        lastAssignedDate: '2026-10-16',
        lastReviewedDate: '2026-10-16',
        lastReminderShownDate: '2026-10-16',
      },
      lastReminderShownDate: '2026-10-16',
    });

    // Seed legacy subcollection note ONLY inside users/{uid}/session_notes (not in root session_notes)
    await mockDb
      .collection('users')
      .doc(STUDENT_LEGACY_UID)
      .collection('session_notes')
      .doc('legacy_sess_2026_10_15')
      .set({
        id: 'legacy_sess_2026_10_15',
        sessionDate: '2026-10-15',
        studentUid: STUDENT_LEGACY_UID,
        studentEmail: STUDENT_LEGACY_EMAIL,
        teacherUid: TEACHER_A_UID,
        teacherName: 'Teacher Alpha',
        topic: 'Legacy Topic Oct 15',
        content: '<div>Legacy note <span data-tag-type="new-word">✦ New Word</span>&nbsp;resilient</div>',
        updatedAt: '2026-10-15T15:00:00.000Z',
      });

    const LESSON_A_ID = 'lesson_notes_a_2026_11_12';
    const LESSON_B_ID = 'lesson_notes_b_2026_11_12';
    await mockDb.collection('lessons').doc(LESSON_A_ID).set({
      id: LESSON_A_ID,
      studentUid: STUDENT_A_UID,
      studentEmail: STUDENT_A_EMAIL,
      teacherUid: TEACHER_A_UID,
      teacherEmail: TEACHER_A_EMAIL,
      teacherName: 'Teacher Alpha',
      title: 'Business Storytelling & Phrasal Verbs',
      sessionDate: '2026-11-12',
      startDateTime: '2026-11-12T14:00:00Z',
      status: 'completed',
    });
    await mockDb.collection('lessons').doc(LESSON_B_ID).set({
      id: LESSON_B_ID,
      studentUid: STUDENT_B_UID,
      studentEmail: STUDENT_B_EMAIL,
      teacherUid: TEACHER_B_UID,
      teacherEmail: TEACHER_B_EMAIL,
      teacherName: 'Teacher Beta',
      title: 'Student B Confidential Lesson',
      sessionDate: '2026-11-12',
      startDateTime: '2026-11-12T16:00:00Z',
      status: 'completed',
    });

    // Also ensure tutors & profiles exist in runtime cache via admin registration or direct readDb sync if needed
    const memDb = readDb();
    memDb.sessionNotesMap = {};
    memDb.sessionNotesProgressMap = {};
    memDb.pedagogicalTransformationsMap = {};

    mockDb.suspendWriteLog = false;
    mockDb.writeLog = [];

    console.log('--- Bloco 1: Persistência Canônica, Draft, Approve, Versioning & Drive ---');

    const rawHtmlV1 = `
      <div>
        <span data-tag-type="incorrect">✗ Correction</span>&nbsp;I am agree with you<br>
        <span data-tag-type="new-word">✦ New Word</span>&nbsp;streamline<br>
        <span data-tag-type="pronounce">🎯 Pronounce</span>&nbsp;hierarchy
      </div>
    `;

    // 1.1 Teacher A saves raw notes via POST /api/lessons/:id/notes
    const saveRes = await makeRequest(
      server,
      'POST',
      `/api/lessons/${LESSON_A_ID}/notes`,
      {
        studentUid: STUDENT_A_UID,
        studentEmail: STUDENT_A_EMAIL,
        sessionDate: '2026-11-12',
        topic: 'Business Storytelling & Phrasal Verbs',
        content: rawHtmlV1,
        rawContent: rawHtmlV1,
        driveFileId: 'drv_file_alpha_001',
        driveFileUrl: 'https://drive.google.com/file/d/drv_file_alpha_001/view',
        driveFolderName: "It's Simple - Session Notes",
        driveLastSyncedAt: '2026-11-12T15:00:00.000Z',
        skipDriveSync: true,
      },
      { Authorization: 'Bearer tok_teacher_a' }
    );
    assert(saveRes.status === 200 && saveRes.data?.success === true, '1.1 POST /api/lessons/:id/notes succeeds (200)', `status=${saveRes.status}`);

    // 1.2 Verify canonical session_notes/{lessonId} and lessons/{lessonId} created in Firestore, and NO RAM writes
    const canonSnapAfterSave = await mockDb.collection('session_notes').doc(LESSON_A_ID).get();
    const lessonSnapAfterSave = await mockDb.collection('lessons').doc(LESSON_A_ID).get();
    assert(canonSnapAfterSave.exists && canonSnapAfterSave.data()?.studentUid === STUDENT_A_UID, '1.2a Canonical session_notes/{sessionKey} persisted');
    assert(lessonSnapAfterSave.data()?.sessionNotesDocument?.includes('streamline') && lessonSnapAfterSave.data()?.driveFileId === 'drv_file_alpha_001', '1.2b Link mirror persisted on lessons/{lessonId}');
    assert(Object.keys(readDb().sessionNotesMap || {}).length === 0, '1.2c readDb().sessionNotesMap remains empty');

    // 1.3 Teacher A runs AI Transform (/api/session-notes/:id/transform) using test executor
    const validTrans = buildValidTransformation('2026-11-12', 'Teacher Alpha', STUDENT_A_UID);
    setSessionNoteTransformAttemptExecutorForTesting(async () => JSON.stringify(validTrans));

    const transformRes = await makeRequest(
      server,
      'POST',
      `/api/session-notes/${LESSON_A_ID}/transform`,
      { studentUid: STUDENT_A_UID, language: 'pt' },
      { Authorization: 'Bearer tok_teacher_a' }
    );
    setSessionNoteTransformAttemptExecutorForTesting(null);
    assert(
      transformRes.status === 200 && Boolean(transformRes.data?.draftTransformation?.draftId),
      '1.3 POST /api/session-notes/:id/transform creates draftTransformation',
      `status=${transformRes.status} code=${transformRes.data?.code}`
    );

    const draftId = transformRes.data?.draftTransformation?.draftId;
    const editedTrans = {
      ...validTrans,
      reviewSummary: {
        ...validTrans.reviewSummary,
        rememberThis: 'Edited by Teacher Alpha: always say I agree with you.',
      },
    };

    // 1.4 Teacher A saves edited draft via POST /api/session-notes/:id/draft
    const draftRes = await makeRequest(
      server,
      'POST',
      `/api/session-notes/${LESSON_A_ID}/draft`,
      {
        studentUid: STUDENT_A_UID,
        draftId,
        transformation: editedTrans,
        changeSummary: 'Refined teacher tip',
      },
      { Authorization: 'Bearer tok_teacher_a' }
    );
    assert(
      draftRes.status === 200 &&
        draftRes.data?.sessionNote?.draftTransformation?.transformation?.reviewSummary?.rememberThis?.includes('Edited by Teacher Alpha'),
      '1.4 POST /api/session-notes/:id/draft updates draftTransformation',
      `status=${draftRes.status}`
    );

    const updatedDraftId = draftRes.data?.sessionNote?.draftTransformation?.draftId || draftId;

    // 1.5 Teacher A approves & publishes via POST /api/session-notes/:id/approve
    const approveRes = await makeRequest(
      server,
      'POST',
      `/api/session-notes/${LESSON_A_ID}/approve`,
      {
        studentUid: STUDENT_A_UID,
        draftId: updatedDraftId,
        transformation: editedTrans,
        changeSummary: 'Approved v1',
      },
      { Authorization: 'Bearer tok_teacher_a' }
    );
    assert(
      approveRes.status === 200 &&
        approveRes.data?.approvedVersion?.status === 'approved' &&
        approveRes.data?.sessionNote?.approvalStatus === 'approved',
      '1.5 POST /api/session-notes/:id/approve publishes lastApprovedVersion',
      `status=${approveRes.status} code=${approveRes.data?.code}`
    );

    // 1.6 Verify stale draft conflict (409 STALE_DRAFT) when raw content changes after a draft was created
    const staleDraftCreateRes = await makeRequest(
      server,
      'POST',
      `/api/session-notes/${LESSON_A_ID}/draft`,
      {
        studentUid: STUDENT_A_UID,
        transformation: editedTrans,
        changeSummary: 'Draft before raw edit',
      },
      { Authorization: 'Bearer tok_teacher_a' }
    );
    const staleDraftId = staleDraftCreateRes.data?.sessionNote?.draftTransformation?.draftId;
    assert(staleDraftCreateRes.status === 200 && Boolean(staleDraftId), '1.6a Draft created prior to raw note edit');

    const rawHtmlV2 = rawHtmlV1 + '<div><span data-tag-type="new-word">✦ New Word</span>&nbsp;synergy</div>';
    const saveV2Res = await makeRequest(
      server,
      'POST',
      '/api/session-notes',
      {
        id: LESSON_A_ID,
        lessonId: LESSON_A_ID,
        studentUid: STUDENT_A_UID,
        studentEmail: STUDENT_A_EMAIL,
        sessionDate: '2026-11-12',
        topic: 'Business Storytelling & Phrasal Verbs',
        content: rawHtmlV2,
        rawContent: rawHtmlV2,
        skipDriveSync: true,
      },
      { Authorization: 'Bearer tok_teacher_a' }
    );
    assert(saveV2Res.status === 200, '1.6b Saving updated raw notes (v2) succeeds while preserving lastApprovedVersion');

    const staleApproveRes = await makeRequest(
      server,
      'POST',
      `/api/session-notes/${LESSON_A_ID}/approve`,
      {
        studentUid: STUDENT_A_UID,
        draftId: staleDraftId,
        transformation: editedTrans,
      },
      { Authorization: 'Bearer tok_teacher_a' }
    );
    assert(
      staleApproveRes.status === 409 && staleApproveRes.data?.code === 'STALE_DRAFT',
      '1.6c Stale draft approval blocked with HTTP 409 STALE_DRAFT',
      `status=${staleApproveRes.status} code=${staleApproveRes.data?.code}`
    );

    // 1.7 Save Teacher B's note for Student B (for RBAC & listing tests)
    const saveBRes = await makeRequest(
      server,
      'POST',
      '/api/session-notes',
      {
        id: LESSON_B_ID,
        lessonId: LESSON_B_ID,
        studentUid: STUDENT_B_UID,
        studentEmail: STUDENT_B_EMAIL,
        sessionDate: '2026-11-12',
        topic: 'Student B Confidential Lesson',
        content: '<div>Confidential B <span data-tag-type="new-word">✦ New Word</span>&nbsp;leverage</div>',
        skipDriveSync: true,
      },
      { Authorization: 'Bearer tok_teacher_b' }
    );
    assert(saveBRes.status === 200, '1.7 Teacher B saves Student B note (200)');

    console.log('\n--- Bloco 2: Progresso Sequencial, Lembrete Diário e Zero Espelhos ---');

    // 2.1 Student A persists sequential progress
    const progRes = await makeRequest(
      server,
      'POST',
      '/api/session-notes/progress',
      {
        studentUid: STUDENT_A_UID,
        studentEmail: STUDENT_A_EMAIL,
        lastSessionKey: LESSON_A_ID,
        stepIndex: 1,
        lastAssignedDate: '2026-11-13',
        lastReviewedDate: '2026-11-12',
        lastReviewedTab: 'mistakes',
      },
      { Authorization: 'Bearer tok_student_a' }
    );
    assert(progRes.status === 200 && progRes.data?.progress?.stepIndex === 1, '2.1 POST /api/session-notes/progress returns 200');

    // 2.2 Student A claims daily reminder twice same day -> idempotent
    const claim1 = await makeRequest(
      server,
      'POST',
      '/api/session-notes/reminder/claim',
      { studentUid: STUDENT_A_UID, dateStr: '2026-11-13', timeZone: 'America/Sao_Paulo' },
      { Authorization: 'Bearer tok_student_a' }
    );
    const claim2 = await makeRequest(
      server,
      'POST',
      '/api/session-notes/reminder/claim',
      { studentUid: STUDENT_A_UID, dateStr: '2026-11-13', timeZone: 'America/Sao_Paulo' },
      { Authorization: 'Bearer tok_student_a' }
    );
    assert(claim1.status === 200 && claim1.data?.canShow === true && claim1.data?.alreadyShown === false, '2.2a First daily reminder claim succeeds (canShow=true)');
    assert(claim2.status === 200 && claim2.data?.canShow === false && claim2.data?.alreadyShown === true, '2.2b Second claim same day is idempotent (alreadyShown=true)');

    // 2.3 Verify writeLog has ZERO forbidden writes
    const appStateWrites = mockDb.writeLog.filter((w) => w.path.startsWith('app_state/'));
    const legacySubcolNoteWrites = mockDb.writeLog.filter((w) => /^users\/[^/]+\/session_notes\/(?!review_cycle$)/.test(w.path));
    const rootUserForbiddenWrites = mockDb.writeLog.filter(
      (w) => /^users\/[^/]+$/.test(w.path) && (w.keys.includes('nativeNotesReview') || w.keys.includes('lastReminderShownDate'))
    );
    const reviewCycleWrites = mockDb.writeLog.filter((w) => w.path === `users/${STUDENT_A_UID}/session_notes/review_cycle`);

    assert(appStateWrites.length === 0, '2.3a Zero writes to app_state/*', `found=${appStateWrites.length}`);
    assert(legacySubcolNoteWrites.length === 0, '2.3b Zero mirror writes to users/{uid}/session_notes/{sessionKey}', `found=${legacySubcolNoteWrites.length}`);
    assert(rootUserForbiddenWrites.length === 0, '2.3c Zero mirror writes to root users/{uid} (nativeNotesReview/lastReminderShownDate)', `found=${rootUserForbiddenWrites.length}`);
    assert(reviewCycleWrites.length >= 2, '2.3d Progress & reminder claim written strictly to users/{uid}/session_notes/review_cycle');

    // 2.4 Verify saveAppStateToFirestore & fetchAppStateFromFirestore strip session notes maps
    mockDb.suspendWriteLog = true;
    await saveAppStateToFirestore({
      students: [],
      sessionNotesMap: { stale: { id: 'stale' } },
      sessionNotesProgressMap: { stale: { stepIndex: 9 } },
      pedagogicalTransformationsMap: { stale: { ok: true } },
    });
    const rawAppStateSnap = await mockDb.collection('app_state').doc('main_db').get();
    const fetchedAppState = await fetchAppStateFromFirestore();
    assert(
      !rawAppStateSnap.data()?.sessionNotesMap &&
        !rawAppStateSnap.data()?.sessionNotesProgressMap &&
        !rawAppStateSnap.data()?.pedagogicalTransformationsMap,
      '2.4a saveAppStateToFirestore strips sessionNotesMap/progress/pedagogical maps'
    );
    assert(
      !fetchedAppState?.sessionNotesMap &&
        !fetchedAppState?.sessionNotesProgressMap &&
        !fetchedAppState?.pedagogicalTransformationsMap,
      '2.4b fetchAppStateFromFirestore strips legacy session notes maps'
    );
    mockDb.suspendWriteLog = false;

    console.log('\n--- Bloco 3: Sobrevivência após Restart / Wipe Completo da RAM ---');

    // Wipe all RAM maps completely
    memDb.sessionNotesMap = {};
    memDb.sessionNotesProgressMap = {};
    memDb.pedagogicalTransformationsMap = {};

    const studentNotesAfterWipe = await makeRequest(
      server,
      'GET',
      `/api/session-notes?studentUid=${STUDENT_A_UID}`,
      undefined,
      { Authorization: 'Bearer tok_student_a' }
    );
    assert(
      studentNotesAfterWipe.status === 200 &&
        Array.isArray(studentNotesAfterWipe.data) &&
        studentNotesAfterWipe.data.length === 1 &&
        studentNotesAfterWipe.data[0].lastApprovedVersion?.transformation?.reviewSummary?.rememberThis?.includes('Edited by Teacher Alpha') &&
        studentNotesAfterWipe.data[0].driveFileId === 'drv_file_alpha_001',
      '3.1 GET /api/session-notes survives RAM wipe with lastApprovedVersion & Drive metadata preserved'
    );

    const versionsAfterWipe = await makeRequest(
      server,
      'GET',
      `/api/session-notes/${LESSON_A_ID}/versions`,
      undefined,
      { Authorization: 'Bearer tok_teacher_a' }
    );
    assert(
      versionsAfterWipe.status === 200 &&
        Array.isArray(versionsAfterWipe.data?.versionHistory) &&
        versionsAfterWipe.data.versionHistory.length >= 3 &&
        versionsAfterWipe.data.versionHistory.every((v: any, idx: number, arr: any[]) => idx === 0 || v.versionNumber > arr[idx - 1].versionNumber),
      '3.2 GET /api/session-notes/:id/versions survives RAM wipe with monotonic versions',
      `len=${versionsAfterWipe.data?.versionHistory?.length}`
    );

    const progressAfterWipe = await makeRequest(
      server,
      'GET',
      `/api/session-notes/progress?studentUid=${STUDENT_A_UID}`,
      undefined,
      { Authorization: 'Bearer tok_student_a' }
    );
    assert(
      progressAfterWipe.status === 200 &&
        progressAfterWipe.data?.stepIndex === 1 &&
        progressAfterWipe.data?.lastReminderShownDate === '2026-11-13',
      '3.3 GET /api/session-notes/progress survives RAM wipe'
    );

    const driveCheckAfterWipe = await makeRequest(
      server,
      'GET',
      '/api/drive/files/drv_file_alpha_001',
      undefined,
      { Authorization: 'Bearer tok_student_a' }
    );
    assert(
      driveCheckAfterWipe.status !== 403 && driveCheckAfterWipe.status !== 404,
      '3.4a GET /api/drive/files/:fileId authorizes Student A via Firestore after RAM wipe',
      `status=${driveCheckAfterWipe.status}`
    );

    const driveForbiddenOtherStudent = await makeRequest(
      server,
      'GET',
      '/api/drive/files/drv_file_alpha_001',
      undefined,
      { Authorization: 'Bearer tok_student_b' }
    );
    assert(
      driveForbiddenOtherStudent.status === 403,
      '3.4b GET /api/drive/files/:fileId blocks Student B with 403 after RAM wipe',
      `status=${driveForbiddenOtherStudent.status}`
    );

    console.log('\n--- Bloco 4: Listagens de Professor/Admin no Firestore & RBAC ---');

    // 4.1 Teacher A lists without studentUid -> sees ONLY Student A's note (not Student B's)
    const teacherAList = await makeRequest(
      server,
      'GET',
      '/api/session-notes',
      undefined,
      { Authorization: 'Bearer tok_teacher_a' }
    );
    const teacherAIds = Array.isArray(teacherAList.data) ? teacherAList.data.map((n: any) => n.id) : [];
    assert(
      teacherAList.status === 200 && teacherAIds.includes(LESSON_A_ID) && !teacherAIds.includes(LESSON_B_ID),
      '4.1 Linked Teacher A listing without studentUid queries Firestore & isolates strictly to Teacher A docs',
      `ids=${JSON.stringify(teacherAIds)}`
    );

    // 4.2 Admin lists without studentUid -> sees both Teacher A and Teacher B notes from Firestore
    const adminList = await makeRequest(
      server,
      'GET',
      '/api/session-notes',
      undefined,
      { Authorization: 'Bearer tok_admin' }
    );
    const adminIds = Array.isArray(adminList.data) ? adminList.data.map((n: any) => n.id) : [];
    assert(
      adminList.status === 200 && adminIds.includes(LESSON_A_ID) && adminIds.includes(LESSON_B_ID),
      '4.2 Admin listing without studentUid queries Firestore and returns all session notes',
      `ids=${JSON.stringify(adminIds)}`
    );

    // 4.3 Unlinked teacher & pending teacher & cross-student & unauthenticated rejections
    const unlinkedRead = await makeRequest(
      server,
      'GET',
      `/api/session-notes?studentUid=${STUDENT_A_UID}`,
      undefined,
      { Authorization: 'Bearer tok_teacher_b' }
    );
    const pendingList = await makeRequest(
      server,
      'GET',
      `/api/session-notes?studentUid=${STUDENT_A_UID}`,
      undefined,
      { Authorization: 'Bearer tok_teacher_pending' }
    );
    const pendingPost = await makeRequest(
      server,
      'POST',
      '/api/session-notes',
      { studentUid: STUDENT_A_UID, sessionDate: '2026-11-12', content: 'Pending teacher attempt', skipDriveSync: true },
      { Authorization: 'Bearer tok_teacher_pending' }
    );
    const crossStudentRead = await makeRequest(
      server,
      'GET',
      `/api/session-notes?studentUid=${STUDENT_B_UID}`,
      undefined,
      { Authorization: 'Bearer tok_student_a' }
    );
    const unauthRead = await makeRequest(server, 'GET', '/api/session-notes');

    assert(unlinkedRead.status === 403, '4.3a Unlinked Teacher B gets 403 on Student A notes');
    assert(pendingList.status === 403 && pendingPost.status === 403 && pendingPost.data?.code === 'TEACHER_NOT_APPROVED', '4.3b Pending teacher gets 403 on GET ?studentUid and POST /api/session-notes');
    assert(crossStudentRead.status === 403, '4.3c Cross-student read gets 403');
    assert(unauthRead.status === 401, '4.3d Unauthenticated request gets 401');

    console.log('\n--- Bloco 5: Fallback Legado Somente-Leitura & Fail-Closed ---');

    // 5.1 Read-only legacy fallback for session_notes & review_cycle
    const legacyNotesRes = await makeRequest(
      server,
      'GET',
      `/api/session-notes?studentUid=${STUDENT_LEGACY_UID}`,
      undefined,
      { Authorization: 'Bearer tok_student_legacy' }
    );
    assert(
      legacyNotesRes.status === 200 &&
        Array.isArray(legacyNotesRes.data) &&
        legacyNotesRes.data.some((n: any) => n.id === 'legacy_sess_2026_10_15' && n.content.includes('resilient')),
      '5.1a Legacy subcollection note read cleanly via GET /api/session-notes'
    );

    const legacyProgRes = await makeRequest(
      server,
      'GET',
      `/api/session-notes/progress?studentUid=${STUDENT_LEGACY_UID}`,
      undefined,
      { Authorization: 'Bearer tok_student_legacy' }
    );
    assert(
      legacyProgRes.status === 200 &&
        legacyProgRes.data?.lastSessionKey === 'legacy_sess_2026_10_15' &&
        legacyProgRes.data?.stepIndex === 2 &&
        legacyProgRes.data?.lastReminderShownDate === '2026-10-16',
      '5.1b Legacy root users/{uid}.nativeNotesReview fallback read cleanly via GET /api/session-notes/progress'
    );

    // Claiming reminder on same legacy date 2026-10-16 honors legacy lastReminderShownDate without root write
    mockDb.writeLog = [];
    const legacyClaimSameDay = await makeRequest(
      server,
      'POST',
      '/api/session-notes/reminder/claim',
      { studentUid: STUDENT_LEGACY_UID, dateStr: '2026-10-16', timeZone: 'America/Sao_Paulo' },
      { Authorization: 'Bearer tok_student_legacy' }
    );
    const legacyRootWrites = mockDb.writeLog.filter((w) => w.path === `users/${STUDENT_LEGACY_UID}`);
    assert(
      legacyClaimSameDay.status === 200 && legacyClaimSameDay.data?.alreadyShown === true && legacyRootWrites.length === 0,
      '5.1c Legacy reminder claim same day honored without writing to root users/{uid}'
    );

    // 5.2 Fail-closed: Firestore write error returns HTTP 500
    mockDb.failWriteMatcher = (p: string) => p.includes('session_notes/');
    const failSaveRes = await makeRequest(
      server,
      'POST',
      '/api/session-notes',
      {
        id: LESSON_A_ID,
        studentUid: STUDENT_A_UID,
        sessionDate: '2026-11-12',
        content: 'Should fail closed',
        skipDriveSync: true,
      },
      { Authorization: 'Bearer tok_teacher_a' }
    );
    mockDb.failWriteMatcher = null;
    assert(
      failSaveRes.status === 500 && failSaveRes.data?.code === 'FIRESTORE_SAVE_FAILED',
      '5.2 Fail-closed: Firestore write failure returns HTTP 500 FIRESTORE_SAVE_FAILED',
      `status=${failSaveRes.status} code=${failSaveRes.data?.code}`
    );

    console.log('\n--- Bloco 6: Auditoria Estática do Frontend & Preservação de UX ---');

    const rootDir = path.resolve(process.cwd());
    const reminderSrc = fs.readFileSync(path.join(rootDir, 'src/hooks/useNativeFriendsNotesReminder.ts'), 'utf8');
    const modalSrc = fs.readFileSync(path.join(rootDir, 'src/components/NativeFriendsNotesModal.tsx'), 'utf8');
    const panelSrc = fs.readFileSync(path.join(rootDir, 'src/components/TeacherLiveLessonNotesPanel.tsx'), 'utf8');

    assert(
      !reminderSrc.includes('firebase/firestore') &&
        !reminderSrc.includes('getDb') &&
        !reminderSrc.includes('fetchPedagogicalTransformation') &&
        !reminderSrc.includes('/api/pedagogical-notes') &&
        reminderSrc.includes('lastApprovedVersion') &&
        reminderSrc.includes('native-notes-updated'),
      '6.1 useNativeFriendsNotesReminder.ts uses lastApprovedVersion & server API with zero Web SDK / /api/pedagogical-notes calls'
    );

    assert(
      !modalSrc.includes('firebase/firestore') &&
        !modalSrc.includes('getDb') &&
        !modalSrc.includes('fetchPedagogicalTransformation') &&
        modalSrc.includes('syncSessionVocabularyToStudentDictionary') &&
        modalSrc.includes('notes-in-preparation-message'),
      '6.2 NativeFriendsNotesModal.tsx has zero Web SDK calls and preserves Alt+W vocab sync & #notes-in-preparation-message'
    );

    assert(
      !panelSrc.includes('firebase/firestore') &&
        !panelSrc.includes('getDb') &&
        !panelSrc.includes('firestoreSchemaValidator') &&
        panelSrc.includes("keyLower === 'y'") &&
        panelSrc.includes("keyLower === 'n'") &&
        panelSrc.includes("keyLower === 'w'") &&
        panelSrc.includes("keyLower === 'p'") &&
        panelSrc.includes('/draft') &&
        panelSrc.includes('/approve') &&
        panelSrc.includes('versionHistory') &&
        panelSrc.includes('syncSessionNotesToGoogleDrive') &&
        panelSrc.includes('native-notes-updated'),
      '6.3 TeacherLiveLessonNotesPanel.tsx has zero Web SDK writes and preserves Alt+Y/N/W/P, Draft/Approve/Versions & Drive sync'
    );
  } finally {
    resetFirebaseAdminFirestoreForTesting();
    setSessionNoteTransformAttemptExecutorForTesting(null);
    server.close();
  }

  console.log('\n================================================================================');
  console.log(`TOTAL: ${passed + failed} | APROVADOS: ${passed} | FALHAS: ${failed}`);
  console.log('================================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
  process.exit(0);
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
