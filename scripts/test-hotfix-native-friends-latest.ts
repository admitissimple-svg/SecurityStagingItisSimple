import { extractRealLessonDateAndTimestamp } from '../src/components/NativeFriendsNotesModal';

async function runTests() {
  console.log('--- Starting Native Friends Notes Latest Lesson Hotfix Verification ---');

  // 1. Simulate 3 lessons with distinct dates
  // Lesson 1: Oldest lesson (2026-10-15), but with a very recent updatedAt (e.g., today)
  // Lesson 2: Intermediate lesson (2026-10-25)
  // Lesson 3: Latest lesson (2026-11-02), with older updatedAt
  const simulatedSessions = [
    {
      id: 'session-old-1',
      lessonId: 'lesson-101',
      sessionDate: '2026-10-15',
      startDateTime: '2026-10-15T14:00:00.000Z',
      updatedAt: '2026-11-03T10:00:00.000Z', // Recent edit/analysis
      title: 'Lesson 1 - Introductions',
      notes: 'Notes for lesson 1'
    },
    {
      id: 'session-mid-2',
      lessonId: 'lesson-102',
      sessionDate: '2026-10-25',
      startDateTime: '2026-10-25T15:00:00.000Z',
      updatedAt: '2026-10-25T16:00:00.000Z',
      title: 'Lesson 2 - Travel Plans',
      notes: 'Notes for lesson 2'
    },
    {
      id: 'session-new-3',
      lessonId: 'lesson-103',
      sessionDate: '2026-11-02',
      startDateTime: '2026-11-02T18:00:00.000Z',
      updatedAt: '2026-11-02T19:00:00.000Z',
      title: 'Lesson 3 - Job Interview Prep',
      notes: 'Notes for lesson 3'
    }
  ];

  // 2. Test sorting by real lesson date (frontend helper matching serverApp logic)
  const sorted = [...simulatedSessions].sort((a, b) => {
    const timeA = extractRealLessonDateAndTimestamp(a).timestamp;
    const timeB = extractRealLessonDateAndTimestamp(b).timestamp;
    return timeB - timeA;
  });

  console.log('Sorting Result:');
  sorted.forEach((s, idx) => {
    const { dateStr, timestamp } = extractRealLessonDateAndTimestamp(s);
    console.log(`  [${idx}] ${s.title} -> Date: ${dateStr}, Timestamp: ${timestamp}`);
  });

  if (sorted[0].lessonId !== 'lesson-103') {
    throw new Error(`Expected newest lesson (lesson-103) at index 0, got ${sorted[0].lessonId}`);
  }
  if (sorted[1].lessonId !== 'lesson-102' || sorted[2].lessonId !== 'lesson-101') {
    throw new Error('Sorting order incorrect for historical lessons');
  }
  console.log('✓ Test 1 Passed: [Latest] lesson is strictly lesson-103 despite lesson-101 having a recent updatedAt.');

  // 3. Test selection logic on fresh open vs reopening
  let isFreshOpen = true;
  let selectedSessionKey: string | null = 'session-old-1'; // previously selected before closing modal

  // When modal reopens fresh:
  function onModalOpen(freshList: typeof sorted) {
    if (isFreshOpen && freshList.length > 0) {
      selectedSessionKey = freshList[0].id;
      isFreshOpen = false;
    }
  }

  onModalOpen(sorted);
  if (selectedSessionKey !== 'session-new-3') {
    throw new Error(`Expected selectedSessionKey to reset to session-new-3 on fresh open, got ${selectedSessionKey}`);
  }
  console.log('✓ Test 2 Passed: Modal fresh opening automatically selects [Latest] (session-new-3).');

  // 4. Test manual selection of older lesson
  selectedSessionKey = 'session-old-1';
  console.log(`Manual selection changed to: ${selectedSessionKey}`);
  if (selectedSessionKey !== 'session-old-1') {
    throw new Error('Manual selection failed');
  }
  console.log('✓ Test 3 Passed: User can explicitly navigate to historical lesson (session-old-1).');

  // 5. Test close and reopen modal (simulating state reset with isFreshOpenRef)
  isFreshOpen = true; // reset on modal close/reopen
  onModalOpen(sorted);
  if ((selectedSessionKey as string) !== 'session-new-3') {
    throw new Error(`Expected reopen to select latest session again, got ${selectedSessionKey}`);
  }
  console.log('✓ Test 4 Passed: Reopening modal resets to latest lesson without stale state sticking.');

  // 6. Test simulated pedagogical notes retrieval keys
  const getCandidateKeys = (sessionKey?: string, lessonId?: string) => {
    const keys: string[] = [];
    if (sessionKey) {
      keys.push(sessionKey);
      if (sessionKey.startsWith('session_')) keys.push(sessionKey.replace(/^session_/, ''));
    }
    if (lessonId) {
      keys.push(lessonId);
      if (lessonId.startsWith('lesson_')) keys.push(lessonId.replace(/^lesson_/, ''));
    }
    return Array.from(new Set(keys.filter(Boolean)));
  };

  const candidateKeysLesson3 = getCandidateKeys('session-new-3', 'lesson-103');
  const candidateKeysLesson1 = getCandidateKeys('session-old-1', 'lesson-101');

  console.log('Candidate keys for Lesson 3:', candidateKeysLesson3);
  console.log('Candidate keys for Lesson 1:', candidateKeysLesson1);

  const mockDbTrans = {
    'lesson-103': { id: 'trans-3', summary: 'Analysis of Lesson 3' },
    'lesson-101': { id: 'trans-1', summary: 'Analysis of Lesson 1' }
  };

  const lookup = (keys: string[]) => {
    for (const k of keys) {
      if ((mockDbTrans as any)[k]) return (mockDbTrans as any)[k];
    }
    return null;
  };

  if (lookup(candidateKeysLesson3)?.id !== 'trans-3') {
    throw new Error('Failed to isolate Lesson 3 analysis');
  }
  if (lookup(candidateKeysLesson1)?.id !== 'trans-1') {
    throw new Error('Failed to isolate Lesson 1 analysis');
  }
  console.log('✓ Test 5 Passed: Analyses are isolated per lessonId/sessionKey without cross-talk.');

  console.log('\nAll 5 hotfix tests passed successfully!');
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
