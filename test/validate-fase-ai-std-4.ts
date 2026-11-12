/**
 * TEST SUITE: FASE AI-STD.4
 * Eliminação de respostas pedagógicas pré-fabricadas
 *
 * Validações obrigatórias:
 * 1. Um erro e sua correção registrados pelo professor.
 * 2. Um erro sem correção registrada.
 * 3. Vários erros e correções.
 * 4. Somente vocabulário.
 * 5. Somente gramática.
 * 6. Ausência de conteúdo.
 * 7. Gemini indisponível (estado AI Enrichment Unavailable + preservação fiel).
 * 8. Resposta Gemini válida.
 * 9. Resposta Gemini inválida.
 * 10. TESTE CRÍTICO: uma frase diferente de "we can't to have" jamais poderá
 *     receber automaticamente a correção fixa "we can't have".
 * 11. Nenhuma fixture ou resposta pré-programada utilizada em execução real.
 */

import { parseNotesHtml, hasValidPedagogicalContent } from '../src/utils/notesHtmlParser';
import {
  generateLocalPedagogicalTransformation,
  validatePedagogicalAiResponse,
  isLegacyGenericTransformation,
  getAiUnavailableNoticeText,
  getPendingConfirmationText,
  getCanonicalSessionKey,
  computeNotesHash,
} from '../src/utils/pedagogicalTransformer';
import { EnglishLevel } from '../src/types';

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  totalTests++;
  if (condition) {
    console.log(`  ✅ [PASS] ${testName}`);
    passedTests++;
  } else {
    console.error(`  ❌ [FAIL] ${testName} ${detail ? `(${detail})` : ''}`);
    failedTests++;
  }
}

console.log('======================================================================');
console.log('FASE AI-STD.4 — ELIMINAÇÃO DE RESPOSTAS PEDAGÓGICAS PRÉ-FABRICADAS');
console.log('======================================================================\n');

// -----------------------------------------------------------------------------
// GRUPO 1: Um erro e sua correção registrados pelo professor
// -----------------------------------------------------------------------------
console.log('--- GRUPO 1: Um erro e sua correção registrados pelo professor ---');
{
  const notesSingleErrorAndCorrection = `
    <div>I went to office <span data-tag-type="incorrect">✗</span></div>
    <div>I went to the office <span data-tag-type="correct">✓</span></div>
  `;

  const markings = parseNotesHtml(notesSingleErrorAndCorrection);
  assert(markings.errors.length === 1, '1.1: Parser identifica exatamente 1 erro');
  assert(markings.errors[0].original === 'I went to office', '1.2: Erro original é "I went to office"');
  assert(markings.errors[0].corrected === 'I went to the office', '1.3: Correção do professor é "I went to the office"');
  assert(markings.errors[0].isPendingConfirmation === false, '1.4: Status confirmado (não pendente)');

  const local = generateLocalPedagogicalTransformation({
    rawNotes: notesSingleErrorAndCorrection,
    studentLevel: EnglishLevel.INTERMEDIATE,
    language: 'pt',
  });

  assert(local.mistakesAnalysis.length === 1, '1.5: mistakesAnalysis contém exatamente 1 item');
  assert(local.mistakesAnalysis[0].original === 'I went to office', '1.6: original preservado');
  assert(local.mistakesAnalysis[0].corrected === 'I went to the office', '1.7: corrected preserva correção do professor');
  assert(local.mistakesAnalysis[0].isPendingConfirmation === false, '1.8: isPendingConfirmation é false');
  assert(local.mistakesAnalysis[0].twoExamples.length === 0, '1.9: twoExamples é lista vazia (zero exemplos pré-fabricados)');
  assert(local.mistakesAnalysis[0].commonPitfalls === '', '1.10: commonPitfalls vazio (zero armadilhas artificiais)');
  assert(local.grammarPoints.length === 0, '1.11: grammarPoints é lista vazia no fallback local');
  assert(local.vocabularyAndExpressions.length === 0, '1.12: vocabularyAndExpressions é lista vazia');
  assert(local.reviewSummary.essentialCorrections.length === 1, '1.13: Quick Review resume a 1 correção do professor');
  assert(local.reviewSummary.keyRules.length === 0, '1.14: Quick Review keyRules é vazio');
}

