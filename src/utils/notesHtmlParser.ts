/**
 * Robust HTML and Text Parser for Native Friend In-Session Notes.
 *
 * Preserves the exact association between expressions and coaching tag types:
 * - correct (Alt+Y, ✓)
 * - incorrect (Alt+N, ✗)
 * - new-word (Alt+W, ✦ New Word)
 * - pronounce (Alt+P, 🎯 Pronounce)
 *
 * Removes decorative tag text and HTML entities without altering original words.
 * Avoids simplistic global regex that could corrupt nested structures.
 */

export interface ParsedNoteError {
  original: string;
  corrected?: string;
  isPendingConfirmation: boolean;
  context?: string;
}

export interface ParsedNotesResult {
  errors: ParsedNoteError[];
  newWords: string[];
  pronounceItems: string[];
  positives: string[];
  vocabItems: string[];
  cleanText: string;
  correctCount: number;
  incorrectCount: number;
  newWordCount: number;
  pronounceCount: number;
}

/**
 * Decodes all common HTML entities to their natural character representation.
 */
export function decodeHtmlEntities(str: string): string {
  if (!str) return '';
  return str
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#039;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => {
      try {
        return String.fromCharCode(parseInt(code, 10));
      } catch {
        return '';
      }
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
      try {
        return String.fromCharCode(parseInt(hex, 16));
      } catch {
        return '';
      }
    });
}

/**
 * Strips HTML tags from a string while preserving inner text content.
 */
export function stripHtmlTags(str: string): string {
  if (!str) return '';
  return str.replace(/<[^>]+>/g, '');
}

/**
 * Cleans extracted expression string by removing leftover decorative symbols,
 * quotes, bullets, and excessive whitespace.
 */
export function cleanExpressionTerm(term: string): string {
  if (!term) return '';
  return decodeHtmlEntities(term)
    .replace(/\[\[TAG:[A-Z_]+\]\]/g, '')
    .replace(/\(Alt\+[WPYN]\)/gi, '')
    .replace(/^[•\-\*–—\s]+/, '')
    .replace(/[•\-\*–—\s]+$/, '')
    .replace(/^[✓✔✗✖✦🎯\s]+/, '')
    .replace(/[✓✔✗✖✦🎯\s]+$/, '')
    .replace(/^\[(new word|pronounce|correct|incorrect)\]\s*/i, '')
    .replace(/\s*\[(new word|pronounce|correct|incorrect)\]$/i, '')
    .trim();
}

/**
 * Checks if a line is part of the standard template header / boilerplate.
 */
function isTemplateHeaderLine(line: string): boolean {
  const norm = line.toLowerCase().trim();
  if (!norm) return true;
  if (norm.includes('native friend in-session notes')) return true;
  if (norm.includes('session notes with')) return true;
  if (norm.startsWith('date:') && (norm.includes('student:') || norm.includes('|'))) return true;
  if (norm.startsWith('topic:')) return true;
  if (norm === 'in-session coaching notes:' || norm === 'coaching notes:') return true;
  if (norm === 'say:' || norm === 'instead of:') return true;
  return false;
}

/**
 * Parses raw HTML or text notes from the teacher editor.
 */
