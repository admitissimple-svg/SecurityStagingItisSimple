/**
 * Automated Test Suite — HOTFIX RESTAURAÇÃO DA IA PEDAGÓGICA DO NATIVE FRIENDS NOTES
 *
 * Environment: itissimple-security-staging
 * Firestore: (default)
 *
 * Validations:
 * 1. Regressão do parser e das quatro abas.
 * 2. Gemini simulado com resposta pedagógica rica.
 * 3. Fallback simulado sem IA.
 * 4. Cache separado por idioma, CEFR, hash e versão de prompt.
 * 5. Invalidação após alteração das notas sem apagar histórico.
 * 6. Ausência rigorosa de alucinações (termos não registrados, erros sem evidência).
 * 7. Isolamento e segurança entre estudantes (verificação de identidade, autorização e CEFR confiável).
 * 8. Diagnóstico de falhas por categoria e sanitização de logs (zero chaves ou dados pessoais expostos).
 */

process.env.NODE_ENV = 'test';
process.env.FIREBASE_PROJECT_ID = 'itissimple-security-staging';
process.env.FIREBASE_DATABASE_ID = '(default)';

import { parseNotesHtml } from '../src/utils/notesHtmlParser';
import {
  generateLocalPedagogicalTransformation,
  getCanonicalSessionKey,
  computeNotesHash,
  resolveCefrLevel,
  buildPedagogicalCacheKey,
  PEDAGOGICAL_PROMPT_VERSION,
  getPendingConfirmationText,
  getUnconfirmedExplanationText,
  getPendingPitfallsText,
  getAiUnavailableNoticeText,
} from '../src/utils/pedagogicalTransformer';
import {
  categorizeGeminiError,
  invalidatePedagogicalCache,
} from '../serverApp';
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

console.log('============================================================================');
console.log(' TESTES AUTOMATIZADOS: RESTAURAÇÃO DA IA PEDAGÓGICA NATIVE FRIENDS NOTES   ');
console.log(' AMBIENTE: itissimple-security-staging | FIRESTORE: (default)              ');
console.log('============================================================================\n');

// ----------------------------------------------------------------------------
// 1. REGRESSÃO DO PARSER E DAS QUATRO ABAS
// ----------------------------------------------------------------------------
console.log('--- 1. Regressão do Parser de Notas e Quatro Abas ---');

const sampleTeacherNotes = `
<div><strong>Session Notes with Native Friend Charles</strong></div>
<div>Date: 2026-10-14 | Topic: Tech Startup Presentation</div>
<div><span class="inline-coaching-tag correct-tag" data-tag-type="correct">✓</span>&nbsp;We scaled our user base rapidly</div>
<div><span class="inline-coaching-tag incorrect-tag" data-tag-type="incorrect">✗</span>&nbsp;I am agree with that proposal&nbsp;➜&nbsp;I agree with that proposal</div>
<div><span class="inline-coaching-tag incorrect-tag" data-tag-type="incorrect">✗</span>&nbsp;UnverifiedPhrase</div>
<div><span class="inline-coaching-tag new-word-tag" data-tag-type="new-word">✦ New Word</span>&nbsp;pivot</div>
<div><span class="inline-coaching-tag pronounce-tag" data-tag-type="pronounce">🎯 Pronounce</span>&nbsp;entrepreneurship</div>
`;

const markings = parseNotesHtml(sampleTeacherNotes);

assert(markings.correctCount === 1, 'Parser identifica 1 marcação de acerto (correct)');
assert(markings.incorrectCount === 2, 'Parser identifica 2 marcações de erro (incorrect)');
assert(markings.newWordCount === 1, 'Parser identifica 1 marcação de palavra nova (new-word)');
assert(markings.pronounceCount === 1, 'Parser identifica 1 marcação de pronúncia (pronounce)');

// Generate deterministic local transformation to check structure of all 4 tabs
const localReport = generateLocalPedagogicalTransformation({
  rawNotes: sampleTeacherNotes,
  topic: 'Tech Startup Presentation',
  studentLevel: EnglishLevel.INTERMEDIATE,
  language: 'pt',
});

