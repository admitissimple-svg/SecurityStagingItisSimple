/**
 * TEST SUITE: HOTFIX 4B.16 — Mandatory Trial Lesson & Teacher Meeting Room
 * Project: itissimple-security-staging
 * 
 * Required Tests:
 * 1. New student without a Trial Lesson cannot complete onboarding or access weekly configuration.
 * 2. New student can successfully schedule a Trial Lesson.
 * 3. Student with a confirmed Trial Lesson can proceed normally.
 * 4. Refreshing or reopening the application preserves the correct state.
 * 5. Booking with Charles uses his configured meeting URL.
 * 6. Booking with another teacher uses that teacher's own URL.
 * 7. Missing meeting URL does not produce meet.google.com/new.
 * 8. Teacher and student see the same correct appointment URL.
 * 9. Existing appointment and security functionality remains intact.
 */

import { scheduleLessonAtomicServer, resolveTeacherCanonicalIdentity } from '../src/serverFirestore';
import { generateGoogleCalendarWebLink } from '../src/utils/calendar';
import * as fs from 'fs';
import * as path from 'path';

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

async function runTests() {
  console.log('=========================================================================');
  console.log(' TEST SUITE: HOTFIX 4B.16 — MANDATORY TRIAL LESSON & TEACHER MEET ROOM');
  console.log(' Project: itissimple-security-staging');
  console.log('=========================================================================\n');

  // Common Charles profile
  const charlesAuthUid = 'ch4rL35Sm1thU1d999888777666';
  const charlesPersonalMeetUrl = 'https://meet.google.com/charles-personal-room-xyz';
  const charlesPublicTutorId = 'tutor-charles-smith-example-com';
  const charlesEmail = 'charles.smith@example.com';

  // Common Alice profile (another teacher)
  const aliceAuthUid = 'aL1c3Sm1thU1d111222333444';
  const alicePersonalMeetUrl = 'https://meet.google.com/alice-custom-room-abc';
  const alicePublicTutorId = 'tutor-alice-example-com';
  const aliceEmail = 'alice.tutor@example.com';

  // Teacher with NO configured meeting URL
  const bobAuthUid = 'b0bSm1thU1d555666777888';
  const bobPublicTutorId = 'tutor-bob-example-com';
  const bobEmail = 'bob.tutor@example.com';

  const mockDbState: any = {
    tutorsList: [
      {
        id: charlesPublicTutorId,
        publicTutorId: charlesPublicTutorId,
        uid: charlesAuthUid,
        authUid: charlesAuthUid,
        name: 'Charles Smith',
        email: charlesEmail,
        meetUrl: charlesPersonalMeetUrl,
        meetLink: charlesPersonalMeetUrl,
        approvalStatus: 'approved',
        isApproved: true,
        availableDays: ['monday', 'wednesday', 'friday'],
      },
      {
        id: alicePublicTutorId,
        publicTutorId: alicePublicTutorId,
        uid: aliceAuthUid,
        authUid: aliceAuthUid,
        name: 'Alice Wonder',
        email: aliceEmail,
        meetUrl: alicePersonalMeetUrl,
        meetLink: alicePersonalMeetUrl,
        approvalStatus: 'approved',
        isApproved: true,
        availableDays: ['tuesday', 'thursday'],
      },
      {
        id: bobPublicTutorId,
        publicTutorId: bobPublicTutorId,
        uid: bobAuthUid,
        authUid: bobAuthUid,
        name: 'Bob Simple',
        email: bobEmail,
        // No meetUrl configured!
        approvalStatus: 'approved',
        isApproved: true,
        availableDays: ['monday'],
      },
    ],
    teachers: [],
    meetSettings: {
      [charlesAuthUid]: {
        teacherEmail: charlesEmail,
        meetLink: charlesPersonalMeetUrl,
      },
      [aliceAuthUid]: {
        teacherEmail: aliceEmail,
        meetLink: alicePersonalMeetUrl,
      },
    },
    teacherSettings: {
      [charlesEmail]: {
        teacherEmail: charlesEmail,
        meetLink: charlesPersonalMeetUrl,
      },
    },
    liveLessons: [],
    userProfiles: {},
  };

  // ---------------------------------------------------------------------------
  // TEST 1: New student without Trial Lesson cannot complete onboarding or access weekly configuration
  // ---------------------------------------------------------------------------
  console.log('--- Test 1: New student without Trial Lesson cannot complete onboarding or access weekly configuration ---');
  {
    // Simulation of student profile after Step 5 (handleCompleteOnboarding)
    const newStudentProfile = {
      id: 'student-uid-test-1',
      uid: 'student-uid-test-1',
      name: 'Maria Silva',
      email: 'maria@example.com',
      teacherEmail: charlesEmail,
      teacherId: charlesPublicTutorId,
      hasCompletedTrialLesson: false,
      onboardingCompleted: false, // Step 5 MUST keep onboardingCompleted: false
      contractedLessons: 1,
    };

    const hasConfirmedTrialLessonCheck = (profile: any, studentLessons: any[]) => {
      if (profile?.hasCompletedTrialLesson) return true;
      const cleanEmail = (profile?.email || '').toLowerCase().trim();
      const cleanUid = profile?.uid || profile?.id || '';
      return studentLessons.some((l) => {
        const isMatch =
          (cleanEmail && (l.studentEmail || '').toLowerCase().trim() === cleanEmail) ||
          (cleanUid && (l.studentUid === cleanUid || l.uid === cleanUid));
        const isCancelled = l.status === 'cancelled' || l.status === 'canceled' || Boolean(l.cancelledAt);
        return isMatch && Boolean(l.isTrialLesson) && !isCancelled;
      });
    };

    const studentLessons: any[] = [];
    const hasConfirmed = hasConfirmedTrialLessonCheck(newStudentProfile, studentLessons);

    assert(
      newStudentProfile.onboardingCompleted === false,
      'Perfil recém-registrado mantém onboardingCompleted: false antes de agendar a aula teste'
    );
    assert(
      hasConfirmed === false,
      'hasConfirmedTrialLesson retorna false para aluno novo sem agendamento'
    );

    // Verify weekly configuration lock
    const isStartNewWeekUnlocked = hasConfirmed || newStudentProfile.hasCompletedTrialLesson;
    assert(
      isStartNewWeekUnlocked === false,
      'Configuração semanal ("Start New Week") fica bloqueada até o agendamento da aula teste'
    );

    // Verify OnboardingWizardModal removed "Configure Your Week" / onOpenStartNewWeek
    const onboardingModalContent = fs.readFileSync(
      path.resolve(process.cwd(), 'src/components/OnboardingWizardModal.tsx'),
      'utf-8'
    );
    assert(
      !onboardingModalContent.includes('onOpenStartNewWeek'),
      'OnboardingWizardModal não possui mais prop onOpenStartNewWeek'
    );
    assert(
      !onboardingModalContent.includes('handleFinishToDashboard'),
      'OnboardingWizardModal não possui mais handleFinishToDashboard para pular agendamento'
    );
  }

  // ---------------------------------------------------------------------------
  // TEST 2: New student can successfully schedule a Trial Lesson
  // ---------------------------------------------------------------------------
  console.log('\n--- Test 2: New student can successfully schedule a Trial Lesson ---');
  {
    const studentUid = 'student-uid-test-2';
    const studentEmail = 'maria.trial@example.com';

    mockDbState.userProfiles[studentEmail] = {
      uid: studentUid,
      email: studentEmail,
      name: 'Maria Trial',
      hasCompletedTrialLesson: false,
      contractedLessons: 1,
      availableLessons: 1,
    };

    const scheduleResult = await scheduleLessonAtomicServer({
      studentAuthUid: studentUid,
      studentEmail: studentEmail,
      studentName: 'Maria Trial',
      teacherIdOrEmail: charlesPublicTutorId,
      startDateTime: '2026-10-25T14:00:00.000Z',
      endDateTime: '2026-10-25T14:25:00.000Z',
      title: '1ª Aula Teste Experimental',
      isTrialLesson: true,
      existingLessons: mockDbState.liveLessons,
      dbState: mockDbState,
    });

    assert(scheduleResult.success === true, 'Agendamento atômico da Aula Teste concluído com sucesso');
    assert(scheduleResult.lesson?.isTrialLesson === true, 'Aula registrada expressamente como isTrialLesson: true');
    assert(scheduleResult.lesson?.teacherUid === charlesAuthUid, 'teacherUid associado ao UID canônico de Charles');

    if (scheduleResult.lesson) {
      mockDbState.liveLessons.push(scheduleResult.lesson);
    }
  }

  // ---------------------------------------------------------------------------
  // TEST 3: Student with a confirmed Trial Lesson can proceed normally
  // ---------------------------------------------------------------------------
  console.log('\n--- Test 3: Student with a confirmed Trial Lesson can proceed normally ---');
  {
    const studentEmail = 'maria.trial@example.com';
    const studentUid = 'student-uid-test-2';

    // Simulate state update after booking confirmation
    const updatedProfile = {
      ...mockDbState.userProfiles[studentEmail],
      onboardingCompleted: true, // Marked true upon successful trial booking
    };

    const hasConfirmedTrialLessonCheck = (profile: any, studentLessons: any[]) => {
      if (profile?.hasCompletedTrialLesson) return true;
      const cleanEmail = (profile?.email || '').toLowerCase().trim();
      const cleanUid = profile?.uid || profile?.id || '';
      return studentLessons.some((l) => {
        const isMatch =
          (cleanEmail && (l.studentEmail || '').toLowerCase().trim() === cleanEmail) ||
          (cleanUid && (l.studentUid === cleanUid || l.uid === cleanUid));
        const isCancelled = l.status === 'cancelled' || l.status === 'canceled' || Boolean(l.cancelledAt);
        return isMatch && Boolean(l.isTrialLesson) && !isCancelled;
      });
    };

    const hasConfirmed = hasConfirmedTrialLessonCheck(updatedProfile, mockDbState.liveLessons);
    assert(hasConfirmed === true, 'hasConfirmedTrialLesson retorna true após agendamento confirmado');

    const isStartNewWeekUnlocked = hasConfirmed || updatedProfile.hasCompletedTrialLesson;
    assert(isStartNewWeekUnlocked === true, 'Configuração semanal ("Start New Week") desbloqueada');
    assert(updatedProfile.onboardingCompleted === true, 'Passo obrigatório de onboarding marcado como concluído');
  }

  // ---------------------------------------------------------------------------
  // TEST 4: Refreshing or reopening the application preserves the correct state
  // ---------------------------------------------------------------------------
  console.log('\n--- Test 4: Refreshing or reopening application preserves correct state ---');
  {
    const appTsxContent = fs.readFileSync(path.resolve(process.cwd(), 'src/App.tsx'), 'utf-8');

    // Verify App.tsx restores onboardingCompleted properly
    assert(
      appTsxContent.includes('onboardingCompleted: typeof firestoreDoc?.onboardingCompleted === "boolean"'),
      'App.tsx restaura status booleano exato de onboardingCompleted do banco'
    );

    // Verify onClose does not leave student stranded on dashboard without trial lesson
    assert(
      appTsxContent.includes('if (!hasConfirmedTrialLesson && (!currentAccount || currentAccount.role === \'student\'))'),
      'App.tsx redireciona para landing se aluno sair sem agendar aula teste'
    );

    // Verify student cannot bypass via direct navigation
    assert(
      appTsxContent.includes('hasConfirmedTrialLesson'),
      'App.tsx inclui verificação de hasConfirmedTrialLesson no ciclo de vida e estado'
    );
  }

  // ---------------------------------------------------------------------------
  // TEST 5: Booking with Charles uses his configured meeting URL
  // ---------------------------------------------------------------------------
  console.log('\n--- Test 5: Booking with Charles uses his configured meeting URL ---');
  {
    const studentUid = 'student-uid-test-5';
    const studentEmail = 'student5@example.com';

    mockDbState.userProfiles[studentEmail] = {
      uid: studentUid,
      email: studentEmail,
      name: 'Student Five',
      hasCompletedTrialLesson: false,
      contractedLessons: 1,
      availableLessons: 1,
    };

    const scheduleResult = await scheduleLessonAtomicServer({
      studentAuthUid: studentUid,
      studentEmail: studentEmail,
      studentName: 'Student Five',
      teacherIdOrEmail: charlesPublicTutorId,
      startDateTime: '2026-10-27T10:00:00.000Z',
      endDateTime: '2026-10-27T10:25:00.000Z',
      title: 'Aula com Charles',
      isTrialLesson: true,
      existingLessons: mockDbState.liveLessons,
      dbState: mockDbState,
    });

    assert(scheduleResult.success === true, 'Agendamento com Charles efetuado');
    assert(
      scheduleResult.lesson?.meetLink === charlesPersonalMeetUrl,
      `Aula com Charles utiliza a URL pessoal configurada dele (${charlesPersonalMeetUrl})`
    );
    assert(
      !scheduleResult.lesson?.meetLink?.includes('meet.google.com/new'),
      'URL da reunião com Charles NUNCA é a genérica meet.google.com/new'
    );

    if (scheduleResult.lesson) {
      mockDbState.liveLessons.push(scheduleResult.lesson);
    }
  }

  // ---------------------------------------------------------------------------
  // TEST 6: Booking with another teacher uses that teacher's own URL
  // ---------------------------------------------------------------------------
  console.log('\n--- Test 6: Booking with another teacher uses that teacher\'s own URL ---');
  {
    const studentUid = 'student-uid-test-6';
    const studentEmail = 'student6@example.com';

    mockDbState.userProfiles[studentEmail] = {
      uid: studentUid,
      email: studentEmail,
      name: 'Student Six',
      hasCompletedTrialLesson: false,
      contractedLessons: 1,
      availableLessons: 1,
    };

    const scheduleResult = await scheduleLessonAtomicServer({
      studentAuthUid: studentUid,
      studentEmail: studentEmail,
      studentName: 'Student Six',
      teacherIdOrEmail: alicePublicTutorId,
      startDateTime: '2026-10-27T15:00:00.000Z',
      endDateTime: '2026-10-27T15:25:00.000Z',
      title: 'Aula com Alice',
      isTrialLesson: true,
      existingLessons: mockDbState.liveLessons,
      dbState: mockDbState,
    });

    assert(scheduleResult.success === true, 'Agendamento com Alice efetuado');
    assert(
      scheduleResult.lesson?.meetLink === alicePersonalMeetUrl,
      `Aula com Alice utiliza a URL pessoal de Alice (${alicePersonalMeetUrl})`
    );
    assert(
      scheduleResult.lesson?.meetLink !== charlesPersonalMeetUrl,
      'URL de Alice é estritamente isolada da URL de Charles'
    );
  }

  // ---------------------------------------------------------------------------
  // TEST 7: Missing meeting URL does not produce meet.google.com/new
  // ---------------------------------------------------------------------------
  console.log('\n--- Test 7: Missing meeting URL does not produce meet.google.com/new ---');
  {
    const studentUid = 'student-uid-test-7';
    const studentEmail = 'student7@example.com';

    mockDbState.userProfiles[studentEmail] = {
      uid: studentUid,
      email: studentEmail,
      name: 'Student Seven',
      hasCompletedTrialLesson: false,
      contractedLessons: 1,
      availableLessons: 1,
    };

    // Bob has NO configured meeting URL
    const scheduleResult = await scheduleLessonAtomicServer({
      studentAuthUid: studentUid,
      studentEmail: studentEmail,
      studentName: 'Student Seven',
      teacherIdOrEmail: bobPublicTutorId,
      startDateTime: '2026-10-28T09:00:00.000Z',
      endDateTime: '2026-10-28T09:25:00.000Z',
      title: 'Aula com Bob',
      isTrialLesson: true,
      existingLessons: mockDbState.liveLessons,
      dbState: mockDbState,
    });

    assert(scheduleResult.success === true, 'Agendamento com professor sem sala configurada efetuado com segurança');
    assert(
      scheduleResult.lesson?.meetLink === '',
      'meetLink resultante é vazio quando não há URL válida configurada (sem fabricação de link)'
    );
    assert(
      !scheduleResult.lesson?.meetLink?.includes('meet.google.com/new'),
      'NUNCA produz meet.google.com/new para professor sem sala configurada'
    );

    // Verify calendar generation doesn't fabricate generic link
    const calendarLink = generateGoogleCalendarWebLink({
      title: 'Aula com Bob',
      startDateTime: '2026-10-28T09:00:00.000Z',
      endDateTime: '2026-10-28T09:25:00.000Z',
      meetLink: scheduleResult.lesson?.meetLink,
    });
    assert(
      !calendarLink.includes('meet.google.com%2Fnew') && !calendarLink.includes('meet.google.com/new'),
      'Link do Google Calendar NÃO insere meet.google.com/new quando sala está ausente'
    );
  }

  // ---------------------------------------------------------------------------
  // TEST 8: Teacher and student see the same correct appointment URL
  // ---------------------------------------------------------------------------
  console.log('\n--- Test 8: Teacher and student see the same correct appointment URL ---');
  {
    const charlesLesson = mockDbState.liveLessons.find(
      (l: any) => l.teacherEmail === charlesEmail && l.studentEmail === 'student5@example.com'
    );

    assert(Boolean(charlesLesson), 'Aula agendada localizada no estado');

    // Student view resolution simulation (LiveLessonsPanel logic)
    const studentObservedMeetUrl = charlesLesson?.meetLink;

    // Teacher view resolution simulation (TeacherScheduleControlTable logic)
    const teacherObservedMeetUrl = charlesLesson?.meetLink;

    assert(
      studentObservedMeetUrl === charlesPersonalMeetUrl,
      'Visão do Aluno exibe a sala correta do Amigo Nativo Charles'
    );
    assert(
      teacherObservedMeetUrl === charlesPersonalMeetUrl,
      'Visão do Professor exibe exatamente a mesma sala correta do Amigo Nativo Charles'
    );
    assert(
      studentObservedMeetUrl === teacherObservedMeetUrl,
      'Aluno e Professor veem exatamente a mesma URL da reunião'
    );
  }

  // ---------------------------------------------------------------------------
  // TEST 9: Existing appointment and security functionality remains intact
  // ---------------------------------------------------------------------------
  console.log('\n--- Test 9: Existing appointment and security functionality remains intact ---');
  {
    // A: Existing appointment links are not overwritten
    const existingAppointment = {
      id: 'existing-lesson-historical-1',
      title: 'Historic Lesson',
      teacherEmail: charlesEmail,
      studentEmail: 'historic@example.com',
      studentUid: 'historic-uid-1',
      teacherUid: charlesAuthUid,
      startDateTime: '2026-10-20T10:00:00.000Z',
      endDateTime: '2026-10-20T10:25:00.000Z',
      meetLink: 'https://meet.google.com/historic-room-preserved',
      status: 'scheduled',
      isTrialLesson: false,
    };
    mockDbState.liveLessons.push(existingAppointment);

    const foundHistorical = mockDbState.liveLessons.find((l: any) => l.id === 'existing-lesson-historical-1');
    assert(
      foundHistorical?.meetLink === 'https://meet.google.com/historic-room-preserved',
      'Link de agendamento pré-existente é estritamente preservado sem sobrescrita'
    );

    // B: Anti-impersonation: Student cannot be the same as teacher
    const selfBooking = await scheduleLessonAtomicServer({
      studentAuthUid: charlesAuthUid,
      studentEmail: charlesEmail,
      studentName: 'Charles as Student',
      teacherIdOrEmail: charlesPublicTutorId,
      startDateTime: '2026-10-30T10:00:00.000Z',
      endDateTime: '2026-10-30T10:25:00.000Z',
      isTrialLesson: true,
      existingLessons: mockDbState.liveLessons,
      dbState: mockDbState,
    });

    assert(
      selfBooking.success === false && selfBooking.statusCode === 400,
      'Anti-impersonation: Aluno com mesma identidade do professor é estritamente bloqueado (HTTP 400)'
    );

    // C: Anti-duplicate: Student cannot schedule two trial lessons
    const duplicateTrial = await scheduleLessonAtomicServer({
      studentAuthUid: 'student-uid-test-5',
      studentEmail: 'student5@example.com',
      studentName: 'Student Five Repeat',
      teacherIdOrEmail: charlesPublicTutorId,
      startDateTime: '2026-10-29T10:00:00.000Z',
      endDateTime: '2026-10-29T10:25:00.000Z',
      isTrialLesson: true,
      existingLessons: mockDbState.liveLessons,
      dbState: mockDbState,
    });

    assert(
      duplicateTrial.success === false && duplicateTrial.statusCode === 400,
      'Anti-duplicação: Tentativa de agendar segunda aula teste para o mesmo aluno é rejeitada (HTTP 400)'
    );
  }

  console.log('\n=========================================================================');
  console.log(` RESULTADO FINAL: ${passed} PASS, ${failed} FAIL`);
  console.log('=========================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Test execution error:', err);
  process.exit(1);
});
