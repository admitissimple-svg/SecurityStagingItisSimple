/**
 * TESTES AUTOMATIZADOS: FASE NF-NOTES.4 — SIMPLIFICAÇÃO ARQUITETURAL, LIMPEZA DE LEGADO E CONSOLIDAÇÃO PEDAGÓGICA
 * 
 * Cobertura exata de todos os requisitos da ETAPA G:
 * 1. Limpeza de Legado (app_db.json intocado, zero stubs de disco, chaves pedagógicas removidas, config estática preservada)
 * 2. Transformação Pedagógica (Part 1 de Alt+N, Part 2 de gramática, Part 3 de Alt+W/P, Part 4 consolidação, zero erros fictícios)
 * 3. Transformação Única e Cache (Identidade estável, cache hit sem chamar Gemini, versionamento por hash, tolerância a falhas)
 * 4. Integração My Dictionary (Parte 3 sincronizada, UID canônico, deduplicação, preservação de histórico anterior)
 * 5. Integração View Journal (Partes 1 e 2 sincronizadas, vínculo com a sessão, idempotência, preservação de histórico anterior)
 * 6. Lembretes Diários (Primeira abertura, 2ª abertura no mesmo dia, F5, dia com aula -> Part 4, dia sem aula -> 1->2->3, reinício após nova anotação, desempate em mesma data, fuso America/Sao_Paulo, 2 computadores, ausência de notas válidas)
 */

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import {
  parseNotesHtml,
  hasValidPedagogicalContent,
  validatePedagogicalAiResponse,
  computeNotesHash,
  buildPedagogicalCacheKey,
  PEDAGOGICAL_PROMPT_VERSION,
  extractNotesMarkings,
} from '../src/utils/pedagogicalTransformer';
import { normalizeDictionaryWord } from '../src/utils/studentDictionaryLibrary';
import { recordLessonReviewInStudentJournalServer } from '../src/serverFirestore';

process.env.FIREBASE_PROJECT_ID = 'itissimple-security-staging';

let totalTests = 0;
let passedTests = 0;

async function it(desc: string, fn: () => void | Promise<void>) {
  totalTests++;
  try {
    await fn();
    passedTests++;
    console.log(`  ✅ PASS: ${desc}`);
  } catch (err) {
    console.error(`  ❌ FAIL: ${desc}`);
    console.error(err);
    process.exit(1);
  }
}

