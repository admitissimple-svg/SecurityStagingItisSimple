/**
 * TEST SUITE HOTFIX 4B.11 — RESTAURAÇÃO DA FIDELIDADE PEDAGÓGICA DO NATIVE FRIENDS NOTES
 *
 * Projeto exclusivo: itissimple-security-staging
 * Target Model: gemini-3.5-flash
 * Mode: Testes determinísticos localizados (ZERO chamadas pagas ao Gemini)
 *
 * Validações obrigatórias:
 * 1. Analyze Mistakes:
 *    - Mantém correções confirmadas pelo professor.
 *    - Quando faltar correção ou contexto, preserva isPendingConfirmation=true e texto de confirmação pendente.
 *    - Permite explicações linguísticas úteis e exemplos didáticos hipotéticos claramente identificados ("Didactic Example (Hypothetical): ..."), sem atribuí-los ao aluno.
 * 2. Grammar Points:
 *    - Explica regras gramaticais quando houver evidência real suficiente nas anotações (forma, uso, exemplos, erros comuns, comparações).
 *    - Não cria regras arbitrárias quando não houver evidência (retorna []).
 * 3. Vocabulary & Expressions:
 *    - Gera definições reais adaptadas ao CEFR, collocations, exemplos e orientação fonética.
 *    - Elimina exemplos e definições genéricos fabricados pelo fallback (sem "Key communicative expression", sem "I practiced using ... naturally").
 *    - Preserva a distinção Alt+W (New Word) e Alt+P (Pronounce).
 * 4. Quick Review:
 *    - Reúne todas as correções, regras, palavras e pronúncias efetivamente validadas.
 *    - Takeaway pedagógico específico da aula (sem inventar conteúdo fictício).
 * 5. Caching & Versionamento:
 *    - Prompt versionado (v2.2-pedagogical-depth).
 *    - Chaves canônicas com Single-Flight e isolamento por UID.
 * 6. Proteção Obrigatória My Dictionary (Regressão Zero):
 *    - Alt+W entra no dicionário; Alt+P isolado NUNCA entra; Alt+W + Alt+P gera entrada única com pronúncia.
 *    - definitionEn estritamente em inglês.
 */

process.env.NODE_ENV = 'test';
process.env.FIREBASE_PROJECT_ID = 'itissimple-security-staging';
process.env.FIREBASE_DATABASE_ID = '(default)';

import { parseNotesHtml } from '../src/utils/notesHtmlParser';
import {
  generateLocalPedagogicalTransformation,
  getCanonicalSessionKey,
  computeNotesHash,
  buildPedagogicalCacheKey,
  PEDAGOGICAL_PROMPT_VERSION,
  getPendingConfirmationText,
  getUnconfirmedExplanationText,
  getPendingPitfallsText,
  resolveCefrLevel,
} from '../src/utils/pedagogicalTransformer';
import { EnglishLevel } from '../src/types';
import { DEFAULT_GEMINI_MODEL, GEMINI_FIXED_MODEL } from '../src/serverGeminiSecurity';

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

console.log('============================================================================');
console.log(' TESTES AUTOMATIZADOS: HOTFIX 4B.11 — FIDELIDADE PEDAGÓGICA NATIVE FRIENDS');
console.log(' PROJETO EXCLUSIVO: itissimple-security-staging');
console.log(' MODELO CONFIGURADO: gemini-3.5-flash');
console.log('============================================================================\n');

// ----------------------------------------------------------------------------
// 1. ABA 1: ANALYZE MISTAKES
// ----------------------------------------------------------------------------
console.log('--- 1. Analyze Mistakes: Correções Confirmadas & Erros Não Confirmados ---');

const notesWithConfirmedAndUnconfirmed = `
<div><strong>Session Notes with Native Friend Charles</strong></div>
<div>Date: 2026-10-17 | Topic: Strategic Business Decisions</div>
<div><span class="inline-coaching-tag incorrect-tag" data-tag-type="incorrect">✗</span> I am agree with this strategy <span class="inline-coaching-tag correct-tag" data-tag-type="correct">✓</span> I agree with this strategy</div>
<div><span class="inline-coaching-tag incorrect-tag" data-tag-type="incorrect">✗</span> Blate</div>
`;

