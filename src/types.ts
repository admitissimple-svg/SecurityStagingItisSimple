export enum EnglishLevel {
  BEGINNER = 'iniciante',
  INTERMEDIATE = 'intermediario',
  ADVANCED = 'avancado',
}

export type DayOfWeek =
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday'
  | 'sunday';

export type DayType = 'weekdays' | 'weekends';

export type Language =
  | 'pt'
  | 'en'
  | 'es'
  | 'fr'
  | 'de'
  | 'it'
  | 'ja'
  | 'ko'
  | 'zh'
  | 'ru'
  | 'ar'
  | 'tr';

export type UserRole = 'student' | 'teacher' | 'admin';

export interface NativeFriendTutor {
  id: string;
  uid?: string;
  name: string;
  email: string;
  avatar: string;
  country: string;
  countryCode?: string;
  flag?: string;
  accent?: string;
  rating?: number;
  reviewsCount?: number;
  activeStudents?: number;
  lessonsTaught?: number;
  pricePerSessionUsd?: number;
  pricePerSessionBrl?: number;
  headline: string;
  bio: string;
  specialties: string[];
  videoIntroUrl?: string;
  youtubeEmbedId?: string;
  introVideoUrl?: string;
  videoUrl?: string;
  youtubeUrl?: string;
  availableDays?: DayOfWeek[];
  availableHours?: string[];
  isSuperTutor?: boolean;
  languagesSpoken?: string[];
  approvalStatus?: 'approved' | 'pending' | 'rejected';
  isApproved?: boolean;
  status?: string;
  approved?: boolean;
  appliedAt?: string;
  meetUrl?: string;
  meetLink?: string;
  photoUrl?: string;
  timezone?: string;
  availability?: Record<string, string[]>;
  availableHoursByDay?: Record<string, string[]>;
  role?: 'teacher' | 'student' | 'admin' | string;
}

export interface AdminLandingContent {
  heroBadge: string;
  heroHeadlineStart: string;
  heroHeadlineHighlight: string;
  heroQuote: string;
  heroSubtext: string;
  heroFindFriendBtn: string;
  heroStartLivingBtn: string;
  philosophyBadge: string;
  philosophyHeading1: string;
  philosophyHeading2: string;
  philosophySubheading: string;
  philosophyPillar1Title: string;
  philosophyPillar1Desc: string;
  philosophyPillar1Tag: string;
  philosophyPillar2Title: string;
  philosophyPillar2Desc: string;
  philosophyPillar2Tag: string;
  philosophyPillar3Title: string;
  philosophyPillar3Desc: string;
  philosophyPillar3Tag: string;
  footerSlogan: string;
}

export interface StudentDictionaryEntry {
  id: string;
  word: string;
  definitionEn: string;
  partOfSpeech?: string;
  phonetic?: string;
  exampleSentenceEn?: string;
  translationPt?: string;
  sourceActivityName?: string;
  sourceDay?: DayOfWeek;
  source?: 'api' | 'offline_dict' | 'fallback' | 'custom' | 'not_found' | string;
  learnedAt?: string;
  customNotes?: string;
  notFound?: boolean;
  cefrLevel?: string;
  practiceCount?: number;
  lastPracticedAt?: string;
}
export interface GoogleAccount {
  id?: string;
  uid?: string;
  email: string;
  name: string;
  role: UserRole;
  picture?: string;
  avatar?: string;
  assignedNativeFriendUID?: string;
  nativeFriendUID?: string;
  teacherEmail?: string;
  teacherName?: string;
  level?: string;
  studentLevel?: string;
  studentName?: string;
  studentEmail?: string;
  registeredByAdmin?: boolean;
  weeklyStudyDays?: DayOfWeek[];
  weeklyStudyDaysTarget?: number;
  weeklyCycle?: number;
}

export interface TeacherAssignedVideo {
  id: string;
  url: string;
  videoId: string;
  title: string;
  duration?: string;
  instructions?: string;
  addedAt?: string;
  playlistId?: string;
  playlistTitle?: string;
  isCustomSuggestion?: boolean;
}

