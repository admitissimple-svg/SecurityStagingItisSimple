import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Bell,
  Clock,
  CheckCircle2,
  X,
  Volume2,
  Sparkles,
  Play,
  ArrowRight,
  Calendar,
} from 'lucide-react';
import { RoutineItem, DayOfWeek, UserProfile, NotificationItem, Language } from '../types';
import { formatToAmPm, parseTimeToMinutes, formatMinutesToAmPm } from '../utils/timeFormat';

export interface ActiveReminder {
  id: string;
  type: 'activity' | 'phrase';
  title: string;
  message: string;
  targetTimeFormatted: string;
  targetTimeMinutes: number;
  activityId?: string;
  dayOfWeek?: DayOfWeek;
  timestamp: string;
}

interface RoutineRemindersManagerProps {
  userProfile?: UserProfile | null;
  routinesByDay: Record<DayOfWeek, RoutineItem[]>;
  currentLanguage: Language;
  onTriggerNotification?: (notification: NotificationItem) => void;
  onNavigateToActivity?: (day: DayOfWeek, activityId: string) => void;
  onOpenDailySentenceModal?: () => void;
}

const DAYS_INDEX_MAP: DayOfWeek[] = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];

/**
 * Play a gentle, elegant reminder chime using Web Audio API
 */
function playReminderChime() {
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();

    const playTone = (freq: number, delay: number, duration: number) => {
      setTimeout(() => {
        try {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, ctx.currentTime);
          gain.gain.setValueAtTime(0.08, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start();
          osc.stop(ctx.currentTime + duration);
        } catch {
          // ignore audio failure
        }
      }, delay);
    };

    // Ascending melodic chime (E5 -> G#5 -> B5)
    playTone(659.25, 0, 0.4);
    playTone(830.61, 150, 0.4);
    playTone(987.77, 300, 0.6);
  } catch {
    // ignore
  }
}

