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
  verifyCanonicalPedagogicalLinkServer,
  resolveCanonicalUserRoleAndIdentity,
  resolveTeacherCanonicalIdentity,
} from '../src/serverFirestore';
import { resetGeminiSecurityStateForTesting } from '../src/serverGeminiSecurity';

/**
 * IT'S SIMPLE — NF-DOC.2E Validation Suite
 * Hotfix: Teacher Authorization + 100% English Teacher UI (No Deploy)
 *
 * Verifies:
 * 1. Authorized titular teacher (Skull Bee, standard Firebase ID token with NO custom role claim) -> 200 OK on /transform & /approve.
 * 2. Student -> 403 STUDENTS_CANNOT_TRANSFORM.
 * 3. Non-titular teacher (unlinked -> 403 UNAUTHORIZED_PEDAGOGICAL_LINK; linked non-owner -> 403 TEACHER_MISMATCH).
 * 4. Pending tutor & student/tutor conflict -> 403 (zero automatic UID/role/claim/link promotion or mutation).
 * 5. Canonical UID, pedagogical link, authored notes, and Gemini outputs strictly preserved.
 * 6. Native Friend (/teacher) UI components & teacher session-note API responses 100% in English.
 */

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

async function runSuite() {
  console.log('======================================================================');
  console.log("IT'S SIMPLE — NF-DOC.2E: TEACHER AUTHORIZATION + ENGLISH UI VALIDATION");
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
      console.error(`     ${err?.message || err}`);
    }
  }

  const skullBeeUid = 'jCkNIhvYEYbyJC2CWGZhFaoHGfo1';
  const skullBeeEmail = 'laviniafofafc@gmail.com';
  const otherTeacherUid = 'teacherOtherCanonicalUid987654';
  const otherTeacherEmail = 'other.tutor@example.com';
  const coLinkedTeacherUid = 'teacherCoLinkedCanonicalUid543';
  const coLinkedTeacherEmail = 'colinked.tutor@example.com';
  const pendingTeacherUid = 'teacherPendingCanonicalUid1111';
  const pendingTeacherEmail = 'pending.tutor@example.com';
  const conflictUserUid = 'conflictStudentTutorUid2222222';
  const conflictUserEmail = 'conflict.account@example.com';
  const studentUid = 'studentCanonicalUidSkullBee001';
  const studentEmail = 'aluno.skullbee@example.com';

  const firestoreStore: Record<string, any> = {
    // Skull Bee: users/{uid} has role='teacher' WITHOUT approvalStatus, while tutors/skull-bee has approvalStatus='approved' WITHOUT explicit role field
    [`users/${skullBeeUid}`]: {
      uid: skullBeeUid,
      email: skullBeeEmail,
      name: 'Skull Bee',
      role: 'teacher',
    },
    'tutors/skull-bee': {
      id: 'skull-bee',
      publicTutorId: 'skull-bee',
      uid: skullBeeUid,
      authUid: skullBeeUid,
      email: skullBeeEmail,
      name: 'Skull Bee',
      approvalStatus: 'approved',
      isApproved: true,
    },
    // Unlinked approved teacher
    [`tutors/${otherTeacherUid}`]: {
      id: otherTeacherUid,
      uid: otherTeacherUid,
      email: otherTeacherEmail,
      name: 'Other Native Friend',
      approvalStatus: 'approved',
      isApproved: true,
    },
    // Co-linked approved teacher (had a separate past lesson with same student, but is NOT titular of Skull Bee's session)
    [`tutors/${coLinkedTeacherUid}`]: {
      id: coLinkedTeacherUid,
      uid: coLinkedTeacherUid,
      email: coLinkedTeacherEmail,
      name: 'Co-Linked Native Friend',
      role: 'tutor',
      approvalStatus: 'approved',
      isApproved: true,
    },
    'lessons/past-colinked-lesson': {
      id: 'past-colinked-lesson',
      studentUid,
      teacherUid: coLinkedTeacherUid,
      status: 'completed',
      startDateTime: '2026-10-01T14:00:00.000Z',
    },
    // Pending unapproved teacher
    [`tutors/${pendingTeacherUid}`]: {
      id: pendingTeacherUid,
      uid: pendingTeacherUid,
      email: pendingTeacherEmail,
      name: 'Pending Candidate',
      approvalStatus: 'pending',
      isApproved: false,
    },
    // Conflicting student + approved tutor record (must NOT be promoted)
    [`users/${conflictUserUid}`]: {
      uid: conflictUserUid,
      email: conflictUserEmail,
      name: 'Conflict Account',
      role: 'student',
    },
    [`tutors/${conflictUserUid}`]: {
      id: conflictUserUid,
      uid: conflictUserUid,
      email: conflictUserEmail,
      name: 'Conflict Tutor Doc',
      approvalStatus: 'approved',
      isApproved: true,
    },
    // Canonical student linked to Skull Bee
    [`users/${studentUid}`]: {
      uid: studentUid,
      email: studentEmail,
      name: 'Lucas Mendes',
      role: 'student',
      level: 'intermediario',
      teacherUid: skullBeeUid,
      assignedNativeFriendUID: skullBeeUid,
      teacherId: 'skull-bee',
    },
    'lessons/lesson-skullbee-2e': {
      id: 'lesson-skullbee-2e',
      studentUid,
      studentEmail,
      teacherUid: skullBeeUid,
      teacherEmail: skullBeeEmail,
      teacherName: 'Skull Bee',
      title: 'Daily Conversation & Idioms',
      status: 'scheduled',
      startDateTime: '2026-11-12T15:00:00.000Z',
    },
  };

  const initialSkullBeeUserSnapshot = JSON.stringify(firestoreStore[`users/${skullBeeUid}`]);
  const initialSkullBeeTutorSnapshot = JSON.stringify(firestoreStore['tutors/skull-bee']);
  const initialStudentSnapshot = JSON.stringify(firestoreStore[`users/${studentUid}`]);

  setIsCloudWriteDisabled(false);
  setFirebaseAdminFirestoreForTesting(createInMemoryFirestore(firestoreStore) as any);

  // IMPORTANT: Standard Firebase ID tokens for Native Friends have NO custom 'role' claim!
  const tokenMap: Record<string, any> = {
    'token-skull-bee': { uid: skullBeeUid, email: skullBeeEmail, email_verified: true },
    'token-other-teacher': { uid: otherTeacherUid, email: otherTeacherEmail, email_verified: true },
    'token-colinked-teacher': { uid: coLinkedTeacherUid, email: coLinkedTeacherEmail, email_verified: true },
    'token-pending-teacher': { uid: pendingTeacherUid, email: pendingTeacherEmail, email_verified: true },
    'token-conflict-user': { uid: conflictUserUid, email: conflictUserEmail, email_verified: true },
    'token-student': { uid: studentUid, email: studentEmail, email_verified: true },
  };

  setFirebaseAdminAuthForTesting({
    verifyIdToken: async (token: string) => {
      if (tokenMap[token]) return tokenMap[token];
      throw new Error('Invalid token');
    },
    getUser: async (uid: string) => {
      const entry = Object.values(tokenMap).find((u: any) => u.uid === uid);
      if (entry) return entry;
      throw new Error('User not found');
    },
    getUserByEmail: async (email: string) => {
      const entry = Object.values(tokenMap).find((u: any) => u.email === email);
      if (entry) return entry;
      throw new Error('User not found');
    },
  } as any);

  const mockGeminiResponse = {
    mistakesAnalysis: [
      {
        id: 'mistake-1',
        original: 'I have 28 years old',
        corrected: 'I am 28 years old',
        category: 'grammar',
        explanation: 'Em inglês usamos o verbo to be para expressar idade.',
        twoExamples: ['I am 28 years old.', 'She is 30 years old.'],
        commonPitfalls: 'Evite traduzir "ter anos" literalmente com have.',
      },
    ],
    grammarPoints: [
      {
        id: 'grammar-1',
        topic: 'Verb To Be for Age',
        rule: 'Use subject + am/is/are + age + years old.',
        form: 'Subject + to be + number + years old',
        usage: 'Used whenever stating someone’s age in English.',
        examples: ['I am 28 years old.', 'My brother is 25.'],
        commonMistakes: 'Using have instead of to be.',
        comparisons: 'Em português dizemos "eu tenho", mas em inglês "eu sou/estou" (I am).',
      },
    ],
    vocabularyAndExpressions: [
      {
        id: 'vocab-1',
        term: 'break the ice',
        partOfSpeech: 'Idiom',
        definitionEn: 'To make people feel more relaxed in a social situation.',
        simpleDefinition: 'Quebrar o gelo e deixar a conversa mais leve no início.',
        collocations: ['break the ice at a meeting'],
        realExamples: ['A friendly joke helped break the ice.'],
        synonyms: ['warm up the room'],
        register: 'idiomatic',
        isNewWord: true,
      },
    ],
    reviewSummary: {
      estimatedMinutes: '5–10 minutes',
      keyRules: ['Use to be (am/is/are) to state age in English.'],
      mustKnowVocabulary: ['break the ice'],
      essentialCorrections: [{ original: 'I have 28 years old', corrected: 'I am 28 years old' }],
      rememberThis: 'Lembre-se: para idade em inglês sempre usamos I AM, nunca I have!',
    },
  };

  const authoredRawNotes = [
    'Native Friend In-Session Notes — Autorais da Skull Bee',
    '(Alt+N) I have 28 years old (Alt+Y) I am 28 years old',
    '(Alt+W) break the ice',
    'Observação autoral da professora em português/inglês preservada integralmente.',
  ].join('\n');

  const server = http.createServer(serverApp);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    await test('1.1: Skull Bee canonical identity & pedagogical link resolve as authorized teacher without custom token claims', async () => {
      const canonical = await resolveCanonicalUserRoleAndIdentity({
        uid: skullBeeUid,
        email: skullBeeEmail,
        tokenRole: 'student', // simulates default role assigned by firebaseAuthMiddleware when no custom claim exists
      });
      assert.strictEqual(canonical.role, 'teacher');
      assert.strictEqual(canonical.identityStatus, 'authorized');
      assert.strictEqual(canonical.uid, skullBeeUid);
      assert.strictEqual(canonical.publicTutorId, 'skull-bee');

      const teacherIdent = await resolveTeacherCanonicalIdentity({ teacherUid: skullBeeUid });
      assert(teacherIdent, 'resolveTeacherCanonicalIdentity must return Skull Bee identity');
      assert.strictEqual(teacherIdent.isApproved, true);
      assert.strictEqual(teacherIdent.canonicalUid, skullBeeUid);
      assert.strictEqual(teacherIdent.publicTutorId, 'skull-bee');

      const linked = await verifyCanonicalPedagogicalLinkServer(skullBeeUid, studentUid);
      assert.strictEqual(linked, true, 'verifyCanonicalPedagogicalLinkServer must confirm link');
    });

    await test('1.2: Skull Bee saves session notes and executes POST /api/session-notes/:id/transform (200 OK, even via lesson_ prefix)', async () => {
      const saveRes = await makeRequest(
        server,
        'POST',
        '/api/session-notes',
        {
          id: 'lesson-skullbee-2e',
          lessonId: 'lesson-skullbee-2e',
          studentUid,
          studentEmail,
          teacherUid: skullBeeUid,
          teacherEmail: skullBeeEmail,
          teacherName: 'Skull Bee',
          sessionDate: '2026-11-12',
          topic: 'Daily Conversation & Idioms',
          content: authoredRawNotes,
          rawContent: authoredRawNotes,
        },
        { Authorization: 'Bearer token-skull-bee' }
      );
      assert.strictEqual(saveRes.status, 200, `Expected 200 on save, got ${saveRes.status}: ${JSON.stringify(saveRes.data)}`);

      resetGeminiSecurityStateForTesting();
      setSessionNoteTransformAttemptExecutorForTesting(async () => JSON.stringify(mockGeminiResponse));

      // Test both lesson_ prefixed key and canonical lessonId key
      const transformRes = await makeRequest(
        server,
        'POST',
        '/api/session-notes/lesson_lesson-skullbee-2e/transform',
        {
          studentUid,
          teacherUid: skullBeeUid,
          language: 'pt',
        },
        { Authorization: 'Bearer token-skull-bee' }
      );

      assert.strictEqual(transformRes.status, 200, `Expected 200 on transform, got ${transformRes.status}: ${JSON.stringify(transformRes.data)}`);
      assert.strictEqual(transformRes.data.success, true);
      assert(transformRes.data.draftTransformation, 'draftTransformation must be returned');
      assert.strictEqual(transformRes.data.sessionNote.teacherUid, skullBeeUid);
      assert.strictEqual(transformRes.data.sessionNote.studentUid, studentUid);
      // Authored raw notes and Gemini Portuguese explanations preserved intact
      assert.strictEqual(transformRes.data.sessionNote.rawContent, authoredRawNotes);
      assert(
        transformRes.data.draftTransformation.transformation.mistakesAnalysis[0].explanation.includes('verbo to be'),
        'Gemini pedagogical response must be preserved intact'
      );
    });

    await test('1.3: Student calling POST /api/session-notes/:id/transform is rejected with 403 STUDENTS_CANNOT_TRANSFORM', async () => {
      const res = await makeRequest(
        server,
        'POST',
        '/api/session-notes/lesson-skullbee-2e/transform',
        { studentUid },
        { Authorization: 'Bearer token-student' }
      );
      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.data.code, 'STUDENTS_CANNOT_TRANSFORM');
      assert.strictEqual(res.data.message, 'Students cannot transform pedagogical notes.');
    });

    await test('1.4: Non-titular teacher without pedagogical link receives 403 UNAUTHORIZED_PEDAGOGICAL_LINK in English', async () => {
      const res = await makeRequest(
        server,
        'POST',
        '/api/session-notes/lesson-skullbee-2e/transform',
        {},
        { Authorization: 'Bearer token-other-teacher' }
      );
      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.data.code, 'UNAUTHORIZED_PEDAGOGICAL_LINK');
      assert(res.data.message.includes('Native Friend does not have an authorized pedagogical link'));
    });

    await test('1.5: Co-linked non-titular teacher attempting to transform Skull Bee session receives 403 TEACHER_MISMATCH in English', async () => {
      const res = await makeRequest(
        server,
        'POST',
        '/api/session-notes/lesson-skullbee-2e/transform',
        {},
        { Authorization: 'Bearer token-colinked-teacher' }
      );
      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.data.code, 'TEACHER_MISMATCH');
      assert(res.data.message.includes('Teacher is not authorized to transform notes belonging to another teacher'));
    });

    await test('1.6: Pending tutor and conflicting student/tutor accounts receive 403 without any automatic role promotion', async () => {
      const pendingRes = await makeRequest(
        server,
        'POST',
        '/api/session-notes/lesson-skullbee-2e/transform',
        {},
        { Authorization: 'Bearer token-pending-teacher' }
      );
      assert.strictEqual(pendingRes.status, 403);
      assert.strictEqual(pendingRes.data.code, 'TEACHER_NOT_APPROVED');

      const conflictRes = await makeRequest(
        server,
        'POST',
        '/api/session-notes/lesson-skullbee-2e/transform',
        {},
        { Authorization: 'Bearer token-conflict-user' }
      );
      assert.strictEqual(conflictRes.status, 403);
      assert.strictEqual(conflictRes.data.code, 'IDENTITY_CONFLICT');
    });

    await test('1.7: Zero automatic mutations on UIDs, roles, or pedagogical links in Firestore', () => {
      assert.strictEqual(
        JSON.stringify(firestoreStore[`users/${skullBeeUid}`]),
        initialSkullBeeUserSnapshot,
        'users/{skullBeeUid} must remain completely untouched'
      );
      assert.strictEqual(
        JSON.stringify(firestoreStore['tutors/skull-bee']),
        initialSkullBeeTutorSnapshot,
        'tutors/skull-bee must remain completely untouched'
      );
      assert.strictEqual(
        JSON.stringify(firestoreStore[`users/${studentUid}`]),
        initialStudentSnapshot,
        'users/{studentUid} pedagogical link and profile must remain completely untouched'
      );
    });

    await test('2.1: Native Friend (/teacher) UI components contain 100% English teacher-facing strings with zero Portuguese leaks', () => {
      const teacherUiFiles = [
        'src/components/TeacherLiveLessonNotesPanel.tsx',
        'src/components/TeacherScheduleControlTable.tsx',
        'src/components/TeacherSpotifyRoutineTracker.tsx',
        'src/components/TeacherMediaAssignmentPanel.tsx',
        'src/components/NativeFriendLessonInsights.tsx',
        'src/components/EditTutorProfileModal.tsx',
        'src/components/TeacherMeetConfigModal.tsx',
      ];

      const forbiddenPortugueseFragments = [
        'Arquivo atualizado no seu Google Drive',
        'Arquivo criado no seu Google Drive',
        'Clear definition in English or Portuguese',
        'Link da reunião ainda não configurado',
        '<span>Pendente</span>',
        'Sincronizar playlists do YouTube',
        'Timezone (Fuso Horário)',
        'Aplicar IA',
        'Aprovar e Publicar',
        'getDayLabel(currentSpotifyTrack.dayOfWeek, \'pt\')',
      ];

      for (const relPath of teacherUiFiles) {
        const content = fs.readFileSync(path.resolve(process.cwd(), relPath), 'utf8');
        for (const fragment of forbiddenPortugueseFragments) {
          // Allow code comments to contain phase titles if any, inspect non-comment lines
          const nonCommentLines = content
            .split('\n')
            .filter((line) => {
              const t = line.trim();
              return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*') && !t.startsWith('{/*');
            })
            .join('\n');
          assert(
            !nonCommentLines.includes(fragment),
            `Found Portuguese leak "${fragment}" in ${relPath}`
          );
        }
      }

      const navbarContent = fs.readFileSync(path.resolve(process.cwd(), 'src/components/Navbar.tsx'), 'utf8');
      assert(
        navbarContent.includes('currentLanguage={navLanguage}'),
        'Navbar must pass navLanguage ("en" for teachers) to HeaderMessagesPopover'
      );
    });
  } finally {
    setSessionNoteTransformAttemptExecutorForTesting(null);
    resetGeminiSecurityStateForTesting();
    resetFirebaseAdminFirestoreForTesting();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  console.log('\n======================================================================');
  console.log(`NF-DOC.2E VALIDATION RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('======================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
  process.exit(0);
}

runSuite().catch((err) => {
  console.error('Fatal error in NF-DOC.2E validation:', err);
  process.exit(1);
});