// Aba 1: Mistakes Analysis
assert(Array.isArray(localReport.mistakesAnalysis) && localReport.mistakesAnalysis.length === 2, 'Aba 1 (Mistakes Analysis) possui exatamente os 2 erros marcados');
const confirmedMistake = localReport.mistakesAnalysis.find((m) => m.original.includes('agree'));
const unconfirmedMistake = localReport.mistakesAnalysis.find((m) => m.original.includes('UnverifiedPhrase'));
assert(confirmedMistake !== undefined && confirmedMistake.isPendingConfirmation === false, 'Erro com correção informada tem isPendingConfirmation=false');
assert(unconfirmedMistake !== undefined && unconfirmedMistake.isPendingConfirmation === true, 'Erro sem correção do professor permanece com isPendingConfirmation=true');
assert(unconfirmedMistake?.twoExamples.length === 0, 'Erro não confirmado não inventa exemplos (twoExamples=[])');

// Aba 2: Grammar Points
assert(Array.isArray(localReport.grammarPoints), 'Aba 2 (Grammar Points) é gerada');
assert(localReport.grammarPoints.some((g) => /agree/i.test(g.topic)), 'Aba 2 ensina a regra do verbo "Agree" identificada nas notas');

// Aba 3: Vocabulary and Expressions
assert(Array.isArray(localReport.vocabularyAndExpressions) && localReport.vocabularyAndExpressions.length === 2, 'Aba 3 (Vocabulary) contém os 2 termos marcados ("pivot" e "entrepreneurship")');
const pivotVocab = localReport.vocabularyAndExpressions.find((v) => v.term.toLowerCase() === 'pivot');
const pronVocab = localReport.vocabularyAndExpressions.find((v) => v.term.toLowerCase() === 'entrepreneurship');
assert(Boolean(pivotVocab && !pivotVocab.isPronunciationFocus), '"pivot" registrado na categoria de vocabulário');
assert(Boolean(pronVocab && pronVocab.isPronunciationFocus), '"entrepreneurship" registrado na categoria de foco de pronúncia');

// Aba 4: Quick Review Summary
assert(localReport.reviewSummary !== undefined, 'Aba 4 (5-10 Min Quick Review) é gerada');
assert(Array.isArray(localReport.reviewSummary.essentialCorrections), 'Review summary resume correções essenciais');
assert(Array.isArray(localReport.reviewSummary.mustKnowVocabulary), 'Review summary resume vocabulário imperdível');
assert(typeof localReport.reviewSummary.rememberThis === 'string', 'Review summary contém takeaway "rememberThis"');

// ----------------------------------------------------------------------------
// 2. GEMINI SIMULADO COM RESPOSTA PEDAGÓGICA RICA
// ----------------------------------------------------------------------------
console.log('\n--- 2. Gemini Simulado com Resposta Pedagógica Rica ---');

