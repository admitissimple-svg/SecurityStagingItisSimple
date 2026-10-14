import { parseNotesHtml } from '../src/utils/notesHtmlParser';
import { generateLocalPedagogicalTransformation, computeNotesHash, getCanonicalSessionKey } from '../src/utils/pedagogicalTransformer';
import { formatDateInTimeZone } from '../src/utils/timezone';

console.log('=== TEST SUITE: HOTFIX FIDELIDADE PEDAGÓGICA ===\n');

let failedTests = 0;

function assert(condition: boolean, testName: string, details?: any) {
  if (condition) {
    console.log(`✅ PASS: ${testName}`);
  } else {
    console.error(`❌ FAIL: ${testName}`, details || '');
    failedTests++;
  }
}

// -------------------------------------------------------------------------
// 1. Parser de Notas: Quatro marcações com Blast, Blate, Blasting, Blasted
// -------------------------------------------------------------------------
console.log('\n--- 1. PARSER TEST: Blast, Blate, Blasting, Blasted ---');

const sampleHtml1 = `
<div class="notes-content">
  <p><span class="inline-coaching-tag new-word-tag" data-tag-type="new-word" contenteditable="false">✦ New Word</span>&nbsp;Blasting</p>
  <p><span class="inline-coaching-tag pronounce-tag" data-tag-type="pronounce" contenteditable="false">🎯 Pronounce</span>&nbsp;Blasted</p>
  <p><span class="inline-coaching-tag incorrect-tag" data-tag-type="incorrect" contenteditable="false">✗</span>&nbsp;Blate</p>
  <p><span class="inline-coaching-tag correct-tag" data-tag-type="correct" contenteditable="false">✓</span>&nbsp;Blast</p>
</div>
`;

const parsed1 = parseNotesHtml(sampleHtml1);

assert(parsed1.newWordCount === 1, 'Tag count newWordCount is 1', parsed1.newWordCount);
assert(parsed1.pronounceCount === 1, 'Tag count pronounceCount is 1', parsed1.pronounceCount);
assert(parsed1.incorrectCount === 1, 'Tag count incorrectCount is 1', parsed1.incorrectCount);
assert(parsed1.correctCount === 1, 'Tag count correctCount is 1', parsed1.correctCount);

assert(parsed1.newWords.includes('Blasting'), 'newWords contains "Blasting"', parsed1.newWords);
assert(parsed1.pronounceItems.includes('Blasted'), 'pronounceItems contains "Blasted"', parsed1.pronounceItems);
assert(parsed1.errors.length === 1 && parsed1.errors[0].original === 'Blate', 'errors contains "Blate"', parsed1.errors);
assert(parsed1.errors[0].isPendingConfirmation === true, 'Blate error isPendingConfirmation is true', parsed1.errors[0]);
assert(parsed1.positives.includes('Blast'), 'positives contains "Blast"', parsed1.positives);

// Check that decorative text "✦ New Word", "🎯 Pronounce", "✓", "✗" are removed
assert(!parsed1.newWords.some(w => w.includes('✦') || w.includes('New Word')), 'No decorative text in newWords');
assert(!parsed1.pronounceItems.some(p => p.includes('🎯') || p.includes('Pronounce')), 'No decorative text in pronounceItems');

// -------------------------------------------------------------------------
// 2. Análise Pedagógica: Fidelidade e Sem Alucinação
// -------------------------------------------------------------------------
console.log('\n--- 2. PEDAGOGICAL ANALYSIS TEST ---');

const transformation1 = generateLocalPedagogicalTransformation({
  rawNotes: sampleHtml1,
  topic: 'Vocabulary Building',
  sessionDate: '2026-10-14',
  teacherName: 'Charles',
  studentLevel: 'intermediario',
  studentUid: 'student_123',
  studentEmail: 'student@example.com',
  lessonId: 'lesson_abc',
});

// Tab 1: Analyze Mistakes
assert(transformation1.mistakesAnalysis.length === 1, 'Only 1 mistake in mistakesAnalysis', transformation1.mistakesAnalysis.length);
assert(transformation1.mistakesAnalysis[0].original === 'Blate', 'Mistake original is "Blate"', transformation1.mistakesAnalysis[0]);
assert(transformation1.mistakesAnalysis[0].isPendingConfirmation === true, 'Correction is pending confirmation', transformation1.mistakesAnalysis[0].isPendingConfirmation);
assert(transformation1.mistakesAnalysis[0].corrected.includes('Pendente'), 'Correction text states pending confirmation', transformation1.mistakesAnalysis[0].corrected);
assert(transformation1.mistakesAnalysis[0].twoExamples.length === 0, 'No invented examples for unconfirmed mistake');

// Tab 2: Grammar Points
assert(transformation1.grammarPoints.length === 0, 'grammarPoints is empty list when no systemic grammar error exists', transformation1.grammarPoints);

