import {
  WeeklyHomeworkData,
  UserProfile,
  RoutineItem,
  DayOfWeek,
  HomeworkVocabItem,
  MatchingPair,
  FillInBlankItem,
  SentenceWritingPrompt,
  ReadingQuestion,
  ReadingPassage,
} from '../types';
import { getActivityDisplayName } from './i18n';
import {
  synthesizeCohesiveStoryAndQuestions,
  synthesizeFillInBlanks,
  profileWord,
} from './pedagogicalStorySynthesizer';

// Rich dictionary knowledge base for routine words
const ROUTINE_VOCAB_DICT: Record<
  string,
  { translationPt: string; definitionEn: string; exampleSentence: string }
> = {
  brew: {
    translationPt: 'Preparar / Fazer infusão (café ou chá)',
    definitionEn: 'To make a hot drink like tea or coffee by soaking ingredients in boiling water.',
    exampleSentence: 'I brew fresh coffee every morning to start my routine.',
  },
  pour: {
    translationPt: 'Despejar / Servir líquido',
    definitionEn: 'To cause a liquid to flow from a container into another vessel.',
    exampleSentence: 'She poured hot milk into her morning mug.',
  },
  mug: {
    translationPt: 'Caneca',
    definitionEn: 'A large cup with a handle, used typically for hot drinks.',
    exampleSentence: 'I drink warm green tea from my favorite ceramic mug.',
  },
  toast: {
    translationPt: 'Torrada / Pão torrado',
    definitionEn: 'Sliced bread made crisp and brown by heat.',
    exampleSentence: 'He spreads creamy butter over hot breakfast toast.',
  },
  'scrambled eggs': {
    translationPt: 'Ovos mexidos',
    definitionEn: 'Eggs beaten with milk or water and cooked gently until firm.',
    exampleSentence: 'Scrambled eggs are a nutritious breakfast staple.',
  },
  skillet: {
    translationPt: 'Frigideira',
    definitionEn: 'A small flat-bottomed pan with a long handle used for frying food.',
    exampleSentence: 'He heated butter in the skillet before adding eggs.',
  },
  sip: {
    translationPt: 'Dar um gole / Beber em pequenos goles',
    definitionEn: 'To drink something by taking small mouthfuls.',
    exampleSentence: 'I take a slow sip of hot coffee while checking the morning news.',
  },
  aroma: {
    translationPt: 'Aroma / Cheiro agradável',
    definitionEn: 'A pleasant, distinctive smell, especially of food or coffee.',
    exampleSentence: 'The rich aroma of roasted coffee filled the entire kitchen.',
  },
  commute: {
    translationPt: 'Deslocamento diário / Trajeto',
    definitionEn: 'Travel some distance regularly between home and place of work.',
    exampleSentence: 'My morning commute is a great time to listen to English podcasts.',
  },
  subway: {
    translationPt: 'Metrô',
    definitionEn: 'An underground electric railroad system in a city.',
    exampleSentence: 'I take the subway to downtown every weekday morning.',
  },
  transit: {
    translationPt: 'Transporte público / Trânsito',
    definitionEn: 'The carrying of people from one place to another on public conveyances.',
    exampleSentence: 'Public transit is fast and environmentally friendly.',
  },
  meeting: {
    translationPt: 'Reunião de trabalho',
    definitionEn: 'An assembly of people for discussion or all-hands collaboration.',
    exampleSentence: 'We held a productive 30-minute status meeting with the team.',
  },
  deadline: {
    translationPt: 'Prazo limite de entrega',
    definitionEn: 'The latest time or date by which something should be completed.',
    exampleSentence: 'Meeting our project deadline required strong team focus.',
  },
  schedule: {
    translationPt: 'Cronograma / Agenda diária',
    definitionEn: 'A plan that gives a list of events or tasks and the times they will happen.',
    exampleSentence: 'I review my daily schedule every morning over coffee.',
  },
  email: {
    translationPt: 'E-mail / Correio eletrônico',
    definitionEn: 'Messages distributed by electronic means from one computer user to others.',
    exampleSentence: 'I responded to priority client emails before lunch.',
  },
  lunch: {
    translationPt: 'Almoço',
    definitionEn: 'A meal eaten in the middle of the day.',
    exampleSentence: 'We had a healthy lunch with fresh salad and grilled chicken.',
  },
  workout: {
    translationPt: 'Treino / Exercício físico',
    definitionEn: 'A session of vigorous physical exercise or training.',
    exampleSentence: 'A 45-minute workout keeps both body and mind sharp.',
  },
  treadmill: {
    translationPt: 'Esteira ergométrica',
    definitionEn: 'An exercise machine on which one walks or runs while remaining in one place.',
    exampleSentence: 'She completed a brisk 20-minute run on the treadmill.',
  },
  stretch: {
    translationPt: 'Alongar-se / Alongamento',
    definitionEn: 'To straighten or extend one\'s body or limbs to improve flexibility.',
    exampleSentence: 'It feels great to stretch after a long day at the desk.',
  },
  relax: {
    translationPt: 'Relaxar / Descansar',
    definitionEn: 'To rest from work or engage in an enjoyable peaceful activity.',
    exampleSentence: 'In the evening, I relax by reading a book with soothing music.',
  },
  unwind: {
    translationPt: 'Descontrair / Desacelerar',
    definitionEn: 'To relax after a period of work or tension.',
    exampleSentence: 'Drinking chamomile tea helps me unwind before bed.',
  },
  journal: {
    translationPt: 'Diário de reflexão / Anotações',
    definitionEn: 'A daily record of personal experiences, thoughts, and reflections.',
    exampleSentence: 'Writing in my English journal locks in my daily vocabulary.',
  },
  progress: {
    translationPt: 'Progresso / Evolução contínua',
    definitionEn: 'Forward or onward movement toward a goal or higher proficiency.',
    exampleSentence: 'Every small daily routine action creates immense speaking progress.',
  },
  today: {
    translationPt: 'Hoje / No dia de hoje',
    definitionEn: 'The present day, or this current 24-hour period.',
    exampleSentence: 'We need to finish our priority client tasks today before leaving.',
  },
  tomorrow: {
    translationPt: 'Amanhã / No dia seguinte',
    definitionEn: 'The day that comes immediately after today.',
    exampleSentence: 'Let us reschedule our project review for tomorrow morning.',
  },
  project: {
    translationPt: 'Projeto / Trabalho estruturado',
    definitionEn: 'A collaborative effort or set of tasks planned to achieve a goal.',
    exampleSentence: 'Our team completed the software project ahead of the deadline.',
  },
  piece: {
    translationPt: 'Peça / Parte / Documento',
    definitionEn: 'A distinct portion, document, or element of a larger whole.',
    exampleSentence: 'Writing the executive summary is the final piece of the proposal.',
  },
  task: {
    translationPt: 'Tarefa / Atividade a cumprir',
    definitionEn: 'A specific piece of work to be done or undertaken.',
    exampleSentence: 'I focus on one challenging task at a time to stay productive.',
  },
  coffee: {
    translationPt: 'Café',
    definitionEn: 'A hot aromatic beverage brewed from roasted coffee beans.',
    exampleSentence: 'I enjoy a warm cup of coffee while reviewing my morning schedule.',
  },
};

