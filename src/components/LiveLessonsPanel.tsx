import React, { useState } from 'react';
import {
  Video,
  Calendar,
  Calendar as CalendarIcon,
  Clock,
  ExternalLink,
  Trash2,
  Plus,
  User,
  CheckCircle,
  AlertCircle,
  AlertTriangle,
  Settings,
  CalendarClock,
  Check,
  X,
  ChevronDown,
  ChevronUp,
  CalendarPlus,
  Edit3,
  Award,
  Hourglass,
  Heart,
  XCircle,
  RotateCcw,
  MinusCircle,
  Globe,
} from 'lucide-react';
import { LiveLesson, GoogleAccount, TeacherMeetSettings, Language } from '../types';
import { Translations } from '../utils/i18n';
import { generateGoogleCalendarWebLink, deduplicateLessons } from '../utils/calendar';
import {
  formatDateInTimeZone,
  formatTimeInTimeZone,
  getTimezoneDisplayLabel,
  DEFAULT_STUDENT_TIMEZONE,
  DEFAULT_TEACHER_TIMEZONE,
} from '../utils/timezone';

interface LiveLessonsPanelProps {
  lessons: LiveLesson[];
  currentAccount: GoogleAccount | null;
  teachers: GoogleAccount[];
  teacherMeetSettings: Record<string, TeacherMeetSettings>;
  contractedLessons?: Record<string, number>;
  onUpdateContractedLessons?: (studentEmail: string, count: number) => void;
  onOpenScheduleModal: () => void;
  onOpenTeacherMeetConfig: (teacherEmail: string) => void;
  onCancelLesson: (lessonId: string) => void;
  onCompleteLesson: (lessonId: string) => void;
  onMarkNotCompleted: (lesson: LiveLesson) => void;
  onRescheduleLesson: (lesson: LiveLesson) => void;
  onAcceptReschedule?: (lesson: LiveLesson) => void;
  onRejectReschedule?: (lesson: LiveLesson) => void;
  currentLanguage: Language;
  t: Translations;
  selectedStudentFilter?: string;
  onSelectStudentFilter?: (studentEmail: string) => void;
  timeZone?: string;
}

