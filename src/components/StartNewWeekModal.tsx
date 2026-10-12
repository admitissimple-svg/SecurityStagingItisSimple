import React, { useState, useEffect } from 'react';
import {
  RotateCcw,
  Sparkles,
  X,
  Calendar,
  Check,
  CheckCircle2,
  Info,
  RefreshCw,
  Award,
} from 'lucide-react';
import { DayOfWeek, Language } from '../types';

interface StartNewWeekModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (studyDaysTarget: number, selectedDays?: DayOfWeek[]) => Promise<void> | void;
  currentCycle: number;
  currentLanguage: Language;
  initialStudyDaysTarget?: number;
  initialSelectedDays?: DayOfWeek[];
  weeklyNativeLessonsTarget?: number;
  isStarting?: boolean;
}

const ALL_DAYS: { key: DayOfWeek; labelEn: string; labelPt: string; shortEn: string; shortPt: string }[] = [
  { key: 'monday', labelEn: 'Monday', labelPt: 'Segunda', shortEn: 'Mon', shortPt: 'Seg' },
  { key: 'tuesday', labelEn: 'Tuesday', labelPt: 'Terça', shortEn: 'Tue', shortPt: 'Ter' },
  { key: 'wednesday', labelEn: 'Wednesday', labelPt: 'Quarta', shortEn: 'Wed', shortPt: 'Qua' },
  { key: 'thursday', labelEn: 'Thursday', labelPt: 'Quinta', shortEn: 'Thu', shortPt: 'Qui' },
  { key: 'friday', labelEn: 'Friday', labelPt: 'Sexta', shortEn: 'Fri', shortPt: 'Sex' },
  { key: 'saturday', labelEn: 'Saturday', labelPt: 'Sábado', shortEn: 'Sat', shortPt: 'Sáb' },
  { key: 'sunday', labelEn: 'Sunday', labelPt: 'Domingo', shortEn: 'Sun', shortPt: 'Dom' },
];

const PRESETS: { days: number; presetDays: DayOfWeek[]; labelEn: string; labelPt: string; descEn: string; descPt: string; isDefault?: boolean }[] = [
  {
    days: 2,
    presetDays: ['tuesday', 'thursday'],
    labelEn: '2 days/week',
    labelPt: '2 dias/semana',
    descEn: 'Light & flexible (e.g. Tue/Thu)',
    descPt: 'Leve & flexível (ex: Ter/Qui)',
  },
  {
    days: 3,
    presetDays: ['monday', 'wednesday', 'friday'],
    labelEn: '3 days/week',
    labelPt: '3 dias/semana',
    descEn: 'Steady pace (e.g. Mon/Wed/Fri)',
    descPt: 'Ritmo constante (ex: Seg/Qua/Sex)',
  },
  {
    days: 5,
    presetDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
    labelEn: '5 days/week',
    labelPt: '5 dias/semana',
    descEn: 'Workdays immersion (Mon-Fri)',
    descPt: 'Imersão em dias úteis (Seg-Sex)',
  },
  {
    days: 7,
    presetDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
    labelEn: '7 days/week',
    labelPt: '7 dias/semana',
    descEn: 'Full living English habit',
    descPt: 'Hábito completo de viver em inglês',
    isDefault: true,
  },
];

