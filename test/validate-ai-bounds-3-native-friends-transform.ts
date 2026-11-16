/**
 * AI.BOUNDS.3 — Native Friends Transform Validation Suite
 *
 * Covers:
 * 1. Shared HTML-to-compact-pedagogical-text converter (✗, ✓, [New Word], [Pronounce],
 *    phrase associations, ordering, line breaks, legacy HTML, verbatim plain-text stamps).
 * 2. Real 14,115-char HTML case on BOTH routes:
 *    - /api/session-notes/:id/transform
 *    - /api/pedagogical-notes/transform
 *    Succeeds (HTTP 200), sends ONLY compact text to Gemini, preserves full original HTML,
 *    contentHash, versionHistory, and approval flow.
 * 3. Exact boundary checks: 10,000 (HTTP 200) vs 10,001 (HTTP 400) compact chars on BOTH routes,
 *    even when wrapped in longer HTML.
 * 4. Validation order: size (400) and pedagogical content (400) execute BEFORE consuming rate limit
 *    or acquiring single-flight lock, WITHOUT bypassing Auth (401) or RBAC (403).
 * 5. Concurrency (single-flight lock 429, lock release on failure, rate limit 429, fail-closed 503).
 * 6. STALE_DRAFT (409) protection when original HTML changes after transform.
 * 7. Alternative route client (fetchPedagogicalTransformation) does NOT mask 400/429 with silent local fallback.
 * 8. Frontend counter & warning alignment in TeacherLiveLessonNotesPanel.tsx + Alt+W/Dictionary preservation.
 *
 * Zero real Gemini calls, zero migrations, zero deploy.
 */

process.env.NODE_ENV = 'test';
process.env.FIREBASE_PROJECT_ID = 'itissimple-security-staging';
process.env.FIREBASE_DATABASE_ID = '(default)';
process.env.GEMINI_API_KEY = 'test-fake-gemini-key-no-real-calls';

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import {
  convertNotesHtmlToCompactText,
  MAX_PEDAGOGICAL_COMPACT_NOTES_CHARS,
  parseNotesHtml,
} from '../src/utils/notesHtmlParser';
import { fetchPedagogicalTransformation } from '../src/utils/pedagogicalTransformer';
import { computeNotesContentHash } from '../src/utils/notesVersioning';

let passed = 0;
let failed = 0;

function check(condition: boolean, label: string, detail?: string) {
  if (condition) {
    console.log(`  ✅ PASS: ${label}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${label}${detail ? ` (${detail})` : ''}`);
    failed++;
  }
}

const CORRECT_TAG_HTML = `<span class="inline-coaching-tag correct-tag inline-flex items-center justify-center font-bold text-xs px-1.5 py-0.5 rounded-md bg-[#ecfdf5] border border-[#15803d] text-[#15803d] mx-1 align-baseline shadow-2xs select-none" data-tag-type="correct" contenteditable="false" style="display: inline-flex; align-items: center; justify-content: center; background-color: #ecfdf5; border: 1px solid #15803d; color: #15803d; border-radius: 6px; padding: 1px 6px; font-weight: 700; font-size: 12px; line-height: 1.3; vertical-align: baseline; margin: 0 4px; user-select: none;" title="Correct (✓)" role="img" aria-label="Correct">✓</span>`;
const INCORRECT_TAG_HTML = `<span class="inline-coaching-tag incorrect-tag inline-flex items-center justify-center font-bold text-xs px-1.5 py-0.5 rounded-md bg-[#fff1f2] border border-[#b91c1c] text-[#b91c1c] mx-1 align-baseline shadow-2xs select-none" data-tag-type="incorrect" contenteditable="false" style="display: inline-flex; align-items: center; justify-content: center; background-color: #fff1f2; border: 1px solid #b91c1c; color: #b91c1c; border-radius: 6px; padding: 1px 6px; font-weight: 700; font-size: 12px; line-height: 1.3; vertical-align: baseline; margin: 0 4px; user-select: none;" title="Incorrect (✗)" role="img" aria-label="Incorrect">✗</span>`;
const NEW_WORD_TAG_HTML = `<span class="inline-coaching-tag new-word-tag inline-flex items-center justify-center font-bold text-xs px-1.5 py-0.5 rounded-md bg-[#eff6ff] border border-[#1d4ed8] text-[#1d4ed8] mx-1 align-baseline shadow-2xs select-none" data-tag-type="new-word" contenteditable="false" style="display: inline-flex; align-items: center; justify-content: center; background-color: #eff6ff; border: 1px solid #1d4ed8; color: #1d4ed8; border-radius: 6px; padding: 1px 6px; font-weight: 700; font-size: 12px; line-height: 1.3; vertical-align: baseline; margin: 0 4px; user-select: none;" title="New Word" role="img" aria-label="New Word">✦ New Word</span>`;
const PRONOUNCE_TAG_HTML = `<span class="inline-coaching-tag pronounce-tag inline-flex items-center justify-center font-bold text-xs px-1.5 py-0.5 rounded-md bg-[#faf5ff] border border-[#7e22ce] text-[#7e22ce] mx-1 align-baseline shadow-2xs select-none" data-tag-type="pronounce" contenteditable="false" style="display: inline-flex; align-items: center; justify-content: center; background-color: #faf5ff; border: 1px solid #7e22ce; color: #7e22ce; border-radius: 6px; padding: 1px 6px; font-weight: 700; font-size: 12px; line-height: 1.3; vertical-align: baseline; margin: 0 4px; user-select: none;" title="Pronounce" role="img" aria-label="Pronounce">🎯 Pronounce</span>`;

function buildReal14115HtmlNotes(): string {
  const blocks: string[] = [
    `<div>${INCORRECT_TAG_HTML}&nbsp;We can't to have a meeting today ${CORRECT_TAG_HTML}&nbsp;We can't have a meeting today</div>`,
    `<div>${INCORRECT_TAG_HTML}&nbsp;I am agree with your idea ${CORRECT_TAG_HTML}&nbsp;I agree with your idea</div>`,
    `<div>${NEW_WORD_TAG_HTML}&nbsp;streamline</div>`,
    `<div>${PRONOUNCE_TAG_HTML}&nbsp;schedule</div>`,
    `<div>${INCORRECT_TAG_HTML}&nbsp;She suggested me to wait ${CORRECT_TAG_HTML}&nbsp;She suggested that I wait</div>`,
    `<div>${INCORRECT_TAG_HTML}&nbsp;We discussed about the launch ${CORRECT_TAG_HTML}&nbsp;We discussed the launch</div>`,
    `<div>${NEW_WORD_TAG_HTML}&nbsp;bottleneck</div>`,
    `<div>${PRONOUNCE_TAG_HTML}&nbsp;hierarchy</div>`,
    `<div>${INCORRECT_TAG_HTML}&nbsp;He explained me the process ${CORRECT_TAG_HTML}&nbsp;He explained the process to me</div>`,
    `<div>${INCORRECT_TAG_HTML}&nbsp;Depends of the budget ${CORRECT_TAG_HTML}&nbsp;Depends on the budget</div>`,
  ];
  let html = blocks.join('');
  const fillerUnit = '<div>Keep practicing natural transitions and phrasal verbs during daily stand-ups.</div>';
  while (html.length + fillerUnit.length <= 14115) {
    html += fillerUnit;
  }
  const remaining = 14115 - html.length;
  if (remaining > 11) {
    const innerPad = 'a'.repeat(remaining - 11);
    html += `<div>${innerPad}</div>`;
  } else if (remaining > 0) {
    html += ' '.repeat(remaining);
  }
  return html;
}

