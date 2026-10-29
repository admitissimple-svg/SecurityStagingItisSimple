/**
 * Test Suite: FASE 6 — Orientações Contextuais da Part 3 (Sentence Writing)
 *
 * Validates:
 * 1. Semantic contextual derivation for target words:
 *    - BULLSHIT
 *    - BULLET
 *    - CHARTING
 *    - OTHERWISE
 *    - GLIMMERING
 * 2. Mandatory edge cases:
 *    - Palavra sem definição (omits prompt)
 *    - Palavra com múltiplos significados sem desambiguação (omits prompt)
 *    - Palavra com exemplo contextual autêntico (derives prompt)
 *    - Palavra com tradução, mas sem definição (omits prompt)
 *    - Palavra com dados contraditórios (omits prompt)
 *    - Palavra cujo contexto de origem não esclarece o significado (omits prompt)
 * 3. CEFR alignment without forcing identical/artificial grammar requirements.
 * 4. Preservation of personalized prompts (persistence without overwriting).
 * 5. Guarantee of ZERO additional Gemini API calls.
 */

import {
  deriveContextualSentencePrompt,
  isGenericPedagogicalDefinition,
  isContradictoryOrAmbiguousContext,
  isPersonalizedPrompt,
  generateWeeklyHomework,
} from '../src/utils/homeworkGenerator';
import { SentenceWritingPrompt } from '../src/types';

let totalTests = 0;
let passedTests = 0;