export const StartNewWeekModal: React.FC<StartNewWeekModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  currentCycle,
  currentLanguage,
  initialStudyDaysTarget = 7,
  initialSelectedDays,
  weeklyNativeLessonsTarget = 1,
  isStarting = false,
}) => {
  const isEn = currentLanguage === 'en';

  const [studyDaysTarget, setStudyDaysTarget] = useState<number>(() => {
    return initialStudyDaysTarget && initialStudyDaysTarget >= 1 && initialStudyDaysTarget <= 7
      ? initialStudyDaysTarget
      : 7;
  });

  const [selectedDays, setSelectedDays] = useState<DayOfWeek[]>(() => {
    if (initialSelectedDays && initialSelectedDays.length > 0) {
      return initialSelectedDays;
    }
    // Default preset according to target
    const foundPreset = PRESETS.find((p) => p.days === initialStudyDaysTarget);
    return foundPreset ? foundPreset.presetDays : PRESETS[3].presetDays;
  });

  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // Synchronize initial state when modal opens
  useEffect(() => {
    if (isOpen) {
      const target = initialStudyDaysTarget && initialStudyDaysTarget >= 1 && initialStudyDaysTarget <= 7
        ? initialStudyDaysTarget
        : 7;
      setStudyDaysTarget(target);
      if (initialSelectedDays && initialSelectedDays.length > 0) {
        setSelectedDays(initialSelectedDays);
      } else {
        const found = PRESETS.find((p) => p.days === target);
        setSelectedDays(found ? found.presetDays : PRESETS[3].presetDays);
      }
      setIsSubmitting(false);
    }
  }, [isOpen, initialStudyDaysTarget, initialSelectedDays]);

  if (!isOpen) return null;

  const handleSelectPreset = (days: number, presetDays: DayOfWeek[]) => {
    setStudyDaysTarget(days);
    setSelectedDays(presetDays);
  };

  const handleToggleDay = (day: DayOfWeek) => {
    setSelectedDays((prev) => {
      let updated: DayOfWeek[];
      if (prev.includes(day)) {
        // Minimum 1 study day required
        if (prev.length <= 1) return prev;
        updated = prev.filter((d) => d !== day);
      } else {
        updated = [...prev, day];
      }
      setStudyDaysTarget(updated.length);
      return updated;
    });
  };

  const isLoadingAction = isSubmitting || isStarting;

  const handleConfirmSubmit = async () => {
    if (isLoadingAction) return;
    setIsSubmitting(true);
    let timeoutTimer: any = null;
    try {
      const confirmPromise = Promise.resolve(onConfirm(studyDaysTarget, selectedDays));
      const timeoutPromise = new Promise((resolve) => {
        timeoutTimer = setTimeout(() => {
          console.warn('Start new week confirmation reached timeout, completing modal action');
          resolve(true);
        }, 5000);
      });
      await Promise.race([confirmPromise, timeoutPromise]);
    } catch (err) {
      console.warn('Error confirming start new week:', err);
    } finally {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      setIsSubmitting(false);
      try {
        onClose();
      } catch (closeErr) {
        console.warn('Modal close notice:', closeErr);
      }
    }
  };

  return (
    <div
      id="start-new-week-modal"
      className="fixed inset-0 z-50 bg-black/65 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto"
    >
      <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-[#607EC9]/40 space-y-5 my-auto animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-[#000035] text-[#F4CA54] flex items-center justify-center shrink-0 border border-[#1C4C96] shadow-sm">
              <RotateCcw className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-black text-[#000035]">
                  {isEn ? `Start Week ${currentCycle + 1}` : `Iniciar Semana ${currentCycle + 1}`}
                </h3>
                <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-[#1C4C96] text-[#F4CA54]">
                  {isEn ? 'Cycle Setup' : 'Configuração'}
                </span>
              </div>
              <p className="text-xs text-[#607EC9] font-medium mt-0.5">
                {isEn
                  ? 'Set your weekly study days goal & refresh your routine'
                  : 'Defina sua meta de dias de estudo & renove sua rotina'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-xl hover:bg-slate-100 transition cursor-pointer"
            title={isEn ? 'Close' : 'Fechar'}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Section 1: Study Days Target Selection */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-xs font-black text-[#000035] flex items-center gap-1.5">
              <Calendar className="w-4 h-4 text-[#1C4C96]" />
              <span>{isEn ? 'Weekly Study Days Goal:' : 'Meta de Dias de Estudo por Semana:'}</span>
            </label>
            <span className="text-xs font-mono font-black text-[#1C4C96] bg-[#9AB4FF]/20 px-2 py-0.5 rounded-lg">
              {studyDaysTarget} {isEn ? (studyDaysTarget === 1 ? 'day' : 'days') : (studyDaysTarget === 1 ? 'dia' : 'dias')} / {isEn ? 'week' : 'semana'}
            </span>
          </div>

          {/* Quick preset selector cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {PRESETS.map((preset) => {
              const isSelected = studyDaysTarget === preset.days;
              return (
                <button
                  key={preset.days}
                  type="button"
                  onClick={() => handleSelectPreset(preset.days, preset.presetDays)}
                  className={`p-2.5 rounded-2xl border text-left transition flex flex-col justify-between relative cursor-pointer ${
                    isSelected
                      ? 'bg-[#000035] text-white border-[#1C4C96] shadow-xs scale-[1.02]'
                      : 'bg-slate-50 hover:bg-slate-100 text-[#000035] border-slate-200'
                  }`}
                >
                  <div className="flex items-center justify-between w-full">
                    <span className="text-xs font-black">
                      {isEn ? preset.labelEn : preset.labelPt}
                    </span>
                    {isSelected && <Check className="w-3.5 h-3.5 text-[#F4CA54]" />}
                  </div>
                  <span className={`text-[10px] mt-1 line-clamp-2 ${isSelected ? 'text-[#9AB4FF]' : 'text-slate-500'}`}>
                    {isEn ? preset.descEn : preset.descPt}
                  </span>
                  {preset.isDefault && (
                    <span className="mt-1.5 text-[8px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded bg-[#F4CA54]/20 text-[#000035] w-max">
                      {isEn ? 'Platform Default' : 'Padrão'}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Custom Day Toggle Buttons */}
          <div className="pt-1">
            <span className="text-[11px] font-bold text-slate-600 block mb-1.5">
              {isEn
                ? 'Select specific study days (click to toggle):'
                : 'Escolha os dias específicos de estudo (clique para alternar):'}
            </span>
            <div className="grid grid-cols-7 gap-1.5">
              {ALL_DAYS.map((d) => {
                const isDaySelected = selectedDays.includes(d.key);
                return (
                  <button
                    key={d.key}
                    type="button"
                    onClick={() => handleToggleDay(d.key)}
                    className={`py-2 px-1 rounded-xl text-center font-mono font-bold text-xs transition cursor-pointer flex flex-col items-center gap-0.5 border ${
                      isDaySelected
                        ? 'bg-[#1C4C96] text-white border-[#1C4C96] shadow-2xs'
                        : 'bg-white text-slate-500 hover:bg-slate-100 border-slate-200'
                    }`}
                    title={`${isEn ? d.labelEn : d.labelPt} (${isDaySelected ? (isEn ? 'Selected' : 'Selecionado') : (isEn ? 'Unselected' : 'Não selecionado')})`}
                  >
                    <span>{isEn ? d.shortEn : d.shortPt}</span>
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        isDaySelected ? 'bg-[#F4CA54]' : 'bg-transparent'
                      }`}
                    />
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Section 2: Important Rule & Evolution Clarity */}
        <div className="space-y-2.5 bg-slate-50 rounded-2xl p-4 border border-slate-200 text-xs">
          <div className="flex items-start gap-2 text-[#000035]">
            <Award className="w-4 h-4 text-[#1C4C96] shrink-0 mt-0.5" />
            <div>
              <p className="font-black text-[#000035]">
                {isEn ? '100% Progress Calculation:' : 'Cálculo de Progresso (100%):'}
              </p>
              <p className="text-slate-600 text-[11px] mt-0.5 leading-relaxed">
                {isEn
                  ? `Your completion goal for Video, Audio, and Memorization activities is now calibrated to ${studyDaysTarget} ${
                      studyDaysTarget === 1 ? 'day' : 'days'
                    } this week. Completing your chosen ${studyDaysTarget} ${
                      studyDaysTarget === 1 ? 'day' : 'days'
                    } awards 100% for each habit pillar.`
                  : `Suas atividades de Vídeo, Áudio e Memorização alcançarão 100% da meta ao completar os ${studyDaysTarget} ${
                      studyDaysTarget === 1 ? 'dia' : 'dias'
                    } escolhidos para a semana.`}
              </p>
            </div>
          </div>

          <div className="flex items-start gap-2 pt-2 border-t border-slate-200/80">
            <Info className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-black text-emerald-800">
                {isEn ? 'Native Friend Chat Independence:' : 'Chat com Amigo Nativo (100% Independente):'}
              </p>
              <p className="text-emerald-700 text-[11px] mt-0.5 leading-relaxed">
                {isEn
                  ? `Your "Chat with Your Native Friend" goal remains ${weeklyNativeLessonsTarget}x/week based strictly on your live lesson package. It is completely independent of the weekly study days goal.`
                  : `A meta do "Chat with Your Native Friend" continua fixada em ${weeklyNativeLessonsTarget}x/semana conforme o seu plano de aulas ao vivo contratadas, sem ser alterada pela meta de dias da semana.`}
              </p>
            </div>
          </div>

          <div className="flex items-start gap-2 pt-2 border-t border-slate-200/80">
            <Sparkles className="w-4 h-4 text-[#F4CA54] shrink-0 mt-0.5" />
            <div>
              <p className="font-black text-[#000035]">
                {isEn ? 'Fresh Content & Checklist:' : 'Renovação de Conteúdos & Checklist:'}
              </p>
              <p className="text-slate-600 text-[11px] mt-0.5 leading-relaxed">
                {isEn
                  ? 'Watched YouTube videos and Spotify audios are safely archived in your history (zero repeats), new level-matched materials are assigned, and the 7-day checklist is refreshed.'
                  : 'Vídeos e áudios já assistidos são arquivados no seu histórico pessoal (sem repetições), novos conteúdos são atribuídos e o checklist semanal é reiniciado.'}
              </p>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-100">
          <button
            type="button"
            onClick={() => {
              setIsSubmitting(false);
              onClose();
            }}
            disabled={isLoadingAction}
            className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition cursor-pointer disabled:opacity-50"
          >
            {isEn ? 'Cancel' : 'Cancelar'}
          </button>
          <button
            type="button"
            onClick={handleConfirmSubmit}
            disabled={isLoadingAction}
            className="px-5 py-2 text-xs font-black bg-[#000035] hover:bg-[#062863] text-white rounded-xl shadow-md transition flex items-center gap-2 cursor-pointer border border-[#1C4C96] disabled:opacity-50"
          >
            {isLoadingAction ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin text-[#F4CA54]" />
                <span>{isEn ? 'Starting...' : 'Iniciando...'}</span>
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4 text-[#F4CA54]" />
                <span>
                  {isEn
                    ? `Start Week ${currentCycle + 1} (${studyDaysTarget} ${
                        studyDaysTarget === 1 ? 'day' : 'days'
                      })`
                    : `Iniciar Semana ${currentCycle + 1} (${studyDaysTarget} ${
                        studyDaysTarget === 1 ? 'dia' : 'dias'
                      })`}
                </span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
