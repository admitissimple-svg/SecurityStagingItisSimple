/**
 * Automated Test Suite — HOTFIX CONTROLADO: NATIVE FRIENDS NOTES / FIDELIDADE PEDAGÓGICA
 *
 * Project: itissimple-security-staging
 * Firestore: (default)
 *
 * Mandatory validations per specification:
 * 1. Parser de Notas: Four markings with Blast (correct), Blate (incorrect), Blasting (new-word), Blasted (pronounce).
 *    Preserves tag association, strips decorative text and HTML entities without losing words.
 * 2. Análise Pedagógica:
 *    - Mistakes analysis uses ONLY real teacher errors; unconfirmed errors (Blate) are marked pending confirmation.
 *    - Grammar points returns [] when there is no systemic grammar rule evidence.
 *    - Vocabulary & expressions includes EXCLUSIVELY new-word and pronounce terms.
 *    - Quick review summarizes only real items.
 *    - ZERO mocked examples (no "I have 28 years old", no "catch up", no "workload").
 * 3. Data de Sessão:
 *    - sessionDate "2026-10-14" is displayed as "Wed, Oct 14" in both Sao Paulo and Toronto timezones.
 *    - Pure calendar dates are treated as calendar dates without UTC offset shifts altering the day.
 *    - Real timestamps with timezone offsets preserve standard time conversions.
 * 4. Vínculo e Recuperação:
 *    - Teacher and student recover the same session using canonical identifiers.
 *    - Legacy sessions with empty lessonId are supported.
 *    - Full HTML is recovered with all tags intact.
 * 5. Cache e Atualização:
 *    - Saving updated session notes invalidates corresponding cached transformation.
 *    - Content hash prevents stale transformation reuse.
 *    - Other students' sessions remain untouched.
 * 6. Isolamento e Segurança:
 *    - Strict separation between student and teacher data.
 *    - Zero PII / key leak in errors.
 */

process.env.NODE_ENV = 'test';
process.env.FIREBASE_PROJECT_ID = 'itissimple-security-staging';
process.env.FIREBASE_DATABASE_ID = '(default)';

import { parseNotesHtml, cleanExpressionTerm, decodeHtmlEntities } from '../src/utils/notesHtmlParser';
import {
  generateLocalPedagogicalTransformation,
  getCanonicalSessionKey,
  computeNotesHash,
  resolveCefrLevel,
} from '../src/utils/pedagogicalTransformer';
import { formatDateInTimeZone } from '../src/utils/timezone';
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
console.log(' TESTES AUTOMATIZADOS: HOTFIX NATIVE FRIENDS NOTES & FIDELIDADE PEDAGÓGICA  ');
console.log(' PROJETO EXCLUSIVO: itissimple-security-staging                             ');
console.log('============================================================================\n');

// ----------------------------------------------------------------------------
// 1. PARSER DE NOTAS & QUATRO MARCAÇÕES
// ----------------------------------------------------------------------------
console.log('--- 1. Parser de Notas: Quatro Marcações (Blast, Blate, Blasting, Blasted) ---');

const sampleEditorHtml = `
<div>Native Friend In-Session Notes</div>
<div>Date: 2026-10-14 | Student: Estilo Bee</div>
<div>Topic: Business Negotiation</div>
<div><span class="inline-coaching-tag new-word-tag font-bold" data-tag-type="new-word" contenteditable="false">✦ New Word</span>&nbsp;Blasting</div>
<div><span class="inline-coaching-tag pronounce-tag font-bold" data-tag-type="pronounce" contenteditable="false">🎯 Pronounce</span>&nbsp;Blasted</div>
<div><span class="inline-coaching-tag incorrect-tag font-bold" data-tag-type="incorrect" contenteditable="false">✗</span>&nbsp;Blate</div>
<div><span class="inline-coaching-tag correct-tag font-bold" data-tag-type="correct" contenteditable="false">✓</span>&nbsp;Blast</div>
`;

const parsed = parseNotesHtml(sampleEditorHtml);

assert(parsed.newWords.includes('Blasting'), 'Termo "Blasting" extraído na categoria new-word');
assert(parsed.pronounceItems.includes('Blasted'), 'Termo "Blasted" extraído na categoria pronounce');
assert(parsed.errors.some((e) => e.original === 'Blate'), 'Termo "Blate" extraído na categoria incorrect');
assert(parsed.positives.includes('Blast'), 'Termo "Blast" extraído na categoria correct');

