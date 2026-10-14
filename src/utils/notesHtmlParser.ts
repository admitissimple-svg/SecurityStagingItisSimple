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

  // 1. Tag count audit
  const tagCorrect = (rawContent.match(/data-tag-type=["']correct["']/g) || []).length;
  const tagIncorrect = (rawContent.match(/data-tag-type=["']incorrect["']/g) || []).length;
  const tagNewWord = (rawContent.match(/data-tag-type=["']new-word["']/g) || []).length;
  const tagPronounce = (rawContent.match(/data-tag-type=["']pronounce["']/g) || []).length;

  // Plain symbol audit (excluding any already captured inside data-tag-type spans)
  const plainWithoutSpans = rawContent.replace(/<span[^>]*data-tag-type=["'][^"']+["'][^>]*>[\s\S]*?<\/span>/gi, '');
  const plainCorrect = (plainWithoutSpans.match(/✓|✔/g) || []).length;
  const plainIncorrect = (plainWithoutSpans.match(/✗|✖/g) || []).length;
  const plainNewWord = (plainWithoutSpans.match(/\[New Word\]/gi) || []).length;
  const plainPronounce = (plainWithoutSpans.match(/\[Pronounce\]/gi) || []).length;

  const correctCount = tagCorrect + plainCorrect;
  const incorrectCount = tagIncorrect + plainIncorrect;
  const newWordCount = tagNewWord + plainNewWord;
  const pronounceCount = tagPronounce + plainPronounce;

  // 2. Tokenize and normalize HTML tags to unambiguous markers
  // Tokenize data-tag-type spans (entire span with decorative text is replaced by token)
  let tokenized = rawContent
    .replace(/<span[^>]*data-tag-type=["']correct["'][^>]*>[\s\S]*?<\/span>/gi, ' [[TAG:CORRECT]] ')
    .replace(/<span[^>]*data-tag-type=["']incorrect["'][^>]*>[\s\S]*?<\/span>/gi, ' [[TAG:INCORRECT]] ')
    .replace(/<span[^>]*data-tag-type=["']new-word["'][^>]*>[\s\S]*?<\/span>/gi, ' [[TAG:NEW_WORD]] ')
    .replace(/<span[^>]*data-tag-type=["']pronounce["'][^>]*>[\s\S]*?<\/span>/gi, ' [[TAG:PRONOUNCE]] ');

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

  const errors: ParsedNoteError[] = [];
  const newWords: string[] = [];
  const pronounceItems: string[] = [];
  const positives: string[] = [];
  const vocabItems: string[] = [];
  const seenNewWords = new Set<string>();
  const seenPronounce = new Set<string>();
  const seenPositives = new Set<string>();
  const seenErrors = new Set<string>();

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    if (isTemplateHeaderLine(line)) {
      continue;
    }

    const hasNewWord = line.includes('[[TAG:NEW_WORD]]');
    const hasPronounce = line.includes('[[TAG:PRONOUNCE]]');
    const hasIncorrect = line.includes('[[TAG:INCORRECT]]');
    const hasCorrect = line.includes('[[TAG:CORRECT]]');

    // Case 1: Alt+W (New Word)
    if (hasNewWord) {
      const cleanTerm = cleanExpressionTerm(
        line.replace(/\[\[TAG:NEW_WORD\]\]/g, '')
      );
      if (cleanTerm && cleanTerm.length > 0 && !seenNewWords.has(cleanTerm.toLowerCase())) {
        seenNewWords.add(cleanTerm.toLowerCase());
        newWords.push(cleanTerm);
      }
      continue;
    }

    // Case 2: Alt+P (Pronounce)
    if (hasPronounce) {
      const cleanTerm = cleanExpressionTerm(
        line.replace(/\[\[TAG:PRONOUNCE\]\]/g, '')
      );
      if (cleanTerm && cleanTerm.length > 0 && !seenPronounce.has(cleanTerm.toLowerCase())) {
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

    // Case 7: Bulleted notes without explicit coaching tag
    if (line.startsWith('•') || line.startsWith('-') || line.startsWith('*')) {
      const item = cleanExpressionTerm(line);
      if (item && item.length > 1 && !item.toLowerCase().includes('in-session notes')) {
        vocabItems.push(item);
      }
    }
  }

  // Clean full text representation for reference
  const cleanText = decodedText
    .replace(/\[\[TAG:[^\]]+\]\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

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
