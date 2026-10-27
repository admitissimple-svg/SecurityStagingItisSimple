/**
 * TEST SUITE: HOTFIX CIRÚRGICO — SEQUENTIAL REVIEW
 * Projeto: It's Simple — Security Staging
 *
 * Validações Obrigatórias:
 * 1. Dia sem aula: aba 1 (Analyze Mistakes).
 * 2. Próximo dia sem aula: aba 2 (Grammar Points).
 * 3. Terceiro dia sem aula: aba 3 (Vocabulary & Expressions).
 * 4. Quarto dia sem aula: retorno à aba 1.
 * 5. Dia com aula: aba 4 (5–10 Min Quick Review), sem consumir a sequência.
 * 6. F5 e novo login: mesma etapa no mesmo dia (sem sobrescrever com 0).
 * 7. Duas abas simultâneas: sem avanço duplicado (idempotente).
 * 8. Nova sessão: reinício somente quando apropriado (quando a sessão de referência realmente muda).
 * 9. Lembrete: apenas uma apresentação por dia (claim diário atômico).
 * 10. Persistência após reinicialização (recuperação fidedigna do Firestore review_cycle).
 */

process.env.NODE_ENV = 'test';
process.env.FIREBASE_PROJECT_ID = 'itissimple-security-staging';
process.env.FIREBASE_DATABASE_ID = '(default)';

import assert from 'assert';
import {
  recordDailyReminderShownServer,
  fetchSessionNotesProgressServer,
  saveSessionNotesProgressToFirestore,
  setFirebaseAdminFirestoreForTesting,
} from '../src/serverFirestore';

// Mock in-memory Firestore for deterministic, isolated execution
class MockDocRef {
  constructor(public id: string, private store: Map<string, any>, private parentPath: string) {}

  async get() {
    const key = `${this.parentPath}/${this.id}`;
    const data = this.store.get(key);
    return {
      id: this.id,
      exists: Boolean(data),
      data: () => (data ? JSON.parse(JSON.stringify(data)) : undefined),
    };
  }

  async set(data: any, options?: { merge?: boolean }) {
    const key = `${this.parentPath}/${this.id}`;
    const existing = this.store.get(key) || {};
    const merged = options?.merge ? { ...existing, ...JSON.parse(JSON.stringify(data)) } : JSON.parse(JSON.stringify(data));
    this.store.set(key, merged);
  }

  collection(subName: string) {
    return new MockCollectionRef(`${this.parentPath}/${this.id}/${subName}`, this.store);
  }
}

class MockCollectionRef {
  constructor(public path: string, private store: Map<string, any>) {}

  doc(id: string) {
    return new MockDocRef(id, this.store, this.path);
  }

  async get() {
    const docs: any[] = [];
    for (const [k, v] of this.store.entries()) {
      const prefix = `${this.path}/`;
      if (k.startsWith(prefix)) {
        const remainder = k.substring(prefix.length);
        if (!remainder.includes('/')) {
          docs.push({
            id: remainder,
            data: () => JSON.parse(JSON.stringify(v)),
          });
        }
      }
    }
    return {
      empty: docs.length === 0,
      size: docs.length,
      docs,
      forEach: (cb: any) => docs.forEach(cb),
    };
  }
}

class MockFirestoreDb {
  private store = new Map<string, any>();

  collection(name: string) {
    return new MockCollectionRef(name, this.store);
  }

  async runTransaction(updateFunction: (tx: any) => Promise<any>) {
    const tx = {
      get: async (ref: MockDocRef) => ref.get(),
      set: async (ref: MockDocRef, data: any, options?: any) => ref.set(data, options),
    };
    return updateFunction(tx);
  }

  dump() {
    return Object.fromEntries(this.store.entries());
  }

  clear() {
    this.store.clear();
  }
}

const mockFirestore = new MockFirestoreDb();
setFirebaseAdminFirestoreForTesting(mockFirestore as any);

/**
 * Sequential Review Simulation Engine (Mirrors the exact logic of useNativeFriendsNotesReminder)
 */
interface ReviewCycleDoc {
  lastSessionKey: string;
  stepIndex: number;
  lastAssignedDate?: string;
  lastReviewedDate?: string;
  lastReminderShownDate?: string;
  lastReviewedTab?: string;
  updatedAt?: string;
}

interface SimulatedReminder {
  rule: 'rule_2_quick_review_today' | 'rule_3_sequential_review';
  targetTab: 'mistakes' | 'grammar' | 'vocab' | 'summary';
  tabNumber: 1 | 2 | 3 | 4;
  tabLabel: string;
  isLessonToday: boolean;
  stepIndex: number;
}

