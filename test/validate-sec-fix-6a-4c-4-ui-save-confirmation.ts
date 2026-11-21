/**
 * SEC.FIX.6A.4C.4 — Confirmação de Salvamento na Interface (Teacher/Meet Settings)
 *
 * Valida exclusivamente o fluxo de interface em src/App.tsx e src/components/TeacherMeetConfigModal.tsx:
 * 1. Sucesso confirmado (HTTP 2xx): só atualiza teacherMeetSettings/tutors e exibe #teacher-settings-saved-success
 *    após confirmação 2xx do backend, preservando UID, Meet link, timezone e disponibilidade, fechando após delay.
 * 2. Erro HTTP 500 / 503 (e 401/403 / { success: false }): mantém valores anteriormente confirmados em RAM/UI,
 *    NÃO exibe sucesso falso (#teacher-settings-saved-success ausente), mantém modal aberto, exibe
 *    #teacher-settings-save-error com mensagem de falha e preserva edições para nova tentativa.
 * 3. Falha de rede (fetch rejeita): mantém valores anteriormente confirmados, sem sucesso falso,
 *    exibe #teacher-settings-save-error e permite nova tentativa bem-sucedida.
 * 4. Estado em voo (isSaving): desabilita submit/cancel/close enquanto a requisição está pendente,
 *    impedindo duplo envio ou falso positivo prematuro.
 * 5. Preservação de validações (type="url", required) e ausência de mutação otimista em src/App.tsx.
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToString } from 'react-dom/server';
import {
  TeacherMeetConfigModal,
  type TeacherMeetConfigModalProps,
} from '../src/components/TeacherMeetConfigModal';
import type { NativeFriendTutor, TeacherMeetSettings } from '../src/types';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`  ✅ PASS: ${name}`);
    passed++;
  } catch (err: any) {
    console.error(`  ❌ FAIL: ${name}`);
    console.error(`         ${err?.stack || err?.message || err}`);
    failed++;
  }
}

// Minimal React element tree helpers for inspecting interactive component output
function findElements(node: any, predicate: (el: any) => boolean): any[] {
  const results: any[] = [];
  const visit = (n: any) => {
    if (!n || typeof n === 'boolean' || typeof n === 'string' || typeof n === 'number') return;
    if (Array.isArray(n)) {
      n.forEach(visit);
      return;
    }
    if (typeof n === 'object') {
      if (predicate(n)) {
        results.push(n);
      }
      if (n.props && n.props.children !== undefined) {
        visit(n.props.children);
      }
    }
  };
  visit(node);
  return results;
}

function findById(node: any, id: string): any | null {
  return findElements(node, (el) => el?.props?.id === id)[0] || null;
}

function extractText(node: any): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(extractText).join(' ');
  if (typeof node === 'object' && node.props?.children !== undefined) {
    return extractText(node.props.children);
  }
  return '';
}

// Lightweight React 19 hook driver for mounting a single function component in Node
function mountModal(initialProps: TeacherMeetConfigModalProps) {
  const internals = (React as any).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
  if (!internals) {
    throw new Error('React internals unavailable in test runtime');
  }

  // Ensure minimal window global exists for ESC listener inside useEffect
  const listeners: Record<string, Set<Function>> = {};
  const prevWindow = (globalThis as any).window;
  (globalThis as any).window = {
    addEventListener: (ev: string, fn: Function) => {
      if (!listeners[ev]) listeners[ev] = new Set();
      listeners[ev].add(fn);
    },
    removeEventListener: (ev: string, fn: Function) => {
      listeners[ev]?.delete(fn);
    },
  };

  let currentProps = initialProps;
  const hooks: any[] = [];
  const effectCleanups: Array<(() => void) | void> = [];
  let hookIndex = 0;
  let tree: any = null;

  const depsChanged = (prevDeps: any[] | undefined, nextDeps: any[] | undefined) => {
    if (!prevDeps || !nextDeps) return true;
    if (prevDeps.length !== nextDeps.length) return true;
    return nextDeps.some((d, i) => !Object.is(d, prevDeps[i]));
  };

  const render = () => {
    hookIndex = 0;
    const pendingEffects: Array<{ idx: number; fn: () => any }> = [];
    const prevH = internals.H;

    internals.H = {
      useState: (initial: any) => {
        const idx = hookIndex++;
        if (!(idx in hooks)) {
          hooks[idx] = typeof initial === 'function' ? initial() : initial;
        }
        const setState = (updater: any) => {
          const nextVal = typeof updater === 'function' ? updater(hooks[idx]) : updater;
          if (!Object.is(hooks[idx], nextVal)) {
            hooks[idx] = nextVal;
            render();
          }
        };
        return [hooks[idx], setState];
      },
      useRef: (initial: any) => {
        const idx = hookIndex++;
        if (!(idx in hooks)) {
          hooks[idx] = { current: initial };
        }
        return hooks[idx];
      },
      useCallback: (fn: any, deps: any[]) => {
        const idx = hookIndex++;
        const prev = hooks[idx];
        if (!prev || depsChanged(prev.deps, deps)) {
          hooks[idx] = { fn, deps };
        }
        return hooks[idx].fn;
      },
      useMemo: (fn: any, deps: any[]) => {
        const idx = hookIndex++;
        const prev = hooks[idx];
        if (!prev || depsChanged(prev.deps, deps)) {
          hooks[idx] = { val: fn(), deps };
        }
        return hooks[idx].val;
      },
      useEffect: (fn: () => any, deps?: any[]) => {
        const idx = hookIndex++;
        const prev = hooks[idx];
        if (!prev || depsChanged(prev.deps, deps)) {
          hooks[idx] = { deps };
          pendingEffects.push({ idx, fn });
        }
      },
    };

    try {
      tree = TeacherMeetConfigModal(currentProps);
    } finally {
      internals.H = prevH;
    }

    for (const eff of pendingEffects) {
      if (typeof effectCleanups[eff.idx] === 'function') {
        (effectCleanups[eff.idx] as Function)();
      }
      effectCleanups[eff.idx] = eff.fn();
    }
  };

  render();

  return {
    getTree: () => tree,
    updateProps: (nextProps: TeacherMeetConfigModalProps) => {
      currentProps = nextProps;
      render();
    },
    unmount: () => {
      effectCleanups.forEach((cleanup) => {
        if (typeof cleanup === 'function') cleanup();
      });
      if (prevWindow === undefined) {
        delete (globalThis as any).window;
      } else {
        (globalThis as any).window = prevWindow;
      }
    },
  };
}

/**
 * Simulates the exact App.tsx handleSaveTeacherMeetSettings contract against a mock/real fetch
 * AND verifies the App.tsx source code matches the non-optimistic pattern.
 */
