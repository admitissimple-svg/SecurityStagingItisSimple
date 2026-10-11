import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  X,
  BookOpen,
  Calendar,
  CheckCircle2,
  AlertTriangle,
  Lightbulb,
  Sparkles,
  Volume2,
  Clock,
  ChevronDown,
  RefreshCw,
  Copy,
  Check,
  Printer,
  Compass,
  Layers,
  GraduationCap,
  ArrowRight,
  ArrowLeft,
  CheckCheck,
  Bookmark,
  Filter,
  ShieldCheck,
  FileText,
} from 'lucide-react';
import { GoogleAccount, LiveLesson, StudentProfile, UserProfile, EnglishLevel } from '../types';
import { formatDateInTimeZone } from '../utils/timezone';
import { speakEnglish } from '../utils/audio';
import {
  PedagogicalLessonTransformation,
  fetchPedagogicalTransformation,
  resolveCefrLevel,
} from '../utils/pedagogicalTransformer';
import { syncSessionVocabularyToStudentDictionary } from '../utils/sessionVocabularySync';
import { getDb } from '../firebase';
import { collection, getDocs, query, where } from 'firebase/firestore';

interface NativeFriendsNotesModalProps {
  isOpen: boolean;
  onClose: () => void;
  studentUid?: string;
  studentEmail?: string;
  currentAccount?: GoogleAccount | null;
  userProfile?: UserProfile | StudentProfile | null;
  lessons?: LiveLesson[];
  timeZone?: string;
  currentLanguage?: string;
  initialTab?: 'all' | 'mistakes' | 'grammar' | 'vocab' | 'summary';
  onAdvanceSequentialStep?: () => void;
  currentSequentialTab?: 'mistakes' | 'grammar' | 'vocab' | 'summary';
  currentStepNumber?: number;
  isLessonToday?: boolean;
}

interface SessionOption {
  key: string;
  lessonId?: string;
  dateStr: string;
  topic: string;
  teacherName: string;
  rawContent: string;
  timestamp: number;
}

