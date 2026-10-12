import React, { useState, useMemo, useRef } from 'react';
import {
  X,
  Calendar as CalendarIcon,
  Clock,
  Video,
  User,
  AlertCircle,
  ExternalLink,
  BookOpen,
  Send,
  Sparkles,
  CheckCircle2,
  CalendarPlus,
  HelpCircle,
  AlertTriangle,
  Globe,
} from 'lucide-react';
import { GoogleAccount, TeacherMeetSettings, DayOfWeek, Language, UserProfile, LiveLesson, NativeFriendTutor } from '../types';
import { Translations } from '../utils/i18n';
import { generateGoogleCalendarWebLink } from '../utils/calendar';
import {
  formatDateInTimeZone,
  formatTimeInTimeZone,
  getTimezoneDisplayLabel,
  generate30MinTimeSlots,
  formatTimeSlot12h,
  findTeacherLessonConflict,
  buildIsoInTimeZone,
  DEFAULT_STUDENT_TIMEZONE,
  DEFAULT_TEACHER_TIMEZONE,
} from '../utils/timezone';
import { isValidCanonicalUid } from '../utils/studentPersistence';

interface LiveLessonScheduleModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentAccount: GoogleAccount | null;
  teachers: GoogleAccount[];
  tutors?: NativeFriendTutor[];
  students: GoogleAccount[];
  lessons?: LiveLesson[];
  initialTeacherEmail?: string;
  teacherMeetSettings: Record<string, TeacherMeetSettings>;
  onSchedule: (lessonData: {
    title: string;
    description: string;
    startDateTime: string;
    endDateTime: string;
    studentEmail: string;
    studentName: string;
    studentUid?: string;
    teacherEmail: string;
    teacherName: string;
    teacherUid?: string;
    meetLink: string;
  }) => Promise<void> | void;
  currentLanguage: Language;
  t: Translations;
  timeZone?: string;
  userProfile?: UserProfile | null;
  initialStudentEmail?: string;
  initialStudentName?: string;
  initialStudentUid?: string;
}

