import React from 'react';
import {
  BookOpen,
  Sparkles,
  Volume2,
  CheckCircle2,
  ArrowRight,
  BookMarked,
  Layers,
} from 'lucide-react';
import { WeeklyHomeworkData, Language, RoutineItem, DayOfWeek, HomeworkVocabItem, StudentDictionaryEntry } from '../types';
import { getTranslations } from '../utils/i18n';

interface WeeklyHomeworkSectionProps {
  homework: WeeklyHomeworkData | null;
  routinesByDay?: Record<DayOfWeek, RoutineItem[]>;
  onOpenHomeworkModal: () => void;
  onOpenDictionaryModal?: () => void;
  currentLanguage: Language;
  dictionaryEntries?: StudentDictionaryEntry[];
}

export const WeeklyHomeworkSection: React.FC<WeeklyHomeworkSectionProps> = ({
  homework,
  routinesByDay,
  onOpenHomeworkModal,
  onOpenDictionaryModal,
  currentLanguage,
  dictionaryEntries,
}) => {
  const t = getTranslations(currentLanguage);
  const isEn = currentLanguage === 'en';

  const extractedWordsFromRoutines: HomeworkVocabItem[] = React.useMemo(() => {
    if (homework?.allRoutineWords && homework.allRoutineWords.length > 0) {
      return homework.allRoutineWords;
    }
    if (homework?.vocabularyList && homework.vocabularyList.length > 0) {
      return homework.vocabularyList;
    }
    if (!routinesByDay) return [];

    const list: HomeworkVocabItem[] = [];
    const seen = new Set<string>();

    Object.entries(routinesByDay).forEach(([day, items]) => {
      const routineItems = items as RoutineItem[] | undefined;
      (routineItems || []).forEach((item) => {
        if (item.learnedWords && Array.isArray(item.learnedWords)) {
          item.learnedWords.forEach((w) => {
            const trimmed = (w || '').trim();
            if (trimmed && !seen.has(trimmed.toLowerCase())) {
              seen.add(trimmed.toLowerCase());
              list.push({
                word: trimmed,
                sourceActivityName: item.activityName,
                sourceDay: day as DayOfWeek,
                definitionEn: `Vocabulary learned during ${item.activityName}`,
                translationPt: `Vocabulário praticado na atividade ${item.activityName}`,
                exampleSentence: `I use '${trimmed}' during my ${item.activityName} routine.`,
              });
            }
          });
        }
      });
    });

    return list;
  }, [homework, routinesByDay]);

  const allWords = extractedWordsFromRoutines;
  const dictWordsCount = Array.isArray(dictionaryEntries)
    ? new Set(dictionaryEntries.map((d) => (d.word || '').trim().toLowerCase()).filter(Boolean)).size
    : 0;
  const totalWords = homework?.totalWordsCollected || Math.max(allWords.length, dictWordsCount);
  const isCompleted = Boolean(homework?.isCompleted);
  const score = homework?.score ?? 100;

  return (
    <div className="bg-gradient-to-br from-[#000035] via-[#062863] to-[#1C4C96] text-white rounded-3xl p-6 sm:p-8 border border-[#1C4C96] shadow-md space-y-6" id="weekly-homework-section">
      {/* Top Banner Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[#607EC9]/40 pb-5">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-2xl bg-[#1C4C96] text-white flex items-center justify-center shrink-0 border border-[#9AB4FF]/50 mt-0.5 shadow-xs">
            <BookOpen className="w-6 h-6 text-[#9AB4FF]" />
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2.5 flex-wrap">
              <h2 className="text-lg sm:text-xl font-black text-white tracking-tight">
                {t.weeklyHomeworkTitle}
              </h2>
              <span className="text-[10px] font-extrabold px-2.5 py-0.5 bg-[#000035]/60 text-[#9AB4FF] border border-[#9AB4FF]/40 rounded-full uppercase tracking-wider">
                {t.weeklyHomeworkBadge}
              </span>
              {isCompleted && (
                <span className="text-[10px] font-extrabold px-2.5 py-0.5 bg-[#9AB4FF]/20 text-[#9AB4FF] border border-[#9AB4FF]/50 rounded-full flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3 text-[#9AB4FF]" />
                  {t.homeworkCompleted} ({score}%)
                </span>
              )}
            </div>
            <p className="text-xs text-[#9AB4FF]/85 leading-relaxed max-w-3xl">
              {t.weeklyHomeworkSubtitle}
            </p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          {onOpenDictionaryModal && (
            <button
              type="button"
              onClick={onOpenDictionaryModal}
              className="px-5 py-3 bg-[#000035]/80 hover:bg-[#000035] text-white rounded-2xl font-black text-xs sm:text-sm transition flex items-center justify-center gap-2 cursor-pointer shadow-md border border-[#9AB4FF]/40"
            >
              <BookMarked className="w-4 h-4 text-[#F4CA54]" />
              <span>{isEn ? 'My Dictionary' : 'Meu Dicionário'}</span>
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-[#F4CA54] text-[#000035]">
                {totalWords}
              </span>
            </button>
          )}

          <button
            type="button"
            onClick={onOpenHomeworkModal}
            className="px-6 py-3.5 bg-[#607EC9] hover:bg-[#1C4C96] text-white rounded-2xl font-black text-xs sm:text-sm transition flex items-center justify-center gap-2.5 cursor-pointer shadow-lg transform hover:scale-102 shrink-0 border border-[#9AB4FF]/60"
          >
            <BookOpen className="w-5 h-5 text-white" />
            <span>{isCompleted ? t.openHomeworkAction : t.openHomeworkAction}</span>
            <ArrowRight className="w-4 h-4 text-white" />
          </button>
        </div>
      </div>

      {/* Clean, Non-Polluted Overview Card */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
        {/* Metric 1: Learned Vocabulary */}
        <div className="p-4 bg-[#000035]/60 rounded-2xl border border-[#607EC9]/40 flex items-center gap-3.5">
          <div className="w-10 h-10 rounded-xl bg-[#1C4C96]/60 flex items-center justify-center text-[#9AB4FF] shrink-0 border border-[#9AB4FF]/30">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[11px] text-[#9AB4FF]/75 font-bold block uppercase tracking-wider">
              {isEn ? 'Learned Words' : 'Palavras Praticadas'}
            </span>
            <div className="flex items-baseline gap-1.5 mt-0.5">
              <span className="text-xl sm:text-2xl font-black text-white font-mono">
                {totalWords}
              </span>
              <span className="text-xs text-[#9AB4FF]/80">
                {isEn ? 'in your routine' : 'na sua rotina'}
              </span>
            </div>
          </div>
        </div>

        {/* Metric 2: Structured Modules */}
        <div className="p-4 bg-[#000035]/60 rounded-2xl border border-[#607EC9]/40 flex items-center gap-3.5">
          <div className="w-10 h-10 rounded-xl bg-[#1C4C96]/60 flex items-center justify-center text-[#9AB4FF] shrink-0 border border-[#9AB4FF]/30">
            <Layers className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[11px] text-[#9AB4FF]/75 font-bold block uppercase tracking-wider">
              {isEn ? 'Practice Modules' : 'Módulos Práticos'}
            </span>
            <div className="flex items-baseline gap-1.5 mt-0.5">
              <span className="text-xl sm:text-2xl font-black text-white font-mono">5</span>
              <span className="text-xs text-[#9AB4FF]/80">
                {isEn ? 'interactive exercises' : 'exercícios interativos'}
              </span>
            </div>
          </div>
        </div>

        {/* Metric 3: Dictionary Shortcut */}
        <div
          onClick={onOpenDictionaryModal}
          className="p-4 bg-gradient-to-r from-[#1C4C96]/70 to-[#062863]/80 rounded-2xl border border-[#9AB4FF]/50 hover:border-[#F4CA54] transition cursor-pointer flex items-center justify-between group"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#000035] flex items-center justify-center text-[#F4CA54] shrink-0 border border-[#F4CA54]/40">
              <BookMarked className="w-5 h-5" />
            </div>
            <div>
              <span className="text-xs font-black text-white group-hover:text-[#F4CA54] transition flex items-center gap-1.5">
                {isEn ? 'Access My Dictionary' : 'Consultar Dicionário'}
              </span>
              <span className="text-[11px] text-[#9AB4FF] block mt-0.5">
                {isEn ? 'English definitions & examples' : 'Definições 100% em inglês & pronúncia'}
              </span>
            </div>
          </div>
          <ArrowRight className="w-4 h-4 text-[#9AB4FF] group-hover:text-[#F4CA54] group-hover:translate-x-1 transition shrink-0" />
        </div>
      </div>
    </div>
  );
};