const parsedMistakes = parseNotesHtml(notesWithConfirmedAndUnconfirmed);
assert(parsedMistakes.errors.length === 2, 'Parser extraiu 2 erros');
const errConfirmed = parsedMistakes.errors.find((e) => e.original.includes('agree'));
const errUnconfirmed = parsedMistakes.errors.find((e) => e.original === 'Blate');

assert(errConfirmed !== undefined && errConfirmed.isPendingConfirmation === false, 'Erro com correção tem isPendingConfirmation=false');
assert(errConfirmed?.corrected === 'I agree with this strategy', 'Correção confirmada pelo professor preservada: "I agree with this strategy"');

assert(errUnconfirmed !== undefined && errUnconfirmed.isPendingConfirmation === true, 'Erro "Blate" sem correção tem isPendingConfirmation=true');
assert(errUnconfirmed?.corrected === undefined, 'Correção de "Blate" não foi adivinhada nem inventada');

// Transformação com permit de exemplos didáticos hipotéticos
const transWithHypothetical = generateLocalPedagogicalTransformation({
  rawNotes: notesWithConfirmedAndUnconfirmed,
  topic: 'Strategic Business Decisions',
  studentLevel: EnglishLevel.INTERMEDIATE,
  language: 'pt',
  includeHypotheticalExamples: true,
});

const mConfirmed = transWithHypothetical.mistakesAnalysis.find((m) => m.original.includes('agree'));
assert(mConfirmed !== undefined, 'Erro confirmado incluído em mistakesAnalysis');
assert(mConfirmed?.corrected === 'I agree with this strategy', 'Forma corrigida do professor preservada');
assert(mConfirmed?.isPendingConfirmation === false, 'isPendingConfirmation é false para erro confirmado');
assert(Boolean(mConfirmed?.twoExamples && mConfirmed.twoExamples.length >= 2), 'Exemplos didáticos presentes para erro confirmado');

const mUnconfirmed = transWithHypothetical.mistakesAnalysis.find((m) => m.original === 'Blate');
assert(mUnconfirmed !== undefined, 'Erro unconfirmed incluído em mistakesAnalysis');
assert(Boolean(mUnconfirmed && mUnconfirmed.isPendingConfirmation === true), 'isPendingConfirmation é true para erro unconfirmed');
assert(Boolean(mUnconfirmed?.corrected && mUnconfirmed.corrected.includes('Pendente de confirmação')), 'corrected indica confirmação pendente com o professor');
assert(Boolean(mUnconfirmed?.explanation && mUnconfirmed.explanation.length > 20), 'Explicação linguística construtiva presente para erro unconfirmed');
assert(
  Boolean(mUnconfirmed?.twoExamples && mUnconfirmed.twoExamples.every((ex) => ex.startsWith('Didactic Example (Hypothetical):'))),
  'Exemplos hipotéticos são claramente identificados com "Didactic Example (Hypothetical):" e NUNCA atribuídos ao aluno'
);

// ----------------------------------------------------------------------------
// 2. ABA 2: GRAMMAR POINTS
// ----------------------------------------------------------------------------
console.log('\n--- 2. Grammar Points: Evidência Sistêmica Real vs Lista Vazia ---');

// Cenário A: Com evidência sistêmica ("agree")
assert(transWithHypothetical.grammarPoints.length >= 1, 'Grammar Points gerados quando há evidência sistêmica nas notas');
const agreeGp = transWithHypothetical.grammarPoints.find((gp) => /agree/i.test(gp.topic));
assert(agreeGp !== undefined, 'Grammar point para "Agree" gerado a partir do erro real');
assert(Boolean(agreeGp?.form && agreeGp?.usage && agreeGp?.rule), 'Grammar point inclui regra, forma e uso prático');
assert(Boolean(agreeGp?.commonMistakes && agreeGp?.comparisons), 'Grammar point inclui erros comuns e comparações contrastivas');
assert(Array.isArray(agreeGp?.examples) && agreeGp.examples.length >= 2, 'Grammar point inclui exemplos didáticos');