export const DAYS_OF_WEEK: DayOfWeek[] = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
];

export interface DailyMemorizationScheduleInfo {
  day: DayOfWeek;
  dayIndexInWeek: number;
  overallDayIndex: number;
  partNumber: 1 | 2 | 3 | 4;
  partKey: 'matching' | 'fill' | 'writing' | 'reading';
  partTitlePt: string;
  partTitleEn: string;
  partDescPt: string;
  partDescEn: string;
}

export const PART_KEY_BY_NUMBER: Record<1 | 2 | 3 | 4, 'matching' | 'fill' | 'writing' | 'reading'> = {
  1: 'matching',
  2: 'fill',
  3: 'writing',
  4: 'reading',
};

export const PART_INFO: Record<
  1 | 2 | 3 | 4,
  {
    partKey: 'matching' | 'fill' | 'writing' | 'reading';
    titlePt: string;
    titleEn: string;
    descPt: string;
    descEn: string;
  }
> = {
  1: {
    partKey: 'matching',
    titlePt: 'Parte 1: Associação de Vocabulário',
    titleEn: 'Part 1: Vocabulary Matching',
    descPt: 'Associe as palavras do dia ao seu significado em inglês e tradução.',
    descEn: 'Match today’s vocabulary to definitions and translations.',
  },
  2: {
    partKey: 'fill',
    titlePt: 'Parte 2: Preenchimento de Lacunas',
    titleEn: 'Part 2: Fill in the Blanks',
    descPt: 'Complete as frases contextuais usando as palavras do dia.',
    descEn: 'Complete contextual sentences using today’s active words.',
  },
  3: {
    partKey: 'writing',
    titlePt: 'Parte 3: Construção de Frases Ativas',
    titleEn: 'Part 3: Sentence Writing',
    descPt: 'Crie frases autênticas com as palavras aprendidas hoje e receba feedback.',
    descEn: 'Build authentic sentences with today’s words and get instant feedback.',
  },
  4: {
    partKey: 'reading',
    titlePt: 'Parte 4: Texto Integrado & Interpretação',
    titleEn: 'Part 4: Integrated Reading & Comprehension',
    descPt: 'Leia uma pequena história integrando as palavras do dia e responda às questões.',
    descEn: 'Read a short integrated story with today’s words and answer questions.',
  },
};

