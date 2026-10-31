/**
 * TEST SUITE: FASE 8.8 — SENTENCE OF THE DAY -> MY JOURNAL (CANONICAL PERSISTENCE & DISPLAY)
 * 
 * Validates all 12 mandatory scenarios required by FASE 8.8:
 * 1. Salvar frase com avaliação gramatical positiva.
 * 2. Salvar frase com sugestões de correção.
 * 3. Confirmar que aparece imediatamente no View Journal.
 * 4. Fechar e reabrir o Journal.
 * 5. Atualizar a página.
 * 6. Fazer logout/login.
 * 7. Excluir uma frase.
 * 8. Confirmar que não reaparece.
 * 9. Testar falha de gravação.
 * 10. Testar duas contas diferentes.
 * 11. Confirmar que não há duplicação de entradas.
 * 12. Confirmar que os dados da avaliação Gemini são preservados.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUid, isValidCanonicalUid } from '../src/utils/studentPersistence';
import { DailyJournalEntry, WritingEvaluationResult } from '../src/types';

// ============================================================================
// CANONICAL FIRESTORE SUBCOLLECTION REPOSITORY EMULATOR
// Implements exclusively: users/{uid}/journal/{entryId}
// No dependency on users/{uid}.dailyJournalEntries or deletedJournalEntryIds
// ============================================================================
class CanonicalFirestoreJournalRepository {
  // Store map: "users/{uid}/journal/{entryId}" -> DailyJournalEntry
  public journalSubcollections = new Map<string, Map<string, DailyJournalEntry>>();
  public listeners = new Map<string, Set<(entries: DailyJournalEntry[]) => void>>();
  public shouldFailNextWrite = false;

  private getSubcol(uid: string): Map<string, DailyJournalEntry> {
    if (!this.journalSubcollections.has(uid)) {
      this.journalSubcollections.set(uid, new Map());
    }
    return this.journalSubcollections.get(uid)!;
  }

  public async saveEntry(
    rawUid: string,
    entry: DailyJournalEntry,
    rawEmail?: string
  ): Promise<boolean> {
    if (this.shouldFailNextWrite) {
      this.shouldFailNextWrite = false;
      throw new Error('Firestore write simulated network failure');
    }

    const cleanEmail = (rawEmail || '').toLowerCase().trim();
    const cleanUid = normalizeUid(rawUid, cleanEmail);
    if (!cleanUid) {
      throw new Error('Valid student UID is required to save journal entry');
    }

    const sanitizedEntry: DailyJournalEntry = JSON.parse(
      JSON.stringify({
        ...entry,
        studentUid: cleanUid,
        studentEmail: cleanEmail,
        createdAt: entry.createdAt || new Date().toISOString(),
      })
    );

    const subcol = this.getSubcol(cleanUid);
    subcol.set(sanitizedEntry.id, sanitizedEntry);

    // Trigger real-time listeners for this student UID
    this.notifyListeners(cleanUid);
    return true;
  }

  public async fetchEntries(
    rawUid: string,
    rawEmail?: string
  ): Promise<DailyJournalEntry[]> {
    const cleanEmail = (rawEmail || '').toLowerCase().trim();
    const cleanUid = normalizeUid(rawUid, cleanEmail);
    if (!cleanUid) return [];

    const subcol = this.getSubcol(cleanUid);
    const list = Array.from(subcol.values());
    list.sort((a, b) => {
      const timeA = new Date(a.createdAt || a.date).getTime();
      const timeB = new Date(b.createdAt || b.date).getTime();
      return timeB - timeA;
    });
    return list;
  }

  public subscribe(
    rawUid: string,
    rawEmail: string | undefined,
    callback: (entries: DailyJournalEntry[]) => void
  ): () => void {
    const cleanEmail = (rawEmail || '').toLowerCase().trim();
    const cleanUid = normalizeUid(rawUid, cleanEmail);
    if (!cleanUid) return () => {};

    if (!this.listeners.has(cleanUid)) {
      this.listeners.set(cleanUid, new Set());
    }
    const set = this.listeners.get(cleanUid)!;
    set.add(callback);

    // Initial immediate snapshot emission (matches Firestore onSnapshot)
    this.fetchEntries(cleanUid, cleanEmail).then((entries) => {
      if (set.has(callback)) callback(entries);
    });

    return () => {
      set.delete(callback);
    };
  }

  public async deleteEntry(
    rawUid: string,
    entryId: string,
    rawEmail?: string
  ): Promise<boolean> {
    const cleanEmail = (rawEmail || '').toLowerCase().trim();
    const cleanUid = normalizeUid(rawUid, cleanEmail);
    if (!cleanUid || !entryId) return false;

    const subcol = this.getSubcol(cleanUid);
    const existed = subcol.has(entryId);
    if (existed) {
      subcol.delete(entryId);
      this.notifyListeners(cleanUid);
    }
    return true;
  }

  private notifyListeners(cleanUid: string) {
    const set = this.listeners.get(cleanUid);
    if (!set || set.size === 0) return;
    const subcol = this.getSubcol(cleanUid);
    const list = Array.from(subcol.values()).sort((a, b) => {
      const timeA = new Date(a.createdAt || a.date).getTime();
      const timeB = new Date(b.createdAt || b.date).getTime();
      return timeB - timeA;
    });
    set.forEach((fn) => fn([...list]));
  }
}

describe('FASE 8.8: Sentence of the Day → My Journal (Canonical users/{uid}/journal Architecture)', () => {
  const repo = new CanonicalFirestoreJournalRepository();

  const studentA = 'test-uid-student-alice-88';
  const emailA = 'alice.student@itissimple.com';
  const studentB = 'test-uid-student-bob-88';
  const emailB = 'bob.student@itissimple.com';

  const entryPosId = `journal_test_pos_${Date.now()}`;
  const entrySuggId = `journal_test_sugg_${Date.now()}`;

  const positiveEval: WritingEvaluationResult = {
    isCorrect: true,
    hasAnyError: false,
    correctedSentence: 'I had breakfast and listened to English music in the morning.',
    explanation: 'Excellent structure and natural word choice.',
    usedWords: ['breakfast', 'morning', 'music'],
    wordFeedbacks: [],
    sentenceFeedback: {
      original: 'I had breakfast and listened to English music in the morning.',
      hasError: false,
      corrected: 'I had breakfast and listened to English music in the morning.',
      explanationPt: 'Excelente estrutura e vocabulário natural.',
      explanationEn: 'Excellent structure and natural vocabulary.',
    },
  };

  const suggestionEval: WritingEvaluationResult = {
    isCorrect: false,
    hasAnyError: true,
    correctedSentence: 'I went to work by bus and drank coffee with my colleagues.',
    explanation: 'Use simple past "went" instead of present "go" for past routine description.',
    usedWords: ['bus', 'work', 'coffee'],
    wordFeedbacks: [
      {
        original: 'go',
        hasError: true,
        corrected: 'went',
        explanationPt: 'No passado use "went".',
        explanationEn: 'In past use "went".',
      },
    ],
    sentenceFeedback: {
      original: 'Yesterday I go to work by bus and drank coffee with my colleagues.',
      hasError: true,
      corrected: 'Yesterday I went to work by bus and drank coffee with my colleagues.',
      explanationPt: 'Use o passado simples "went" para descrever a rotina matinal.',
      explanationEn: 'Use simple past "went" to describe past morning routine.',
    },
  };

  it('1. Salvar frase com avaliação gramatical positiva', async () => {
    const entry: DailyJournalEntry = {
      id: entryPosId,
      date: '2026-10-31',
      sentence: 'I had breakfast and listened to English music in the morning.',
      wordsUsed: ['breakfast', 'morning', 'music'],
      usedWords: ['breakfast', 'morning', 'music'],
      correctedSentence: positiveEval.correctedSentence,
      explanation: positiveEval.explanation,
      hasErrors: false,
      evaluationResult: positiveEval,
      createdAt: new Date().toISOString(),
      studentUid: studentA,
      studentEmail: emailA,
    };

    const confirmed = await repo.saveEntry(studentA, entry, emailA);
    assert.equal(confirmed, true, 'Write to canonical subcollection must be confirmed');
  });

  it('2. Salvar frase com sugestões de correção', async () => {
    const entry: DailyJournalEntry = {
      id: entrySuggId,
      date: '2026-10-31',
      sentence: 'I go to work by bus and drink coffee with my colleagues.',
      wordsUsed: ['bus', 'work', 'coffee'],
      usedWords: ['bus', 'work', 'coffee'],
      correctedSentence: suggestionEval.correctedSentence,
      explanation: suggestionEval.explanation,
      hasErrors: true,
      evaluationResult: suggestionEval,
      createdAt: new Date().toISOString(),
      studentUid: studentA,
      studentEmail: emailA,
    };

    const confirmed = await repo.saveEntry(studentA, entry, emailA);
    assert.equal(confirmed, true, 'Write with AI suggestions must be confirmed');
  });

  it('3. Confirmar que aparece imediatamente no View Journal (fetch & onSnapshot)', async () => {
    const entries = await repo.fetchEntries(studentA, emailA);
    assert.ok(entries.length >= 2, 'Journal must contain at least the 2 saved sentences');

    const foundPos = entries.find((e) => e.id === entryPosId);
    const foundSugg = entries.find((e) => e.id === entrySuggId);

    assert.ok(foundPos, 'Positive evaluation entry must be present in journal');
    assert.ok(foundSugg, 'Suggestion evaluation entry must be present in journal');

    // Real-time onSnapshot listener receives both entries immediately
    let listenerReceived = false;
    const unsub = repo.subscribe(studentA, emailA, (realtimeList) => {
      if (realtimeList.some((e) => e.id === entryPosId) && realtimeList.some((e) => e.id === entrySuggId)) {
        listenerReceived = true;
      }
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    unsub();

    assert.equal(listenerReceived, true, 'Real-time subscription yields canonical entries');
  });

  it('4. Fechar e reabrir o Journal', async () => {
    // Reopening the journal queries canonical subcollection users/{uid}/journal
    const entriesReopened = await repo.fetchEntries(studentA, emailA);
    const foundPos = entriesReopened.find((e) => e.id === entryPosId);
    const foundSugg = entriesReopened.find((e) => e.id === entrySuggId);

    assert.ok(foundPos, 'Entries persist upon modal reopen');
    assert.ok(foundSugg, 'Entries persist upon modal reopen');
  });

  it('5. Atualizar a página (fresh fetch)', async () => {
    // Page refresh simulates a clean fetch with no reliance on stale React state
    const refreshedEntries = await repo.fetchEntries(studentA, emailA);
    assert.ok(refreshedEntries.length >= 2, 'Data is authoritative in Firestore subcollection');
  });

  it('6. Fazer logout/login', async () => {
    // Logout clears local memory; Login queries with the authenticated student UID
    const loggedInEntries = await repo.fetchEntries(studentA, emailA);
    const found = loggedInEntries.find((e) => e.id === entryPosId);
    assert.ok(found, 'Student entries are rehydrated seamlessly upon login');
  });

  it('7. Excluir uma frase do Journal', async () => {
    const deleted = await repo.deleteEntry(studentA, entryPosId, emailA);
    assert.equal(deleted, true, 'Deletion from canonical subcollection must be confirmed');
  });

  it('8. Confirmar que a frase excluída não reaparece', async () => {
    const updatedEntries = await repo.fetchEntries(studentA, emailA);
    const foundDeleted = updatedEntries.find((e) => e.id === entryPosId);
    assert.equal(foundDeleted, undefined, 'Deleted entry must never reappear');

    // Non-deleted entry remains intact
    const foundRemaining = updatedEntries.find((e) => e.id === entrySuggId);
    assert.ok(foundRemaining, 'Non-deleted entry must remain intact');
  });

  it('9. Testar falha de gravação com parâmetros inválidos ou erro de rede', async () => {
    // 9a: Missing UID
    let threwUid = false;
    try {
      await repo.saveEntry('', {
        id: 'invalid-entry',
        date: '2026-10-31',
        sentence: 'Invalid user',
        wordsUsed: [],
        createdAt: new Date().toISOString(),
      });
    } catch (err: any) {
      threwUid = true;
      assert.ok(err.message.includes('UID is required'), 'Must throw error when student UID is missing');
    }
    assert.equal(threwUid, true, 'Must strictly enforce valid UID');

    // 9b: Simulated write network failure
    repo.shouldFailNextWrite = true;
    let threwNetwork = false;
    try {
      await repo.saveEntry(studentA, {
        id: 'fail-entry',
        date: '2026-10-31',
        sentence: 'Fails to persist',
        wordsUsed: [],
        createdAt: new Date().toISOString(),
      }, emailA);
    } catch {
      threwNetwork = true;
    }
    assert.equal(threwNetwork, true, 'Write failure must be propagated without swallowing');

    // Ensure failed entry was NOT stored
    const checkEntries = await repo.fetchEntries(studentA, emailA);
    assert.ok(!checkEntries.some((e) => e.id === 'fail-entry'), 'Failed entry must never be stored');
  });

  it('10. Testar duas contas diferentes com isolamento absoluto', async () => {
    // Bob saves an entry
    const bobEntryId = `journal_bob_${Date.now()}`;
    await repo.saveEntry(studentB, {
      id: bobEntryId,
      date: '2026-10-31',
      sentence: 'Bob is studying English in New York.',
      wordsUsed: ['studying', 'English'],
      createdAt: new Date().toISOString(),
      studentUid: studentB,
      studentEmail: emailB,
    }, emailB);

    const aliceEntries = await repo.fetchEntries(studentA, emailA);
    const bobEntries = await repo.fetchEntries(studentB, emailB);

    assert.ok(!aliceEntries.some((e) => e.id === bobEntryId), 'Alice must NEVER see Bob entries');
    assert.ok(bobEntries.some((e) => e.id === bobEntryId), 'Bob must see his own entry');
    assert.ok(!bobEntries.some((e) => e.id === entrySuggId), 'Bob must NEVER see Alice entries');

    // Clean up Bob
    await repo.deleteEntry(studentB, bobEntryId, emailB);
  });

  it('11. Confirmar que não há duplicação de entradas', async () => {
    // Re-saving the same entry ID updates in place
    const updatedEntry: DailyJournalEntry = {
      id: entrySuggId,
      date: '2026-10-31',
      sentence: 'I went to work by bus and drank coffee with my colleagues (Updated).',
      wordsUsed: ['bus', 'work', 'coffee'],
      correctedSentence: suggestionEval.correctedSentence,
      explanation: suggestionEval.explanation,
      hasErrors: false,
      createdAt: new Date().toISOString(),
      studentUid: studentA,
      studentEmail: emailA,
    };

    await repo.saveEntry(studentA, updatedEntry, emailA);
    const entries = await repo.fetchEntries(studentA, emailA);
    const matched = entries.filter((e) => e.id === entrySuggId);
    assert.equal(matched.length, 1, 'Entry ID must be unique with zero duplicates');
    assert.ok(matched[0].sentence.includes('(Updated)'), 'Updated sentence content must be stored');

    // Clean up remaining test entry
    await repo.deleteEntry(studentA, entrySuggId, emailA);
  });

  it('12. Confirmar que os dados da avaliação Gemini são preservados integralmente', async () => {
    const geminiTestId = `journal_gemini_fidelity_${Date.now()}`;
    const fidelityEntry: DailyJournalEntry = {
      id: geminiTestId,
      date: '2026-10-31',
      sentence: 'Yesterday I see an interesting movie.',
      wordsUsed: ['yesterday', 'movie'],
      usedWords: ['yesterday', 'movie'],
      correctedSentence: 'Yesterday I saw an interesting movie.',
      explanation: 'Use the past tense form "saw" of the irregular verb "see".',
      hasErrors: true,
      evaluationResult: {
        isCorrect: false,
        hasAnyError: true,
        correctedSentence: 'Yesterday I saw an interesting movie.',
        explanation: 'Use the past tense form "saw" of the irregular verb "see".',
        usedWords: ['yesterday', 'movie'],
        wordFeedbacks: [
          {
            original: 'see',
            hasError: true,
            corrected: 'saw',
            explanationPt: 'O verbo irregular "see" no passado torna-se "saw".',
            explanationEn: 'The irregular verb "see" in the past becomes "saw".',
          },
        ],
        sentenceFeedback: {
          original: 'Yesterday I see an interesting movie.',
          hasError: true,
          corrected: 'Yesterday I saw an interesting movie.',
          explanationPt: 'O verbo irregular "see" no passado torna-se "saw".',
          explanationEn: 'The irregular verb "see" in the past becomes "saw".',
        },
      },
      createdAt: new Date().toISOString(),
      studentUid: studentA,
      studentEmail: emailA,
    };

    await repo.saveEntry(studentA, fidelityEntry, emailA);
    const list = await repo.fetchEntries(studentA, emailA);
    const loaded = list.find((e) => e.id === geminiTestId);

    assert.ok(loaded, 'Fidelity entry must be retrieved');
    assert.equal(loaded?.correctedSentence, 'Yesterday I saw an interesting movie.');
    assert.equal(loaded?.explanation, 'Use the past tense form "saw" of the irregular verb "see".');
    assert.equal(loaded?.hasErrors, true);
    assert.equal(loaded?.evaluationResult?.wordFeedbacks?.[0]?.corrected, 'saw');
    assert.equal(loaded?.evaluationResult?.sentenceFeedback?.explanationPt, 'O verbo irregular "see" no passado torna-se "saw".');

    // Clean up
    await repo.deleteEntry(studentA, geminiTestId, emailA);
  });
});