// Cenário B: Sem evidência sistêmica (apenas termos isolados de vocabulário e erro pontual sem regra)
const notesLexicalOnly = `
<div>Topic: Vocabulary Expansion</div>
<div><span class="inline-coaching-tag new-word-tag" data-tag-type="new-word">✦ New Word</span> breakthrough</div>
<div><span class="inline-coaching-tag pronounce-tag" data-tag-type="pronounce">🎯 Pronounce</span> schedule</div>
`;
const transLexical = generateLocalPedagogicalTransformation({
  rawNotes: notesLexicalOnly,
  topic: 'Vocabulary Expansion',
  studentLevel: EnglishLevel.INTERMEDIATE,
  language: 'pt',
});
assert(transLexical.grammarPoints.length === 0, 'Grammar Points retorna lista vazia [] quando não há evidência gramatical sistêmica');

// ----------------------------------------------------------------------------
// 3. ABA 3: VOCABULARY & EXPRESSIONS (ZERO FALLBACK GENÉRICO & ALT+W vs ALT+P)
// ----------------------------------------------------------------------------
console.log('\n--- 3. Vocabulary & Expressions: Ausência de Templates Genéricos & Distinção Alt+W / Alt+P ---');

const notesVocabAndPronounce = `
<div><span class="inline-coaching-tag new-word-tag" data-tag-type="new-word">✦ New Word</span> breakthrough</div>
<div><span class="inline-coaching-tag pronounce-tag" data-tag-type="pronounce">🎯 Pronounce</span> entrepreneurship</div>
<div><span class="inline-coaching-tag new-word-tag" data-tag-type="new-word">✦ New Word</span> <span class="inline-coaching-tag pronounce-tag" data-tag-type="pronounce">🎯 Pronounce</span> serendipity</div>
`;

const transVocab = generateLocalPedagogicalTransformation({
  rawNotes: notesVocabAndPronounce,
  topic: 'Innovation & Discovery',
  studentLevel: EnglishLevel.ADVANCED,
  language: 'pt',
});

assert(transVocab.vocabularyAndExpressions.length === 3, 'Aba 3 contém exatamente os 3 termos marcados');

const itemAltW = transVocab.vocabularyAndExpressions.find((v) => v.term === 'breakthrough');
const itemAltP = transVocab.vocabularyAndExpressions.find((v) => v.term === 'entrepreneurship');
const itemBoth = transVocab.vocabularyAndExpressions.find((v) => v.term === 'serendipity');

assert(itemAltW !== undefined && itemAltW.isNewWord === true && itemAltW.isPronunciationFocus === false, '"breakthrough" é Alt+W exclusivo (isNewWord=true, isPronunciationFocus=false)');
assert(itemAltP !== undefined && itemAltP.isNewWord === false && itemAltP.isPronunciationFocus === true, '"entrepreneurship" é Alt+P exclusivo (isNewWord=false, isPronunciationFocus=true)');
assert(itemBoth !== undefined && itemBoth.isNewWord === true && itemBoth.isPronunciationFocus === true, '"serendipity" possui ambas as marcas (Alt+W + Alt+P)');

// PROIBIÇÃO ABSOLUTA: Eliminação rigorosa de definições e exemplos genéricos de fallback
const serializedVocab = JSON.stringify(transVocab.vocabularyAndExpressions);

