/**
 * AI.BOUNDS.2B — Testes Direcionados para Proteção do /api/student-dictionary/enrich
 *
 * Cobertura obrigatória:
 * 1. Auth & RBAC preservados (401 sem/com token inválido, 403 cross-student/teacher own UID, 422 UID sintético).
 * 2. Entradas normais, deduplicação, persistência canônica e preservação de definições já salvas.
 * 3. Validação estrita de limites antes de qualquer chamada Gemini (sem truncamento silencioso):
 *    - Quantidade > 10 palavras -> HTTP 400 (0 Gemini, sem slice silencioso)
 *    - Tamanho individual > 70 chars -> HTTP 400 (0 Gemini)
 *    - Tamanho agregado > 500 chars -> HTTP 400 (0 Gemini)
 *    - Tipo inválido (não-array ou item não-string) -> HTTP 400 (0 Gemini)
 *    - Limites exatos válidos (10 palavras, <=70 individual, <=500 agregado) -> HTTP 200
 *    - Payloads inválidos não consomem cota de rate limit
 * 4. Rate limit por usuário autenticado (local e distribuído via Firestore):
 *    - Até o limite permitido (10 reqs): HTTP 200
 *    - Limite excedido: HTTP 429 + Retry-After + ZERO chamadas Gemini
 *    - Palavras já enriquecidas/cacheadas continuam retornando HTTP 200 sem chamar Gemini
 *    - Isolamento por UID: outro usuário mantém cota independente (HTTP 200)
 * 5. Indisponibilidade do controle distribuído (Fail-Closed HTTP 503):
 *    - Falha em runTransaction do rate limiter -> HTTP 503, ZERO Gemini, sem vazar detalhes internos
 *    - Falha síncrona em db.collection -> HTTP 503, ZERO Gemini
 *    - Firestore nulo -> HTTP 503, ZERO Gemini
 *    - Falha no single-flight lock distribuído -> HTTP 503, ZERO Gemini
 * 6. Concorrência:
 *    - Múltiplas requisições simultâneas para o mesmo aluno -> máx. 1 chamada Gemini (demais 429)
 *    - Liberação segura do lock após falha do Gemini
 *    - Isolamento concorrente entre UIDs distintos (sem bloqueio cruzado)
 *    - Rajada excedendo cota nunca ultrapassa o teto e retorna 429 com 0 Gemini após bloqueio
 *
 * Sem Gemini real, sem Firestore real e sem chamadas de rede externas.
 */

process.env.NODE_ENV = 'test';
process.env.FIREBASE_PROJECT_ID = 'itissimple-security-staging';
process.env.FIREBASE_DATABASE_ID = '(default)';
process.env.GEMINI_API_KEY = 'test-fake-gemini-key-no-real-calls';

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    console.log(`  ✅ PASS: ${testName}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${testName}${detail ? ` (${detail})` : ''}`);
    failed++;
  }
}

function deepClone<T>(val: T): T {
  return val === undefined ? val : JSON.parse(JSON.stringify(val));
}

function isPlainObject(val: any): val is Record<string, any> {
  if (!val || typeof val !== 'object' || Array.isArray(val) || val instanceof Date) return false;
  const ctorName = val.constructor?.name || '';
  if (ctorName === 'ArrayUnionTransform' || ctorName === 'ArrayRemoveTransform') return false;
  return true;
}

function deepMergeObjects(target: Record<string, any>, source: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = { ...target };
  for (const [key, val] of Object.entries(source)) {
    if (isPlainObject(val) && isPlainObject(out[key])) {
      out[key] = deepMergeObjects(out[key], val);
    } else {
      out[key] = deepClone(val);
    }
  }
  return out;
}

class MockDocRef {
  public id: string;
  public path: string;
  constructor(private col: MockCollection, id: string) {
    this.id = id;
    this.path = `${col.collectionPath}/${id}`;
  }

  async get() {
    if (this.col.db.onDocGet) {
      await this.col.db.onDocGet(this.path, this);
    }
    const data = this.col.docs.get(this.id);
    return {
      exists: Boolean(data),
      id: this.id,
      ref: this,
      data: () => (data ? deepClone(data) : undefined),
    };
  }

  async set(data: any, options?: { merge?: boolean }) {
    const existing = this.col.docs.get(this.id) || {};
    const merged = options?.merge ? deepMergeObjects(existing, data) : deepMergeObjects({}, data);
    this.col.docs.set(this.id, merged);
    return { writeTime: new Date() };
  }

  async update(data: any) {
    const existing = this.col.docs.get(this.id);
    if (!existing) throw new Error(`NOT_FOUND: ${this.path}`);
    this.col.docs.set(this.id, deepMergeObjects(existing, data));
    return { writeTime: new Date() };
  }

  async delete() {
    this.col.docs.delete(this.id);
    return { writeTime: new Date() };
  }

  collection(subName: string): MockCollection {
    if (!this.col.subcollections.has(this.id)) {
      this.col.subcollections.set(this.id, new Map());
    }
    const map = this.col.subcollections.get(this.id)!;
    if (!map.has(subName)) {
      map.set(subName, new MockCollection(`${this.col.collectionPath}/${this.id}/${subName}`, this.col.db));
    }
    return map.get(subName)!;
  }
}

class MockCollection {
  public docs: Map<string, any> = new Map();
  public subcollections: Map<string, Map<string, MockCollection>> = new Map();

  constructor(public collectionPath: string, public db: MockFirestoreDb) {}

  doc(id: string): MockDocRef {
    return new MockDocRef(this, id);
  }

  where() {
    return {
      limit: () => this,
      get: async () => ({ empty: true, size: 0, docs: [], forEach: () => {} }),
    };
  }

