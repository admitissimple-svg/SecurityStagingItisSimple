import React, { useState } from 'react';
import {
  Calendar,
  Clock,
  Video,
  User,
  AlertTriangle,
  Settings,
  CalendarPlus,
  RefreshCw,
  ExternalLink,
  ChevronRight,
  Filter,
  Check,
  X,
  RotateCcw,
  MinusCircle,
  Sparkles,
  Globe,
  Edit3,
  Trash2,
  BookOpen,
  Headphones,
} from 'lucide-react';
import { LiveLesson, GoogleAccount, TeacherMeetSettings, DayOfWeek, Language, NativeFriendTutor } from '../types';
import { Translations } from '../utils/i18n';
import {
  formatDateInTimeZone,
  formatTimeInTimeZone,
  getTimezoneDisplayLabel,
  generate30MinTimeSlots,
  DEFAULT_TEACHER_TIMEZONE,
} from '../utils/timezone';
import { CancelLessonModal } from './CancelLessonModal';
import { generateGoogleCalendarWebLink } from '../utils/calendar';

interface TeacherScheduleControlTableProps {
  lessons: LiveLesson[];
  teachers: GoogleAccount[];
  students: GoogleAccount[];
  teacherMeetSettings: Record<string, TeacherMeetSettings>;
  currentAccount: GoogleAccount | null;
  tutorProfile?: NativeFriendTutor;
  selectedStudentFilter?: string;
  onSelectStudentFilter?: (studentEmail: string) => void;
  activeStudentActivity?: 'insights' | 'notes' | 'videos_songs' | null;
  onSelectStudentActivity?: (activity: 'insights' | 'notes' | 'videos_songs') => void;
  onOpenScheduleModal?: () => void;
  onOpenTeacherMeetConfig: (teacherEmail: string) => void;
  onOpenEditProfile?: () => void;
  onCompleteLesson: (lessonId: string) => void;
  onMarkNotCompleted: (lesson: LiveLesson) => void;
  onRescheduleLesson: (lesson: LiveLesson) => void;
  onCancelLesson?: (
    lessonId: string,
    reason?: string,
    cancelledBy?: 'student' | 'teacher'
  ) => void;
  onAcceptReschedule?: (lessonId: string) => void;
  onDeclineReschedule?: (lessonId: string) => void;
  currentLanguage: Language;
  t: Translations;
  timeZone?: string;
}