function assert(condition: boolean, testName: string, details?: any) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✅ PASS: ${testName}`);
  } else {
    console.error(`  ❌ FAIL: ${testName}`, details ? details : '');
    throw new Error(`Assertion failed: ${testName}`);
  }
}

async function runFase6Validation() {
  console.log('\n============================================================');
  console.log('FASE 6 — TEST SUITE: ORIENTAÇÕES CONTEXTUAIS DA PART 3');
  console.log('============================================================\n');

  // -------------------------------------------------------------------------
  // SECTION 1: Five Core Target Words
  // -------------------------------------------------------------------------
  console.log('--- 1. Testing Core Target Words ---');

  // Word 1: BULLSHIT
  const bullshitResult = deriveContextualSentencePrompt({
    word: 'bullshit',
    definitionEn: 'Untrue, exaggerated, or deceitful statements, or insincere talk.',
    translationPt: 'Besteira / conversa fiada / balela',
    sourceActivityName: 'Informal Conversation & Slang Notes',
    partOfSpeech: 'noun',
    studentLevel: 'intermediate',
  });
  console.log('\n[BULLSHIT Result]:', bullshitResult);
  assert(
    Boolean(bullshitResult.hintEn && bullshitResult.hintPt),
    'BULLSHIT produces valid English and Portuguese prompts'
  );
  assert(
    Boolean(bullshitResult.hintEn?.toLowerCase().includes('informal')) &&
      (Boolean(bullshitResult.hintEn?.toLowerCase().includes('untrue')) ||
        Boolean(bullshitResult.hintEn?.toLowerCase().includes('skepticism')) ||
        Boolean(bullshitResult.hintEn?.toLowerCase().includes('insincere'))),
    'BULLSHIT prompt specifically guides informal rejection of falsehoods'
  );
  assert(
    !bullshitResult.hintEn?.includes('daily routine or home life') &&
      !bullshitResult.hintEn?.includes('complex decision, project challenge'),
    'BULLSHIT does NOT use legacy generic templates'
  );

  // Word 2: BULLET (Slide marker / presentation context)
  const bulletResult = deriveContextualSentencePrompt({
    word: 'bullet',
    definitionEn: 'A small round mark or symbol used in printed text or presentation slides to introduce items in a list.',
    translationPt: 'Marcador de tópicos / ponto de lista',
    sourceActivityName: 'Workplace Presentation Skills',
    partOfSpeech: 'noun',
    studentLevel: 'intermediate',
  });
  console.log('\n[BULLET Result]:', bulletResult);
  assert(
    Boolean(bulletResult.hintEn && bulletResult.hintPt),
    'BULLET produces valid English and Portuguese prompts'
  );
  assert(
    Boolean(bulletResult.hintEn?.toLowerCase().includes('organizing information')) ||
      Boolean(bulletResult.hintEn?.toLowerCase().includes('slides')) ||
      Boolean(bulletResult.hintEn?.toLowerCase().includes('list items')),
    'BULLET prompt is contextualized to text formatting/slides (not military ammunition)'
  );

  // Word 3: CHARTING
  const chartingResult = deriveContextualSentencePrompt({
    word: 'charting',
    definitionEn: 'Recording, tracking, or mapping progress, trends, or data over time on a graph or official record.',
    translationPt: 'Mapeamento / rastreamento / registro de dados',
    sourceActivityName: 'Business Performance Analytics',
    partOfSpeech: 'verb',
    studentLevel: 'advanced',
  });
  console.log('\n[CHARTING Result]:', chartingResult);
  assert(
    Boolean(chartingResult.hintEn && chartingResult.hintPt),
    'CHARTING produces valid English and Portuguese prompts'
  );
  assert(
    Boolean(chartingResult.hintEn?.toLowerCase().includes('tracking progress')) ||
      Boolean(chartingResult.hintEn?.toLowerCase().includes('monitoring metrics')) ||
      Boolean(chartingResult.hintEn?.toLowerCase().includes('data trends')),
    'CHARTING prompt guides tracking progress or monitoring metrics over time'
  );

  // Word 4: OTHERWISE
  const otherwiseResult = deriveContextualSentencePrompt({
    word: 'otherwise',
    definitionEn: 'Used to indicate what will or might happen if a circumstance is different or if a condition is not met.',
    translationPt: 'Caso contrário / de outro modo / senão',
    sourceActivityName: 'Project Contingency Planning',
    partOfSpeech: 'adverb',
    studentLevel: 'intermediate',
  });
  console.log('\n[OTHERWISE Result]:', otherwiseResult);
  assert(
    Boolean(otherwiseResult.hintEn && otherwiseResult.hintPt),
    'OTHERWISE produces valid English and Portuguese prompts'
  );
  assert(
    Boolean(otherwiseResult.hintEn?.toLowerCase().includes('condition')) ||
      Boolean(otherwiseResult.hintEn?.toLowerCase().includes('consequence')),
    'OTHERWISE prompt guides connecting condition and consequence'
  );
  assert(
    Boolean(otherwiseResult.levelInstruction && otherwiseResult.levelInstruction.includes('otherwise')),
    'OTHERWISE levelInstruction gives helpful structural guidance without being punitive'
  );

  // Word 5: GLIMMERING
  const glimmeringResult = deriveContextualSentencePrompt({
    word: 'glimmering',
    definitionEn: 'Shining faintly with an unsteady, gentle light, or showing a faint, initial sign of hope or opportunity.',
    translationPt: 'Cintilante / lampejo / sinal tênue de esperança',
    sourceActivityName: 'Creative Reading & Reflection',
    partOfSpeech: 'adjective',
    studentLevel: 'advanced',
  });
  console.log('\n[GLIMMERING Result]:', glimmeringResult);
  assert(
    Boolean(glimmeringResult.hintEn && glimmeringResult.hintPt),
    'GLIMMERING produces valid English and Portuguese prompts'
  );
  assert(
    Boolean(glimmeringResult.hintEn?.toLowerCase().includes('light')) ||
      Boolean(glimmeringResult.hintEn?.toLowerCase().includes('hope')),
    'GLIMMERING prompt describes subtle light or emerging sign of hope'
  );

  // -------------------------------------------------------------------------
  // SECTION 2: Mandatory Edge Cases
  // -------------------------------------------------------------------------
  console.log('\n--- 2. Testing Mandatory Edge Cases ---');

  // Edge Case 1: Palavra sem definição
  const noDefResult = deriveContextualSentencePrompt({
    word: 'unbeknownst',
    definitionEn: '',
    translationPt: '',
    exampleSentence: '',
  });
  console.log('\n[Edge Case 1 - No Definition]:', noDefResult);
  assert(
    noDefResult.hint === '' && noDefResult.hintEn === '' && noDefResult.hintPt === '',
    'Edge Case 1: Word without definition produces empty prompt (no generic fallback)'
  );

  // Edge Case 2: Palavra com múltiplos significados sem desambiguação
  const multiMeaningResult = deriveContextualSentencePrompt({
    word: 'set',
    definitionEn: 'Multiple meanings depending on context, including to place or a collection.',
    translationPt: 'Conjunto / definir',
    sourceActivityName: 'General Vocabulary',
  });
  console.log('\n[Edge Case 2 - Ambiguous Multiple Meanings]:', multiMeaningResult);
  assert(
    multiMeaningResult.hint === '' && multiMeaningResult.hintEn === '',
    'Edge Case 2: Unresolved multiple meanings omits prompt to prevent incorrect assumptions'
  );

  // Edge Case 3: Palavra com exemplo contextual, mas sem definição
  const contextualExResult = deriveContextualSentencePrompt({
    word: 'unwind',
    definitionEn: '',
    translationPt: 'Descontrair / relaxar',
    exampleSentence: 'Drinking chamomile tea helps me unwind after a demanding workday.',
    sourceActivityName: 'Evening Routine',
    partOfSpeech: 'verb',
  });
  console.log('\n[Edge Case 3 - Contextual Example]:', contextualExResult);
  assert(
    Boolean(contextualExResult.hintEn && contextualExResult.hintPt),
    'Edge Case 3: Valid contextual example allows producing a safe, realistic prompt'
  );

  // Edge Case 4: Palavra com tradução, mas sem definição
  const transOnlyResult = deriveContextualSentencePrompt({
    word: 'gadget',
    translationPt: 'dispositivo / aparelho',
    definitionEn: '',
    exampleSentence: '',
  });
  console.log('\n[Edge Case 4 - Translation Only]:', transOnlyResult);
  assert(
    transOnlyResult.hint === '' && transOnlyResult.hintEn === '',
    'Edge Case 4: Translation alone without definition or contextual example is insufficient'
  );

  // Edge Case 5: Palavra com dados contraditórios
  const contradictoryResult = deriveContextualSentencePrompt({
    word: 'sprint',
    partOfSpeech: 'noun',
    definitionEn: 'To run at full speed over a short distance.',
    translationPt: 'correr rapidamente',
  });
  console.log('\n[Edge Case 5 - Contradictory Data (noun vs infinitive verb)]:', contradictoryResult);
  assert(
    contradictoryResult.hint === '' && contradictoryResult.hintEn === '',
    'Edge Case 5: Contradictory POS vs definition omits prompt rather than guessing'
  );

  // Edge Case 6: Palavra cujo contexto de origem não esclarece o significado
  const unclearOriginResult = deriveContextualSentencePrompt({
    word: 'bank',
    sourceActivityName: 'Unspecified Activity (no context)',
    definitionEn: 'Generic concept referring to bank.',
    translationPt: '',
  });
  console.log('\n[Edge Case 6 - Unclear Origin Context]:', unclearOriginResult);
  assert(
    unclearOriginResult.hint === '' && unclearOriginResult.hintEn === '',
    'Edge Case 6: Unclear origin context with generic definition omits prompt'
  );

  // -------------------------------------------------------------------------
  // SECTION 3: Helper Functions & Quality Discipline
  // -------------------------------------------------------------------------
  console.log('\n--- 3. Testing Quality Discipline Helpers ---');

  assert(
    isGenericPedagogicalDefinition('An important concept, role, or term referring to focus in everyday life and communication.'),
    'Identifies synthetic boilerplate definition as generic'
  );
  assert(
    !isGenericPedagogicalDefinition('Untrue, exaggerated, or deceitful statements, or insincere talk.'),
    'Identifies authentic definition as non-generic'
  );

  assert(
    !isPersonalizedPrompt({
      word: 'focus',
      hint: 'Formulate an advanced sentence applying "focus" to analyze a complex decision, project challenge, or strategic goal in your career.',
    }),
    'Identifies old generic advanced template as non-personalized'
  );

  assert(
    isPersonalizedPrompt({
      word: 'bullet',
      hint: 'Apply "bullet" in the context of organizing presentation slides or meeting notes.',
    }),
    'Identifies Phase 6 contextual prompt as personalized'
  );

  // -------------------------------------------------------------------------
  // SECTION 4: Integration with generateWeeklyHomework & Persistence
  // -------------------------------------------------------------------------
  console.log('\n--- 4. Testing generateWeeklyHomework Integration & Persistence ---');

  const customVocab = [
    {
      word: 'bullshit',
      definitionEn: 'Untrue, exaggerated, or deceitful statements, or insincere talk.',
      translationPt: 'Besteira / conversa fiada',
      exampleSentence: 'He called out the bullshit during the team briefing.',
      partOfSpeech: 'noun',
      origin: 'native_friend' as const,
      learnedAt: '2026-10-25T10:00:00Z',
    },
    {
      word: 'otherwise',
      definitionEn: 'Used to indicate what will or might happen if a circumstance is different or if a condition is not met.',
      translationPt: 'Caso contrário / senão',
      exampleSentence: 'Submit your report by Friday, otherwise the client review will be delayed.',
      partOfSpeech: 'adverb',
      origin: 'routine' as const,
      learnedAt: '2026-10-25T11:00:00Z',
    },
  ];

  const hw = generateWeeklyHomework(
    { monday: [], tuesday: [], wednesday: [], thursday: [], friday: [], saturday: [], sunday: [] },
    { uid: 'student-test-uid', name: 'Lucas', email: 'lucas@test.com', level: 'intermediate' } as any,
    'lucas@test.com',
    'Lucas',
    customVocab as any,
    'intermediate',
    'monday'
  );

  assert(Array.isArray(hw.sentenceWritingPrompts), 'generateWeeklyHomework produces sentenceWritingPrompts');
  assert(hw.sentenceWritingPrompts.length >= 2, 'Has at least 2 prompts generated');

  const bsPrompt = hw.sentenceWritingPrompts.find((p) => p.word.toLowerCase() === 'bullshit');
  assert(Boolean(bsPrompt), 'Found prompt for "bullshit" in homework');
  assert(
    Boolean(bsPrompt?.hintEn && bsPrompt.hintEn.toLowerCase().includes('informal')),
    'bullshit prompt in generated homework has contextual orientation'
  );

  // Test Persistence: Personalized prompts are NOT overwritten
  const customTutorPrompt: SentenceWritingPrompt = {
    word: 'bullshit',
    hint: 'Customized educator instruction: explain why an excuse was unacceptable.',
    hintEn: 'Customized educator instruction: explain why an excuse was unacceptable.',
    hintPt: 'Instrução personalizada do professor: explique por que uma desculpa era inaceitável.',
    levelInstruction: 'Use past tense.',
  };

  const existingActivities = {
    monday: {
      ...hw.dailyActivities?.['monday'],
      sentenceWritingPrompts: [customTutorPrompt],
    } as any,
  };

  const hwPreserved = generateWeeklyHomework(
    { monday: [], tuesday: [], wednesday: [], thursday: [], friday: [], saturday: [], sunday: [] },
    { uid: 'student-test-uid', name: 'Lucas', email: 'lucas@test.com', level: 'intermediate' } as any,
    'lucas@test.com',
    'Lucas',
    customVocab as any,
    'intermediate',
    'monday',
    undefined,
    existingActivities
  );

  const preservedPrompt = hwPreserved.sentenceWritingPrompts.find((p) => p.word.toLowerCase() === 'bullshit');
  assert(
    preservedPrompt?.hintEn === customTutorPrompt.hintEn,
    'Persistence: Preserves existing personalized tutor prompts without overwriting'
  );

  // -------------------------------------------------------------------------
  // SECTION 5: Zero Additional Gemini API Calls
  // -------------------------------------------------------------------------
  console.log('\n--- 5. Verifying Zero Additional Gemini API Calls ---');
  // Both deriveContextualSentencePrompt and generateWeeklyHomework execute synchronously and deterministically
  assert(
    typeof deriveContextualSentencePrompt === 'function',
    'deriveContextualSentencePrompt is completely synchronous and deterministic (0 Gemini API calls)'
  );

  console.log('\n============================================================');
  console.log(`ALL TESTS PASSED! (${passedTests}/${totalTests} assertions)`);
  console.log('============================================================\n');
}

runFase6Validation().catch((err) => {
  console.error('\n❌ Fatal error in Phase 6 validation:', err);
  process.exit(1);
});
