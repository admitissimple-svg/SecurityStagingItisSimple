import React, { useState, useEffect, useRef, useCallback, useMemo, Component, ErrorInfo } from 'react';
import {
  FileText,
  Sparkles,
  CheckCircle2,
  Check,
  Calendar,
  History,
  Lightbulb,
  Copy,
  Bold,
  Italic,
  Underline,
  List,
  ListOrdered,
  Quote,
  Minus,
  Clock,
  RotateCcw,
  Save,
  Download,
  Share2,
  ChevronDown,
  Loader2,
  BookOpen,
  ExternalLink,
  FolderSync,
  FolderCheck,
  AlertCircle,
  CloudUpload,
  Eye,
  Columns,
  Edit3,
  Trash2,
  Plus,
  RefreshCw,
  Undo2,
  Send,
} from 'lucide-react';
import {
  LiveLesson,
  StudentProfile,
  GoogleAccount,
  LiveLessonVocabNote,
  StudentDictionaryEntry,
  SessionNotesDocument,
  EnglishLevel,
  NoteDraftTransformation,
  NoteApprovedVersion,
  SessionNoteVersionEntry,
} from '../types';
import { isValidCanonicalUid } from '../utils/studentPersistence';
import { computeNotesContentHash } from '../utils/notesVersioning';
import { formatDateInTimeZone, formatTimeInTimeZone } from '../utils/timezone';
import { auth } from '../firebase';
import { useAuth } from '../context/AuthContext';
import { getGoogleOAuthToken, setGoogleOAuthToken, requestGoogleDriveAuth } from '../utils/auth';
import {
  syncSessionNotesToGoogleDrive,
  formatSessionNotesFileName,
  findExistingSessionNotesFile,
  getOrCreateSessionNotesFolder,
  GOOGLE_DRIVE_SESSION_FOLDER,
} from '../utils/googleDrive';

interface TeacherLiveLessonNotesPanelProps {
  lessons?: LiveLesson[];
  students?: Array<StudentProfile | GoogleAccount>;
  studentUid?: string;
  currentAccount?: GoogleAccount | null;
  selectedStudentFilter?: string;
  onSaveLessonNotes?: (
    lessonId: string,
    notes: {
      topic?: string;
      liveNotes?: string;
      recommendations?: string;
      pronunciationNotes?: string;
      grammarAndPhrasing?: string;
      vocabularyNotes?: LiveLessonVocabNote[];
      sessionNotesDocument?: string;
      sessionDate?: string;
      driveFileId?: string;
      driveFileUrl?: string;
      driveFolderName?: string;
      driveLastSyncedAt?: string;
    }
  ) => void;
  onAddWordsToDictionary?: (
    words: StudentDictionaryEntry[],
    studentEmail?: string,
    studentUid?: string,
    lessonId?: string,
    options?: { isAutomaticSync?: boolean; syncType?: string }
  ) => Promise<any> | void;
  onAddWordsToWeeklyActivity?: (words: string[], studentEmail: string) => void;
  onSendStudentNotification?: (
    studentEmail: string,
    title: string,
    message: string
  ) => void;
  timeZone?: string;
}

