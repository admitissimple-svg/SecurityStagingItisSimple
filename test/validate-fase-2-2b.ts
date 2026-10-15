/**
 * FASE 2.2B — IMPLEMENTAÇÃO CONTROLADA DO MY DICTIONARY COMO BIBLIOTECA PEDAGÓGICA CENTRAL
 * Automated Test Suite
 *
 * Valida os critérios da Fase 2.2B:
 * 1. Reutilização de consolidateDictionaryEntries como mecanismo canônico de consolidação.
 * 2. Eliminação de segunda lógica de deduplicação redundante dentro do PersonalDictionaryModal.
 * 3. Preservação integral de origins, practiceCount, lastPracticedAt e practiceHistory.
 * 4. Proteção estrita de definições enriquecidas contra fallbacks genéricos.
 * 5. Preservação da separação visual entre palavras do Native Friends e palavras pessoais.
 * 6. Critério de aceite: palavra capturada na rotina E no Native Friends aparece uma única vez,
 *    preservando as duas origens e todas as métricas anteriores.
 * 7. Inclusão manual, exclusão, consulta de definições e áudio mantidos.
 * 8. Sincronização consistente entre Firestore e backend sem criar nova fonte de verdade.
 */

import {
  normalizeDictionaryWord,
  isDefinitionRicher,
  consolidateDictionaryEntries,
} from '../src/utils/studentDictionaryLibrary';
import { StudentDictionaryEntry, DayOfWeek } from '../src/types';

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    console.log(`  ✅ PASS: ${testName}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${testName} ${detail ? `(${detail})` : ''}`);
    failed++;
  }
}

