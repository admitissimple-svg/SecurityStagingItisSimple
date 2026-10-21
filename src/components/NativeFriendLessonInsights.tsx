import React, { useState, useMemo, useEffect } from 'react';
import {
  Sparkles,
  MessageSquareQuote,
  Check,
  Copy,
  Video,
  Music,
  BookOpen,
  ShieldCheck,
  RefreshCw,
  AlertCircle,
  ExternalLink,
  Calendar,
  Clock,
  PenTool,
  CheckCircle2,
} from 'lucide-react';
import { useStudentHistory } from '../hooks/useStudentHistory';
import { DayOfWeek, StudentJournalEntry } from '../types';
import {
  subscribeToStudentJournal,
  fetchStudentJournalActivitiesFromFirestore,
  isValidCanonicalUid,
} from '../utils/studentPersistence';
import { apiClient } from '../utils/apiClient';

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
  studentLevel = 'iniciante',
  teacherUid,
  teacherEmail,
  teacherName,
  weekId = 'week-1',
  weeklyCycle = 1,
  lessons = [],
  activeLessonId,
}) => {
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [copiedAll, setCopiedAll] = useState<boolean>(false);
  const [questionVariant, setQuestionVariant] = useState<number>(0);

  // Lesson selection state for multiple scheduled sessions
  const studentLessons = useMemo(() => {
    return (lessons || []).filter((l: any) => l && l.status !== 'cancelled' && l.status !== 'canceled');
  }, [lessons]);

  // Canonical student UID resolution and local synchronization state
  const [canonicalStudentUid, setCanonicalStudentUid] = useState<string>(() => {
    if (studentUid && isValidCanonicalUid(studentUid) && studentUid !== teacherUid) return studentUid;
    const fromLesson = (lessons || []).find(
      (l: any) => l.studentUid && isValidCanonicalUid(l.studentUid) && l.studentUid !== teacherUid
    );
    if (fromLesson?.studentUid) return fromLesson.studentUid;
    return '';
  });

  useEffect(() => {
    if (studentUid && isValidCanonicalUid(studentUid) && studentUid !== teacherUid) {
      setCanonicalStudentUid(studentUid);
    } else {
      const fromLesson = (lessons || []).find(
        (l: any) => l.studentUid && isValidCanonicalUid(l.studentUid) && l.studentUid !== teacherUid
      );
      if (fromLesson?.studentUid) {
        setCanonicalStudentUid(fromLesson.studentUid);
      }
    }
  }, [studentUid, lessons, teacherUid, studentEmail]);

  const effectiveStudentUid = (canonicalStudentUid && canonicalStudentUid !== teacherUid && isValidCanonicalUid(canonicalStudentUid))
    ? canonicalStudentUid
    : (studentUid && isValidCanonicalUid(studentUid) && studentUid !== teacherUid)
      ? studentUid
      : '';

  const [selectedLessonId, setSelectedLessonId] = useState<string>(() => {
    if (activeLessonId) return activeLessonId;
    if (studentLessons.length > 0) {
      const now = new Date().toISOString();
      const upcoming = studentLessons.find((l: any) => l.startDateTime && l.startDateTime >= now);
      return upcoming?.id || studentLessons[0]?.id || '';
    }
    return '';
  });

  // Keep selectedLessonId in sync when lessons or activeLessonId change
  useEffect(() => {
    if (activeLessonId) {
      setSelectedLessonId(activeLessonId);
    } else if (studentLessons.length > 0) {
      const now = new Date().toISOString();
      const upcoming = studentLessons.find((l: any) => l.startDateTime && l.startDateTime >= now);
      const chosen = upcoming?.id || studentLessons[0]?.id || '';
      if (!selectedLessonId || !studentLessons.some((l: any) => l.id === selectedLessonId)) {
        setSelectedLessonId(chosen);
      }
    }
  }, [activeLessonId, studentLessons, selectedLessonId]);

  const effectiveLessonId = selectedLessonId || (effectiveStudentUid ? `lesson_${effectiveStudentUid}_week${weeklyCycle}` : (studentEmail ? `lesson_${studentEmail.replace(/[^a-zA-Z0-9]/g, '_')}_week${weeklyCycle}` : 'lesson_default'));

  // Pedagogical Weekly Learning Snapshot state (strictly <= 90 words, English)
  const [snapshot, setSnapshot] = useState<any | null>(null);
  const [isLoadingSnapshot, setIsLoadingSnapshot] = useState<boolean>(false);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  const [isReusedSnapshot, setIsReusedSnapshot] = useState<boolean>(false);
  const [copiedSnapshot, setCopiedSnapshot] = useState<boolean>(false);

  // Load or generate snapshot upon selecting student/lesson
  useEffect(() => {
    if (!effectiveStudentUid && !studentEmail) return;
    let isCancelled = false;

    async function loadSnapshot() {
      setIsLoadingSnapshot(true);
      setSnapshotError(null);
      try {
        // 1. Try to fetch cached snapshot first (Zero AI calls)
        const getRes = await apiClient.get('/api/lesson-insights', {
          params: {
            lessonId: effectiveLessonId,
            studentUid: effectiveStudentUid || undefined,
            studentEmail,
          },
        });

        if (isCancelled) return;

        if (getRes?.canonicalStudentUid && isValidCanonicalUid(getRes.canonicalStudentUid) && getRes.canonicalStudentUid !== teacherUid) {
          setCanonicalStudentUid(getRes.canonicalStudentUid);
        }

        if (getRes?.exists && getRes.snapshot) {
          setSnapshot(getRes.snapshot);
          setIsReusedSnapshot(true);
          setIsLoadingSnapshot(false);
          return;
        }

        // 2. If not cached, generate on-demand for this specific lesson
        const postRes = await apiClient.post('/api/lesson-insights/generate', {
          body: {
            lessonId: effectiveLessonId,
            studentUid: effectiveStudentUid || undefined,
            studentEmail,
          },
        });

        if (isCancelled) return;

        if (postRes?.canonicalStudentUid && isValidCanonicalUid(postRes.canonicalStudentUid) && postRes.canonicalStudentUid !== teacherUid) {
          setCanonicalStudentUid(postRes.canonicalStudentUid);
        }

        if (postRes?.success && postRes.snapshot) {
          setSnapshot(postRes.snapshot);
          setIsReusedSnapshot(Boolean(postRes.reused));
        } else if (postRes?.message) {
          setSnapshotError(postRes.message);
        }
      } catch (err: any) {
        if (!isCancelled) {
          console.warn('Lesson insights fetch notice:', err);
          const errorMsg = err?.data?.message || err?.message || 'Unable to generate learning snapshot at this moment. Please try again later.';
          setSnapshotError(errorMsg);
        }
      } finally {
        if (!isCancelled) {
          setIsLoadingSnapshot(false);
        }
      }
    }

    loadSnapshot();

    return () => {
      isCancelled = true;
    };
  }, [effectiveLessonId, effectiveStudentUid, studentEmail, teacherUid]);

  const handleRegenerateSnapshot = async () => {
    if ((!effectiveStudentUid && !studentEmail) || isLoadingSnapshot) return;
    setIsLoadingSnapshot(true);
    setSnapshotError(null);
    try {
      const res = await apiClient.post('/api/lesson-insights/generate', {
        body: {
          lessonId: effectiveLessonId,
          studentUid: effectiveStudentUid || undefined,
          studentEmail,
        },
      });
      if (res?.canonicalStudentUid && isValidCanonicalUid(res.canonicalStudentUid) && res.canonicalStudentUid !== teacherUid) {
        setCanonicalStudentUid(res.canonicalStudentUid);
      }
      if (res?.success && res.snapshot) {
        setSnapshot(res.snapshot);
        setIsReusedSnapshot(Boolean(res.reused));
      } else if (res?.message) {
        setSnapshotError(res.message);
      }
    } catch (err: any) {
      const errorMsg = err?.data?.message || err?.message || 'Unable to generate learning snapshot at this moment. Please try again later.';
      setSnapshotError(errorMsg);
    } finally {
      setIsLoadingSnapshot(false);
    }
  };

  const handleCopySnapshot = () => {
    if (!snapshot?.summary) return;
    navigator.clipboard.writeText(snapshot.summary);
    setCopiedSnapshot(true);
    setTimeout(() => setCopiedSnapshot(false), 2500);
  };

  // Hook for strict UID-isolated weekly history
  const {
    weeklyHistory,
    isAuthorized,
    isLoading,
    refreshHistory,
  } = useStudentHistory({
    studentUid: effectiveStudentUid || undefined,
    studentEmail,
    weekId,
    weeklyCycle,
    nativeFriendUid: teacherUid,
    nativeFriendEmail: teacherEmail,
  });

  const displayName = studentName || studentEmail.split('@')[0] || 'Student';
  const cleanLevel = (studentLevel || 'iniciante').toLowerCase();

  // Real-time subscription to studentJournal directly from student profile
  const [journalEntries, setJournalEntries] = useState<StudentJournalEntry[]>([]);

  useEffect(() => {
    if (!effectiveStudentUid && !studentEmail) return;
    fetchStudentJournalActivitiesFromFirestore(effectiveStudentUid, studentEmail).then((items) => {
      if (Array.isArray(items) && items.length > 0) {
        setJournalEntries(items);
      }
    });
    const unsub = subscribeToStudentJournal(effectiveStudentUid, studentEmail, (items) => {
      if (Array.isArray(items)) {
        setJournalEntries(items);
      }
    });
    return () => unsub();
  }, [effectiveStudentUid, studentEmail]);

  // Extract consumed media from studentJournal (Single Source of Truth) + weeklyHistory
  const consumedVideos = useMemo(() => {
    const list: Array<{ id: string; title: string; dayOfWeek?: string; watchedAt?: string }> = [];
    const seen = new Set<string>();

    // 1. From studentJournal
    journalEntries.forEach((entry) => {
      if (entry && entry.type === 'video' && entry.id) {
        if (!entry.week || entry.week === weeklyCycle) {
          const id = String(entry.id).toLowerCase();
          if (!seen.has(id)) {
            seen.add(id);
            list.push({
              id: String(entry.id),
              title: entry.title || 'Daily Routine Video',
              dayOfWeek: entry.dayOfWeek,
              watchedAt: entry.timestamp ? new Date(entry.timestamp).toISOString() : entry.date,
            });
          }
        }
      }
    });

    // 2. From weeklyHistory
    (weeklyHistory?.consumedVideoIds || []).forEach((v) => {
      if (!v) return;
      const vid = v.id || v.videoId;
      if (vid && !seen.has(String(vid).toLowerCase())) {
        seen.add(String(vid).toLowerCase());
        list.push({
          id: String(vid),
          title: v.title || v.videoTitle || 'Daily Routine Video',
          dayOfWeek: v.dayOfWeek,
          watchedAt: v.watchedAt,
        });
      }
    });

    return list;
  }, [journalEntries, weeklyHistory?.consumedVideoIds, weeklyCycle]);

  const consumedTracks = useMemo(() => {
    const list: Array<{ id: string; title: string; artist?: string; coverUrl?: string; dayOfWeek?: string }> = [];
    const seen = new Set<string>();

    // 1. From studentJournal
    journalEntries.forEach((entry) => {
      if (entry && entry.type === 'audio' && entry.id) {
        if (!entry.week || entry.week === weeklyCycle) {
          const id = String(entry.id).toLowerCase();
          if (!seen.has(id)) {
            seen.add(id);
            list.push({
              id: String(entry.id),
              title: entry.title || 'Daily Spotify Track',
              artist: entry.artist || 'Spotify Artist',
              dayOfWeek: entry.dayOfWeek,
            });
          }
        }
      }
    });

    // 2. From weeklyHistory
    (weeklyHistory?.consumedTrackIds || []).forEach((t) => {
      if (!t) return;
      const trkId = t.id || t.trackId;
      if (trkId && !seen.has(String(trkId).toLowerCase())) {
        seen.add(String(trkId).toLowerCase());
        list.push({
          id: String(trkId),
          title: t.title || 'Daily Track',
          artist: t.artist || 'Artist',
          coverUrl: t.coverUrl,
          dayOfWeek: t.dayOfWeek,
        });
      }
    });

    return list;
  }, [journalEntries, weeklyHistory?.consumedTrackIds, weeklyCycle]);

  const weeklyVocabulary = useMemo(() => {
    return weeklyHistory?.weeklyVocabulary || [];
  }, [weeklyHistory?.weeklyVocabulary]);

  // Compiled timeline of recent events from studentJournal (Single Source of Truth)
  const recentJournalSummary = useMemo(() => {
    return [...journalEntries].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)).slice(0, 8);
  }, [journalEntries]);

  // Generate 3 to 4 relaxed, non-invasive conversational questions based on student's actual weekly consumption & vocabulary
  const icebreakers = useMemo(() => {
    const list: string[] = [];

    const latestVideo = consumedVideos[consumedVideos.length - 1];
    const latestTrack = consumedTracks[consumedTracks.length - 1];
    const words = weeklyVocabulary.map((w) => w.word).filter(Boolean);

    const word1 = words[0] || (cleanLevel.includes('ini') ? 'routine' : 'breakthrough');
    const word2 = words[1] || (cleanLevel.includes('ini') ? 'habit' : 'perspective');
    const word3 = words[2] || (cleanLevel.includes('ini') ? 'focus' : 'challenge');

    const variant = questionVariant % 3;

    if (variant === 0) {
      // Set 1: Natural conversational connection with daily life
      if (latestVideo?.title) {
        list.push(
          `"Hey ${displayName}! I saw you explored '${latestVideo.title}' this week. What was the most interesting part or new idea that caught your attention?"`
        );
      } else {
        list.push(
          `"Hey ${displayName}! How has your daily English routine felt this week? Did anything special or funny happen in your routine today?"`
        );
      }

      if (latestTrack?.title) {
        list.push(
          `"You checked out '${latestTrack.title}'${latestTrack.artist ? ` by ${latestTrack.artist}` : ''} on Spotify! Do you usually listen to English music while working or when relaxing?"`
        );
      } else {
        list.push(
          `"When you listen to English music or podcasts, do you prefer paying attention to the lyrics or just letting it play in the background?"`
        );
      }

      list.push(
        `"You added the word '${word1}' to your vocabulary. In your own life, how or when do you usually experience '${word1}'?"`
      );

      list.push(
        `"If you had to describe your day today using just one sentence with '${word2}', how would you tell me?"`
      );
    } else if (variant === 1) {
      // Set 2: Fun, casual reflection
      if (latestVideo?.title) {
        list.push(
          `"If you could recommend this week's video ('${latestVideo.title}') to a close friend or colleague, who would benefit from it the most and why?"`
        );
      } else {
        list.push(
          `"What was your favorite moment of living in English this past week, even if it was just understanding a short phrase or song?"`
        );
      }

      list.push(
        `"We practiced '${word1}' and '${word2}' this week! If you had to teach one of these words to someone at work or home, how would you explain it simply?"`
      );

      if (latestTrack?.title) {
        list.push(
          `"Between listening to '${latestTrack.title}' and watching videos, which one felt easier for your ears to follow naturally?"`
        );
      } else {
        list.push(
          `"What kind of music energizes you the most when you need to recharge during a busy week?"`
        );
      }

      list.push(
        `"What is one simple goal you'd love to conquer in English before our next conversation session?"`
      );
    } else {
      // Set 3: Warm icebreaker for relaxed live chatting
      list.push(
        `"Welcome, ${displayName}! Before we jump in, tell me: what was the highlight of your week so far?"`
      );

      if (latestVideo?.title) {
        list.push(
          `"Regarding '${latestVideo.title}', did you agree with the main point of the video, or would you do things differently in your country?"`
        );
      } else {
        list.push(
          `"When you practiced your English words this week, did you have a moment where a phrase just clicked for you?"`
        );
      }

      list.push(
        `"I love the word '${word3}' that appeared in your routine. Have you ever encountered '${word3}' in movies, shows, or work meetings?"`
      );

      list.push(
        `"If we were grabbing coffee right now instead of a video call, what would be the first topic you'd want to chat about?"`
      );
    }

    return list.slice(0, 4);
  }, [consumedVideos, consumedTracks, weeklyVocabulary, cleanLevel, questionVariant, displayName]);

  const handleCopyQuestion = (text: string, index: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2500);
  };

  const handleCopyAll = () => {
    const fullText = icebreakers.join('\n\n');
    navigator.clipboard.writeText(fullText);
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 2500);
  };

  const handleShuffle = () => {
    setQuestionVariant((prev) => prev + 1);
  };

  // 1. Strict Isolation Check Failure
  if (!isAuthorized && !isLoading) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 shadow-sm">
        <div className="flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
          <div>
            <h3 className="text-sm font-bold text-amber-900">
              Access Restricted • Strict UID Isolation Active
            </h3>
            <p className="text-xs text-amber-700 mt-1">
              Student data is strictly partitioned by UID. This student is currently not assigned to your Native Friend UID ({teacherUid || 'unassigned'}).
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white border border-slate-200/90 rounded-2xl shadow-sm overflow-hidden transition-all duration-200 hover:shadow-md">
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-[#0A0F24] via-slate-900 to-indigo-950 p-5 sm:p-6 text-white border-b border-indigo-950/40">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                <ShieldCheck className="w-3.5 h-3.5" />
                UID Verified Connection
              </span>
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-white/10 text-slate-200">
                Week {weeklyCycle} ({weekId})
              </span>
            </div>
            <h2 className="text-xl font-black tracking-tight text-white flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-amber-400 shrink-0" />
              Weekly Lesson Insights & Icebreakers
            </h2>
            <p className="text-xs text-slate-300">
              Consolidated consumption & tailor-made conversational questions for your live session with{' '}
              <span className="font-semibold text-white">{displayName}</span>.
            </p>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-center">
            <button
              onClick={refreshHistory}
              title="Refresh weekly history data"
              disabled={isLoading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white/10 hover:bg-white/20 text-white transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
              Sync
            </button>
            <button
              onClick={handleShuffle}
              title="Generate alternative icebreaker questions"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border border-amber-400/30 transition-colors"
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-300" />
              Shuffle Questions
            </button>
          </div>
        </div>
      </div>

      <div className="p-5 sm:p-6 space-y-6">
        {/* ===================================================================== */}
        {/* HOTFIX PONTUAL — Weekly Learning Snapshot (Always in English, <=90 words) */}
        {/* ===================================================================== */}
        <div className="bg-gradient-to-br from-indigo-900 via-[#0A0F24] to-slate-900 border-2 border-indigo-500/40 rounded-2xl p-5 sm:p-6 text-white shadow-md relative overflow-hidden">
          {/* Background subtle decoration */}
          <div className="absolute top-0 right-0 -mr-16 -mt-16 w-64 h-64 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />

          {/* Snapshot Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-indigo-400/20">
            <div className="space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-400/20 text-amber-300 border border-amber-400/30">
                  <Sparkles className="w-3.5 h-3.5 text-amber-300" />
                  Weekly Learning Snapshot
                </span>
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-white/10 text-slate-300">
                  Always English • Max 90 words
                </span>
                {isReusedSnapshot && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                    <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                    Saved Snapshot (0 AI tokens)
                  </span>
                )}
                {snapshot?.wordCount && (
                  <span className="text-[10px] font-medium text-slate-400">
                    {snapshot.wordCount} words
                  </span>
                )}
              </div>
              <h3 className="text-base sm:text-lg font-black tracking-tight text-white">
                Live Session Overview & Icebreakers for {displayName}
              </h3>
            </div>

            {/* Lesson selector (if student has multiple lessons) + Actions */}
            <div className="flex items-center gap-2 flex-wrap self-start sm:self-center">
              {studentLessons.length > 1 && (
                <select
                  value={selectedLessonId}
                  onChange={(e) => setSelectedLessonId(e.target.value)}
                  className="bg-white/10 border border-white/20 text-white text-xs font-semibold rounded-lg px-2.5 py-1.5 focus:outline-hidden focus:ring-2 focus:ring-indigo-400"
                  title="Select which lesson session to view"
                >
                  {studentLessons.map((l: any, idx: number) => {
                    const lDate = l.date || (l.startDateTime ? l.startDateTime.split('T')[0] : `Lesson ${idx + 1}`);
                    const lTime = l.time || (l.startDateTime ? l.startDateTime.split('T')[1]?.slice(0, 5) : '');
                    return (
                      <option key={l.id || idx} value={l.id} className="bg-slate-900 text-white">
                        {lDate} {lTime ? `(${lTime})` : ''} — {l.title || 'Lesson'}
                      </option>
                    );
                  })}
                </select>
              )}

              {snapshot?.summary && (
                <button
                  type="button"
                  onClick={handleCopySnapshot}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-white/10 hover:bg-white/20 text-white border border-white/15 transition cursor-pointer"
                  title="Copy snapshot to clipboard"
                >
                  {copiedSnapshot ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="text-emerald-300">Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Copy Snapshot</span>
                    </>
                  )}
                </button>
              )}

              <button
                type="button"
                onClick={handleRegenerateSnapshot}
                disabled={isLoadingSnapshot}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border border-amber-400/30 transition cursor-pointer disabled:opacity-50"
                title="Refresh or regenerate snapshot"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoadingSnapshot ? 'animate-spin' : ''}`} />
                <span>{isLoadingSnapshot ? 'Generating...' : 'Refresh'}</span>
              </button>
            </div>
          </div>

          {/* Snapshot Content */}
          <div className="pt-4">
            {isLoadingSnapshot ? (
              <div className="py-6 flex flex-col items-center justify-center space-y-2 text-center">
                <RefreshCw className="w-6 h-6 text-amber-400 animate-spin" />
                <p className="text-xs font-semibold text-slate-300">
                  Synthesizing real videos and 5 Words studied since last lesson...
                </p>
                <p className="text-[11px] text-slate-400">
                  Strictly grounded in Firestore records • English • Max 90 words
                </p>
              </div>
            ) : snapshotError ? (
              <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-400/30 text-amber-200 text-xs flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
                  <span>{snapshotError}</span>
                </div>
                <button
                  type="button"
                  onClick={handleRegenerateSnapshot}
                  className="px-2.5 py-1 rounded bg-amber-400/20 hover:bg-amber-400/30 text-amber-200 font-bold text-[11px] cursor-pointer"
                >
                  Retry
                </button>
              </div>
            ) : snapshot?.summary ? (
              <div className="space-y-3.5">
                {/* Formatted snapshot text */}
                <div className="bg-black/30 backdrop-blur-xs border border-white/10 rounded-xl p-4 text-slate-100 text-xs sm:text-sm leading-relaxed whitespace-pre-wrap font-sans">
                  {snapshot.summary}
                </div>

                {/* Structured Pills for rapid visual scanning */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 pt-1">
                  {/* Videos & Topics */}
                  {Array.isArray(snapshot.videoTopics) && snapshot.videoTopics.length > 0 && (
                    <div className="p-3 rounded-xl bg-white/5 border border-white/10 flex flex-col justify-between">
                      <div className="flex items-center gap-1.5 text-[11px] font-bold text-[#9AB4FF] uppercase tracking-wider mb-1.5">
                        <Video className="w-3.5 h-3.5" />
                        <span>Studied Videos & Themes</span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {snapshot.videoTopics.map((top: string, i: number) => (
                          <span
                            key={i}
                            className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium bg-[#9AB4FF]/15 text-[#9AB4FF] border border-[#9AB4FF]/25"
                          >
                            {top}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Key Vocabulary */}
                  {Array.isArray(snapshot.keyVocabulary) && snapshot.keyVocabulary.length > 0 && (
                    <div className="p-3 rounded-xl bg-white/5 border border-white/10 flex flex-col justify-between">
                      <div className="flex items-center gap-1.5 text-[11px] font-bold text-amber-300 uppercase tracking-wider mb-1.5">
                        <BookOpen className="w-3.5 h-3.5" />
                        <span>Key 5 Words Vocabulary</span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {snapshot.keyVocabulary.map((word: string, i: number) => (
                          <span
                            key={i}
                            className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-bold bg-amber-400/20 text-amber-200 border border-amber-400/30"
                          >
                            {word}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="py-4 text-center">
                <p className="text-xs text-slate-300">
                  Click "Refresh" above to generate the learning snapshot for this session.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Section 1: Weekly Media & Topic Consumption */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
              <span>Topics & Media Consumed This Cycle</span>
            </h3>
            <span className="text-[11px] text-slate-400">
              Never repeated across cycles
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* 1. Videos Watched */}
            <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-4 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2 text-[#1C4C96] font-semibold text-xs">
                    <Video className="w-4 h-4" />
                    <span>YouTube Topics</span>
                  </div>
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-[#9AB4FF]/20 text-[#062863] border border-[#9AB4FF]/30">
                    {consumedVideos.length} watched
                  </span>
                </div>

                {consumedVideos.length > 0 ? (
                  <ul className="space-y-2 mt-2">
                    {consumedVideos.slice(-3).map((video, idx) => (
                      <li
                        key={video.id || idx}
                        className="text-xs text-slate-700 bg-white border border-slate-200 rounded-lg p-2 shadow-2xs"
                      >
                        <p className="font-medium line-clamp-2 text-slate-800">
                          {video.title || 'Daily Routine Video'}
                        </p>
                        {video.dayOfWeek && (
                          <span className="text-[10px] text-slate-400 uppercase tracking-wider mt-1 block">
                            {video.dayOfWeek}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-slate-400 italic py-3 text-center">
                    No videos watched yet for this cycle
                  </p>
                )}
              </div>
            </div>

            {/* 2. Spotify Songs / Audio */}
            <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-4 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2 text-emerald-600 font-semibold text-xs">
                    <Music className="w-4 h-4" />
                    <span>Spotify Song of the Day</span>
                  </div>
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                    {consumedTracks.length} tracks
                  </span>
                </div>

                {consumedTracks.length > 0 ? (
                  <ul className="space-y-2 mt-2">
                    {consumedTracks.slice(-3).map((track, idx) => (
                      <li
                        key={track.id || idx}
                        className="text-xs text-slate-700 bg-white border border-slate-200 rounded-lg p-2 shadow-2xs flex items-center gap-2"
                      >
                        {track.coverUrl ? (
                          <img
                            src={track.coverUrl}
                            alt=""
                            className="w-8 h-8 rounded object-cover shrink-0"
                            referrerPolicy="no-referrer"
                          />
                        ) : (
                          <div className="w-8 h-8 rounded bg-emerald-100 text-emerald-600 flex items-center justify-center shrink-0">
                            <Music className="w-4 h-4" />
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-slate-800 truncate">
                            {track.title || 'Daily Track'}
                          </p>
                          <p className="text-[10px] text-slate-500 truncate">
                            {track.artist || 'Artist'}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-slate-400 italic py-3 text-center">
                    No tracks logged yet for this cycle
                  </p>
                )}
              </div>
            </div>

            {/* 3. Weekly Vocabulary */}
            <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-4 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2 text-indigo-600 font-semibold text-xs">
                    <BookOpen className="w-4 h-4" />
                    <span>Learned Vocabulary</span>
                  </div>
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700">
                    {weeklyVocabulary.length} words
                  </span>
                </div>

                {weeklyVocabulary.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5 mt-2 max-h-36 overflow-y-auto pr-1">
                    {weeklyVocabulary.map((item, idx) => (
                      <span
                        key={item.id || idx}
                        title={item.translationPt || item.definitionEn || item.translation || ''}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold bg-white border border-indigo-100 text-indigo-900 shadow-2xs"
                      >
                        {item.word}
                        {item.translationPt && (
                          <span className="text-[10px] font-normal text-slate-500">
                            ({item.translationPt})
                          </span>
                        )}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-slate-400 italic py-3 text-center">
                    Vocabulary is accumulated as the student lives their daily routine
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Section 2: Recent Student Activity Log (Direct from Student Journal) */}
        <div className="border-t border-slate-100 pt-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-indigo-600" />
              <span>Recent Activity Log (Student Journal)</span>
            </h3>
            <span className="text-[11px] text-slate-400 font-medium">
              Synchronized from profile (users/{studentUid || 'student'})
            </span>
          </div>

          {recentJournalSummary.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {recentJournalSummary.map((entry, idx) => {
                const isVideo = entry.type === 'video';
                const isAudio = entry.type === 'audio';
                const isSentence = entry.type === 'sentence';
                const isMemo = entry.type === 'memorization';
                const isLive = entry.type === 'tutor_live' || entry.type === 'lesson';

                const badgeBg = isVideo
                  ? 'bg-[#9AB4FF]/20 border-[#9AB4FF]/40 text-[#062863]'
                  : isAudio
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                  : isSentence
                  ? 'bg-amber-50 border-amber-200 text-amber-800'
                  : isMemo
                  ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
                  : 'bg-blue-50 border-blue-200 text-blue-700';

                const typeLabel = isVideo
                  ? 'YouTube Video'
                  : isAudio
                  ? 'Spotify Track'
                  : isSentence
                  ? 'Sentence of the Day'
                  : isMemo
                  ? 'Memorization Part'
                  : 'Native Friend Lesson';

                return (
                  <div
                    key={entry.id || idx}
                    className="p-3 bg-slate-50/80 hover:bg-slate-50 border border-slate-200/80 rounded-xl transition flex flex-col justify-between space-y-1.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${badgeBg}`}>
                        {typeLabel}
                      </span>
                      <div className="flex items-center gap-1 text-[10px] text-slate-400 font-medium">
                        <Clock className="w-3 h-3" />
                        <span>{entry.date || (entry.timestamp ? new Date(entry.timestamp).toLocaleDateString() : '')}</span>
                        {entry.dayOfWeek && <span className="uppercase font-bold">({entry.dayOfWeek.slice(0, 3)})</span>}
                      </div>
                    </div>

                    <p className="text-xs font-semibold text-slate-800 line-clamp-2">
                      {entry.title || entry.details || (isVideo ? 'Daily Routine Video' : isAudio ? 'Daily Track' : 'Routine Activity Completed')}
                    </p>

                    {entry.details && entry.type === 'sentence' && (
                      <p className="text-[11px] text-slate-600 italic bg-white p-2 rounded-lg border border-slate-200/60 line-clamp-2">
                        "{entry.details}"
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-slate-400 italic py-3 text-center bg-slate-50 rounded-xl border border-dashed border-slate-200">
              No journal activities recorded yet for this student.
            </p>
          )}
        </div>

        {/* Section 3: Conversational Icebreakers & Engagement Prompts */}
        <div className="border-t border-slate-100 pt-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
            <div>
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <MessageSquareQuote className="w-4 h-4 text-indigo-600" />
                Live Session Icebreakers (3–4 Conversational Prompts)
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Gentle, friendly discussion starters designed to get {displayName} speaking naturally without feeling tested.
              </p>
            </div>

            <button
              onClick={handleCopyAll}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors self-start sm:self-auto shrink-0"
            >
              {copiedAll ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-600" />
                  <span className="text-emerald-700">Copied All!</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy All Questions</span>
                </>
              )}
            </button>
          </div>

          <div className="space-y-3">
            {icebreakers.map((question, index) => (
              <div
                key={index}
                className="group relative bg-slate-50/70 hover:bg-indigo-50/40 border border-slate-200/80 hover:border-indigo-200 rounded-xl p-3.5 transition-all flex items-start justify-between gap-3"
              >
                <div className="flex items-start gap-3 min-w-0">
                  <span className="w-6 h-6 rounded-full bg-indigo-100 text-indigo-700 font-bold text-xs flex items-center justify-center shrink-0 mt-0.5">
                    {index + 1}
                  </span>
                  <p className="text-xs sm:text-sm text-slate-800 font-medium leading-relaxed">
                    {question}
                  </p>
                </div>

                <button
                  onClick={() => handleCopyQuestion(question, index)}
                  title="Copy this question"
                  className="opacity-70 group-hover:opacity-100 p-1.5 rounded-md hover:bg-white text-slate-500 hover:text-indigo-600 transition-all shrink-0"
                >
                  {copiedIndex === index ? (
                    <Check className="w-4 h-4 text-emerald-600" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Footer info pill */}
        <div className="flex items-center justify-between pt-2 text-[11px] text-slate-400 border-t border-slate-100">
          <span>Student UID: <span className="font-mono text-slate-600">{effectiveStudentUid ? (effectiveStudentUid.length > 14 ? `${effectiveStudentUid.slice(0, 14)}...` : effectiveStudentUid) : (studentEmail || 'Resolving...')}</span></span>
          <span>Assigned Native Friend UID: <span className="font-mono text-slate-600">{teacherUid ? (teacherUid.length > 14 ? `${teacherUid.slice(0, 14)}...` : teacherUid) : 'Resolving...'}</span></span>
        </div>
      </div>
    </div>
  );
};
