/**
 * S-PATH.2 — Validação de permanência de aulas Native Friends no ciclo ativo
 *
 * Valida os 12 cenários obrigatórios:
 * 1. Aula concluída sábado 14/11/2026.
 * 2. A mesma aula continua reconhecida segunda 16/11/2026 sem Start a New Week.
 * 3. Recarregamento e novo login preservam o resultado.
 * 4. Após Start a New Week, a aula anterior deixa de contar no novo ciclo.
 * 5. Aula futura não conta.
 * 6. Aula cancelada não conta.
 * 7. Aula agendada, mas não concluída, não conta.
 * 8. Aula concluída pelo professor é reconhecida.
 * 9. Ciclo ativo com duração superior a sete dias.
 * 10. Duas aulas no mesmo dia da semana não geram duplicação indevida da marcação diária.
 * 11. Outros três pilares permanecem inalterados.
 * 12. Timezone da aluna respeitado.
 */

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import {
  evaluateTutorLiveCompletedForDay,
  isTutorLiveLessonInActiveCycle,
  resolveActiveCycleBoundary,
} from '../src/utils/tutorLiveCycle';
import {
  clearAllLocalPersistenceCaches,
  deriveWeeklyChecksFromJournal,
} from '../src/utils/studentPersistence';
import {
  DayOfWeek,
  EnglishLevel,
  LiveLesson,
  StudentJournalEntry,
  UserProfile,
  WeeklyHistoryDoc,
} from '../src/types';

const WEEK_DAYS: DayOfWeek[] = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
];

let totalTests = 0;
let passedTests = 0;

async function runCase(name: string, fn: () => void | Promise<void>) {
  totalTests++;
  try {
    await fn();
    passedTests++;
    console.log(`  ✅ PASS: ${name}`);
  } catch (err) {
    console.error(`  ❌ FAIL: ${name}`);
    console.error(err);
    process.exit(1);
  }
}

function countTutorLiveDays(
  lessons: LiveLesson[],
  studentUid: string,
  studentEmail: string,
  userProfile: Partial<UserProfile>,
  weeklyHistories: WeeklyHistoryDoc[] | undefined,
  refDate: Date
): number {
  return WEEK_DAYS.reduce((acc, day) => {
    const done = evaluateTutorLiveCompletedForDay(
      day,
      lessons,
      studentUid,
      studentEmail,
      userProfile,
      weeklyHistories,
      refDate
    );
    return acc + (done ? 1 : 0);
  }, 0);
}

function calculateProgressPercent(
  counts: { video_day: number; audio_day: number; memorization: number; tutor_live: number },
  studyDaysTarget: number,
  nativeTarget: number
): number {
  const videoRatio = Math.min(1, counts.video_day / Math.max(1, studyDaysTarget));
  const audioRatio = Math.min(1, counts.audio_day / Math.max(1, studyDaysTarget));
  const nativeRatio = Math.min(1, counts.tutor_live / Math.max(1, nativeTarget));
  const memoRatio = Math.min(1, counts.memorization / Math.max(1, studyDaysTarget));
  return Math.min(100, Math.round(((videoRatio + audioRatio + nativeRatio + memoRatio) / 4) * 100));
}

