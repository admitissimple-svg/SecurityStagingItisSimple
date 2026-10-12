import React, { useState, useEffect } from 'react';
import {
  X,
  Users,
  UserPlus,
  Trash2,
  Edit2,
  Check,
  Award,
  GraduationCap,
  Calendar,
  Layers,
  BookOpen,
} from 'lucide-react';
import { StudentProfile, EnglishLevel, Language } from '../types';
import { Translations } from '../utils/i18n';

interface StudentManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
  students: StudentProfile[];
  onAddStudent: (newStudent: Omit<StudentProfile, 'id'>) => void;
  onUpdateStudent: (student: StudentProfile) => void;
  onDeleteStudent: (id: string) => void;
  onSelectStudent: (student: StudentProfile) => void;
  selectedStudentId?: string;
  currentLanguage: Language;
  t: Translations;
}

export const StudentManagementModal: React.FC<StudentManagementModalProps> = ({
  isOpen,
  onClose,
  students,
  onAddStudent,
  onUpdateStudent,
  onDeleteStudent,
  onSelectStudent,
  selectedStudentId,
  currentLanguage,
  t,
}) => {
  // Support ESC key to easily dismiss the modal
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const isEn = currentLanguage === 'en';
  const [isAdding, setIsAdding] = useState<boolean>(false);
  const [name, setName] = useState<string>('');
  const [email, setEmail] = useState<string>('');
  const [level, setLevel] = useState<EnglishLevel>(EnglishLevel.BEGINNER);
  const [goal, setGoal] = useState<string>('');
  const [contractedCount, setContractedCount] = useState<number | ''>('');

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !email.trim()) return;

    onAddStudent({
      name: name.trim(),
      email: email.trim().toLowerCase(),
      level,
      goal: goal.trim(),
      contractedLessons: Number(contractedCount) || 10,
      completedLessonsCount: 0,
      activeSince: new Date().toISOString().split('T')[0],
      createdAt: new Date().toISOString(),
    });

    setName('');
    setEmail('');
    setGoal('');
    setContractedCount('');
    setIsAdding(false);
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-[#000035]/70 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6 overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white rounded-3xl max-w-2xl w-full shadow-2xl border border-[#607EC9]/30 overflow-hidden my-auto">
        {/* Header */}
        <div className="px-6 py-4 bg-[#000035] text-white flex items-center justify-between border-b border-[#1C4C96]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-[#1C4C96] flex items-center justify-center text-white shadow-xs border border-[#9AB4FF]/40">
              <Users className="w-5 h-5 text-[#9AB4FF]" />
            </div>
            <div>
              <h3 className="font-black text-base sm:text-lg text-white">
                {isEn ? 'Student Management' : 'Gestão de Alunos'}
              </h3>
              <p className="text-xs text-[#9AB4FF]">
                {students.length} {isEn ? 'registered students' : 'alunos cadastrados'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl text-[#9AB4FF] hover:text-white hover:bg-[#1C4C96] transition cursor-pointer"
            aria-label="Close"
            title="Fechar (Esc)"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5">
          {/* Add Student Toggle */}
          {!isAdding ? (
            <button
              type="button"
              onClick={() => setIsAdding(true)}
              className="w-full py-3 bg-[#9AB4FF]/10 hover:bg-[#9AB4FF]/20 border border-dashed border-[#607EC9] rounded-2xl text-xs font-black text-[#062863] transition flex items-center justify-center gap-2 cursor-pointer"
            >
              <UserPlus className="w-4 h-4 text-[#1C4C96]" />
              <span>{isEn ? '+ Add New Student' : '+ Cadastrar Novo Aluno'}</span>
            </button>
          ) : (
            <form onSubmit={handleAdd} className="p-4 bg-[#9AB4FF]/10 rounded-2xl border border-[#607EC9]/40 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-[#000035]">
                  {isEn ? 'New Student Information' : 'Dados do Novo Aluno'}
                </span>
                <button
                  type="button"
                  onClick={() => setIsAdding(false)}
                  className="text-xs text-slate-500 hover:text-slate-700"
                >
                  {isEn ? 'Cancel' : 'Cancelar'}
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-[#000035] mb-1">
                    {isEn ? 'Full Name *' : 'Nome Completo *'}
                  </label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Maria Silva"
                    className="w-full p-2 bg-white border border-[#607EC9]/40 rounded-xl text-xs text-[#000035]"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-[#000035] mb-1">
                    {isEn ? 'Email Address *' : 'E-mail *'}
                  </label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="mariasilva@gmail.com"
                    className="w-full p-2 bg-white border border-[#607EC9]/40 rounded-xl text-xs text-[#000035]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-[#000035] mb-1">
                    {isEn ? 'English Level' : 'Nível de Inglês'}
                  </label>
                  <select
                    value={level}
                    onChange={(e) => setLevel(e.target.value as EnglishLevel)}
                    className="w-full p-2 bg-white border border-[#607EC9]/40 rounded-xl text-xs text-[#000035]"
                  >
                    <option value={EnglishLevel.BEGINNER}>Beginner (A1-A2)</option>
                    <option value={EnglishLevel.INTERMEDIATE}>Intermediate (B1-B2)</option>
                    <option value={EnglishLevel.ADVANCED}>Advanced (C1-C2)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-[#000035] mb-1">
                    {isEn ? 'Contracted Lessons' : 'Aulas Contratadas'}
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="200"
                    value={contractedCount}
                    onChange={(e) => setContractedCount(e.target.value === '' ? '' : Number(e.target.value))}
                    placeholder="10"
                    className="w-full p-2 bg-white border border-[#607EC9]/40 rounded-xl text-xs text-[#000035]"
                  />
                </div>
              </div>

              <div className="flex justify-end pt-2">
                <button
                  type="submit"
                  className="px-4 py-2 bg-[#1C4C96] hover:bg-[#062863] text-white rounded-xl text-xs font-bold transition shadow-xs cursor-pointer"
                >
                  {isEn ? 'Save Student' : 'Salvar Aluno'}
                </button>
              </div>
            </form>
          )}

          {/* Students List */}
          <div className="space-y-3">
            {students.map((st) => {
              const isSelected = selectedStudentId === st.id || selectedStudentId === st.email;
              return (
                <div
                  key={st.id}
                  className={`p-4 rounded-2xl border transition flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                    isSelected
                      ? 'bg-[#9AB4FF]/20 border-[#1C4C96] shadow-xs'
                      : 'bg-white border-[#607EC9]/30 hover:border-[#9AB4FF]'
                  }`}
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-extrabold text-sm text-[#000035]">{st.name}</span>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#9AB4FF]/30 text-[#062863] border border-[#9AB4FF]">
                        {st.level}
                      </span>
                    </div>
                    <p className="text-xs text-[#607EC9]">{st.email}</p>
                    <div className="flex items-center gap-2 text-[11px] text-[#062863] font-medium">
                      <span>
                        {isEn ? 'Contracted:' : 'Contratadas:'} <strong>{st.contractedLessons || 10}</strong>
                      </span>
                      <span>•</span>
                      <span>
                        {isEn ? 'Completed:' : 'Concluídas:'} <strong>{st.completedLessonsCount || 0}</strong>
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => onSelectStudent(st)}
                      className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                        isSelected
                          ? 'bg-[#1C4C96] text-white'
                          : 'bg-[#9AB4FF]/15 hover:bg-[#9AB4FF]/25 text-[#062863] border border-[#9AB4FF]'
                      }`}
                    >
                      {isSelected ? (isEn ? 'Active Student' : 'Aluno Selecionado') : (isEn ? 'Select / View' : 'Selecionar / Ver')}
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm(isEn ? 'Delete this student?' : 'Excluir este aluno?')) {
                          onDeleteStudent(st.id);
                        }
                      }}
                      className="p-1.5 text-slate-400 hover:text-red-600 rounded-lg"
                      title={isEn ? 'Delete student' : 'Excluir aluno'}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