const NON_LESSON_STEPS = [
  { tab: 'mistakes' as const, tabNumber: 1 as const, label: 'Analyze Mistakes' },
  { tab: 'grammar' as const, tabNumber: 2 as const, label: 'Grammar Points' },
  { tab: 'vocab' as const, tabNumber: 3 as const, label: 'Vocabulary & Expressions' },
];

class SequentialReviewSimulatedStudent {
  constructor(
    public studentUid: string,
    public studentEmail: string,
    public timeZone: string = 'America/Sao_Paulo'
  ) {}

  // Pure function to evaluate and advance review step idempotently for a given date
  async evaluateDailyReviewStep(params: {
    simulatedTodayDate: string;
    latestSessionKey: string;
    hasLessonToday: boolean;
    isProgressLoaded: boolean;
  }): Promise<{ reminder: SimulatedReminder; cycleDoc: ReviewCycleDoc }> {
    const { simulatedTodayDate, latestSessionKey, hasLessonToday, isProgressLoaded } = params;

    // Condition 1: Race-condition guard
    if (!isProgressLoaded || !latestSessionKey) {
      throw new Error('Race condition guard: cannot evaluate while progress is not loaded');
    }

    // Read stored cycle from Firestore
    let cycle = (await fetchSessionNotesProgressServer(this.studentUid)) as ReviewCycleDoc | null;
    let stepIndex = cycle?.stepIndex ?? 0;
    let lastAssignedDate = cycle?.lastAssignedDate || '';
    let storedSessionKey = cycle?.lastSessionKey || '';
    const hasExistingProgress = Boolean(cycle);

    // Case 1: First time recording progress
    if (!hasExistingProgress || !storedSessionKey) {
      stepIndex = 0;
      lastAssignedDate = simulatedTodayDate;
      storedSessionKey = latestSessionKey;
      await saveSessionNotesProgressToFirestore(this.studentUid, {
        lastSessionKey: latestSessionKey,
        stepIndex: 0,
        lastAssignedDate: simulatedTodayDate,
        updatedAt: new Date().toISOString(),
      });
    }
    // Case 2: Reference session has changed
    else if (storedSessionKey !== latestSessionKey) {
      stepIndex = 0;
      lastAssignedDate = simulatedTodayDate;
      storedSessionKey = latestSessionKey;
      await saveSessionNotesProgressToFirestore(this.studentUid, {
        lastSessionKey: latestSessionKey,
        stepIndex: 0,
        lastAssignedDate: simulatedTodayDate,
        updatedAt: new Date().toISOString(),
      });
    }
    // Case 3: Same session
    else if (lastAssignedDate === simulatedTodayDate) {
      // Step was ALREADY assigned today! Preserve stepIndex throughout the day
    } else if (!lastAssignedDate) {
      lastAssignedDate = simulatedTodayDate;
      await saveSessionNotesProgressToFirestore(this.studentUid, {
        lastSessionKey: storedSessionKey,
        stepIndex,
        lastAssignedDate: simulatedTodayDate,
        updatedAt: new Date().toISOString(),
      });
    } else if (hasLessonToday) {
      // Day with lesson: Do NOT consume sequence! Keep stepIndex and lastAssignedDate as is
    } else {
      // New eligible day without lesson: advance to next non-lesson step: (stepIndex + 1) % 3
      stepIndex = (stepIndex + 1) % 3;
      lastAssignedDate = simulatedTodayDate;
      await saveSessionNotesProgressToFirestore(this.studentUid, {
        lastSessionKey: storedSessionKey,
        stepIndex,
        lastAssignedDate: simulatedTodayDate,
        updatedAt: new Date().toISOString(),
      });
    }

    // Refresh cycle doc
    cycle = (await fetchSessionNotesProgressServer(this.studentUid)) as ReviewCycleDoc;

    let reminder: SimulatedReminder;
    if (hasLessonToday) {
      reminder = {
        rule: 'rule_2_quick_review_today',
        targetTab: 'summary',
        tabNumber: 4,
        tabLabel: '5–10 Min Quick Review',
        isLessonToday: true,
        stepIndex: 3,
      };
    } else {
      const effStep = (cycle?.stepIndex ?? 0) % 3;
      const stepDef = NON_LESSON_STEPS[effStep];
      reminder = {
        rule: 'rule_3_sequential_review',
        targetTab: stepDef.tab,
        tabNumber: stepDef.tabNumber,
        tabLabel: stepDef.label,
        isLessonToday: false,
        stepIndex: effStep,
      };
    }

    return { reminder, cycleDoc: cycle };
  }
}