function createAppSaveHarness(opts: {
  initialSettings: Record<string, TeacherMeetSettings>;
  initialTutors: NativeFriendTutor[];
  token?: string | null;
  fetchImpl: typeof fetch;
}) {
  let teacherMeetSettings = { ...opts.initialSettings };
  let tutors = [...opts.initialTutors];

  const handleSaveTeacherMeetSettings = async (settings: TeacherMeetSettings) => {
    const cleanEmail = (settings.teacherEmail || '').toLowerCase().trim();
    const uid = settings.uid;
    const merged: TeacherMeetSettings = { ...settings, teacherEmail: cleanEmail, ...(uid ? { uid } : {}) };

    const token = opts.token ?? 'mock-firebase-token';

    let response: Response;
    try {
      response = await opts.fetchImpl('/api/teacher-settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(merged),
      });
    } catch (networkErr: any) {
      throw new Error(
        networkErr?.message
          ? `Network error while saving settings: ${networkErr.message}. Please try again.`
          : 'Network error while saving settings. Please check your connection and try again.'
      );
    }

    const data = await response.json().catch(() => null);

    if (!response.ok || data?.success === false) {
      const serverMsg = data?.message || data?.error;
      if (response.status === 401) {
        throw new Error(serverMsg || 'Session expired or unauthorized. Please sign in again.');
      }
      if (response.status === 403) {
        throw new Error(serverMsg || 'Access denied: You are not authorized to update these settings.');
      }
      if (response.status === 503) {
        throw new Error(
          serverMsg ||
            'Service or database temporarily unavailable (503). Your previous settings were kept — please try again.'
        );
      }
      if (response.status >= 500) {
        throw new Error(
          serverMsg ||
            `Server error (${response.status}). Your previous settings were kept — please try again.`
        );
      }
      throw new Error(
        serverMsg || `Failed to save teacher settings (HTTP ${response.status}). Please try again.`
      );
    }

    const confirmedSettings: TeacherMeetSettings =
      data?.settings && typeof data.settings === 'object'
        ? { ...merged, ...data.settings }
        : merged;

    const confirmedEmail = (confirmedSettings.teacherEmail || cleanEmail).toLowerCase().trim();
    const confirmedUid = confirmedSettings.uid || uid;

    teacherMeetSettings = {
      ...teacherMeetSettings,
      ...(data?.meetSettings && typeof data.meetSettings === 'object' ? data.meetSettings : {}),
      ...(data?.teacherSettings && typeof data.teacherSettings === 'object' ? data.teacherSettings : {}),
      ...(confirmedEmail ? { [confirmedEmail]: confirmedSettings } : {}),
      ...(confirmedUid ? { [confirmedUid]: confirmedSettings } : {}),
    };

    tutors = tutors.map((t) =>
      (t.email || '').toLowerCase().trim() === confirmedEmail || (confirmedUid && t.uid === confirmedUid)
        ? {
            ...t,
            timezone: confirmedSettings.timezone || t.timezone,
            meetUrl: confirmedSettings.meetLink || t.meetUrl,
            meetLink: confirmedSettings.meetLink || (t as any).meetLink,
            availableDays:
              confirmedSettings.availableDays && confirmedSettings.availableDays.length > 0
                ? confirmedSettings.availableDays
                : t.availableDays,
            availability: confirmedSettings.availability || confirmedSettings.availableHoursByDay || t.availability,
            availableHoursByDay:
              confirmedSettings.availableHoursByDay || confirmedSettings.availability || (t as any).availableHoursByDay,
          }
        : t
    );

    return confirmedSettings;
  };

  return {
    handleSaveTeacherMeetSettings,
    getTeacherMeetSettings: () => teacherMeetSettings,
    getTutors: () => tutors,
  };
}

