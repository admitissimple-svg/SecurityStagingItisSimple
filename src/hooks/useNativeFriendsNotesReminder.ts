import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { LiveLesson, EnglishLevel } from '../types';
import { sanitizeTimeZone } from '../utils/timezone';
import {
  extractNotesMarkings,
  fetchPedagogicalTransformation,
  PedagogicalLessonTransformation,
} from '../utils/pedagogicalTransformer';
import { getDb } from '../firebase';
import { collection, doc, getDoc, getDocs, setDoc, onSnapshot } from 'firebase/firestore';

export interface SessionNoteSummary {
  key: string;
  lessonId?: string;
  dateStr: string;
  topic: string;
  teacherName: string;
  rawContent: string;
  timestamp: number;
}

export interface ReviewTabDef {
  tab: 'mistakes' | 'grammar' | 'vocab' | 'summary';
  tabNumber: 1 | 2 | 3 | 4;
  label: string;
  labelEn: string;
}

export interface NativeFriendsNotesReminder {
  rule: 'rule_2_quick_review_today' | 'rule_3_sequential_review';
  title: string;
  message: string;
  targetTab: 'mistakes' | 'grammar' | 'vocab' | 'summary';
  tabNumber: 1 | 2 | 3 | 4;
  tabLabel: string;
  sessionKey: string;
  sessionDate: string;
  teacherName: string;
  topic: string;
  isLessonToday: boolean;
  stepIndex?: number;
  totalSteps?: number;
  availableTabs?: ReviewTabDef[];
}

export interface UseNativeFriendsNotesReminderParams {
  studentUid?: string;
  studentEmail?: string;
  lessons?: LiveLesson[];
  timeZone?: string;
  currentLanguage?: string;
  studentLevel?: EnglishLevel | string;
}