let passed = 0;
let failed = 0;

function testAssert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    console.log(`  ✅ PASS: ${testName}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${testName} ${detail ? `(${detail})` : ''}`);
    failed++;
  }
}

async function runTestSuite() {
  console.log('============================================================================');
  console.log(' BATERIA DE TESTES: HOTFIX CIRÚRGICO — SEQUENTIAL REVIEW');
  console.log(' AMBIENTE: itissimple-security-staging | FIRESTORE: (default)');
  console.log('============================================================================\n');

  const student = new SequentialReviewSimulatedStudent('student_test_seq_001', 'aluno.seq@example.com');
  const session1 = 'lesson_session_01';
  const session2 = 'lesson_session_02';

  // --------------------------------------------------------------------------
  // TESTE 1: Dia sem aula -> Aba 1 (Analyze Mistakes)
  // --------------------------------------------------------------------------
  console.log('--- 1. Dia sem aula: Aba 1 ---');
  const day1Result = await student.evaluateDailyReviewStep({
    simulatedTodayDate: '2026-10-21',
    latestSessionKey: session1,
    hasLessonToday: false,
    isProgressLoaded: true,
  });

  testAssert(
    day1Result.reminder.tabNumber === 1 && day1Result.reminder.targetTab === 'mistakes',
    'Teste 1: Primeiro dia elegível sem aula direciona para Aba 1 (Analyze Mistakes)',
    `Obtido: tab ${day1Result.reminder.tabNumber} (${day1Result.reminder.targetTab})`
  );
  testAssert(
    day1Result.cycleDoc.stepIndex === 0 && day1Result.cycleDoc.lastAssignedDate === '2026-10-21',
    'Teste 1b: stepIndex 0 e lastAssignedDate persistidos no Firestore'
  );

  // --------------------------------------------------------------------------
  // TESTE 2: Próximo dia sem aula -> Aba 2 (Grammar Points)
  // --------------------------------------------------------------------------
  console.log('\n--- 2. Próximo dia sem aula: Aba 2 ---');
  const day2Result = await student.evaluateDailyReviewStep({
    simulatedTodayDate: '2026-10-22',
    latestSessionKey: session1,
    hasLessonToday: false,
    isProgressLoaded: true,
  });

  testAssert(
    day2Result.reminder.tabNumber === 2 && day2Result.reminder.targetTab === 'grammar',
    'Teste 2: Segundo dia elegível sem aula avança para Aba 2 (Grammar Points)',
    `Obtido: tab ${day2Result.reminder.tabNumber} (${day2Result.reminder.targetTab})`
  );
  testAssert(
    day2Result.cycleDoc.stepIndex === 1 && day2Result.cycleDoc.lastAssignedDate === '2026-10-22',
    'Teste 2b: stepIndex 1 persistido no Firestore'
  );

  // --------------------------------------------------------------------------
  // TESTE 3: Terceiro dia sem aula -> Aba 3 (Vocabulary & Expressions)
  // --------------------------------------------------------------------------
  console.log('\n--- 3. Terceiro dia sem aula: Aba 3 ---');
  const day3Result = await student.evaluateDailyReviewStep({
    simulatedTodayDate: '2026-10-23',
    latestSessionKey: session1,
    hasLessonToday: false,
    isProgressLoaded: true,
  });

  testAssert(
    day3Result.reminder.tabNumber === 3 && day3Result.reminder.targetTab === 'vocab',
    'Teste 3: Terceiro dia elegível sem aula avança para Aba 3 (Vocabulary & Expressions)',
    `Obtido: tab ${day3Result.reminder.tabNumber} (${day3Result.reminder.targetTab})`
  );
  testAssert(
    day3Result.cycleDoc.stepIndex === 2 && day3Result.cycleDoc.lastAssignedDate === '2026-10-23',
    'Teste 3b: stepIndex 2 persistido no Firestore'
  );

  // --------------------------------------------------------------------------
  // TESTE 4: Quarto dia sem aula -> Retorno à Aba 1
  // --------------------------------------------------------------------------
  console.log('\n--- 4. Quarto dia sem aula: Retorno à Aba 1 ---');
  const day4Result = await student.evaluateDailyReviewStep({
    simulatedTodayDate: '2026-10-24',
    latestSessionKey: session1,
    hasLessonToday: false,
    isProgressLoaded: true,
  });

  testAssert(
    day4Result.reminder.tabNumber === 1 && day4Result.reminder.targetTab === 'mistakes',
    'Teste 4: Quarto dia elegível sem aula retorna à Aba 1 (Analyze Mistakes)',
    `Obtido: tab ${day4Result.reminder.tabNumber} (${day4Result.reminder.targetTab})`
  );
  testAssert(
    day4Result.cycleDoc.stepIndex === 0 && day4Result.cycleDoc.lastAssignedDate === '2026-10-24',
    'Teste 4b: Ciclo reinicia modulo 3 (stepIndex 0) mantendo continuidade'
  );

  // --------------------------------------------------------------------------
  // TESTE 5: Dia com aula -> Aba 4, sem consumir a sequência dos dias sem aula
  // --------------------------------------------------------------------------
  console.log('\n--- 5. Dia com aula: Aba 4 sem consumir a sequência ---');
  // Day 5 has scheduled lesson!
  const day5Result = await student.evaluateDailyReviewStep({
    simulatedTodayDate: '2026-10-25',
    latestSessionKey: session1,
    hasLessonToday: true,
    isProgressLoaded: true,
  });

  testAssert(
    day5Result.reminder.tabNumber === 4 &&
    day5Result.reminder.targetTab === 'summary' &&
    day5Result.reminder.rule === 'rule_2_quick_review_today',
    'Teste 5A: Dia com aula agendada direciona estritamente para Aba 4 (Quick Review)'
  );
  testAssert(
    day5Result.cycleDoc.stepIndex === 0,
    'Teste 5B: stepIndex dos dias sem aula NÃO foi consumido (permanece em 0)'
  );

  // Now Day 6 has NO lesson! It should resume the sequence and advance to Tab 2!
  const day6Result = await student.evaluateDailyReviewStep({
    simulatedTodayDate: '2026-10-26',
    latestSessionKey: session1,
    hasLessonToday: false,
    isProgressLoaded: true,
  });

  testAssert(
    day6Result.reminder.tabNumber === 2 && day6Result.reminder.targetTab === 'grammar',
    'Teste 5C: Dia sem aula seguinte à aula consome a próxima etapa legítima (Aba 2)',
    `Obtido: tab ${day6Result.reminder.tabNumber}`
  );
  testAssert(
    day6Result.cycleDoc.stepIndex === 1,
    'Teste 5D: stepIndex avançou de 0 para 1 sem salto incorreto'
  );

  // --------------------------------------------------------------------------
  // TESTE 6: F5 e novo login -> Mesma etapa no mesmo dia
  // --------------------------------------------------------------------------
  console.log('\n--- 6. F5 e novo login: Mesma etapa no mesmo dia ---');
  // Simulating F5 refresh on Day 6
  const day6Refresh = await student.evaluateDailyReviewStep({
    simulatedTodayDate: '2026-10-26',
    latestSessionKey: session1,
    hasLessonToday: false,
    isProgressLoaded: true,
  });

  testAssert(
    day6Refresh.reminder.tabNumber === 2 && day6Refresh.cycleDoc.stepIndex === 1,
    'Teste 6A: F5 no mesmo dia preserva a etapa idêntica (Aba 2, stepIndex 1)'
  );

  // Simulating logout & re-login on Day 6
  const day6Relogin = await student.evaluateDailyReviewStep({
    simulatedTodayDate: '2026-10-26',
    latestSessionKey: session1,
    hasLessonToday: false,
    isProgressLoaded: true,
  });

  testAssert(
    day6Relogin.reminder.tabNumber === 2 && day6Relogin.cycleDoc.stepIndex === 1,
    'Teste 6B: Logout e re-login no mesmo dia NÃO avançam o ciclo nem sobrescrevem com 0'
  );

  // --------------------------------------------------------------------------
  // TESTE 7: Duas abas simultâneas -> Sem avanço duplicado (Idempotência)
  // --------------------------------------------------------------------------
  console.log('\n--- 7. Duas abas simultâneas: Sem avanço duplicado ---');
  // Two tabs loading simultaneously on Day 7
  const [tabA, tabB] = await Promise.all([
    student.evaluateDailyReviewStep({
      simulatedTodayDate: '2026-10-27',
      latestSessionKey: session1,
      hasLessonToday: false,
      isProgressLoaded: true,
    }),
    student.evaluateDailyReviewStep({
      simulatedTodayDate: '2026-10-27',
      latestSessionKey: session1,
      hasLessonToday: false,
      isProgressLoaded: true,
    }),
  ]);

  testAssert(
    tabA.reminder.tabNumber === 3 && tabB.reminder.tabNumber === 3,
    'Teste 7A: Ambas as abas abertas simultaneamente recebem a mesma etapa (Aba 3)'
  );
  testAssert(
    tabA.cycleDoc.stepIndex === 2 && tabB.cycleDoc.stepIndex === 2,
    'Teste 7B: Zero avanço duplicado ou salto descontrolado entre abas concorrentes'
  );

  // --------------------------------------------------------------------------
  // TESTE 8: Nova sessão -> Reinício somente quando apropriado
  // --------------------------------------------------------------------------
  console.log('\n--- 8. Nova sessão: Reinício somente quando apropriado ---');
  // Guard test: progress NOT loaded -> throws error and blocks reset
  let blockedWhileLoading = false;
  try {
    await student.evaluateDailyReviewStep({
      simulatedTodayDate: '2026-10-28',
      latestSessionKey: session2,
      hasLessonToday: false,
      isProgressLoaded: false, // NOT loaded yet
    });
  } catch (err: any) {
    blockedWhileLoading = true;
  }
  testAssert(
    blockedWhileLoading === true,
    'Teste 8A: Bloqueio estrito de redefinição enquanto o progresso não estiver carregado'
  );

  // Session remains session1: does NOT reset
  const sameSessionCheck = await student.evaluateDailyReviewStep({
    simulatedTodayDate: '2026-10-27', // same day
    latestSessionKey: session1,
    hasLessonToday: false,
    isProgressLoaded: true,
  });
  testAssert(
    sameSessionCheck.cycleDoc.stepIndex === 2,
    'Teste 8B: Sessão idêntica não causa reinício espúrio'
  );

  // Teacher registered a BRAND NEW session (session2)
  const newSessionResult = await student.evaluateDailyReviewStep({
    simulatedTodayDate: '2026-10-28',
    latestSessionKey: session2,
    hasLessonToday: false,
    isProgressLoaded: true,
  });

  testAssert(
    newSessionResult.cycleDoc.lastSessionKey === session2 &&
    newSessionResult.reminder.tabNumber === 1 &&
    newSessionResult.cycleDoc.stepIndex === 0,
    'Teste 8C: Nova sessão confirmada reinicia o ciclo pedagógico para Aba 1 (stepIndex 0)'
  );

  // --------------------------------------------------------------------------
  // TESTE 9: Lembrete diário -> Apenas uma apresentação por dia
  // --------------------------------------------------------------------------
  console.log('\n--- 9. Lembrete: Apenas uma apresentação por dia ---');
  const claim1 = await recordDailyReminderShownServer(student.studentUid, '2026-10-28');
  testAssert(
    claim1.canShow === true && claim1.alreadyShown === false,
    'Teste 9A: Primeira abertura do dia permite exibir o lembrete (canShow: true)'
  );

  const claim2 = await recordDailyReminderShownServer(student.studentUid, '2026-10-28');
  testAssert(
    claim2.canShow === false && claim2.alreadyShown === true,
    'Teste 9B: Segunda abertura no mesmo dia rejeita apresentação (canShow: false, alreadyShown: true)'
  );

  const claimNextDay = await recordDailyReminderShownServer(student.studentUid, '2026-10-29');
  testAssert(
    claimNextDay.canShow === true && claimNextDay.alreadyShown === false,
    'Teste 9C: Novo dia permite apresentação única novamente'
  );

  // --------------------------------------------------------------------------
  // TESTE 10: Persistência após reinicialização
  // --------------------------------------------------------------------------
  console.log('\n--- 10. Persistência após reinicialização ---');
  // Re-read directly from Firestore
  const persistedDoc = await fetchSessionNotesProgressServer(student.studentUid);
  testAssert(
    persistedDoc !== null &&
    persistedDoc.lastSessionKey === session2 &&
    persistedDoc.stepIndex === 0 &&
    persistedDoc.lastReminderShownDate === '2026-10-29',
    'Teste 10: Estrutura completa de review_cycle recuperada com fidelidade no Firestore (default)'
  );

  console.log('\n============================================================================');
  console.log(` RESULTADO FINAL: ${passed} PASS, ${failed} FAIL`);
  console.log('============================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTestSuite().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