export interface TeacherAssignedSpotify {
  id: string;
  url: string;
  title: string;
  type?: 'podcast' | 'music' | 'episode' | 'track' | 'playlist' | 'show';
  artistOrHost?: string;
  duration?: string;
  instructions?: string;
  addedAt?: string;
}

export interface TeacherOverrideTrack {
  id?: string;
  trackId?: string;
  title: string;
  artist?: string;
  artistOrHost?: string;
  url: string;
  embedUrl?: string;
  coverUrl?: string;
  imageUrl?: string;
  instructions?: string;
  teacherUid?: string;
  teacherName?: string;
  teacherEmail?: string;
  updatedAt?: string;
}

export interface RoutineItem {
  id: string;
  dayType?: DayType;
  dayOfWeek?: DayOfWeek;
  time: string;
  activityName: string;
  category?: string;
  isMandatory?: boolean;
  teacherVideos?: TeacherAssignedVideo[];
  teacherSpotify?: TeacherAssignedSpotify;
  teacherNotes?: string;
  learnedWords?: string[];
  completedToday?: boolean;
  completed?: boolean;
  isRepeatVideo?: boolean;
}

export interface DailyJournalEntry {
  id: string;
  date: string;
  sentence: string;
  wordsUsed: string[];
  createdAt: string;
  correctedSentence?: string;
  explanation?: string;
  hasErrors?: boolean;
  evaluationResult?: WritingEvaluationResult | null;
  usedWords?: string[];
  missingWords?: string[];
  studentUid?: string;
  studentEmail?: string;
}

export type StudentJournalActivityType = 'video' | 'audio' | 'memorization' | 'lesson' | 'sentence' | 'tutor_live';

export interface StudentJournalEntry {
  id: string;
  type: StudentJournalActivityType;
  date: string; // YYYY-MM-DD
  week: number;
  timestamp: number;
  dayOfWeek?: DayOfWeek;
  title?: string;
  artist?: string;
  partNumber?: number;
  url?: string;
  details?: string;
  studentUid?: string;
  studentEmail?: string;
  isRepeat?: boolean;
  isRepeatVideo?: boolean;
  repeatVideo?: boolean;
  isReview?: boolean;
  reviewedPastDay?: boolean;
  playlistId?: string;
}

export interface UserProfile {
  id?: string;
  uid?: string;
  name: string;
  email: string;
  picture?: string;
  avatar?: string;
  level: EnglishLevel;
  userLevel?: EnglishLevel | string;
  englishLevel?: EnglishLevel | string;
  teacherEmail?: string;
  teacherName?: string;
  teacherUid?: string;
  teacherMeetUrl?: string;
  teacherMeetLink?: string;
  assignedNativeFriendUID?: string;
  nativeFriendUID?: string;
  routineVideoTime?: string;
  routineAudioTime?: string;
  dailyPhraseTime?: string;
  enrollmentStatus?: 'active' | 'not_enrolled' | 'cancelled';
  enrolledAt?: string;
  createdAt?: string;
  updatedAt?: string;
  learningGoal?: string;
  timezone?: string;
  notificationLeadMinutes?: number;
  enableAudioChime?: boolean;
  enableBrowserNotifications?: boolean;
  onboardingCompleted?: boolean;
  streakDays?: number;
  streakCount?: number;
  points?: number;
  dailyGoalMinutes?: number;
  completedTodayMinutes?: number;
  targetAudienceCategory?: string;
  contractedLessons?: number;
  availableLessons?: number;
  completedLessonsCount?: number;
  totalVideosWatched?: number;
  totalWordsLearned?: number;
  lastActiveDate?: string;
  languagePreference?: Language;
  studentTimezone?: string;
  weeklyNativeLessonsTarget?: number;
  weeklyStudyDaysTarget?: number;
  weeklyStudyDays?: DayOfWeek[];
  weeklyCycle?: number;
  subscriptionType?: 'monthly' | 'trial' | 'package';
  monthlyFrequency?: '1x' | '2x' | '4x';
  autoRenew?: boolean;
  hasCompletedTrialLesson?: boolean;
  dailyJournalEntries?: DailyJournalEntry[];
  dailyJournalSentence?: string;
  dailySentences?: any[];
  dailyJournal?: Array<{ id: string; date: string; sentence: string; wordsUsed?: string[] }>;
  studentJournal?: StudentJournalEntry[];
  watchedVideosHistory?: any[];
  listenedTracksHistory?: any[];
}

