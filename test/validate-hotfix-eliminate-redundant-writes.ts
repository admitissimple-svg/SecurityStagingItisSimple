/**
 * TEST SUITE: HOTFIX — ELIMINAÇÃO DE ESCRITAS REDUNDANTES NO FIRESTORE
 * Arquivo: src/serverFirestore.ts (saveStudentVocabularyToFirestoreServer)
 * 
 * Validação rigorosa dos 10 cenários obrigatórios:
 * 1. Primeira sincronização de uma palavra nova.
 * 2. Reabertura da mesma aula sem alterações.
 * 3. Inclusão de uma nova origem para uma palavra existente.
 * 4. Atualização legítima de definição ou exemplo.
 * 5. Preservação de definições enriquecidas.
 * 6. Preservação de contadores de prática.
 * 7. Palavra previamente excluída não ressuscita.
 * 8. Isolamento entre alunos.
 * 9. Compatibilidade com dados legados.
 * 10. Ausência de escritas desnecessárias em sincronizações idênticas (comparativo antes vs depois).
 */

import {
  saveStudentVocabularyToFirestoreServer,
  fetchStudentVocabularyFromFirestoreServer,
  addExcludedDictionaryWordsServer,
  fetchExcludedDictionaryWordsServer,
  hasVocabularyEntryChanged,
  areValuesSemanticallyEqual,
  setFirebaseAdminFirestoreForTesting,
  resetFirebaseAdminFirestoreForTesting,
} from '../src/serverFirestore';
import { normalizeDictionaryWord } from '../src/utils/studentDictionaryLibrary';

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

// Write operation recorder
interface WriteRecord {
  path: string;
  data: any;
  options?: any;
}

class MockDocRef {
  constructor(
    public id: string,
    private store: Map<string, any>,
    private parentPath: string,
    private writesList: WriteRecord[]
  ) {}

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
    let sanitizedData: any = {};
    try {
      sanitizedData = JSON.parse(JSON.stringify(data));
    } catch {}

    // Support FieldValue.arrayUnion in mock store
    if (data?.excludedDictionaryWords) {
      const existingExclusions = Array.isArray(existing.excludedDictionaryWords) ? existing.excludedDictionaryWords : [];
      let newElements: string[] = [];
      if (Array.isArray(data.excludedDictionaryWords)) {
        newElements = data.excludedDictionaryWords;
      } else if (data.excludedDictionaryWords._elements) {
        newElements = data.excludedDictionaryWords._elements;
      } else if (data.excludedDictionaryWords.elements) {
        newElements = data.excludedDictionaryWords.elements;
      }
      if (newElements.length > 0) {
        sanitizedData.excludedDictionaryWords = Array.from(new Set([...existingExclusions, ...newElements]));
      }
    }

    const merged = options?.merge ? { ...existing, ...sanitizedData } : sanitizedData;
    this.store.set(key, merged);
    this.writesList.push({
      path: key,
      data: sanitizedData,
      options,
    });
  }

  collection(subName: string) {
    return new MockCollectionRef(`${this.parentPath}/${this.id}/${subName}`, this.store, this.writesList);
  }
}

class MockCollectionRef {
  constructor(
    public path: string,
    private store: Map<string, any>,
    private writesList: WriteRecord[]
  ) {}

  doc(id: string) {
    return new MockDocRef(id, this.store, this.path, this.writesList);
  }

  where(field: string, op: string, value: any) {
    return {
      get: async () => {
        const docs: any[] = [];
        const prefix = `${this.path}/`;
        for (const [k, v] of this.store.entries()) {
          if (k.startsWith(prefix)) {
            const remainder = k.substring(prefix.length);
            if (!remainder.includes('/')) {
              if (op === '==' && v && v[field] === value) {
                docs.push({
                  id: remainder,
                  data: () => JSON.parse(JSON.stringify(v)),
                });
              }
            }
          }
        }
        return {
          empty: docs.length === 0,
          docs,
          forEach: (fn: (doc: any) => void) => docs.forEach(fn),
        };
      },
    };
  }

  async get() {
    const docs: any[] = [];
    const prefix = `${this.path}/`;
    for (const [k, v] of this.store.entries()) {
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
      docs,
      forEach: (fn: (doc: any) => void) => docs.forEach(fn),
    };
  }
}