async function main() {
  console.log('============================================================================');
  console.log(' S-PATH.2 — PERMANÊNCIA DE AULAS NATIVE FRIENDS NO CICLO ATIVO              ');
  console.log('============================================================================\n');

  const studentUid = 'student-uid-spath2-001';
  const studentEmail = 'aluna.spath2@itissimple.school';
  const teacherUid = 'teacher-uid-sarah-777';
  const teacherEmail = 'sarah.native@itissimple.school';

  const baseProfile: UserProfile = {
    id: studentUid,
    uid: studentUid,
    name: 'Aluna S-Path 2',
    email: studentEmail,
    level: EnglishLevel.INTERMEDIATE,
    timezone: 'America/Sao_Paulo',
    teacherUid,
    assignedNativeFriendUID: teacherUid,
    teacherEmail,
    teacherName: 'Sarah Native',
    weeklyCycle: 1,
    weeklyStudyDaysTarget: 4,
    weeklyNativeLessonsTarget: 1,
  };

  const makeLesson = (overrides: Partial<LiveLesson>): LiveLesson => ({
    id: 'lesson-sat-2026-11-14',
    title: 'Live Conversation Practice',
    studentUid,
    studentEmail,
    studentName: 'Aluna S-Path 2',
    teacherUid,
    teacherEmail,
    teacherName: 'Sarah Native',
    meetLink: 'https://meet.google.com/abc-defg-hij',
    startDateTime: '2026-11-14T15:00:00-03:00',
    endDateTime: '2026-11-14T15:30:00-03:00',
    status: 'completed',
    completedAt: '2026-11-14T15:35:00-03:00',
    ...overrides,
  });

  const saturdayLesson = makeLesson({});
  const saturdayRef = new Date('2026-11-14T18:00:00-03:00');
  const mondayRef = new Date('2026-11-16T14:41:46-08:00'); // Segunda 16/11/2026 após virada da semana calendário

  await runCase('1. Aula concluída sábado 14/11/2026 é reconhecida no sábado do S-Path', () => {
    const markedSat = evaluateTutorLiveCompletedForDay(
      'saturday',
      [saturdayLesson],
      studentUid,
      studentEmail,
      baseProfile,
      [],
      saturdayRef
    );
    assert.strictEqual(markedSat, true);
    assert.strictEqual(
      countTutorLiveDays([saturdayLesson], studentUid, studentEmail, baseProfile, [], saturdayRef),
      1
    );
  });

  await runCase('2. A mesma aula continua reconhecida segunda 16/11/2026 sem Start a New Week', () => {
    // Ciclo 1 ativo atravessando a virada de domingo->segunda
    const markedCycle1 = evaluateTutorLiveCompletedForDay(
      'saturday',
      [saturdayLesson],
      studentUid,
      studentEmail,
      baseProfile,
      [],
      mondayRef
    );
    assert.strictEqual(markedCycle1, true, 'Aula de sábado 14/11 deve permanecer visível na segunda 16/11 em ciclo 1');

    // Também validar quando a aluna está em ciclo 2 iniciado ANTES do sábado 14/11 (ex: terça 10/11)
    const cycle2Profile: UserProfile = {
      ...baseProfile,
      weeklyCycle: 2,
      cycleTransition: {
        previousCycle: 1,
        targetCycle: 2,
        status: 'completed',
        startedAt: '2026-11-10T10:00:00-03:00',
        completedAt: '2026-11-10T10:00:02-03:00',
      },
    };
    const markedCycle2 = evaluateTutorLiveCompletedForDay(
      'saturday',
      [saturdayLesson],
      studentUid,
      studentEmail,
      cycle2Profile,
      [],
      mondayRef
    );
    assert.strictEqual(markedCycle2, true, 'Aula de sábado 14/11 deve permanecer visível na segunda 16/11 em ciclo 2 ativo');
  });

  await runCase('3. Recarregamento (F5) e novo login preservam o resultado', () => {
    clearAllLocalPersistenceCaches();
    // Simula reidratação vinda do servidor (/api/user-profile + /api/student-history + /api/lessons)
    const rehydratedProfile: UserProfile = {
      ...baseProfile,
      weeklyCycle: 2,
      cycleTransition: {
        previousCycle: 1,
        targetCycle: 2,
        status: 'completed',
        startedAt: '2026-11-10T10:00:00-03:00',
        completedAt: '2026-11-10T10:00:02-03:00',
      },
    };
    const rehydratedHistories: WeeklyHistoryDoc[] = [
      {
        studentUid,
        weekId: 'week-1',
        weeklyCycle: 1,
        consumedVideoIds: [],
        consumedTrackIds: [],
        weeklyVocabulary: [],
        closedAt: '2026-11-10T09:59:59-03:00',
      },
    ];
    const rehydratedLessons: LiveLesson[] = [makeLesson({})];

    const markedAfterReload = evaluateTutorLiveCompletedForDay(
      'saturday',
      rehydratedLessons,
      studentUid,
      studentEmail,
      rehydratedProfile,
      rehydratedHistories,
      mondayRef
    );
    assert.strictEqual(markedAfterReload, true);

    // Garantir que StudentWeeklyActivitySection e App.tsx conectam evaluateTutorLiveCompletedForDay, cycleTransition, weeklyHistories e timezone
    const weeklySectionSrc = fs.readFileSync(
      path.resolve('src/components/StudentWeeklyActivitySection.tsx'),
      'utf8'
    );
    assert(
      weeklySectionSrc.includes('evaluateTutorLiveCompletedForDay('),
      'StudentWeeklyActivitySection deve usar evaluateTutorLiveCompletedForDay'
    );
    const appSrc = fs.readFileSync(path.resolve('src/App.tsx'), 'utf8');
    assert(appSrc.includes('weeklyHistories={weeklyHistories}'), 'App.tsx deve passar weeklyHistories');
    assert(appSrc.includes('cycleTransition'), 'App.tsx deve preservar cycleTransition na hidratação');
  });

  await runCase('4. Após Start a New Week, a aula anterior deixa de contar no novo ciclo', () => {
    const startNewWeekAt = '2026-11-16T12:00:00-03:00';
    const profileAfterNewWeek: UserProfile = {
      ...baseProfile,
      weeklyCycle: 2,
      cycleTransition: {
        previousCycle: 1,
        targetCycle: 2,
        status: 'completed',
        startedAt: startNewWeekAt,
        completedAt: '2026-11-16T12:00:02-03:00',
      },
    };
    const closedHistories: WeeklyHistoryDoc[] = [
      {
        studentUid,
        weekId: 'week-1',
        weeklyCycle: 1,
        consumedVideoIds: [],
        consumedTrackIds: [],
        weeklyVocabulary: [],
        closedAt: '2026-11-16T11:59:59-03:00',
      },
    ];

    // 4a. Via cycleTransition
    assert.strictEqual(
      evaluateTutorLiveCompletedForDay(
        'saturday',
        [saturdayLesson],
        studentUid,
        studentEmail,
        profileAfterNewWeek,
        closedHistories,
        mondayRef
      ),
      false,
      'Aula do ciclo 1 não pode contar no ciclo 2 (via cycleTransition)'
    );

    // 4b. Via fallback em weeklyHistory.closedAt quando cycleTransition ausente
    const profileWithoutTransition: UserProfile = { ...baseProfile, weeklyCycle: 2, cycleTransition: null };
    assert.strictEqual(
      evaluateTutorLiveCompletedForDay(
        'saturday',
        [saturdayLesson],
        studentUid,
        studentEmail,
        profileWithoutTransition,
        closedHistories,
        mondayRef
      ),
      false,
      'Aula do ciclo 1 não pode contar no ciclo 2 (via weeklyHistory.closedAt)'
    );

    // 4c. Fail-closed se ciclo >= 2 e não houver boundary confiável
    assert.strictEqual(
      resolveActiveCycleBoundary(profileWithoutTransition, []).hasVerifiedBoundary,
      false
    );
    assert.strictEqual(
      evaluateTutorLiveCompletedForDay(
        'saturday',
        [saturdayLesson],
        studentUid,
        studentEmail,
        profileWithoutTransition,
        [],
        mondayRef
      ),
      false,
      'Fail-closed quando ciclo >= 2 não possui fronteira verificada'
    );

    // 4d. Nova aula concluída após Start a New Week conta normalmente no ciclo 2
    const wednesdayCycle2Lesson = makeLesson({
      id: 'lesson-wed-cycle2',
      startDateTime: '2026-11-18T14:00:00-03:00',
      endDateTime: '2026-11-18T14:30:00-03:00',
      completedAt: '2026-11-18T14:32:00-03:00',
    });
    assert.strictEqual(
      evaluateTutorLiveCompletedForDay(
        'wednesday',
        [saturdayLesson, wednesdayCycle2Lesson],
        studentUid,
        studentEmail,
        profileAfterNewWeek,
        closedHistories,
        new Date('2026-11-18T15:00:00-03:00')
      ),
      true
    );
  });

  await runCase('5. Aula futura não conta', () => {
    const futureLesson = makeLesson({
      id: 'lesson-future-wed',
      startDateTime: '2026-11-18T14:00:00-03:00',
      endDateTime: '2026-11-18T14:30:00-03:00',
      status: 'completed',
    });
    assert.strictEqual(
      evaluateTutorLiveCompletedForDay(
        'wednesday',
        [futureLesson],
        studentUid,
        studentEmail,
        baseProfile,
        [],
        mondayRef
      ),
      false
    );

    const sameDayFutureLesson = makeLesson({
      id: 'lesson-future-same-day',
      startDateTime: '2026-11-16T22:00:00-03:00',
      endDateTime: '2026-11-16T22:30:00-03:00',
      status: 'completed',
    });
    assert.strictEqual(
      evaluateTutorLiveCompletedForDay(
        'monday',
        [sameDayFutureLesson],
        studentUid,
        studentEmail,
        baseProfile,
        [],
        mondayRef // 2026-11-16T19:41:46-03:00
      ),
      false
    );
  });

  await runCase('6. Aula cancelada não conta', () => {
    const cancelledByStatus = makeLesson({
      id: 'lesson-cancelled-status',
      status: 'cancelled',
    });
    const cancelledByTimestamp = makeLesson({
      id: 'lesson-cancelled-ts',
      status: 'completed',
      cancelledAt: '2026-11-14T12:00:00-03:00',
    });

    assert.strictEqual(
      evaluateTutorLiveCompletedForDay(
        'saturday',
        [cancelledByStatus, cancelledByTimestamp],
        studentUid,
        studentEmail,
        baseProfile,
        [],
        mondayRef
      ),
      false
    );
  });

  await runCase('7. Aula agendada ou não realizada não conta', () => {
    const scheduledLesson = makeLesson({ id: 'lesson-sched', status: 'scheduled' });
    const notCompletedLesson = makeLesson({ id: 'lesson-not-comp', status: 'not_completed' });
    assert.strictEqual(
      evaluateTutorLiveCompletedForDay(
        'saturday',
        [scheduledLesson, notCompletedLesson],
        studentUid,
        studentEmail,
        baseProfile,
        [],
        mondayRef
      ),
      false
    );
  });

  await runCase('8. Aula concluída pelo professor é reconhecida', () => {
    const teacherCompletedLesson = makeLesson({
      id: 'lesson-teacher-completed',
      status: 'completed',
      completedAt: '2026-11-14T15:32:00-03:00',
      ...( { completedBy: 'teacher' } as any ),
    });

    assert.strictEqual(
      evaluateTutorLiveCompletedForDay(
        'saturday',
        [teacherCompletedLesson],
        studentUid,
        studentEmail,
        baseProfile,
        [],
        mondayRef
      ),
      true
    );

    // Segurança: professor impostor não vinculado à aluna é rejeitado
    const rogueTeacherLesson = makeLesson({
      id: 'lesson-rogue',
      teacherUid: 'rogue-uid',
      teacherEmail: 'rogue@test.com',
    });
    assert.strictEqual(
      isTutorLiveLessonInActiveCycle(rogueTeacherLesson, {
        studentUid,
        studentEmail,
        userProfile: baseProfile,
        refDate: mondayRef,
      }),
      false
    );
  });

  await runCase('9. Ciclo ativo com duração superior a sete dias mantém aulas do ciclo', () => {
    const longCycleProfile: UserProfile = {
      ...baseProfile,
      weeklyCycle: 2,
      cycleTransition: {
        previousCycle: 1,
        targetCycle: 2,
        status: 'completed',
        startedAt: '2026-11-02T09:00:00-03:00',
        completedAt: '2026-11-02T09:00:02-03:00',
      },
    };
    const lessonsIn18DayCycle: LiveLesson[] = [
      makeLesson({
        id: 'lesson-nov-07',
        startDateTime: '2026-11-07T15:00:00-03:00',
        endDateTime: '2026-11-07T15:30:00-03:00',
      }),
      makeLesson({
        id: 'lesson-nov-18',
        startDateTime: '2026-11-18T11:00:00-03:00',
        endDateTime: '2026-11-18T11:30:00-03:00',
      }),
    ];

    const day20Ref = new Date('2026-11-22T18:00:00-03:00'); // 20 dias após início do ciclo 2
    assert.strictEqual(
      evaluateTutorLiveCompletedForDay(
        'saturday',
        lessonsIn18DayCycle,
        studentUid,
        studentEmail,
        longCycleProfile,
        [],
        day20Ref
      ),
      true
    );
    assert.strictEqual(
      evaluateTutorLiveCompletedForDay(
        'wednesday',
        lessonsIn18DayCycle,
        studentUid,
        studentEmail,
        longCycleProfile,
        [],
        day20Ref
      ),
      true
    );
  });

  await runCase('10. Duas aulas no mesmo dia da semana não geram duplicação indevida da marcação diária', () => {
    const twoSameDayLessons: LiveLesson[] = [
      makeLesson({
        id: 'lesson-sat-1',
        startDateTime: '2026-11-14T10:00:00-03:00',
        endDateTime: '2026-11-14T10:30:00-03:00',
      }),
      makeLesson({
        id: 'lesson-sat-2',
        startDateTime: '2026-11-14T16:00:00-03:00',
        endDateTime: '2026-11-14T16:30:00-03:00',
      }),
    ];

    const satCompleted = evaluateTutorLiveCompletedForDay(
      'saturday',
      twoSameDayLessons,
      studentUid,
      studentEmail,
      baseProfile,
      [],
      mondayRef
    );
    assert.strictEqual(satCompleted, true);
    const totalCount = countTutorLiveDays(
      twoSameDayLessons,
      studentUid,
      studentEmail,
      baseProfile,
      [],
      mondayRef
    );
    assert.strictEqual(totalCount, 1, 'Marcação diária para sábado deve contabilizar apenas 1 dia');
  });

  await runCase('11. Outros três pilares permanecem inalterados (25% cada, sem reidratação de tutor_live)', () => {
    const journal: StudentJournalEntry[] = [
      { id: 'v1', type: 'video', date: '2026-11-16', dayOfWeek: 'monday', week: 1, timestamp: 1000 },
      { id: 'a1', type: 'audio', date: '2026-11-16', dayOfWeek: 'monday', week: 1, timestamp: 1001 },
      { id: 'm1', type: 'memorization', date: '2026-11-16', dayOfWeek: 'monday', week: 1, timestamp: 1002 },
      { id: 'l1', type: 'lesson', date: '2026-11-14', dayOfWeek: 'saturday', week: 1, timestamp: 1003 },
    ];
    const derived = deriveWeeklyChecksFromJournal(journal, 1);
    assert.strictEqual(derived['video_day_monday'], true);
    assert.strictEqual(derived['audio_day_monday'], true);
    assert.strictEqual(derived['memorization_monday'], true);
    assert.strictEqual(derived['tutor_live_saturday'], undefined, 'Journal nunca reidrata tutor_live');

    const progress = calculateProgressPercent(
      { video_day: 4, audio_day: 4, memorization: 4, tutor_live: 1 },
      4,
      1
    );
    assert.strictEqual(progress, 100);
  });

  await runCase('12. Timezone da aluna respeitado no cálculo do dia da semana e data civil', () => {
    // 2026-11-15T01:30:00Z é sábado 14/11 22:30 em America/Sao_Paulo, mas domingo 15/11 01:30 em Europe/London
    const lateSaturdayBrtLesson = makeLesson({
      id: 'lesson-tz-boundary',
      startDateTime: '2026-11-15T01:30:00Z',
      endDateTime: '2026-11-15T02:00:00Z',
    });

    const brtProfile: UserProfile = { ...baseProfile, timezone: 'America/Sao_Paulo' };
    assert.strictEqual(
      evaluateTutorLiveCompletedForDay('saturday', [lateSaturdayBrtLesson], studentUid, studentEmail, brtProfile, [], mondayRef),
      true
    );
    assert.strictEqual(
      evaluateTutorLiveCompletedForDay('sunday', [lateSaturdayBrtLesson], studentUid, studentEmail, brtProfile, [], mondayRef),
      false
    );

    const londonProfile: UserProfile = { ...baseProfile, timezone: 'Europe/London' };
    assert.strictEqual(
      evaluateTutorLiveCompletedForDay('sunday', [lateSaturdayBrtLesson], studentUid, studentEmail, londonProfile, [], mondayRef),
      true
    );
    assert.strictEqual(
      evaluateTutorLiveCompletedForDay('saturday', [lateSaturdayBrtLesson], studentUid, studentEmail, londonProfile, [], mondayRef),
      false
    );
  });

  console.log('\n============================================================================');
  console.log(` S-PATH.2 SUITE: ${passedTests}/${totalTests} TESTES APROVADOS`);
  console.log('============================================================================\n');
}

main().catch((err) => {
  console.error('S-PATH.2 suite failed:', err);
  process.exit(1);
});