export interface StudentProfile {
  id: string;
  uid?: string;
  name: string;
  email: string;
  studentEmail?: string;
  studentName?: string;
  level: EnglishLevel;
  studentLevel?: EnglishLevel;
  status?: string;
  contractedLessons?: number;
  completedLessonsCount?: number;
  goal?: string;
  assignedNativeFriendUID?: string;
  nativeFriendUID?: string;
  teacherEmail?: string;
  teacherName?: string;
  teacherUid?: string;
  routineVideoTime?: string;
  routineAudioTime?: string;
  dailyPhraseTime?: string;
  weeklyCycle?: number;
  weeklyStudyDaysTarget?: number;
  weeklyStudyDays?: DayOfWeek[];
  activeSince?: string;
  createdAt?: string;
  watchedVideosHistory?: any[];
  listenedTracksHistory?: any[];
}

export interface ConsumedVideoItem {
  id: string;
  videoId: string;
  videoTitle: string;
  title?: string;
  url?: string;
  watchedAt: string;
  dayOfWeek?: DayOfWeek;
  duration?: string;
  playlistTitle?: string;
  playlistId?: string;
  notes?: string;
}

export interface ConsumedTrackItem {
  id: string;
  trackId?: string;
  title: string;
  artist?: string;
  coverUrl?: string;
  listenedAt: string;
  dayOfWeek?: DayOfWeek;
  url?: string;
}

export interface WeeklyVocabularyItem {
  id?: string;
  word: string;
  translation?: string;
  translationPt?: string;
  definition?: string;
  definitionEn?: string;
  example?: string;
  learnedAt: string;
  sourceDay?: DayOfWeek;
}

export interface WeeklyHistoryDoc {
  studentUid: string;
  studentEmail?: string;
  assignedNativeFriendUID?: string;
  nativeFriendUID?: string;
  weekId: string;
  weeklyCycle?: number;
  consumedVideoIds: ConsumedVideoItem[];
  consumedTrackIds: ConsumedTrackItem[];
  weeklyVocabulary: WeeklyVocabularyItem[];
  updatedAt?: string;
}

export interface NotificationItem {
  id: string;
  title: string;
  message: string;
  type?: 'info' | 'success' | 'warning' | 'error';
  timestamp?: string;
  read?: boolean;
}

export interface StudentEnrollment {
  id: string;
  studentEmail: string;
  studentName: string;
  studentLevel: EnglishLevel;
  learningGoal: string;
  teacherEmail: string;
  teacherName: string;
  status: 'active' | 'cancelled';
  enrolledAt: string;
  cancelledAt?: string;
  cancelledBy?: 'student' | 'teacher';
  cancellationReason?: string;
}

export interface TeacherMeetSettings {
  teacherEmail: string;
  uid?: string;
  meetLink: string;
  workingHoursStart?: string;
  workingHoursEnd?: string;
  slotDurationMinutes?: number;
  availableDays?: DayOfWeek[];
  availableHours?: string[];
  availableHoursByDay?: Record<string, string[]>;
  availability?: Record<string, string[]>;
  timezone?: string;
  updatedAt?: string;
}

export interface LiveLessonVocabNote {
  id: string;
  word: string;
  meaningOrTip?: string;
  exampleSentence?: string;
  partOfSpeech?: string;
  phonetic?: string;
  audioUrl?: string;
  source?: 'api' | 'offline_dict' | 'fallback' | 'custom' | string;
  notes?: string;
}

export interface LiveLessonNote {
  id: string;
  lessonId?: string;
  teacherEmail: string;
  teacherName?: string;
  studentEmail: string;
  studentName?: string;
  topic?: string;
  sessionDate: string;
  vocabulary: LiveLessonVocabNote[];
  pronunciationNotes?: string;
  grammarAndPhrasing?: string;
  generalNotes: string;
  recommendations: string;
  createdAt: string;
  updatedAt?: string;
}