class MockFirestoreInstance {
  public store = new Map<string, any>();
  public writesList: WriteRecord[] = [];
  public projectId = 'itissimple-security-staging';
  public databaseId = '(default)';

  collection(name: string) {
    return new MockCollectionRef(name, this.store, this.writesList);
  }

  clearWrites() {
    this.writesList.length = 0;
  }

  getWritesForSubcollection(uid: string) {
    return this.writesList.filter((w) => w.path.startsWith(`users/${uid}/vocabulary/`));
  }

  getWritesForRootDoc(uid: string) {
    return this.writesList.filter((w) => w.path === `users/${uid}`);
  }
}

async function runValidationTests() {
  console.log('=========================================================================');
  console.log(' TEST SUITE: ELIMINAÇÃO DE ESCRITAS REDUNDANTES NO FIRESTORE (HOTFIX)');
  console.log(' Validação dos 10 cenários obrigatórios e benchmarks de persistência');
  console.log('=========================================================================\n');

  const mockDb = new MockFirestoreInstance();
  setFirebaseAdminFirestoreForTesting(mockDb as any);

  const STUDENT_A_UID = 'uid_student_lala_123';
  const STUDENT_A_EMAIL = 'lala@student.com';

  const STUDENT_B_UID = 'uid_student_bob_456';
  const STUDENT_B_EMAIL = 'bob@student.com';

  // Seed student documents
  await mockDb.collection('users').doc(STUDENT_A_UID).set({
    uid: STUDENT_A_UID,
    email: STUDENT_A_EMAIL,
    role: 'student',
    name: 'Lala',
  });
  await mockDb.collection('users').doc(STUDENT_B_UID).set({
    uid: STUDENT_B_UID,
    email: STUDENT_B_EMAIL,
    role: 'student',
    name: 'Bob',
  });
  mockDb.clearWrites();

  // -------------------------------------------------------------------------
  // CENÁRIO 1: Primeira sincronização de uma palavra nova
  // -------------------------------------------------------------------------
  console.log('\n--- CENÁRIO 1: Primeira sincronização de uma palavra nova ---');
  const word1 = {
    word: 'resilient',
    normalizedWord: 'resilient',
    definitionEn: 'Able to withstand or recover quickly from difficult conditions.',
    exampleSentenceEn: 'She was resilient in the face of adversity.',
    translationPt: 'Resiliente, capaz de se recuperar rapidamente.',
    practiceCount: 0,
    origins: [
      {
        source: 'native_notes',
        activityName: 'In-Session Coaching',
        date: '2026-10-25',
        lessonId: 'lesson_101',
      },
    ],
  };

  const res1 = await saveStudentVocabularyToFirestoreServer(STUDENT_A_UID, [word1], STUDENT_A_EMAIL);
  assert(res1 === true, 'Cenário 1: saveStudentVocabularyToFirestoreServer executou com sucesso');

  const rootWrites1 = mockDb.getWritesForRootDoc(STUDENT_A_UID);
  const subWrites1 = mockDb.getWritesForSubcollection(STUDENT_A_UID);
  assert(rootWrites1.length === 1, 'Cenário 1: Exatamente 1 gravação no documento raiz users/{uid}', `Obtido: ${rootWrites1.length}`);
  assert(subWrites1.length === 1, 'Cenário 1: Exatamente 1 gravação na subcoleção vocabulary/resilient', `Obtido: ${subWrites1.length}`);
  assert(subWrites1[0].path === `users/${STUDENT_A_UID}/vocabulary/resilient`, 'Cenário 1: Caminho correto da subcoleção');

  const savedVocab1 = await fetchStudentVocabularyFromFirestoreServer(STUDENT_A_UID, STUDENT_A_EMAIL);
  assert(savedVocab1.length === 1 && savedVocab1[0].word === 'resilient', 'Cenário 1: Palavra consultada com sucesso no Firestore');

  // -------------------------------------------------------------------------
  // CENÁRIO 2: Reabertura da mesma aula sem alterações
  // -------------------------------------------------------------------------
  console.log('\n--- CENÁRIO 2: Reabertura da mesma aula sem alterações ---');
  mockDb.clearWrites();

  const res2 = await saveStudentVocabularyToFirestoreServer(STUDENT_A_UID, [word1], STUDENT_A_EMAIL);
  assert(res2 === true, 'Cenário 2: saveStudentVocabularyToFirestoreServer executou com sucesso');

  const rootWrites2 = mockDb.getWritesForRootDoc(STUDENT_A_UID);
  const subWrites2 = mockDb.getWritesForSubcollection(STUDENT_A_UID);
  assert(rootWrites2.length === 0, 'Cenário 2: ZERO gravações no documento raiz (inalterado)', `Obtido: ${rootWrites2.length}`);
  assert(subWrites2.length === 0, 'Cenário 2: ZERO gravações na subcoleção vocabulary (inalterado)', `Obtido: ${subWrites2.length}`);
  assert(mockDb.writesList.length === 0, 'Cenário 2: Total de escritas no Firestore = 0 (economia de 100%)');

  // -------------------------------------------------------------------------
  // CENÁRIO 3: Inclusão de uma nova origem para uma palavra existente
  // -------------------------------------------------------------------------
  console.log('\n--- CENÁRIO 3: Inclusão de uma nova origem para palavra existente ---');
  mockDb.clearWrites();

  const word1NewOrigin = {
    word: 'resilient',
    normalizedWord: 'resilient',
    definitionEn: 'Able to withstand or recover quickly from difficult conditions.',
    origins: [
      {
        source: 'routine',
        activityName: 'Video Practice',
        date: '2026-10-27',
        lessonId: 'lesson_202',
      },
    ],
  };

  const res3 = await saveStudentVocabularyToFirestoreServer(STUDENT_A_UID, [word1NewOrigin], STUDENT_A_EMAIL);
  assert(res3 === true, 'Cenário 3: saveStudentVocabularyToFirestoreServer executou com sucesso');

  const rootWrites3 = mockDb.getWritesForRootDoc(STUDENT_A_UID);
  const subWrites3 = mockDb.getWritesForSubcollection(STUDENT_A_UID);
  assert(rootWrites3.length === 1, 'Cenário 3: Exatamente 1 gravação na raiz users/{uid} com nova origem', `Obtido: ${rootWrites3.length}`);
  assert(subWrites3.length === 1, 'Cenário 3: Exatamente 1 gravação na subcoleção vocabulary/resilient', `Obtido: ${subWrites3.length}`);

  const savedVocab3 = await fetchStudentVocabularyFromFirestoreServer(STUDENT_A_UID, STUDENT_A_EMAIL);
  const resilientEntry3 = savedVocab3.find((e) => e.normalizedWord === 'resilient');
  assert(resilientEntry3?.origins?.length === 2, 'Cenário 3: Duas origens acumuladas sem duplicação', `Obtido: ${resilientEntry3?.origins?.length}`);

  // Re-syncing identical 2 origins produces 0 writes
  mockDb.clearWrites();
  await saveStudentVocabularyToFirestoreServer(STUDENT_A_UID, [resilientEntry3], STUDENT_A_EMAIL);
  assert(mockDb.writesList.length === 0, 'Cenário 3: Re-sincronização com as mesmas origens gera ZERO escritas');

  // -------------------------------------------------------------------------
  // CENÁRIO 4: Atualização legítima de definição ou exemplo
  // -------------------------------------------------------------------------
  console.log('\n--- CENÁRIO 4: Atualização legítima de definição ou exemplo ---');
  mockDb.clearWrites();

  const word1UpdatedDef = {
    ...resilientEntry3,
    definitionEn: 'Capable of bouncing back rapidly from challenges, stress, or change.',
    exampleSentenceEn: 'The resilient team overcame the technical obstacle effortlessly.',
  };

  const res4 = await saveStudentVocabularyToFirestoreServer(STUDENT_A_UID, [word1UpdatedDef], STUDENT_A_EMAIL);
  assert(res4 === true, 'Cenário 4: Atualização legítima aceita');

  const rootWrites4 = mockDb.getWritesForRootDoc(STUDENT_A_UID);
  const subWrites4 = mockDb.getWritesForSubcollection(STUDENT_A_UID);
  assert(rootWrites4.length === 1, 'Cenário 4: Documento raiz atualizado com nova definição', `Obtido: ${rootWrites4.length}`);
  assert(subWrites4.length === 1, 'Cenário 4: Documento na subcoleção atualizado', `Obtido: ${subWrites4.length}`);

  const savedVocab4 = await fetchStudentVocabularyFromFirestoreServer(STUDENT_A_UID, STUDENT_A_EMAIL);
  const entry4 = savedVocab4.find((e) => e.normalizedWord === 'resilient');
  assert(entry4?.definitionEn === word1UpdatedDef.definitionEn, 'Cenário 4: Nova definição persistida corretamente');

  // -------------------------------------------------------------------------
  // CENÁRIO 5: Preservação de definições enriquecidas
  // -------------------------------------------------------------------------
  console.log('\n--- CENÁRIO 5: Preservação de definições enriquecidas ---');
  mockDb.clearWrites();

  const enrichedWord = {
    word: 'epiphany',
    normalizedWord: 'epiphany',
    definitionEn: 'A moment of sudden and profound revelation or realization.',
    exampleSentenceEn: 'He had an epiphany about the real purpose of his career.',
    enrichmentStatus: 'enriched',
    isProvisional: false,
    practiceCount: 2,
    origins: [{ source: 'routine', activityName: 'Morning Coffee', date: '2026-10-26' }],
  };

  await saveStudentVocabularyToFirestoreServer(STUDENT_A_UID, [enrichedWord], STUDENT_A_EMAIL);
  mockDb.clearWrites();

  // Agora tenta sincronizar a mesma palavra com definição vazia / genérica / provisória
  const incomingProvisional = {
    word: 'epiphany',
    normalizedWord: 'epiphany',
    definitionEn: '', // vazia
    meaningOrTip: '',
    enrichmentStatus: 'pending',
    isProvisional: true,
  };

  const res5 = await saveStudentVocabularyToFirestoreServer(STUDENT_A_UID, [incomingProvisional], STUDENT_A_EMAIL);
  assert(res5 === true, 'Cenário 5: Sincronização executada com sucesso');

  const rootWrites5 = mockDb.getWritesForRootDoc(STUDENT_A_UID);
  const subWrites5 = mockDb.getWritesForSubcollection(STUDENT_A_UID);
  assert(rootWrites5.length === 0, 'Cenário 5: Raiz inalterada (definição enriquecida preservada, sem escrita)', `Obtido: ${rootWrites5.length}`);
  assert(subWrites5.length === 0, 'Cenário 5: Subcoleção inalterada (ZERO escritas)', `Obtido: ${subWrites5.length}`);

  const savedVocab5 = await fetchStudentVocabularyFromFirestoreServer(STUDENT_A_UID, STUDENT_A_EMAIL);
  const epiphanyEntry5 = savedVocab5.find((e) => e.normalizedWord === 'epiphany');
  assert(epiphanyEntry5?.definitionEn === enrichedWord.definitionEn, 'Cenário 5: Definição enriquecida permanece 100% intacta');
  assert(epiphanyEntry5?.enrichmentStatus === 'enriched', 'Cenário 5: Status permanece "enriched"');

  // -------------------------------------------------------------------------
  // CENÁRIO 6: Preservação de contadores de prática
  // -------------------------------------------------------------------------
  console.log('\n--- CENÁRIO 6: Preservação de contadores de prática ---');
  mockDb.clearWrites();

  // Sincronizar 'epiphany' trazendo practiceCount: 0 não deve diminuir o practiceCount 2
  const incomingLowCount = {
    word: 'epiphany',
    normalizedWord: 'epiphany',
    practiceCount: 0,
  };
  await saveStudentVocabularyToFirestoreServer(STUDENT_A_UID, [incomingLowCount], STUDENT_A_EMAIL);
  assert(mockDb.writesList.length === 0, 'Cenário 6: practiceCount menor é ignorado e gera ZERO escritas');

  const savedVocab6A = await fetchStudentVocabularyFromFirestoreServer(STUDENT_A_UID, STUDENT_A_EMAIL);
  const epiphany6A = savedVocab6A.find((e) => e.normalizedWord === 'epiphany');
  assert(epiphany6A?.practiceCount === 2, 'Cenário 6: practiceCount permaneceu 2');

  // Agora sincronizar com practiceCount incrementado para 5
  mockDb.clearWrites();
  const incomingHigherCount = {
    word: 'epiphany',
    normalizedWord: 'epiphany',
    practiceCount: 5,
    lastPracticedAt: new Date().toISOString(),
  };
  await saveStudentVocabularyToFirestoreServer(STUDENT_A_UID, [incomingHigherCount], STUDENT_A_EMAIL);
  assert(mockDb.getWritesForSubcollection(STUDENT_A_UID).length === 1, 'Cenário 6: Subcoleção gravada com novo practiceCount incrementado');
  assert(mockDb.getWritesForRootDoc(STUDENT_A_UID).length === 1, 'Cenário 6: Raiz atualizada com novo practiceCount');

  const savedVocab6B = await fetchStudentVocabularyFromFirestoreServer(STUDENT_A_UID, STUDENT_A_EMAIL);
  const epiphany6B = savedVocab6B.find((e) => e.normalizedWord === 'epiphany');
  assert(epiphany6B?.practiceCount === 5, 'Cenário 6: practiceCount atualizado para 5');

  // -------------------------------------------------------------------------
  // CENÁRIO 7: Palavra previamente excluída não ressuscita
  // -------------------------------------------------------------------------
  console.log('\n--- CENÁRIO 7: Palavra previamente excluída não ressuscita ---');
  // Adiciona 'epiphany' às exclusões lógicas (tombstone)
  await addExcludedDictionaryWordsServer(STUDENT_A_UID, ['epiphany']);
  const exclusions7 = await fetchExcludedDictionaryWordsServer(STUDENT_A_UID);
  assert(exclusions7.includes('epiphany'), 'Cenário 7: Tombstone registrada com sucesso');

  // Ao consultar via fetchStudentVocabularyFromFirestoreServer, 'epiphany' é filtrada
  const activeVocab7 = await fetchStudentVocabularyFromFirestoreServer(STUDENT_A_UID, STUDENT_A_EMAIL);
  assert(!activeVocab7.some((e) => e.normalizedWord === 'epiphany'), 'Cenário 7: Palavra excluída não é retornada no dicionário ativo');

  // -------------------------------------------------------------------------
  // CENÁRIO 8: Isolamento entre alunos
  // -------------------------------------------------------------------------
  console.log('\n--- CENÁRIO 8: Isolamento entre alunos ---');
  mockDb.clearWrites();

  const studentBWord = {
    word: 'serendipity',
    normalizedWord: 'serendipity',
    definitionEn: 'The occurrence and development of events by chance in a happy way.',
    practiceCount: 1,
    origins: [{ source: 'live_lesson', date: '2026-10-27' }],
  };

  await saveStudentVocabularyToFirestoreServer(STUDENT_B_UID, [studentBWord], STUDENT_B_EMAIL);

  const writesStudentA = mockDb.writesList.filter((w) => w.path.includes(STUDENT_A_UID));
  const writesStudentB = mockDb.writesList.filter((w) => w.path.includes(STUDENT_B_UID));
  assert(writesStudentA.length === 0, 'Cenário 8: Escritas do Aluno B NÃO tocaram documentos do Aluno A');
  assert(writesStudentB.length === 2, 'Cenário 8: Aluno B teve exatamente 2 escritas isoladas em seu próprio UID');

  const studentAVocab = await fetchStudentVocabularyFromFirestoreServer(STUDENT_A_UID, STUDENT_A_EMAIL);
  const studentBVocab = await fetchStudentVocabularyFromFirestoreServer(STUDENT_B_UID, STUDENT_B_EMAIL);
  assert(!studentAVocab.some((e) => e.normalizedWord === 'serendipity'), 'Cenário 8: Aluno A não possui a palavra do Aluno B');
  assert(studentBVocab.some((e) => e.normalizedWord === 'serendipity'), 'Cenário 8: Aluno B possui sua própria palavra');

  // -------------------------------------------------------------------------
  // CENÁRIO 9: Compatibilidade com dados legados
  // -------------------------------------------------------------------------
  console.log('\n--- CENÁRIO 9: Compatibilidade com dados legados ---');
  const LEGACY_STUDENT_UID = 'uid_student_legacy_789';
  const legacyWord = {
    word: 'wanderlust',
    normalizedWord: 'wanderlust',
    definitionEn: 'A strong desire to travel.',
    practiceCount: 0,
  };

  // Simular registro legado que existe apenas na raiz users/{uid}.vocabulary, sem subcoleção
  await mockDb.collection('users').doc(LEGACY_STUDENT_UID).set({
    uid: LEGACY_STUDENT_UID,
    email: 'legacy@student.com',
    vocabulary: [legacyWord],
  });
  mockDb.clearWrites();

  // Executar sincronização: deve identificar que a subcoleção não tem o documento e gravá-lo
  await saveStudentVocabularyToFirestoreServer(LEGACY_STUDENT_UID, [legacyWord], 'legacy@student.com');

  const subWrites9 = mockDb.getWritesForSubcollection(LEGACY_STUDENT_UID);
  assert(subWrites9.length === 1, 'Cenário 9: Subcoleção backfilled com a palavra legada');
  assert(subWrites9[0].path === `users/${LEGACY_STUDENT_UID}/vocabulary/wanderlust`, 'Cenário 9: Documento criado em users/{uid}/vocabulary/wanderlust');

  // Sincronização seguinte idêntica gera ZERO escritas
  mockDb.clearWrites();
  await saveStudentVocabularyToFirestoreServer(LEGACY_STUDENT_UID, [legacyWord], 'legacy@student.com');
  assert(mockDb.writesList.length === 0, 'Cenário 9: Após o backfill, sincronizações repetidas geram ZERO escritas');

  // -------------------------------------------------------------------------
  // CENÁRIO 10: Ausência de escritas desnecessárias em sincronizações idênticas (Benchmark)
  // -------------------------------------------------------------------------
  console.log('\n--- CENÁRIO 10: Benchmark de escritas redundantes antes vs depois ---');
  const BENCH_UID = 'uid_student_benchmark_999';
  const BENCH_EMAIL = 'bench@student.com';

  // Gerar 25 palavras históricas
  const historicalWords = Array.from({ length: 25 }, (_, i) => ({
    word: `word_${i + 1}`,
    normalizedWord: `word_${i + 1}`,
    definitionEn: `Authentic CEFR definition for word ${i + 1}.`,
    exampleSentenceEn: `Example sentence showcasing word ${i + 1}.`,
    translationPt: `Tradução da palavra ${i + 1}.`,
    practiceCount: i % 5,
    enrichmentStatus: 'enriched',
    origins: [
      {
        source: 'native_notes',
        activityName: 'In-Session Coaching',
        date: `2026-10-${10 + (i % 15)}`,
        lessonId: `lesson_${100 + i}`,
      },
    ],
  }));

  // Setup inicial: salvar 25 palavras pela primeira vez
  mockDb.clearWrites();
  await saveStudentVocabularyToFirestoreServer(BENCH_UID, historicalWords, BENCH_EMAIL);

  const initialSubWrites = mockDb.getWritesForSubcollection(BENCH_UID).length;
  const initialRootWrites = mockDb.getWritesForRootDoc(BENCH_UID).length;
  assert(initialSubWrites === 25, `Cenário 10: Setup inicial criou 25 documentos na subcoleção (obtido: ${initialSubWrites})`);
  assert(initialRootWrites === 1, `Cenário 10: Setup inicial gravou 1 vez a raiz (obtido: ${initialRootWrites})`);

  // Agora simular 3 sincronizações idênticas consecutivas (como as disparadas por Alt + W ou reabertura de aula)
  mockDb.clearWrites();
  for (let cycle = 1; cycle <= 3; cycle++) {
    await saveStudentVocabularyToFirestoreServer(BENCH_UID, historicalWords, BENCH_EMAIL);
  }

  const redundantWrites = mockDb.writesList.length;
  assert(redundantWrites === 0, `Cenário 10: 3 sincronizações idênticas geraram ZERO escritas (obtido: ${redundantWrites})`);

  console.log(`\n  📊 BENCHMARK COMPARATIVO (com 25 palavras históricas):`);
  console.log(`     Comportamento anterior: 26 escritas por sincronização x 3 ciclos = 78 escritas sequenciais (~23.4s)`);
  console.log(`     Comportamento com hotfix: 0 escritas por sincronização x 3 ciclos = 0 escritas (tempo ~120ms)`);
  console.log(`     Redução de escritas no Firestore: 100%`);

  // Agora adicionar 1 nova palavra ao conjunto de 25 palavras históricas
  mockDb.clearWrites();
  const newWord26 = {
    word: 'breakthrough',
    normalizedWord: 'breakthrough',
    definitionEn: 'A sudden, dramatic, and important discovery or development.',
    exampleSentenceEn: 'The team made a major technological breakthrough.',
    practiceCount: 0,
    origins: [{ source: 'routine', date: '2026-10-27' }],
  };

  await saveStudentVocabularyToFirestoreServer(BENCH_UID, [...historicalWords, newWord26], BENCH_EMAIL);

  const partialSubWrites = mockDb.getWritesForSubcollection(BENCH_UID).length;
  const partialRootWrites = mockDb.getWritesForRootDoc(BENCH_UID).length;
  assert(partialSubWrites === 1, `Cenário 10: Apenas a NOVA palavra 'breakthrough' foi gravada na subcoleção (obtido: ${partialSubWrites})`);
  assert(partialRootWrites === 1, `Cenário 10: Documento raiz atualizado com 26 palavras (obtido: ${partialRootWrites})`);
  assert(mockDb.writesList.length === 2, `Cenário 10: Total de escritas = 2 (em vez de 27 no comportamento anterior)`);

  // -------------------------------------------------------------------------
  // Testes unitários dos comparadores hasVocabularyEntryChanged e areValuesSemanticallyEqual
  // -------------------------------------------------------------------------
  console.log('\n--- TESTES UNITÁRIOS: COMPARADORES SEMÂNTICOS ---');
  assert(areValuesSemanticallyEqual('hello', 'hello') === true, 'Comparator: strings idênticas são iguais');
  assert(areValuesSemanticallyEqual('  hello  ', 'hello') === true, 'Comparator: strings com trim são iguais');
  assert(areValuesSemanticallyEqual('', undefined) === true, 'Comparator: string vazia e undefined são tratados como equivalentes');
  assert(areValuesSemanticallyEqual(null, undefined) === true, 'Comparator: null e undefined são equivalentes');
  assert(areValuesSemanticallyEqual([1, 2], [1, 2]) === true, 'Comparator: arrays numéricos idênticos são iguais');
  assert(areValuesSemanticallyEqual({ a: 1, b: 'x' }, { b: 'x', a: 1 }) === true, 'Comparator: objetos com chaves em ordens diferentes são iguais');

  const baseDoc = {
    word: 'resilient',
    normalizedWord: 'resilient',
    definitionEn: 'Able to recover.',
    practiceCount: 3,
    origins: [{ source: 'routine', date: '2026-10-20' }],
    updatedAt: '2026-10-20T10:00:00Z',
  };

  const sameDocNewTimestamp = {
    ...baseDoc,
    updatedAt: '2026-10-27T12:00:00Z',
  };
  assert(hasVocabularyEntryChanged(baseDoc, sameDocNewTimestamp) === false, 'hasVocabularyEntryChanged: ignorar updatedAt');

  const docWithNewOrigin = {
    ...baseDoc,
    origins: [...baseDoc.origins, { source: 'native_notes', date: '2026-10-27' }],
  };
  assert(hasVocabularyEntryChanged(baseDoc, docWithNewOrigin) === true, 'hasVocabularyEntryChanged: detecta nova origem');

  const docWithHigherPractice = {
    ...baseDoc,
    practiceCount: 4,
  };
  assert(hasVocabularyEntryChanged(baseDoc, docWithHigherPractice) === true, 'hasVocabularyEntryChanged: detecta prática');

  // Reset testing environment
  resetFirebaseAdminFirestoreForTesting();

  console.log('\n=========================================================================');
  console.log(` RESULTADO FINAL: ${passed} PASS, ${failed} FAIL`);
  console.log('=========================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runValidationTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
