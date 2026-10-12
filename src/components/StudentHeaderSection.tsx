import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import {
  Award,
  Edit3,
  CheckCircle,
  Hourglass,
  CalendarClock,
  ShieldCheck,
  UserCheck,
  Sparkles,
  BookOpen,
  Clock,
  ArrowRight,
  CheckCheck,
  Lightbulb,
  CheckCircle2,
  X,
  ExternalLink,
} from 'lucide-react';
import {
  LiveLesson,
  GoogleAccount,
  TeacherMeetSettings,
  Language,
  UserProfile,
} from '../types';
import { Translations } from '../utils/i18n';
import { sanitizeTimeZone } from '../utils/timezone';
import { LiveMeetLessonsPanel } from './LiveMeetLessonsPanel';
import { NativeFriendsNotesModal } from './NativeFriendsNotesModal';
import { useNativeFriendsNotesReminder } from '../hooks/useNativeFriendsNotesReminder';

// Pure in-memory tracking for review opened/completed state during active session (ZERO sessionStorage)
const inMemorySessionReviewKeys = new Set<string>();

interface StudentHeaderSectionProps {
  lessons: LiveLesson[];
  currentAccount: GoogleAccount | null;
  userProfile?: UserProfile | null;
  teachers?: GoogleAccount[];
  teacherMeetSettings?: Record<string, TeacherMeetSettings>;
  contractedLessons?: Record<string, number>;
  onUpdateContractedLessons?: (studentEmail: string, totalContracted: number) => void;
  onOpenScheduleModal: () => void;
  onOpenManageSubscription?: () => void;
  onCancelLesson?: (
    lessonId: string,
    reason?: string,
    cancelledBy?: 'student' | 'teacher'
  ) => void;
  onAcceptReschedule?: (lessonId: string) => void;
  onDeclineReschedule?: (lessonId: string) => void;
  onCompleteLesson?: (lessonId: string) => void;
  onMarkNotCompleted?: (lesson: LiveLesson) => void;
  onRescheduleLesson?: (lesson: LiveLesson) => void;
  currentLanguage: Language;
  t: Translations;
  timeZone?: string;
}

