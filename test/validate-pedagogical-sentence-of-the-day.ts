/**
 * TEST SUITE: MELHORIA PEDAGÓGICA DA SENTENCE OF THE DAY
 * 
 * Validação rigorosa dos novos critérios pedagógicos:
 * 1. Análise da frase de referência:
 *    "Sometimes I unknowingly make a good rapport with my friends, it helps me to keep closeness in my friendships."
 *    Deve identificar:
 *    - Problema de pontuação entre orações independentes (comma splice).
 *    - Collocation pouco natural "make a good rapport" -> "build rapport".
 *    - Construção pouco natural "keep closeness" -> "maintain close relationships" / "stay close".
 *    - Falta de fluência / redundância em "in my friendships".
 *    - Classificação estrita: Error vs Improvement.
 *    - Versão natural holística ("correctedSentence").
 * 2. Frase já correta:
 *    "I had breakfast with my family this morning and we talked about our upcoming trip."
 *    Deve retornar hasAnyError: false, isCorrect: true, sem inventar erros!
 * 3. Frase com erro gramatical puro:
 *    "Yesterday I go to the store and buys two books."
 *    Deve classificar como Error.
 */

import { evaluateDailySentenceIsolated } from '../serverApp';
import { analyzeSentenceGrammarDeterministic } from '../src/utils/writingChecker';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    process.exit(1);
  }
  console.log(`  ✅ PASS: ${message}`);
}

