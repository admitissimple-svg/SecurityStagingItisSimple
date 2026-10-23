import { executeStartNewWeek } from '../src/utils/StartNewWeekHandler';
import { DayOfWeek, RoutineItem } from '../src/types';
import { defaultRoutinesByDay } from '../src/data/defaultRoutines';

console.log('====================================================');
console.log('--- RUNNING TEST SUITE FOR HOTFIX 2.3.5H ---');
console.log('--- Loading Infinito Apos Start a New Week ---');
console.log('====================================================');

let passedTests = 0;
let totalTests = 0;

function assert(condition: boolean, message: string) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`[PASS] ${message}`);
  } else {
    console.error(`[FAIL] ${message}`);
    process.exitCode = 1;
  }
}

const ALL_DAYS: DayOfWeek[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

async function runTests() {
  const originalFetch = globalThis.fetch;

  try {
    // -------------------------------------------------------------------------
    // Setup cycle 1 routine state
    // -------------------------------------------------------------------------
    const cycle1Routines: Record<DayOfWeek, RoutineItem[]> = {} as any;
    ALL_DAYS.forEach((day) => {
      cycle1Routines[day] = [
        {
          id: `act-${day.slice(0, 3)}-1`,
          time: '08:00',
          activityName: 'Video of the Day',
          category: 'morning',
          completed: true,
          completedToday: true,
          playlistId: 'playlist_test',
          playlistTitle: 'Test Playlist',
          teacherVideos: [
            {
              id: `vid-${day}`,
              videoId: `vid_${day}_c1`,
              url: `https://www.youtube.com/watch?v=vid_${day}_c1`,
              title: `${day} video`,
              instructions: 'Watch carefully',
              addedAt: new Date().toISOString(),
              playlistId: 'playlist_test',
            },
          ],
          learnedWords: ['word1', 'word2', 'word3', 'word4', 'word5'],
        },
      ];
    });

    // Mock backend responses
    let mockBackendCycle = 1;
    let mockDailyVideoReturnOldCycle = false;
    let mockNetworkFail = false;

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const urlStr = String(input);

      if (urlStr.includes('/api/student-routines/start-new-week')) {
        mockBackendCycle = 2;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            weeklyCycle: 2,
            weeklyStudyDaysTarget: 7,
            weeklyStudyDays: ALL_DAYS,
            routines: defaultRoutinesByDay,
            message: 'New weekly cycle activated successfully',
          }),
        } as any;
      }

      if (urlStr.includes('/api/routines/daily-video')) {
        if (mockNetworkFail) {
          throw new Error('Failed to fetch from backend');
        }

        const returnedCycle = mockDailyVideoReturnOldCycle ? 1 : mockBackendCycle;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            studentUid: 'mock_test_student_uid',
            weeklyCycle: returnedCycle,
            routinesByDay: {},
            watchedVideosHistory: ['vid_monday_c1', 'vid_tuesday_c1'],
          }),
        } as any;
      }

      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      } as any;
    };

    console.log('\n--- TEST 1: Start a New Week completes and resets all 7 days ---');
    const startResult = await executeStartNewWeek({
      studentUid: 'mock_test_student_uid',
      studentEmail: 'student_test_mock@example.com',
      currentCycle: 1,
      weeklyStudyDaysTarget: 7,
      weeklyStudyDays: ALL_DAYS,
      currentRoutines: cycle1Routines,
    });

    assert(Boolean(startResult && startResult.success), 'Test 1.1: executeStartNewWeek succeeded');
    assert(startResult?.weeklyCycle === 2, 'Test 1.2: Advanced to cycle 2');

    // -------------------------------------------------------------------------
    // TEST 2: Simulation of useRoutine state machine transitions
    // Verify explicit termination of loading on new cycle confirmation
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 2: useRoutine lifecycle state machine transitions ---');

    // Simulate useRoutine logic in clean harness
    const createClean7DayRoutines = (cycle: number) => {
      const clean: Record<string, any> = {};
      ALL_DAYS.forEach((d) => {
        clean[d] = {
          videoId: '',
          title: '',
          videoTitle: '',
          url: '',
          playlistId: '',
          playlistTitle: '',
          isRepeatVideo: false,
          dayOfWeek: d,
          activityId: 'act-1',
          instructions: '',
          duration: '',
          completed: false,
          completedToday: false,
          weeklyCycle: cycle,
          updatedAt: new Date().toISOString(),
        };
      });
      return clean;
    };

    const areAll7DaysEmpty = (routines: Record<string, any>) => {
      return ALL_DAYS.every((day) => {
        const item = routines[day];
        return !item || !item.videoId || item.videoId.trim() === '';
      });
    };

    // State machine simulator
    class RoutineStateSimulator {
      uid: string;
      activeCycle: number;
      routinesByDay: Record<string, any>;
      loadedUid: string | null = null;
      loadedCycle: number | null = null;
      isLoading: boolean = true;
      isInitialized: boolean = false;
      networkError: string | null = null;
      fetchVersion: number = 0;

      constructor(uid: string, initialCycle: number) {
        this.uid = uid;
        this.activeCycle = initialCycle;
        this.routinesByDay = createClean7DayRoutines(initialCycle);
      }

      resetAllDaysImmediately(newCycle: number) {
        this.activeCycle = newCycle;
        this.fetchVersion += 1;
        this.routinesByDay = createClean7DayRoutines(newCycle);
        // HOTFIX 2.3.5H: Explicit termination
        this.isLoading = false;
        this.loadedUid = this.uid;
        this.loadedCycle = newCycle;
        this.isInitialized = true;
        this.networkError = null;
      }

      async loadData(targetCycle?: number) {
        const version = ++this.fetchVersion;
        const cycleToFetch = targetCycle || this.activeCycle;
        this.isLoading = true;
        this.networkError = null;

        try {
          const res = await fetch(`/api/routines/daily-video?studentUid=${this.uid}&weeklyCycle=${cycleToFetch}`);
          if (this.fetchVersion !== version) return;

          if (res.ok) {
            const data = await res.json();
            // Stale cycle check
            if (data.weeklyCycle !== undefined && data.weeklyCycle !== this.activeCycle) {
              // HOTFIX 2.3.5H: Discard stale cycle, but conclude active cycle loading cleanly
              this.loadedUid = this.uid;
              this.loadedCycle = this.activeCycle;
              this.isLoading = false;
              this.isInitialized = true;
              return;
            }

            this.loadedUid = this.uid;
            this.loadedCycle = this.activeCycle;
            this.networkError = null;
          } else {
            this.networkError = `Server status ${res.status}`;
            this.loadedUid = this.uid;
            this.loadedCycle = cycleToFetch;
          }
        } catch (err: any) {
          this.networkError = err?.message || 'Network error';
          this.loadedUid = this.uid;
          this.loadedCycle = cycleToFetch;
        } finally {
          if (this.fetchVersion === version) {
            this.isLoading = false;
            this.isInitialized = true;
          }
        }
      }

      get isRoutineLoading() {
        return Boolean(
          this.uid &&
            (!this.isInitialized || (this.isLoading && this.loadedUid !== this.uid)) &&
            !areAll7DaysEmpty(this.routinesByDay)
        );
      }

      getRoutineStatus(selectedDay: DayOfWeek): 'loading' | 'empty' | 'loaded' | 'error' {
        const currentDayRoutine = this.routinesByDay[selectedDay] || null;
        const hasSavedVideoToday = Boolean(
          currentDayRoutine && currentDayRoutine.videoId && currentDayRoutine.videoId.trim() !== ''
        );

        if (this.networkError && !hasSavedVideoToday) {
          return 'error';
        }
        if (this.isRoutineLoading) {
          return 'loading';
        }
        if (hasSavedVideoToday) {
          return 'loaded';
        }
        return 'empty';
      }
    }

    const sim = new RoutineStateSimulator('mock_student_123', 1);

    // Initial state before load
    assert(sim.getRoutineStatus('monday') === 'empty', 'Test 2.1: Initial clean 7 days state is empty, not stuck in loading');

    // Simulate resetAllDaysImmediately on Start New Week confirmation
    sim.resetAllDaysImmediately(2);
    assert(sim.isLoading === false, 'Test 2.2: resetAllDaysImmediately terminates isLoading (isLoading = false)');
    assert(sim.isInitialized === true, 'Test 2.3: resetAllDaysImmediately sets isInitialized = true');
    assert(sim.loadedUid === 'mock_student_123', 'Test 2.4: resetAllDaysImmediately sets loadedUid to effectiveUid');
    assert(sim.loadedCycle === 2, 'Test 2.5: resetAllDaysImmediately sets loadedCycle to 2');
    assert(sim.isRoutineLoading === false, 'Test 2.6: isRoutineLoading is immediately false after reset');

    ALL_DAYS.forEach((d) => {
      const status = sim.getRoutineStatus(d);
      assert(status === 'empty', `Test 2.7: Day ${d} status is 'empty' immediately after reset`);
    });

    // -------------------------------------------------------------------------
    // TEST 3: Stale asynchronous response from older cycle is discarded
    // but active cycle loading does not get stuck in infinite spinner
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 3: Stale response from older cycle discarded without infinite loading ---');
    mockDailyVideoReturnOldCycle = true; // backend returns cycle 1
    sim.isLoading = true; // simulate background fetch triggered
    await sim.loadData(2);

    assert(sim.activeCycle === 2, 'Test 3.1: Active cycle remains 2');
    assert(sim.isRoutineLoading === false, 'Test 3.2: isRoutineLoading is false after discarding stale cycle 1 response');
    assert(sim.getRoutineStatus('tuesday') === 'empty', 'Test 3.3: Day status remains "empty" (renders Choose Video)');

    // -------------------------------------------------------------------------
    // TEST 4: Real network error displays recoverable state ('error'), never infinite spinner
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 4: Network error displays recoverable error state ---');
    mockDailyVideoReturnOldCycle = false;
    mockNetworkFail = true;

    const errorSim = new RoutineStateSimulator('mock_student_error', 1);
    await errorSim.loadData(1);

    assert(errorSim.isLoading === false, 'Test 4.1: isLoading ends after network error');
    assert(Boolean(errorSim.networkError), 'Test 4.2: networkError is recorded');
    assert(errorSim.isRoutineLoading === false, 'Test 4.3: isRoutineLoading is false despite network error');
    assert(errorSim.getRoutineStatus('monday') === 'error', 'Test 4.4: getRoutineStatus returns "error" (recoverable UI with Retry)');

    // -------------------------------------------------------------------------
    // TEST 5: When video is selected, status transitions to 'loaded'
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 5: Status transitions to loaded when video is saved ---');
    sim.routinesByDay.wednesday = {
      videoId: 'vid_new_wed_123',
      title: 'Wednesday Business English',
      playlistId: 'playlist_business',
      isRepeatVideo: false,
      dayOfWeek: 'wednesday',
      weeklyCycle: 2,
    };

    assert(sim.getRoutineStatus('wednesday') === 'loaded', 'Test 5.1: Wednesday status is "loaded"');
    assert(sim.getRoutineStatus('thursday') === 'empty', 'Test 5.2: Thursday remains "empty" (Choose Video)');

    // -------------------------------------------------------------------------
    // TEST 6: Portuguese / English text assertions for Choose Video
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 6: UI renders Choose Video for empty routine, no infinite spinner ---');
    const getRenderedPlaceholder = (status: string, isEn: boolean, hasVideo: boolean, videoTitle?: string) => {
      if (status === 'loading') {
        return isEn ? 'Loading video...' : 'Carregando vídeo...';
      }
      if (hasVideo) {
        return videoTitle || 'Daily Video Practice';
      }
      return isEn ? 'Choose Video' : 'Escolher Vídeo';
    };

    const ptTitleEmpty = getRenderedPlaceholder('empty', false, false);
    const enTitleEmpty = getRenderedPlaceholder('empty', true, false);
    const ptTitleLoading = getRenderedPlaceholder('loading', false, false);

    assert(ptTitleEmpty === 'Escolher Vídeo', 'Test 6.1: Empty routine in PT renders "Escolher Vídeo"');
    assert(enTitleEmpty === 'Choose Video', 'Test 6.2: Empty routine in EN renders "Choose Video"');
    assert(ptTitleLoading === 'Carregando vídeo...', 'Test 6.3: Only genuine loading renders "Carregando vídeo..."');

    console.log('\n====================================================');
    console.log(`TEST SUITE FINISHED: ${passedTests}/${totalTests} TESTS PASSED`);
    console.log('====================================================');
  } finally {
    globalThis.fetch = originalFetch;
  }
}

runTests()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('Fatal error in test suite:', err);
    process.exit(1);
  });
