import React, { useState, useEffect } from 'react';
import {
  X,
  User,
  GraduationCap,
  Save,
  Check,
  Sparkles,
  Target,
  Clock,
  Globe,
  Users,
} from 'lucide-react';
import { UserProfile, EnglishLevel, Language, GoogleAccount } from '../types';
import { ImageUploadInput } from './ImageUploadInput';

interface StudentProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  userProfile: UserProfile;
  currentAccount: GoogleAccount | null;
  onSave: (updatedProfile: UserProfile, updatedPicture?: string) => void;
  currentLanguage: Language;
}

export const StudentProfileModal: React.FC<StudentProfileModalProps> = ({
  isOpen,
  onClose,
  userProfile,
  currentAccount,
  onSave,
  currentLanguage,
}) => {
  const isEn = currentLanguage === 'en';

  // Strict check: Only trust userProfile if its email matches currentAccount email
  const isAccountMatch = Boolean(
    currentAccount?.email &&
      userProfile?.email &&
      userProfile.email.toLowerCase().trim() === currentAccount.email.toLowerCase().trim()
  );

  const activeProfile = isAccountMatch ? userProfile : null;

  // Never inherit photo or name from an unrelated profile in memory
  const initialName = activeProfile?.name || currentAccount?.name || '';
  const initialAvatar =
    (activeProfile?.avatar && activeProfile.avatar.trim() !== '' ? activeProfile.avatar : '') ||
    (activeProfile?.picture && activeProfile.picture.trim() !== '' ? activeProfile.picture : '') ||
    (currentAccount?.picture && currentAccount.picture.trim() !== '' ? currentAccount.picture : '') ||
    '';

  const [name, setName] = useState(initialName);
  const [avatar, setAvatar] = useState(initialAvatar);
  const [level, setLevel] = useState<EnglishLevel>(
    activeProfile?.level || EnglishLevel.BEGINNER
  );
  const [goal, setGoal] = useState(
    activeProfile?.learningGoal || ''
  );
  const [dailyGoalMinutes, setDailyGoalMinutes] = useState(
    activeProfile?.dailyGoalMinutes || 30
  );
  const [weeklyNativeLessonsTarget, setWeeklyNativeLessonsTarget] = useState<number>(
    activeProfile?.weeklyNativeLessonsTarget || 1
  );
  const [routineVideoTime, setRoutineVideoTime] = useState(
    activeProfile?.routineVideoTime || ''
  );
  const [routineAudioTime, setRoutineAudioTime] = useState(
    activeProfile?.routineAudioTime || ''
  );
  const [dailyPhraseTime, setDailyPhraseTime] = useState(
    activeProfile?.dailyPhraseTime || ''
  );
  const [savedSuccess, setSavedSuccess] = useState(false);

  // Synchronize state whenever modal is opened or active profile/account updates
  useEffect(() => {
    if (isOpen) {
      const match = Boolean(
        currentAccount?.email &&
          userProfile?.email &&
          userProfile.email.toLowerCase().trim() === currentAccount.email.toLowerCase().trim()
      );
      const safeProfile = match ? userProfile : null;

      setName(safeProfile?.name || currentAccount?.name || '');
      const safeAvatar =
        (safeProfile?.avatar && safeProfile.avatar.trim() !== '' ? safeProfile.avatar : '') ||
        (safeProfile?.picture && safeProfile.picture.trim() !== '' ? safeProfile.picture : '') ||
        (currentAccount?.picture && currentAccount.picture.trim() !== '' ? currentAccount.picture : '') ||
        '';
      setAvatar(safeAvatar);
      setLevel(safeProfile?.level || EnglishLevel.BEGINNER);
      setGoal(safeProfile?.learningGoal || '');
      setDailyGoalMinutes(safeProfile?.dailyGoalMinutes || 30);
      setWeeklyNativeLessonsTarget(safeProfile?.weeklyNativeLessonsTarget || 1);
      setRoutineVideoTime(safeProfile?.routineVideoTime || '');
      setRoutineAudioTime(safeProfile?.routineAudioTime || '');
      setDailyPhraseTime(safeProfile?.dailyPhraseTime || '');
      setSavedSuccess(false);
    }
  }, [isOpen, userProfile, currentAccount]);

  // Support ESC key to easily dismiss the profile modal
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

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanEmail = (currentAccount?.email || userProfile?.email || '').toLowerCase().trim();
    const cleanId =
      currentAccount?.id ||
      userProfile?.id ||
      (cleanEmail ? `usr-${cleanEmail.replace(/[^a-zA-Z0-9]/g, '-')}` : 'usr-default');
    const cleanAvatar = avatar.trim();
    const cleanName = name.trim();

    const updated: UserProfile = {
      ...(isAccountMatch ? userProfile : {}),
      id: cleanId,
      email: cleanEmail,
      name: cleanName,
      level,
      learningGoal: goal.trim(),
      dailyGoalMinutes: Number(dailyGoalMinutes) || 30,
      weeklyNativeLessonsTarget: Number(weeklyNativeLessonsTarget) || 1,
      routineVideoTime,
      routineAudioTime,
      dailyPhraseTime,
      avatar: cleanAvatar,
      picture: cleanAvatar,
    };
    onSave(updated, cleanAvatar);
    setSavedSuccess(true);
    setTimeout(() => {
      setSavedSuccess(false);
      onClose();
    }, 800);
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-[#000035]/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-6 overflow-y-auto"
      id="student-profile-modal"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white rounded-3xl max-w-xl w-full shadow-2xl border border-[#607EC9]/40 overflow-hidden flex flex-col max-h-[92vh] my-auto animate-in fade-in zoom-in duration-200">
        {/* Header */}
        <div className="p-6 bg-gradient-to-r from-[#000035] via-[#062863] to-[#1C4C96] text-white flex items-center justify-between border-b border-[#607EC9]/40 shrink-0">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-2xl bg-[#1C4C96] text-[#F4CA54] flex items-center justify-center font-black shadow-md border border-[#9AB4FF]/50">
              <User className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-lg sm:text-xl font-black text-white">
                  {isEn ? 'Your Profile & Photo' : 'Seu Perfil & Sua Foto'}
                </h2>
                {currentAccount?.email && (
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-white/15 text-white/90 border border-white/20">
                    {currentAccount.email}
                  </span>
                )}
              </div>
              <p className="text-xs text-[#9AB4FF]">
                {isEn
                  ? 'Personalize your photo, name, and English goals strictly for your user account.'
                  : 'Personalize sua foto, seu nome e seus objetivos vinculados exclusivamente ao seu ID de usuário.'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-[#9AB4FF] hover:text-white hover:bg-white/10 transition cursor-pointer"
            aria-label="Close"
            title="Fechar (Esc)"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-5">
          {savedSuccess && (
            <div className="p-3.5 bg-emerald-50 border border-emerald-300 rounded-2xl text-xs font-bold text-emerald-800 flex items-center gap-2">
              <Check className="w-4 h-4 text-emerald-600" />
              <span>
                {isEn
                  ? 'Profile and photo updated successfully!'
                  : 'Perfil e foto atualizados com sucesso!'}
              </span>
            </div>
          )}

          {/* Photo Upload Zone */}
          <ImageUploadInput
            label={isEn ? 'Your Profile Photo' : 'Sua Foto de Perfil'}
            value={avatar}
            onChange={(newImg) => setAvatar(newImg)}
            currentLanguage={currentLanguage}
            helperText={
              isEn
                ? 'Your photo is visible in your practice space and during live sessions with your Native Friend.'
                : 'Sua foto ficará visível no seu espaço de prática e durante as sessões com seu Amigo Nativo.'
            }
          />

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                {isEn ? 'How would you like to be called? *' : 'Como você quer ser chamado(a)? *'}
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full p-3 bg-white border border-slate-300 rounded-xl text-xs sm:text-sm text-[#000035] font-semibold focus:outline-hidden focus:ring-2 focus:ring-[#1C4C96]"
                placeholder={isEn ? 'e.g., Alex Silva' : 'Ex: Seu Nome Completo'}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  {isEn ? 'Your Current Level' : 'Seu Nível Atual'}
                </label>
                <select
                  value={level}
                  onChange={(e) => setLevel(e.target.value as EnglishLevel)}
                  className="w-full p-3 bg-white border border-slate-300 rounded-xl text-xs sm:text-sm text-[#000035] font-semibold focus:outline-hidden focus:ring-2 focus:ring-[#1C4C96]"
                >
                  <option value={EnglishLevel.BEGINNER}>
                    🌱 {isEn ? 'Beginner' : 'Iniciante (Começando do zero)'}
                  </option>
                  <option value={EnglishLevel.INTERMEDIATE}>
                    🌿 {isEn ? 'Intermediate' : 'Intermediário (Já entendo o dia a dia)'}
                  </option>
                  <option value={EnglishLevel.ADVANCED}>
                    🌳 {isEn ? 'Advanced' : 'Avançado (Buscando naturalidade)'}
                  </option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  {isEn ? 'Daily Practice Time (Minutes)' : 'Sua Meta de Prática Diária (Minutos)'}
                </label>
                <div className="relative">
                  <Clock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="number"
                    min="10"
                    max="180"
                    step="5"
                    value={dailyGoalMinutes}
                    onChange={(e) => setDailyGoalMinutes(Number(e.target.value))}
                    className="w-full pl-9 pr-3 py-3 bg-white border border-slate-300 rounded-xl text-xs sm:text-sm text-[#000035] font-semibold"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  {isEn ? 'Weekly Native Friend Lessons' : 'Aulas Semanais com Amigo Nativo'}
                </label>
                <div className="relative">
                  <Users className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <select
                    value={weeklyNativeLessonsTarget}
                    onChange={(e) => setWeeklyNativeLessonsTarget(Number(e.target.value))}
                    className="w-full pl-9 pr-3 py-3 bg-white border border-slate-300 rounded-xl text-xs sm:text-sm text-[#000035] font-semibold focus:outline-hidden focus:ring-2 focus:ring-[#1C4C96]"
                  >
                    <option value={1}>1x {isEn ? 'session / week (Standard)' : 'aula por semana (Padrão)'}</option>
                    <option value={2}>2x {isEn ? 'sessions / week' : 'aulas por semana'}</option>
                    <option value={3}>3x {isEn ? 'sessions / week' : 'aulas por semana'}</option>
                    <option value={4}>4x {isEn ? 'sessions / week' : 'aulas por semana'}</option>
                    <option value={5}>5x {isEn ? 'sessions / week' : 'aulas por semana'}</option>
                    <option value={7}>7x {isEn ? 'sessions / week (Daily)' : 'aulas por semana (Todos os dias)'}</option>
                  </select>
                </div>
                <span className="text-[10px] text-slate-500 mt-1 block">
                  {isEn
                    ? 'Target used to calculate your weekly S-Fluency evolution.'
                    : 'Meta usada no cálculo de evolução do gráfico em S da sua semana.'}
                </span>
              </div>
            </div>

            {/* Daily Routine Schedule */}
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-3">
              <label className="block text-xs font-black text-[#062863]">
                ⏰ {isEn ? 'Daily Routine Habit Times' : 'Horários das suas Rotinas Diárias'}
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <span className="block text-[11px] font-bold text-slate-600 mb-1">
                    🎬 {isEn ? 'Video Habit Time' : 'Horário do Vídeo'}
                  </span>
                  <input
                    type="time"
                    value={routineVideoTime}
                    onChange={(e) => setRoutineVideoTime(e.target.value)}
                    className="w-full p-2.5 bg-white border border-slate-300 rounded-xl text-xs font-semibold text-[#000035]"
                  />
                </div>
                <div>
                  <span className="block text-[11px] font-bold text-slate-600 mb-1">
                    🎧 {isEn ? 'Audio Habit Time' : 'Horário do Áudio'}
                  </span>
                  <input
                    type="time"
                    value={routineAudioTime}
                    onChange={(e) => setRoutineAudioTime(e.target.value)}
                    className="w-full p-2.5 bg-white border border-slate-300 rounded-xl text-xs font-semibold text-[#000035]"
                  />
                </div>
                <div>
                  <span className="block text-[11px] font-bold text-slate-600 mb-1">
                    ✍️ {isEn ? 'Daily Phrase Time' : 'Horário da Frase'}
                  </span>
                  <input
                    type="time"
                    value={dailyPhraseTime}
                    onChange={(e) => setDailyPhraseTime(e.target.value)}
                    className="w-full p-2.5 bg-white border border-slate-300 rounded-xl text-xs font-semibold text-[#000035]"
                  />
                </div>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                {isEn ? 'What is your main goal with English?' : 'Qual é o seu objetivo com o inglês?'}
              </label>
              <div className="relative">
                <Target className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                <textarea
                  rows={3}
                  value={goal}
                  onChange={(e) => setGoal(e.target.value)}
                  placeholder={
                    isEn
                      ? 'e.g., Speak fluently in daily routines, meetings, and vacation trips'
                      : 'Ex: Falar com naturalidade na minha rotina, reuniões e viagens'
                  }
                  className="w-full pl-9 pr-3 py-2.5 bg-white border border-slate-300 rounded-xl text-xs sm:text-sm text-[#000035]"
                />
              </div>
            </div>
          </div>

          {/* Footer Actions */}
          <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl border border-slate-300 text-slate-700 font-bold text-xs hover:bg-slate-100 transition cursor-pointer"
            >
              {isEn ? 'Cancel' : 'Cancelar'}
            </button>

            <button
              type="submit"
              className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-[#062863] to-[#1C4C96] hover:from-[#000035] hover:to-[#062863] text-white font-black text-xs sm:text-sm shadow-md transition flex items-center gap-2 cursor-pointer active:scale-98"
            >
              <Save className="w-4 h-4 text-[#F4CA54]" />
              <span>{isEn ? 'Save Profile' : 'Salvar Alterações'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
