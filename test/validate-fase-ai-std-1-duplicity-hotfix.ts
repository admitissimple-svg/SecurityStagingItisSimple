process.env.NODE_ENV = 'test';

import assert from 'assert';
import {
  computeNotesHash,
  buildPedagogicalCacheKey,
  getCanonicalSessionKey,
  generateLocalPedagogicalTransformation,
  PEDAGOGICAL_PROMPT_VERSION,
  isLegacyGenericTransformation,
} from '../src/utils/pedagogicalTransformer';

/**
 * FASE AI-STD.1 / F.1 — SUÍTE DE TESTES OBRIGATÓRIOS
 * Correção Cirúrgica de Duplicidade — Native Friends Notes
 *
 * 1. Abertura da modal: somente um POST de transformação para a mesma sessão.
 * 2. Re-renderização: nenhum POST adicional.
 * 3. Atualização assíncrona das sessões: nenhum POST duplicado.
 * 4. React StrictMode: proteção contra disparos concorrentes.
 * 5. Mudança de sessão: resultados não são misturados (isolamento e stale-check).
 * 6. Falha do Gemini: interface preserva notas originais e não apresenta conteúdo inventado.
 * 7. Retry após falha: uma nova tentativa controlada sem concorrência.
 * 8. Cache válido: nenhuma nova chamada ao Gemini.
 * 9. Mudança real no conteúdo: permite nova transformação com chave diferente.
 * 10. Fechamento e reabertura: nenhum estado pendente bloqueia permanentemente novas tentativas.
 */

let passedCount = 0;
let failedCount = 0;

function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passedCount++;
      console.log(`  ✅ [PASS] ${name}`);
    })
    .catch((err) => {
      failedCount++;
      console.error(`  ❌ [FAIL] ${name}`);
      console.error(`         ${err.message}`);
    });
}

// Simulated Client Instance replicating NativeFriendsNotesModal single-flight and state engine
class SimulatedModalClientInstance {
  // Module-level caches shared across re-renders and remounts (identical to NativeFriendsNotesModal)
  private memoryCache = new Map<string, any>();
  private inFlightTransformPromises = new Map<string, Promise<any>>();

  // Instance-level refs
  private lastRequestedTransformKey: string | null = null;
  private currentActiveSessionKey: string = '';
  private currentTransformation: any = null;
  private isLoadingTransformation: boolean = false;
  private isMounted: boolean = true;

  // Telemetry for testing assertions
  public postTransformCallCount: number = 0;
  public getCacheCallCount: number = 0;
  public lastPayloadSent: any = null;

  // Mock server backend behavior
  public mockServerCache: Map<string, any> = new Map();
  public mockGeminiFailure: boolean = false;
  public serverDelayMs: number = 20;

  constructor() {
    this.reset();
  }

  public reset() {
    this.memoryCache.clear();
    this.inFlightTransformPromises.clear();
    this.lastRequestedTransformKey = null;
    this.currentActiveSessionKey = '';
    this.currentTransformation = null;
    this.isLoadingTransformation = false;
    this.isMounted = true;
    this.postTransformCallCount = 0;
    this.getCacheCallCount = 0;
    this.lastPayloadSent = null;
    this.mockServerCache.clear();
    this.mockGeminiFailure = false;
  }