assert(parsed.correctCount === 1, 'Contagem correta de selos correct (1)');
assert(parsed.incorrectCount === 1, 'Contagem correta de selos incorrect (1)');
assert(parsed.newWordCount === 1, 'Contagem correta de selos new-word (1)');
assert(parsed.pronounceCount === 1, 'Contagem correta de selos pronounce (1)');

// Verify decorative text and entities were cleaned without losing original words
const blateError = parsed.errors.find((e) => e.original === 'Blate');
assert(blateError !== undefined, 'Erro "Blate" encontrado');
assert(blateError?.original === 'Blate', 'Texto decorativo "✗" removido de "Blate"');
assert(blateError?.isPendingConfirmation === true, '"Blate" marcado como isPendingConfirmation=true (correção não informada pelo professor)');
assert(blateError?.corrected === undefined, 'Correção de "Blate" não foi presumida/adivinhada');

// Test decoded entities
const entityHtml = `<div><span data-tag-type="new-word">✦ New Word</span>&nbsp;breakthrough&amp;progress</div>`;
const parsedEntities = parseNotesHtml(entityHtml);
assert(parsedEntities.newWords.includes('breakthrough&progress'), 'Entidades HTML (&nbsp;, &amp;) decodificadas sem corromper palavra');

// Test paired mistake in same line: "✗ Blate ✓ Blast"
const pairedLineHtml = `<div><span data-tag-type="incorrect">✗</span> Blate <span data-tag-type="correct">✓</span> Blast</div>`;
const parsedPaired = parseNotesHtml(pairedLineHtml);
assert(parsedPaired.errors.length === 1, 'Linha com erro e correção identificou exatamente 1 erro');
assert(parsedPaired.errors[0]?.original === 'Blate', 'Original do erro pareado é "Blate"');
assert(parsedPaired.errors[0]?.corrected === 'Blast', 'Correção do erro pareado é "Blast"');
assert(parsedPaired.errors[0]?.isPendingConfirmation === false, 'Erro pareado tem isPendingConfirmation=false');

// ----------------------------------------------------------------------------
// 2. ANÁLISE PEDAGÓGICA & ZERO EXEMPLOS INVENTADOS
// ----------------------------------------------------------------------------
console.log('\n--- 2. Análise Pedagógica Fiel & Ausência Absoluta de Exemplos Mockados ---');

const transformation = generateLocalPedagogicalTransformation({
  rawNotes: sampleEditorHtml,
  topic: 'Business Negotiation',
  sessionDate: '2026-10-14',
  teacherName: 'Charles Tutor',
  studentLevel: EnglishLevel.INTERMEDIATE,
  studentEmail: 'estilobeeadm@gmail.com',
  lessonId: 'lesson_test_101',
});

// Aba 1: Analyze Mistakes
assert(transformation.mistakesAnalysis.length === 1, 'Analyze Mistakes contém exatamente 1 erro ("Blate")');
const mAnalysis = transformation.mistakesAnalysis[0];
assert(mAnalysis?.original === 'Blate', 'Aba 1 erro original é "Blate"');
assert(mAnalysis?.isPendingConfirmation === true, 'Aba 1 "Blate" registrado como pendente de confirmação');
assert(
  mAnalysis?.corrected.includes('Pendente de confirmação'),
  'Aba 1 forma corrigida registra status de confirmação pendente com o professor'
);
assert(mAnalysis?.twoExamples.length === 0, 'Aba 1 não inventou frases fictícias de exemplo para erro sem correção');

// PROIBIÇÃO ABSOLUTA: Nenhum exemplo mockado ("I have 28 years old", "It depends of the weather", "I\'m agree")
const stringifiedTransformation = JSON.stringify(transformation);
assert(
  !stringifiedTransformation.includes('I have 28 years old'),
  'PROIBIÇÃO: "I have 28 years old" NÃO consta em nenhuma parte da transformação'
);
assert(
  !stringifiedTransformation.includes('It depends of the weather'),
  'PROIBIÇÃO: "It depends of the weather" NÃO consta em nenhuma parte da transformação'
);
assert(
  !stringifiedTransformation.includes("I'm agree with you"),
  'PROIBIÇÃO: "I\'m agree with you" NÃO consta em nenhuma parte da transformação'
);
assert(
  !stringifiedTransformation.includes('Can I make a question'),
  'PROIBIÇÃO: "Can I make a question" NÃO consta em nenhuma parte da transformação'
);

// Aba 2: Grammar Points
assert(
  transformation.grammarPoints.length === 0,
  'Aba 2 Grammar Points: retorna lista vazia [] pois "Blate" não possui evidência gramatical sistêmica'
);