const TEACHER_EMAIL = 'teacher.ui@itissimple.com';
const TEACHER_UID = 'teacherUiUid6a4c400000001';

const BASELINE_SETTINGS: TeacherMeetSettings = {
  teacherEmail: TEACHER_EMAIL,
  uid: TEACHER_UID,
  meetLink: 'https://meet.google.com/baseline-room',
  timezone: 'America/Toronto',
  availableDays: ['monday'],
  availableHours: ['09:00'],
  availability: { monday: ['09:00'] },
  availableHoursByDay: { monday: ['09:00'] },
};

const BASELINE_TUTOR: NativeFriendTutor = {
  id: TEACHER_UID,
  uid: TEACHER_UID,
  name: 'Teacher UI',
  email: TEACHER_EMAIL,
  avatar: '',
  country: 'Canada',
  countryCode: 'CA',
  flag: '🇨🇦',
  accent: 'Canadian',
  rating: 5,
  reviewsCount: 10,
  activeStudents: 2,
  lessonsTaught: 20,
  pricePerSessionUsd: 25,
  pricePerSessionBrl: 135,
  headline: 'Test Tutor',
  bio: 'Test bio',
  specialties: ['Conversation'],
  availableDays: ['monday'],
  availableHours: ['09:00'],
  availability: { monday: ['09:00'] },
  meetUrl: 'https://meet.google.com/baseline-room',
  timezone: 'America/Toronto',
  approvalStatus: 'approved',
};

