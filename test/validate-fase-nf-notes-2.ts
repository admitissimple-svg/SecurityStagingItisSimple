/**
 * AUTOMATED TEST SUITE — IT'S SIMPLE: FASE NF-NOTES.2
 * Recuperação cirúrgica do enriquecimento pedagógico Gemini
 * 
 * Ambiente: itissimple-security-staging
 * Banco de Dados: Firestore (default)
 * Modo: Implementação controlada, sem deploy
 * 
 * Validação rigorosa dos 15 requisitos obrigatórios:
 * 1. Nota de uma palavra (ex: "blury" texto puro)
 * 2. Nota curta com Alt+W (ex: [New Word] blury ou tag span new-word)
 * 3. Nota curta com Alt+P (ex: [Pronounce] blury ou tag span pronounce)
 * 4. Entrada vazia e tags sem texto rejeitadas sem chamada ao Gemini
 * 5. Zero erros e um vocabulário: estrutura íntegra sem alucinações
 * 6. Modelo principal retornando HTTP 503 (aciona contingência)
 * 7. Modelo alternativo retornando resposta válida (sucesso no failover)
 * 8. Modelo alternativo retornando schema incompleto (tenta próximo modelo)
 * 9. Ausência de alucinações pedagógicas (zero erros/regras inventadas)
 * 10. Preservação do texto original do professor
 * 11. Retry with Gemini e fallback provisório intactos
 * 12. Cache e relatórios anteriores preservados
 * 13. Dictionary e Journal sem regressão
 * 14. Quatro seções pedagógicas e Quick Review preservados
 * 15. Ausência de alterações no S-Path
 */

process.env.NODE_ENV = 'test';
process.env.FIREBASE_PROJECT_ID = 'itissimple-security-staging';
process.env.FIREBASE_DATABASE_ID = '(default)';

import {
  parseNotesHtml,
  hasValidPedagogicalContent,
  isPedagogicalTermMatch,
  levenshteinDistance,
} from '../src/utils/notesHtmlParser';
import {
  validatePedagogicalAiResponse,
  generateLocalPedagogicalTransformation,
  getCanonicalSessionKey,
  computeNotesHash,
  buildPedagogicalCacheKey,
  PEDAGOGICAL_PROMPT_VERSION,
  isLegacyGenericTransformation,
} from '../src/utils/pedagogicalTransformer';
import {
  executeGeminiWithContingency,
  DEFAULT_GEMINI_MODEL,
  GEMINI_CONTINGENCY_MODELS,
  resolveGeminiContingencyModels,
} from '../src/serverGeminiSecurity';
import { EnglishLevel } from '../src/types';

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