  async get() {
    const matched: any[] = [];
    for (const [id, data] of this.docs.entries()) {
      const ref = this.doc(id);
      matched.push({
        id,
        exists: true,
        ref,
        data: () => deepClone(data),
      });
    }
    return {
      empty: matched.length === 0,
      size: matched.length,
      docs: matched,
      forEach: (cb: (d: any) => void) => matched.forEach(cb),
    };
  }
}

class MockFirestoreDb {
  private collections: Map<string, MockCollection> = new Map();
  private txChain: Promise<any> = Promise.resolve();
  public failTransactionMatcher: ((docPaths: string[]) => boolean) | null = null;
  public onDocGet: ((docPath: string, docRef: MockDocRef) => Promise<void> | void) | null = null;

  collection(name: string): MockCollection {
    if (!this.collections.has(name)) {
      this.collections.set(name, new MockCollection(name, this));
    }
    return this.collections.get(name)!;
  }

  async runTransaction<T>(fn: (tx: any) => Promise<T>): Promise<T> {
    const run = async (): Promise<T> => {
      const ops: Array<() => Promise<void>> = [];
      const touchedPaths: string[] = [];
      const tx = {
        get: async (target: MockDocRef) => {
          touchedPaths.push(target.path);
          return target.get();
        },
        set: (ref: MockDocRef, data: any, options?: { merge?: boolean }) => {
          touchedPaths.push(ref.path);
          ops.push(() => ref.set(data, options).then(() => undefined));
        },
        update: (ref: MockDocRef, data: any) => {
          touchedPaths.push(ref.path);
          ops.push(() => ref.update(data).then(() => undefined));
        },
        delete: (ref: MockDocRef) => {
          touchedPaths.push(ref.path);
          ops.push(() => ref.delete().then(() => undefined));
        },
      };
      const res = await fn(tx);
      if (this.failTransactionMatcher && this.failTransactionMatcher(touchedPaths)) {
        throw new Error('Firestore Unavailable: DEADLINE_EXCEEDED');
      }
      for (const op of ops) {
        await op();
      }
      return res;
    };
    const next = this.txChain.then(run, run);
    this.txChain = next.catch(() => {});
    return next;
  }
}

function createSimulator(app: any) {
  return function simulateRequest(
    method: string,
    urlPath: string,
    headers: Record<string, string> = {},
    body: any = null
  ): Promise<{ status: number; headers: Record<string, string>; body: any }> {
    return new Promise((resolve) => {
      const reqHeaders: Record<string, string> = {};
      Object.entries(headers).forEach(([k, v]) => {
        reqHeaders[k.toLowerCase()] = v;
      });

      const parsedUrl = new URL(urlPath, 'http://localhost');
      const query: Record<string, string> = {};
      parsedUrl.searchParams.forEach((val, key) => {
        query[key] = val;
      });

      const req: any = {
        method: method.toUpperCase(),
        url: urlPath,
        originalUrl: urlPath,
        path: parsedUrl.pathname,
        query,
        headers: reqHeaders,
        body: body ?? {},
        _body: true,
      };

      const resHeaders: Record<string, string> = {};
      let statusCode = 200;
      let resBody: any = null;

      const res: any = {
        setHeader: (name: string, value: string) => {
          resHeaders[name.toLowerCase()] = value;
        },
        getHeader: (name: string) => resHeaders[name.toLowerCase()],
        removeHeader: (name: string) => {
          delete resHeaders[name.toLowerCase()];
        },
        status: (code: number) => {
          statusCode = code;
          return res;
        },
        json: (data: any) => {
          resBody = data;
          resolve({ status: statusCode, headers: resHeaders, body: resBody });
        },
        send: (data: any) => {
          resBody = data;
          resolve({ status: statusCode, headers: resHeaders, body: resBody });
        },
        end: () => {
          resolve({ status: statusCode, headers: resHeaders, body: resBody });
        },
      };

      app(req, res, (err?: any) => {
        if (err) {
          resolve({ status: 500, headers: resHeaders, body: { error: err.message } });
        } else {
          resolve({ status: statusCode === 200 ? 404 : statusCode, headers: resHeaders, body: resBody });
        }
      });
    });
  };
}