function buildCompactNotesOfExactLength(targetLen: number): string {
  const header = "✗ We can't to have ✓ We can't have\n[New Word] streamline\n[Pronounce] schedule\n";
  if (targetLen <= header.length) {
    return header.slice(0, targetLen);
  }
  const needed = targetLen - header.length;
  const word = 'practice ';
  let body = '';
  while (body.length + word.length <= needed) {
    body += word;
  }
  const rem = needed - body.length;
  if (rem > 0) {
    body += 'x'.repeat(rem);
  }
  return header + body;
}

function buildValidGeminiResponseFor14k() {
  return {
    mistakesAnalysis: [
      {
        id: 'm1',
        original: "We can't to have a meeting today",
        corrected: "We can't have a meeting today",
        category: 'grammar',
        explanation: "Modal verbs such as 'can' and 'can't' take the bare infinitive without 'to'.",
        grammarRule: "Subject + can't + base verb",
        twoExamples: ["We can't have delays.", "You can't go there today."],
        commonPitfalls: "Inserting 'to' after modal auxiliaries.",
      },
      {
        id: 'm2',
        original: 'I am agree with your idea',
        corrected: 'I agree with your idea',
        category: 'grammar',
        explanation: "'Agree' is a main verb, not an adjective, so do not use 'be' before it.",
        grammarRule: 'Subject + agree + with + noun',
        twoExamples: ['I agree with you completely.', 'They agree on the timeline.'],
        commonPitfalls: "Using 'am agree' instead of 'agree'.",
      },
      {
        id: 'm3',
        original: 'She suggested me to wait',
        corrected: 'She suggested that I wait',
        category: 'sentence-structure',
        explanation: "'Suggest' does not take an indirect object + infinitive; use a that-clause or -ing.",
        grammarRule: 'suggest + that + subject + base verb',
        twoExamples: ['She suggested waiting.', 'He suggested that we leave early.'],
        commonPitfalls: "Saying 'suggest someone to do'.",
      },
      {
        id: 'm4',
        original: 'We discussed about the launch',
        corrected: 'We discussed the launch',
        category: 'preposition',
        explanation: "'Discuss' is transitive and takes a direct object without 'about'.",
        grammarRule: 'discuss + noun (no about)',
        twoExamples: ['We discussed the roadmap.', 'Let us discuss the budget.'],
        commonPitfalls: "Adding 'about' after 'discuss'.",
      },
      {
        id: 'm5',
        original: 'He explained me the process',
        corrected: 'He explained the process to me',
        category: 'preposition',
        explanation: "'Explain' requires 'to + person' after the direct object.",
        grammarRule: 'explain + something + to + someone',
        twoExamples: ['She explained the rules to us.', 'Can you explain this to him?'],
        commonPitfalls: "Using 'explain me something'.",
      },
      {
        id: 'm6',
        original: 'Depends of the budget',
        corrected: 'Depends on the budget',
        category: 'preposition',
        explanation: "'Depend' always collocates with the preposition 'on', never 'of'.",
        grammarRule: 'depend on + noun',
        twoExamples: ['It depends on the schedule.', 'Success depends on preparation.'],
        commonPitfalls: "Translating 'depender de' as 'depend of'.",
      },
      {
        id: 'm7',
        original: 'We are looking forward to meet you',
        corrected: 'We are looking forward to meeting you',
        category: 'grammar',
        explanation: "Here 'to' is a preposition, so it is followed by a gerund (-ing).",
        grammarRule: 'look forward to + verb-ing',
        twoExamples: ['I look forward to seeing you.', 'She is looking forward to starting.'],
        commonPitfalls: "Using bare infinitive after 'look forward to'.",
      },
      {
        id: 'm8',
        original: 'I have 25 years old',
        corrected: 'I am 25 years old',
        category: 'grammar',
        explanation: "In English, age is expressed with the verb 'to be', not 'to have'.",
        grammarRule: 'Subject + be + number + years old',
        twoExamples: ['My brother is 30 years old.', 'She is 22.'],
        commonPitfalls: "Saying 'I have X years old'.",
      },
      {
        id: 'm9',
        original: 'There are much people here',
        corrected: 'There are many people here',
        category: 'grammar',
        explanation: "'People' is a plural countable noun, so use 'many' rather than 'much'.",
        grammarRule: 'many + plural countable noun',
        twoExamples: ['Many people attended.', 'How many people joined?'],
        commonPitfalls: "Using 'much' with plural nouns.",
      },
      {
        id: 'm10',
        original: "She don't like coffee",
        corrected: "She doesn't like coffee",
        category: 'grammar',
        explanation: "Third-person singular subjects take 'doesn't' in the present simple negative.",
        grammarRule: "he/she/it + doesn't + base verb",
        twoExamples: ["He doesn't work here.", "It doesn't matter."],
        commonPitfalls: "Using 'don't' with he/she/it.",
      },
    ],
    grammarPoints: [
      {
        id: 'g1',
        topic: 'Preposition Collocations & Modal Bare Infinitives',
        rule: "Use bare infinitives after modals and pair verbs like 'depend' with 'on' and 'explain' with 'to'.",
        form: "can't + V1 | depend on | explain X to Y",
        usage: 'Essential for accurate workplace and everyday communication.',
        examples: ["We can't have delays.", 'It depends on the budget.'],
        commonMistakes: "Adding 'to' after modals or 'about' after 'discuss'.",
        comparisons: "'Talk about X' uses 'about', whereas 'discuss X' does not.",
      },
    ],
    vocabularyAndExpressions: [
      {
        id: 'v1',
        term: 'streamline',
        partOfSpeech: 'Verb',
        definitionEn: 'To make a process or system simpler, faster, and more efficient.',
        simpleDefinition: 'To simplify and improve how a process works.',
        collocations: ['streamline a workflow', 'streamline operations'],
        realExamples: ['We automated reports to streamline our weekly review.'],
        synonyms: ['simplify', 'optimize'],
        register: 'neutral',
        category: 'Workplace Verbs',
        isNewWord: true,
      },
      {
        id: 'v2',
        term: 'schedule',
        partOfSpeech: 'Noun / Pronunciation Focus',
        definitionEn: 'A plan listing events, tasks, and the times they are expected to happen.',
        simpleDefinition: 'A timetable or plan of activities.',
        collocations: ['ahead of schedule', 'tight schedule'],
        realExamples: ['We are right on schedule for the Friday release.'],
        synonyms: ['timetable', 'agenda'],
        register: 'neutral',
        category: 'Pronunciation Focus',
        phoneticGuide: '/ˈskedʒ.uːl/ (SKED-jool)',
        isPronunciationFocus: true,
      },
      {
        id: 'v3',
        term: 'bottleneck',
        partOfSpeech: 'Noun',
        definitionEn: 'A stage in a process that slows down the whole workflow.',
        simpleDefinition: 'A point where progress gets blocked or delayed.',
        collocations: ['remove a bottleneck', 'approval bottleneck'],
        realExamples: ['Manual QA became a bottleneck before launch.'],
        synonyms: ['chokepoint', 'slowdown'],
        register: 'conversational',
        category: 'Workplace Vocabulary',
        isNewWord: true,
      },
      {
        id: 'v4',
        term: 'hierarchy',
        partOfSpeech: 'Noun / Pronunciation Focus',
        definitionEn: 'A system in which people or roles are ranked according to authority or status.',
        simpleDefinition: 'An organizational structure with levels of authority.',
        collocations: ['flat hierarchy', 'corporate hierarchy'],
        realExamples: ['Our startup prefers a flat hierarchy.'],
        synonyms: ['ranking', 'chain of command'],
        register: 'formal',
        category: 'Pronunciation Focus',
        phoneticGuide: '/ˈhaɪ.ə.rɑːr.ki/ (HY-uh-rar-kee)',
        isPronunciationFocus: true,
      },
      {
        id: 'v5',
        term: 'leverage',
        partOfSpeech: 'Verb',
        definitionEn: 'To use existing resources or advantages to achieve maximum benefit.',
        simpleDefinition: 'To use something effectively to gain an advantage.',
        collocations: ['leverage data', 'leverage partnerships'],
        realExamples: ['We can leverage existing templates to save hours.'],
        synonyms: ['utilize', 'capitalize on'],
        register: 'formal',
        category: 'Workplace Verbs',
        isNewWord: true,
      },
      {
        id: 'v6',
        term: 'throughout',
        partOfSpeech: 'Preposition / Pronunciation Focus',
        definitionEn: 'From the beginning to the end of a period, event, or place.',
        simpleDefinition: 'During the whole time or in every part of something.',
        collocations: ['throughout the week', 'throughout the project'],
        realExamples: ['She stayed focused throughout the entire presentation.'],
        synonyms: ['all through', 'across'],
        register: 'neutral',
        category: 'Pronunciation Focus',
        phoneticGuide: '/θruːˈaʊt/ (throo-OWT)',
        isPronunciationFocus: true,
      },
      {
        id: 'v7',
        term: 'break the ice',
        partOfSpeech: 'Idiom',
        definitionEn: 'To say or do something friendly to relieve tension when meeting people.',
        simpleDefinition: 'To make people feel relaxed at the start of a conversation.',
        collocations: ['help break the ice', 'icebreaker'],
        realExamples: ['A quick warm-up question helped break the ice in the call.'],
        synonyms: ['warm up the room'],
        register: 'conversational',
        category: 'Everyday Expressions',
        isNewWord: true,
      },
      {
        id: 'v8',
        term: 'comfortable',
        partOfSpeech: 'Adjective / Pronunciation Focus',
        definitionEn: 'Feeling physically relaxed or confident and at ease.',
        simpleDefinition: 'Relaxed and free from stress or discomfort.',
        collocations: ['feel comfortable', 'comfortable pace'],
        realExamples: ['Speak at a comfortable pace during the interview.'],
        synonyms: ['at ease', 'relaxed'],
        register: 'neutral',
        category: 'Pronunciation Focus',
        phoneticGuide: '/ˈkʌmf.tə.bəl/ (KUMF-ter-bul — 3 syllables)',
        isPronunciationFocus: true,
      },
      {
        id: 'v9',
        term: 'touch base',
        partOfSpeech: 'Idiom',
        definitionEn: 'To briefly make contact with someone to share updates or confirm plans.',
        simpleDefinition: 'To check in quickly with someone.',
        collocations: ['touch base tomorrow', 'touch base on the status'],
        realExamples: ['Let us touch base on Friday morning.'],
        synonyms: ['check in', 'reconnect'],
        register: 'conversational',
        category: 'Workplace Vocabulary',
        isNewWord: true,
      },
      {
        id: 'v10',
        term: 'colleague',
        partOfSpeech: 'Noun / Pronunciation Focus',
        definitionEn: 'A person with whom one works in a profession or business.',
        simpleDefinition: 'A coworker or teammate.',
        collocations: ['close colleague', 'senior colleague'],
        realExamples: ['I discussed the proposal with my colleague.'],
        synonyms: ['coworker', 'teammate'],
        register: 'neutral',
        category: 'Pronunciation Focus',
        phoneticGuide: '/ˈkɑː.liːɡ/ (KAH-leeg)',
        isPronunciationFocus: true,
      },
    ],
    reviewSummary: {
      estimatedMinutes: '5–10 minutes',
      keyRules: ["Never add 'to' after modal verbs; pair 'depend' with 'on' and 'explain' with 'to'."],
      mustKnowVocabulary: ['streamline', 'bottleneck', 'break the ice', 'touch base', 'schedule'],
      essentialCorrections: [
        { original: "We can't to have a meeting today", corrected: "We can't have a meeting today" },
        { original: 'Depends of the budget', corrected: 'Depends on the budget' },
      ],
      usefulPatterns: ["look forward to + -ing", "explain + X + to + someone"],
      rememberThis: "Remember this: Say 'We can't have', 'Depends on', and 'Look forward to meeting you'!",
    },
  };
}