  // Simulated server fetch handler
  private async mockFetchPedagogicalTransformation(params: {
    rawNotes: string;
    topic: string;
    sessionDate: string;
    teacherName: string;
    studentLevel: string;
    studentUid: string;
    sessionKey: string;
    lessonId?: string;
    language: string;
    forceRegenerate: boolean;
  }): Promise<any> {
    const canonicalKey = getCanonicalSessionKey({
      lessonId: params.lessonId,
      sessionKey: params.sessionKey,
      studentUid: params.studentUid,
      sessionDate: params.sessionDate,
    });
    const contentHash = computeNotesHash(params.rawNotes);
    const cefr = 'B1';
    const compositeKey = buildPedagogicalCacheKey({
      canonicalSessionKey: canonicalKey,
      contentHash,
      language: params.language,
      cefrLevel: cefr,
    });

    // Step 1: GET cache lookup if not forceRegenerate
    if (!params.forceRegenerate) {
      this.getCacheCallCount++;
      if (this.mockServerCache.has(compositeKey)) {
        await new Promise((r) => setTimeout(r, this.serverDelayMs));
        return this.mockServerCache.get(compositeKey);
      }
    }

    // Step 2: POST /api/pedagogical-notes/transform
    this.postTransformCallCount++;
    this.lastPayloadSent = params;
    await new Promise((r) => setTimeout(r, this.serverDelayMs));

    if (this.mockGeminiFailure) {
      // Graceful local fallback as defined in pedagogicalTransformer
      const fallback = generateLocalPedagogicalTransformation({
        rawNotes: params.rawNotes,
        topic: params.topic,
        sessionDate: params.sessionDate,
        teacherName: params.teacherName,
        studentLevel: params.studentLevel,
        studentUid: params.studentUid,
        lessonId: params.lessonId,
        sessionKey: params.sessionKey,
        language: params.language,
      });
      fallback.isFallback = true;
      fallback.isProvisional = true;
      fallback.isAiGenerated = false;
      return fallback;
    }

    // Successful AI transformation
    const successfulResult = {
      sessionKey: params.sessionKey,
      lessonId: params.lessonId,
      sessionDate: params.sessionDate,
      topic: params.topic,
      studentLevel: params.studentLevel,
      cefrLevel: 'B1',
      promptVersion: PEDAGOGICAL_PROMPT_VERSION,
      isAiGenerated: true,
      isFallback: false,
      isProvisional: false,
      mistakesAnalysis: [
        {
          id: 'm1',
          original: 'I go to shopping yesterday',
          corrected: 'I went shopping yesterday',
          category: 'grammar',
          explanation: 'Past simple required for finished past time.',
          twoExamples: ['I went shopping on Saturday.', 'We went home early.'],
          commonPitfalls: 'Using present tense with "yesterday".',
        },
      ],
      grammarPoints: [
        {
          id: 'gp1',
          topic: 'Past Simple Irregular Verbs',
          rule: 'Use "went" as the past simple of "go".',
          form: 'Subject + went',
          usage: 'Completed past actions.',
          examples: ['She went to the market.'],
          commonMistakes: 'Saying "I go yesterday".',
          comparisons: 'go vs went',
        },
      ],
      vocabularyAndExpressions: [
        {
          id: 'v1',
          term: 'streamline',
          partOfSpeech: 'Verb',
          simpleDefinition: 'To make a system or organization simpler and more effective.',
          collocations: ['streamline operations', 'streamline the process'],
          realExamples: ['We need to streamline our workflow.'],
          synonyms: ['simplify'],
          register: 'formal',
          category: 'New Word',
          isNewWord: true,
        },
      ],
      reviewSummary: {
        estimatedMinutes: '5–10 min',
        keyRules: ['Past simple irregular verbs'],
        mustKnowVocabulary: ['streamline'],
        essentialCorrections: [{ original: 'I go to shopping yesterday', corrected: 'I went shopping yesterday' }],
        rememberThis: 'Always use went for past occurrences.',
      },
      correctStampsCount: 2,
      incorrectStampsCount: 1,
      generatedAt: new Date().toISOString(),
    };

    this.mockServerCache.set(compositeKey, successfulResult);
    return successfulResult;
  }