export function getDailyMemorizationSchedule(
  day: DayOfWeek,
  activeStudyDays?: DayOfWeek[],
  weeklyCycle: number = 1
): DailyMemorizationScheduleInfo {
  const activeList =
    Array.isArray(activeStudyDays) && activeStudyDays.length > 0
      ? DAYS_OF_WEEK.filter((d) => activeStudyDays.includes(d))
      : DAYS_OF_WEEK;

  const N = Math.max(1, activeList.length);
  const cycle = Math.max(1, weeklyCycle);

  let dayIndexInWeek = activeList.indexOf(day);
  if (dayIndexInWeek === -1) {
    // If it's a rest day outside activeStudyDays, map cyclically based on calendar position
    dayIndexInWeek = DAYS_OF_WEEK.indexOf(day) % N;
  }

  const priorDays = (cycle - 1) * N;
  const overallDayIndex = priorDays + dayIndexInWeek;
  const partNumber = (((overallDayIndex % 4) + 1) as 1 | 2 | 3 | 4);
  const info = PART_INFO[partNumber];

  return {
    day,
    dayIndexInWeek,
    overallDayIndex,
    partNumber,
    partKey: info.partKey,
    partTitlePt: info.titlePt,
    partTitleEn: info.titleEn,
    partDescPt: info.descPt,
    partDescEn: info.descEn,
  };
}

const DAY_LABELS_PT: Record<DayOfWeek, string> = {
  monday: 'Segunda-feira',
  tuesday: 'Terça-feira',
  wednesday: 'Quarta-feira',
  thursday: 'Quinta-feira',
  friday: 'Sexta-feira',
  saturday: 'Sábado',
  sunday: 'Domingo',
};

const DAY_LABELS_EN: Record<DayOfWeek, string> = {
  monday: 'Monday',
  tuesday: 'Tuesday',
  wednesday: 'Wednesday',
  thursday: 'Thursday',
  friday: 'Friday',
  saturday: 'Saturday',
  sunday: 'Sunday',
};

/**
 * Classify an entry as Native Friend vocabulary:
 * entry.source === 'live_lesson'
 * OR (for legacy compatibility only) sourceActivityName contains:
 * - "Native Friends Notes"
 * - "Live Session"
 */
export function isNativeFriendVocabulary(entry: {
  source?: string;
  sourceActivityName?: string;
}): boolean {
  if (entry?.source === 'live_lesson') return true;
  const act = entry?.sourceActivityName || '';
  if (act.includes('Native Friends Notes') || act.includes('Live Session')) {
    return true;
  }
  return false;
}

/**
 * Phase 1B: Build the deterministic Daily Memorization Queue (max 5 words).
 *
 * FIRST PRIORITY:
 * Native Friend words never practiced:
 * practiceCount missing/0 OR lastPracticedAt missing.
 * Sort oldest first using best existing timestamp: learnedAt first, with stable fallback.
 *
 * SECOND PRIORITY:
 * Student/My Words never practiced.
 * Sort oldest first using the same deterministic strategy.
 * Fill until reaching 5 total.
 *
 * If fewer than 5 never-practiced words exist, fill remaining slots from previously practiced vocabulary:
 * - prioritize Native Friend vocabulary,
 * - then Student vocabulary,
 * and within each category select the LEAST RECENTLY PRACTICED first using lastPracticedAt.
 *
 * Deterministic tie-breaking (learnedAt, then normalized word/id).
 * No random selection.
 * No newest-first selection.
 * No duplicate normalized words.
 * Absolute maximum = 5.
 */