function createSimulator(app: any) {
  return function simulateRequest(
    method: string,
    urlPath: string,
    headers: Record<string, string> = {},
    body: any = null
  ): Promise<{ status: number; headers: Record<string, string>; body: any }> {
    return new Promise((resolve) => {
      const reqHeaders: Record<string, string> = {};
      Object.entries(headers).forEach(([k, v]) => {
        reqHeaders[k.toLowerCase()] = v;
      });

      const parsedUrl = new URL(urlPath, 'http://localhost');
      const query: Record<string, string> = {};
      parsedUrl.searchParams.forEach((val, key) => {
        query[key] = val;
      });

      const req: any = {
        method: method.toUpperCase(),
        url: urlPath,
        originalUrl: urlPath,
        path: parsedUrl.pathname,
        query,
        params: {},
        headers: reqHeaders,
        body: body ?? {},
      };

      const resHeaders: Record<string, string> = {};
      let statusCode = 200;
      let resBody: any = null;

      const res: any = {
        setHeader: (name: string, value: string) => {
          resHeaders[name.toLowerCase()] = value;
        },
        getHeader: (name: string) => resHeaders[name.toLowerCase()],
        removeHeader: (name: string) => {
          delete resHeaders[name.toLowerCase()];
        },
        status: (code: number) => {
          statusCode = code;
          return res;
        },
        json: (data: any) => {
          resBody = data;
          resolve({ status: statusCode, headers: resHeaders, body: resBody });
        },
        send: (data: any) => {
          resBody = data;
          resolve({ status: statusCode, headers: resHeaders, body: resBody });
        },
        end: () => {
          resolve({ status: statusCode, headers: resHeaders, body: resBody });
        },
      };

      app(req, res, (err?: any) => {
        if (err) {
          resolve({ status: 500, headers: resHeaders, body: { error: err.message } });
        } else {
          resolve({ status: statusCode === 200 ? 404 : statusCode, headers: resHeaders, body: resBody });
        }
      });
    });
  };
}

