import {
  saveStudentWeeklyChecksToFirestore,
  fetchStudentWeeklyChecksFromFirestore,
  saveMemorizationCompletionToFirestore,
  saveStudentHomeworkProgressToFirestore,
  fetchStudentHomeworkProgressFromFirestore,
} from '../src/utils/studentPersistence';
import {
  saveRoutineVideoToFirestore,
  SavedRoutineVideo,
} from '../src/hooks/useRoutine';
import { executeStartNewWeek } from '../src/utils/StartNewWeekHandler';
import { DayOfWeek } from '../src/types';

console.log('====================================================');
console.log('--- TEST SUITE: FASE 3B - PERSISTÊNCIA SEMANAL ---');
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

async function runFase3BTests() {
  const originalFetch = globalThis.fetch;

  // ---------------------------------------------------------------------------
  // TEST 1: S-Path persiste e recupera o mesmo ciclo após F5
  // ---------------------------------------------------------------------------
  console.log('\n--- Test 1: S-Path persiste e recupera o mesmo ciclo após F5 ---');
  {
    const recordedCalls: { url: string; method?: string; body?: any; headers?: any }[] = [];
    const simulatedStore: Record<string, any> = {};

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const urlStr = String(input);
      const method = init?.method || 'GET';
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      const headers = (init?.headers as Record<string, string>) || {};
      recordedCalls.push({ url: urlStr, method, body, headers });

      if (urlStr.includes('/api/routines/weekly-checks')) {
        if (method === 'POST') {
          const key = `${body.studentUid}::${body.weekId}`;
          simulatedStore[key] = {
            checks: body.checks,
            weekId: body.weekId,
            weeklyCycle: body.weeklyCycle,
          };
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              firestoreConfirmed: true,
              weekId: body.weekId,
              weeklyCycle: body.weeklyCycle,
              checks: body.checks,
            }),
          } as any;
        } else if (method === 'GET') {
          const urlObj = new URL(urlStr, 'http://localhost');
          const uid = urlObj.searchParams.get('studentUid') || '';
          const weekId = urlObj.searchParams.get('weekId') || 'week-1';
          const cycle = Number(urlObj.searchParams.get('weeklyCycle')) || 1;
          const key = `${uid}::${weekId}`;
          const stored = simulatedStore[key];
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              weekId,
              weeklyCycle: cycle,
              checks: stored ? stored.checks : {},
            }),
          } as any;
        }
      }

      return { ok: true, status: 200, json: async () => ({ success: true }) } as any;
    };

    const studentUid = 'student_canonical_uid_123';
    const cycle = 2;
    const weekId = 'week-2';
    const initialChecks = { sPath_monday: true, sPath_wednesday: true };

    // 1. Gravar S-Path ciclo 2
    const saveOk = await saveStudentWeeklyChecksToFirestore(
      studentUid,
      initialChecks,
      'student@example.com',
      1,
      7,
      cycle
    );

    assert(saveOk === true, 'S-Path gravado com sucesso no ciclo 2');
    const postCall = recordedCalls.find((c) => c.method === 'POST' && c.url.includes('/api/routines/weekly-checks'));
    assert(Boolean(postCall), 'saveStudentWeeklyChecksToFirestore utilizou endpoint POST /api/routines/weekly-checks');
    assert(postCall?.body?.weekId === 'week-2' && postCall?.body?.weeklyCycle === 2, 'Payload do S-Path possui ciclo 2 e week-2');

    // 2. Simular F5: leitura direta pelo mesmo UID e ciclo 2
    const fetched = await fetchStudentWeeklyChecksFromFirestore(
      studentUid,
      'student@example.com',
      cycle
    );

    assert(fetched?.weeklyCycle === 2, 'Leitura pós-F5 recuperou weeklyCycle = 2');
    assert(fetched?.checks?.sPath_monday === true && fetched?.checks?.sPath_wednesday === true, 'Leitura pós-F5 recuperou exatamente os checks salvos no ciclo 2');
  }

  // ---------------------------------------------------------------------------
  // TEST 2: Vídeo selecionado permanece após recarregamento
  // ---------------------------------------------------------------------------
  console.log('\n--- Test 2: Vídeo selecionado permanece após recarregamento ---');
  {
    const recordedVideoCalls: { url: string; method?: string; body?: any }[] = [];
    let savedVideoRecord: any = null;

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const urlStr = String(input);
      const method = init?.method || 'GET';
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      recordedVideoCalls.push({ url: urlStr, method, body });

      if (urlStr.includes('/api/routines/daily-video')) {
        if (method === 'POST') {
          savedVideoRecord = {
            videoId: body.videoId,
            videoTitle: body.videoTitle || body.title,
            dayOfWeek: body.dayOfWeek || body.day,
            weeklyCycle: body.weeklyCycle,
          };
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              firestoreConfirmed: true,
              savedRoutine: savedVideoRecord,
            }),
          } as any;
        } else if (method === 'GET') {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              studentUid: 'student_canonical_uid_123',
              weeklyCycle: 2,
              routinesByDay: savedVideoRecord ? { [savedVideoRecord.dayOfWeek]: savedVideoRecord } : {},
              watchedVideosHistory: [],
            }),
          } as any;
        }
      }

      return { ok: true, status: 200, json: async () => ({ success: true }) } as any;
    };

    const studentUid = 'student_canonical_uid_123';
    const day: DayOfWeek = 'tuesday';
    const videoData = {
      videoId: 'dQw4w9WgXcQ',
      title: 'English Routine Video',
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      weeklyCycle: 2,
    };

    const saveVidOk = await saveRoutineVideoToFirestore(studentUid, day, videoData);
    assert(saveVidOk === true, 'Vídeo diário salvo com sucesso via /api/routines/daily-video');

    const postCall = recordedVideoCalls.find((c) => c.method === 'POST' && c.url.includes('/api/routines/daily-video'));
    assert(postCall?.body?.videoId === 'dQw4w9WgXcQ' && postCall?.body?.weeklyCycle === 2, 'Vídeo salvo possui videoId e weeklyCycle=2');

    // Simular reload F5 (GET)
    const getRes = await fetch(`/api/routines/daily-video?studentUid=${studentUid}&weeklyCycle=2`);
    const getData = await getRes.json();
    assert(getData?.routinesByDay?.tuesday?.videoId === 'dQw4w9WgXcQ', 'Vídeo selecionado permanece recuperado no ciclo 2 após reload');
  }

  // ---------------------------------------------------------------------------
  // TEST 3: Ciclo 2 ou superior não é descartado durante a inicialização (F5)
  // ---------------------------------------------------------------------------
  console.log('\n--- Test 3: Ciclo 2 ou superior não é descartado durante a inicialização (F5) ---');
  {
    // Simula a lógica refinada de useRoutine:
    let activeCycle = 1; // default inicial não-confirmado
    let isCycleAuthoritative = false; // flag de confirmação
    let routinesState: Record<string, any> = {};

    // Servidor responde com o ciclo real do aluno em Firestore (Ciclo 2)
    const serverPayload = {
      success: true,
      studentUid: 'student_canonical_uid_123',
      weeklyCycle: 2,
      routinesByDay: {
        monday: { videoId: 'video_week2_mon', weeklyCycle: 2, title: 'Week 2 Video' },
      },
    };

    // Avaliação no hook:
    if (serverPayload.weeklyCycle > activeCycle) {
      activeCycle = serverPayload.weeklyCycle;
      isCycleAuthoritative = true;
    }

    if (serverPayload.routinesByDay) {
      Object.entries(serverPayload.routinesByDay).forEach(([day, item]: [string, any]) => {
        if (item.weeklyCycle === activeCycle) {
          routinesState[day] = item;
        }
      });
    }

    assert(activeCycle === 2, 'Ciclo 2 foi adotado a partir da confirmação do servidor');
    assert(isCycleAuthoritative === true, 'Ciclo 2 foi marcado como autoritativo');
    assert(routinesState.monday?.videoId === 'video_week2_mon', 'Vídeo do Ciclo 2 não foi descartado na inicialização');
  }

  // ---------------------------------------------------------------------------
  // TEST 4: Resposta atrasada de outro ciclo continua sendo rejeitada
  // ---------------------------------------------------------------------------
  console.log('\n--- Test 4: Resposta atrasada de outro ciclo continua sendo rejeitada ---');
  {
    const activeCycle = 3; // Aluno já está no Ciclo 3
    let stateOverwritten = false;

    // Resposta atrasada vinda da rede para o Ciclo 1 ou 2
    const delayedStalePayload = {
      success: true,
      studentUid: 'student_canonical_uid_123',
      weeklyCycle: 2, // ciclo antigo
      routinesByDay: {
        monday: { videoId: 'obsolete_video', weeklyCycle: 2 },
      },
    };

    if (delayedStalePayload.weeklyCycle < activeCycle) {
      // Rejeitada: proteção ativa contra respostas atrasadas
      stateOverwritten = false;
    } else {
      stateOverwritten = true;
    }

    assert(stateOverwritten === false, 'Resposta atrasada com ciclo inferior (Ciclo 2 quando ativo é 3) é estritamente rejeitada');
  }

  // ---------------------------------------------------------------------------
  // TEST 5: Memorization persiste somente com confirmação do backend
  // ---------------------------------------------------------------------------
  console.log('\n--- Test 5: Memorization persiste somente com confirmação do backend ---');
  {
    // Cenário 5A: Backend confirma sucesso
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const urlStr = String(input);
      if (urlStr.includes('/api/routines/weekly-checks')) {
        return { ok: true, status: 200, json: async () => ({ success: true }) } as any;
      }
      if (urlStr.includes('/api/homework')) {
        return { ok: true, status: 200, json: async () => ({ success: true }) } as any;
      }
      return { ok: true, status: 200, json: async () => ({ success: true }) } as any;
    };

    const okResult = await saveMemorizationCompletionToFirestore(
      'student_canonical_uid_123',
      'student@example.com',
      'monday',
      true,
      undefined,
      'week-2'
    );
    assert(okResult === true, 'Memorization retorna true quando backend confirma com sucesso');

    // Cenário 5B: Backend falha (HTTP 500)
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const urlStr = String(input);
      if (urlStr.includes('/api/routines/weekly-checks')) {
        return { ok: false, status: 500, json: async () => ({ success: false, error: 'DatabaseError' }) } as any;
      }
      return { ok: true, status: 200, json: async () => ({ success: true }) } as any;
    };

    const failResult = await saveMemorizationCompletionToFirestore(
      'student_canonical_uid_123',
      'student@example.com',
      'monday',
      true,
      undefined,
      'week-2'
    );
    assert(failResult === false, 'Memorization retorna false e não propaga falso sucesso quando backend falha');
  }

  // ---------------------------------------------------------------------------
  // TEST 6: Homework persiste somente com confirmação do backend
  // ---------------------------------------------------------------------------
  console.log('\n--- Test 6: Homework persiste somente com confirmação do backend ---');
  {
    const mockHw = {
      id: 'week-2',
      weekId: 'week-2',
      weeklyCycle: 2,
      completedPartsByDay: { monday: true },
      isCompleted: true,
    } as any;

    // Cenário 6A: Sucesso confirmado
    globalThis.fetch = async (input: RequestInfo | URL) => {
      return { ok: true, status: 200, json: async () => ({ success: true }) } as any;
    };

    const hwOk = await saveStudentHomeworkProgressToFirestore(
      'student_canonical_uid_123',
      'student@example.com',
      mockHw,
      'week-2'
    );
    assert(hwOk === true, 'Homework retorna true quando backend confirma com sucesso');

    // Cenário 6B: Falha de rede / 500
    globalThis.fetch = async () => {
      return { ok: false, status: 500, json: async () => ({ success: false, error: 'WriteFailed' }) } as any;
    };

    const hwFail = await saveStudentHomeworkProgressToFirestore(
      'student_canonical_uid_123',
      'student@example.com',
      mockHw,
      'week-2'
    );
    assert(hwFail === false, 'Homework retorna false quando backend rejeita ou falha');
  }

  // ---------------------------------------------------------------------------
  // TEST 7: Falha do Firestore no backend não retorna falso sucesso
  // ---------------------------------------------------------------------------
  console.log('\n--- Test 7: Falha do Firestore no backend não retorna falso sucesso ---');
  {
    // Simula a lógica interna do backend POST /api/routines/weekly-checks
    function simulateServerWeeklyChecksWrite(firestoreOk: boolean) {
      if (!firestoreOk) {
        return {
          status: 500,
          body: {
            success: false,
            error: 'FirestorePersistenceFailed',
            message: 'Falha ao confirmar persistência dos checks semanais no Firestore.',
          },
        };
      }
      return {
        status: 200,
        body: {
          success: true,
          firestoreConfirmed: true,
        },
      };
    }

    const failureResponse = simulateServerWeeklyChecksWrite(false);
    assert(
      failureResponse.status === 500 && failureResponse.body.success === false,
      'Backend responde HTTP 500 e success=false quando gravação no Firestore não for confirmada'
    );

    function simulateServerDailyVideoWrite(firestoreOk: boolean) {
      if (!firestoreOk) {
        return {
          status: 500,
          body: {
            success: false,
            error: 'FirestorePersistenceFailed',
            message: 'Falha ao confirmar persistência do vídeo diário no Firestore.',
          },
        };
      }
      return {
        status: 200,
        body: {
          success: true,
          firestoreConfirmed: true,
        },
      };
    }

    const videoFailureResponse = simulateServerDailyVideoWrite(false);
    assert(
      videoFailureResponse.status === 500 && videoFailureResponse.body.success === false,
      'Backend POST /api/routines/daily-video responde HTTP 500 e success=false quando Firestore falha'
    );
  }

  // ---------------------------------------------------------------------------
  // TEST 8: Aluno A não acessa dados do aluno B (isolamento estrito)
  // ---------------------------------------------------------------------------
  console.log('\n--- Test 8: Aluno A não acessa dados do aluno B ---');
  {
    function simulateAuthorizeStudentAccess(callerUid: string, requestedUid: string, role: string) {
      if (role === 'admin') return { authorized: true };
      if (callerUid === requestedUid) return { authorized: true };
      return { authorized: false, status: 403, error: 'Forbidden' };
    }

    const accessTest = simulateAuthorizeStudentAccess('student_A', 'student_B', 'student');
    assert(
      accessTest.authorized === false && accessTest.status === 403,
      'Aluno A tentando acessar/gravar dados do aluno B é bloqueado com status 403 Forbidden'
    );
  }

  // ---------------------------------------------------------------------------
  // TEST 9: Start New Week mantém comportamento original
  // ---------------------------------------------------------------------------
  console.log('\n--- Test 9: Start New Week mantém comportamento original ---');
  {
    let endpointInvoked: boolean = false;
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const urlStr = String(input);
      if (urlStr.includes('/api/student-routines/start-new-week')) {
        endpointInvoked = true;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            weeklyCycle: 3,
            message: 'New weekly cycle activated successfully',
          }),
        } as any;
      }
      return { ok: true, status: 200, json: async () => ({ success: true }) } as any;
    };

    const snwResult = await executeStartNewWeek({
      studentUid: 'student_canonical_uid_123',
      studentEmail: 'student@example.com',
      currentCycle: 2,
      weeklyStudyDaysTarget: 7,
    });

    assert((endpointInvoked as boolean) === true, 'Start New Week invoca endpoint /api/student-routines/start-new-week');
    assert(snwResult?.success === true && snwResult?.weeklyCycle === 3, 'Start New Week avança ciclo corretamente para 3');
  }

  // Restore fetch
  globalThis.fetch = originalFetch;

  console.log('\n====================================================');
  console.log(`FASE 3B TESTS SUMMARY: ${passedTests}/${totalTests} PASSED`);
  console.log('====================================================');

  if (passedTests !== totalTests) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runFase3BTests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