  // Implementation of loadPedagogicalNotes exactly mirroring NativeFriendsNotesModal.tsx
  public async loadPedagogicalNotes(
    session: {
      key: string;
      lessonId?: string;
      rawContent: string;
      topic: string;
      dateStr: string;
      teacherName: string;
    },
    forceRegenerate: boolean = false
  ): Promise<any> {
    const targetSessionKey = session.key;
    const targetRawContent = session.rawContent || '';
    const contentHash = computeNotesHash(targetRawContent);
    const canonicalSessionKey = getCanonicalSessionKey({
      lessonId: session.lessonId,
      sessionKey: session.key,
      studentUid: 'canonical_student_uid_123',
      sessionDate: session.dateStr,
    });
    const currentCefr = 'B1';
    const transformCanonicalKey = buildPedagogicalCacheKey({
      canonicalSessionKey,
      contentHash,
      language: 'pt',
      cefrLevel: currentCefr,
      promptVersion: PEDAGOGICAL_PROMPT_VERSION,
    });

    if (forceRegenerate) {
      this.memoryCache.delete(transformCanonicalKey);
    } else {
      const cached = this.memoryCache.get(transformCanonicalKey);

      if (cached && !cached.isProvisional && cached.isAiGenerated && (!cached.contentHash || cached.contentHash === contentHash)) {
        if (this.isMounted && this.currentActiveSessionKey === targetSessionKey) {
          this.currentTransformation = cached;
          this.isLoadingTransformation = false;
        }
        return cached;
      }
    }

    // Check if an identical canonical transformation is already in flight
    const existingInFlight = this.inFlightTransformPromises.get(transformCanonicalKey);
    if (existingInFlight) {
      this.isLoadingTransformation = true;
      try {
        const result = await existingInFlight;
        if (this.isMounted && this.currentActiveSessionKey === targetSessionKey) {
          this.currentTransformation = result;
        }
        return result;
      } catch (err) {
        // error handling
      } finally {
        if (this.isMounted && this.currentActiveSessionKey === targetSessionKey) {
          this.isLoadingTransformation = false;
        }
      }
      return;
    }

    this.isLoadingTransformation = true;

    const transformPromise = this.mockFetchPedagogicalTransformation({
      rawNotes: targetRawContent,
      topic: session.topic,
      sessionDate: session.dateStr,
      teacherName: session.teacherName,
      studentLevel: 'intermediario',
      studentUid: 'canonical_student_uid_123',
      lessonId: session.lessonId,
      sessionKey: targetSessionKey,
      language: 'pt',
      forceRegenerate,
    });

    this.inFlightTransformPromises.set(transformCanonicalKey, transformPromise);
    this.lastRequestedTransformKey = transformCanonicalKey;

    let result: any = null;
    try {
      result = await transformPromise;

      // Stale check (Requirement 7): Do not overwrite if user switched session
      if (this.isMounted && this.currentActiveSessionKey === targetSessionKey) {
        this.currentTransformation = result;
      }

      if (result && result.isAiGenerated && !result.isProvisional) {
        this.memoryCache.set(transformCanonicalKey, result);
      }
      return result;
    } finally {
      this.inFlightTransformPromises.delete(transformCanonicalKey);
      if (this.isMounted && this.currentActiveSessionKey === targetSessionKey) {
        this.isLoadingTransformation = false;
      }
    }
  }

  // Implementation of useEffect exactly mirroring NativeFriendsNotesModal.tsx
  public triggerEffect(session: {
    key: string;
    lessonId?: string;
    rawContent: string;
    topic: string;
    dateStr: string;
    teacherName: string;
  }) {
    if (!this.isMounted) return;

    const currentHash = computeNotesHash(session.rawContent || '');
    const canonicalSessionKey = getCanonicalSessionKey({
      lessonId: session.lessonId,
      sessionKey: session.key,
      studentUid: 'canonical_student_uid_123',
      sessionDate: session.dateStr,
    });
    const currentCefr = 'B1';
    const targetKey = buildPedagogicalCacheKey({
      canonicalSessionKey,
      contentHash: currentHash,
      language: 'pt',
      cefrLevel: currentCefr,
      promptVersion: PEDAGOGICAL_PROMPT_VERSION,
    });

    if (this.currentActiveSessionKey !== session.key) {
      this.currentActiveSessionKey = session.key;
      this.currentTransformation = null;
    }

    if (this.lastRequestedTransformKey === targetKey) {
      return;
    }

    this.lastRequestedTransformKey = targetKey;
    return this.loadPedagogicalNotes(session, false);
  }

  public closeModal() {
    this.isMounted = false;
    // Reset key ref on close if transformation was not definitive
    if (!this.currentTransformation || this.currentTransformation.isFallback || this.currentTransformation.isProvisional) {
      this.lastRequestedTransformKey = null;
    }
  }

  public openModal() {
    this.isMounted = true;
  }

  public getTransformation() {
    return this.currentTransformation;
  }

  public getIsLoading() {
    return this.isLoadingTransformation;
  }
}