export interface LiveLesson {
  id: string;
  teacherEmail: string;
  teacherName: string;
  teacherUid?: string;
  tutorEmail?: string;
  tutorUid?: string;
  studentEmail: string;
  studentName: string;
  studentUid?: string;
  studentAvatar?: string;
  title: string;
  description?: string;
  startDateTime: string;
  endDateTime: string;
  meetLink: string;
  calendarEventId?: string;
  calendarHtmlLink?: string;
  status: 'scheduled' | 'completed' | 'not_completed' | 'cancelled';
  completedAt?: string;
  cancelledAt?: string;
  cancelledBy?: 'student' | 'teacher' | 'admin' | string;
  cancellationReason?: string;
  notCompletedAt?: string;
  notCompletedResponsible?: 'student' | 'teacher' | 'admin' | string;
  notCompletedReason?: string;
  deductedFromContract?: boolean;
  proposalStatus?:
    | 'pending'
    | 'accepted'
    | 'rejected'
    | 'pending_student_schedule'
    | 'pending_teacher_schedule'
    | 'pending_student_reschedule'
    | 'pending_teacher_reschedule'
    | 'pending_student_cancellation'
    | 'pending_teacher_cancellation';
  proposedBy?: 'student' | 'teacher' | 'admin';
  proposedAt?: string;
  proposedReason?: string;
  proposedNewStartDateTime?: string;
  proposedNewEndDateTime?: string;
  rescheduleNotes?: string;
  rescheduledReason?: string;
  rescheduledBy?: 'student' | 'teacher' | 'admin' | string;
  rescheduledAt?: string;
  rescheduledFrom?: {
    startDateTime: string;
    endDateTime: string;
  };
  createdAt?: string;
  updatedAt?: string;

  // In-Session Notes & Recommendations
  liveNotes?: string;
  recommendations?: string;
  pronunciationNotes?: string;
  grammarAndPhrasing?: string;
  vocabularyNotes?: LiveLessonVocabNote[];
  notesLastSavedAt?: string;
  sessionNotesDocument?: string;
  sessionDate?: string;
  driveFileId?: string;
  driveFileUrl?: string;
  driveFolderName?: string;
  driveLastSyncedAt?: string;
}

