/**
 * Test Suite: Cenário Real de Renderização com Conta Administrativa (/teacher)
 * Reproduz o ambiente de renderização React real com conta admin (estilobeeadm@gmail.com)
 * e conjuntos de dados com valores indefinidos, nulos ou malformados do Firestore.
 */

import React from 'react';
import { renderToString } from 'react-dom/server';
import { TeacherScheduleControlTable } from '../src/components/TeacherScheduleControlTable';
import { LiveMeetLessonsPanel } from '../src/components/LiveMeetLessonsPanel';
import { EmailNotificationModal } from '../src/components/EmailNotificationModal';
import { DailySentenceModal } from '../src/components/DailySentenceModal';
import { LiveLessonScheduleModal } from '../src/components/LiveLessonScheduleModal';
import { NotificationBanner } from '../src/components/NotificationBanner';
import { getTranslations } from '../src/utils/i18n';
import { GoogleAccount, LiveLesson } from '../src/types';

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

async function runRealRenderTests() {
  console.log('\n================================================================');
  console.log('🧪 TEST SUITE: RENDERIZAÇÃO REAL DO AMBIENTE /teacher (ADMIN)');
  console.log('================================================================\n');

  // Real administrative account payload
  const adminAccount: GoogleAccount = {
    id: 'admin-adm-itissimple',
    uid: 'firebase-admin-uid-12345',
    email: 'estilobeeadm@gmail.com',
    name: 'Estilo Bee Administrador',
    role: 'admin',
    picture: 'https://lh3.googleusercontent.com/a/admin-avatar',
  };

  // Malformed / undefined dataset matching staging Firestore edge cases
  const malformedLessons: any[] = [
    {
      id: 'lesson-ok-1',
      title: 'Practice Session',
      startDateTime: '2026-10-15T14:00:00Z',
      endDateTime: '2026-10-15T14:30:00Z',
      status: 'scheduled',
      teacherEmail: 'estilobeeforkids@gmail.com',
      studentEmail: 'student.one@example.com',
      studentName: 'Student One',
    },
    {
      id: 'lesson-without-title-and-student-email',
      title: undefined, // Missing title
      startDateTime: '2026-10-15T15:00:00Z',
      status: 'scheduled',
      teacherEmail: undefined, // Missing teacherEmail
      studentEmail: undefined, // Missing studentEmail
    },
    {
      id: 'lesson-trial-null-title',
      title: null,
      status: 'trial_lesson',
      startDateTime: '2026-10-15T16:00:00Z',
      teacherEmail: 'estilobeeforkids@gmail.com',
      studentEmail: 'trial.student@example.com',
    },
    null, // Completely null item in lessons array
    undefined, // Completely undefined item in lessons array
    {
      id: 'lesson-cancelled-no-emails',
      status: 'cancelled',
      startDateTime: undefined,
    },
  ];

  const malformedTeachers: any[] = [
    {
      id: 'tutor-estilobee',
      name: 'Teacher Re',
      email: 'estilobeeforkids@gmail.com',
      role: 'teacher',
      approvalStatus: 'approved',
    },
    {
      id: 'tutor-no-email-record',
      name: 'Draft Native Friend',
      email: undefined, // Missing email field
      role: 'teacher',
      approvalStatus: 'approved',
    },
    null, // Null item
    {
      id: 'tutor-null-email',
      name: 'Null Email Tutor',
      email: null,
      role: 'teacher',
    },
  ];

  const malformedStudents: any[] = [
    {
      id: 'st-1',
      name: 'Student One',
      email: 'student.one@example.com',
      role: 'student',
    },
    {
      id: 'st-no-email',
      name: 'Student Without Email',
      email: undefined,
      studentEmail: undefined,
      role: 'student',
    },
    null,
    undefined,
  ];

  // -------------------------------------------------------------------------
  // Test 1: TeacherScheduleControlTable rendered with Admin and Undefined Data
  // -------------------------------------------------------------------------
  console.log('--- Test 1: TeacherScheduleControlTable real render with Admin account ---');
  try {
    const html = renderToString(
      React.createElement(TeacherScheduleControlTable, {
        lessons: malformedLessons,
        teachers: malformedTeachers,
        students: malformedStudents,
        teacherMeetSettings: {},
        currentAccount: adminAccount,
        tutorProfile: undefined,
        selectedStudentFilter: 'all',
        selectedTeacherFilter: 'all',
        onSelectStudentFilter: () => {},
        currentLanguage: 'en',
        t: getTranslations('en'),
        timeZone: 'America/Toronto',
      } as any)
    );

    assert(typeof html === 'string' && html.length > 0, 'TeacherScheduleControlTable renders to HTML successfully');
    assert(html.includes('Master Schedule Control'), 'Contains Master Schedule Control header');
    assert(html.includes('All Native Friends'), 'Contains Admin teacher filter dropdown');
    assert(html.includes('student.one@example.com'), 'Safely displays scheduled lesson for valid student');
  } catch (err: any) {
    assert(false, 'TeacherScheduleControlTable threw uncaught exception during render', err.stack);
  }

  // -------------------------------------------------------------------------
  // Test 2: TeacherScheduleControlTable with undefined/null selectedStudentFilter
  // -------------------------------------------------------------------------
  console.log('--- Test 2: TeacherScheduleControlTable with undefined/null filter values ---');
  try {
    const htmlUndefinedFilters = renderToString(
      React.createElement(TeacherScheduleControlTable, {
        lessons: malformedLessons,
        teachers: malformedTeachers,
        students: malformedStudents,
        teacherMeetSettings: {},
        currentAccount: adminAccount,
        selectedStudentFilter: undefined,
        selectedTeacherFilter: undefined,
        onSelectStudentFilter: () => {},
        currentLanguage: 'en',
        t: getTranslations('en'),
        timeZone: 'America/Toronto',
      } as any)
    );

    assert(Boolean(htmlUndefinedFilters), 'Renders successfully with undefined selected filters');
  } catch (err: any) {
    assert(false, 'TeacherScheduleControlTable failed with undefined filters', err.stack);
  }

  // -------------------------------------------------------------------------
  // Test 3: LiveMeetLessonsPanel rendered with Admin and Malformed Lessons
  // -------------------------------------------------------------------------
  console.log('--- Test 3: LiveMeetLessonsPanel real render with Admin account ---');
  try {
    const html = renderToString(
      React.createElement(LiveMeetLessonsPanel, {
        lessons: malformedLessons,
        currentAccount: adminAccount,
        userProfile: null,
        isTeacher: true,
        selectedStudentFilter: 'all',
        currentLanguage: 'en',
        t: getTranslations('en'),
        timeZone: 'America/Toronto',
      } as any)
    );

    assert(Boolean(html), 'LiveMeetLessonsPanel renders without crash');
    assert(html.includes('live-meet-lessons-panel'), 'Panel root container rendered');
  } catch (err: any) {
    assert(false, 'LiveMeetLessonsPanel threw exception during render', err.stack);
  }

  // -------------------------------------------------------------------------
  // Test 4: EmailNotificationModal rendered with Teachers lacking emails
  // -------------------------------------------------------------------------
  console.log('--- Test 4: EmailNotificationModal with undefined teacher emails ---');
  try {
    // Test both closed and open states
    const htmlClosed = renderToString(
      React.createElement(EmailNotificationModal, {
        isOpen: false,
        onClose: () => {},
        currentAccount: adminAccount,
        userProfile: { teacherEmail: undefined, teacherName: undefined } as any,
        teachers: malformedTeachers,
        currentLanguage: 'en',
      } as any)
    );
    assert(htmlClosed === '', 'Closed modal returns empty markup');

    const htmlOpen = renderToString(
      React.createElement(EmailNotificationModal, {
        isOpen: true,
        onClose: () => {},
        currentAccount: adminAccount,
        userProfile: { teacherEmail: undefined, teacherName: undefined } as any,
        teachers: malformedTeachers,
        currentLanguage: 'en',
      } as any)
    );
    assert(htmlOpen.includes('Recipient'), 'Open modal renders safely without email crashes');
  } catch (err: any) {
    assert(false, 'EmailNotificationModal threw exception during render', err.stack);
  }

  // -------------------------------------------------------------------------
  // Test 5: DailySentenceModal rendered with undefined inputs and routines
  // -------------------------------------------------------------------------
  console.log('--- Test 5: DailySentenceModal with undefined words and routines ---');
  try {
    const htmlClosed = renderToString(
      React.createElement(DailySentenceModal, {
        isOpen: false,
        onClose: () => {},
        todayRoutines: [
          { activityName: 'Video', learnedWords: ['apple', undefined, null] },
          null,
        ] as any,
        userProfile: null,
        currentLanguage: 'en',
        onSaveDailySentence: () => {},
      } as any)
    );
    assert(htmlClosed === '', 'DailySentenceModal (closed) executes safely without throwing on words filter');

    const htmlOpen = renderToString(
      React.createElement(DailySentenceModal, {
        isOpen: true,
        onClose: () => {},
        todayRoutines: [
          { activityName: 'Video', learnedWords: ['practice', undefined] },
        ] as any,
        userProfile: null,
        currentLanguage: 'en',
        onSaveDailySentence: () => {},
      } as any)
    );
    assert(htmlOpen.includes('End of Day Sentence Review'), 'DailySentenceModal (open) renders safely');
  } catch (err: any) {
    assert(false, 'DailySentenceModal threw exception during render', err.stack);
  }

  // -------------------------------------------------------------------------
  // Test 6: LiveLessonScheduleModal rendered with Admin and Malformed Teachers
  // -------------------------------------------------------------------------
  console.log('--- Test 6: LiveLessonScheduleModal with Admin and malformed teachers ---');
  try {
    const html = renderToString(
      React.createElement(LiveLessonScheduleModal, {
        isOpen: false,
        onClose: () => {},
        teachers: malformedTeachers,
        students: malformedStudents,
        currentAccount: adminAccount,
        currentLanguage: 'en',
      } as any)
    );
    assert(html === '', 'LiveLessonScheduleModal hook body executes safely without throwing');
  } catch (err: any) {
    assert(false, 'LiveLessonScheduleModal threw exception during render', err.stack);
  }

  // -------------------------------------------------------------------------
  // Test 7: NotificationBanner with null / malformed notifications
  // -------------------------------------------------------------------------
  console.log('--- Test 7: NotificationBanner with null / malformed notifications ---');
  try {
    const html = renderToString(
      React.createElement(NotificationBanner, {
        notifications: [
          null,
          undefined,
          { id: 'custom-1', title: 'Schedule Update', message: 'Lesson rescheduled' },
          { id: undefined, title: undefined } as any,
        ] as any,
        onDismiss: () => {},
      })
    );
    assert(html.includes('Schedule Update'), 'NotificationBanner safely filters without throwing on undefined id/title');
  } catch (err: any) {
    assert(false, 'NotificationBanner threw exception during render', err.stack);
  }

  // -------------------------------------------------------------------------
  // Test 8: Full Teacher Workspace Composite Simulation
  // -------------------------------------------------------------------------
  console.log('--- Test 8: Full /teacher Composite Simulation (Admin + all components) ---');
  try {
    const CompositeTeacherView = () => {
      return React.createElement(
        'div',
        { className: 'teacher-workspace' },
        React.createElement(TeacherScheduleControlTable, {
          lessons: malformedLessons,
          teachers: malformedTeachers,
          students: malformedStudents,
          teacherMeetSettings: {},
          currentAccount: adminAccount,
          selectedStudentFilter: 'all',
          onSelectStudentFilter: () => {},
          currentLanguage: 'en',
          t: getTranslations('en'),
          timeZone: 'America/Toronto',
        } as any),
        React.createElement(LiveMeetLessonsPanel, {
          lessons: malformedLessons,
          currentAccount: adminAccount,
          userProfile: null,
          isTeacher: true,
          selectedStudentFilter: 'all',
          currentLanguage: 'en',
          t: getTranslations('en'),
          timeZone: 'America/Toronto',
        } as any),
        React.createElement(EmailNotificationModal, {
          isOpen: false,
          onClose: () => {},
          currentAccount: adminAccount,
          userProfile: null,
          teachers: malformedTeachers,
          currentLanguage: 'en',
        } as any),
        React.createElement(DailySentenceModal, {
          isOpen: false,
          onClose: () => {},
          todayRoutines: [],
          userProfile: null,
          currentLanguage: 'en',
          onSaveDailySentence: () => {},
        } as any)
      );
    };

    const compositeHtml = renderToString(React.createElement(CompositeTeacherView));
    assert(compositeHtml.length > 0, 'Complete composite teacher workspace renders 100% without error');
    assert(!compositeHtml.includes('undefined'), 'Render output does not contain raw undefined artifacts');
  } catch (err: any) {
    assert(false, 'Composite workspace simulation failed', err.stack);
  }

  console.log(`\n================================================================`);
  console.log(`📊 RESULTADOS FINAIS: ${passed} PASSOU | ${failed} FALHOU`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runRealRenderTests();
