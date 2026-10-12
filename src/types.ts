export type DayOfWeek = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';

export type Language = 'en' | 'pt';

export type EnglishLevel = 'beginner' | 'intermediate' | 'advanced';

export type UserRole = 'student' | 'teacher' | 'admin';

export interface UserProfile {
  id?: string;
  uid?: string;
  name: string;
  email: string;
  role: UserRole | string;
  level?: EnglishLevel | string;
  englishLevel?: EnglishLevel | string;
  avatar?: string;
  picture?: string;
  bio?: string;
  country?: string;
  timezone?: string;
  phone?: string;
  createdAt?: string;
  updatedAt?: string;
  studyDaysTarget?: number;
  selectedDays?: DayOfWeek[];
  [key: string]: any;
}

export interface StudentProfile extends UserProfile {}

export interface GoogleAccount {
  id?: string;
  uid?: string;
  email: string;
  name: string;
  picture?: string;
  role?: string;
  accessToken?: string;
  [key: string]: any;
}

export interface RoutineItem {
  id: string;
  time?: string;
  title?: string;
  description?: string;
  icon?: string;
  category?: string;
  isCompleted?: boolean;
  completed?: boolean;
  videoUrl?: string;
  videoId?: string;
  audioUrl?: string;
  spotifyUrl?: string;
  spotifyTrackId?: string;
  assignedVideo?: TeacherAssignedVideo;
  assignedSpotify?: TeacherAssignedSpotify;
  learnedWords?: string[];
  [key: string]: any;
}

export interface TeacherAssignedVideo {
  id?: string;
  videoId: string;
  title: string;
  channelTitle?: string;
  thumbnailUrl?: string;
  level?: string;
  day?: DayOfWeek;
  assignedAt?: string;
  [key: string]: any;
}

export interface TeacherAssignedSpotify {
  id?: string;
  trackId: string;
  title: string;
  artist?: string;
  albumArtUrl?: string;
  previewUrl?: string;
  day?: DayOfWeek;
  assignedAt?: string;
  [key: string]: any;
}

export interface TeacherOverrideTrack {
  trackId: string;
  title: string;
  artist?: string;
  day: DayOfWeek;
  assignedAt?: string;
  [key: string]: any;
}

export interface TeacherMeetSettings {
  meetLink?: string;
  availableDays?: DayOfWeek[];
  availableHours?: string[];
  timezone?: string;
  [key: string]: any;
}

export interface LiveLesson {
  id: string;
  studentId?: string;
  studentEmail?: string;
  studentName?: string;
  teacherId?: string;
  teacherEmail?: string;
  teacherName?: string;
  day?: DayOfWeek;
  date?: string;
  time?: string;
  status?: 'scheduled' | 'completed' | 'cancelled';
  meetLink?: string;
  notes?: string;
  vocabularyNotes?: LiveLessonVocabNote[];
  [key: string]: any;
}

export interface LiveLessonVocabNote {
  word: string;
  meaning?: string;
  context?: string;
}

export interface NotificationItem {
  id: string;
  title: string;
  message: string;
  timestamp: string;
  read?: boolean;
  type?: 'info' | 'success' | 'warning' | 'alert';
}

export interface WeeklyHomeworkData {
  id?: string;
  weekId?: string;
  studentId?: string;
  title?: string;
  instructions?: string;
  status?: 'pending' | 'submitted' | 'reviewed';
  content?: string;
  feedback?: string;
  createdAt?: string;
  [key: string]: any;
}

export interface AdminLandingContent {
  heroBadge?: string;
  heroTitle?: string;
  heroSubtitle?: string;
  ctaText?: string;
  [key: string]: any;
}

export interface NativeFriendTutor {
  id: string;
  name: string;
  email: string;
  avatar?: string;
  picture?: string;
  role?: string;
  country?: string;
  accent?: string;
  timezone?: string;
  bio?: string;
  approvalStatus?: 'pending' | 'approved' | 'rejected';
  isApproved?: boolean;
  approved?: boolean;
  videoIntroUrl?: string;
  availableDays?: DayOfWeek[];
  availableHours?: string[];
  [key: string]: any;
}

export interface StudentDictionaryEntry {
  id?: string;
  word: string;
  definitionEn?: string;
  definitionPt?: string;
  exampleSentenceEn?: string;
  partOfSpeech?: string;
  cefrLevel?: string;
  addedAt?: string;
  sourceActivityId?: string;
  [key: string]: any;
}

export interface DailyJournalEntry {
  id?: string;
  date: string;
  day?: DayOfWeek;
  content: string;
  wordsUsed?: string[];
  grammarEvaluation?: WritingEvaluationResult;
  createdAt?: string;
  [key: string]: any;
}

export interface StudentJournalEntry {
  id?: string;
  date: string;
  day?: DayOfWeek;
  activityId?: string;
  activityType?: string;
  title?: string;
  content?: string;
  wordsUsed?: string[];
  timestamp?: string;
  [key: string]: any;
}

export type StudentJournalActivityType = 'routine' | 'sentence' | 'video' | 'spotify' | 'meet' | 'homework';

export interface WritingEvaluationResult {
  score?: number;
  feedback?: string;
  correctedSentence?: string;
  grammarMistakes?: string[];
  suggestions?: string[];
  highlightedGrammar?: string;
  isGrammaticallyCorrect?: boolean;
  [key: string]: any;
}

export interface YouTubePlaylistItem {
  id: string;
  title: string;
  description?: string;
  thumbnailUrl?: string;
  videoCount?: number;
  level?: string;
}

export interface ConsumedVideoItem {
  videoId: string;
  title?: string;
  consumedAt?: string;
}
