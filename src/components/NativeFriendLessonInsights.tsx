import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  BookOpen,
  PenTool,
  RefreshCw,
  AlertCircle,
  Copy,
  Check,
  Calendar,
  Sparkles,
  Info,
} from 'lucide-react';
import { apiClient } from '../utils/apiClient';
import { isValidCanonicalUid } from '../utils/studentPersistence';
import {
  WeeklyLearningInsightsResult,
  WeeklyLearningWord,
  WeeklyLearningSentence,
} from '../utils/weeklyLearningInsights';
import { DayOfWeek } from '../types';

interface NativeFriendLessonInsightsProps {
  studentUid: string;
  studentEmail: string;
  studentName?: string;
  studentLevel?: string;
  teacherUid: string;
  teacherEmail?: string;
  teacherName?: string;
  weekId?: string;
  weeklyCycle?: number;
  currentDayOfWeek?: DayOfWeek;
  activeStudyDays?: DayOfWeek[];
  lessons?: any[];
  activeLessonId?: string;
}

export const NativeFriendLessonInsights: React.FC<NativeFriendLessonInsightsProps> = ({
  studentUid,
  studentEmail,
  studentName,
  teacherUid,
  lessons = [],
  activeLessonId,
}) => {
  const [data, setData] = useState<WeeklyLearningInsightsResult | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Canonical student UID resolution: ensure teacher's own UID is never used as candidate
  const effectiveStudentUid = useMemo(() => {
    if (studentUid && isValidCanonicalUid(studentUid) && studentUid !== teacherUid) {
      return studentUid;
    }
    const fromLesson = (lessons || []).find(
      (l: any) => l.studentUid && isValidCanonicalUid(l.studentUid) && l.studentUid !== teacherUid
    );
    if (fromLesson?.studentUid) {
      return fromLesson.studentUid;
    }
    return '';
  }, [studentUid, teacherUid, lessons]);

  const displayName = studentName || studentEmail?.split('@')[0] || 'Student';

  // Fetch deterministic weekly insights from authoritative canonical backend
  const loadInsights = useCallback(async (isManualRefresh = false) => {
    if (!effectiveStudentUid && !studentEmail) {
      setIsLoading(false);
      setData(null);
      return;
    }

    if (!isManualRefresh) {
      // Immediate state reset: never show previous student's data while loading
      setData(null);
    }
    setIsLoading(true);
    setError(null);

    try {
      const res = await apiClient.get('/api/weekly-learning-insights', {
        params: {
          studentUid: effectiveStudentUid || undefined,
          studentEmail: studentEmail || undefined,
          lessonId: activeLessonId || undefined,
        },
      });

      if (res && res.success) {
        setData(res);
      } else {
        setError(res?.message || 'Unable to load weekly learning insights.');
      }
    } catch (err: any) {
      console.warn('Weekly learning insights fetch error:', err);
      const statusCode = err?.status || err?.response?.status;
      if (statusCode === 403) {
        setError(
          'Access Restricted: You are not authorized to view learning records for this student. (Strict pedagogical link required).'
        );
      } else {
        const errorMsg =
          err?.data?.message || err?.message || 'Unable to load learning records at this moment.';
        setError(errorMsg);
      }
    } finally {
      setIsLoading(false);
    }
  }, [effectiveStudentUid, studentEmail, activeLessonId]);

  // Reload data whenever target student or teacher changes
  useEffect(() => {
    let isMounted = true;
    if (isMounted) {
      loadInsights(false);
    }
    return () => {
      isMounted = false;
    };
  }, [loadInsights]);

  const handleCopy = (id: string, text: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const formatDateDisplay = (dateStr?: string) => {
    if (!dateStr) return '';
    try {
      const trimmed = dateStr.trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
        const [y, m, d] = trimmed.split('-').map(Number);
        const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
        return dt.toLocaleDateString('en-US', {
          timeZone: 'UTC',
          weekday: 'short',
          month: 'short',
          day: 'numeric',
        });
      }
      const parsed = new Date(trimmed);
      if (!isNaN(parsed.getTime())) {
        return parsed.toLocaleDateString('en-US', {
          timeZone: 'America/Sao_Paulo',
          weekday: 'short',
          month: 'short',
          day: 'numeric',
        });
      }
      return dateStr;
    } catch {
      return dateStr;
    }
  };

  // 1. Error / Access Denied State
  if (error && !isLoading) {
    return (
      <div className="bg-amber-50/90 border border-amber-200 rounded-2xl p-6 shadow-xs">
        <div className="flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
          <div className="space-y-1">
            <h3 className="text-sm font-bold text-amber-900">
              Access Restricted • Teacher Authorization
            </h3>
            <p className="text-xs text-amber-800 leading-relaxed">{error}</p>
            <div className="pt-2">
              <button
                type="button"
                onClick={() => loadInsights(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white border border-amber-300 text-amber-900 hover:bg-amber-100/60 transition cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Retry</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white border border-slate-200/90 rounded-2xl shadow-xs overflow-hidden transition-all duration-200">
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-[#000035] via-slate-900 to-[#1C4C96] p-5 sm:p-6 text-white border-b border-indigo-950/40">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-white/10 text-slate-200 border border-white/15">
                <Calendar className="w-3 h-3 text-[#9AB4FF]" />
                {data?.periodLabel || 'Weekly Learning Insights'}
              </span>

              {data?.isFallbackToPreviousWeek && (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-400/20 text-amber-300 border border-amber-400/30">
                  <Info className="w-3 h-3" />
                  Showing Previous Week
                </span>
              )}
            </div>

            <h2 className="text-lg sm:text-xl font-black tracking-tight text-white flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-[#9AB4FF] shrink-0" />
              <span>Weekly Learning Insights</span>
            </h2>

            <p className="text-xs text-slate-300">
              A quick look at what your student has been learning.
            </p>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-center">
            <button
              type="button"
              onClick={() => loadInsights(true)}
              disabled={isLoading}
              title="Refresh learning records from student profile"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white/10 hover:bg-white/20 text-white border border-white/15 transition cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
              <span>{isLoading ? 'Updating...' : 'Refresh'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="p-5 sm:p-6 space-y-6">
        {isLoading ? (
          <div className="py-12 flex flex-col items-center justify-center space-y-3 text-center">
            <RefreshCw className="w-6 h-6 text-[#1C4C96] animate-spin" />
            <p className="text-xs font-semibold text-slate-600">
              Loading recent learnings for {displayName}...
            </p>
            <p className="text-[11px] text-slate-400">
              Retrieving My Words and Journal Sentence records
            </p>
          </div>
        ) : data?.period === 'empty' ? (
          /* Empty State: Neither current nor previous week has activity */
          <div className="py-12 px-4 rounded-2xl bg-slate-50 border border-dashed border-slate-300 text-center space-y-2.5">
            <div className="w-10 h-10 rounded-2xl bg-slate-200/80 text-slate-500 flex items-center justify-center mx-auto">
              <BookOpen className="w-5 h-5" />
            </div>
            <h4 className="text-sm font-bold text-slate-800">
              No Learning Activity Recorded
            </h4>
            <p className="text-xs text-slate-500 max-w-md mx-auto leading-relaxed">
              {displayName} has not added new words to My Dictionary or written sentences in the Journal during the current or previous week.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Fallback Banner Notice */}
            {data?.isFallbackToPreviousWeek && (
              <div className="p-3.5 rounded-xl bg-amber-50/80 border border-amber-200/80 text-amber-900 text-xs flex items-center gap-2.5">
                <Info className="w-4 h-4 text-amber-600 shrink-0" />
                <span>
                  No entries were recorded in the current week yet. Displaying records from the previous week ({data.weekRange.formattedRange}).
                </span>
              </div>
            )}

            {/* SECTION 1 — Vocabulary Learned */}
            <div className="space-y-3">
              <div className="flex items-center justify-between border-b border-slate-200/80 pb-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-extrabold uppercase tracking-wider text-[#000035] flex items-center gap-1.5">
                    <BookOpen className="w-4 h-4 text-[#1C4C96]" />
                    <span>SECTION 1 — Vocabulary Learned</span>
                  </span>
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-[#1C4C96]/10 text-[#062863]">
                    {data?.vocabulary?.length || 0} {data?.vocabulary?.length === 1 ? 'word' : 'words'}
                  </span>
                </div>
                <span className="text-[10px] text-slate-400 font-medium hidden sm:inline">
                  From My Dictionary → My Words
                </span>
              </div>

              {data?.vocabulary && data.vocabulary.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {data.vocabulary.map((item: WeeklyLearningWord) => {
                    const isCopied = copiedId === item.id;
                    return (
                      <div
                        key={item.id}
                        className="p-3.5 bg-slate-50/70 hover:bg-white border border-slate-200/80 rounded-xl transition-all shadow-2xs space-y-2 flex flex-col justify-between"
                      >
                        <div>
                          {/* Word Header */}
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-baseline gap-2 flex-wrap">
                              <span className="text-sm font-extrabold text-[#000035]">
                                {item.word}
                              </span>
                              {item.partOfSpeech && (
                                <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md bg-[#9AB4FF]/20 text-[#062863] border border-[#9AB4FF]/30">
                                  {item.partOfSpeech}
                                </span>
                              )}
                            </div>

                            <button
                              type="button"
                              onClick={() => handleCopy(item.id, item.word)}
                              title="Copy word"
                              className="text-slate-400 hover:text-slate-600 p-1 rounded-md hover:bg-slate-100 transition cursor-pointer"
                            >
                              {isCopied ? (
                                <Check className="w-3.5 h-3.5 text-emerald-600" />
                              ) : (
                                <Copy className="w-3.5 h-3.5" />
                              )}
                            </button>
                          </div>

                          {/* Meaning */}
                          {item.meaning && (
                            <p className="text-xs text-slate-700 leading-relaxed mt-1 font-normal">
                              {item.meaning}
                            </p>
                          )}

                          {/* Example */}
                          {item.example && (
                            <p className="text-[11px] text-slate-600 italic bg-white p-2 rounded-lg border border-slate-200/70 mt-2 leading-relaxed">
                              "{item.example}"
                            </p>
                          )}
                        </div>

                        {/* Date added */}
                        {item.date && (
                          <div className="text-[10px] text-slate-400 pt-1 border-t border-slate-200/50 flex items-center justify-between">
                            <span>Learned on: {formatDateDisplay(item.date)}</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="p-4 bg-slate-50 rounded-xl border border-dashed border-slate-200 text-center">
                  <p className="text-xs text-slate-400 italic">
                    No words added to My Dictionary during this period.
                  </p>
                </div>
              )}
            </div>

            {/* SECTION 2 — Sentence Practice */}
            <div className="space-y-3 pt-2">
              <div className="flex items-center justify-between border-b border-slate-200/80 pb-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-extrabold uppercase tracking-wider text-[#000035] flex items-center gap-1.5">
                    <PenTool className="w-4 h-4 text-emerald-600" />
                    <span>SECTION 2 — Sentence Practice</span>
                  </span>
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                    {data?.sentences?.length || 0} {data?.sentences?.length === 1 ? 'sentence' : 'sentences'}
                  </span>
                </div>
                <span className="text-[10px] text-slate-400 font-medium hidden sm:inline">
                  From View Journal → Your Sentence
                </span>
              </div>

              {data?.sentences && data.sentences.length > 0 ? (
                <div className="space-y-3">
                  {data.sentences.map((sentenceItem: WeeklyLearningSentence) => {
                    const isCopied = copiedId === sentenceItem.id;
                    const textToCopy = sentenceItem.correctedSentence || sentenceItem.sentence;

                    return (
                      <div
                        key={sentenceItem.id}
                        className="p-4 bg-slate-50/70 hover:bg-white border border-slate-200/80 rounded-xl transition-all shadow-2xs space-y-2.5"
                      >
                        {/* Top Bar: Date & Copy Action */}
                        <div className="flex items-center justify-between gap-2 border-b border-slate-200/50 pb-2">
                          <span className="text-[11px] font-bold text-slate-500 flex items-center gap-1">
                            <Calendar className="w-3.5 h-3.5 text-slate-400" />
                            <span>{formatDateDisplay(sentenceItem.date) || 'Recent Session'}</span>
                          </span>

                          <button
                            type="button"
                            onClick={() => handleCopy(sentenceItem.id, textToCopy)}
                            className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-500 hover:text-slate-800 p-1 rounded-md hover:bg-slate-100 transition cursor-pointer"
                            title="Copy sentence"
                          >
                            {isCopied ? (
                              <>
                                <Check className="w-3.5 h-3.5 text-emerald-600" />
                                <span className="text-emerald-700">Copied</span>
                              </>
                            ) : (
                              <>
                                <Copy className="w-3.5 h-3.5" />
                                <span>Copy</span>
                              </>
                            )}
                          </button>
                        </div>

                        {/* Student Original Sentence */}
                        <div className="space-y-1">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                            Student's Original Sentence:
                          </span>
                          <p className="text-xs sm:text-sm text-slate-800 font-medium bg-white p-3 rounded-lg border border-slate-200/70 leading-relaxed">
                            "{sentenceItem.sentence}"
                          </p>
                        </div>

                        {/* AI Pedagogical Polish (if existing) */}
                        {sentenceItem.correctedSentence && (
                          <div className="bg-[#EFF6FF] rounded-lg p-3 border border-[#9AB4FF]/50 space-y-1">
                            <span className="text-[10px] font-extrabold uppercase tracking-wider text-[#1C4C96] flex items-center gap-1">
                              <Sparkles className="w-3 h-3 text-[#1C4C96]" />
                              <span>AI Pedagogical Polish:</span>
                            </span>
                            <p className="text-xs sm:text-sm text-[#000035] font-semibold leading-relaxed">
                              "{sentenceItem.correctedSentence}"
                            </p>
                          </div>
                        )}

                        {/* Pedagogical Explanation (if existing) */}
                        {sentenceItem.explanation && (
                          <div className="text-[11px] text-slate-600 bg-white p-2.5 rounded-lg border border-slate-200/60 leading-relaxed font-sans">
                            <span className="font-bold text-slate-700">Feedback: </span>
                            {sentenceItem.explanation}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="p-4 bg-slate-50 rounded-xl border border-dashed border-slate-200 text-center">
                  <p className="text-xs text-slate-400 italic">
                    No sentences recorded in the Journal during this period.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Footer info pill */}
        <div className="flex items-center justify-between pt-3 text-[11px] text-slate-400 border-t border-slate-100">
          <span>
            Student UID: <span className="font-mono text-slate-600">{effectiveStudentUid ? `${effectiveStudentUid.slice(0, 12)}...` : 'N/A'}</span>
          </span>
          <span>Source: My Words & View Journal</span>
        </div>
      </div>
    </div>
  );
};