function createInMemoryFirestore(store: Record<string, any>) {
  function matchesFilters(data: any, filters: Array<{ field: string; op: string; val: any }>) {
    if (!data) return false;
    return filters.every(({ field, op, val }) => {
      if (op === '==') return data[field] === val;
      return true;
    });
  }

  function makeCollection(colPath: string, filters: Array<{ field: string; op: string; val: any }> = []): any {
    return {
      doc(docId: string) {
        const fullPath = `${colPath}/${docId}`;
        return {
          id: docId,
          path: fullPath,
          async get() {
            const exists = Object.prototype.hasOwnProperty.call(store, fullPath);
            return {
              id: docId,
              exists,
              data: () => (exists ? JSON.parse(JSON.stringify(store[fullPath])) : undefined),
            };
          },
          async set(data: any, opts?: { merge?: boolean }) {
            const incoming = JSON.parse(JSON.stringify(data));
            if (opts?.merge && store[fullPath]) {
              store[fullPath] = { ...store[fullPath], ...incoming };
            } else {
              store[fullPath] = incoming;
            }
          },
          async update(data: any) {
            const incoming = JSON.parse(JSON.stringify(data));
            store[fullPath] = { ...(store[fullPath] || {}), ...incoming };
          },
          async delete() {
            delete store[fullPath];
          },
          collection(subCol: string) {
            return makeCollection(`${fullPath}/${subCol}`);
          },
        };
      },
      where(field: string, op: string, val: any) {
        return makeCollection(colPath, [...filters, { field, op, val }]);
      },
      limit(_n: number) {
        return makeCollection(colPath, filters);
      },
      orderBy(_f: string, _d?: string) {
        return makeCollection(colPath, filters);
      },
      async get() {
        const prefix = `${colPath}/`;
        const docs: any[] = [];
        for (const [k, v] of Object.entries(store)) {
          if (k.startsWith(prefix)) {
            const remainder = k.slice(prefix.length);
            if (!remainder.includes('/') && matchesFilters(v, filters)) {
              docs.push({
                id: remainder,
                exists: true,
                data: () => JSON.parse(JSON.stringify(v)),
              });
            }
          }
        }
        return {
          empty: docs.length === 0,
          size: docs.length,
          docs,
          forEach: (cb: (d: any) => void) => docs.forEach(cb),
        };
      },
    };
  }

  return {
    collection: (name: string) => makeCollection(name),
    runTransaction: async (fn: any) => {
      const tx = {
        get: async (ref: any) => ref.get(),
        set: (ref: any, data: any, opts?: any) => ref.set(data, opts),
        update: (ref: any, data: any) => ref.update(data),
        delete: (ref: any) => ref.delete(),
      };
      return fn(tx);
    },
  };
}