export function buildDailyMemorizationQueue(
  candidates: HomeworkVocabItem[]
): HomeworkVocabItem[] {
  // 1. Deduplicate by normalized word (word.trim().toLowerCase())
  const uniqueMap = new Map<string, HomeworkVocabItem>();
  for (const item of candidates) {
    if (!item || !item.word || !item.word.trim()) continue;
    const norm = item.word.trim().toLowerCase();
    const existing = uniqueMap.get(norm);
    if (!existing) {
      uniqueMap.set(norm, { ...item, word: item.word.trim() });
    } else {
      // Merge metadata preferring existing with richer details
      uniqueMap.set(norm, {
        ...existing,
        id: existing.id || item.id,
        source: existing.source || item.source,
        sourceActivityName: existing.sourceActivityName || item.sourceActivityName,
        learnedAt: existing.learnedAt || item.learnedAt,
        practiceCount:
          existing.practiceCount !== undefined ? existing.practiceCount : item.practiceCount,
        lastPracticedAt: existing.lastPracticedAt || item.lastPracticedAt,
        definitionEn: existing.definitionEn || item.definitionEn,
        translationPt: existing.translationPt || item.translationPt,
        exampleSentence: existing.exampleSentence || item.exampleSentence,
      });
    }
  }

  const uniqueList = Array.from(uniqueMap.values());
  if (uniqueList.length === 0) return [];

  // Helper: check if never practiced
  const isNeverPracticed = (entry: HomeworkVocabItem): boolean => {
    const count = typeof entry.practiceCount === 'number' ? entry.practiceCount : 0;
    return count === 0 || !entry.lastPracticedAt;
  };

  // Helper: timestamp parser with fallback
  const parseTimestamp = (iso?: string): number => {
    if (!iso) return NaN;
    const t = new Date(iso).getTime();
    return isNaN(t) ? NaN : t;
  };

  // Helper: deterministic comparison for never-practiced words (oldest learnedAt first)
  const compareNeverPracticed = (a: HomeworkVocabItem, b: HomeworkVocabItem): number => {
    const tA = parseTimestamp(a.learnedAt);
    const tB = parseTimestamp(b.learnedAt);
    const hasA = !isNaN(tA);
    const hasB = !isNaN(tB);

    if (hasA && hasB && tA !== tB) {
      return tA - tB; // oldest first
    }
    if (hasA && !hasB) return -1;
    if (!hasA && hasB) return 1;

    // Stable deterministic fallback: normalized word, then id
    const normA = a.word.trim().toLowerCase();
    const normB = b.word.trim().toLowerCase();
    const wordCmp = normA.localeCompare(normB);
    if (wordCmp !== 0) return wordCmp;
    return (a.id || '').localeCompare(b.id || '');
  };

  // Helper: deterministic comparison for practiced words (least recently practiced first using lastPracticedAt)
  const comparePracticed = (a: HomeworkVocabItem, b: HomeworkVocabItem): number => {
    const tA = parseTimestamp(a.lastPracticedAt);
    const tB = parseTimestamp(b.lastPracticedAt);
    const hasA = !isNaN(tA);
    const hasB = !isNaN(tB);

    if (hasA && hasB && tA !== tB) {
      return tA - tB; // oldest lastPracticedAt first = least recently practiced
    }
    if (hasA && !hasB) return -1;
    if (!hasA && hasB) return 1;

    // Tie-break 1: learnedAt oldest first
    const lA = parseTimestamp(a.learnedAt);
    const lB = parseTimestamp(b.learnedAt);
    if (!isNaN(lA) && !isNaN(lB) && lA !== lB) {
      return lA - lB;
    }

    // Tie-break 2: normalized word, then id
    const normA = a.word.trim().toLowerCase();
    const normB = b.word.trim().toLowerCase();
    const wordCmp = normA.localeCompare(normB);
    if (wordCmp !== 0) return wordCmp;
    return (a.id || '').localeCompare(b.id || '');
  };

  // Partition into the 4 deterministic buckets
  const bucket1NfNever: HomeworkVocabItem[] = [];
  const bucket2MyNever: HomeworkVocabItem[] = [];
  const bucket3NfPracticed: HomeworkVocabItem[] = [];
  const bucket4MyPracticed: HomeworkVocabItem[] = [];

  for (const item of uniqueList) {
    const isNf = isNativeFriendVocabulary(item);
    const never = isNeverPracticed(item);

    if (isNf && never) {
      bucket1NfNever.push(item);
    } else if (!isNf && never) {
      bucket2MyNever.push(item);
    } else if (isNf && !never) {
      bucket3NfPracticed.push(item);
    } else {
      bucket4MyPracticed.push(item);
    }
  }

  // Sort each bucket deterministically
  bucket1NfNever.sort(compareNeverPracticed);
  bucket2MyNever.sort(compareNeverPracticed);
  bucket3NfPracticed.sort(comparePracticed);
  bucket4MyPracticed.sort(comparePracticed);

  // Fill up to 5 words strictly in priority order
  const queue: HomeworkVocabItem[] = [];

  // Priority 1: Native Friend words never practiced
  for (const item of bucket1NfNever) {
    if (queue.length >= 5) break;
    queue.push(item);
  }

  // Priority 2: Student/My Words never practiced
  for (const item of bucket2MyNever) {
    if (queue.length >= 5) break;
    queue.push(item);
  }

  // Priority 3: Practiced Native Friend words (least recently practiced first)
  for (const item of bucket3NfPracticed) {
    if (queue.length >= 5) break;
    queue.push(item);
  }

  // Priority 4: Practiced Student words (least recently practiced first)
  for (const item of bucket4MyPracticed) {
    if (queue.length >= 5) break;
    queue.push(item);
  }

  return queue;
}

