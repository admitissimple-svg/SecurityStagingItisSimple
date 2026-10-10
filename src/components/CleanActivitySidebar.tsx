import React from 'react';
import {
  Clock,
  CheckCircle2,
  Circle,
  Plus,
  Trash2,
  Edit3,
  Calendar,
  Sparkles,
  Youtube,
  AlertCircle,
  Info,
  Send,
  PenTool,
  BookOpen,
} from 'lucide-react';
import { RoutineItem, DayOfWeek, Language } from '../types';
import {
  getLastActivityOfTheDay,
  getEndOfDayReminderTime,
  DAYS_OF_WEEK,
  getDayLabel,
  getDayShortLabel,
  getTodayDayOfWeek,
} from '../utils/notifications';
import { Translations, getActivityDisplayName } from '../utils/i18n';

interface CleanActivitySidebarProps {
  items?: RoutineItem[];
  routinesByDay?: Record<DayOfWeek, RoutineItem[]>;
  allRoutinesByDay?: Record<DayOfWeek, RoutineItem[]>;
  selectedActivityId: string | null;
  selectedDay?: DayOfWeek;
  activeDay?: DayOfWeek;
  t: Translations;
  currentLanguage?: Language;
  isTeacher?: boolean;
  onSelectActivity: (id: string) => void;
  onSelectDay: (day: DayOfWeek) => void;
  onToggleComplete: (id: string) => void;
  onAddActivity?: () => void;
  onAddCustomActivity?: (item: Omit<RoutineItem, 'id'>) => void;
  onEditActivity?: (item: RoutineItem) => void;
  onDeleteActivity?: (id: string) => void;
  onOpenEndOfDayModal?: () => void;
  onOpenEmailNotificationModal?: () => void;
  onManageStudents?: () => void;
  onOpenPersonalDictionary?: () => void;
}

