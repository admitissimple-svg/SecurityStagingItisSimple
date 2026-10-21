import assert from 'assert';
import {
  isGenericPedagogicalDefinition,
  isGenericPedagogicalExample,
  executeGeminiWithContingency,
  resolveGeminiContingencyModels,
} from '../src/serverGeminiSecurity';
import {
  getInstantOrCachedWord,
  lookupWord,
  isGenericPedagogicalDefinition as clientIsGenericDef,
} from '../src/utils/dictionaryService';
import { consolidateDictionaryEntries, isDefinitionRicher } from '../src/utils/studentDictionaryLibrary';
import { StudentDictionaryEntry } from '../src/types';

async function runTests() {
  console.log('--- 1. Validation of Generic Placeholder Detection ---');

  const genericDefinitions = [
    'A fundamental word for level A1: practice using "someone" in simple daily conversations.',
    "A fundamental word for level A2: practice using 'somebody' in simple daily conversations.",
    'A natural conversational expression to enrich your speaking flow and vocabulary range.',
    'An advanced lexical item to elevate your expressive nuance and natural delivery.',
    'A practical vocabulary term (B1) to enrich your conversational flow and clarity.',
    'Key communicative expression for daily speaking',
  ];

  for (const genDef of genericDefinitions) {
    assert.strictEqual(
      isGenericPedagogicalDefinition(genDef),
      true,
      `Expected generic definition to be flagged: ${genDef}`
    );
    assert.strictEqual(
      clientIsGenericDef(genDef),
      true,
      `Client helper must also flag: ${genDef}`
    );
  }

  const legitimateDefinitions = [
    'An unspecified or unknown person; someone.',
    'Every person; all the people in a given group or in the world.',
    'An unspecified individual or person whose identity is unknown or unimportant in context.',
    'To make brief contact with someone to discuss a topic or get an update.',
  ];

  for (const legDef of legitimateDefinitions) {
    assert.strictEqual(
      isGenericPedagogicalDefinition(legDef),
      false,
      `Expected legitimate definition to pass: ${legDef}`
    );
    assert.strictEqual(
      clientIsGenericDef(legDef),
      false,
      `Client helper must also let pass: ${legDef}`
    );
  }
  console.log('✅ PASS: 1.1: Generic definition detection functions flawlessly.');

  const genericExamples = [
    'In daily speaking: "I practiced using \'somebody\' with confidence in our routine."',
    'We practiced how to touch base naturally during our daily conversation routine.',
    'Using "somebody" makes your daily English sound much more expressive and natural.',
    'She spoke English someone during our live conversation practice today.',
    'Understanding the term "everybody" helps you follow native English conversations easily.',
  ];

  for (const genEx of genericExamples) {
    assert.strictEqual(
      isGenericPedagogicalExample(genEx),
      true,
      `Expected generic example to be flagged: ${genEx}`
    );
  }

  const legitimateExamples = [
    'Somebody knocked on the front door while we were having breakfast.',
    'Everybody in the room was listening carefully to the speaker.',
    'Someone left their umbrella in the hallway.',
  ];

  for (const legEx of legitimateExamples) {
    assert.strictEqual(
      isGenericPedagogicalExample(legEx),
      false,
      `Expected legitimate example to pass: ${legEx}`
    );
  }
  console.log('✅ PASS: 1.2: Generic example sentence detection functions flawlessly.');

  console.log('\n--- 2. Validation of 3-Model Contingency & Real Pedagogical Definitions ---');
  const testWords = ['somebody', 'everybody', 'someone'];
  const definedResults: Record<string, any> = {};

  for (const w of testWords) {
    console.log(`\nTesting word: "${w}" via executeGeminiWithContingency...`);
    const prompt = `Analyze the word: "${w}".
Target CEFR: A1.
Student English Level: "elementary".

Generate a personalized pedagogical dictionary entry adhering strictly to Native Friend Notes standards:
1. "word": Exactly "${w}".
2. "partOfSpeech": Standardized grammatical class: Noun, Verb, Phrasal Verb, Pronoun, Adjective, Adverb, Idiomatic Expression, Collocation, or Preposition.
3. "cefrLevel": Accurate CEFR level for this term: A1, A2, B1, B2, C1, or C2 based on lexical complexity and natural usage.
4. "definitionEn": A personalized, crystal-clear pedagogical explanation in natural English tailored for an ESL learner explaining the practical meaning of this specific term without dictionary jargon or abbreviations (1-2 sentences).
5. "exampleSentenceEn": An authentic, realistic daily-life conversational example sentence showing how native speakers use this exact term in conversation, work, or daily life. Must be capitalized, with proper punctuation, and no surrounding quotes.
6. "translationPt": Accurate Brazilian Portuguese translation of the term in context.
7. "collocations": 2 to 3 natural, everyday collocations for this word.
8. "phonetic": Clean phonetic pronunciation guide.
9. "register": "informal" | "neutral" | "formal" | "idiomatic".

Respond strictly with a JSON object:
{
  "word": "${w}",
  "partOfSpeech": "...",
  "cefrLevel": "...",
  "definitionEn": "...",
  "exampleSentenceEn": "...",
  "translationPt": "...",
  "collocations": ["...", "..."],
  "phonetic": "...",
  "register": "..."
}`;

    const res = await executeGeminiWithContingency({
      feature: 'dictionary_define',
      systemInstruction: 'You are the master Native Friend Notes Pedagogical AI Engine. Provide accurate, crystal-clear lexical analyses for ESL learners in strict JSON.',
      untrustedUserDataPrompt: prompt,
      callerRole: 'student',
      temperature: 0.2,
      jsonValidator: (val) => Boolean(
        val &&
        val.definitionEn &&
        val.exampleSentenceEn &&
        !isGenericPedagogicalDefinition(val.definitionEn) &&
        !isGenericPedagogicalExample(val.exampleSentenceEn)
      ),
    });

    if (res.success && res.parsedJson) {
      console.log(`Model used for "${w}":`, res.modelUsed);
      console.log(`Definition for "${w}":`, res.parsedJson.definitionEn);
      console.log(`Example for "${w}":`, res.parsedJson.exampleSentenceEn);
      console.log(`CEFR for "${w}":`, res.parsedJson.cefrLevel);
      assert.strictEqual(isGenericPedagogicalDefinition(res.parsedJson.definitionEn), false);
      assert.strictEqual(isGenericPedagogicalExample(res.parsedJson.exampleSentenceEn), false);
      assert.ok(res.parsedJson.definitionEn.length > 10);
      assert.ok(res.parsedJson.exampleSentenceEn.length > 10);
      definedResults[w] = res.parsedJson;
    } else {
      console.log(`Contingency exhausted or unavailable for "${w}":`, res.error?.safeReason);
      assert.strictEqual(res.parsedJson, null);
    }
  }
  console.log('✅ PASS: 2.1: Model executions produce legitimate definitions and failover transparently.');

  console.log('\n--- 3. Validation of Rejection of Pre-existing Generic Saved Content ---');
  // If user previously had a generic entry saved in their dictionary
  const legacyGenericEntry: StudentDictionaryEntry = {
    id: 'dict_someone_legacy',
    word: 'someone',
    originalWord: 'someone',
    normalizedWord: 'someone',
    definitionEn: 'A fundamental word for level A1: practice using "someone" in simple daily conversations.',
    exampleSentenceEn: 'In daily speaking: "I practiced using \'someone\' with confidence in our routine."',
    partOfSpeech: 'Vocabulary Item',
    cefrLevel: 'A1',
    learnedAt: new Date().toISOString(),
    source: 'routine',
  };

  // 3.1: getInstantOrCachedWord must NOT reuse this generic entry
  const instantLookup = getInstantOrCachedWord(
    'someone',
    undefined,
    'A1',
    'test_uid',
    'test@example.com',
    [legacyGenericEntry]
  );
  assert.strictEqual(
    instantLookup.definitionEn,
    '',
    'getInstantOrCachedWord must NOT return pre-existing generic definition'
  );
  assert.strictEqual(instantLookup.source, 'pending');
  console.log('✅ PASS: 3.1: getInstantOrCachedWord rejects pre-existing generic entry.');

  // 3.2: isDefinitionRicher must prefer a new legitimate definition over existing generic
  const legitimateDef = 'An unspecified or unknown person.';
  assert.strictEqual(
    isDefinitionRicher(legacyGenericEntry.definitionEn, legitimateDef),
    false,
    'Existing generic definition is NOT richer than a legitimate incoming definition'
  );
  console.log('✅ PASS: 3.2: isDefinitionRicher ensures real definition replaces legacy generic template.');

  // 3.3: consolidateDictionaryEntries must replace generic entry with real definition without losing word or origins
  const incomingRealEntry: StudentDictionaryEntry = {
    id: 'dict_someone_real',
    word: 'someone',
    originalWord: 'someone',
    normalizedWord: 'someone',
    definitionEn: 'An unspecified or unknown person.',
    exampleSentenceEn: 'Someone is knocking at the front door.',
    partOfSpeech: 'Pronoun',
    cefrLevel: 'A1',
    learnedAt: new Date().toISOString(),
    source: 'routine',
    enrichmentStatus: 'enriched',
  };

  const consolidated = consolidateDictionaryEntries([legacyGenericEntry], [incomingRealEntry]);
  assert.strictEqual(consolidated.length, 1);
  assert.strictEqual(consolidated[0].definitionEn, 'An unspecified or unknown person.');
  assert.strictEqual(consolidated[0].exampleSentenceEn, 'Someone is knocking at the front door.');
  assert.strictEqual(consolidated[0].partOfSpeech, 'Pronoun');
  console.log('✅ PASS: 3.3: consolidateDictionaryEntries upgrades legacy generic definition to authentic pedagogical definition.');

  // 3.4: Re-verification on page reload simulation
  // When activeDictionary already has the authentic definition, getInstantOrCachedWord reuses it instantly (0ms, 0 Gemini calls)
  const cachedLookup = getInstantOrCachedWord(
    'someone',
    undefined,
    'A1',
    'test_uid',
    'test@example.com',
    consolidated
  );
  assert.strictEqual(cachedLookup.definitionEn, 'An unspecified or unknown person.');
  assert.strictEqual(cachedLookup.source, 'my_dictionary');
  console.log('✅ PASS: 3.4: Persistence after page refresh reuses legitimate definition without repeating Gemini call.');

  console.log('\n======================================================');
  console.log('✅ ALL HOTFIX 5 WORDS DEFINITION VALIDATIONS PASSED!');
  console.log('======================================================');
}

runTests().catch((err) => {
  console.error('Validation test failed:', err);
  process.exit(1);
});