export function generateWeeklyHomework(
  routinesByDay: Record<DayOfWeek, RoutineItem[]>,
  userProfile?: UserProfile,
  studentEmail?: string,
  studentName?: string,
  customWords?: Array<Partial<HomeworkVocabItem> & { word: string }>,
  studentLevel?: string,
  targetDay?: DayOfWeek
): WeeklyHomeworkData {
  const email = studentEmail || userProfile?.email || '';
  const name = studentName || userProfile?.name || (email ? email.split('@')[0] : 'Student');
  const rawLvl = (studentLevel || userProfile?.level || 'iniciante').toLowerCase();

  const isAdv = rawLvl.includes('avanc') || rawLvl.includes('advan') || rawLvl.includes('c1') || rawLvl.includes('c2');
  const isInter = !isAdv && (rawLvl.includes('intermed') || rawLvl.includes('b1') || rawLvl.includes('b2'));
  const levelLabel = isAdv ? 'Advanced' : isInter ? 'Intermediate' : 'Beginner';

  const schedule = targetDay
    ? getDailyMemorizationSchedule(targetDay, userProfile?.weeklyStudyDays, userProfile?.weeklyCycle || 1)
    : null;

  // 1. Gather all candidate vocabulary available to the student
  const candidateItems: HomeworkVocabItem[] = [];
  const seenCandidates = new Set<string>();

  // A. Words from student dictionary / custom words
  if (Array.isArray(customWords)) {
    customWords.forEach((cw) => {
      const trimmed = (cw?.word || '').trim();
      if (trimmed && !seenCandidates.has(trimmed.toLowerCase())) {
        seenCandidates.add(trimmed.toLowerCase());
        const prof = profileWord(trimmed, {
          definitionEn: cw.definitionEn,
          translationPt: cw.translationPt,
          exampleSentence: cw.exampleSentence,
        });
        candidateItems.push({
          id: (cw as any).id,
          word: trimmed,
          source: (cw as any).source,
          sourceActivityName: cw.sourceActivityName || 'Personal Dictionary',
          sourceDay: cw.sourceDay || targetDay || 'monday',
          learnedAt: (cw as any).learnedAt,
          practiceCount: (cw as any).practiceCount,
          lastPracticedAt: (cw as any).lastPracticedAt,
          definitionEn: prof.definitionEn,
          translationPt: prof.translationPt,
          exampleSentence: prof.exampleSentenceEn,
        });
      }
    });
  }

  // B. Words from routinesByDay
  for (const d of DAYS_OF_WEEK) {
    const items = routinesByDay[d] || [];
    for (const item of items) {
      if (item.learnedWords && Array.isArray(item.learnedWords)) {
        for (const w of item.learnedWords) {
          const trimmed = (w || '').trim();
          if (trimmed && !seenCandidates.has(trimmed.toLowerCase())) {
            seenCandidates.add(trimmed.toLowerCase());
            const lower = trimmed.toLowerCase();
            const dictMatch = ROUTINE_VOCAB_DICT[lower];
            const prof = profileWord(trimmed, dictMatch ? {
              definitionEn: dictMatch.definitionEn,
              translationPt: dictMatch.translationPt,
              exampleSentence: dictMatch.exampleSentence,
            } : undefined);

            candidateItems.push({
              word: trimmed,
              sourceActivityName: item.activityName,
              sourceDay: d,
              source: 'routine',
              practiceCount: 0,
              definitionEn: prof.definitionEn,
              translationPt: prof.translationPt,
              exampleSentence: prof.exampleSentenceEn,
            });
          }
        }
      }
    }
  }

  // Phase 1B: Deterministic selection of <= 5 words according to priority rule
  const rawWords: HomeworkVocabItem[] = buildDailyMemorizationQueue(candidateItems);

  const dayNamePt = targetDay ? DAY_LABELS_PT[targetDay] : '';
  const dayNameEn = targetDay ? DAY_LABELS_EN[targetDay] : '';
  const partInfoPt = schedule ? ` (${schedule.partTitlePt})` : '';
  const partInfoEn = schedule ? ` (${schedule.partTitleEn})` : '';

  const weekLabel = targetDay
    ? `${dayNamePt} • Semana ${userProfile?.weeklyCycle || 1}`
    : `Semana de ${new Date().toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' })}`;

  // REGRA DE OURO ANTI-GENÉRICO: Se não houver palavras cadastradas, retorna aviso estruturado
  if (rawWords.length === 0) {
    return {
      id: `hw-${targetDay || 'week'}-${Date.now()}`,
      targetDay,
      assignedPart: schedule?.partNumber,
      assignedPartKey: schedule?.partKey,
      weekLabel,
      studentEmail: email,
      studentName: name,
      studentLevel: levelLabel,
      createdAt: new Date().toISOString(),
      totalWordsCollected: 0,
      vocabularyList: [],
      allRoutineWords: [],
      matchingPairs: [],
      fillInBlanks: [],
      sentenceWritingPrompts: [],
      readingPassage: {
        title: targetDay ? `Vocabulário de ${dayNamePt}` : 'Aguardando Vocabulário da Semana',
        text: '',
        questions: [],
      },
      isEmpty: true,
      emptyWarning: targetDay
        ? `Nenhum vocabulário registrado para ${dayNamePt} ainda. Para realizar a ${schedule?.partTitlePt || 'Atividade de Memorização de hoje'}, registre palavras nas atividades de hoje (Vídeo do Dia ou Áudio do Spotify) ou participe da conversa ao vivo.`
        : 'Nenhum vocabulário cadastrado nesta semana ainda. Para gerar sua Atividade de Memorização inteligente, adicione palavras nas suas rotinas diárias ou participe de uma aula ao vivo com seu Amigo Nativo para que ele anote novos termos no seu vocabulário.',
      emptyWarningEn: targetDay
        ? `No vocabulary registered for ${dayNameEn} yet. To complete today's ${schedule?.partTitleEn || 'Memorization Activity'}, add words in today's activities (Video of the Day or Spotify Audio) or join your live conversation.`
        : 'No vocabulary registered for this week yet. To generate your AI Memorization Activity, add words in your daily routines or attend a live lesson with your Native Friend so they can note new terms in your vocabulary.',
      isCompleted: false,
      score: 0,
    };
  }

  // 2. Build Matching Pairs (Part 1 - Associação): Embaralha apenas a ordem para criar o desafio
  const matchingPairs: MatchingPair[] = [...rawWords]
    .sort(() => 0.5 - Math.random())
    .map((item, idx) => ({
      id: `match-${idx}-${item.word}`,
      word: item.word,
      definition: item.definitionEn,
      translation: item.translationPt,
    }));

  // 3. Build Fill-in-the-Blanks (Part 2 - Lacunas): Sintetizado com precisão semântica e gramatical autêntica
  const fillInBlanks: FillInBlankItem[] = synthesizeFillInBlanks(
    rawWords.map((rw) => rw.word),
    rawWords
  );

  // 4. Build Sentence Writing Prompts (Part 3 - Construção de Frases Ativas): Calibrado por nível
  const sentenceWritingPrompts: SentenceWritingPrompt[] = rawWords.slice(0, 5).map((item) => {
    const prof = profileWord(item.word);
    let hintEn = '';
    let hintPt = '';

    if (isAdv) {
      hintEn = `Formulate an advanced sentence applying "${item.word}" to analyze a complex decision, project challenge, or strategic goal in your career.`;
      hintPt = `Formule uma frase em nível avançado aplicando "${item.word}" (${prof.translationPt}) para analisar uma decisão complexa, desafio de projeto ou meta estratégica.`;
      return {
        word: item.word,
        hint: hintEn,
        hintEn,
        hintPt,
        levelInstruction: 'Use complex clauses, conditionals (if/would), or executive phrasing.',
      };
    }
    if (isInter) {
      hintEn = `Write a realistic compound sentence with "${item.word}" connecting two related actions or explaining a key reason in your daily routine or work.`;
      hintPt = `Escreva uma frase intermediária autêntica com "${item.word}" (${prof.translationPt}) conectando duas ações ou explicando uma razão da sua rotina ou trabalho.`;
      return {
        word: item.word,
        hint: hintEn,
        hintEn,
        hintPt,
        levelInstruction: 'Connect two ideas using a connector like "because", "although", "since", or "while".',
      };
    }
    hintEn = `Write a clear, direct English sentence about your daily routine or home life applying "${item.word}".`;
    hintPt = `Escreva uma frase simples e direta sobre sua rotina diária aplicando "${item.word}" (${prof.translationPt}).`;
    return {
      word: item.word,
      hint: hintEn,
      hintEn,
      hintPt,
      levelInstruction: 'Use a clear Subject + Verb + Object structure.',
    };
  });

  // 5. Build Reading Passage & Comprehension (Part 4 - Mini-Story Coesa e Gramaticalmente Fluida)
  const synthesizedStory = synthesizeCohesiveStoryAndQuestions({
    words: rawWords.map((rw) => rw.word),
    studentLevel: levelLabel,
    studentName: name,
    wordDetails: rawWords,
  });

  const passageTitle = synthesizedStory.title;
  const passageText = synthesizedStory.text;
  const readingQuestions = synthesizedStory.questions;

  return {
    id: `hw-${targetDay || 'week'}-${Date.now()}`,
    targetDay,
    assignedPart: schedule?.partNumber,
    assignedPartKey: schedule?.partKey,
    weekLabel,
    studentEmail: email,
    studentName: name,
    studentLevel: levelLabel,
    createdAt: new Date().toISOString(),
    totalWordsCollected: rawWords.length,
    vocabularyList: rawWords,
    allRoutineWords: rawWords,
    matchingPairs,
    fillInBlanks,
    sentenceWritingPrompts,
    readingPassage: {
      title: passageTitle,
      text: passageText,
      questions: readingQuestions,
    },
    isEmpty: false,
    isCompleted: false,
    score: 0,
  };
}

