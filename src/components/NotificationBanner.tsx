import React from 'react';
import { X, Play, Bell, GraduationCap, PenTool } from 'lucide-react';
import { RoutineItem } from '../types';

export interface ActiveNotificationData {
  type: 'activity' | 'end_of_day';
  item?: RoutineItem;
  title: string;
  message: string;
  leadTimeBadge: string;
}

interface NotificationBannerProps {
  activeNotification?: ActiveNotificationData | null;
  onClose?: () => void;
  onOpenLesson?: (item: RoutineItem) => void;
  onOpenEndOfDay?: () => void;
  notifications?: Array<{ id: string; title: string; message: string; type?: string }>;
  onDismiss?: (id: string) => void;
}

export const NotificationBanner: React.FC<NotificationBannerProps> = ({
  activeNotification,
  onClose,
  onOpenLesson,
  onOpenEndOfDay,
  notifications,
  onDismiss,
}) => {
  const filteredNotifications = (notifications || []).filter((n) => {
    const id = (n.id || '').toLowerCase();
    const title = (n.title || '').toLowerCase();
    // Exclude login/welcome and logout banners
    if (id.startsWith('login-') || id.startsWith('logout-')) return false;
    if (
      title.includes('welcome') ||
      title.includes('bem-vindo') ||
      title.includes('logged out') ||
      title.includes('sessão encerrada') ||
      title.includes('sessao encerrada')
    ) {
      return false;
    }
    return true;
  });

  if (filteredNotifications && filteredNotifications.length > 0) {
    const latest = filteredNotifications[0];
    return (
      <div className="fixed bottom-4 right-4 z-50 max-w-md w-full animate-in slide-in-from-bottom-5 duration-300 p-2 sm:p-0">
        <div className="bg-[#000035] text-white rounded-3xl p-4 sm:p-5 shadow-2xl border-2 border-[#1C4C96] flex flex-col gap-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-[#1C4C96] text-white flex items-center justify-center font-bold shrink-0 border border-[#607EC9]">
                <Bell className="w-4 h-4 text-[#9AB4FF]" />
              </div>
              <div>
                <h4 className="text-sm font-black text-white leading-tight">{latest.title}</h4>
              </div>
            </div>
            {onDismiss && (
              <button
                onClick={() => onDismiss(latest.id)}
                className="text-slate-400 hover:text-white p-1 rounded-lg transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          <p className="text-xs text-slate-300">{latest.message}</p>
        </div>
      </div>
    );
  }

  if (!activeNotification) return null;

  const { type, item, title, message, leadTimeBadge } = activeNotification;
  const isEndOfDay = type === 'end_of_day';

  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-md w-full animate-in slide-in-from-bottom-5 duration-300 p-2 sm:p-0">
      <div className="bg-[#000035] text-white rounded-3xl p-4 sm:p-5 shadow-2xl border-2 border-[#1C4C96] flex flex-col gap-3">
        {/* Top Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-[#1C4C96] text-white flex items-center justify-center font-bold animate-pulse shrink-0 border border-[#607EC9]">
              {isEndOfDay ? <PenTool className="w-4 h-4 text-[#9AB4FF]" /> : <Bell className="w-4 h-4 text-[#9AB4FF]" />}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-[#9AB4FF]">
                  {isEndOfDay ? 'Revisão do Dia' : 'Lembrete de Rotina'}
                </span>
                <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-[#1C4C96] text-white">
                  {leadTimeBadge}
                </span>
              </div>
              <h4 className="text-sm font-bold text-white line-clamp-1">{title}</h4>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1 text-[#9AB4FF] hover:text-white rounded-lg transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Message */}
        <p className="text-xs text-[#9AB4FF]/90 leading-relaxed">{message}</p>

        {/* Teacher video info if standard activity */}
        {item && item.teacherVideos && item.teacherVideos.length > 0 && (
          <div className="flex items-center gap-1.5 text-[11px] text-[#9AB4FF] bg-[#062863] px-2.5 py-1 rounded-xl border border-[#1C4C96]">
            <GraduationCap className="w-3.5 h-3.5 text-[#9AB4FF]" />
            <span>
              {item.teacherVideos.length} vídeo(s) do YouTube indicado(s) pelo professor para este momento
            </span>
          </div>
        )}

        {/* CTA Buttons */}
        <div className="flex items-center gap-2 pt-1">
          {isEndOfDay ? (
            <button
              onClick={() => {
                onOpenEndOfDay?.();
                onClose?.();
              }}
              className="flex-1 py-2.5 bg-[#1C4C96] hover:bg-[#607EC9] text-white text-xs font-bold rounded-xl transition shadow-xs flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <PenTool className="w-3.5 h-3.5 text-[#9AB4FF]" />
              Escrever Frase do Dia
            </button>
          ) : (
            item && (
              <button
                onClick={() => {
                  onOpenLesson?.(item);
                  onClose?.();
                }}
                className="flex-1 py-2.5 bg-[#1C4C96] hover:bg-[#607EC9] text-white text-xs font-bold rounded-xl transition shadow-xs flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Play className="w-3.5 h-3.5 fill-current text-[#9AB4FF]" />
                Assistir Vídeo Agora
              </button>
            )
          )}

          <button
            onClick={onClose}
            className="px-3.5 py-2.5 bg-[#062863] hover:bg-[#000035] text-[#9AB4FF] text-xs font-semibold rounded-xl transition cursor-pointer border border-[#1C4C96]"
          >
            Dispensar
          </button>
        </div>
      </div>
    </div>
  );
};