// Tab 3: Vocabulary & Expressions
assert(transformation1.vocabularyAndExpressions.length === 2, 'vocabularyAndExpressions has exactly 2 items (Blasting & Blasted)', transformation1.vocabularyAndExpressions.length);
const vocabTerms = transformation1.vocabularyAndExpressions.map(v => v.term);
assert(vocabTerms.includes('Blasting') && vocabTerms.includes('Blasted'), 'Terms are exclusively Blasting and Blasted', vocabTerms);
const blastedItem = transformation1.vocabularyAndExpressions.find(v => v.term === 'Blasted');
assert(blastedItem?.isPronunciationFocus === true, 'Blasted has isPronunciationFocus = true');

// Tab 4: Quick Review
assert(transformation1.reviewSummary.keyRules.length === 0, 'Quick review keyRules is empty since no grammar rules');
assert(transformation1.reviewSummary.essentialCorrections.length === 1, 'Quick review has 1 essential correction (Blate)');
assert(transformation1.reviewSummary.mustKnowVocabulary.length === 2, 'Quick review has 2 must know vocabulary items');

// Check that NO mocked examples exist in the entire transformation
const jsonString1 = JSON.stringify(transformation1);
assert(!jsonString1.includes('28 years old'), 'No mocked "28 years old" in transformation');
assert(!jsonString1.includes('catch up'), 'No mocked "catch up" in transformation');
assert(!jsonString1.includes('workload'), 'No mocked "workload" in transformation');

// -------------------------------------------------------------------------
// 3. Teste Data: 2026-10-14 -> Wed, Oct 14
// -------------------------------------------------------------------------
console.log('\n--- 3. DATE FORMAT TEST (2026-10-14) ---');

const formattedEn = formatDateInTimeZone('2026-10-14', 'America/Sao_Paulo', 'en');
console.log('Formatted EN:', formattedEn);
assert(formattedEn.includes('Wed') && formattedEn.includes('14') && (formattedEn.includes('Oct') || formattedEn.includes('out')), 'Formatted EN shows Wed, Oct 14', formattedEn);

const formattedPt = formatDateInTimeZone('2026-10-14', 'America/Sao_Paulo', 'pt');
console.log('Formatted PT:', formattedPt);
assert(formattedPt.includes('14'), 'Formatted PT shows day 14', formattedPt);

// Ensure real timestamp with time is also preserved
const timestampFormatted = formatDateInTimeZone('2026-10-14T15:30:00Z', 'America/Sao_Paulo', 'en');
console.log('Timestamp EN:', timestampFormatted);
assert(timestampFormatted.length > 0, 'Real timestamp formats cleanly');

// -------------------------------------------------------------------------
// 4. Cache & Content Hash Invalidation
// -------------------------------------------------------------------------
console.log('\n--- 4. CACHE & HASH INVALIDATION TEST ---');

const hash1 = computeNotesHash(sampleHtml1);
const modifiedHtml = sampleHtml1 + '<p>Additional notes</p>';
const hash2 = computeNotesHash(modifiedHtml);
assert(hash1 !== hash2, 'Different note content produces different hash', { hash1, hash2 });

const key1 = getCanonicalSessionKey({ lessonId: 'lesson_123', studentEmail: 'student@example.com', sessionDate: '2026-10-14' });
const key2 = getCanonicalSessionKey({ id: 'lesson_123' });
assert(key1 === 'lesson_123' && key2 === 'lesson_123', 'Canonical keys match for lesson_123', { key1, key2 });

// Legacy session without lessonId
const keyLegacy = getCanonicalSessionKey({ studentEmail: 'student@example.com', sessionDate: '2026-10-14' });
assert(keyLegacy.includes('student_example_com') && keyLegacy.includes('2026-10-14'), 'Legacy session key is stable', keyLegacy);

// -------------------------------------------------------------------------
// 5. Plain Text Fallback & Multi-format resilience
// -------------------------------------------------------------------------
console.log('\n--- 5. PLAIN SYMBOLS PARSER TEST ---');

const plainTextNotes = `
[New Word] Blasting
[Pronounce] Blasted
✗ Blate
✓ Blast
`;

const parsedPlain = parseNotesHtml(plainTextNotes);
assert(parsedPlain.newWords.includes('Blasting'), 'Plain text extracts [New Word] Blasting', parsedPlain.newWords);
assert(parsedPlain.pronounceItems.includes('Blasted'), 'Plain text extracts [Pronounce] Blasted', parsedPlain.pronounceItems);
assert(parsedPlain.errors.some(e => e.original === 'Blate'), 'Plain text extracts ✗ Blate', parsedPlain.errors);
assert(parsedPlain.positives.includes('Blast'), 'Plain text extracts ✓ Blast', parsedPlain.positives);

console.log('\n=============================================');
if (failedTests === 0) {
  console.log('🎉 ALL TESTS PASSED SUCCESSFULLY!');
  process.exit(0);
} else {
  console.error(`💥 ${failedTests} TEST(S) FAILED!`);
  process.exit(1);
}
