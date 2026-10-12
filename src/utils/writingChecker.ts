import { EnglishLevel, WritingEvaluationResult, WordFeedback, SentenceFeedback, WeeklyHomeworkData, HomeworkAiEvaluation } from '../types';

export const GEMINI_PROJECT_ID = 'itissimple-security-staging';

const DAILY_SENTENCE_CACHE_VERSION = 'v3';

// Isolated client-side cache for Sentence of the Day to prevent redundant API calls and quota exhaustion
const dailySentenceClientCache = new Map<string, WritingEvaluationResult>();

/**
 * Shared deterministic grammar & vocabulary analyzer for English sentences.
 * Catches lowercase pronoun "i", verb tense mismatches (e.g., "Today was... because I pass" -> "passed"),
 * subject-verb agreement, auxiliary/modal errors, articles, prepositions, spelling, and daily words.
 */
export function analyzeSentenceGrammarDeterministic(
  sentence: string,
  dailyWords: string[] = [],
  targetWord: string = ''
): {
  fixedSentence: string;
  hasGrammarError: boolean;
  usedWords: string[];
  missingWords: string[];
  usedTargetWord: boolean;
  hasWordConstraint: boolean;
  errorsPt: string[];
  errorsEn: string[];
  wordFeedbacks: WordFeedback[];
} {
  const sClean = (sentence || '').trim();
  const rawList = Array.isArray(dailyWords) ? dailyWords : [];
  const allWords = Array.from(
    new Set(
      (targetWord ? [targetWord, ...rawList] : rawList)
        .map((w) => (typeof w === 'string' ? w.trim() : ''))
        .filter(Boolean)
    )
  );

  const errorsPt: string[] = [];
  const errorsEn: string[] = [];
  const wordFeedbacks: WordFeedback[] = [];
  let sFixed = sClean;
  let hasGrammarError = false;

  const pushWordFeedback = (original: string, corrected: string, explanationPt: string, explanationEn: string) => {
    if (!wordFeedbacks.some((wf) => wf.original.toLowerCase() === original.toLowerCase() && wf.corrected.toLowerCase() === corrected.toLowerCase())) {
      wordFeedbacks.push({
        original,
        hasError: true,
        corrected,
        explanationPt,
        explanationEn,
      });
    }
  };

  if (sClean.length >= 2) {
    // 1. Capitalization of standalone pronoun "i" and contractions ("i'm", "i'll", "i've", "i'd")
    if (/\bi\b/.test(sFixed) || /\bi'(m|ll|ve|d)\b/.test(sFixed)) {
      if (/\bi'(m|ll|ve|d)\b/.test(sFixed)) {
        sFixed = sFixed.replace(/\bi'(m|ll|ve|d)\b/g, (m, suffix) => {
          const fixed = `I'${suffix}`;
          pushWordFeedback(m, fixed, 'O pronome pessoal "I" deve ser sempre escrito com letra maiúscula em inglês.', 'The pronoun "I" must always be capitalized in English.');
          return fixed;
        });
      }
      if (/\bi\b/.test(sFixed)) {
        sFixed = sFixed.replace(/\bi\b/g, () => {
          pushWordFeedback('i', 'I', 'O pronome pessoal "I" (eu) deve ser sempre escrito com letra maiúscula em inglês.', 'The personal pronoun "I" must always be capitalized in English.');
          return 'I';
        });
      }
      hasGrammarError = true;
      errorsPt.push('O pronome pessoal "I" (eu) deve ser sempre escrito em letra maiúscula.');
      errorsEn.push('The personal pronoun "I" must always be capitalized in English.');
    }

    // 2. Past Tense Consistency in Past Narrative / Causal Clauses
    // e.g., "Today was a perfect day, because I pass the test" -> "because I passed the test"
    const IRREGULAR_AND_COMMON_PAST_MAP: Record<string, string> = {
      pass: 'passed',
      finish: 'finished',
      start: 'started',
      work: 'worked',
      study: 'studied',
      watch: 'watched',
      listen: 'listened',
      learn: 'learned',
      play: 'played',
      walk: 'walked',
      talk: 'talked',
      call: 'called',
      help: 'helped',
      try: 'tried',
      use: 'used',
      need: 'needed',
      want: 'wanted',
      like: 'liked',
      love: 'loved',
      live: 'lived',
      move: 'moved',
      open: 'opened',
      close: 'closed',
      stop: 'stopped',
      decide: 'decided',
      happen: 'happened',
      receive: 'received',
      achieve: 'achieved',
      complete: 'completed',
      cook: 'cooked',
      clean: 'cleaned',
      visit: 'visited',
      travel: 'traveled',
      miss: 'missed',
      enjoy: 'enjoyed',
      practice: 'practiced',
      solve: 'solved',
      fix: 'fixed',
      go: 'went',
      get: 'got',
      make: 'made',
      do: 'did',
      have: 'had',
      take: 'took',
      see: 'saw',
      come: 'came',
      know: 'knew',
      think: 'thought',
      find: 'found',
      give: 'gave',
      tell: 'told',
      feel: 'felt',
      leave: 'left',
      buy: 'bought',
      bring: 'brought',
      begin: 'began',
      keep: 'kept',
      write: 'wrote',
      hear: 'heard',
      meet: 'met',
      run: 'ran',
      pay: 'paid',
      sit: 'sat',
      speak: 'spoke',
      lose: 'lost',
      fall: 'fell',
      send: 'sent',
      build: 'built',
      understand: 'understood',
      break: 'broke',
      spend: 'spent',
      drive: 'drove',
      wear: 'wore',
      choose: 'chose',
      eat: 'ate',
      drink: 'drank',
      sleep: 'slept',
      win: 'won',
      forget: 'forgot',
      wake: 'woke',
    };

    const verbKeysPattern = Object.keys(IRREGULAR_AND_COMMON_PAST_MAP).join('|');
    const hasPastMainClause =
      /\b(today\s+was|it\s+was|yesterday|last\s+(?:night|week|month|year|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|earlier\s+today|this\s+morning)\b/i.test(sFixed) ||
      /\b(I|he|she|we|they)\s+(was|were|had|did|went|got|made|took|saw|came|felt|left|bought|ate|drank|slept|won|woke|passed|finished|started|worked|studied|watched|listened|learned)\b/i.test(sFixed);

    if (hasPastMainClause) {
      // Check causal/temporal/coordinate clauses with bare present verbs (excluding future "will/going to/can/should/to <verb>")
      const pastClauseVerbRegex = new RegExp(
        `\\b(because|since|as|when|after|before|so|and(?:\\s+then)?|yesterday|this\\s+morning|last\\s+(?:night|week|month|year))\\s+(I|you|he|she|it|we|they)\\s+(${verbKeysPattern})\\b`,
        'gi'
      );
      sFixed = sFixed.replace(pastClauseVerbRegex, (fullMatch, conj, pronoun, rawVerb) => {
        const lowerVerb = rawVerb.toLowerCase();
        const pastForm = IRREGULAR_AND_COMMON_PAST_MAP[lowerVerb];
        if (!pastForm) return fullMatch;
        hasGrammarError = true;
        pushWordFeedback(
          rawVerb,
          pastForm,
          `Tempo verbal: como a frase está no passado, use "${pastForm}" em vez de "${rawVerb}".`,
          `Verb tense: since the sentence describes a past event, use the simple past "${pastForm}" instead of "${rawVerb}".`
        );
        errorsPt.push(`Concordância de tempo verbal: como a ação já ocorreu no passado, utilize o verbo no Simple Past ("${pastForm}" em vez de "${rawVerb}").`);
        errorsEn.push(`Verb tense consistency: since the action already happened in the past, use the Simple Past ("${pastForm}" instead of "${rawVerb}").`);
        return `${conj} ${pronoun} ${pastForm}`;
      });

      // Also check "Yesterday / This morning / Last night I <base_verb>" at start of clause
      const explicitPastMarkerVerbRegex = new RegExp(
        `\\b(yesterday|this\\s+morning|earlier\\s+today|last\\s+(?:night|week|month|year))(?:,\\s*|\\s+)(I|you|he|she|it|we|they)\\s+(${verbKeysPattern})\\b`,
        'gi'
      );
      sFixed = sFixed.replace(explicitPastMarkerVerbRegex, (fullMatch, marker, pronoun, rawVerb) => {
        const lowerVerb = rawVerb.toLowerCase();
        const pastForm = IRREGULAR_AND_COMMON_PAST_MAP[lowerVerb];
        if (!pastForm) return fullMatch;
        hasGrammarError = true;
        pushWordFeedback(
          rawVerb,
          pastForm,
          `Tempo verbal: após "${marker}", use o passado "${pastForm}".`,
          `Verb tense: after "${marker}", use the past tense "${pastForm}".`
        );
        errorsPt.push(`Tempo verbal: com "${marker}", use o verbo no passado ("${pastForm}" em vez de "${rawVerb}").`);
        errorsEn.push(`Verb tense: with "${marker}", use the past tense ("${pastForm}" instead of "${rawVerb}").`);
        return `${marker} ${pronoun} ${pastForm}`;
      });
    }

    // Remove unnecessary comma directly before "because" after a simple positive main clause (e.g. "Today was a perfect day, because...")
    if (/\b(day|morning|afternoon|evening|night|week|time|experience|lesson|test|class),\s+because\b/i.test(sFixed)) {
      sFixed = sFixed.replace(/\b(day|morning|afternoon|evening|night|week|time|experience|lesson|test|class),\s+because\b/gi, '$1 because');
      // If followed by "and now I will", ensure natural comma before ", and now"
      sFixed = sFixed.replace(/\b(because\s+[^,.!?]+?)\s+and\s+now\s+(I|we|he|she|they)\s+will\b/i, '$1, and now $2 will');
    }

    // 3. Auxiliary "didn't / did not" + past tense verb -> base verb
    const PAST_TO_BASE_MAP: Record<string, string> = {};
    Object.entries(IRREGULAR_AND_COMMON_PAST_MAP).forEach(([base, past]) => {
      PAST_TO_BASE_MAP[past] = base;
    });
    const pastFormsPattern = Object.keys(PAST_TO_BASE_MAP).join('|');
    const didntPastRegex = new RegExp(`\\b(didn't|did\\s+not)\\s+(${pastFormsPattern})\\b`, 'gi');
    if (didntPastRegex.test(sFixed)) {
      sFixed = sFixed.replace(didntPastRegex, (m, aux, pastVerb) => {
        const base = PAST_TO_BASE_MAP[pastVerb.toLowerCase()] || pastVerb;
        hasGrammarError = true;
        pushWordFeedback(`${aux} ${pastVerb}`, `${aux} ${base}`, `Após "${aux}", o verbo principal permanece na forma base ("${base}").`, `After "${aux}", use the base form of the verb ("${base}").`);
        errorsPt.push(`Estrutura verbal: após "${aux}", use o verbo na forma base ("${aux} ${base}").`);
        errorsEn.push(`Verb form: after "${aux}", use the base verb ("${aux} ${base}").`);
        return `${aux} ${base}`;
      });
    }

    // 4. Modal verbs followed by "to" (e.g. "will to be", "can to go", "must to study")
    if (/\b(will|would|can|cannot|can't|could|should|must|might|may)\s+to\s+([a-z]+)\b/i.test(sFixed)) {
      sFixed = sFixed.replace(/\b(will|would|can|cannot|can't|could|should|must|might|may)\s+to\s+([a-z]+)\b/gi, (m, modal, verb) => {
        hasGrammarError = true;
        pushWordFeedback(`${modal} to ${verb}`, `${modal} ${verb}`, `Verbos modais ("${modal}") são seguidos diretamente pelo verbo sem "to".`, `Modal verbs ("${modal}") are followed directly by the base verb without "to".`);
        errorsPt.push(`Verbos modais: não use "to" após "${modal}" (use "${modal} ${verb}").`);
        errorsEn.push(`Modal verbs: do not use "to" after "${modal}" (use "${modal} ${verb}").`);
        return `${modal} ${verb}`;
      });
    }

    // 5. Subject-verb agreement (to be / have / don't / 3rd person singular)
    if (/\bI\s+is\b/g.test(sFixed)) {
      sFixed = sFixed.replace(/\bI\s+is\b/g, 'I am');
      hasGrammarError = true;
      pushWordFeedback('I is', 'I am', 'Com o pronome "I", a conjugação correta do verbo to be é "I am".', 'With "I", the correct form of the verb to be is "I am".');
      errorsPt.push('Concordância verbal: use "I am" em vez de "I is".');
      errorsEn.push('Subject-verb agreement: use "I am" instead of "I is".');
    }
    if (/\b(you|we|they)\s+is\b/i.test(sFixed)) {
      sFixed = sFixed.replace(/\b(you|we|they)\s+is\b/gi, (m, subj) => {
        hasGrammarError = true;
        pushWordFeedback(m, `${subj} are`, `Com "${subj}", use "are".`, `With "${subj}", use "are".`);
        errorsPt.push(`Concordância verbal: use "${subj} are" em vez de "${subj} is".`);
        errorsEn.push(`Subject-verb agreement: use "${subj} are" instead of "${subj} is".`);
        return `${subj} are`;
      });
    }
    if (/\b(you|we|they)\s+was\b/i.test(sFixed)) {
      sFixed = sFixed.replace(/\b(you|we|they)\s+was\b/gi, (m, subj) => {
        hasGrammarError = true;
        pushWordFeedback(m, `${subj} were`, `No passado com "${subj}", use "were".`, `In the past tense with "${subj}", use "were".`);
        errorsPt.push(`Concordância verbal: use "${subj} were" em vez de "${subj} was".`);
        errorsEn.push(`Subject-verb agreement: use "${subj} were" instead of "${subj} was".`);
        return `${subj} were`;
      });
    }
    if (/\b(I|you|we|they)\s+has\b/i.test(sFixed)) {
      sFixed = sFixed.replace(/\b(I|you|we|they)\s+has\b/gi, (m, subj) => {
        hasGrammarError = true;
        pushWordFeedback(m, `${subj} have`, `Com "${subj}", use "have" em vez de "has".`, `With "${subj}", use "have" instead of "has".`);
        errorsPt.push(`Concordância verbal: use "${subj} have" em vez de "${subj} has".`);
        errorsEn.push(`Verb agreement: use "${subj} have" instead of "${subj} has".`);
        return `${subj} have`;
      });
    }
    if (/\b(he|she|it)\s+don't\b/i.test(sFixed)) {
      sFixed = sFixed.replace(/\b(he|she|it)\s+don't\b/gi, (m, subj) => {
        hasGrammarError = true;
        pushWordFeedback(m, `${subj} doesn't`, `Na 3ª pessoa do singular ("${subj}"), use "doesn't".`, `For 3rd person singular ("${subj}"), use "doesn't".`);
        errorsPt.push(`Concordância verbal: use "${subj} doesn't" em vez de "${subj} don't".`);
        errorsEn.push(`Subject-verb agreement: use "${subj} doesn't" instead of "${subj} don't".`);
        return `${subj} doesn't`;
      });
    }
    if (/\b(he|she|it)\s+have\b/i.test(sFixed) && !/\b(will|would|can|could|should|must|might|may|did|didn't|doesn't|to)\s+(he|she|it)\s+have\b/i.test(sFixed)) {
      sFixed = sFixed.replace(/\b(he|she|it)\s+have\b/gi, (m, subj) => {
        hasGrammarError = true;
        pushWordFeedback(m, `${subj} has`, `Na 3ª pessoa do singular ("${subj}"), use "has".`, `For 3rd person singular ("${subj}"), use "has".`);
        errorsPt.push(`Concordância verbal: use "${subj} has" em vez de "${subj} have".`);
        errorsEn.push(`Subject-verb agreement: use "${subj} has" instead of "${subj} have".`);
        return `${subj} has`;
      });
    }

    // 5b. 1st/2nd/Plural Subject ("I", "you", "we", "they") + optional adverb + 3rd-person singular "-s" verb
    // e.g., "I really loves" -> "I really love", "I likes" -> "I like", "we goes" -> "we go"
    const THIRD_S_TO_BASE_MAP: Record<string, string> = {
      loves: 'love',
      likes: 'like',
      wants: 'want',
      needs: 'need',
      works: 'work',
      goes: 'go',
      does: 'do',
      has: 'have',
      makes: 'make',
      takes: 'take',
      knows: 'know',
      thinks: 'think',
      feels: 'feel',
      sees: 'see',
      comes: 'come',
      gets: 'get',
      gives: 'give',
      tells: 'tell',
      helps: 'help',
      plays: 'play',
      studies: 'study',
      watches: 'watch',
      listens: 'listen',
      learns: 'learn',
      speaks: 'speak',
      reads: 'read',
      writes: 'write',
      eats: 'eat',
      drinks: 'drink',
      sleeps: 'sleep',
      lives: 'live',
      enjoys: 'enjoy',
      prefers: 'prefer',
      uses: 'use',
      tries: 'try',
      starts: 'start',
      finishes: 'finish',
      passes: 'pass',
      wakes: 'wake',
      walks: 'walk',
      talks: 'talk',
      calls: 'call',
      buys: 'buy',
      brings: 'bring',
      keeps: 'keep',
      meets: 'meet',
      runs: 'run',
      pays: 'pay',
      sits: 'sit',
      loses: 'lose',
      sends: 'send',
      spends: 'spend',
      drives: 'drive',
      chooses: 'choose',
      wins: 'win',
      forgets: 'forget',
      understands: 'understand',
      believes: 'believe',
      hopes: 'hope',
      practices: 'practice',
    };

    const thirdSVerbPattern = Object.keys(THIRD_S_TO_BASE_MAP).join('|');
    const nonThirdSubjVerbRegex = new RegExp(
      `\\b(I|you|we|they)(\\s+(?:really|always|never|usually|often|sometimes|just|still|also|truly|only|so|very\\s+much))?\\s+(${thirdSVerbPattern})\\b`,
      'gi'
    );
    if (nonThirdSubjVerbRegex.test(sFixed)) {
      sFixed = sFixed.replace(nonThirdSubjVerbRegex, (fullMatch, subj, advGroup, sVerb) => {
        const baseVerb = THIRD_S_TO_BASE_MAP[sVerb.toLowerCase()];
        if (!baseVerb) return fullMatch;
        hasGrammarError = true;
        pushWordFeedback(
          sVerb,
          baseVerb,
          `Concordância verbal: com o sujeito "${subj}", o verbo fica na forma base "${baseVerb}" (sem "-s").`,
          `Subject-verb agreement: with "${subj}", use the base verb "${baseVerb}" (without "-s").`
        );
        errorsPt.push(`Concordância verbal: com o pronome "${subj}", use "${baseVerb}" em vez de "${sVerb}" (o "-s" final é usado apenas para he/she/it).`);
        errorsEn.push(`Subject-verb agreement: with "${subj}", use "${baseVerb}" instead of "${sVerb}" ("-s" is only used for he/she/it).`);
        return `${subj}${advGroup || ''} ${baseVerb}`;
      });
    }

    // 5c. 3rd-person singular ("he", "she", "it") + optional adverb + base verb in present tense
    const BASE_TO_THIRD_S_MAP: Record<string, string> = {};
    Object.entries(THIRD_S_TO_BASE_MAP).forEach(([sForm, baseForm]) => {
      BASE_TO_THIRD_S_MAP[baseForm] = sForm;
    });
    const baseForThirdPattern = Object.keys(BASE_TO_THIRD_S_MAP).join('|');
    if (!hasPastMainClause) {
      const thirdSubjBaseVerbRegex = new RegExp(
        `\\b(he|she|it)(\\s+(?:really|always|never|usually|often|sometimes|just|still|also|truly|only))?\\s+(${baseForThirdPattern})\\b`,
        'gi'
      );
      sFixed = sFixed.replace(thirdSubjBaseVerbRegex, (fullMatch, subj, advGroup, baseVerb, offset, fullStr) => {
        // Ensure not preceded by modal/auxiliary ("will he go", "does she like", "didn't he go")
        const before = fullStr.slice(Math.max(0, offset - 15), offset);
        if (/\b(will|would|can|could|should|must|might|may|do|does|did|doesn't|don't|didn't|to|let|make|help)\s+$/i.test(before)) {
          return fullMatch;
        }
        const sForm = BASE_TO_THIRD_S_MAP[baseVerb.toLowerCase()];
        if (!sForm) return fullMatch;
        hasGrammarError = true;
        pushWordFeedback(
          baseVerb,
          sForm,
          `Concordância na 3ª pessoa do singular: com "${subj}", use "${sForm}".`,
          `3rd-person singular agreement: with "${subj}", use "${sForm}".`
        );
        errorsPt.push(`Concordância verbal: na 3ª pessoa do singular ("${subj}"), acrescente "-s/-es" ao verbo ("${sForm}" em vez de "${baseVerb}").`);
        errorsEn.push(`Subject-verb agreement: in the 3rd-person singular ("${subj}"), use "${sForm}" instead of "${baseVerb}".`);
        return `${subj}${advGroup || ''} ${sForm}`;
      });
    }

    // 5d. Double direct object / redundant pronoun before demonstrative/determiner ("love you this platform" -> "love this platform")
    if (/\b(love|like|enjoy|prefer|appreciate|hate|use|need|want|watch|see|know|understand|find|buy|get|make|take)\s+(you|it|him|her|them)\s+(this|that|these|those|the|a|an|my|your|our|their)\b/i.test(sFixed)) {
      sFixed = sFixed.replace(/\b(love|like|enjoy|prefer|appreciate|hate|use|need|want|watch|see|know|understand|find|buy|get|make|take)\s+(you|it|him|her|them)\s+(this|that|these|those|the|a|an|my|your|our|their)\b/gi, (m, verb, pron, det) => {
        hasGrammarError = true;
        pushWordFeedback(`${verb} ${pron} ${det}`, `${verb} ${det}`, `Remova o pronome redundante "${pron}" antes de "${det}".`, `Remove the redundant pronoun "${pron}" before "${det}".`);
        errorsPt.push(`Estrutura da frase: remova o pronome extra "${pron}" antes de "${det}" (use "${verb} ${det}...").`);
        errorsEn.push(`Sentence structure: remove the extra pronoun "${pron}" before "${det}" (use "${verb} ${det}...").`);
        return `${verb} ${det}`;
      });
    }

    // 5e. Preposition, collocation, and comparative fixes (common ESL/Portuguese interference patterns)
    if (/\b(listen|listens|listened|listening)\s+(music|the\s+music|a\s+song|songs|podcast|podcasts|a\s+podcast|the\s+podcast|the\s+radio|audio|the\s+audio|the\s+teacher|you|him|her|them|us|me)\b/i.test(sFixed)) {
      sFixed = sFixed.replace(/\b(listen|listens|listened|listening)\s+(music|the\s+music|a\s+song|songs|podcast|podcasts|a\s+podcast|the\s+podcast|the\s+radio|audio|the\s+audio|the\s+teacher|you|him|her|them|us|me)\b/gi, (m, v, obj) => {
        hasGrammarError = true;
        pushWordFeedback(`${v} ${obj}`, `${v} to ${obj}`, 'O verbo "listen" exige a preposição "to" antes do complemento ("listen to").', 'The verb "listen" requires the preposition "to" before its object ("listen to").');
        errorsPt.push(`Regência verbal: use "${v} to ${obj}" (o verbo "listen" pede a preposição "to").`);
        errorsEn.push(`Preposition required: use "${v} to ${obj}" ("listen" requires "to").`);
        return `${v} to ${obj}`;
      });
    }
    if (/\b(depend|depends|depended|depending)\s+of\b/i.test(sFixed)) {
      sFixed = sFixed.replace(/\b(depend|depends|depended|depending)\s+of\b/gi, (m, v) => {
        hasGrammarError = true;
        pushWordFeedback(m, `${v} on`, 'Use a preposição "on" após "depend" ("depend on").', 'Use the preposition "on" after "depend" ("depend on").');
        errorsPt.push(`Regência verbal: em inglês usa-se "${v} on" (e não "${v} of").`);
        errorsEn.push(`Preposition error: use "${v} on" instead of "${v} of".`);
        return `${v} on`;
      });
    }
    if (/\bgood\s+in\s+(english|math|sports|music|cooking|speaking|writing|reading|listening|games|work)\b/i.test(sFixed)) {
      sFixed = sFixed.replace(/\bgood\s+in\s+(english|math|sports|music|cooking|speaking|writing|reading|listening|games|work)\b/gi, (m, skill) => {
        hasGrammarError = true;
        pushWordFeedback('good in', 'good at', 'Para habilidades, use "good at" em vez de "good in".', 'For skills and activities, use "good at" instead of "good in".');
        errorsPt.push('Preposição: para habilidades ou matérias, use "good at" em vez de "good in".');
        errorsEn.push('Preposition: for skills or subjects, use "good at" instead of "good in".');
        return `good at ${skill}`;
      });
    }
    if (/\b(go|goes|went|going|come|comes|came|coming|arrive|arrived|get|got)\s+to\s+home\b/i.test(sFixed)) {
      sFixed = sFixed.replace(/\b(go|goes|went|going|come|comes|came|coming|arrive|arrived|get|got)\s+to\s+home\b/gi, (m, v) => {
        hasGrammarError = true;
        pushWordFeedback(m, `${v} home`, 'Antes da palavra "home" com verbos de movimento, não se usa "to".', 'Do not use "to" before "home" with verbs of motion.');
        errorsPt.push(`Preposição: diga "${v} home" (sem a preposição "to" antes de "home").`);
        errorsEn.push(`Preposition: use "${v} home" (without "to" before "home").`);
        return `${v} home`;
      });
    }
    if (/\bin\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(sFixed)) {
      sFixed = sFixed.replace(/\bin\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi, (m, day) => {
        const capDay = day.charAt(0).toUpperCase() + day.slice(1).toLowerCase();
        hasGrammarError = true;
        pushWordFeedback(m, `on ${capDay}`, 'Antes de dias da semana, usa-se a preposição "on".', 'Use the preposition "on" before days of the week.');
        errorsPt.push(`Preposição: antes de dias da semana, use "on ${capDay}" (e não "in").`);
        errorsEn.push(`Preposition: use "on ${capDay}" before days of the week.`);
        return `on ${capDay}`;
      });
    }
    if (/\bI\s+have\s+(\d+)\s+years(\s+old)?\b/i.test(sFixed)) {
      sFixed = sFixed.replace(/\bI\s+have\s+(\d+)\s+years(\s+old)?\b/gi, (m, age) => {
        hasGrammarError = true;
        pushWordFeedback(m, `I am ${age} years old`, 'Em inglês, expressamos idade com o verbo "to be" ("I am ... years old").', 'In English, use the verb "to be" to express age ("I am ... years old").');
        errorsPt.push(`Em inglês, para dizer a idade, usa-se o verbo "to be": "I am ${age} years old".`);
        errorsEn.push(`In English, express age with "to be": "I am ${age} years old".`);
        return `I am ${age} years old`;
      });
    }
    if (/\bmore\s+(better|worse|easier|harder|faster|slower|bigger|smaller|happier|older|younger|higher|lower)\b/i.test(sFixed)) {
      sFixed = sFixed.replace(/\bmore\s+(better|worse|easier|harder|faster|slower|bigger|smaller|happier|older|younger|higher|lower)\b/gi, (m, comp) => {
        hasGrammarError = true;
        pushWordFeedback(m, comp, `"${comp}" já está no grau comparativo; não use "more" antes.`, `"${comp}" is already a comparative form; do not use "more" before it.`);
        errorsPt.push(`Duplo comparativo: use apenas "${comp}" (ou "much ${comp}"), sem "more".`);
        errorsEn.push(`Double comparative: use "${comp}" (or "much ${comp}") without "more".`);
        return comp;
      });
    }
    if (/\bfor\s+to\s+([a-z]+)\b/i.test(sFixed)) {
      sFixed = sFixed.replace(/\bfor\s+to\s+([a-z]+)\b/gi, (m, v) => {
        hasGrammarError = true;
        pushWordFeedback(m, `to ${v}`, 'Para indicar finalidade, use apenas "to + verbo" (sem "for").', 'To express purpose, use "to + verb" (without "for").');
        errorsPt.push(`Para indicar finalidade/objetivo, use apenas "to ${v}" (e não "for to ${v}").`);
        errorsEn.push(`To express purpose, use "to ${v}" instead of "for to ${v}".`);
        return `to ${v}`;
      });
    }
    if (/\b(make|makes|made|making)\s+(my\s+|the\s+|some\s+)?homework\b/i.test(sFixed)) {
      sFixed = sFixed.replace(/\b(make|makes|made|making)\s+(my\s+|the\s+|some\s+)?homework\b/gi, (m, v, det) => {
        const lowerV = v.toLowerCase();
        const doForm = lowerV === 'made' ? 'did' : lowerV === 'makes' ? 'does' : lowerV === 'making' ? 'doing' : 'do';
        hasGrammarError = true;
        pushWordFeedback(m, `${doForm} ${det || ''}homework`, 'Com "homework", o verbo correto em inglês é "do" ("do homework").', 'Use the verb "do" with "homework" ("do homework").');
        errorsPt.push(`Colocação verbal: em inglês dizemos "${doForm} ${det || ''}homework" (e não "${v} homework").`);
        errorsEn.push(`Collocation: in English we say "${doForm} ${det || ''}homework" (not "${v} homework").`);
        return `${doForm} ${det || ''}homework`;
      });
    }

    // Capitalize language names ("english" -> "English", "portuguese" -> "Portuguese")
    if (/\b(english|portuguese|spanish|french|italian|german)\b/.test(sFixed)) {
      sFixed = sFixed.replace(/\b(english|portuguese|spanish|french|italian|german)\b/g, (m) => {
        const cap = m.charAt(0).toUpperCase() + m.slice(1);
        hasGrammarError = true;
        pushWordFeedback(m, cap, `Nomes de idiomas em inglês são sempre escritos com letra maiúscula ("${cap}").`, `Language names in English are always capitalized ("${cap}").`);
        errorsPt.push(`Capitalização: nomes de idiomas em inglês sempre começam com letra maiúscula ("${cap}").`);
        errorsEn.push(`Capitalization: language names in English must always be capitalized ("${cap}").`);
        return cap;
      });
    }

    // 6. Missing dummy subject "it" in impersonal clauses
    if (/\b(sometimes\s+)?is\s+better\b/i.test(sFixed) && !/\b(it|this|that|what|which)\s+(sometimes\s+)?is\s+better\b/i.test(sFixed)) {
      sFixed = sFixed.replace(/\b(sometimes\s+)?is\s+better\b/gi, (match) => {
        if (/^sometimes/i.test(match)) {
          return match[0] === 'S' ? 'Sometimes it is better' : 'sometimes it is better';
        }
        return match[0] === 'I' || match[0] === 'i' ? 'It is better' : 'it is better';
      });
      hasGrammarError = true;
      errorsPt.push("Omissão de sujeito: orações impessoais exigem o pronome 'it' (use 'It is better' ou 'Sometimes it is better').");
      errorsEn.push("Missing dummy subject: English requires 'it' in impersonal clauses (use 'It is better' or 'Sometimes it is better').");
    } else if (/(^|[.?!;]\s*)is\s+(important|necessary|hard|easy|good|essential|bad|impossible|possible)\b/i.test(sFixed)) {
      sFixed = sFixed.replace(/(^|[.?!;]\s*)is\s+(important|necessary|hard|easy|good|essential|bad|impossible|possible)\b/gi, '$1It is $2');
      hasGrammarError = true;
      errorsPt.push("Omissão de sujeito: inicie com 'It is' para adjetivos predicativos impessoais.");
      errorsEn.push("Missing subject: start with 'It is' for impersonal predicate adjectives.");
    }

    // 7. Missing infinitive particle "to" after "better"
    if (/\b(it\s+is\s+better|is\s+better)\s+(take|face|leave|stay|go|do|make|get|have|be|stop|start|try|listen|focus|choose)\b/i.test(sFixed)) {
      sFixed = sFixed.replace(/\b(it\s+is\s+better|is\s+better)\s+(take|face|leave|stay|go|do|make|get|have|be|stop|start|try|listen|focus|choose)\b/gi, (match, prefix, verb) => {
        const cleanPrefix = prefix.toLowerCase().includes('it') ? prefix : (prefix[0] === 'I' ? 'It is better' : 'it is better');
        return `${cleanPrefix} to ${verb}`;
      });
      hasGrammarError = true;
      errorsPt.push("Falta do marcador de infinitivo: use 'to' após 'better' (ex: 'better to stop', 'better to take').");
      errorsEn.push("Missing infinitive particle: use 'to' after 'better' (e.g., 'better to stop', 'better to take').");
    }

    // 8. Gerund after 'stop' to cease an action
    if (/\bstop\s+to\s+(complain|worry|cry|smoke|argue|judge|overthink)\b/i.test(sFixed)) {
      sFixed = sFixed.replace(/\bstop\s+to\s+(complain|worry|cry|smoke|argue|judge|overthink)\b/gi, (m, verb) => {
        let g = verb + 'ing';
        if (verb.endsWith('e') && !verb.endsWith('ee')) g = verb.slice(0, -1) + 'ing';
        return `stop ${g}`;
      });
      hasGrammarError = true;
      errorsPt.push("Uso de gerúndio: para cessar uma atitude ou hábito, use 'stop + gerúndio' (ex: 'stop complaining').");
      errorsEn.push("Gerund usage: to cease an action, use 'stop + gerund' (e.g., 'stop complaining').");
    }

    // 9. Incorrect prepositional governance ("instead to" -> "instead of + -ing")
    if (/\binstead\s+(to\s+([a-z]+)|(face|do|take|make|stay|go|complain|wait)\b)/i.test(sFixed)) {
      sFixed = sFixed.replace(/\binstead\s+(to\s+([a-z]+)|([a-z]+)\b)/gi, (match, toGroup, verb1, verb2) => {
        const v = (verb1 || verb2 || '').toLowerCase();
        if (!v || v === 'of') return match;
        let gerund = v + 'ing';
        if (v.endsWith('e') && !v.endsWith('ee')) {
          gerund = v.slice(0, -1) + 'ing';
        }
        return `instead of ${gerund}`;
      });
      hasGrammarError = true;
      errorsPt.push("Regência incorreta: após 'instead', usa-se 'instead of' seguido de verbo com -ing.");
      errorsEn.push("Incorrect preposition: use 'instead of' + gerund (-ing).");
    }

    // 10. Indefinite article vowel/consonant sound error (a vs an)
    const A_BEFORE_VOWEL_REGEX = /\ba\s+([aeio][a-z]+|u(?!niversity|nicorn|nique|niform|nion|nit|ser|sage|seful|nisex|niversal|nilateral)[a-z]+|hour[a-z]*|honest[a-z]*|honor[a-z]*|heir[a-z]*)\b/gi;
    if (A_BEFORE_VOWEL_REGEX.test(sFixed)) {
      sFixed = sFixed.replace(A_BEFORE_VOWEL_REGEX, (match, word) => {
        if (/^(one|once)/i.test(word)) return match;
        const prefix = match[0] === 'A' ? 'An' : 'an';
        pushWordFeedback(match, `${prefix} ${word}`, "Use 'an' antes de som vocálico.", "Use 'an' before a vowel sound.");
        return `${prefix} ${word}`;
      });
      hasGrammarError = true;
      errorsPt.push("Erro de artigo indefinido: utilize 'an' antes de palavras iniciadas por som vocálico.");
      errorsEn.push("Indefinite article error: use 'an' before words starting with a vowel sound.");
    }

    const AN_BEFORE_CONSONANT_REGEX = /\ban\s+([bcdfghjklmnpqrstvwxyz](?!hour|honest|honor|heir)[a-z]+|university[a-z]*|unicorn[a-z]*|unique[a-z]*|uniform[a-z]*|union[a-z]*|unit[a-z]*|user[a-z]*|usage[a-z]*|useful[a-z]*|european[a-z]*|one|once)\b/gi;
    if (AN_BEFORE_CONSONANT_REGEX.test(sFixed)) {
      sFixed = sFixed.replace(AN_BEFORE_CONSONANT_REGEX, (match, word) => {
        const prefix = match[0] === 'A' ? 'A' : 'a';
        pushWordFeedback(match, `${prefix} ${word}`, "Use 'a' antes de som consonantal.", "Use 'a' before a consonant sound.");
        return `${prefix} ${word}`;
      });
      hasGrammarError = true;
      errorsPt.push("Erro de artigo indefinido: utilize 'a' antes de palavras iniciadas por som consonantal.");
      errorsEn.push("Indefinite article error: use 'a' before words starting with a consonant sound.");
    }

    // 11. Confusable homophones & idiomatic prepositions
    if (/\bloose\s+(your|my|his|her|their|our|the|a|an|mental|mind|focus|control|temper|weight|job|state|peace|time|money|chance|opportunity|game|match)\b/i.test(sFixed)) {
      sFixed = sFixed.replace(/\bloose\s+(your|my|his|her|their|our|the|a|an|mental|mind|focus|control|temper|weight|job|state|peace|time|money|chance|opportunity|game|match)\b/gi, 'lose $1');
      hasGrammarError = true;
      pushWordFeedback('loose', 'lose', "Use 'lose' (verbo perder) em vez de 'loose' (solto).", "Use 'lose' (verb) instead of 'loose' (adjective).");
      errorsPt.push("Confusão ortográfica: use 'lose' (verbo perder) e não 'loose' (adjetivo solto).");
      errorsEn.push("Word confusion: use 'lose' (verb) instead of 'loose' (adjective).");
    }

    if (/\bin the end of the day\b/i.test(sFixed)) {
      sFixed = sFixed.replace(/\bin the end of the day\b/gi, 'At the end of the day');
      hasGrammarError = true;
      errorsPt.push("Expressão idiomática: o padrão natural em inglês é 'At the end of the day'.");
      errorsEn.push("Idiomatic phrasing: standard natural usage is 'At the end of the day'.");
    }

    // 12. Common spelling fixes
    const COMMON_SPELLING_FIXES: Record<string, { correct: string; explPt: string; explEn: string }> = {
      'plataform': { correct: 'platform', explPt: 'Em inglês, a grafia correta é "platform" (sem o "a" após o "t").', explEn: 'Correct spelling in English is "platform" (without "a" after "t").' },
      'plataforms': { correct: 'platforms', explPt: 'Em inglês, a grafia correta é "platforms".', explEn: 'Correct spelling in English is "platforms".' },
      'breackfast': { correct: 'breakfast', explPt: 'A grafia correta em inglês é "breakfast" (sem "c").', explEn: 'Correct spelling is "breakfast" (without "c").' },
      'brakfast': { correct: 'breakfast', explPt: 'A grafia correta é "breakfast" com "ea".', explEn: 'Correct spelling is "breakfast".' },
      'coffe': { correct: 'coffee', explPt: 'A palavra "coffee" termina com "ee" duplo.', explEn: 'The word "coffee" ends in double "ee".' },
      'coffie': { correct: 'coffee', explPt: 'A palavra "coffee" é escrita com "ee".', explEn: 'The word is spelled "coffee".' },
      'comute': { correct: 'commute', explPt: '"Commute" tem "mm" duplo.', explEn: '"Commute" has double "mm".' },
      'gymm': { correct: 'gym', explPt: '"Gym" tem apenas uma letra "m".', explEn: '"Gym" ends in a single "m".' },
      'diner': { correct: 'dinner', explPt: '"Dinner" (jantar) tem "nn" duplo.', explEn: '"Dinner" has double "n".' },
      'whater': { correct: 'water', explPt: '"Water" não tem a letra "h".', explEn: '"Water" is spelled without "h".' },
      'sleap': { correct: 'sleep', explPt: '"Sleep" é escrito com "ee".', explEn: '"Sleep" is spelled with "ee".' },
      'restorant': { correct: 'restaurant', explPt: 'A grafia correta é "restaurant".', explEn: 'Correct spelling is "restaurant".' },
      'restaurante': { correct: 'restaurant', explPt: 'Em inglês, "restaurant" não tem "e" no final.', explEn: 'In English, "restaurant" does not end in "e".' },
      'morrning': { correct: 'morning', explPt: '"Morning" tem apenas um "r".', explEn: '"Morning" has a single "r".' },
      'millestone': { correct: 'milestone', explPt: 'A grafia correta é "milestone" (um "l").', explEn: 'Correct spelling is "milestone" (single "l").' },
      'millestones': { correct: 'milestones', explPt: 'A grafia correta é "milestones" (um "l").', explEn: 'Correct spelling is "milestones" (single "l").' },
      'definately': { correct: 'definitely', explPt: 'A grafia correta é "definitely" (com "i").', explEn: 'Correct spelling is "definitely".' },
      'tommorow': { correct: 'tomorrow', explPt: 'A grafia correta é "tomorrow" (um "m" e dois "r").', explEn: 'Correct spelling is "tomorrow".' },
      'untill': { correct: 'until', explPt: 'A palavra "until" tem apenas um "l".', explEn: 'The word "until" ends in a single "l".' },
      'becouse': { correct: 'because', explPt: 'A grafia correta é "because".', explEn: 'Correct spelling is "because".' },
      'beacuse': { correct: 'because', explPt: 'A grafia correta é "because".', explEn: 'Correct spelling is "because".' },
      'recieve': { correct: 'receive', explPt: 'A grafia correta é "receive" ("ei").', explEn: 'Correct spelling is "receive".' },
      'acheive': { correct: 'achieve', explPt: 'A grafia correta é "achieve" ("ie").', explEn: 'Correct spelling is "achieve".' },
      'informations': { correct: 'information', explPt: '"Information" é incontável em inglês e não tem plural com "s".', explEn: '"Information" is uncountable in English and does not take "-s".' },
      'homeworks': { correct: 'homework', explPt: '"Homework" é incontável em inglês e não vai para o plural.', explEn: '"Homework" is uncountable and does not take "-s".' },
      'advices': { correct: 'advice', explPt: '"Advice" é incontável em inglês (use "advice" ou "pieces of advice").', explEn: '"Advice" is uncountable in English.' },
      'knowledges': { correct: 'knowledge', explPt: '"Knowledge" é incontável em inglês.', explEn: '"Knowledge" is uncountable in English.' },
      'equipments': { correct: 'equipment', explPt: '"Equipment" é incontável em inglês.', explEn: '"Equipment" is uncountable in English.' },
      'peoples': { correct: 'people', explPt: '"People" já está no plural.', explEn: '"People" is already plural.' },
      'childrens': { correct: 'children', explPt: '"Children" já é o plural de "child".', explEn: '"Children" is already plural.' },
      'wonderfull': { correct: 'wonderful', explPt: 'Adjetivos terminados em "-ful" têm apenas um "l" ("wonderful").', explEn: '"Wonderful" ends with a single "l".' },
      'beautifull': { correct: 'beautiful', explPt: '"Beautiful" termina com apenas um "l".', explEn: '"Beautiful" ends with a single "l".' },
      'carefull': { correct: 'careful', explPt: '"Careful" termina com apenas um "l".', explEn: '"Careful" ends with a single "l".' },
      'usefull': { correct: 'useful', explPt: '"Useful" termina com apenas um "l".', explEn: '"Useful" ends with a single "l".' },
      'helpfull': { correct: 'helpful', explPt: '"Helpful" termina com apenas um "l".', explEn: '"Helpful" ends with a single "l".' },
      'greatful': { correct: 'grateful', explPt: 'A grafia correta é "grateful".', explEn: 'Correct spelling is "grateful".' },
      'diferent': { correct: 'different', explPt: '"Different" é escrito com dois "f".', explEn: '"Different" is spelled with double "f".' },
      'diffrent': { correct: 'different', explPt: 'A grafia correta é "different".', explEn: 'Correct spelling is "different".' },
      'oportunity': { correct: 'opportunity', explPt: '"Opportunity" tem dois "p".', explEn: '"Opportunity" has double "p".' },
      'sucess': { correct: 'success', explPt: '"Success" tem dois "c" e dois "s".', explEn: '"Success" has double "c" and double "s".' },
      'bussiness': { correct: 'business', explPt: 'A grafia correta é "business" (um "s" no meio).', explEn: 'Correct spelling is "business".' },
      'enviroment': { correct: 'environment', explPt: 'A grafia correta é "environment" (com "nm").', explEn: 'Correct spelling is "environment".' },
      'goverment': { correct: 'government', explPt: 'A grafia correta é "government" (com "nm").', explEn: 'Correct spelling is "government".' },
      'profesional': { correct: 'professional', explPt: '"Professional" tem dois "s".', explEn: '"Professional" has double "s".' },
      'studing': { correct: 'studying', explPt: 'O gerúndio de "study" mantém o "y": "studying".', explEn: 'The "-ing" form of "study" is "studying".' },
      'writting': { correct: 'writing', explPt: '"Writing" tem apenas um "t".', explEn: '"Writing" has a single "t".' },
      'comming': { correct: 'coming', explPt: '"Coming" tem apenas um "m".', explEn: '"Coming" has a single "m".' },
      'begining': { correct: 'beginning', explPt: '"Beginning" tem dois "n".', explEn: '"Beginning" has double "n".' },
      'beleive': { correct: 'believe', explPt: 'A grafia correta é "believe" ("ie").', explEn: 'Correct spelling is "believe".' },
      'freind': { correct: 'friend', explPt: 'A grafia correta é "friend" ("ie").', explEn: 'Correct spelling is "friend".' },
      'wierd': { correct: 'weird', explPt: 'A grafia correta é "weird" ("ei").', explEn: 'Correct spelling is "weird".' },
      'thier': { correct: 'their', explPt: 'A grafia correta é "their" ("ei").', explEn: 'Correct spelling is "their".' },
      'wich': { correct: 'which', explPt: 'A grafia correta é "which" (com "wh").', explEn: 'Correct spelling is "which".' },
      'studant': { correct: 'student', explPt: 'A grafia correta em inglês é "student" (com "e").', explEn: 'Correct spelling is "student".' },
      'lenguage': { correct: 'language', explPt: 'A grafia correta é "language".', explEn: 'Correct spelling is "language".' },
      'langauge': { correct: 'language', explPt: 'A grafia correta é "language".', explEn: 'Correct spelling is "language".' },
    };

    Object.entries(COMMON_SPELLING_FIXES).forEach(([wrong, data]) => {
      const rx = new RegExp(`\\b${wrong}\\b`, 'gi');
      if (rx.test(sFixed)) {
        sFixed = sFixed.replace(rx, data.correct);
        hasGrammarError = true;
        errorsPt.push(data.explPt);
        errorsEn.push(data.explEn);
        pushWordFeedback(wrong, data.correct, data.explPt, data.explEn);
      }
    });

    // 13. Initial capitalization and terminal punctuation
    if (/^[a-z]/.test(sFixed)) {
      const firstWord = sFixed.split(/\s+/)[0];
      const capWord = firstWord.charAt(0).toUpperCase() + firstWord.slice(1);
      sFixed = sFixed.charAt(0).toUpperCase() + sFixed.slice(1);
      hasGrammarError = true;
      pushWordFeedback(firstWord, capWord, 'Inicie a frase com letra maiúscula.', 'Start the sentence with a capital letter.');
      errorsPt.push('Inicie a frase com letra maiúscula.');
      errorsEn.push('Start the sentence with a capital letter.');
    }
    if (!/[.!?]$/.test(sFixed)) {
      sFixed = sFixed + '.';
    }
  }

  // Vocabulary Usage Check with word-boundary & root awareness
  const lowerFixedOrClean = `${sClean.toLowerCase()} ${sFixed.toLowerCase()}`;
  const usedWords: string[] = [];
  const missingWords: string[] = [];

  for (const w of allWords) {
    const clean = w.trim();
    if (!clean) continue;
    const lower = clean.toLowerCase();
    const escaped = lower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const exactWordRx = new RegExp(`\\b${escaped}(?:s|es|ed|d|ing|er|est|ly)?\\b`, 'i');
    const targetRoot = lower.replace(/(ing|ed|s|es|d)$/i, '');
    const rootEscaped = targetRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rootWordRx = targetRoot.length >= 4 ? new RegExp(`\\b${rootEscaped}[a-z]*\\b`, 'i') : null;

    const isUsed =
      exactWordRx.test(lowerFixedOrClean) ||
      Boolean(rootWordRx && rootWordRx.test(lowerFixedOrClean)) ||
      (lower.includes(' ') && lowerFixedOrClean.includes(lower));

    if (isUsed) {
      usedWords.push(clean);
    } else {
      missingWords.push(clean);
    }
  }

  const hasWordConstraint = allWords.length > 0;
  const usedTargetWord = targetWord
    ? usedWords.some((w) => w.toLowerCase() === targetWord.trim().toLowerCase())
    : hasWordConstraint
    ? usedWords.length > 0
    : true;

  if (hasWordConstraint && !usedTargetWord) {
    hasGrammarError = true;
    errorsPt.push(
      targetWord
        ? `Lembre-se de incluir a palavra "${targetWord}" na sua frase.`
        : `Vocabulário ausente: inclua palavras da sua rotina de hoje na frase (${allWords.slice(0, 5).join(', ')}).`
    );
    errorsEn.push(
      targetWord
        ? `Remember to include the word "${targetWord}" in your sentence.`
        : `Missing vocabulary: include today's routine words in your sentence (${allWords.slice(0, 5).join(', ')}).`
    );
  }

  return {
    fixedSentence: sFixed,
    hasGrammarError,
    usedWords,
    missingWords,
    usedTargetWord,
    hasWordConstraint,
    errorsPt,
    errorsEn,
    wordFeedbacks,
  };
}

/**
 * Dedicated, standalone AI handler strictly for the "Sentence of the Day" component.
 * Sends only the necessary payload (user sentence and target daily vocabulary words)
 * to the isolated Gemini API endpoint using project `itissimple-security-staging`.
 */
export async function checkDailySentenceAi(
  sentence: string,
  dailyWords: string[] = []
): Promise<WritingEvaluationResult> {
  const cleanSentence = (sentence || '').trim();
  const cleanDailyWords = Array.from(
    new Set(
      (Array.isArray(dailyWords) ? dailyWords : [])
        .map((w) => (typeof w === 'string' ? w.trim() : ''))
        .filter(Boolean)
    )
  );

  if (!cleanSentence) {
    return evaluateLocally({ sentence: '', dailyWords: cleanDailyWords });
  }

  const cacheKey = `${DAILY_SENTENCE_CACHE_VERSION}::${cleanSentence}::${cleanDailyWords.map((w) => w.toLowerCase()).sort().join(',')}`;
  const cachedResult = dailySentenceClientCache.get(cacheKey);
  if (cachedResult) {
    return cachedResult;
  }

  // Run fast client-side deterministic analysis first so we never miss obvious grammar/tense/capitalization errors
  const localAnalysis = analyzeSentenceGrammarDeterministic(cleanSentence, cleanDailyWords);

  try {
    const res = await fetch('/api/check-daily-sentence', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sentence: cleanSentence,
        dailyWords: cleanDailyWords,
        projectId: GEMINI_PROJECT_ID,
      }),
    });

    if (res.ok) {
      const data = await res.json();
      if (data && typeof data === 'object') {
        const effectiveCorrected =
          data.correctedSentence && data.correctedSentence.trim() !== cleanSentence
            ? data.correctedSentence.trim()
            : localAnalysis.fixedSentence;

        const normInput = cleanSentence.replace(/[.!?\s]+$/, '');
        const normCorr = (effectiveCorrected || '').replace(/[.!?\s]+$/, '');
        const hasDiff = Boolean(normCorr && normCorr !== normInput);

        const hasAnyError = Boolean(
          localAnalysis.hasGrammarError ||
            hasDiff ||
            data.hasAnyError === true ||
            data.isCorrect === false ||
            !localAnalysis.usedTargetWord
        );

        const mergedWordFeedbacks =
          Array.isArray(data.wordFeedbacks) && data.wordFeedbacks.some((wf: WordFeedback) => wf.hasError)
            ? data.wordFeedbacks
            : localAnalysis.wordFeedbacks;

        const explanationPt =
          data.sentenceFeedback?.explanationPt ||
          data.explanation ||
          localAnalysis.errorsPt.join(' ') ||
          (hasAnyError
            ? 'Identificamos ajustes gramaticais para deixar sua frase natural e correta.'
            : 'Sua frase está gramaticalmente correta e natural.');

        const explanationEn =
          data.sentenceFeedback?.explanationEn ||
          localAnalysis.errorsEn.join(' ') ||
          (hasAnyError
            ? 'Suggested grammar adjustments to make your sentence natural and accurate.'
            : 'Your sentence is grammatically accurate and natural.');

        const usedWords =
          Array.isArray(data.usedWords) && data.usedWords.length > 0
            ? data.usedWords
            : localAnalysis.usedWords;
        const missingWords =
          Array.isArray(data.missingWords)
            ? data.missingWords
            : localAnalysis.missingWords;

        const targetWordFeedback =
          data.targetWordFeedback ||
          (localAnalysis.hasWordConstraint
            ? localAnalysis.usedTargetWord
              ? missingWords.length > 0
                ? `Palavras utilizadas (${usedWords.length}/${cleanDailyWords.length}): ${usedWords.join(', ')}. Não incluída(s): ${missingWords.join(', ')}.`
                : `Palavras da rotina utilizadas (${usedWords.length}/${cleanDailyWords.length}): ${usedWords.join(', ')}.`
              : `Inclua pelo menos uma palavra da sua rotina na frase (${cleanDailyWords.slice(0, 5).join(', ')}).`
            : '');

        const normalizedResult: WritingEvaluationResult = {
          ...data,
          hasAnyError,
          isCorrect: !hasAnyError,
          usedWords,
          missingWords,
          usedTargetWord: localAnalysis.usedTargetWord,
          targetWordFeedback,
          wordFeedbacks: mergedWordFeedbacks,
          sentenceFeedback: {
            original: cleanSentence,
            hasError: hasAnyError,
            corrected: effectiveCorrected,
            explanationPt,
            explanationEn,
          },
          explanation: explanationPt,
          correctedSentence: effectiveCorrected,
        };

        if (dailySentenceClientCache.size > 100) {
          const oldestKey = dailySentenceClientCache.keys().next().value;
          if (oldestKey) dailySentenceClientCache.delete(oldestKey);
        }
        dailySentenceClientCache.set(cacheKey, normalizedResult);
        return normalizedResult;
      }
    }
  } catch (err) {
    console.warn('Isolated daily sentence check fallback:', err);
  }

  const fallbackResult = evaluateLocally({
    sentence: cleanSentence,
    dailyWords: cleanDailyWords,
    words: cleanDailyWords,
  });
  dailySentenceClientCache.set(cacheKey, fallbackResult);
  return fallbackResult;
}