async function runDictionaryEnrichBoundsTests() {
  const { setFirebaseAdminAuthForTesting } = await import('../src/serverFirebaseAdmin');
  const {
    setFirebaseAdminFirestoreForTesting,
    resetFirebaseAdminFirestoreForTesting,
    fetchStudentVocabularyFromFirestoreServer,
  } = await import('../src/serverFirestore');
  const {
    GEMINI_POLICIES,
    setDistributedCostControlForTesting,
    resetGeminiSecurityStateForTesting,
  } = await import('../src/serverGeminiSecurity');
  const { app, resetResidualCachesForTesting } = await import('../serverApp');

  const simulateRequest = createSimulator(app);

  const STUDENT_1_UID = 'EnrichStu1Uid12345678901';
  const STUDENT_1_EMAIL = 'enrich.student1@itissimple.test';
  const STUDENT_2_UID = 'EnrichStu2Uid12345678901';
  const STUDENT_2_EMAIL = 'enrich.student2@itissimple.test';
  const TEACHER_1_UID = 'EnrichTch1Uid12345678901';
  const TEACHER_1_EMAIL = 'enrich.teacher1@itissimple.test';

  const mockUsers: Record<string, { uid: string; email: string; role: 'student' | 'teacher' | 'admin' }> = {
    'token-student-1': { uid: STUDENT_1_UID, email: STUDENT_1_EMAIL, role: 'student' },
    'token-student-2': { uid: STUDENT_2_UID, email: STUDENT_2_EMAIL, role: 'student' },
    'token-teacher-1': { uid: TEACHER_1_UID, email: TEACHER_1_EMAIL, role: 'teacher' },
  };

  setFirebaseAdminAuthForTesting({
    verifyIdToken: async (token: string) => {
      const user = mockUsers[token];
      if (!user) {
        const err: any = new Error('Invalid token');
        err.code = 'auth/invalid-id-token';
        throw err;
      }
      return {
        uid: user.uid,
        email: user.email,
        email_verified: true,
        role: user.role,
        teacher: user.role === 'teacher',
        admin: false,
      };
    },
  } as any);

  // Intercept global fetch to mock Gemini HTTP API without any real network call
  const originalFetch = globalThis.fetch;
  let geminiCallCount = 0;
  let geminiDelayMs = 0;
  let geminiShouldFail = false;
  let geminiLastPromptWords: string[] = [];
  let geminiExtraInjectedWords: any[] = [];
  let onGeminiInvocation: ((callIndex: number) => Promise<void> | void) | null = null;

  (globalThis as any).fetch = async (input: any, init?: any) => {
    const urlStr = typeof input === 'string' ? input : input?.url || String(input);
    if (urlStr.includes('generativelanguage.googleapis.com')) {
      geminiCallCount++;
      if (onGeminiInvocation) {
        await onGeminiInvocation(geminiCallCount);
      }
      if (geminiDelayMs > 0) {
        await new Promise((r) => setTimeout(r, geminiDelayMs));
      }
      if (geminiShouldFail) {
        return new Response(
          JSON.stringify({ error: { code: 400, message: 'INVALID_ARGUMENT: simulated failure' } }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      let bodyText = '';
      try {
        const parsedBody = JSON.parse(init?.body || '{}');
        bodyText = JSON.stringify(parsedBody?.contents || '');
      } catch {}

      // Extract numbered lines from prompt: "1. word"
      const extractedWords: string[] = [];
      const regex = /\d+\.\s+([^\n\\"]+)/g;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(bodyText)) !== null) {
        const candidate = match[1].replace(/\\n.*$/, '').trim();
        if (candidate) extractedWords.push(candidate);
      }
      geminiLastPromptWords = extractedWords;

      const generated = extractedWords.map((w) => ({
        word: w,
        partOfSpeech: 'Noun',
        definitionEn: `Authentic pedagogical definition for ${w}.`,
        exampleSentenceEn: `Using ${w} naturally improves fluency.`,
        translationPt: `tradução de ${w}`,
        cefrLevel: 'B1',
      }));

      const allReturned = [...generated, ...geminiExtraInjectedWords];
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: JSON.stringify({ words: allReturned }) }],
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    throw new Error(`Unexpected external fetch during unit test: ${urlStr}`);
  };

  let mockDb = new MockFirestoreDb();

  const seedMockFirestore = async () => {
    mockDb = new MockFirestoreDb();
    await mockDb.collection('users').doc(STUDENT_1_UID).set({
      id: STUDENT_1_UID,
      uid: STUDENT_1_UID,
      email: STUDENT_1_EMAIL,
      role: 'student',
      level: 'intermediario',
      excludedDictionaryWords: ['tombstone_word'],
    });
    await mockDb.collection('users').doc(STUDENT_2_UID).set({
      id: STUDENT_2_UID,
      uid: STUDENT_2_UID,
      email: STUDENT_2_EMAIL,
      role: 'student',
      level: 'avancado',
    });
    await mockDb.collection('users').doc(TEACHER_1_UID).set({
      id: TEACHER_1_UID,
      uid: TEACHER_1_UID,
      email: TEACHER_1_EMAIL,
      role: 'teacher',
      isTeacher: true,
      isApproved: true,
    });
    setFirebaseAdminFirestoreForTesting(mockDb as any);
  };

  const resetAll = async () => {
    setDistributedCostControlForTesting(null);
    resetFirebaseAdminFirestoreForTesting();
    resetGeminiSecurityStateForTesting();
    resetResidualCachesForTesting();
    geminiCallCount = 0;
    geminiDelayMs = 0;
    geminiShouldFail = false;
    geminiLastPromptWords = [];
    geminiExtraInjectedWords = [];
    onGeminiInvocation = null;
    await seedMockFirestore();
  };

  console.log('=========================================================================');
  console.log('  AI.BOUNDS.2B — TESTES DIRECIONADOS: /api/student-dictionary/enrich     ');
  console.log('=========================================================================\n');

  try {
    // =========================================================================
    // BLOCO 1: AUTH & RBAC PRESERVADOS
    // =========================================================================
    console.log('--- 1. Autenticação e RBAC Preservados ---');
    await resetAll();
    {
      const resNoAuth = await simulateRequest('POST', '/api/student-dictionary/enrich', {}, { words: ['ephemeral'] });
      assert(resNoAuth.status === 401, '1.1: Sem token retorna HTTP 401');
      assert(geminiCallCount === 0, '1.2: Zero chamadas Gemini sem token');

      const resBadAuth = await simulateRequest(
        'POST',
        '/api/student-dictionary/enrich',
        { Authorization: 'Bearer invalid-token' },
        { words: ['ephemeral'] }
      );
      assert(resBadAuth.status === 401, '1.3: Token inválido retorna HTTP 401');

      const resCrossStudent = await simulateRequest(
        'POST',
        '/api/student-dictionary/enrich',
        { Authorization: 'Bearer token-student-2' },
        { studentUid: STUDENT_1_UID, words: ['ephemeral'] }
      );
      assert(resCrossStudent.status === 403, '1.4: Cross-student retorna HTTP 403');

      const resTeacherOwnUid = await simulateRequest(
        'POST',
        '/api/student-dictionary/enrich',
        { Authorization: 'Bearer token-teacher-1' },
        { studentUid: TEACHER_1_UID, words: ['ephemeral'] }
      );
      assert(resTeacherOwnUid.status === 403, '1.5: Teacher UID como studentUid retorna HTTP 403');

      const resSyntheticUid = await simulateRequest(
        'POST',
        '/api/student-dictionary/enrich',
        { Authorization: 'Bearer token-teacher-1' },
        { studentUid: 'usr-synthetic-999', words: ['ephemeral'] }
      );
      assert(resSyntheticUid.status === 422 || resSyntheticUid.status === 403, '1.6: UID sintético rejeitado (422/403)');
      assert(geminiCallCount === 0, '1.7: Zero chamadas Gemini em falhas de Auth/RBAC');
    }

    // =========================================================================
    // BLOCO 2: VALIDAÇÃO DE LIMITES ANTES DO GEMINI (SEM TRUNCAMENTO SILENCIOSO)
    // =========================================================================
    console.log('\n--- 2. Validação de Quantidade, Tamanho Individual e Agregado ---');
    await resetAll();
    {
      // 2.1 Tipo inválido
      const resNonArray = await simulateRequest(
        'POST',
        '/api/student-dictionary/enrich',
        { Authorization: 'Bearer token-student-1' },
        { studentUid: STUDENT_1_UID, words: 'not-an-array' }
      );
      assert(resNonArray.status === 400, '2.1: words não-array retorna HTTP 400');

      const resNonStringItem = await simulateRequest(
        'POST',
        '/api/student-dictionary/enrich',
        { Authorization: 'Bearer token-student-1' },
        { studentUid: STUDENT_1_UID, words: ['valid', 12345] }
      );
      assert(resNonStringItem.status === 400, '2.2: Item não-string em words retorna HTTP 400');

      // 2.3 Quantidade > 10 (sem truncamento silencioso)
      const elevenWords = Array.from({ length: 11 }, (_, i) => `word_${i + 1}`);
      const resOverCount = await simulateRequest(
        'POST',
        '/api/student-dictionary/enrich',
        { Authorization: 'Bearer token-student-1' },
        { studentUid: STUDENT_1_UID, words: elevenWords }
      );
      assert(resOverCount.status === 400, `2.3: Quantidade > 10 (11 palavras) retorna HTTP 400 sem truncar`, `status=${resOverCount.status}`);

      // 2.4 Tamanho individual > 70 caracteres (sem truncamento silencioso)
      const resOverIndividual = await simulateRequest(
        'POST',
        '/api/student-dictionary/enrich',
        { Authorization: 'Bearer token-student-1' },
        { studentUid: STUDENT_1_UID, words: ['a'.repeat(71)] }
      );
      assert(resOverIndividual.status === 400, '2.4: Palavra individual > 70 caracteres retorna HTTP 400');

      // 2.5 Tamanho agregado > 500 caracteres (10 palavras de 55 chars = 550 chars)
      const overAggregateWords = Array.from({ length: 10 }, (_, i) => `${'x'.repeat(53)}_${i}`);
      const resOverAggregate = await simulateRequest(
        'POST',
        '/api/student-dictionary/enrich',
        { Authorization: 'Bearer token-student-1' },
        { studentUid: STUDENT_1_UID, words: overAggregateWords }
      );
      assert(resOverAggregate.status === 400, '2.5: Tamanho agregado > 500 caracteres retorna HTTP 400');
      assert(geminiCallCount === 0, '2.6: Zero chamadas Gemini em todos os bloqueios de validação');

      // 2.7 Limite exato válido: 10 palavras de 50 chars (= 500 agregado, cada <= 70) -> HTTP 200
      const exactLimitWords = Array.from({ length: 10 }, (_, i) => `${'b'.repeat(48)}_${i}`);
      const resExactLimit = await simulateRequest(
        'POST',
        '/api/student-dictionary/enrich',
        { Authorization: 'Bearer token-student-1' },
        { studentUid: STUDENT_1_UID, words: exactLimitWords }
      );
      assert(resExactLimit.status === 200 && resExactLimit.body?.enrichedEntries?.length === 10, '2.7: Exatamente 10 palavras dentro do limite agregado (500) passam sem truncar');
      assert(geminiCallCount === 1, '2.8: Exatamente 1 chamada Gemini para o lote válido de 10 palavras');

      // 2.9 Payloads inválidos anteriores não consumiram a cota (ainda restam 9 de 10 reqs)
      let extraOk = 0;
      for (let i = 1; i <= 9; i++) {
        const r = await simulateRequest(
          'POST',
          '/api/student-dictionary/enrich',
          { Authorization: 'Bearer token-student-1' },
          { studentUid: STUDENT_1_UID, words: [`quota_probe_${i}`] }
        );
        if (r.status === 200) extraOk++;
      }
      assert(extraOk === 9, `2.9: Payloads 400 inválidos não consumiram cota de rate limit (restantes ok=${extraOk}/9)`);
    }

    // =========================================================================
    // BLOCO 3: ENTRADAS NORMAIS, DEDUPLICAÇÃO E PRESERVAÇÃO DE DEFINIÇÕES SALVAS
    // =========================================================================
    console.log('\n--- 3. Fluxo Normal, Deduplicação e Preservação de Definições Salvas ---');
    await resetAll();
    {
      // Pré-salvar palavra com definição rica e prática
      const savedDef = 'Existing curated definition that must never be overwritten.';
      await mockDb
        .collection('users')
        .doc(STUDENT_1_UID)
        .collection('vocabulary')
        .doc('ephemeral')
        .set({
          id: 'saved_ephemeral',
          word: 'ephemeral',
          normalizedWord: 'ephemeral',
          definitionEn: savedDef,
          exampleSentenceEn: 'Fame can be ephemeral.',
          translationPt: 'efêmero',
          cefrLevel: 'C1',
          enrichmentStatus: 'enriched',
          practiceCount: 4,
          practiceHistory: [{ date: '2026-11-01', activityType: 'memorization', correct: true }],
        });

      // Simular Gemini tentando retornar também 'ephemeral' alterado
      geminiExtraInjectedWords = [
        {
          word: 'ephemeral',
          partOfSpeech: 'Noun',
          definitionEn: 'OVERWRITTEN BY GEMINI!',
          exampleSentenceEn: 'Overwritten.',
          translationPt: 'sobrescrito',
          cefrLevel: 'A1',
        },
      ];

      const resEnrich = await simulateRequest(
        'POST',
        '/api/student-dictionary/enrich',
        { Authorization: 'Bearer token-student-1' },
        {
          studentUid: STUDENT_1_UID,
          words: ['Resilience', 'resilience', 'ephemeral', 'tombstone_word'],
        }
      );

      assert(resEnrich.status === 200 && resEnrich.body?.success === true, '3.1: Enriquecimento normal retorna HTTP 200');
      assert(geminiCallCount === 1, '3.2: Chama Gemini exatamente 1 vez');
      assert(
        geminiLastPromptWords.length === 1 && geminiLastPromptWords[0] === 'Resilience',
        '3.3: Deduplica repetidas (Resilience/resilience) e ignora já salva (ephemeral) e tombstone antes do Gemini',
        `promptWords=${JSON.stringify(geminiLastPromptWords)}`
      );

      const savedVocab = await fetchStudentVocabularyFromFirestoreServer(STUDENT_1_UID, STUDENT_1_EMAIL);
      const ephemeralAfter = savedVocab.find((w: any) => w.normalizedWord === 'ephemeral');
      const resilienceAfter = savedVocab.find((w: any) => w.normalizedWord === 'resilience');

      assert(
        ephemeralAfter?.definitionEn === savedDef && ephemeralAfter?.practiceCount === 4,
        '3.4: Definição já salva e métricas de prática permanecem 100% intactas'
      );
      assert(
        Boolean(resilienceAfter?.definitionEn) && resilienceAfter?.enrichmentStatus === 'enriched',
        '3.5: Nova palavra enriquecida persistida na subcoleção canônica'
      );
      assert(
        !savedVocab.some((w: any) => w.normalizedWord === 'tombstone_word'),
        '3.6: Tombstone excluído não é ressuscitado'
      );

      // Chamada subsequente apenas com palavras já salvas -> cached: true, 0 Gemini
      const callsBeforeCached = geminiCallCount;
      const resCached = await simulateRequest(
        'POST',
        '/api/student-dictionary/enrich',
        { Authorization: 'Bearer token-student-1' },
        {
          studentUid: STUDENT_1_UID,
          words: ['resilience', 'ephemeral', 'resilience'],
        }
      );
      assert(
        resCached.status === 200 &&
          resCached.body?.cached === true &&
          resCached.body?.enrichedEntries?.length === 2 &&
          geminiCallCount === callsBeforeCached,
        '3.7: Palavras já salvas retornam cached=true deduplicado com ZERO chamadas Gemini'
      );
    }

    // =========================================================================
    // BLOCO 4: RATE LIMIT (429), ISOLAMENTO POR UID E CONTROLE DISTRIBUÍDO
    // =========================================================================
    console.log('\n--- 4. Rate Limit (429), Controle Distribuído e Isolamento por UID ---');
    await resetAll();
    {
      setDistributedCostControlForTesting(true);
      const maxAllowed = GEMINI_POLICIES.dictionary_enrich.rateLimitMaxRequests;
      assert(maxAllowed === 10, `4.1: Política dictionary_enrich rateLimitMaxRequests = 10 (atual: ${maxAllowed})`);

      let okCount = 0;
      for (let i = 1; i <= maxAllowed; i++) {
        const res = await simulateRequest(
          'POST',
          '/api/student-dictionary/enrich',
          { Authorization: 'Bearer token-student-1' },
          { studentUid: STUDENT_1_UID, words: [`dist_word_${i}`] }
        );
        if (res.status === 200) okCount++;
      }
      assert(
        okCount === maxAllowed && geminiCallCount === maxAllowed,
        `4.2: ${maxAllowed} requisições válidas dentro da janela permitidas no controle distribuído`
      );

      // Verificar gravação do documento de rate limit distribuído no Firestore
      const rateDoc = await mockDb.collection('gemini_rate_limits').doc(`${STUDENT_1_UID}__dictionary_enrich`).get();
      assert(
        rateDoc.exists && rateDoc.data()?.count === maxAllowed,
        '4.3: Contador distribuído persistido em gemini_rate_limits/{uid}__dictionary_enrich'
      );

      // 11ª requisição do mesmo UID -> 429 e ZERO Gemini
      const callsBeforeBlocked = geminiCallCount;
      const res429 = await simulateRequest(
        'POST',
        '/api/student-dictionary/enrich',
        { Authorization: 'Bearer token-student-1' },
        { studentUid: STUDENT_1_UID, words: ['over_quota_word'] }
      );
      assert(res429.status === 429, `4.4: Requisição #${maxAllowed + 1} retorna HTTP 429`, `status=${res429.status}`);
      assert(res429.body?.rateLimited === true && Number(res429.body?.retryAfterSeconds) >= 1, '4.5: Payload 429 contém rateLimited=true e retryAfterSeconds');
      assert(Boolean(res429.headers['retry-after']), '4.6: Header Retry-After presente no HTTP 429');
      assert(geminiCallCount === callsBeforeBlocked, '4.7: ZERO chamadas Gemini após bloqueio 429');

      // Palavra já salva continua funcionando com 0 Gemini mesmo com cota excedida
      const resSavedOverQuota = await simulateRequest(
        'POST',
        '/api/student-dictionary/enrich',
        { Authorization: 'Bearer token-student-1' },
        { studentUid: STUDENT_1_UID, words: ['dist_word_1'] }
      );
      assert(
        resSavedOverQuota.status === 200 && resSavedOverQuota.body?.cached === true && geminiCallCount === callsBeforeBlocked,
        '4.8: Com cota excedida, palavra já salva retorna HTTP 200 (cached) com 0 chamadas Gemini'
      );

      // Isolamento por UID: student-2 mantém cota própria independente
      const resOtherUid = await simulateRequest(
        'POST',
        '/api/student-dictionary/enrich',
        { Authorization: 'Bearer token-student-2' },
        { studentUid: STUDENT_2_UID, words: ['student2_isolated_word'] }
      );
      assert(resOtherUid.status === 200 && geminiCallCount === callsBeforeBlocked + 1, '4.9: Outro UID mantém cota independente (HTTP 200)');
    }

    // =========================================================================
    // BLOCO 5: FAIL-CLOSED (503) NA INDISPONIBILIDADE DO CONTROLE
    // =========================================================================
    console.log('\n--- 5. Fail-Closed (HTTP 503) em Indisponibilidade do Controle ---');
    await resetAll();
    {
      setDistributedCostControlForTesting(true);

      // 5A: Falha na transação do rate limiter distribuído
      mockDb.failTransactionMatcher = (paths) => paths.some((p) => p.startsWith('gemini_rate_limits/'));
      const resRateOutage = await simulateRequest(
        'POST',
        '/api/student-dictionary/enrich',
        { Authorization: 'Bearer token-student-1' },
        { studentUid: STUDENT_1_UID, words: ['outage_rate_word'] }
      );
      assert(resRateOutage.status === 503, `5.1: Falha no rate limiter distribuído retorna HTTP 503 fail-closed`, `status=${resRateOutage.status}`);
      assert(resRateOutage.body?.error === 'Service Temporarily Unavailable', '5.2: Resposta 503 padronizada');
      assert(
        !JSON.stringify(resRateOutage.body).includes('DEADLINE_EXCEEDED') &&
          !JSON.stringify(resRateOutage.body).includes('Firestore'),
        '5.3: Zero vazamento de detalhes internos de erro'
      );
      assert(geminiCallCount === 0, '5.4: ZERO chamadas Gemini durante indisponibilidade do rate limiter');

      // 5B: Falha na transação do single-flight lock distribuído
      mockDb.failTransactionMatcher = (paths) => paths.some((p) => p.startsWith('gemini_inflight_locks/'));
      const resLockOutage = await simulateRequest(
        'POST',
        '/api/student-dictionary/enrich',
        { Authorization: 'Bearer token-student-1' },
        { studentUid: STUDENT_1_UID, words: ['outage_lock_word'] }
      );
      assert(resLockOutage.status === 503, '5.5: Falha no single-flight lock distribuído retorna HTTP 503 fail-closed');
      assert(geminiCallCount === 0, '5.6: ZERO chamadas Gemini durante indisponibilidade do lock');

      // 5C: Falha síncrona em db.collection()
      setFirebaseAdminFirestoreForTesting({
        collection: () => {
          throw new Error('Unexpected synchronous client failure');
        },
      } as any);
      const resSyncThrow = await simulateRequest(
        'POST',
        '/api/student-dictionary/enrich',
        { Authorization: 'Bearer token-student-1' },
        { studentUid: STUDENT_1_UID, words: ['sync_throw_word'] }
      );
      assert(resSyncThrow.status === 503, '5.7: Falha síncrona do Firestore retorna HTTP 503 fail-closed');
      assert(geminiCallCount === 0, '5.8: ZERO chamadas Gemini após falha síncrona');

      // 5D: Firestore nulo -> HTTP 503
      setFirebaseAdminFirestoreForTesting(null);
      const resNullDb = await simulateRequest(
        'POST',
        '/api/student-dictionary/enrich',
        { Authorization: 'Bearer token-student-1' },
        { studentUid: STUDENT_1_UID, words: ['null_db_word'] }
      );
      assert(resNullDb.status === 503, '5.9: Firestore nulo retorna HTTP 503');
      assert(geminiCallCount === 0, '5.10: ZERO chamadas Gemini com Firestore nulo');
    }

    // =========================================================================
    // BLOCO 6: CONCORRÊNCIA E LIBERAÇÃO DE LOCK
    // =========================================================================
    console.log('\n--- 6. Concorrência, Single-Flight Lock e Isolamento ---');

    // 6A: 5 requisições simultâneas para o mesmo aluno -> 1 ganha (200), 4 bloqueadas (429), 1 chamada Gemini
    await resetAll();
    geminiDelayMs = 60;
    {
      const concurrentSameUser = await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          simulateRequest(
            'POST',
            '/api/student-dictionary/enrich',
            { Authorization: 'Bearer token-student-1' },
            { studentUid: STUDENT_1_UID, words: [`concurrent_word_${i}`] }
          )
        )
      );
      const okResponses = concurrentSameUser.filter((r) => r.status === 200);
      const blockedResponses = concurrentSameUser.filter((r) => r.status === 429);
      assert(
        geminiCallCount === 1 && okResponses.length === 1 && blockedResponses.length === 4,
        `6.1: 5 reqs simultâneas para o mesmo UID geram 1 chamada Gemini (200=1, 429=4)`,
        `gemini=${geminiCallCount}, 200=${okResponses.length}, 429=${blockedResponses.length}`
      );
    }

    // 6B: Concorrência entre UIDs distintos -> ambos executam sem bloqueio cruzado
    await resetAll();
    geminiDelayMs = 50;
    {
      const [resU1, resU2] = await Promise.all([
        simulateRequest(
          'POST',
          '/api/student-dictionary/enrich',
          { Authorization: 'Bearer token-student-1' },
          { studentUid: STUDENT_1_UID, words: ['cross_u1_word'] }
        ),
        simulateRequest(
          'POST',
          '/api/student-dictionary/enrich',
          { Authorization: 'Bearer token-student-2' },
          { studentUid: STUDENT_2_UID, words: ['cross_u2_word'] }
        ),
      ]);
      assert(
        resU1.status === 200 && resU2.status === 200 && geminiCallCount === 2,
        '6.2: Requisições simultâneas de UIDs distintos não sofrem bloqueio cruzado (ambas 200)'
      );
    }

    // 6C: Liberação segura do lock após falha do Gemini
    await resetAll();
    geminiShouldFail = true;
    {
      const failedRes = await simulateRequest(
        'POST',
        '/api/student-dictionary/enrich',
        { Authorization: 'Bearer token-student-1' },
        { studentUid: STUDENT_1_UID, words: ['recover_word'] }
      );
      assert(failedRes.status === 200 && failedRes.body?.enrichedEntries?.length === 0 && geminiCallCount === 1, '6.3: Falha no Gemini preserva contrato e não trava lock');

      geminiShouldFail = false;
      const recoveredRes = await simulateRequest(
        'POST',
        '/api/student-dictionary/enrich',
        { Authorization: 'Bearer token-student-1' },
        { studentUid: STUDENT_1_UID, words: ['recover_word'] }
      );
      assert(
        recoveredRes.status === 200 &&
          recoveredRes.body?.enrichedEntries?.length === 1 &&
          geminiCallCount === 2,
        '6.4: Lock liberado no finally permite nova tentativa após falha'
      );
    }

    // 6D: Rajada mista (15 requisições em lotes concorrentes) nunca ultrapassa cota de 10
    await resetAll();
    setDistributedCostControlForTesting(true);
    {
      const maxAllowed = GEMINI_POLICIES.dictionary_enrich.rateLimitMaxRequests;
      // 9 sequenciais + 6 simultâneas (total 15)
      let seqOk = 0;
      for (let i = 1; i <= 9; i++) {
        const r = await simulateRequest(
          'POST',
          '/api/student-dictionary/enrich',
          { Authorization: 'Bearer token-student-1' },
          { studentUid: STUDENT_1_UID, words: [`burst_seq_${i}`] }
        );
        if (r.status === 200) seqOk++;
      }
      geminiDelayMs = 40;
      const burstTail = await Promise.all(
        Array.from({ length: 6 }, (_, i) =>
          simulateRequest(
            'POST',
            '/api/student-dictionary/enrich',
            { Authorization: 'Bearer token-student-1' },
            { studentUid: STUDENT_1_UID, words: [`burst_tail_${i}`] }
          )
        )
      );
      const tailOk = burstTail.filter((r) => r.status === 200).length;
      const tail429 = burstTail.filter((r) => r.status === 429).length;
      assert(
        seqOk + tailOk <= maxAllowed && geminiCallCount <= maxAllowed && tail429 >= 5,
        `6.5: Rajada de 15 reqs nunca excede teto (${maxAllowed}) e bloqueia excedente com 429`,
        `ok=${seqOk + tailOk}, gemini=${geminiCallCount}, tail429=${tail429}`
      );
    }

    // 6E: Duas requisições concorrentes em que a 1ª conclui e libera o lock antes da 2ª adquirir o lock (sobreposição total)
    await resetAll();
    {
      let req1InGemini = false;
      let resolveReq1InGemini!: () => void;
      const req1InGeminiPromise = new Promise<void>((r) => {
        resolveReq1InGemini = r;
      });
      let resolveAllowReq1Finish!: () => void;
      const allowReq1FinishPromise = new Promise<void>((r) => {
        resolveAllowReq1Finish = r;
      });
      let getsSinceGemini = 0;
      let req1Promise!: Promise<{ status: number; headers: Record<string, string>; body: any }>;

      onGeminiInvocation = async (callIdx: number) => {
        if (callIdx === 1) {
          req1InGemini = true;
          resolveReq1InGemini();
          await allowReq1FinishPromise;
        }
      };

      mockDb.onDocGet = async (docPath: string) => {
        if (req1InGemini && docPath === `users/${STUDENT_1_UID}`) {
          getsSinceGemini++;
          // 1: req2 fetchStudentVocabulary, 2: req2 fetchExcludedDictionaryWords, 3: req2 pre-lock user level read
          if (getsSinceGemini === 3) {
            resolveAllowReq1Finish();
            await req1Promise;
          }
        }
      };

      req1Promise = simulateRequest(
        'POST',
        '/api/student-dictionary/enrich',
        { Authorization: 'Bearer token-student-1' },
        { studentUid: STUDENT_1_UID, words: ['race_same_word'] }
      );
      await req1InGeminiPromise;

      const req2Promise = simulateRequest(
        'POST',
        '/api/student-dictionary/enrich',
        { Authorization: 'Bearer token-student-1' },
        { studentUid: STUDENT_1_UID, words: ['race_same_word'] }
      );

      const [res1, res2] = await Promise.all([req1Promise, req2Promise]);
      const vocabAfterRace = await fetchStudentVocabularyFromFirestoreServer(STUDENT_1_UID, STUDENT_1_EMAIL);
      const savedRaceWord = vocabAfterRace.find((w: any) => w.normalizedWord === 'race_same_word');

      assert(
        res1.status === 200 && res2.status === 200,
        '6.6: Ambas requisições concorrentes (1ª conclui antes da 2ª adquirir o lock) retornam HTTP 200',
        `res1=${res1.status}, res2=${res2.status}`
      );
      assert(
        geminiCallCount === 1,
        '6.7: Revalidação após lock impede geração duplicada no Gemini (geminiCallCount === 1)',
        `geminiCallCount=${geminiCallCount}`
      );
      assert(
        res2.body?.cached === true &&
          res2.body?.enrichedEntries?.length === 1 &&
          res2.body?.enrichedEntries?.[0]?.normalizedWord === 'race_same_word' &&
          Boolean(savedRaceWord?.definitionEn),
        '6.8: Segunda requisição retorna entrada canônica já persistida com cached=true'
      );
    }

    // 6F: Duas requisições concorrentes com sobreposição parcial — 2ª processa apenas palavras ainda não enriquecidas
    await resetAll();
    {
      let req1InGemini = false;
      let resolveReq1InGemini!: () => void;
      const req1InGeminiPromise = new Promise<void>((r) => {
        resolveReq1InGemini = r;
      });
      let resolveAllowReq1Finish!: () => void;
      const allowReq1FinishPromise = new Promise<void>((r) => {
        resolveAllowReq1Finish = r;
      });
      let getsSinceGemini = 0;
      let req1Promise!: Promise<{ status: number; headers: Record<string, string>; body: any }>;

      onGeminiInvocation = async (callIdx: number) => {
        if (callIdx === 1) {
          req1InGemini = true;
          resolveReq1InGemini();
          await allowReq1FinishPromise;
        }
      };

      mockDb.onDocGet = async (docPath: string) => {
        if (req1InGemini && docPath === `users/${STUDENT_1_UID}`) {
          getsSinceGemini++;
          if (getsSinceGemini === 3) {
            resolveAllowReq1Finish();
            await req1Promise;
          }
        }
      };

      req1Promise = simulateRequest(
        'POST',
        '/api/student-dictionary/enrich',
        { Authorization: 'Bearer token-student-1' },
        { studentUid: STUDENT_1_UID, words: ['partial_shared'] }
      );
      await req1InGeminiPromise;

      const req2Promise = simulateRequest(
        'POST',
        '/api/student-dictionary/enrich',
        { Authorization: 'Bearer token-student-1' },
        { studentUid: STUDENT_1_UID, words: ['partial_shared', 'partial_only_2'] }
      );

      const [res1, res2] = await Promise.all([req1Promise, req2Promise]);
      const vocabAfterPartial = await fetchStudentVocabularyFromFirestoreServer(STUDENT_1_UID, STUDENT_1_EMAIL);
      const sharedDoc = vocabAfterPartial.find((w: any) => w.normalizedWord === 'partial_shared');
      const only2Doc = vocabAfterPartial.find((w: any) => w.normalizedWord === 'partial_only_2');

      assert(
        res1.status === 200 && res2.status === 200 && geminiCallCount === 2,
        '6.9: Sobreposição parcial chama Gemini uma vez por palavra nova restante',
        `res1=${res1.status}, res2=${res2.status}, gemini=${geminiCallCount}`
      );
      assert(
        geminiLastPromptWords.length === 1 && geminiLastPromptWords[0] === 'partial_only_2',
        '6.10: Segunda requisição envia ao Gemini somente a palavra ainda não enriquecida (partial_only_2)',
        `promptWords=${JSON.stringify(geminiLastPromptWords)}`
      );
      assert(
        Boolean(sharedDoc?.definitionEn) && Boolean(only2Doc?.definitionEn),
        '6.11: Ambas palavras persistem corretamente no Firestore canônico'
      );
    }

    // 6G: Exclusão (tombstone) aplicada antes da aquisição do lock impede chamada Gemini e ressurreição
    await resetAll();
    {
      let getsCount = 0;
      mockDb.onDocGet = async (docPath: string) => {
        if (docPath === `users/${STUDENT_1_UID}`) {
          getsCount++;
          // 1: fetchStudentVocabulary, 2: fetchExcludedDictionaryWords, 3: pre-lock user level read
          if (getsCount === 3) {
            await mockDb.collection('users').doc(STUDENT_1_UID).update({
              excludedDictionaryWords: ['tombstone_word', 'concurrent_tombstone'],
            });
          }
        }
      };

      const resTombstoneRace = await simulateRequest(
        'POST',
        '/api/student-dictionary/enrich',
        { Authorization: 'Bearer token-student-1' },
        { studentUid: STUDENT_1_UID, words: ['concurrent_tombstone'] }
      );
      const vocabAfterTombstone = await fetchStudentVocabularyFromFirestoreServer(STUDENT_1_UID, STUDENT_1_EMAIL);

      assert(
        resTombstoneRace.status === 200 &&
          resTombstoneRace.body?.cached === true &&
          resTombstoneRace.body?.enrichedEntries?.length === 0 &&
          geminiCallCount === 0,
        '6.12: Palavra excluída entre pré-checagem e lock não chama Gemini e retorna cached=true vazio',
        `status=${resTombstoneRace.status}, gemini=${geminiCallCount}`
      );
      assert(
        !vocabAfterTombstone.some((w: any) => w.normalizedWord === 'concurrent_tombstone'),
        '6.13: Tombstone concorrente não é ressuscitado no Firestore'
      );
    }
  } finally {
    (globalThis as any).fetch = originalFetch;
    await resetAll();
  }

  console.log('\n=========================================================================');
  console.log(`TOTAL DE TESTES EXECUTADOS: ${passed + failed}`);
  console.log(`SUCESSO: ${passed}`);
  console.log(`FALHAS: ${failed}`);
  console.log('=========================================================================');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runDictionaryEnrichBoundsTests().catch((err) => {
  console.error('Erro fatal executando testes AI.BOUNDS.2B:', err);
  process.exit(1);
});
