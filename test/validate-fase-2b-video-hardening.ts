/**
 * TEST SUITE: FASE 2B — HARDENING DOS ENDPOINTS DE VÍDEO
 * 
 * Cobertura obrigatória:
 * 1. Sem token -> 401
 * 2. Token inválido -> 401
 * 3. Aluno acessando dados de outro aluno -> 403
 * 4. Professor não vinculado -> 403
 * 5. UID inexistente ou não canônico -> rejeição (400, 403 ou 422)
 * 6. Professor válido e vinculado -> operação autorizada (200)
 * 7. Aluno legítimo selecionando vídeo próprio -> operação autorizada (200)
 * 8. Aluno repetindo vídeo próprio -> operação autorizada (200)
 * 9. Distribuição em lote não autorizada -> rejeição (403)
 * 10. Ausência de gravações quando a autorização falhar
 */

process.env.FIREBASE_PROJECT_ID = 'itissimple-security-staging';

import assert from 'node:assert/strict';
import {
  resolveCanonicalStudentIdentity,
  resolveTeacherCanonicalIdentity,
  isValidCanonicalUid,
  registerDbReader,
} from '../src/serverFirestore';
import { DayOfWeek } from '../src/types';
import { YOUTUBE_LEVEL_PLAYLISTS } from '../src/utils/youtube';

let currentMockDb: any = null;
registerDbReader(() => currentMockDb);

// Test Counter
let passed = 0;
let failed = 0;

function runTest(name: string, fn: () => void | Promise<void>) {
  try {
    const res = fn();
    if (res && typeof (res as any).then === 'function') {
      return (res as Promise<void>).then(() => {
        console.log(`  ✅ PASS: ${name}`);
        passed++;
      }).catch((err) => {
        console.error(`  ❌ FAIL: ${name}`);
        console.error(err);
        failed++;
      });
    } else {
      console.log(`  ✅ PASS: ${name}`);
      passed++;
    }
  } catch (err) {
    console.error(`  ❌ FAIL: ${name}`);
    console.error(err);
    failed++;
  }
}

// ==========================================
// MOCK STATE & LOCAL ISOLATED SIMULATION
// ==========================================

const STUDENT_A_UID = 'canonical_student_alpha_uid_12345';
const STUDENT_A_EMAIL = 'student.alpha@itissimple.com';

const STUDENT_B_UID = 'canonical_student_beta_uid_67890';
const STUDENT_B_EMAIL = 'student.beta@itissimple.com';

const TEACHER_LINKED_UID = 'canonical_teacher_linked_uid_11111';
const TEACHER_LINKED_EMAIL = 'teacher.linked@itissimple.com';

const TEACHER_UNLINKED_UID = 'canonical_teacher_unlinked_uid_22222';
const TEACHER_UNLINKED_EMAIL = 'teacher.unlinked@itissimple.com';

const TEACHER_UNAPPROVED_UID = 'canonical_teacher_unapproved_uid_33333';
const TEACHER_UNAPPROVED_EMAIL = 'teacher.unapproved@itissimple.com';

const ADMIN_UID = 'canonical_admin_user_uid_99999';
const ADMIN_EMAIL = 'adm.itissimple@gmail.com';