export function generateWeeklyHomeworkFromRoutines(params: {
  routinesByDay: Record<DayOfWeek, RoutineItem[]>;
  studentName?: string;
  studentLevel?: string;
  studentEmail?: string;
  customWords?: Array<Partial<HomeworkVocabItem> & { word: string }>;
  targetDay?: DayOfWeek;
  activeStudyDays?: DayOfWeek[];
  weeklyCycle?: number;
  userProfile?: UserProfile;
}): WeeklyHomeworkData {
  const profile = params.userProfile || ({
    weeklyStudyDays: params.activeStudyDays,
    weeklyCycle: params.weeklyCycle,
    level: params.studentLevel,
    name: params.studentName,
    email: params.studentEmail,
  } as any);

  return generateWeeklyHomework(
    params.routinesByDay,
    profile,
    params.studentEmail,
    params.studentName,
    params.customWords,
    params.studentLevel,
    params.targetDay
  );
}

/**
 * Async generator that triggers the server-side Gemini AI engine
 * to generate the 4 stages using real daily vocabulary.
 */
export async function generateWeeklyHomeworkWithAi(params: {
  routinesByDay: Record<DayOfWeek, RoutineItem[]>;
  studentName?: string;
  studentLevel?: string;
  studentEmail?: string;
  customWords?: Array<Partial<HomeworkVocabItem> & { word: string }>;
  targetDay?: DayOfWeek;
  activeStudyDays?: DayOfWeek[];
  weeklyCycle?: number;
  userProfile?: UserProfile;
}): Promise<WeeklyHomeworkData> {
  const localBaseline = generateWeeklyHomeworkFromRoutines(params);

  // If there are no words, return the empty structured notice immediately without calling AI
  if (localBaseline.isEmpty || localBaseline.totalWordsCollected === 0) {
    return localBaseline;
  }

  try {
    // Simple direct payload: array of words and student level
    const cleanWordList = Array.from(
      new Set(
        localBaseline.vocabularyList
          .map((item) => item.word.trim())
          .filter((w) => Boolean(w))
      )
    );

    const controller = new AbortController();
    const abortTimeout = setTimeout(() => controller.abort(), 35000);

    const response = await fetch('/api/homework/generate-ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        words: cleanWordList,
        wordDetails: localBaseline.vocabularyList,
        studentLevel: params.studentLevel || 'Intermediate',
        studentName: params.studentName || 'Student',
        studentEmail: params.studentEmail || '',
        weekLabel: localBaseline.weekLabel,
      }),
    });
    clearTimeout(abortTimeout);

    if (response.ok) {
      const data = await response.json();
      if (data.homework && Array.isArray(data.homework.matchingPairs) && data.homework.matchingPairs.length > 0) {
        return {
          ...data.homework,
          targetDay: params.targetDay,
          assignedPart: localBaseline.assignedPart,
          assignedPartKey: localBaseline.assignedPartKey,
          studentLevel: data.homework.studentLevel || localBaseline.studentLevel,
          totalWordsCollected: localBaseline.totalWordsCollected,
          vocabularyList:
            Array.isArray(data.homework.vocabularyList) && data.homework.vocabularyList.length > 0
              ? data.homework.vocabularyList
              : localBaseline.vocabularyList,
          isAiGenerated: true,
        };
      }
      if (data.isEmpty) {
        return {
          ...localBaseline,
          isEmpty: true,
          emptyWarning: data.emptyWarning || localBaseline.emptyWarning,
        };
      }
    }
  } catch (err) {
    console.warn('AI memorization generation temporarily unavailable, using structured pedagogical base:', err);
  }

  return {
    ...localBaseline,
    isAiGenerated: false,
  };
}