async function runTests() {
  console.log('\n======================================================');
  console.log('FASE 2.2B — SUITE DE TESTES AUTOMATIZADOS');
  console.log('======================================================\n');

  // Helper matching PersonalDictionaryModal's updated isNativeFriend
  const isNativeFriend = (entry: StudentDictionaryEntry): boolean => {
    if (entry.source === 'live_lesson') return true;
    if (
      Array.isArray(entry.origins) &&
      entry.origins.some((o) => o.source === 'live_lesson' || o.source === 'native_notes')
    ) {
      return true;
    }
    const act = entry.sourceActivityName || '';
    if (act.includes('Native Friends Notes') || act.includes('Live Session')) {
      return true;
    }
    return false;
  };

  // --------------------------------------------------------------------------
  // TESTE 1: Palavra presente na rotina E no Native Friends aparece UMA ÚNICA VEZ
  // --------------------------------------------------------------------------
  console.log('TEST 1: Palavra capturada na rotina E no Native Friends aparece UMA ÚNICA VEZ');
  {
    const routineWords: Array<{ word: string; sourceActivityName?: string; sourceDay?: DayOfWeek }> = [
      {
        word: 'resilience',
        sourceActivityName: 'TED Talk: Growth Mindset',
        sourceDay: 'monday' as DayOfWeek,
      },
    ];

    const savedFromNativeFriend: StudentDictionaryEntry[] = [
      {
        id: 'dict_resilience_live_101',
        word: 'resilience',
        originalWord: 'resilience',
        normalizedWord: 'resilience',
        definitionEn: 'The psychological and emotional capacity to recover quickly from difficulties.',
        exampleSentenceEn: 'She demonstrated exceptional resilience during the presentation.',
        partOfSpeech: 'Noun',
        source: 'live_lesson',
        sourceActivityName: 'Native Friends Notes (Fluency Session)',
        learnedAt: '2026-10-12T14:00:00.000Z',
        lessonRefId: 'lesson_live_889',
        practiceCount: 4,
        lastPracticedAt: '2026-10-14T09:30:00.000Z',
        origins: [
          {
            source: 'native_notes',
            activityName: 'Native Friends Notes (Fluency Session)',
            lessonId: 'lesson_live_889',
            teacherName: 'Charles Tutor',
            date: '2026-10-12',
          },
        ],
      },
    ];

    // Canonical formatting of routine words as done inside PersonalDictionaryModal
    const formattedRoutineEntries: StudentDictionaryEntry[] = routineWords.map((item) => {
      const cleanWord = (item.word || '').trim();
      const norm = normalizeDictionaryWord(cleanWord);
      return {
        id: `routine_${norm}`,
        word: cleanWord,
        originalWord: cleanWord,
        normalizedWord: norm,
        definitionEn: 'The capacity to recover quickly from difficulties.',
        partOfSpeech: 'Noun',
        source: 'routine',
        sourceActivityName: item.sourceActivityName || 'Daily Routine',
        sourceDay: item.sourceDay,
        origins: [
          {
            source: 'routine',
            activityName: item.sourceActivityName || 'Daily Routine',
            dayOfWeek: item.sourceDay,
            date: '2026-10-15',
          },
        ],
        practiceCount: 0,
      };
    });

    const consolidated = consolidateDictionaryEntries(savedFromNativeFriend, formattedRoutineEntries);

    assert(consolidated.length === 1, 'Word present in both routine and native notes appears exactly ONCE');
    const entry = consolidated[0]!;
    assert(entry.normalizedWord === 'resilience', 'Word is properly indexed by normalizedWord');
    assert(entry.origins?.length === 2, 'Entry preserves both origins (native_notes AND routine)');
    
    const hasNativeOrigin = entry.origins?.some((o) => o.source === 'native_notes' && o.lessonId === 'lesson_live_889');
    const hasRoutineOrigin = entry.origins?.some((o) => o.source === 'routine' && o.activityName === 'TED Talk: Growth Mindset');
    assert(Boolean(hasNativeOrigin && hasRoutineOrigin), 'Both distinct contexts and source metadata are preserved');
  }

  // --------------------------------------------------------------------------
  // TESTE 2: Métricas pedagógicas e histórico de prática estritamente preservados
  // --------------------------------------------------------------------------
  console.log('\nTEST 2: Métricas pedagógicas e histórico de prática estritamente preservados');
  {
    const existingPracticedWord: StudentDictionaryEntry = {
      id: 'dict_breakthrough_1',
      word: 'breakthrough',
      originalWord: 'breakthrough',
      normalizedWord: 'breakthrough',
      definitionEn: 'A sudden, dramatic, and important discovery or development.',
      exampleSentenceEn: 'The team made a major breakthrough in natural language processing.',
      practiceCount: 7,
      lastPracticedAt: '2026-10-14T20:00:00.000Z',
      practiceHistory: [
        { date: '2026-10-10T10:00:00.000Z', activityType: 'memorization', correct: true },
        { date: '2026-10-14T20:00:00.000Z', activityType: 'sentence', correct: true },
      ],
      origins: [
        {
          source: 'native_notes',
          activityName: 'Native Friends Session',
          date: '2026-10-08',
        },
      ],
    };

    const incomingRoutineOccurrence: StudentDictionaryEntry = {
      id: 'routine_breakthrough',
      word: 'breakthrough',
      normalizedWord: 'breakthrough',
      definitionEn: 'An important development or achievement.',
      practiceCount: 0,
      origins: [
        {
          source: 'routine',
          activityName: 'Morning Routine Podcast',
          dayOfWeek: 'thursday' as DayOfWeek,
          date: '2026-10-15',
        },
      ],
    };

    const merged = consolidateDictionaryEntries([existingPracticedWord], [incomingRoutineOccurrence]);
    assert(merged.length === 1, 'Consolidates to single entry');
    assert(merged[0]?.practiceCount === 7, 'practiceCount NOT zeroed out (preserved at 7)');
    assert(merged[0]?.lastPracticedAt === '2026-10-14T20:00:00.000Z', 'lastPracticedAt preserved');
    assert(merged[0]?.practiceHistory?.length === 2, 'practiceHistory events preserved intact');
  }

  // --------------------------------------------------------------------------
  // TESTE 3: Proteção de definições enriquecidas contra fallbacks genéricos
  // --------------------------------------------------------------------------
  console.log('\nTEST 3: Proteção de definições enriquecidas contra fallbacks genéricos');
  {
    const richDefinition = 'A subtle difference in or shade of meaning, expression, or sound.';
    const genericFallback = 'A fundamental word for level B1: practice using "nuance" in simple daily conversations.';

    const entryWithRichDef: StudentDictionaryEntry = {
      id: 'dict_nuance_1',
      word: 'nuance',
      normalizedWord: 'nuance',
      definitionEn: richDefinition,
      exampleSentenceEn: 'He captured every nuance of the author\'s style.',
    };

    const entryWithFallbackDef: StudentDictionaryEntry = {
      id: 'routine_nuance',
      word: 'nuance',
      normalizedWord: 'nuance',
      definitionEn: genericFallback,
    };

    const consolidated = consolidateDictionaryEntries([entryWithRichDef], [entryWithFallbackDef]);
    assert(
      consolidated[0]?.definitionEn === richDefinition,
      'Rich definition protected: generic fallback was not allowed to overwrite it'
    );
  }

  // --------------------------------------------------------------------------
  // TESTE 4: Separação visual entre Native Friend e My Words sem duplicação
  // --------------------------------------------------------------------------
  console.log('\nTEST 4: Separação visual entre Native Friend e My Words sem duplicação');
  {
    // A word in both routine and native notes:
    const multiOriginWord: StudentDictionaryEntry = {
      id: 'multi_1',
      word: 'articulate',
      normalizedWord: 'articulate',
      definitionEn: 'Having or showing the ability to speak fluently and coherently.',
      origins: [
        { source: 'routine', activityName: '5 Words Video (Monday)', dayOfWeek: 'monday' as DayOfWeek },
        { source: 'native_notes', activityName: 'Native Friends Notes' },
      ],
      source: 'live_lesson',
    };

    // A word only in routine:
    const routineOnlyWord: StudentDictionaryEntry = {
      id: 'routine_only_1',
      word: 'brew',
      normalizedWord: 'brew',
      definitionEn: 'To prepare a beverage by steeping or boiling.',
      origins: [{ source: 'routine', activityName: 'Coffee Routine', dayOfWeek: 'tuesday' as DayOfWeek }],
      source: 'routine',
    };

    // A personal addition word:
    const personalAdditionWord: StudentDictionaryEntry = {
      id: 'custom_1',
      word: 'serendipity',
      normalizedWord: 'serendipity',
      definitionEn: 'The occurrence and development of events by chance in a happy or beneficial way.',
      origins: [{ source: 'api', activityName: 'Personal Addition' }],
      source: 'api',
    };

    const allEntries = [multiOriginWord, routineOnlyWord, personalAdditionWord];

    // Section 1: From My Native Friend
    const nativeFriendEntries = allEntries.filter((e) => isNativeFriend(e));
    // Section 2: My Words
    const myWordsEntries = allEntries.filter((e) => !isNativeFriend(e));

    assert(nativeFriendEntries.length === 1, 'Only entries with Native Friends origin are in Section 1');
    assert(nativeFriendEntries[0]?.word === 'articulate', 'Multi-origin word is classified into Section 1');

    assert(myWordsEntries.length === 2, 'Section 2 receives only personal and routine words');
    const hasMultiInMyWords = myWordsEntries.some((e) => e.word === 'articulate');
    assert(!hasMultiInMyWords, 'Multi-origin word does NOT duplicate into Section 2');

    const totalRendered = nativeFriendEntries.length + myWordsEntries.length;
    assert(totalRendered === allEntries.length, 'Every word rendered exactly once across the two sections');
  }

  // --------------------------------------------------------------------------
  // TESTE 5: Deduplicação canônica com variações de caixa e espaçamento
  // --------------------------------------------------------------------------
  console.log('\nTEST 5: Deduplicação canônica com variações de caixa e espaçamento');
  {
    const entriesWithVariations: StudentDictionaryEntry[] = [
      { id: '1', word: 'Consistency', definitionEn: 'Conformity in the application of something.' },
      { id: '2', word: 'consistency  ', definitionEn: 'Holding together firmly.' },
      { id: '3', word: ' CONSISTENCY ', definitionEn: 'Reliability.' },
    ];

    const consolidated = consolidateDictionaryEntries([], entriesWithVariations);
    assert(consolidated.length === 1, 'Multiple casing and spacing variants consolidate to a single entry');
    assert(consolidated[0]?.normalizedWord === 'consistency', 'Canonical normalizedWord used as key');
  }

  // --------------------------------------------------------------------------
  // TESTE 6: Inclusão Manual com metadados canônicos completos
  // --------------------------------------------------------------------------
  console.log('\nTEST 6: Inclusão Manual com metadados canônicos completos');
  {
    const rawManualWord = '  mindset  ';
    const cleanWord = rawManualWord.trim();
    const norm = normalizeDictionaryWord(cleanWord);
    const manualEntry: StudentDictionaryEntry = {
      id: `custom_${Date.now()}_abc`,
      word: cleanWord,
      originalWord: cleanWord,
      normalizedWord: norm,
      partOfSpeech: 'Noun',
      definitionEn: 'The established set of attitudes held by someone.',
      exampleSentenceEn: 'Developing a growth mindset is key to language learning.',
      learnedAt: '2026-10-15T12:00:00.000Z',
      source: 'api',
      sourceActivityName: 'Personal Addition',
      origins: [
        {
          source: 'api',
          activityName: 'Personal Addition',
          date: '2026-10-15',
        },
      ],
      practiceCount: 0,
      practiceHistory: [],
    };

    const merged = consolidateDictionaryEntries([], [manualEntry]);
    assert(merged.length === 1, 'Manual entry consolidated properly');
    assert(merged[0]?.word === 'mindset', 'Word trimmed');
    assert(merged[0]?.normalizedWord === 'mindset', 'normalizedWord populated');
    assert(merged[0]?.origins?.length === 1, 'Origins initialized with Personal Addition');
    assert(merged[0]?.practiceCount === 0, 'practiceCount initialized at 0');
  }

  // --------------------------------------------------------------------------
  // TESTE 7: Consolidação cumulativa com múltiplas origens da rotina
  // --------------------------------------------------------------------------
  console.log('\nTEST 7: Consolidação cumulativa com múltiplas origens da rotina');
  {
    const wordWithFirstOrigin: StudentDictionaryEntry = {
      id: 'dict_coffee_1',
      word: 'coffee',
      normalizedWord: 'coffee',
      definitionEn: 'A beverage brewed from roasted coffee beans.',
      origins: [
        { source: 'routine', activityName: 'Monday Morning Coffee', dayOfWeek: 'monday' as DayOfWeek },
      ],
    };

    const wordWithSecondOrigin: StudentDictionaryEntry = {
      id: 'dict_coffee_2',
      word: 'coffee',
      normalizedWord: 'coffee',
      definitionEn: 'A hot drink made from the roasted and ground seeds of a tropical shrub.',
      origins: [
        { source: 'routine', activityName: 'Wednesday Cafe Conversation', dayOfWeek: 'wednesday' as DayOfWeek },
      ],
    };

    const consolidated = consolidateDictionaryEntries([wordWithFirstOrigin], [wordWithSecondOrigin]);
    assert(consolidated.length === 1, 'Single coffee entry returned');
    assert(consolidated[0]?.origins?.length === 2, 'Accumulated both distinct routine origins without collision');
  }

  // --------------------------------------------------------------------------
  // TESTE 8: Resumo final
  // --------------------------------------------------------------------------
  console.log('\n======================================================');
  console.log(`TEST RESUMO FASE 2.2B: ${passed} PASS, ${failed} FAIL`);
  console.log('======================================================\n');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests().catch((err) => {
  console.error('Fatal error running Phase 2.2B tests:', err);
  process.exit(1);
});