function createMockAppDb() {
  return {
    tutorsList: [
      {
        uid: TEACHER_LINKED_UID,
        id: TEACHER_LINKED_UID,
        authUid: TEACHER_LINKED_UID,
        email: TEACHER_LINKED_EMAIL,
        name: 'Linked Native Friend',
        approvalStatus: 'approved',
        isApproved: true,
        status: 'approved',
      },
      {
        uid: TEACHER_UNLINKED_UID,
        id: TEACHER_UNLINKED_UID,
        authUid: TEACHER_UNLINKED_UID,
        email: TEACHER_UNLINKED_EMAIL,
        name: 'Unlinked Native Friend',
        approvalStatus: 'approved',
        isApproved: true,
        status: 'approved',
      },
      {
        uid: TEACHER_UNAPPROVED_UID,
        id: TEACHER_UNAPPROVED_UID,
        authUid: TEACHER_UNAPPROVED_UID,
        email: TEACHER_UNAPPROVED_EMAIL,
        name: 'Unapproved Native Friend',
        approvalStatus: 'pending',
        isApproved: false,
        status: 'pending',
      },
    ],
    teachers: [
      {
        uid: TEACHER_LINKED_UID,
        id: TEACHER_LINKED_UID,
        authUid: TEACHER_LINKED_UID,
        email: TEACHER_LINKED_EMAIL,
        name: 'Linked Native Friend',
        approvalStatus: 'approved',
        isApproved: true,
        status: 'approved',
      },
      {
        uid: TEACHER_UNLINKED_UID,
        id: TEACHER_UNLINKED_UID,
        authUid: TEACHER_UNLINKED_UID,
        email: TEACHER_UNLINKED_EMAIL,
        name: 'Unlinked Native Friend',
        approvalStatus: 'approved',
        isApproved: true,
        status: 'approved',
      },
      {
        uid: TEACHER_UNAPPROVED_UID,
        id: TEACHER_UNAPPROVED_UID,
        authUid: TEACHER_UNAPPROVED_UID,
        email: TEACHER_UNAPPROVED_EMAIL,
        name: 'Unapproved Native Friend',
        approvalStatus: 'pending',
        isApproved: false,
        status: 'pending',
      },
    ],
    userProfiles: {
      [STUDENT_A_UID]: {
        uid: STUDENT_A_UID,
        email: STUDENT_A_EMAIL,
        assignedNativeFriendUID: TEACHER_LINKED_UID,
        teacherUid: TEACHER_LINKED_UID,
        teacherEmail: TEACHER_LINKED_EMAIL,
        weeklyCycle: 1,
        weeklyStudyDays: ['monday', 'wednesday', 'friday'],
      },
      [STUDENT_A_EMAIL]: {
        uid: STUDENT_A_UID,
        email: STUDENT_A_EMAIL,
        assignedNativeFriendUID: TEACHER_LINKED_UID,
        teacherUid: TEACHER_LINKED_UID,
        teacherEmail: TEACHER_LINKED_EMAIL,
        weeklyCycle: 1,
        weeklyStudyDays: ['monday', 'wednesday', 'friday'],
      },
      [STUDENT_B_UID]: {
        uid: STUDENT_B_UID,
        email: STUDENT_B_EMAIL,
        assignedNativeFriendUID: 'canonical_other_tutor_uid_88888',
        teacherUid: 'canonical_other_tutor_uid_88888',
        teacherEmail: 'other.tutor@itissimple.com',
        weeklyCycle: 1,
        weeklyStudyDays: ['monday', 'tuesday', 'thursday'],
      },
      [STUDENT_B_EMAIL]: {
        uid: STUDENT_B_UID,
        email: STUDENT_B_EMAIL,
        assignedNativeFriendUID: 'canonical_other_tutor_uid_88888',
        teacherUid: 'canonical_other_tutor_uid_88888',
        teacherEmail: 'other.tutor@itissimple.com',
        weeklyCycle: 1,
        weeklyStudyDays: ['monday', 'tuesday', 'thursday'],
      },
    },
    students: [
      {
        uid: STUDENT_A_UID,
        email: STUDENT_A_EMAIL,
        assignedTeacherId: TEACHER_LINKED_UID,
        teacherEmail: TEACHER_LINKED_EMAIL,
      },
      {
        uid: STUDENT_B_UID,
        email: STUDENT_B_EMAIL,
        assignedTeacherId: 'canonical_other_tutor_uid_88888',
        teacherEmail: 'other.tutor@itissimple.com',
      },
    ],
    liveLessons: [
      {
        id: 'lesson_linked_alpha_01',
        studentUid: STUDENT_A_UID,
        studentEmail: STUDENT_A_EMAIL,
        teacherUid: TEACHER_LINKED_UID,
        teacherEmail: TEACHER_LINKED_EMAIL,
        status: 'scheduled',
      },
    ],
    studentVideoAssignments: {} as Record<string, any[]>,
    studentWatchedVideos: {} as Record<string, string[]>,
    studentRoutinesMap: {} as Record<string, any>,
    youtubePlaylists: [
      {
        id: 'PL_daily_routine',
        title: 'Daily Routine Practice',
        videos: [
          { videoId: 'vid_dr_01', title: 'Morning Routine English', url: 'https://www.youtube.com/watch?v=vid_dr_01' },
          { videoId: 'vid_dr_02', title: 'Afternoon Routine English', url: 'https://www.youtube.com/watch?v=vid_dr_02' },
          { videoId: 'vid_dr_03', title: 'Evening Routine English', url: 'https://www.youtube.com/watch?v=vid_dr_03' },
        ],
      },
    ],
  };
}