/**
 * Dedicated AI generator specifically for Part 4 (Mini-Story & Reading Comprehension)
 * Guarantees a 100% original, unprecedented storyline with organic vocabulary integration
 * and cohesive, story-grounded questions using the Gemini API.
 */
export async function generatePart4StoryWithAi(params: {
  words: string[];
  studentLevel?: string;
  studentName?: string;
  wordDetails?: any[];
}): Promise<ReadingPassage | null> {
  const cleanWords = Array.from(new Set(params.words.filter(Boolean)));
  if (cleanWords.length === 0) return null;

  try {
    const controller = new AbortController();
    const abortTimeout = setTimeout(() => controller.abort(), 20000);

    const response = await fetch('/api/homework/generate-part4', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        words: cleanWords,
        studentLevel: params.studentLevel || 'Intermediate',
        studentName: params.studentName || 'Student',
        wordDetails: params.wordDetails || [],
      }),
    });
    clearTimeout(abortTimeout);

    if (response.ok) {
      const data = await response.json();
      if (data.readingPassage?.text && Array.isArray(data.readingPassage?.questions)) {
        return data.readingPassage;
      }
    }
  } catch (err) {
    console.warn('Part 4 AI generation failed, falling back:', err);
  }

  return synthesizeCohesiveStoryAndQuestions({
    words: cleanWords,
    studentLevel: params.studentLevel,
    studentName: params.studentName,
    wordDetails: params.wordDetails,
  });
}

