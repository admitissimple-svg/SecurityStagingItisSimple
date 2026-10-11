import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  Calendar,
  Clock,
  Heart,
  Send,
  AlertCircle,
  AlertTriangle,
} from 'lucide-react';
import { LiveLesson, GoogleAccount, Language, TeacherMeetSettings, DayOfWeek } from '../types';
import {
  generate30MinTimeSlots,
  formatDateInTimeZone,
  formatTimeInTimeZone,
  formatTimeSlot12h,
  findTeacherLessonConflict,
  buildIsoInTimeZone,
} from '../utils/timezone';

interface RescheduleModalProps {
  isOpen: boolean;
  onClose: () => void;
  lesson: LiveLesson | null;
  currentAccount: GoogleAccount | null;
  lessons?: LiveLesson[];
  teacherMeetSettings?: Record<string, TeacherMeetSettings>;
  onConfirmReschedule: (
    lessonId: string,
    newStartIso: string,
    newEndIso: string,
    reason: string
  ) => void;
  currentLanguage: Language;
  timeZone?: string;
}

export const RescheduleModal: React.FC<RescheduleModalProps> = ({
  isOpen,
  onClose,
  lesson,
  currentAccount,
  lessons = [],
  teacherMeetSettings = {},
  onConfirmReschedule,
  currentLanguage,
  timeZone = 'America/Sao_Paulo',
}) => {
  const isTeacher = currentAccount ? (currentAccount.role === 'teacher' || currentAccount.role === 'admin') : false;
  const isEn = currentLanguage === 'en' || isTeacher;

  const defaultDate = lesson?.startDateTime ? lesson.startDateTime.split('T')[0] : '';
  const [newDate, setNewDate] = useState<string>(defaultDate);
  const [newStartTime, setNewStartTime] = useState<string>('10:00');
  const [reason, setReason] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  useEffect(() => {
    if (!isOpen) {
      setIsSubmitting(false);
    }
  }, [isOpen]);

  useEffect(() => {
    if (lesson?.startDateTime) {
      setNewDate(lesson.startDateTime.split('T')[0]);
    }
  }, [lesson]);

  const teacherEmail = (lesson?.teacherEmail || lesson?.tutorEmail || '').toLowerCase().trim();
  const activeSettings = teacherMeetSettings[teacherEmail];

  const lessonDurationMinutes = useMemo(() => {
    if (!lesson?.startDateTime || !lesson?.endDateTime) return 25;
    const diff = Math.round((new Date(lesson.endDateTime).getTime() - new Date(lesson.startDateTime).getTime()) / (60 * 1000));
    return diff >= 45 ? 50 : 25;
  }, [lesson]);

  const newDayKey = useMemo(() => {
    if (!newDate) return 'monday';
    try {
      const [y, m, d] = newDate.split('-').map(Number);
      const dayIdx = new Date(y, m - 1, d).getDay();
      const map: Record<number, DayOfWeek> = {
        0: 'sunday',
        1: 'monday',
        2: 'tuesday',
        3: 'wednesday',
        4: 'thursday',
        5: 'friday',
        6: 'saturday',
      };
      return map[dayIdx] || 'monday';
    } catch {
      return 'monday';
    }
  }, [newDate]);

  const timeSlots = useMemo(() => {
    const daySchedule =
      activeSettings?.availability?.[newDayKey] ||
      activeSettings?.availableHoursByDay?.[newDayKey];

    if (daySchedule && Array.isArray(daySchedule) && daySchedule.length > 0) {
      return [...daySchedule].sort();
    }
    if (activeSettings?.availableHours && activeSettings.availableHours.length > 0) {
      return [...activeSettings.availableHours].sort();
    }
    return generate30MinTimeSlots('07:00', '22:00');
  }, [activeSettings, newDayKey]);

  // Check proposed start and end using exact timezone
  const proposedIso = useMemo(() => {
    if (!newDate || !newStartTime) return null;
    const startIso = buildIsoInTimeZone(newDate, newStartTime, timeZone, 0);
    const endIso = buildIsoInTimeZone(newDate, newStartTime, timeZone, lessonDurationMinutes);
    if (!startIso || !endIso) return null;
    return {
      startIso,
      endIso,
    };
  }, [newDate, newStartTime, lessonDurationMinutes, timeZone]);

  // Conflict validation (Rule 2 - Individualized by teacher and student)
  const currentConflict = useMemo(() => {
    if (!lesson || !proposedIso || (!teacherEmail && !lesson.teacherUid)) return null;
    return findTeacherLessonConflict(
      teacherEmail,
      proposedIso.startIso,
      proposedIso.endIso,
      lessons,
      lesson.id,
      lesson.teacherUid || lesson.tutorUid,
      lesson.studentEmail,
      lesson.studentUid
    );
  }, [lesson, proposedIso, teacherEmail, lessons]);

  const checkSlotIsBooked = (slot: string) => {
    if (!newDate || (!teacherEmail && !lesson?.teacherUid) || !lesson) return false;
    const startIso = buildIsoInTimeZone(newDate, slot, timeZone, 0);
    const endIso = buildIsoInTimeZone(newDate, slot, timeZone, lessonDurationMinutes);
    if (!startIso || !endIso) return false;
    const conflict = findTeacherLessonConflict(
      teacherEmail,
      startIso,
      endIso,
      lessons,
      lesson.id,
      lesson.teacherUid || lesson.tutorUid,
      lesson.studentEmail,
      lesson.studentUid
    );
    return Boolean(conflict);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!lesson || !newDate || !newStartTime || !proposedIso) return;

    if (currentConflict) {
      alert(
        isEn
          ? `Conflict Blocked: The Native Friend or Student already has another lesson scheduled at this time. Please pick an open slot.`
          : `Bloqueio de Conflito: Já existe outra aula agendada neste horário para este Amigo Nativo ou Aluno. Por favor, escolha outro slot livre.`
      );
      return;
    }

    setIsSubmitting(true);
    onConfirmReschedule(lesson.id, proposedIso.startIso, proposedIso.endIso, reason.trim());
    onClose();
  };

  if (!isOpen || !lesson) return null;

  return (
    <div className="fixed inset-0 z-50 bg-[#000035]/70 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6 overflow-y-auto">
      <div className="bg-white rounded-3xl max-w-md w-full shadow-2xl border border-[#607EC9]/30 overflow-hidden my-auto">
        {/* Header */}
        <div className="px-6 py-4 bg-[#000035] text-white flex items-center justify-between border-b border-[#1C4C96]">
          <div className="flex items-center gap-2.5">
            <Heart className="w-5 h-5 text-rose-400 fill-rose-400" />
            <div>
              <h3 className="font-black text-base text-white">
                {isEn ? 'Reschedule Lesson' : 'Reagendar Aula'}
              </h3>
              <p className="text-[11px] text-[#9AB4FF]">
                {lesson.title}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-[#9AB4FF] hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="p-3 bg-[#9AB4FF]/10 rounded-xl border border-[#607EC9]/30 text-xs text-[#062863] space-y-1">
            <div className="flex items-center justify-between">
              <span className="font-bold text-[#000035] block">
                {isEn ? 'Current Lesson Time:' : 'Horário Atual da Aula:'}
              </span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-[#1C4C96]/15 text-[#062863]">
                {lessonDurationMinutes} min
              </span>
            </div>
            <p>
              {formatDateInTimeZone(lesson.startDateTime, timeZone, isEn ? 'en' : 'pt')} • {formatTimeInTimeZone(lesson.startDateTime, timeZone)} - {formatTimeInTimeZone(lesson.endDateTime, timeZone)}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-[#000035] mb-1">
                {isEn ? 'New Date' : 'Nova Data'}
              </label>
              <input
                type="date"
                required
                value={newDate}
                onChange={(e) => setNewDate(e.target.value)}
                className="w-full p-2.5 bg-white border border-[#607EC9]/40 rounded-xl text-xs text-[#000035]"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-[#000035] mb-1">
                {isEn ? `New Time Slot (${lessonDurationMinutes} min)` : `Novo Horário (${lessonDurationMinutes} min)`}
              </label>
              <select
                value={newStartTime}
                onChange={(e) => setNewStartTime(e.target.value)}
                className="w-full p-2.5 bg-white border border-[#607EC9]/40 rounded-xl text-xs text-[#000035]"
              >
                {timeSlots.map((slot) => {
                  const isOccupied = checkSlotIsBooked(slot);
                  return (
                    <option key={slot} value={slot}>
                      {formatTimeSlot12h(slot)} {isOccupied ? (isEn ? '• ❌ [BOOKED]' : '• ❌ [OCUPADO]') : ''}
                    </option>
                  );
                })}
              </select>
            </div>
          </div>

          {/* Conflict Alert Banner */}
          {!isSubmitting && currentConflict && (
            <div className="p-3.5 bg-rose-50 border-2 border-rose-400 rounded-xl text-xs text-rose-950 space-y-1 animate-in fade-in">
              <div className="flex items-center gap-1.5 font-black text-rose-800">
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                <span>{isEn ? 'Slot Already Booked' : 'Horário Já Ocupado'}</span>
              </div>
              <p className="text-[11px] text-rose-900 font-medium">
                {isEn
                  ? `The Native Friend already has another lesson scheduled on this exact time slot. The system does not allow overlapping bookings.`
                  : `O Amigo Nativo já possui outra aula agendada neste mesmo horário. O sistema bloqueia duplicidades.`}
              </p>
            </div>
          )}

          <div>
            <label className="block text-xs font-bold text-[#000035] mb-1">
              {isEn ? 'Reason for Rescheduling (Optional)' : 'Motivo do Reagendamento (Opcional)'}
            </label>
            <textarea
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={isEn ? 'e.g. Schedule conflict with meeting...' : 'Ex.: Imprevisto no trabalho...'}
              className="w-full p-2.5 bg-white border border-[#607EC9]/40 rounded-xl text-xs text-[#000035] resize-none"
            />
          </div>

          <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 text-xs text-amber-900 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <p className="text-[11px] leading-relaxed">
              {isEn
                ? 'Your reschedule proposal will be sent to the other participant. The lesson time will only move once they confirm.'
                : 'A solicitação de reagendamento será enviada ao outro participante. A aula só mudará de horário após a confirmação dele(a).'}
            </p>
          </div>

          <div className="pt-2 flex justify-end gap-2 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-slate-100 text-slate-700 rounded-xl text-xs font-bold hover:bg-slate-200 transition cursor-pointer"
            >
              {isEn ? 'Cancel' : 'Voltar'}
            </button>
            <button
              type="submit"
              disabled={isSubmitting || Boolean(currentConflict)}
              className={`px-5 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow-xs ${
                currentConflict
                  ? 'bg-slate-300 text-slate-500 border border-slate-300 cursor-not-allowed'
                  : 'bg-[#1C4C96] hover:bg-[#062863] text-white cursor-pointer'
              }`}
            >
              <Send className="w-3.5 h-3.5" />
              <span>
                {isSubmitting
                  ? (isEn ? 'Sending...' : 'Enviando...')
                  : currentConflict
                  ? (isEn ? 'Slot Unavailable' : 'Horário Indisponível')
                  : isEn ? 'Send Reschedule Request' : 'Solicitar Reagendamento'}
              </span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