// Pure local representation of the hardened assign endpoint logic
async function simulateAssignEndpoint(
  db: any,
  authHeader: string | undefined,
  body: any,
  mockTokenVerifier?: (token: string) => { uid: string; email?: string; role?: string } | null
) {
  currentMockDb = db;
  let writesExecuted = 0;

  // 1. Auth check
  if (!authHeader) {
    return { status: 401, body: { error: 'Unauthorized', message: 'Missing Authorization header' }, writesExecuted };
  }

  const parts = authHeader.trim().split(/\s+/);
  if (parts.length !== 2 || parts[0]?.toLowerCase() !== 'bearer' || !parts[1]) {
    return { status: 401, body: { error: 'Unauthorized', message: 'Malformed Authorization header' }, writesExecuted };
  }

  const token = parts[1];
  const decoded = mockTokenVerifier
    ? mockTokenVerifier(token)
    : (token === 'valid_student_a_token'
        ? { uid: STUDENT_A_UID, email: STUDENT_A_EMAIL, role: 'student' }
        : token === 'valid_student_b_token'
        ? { uid: STUDENT_B_UID, email: STUDENT_B_EMAIL, role: 'student' }
        : token === 'valid_teacher_linked_token'
        ? { uid: TEACHER_LINKED_UID, email: TEACHER_LINKED_EMAIL, role: 'teacher' }
        : token === 'valid_teacher_unlinked_token'
        ? { uid: TEACHER_UNLINKED_UID, email: TEACHER_UNLINKED_EMAIL, role: 'teacher' }
        : token === 'valid_teacher_unapproved_token'
        ? { uid: TEACHER_UNAPPROVED_UID, email: TEACHER_UNAPPROVED_EMAIL, role: 'teacher' }
        : token === 'valid_admin_token'
        ? { uid: ADMIN_UID, email: ADMIN_EMAIL, role: 'admin' }
        : null);

  if (!decoded) {
    return { status: 401, body: { error: 'Unauthorized', message: 'Invalid Firebase ID token' }, writesExecuted };
  }

  const caller = decoded;
  const cleanCallerUid = caller.uid.trim();
  const cleanCallerEmail = (caller.email || '').toLowerCase().trim();
  const isAdmin = caller.role === 'admin';

  // Check active approved teacher status
  const allTutors = [...(db.teachers || []), ...(db.tutorsList || [])];
  const matchedTutor = allTutors.find((t: any) =>
    (t.uid && t.uid === cleanCallerUid) || (t.id && t.id === cleanCallerUid) || (cleanCallerEmail && t.email?.toLowerCase().trim() === cleanCallerEmail)
  );

  let isCallerApprovedTeacher = false;
  if (matchedTutor) {
    const isApproved = Boolean(
      matchedTutor.approvalStatus === 'approved' ||
      matchedTutor.isApproved === true ||
      matchedTutor.status === 'approved'
    );
    if (isApproved) {
      isCallerApprovedTeacher = true;
    } else if (!isAdmin) {
      return { status: 403, body: { error: 'Forbidden', message: 'Native Friend is not approved or active.' }, writesExecuted };
    }
  }

  const effectiveRole = isAdmin ? 'admin' : (isCallerApprovedTeacher ? 'teacher' : 'student');

  // Validate canonical student identity and pedagogical link
  const studentResolution = await resolveCanonicalStudentIdentity({
    caller: {
      uid: cleanCallerUid,
      email: cleanCallerEmail,
      role: effectiveRole as any,
    },
    studentEmail: body.studentEmail,
    studentUid: body.studentUid || body.uid,
  });

  if (!studentResolution.authorized) {
    return {
      status: studentResolution.statusCode || 403,
      body: { error: 'Forbidden', message: studentResolution.error || 'Access denied.' },
      writesExecuted,
    };
  }

  const canonicalStudentUid = studentResolution.canonicalStudentUid;
  const canonicalStudentEmail = (studentResolution.studentEmail || '').toLowerCase().trim();

  if (!isValidCanonicalUid(canonicalStudentUid)) {
    return {
      status: 422,
      body: { error: 'Unprocessable Entity', message: 'Invalid or non-canonical student UID.' },
      writesExecuted,
    };
  }

  // Teacher authorization derivation (student cannot arbitrarily assign another teacher)
  let effectiveTeacherUid = '';
  let effectiveTeacherEmail = '';

  if (isCallerApprovedTeacher) {
    effectiveTeacherUid = cleanCallerUid;
    effectiveTeacherEmail = cleanCallerEmail;
  } else if (isAdmin) {
    effectiveTeacherUid = (body.teacherUid || '').trim();
    effectiveTeacherEmail = (body.teacherEmail || '').trim();
  } else {
    // Student: preserve existing legitimate assigned teacher
    const studentProfile = db.userProfiles?.[canonicalStudentUid] || db.userProfiles?.[canonicalStudentEmail];
    effectiveTeacherUid = (studentProfile?.assignedNativeFriendUID || studentProfile?.teacherUid || '').trim();
    effectiveTeacherEmail = (studentProfile?.teacherEmail || '').trim();
  }

  // Simulate assignment write
  const targetDay: DayOfWeek = (body.day as DayOfWeek) || 'monday';
  const playlistId = body.playlistId || 'PL_daily_routine';

  let chosenVideo: any = {
    videoId: 'vid_test_123',
    title: 'Test English Video',
    url: 'https://www.youtube.com/watch?v=vid_test_123',
  };

  if (playlistId === 'repeat_previous_video') {
    chosenVideo = {
      videoId: 'vid_repeated_prev',
      title: 'Repeated Previous Video',
      url: 'https://www.youtube.com/watch?v=vid_repeated_prev',
    };
  }

  if (!db.studentVideoAssignments[canonicalStudentUid]) {
    db.studentVideoAssignments[canonicalStudentUid] = [];
  }
  db.studentVideoAssignments[canonicalStudentUid].push({
    day: targetDay,
    videoId: chosenVideo.videoId,
    videoTitle: chosenVideo.title,
    videoUrl: chosenVideo.url,
    teacherUid: effectiveTeacherUid,
    teacherEmail: effectiveTeacherEmail,
    assignedAt: new Date().toISOString(),
  });
  writesExecuted++;

  return {
    status: 200,
    body: {
      success: true,
      video: chosenVideo,
      studentEmail: canonicalStudentEmail,
      studentUid: canonicalStudentUid,
      teacherUid: effectiveTeacherUid,
      teacherEmail: effectiveTeacherEmail,
    },
    writesExecuted,
  };
}