export function parseNotesHtml(rawContent: string): ParsedNotesResult {
  if (!rawContent || !rawContent.trim()) {
    return {
      errors: [],
      newWords: [],
      pronounceItems: [],
      positives: [],
      vocabItems: [],
      cleanText: '',
      correctCount: 0,
      incorrectCount: 0,
      newWordCount: 0,
      pronounceCount: 0,
    };
  }

  const errors: ParsedNoteError[] = [];
  const newWords: string[] = [];
  const pronounceItems: string[] = [];
  const positives: string[] = [];
  const vocabItems: string[] = [];
  const seenNewWords = new Set<string>();
  const seenPronounce = new Set<string>();
  const seenPositives = new Set<string>();
  const seenErrors = new Set<string>();

  const isBadgeLabel = (text: string) => {
    const clean = text.trim();
    if (!clean) return true;
    return (
      /^[✓✔✗✖✦🎯\s]*(new word|pronounce|correct|incorrect)?[✓✔✗✖✦🎯\s]*$/i.test(clean) ||
      clean === '✦ New Word' ||
      clean === '🎯 Pronounce' ||
      clean === '[New Word]' ||
      clean === '[Pronounce]'
    );
  };

  // 1. Pre-process wrapped spans that directly wrap target words (e.g. <span class="new-word">streamline</span>
  // or nested <span class="new-word"><span class="pronounce">breakthrough</span></span>)
  let preprocessed = rawContent.replace(
    /<span\b([^>]*?(?:data-tag-type=["'](new-word|pronounce|correct|incorrect)["']|class=["'][^"']*\b(new-word|pronounce|correct|incorrect)\b)[^>]*)>([\s\S]*?)<\/span>/gi,
    (fullMatch, attrs, tagType, className, inner) => {
      const strippedInner = stripHtmlTags(inner).trim();
      if (!strippedInner || isBadgeLabel(strippedInner)) {
        return fullMatch; // Let badge tokenization handle it below
      }

      const hasNw =
        tagType === 'new-word' ||
        className === 'new-word' ||
        /new-word/i.test(attrs) ||
        /new-word/i.test(inner);

      const hasPr =
        tagType === 'pronounce' ||
        className === 'pronounce' ||
        /pronounce/i.test(attrs) ||
        /pronounce/i.test(inner);

      const cleanWord = cleanExpressionTerm(strippedInner);
      if (cleanWord) {
        const normKey = cleanWord.toLowerCase();
        if (hasNw && !seenNewWords.has(normKey)) {
          seenNewWords.add(normKey);
          newWords.push(cleanWord);
        }
        if (hasPr && !seenPronounce.has(normKey)) {
          seenPronounce.add(normKey);
          pronounceItems.push(cleanWord);
        }
      }

      return ` ${cleanWord} `;
    }
  );

  // 2. Tag count audit (match full opening span to avoid double-counting on multiple attributes)
  const countMatches = (regex: RegExp) => (rawContent.match(regex) || []).length;
  const tagCorrect = countMatches(/<span\b[^>]*(?:data-tag-type=["']correct["']|class=["'][^"']*\bcorrect(?:-tag)?\b)[^>]*>/gi);
  const tagIncorrect = countMatches(/<span\b[^>]*(?:data-tag-type=["']incorrect["']|class=["'][^"']*\bincorrect(?:-tag)?\b)[^>]*>/gi);
  const tagNewWord = countMatches(/<span\b[^>]*(?:data-tag-type=["']new-word["']|class=["'][^"']*\bnew-word(?:-tag)?\b)[^>]*>|\[New Word\]|\(Alt\+W\)/gi);
  const tagPronounce = countMatches(/<span\b[^>]*(?:data-tag-type=["']pronounce["']|class=["'][^"']*\bpronounce(?:-tag)?\b)[^>]*>|\[Pronounce\]|\(Alt\+P\)/gi);

  const plainWithoutSpans = rawContent.replace(/<span[^>]*>[\s\S]*?<\/span>/gi, '');
  const plainCorrect = (plainWithoutSpans.match(/✓|✔/g) || []).length;
  const plainIncorrect = (plainWithoutSpans.match(/✗|✖/g) || []).length;


  // 3. Tokenize remaining badge tags and symbols
  let tokenized = preprocessed
    .replace(/<span[^>]*?(?:data-tag-type=["']correct["']|class=["'][^"']*\bcorrect\b)[^>]*>[\s\S]*?<\/span>/gi, ' [[TAG:CORRECT]] ')
    .replace(/<span[^>]*?(?:data-tag-type=["']incorrect["']|class=["'][^"']*\bincorrect\b)[^>]*>[\s\S]*?<\/span>/gi, ' [[TAG:INCORRECT]] ')
    .replace(/<span[^>]*?(?:data-tag-type=["']new-word["']|class=["'][^"']*\bnew-word\b)[^>]*>[\s\S]*?<\/span>/gi, ' [[TAG:NEW_WORD]] ')
    .replace(/<span[^>]*?(?:data-tag-type=["']pronounce["']|class=["'][^"']*\bpronounce\b)[^>]*>[\s\S]*?<\/span>/gi, ' [[TAG:PRONOUNCE]] ');

  // Tokenize plain text stamps if present
  tokenized = tokenized
    .replace(/\[New Word\]/gi, ' [[TAG:NEW_WORD]] ')
    .replace(/\[Pronounce\]/gi, ' [[TAG:PRONOUNCE]] ')
    .replace(/(^|[^a-zA-Z0-9_])(✓|✔)([^a-zA-Z0-9_]|$)/g, '$1 [[TAG:CORRECT]] $3')
    .replace(/(^|[^a-zA-Z0-9_])(✗|✖)([^a-zA-Z0-9_]|$)/g, '$1 [[TAG:INCORRECT]] $3');

  // Convert HTML block elements and breaks into distinct newlines
  const textWithBreaks = tokenized
    .replace(/<br\s*[\/]?>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<div>/gi, '')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<p>/gi, '')
    .replace(/<\/li>/gi, '\n')
    .replace(/<li>/gi, '• ')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n');

  // Strip remaining HTML tags and decode entities
  const strippedText = stripHtmlTags(textWithBreaks);
  const decodedText = decodeHtmlEntities(strippedText);

  // Split into raw lines
  const rawLines = decodedText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    if (isTemplateHeaderLine(line)) {
      continue;
    }

    const hasNewWord = line.includes('[[TAG:NEW_WORD]]');
    const hasPronounce = line.includes('[[TAG:PRONOUNCE]]');
    const hasIncorrect = line.includes('[[TAG:INCORRECT]]');
    const hasCorrect = line.includes('[[TAG:CORRECT]]');

    // Case 1: Alt+W (New Word badge on line)
    if (hasNewWord) {
      const cleanTerm = cleanExpressionTerm(
        line.replace(/\[\[TAG:[A-Z_]+\]\]/g, '')
      );
      if (
        cleanTerm &&
        cleanTerm.length > 0 &&
        cleanTerm.length <= 60 &&
        !cleanTerm.includes('.') &&
        !seenNewWords.has(cleanTerm.toLowerCase())
      ) {
        seenNewWords.add(cleanTerm.toLowerCase());
        newWords.push(cleanTerm);
      }
      if (
        hasPronounce &&
        cleanTerm &&
        cleanTerm.length > 0 &&
        cleanTerm.length <= 60 &&
        !cleanTerm.includes('.') &&
        !seenPronounce.has(cleanTerm.toLowerCase())
      ) {
        seenPronounce.add(cleanTerm.toLowerCase());
        pronounceItems.push(cleanTerm);
      }
      continue;
    }

    // Case 2: Alt+P (Pronounce badge on line)
    if (hasPronounce) {
      const cleanTerm = cleanExpressionTerm(
        line.replace(/\[\[TAG:[A-Z_]+\]\]/g, '')
      );
      if (
        cleanTerm &&
        cleanTerm.length > 0 &&
        cleanTerm.length <= 60 &&
        !cleanTerm.includes('.') &&
        !seenPronounce.has(cleanTerm.toLowerCase())
      ) {
        seenPronounce.add(cleanTerm.toLowerCase());
        pronounceItems.push(cleanTerm);
      }
      continue;
    }

    // Case 3: Both Incorrect and Correct in the SAME line
    // e.g., "[[TAG:INCORRECT]] Blate [[TAG:CORRECT]] Blast"
    if (hasIncorrect && hasCorrect) {
      const incIdx = line.indexOf('[[TAG:INCORRECT]]');
      const corIdx = line.indexOf('[[TAG:CORRECT]]');

      let originalPart = '';
      let correctedPart = '';

      if (incIdx < corIdx) {
        // Incorrect comes first
        originalPart = line.substring(incIdx + '[[TAG:INCORRECT]]'.length, corIdx);
        correctedPart = line.substring(corIdx + '[[TAG:CORRECT]]'.length);
      } else {
        // Correct comes first
        correctedPart = line.substring(corIdx + '[[TAG:CORRECT]]'.length, incIdx);
        originalPart = line.substring(incIdx + '[[TAG:INCORRECT]]'.length);
      }

      const cleanOrig = cleanExpressionTerm(originalPart.replace(/^(instead of|original|error):\s*/i, ''));
      const cleanCorr = cleanExpressionTerm(correctedPart.replace(/^(say|better|correction):\s*/i, ''));

      if (cleanOrig && !seenErrors.has(cleanOrig.toLowerCase())) {
        seenErrors.add(cleanOrig.toLowerCase());
        errors.push({
          original: cleanOrig,
          corrected: cleanCorr || undefined,
          isPendingConfirmation: !cleanCorr,
          context: line.replace(/\[\[TAG:[^\]]+\]\]/g, '').trim(),
        });
      }
      continue;
    }

    // Case 4: Explicit text pair "Instead of: ... Say: ..." or "A -> B"
    if (/instead of/i.test(line) && /say/i.test(line)) {
      const m = line.match(/instead of:?\s*(.*?)(?:say:?\s*(.*)|$)/i);
      if (m) {
        const cleanOrig = cleanExpressionTerm(m[1] || '');
        const cleanCorr = cleanExpressionTerm(m[2] || '');
        if (cleanOrig && !seenErrors.has(cleanOrig.toLowerCase())) {
          seenErrors.add(cleanOrig.toLowerCase());
          errors.push({
            original: cleanOrig,
            corrected: cleanCorr || undefined,
            isPendingConfirmation: !cleanCorr,
            context: line,
          });
          continue;
        }
      }
    }

    if (line.includes('->') || line.includes('=>') || line.includes('➜') || line.includes('→')) {
      const arrowParts = line.split(/->|=>|➜|→/);
      if (arrowParts.length >= 2) {
        const cleanOrig = cleanExpressionTerm(arrowParts[0].replace(/\[\[TAG:[^\]]+\]\]/g, ''));
        const cleanCorr = cleanExpressionTerm(arrowParts[1].replace(/\[\[TAG:[^\]]+\]\]/g, ''));
        if (cleanOrig && !seenErrors.has(cleanOrig.toLowerCase())) {
          seenErrors.add(cleanOrig.toLowerCase());
          errors.push({
            original: cleanOrig,
            corrected: cleanCorr || undefined,
            isPendingConfirmation: !cleanCorr,
            context: line,
          });
          continue;
        }
      }
    }

    // Case 5: Single Incorrect Tag on line
    if (hasIncorrect) {
      const cleanOrig = cleanExpressionTerm(line.replace(/\[\[TAG:INCORRECT\]\]/g, ''));

      // Check if next line is explicitly a "Say: ..." or "Better: ..." correction
      let lookaheadCorrection = '';
      if (i + 1 < rawLines.length) {
        const nextLine = rawLines[i + 1];
        if (/^(say|better|correction):\s*/i.test(nextLine)) {
          lookaheadCorrection = cleanExpressionTerm(nextLine.replace(/^(say|better|correction):\s*/i, ''));
          i++; // Consume lookahead
        }
      }

      if (cleanOrig && !seenErrors.has(cleanOrig.toLowerCase())) {
        seenErrors.add(cleanOrig.toLowerCase());
        errors.push({
          original: cleanOrig,
          corrected: lookaheadCorrection || undefined,
          isPendingConfirmation: !lookaheadCorrection,
          context: line,
        });
      }
      continue;
    }

    // Case 6: Single Correct Tag on line (Positive / Mastered Expression)
    if (hasCorrect) {
      const cleanTerm = cleanExpressionTerm(line.replace(/\[\[TAG:CORRECT\]\]/g, ''));
      if (cleanTerm && cleanTerm.length > 0 && !seenPositives.has(cleanTerm.toLowerCase())) {
        seenPositives.add(cleanTerm.toLowerCase());
        positives.push(cleanTerm);
      }
      continue;
    }

    // Case 7: Bulleted notes or standalone untagged expressions without explicit coaching tag
    if (line.startsWith('•') || line.startsWith('-') || line.startsWith('*')) {
      const item = cleanExpressionTerm(line);
      if (item && item.length >= 1 && !item.toLowerCase().includes('in-session notes')) {
        vocabItems.push(item);
      }
    } else {
      const item = cleanExpressionTerm(line);
      // Only treat as standalone untagged vocab if it is an isolated term/expression (not a full narrative sentence)
      const wordCount = item.split(/\s+/).filter(Boolean).length;
      const isSentence = item.includes('.') || item.includes('?') || item.includes('!') || wordCount > 4;
      if (
        item &&
        item.length >= 1 &&
        !isSentence &&
        !isTemplateHeaderLine(item) &&
        !isBadgeLabel(item) &&
        !item.toLowerCase().includes('in-session notes') &&
        !seenNewWords.has(item.toLowerCase()) &&
        !seenPronounce.has(item.toLowerCase()) &&
        !seenErrors.has(item.toLowerCase()) &&
        !seenPositives.has(item.toLowerCase())
      ) {
        vocabItems.push(item);
      }
    }
  }

  // Clean full text representation for reference
  const cleanText = decodedText
    .replace(/\[\[TAG:[^\]]+\]\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Final tag count evaluation
  const correctCount = Math.max(tagCorrect + plainCorrect, positives.length);
  const incorrectCount = Math.max(tagIncorrect + plainIncorrect, errors.length);
  const newWordCount = Math.max(
    tagNewWord,
    newWords.length,
    errors.length === 0 && pronounceItems.length === 0 ? vocabItems.length : 0
  );
  const pronounceCount = Math.max(tagPronounce, pronounceItems.length);

  return {
    errors,
    newWords,
    pronounceItems,
    positives,
    vocabItems,
    cleanText,
    correctCount,
    incorrectCount,
    newWordCount,
    pronounceCount,
  };
}

/**
 * Calculates Levenshtein edit distance between two strings.
 */
export function levenshteinDistance(s1: string, s2: string): number {
  const m = s1.length;
  const n = s2.length;
  const d: number[][] = [];
  for (let i = 0; i <= m; i++) d[i] = [i];
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + cost
      );
    }
  }
  return d[m][n];
}

/**
 * Robust pedagogical matcher that determines if an AI generated term corresponds
 * to a teacher note expression, supporting:
 * 1. Exact string match
 * 2. Substring inclusion
 * 3. Spelling correction & doubled consonant variations (e.g. blury <-> blurry)
 * 4. Close edit distance (Levenshtein <= 1 or 2 for longer terms)
 */
export function isPedagogicalTermMatch(termA: string, termB: string): boolean {
  if (!termA || !termB) return false;
  const a = termA.toLowerCase().trim();
  const b = termB.toLowerCase().trim();
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return true;

  const cleanA = a.replace(/[^a-z0-9]/g, '');
  const cleanB = b.replace(/[^a-z0-9]/g, '');
  if (!cleanA || !cleanB) return false;
  if (cleanA === cleanB) return true;
  if (cleanA.includes(cleanB) || cleanB.includes(cleanA)) return true;

  // Collapsed consecutive duplicate characters (e.g. "blurry" -> "blury")
  const collapsedA = cleanA.replace(/(.)\1+/g, '$1');
  const collapsedB = cleanB.replace(/(.)\1+/g, '$1');
  if (collapsedA === collapsedB) return true;

  const minLen = Math.min(cleanA.length, cleanB.length);
  const maxLen = Math.max(cleanA.length, cleanB.length);
  if (maxLen - minLen <= 2 && minLen >= 3) {
    const maxAllowedDist = minLen >= 7 ? 2 : 1;
    if (levenshteinDistance(cleanA, cleanB) <= maxAllowedDist) {
      return true;
    }
  }

  return false;
}

/**
 * Evaluates whether raw teacher notes contain actionable pedagogical content.
 * Rejects empty input, whitespace, and markup-only inputs (e.g. empty spans/tags).
 * Accepts single valid words (e.g. "blury"), Alt+W, Alt+P, or Alt+N markings.
 */
export function hasValidPedagogicalContent(
  rawNotes: string,
  markings?: ParsedNotesResult
): boolean {
  if (!rawNotes || typeof rawNotes !== 'string') return false;
  const trimmed = rawNotes.trim();
  if (!trimmed) return false;

  const parsed = markings || parseNotesHtml(rawNotes);

  if (
    parsed.errors.length > 0 ||
    parsed.newWords.length > 0 ||
    parsed.pronounceItems.length > 0 ||
    parsed.positives.length > 0 ||
    parsed.vocabItems.length > 0
  ) {
    return true;
  }

  const clean = (parsed.cleanText || '').trim();
  if (!clean) return false;

  const withoutBadges = clean
    .replace(/\b(New Word|Pronounce|Correct|Incorrect|Date|Topic|Student|Session Notes)\b/gi, '')
    .replace(/[^a-zA-ZÀ-ÿ0-9]/g, ' ')
    .trim();

  const words = withoutBadges.split(/\s+/).filter((w) => w.length >= 2);
  return words.length > 0;
}