async function runPedagogicalTests(): Promise<void> {
  console.log('============================================================================');
  console.log(' TEST SUITE: MELHORIA PEDAGÓGICA DA SENTENCE OF THE DAY');
  console.log(' Critérios: Grammar, Punctuation, Collocations, Word Choice, Prepositions, Naturalness');
  console.log('============================================================================\n');

  // -------------------------------------------------------------------------
  // TEST 1: Frase de Referência
  // -------------------------------------------------------------------------
  console.log('--- TEST 1: Avaliação da Frase de Referência com Múltiplos Problemas ---');
  const referenceSentence =
    'Sometimes I unknowingly make a good rapport with my friends, it helps me to keep closeness in my friendships.';

  console.log(`Input: "${referenceSentence}"`);

  const outcome = await evaluateDailySentenceIsolated(referenceSentence, [], {
    level: 'intermediario',
    language: 'pt',
    callerRole: 'student',
  });

  assert(outcome.success === true, '1.1: Chamada executada com sucesso');
  const data = outcome.data;
  assert(data !== null, '1.2: Payload de dados não é nulo');
  assert(data.hasAnyError === true, '1.3: hasAnyError é true devido aos problemas identificados');
  assert(data.isCorrect === false, '1.4: isCorrect é false');

  console.log('\nResultados da Frase de Referência:');
  console.log(`- Versão corrigida: "${data.correctedSentence}"`);
  console.log(`- Explicação geral: "${data.explanation}"`);
  console.log('- Ajustes identificados:');
  data.wordFeedbacks.forEach((wf: any, idx: number) => {
    console.log(`  [${idx + 1}] [${wf.classification || 'Error'}] "${wf.original}" → "${wf.corrected}" (${wf.category})`);
    console.log(`      Explicação: ${wf.explanationPt}`);
    if (wf.example) {
      console.log(`      Exemplo: "${wf.example}"`);
    }
  });

  // Verificar identificação de Collocation "make a good rapport"
  const hasCollocationIssue = data.wordFeedbacks.some(
    (wf: any) =>
      /make.*rapport/i.test(wf.original) ||
      /build.*rapport/i.test(wf.corrected) ||
      /rapport/i.test(wf.original) ||
      /rapport/i.test(wf.corrected) ||
      (wf.category === 'collocation' && /rapport/i.test(wf.explanationPt || ''))
  );
  assert(hasCollocationIssue, '1.5: Identificou a collocation pouco natural "make a good rapport" -> "build rapport"');

  // Verificar identificação de Punctuation / Comma Splice
  const hasPunctuationIssue = data.wordFeedbacks.some(
    (wf: any) =>
      wf.category === 'punctuation' ||
      /,.*it helps/i.test(wf.original) ||
      /comma splice/i.test(wf.explanationPt || '') ||
      /vírgula/i.test(wf.explanationPt || '') ||
      /which helps/i.test(wf.corrected) ||
      /;.*it helps/i.test(wf.corrected)
  );
  assert(hasPunctuationIssue, '1.6: Identificou o problema de pontuação (comma splice) entre orações');

  // Verificar identificação de Naturalness / Phrasing em "keep closeness"
  const hasClosenessIssue = data.wordFeedbacks.some(
    (wf: any) =>
      /keep closeness/i.test(wf.original) ||
      /closeness/i.test(wf.original) ||
      /maintain.*close/i.test(wf.corrected) ||
      /stay.*close/i.test(wf.corrected) ||
      /closeness/i.test(wf.explanationPt || '')
  );
  assert(hasClosenessIssue, '1.7: Identificou a construção pouco natural "keep closeness"');

  // Verificar classificação estrita (Error vs Improvement)
  const hasImprovementClass = data.wordFeedbacks.some(
    (wf: any) => wf.classification === 'Improvement'
  );
  assert(hasImprovementClass, '1.8: Classificou collocations/naturalness como "Improvement"');

  // Verificar versão holística corrigida
  assert(
    data.correctedSentence &&
    data.correctedSentence !== referenceSentence &&
    (/build.*rapport/i.test(data.correctedSentence) || /develop.*rapport/i.test(data.correctedSentence) || /establish.*rapport/i.test(data.correctedSentence)) &&
    (/which helps/i.test(data.correctedSentence) || /; it helps/i.test(data.correctedSentence) || /and it helps/i.test(data.correctedSentence)),
    '1.9: correctedSentence é holística, com build rapport e pontuação resolvida'
  );

  // -------------------------------------------------------------------------
  // TEST 2: Frase Já Correta e Natural (Zero Alucinações)
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 2: Frase Já Correta e Natural (Zero Alucinações) ---');
  const correctSentence =
    'I had breakfast with my family this morning and we talked about our upcoming trip.';

  console.log(`Input: "${correctSentence}"`);

  const correctOutcome = await evaluateDailySentenceIsolated(correctSentence, [], {
    level: 'intermediario',
    language: 'pt',
    callerRole: 'student',
  });

  assert(correctOutcome.success === true, '2.1: Chamada executada com sucesso');
  const correctData = correctOutcome.data;
  assert(correctData.hasAnyError === false, '2.2: hasAnyError é false para frase perfeita');
  assert(correctData.isCorrect === true, '2.3: isCorrect é true para frase perfeita');
  assert(correctData.wordFeedbacks.length === 0, '2.4: Nenhum erro inventado em wordFeedbacks');
  assert(
    correctData.correctedSentence.replace(/[.!?]+$/, '') === correctSentence.replace(/[.!?]+$/, ''),
    '2.5: Frase preservada sem alterações desnecessárias'
  );

  // -------------------------------------------------------------------------
  // TEST 3: Frase com Erro Gramatical Puro (Concordância / Tempo Verbal)
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 3: Frase com Erro Gramatical Puro ---');
  const grammarErrorSentence = 'Yesterday I go to the store and buys two books.';

  console.log(`Input: "${grammarErrorSentence}"`);

  const grammarOutcome = await evaluateDailySentenceIsolated(grammarErrorSentence, [], {
    level: 'intermediario',
    language: 'pt',
    callerRole: 'student',
  });

  assert(grammarOutcome.success === true, '3.1: Chamada executada com sucesso');
  const grammarData = grammarOutcome.data;
  assert(grammarData.hasAnyError === true, '3.2: hasAnyError é true');
  assert(grammarData.isCorrect === false, '3.3: isCorrect é false');

  const hasGrammarErrorClass = grammarData.wordFeedbacks.some(
    (wf: any) => wf.classification === 'Error'
  );
  assert(hasGrammarErrorClass, '3.4: Erros gramaticais estritos foram classificados como "Error"');

  console.log('\n============================================================================');
  console.log(' ✅ TODOS OS TESTES PEDAGÓGICOS DA SENTENCE OF THE DAY FORAM COMPROVADOS!');
  console.log('============================================================================\n');
}

runPedagogicalTests().catch((err) => {
  console.error('Fatal error running pedagogical tests:', err);
  process.exit(1);
});