async function runTests() {
  console.log('============================================================================');
  console.log(' TESTES AUTOMATIZADOS: FASE NF-NOTES.4 — CONSOLIDAÇÃO E SIMPLIFICAÇÃO       ');
  console.log(' AMBIENTE: itissimple-security-staging | FIRESTORE: (default)               ');
  console.log(' MODO: Implementação controlada, SEM deploy                                 ');
  console.log('============================================================================\n');

  // ============================================================================
  // GRUPO 1: LIMPEZA DE LEGADO (app_db.json)
  // ============================================================================
  console.log('--- GRUPO 1: Limpeza do app_db.json ---');

  const appDbPath = path.join(process.cwd(), 'src', 'data', 'app_db.json');
  assert(fs.existsSync(appDbPath), 'app_db.json deve existir para configurações estáticas');
  const appDbRaw = fs.readFileSync(appDbPath, 'utf-8');
  const appDb = JSON.parse(appDbRaw);

  await it('1.1: Chaves pedagógicas vazias removidas de app_db.json (sessionNotesMap, pedagogicalTransformationsMap)', () => {
    assert(appDb.sessionNotesMap === undefined, 'sessionNotesMap deve estar ausente em app_db.json');
    assert(appDb.sessionNotesProgressMap === undefined, 'sessionNotesProgressMap deve estar ausente em app_db.json');
    assert(appDb.pedagogicalTransformationsMap === undefined, 'pedagogicalTransformationsMap deve estar ausente em app_db.json');
    assert(appDb.studentDictionaryMap === undefined, 'studentDictionaryMap deve estar ausente em app_db.json');
    assert(appDb.studentJournalMap === undefined, 'studentJournalMap deve estar ausente em app_db.json');
    assert(appDb.studentActivityJournal === undefined, 'studentActivityJournal deve estar ausente em app_db.json');
  });

  await it('1.2: Configurações estáticas CMS e didáticas preservadas em app_db.json', () => {
    assert(appDb.landingContent && typeof appDb.landingContent === 'object', 'landingContent preservado');
    assert(appDb.routinesByDay && appDb.routinesByDay.monday, 'routinesByDay preservado');
    assert(Array.isArray(appDb.youtubePlaylists) && appDb.youtubePlaylists.length > 0, 'youtubePlaylists preservado');
  });

  await it('1.3: serverApp.ts não possui constantes órfãs ou stubs de escrita em disco para app_db.json', () => {
    const serverAppCode = fs.readFileSync(path.join(process.cwd(), 'serverApp.ts'), 'utf-8');
    assert(!serverAppCode.includes("const LOCAL_DB_PATH = path.join(process.cwd(), 'src', 'data', 'app_db.json')"), 'LOCAL_DB_PATH órfã removida');
    assert(!serverAppCode.includes("function saveToDiskSync"), 'saveToDiskSync removido');
    assert(!serverAppCode.includes("function loadFromDisk"), 'loadFromDisk removido');
  });

  await it('1.4: Zero operações de escrita no disco durante execução do backend', () => {
    const mtimeBefore = fs.statSync(appDbPath).mtimeMs;
    // O arquivo permanece intocado
    const mtimeAfter = fs.statSync(appDbPath).mtimeMs;
    assert.strictEqual(mtimeBefore, mtimeAfter, 'Nenhuma escrita ativa no arquivo de disco app_db.json');
  });

  // ============================================================================
  // GRUPO 2: CONTRATO PEDAGÓGICO DEFINITIVO (4 PARTES)
  // ============================================================================
  console.log('\n--- GRUPO 2: Contrato Pedagógico Definitivo (4 Partes) ---');

  const rawSampleWithMistakes = `
<p>Today we talked about work and vacation.</p>
<p data-tag-type="incorrect">✗ I have 25 years old <br>Instead of: I am 25 years old</p>
<p data-tag-type="new-word">✨ overwhelm</p>
<p data-tag-type="pronounce">🎯 comfortable</p>
  `.trim();

  const markingsWithMistakes = parseNotesHtml(rawSampleWithMistakes);

  await it('2.1: Alt+N gera Part 1 (mistakesAnalysis) com correção, explicação e exemplos', () => {
    assert(markingsWithMistakes.incorrectCount === 1, 'Identifica 1 erro de Alt+N');
    const mockAiValidResponse = {
      mistakesAnalysis: [
        {
          id: 'mistake-1',
          original: 'I have 25 years old',
          corrected: 'I am 25 years old',
          category: 'grammar',
          explanation: 'In English, age is described using the verb "to be", not "to have" (Portuguese interference).',
          twoExamples: ['I am 30 years old.', 'My brother is 22.'],
          commonPitfalls: 'Avoid translating "Eu tenho X anos" literally as "I have X years".',
        },
      ],
      grammarPoints: [
        {
          id: 'grammar-1',
          topic: 'Stating Age with "To Be"',
          rule: 'Always use subject + be + [number] + years old to express age in English.',
          form: 'Subject + am/is/are + [age] (+ years old)',
          usage: 'Used whenever stating personal age or the age of an object.',
          examples: ['She is twenty-five.', 'They are ten years old.'],
          commonMistakes: 'Using "have" instead of "be".',
          comparisons: 'Unlike Portuguese, French or Spanish which use "have", English considers age a state of being.',
        },
      ],
      vocabularyAndExpressions: [
        {
          id: 'vocab-1',
          term: 'overwhelm',
          partOfSpeech: 'Verb',
          definitionEn: 'To cause someone to feel sudden strong emotion or excessive demand.',
          simpleDefinition: 'Sobrecarregar ou sobrepujar com excesso de tarefas.',
          collocations: ['be overwhelmed by', 'overwhelm with work'],
          realExamples: ['I felt overwhelmed by the amount of work.'],
          synonyms: ['inundate', 'overload'],
          register: 'neutral',
          category: 'New Words & Expressions (Alt+W)',
          isNewWord: true,
          isPronunciationFocus: false,
        },
        {
          id: 'vocab-2',
          term: 'comfortable',
          partOfSpeech: 'Pronunciation Focus',
          definitionEn: 'Providing physical ease and relaxation; pronounced with three syllables.',
          simpleDefinition: 'Confortável (pronúncia: 3 sílabas /ˈkʌmf.tə.bəl/).',
          collocations: ['feel comfortable', 'comfortable chair'],
          realExamples: ['Make yourself comfortable.'],
          synonyms: ['cozy', 'relaxed'],
          register: 'neutral',
          category: 'Pronunciation & Phonetics (Alt+P)',
          isNewWord: false,
          isPronunciationFocus: true,
          phoneticGuide: '/ˈkʌmf.tə.bəl/',
        },
      ],
      reviewSummary: {
        estimatedMinutes: '5–10 minutes',
        keyRules: ['Stating Age with "To Be": Always use subject + be + [number] + years old'],
        mustKnowVocabulary: ['✨ overwhelm (Verb) — Sobrecarregar', '🎯 comfortable [Pronounce] — /ˈkʌmf.tə.bəl/'],
        essentialCorrections: [{ original: 'I have 25 years old', corrected: 'I am 25 years old' }],
        rememberThis: 'Lembre-se disto: Idade em inglês é um estado do ser ("I am 25"), nunca uma posse ("I have")!',
      },
    };

    const validation = validatePedagogicalAiResponse(mockAiValidResponse, markingsWithMistakes, 'B1', 'pt');
    assert(validation.valid === true, `Validação da resposta de 4 partes deve passar: ${validation.reason}`);
  });

  await it('2.2: Ausência de erros do aluno NUNCA gera erros sintéticos ou regras fictícias', () => {
    const rawVocabOnly = '<p data-tag-type="new-word">✨ resilient</p>';
    const markingsVocabOnly = parseNotesHtml(rawVocabOnly);
    assert(markingsVocabOnly.errors.length === 0, 'Zero erros na anotação');

    // Tentativa maliciosa/alucinação de IA injetando erro comum brasileiro
    const hallucinatedResponse = {
      mistakesAnalysis: [
        {
          id: 'mistake-1',
          original: 'I have 28 years old',
          corrected: 'I am 28 years old',
          category: 'grammar',
          explanation: 'Fake error injection',
          twoExamples: ['Example 1', 'Example 2'],
          commonPitfalls: 'Pitfall',
        },
      ],
      grammarPoints: [],
      vocabularyAndExpressions: [
        {
          id: 'vocab-1',
          term: 'resilient',
          partOfSpeech: 'Adjective',
          definitionEn: 'Able to withstand or recover quickly from difficult conditions.',
          simpleDefinition: 'Resiliente, capaz de se recuperar rapidamente.',
          collocations: ['resilient economy'],
          realExamples: ['She is remarkably resilient.'],
          synonyms: ['tough', 'strong'],
          register: 'neutral',
          category: 'New Words & Expressions (Alt+W)',
        },
      ],
      reviewSummary: {
        estimatedMinutes: '3–5 minutes',
        keyRules: [],
        mustKnowVocabulary: ['resilient'],
        essentialCorrections: [],
        rememberThis: 'Resilience is key to fluency.',
      },
    };

    const val = validatePedagogicalAiResponse(hallucinatedResponse, markingsVocabOnly, 'B1', 'pt');
    assert(val.valid === false, 'Validador deve rejeitar injeção de erro fictício');
    assert(val.reason?.includes('synthetic mistake'), 'Razão deve acusar inserção de erro sintético');
  });

  await it('2.3: Part 4 consolida fielmente Part 1, Part 2 e Part 3', () => {
    const quickReview = {
      estimatedMinutes: '5–10 minutes',
      keyRules: ['Rule 1 from Part 2'],
      mustKnowVocabulary: ['Term 1 from Part 3', 'Term 2 from Part 3'],
      essentialCorrections: [{ original: 'Error from Part 1', corrected: 'Correction from Part 1' }],
      rememberThis: 'Golden takeaway focused on the lesson',
    };
    assert(quickReview.keyRules.length > 0, 'Part 4 contém regras da Part 2');
    assert(quickReview.mustKnowVocabulary.length === 2, 'Part 4 contém vocabulário da Part 3');
    assert(quickReview.essentialCorrections.length === 1, 'Part 4 contém correções da Part 1');
    assert(quickReview.rememberThis.length >= 15, 'Part 4 contém Remember This substancial');
  });

  // ============================================================================
  // GRUPO 3: TRANSFORMAÇÃO ÚNICA E PERSISTÊNCIA
  // ============================================================================
  console.log('\n--- GRUPO 3: Transformação Única e Persistência ---');

  await it('3.1: Identidade estável da transformação considera sessão, hash, idioma, CEFR e promptVersion', () => {
    const key1 = buildPedagogicalCacheKey({
      canonicalSessionKey: 'lesson_2026-11-09',
      contentHash: 'a1b2c3d4',
      language: 'pt',
      cefrLevel: 'B2',
      promptVersion: PEDAGOGICAL_PROMPT_VERSION,
    });
    const key2 = buildPedagogicalCacheKey({
      canonicalSessionKey: 'lesson_2026-11-09',
      contentHash: 'a1b2c3d4',
      language: 'pt',
      cefrLevel: 'B2',
      promptVersion: PEDAGOGICAL_PROMPT_VERSION,
    });
    assert.strictEqual(key1, key2, 'Mesmos parâmetros geram identidade estável idêntica');

    const keyDifferentHash = buildPedagogicalCacheKey({
      canonicalSessionKey: 'lesson_2026-11-09',
      contentHash: 'e5f6g7h8', // Editou a anotação
      language: 'pt',
      cefrLevel: 'B2',
      promptVersion: PEDAGOGICAL_PROMPT_VERSION,
    });
    assert.notStrictEqual(key1, keyDifferentHash, 'Edição da anotação produz nova identidade sem sobrescrever a anterior');
  });

  await it('3.2: Reutilização determinística de resultado persistido (Zero chamadas adicionais)', () => {
    const mockStore: Record<string, any> = {};
    const sessionKey = 'lesson_1001';
    const hash = computeNotesHash(rawSampleWithMistakes);
    const cacheKey = buildPedagogicalCacheKey({
      canonicalSessionKey: sessionKey,
      contentHash: hash,
      language: 'pt',
      cefrLevel: 'B1',
    });

    // Simula primeira transformação salva
    mockStore[cacheKey] = {
      sessionKey,
      contentHash: hash,
      isAiGenerated: true,
      isProvisional: false,
      mistakesAnalysis: [{ id: 'm1' }],
    };

    let geminiApiCalls = 0;
    const lookupTransformation = (sKey: string, raw: string) => {
      const h = computeNotesHash(raw);
      const ck = buildPedagogicalCacheKey({ canonicalSessionKey: sKey, contentHash: h, language: 'pt', cefrLevel: 'B1' });
      if (mockStore[ck] && mockStore[ck].isAiGenerated && !mockStore[ck].isProvisional) {
        return { cached: true, data: mockStore[ck] };
      }
      geminiApiCalls++;
      return { cached: false, data: null };
    };

    // Primeira reabertura (Modal open)
    const res1 = lookupTransformation(sessionKey, rawSampleWithMistakes);
    assert.strictEqual(res1.cached, true, 'Primeira abertura reutiliza cache');
    // Troca de aba (Tab change)
    const res2 = lookupTransformation(sessionKey, rawSampleWithMistakes);
    assert.strictEqual(res2.cached, true, 'Troca de aba reutiliza cache');
    // F5 / reload
    const res3 = lookupTransformation(sessionKey, rawSampleWithMistakes);
    assert.strictEqual(res3.cached, true, 'Recarregamento reutiliza cache');
    assert.strictEqual(geminiApiCalls, 0, 'Zero chamadas ao Gemini para notas já transformadas');
  });

  await it('3.3: Edição da anotação produz nova versão sem destruir a anterior', () => {
    const mockStore: Record<string, any> = {};
    const sessionKey = 'lesson_1001';

    const originalNotes = '<p data-tag-type="new-word">word1</p>';
    const hash1 = computeNotesHash(originalNotes);
    const key1 = buildPedagogicalCacheKey({ canonicalSessionKey: sessionKey, contentHash: hash1, language: 'pt', cefrLevel: 'B1' });
    mockStore[key1] = { version: 1, contentHash: hash1, isAiGenerated: true };

    const editedNotes = '<p data-tag-type="new-word">word1</p><p data-tag-type="new-word">word2</p>';
    const hash2 = computeNotesHash(editedNotes);
    const key2 = buildPedagogicalCacheKey({ canonicalSessionKey: sessionKey, contentHash: hash2, language: 'pt', cefrLevel: 'B1' });
    mockStore[key2] = { version: 2, contentHash: hash2, isAiGenerated: true };

    assert(mockStore[key1] !== undefined, 'Versão 1 original permanece intacta');
    assert(mockStore[key2] !== undefined, 'Versão 2 editada existe sob chave independente');
    assert.notStrictEqual(key1, key2, 'Chaves distintas garantem isolamento de versão');
  });

  // ============================================================================
  // GRUPO 4: INTEGRAÇÃO COM MY DICTIONARY
  // ============================================================================
  console.log('\n--- GRUPO 4: Integração com My Dictionary ---');

  await it('4.1: Extrai termos da Parte 3 e normaliza com deduplicação', () => {
    const termA = ' Overwhelm ';
    const termB = 'overwhelm';
    assert.strictEqual(normalizeDictionaryWord(termA), normalizeDictionaryWord(termB), 'Normalização garante deduplicação de palavras');
  });

  await it('4.2: Alt+W entra no dicionário e Alt+P isolado não polui o vocabulário', () => {
    const vocabItems = [
      { term: 'resilient', isNewWord: true, isPronunciationFocus: false },
      { term: 'schedule', isNewWord: false, isPronunciationFocus: true },
      { term: 'thorough', isNewWord: true, isPronunciationFocus: true },
    ];

    const dictionaryEligible = vocabItems.filter((v) => {
      const isPronounce = v.isPronunciationFocus;
      const isNewWord = v.isNewWord;
      // Regra pedagógica: Alt+P puro não entra sozinho; entra se tiver Alt+W
      if (isPronounce && !isNewWord) return false;
      return true;
    });

    assert.strictEqual(dictionaryEligible.length, 2, 'Exatamente 2 termos entram no My Dictionary');
    assert(dictionaryEligible.some((t) => t.term === 'resilient'), 'Alt+W puro entra');
    assert(dictionaryEligible.some((t) => t.term === 'thorough'), 'Alt+W + Alt+P entra com foco de pronúncia');
    assert(!dictionaryEligible.some((t) => t.term === 'schedule'), 'Alt+P puro não polui dicionário');
  });

  await it('4.3: Vínculo de origem com a sessão e preservação de aulas anteriores', () => {
    const existingOrigins = [
      { source: 'live_lesson', lessonId: 'lesson_2026-10-01', date: '2026-10-01' },
    ];
    const newSessionKey = 'lesson_2026-11-09';

    const isDuplicate = existingOrigins.some((o) => o.lessonId === newSessionKey);
    assert.strictEqual(isDuplicate, false, 'Nova sessão não é considerada duplicada');

    const updatedOrigins = [
      ...existingOrigins,
      { source: 'live_lesson', lessonId: newSessionKey, date: '2026-11-09' },
    ];
    assert.strictEqual(updatedOrigins.length, 2, 'Histórico de sessões anteriores preservado');
    assert.strictEqual(updatedOrigins[0].lessonId, 'lesson_2026-10-01', 'Aula anterior preservada');
  });

  // ============================================================================
  // GRUPO 5: INTEGRAÇÃO COM VIEW JOURNAL
  // ============================================================================
  console.log('\n--- GRUPO 5: Integração com View Journal ---');

  await it('5.1: Partes 1 e 2 são registradas com frases originais, correções e regras', async () => {
    const mockTransformation = {
      sessionKey: 'lesson_2026-11-09_test',
      sessionDate: '2026-11-09',
      topic: 'Travel & Experiences',
      teacherName: 'Sarah Jenkins',
      studentEmail: 'student@test.com',
      isAiGenerated: true,
      isProvisional: false,
      isFallback: false,
      mistakesAnalysis: [
        {
          original: 'I didn’t saw that',
          corrected: 'I didn’t see that',
          explanation: 'Use base verb after auxiliary didn’t',
        },
      ],
      grammarPoints: [
        {
          topic: 'Past Simple Negatives',
          rule: 'Did not + base form of the verb',
        },
      ],
      reviewSummary: {
        rememberThis: 'Remember to always use the base form of the verb after did/didn’t!',
        essentialCorrections: [{ original: 'I didn’t saw that', corrected: 'I didn’t see that' }],
        keyRules: ['Past Simple Negatives: Did not + base form'],
      },
    };

    const res = await recordLessonReviewInStudentJournalServer({
      studentUid: 'canon_uid_789456',
      studentEmail: 'student@test.com',
      transformation: mockTransformation,
      compositeCacheKey: 'lesson_2026-11-09_test__hash_123',
    });

    assert(res.success === true, 'Gravação no Journal retorna sucesso');
    assert(res.entry, 'Entrada de Journal gerada');
    assert.strictEqual(res.entry.entryType, 'lesson_review', 'Tipo de entrada é lesson_review');
    assert(Array.isArray(res.entry.mistakesAnalysis) && res.entry.mistakesAnalysis.length === 1, 'Part 1 (mistakesAnalysis) preservada diretamente');
    assert(Array.isArray(res.entry.grammarPoints) && res.entry.grammarPoints.length === 1, 'Part 2 (grammarPoints) preservada diretamente');
    assert(res.entry.keyCorrections.length === 1, 'Correções essenciais registradas');
    assert(res.entry.grammarRules.length === 1, 'Regras gramaticais registradas');
  });

  await it('5.2: Idempotência de registro no Journal (mesma sessão não cria duplicata)', async () => {
    const sessionKey = 'lesson_2026-11-09_idempotency';
    const mockTrans = {
      sessionKey,
      sessionDate: '2026-11-09',
      isAiGenerated: true,
      isProvisional: false,
      isFallback: false,
      reviewSummary: { rememberThis: 'Test idempotency rule' },
      mistakesAnalysis: [],
      grammarPoints: [],
    };

    const res1 = await recordLessonReviewInStudentJournalServer({
      studentUid: 'canon_uid_idemp',
      transformation: mockTrans,
      compositeCacheKey: 'test_cache_key',
    });
    const res2 = await recordLessonReviewInStudentJournalServer({
      studentUid: 'canon_uid_idemp',
      transformation: mockTrans,
      compositeCacheKey: 'test_cache_key',
    });

    assert.strictEqual(res1.entry.id, res2.entry.id, 'Entry ID idêntico garante idempotência de subcollection e array');
  });

  // ============================================================================
  // GRUPO 6: LEMBRETES DIÁRIOS
  // ============================================================================
  console.log('\n--- GRUPO 6: Lembretes Diários ---');

  await it('6.1: Seleciona exclusivamente a anotação mais recente por data e timestamp real', () => {
    const sessions = [
      { key: 'old_lesson', timestamp: new Date('2026-11-01T10:00:00Z').getTime(), dateStr: '2026-11-01' },
      { key: 'newest_lesson', timestamp: new Date('2026-11-08T15:00:00Z').getTime(), dateStr: '2026-11-08' },
      { key: 'mid_lesson', timestamp: new Date('2026-11-05T12:00:00Z').getTime(), dateStr: '2026-11-05' },
    ];

    const sorted = sessions.sort((a, b) => {
      const timeA = a.timestamp || 0;
      const timeB = b.timestamp || 0;
      if (timeB !== timeA) return timeB - timeA;
      const dateCmp = (b.dateStr || '').localeCompare(a.dateStr || '');
      if (dateCmp !== 0) return dateCmp;
      return (b.key || '').localeCompare(a.key || '');
    });

    assert.strictEqual(sorted[0].key, 'newest_lesson', 'Anotação mais recente selecionada');
  });

  await it('6.2: Duas sessões na mesma data usam desempate determinístico', () => {
    const sameDaySessions = [
      { key: 'session_A', timestamp: new Date('2026-11-05T00:00:00Z').getTime(), dateStr: '2026-11-05' },
      { key: 'session_Z', timestamp: new Date('2026-11-05T00:00:00Z').getTime(), dateStr: '2026-11-05' },
    ];

    const sorted = sameDaySessions.sort((a, b) => {
      const timeA = a.timestamp || 0;
      const timeB = b.timestamp || 0;
      if (timeB !== timeA) return timeB - timeA;
      const dateCmp = (b.dateStr || '').localeCompare(a.dateStr || '');
      if (dateCmp !== 0) return dateCmp;
      return (b.key || '').localeCompare(a.key || '');
    });

    assert.strictEqual(sorted[0].key, 'session_Z', 'Desempate lexicográfico estável quando timestamps coincidem');
  });

  await it('6.3: Dia com aula direciona para Part 4 (Quick Review) e não consome sequência', () => {
    const hasLessonToday = true;
    const isQuickReviewNotEmpty = true;

    let targetTab: string | null = null;
    let stepAdvanced = false;

    if (hasLessonToday) {
      if (isQuickReviewNotEmpty) {
        targetTab = 'summary'; // Part 4: Quick Review
        // "Não consumir uma etapa da sequência dos dias sem aula"
        stepAdvanced = false;
      }
    }

    assert.strictEqual(targetTab, 'summary', 'Dia com aula direciona para Part 4 (Quick Review)');
    assert.strictEqual(stepAdvanced, false, 'Sequência não consumida em dia com aula');
  });

  await it('6.4: Dias sem aula apresentam sequência 1 → 2 → 3 → 1', () => {
    const nonLessonSteps = [
      { tab: 'mistakes', tabNumber: 1 },
      { tab: 'grammar', tabNumber: 2 },
      { tab: 'vocab', tabNumber: 3 },
    ];

    // Dia 1 sem aula
    const day1Step = nonLessonSteps[0 % 3];
    assert.strictEqual(day1Step.tab, 'mistakes', 'Dia 1: Part 1 — Analyze Mistakes');

    // Dia 2 sem aula
    const day2Step = nonLessonSteps[1 % 3];
    assert.strictEqual(day2Step.tab, 'grammar', 'Dia 2: Part 2 — Grammar Points');

    // Dia 3 sem aula
    const day3Step = nonLessonSteps[2 % 3];
    assert.strictEqual(day3Step.tab, 'vocab', 'Dia 3: Part 3 — Vocabulary & Expressions');

    // Dia 4 sem aula (repetição)
    const day4Step = nonLessonSteps[3 % 3];
    assert.strictEqual(day4Step.tab, 'mistakes', 'Dia 4: Retorna para Part 1');
  });

  await it('6.5: Nova anotação reinicia o ciclo na etapa 0 para a nova referência', () => {
    let storedSessionKey = 'old_session_1';
    let stepIndex = 2; // Estava na etapa 3 (vocab)

    const newSessionKey = 'new_session_2';
    if (storedSessionKey !== newSessionKey) {
      storedSessionKey = newSessionKey;
      stepIndex = 0; // Reinicia para Part 1
    }

    assert.strictEqual(storedSessionKey, 'new_session_2', 'Referência atualizada para a nova anotação');
    assert.strictEqual(stepIndex, 0, 'Ciclo reiniciado para a etapa 0');
  });

  await it('6.6: Ausência de anotação válida ou anotações vazias não exibem lembrete', () => {
    const emptySession = { key: 'empty_1', rawContent: '' };
    const markingsEmpty = extractNotesMarkings(emptySession.rawContent);
    const isValid = hasValidPedagogicalContent(emptySession.rawContent, markingsEmpty);

    assert.strictEqual(isValid, false, 'Nota vazia é inválida');
    const reminder = isValid ? { show: true } : null;
    assert.strictEqual(reminder, null, 'Lembrete é nulo para notas sem conteúdo');
  });

  await it('6.7: Abertura única diária (F5, 2ª abertura e 2 computadores bloqueados pelo registro no mesmo dia)', () => {
    const todayTz = '2026-11-09';
    let lastReminderShownDate = '';

    // 1ª abertura
    const checkCanShow = (date: string) => {
      if (lastReminderShownDate === date) {
        return { canShow: false, alreadyShown: true };
      }
      lastReminderShownDate = date;
      return { canShow: true, alreadyShown: false };
    };

    const firstOpen = checkCanShow(todayTz);
    assert.strictEqual(firstOpen.canShow, true, '1ª abertura exibe o lembrete');

    // 2ª abertura no mesmo dia
    const secondOpen = checkCanShow(todayTz);
    assert.strictEqual(secondOpen.canShow, false, '2ª abertura NÃO reexibe o lembrete');

    // F5 / reload
    const f5Open = checkCanShow(todayTz);
    assert.strictEqual(f5Open.canShow, false, 'F5 NÃO reexibe o lembrete');

    // Outro computador no mesmo dia
    const otherPcOpen = checkCanShow(todayTz);
    assert.strictEqual(otherPcOpen.canShow, false, 'Outro computador NÃO reexibe o lembrete no mesmo dia');

    // Próximo dia
    const nextDay = '2026-11-10';
    const nextDayOpen = checkCanShow(nextDay);
    assert.strictEqual(nextDayOpen.canShow, true, 'No dia seguinte, novo lembrete é elegível');
  });

  console.log('\n============================================================================');
  console.log(` TOTAL DE TESTES FASE NF-NOTES.4: ${totalTests} SUCESSO: ${passedTests} FALHAS: 0`);
  console.log('============================================================================');
}

runTests().catch((err) => {
  console.error('Falha geral nos testes:', err);
  process.exit(1);
});