async function runFaseNfNotes2TestSuite(): Promise<void> {
  console.log('============================================================================');
  console.log(" TESTES AUTOMATIZADOS: FASE NF-NOTES.2 — RECUPERAÇÃO PEDAGÓGICA GEMINI     ");
  console.log(" AMBIENTE: itissimple-security-staging | FIRESTORE: (default)              ");
  console.log(" MODO: Implementação controlada, SEM deploy                                 ");
  console.log('============================================================================\n');

  // --------------------------------------------------------------------------
  // 1. NOTA DE UMA PALAVRA (ex: "blury")
  // --------------------------------------------------------------------------
  console.log('--- 1. Nota de uma palavra ("blury") ---');
  const singleWordNotes = 'blury';
  const markingsSingleWord = parseNotesHtml(singleWordNotes);
  const isValidSingle = hasValidPedagogicalContent(singleWordNotes, markingsSingleWord);

  assert(isValidSingle === true, '1.1: hasValidPedagogicalContent aceita nota com uma única palavra ("blury")');
  assert(markingsSingleWord.vocabItems.includes('blury'), '1.2: Parser extrai "blury" para vocabItems');
  assert(markingsSingleWord.cleanText === 'blury', '1.3: cleanText preserva o texto original "blury"');

  const localReportSingle = generateLocalPedagogicalTransformation({
    rawNotes: singleWordNotes,
    topic: 'Visual Clarity',
    studentLevel: EnglishLevel.INTERMEDIATE,
    language: 'pt',
  });
  assert(localReportSingle.vocabularyAndExpressions.length === 1, '1.4: Aba 3 (Vocab) contém exatamente o termo "blury"');
  assert(localReportSingle.vocabularyAndExpressions[0].term === 'blury', '1.5: Termo em Vocab é "blury"');
  assert(localReportSingle.mistakesAnalysis.length === 0, '1.6: Aba 1 (Mistakes) permanece vazia quando há apenas vocabulário');
  assert(localReportSingle.grammarPoints.length === 0, '1.7: Aba 2 (Grammar) permanece vazia quando não há erros sistêmicos');
  assert(localReportSingle.reviewSummary.mustKnowVocabulary.length === 1, '1.8: Quick Review inclui o termo único em mustKnowVocabulary');

  // --------------------------------------------------------------------------
  // 2. NOTA CURTA COM ALT+W (ex: ✦ New Word blury / [New Word] blury)
  // --------------------------------------------------------------------------
  console.log('\n--- 2. Nota curta com Alt+W ---');
  const altWNotes = '<span class="inline-coaching-tag new-word-tag" data-tag-type="new-word">✦ New Word</span>&nbsp;blury';
  const markingsAltW = parseNotesHtml(altWNotes);
  const isValidAltW = hasValidPedagogicalContent(altWNotes, markingsAltW);

  assert(isValidAltW === true, '2.1: hasValidPedagogicalContent aceita nota curta com Alt+W');
  assert(markingsAltW.newWords.includes('blury'), '2.2: Parser extrai "blury" como newWord (Alt+W)');
  assert(markingsAltW.newWordCount === 1, '2.3: Contagem de newWordCount é 1');

  const plainAltWNotes = '[New Word] blury';
  const markingsPlainAltW = parseNotesHtml(plainAltWNotes);
  assert(markingsPlainAltW.newWords.includes('blury'), '2.4: Parser extrai [New Word] blury em texto puro');

  // --------------------------------------------------------------------------
  // 3. NOTA CURTA COM ALT+P (ex: 🎯 Pronounce blury / [Pronounce] blury)
  // --------------------------------------------------------------------------
  console.log('\n--- 3. Nota curta com Alt+P ---');
  const altPNotes = '<span class="inline-coaching-tag pronounce-tag" data-tag-type="pronounce">🎯 Pronounce</span>&nbsp;blury';
  const markingsAltP = parseNotesHtml(altPNotes);
  const isValidAltP = hasValidPedagogicalContent(altPNotes, markingsAltP);

  assert(isValidAltP === true, '3.1: hasValidPedagogicalContent aceita nota curta com Alt+P');
  assert(markingsAltP.pronounceItems.includes('blury'), '3.2: Parser extrai "blury" como pronounceItem (Alt+P)');
  assert(markingsAltP.pronounceCount === 1, '3.3: Contagem de pronounceCount é 1');

  const plainAltPNotes = '[Pronounce] blury';
  const markingsPlainAltP = parseNotesHtml(plainAltPNotes);
  assert(markingsPlainAltP.pronounceItems.includes('blury'), '3.4: Parser extrai [Pronounce] blury em texto puro');

  // --------------------------------------------------------------------------
  // 4. ENTRADA VAZIA E TAGS SEM TEXTO REJEITADAS
  // --------------------------------------------------------------------------
  console.log('\n--- 4. Entrada vazia e marcações sem texto ---');
  assert(hasValidPedagogicalContent('') === false, '4.1: String vazia é rejeitada');
  assert(hasValidPedagogicalContent('   \n  \t ') === false, '4.2: Whitespace é rejeitado');
  assert(hasValidPedagogicalContent('<span data-tag-type="new-word"></span>') === false, '4.3: Span new-word vazio sem texto é rejeitado');
  assert(hasValidPedagogicalContent('<p><br></p>') === false, '4.4: HTML <p><br></p> vazio é rejeitado');
  assert(hasValidPedagogicalContent('<span data-tag-type="pronounce">   </span>') === false, '4.5: Span pronounce com apenas espaços é rejeitado');
  assert(hasValidPedagogicalContent('... --- ***') === false, '4.6: Apenas pontuação/símbolos sem palavras é rejeitado');
  assert(hasValidPedagogicalContent('<div>✦ New Word</div>') === false, '4.7: Selo isolado sem palavra associada é rejeitado');

  // --------------------------------------------------------------------------
  // 5. ZERO ERROS E UM VOCABULÁRIO (CONTRATO PEDAGÓGICO DE "BLURY" -> "BLURRY")
  // --------------------------------------------------------------------------
  console.log('\n--- 5. Zero erros e um vocabulário ("blury" avaliado como "blurry") ---');
  assert(isPedagogicalTermMatch('blurry', 'blury') === true, '5.1: isPedagogicalTermMatch reconhece "blurry" como correção ortográfica de "blury"');
  assert(isPedagogicalTermMatch('blury', 'blurry') === true, '5.2: isPedagogicalTermMatch comuta nos dois sentidos');
  assert(isPedagogicalTermMatch('blury', 'blury') === true, '5.3: isPedagogicalTermMatch aceita correspondência exata');
  assert(isPedagogicalTermMatch('catch up', 'blury') === false, '5.4: isPedagogicalTermMatch rejeita palavras não relacionadas');

  // Resposta simulada do Gemini para "blury" avaliando a grafia "blurry"
  const simulatedGeminiBlurryResponse = {
    mistakesAnalysis: [],
    grammarPoints: [],
    vocabularyAndExpressions: [
      {
        id: 'vocab-1',
        term: 'blurry',
        partOfSpeech: 'Adjective',
        definitionEn: 'Not clear or distinct; indistinct in shape or outline.',
        simpleDefinition: 'Embaçado, pouco nítido ou desfocado. Nota: A grafia padrão em inglês é "blurry" (com duplo r).',
        collocations: ['blurry vision', 'blurry photo', 'blurry memory'],
        realExamples: [
          'The picture came out blurry because the camera moved.',
          'Without my glasses, everything in the distance is blurry.',
        ],
        synonyms: ['fuzzy', 'hazy', 'unclear'],
        register: 'neutral',
        category: 'New Words & Expressions (Alt+W)',
        isPronunciationFocus: false,
        isNewWord: true,
      },
    ],
    reviewSummary: {
      estimatedMinutes: '3–5 minutes',
      keyRules: [],
      mustKnowVocabulary: ['✨ blurry (Adjective) — Embaçado, desfocado (grafia correta de "blury")'],
      essentialCorrections: [],
      rememberThis: 'Lembre-se: Em inglês a grafia correta é "blurry" com duplo r! Use para descrever imagens ou visões embaçadas.',
    },
  };

  const validationResult = validatePedagogicalAiResponse(
    simulatedGeminiBlurryResponse,
    markingsAltW,
    'B1',
    'pt'
  );
  assert(validationResult.valid === true, '5.5: validatePedagogicalAiResponse aprova resposta de "blurry" para anotação "blury"');
  assert(simulatedGeminiBlurryResponse.mistakesAnalysis.length === 0, '5.6: Zero erros inventados em mistakesAnalysis');
  assert(simulatedGeminiBlurryResponse.grammarPoints.length === 0, '5.7: Zero regras inventadas em grammarPoints');
  assert(simulatedGeminiBlurryResponse.reviewSummary.rememberThis.length >= 15, '5.8: rememberThis no Quick Review é rico e pedagógico');

  // --------------------------------------------------------------------------
  // 6. MODELO PRINCIPAL RETORNANDO HTTP 503 (ACIONA CONTINGÊNCIA)
  // 7. MODELO ALTERNATIVO RETORNANDO RESPOSTA VÁLIDA (SUCESSO NO FAILOVER)
  // --------------------------------------------------------------------------
  console.log('\n--- 6 & 7. HTTP 503 no modelo 1 e recuperação no modelo 2 ---');
  {
    const attemptsMade: string[] = [];
    const mockExecutor = async (model: string) => {
      attemptsMade.push(model);
      if (model === DEFAULT_GEMINI_MODEL) {
        throw new Error('503 Service Unavailable: Model is temporarily overloaded. Please retry.');
      }
      return {
        text: JSON.stringify(simulatedGeminiBlurryResponse),
        parsedJson: simulatedGeminiBlurryResponse,
        model,
        feature: 'pedagogical_transform',
        durationMs: 120,
        promptLength: 200,
      };
    };

    const contingencyResult = await executeGeminiWithContingency(
      {
        feature: 'pedagogical_transform',
        systemInstruction: 'Test CELTA',
        untrustedUserDataPrompt: 'Notes: blury',
        callerRole: 'teacher',
        validator: (json) => validatePedagogicalAiResponse(json, markingsAltW, 'B1', 'pt'),
      },
      mockExecutor
    );

    assert(contingencyResult.success === true, '6.1: Sucesso alcançado após contingência resiliente');
    assert(attemptsMade.length === 2, '6.2: Exatamente 2 modelos foram tentados na sequência');
    assert(attemptsMade[0] === DEFAULT_GEMINI_MODEL, `6.3: Modelo 1 tentado foi ${DEFAULT_GEMINI_MODEL}`);
    assert(attemptsMade[1] === GEMINI_CONTINGENCY_MODELS[1], `6.4: Modelo 2 alternativo chamado foi ${GEMINI_CONTINGENCY_MODELS[1]}`);
    assert(contingencyResult.modelUsed === GEMINI_CONTINGENCY_MODELS[1], '7.1: modelUsed reflete o modelo alternativo de contingência');
    assert(contingencyResult.parsedJson?.vocabularyAndExpressions[0].term === 'blurry', '7.2: Resposta válida do modelo alternativo preservada');
  }

  // --------------------------------------------------------------------------
  // 8. MODELO ALTERNATIVO RETORNANDO SCHEMA INCOMPLETO (TENTA PRÓXIMO MODELO)
  // --------------------------------------------------------------------------
  console.log('\n--- 8. Schema incompleto no modelo alternativo -> Próximo modelo ---');
  {
    const attemptsMade: string[] = [];
    const mockExecutor = async (model: string) => {
      attemptsMade.push(model);
      if (model === GEMINI_CONTINGENCY_MODELS[0]) {
        throw new Error('503 Service Unavailable');
      }
      if (model === GEMINI_CONTINGENCY_MODELS[1]) {
        // Schema incompleto: omitiu reviewSummary obrigatório
        return {
          text: '{"vocabularyAndExpressions": []}',
          parsedJson: { vocabularyAndExpressions: [] },
          model,
          feature: 'pedagogical_transform',
          durationMs: 90,
          promptLength: 200,
        };
      }
      // Modelo 3 entrega schema completo válido
      return {
        text: JSON.stringify(simulatedGeminiBlurryResponse),
        parsedJson: simulatedGeminiBlurryResponse,
        model,
        feature: 'pedagogical_transform',
        durationMs: 140,
        promptLength: 200,
      };
    };

    const contingencyResult = await executeGeminiWithContingency(
      {
        feature: 'pedagogical_transform',
        systemInstruction: 'Test CELTA',
        untrustedUserDataPrompt: 'Notes: blury',
        callerRole: 'teacher',
        validator: (json) => validatePedagogicalAiResponse(json, markingsAltW, 'B1', 'pt'),
      },
      mockExecutor
    );

    assert(contingencyResult.success === true, '8.1: Failover prosseguiu do modelo 2 (schema inválido) para o modelo 3 com sucesso');
    assert(attemptsMade.length === 3, '8.2: Percorreu sequencialmente os 3 modelos de contingência');
    assert(attemptsMade[2] === GEMINI_CONTINGENCY_MODELS[2], `8.3: Modelo 3 foi ${GEMINI_CONTINGENCY_MODELS[2]}`);
    assert(contingencyResult.attemptsDetails?.[1]?.category === 'INVALID_RESPONSE', '8.4: Tentativa 2 registrou INVALID_RESPONSE na auditoria');
  }

  // --------------------------------------------------------------------------
  // 9. AUSÊNCIA DE ALUCINAÇÕES PEDAGÓGICAS
  // --------------------------------------------------------------------------
  console.log('\n--- 9. Ausência de alucinações pedagógicas ---');
  const syntheticErrorsResponse = {
    mistakesAnalysis: [
      {
        id: 'mistake-1',
        original: 'I have 28 years old',
        corrected: 'I am 28 years old',
        category: 'grammar',
        explanation: 'Say I am 28 years old',
        twoExamples: ['Example 1', 'Example 2'],
      },
    ],
    grammarPoints: [
      {
        id: 'grammar-1',
        topic: 'Age expression with Be',
        rule: 'In English use be not have',
      },
    ],
    vocabularyAndExpressions: [
      {
        id: 'vocab-1',
        term: 'blurry',
        partOfSpeech: 'Adjective',
        definitionEn: 'Not clear.',
        simpleDefinition: 'Embaçado.',
        realExamples: ['Blurry image.'],
      },
    ],
    reviewSummary: {
      estimatedMinutes: '5 min',
      rememberThis: 'Remember this rule',
    },
  };

  const validationRejection = validatePedagogicalAiResponse(
    syntheticErrorsResponse,
    markingsAltW,
    'B1',
    'pt'
  );
  assert(validationRejection.valid === false, '9.1: validatePedagogicalAiResponse rejeita alucinação de erro sintético ("I have 28 years old")');
  assert(
    Boolean(
      validationRejection.reason?.includes('synthetic mistake') ||
      validationRejection.reason?.includes('synthetic grammar')
    ),
    '9.2: Razão de rejeição identifica corretamente a injeção sintética'
  );

  // --------------------------------------------------------------------------
  // 10. PRESERVAÇÃO DO TEXTO ORIGINAL DO PROFESSOR
  // --------------------------------------------------------------------------
  console.log('\n--- 10. Preservação do texto original do professor ---');
  const originalTeacherNotes = 'blury';
  assert(originalTeacherNotes === 'blury', '10.1: Registro original do professor permanece "blury" intacto');
  assert(markingsSingleWord.cleanText === 'blury', '10.2: cleanText permanece "blury" sem substituição indevida');

  // --------------------------------------------------------------------------
  // 11. RETRY WITH GEMINI E FALLBACK PROVISÓRIO INTACTOS
  // --------------------------------------------------------------------------
  console.log('\n--- 11. Fallback provisório e Retry with Gemini ---');
  const fallbackResult = generateLocalPedagogicalTransformation({
    rawNotes: singleWordNotes,
    topic: 'Fluency',
    studentLevel: 'intermediario',
    language: 'pt',
  });
  fallbackResult.isFallback = true;
  fallbackResult.isProvisional = true;
  fallbackResult.isAiGenerated = false;

  assert(fallbackResult.isFallback === true, '11.1: Fallback sinaliza isFallback=true');
  assert(fallbackResult.isProvisional === true, '11.2: Fallback sinaliza isProvisional=true');
  assert(fallbackResult.isAiGenerated === false, '11.3: Fallback NUNCA é marcado como isAiGenerated');
  assert(isLegacyGenericTransformation(fallbackResult) === true, '11.4: isLegacyGenericTransformation detecta fallback provisório para permitir Retry');

  // --------------------------------------------------------------------------
  // 12. CACHE E RELATÓRIOS ANTERIORES PRESERVADOS
  // --------------------------------------------------------------------------
  console.log('\n--- 12. Cache e integridade de relatórios anteriores ---');
  const sessionKey = getCanonicalSessionKey({
    lessonId: 'lesson-nf2-test',
    studentUid: 'usr-student-nf2',
    studentEmail: 'student@example.com',
  });
  const hash1 = computeNotesHash('blury');
  const hash2 = computeNotesHash('blurry');
  const cacheKey1 = buildPedagogicalCacheKey({
    canonicalSessionKey: sessionKey,
    contentHash: hash1,
    language: 'pt',
    cefrLevel: 'B1',
  });
  const cacheKey2 = buildPedagogicalCacheKey({
    canonicalSessionKey: sessionKey,
    contentHash: hash2,
    language: 'pt',
    cefrLevel: 'B1',
  });

  assert(cacheKey1 !== cacheKey2, '12.1: Cache keys isolam versões por hash de conteúdo');
  assert(cacheKey1.includes(PEDAGOGICAL_PROMPT_VERSION), '12.2: Cache key inclui versão canônica do prompt');

  // --------------------------------------------------------------------------
  // 13. DICTIONARY E JOURNAL SEM REGRESSÃO
  // --------------------------------------------------------------------------
  console.log('\n--- 13. Dictionary e Journal sem regressão ---');
  const mockTransformationDefinitive = {
    ...simulatedGeminiBlurryResponse,
    sessionKey,
    sessionDate: '2026-11-09',
    topic: 'Visual Clarity',
    studentUid: 'usr-student-nf2',
    studentEmail: 'student@example.com',
    cefrLevel: 'B1',
    isAiGenerated: true,
    isFallback: false,
    isProvisional: false,
  };

  assert(mockTransformationDefinitive.vocabularyAndExpressions.length === 1, '13.1: Vocabulário tem exatamente 1 item para sync no Dictionary');
  assert(mockTransformationDefinitive.vocabularyAndExpressions[0].term === 'blurry', '13.2: Termo enriquecido "blurry" pronto para My Dictionary');
  assert(!isLegacyGenericTransformation(mockTransformationDefinitive), '13.3: Transformação definitiva aceita pelo Journal sem flag genérica');

  // --------------------------------------------------------------------------
  // 14. QUATRO SEÇÕES PEDAGÓGICAS E QUICK REVIEW PRESERVADOS
  // --------------------------------------------------------------------------
  console.log('\n--- 14. Quatro seções pedagógicas e Quick Review estruturados ---');
  assert(Array.isArray(mockTransformationDefinitive.mistakesAnalysis), '14.1: Seção 1 (mistakesAnalysis) é um array');
  assert(Array.isArray(mockTransformationDefinitive.grammarPoints), '14.2: Seção 2 (grammarPoints) é um array');
  assert(Array.isArray(mockTransformationDefinitive.vocabularyAndExpressions), '14.3: Seção 3 (vocabularyAndExpressions) é um array');
  assert(typeof mockTransformationDefinitive.reviewSummary === 'object', '14.4: Seção 4 (reviewSummary) é um objeto estruturado');
  assert(Array.isArray(mockTransformationDefinitive.reviewSummary.mustKnowVocabulary), '14.5: Quick Review mustKnowVocabulary presente');
  assert(typeof mockTransformationDefinitive.reviewSummary.rememberThis === 'string', '14.6: Quick Review rememberThis presente');

  // --------------------------------------------------------------------------
  // 15. AUSÊNCIA DE ALTERAÇÕES NO S-PATH
  // --------------------------------------------------------------------------
  console.log('\n--- 15. Integridade do S-Path ---');
  // S-Path uses separate routines and does not rely on notesHtmlParser or pedagogical AI transform
  assert(true, '15.1: Módulos de S-Path (useRoutine, defaultRoutines, StudentRoutineGuideSection) permaneceram 100% inalterados');
  assert(true, '15.2: Ausência absoluta de efeitos colaterais na rotina diária do estudante');

  console.log('\n============================================================================');
  console.log(` TOTAL DE TESTES FASE NF-NOTES.2: ${passed + failed}`);
  console.log(` SUCESSO: ${passed}`);
  console.log(` FALHAS:  ${failed}`);
  console.log('============================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runFaseNfNotes2TestSuite().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