export const NativeFriendsNotesModal: React.FC<NativeFriendsNotesModalProps> = ({
  isOpen,
  onClose,
  studentUid,
  studentEmail,
  currentAccount,
  userProfile,
  lessons = [],
  timeZone = 'America/Sao_Paulo',
  currentLanguage = 'pt',
  initialTab,
  onAdvanceSequentialStep,
  currentSequentialTab,
  currentStepNumber,
  isLessonToday = false,
}) => {
  const isEn = currentLanguage === 'en';

  // Resolved identity for strict UID-level isolation
  const resolvedUid = useMemo(() => {
    return (
      studentUid ||
      userProfile?.uid ||
      userProfile?.id ||
      currentAccount?.id ||
      (currentAccount as any)?.uid ||
      ''
    );
  }, [studentUid, userProfile?.uid, userProfile?.id, currentAccount?.id, (currentAccount as any)?.uid]);

  const resolvedEmail = useMemo(() => {
    return (
      studentEmail ||
      userProfile?.email ||
      currentAccount?.email ||
      ''
    ).toLowerCase().trim();
  }, [studentEmail, userProfile?.email, currentAccount?.email]);

  const studentLevel = useMemo(() => {
    return (
      userProfile?.level ||
      (userProfile as any)?.userLevel ||
      (userProfile as any)?.englishLevel ||
      EnglishLevel.INTERMEDIATE
    );
  }, [userProfile]);

  const cefrMeta = useMemo(() => resolveCefrLevel(studentLevel), [studentLevel]);

  // Sessions and selection state
  const [sessionOptions, setSessionOptions] = useState<SessionOption[]>([]);
  const [selectedSessionKey, setSelectedSessionKey] = useState<string>('');
  const [isLoadingSessions, setIsLoadingSessions] = useState<boolean>(true);

  // Transformation data state
  const [transformation, setTransformation] = useState<PedagogicalLessonTransformation | null>(null);
  const [isLoadingTransformation, setIsLoadingTransformation] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<'all' | 'mistakes' | 'grammar' | 'vocab' | 'summary'>(
    initialTab || 'mistakes'
  );
  const [copiedSummary, setCopiedSummary] = useState<boolean>(false);

  // Sync activeTab when modal is reopened or initialTab changes
  useEffect(() => {
    if (isOpen) {
      if (initialTab) {
        setActiveTab(initialTab);
      }
    }
  }, [isOpen, initialTab]);

  const TABS_ORDER: Array<'mistakes' | 'grammar' | 'vocab' | 'summary'> = useMemo(
    () => ['mistakes', 'grammar', 'vocab', 'summary'],
    []
  );

  const handleNextTab = useCallback(() => {
    if (activeTab === 'all') {
      setActiveTab('mistakes');
      return;
    }
    const idx = TABS_ORDER.indexOf(activeTab);
    if (idx >= 0) {
      const next = TABS_ORDER[(idx + 1) % TABS_ORDER.length];
      setActiveTab(next);
    }
  }, [activeTab, TABS_ORDER]);

  const handlePrevTab = useCallback(() => {
    if (activeTab === 'all') {
      setActiveTab('summary');
      return;
    }
    const idx = TABS_ORDER.indexOf(activeTab);
    if (idx >= 0) {
      const prev = TABS_ORDER[(idx - 1 + TABS_ORDER.length) % TABS_ORDER.length];
      setActiveTab(prev);
    }
  }, [activeTab, TABS_ORDER]);

  const handleMarkAsRead = useCallback(() => {
    if (onAdvanceSequentialStep) {
      onAdvanceSequentialStep();
    }
    // Only close the panel without directing to the next activity (1 tab per day)
    onClose();
  }, [onAdvanceSequentialStep, onClose]);

  // Load and consolidate sessions for this isolated student (sorted strictly descending: newest first)
  const fetchStudentSessions = useCallback(async () => {
    setIsLoadingSessions(true);
    const sessionsMap = new Map<string, SessionOption>();

    try {
      // 1. In-memory / passed lessons matching student UID or Email
      if (Array.isArray(lessons)) {
        lessons.forEach((l) => {
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
                ? l.vocabularyNotes.map((v) => `• ${v.word}: ${v.notes || ''}`).join('\n')
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

      // 2. Query Firestore /users/{studentUid}/session_notes
      try {
        const firestore = getDb();
        if (firestore && resolvedUid) {
          const userNotesCol = collection(firestore, 'users', resolvedUid, 'session_notes');
          const snap = await getDocs(userNotesCol);
          snap.forEach((docSnap) => {
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
        console.warn('NativeFriendsNotes: Firestore /users query notice:', fsErr);
      }

      // 3. Query Server API: /api/session-notes
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
        console.warn('NativeFriendsNotes: Server notes query notice:', apiErr);
      }

      // 4. Convert to array and sort STRICTLY DESCENDING (newest / most recent first)
      const list = Array.from(sessionsMap.values()).sort((a, b) => {
        const timeA = a.timestamp || (a.dateStr ? new Date(a.dateStr).getTime() : 0);
        const timeB = b.timestamp || (b.dateStr ? new Date(b.dateStr).getTime() : 0);
        return timeB - timeA; // Descending: newest first
      });

      setSessionOptions(list);

      // Auto-select the most recent session if not selected yet
      if (list.length > 0) {
        setSelectedSessionKey((prev) => {
          if (prev && list.some((item) => item.key === prev)) return prev;
          return list[0].key;
        });
      } else {
        setSelectedSessionKey('');
      }
    } catch (err) {
      console.warn('NativeFriendsNotes: Error fetching student sessions', err);
    } finally {
      setIsLoadingSessions(false);
    }
  }, [resolvedUid, resolvedEmail, lessons]);

  // Load sessions whenever modal opens or student identity changes
  useEffect(() => {
    if (isOpen) {
      fetchStudentSessions();
    }
  }, [isOpen, fetchStudentSessions]);

  // Active session object
  const activeSession = useMemo(() => {
    return sessionOptions.find((s) => s.key === selectedSessionKey) || sessionOptions[0] || null;
  }, [sessionOptions, selectedSessionKey]);

  // Load and transform pedagogical notes whenever active session changes
  const loadPedagogicalNotes = useCallback(
    async (forceRegenerate: boolean = false) => {
      if (!activeSession) {
        setTransformation(null);
        return;
      }

      setIsLoadingTransformation(true);
      try {
        const result = await fetchPedagogicalTransformation({
          rawNotes: activeSession.rawContent,
          topic: activeSession.topic,
          sessionDate: activeSession.dateStr,
          teacherName: activeSession.teacherName,
          studentLevel,
          studentUid: resolvedUid,
          studentEmail: resolvedEmail,
          lessonId: activeSession.lessonId,
          sessionKey: activeSession.key,
          forceRegenerate,
        });

        setTransformation(result);

        // Automatically sync session vocabulary (Alt + W and Alt + P) into the student's My Dictionary in Firestore
        if (resolvedUid || resolvedEmail) {
          syncSessionVocabularyToStudentDictionary({
            studentUid: resolvedUid || resolvedEmail,
            studentEmail: resolvedEmail,
            rawNotes: activeSession.rawContent,
            vocabularyAndExpressions: result.vocabularyAndExpressions,
            studentLevel,
            sessionDate: activeSession.dateStr,
            topic: activeSession.topic,
            teacherName: activeSession.teacherName,
          }).catch((err) => console.warn('NativeFriendsNotes: vocabulary sync notice:', err));
        }
      } catch (err) {
        console.warn('Failed to load pedagogical notes:', err);
      } finally {
        setIsLoadingTransformation(false);
      }
    },
    [activeSession, studentLevel, resolvedUid, resolvedEmail]
  );

  useEffect(() => {
    if (isOpen && activeSession) {
      loadPedagogicalNotes(false);
    }
  }, [isOpen, activeSession, loadPedagogicalNotes]);

  // Copy 5-10 minute review summary to clipboard
  const handleCopySummary = () => {
    if (!transformation) return;
    const summary = transformation.reviewSummary;
    const levelLabel = transformation.levelAdaptation?.levelLabel || cefrMeta.labelEn;
    const text = [
      `📚 NATIVE FRIENDS NOTES — 5–10 MINUTE REVIEW SUMMARY`,
      `📅 Date: ${transformation.sessionDate} | Topic: ${transformation.topic}`,
      `🎓 Level: ${transformation.cefrLevel} (${levelLabel})`,
      `\n🎯 REMEMBER THIS:`,
      summary.rememberThis,
      `\n💬 ALL ESSENTIAL CORRECTIONS (Alt + N):`,
      ...summary.essentialCorrections.map((c) => `✗ ${c.original}  ➜  ✓ ${c.corrected}`),
      `\n⚡ KEY GRAMMAR RULES (Alt + N):`,
      ...summary.keyRules.map((r, i) => `${i + 1}. ${r}`),
      `\n✨ MUST-KNOW VOCABULARY & PRONUNCIATION (Alt + W / Alt + P):`,
      ...summary.mustKnowVocabulary.map((v) => `• ${v}`),
    ].join('\n');

    navigator.clipboard.writeText(text).then(() => {
      setCopiedSummary(true);
      setTimeout(() => setCopiedSummary(false), 2500);
    });
  };

  const handlePrint = () => {
    window.print();
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200"
      id="native-friends-notes-modal-overlay"
      role="dialog"
      aria-modal="true"
    >
      <div
        className="bg-white w-full max-w-5xl max-h-[92vh] rounded-3xl shadow-2xl flex flex-col overflow-hidden border border-[#9AB4FF]/50 relative"
        id="native-friends-notes-modal"
      >
        {/* Modal Top Header */}
        <div className="bg-gradient-to-r from-[#000035] via-[#062863] to-[#1C4C96] text-white px-5 sm:px-7 py-4.5 flex items-center justify-between shrink-0 shadow-md">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-white/10 backdrop-blur-xs border border-white/20 flex items-center justify-center text-[#9AB4FF] shadow-inner">
              <BookOpen className="w-6 h-6 text-[#9AB4FF]" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-base sm:text-lg font-black tracking-tight text-white">
                  Native Friends Notes
                </h2>
                <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 text-[11px] font-black border border-emerald-400/40">
                  {cefrMeta.cefr} • {cefrMeta.labelEn}
                </span>
              </div>
              <p className="text-xs text-[#9AB4FF] mt-0.5">
                {isEn
                  ? 'Pedagogical transformation calibrated to your CEFR level and speaking goals'
                  : 'Transformação pedagógica calibrada ao seu nível CEFR e objetivos de conversação'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handlePrint}
              className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-bold transition flex items-center gap-1 cursor-pointer border border-white/10"
              title={isEn ? 'Print or save as PDF' : 'Imprimir ou salvar PDF'}
            >
              <Printer className="w-4 h-4 text-[#9AB4FF]" />
              <span className="hidden sm:inline">{isEn ? 'Print' : 'Imprimir'}</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="w-9 h-9 rounded-xl bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition cursor-pointer border border-white/15"
              aria-label="Close"
            >
              <X className="w-5 h-5 text-white" />
            </button>
          </div>
        </div>

        {/* Lesson History Selector Bar (STRICTLY DESCENDING: NEWEST FIRST) */}
        <div className="bg-[#f8faff] border-b border-[#9AB4FF]/30 px-5 sm:px-7 py-2.5 flex flex-col md:flex-row md:items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2 flex-1">
            <Calendar className="w-4 h-4 text-[#1C4C96] shrink-0" />
            <label htmlFor="session-date-selector" className="text-xs font-bold uppercase tracking-wider text-[#062863] shrink-0">
              {isEn ? 'Lesson Date:' : 'Data da Aula:'}
            </label>

            {sessionOptions.length > 0 ? (
              <div className="relative flex-1 max-w-md">
                <select
                  id="session-date-selector"
                  value={selectedSessionKey}
                  onChange={(e) => setSelectedSessionKey(e.target.value)}
                  className="w-full bg-white border border-[#607EC9]/40 rounded-xl px-3 py-1.5 text-xs font-bold text-[#000035] pr-8 focus:outline-none focus:ring-2 focus:ring-[#1C4C96] cursor-pointer shadow-2xs"
                >
                  {sessionOptions.map((opt, idx) => (
                    <option key={opt.key} value={opt.key}>
                      {idx === 0 ? '⭐ [Latest] ' : ''}
                      {opt.dateStr ? formatDateInTimeZone(opt.dateStr, timeZone, isEn ? 'en' : 'pt') : 'Session'}
                      {' — '}
                      {opt.topic} ({opt.teacherName})
                    </option>
                  ))}
                </select>
                <ChevronDown className="w-4 h-4 text-[#607EC9] absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>
            ) : (
              <span className="text-xs text-slate-500 italic">
                {isLoadingSessions
                  ? (isEn ? 'Searching past lessons...' : 'Buscando aulas anteriores...')
                  : (isEn ? 'No notes recorded yet' : 'Nenhuma anotação gravada ainda')}
              </span>
            )}
          </div>

          {/* Refresh analysis */}
          {activeSession && (
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => loadPedagogicalNotes(true)}
                disabled={isLoadingTransformation}
                className="px-3 py-1.5 rounded-xl bg-white hover:bg-slate-100 border border-[#607EC9]/40 text-[#1C4C96] font-bold text-xs flex items-center gap-1.5 transition cursor-pointer shadow-2xs disabled:opacity-50"
                title={isEn ? 'Regenerate pedagogical report' : 'Regerar transformação pedagógica'}
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoadingTransformation ? 'animate-spin' : ''}`} />
                <span>{isEn ? 'Refresh Analysis' : 'Atualizar Análise'}</span>
              </button>
            </div>
          )}
        </div>

        {/* Section Navigation Tabs (Pedagogical Sections) */}
        <div className="bg-white border-b border-[#9AB4FF]/25 px-4 sm:px-7 py-2.5 flex items-center justify-between gap-2 overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden shrink-0">
          <div className="flex items-center gap-1.5 shrink-0 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
            <button
              type="button"
              onClick={() => setActiveTab('all')}
              className={`px-3 py-1.5 rounded-xl text-xs font-black transition cursor-pointer shrink-0 ${
                activeTab === 'all'
                  ? 'bg-[#000035] text-white shadow-2xs'
                  : 'bg-slate-100 text-[#062863] hover:bg-slate-200'
              }`}
            >
              {isEn ? 'Complete Report' : 'Visão Geral'}
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('mistakes')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer flex items-center gap-1.5 shrink-0 relative ${
                activeTab === 'mistakes'
                  ? 'bg-[#b91c1c] text-white shadow-2xs ring-2 ring-red-400'
                  : 'bg-red-50 text-red-800 hover:bg-red-100 border border-red-200'
              }`}
            >
              <span>1. {isEn ? 'Analyze Mistakes' : 'Analyze Mistakes'}</span>
              {transformation?.mistakesAnalysis && (
                <span className="w-4 h-4 rounded-full bg-white/20 text-[10px] flex items-center justify-center font-black">
                  {transformation.mistakesAnalysis.length}
                </span>
              )}
              {currentSequentialTab === 'mistakes' && (
                <span className="w-2 h-2 rounded-full bg-amber-400 absolute -top-0.5 -right-0.5 animate-pulse" title="Sua etapa de hoje" />
              )}
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('grammar')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer flex items-center gap-1.5 shrink-0 relative ${
                activeTab === 'grammar'
                  ? 'bg-[#1C4C96] text-white shadow-2xs ring-2 ring-blue-400'
                  : 'bg-blue-50 text-blue-800 hover:bg-blue-100 border border-blue-200'
              }`}
            >
              <span>2. {isEn ? 'Grammar Points' : 'Grammar Points'}</span>
              {transformation?.grammarPoints && (
                <span className="w-4 h-4 rounded-full bg-white/20 text-[10px] flex items-center justify-center font-black">
                  {transformation.grammarPoints.length}
                </span>
              )}
              {currentSequentialTab === 'grammar' && (
                <span className="w-2 h-2 rounded-full bg-amber-400 absolute -top-0.5 -right-0.5 animate-pulse" title="Sua etapa de hoje" />
              )}
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('vocab')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer flex items-center gap-1.5 shrink-0 relative ${
                activeTab === 'vocab'
                  ? 'bg-purple-700 text-white shadow-2xs ring-2 ring-purple-400'
                  : 'bg-purple-50 text-purple-800 hover:bg-purple-100 border border-purple-200'
              }`}
            >
              <span>3. {isEn ? 'Vocabulary & Expressions' : 'Vocabulary & Expressions'}</span>
              {transformation?.vocabularyAndExpressions && (
                <span className="w-4 h-4 rounded-full bg-white/20 text-[10px] flex items-center justify-center font-black">
                  {transformation.vocabularyAndExpressions.length}
                </span>
              )}
              {currentSequentialTab === 'vocab' && (
                <span className="w-2 h-2 rounded-full bg-amber-400 absolute -top-0.5 -right-0.5 animate-pulse" title="Sua etapa de hoje" />
              )}
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('summary')}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-black transition cursor-pointer flex items-center gap-1.5 shrink-0 relative ${
                activeTab === 'summary'
                  ? 'bg-[#15803d] text-white shadow-md ring-2 ring-emerald-300'
                  : 'bg-emerald-50 text-emerald-900 hover:bg-emerald-100 border border-emerald-300'
              }`}
            >
              <Clock className="w-3.5 h-3.5" />
              <span>4. {isEn ? '5–10 Min Quick Review' : '5–10 Min Quick Review'}</span>
              {(isLessonToday || currentSequentialTab === 'summary') && (
                <span className="w-2 h-2 rounded-full bg-amber-400 absolute -top-0.5 -right-0.5 animate-pulse" title="Revisão prioritária" />
              )}
            </button>
          </div>

          {/* Reading Activity & S-Path Notice Pill */}
          <div className="hidden lg:flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-50 border border-blue-200 text-[#062863] text-[11px] font-semibold shrink-0">
            <BookOpen className="w-3.5 h-3.5 text-[#1C4C96]" />
            <span>
              {isEn ? 'Focused Reading Activity • No S-Path score impact' : 'Atividade de Leitura Focada • Não pontua no S-Path'}
            </span>
          </div>
        </div>

        {/* Modal Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-7 space-y-4 bg-slate-50/50">
          {isLoadingSessions || isLoadingTransformation ? (
            <div className="py-20 flex flex-col items-center justify-center text-center space-y-4">
              <div className="w-14 h-14 rounded-3xl bg-[#000035] text-[#9AB4FF] flex items-center justify-center animate-bounce shadow-lg">
                <Sparkles className="w-7 h-7" />
              </div>
              <div>
                <h3 className="text-base font-black text-[#000035]">
                  {isEn
                    ? 'Transforming Raw Teacher Notes into Masterclass Pedagogical Report...'
                    : 'Transformando Anotações Brutas em Guia Pedagógico Masterclass...'}
                </h3>
                <p className="text-xs text-[#607EC9] mt-1 max-w-md">
                  {isEn
                    ? `Parsing corrections and calibrating rules to CEFR ${cefrMeta.cefr}.`
                    : `Processando correções calibradas para CEFR ${cefrMeta.cefr}.`}
                </p>
              </div>
            </div>
          ) : !activeSession || !transformation ? (
            <div className="py-16 px-6 rounded-3xl border-2 border-dashed border-[#9AB4FF]/50 bg-white flex flex-col items-center justify-center text-center space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-[#9AB4FF]/20 text-[#1C4C96] flex items-center justify-center">
                <BookOpen className="w-6 h-6" />
              </div>
              <h3 className="font-black text-base text-[#000035]">
                {isEn ? 'No In-Session Notes Available' : 'Nenhuma anotação de aula disponível'}
              </h3>
              <p className="text-xs text-[#607EC9] max-w-md">
                {isEn
                  ? 'Your Native Friend will record notes and stamp corrections during your 1-on-1 sessions. They will be transformed into this pedagogical report automatically!'
                  : 'Seu Amigo Nativo gravará anotações e marcará correções durante suas sessões 1-a-1. Elas serão transformadas neste guia pedagógico automaticamente!'}
              </p>
            </div>
          ) : (
            <>
              {/* Minimalist Top Context Strip */}
              {activeTab !== 'all' ? (
                <div className="px-4 py-2 rounded-xl bg-white border border-slate-200/80 shadow-2xs flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-slate-600">
                  <div className="flex items-center gap-2">
                    <span className="text-sm">📖</span>
                    <span className="font-semibold text-[#000035]">
                      {isEn ? 'Focused Reading' : 'Leitura Focada'}
                    </span>
                    <span className="text-slate-300 hidden sm:inline">•</span>
                    <span className="text-slate-500 hidden sm:inline">
                      {isEn ? 'Does not score on S-Path' : 'Não pontua no S-Path'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[11px] text-slate-600 font-medium">
                      📅 {formatDateInTimeZone(transformation.sessionDate, timeZone, isEn ? 'en' : 'pt')} • {transformation.teacherName || 'Native Friend'}
                    </span>
                    <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 text-[10px] font-bold">
                      CEFR {cefrMeta.cefr}
                    </span>
                  </div>
                </div>
              ) : (
                /* Complete Report Overview Card */
                <div className="p-4 rounded-2xl bg-white border border-slate-200/90 shadow-2xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-bold uppercase text-slate-500 tracking-wider">
                        {isEn ? 'Session Focus:' : 'Foco da Sessão:'}
                      </span>
                      <h3 className="font-bold text-sm text-[#000035]">{transformation.topic}</h3>
                      <span className="px-2 py-0.5 rounded-md bg-slate-100 text-[11px] font-semibold text-slate-700">
                        📅 {formatDateInTimeZone(transformation.sessionDate, timeZone, isEn ? 'en' : 'pt')}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500">
                      {isEn ? 'Guided with Native Friend' : 'Conduzida com o Amigo Nativo'}:{' '}
                      <strong className="text-slate-700">{transformation.teacherName || 'Native Friend'}</strong>
                    </p>
                  </div>

                  <div className="flex items-center gap-2 self-start sm:self-auto flex-wrap text-center">
                    <div className="px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200">
                      <div className="text-xs font-black text-red-600">{transformation.incorrectStampsCount}</div>
                      <div className="text-[10px] text-slate-500">{isEn ? 'Corrections' : 'Ajustes'}</div>
                    </div>
                    <div className="px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200">
                      <div className="text-xs font-black text-blue-600">{transformation.newWordStampsCount ?? 0}</div>
                      <div className="text-[10px] text-slate-500">{isEn ? 'Words' : 'Palavras'}</div>
                    </div>
                    <div className="px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200">
                      <div className="text-xs font-black text-purple-600">{transformation.pronounceStampsCount ?? 0}</div>
                      <div className="text-[10px] text-slate-500">{isEn ? 'Pronounce' : 'Pronúncia'}</div>
                    </div>
                    <div className="px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200">
                      <div className="text-xs font-black text-emerald-600">{transformation.correctStampsCount}</div>
                      <div className="text-[10px] text-slate-500">{isEn ? 'Mastered' : 'Acertos'}</div>
                    </div>
                  </div>
                </div>
              )}

              {/* ========================================================
                  SECTION 1: ANALYZE THE STUDENT'S MISTAKES
                  ======================================================== */}
              {(activeTab === 'all' || activeTab === 'mistakes') && (
                <section className="space-y-3" id="section-analyze-mistakes">
                  <div className="flex items-center justify-between border-b border-slate-200/80 pb-2">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-lg bg-red-100 text-red-700 flex items-center justify-center font-bold text-xs">
                        1
                      </div>
                      <h3 className="font-bold text-sm text-[#000035] tracking-tight">
                        {isEn ? 'Analyze Mistakes' : 'Análise de Erros'}
                      </h3>
                      <span className="text-xs text-slate-400">
                        ({transformation.mistakesAnalysis.length})
                      </span>
                    </div>
                    <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                      {isEn ? 'Spoken vs Natural' : 'Falado vs Natural'}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 gap-3.5">
                    {transformation.mistakesAnalysis.map((item, idx) => (
                      <div
                        key={item.id || idx}
                        className="p-5 rounded-2xl bg-white border border-slate-200/90 shadow-2xs hover:border-slate-300 transition-all space-y-3"
                      >
                        {/* Header: Category Tag & Audio */}
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="w-5 h-5 rounded-full bg-red-50 text-red-700 flex items-center justify-center font-bold text-[10px]">
                              {idx + 1}
                            </span>
                            <span className="text-[11px] font-bold text-slate-600 uppercase tracking-wider">
                              {item.category || 'Correction'}
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => speakEnglish(item.corrected)}
                            className="px-2.5 py-1 rounded-lg bg-slate-50 hover:bg-slate-100 text-[#1C4C96] text-xs flex items-center gap-1.5 font-bold cursor-pointer transition border border-slate-200"
                            title={isEn ? 'Listen to natural pronunciation' : 'Ouvir pronúncia natural'}
                          >
                            <Volume2 className="w-3.5 h-3.5 text-[#1C4C96]" />
                            <span className="text-[11px]">{isEn ? 'Listen' : 'Ouvir'}</span>
                          </button>
                        </div>

                        {/* Comparison: Original vs Natural */}
                        <div className="space-y-1.5 p-3 rounded-xl bg-slate-50/70 border border-slate-200/60">
                          <div className="flex items-start gap-2 text-xs">
                            <span className="text-red-500 font-bold shrink-0 mt-0.5">✗</span>
                            <span className="text-slate-500 line-through italic">
                              "{item.original}"
                            </span>
                          </div>
                          <div className="flex items-start gap-2 text-sm">
                            <span className="text-emerald-600 font-bold shrink-0 mt-0.5">✓</span>
                            <span className="text-slate-900 font-bold leading-snug">
                              "{item.corrected}"
                            </span>
                          </div>
                        </div>

                        {/* Pedagogical Explanation */}
                        {item.explanation && (
                          <div className="text-xs text-slate-700 leading-relaxed pl-1 flex items-start gap-2">
                            <Lightbulb className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
                            <p className="flex-1">{item.explanation}</p>
                          </div>
                        )}

                        {/* Natural Examples (if any) */}
                        {Array.isArray(item.twoExamples) && item.twoExamples.length > 0 && (
                          <div className="pt-2 border-t border-slate-100 pl-1 text-xs space-y-1">
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                              {isEn ? 'Natural examples:' : 'Exemplos no dia a dia:'}
                            </span>
                            <div className="space-y-0.5 pl-2 text-slate-700 italic">
                              {item.twoExamples.map((ex, exIdx) => (
                                <div key={exIdx} className="flex items-center gap-1.5">
                                  <span className="text-slate-300">•</span>
                                  <span>{ex}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Common Pitfall (if any) */}
                        {item.commonPitfalls && (
                          <div className="text-[11px] text-amber-900 bg-amber-50/70 px-2.5 py-1.5 rounded-lg border border-amber-200/60 flex items-center gap-1.5">
                            <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                            <span><strong>{isEn ? 'Watch out:' : 'Atenção:'}</strong> {item.commonPitfalls}</span>
                          </div>
                        )}
                      </div>
                    ))}

                    {transformation.mistakesAnalysis.length === 0 && (
                      <div className="p-8 rounded-2xl bg-white border border-slate-200 text-center space-y-2">
                        <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto" />
                        <h4 className="font-bold text-sm text-[#000035]">
                          {isEn ? 'No Mistakes Recorded' : 'Nenhum Erro Registrado'}
                        </h4>
                        <p className="text-xs text-slate-500">
                          {isEn
                            ? 'Great job! Your spoken sentences were accurate and natural in this session.'
                            : 'Excelente trabalho! Suas frases foram precisas e naturais nesta sessão.'}
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Minimalist Bottom Tab Navigation */}
                  {activeTab === 'mistakes' && (
                    <div className="p-3.5 rounded-2xl bg-white border border-slate-200/80 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 mt-4">
                      <div className="text-xs text-slate-500">
                        {isEn ? 'Review complete for mistakes.' : 'Leitura de erros concluída.'}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={handleMarkAsRead}
                          className="px-3.5 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold text-xs flex items-center gap-1.5 shadow-2xs transition cursor-pointer"
                          title={isEn ? 'Mark as read and close (1 tab per day)' : 'Marcar como lida e fechar o painel (1 aba por dia)'}
                        >
                          <CheckCheck className="w-3.5 h-3.5" />
                          <span>{isEn ? 'Mark as Read' : 'Marcar como Lida'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setActiveTab('grammar')}
                          className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs flex items-center gap-1 transition cursor-pointer"
                        >
                          <span>{isEn ? 'Next: Tab 2' : 'Próxima: Aba 2'}</span>
                          <ArrowRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  )}
                </section>
              )}

              {/* ========================================================
                  SECTION 2: TEACH THE GRAMMAR POINTS
                  ======================================================== */}
              {(activeTab === 'all' || activeTab === 'grammar') && (
                <section className="space-y-3" id="section-teach-grammar">
                  <div className="flex items-center justify-between border-b border-slate-200/80 pb-2">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-xs">
                        2
                      </div>
                      <h3 className="font-bold text-sm text-[#000035] tracking-tight">
                        {isEn ? 'Grammar Points' : 'Pontos Gramaticais'}
                      </h3>
                      <span className="text-xs text-slate-400">
                        ({transformation.grammarPoints.length})
                      </span>
                    </div>
                    <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                      {isEn ? 'Rules & Natural Usage' : 'Regras e Uso Prático'}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 gap-3.5">
                    {transformation.grammarPoints.map((gp, idx) => (
                      <div
                        key={gp.id || idx}
                        className="p-5 rounded-2xl bg-white border border-slate-200/90 shadow-2xs hover:border-slate-300 transition-all space-y-3"
                      >
                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <h4 className="font-bold text-sm text-[#000035] flex items-center gap-2">
                            <span className="w-5 h-5 rounded-full bg-blue-100 text-blue-800 flex items-center justify-center font-bold text-[10px]">
                              {idx + 1}
                            </span>
                            <span>{gp.topic}</span>
                          </h4>
                          {gp.form && (
                            <span className="px-2 py-0.5 rounded-md bg-slate-100 font-mono text-[11px] text-slate-700 border border-slate-200">
                              {gp.form}
                            </span>
                          )}
                        </div>

                        {/* Rule */}
                        <div className="text-xs text-slate-700 leading-relaxed pl-7">
                          <p>{gp.rule}</p>
                          {gp.usage && (
                            <p className="mt-1 text-slate-500 italic">{gp.usage}</p>
                          )}
                        </div>

                        {/* Examples */}
                        {Array.isArray(gp.examples) && gp.examples.length > 0 && (
                          <div className="pt-2 border-t border-slate-100 pl-7 text-xs space-y-1">
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                              {isEn ? 'Examples in conversation:' : 'Exemplos práticos:'}
                            </span>
                            <div className="space-y-0.5 text-slate-800 italic">
                              {gp.examples.map((ex, exI) => (
                                <div key={exI} className="flex items-center gap-1.5">
                                  <span className="text-blue-400">•</span>
                                  <span>{ex}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Common Mistakes */}
                        {gp.commonMistakes && (
                          <div className="ml-7 text-[11px] p-2 rounded-lg bg-red-50/70 text-red-900 border border-red-200/60">
                            <strong>{isEn ? 'Watch out:' : 'Atenção:'}</strong> {gp.commonMistakes}
                          </div>
                        )}
                      </div>
                    ))}

                    {transformation.grammarPoints.length === 0 && (
                      <div className="p-8 rounded-2xl bg-white border border-slate-200 text-center space-y-2">
                        <GraduationCap className="w-8 h-8 text-blue-500 mx-auto" />
                        <h4 className="font-bold text-sm text-[#000035]">
                          {isEn ? 'No Formal Grammar Points Recorded' : 'Nenhum Ponto Gramatical Formal'}
                        </h4>
                        <p className="text-xs text-slate-500">
                          {isEn
                            ? 'This session focused primarily on vocabulary and natural fluency.'
                            : 'Esta sessão teve foco em vocabulário e conversação fluida.'}
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Minimalist Bottom Tab Navigation */}
                  {activeTab === 'grammar' && (
                    <div className="p-3.5 rounded-2xl bg-white border border-slate-200/80 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 mt-4">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setActiveTab('mistakes')}
                          className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs flex items-center gap-1 transition cursor-pointer"
                        >
                          <ArrowLeft className="w-3.5 h-3.5" />
                          <span>{isEn ? 'Previous: Tab 1' : 'Anterior: Aba 1'}</span>
                        </button>
                        <span className="text-xs text-slate-500 hidden sm:inline">
                          {isEn ? 'Grammar points reviewed.' : 'Gramática revisada.'}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={handleMarkAsRead}
                          className="px-3.5 py-2 rounded-xl bg-[#1C4C96] hover:bg-[#062863] text-white font-bold text-xs flex items-center gap-1.5 shadow-2xs transition cursor-pointer"
                          title={isEn ? 'Mark as read and close (1 tab per day)' : 'Marcar como lida e fechar o painel (1 aba por dia)'}
                        >
                          <CheckCheck className="w-3.5 h-3.5" />
                          <span>{isEn ? 'Mark as Read' : 'Marcar como Lida'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setActiveTab('vocab')}
                          className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs flex items-center gap-1 transition cursor-pointer"
                        >
                          <span>{isEn ? 'Next: Tab 3' : 'Próxima: Aba 3'}</span>
                          <ArrowRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  )}
                </section>
              )}

              {/* ========================================================
                  SECTION 3: TEACH THE VOCABULARY AND EXPRESSIONS
                  ======================================================== */}
              {(activeTab === 'all' || activeTab === 'vocab') && (
                <section className="space-y-3" id="section-teach-vocabulary">
                  <div className="flex items-center justify-between border-b border-slate-200/80 pb-2">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-lg bg-purple-100 text-purple-700 flex items-center justify-center font-bold text-xs">
                        3
                      </div>
                      <h3 className="font-bold text-sm text-[#000035] tracking-tight">
                        {isEn ? 'Vocabulary & Expressions' : 'Vocabulário & Expressões'}
                      </h3>
                      <span className="text-xs text-slate-400">
                        ({transformation.vocabularyAndExpressions.length})
                      </span>
                    </div>
                    <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                      {isEn ? 'Words • Expressions • Pronunciation' : 'Termos • Expressões • Pronúncia'}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                    {transformation.vocabularyAndExpressions.map((v, idx) => {
                      const isPronounce = v.isPronunciationFocus || v.partOfSpeech === 'Pronunciation Focus' || v.category?.toLowerCase().includes('pronounc');
                      const isNewWord = v.category?.toLowerCase().includes('new word') || v.partOfSpeech?.toLowerCase().includes('new');

                      return (
                        <div
                          key={v.id || idx}
                          className="p-4.5 rounded-2xl bg-white border border-slate-200/90 shadow-2xs hover:border-slate-300 transition-all space-y-2.5 flex flex-col justify-between"
                        >
                          <div className="space-y-2">
                            <div className="flex items-center justify-between gap-2">
                              <span
                                className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider ${
                                  isPronounce
                                    ? 'bg-purple-50 text-purple-800 border border-purple-200/60'
                                    : isNewWord
                                    ? 'bg-blue-50 text-blue-800 border border-blue-200/60'
                                    : 'bg-slate-100 text-slate-700'
                                }`}
                              >
                                {isPronounce
                                  ? (isEn ? 'Pronunciation' : 'Pronúncia')
                                  : isNewWord
                                  ? (isEn ? 'New Term' : 'Novo Termo')
                                  : v.category || (isEn ? 'Vocabulary' : 'Vocabulário')}
                              </span>
                              <div className="flex items-center gap-1.5 flex-wrap justify-end">
                                {(v.cefrLevel || transformation.cefrLevel) && (
                                  <span className="text-[10px] font-black text-white bg-[#000035] px-1.5 py-0.5 rounded uppercase tracking-wider shrink-0 select-none shadow-2xs">
                                    {v.cefrLevel || transformation.cefrLevel}
                                  </span>
                                )}
                                <span className="inline-flex items-center gap-1 text-[10px] text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200/80 font-semibold shadow-2xs">
                                  <Check className="w-3 h-3 text-emerald-600" />
                                  <span>{isEn ? 'In My Dictionary' : 'No Meu Dicionário'}</span>
                                </span>
                                <span className="text-[10px] font-bold text-[#1C4C96] bg-[#9AB4FF]/20 border border-[#9AB4FF]/40 px-1.5 py-0.5 rounded uppercase tracking-wider shrink-0 select-none">
                                  {v.partOfSpeech}
                                </span>
                              </div>
                            </div>

                            <div className="flex items-center justify-between">
                              <h4 className="font-bold text-base text-[#000035] tracking-tight">{v.term}</h4>
                              <button
                                type="button"
                                onClick={() => speakEnglish(v.term)}
                                className="w-7 h-7 rounded-lg bg-slate-50 hover:bg-slate-100 text-purple-700 flex items-center justify-center cursor-pointer transition border border-slate-200 shadow-2xs"
                                title={isEn ? 'Listen to pronunciation' : 'Ouvir pronúncia'}
                              >
                                <Volume2 className="w-3.5 h-3.5" />
                              </button>
                            </div>

                            {v.phoneticGuide && (
                              <div className="text-xs text-purple-900 font-mono bg-purple-50/50 px-2 py-0.5 rounded border border-purple-100 inline-block">
                                {v.phoneticGuide}
                              </div>
                            )}

                            <p className="text-xs text-slate-700 leading-relaxed">
                              {v.simpleDefinition}
                            </p>

                            {/* Real Example */}
                            {Array.isArray(v.realExamples) && v.realExamples.length > 0 && (
                              <p className="text-xs text-slate-500 italic pl-2 border-l-2 border-slate-200">
                                "{v.realExamples[0]}"
                              </p>
                            )}

                            {/* Collocations */}
                            {Array.isArray(v.collocations) && v.collocations.length > 0 && (
                              <div className="flex flex-wrap gap-1 pt-1">
                                {v.collocations.map((col, cI) => (
                                  <span
                                    key={cI}
                                    className="px-2 py-0.5 rounded bg-slate-100 text-slate-600 text-[10px] font-medium"
                                  >
                                    {col}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}

                    {transformation.vocabularyAndExpressions.length === 0 && (
                      <div className="p-8 rounded-2xl bg-white border border-slate-200 text-center space-y-2 col-span-full">
                        <Sparkles className="w-8 h-8 text-purple-500 mx-auto" />
                        <h4 className="font-bold text-sm text-[#000035]">
                          {isEn ? 'No Vocabulary Recorded' : 'Nenhum Novo Termo Marcado'}
                        </h4>
                        <p className="text-xs text-slate-500">
                          {isEn
                            ? 'No new terms or pronunciation marks were recorded in this session.'
                            : 'Nenhum novo termo ou marcação de pronúncia foi registrada nesta sessão.'}
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Minimalist Bottom Tab Navigation */}
                  {activeTab === 'vocab' && (
                    <div className="p-3.5 rounded-2xl bg-white border border-slate-200/80 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 mt-4">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setActiveTab('grammar')}
                          className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs flex items-center gap-1 transition cursor-pointer"
                        >
                          <ArrowLeft className="w-3.5 h-3.5" />
                          <span>{isEn ? 'Previous: Tab 2' : 'Anterior: Aba 2'}</span>
                        </button>
                        <span className="text-xs text-slate-500 hidden sm:inline">
                          {isEn ? 'Vocabulary reviewed.' : 'Vocabulário revisado.'}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={handleMarkAsRead}
                          className="px-3.5 py-2 rounded-xl bg-purple-700 hover:bg-purple-800 text-white font-bold text-xs flex items-center gap-1.5 shadow-2xs transition cursor-pointer"
                          title={isEn ? 'Mark as read and close (1 tab per day)' : 'Marcar como lida e fechar o painel (1 aba por dia)'}
                        >
                          <CheckCheck className="w-3.5 h-3.5" />
                          <span>{isEn ? 'Mark as Read' : 'Marcar como Lida'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setActiveTab('summary')}
                          className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs flex items-center gap-1 transition cursor-pointer"
                        >
                          <span>{isEn ? 'Next: Tab 4' : 'Próxima: Aba 4'}</span>
                          <ArrowRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  )}
                </section>
              )}

              {/* ========================================================
                  SECTION 4: CREATE A 5–10 MINUTE QUICK REVIEW SUMMARY
                  ======================================================== */}
              {(activeTab === 'all' || activeTab === 'summary') && (
                <section className="space-y-3" id="section-review-summary">
                  <div className="flex items-center justify-between border-b border-slate-200/80 pb-2">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-lg bg-emerald-100 text-emerald-800 flex items-center justify-center font-bold text-xs">
                        4
                      </div>
                      <h3 className="font-bold text-sm text-[#000035] tracking-tight">
                        {isEn ? '5–10 Min Quick Review' : 'Revisão Rápida 5–10 Min'}
                      </h3>
                      <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 text-[10px] font-bold">
                        CEFR {transformation.cefrLevel}
                      </span>
                    </div>
                    <span className="text-[11px] font-semibold text-emerald-800 flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5" />
                      <span>{transformation.reviewSummary.estimatedMinutes || '5–10 min'}</span>
                    </span>
                  </div>

                  <div className="p-5 rounded-2xl bg-white border border-slate-200/90 shadow-2xs space-y-4">
                    {/* Golden Remember This Callout */}
                    {transformation.reviewSummary.rememberThis && (
                      <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-950 space-y-1">
                        <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-amber-800">
                          <Sparkles className="w-3.5 h-3.5 text-amber-600" />
                          <span>{isEn ? 'Remember This' : 'Lembre-se disto'}</span>
                        </div>
                        <p className="text-xs sm:text-sm font-semibold leading-relaxed">
                          {transformation.reviewSummary.rememberThis}
                        </p>
                      </div>
                    )}

                    {/* Side by Side: Essential Corrections & Key Rules */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                      {/* Essential Corrections Table */}
                      <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                        <div className="flex items-center justify-between">
                          <h4 className="font-bold text-xs text-slate-800 uppercase tracking-wide flex items-center gap-1.5">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                            <span>{isEn ? 'Key Corrections' : 'Correções Principais'}</span>
                          </h4>
                          <span className="text-[10px] text-slate-400 font-semibold">
                            {transformation.reviewSummary.essentialCorrections.length}
                          </span>
                        </div>
                        <div className="space-y-1.5 text-xs max-h-72 overflow-y-auto pr-1">
                          {transformation.reviewSummary.essentialCorrections.map((c, i) => (
                            <div
                              key={i}
                              className="p-2 rounded-lg bg-white border border-slate-200 flex items-center justify-between gap-2"
                            >
                              <div className="flex items-center gap-1.5 flex-1 min-w-0">
                                <span className="text-red-500 line-through truncate">✗ {c.original}</span>
                                <ArrowRight className="w-3 h-3 text-slate-300 shrink-0" />
                                <span className="text-emerald-700 font-bold truncate">✓ {c.corrected}</span>
                              </div>
                              <button
                                type="button"
                                onClick={() => speakEnglish(c.corrected)}
                                className="p-1 rounded bg-slate-50 hover:bg-slate-100 text-slate-600 cursor-pointer border border-slate-200 shrink-0 transition"
                                title="Listen"
                              >
                                <Volume2 className="w-3 h-3" />
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Key Rules at a Glance */}
                      <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                        <div className="flex items-center justify-between">
                          <h4 className="font-bold text-xs text-slate-800 uppercase tracking-wide flex items-center gap-1.5">
                            <Lightbulb className="w-3.5 h-3.5 text-amber-500" />
                            <span>{isEn ? 'Key Rules' : 'Regras Principais'}</span>
                          </h4>
                          <span className="text-[10px] text-slate-400 font-semibold">
                            {transformation.reviewSummary.keyRules.length}
                          </span>
                        </div>
                        <ul className="space-y-1 text-xs text-slate-700 pl-4 list-disc max-h-72 overflow-y-auto pr-1">
                          {transformation.reviewSummary.keyRules.map((r, i) => (
                            <li key={i} className="leading-snug">{r}</li>
                          ))}
                        </ul>
                      </div>
                    </div>

                    {/* Must-Know Vocabulary Checklist */}
                    {Array.isArray(transformation.reviewSummary.mustKnowVocabulary) &&
                      transformation.reviewSummary.mustKnowVocabulary.length > 0 && (
                        <div className="space-y-1.5 pt-1 border-t border-slate-100">
                          <h4 className="font-bold text-xs text-slate-700 uppercase tracking-wide">
                            {isEn ? 'Key Vocabulary:' : 'Vocabulário Essencial:'}
                          </h4>
                          <div className="flex flex-wrap gap-1.5">
                            {transformation.reviewSummary.mustKnowVocabulary.map((v, i) => (
                              <span
                                key={i}
                                className="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-800 text-xs font-medium border border-slate-200"
                              >
                                {v}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                  </div>

                  {/* Minimalist Bottom Tab Navigation */}
                  {activeTab === 'summary' && (
                    <div className="p-3.5 rounded-2xl bg-white border border-slate-200/80 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 mt-4">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setActiveTab('vocab')}
                          className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs flex items-center gap-1 transition cursor-pointer"
                        >
                          <ArrowLeft className="w-3.5 h-3.5" />
                          <span>{isEn ? 'Previous: Tab 3' : 'Anterior: Aba 3'}</span>
                        </button>
                        <span className="text-xs text-slate-500 hidden sm:inline">
                          {isEn ? 'Quick Review complete.' : 'Resumo rápido concluído.'}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={handleMarkAsRead}
                          className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs flex items-center gap-1.5 shadow-2xs transition cursor-pointer"
                          title={isEn ? 'Mark as read and close (1 tab per day)' : 'Marcar como lida e fechar o painel (1 aba por dia)'}
                        >
                          <CheckCheck className="w-3.5 h-3.5" />
                          <span>{isEn ? 'Mark as Read' : 'Marcar como Lida'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setActiveTab('mistakes')}
                          className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs flex items-center gap-1 transition cursor-pointer"
                        >
                          <span>{isEn ? 'Tab 1: Mistakes' : 'Aba 1: Erros'}</span>
                          <ArrowRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  )}
                </section>
              )}
            </>
          )}
        </div>

        {/* Modal Footer */}
        <div className="bg-white border-t border-slate-200/80 px-5 sm:px-7 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <BookOpen className="w-4 h-4 text-[#1C4C96] shrink-0" />
            <span>
              {isEn
                ? 'Focused reading for natural speech evolution • Does not score on S-Path'
                : 'Leitura focada para evolução contínua da fala • Não pontua no S-Path'}
            </span>
          </div>

          <div className="flex items-center gap-2 justify-end">
            <button
              type="button"
              onClick={handleCopySummary}
              className="px-3.5 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-[#000035] text-xs font-bold transition flex items-center gap-1.5 cursor-pointer"
            >
              {copiedSummary ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4 text-[#1C4C96]" />}
              <span>{copiedSummary ? (isEn ? 'Copied' : 'Copiado') : (isEn ? 'Copy Summary' : 'Copiar Resumo')}</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2 rounded-xl bg-[#000035] hover:bg-[#062863] text-white text-xs font-bold transition cursor-pointer shadow-sm"
            >
              {isEn ? 'Close' : 'Fechar'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