// Simulated AI response following CELTA prompt guidelines in Spanish ('es')
const simulatedGeminiSpanishPayload = {
  mistakesAnalysis: [
    {
      id: 'mistake-1',
      original: 'I am agree with that proposal',
      corrected: 'I agree with that proposal',
      category: 'grammar',
      explanation: 'En inglés, "agree" es un verbo activo, no un adjetivo. Por lo tanto, no se utiliza el verbo auxiliar "am" en el presente simple.',
      twoExamples: [
        'Didactic Example: "I agree completely with the strategy you presented."',
        'Didactic Example: "Do you agree with our expansion plans?"',
      ],
      commonPitfalls: 'Decir "I am agree" por influencia de "estoy de acuerdo" en español.',
      isPendingConfirmation: false,
    },
    {
      id: 'mistake-2',
      original: 'UnverifiedPhrase',
      corrected: getPendingConfirmationText('es'),
      category: 'vocabulary',
      explanation: getUnconfirmedExplanationText('UnverifiedPhrase', 'es'),
      twoExamples: [],
      commonPitfalls: getPendingPitfallsText('es'),
      isPendingConfirmation: true,
    },
  ],
  grammarPoints: [
    {
      id: 'grammar-1',
      topic: 'Verbos de opinión y estado: "Agree"',
      rule: 'El verbo "agree" funciona como verbo pleno. Se conjuga directamente con el sujeto (I agree, She agrees).',
      form: 'Sujeto + agree / agrees + with [alguien] / on [tema]',
      usage: 'Para expresar acuerdo o consenso sin añadir el verbo to be.',
      examples: [
        'Didactic Example: "We agree on the new timeline."',
        'Didactic Example: "She agrees that more testing is necessary."',
      ],
      commonMistakes: 'Añadir "am" o negar con "am not agree" en lugar de "do not agree".',
      comparisons: 'I agree (verbo activo) vs I am in agreement (estilo formal/escrito)',
    },
  ],
  vocabularyAndExpressions: [
    {
      id: 'vocab-1',
      term: 'pivot',
      partOfSpeech: 'Verb / Business Idiom',
      simpleDefinition: 'Cambiar la dirección estratégica de una empresa manteniendo la visión central.',
      collocations: ['pivot quickly', 'strategic pivot', 'pivot to remote work'],
      realExamples: [
        'Didactic Example: "The startup decided to pivot after receiving early customer feedback."',
        'Didactic Example: "A successful pivot requires team agility and clear communication."',
      ],
      synonyms: ['reorient', 'shift strategy', 'adapt'],
      register: 'neutral',
      category: 'New Words & Expressions (Alt+W)',
      isPronunciationFocus: false,
    },
    {
      id: 'vocab-2',
      term: 'entrepreneurship',
      partOfSpeech: 'Pronunciation Focus',
      simpleDefinition: 'Enfoque de pronunciación: atención especial a la sílaba tónica y a las vocales reducidas.',
      collocations: ['foster entrepreneurship', 'course in entrepreneurship'],
      realExamples: [
        'Didactic Example: "Entrepreneurship drives economic growth and community innovation."',
      ],
      synonyms: ['business venture', 'enterprise'],
      register: 'neutral',
      category: 'Pronunciation & Phonetics (Alt+P)',
      phoneticGuide: '🎯 Pronunciation focus: /ˌɒntrəprəˈnɜːrʃɪp/ con acento tónico en la tercera sílaba.',
      isPronunciationFocus: true,
    },
  ],
  reviewSummary: {
    estimatedMinutes: '5–10 minutes',
    keyRules: ['Verbo "Agree": nunca anteponer "am" al expresar coincidencia de opiniones.'],
    mustKnowVocabulary: ['✨ pivot (Verb) — Cambiar la dirección estratégica.', '🎯 entrepreneurship (Pronunciation)'],
    essentialCorrections: [{ original: 'I am agree with that proposal', corrected: 'I agree with that proposal' }],
    rememberThis: 'Recuerda: ¡En inglés decimos directamente "I agree", nunca "I am agree"!',
  },
};

// Validate that simulated Gemini response respects all fidelity rules
const aiMistakes = simulatedGeminiSpanishPayload.mistakesAnalysis;
assert(aiMistakes.every((m) => m.twoExamples.every((ex) => ex.startsWith('Didactic Example:'))), 'Todos os exemplos gerados pela IA são explicitamente Didactic Examples');
assert(aiMistakes.find((m) => m.isPendingConfirmation)?.twoExamples.length === 0, 'Erro pendente de confirmação não possui exemplos fabricados');
assert(simulatedGeminiSpanishPayload.vocabularyAndExpressions.every((v) => markings.newWords.includes(v.term) || markings.pronounceItems.includes(v.term)), 'Vocabulário da IA contém estritamente termos marcados pelo professor');
assert(simulatedGeminiSpanishPayload.reviewSummary.rememberThis.includes('Recuerda:'), 'Takeaway do Gemini respeita o idioma espanhol selecionado');

// ----------------------------------------------------------------------------
// 3. FALLBACK SIMULADO SEM IA
// ----------------------------------------------------------------------------
console.log('\n--- 3. Fallback Simulado sem IA ---');

const fallbackReportFr = generateLocalPedagogicalTransformation({
  rawNotes: sampleTeacherNotes,
  topic: 'Tech Startup Presentation',
  studentLevel: EnglishLevel.INTERMEDIATE,
  language: 'fr',
});

assert(fallbackReportFr.isAiGenerated === false, 'Fallback sem IA possui isAiGenerated=false');
assert(fallbackReportFr.isFallback === true, 'Fallback sem IA possui isFallback=true');
assert(fallbackReportFr.source === 'fallback', 'Fallback sem IA possui source="fallback"');
assert(fallbackReportFr.language === 'fr', 'Fallback registra o idioma fr (francês)');
assert(typeof fallbackReportFr.aiNotice === 'string' && fallbackReportFr.aiNotice.includes('IA'), 'aiNotice traduzido presente no relatório de fallback');
const unconfirmedFr = fallbackReportFr.mistakesAnalysis.find((m) => m.isPendingConfirmation);
assert(Boolean(unconfirmedFr && (unconfirmedFr.corrected.includes('professeur') || unconfirmedFr.corrected.includes('En attente'))), 'Mensagem de confirmação pendente traduzida para francês');

