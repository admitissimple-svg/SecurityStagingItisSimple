import { EnglishLevel, LiveLesson } from '../types';
import { NATIVE_FRIENDS_DICTIONARY_DATABASE } from '../data/dictionaryDatabase';
import { parseNotesHtml, ParsedNotesResult, isPedagogicalTermMatch, hasValidPedagogicalContent } from './notesHtmlParser';
import { isGenericPedagogicalDefinition, isGenericPedagogicalExample } from './dictionaryService';
import { auth } from '../firebase';

export { parseNotesHtml, isGenericPedagogicalDefinition, isGenericPedagogicalExample, isPedagogicalTermMatch, hasValidPedagogicalContent };
export type { ParsedNotesResult };

export interface PedagogicalMistakeAnalysis {
  id: string;
  original: string;
  corrected: string;
  category:
    | 'grammar'
    | 'vocabulary'
    | 'word-choice'
    | 'collocation'
    | 'preposition'
    | 'sentence-structure'
    | 'naturalness'
    | 'pronunciation'
    | 'phrasing'
    | string;
  explanation: string;
  grammarRule?: string;
  twoExamples: string[];
  commonPitfalls: string;
  similarFormsComparison?: string;
  isPendingConfirmation?: boolean;
}

export interface PedagogicalGrammarPoint {
  id: string;
  topic: string;
  rule: string;
  form: string;
  usage: string;
  examples: string[];
  commonMistakes: string;
  comparisons: string;
}

export interface PedagogicalVocabularyItem {
  id: string;
  term: string;
  partOfSpeech: string;
  definitionEn?: string;
  simpleDefinition: string;
  collocations: string[];
  realExamples: string[];
  synonyms: string[];
  register: 'informal' | 'neutral' | 'formal' | 'conversational' | 'idiomatic' | string;
  registerNote?: string;
  category: string;
  phoneticGuide?: string;
  isPronunciationFocus?: boolean;
  isNewWord?: boolean;
  cefrLevel?: string;
  isProvisional?: boolean;
  isFallback?: boolean;
}

export interface PedagogicalLevelAdaptation {
  cefrLevel: 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';
  levelLabel: string;
  nativeInterferenceNotes: string;
  complexityAdjustmentAdvice: string;
  targetedPracticePrompt: string;
}

export interface PedagogicalReviewSummary {
  estimatedMinutes: string;
  keyRules: string[];
  mustKnowVocabulary: string[];
  essentialCorrections: { original: string; corrected: string; explanation?: string }[];
  usefulPatterns?: string[];
  rememberThis: string;
}

export const PEDAGOGICAL_PROMPT_VERSION = 'v2.5-pedagogical-rules-simplified';

export interface PedagogicalLessonTransformation {
  lessonId?: string;
  sessionKey: string;
  sessionDate: string;
  topic: string;
  teacherName?: string;
  teacherEmail?: string;
  studentUid?: string;
  studentEmail?: string;
  studentLevel: string;
  cefrLevel: string;
  contentHash?: string;
  language?: string;
  promptVersion?: string;
  isAiGenerated?: boolean;
  isFallback?: boolean;
  isProvisional?: boolean;
  needsAiGeneration?: boolean;
  authError?: {
    status: number;
    message: string;
    requiresLogin?: boolean;
  };
  fallbackReason?: 'QUOTA_EXCEEDED' | 'AUTH_ERROR' | 'MODEL_UNAVAILABLE' | 'TIMEOUT' | 'INVALID_RESPONSE' | 'NO_API_KEY' | 'AI_UNAVAILABLE' | string;
  aiNotice?: string;
  source?: 'gemini' | 'fallback';
  modelUsed?: string;
  cooldownSecondsRemaining?: number;
  // Rigorously specified sections:
  // 1. Analyze Mistakes (mapped from Alt+N)
  // 2. Grammar Points (systemic grammar rules from Alt+N & session topic)
  // 3. Vocabulary & Expressions (mapped from Alt+W and Alt+P)
  // 4. Quick Review (comprehensive summary of ALL session items)
  mistakesAnalysis: PedagogicalMistakeAnalysis[];
  grammarPoints: PedagogicalGrammarPoint[];
  vocabularyAndExpressions: PedagogicalVocabularyItem[];
  levelAdaptation?: PedagogicalLevelAdaptation;
  reviewSummary: PedagogicalReviewSummary;
  rawNotesSnippet?: string;
  correctStampsCount: number;
  incorrectStampsCount: number;
  newWordStampsCount?: number;
  pronounceStampsCount?: number;
  generatedAt: string;
}

/**
 * Computes a deterministic content hash for note versioning and cache invalidation.
 */
