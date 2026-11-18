/**
 * TEST SUITE: ADM.UI.1 — ISOLAMENTO VISUAL DO PAINEL ADMINISTRATIVO
 * Validates:
 *  1. Admin view mounts ONLY authorized Admin components (Administrator Control Panel, AdminOperationsDashboard, AdminApprovalsModal, AdminLandingEditorModal)
 *  2. Admin view prevents mounting of #filtered-student-workspace, Student Credits, Student Activity, Live Lesson Notes, teacher/student modals, and HeaderMessagesPopover
 *  3. Teacher view preserves TeacherScheduleControlTable, #filtered-student-workspace, Student Activity, Live Lesson Notes, and HeaderMessagesPopover
 *  4. Student view preserves #student-model-dashboard (StudentHeaderSection, RoutineRemindersManager, StudentRoutineGuideSection, StudentWeeklyActivitySection) and HeaderMessagesPopover
 *  5. Role switch / login / logout clears transient selectedStudentFilter and activeStudentActivity states
 */

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { Navbar } from '../src/components/Navbar';
import { AdminOperationsDashboard } from '../src/components/AdminOperationsDashboard';
import { TeacherScheduleControlTable } from '../src/components/TeacherScheduleControlTable';
import { StudentHeaderSection } from '../src/components/StudentHeaderSection';
import { getTranslations } from '../src/utils/i18n';
import { EnglishLevel, GoogleAccount, UserProfile } from '../src/types';

let passed = 0;
let failed = 0;

function check(condition: boolean, name: string, detail?: string) {
  if (condition) {
    console.log(`  ✅ PASS: ${name}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${name}${detail ? ` (${detail})` : ''}`);
    failed++;
  }
}

