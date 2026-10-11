import React, { useState } from 'react';
import {
  X,
  AlertOctagon,
  Calendar,
  Clock,
  User,
  CheckCircle2,
  Trash2,
  GraduationCap,
} from 'lucide-react';
import { LiveLesson, Language } from '../types';
import { formatDateInTimeZone, formatTimeInTimeZone } from '../utils/timezone';

interface CancelLessonModalProps {
  isOpen: boolean;
  onClose: () => void;
  lesson: LiveLesson | null;
  onConfirmCancel: (
    lessonId: string,
    reason?: string,
    cancelledBy?: 'student' | 'teacher'
  ) => void;
  currentLanguage: Language;
  timeZone?: string;
}

export const CancelLessonModal: React.FC<CancelLessonModalProps> = ({
  isOpen,
  onClose,
  lesson,
  onConfirmCancel,
  currentLanguage,
  timeZone,
}) => {
  const [cancelledBy, setCancelledBy] = useState<'student' | 'teacher'>('student');
  const [reason, setReason] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  if (!isOpen || !lesson) return null;

  const isEn = currentLanguage === 'en';

  const handleConfirm = async () => {
    setIsSubmitting(true);
    try {
      await onConfirmCancel(lesson.id, reason.trim() || undefined, cancelledBy);
      setReason('');
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#000035]/70 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6 overflow-y-auto animate-in fade-in duration-150">
      <div className="bg-white rounded-3xl max-w-md w-full shadow-2xl border border-[#607EC9]/30 overflow-hidden my-auto animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="px-6 py-4 bg-gradient-to-r from-[#000035] via-[#062863] to-[#1C4C96] text-white flex items-center justify-between border-b border-[#607EC9]/30">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-white/10 border border-white/20 flex items-center justify-center">
              <AlertOctagon className="w-5 h-5 text-[#F4CA54]" />
            </div>
            <div>
              <h3 className="font-black text-base leading-tight text-white">
                {isEn ? 'Cancel Live Session' : 'Cancelar Aula Ao Vivo'}
              </h3>
              <p className="text-xs text-[#9AB4FF]">
                {isEn ? 'Google Meet Practice Session' : 'Sessão de Prática Google Meet'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-xl text-white/70 hover:text-white hover:bg-white/10 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          {/* Lesson Details Box */}
          <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200 space-y-2">
            <div className="font-bold text-sm text-[#000035]">{lesson.title}</div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-[#062863]">
              <div className="flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-[#1C4C96]" />
                <span className="font-semibold">
                  {formatDateInTimeZone(lesson.startDateTime, timeZone, isEn ? 'en' : 'pt')}
                </span>
              </div>

              <div className="flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-[#1C4C96]" />
                <span className="font-semibold">
                  {formatTimeInTimeZone(lesson.startDateTime, timeZone)}
                </span>
              </div>
            </div>

            {(lesson.teacherName || lesson.studentName) && (
              <div className="flex items-center gap-1.5 text-xs text-slate-600 pt-1 border-t border-slate-200">
                <User className="w-3.5 h-3.5 text-slate-400" />
                <span>
                  {lesson.teacherName || 'Amigo Nativo'} • {lesson.studentName || 'Aluno'}
                </span>
              </div>
            )}
          </div>

          {/* Cancellation Responsibility Selector */}
          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-[#000035]">
              {isEn ? 'Cancellation Responsibility / Motive:' : 'Responsabilidade pelo Cancelamento:'}
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setCancelledBy('student')}
                className={`p-3 rounded-2xl border text-left transition cursor-pointer flex flex-col gap-1 ${
                  cancelledBy === 'student'
                    ? 'bg-[#062863]/10 border-[#1C4C96] shadow-2xs'
                    : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <User className={`w-3.5 h-3.5 ${cancelledBy === 'student' ? 'text-[#1C4C96]' : 'text-slate-500'}`} />
                  <span className={`text-xs font-bold ${cancelledBy === 'student' ? 'text-[#000035]' : 'text-slate-700'}`}>
                    {isEn ? 'Personal Reason' : 'Motivo Próprio'}
                  </span>
                </div>
                <span className={`text-[10px] ${cancelledBy === 'student' ? 'text-[#062863] font-semibold' : 'text-slate-500'}`}>
                  {isEn ? 'Deducted from balance' : 'Abate do saldo de aulas'}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setCancelledBy('teacher')}
                className={`p-3 rounded-2xl border text-left transition cursor-pointer flex flex-col gap-1 ${
                  cancelledBy === 'teacher'
                    ? 'bg-emerald-50/90 border-emerald-500 shadow-2xs'
                    : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <GraduationCap className={`w-3.5 h-3.5 ${cancelledBy === 'teacher' ? 'text-emerald-600' : 'text-slate-500'}`} />
                  <span className={`text-xs font-bold ${cancelledBy === 'teacher' ? 'text-emerald-950' : 'text-[#000035]'}`}>
                    {isEn ? 'Tutor Unforeseen' : 'Imprevisto Amigo Nativo'}
                  </span>
                </div>
                <span className={`text-[10px] ${cancelledBy === 'teacher' ? 'text-emerald-800 font-semibold' : 'text-slate-500'}`}>
                  {isEn ? 'Keeps balance intact' : 'Não desconta saldo'}
                </span>
              </button>
            </div>
          </div>

          {/* Cancellation Dynamic Notice */}
          {cancelledBy === 'student' ? (
            <div className="p-3 bg-amber-50 rounded-2xl border border-amber-200 flex items-start gap-2.5">
              <AlertOctagon className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-900 leading-relaxed font-medium">
                {isEn
                  ? 'Cancelling a lesson for personal reasons will be counted as a completed lesson and deducted from your balance.'
                  : 'O cancelamento da aula por motivo próprio será contabilizado nas aulas realizadas e deduzido do saldo restante.'}
              </p>
            </div>
          ) : (
            <div className="p-3 bg-emerald-50 rounded-2xl border border-emerald-200 flex items-start gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <p className="text-xs text-emerald-900 leading-relaxed font-medium">
                {isEn
                  ? 'Cancelling due to native tutor unforeseen circumstances will NOT be deducted from your lesson balance.'
                  : 'O cancelamento por imprevisto do amigo nativo NÃO será deduzido do saldo de aulas do aluno.'}
              </p>
            </div>
          )}

          {/* Optional cancellation reason */}
          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-[#000035]">
              {isEn ? 'Reason for cancellation (optional):' : 'Motivo do cancelamento (opcional):'}
            </label>
            <textarea
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={
                isEn
                  ? 'e.g. Last-minute schedule conflict, unexpected trip...'
                  : 'Ex.: Imprevisto no trabalho, conflito de agenda...'
              }
              className="w-full p-3 bg-white border border-[#607EC9]/30 rounded-xl text-xs text-[#000035] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#1C4C96] transition"
            />
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-2.5 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2.5 rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-100 font-bold text-xs transition cursor-pointer"
            >
              {isEn ? 'Keep Lesson' : 'Não, Manter Aula'}
            </button>

            <button
              type="button"
              onClick={handleConfirm}
              disabled={isSubmitting}
              className="px-4 py-2.5 rounded-xl bg-[#062863] hover:bg-[#000035] text-white font-bold text-xs transition cursor-pointer flex items-center gap-1.5 shadow-sm border border-[#9AB4FF]/30 active:scale-98 disabled:opacity-50"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>
                {isSubmitting
                  ? isEn
                    ? 'Cancelling...'
                    : 'Cancelando...'
                  : isEn
                  ? 'Yes, Cancel Lesson'
                  : 'Sim, Cancelar Aula'}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
