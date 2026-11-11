import { parseNotesHtml } from '../src/utils/notesHtmlParser';

const INCORRECT_SPAN = '<span class="inline-coaching-tag incorrect-tag" data-tag-type="incorrect">✗</span>';
const CORRECT_SPAN = '<span class="inline-coaching-tag correct-tag" data-tag-type="correct">✓</span>';
const NEW_WORD_SPAN = '<span class="inline-coaching-tag new-word-tag" data-tag-type="new-word">✦ New Word</span>';

// Test variations of how the teacher entered the note in contenteditable:
const variations = [
  {
    name: 'Variation 1: Text before tags on separate lines (divs)',
    html: `<div>we can't to have ${INCORRECT_SPAN}</div><div>we can't have ${CORRECT_SPAN}</div><div>we do not use "to" after verbs suchs as can and help ,motly model verbs</div><div>${NEW_WORD_SPAN}</div>`,
  },
  {
    name: 'Variation 2: Tags before text on separate lines',
    html: `<div>${INCORRECT_SPAN} we can't to have</div><div>${CORRECT_SPAN} we can't have</div><div>we do not use "to" after verbs suchs as can and help ,motly model verbs</div><div>${NEW_WORD_SPAN}</div>`,
  },
  {
    name: 'Variation 3: With <br> instead of <div>',
    html: `we can't to have ${INCORRECT_SPAN}<br>we can't have ${CORRECT_SPAN}<br>we do not use "to" after verbs suchs as can and help ,motly model verbs<br>${NEW_WORD_SPAN}`,
  },
  {
    name: 'Variation 4: Duplicated identical notes (as noted in prompt)',
    html: `<div>we can't to have ${INCORRECT_SPAN}</div><div>we can't have ${CORRECT_SPAN}</div><div>we do not use "to" after verbs suchs as can and help ,motly model verbs</div><div>${NEW_WORD_SPAN}</div><div>we can't to have ${INCORRECT_SPAN}</div><div>we can't have ${CORRECT_SPAN}</div><div>we do not use "to" after verbs suchs as can and help ,motly model verbs</div><div>${NEW_WORD_SPAN}</div>`,
  },
  {
    name: 'Variation 5: All in one line with &nbsp;',
    html: `we can't to have&nbsp;${INCORRECT_SPAN}&nbsp;we can't have&nbsp;${CORRECT_SPAN}&nbsp;we do not use "to" after verbs suchs as can and help ,motly model verbs&nbsp;${NEW_WORD_SPAN}`,
  },
  {
    name: 'Variation 6: Span wrapping text vs empty badge',
    html: `<span data-tag-type="incorrect">we can't to have</span><br><span data-tag-type="correct">we can't have</span><br>we do not use "to" after verbs suchs as can and help ,motly model verbs<br><span data-tag-type="new-word"></span>`,
  },
];

console.log('=== RUNNING PARSER AUDIT ===\n');

for (const v of variations) {
  console.log(`\n========================================`);
  console.log(`TEST: ${v.name}`);
  console.log(`========================================`);
  const result = parseNotesHtml(v.html);
  console.log('Result counts:');
  console.log(`  errors count: ${result.errors.length}`);
  console.log(`  newWords count: ${result.newWords.length}`);
  console.log(`  pronounceItems count: ${result.pronounceItems.length}`);
  console.log(`  positives count: ${result.positives.length}`);
  console.log(`  vocabItems count: ${result.vocabItems.length}`);
  console.log(`  incorrectCount: ${result.incorrectCount}`);
  console.log(`  correctCount: ${result.correctCount}`);
  console.log(`  newWordCount: ${result.newWordCount}`);
  console.log('Errors array:', JSON.stringify(result.errors, null, 2));
  console.log('Positives array:', JSON.stringify(result.positives, null, 2));
  console.log('NewWords array:', JSON.stringify(result.newWords, null, 2));
  console.log('VocabItems array:', JSON.stringify(result.vocabItems, null, 2));
  console.log('Clean text:', result.cleanText);
}