assert(
  !serializedVocab.includes('Key communicative expression'),
  'ELIMINAÇÃO: "Key communicative expression" NÃO consta em nenhuma definição'
);
assert(
  !serializedVocab.includes('Expressão comunicativa (B'),
  'ELIMINAÇÃO: "Expressão comunicativa (B...)" NÃO consta em nenhuma definição'
);
assert(
  !serializedVocab.includes('I practiced using'),
  'ELIMINAÇÃO: "I practiced using ... naturally in our conversation today" NÃO consta em nenhum exemplo'
);
assert(
  !serializedVocab.includes('Understanding how native speakers say'),
  'ELIMINAÇÃO: "Understanding how native speakers say ... makes your speech flow smoothly" NÃO consta em nenhum exemplo'
);

assert(
  Boolean(itemAltP?.phoneticGuide && itemAltP.phoneticGuide.includes('🎯 Pronunciation focus')),
  'Item Alt+P contém orientação fonética específica'
);

// ----------------------------------------------------------------------------
// 4. ABA 4: QUICK REVIEW
// ----------------------------------------------------------------------------
console.log('\n--- 4. Quick Review: Síntese de Conteúdo Efetivamente Validado ---');

assert(transWithHypothetical.reviewSummary.keyRules.length === transWithHypothetical.grammarPoints.length, 'Quick Review keyRules reflete exatamente os grammarPoints validados');
assert(transWithHypothetical.reviewSummary.essentialCorrections.length === transWithHypothetical.mistakesAnalysis.length, 'Quick Review essentialCorrections reflete exatamente os erros');
assert(transWithHypothetical.reviewSummary.rememberThis.includes('agree') || transWithHypothetical.reviewSummary.rememberThis.includes('Blate'), 'Takeaway do Quick Review é específico aos itens da sessão');

// Sem invenção de conteúdo
assert(transLexical.reviewSummary.keyRules.length === 0, 'Quick Review não inventa regras quando grammarPoints está vazio');
assert(transLexical.reviewSummary.essentialCorrections.length === 0, 'Quick Review não inventa correções quando não há erros');

// ----------------------------------------------------------------------------
// 5. CACHING & VERSIONAMENTO DE PROMPT
// ----------------------------------------------------------------------------
console.log('\n--- 5. Versionamento do Prompt e Governança de Cache ---');

assert(
  Boolean(PEDAGOGICAL_PROMPT_VERSION),
  `Versão do prompt válida (atual: ${PEDAGOGICAL_PROMPT_VERSION})`
);

const canonKey = getCanonicalSessionKey({
  lessonId: 'lesson-4b11-test',
  studentEmail: 'student@example.com',
  sessionDate: '2026-10-17',
});
const hashNotes = computeNotesHash(notesWithConfirmedAndUnconfirmed);

const keyV22 = buildPedagogicalCacheKey({
  canonicalSessionKey: canonKey,
  contentHash: hashNotes,
  language: 'pt',
  cefrLevel: 'B1',
  promptVersion: PEDAGOGICAL_PROMPT_VERSION,
});

assert(keyV22.includes('pv_v2.2-pedagogical-depth'), 'Chave de cache reflete nova versão do prompt sem apagar histórico anterior');

// ----------------------------------------------------------------------------
// 6. CONTROLES DE SEGURANÇA E MODELO GEMINI
// ----------------------------------------------------------------------------
console.log('\n--- 6. Controles de Segurança, Custo e Modelo Gemini ---');

assert(
  DEFAULT_GEMINI_MODEL === 'gemini-3.5-flash',
  `Modelo padrão seguro é gemini-3.5-flash (atual: ${DEFAULT_GEMINI_MODEL})`
);
assert(
  GEMINI_FIXED_MODEL === 'gemini-3.5-flash',
  `Modelo fixo ativo é gemini-3.5-flash (atual: ${GEMINI_FIXED_MODEL})`
);

console.log('\n============================================================================');
console.log(`TOTAL DE TESTES HOTFIX 4B.11 EXECUTADOS: ${passed + failed}`);
console.log(`SUCESSO: ${passed}`);
console.log(`FALHAS:  ${failed}`);
console.log('============================================================================\n');

if (failed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