export function useNativeFriendsNotesReminder({
  studentUid,
  studentEmail,
  lessons = [],
  timeZone = 'America/Sao_Paulo',
  currentLanguage = 'pt',
  studentLevel = EnglishLevel.INTERMEDIATE,
}: UseNativeFriendsNotesReminderParams) {
  const isEn = currentLanguage === 'en';
  const effectiveTz = sanitizeTimeZone(timeZone);

  const resolvedUid = useMemo(() => (studentUid || '').trim(), [studentUid]);
  const resolvedEmail = useMemo(() => (studentEmail || '').toLowerCase().trim(), [studentEmail]);
  const lessonsRef = useRef<LiveLesson[]>(lessons || []);
  lessonsRef.current = lessons || [];

  const [sessions, setSessions] = useState<SessionNoteSummary[]>([]);
  const [latestTransformation, setLatestTransformation] = useState<PedagogicalLessonTransformation | null>(null);
  const [stepIndex, setStepIndex] = useState<number>(0);
  const [storedSessionKey, setStoredSessionKey] = useState<string>('');
  const [storedLastReviewedDate, setStoredLastReviewedDate] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // 1. Fetch past sessions for the isolated student (Strictly Descending: newest first)
  const loadSessions = useCallback(async () => {
    setIsLoading(true);
    const sessionsMap = new Map<string, SessionNoteSummary>();

    try {
      // 1a. In-memory lessons passed via props
      const curLessons = lessonsRef.current;
      if (Array.isArray(curLessons)) {
        curLessons.forEach((l) => {
          if (!l) return;
          const lStudentUid = l.studentUid || (l as any)?.studentId || '';
          const lStudentEmail = (l.studentEmail || '').toLowerCase().trim();

          const matchesUid = resolvedUid && lStudentUid && lStudentUid === resolvedUid;
          const matchesEmail = resolvedEmail && lStudentEmail && lStudentEmail === resolvedEmail;

          if (matchesUid || matchesEmail || (!resolvedUid && !resolvedEmail)) {
            const raw =
              l.sessionNotesDocument ||
              l.liveNotes ||
              l.recommendations ||
              (l.vocabularyNotes && l.vocabularyNotes.length > 0
                ? l.vocabularyNotes.map((v) => `• ${v.word}: ${v.meaningOrTip || (v as any).notes || ''}`).join('\n')
                : '');

            if (raw && raw.trim()) {
              const datePart =
                l.sessionDate ||
                (l.startDateTime && typeof l.startDateTime === 'string'
                  ? l.startDateTime.split('T')[0]
                  : '');
              const timestamp = l.startDateTime ? new Date(l.startDateTime).getTime() : 0;
              const key = l.id || `lesson_${datePart}`;

              sessionsMap.set(key, {
                key,
                lessonId: l.id,
                dateStr: datePart || 'Recent Session',
                topic: l.title || 'Conversation & Fluency',
                teacherName: l.teacherName || (l as any)?.tutorName || 'Native Friend',
                rawContent: raw,
                timestamp,
              });
            }
          }
        });
      }

      // 1b. Firestore /users/{studentUid}/session_notes
      try {
        const firestore = getDb();
        if (firestore && resolvedUid) {
          const userNotesCol = collection(firestore, 'users', resolvedUid, 'session_notes');
          const snap = await getDocs(userNotesCol);
          snap.forEach((docSnap) => {
            if (docSnap.id === 'review_cycle') return; // Skip internal cycle document
            const data = docSnap.data();
            if (data && data.content && data.content.trim()) {
              const dateStr = data.sessionDate || docSnap.id.replace('session_', '').slice(0, 10);
              const timestamp = new Date(dateStr || data.updatedAt || 0).getTime();
              const key = docSnap.id;
              if (!sessionsMap.has(key)) {
                sessionsMap.set(key, {
                  key,
                  lessonId: data.lessonId,
                  dateStr,
                  topic: data.topic || 'In-Session Coaching',
                  teacherName: data.teacherName || 'Native Friend',
                  rawContent: data.content,
                  timestamp,
                });
              }
            }
          });
        }
      } catch (fsErr) {
        console.warn('useNativeFriendsNotesReminder: Firestore notice:', fsErr);
      }

      // 1c. Server API /api/session-notes
      try {
        const queryParams = new URLSearchParams();
        if (resolvedUid) queryParams.set('studentUid', resolvedUid);
        if (resolvedEmail) queryParams.set('studentEmail', resolvedEmail);

        const res = await fetch(`/api/session-notes?${queryParams.toString()}`);
        if (res.ok) {
          const serverNotes = await res.json();
          if (Array.isArray(serverNotes)) {
            serverNotes.forEach((n: any) => {
              if (n && n.content && n.content.trim()) {
                const key = n.id || `session_${n.sessionDate}`;
                const timestamp = new Date(n.sessionDate || n.updatedAt || 0).getTime();
                if (!sessionsMap.has(key)) {
                  sessionsMap.set(key, {
                    key,
                    lessonId: n.lessonId,
                    dateStr: n.sessionDate || 'Session',
                    topic: n.topic || 'In-Session Notes',
                    teacherName: n.teacherName || 'Native Friend',
                    rawContent: n.content,
                    timestamp,
                  });
                }
              }
            });
          }
        }
      } catch (apiErr) {
        console.warn('useNativeFriendsNotesReminder: Server API notice:', apiErr);
      }

      // Sort strictly descending: newest first
      const sorted = Array.from(sessionsMap.values()).sort((a, b) => {
        const timeA = a.timestamp || (a.dateStr ? new Date(a.dateStr).getTime() : 0);
        const timeB = b.timestamp || (b.dateStr ? new Date(b.dateStr).getTime() : 0);
        return timeB - timeA;
      });

      setSessions(sorted);
    } catch (err) {
      console.warn('useNativeFriendsNotesReminder: Failed to load sessions', err);
    } finally {
      setIsLoading(false);
    }
  }, [resolvedUid, resolvedEmail]);

  // 2. Fetch stored progress from Firestore / Server (NO localStorage)
  const loadStoredProgress = useCallback(async () => {
    let loadedSessionKey = '';
    let loadedStepIndex = 0;

    // 2a. Check Firestore /users/{studentUid}/session_notes/review_cycle
    try {
      const firestore = getDb();
      if (firestore && resolvedUid) {
        const cycleDocRef = doc(firestore, 'users', resolvedUid, 'session_notes', 'review_cycle');
        const snap = await getDoc(cycleDocRef);
        if (snap.exists()) {
          const data = snap.data();
          if (data) {
            loadedSessionKey = data.lastSessionKey || '';
            loadedStepIndex = typeof data.stepIndex === 'number' ? data.stepIndex : 0;
            if (data.lastReviewedDate) setStoredLastReviewedDate(data.lastReviewedDate);
          }
        }
      }
    } catch (err) {
      console.warn('useNativeFriendsNotesReminder: Firestore progress read notice:', err);
    }

    // 2b. Check Server API fallback
    if (!loadedSessionKey) {
      try {
        const queryParams = new URLSearchParams();
        if (resolvedUid) queryParams.set('studentUid', resolvedUid);
        if (resolvedEmail) queryParams.set('studentEmail', resolvedEmail);

        const res = await fetch(`/api/session-notes/progress?${queryParams.toString()}`);
        if (res.ok) {
          const progressData = await res.json();
          if (progressData && progressData.lastSessionKey) {
            loadedSessionKey = progressData.lastSessionKey;
            loadedStepIndex = progressData.stepIndex || 0;
            if (progressData.lastReviewedDate) setStoredLastReviewedDate(progressData.lastReviewedDate);
          }
        }
      } catch (err) {
        console.warn('useNativeFriendsNotesReminder: Server progress read notice:', err);
      }
    }

    setStoredSessionKey(loadedSessionKey);
    setStepIndex(loadedStepIndex);
  }, [resolvedUid, resolvedEmail]);

  useEffect(() => {
    loadSessions();
    loadStoredProgress();

    const firestore = getDb();
    if (!firestore || !resolvedUid) return;

    // Real-time synchronization of Native Friends Notes review cycle progress across mobile & desktop
    const cycleDocRef = doc(firestore, 'users', resolvedUid, 'session_notes', 'review_cycle');
    const unsubCycle = onSnapshot(
      cycleDocRef,
      (snap) => {
        if (snap.exists()) {
          const data = snap.data();
          if (data) {
            if (data.lastSessionKey) setStoredSessionKey(data.lastSessionKey);
            if (typeof data.stepIndex === 'number') setStepIndex(data.stepIndex);
            if (data.lastReviewedDate) setStoredLastReviewedDate(data.lastReviewedDate);
          }
        }
      },
      (err) => console.warn('Real-time review_cycle snapshot notice:', err)
    );

    // Real-time listener for session notes subcollection
    const userNotesCol = collection(firestore, 'users', resolvedUid, 'session_notes');
    const unsubNotes = onSnapshot(
      userNotesCol,
      () => {
        loadSessions();
      },
      (err) => console.warn('Real-time session_notes snapshot notice:', err)
    );

    return () => {
      unsubCycle();
      unsubNotes();
    };
  }, [resolvedUid, loadSessions, loadStoredProgress]);

  // Update sessions when lessons count changes without resetting listeners
  useEffect(() => {
    loadSessions();
  }, [lessons?.length, loadSessions]);

  // 3. Transform latest session notes
  const latestSession = useMemo(() => sessions[0] || null, [sessions]);

  useEffect(() => {
    let isCancelled = false;
    if (latestSession && latestSession.rawContent) {
      fetchPedagogicalTransformation({
        rawNotes: latestSession.rawContent,
        topic: latestSession.topic,
        sessionDate: latestSession.dateStr,
        teacherName: latestSession.teacherName,
        studentLevel,
        studentUid: resolvedUid,
        studentEmail: resolvedEmail,
        lessonId: latestSession.lessonId,
        sessionKey: latestSession.key,
      })
        .then((trans) => {
          if (!isCancelled) setLatestTransformation(trans);
        })
        .catch((err) => {
          console.warn('useNativeFriendsNotesReminder: Failed to transform latest notes', err);
        });
    } else {
      setLatestTransformation(null);
    }
    return () => {
      isCancelled = true;
    };
  }, [latestSession, studentLevel, resolvedUid, resolvedEmail]);

  // 4. Save review progress to Firestore and Server (NO localStorage)
  const persistProgress = useCallback(
    async (newSessionKey: string, newStepIndex: number, lastTab?: string) => {
      setStoredSessionKey(newSessionKey);
      setStepIndex(newStepIndex);

      const todayInTz = new Intl.DateTimeFormat('en-CA', {
        timeZone: effectiveTz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date());

      setStoredLastReviewedDate(todayInTz);

      // Save directly to Firestore /users/{studentUid}/session_notes/review_cycle and users/{studentUid}
      try {
        const firestore = getDb();
        if (firestore && resolvedUid) {
          const cyclePayload = {
            lastSessionKey: newSessionKey,
            stepIndex: newStepIndex,
            lastReviewedTab: lastTab || '',
            lastReviewedDate: todayInTz,
            updatedAt: new Date().toISOString(),
          };

          const cycleDocRef = doc(firestore, 'users', resolvedUid, 'session_notes', 'review_cycle');
          const userDocRef = doc(firestore, 'users', resolvedUid);

          await Promise.all([
            setDoc(cycleDocRef, cyclePayload, { merge: true }),
            setDoc(userDocRef, { nativeNotesReview: cyclePayload, updatedAt: new Date().toISOString() }, { merge: true }),
          ]);
        }
      } catch (err) {
        console.warn('useNativeFriendsNotesReminder: Firestore progress save notice:', err);
      }

      // Save to Server API
      try {
        await fetch('/api/session-notes/progress', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            studentUid: resolvedUid,
            studentEmail: resolvedEmail,
            lastSessionKey: newSessionKey,
            stepIndex: newStepIndex,
            lastReviewedTab: lastTab || '',
            lastReviewedDate: todayInTz,
          }),
        });
      } catch (err) {
        console.warn('useNativeFriendsNotesReminder: Server progress save notice:', err);
      }
    },
    [resolvedUid, resolvedEmail, effectiveTz]
  );

  // 5. Check Regra 1: Se o aluno nunca teve nenhuma aula com o amigo nativo, nenhum lembrete será exibido
  const hasHadAnyLesson = useMemo(() => {
    // Check if student has completed lessons or past sessions
    const studentLessons = lessons.filter((l) => {
      if (!l) return false;
      const lStudentUid = l.studentUid || (l as any)?.studentId || '';
      const lStudentEmail = (l.studentEmail || '').toLowerCase().trim();
      const matchesUid = resolvedUid && lStudentUid && lStudentUid === resolvedUid;
      const matchesEmail = resolvedEmail && lStudentEmail && lStudentEmail === resolvedEmail;
      return matchesUid || matchesEmail || (!resolvedUid && !resolvedEmail);
    });

    const hasCompleted = studentLessons.some(
      (l) => l.status === 'completed' || (l.status === 'scheduled' && new Date(l.startDateTime).getTime() < Date.now())
    );

    return hasCompleted || sessions.length > 0;
  }, [lessons, resolvedUid, resolvedEmail, sessions]);

  // 6. Check if student has a scheduled lesson with native friend TODAY
  const { hasLessonToday, scheduledLessonToday } = useMemo(() => {
    // Current date formatted in student's timezone (YYYY-MM-DD)
    const todayInTz = new Intl.DateTimeFormat('en-CA', {
      timeZone: effectiveTz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());

    const studentLessons = lessons.filter((l) => {
      if (!l) return false;
      const lStudentUid = l.studentUid || (l as any)?.studentId || '';
      const lStudentEmail = (l.studentEmail || '').toLowerCase().trim();
      const matchesUid = resolvedUid && lStudentUid && lStudentUid === resolvedUid;
      const matchesEmail = resolvedEmail && lStudentEmail && lStudentEmail === resolvedEmail;
      return matchesUid || matchesEmail || (!resolvedUid && !resolvedEmail);
    });

    const activeScheduledToday = studentLessons.find((l) => {
      if (l.status !== 'scheduled' || l.cancelledAt) return false;
      const lDate =
        l.sessionDate ||
        (l.startDateTime && typeof l.startDateTime === 'string'
          ? l.startDateTime.split('T')[0]
          : '');
      return lDate === todayInTz;
    });

    return {
      hasLessonToday: Boolean(activeScheduledToday),
      scheduledLessonToday: activeScheduledToday || null,
    };
  }, [lessons, effectiveTz, resolvedUid, resolvedEmail]);

  // 7. Check if Quick Review is not empty for latest session
  const isQuickReviewNotEmpty = useMemo(() => {
    if (!latestSession) return false;
    if (latestTransformation?.reviewSummary) {
      const qs = latestTransformation.reviewSummary;
      const hasRemember = Boolean(qs.rememberThis && qs.rememberThis.trim());
      const hasCorrections = Array.isArray(qs.essentialCorrections) && qs.essentialCorrections.length > 0;
      const hasRules = Array.isArray(qs.keyRules) && qs.keyRules.length > 0;
      const hasVocab = Array.isArray(qs.mustKnowVocabulary) && qs.mustKnowVocabulary.length > 0;
      return hasRemember || hasCorrections || hasRules || hasVocab;
    }
    // Fallback: Check raw markings
    if (latestSession.rawContent) {
      const markings = extractNotesMarkings(latestSession.rawContent);
      return markings.incorrectCount > 0 || markings.newWordCount > 0 || markings.cleanText.length > 20;
    }
    return false;
  }, [latestSession, latestTransformation]);

  // 8. Available non-empty review tabs for the latest session notes
  const availableReviewTabs = useMemo<ReviewTabDef[]>(() => {
    if (!latestSession) return [];

    const tabs: ReviewTabDef[] = [];

    // Tab 1: Mistakes (Check if mistakes exist)
    const hasMistakes =
      (latestTransformation?.mistakesAnalysis && latestTransformation.mistakesAnalysis.length > 0) ||
      (latestSession.rawContent && /data-tag-type=["']incorrect["']|✗|✖/i.test(latestSession.rawContent));
    if (hasMistakes) {
      tabs.push({
        tab: 'mistakes',
        tabNumber: 1,
        label: isEn ? 'Analyze Mistakes' : 'Análise de Erros',
        labelEn: 'Analyze Mistakes',
      });
    }

    // Tab 2: Grammar Points (Check if grammar points exist)
    const hasGrammar =
      (latestTransformation?.grammarPoints && latestTransformation.grammarPoints.length > 0) ||
      (latestSession.rawContent && latestSession.rawContent.length > 30);
    if (hasGrammar) {
      tabs.push({
        tab: 'grammar',
        tabNumber: 2,
        label: isEn ? 'Grammar Points' : 'Pontos Gramaticais',
        labelEn: 'Grammar Points',
      });
    }

    // Tab 3: Vocabulary & Expressions (Check if vocab / pronunciation exist)
    const hasVocab =
      (latestTransformation?.vocabularyAndExpressions && latestTransformation.vocabularyAndExpressions.length > 0) ||
      (latestSession.rawContent &&
        /data-tag-type=["'](new-word|pronounce)["']|\[New Word\]|\[Pronounce\]/i.test(latestSession.rawContent));
    if (hasVocab) {
      tabs.push({
        tab: 'vocab',
        tabNumber: 3,
        label: isEn ? 'Vocabulary & Expressions' : 'Vocabulário & Expressões',
        labelEn: 'Vocabulary & Expressions',
      });
    }

    // Tab 4: 5–10 Min Quick Review (Check if Quick Review exists)
    if (isQuickReviewNotEmpty) {
      tabs.push({
        tab: 'summary',
        tabNumber: 4,
        label: isEn ? '5–10 Min Quick Review' : 'Revisão Rápida 5–10 Min',
        labelEn: '5–10 Min Quick Review',
      });
    }

    return tabs;
  }, [latestSession, latestTransformation, isQuickReviewNotEmpty, isEn]);

  // 9. Regra 4: Na próxima aula com novas notas geradas, a lógica de revisão sequencial deve atualizar-se automaticamente para os novos apontamentos, mantendo o mesmo ciclo.
  useEffect(() => {
    if (latestSession && storedSessionKey && latestSession.key !== storedSessionKey) {
      // A new lesson with new notes was detected! Reset cycle to Tab 1 (index 0) for the new notes
      persistProgress(latestSession.key, 0);
    } else if (latestSession && !storedSessionKey) {
      // First time recording notes for this session
      persistProgress(latestSession.key, 0);
    }
  }, [latestSession, storedSessionKey, persistProgress]);

  // 10. Advance sequential step to next non-empty tab
  const advanceSequentialStep = useCallback(() => {
    if (!latestSession || availableReviewTabs.length === 0) return;
    const nextIndex = (stepIndex + 1) % availableReviewTabs.length;
    const currentTab = availableReviewTabs[stepIndex % availableReviewTabs.length]?.tab;
    persistProgress(latestSession.key, nextIndex, currentTab);
  }, [latestSession, availableReviewTabs, stepIndex, persistProgress]);

  // 11. Compute Dynamic Reminder based on the 4 Strict Rules
  const reminder = useMemo<NativeFriendsNotesReminder | null>(() => {
    // Regra 1: Se o aluno nunca teve nenhuma aula com o amigo nativo, nenhum lembrete será exibido.
    if (!hasHadAnyLesson || !latestSession) {
      return null;
    }

    // Regra 2: Se o aluno tem uma aula agendada com o amigo nativo no próprio dia, o lembrete automático será para ler o Quick Review (caso este não esteja vazio).
    if (hasLessonToday) {
      if (isQuickReviewNotEmpty) {
        return {
          rule: 'rule_2_quick_review_today',
          title: isEn ? '🌟 Lesson Today with your Native Friend!' : '🌟 Aula Hoje com o Amigo Nativo!',
          message: isEn
            ? 'You have a lesson scheduled today. Read your 5–10 Min Quick Review before the session to boost your confidence and fluency!'
            : 'Você tem aula agendada hoje com seu Amigo Nativo! Leia o Quick Review (5–10 min) para entrar na aula com o conteúdo fresco e afiado.',
          targetTab: 'summary',
          tabNumber: 4,
          tabLabel: isEn ? '5–10 Min Quick Review' : 'Revisão Rápida 5–10 Min',
          sessionKey: latestSession.key,
          sessionDate: latestSession.dateStr,
          teacherName: latestSession.teacherName,
          topic: latestSession.topic,
          isLessonToday: true,
          availableTabs: availableReviewTabs,
        };
      }
      return null;
    }

    // Regra 3: Se o aluno já possui notas registadas de aulas anteriores, mas não é dia de nova aula,
    // sempre que abrir o aplicativo o aluno será lembrado de revisar os seus apontamentos de forma sequencial
    // (Aba 1, depois Aba 2, Aba 3 e Aba 4, consecutivamente) até chegar à próxima aula (caso este não estejam vazios).
    if (availableReviewTabs.length === 0) {
      return null;
    }

    const currentTabDef = availableReviewTabs[stepIndex % availableReviewTabs.length];
    if (!currentTabDef) return null;

    const currentStepNum = currentTabDef.tabNumber;
    const currentStepLabel = currentTabDef.label;

    return {
      rule: 'rule_3_sequential_review',
      title: isEn
        ? `📚 Review Step ${currentStepNum} of 4 • Last Session`
        : `📚 Revisão Passo ${currentStepNum} de 4 • Última Aula`,
      message: isEn
        ? `Time to review your notes from your last session! Today focus on Tab ${currentStepNum}: ${currentStepLabel}.`
        : `Hora de revisar seus apontamentos da última aula! Hoje revise: Aba ${currentStepNum} — ${currentStepLabel}.`,
      targetTab: currentTabDef.tab,
      tabNumber: currentStepNum,
      tabLabel: currentStepLabel,
      sessionKey: latestSession.key,
      sessionDate: latestSession.dateStr,
      teacherName: latestSession.teacherName,
      topic: latestSession.topic,
      isLessonToday: false,
      stepIndex: stepIndex % availableReviewTabs.length,
      totalSteps: availableReviewTabs.length,
      availableTabs: availableReviewTabs,
    };
  }, [
    hasHadAnyLesson,
    latestSession,
    hasLessonToday,
    isQuickReviewNotEmpty,
    availableReviewTabs,
    stepIndex,
    isEn,
  ]);

  const todayInTz = useMemo(() => {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: effectiveTz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  }, [effectiveTz]);

  const isReviewCompletedToday = useMemo(() => {
    return Boolean(storedLastReviewedDate && storedLastReviewedDate === todayInTz);
  }, [storedLastReviewedDate, todayInTz]);

  return {
    reminder,
    advanceSequentialStep,
    sessions,
    latestSession,
    latestTransformation,
    availableReviewTabs,
    stepIndex,
    isLoading,
    hasLessonToday,
    hasHadAnyLesson,
    scheduledLessonToday,
    isReviewCompletedToday,
    storedLastReviewedDate,
  };
}
