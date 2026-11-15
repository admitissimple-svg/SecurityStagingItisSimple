import assert from 'node:assert';
import fs from 'node:fs';
import { reconcileIncomingSentenceAnswers } from '../src/components/WeeklyHomeworkModal';
import {
  saveStudentHomeworkProgressToFirestore,
  subscribeToStudentHomeworkProgress,
  getHomeworkSaveSequence,
} from '../src/utils/studentPersistence';
import { auth } from '../src/firebase';

async function runTests() {
  console.log('🧪 Starting HOTFIX MEM.3 — Part 3 Typing Stability & Stale Async Guard Tests...\n');

  // =========================================================================
  // TEST 1: Continuous typing & dirty word protection in reconcileIncomingSentenceAnswers
  // =========================================================================
  console.log('▶ Test 1: Dirty local edits are never overwritten by stale incoming snapshots...');
  {
    const dirtyWords = new Set<string>(['stumbling']);
    const currentSentences = {
      hijacked: 'A group of terrorists hijacked the plane.',
      stumbling: 'He was stumbling down the stairs near the station.',
    };
    // Simulate older autosave echo or stale server response returning "He was stum"
    const staleIncoming = {
      hijacked: 'A group of terrorists hijacked the plane.',
      stumbling: 'He was stum',
    };

    const res = reconcileIncomingSentenceAnswers({
      currentSentences,
      incomingSentences: staleIncoming,
      dirtyWords,
    });

    assert.strictEqual(res.changed, false, 'Stale incoming snapshot must not trigger state change');
    assert.strictEqual(res.nextSentences, currentSentences, 'Exact object reference must be preserved');
    assert.strictEqual(
      res.nextSentences.stumbling,
      'He was stumbling down the stairs near the station.',
      'Typed sentence must remain completely intact'
    );
    console.log('  ✔ Dirty word protected from stale snapshot rollback.');
  }

  // =========================================================================
  // TEST 2: Clearing a dirty field stays cleared (not restored by older snapshot)
  // =========================================================================
  console.log('\n▶ Test 2: Intentionally cleared dirty field is not resurrected by old snapshot...');
  {
    const dirtyWords = new Set<string>(['stumbling']);
    const currentSentences = {
      hijacked: 'A group of terrorists hijacked the plane.',
      stumbling: '',
    };
    const staleIncoming = {
      hijacked: 'A group of terrorists hijacked the plane.',
      stumbling: 'He was stum',
    };

    const res = reconcileIncomingSentenceAnswers({
      currentSentences,
      incomingSentences: staleIncoming,
      dirtyWords,
    });

    assert.strictEqual(res.changed, false, 'Cleared dirty field must not be overwritten');
    assert.strictEqual(res.nextSentences.stumbling, '', 'Cleared field must stay empty');
    console.log('  ✔ Cleared dirty field stays empty.');
  }

  // =========================================================================
  // TEST 3: Multi-field editing — untouched empty field still hydrates from server
  // =========================================================================
  console.log('\n▶ Test 3: Multiple fields — untouched empty field hydrates while edited fields stay untouched...');
  {
    const dirtyWords = new Set<string>(['stumbling']);
    const currentSentences = {
      hijacked: 'A group of terrorists hijacked the plane.',
      stumbling: 'He was stumbling over his words during the meeting.',
      'take on me': '',
    };
    const incomingFromFirestore = {
      hijacked: 'Old version hijacked',
      stumbling: 'He was stum',
      'take on me': 'I decided to take on me the challenge.',
    };

    const res = reconcileIncomingSentenceAnswers({
      currentSentences,
      incomingSentences: incomingFromFirestore,
      dirtyWords,
    });

    assert.strictEqual(res.changed, true, 'Untouched empty field should hydrate');
    assert.strictEqual(
      res.nextSentences.hijacked,
      'A group of terrorists hijacked the plane.',
      'Non-empty non-dirty field must not be overwritten by older incoming text'
    );
    assert.strictEqual(
      res.nextSentences.stumbling,
      'He was stumbling over his words during the meeting.',
      'Dirty field must retain latest local text'
    );
    assert.strictEqual(
      res.nextSentences['take on me'],
      'I decided to take on me the challenge.',
      'Previously empty untouched field should hydrate from Firestore'
    );
    console.log('  ✔ Multi-field partial hydration preserves all active edits.');
  }

  // =========================================================================
  // TEST 4: Rapid sequential saves — strict FIFO ordering & stale event suppression
  // =========================================================================
  console.log('\n▶ Test 4: Rapid saves serialize in strict FIFO order and suppress stale homework-updated events...');
  {
    const originalFetch = globalThis.fetch;
    const originalWindow = (globalThis as any).window;
    const originalCurrentUserDescriptor = Object.getOwnPropertyDescriptor(auth, 'currentUser');
    const dispatchedEvents: any[] = [];
    const serverWrittenSentences: string[] = [];
    const uid = 'mem3_test_uid_' + Date.now();

    Object.defineProperty(auth, 'currentUser', {
      configurable: true,
      writable: true,
      value: { uid, email: 'student@test.com', getIdToken: async () => 'test-id-token' },
    });

    // Minimal window/CustomEvent shim for node test
    const listeners: Record<string, Array<(ev: any) => void>> = {};
    (globalThis as any).window = {
      addEventListener: (name: string, fn: (ev: any) => void) => {
        listeners[name] = listeners[name] || [];
        listeners[name].push(fn);
      },
      removeEventListener: (name: string, fn: (ev: any) => void) => {
        listeners[name] = (listeners[name] || []).filter((f) => f !== fn);
      },
      dispatchEvent: (ev: any) => {
        dispatchedEvents.push(ev.detail);
        (listeners[ev.type] || []).forEach((fn) => fn(ev));
        return true;
      },
    };
    if (typeof (globalThis as any).CustomEvent === 'undefined') {
      (globalThis as any).CustomEvent = class CustomEvent {
        type: string;
        detail: any;
        constructor(type: string, init?: { detail?: any }) {
          this.type = type;
          this.detail = init?.detail;
        }
      };
    }

    let resolveFirstFetch: () => void = () => {};
    let callCount = 0;

    globalThis.fetch = (async (_url: any, init?: any) => {
      callCount += 1;
      const myCall = callCount;
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      const sentenceVal = body?.weeklyHomework?.studentAnswers?.sentences?.stumbling || '';

      if (myCall === 1) {
        // Hold first save open so second save is queued behind it
        await new Promise<void>((resolve) => {
          resolveFirstFetch = resolve;
        });
      }
      serverWrittenSentences.push(sentenceVal);
      return new Response(
        JSON.stringify({
          success: true,
          weekId: 'week-1',
          weeklyCycle: 1,
          weeklyHomework: body.weeklyHomework,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }) as typeof fetch;

    try {
      const hw1: any = {
        id: 'week-1',
        weekId: 'week-1',
        weeklyCycle: 1,
        studentUid: uid,
        studentAnswers: { sentences: { stumbling: 'He was stum' } },
      };
      const hw2: any = {
        id: 'week-1',
        weekId: 'week-1',
        weeklyCycle: 1,
        studentUid: uid,
        studentAnswers: { sentences: { stumbling: 'He was stumbling carefully.' } },
      };

      const p1 = saveStudentHomeworkProgressToFirestore(uid, undefined, hw1, 'week-1');
      const p2 = saveStudentHomeworkProgressToFirestore(uid, undefined, hw2, 'week-1');

      // Wait a tick for p1 to enter fetch
      await new Promise((r) => setTimeout(r, 20));
      assert.strictEqual(callCount, 1, 'Second save must wait in FIFO queue while first save is in flight');
      assert.ok(getHomeworkSaveSequence(uid) >= 2, 'Sequence counter increments synchronously per save');

      resolveFirstFetch();
      const [ok1, ok2] = await Promise.all([p1, p2]);

      assert.strictEqual(ok1, true);
      assert.strictEqual(ok2, true);
      assert.deepStrictEqual(
        serverWrittenSentences,
        ['He was stum', 'He was stumbling carefully.'],
        'Server must receive saves in strict chronological order'
      );
      assert.strictEqual(
        dispatchedEvents.length,
        1,
        'Stale intermediate save must NOT dispatch its-simple:homework-updated event'
      );
      assert.strictEqual(
        dispatchedEvents[0].homework.studentAnswers.sentences.stumbling,
        'He was stumbling carefully.',
        'Only latest save dispatches update event'
      );
      console.log('  ✔ FIFO write queue & stale event suppression verified.');
    } finally {
      globalThis.fetch = originalFetch;
      (globalThis as any).window = originalWindow;
      if (originalCurrentUserDescriptor) {
        Object.defineProperty(auth, 'currentUser', originalCurrentUserDescriptor);
      } else {
        delete (auth as any).currentUser;
      }
    }
  }

  // =========================================================================
  // TEST 5: Stale initial GET in subscribeToStudentHomeworkProgress is dropped if a save occurred
  // =========================================================================
  console.log('\n▶ Test 5: In-flight GET does not overwrite newer local save...');
  {
    const originalFetch = globalThis.fetch;
    const originalWindow = (globalThis as any).window;
    const originalCurrentUserDescriptor = Object.getOwnPropertyDescriptor(auth, 'currentUser');
    const uid = 'mem3_get_race_' + Date.now();

    Object.defineProperty(auth, 'currentUser', {
      configurable: true,
      writable: true,
      value: { uid, email: 'student@test.com', getIdToken: async () => 'test-id-token' },
    });

    (globalThis as any).window = {
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => true,
    };

    let releaseGet: () => void = () => {};
    const receivedFromSub: any[] = [];

    globalThis.fetch = (async (url: any, init?: any) => {
      const urlStr = String(url);
      if ((!init?.method || init.method === 'GET') && urlStr.includes('/api/homework?')) {
        await new Promise<void>((resolve) => {
          releaseGet = resolve;
        });
        return new Response(
          JSON.stringify({
            id: 'week-1',
            weekId: 'week-1',
            weeklyCycle: 1,
            studentAnswers: { sentences: { stumbling: 'OLD SERVER VALUE' } },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      return new Response(
        JSON.stringify({
          success: true,
          weekId: 'week-1',
          weeklyCycle: 1,
          weeklyHomework: body.weeklyHomework,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }) as typeof fetch;

    try {
      const unsub = subscribeToStudentHomeworkProgress(
        uid,
        undefined,
        (hw) => {
          receivedFromSub.push(hw);
        },
        'week-1'
      );

      await new Promise((r) => setTimeout(r, 20));
      // Simulate user typing and saving while initial GET is still pending
      await saveStudentHomeworkProgressToFirestore(
        uid,
        undefined,
        {
          id: 'week-1',
          weekId: 'week-1',
          weeklyCycle: 1,
          studentAnswers: { sentences: { stumbling: 'NEW TYPED VALUE' } },
        } as any,
        'week-1'
      );

      releaseGet();
      await new Promise((r) => setTimeout(r, 20));
      unsub();

      const hasOldValue = receivedFromSub.some(
        (hw) => hw?.studentAnswers?.sentences?.stumbling === 'OLD SERVER VALUE'
      );
      assert.strictEqual(hasOldValue, false, 'Stale in-flight GET must be discarded after a newer save');
      console.log('  ✔ Stale in-flight GET safely discarded.');
    } finally {
      globalThis.fetch = originalFetch;
      (globalThis as any).window = originalWindow;
      if (originalCurrentUserDescriptor) {
        Object.defineProperty(auth, 'currentUser', originalCurrentUserDescriptor);
      } else {
        delete (auth as any).currentUser;
      }
    }
  }

  // =========================================================================
  // TEST 6: Structural checks on WeeklyHomeworkModal.tsx
  // =========================================================================
  console.log('\n▶ Test 6: Verifying structural invariants in WeeklyHomeworkModal.tsx...');
  {
    const modalCode = fs.readFileSync('src/components/WeeklyHomeworkModal.tsx', 'utf8');

    assert.ok(
      modalCode.includes('hydratedContextKeyRef.current !== weekContextKey'),
      'Hydration must only reset full local state when week/day context changes'
    );
    assert.ok(
      modalCode.includes('reconcileIncomingSentenceAnswers({'),
      'Same-context updates must reconcile without overwriting dirty/active sentences'
    );
    assert.ok(
      modalCode.includes('dirtySentenceKeysRef.current.add(prompt.word.trim().toLowerCase())'),
      'Typing in Part 3 textarea must mark the word key as dirty synchronously'
    );
    assert.ok(
      modalCode.includes('key={prompt.word || idx}'),
      'Part 3 prompt cards must use stable word-based React key to preserve focus and cursor'
    );
    assert.ok(
      modalCode.includes('flushPendingAutosave();'),
      'Pending debounced autosaves must flush on day switch, modal close, and unmount'
    );

    // Ensure autosave useEffect does not depend on `homework` prop (prevents timer reset & feedback loop)
    const autosaveDepsMatch = modalCode.match(
      /setTimeout\(\(\) => \{\s*autosaveTimerRef\.current = null;[\s\S]*?\}, 500\);[\s\S]*?\}, \[([^\]]+)\]\);/
    );
    assert.ok(autosaveDepsMatch, 'Autosave effect dependency array must be present');
    const deps = autosaveDepsMatch[1];
    assert.strictEqual(
      deps.split(',').some((d) => d.trim() === 'homework'),
      false,
      'Autosave effect must NOT depend on homework prop reference'
    );
    assert.strictEqual(
      deps.split(',').some((d) => d.trim() === 'onSaveProgress'),
      false,
      'Autosave effect must NOT depend on onSaveProgress callback identity'
    );

    console.log('  ✔ All structural invariants in WeeklyHomeworkModal.tsx verified.');
  }

  console.log('\n=================================================================');
  console.log('🎉 ALL HOTFIX MEM.3 TESTS PASSED SUCCESSFULLY!');
  console.log('=================================================================\n');
}

runTests().catch((err) => {
  console.error('❌ Test suite failed:', err);
  process.exit(1);
});
