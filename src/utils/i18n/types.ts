import { Language } from '../../types';

export interface LanguageOption {
  code: Language;
  name: string;
  nativeName: string;
  flag: string;
  region: string;
}

export interface Translations {
  // Navigation & Role Badges
  adminBadge: string;
  teacherBadge: string;
  studentBadge: string;
  adminRole: string;
  teacherRole: string;
  studentRole: string;
  language: string;
  teacherModeEnglishOnly: string;

  // Weekday Filters & Controls
  allWeekdaysLabel: string;
  allWeekendsLabel: string;
  noActivities: string;
  addFirstActivity: string;
  practicedToday: string;
  markCompleted: string;
  editTime: string;
  deleteActivity: string;

  // End of Day & Daily Sentence
  endOfDayTitle: string;
  endOfDayBadge: string;
  openDailySentenceReviewBtn: string;
  endOfDayModalTitle: string;
  endOfDayWordsBankTitle: string;
  endOfDayWordsClickToInsert: string;
  endOfDayNoWordsYet: string;
  endOfDaySentenceLabel: string;
  endOfDayInputPlaceholder: string;
  saveJournalEntry: string;
  previousDaysHistoryTitle: string;
  dailySentenceWrapup: string;
  dailySentenceSubtitle: string;
  routineWordsToInclude: string;
  usedWords: string;
  yourDailySentenceLabel: string;
  listenBtn: string;
  dailySentencePlaceholder: string;
  checkWithAiBtn: string;
  saveToJournalBtn: string;

  // Live Lessons & Native Friends
  liveLessonsTitle: string;
  liveLessonsSubtitle: string;
  scheduleLiveLessonBtn: string;
  teacherMeetConfigTitle: string;
  customMeetUrlLabel: string;
  slotDurationLabel: string;
  saveMeetSettingsBtn: string;
  meetSettingsSavedToast: string;
  liveLessonModalTitle: string;
  bookingSuccessTitle: string;
  bookingSuccessDesc: string;
  joinMeetBtn: string;
  close: string;
  selectDateLabel: string;
  availableSlotsLabel: string;
  lessonTopicLabel: string;
  lessonTopicPlaceholder: string;
  confirmBookingBtn: string;
  cancelLessonBtn: string;
  cancel: string;

  // Video Workspace & 5 Words System
  level: string;
  selectActivityPrompt: string;
  selectActivityDesc: string;
  openInYouTube: string;
  teacherNotesTitle: string;
  noVideoYetTitle: string;
  noVideoYetTeacher: string;
  fiveWordsTitle: string;
  fiveWordsDesc: string;
  wordsRecordedBadge: string;
  wordPlaceholder: string;
  listenPronunciation: string;
  fillAllFiveWordsNotice: string;
  wordsSavedSuccess: string;
  saveFiveWordsBtn: string;
  dailyReviewPromptTitle: string;
  dailyReviewPromptDesc: string;
  invalidYoutubeUrl: string;

  // Form Fields & Reminders
  time: string;
  activityName: string;
  test5MinReminder: string;

  // General App & Landing Hero
  brandTagline: string;
  startLivingEnglish: string;
  findNativeFriend: string;
  becomeTutor: string;
  logIn: string;
  signUp: string;
  myRoutine: string;
  findTutors: string;
  exploreMoments: string;
  openDashboard: string;
  studentAccess: string;
  footerSub: string;
  philosophyNav: string;

  // Hero Section
  heroBadge: string;
  heroHeadlineStart: string;
  heroHeadlineHighlight: string;
  heroQuote: string;
  heroSubtext: string;
  heroFindFriendBtn: string;
  heroStartLivingBtn: string;
  badge100Native: string;
  badge30MinMeet: string;
  badgeAiCorrection: string;

  // Hero Routine Card
  todayEnglishRoutine: string;
  routineCoffeeTitle: string;
  routineCoffeeSubtitle: string;
  routineCommuteTitle: string;
  routineCommuteSubtitle: string;
  routineMeetTitle: string;
  routineMeetSubtitle: string;
  routineJournalTitle: string;
  routineJournalSubtitle: string;
  scheduledPill: string;
  heroCardFooterQuote: string;
  heroCardFooterSub: string;

  // Philosophy Section
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

  // Become Tutor Banner
  forNativeSpeakersBadge: string;
  becomeTutorBannerTitle: string;
  becomeTutorBannerDesc: string;
  applyAsTutorBtn: string;

  // Find Tutors Directory
  tutorsHeaderBadge: string;
  tutorsHeaderTitle: string;
  tutorsHeaderSubtitle: string;
  searchTutorsPlaceholder: string;
  allCountriesOption: string;
  allSpecialtiesOption: string;
  bookLesson30MinBtn: string;
  sendMessageBtn: string;
  watchIntroVideoBtn: string;
  per30MinSession: string;
  reviewsLabel: string;
  noTutorsFound: string;

  // English Moments Showcase
  momentsHeaderBadge: string;
  momentsHeaderTitle: string;
  momentsHeaderSubtitle: string;
  momentsTodayCount: string;
  habitInAction: string;
  momentsQuote: string;
  clickToSimulate: string;
  completed: string;
  tapToDo: string;
  done: string;
  startLivingInEnglishDashboard: string;

  // S Symbol - Fun Path to Fluency Tracker
  sSymbolTitle: string;
  sSymbolSubtitle: string;
  sSymbolPathProgress: string;
  sSymbolCompleteStep: string;
  sSymbolFluencyGoal: string;
  sSymbolInteractiveHint: string;

  // Weekly Memorization Activity (formerly Homework)
  weeklyHomeworkTitle: string;
  weeklyHomeworkSubtitle: string;
  weeklyHomeworkBadge: string;
  openHomeworkAction: string;
  homeworkCompleted: string;

  // Auth Modal
  authLoginTitle: string;
  authSignupTitle: string;
  authEmailLabel: string;
  authPasswordLabel: string;
  authNameLabel: string;
  authGoogleBtn: string;
  authOrEmail: string;
  authNoAccount: string;
  authAlreadyAccount: string;
  authSwitchToSignup: string;
  authSwitchToLogin: string;
}