export const StudentHeaderSection: React.FC<StudentHeaderSectionProps> = ({
  lessons,
  currentAccount,
  userProfile,
  teachers = [],
  teacherMeetSettings = {},
  contractedLessons = {},
  onUpdateContractedLessons,
  onOpenScheduleModal,
  onOpenManageSubscription,
  onCancelLesson,
  onAcceptReschedule,
  onDeclineReschedule,
  onCompleteLesson,
  onMarkNotCompleted,
  onRescheduleLesson,
  currentLanguage,
  t,
  timeZone = 'America/Sao_Paulo',
}) => {
  const isEn = currentLanguage === 'en';
  const [isNotesModalOpen, setIsNotesModalOpen] = useState(false);
  const [modalInitialTab, setModalInitialTab] = useState<'all' | 'mistakes' | 'grammar' | 'vocab' | 'summary'>('mistakes');
  const studentEmail = (currentAccount?.email || userProfile?.email || '').toLowerCase().trim();
  const studentUid = (currentAccount as any)?.uid || currentAccount?.id || userProfile?.uid || userProfile?.id || '';

  // Intelligent Reminder Hook for Native Friends Notes (Strict rules 1, 2, 3, 4 with no localStorage)
  const {
    reminder,
    advanceSequentialStep,
    latestSession,
    isReviewCompletedToday,
  } = useNativeFriendsNotesReminder({
    studentUid,
    studentEmail,
    lessons,
    timeZone,
    currentLanguage,
    studentLevel: userProfile?.level,
  });

  const [isAlertOpen, setIsAlertOpen] = useState(false);
  const hasAutoOpenedRef = useRef<boolean>(false);

  // Regra 1: Abertura Única Inicial: O painel do Sequential Review deve abrir automaticamente apenas na primeira vez que o aluno abrir/carregar o aplicativo na sessão/dia.
  useEffect(() => {
    if (!reminder) return;
    const studentKey = (studentUid || studentEmail || '').trim().toLowerCase();
    if (!studentKey) return;

    const effectiveTz = sanitizeTimeZone(timeZone);
    const todayStr = new Intl.DateTimeFormat('en-CA', {
      timeZone: effectiveTz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());

    const sessionOpenedKey = `sequential_review_opened_${studentKey}_${todayStr}`;
    const sessionCompletedKey = `sequential_review_completed_${studentKey}_${todayStr}`;

    let alreadyOpenedOrCompleted =
      hasAutoOpenedRef.current ||
      isReviewCompletedToday ||
      inMemorySessionReviewKeys.has(sessionOpenedKey) ||
      inMemorySessionReviewKeys.has(sessionCompletedKey);

    if (!alreadyOpenedOrCompleted) {
      hasAutoOpenedRef.current = true;
      inMemorySessionReviewKeys.add(sessionOpenedKey);
      setIsAlertOpen(true);
    }
  }, [reminder, studentUid, studentEmail, timeZone, isReviewCompletedToday]);

  // Regra 2: Fechamento ao Concluir: Assim que o aluno concluir a revisão do dia (marcando-a como concluída/lida), o painel deve ser fechado imediatamente.
  const handleCompleteReview = useCallback(() => {
    setIsAlertOpen(false);
    setIsNotesModalOpen(false);

    const studentKey = (studentUid || studentEmail || '').trim().toLowerCase();
    const effectiveTz = sanitizeTimeZone(timeZone);
    const todayStr = new Intl.DateTimeFormat('en-CA', {
      timeZone: effectiveTz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());

    hasAutoOpenedRef.current = true;
    if (studentKey) {
      inMemorySessionReviewKeys.add(`sequential_review_opened_${studentKey}_${todayStr}`);
      inMemorySessionReviewKeys.add(`sequential_review_completed_${studentKey}_${todayStr}`);
    }

    advanceSequentialStep();
  }, [advanceSequentialStep, studentUid, studentEmail, timeZone]);

  const handleOpenNotesTab = (tab: 'all' | 'mistakes' | 'grammar' | 'vocab' | 'summary') => {
    setModalInitialTab(tab);
    setIsNotesModalOpen(true);
  };

  const studentLessons = useMemo(() => {
    return [...lessons]
      .filter((l) => {
        const lEmail = (l.studentEmail || '').toLowerCase().trim();
        const lUid = l.studentUid || '';
        const emailMatches = Boolean(studentEmail && lEmail === studentEmail);
        const uidMatches = Boolean(studentUid && lUid === studentUid);
        return emailMatches || uidMatches;
      })
      .sort((a, b) => new Date(a.startDateTime).getTime() - new Date(b.startDateTime).getTime());
  }, [lessons, studentEmail, studentUid]);

  // Native Friend assigned to this student from userProfile or from scheduled lessons
  const isCancelledOrUnenrolled = userProfile?.enrollmentStatus === 'cancelled' || userProfile?.enrollmentStatus === 'not_enrolled';
  const disallowedTeacherEmails = [
    'adm.itissimple@gmail.com',
    'estilobeeforkids@gmail.com',
    'adm.itssimple@gmail.com',
    'estilobeeadm@gmail.com',
    'admin@itissimple.com',
  ];

  const fallbackTeacherFromLesson = !isCancelledOrUnenrolled
    ? studentLessons.find(
        (l) =>
          l.teacherEmail &&
          l.status === 'scheduled' &&
          !l.cancelledAt &&
          !disallowedTeacherEmails.includes((l.teacherEmail || '').toLowerCase().trim())
      )
    : undefined;

  const rawAssignedTeacherEmail = (userProfile?.teacherEmail || (!isCancelledOrUnenrolled && fallbackTeacherFromLesson?.teacherEmail) || '').toLowerCase().trim();
  const rawAssignedTeacherName = userProfile?.teacherName || (!isCancelledOrUnenrolled && fallbackTeacherFromLesson?.teacherName) || '';

  const assignedTeacherEmail = disallowedTeacherEmails.includes(rawAssignedTeacherEmail) || rawAssignedTeacherName.toLowerCase().includes('simple')
    ? ''
    : rawAssignedTeacherEmail;
  const assignedTeacherName = disallowedTeacherEmails.includes(rawAssignedTeacherEmail) || rawAssignedTeacherName.toLowerCase().includes('simple')
    ? ''
    : rawAssignedTeacherName;

  const assignedTeacher = assignedTeacherEmail
    ? (teachers.find((tc) => tc.email.toLowerCase() === assignedTeacherEmail) || {
        name: assignedTeacherName || assignedTeacherEmail.split('@')[0],
        email: assignedTeacherEmail,
        role: 'teacher' as const,
      })
    : null;

  // Contract calculation: default to 0 for new students without contracts, but at least 1 if they booked a trial lesson
  const totalContractedCount =
    contractedLessons[studentEmail] !== undefined
      ? contractedLessons[studentEmail]
      : Math.max(userProfile?.contractedLessons ?? 0, studentLessons.length > 0 ? 1 : 0);

  const [isEditingContract, setIsEditingContract] = useState<boolean>(false);
  const [contractInputVal, setContractInputVal] = useState<number>(totalContractedCount);

  // 2. Realizadas: Quando o aluno confirma a aula através do botão "Realizada" ou quando o aluno cancela a aula por motivo próprio
  const studentRealizadasCount = studentLessons.filter((l) => {
    if (l.status === 'completed') return true;
    if (l.status === 'cancelled' && (l.cancelledBy === 'student' || !l.cancelledBy)) return true;
    if (l.status === 'not_completed' && l.notCompletedResponsible === 'student') return true;
    return false;
  }).length;

  // 3. Saldo restante = Contratadas - realizadas
  const studentRemainingBalance = Math.max(0, totalContractedCount - studentRealizadasCount);

  // 4. Agendadas = aulas agendadas ativas
  const activeScheduledLessons = studentLessons.filter((l) => l.status === 'scheduled' && !l.cancelledAt);
  const studentScheduledCount = activeScheduledLessons.length;

  const handleSaveContract = (e: React.FormEvent) => {
    e.preventDefault();
    if (onUpdateContractedLessons) {
      onUpdateContractedLessons(studentEmail, Math.max(0, contractInputVal));
    }
    setIsEditingContract(false);
  };

  return (
    <div className="space-y-4" id="student-header-section">
      {/* Row 1: Contracted Lessons & Balance (Left) + Fixed Teacher Card (Right) - Compact 1.5cm Height */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-2.5 items-stretch">
        {/* Left: Contracted Lessons & Balance Card */}
        <div className="lg:col-span-8 bg-white rounded-2xl p-2.5 px-3.5 border border-[#607EC9]/30 shadow-2xs flex flex-col justify-between space-y-1.5">
          {/* Header */}
          <div className="flex items-center justify-between gap-2 border-b border-[#9AB4FF]/25 pb-1">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-xs">🏆</span>
              <h3 className="font-black text-[11px] uppercase tracking-wider text-[#000035] truncate">
                {isEn ? 'Contracted Lessons & Balance' : 'Aulas Contratadas & Saldo'}
              </h3>
              <span className="text-[9px] text-[#062863] font-semibold bg-[#9AB4FF]/15 px-2 py-0.2 rounded-full border border-[#9AB4FF]/40 truncate">
                {studentEmail}
              </span>
            </div>

            <div className="shrink-0">
              {!isEditingContract ? (
                <button
                  type="button"
                  onClick={() => {
                    setContractInputVal(totalContractedCount);
                    setIsEditingContract(true);
                  }}
                  className="px-2 py-0.5 bg-[#9AB4FF]/10 hover:bg-[#9AB4FF]/25 border border-[#607EC9]/30 rounded-lg text-[10px] font-bold text-[#062863] flex items-center gap-1 transition cursor-pointer"
                  title={isEn ? 'Edit contracted lessons total' : 'Alterar total de aulas contratadas'}
                >
                  <Edit3 className="w-2.5 h-2.5 text-[#1C4C96]" />
                  <span>{isEn ? 'Edit Total' : 'Editar Total'}</span>
                </button>
              ) : (
                <form onSubmit={handleSaveContract} className="flex items-center gap-1">
                  <input
                    type="number"
                    min="0"
                    max="500"
                    value={contractInputVal}
                    onChange={(e) => setContractInputVal(parseInt(e.target.value, 10) || 0)}
                    className="w-12 px-1 py-0.2 bg-white border border-[#1C4C96] rounded text-[10px] font-black text-center text-[#000035] focus:outline-none"
                    autoFocus
                  />
                  <button
                    type="submit"
                    className="px-2 py-0.2 bg-[#1C4C96] hover:bg-[#062863] text-white rounded text-[10px] font-bold cursor-pointer"
                  >
                    {isEn ? 'Save' : 'Salvar'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsEditingContract(false)}
                    className="px-1.5 py-0.2 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded text-[10px] cursor-pointer"
                  >
                    ✕
                  </button>
                </form>
              )}
            </div>
          </div>

          {/* 4 Metrics Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
            {/* Metric 1: Contracted */}
            <div className="py-1 px-2 bg-slate-50 rounded-xl border border-slate-200/70 flex flex-col justify-center">
              <span className="text-[8.5px] font-bold uppercase tracking-wider text-[#607EC9] leading-none">
                {isEn ? 'Contracted' : 'Contratadas'}
              </span>
              <div className="flex items-baseline gap-1 mt-0.5">
                <span className="text-sm sm:text-base font-black text-[#000035] leading-none">
                  {totalContractedCount}
                </span>
                <span className="text-[9px] text-[#607EC9] font-medium leading-none">
                  {isEn ? 'lessons' : 'aulas'}
                </span>
              </div>
            </div>

            {/* Metric 2: Realizadas */}
            <div className="py-1 px-2 bg-[#9AB4FF]/10 rounded-xl border border-[#9AB4FF]/40 flex flex-col justify-center">
              <span className="text-[8.5px] font-bold uppercase tracking-wider text-[#062863] leading-none flex items-center gap-0.5">
                <CheckCircle className="w-2.5 h-2.5 text-[#1C4C96] shrink-0" />
                <span className="truncate">{isEn ? 'Completed' : 'Realizadas'}</span>
              </span>
              <div className="flex items-baseline gap-1 mt-0.5">
                <span className="text-sm sm:text-base font-black text-[#062863] leading-none">
                  {studentRealizadasCount}
                </span>
                <span className="text-[9px] text-[#062863] font-medium leading-none">
                  {isEn ? 'completed' : 'realizadas'}
                </span>
              </div>
            </div>

            {/* Metric 3: Remaining Balance (Dark blue block with bright text) */}
            <div className="py-1 px-2 bg-[#000035] text-white rounded-xl border border-[#1C4C96] shadow-2xs flex flex-col justify-center">
              <span className="text-[8.5px] font-bold uppercase tracking-wider text-[#9AB4FF] leading-none flex items-center gap-0.5">
                <Hourglass className="w-2.5 h-2.5 text-[#9AB4FF] shrink-0" />
                <span className="truncate">{isEn ? 'Balance' : 'Saldo Restante'}</span>
              </span>
              <div className="flex items-baseline gap-1 mt-0.5">
                <span className="text-sm sm:text-base font-black text-white leading-none">
                  {studentRemainingBalance}
                </span>
                <span className="text-[9px] text-[#9AB4FF] font-bold leading-none">
                  {isEn ? 'avail.' : 'disponíveis'}
                </span>
              </div>
            </div>

            {/* Metric 4: Scheduled Active */}
            <div className="py-1 px-2 bg-slate-50 rounded-xl border border-slate-200/70 flex flex-col justify-center">
              <span className="text-[8.5px] font-bold uppercase tracking-wider text-[#607EC9] leading-none flex items-center gap-0.5">
                <CalendarClock className="w-2.5 h-2.5 text-[#1C4C96] shrink-0" />
                <span className="truncate">{isEn ? 'Scheduled' : 'Agendadas (Ativas)'}</span>
              </span>
              <div className="flex items-baseline gap-1 mt-0.5">
                <span className="text-sm sm:text-base font-black text-[#000035] leading-none">
                  {studentScheduledCount}
                </span>
                <span className="text-[9px] text-[#607EC9] font-medium leading-none">
                  {isEn ? 'booked' : 'agendadas'}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Right: Amigo Nativo Card with Gerenciar Inscrição Button */}
        <div className="lg:col-span-4 bg-white rounded-2xl p-2.5 px-3.5 border border-[#607EC9]/30 shadow-2xs flex items-center justify-between gap-2.5">
          <div className="flex items-center gap-2.5 min-w-0">
            {/* Avatar Circle with Letter initial */}
            <div className="w-9 h-9 rounded-full bg-[#000035] text-white flex items-center justify-center font-black text-sm shadow-xs border-2 border-[#9AB4FF]/50 shrink-0">
              {assignedTeacher?.name
                ? assignedTeacher.name.charAt(0).toUpperCase()
                : (assignedTeacher?.email ? assignedTeacher.email.charAt(0).toUpperCase() : 'AN')}
            </div>

            <div className="min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <h4 className="font-black text-xs text-[#000035] truncate">
                  {assignedTeacher ? assignedTeacher.name : (isEn ? 'No Native Friend' : 'Nenhum Amigo Nativo')}
                </h4>
                <span className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded-full bg-[#1C4C96]/15 text-[#1C4C96] text-[9px] font-extrabold border border-[#1C4C96]/30">
                  <ShieldCheck className="w-2.5 h-2.5 text-[#1C4C96]" />
                  <span>{isEn ? 'Native Friend' : 'Amigo Nativo'}</span>
                </span>
              </div>
              <p className="text-[10px] text-[#607EC9] truncate mt-0.5 font-medium">
                {assignedTeacher?.email || (isEn ? 'Select a native friend below' : 'Vincule seu amigo nativo')}
              </p>
            </div>
          </div>

          {/* Gerenciar Inscrição / Escolher Amigo Button */}
          {onOpenManageSubscription && (
            <button
              type="button"
              onClick={onOpenManageSubscription}
              className={`px-3 py-1.5 rounded-xl text-[10px] font-bold transition flex items-center gap-1 cursor-pointer shrink-0 shadow-2xs active:scale-98 ${
                assignedTeacher
                  ? 'bg-[#1C4C96] hover:bg-[#062863] text-white border border-[#9AB4FF]/40'
                  : 'bg-emerald-600 hover:bg-emerald-500 text-white border border-emerald-400/60 shadow-xs'
              }`}
              title={isEn ? 'Manage Native Friend subscription & packages' : 'Gerenciar Amigo Nativo e pacotes de aulas'}
            >
              <UserCheck className={`w-3 h-3 ${assignedTeacher ? 'text-[#9AB4FF]' : 'text-emerald-200'}`} />
              <span className="whitespace-nowrap">
                {assignedTeacher
                  ? (isEn ? 'Manage' : 'Gerenciar Inscrição')
                  : (isEn ? 'Choose Friend & Package' : 'Escolher Amigo & Aulas')}
              </span>
            </button>
          )}
        </div>
      </div>

      {/* Dynamic Pop-up Alert on Student Page Load (Regra 1: No alert if no lessons, Regra 2: Quick Review today, Regra 3: Sequential review, Regra 4: Auto-reset on new notes) */}
      {isAlertOpen && reminder && (
        <div
          id="native-friends-notes-alert-popup"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200"
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            // Dismiss if clicking outer backdrop
            if (e.target === e.currentTarget) {
              setIsAlertOpen(false);
            }
          }}
        >
          <div
            onClick={() => {
              setIsAlertOpen(false);
              handleOpenNotesTab(reminder.targetTab);
            }}
            className={`w-full max-w-lg rounded-3xl p-5 sm:p-6 shadow-2xl border-2 transition-all relative overflow-hidden animate-in zoom-in-95 duration-200 cursor-pointer group hover:scale-[1.01] active:scale-[0.99] ${
              reminder.rule === 'rule_2_quick_review_today'
                ? 'bg-gradient-to-b from-[#000035] via-[#062863] to-[#041d45] text-white border-emerald-400/80 shadow-emerald-950/40 hover:border-emerald-300'
                : 'bg-gradient-to-b from-[#000035] via-[#062863] to-[#041d45] text-white border-[#9AB4FF]/80 shadow-[#062863]/50 hover:border-white'
            }`}
            title={isEn ? `Click to open Tab ${reminder.tabNumber}: ${reminder.tabLabel}` : `Clique para abrir a Aba ${reminder.tabNumber}: ${reminder.tabLabel}`}
          >
            {/* Top decorative glow */}
            <div
              className={`absolute top-0 left-0 right-0 h-1.5 ${
                reminder.rule === 'rule_2_quick_review_today'
                  ? 'bg-gradient-to-r from-emerald-400 via-teal-300 to-emerald-500'
                  : 'bg-gradient-to-r from-[#9AB4FF] via-amber-300 to-[#1C4C96]'
              }`}
            />

            {/* Header: Badge & Close Button */}
            <div className="flex items-start justify-between gap-3 pb-3 border-b border-white/10">
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black uppercase tracking-wider ${
                    reminder.rule === 'rule_2_quick_review_today'
                      ? 'bg-emerald-500/25 text-emerald-300 border border-emerald-400/50 animate-pulse'
                      : 'bg-amber-400/20 text-amber-300 border border-amber-400/40'
                  }`}
                >
                  {reminder.rule === 'rule_2_quick_review_today' ? (
                    <>
                      <Clock className="w-3.5 h-3.5 text-emerald-300" />
                      <span>{isEn ? 'Lesson Today • Quick Review' : 'Aula Hoje • Quick Review'}</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-3.5 h-3.5 text-amber-300" />
                      <span>{isEn ? `Sequential Review • Step ${reminder.tabNumber} of 4` : `Revisão Sequencial • Passo ${reminder.tabNumber} de 4`}</span>
                    </>
                  )}
                </span>

                <span className="text-[11px] text-white/70 font-semibold">
                  {reminder.sessionDate ? `Ref: ${reminder.sessionDate}` : ''} • {reminder.teacherName || 'Native Friend'}
                </span>
              </div>

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsAlertOpen(false);
                }}
                className="w-8 h-8 rounded-xl bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition cursor-pointer shrink-0 border border-white/15"
                title={isEn ? 'Dismiss alert' : 'Fechar alerta'}
                aria-label="Close"
              >
                <X className="w-4 h-4 text-white" />
              </button>
            </div>

            {/* Alert Body */}
            <div className="py-4 space-y-3.5">
              <div className="flex items-start gap-3.5">
                <div
                  className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 border shadow-inner group-hover:scale-105 transition-transform ${
                    reminder.rule === 'rule_2_quick_review_today'
                      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-400/40'
                      : 'bg-[#9AB4FF]/20 text-[#9AB4FF] border-[#9AB4FF]/40'
                  }`}
                >
                  {reminder.rule === 'rule_2_quick_review_today' ? (
                    <Clock className="w-6 h-6 text-emerald-300" />
                  ) : (
                    <BookOpen className="w-6 h-6 text-[#9AB4FF]" />
                  )}
                </div>

                <div className="space-y-1">
                  <div className="flex items-center gap-1.5">
                    <h3 className="font-black text-base sm:text-lg text-white leading-tight">
                      {reminder.title}
                    </h3>
                    <ExternalLink className="w-3.5 h-3.5 text-[#9AB4FF] opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                  </div>
                  <p className="text-xs sm:text-sm text-[#9AB4FF] leading-relaxed">
                    {reminder.message}
                  </p>
                </div>
              </div>

              {/* 4-Step sequence preview for Rule 3 */}
              {reminder.rule === 'rule_3_sequential_review' && (
                <div className="p-3 rounded-2xl bg-white/5 border border-white/10 space-y-2">
                  <div className="text-[10px] uppercase font-bold text-white/60 tracking-wider">
                    {isEn ? 'Review Sequence Progress:' : 'Sequência de Revisão Contínua:'}
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                    {[
                      { num: 1, key: 'mistakes' as const, label: '1. Mistakes' },
                      { num: 2, key: 'grammar' as const, label: '2. Grammar' },
                      { num: 3, key: 'vocab' as const, label: '3. Vocab' },
                      { num: 4, key: 'summary' as const, label: '4. Quick Review' },
                    ].map((st) => {
                      const isCurrent = reminder.targetTab === st.key;
                      return (
                        <div
                          key={st.num}
                          className={`p-1.5 rounded-xl text-center text-[10px] font-bold border transition ${
                            isCurrent
                              ? 'bg-amber-400 text-[#000035] border-amber-300 font-black shadow-xs ring-2 ring-white/50'
                              : 'bg-white/5 text-white/70 border-white/10'
                          }`}
                        >
                          {isCurrent && <span className="mr-0.5">🎯</span>}
                          <span>{st.label}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* S-Path Reading Activity notice */}
              <div className="p-2.5 rounded-xl bg-white/5 border border-white/10 text-[11px] text-white/80 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm">📖</span>
                  <span>
                    {isEn
                      ? 'Focused reading activity for speech evolution • No S-Path score impact'
                      : 'Atividade de leitura focada para evolução na fala • Não pontua no S-Path'}
                  </span>
                </div>
                <span className="text-[10px] text-[#9AB4FF] font-semibold hidden sm:inline">
                  {isEn ? 'Click to open →' : 'Clique para abrir →'}
                </span>
              </div>
            </div>

            {/* Alert Actions */}
            <div className="pt-2 flex flex-col sm:flex-row items-center justify-end gap-2.5 border-t border-white/10">
              {reminder.rule === 'rule_3_sequential_review' ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCompleteReview();
                  }}
                  className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white font-bold text-xs flex items-center justify-center gap-1.5 border border-white/15 transition cursor-pointer"
                  title={isEn ? 'Mark this step as read and advance sequence' : 'Marcar como lida e avançar para o próximo passo'}
                >
                  <CheckCheck className="w-4 h-4 text-emerald-400" />
                  <span>{isEn ? 'Mark as Read & Advance' : 'Marcar como Lida & Avançar'}</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCompleteReview();
                  }}
                  className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white font-bold text-xs flex items-center justify-center gap-1.5 border border-white/15 transition cursor-pointer"
                  title={isEn ? 'Mark as read and close' : 'Marcar como lida e fechar'}
                >
                  <CheckCheck className="w-4 h-4 text-emerald-400" />
                  <span>{isEn ? 'Mark as Read' : 'Marcar como Lida'}</span>
                </button>
              )}

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsAlertOpen(false);
                  handleOpenNotesTab(reminder.targetTab);
                }}
                className={`w-full sm:w-auto px-6 py-2.5 rounded-xl font-black text-xs flex items-center justify-center gap-2 transition cursor-pointer shadow-lg active:scale-98 ${
                  reminder.rule === 'rule_2_quick_review_today'
                    ? 'bg-emerald-500 hover:bg-emerald-400 text-[#000035]'
                    : 'bg-white hover:bg-slate-100 text-[#000035]'
                }`}
              >
                <span>
                  {reminder.rule === 'rule_2_quick_review_today'
                    ? (isEn ? 'Open Quick Review (Tab 4)' : 'Ler Quick Review (Aba 4)')
                    : (isEn ? `Open Tab ${reminder.tabNumber}: ${reminder.tabLabel}` : `Acessar Aba ${reminder.tabNumber}: ${reminder.tabLabel}`)}
                </span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Row 2: Live 1-on-1 Sessions with Your Native Friend */}
      <LiveMeetLessonsPanel
        lessons={studentLessons}
        currentAccount={currentAccount}
        isTeacher={false}
        onOpenScheduleModal={onOpenScheduleModal}
        onRescheduleLesson={onRescheduleLesson}
        onCancelLesson={onCancelLesson}
        onAcceptReschedule={onAcceptReschedule}
        onDeclineReschedule={onDeclineReschedule}
        onCompleteLesson={onCompleteLesson}
        onMarkNotCompleted={onMarkNotCompleted}
        currentLanguage={currentLanguage}
        t={t}
        timeZone={timeZone}
      />

      {/* Button: Native Friends Notes (placed immediately below Live 1-on-1 Sessions with Your Native Friend) */}
      <div className="flex justify-end pt-1" id="native-friends-notes-button-container">
        <button
          type="button"
          onClick={() => handleOpenNotesTab(reminder?.targetTab || 'mistakes')}
          className="w-full sm:w-auto inline-flex items-center justify-center gap-2.5 px-6 py-3 rounded-2xl bg-gradient-to-r from-[#000035] via-[#062863] to-[#1C4C96] hover:from-[#062863] hover:to-[#000035] text-white font-bold text-xs sm:text-sm shadow-md hover:shadow-lg transition-all duration-200 border border-[#9AB4FF]/40 cursor-pointer active:scale-98 group"
          id="btn-native-friends-notes"
        >
          <div className="w-7 h-7 rounded-xl bg-[#9AB4FF]/20 flex items-center justify-center text-[#9AB4FF] group-hover:scale-110 transition-transform">
            <BookOpen className="w-4 h-4 text-[#9AB4FF]" />
          </div>
          <span className="tracking-wide">Native Friends Notes</span>
          {reminder ? (
            <span
              className={`text-[10px] sm:text-xs px-2.5 py-0.5 rounded-full font-black border ${
                reminder.rule === 'rule_2_quick_review_today'
                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-400/40 animate-pulse'
                  : 'bg-amber-400/20 text-amber-300 border-amber-300/40'
              }`}
            >
              {reminder.rule === 'rule_2_quick_review_today'
                ? (isEn ? '⚡ Review: Tab 4' : '⚡ Revisar: Aba 4')
                : (isEn ? `🎯 Today's Step: Tab ${reminder.tabNumber}` : `🎯 Etapa de Hoje: Aba ${reminder.tabNumber}`)}
            </span>
          ) : (
            <span className="text-[10px] sm:text-xs px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-extrabold border border-emerald-400/30">
              {isEn ? 'Pedagogical Guide' : 'Guia Pedagógico'}
            </span>
          )}
        </button>
      </div>

      {/* Native Friends Notes Pedagogical Modal */}
      <NativeFriendsNotesModal
        isOpen={isNotesModalOpen}
        onClose={() => setIsNotesModalOpen(false)}
        studentUid={studentUid}
        studentEmail={studentEmail}
        currentAccount={currentAccount}
        userProfile={userProfile}
        lessons={lessons}
        timeZone={timeZone}
        currentLanguage={currentLanguage}
        initialTab={modalInitialTab}
        onAdvanceSequentialStep={handleCompleteReview}
        currentSequentialTab={reminder?.targetTab}
        currentStepNumber={reminder?.tabNumber}
        isLessonToday={reminder?.isLessonToday}
      />
    </div>
  );
};