// -----------------------------------------------------------------------------
// GRUPO 2: Um erro sem correção registrada
// -----------------------------------------------------------------------------
console.log('\n--- GRUPO 2: Um erro sem correção registrada ---');
{
  const notesErrorWithoutCorrection = `
    <div>he cannot to come <span data-tag-type="incorrect">✗</span></div>
  `;

  const markings = parseNotesHtml(notesErrorWithoutCorrection);
  assert(markings.errors.length === 1, '2.1: Parser identifica 1 erro isolado');
  assert(markings.errors[0].original === 'he cannot to come', '2.2: Erro original é "he cannot to come"');
  assert(markings.errors[0].corrected === undefined, '2.3: Correção não informada pelo professor');
  assert(markings.errors[0].isPendingConfirmation === true, '2.4: isPendingConfirmation é true');

  const local = generateLocalPedagogicalTransformation({
    rawNotes: notesErrorWithoutCorrection,
    studentLevel: EnglishLevel.INTERMEDIATE,
    language: 'pt',
  });

  assert(local.mistakesAnalysis.length === 1, '2.5: mistakesAnalysis contém 1 item');
  assert(local.mistakesAnalysis[0].original === 'he cannot to come', '2.6: original preservado');
  assert(
    local.mistakesAnalysis[0].corrected.includes('Pendente de confirmação'),
    '2.7: corrected indica confirmação pendente com o professor'
  );
  assert(
    local.mistakesAnalysis[0].corrected !== "we can't have",
    '2.8: CRÍTICO: "he cannot to come" NÃO recebe a correção pré-fabricada "we can\'t have"'
  );
  assert(
    local.mistakesAnalysis[0].corrected !== 'he cannot come',
    '2.9: Correção não é inventada localmente por heurística'
  );
  assert(local.mistakesAnalysis[0].isPendingConfirmation === true, '2.10: isPendingConfirmation é true');
  assert(local.mistakesAnalysis[0].twoExamples.length === 0, '2.11: twoExamples é lista vazia');
  assert(local.grammarPoints.length === 0, '2.12: Zero regras gramaticais inventadas');
  assert(local.vocabularyAndExpressions.length === 0, '2.13: Zero vocabulário inventado');
}

// -----------------------------------------------------------------------------
// GRUPO 3: Vários erros e correções
// -----------------------------------------------------------------------------
console.log('\n--- GRUPO 3: Vários erros e correções ---');
{
  const notesMultiple = `
    <div>She don't know ✗ She doesn't know ✓</div>
    <div>I has 20 years ✗ I am 20 years old ✓</div>
    <div>we can't to see ✗ we can't see ✓</div>
  `;

  const markings = parseNotesHtml(notesMultiple);
  assert(markings.errors.length === 3, '3.1: Parser identifica 3 erros');

  const local = generateLocalPedagogicalTransformation({
    rawNotes: notesMultiple,
    studentLevel: EnglishLevel.INTERMEDIATE,
    language: 'pt',
  });

  assert(local.mistakesAnalysis.length === 3, '3.2: mistakesAnalysis tem 3 itens');
  assert(local.mistakesAnalysis[0].original === "She don't know", '3.3a: Erro 1 original');
  assert(local.mistakesAnalysis[0].corrected === "She doesn't know", '3.3b: Erro 1 correção');
  assert(local.mistakesAnalysis[1].original === 'I has 20 years', '3.4a: Erro 2 original');
  assert(local.mistakesAnalysis[1].corrected === 'I am 20 years old', '3.4b: Erro 2 correção');
  assert(local.mistakesAnalysis[2].original === "we can't to see", '3.5a: Erro 3 original');
  assert(local.mistakesAnalysis[2].corrected === "we can't see", '3.5b: Erro 3 correção é "we can\'t see"');
  assert(
    local.mistakesAnalysis[2].corrected !== "we can't have",
    '3.5c: CRÍTICO: "we can\'t to see" NÃO recebe a correção pré-fabricada "we can\'t have"'
  );
  assert(local.reviewSummary.essentialCorrections.length === 3, '3.6: Quick Review contém as 3 correções');
  assert(local.grammarPoints.length === 0, '3.7: Zero regras gramaticais artificiais');
}