export interface CheckWritingParams {
  words?: string[];
  targetWord?: string;
  dailyWords?: string[];
  matchedWords?: string[];
  sentence?: string;
  activityName?: string;
  level?: EnglishLevel | string;
  instruction?: string;
  levelInstruction?: string;
  language?: string;
}

export async function checkStudentWritingApi(
  params: CheckWritingParams
): Promise<WritingEvaluationResult> {
  // 1. Try server API call
  try {
    const res = await fetch('/api/check-writing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });

    if (res.ok) {
      const data = await res.json();
      if (data && typeof data === 'object') {
        const hasAnyError = typeof data.hasAnyError === 'boolean'
          ? data.hasAnyError
          : typeof data.isCorrect === 'boolean'
          ? !data.isCorrect
          : Boolean(data.correctedSentence && data.correctedSentence.trim().toLowerCase() !== (params.sentence || '').trim().toLowerCase());

        return {
          ...data,
          hasAnyError,
          isCorrect: typeof data.isCorrect === 'boolean' ? data.isCorrect : !hasAnyError,
          explanation:
            data.explanation ||
            data.sentenceFeedback?.explanationPt ||
            data.sentenceFeedback?.explanationEn ||
            data.overallSummaryPt ||
            data.overallSummaryEn ||
            (hasAnyError ? 'Identificamos sugestões para aperfeiçoar sua frase.' : 'Sua frase está gramaticalmente correta.'),
          correctedSentence: data.correctedSentence || params.sentence || '',
        } as WritingEvaluationResult;
      }
    }
  } catch (err) {
    console.warn('Backend writing check unavailable, running local evaluation:', err);
  }

  // 2. Client-side heuristic fallback
  return evaluateLocally(params);
}

export async function evaluateWeeklyHomeworkApi(params: {
  homework: WeeklyHomeworkData;
  studentAnswers: {
    matching?: Record<string, string>;
    fillInBlanks?: Record<string, string>;
    sentences?: Record<string, string>;
    quizAnswers?: Record<string, number>;
  };
  studentLevel?: string;
  studentName?: string;
  currentLanguage?: string;
}): Promise<HomeworkAiEvaluation> {
  try {
    const res = await fetch('/api/homework/evaluate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });

    if (res.ok) {
      const data = await res.json();
      if (data && data.evaluation) {
        return data.evaluation as HomeworkAiEvaluation;
      }
    }
  } catch (err) {
    console.warn('Error evaluating homework via API:', err);
  }

  // Resilient client-side fallback evaluation
  const { homework, studentAnswers, studentLevel = 'Beginner' } = params;
  const { matching = {}, fillInBlanks = {}, sentences = {}, quizAnswers = {} } = studentAnswers;

  let matchingCorrect = 0;
  const matchingFeedback = (homework.matchingPairs || []).map((p) => {
    const ans = (matching[p.id] || '').trim();
    const isCorrect = ans.toLowerCase() === p.word.toLowerCase();
    if (isCorrect) matchingCorrect++;
    return {
      id: p.id,
      isCorrect,
      userAnswer: ans || '(sem resposta)',
      correctAnswer: p.word,
      explanationPt: isCorrect
        ? `Correto! "${p.word}" corresponde a "${p.translation}".`
        : `A resposta correta é "${p.word}" (${p.translation}).`,
      explanationEn: isCorrect
        ? `Correct! "${p.word}" matches "${p.definition}".`
        : `The correct answer is "${p.word}" (${p.definition}).`,
    };
  });

  let fillCorrect = 0;
  const fillFeedback = (homework.fillInBlanks || []).map((f) => {
    const ans = (fillInBlanks[f.id] || '').trim();
    const isCorrect = ans.toLowerCase() === f.correctWord.toLowerCase();
    if (isCorrect) fillCorrect++;
    return {
      id: f.id,
      isCorrect,
      userAnswer: ans || '(sem resposta)',
      correctAnswer: f.correctWord,
      explanationPt: f.explanationPt || (isCorrect ? `Excelente! "${f.correctWord}" completa a frase perfeitamente.` : `A palavra correta é "${f.correctWord}".`),
      explanationEn: f.explanationEn || (isCorrect ? `Great! "${f.correctWord}" completes the sentence.` : `The correct word is "${f.correctWord}".`),
    };
  });

  let quizCorrect = 0;
  const readingFeedback = (homework.readingPassage?.questions || []).map((q) => {
    const ansIdx = quizAnswers[q.id];
    const isCorrect = ansIdx === q.correctAnswer;
    if (isCorrect) quizCorrect++;
    return {
      id: q.id,
      isCorrect,
      userAnswer: q.options[ansIdx] || '(sem resposta)',
      correctAnswer: q.options[q.correctAnswer] || '',
      explanationPt: q.explanation || (isCorrect ? 'Resposta correta!' : 'Opção alinhada com o texto.'),
      explanationEn: q.explanation || (isCorrect ? 'Correct interpretation!' : 'Option aligned with the passage.'),
    };
  });

  const sentenceFeedback = (homework.sentenceWritingPrompts || []).map((p) => {
    const text = (sentences[p.word] || '').trim();
    const isCorrect = text.length >= 8 && text.toLowerCase().includes(p.word.toLowerCase());
    return {
      word: p.word,
      originalSentence: text || '(nenhuma frase enviada)',
      isCorrect,
      correctedSentence: text || `I use ${p.word} in my daily routine.`,
      explanationPt: isCorrect
        ? `Frase bem elaborada incorporando "${p.word}" com naturalidade.`
        : `Lembre-se de formar uma frase completa em inglês usando a palavra "${p.word}".`,
      explanationEn: isCorrect
        ? `Well-crafted sentence incorporating "${p.word}" naturally.`
        : `Remember to build a full English sentence using "${p.word}".`,
      levelAdvicePt: 'Continue praticando a formação de frases ativas conectadas à sua rotina.',
      levelAdviceEn: 'Keep practicing active sentence construction tied to your routine.',
    };
  });

  const totalPoints = 100;
  const totalM = Math.max(1, homework.matchingPairs.length);
  const totalF = Math.max(1, homework.fillInBlanks.length);
  const totalQ = Math.max(1, homework.readingPassage.questions.length);
  const totalS = Math.max(1, homework.sentenceWritingPrompts.length);

  let sentenceCorrect = 0;
  sentenceFeedback.forEach((s) => { if (s.isCorrect) sentenceCorrect++; });

  const score = Math.round(
    (matchingCorrect / totalM) * 25 +
    (fillCorrect / totalF) * 30 +
    (sentenceCorrect / totalS) * 25 +
    (quizCorrect / totalQ) * 20
  );

  return {
    overallScore: Math.min(100, score),
    evaluatedAt: new Date().toISOString(),
    studentLevel: studentLevel || 'Beginner',
    tutorFeedbackSummaryPt: `Parabéns pela dedicação! Você concluiu as etapas de memorização do vocabulário da sua semana com foco no nível ${studentLevel}. Continue integrando essas palavras na sua rotina diária.`,
    tutorFeedbackSummaryEn: `Congratulations on your dedication! You completed your weekly memorization activity calibrated for ${studentLevel} level. Keep applying these words in your daily life.`,
    levelStrengthsPt: 'Demonstrou bom reconhecimento de vocabulário e dedicação na prática ativa.',
    levelStrengthsEn: 'Demonstrated strong vocabulary recall and dedication in active practice.',
    levelNextStepsPt: 'Traga esses termos para a sua próxima aula de conversação com seu Amigo Nativo.',
    levelNextStepsEn: 'Bring these terms into your next live conversation session with your Native Friend.',
    matchingFeedback,
    fillFeedback,
    sentenceFeedback,
    readingFeedback,
  };
}

function evaluateLocally(params: CheckWritingParams): WritingEvaluationResult {
  const { words = [], targetWord = '', dailyWords = [], sentence = '', level = 'iniciante', levelInstruction = '' } = params;

  const rawList = dailyWords.length > 0 ? dailyWords : words;
  const allWords = targetWord ? Array.from(new Set([targetWord, ...rawList])) : rawList;
  const sClean = (sentence || '').trim();
  const lowerSentence = sClean.toLowerCase();

  const analysis = analyzeSentenceGrammarDeterministic(sClean, rawList, targetWord);
  const {
    fixedSentence,
    hasGrammarError,
    usedWords,
    missingWords,
    usedTargetWord,
    hasWordConstraint,
    errorsPt,
    errorsEn,
    wordFeedbacks,
  } = analysis;

  // Trigger check based on levelInstruction
  let usedTrigger: boolean | undefined = undefined;
  let triggerFeedback = '';
  if (levelInstruction && levelInstruction.trim()) {
    const triggerLower = levelInstruction.toLowerCase();
    if (triggerLower.includes('because') || triggerLower.includes('since')) {
      usedTrigger = /\b(because|since)\b/i.test(lowerSentence);
      triggerFeedback = usedTrigger
        ? 'Gatilho cumprido: você usou "because" ou "since" para justificar o motivo.'
        : 'Desafio: lembre-se de usar "because" ou "since" para explicar a sua razão.';
    } else if (triggerLower.includes('whenever')) {
      usedTrigger = /\bwhenever\b/i.test(lowerSentence);
      triggerFeedback = usedTrigger
        ? 'Gatilho cumprido: você aplicou "whenever" para descrever um hábito.'
        : 'Desafio: inclua o conectivo "whenever" para indicar frequência ou hábito.';
    } else if (triggerLower.includes('modal') || triggerLower.includes('might') || triggerLower.includes('should')) {
      usedTrigger = /\b(might|should|could|would|can|must)\b/i.test(lowerSentence);
      triggerFeedback = usedTrigger
        ? 'Gatilho cumprido: verbo modal aplicado adequadamente.'
        : 'Desafio: use um verbo modal como "might", "should" ou "could".';
    } else if (triggerLower.includes('conditional') || triggerLower.includes('if')) {
      usedTrigger = /\b(if|unless)\b/i.test(lowerSentence);
      triggerFeedback = usedTrigger
        ? 'Gatilho cumprido: oração condicional aplicada.'
        : 'Desafio: formule uma condição usando "if" ou "unless".';
    } else if (triggerLower.includes('connector') || triggerLower.includes('although')) {
      usedTrigger = /\b(although|though|however|while|but)\b/i.test(lowerSentence);
      triggerFeedback = usedTrigger
        ? 'Gatilho cumprido: conectivo de transição utilizado.'
        : 'Desafio: conecte as ideias usando um conectivo como "although" ou "while".';
    } else {
      usedTrigger = true;
    }
  }

  const hasAnyError =
    wordFeedbacks.some((wf) => wf.hasError) ||
    hasGrammarError ||
    (!usedTargetWord && hasWordConstraint) ||
    usedTrigger === false;

  const explanationPt = hasGrammarError
    ? errorsPt.join(' ')
    : !usedTargetWord && hasWordConstraint
    ? `A frase está bem escrita, mas certifique-se de incluir palavras da sua rotina de hoje (${allWords.slice(0, 5).join(', ')}).`
    : 'Sua frase está gramaticalmente correta, fluente e natural em inglês.';

  const explanationEn = hasGrammarError
    ? errorsEn.join(' ')
    : !usedTargetWord && hasWordConstraint
    ? `Good sentence, but remember to include today's vocabulary words (${allWords.slice(0, 5).join(', ')}).`
    : 'Your sentence is grammatically sound, natural, and fluent.';

  const sentenceFeedback: SentenceFeedback | undefined =
    sClean.length >= 2
      ? {
          original: sClean,
          hasError: hasAnyError,
          corrected: fixedSentence,
          explanationPt,
          explanationEn,
        }
      : undefined;

  const lvlStr = String(level).toLowerCase();
  const isAdv = lvlStr.includes('avanc') || lvlStr.includes('advan');
  const isBeg = lvlStr.includes('inic') || lvlStr.includes('begin');

  const targetWordFeedback = hasWordConstraint
    ? usedTargetWord
      ? missingWords.length > 0
        ? `Palavras utilizadas (${usedWords.length}/${allWords.length}): ${usedWords.join(', ')}. Não incluída(s): ${missingWords.join(', ')}.`
        : `Palavras da rotina utilizadas (${usedWords.length}/${allWords.length}): ${usedWords.join(', ')}.`
      : `Inclua pelo menos uma palavra da sua rotina na frase (${allWords.slice(0, 5).join(', ')}).`
    : '';

  return {
    hasAnyError,
    isCorrect: !hasAnyError,
    usedTargetWord,
    usedWords,
    missingWords,
    targetWordFeedback,
    triggerFeedback,
    wordFeedbacks,
    sentenceFeedback,
    correctedSentence: fixedSentence,
    explanation: explanationPt,
    overallSummaryPt: !hasAnyError
      ? `Excelente! Você utilizou o vocabulário da sua rotina (${usedWords.join(', ') || 'palavras de hoje'}) com precisão e cumpriu o desafio.`
      : !usedTargetWord
      ? `Inclua palavras da sua rotina (${allWords.slice(0, 5).join(', ')}) na sua frase para validar a atividade.`
      : usedTrigger === false
      ? triggerFeedback || 'Revise o gatilho solicitado para a frase.'
      : explanationPt,
    overallSummaryEn: !hasAnyError
      ? `Outstanding! You naturally applied your routine vocabulary (${usedWords.join(', ') || 'today’s words'}) and fulfilled the pedagogical challenge.`
      : !usedTargetWord
      ? `Please include words from your daily routine (${allWords.slice(0, 5).join(', ')}) in your sentence.`
      : usedTrigger === false
      ? 'Review the requested challenge trigger in your sentence.'
      : explanationEn,
    levelTipsPt: isBeg
      ? 'Dica Iniciante: Lembre-se de manter Sujeito + Verbo + Complemento.'
      : isAdv
      ? 'Dica Avançada: Aplique expressões idiomáticas e estruturas conectivas sofisticadas.'
      : 'Dica Intermediária: Pratique usar conectivos como "because", "while" ou "although" para unir duas ações.',
    levelTipsEn: isBeg
      ? 'Beginner Tip: Keep practicing clear Subject + Verb + Object structures.'
      : isAdv
      ? 'Advanced Tip: Incorporate sophisticated transitions and nuanced collocations.'
      : 'Intermediate Tip: Try linking ideas with connectors like "because" or "while".',
  };
}
