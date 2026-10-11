import React, { useEffect } from 'react';
import {
  X,
  Sparkles,
  Calendar,
  PlaySquare,
  Video,
  HeartHandshake,
  CheckCircle2,
} from 'lucide-react';
import { Language } from '../types';
import { getHowItWorksContent } from '../data/howItWorksContent';

interface HowItWorksModalProps {
  isOpen: boolean;
  onClose: () => void;
  onGetStarted: () => void;
  currentLanguage: Language;
}

export const HowItWorksModal: React.FC<HowItWorksModalProps> = ({
  isOpen,
  onClose,
  onGetStarted,
  currentLanguage,
}) => {
  const content = getHowItWorksContent(currentLanguage);
  const isPt = currentLanguage === 'pt';

  // Handle ESC key press
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

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 md:p-6 bg-[#000020]/85 backdrop-blur-md overflow-y-auto animate-in fade-in duration-200"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="how-it-works-title"
    >
      {/* Modal Container */}
      <div
        className="relative w-full max-w-3xl bg-gradient-to-b from-[#062863] via-[#000035] to-[#000025] border border-[#607EC9]/40 rounded-3xl p-5 sm:p-7 md:p-8 shadow-[0_20px_60px_rgba(0,0,0,0.85)] text-white my-auto overflow-hidden animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Subtle Ambient Glows */}
        <div className="absolute -top-24 left-1/2 -translate-x-1/2 w-96 h-32 bg-[#1C4C96]/40 blur-3xl pointer-events-none rounded-full" />
        <div className="absolute -bottom-24 right-0 w-64 h-32 bg-[#F4CA54]/15 blur-3xl pointer-events-none rounded-full" />

        {/* Close Button 'X' */}
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 sm:top-5 sm:right-5 w-8 h-8 rounded-full bg-[#000035]/70 hover:bg-[#1C4C96] border border-[#607EC9]/40 text-[#9AB4FF] hover:text-white flex items-center justify-center transition-colors cursor-pointer z-10"
          aria-label={content.closeBtn}
        >
          <X className="w-4 h-4" />
        </button>

        {/* Modal Header */}
        <div className="relative z-10 text-left mb-5 sm:mb-6 pr-10">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#1C4C96]/50 border border-[#9AB4FF]/40 text-[#9AB4FF] text-[11px] font-extrabold shadow-xs mb-2.5 backdrop-blur-xs">
            <Sparkles className="w-3.5 h-3.5 text-[#F4CA54]" />
            <span>{content.badge}</span>
          </div>

          <h2
            id="how-it-works-title"
            className="text-xl sm:text-2xl md:text-3xl font-black text-white tracking-tight"
          >
            {content.title}
          </h2>
        </div>

        {/* Explanatory Content Body */}
        <div className="relative z-10 space-y-4 mb-6 sm:mb-7 max-h-[62vh] overflow-y-auto pr-1.5 custom-scrollbar">
          {/* Main Philosophy Card */}
          <div className="rounded-2xl bg-gradient-to-r from-[#062863]/90 to-[#000035]/90 border border-[#607EC9]/50 p-4 sm:p-5 shadow-inner">
            <p className="text-xs sm:text-[13.5px] text-blue-100/95 leading-relaxed font-normal">
              {content.p1}
            </p>
          </div>

          {/* Three Key Methodology Pillars based on the user's text */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
            {/* Pillar 1: Routine & Reminders */}
            <div className="rounded-2xl bg-[#000035]/75 border border-[#1C4C96]/60 p-4 flex flex-col justify-between hover:border-[#9AB4FF]/60 transition-colors">
              <div>
                <div className="flex items-center gap-2 mb-2.5">
                  <div className="w-7 h-7 rounded-lg bg-[#062863] border border-[#607EC9]/40 flex items-center justify-center text-[#F4CA54] shrink-0">
                    <Calendar className="w-3.5 h-3.5" />
                  </div>
                  <h3 className="text-xs sm:text-[13px] font-bold text-white leading-tight">
                    {content.pillRoutineTitle}
                  </h3>
                </div>
                <p className="text-[11.5px] sm:text-xs text-slate-300 leading-relaxed">
                  {content.p2}
                </p>
              </div>
              <div className="mt-2.5 pt-2 border-t border-[#1C4C96]/30 text-[11px] text-[#9AB4FF] font-medium leading-relaxed">
                {content.p3}
              </div>
            </div>

            {/* Pillar 2: Playlists & Freedom */}
            <div className="rounded-2xl bg-[#000035]/75 border border-[#1C4C96]/60 p-4 flex flex-col justify-between hover:border-[#9AB4FF]/60 transition-colors">
              <div>
                <div className="flex items-center gap-2 mb-2.5">
                  <div className="w-7 h-7 rounded-lg bg-[#062863] border border-[#607EC9]/40 flex items-center justify-center text-[#9AB4FF] shrink-0">
                    <PlaySquare className="w-3.5 h-3.5" />
                  </div>
                  <h3 className="text-xs sm:text-[13px] font-bold text-white leading-tight">
                    {content.pillPlaylistTitle}
                  </h3>
                </div>
                <p className="text-[11.5px] sm:text-xs text-slate-300 leading-relaxed">
                  {content.p4}
                </p>
              </div>
              <div className="mt-2.5 pt-2 border-t border-[#1C4C96]/30 flex items-center gap-1.5 text-[10.5px] text-emerald-300 font-medium">
                <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                <span>{isPt ? 'YouTube, Músicas & Podcasts' : 'YouTube, Music & Podcasts'}</span>
              </div>
            </div>

            {/* Pillar 3: Live Lessons with Native Friend */}
            <div className="rounded-2xl bg-[#000035]/75 border border-[#1C4C96]/60 p-4 flex flex-col justify-between hover:border-[#9AB4FF]/60 transition-colors">
              <div>
                <div className="flex items-center gap-2 mb-2.5">
                  <div className="w-7 h-7 rounded-lg bg-[#062863] border border-[#607EC9]/40 flex items-center justify-center text-[#F4CA54] shrink-0">
                    <Video className="w-3.5 h-3.5" />
                  </div>
                  <h3 className="text-xs sm:text-[13px] font-bold text-white leading-tight">
                    {content.pillMeetTitle}
                  </h3>
                </div>
                <p className="text-[11.5px] sm:text-xs text-slate-300 leading-relaxed">
                  {content.p5}
                </p>
              </div>
              <div className="mt-2.5 pt-2 border-t border-[#1C4C96]/30 flex items-center gap-1.5 text-[10.5px] text-[#9AB4FF] font-medium">
                <HeartHandshake className="w-3 h-3 text-[#F4CA54] shrink-0" />
                <span>{isPt ? 'Google Meet 1-a-1 flexível' : 'Flexible 1-on-1 Google Meet'}</span>
              </div>
            </div>
          </div>

          {/* Inspiring Invitation Callout */}
          <div className="rounded-2xl bg-[#1C4C96]/25 border border-[#9AB4FF]/40 p-3.5 sm:p-4 text-center">
            <p className="text-xs sm:text-sm font-bold text-[#F4CA54] leading-relaxed">
              {content.p6}
            </p>
          </div>
        </div>

        {/* Footer with Action Button */}
        <div className="relative z-10 pt-3.5 border-t border-[#1C4C96]/60 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="text-left w-full sm:w-auto">
            <span className="text-[11px] font-semibold text-slate-300 block">
              {isPt
                ? 'Pronto para viver em inglês sem complicação?'
                : 'Ready to start living in English with ease?'}
            </span>
            <span className="text-[10px] text-[#9AB4FF]">
              {isPt ? 'Comece com 1 clique • Sem compromisso' : 'Get started in 1 click • No commitment'}
            </span>
          </div>

          <div className="flex items-center gap-2.5 w-full sm:w-auto">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-transparent hover:bg-white/5 border border-white/20 text-slate-300 hover:text-white font-bold text-xs transition cursor-pointer"
            >
              {content.closeBtn}
            </button>

            <button
              type="button"
              onClick={() => {
                onClose();
                onGetStarted();
              }}
              className="flex-1 sm:flex-initial px-6 py-2.5 rounded-xl bg-gradient-to-r from-[#607EC9] via-[#1C4C96] to-[#062863] hover:from-[#9AB4FF] hover:to-[#1C4C96] text-white font-black text-xs sm:text-sm shadow-[0_0_20px_rgba(96,126,201,0.4)] hover:shadow-[0_0_25px_rgba(244,202,84,0.3)] transition-all duration-200 flex items-center justify-center gap-2 cursor-pointer active:scale-98 border border-[#9AB4FF]/50"
            >
              <span>{content.ctaBtn}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