// -----------------------------------------------------------------------------
// GRUPO 4: Somente vocabulário
// -----------------------------------------------------------------------------
console.log('\n--- GRUPO 4: Somente vocabulário ---');
{
  const notesVocabOnly = `
    <div>serendipity <span data-tag-type="new-word">✦ New Word</span></div>
    <div>schedule <span data-tag-type="pronounce">🎯 Pronounce</span></div>
  `;

  const markings = parseNotesHtml(notesVocabOnly);
  assert(markings.errors.length === 0, '4.1: Zero erros registrados');
  assert(markings.newWords.length === 1 && markings.newWords[0] === 'serendipity', '4.2: 1 new-word extraída');
  assert(markings.pronounceItems.length === 1 && markings.pronounceItems[0] === 'schedule', '4.3: 1 pronounce extraído');

  const local = generateLocalPedagogicalTransformation({
    rawNotes: notesVocabOnly,
    studentLevel: EnglishLevel.INTERMEDIATE,
    language: 'pt',
  });

  assert(local.mistakesAnalysis.length === 0, '4.4: mistakesAnalysis é lista vazia');
  assert(local.grammarPoints.length === 0, '4.5: grammarPoints é lista vazia');
  assert(local.vocabularyAndExpressions.length === 2, '4.6: vocabularyAndExpressions tem 2 itens');
  assert(local.vocabularyAndExpressions[0].term === 'serendipity', '4.7: termo 1 é serendipity');
  assert(local.vocabularyAndExpressions[0].collocations.length === 0, '4.8: collocations é vazio (zero inventados)');
  assert(local.vocabularyAndExpressions[0].realExamples.length === 0, '4.9: realExamples é vazio (zero inventados)');
  assert(local.vocabularyAndExpressions[0].synonyms.length === 0, '4.10: synonyms é vazio (zero inventados)');
  assert(local.vocabularyAndExpressions[1].term === 'schedule', '4.11: termo 2 é schedule');
  assert(local.vocabularyAndExpressions[1].isPronunciationFocus === true, '4.12: schedule é foco de pronúncia');
  assert(local.reviewSummary.keyRules.length === 0, '4.13: Quick Review keyRules é vazio');
  assert(local.reviewSummary.essentialCorrections.length === 0, '4.14: Quick Review essentialCorrections é vazio');
  assert(local.reviewSummary.mustKnowVocabulary.length === 2, '4.15: Quick Review mustKnowVocabulary tem 2 itens');
}