export const LiveLessonScheduleModal: React.FC<LiveLessonScheduleModalProps> = ({
  isOpen,
  onClose,
  currentAccount,
  teachers,
  tutors = [],
  students,
  lessons = [],
  initialTeacherEmail,
  teacherMeetSettings,
  onSchedule,
  currentLanguage,
  t,
  timeZone,
  userProfile,
  initialStudentEmail,
  initialStudentName,
  initialStudentUid,
}) => {
  const isTeacher = currentAccount ? (currentAccount.role === 'teacher' || currentAccount.role === 'admin') : false;
  const isEn = currentLanguage === 'en' || isTeacher;
  const activeTz = timeZone || (isTeacher ? DEFAULT_TEACHER_TIMEZONE : DEFAULT_STUDENT_TIMEZONE);

  // Determine candidate student email with priority to registering student / student profile
  const candidateStudentEmail = (
    initialStudentEmail ||
    (currentAccount?.role === 'student' ? currentAccount.email : null) ||
    (userProfile?.email ? userProfile.email : null)
  )?.trim().toLowerCase() || null;

  // Student booking mode: when registering, scheduling for oneself, or when an explicit student was provided
  const isStudentBookingMode = Boolean(
    initialStudentEmail ||
    currentAccount?.role === 'student' ||
    (userProfile?.email && !isTeacher) ||
    (!isTeacher)
  );

  // Check if student has an active linked teacher
  const studentHasActiveTeacher = !isTeacher && Boolean(
    userProfile?.teacherEmail &&
    userProfile.teacherEmail.trim() !== '' &&
    userProfile.enrollmentStatus !== 'cancelled' &&
    userProfile.enrollmentStatus !== 'not_enrolled'
  );

  const activeStudentTeacherEmail = studentHasActiveTeacher
    ? userProfile!.teacherEmail!.toLowerCase().trim()
    : (!isTeacher && initialTeacherEmail && initialTeacherEmail.trim() !== '')
      ? initialTeacherEmail.toLowerCase().trim()
      : null;

  // Available teachers list: for students, restrict strictly to the currently linked active teacher!
  const availableTeachers = useMemo(() => {
    if (isTeacher) {
      return teachers;
    }

    if (activeStudentTeacherEmail) {
      const matched = teachers.filter(
        (tc) =>
          (tc.email || '').toLowerCase().trim() === activeStudentTeacherEmail ||
          (tc.id || '').toLowerCase().trim() === activeStudentTeacherEmail
      );
      if (matched.length > 0) {
        return matched;
      }
      return [
        {
          id: `teacher-${activeStudentTeacherEmail}`,
          name: userProfile?.teacherName || activeStudentTeacherEmail.split('@')[0],
          email: activeStudentTeacherEmail,
          role: 'teacher' as const,
        },
      ];
    }

    return teachers;
  }, [isTeacher, activeStudentTeacherEmail, teachers, userProfile?.teacherName]);

  const defaultTeacherEmail = isTeacher && currentAccount
    ? currentAccount.email
    : activeStudentTeacherEmail || initialTeacherEmail || teachers[0]?.email || 'itissimple.school@gmail.com';

  const [selectedTeacherEmail, setSelectedTeacherEmail] = useState<string>(defaultTeacherEmail);

  React.useEffect(() => {
    if (activeStudentTeacherEmail) {
      setSelectedTeacherEmail(activeStudentTeacherEmail);
    } else if (initialTeacherEmail) {
      setSelectedTeacherEmail(initialTeacherEmail);
    } else if (isTeacher && currentAccount?.email) {
      setSelectedTeacherEmail(currentAccount.email);
    } else if (availableTeachers.length > 0 && !availableTeachers.some((tc) => tc.email?.toLowerCase() === selectedTeacherEmail.toLowerCase())) {
      setSelectedTeacherEmail(availableTeachers[0].email);
    }
  }, [isOpen, activeStudentTeacherEmail, initialTeacherEmail, isTeacher, currentAccount?.email, availableTeachers]);

  const defaultStudent =
    (candidateStudentEmail ? { email: candidateStudentEmail, name: initialStudentName || userProfile?.name || currentAccount?.name || '', role: 'student' as const } : null) ||
    (!isTeacher && currentAccount ? currentAccount : null) ||
    students[0] || {
      email: '',
      name: '',
      role: 'student' as const,
    };

  const [selectedStudentEmail, setSelectedStudentEmail] = useState<string>(
    candidateStudentEmail || (!isTeacher && currentAccount ? currentAccount.email : defaultStudent.email)
  );

  // Synchronize student email whenever modal opens or account changes
  React.useEffect(() => {
    if (candidateStudentEmail) {
      setSelectedStudentEmail(candidateStudentEmail);
    } else if (!isTeacher && currentAccount?.email) {
      setSelectedStudentEmail(currentAccount.email);
    } else if (isTeacher && students.length > 0) {
      if (!selectedStudentEmail || !students.some((s) => s.email === selectedStudentEmail)) {
        setSelectedStudentEmail(students[0].email);
      }
    }
  }, [isOpen, candidateStudentEmail, isTeacher, currentAccount?.email, students]);

  const todayStr = new Date().toISOString().split('T')[0];
  const [selectedDate, setSelectedDate] = useState<string>(todayStr);
  const [selectedStartTime, setSelectedStartTime] = useState<string>('09:00');
  const [durationMinutes, setDurationMinutes] = useState<number>(25);

  const [customTitle, setCustomTitle] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [scheduleSuccess, setScheduleSuccess] = useState<boolean>(false);
  const [isClosing, setIsClosing] = useState<boolean>(false);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const userInteractedWithTimeRef = useRef<boolean>(false);

  // Explicitly reset submission and closing states when modal opens or closes
  React.useEffect(() => {
    if (!isOpen) {
      setIsSubmitting(false);
      setScheduleSuccess(false);
      setIsClosing(false);
      setInlineError(null);
      userInteractedWithTimeRef.current = false;
    }
  }, [isOpen]);

  const cleanTeacherName = (name: string) => {
    return name.replace(/\s*\(Amigo Nativo\)/gi, '').replace(/\s*\(Amiga Nativa\)/gi, '').replace(/\s*\(Native Friend\)/gi, '').trim();
  };

  const selectedTeacherObj = availableTeachers.find((t) =>
    (t.email && t.email.toLowerCase() === selectedTeacherEmail.toLowerCase()) ||
    (t.id && t.id.toLowerCase() === selectedTeacherEmail.toLowerCase())
  )
    || teachers.find((t) =>
      (t.email && t.email.toLowerCase() === selectedTeacherEmail.toLowerCase()) ||
      (t.id && t.id.toLowerCase() === selectedTeacherEmail.toLowerCase())
    )
    || {
      name: userProfile?.teacherName || 'It is Simple Teacher',
      email: selectedTeacherEmail,
    };

  // Find matching tutor profile from tutors list (or availableTeachers/teachers)
  const matchedTutor = useMemo(() => {
    const clean = (selectedTeacherEmail || '').toLowerCase().trim();
    if (!clean) return null;
    return (
      tutors?.find((tut) => (tut.email || '').toLowerCase().trim() === clean) ||
      tutors?.find((tut) => (tut.id || '').toLowerCase().trim() === clean) ||
      tutors?.find((tut) => (tut.id || '').toLowerCase().trim() === (selectedTeacherObj as any)?.id?.toLowerCase().trim()) ||
      null
    );
  }, [tutors, selectedTeacherEmail, selectedTeacherObj]);

  // Compute effective Google Meet link strictly honoring the Native Friend's registered profile!
  const effectiveMeetLink = useMemo(() => {
    // 1. Direct from registered Tutor profile
    const tutorMeet = (matchedTutor?.meetUrl || matchedTutor?.meetLink || '').trim();
    if (tutorMeet) return tutorMeet;

    // 2. From selectedTeacherObj (populated from teachersList which merges tutor fields)
    const objMeet = ((selectedTeacherObj as any)?.meetUrl || (selectedTeacherObj as any)?.meetLink || '').trim();
    if (objMeet) return objMeet;

    // 3. From teacherMeetSettings (case-insensitive email matching)
    const cleanEmail = (selectedTeacherEmail || '').toLowerCase().trim();
    const settings =
      teacherMeetSettings[cleanEmail] ||
      teacherMeetSettings[selectedTeacherEmail] ||
      Object.entries(teacherMeetSettings).find(([k]) => k.toLowerCase().trim() === cleanEmail)?.[1];

    if (settings?.meetLink && settings.meetLink.trim() && settings.meetLink !== 'https://meet.google.com/gmt-kxnw-zpq') {
      return settings.meetLink.trim();
    }

    // 4. From student profile's saved teacher meet url
    if (userProfile?.teacherEmail?.toLowerCase().trim() === cleanEmail) {
      const studentTeacherMeet = ((userProfile as any)?.teacherMeetUrl || (userProfile as any)?.teacherMeetLink || '').trim();
      if (studentTeacherMeet) return studentTeacherMeet;
    }

    // 5. If settings has custom meetLink
    if (settings?.meetLink && settings.meetLink.trim()) {
      return settings.meetLink.trim();
    }

    // Fallback only if no tutor has set any link
    return 'https://meet.google.com/new';
  }, [matchedTutor, selectedTeacherObj, teacherMeetSettings, selectedTeacherEmail, userProfile]);

  const rawTeacherSettings: TeacherMeetSettings | undefined =
    teacherMeetSettings[selectedTeacherEmail] ||
    teacherMeetSettings[selectedTeacherEmail.toLowerCase().trim()] ||
    Object.entries(teacherMeetSettings).find(([k]) => k.toLowerCase().trim() === selectedTeacherEmail.toLowerCase().trim())?.[1];

  const activeTeacherSettings: TeacherMeetSettings = {
    teacherEmail: selectedTeacherEmail,
    meetLink: effectiveMeetLink,
    workingHoursStart: rawTeacherSettings?.workingHoursStart || '08:00',
    workingHoursEnd: rawTeacherSettings?.workingHoursEnd || '18:00',
    slotDurationMinutes: rawTeacherSettings?.slotDurationMinutes || 30,
    availableDays: rawTeacherSettings?.availableDays || matchedTutor?.availableDays || ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'],
    timezone: rawTeacherSettings?.timezone || matchedTutor?.timezone || 'America/Sao_Paulo',
  };

  const effectiveTeacherUid = useMemo(() => {
    if ((selectedTeacherObj as any)?.uid && isValidCanonicalUid((selectedTeacherObj as any).uid)) return (selectedTeacherObj as any).uid;
    if ((selectedTeacherObj as any)?.id && isValidCanonicalUid((selectedTeacherObj as any).id)) return (selectedTeacherObj as any).id;
    if (matchedTutor?.uid && isValidCanonicalUid(matchedTutor.uid)) return matchedTutor.uid;
    if (matchedTutor?.id && isValidCanonicalUid(matchedTutor.id)) return matchedTutor.id;
    return '';
  }, [selectedTeacherObj, matchedTutor]);

  const effectiveStudentEmail = (
    (isStudentBookingMode && candidateStudentEmail)
      ? candidateStudentEmail
      : (!isTeacher && currentAccount?.email)
        ? currentAccount.email.trim().toLowerCase()
        : (selectedStudentEmail || (currentAccount?.email ?? '')).trim().toLowerCase()
  );

  const matchedStudent = students.find((s) => (s.email || '').toLowerCase() === effectiveStudentEmail);

  const effectiveStudentName = useMemo(() => {
    if (initialStudentName && initialStudentName.trim() !== '') return initialStudentName.trim();
    if (userProfile?.email && userProfile.email.toLowerCase().trim() === effectiveStudentEmail && userProfile.name) {
      return userProfile.name.trim();
    }
    if (currentAccount?.role === 'student' && currentAccount?.name) {
      return currentAccount.name.trim();
    }
    if (matchedStudent?.name) {
      return matchedStudent.name.trim();
    }
    if (effectiveStudentEmail) {
      return effectiveStudentEmail.split('@')[0];
    }
    return 'Aluno';
  }, [initialStudentName, userProfile, currentAccount, effectiveStudentEmail, matchedStudent]);

  const effectiveStudentUid = useMemo(() => {
    if (initialStudentUid && isValidCanonicalUid(initialStudentUid)) return initialStudentUid.trim();
    if (userProfile?.email && userProfile.email.toLowerCase().trim() === effectiveStudentEmail) {
      if (userProfile.id && isValidCanonicalUid(userProfile.id)) return userProfile.id;
      if ((userProfile as any).uid && isValidCanonicalUid((userProfile as any).uid)) return (userProfile as any).uid;
    }
    if (currentAccount?.role === 'student' && currentAccount?.uid && isValidCanonicalUid(currentAccount.uid)) {
      return currentAccount.uid;
    }
    if ((matchedStudent as any)?.uid && isValidCanonicalUid((matchedStudent as any).uid)) {
      return (matchedStudent as any).uid;
    }
    if (matchedStudent?.id && isValidCanonicalUid(matchedStudent.id)) {
      return matchedStudent.id;
    }
    return '';
  }, [initialStudentUid, userProfile, currentAccount, effectiveStudentEmail, matchedStudent]);

  const selectedStudentObj = {
    name: effectiveStudentName,
    email: effectiveStudentEmail,
    uid: effectiveStudentUid,
  };

  // Check which day of week is selected
  const selectedDayKey = useMemo(() => {
    try {
      const [y, m, d] = selectedDate.split('-').map(Number);
      const dateObj = new Date(y, m - 1, d);
      const dayIndex = dateObj.getDay();
      const map: Record<number, DayOfWeek> = {
        0: 'sunday',
        1: 'monday',
        2: 'tuesday',
        3: 'wednesday',
        4: 'thursday',
        5: 'friday',
        6: 'saturday',
      };
      return map[dayIndex] || 'monday';
    } catch {
      return 'monday';
    }
  }, [selectedDate]);

  const isDayAvailable = useMemo(() => {
    if (activeTeacherSettings.availableDays && activeTeacherSettings.availableDays.length > 0) {
      if (!activeTeacherSettings.availableDays.includes(selectedDayKey)) return false;
    }
    const daySchedule =
      activeTeacherSettings.availability?.[selectedDayKey] ||
      activeTeacherSettings.availableHoursByDay?.[selectedDayKey];
    if (daySchedule && Array.isArray(daySchedule) && daySchedule.length === 0) {
      return false;
    }
    return true;
  }, [activeTeacherSettings.availableDays, activeTeacherSettings.availability, activeTeacherSettings.availableHoursByDay, selectedDayKey]);

  // Generate 30-minute time slots based on teacher settings for the specific day of week
  const timeSlots = useMemo(() => {
    const daySchedule =
      activeTeacherSettings.availability?.[selectedDayKey] ||
      activeTeacherSettings.availableHoursByDay?.[selectedDayKey];

    if (daySchedule && Array.isArray(daySchedule) && daySchedule.length > 0) {
      return [...daySchedule].sort();
    }
    if (activeTeacherSettings.availableHours && activeTeacherSettings.availableHours.length > 0) {
      return [...activeTeacherSettings.availableHours].sort();
    }
    return generate30MinTimeSlots(
      activeTeacherSettings.workingHoursStart || '08:00',
      activeTeacherSettings.workingHoursEnd || '20:00'
    );
  }, [
    activeTeacherSettings.availability,
    activeTeacherSettings.availableHoursByDay,
    activeTeacherSettings.availableHours,
    activeTeacherSettings.workingHoursStart,
    activeTeacherSettings.workingHoursEnd,
    selectedDayKey,
  ]);

  // Calculate start and end ISO using exact timezone conversion
  const calculateEndDateTime = () => {
    if (!selectedDate || !selectedStartTime) return '';
    return buildIsoInTimeZone(selectedDate, selectedStartTime, activeTz, durationMinutes);
  };

  const calculateStartDateTime = () => {
    if (!selectedDate || !selectedStartTime) return '';
    return buildIsoInTimeZone(selectedDate, selectedStartTime, activeTz, 0);
  };

  // Real-time teacher lessons to ensure 100% accurate slot availability
  const [teacherLessons, setTeacherLessons] = useState<LiveLesson[]>([]);

  React.useEffect(() => {
    if (!isOpen || !selectedTeacherObj.email) return;
    const cleanTeacherEmail = selectedTeacherObj.email.toLowerCase().trim();
    fetch(`/api/lessons?teacherEmail=${encodeURIComponent(cleanTeacherEmail)}&role=teacher`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => {
        if (Array.isArray(data)) {
          setTeacherLessons(data);
        }
      })
      .catch(() => {});
  }, [isOpen, selectedTeacherObj.email]);

  // Combine parent lessons with freshly fetched teacher lessons (deduplicating by id)
  const combinedLessons = useMemo(() => {
    const map = new Map<string, LiveLesson>();
    (lessons || []).forEach((l) => {
      if (l && l.id) map.set(l.id, l);
    });
    teacherLessons.forEach((l) => {
      if (l && l.id) map.set(l.id, l);
    });
    return Array.from(map.values());
  }, [lessons, teacherLessons]);

  // Slot conflict checker for dropdown options
  const checkSlotIsBooked = (slot: string) => {
    if (!selectedDate || (!selectedTeacherObj.email && !effectiveTeacherUid)) return false;
    const startIso = buildIsoInTimeZone(selectedDate, slot, activeTz, 0);
    const endIso = buildIsoInTimeZone(selectedDate, slot, activeTz, durationMinutes);
    if (!startIso || !endIso) return false;
    const conflict = findTeacherLessonConflict(
      selectedTeacherObj.email,
      startIso,
      endIso,
      combinedLessons,
      undefined,
      effectiveTeacherUid,
      selectedStudentObj.email,
      effectiveStudentUid
    );
    return Boolean(conflict);
  };

  // 🌟 ANTI-DUPLICITY CONFLICT DETECTION (Pure synchronous calculation, zero-frame delay)
  // Preserves 100% of defined rules. Evaluated strictly when modal is active and NOT submitting/closing
  const currentConflict = useMemo(() => {
    if (!isOpen || isSubmitting || scheduleSuccess || isClosing) return null;
    if (!selectedDate || !selectedStartTime || (!selectedTeacherObj.email && !effectiveTeacherUid)) return null;

    const startIso = calculateStartDateTime();
    const endIso = calculateEndDateTime();
    if (!startIso || !endIso) return null;

    return findTeacherLessonConflict(
      selectedTeacherObj.email,
      startIso,
      endIso,
      combinedLessons,
      undefined,
      effectiveTeacherUid,
      selectedStudentObj.email,
      effectiveStudentUid
    );
  }, [
    isOpen,
    isSubmitting,
    scheduleSuccess,
    isClosing,
    selectedDate,
    selectedStartTime,
    durationMinutes,
    selectedTeacherObj.email,
    effectiveTeacherUid,
    selectedStudentObj.email,
    effectiveStudentUid,
    combinedLessons,
    activeTz,
  ]);

  // Adjust selectedStartTime if not in timeSlots or if booked, auto-selecting the first available slot
  React.useEffect(() => {
    if (!isOpen || isSubmitting || scheduleSuccess || isClosing) return;
    if (timeSlots.length === 0) return;
    const isCurrentBooked = checkSlotIsBooked(selectedStartTime);
    if (!timeSlots.includes(selectedStartTime) || isCurrentBooked) {
      const freeSlot = timeSlots.find((slot) => !checkSlotIsBooked(slot));
      if (freeSlot) {
        setSelectedStartTime(freeSlot);
      } else if (!timeSlots.includes(selectedStartTime)) {
        setSelectedStartTime(timeSlots[0]);
      }
    }
  }, [
    timeSlots,
    selectedDate,
    durationMinutes,
    combinedLessons,
    selectedTeacherObj.email,
    effectiveTeacherUid,
    selectedStudentObj.email,
    effectiveStudentUid,
    isOpen,
    isSubmitting,
    scheduleSuccess,
    isClosing,
  ]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setInlineError(null);

    const startIso = calculateStartDateTime();
    const endIso = calculateEndDateTime();

    // Absolute conflict blocking before triggering submit (preserves 100% of defined rules)
    const definitiveConflict = findTeacherLessonConflict(
      selectedTeacherObj.email,
      startIso,
      endIso,
      combinedLessons,
      undefined,
      effectiveTeacherUid,
      selectedStudentObj.email,
      effectiveStudentUid
    );

    if (definitiveConflict) {
      setInlineError(
        isEn
          ? `Conflict Blocked: There is already a scheduled lesson at this time for this Native Friend or Student. Please choose another slot.`
          : `Bloqueio de Conflito: Já existe uma aula agendada neste horário para este Amigo Nativo ou Aluno. Por favor, selecione outro horário.`
      );
      return;
    }

    if (!isDayAvailable) {
      setInlineError(
        isEn
          ? `The Native Friend is not available on ${selectedDayKey}. Please select an open day.`
          : `O Amigo Nativo não atende às ${selectedDayKey === 'sunday' ? 'domingos' : selectedDayKey === 'saturday' ? 'sábados' : 'segundas-feiras'}. Por favor, escolha um dia disponível.`
      );
      return;
    }

    if (!selectedStudentObj.email) {
      setInlineError(
        isEn
          ? 'Error: Student email not identified. Please make sure you are signed in.'
          : 'Erro: Não foi possível identificar o e-mail do aluno. Verifique se está conectado à sua conta.'
      );
      return;
    }

    // Immediately flag as submitting & closing to prevent any intermediate visual conflict state
    setIsSubmitting(true);
    setIsClosing(true);

    // Safety timeout to ensure isSubmitting never hangs indefinitely under any circumstances
    const safetyTimer = setTimeout(() => {
      setIsSubmitting(false);
      setIsClosing(false);
    }, 4500);

    try {
      await onSchedule({
        title: customTitle,
        description: notes,
        startDateTime: startIso,
        endDateTime: endIso,
        studentEmail: selectedStudentObj.email,
        studentName: selectedStudentObj.name,
        studentUid: effectiveStudentUid,
        teacherEmail: selectedTeacherObj.email,
        teacherName: selectedTeacherObj.name,
        teacherUid: effectiveTeacherUid,
        meetLink: activeTeacherSettings.meetLink || effectiveMeetLink,
      });

      setScheduleSuccess(true);
      onClose();
    } catch (err: any) {
      console.error('Schedule error:', err);
      setInlineError(err?.message || (isEn ? 'Failed to schedule lesson. Please try again.' : 'Erro ao agendar aula. Por favor, selecione outro horário.'));
      setIsClosing(false);
      setIsSubmitting(false);
    } finally {
      clearTimeout(safetyTimer);
    }
  };

  const googleCalLink = generateGoogleCalendarWebLink({
    title: customTitle,
    description: notes,
    startDateTime: calculateStartDateTime(),
    endDateTime: calculateEndDateTime(),
    studentEmail: selectedStudentObj.email,
    studentName: selectedStudentObj.name,
    teacherEmail: selectedTeacherObj.email,
    teacherName: selectedTeacherObj.name,
    meetLink: activeTeacherSettings.meetLink || effectiveMeetLink,
  });

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-[#000035]/70 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6 overflow-y-auto">
      <div className="bg-white rounded-3xl max-w-xl w-full shadow-2xl border border-[#607EC9]/30 overflow-hidden my-auto">
        {/* Header */}
        <div className="px-6 py-4 bg-[#000035] text-white flex items-center justify-between border-b border-[#1C4C96]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-[#1C4C96] flex items-center justify-center text-white shadow-xs border border-[#9AB4FF]/40">
              <CalendarPlus className="w-5 h-5 text-[#9AB4FF]" />
            </div>
            <div>
              <h3 className="font-black text-base sm:text-lg text-white">
                {isEn ? 'Schedule Live 1-on-1 Lesson' : 'Agendar Aula Ao Vivo (Google Meet)'}
              </h3>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl text-[#9AB4FF] hover:text-white hover:bg-[#1C4C96] transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {scheduleSuccess && (
            <div className="p-4 bg-[#9AB4FF]/20 border border-[#607EC9] rounded-2xl text-xs font-bold text-[#062863] flex items-center gap-2 animate-in fade-in">
              <CheckCircle2 className="w-5 h-5 text-[#1C4C96]" />
              <span>
                {isEn
                  ? 'Lesson scheduled successfully and added to your Google Calendar!'
                  : 'Aula agendada com sucesso e adicionada à sua agenda!'}
              </span>
            </div>
          )}

          {/* Teacher / Student Selection */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-[#000035] mb-1">
                {isEn ? 'Native Friend' : 'Amigo Nativo'}
              </label>
              {isTeacher && currentAccount ? (
                <div className="p-2.5 bg-[#9AB4FF]/10 rounded-xl border border-[#607EC9]/30 text-xs font-bold text-[#062863]">
                  {cleanTeacherName(currentAccount.name)} ({currentAccount.email})
                </div>
              ) : activeStudentTeacherEmail ? (
                <div className="p-2.5 bg-[#9AB4FF]/10 rounded-xl border border-[#607EC9]/30 text-xs font-bold text-[#062863]">
                  {cleanTeacherName(selectedTeacherObj.name)} ({selectedTeacherObj.email})
                </div>
              ) : (
                <select
                  value={selectedTeacherEmail}
                  onChange={(e) => setSelectedTeacherEmail(e.target.value)}
                  className="w-full p-2.5 bg-white border border-[#607EC9]/40 rounded-xl text-xs font-semibold text-[#000035] focus:ring-2 focus:ring-[#1C4C96]"
                >
                  {availableTeachers.map((tc) => (
                    <option key={tc.email} value={tc.email}>
                      {cleanTeacherName(tc.name)} ({tc.email})
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div>
              <label className="block text-xs font-bold text-[#000035] mb-1">
                {isTeacher && !isStudentBookingMode ? (isEn ? 'Student' : 'Aluno') : (isEn ? 'Your Name' : 'Seu nome')}
              </label>
              {isStudentBookingMode ? (
                <div className="p-2.5 bg-[#9AB4FF]/10 rounded-xl border border-[#607EC9]/30 text-xs font-bold text-[#062863] flex flex-col justify-center">
                  <span className="text-[#000035] font-black text-xs sm:text-sm">{effectiveStudentName}</span>
                  <span className="text-[11px] text-[#607EC9] font-medium mt-0.5">{effectiveStudentEmail}</span>
                </div>
              ) : (
                <select
                  value={selectedStudentEmail}
                  onChange={(e) => setSelectedStudentEmail(e.target.value)}
                  className="w-full p-2.5 bg-white border border-[#607EC9]/40 rounded-xl text-xs font-semibold text-[#000035] focus:ring-2 focus:ring-[#1C4C96]"
                >
                  {students.map((st) => (
                    <option key={st.email} value={st.email}>
                      {st.name} ({st.email})
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>

          {/* Date and Time Slots */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-[#000035] mb-1">
                {isEn ? 'Date' : 'Data da Aula'}
              </label>
              <input
                type="date"
                required
                value={selectedDate}
                onChange={(e) => {
                  userInteractedWithTimeRef.current = false;
                  setSelectedDate(e.target.value);
                }}
                className="w-full p-2.5 bg-white border border-[#607EC9]/40 rounded-xl text-xs font-semibold text-[#000035] focus:ring-2 focus:ring-[#1C4C96]"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-[#000035] mb-1">
                {isEn ? 'Start Time' : 'Horário de Início'}
              </label>
              <select
                value={selectedStartTime}
                onChange={(e) => {
                  userInteractedWithTimeRef.current = true;
                  setSelectedStartTime(e.target.value);
                }}
                className="w-full p-2.5 bg-white border border-[#607EC9]/40 rounded-xl text-xs font-semibold text-[#000035] focus:ring-2 focus:ring-[#1C4C96]"
              >
                {timeSlots.map((slot) => {
                  const isOccupied = checkSlotIsBooked(slot);
                  return (
                    <option key={slot} value={slot} disabled={isOccupied}>
                      {formatTimeSlot12h(slot)} {isOccupied ? (isEn ? '• ❌ [BUSY / BOOKED]' : '• ❌ [OCUPADO / JÁ AGENDADO]') : (isEn ? '• ✓ [AVAILABLE]' : '• ✓ [DISPONÍVEL]')}
                    </option>
                  );
                })}
              </select>
            </div>
          </div>

          {/* Warning if Day is Not in Teacher's Available Days */}
          {!isDayAvailable && (
            <div className="p-3 bg-amber-50 border border-amber-300 rounded-xl text-xs text-amber-900 flex items-start gap-2 animate-in fade-in">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-[11px] leading-relaxed">
                {isEn
                  ? `Notice: The Native Friend is not normally scheduled for teaching on ${selectedDayKey}. Please choose an open day or coordinate with the teacher.`
                  : `Atenção: O Amigo Nativo não configurou atendimento neste dia da semana (${selectedDayKey}). Por favor, selecione outro dia da semana.`}
              </p>
            </div>
          )}

          {/* 🚨 CONFLICT ALERT BANNER (Rule 2) */}
          {!isSubmitting && !scheduleSuccess && !isClosing && (Boolean(currentConflict) || checkSlotIsBooked(selectedStartTime)) && (
            <div className="p-4 bg-rose-50 border-2 border-rose-400 rounded-2xl text-xs text-rose-950 space-y-1.5 animate-in fade-in">
              <div className="flex items-center gap-2 font-black text-rose-800">
                <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0" />
                <span className="text-sm">
                  {isEn ? 'Time Slot Already Booked (Schedule Conflict)' : 'Horário Já Ocupado (Conflito de Horário)'}
                </span>
              </div>
              <p className="text-[11px] leading-relaxed text-rose-900 font-medium">
                {isEn
                  ? `The Native Friend ${cleanTeacherName(selectedTeacherObj.name)} already has another lesson scheduled on this slot (${formatTimeSlot12h(selectedStartTime)}). Double bookings are strictly blocked by system rules.`
                  : `O Amigo Nativo ${cleanTeacherName(selectedTeacherObj.name)} já possui uma aula agendada exatamente neste horário (${formatTimeSlot12h(selectedStartTime)}). O sistema bloqueia conflitos e não permite duas aulas no mesmo slot.`}
              </p>
              <p className="text-[11px] font-black text-rose-700">
                {isEn
                  ? '👉 Please select another date or available 30-minute time slot to proceed.'
                  : '👉 Por favor, selecione outro horário disponível na grade de 30 minutos.'}
              </p>
            </div>
          )}

          {/* Inline Error Banner if submit was blocked */}
          {inlineError && (
            <div className="p-3 bg-red-50 border border-red-300 rounded-xl text-xs text-red-900 flex items-start gap-2 animate-in fade-in">
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <p className="text-[11px] font-semibold leading-relaxed">{inlineError}</p>
            </div>
          )}

          {/* Duration & Timezone */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-[#000035] mb-1">
                {isEn ? 'Duration' : 'Duração da Aula'}
              </label>
              <select
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(Number(e.target.value))}
                className="w-full p-2.5 bg-white border border-[#607EC9]/40 rounded-xl text-xs font-semibold text-[#000035] focus:ring-2 focus:ring-[#1C4C96]"
              >
                <option value={25}>25 {isEn ? 'minutes (1 slot)' : 'minutos (1 bloco)'}</option>
                <option value={50}>50 {isEn ? 'minutes (2 slots)' : 'minutos (2 blocos)'}</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-[#000035] mb-1">
                {isEn ? 'Timezone' : 'Fuso Horário'}
              </label>
              <div className="p-2.5 bg-[#9AB4FF]/10 rounded-xl border border-[#607EC9]/30 text-xs font-bold text-[#062863] flex items-center gap-1.5">
                <Globe className="w-3.5 h-3.5 text-[#1C4C96]" />
                <span>{activeTz}</span>
              </div>
            </div>
          </div>

          {/* Title & Notes */}
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-bold text-[#000035] mb-1">
                {isEn ? 'Lesson Topic / Title' : 'Tema / Título da Aula'}
              </label>
              <input
                type="text"
                required
                value={customTitle}
                onChange={(e) => setCustomTitle(e.target.value)}
                placeholder={isEn ? 'e.g. Daily English Conversation Practice' : 'Ex.: Prática de Conversação Diária'}
                className="w-full p-2.5 bg-white border border-[#607EC9]/40 rounded-xl text-xs font-semibold text-[#000035] focus:ring-2 focus:ring-[#1C4C96]"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-[#000035] mb-1">
                {isEn ? 'Notes / Goals' : 'Observações e Objetivos'}
              </label>
              <textarea
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={isEn ? 'Focus on vocabulary, listening, job interview...' : 'Foco em vocabulário, rotina de estudos...'}
                className="w-full p-2.5 bg-white border border-[#607EC9]/40 rounded-xl text-xs text-[#000035] focus:ring-2 focus:ring-[#1C4C96]"
              />
            </div>
          </div>

          {/* Meet Link Preview */}
          <div className="p-3 bg-[#9AB4FF]/10 rounded-2xl border border-[#607EC9]/30 flex items-center justify-between text-xs">
            <div className="flex items-center gap-2 min-w-0">
              <Video className="w-4 h-4 text-[#1C4C96] shrink-0" />
              <span className="font-bold text-[#000035] shrink-0">Google Meet:</span>
              <a
                href={effectiveMeetLink}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-[11px] text-[#1C4C96] hover:underline truncate max-w-xs flex items-center gap-1 font-semibold"
                title={effectiveMeetLink}
              >
                <span className="truncate">{effectiveMeetLink}</span>
                <ExternalLink className="w-3 h-3 shrink-0 opacity-70" />
              </a>
            </div>
            {matchedTutor?.name && (
              <span className="text-[10px] text-slate-500 font-medium shrink-0 hidden sm:inline">
                ({cleanTeacherName(matchedTutor.name)})
              </span>
            )}
          </div>

          {/* Footer Buttons */}
          <div className="pt-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-t border-slate-100">
            <a
              href={googleCalLink}
              target="_blank"
              rel="noreferrer"
              className="text-xs font-bold text-[#1C4C96] hover:text-[#062863] flex items-center gap-1 self-center"
            >
              <CalendarPlus className="w-4 h-4" />
              <span>{isEn ? 'Open in Google Calendar' : 'Abrir no Google Agenda'}</span>
            </a>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-[#000035] rounded-xl text-xs font-bold transition cursor-pointer"
              >
                {isEn ? 'Cancel' : 'Cancelar'}
              </button>

              <button
                type="submit"
                disabled={isSubmitting || scheduleSuccess || isClosing || Boolean(currentConflict) || checkSlotIsBooked(selectedStartTime)}
                className={`px-6 py-2.5 rounded-xl text-xs font-black transition flex items-center gap-1.5 shadow-md ${
                  (currentConflict || checkSlotIsBooked(selectedStartTime))
                    ? 'bg-slate-300 text-slate-500 border border-slate-300 cursor-not-allowed shadow-none'
                    : (scheduleSuccess || isClosing)
                    ? 'bg-emerald-600 text-white shadow-none'
                    : 'bg-[#1C4C96] hover:bg-[#062863] text-white cursor-pointer'
                }`}
              >
                <CalendarPlus className="w-4 h-4 text-[#9AB4FF]" />
                <span>
                  {isSubmitting
                    ? (isEn ? 'Scheduling...' : 'Agendando...')
                    : (scheduleSuccess || isClosing)
                    ? (isEn ? 'Scheduled!' : 'Agendado!')
                    : (currentConflict || checkSlotIsBooked(selectedStartTime))
                    ? (isEn ? 'Slot Unavailable (Already Booked)' : 'Horário Indisponível (Já Ocupado)')
                    : isEn ? 'Confirm & Schedule' : 'Confirmar Agendamento'}
                </span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};