async function runTestSuite() {
  console.log('======================================================================');
  console.log('FASE AI-STD.1 / F.1 — TESTES DE DUPLICIDADE EM NATIVE FRIENDS NOTES');
  console.log('======================================================================\n');

  const client = new SimulatedModalClientInstance();

  const session1 = {
    key: 'lesson_2026-11-10_abc1',
    lessonId: 'lesson_2026-11-10_abc1',
    rawContent: '✗ I go to shopping yesterday -> I went shopping yesterday\n[New Word] streamline\n✓ Great job speaking freely!',
    topic: 'Fluency & Work',
    dateStr: '2026-11-10',
    teacherName: 'Charles Lambert',
  };

  const session2 = {
    key: 'lesson_2026-11-09_xyz2',
    lessonId: 'lesson_2026-11-09_xyz2',
    rawContent: '✗ She have 20 years -> She is 20 years old\n[New Word] breakthrough\n✓ Clear pronunciation today',
    topic: 'Daily Conversation',
    dateStr: '2026-11-09',
    teacherName: 'Sarah Jenkins',
  };

  // -------------------------------------------------------------------------
  // TEST 1: Abertura da modal: somente um POST de transformação para a mesma sessão
  // -------------------------------------------------------------------------
  await test('1. Abertura da modal: somente um POST de transformação para a mesma sessão', async () => {
    client.reset();
    client.openModal();

    // Trigger open effect
    const p = client.triggerEffect(session1);
    await p;

    assert.strictEqual(client.postTransformCallCount, 1, `Esperado 1 POST, obtido ${client.postTransformCallCount}`);
    assert.ok(client.getTransformation()?.isAiGenerated, 'Transformação deve ter sido gerada com sucesso');
  });

  // -------------------------------------------------------------------------
  // TEST 2: Re-renderização: nenhum POST adicional
  // -------------------------------------------------------------------------
  await test('2. Re-renderização: nenhum POST adicional', async () => {
    const postCountBefore = client.postTransformCallCount;

    // Simulate 5 re-renders with the same props/session
    for (let i = 0; i < 5; i++) {
      client.triggerEffect(session1);
    }

    assert.strictEqual(
      client.postTransformCallCount,
      postCountBefore,
      `Esperado nenhum POST adicional na re-renderização, obtido ${client.postTransformCallCount - postCountBefore}`
    );
  });

  // -------------------------------------------------------------------------
  // TEST 3: Atualização assíncrona das sessões: nenhum POST duplicado
  // -------------------------------------------------------------------------
  await test('3. Atualização assíncrona das sessões: nenhum POST duplicado', async () => {
    client.reset();
    client.openModal();

    // First render with temporary initial session
    const promise1 = client.triggerEffect(session1);

    // 5ms later, async fetchStudentSessions resolves with new object instance of same session
    await new Promise((r) => setTimeout(r, 5));
    const session1NewRef = { ...session1 };
    const promise2 = client.triggerEffect(session1NewRef);

    await Promise.all([promise1, promise2]);

    assert.strictEqual(
      client.postTransformCallCount,
      1,
      `Atualização assíncrona da lista disparou chamada duplicada: ${client.postTransformCallCount}`
    );
  });

  // -------------------------------------------------------------------------
  // TEST 4: React StrictMode: proteção contra disparos concorrentes
  // -------------------------------------------------------------------------
  await test('4. React StrictMode: proteção contra disparos concorrentes', async () => {
    client.reset();

    // StrictMode mount 1
    client.openModal();
    const strictPromise1 = client.triggerEffect(session1);

    // StrictMode unmount & remount in same synchronous tick
    client.closeModal();
    client.openModal();
    const strictPromise2 = client.triggerEffect(session1);

    await Promise.all([strictPromise1, strictPromise2]);

    assert.strictEqual(
      client.postTransformCallCount,
      1,
      `React StrictMode deve produzir exatamente 1 POST de transformação, obtido ${client.postTransformCallCount}`
    );
  });

  // -------------------------------------------------------------------------
  // TEST 5: Mudança de sessão: resultados não são misturados (stale check)
  // -------------------------------------------------------------------------
  await test('5. Mudança de sessão: resultados não são misturados', async () => {
    client.reset();
    client.openModal();
    client.serverDelayMs = 50; // slow server response

    // Open session 1 (starts in flight)
    const p1 = client.triggerEffect(session1);

    // User switches to session 2 after 10ms
    await new Promise((r) => setTimeout(r, 10));
    const p2 = client.triggerEffect(session2);

    await Promise.all([p1, p2]);

    // Active transformation in modal MUST be session 2, NOT overwritten by session 1
    const activeResult = client.getTransformation();
    assert.strictEqual(
      activeResult.sessionKey,
      session2.key,
      `Resultado obsoleto de sessão anterior sobrescreveu a sessão ativa. Esperado ${session2.key}, obtido ${activeResult?.sessionKey}`
    );
    assert.strictEqual(client.postTransformCallCount, 2, 'Deve ter executado exatamente 1 POST para cada sessão diferente');
  });

  // -------------------------------------------------------------------------
  // TEST 6: Falha do Gemini: interface preserva notas originais e não apresenta conteúdo inventado
  // -------------------------------------------------------------------------
  await test('6. Falha do Gemini: interface preserva notas originais e não apresenta conteúdo inventado', async () => {
    client.reset();
    client.mockGeminiFailure = true;
    client.openModal();

    await client.triggerEffect(session1);

    const fallbackResult = client.getTransformation();
    assert.ok(fallbackResult, 'Fallback deve existir');
    assert.strictEqual(fallbackResult.isFallback, true, 'isFallback deve ser true');
    assert.strictEqual(fallbackResult.isAiGenerated, false, 'isAiGenerated deve ser false');

    // REGRA INEGOCIÁVEL: Proibição de conteúdo inventado
    for (const m of fallbackResult.mistakesAnalysis) {
      assert.ok(
        session1.rawContent.toLowerCase().includes(m.original.toLowerCase()),
        `Erro '${m.original}' não constava nas anotações do professor`
      );
    }
    // As notas originais são fielmente preservadas
    assert.strictEqual(fallbackResult.mistakesAnalysis[0].original, 'I go to shopping yesterday');
    assert.strictEqual(fallbackResult.vocabularyAndExpressions[0].term, 'streamline');
    assert.strictEqual(fallbackResult.isFallback, true);
    assert.strictEqual(fallbackResult.isAiGenerated, false);
  });

  // -------------------------------------------------------------------------
  // TEST 7: Retry após falha: uma nova tentativa controlada sem concorrência
  // -------------------------------------------------------------------------
  await test('7. Retry após falha: uma nova tentativa controlada sem concorrência', async () => {
    // client is currently in failure state from test 6 (postCount was 1)
    const countBeforeRetry = client.postTransformCallCount;
    client.mockGeminiFailure = false; // Server recovers

    // User clicks Retry twice rapidly
    const retryPromise1 = client.loadPedagogicalNotes(session1, true);
    const retryPromise2 = client.loadPedagogicalNotes(session1, true);

    await Promise.all([retryPromise1, retryPromise2]);

    const newPostCalls = client.postTransformCallCount - countBeforeRetry;
    assert.strictEqual(
      newPostCalls,
      1,
      `Dois cliques rápidos no Retry devem disparar exatamente 1 nova chamada, obtido ${newPostCalls}`
    );

    const result = client.getTransformation();
    assert.strictEqual(result.isAiGenerated, true, 'Retry bem-sucedido deve carregar resultado de IA definitivo');
  });

  // -------------------------------------------------------------------------
  // TEST 8: Cache válido: nenhuma nova chamada ao Gemini
  // -------------------------------------------------------------------------
  await test('8. Cache válido: nenhuma nova chamada ao Gemini', async () => {
    const postCountBefore = client.postTransformCallCount;

    // Load with valid cache
    await client.loadPedagogicalNotes(session1, false);

    assert.strictEqual(
      client.postTransformCallCount,
      postCountBefore,
      'Com cache válido, nenhuma chamada POST deve ser realizada'
    );
  });

  // -------------------------------------------------------------------------
  // TEST 9: Mudança real no conteúdo: permite nova transformação com chave diferente
  // -------------------------------------------------------------------------
  await test('9. Mudança real no conteúdo: permite nova transformação com chave diferente', async () => {
    const postCountBefore = client.postTransformCallCount;

    const modifiedSession1 = {
      ...session1,
      rawContent: session1.rawContent + '\nAlt+W: newTermAddedByTeacher',
    };

    await client.triggerEffect(modifiedSession1);

    assert.strictEqual(
      client.postTransformCallCount,
      postCountBefore + 1,
      'Alteração real do conteúdo da aula deve gerar nova chave e disparar nova transformação legítima'
    );
  });

  // -------------------------------------------------------------------------
  // TEST 10: Fechamento e reabertura: nenhum estado pendente bloqueia permanentemente novas tentativas
  // -------------------------------------------------------------------------
  await test('10. Fechamento e reabertura: nenhum estado pendente bloqueia permanentemente novas tentativas', async () => {
    client.reset();
    client.mockGeminiFailure = true; // causes failure
    client.openModal();

    await client.triggerEffect(session1);
    assert.strictEqual(client.getTransformation()?.isFallback, true, 'Primeira tentativa resultou em fallback');

    // Close modal
    client.closeModal();

    // Server recovers in the background
    client.mockGeminiFailure = false;

    // Reopen modal later
    client.openModal();
    const reopenPromise = client.triggerEffect(session1);
    await reopenPromise;

    assert.strictEqual(
      client.getTransformation()?.isAiGenerated,
      true,
      'Reabertura após falha deve permitir nova tentativa controlada sem bloqueio permanente'
    );
  });

  console.log('\n======================================================================');
  console.log(`FASE AI-STD.1 / F.1 — RESULTADO: ${passedCount} PASSOU | ${failedCount} FALHOU`);
  console.log('======================================================================');

  if (failedCount > 0) {
    process.exit(1);
  }
}

runTestSuite();