// -----------------------------------------------------------------------------
// GRUPO 5: Somente gramática (correções gramaticais sem vocabulário)
// -----------------------------------------------------------------------------
console.log('\n--- GRUPO 5: Somente gramática (correções gramaticais sem vocabulário) ---');
{
  const notesGrammarOnly = `
    <div>If I would know ✗ If I had known ✓</div>
    <div>I look forward to see you ✗ I look forward to seeing you ✓</div>
  `;

  const markings = parseNotesHtml(notesGrammarOnly);
  assert(markings.errors.length === 2, '5.1: 2 erros gramaticais extraídos');
  assert(markings.newWords.length === 0, '5.2: Zero termos de novo vocabulário');
  assert(markings.pronounceItems.length === 0, '5.3: Zero termos de pronúncia');

  const local = generateLocalPedagogicalTransformation({
    rawNotes: notesGrammarOnly,
    studentLevel: EnglishLevel.INTERMEDIATE,
    language: 'pt',
  });

  assert(local.mistakesAnalysis.length === 2, '5.4: mistakesAnalysis tem 2 itens');
  assert(local.grammarPoints.length === 0, '5.5: grammarPoints é lista vazia no fallback local (sem IA)');
  assert(local.vocabularyAndExpressions.length === 0, '5.6: vocabularyAndExpressions estritamente vazio');
  assert(local.reviewSummary.mustKnowVocabulary.length === 0, '5.7: Quick Review mustKnowVocabulary é vazio');
  assert(local.reviewSummary.essentialCorrections.length === 2, '5.8: Quick Review essentialCorrections tem 2 itens');
}

// -----------------------------------------------------------------------------
// GRUPO 6: Ausência de conteúdo
// -----------------------------------------------------------------------------
console.log('\n--- GRUPO 6: Ausência de conteúdo ---');
{
  assert(!hasValidPedagogicalContent(''), '6.1: String vazia rejeitada por hasValidPedagogicalContent');
  assert(!hasValidPedagogicalContent('   \n\t  '), '6.2: Espaços em branco rejeitados');
  assert(
    !hasValidPedagogicalContent('<p><br></p><div>&nbsp;</div>'),
    '6.3: Tags HTML vazias e espaços rejeitados'
  );

  const localEmpty = generateLocalPedagogicalTransformation({
    rawNotes: '',
    studentLevel: EnglishLevel.INTERMEDIATE,
    language: 'pt',
  });

  assert(localEmpty.mistakesAnalysis.length === 0, '6.4: mistakesAnalysis vazio');
  assert(localEmpty.grammarPoints.length === 0, '6.5: grammarPoints vazio');
  assert(localEmpty.vocabularyAndExpressions.length === 0, '6.6: vocabularyAndExpressions vazio');
  assert(localEmpty.reviewSummary.keyRules.length === 0, '6.7: keyRules vazio');
  assert(localEmpty.reviewSummary.mustKnowVocabulary.length === 0, '6.8: mustKnowVocabulary vazio');
  assert(localEmpty.reviewSummary.essentialCorrections.length === 0, '6.9: essentialCorrections vazio');
}

// -----------------------------------------------------------------------------
// GRUPO 7: Gemini indisponível (estado AI Enrichment Unavailable)
// -----------------------------------------------------------------------------
console.log('\n--- GRUPO 7: Gemini indisponível (estado AI Enrichment Unavailable) ---');
{
  const rawNotes = `
    <div>we can't to have ✗ we can't have ✓</div>
    <div>breakthrough <span data-tag-type="new-word">✦ New Word</span></div>
  `;

  const fallback = generateLocalPedagogicalTransformation({
    rawNotes,
    studentLevel: EnglishLevel.INTERMEDIATE,
    language: 'pt',
  });

  assert(fallback.isAiGenerated === false, '7.1: isAiGenerated é false');
  assert(fallback.isFallback === true, '7.2: isFallback é true');
  assert(fallback.isProvisional === true, '7.3: isProvisional é true');
  assert(fallback.fallbackReason === 'AI_UNAVAILABLE', '7.4: fallbackReason é AI_UNAVAILABLE');
  assert(fallback.source === 'fallback', '7.5: source é fallback');
  assert(
    Boolean(fallback.aiNotice && fallback.aiNotice.includes('indisponível')),
    '7.6: aiNotice informa indisponibilidade transparente da IA'
  );
  assert(fallback.mistakesAnalysis.length === 1, '7.7: Preserva o erro do professor');
  assert(fallback.vocabularyAndExpressions.length === 1, '7.8: Preserva o vocabulário do professor');
  assert(fallback.grammarPoints.length === 0, '7.9: Não fabrica regras de gramática');
}