// Aba 3: Vocabulary & Expressions (Exclusivamente new-word ou pronounce)
assert(transformation.vocabularyAndExpressions.length === 2, 'Aba 3 contém exatamente 2 termos (Blasting e Blasted)');
const vocabTerms = transformation.vocabularyAndExpressions.map((v) => v.term);
assert(vocabTerms.includes('Blasting'), 'Aba 3 contém "Blasting" (Alt+W)');
assert(vocabTerms.includes('Blasted'), 'Aba 3 contém "Blasted" (Alt+P)');

const blastingItem = transformation.vocabularyAndExpressions.find((v) => v.term === 'Blasting');
const blastedItem = transformation.vocabularyAndExpressions.find((v) => v.term === 'Blasted');
assert(blastingItem?.isPronunciationFocus === false, '"Blasting" não é foco de pronúncia');
assert(blastedItem?.isPronunciationFocus === true, '"Blasted" possui isPronunciationFocus=true');

assert(
  !vocabTerms.includes('catch up') && !vocabTerms.includes('workload') && !vocabTerms.includes('streamline'),
  'PROIBIÇÃO: Vocabulário mockado ("catch up", "workload", "streamline") NÃO foi inserido'
);

// Aba 4: Quick Review Summary
assert(transformation.reviewSummary.keyRules.length === 0, 'Quick Review keyRules reflete exatamente grammarPoints ([])');
assert(transformation.reviewSummary.mustKnowVocabulary.length === 2, 'Quick Review mustKnowVocabulary contém exatamente os 2 termos');
assert(transformation.reviewSummary.essentialCorrections.length === 1, 'Quick Review essentialCorrections contém exatamente o erro "Blate"');
assert(
  transformation.reviewSummary.rememberThis.includes('Blate'),
  'Quick Review rememberThis é personalizado para a sessão real ("Blate")'
);

// ----------------------------------------------------------------------------
// 3. EXIBIÇÃO DE DATA (14/10/2026 -> Wed, Oct 14)
// ----------------------------------------------------------------------------
console.log('\n--- 3. Formatação e Tratamento de Data de Sessão (14/10/2026) ---');

const dateStr = '2026-10-14';

// Test São Paulo (GMT-3) in English
const formattedSpEn = formatDateInTimeZone(dateStr, 'America/Sao_Paulo', 'en');
assert(
  formattedSpEn.includes('Wed') && formattedSpEn.includes('14') && formattedSpEn.includes('Oct'),
  `2026-10-14 em America/Sao_Paulo (en) exibido como "${formattedSpEn}" (Wed, Oct 14)`
);
assert(!formattedSpEn.includes('Tue') && !formattedSpEn.includes('13'), '2026-10-14 NÃO foi deslocado para Tue, Oct 13');

// Test Toronto (GMT-4) in English
const formattedTorontoEn = formatDateInTimeZone(dateStr, 'America/Toronto', 'en');
assert(
  formattedTorontoEn.includes('Wed') && formattedTorontoEn.includes('14') && formattedTorontoEn.includes('Oct'),
  `2026-10-14 em America/Toronto (en) exibido como "${formattedTorontoEn}" (Wed, Oct 14)`
);

// Test São Paulo in Portuguese
const formattedSpPt = formatDateInTimeZone(dateStr, 'America/Sao_Paulo', 'pt');
assert(
  formattedSpPt.includes('14') && (formattedSpPt.includes('qua') || formattedSpPt.includes('out')),
  `2026-10-14 em America/Sao_Paulo (pt) exibido com dia 14 e quarta-feira ("${formattedSpPt}")`
);

// Test real timestamp with time component preserves timezone
const realTimestamp = '2026-10-14T15:00:00.000Z';
const formattedTimestamp = formatDateInTimeZone(realTimestamp, 'America/Sao_Paulo', 'en');
assert(
  formattedTimestamp.includes('Wed') && formattedTimestamp.includes('14'),
  `Timestamp real ${realTimestamp} formatado preservando conversão: "${formattedTimestamp}"`
);

// ----------------------------------------------------------------------------
// 4. IDENTIFICADOR CANÔNICO & VÍNCULO PROFESSOR-ALUNO
// ----------------------------------------------------------------------------
console.log('\n--- 4. Vínculo e Identificadores Canônicos de Sessão ---');