async function runTests() {
  console.log('=======================================================================');
  console.log('  AI.BOUNDS.3 — NATIVE FRIENDS TRANSFORM VALIDATION SUITE              ');
  console.log('=======================================================================\n');

  // =========================================================================
  // 1. SHARED CONVERTER & REAL 14,115-CHAR HTML CASE
  // =========================================================================
  console.log('--- 1. Conversor Compartilhado HTML -> Texto Pedagógico Compacto ---');

  const html14115 = buildReal14115HtmlNotes();
  check(
    html14115.length === 14115,
    `1.1: Fixture real tem exatamente 14.115 caracteres de HTML (len=${html14115.length})`
  );

  const compact14115 = convertNotesHtmlToCompactText(html14115);
  check(
    compact14115.length > 500 && compact14115.length <= MAX_PEDAGOGICAL_COMPACT_NOTES_CHARS,
    `1.2: 14.115 chars de HTML compacta para ${compact14115.length} chars (<= 10.000)`
  );
  check(
    !compact14115.includes('<span') && !compact14115.includes('style=') && !compact14115.includes('inline-coaching-tag'),
    '1.3: Texto compacto não contém spans nem estilos inline'
  );
  check(
    compact14115.includes("✗ We can't to have a meeting today ✓ We can't have a meeting today") &&
      compact14115.includes('[New Word] streamline') &&
      compact14115.includes('[Pronounce] schedule'),
    '1.4: Todas as 4 marcações (✗, ✓, [New Word], [Pronounce]) e associações erro/correção preservadas'
  );

  const compactLines = compact14115.split('\n');
  check(
    compactLines[0].includes("We can't to have") &&
      compactLines[1].includes('I am agree') &&
      compactLines[2].includes('[New Word] streamline') &&
      compactLines[3].includes('[Pronounce] schedule'),
    '1.5: Ordem exata e quebras de linha preservadas entre linhas adjacentes'
  );

  // Legacy HTML variations
  const legacyHtml = [
    '<style>.hidden{color:red}</style>',
    '<!--StartFragment-->',
    '<p><span class="incorrect">He go to work</span> <span class="correct">He goes to work</span></p>',
    '<p><span class="new-word">benchmark</span></p>',
    '<ul><li><span data-tag-type="pronounce">🎯 Pronounce</span>&nbsp;entrepreneur</li><li>Review&nbsp;&amp;&nbsp;practice &quot;a &lt; b&quot;</li></ul>',
    '<span class="wrapper"><span data-tag-type="incorrect">✗</span> She don&#39;t know</span>',
  ].join('');
  const compactLegacy = convertNotesHtmlToCompactText(legacyHtml);
  check(
    compactLegacy.includes('✗ He go to work ✓ He goes to work') &&
      compactLegacy.includes('[New Word] benchmark') &&
      compactLegacy.includes('• [Pronounce] entrepreneur') &&
      compactLegacy.includes('• Review & practice "a < b"') &&
      compactLegacy.includes("✗ She don't know") &&
      !compactLegacy.includes('.hidden') &&
      !compactLegacy.includes('StartFragment'),
    '1.6: HTML legado (wrapper spans, <p>, <ul><li>, entidades, <style>/comentários) convertido com fidelidade',
    compactLegacy
  );

  // Plain-text stamps preserved verbatim (NF-DOC.2F compatibility)
  const plainBilingual = [
    'In-Session Notes — Observação da professora em português.',
    "(Alt+N) We can't to have (Alt+Y) We can't have",
    '(Alt+W) follow up',
    '(Alt+P) schedule',
  ].join('\n');
  check(
    convertNotesHtmlToCompactText(plainBilingual) === plainBilingual,
    '1.7: Notas em texto puro com (Alt+N/Y/W/P) e acentuação preservadas verbatim'
  );

  // =========================================================================
  // SERVER SETUP (SEM GEMINI REAL, SEM FIRESTORE REAL)
  // =========================================================================
  const { setFirebaseAdminAuthForTesting } = await import('../src/serverFirebaseAdmin');
  const { setFirebaseAdminFirestoreForTesting, resetFirebaseAdminFirestoreForTesting, setIsCloudWriteDisabled } =
    await import('../src/serverFirestore');
  const {
    setDistributedCostControlForTesting,
    resetGeminiSecurityStateForTesting,
    GEMINI_POLICIES,
  } = await import('../src/serverGeminiSecurity');
  const {
    app,
    resetResidualCachesForTesting,
    setSessionNoteTransformAttemptExecutorForTesting,
  } = await import('../serverApp');

  check(
    GEMINI_POLICIES.pedagogical_transform.maxInputLengthChars === 10000,
    '1.8: Política GEMINI_POLICIES.pedagogical_transform.maxInputLengthChars permanece intacta em 10.000'
  );

  const simulateRequest = createSimulator(app);

  const teacherUid = 'teacherBounds3Uid0000001';
  const teacherEmail = 'teacher.bounds3@itissimple.test';
  const otherTeacherUid = 'teacherBounds3OtherUid002';
  const otherTeacherEmail = 'other.teacher.bounds3@itissimple.test';
  const studentUid = 'studentBounds3Uid0000001';
  const studentEmail = 'student.bounds3@itissimple.test';
  const otherStudentUid = 'studentBounds3OtherUid002';
  const otherStudentEmail = 'other.student.bounds3@itissimple.test';

  const tokenMap: Record<string, any> = {
    'tok-teacher': { uid: teacherUid, email: teacherEmail, email_verified: true, role: 'teacher' },
    'tok-other-teacher': { uid: otherTeacherUid, email: otherTeacherEmail, email_verified: true, role: 'teacher' },
    'tok-student': { uid: studentUid, email: studentEmail, email_verified: true, role: 'student' },
  };

  setFirebaseAdminAuthForTesting({
    verifyIdToken: async (token: string) => {
      if (tokenMap[token]) return tokenMap[token];
      const err: any = new Error('Invalid token');
      err.code = 'auth/invalid-id-token';
      throw err;
    },
    getUser: async (uid: string) => {
      const found = Object.values(tokenMap).find((u: any) => u.uid === uid);
      if (found) return found;
      throw new Error('User not found');
    },
    getUserByEmail: async (email: string) => {
      const found = Object.values(tokenMap).find((u: any) => u.email === email);
      if (found) return found;
      throw new Error('User not found');
    },
  } as any);

  let firestoreStore: Record<string, any> = {};
  let geminiCallCount = 0;
  let capturedPrompts: string[] = [];
  let geminiDelayMs = 0;
  let geminiShouldFail = false;

  const seedStore = () => {
    firestoreStore = {
      [`users/${teacherUid}`]: {
        uid: teacherUid,
        email: teacherEmail,
        name: 'Teacher Bounds',
        role: 'teacher',
        approvalStatus: 'approved',
        isApproved: true,
      },
      [`tutors/${teacherUid}`]: {
        uid: teacherUid,
        email: teacherEmail,
        name: 'Teacher Bounds',
        approvalStatus: 'approved',
        isApproved: true,
      },
      [`users/${otherTeacherUid}`]: {
        uid: otherTeacherUid,
        email: otherTeacherEmail,
        name: 'Other Teacher',
        role: 'teacher',
        approvalStatus: 'approved',
        isApproved: true,
      },
      [`tutors/${otherTeacherUid}`]: {
        uid: otherTeacherUid,
        email: otherTeacherEmail,
        name: 'Other Teacher',
        approvalStatus: 'approved',
        isApproved: true,
      },
      [`users/${studentUid}`]: {
        uid: studentUid,
        email: studentEmail,
        name: 'Student Bounds',
        role: 'student',
        level: 'intermediario',
        teacherUid,
        assignedNativeFriendUID: teacherUid,
      },
      [`users/${otherStudentUid}`]: {
        uid: otherStudentUid,
        email: otherStudentEmail,
        name: 'Other Student',
        role: 'student',
        level: 'intermediario',
        teacherUid: otherTeacherUid,
        assignedNativeFriendUID: otherTeacherUid,
      },
      'lessons/lesson-bounds3-01': {
        id: 'lesson-bounds3-01',
        studentUid,
        studentEmail,
        teacherUid,
        teacherEmail,
        teacherName: 'Teacher Bounds',
        title: 'Communication & Precision',
        status: 'scheduled',
        startDateTime: '2026-11-16T15:00:00.000Z',
      },
    };
  };

  const resetEnv = (customResponse?: any) => {
    seedStore();
    setIsCloudWriteDisabled(false);
    setDistributedCostControlForTesting(null);
    resetFirebaseAdminFirestoreForTesting();
    setFirebaseAdminFirestoreForTesting(createInMemoryFirestore(firestoreStore) as any);
    resetGeminiSecurityStateForTesting();
    resetResidualCachesForTesting();
    geminiCallCount = 0;
    capturedPrompts = [];
    geminiDelayMs = 0;
    geminiShouldFail = false;

    setSessionNoteTransformAttemptExecutorForTesting(async (_model: string, params: any) => {
      geminiCallCount++;
      capturedPrompts.push(String(params?.untrustedUserDataPrompt || ''));
      if (geminiDelayMs > 0) {
        await new Promise((r) => setTimeout(r, geminiDelayMs));
      }
      if (geminiShouldFail) {
        const err: any = new Error('Simulated Gemini service failure');
        err.status = 503;
        throw err;
      }
      return JSON.stringify(customResponse || buildValidGeminiResponseFor14k());
    });
  };

  // =========================================================================
  // 2. CASO REAL 14.115 CHARS HTML + PRESERVAÇÃO + APROVAÇÃO + STALE_DRAFT
  // =========================================================================
  console.log('\n--- 2. Caso Real 14.115 chars HTML, Preservação, Aprovação & STALE_DRAFT ---');
  resetEnv();

  const session14kId = `session_bounds3_14k_${Date.now()}`;
  const expectedHash14k = computeNotesContentHash(html14115);

  const save14kRes = await simulateRequest(
    'POST',
    '/api/session-notes',
    { Authorization: 'Bearer tok-teacher' },
    {
      id: session14kId,
      studentUid,
      studentEmail,
      teacherUid,
      teacherEmail,
      topic: 'Communication & Precision',
      sessionDate: '2026-11-16',
      content: html14115,
      rawContent: html14115,
    }
  );
  check(save14kRes.status === 200, '2.1: Salvamento de HTML de 14.115 chars retorna HTTP 200');
  const resolved14kKey = save14kRes.body?.sessionNote?.id || save14kRes.body?.id || session14kId;

  const transform14kRes = await simulateRequest(
    'POST',
    `/api/session-notes/${resolved14kKey}/transform`,
    { Authorization: 'Bearer tok-teacher' },
    {}
  );
  check(transform14kRes.status === 200, '2.2: /api/session-notes/:id/transform com 14.115 chars HTML retorna HTTP 200', JSON.stringify(transform14kRes.body));
  check(geminiCallCount === 1, '2.3: Gemini chamado exatamente 1 vez');
  check(
    capturedPrompts[0].includes(compact14115) &&
      !capturedPrompts[0].includes('<span') &&
      !capturedPrompts[0].includes('inline-coaching-tag') &&
      !capturedPrompts[0].includes('inline-flex'),
    '2.4: Gemini recebeu exclusivamente texto pedagógico compacto (zero HTML/CSS inline)'
  );

  const storedDoc = firestoreStore[`session_notes/${resolved14kKey}`];
  check(
    storedDoc?.rawContent === html14115 &&
      storedDoc?.content === html14115 &&
      storedDoc?.originalTeacherNotes?.rawContent === html14115 &&
      storedDoc?.rawContent.length === 14115,
    '2.5: HTML original integral (14.115 chars) preservado no Firestore (rawContent, content, originalTeacherNotes)'
  );
  check(
    storedDoc?.draftTransformation?.contentHash === expectedHash14k &&
      storedDoc?.draftTransformation?.transformation?.contentHash === expectedHash14k,
    '2.6: contentHash preservado com base no HTML original'
  );

  // STALE_DRAFT (409) when HTML changes after draft generation
  const editedHtml14k = html14115.replace('streamline', 'streamlined');
  const editSaveRes = await simulateRequest(
    'POST',
    '/api/session-notes',
    { Authorization: 'Bearer tok-teacher' },
    {
      id: resolved14kKey,
      studentUid,
      studentEmail,
      teacherUid,
      teacherEmail,
      topic: 'Communication & Precision',
      sessionDate: '2026-11-16',
      content: editedHtml14k,
      rawContent: editedHtml14k,
    }
  );
  check(editSaveRes.status === 200, '2.7: Edição posterior no HTML original salva com sucesso');

  const staleApproveRes = await simulateRequest(
    'POST',
    `/api/session-notes/${resolved14kKey}/approve`,
    { Authorization: 'Bearer tok-teacher' },
    {
      draftId: transform14kRes.body.draftTransformation.draftId,
      transformation: transform14kRes.body.draftTransformation,
    }
  );
  check(
    staleApproveRes.status === 409 && staleApproveRes.body?.code === 'STALE_DRAFT',
    '2.8: Aprovação de draft desatualizado retorna HTTP 409 STALE_DRAFT'
  );

  // Re-transform edited HTML + Approve
  const retransformRes = await simulateRequest(
    'POST',
    `/api/session-notes/${resolved14kKey}/transform`,
    { Authorization: 'Bearer tok-teacher' },
    { forceRegenerate: true }
  );
  check(retransformRes.status === 200, '2.9: Re-transformação após edição retorna HTTP 200');

  const approveRes = await simulateRequest(
    'POST',
    `/api/session-notes/${resolved14kKey}/approve`,
    { Authorization: 'Bearer tok-teacher' },
    {
      draftId: retransformRes.body.draftTransformation.draftId,
      transformation: retransformRes.body.draftTransformation,
    }
  );
  check(
    approveRes.status === 200 &&
      approveRes.body?.approvalStatus === 'approved' &&
      approveRes.body?.approvedVersion?.contentHash === computeNotesContentHash(editedHtml14k) &&
      firestoreStore[`session_notes/${resolved14kKey}`]?.versionHistory?.some((h: any) => h.type === 'approved_published'),
    '2.10: Aprovação explícita publica lastApprovedVersion, preserva histórico e contentHash do HTML original'
  );

  // Real 14,115-char HTML via /api/pedagogical-notes/transform (Alt route)
  resetEnv();
  const alt14kRes = await simulateRequest(
    'POST',
    '/api/pedagogical-notes/transform',
    { Authorization: 'Bearer tok-student' },
    {
      rawNotes: html14115,
      topic: 'Communication & Precision',
      sessionDate: '2026-11-16',
      studentUid,
      studentEmail,
      lessonId: 'lesson-bounds3-01',
      forceRegenerate: true,
    }
  );
  check(alt14kRes.status === 200, '2.11: /api/pedagogical-notes/transform com 14.115 chars HTML retorna HTTP 200');
  check(
    capturedPrompts[0].includes(compact14115) && !capturedPrompts[0].includes('inline-coaching-tag'),
    '2.12: Rota alternativa envia exclusivamente texto compacto ao Gemini'
  );
  // Verify Alt+W / Dictionary entries were synced for student
  const dictRes = await simulateRequest(
    'GET',
    `/api/student-dictionary?studentUid=${studentUid}`,
    { Authorization: 'Bearer tok-student' }
  );
  const dictList = Array.isArray(dictRes.body)
    ? dictRes.body
    : (dictRes.body?.dictionary || dictRes.body?.words || dictRes.body?.entries || []);
  check(
    dictRes.status === 200 &&
      dictList.some((w: any) => String(w?.word || '').toLowerCase() === 'streamline'),
    `2.13: Vocabulário Alt+W sincronizado no Dictionary do aluno (${dictList.length} entradas, inclui "streamline")`
  );

  // =========================================================================
  // 3. LIMITES EXATOS (10.000 vs 10.001) E ORDEM DE VALIDAÇÃO ANTES DE RATE LIMIT/LOCK
  // =========================================================================
  console.log('\n--- 3. Limites Exatos (10.000 / 10.001) e Ordem de Validação ---');
  resetEnv();

  const compact10000 = buildCompactNotesOfExactLength(10000);
  const compact10001 = buildCompactNotesOfExactLength(10001);
  // Wrap 10,000-char compact text inside rich HTML (>12,000 chars raw HTML)
  const htmlWithExact10000Compact = `<div>${INCORRECT_TAG_HTML}&nbsp;We can't to have ${CORRECT_TAG_HTML}&nbsp;We can't have</div><div>${NEW_WORD_TAG_HTML}&nbsp;streamline</div><div>${PRONOUNCE_TAG_HTML}&nbsp;schedule</div><div>${compact10000.split('\n').slice(3).join(' ')}</div>`;
  check(
    convertNotesHtmlToCompactText(htmlWithExact10000Compact).length === 10000 &&
      htmlWithExact10000Compact.length > 11000,
    `3.1: HTML de ${htmlWithExact10000Compact.length} chars compacta exatamente para 10.000 chars`
  );

  const htmlWith10001Compact = `<div>${INCORRECT_TAG_HTML}&nbsp;We can't to have ${CORRECT_TAG_HTML}&nbsp;We can't have</div><div>${NEW_WORD_TAG_HTML}&nbsp;streamline</div><div>${PRONOUNCE_TAG_HTML}&nbsp;schedule</div><div>${compact10001.split('\n').slice(3).join(' ')}</div>`;
  check(
    convertNotesHtmlToCompactText(htmlWith10001Compact).length === 10001,
    '3.2: HTML over-limit compacta exatamente para 10.001 chars'
  );

  const sessionOverId = `session_bounds3_over_${Date.now()}`;
  const sessionExactId = `session_bounds3_exact_${Date.now()}`;

  const saveOverRes = await simulateRequest(
    'POST',
    '/api/session-notes',
    { Authorization: 'Bearer tok-teacher' },
    {
      id: sessionOverId,
      studentUid,
      studentEmail,
      teacherUid,
      teacherEmail,
      sessionDate: '2026-11-17',
      content: htmlWith10001Compact,
      rawContent: htmlWith10001Compact,
    }
  );
  const resolvedOverKey = saveOverRes.body?.sessionNote?.id || saveOverRes.body?.id || sessionOverId;

  const saveExactRes = await simulateRequest(
    'POST',
    '/api/session-notes',
    { Authorization: 'Bearer tok-teacher' },
    {
      id: sessionExactId,
      studentUid,
      studentEmail,
      teacherUid,
      teacherEmail,
      sessionDate: '2026-11-18',
      content: htmlWithExact10000Compact,
      rawContent: htmlWithExact10000Compact,
    }
  );
  const resolvedExactKey = saveExactRes.body?.sessionNote?.id || saveExactRes.body?.id || sessionExactId;

  // Send 6 invalid requests (3x 10,001 chars + 3x empty/markup-only) BEFORE valid requests
  // If rate limit (max 5 in 300s) were consumed by 400s, subsequent valid requests would fail with 429!
  for (let i = 0; i < 3; i++) {
    const overSessionRes = await simulateRequest(
      'POST',
      `/api/session-notes/${resolvedOverKey}/transform`,
      { Authorization: 'Bearer tok-teacher' },
      {}
    );
    check(
      overSessionRes.status === 400 && overSessionRes.body?.code === 'PAYLOAD_BOUNDS_EXCEEDED',
      `3.3.${i + 1}: /api/session-notes/:id/transform rejeita 10.001 chars com HTTP 400`
    );
  }

  const emptySessionId = `session_bounds3_empty_${Date.now()}`;
  const saveEmptyRes = await simulateRequest(
    'POST',
    '/api/session-notes',
    { Authorization: 'Bearer tok-teacher' },
    {
      id: emptySessionId,
      studentUid,
      studentEmail,
      teacherUid,
      teacherEmail,
      sessionDate: '2026-11-19',
      content: '<div><br></div><span></span>',
      rawContent: '<div><br></div><span></span>',
    }
  );
  const resolvedEmptyKey = saveEmptyRes.body?.sessionNote?.id || saveEmptyRes.body?.id || emptySessionId;
  for (let i = 0; i < 3; i++) {
    const emptyRes = await simulateRequest(
      'POST',
      `/api/session-notes/${resolvedEmptyKey}/transform`,
      { Authorization: 'Bearer tok-teacher' },
      {}
    );
    check(
      emptyRes.status === 400 && emptyRes.body?.code === 'NO_PEDAGOGICAL_CONTENT',
      `3.4.${i + 1}: /api/session-notes/:id/transform rejeita HTML vazio/markup-only com HTTP 400`
    );
  }
  check(geminiCallCount === 0, '3.5: Zero chamadas ao Gemini para payloads inválidos (10.001 ou vazios)');

  // Now teacher should STILL have full 5-request quota on /api/session-notes/:id/transform!
  const exactSessionRes = await simulateRequest(
    'POST',
    `/api/session-notes/${resolvedExactKey}/transform`,
    { Authorization: 'Bearer tok-teacher' },
    { forceRegenerate: true }
  );
  check(
    exactSessionRes.status === 200,
    '3.6: 10.000 chars exatos (em HTML > 11k) retorna HTTP 200 e cota não foi consumida pelos 400s anteriores'
  );

  // Same validation-before-rate-limit test on /api/pedagogical-notes/transform
  resetEnv();
  for (let i = 0; i < 3; i++) {
    const altOver = await simulateRequest(
      'POST',
      '/api/pedagogical-notes/transform',
      { Authorization: 'Bearer tok-student' },
      { rawNotes: htmlWith10001Compact, studentUid, studentEmail, lessonId: 'lesson-bounds3-01' }
    );
    check(
      altOver.status === 400 && altOver.body?.code === 'PAYLOAD_BOUNDS_EXCEEDED',
      `3.7.${i + 1}: /api/pedagogical-notes/transform rejeita 10.001 chars com HTTP 400`
    );

    const altEmpty = await simulateRequest(
      'POST',
      '/api/pedagogical-notes/transform',
      { Authorization: 'Bearer tok-student' },
      { rawNotes: `${INCORRECT_TAG_HTML} <div><br></div>`, studentUid, studentEmail, lessonId: 'lesson-bounds3-01' }
    );
    check(
      altEmpty.status === 400 && altEmpty.body?.code === 'NO_PEDAGOGICAL_CONTENT',
      `3.8.${i + 1}: /api/pedagogical-notes/transform rejeita badge-only/vazio com HTTP 400`
    );
  }
  check(geminiCallCount === 0, '3.9: Zero chamadas ao Gemini na rota alternativa para payloads inválidos');

  // Student should STILL have full 5-request rate limit quota!
  for (let i = 0; i < 5; i++) {
    const okRes = await simulateRequest(
      'POST',
      '/api/pedagogical-notes/transform',
      { Authorization: 'Bearer tok-student' },
      {
        rawNotes: htmlWithExact10000Compact,
        studentUid,
        studentEmail,
        lessonId: 'lesson-bounds3-01',
        forceRegenerate: true,
      }
    );
    check(okRes.status === 200, `3.10.${i + 1}: Cota intacta após 6 rejeições 400 -> requisição válida #${i + 1} (10.000 chars) retorna HTTP 200`);
  }
  const rateLimited6th = await simulateRequest(
    'POST',
    '/api/pedagogical-notes/transform',
    { Authorization: 'Bearer tok-student' },
    {
      rawNotes: htmlWithExact10000Compact,
      studentUid,
      studentEmail,
      lessonId: 'lesson-bounds3-01',
      forceRegenerate: true,
    }
  );
  check(rateLimited6th.status === 429, '3.11: 6ª requisição válida dentro da janela retorna HTTP 429 (rate limit preservado)');

  // =========================================================================
  // 4. AUTH / RBAC NÃO CONTORNADOS
  // =========================================================================
  console.log('\n--- 4. Auth e RBAC Nunca Contornados por Validação de Tamanho/Conteúdo ---');
  resetEnv();

  const noAuthAlt = await simulateRequest(
    'POST',
    '/api/pedagogical-notes/transform',
    {},
    { rawNotes: compact10001 }
  );
  check(noAuthAlt.status === 401, '4.1: /api/pedagogical-notes/transform sem token com 10.001 chars retorna 401 (Auth não contornada)');

  const crossStudentOver = await simulateRequest(
    'POST',
    '/api/pedagogical-notes/transform',
    { Authorization: 'Bearer tok-student' },
    { rawNotes: compact10001, studentUid: otherStudentUid, studentEmail }
  );
  check(
    crossStudentOver.status === 403,
    '4.2: Acesso cruzado de aluno com 10.001 chars retorna 403 (RBAC não contornado por 400)'
  );

  const crossStudentEmpty = await simulateRequest(
    'POST',
    '/api/pedagogical-notes/transform',
    { Authorization: 'Bearer tok-student' },
    { rawNotes: '', studentUid: otherStudentUid, studentEmail }
  );
  check(
    crossStudentEmpty.status === 403,
    '4.3: Acesso cruzado de aluno com notas vazias retorna 403 (RBAC não contornado por 400)'
  );

  // Session-notes route RBAC with over-limit document
  const rbacSessionId = `session_bounds3_rbac_${Date.now()}`;
  firestoreStore[`session_notes/${rbacSessionId}`] = {
    id: rbacSessionId,
    studentUid,
    studentEmail,
    teacherUid,
    teacherEmail,
    sessionDate: '2026-11-16',
    content: htmlWith10001Compact,
    rawContent: htmlWith10001Compact,
  };

  const studentSessionTransform = await simulateRequest(
    'POST',
    `/api/session-notes/${rbacSessionId}/transform`,
    { Authorization: 'Bearer tok-student' },
    {}
  );
  check(studentSessionTransform.status === 403, '4.4: Aluno bloqueado com 403 em /api/session-notes/:id/transform');

  const otherTeacherTransform = await simulateRequest(
    'POST',
    `/api/session-notes/${rbacSessionId}/transform`,
    { Authorization: 'Bearer tok-other-teacher' },
    {}
  );
  check(otherTeacherTransform.status === 403, '4.5: Outro professor sem vínculo bloqueado com 403 mesmo com doc >10.000 chars');

  // =========================================================================
  // 5. CONCORRÊNCIA, LIBERAÇÃO DE LOCK & FAIL-CLOSED 503
  // =========================================================================
  console.log('\n--- 5. Concorrência, Liberação de Lock e Fail-Closed ---');
  resetEnv();

  const concSessionId = `session_bounds3_conc_${Date.now()}`;
  const saveConcRes = await simulateRequest(
    'POST',
    '/api/session-notes',
    { Authorization: 'Bearer tok-teacher' },
    {
      id: concSessionId,
      studentUid,
      studentEmail,
      teacherUid,
      teacherEmail,
      sessionDate: '2026-11-20',
      content: html14115,
      rawContent: html14115,
    }
  );
  const resolvedConcKey = saveConcRes.body?.sessionNote?.id || saveConcRes.body?.id || concSessionId;

  geminiDelayMs = 120;
  const [concA, concB] = await Promise.all([
    simulateRequest('POST', `/api/session-notes/${resolvedConcKey}/transform`, { Authorization: 'Bearer tok-teacher' }, {}),
    simulateRequest('POST', `/api/session-notes/${resolvedConcKey}/transform`, { Authorization: 'Bearer tok-teacher' }, {}),
  ]);
  const concStatuses = [concA.status, concB.status].sort();
  check(
    concStatuses[0] === 200 && concStatuses[1] === 429,
    `5.1: Concorrência em /api/session-notes/:id/transform -> [200, 429] (obtido ${JSON.stringify(concStatuses)})`
  );

  // Concurrency on /api/pedagogical-notes/transform + lock release on failure
  resetEnv();
  geminiDelayMs = 120;
  const [altConcA, altConcB] = await Promise.all([
    simulateRequest(
      'POST',
      '/api/pedagogical-notes/transform',
      { Authorization: 'Bearer tok-student' },
      { rawNotes: html14115, studentUid, studentEmail, lessonId: 'lesson-bounds3-01', forceRegenerate: true }
    ),
    simulateRequest(
      'POST',
      '/api/pedagogical-notes/transform',
      { Authorization: 'Bearer tok-student' },
      { rawNotes: html14115, studentUid, studentEmail, lessonId: 'lesson-bounds3-01', forceRegenerate: true }
    ),
  ]);
  const altConcStatuses = [altConcA.status, altConcB.status].sort();
  check(
    altConcStatuses[0] === 200 && altConcStatuses[1] === 429,
    `5.2: Concorrência em /api/pedagogical-notes/transform -> [200, 429] (obtido ${JSON.stringify(altConcStatuses)})`
  );

  // Lock released on Gemini failure
  geminiDelayMs = 0;
  geminiShouldFail = true;
  const failRes = await simulateRequest(
    'POST',
    '/api/pedagogical-notes/transform',
    { Authorization: 'Bearer tok-student' },
    { rawNotes: html14115, studentUid, studentEmail, lessonId: 'lesson-bounds3-01', forceRegenerate: true }
  );
  check(failRes.status === 503, '5.3: Falha simulada no Gemini retorna 503');

  geminiShouldFail = false;
  const retryAfterFail = await simulateRequest(
    'POST',
    '/api/pedagogical-notes/transform',
    { Authorization: 'Bearer tok-student' },
    { rawNotes: html14115, studentUid, studentEmail, lessonId: 'lesson-bounds3-01', forceRegenerate: true }
  );
  check(retryAfterFail.status === 200, '5.4: Lock foi liberado após falha, permitindo retry com HTTP 200');

  // Fail-closed 503 when distributed cost control is unavailable
  const saveFcRes = await simulateRequest(
    'POST',
    '/api/session-notes',
    { Authorization: 'Bearer tok-teacher' },
    {
      id: `session_bounds3_fc_${Date.now()}`,
      studentUid,
      studentEmail,
      teacherUid,
      teacherEmail,
      sessionDate: '2026-11-21',
      content: html14115,
      rawContent: html14115,
    }
  );
  const resolvedFcKey = saveFcRes.body?.sessionNote?.id || saveFcRes.body?.id;
  setDistributedCostControlForTesting(true);
  const baseMockFs = createInMemoryFirestore(firestoreStore);
  setFirebaseAdminFirestoreForTesting({
    ...baseMockFs,
    runTransaction: async () => {
      throw new Error('Firestore Unavailable: DEADLINE_EXCEEDED');
    },
  } as any);
  const failClosedSession = await simulateRequest(
    'POST',
    `/api/session-notes/${resolvedFcKey}/transform`,
    { Authorization: 'Bearer tok-teacher' },
    { forceRegenerate: true }
  );
  check(
    failClosedSession.status === 503,
    `5.5: Fail-closed HTTP 503 em /api/session-notes/:id/transform quando Firestore distribuído indisponível (status=${failClosedSession.status})`
  );
  setDistributedCostControlForTesting(null);
  setFirebaseAdminFirestoreForTesting(baseMockFs as any);

  // =========================================================================
  // 6. ROTA ALTERNATIVA CLIENTE: NÃO MASCARAR 400/429 COM FALLBACK SILENCIOSO
  // =========================================================================
  console.log('\n--- 6. Cliente da Rota Alternativa (fetchPedagogicalTransformation) ---');

  const originalFetch = globalThis.fetch;
  try {
    // 6.1 HTTP 400 must throw / propagate explicit error, never return local fallback
    (globalThis as any).fetch = async (url: string) => {
      if (String(url).includes('/api/pedagogical-notes/transform')) {
        return {
          ok: false,
          status: 400,
          json: async () => ({
            success: false,
            error: 'Payload bounds exceeded',
            code: 'PAYLOAD_BOUNDS_EXCEEDED',
            message: 'Input text exceeds the maximum permitted length of 10000 characters.',
          }),
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    };

    let caught400: any = null;
    try {
      await fetchPedagogicalTransformation({
        rawNotes: compact10001,
        triggerAiIfMissing: true,
        forceRegenerate: true,
      });
    } catch (err) {
      caught400 = err;
    }
    check(
      Boolean(caught400 && caught400.status === 400 && caught400.code === 'PAYLOAD_BOUNDS_EXCEEDED'),
      '6.1: fetchPedagogicalTransformation não mascara erro HTTP 400 com fallback local silencioso'
    );

    // 6.2 HTTP 429 must throw / propagate explicit error with retryAfterSeconds
    (globalThis as any).fetch = async (url: string) => {
      if (String(url).includes('/api/pedagogical-notes/transform')) {
        return {
          ok: false,
          status: 429,
          json: async () => ({
            success: false,
            error: 'Rate limit exceeded',
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'Limite de solicitações atingido.',
            retryAfterSeconds: 42,
          }),
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    };

    let caught429: any = null;
    try {
      await fetchPedagogicalTransformation({
        rawNotes: html14115,
        triggerAiIfMissing: true,
        forceRegenerate: true,
      });
    } catch (err) {
      caught429 = err;
    }
    check(
      Boolean(caught429 && caught429.status === 429 && caught429.retryAfterSeconds === 42),
      '6.2: fetchPedagogicalTransformation não mascara erro HTTP 429 com fallback local silencioso'
    );

    // 6.3 HTTP 503 preserves graceful provisional fallback
    (globalThis as any).fetch = async () => ({
      ok: false,
      status: 503,
      json: async () => ({ error: 'AiUnavailable' }),
    });
    const fallback503 = await fetchPedagogicalTransformation({
      rawNotes: '✗ I has a dog ✓ I have a dog\n[New Word] hound',
      triggerAiIfMissing: true,
      forceRegenerate: true,
    });
    check(
      Boolean(fallback503 && fallback503.isFallback && fallback503.isProvisional),
      '6.3: fetchPedagogicalTransformation preserva fallback gracioso apenas em indisponibilidade 503'
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  // =========================================================================
  // 7. ALINHAMENTO DE CONTADOR E AVISO DE LIMITE NO FRONTEND
  // =========================================================================
  console.log('\n--- 7. Alinhamento de Contador e Aviso de Limite no Frontend ---');
  const panelSrc = fs.readFileSync(
    path.resolve(process.cwd(), 'src/components/TeacherLiveLessonNotesPanel.tsx'),
    'utf-8'
  );
  check(
    panelSrc.includes('convertNotesHtmlToCompactText') &&
      panelSrc.includes('MAX_PEDAGOGICAL_COMPACT_NOTES_CHARS'),
    '7.1: TeacherLiveLessonNotesPanel importa e utiliza convertNotesHtmlToCompactText e MAX_PEDAGOGICAL_COMPACT_NOTES_CHARS'
  );
  check(
    panelSrc.includes('const compactNotesText = useMemo(() => convertNotesHtmlToCompactText(notesContent), [notesContent])') &&
      panelSrc.includes('const charCount = compactNotesText.length'),
    '7.2: Contador do frontend calcula charCount exatamente sobre o texto pedagógico compacto'
  );
  check(
    panelSrc.includes('data-testid="notes-compact-char-counter"') &&
      panelSrc.includes('data-testid="notes-char-limit-warning"') &&
      panelSrc.includes('data-testid="notes-char-limit-banner"') &&
      panelSrc.includes('if (charCount > MAX_PEDAGOGICAL_COMPACT_NOTES_CHARS)'),
    '7.3: Contador / 10,000, avisos de proximidade/excesso e bloqueio preventivo no Apply AI implementados (Save Notes preservado)'
  );

  // Verify parsing consistency between raw HTML and compact text
  const parsedRaw = parseNotesHtml(html14115);
  const parsedCompact = parseNotesHtml(compact14115);
  check(
    parsedRaw.incorrectCount === parsedCompact.incorrectCount &&
      parsedRaw.correctCount === parsedCompact.correctCount &&
      parsedRaw.newWordCount === parsedCompact.newWordCount &&
      parsedRaw.pronounceCount === parsedCompact.pronounceCount &&
      parsedRaw.errors.length === parsedCompact.errors.length,
    '7.4: parseNotesHtml extrai contagens e associações idênticas do HTML original e do texto compacto'
  );

  console.log('\n=======================================================================');
  console.log(`TOTAL AI.BOUNDS.3: ${passed + failed} | APROVADOS: ${passed} | FALHAS: ${failed}`);
  console.log('=======================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
  process.exit(0);
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