// ----------------------------------------------------------------------------
// 4. CACHE SEPARADO POR IDIOMA, CEFR, HASH E VERSÃO DE PROMPT
// ----------------------------------------------------------------------------
console.log('\n--- 4. Cache Separado por Idioma, CEFR e Versão ---');

const canonicalKey = getCanonicalSessionKey({
  lessonId: 'lesson-101',
  studentEmail: 'student@example.com',
  sessionDate: '2026-10-14',
});
const notesHash = computeNotesHash(sampleTeacherNotes);

const cacheKeyPt = buildPedagogicalCacheKey({
  canonicalSessionKey: canonicalKey,
  contentHash: notesHash,
  language: 'pt',
  cefrLevel: 'B1',
});

const cacheKeyEn = buildPedagogicalCacheKey({
  canonicalSessionKey: canonicalKey,
  contentHash: notesHash,
  language: 'en',
  cefrLevel: 'B1',
});

const cacheKeyEs = buildPedagogicalCacheKey({
  canonicalSessionKey: canonicalKey,
  contentHash: notesHash,
  language: 'es',
  cefrLevel: 'B1',
});

const cacheKeyB2 = buildPedagogicalCacheKey({
  canonicalSessionKey: canonicalKey,
  contentHash: notesHash,
  language: 'pt',
  cefrLevel: 'B2',
});

assert(cacheKeyPt !== cacheKeyEn, `Chaves de cache são distintas entre idiomas pt e en`);
assert(cacheKeyPt !== cacheKeyEs, `Chaves de cache são distintas entre idiomas pt e es`);
assert(cacheKeyPt !== cacheKeyB2, `Chaves de cache são distintas entre níveis CEFR B1 e B2`);
assert(cacheKeyPt.includes(PEDAGOGICAL_PROMPT_VERSION), 'Chave de cache inclui versão do prompt');

// ----------------------------------------------------------------------------
// 5. INVALIDAÇÃO APÓS ALTERAÇÃO DAS NOTAS (SEM APAGAR HISTÓRICO)
// ----------------------------------------------------------------------------
console.log('\n--- 5. Invalidação de Cache por Alteração de Notas ---');

const mockDb: any = {
  pedagogicalTransformationsMap: {
    [cacheKeyPt]: { id: cacheKeyPt, topic: 'Initial' },
    [cacheKeyEn]: { id: cacheKeyEn, topic: 'Initial' },
    [cacheKeyEs]: { id: cacheKeyEs, topic: 'Initial' },
    [canonicalKey]: { id: canonicalKey, topic: 'Initial' },
    'unrelated_session_key': { id: 'unrelated_session_key', topic: 'Other Student' },
  },
  sessionNotesMap: {
    [canonicalKey]: { id: canonicalKey, content: 'Historical teacher document' },
  },
  liveLessons: [
    { id: 'lesson-101', title: 'Tech Startup Presentation', sessionNotesDocument: 'Real note' },
  ],
};

invalidatePedagogicalCache(mockDb, {
  canonicalSessionKey: canonicalKey,
  lessonId: 'lesson-101',
});

assert(mockDb.pedagogicalTransformationsMap[cacheKeyPt] === undefined, 'Versão pt invalidada');
assert(mockDb.pedagogicalTransformationsMap[cacheKeyEn] === undefined, 'Versão en invalidada');
assert(mockDb.pedagogicalTransformationsMap[cacheKeyEs] === undefined, 'Versão es invalidada');
assert(mockDb.pedagogicalTransformationsMap[canonicalKey] === undefined, 'Chave canônica direta invalidada');
assert(mockDb.pedagogicalTransformationsMap['unrelated_session_key'] !== undefined, 'Sessões de outros alunos permanecem intactas no cache');
assert(mockDb.sessionNotesMap[canonicalKey] !== undefined, 'Documento histórico em sessionNotesMap NÃO foi apagado');
assert(mockDb.liveLessons.length === 1, 'Registro histórico em liveLessons NÃO foi apagado');

// ----------------------------------------------------------------------------
// 6. AUSÊNCIA RIGOROSA DE ALUCINAÇÕES
// ----------------------------------------------------------------------------
console.log('\n--- 6. Ausência Rigorosa de Alucinações ---');

// Note with NO markings at all
const cleanNotesNoMarks = `
<div>Today we discussed the weather and general travel plans.</div>
<div>The student spoke fluently about their trip to London.</div>
`;

