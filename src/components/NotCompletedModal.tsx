import React, { useState } from 'react';
import {
  X,
  AlertTriangle,
  Send,
  User,
  GraduationCap,
} from 'lucide-react';
import { LiveLesson, Language } from '../types';

interface NotCompletedModalProps {
  isOpen: boolean;
  onClose: () => void;
  lesson: LiveLesson | null;
  onConfirm: (
    lessonId: string,
    responsible: 'student' | 'teacher',
    reason: string
  ) => void;
  currentLanguage: Language;
}

export const NotCompletedModal: React.FC<NotCompletedModalProps> = ({
  isOpen,
  onClose,
  lesson,
  onConfirm,
  currentLanguage,
}) => {
  const isEn = currentLanguage === 'en';
  const [responsible, setResponsible] = useState<'student' | 'teacher'>('student');
  const [reason, setReason] = useState<string>('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!lesson) return;
    onConfirm(lesson.id, responsible, reason.trim());
    onClose();
  };

  if (!isOpen || !lesson) return null;

  return (
    <div className="fixed inset-0 z-50 bg-[#000035]/70 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6 overflow-y-auto">
      <div className="bg-white rounded-3xl max-w-md w-full shadow-2xl border border-[#607EC9]/30 overflow-hidden my-auto">
        {/* Header */}
        <div className="px-6 py-4 bg-amber-600 text-white flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="w-5 h-5" />
            <div>
              <h3 className="font-black text-base">
                {isEn ? 'Mark Lesson as Not Completed' : 'Registrar Aula Não Realizada'}
              </h3>
              <p className="text-[11px] text-amber-100">{lesson.title}</p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-amber-100 hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="space-y-2">
            <label className="block text-xs font-bold text-[#000035]">
              {isEn ? 'Responsibility / Circumstance:' : 'Responsabilidade pelo Não Comparecimento:'}
            </label>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setResponsible('student')}
                className={`p-3 rounded-xl border text-xs font-bold transition flex flex-col items-center gap-1 cursor-pointer ${
                  responsible === 'student'
                    ? 'bg-amber-100 border-amber-500 text-amber-950 shadow-xs'
                    : 'bg-slate-50 border-slate-200 text-slate-700'
                }`}
              >
                <User className="w-4 h-4 text-amber-700" />
                <span>{isEn ? 'Student Unforeseen' : 'Imprevisto do Aluno'}</span>
                <span className="text-[10px] font-normal text-amber-800">
                  {isEn ? '(Deducted from balance)' : '(Abate do contrato)'}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setResponsible('teacher')}
                className={`p-3 rounded-xl border text-xs font-bold transition flex flex-col items-center gap-1 cursor-pointer ${
                  responsible === 'teacher'
                    ? 'bg-blue-100 border-blue-500 text-blue-950 shadow-xs'
                    : 'bg-slate-50 border-slate-200 text-slate-700'
                }`}
              >
                <GraduationCap className="w-4 h-4 text-blue-700" />
                <span>{isEn ? 'Teacher Unforeseen' : 'Imprevisto do Professor'}</span>
                <span className="text-[10px] font-normal text-blue-800">
                  {isEn ? '(Keeps balance)' : '(Mantém saldo)'}
                </span>
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-[#000035] mb-1">
              {isEn ? 'Reason / Justification' : 'Motivo / Justificativa'}
            </label>
            <textarea
              rows={3}
              required
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={
                isEn
                  ? 'e.g. Student fell ill / Teacher internet connection drop...'
                  : 'Ex.: Aluno não compareceu por motivo de saúde...'
              }
              className="w-full p-2.5 bg-white border border-[#607EC9]/40 rounded-xl text-xs text-[#000035] resize-none"
            />
          </div>

          <div className="pt-2 flex justify-end gap-2 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-slate-100 text-slate-700 rounded-xl text-xs font-bold"
            >
              {isEn ? 'Cancel' : 'Cancelar'}
            </button>
            <button
              type="submit"
              className="px-5 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow-xs"
            >
              <Send className="w-3.5 h-3.5" />
              <span>{isEn ? 'Confirm Record' : 'Registrar'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