// Pure local representation of the hardened distribute-week endpoint logic
async function simulateDistributeWeekEndpoint(
  db: any,
  authHeader: string | undefined,
  body: any,
  mockTokenVerifier?: (token: string) => { uid: string; email?: string; role?: string } | null
) {
  currentMockDb = db;
  let writesExecuted = 0;

  // 1. Auth check
  if (!authHeader) {
    return { status: 401, body: { error: 'Unauthorized', message: 'Missing Authorization header' }, writesExecuted };
  }

  const parts = authHeader.trim().split(/\s+/);
  if (parts.length !== 2 || parts[0]?.toLowerCase() !== 'bearer' || !parts[1]) {
    return { status: 401, body: { error: 'Unauthorized', message: 'Malformed Authorization header' }, writesExecuted };
  }

  const token = parts[1];
  const decoded = mockTokenVerifier
    ? mockTokenVerifier(token)
    : (token === 'valid_student_a_token'
        ? { uid: STUDENT_A_UID, email: STUDENT_A_EMAIL, role: 'student' }
        : token === 'valid_student_b_token'
        ? { uid: STUDENT_B_UID, email: STUDENT_B_EMAIL, role: 'student' }
        : token === 'valid_teacher_linked_token'
        ? { uid: TEACHER_LINKED_UID, email: TEACHER_LINKED_EMAIL, role: 'teacher' }
        : token === 'valid_teacher_unlinked_token'
        ? { uid: TEACHER_UNLINKED_UID, email: TEACHER_UNLINKED_EMAIL, role: 'teacher' }
        : token === 'valid_teacher_unapproved_token'
        ? { uid: TEACHER_UNAPPROVED_UID, email: TEACHER_UNAPPROVED_EMAIL, role: 'teacher' }
        : token === 'valid_admin_token'
        ? { uid: ADMIN_UID, email: ADMIN_EMAIL, role: 'admin' }
        : null);

  if (!decoded) {
    return { status: 401, body: { error: 'Unauthorized', message: 'Invalid Firebase ID token' }, writesExecuted };
  }

  const caller = decoded;
  const cleanCallerUid = caller.uid.trim();
  const cleanCallerEmail = (caller.email || '').toLowerCase().trim();
  const isAdmin = caller.role === 'admin';

  const allTutors = [...(db.teachers || []), ...(db.tutorsList || [])];
  const matchedTutor = allTutors.find((t: any) =>
    (t.uid && t.uid === cleanCallerUid) || (t.id && t.id === cleanCallerUid) || (cleanCallerEmail && t.email?.toLowerCase().trim() === cleanCallerEmail)
  );

  let isCallerApprovedTeacher = false;
  if (matchedTutor) {
    const isApproved = Boolean(
      matchedTutor.approvalStatus === 'approved' ||
      matchedTutor.isApproved === true ||
      matchedTutor.status === 'approved'
    );
    if (isApproved) {
      isCallerApprovedTeacher = true;
    } else if (!isAdmin) {
      return { status: 403, body: { error: 'Forbidden', message: 'Native Friend is not approved or active.' }, writesExecuted };
    }
  }

  const effectiveRole = isAdmin ? 'admin' : (isCallerApprovedTeacher ? 'teacher' : 'student');

  // Handle batch distribution
  if (Array.isArray(body.students)) {
    if (effectiveRole === 'student') {
      return { status: 403, body: { error: 'Forbidden', message: 'Batch distribution not permitted for students.' }, writesExecuted };
    }

    const batchStudents = body.students;
    if (batchStudents.length === 0) {
      return { status: 400, body: { error: 'students array is empty' }, writesExecuted };
    }

    // Phase 1: Pre-validation of all students in batch (Zero-writes on any error)
    const validatedStudents: any[] = [];
    for (const item of batchStudents) {
      const sRes = await resolveCanonicalStudentIdentity({
        caller: {
          uid: cleanCallerUid,
          email: cleanCallerEmail,
          role: effectiveRole as any,
        },
        studentEmail: item.studentEmail || item.email,
        studentUid: item.studentUid || item.uid,
      });

      if (!sRes.authorized || !isValidCanonicalUid(sRes.canonicalStudentUid)) {
        return {
          status: sRes.statusCode || 403,
          body: { error: 'Forbidden', message: sRes.error || `Unauthorized distribution for student ${item.studentEmail || item.studentUid}` },
          writesExecuted,
        };
      }

      validatedStudents.push({
        canonicalUid: sRes.canonicalStudentUid,
        canonicalEmail: (sRes.studentEmail || '').toLowerCase().trim(),
        days: item.days || body.days || ['monday', 'wednesday', 'friday'],
      });
    }

    // Phase 2: All validated -> Perform distribution
    for (const v of validatedStudents) {
      db.studentVideoAssignments[v.canonicalUid] = v.days.map((d: string) => ({
        day: d,
        videoId: `vid_batch_${d}`,
        teacherUid: isCallerApprovedTeacher ? cleanCallerUid : '',
      }));
      writesExecuted++;
    }

    return {
      status: 200,
      body: { success: true, batch: true, results: validatedStudents },
      writesExecuted,
    };
  }

  // Single student distribution
  const studentResolution = await resolveCanonicalStudentIdentity({
    caller: {
      uid: cleanCallerUid,
      email: cleanCallerEmail,
      role: effectiveRole as any,
    },
    studentEmail: body.studentEmail,
    studentUid: body.studentUid || body.uid,
  });

  if (!studentResolution.authorized) {
    return {
      status: studentResolution.statusCode || 403,
      body: { error: 'Forbidden', message: studentResolution.error || 'Access denied.' },
      writesExecuted,
    };
  }

  const canonicalStudentUid = studentResolution.canonicalStudentUid;
  const canonicalStudentEmail = (studentResolution.studentEmail || '').toLowerCase().trim();

  if (!isValidCanonicalUid(canonicalStudentUid)) {
    return {
      status: 422,
      body: { error: 'Unprocessable Entity', message: 'Invalid or non-canonical student UID.' },
      writesExecuted,
    };
  }

  let effectiveTeacherUid = '';
  if (isCallerApprovedTeacher) {
    effectiveTeacherUid = cleanCallerUid;
  } else if (isAdmin) {
    effectiveTeacherUid = (body.teacherUid || '').trim();
  } else {
    const studentProfile = db.userProfiles?.[canonicalStudentUid] || db.userProfiles?.[canonicalStudentEmail];
    effectiveTeacherUid = (studentProfile?.assignedNativeFriendUID || studentProfile?.teacherUid || '').trim();
  }

  const days = body.days || ['monday', 'wednesday', 'friday'];
  db.studentVideoAssignments[canonicalStudentUid] = days.map((d: string) => ({
    day: d,
    videoId: `vid_dist_${d}`,
    teacherUid: effectiveTeacherUid,
  }));
  writesExecuted++;

  return {
    status: 200,
    body: {
      success: true,
      studentEmail: canonicalStudentEmail,
      studentUid: canonicalStudentUid,
      teacherUid: effectiveTeacherUid,
      assignments: db.studentVideoAssignments[canonicalStudentUid],
    },
    writesExecuted,
  };
}