// -----------------------------------------------------------------------------
// GRUPO 8: Resposta Gemini válida
// -----------------------------------------------------------------------------
console.log('\n--- GRUPO 8: Resposta Gemini válida ---');
{
  const rawNotes = `
    <div>we can't to have ✗ we can't have ✓</div>
    <div>breakthrough <span data-tag-type="new-word">✦ New Word</span></div>
  `;
  const markings = parseNotesHtml(rawNotes);

  const validGeminiResponse = {
    mistakesAnalysis: [
      {
        id: 'mistake-1',
        original: "we can't to have",
        corrected: "we can't have",
        category: 'grammar',
        explanation: 'Após o modal can/can\'t, utiliza-se o infinitivo sem to (bare infinitive).',
        twoExamples: [
          "We can't have another meeting without a clear agenda.",
          'You can call me whenever you are free.',
        ],
        commonPitfalls: 'Inserir "to" após o verbo modal "can".',
      },
    ],
    grammarPoints: [
      {
        id: 'grammar-1',
        topic: 'Modal Verbs: Bare Infinitive',
        rule: 'Modal auxiliary verbs are followed by the base form of the verb without "to".',
        form: 'Subject + Modal + Base Verb',
        usage: 'Expressing ability, possibility, or negation.',
        examples: ["We can't have delays.", 'She can help us.'],
        commonMistakes: 'Saying "can to have" instead of "can have".',
        comparisons: 'can\'t have vs don\'t have to',
      },
    ],
    vocabularyAndExpressions: [
      {
        id: 'vocab-1',
        term: 'breakthrough',
        partOfSpeech: 'Noun',
        definitionEn: 'An important discovery or event that helps to improve a situation.',
        simpleDefinition: 'Um avanço importante ou descoberta significativa.',
        collocations: ['major breakthrough', 'scientific breakthrough'],
        realExamples: ['Scientists made a major breakthrough in cancer research.'],
        synonyms: ['advance', 'leap forward'],
        register: 'neutral',
        category: 'New Words & Expressions (Alt+W)',
      },
    ],
    reviewSummary: {
      estimatedMinutes: '5–10 minutes',
      keyRules: ['Modal Verbs: Bare Infinitive: Modal auxiliary verbs are followed by the base form...'],
      mustKnowVocabulary: ['✨ breakthrough (Noun) — Um avanço importante...'],
      essentialCorrections: [{ original: "we can't to have", corrected: "we can't have" }],
      rememberThis: 'Lembre-se: Após verbos modais, utilize o verbo na forma base sem to!',
    },
  };

  const validation = validatePedagogicalAiResponse(validGeminiResponse, markings, 'B1', 'pt');
  assert(validation.valid === true, '8.1: Resposta Gemini válida aprovada pelo validador');

  const genericCheck = isLegacyGenericTransformation(
    {
      ...validGeminiResponse,
      isAiGenerated: true,
      isFallback: false,
      isProvisional: false,
    },
    rawNotes
  );
  assert(genericCheck === false, '8.2: Resposta Gemini válida não é classificada como genérica legada');
}