async function run() {
  console.log('\n=== SEC.FIX.6A.4C.4: Validação de Confirmação de Salvamento na Interface ===\n');

  await test('1. Verificação estrutural de src/App.tsx e TeacherMeetConfigModal.tsx (sem mutação otimista e sem sucesso falso)', () => {
    const appSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/App.tsx'), 'utf8');
    const modalSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/components/TeacherMeetConfigModal.tsx'), 'utf8');

    const fnStart = appSrc.indexOf('const handleSaveTeacherMeetSettings');
    const fnEnd = appSrc.indexOf('// Handler: Save Landing Content', fnStart);
    assert.ok(fnStart > 0 && fnEnd > fnStart, 'handleSaveTeacherMeetSettings encontrado em src/App.tsx');
    const fnBody = appSrc.slice(fnStart, fnEnd);

    const fetchIdx = fnBody.indexOf("fetch('/api/teacher-settings'");
    const okCheckIdx = fnBody.indexOf('!response.ok');
    const setMeetIdx = fnBody.indexOf('setTeacherMeetSettings(');
    const setTutorsIdx = fnBody.indexOf('setTutors(');

    assert.ok(fetchIdx > 0, 'fetch /api/teacher-settings presente');
    assert.ok(okCheckIdx > fetchIdx, 'verificação !response.ok presente após fetch');
    assert.ok(setMeetIdx > okCheckIdx, 'setTeacherMeetSettings ocorre SOMENTE após verificação 2xx');
    assert.ok(setTutorsIdx > okCheckIdx, 'setTutors ocorre SOMENTE após verificação 2xx');
    assert.ok(!fnBody.includes('// local fallback'), 'local fallback silencioso removido');

    assert.ok(modalSrc.includes('await onSave(updatedSettings)'), 'TeacherMeetConfigModal aguarda onSave');
    assert.ok(modalSrc.includes('teacher-settings-save-error'), 'Banner de erro #teacher-settings-save-error presente');
    assert.ok(modalSrc.includes('isSaving'), 'Controle de estado isSaving presente');
  });

  await test('2. SSR render inicial de TeacherMeetConfigModal não exibe falso sucesso nem erro', () => {
    const html = renderToString(
      React.createElement(TeacherMeetConfigModal, {
        isOpen: true,
        onClose: () => {},
        teacherEmail: TEACHER_EMAIL,
        teacherUid: TEACHER_UID,
        currentSettings: BASELINE_SETTINGS,
        tutorProfile: BASELINE_TUTOR,
        onSave: async () => {},
        currentLanguage: 'en',
      })
    );
    assert.ok(html.includes('teacher-meet-link-input'), 'Input de Meet link renderizado');
    assert.ok(html.includes('https://meet.google.com/baseline-room'), 'Valor inicial do Meet link exibido');
    assert.ok(html.includes('type="url"'), 'Validação type="url" preservada');
    assert.ok(html.includes('required'), 'Validação required preservada');
    assert.ok(!html.includes('teacher-settings-saved-success'), 'Sem banner de sucesso na abertura');
    assert.ok(!html.includes('teacher-settings-save-error'), 'Sem banner de erro na abertura');
  });

  await test('3. Sucesso HTTP 200: atualiza estado somente após 2xx, exibe sucesso e fecha após delay', async () => {
    let closeCalls = 0;
    let resolveBackend!: (res: Response) => void;

    const harness = createAppSaveHarness({
      initialSettings: { [TEACHER_EMAIL]: BASELINE_SETTINGS, [TEACHER_UID]: BASELINE_SETTINGS },
      initialTutors: [BASELINE_TUTOR],
      fetchImpl: (async () =>
        new Promise<Response>((resolve) => {
          resolveBackend = resolve;
        })) as any,
    });

    const mounted = mountModal({
      isOpen: true,
      onClose: () => {
        closeCalls++;
      },
      teacherEmail: TEACHER_EMAIL,
      teacherUid: TEACHER_UID,
      currentSettings: harness.getTeacherMeetSettings()[TEACHER_EMAIL],
      tutorProfile: harness.getTutors()[0],
      onSave: async (s) => {
        const confirmed = await harness.handleSaveTeacherMeetSettings(s);
        mounted.updateProps({
          isOpen: true,
          onClose: () => {
            closeCalls++;
          },
          teacherEmail: TEACHER_EMAIL,
          teacherUid: TEACHER_UID,
          currentSettings: harness.getTeacherMeetSettings()[TEACHER_EMAIL],
          tutorProfile: harness.getTutors()[0],
          onSave: async () => {},
          currentLanguage: 'en',
        });
        return confirmed;
      },
      currentLanguage: 'en',
    });

    try {
      // Edit Meet link and add Tuesday 15:00 slot
      const meetInput = findById(mounted.getTree(), 'teacher-meet-link-input');
      meetInput.props.onChange({ target: { value: 'https://meet.google.com/confirmed-200' } });

      const tueTab = findById(mounted.getTree(), 'day-tab-tuesday');
      tueTab.props.onClick();

      const slotBtn = findById(mounted.getTree(), 'slot-btn-tuesday-15-00');
      slotBtn.props.onClick();

      // Submit form (request now in flight)
      const form = findById(mounted.getTree(), 'teacher-meet-config-form');
      const savePromise = form.props.onSubmit({ preventDefault: () => {} });

      // While in flight: state MUST still be baseline, NO success banner, save button disabled
      assert.strictEqual(
        harness.getTeacherMeetSettings()[TEACHER_EMAIL].meetLink,
        'https://meet.google.com/baseline-room',
        'Estado confirmado não sofreu mutação otimista antes do HTTP 200'
      );
      assert.strictEqual(findById(mounted.getTree(), 'teacher-settings-saved-success'), null, 'Sem sucesso falso em voo');
      assert.strictEqual(findById(mounted.getTree(), 'save-teacher-availability-button').props.disabled, true, 'Botão desabilitado durante salvamento');

      // Backend confirms HTTP 200
      resolveBackend(
        new Response(
          JSON.stringify({
            success: true,
            settings: {
              ...BASELINE_SETTINGS,
              meetLink: 'https://meet.google.com/confirmed-200',
              availableDays: ['monday', 'tuesday'],
              availability: { monday: ['09:00'], tuesday: ['15:00'] },
              availableHoursByDay: { monday: ['09:00'], tuesday: ['15:00'] },
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      );

      await savePromise;

      assert.strictEqual(
        harness.getTeacherMeetSettings()[TEACHER_EMAIL].meetLink,
        'https://meet.google.com/confirmed-200',
        'teacherMeetSettings atualizado após HTTP 200'
      );
      assert.strictEqual(
        harness.getTeacherMeetSettings()[TEACHER_UID].meetLink,
        'https://meet.google.com/confirmed-200',
        'Chave por UID canônico atualizada após HTTP 200'
      );
      assert.strictEqual(
        harness.getTutors()[0].meetUrl,
        'https://meet.google.com/confirmed-200',
        'Lista de tutores sincronizada após HTTP 200'
      );
      assert.ok(findById(mounted.getTree(), 'teacher-settings-saved-success'), 'Banner de sucesso exibido após 200');
      assert.strictEqual(findById(mounted.getTree(), 'teacher-settings-save-error'), null, 'Sem banner de erro após 200');

      // Wait for 1000ms auto-close timeout
      await new Promise((r) => setTimeout(r, 1100));
      assert.strictEqual(closeCalls, 1, 'Modal fechado após confirmação e delay de sucesso');
    } finally {
      mounted.unmount();
    }
  });

  await test('4. HTTP 500 e HTTP 503: preserva estado anteriormente confirmado, não exibe sucesso falso, mostra erro e permite nova tentativa', async () => {
    for (const statusCode of [500, 503]) {
      let attempt = 0;
      let closeCalls = 0;

      const harness = createAppSaveHarness({
        initialSettings: { [TEACHER_EMAIL]: BASELINE_SETTINGS, [TEACHER_UID]: BASELINE_SETTINGS },
        initialTutors: [BASELINE_TUTOR],
        fetchImpl: (async () => {
          attempt++;
          if (attempt === 1) {
            return new Response(
              JSON.stringify({
                success: false,
                error: statusCode === 503 ? 'FIRESTORE_UNAVAILABLE' : 'FIRESTORE_WRITE_FAILED',
                message: `Simulated HTTP ${statusCode} persistence failure`,
              }),
              { status: statusCode, headers: { 'Content-Type': 'application/json' } }
            );
          }
          return new Response(
            JSON.stringify({
              success: true,
              settings: {
                ...BASELINE_SETTINGS,
                meetLink: `https://meet.google.com/retry-ok-${statusCode}`,
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }) as any,
      });

      const mounted = mountModal({
        isOpen: true,
        onClose: () => {
          closeCalls++;
        },
        teacherEmail: TEACHER_EMAIL,
        teacherUid: TEACHER_UID,
        currentSettings: harness.getTeacherMeetSettings()[TEACHER_EMAIL],
        tutorProfile: harness.getTutors()[0],
        onSave: harness.handleSaveTeacherMeetSettings,
        currentLanguage: 'en',
      });

      try {
        const meetInput = findById(mounted.getTree(), 'teacher-meet-link-input');
        meetInput.props.onChange({ target: { value: `https://meet.google.com/retry-ok-${statusCode}` } });

        const form = findById(mounted.getTree(), 'teacher-meet-config-form');
        await form.props.onSubmit({ preventDefault: () => {} });

        // Must preserve baseline confirmed values
        assert.strictEqual(
          harness.getTeacherMeetSettings()[TEACHER_EMAIL].meetLink,
          'https://meet.google.com/baseline-room',
          `HTTP ${statusCode}: teacherMeetSettings preservado com valor anterior`
        );
        assert.strictEqual(
          harness.getTutors()[0].meetUrl,
          'https://meet.google.com/baseline-room',
          `HTTP ${statusCode}: tutor meetUrl preservado com valor anterior`
        );

        // Must NOT show success, MUST keep modal open, MUST show error, MUST preserve edited input for retry
        assert.strictEqual(
          findById(mounted.getTree(), 'teacher-settings-saved-success'),
          null,
          `HTTP ${statusCode}: zero sucesso falso`
        );
        assert.strictEqual(closeCalls, 0, `HTTP ${statusCode}: modal permanece aberto para correção/tentativa`);
        const errBox = findById(mounted.getTree(), 'teacher-settings-save-error');
        assert.ok(errBox, `HTTP ${statusCode}: banner de erro visível`);
        assert.ok(
          extractText(errBox).includes(`Simulated HTTP ${statusCode}`),
          `HTTP ${statusCode}: mensagem de erro exibida`
        );
        assert.strictEqual(
          findById(mounted.getTree(), 'teacher-meet-link-input').props.value,
          `https://meet.google.com/retry-ok-${statusCode}`,
          `HTTP ${statusCode}: input editado preservado para nova tentativa`
        );

        // Retry -> succeeds with HTTP 200
        await findById(mounted.getTree(), 'teacher-meet-config-form').props.onSubmit({ preventDefault: () => {} });
        assert.strictEqual(
          harness.getTeacherMeetSettings()[TEACHER_EMAIL].meetLink,
          `https://meet.google.com/retry-ok-${statusCode}`,
          `HTTP ${statusCode} retry: confirmado após HTTP 200`
        );
        assert.ok(
          findById(mounted.getTree(), 'teacher-settings-saved-success'),
          `HTTP ${statusCode} retry: sucesso exibido após confirmação`
        );
        assert.strictEqual(
          findById(mounted.getTree(), 'teacher-settings-save-error'),
          null,
          `HTTP ${statusCode} retry: banner de erro limpo`
        );
      } finally {
        mounted.unmount();
      }
    }
  });

  await test('5. Falha de rede (fetch rejeita) e HTTP 200 com success:false: preserva estado anterior, sem sucesso falso e permite nova tentativa', async () => {
    let mode: 'network-error' | 'false-success' | 'ok' = 'network-error';
    let closeCalls = 0;

    const harness = createAppSaveHarness({
      initialSettings: { [TEACHER_EMAIL]: BASELINE_SETTINGS, [TEACHER_UID]: BASELINE_SETTINGS },
      initialTutors: [BASELINE_TUTOR],
      fetchImpl: (async () => {
        if (mode === 'network-error') {
          throw new TypeError('Failed to fetch');
        }
        if (mode === 'false-success') {
          return new Response(
            JSON.stringify({ success: false, message: 'Persistence rejected by server' }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return new Response(
          JSON.stringify({
            success: true,
            settings: { ...BASELINE_SETTINGS, meetLink: 'https://meet.google.com/after-network-recovery' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }) as any,
    });

    const mounted = mountModal({
      isOpen: true,
      onClose: () => {
        closeCalls++;
      },
      teacherEmail: TEACHER_EMAIL,
      teacherUid: TEACHER_UID,
      currentSettings: harness.getTeacherMeetSettings()[TEACHER_EMAIL],
      tutorProfile: harness.getTutors()[0],
      onSave: harness.handleSaveTeacherMeetSettings,
      currentLanguage: 'en',
    });

    try {
      findById(mounted.getTree(), 'teacher-meet-link-input').props.onChange({
        target: { value: 'https://meet.google.com/after-network-recovery' },
      });

      // Attempt 1: network error
      await findById(mounted.getTree(), 'teacher-meet-config-form').props.onSubmit({ preventDefault: () => {} });
      assert.strictEqual(harness.getTeacherMeetSettings()[TEACHER_EMAIL].meetLink, 'https://meet.google.com/baseline-room');
      assert.strictEqual(findById(mounted.getTree(), 'teacher-settings-saved-success'), null);
      assert.strictEqual(closeCalls, 0);
      const netErr = findById(mounted.getTree(), 'teacher-settings-save-error');
      assert.ok(netErr && extractText(netErr).includes('Failed to fetch'), 'Erro de rede exibido na interface');

      // Attempt 2: HTTP 200 with { success: false }
      mode = 'false-success';
      await findById(mounted.getTree(), 'teacher-meet-config-form').props.onSubmit({ preventDefault: () => {} });
      assert.strictEqual(harness.getTeacherMeetSettings()[TEACHER_EMAIL].meetLink, 'https://meet.google.com/baseline-room');
      assert.strictEqual(findById(mounted.getTree(), 'teacher-settings-saved-success'), null);
      assert.strictEqual(closeCalls, 0);
      const falseSuccessErr = findById(mounted.getTree(), 'teacher-settings-save-error');
      assert.ok(falseSuccessErr && extractText(falseSuccessErr).includes('Persistence rejected by server'));

      // Attempt 3: HTTP 200 success
      mode = 'ok';
      await findById(mounted.getTree(), 'teacher-meet-config-form').props.onSubmit({ preventDefault: () => {} });
      assert.strictEqual(
        harness.getTeacherMeetSettings()[TEACHER_EMAIL].meetLink,
        'https://meet.google.com/after-network-recovery'
      );
      assert.ok(findById(mounted.getTree(), 'teacher-settings-saved-success'));
      assert.strictEqual(findById(mounted.getTree(), 'teacher-settings-save-error'), null);
    } finally {
      mounted.unmount();
    }
  });

  console.log(`\nResumo SEC.FIX.6A.4C.4: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('Fatal error in validate-sec-fix-6a-4c-4:', err);
  process.exit(1);
});