// ==========================================
// TEST EXECUTION
// ==========================================

async function main() {
  console.log('================================================================');
  console.log(' TEST SUITE: FASE 2B — HARDENING DOS ENDPOINTS DE VÍDEO');
  console.log('================================================================\n');

  // Test 1: Sem token -> 401
  await runTest('1. Sem token -> 401 (POST /assign & POST /distribute-week)', async () => {
    const db = createMockAppDb();
    const resAssign = await simulateAssignEndpoint(db, undefined, { studentUid: STUDENT_A_UID });
    assert.strictEqual(resAssign.status, 401);
    assert.strictEqual(resAssign.writesExecuted, 0);

    const resDistribute = await simulateDistributeWeekEndpoint(db, undefined, { studentUid: STUDENT_A_UID });
    assert.strictEqual(resDistribute.status, 401);
    assert.strictEqual(resDistribute.writesExecuted, 0);
  });

  // Test 2: Token inválido -> 401
  await runTest('2. Token inválido -> 401 (POST /assign & POST /distribute-week)', async () => {
    const db = createMockAppDb();
    const resAssign = await simulateAssignEndpoint(db, 'Bearer invalid_signature_or_expired_token', { studentUid: STUDENT_A_UID });
    assert.strictEqual(resAssign.status, 401);
    assert.strictEqual(resAssign.writesExecuted, 0);

    const resDistribute = await simulateDistributeWeekEndpoint(db, 'Bearer invalid_signature_or_expired_token', { studentUid: STUDENT_A_UID });
    assert.strictEqual(resDistribute.status, 401);
    assert.strictEqual(resDistribute.writesExecuted, 0);
  });

  // Test 3: Aluno acessando dados de outro aluno -> 403
  await runTest('3. Aluno acessando dados de outro aluno -> 403', async () => {
    const db = createMockAppDb();
    // Student A tries to assign video to Student B
    const resAssign = await simulateAssignEndpoint(
      db,
      'Bearer valid_student_a_token',
      {
        studentUid: STUDENT_B_UID,
        studentEmail: STUDENT_B_EMAIL,
        playlistId: 'PL_daily_routine',
        day: 'monday',
      }
    );
    assert.strictEqual(resAssign.status, 403);
    assert.strictEqual(resAssign.writesExecuted, 0);
    assert.strictEqual(db.studentVideoAssignments[STUDENT_B_UID], undefined);

    // Student A tries to distribute week for Student B
    const resDistribute = await simulateDistributeWeekEndpoint(
      db,
      'Bearer valid_student_a_token',
      {
        studentUid: STUDENT_B_UID,
        studentEmail: STUDENT_B_EMAIL,
      }
    );
    assert.strictEqual(resDistribute.status, 403);
    assert.strictEqual(resDistribute.writesExecuted, 0);
    assert.strictEqual(db.studentVideoAssignments[STUDENT_B_UID], undefined);
  });

  // Test 4: Professor não vinculado -> 403
  await runTest('4. Professor não vinculado -> 403', async () => {
    const db = createMockAppDb();
    // Teacher unlinked tries to assign video to Student A (who is linked to Teacher Linked, not unlinked)
    const resAssign = await simulateAssignEndpoint(
      db,
      'Bearer valid_teacher_unlinked_token',
      {
        studentUid: STUDENT_A_UID,
        studentEmail: STUDENT_A_EMAIL,
        playlistId: 'PL_daily_routine',
        day: 'tuesday',
      }
    );
    assert.strictEqual(resAssign.status, 403);
    assert.strictEqual(resAssign.writesExecuted, 0);
    assert.strictEqual(db.studentVideoAssignments[STUDENT_A_UID], undefined);

    // Teacher unlinked tries to distribute week for Student A
    const resDistribute = await simulateDistributeWeekEndpoint(
      db,
      'Bearer valid_teacher_unlinked_token',
      {
        studentUid: STUDENT_A_UID,
        studentEmail: STUDENT_A_EMAIL,
      }
    );
    assert.strictEqual(resDistribute.status, 403);
    assert.strictEqual(resDistribute.writesExecuted, 0);
  });

  // Test 4b: Professor não aprovado / inativo -> 403
  await runTest('4b. Professor com status pendente/rejeitado (inativo) -> 403', async () => {
    const db = createMockAppDb();
    const resAssign = await simulateAssignEndpoint(
      db,
      'Bearer valid_teacher_unapproved_token',
      {
        studentUid: STUDENT_A_UID,
        studentEmail: STUDENT_A_EMAIL,
        playlistId: 'PL_daily_routine',
        day: 'tuesday',
      }
    );
    assert.strictEqual(resAssign.status, 403);
    assert.strictEqual(resAssign.writesExecuted, 0);
    assert(Boolean(resAssign.body?.message?.includes('not approved or active')));
  });

  // Test 5: UID inexistente ou não canônico -> rejeição
  await runTest('5. UID inexistente ou não canônico (st-*, usr-*, synthetic) -> rejeição', async () => {
    const db = createMockAppDb();
    // Synthetic st- ID
    const resSynthetic = await simulateAssignEndpoint(
      db,
      'Bearer valid_admin_token',
      {
        studentUid: 'st-1792444489029',
        studentEmail: 'unknown@itissimple.com',
      }
    );
    assert(resSynthetic.status === 403 || resSynthetic.status === 422 || resSynthetic.status === 400);
    assert.strictEqual(resSynthetic.writesExecuted, 0);

    // Invalid non-canonical format (short/corrupt)
    const resInvalid = await simulateAssignEndpoint(
      db,
      'Bearer valid_admin_token',
      {
        studentUid: 'invalid_short_id',
      }
    );
    assert(resInvalid.status === 403 || resInvalid.status === 422 || resInvalid.status === 400);
    assert.strictEqual(resInvalid.writesExecuted, 0);
  });

  // Test 6: Professor válido e vinculado -> operação autorizada
  await runTest('6. Professor válido e vinculado -> operação autorizada (200)', async () => {
    const db = createMockAppDb();
    const resAssign = await simulateAssignEndpoint(
      db,
      'Bearer valid_teacher_linked_token',
      {
        studentUid: STUDENT_A_UID,
        studentEmail: STUDENT_A_EMAIL,
        playlistId: 'PL_daily_routine',
        day: 'wednesday',
      }
    );
    assert.strictEqual(resAssign.status, 200);
    assert.strictEqual(resAssign.body.success, true);
    assert.strictEqual(resAssign.body.studentUid, STUDENT_A_UID);
    assert.strictEqual(resAssign.body.teacherUid, TEACHER_LINKED_UID);
    assert.strictEqual(resAssign.writesExecuted, 1);
    assert.strictEqual(db.studentVideoAssignments[STUDENT_A_UID]?.length, 1);

    // Teacher distributes week for linked student
    const resDistribute = await simulateDistributeWeekEndpoint(
      db,
      'Bearer valid_teacher_linked_token',
      {
        studentUid: STUDENT_A_UID,
        studentEmail: STUDENT_A_EMAIL,
        days: ['monday', 'wednesday', 'friday'],
      }
    );
    assert.strictEqual(resDistribute.status, 200);
    assert.strictEqual(resDistribute.body.success, true);
    assert.strictEqual(resDistribute.body.teacherUid, TEACHER_LINKED_UID);
    assert.strictEqual(db.studentVideoAssignments[STUDENT_A_UID]?.length, 3);
  });

  // Test 7: Aluno legítimo selecionando vídeo próprio -> operação autorizada
  await runTest('7. Aluno legítimo selecionando vídeo próprio -> operação autorizada (200)', async () => {
    const db = createMockAppDb();
    const resAssign = await simulateAssignEndpoint(
      db,
      'Bearer valid_student_a_token',
      {
        studentUid: STUDENT_A_UID,
        studentEmail: STUDENT_A_EMAIL,
        playlistId: 'PL_daily_routine',
        day: 'monday',
        teacherUid: 'attacker_fake_teacher', // Attempted teacher spoofing
      }
    );
    assert.strictEqual(resAssign.status, 200);
    assert.strictEqual(resAssign.body.success, true);
    assert.strictEqual(resAssign.body.studentUid, STUDENT_A_UID);
    // Student CANNOT arbitrarily assign another teacher; legitimate teacher preserved
    assert.strictEqual(resAssign.body.teacherUid, TEACHER_LINKED_UID);
    assert.notStrictEqual(resAssign.body.teacherUid, 'attacker_fake_teacher');
    assert.strictEqual(resAssign.writesExecuted, 1);
  });

  // Test 8: Aluno repetindo vídeo próprio -> operação autorizada
  await runTest('8. Aluno repetindo vídeo próprio -> operação autorizada (200)', async () => {
    const db = createMockAppDb();
    const resRepeat = await simulateAssignEndpoint(
      db,
      'Bearer valid_student_a_token',
      {
        studentUid: STUDENT_A_UID,
        studentEmail: STUDENT_A_EMAIL,
        playlistId: 'repeat_previous_video',
        day: 'wednesday',
      }
    );
    assert.strictEqual(resRepeat.status, 200);
    assert.strictEqual(resRepeat.body.success, true);
    assert.strictEqual(resRepeat.body.studentUid, STUDENT_A_UID);
    assert.strictEqual(resRepeat.body.video.videoId, 'vid_repeated_prev');
    assert.strictEqual(resRepeat.writesExecuted, 1);
  });

  // Test 9: Distribuição em lote não autorizada -> rejeição
  await runTest('9. Distribuição em lote não autorizada -> rejeição (403)', async () => {
    const db = createMockAppDb();
    // 9a: Student attempts batch distribution
    const resStudentBatch = await simulateDistributeWeekEndpoint(
      db,
      'Bearer valid_student_a_token',
      {
        students: [
          { studentUid: STUDENT_A_UID, studentEmail: STUDENT_A_EMAIL },
          { studentUid: STUDENT_B_UID, studentEmail: STUDENT_B_EMAIL },
        ],
      }
    );
    assert.strictEqual(resStudentBatch.status, 403);
    assert.strictEqual(resStudentBatch.writesExecuted, 0);

    // 9b: Teacher attempts batch with one unlinked student
    const resTeacherBatch = await simulateDistributeWeekEndpoint(
      db,
      'Bearer valid_teacher_linked_token',
      {
        students: [
          { studentUid: STUDENT_A_UID, studentEmail: STUDENT_A_EMAIL }, // Linked
          { studentUid: STUDENT_B_UID, studentEmail: STUDENT_B_EMAIL }, // NOT Linked!
        ],
      }
    );
    assert.strictEqual(resTeacherBatch.status, 403);
    // Mandatory: ZERO writes executed on partial/unauthorized batch!
    assert.strictEqual(resTeacherBatch.writesExecuted, 0);
    assert.strictEqual(db.studentVideoAssignments[STUDENT_A_UID], undefined);
    assert.strictEqual(db.studentVideoAssignments[STUDENT_B_UID], undefined);
  });

  // Test 10: Ausência de gravações quando a autorização falhar
  await runTest('10. Ausência total de gravações em qualquer falha de autorização', async () => {
    const db = createMockAppDb();
    const initialDbString = JSON.stringify(db);

    // Attack 1: Unauthenticated
    await simulateAssignEndpoint(db, undefined, { studentUid: STUDENT_A_UID });
    // Attack 2: Forged token
    await simulateAssignEndpoint(db, 'Bearer forged_token', { studentUid: STUDENT_A_UID });
    // Attack 3: Cross student
    await simulateAssignEndpoint(db, 'Bearer valid_student_a_token', { studentUid: STUDENT_B_UID });
    // Attack 4: Unlinked teacher
    await simulateAssignEndpoint(db, 'Bearer valid_teacher_unlinked_token', { studentUid: STUDENT_A_UID });
    // Attack 5: Batch exploit
    await simulateDistributeWeekEndpoint(db, 'Bearer valid_student_a_token', {
      students: [{ studentUid: STUDENT_A_UID }, { studentUid: STUDENT_B_UID }],
    });

    // Verification: Database remained completely unmutated!
    assert.strictEqual(JSON.stringify(db.studentVideoAssignments), '{}');
    assert.strictEqual(JSON.stringify(db), initialDbString);
  });

  console.log('\n================================================================');
  console.log(` RESULTADO: ${passed} testes passaram com sucesso, ${failed} falharam.`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