// -----------------------------------------------------------------------------
// GRUPO 9: Resposta Gemini inválida
// -----------------------------------------------------------------------------
console.log('\n--- GRUPO 9: Resposta Gemini inválida ---');
{
  const rawNotes = `
    <div>we can't to have ✗ we can't have ✓</div>
    <div>breakthrough <span data-tag-type="new-word">✦ New Word</span></div>
  `;
  const markings = parseNotesHtml(rawNotes);

  // 9a. Omissão de erro
  const missingError = {
    mistakesAnalysis: [],
    vocabularyAndExpressions: [
      {
        term: 'breakthrough',
        definitionEn: 'A sudden, dramatic, and important discovery or development.',
        simpleDefinition: 'Um avanço importante.',
        realExamples: ['Major breakthrough in tech.'],
      },
    ],
  };
  const valMissingError = validatePedagogicalAiResponse(missingError, markings, 'B1', 'pt');
  assert(valMissingError.valid === false, '9.1a: Rejeita resposta que omite erro do professor');
  assert(Boolean(valMissingError.reason?.includes('mistakesAnalysis')), '9.1b: Motivo indica omissão de mistakesAnalysis');

  // 9b. Omissão de vocabulário Alt+W
  const missingVocab = {
    mistakesAnalysis: [
      {
        original: "we can't to have",
        corrected: "we can't have",
        explanation: 'Modal rule explanation.',
        twoExamples: ['Example 1', 'Example 2'],
      },
    ],
    vocabularyAndExpressions: [],
  };
  const valMissingVocab = validatePedagogicalAiResponse(missingVocab, markings, 'B1', 'pt');
  assert(valMissingVocab.valid === false, '9.2a: Rejeita resposta que omite termo Alt+W');
  assert(Boolean(valMissingVocab.reason?.includes('vocabularyAndExpressions')), '9.2b: Motivo indica omissão de vocabulário');

  // 9c. Definições genéricas pré-fabricadas
  const genericDef = {
    mistakesAnalysis: [
      {
        original: "we can't to have",
        corrected: "we can't have",
        explanation: 'Modal rule explanation.',
        twoExamples: ['Example 1', 'Example 2'],
      },
    ],
    vocabularyAndExpressions: [
      {
        term: 'breakthrough',
        definitionEn: 'Key communicative expression to enrich speaking flow and vocabulary range.',
        simpleDefinition: 'Expressão comunicativa fundamental para o nível B1.',
        realExamples: ['Didactic example for breakthrough.'],
      },
    ],
  };
  const valGenericDef = validatePedagogicalAiResponse(genericDef, markings, 'B1', 'pt');
  assert(valGenericDef.valid === false, '9.3: Rejeita resposta com definições de template genérico');

  // 9d. Inserção de vocabulário mockado não presente
  const notesNoVocab = `<div>I went to office ✗ I went to the office ✓</div>`;
  const markingsNoVocab = parseNotesHtml(notesNoVocab);
  const syntheticVocab = {
    mistakesAnalysis: [
      {
        original: 'I went to office',
        corrected: 'I went to the office',
        explanation: 'Article explanation.',
        twoExamples: ['Ex 1', 'Ex 2'],
      },
    ],
    vocabularyAndExpressions: [
      {
        term: 'catch up',
        definitionEn: 'To talk with someone you have not seen in a while.',
        simpleDefinition: 'Colocar o papo em dia.',
        realExamples: ['Let us catch up soon.'],
      },
    ],
  };
  const valSynthetic = validatePedagogicalAiResponse(syntheticVocab, markingsNoVocab, 'B1', 'pt');
  assert(valSynthetic.valid === false, '9.4: Rejeita resposta que insere vocabulário sintético ("catch up")');
}

