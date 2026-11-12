/**
 * SUÍTE DE TESTES OBRIGATÓRIOS — FASE AI-STD.3
 * Harmonização do Contrato Pedagógico do Native Friends Notes
 * 
 * Execução: npx tsx test/validate-fase-ai-std-3-harmonization.ts
 */

import {
  parseNotesHtml,
  cleanExpressionTerm,
  hasValidPedagogicalContent,
  isPedagogicalTermMatch,
} from '../src/utils/notesHtmlParser';
import {
  generateLocalPedagogicalTransformation,
  validatePedagogicalAiResponse,
  isLegacyGenericTransformation,
  getCanonicalSessionKey,
  computeNotesHash,
} from '../src/utils/pedagogicalTransformer';

let passed = 0;
let failed = 0;

function assert(condition: unknown, msg: string) {
  if (Boolean(condition)) {
    console.log(`  ✅ [PASS] ${msg}`);
    passed++;
  } else {
    console.error(`  ❌ [FAIL] ${msg}`);
    failed++;
  }
}

async function runSuite() {
  console.log('======================================================================');
  console.log('FASE AI-STD.3 — SUÍTE DE TESTES: HARMONIZAÇÃO DO CONTRATO PEDAGÓGICO');
  console.log('======================================================================\n');

  // -----------------------------------------------------------------------------
  // GRUPO 1: Parser & Associação de Erros / Correções (Seção A)
  // -----------------------------------------------------------------------------
  console.log('--- GRUPO 1: Parser & Associação de Marcações ---');

  // 1.1 Um erro e uma correção na mesma linha
  {
    const sameLine1 = `we can't to have <span data-tag-type="incorrect">✗</span> we can't have <span data-tag-type="correct">✓</span>`;
    const res1 = parseNotesHtml(sameLine1);
    assert(res1.errors.length === 1, '1.1a: Identifica exatamente 1 erro na mesma linha');
    assert(res1.errors[0]?.original === "we can't to have", '1.1b: Texto incorreto extraído corretamente');
    assert(res1.errors[0]?.corrected === "we can't have", '1.1c: Correção na mesma linha associada com precisão');
    assert(res1.errors[0]?.isPendingConfirmation === false, '1.1d: isPendingConfirmation é false');
  }

  // 1.2 Tags antes do texto na mesma linha
  {
    const sameLine2 = `✗ we can't to have ✓ we can't have`;
    const res2 = parseNotesHtml(sameLine2);
    assert(res2.errors.length === 1 && res2.errors[0].corrected === "we can't have", '1.2: Suporta tags unicode antes do texto na mesma linha');
  }

  // 1.3 Em linhas diferentes com <div>
  {
    const multiDiv = `<div>we can't to have ✗</div><div>we can't have ✓</div>`;
    const res3 = parseNotesHtml(multiDiv);
    assert(res3.errors.length === 1, '1.3a: Identifica 1 erro em elementos <div> separados');
    assert(res3.errors[0]?.corrected === "we can't have", '1.3b: Associa correção consecutiva em <div> subsequente');
    assert(res3.positives.length === 0, '1.3c: Correção consecutiva não vaza para positives');
  }

  // 1.4 Em linhas diferentes com <br>
  {
    const multiBr = `we can't to have ✗<br>we can't have ✓`;
    const res4 = parseNotesHtml(multiBr);
    assert(res4.errors.length === 1 && res4.errors[0].corrected === "we can't have", '1.4: Suporta quebras de linha com <br>');
  }

  // 1.5 Reconhece correções sem os prefixos say:, better: ou correction:
  {
    const noPrefix = `<div>he don't know ✗</div><div>he doesn't know ✓</div>`;
    const res5 = parseNotesHtml(noPrefix);
    assert(res5.errors.length === 1 && res5.errors[0].corrected === "he doesn't know", '1.5: Reconhece correção sem necessidade de say:/better:');
  }

  // 1.6 Vários erros e correções consecutivas
  {
    const multiPairs = `
      <div>i have 20 years ✗</div>
      <div>i am 20 years old ✓</div>
      <div>she go to school ✗</div>
      <div>she goes to school ✓</div>
    `;
    const res6 = parseNotesHtml(multiPairs);
    assert(res6.errors.length === 2, '1.6a: Identifica 2 erros consecutivos');
    assert(res6.errors[0]?.corrected === 'i am 20 years old', '1.6b: Primeiro par associado corretamente');
    assert(res6.errors[1]?.corrected === 'she goes to school', '1.6c: Segundo par associado corretamente');
    assert(res6.errors.every((e) => !e.isPendingConfirmation), '1.6d: Nenhum par legítimo fica marcado como pendente');
  }

  // 1.7 Correções ambíguas (2 erros seguidos de 1 correção)
  {
    const ambiguous = `
      <div>error one ✗</div>
      <div>error two ✗</div>
      <div>correction for something ✓</div>
    `;
    const res7 = parseNotesHtml(ambiguous);
    assert(res7.errors.length === 2, '1.7a: Preserva ambos os textos originais em notas ambíguas');
    assert(res7.errors[0]?.isPendingConfirmation === true, '1.7b: Primeiro erro ambíguo sinalizado como pendente');
    assert(res7.errors[1]?.isPendingConfirmation === true, '1.7c: Segundo erro ambíguo sinalizado como pendente sem inventar correção');
  }

  // 1.8 Erro isolado sem correção
  {
    const uncorrected = `<div>she didn't came ✗</div>`;
    const res8 = parseNotesHtml(uncorrected);
    assert(res8.errors.length === 1, '1.8a: Identifica erro isolado');
    assert(res8.errors[0]?.corrected === undefined, '1.8b: Correção permanece indefinida');
    assert(res8.errors[0]?.isPendingConfirmation === true, '1.8c: isPendingConfirmation é true');
  }

  // 1.9 Correção positiva isolada (sem erro prévio)
  {
    const positiveOnly = `<div>✓ Great pronunciation on vocabulary words</div>`;
    const res9 = parseNotesHtml(positiveOnly);
    assert(res9.errors.length === 0, '1.9a: Nenhum erro registrado');
    assert(res9.positives.length === 1, '1.9b: Marcação correta isolada entra como positive');
    assert(res9.positives[0].includes('Great pronunciation'), '1.9c: Texto da expressão dominada preservado');
  }

  // 1.10 Marcações com spans que envolvem texto
  {
    const wrappedSpan = `<span class="inline-coaching-tag incorrect-tag" data-tag-type="incorrect">we can't to have</span><br><span class="inline-coaching-tag correct-tag" data-tag-type="correct">we can't have</span>`;
    const res10 = parseNotesHtml(wrappedSpan);
    assert(res10.errors.length === 1 && res10.errors[0].corrected === "we can't have", '1.10: Suporta spans que envolvem diretamente os termos');
  }

  // 1.11 Badges vazios / órfãos
  {
    const emptyBadge = `<div>we can't to have ✗</div><div>we can't have ✓</div><div><span data-tag-type="new-word">✦ New Word</span></div>`;
    const res11 = parseNotesHtml(emptyBadge);
    assert(res11.newWordCount === 0, '1.11a: Badge vazio não gera contagem fantasma de new words');
    assert(res11.newWords.length === 0, '1.11b: Array newWords permanece vazio');
  }

  // -----------------------------------------------------------------------------
  // GRUPO 2: Caso de Regressão Obrigatório de 11/11 (Seção D)
  // -----------------------------------------------------------------------------
  console.log('\n--- GRUPO 2: Caso de Regressão Obrigatório de 11/11 ---');

  const fixture1111 = `
    <div>we can't to have <span class="inline-coaching-tag incorrect-tag" data-tag-type="incorrect">✗</span></div>
    <div>we can't have <span class="inline-coaching-tag correct-tag" data-tag-type="correct">✓</span></div>
    <div>we do not use "to" after verbs suchs as can and help ,motly model verbs</div>
    <div><span class="inline-coaching-tag new-word-tag" data-tag-type="new-word">✦ New Word</span></div>
  `;

  const parsed1111 = parseNotesHtml(fixture1111);

  assert(parsed1111.errors.length === 1, '2.1: Exatamente um erro identificado na fixture de 11/11');
  assert(parsed1111.errors[0]?.original === "we can't to have", '2.2: Texto incorreto é "we can\'t to have"');
  assert(parsed1111.errors[0]?.corrected === "we can't have", '2.3: Correção associada é "we can\'t have"');
  assert(parsed1111.errors[0]?.isPendingConfirmation === false, '2.4: Nenhuma correção pendente artificial');
  assert(
    parsed1111.errors[0]?.context?.includes('we do not use "to" after verbs'),
    '2.5: Contexto preserva explicação do professor'
  );

  const localTransformation = generateLocalPedagogicalTransformation({
    rawNotes: fixture1111,
    topic: 'Conversational Fluency',
    sessionDate: '2026-11-11',
    teacherName: 'Teacher',
    studentLevel: 'Intermediate',
    language: 'pt',
  });

  assert(localTransformation.mistakesAnalysis.length === 1, '2.6: mistakesAnalysis tem exatamente 1 item');
  assert(
    localTransformation.mistakesAnalysis[0].corrected === "we can't have",
    '2.7: Correção aplicada com precisão na análise pedagógica'
  );
  assert(
    localTransformation.mistakesAnalysis[0].isPendingConfirmation === false,
    '2.8: Status confirmado (não pendente)'
  );
  assert(
    localTransformation.grammarPoints.length === 0,
    '2.9: Zero regras gramaticais pré-fabricadas geradas no fallback local (preservação fiel às anotações)'
  );
  assert(
    localTransformation.vocabularyAndExpressions.length === 0,
    '2.11: Nenhuma palavra de vocabulário inventada (seção legitimamente vazia)'
  );
  assert(
    localTransformation.reviewSummary.keyRules.length === 0,
    '2.12: Quick Review keyRules é lista vazia no fallback local (sem regras inventadas)'
  );
  assert(
    localTransformation.reviewSummary.essentialCorrections.length === 1,
    '2.13: Quick Review contém exatamente a 1 correção essencial'
  );

  // -----------------------------------------------------------------------------
  // GRUPO 3: Harmonização do Validador Pedagógico (Seção C)
  // -----------------------------------------------------------------------------
  console.log('\n--- GRUPO 3: Harmonização do Validador Pedagógico ---');

  // 3.1 Resposta Gemini válida para o caso 11/11 (1 erro, 1 regra gramatical, sem vocabulário)
  {
    const validAiFixture = {
      mistakesAnalysis: [
        {
          id: 'mistake-1',
          original: "we can't to have",
          corrected: "we can't have",
          category: 'grammar',
          explanation: 'Após o verbo modal can/can\'t, utiliza-se o infinitivo sem to (bare infinitive).',
          twoExamples: [
            "We can't have another meeting without a clear agenda.",
            'You can call me whenever you are free.',
          ],
          commonPitfalls: 'Inserir "to" após o modal "can".',
        },
      ],
      grammarPoints: [
        {
          id: 'grammar-1',
          topic: 'Verbos Modais: Infinitivo sem "to"',
          rule: 'Após verbos modais como can, could, should e must, utilize o verbo principal na forma base sem to.',
          form: 'Sujeito + Modal (can / can\'t) + Verbo Base',
          usage: 'Expressar capacidade, permissão, possibilidade ou negação.',
          examples: ["We can't have delays.", 'She can help us.'],
          commonMistakes: 'Dizer "can to have" em vez de "can have".',
          comparisons: 'can\'t have (modal) vs don\'t have to (semi-modal com to)',
        },
      ],
      vocabularyAndExpressions: [],
      reviewSummary: {
        estimatedMinutes: '5–10 minutes',
        keyRules: ['Verbos Modais: Infinitivo sem "to"'],
        mustKnowVocabulary: [],
        essentialCorrections: [{ original: "we can't to have", corrected: "we can't have" }],
        rememberThis: 'Lembre-se: Após verbos modais, utilize sempre o verbo na forma base sem to!',
      },
    };

    const valResult = validatePedagogicalAiResponse(validAiFixture, parsed1111, 'B1', 'pt');
    assert(valResult.valid === true, '3.1: Validador APROVA resposta válida com 1 erro, 1 regra e vocabulário vazio');
  }

  // 3.2 Resposta Gemini incompleta que omite o erro registrado
  {
    const incompleteAi = {
      mistakesAnalysis: [],
      grammarPoints: [],
      vocabularyAndExpressions: [],
      reviewSummary: { estimatedMinutes: '5 min', keyRules: [], mustKnowVocabulary: [], essentialCorrections: [], rememberThis: 'Regra' },
    };
    const valIncomplete = validatePedagogicalAiResponse(incompleteAi, parsed1111, 'B1', 'pt');
    assert(valIncomplete.valid === false, '3.2a: Validador REJEITA resposta que omite erro registrado');
    assert(valIncomplete.reason?.includes('mistakesAnalysis'), '3.2b: Razão indica omissão de erros');
  }

  // 3.3 Resposta Gemini com termo obrigatório de vocabulário ausente
  {
    const notesWithVocab = parseNotesHtml(`<div>breakthrough <span data-tag-type="new-word">✦ New Word</span></div>`);
    const aiMissingTerm = {
      mistakesAnalysis: [],
      grammarPoints: [],
      vocabularyAndExpressions: [
        {
          id: 'vocab-1',
          term: 'different_word',
          partOfSpeech: 'Noun',
          definitionEn: 'Different definition',
          simpleDefinition: 'Definição',
          collocations: ['use this'],
          realExamples: ['Example.'],
          synonyms: ['word'],
          register: 'neutral',
          category: 'Core',
        },
      ],
      reviewSummary: { estimatedMinutes: '5 min', keyRules: [], mustKnowVocabulary: [], essentialCorrections: [], rememberThis: 'Nota' },
    };
    const valMissingTerm = validatePedagogicalAiResponse(aiMissingTerm, notesWithVocab, 'B1', 'pt');
    assert(valMissingTerm.valid === false, '3.3a: Validador REJEITA resposta que omite termo obrigatório Alt+W');
    assert(valMissingTerm.reason?.includes('breakthrough'), '3.3b: Razão especifica o termo ausente "breakthrough"');
  }

  // 3.4 Resposta Gemini com termos sintéticos inventados quando notas não têm vocabulário
  {
    const aiSyntheticVocab = {
      mistakesAnalysis: [
        {
          id: 'mistake-1',
          original: "we can't to have",
          corrected: "we can't have",
          category: 'grammar',
          explanation: 'Regra válida',
          twoExamples: ['ex1', 'ex2'],
          commonPitfalls: 'pitfall',
        },
      ],
      grammarPoints: [],
      vocabularyAndExpressions: [
        {
          id: 'vocab-1',
          term: 'catch up',
          partOfSpeech: 'Phrasal Verb',
          definitionEn: 'To reach someone',
          simpleDefinition: 'Alcançar',
          collocations: ['catch up'],
          realExamples: ['I need to catch up.'],
          synonyms: ['reach'],
          register: 'neutral',
          category: 'Core',
        },
      ],
      reviewSummary: { estimatedMinutes: '5 min', keyRules: [], mustKnowVocabulary: [], essentialCorrections: [], rememberThis: 'Nota' },
    };
    const valSynthetic = validatePedagogicalAiResponse(aiSyntheticVocab, parsed1111, 'B1', 'pt');
    assert(valSynthetic.valid === false, '3.4: Validador REJEITA vocabulário sintético inventado quando notas não têm vocabulário');
  }

  // 3.5 Notas com somente vocabulário (seção de erros legitimamente vazia)
  {
    const vocabOnlyNotes = parseNotesHtml(`
      <div>streamline <span data-tag-type="new-word">✦ New Word</span></div>
      <div>entrepreneur <span data-tag-type="pronounce">🎯 Pronounce</span></div>
    `);
    assert(vocabOnlyNotes.errors.length === 0, '3.5a: Notas somente de vocabulário têm 0 erros');
    assert(vocabOnlyNotes.newWords.length === 1, '3.5b: 1 new word extraída');
    assert(vocabOnlyNotes.pronounceItems.length === 1, '3.5c: 1 pronounce extraído');

    const validVocabOnlyAi = {
      mistakesAnalysis: [],
      grammarPoints: [],
      vocabularyAndExpressions: [
        {
          id: 'vocab-1',
          term: 'streamline',
          partOfSpeech: 'Verb',
          definitionEn: 'To make an organization or system more efficient by simplifying working methods',
          simpleDefinition: 'Otimizar ou simplificar processos para torná-los mais rápidos e eficientes',
          collocations: ['streamline the process', 'streamline operations'],
          realExamples: ['We need to streamline our weekly workflow to save time.', 'The app streamlines routine tracking.'],
          synonyms: ['simplify', 'optimize'],
          register: 'neutral',
          category: 'New Words & Expressions (Alt+W)',
          isNewWord: true,
        },
        {
          id: 'vocab-2',
          term: 'entrepreneur',
          partOfSpeech: 'Pronunciation Focus',
          definitionEn: 'A person who sets up a business, taking on financial risks',
          simpleDefinition: 'Atenção à pronúncia e tonicidade na última sílaba: /ˌɒntrəprəˈnɜːr/',
          collocations: ['successful entrepreneur'],
          realExamples: ['She is an entrepreneur in the tech sector.'],
          synonyms: ['founder', 'business owner'],
          register: 'neutral',
          category: 'Pronunciation & Phonetics (Alt+P)',
          phoneticGuide: '/ˌɒntrəprəˈnɜːr/ — ênfase na sílaba final',
          isPronunciationFocus: true,
        },
      ],
      reviewSummary: {
        estimatedMinutes: '3–5 minutes',
        keyRules: [],
        mustKnowVocabulary: ['streamline', 'entrepreneur'],
        essentialCorrections: [],
        rememberThis: 'Lembre-se: Pratique a pronúncia correta de "entrepreneur" com a ênfase na última sílaba!',
      },
    };

    const valVocabOnly = validatePedagogicalAiResponse(validVocabOnlyAi, vocabOnlyNotes, 'B1', 'pt');
    assert(valVocabOnly.valid === true, '3.5d: Validador APROVA notas somente com vocabulário (erros e gramática vazios)');
  }

  // 3.6 Rejeição de definições ou exemplos genéricos
  {
    const genericAi = {
      mistakesAnalysis: [
        {
          id: 'mistake-1',
          original: "we can't to have",
          corrected: "we can't have",
          category: 'grammar',
          explanation: 'Regra válida de modal',
          twoExamples: ['Using this during our daily conversation routine with confidence in our routine.'], // Recognized generic template!
          commonPitfalls: 'pitfall',
        },
      ],
      grammarPoints: [],
      vocabularyAndExpressions: [],
      reviewSummary: { estimatedMinutes: '5 min', keyRules: [], mustKnowVocabulary: [], essentialCorrections: [], rememberThis: 'Nota' },
    };
    const valGeneric = validatePedagogicalAiResponse(genericAi, parsed1111, 'B1', 'pt');
    assert(valGeneric.valid === false, '3.6a: Validador REJEITA exemplos genéricos pré-fabricados');
    assert(valGeneric.reason?.includes('generic'), '3.6b: Razão identifica exemplo genérico');
  }

  // -----------------------------------------------------------------------------
  // GRUPO 4: Conteúdo Extenso e Resiliência
  // -----------------------------------------------------------------------------
  console.log('\n--- GRUPO 4: Conteúdo Extenso e Resiliência ---');

  {
    let largeContent = `<div>Session Topic: Strategic Corporate Negotiations</div>`;
    for (let k = 1; k <= 8; k++) {
      largeContent += `<div>error phrasing ${k} ✗</div><div>accurate phrasing ${k} ✓</div>`;
      largeContent += `<div>strategic_term_${k} <span data-tag-type="new-word">✦ New Word</span></div>`;
    }
    const parsedLarge = parseNotesHtml(largeContent);
    assert(parsedLarge.errors.length === 8, '4.1: Parser processa 8 erros em notas extensas sem truncar');
    assert(parsedLarge.newWords.length === 8, '4.2: Parser processa 8 vocabulários em notas extensas');
    assert(parsedLarge.errors.every((e) => e.corrected && !e.isPendingConfirmation), '4.3: Todas as 8 correções associadas 1:1');
  }

  // -----------------------------------------------------------------------------
  // GRUPO 5: Regressões dos Subsistemas Existentes
  // -----------------------------------------------------------------------------
  console.log('\n--- GRUPO 5: Regressões dos Subsistemas Existentes ---');

  // 5.1 Canonical Session Key e Cache Hash
  {
    const cKey1 = getCanonicalSessionKey({
      lessonId: 'lesson_abc123',
      studentUid: 'student_xyz',
    });
    assert(cKey1 === 'lesson_abc123', '5.1a: Canonical session key preserva formato lesson_');

    const hash1 = computeNotesHash("we can't to have");
    const hash2 = computeNotesHash("we can't to have");
    const hash3 = computeNotesHash("different text");
    assert(hash1 === hash2 && hash1 !== hash3, '5.1b: Hash determinístico de versionamento de notas');
  }

  // 5.2 Validação de Não-Regressão de Genericidade (isLegacyGenericTransformation)
  {
    const modernTransformation = generateLocalPedagogicalTransformation({
      rawNotes: fixture1111,
      topic: 'Modal Verbs',
      language: 'pt',
    });
    // Fallback is flagged isFallback: true, so isLegacyGenericTransformation returns true for provisional fallback
    assert(modernTransformation.isFallback === true, '5.2a: Fallback local marcado transparentemente como fallback');

    // Artificial legacy fixture with "I have 28 years old"
    const legacyFixture = {
      isAiGenerated: true,
      isFallback: false,
      mistakesAnalysis: [{ original: 'i have 28 years old', corrected: 'i am 28 years old', twoExamples: ['ex'] }],
      vocabularyAndExpressions: [{ term: 'streamline', simpleDefinition: 'definition' }],
    };
    assert(
      isLegacyGenericTransformation(legacyFixture, fixture1111) === true,
      '5.2b: isLegacyGenericTransformation detecta erro sintético ausente das notas'
    );
  }

  // 5.3 Semantic Content Guard (hasValidPedagogicalContent)
  {
    assert(hasValidPedagogicalContent(fixture1111) === true, '5.3a: Fixture 11/11 possui conteúdo pedagógico válido');
    assert(hasValidPedagogicalContent('   ') === false, '5.3b: Espaços em branco rejeitados');
    assert(hasValidPedagogicalContent('<div><span>✦ New Word</span></div>') === false, '5.3c: Badge órfão sem texto rejeitado');
    assert(hasValidPedagogicalContent('blury') === true, '5.3d: Palavra isolada aceita como vocabulário');
  }

  console.log('\n======================================================================');
  console.log(`TOTAL DE TESTES FASE AI-STD.3: ${passed + failed} | APROVADOS: ${passed} | FALHAS: ${failed}`);
  console.log('======================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runSuite().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