export function computeNotesHash(str: string): string {
  let hash = 0;
  const clean = (str || '').trim();
  for (let i = 0; i < clean.length; i++) {
    const char = clean.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(16);
}

/**
 * Constructs a distinct cache key partitioned by session, content hash, language, CEFR, and prompt version.
 */
export function buildPedagogicalCacheKey(params: {
  canonicalSessionKey: string;
  contentHash: string;
  language?: string;
  cefrLevel?: string;
  promptVersion?: string;
}): string {
  const pv = params.promptVersion || PEDAGOGICAL_PROMPT_VERSION;
  const lang = (params.language || 'pt').toLowerCase().trim();
  const cefr = (params.cefrLevel || 'B1').toUpperCase().trim();
  return `${params.canonicalSessionKey}__hash_${params.contentHash}__lang_${lang}__cefr_${cefr}__pv_${pv}`;
}

export function getPendingConfirmationText(lang: string = 'pt'): string {
  switch (lang.toLowerCase()) {
    case 'en': return 'Pending confirmation with the teacher';
    case 'es': return 'Pendiente de confirmación con el profesor';
    case 'fr': return 'En attente de confirmation avec le professeur';
    case 'de': return 'Ausstehende Bestätigung durch die Lehrkraft';
    case 'it': return 'In attesa di conferma con l\'insegnante';
    case 'ja': return '講師への確認待ち';
    case 'ko': return '교사 확인 대기 중';
    case 'zh': return '等待老师确认';
    case 'ru': return 'Ожидает подтверждения преподавателем';
    case 'ar': return 'في انتظار تأكيد المعلم';
    case 'tr': return 'Öğretmenle onay bekleniyor';
    case 'pt':
    default:
      return 'Pendente de confirmação com o professor';
  }
}

export function getUnconfirmedExplanationText(original: string, lang: string = 'pt'): string {
  switch (lang.toLowerCase()) {
    case 'en':
      return `The corrected form for "${original}" was not specified in the session. Please confirm with your Native Friend in the next session to validate the exact context.`;
    case 'es':
      return `La forma corregida para "${original}" no fue informada en la clase. Confirme con su Native Friend en la próxima sesión para validar el contexto exacto.`;
    case 'fr':
      return `La forme corrigée pour "${original}" n'a pas été précisée pendant le cours. Confirmez avec votre Native Friend lors de la prochaine session pour valider le contexte exact.`;
    case 'de':
      return `Die korrigierte Form für "${original}" wurde in der Stunde nicht angegeben. Bitte bestätigen Sie den genauen Kontext in der nächsten Sitzung mit Ihrem Native Friend.`;
    case 'it':
      return `La forma corretta per "${original}" non è stata specificata durante la lezione. Si prega di confermare con il Native Friend nella prossima sessione per convalidare il contesto esatto.`;
    case 'ja':
      return `「${original}」の修正形はレッスン中に指定されませんでした。次のセッションでネイティブフレンドに正確な文脈を確認してください。`;
    case 'ko':
      return `"${original}"에 대한 수정 형태가 수업 중 지정되지 않았습니다. 다음 세션에서 원어민 친구에게 정확한 문맥을 확인하세요.`;
    case 'zh':
      return `课上未提供"${original}"的修改形式。请在下次会话中与您的Native Friend确认具体语境。`;
    case 'ru':
      return `Исправленная форма для "${original}" не была указана на уроке. Пожалуйста, уточните точный контекст у Native Friend на следующем занятии.`;
    case 'ar':
      return `لم يتم تحديد الصيغة المصححة لـ "${original}" في الجلسة. يُرجى التأكيد مع صديقك المعتمد في الجلسة القادمة للتحقق من السياق الدقيق.`;
    case 'tr':
      return `"${original}" için düzeltilmiş biçim derste belirtilmedi. Tam bağlamı doğrulamak için bir sonraki oturumda Native Friend ile onaylayın.`;
    case 'pt':
    default:
      return `A forma corrigida para "${original}" não foi informada na aula. Confirme com seu Native Friend na próxima sessão para validar o contexto exato.`;
  }
}

export function getPendingPitfallsText(lang: string = 'pt'): string {
  switch (lang.toLowerCase()) {
    case 'en': return 'Awaiting teacher confirmation regarding the specific context of usage.';
    case 'es': return 'A la espera de confirmación del profesor sobre el contexto específico de uso.';
    case 'fr': return 'En attente de confirmation de l\'enseignant concernant le contexte d\'utilisation.';
    case 'de': return 'Warten auf Bestätigung der Lehrkraft zum genauen Verwendungskontext.';
    case 'it': return 'In attesa di conferma da parte dell\'insegnante sul contesto d\'uso specifico.';
    case 'ja': return '具体的な使用文脈について講師の確認を待っています。';
    case 'ko': return '구체적인 사용 맥락에 대해 교사의 확인을 기다리는 중입니다.';
    case 'zh': return '等待教师确认具体使用语境。';
    case 'ru': return 'Ожидается подтверждение преподавателя относительно конкретного контекста использования.';
    case 'ar': return 'في انتظار تأكيد المعلم بشأن سياق الاستخدام المحدد.';
    case 'tr': return 'Belirli kullanım bağlamı konusunda öğretmen onayı bekleniyor.';
    case 'pt':
    default:
      return 'Aguardando confirmação do professor sobre o contexto específico de uso.';
  }
}

export function getAiUnavailableNoticeText(lang: string = 'pt'): string {
  switch (lang.toLowerCase()) {
    case 'en': return 'AI pedagogical enrichment is temporarily unavailable. Displaying verified teacher notes and original markings.';
    case 'es': return 'El enriquecimiento pedagógico por IA no está disponible temporalmente. Mostrando notas verificadas del profesor y marcas originales.';
    case 'fr': return 'L\'enrichissement pédagogique par IA est temporairement indisponible. Affichage des notes vérifiées de l\'enseignant et des annotations originales.';
    case 'de': return 'Die pädagogische KI-Anreicherung ist vorübergehend nicht verfügbar. Zeigt verifizierte Lehrernotizen und Originalmarkierungen an.';
    case 'it': return 'L\'arricchimento pedagogico con IA è temporaneamente non disponibile. Vengono mostrate le note verificate dell\'insegnante e le annotazioni originali.';
    case 'ja': return 'AIによる教育的拡張は現在一時的に利用できません。確認済みの講師メモと原典マーキングを表示しています。';
    case 'ko': return 'AI 교육적 심화 분석을 일시적으로 사용할 수 없습니다. 확인된 교사 메모와 원본 마킹을 표시합니다.';
    case 'zh': return 'AI教学丰富功能暂时不可用。正在显示已验证的教师笔记和原始标记。';
    case 'ru': return 'Педагогическое обогащение с помощью ИИ временно недоступно. Отображаются проверенные заметки преподавателя и оригинальная разметка.';
    case 'ar': return 'التحسين التربوي بالذكاء الاصطناعي غير متاح مؤقتًا. يتم عرض ملاحظات المعلم المعتمدة والعلامات الأصلية.';
    case 'tr': return 'Yapay zeka pedagojik zenginleştirmesi geçici olarak kullanılamıyor. Doğrulanmış öğretmen notları ve orijinal işaretlemeler gösteriliyor.';
    case 'pt':
    default:
      return 'O enriquecimento pedagógico por IA está temporariamente indisponível. Exibindo as anotações verificadas do professor e marcações originais.';
  }
}

/**
 * Helper to match a student's mistake between raw parsed markings and AI output,
 * tolerating punctuation, casing, quotes, or compound sentence splitting without triggering false retries.
 */
function isPedagogicalMistakeMatch(aiOriginal: string, targetOriginal: string): boolean {
  if (!aiOriginal || !targetOriginal) return false;
  const a = aiOriginal.toLowerCase().trim();
  const b = targetOriginal.toLowerCase().trim();
  if (isPedagogicalTermMatch(a, b)) return true;

  const tokensB = b
    .replace(/[^a-z0-9\s']/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3);
  if (tokensB.length >= 2) {
    const matchedCount = tokensB.filter((t) => a.includes(t)).length;
    if (matchedCount / tokensB.length >= 0.6) return true;
  }
  return false;
}

/**
 * Streamlined pedagogical validation function:
 * - Normalizes synonymous/mirrored fields in-place (e.g. definitionEn <-> simpleDefinition, examples -> twoExamples, Alt+P focus)
 *   so valid AI outputs never fail validation over minor structural omissions or trigger duplicate contingency retries.
 * - Rejects responses omitting explicitly stamped Alt+N / Alt+W / Alt+P items or injecting synthetic/generic boilerplate.
 */
export function validatePedagogicalAiResponse(
  parsed: any,
  markings: ParsedNotesResult,
  cefr: string = 'B1',
  language: string = 'pt'
): { valid: boolean; reason?: string } {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { valid: false, reason: 'Response is not a valid JSON object' };
  }

  // 1. Validate Alt+N (Part 1: Analyze the student's mistakes)
  const hasErrors = Array.isArray(markings.errors) && markings.errors.length > 0;
  const mistakes = Array.isArray(parsed.mistakesAnalysis) ? parsed.mistakesAnalysis : [];

  // Normalize mistake fields in-place to avoid unnecessary validation rework
  for (const m of mistakes) {
    if (!m || typeof m !== 'object') continue;
    if ((!Array.isArray(m.twoExamples) || m.twoExamples.length === 0) && Array.isArray(m.examples)) {
      m.twoExamples = m.examples;
    }
    if (!m.explanation && typeof m.grammarRule === 'string' && m.grammarRule.trim()) {
      m.explanation = m.grammarRule.trim();
    }
  }

  if (hasErrors) {
    if (mistakes.length === 0) {
      return { valid: false, reason: 'AI omitted mistakesAnalysis although teacher marked Alt+N errors' };
    }

    for (const rawErr of markings.errors) {
      const origTarget = rawErr.original.toLowerCase().trim();
      const found = mistakes.find((m: any) =>
        isPedagogicalMistakeMatch(String(m?.original || ''), origTarget)
      );

      if (!found) {
        return { valid: false, reason: `AI response missed teacher Alt+N error: "${rawErr.original}"` };
      }

      if (!found.corrected || typeof found.corrected !== 'string' || !found.corrected.trim()) {
        return { valid: false, reason: `AI response omitted correction for: "${rawErr.original}"` };
      }

      const corrLower = found.corrected.toLowerCase();
      if (corrLower.includes('pending confirmation') || corrLower.includes('pendente de confirmação')) {
        return { valid: false, reason: `AI returned pending placeholder for: "${rawErr.original}"` };
      }

      if (!found.explanation || typeof found.explanation !== 'string' || found.explanation.trim().length < 5) {
        return { valid: false, reason: `AI explanation too short or missing for: "${rawErr.original}"` };
      }

      const rawExamples = Array.isArray(found.twoExamples) ? found.twoExamples : [];
      if (rawExamples.length === 0) {
        return { valid: false, reason: `AI omitted examples for mistake: "${rawErr.original}"` };
      }
      for (const ex of rawExamples) {
        if (typeof ex !== 'string' || isGenericPedagogicalExample(ex)) {
          return { valid: false, reason: `AI provided generic example for mistake: "${rawErr.original}"` };
        }
      }
    }
  } else {
    // Reject canned fixture mistakes when notes had no errors
    for (const m of mistakes) {
      const origLower = String(m?.original || '').toLowerCase();
      if (
        origLower.includes('i have 28 years old') ||
        origLower.includes("i'm agree") ||
        origLower.includes('it depends of') ||
        origLower.includes('make a question')
      ) {
        return { valid: false, reason: 'AI inserted synthetic mistake when notes had no errors' };
      }
    }
  }

  // 2. Normalize & Validate Alt+W and Alt+P (Part 3: Teach the vocabulary and expressions)
  const hasNewWords = Array.isArray(markings.newWords) && markings.newWords.length > 0;
  const hasPronounce = Array.isArray(markings.pronounceItems) && markings.pronounceItems.length > 0;
  const vocabList = Array.isArray(parsed.vocabularyAndExpressions) ? parsed.vocabularyAndExpressions : [];

  // Mirror simpleDefinition <-> definitionEn in-place so single definition avoids duplicate fields & extra dictionary AI calls
  for (const v of vocabList) {
    if (!v || typeof v !== 'object') continue;
    const defEn = typeof v.definitionEn === 'string' ? v.definitionEn.trim() : '';
    const simpleDef = typeof v.simpleDefinition === 'string' ? v.simpleDefinition.trim() : '';
    if (!simpleDef && defEn) {
      v.simpleDefinition = defEn;
    } else if (!defEn && simpleDef) {
      v.definitionEn = simpleDef;
    }
    if ((!Array.isArray(v.realExamples) || v.realExamples.length === 0) && Array.isArray(v.examples)) {
      v.realExamples = v.examples;
    }
  }

  if (hasNewWords) {
    if (vocabList.length === 0) {
      return { valid: false, reason: 'AI omitted vocabularyAndExpressions although teacher marked Alt+W words' };
    }

    for (const newWord of markings.newWords) {
      const cleanTarget = newWord.toLowerCase().trim();
      const found = vocabList.find((v: any) =>
        isPedagogicalTermMatch(String(v?.term || '').toLowerCase().trim(), cleanTarget)
      );

      if (!found) {
        return { valid: false, reason: `AI response missed teacher Alt+W word: "${newWord}"` };
      }

      found.isNewWord = true;

      if (!found.simpleDefinition || typeof found.simpleDefinition !== 'string' || isGenericPedagogicalDefinition(found.simpleDefinition)) {
        return { valid: false, reason: `AI provided generic or missing simpleDefinition for: "${newWord}"` };
      }
      if (found.definitionEn && isGenericPedagogicalDefinition(found.definitionEn)) {
        return { valid: false, reason: `AI provided generic definitionEn for: "${newWord}"` };
      }

      if (!Array.isArray(found.realExamples) || found.realExamples.length === 0) {
        return { valid: false, reason: `AI omitted realExamples for: "${newWord}"` };
      }

      for (const ex of found.realExamples) {
        if (typeof ex !== 'string' || isGenericPedagogicalExample(ex)) {
          return { valid: false, reason: `AI provided generic example for: "${newWord}"` };
        }
      }
    }
  }

  if (hasPronounce) {
    if (vocabList.length === 0) {
      return { valid: false, reason: 'AI omitted vocabularyAndExpressions although teacher marked Alt+P pronunciation items' };
    }

    for (const pItem of markings.pronounceItems) {
      const cleanTarget = pItem.toLowerCase().trim();
      const found = vocabList.find((v: any) =>
        isPedagogicalTermMatch(String(v?.term || '').toLowerCase().trim(), cleanTarget)
      );

      if (!found) {
        return { valid: false, reason: `AI response missed teacher Alt+P item: "${pItem}"` };
      }

      // Automatically tag pronunciation focus from verified teacher Alt+P stamp while preserving thematic category
      found.isPronunciationFocus = true;

      const hasDefinitionOrPhonetic = Boolean(
        (found.phoneticGuide && String(found.phoneticGuide).trim().length > 2) ||
        (found.simpleDefinition && String(found.simpleDefinition).trim().length > 3 && !isGenericPedagogicalDefinition(found.simpleDefinition))
      );

      if (!hasDefinitionOrPhonetic) {
        return { valid: false, reason: `AI omitted definition or phonetic guide for Alt+P item: "${pItem}"` };
      }
    }
  }

  // 3. Untagged notes items (e.g. standalone vocabulary notes without explicit Alt+W / Alt+P stamps)
  const hasUntaggedVocab = Array.isArray(markings.vocabItems) && markings.vocabItems.length > 0;
  if (!hasNewWords && !hasPronounce && !hasErrors && hasUntaggedVocab) {
    if (vocabList.length === 0 && mistakes.length === 0) {
      return { valid: false, reason: 'AI omitted pedagogical analysis although teacher provided notes' };
    }
    for (const v of vocabList) {
      if (!v?.simpleDefinition || typeof v.simpleDefinition !== 'string' || isGenericPedagogicalDefinition(v.simpleDefinition)) {
        return { valid: false, reason: `AI provided generic or missing simpleDefinition for: "${v?.term || 'item'}"` };
      }
    }
  }

  // Reject synthetic fixture vocabulary when notes had zero vocabulary items
  if (!hasNewWords && !hasPronounce && !hasUntaggedVocab) {
    for (const v of vocabList) {
      const termLower = String(v?.term || '').toLowerCase().trim();
      if (termLower === 'catch up' || termLower === 'workload' || termLower === 'streamline' || termLower === 'make sense') {
        return { valid: false, reason: 'AI inserted synthetic vocabulary when notes had no vocabulary items' };
      }
    }
  }

  // 4. Validate Part 2 (Grammar Points): reject canned synthetic rules when notes had no errors
  const grammar = Array.isArray(parsed.grammarPoints) ? parsed.grammarPoints : [];
  if (!hasErrors && mistakes.length === 0 && grammar.length > 0) {
    for (const g of grammar) {
      const topicLower = String(g?.topic || '').toLowerCase();
      if (topicLower.includes('agree') || topicLower.includes('age') || topicLower.includes('to be')) {
        return { valid: false, reason: 'AI inserted synthetic grammar rules when notes had no errors' };
      }
    }
  }

  // 5. Validate Part 4 (5–10 Minute Review Summary)
  if (!parsed.reviewSummary || typeof parsed.reviewSummary !== 'object' || Array.isArray(parsed.reviewSummary)) {
    parsed.reviewSummary = {
      estimatedMinutes: '5–10 minutes',
      keyRules: [],
      mustKnowVocabulary: [],
      essentialCorrections: [],
      usefulPatterns: [],
      rememberThis: '',
    };
  }
  if (!Array.isArray(parsed.reviewSummary.usefulPatterns)) {
    parsed.reviewSummary.usefulPatterns = [];
  }

  const cleanRememberThis = typeof parsed.reviewSummary.rememberThis === 'string'
    ? parsed.reviewSummary.rememberThis.trim()
    : '';

  if (cleanRememberThis.length < 5) {
    if (mistakes.length > 0 && mistakes[0].original && mistakes[0].corrected && !mistakes[0].isPendingConfirmation) {
      parsed.reviewSummary.rememberThis = `Remember this: Instead of saying "${mistakes[0].original}", say "${mistakes[0].corrected}"! Consistent small shifts in your active speaking build lasting fluency.`;
    } else if (vocabList.length > 0 && vocabList[0].term) {
      parsed.reviewSummary.rememberThis = `Remember this: Practice using "${vocabList[0].term}" naturally in your everyday conversations!`;
    } else {
      parsed.reviewSummary.rememberThis = 'Remember this: Fluency grows by recognizing natural patterns and practicing them out loud!';
    }
  }

  return { valid: true };
}

/**
 * Detects whether a transformation contains legacy synthetic/generic content,
 * artificial placeholders, or fabricated items not present in the teacher notes.
 * 
 * FASE NF-NOTES.8:
 * - Does NOT classify legitimate vocabulary (e.g. "streamline", "catch up") as generic if present in notes.
 * - Does NOT presume fictitious content when raw notes are absent; relies on verifiable synthetic evidence.
 */
export function isLegacyGenericTransformation(
  transformation: any,
  rawNotesOrMarkings?: string | ParsedNotesResult
): boolean {
  if (!transformation || typeof transformation !== 'object') return true;

  // 1. Explicit provisional/fallback flags
  if (transformation.isFallback || transformation.isProvisional || !transformation.isAiGenerated) {
    return true;
  }

  // Determine note context from parameter or embedded snippet
  const rawNoteContext = rawNotesOrMarkings || transformation.rawNotesSnippet;
  const rawText = rawNoteContext
    ? (typeof rawNoteContext === 'string' ? rawNoteContext.toLowerCase() : (rawNoteContext.cleanText || '').toLowerCase())
    : undefined;

  // 2. Check mistakesAnalysis for synthetic boilerplate
  const mistakes = Array.isArray(transformation.mistakesAnalysis) ? transformation.mistakesAnalysis : [];
  const CANNED_MISTAKES = [
    'i have 28 years old',
    "i'm agree with you",
    'it depends of the day',
    'it depends of the weather',
    'can i make a question?',
    'can i make a question',
  ];
  let cannedMistakesCount = 0;

  for (const m of mistakes) {
    if (m?.isPendingConfirmation) return true;
    const orig = String(m?.original || '').toLowerCase().trim();
    const corr = String(m?.corrected || '').toLowerCase().trim();
    if (
      corr.includes('pending confirmation') ||
      corr.includes('pendente de confirmação')
    ) {
      return true;
    }

    if (CANNED_MISTAKES.includes(orig)) {
      if (rawText !== undefined) {
        if (!rawText.includes(orig)) {
          return true; // Fabricated error not present in available teacher notes
        }
      } else {
        cannedMistakesCount++;
      }
    }

    const examples = Array.isArray(m?.twoExamples) ? m.twoExamples : (Array.isArray(m?.examples) ? m.examples : []);
    for (const ex of examples) {
      if (typeof ex === 'string' && isGenericPedagogicalExample(ex)) {
        return true;
      }
    }
  }

  // If raw notes are missing, only reject if multiple canned fixture mistakes appear together
  if (rawText === undefined && cannedMistakesCount >= 2) {
    return true;
  }

  // 3. Check vocabularyAndExpressions for generic definitions and examples
  const vocab = Array.isArray(transformation.vocabularyAndExpressions) ? transformation.vocabularyAndExpressions : [];
  const SUSPICIOUS_FIXTURE_TERMS = ['catch up', 'workload', 'streamline', 'make sense', 'get the hang of'];
  let suspiciousFixtureTermsCount = 0;

  for (const v of vocab) {
    const term = String(v?.term || '').toLowerCase().trim();
    if (SUSPICIOUS_FIXTURE_TERMS.includes(term)) {
      if (rawText !== undefined) {
        if (!rawText.includes(term)) {
          return true; // Suspicious term not present in actual teacher notes
        }
      } else {
        suspiciousFixtureTermsCount++;
      }
    }

    // Verifiable evidence of synthetic content: generic definition templates
    if (v.definitionEn && isGenericPedagogicalDefinition(v.definitionEn)) {
      return true;
    }
    if (v.simpleDefinition && isGenericPedagogicalDefinition(v.simpleDefinition)) {
      return true;
    }

    // Verifiable evidence of synthetic content: generic example templates
    const examples = Array.isArray(v.realExamples) ? v.realExamples : [];
    for (const ex of examples) {
      if (typeof ex === 'string' && isGenericPedagogicalExample(ex)) {
        return true;
      }
    }
  }

  // When raw notes context is completely absent, reject if >= 3 canned terms occur together (the fixture footprint)
  if (rawText === undefined && suspiciousFixtureTermsCount >= 3) {
    return true;
  }

  // 4. Check grammarPoints: if rawNotes had no errors, but grammarPoints has synthetic points
  const grammar = Array.isArray(transformation.grammarPoints) ? transformation.grammarPoints : [];
  if (rawNoteContext) {
    const markings = typeof rawNoteContext === 'string'
      ? parseNotesHtml(rawNoteContext)
      : rawNoteContext;
    if (markings.errors.length === 0 && grammar.length > 0) {
      const hasAgree = grammar.some((g: any) => /agree/i.test(g?.topic || ''));
      const hasAge = grammar.some((g: any) => /age/i.test(g?.topic || '') || /to be/i.test(g?.topic || ''));
      const hasPrep = grammar.some((g: any) => /preposition/i.test(g?.topic || ''));
      if (hasAgree || hasAge || hasPrep) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Resolves a canonical session key ensuring teacher and student access the identical identifier.
 */
export function getCanonicalSessionKey(params: {
  lessonId?: string;
  sessionKey?: string;
  id?: string;
  studentUid?: string;
  studentEmail?: string;
  sessionDate?: string;
}): string {
  const custom = (params.sessionKey || params.id || '').trim();
  const rawLessonId = (params.lessonId || '').trim();
  if (rawLessonId) {
    const cleanId = rawLessonId.replace(/^lesson_/, '');
    return `lesson_${cleanId}`;
  }
  if (custom) {
    if (custom.startsWith('lesson_')) {
      const cleanId = custom.replace(/^lesson_+/, '');
      return `lesson_${cleanId}`;
    }
    return custom;
  }
  const cleanEmail = (params.studentEmail || '').toLowerCase().trim();
  const cleanUid = (params.studentUid || '').trim();
  const idPart = (cleanUid || cleanEmail).replace(/[^a-zA-Z0-9_-]/g, '_');
  const datePart = (params.sessionDate || new Date().toISOString().split('T')[0]).slice(0, 10);
  return `session_${datePart}_${idPart || 'student'}`;
}

/**
 * Maps app level to standardized CEFR code and metadata
 */
export function resolveCefrLevel(level?: EnglishLevel | string): {
  cefr: 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';
  labelEn: string;
  labelPt: string;
} {
  const norm = String(level || '').toLowerCase().trim();
  if (norm.includes('c2') || norm.includes('c1') || norm.includes('avancado') || norm.includes('advanced')) {
    return { cefr: 'C1', labelEn: 'Advanced (C1-C2)', labelPt: 'Avançado (C1-C2)' };
  }
  if (norm.includes('b2') || norm.includes('upper')) {
    return { cefr: 'B2', labelEn: 'Upper-Intermediate (B2)', labelPt: 'Intermediário Superior (B2)' };
  }
  if (norm.includes('b1') || norm.includes('intermediario') || norm.includes('intermediate')) {
    return { cefr: 'B1', labelEn: 'Intermediate (B1-B2)', labelPt: 'Intermediário (B1-B2)' };
  }
  if (norm.includes('a2') || norm.includes('elementary')) {
    return { cefr: 'A2', labelEn: 'Elementary (A2)', labelPt: 'Elementar (A2)' };
  }
  return { cefr: 'A1', labelEn: 'Beginner (A1-A2)', labelPt: 'Iniciante (A1-A2)' };
}

/**
 * Extracts and categorizes markings from teacher notes:
 * Re-exports results using the robust notesHtmlParser.
 */
export function extractNotesMarkings(rawContent: string): ParsedNotesResult {
  return parseNotesHtml(rawContent);
}

/**
 * Robust, pedagogical fallback generator that deterministically constructs
 * all 4 required sections strictly based on CEFR level and real detected markers.
 * NEVER inserts mocked items (no "I have 28 years old", no "catch up", no fake grammar rules).
 */
export function generateLocalPedagogicalTransformation(params: {
  rawNotes: string;
  topic?: string;
  sessionDate?: string;
  teacherName?: string;
  studentLevel?: EnglishLevel | string;
  studentUid?: string;
  studentEmail?: string;
  lessonId?: string;
  sessionKey?: string;
  language?: string;
  includeHypotheticalExamples?: boolean;
}): PedagogicalLessonTransformation {
  const {
    rawNotes,
    topic = 'General Conversation & Fluency',
    sessionDate = new Date().toISOString().split('T')[0],
    teacherName = 'Native Friend',
    studentLevel = EnglishLevel.INTERMEDIATE,
    studentUid,
    studentEmail,
    lessonId,
    sessionKey: customSessionKey,
    language = 'pt',
    includeHypotheticalExamples = false,
  } = params;

  const cleanLang = (language || 'pt').toLowerCase().trim();
  const markings = parseNotesHtml(rawNotes);
  const cefrMeta = resolveCefrLevel(studentLevel);
  const contentHash = computeNotesHash(rawNotes);

  const sessionKey = getCanonicalSessionKey({
    lessonId,
    sessionKey: customSessionKey,
    studentUid,
    studentEmail,
    sessionDate,
  });

  // 1. Build Section 1: Mistakes Analysis (Strictly from real teacher markings)
  // Zero canned fallback corrections, zero pre-fabricated AI explanations, zero invented examples.
  const mistakesAnalysis: PedagogicalMistakeAnalysis[] = [];
  const processedSignatures = new Set<string>();

  for (const err of markings.errors) {
    const rawOrig = (err.original || '').trim();
    if (!rawOrig || processedSignatures.has(rawOrig.toLowerCase())) continue;
    processedSignatures.add(rawOrig.toLowerCase());

    const cleanCorr = (err.corrected || (rawOrig.includes('->') ? rawOrig.split('->')[1].trim() : '')).trim();
    const isUnconfirmed = err.isPendingConfirmation || !cleanCorr;

    if (isUnconfirmed) {
      const pendingText = getPendingConfirmationText(cleanLang);
      mistakesAnalysis.push({
        id: `mistake-${mistakesAnalysis.length + 1}`,
        original: rawOrig,
        corrected: pendingText,
        category: 'phrasing',
        explanation: getUnconfirmedExplanationText(rawOrig, cleanLang),
        twoExamples: [],
        commonPitfalls: getPendingPitfallsText(cleanLang),
        isPendingConfirmation: true,
      });
    } else {
      mistakesAnalysis.push({
        id: `mistake-${mistakesAnalysis.length + 1}`,
        original: rawOrig,
        corrected: cleanCorr,
        category: 'phrasing',
        explanation: err.context && err.context !== rawOrig ? err.context : '',
        twoExamples: [],
        commonPitfalls: '',
        isPendingConfirmation: false,
      });
    }
  }

  // 2. Build Section 2: Teach Grammar Points
  // In local fallback mode without a validated Gemini response:
  // Zero pre-fabricated grammar points, zero canned rules, zero synthetic examples!
  const grammarPoints: PedagogicalGrammarPoint[] = [];

  // 3. Build Section 3: Teach Vocabulary and Expressions
  // Strictly mapped from Alt+W and Alt+P markings recorded by the teacher.
  // Zero canned database lookups or artificial definitions/examples pretending to be AI!
  const vocabularyAndExpressions: PedagogicalVocabularyItem[] = [];
  const candidateVocab = [...markings.newWords, ...markings.pronounceItems, ...markings.vocabItems];
  const seenVocabTerms = new Set<string>();

  candidateVocab.forEach((item) => {
    const rawTrimmed = item.trim();
    const cleanWord = rawTrimmed.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim();
    if (!cleanWord || seenVocabTerms.has(cleanWord)) return;
    seenVocabTerms.add(cleanWord);

    const isPronounce = markings.pronounceItems.some(
      (p) => p.toLowerCase().trim() === cleanWord || cleanWord.includes(p.toLowerCase().trim())
    );

    const isNewWord = markings.newWords.some(
      (w) => w.toLowerCase().trim() === cleanWord || cleanWord.includes(w.toLowerCase().trim())
    );

    vocabularyAndExpressions.push({
      id: `vocab-${vocabularyAndExpressions.length + 1}`,
      term: rawTrimmed,
      cefrLevel: cefrMeta.cefr,
      partOfSpeech: isPronounce
        ? 'Pronunciation Focus'
        : cleanWord.includes(' ')
        ? 'Expression'
        : 'Vocabulary Item',
      simpleDefinition: isPronounce
        ? (cleanLang === 'pt' ? `Foco em pronúncia anotado pelo professor na sessão: "${rawTrimmed}".` : `Teacher session pronunciation focus: "${rawTrimmed}".`)
        : (cleanLang === 'pt' ? `Vocabulário anotado pelo professor na sessão: "${rawTrimmed}".` : `Teacher session vocabulary: "${rawTrimmed}".`),
      collocations: [],
      realExamples: [],
      synonyms: [],
      register: 'neutral' as const,
      category: isPronounce
        ? 'Pronunciation & Phonetics (Alt+P)'
        : isNewWord
        ? 'New Words & Expressions (Alt+W)'
        : 'Core Session Vocabulary',
      phoneticGuide: isPronounce
        ? `🎯 Pronunciation focus: practice clean syllable stress on "${rawTrimmed}".`
        : undefined,
      isPronunciationFocus: isPronounce,
      isNewWord: isNewWord,
      isProvisional: true,
      isFallback: true,
    });
  });

  // CEFR Level Adaptation metadata (Faithful review notice)
  const levelAdaptation: PedagogicalLevelAdaptation = {
    cefrLevel: cefrMeta.cefr,
    levelLabel: cefrMeta.labelEn,
    nativeInterferenceNotes:
      cleanLang === 'pt'
        ? `Revisão direta baseada nas anotações da aula para o nível CEFR ${cefrMeta.cefr}.`
        : `Direct review based on session teacher notes for CEFR level ${cefrMeta.cefr}.`,
    complexityAdjustmentAdvice:
      cleanLang === 'pt'
        ? 'Revise os itens marcados pelo professor antes da sua próxima aula.'
        : 'Review teacher-marked items before your next live session.',
    targetedPracticePrompt: `Practice using the expressions from "${topic}".`,
  };

  // 4. Build Section 4: 5-10 Minute Quick Review Summary
  // Strictly reflects teacher markings without invented key rules or fake rules
  const rememberThis =
    mistakesAnalysis.length > 0 && !mistakesAnalysis[0].isPendingConfirmation && mistakesAnalysis[0].corrected
      ? (cleanLang === 'pt'
          ? `Lembre-se disto: Em vez de "${mistakesAnalysis[0].original}", prefira "${mistakesAnalysis[0].corrected}".`
          : `Remember this: Instead of saying "${mistakesAnalysis[0].original}", say "${mistakesAnalysis[0].corrected}".`)
      : vocabularyAndExpressions.length > 0
      ? (cleanLang === 'pt'
          ? `Lembre-se disto: Revise as anotações do professor para fixar o vocabulário da sessão.`
          : `Remember this: Review your teacher notes to reinforce the vocabulary from this session.`)
      : (cleanLang === 'pt'
          ? `Lembre-se disto: A prática consistente desenvolve naturalidade e confiança na fala!`
          : `Remember this: Consistent speaking practice builds natural conversational confidence!`);

  const reviewSummary: PedagogicalReviewSummary = {
    estimatedMinutes: '3–5 minutes',
    keyRules: grammarPoints.map((gp) => `${gp.topic}: ${gp.rule}`),
    mustKnowVocabulary: vocabularyAndExpressions.map((v) => {
      const tag = v.isPronunciationFocus ? '🎯 [Pronounce]' : '✨';
      return `${tag} ${v.term}`;
    }),
    essentialCorrections: mistakesAnalysis.map((m) => ({
      original: m.original,
      corrected: m.corrected,
      explanation: m.explanation,
    })),
    rememberThis,
  };

  return {
    lessonId,
    sessionKey,
    sessionDate,
    topic,
    teacherName,
    teacherEmail: undefined,
    studentUid,
    studentEmail,
    studentLevel: String(studentLevel),
    cefrLevel: cefrMeta.cefr,
    contentHash,
    language: cleanLang,
    promptVersion: PEDAGOGICAL_PROMPT_VERSION,
    isAiGenerated: false,
    isFallback: true,
    isProvisional: true,
    fallbackReason: 'AI_UNAVAILABLE',
    source: 'fallback',
    aiNotice: getAiUnavailableNoticeText(cleanLang),
    mistakesAnalysis,
    grammarPoints,
    vocabularyAndExpressions,
    levelAdaptation,
    reviewSummary,
    rawNotesSnippet: markings.cleanText.slice(0, 300),
    correctStampsCount: markings.correctCount,
    incorrectStampsCount: markings.incorrectCount,
    newWordStampsCount: markings.newWordCount,
    pronounceStampsCount: markings.pronounceCount,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Service to fetch or generate the pedagogical transformation for a session note.
 * Tries server-side Gemini AI generation first, falling back gracefully to local pedagogical synthesizer.
 */
export async function fetchPedagogicalTransformation(params: {
  rawNotes: string;
  topic?: string;
  sessionDate?: string;
  teacherName?: string;
  studentLevel?: EnglishLevel | string;
  studentUid?: string;
  studentEmail?: string;
  lessonId?: string;
  sessionKey?: string;
  language?: string;
  forceRegenerate?: boolean;
  triggerAiIfMissing?: boolean;
}): Promise<PedagogicalLessonTransformation> {
  const {
    rawNotes,
    topic = 'Daily Conversation & Fluency',
    sessionDate = new Date().toISOString().split('T')[0],
    teacherName = 'Native Friend',
    studentLevel = EnglishLevel.INTERMEDIATE,
    studentUid,
    studentEmail,
    lessonId,
    sessionKey,
    language = 'pt',
    forceRegenerate = false,
    triggerAiIfMissing = false,
  } = params;

  try {
    const currentAuth = auth?.currentUser;
    const token = await currentAuth?.getIdToken().catch(() => null);
    const authUid = currentAuth?.uid || '';
    const isAuthCanonical = Boolean(authUid && !authUid.includes('@') && !authUid.startsWith('usr-') && !authUid.startsWith('st-'));
    const isParamCanonical = Boolean(studentUid && !studentUid.includes('@') && !studentUid.startsWith('usr-') && !studentUid.startsWith('st-'));
    const effectiveUid = isAuthCanonical ? authUid : (isParamCanonical ? studentUid!.trim() : '');

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const effectiveKey = sessionKey || lessonId || '';
    const contentHash = computeNotesHash(rawNotes);

    // Security Hotfix (Etapa 2 & FASE 4B.9): If not an explicit regeneration, check server cache first!
    if (!forceRegenerate && effectiveKey) {
      try {
        const cacheUrl = `/api/pedagogical-notes?sessionKey=${encodeURIComponent(effectiveKey)}&language=${encodeURIComponent(language)}&contentHash=${encodeURIComponent(contentHash)}${lessonId ? `&lessonId=${encodeURIComponent(lessonId)}` : ''}${effectiveUid ? `&studentUid=${encodeURIComponent(effectiveUid)}` : ''}`;
        const cacheRes = await fetch(cacheUrl, { headers });

        if (cacheRes.status === 401 || cacheRes.status === 403) {
          const authMsg = cacheRes.status === 401
            ? 'Faça login com sua conta de estudante para acessar o relatório pedagógico.'
            : 'Acesso negado: você não tem permissão para visualizar as anotações desta aula.';
          return {
            sessionKey: effectiveKey,
            sessionDate,
            topic,
            studentLevel,
            cefrLevel: 'B1',
            mistakesAnalysis: [],
            grammarPoints: [],
            vocabularyAndExpressions: [],
            reviewSummary: {
              estimatedMinutes: '0 min',
              keyRules: [],
              mustKnowVocabulary: [],
              essentialCorrections: [],
              rememberThis: authMsg,
            },
            correctStampsCount: 0,
            incorrectStampsCount: 0,
            generatedAt: new Date().toISOString(),
            isFallback: true,
            isProvisional: true,
            authError: {
              status: cacheRes.status,
              message: authMsg,
              requiresLogin: cacheRes.status === 401,
            },
          };
        }

        if (cacheRes.ok) {
          const cachedData = await cacheRes.json();
          if (
            cachedData &&
            typeof cachedData === 'object' &&
            !Array.isArray(cachedData) &&
            cachedData.sessionKey &&
            cachedData.isAiGenerated &&
            !cachedData.isProvisional &&
            !isLegacyGenericTransformation(cachedData, rawNotes)
          ) {
            return cachedData;
          }
        }
      } catch (cacheErr) {
        console.warn('Pedagogical cache lookup notice:', cacheErr);
      }

      // If no valid cache exists and triggerAiIfMissing is FALSE (e.g. background reminder check or page load):
      // Return deterministic local notes flagged as provisional preview. DO NOT trigger Gemini!
      if (!triggerAiIfMissing) {
        const provisional = generateLocalPedagogicalTransformation({
          rawNotes,
          topic,
          sessionDate,
          teacherName,
          studentLevel,
          studentUid,
          studentEmail,
          lessonId,
          sessionKey,
          language,
        });
        provisional.isFallback = true;
        provisional.isProvisional = true;
        provisional.isAiGenerated = false;
        provisional.needsAiGeneration = true;
        provisional.aiNotice = language === 'en'
          ? 'Preliminary teacher-faithful guide. Open notes to synthesize masterclass analysis.'
          : 'Guia preliminar fiel às anotações do professor. Abra as notas para sintetizar a análise pedagógica com Gemini.';
        return provisional;
      }
    }

    // On-demand generation request (student opening notes or forceRegenerate):
    const res = await fetch('/api/pedagogical-notes/transform', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        rawNotes,
        topic,
        sessionDate,
        teacherName,
        studentLevel,
        studentUid: effectiveUid || undefined,
        studentEmail,
        lessonId,
        sessionKey,
        language,
        forceRegenerate,
      }),
    });

    if (res.status === 401 || res.status === 403) {
      const authMsg = res.status === 401
        ? 'Faça login com sua conta de estudante para gerar ou visualizar o relatório pedagógico.'
        : 'Acesso negado: você não tem permissão para visualizar as anotações desta aula.';
      return {
        sessionKey: effectiveKey,
        sessionDate,
        topic,
        studentLevel,
        cefrLevel: 'B1',
        mistakesAnalysis: [],
        grammarPoints: [],
        vocabularyAndExpressions: [],
        reviewSummary: {
          estimatedMinutes: '0 min',
          keyRules: [],
          mustKnowVocabulary: [],
          essentialCorrections: [],
          rememberThis: authMsg,
        },
        correctStampsCount: 0,
        incorrectStampsCount: 0,
        generatedAt: new Date().toISOString(),
        isFallback: true,
        isProvisional: true,
        authError: {
          status: res.status,
          message: authMsg,
          requiresLogin: res.status === 401,
        },
      };
    }

    if (res.ok) {
      const data = await res.json();
      if (data && data.transformation && Array.isArray(data.transformation.mistakesAnalysis)) {
        if (!isLegacyGenericTransformation(data.transformation, rawNotes)) {
          return data.transformation;
        }
      }
    }
  } catch (err) {
    console.warn('Backend pedagogical transform request notice:', (err as any)?.message || 'NETWORK_FAILURE');
  }

  // Graceful deterministic fallback strictly faithful to raw notes
  const fallback = generateLocalPedagogicalTransformation({
    rawNotes,
    topic,
    sessionDate,
    teacherName,
    studentLevel,
    studentUid,
    studentEmail,
    lessonId,
    sessionKey,
    language,
  });
  fallback.isFallback = true;
  fallback.isProvisional = true;
  fallback.isAiGenerated = false;
  return fallback;
}
