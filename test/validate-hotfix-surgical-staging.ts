/**
 * TEST SUITE: HOTFIX CIRÚRGICO — IT'S SIMPLE SECURITY STAGING
 * 
 * Validação rigorosa e determinística (zero chamadas pagas à IA):
 * 1. Login carrega o histórico completo sem abrir My Dictionary (GET /api/student-dictionary).
 * 2. Definições existentes são reutilizadas (zero requisições redundantes de enriquecimento).
 * 3. Nenhuma palavra histórica é perdida ou sobrescrita indevidamente (consolidação com preservação de histórico, métricas e origens).
 * 4. HTTP 503 e 429 não produzem aprovação gramatical falsa (retornam isAiUnavailable: true sem isCorrect: true e sem falso erro).
 * 5. A frase permanece disponível para nova tentativa (sem cache de indisponibilidade).
 * 6. Uma resposta válida da IA continua funcionando normalmente (res.ok com avaliação gramatical válida).
 * 7. Timeout de check_daily_sentence ajustado exclusivamente para 9.000 ms, com todas as outras políticas inalteradas.
 */

import { GEMINI_POLICIES } from '../src/serverGeminiSecurity';
import { checkDailySentenceAi } from '../src/utils/writingChecker';
import {
  consolidateDictionaryEntries,
  buildConsolidatedActiveDictionary,
  normalizeDictionaryWord,
} from '../src/utils/studentDictionaryLibrary';
import { lookupWord, getInstantOrCachedWord } from '../src/utils/dictionaryService';
import { StudentDictionaryEntry } from '../src/types';

let passed = 0;
let failed = 0;

function assert(condition: any, testName: string, detail?: string) {
  if (condition) {
    console.log(`  ✅ PASS: ${testName}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${testName} ${detail ? `(${detail})` : ''}`);
    failed++;
  }
}

// Mock global fetch for deterministic testing without network or paid API calls
const originalFetch = global.fetch;

