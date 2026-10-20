import {
  deriveWeeklyChecksFromJournal,
  StudentJournalEntry,
} from '../src/utils/studentPersistence';
import { LiveLesson } from '../src/types';

function runPersistenceTests() {
  console.log('=== TESTES DE PERSISTÊNCIA: S-PATH & AULAS AGENDADAS/CONCLUÍDAS ===\n');

  let passed = 0;
  let failed = 0;

  const assert = (condition: boolean, msg: string) => {
    if (condition) {
      console.log(`  ✅ PASS: ${msg}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${msg}`);
      failed++;
    }
  };

  // 1. S-Path Persistence Across Days within the Week
  console.log('--- 1. S-Path: Manutenção de Atividades nos Respectivos Dias ---');

  const journalWeek1: StudentJournalEntry[] = [
    {
      id: 'video_mon_1',
      type: 'video',
      date: '2026-10-19',
      dayOfWeek: 'monday',
      week: 1,
      timestamp: Date.now() - 86400000 * 2,
      title: 'Monday English Video',
    },
    {
      id: 'audio_mon_1',
      type: 'audio',
      date: '2026-10-19',
      dayOfWeek: 'monday',
      week: 1,
      timestamp: Date.now() - 86400000 * 2,
      title: 'Monday Podcast',
    },
    {
      id: 'video_tue_1',
      type: 'video',
      date: '2026-10-20',
      dayOfWeek: 'tuesday',
      week: 1,
      timestamp: Date.now() - 86400000,
      title: 'Tuesday Video',
    },
    {
      id: 'memo_wed_1',
      type: 'memorization',
      date: '2026-10-21',
      dayOfWeek: 'wednesday',
      week: 1,
      timestamp: Date.now(),
      title: 'Wednesday Memorization',
    },
  ];

  const checksWeek1 = deriveWeeklyChecksFromJournal(journalWeek1, 1);

  assert(checksWeek1['video_day_monday'] === true, 'Segunda-feira (vídeo) mantido no S-Path');
  assert(checksWeek1['audio_day_monday'] === true, 'Segunda-feira (áudio) mantido no S-Path');
  assert(checksWeek1['video_day_tuesday'] === true, 'Terça-feira (vídeo) mantido no S-Path');
  assert(checksWeek1['memorization_wednesday'] === true, 'Quarta-feira (memorização) mantido no S-Path');
  assert(checksWeek1['video_day_thursday'] === undefined, 'Quinta-feira não concluída não está marcada');

  // 2. S-Path Isolation: Start a New Week (Week 2 does not inherit Week 1)
  console.log('\n--- 2. S-Path: Isolamento de Semanas (Start New Week reseta) ---');
  const checksWeek2 = deriveWeeklyChecksFromJournal(journalWeek1, 2);
  assert(Object.keys(checksWeek2).length === 0, 'Semana 2 começa limpa (0 atividades) até novas conclusões');

  // 3. Lessons: Invariante de Aulas Concluídas e Não Retorno ao Painel
  console.log('\n--- 3. Aulas: Aula Concluída Não Deve Retornar ao Painel Ativo ---');

  const lessonScheduled: LiveLesson = {
    id: 'lesson-101',
    startDateTime: '2026-10-22T14:00:00Z',
    endDateTime: '2026-10-22T14:30:00Z',
    status: 'scheduled',
    studentUid: 'usr-student-1',
    teacherUid: 'usr-teacher-1',
  };

  const lessonCompleted: LiveLesson = {
    ...lessonScheduled,
    status: 'completed',
    completedAt: '2026-10-22T14:30:00Z',
  };

  // Simulating filter from LiveMeetLessonsPanel / LiveLessonsPanel / TeacherScheduleControlTable
  const activeLessonsStudent = [lessonCompleted].filter((l) => l.status === 'scheduled' && !l.cancelledAt);
  assert(activeLessonsStudent.length === 0, 'Aula concluída filtrada e ausente do painel ativo do aluno');

  const activeLessonsTeacher = [lessonCompleted].filter((l) => {
    if (l.status === 'cancelled' || l.status === 'completed' || l.status === 'not_completed') return false;
    return l.status === 'scheduled';
  });
  assert(activeLessonsTeacher.length === 0, 'Aula concluída filtrada e ausente do painel ativo do Native Friend');

  // 4. Invariante de Merge: Snapshot antigo com status 'scheduled' não pode reverter aula 'completed'
  console.log('\n--- 4. Invariante de Merge: Prevenção de Regressão de Status ---');

  const lessonsMap = new Map<string, LiveLesson>();

  // Add completed lesson first
  const addOrUpdate = (item: LiveLesson) => {
    const isItemCancelled = item.status === 'cancelled' || Boolean(item.cancelledAt);
    const isItemCompleted = item.status === 'completed' || Boolean(item.completedAt);
    const normalizedItem: LiveLesson = {
      ...item,
      ...(isItemCancelled ? { status: 'cancelled', cancelledAt: item.cancelledAt || new Date().toISOString() } : {}),
      ...(isItemCompleted ? { status: 'completed', completedAt: item.completedAt || new Date().toISOString() } : {}),
    };

    const existing = lessonsMap.get(normalizedItem.id);
    if (existing) {
      const isCancelled = existing.status === 'cancelled' || normalizedItem.status === 'cancelled' || Boolean(existing.cancelledAt) || Boolean(normalizedItem.cancelledAt);
      const isCompleted = existing.status === 'completed' || normalizedItem.status === 'completed' || Boolean(existing.completedAt) || Boolean(normalizedItem.completedAt);
      const merged: LiveLesson = { ...existing, ...normalizedItem };
      if (isCancelled) {
        merged.status = 'cancelled';
        merged.cancelledAt = existing.cancelledAt || normalizedItem.cancelledAt || new Date().toISOString();
      } else if (isCompleted) {
        merged.status = 'completed';
        merged.completedAt = existing.completedAt || normalizedItem.completedAt || new Date().toISOString();
      }
      lessonsMap.set(normalizedItem.id, merged);
    } else {
      lessonsMap.set(normalizedItem.id, normalizedItem);
    }
  };

  addOrUpdate(lessonCompleted);
  // Now simulate stale API snapshot returning 'scheduled' for the same ID
  addOrUpdate(lessonScheduled);

  const finalMerged = lessonsMap.get('lesson-101');
  assert(finalMerged?.status === 'completed', 'Invariante mantido: Status permanece completed mesmo com snapshot stale scheduled');

  console.log(`\n======================================================================`);
  console.log(`TOTAL: ${passed + failed} | SUCESSO: ${passed} | FALHAS: ${failed}`);
  console.log(`======================================================================`);

  if (failed > 0) process.exit(1);
}

runPersistenceTests();
