import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveDailyMemorizationVocabulary,
} from '../src/utils/homeworkGenerator';
import {
  mergeDailyActivities,
  sanitizeLoadedHomeworkData,
} from '../src/utils/studentPersistence';
import { HomeworkVocabItem, DailyHomeworkActivity } from '../src/types';

function makeWord(
  word: string,
  learnedAt: string,
  origins?: any[],
  extra?: Partial<HomeworkVocabItem>
): HomeworkVocabItem {
  return {
    word,
    learnedAt,
    origins,
    translationPt: extra?.translationPt || `${word} (pt)`,
    definitionEn: extra?.definitionEn || `Definition of ${word}`,
    exampleSentence: extra?.exampleSentence || `Example sentence for ${word}.`,
    ...extra,
  };
}

describe('FASE 8.4: Fila Única de Vocabulário & Hydration Canonica', () => {
  const targetDay = 'wednesday';
  const activityDate = '2026-10-28';
  const timeZone = 'America/Sao_Paulo';

  it('1. Prioridade 1: 5 palavras do Native Friend na data exata preenchem todas as 5 vagas (mais recentes primeiro)', () => {
    const dictionary: HomeworkVocabItem[] = [
      makeWord('nf_word_1', '2026-10-28T10:00:00Z', [{ source: 'native_notes', createdAt: '2026-10-28T10:00:00Z', activityName: 'Native Friend Notes' }]),
      makeWord('nf_word_2', '2026-10-28T11:00:00Z', [{ source: 'native_notes', createdAt: '2026-10-28T11:00:00Z', activityName: 'Native Friend Notes' }]),
      makeWord('nf_word_3', '2026-10-28T12:00:00Z', [{ source: 'native_notes', createdAt: '2026-10-28T12:00:00Z', activityName: 'Native Friend Notes' }]),
      makeWord('nf_word_4', '2026-10-28T13:00:00Z', [{ source: 'native_notes', createdAt: '2026-10-28T13:00:00Z', activityName: 'Native Friend Notes' }]),
      makeWord('nf_word_5', '2026-10-28T14:00:00Z', [{ source: 'native_notes', createdAt: '2026-10-28T14:00:00Z', activityName: 'Native Friend Notes' }]),
      makeWord('nf_word_old', '2026-10-28T09:00:00Z', [{ source: 'native_notes', createdAt: '2026-10-28T09:00:00Z', activityName: 'Native Friend Notes' }]),
      makeWord('my_word_1', '2026-10-28T15:00:00Z', [{ source: 'personal_dictionary', createdAt: '2026-10-28T15:00:00Z' }]),
    ];

    const result = resolveDailyMemorizationVocabulary({
      targetDay,
      activityDate,
      timeZone,
      customWords: dictionary,
    });

    assert.equal(result.length, 5, 'Should select exactly 5 words');
    // Descending order of timestamp: 14:00, 13:00, 12:00, 11:00, 10:00
    assert.equal(result[0].word, 'nf_word_5');
    assert.equal(result[1].word, 'nf_word_4');
    assert.equal(result[2].word, 'nf_word_3');
    assert.equal(result[3].word, 'nf_word_2');
    assert.equal(result[4].word, 'nf_word_1');
  });

  it('2. Prioridade 1 + Prioridade 2: 3 palavras Native Friend do dia + 2 mais recentes do My Dictionary geral', () => {
    const dictionary: HomeworkVocabItem[] = [
      makeWord('nf_today_1', '2026-10-28T10:00:00Z', [{ source: 'native_notes', createdAt: '2026-10-28T10:00:00Z', activityName: 'Native Friend Notes' }]),
      makeWord('nf_today_2', '2026-10-28T12:00:00Z', [{ source: 'native_notes', createdAt: '2026-10-28T12:00:00Z', activityName: 'Native Friend Notes' }]),
      makeWord('nf_today_3', '2026-10-28T11:00:00Z', [{ source: 'native_notes', createdAt: '2026-10-28T11:00:00Z', activityName: 'Native Friend Notes' }]),
      makeWord('dict_recent_1', '2026-10-27T18:00:00Z', [{ source: 'personal_dictionary', createdAt: '2026-10-27T18:00:00Z' }]),
      makeWord('dict_recent_2', '2026-10-26T15:00:00Z', [{ source: 'personal_dictionary', createdAt: '2026-10-26T15:00:00Z' }]),
      makeWord('dict_older', '2026-10-20T10:00:00Z', [{ source: 'personal_dictionary', createdAt: '2026-10-20T10:00:00Z' }]),
    ];

    const result = resolveDailyMemorizationVocabulary({
      targetDay,
      activityDate,
      timeZone,
      customWords: dictionary,
    });

    assert.equal(result.length, 5);
    // Priority 1 (3 items, newest first): nf_today_2 (12:00), nf_today_3 (11:00), nf_today_1 (10:00)
    assert.equal(result[0].word, 'nf_today_2');
    assert.equal(result[1].word, 'nf_today_3');
    assert.equal(result[2].word, 'nf_today_1');
    // Priority 2 (2 items, newest first): dict_recent_1 (Oct 27), dict_recent_2 (Oct 26)
    assert.equal(result[3].word, 'dict_recent_1');
    assert.equal(result[4].word, 'dict_recent_2');
  });

  it('3. Prioridade 2 apenas: 0 palavras Native Friend do dia -> 5 mais recentes do My Dictionary geral', () => {
    const dictionary: HomeworkVocabItem[] = [
      makeWord('word_1', '2026-10-25T10:00:00Z', [{ source: 'personal_dictionary', createdAt: '2026-10-25T10:00:00Z' }]),
      makeWord('word_2', '2026-10-26T10:00:00Z', [{ source: 'personal_dictionary', createdAt: '2026-10-26T10:00:00Z' }]),
      makeWord('word_3', '2026-10-27T10:00:00Z', [{ source: 'personal_dictionary', createdAt: '2026-10-27T10:00:00Z' }]),
      makeWord('word_4', '2026-10-28T08:00:00Z', [{ source: 'personal_dictionary', createdAt: '2026-10-28T08:00:00Z' }]),
      makeWord('word_5', '2026-10-28T09:00:00Z', [{ source: 'personal_dictionary', createdAt: '2026-10-28T09:00:00Z' }]),
      makeWord('word_6', '2026-10-28T09:30:00Z', [{ source: 'personal_dictionary', createdAt: '2026-10-28T09:30:00Z' }]),
    ];

    const result = resolveDailyMemorizationVocabulary({
      targetDay,
      activityDate,
      timeZone,
      customWords: dictionary,
    });

    assert.equal(result.length, 5);
    assert.equal(result[0].word, 'word_6');
    assert.equal(result[1].word, 'word_5');
    assert.equal(result[2].word, 'word_4');
    assert.equal(result[3].word, 'word_3');
    assert.equal(result[4].word, 'word_2');
  });

  it('4. Zero palavras sintéticas quando o dicionário tem menos de 5 palavras', () => {
    const dictionary: HomeworkVocabItem[] = [
      makeWord('authentic_1', '2026-10-28T10:00:00Z', [{ source: 'personal_dictionary', createdAt: '2026-10-28T10:00:00Z' }]),
      makeWord('authentic_2', '2026-10-28T11:00:00Z', [{ source: 'personal_dictionary', createdAt: '2026-10-28T11:00:00Z' }]),
    ];

    const result = resolveDailyMemorizationVocabulary({
      targetDay,
      activityDate,
      timeZone,
      customWords: dictionary,
    });

    assert.equal(result.length, 2, 'Must not invent synthetic words to reach 5');
    assert.equal(result[0].word, 'authentic_2');
    assert.equal(result[1].word, 'authentic_1');
  });

  it('5. Deduplicação por chave normalizada e preservação de metadados reais', () => {
    const dictionary: HomeworkVocabItem[] = [
      makeWord('Schedule', '2026-10-28T10:00:00Z', [{ source: 'personal_dictionary', createdAt: '2026-10-28T10:00:00Z' }], {
        cefrLevel: 'B1',
        partOfSpeech: 'noun',
        lessonRefId: 'lesson-123',
      }),
      makeWord('schedule', '2026-10-28T11:00:00Z', [{ source: 'native_notes', createdAt: '2026-10-28T11:00:00Z', activityName: 'Native Friend Notes' }], {
        cefrLevel: 'B2',
      }),
    ];

    const result = resolveDailyMemorizationVocabulary({
      targetDay,
      activityDate,
      timeZone,
      customWords: dictionary,
    });

    assert.equal(result.length, 1, 'Duplicate normalized word must be deduplicated');
    assert.equal(result[0].word.toLowerCase(), 'schedule');
    assert.ok(result[0].origins && result[0].origins.length > 0, 'Origins must be preserved');
  });

  it('6. Palavras registradas após o referenceTimestamp não são consideradas', () => {
    const referenceTimestamp = new Date('2026-10-28T12:00:00Z').getTime();
    const dictionary: HomeworkVocabItem[] = [
      makeWord('word_before', '2026-10-28T11:00:00Z', [{ source: 'personal_dictionary', createdAt: '2026-10-28T11:00:00Z' }]),
      makeWord('word_after', '2026-10-28T14:00:00Z', [{ source: 'personal_dictionary', createdAt: '2026-10-28T14:00:00Z' }]),
    ];

    const result = resolveDailyMemorizationVocabulary({
      targetDay,
      activityDate,
      referenceTimestamp,
      timeZone,
      customWords: dictionary,
    });

    assert.equal(result.length, 1);
    assert.equal(result[0].word, 'word_before');
  });

  it('7. Native Friend de datas anteriores participa de Prioridade 2 sem prioridade especial', () => {
    const dictionary: HomeworkVocabItem[] = [
      makeWord('nf_yesterday', '2026-10-27T10:00:00Z', [{ source: 'native_notes', createdAt: '2026-10-27T10:00:00Z', activityName: 'Native Friend Notes' }]),
      makeWord('my_word_today', '2026-10-28T08:00:00Z', [{ source: 'personal_dictionary', createdAt: '2026-10-28T08:00:00Z' }]),
    ];

    const result = resolveDailyMemorizationVocabulary({
      targetDay,
      activityDate: '2026-10-28',
      timeZone,
      customWords: dictionary,
    });

    assert.equal(result.length, 2);
    // my_word_today is from Oct 28 (newer), so it appears before nf_yesterday from Oct 27
    assert.equal(result[0].word, 'my_word_today');
    assert.equal(result[1].word, 'nf_yesterday');
  });

  it('8. Defesa contra 0/0: mergeDailyActivities sintetiza exercícios se snapshot estiver vazio mas tiver selectedWords', () => {
    const fallbackAct: DailyHomeworkActivity = {
      id: 'act-wed',
      day: 'wednesday',
      weeklyCycle: 1,
      studentUid: 'uid-1',
      createdAt: '2026-10-28T10:00:00Z',
      updatedAt: '2026-10-28T10:00:00Z',
      wordOrigins: [],
      assignedPart: 2,
      assignedPartKey: 'fill',
      selectedWords: [
        makeWord('deadline', '2026-10-28T10:00:00Z', [], {
          definitionEn: 'Latest time or date by which something should be completed',
          translationPt: 'Prazo limite',
          exampleSentence: 'We must meet the project deadline.',
        }),
        makeWord('strategy', '2026-10-28T10:00:00Z', [], {
          definitionEn: 'A plan of action designed to achieve a long-term goal',
          translationPt: 'Estratégia',
          exampleSentence: 'They planned a new product strategy.',
        }),
      ],
      matchingPairs: [],
      fillInBlanks: [],
      sentenceWritingPrompts: [],
      readingPassage: { title: '', text: '', questions: [] },
      studentAnswers: { matching: {}, fillInBlanks: { 0: 'deadline' }, sentences: {}, quizAnswers: {} },
      score: 1,
      isCompleted: false,
    };

    const primaryAct: DailyHomeworkActivity = {
      ...fallbackAct,
      // Empty arrays in primary (e.g. from an incomplete progress write)
      fillInBlanks: [],
      matchingPairs: [],
    };

    const merged = mergeDailyActivities({ wednesday: primaryAct }, { wednesday: fallbackAct });
    const wedAct = merged['wednesday'];

    assert.ok(wedAct, 'Activity exists');
    assert.ok(Array.isArray(wedAct.fillInBlanks) && wedAct.fillInBlanks.length === 2, 'Part 2 fillInBlanks was restored/synthesized (not 0/0)');
    assert.ok(Array.isArray(wedAct.matchingPairs) && wedAct.matchingPairs.length === 2, 'Part 1 matchingPairs was synthesized');
    assert.equal(wedAct.studentAnswers?.fillInBlanks?.[0], 'deadline', 'Preserves student answers');
  });

  it('9. Invariância de Atividade Iniciada: não altera exercícios nem respostas já preenchidas', () => {
    const existingActivity: DailyHomeworkActivity = {
      id: 'act-thu',
      day: 'thursday',
      weeklyCycle: 1,
      studentUid: 'uid-1',
      createdAt: '2026-10-28T10:00:00Z',
      updatedAt: '2026-10-28T10:00:00Z',
      wordOrigins: [],
      assignedPart: 3,
      assignedPartKey: 'writing',
      selectedWords: [
        makeWord('prioritize', '2026-10-28T10:00:00Z', [], {
          definitionEn: 'Designate or treat something as being very or most important',
          translationPt: 'Priorizar',
          exampleSentence: 'I prioritize urgent tasks.',
        }),
      ],
      matchingPairs: [{ id: 'pair-1', word: 'prioritize', definition: 'Designate', translation: 'Priorizar' }],
      fillInBlanks: [{ id: 'fib-1', sentenceWithBlank: 'We should ______ urgent tasks.', correctWord: 'prioritize', options: ['prioritize', 'delay'], hintPt: 'Priorizar' }],
      sentenceWritingPrompts: [{ word: 'prioritize', hint: 'Write about work' }],
      readingPassage: { title: 'Story', text: 'Story text', questions: [] },
      studentAnswers: {
        matching: {},
        fillInBlanks: {},
        sentences: { prioritize: 'I prioritize urgent tasks first.' },
        quizAnswers: {},
      },
      score: 1,
      isCompleted: false,
    };

    const sanitized = sanitizeLoadedHomeworkData({
      id: 'hw-1',
      dailyActivities: { thursday: existingActivity },
      selectedWords: existingActivity.selectedWords,
    });

    const thur = sanitized?.dailyActivities?.['thursday'];
    assert.ok(thur);
    assert.equal(thur.selectedWords?.[0].word, 'prioritize');
    assert.equal(thur.sentenceWritingPrompts?.[0].hint, 'Write about work');
    assert.equal(thur.studentAnswers?.sentences?.['prioritize'], 'I prioritize urgent tasks first.');
  });
});