const TeacherLiveLessonNotesPanelComponent: React.FC<TeacherLiveLessonNotesPanelProps> = ({
  lessons = [],
  students = [],
  studentUid,
  currentAccount = null,
  selectedStudentFilter,
  onSaveLessonNotes,
  onAddWordsToDictionary,
  onAddWordsToWeeklyActivity,
  onSendStudentNotification,
  timeZone = 'America/Sao_Paulo',
}) => {
  // Auth context for Google OAuth Token
  const { googleOAuthToken, connectGoogleDrive } = useAuth();

  // Safe collections
  const safeLessons = Array.isArray(lessons) ? lessons : [];
  const safeStudents = Array.isArray(students) ? students : [];

  // Filter scheduled or completed lessons for this teacher (sorted descending by date: newest first)
  const teacherLessons = useMemo(() => {
    const list = safeLessons.filter((l) => {
      if (!l) return false;
      if (!currentAccount?.email) return true;
      const tEmail = (currentAccount.email || '').toLowerCase().trim();
      const tUid = (currentAccount.id || (currentAccount as any)?.uid || '').trim();
      const lTeacherEmail = (l.teacherEmail || (l as any)?.tutorEmail || '').toLowerCase().trim();
      const lTeacherUid = (l.teacherUid || (l as any)?.tutorUid || '').trim();
      return (
        (lTeacherEmail && lTeacherEmail === tEmail) ||
        (lTeacherUid && tUid && lTeacherUid === tUid)
      );
    });

    // Sort in DESCENDING order: newest / most recent dates first
    return list.sort((a, b) => {
      const timeA = a?.startDateTime ? new Date(a.startDateTime).getTime() : 0;
      const timeB = b?.startDateTime ? new Date(b.startDateTime).getTime() : 0;
      return timeB - timeA;
    });
  }, [safeLessons, currentAccount?.email, currentAccount?.id, (currentAccount as any)?.uid]);

  // Reliable helper to obtain today's date string (YYYY-MM-DD) in the active timezone
  const getTodayDateStr = useCallback((): string => {
    try {
      const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
      return formatter.format(new Date());
    } catch {
      return new Date().toISOString().split('T')[0];
    }
  }, [timeZone]);

  // Safe helper to extract display name for student without crashing
  const resolveStudentName = useCallback(
    (student?: StudentProfile | GoogleAccount | null, lesson?: LiveLesson | null, emailFallback?: string): string => {
      if (student?.name && student.name.trim()) return student.name.trim();
      if (lesson?.studentName && lesson.studentName.trim()) return lesson.studentName.trim();
      const rawEmail = (lesson?.studentEmail || emailFallback || '').trim();
      if (rawEmail && rawEmail.includes('@')) {
        return rawEmail.split('@')[0];
      }
      return rawEmail || 'Student';
    },
    []
  );

  // Selected session ID and student - Session date ALWAYS initialized to current date (=today)
  const [selectedLessonId, setSelectedLessonId] = useState<string>('');
  const [selectedStudentEmail, setSelectedStudentEmail] = useState<string>('');
  const [sessionDate, setSessionDate] = useState<string>(() => {
    try {
      const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
      return formatter.format(new Date());
    } catch {
      return new Date().toISOString().split('T')[0];
    }
  });

  // Note fields
  const [topic, setTopic] = useState<string>('');
  const [notesContent, setNotesContent] = useState<string>('');

  // UI state
  const [activeTab, setActiveTab] = useState<'editor' | 'history'>('editor');
  const [editorViewMode, setEditorViewMode] = useState<'edit' | 'split' | 'preview'>('edit');
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [lastSavedTimestamp, setLastSavedTimestamp] = useState<string | null>(null);
  const [copiedSuccess, setCopiedSuccess] = useState<boolean>(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedSuccessBanner, setSavedSuccessBanner] = useState<boolean>(false);

  // FASE NF-DOC.2C: AI Transformation & Teacher Approval States
  const [draftTransformation, setDraftTransformation] = useState<NoteDraftTransformation | null>(null);
  const [lastApprovedVersion, setLastApprovedVersion] = useState<NoteApprovedVersion | null>(null);
  const [approvalStatus, setApprovalStatus] = useState<'unapproved' | 'draft_in_progress' | 'approved'>('unapproved');
  const [editableTransformation, setEditableTransformation] = useState<any | null>(null);
  const [isApplyingAi, setIsApplyingAi] = useState<boolean>(false);
  const [isSavingDraft, setIsSavingDraft] = useState<boolean>(false);
  const [isApproving, setIsApproving] = useState<boolean>(false);
  const [versionHistory, setVersionHistory] = useState<SessionNoteVersionEntry[]>([]);
  const [showVersionHistory, setShowVersionHistory] = useState<boolean>(false);
  const [isLoadingVersions, setIsLoadingVersions] = useState<boolean>(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiSuccessMessage, setAiSuccessMessage] = useState<string | null>(null);

  // Stale draft check: compares draft contentHash with current notes content hash
  const isDraftStale = useMemo(() => {
    if (!draftTransformation) return false;
    const currentHash = computeNotesContentHash(notesContent);
    return Boolean(draftTransformation.contentHash && draftTransformation.contentHash !== currentHash);
  }, [draftTransformation, notesContent]);

  // Pre-styled Inline Coaching Tag Constants (mirrors exact design system references)
  // Correct tag: Rounded rectangle (6px radius), light green bg (#ecfdf5), dark green border (#15803d), green checkmark (✓)
  // Incorrect tag: Rounded rectangle (6px radius), light red bg (#fff1f2), dark red border (#b91c1c), red cross (✗)
  // New Word tag: Rounded rectangle (6px radius), light blue bg (#eff6ff), dark blue border (#1d4ed8), ✦ New Word
  // Pronounce tag: Rounded rectangle (6px radius), light purple bg (#faf5ff), dark purple border (#7e22ce), 🎯 Pronounce
  const CORRECT_TAG_HTML = `<span class="inline-coaching-tag correct-tag inline-flex items-center justify-center font-bold text-xs px-1.5 py-0.5 rounded-md bg-[#ecfdf5] border border-[#15803d] text-[#15803d] mx-1 align-baseline shadow-2xs select-none" data-tag-type="correct" contenteditable="false" style="display: inline-flex; align-items: center; justify-content: center; background-color: #ecfdf5; border: 1px solid #15803d; color: #15803d; border-radius: 6px; padding: 1px 6px; font-weight: 700; font-size: 12px; line-height: 1.3; vertical-align: baseline; margin: 0 4px; user-select: none;" title="Correct (✓)" role="img" aria-label="Correct">✓</span>`;
  const INCORRECT_TAG_HTML = `<span class="inline-coaching-tag incorrect-tag inline-flex items-center justify-center font-bold text-xs px-1.5 py-0.5 rounded-md bg-[#fff1f2] border border-[#b91c1c] text-[#b91c1c] mx-1 align-baseline shadow-2xs select-none" data-tag-type="incorrect" contenteditable="false" style="display: inline-flex; align-items: center; justify-content: center; background-color: #fff1f2; border: 1px solid #b91c1c; color: #b91c1c; border-radius: 6px; padding: 1px 6px; font-weight: 700; font-size: 12px; line-height: 1.3; vertical-align: baseline; margin: 0 4px; user-select: none;" title="Incorrect (✗)" role="img" aria-label="Incorrect">✗</span>`;
  const NEW_WORD_TAG_HTML = `<span class="inline-coaching-tag new-word-tag inline-flex items-center justify-center font-bold text-xs px-1.5 py-0.5 rounded-md bg-[#eff6ff] border border-[#1d4ed8] text-[#1d4ed8] mx-1 align-baseline shadow-2xs select-none" data-tag-type="new-word" contenteditable="false" style="display: inline-flex; align-items: center; justify-content: center; background-color: #eff6ff; border: 1px solid #1d4ed8; color: #1d4ed8; border-radius: 6px; padding: 1px 6px; font-weight: 700; font-size: 12px; line-height: 1.3; vertical-align: baseline; margin: 0 4px; user-select: none;" title="New Word" role="img" aria-label="New Word">✦ New Word</span>`;
  const PRONOUNCE_TAG_HTML = `<span class="inline-coaching-tag pronounce-tag inline-flex items-center justify-center font-bold text-xs px-1.5 py-0.5 rounded-md bg-[#faf5ff] border border-[#7e22ce] text-[#7e22ce] mx-1 align-baseline shadow-2xs select-none" data-tag-type="pronounce" contenteditable="false" style="display: inline-flex; align-items: center; justify-content: center; background-color: #faf5ff; border: 1px solid #7e22ce; color: #7e22ce; border-radius: 6px; padding: 1px 6px; font-weight: 700; font-size: 12px; line-height: 1.3; vertical-align: baseline; margin: 0 4px; user-select: none;" title="Pronounce" role="img" aria-label="Pronounce">🎯 Pronounce</span>`;

  // Safe converter: Plain Unicode symbols -> Pre-styled inline tags
  const convertPlainSymbolsToTags = useCallback((htmlOrText: string): string => {
    if (!htmlOrText) return '';
    if (htmlOrText.includes('data-tag-type=')) return htmlOrText;
    return htmlOrText
      .replace(/✓/g, CORRECT_TAG_HTML)
      .replace(/✗/g, INCORRECT_TAG_HTML)
      .replace(/\[New Word\]/gi, NEW_WORD_TAG_HTML)
      .replace(/\[Pronounce\]/gi, PRONOUNCE_TAG_HTML);
  }, [CORRECT_TAG_HTML, INCORRECT_TAG_HTML, NEW_WORD_TAG_HTML, PRONOUNCE_TAG_HTML]);

  // Safe formatter: Ensures tags are styled and raw newlines are cleanly converted to <br/> for seamless arrow key navigation
  const formatContentForEditor = useCallback((content: string): string => {
    if (!content) return '';
    let formatted = convertPlainSymbolsToTags(content);
    if (!formatted.includes('<div') && !formatted.includes('<p') && !formatted.includes('<br')) {
      formatted = formatted.replace(/\r\n/g, '\n').replace(/\n/g, '<br/>');
    }
    return formatted;
  }, [convertPlainSymbolsToTags]);

  // Safe converter: Inline tag HTML -> Clean plain symbols for Google Meet Chat
  const convertTagsToPlainSymbolsForMeet = useCallback((htmlOrText: string): string => {
    if (!htmlOrText) return '';
    return htmlOrText
      .replace(/<span[^>]*data-tag-type="correct"[^>]*>[\s\S]*?<\/span>/gi, '✓')
      .replace(/<span[^>]*data-tag-type="incorrect"[^>]*>[\s\S]*?<\/span>/gi, '✗')
      .replace(/<span[^>]*data-tag-type="new-word"[^>]*>[\s\S]*?<\/span>/gi, '[New Word]')
      .replace(/<span[^>]*data-tag-type="pronounce"[^>]*>[\s\S]*?<\/span>/gi, '[Pronounce]')
      .replace(/<br\s*[\/]?>/gi, '\n')
      .replace(/<\/div>/gi, '\n')
      .replace(/<div>/gi, '')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<p>/gi, '')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>');
  }, []);

  // Coaching stamps metrics (counts both pre-styled tags and any raw plain symbols without double counting)
  const tagCorrectCount = (notesContent.match(/data-tag-type="correct"/g) || []).length;
  const plainCorrectCount = (notesContent.replace(/<span[^>]*data-tag-type="correct"[^>]*>[\s\S]*?<\/span>/gi, '').match(/✓/g) || []).length;
  const correctCount = tagCorrectCount + plainCorrectCount;

  const tagIncorrectCount = (notesContent.match(/data-tag-type="incorrect"/g) || []).length;
  const plainIncorrectCount = (notesContent.replace(/<span[^>]*data-tag-type="incorrect"[^>]*>[\s\S]*?<\/span>/gi, '').match(/✗/g) || []).length;
  const incorrectCount = tagIncorrectCount + plainIncorrectCount;

  const tagNewWordCount = (notesContent.match(/data-tag-type="new-word"/g) || []).length;
  const plainNewWordCount = (notesContent.replace(/<span[^>]*data-tag-type="new-word"[^>]*>[\s\S]*?<\/span>/gi, '').match(/\[New Word\]/gi) || []).length;
  const newWordCount = tagNewWordCount + plainNewWordCount;

  const tagPronounceCount = (notesContent.match(/data-tag-type="pronounce"/g) || []).length;
  const plainPronounceCount = (notesContent.replace(/<span[^>]*data-tag-type="pronounce"[^>]*>[\s\S]*?<\/span>/gi, '').match(/\[Pronounce\]/gi) || []).length;
  const pronounceCount = tagPronounceCount + plainPronounceCount;

  // Google Drive state & backend service integration (uses pre-authenticated platform credentials mapped to teacher's email)
  const [driveSyncStatus, setDriveSyncStatus] = useState<'idle' | 'syncing' | 'synced' | 'error'>('idle');
  const [driveFileId, setDriveFileId] = useState<string | null>(null);
  const [driveFileUrl, setDriveFileUrl] = useState<string | null>(null);
  const [driveFileName, setDriveFileName] = useState<string | null>(null);
  const [driveLastSyncedAt, setDriveLastSyncedAt] = useState<string | null>(null);
  const [driveSyncError, setDriveSyncError] = useState<string | null>(null);
  const [driveSuccessToast, setDriveSuccessToast] = useState<string | null>(null);
  const [driveAutoUpdateConfirmed, setDriveAutoUpdateConfirmed] = useState<boolean>(false);

  // Explicit User Confirmation Dialog for modifying existing Google Drive file
  const [showDriveConfirmModal, setShowDriveConfirmModal] = useState<boolean>(false);
  const [pendingDriveUpdate, setPendingDriveUpdate] = useState<{
    fileId: string;
    fileName: string;
    content: string;
    topic: string;
  } | null>(null);

  // Editor refs for contentEditable canvas and controlled persistence guards
  const editorRef = useRef<HTMLDivElement>(null);
  const splitEditorRef = useRef<HTMLDivElement>(null);
  const textareaRef = editorRef as any; // For full backwards compatibility
  const overlayRef = useRef<HTMLDivElement>(null);
  const autoSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isInitialLoadRef = useRef<boolean>(true);
  const isUserTypingRef = useRef<boolean>(false);
  const isDirtyRef = useRef<boolean>(false);
  const isSavingRef = useRef<boolean>(false);
  const loadedSessionKeyRef = useRef<string>('');
  const prevStudentFilterRef = useRef<string | undefined>(undefined);
  const isInitialMountRef = useRef<boolean>(true);
  const lastSavedContentRef = useRef<{ content: string; topic: string; sessionKey: string }>({
    content: '',
    topic: '',
    sessionKey: '',
  });

  const getActiveEditor = useCallback((): HTMLDivElement | null => {
    return editorViewMode === 'split' ? splitEditorRef.current : editorRef.current;
  }, [editorViewMode]);

  const focusEditorAtEnd = useCallback((el: HTMLElement | null) => {
    if (!el) return;
    try {
      el.focus();
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    } catch {}
  }, []);

  // Synchronize student and initial default lesson when selectedStudentFilter changes from parent
  // ALWAYS defaults to today's date for a new lesson session
  useEffect(() => {
    try {
      // Check if filter has genuinely changed from parent or is initial mount
      const filterHasChanged = selectedStudentFilter !== prevStudentFilterRef.current;
      if (!filterHasChanged && !isInitialMountRef.current) {
        return;
      }
      isInitialMountRef.current = false;
      prevStudentFilterRef.current = selectedStudentFilter;

      const todayStr = getTodayDateStr();

      if (selectedStudentFilter && selectedStudentFilter !== 'all') {
        const filterStr = String(selectedStudentFilter).toLowerCase().trim();
        setSelectedStudentEmail(selectedStudentFilter);

        // Find matching lessons for this student
        const studentLessons = teacherLessons.filter(
          (l) => l?.studentEmail && (l.studentEmail || '').toLowerCase().trim() === filterStr
        );

        // Check if there is an active lesson scheduled specifically for TODAY
        const lessonToday = studentLessons.find(
          (l) =>
            l &&
            l.startDateTime &&
            typeof l.startDateTime === 'string' &&
            l.startDateTime.startsWith(todayStr)
        );

        if (lessonToday && lessonToday.id) {
          // If a lesson is scheduled for today, select it
          setSelectedLessonId(lessonToday.id);
          setSessionDate(todayStr);
        } else {
          // Always default to today's date for a new lesson (never automatically select old past dates!)
          setSelectedLessonId('');
          setSessionDate(todayStr);
        }
      } else {
        // No specific student filter from parent
        const lessonToday = teacherLessons.find(
          (l) =>
            l &&
            l.startDateTime &&
            typeof l.startDateTime === 'string' &&
            l.startDateTime.startsWith(todayStr)
        );

        if (lessonToday && lessonToday.id) {
          setSelectedLessonId(lessonToday.id);
          setSessionDate(todayStr);
          if (lessonToday.studentEmail) {
            setSelectedStudentEmail(lessonToday.studentEmail);
          }
        } else {
          setSelectedLessonId('');
          setSessionDate(todayStr);
          if (safeStudents.length > 0 && !selectedStudentEmail) {
            const firstValidStudent = safeStudents.find((s) => s && s.email);
            if (firstValidStudent?.email) {
              setSelectedStudentEmail(firstValidStudent.email);
            }
          }
        }
      }
    } catch (err) {
      console.warn('TeacherLiveLessonNotesPanel: Error syncing student filter', err);
    }
  }, [selectedStudentFilter, teacherLessons, safeStudents, getTodayDateStr]);

  // Selected student object (safe memoized lookup)
  const activeStudent = useMemo(() => {
    const targetEmail = (selectedStudentEmail || '').toLowerCase().trim();
    if (!targetEmail) return undefined;
    return safeStudents.find(
      (s) =>
        Boolean(s) &&
        (((s.email || '').toLowerCase().trim() === targetEmail) ||
          s.uid === selectedStudentEmail ||
          s.id === selectedStudentEmail)
    );
  }, [safeStudents, selectedStudentEmail]);

  const activeLesson = useMemo(() => {
    return teacherLessons.find((l) => l && l.id === selectedLessonId);
  }, [teacherLessons, selectedLessonId]);

  // Centralized Canonical Student Identity Resolution
  const studentResolution = useMemo<{
    uid: string;
    error: string | null;
    hasDivergence: boolean;
    source: 'prop' | 'student_doc' | 'lesson' | 'none';
  }>(() => {
    const teacherUidVal = (currentAccount?.uid || (currentAccount as any)?.id || auth.currentUser?.uid || '').trim();
    const cleanSelectedEmail = (selectedStudentEmail || '').toLowerCase().trim();
    const cleanFilter = (selectedStudentFilter || '').toLowerCase().trim();

    // Check if teacher UID was improperly provided as student UID
    const rawPropUid = (studentUid || '').trim();
    if (rawPropUid && teacherUidVal && rawPropUid === teacherUidVal) {
      return {
        uid: '',
        error: 'Identity Error: Teacher UID cannot be used as student UID.',
        hasDivergence: true,
        source: 'none',
      };
    }

    // Determine if the prop studentUid is coherent with the selected student
    let isPropCoherent = false;
    if (rawPropUid && isValidCanonicalUid(rawPropUid)) {
      if (!cleanFilter || cleanFilter === 'all') {
        isPropCoherent = true;
      } else {
        const filterMatchesEmail = cleanFilter === cleanSelectedEmail;
        const filterMatchesStudent = Boolean(
          activeStudent &&
          (((activeStudent.email || '').toLowerCase().trim() === cleanFilter) ||
           activeStudent.uid === cleanFilter ||
           activeStudent.id === cleanFilter)
        );
        const propMatchesActiveStudent = Boolean(
          activeStudent && (activeStudent.uid === rawPropUid || (activeStudent as any)?.studentUid === rawPropUid)
        );
        isPropCoherent = filterMatchesEmail || filterMatchesStudent || propMatchesActiveStudent;
      }
    }

    const validPropUid = isPropCoherent && isValidCanonicalUid(rawPropUid) ? rawPropUid : '';

    // Candidate from active student profile doc in studentsList
    const docUidRaw = (
      activeStudent?.uid ||
      (activeStudent as any)?.studentUid ||
      (activeStudent?.id && isValidCanonicalUid(activeStudent.id) ? activeStudent.id : '') ||
      ''
    ).trim();
    const validDocUid = (docUidRaw && isValidCanonicalUid(docUidRaw) && docUidRaw !== teacherUidVal) ? docUidRaw : '';

    // Candidate from active lesson (if editing existing lesson for this student)
    const isEditingExistingLesson = Boolean(selectedLessonId && activeLesson);
    const lessonUidRaw = isEditingExistingLesson ? (activeLesson?.studentUid || '').trim() : '';
    const validLessonUid = (lessonUidRaw && isValidCanonicalUid(lessonUidRaw) && lessonUidRaw !== teacherUidVal) ? lessonUidRaw : '';

    // Verify divergence between available valid sources for the current selection
    const uidsFound: { source: string; uid: string }[] = [];
    if (validPropUid) uidsFound.push({ source: 'parent component', uid: validPropUid });
    if (validDocUid) uidsFound.push({ source: 'student profile', uid: validDocUid });
    if (validLessonUid) uidsFound.push({ source: 'existing lesson', uid: validLessonUid });

    const distinctUids = Array.from(new Set(uidsFound.map((u) => u.uid)));
    if (distinctUids.length > 1) {
      const details = uidsFound.map((u) => `${u.source}: ${u.uid}`).join(', ');
      return {
        uid: '',
        error: `Identity Error: Divergent UIDs detected for the same student (${details}). Operation blocked for security.`,
        hasDivergence: true,
        source: 'none',
      };
    }

    // Priority 1: Canonical UID received from parent component (when validated & coherent)
    if (validPropUid) {
      return { uid: validPropUid, error: null, hasDivergence: false, source: 'prop' };
    }

    // Priority 2: Student document from safeStudents (studentsList)
    if (validDocUid) {
      return { uid: validDocUid, error: null, hasDivergence: false, source: 'student_doc' };
    }

    // Priority 3: Existing lesson's studentUid (when editing existing lesson)
    if (validLessonUid) {
      return { uid: validLessonUid, error: null, hasDivergence: false, source: 'lesson' };
    }

    // No valid canonical UID found
    return {
      uid: '',
      error: cleanSelectedEmail
        ? 'Identity Error: Canonical student UID missing. Saving blocked to protect data integrity.'
        : null,
      hasDivergence: false,
      source: 'none',
    };
  }, [
    studentUid,
    selectedStudentFilter,
    selectedStudentEmail,
    activeStudent,
    activeLesson,
    selectedLessonId,
    currentAccount?.uid,
    (currentAccount as any)?.id,
  ]);

  // Generate initial starter template: completely blank page with only Date, Student, and Topic annotations as shown in user screenshot
  const getStarterTemplate = useCallback(
    (studentName: string, dateStr: string, currentTopic: string) => {
      const topicStr = (currentTopic || '').trim() || 'Trial';
      const safeName = (studentName || '').trim() || 'Student';
      const safeDate = (dateStr || '').trim() || new Date().toISOString().split('T')[0];
      return `Native Friend In-Session Notes & Recommendations\nDate: ${safeDate} | Student: ${safeName}\nTopic: ${topicStr}\n\n`;
    },
    []
  );

  // Helper to detect if existing content is merely the old boilerplate template
  const isOnlyOldTemplate = (content: string) => {
    if (!content || !content.trim()) return true;
    const cleaned = content.replace(/\r\n/g, '\n').trim();
    if (
      cleaned.includes('🎯 PRONUNCIATION & PHONETICS:') &&
      cleaned.includes('💬 KEY VOCABULARY & NATURAL PHRASES:') &&
      cleaned.includes('⚡ GRAMMAR & PHRASING CORRECTIONS:')
    ) {
      const lines = cleaned.split('\n');
      const hasCustomNotes = lines.some((line) => {
        const trimmed = line.trim();
        if (trimmed.startsWith('•') && trimmed.replace(/^[•\-\s]+/, '').trim().length > 0) {
          return true;
        }
        if (trimmed.startsWith('Instead of:') && trimmed.replace('Instead of:', '').trim().length > 0) {
          return true;
        }
        if (trimmed.startsWith('Say:') && trimmed.replace('Say:', '').trim().length > 0) {
          return true;
        }
        return false;
      });
      return !hasCustomNotes;
    }
    return false;
  };

  const currentSessionKey = selectedLessonId
    ? `lesson_${selectedLessonId}`
    : `student_${(selectedStudentEmail || '').toLowerCase().trim()}_${sessionDate}`;

  // When selected lesson or student changes, populate document cleanly without triggering save loops
  useEffect(() => {
    if (!currentSessionKey) return;
    if (loadedSessionKeyRef.current === currentSessionKey) {
      return;
    }
    loadedSessionKeyRef.current = currentSessionKey;
    isInitialLoadRef.current = true;

    // Clear any pending autosave from previous session
    if (autoSaveTimeoutRef.current) {
      clearTimeout(autoSaveTimeoutRef.current);
      autoSaveTimeoutRef.current = null;
    }

    // Reset AI pedagogical draft and approval states for fresh session
    setDraftTransformation(null);
    setLastApprovedVersion(null);
    setApprovalStatus('unapproved');
    setEditableTransformation(null);
    setVersionHistory([]);
    setShowVersionHistory(false);
    setAiError(null);
    setAiSuccessMessage(null);

    let initialContent = '';
    let initialTopic = '';
    let initialDriveId: string | null = null;
    let initialDriveUrl: string | null = null;
    let initialDriveSyncedAt: string | null = null;
    let initialSavedAt: string | null = null;

    try {
      const currentLesson = teacherLessons.find((l) => l && l.id === selectedLessonId);

      if (currentLesson) {
        if (currentLesson.studentEmail && currentLesson.studentEmail !== selectedStudentEmail) {
          setSelectedStudentEmail(currentLesson.studentEmail);
        }
        const lessonTopic = currentLesson.title || 'Trial';
        initialTopic = lessonTopic;

        // Preferred unified document: sessionNotesDocument > liveNotes > recommendations
        const docContent =
          currentLesson.sessionNotesDocument ||
          currentLesson.liveNotes ||
          currentLesson.recommendations ||
          '';

        if (docContent.trim() && !isOnlyOldTemplate(docContent)) {
          initialContent = docContent;
        } else {
          const sName = resolveStudentName(
            activeStudent,
            currentLesson,
            currentLesson.studentEmail || selectedStudentEmail
          );
          const dateStr =
            currentLesson.startDateTime && typeof currentLesson.startDateTime === 'string'
              ? currentLesson.startDateTime.split('T')[0]
              : sessionDate;
          initialContent = getStarterTemplate(sName, dateStr, lessonTopic);
        }

        if (currentLesson.notesLastSavedAt) {
          initialSavedAt = currentLesson.notesLastSavedAt;
        }

        if (currentLesson.driveFileId) {
          initialDriveId = currentLesson.driveFileId;
          initialDriveUrl = currentLesson.driveFileUrl || null;
          initialDriveSyncedAt = currentLesson.driveLastSyncedAt || null;
        }
      } else if (selectedStudentEmail) {
        const studentEmailLower = selectedStudentEmail.toLowerCase().trim();
        const studentLessons = teacherLessons.filter(
          (l) => l?.studentEmail && (l.studentEmail || '').toLowerCase().trim() === studentEmailLower
        );
        // Check if there is a lesson on this exact sessionDate with notes
        const lessonOnDate = studentLessons.find(
          (l) =>
            l &&
            l.startDateTime &&
            typeof l.startDateTime === 'string' &&
            l.startDateTime.startsWith(sessionDate) &&
            (l.sessionNotesDocument || l.liveNotes || l.recommendations)
        );

        if (
          lessonOnDate &&
          !isOnlyOldTemplate(
            lessonOnDate.sessionNotesDocument ||
              lessonOnDate.liveNotes ||
              lessonOnDate.recommendations ||
              ''
          )
        ) {
          initialTopic = lessonOnDate.title || 'Trial';
          initialContent =
            lessonOnDate.sessionNotesDocument ||
            lessonOnDate.liveNotes ||
            lessonOnDate.recommendations ||
            '';
          if (lessonOnDate.notesLastSavedAt) {
            initialSavedAt = lessonOnDate.notesLastSavedAt;
          }
          if (lessonOnDate.driveFileId) {
            initialDriveId = lessonOnDate.driveFileId;
            initialDriveUrl = lessonOnDate.driveFileUrl || null;
            initialDriveSyncedAt = lessonOnDate.driveLastSyncedAt || null;
          }
        } else {
          const defaultTopic = 'Trial';
          initialTopic = defaultTopic;
          const sName = resolveStudentName(activeStudent, null, selectedStudentEmail);
          initialContent = getStarterTemplate(sName, sessionDate, defaultTopic);
        }
      }
    } catch (err) {
      console.warn('TeacherLiveLessonNotesPanel: Error populating notes document', err);
    }

    setTopic(initialTopic);
    setNotesContent(initialContent);
    setLastSavedTimestamp(initialSavedAt);
    setDriveFileId(initialDriveId);
    setDriveFileUrl(initialDriveUrl);
    setDriveLastSyncedAt(initialDriveSyncedAt);
    setDriveSyncStatus(initialDriveId ? 'synced' : 'idle');

    // Mark as clean initial state
    isDirtyRef.current = false;
    lastSavedContentRef.current = {
      content: initialContent,
      topic: initialTopic,
      sessionKey: currentSessionKey,
    };

    // Update DOM editor
    const formatted = formatContentForEditor(initialContent);
    const editor = getActiveEditor();
    if (editor) {
      if (editor.innerHTML !== formatted) {
        editor.innerHTML = formatted;
        lastInternalHtmlRef.current = formatted;
      }
      focusEditorAtEnd(editor);
    }

    // Asynchronously verify with /api/session-notes to guarantee the full HTML is retrieved
    let cancelled = false;
    const fetchSavedNotes = async () => {
      try {
        const queryParams = new URLSearchParams();
        if (selectedLessonId) queryParams.set('lessonId', selectedLessonId);
        if (currentSessionKey) queryParams.set('id', currentSessionKey);
        if (selectedStudentEmail) queryParams.set('studentEmail', selectedStudentEmail);
        const resolvedStudentUid = studentResolution.uid;
        if (resolvedStudentUid) queryParams.set('studentUid', resolvedStudentUid);
        if (sessionDate) queryParams.set('sessionDate', sessionDate);

        const idToken = await auth.currentUser?.getIdToken().catch(() => null);
        const res = await fetch(`/api/session-notes?${queryParams.toString()}`, {
          headers: {
            ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
          },
        });
        if (res.ok && !cancelled) {
          const data = await res.json();
          const savedNote = Array.isArray(data) ? data[0] : data;
          if (savedNote) {
            if (savedNote.content && savedNote.content.trim() && !isOnlyOldTemplate(savedNote.content)) {
              const serverContent = savedNote.content;
              setNotesContent(serverContent);
              if (savedNote.topic) setTopic(savedNote.topic);
              if (savedNote.updatedAt) setLastSavedTimestamp(savedNote.updatedAt);
              if (savedNote.driveFileId) {
                setDriveFileId(savedNote.driveFileId);
                setDriveFileUrl(savedNote.driveFileUrl || null);
                setDriveLastSyncedAt(savedNote.driveLastSyncedAt || null);
                setDriveSyncStatus('synced');
              }
              lastSavedContentRef.current = {
                content: serverContent,
                topic: savedNote.topic || initialTopic,
                sessionKey: currentSessionKey,
              };
              const f = formatContentForEditor(serverContent);
              const ed = getActiveEditor();
              if (ed && ed.innerHTML !== f) {
                ed.innerHTML = f;
                lastInternalHtmlRef.current = f;
              }
            }

            // FASE NF-DOC.2C: Restore draft, approved versions and editable transformation
            if (savedNote.draftTransformation) {
              setDraftTransformation(savedNote.draftTransformation);
              if (savedNote.draftTransformation.transformation) {
                setEditableTransformation(JSON.parse(JSON.stringify(savedNote.draftTransformation.transformation)));
              }
            } else {
              setDraftTransformation(null);
            }

            if (savedNote.lastApprovedVersion) {
              setLastApprovedVersion(savedNote.lastApprovedVersion);
              if (!savedNote.draftTransformation && savedNote.lastApprovedVersion.transformation) {
                setEditableTransformation(JSON.parse(JSON.stringify(savedNote.lastApprovedVersion.transformation)));
              }
            } else {
              setLastApprovedVersion(null);
            }

            setApprovalStatus(
              savedNote.approvalStatus ||
              (savedNote.lastApprovedVersion ? 'approved' : savedNote.draftTransformation ? 'draft_in_progress' : 'unapproved')
            );
            setVersionHistory(Array.isArray(savedNote.versionHistory) ? savedNote.versionHistory : []);
          }
        }
      } catch {
        // silent fallback to initialContent
      }
    };
    fetchSavedNotes();

    const timer = setTimeout(() => {
      isInitialLoadRef.current = false;
    }, 100);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [currentSessionKey]);

  const updateDocumentHeader = useCallback(
    (newDate?: string, newStudentEmail?: string, newTopic?: string) => {
      setNotesContent((prev) => {
        if (!prev) return prev;
        const lines = prev.split('\n');
        if (lines.length >= 2 && lines[0]?.includes('Native Friend In-Session Notes')) {
          if (newDate && lines[1]?.startsWith('Date:')) {
            const studentPart = lines[1].includes('|')
              ? lines[1].split('|')[1]
              : ` Student: ${activeStudent?.name || 'Student'}`;
            lines[1] = `Date: ${newDate} |${studentPart}`;
          }
          if (newTopic && lines[2]?.startsWith('Topic:')) {
            lines[2] = `Topic: ${newTopic}`;
          }
          return lines.join('\n');
        }
        return prev;
      });
    },
    [activeStudent?.name]
  );

  const handleTopicChange = (newTopic: string) => {
    isDirtyRef.current = true;
    setTopic(newTopic);
    updateDocumentHeader(undefined, undefined, newTopic);
  };

  const handleSessionChange = useCallback(
    (newLessonId: string) => {
      // If dirty, persist current document before switching
      if (isDirtyRef.current && lastSavedContentRef.current.sessionKey) {
        persistSessionDocumentRef.current?.(notesContent, topic, false);
      }

      setSelectedLessonId(newLessonId);

      if (newLessonId) {
        const chosenLesson = teacherLessons.find((l) => l && l.id === newLessonId);
        if (chosenLesson) {
          if (chosenLesson.studentEmail && chosenLesson.studentEmail !== selectedStudentEmail) {
            setSelectedStudentEmail(chosenLesson.studentEmail);
          }
          if (chosenLesson.startDateTime && typeof chosenLesson.startDateTime === 'string') {
            const datePart = chosenLesson.startDateTime.split('T')[0];
            if (datePart) {
              setSessionDate(datePart);
              updateDocumentHeader(datePart, chosenLesson.studentEmail, chosenLesson.title);
            }
          }
          if (chosenLesson.title) {
            setTopic(chosenLesson.title);
          }
        }
      } else {
        // Switched to New Lesson Today: always reset date to current date (=today)
        const todayStr = getTodayDateStr();
        setSessionDate(todayStr);
        setTopic('Trial');
        updateDocumentHeader(todayStr, undefined, 'Trial');
      }
    },
    [teacherLessons, selectedStudentEmail, notesContent, topic, updateDocumentHeader, getTodayDateStr]
  );

  const handleDateChange = useCallback(
    (newDate: string) => {
      if (!newDate) return;
      isDirtyRef.current = true;
      setSessionDate(newDate);
      updateDocumentHeader(newDate);

      // Check if there is an existing session for this student on the chosen date
      const studentClean = (selectedStudentEmail || '').toLowerCase().trim();
      const matchingLessons = teacherLessons.filter((l) => {
        if (!l?.startDateTime || typeof l.startDateTime !== 'string') return false;
        const lStudentClean = (l.studentEmail || '').toLowerCase().trim();
        const matchesStudent = !studentClean || (lStudentClean && lStudentClean === studentClean);
        return matchesStudent && l.startDateTime.startsWith(newDate);
      });

      if (matchingLessons.length > 0) {
        // If current selectedLessonId is already one of the lessons on this date, keep it
        const alreadySelected = matchingLessons.find((l) => l.id === selectedLessonId);
        if (!alreadySelected) {
          // Synchronize to the matching lesson on that date
          const targetLesson = matchingLessons[0];
          setSelectedLessonId(targetLesson.id);
          if (targetLesson.title) {
            setTopic(targetLesson.title);
          }
        }
      } else {
        // Independent: No existing lesson on this date, allow free custom date session on newDate without reverting!
        setSelectedLessonId('');
      }
    },
    [selectedStudentEmail, teacherLessons, selectedLessonId, updateDocumentHeader]
  );

  const handleResetDocument = () => {
    try {
      const sName = resolveStudentName(activeStudent, activeLesson, selectedStudentEmail);
      const effTopic = topic || activeLesson?.title || 'Trial';
      const starter = getStarterTemplate(sName, sessionDate, effTopic);
      isDirtyRef.current = true;
      setNotesContent(starter);
      const editor = getActiveEditor();
      if (editor) {
        const formatted = formatContentForEditor(starter);
        editor.innerHTML = formatted;
        lastInternalHtmlRef.current = formatted;
      }
      setTimeout(() => {
        focusEditorAtEnd(getActiveEditor());
      }, 50);
    } catch (err) {
      console.warn('TeacherLiveLessonNotesPanel: Error resetting document', err);
    }
  };

  // Past notes history for this student (sorted in descending order by date)
  const studentHistory = useMemo(() => {
    return teacherLessons
      .filter((l) => {
        if (!l) return false;
        const lEmail = (l.studentEmail || '').toLowerCase().trim();
        const currEmail = (selectedStudentEmail || '').toLowerCase().trim();
        const matchesStudent = !currEmail || (lEmail && lEmail === currEmail);
        const hasNotes = Boolean(
          (l.sessionNotesDocument && l.sessionNotesDocument.trim()) ||
          (l.liveNotes && l.liveNotes.trim()) ||
          (l.recommendations && l.recommendations.trim()) ||
          (Array.isArray(l.vocabularyNotes) && l.vocabularyNotes.length > 0)
        );
        return matchesStudent && hasNotes;
      })
      .sort((a, b) => {
        const timeA = a.startDateTime ? new Date(a.startDateTime).getTime() : 0;
        const timeB = b.startDateTime ? new Date(b.startDateTime).getTime() : 0;
        return timeB - timeA; // Descending: newest first
      });
  }, [teacherLessons, selectedStudentEmail]);

  /**
   * Executes Google Drive file upload/update using the teacher's Google OAuth credentials directly
   * into their personal Google Drive inside "It's Simple - Session Notes"
   */
  const executeDriveSync = useCallback(
    async (
      contentToSync: string,
      topicToSync: string,
      sName: string,
      effDate: string,
      targetFileId?: string
    ) => {
      if (isSavingRef.current || driveSyncStatus === 'syncing') return;
      if (studentResolution.error || !studentResolution.uid) {
        setDriveSyncStatus('error');
        setDriveSyncError(studentResolution.error || 'Identity Error: Canonical student UID missing. Google Drive sync blocked.');
        return;
      }
      isSavingRef.current = true;
      try {
        setDriveSyncStatus('syncing');
        setDriveSyncError(null);

        // Step 1: Obtain or verify teacher's real Google OAuth token
        let activeToken = getGoogleOAuthToken() || googleOAuthToken;
        if (!activeToken) {
          try {
            activeToken = await connectGoogleDrive(currentAccount?.email || undefined);
          } catch (authErr: any) {
            console.warn('Google Drive auth error:', authErr);
            setDriveSyncStatus('error');
            setDriveSyncError('Google Drive authentication required. Please authorize your account.');
            isSavingRef.current = false;
            return;
          }
        }

        if (!activeToken) {
          setDriveSyncStatus('error');
          setDriveSyncError('Google Drive authentication required. Click the button to authorize.');
          isSavingRef.current = false;
          return;
        }

        const targetLessonId = selectedLessonId || (activeLesson ? activeLesson.id : '');
        const cleanEmail = (selectedStudentEmail || '').toLowerCase().trim();
        const sessionKey =
          targetLessonId ||
          `session_${effDate}_${cleanEmail ? cleanEmail.replace(/[^a-zA-Z0-9_-]/g, '_') : 'notes'}`;

        let resolvedFileId = targetFileId || driveFileId || (activeLesson as any)?.driveFileId || undefined;

        // Step 2: Direct Personal Google Drive Sync
        let res = await syncSessionNotesToGoogleDrive({
          accessToken: activeToken,
          studentName: sName,
          studentEmail: cleanEmail,
          teacherEmail: currentAccount?.email || '',
          teacherName: currentAccount?.name || 'Native Friend',
          sessionDate: effDate,
          topic: topicToSync,
          content: contentToSync,
          existingFileId: resolvedFileId,
          lessonId: targetLessonId || undefined,
          sessionKey,
        });

        // Step 3: Handle Token Expiration
        if (res.requiresAuth) {
          try {
            activeToken = await connectGoogleDrive(currentAccount?.email || undefined);
            if (activeToken) {
              res = await syncSessionNotesToGoogleDrive({
                accessToken: activeToken,
                studentName: sName,
                studentEmail: cleanEmail,
                teacherEmail: currentAccount?.email || '',
                teacherName: currentAccount?.name || 'Native Friend',
                sessionDate: effDate,
                topic: topicToSync,
                content: contentToSync,
                existingFileId: resolvedFileId,
                lessonId: targetLessonId || undefined,
                sessionKey,
              });
            }
          } catch (reAuthErr) {
            setDriveSyncStatus('error');
            setDriveSyncError('Session expired. Please authorize Google Drive again.');
            isSavingRef.current = false;
            return;
          }
        }

        if (res.success && res.fileId) {
          const syncedIso = new Date().toISOString();
          setDriveFileId(res.fileId);
          setDriveFileName(res.fileName || formatSessionNotesFileName(sName, effDate));
          if (res.webViewLink) setDriveFileUrl(res.webViewLink);
          setDriveLastSyncedAt(syncedIso);
          setDriveSyncStatus('synced');

          const toastMsg = res.isUpdated
            ? `File updated in your Google Drive ("It's Simple - Session Notes")`
            : `File created in your Google Drive ("It's Simple - Session Notes")`;
          setDriveSuccessToast(toastMsg);
          setTimeout(() => setDriveSuccessToast(null), 5000);

          const drivePayload = {
            driveFileId: res.fileId,
            driveFileUrl: res.webViewLink || '',
            driveFolderName: res.folderName || GOOGLE_DRIVE_SESSION_FOLDER,
            driveLastSyncedAt: syncedIso,
          };

          // Server API sync with Drive metadata (skipDriveSync prevents duplicate Google Drive operations)
          try {
            const idToken = await auth.currentUser?.getIdToken().catch(() => null);
            const resolvedStudentUid = studentResolution.uid;
            const resolvedTeacherUid = (currentAccount?.uid || auth.currentUser?.uid || '').trim();

            const syncApiRes = await fetch('/api/session-notes', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
              },
              body: JSON.stringify({
                id: sessionKey,
                sessionDate: effDate,
                lessonId: targetLessonId || undefined,
                studentEmail: cleanEmail,
                studentUid: resolvedStudentUid || undefined,
                teacherUid: resolvedTeacherUid || undefined,
                teacherEmail: currentAccount?.email || '',
                teacherName: currentAccount?.name || 'Native Friend',
                topic: topicToSync,
                content: contentToSync,
                rawContent: contentToSync,
                skipDriveSync: true,
                ...drivePayload,
              }),
            });
            if (syncApiRes.ok) {
              window.dispatchEvent(new CustomEvent('native-notes-updated'));
            }
          } catch {}

          // 3. Update lesson state in parent
          if (targetLessonId && typeof onSaveLessonNotes === 'function') {
            onSaveLessonNotes(targetLessonId, {
              topic: topicToSync,
              liveNotes: contentToSync,
              recommendations: contentToSync,
              sessionNotesDocument: contentToSync,
              sessionDate: effDate,
              ...drivePayload,
            });
          }
        } else {
          setDriveSyncStatus('error');
          setDriveSyncError(res.error || 'Failed to sync with Google Drive.');
        }
      } catch (err: any) {
        console.warn('executeDriveSync error:', err);
        setDriveSyncStatus('error');
        setDriveSyncError(err?.message || 'Error communicating with Google Drive.');
      } finally {
        isSavingRef.current = false;
      }
    },
    [
      studentResolution,
      selectedLessonId,
      activeLesson,
      selectedStudentEmail,
      driveFileId,
      driveSyncStatus,
      activeStudent,
      currentAccount,
      googleOAuthToken,
      connectGoogleDrive,
      onSaveLessonNotes,
    ]
  );

  /**
   * Save In-Session Notes to Firestore, Server, and Google Drive
   * Controlled persistence: guarded by isSavingRef and isDirtyRef to completely eliminate save loops
   */
  const persistSessionDocument = useCallback(
    async (
      contentToSave: string,
      topicToSave: string,
      explicitSave: boolean = false,
      forceServerSync: boolean = false
    ): Promise<boolean> => {
      // 1. Concurrency and dirty guard
      if (isSavingRef.current) {
        return false;
      }

      // Check canonical student identity resolution
      if (studentResolution.error || !studentResolution.uid) {
        const errMsg =
          studentResolution.error ||
          'Identity Error: Canonical student UID missing. Saving was blocked to protect data integrity.';
        setSaveError(errMsg);
        if (explicitSave) {
          setSavedSuccessBanner(false);
        }
        return false;
      }

      const resolvedStudentUid = studentResolution.uid;
      const targetLessonId = selectedLessonId || (activeLesson ? activeLesson.id : '');
      const cleanEmail = (selectedStudentEmail || '').toLowerCase().trim();
      const effectiveDate = sessionDate || new Date().toISOString().split('T')[0];
      const sessionKey =
        targetLessonId ||
        `session_${effectiveDate}_${cleanEmail ? cleanEmail.replace(/[^a-zA-Z0-9_-]/g, '_') : 'notes'}`;

      if (!cleanEmail && !targetLessonId) return false;

      // If not an explicit manual save or forced pre-AI sync, require the dirty flag and ensure content actually changed
      if (!explicitSave && !forceServerSync) {
        if (!isDirtyRef.current) return true;
        if (
          lastSavedContentRef.current.sessionKey === sessionKey &&
          lastSavedContentRef.current.content === contentToSave &&
          lastSavedContentRef.current.topic === topicToSave
        ) {
          isDirtyRef.current = false;
          return true;
        }
      }

      isSavingRef.current = true;
      setIsSaving(true);
      isDirtyRef.current = false;
      lastSavedContentRef.current = {
        content: contentToSave,
        topic: topicToSave,
        sessionKey,
      };

      try {
        const nowIso = new Date().toISOString();
        const sName = resolveStudentName(activeStudent, activeLesson, selectedStudentEmail);

        // Server API Persistence (canonical Firestore sync via backend without touching Google Drive)
        let serverSaveOk = true;
        try {
          const idToken = await auth.currentUser?.getIdToken().catch(() => null);
          const resolvedTeacherUid = (currentAccount?.uid || auth.currentUser?.uid || '').trim();

          const apiRes = await fetch('/api/session-notes', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
            },
            body: JSON.stringify({
              id: sessionKey,
              sessionDate: effectiveDate,
              lessonId: targetLessonId || undefined,
              studentEmail: cleanEmail,
              studentName: sName,
              studentUid: resolvedStudentUid,
              teacherUid: resolvedTeacherUid || undefined,
              teacherEmail: currentAccount?.email || '',
              teacherName: currentAccount?.name || 'Native Friend',
              topic: topicToSave,
              content: contentToSave,
              rawContent: contentToSave,
              driveFileId: driveFileId || undefined,
              driveFileUrl: driveFileUrl || undefined,
              driveFolderName: GOOGLE_DRIVE_SESSION_FOLDER,
              driveLastSyncedAt: driveLastSyncedAt || undefined,
              skipDriveSync: true,
            }),
          });
          if (!apiRes.ok) {
            serverSaveOk = false;
            const errData = await apiRes.json().catch(() => ({}));
            setSaveError(errData.error || errData.message || 'Error saving notes to server.');
          } else {
            const savedPayload = await apiRes.json().catch(() => null);
            if (Array.isArray(savedPayload?.sessionNote?.versionHistory)) {
              setVersionHistory(savedPayload.sessionNote.versionHistory);
            }
            setSaveError(null);
            window.dispatchEvent(new CustomEvent('native-notes-updated'));
          }
        } catch (err) {
          serverSaveOk = false;
          console.warn('Server /api/session-notes notice:', err);
        }

        // 3. Update lesson state in parent
        if (targetLessonId && typeof onSaveLessonNotes === 'function') {
          onSaveLessonNotes(targetLessonId, {
            topic: topicToSave,
            liveNotes: contentToSave,
            recommendations: contentToSave,
            sessionNotesDocument: contentToSave,
            sessionDate: effectiveDate,
            driveFileId: driveFileId || undefined,
            driveFileUrl: driveFileUrl || undefined,
            driveFolderName: GOOGLE_DRIVE_SESSION_FOLDER,
            driveLastSyncedAt: driveLastSyncedAt || undefined,
          });
        }

        setLastSavedTimestamp(nowIso);

        if (explicitSave) {
          setSavedSuccessBanner(true);
          setTimeout(() => setSavedSuccessBanner(false), 3000);
        }

        return serverSaveOk;
      } catch (err: any) {
        console.error('persistSessionDocument error:', err);
        setSavedSuccessBanner(false);
        return false;
      } finally {
        isSavingRef.current = false;
        setIsSaving(false);
      }
    },
    [
      studentResolution,
      selectedStudentEmail,
      selectedLessonId,
      sessionDate,
      activeLesson,
      activeStudent,
      currentAccount,
      driveFileId,
      driveFileUrl,
      driveLastSyncedAt,
      onSaveLessonNotes,
      resolveStudentName,
    ]
  );

  const resolveCanonicalServerSessionKey = useCallback(() => {
    const targetLessonId = selectedLessonId || (activeLesson ? activeLesson.id : '');
    const cleanEmail = (selectedStudentEmail || '').toLowerCase().trim();
    const effectiveDate = sessionDate || new Date().toISOString().split('T')[0];
    return (
      targetLessonId ||
      `session_${effectiveDate}_${cleanEmail ? cleanEmail.replace(/[^a-zA-Z0-9_-]/g, '_') : 'notes'}`
    );
  }, [selectedLessonId, activeLesson, selectedStudentEmail, sessionDate]);

  /**
   * FASE NF-DOC.2C: Apply AI
   * 1. Preserves editor, formatting, history, and shortcuts Alt+Y/N/W/P
   * 2. Persists original notes first before running transformation
   * 3. Triggers Gemini strictly via user click
   * 4. Displays real progress, error, and success banners without mock data
   * 5. Preserves original content and last approved version upon failure
   */
  const handleApplyAi = useCallback(async () => {
    if (isApplyingAi || isSaving) return;

    if (!notesContent || !notesContent.trim()) {
      setAiError('Notes are empty. Write session notes with pedagogical terms before applying AI.');
      return;
    }

    setAiError(null);
    setAiSuccessMessage(null);
    setIsApplyingAi(true);

    try {
      // 1. Mandatory: Save original notes first to ensure server is in sync
      const savedOk = await persistSessionDocument(notesContent, topic, false, true);
      if (!savedOk) {
        setAiError('Failed to save original notes before executing transformation.');
        setIsApplyingAi(false);
        return;
      }

      const idToken = await auth.currentUser?.getIdToken().catch(() => null);
      const resolvedTeacherUid = (currentAccount?.uid || (currentAccount as any)?.id || auth.currentUser?.uid || '').trim();
      const resolvedStudentUid = studentResolution.uid;
      const targetKey = resolveCanonicalServerSessionKey();

      const res = await fetch(`/api/session-notes/${encodeURIComponent(targetKey)}/transform`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({
          id: targetKey,
          sessionId: targetKey,
          sessionKey: targetKey,
          rawNotes: notesContent,
          topic,
          language: 'pt',
          studentUid: resolvedStudentUid,
          teacherUid: resolvedTeacherUid,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        const errMsg = data.message || data.error || 'Pedagogical transformation via AI failed. Original document was preserved intact without publishing.';
        setAiError(errMsg);
      } else if (data.draftTransformation) {
        setDraftTransformation(data.draftTransformation);
        if (data.draftTransformation.transformation) {
          setEditableTransformation(JSON.parse(JSON.stringify(data.draftTransformation.transformation)));
        }
        if (Array.isArray(data.sessionNote?.versionHistory)) {
          setVersionHistory(data.sessionNote.versionHistory);
        }
        setApprovalStatus('draft_in_progress');
        setAiSuccessMessage('Pedagogical transformation successfully generated by AI! Please review the content before approving.');
      } else {
        setAiError('Unexpected AI response. The original document was kept intact.');
      }
    } catch (err: any) {
      setAiError(err.message || 'Connection error when calling the AI service.');
    } finally {
      setIsApplyingAi(false);
    }
  }, [
    isApplyingAi,
    isSaving,
    notesContent,
    topic,
    persistSessionDocument,
    currentAccount,
    studentResolution,
    resolveCanonicalServerSessionKey,
  ]);

  /**
   * Persist edited AI draft to Firestore via POST /api/session-notes/:id/draft
   */
  const handleSaveDraft = useCallback(async () => {
    if (isSavingDraft || isApproving || !editableTransformation) return;

    if (isDraftStale) {
      setAiError('The pedagogical draft is outdated compared to the current session notes. Click Apply AI to refresh the draft first.');
      return;
    }

    setAiError(null);
    setAiSuccessMessage(null);
    setIsSavingDraft(true);

    try {
      const idToken = await auth.currentUser?.getIdToken().catch(() => null);
      const resolvedTeacherUid = (currentAccount?.uid || (currentAccount as any)?.id || auth.currentUser?.uid || '').trim();
      const resolvedStudentUid = studentResolution.uid;
      const targetKey = resolveCanonicalServerSessionKey();

      const res = await fetch(`/api/session-notes/${encodeURIComponent(targetKey)}/draft`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({
          id: targetKey,
          sessionId: targetKey,
          draftId: draftTransformation?.draftId,
          transformation: editableTransformation,
          studentUid: resolvedStudentUid,
          teacherUid: resolvedTeacherUid,
          changeSummary: 'Teacher saved draft edits prior to publishing',
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAiError(data.message || data.error || 'Failed to save pedagogical draft.');
      } else {
        if (data.sessionNote?.draftTransformation) {
          setDraftTransformation(data.sessionNote.draftTransformation);
        }
        if (Array.isArray(data.sessionNote?.versionHistory)) {
          setVersionHistory(data.sessionNote.versionHistory);
        }
        if (approvalStatus !== 'approved') {
          setApprovalStatus('draft_in_progress');
        }
        setAiSuccessMessage('Draft edits saved to Firestore.');
      }
    } catch (err: any) {
      setAiError(err.message || 'Connection error while saving draft.');
    } finally {
      setIsSavingDraft(false);
    }
  }, [
    isSavingDraft,
    isApproving,
    editableTransformation,
    isDraftStale,
    currentAccount,
    studentResolution,
    resolveCanonicalServerSessionKey,
    draftTransformation,
    approvalStatus,
  ]);

  const handleToggleVersionHistory = useCallback(async () => {
    const nextOpen = !showVersionHistory;
    setShowVersionHistory(nextOpen);
    if (!nextOpen) return;

    setIsLoadingVersions(true);
    try {
      const idToken = await auth.currentUser?.getIdToken().catch(() => null);
      const targetKey = resolveCanonicalServerSessionKey();
      const res = await fetch(`/api/session-notes/${encodeURIComponent(targetKey)}/versions`, {
        headers: {
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
      });
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        if (Array.isArray(data?.versionHistory)) {
          setVersionHistory(data.versionHistory);
        }
      }
    } catch {
      // keep currently loaded versionHistory
    } finally {
      setIsLoadingVersions(false);
    }
  }, [showVersionHistory, resolveCanonicalServerSessionKey]);

  /**
   * FASE NF-DOC.2C: Approve & Publish
   * 1. Publishes only when teacher clicks button
   * 2. Blocks stale drafts (when rawContent changed after draft)
   * 3. Publishes edited transformation directly to lastApprovedVersion
   * 4. Clears active draft and updates approval status
   */
  const handleApproveAndPublish = useCallback(async () => {
    if (isApproving || !editableTransformation) return;

    if (isDraftStale) {
      setAiError('The pedagogical draft is outdated compared to the current session notes. Modifications were made to notes after the draft. Generate or edit a new draft before approving.');
      return;
    }

    setAiError(null);
    setAiSuccessMessage(null);
    setIsApproving(true);

    try {
      const idToken = await auth.currentUser?.getIdToken().catch(() => null);
      const resolvedTeacherUid = (currentAccount?.uid || (currentAccount as any)?.id || auth.currentUser?.uid || '').trim();
      const resolvedStudentUid = studentResolution.uid;
      const targetKey = resolveCanonicalServerSessionKey();

      const res = await fetch(`/api/session-notes/${encodeURIComponent(targetKey)}/approve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({
          id: targetKey,
          sessionId: targetKey,
          draftId: draftTransformation?.draftId,
          transformation: editableTransformation,
          studentUid: resolvedStudentUid,
          teacherUid: resolvedTeacherUid,
          changeSummary: 'Teacher reviewed and approved pedagogical notes for student',
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        const errMsg = data.message || data.error || 'Failed to approve pedagogical report.';
        setAiError(errMsg);
      } else {
        setApprovalStatus('approved');
        if (data.approvedVersion) {
          setLastApprovedVersion(data.approvedVersion);
          setEditableTransformation(JSON.parse(JSON.stringify(data.approvedVersion.transformation)));
        }
        if (Array.isArray(data.sessionNote?.versionHistory)) {
          setVersionHistory(data.sessionNote.versionHistory);
        }
        setDraftTransformation(null);
        setAiSuccessMessage('Pedagogical report successfully approved and published for the student!');
        window.dispatchEvent(new CustomEvent('native-notes-updated'));
      }
    } catch (err: any) {
      setAiError(err.message || 'Connection error while approving report.');
    } finally {
      setIsApproving(false);
    }
  }, [
    isApproving,
    editableTransformation,
    isDraftStale,
    resolveCanonicalServerSessionKey,
    draftTransformation,
    studentResolution,
    currentAccount,
  ]);

  // Inline editing handlers for Pedagogical Report
  const handleUpdateMistake = useCallback((index: number, field: string, value: any) => {
    setEditableTransformation((prev: any) => {
      if (!prev) return prev;
      const list = Array.isArray(prev.mistakesAnalysis) ? [...prev.mistakesAnalysis] : [];
      if (!list[index]) return prev;
      list[index] = { ...list[index], [field]: value };
      return { ...prev, mistakesAnalysis: list };
    });
  }, []);

  const handleAddMistake = useCallback(() => {
    setEditableTransformation((prev: any) => {
      const list = Array.isArray(prev?.mistakesAnalysis) ? [...prev.mistakesAnalysis] : [];
      list.push({
        id: `mistake-${Date.now()}`,
        original: '',
        corrected: '',
        explanation: '',
        grammarRule: '',
        twoExamples: [''],
        commonPitfalls: '',
        similarFormsComparison: '',
        category: 'grammar',
      });
      return { ...(prev || {}), mistakesAnalysis: list };
    });
  }, []);

  const handleRemoveMistake = useCallback((index: number) => {
    setEditableTransformation((prev: any) => {
      if (!prev) return prev;
      const list = Array.isArray(prev.mistakesAnalysis) ? [...prev.mistakesAnalysis] : [];
      list.splice(index, 1);
      return { ...prev, mistakesAnalysis: list };
    });
  }, []);

  const handleUpdateGrammar = useCallback((index: number, field: string, value: any) => {
    setEditableTransformation((prev: any) => {
      if (!prev) return prev;
      const list = Array.isArray(prev.grammarPoints) ? [...prev.grammarPoints] : [];
      if (!list[index]) return prev;
      list[index] = { ...list[index], [field]: value };
      return { ...prev, grammarPoints: list };
    });
  }, []);

  const handleAddGrammar = useCallback(() => {
    setEditableTransformation((prev: any) => {
      const list = Array.isArray(prev?.grammarPoints) ? [...prev.grammarPoints] : [];
      list.push({
        id: `grammar-${Date.now()}`,
        topic: 'New Grammar Point',
        rule: '',
        form: '',
        usage: '',
        examples: [''],
        commonMistakes: '',
        comparisons: '',
      });
      return { ...(prev || {}), grammarPoints: list };
    });
  }, []);

  const handleRemoveGrammar = useCallback((index: number) => {
    setEditableTransformation((prev: any) => {
      if (!prev) return prev;
      const list = Array.isArray(prev.grammarPoints) ? [...prev.grammarPoints] : [];
      list.splice(index, 1);
      return { ...prev, grammarPoints: list };
    });
  }, []);

  const handleUpdateVocab = useCallback((index: number, field: string, value: any) => {
    setEditableTransformation((prev: any) => {
      if (!prev) return prev;
      const list = Array.isArray(prev.vocabularyAndExpressions) ? [...prev.vocabularyAndExpressions] : [];
      if (!list[index]) return prev;
      list[index] = { ...list[index], [field]: value };
      return { ...prev, vocabularyAndExpressions: list };
    });
  }, []);

  const handleToggleVocabTag = useCallback((index: number, tag: 'isNewWord' | 'isPronunciationFocus') => {
    setEditableTransformation((prev: any) => {
      if (!prev) return prev;
      const list = Array.isArray(prev.vocabularyAndExpressions) ? [...prev.vocabularyAndExpressions] : [];
      if (!list[index]) return prev;
      list[index] = { ...list[index], [tag]: !list[index][tag] };
      return { ...prev, vocabularyAndExpressions: list };
    });
  }, []);

  const handleAddVocab = useCallback(() => {
    setEditableTransformation((prev: any) => {
      const list = Array.isArray(prev?.vocabularyAndExpressions) ? [...prev.vocabularyAndExpressions] : [];
      list.push({
        id: `vocab-${Date.now()}`,
        term: '',
        partOfSpeech: 'Expression',
        category: 'Conversational Expressions',
        simpleDefinition: '',
        collocations: [],
        realExamples: [''],
        synonyms: [],
        register: 'conversational',
        registerNote: '',
        isNewWord: true,
        isPronunciationFocus: false,
      });
      return { ...(prev || {}), vocabularyAndExpressions: list };
    });
  }, []);

  const handleRemoveVocab = useCallback((index: number) => {
    setEditableTransformation((prev: any) => {
      if (!prev) return prev;
      const list = Array.isArray(prev.vocabularyAndExpressions) ? [...prev.vocabularyAndExpressions] : [];
      list.splice(index, 1);
      return { ...prev, vocabularyAndExpressions: list };
    });
  }, []);

  const handleUpdateQuickReview = useCallback((field: string, value: any) => {
    setEditableTransformation((prev: any) => {
      const summary = prev?.reviewSummary ? { ...prev.reviewSummary } : {};
      summary[field] = value;
      return { ...(prev || {}), reviewSummary: summary };
    });
  }, []);

  const handleResetToAiSuggestion = useCallback(() => {
    if (draftTransformation?.transformation) {
      setEditableTransformation(JSON.parse(JSON.stringify(draftTransformation.transformation)));
    } else if (lastApprovedVersion?.transformation) {
      setEditableTransformation(JSON.parse(JSON.stringify(lastApprovedVersion.transformation)));
    }
  }, [draftTransformation, lastApprovedVersion]);

  // Keep a stable ref to persistSessionDocument so autosave never re-triggers when persistSessionDocument is recreated
  const persistSessionDocumentRef = useRef(persistSessionDocument);
  useEffect(() => {
    persistSessionDocumentRef.current = persistSessionDocument;
  });

  const handleConfirmDriveUpdate = () => {
    try {
      if (!pendingDriveUpdate) return;
      const { fileId, content, topic } = pendingDriveUpdate;
      setShowDriveConfirmModal(false);
      setPendingDriveUpdate(null);
      setDriveAutoUpdateConfirmed(true);

      const sName = resolveStudentName(activeStudent, activeLesson, selectedStudentEmail);
      const effDate = sessionDate || new Date().toISOString().split('T')[0];
      executeDriveSync(content, topic, sName, effDate, fileId);
    } catch (err) {
      console.warn('handleConfirmDriveUpdate error:', err);
    }
  };

  /**
   * Dedicated On-Demand Google Drive Sync Trigger:
   * Google Drive synchronization is strictly performed on-demand when the teacher clicks this button.
   */
  const handleSyncToGoogleDriveClick = async () => {
    try {
      if (isSavingRef.current || driveSyncStatus === 'syncing') return;
      setDriveSyncError(null);
      const sName = resolveStudentName(activeStudent, activeLesson, selectedStudentEmail);
      const effDate = sessionDate || new Date().toISOString().split('T')[0];
      const fileName = formatSessionNotesFileName(sName, effDate);

      // If document is already linked, confirm before updating
      if (driveFileId) {
        setPendingDriveUpdate({
          fileId: driveFileId,
          fileName: driveFileName || fileName,
          content: notesContent,
          topic,
        });
        setShowDriveConfirmModal(true);
        return;
      }

      await executeDriveSync(notesContent, topic, sName, effDate);
    } catch (err: any) {
      console.warn('handleSyncToGoogleDriveClick error:', err);
      setDriveSyncStatus('error');
      setDriveSyncError(err?.message || 'Error syncing with Google Drive.');
    }
  };

  const handleConnectDrive = handleSyncToGoogleDriveClick;

  // Track HTML originating from internal editor actions to avoid unnecessary innerHTML rewrites
  const lastInternalHtmlRef = useRef<string>('');

  // Dedicated editor change and auto-save handlers
  const handleEditorInput = (e: React.FormEvent<HTMLDivElement>) => {
    isUserTypingRef.current = true;
    isDirtyRef.current = true;
    const newHtml = (e.currentTarget as HTMLDivElement).innerHTML;
    lastInternalHtmlRef.current = newHtml;
    setNotesContent(newHtml);
    setTimeout(() => {
      isUserTypingRef.current = false;
    }, 150);
  };

  const handleEditorBlur = () => {
    isUserTypingRef.current = false;
    const editor = getActiveEditor();
    if (editor) {
      const currentHtml = editor.innerHTML;
      if (currentHtml !== notesContent) {
        lastInternalHtmlRef.current = currentHtml;
        setNotesContent(currentHtml);
      }
      if (isDirtyRef.current && !isSavingRef.current) {
        if (autoSaveTimeoutRef.current) {
          clearTimeout(autoSaveTimeoutRef.current);
          autoSaveTimeoutRef.current = null;
        }
        persistSessionDocument(currentHtml, topic, false);
      }
    }
  };

  // Helper: Create the DOM element for the inline tag component
  const createTagElement = useCallback((type: 'correct' | 'incorrect' | 'new-word' | 'pronounce'): HTMLSpanElement => {
    const span = document.createElement('span');
    span.setAttribute('data-tag-type', type);
    span.setAttribute('contenteditable', 'false');
    span.setAttribute('role', 'img');

    // Direct inline styles enforcing the exact design system colors and border radii
    span.style.display = 'inline-flex';
    span.style.alignItems = 'center';
    span.style.justifyContent = 'center';
    span.style.borderRadius = '6px';
    span.style.padding = '1px 6px';
    span.style.fontSize = '12px';
    span.style.lineHeight = '1.3';
    span.style.fontWeight = '700';
    span.style.verticalAlign = 'baseline';
    span.style.margin = '0 4px';
    span.style.userSelect = 'none';
    span.style.borderWidth = '1px';
    span.style.borderStyle = 'solid';

    if (type === 'correct') {
      span.className = 'inline-coaching-tag correct-tag inline-flex items-center justify-center font-bold text-xs px-1.5 py-0.5 rounded-md bg-[#ecfdf5] border border-[#15803d] text-[#15803d] mx-1 align-baseline shadow-2xs select-none';
      span.setAttribute('aria-label', 'Correct');
      span.title = 'Correct (✓)';
      span.style.backgroundColor = '#ecfdf5'; // Light green background
      span.style.borderColor = '#15803d';     // Dark green border
      span.style.color = '#15803d';           // Dark green symbol
      span.textContent = '✓';
    } else if (type === 'incorrect') {
      span.className = 'inline-coaching-tag incorrect-tag inline-flex items-center justify-center font-bold text-xs px-1.5 py-0.5 rounded-md bg-[#fff1f2] border border-[#b91c1c] text-[#b91c1c] mx-1 align-baseline shadow-2xs select-none';
      span.setAttribute('aria-label', 'Incorrect');
      span.title = 'Incorrect (✗)';
      span.style.backgroundColor = '#fff1f2'; // Light red background
      span.style.borderColor = '#b91c1c';     // Dark red border
      span.style.color = '#b91c1c';           // Dark red symbol
      span.textContent = '✗';
    } else if (type === 'new-word') {
      span.className = 'inline-coaching-tag new-word-tag inline-flex items-center justify-center font-bold text-xs px-1.5 py-0.5 rounded-md bg-[#eff6ff] border border-[#1d4ed8] text-[#1d4ed8] mx-1 align-baseline shadow-2xs select-none';
      span.setAttribute('aria-label', 'New Word');
      span.title = 'New Word (✦)';
      span.style.backgroundColor = '#eff6ff'; // Light blue background
      span.style.borderColor = '#1d4ed8';     // Blue border
      span.style.color = '#1d4ed8';           // Blue text
      span.textContent = '✦ New Word';
    } else if (type === 'pronounce') {
      span.className = 'inline-coaching-tag pronounce-tag inline-flex items-center justify-center font-bold text-xs px-1.5 py-0.5 rounded-md bg-[#faf5ff] border border-[#7e22ce] text-[#7e22ce] mx-1 align-baseline shadow-2xs select-none';
      span.setAttribute('aria-label', 'Pronounce');
      span.title = 'Pronounce (🎯)';
      span.style.backgroundColor = '#faf5ff'; // Light purple background
      span.style.borderColor = '#7e22ce';     // Purple border
      span.style.color = '#7e22ce';           // Purple text
      span.textContent = '🎯 Pronounce';
    }

    return span;
  }, []);

  // Controlled debounced auto-save (2.5 seconds after user stops typing)
  useEffect(() => {
    if (isInitialLoadRef.current || !isDirtyRef.current) return;

    if (autoSaveTimeoutRef.current) {
      clearTimeout(autoSaveTimeoutRef.current);
    }

    autoSaveTimeoutRef.current = setTimeout(() => {
      if (isInitialLoadRef.current) return;
      if (!isDirtyRef.current) return;
      if (isSavingRef.current) return;

      persistSessionDocumentRef.current?.(notesContent, topic, false);
    }, 2500);

    return () => {
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
      }
    };
  }, [notesContent, topic]);

  // Keep contentEditable innerHTML in sync when external notesContent changes (and not from internal typing)
  useEffect(() => {
    const editor = getActiveEditor();
    if (!editor) return;

    // If the change came from user typing or editing inside this editor, NEVER overwrite innerHTML
    if (notesContent === lastInternalHtmlRef.current) return;
    if (isUserTypingRef.current) return;

    const isFocused = document.activeElement === editor || editor.contains(document.activeElement);
    if (isFocused) return;

    const formatted = formatContentForEditor(notesContent);
    if (editor.innerHTML !== formatted) {
      editor.innerHTML = formatted;
      lastInternalHtmlRef.current = formatted;
    }
  }, [notesContent, getActiveEditor, formatContentForEditor]);

  /**
   * Helper: Insert fully formed, pre-styled inline tag component at current caret/selection position
   */
  const insertInlineTag = useCallback((type: 'correct' | 'incorrect' | 'new-word' | 'pronounce') => {
    const editor = getActiveEditor();
    if (!editor) return;

    editor.focus();

    const tagSpan = createTagElement(type);
    const spaceNode = document.createTextNode('\u00A0'); // Non-breaking space for smooth natural text flow

    const sel = window.getSelection();
    let inserted = false;

    if (sel && sel.rangeCount > 0) {
      let range = sel.getRangeAt(0);

      // Verify that selection is inside the editor
      if (editor.contains(range.commonAncestorContainer)) {
        range.deleteContents();
        range.insertNode(tagSpan);
        if (tagSpan.parentNode) {
          tagSpan.parentNode.insertBefore(spaceNode, tagSpan.nextSibling);
        }

        const newRange = document.createRange();
        newRange.setStartAfter(spaceNode);
        newRange.collapse(true);
        sel.removeAllRanges();
        sel.addRange(newRange);
        inserted = true;
      }
    }

    if (!inserted) {
      editor.appendChild(tagSpan);
      editor.appendChild(spaceNode);
      const newRange = document.createRange();
      newRange.setStartAfter(spaceNode);
      newRange.collapse(true);
      const newSel = window.getSelection();
      newSel?.removeAllRanges();
      newSel?.addRange(newRange);
    }

    const nextHtml = editor.innerHTML;
    lastInternalHtmlRef.current = nextHtml;
    isDirtyRef.current = true;
    setNotesContent(nextHtml);
  }, [getActiveEditor, createTagElement]);

  /**
   * Helper: Backwards-compatible symbol inserter
   */
  const insertCoachingSymbol = useCallback((symbol: '✓' | '✗') => {
    insertInlineTag(symbol === '✓' ? 'correct' : 'incorrect');
  }, [insertInlineTag]);

  /**
   * Helper: Inline text formatting (bold, italic, underline)
   */
  const applyInlineFormatting = (prefix: string, suffix: string = prefix, placeholder: string = 'text') => {
    const editor = getActiveEditor();
    if (!editor) return;
    editor.focus();

    if (prefix === '**') {
      document.execCommand('bold', false);
    } else if (prefix === '*') {
      document.execCommand('italic', false);
    } else if (prefix === '<u>') {
      document.execCommand('underline', false);
    } else {
      document.execCommand('insertText', false, `${prefix}${placeholder}${suffix}`);
    }
    isDirtyRef.current = true;
    setNotesContent(editor.innerHTML);
  };

  /**
   * Helper: Insert line prefix or list bullet
   */
  const applyLinePrefix = (prefix: string) => {
    const editor = getActiveEditor();
    if (!editor) return;
    editor.focus();

    if (prefix === '• ') {
      document.execCommand('insertUnorderedList', false);
    } else if (prefix === '1. ') {
      document.execCommand('insertOrderedList', false);
    } else {
      document.execCommand('insertText', false, prefix);
    }
    isDirtyRef.current = true;
    setNotesContent(editor.innerHTML);
  };

  /**
   * Helper: Insert snippet block at cursor
   */
  const insertSnippet = (snippet: string) => {
    const editor = getActiveEditor();
    if (!editor) return;
    editor.focus();
    if (snippet.includes('---')) {
      document.execCommand('insertHorizontalRule', false);
    } else {
      document.execCommand('insertText', false, snippet);
    }
    isDirtyRef.current = true;
    setNotesContent(editor.innerHTML);
  };

  /**
   * Keyboard Shortcuts Handler:
   * - Ctrl+Y / Alt+Y: Insert Pre-styled Correct Tag Component (✓)
   * - Alt+N / Ctrl+Alt+N (or Ctrl+N): Insert Pre-styled Incorrect Tag Component (✗)
   * - Alt+W / Ctrl+Alt+W (or Ctrl+W): Insert Pre-styled New Word Tag Component (✦ New Word)
   * - Alt+P / Ctrl+P: Insert Pre-styled Pronounce Tag Component (🎯 Pronounce)
   * - Ctrl+B / Cmd+B: Bold
   * - Ctrl+I / Cmd+I: Italic
   * - Ctrl+U / Cmd+U: Underline
   * - Tab: 4 spaces indent
   */
  const handleEditorKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    const isCmdOrCtrl = isMac ? (e.metaKey || e.ctrlKey) : e.ctrlKey;
    const isAlt = e.altKey;
    const keyLower = (e.key || '').toLowerCase();
    const code = e.code || '';

    // Hotkey: Ctrl+Y / Cmd+Y / Alt+Y -> Insert Pre-styled Green Correct Tag
    if (
      (isCmdOrCtrl && (keyLower === 'y' || code === 'KeyY')) ||
      (isAlt && (keyLower === 'y' || code === 'KeyY')) ||
      (isCmdOrCtrl && isAlt && (keyLower === 'c' || code === 'KeyC'))
    ) {
      e.preventDefault();
      e.stopPropagation();
      insertInlineTag('correct');
      return;
    }

    // Hotkey: Alt+N / Ctrl+Alt+N / Ctrl+N -> Insert Pre-styled Red Incorrect Tag
    if (
      (isAlt && (keyLower === 'n' || code === 'KeyN')) ||
      (isCmdOrCtrl && (keyLower === 'n' || code === 'KeyN')) ||
      (isCmdOrCtrl && isAlt && (keyLower === 'e' || code === 'KeyE' || keyLower === 'x' || code === 'KeyX'))
    ) {
      e.preventDefault();
      e.stopPropagation();
      insertInlineTag('incorrect');
      return;
    }

    // Hotkey: Alt+W / Ctrl+Alt+W / Ctrl+W -> Insert Pre-styled Blue New Word Tag
    if (
      (isAlt && (keyLower === 'w' || code === 'KeyW')) ||
      (isCmdOrCtrl && (keyLower === 'w' || code === 'KeyW'))
    ) {
      e.preventDefault();
      e.stopPropagation();
      insertInlineTag('new-word');
      return;
    }

    // Hotkey: Alt+P / Ctrl+P / Ctrl+Alt+P -> Insert Pre-styled Purple Pronounce Tag
    if (
      (isAlt && (keyLower === 'p' || code === 'KeyP')) ||
      (isCmdOrCtrl && (keyLower === 'p' || code === 'KeyP'))
    ) {
      e.preventDefault();
      e.stopPropagation();
      insertInlineTag('pronounce');
      return;
    }

    // Ctrl+B: Bold
    if (isCmdOrCtrl && e.key.toLowerCase() === 'b') {
      e.preventDefault();
      document.execCommand('bold', false);
      const editor = getActiveEditor();
      if (editor) setNotesContent(editor.innerHTML);
      return;
    }

    // Ctrl+I: Italic
    if (isCmdOrCtrl && e.key.toLowerCase() === 'i') {
      e.preventDefault();
      document.execCommand('italic', false);
      const editor = getActiveEditor();
      if (editor) setNotesContent(editor.innerHTML);
      return;
    }

    // Ctrl+U: Underline
    if (isCmdOrCtrl && e.key.toLowerCase() === 'u') {
      e.preventDefault();
      document.execCommand('underline', false);
      const editor = getActiveEditor();
      if (editor) setNotesContent(editor.innerHTML);
      return;
    }

    // Tab: 4 spaces
    if (e.key === 'Tab') {
      e.preventDefault();
      document.execCommand('insertText', false, '    ');
      const editor = getActiveEditor();
      if (editor) setNotesContent(editor.innerHTML);
      return;
    }
  };

  const fallbackCopyText = (text: string) => {
    try {
      const el = document.createElement('textarea');
      el.value = text;
      el.style.position = 'fixed';
      el.style.left = '-9999px';
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      setCopiedSuccess(true);
      setTimeout(() => setCopiedSuccess(false), 2500);
    } catch {}
  };

  /**
   * 1-Click Copy formatted notes for Google Meet Chat (converts tags to clean plain symbols)
   */
  const handleCopyForMeetChat = () => {
    if (!notesContent || !notesContent.trim()) return;
    const cleanText = convertTagsToPlainSymbolsForMeet(notesContent);
    try {
      if (navigator?.clipboard?.writeText) {
        navigator.clipboard
          .writeText(cleanText)
          .then(() => {
            setCopiedSuccess(true);
            setTimeout(() => setCopiedSuccess(false), 2500);
          })
          .catch(() => fallbackCopyText(cleanText));
      } else {
        fallbackCopyText(cleanText);
      }
    } catch {
      fallbackCopyText(cleanText);
    }
  };

  // Word and character statistics (computed from clean plain text)
  const plainNotesText = convertTagsToPlainSymbolsForMeet(notesContent);
  const wordCount = plainNotesText.trim() ? plainNotesText.trim().split(/\s+/).length : 0;
  const charCount = plainNotesText.length;

  // Global hotkey listener for Coaching Stamps (Alt+Y, Alt+N, Alt+W, Alt+P)
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      const editor = getActiveEditor();
      const isOurEditor =
        activeEl === editor ||
        (editor && editor.contains(activeEl as Node));
      if (!isOurEditor) return;

      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const isCmdOrCtrl = isMac ? (e.metaKey || e.ctrlKey) : (e.ctrlKey || e.metaKey);
      const isAlt = e.altKey;
      const keyLower = (e.key || '').toLowerCase();
      const code = e.code || '';

      // Correct Tag: Ctrl+Y / Alt+Y
      if (
        (isCmdOrCtrl && (keyLower === 'y' || code === 'KeyY')) ||
        (isAlt && (keyLower === 'y' || code === 'KeyY')) ||
        (isCmdOrCtrl && isAlt && (keyLower === 'c' || code === 'KeyC'))
      ) {
        e.preventDefault();
        e.stopPropagation();
        insertInlineTag('correct');
        return;
      }

      // Incorrect Tag: Alt+N / Ctrl+Alt+N / Ctrl+N
      if (
        (isAlt && (keyLower === 'n' || code === 'KeyN')) ||
        (isCmdOrCtrl && (keyLower === 'n' || code === 'KeyN')) ||
        (isCmdOrCtrl && isAlt && (keyLower === 'e' || code === 'KeyE' || keyLower === 'x' || code === 'KeyX'))
      ) {
        e.preventDefault();
        e.stopPropagation();
        insertInlineTag('incorrect');
        return;
      }

      // New Word Tag: Alt+W / Ctrl+Alt+W / Ctrl+W
      if (
        (isAlt && (keyLower === 'w' || code === 'KeyW')) ||
        (isCmdOrCtrl && (keyLower === 'w' || code === 'KeyW'))
      ) {
        e.preventDefault();
        e.stopPropagation();
        insertInlineTag('new-word');
        return;
      }

      // Pronounce Tag: Alt+P / Ctrl+P / Ctrl+Alt+P
      if (
        (isAlt && (keyLower === 'p' || code === 'KeyP')) ||
        (isCmdOrCtrl && (keyLower === 'p' || code === 'KeyP'))
      ) {
        e.preventDefault();
        e.stopPropagation();
        insertInlineTag('pronounce');
        return;
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown, true);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown, true);
  }, [getActiveEditor, insertInlineTag]);

  /**
   * High-fidelity parser that renders session notes with pre-styled colored tag components:
   * - Correct tag: Rounded rectangle (6px radius), light green bg (#ecfdf5), dark green border (#15803d), green checkmark (✓)
   * - Incorrect tag: Rounded rectangle (6px radius), light red bg (#fff1f2), dark red border (#b91c1c), red cross (✗)
   * - New Word tag: Rounded rectangle (6px radius), light blue bg (#eff6ff), dark blue border (#1d4ed8), ✦ New Word
   * - Pronounce tag: Rounded rectangle (6px radius), light purple bg (#faf5ff), dark purple border (#7e22ce), 🎯 Pronounce
   * - Supports Markdown bold (**), italic (*), underline (<u>), quotes (>), bullets (•), dividers (---)
   */
  const renderRichSessionNotes = (content: string) => {
    if (!content) return null;

    // Normalize newlines from <br> and <div>
    const normalizedContent = content
      .replace(/<br\s*[\/]?>/gi, '\n')
      .replace(/<\/div>/gi, '\n')
      .replace(/<div>/gi, '')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<p>/gi, '');

    const lines = normalizedContent.split('\n');

    const parseLineTokens = (text: string) => {
      const regex = /(<span[^>]*data-tag-type="correct"[^>]*>[\s\S]*?<\/span>|<span[^>]*data-tag-type="incorrect"[^>]*>[\s\S]*?<\/span>|<span[^>]*data-tag-type="new-word"[^>]*>[\s\S]*?<\/span>|<span[^>]*data-tag-type="pronounce"[^>]*>[\s\S]*?<\/span>|✓|✗|\[New Word\]|\[Pronounce\]|\*\*[^*]+\*\*|\*[^*]+\*|<u>.*?<\/u>)/gi;
      const parts = text.split(regex);

      return parts.map((part, pIdx) => {
        if (!part) return null;

        const isCorrect = part === '✓' || part.includes('data-tag-type="correct"');
        if (isCorrect) {
          return (
            <span
              key={pIdx}
              className="inline-coaching-tag correct-tag inline-flex items-center justify-center font-bold text-xs px-1.5 py-0.5 rounded-md bg-[#ecfdf5] border border-[#15803d] text-[#15803d] mx-1 align-baseline shadow-2xs select-none"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: '#ecfdf5',
                borderColor: '#15803d',
                borderWidth: '1px',
                borderStyle: 'solid',
                color: '#15803d',
                borderRadius: '6px',
                padding: '1px 6px',
                fontWeight: 700,
                fontSize: '12px',
                lineHeight: 1.3,
                verticalAlign: 'baseline',
                margin: '0 4px',
                userSelect: 'none',
              }}
              title="Correct (✓)"
              data-tag-type="correct"
            >
              ✓
            </span>
          );
        }

        const isIncorrect = part === '✗' || part.includes('data-tag-type="incorrect"');
        if (isIncorrect) {
          return (
            <span
              key={pIdx}
              className="inline-coaching-tag incorrect-tag inline-flex items-center justify-center font-bold text-xs px-1.5 py-0.5 rounded-md bg-[#fff1f2] border border-[#b91c1c] text-[#b91c1c] mx-1 align-baseline shadow-2xs select-none"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: '#fff1f2',
                borderColor: '#b91c1c',
                borderWidth: '1px',
                borderStyle: 'solid',
                color: '#b91c1c',
                borderRadius: '6px',
                padding: '1px 6px',
                fontWeight: 700,
                fontSize: '12px',
                lineHeight: 1.3,
                verticalAlign: 'baseline',
                margin: '0 4px',
                userSelect: 'none',
              }}
              title="Incorrect (✗)"
              data-tag-type="incorrect"
            >
              ✗
            </span>
          );
        }

        const isNewWord = part === '[New Word]' || part.includes('data-tag-type="new-word"');
        if (isNewWord) {
          return (
            <span
              key={pIdx}
              className="inline-coaching-tag new-word-tag inline-flex items-center justify-center font-bold text-xs px-1.5 py-0.5 rounded-md bg-[#eff6ff] border border-[#1d4ed8] text-[#1d4ed8] mx-1 align-baseline shadow-2xs select-none"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: '#eff6ff',
                borderColor: '#1d4ed8',
                borderWidth: '1px',
                borderStyle: 'solid',
                color: '#1d4ed8',
                borderRadius: '6px',
                padding: '1px 6px',
                fontWeight: 700,
                fontSize: '12px',
                lineHeight: 1.3,
                verticalAlign: 'baseline',
                margin: '0 4px',
                userSelect: 'none',
              }}
              title="New Word"
              data-tag-type="new-word"
            >
              ✦ New Word
            </span>
          );
        }

        const isPronounce = part === '[Pronounce]' || part.includes('data-tag-type="pronounce"');
        if (isPronounce) {
          return (
            <span
              key={pIdx}
              className="inline-coaching-tag pronounce-tag inline-flex items-center justify-center font-bold text-xs px-1.5 py-0.5 rounded-md bg-[#faf5ff] border border-[#7e22ce] text-[#7e22ce] mx-1 align-baseline shadow-2xs select-none"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: '#faf5ff',
                borderColor: '#7e22ce',
                borderWidth: '1px',
                borderStyle: 'solid',
                color: '#7e22ce',
                borderRadius: '6px',
                padding: '1px 6px',
                fontWeight: 700,
                fontSize: '12px',
                lineHeight: 1.3,
                verticalAlign: 'baseline',
                margin: '0 4px',
                userSelect: 'none',
              }}
              title="Pronounce"
              data-tag-type="pronounce"
            >
              🎯 Pronounce
            </span>
          );
        }

        if (part.startsWith('**') && part.endsWith('**') && part.length >= 4) {
          return (
            <strong key={pIdx} className="font-bold text-[#000035]">
              {part.slice(2, -2)}
            </strong>
          );
        }

        if (part.startsWith('*') && part.endsWith('*') && part.length >= 2) {
          return (
            <em key={pIdx} className="italic text-slate-700">
              {part.slice(1, -1)}
            </em>
          );
        }

        if (part.startsWith('<u>') && part.endsWith('</u>')) {
          return (
            <u key={pIdx} className="underline decoration-slate-400">
              {part.slice(3, -4)}
            </u>
          );
        }

        const cleanPart = part.replace(/<[^>]+>/g, '');
        return <span key={pIdx}>{cleanPart || part}</span>;
      });
    };

    return lines.map((line, lineIdx) => {
      if (line.trim() === '---') {
        return <hr key={lineIdx} className="my-3 border-t border-slate-200" />;
      }

      const isQuote = line.trim().startsWith('>');
      const cleanLine = isQuote ? line.replace(/^\s*>\s*/, '') : line;

      const isHeaderLine = lineIdx === 0 && line.includes('Native Friend In-Session Notes');
      const isMetaLine =
        (lineIdx === 1 && line.startsWith('Date:')) ||
        (lineIdx === 2 && line.startsWith('Topic:'));

      if (isHeaderLine) {
        return (
          <h4 key={lineIdx} className="font-extrabold text-[#000035] text-base border-b border-slate-100 pb-1 mb-1">
            {line}
          </h4>
        );
      }

      if (isMetaLine) {
        return (
          <p key={lineIdx} className="text-xs font-semibold text-slate-500 font-mono">
            {line}
          </p>
        );
      }

      if (isQuote) {
        return (
          <blockquote
            key={lineIdx}
            className="border-l-4 border-[#1C4C96] pl-3 py-1 my-1.5 bg-[#9AB4FF]/10 rounded-r-lg text-xs italic text-slate-700"
          >
            {parseLineTokens(cleanLine)}
          </blockquote>
        );
      }

      if (line.trim().startsWith('•') || line.trim().startsWith('-')) {
        const bulletContent = line.replace(/^\s*[•\-]\s*/, '');
        return (
          <li key={lineIdx} className="ml-4 list-disc text-xs text-slate-800 leading-relaxed my-0.5">
            {parseLineTokens(bulletContent)}
          </li>
        );
      }

      if (line === '') {
        return <div key={lineIdx} className="h-2" />;
      }

      return (
        <p key={lineIdx} className="text-xs text-slate-800 leading-relaxed my-0.5">
          {parseLineTokens(line)}
        </p>
      );
    });
  };

  /**
   * FASE NF-DOC.2C: Resultado da IA — Visual Minimalista e Revisão Editorial
   * Renders the 4 canonical pedagogical parts:
   * 1. Analyze Mistakes
   * 2. Grammar Points
   * 3. Vocabulary & Expressions
   * 4. Quick Review (5–10 min)
   *
   * Design:
   * - Minimalist editorial style, like a well-typeset document.
   * - White background, readable typography, generous spacing, discrete hierarchy.
   * - Subtle borders and dividers, point-highlights for errors (subtle rose) and corrections (subtle emerald).
   * - Discreet "Sugestão IA" badges, editable inline fields for teacher review.
   * - Stale draft warning when rawContent changed after draft.
   */
  const renderPedagogicalSection = () => {
    return (
      <div
        id="pedagogical-enrichment-environment"
        data-testid="pedagogical-enrichment-environment"
        className="pt-8 mt-8 border-t border-slate-200 space-y-6 text-left"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Editorial Section Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2 flex-wrap">
              <h4 className="text-xs font-black uppercase tracking-wider text-[#000035]">
                Structured Pedagogical Synthesis
              </h4>
              <span className="text-[10px] uppercase font-mono font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
                CELTA • 4 Parts
              </span>
            </div>
            <p className="text-xs text-slate-500">
              Pedagogical transformation generated exclusively via Gemini, reviewed and approved by the teacher.
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {approvalStatus === 'approved' && (
              <span
                id="pedagogical-approved-badge"
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 text-xs font-bold"
              >
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                <span>Approved & Published {lastApprovedVersion?.versionNumber ? `(v${lastApprovedVersion.versionNumber})` : ''}</span>
              </span>
            )}
            {approvalStatus !== 'approved' && draftTransformation && !isDraftStale && (
              <span
                id="pedagogical-draft-badge"
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-50 text-amber-800 border border-amber-200 text-xs font-bold"
              >
                <Sparkles className="w-3.5 h-3.5 text-amber-600" />
                <span>AI Draft (In Review)</span>
              </span>
            )}
            {isDraftStale && (
              <span
                id="pedagogical-stale-badge"
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-rose-50 text-rose-800 border border-rose-200 text-xs font-bold"
                title="Original notes were modified after this draft was created"
              >
                <AlertCircle className="w-3.5 h-3.5 text-rose-600" />
                <span>Outdated Draft</span>
              </span>
            )}
            {editableTransformation && (draftTransformation || lastApprovedVersion) && (
              <button
                type="button"
                onClick={handleResetToAiSuggestion}
                className="text-[11px] text-slate-500 hover:text-[#1C4C96] transition flex items-center gap-1 cursor-pointer underline underline-offset-2 ml-1"
                title="Restore values originally suggested by AI"
              >
                <Undo2 className="w-3 h-3" />
                <span>Restore AI suggestion</span>
              </button>
            )}
            <button
              type="button"
              data-testid="btn-toggle-version-history"
              onClick={handleToggleVersionHistory}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-semibold transition cursor-pointer"
              title="Inspect note and pedagogical version history"
            >
              <History className="w-3 h-3" />
              <span>Versions ({versionHistory.length})</span>
            </button>
          </div>
        </div>

        {showVersionHistory && (
          <div
            data-testid="session-notes-version-history"
            className="p-3.5 bg-slate-50 border border-slate-200 rounded-2xl space-y-2 text-xs"
          >
            <div className="flex items-center justify-between">
              <span className="font-bold text-[#000035] uppercase tracking-wider text-[11px]">
                Document Version History
              </span>
              {isLoadingVersions && <Loader2 className="w-3.5 h-3.5 animate-spin text-[#1C4C96]" />}
            </div>
            {versionHistory.length === 0 ? (
              <p className="text-slate-500 italic">No recorded versions yet for this session.</p>
            ) : (
              <div className="space-y-1.5 max-h-44 overflow-y-auto pr-1">
                {[...versionHistory].reverse().map((v) => (
                  <div
                    key={v.versionId || `v-${v.versionNumber}`}
                    className="flex items-center justify-between gap-2 bg-white px-3 py-1.5 rounded-xl border border-slate-200/80"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-mono font-bold text-[#1C4C96] shrink-0">
                        v{v.versionNumber}
                      </span>
                      <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 text-[10px] font-semibold uppercase shrink-0">
                        {v.type === 'approved_published'
                          ? 'Approved'
                          : v.type === 'ai_draft'
                          ? 'AI Draft'
                          : 'Teacher Raw'}
                      </span>
                      <span className="text-slate-600 truncate">
                        {v.changeSummary || 'Updated session notes'}
                      </span>
                    </div>
                    <span className="text-[10px] text-slate-400 font-mono shrink-0">
                      {v.createdAt ? new Date(v.createdAt).toLocaleString('en-US') : ''}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Real Status and Error Banners */}
        {aiError && (
          <div
            id="pedagogical-error-banner"
            className="p-3.5 bg-rose-50 border border-rose-200 rounded-2xl flex items-center gap-3 text-rose-800 text-xs font-semibold shadow-2xs animate-in fade-in duration-200"
          >
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <div className="flex-1">
              <span>{aiError}</span>
            </div>
            <button
              type="button"
              onClick={() => setAiError(null)}
              className="text-rose-600 hover:text-rose-900 text-xs font-bold px-1"
            >
              ✕
            </button>
          </div>
        )}

        {aiSuccessMessage && (
          <div
            id="pedagogical-success-banner"
            className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-2xl flex items-center gap-3 text-emerald-800 text-xs font-semibold shadow-2xs animate-in fade-in duration-200"
          >
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            <div className="flex-1">
              <span>{aiSuccessMessage}</span>
            </div>
            <button
              type="button"
              onClick={() => setAiSuccessMessage(null)}
              className="text-emerald-600 hover:text-emerald-900 text-xs font-bold px-1"
            >
              ✕
            </button>
          </div>
        )}

        {isDraftStale && (
          <div
            id="pedagogical-stale-alert"
            className="p-3.5 bg-amber-50 border border-amber-200 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-amber-900 text-xs font-medium shadow-2xs"
          >
            <div className="flex items-center gap-2.5">
              <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
              <span>
                Raw session notes were modified after this draft was generated. Click <strong>Apply AI</strong> to update the draft before approving.
              </span>
            </div>
            <button
              type="button"
              disabled={isApplyingAi}
              onClick={handleApplyAi}
              className="px-3 py-1.5 bg-amber-700 hover:bg-amber-800 text-white rounded-xl text-xs font-bold shrink-0 transition flex items-center gap-1.5 cursor-pointer shadow-2xs disabled:opacity-50"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Update with AI</span>
            </button>
          </div>
        )}

        {/* Loading State */}
        {isApplyingAi && (
          <div className="py-12 px-6 rounded-2xl border border-slate-200 bg-slate-50/50 text-center space-y-3 animate-in fade-in duration-200">
            <Loader2 className="w-6 h-6 text-[#1C4C96] mx-auto animate-spin" />
            <h5 className="text-sm font-bold text-[#000035]">
              Synthesizing pedagogical notes via Gemini...
            </h5>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              Preserving all corrections (Alt+N), new terms (Alt+W), and pronunciation (Alt+P) across 4 structured parts.
            </p>
          </div>
        )}

        {/* Empty state when no transformation has been generated yet */}
        {!isApplyingAi && !editableTransformation && (
          <div className="py-10 px-6 rounded-2xl border border-dashed border-slate-200 bg-slate-50/40 text-center space-y-3">
            <Sparkles className="w-6 h-6 text-slate-400 mx-auto" />
            <div className="space-y-1">
              <h5 className="text-sm font-bold text-slate-700">
                Pedagogical report not generated for this session yet
              </h5>
              <p className="text-xs text-slate-500 max-w-lg mx-auto leading-relaxed">
                Write or review your notes above using the quick stamp shortcuts (<kbd className="font-mono bg-white px-1 py-0.5 rounded border border-slate-200 text-[10px]">Alt+Y</kbd>, <kbd className="font-mono bg-white px-1 py-0.5 rounded border border-slate-200 text-[10px]">Alt+N</kbd>, <kbd className="font-mono bg-white px-1 py-0.5 rounded border border-slate-200 text-[10px]">Alt+W</kbd>, <kbd className="font-mono bg-white px-1 py-0.5 rounded border border-slate-200 text-[10px]">Alt+P</kbd>) and click <strong>Apply AI</strong> to synthesize the 4-part pedagogical report.
              </p>
            </div>
            <div className="pt-2">
              <button
                type="button"
                disabled={isApplyingAi || !notesContent.trim()}
                onClick={handleApplyAi}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold bg-[#1C4C96] hover:bg-[#062863] text-white shadow-xs transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Sparkles className="w-4 h-4 text-[#F4CA54]" />
                <span>Apply AI to Notes</span>
              </button>
            </div>
          </div>
        )}

        {/* 4 Canonical Parts Rendered when editableTransformation exists */}
        {!isApplyingAi && editableTransformation && (
          <div className="space-y-8 animate-in fade-in duration-200">
            {/* PART 1: Analyze Mistakes */}
            <section
              id="pedagogical-part-1-mistakes"
              className="space-y-3 pb-6 border-b border-slate-100"
            >
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-black text-xs text-[#000035] uppercase tracking-wider">
                      1. Analyze Mistakes
                    </span>
                    <span className="text-[10px] font-mono text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">
                      {editableTransformation.mistakesAnalysis?.length || 0}
                    </span>
                    <span className="text-[10px] uppercase font-mono tracking-wider text-slate-400 bg-slate-50 border border-slate-200 px-1.5 py-0.2 rounded">
                      AI Suggestion
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Targeted corrections focusing on precision, context, and natural usage.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleAddMistake}
                  className="px-2.5 py-1 text-xs font-semibold text-[#1C4C96] hover:bg-slate-100 rounded-lg transition flex items-center gap-1 cursor-pointer border border-transparent hover:border-slate-200"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Correction</span>
                </button>
              </div>

              {Array.isArray(editableTransformation.mistakesAnalysis) &&
              editableTransformation.mistakesAnalysis.length > 0 ? (
                <div className="space-y-3">
                  {editableTransformation.mistakesAnalysis.map((item: any, idx: number) => (
                    <div
                      key={item.id || idx}
                      className="p-3.5 bg-slate-50/60 rounded-xl border border-slate-200/80 space-y-2.5 hover:border-slate-300 transition"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 flex-1">
                          {/* Original Expression */}
                          <div className="space-y-1">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-rose-700 flex items-center gap-1">
                              <span>✗ Student Said</span>
                            </span>
                            <input
                              type="text"
                              value={item.original || ''}
                              onChange={(e) => handleUpdateMistake(idx, 'original', e.target.value)}
                              placeholder="Original phrase with mistake..."
                              className="w-full text-xs font-mono text-rose-950 bg-rose-50/70 border border-rose-200/70 rounded-lg px-2.5 py-1.5 focus:outline-hidden focus:ring-1 focus:ring-rose-400 focus:bg-white transition"
                            />
                          </div>

                          {/* Corrected Expression */}
                          <div className="space-y-1">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 flex items-center gap-1">
                              <span>✓ Natural Way to Say It</span>
                            </span>
                            <input
                              type="text"
                              value={item.corrected || ''}
                              onChange={(e) => handleUpdateMistake(idx, 'corrected', e.target.value)}
                              placeholder="Suggested correct form..."
                              className="w-full text-xs font-semibold text-emerald-950 bg-emerald-50/70 border border-emerald-200/70 rounded-lg px-2.5 py-1.5 focus:outline-hidden focus:ring-1 focus:ring-emerald-400 focus:bg-white transition"
                            />
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => handleRemoveMistake(idx)}
                          className="text-slate-400 hover:text-rose-600 transition p-1.5 rounded-lg hover:bg-rose-50 cursor-pointer"
                          title="Remove this correction"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      {/* Explanation & Underlying Grammar Rule */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                            Why Incorrect / Unnatural:
                          </span>
                          <textarea
                            rows={2}
                            value={item.explanation || ''}
                            onChange={(e) => handleUpdateMistake(idx, 'explanation', e.target.value)}
                            placeholder="Why the original is incorrect or unnatural..."
                            className="w-full text-xs text-slate-700 bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-hidden focus:ring-1 focus:ring-[#1C4C96] resize-y leading-relaxed"
                          />
                        </div>

                        <div className="space-y-1">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                            Underlying Grammar Rule / Pattern:
                          </span>
                          <textarea
                            rows={2}
                            value={item.grammarRule || ''}
                            onChange={(e) => handleUpdateMistake(idx, 'grammarRule', e.target.value)}
                            placeholder="Grammar rule or language pattern behind the correction..."
                            className="w-full text-xs text-slate-700 bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-hidden focus:ring-1 focus:ring-[#1C4C96] resize-y leading-relaxed"
                          />
                        </div>
                      </div>

                      {/* 2-4 Natural Examples */}
                      <div className="space-y-1">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                          Natural Examples (2–4, separated by •):
                        </span>
                        <input
                          type="text"
                          value={Array.isArray(item.twoExamples) ? item.twoExamples.join(' • ') : (item.twoExamples || '')}
                          onChange={(e) =>
                            handleUpdateMistake(
                              idx,
                              'twoExamples',
                              e.target.value.split('•').map((s) => s.trim()).filter(Boolean)
                            )
                          }
                          placeholder="Example 1 • Example 2 • Example 3"
                          className="w-full text-xs text-slate-600 italic bg-white border border-slate-200 rounded-lg px-2.5 py-1 focus:outline-hidden focus:ring-1 focus:ring-[#1C4C96]"
                        />
                      </div>

                      {/* Common Pitfalls & Similar Forms Comparison */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                            Common Mistakes with This Structure:
                          </span>
                          <input
                            type="text"
                            value={item.commonPitfalls || ''}
                            onChange={(e) => handleUpdateMistake(idx, 'commonPitfalls', e.target.value)}
                            placeholder="Likely student pitfalls..."
                            className="w-full text-xs text-slate-700 bg-white border border-slate-200 rounded-lg px-2.5 py-1 focus:outline-hidden focus:ring-1 focus:ring-[#1C4C96]"
                          />
                        </div>

                        <div className="space-y-1">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                            Difference Between Similar Forms (Optional):
                          </span>
                          <input
                            type="text"
                            value={item.similarFormsComparison || ''}
                            onChange={(e) => handleUpdateMistake(idx, 'similarFormsComparison', e.target.value)}
                            placeholder="Comparison with similar expressions when useful..."
                            className="w-full text-xs text-slate-700 bg-white border border-slate-200 rounded-lg px-2.5 py-1 focus:outline-hidden focus:ring-1 focus:ring-[#1C4C96]"
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-400 italic py-2">
                  No mistakes recorded in this session.
                </p>
              )}
            </section>

            {/* PART 2: Grammar Points */}
            <section
              id="pedagogical-part-2-grammar"
              className="space-y-3 pb-6 border-b border-slate-100"
            >
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-black text-xs text-[#000035] uppercase tracking-wider">
                      2. Grammar Points
                    </span>
                    <span className="text-[10px] font-mono text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">
                      {editableTransformation.grammarPoints?.length || 0}
                    </span>
                    <span className="text-[10px] uppercase font-mono tracking-wider text-slate-400 bg-slate-50 border border-slate-200 px-1.5 py-0.2 rounded">
                      AI Suggestion
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Structural patterns, rules, meaning/use, examples, common mistakes, and comparisons connected to the student's mistakes.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleAddGrammar}
                  className="px-2.5 py-1 text-xs font-semibold text-[#1C4C96] hover:bg-slate-100 rounded-lg transition flex items-center gap-1 cursor-pointer border border-transparent hover:border-slate-200"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Grammar Point</span>
                </button>
              </div>

              {Array.isArray(editableTransformation.grammarPoints) &&
              editableTransformation.grammarPoints.length > 0 ? (
                <div className="space-y-3">
                  {editableTransformation.grammarPoints.map((gp: any, idx: number) => (
                    <div
                      key={gp.id || idx}
                      className="p-3.5 bg-slate-50/60 rounded-xl border border-slate-200/80 space-y-2.5 hover:border-slate-300 transition border-l-2 border-l-[#1C4C96]"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 flex-1">
                          <div className="space-y-1">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-[#1C4C96]">
                              Grammar Topic:
                            </span>
                            <input
                              type="text"
                              value={gp.topic || ''}
                              onChange={(e) => handleUpdateGrammar(idx, 'topic', e.target.value)}
                              placeholder="e.g. Present Perfect vs Simple Past..."
                              className="w-full text-xs font-bold text-[#000035] bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-hidden focus:ring-1 focus:ring-[#1C4C96]"
                            />
                          </div>

                          <div className="space-y-1">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                              Form / Structure:
                            </span>
                            <input
                              type="text"
                              value={gp.form || ''}
                              onChange={(e) => handleUpdateGrammar(idx, 'form', e.target.value)}
                              placeholder="e.g. Subject + modal + base verb..."
                              className="w-full text-xs font-mono text-slate-700 bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-hidden focus:ring-1 focus:ring-[#1C4C96]"
                            />
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => handleRemoveGrammar(idx)}
                          className="text-slate-400 hover:text-rose-600 transition p-1.5 rounded-lg hover:bg-rose-50 cursor-pointer"
                          title="Remove grammar point"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                            Rule:
                          </span>
                          <textarea
                            rows={2}
                            value={gp.rule || gp.explanation || ''}
                            onChange={(e) => handleUpdateGrammar(idx, 'rule', e.target.value)}
                            placeholder="Clear rule calibrated to the student's level..."
                            className="w-full text-xs text-slate-700 bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-hidden focus:ring-1 focus:ring-[#1C4C96] resize-y leading-relaxed"
                          />
                        </div>

                        <div className="space-y-1">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                            Meaning / Use:
                          </span>
                          <textarea
                            rows={2}
                            value={gp.usage || ''}
                            onChange={(e) => handleUpdateGrammar(idx, 'usage', e.target.value)}
                            placeholder="When and why native speakers use this structure..."
                            className="w-full text-xs text-slate-700 bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-hidden focus:ring-1 focus:ring-[#1C4C96] resize-y leading-relaxed"
                          />
                        </div>
                      </div>

                      {/* Examples */}
                      <div className="space-y-1">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                          Real-Life Examples (separated by •):
                        </span>
                        <input
                          type="text"
                          value={Array.isArray(gp.examples) ? gp.examples.join(' • ') : (gp.examples || '')}
                          onChange={(e) =>
                            handleUpdateGrammar(
                              idx,
                              'examples',
                              e.target.value.split('•').map((s) => s.trim()).filter(Boolean)
                            )
                          }
                          placeholder="Separate multiple examples with • (bullet)"
                          className="w-full text-xs text-slate-600 italic bg-white border border-slate-200 rounded-lg px-2.5 py-1 focus:outline-hidden focus:ring-1 focus:ring-[#1C4C96]"
                        />
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                            Common Mistakes:
                          </span>
                          <input
                            type="text"
                            value={gp.commonMistakes || ''}
                            onChange={(e) => handleUpdateGrammar(idx, 'commonMistakes', e.target.value)}
                            placeholder="Typical learner errors..."
                            className="w-full text-xs text-slate-700 bg-white border border-slate-200 rounded-lg px-2.5 py-1 focus:outline-hidden focus:ring-1 focus:ring-[#1C4C96]"
                          />
                        </div>

                        <div className="space-y-1">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                            Comparison with Similar Structures:
                          </span>
                          <input
                            type="text"
                            value={gp.comparisons || ''}
                            onChange={(e) => handleUpdateGrammar(idx, 'comparisons', e.target.value)}
                            placeholder="Short comparison when relevant..."
                            className="w-full text-xs text-slate-700 bg-white border border-slate-200 rounded-lg px-2.5 py-1 focus:outline-hidden focus:ring-1 focus:ring-[#1C4C96]"
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-400 italic py-2">
                  No grammar points recorded in this session.
                </p>
              )}
            </section>

            {/* PART 3: Vocabulary & Expressions */}
            <section
              id="pedagogical-part-3-vocab"
              className="space-y-3 pb-6 border-b border-slate-100"
            >
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-black text-xs text-[#000035] uppercase tracking-wider">
                      3. Vocabulary & Expressions
                    </span>
                    <span className="text-[10px] font-mono text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">
                      {editableTransformation.vocabularyAndExpressions?.length || 0}
                    </span>
                    <span className="text-[10px] uppercase font-mono tracking-wider text-slate-400 bg-slate-50 border border-slate-200 px-1.5 py-0.2 rounded">
                      AI Suggestion
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Organized by useful thematic categories with part of speech, simple definition, collocations, examples, synonyms, and register.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleAddVocab}
                  className="px-2.5 py-1 text-xs font-semibold text-[#1C4C96] hover:bg-slate-100 rounded-lg transition flex items-center gap-1 cursor-pointer border border-transparent hover:border-slate-200"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Term</span>
                </button>
              </div>

              {Array.isArray(editableTransformation.vocabularyAndExpressions) &&
              editableTransformation.vocabularyAndExpressions.length > 0 ? (
                <div className="space-y-3">
                  {editableTransformation.vocabularyAndExpressions.map((v: any, idx: number) => (
                    <div
                      key={v.id || idx}
                      className="p-3.5 bg-slate-50/60 rounded-xl border border-slate-200/80 space-y-2 hover:border-slate-300 transition"
                    >
                      <div className="flex items-start justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-2 flex-1 min-w-[200px] flex-wrap">
                          <input
                            type="text"
                            value={v.term || ''}
                            onChange={(e) => handleUpdateVocab(idx, 'term', e.target.value)}
                            placeholder="Word or Expression..."
                            className="text-xs font-bold text-[#000035] bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-hidden focus:ring-1 focus:ring-[#1C4C96] flex-1 min-w-[160px] max-w-xs"
                          />
                          <input
                            type="text"
                            value={v.partOfSpeech || ''}
                            onChange={(e) => handleUpdateVocab(idx, 'partOfSpeech', e.target.value)}
                            placeholder="Part of speech..."
                            className="text-[11px] font-semibold text-[#1C4C96] bg-white border border-slate-200 rounded-lg px-2 py-1 focus:outline-hidden focus:ring-1 focus:ring-[#1C4C96] w-32"
                          />
                          <input
                            type="text"
                            value={v.category || ''}
                            onChange={(e) => handleUpdateVocab(idx, 'category', e.target.value)}
                            placeholder="Category (e.g. Work & Meetings)..."
                            className="text-[11px] font-medium text-slate-700 bg-white border border-slate-200 rounded-lg px-2 py-1 focus:outline-hidden focus:ring-1 focus:ring-[#1C4C96] w-44"
                          />
                          <button
                            type="button"
                            onClick={() => handleToggleVocabTag(idx, 'isNewWord')}
                            className={`px-2 py-0.5 rounded text-[10px] font-bold border transition cursor-pointer ${
                              v.isNewWord
                                ? 'bg-[#eff6ff] text-[#1d4ed8] border-[#1d4ed8]'
                                : 'bg-slate-100 text-slate-400 border-slate-200'
                            }`}
                            title="Toggle New Word tag"
                          >
                            ✦ New Word
                          </button>
                          <button
                            type="button"
                            onClick={() => handleToggleVocabTag(idx, 'isPronunciationFocus')}
                            className={`px-2 py-0.5 rounded text-[10px] font-bold border transition cursor-pointer ${
                              v.isPronunciationFocus
                                ? 'bg-[#faf5ff] text-[#7e22ce] border-[#7e22ce]'
                                : 'bg-slate-100 text-slate-400 border-slate-200'
                            }`}
                            title="Toggle Pronounce tag"
                          >
                            🎯 Pronounce
                          </button>
                        </div>

                        <button
                          type="button"
                          onClick={() => handleRemoveVocab(idx)}
                          className="text-slate-400 hover:text-rose-600 transition p-1.5 rounded-lg hover:bg-rose-50 cursor-pointer"
                          title="Remove this term"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <div className="space-y-0.5">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                            Simple Definition:
                          </span>
                          <input
                            type="text"
                            value={v.simpleDefinition || v.definitionEn || ''}
                            onChange={(e) => {
                              handleUpdateVocab(idx, 'simpleDefinition', e.target.value);
                              handleUpdateVocab(idx, 'definitionEn', e.target.value);
                            }}
                            placeholder="Clear, simple definition..."
                            className="w-full text-xs text-slate-700 bg-white border border-slate-200 rounded-lg px-2.5 py-1 focus:outline-hidden focus:ring-1 focus:ring-[#1C4C96]"
                          />
                        </div>

                        <div className="space-y-0.5">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                            Real-Life Examples (separated by •):
                          </span>
                          <input
                            type="text"
                            value={Array.isArray(v.realExamples) ? v.realExamples.join(' • ') : (v.realExamples || '')}
                            onChange={(e) =>
                              handleUpdateVocab(
                                idx,
                                'realExamples',
                                e.target.value.split('•').map((s) => s.trim()).filter(Boolean)
                              )
                            }
                            placeholder="Realistic example sentence..."
                            className="w-full text-xs text-slate-600 italic bg-white border border-slate-200 rounded-lg px-2.5 py-1 focus:outline-hidden focus:ring-1 focus:ring-[#1C4C96]"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <div className="space-y-0.5">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                            Collocations / Patterns:
                          </span>
                          <input
                            type="text"
                            value={Array.isArray(v.collocations) ? v.collocations.join(', ') : (v.collocations || '')}
                            onChange={(e) =>
                              handleUpdateVocab(
                                idx,
                                'collocations',
                                e.target.value.split(',').map((s) => s.trim()).filter(Boolean)
                              )
                            }
                            placeholder="e.g. follow up on, follow up with"
                            className="w-full text-xs text-slate-700 bg-white border border-slate-200 rounded-lg px-2.5 py-1 focus:outline-hidden focus:ring-1 focus:ring-[#1C4C96]"
                          />
                        </div>

                        <div className="space-y-0.5">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                            Synonyms / Related:
                          </span>
                          <input
                            type="text"
                            value={Array.isArray(v.synonyms) ? v.synonyms.join(', ') : (v.synonyms || '')}
                            onChange={(e) =>
                              handleUpdateVocab(
                                idx,
                                'synonyms',
                                e.target.value.split(',').map((s) => s.trim()).filter(Boolean)
                              )
                            }
                            placeholder="Synonyms when useful..."
                            className="w-full text-xs text-slate-700 bg-white border border-slate-200 rounded-lg px-2.5 py-1 focus:outline-hidden focus:ring-1 focus:ring-[#1C4C96]"
                          />
                        </div>

                        <div className="space-y-0.5">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                            Register / Nuance Note:
                          </span>
                          <input
                            type="text"
                            value={v.registerNote || v.register || ''}
                            onChange={(e) => handleUpdateVocab(idx, 'registerNote', e.target.value)}
                            placeholder="Formal, informal, conversational..."
                            className="w-full text-xs text-slate-700 bg-white border border-slate-200 rounded-lg px-2.5 py-1 focus:outline-hidden focus:ring-1 focus:ring-[#1C4C96]"
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-400 italic py-2">
                  No vocabulary terms recorded in this session.
                </p>
              )}
            </section>

            {/* PART 4: Quick Review (5–10 min) */}
            <section
              id="pedagogical-part-4-review"
              className="space-y-4"
            >
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-black text-xs text-[#000035] uppercase tracking-wider">
                      4. Quick Review (5–10 min)
                    </span>
                    <span className="text-[10px] uppercase font-mono tracking-wider text-slate-400 bg-slate-50 border border-slate-200 px-1.5 py-0.2 rounded">
                      AI Suggestion
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Concise 5–10 minute revision section covering key grammar rules, vocabulary, corrections, sentence patterns, and "Remember this".
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Estimated time:</span>
                  <input
                    type="text"
                    value={editableTransformation.reviewSummary?.estimatedMinutes || '5–10 min'}
                    onChange={(e) => handleUpdateQuickReview('estimatedMinutes', e.target.value)}
                    className="w-24 text-xs font-semibold text-[#000035] bg-white border border-slate-200 rounded-lg px-2 py-0.5 text-center"
                  />
                </div>
              </div>

              <div className="p-4 bg-slate-50/70 rounded-xl border border-slate-200 space-y-4">
                {/* Remember This */}
                <div className="space-y-1">
                  <span className="text-[10px] font-black uppercase tracking-wider text-[#1C4C96] flex items-center gap-1">
                    <Lightbulb className="w-3.5 h-3.5 text-[#F4CA54]" />
                    <span>Remember This:</span>
                  </span>
                  <textarea
                    rows={2}
                    value={editableTransformation.reviewSummary?.rememberThis || ''}
                    onChange={(e) => handleUpdateQuickReview('rememberThis', e.target.value)}
                    placeholder="The main takeaway message the student should retain from this lesson..."
                    className="w-full text-xs text-slate-800 bg-white border border-blue-200/80 rounded-lg px-3 py-2 focus:outline-hidden focus:ring-1 focus:ring-[#1C4C96] leading-relaxed"
                  />
                </div>

                {/* Key Rules list */}
                <div className="space-y-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-600">
                    Most Important Grammar Rules:
                  </span>
                  <input
                    type="text"
                    value={
                      Array.isArray(editableTransformation.reviewSummary?.keyRules)
                        ? editableTransformation.reviewSummary.keyRules.join(' • ')
                        : ''
                    }
                    onChange={(e) =>
                      handleUpdateQuickReview(
                        'keyRules',
                        e.target.value.split('•').map((s) => s.trim()).filter(Boolean)
                      )
                    }
                    placeholder="Essential rules separated by • (bullet)"
                    className="w-full text-xs text-slate-700 bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-hidden focus:ring-1 focus:ring-[#1C4C96]"
                  />
                </div>

                {/* Useful Sentence Patterns */}
                <div className="space-y-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-600">
                    Useful Sentence Patterns:
                  </span>
                  <input
                    type="text"
                    value={
                      Array.isArray(editableTransformation.reviewSummary?.usefulPatterns)
                        ? editableTransformation.reviewSummary.usefulPatterns.join(' • ')
                        : ''
                    }
                    onChange={(e) =>
                      handleUpdateQuickReview(
                        'usefulPatterns',
                        e.target.value.split('•').map((s) => s.trim()).filter(Boolean)
                      )
                    }
                    placeholder="Useful sentence frames separated by • (bullet)"
                    className="w-full text-xs text-slate-700 bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-hidden focus:ring-1 focus:ring-[#1C4C96]"
                  />
                </div>

                {/* Must Know Vocabulary */}
                <div className="space-y-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-600">
                    Most Important Vocabulary:
                  </span>
                  <input
                    type="text"
                    value={
                      Array.isArray(editableTransformation.reviewSummary?.mustKnowVocabulary)
                        ? editableTransformation.reviewSummary.mustKnowVocabulary.join(', ')
                        : ''
                    }
                    onChange={(e) =>
                      handleUpdateQuickReview(
                        'mustKnowVocabulary',
                        e.target.value.split(',').map((s) => s.trim()).filter(Boolean)
                      )
                    }
                    placeholder="Essential words and expressions separated by commas"
                    className="w-full text-xs text-slate-700 bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-hidden focus:ring-1 focus:ring-[#1C4C96]"
                  />
                </div>
              </div>
            </section>

            {/* Editorial Approval Footer */}
            <div className="pt-4 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-3">
              <div className="text-xs text-slate-500">
                {isDraftStale ? (
                  <span className="text-rose-600 font-semibold flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5" />
                    <span>Notes modified after generation. Update via Apply AI to enable approval.</span>
                  </span>
                ) : approvalStatus === 'approved' ? (
                  <span className="text-emerald-700 font-semibold flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Current version published to student.</span>
                  </span>
                ) : (
                  <span>Review complete? Click Approve & Publish to make available to the student.</span>
                )}
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  disabled={isSavingDraft || isApproving || isDraftStale}
                  onClick={handleSaveDraft}
                  id="btn-pedagogical-save-draft"
                  className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow-xs border ${
                    isDraftStale
                      ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed'
                      : 'bg-white hover:bg-slate-50 text-[#1C4C96] border-[#1C4C96]/40 cursor-pointer'
                  }`}
                  title="Save edited AI draft without publishing yet"
                >
                  {isSavingDraft ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-[#1C4C96]" />
                  ) : (
                    <Save className="w-3.5 h-3.5 text-[#1C4C96]" />
                  )}
                  <span>{isSavingDraft ? 'Saving Draft...' : 'Save Draft'}</span>
                </button>

                <button
                  type="button"
                  disabled={isApproving || isDraftStale}
                  onClick={handleApproveAndPublish}
                  id="btn-pedagogical-approve-publish-editorial"
                  className={`px-5 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 shadow-xs border ${
                    isDraftStale
                      ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed'
                      : approvalStatus === 'approved'
                      ? 'bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-700 cursor-pointer'
                      : 'bg-[#15803d] hover:bg-[#166534] text-white border-[#15803d] cursor-pointer active:scale-98'
                  }`}
                  title={isDraftStale ? 'Notes modified. Re-apply AI before approving.' : 'Approve and Publish for Student'}
                >
                  {isApproving ? (
                    <Loader2 className="w-4 h-4 animate-spin text-white" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4 text-white" />
                  )}
                  <span>
                    {isApproving
                      ? 'Publishing...'
                      : approvalStatus === 'approved'
                      ? 'Approved & Published ✓'
                      : 'Approve & Publish'}
                  </span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      className="bg-white rounded-3xl p-5 sm:p-7 border border-[#607EC9]/30 shadow-xs space-y-5"
      id="teacher-live-lesson-notes-panel"
    >
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#9AB4FF]/30 pb-4">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-[#000035] text-white flex items-center justify-center shrink-0 border border-[#9AB4FF]/40 shadow-sm">
            <FileText className="w-6 h-6 text-[#F4CA54]" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-black text-base sm:text-lg text-[#000035] tracking-tight">
                Native Friend In-Session Notes & Recommendations
              </h3>
              {/*
              <span className="px-2 py-0.5 rounded-full bg-[#1C4C96]/10 text-[#1C4C96] text-[10px] font-bold uppercase tracking-wider border border-[#1C4C96]/20">
                Word-Doc Editor
              </span>
              */}
            </div>
            {/*
            <p className="text-xs text-slate-500 font-medium mt-0.5">
              Unified free-form document keyed by session date • Live synchronized with Firestore
            </p>
            */}
          </div>
        </div>

        {/* Top Navigation Tabs */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => setActiveTab('editor')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'editor'
                ? 'bg-[#1C4C96] text-white shadow-xs'
                : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Document Editor</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('history')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'history'
                ? 'bg-[#1C4C96] text-white shadow-xs'
                : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
            }`}
          >
            <History className="w-3.5 h-3.5" />
            <span>Session History ({studentHistory.length})</span>
          </button>
        </div>
      </div>

      {activeTab === 'editor' ? (
        <div className="space-y-4">
          {/* Identity Error Banner */}
          {Boolean(studentResolution.error || saveError) && (
            <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-2xl flex items-center gap-3 text-rose-800 text-xs font-semibold shadow-xs animate-in fade-in duration-200">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              <div className="flex-1">
                <span className="font-bold">Identity Warning: </span>
                <span>{studentResolution.error || saveError}</span>
              </div>
            </div>
          )}

          {/* Session Metadata & Topic Control Bar */}
          <div className="p-3.5 bg-slate-50 rounded-2xl border border-[#607EC9]/30 flex flex-col md:flex-row md:items-center gap-3 shadow-2xs">
            {/* Session Selector */}
            <div className="flex items-center gap-2 shrink-0 min-w-[240px] md:max-w-[340px]">
              <Calendar className="w-4 h-4 text-[#1C4C96] shrink-0" />
              <span className="text-xs font-black text-[#000035] uppercase tracking-wider shrink-0">
                Session:
              </span>
              <select
                value={selectedLessonId}
                onChange={(e) => handleSessionChange(e.target.value)}
                className="w-full bg-white border border-[#607EC9]/40 rounded-xl px-2.5 py-1.5 text-xs font-semibold text-[#000035] focus:outline-hidden focus:ring-2 focus:ring-[#1C4C96] cursor-pointer shadow-2xs truncate"
              >
                <option value="">
                  {sessionDate === getTodayDateStr()
                    ? `-- ➕ New Lesson (Today - ${formatDateInTimeZone(getTodayDateStr(), timeZone, 'en')}) --`
                    : `-- ➕ New Lesson (${sessionDate}) --`}
                </option>
                {teacherLessons
                  .filter(
                    (l) =>
                      !selectedStudentEmail ||
                      (l?.studentEmail &&
                        (l.studentEmail || '').toLowerCase().trim() ===
                          (selectedStudentEmail || '').toLowerCase().trim()) ||
                      l?.id === selectedLessonId
                  )
                  .sort((a, b) => {
                    const timeA = a.startDateTime ? new Date(a.startDateTime).getTime() : 0;
                    const timeB = b.startDateTime ? new Date(b.startDateTime).getTime() : 0;
                    return timeB - timeA; // Descending: newest first
                  })
                  .map((l) => {
                    const lDate = l.startDateTime
                      ? formatDateInTimeZone(l.startDateTime, timeZone, 'en')
                      : 'Session';
                    const lTime = l.startDateTime
                      ? formatTimeInTimeZone(l.startDateTime, timeZone)
                      : '';
                    return (
                      <option key={l.id} value={l.id}>
                        {lDate} {lTime ? `at ${lTime}` : ''} - {l.title || 'Lesson'} (
                        {l.status || 'scheduled'})
                      </option>
                    );
                  })}
              </select>
            </div>

            <div className="hidden md:block w-px h-6 bg-slate-200 shrink-0" />

            {/* Session Date with quick 'Today' button */}
            <div className="flex items-center gap-1.5 shrink-0">
              <Clock className="w-4 h-4 text-slate-500 shrink-0" />
              <span className="text-xs font-bold text-slate-600">Date:</span>
              <input
                type="date"
                value={sessionDate}
                onChange={(e) => handleDateChange(e.target.value)}
                className="bg-white border border-[#607EC9]/40 rounded-xl px-2.5 py-1 text-xs font-medium text-[#000035] focus:outline-hidden focus:ring-2 focus:ring-[#1C4C96]"
              />
              <button
                type="button"
                onClick={() => {
                  const today = getTodayDateStr();
                  handleDateChange(today);
                }}
                className={`px-2 py-1 text-[11px] font-bold rounded-lg transition cursor-pointer ${
                  sessionDate === getTodayDateStr()
                    ? 'bg-[#1C4C96] text-white shadow-2xs'
                    : 'bg-slate-200 hover:bg-slate-300 text-slate-700'
                }`}
                title="Select current date (=today)"
              >
                Today
              </button>
            </div>

            <div className="hidden md:block w-px h-6 bg-slate-200 shrink-0" />

            {/* Session Topic */}
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <Lightbulb className="w-4 h-4 text-[#F4CA54] shrink-0" />
              <span className="text-xs font-black text-[#000035] uppercase tracking-wider shrink-0">
                Topic:
              </span>
              <input
                type="text"
                value={topic}
                onChange={(e) => handleTopicChange(e.target.value)}
                placeholder="e.g. Job Interview Prep, Travel Roleplay, Small Talk..."
                className="flex-1 bg-white border border-[#607EC9]/40 rounded-xl px-3 py-1.5 text-xs font-semibold text-[#000035] placeholder:text-slate-400 placeholder:font-normal focus:outline-hidden focus:ring-2 focus:ring-[#1C4C96] min-w-0"
              />
            </div>
          </div>

          {/* Unified Word-Document Rich Canvas */}
          <div className="bg-slate-50/80 rounded-2xl border-2 border-[#9AB4FF]/40 shadow-xs overflow-hidden">
            {/* Document Header & Quick Toolbar */}
            <div className="bg-white border-b border-slate-200 p-3 sm:px-4 flex flex-wrap items-center justify-between gap-2.5">
              {/* Left: Text Formatting Tools & Coaching Stamp Toolbar */}
              <div className="flex items-center gap-1.5 flex-wrap">
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => applyInlineFormatting('**', '**', 'bold text')}
                    className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-700 hover:text-[#000035] transition cursor-pointer border border-transparent hover:border-slate-200"
                    title="Bold (Ctrl+B)"
                  >
                    <Bold className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => applyInlineFormatting('*', '*', 'italic text')}
                    className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-700 hover:text-[#000035] transition cursor-pointer border border-transparent hover:border-slate-200"
                    title="Italic (Ctrl+I)"
                  >
                    <Italic className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => applyInlineFormatting('<u>', '</u>', 'underlined text')}
                    className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-700 hover:text-[#000035] transition cursor-pointer border border-transparent hover:border-slate-200"
                    title="Underline (Ctrl+U)"
                  >
                    <Underline className="w-4 h-4" />
                  </button>
                </div>

                <div className="w-px h-5 bg-slate-200 mx-0.5" />

                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => applyLinePrefix('• ')}
                    className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-700 hover:text-[#000035] transition cursor-pointer border border-transparent hover:border-slate-200"
                    title="Bullet Point List"
                  >
                    <List className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => applyLinePrefix('1. ')}
                    className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-700 hover:text-[#000035] transition cursor-pointer border border-transparent hover:border-slate-200"
                    title="Numbered List"
                  >
                    <ListOrdered className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => applyLinePrefix('> ')}
                    className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-700 hover:text-[#000035] transition cursor-pointer border border-transparent hover:border-slate-200"
                    title="Blockquote / Tip"
                  >
                    <Quote className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => insertSnippet('\n---\n')}
                    className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-700 hover:text-[#000035] transition cursor-pointer border border-transparent hover:border-slate-200"
                    title="Insert Section Divider"
                  >
                    <Minus className="w-4 h-4" />
                  </button>
                </div>

                <div className="w-px h-5 bg-slate-200 mx-0.5" />

                {/* Pre-styled Coaching Stamp Toolbar Group */}
                <div className="flex items-center gap-1.5 bg-slate-50 px-2 py-1 rounded-xl border border-slate-200/90 shadow-2xs flex-wrap">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider hidden sm:inline mr-0.5">
                    Stamps:
                  </span>

                  {/* Pre-styled Quick-Click Button for "✓ Correct" (light green bg #ecfdf5, dark green border #15803d, checkmark ✓) */}
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => insertInlineTag('correct')}
                    className="group px-2.5 py-1 rounded-lg text-xs font-bold transition flex items-center gap-1.5 cursor-pointer bg-[#ecfdf5] hover:bg-emerald-100/90 active:scale-95 text-[#15803d] border border-[#15803d] shadow-2xs"
                    title="Insert Pre-styled Correct Tag (Shortcut: Alt+Y)"
                    aria-label="Insert Correct (✓) inline tag component"
                  >
                    <span
                      className="inline-flex items-center justify-center font-bold text-xs px-1 py-0.2 rounded-md bg-[#ecfdf5] border border-[#15803d] text-[#15803d]"
                    >
                      ✓
                    </span>
                    <span>Correct</span>
                    <kbd className="hidden lg:inline-block px-1 py-0.2 rounded bg-emerald-100/90 text-[9px] font-mono text-emerald-800 border border-emerald-300/40">
                      Alt+Y
                    </kbd>
                  </button>

                  {/* Pre-styled Quick-Click Button for "✗ Incorrect" (light red bg #fff1f2, dark red border #b91c1c, cross ✗) */}
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => insertInlineTag('incorrect')}
                    className="group px-2.5 py-1 rounded-lg text-xs font-bold transition flex items-center gap-1.5 cursor-pointer bg-[#fff1f2] hover:bg-rose-100/90 active:scale-95 text-[#b91c1c] border border-[#b91c1c] shadow-2xs"
                    title="Insert Pre-styled Incorrect Tag (Shortcut: Alt+N or Ctrl+Alt+N)"
                    aria-label="Insert Incorrect (✗) inline tag component"
                  >
                    <span
                      className="inline-flex items-center justify-center font-bold text-xs px-1 py-0.2 rounded-md bg-[#fff1f2] border border-[#b91c1c] text-[#b91c1c]"
                    >
                      ✗
                    </span>
                    <span>Incorrect</span>
                    <kbd className="hidden lg:inline-block px-1 py-0.2 rounded bg-rose-100/90 text-[9px] font-mono text-rose-800 border border-rose-300/40">
                      Alt+N
                    </kbd>
                  </button>

                  {/* Pre-styled Quick-Click Button for "New Word" (light blue bg #eff6ff, dark blue border #1d4ed8, star/glyph ✦) */}
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => insertInlineTag('new-word')}
                    className="group px-2.5 py-1 rounded-lg text-xs font-bold transition flex items-center gap-1.5 cursor-pointer bg-[#eff6ff] hover:bg-blue-100/90 active:scale-95 text-[#1d4ed8] border border-[#1d4ed8] shadow-2xs"
                    title="Insert Pre-styled New Word Tag (Shortcut: Alt+W or Ctrl+Alt+W)"
                    aria-label="Insert New Word inline tag component"
                  >
                    <span
                      className="inline-flex items-center justify-center font-bold text-xs px-1 py-0.2 rounded-md bg-[#eff6ff] border border-[#1d4ed8] text-[#1d4ed8]"
                    >
                      ✦
                    </span>
                    <span>New Word</span>
                    <kbd className="hidden lg:inline-block px-1 py-0.2 rounded bg-blue-100/90 text-[9px] font-mono text-blue-800 border border-blue-300/40">
                      Alt+W
                    </kbd>
                  </button>

                  {/* Pre-styled Quick-Click Button for "Pronounce" (light purple bg #faf5ff, dark purple border #7e22ce, target 🎯) */}
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => insertInlineTag('pronounce')}
                    className="group px-2.5 py-1 rounded-lg text-xs font-bold transition flex items-center gap-1.5 cursor-pointer bg-[#faf5ff] hover:bg-purple-100/90 active:scale-95 text-[#7e22ce] border border-[#7e22ce] shadow-2xs"
                    title="Insert Pre-styled Pronounce Tag (Shortcut: Alt+P or Ctrl+P)"
                    aria-label="Insert Pronounce inline tag component"
                  >
                    <span
                      className="inline-flex items-center justify-center font-bold text-xs px-1 py-0.2 rounded-md bg-[#faf5ff] border border-[#7e22ce] text-[#7e22ce]"
                    >
                      🎯
                    </span>
                    <span>Pronounce</span>
                    <kbd className="hidden lg:inline-block px-1 py-0.2 rounded bg-purple-100/90 text-[9px] font-mono text-purple-800 border border-purple-300/40">
                      Alt+P
                    </kbd>
                  </button>
                </div>
              </div>

              {/* Right: View Mode Toggle & Copy & Status Badges */}
              <div className="flex items-center gap-2 flex-wrap">
                {/* View Mode Toggle */}
                <div className="flex items-center p-0.5 bg-slate-100 rounded-xl border border-slate-200">
                  <button
                    type="button"
                    onClick={() => setEditorViewMode('edit')}
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold transition flex items-center gap-1 cursor-pointer ${
                      editorViewMode === 'edit'
                        ? 'bg-white text-[#000035] shadow-2xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                    title="Direct Writing Canvas"
                  >
                    <Edit3 className="w-3 h-3" />
                    <span className="hidden sm:inline">Editor</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditorViewMode('split')}
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold transition flex items-center gap-1 cursor-pointer ${
                      editorViewMode === 'split'
                        ? 'bg-white text-[#000035] shadow-2xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                    title="Side-by-Side Editor & Formatted Preview"
                  >
                    <Columns className="w-3 h-3" />
                    <span className="hidden sm:inline">Split</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditorViewMode('preview')}
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold transition flex items-center gap-1 cursor-pointer ${
                      editorViewMode === 'preview'
                        ? 'bg-white text-[#000035] shadow-2xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                    title="Rich-Text Formatted Document Preview"
                  >
                    <Eye className="w-3 h-3" />
                    <span className="hidden sm:inline">Preview</span>
                  </button>
                </div>

                <button
                  type="button"
                  onClick={handleCopyForMeetChat}
                  className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 hover:text-[#000035] rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer border border-slate-200 shadow-2xs"
                  title="Copy formatted document to paste into Google Meet Chat"
                >
                  {copiedSuccess ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                      <span className="text-emerald-700">Copied for Meet!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5 text-slate-500" />
                      <span>Copy for Meet Chat</span>
                    </>
                  )}
                </button>

                {/* FASE NF-DOC.2C: Apply AI top button */}
                <button
                  type="button"
                  id="btn-apply-ai-top"
                  disabled={isApplyingAi || isSaving}
                  onClick={handleApplyAi}
                  className="px-3 py-1.5 bg-white hover:bg-slate-50 text-[#1C4C96] border border-[#1C4C96]/40 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-2xs disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Saves notes and triggers Gemini to synthesize the pedagogical report"
                  aria-label="Apply AI"
                >
                  {isApplyingAi ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-[#1C4C96]" />
                  ) : (
                    <Sparkles className="w-3.5 h-3.5 text-[#1C4C96]" />
                  )}
                  <span>{isApplyingAi ? 'Applying AI...' : 'Apply AI'}</span>
                </button>

                {/* FASE NF-DOC.2C: Approve & Publish top button */}
                {editableTransformation && (
                  <button
                    type="button"
                    id="btn-approve-publish-top"
                    disabled={isApproving || isDraftStale}
                    onClick={handleApproveAndPublish}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow-2xs border ${
                      isDraftStale
                        ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed'
                        : approvalStatus === 'approved'
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-300 cursor-pointer'
                        : 'bg-[#15803d] text-white hover:bg-[#166534] border-[#15803d] cursor-pointer'
                    }`}
                    title={
                      isDraftStale
                        ? 'Notes modified. Re-apply AI before approving.'
                        : 'Approve and publish pedagogical report for the student'
                    }
                    aria-label="Approve & Publish"
                  >
                    {isApproving ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-current" />
                    ) : (
                      <CheckCircle2 className="w-3.5 h-3.5 text-current" />
                    )}
                    <span>
                      {isApproving
                        ? 'Publishing...'
                        : approvalStatus === 'approved'
                        ? 'Published ✓'
                        : 'Approve & Publish'}
                    </span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={handleResetDocument}
                  className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-slate-700 transition cursor-pointer"
                  title="Reset to clean document template"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Document Paper Canvas Modes */}
            {editorViewMode === 'edit' && (
              /* Direct Focused Editor Mode */
              <div className="p-4 sm:p-6 bg-slate-100/50 flex justify-center">
                <div
                  id="session-notes-paper-sheet"
                  data-testid="session-notes-paper-sheet"
                  className="w-full max-w-4xl bg-white rounded-2xl border border-slate-300 shadow-sm p-6 sm:p-8 space-y-3 cursor-text focus-within:border-[#1C4C96] focus-within:ring-2 focus-within:ring-[#1C4C96]/20 transition"
                  onClick={(e) => {
                    if (e.target === e.currentTarget) {
                      focusEditorAtEnd(editorRef.current);
                    }
                  }}
                >
                  <div className="flex items-center justify-between border-b border-slate-100 pb-2 text-[11px] text-slate-400 font-mono uppercase tracking-wider flex-wrap gap-2 pointer-events-auto">
                    <span>DOCUMENT: Native Friend Coaching Record</span>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#ecfdf5] text-[#15803d] border border-[#15803d] text-[10px] font-bold shadow-2xs"
                        title="Total Correct (✓) Tags"
                      >
                        <span className="font-black text-xs">✓</span> {correctCount} Correct
                      </span>
                      <span
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#fff1f2] text-[#b91c1c] border border-[#b91c1c] text-[10px] font-bold shadow-2xs"
                        title="Total Incorrect (✗) Tags"
                      >
                        <span className="font-black text-xs">✗</span> {incorrectCount} Corrections
                      </span>
                      <span
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#eff6ff] text-[#1d4ed8] border border-[#1d4ed8] text-[10px] font-bold shadow-2xs"
                        title="Total New Word Tags"
                      >
                        <span className="font-black text-xs">✦</span> {newWordCount} Words
                      </span>
                      <span
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#faf5ff] text-[#7e22ce] border border-[#7e22ce] text-[10px] font-bold shadow-2xs"
                        title="Total Pronounce Tags"
                      >
                        <span className="font-black text-xs">🎯</span> {pronounceCount} Pronounce
                      </span>
                      <span className="hidden sm:inline text-slate-300">•</span>
                      <span>Session Date: {sessionDate}</span>
                    </div>
                  </div>

                  <div
                    className="relative w-full min-h-[420px]"
                    onClick={(e) => {
                      if (e.target === e.currentTarget) {
                        focusEditorAtEnd(editorRef.current);
                      }
                    }}
                  >
                    <div
                      ref={editorRef}
                      id="session-notes-canvas-editor"
                      data-testid="session-notes-canvas-editor"
                      contentEditable={true}
                      suppressContentEditableWarning={true}
                      role="textbox"
                      aria-multiline={true}
                      tabIndex={0}
                      onInput={handleEditorInput}
                      onKeyDown={handleEditorKeyDown}
                      onBlur={handleEditorBlur}
                      onClick={(e) => e.stopPropagation()}
                      className="relative z-10 w-full bg-transparent border-0 text-[#000035] text-sm leading-relaxed placeholder:text-slate-400 focus:outline-hidden min-h-[420px] font-sans selection:bg-[#9AB4FF]/40 p-0 m-0 block outline-none cursor-text whitespace-pre-wrap break-words"
                      spellCheck={false}
                    />
                  </div>

                  {/* FASE NF-DOC.2C: Editorial Pedagogical Synthesis Section */}
                  {renderPedagogicalSection()}
                </div>
              </div>
            )}

            {editorViewMode === 'split' && (
              /* Side-by-Side Split View Mode */
              <div className="space-y-4">
                <div className="p-4 sm:p-6 bg-slate-100/50 grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {/* Left Column: Direct Editor */}
                  <div
                    id="session-notes-split-sheet"
                    className="bg-white rounded-2xl border border-slate-300 shadow-sm p-5 sm:p-6 space-y-3 cursor-text focus-within:border-[#1C4C96] focus-within:ring-2 focus-within:ring-[#1C4C96]/20 transition"
                    onClick={(e) => {
                      if (e.target === e.currentTarget) {
                        focusEditorAtEnd(splitEditorRef.current);
                      }
                    }}
                  >
                    <div className="flex items-center justify-between border-b border-slate-100 pb-2 text-[11px] text-slate-400 font-mono uppercase tracking-wider">
                      <span>EDITING CANVAS</span>
                      <span>Session: {sessionDate}</span>
                    </div>
                    <div
                      ref={splitEditorRef}
                      id="session-notes-split-editor"
                      data-testid="session-notes-split-editor"
                      contentEditable={true}
                      suppressContentEditableWarning={true}
                      role="textbox"
                      aria-multiline={true}
                      tabIndex={0}
                      onInput={handleEditorInput}
                      onKeyDown={handleEditorKeyDown}
                      onBlur={handleEditorBlur}
                      onClick={(e) => e.stopPropagation()}
                      className="w-full bg-transparent border-0 text-[#000035] text-sm leading-relaxed placeholder:text-slate-400 focus:outline-hidden min-h-[420px] font-sans selection:bg-[#9AB4FF]/40 p-0 m-0 block outline-none cursor-text whitespace-pre-wrap break-words"
                      spellCheck={false}
                    />
                  </div>

                  {/* Right Column: Live Rich-Text Rendered Document */}
                  <div className="bg-white rounded-2xl border border-slate-300 shadow-sm p-5 sm:p-6 space-y-3 overflow-y-auto max-h-[580px]">
                    <div className="flex items-center justify-between border-b border-slate-100 pb-2 text-[11px] text-slate-400 font-mono uppercase tracking-wider flex-wrap gap-2">
                      <span>FORMATTED DOCUMENT PREVIEW</span>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#ecfdf5] text-[#15803d] text-[10px] font-bold border border-[#15803d]">
                          ✓ {correctCount}
                        </span>
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#fff1f2] text-[#b91c1c] text-[10px] font-bold border border-[#b91c1c]">
                          ✗ {incorrectCount}
                        </span>
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#eff6ff] text-[#1d4ed8] text-[10px] font-bold border border-[#1d4ed8]">
                          ✦ {newWordCount}
                        </span>
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#faf5ff] text-[#7e22ce] text-[10px] font-bold border border-[#7e22ce]">
                          🎯 {pronounceCount}
                        </span>
                      </div>
                    </div>
                    <div className="space-y-1 text-sm font-sans leading-relaxed">
                      {renderRichSessionNotes(notesContent)}
                    </div>
                  </div>
                </div>

                {/* FASE NF-DOC.2C: Pedagogical Synthesis in Split Mode */}
                <div className="p-4 sm:p-6 pt-0 bg-slate-100/50 flex justify-center">
                  <div className="w-full max-w-4xl bg-white rounded-2xl border border-slate-300 shadow-sm p-6 sm:p-8">
                    {renderPedagogicalSection()}
                  </div>
                </div>
              </div>
            )}

            {editorViewMode === 'preview' && (
              /* Full Width Rich-Text Preview Mode */
              <div className="p-4 sm:p-6 bg-slate-100/50 flex justify-center">
                <div
                  id="session-notes-preview-sheet"
                  className="w-full max-w-4xl bg-white rounded-2xl border border-slate-300 shadow-sm p-6 sm:p-8 space-y-4 cursor-pointer hover:border-[#1C4C96]/50 transition group"
                  onClick={() => {
                    setEditorViewMode('edit');
                    setTimeout(() => focusEditorAtEnd(editorRef.current), 50);
                  }}
                  title="Click to switch to direct editor"
                >
                  <div className="flex items-center justify-between border-b border-slate-100 pb-2 text-[11px] text-slate-400 font-mono uppercase tracking-wider flex-wrap gap-2">
                    <span>RICH FORMATTED DOCUMENT</span>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#ecfdf5] text-[#15803d] border border-[#15803d] text-[10px] font-bold shadow-2xs">
                        <span className="font-black text-xs">✓</span> {correctCount} Correct
                      </span>
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#fff1f2] text-[#b91c1c] border border-[#b91c1c] text-[10px] font-bold shadow-2xs">
                        <span className="font-black text-xs">✗</span> {incorrectCount} Corrections
                      </span>
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#eff6ff] text-[#1d4ed8] border border-[#1d4ed8] text-[10px] font-bold shadow-2xs">
                        <span className="font-black text-xs">✦</span> {newWordCount} Words
                      </span>
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#faf5ff] text-[#7e22ce] border border-[#7e22ce] text-[10px] font-bold shadow-2xs">
                        <span className="font-black text-xs">🎯</span> {pronounceCount} Pronounce
                      </span>
                      <span>Session Date: {sessionDate}</span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditorViewMode('edit');
                          setTimeout(() => focusEditorAtEnd(editorRef.current), 50);
                        }}
                        className="text-xs font-bold text-[#1C4C96] hover:underline ml-2 flex items-center gap-1 cursor-pointer"
                      >
                        <Edit3 className="w-3 h-3" /> Edit Document
                      </button>
                    </div>
                  </div>
                  <div className="space-y-1 font-sans min-h-[380px]">
                    {renderRichSessionNotes(notesContent)}
                  </div>

                  {/* FASE NF-DOC.2C: Pedagogical Synthesis in Preview Mode */}
                  {renderPedagogicalSection()}
                </div>
              </div>
            )}

            {/* Document Status & Statistics Footer */}
            <div className="bg-white border-t border-slate-200 p-3 px-4 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-500">
              <div className="flex items-center gap-3 flex-wrap">
                <span className="font-semibold text-slate-600">
                  {wordCount} words • {charCount} characters
                </span>
                <span className="hidden sm:inline text-slate-300">•</span>
                <span className="text-[11px] text-slate-500 flex items-center gap-1.5 flex-wrap">
                  <span>Shortcuts:</span>
                  <span className="inline-flex items-center gap-1">
                    <kbd className="px-1 py-0.5 rounded bg-slate-100 border border-slate-200 text-[10px] font-mono">
                      Alt+Y
                    </kbd>
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded-md bg-[#ecfdf5] border border-[#15803d] text-[#15803d] text-[10px] font-bold">
                      ✓ Correct
                    </span>
                  </span>
                  <span>•</span>
                  <span className="inline-flex items-center gap-1">
                    <kbd className="px-1 py-0.5 rounded bg-slate-100 border border-slate-200 text-[10px] font-mono">
                      Alt+N
                    </kbd>
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded-md bg-[#fff1f2] border border-[#b91c1c] text-[#b91c1c] text-[10px] font-bold">
                      ✗ Incorrect
                    </span>
                  </span>
                  <span>•</span>
                  <span className="inline-flex items-center gap-1">
                    <kbd className="px-1 py-0.5 rounded bg-slate-100 border border-slate-200 text-[10px] font-mono">
                      Alt+W
                    </kbd>
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded-md bg-[#eff6ff] border border-[#1d4ed8] text-[#1d4ed8] text-[10px] font-bold">
                      ✦ New Word
                    </span>
                  </span>
                  <span>•</span>
                  <span className="inline-flex items-center gap-1">
                    <kbd className="px-1 py-0.5 rounded bg-slate-100 border border-slate-200 text-[10px] font-mono">
                      Alt+P
                    </kbd>
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded-md bg-[#faf5ff] border border-[#7e22ce] text-[#7e22ce] text-[10px] font-bold">
                      🎯 Pronounce
                    </span>
                  </span>
                  <span>•</span>
                  <span className="inline-flex items-center gap-1">
                    <kbd className="px-1 py-0.5 rounded bg-slate-100 border border-slate-200 text-[10px] font-mono">
                      Ctrl+B
                    </kbd>
                    <span>bold</span>
                  </span>
                  <span>•</span>
                  <span className="inline-flex items-center gap-1">
                    <kbd className="px-1 py-0.5 rounded bg-slate-100 border border-slate-200 text-[10px] font-mono">
                      Tab
                    </kbd>
                    <span>indent</span>
                  </span>
                </span>
              </div>

              {/* Firestore & Google Drive Real-time Persistence Status */}
              {/* Firestore Real-time Persistence Status */}
              <div className="flex items-center gap-2">
                {isSaving ? (
                  <div className="flex items-center gap-1.5 text-blue-600 font-medium text-xs">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Auto-saving to Firestore...</span>
                  </div>
                ) : lastSavedTimestamp ? (
                  <div className="flex items-center gap-1.5 text-emerald-700 font-semibold text-xs">
                    <span className="w-2 h-2 rounded-full bg-emerald-500" />
                    <span>
                      Saved to Firestore (Session: {sessionDate})
                    </span>
                  </div>
                ) : (
                  <span className="text-slate-400 text-xs">Firestore Ready</span>
                )}
              </div>
            </div>
          </div>

          {/* Action Bar (Save Document to Firestore & FASE NF-DOC.2C AI Actions) */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-1">
            <div className="flex items-center gap-2 flex-wrap">
              {savedSuccessBanner && (
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-100 text-emerald-800 text-xs font-bold animate-in fade-in duration-200 shadow-2xs">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  <span>Document saved successfully to Firestore!</span>
                </div>
              )}
              {saveError && (
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-rose-100 text-rose-800 text-xs font-bold animate-in fade-in duration-200 shadow-2xs">
                  <AlertCircle className="w-4 h-4 text-rose-600" />
                  <span>{saveError}</span>
                </div>
              )}
              {aiSuccessMessage && !savedSuccessBanner && (
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-50 text-emerald-800 text-xs font-bold animate-in fade-in duration-200 shadow-2xs border border-emerald-200">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  <span>{aiSuccessMessage}</span>
                </div>
              )}
              {aiError && !saveError && (
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-rose-50 text-rose-800 text-xs font-bold animate-in fade-in duration-200 shadow-2xs border border-rose-200">
                  <AlertCircle className="w-4 h-4 text-rose-600" />
                  <span>{aiError}</span>
                </div>
              )}
              {isDraftStale && (
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-50 text-amber-800 text-xs font-semibold border border-amber-200">
                  <span>⚠️ Draft outdated with original notes</span>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2.5 flex-wrap justify-end">
              <button
                type="button"
                id="btn-save-notes"
                disabled={isSaving}
                onClick={() => persistSessionDocument(notesContent, topic, true)}
                className={`px-5 py-2.5 rounded-xl text-xs font-bold transition flex items-center gap-2 shadow-xs border border-[#9AB4FF]/40 active:scale-98 ${
                  isSaving
                    ? 'bg-[#1C4C96]/70 text-white cursor-not-allowed'
                    : 'bg-[#1C4C96] hover:bg-[#062863] text-white cursor-pointer'
                }`}
                title="Save manual notes changes to Firestore"
              >
                {isSaving ? (
                  <Loader2 className="w-4 h-4 animate-spin text-[#9AB4FF]" />
                ) : (
                  <Save className="w-4 h-4 text-[#9AB4FF]" />
                )}
                <span>{isSaving ? 'Saving...' : 'Save Notes'}</span>
              </button>

              <button
                type="button"
                id="btn-apply-ai-bottom"
                disabled={isApplyingAi || isSaving}
                onClick={handleApplyAi}
                className="px-5 py-2.5 bg-white hover:bg-slate-50 text-[#1C4C96] border border-[#1C4C96]/40 rounded-xl text-xs font-bold transition flex items-center gap-2 cursor-pointer shadow-xs disabled:opacity-50 disabled:cursor-not-allowed active:scale-98"
                title="Saves notes and triggers Gemini to structure the pedagogical report"
                aria-label="Apply AI"
              >
                {isApplyingAi ? (
                  <Loader2 className="w-4 h-4 animate-spin text-[#1C4C96]" />
                ) : (
                  <Sparkles className="w-4 h-4 text-[#1C4C96]" />
                )}
                <span>{isApplyingAi ? 'Applying AI...' : 'Apply AI'}</span>
              </button>

              {editableTransformation && (
                <button
                  type="button"
                  id="btn-approve-publish-bottom"
                  disabled={isApproving || isDraftStale}
                  onClick={handleApproveAndPublish}
                  className={`px-6 py-2.5 rounded-xl text-xs font-bold transition flex items-center gap-2 shadow-xs border active:scale-98 ${
                    isDraftStale
                      ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed'
                      : approvalStatus === 'approved'
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-300 cursor-pointer'
                      : 'bg-[#15803d] text-white hover:bg-[#166534] border-[#15803d] cursor-pointer'
                  }`}
                  title={
                    isDraftStale
                      ? 'Notes modified. Re-apply AI before approving.'
                      : 'Approve and publish pedagogical report'
                  }
                  aria-label="Approve & Publish"
                >
                  {isApproving ? (
                    <Loader2 className="w-4 h-4 animate-spin text-current" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4 text-current" />
                  )}
                  <span>
                    {isApproving
                      ? 'Publishing...'
                      : approvalStatus === 'approved'
                      ? 'Published ✓'
                      : 'Approve & Publish'}
                  </span>
                </button>
              )}
            </div>
          </div>
        </div>
      ) : (
        /* History of Past Notes for this student */
        <div className="space-y-3">
          <div className="flex items-center justify-between text-xs text-[#607EC9] font-semibold border-b border-slate-100 pb-2">
            <span>
              Past session records for {resolveStudentName(activeStudent, null, selectedStudentEmail)}
            </span>
            <span>{studentHistory.length} recorded session(s)</span>
          </div>

          {studentHistory.length === 0 ? (
            <div className="py-10 text-center text-slate-400 text-xs italic bg-slate-50 rounded-2xl border border-dashed border-slate-200 space-y-1">
              <FileText className="w-8 h-8 text-slate-300 mx-auto" />
              <p>No previous session records found for this student.</p>
              <p className="text-[11px] text-slate-400">
                Write in the Document Editor tab to save your first in-session coaching document.
              </p>
            </div>
          ) : (
            <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
              {studentHistory.map((hist) => {
                const effectiveText =
                  hist.sessionNotesDocument ||
                  hist.liveNotes ||
                  hist.recommendations ||
                  '';
                const formattedDate = hist.startDateTime
                  ? formatDateInTimeZone(hist.startDateTime, timeZone, 'en')
                  : 'Past Session';
                const formattedTime = hist.startDateTime
                  ? formatTimeInTimeZone(hist.startDateTime, timeZone)
                  : '';

                return (
                  <div
                    key={hist.id}
                    className="p-4 bg-slate-50/90 rounded-2xl border border-[#607EC9]/30 space-y-2.5 shadow-2xs hover:border-[#607EC9] transition"
                  >
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-xs text-[#000035]">
                          {hist.title || 'Live Coaching Session'}
                        </span>
                        <span className="px-2 py-0.5 rounded-md bg-[#9AB4FF]/20 text-[#062863] text-[10px] font-mono font-bold">
                          {formattedDate} {formattedTime ? `• ${formattedTime}` : ''}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5 flex-wrap">
                        <button
                          type="button"
                          onClick={() => {
                            try {
                              if (navigator?.clipboard?.writeText) {
                                navigator.clipboard
                                  .writeText(effectiveText)
                                  .catch(() => fallbackCopyText(effectiveText));
                              } else {
                                fallbackCopyText(effectiveText);
                              }
                            } catch {
                              fallbackCopyText(effectiveText);
                            }
                          }}
                          className="px-2.5 py-1 bg-white hover:bg-slate-100 text-slate-600 rounded-lg text-xs font-semibold border border-slate-200 transition cursor-pointer flex items-center gap-1"
                          title="Copy session notes to clipboard"
                        >
                          <Copy className="w-3 h-3" />
                          <span>Copy</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            handleSessionChange(hist.id);
                            if (hist.startDateTime && typeof hist.startDateTime === 'string') {
                              setSessionDate(hist.startDateTime.split('T')[0]);
                            }
                            setActiveTab('editor');
                          }}
                          className="px-2.5 py-1 bg-[#1C4C96] hover:bg-[#062863] text-white rounded-lg text-xs font-bold transition cursor-pointer"
                        >
                          Load into Editor
                        </button>
                      </div>
                    </div>

                    {effectiveText ? (
                      <div className="p-3 bg-white rounded-xl border border-slate-200 text-xs text-slate-700 whitespace-pre-wrap font-sans max-h-48 overflow-y-auto leading-relaxed space-y-1">
                        {renderRichSessionNotes(effectiveText)}
                      </div>
                    ) : (
                      <p className="text-xs text-slate-400 italic">
                        No text recorded for this session.
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

interface TeacherNotesErrorBoundaryProps {
  children: React.ReactNode;
}

interface TeacherNotesErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class TeacherNotesErrorBoundary extends Component<
  TeacherNotesErrorBoundaryProps,
  TeacherNotesErrorBoundaryState
> {
  override state: TeacherNotesErrorBoundaryState = { hasError: false, error: null };

  constructor(props: TeacherNotesErrorBoundaryProps) {
    super(props);
  }

  static getDerivedStateFromError(error: Error): TeacherNotesErrorBoundaryState {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('TeacherNotesErrorBoundary caught an error in Live Lesson Notes:', error, errorInfo);
  }

  override render() {
    if (this.state.hasError) {
      return (
        <div className="bg-white rounded-3xl p-6 sm:p-8 border border-rose-200/80 shadow-xs space-y-4 text-center animate-in fade-in duration-200">
          <div className="w-12 h-12 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center mx-auto border border-rose-200">
            <AlertCircle className="w-6 h-6 text-rose-600" />
          </div>
          <div className="space-y-1 max-w-md mx-auto">
            <h4 className="font-black text-base text-[#000035]">Unable to Display Live Lesson Notes</h4>
            <p className="text-xs text-slate-500 font-medium leading-relaxed">
              A temporary issue occurred while loading this student&apos;s session notes. Your recorded lessons and Google Drive files are safe.
            </p>
          </div>
          <div className="flex items-center justify-center gap-3 pt-2">
            <button
              type="button"
              onClick={() => this.setState({ hasError: false, error: null })}
              className="px-4 py-2 bg-[#1C4C96] hover:bg-[#062863] text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-xs"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Retry Loading Notes</span>
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export const TeacherLiveLessonNotesPanel: React.FC<TeacherLiveLessonNotesPanelProps> = (props) => {
  return (
    <TeacherNotesErrorBoundary>
      <TeacherLiveLessonNotesPanelComponent {...props} />
    </TeacherNotesErrorBoundary>
  );
};