export const CleanActivitySidebar: React.FC<CleanActivitySidebarProps> = ({
  items,
  routinesByDay,
  allRoutinesByDay,
  selectedActivityId,
  selectedDay,
  activeDay,
  t,
  currentLanguage = 'pt',
  isTeacher = false,
  onSelectActivity,
  onSelectDay,
  onToggleComplete,
  onAddActivity,
  onAddCustomActivity,
  onEditActivity,
  onDeleteActivity,
  onOpenEndOfDayModal,
  onOpenEmailNotificationModal,
  onManageStudents,
  onOpenPersonalDictionary,
}) => {
  const effectiveDay = selectedDay || activeDay || 'monday';
  const effectiveRoutinesMap: Partial<Record<DayOfWeek, RoutineItem[]>> = routinesByDay || allRoutinesByDay || {};
  const currentList = items || effectiveRoutinesMap[effectiveDay] || [];
  const sortedItems = [...currentList].sort((a, b) => a.time.localeCompare(b.time));
  const completedCount = sortedItems.filter((i) => i.completedToday).length;
  const progressPercent =
    sortedItems.length > 0 ? Math.round((completedCount / sortedItems.length) * 100) : 0;

  // Teacher video coverage stats
  const itemsWithVideos = sortedItems.filter(
    (i) => i.teacherVideos && i.teacherVideos.length > 0
  ).length;
  const hasPendingVideos = sortedItems.length > 0 && itemsWithVideos < sortedItems.length;

  // Last activity for 30-min reminder banner
  const lastActivity = getLastActivityOfTheDay(sortedItems);
  const endOfDayTimeStr = lastActivity ? getEndOfDayReminderTime(lastActivity.time) : null;
  const todayDay = getTodayDayOfWeek();
  const lang: Language = (currentLanguage as Language) || 'pt';
  const dayName = getDayLabel(effectiveDay, lang);


  return (
    <div className="space-y-4" id="daily-routine-sidebar">
      {/* 1. Pedagogical Routine Instructions */}
      <div className="bg-gradient-to-br from-[#000035] via-[#062863] to-[#1C4C96] text-white rounded-3xl p-5 sm:p-6 border border-[#1C4C96] shadow-md space-y-4">
        <div className="flex items-start gap-3 border-b border-[#607EC9]/30 pb-3.5">
          <div className="w-10 h-10 rounded-2xl bg-[#1C4C96] text-[#9AB4FF] flex items-center justify-center shrink-0 border border-[#9AB4FF]/40 shadow-xs">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-black text-white tracking-tight">
                {currentLanguage === 'en' ? 'Daily Routine Guide' : 'Como Funciona a Rotina Diária'}
              </h2>
              <span className="text-[10px] font-extrabold px-2 py-0.5 bg-[#9AB4FF] text-[#000035] rounded-full uppercase">
                {currentLanguage === 'en' ? 'Step by Step' : 'Passo a Passo'}
              </span>
            </div>
            <p className="text-xs text-[#9AB4FF]/85 mt-0.5 leading-relaxed">
              {currentLanguage === 'en'
                ? 'Follow these 2 simple steps to build your custom English learning routine:'
                : 'Siga os 2 passos abaixo para personalizar o seu aprendizado de inglês:'}
            </p>
          </div>
        </div>

        {/* Step 1 & Step 2 Cards */}
        <div className="space-y-3">
          {/* Step 1 */}
          <div className="p-3.5 bg-[#000035]/60 rounded-2xl border border-[#607EC9]/40 space-y-2">
            <div className="flex items-start gap-2.5">
              <span className="w-6 h-6 rounded-xl bg-[#9AB4FF] text-[#000035] text-xs font-black flex items-center justify-center shrink-0 mt-0.5">
                1
              </span>
              <div className="space-y-1 flex-1">
                <h3 className="text-xs sm:text-sm font-extrabold text-white">
                  {currentLanguage === 'en'
                    ? '1. Fill in your daily routine'
                    : '1. Preencha a sua rotina diária'}
                </h3>
                <p className="text-[11px] text-[#9AB4FF]/80 leading-relaxed">
                  {currentLanguage === 'en'
                    ? 'Enter the scheduled time and the topic for the videos you want to watch today.'
                    : 'Informe o horário e o tema para os vídeos que você quer assistir hoje.'}
                </p>
              </div>
            </div>
          </div>

          {/* Step 2 */}
          <div className="p-3.5 bg-[#000035]/60 rounded-2xl border border-[#607EC9]/40 space-y-2">
            <div className="flex items-start gap-2.5">
              <span className="w-6 h-6 rounded-xl bg-[#1C4C96] text-white text-xs font-black flex items-center justify-center shrink-0 mt-0.5 border border-[#9AB4FF]/40">
                2
              </span>
              <div className="space-y-1 flex-1">
                <h3 className="text-xs sm:text-sm font-extrabold text-white">
                  {currentLanguage === 'en'
                    ? '2. Email your routine to your teacher'
                    : '2. Envie o e-mail com a sua rotina ao professor'}
                </h3>
                <p className="text-[11px] text-[#9AB4FF]/80 leading-relaxed">
                  {currentLanguage === 'en'
                    ? 'After filling in your routine, send the email to your teacher. Your teacher will select and assign recommended YouTube video lessons and daily Spotify podcast or music suggestions for each moment.'
                    : 'Após o preenchimento, envie o e-mail ao professor. Ele irá selecionar e indicar vídeos recomendados do YouTube e sugestões diárias de áudio/podcast ou música no Spotify para cada atividade sua.'}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 2. 7 Days Weekday Navigator */}
      <div className="bg-white rounded-3xl p-3.5 border border-[#607EC9]/30 shadow-xs space-y-2.5">
        <div className="flex items-center justify-between px-1">
          <span className="text-[11px] font-bold text-[#000035] uppercase tracking-wider flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5 text-[#1C4C96]" />
            <span>{currentLanguage === 'en' ? 'Select Day of the Week' : 'Selecione o Dia da Semana'}</span>
          </span>
          <span className="text-[10px] font-semibold text-[#062863] bg-[#9AB4FF]/20 px-2.5 py-0.5 rounded-full border border-[#9AB4FF]/40">
            {dayName}
          </span>
        </div>

        {/* 7 Day Pills */}
        <div className="grid grid-cols-7 gap-1">
          {DAYS_OF_WEEK.map((day) => {
            const isSelected = day === effectiveDay;
            const isToday = day === todayDay;
            const dayItems = effectiveRoutinesMap[day] || [];
            const dayVideosCount = dayItems.filter((it) => it.teacherVideos && it.teacherVideos.length > 0).length;
            const hasMissingVideo = dayItems.length > 0 && dayVideosCount < dayItems.length;

            return (
              <button
                key={day}
                type="button"
                onClick={() => onSelectDay(day)}
                className={`py-2 px-1 rounded-xl text-center transition cursor-pointer flex flex-col items-center justify-center relative ${
                  isSelected
                    ? 'bg-[#062863] text-white shadow-xs font-black border border-[#1C4C96]'
                    : 'bg-[#9AB4FF]/10 text-[#062863] hover:bg-[#9AB4FF]/25 hover:text-[#000035] border border-[#9AB4FF]/30'
                }`}
                title={`${getDayLabel(day, lang)} - ${dayItems.length} ${lang === 'en' ? 'activities' : 'atividades'}`}
              >
                <span className="text-[11px] uppercase">
                  {getDayShortLabel(day, lang)}
                </span>

                <div className="flex items-center gap-0.5 mt-0.5">
                  <span
                    className={`text-[9px] font-mono font-bold ${
                      isSelected ? 'text-[#9AB4FF]' : 'text-[#607EC9]'
                    }`}
                  >
                    {dayItems.length}
                  </span>
                  {hasMissingVideo && (
                    <span
                      className="w-1.5 h-1.5 rounded-full bg-[#F59E0B]"
                      title={currentLanguage === 'en' ? 'Pending teacher videos' : 'Aguardando vídeos do professor'}
                    />
                  )}
                </div>

                {isToday && (
                  <span
                    className={`absolute -top-1 right-1 w-2 h-2 rounded-full ${
                      isSelected ? 'bg-[#9AB4FF]' : 'bg-[#1C4C96]'
                    }`}
                    title={currentLanguage === 'en' ? 'Today' : 'Hoje'}
                  />
                )}
              </button>
            );
          })}
        </div>

        {/* Quick Batch Filters */}
        <div className="flex items-center justify-between pt-1.5 border-t border-[#9AB4FF]/25 text-[10px] px-1">
          <span className="text-[#607EC9]">
            {currentLanguage === 'en' ? 'Quick jump:' : 'Atalhos rápidos:'}
          </span>
          <div className="flex items-center gap-2 font-bold">
            <button
              type="button"
              onClick={() => onSelectDay('monday')}
              className="text-[#1C4C96] hover:underline cursor-pointer"
            >
              {t.allWeekdaysLabel}
            </button>
            <span className="text-[#9AB4FF]">•</span>
            <button
              type="button"
              onClick={() => onSelectDay('saturday')}
              className="text-[#1C4C96] hover:underline cursor-pointer"
            >
              {t.allWeekendsLabel}
            </button>
          </div>
        </div>
      </div>

      {/* 3. Selected Day Card */}
      <div className="bg-white rounded-3xl p-5 border border-[#607EC9]/30 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base sm:text-lg font-extrabold text-[#000035]">
                {dayName}
              </h3>
              {activeDay === todayDay && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#9AB4FF]/20 text-[#062863] border border-[#9AB4FF]/40">
                  {currentLanguage === 'en' ? 'TODAY' : 'HOJE'}
                </span>
              )}
            </div>
            <p className="text-xs text-[#607EC9] mt-0.5">
              {sortedItems.length} {sortedItems.length === 1 ? (currentLanguage === 'en' ? 'activity' : 'atividade') : (currentLanguage === 'en' ? 'activities' : 'atividades')} • {itemsWithVideos}/{sortedItems.length}{' '}
              {currentLanguage === 'en' ? 'videos assigned' : 'vídeos atribuídos'}
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={onAddActivity}
              className="px-3.5 py-2 bg-[#1C4C96] hover:bg-[#062863] text-white rounded-xl text-xs font-black transition flex items-center gap-1.5 shadow-xs cursor-pointer"
              title={
                currentLanguage === 'en'
                  ? 'Add a time and activity you want to learn about in English'
                  : 'Preencha a rotina informando o horário e a atividade sobre a qual quer aprender'
              }
            >
              <Plus className="w-4 h-4 text-[#9AB4FF]" />
              <span>{currentLanguage === 'en' ? 'Add Activity' : 'Adicionar Atividade'}</span>
            </button>
          </div>
        </div>

        {/* Daily Progress */}
        <div className="space-y-1.5 pt-2 border-t border-[#9AB4FF]/20">
          <div className="flex items-center justify-between text-xs font-semibold text-[#000035]">
            <span>{currentLanguage === 'en' ? 'Daily Practice Progress:' : 'Progresso de Prática do Dia:'}</span>
            <span className="font-mono text-[#1C4C96] font-bold">{progressPercent}%</span>
          </div>
          <div className="w-full h-2 bg-[#9AB4FF]/15 rounded-full overflow-hidden border border-[#9AB4FF]/30">
            <div
              className="h-full bg-[#1C4C96] transition-all duration-500 rounded-full"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>

        {/* Dynamic Instructional Next Step Banner */}
        {sortedItems.length === 0 ? (
          <div className="p-4 bg-[#9AB4FF]/5 rounded-2xl border border-dashed border-[#607EC9]/40 space-y-2.5 text-xs">
            <div className="flex items-center gap-2 text-[#000035] font-extrabold">
              <Info className="w-4 h-4 text-[#1C4C96]" />
              <span>
                {currentLanguage === 'en' ? 'Start by filling your routine:' : 'Comece preenchendo a sua rotina:'}
              </span>
            </div>
            <p className="text-[#062863] leading-relaxed">
              {currentLanguage === 'en'
                ? `You don't have any activities on ${dayName} yet. Click below to add the scheduled times and activities you'd like to learn in English.`
                : `Você ainda não cadastrou atividades para ${dayName}. Clique no botão abaixo para informar seus horários e as atividades sobre as quais quer aprender.`}
            </p>
            <button
              type="button"
              onClick={onAddActivity}
              className="px-4 py-2 bg-[#1C4C96] hover:bg-[#062863] text-white font-bold rounded-xl transition flex items-center gap-2 cursor-pointer shadow-xs"
            >
              <Plus className="w-4 h-4 text-[#9AB4FF]" />
              <span>{currentLanguage === 'en' ? 'Add First Activity' : 'Adicionar Primeira Atividade'}</span>
            </button>
          </div>
        ) : hasPendingVideos ? (
          <div className="p-4 bg-[#9AB4FF]/10 rounded-2xl border border-[#607EC9]/30 space-y-2 text-xs text-[#062863]">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-[#1C4C96] shrink-0" />
              <span className="font-extrabold text-sm text-[#000035]">
                {isTeacher
                  ? (currentLanguage === 'en' ? 'Assign Videos to Routine' : 'Indicar Vídeos para a Rotina')
                  : (currentLanguage === 'en' ? 'Select Daily Topics' : 'Selecione os Temas do Dia')}
              </span>
            </div>

            <p className="text-[11px] leading-relaxed text-[#607EC9]">
              {isTeacher
                ? (currentLanguage === 'en'
                    ? `${sortedItems.length - itemsWithVideos} activity(ies) need YouTube video recommendations.`
                    : `${sortedItems.length - itemsWithVideos} atividade(s) de ${dayName} aguardam indicação de vídeos no YouTube.`)
                : (currentLanguage === 'en'
                    ? `Choose topics from the timeline below to automatically assign curated YouTube videos for ${dayName}.`
                    : `Escolha os temas na linha do tempo abaixo para vincular automaticamente os vídeos do YouTube para ${dayName}.`)}
            </p>
          </div>
        ) : (
          <div className="p-3 bg-[#9AB4FF]/20 rounded-2xl border border-[#607EC9]/40 flex items-center gap-2.5 text-xs text-[#062863]">
            <CheckCircle2 className="w-4 h-4 text-[#1C4C96] shrink-0" />
            <span className="font-bold">
              {currentLanguage === 'en'
                ? `✨ All set! Teacher videos are assigned for ${dayName}. Select an activity below to practice.`
                : `✨ Tudo pronto! Os vídeos do professor estão vinculados para ${dayName}. Selecione uma atividade abaixo para praticar.`}
            </span>
          </div>
        )}
      </div>

      {/* 4. Activities Timeline */}
      <div className="bg-white rounded-3xl p-3 sm:p-4 border border-[#607EC9]/30 shadow-xs space-y-2 max-h-[560px] overflow-y-auto">
        <div className="flex items-center justify-between px-1 pb-1">
          <div className="flex items-center gap-2">
            <span className="text-xs font-black text-[#000035]">
              {currentLanguage === 'en' ? 'Activities Timeline' : 'Linha do Tempo de Atividades'}
            </span>
            <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-[#9AB4FF]/20 text-[#062863] border border-[#9AB4FF]/40">
              {sortedItems.length} {sortedItems.length === 1 ? (currentLanguage === 'en' ? 'activity' : 'atividade') : (currentLanguage === 'en' ? 'activities' : 'atividades')}
            </span>
          </div>

          <button
            type="button"
            onClick={onAddActivity}
            className="px-2.5 py-1 bg-[#1C4C96] hover:bg-[#062863] text-white text-[11px] font-bold rounded-xl transition flex items-center gap-1 cursor-pointer shadow-xs"
            title={currentLanguage === 'en' ? 'Add new activity' : 'Adicionar nova atividade'}
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{currentLanguage === 'en' ? 'Add Activity' : 'Adicionar Atividade'}</span>
          </button>
        </div>

        {sortedItems.length === 0 ? (
          <div className="p-8 text-center space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-[#9AB4FF]/10 text-[#607EC9] flex items-center justify-center mx-auto">
              <Calendar className="w-6 h-6" />
            </div>
            <p className="text-xs text-[#607EC9]">{t.noActivities}</p>
            <button
              type="button"
              onClick={onAddActivity}
              className="px-4 py-2 bg-[#1C4C96] text-white text-xs font-bold rounded-xl hover:bg-[#062863] transition cursor-pointer"
            >
              {t.addFirstActivity}
            </button>
          </div>
        ) : (
          sortedItems.map((item) => {
            const isSelected = item.id === selectedActivityId;
            const hasAssignedVideo = item.teacherVideos && item.teacherVideos.length > 0;
            const wordsCount = item.learnedWords ? item.learnedWords.filter(Boolean).length : 0;
            const displayName = getActivityDisplayName(item.activityName, lang);

            return (
              <div
                key={item.id}
                onClick={() => onSelectActivity(item.id)}
                className={`group relative p-3 sm:p-3.5 rounded-2xl border transition-all cursor-pointer flex items-center justify-between gap-3 ${
                  isSelected
                    ? 'bg-[#9AB4FF]/20 border-[#1C4C96] shadow-xs ring-2 ring-[#1C4C96]/30'
                    : 'bg-white border-[#9AB4FF]/30 hover:border-[#607EC9] hover:bg-[#9AB4FF]/5'
                }`}
              >
                {/* Left: Indicator + Time + Title */}
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div
                    className="text-[#607EC9] shrink-0"
                    title={
                      item.completedToday
                        ? t.practicedToday
                        : currentLanguage === 'en'
                        ? 'Completed automatically when you watch or listen'
                        : 'Concluído automaticamente ao praticar a atividade'
                    }
                  >
                    {item.completedToday ? (
                      <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                    ) : (
                      <Circle className="w-5 h-5 text-slate-300" />
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs font-bold text-[#000035] px-2 py-0.5 rounded-lg bg-[#9AB4FF]/15 border border-[#9AB4FF]/40">
                        {item.time}
                      </span>

                      {/* Video Status Badge */}
                      {hasAssignedVideo ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#9AB4FF]/20 text-[#062863] border border-[#9AB4FF]/50">
                          <Youtube className="w-3 h-3 text-[#B91C1C]" />
                          <span>{currentLanguage === 'en' ? 'Video Ready' : 'Vídeo Pronto'}</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#FEF7E0] text-[#8D6909] border border-[#F8E6AB]">
                          <span>{currentLanguage === 'en' ? 'Awaiting Video' : 'Aguardando Vídeo'}</span>
                        </span>
                      )}

                      {/* 5 Words badge */}
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                          wordsCount >= 5
                            ? 'bg-[#9AB4FF]/20 text-[#062863] border-[#9AB4FF]/50'
                            : wordsCount > 0
                            ? 'bg-[#FEF7E0] text-[#8D6909] border-[#F8E6AB]'
                            : 'bg-[#9AB4FF]/5 text-[#607EC9] border-[#9AB4FF]/30'
                        }`}
                      >
                        {wordsCount}/5 {currentLanguage === 'en' ? 'Words' : 'Palavras'}
                      </span>
                    </div>

                    <h4
                      className={`text-xs sm:text-sm font-bold truncate mt-1 ${
                        item.completedToday
                          ? 'text-[#607EC9] line-through'
                          : isSelected
                          ? 'text-[#000035] font-black'
                          : 'text-[#000035]'
                      }`}
                    >
                      {displayName}
                    </h4>
                  </div>
                </div>

                {/* Right: Actions */}
                <div className="flex items-center gap-1 opacity-80 group-hover:opacity-100 transition shrink-0">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onEditActivity?.(item);
                    }}
                    className="p-1.5 text-[#607EC9] hover:text-[#1C4C96] hover:bg-[#9AB4FF]/15 rounded-lg transition cursor-pointer"
                    title={t.editTime}
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                  </button>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (
                        confirm(
                          currentLanguage === 'en'
                            ? `Are you sure you want to remove "${displayName}" from ${dayName}?`
                            : `Tem certeza que deseja remover "${displayName}" de ${dayName}?`
                        )
                      ) {
                        onDeleteActivity?.(item.id);
                      }
                    }}
                    className="p-1.5 text-[#607EC9] hover:text-red-600 hover:bg-red-50 rounded-lg transition cursor-pointer"
                    title={t.deleteActivity}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })
        )}

        {sortedItems.length > 0 && onAddActivity && (
          <button
            type="button"
            onClick={onAddActivity}
            className="w-full py-2.5 bg-[#9AB4FF]/10 hover:bg-[#9AB4FF]/20 border border-dashed border-[#607EC9]/40 hover:border-[#1C4C96] rounded-2xl text-xs font-bold text-[#062863] transition flex items-center justify-center gap-2 cursor-pointer mt-1"
          >
            <Plus className="w-3.5 h-3.5 text-[#1C4C96]" />
            <span>
              {currentLanguage === 'en'
                ? '+ Include New Activity to Timeline'
                : '+ Incluir Nova Atividade na Linha do Tempo'}
            </span>
          </button>
        )}

        {onOpenPersonalDictionary && (
          <button
            type="button"
            onClick={onOpenPersonalDictionary}
            className="w-full py-2.5 bg-white hover:bg-[#9AB4FF]/15 border border-[#607EC9]/30 rounded-2xl text-xs font-bold text-[#062863] transition flex items-center justify-center gap-2 cursor-pointer shadow-2xs mt-2"
          >
            <BookOpen className="w-4 h-4 text-[#1C4C96]" />
            <span>
              {currentLanguage === 'en'
                ? '📖 My Personal Routine Dictionary'
                : '📖 Meu Dicionário Pessoal da Rotina'}
            </span>
          </button>
        )}
      </div>

      {/* 5. 30-min Reminder Shortcut */}
      {lastActivity && endOfDayTimeStr && (
        <div className="p-4 bg-gradient-to-br from-[#9AB4FF]/20 to-[#607EC9]/20 rounded-3xl border border-[#9AB4FF]/40 shadow-xs space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-[#062863] text-white flex items-center justify-center font-bold border border-[#1C4C96]">
                <PenTool className="w-4 h-4 text-[#9AB4FF]" />
              </div>
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-[#062863] block">
                  {currentLanguage === 'en' ? 'Daily Review Practice' : 'Prática de Encerramento'}
                </span>
                <h4 className="text-xs font-bold text-[#000035]">
                  {t.endOfDayTitle}
                </h4>
              </div>
            </div>

            <span className="font-mono text-[11px] font-bold px-2 py-0.5 rounded-lg bg-[#062863] text-white shadow-xs">
              {endOfDayTimeStr}
            </span>
          </div>

          <p className="text-[11px] text-[#062863] leading-relaxed">
            {currentLanguage === 'en'
              ? `Daily review reminder triggers at ${endOfDayTimeStr} (30 min before "${getActivityDisplayName(
                  lastActivity.activityName,
                  'en'
                )}"). Write 1 sentence in English using today's words.`
              : `Lembrete diário às ${endOfDayTimeStr} (30 min antes de "${getActivityDisplayName(
                  lastActivity.activityName,
                  'pt'
                )}"). Pratique escrevendo 1 frase em inglês com as palavras do dia.`}
          </p>

          <button
            type="button"
            onClick={onOpenEndOfDayModal}
            className="w-full py-2 bg-[#1C4C96] hover:bg-[#062863] text-white rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
          >
            <PenTool className="w-3.5 h-3.5 text-[#9AB4FF]" />
            <span>{t.openDailySentenceReviewBtn}</span>
          </button>
        </div>
      )}
    </div>
  );
};