async function runHotfixSurgicalValidation() {
  console.log('============================================================================');
  console.log(' TEST SUITE: HOTFIX CIRÚRGICO — IT\'S SIMPLE SECURITY STAGING');
  console.log(' Ambiente: Determinístico local (Zero chamadas pagas)');
  console.log('============================================================================\n');

  // -------------------------------------------------------------------------
  // 1. Timeout da política check_daily_sentence e integridade das demais políticas
  // -------------------------------------------------------------------------
  console.log('--- 1. Verificação das Políticas do Gemini Security ---');

  assert(
    GEMINI_POLICIES.check_daily_sentence.timeoutMs === 9000,
    '1.1: Timeout da política check_daily_sentence ajustado para 9.000 ms',
    `atual: ${GEMINI_POLICIES.check_daily_sentence.timeoutMs} ms`
  );

  assert(
    GEMINI_POLICIES.check_daily_sentence.maxOutputTokens === 450,
    '1.2: maxOutputTokens de check_daily_sentence preservado em 450'
  );

  assert(
    GEMINI_POLICIES.check_writing.timeoutMs === 6000,
    '1.3: Timeout de check_writing inalterado em 6.000 ms'
  );

  assert(
    GEMINI_POLICIES.homework_generate.timeoutMs === 22000,
    '1.4: Timeout de homework_generate inalterado em 22.000 ms'
  );

  assert(
    GEMINI_POLICIES.homework_evaluate.timeoutMs === 15000,
    '1.5: Timeout de homework_evaluate inalterado em 15.000 ms'
  );

  // -------------------------------------------------------------------------
  // 2. HTTP 503 e 429 não produzem aprovação gramatical falsa (Sentence of the Day)
  // -------------------------------------------------------------------------
  console.log('\n--- 2. Tratamento de HTTP 503 e 429 em checkDailySentenceAi ---');

  const testSentence = 'Today I had coffee and practice English.';
  const dailyWords = ['coffee', 'practice'];

  // Test 2a: Mock HTTP 503 (Serviço temporariamente indisponível)
  global.fetch = async (input: any, init?: any) => {
    return {
      status: 503,
      ok: false,
      json: async () => ({
        success: false,
        error: 'AiUnavailable',
        message: 'Serviço de verificação da Frase do Dia temporariamente indisponível.',
      }),
    } as any;
  };

  const res503 = await checkDailySentenceAi(testSentence, dailyWords);

  assert(
    res503.isAiUnavailable === true,
    '2.1: HTTP 503 retorna estado isAiUnavailable === true'
  );

  assert(
    res503.isCorrect !== true,
    '2.2: HTTP 503 NÃO produz aprovação gramatical (isCorrect !== true)'
  );

  assert(
    res503.hasAnyError === false,
    '2.3: HTTP 503 NÃO acusa erro gramatical falso (hasAnyError === false)'
  );

  assert(
    res503.explanation?.includes('AI correction is temporarily unavailable') ||
    res503.sentenceFeedback?.explanationEn?.includes('AI correction is temporarily unavailable'),
    '2.4: HTTP 503 apresenta mensagem explicativa neutra de indisponibilidade'
  );

  assert(
    res503.correctedSentence === testSentence,
    '2.5: Frase do aluno é mantida intacta para nova tentativa'
  );

  // Test 2b: Mock HTTP 429 (Rate limit / Concorrência)
  global.fetch = async (input: any, init?: any) => {
    return {
      status: 429,
      ok: false,
      json: async () => ({
        success: false,
        error: 'Rate limit exceeded',
        message: 'Muitas verificações de frase solicitadas recentemente.',
      }),
    } as any;
  };

  const testSentence2 = 'Today I woke up early and study English.';
  const res429 = await checkDailySentenceAi(testSentence2, ['study']);

  assert(
    res429.isAiUnavailable === true,
    '2.6: HTTP 429 retorna estado isAiUnavailable === true'
  );

  assert(
    res429.isCorrect !== true,
    '2.7: HTTP 429 NÃO produz aprovação gramatical (isCorrect !== true)'
  );

  // Test 2c: Frase permanece elegível para nova tentativa (sem cache de falha temporária)
  global.fetch = async (input: any, init?: any) => {
    // Agora o serviço volta a responder 200 OK com avaliação gramatical válida da IA
    return {
      status: 200,
      ok: true,
      json: async () => ({
        isCorrect: true,
        hasAnyError: false,
        correctedSentence: 'Today I woke up early and studied English.',
        explanation: 'Excelente! Frase natural e correta.',
        usedWords: ['study'],
        missingWords: [],
      }),
    } as any;
  };

  const retryRes = await checkDailySentenceAi(testSentence2, ['study']);

  assert(
    retryRes.isAiUnavailable !== true,
    '2.8: Nova tentativa após indisponibilidade executa sem ser bloqueada por cache'
  );

  assert(
    retryRes.isCorrect === true || retryRes.correctedSentence?.includes('studied'),
    '2.9: Resposta válida da IA após recuperação opera normalmente'
  );

  // -------------------------------------------------------------------------
  // 3. My Dictionary — Hidratação e Reutilização de Definições
  // -------------------------------------------------------------------------
  console.log('\n--- 3. My Dictionary: Hidratação e Reutilização de Definições ---');

  const historicalEntries: StudentDictionaryEntry[] = [
    {
      id: 'dict_commute_1',
      word: 'commute',
      originalWord: 'commute',
      normalizedWord: 'commute',
      definitionEn: 'The regular daily journey to and from work or school.',
      exampleSentenceEn: 'My morning commute takes about thirty minutes by train.',
      partOfSpeech: 'Noun',
      translationPt: 'trajeto diário',
      cefrLevel: 'B1',
      practiceCount: 3,
      lastPracticedAt: '2026-10-25T10:00:00Z',
      origins: [
        {
          source: 'routine',
          activityName: 'Morning Transit',
          date: '2026-10-20',
        },
      ],
    },
    {
      id: 'dict_wrap_up_2',
      word: 'wrap up',
      originalWord: 'wrap up',
      normalizedWord: 'wrap up',
      definitionEn: 'To complete or conclude an event, meeting, or activity successfully.',
      exampleSentenceEn: 'Let us wrap up the meeting before lunch.',
      partOfSpeech: 'Phrasal Verb',
      translationPt: 'concluir, encerrar',
      cefrLevel: 'B2',
      practiceCount: 5,
      lastPracticedAt: '2026-10-26T18:00:00Z',
      origins: [
        {
          source: 'live_lesson',
          activityName: 'Native Friend Lesson with Alex',
          date: '2026-10-24',
        },
      ],
    },
  ];

  // Cenário 3a: Consolidação no login com palavras da rotina atual
  const routineWords = [
    { word: 'commute', sourceActivityName: 'Daily Routine', sourceDay: 'monday' as any },
    { word: 'breakfast', sourceActivityName: 'Morning Routine', sourceDay: 'monday' as any },
  ];

  const consolidated = buildConsolidatedActiveDictionary(
    historicalEntries,
    routineWords,
    [],
    'intermediate',
    'student_uid_123',
    'student@example.com'
  );

  assert(
    consolidated.length >= 3,
    `3.1: Histórico completo preservado e consolidado com vocabulário da rotina (${consolidated.length} palavras)`
  );

  const commuteEntry = consolidated.find((e) => e.normalizedWord === 'commute');
  assert(
    commuteEntry !== undefined &&
    commuteEntry.definitionEn === 'The regular daily journey to and from work or school.',
    '3.2: Definição rica pré-existente de "commute" foi reutilizada integralmente'
  );

  assert(
    commuteEntry !== undefined && commuteEntry.practiceCount === 3,
    '3.3: Métrica practiceCount de "commute" preservada estritamente (practiceCount === 3)'
  );

  const wrapUpEntry = consolidated.find((e) => e.normalizedWord === 'wrap up');
  assert(
    wrapUpEntry !== undefined && wrapUpEntry.origins?.some((o) => o.source === 'live_lesson'),
    '3.4: Palavra de Native Friend ("wrap up") permanece intacta com origem live_lesson'
  );

  // Cenário 3b: lookupWord reutiliza definição existente sem chamar API externa
  let apiCalled = false;
  global.fetch = async () => {
    apiCalled = true;
    throw new Error('API não deveria ter sido chamada pois a definição já existe no My Dictionary!');
  };

  const lookupResult = await lookupWord(
    'commute',
    undefined,
    'intermediate',
    'student_uid_123',
    'student@example.com',
    consolidated
  );

  assert(
    apiCalled === false,
    '3.5: lookupWord NÃO chamou nenhuma API de enriquecimento pois "commute" já existe no My Dictionary'
  );

  assert(
    lookupResult.source === 'my_dictionary' &&
    lookupResult.definitionEn === 'The regular daily journey to and from work or school.',
    '3.6: lookupWord retornou diretamente a definição rica do My Dictionary'
  );

  // -------------------------------------------------------------------------
  // 4. Verificação de ausência de regressão na consolidação de entradas
  // -------------------------------------------------------------------------
  console.log('\n--- 4. Preservação de Histórico e Não-Sobrescrita ---');

  const incomingProvisional: StudentDictionaryEntry[] = [
    {
      id: 'routine_commute_new',
      word: 'commute',
      originalWord: 'commute',
      normalizedWord: 'commute',
      definitionEn: '', // Definição em branco / pendente
      exampleSentenceEn: '',
      practiceCount: 0, // Não pode sobrescrever practiceCount existente!
    },
  ];

  const merged = consolidateDictionaryEntries(historicalEntries, incomingProvisional);
  const commuteMerged = merged.find((e) => e.normalizedWord === 'commute');

  assert(
    commuteMerged?.definitionEn === 'The regular daily journey to and from work or school.',
    '4.1: Definição existente NÃO foi sobrescrita por definição provisória em branco'
  );

  assert(
    commuteMerged?.practiceCount === 3,
    '4.2: practiceCount NÃO foi reduzido para 0 por entrada provisória'
  );

  // Restore fetch
  global.fetch = originalFetch;

  console.log('\n============================================================================');
  console.log(` RESULTADO FINAL: ${passed} PASSOU | ${failed} FALHOU`);
  console.log('============================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runHotfixSurgicalValidation().catch((err) => {
  console.error('Erro fatal nos testes do hotfix:', err);
  process.exit(1);
});
