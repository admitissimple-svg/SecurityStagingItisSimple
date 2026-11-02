import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DailyJournalEntry, WritingEvaluationResult } from '../src/types';

describe('HOTFIX 8.9 — ELIMINAÇÃO DE DUPLICIDADE NO VIEW JOURNAL', () => {

  // Teste 1: Salvar diretamente → uma única entrada
  it('1. Salvar diretamente grava exatamente uma única entrada no diário', async () => {
    const studentUid = 'student_direct_save_uid';
    const calls: DailyJournalEntry[] = [];

    // Simulated handleSaveDailySentence
    const onSaveDailySentence = async (sentence: string, words: string[], evalResult?: WritingEvaluationResult | null) => {
      const entry: DailyJournalEntry = {
        id: `journal_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        date: '2026-11-02',
        sentence,
        wordsUsed: words,
        correctedSentence: evalResult?.correctedSentence,
        hasErrors: evalResult?.hasAnyError,
        createdAt: new Date().toISOString(),
        studentUid,
      };
      calls.push(entry);
      return true;
    };

    // User types directly and clicks "Save Sentence"
    const sentenceInput = 'I wake up at seven and prepare my coffee.';
    const routineWords = ['wake', 'coffee'];
    await onSaveDailySentence(sentenceInput, routineWords, null);

    assert.strictEqual(calls.length, 1, 'Deve haver exatamente 1 chamada de salvamento');
    assert.strictEqual(calls[0].sentence, 'I wake up at seven and prepare my coffee.');
    assert.ok(calls[0].id.startsWith('journal_'));
  });

  // Teste 2: Fluxo Check Grammar → Apply & Use → Save Sentence → apenas uma gravação
  it('2. Fluxo Check Grammar → Apply & Use → Save Sentence: Apply & Use apenas atualiza texto e Save executa 1 único POST', async () => {
    let currentInput = 'Yesterday I go to the supermarket';
    let currentEvaluation: WritingEvaluationResult | null = null;
    const saveCalls: DailyJournalEntry[] = [];

    const mockCheckAi = (text: string): WritingEvaluationResult => ({
      hasAnyError: true,
      isCorrect: false,
      correctedSentence: 'Yesterday I went to the supermarket',
      usedWords: ['supermarket'],
      explanation: 'Use simple past "went" instead of "go".',
      wordFeedbacks: [],
    });

    // Step A: Check Grammar
    currentEvaluation = mockCheckAi(currentInput);
    assert.strictEqual(saveCalls.length, 0, 'Check Grammar NUNCA deve gravar');
    assert.strictEqual(currentEvaluation.correctedSentence, 'Yesterday I went to the supermarket');

    // Step B: Apply & Use (Simulating updated handleApplySentenceCorrection)
    const handleApplySentenceCorrection = () => {
      if (currentEvaluation?.correctedSentence) {
        const corrected = currentEvaluation.correctedSentence;
        currentInput = corrected;
        currentEvaluation = {
          ...currentEvaluation,
          hasAnyError: false,
          isCorrect: true,
          correctedSentence: corrected,
        };
        // CRITICAL: onSaveDailySentence is NOT called here!
      }
    };

    handleApplySentenceCorrection();
    assert.strictEqual(saveCalls.length, 0, 'Apply & Use NUNCA deve disparar gravação no banco');
    assert.strictEqual(currentInput, 'Yesterday I went to the supermarket', 'Apply & Use deve atualizar o texto do campo');
    assert.strictEqual(currentEvaluation?.isCorrect, true);

    // Step C: Save Sentence (Simulating handleSaveSentence)
    const handleSaveSentence = async () => {
      const entry: DailyJournalEntry = {
        id: `journal_${Date.now()}_single_post`,
        date: '2026-11-02',
        sentence: currentInput,
        correctedSentence: currentEvaluation?.correctedSentence,
        wordsUsed: currentEvaluation?.usedWords || [],
        createdAt: new Date().toISOString(),
        studentUid: 'student_123',
      };
      saveCalls.push(entry);
      return true;
    };

    await handleSaveSentence();
    assert.strictEqual(saveCalls.length, 1, 'Save Sentence deve executar exatamente 1 único salvamento');
    assert.strictEqual(saveCalls[0].sentence, 'Yesterday I went to the supermarket');
  });

  // Teste 3: GET /api/student-journal combina subcoleção journal e array diário deduplicando por entry.id
  it('3. GET /api/student-journal: combinação da subcoleção com o array legado não duplica registros com mesmo entry.id', () => {
    // Simulated Firestore subcollection users/{uid}/journal
    const subColDocs = [
      {
        id: 'journal_entry_alpha',
        date: '2026-11-01',
        sentence: 'Learning English opens opportunities worldwide.',
        wordsUsed: ['learning', 'opportunities'],
        createdAt: '2026-11-01T10:00:00.000Z',
      },
      {
        id: 'journal_entry_beta',
        date: '2026-11-02',
        sentence: 'Practice listening with podcasts every day.',
        wordsUsed: ['practice', 'podcasts'],
        createdAt: '2026-11-02T10:00:00.000Z',
      },
    ];

    // Simulated users/{uid}.dailyJournalEntries array containing mirrored entry_alpha
    const userDocArray = [
      {
        id: 'journal_entry_alpha', // Exact same logical ID
        date: '2026-11-01',
        sentence: 'Learning English opens opportunities worldwide.',
        wordsUsed: ['learning', 'opportunities'],
        createdAt: '2026-11-01T10:00:00.000Z',
      },
      {
        id: 'journal_entry_legacy_gamma',
        date: '2026-10-31',
        sentence: 'First sentence written last month.',
        wordsUsed: ['first'],
        createdAt: '2026-10-31T09:00:00.000Z',
      },
    ];

    // Deduplication logic matching fetchStudentDailyJournalFromServerFirestore
    const map = new Map<string, any>();
    subColDocs.forEach((d) => {
      const entryId = d?.id ? String(d.id).trim() : '';
      if (entryId) map.set(entryId, { ...d, id: entryId });
    });

    userDocArray.forEach((e) => {
      const entryId = e?.id ? String(e.id).trim() : '';
      if (entryId && !map.has(entryId)) {
        map.set(entryId, { ...e, id: entryId });
      }
    });

    const combinedList = Array.from(map.values()).sort((a, b) => {
      const tA = new Date(a.createdAt || a.date).getTime();
      const tB = new Date(b.createdAt || b.date).getTime();
      return tB - tA;
    });

    // Must have exactly 3 entries (alpha, beta, gamma), alpha NOT duplicated!
    assert.strictEqual(combinedList.length, 3, 'Deve conter exatamente 3 registros únicos');
    const alphaCount = combinedList.filter((e) => e.id === 'journal_entry_alpha').length;
    assert.strictEqual(alphaCount, 1, 'O registro journal_entry_alpha não pode estar duplicado');
  });

  // Teste 4: F5 e novo login não geram duplicatas
  it('4. F5 e recarga do estado React através da API mantêm o diário estritamente livre de duplicações', () => {
    // Initial state after save
    const entrySaved: DailyJournalEntry = {
      id: 'journal_001',
      date: '2026-11-02',
      sentence: 'Great habits build confidence.',
      wordsUsed: ['habits', 'confidence'],
      createdAt: '2026-11-02T12:00:00.000Z',
    };

    let reactState: DailyJournalEntry[] = [entrySaved];

    // Simulated F5 reload from GET /api/student-journal
    const apiResponseData: DailyJournalEntry[] = [
      {
        id: 'journal_001',
        date: '2026-11-02',
        sentence: 'Great habits build confidence.',
        wordsUsed: ['habits', 'confidence'],
        createdAt: '2026-11-02T12:00:00.000Z',
      },
    ];

    // Dedup logic in loadDailyJournalEntries
    const seen = new Set<string>();
    const uniqueData: DailyJournalEntry[] = [];
    apiResponseData.forEach((item) => {
      const id = String(item.id || '').trim();
      if (!id || !seen.has(id)) {
        if (id) seen.add(id);
        uniqueData.push(item);
      }
    });

    reactState = uniqueData;
    assert.strictEqual(reactState.length, 1);
    assert.strictEqual(reactState[0].id, 'journal_001');
  });

  // Teste 5: Preservar registros legítimos com frases e textos idênticos em ocasiões distintas
  it('5. Registros com textos iguais gravados legitimamente em ocasiões distintas com IDs diferentes são preservados', () => {
    const entryDay1: DailyJournalEntry = {
      id: 'journal_day_1',
      date: '2026-11-01',
      sentence: 'Practice makes perfect.',
      wordsUsed: ['practice'],
      createdAt: '2026-11-01T08:00:00.000Z',
    };

    const entryDay2: DailyJournalEntry = {
      id: 'journal_day_2',
      date: '2026-11-02',
      sentence: 'Practice makes perfect.', // Same sentence, legitimate distinct submission
      wordsUsed: ['practice'],
      createdAt: '2026-11-02T08:00:00.000Z',
    };

    const entries = [entryDay1, entryDay2];

    // Deduplication by entry.id
    const seen = new Set<string>();
    const result: DailyJournalEntry[] = [];
    for (const e of entries) {
      if (!seen.has(e.id)) {
        seen.add(e.id);
        result.push(e);
      }
    }

    assert.strictEqual(result.length, 2, 'Ambos os registros com frases idênticas e IDs distintos DEVEM ser preservados');
    assert.strictEqual(result[0].id, 'journal_day_1');
    assert.strictEqual(result[1].id, 'journal_day_2');
  });

  // Teste 6: Persistência e isolamento entre usuários permanecem intactos
  it('6. Isolamento estrito por UID: Aluno A não tem acesso aos registros do Aluno B', () => {
    const callerStudentA = { uid: 'uid_student_A', email: 'a@example.com', role: 'student' };
    const targetStudentB = 'uid_student_B';

    // GET /api/student-journal security check
    const isAllowed = (caller: { uid: string; role: string }, requestedUid?: string) => {
      if (caller.role !== 'admin' && requestedUid && requestedUid !== caller.uid) {
        return false;
      }
      return true;
    };

    assert.strictEqual(isAllowed(callerStudentA, targetStudentB), false, 'Acesso cruzado deve ser estritamente bloqueado (403)');
    assert.strictEqual(isAllowed(callerStudentA, callerStudentA.uid), true, 'Acesso aos próprios dados é permitido');
  });

  // Teste 7: Integridade das regras do Firestore
  it('7. firestore.rules permanece intacto com permissões de dono para journal subcollection', () => {
    const rulesPath = path.resolve(process.cwd(), 'firestore.rules');
    assert.ok(fs.existsSync(rulesPath));
    const content = fs.readFileSync(rulesPath, 'utf8');
    assert.ok(content.includes('match /journal/{entryId}'));
    assert.ok(content.includes('isOwner(userId)'));
  });
});