export const TeacherScheduleControlTable: React.FC<TeacherScheduleControlTableProps> = ({
  lessons,
  teachers,
  students,
  teacherMeetSettings,
  currentAccount,
  tutorProfile,
  selectedStudentFilter: controlledStudentFilter,
  onSelectStudentFilter,
  activeStudentActivity,
  onSelectStudentActivity,
  onOpenScheduleModal,
  onOpenTeacherMeetConfig,
  onOpenEditProfile,
  onCompleteLesson,
  onMarkNotCompleted,
  onRescheduleLesson,
  onCancelLesson,
  onAcceptReschedule,
  onDeclineReschedule,
  currentLanguage,
  t,
  timeZone = DEFAULT_TEACHER_TIMEZONE,
}) => {
  const isEn = currentLanguage === 'en';
  const [lessonToCancel, setLessonToCancel] = useState<LiveLesson | null>(null);

  const handleCancelClick = (lesson: LiveLesson) => {
    setLessonToCancel(lesson);
  };
  const [internalStudentFilter, setInternalStudentFilter] = useState<string>('all');
  const selectedStudentFilter = controlledStudentFilter !== undefined ? controlledStudentFilter : internalStudentFilter;

  const handleStudentFilterChange = (val: string) => {
    if (onSelectStudentFilter) {
      onSelectStudentFilter(val);
    } else {
      setInternalStudentFilter(val);
    }
  };

  const [selectedStatusFilter, setSelectedStatusFilter] = useState<string>('active');
  const [selectedTeacherFilter, setSelectedTeacherFilter] = useState<string>('all');

  const availableStudentsForFilter = React.useMemo(() => {
    const map = new Map<string, { email: string; name: string }>();
    const teacherEmailClean = (currentAccount?.email || '').toLowerCase().trim();
    const currentTeacherUid = (currentAccount?.id || (currentAccount as any)?.uid || '').trim();
    const currentTeacherName = (currentAccount?.name || tutorProfile?.name || '').toLowerCase().trim();
    const isTeacher = currentAccount ? (currentAccount.role === 'teacher' || currentAccount.role === 'admin') : false;

    const adminEmails = [
      'adm.itissimple@gmail.com',
      'adm.itssimple@gmail.com',
    ];

    const isMatchingTeacher = (sTeacherEmail?: string, sTeacherUid?: string, sTeacherName?: string) => {
      const cleanSTeacher = (sTeacherEmail || '').toLowerCase().trim();
      const cleanSTeacherUid = (sTeacherUid || '').trim();
      const cleanSTeacherName = (sTeacherName || '').toLowerCase().trim();

      if (currentTeacherUid && cleanSTeacherUid && currentTeacherUid === cleanSTeacherUid) return true;
      if (teacherEmailClean && cleanSTeacher && teacherEmailClean === cleanSTeacher) return true;

      // Check admin aliases
      if (adminEmails.includes(teacherEmailClean) && adminEmails.includes(cleanSTeacher)) return true;
      if (adminEmails.includes(teacherEmailClean) && cleanSTeacherName.includes('simple')) return true;
      if (currentTeacherName.includes('simple') && (adminEmails.includes(cleanSTeacher) || cleanSTeacherName.includes('simple'))) return true;

      // Both active production students are assigned to Teacher Re (estilobeeforkids@gmail.com)
      if (teacherEmailClean === 'estilobeeforkids@gmail.com' || adminEmails.includes(teacherEmailClean)) {
        return true;
      }

      return false;
    };

    (students || []).forEach((st) => {
      const email = (st.email || (st as any).studentEmail || '').toLowerCase().trim();
      const name = st.name || (st as any).studentName || email.split('@')[0];
      const stTeacher = ((st as any).teacherEmail || '').toLowerCase().trim();
      const stTeacherUid = ((st as any).teacherUid || '').trim();
      const stTeacherName = ((st as any).teacherName || '').toLowerCase().trim();
      const stStatus = (st as any).status || (st as any).enrollmentStatus;

      if (!email) return;

      // Strictly filter out cancelled or unenrolled students
      if (stStatus === 'cancelled' || stStatus === 'not_enrolled') return;

      // If viewing as teacher/admin, must match teacher
      if (isTeacher) {
        if (!isMatchingTeacher(stTeacher, stTeacherUid, stTeacherName)) return;
      }

      map.set(email, { email, name });
    });

    // Also include students with active scheduled lessons or trial lessons for this teacher
    (lessons || []).forEach((l) => {
      const email = (l.studentEmail || '').toLowerCase().trim();
      const name = l.studentName || email.split('@')[0];
      const lTeacherEmail = (l.teacherEmail || (l as any).tutorEmail || '').toLowerCase().trim();
      const lTeacherUid = (l.teacherUid || (l as any).tutorUid || '').trim();
      const lTeacherName = (l.teacherName || '').toLowerCase().trim();

      if (!email) return;

      if (isTeacher) {
        if (!isMatchingTeacher(lTeacherEmail, lTeacherUid, lTeacherName)) return;
      }

      // Check if this student is explicitly unenrolled or cancelled in students array
      const knownStudent = (students || []).find(
        (s) => (s.email || (s as any).studentEmail || '').toLowerCase().trim() === email
      );
      if (knownStudent) {
        const kStatus = (knownStudent as any).status || (knownStudent as any).enrollmentStatus;
        if (kStatus === 'cancelled' || kStatus === 'not_enrolled') return;
      }

      const isLessonScheduledOrTrial =
        l.status === 'scheduled' ||
        (l.status as string) === 'trial_lesson' ||
        (l.status as string) === 'trial' ||
        (l.status as string) === 'free_trial' ||
        (l.status as string) === 'pending' ||
        (l as any).isTrial ||
        l.title?.toLowerCase().includes('trial');

      if (email && !map.has(email) && isLessonScheduledOrTrial) {
        map.set(email, { email, name });
      }
    });

    return Array.from(map.values());
  }, [students, lessons, currentAccount, tutorProfile]);

  const sortedLessons = [...lessons].sort((a, b) => {
    return new Date(a.startDateTime).getTime() - new Date(b.startDateTime).getTime();
  });

  const filteredLessons = sortedLessons.filter((lesson) => {
    const isTeacher = currentAccount?.role === 'teacher';
    const teacherEmailClean = (currentAccount?.email || '').toLowerCase().trim();
    const currentTeacherUid = (currentAccount?.id || (currentAccount as any)?.uid || '').trim();

    if (isTeacher) {
      const lTeacherEmail = (lesson.teacherEmail || (lesson as any).tutorEmail || '').toLowerCase().trim();
      const lTeacherUid = (lesson.teacherUid || (lesson as any).tutorUid || '').trim();
      const isMyLesson =
        (currentTeacherUid && lTeacherUid && currentTeacherUid === lTeacherUid) ||
        (teacherEmailClean && lTeacherEmail && teacherEmailClean === lTeacherEmail);
      if (!isMyLesson) return false;
    } else if (selectedTeacherFilter !== 'all') {
      const lTeacherEmail = (lesson.teacherEmail || (lesson as any).tutorEmail || '').toLowerCase().trim();
      const lTeacherUid = (lesson.teacherUid || (lesson as any).tutorUid || '').trim();
      const filterEmail = selectedTeacherFilter.toLowerCase().trim();
      if (lTeacherEmail !== filterEmail && lTeacherUid !== filterEmail) return false;
    }

    if (selectedStudentFilter !== 'all') {
      const filterEmail = selectedStudentFilter.toLowerCase().trim();
      const lStudentEmail = (lesson.studentEmail || '').toLowerCase().trim();
      if (lStudentEmail !== filterEmail) {
        return false;
      }
    }
    if (selectedStatusFilter !== 'all') {
      if (selectedStatusFilter === 'active') {
        if (
          lesson.status === 'cancelled' ||
          lesson.status === 'completed' ||
          lesson.status === 'not_completed'
        ) {
          return false;
        }
        const isActiveOrScheduledOrTrial =
          lesson.status === 'scheduled' ||
          lesson.status === 'trial_lesson' ||
          lesson.status === 'trial' ||
          lesson.status === 'free_trial' ||
          lesson.status === 'pending' ||
          lesson.status === 'active' ||
          (lesson as any).isTrial ||
          lesson.title?.toLowerCase().includes('trial');
        if (!isActiveOrScheduledOrTrial) return false;
      } else if (lesson.status !== selectedStatusFilter) {
        return false;
      }
    }
    return true;
  });

  const teacherEmailKey = (currentAccount?.email || '').toLowerCase().trim();
  const rawSettings =
    teacherMeetSettings[teacherEmailKey] ||
    (currentAccount?.uid ? teacherMeetSettings[currentAccount.uid] : undefined);

  const resolvedTutorTz =
    tutorProfile?.timezone ||
    (rawSettings?.timezone && rawSettings.timezone !== 'America/Sao_Paulo' ? rawSettings.timezone : undefined) ||
    timeZone ||
    DEFAULT_TEACHER_TIMEZONE;

  const activeTeacherSettings: TeacherMeetSettings = rawSettings
    ? { ...rawSettings, timezone: rawSettings.timezone || resolvedTutorTz }
    : {
        teacherEmail: teacherEmailKey,
        meetLink: tutorProfile?.meetUrl || 'https://meet.google.com/new',
        workingHoursStart: '08:00',
        workingHoursEnd: '18:00',
        slotDurationMinutes: 30,
        availableDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'],
        timezone: resolvedTutorTz,
      };

  const displayedTutorProfile = React.useMemo(() => {
    if (selectedTeacherFilter !== 'all') {
      const match = teachers.find(
        (tch) => (tch.email || '').toLowerCase().trim() === selectedTeacherFilter.toLowerCase().trim()
      );
      if (match) {
        return {
          id: match.id || `tutor-${match.email}`,
          name: match.name,
          email: match.email,
          avatar: match.picture || match.avatar || '',
          headline: (match as any).headline || 'Native Friend',
          bio: (match as any).bio || '',
          timezone: (match as any).timezone || resolvedTutorTz,
          meetUrl: (match as any).meetUrl || (match as any).meetLink || '',
        } as NativeFriendTutor;
      }
    }
    return tutorProfile;
  }, [selectedTeacherFilter, teachers, tutorProfile, resolvedTutorTz]);

  return (
    <div className="bg-white rounded-2xl border border-[#607EC9]/30 shadow-xs p-3.5 sm:p-5 space-y-4" id="teacher-schedule-control-table">
      {/* 🌟 Native Friend Profile Card */}
      {displayedTutorProfile && (
        <div className="bg-gradient-to-r from-[#000035] via-[#062863] to-[#1C4C96] rounded-2xl p-4 sm:p-5 text-white border border-[#9AB4FF]/40 shadow-sm flex items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl overflow-hidden border-2 border-[#F4CA54] shrink-0 bg-white/10 shadow-md flex items-center justify-center">
              {displayedTutorProfile.avatar && displayedTutorProfile.avatar.trim() !== '' ? (
                <img
                  src={displayedTutorProfile.avatar}
                  alt={displayedTutorProfile.name}
                  className="w-full h-full object-cover"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <span className="font-black text-lg sm:text-xl text-white">
                  {displayedTutorProfile.name?.slice(0, 2).toUpperCase() || 'NF'}
                </span>
              )}
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-base sm:text-lg font-black text-white">
                  {displayedTutorProfile.name}
                </h2>
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-[#1C4C96]/60 text-[#F4CA54] border border-[#9AB4FF]/30 flex items-center gap-1">
                  <Globe className="w-3 h-3 text-[#F4CA54]" />
                  <span>{getTimezoneDisplayLabel(displayedTutorProfile.timezone || resolvedTutorTz, 'en')}</span>
                </span>
              </div>
              {(displayedTutorProfile.headline || displayedTutorProfile.bio) && (
                <p className="text-xs text-white/90 line-clamp-1 mt-0.5 max-w-xl">
                  {displayedTutorProfile.headline || displayedTutorProfile.bio}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Header (100% English) */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#9AB4FF]/25 pb-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-[#062863] text-white flex items-center justify-center border border-[#1C4C96] shadow-2xs shrink-0">
            <Calendar className="w-4 h-4 text-[#9AB4FF]" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-black text-sm sm:text-base text-[#000035] tracking-tight">
                Native Friend Master Schedule Control
              </h3>
            </div>
            <p className="text-xs text-slate-500">
              Chronological schedule of all your 1-on-1 English practice sessions.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap shrink-0">
          {onOpenScheduleModal && (
            <button
              type="button"
              onClick={onOpenScheduleModal}
              className="px-3.5 py-1.5 bg-[#062863] hover:bg-[#000035] text-white rounded-xl text-xs font-black transition flex items-center gap-1.5 cursor-pointer shadow-xs border border-[#9AB4FF]/30"
            >
              <CalendarPlus className="w-3.5 h-3.5 text-[#F4CA54]" />
              <span>+ Schedule Lesson</span>
            </button>
          )}

          {onOpenEditProfile && (
            <button
              type="button"
              onClick={onOpenEditProfile}
              className="px-3 py-1.5 bg-white hover:bg-slate-100 text-[#000035] rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-2xs border border-[#607EC9]/40"
            >
              <Edit3 className="w-3.5 h-3.5 text-[#1C4C96]" />
              <span>Edit My Profile</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => onOpenTeacherMeetConfig(currentAccount?.email || '')}
            className="px-3 py-1.5 bg-white hover:bg-[#9AB4FF]/15 border border-[#607EC9]/40 rounded-xl text-xs font-bold text-[#062863] transition flex items-center gap-1.5 cursor-pointer shadow-2xs"
          >
            <Settings className="w-3.5 h-3.5 text-[#1C4C96]" />
            <span>Meet & Schedule Config</span>
          </button>
        </div>
      </div>

      {/* Filters Bar (100% English) */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 bg-[#9AB4FF]/10 rounded-2xl border border-[#607EC9]/30">
        <div className="flex items-center gap-2 flex-wrap">
          <Filter className="w-3.5 h-3.5 text-[#1C4C96]" />

          {/* Teacher selector for Admins */}
          {currentAccount?.role === 'admin' && teachers.length > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-bold text-[#000035]">
                Native Friend:
              </span>
              <select
                value={selectedTeacherFilter}
                onChange={(e) => setSelectedTeacherFilter(e.target.value)}
                className="px-3 py-1.5 bg-white border border-[#607EC9]/40 rounded-xl text-xs font-semibold text-[#000035] focus:outline-hidden focus:ring-2 focus:ring-[#1C4C96]"
              >
                <option value="all">All Native Friends</option>
                {teachers.map((tch) => (
                  <option key={tch.email} value={tch.email}>
                    {tch.name} ({tch.email})
                  </option>
                ))}
              </select>
            </div>
          )}

          <span className="text-xs font-bold text-[#000035]">
            Filter by Student:
          </span>
          <select
            value={selectedStudentFilter}
            onChange={(e) => handleStudentFilterChange(e.target.value)}
            className="px-3 py-1.5 bg-white border border-[#607EC9]/40 rounded-xl text-xs font-semibold text-[#000035] focus:outline-hidden focus:ring-2 focus:ring-[#1C4C96]"
          >
            <option value="all">All Students</option>
            {availableStudentsForFilter.map((st) => (
              <option key={st.email} value={st.email}>
                {st.name} ({st.email})
              </option>
            ))}
          </select>

          {selectedStudentFilter !== 'all' && (
            <div className="flex items-center gap-1.5 ml-1 flex-wrap">
              <button
                type="button"
                onClick={() => {
                  onSelectStudentActivity?.('insights');
                  const el = document.getElementById('student-activity-section');
                  if (el) el.scrollIntoView({ behavior: 'smooth' });
                }}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
                  activeStudentActivity === 'insights'
                    ? 'bg-[#000035] text-white shadow-xs ring-1 ring-[#000035]'
                    : 'bg-white hover:bg-slate-50 text-[#000035] border border-slate-200'
                }`}
                title="View Lessons Insights and Icebreaker Topics"
              >
                <Sparkles className="w-3.5 h-3.5 text-amber-300" />
                <span>Insights & Icebreaks</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  onSelectStudentActivity?.('notes');
                  const el = document.getElementById('student-activity-section');
                  if (el) el.scrollIntoView({ behavior: 'smooth' });
                }}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
                  activeStudentActivity === 'notes'
                    ? 'bg-[#000035] text-white shadow-xs ring-1 ring-[#000035]'
                    : 'bg-white hover:bg-slate-50 text-[#000035] border border-slate-200'
                }`}
                title="View Live Lesson Notes"
              >
                <BookOpen className="w-3.5 h-3.5" />
                <span>Live Lesson Notes</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  onSelectStudentActivity?.('videos_songs');
                  const el = document.getElementById('student-activity-section');
                  if (el) el.scrollIntoView({ behavior: 'smooth' });
                }}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
                  activeStudentActivity === 'videos_songs'
                    ? 'bg-[#000035] text-white shadow-xs ring-1 ring-[#000035]'
                    : 'bg-white hover:bg-slate-50 text-[#000035] border border-slate-200'
                }`}
                title="View Videos and Spotify Songs"
              >
                <Video className="w-3.5 h-3.5" />
                <span>Videos & Songs</span>
              </button>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-bold text-[#000035]">
            Status:
          </span>
          <select
            value={selectedStatusFilter}
            onChange={(e) => setSelectedStatusFilter(e.target.value)}
            className="px-3 py-1.5 bg-white border border-[#607EC9]/40 rounded-xl text-xs font-semibold text-[#000035] focus:outline-hidden focus:ring-2 focus:ring-[#1C4C96]"
          >
            <option value="active">Active</option>
            <option value="completed">Completed</option>
            <option value="not_completed">Not Completed</option>
            <option value="cancelled">Cancelled</option>
            <option value="all">All Statuses</option>
          </select>
        </div>
      </div>

      {/* Table with Student PHOTO column & Sorted Chronologically */}
      <div className="overflow-x-auto rounded-2xl border border-[#607EC9]/30 shadow-xs">
        <table className="w-full text-left text-xs text-[#000035]">
          <thead className="bg-[#000035] text-white uppercase text-[10px] font-black tracking-wider">
            <tr>
              <th className="p-3.5">DATE & TIME</th>
              <th className="p-3.5">PHOTO</th>
              <th className="p-3.5">STUDENT</th>
              <th className="p-3.5">LESSON TITLE</th>
              <th className="p-3.5">STATUS</th>
              <th className="p-3.5 text-right">ACTIONS</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#9AB4FF]/20 bg-white">
            {filteredLessons.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-8 text-center text-slate-500 font-medium">
                  No lessons matching selected filters.
                </td>
              </tr>
            ) : (
              filteredLessons.map((lesson) => {
                const isCancelled = lesson.status === 'cancelled';
                const isCompleted = lesson.status === 'completed';
                const isNotCompleted = lesson.status === 'not_completed';
                const isTrial =
                  !isCancelled &&
                  !isCompleted &&
                  !isNotCompleted &&
                  ((lesson.status as string) === 'trial_lesson' ||
                    (lesson.status as string) === 'trial' ||
                    (lesson.status as string) === 'free_trial' ||
                    (lesson as any).isTrial ||
                    lesson.title?.toLowerCase().includes('trial'));
                const isScheduled =
                  !isCancelled &&
                  !isCompleted &&
                  !isNotCompleted &&
                  !isTrial;

                // Look up student photo
                const studentData = students.find(
                  (s) => s.email.toLowerCase() === lesson.studentEmail.toLowerCase()
                );
                const studentPhoto =
                  studentData?.picture ||
                  lesson.studentAvatar ||
                  '';

                return (
                  <tr key={lesson.id} className="hover:bg-[#9AB4FF]/10 transition">
                    {/* Date & Time */}
                    <td className="p-3.5 whitespace-nowrap font-bold text-[#062863]">
                      <div className="flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 text-[#1C4C96]" />
                        <span>
                          {formatDateInTimeZone(lesson.startDateTime, timeZone, 'en')} •{' '}
                          {formatTimeInTimeZone(lesson.startDateTime, timeZone)} -{' '}
                          {formatTimeInTimeZone(lesson.endDateTime, timeZone)}
                        </span>
                        {lesson.endDateTime && (
                          <span className="ml-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-[#1C4C96]/10 text-[#1C4C96]">
                            {Math.round((new Date(lesson.endDateTime).getTime() - new Date(lesson.startDateTime).getTime()) / (60 * 1000)) >= 45 ? '50m' : '25m'}
                          </span>
                        )}
                      </div>
                    </td>

                    {/* PHOTO Column */}
                    <td className="p-3.5 whitespace-nowrap">
                      <div className="relative inline-block">
                        {studentPhoto && studentPhoto.trim() !== '' ? (
                          <img
                            src={studentPhoto}
                            alt={lesson.studentName}
                            referrerPolicy="no-referrer"
                            className="w-9 h-9 rounded-full object-cover border-2 border-[#1C4C96]/30 shadow-xs"
                            onError={(e) => {
                              (e.target as HTMLElement).style.display = 'none';
                            }}
                          />
                        ) : (
                          <div className="w-9 h-9 rounded-full bg-[#1C4C96]/20 border border-[#1C4C96]/40 flex items-center justify-center font-bold text-xs text-[#062863]">
                            {lesson.studentName?.slice(0, 2).toUpperCase() || 'ST'}
                          </div>
                        )}
                      </div>
                    </td>

                    {/* Student Info */}
                    <td className="p-3.5 whitespace-nowrap">
                      <div className="font-bold text-[#000035]">{lesson.studentName}</div>
                      <div className="text-[11px] text-[#607EC9]">{lesson.studentEmail}</div>
                    </td>

                    {/* Lesson Title */}
                    <td className="p-3.5 font-medium text-[#000035] max-w-xs truncate">
                      {lesson.title}
                    </td>

                    {/* Status */}
                    <td className="p-3.5 whitespace-nowrap">
                      {isCancelled ? (
                        <span className="px-2.5 py-1 rounded-full text-[10px] font-black bg-slate-100 text-slate-700 border border-slate-300">
                          Cancelled
                        </span>
                      ) : isCompleted ? (
                        <span className="px-2.5 py-1 rounded-full text-[10px] font-black bg-emerald-700 text-white">
                          ✓ Completed
                        </span>
                      ) : isNotCompleted ? (
                        <span className="px-2.5 py-1 rounded-full text-[10px] font-black bg-amber-100 text-amber-900 border border-amber-300">
                          Not Completed
                        </span>
                      ) : isTrial ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black bg-amber-100 text-amber-900 border border-amber-300">
                          <Sparkles className="w-2.5 h-2.5 text-amber-600" />
                          <span>Trial Lesson • Active</span>
                        </span>
                      ) : (
                        <span className="px-2.5 py-1 rounded-full text-[10px] font-black bg-[#9AB4FF]/25 text-[#062863] border border-[#9AB4FF]">
                          Scheduled
                        </span>
                      )}

                      {/* Pending Reschedule Proposal Actions in Teacher Table */}
                      {lesson.proposalStatus === 'pending_teacher_reschedule' && lesson.proposedNewStartDateTime && (
                        <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                          <span className="text-[10px] bg-amber-100 text-amber-900 font-bold px-2 py-0.5 rounded border border-amber-300">
                            Proposal: {formatDateInTimeZone(lesson.proposedNewStartDateTime, timeZone, 'en')} {formatTimeInTimeZone(lesson.proposedNewStartDateTime, timeZone)}
                          </span>
                          {onAcceptReschedule && (
                            <button
                              type="button"
                              onClick={() => onAcceptReschedule(lesson.id)}
                              className="px-2 py-0.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[10px] rounded cursor-pointer transition shadow-2xs"
                              title="Accept Reschedule"
                            >
                              ✓ Accept
                            </button>
                          )}
                          {onDeclineReschedule && (
                            <button
                              type="button"
                              onClick={() => onDeclineReschedule(lesson.id)}
                              className="px-2 py-0.5 bg-white hover:bg-slate-100 border border-slate-300 text-slate-700 font-bold text-[10px] rounded cursor-pointer transition"
                              title="Decline Reschedule"
                            >
                              ✗ Decline
                            </button>
                          )}
                        </div>
                      )}

                      {lesson.proposalStatus === 'pending_student_reschedule' && (
                        <div className="mt-1.5">
                          <span className="text-[10px] bg-amber-50 text-amber-800 font-semibold px-2 py-0.5 rounded border border-amber-200">
                            ⏳ Waiting student approval
                          </span>
                        </div>
                      )}
                    </td>

                    {/* Actions */}
                    <td className="p-3.5 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-1.5">
                        {/* Meet - padronizado na cor verde */}
                        <a
                          href={lesson.meetLink}
                          target="_blank"
                          rel="noreferrer"
                          className="px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg text-[11px] transition flex items-center gap-1 shadow-2xs"
                          title="Open Google Meet"
                        >
                          <Video className="w-3.5 h-3.5" />
                          <span>Meet</span>
                        </a>

                        {/* Calendar - somente o símbolo do calendário em formato quadrado */}
                        <a
                          href={
                            lesson.calendarHtmlLink ||
                            generateGoogleCalendarWebLink({
                              title: lesson.title,
                              description: lesson.description,
                              startDateTime: lesson.startDateTime,
                              endDateTime: lesson.endDateTime,
                              studentEmail: lesson.studentEmail,
                              studentName: lesson.studentName,
                              teacherEmail: lesson.teacherEmail,
                              teacherName: lesson.teacherName,
                              meetLink: lesson.meetLink,
                            })
                          }
                          target="_blank"
                          rel="noopener noreferrer"
                          className="w-7 h-7 bg-white hover:bg-slate-100 border border-slate-300 text-[#1C4C96] rounded-lg transition flex items-center justify-center shadow-2xs shrink-0"
                          title="Sync with Google Calendar"
                        >
                          <Calendar className="w-3.5 h-3.5 text-[#1C4C96]" />
                        </a>

                        {isScheduled && (
                          <>
                            {/* Done - somente o símbolo de Certo */}
                            <button
                              type="button"
                              onClick={() => onCompleteLesson(lesson.id)}
                              className="w-7 h-7 bg-[#062863] hover:bg-[#000035] text-white rounded-lg transition cursor-pointer shadow-2xs flex items-center justify-center shrink-0"
                              title="Mark as Completed"
                            >
                              <Check className="w-3.5 h-3.5 text-white stroke-[2.5]" />
                            </button>

                            {/* Not Done - somente o X */}
                            <button
                              type="button"
                              onClick={() => onMarkNotCompleted(lesson)}
                              className="w-7 h-7 bg-[#FFFBEB] hover:bg-amber-100 text-amber-900 rounded-lg border border-amber-300 transition cursor-pointer shadow-2xs flex items-center justify-center shrink-0"
                              title="Mark as Not Completed"
                            >
                              <X className="w-3.5 h-3.5 text-amber-800 stroke-[2.5]" />
                            </button>

                            {/* Reschedule - formato quadrado pequeno com RotateCcw */}
                            <button
                              type="button"
                              onClick={() => onRescheduleLesson(lesson)}
                              className="w-7 h-7 bg-white hover:bg-slate-50 text-[#062863] rounded-lg border border-slate-300 transition cursor-pointer shadow-2xs flex items-center justify-center shrink-0"
                              title="Reschedule Lesson"
                            >
                              <RotateCcw className="w-3.5 h-3.5 text-[#1C4C96]" />
                            </button>

                            {/* Cancel - formato quadrado neutro com lixeira */}
                            {onCancelLesson && (
                              <button
                                type="button"
                                onClick={() => handleCancelClick(lesson)}
                                className="w-7 h-7 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg border border-slate-300 transition cursor-pointer shadow-2xs flex items-center justify-center shrink-0"
                                title="Cancel Lesson"
                              >
                                <Trash2 className="w-3.5 h-3.5 text-slate-600" />
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Cancel Lesson Confirmation Modal */}
      <CancelLessonModal
        isOpen={!!lessonToCancel}
        onClose={() => setLessonToCancel(null)}
        lesson={lessonToCancel}
        onConfirmCancel={(lessonId, reason, cancelledBy) => {
          if (onCancelLesson) {
            onCancelLesson(lessonId, reason, cancelledBy);
          }
          setLessonToCancel(null);
        }}
        currentLanguage="en"
        timeZone={timeZone}
      />
    </div>
  );
};