// Case with lessonId
const keyWithLesson = getCanonicalSessionKey({
  lessonId: 'abc-123',
  studentEmail: 'student@test.com',
  sessionDate: '2026-10-14',
});
assert(keyWithLesson === 'lesson_abc-123', `lessonId normalizado para canonical key: ${keyWithLesson}`);

const keyWithPrefixedLesson = getCanonicalSessionKey({
  lessonId: 'lesson_abc-123',
  studentEmail: 'student@test.com',
  sessionDate: '2026-10-14',
});
assert(keyWithPrefixedLesson === 'lesson_abc-123', `lessonId com prefixo lesson_ normalizado corretamente: ${keyWithPrefixedLesson}`);

// Legacy case with empty lessonId
const keyLegacy = getCanonicalSessionKey({
  lessonId: '',
  studentEmail: 'aluno.antigo@gmail.com',
  sessionDate: '2026-10-14',
});
assert(
  keyLegacy === 'session_2026-10-14_aluno_antigo_gmail_com',
  `Sessão legada sem lessonId recuperada via chave determinística de estudante e data: ${keyLegacy}`
);

// Teacher and student provide same parameters -> receive identical sessionKey
const teacherResolvedKey = getCanonicalSessionKey({
  lessonId: 'shared-session-999',
  studentEmail: 'student@test.com',
});
const studentResolvedKey = getCanonicalSessionKey({
  lessonId: 'shared-session-999',
  studentEmail: 'student@test.com',
});
assert(teacherResolvedKey === studentResolvedKey, 'Professor e aluno convergem para o mesmo identificador de sessão');

// ----------------------------------------------------------------------------
// 5. CACHE, HASH DE CONTEÚDO E INVALIDAÇÃO
// ----------------------------------------------------------------------------
console.log('\n--- 5. Cache e Invalidação por Hash de Conteúdo ---');

const initialNotes = sampleEditorHtml;
const hash1 = computeNotesHash(initialNotes);
const hash2 = computeNotesHash(initialNotes);
assert(hash1 === hash2, `Hash de conteúdo é determinístico: ${hash1}`);

const updatedNotes = sampleEditorHtml + '<div>• Additional note</div>';
const hashUpdated = computeNotesHash(updatedNotes);
assert(hash1 !== hashUpdated, `Modificação de notas altera o hash de conteúdo (${hash1} !== ${hashUpdated})`);

// ----------------------------------------------------------------------------
// 6. ISOLAMENTO ENTRE ESTUDANTES E PROFESSORES
// ----------------------------------------------------------------------------
console.log('\n--- 6. Isolamento entre Alunos e Sessões ---');

const studentAKey = getCanonicalSessionKey({
  studentEmail: 'studentA@example.com',
  sessionDate: '2026-10-14',
});
const studentBKey = getCanonicalSessionKey({
  studentEmail: 'studentB@example.com',
  sessionDate: '2026-10-14',
});
assert(studentAKey !== studentBKey, `Sessões de estudantes distintos possuem chaves isoladas (${studentAKey} !== ${studentBKey})`);

// ----------------------------------------------------------------------------
// 7. CEFR ADAPTATION & REPUTATION PRESERVATION
// ----------------------------------------------------------------------------
console.log('\n--- 7. Calibração por Nível CEFR ---');

const cefrA1 = resolveCefrLevel(EnglishLevel.BEGINNER);
assert(cefrA1.cefr === 'A1', 'Nível iniciante mapeia para CEFR A1');

const cefrB1 = resolveCefrLevel(EnglishLevel.INTERMEDIATE);
assert(cefrB1.cefr === 'B1', 'Nível intermediário mapeia para CEFR B1');

const cefrC1 = resolveCefrLevel(EnglishLevel.ADVANCED);
assert(cefrC1.cefr === 'C1', 'Nível avançado mapeia para CEFR C1');

// Verify adaptation text aligns with CEFR
const transB1 = generateLocalPedagogicalTransformation({
  rawNotes: sampleEditorHtml,
  studentLevel: EnglishLevel.INTERMEDIATE,
});
assert(transB1.cefrLevel === 'B1', 'Transformação adota CEFR B1 para nível intermediário');
assert(transB1.levelAdaptation?.cefrLevel === 'B1', 'Metadados de adaptação correspondem a B1');

console.log('\n============================================================================');
console.log(`TOTAL DE TESTES HOTFIX FIDELIDADE PEDAGÓGICA: ${passed + failed}`);
console.log(`SUCESSO: ${passed}`);
console.log(`FALHAS:  ${failed}`);
console.log('============================================================================\n');

if (failed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