export const LiveLessonsPanel: React.FC<LiveLessonsPanelProps> = ({
  lessons,
  currentAccount,
  teachers,
  teacherMeetSettings,
  contractedLessons = {},
  onUpdateContractedLessons,
  onOpenScheduleModal,
  onOpenTeacherMeetConfig,
  onCancelLesson,
  onCompleteLesson,
  onMarkNotCompleted,
  onRescheduleLesson,
  onAcceptReschedule,
  onRejectReschedule,
  currentLanguage,
  t,
  selectedStudentFilter = 'all',
  onSelectStudentFilter,
  timeZone,
}) => {
  const isEn = currentLanguage === 'en';
  const isTeacher = currentAccount ? (currentAccount.role === 'teacher' || currentAccount.role === 'admin') : false;
  const activeTz = timeZone || (isTeacher ? DEFAULT_TEACHER_TIMEZONE : DEFAULT_STUDENT_TIMEZONE);
  const [showCompletedHistory, setShowCompletedHistory] = useState<boolean>(false);
  const [isEditingContract, setIsEditingContract] = useState<boolean>(false);
  const [editingEmail, setEditingEmail] = useState<string>('');
  const [contractInputVal, setContractInputVal] = useState<number>(10);

  const cleanLessons = deduplicateLessons(lessons || []);
  const baseRelevantLessons = cleanLessons.filter((l) => {
    if (!l || l.status === 'cancelled') return false;
    if (!currentAccount || currentAccount.role === 'admin' || currentAccount.role === 'teacher') return true;
    const userEmail = (currentAccount.email || '').toLowerCase().trim();
    const teacherEmail = (l.teacherEmail || '').toLowerCase().trim();
    const studentEmail = (l.studentEmail || '').toLowerCase().trim();
    return teacherEmail === userEmail || studentEmail === userEmail;
  });

  const relevantLessons = isTeacher && selectedStudentFilter && selectedStudentFilter !== 'all'
    ? baseRelevantLessons.filter(
        (l) => (l.studentEmail || '').toLowerCase().trim() === selectedStudentFilter.toLowerCase().trim()
      )
    : baseRelevantLessons;

  const activeLessons = relevantLessons
    .filter((l) => l.status === 'scheduled')
    .sort((a, b) => new Date(a.startDateTime).getTime() - new Date(b.startDateTime).getTime());

  const completedLessons = relevantLessons
    .filter((l) => l.status === 'completed')
    .sort((a, b) => new Date(b.startDateTime).getTime() - new Date(a.startDateTime).getTime());

  const notCompletedLessons = relevantLessons
    .filter((l) => l.status === 'not_completed')
    .sort((a, b) => new Date(b.startDateTime).getTime() - new Date(a.startDateTime).getTime());

  const nowMs = Date.now();
  const overdueLessons = activeLessons.filter((l) => {
    const endMs = new Date(l.endDateTime).getTime();
    return endMs < nowMs;
  });

  const teacherEmailKey = currentAccount?.email || 'itissimple.school@gmail.com';
  const teacherSettings = teacherMeetSettings[teacherEmailKey] || {
    teacherEmail: teacherEmailKey,
    meetLink: 'https://meet.google.com/new',
    workingHoursStart: '08:00',
    workingHoursEnd: '18:00',
    slotDurationMinutes: 30,
    availableDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'],
    timezone: 'America/Sao_Paulo',
  };

  const primaryStudentEmail =
    currentAccount?.role === 'student'
      ? currentAccount.email.toLowerCase().trim()
      : (activeLessons[0]?.studentEmail ||
          completedLessons[0]?.studentEmail ||
          notCompletedLessons[0]?.studentEmail ||
          '')
          .toLowerCase()
          .trim();

  const defaultCount = 10;
  const studentContractedTotal = contractedLessons[primaryStudentEmail] ?? defaultCount;

  // 2. Realizadas: Quando o aluno confirma a aula através do botão "Realizada" ou quando o aluno cancela a aula por motivo próprio.
  const studentRealizadasCount = lessons.filter((l) => {
    const email = (l.studentEmail || '').toLowerCase().trim();
    if (primaryStudentEmail && email !== primaryStudentEmail) return false;
    if (l.status === 'completed') return true;
    if (l.status === 'cancelled' && (l.cancelledBy === 'student' || !l.cancelledBy)) return true;
    if (l.status === 'not_completed' && l.notCompletedResponsible === 'student') return true;
    return false;
  }).length;

  // 3. Saldo restante = Contratadas - realizadas
  const studentRemainingBalance = Math.max(0, studentContractedTotal - studentRealizadasCount);

  // 4. Agendadas = aulas agendadas ativas
  const studentScheduledCount = activeLessons.filter(
    (l) => !primaryStudentEmail || (l.studentEmail || '').toLowerCase().trim() === primaryStudentEmail
  ).length;

  const handleStartEditContract = (emailToEdit: string, currentVal: number) => {
    setEditingEmail(emailToEdit);
    setContractInputVal(currentVal);
    setIsEditingContract(true);
  };

  const handleSaveContract = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (onUpdateContractedLessons && editingEmail) {
      onUpdateContractedLessons(editingEmail, Math.max(0, Number(contractInputVal) || 0));
    }
    setIsEditingContract(false);
  };

  return (
    <div className="bg-white rounded-3xl border border-[#607EC9]/30 shadow-sm p-4 sm:p-6 mb-6 space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[#9AB4FF]/30">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-[#062863] flex items-center justify-center text-white shadow-xs border border-[#1C4C96]">
            <Video className="w-5 h-5 text-[#9AB4FF]" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-black text-base sm:text-lg text-[#000035] tracking-tight">
                {t.liveLessonsTitle}
              </h3>
              <span className="text-[11px] px-2.5 py-0.5 rounded-full font-bold bg-[#9AB4FF]/25 text-[#062863] border border-[#9AB4FF]">
                Google Meet & Calendar
              </span>
            </div>
            <p className="text-xs text-[#607EC9] mt-0.5 font-medium">
              {t.liveLessonsSubtitle}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {isTeacher && (
            <button
              type="button"
              onClick={() => onOpenTeacherMeetConfig(currentAccount?.email || '')}
              className="px-3.5 py-2 bg-white hover:bg-[#9AB4FF]/15 text-[#062863] border border-[#607EC9]/40 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-2xs"
              title="Configurar horários de 30 em 30 min, bloqueio por dia da semana e fuso horário"
            >
              <Settings className="w-4 h-4 text-[#1C4C96]" />
              <span>{isEn ? 'Schedule & Timezone Setup' : 'Configurar Horários & Fuso'}</span>
            </button>
          )}

          <button
            type="button"
            onClick={onOpenScheduleModal}
            className="px-4 py-2 bg-[#1C4C96] hover:bg-[#062863] text-white rounded-xl text-xs font-extrabold shadow-md transition flex items-center gap-1.5 cursor-pointer"
          >
            <Plus className="w-4 h-4 text-[#9AB4FF]" />
            <span>{t.scheduleLiveLessonBtn}</span>
          </button>
        </div>
      </div>

      {/* Contracted Lessons Counter Widget */}
      <div className="bg-[#9AB4FF]/10 border border-[#607EC9]/30 rounded-2xl p-4 shadow-2xs space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[#9AB4FF]/30 pb-3">
          <div className="flex items-center gap-2">
            <Award className="w-4 h-4 text-[#1C4C96]" />
            <h4 className="font-extrabold text-xs uppercase tracking-wider text-[#000035]">
              {isEn ? 'Contracted Lessons & Balance' : 'Contador de Aulas Contratadas e Saldo'}
            </h4>
            <span className="text-[10px] text-[#062863] font-semibold bg-white px-2 py-0.5 rounded-full border border-[#9AB4FF]/60">
              {primaryStudentEmail}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {!isEditingContract ? (
              <button
                type="button"
                onClick={() => handleStartEditContract(primaryStudentEmail, studentContractedTotal)}
                className="px-2.5 py-1 bg-white hover:bg-[#9AB4FF]/15 border border-[#607EC9]/40 rounded-xl text-[11px] font-bold text-[#062863] flex items-center gap-1 transition cursor-pointer shadow-2xs"
                title={isEn ? 'Edit contracted lessons total' : 'Informar ou alterar total de aulas contratadas'}
              >
                <Edit3 className="w-3 h-3 text-[#1C4C96]" />
                <span>{isEn ? 'Edit Contracted Total' : 'Informar/Alterar Contrato'}</span>
              </button>
            ) : (
              <form onSubmit={handleSaveContract} className="flex items-center gap-1.5">
                <label className="text-[11px] font-bold text-[#000035]">
                  {isEn ? 'Total:' : 'Total:'}
                </label>
                <input
                  type="number"
                  min="0"
                  max="500"
                  value={contractInputVal}
                  onChange={(e) => setContractInputVal(parseInt(e.target.value, 10) || 0)}
                  className="w-16 px-2 py-0.5 bg-white border border-[#1C4C96] rounded-lg text-xs font-black text-center text-[#000035] focus:outline-none focus:ring-1 focus:ring-[#1C4C96]"
                  autoFocus
                />
                <button
                  type="submit"
                  className="px-2.5 py-0.5 bg-[#1C4C96] hover:bg-[#062863] text-white rounded-lg text-[11px] font-extrabold cursor-pointer"
                >
                  {isEn ? 'Save' : 'Salvar'}
                </button>
                <button
                  type="button"
                  onClick={() => setIsEditingContract(false)}
                  className="px-2.5 py-0.5 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-lg text-[11px] font-bold cursor-pointer"
                >
                  {isEn ? 'Cancel' : 'Cancelar'}
                </button>
              </form>
            )}
          </div>
        </div>

        {/* Metric Cards Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3.5">
          <div className="p-3 bg-white rounded-xl border border-[#607EC9]/30 shadow-2xs">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#607EC9] block">
              {isEn ? 'Contracted' : 'Aulas Contratadas'}
            </span>
            <div className="flex items-baseline gap-1 mt-1">
              <span className="text-xl sm:text-2xl font-black text-[#000035]">
                {studentContractedTotal}
              </span>
              <span className="text-[11px] text-[#607EC9] font-semibold">
                {isEn ? 'lessons' : 'aulas'}
              </span>
            </div>
          </div>

          <div className="p-3 bg-[#9AB4FF]/15 rounded-xl border border-[#9AB4FF]/60 shadow-2xs">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#062863] block flex items-center gap-1">
              <CheckCircle className="w-3 h-3 text-[#1C4C96] shrink-0" />
              <span>{isEn ? 'Completed' : 'Realizadas'}</span>
            </span>
            <div className="flex items-baseline gap-1 mt-1">
              <span className="text-xl sm:text-2xl font-black text-[#062863]">
                {studentRealizadasCount}
              </span>
              <span className="text-[11px] text-[#062863] font-semibold">
                {isEn ? 'completed' : 'realizadas'}
              </span>
            </div>
            <span className="text-[10px] text-[#607EC9] block mt-0.5">
              {isEn ? 'Completed & student cancellations' : 'Concluídas e cancelamentos do aluno'}
            </span>
          </div>

          <div className="p-3 bg-[#062863] text-white rounded-xl border border-[#1C4C96] shadow-2xs">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#9AB4FF] block flex items-center gap-1">
              <Hourglass className="w-3 h-3 text-[#9AB4FF] shrink-0" />
              <span>{isEn ? 'Remaining Balance' : 'Aulas Restantes'}</span>
            </span>
            <div className="flex items-baseline gap-1 mt-1">
              <span className="text-xl sm:text-2xl font-black text-white">
                {studentRemainingBalance}
              </span>
              <span className="text-[11px] text-[#9AB4FF] font-bold">
                {isEn ? 'available' : 'disponíveis'}
              </span>
            </div>
          </div>

          <div className={`p-3 rounded-xl border shadow-2xs ${
            overdueLessons.length > 0
              ? 'bg-amber-50 border-amber-300'
              : 'bg-white border-[#607EC9]/30'
          }`}>
            <span className={`text-[10px] font-bold uppercase tracking-wider block flex items-center gap-1 ${
              overdueLessons.length > 0 ? 'text-amber-800' : 'text-[#607EC9]'
            }`}>
              <CalendarClock className={`w-3 h-3 shrink-0 ${
                overdueLessons.length > 0 ? 'text-amber-700' : 'text-[#1C4C96]'
              }`} />
              <span>{isEn ? 'Scheduled (Active)' : 'Aulas Agendadas'}</span>
            </span>
            <div className="flex items-baseline gap-1 mt-1">
              <span className={`text-xl sm:text-2xl font-black ${
                overdueLessons.length > 0 ? 'text-amber-950' : 'text-[#000035]'
              }`}>
                {studentScheduledCount}
              </span>
              <span className={`text-[11px] font-semibold ${
                overdueLessons.length > 0 ? 'text-amber-800' : 'text-[#607EC9]'
              }`}>
                {isEn ? 'booked' : 'agendadas'}
              </span>
            </div>
          </div>
        </div>

        {overdueLessons.length > 0 && (
          <div className="p-3 bg-amber-50 border border-amber-300 rounded-xl text-xs text-amber-950 flex items-start gap-2.5">
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="font-extrabold text-amber-950">
                {isEn
                  ? `⚠️ Action Required: You have ${overdueLessons.length} scheduled lesson(s) whose date/time has already passed!`
                  : `⚠️ Atenção: Você possui ${overdueLessons.length} aula(s) com horário já transcorrido que aguardam confirmação!`}
              </p>
              <p className="text-[11px] text-amber-900 leading-relaxed">
                {isEn
                  ? 'Please click "Mark Completed" if the lesson took place, or "Not Completed" if an unforeseen event happened.'
                  : 'Por favor, clique em "Concluir Aula" caso a aula tenha ocorrido normalmente, ou "Não Realizada" para registrar imprevisto/ausência.'}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Teacher Meet Room Banner */}
      {isTeacher && (
        <div className="p-3 bg-[#9AB4FF]/10 border border-[#607EC9]/30 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2 text-[#062863]">
            <Video className="w-4 h-4 text-[#1C4C96] shrink-0" />
            <span className="font-semibold">
              {isEn ? 'Your Google Meet Room:' : 'Sua Sala do Google Meet:'}
            </span>
            <span className="font-mono font-bold text-[#000035] underline truncate max-w-xs sm:max-w-md">
              {teacherSettings.meetLink}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {teacherSettings.timezone && (
              <div className="flex items-center gap-1 text-[11px] text-[#062863] bg-white px-2 py-1 rounded-lg border border-[#9AB4FF]/60">
                <Globe className="w-3 h-3 text-[#1C4C96]" />
                <span>{teacherSettings.timezone}</span>
              </div>
            )}
            <a
              href={teacherSettings.meetLink}
              target="_blank"
              rel="noreferrer"
              className="px-3 py-1 bg-[#1C4C96] hover:bg-[#062863] text-white rounded-xl font-bold text-[11px] flex items-center gap-1 shrink-0 self-start sm:self-auto transition shadow-xs"
            >
              <span>{isEn ? 'Open Room' : 'Abrir Sala'}</span>
              <ExternalLink className="w-3 h-3 text-[#9AB4FF]" />
            </a>
          </div>
        </div>
      )}

      {/* Scheduled Active Lessons List */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h4 className="font-extrabold text-xs uppercase tracking-wider text-[#062863] flex items-center gap-2">
            <span>{isEn ? 'Active Scheduled Lessons' : 'Aulas Agendadas na Agenda'}</span>
            <span className="px-2 py-0.5 rounded-full text-[10px] bg-[#9AB4FF]/25 text-[#062863] font-bold border border-[#9AB4FF]">
              {activeLessons.length}
            </span>
          </h4>
        </div>

        {activeLessons.length === 0 ? (
          <div className="py-8 text-center bg-[#9AB4FF]/10 rounded-2xl border border-dashed border-[#607EC9]/40 space-y-2">
            <CalendarIcon className="w-8 h-8 text-[#607EC9]/60 mx-auto" />
            <p className="text-xs font-bold text-[#000035]">
              {isEn ? 'No live lessons scheduled right now' : 'Nenhuma aula ao vivo agendada no momento'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            {activeLessons.map((lesson) => {
              const endDate = new Date(lesson.endDateTime);
              const isOverdue = endDate.getTime() < nowMs;

              const isPendingReschedule =
                lesson.proposalStatus === 'pending_student_reschedule' ||
                lesson.proposalStatus === 'pending_teacher_reschedule';

              const isRecipientOfReschedule =
                (lesson.proposalStatus === 'pending_student_reschedule' && !isTeacher) ||
                (lesson.proposalStatus === 'pending_teacher_reschedule' && isTeacher);

              const isProposerOfReschedule =
                (lesson.proposalStatus === 'pending_student_reschedule' && isTeacher) ||
                (lesson.proposalStatus === 'pending_teacher_reschedule' && !isTeacher);

              const formattedDate = formatDateInTimeZone(lesson.startDateTime, activeTz, isEn ? 'en' : 'pt');
              const formattedTime = `${formatTimeInTimeZone(lesson.startDateTime, activeTz)} - ${formatTimeInTimeZone(lesson.endDateTime, activeTz)}`;

              let activeMeetUrl =
                teacherMeetSettings[lesson.teacherEmail]?.meetLink || lesson.meetLink;
              if (!activeMeetUrl || activeMeetUrl.includes('its-simple-')) {
                activeMeetUrl = 'https://meet.google.com/gmt-kxnw-zpq';
              }

              const directCalendarUrl =
                lesson.calendarHtmlLink ||
                generateGoogleCalendarWebLink({
                  title: lesson.title,
                  description: lesson.description,
                  startDateTime: lesson.startDateTime,
                  endDateTime: lesson.endDateTime,
                  studentEmail: lesson.studentEmail,
                  studentName: lesson.studentName,
                  teacherEmail: lesson.teacherEmail,
                  teacherName: lesson.teacherName,
                  meetLink: activeMeetUrl,
                });

              return (
                <div
                  key={lesson.id}
                  className={`p-4 rounded-2xl border transition space-y-3 flex flex-col justify-between ${
                    isPendingReschedule
                      ? 'bg-amber-50/95 border-2 border-amber-400 ring-4 ring-amber-300/70 shadow-lg'
                      : isOverdue
                      ? 'bg-amber-50/80 border-amber-300 ring-2 ring-amber-200 shadow-2xs'
                      : 'bg-white hover:bg-[#9AB4FF]/5 border-[#607EC9]/30 hover:border-[#1C4C96] shadow-2xs'
                  }`}
                >
                  <div>
                    <div className="flex items-start justify-between gap-2 mb-1.5">
                      <div className="flex items-center gap-2">
                        <span
                          className={`w-2.5 h-2.5 rounded-full ${
                            isPendingReschedule
                              ? 'bg-amber-500 animate-ping'
                              : isOverdue
                              ? 'bg-amber-500 animate-ping'
                              : 'bg-[#1C4C96] animate-pulse'
                          }`}
                        ></span>
                        <span className="text-xs font-bold text-[#000035] truncate">
                          {lesson.title}
                        </span>
                      </div>

                      <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-[#9AB4FF]/25 text-[#062863] border border-[#9AB4FF] shrink-0 uppercase tracking-wide">
                        Google Meet
                      </span>
                    </div>

                    <div className="space-y-1 text-xs text-[#062863]">
                      <div className="flex items-center gap-2">
                        <CalendarIcon
                          className={`w-3.5 h-3.5 shrink-0 ${
                            isOverdue ? 'text-amber-600' : 'text-[#1C4C96]'
                          }`}
                        />
                        <span
                          className={`font-bold capitalize ${
                            isOverdue ? 'text-amber-950' : 'text-[#000035]'
                          }`}
                        >
                          {formattedDate} • {formattedTime}
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        <User className="w-3.5 h-3.5 text-[#607EC9] shrink-0" />
                        <span>
                          {isTeacher
                            ? `${isEn ? 'Student:' : 'Seu nome:'} ${lesson.studentName} (${lesson.studentEmail})`
                            : `${isEn ? 'Native Friend:' : 'Amigo Nativo:'} ${lesson.teacherName} (${lesson.teacherEmail})`}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Single Compact & Fluid Actions Bar (All 6 in One Row) */}
                  <div className="pt-2 border-t border-slate-100 flex items-center gap-1.5 flex-wrap">
                    {/* 1. Meet */}
                    <a
                      href={activeMeetUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[11px] font-bold flex items-center gap-1 transition shadow-2xs cursor-pointer shrink-0"
                      title={t.joinMeetBtn}
                    >
                      <Video className="w-3 h-3 text-emerald-100 shrink-0" />
                      <span>Meet</span>
                      <ExternalLink className="w-2.5 h-2.5 text-emerald-200 shrink-0" />
                    </a>

                    {/* 2. Google Calendar */}
                    <a
                      href={directCalendarUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="px-2.5 py-1 bg-white hover:bg-[#9AB4FF]/15 border border-[#607EC9]/40 text-[#062863] rounded-lg text-[11px] font-bold flex items-center gap-1 transition shadow-2xs cursor-pointer shrink-0"
                      title={isEn ? 'Sync with Google Calendar' : 'Sincronizar com o Google Calendar'}
                    >
                      <Calendar className="w-3 h-3 text-[#1C4C96] shrink-0" />
                      <span>Calendar</span>
                      <ExternalLink className="w-2.5 h-2.5 text-[#607EC9] shrink-0" />
                    </a>

                    {/* 3. Remarcar */}
                    <button
                      type="button"
                      onClick={() => onRescheduleLesson(lesson)}
                      className="px-2.5 py-1 bg-white hover:bg-slate-100 border border-slate-300 text-[#062863] rounded-lg text-[11px] font-bold cursor-pointer transition flex items-center gap-1 shadow-2xs shrink-0"
                      title={isEn ? 'Reschedule date/time' : 'Remarcar data/horário'}
                    >
                      <RotateCcw className="w-3 h-3 text-[#1C4C96] shrink-0" />
                      <span>{isEn ? 'Reschedule' : 'Remarcar'}</span>
                    </button>

                    {/* 4. Cancelar */}
                    <button
                      type="button"
                      onClick={() => {
                        if (
                          window.confirm(
                            isEn
                              ? 'Are you sure you want to cancel this scheduled lesson?'
                              : 'Tem certeza que deseja cancelar esta aula agendada?'
                          )
                        ) {
                          onCancelLesson(lesson.id);
                        }
                      }}
                      className="px-2.5 py-1 bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 rounded-lg text-[11px] font-bold cursor-pointer transition flex items-center gap-1 shadow-2xs shrink-0"
                      title={t.cancelLessonBtn}
                    >
                      <Trash2 className="w-3 h-3 text-rose-500 shrink-0" />
                      <span>{isEn ? 'Cancel' : 'Cancelar'}</span>
                    </button>

                    {/* 5. Realizada */}
                    <button
                      type="button"
                      onClick={() => {
                        if (
                          window.confirm(
                            isEn
                              ? 'Confirm lesson completed? 1 lesson will be deducted from contracted lessons balance.'
                              : 'Confirmar aula como realizada? 1 aula será contabilizada nas aulas realizadas e deduzida do saldo.'
                          )
                        ) {
                          onCompleteLesson(lesson.id);
                        }
                      }}
                      className="px-2.5 py-1 bg-[#062863] hover:bg-[#000035] text-white rounded-lg text-[11px] font-bold flex items-center gap-1 transition cursor-pointer shadow-2xs border border-[#1C4C96] shrink-0"
                      title={isEn ? 'Confirm lesson was completed' : 'Confirmar se a aula foi realizada'}
                    >
                      <CheckCircle className="w-3 h-3 text-[#9AB4FF] shrink-0" />
                      <span>{isEn ? 'Completed' : 'Realizada'}</span>
                    </button>

                    {/* 6. Não Realizada */}
                    <button
                      type="button"
                      onClick={() => onMarkNotCompleted(lesson)}
                      className="px-2.5 py-1 bg-amber-50 hover:bg-amber-100 border border-amber-300 text-amber-900 rounded-lg text-[11px] font-bold flex items-center gap-1 transition cursor-pointer shadow-2xs shrink-0"
                      title={isEn ? 'Mark as not held / not completed' : 'Informar que a aula não foi realizada'}
                    >
                      <XCircle className="w-3 h-3 text-amber-700 shrink-0" />
                      <span>{isEn ? 'Not Done' : 'Não Realizada'}</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Completed & Not Completed History */}
      {(completedLessons.length > 0 || notCompletedLessons.length > 0) && (
        <div className="mt-5 pt-4 border-t border-slate-100">
          <button
            type="button"
            onClick={() => setShowCompletedHistory((prev) => !prev)}
            className="w-full flex items-center justify-between text-xs font-bold text-[#062863] hover:text-[#1C4C96] transition cursor-pointer p-1"
          >
            <div className="flex items-center gap-2 flex-wrap">
              <CheckCircle className="w-4 h-4 text-[#1C4C96]" />
              <span>
                {isEn ? 'Lessons History' : 'Histórico de Aulas'} ({completedLessons.length + notCompletedLessons.length})
              </span>
            </div>
            {showCompletedHistory ? (
              <ChevronUp className="w-4 h-4 text-slate-400" />
            ) : (
              <ChevronDown className="w-4 h-4 text-slate-400" />
            )}
          </button>

          {showCompletedHistory && (
            <div className="mt-3 space-y-2">
              {completedLessons.map((item) => (
                <div
                  key={item.id}
                  className="p-3 bg-white rounded-xl border border-[#607EC9]/30 flex items-center justify-between gap-2 text-xs"
                >
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-[#000035]">{item.title}</span>
                      <span className="text-[10px] font-bold px-2 py-0.2 rounded-full bg-[#9AB4FF]/25 text-[#062863] border border-[#9AB4FF]">
                        {isEn ? '✓ Completed & Deducted' : '✓ Concluída e Abatida'}
                      </span>
                    </div>
                    <p className="text-[11px] text-[#607EC9]">
                      {formatDateInTimeZone(item.startDateTime, activeTz, isEn ? 'en' : 'pt')} • {formatTimeInTimeZone(item.startDateTime, activeTz)} • {item.teacherName} ↔ {item.studentName}
                    </p>
                  </div>
                </div>
              ))}

              {notCompletedLessons.map((item) => {
                const isStudentFault = item.notCompletedResponsible === 'student';
                return (
                  <div
                    key={item.id}
                    className={`p-3 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs ${
                      isStudentFault ? 'bg-amber-50/80 border-amber-200' : 'bg-[#9AB4FF]/15 border-[#9AB4FF]'
                    }`}
                  >
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-[#000035]">{item.title}</span>
                        {isStudentFault ? (
                          <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-amber-200 text-amber-900 border border-amber-300 flex items-center gap-1">
                            <MinusCircle className="w-3 h-3" />
                            {isEn ? 'Not Completed (Student Fault)' : 'Não Realizada (Imprevisto Aluno)'}
                          </span>
                        ) : (
                          <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-[#9AB4FF]/30 text-[#062863] border border-[#607EC9] flex items-center gap-1">
                            <RotateCcw className="w-3 h-3" />
                            {isEn ? 'Not Completed (Teacher Fault)' : 'Não Realizada (Imprevisto Professor)'}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-[#607EC9]">
                        {formatDateInTimeZone(item.startDateTime, activeTz, isEn ? 'en' : 'pt')} • {formatTimeInTimeZone(item.startDateTime, activeTz)} • {item.teacherName} ↔ {item.studentName}
                      </p>
                      {item.notCompletedReason && (
                        <p className="text-[11px] text-[#062863] italic">
                          "{item.notCompletedReason}"
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