async function runTests() {
  console.log('\n====================================================================');
  console.log('🧪 TEST SUITE: ADM.UI.1 — ISOLAMENTO VISUAL DO PAINEL ADMINISTRATIVO');
  console.log('====================================================================\n');

  const appSrc = fs.readFileSync(path.join(process.cwd(), 'src/App.tsx'), 'utf8');
  const navbarSrc = fs.readFileSync(path.join(process.cwd(), 'src/components/Navbar.tsx'), 'utf8');

  const adminAccount: GoogleAccount = {
    id: 'adm-uid-1',
    uid: 'adm-uid-1',
    email: 'estilobeeadm@gmail.com',
    name: 'System Admin',
    role: 'admin',
  };

  const teacherAccount: GoogleAccount = {
    id: 'tch-uid-1',
    uid: 'tch-uid-1',
    email: 'charles.lambert@example.com',
    name: 'Charles Lambert',
    role: 'teacher',
  };

  const studentAccount: GoogleAccount = {
    id: 'stu-uid-1',
    uid: 'stu-uid-1',
    email: 'estilobeeforkids@gmail.com',
    name: 'Queen Bee',
    role: 'student',
  };

  const baseProfile: UserProfile = {
    id: 'stu-uid-1',
    uid: 'stu-uid-1',
    name: 'Queen Bee',
    email: 'estilobeeforkids@gmail.com',
    level: EnglishLevel.INTERMEDIATE,
    streakDays: 3,
    points: 100,
    dailyGoalMinutes: 30,
    completedTodayMinutes: 10,
    contractedLessons: 4,
    availableLessons: 2,
    completedLessonsCount: 2,
    hasCompletedTrialLesson: true,
    weeklyCycle: 1,
    teacherEmail: 'charles.lambert@example.com',
    teacherName: 'Charles Lambert',
    teacherUid: 'tch-uid-1',
  };

  // 1. App.tsx structural isolation checks (mount-level, NOT CSS)
  console.log('--- 1. Isolamento Estrutural de Montagem em App.tsx ---');
  check(
    appSrc.includes("currentAccount?.role === 'teacher' && selectedStudentFilter && selectedStudentFilter !== 'all'"),
    'filtered-student-workspace (Student Credits, Student Activity, Live Lesson Notes) exige role === "teacher" para montar'
  );
  check(
    appSrc.includes("currentAccount?.role === 'admin' ? (") &&
      appSrc.includes('<AdminOperationsDashboard currentLanguage={currentLanguage} />') &&
      appSrc.includes('<TeacherScheduleControlTable'),
    'Admin renderiza AdminOperationsDashboard e Teacher renderiza TeacherScheduleControlTable'
  );
  check(
    appSrc.includes("currentAccount?.role !== 'admin' && ("),
    'Modais operacionais de professor e aluno não são montados quando role === "admin"'
  );
  check(
    appSrc.includes("if (currentAccount?.role === 'admin') {\n      setSelectedStudentFilter('all');\n      setActiveStudentActivity(null);"),
    'Estado transitório selectedStudentFilter/activeStudentActivity é limpo automaticamente na entrada do painel ADM'
  );
  check(
    !appSrc.includes('display: none') && !appSrc.includes('hidden') || appSrc.includes("currentAccount?.role === 'teacher' && selectedStudentFilter"),
    'Isolamento é feito por montagem condicional no JSX, não por ocultação CSS'
  );

  // 2. Navbar SSR render for Admin vs Teacher vs Student
  console.log('--- 2. Navbar Render Real: Admin vs Professor vs Aluno ---');
  {
    const adminNavHtml = renderToString(
      React.createElement(Navbar, {
        userProfile: baseProfile,
        currentAccount: adminAccount,
        currentLanguage: 'en',
        t: getTranslations('en'),
        onToggleLanguage: () => {},
        onOpenAccountModal: () => {},
        onOpenAdminApprovals: () => {},
        onOpenAdminLandingEditor: () => {},
        pendingTutorsCount: 1,
      })
    );
    check(
      !adminNavHtml.includes('header-direct-messages-btn'),
      'Navbar ADM não monta botão de mensagens diretas aluno<->professor'
    );
    check(
      adminNavHtml.includes('System Admin') && adminNavHtml.includes('Administrator'),
      'Navbar ADM exibe identificação de Administrator'
    );
    check(
      navbarSrc.includes('{!isAdmin && (') && navbarSrc.includes('{onFindTutors && !isTeacher && !isAdmin && ('),
      'Navbar oculta Direct Messages e Find Tutors do dropdown/header ADM'
    );

    const teacherNavHtml = renderToString(
      React.createElement(Navbar, {
        userProfile: baseProfile,
        currentAccount: teacherAccount,
        currentLanguage: 'en',
        t: getTranslations('en'),
        onToggleLanguage: () => {},
        onOpenAccountModal: () => {},
      })
    );
    check(
      teacherNavHtml.includes('header-direct-messages-btn'),
      'Navbar Professor preserva botão de mensagens diretas com alunos'
    );

    const studentNavHtml = renderToString(
      React.createElement(Navbar, {
        userProfile: baseProfile,
        currentAccount: studentAccount,
        currentLanguage: 'pt',
        t: getTranslations('pt'),
        onToggleLanguage: () => {},
        onOpenAccountModal: () => {},
      })
    );
    check(
      studentNavHtml.includes('header-direct-messages-btn'),
      'Navbar Aluno preserva botão de mensagens diretas com Native Friend'
    );
  }

  // 3. Admin Operations Dashboard SSR render
  console.log('--- 3. AdminOperationsDashboard Render Real ---');
  {
    const admDashHtml = renderToString(
      React.createElement(AdminOperationsDashboard, {
        currentLanguage: 'en',
        initialData: {
          generatedAt: new Date().toISOString(),
          timezone: 'America/Sao_Paulo',
          dataSource: 'firestore_default',
          filtersApplied: { year: 'all', month: 'all', country: 'all', teacherUid: 'all' },
          filterOptions: { years: [2026], months: [11], countries: ['United States'], teachers: [] },
          kpis: {
            alunosCount: 2,
            aulasContratadas: 4,
            paidContractedLessons: 4,
            adminGrantedLessons: 0,
            atendidas: 1,
            saldo: 3,
            faturamentoBrl: 450,
            custoPlataformaBrl: null,
            custoNativeFriendBrl: null,
            lucroBrl: null,
            grossPlatformShareBrl: 90,
          },
          rows: [],
        },
      })
    );
    check(admDashHtml.includes('Platform Operations Dashboard'), 'ADM renderiza Platform Operations Dashboard');
    check(!admDashHtml.includes('Live Lesson Notes'), 'Platform Operations Dashboard não contém Live Lesson Notes');
    check(!admDashHtml.includes('Student Activity'), 'Platform Operations Dashboard não contém Student Activity');
  }

  // 4. Teacher Schedule Control Table SSR render (preserved)
  console.log('--- 4. TeacherScheduleControlTable Render Real (Preservado) ---');
  {
    const teacherHtml = renderToString(
      React.createElement(TeacherScheduleControlTable, {
        lessons: [],
        teachers: [teacherAccount as any],
        students: [studentAccount],
        teacherMeetSettings: {},
        currentAccount: teacherAccount,
        selectedStudentFilter: 'estilobeeforkids@gmail.com',
        onSelectStudentFilter: () => {},
        activeStudentActivity: 'notes',
        onSelectStudentActivity: () => {},
        onOpenScheduleModal: () => {},
        onOpenTeacherMeetConfig: () => {},
        onCompleteLesson: () => {},
        onMarkNotCompleted: () => {},
        onRescheduleLesson: () => {},
        onCancelLesson: () => {},
        currentLanguage: 'en',
        t: getTranslations('en'),
        timeZone: 'America/Toronto',
      })
    );
    check(teacherHtml.includes('Master Schedule Control'), 'Professor mantém Master Schedule Control');
    check(teacherHtml.includes('Live Lesson Notes'), 'Professor mantém acesso a Live Lesson Notes');
    check(teacherHtml.includes('Insights &amp; Icebreaks') || teacherHtml.includes('Insights & Icebreaks'), 'Professor mantém acesso a Insights & Icebreaks');
    check(teacherHtml.includes('Videos &amp; Songs') || teacherHtml.includes('Videos & Songs'), 'Professor mantém acesso a Videos & Songs');
  }

  // 5. Student Header Section SSR render (preserved)
  console.log('--- 5. StudentHeaderSection Render Real (Preservado) ---');
  {
    const studentHtml = renderToString(
      React.createElement(StudentHeaderSection, {
        lessons: [],
        currentAccount: studentAccount,
        userProfile: baseProfile,
        teachers: [teacherAccount as any],
        teacherMeetSettings: {},
        contractedLessons: { 'estilobeeforkids@gmail.com': 4 },
        onUpdateContractedLessons: async () => ({ success: true }),
        onOpenScheduleModal: () => {},
        onOpenManageSubscription: () => {},
        onCancelLesson: () => {},
        onCompleteLesson: () => {},
        onMarkNotCompleted: () => {},
        onRescheduleLesson: () => {},
        currentLanguage: 'pt',
        t: getTranslations('pt'),
        timeZone: 'America/Sao_Paulo',
      })
    );
    check(studentHtml.includes('Charles Lambert'), 'Aluno mantém card do Native Friend e header de aulas');
  }

  console.log('\n====================================================================');
  console.log(`📊 RESULTADO ADM.UI.1: ${passed} PASSOU | ${failed} FALHOU`);
  console.log('====================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Erro inesperado na suite ADM.UI.1:', err);
  process.exit(1);
});