export interface SessionNotesDocument {
  id: string;
  sessionDate: string;
  lessonId?: string;
  studentEmail: string;
  studentUid?: string;
  teacherEmail?: string;
  teacherName?: string;
  topic?: string;
  content: string;
  driveFileId?: string;
  driveFileUrl?: string;
  driveFolderName?: string;
  driveLastSyncedAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ChatMessage {
  id: string;
  senderEmail: string;
  senderName: string;
  senderRole: UserRole | 'system';
  recipientEmail: string;
  recipientName: string;
  text: string;
  timestamp: string;
  lessonRefId?: string;
  isSystemNotice?: boolean;
  receiverId?: string;
  read?: boolean;
}

export interface DirectMessage {
  id: string;
  studentUid: string;
  studentEmail: string;
  studentName?: string;
  nativeFriendUid: string;
  nativeFriendEmail: string;
  nativeFriendName?: string;
  nativeFriendAvatar?: string;
  senderUid: string;
  senderEmail: string;
  senderName: string;
  senderRole: 'student' | 'teacher' | 'admin' | 'system';
  recipientUid: string;
  recipientEmail?: string;
  recipientName?: string;
  text: string;
  createdAt: string;
  read: boolean;
  lessonRefId?: string;
  isNotice?: boolean;
}

export interface HomeworkVocabItem {
  id?: string;
  word: string;
  translationPt: string;
  definitionEn: string;
  exampleSentence: string;
  sourceActivityName?: string;
  sourceDay?: DayOfWeek;
  source?: string;
  learnedAt?: string;
  practiceCount?: number;
  lastPracticedAt?: string;
}

export interface MatchingPair {
  id: string;
  word: string;
  definition: string;
  translation: string;
}

export interface FillInBlankItem {
  id: string;
  sentenceWithBlank: string;
  correctWord: string;
  options: string[];
  hintPt: string;
  hintEn?: string;
  explanationPt?: string;
  explanationEn?: string;
}

export interface SentenceWritingPrompt {
  word: string;
  hint: string;
  hintEn?: string;
  hintPt?: string;
  levelInstruction?: string;
}

export interface ReadingQuestion {
  id: string;
  question: string;
  options: string[];
  correctAnswer: number;
  explanation: string;
}

export interface ReadingPassage {
  title: string;
  text: string;
  questions: ReadingQuestion[];
}

export interface HomeworkItemFeedback {
  id: string;
  isCorrect: boolean;
  userAnswer: string;
  correctAnswer: string;
  explanationPt: string;
  explanationEn: string;
}

export interface SentenceEvaluationItem {
  word: string;
  originalSentence: string;
  isCorrect: boolean;
  correctedSentence: string;
  explanationPt: string;
  explanationEn: string;
  levelAdvicePt: string;
  levelAdviceEn: string;
}

export interface HomeworkAiEvaluation {
  overallScore: number;
  evaluatedAt: string;
  studentLevel: string;
  tutorFeedbackSummaryPt: string;
  tutorFeedbackSummaryEn: string;
  matchingFeedback?: HomeworkItemFeedback[];
  fillFeedback?: HomeworkItemFeedback[];
  sentenceFeedback?: SentenceEvaluationItem[];
  readingFeedback?: HomeworkItemFeedback[];
  levelStrengthsPt?: string;
  levelStrengthsEn?: string;
  levelNextStepsPt?: string;
  levelNextStepsEn?: string;
}

export interface WeeklyHomeworkData {
  id: string;
  weekId?: string;
  weeklyCycle?: number;
  studentUid?: string;
  updatedAt?: string;
  weekLabel: string;
  studentEmail: string;
  studentName: string;
  studentLevel?: string;
  createdAt: string;
  totalWordsCollected: number;
  vocabularyList: HomeworkVocabItem[];
  allRoutineWords?: HomeworkVocabItem[];
  matchingPairs: MatchingPair[];
  fillInBlanks: FillInBlankItem[];
  sentenceWritingPrompts: SentenceWritingPrompt[];
  readingPassage: ReadingPassage;
  targetDay?: DayOfWeek;
  assignedPart?: 1 | 2 | 3 | 4;
  assignedPartKey?: 'matching' | 'fill' | 'writing' | 'reading';
  isDayPartCompleted?: boolean;
  completedPartsByDay?: Record<string, boolean>;
  isCompleted?: boolean;
  score?: number;
  submittedAt?: string;
  studentAnswers?: {
    matching?: Record<string, string>;
    fillInBlanks?: Record<string, string>;
    sentences?: Record<string, string>;
    quizAnswers?: Record<string, number>;
  };
  aiEvaluation?: HomeworkAiEvaluation;
  isEmpty?: boolean;
  emptyWarning?: string;
  emptyWarningEn?: string;
  isAiGenerated?: boolean;
  isGenerating?: boolean;
  status?: string;
  answers?: Record<string, any>;
}

export interface WordFeedback {
  original: string;
  hasError: boolean;
  corrected: string;
  explanationPt: string;
  explanationEn: string;
}

export interface SentenceFeedback {
  original: string;
  hasError: boolean;
  corrected: string;
  explanationPt: string;
  explanationEn: string;
}

export interface WritingEvaluationResult {
  hasAnyError: boolean;
  isCorrect?: boolean;
  wordFeedbacks: WordFeedback[];
  sentenceFeedback?: SentenceFeedback;
  correctedSentence?: string;
  explanation?: string;
  overallSummaryPt?: string;
  overallSummaryEn?: string;
  levelTipsPt?: string;
  levelTipsEn?: string;
  usedTargetWord?: boolean;
  usedWords?: string[];
  missingWords?: string[];
  usedTrigger?: boolean;
  targetWordFeedback?: string;
  triggerFeedback?: string;
}