// -----------------------------------------------------------------------------
// GRUPO 10: TESTE CRÍTICO — Frase diferente de "we can't to have" JAMAIS
//            recebe automaticamente a correção fixa "we can't have"
// -----------------------------------------------------------------------------
console.log('\n--- GRUPO 10: TESTE CRÍTICO — Nenhuma correção fixa atribuída ---');
{
  const phrasesToTest = [
    'he cannot to come',
    'they should to wait',
    'I must to go',
    'she can to play',
    'we can\'t to leave',
    'we could to do it',
    'you will to see',
  ];

  for (const phrase of phrasesToTest) {
    const rawNote = `<div>${phrase} <span data-tag-type="incorrect">✗</span></div>`;
    const local = generateLocalPedagogicalTransformation({
      rawNotes: rawNote,
      studentLevel: EnglishLevel.INTERMEDIATE,
      language: 'pt',
    });

    assert(local.mistakesAnalysis.length === 1, `10.1 [${phrase}]: erro extraído`);
    assert(
      local.mistakesAnalysis[0].corrected !== "we can't have",
      `10.2 [${phrase}]: CRÍTICO: NÃO recebeu "we can't have"! (recebeu: "${local.mistakesAnalysis[0].corrected}")`
    );
    assert(
      local.mistakesAnalysis[0].isPendingConfirmation === true,
      `10.3 [${phrase}]: marcado como confirmação pendente pois professor não deu correção`
    );
  }

  // Mesmo para "we can't to have", se o professor NÃO deu a correção "we can't have",
  // ela NÃO deve ser fornecida automaticamente no fallback!
  const weCantToHaveWithoutCorrection = `<div>we can't to have ✗</div>`;
  const localWithoutCorr = generateLocalPedagogicalTransformation({
    rawNotes: weCantToHaveWithoutCorrection,
    studentLevel: EnglishLevel.INTERMEDIATE,
    language: 'pt',
  });
  assert(
    localWithoutCorr.mistakesAnalysis[0].corrected !== "we can't have",
    '10.4: "we can\'t to have" sem correção explícita do professor NÃO recebe "we can\'t have" automaticamente'
  );
  assert(
    localWithoutCorr.mistakesAnalysis[0].isPendingConfirmation === true,
    '10.5: "we can\'t to have" sem correção explícita fica como confirmação pendente com o professor'
  );
}

// -----------------------------------------------------------------------------
// GRUPO 11: Nenhuma fixture ou resposta pré-programada utilizada em execução real
// -----------------------------------------------------------------------------
console.log('\n--- GRUPO 11: Nenhuma fixture ou resposta pré-programada utilizada em execução real ---');
{
  // Test L1 patterns are gone:
  // "I have 20 years ✗" without correction should NOT become "I am 28 years old"
  const ageNote = `<div>I have 20 years ✗</div>`;
  const transAge = generateLocalPedagogicalTransformation({ rawNotes: ageNote, language: 'pt' });
  assert(transAge.mistakesAnalysis[0].corrected !== 'I am 28 years old', '11.1: Sem "I am 28 years old" fixo');
  assert(transAge.mistakesAnalysis[0].isPendingConfirmation === true, '11.2: Confirmação pendente para idade');

  // "I am agree ✗" without correction should NOT become "I agree with you"
  const agreeNote = `<div>I am agree ✗</div>`;
  const transAgree = generateLocalPedagogicalTransformation({ rawNotes: agreeNote, language: 'pt' });
  assert(transAgree.mistakesAnalysis[0].corrected !== 'I agree with you', '11.3: Sem "I agree with you" fixo');
  assert(transAgree.mistakesAnalysis[0].isPendingConfirmation === true, '11.4: Confirmação pendente para agree');

  // "depend of ✗" without correction should NOT become "It depends on the weather"
  const dependNote = `<div>it depend of ✗</div>`;
  const transDepend = generateLocalPedagogicalTransformation({ rawNotes: dependNote, language: 'pt' });
  assert(transDepend.mistakesAnalysis[0].corrected !== 'It depends on the weather', '11.5: Sem "It depends on the weather" fixo');

  // "make a question ✗" without correction should NOT become "Can I ask a question?"
  const makeQuestionNote = `<div>can I make a question ✗</div>`;
  const transQuestion = generateLocalPedagogicalTransformation({ rawNotes: makeQuestionNote, language: 'pt' });
  assert(transQuestion.mistakesAnalysis[0].corrected !== 'Can I ask a question?', '11.6: Sem "Can I ask a question?" fixo');
}

// -----------------------------------------------------------------------------
// RESUMO FINAL
// -----------------------------------------------------------------------------
console.log('\n======================================================================');
console.log(`TOTAL DE TESTES FASE AI-STD.4: ${totalTests} | APROVADOS: ${passedTests} | FALHAS: ${failedTests}`);
console.log('======================================================================');

if (failedTests > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