export const RoutineRemindersManager: React.FC<RoutineRemindersManagerProps> = ({
  userProfile,
  routinesByDay,
  currentLanguage,
  onTriggerNotification,
  onNavigateToActivity,
  onOpenDailySentenceModal,
}) => {
  const isEn = currentLanguage === 'en';
  const [activeAlerts, setActiveAlerts] = useState<ActiveReminder[]>([]);
  const alertedIdsRef = useRef<Set<string>>(new Set());

  // Times configured in user profile
  const videoTime = userProfile?.routineVideoTime || '09:00';
  const audioTime = userProfile?.routineAudioTime || '14:00';
  const phraseTime = userProfile?.dailyPhraseTime || '20:00';

  // Reset alerts when user profile changes
  useEffect(() => {
    setActiveAlerts([]);
    alertedIdsRef.current.clear();
  }, [userProfile?.email, userProfile?.routineAudioTime, userProfile?.routineVideoTime, userProfile?.dailyPhraseTime]);

  // Request browser notification permission once student interacts
  const handleRequestBrowserNotification = useCallback(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      if (Notification.permission === 'default') {
        Notification.requestPermission();
      }
    }
  }, []);

  const emitAlert = useCallback(
    (reminder: ActiveReminder) => {
      // 1. Play subtle audio chime
      playReminderChime();

      // 2. Add to active UI floating alerts
      setActiveAlerts((prev) => {
        if (prev.some((a) => a.id === reminder.id)) return prev;
        return [reminder, ...prev];
      });

      // 3. Add to system notifications
      if (onTriggerNotification) {
        onTriggerNotification({
          id: `reminder-${reminder.id}`,
          title: reminder.title,
          message: reminder.message,
          type: 'warning',
          timestamp: reminder.timestamp,
          read: false,
        });
      }

      // 4. Send browser desktop notification if permitted
      if (
        typeof window !== 'undefined' &&
        'Notification' in window &&
        Notification.permission === 'granted'
      ) {
        try {
          new Notification(reminder.title, {
            body: reminder.message,
            icon: '/favicon.ico',
          });
        } catch {
          // ignore
        }
      }
    },
    [onTriggerNotification]
  );

  // Periodic reminder checking loop: every 20 seconds
  useEffect(() => {
    const checkReminders = () => {
      const now = new Date();
      const currentHours = now.getHours();
      const currentMinutes = now.getMinutes();
      const currentTotalMinutes = currentHours * 60 + currentMinutes;
      const todayDay = DAYS_INDEX_MAP[now.getDay()];
      const todayDateStr = now.toISOString().split('T')[0];

      // 1. Check today's routine activities
      const todayActivities = (routinesByDay && routinesByDay[todayDay]) || [];
      todayActivities.forEach((act) => {
        if (act.completedToday) return; // Skip already completed activities

        // Determine effective time strictly for the currently active student
        const isVideo =
          (act.teacherVideos && act.teacherVideos.length > 0) ||
          act.activityName?.toLowerCase().includes('vídeo') ||
          act.activityName?.toLowerCase().includes('video') ||
          act.category === 'morning';
        const isAudio =
          (!act.teacherVideos || act.teacherVideos.length === 0) &&
          (Boolean(act.teacherSpotify) ||
            act.activityName?.toLowerCase().includes('áudio') ||
            act.activityName?.toLowerCase().includes('audio') ||
            act.activityName?.toLowerCase().includes('podcast') ||
            act.category === 'afternoon');

        const effectiveTime =
          isVideo && userProfile?.routineVideoTime
            ? userProfile.routineVideoTime
            : isAudio && userProfile?.routineAudioTime
            ? userProfile.routineAudioTime
            : act.time;

        const actMinutes = parseTimeToMinutes(effectiveTime);
        if (actMinutes === null) return;

        // Reminder scheduled 5 minutes before
        const alertTriggerMinutes = actMinutes - 5;
        const diff = Math.abs(currentTotalMinutes - alertTriggerMinutes);

        // Within 1-minute window
        if (diff <= 1) {
          const userEmailKey = (userProfile?.email || '').toLowerCase().trim();
          const reminderKey = `${todayDateStr}-${todayDay}-${act.id}-${effectiveTime}-${userEmailKey}`;
          if (!alertedIdsRef.current.has(reminderKey)) {
            alertedIdsRef.current.add(reminderKey);

            const title = isEn
              ? `⏰ Routine Reminder: 5 minutes left!`
              : `⏰ Lembrete de Rotina: faltam 5 minutos!`;
            const message = isEn
              ? `Your activity "${act.activityName}" is scheduled for ${formatToAmPm(
                  effectiveTime
                )}. Get ready to live your English!`
              : `Sua atividade "${act.activityName}" está prevista para às ${formatToAmPm(
                  effectiveTime
                )}. Prepare-se para viver em inglês!`;

            emitAlert({
              id: reminderKey,
              type: 'activity',
              title,
              message,
              targetTimeFormatted: formatToAmPm(effectiveTime),
              targetTimeMinutes: actMinutes,
              activityId: act.id,
              dayOfWeek: todayDay,
              timestamp: new Date().toISOString(),
            });
          }
        }
      });

      // 2. Check Daily Phrase reminder (5 minutes before dailyPhraseTime)
      const phraseMinutes = parseTimeToMinutes(phraseTime);
      if (phraseMinutes !== null) {
        const phraseTriggerMinutes = phraseMinutes - 5;
        const phraseDiff = Math.abs(currentTotalMinutes - phraseTriggerMinutes);

        if (phraseDiff <= 1) {
          const userEmailKey = (userProfile?.email || '').toLowerCase().trim();
          const phraseKey = `${todayDateStr}-phrase-${phraseTime}-${userEmailKey}`;
          if (!alertedIdsRef.current.has(phraseKey)) {
            alertedIdsRef.current.add(phraseKey);

            const title = isEn
              ? `⏰ Phrase of the Day in 5 minutes!`
              : `⏰ Frase do Dia em 5 minutos!`;
            const message = isEn
              ? `Time for your daily English challenge at ${formatToAmPm(
                  phraseTime
                )}. Keep your streak alive!`
              : `Hora de praticar sua Frase do Dia prevista para às ${formatToAmPm(
                  phraseTime
                )}. Mantenha sua constância diária!`;

            emitAlert({
              id: phraseKey,
              type: 'phrase',
              title,
              message,
              targetTimeFormatted: formatToAmPm(phraseTime),
              targetTimeMinutes: phraseMinutes,
              timestamp: new Date().toISOString(),
            });
          }
        }
      }
    };

    // Run initial check and set interval
    checkReminders();
    const intervalId = setInterval(checkReminders, 20000);
    return () => clearInterval(intervalId);
  }, [routinesByDay, phraseTime, isEn, emitAlert]);

  // Handler to dismiss an alert
  const handleDismissAlert = (id: string) => {
    setActiveAlerts((prev) => prev.filter((a) => a.id !== id));
  };

  // Handler to test the alert mechanism manually
  const handleSimulateTestAlert = () => {
    handleRequestBrowserNotification();
    const testMinutes = (new Date().getHours() * 60 + new Date().getMinutes() + 5) % 1440;
    const formattedTarget = formatMinutesToAmPm(testMinutes);

    const testReminder: ActiveReminder = {
      id: `test-${Date.now()}`,
      type: 'activity',
      title: isEn
        ? '⏰ Simulated 5-Minute Reminder'
        : '⏰ Teste de Alerta: Faltam 5 Minutos!',
      message: isEn
        ? `Upcoming scheduled activity starts at ${formattedTarget}. Time to practice your English!`
        : `Sua atividade prevista começa às ${formattedTarget}. Faltam 5 minutos para viver em inglês!`,
      targetTimeFormatted: formattedTarget,
      targetTimeMinutes: testMinutes,
      timestamp: new Date().toISOString(),
    };

    emitAlert(testReminder);
  };

  return (
    <>
      {/* 1. Floating Banner for Active 5-Minute Reminders */}
      {activeAlerts.length > 0 && (
        <div className="fixed bottom-6 right-6 z-50 max-w-sm w-full space-y-2 pointer-events-auto">
          {activeAlerts.map((alert) => (
            <div
              key={alert.id}
              className="bg-[#000035] text-white p-4 rounded-2xl shadow-2xl border-2 border-[#F4CA54] animate-bounce-short flex flex-col space-y-2.5"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl bg-[#F4CA54] text-[#000035] flex items-center justify-center font-black shrink-0">
                    <Bell className="w-4 h-4 text-[#000035] animate-pulse" />
                  </div>
                  <div>
                    <h4 className="text-xs font-black text-[#F4CA54]">{alert.title}</h4>
                    <span className="text-[10px] text-[#9AB4FF] font-mono font-bold">
                      {isEn ? `Scheduled for: ${alert.targetTimeFormatted}` : `Horário previsto: ${alert.targetTimeFormatted}`}
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => handleDismissAlert(alert.id)}
                  className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition cursor-pointer"
                  title={isEn ? 'Dismiss' : 'Dispensar'}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              <p className="text-xs text-slate-200 leading-relaxed">{alert.message}</p>

              <div className="flex items-center gap-2 pt-1 border-t border-[#1C4C96]/60">
                {alert.type === 'activity' && alert.dayOfWeek && alert.activityId && onNavigateToActivity && (
                  <button
                    type="button"
                    onClick={() => {
                      onNavigateToActivity(alert.dayOfWeek!, alert.activityId!);
                      handleDismissAlert(alert.id);
                    }}
                    className="flex-1 py-1.5 px-3 bg-[#1C4C96] hover:bg-[#607EC9] text-white rounded-xl text-xs font-bold transition flex items-center justify-center gap-1 cursor-pointer"
                  >
                    <span>{isEn ? 'Go to Activity' : 'Ir para Atividade'}</span>
                    <ArrowRight className="w-3 h-3" />
                  </button>
                )}

                {alert.type === 'phrase' && onOpenDailySentenceModal && (
                  <button
                    type="button"
                    onClick={() => {
                      onOpenDailySentenceModal();
                      handleDismissAlert(alert.id);
                    }}
                    className="flex-1 py-1.5 px-3 bg-[#1C4C96] hover:bg-[#607EC9] text-white rounded-xl text-xs font-bold transition flex items-center justify-center gap-1 cursor-pointer"
                  >
                    <Sparkles className="w-3 h-3 text-[#F4CA54]" />
                    <span>{isEn ? 'Record Phrase' : 'Registrar Frase'}</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => handleDismissAlert(alert.id)}
                  className="py-1.5 px-3 bg-white/10 hover:bg-white/20 text-slate-300 hover:text-white rounded-xl text-xs font-bold transition cursor-pointer"
                >
                  {isEn ? 'Dismiss' : 'OK'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 2. Top Sleek Status Strip: Displays configured routine schedule with AM/PM & 5-minute reminder indicator */}
      <div className="bg-gradient-to-r from-blue-50/90 via-indigo-50/70 to-slate-50 p-2.5 px-3.5 rounded-2xl border border-[#607EC9]/30 shadow-2xs flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex items-center gap-2.5 flex-wrap">
          <div className="flex items-center gap-1.5 text-xs font-black text-[#000035]">
            <Bell className="w-3.5 h-3.5 text-[#1C4C96]" />
            <span>{isEn ? 'Activity Reminders (5 min before):' : 'Lembretes de Atividades (5 min antes):'}</span>
          </div>

          <div className="flex items-center gap-2 flex-wrap text-xs">
            {/* Routine Video */}
            <div className="flex items-center gap-1 px-2 py-0.5 bg-white rounded-lg border border-[#9AB4FF]/40 text-[#000035] shadow-2xs">
              <span className="text-[10px] font-bold text-[#607EC9]">{isEn ? 'Video:' : 'Vídeo:'}</span>
              <span className="font-mono font-bold text-[#1C4C96]">{formatToAmPm(videoTime)}</span>
            </div>

            {/* Routine Audio */}
            <div className="flex items-center gap-1 px-2 py-0.5 bg-white rounded-lg border border-[#9AB4FF]/40 text-[#000035] shadow-2xs">
              <span className="text-[10px] font-bold text-[#607EC9]">{isEn ? 'Audio:' : 'Áudio:'}</span>
              <span className="font-mono font-bold text-[#1C4C96]">{formatToAmPm(audioTime)}</span>
            </div>

            {/* Daily Phrase */}
            <div className="flex items-center gap-1 px-2 py-0.5 bg-white rounded-lg border border-[#9AB4FF]/40 text-[#000035] shadow-2xs">
              <span className="text-[10px] font-bold text-[#607EC9]">{isEn ? 'Phrase:' : 'Frase:'}</span>
              <span className="font-mono font-bold text-[#1C4C96]">{formatToAmPm(phraseTime)}</span>
            </div>
          </div>
        </div>

        {/* Test Alert Button */}
        <button
          type="button"
          onClick={handleSimulateTestAlert}
          className="px-2.5 py-1 bg-white hover:bg-blue-50 text-[#1C4C96] border border-[#1C4C96]/40 rounded-xl text-[10px] font-bold transition flex items-center gap-1 cursor-pointer shadow-2xs active:scale-95"
          title={isEn ? 'Test the 5-minute reminder alert system now' : 'Testar o sistema de alerta de 5 minutos agora'}
        >
          <Volume2 className="w-3 h-3 text-[#1C4C96]" />
          <span>{isEn ? 'Test Alert' : 'Testar Alerta (5 min)'}</span>
        </button>
      </div>
    </>
  );
};