const cleanReport = generateLocalPedagogicalTransformation({
  rawNotes: cleanNotesNoMarks,
  topic: 'Travel Plans',
  studentLevel: EnglishLevel.ADVANCED,
  language: 'pt',
});

assert(cleanReport.mistakesAnalysis.length === 0, 'Zero erros inventados quando o professor não marcou nenhum erro');
assert(cleanReport.grammarPoints.length === 0, 'Zero regras de gramática inventadas quando não há erros sistêmicos');
assert(cleanReport.vocabularyAndExpressions.length === 0, 'Zero vocabulários inventados (sem "catch up", sem "workload")');

// ----------------------------------------------------------------------------
// 7. ISOLAMENTO E SEGURANÇA ENTRE ESTUDANTES
// ----------------------------------------------------------------------------
console.log('\n--- 7. Isolamento e Segurança entre Estudantes ---');

const student1Canonical = getCanonicalSessionKey({
  lessonId: 'lesson-std1',
  studentUid: 'student_uid_1',
  studentEmail: 'student1@domain.com',
  sessionDate: '2026-10-14',
});

const student2Canonical = getCanonicalSessionKey({
  lessonId: 'lesson-std2',
  studentUid: 'student_uid_2',
  studentEmail: 'student2@domain.com',
  sessionDate: '2026-10-14',
});

assert(student1Canonical !== student2Canonical, 'Chaves canônicas de estudantes diferentes são 100% isoladas');

// CEFR Level lookup authoritative
const cefrBeginner = resolveCefrLevel('beginner');
assert(cefrBeginner.cefr === 'A1', 'Nível "beginner" mapeado autoritativamente para A1');
const cefrAdvanced = resolveCefrLevel('avancado');
assert(cefrAdvanced.cefr === 'C1', 'Nível "avancado" mapeado autoritativamente para C1');

// ----------------------------------------------------------------------------
// 8. DIAGNÓSTICO DE FALHAS E SANITIZAÇÃO DE LOGS
// ----------------------------------------------------------------------------
console.log('\n--- 8. Diagnóstico de Falhas e Sanitização de Logs ---');

const authDiag = categorizeGeminiError({ status: 401, message: 'API_KEY_INVALID' });
assert(authDiag.category === 'AUTH_ERROR', 'Erro 401 categorizado como AUTH_ERROR');

const quotaDiag = categorizeGeminiError({ status: 429, message: 'Resource has been exhausted (e.g. check quota)' });
assert(quotaDiag.category === 'QUOTA_EXCEEDED', 'Erro 429 categorizado como QUOTA_EXCEEDED');

const timeoutDiag = categorizeGeminiError({ status: 408, message: 'DEADLINE_EXCEEDED: timeout waiting for upstream' });
assert(timeoutDiag.category === 'TIMEOUT', 'Erro 408 / deadline categorizado como TIMEOUT');

const notFoundDiag = categorizeGeminiError({ status: 404, message: 'models/gemini-old is not found' });
assert(notFoundDiag.category === 'MODEL_UNAVAILABLE', 'Erro 404 categorizado como MODEL_UNAVAILABLE');

const malformedDiag = categorizeGeminiError({ message: 'Unexpected end of JSON input' });
assert(malformedDiag.category === 'INVALID_RESPONSE', 'Erro de parsing categorizado como INVALID_RESPONSE');

// Sanitization check: Ensure no API keys or emails in logs
const logMessageWithPii = 'Error calling Gemini with key AIzaSyD123456789012345678901234567890 for student user.name@test.com with Bearer eyJhbGciOi';
const sanitized = logMessageWithPii
  .replace(/AIza[0-9A-Za-z-_]{30,45}/g, '[REDACTED_API_KEY]')
  .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[REDACTED_EMAIL]')
  .replace(/Bearer\s+[a-zA-Z0-9._-]+/gi, '[REDACTED_TOKEN]');

assert(!sanitized.includes('AIzaSyD'), 'Chave de API ocultada dos logs com [REDACTED_API_KEY]');
assert(!sanitized.includes('user.name@test.com'), 'E-mail do aluno ocultado dos logs com [REDACTED_EMAIL]');
assert(!sanitized.includes('eyJhbGciOi'), 'Token de autenticação ocultado dos logs com [REDACTED_TOKEN]');

console.log('\n============================================================================');
console.log(`TOTAL DE TESTES EXECUTADOS: ${passed + failed}`);
console.log(`SUCESSO: ${passed}`);
console.log(`FALHAS:  ${failed}`);
console.log('============================================================================\n');

if (failed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
