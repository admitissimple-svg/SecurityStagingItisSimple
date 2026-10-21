import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  DayOfWeek,
  EnglishLevel,
  GoogleAccount,
  LiveLesson,
  NotificationItem,
  RoutineItem,
  StudentProfile,
  TeacherAssignedVideo,
  TeacherAssignedSpotify,
  TeacherMeetSettings,
  UserProfile,
  UserRole,
  WeeklyHomeworkData,
  Language,
  AdminLandingContent,
  NativeFriendTutor,
  StudentDictionaryEntry,
  LiveLessonVocabNote,
  DailyJournalEntry,
  WritingEvaluationResult,
} from './types';
import { defaultRoutinesByDay, createCleanStudentRoutines } from './data/defaultRoutines';
import { INITIAL_NATIVE_FRIENDS } from './data/tutors';
import { getTranslations, getActivityDisplayName } from './utils/i18n';
import {
  formatDateInTimeZone,
  formatTimeInTimeZone,
  findTeacherLessonConflict,
  DEFAULT_STUDENT_TIMEZONE,
  DEFAULT_TEACHER_TIMEZONE,
} from './utils/timezone';
import { getTodayDayOfWeek, DAYS_OF_WEEK } from './utils/notifications';
import { generateWeeklyHomeworkFromRoutines, generateWeeklyHomeworkWithAi } from './utils/homeworkGenerator';
import { normalizeStudentLevel, fetchTracksForStudentLevel } from './utils/spotify';
import { executeStartNewWeek } from './utils/StartNewWeekHandler';
import {
  addVideoToWatchedHistoryInFirestore,
  addTrackToListenedHistoryInFirestore,
  initializeCleanStudentRoutinesInFirestore,
  fetchAllRoutineVideosFromFirestore,
} from './hooks/useRoutine';
import { recordConsumedVideo, recordConsumedTrack } from './hooks/useStudentHistory';
import { extractYouTubeVideoId, getYouTubeWatchUrl } from './utils/youtube';
import { getInstantOrCachedWord, lookupWord } from './utils/dictionaryService';
import { auth, getDb, getAllFirestoreDbs } from './firebase';
import { getAccessToken, getAdminAccessToken, waitForAuthUser, firebaseSignUpWithEmail, firebaseSignInWithEmail } from './utils/auth';
import { useNativeFriends, isTutorApproved, isTeacherRole } from './hooks/useNativeFriends';
import { onAuthStateChanged, signOut as firebaseSignOutAuth } from 'firebase/auth';
import { doc, getDoc, collection, getDocs, onSnapshot, setDoc, deleteDoc, query, where } from 'firebase/firestore';
import { apiClient, ApiError } from './utils/apiClient';

// Components
import { Navbar } from './components/Navbar';
import { LandingPage } from './components/LandingPage';
import { Footer } from './components/Footer';
import { FindTutorsSection } from './components/FindTutorsSection';
import { EnglishMomentsShowcase } from './components/EnglishMomentsShowcase';
import { CleanActivitySidebar } from './components/CleanActivitySidebar';
import { VideoLearningWorkspace } from './components/VideoLearningWorkspace';
import { DailySentenceSection } from './components/DailySentenceSection';
import { WeeklyHomeworkSection } from './components/WeeklyHomeworkSection';
import { TeacherScheduleControlTable } from './components/TeacherScheduleControlTable';
import { LiveMeetLessonsPanel } from './components/LiveMeetLessonsPanel';
import { TeacherLiveLessonNotesPanel } from './components/TeacherLiveLessonNotesPanel';
import { NativeFriendLessonInsights } from './components/NativeFriendLessonInsights';
import { TeacherSpotifyRoutineTracker } from './components/TeacherSpotifyRoutineTracker';
import { TeacherMediaAssignmentPanel } from './components/TeacherMediaAssignmentPanel';
import { SFluencyTracker } from './components/SFluencyTracker';
import { NotificationBanner } from './components/NotificationBanner';
import { StudentHeaderSection } from './components/StudentHeaderSection';
import { StudentRoutineGuideSection } from './components/StudentRoutineGuideSection';
import { StudentWeeklyActivitySection } from './components/StudentWeeklyActivitySection';

// Modals
import { AuthModal } from './components/AuthModal';
import { LoginModal } from './components/LoginModal';
import { BecomeTutorModal } from './components/BecomeTutorModal';
import { WeeklyHomeworkModal } from './components/WeeklyHomeworkModal';
import { LiveLessonScheduleModal } from './components/LiveLessonScheduleModal';
import { StudentManagementModal } from './components/StudentManagementModal';
import { TeacherMeetConfigModal } from './components/TeacherMeetConfigModal';
import { RescheduleModal } from './components/RescheduleModal';
import { NotCompletedModal } from './components/NotCompletedModal';
import { EmailNotificationModal } from './components/EmailNotificationModal';
import { DailySentenceModal } from './components/DailySentenceModal';
import { AdminLandingEditorModal } from './components/AdminLandingEditorModal';
import { AdminApprovalsModal } from './components/AdminApprovalsModal';
import { EditTutorProfileModal } from './components/EditTutorProfileModal';
import { StudentProfileModal } from './components/StudentProfileModal';
import { PersonalDictionaryModal } from './components/PersonalDictionaryModal';
import { StudentJournalModal } from './components/StudentJournalModal';
import {
  saveStudentVocabularyToFirestore,
  fetchStudentVocabularyFromFirestore,
  markVocabularyWordsPracticedInFirestore,
  subscribeToStudentVocabulary,
  getCachedLocalVocabulary,
  cacheVocabularyLocally,
  saveStudentJournalEntryToFirestore,
  fetchStudentJournalFromFirestore,
  saveLiveLessonToFirestore,
  updateLiveLessonInFirestore,
  deleteLiveLessonFromFirestore,
  fetchStudentLessonsFromFirestore,
  subscribeToStudentLessons,
  saveStudentNativeFriendToFirestore,
  saveStudentProfileToFirestore,
  fetchStudentProfileFromFirestore,
  subscribeToStudentProfile,
  saveStudentWeeklyChecksToFirestore,
  fetchStudentWeeklyChecksFromFirestore,
  subscribeToStudentWeeklyChecks,
  subscribeToStudentDailyJournal,
  subscribeToStudentDailyRoutines,
  deleteStudentVocabularyFromFirestore,
  fetchExcludedDictionaryWords,
  addExcludedDictionaryWord,
  removeExcludedDictionaryWord,
  getCachedExcludedDictionaryWords,
  cacheExcludedWordsLocally,
  deleteStudentJournalEntryFromFirestore,
  recordActivityInStudentJournal,
  removeActivityFromStudentJournal,
  subscribeToStudentJournal,
  fetchStudentJournalActivitiesFromFirestore,
  saveStudentHomeworkProgressToFirestore,
  fetchStudentHomeworkProgressFromFirestore,
  subscribeToStudentHomeworkProgress,
  getDateForDayInCurrentWeek,
  getTodayIsoDate,
  mapStepIdToJournalType,
  deriveWeeklyChecksFromJournal,
  migrateLegacyLocalStorageToFirestore,
  scheduleLessonWithTransaction,
  purchasePackageWithTransaction,
  cancelLessonWithTransaction,
  isValidCanonicalUid,
  normalizeUid,
  normalizeWeekId,
  parseWeekCycleNumber,
  consolidateDictionaryEntries,
  normalizeDictionaryWord,
  clearAllLocalPersistenceCaches,
} from './utils/studentPersistence';
import { buildConsolidatedActiveDictionary } from './utils/studentDictionaryLibrary';
import { clearDictionaryMemoryCache } from './utils/dictionaryService';
import {
  isGenericTutorId,
  normalizeTutorName,
  toDeterministicCanonicalStudentUid,
} from './utils/tutorConsolidation';
import { FirestoreSchemaAlertBanner } from './components/FirestoreSchemaAlertBanner';
import { StudentJournalEntry } from './types';
import { ManageSubscriptionModal } from './components/ManageSubscriptionModal';
import { RoutineRemindersManager } from './components/RoutineRemindersManager';
import { OnboardingWizardModal, OnboardingResultData } from './components/OnboardingWizardModal';
import { StartLivingEmailModal } from './components/StartLivingEmailModal';
import { ShieldCheck, Edit3, Sparkles, Headphones, BookOpen, Video, X, User, CheckCircle2, ChevronRight, MessageSquareQuote, Layers } from 'lucide-react';

const createDefaultStudentProfile = (account?: GoogleAccount | null): UserProfile => {
  const effectiveUid = account?.uid || auth?.currentUser?.uid || account?.id || '';
  return {
    id: effectiveUid,
    uid: effectiveUid,
    name: account?.name || '',
    email: account?.email || '',
    picture: account?.picture || '',
    avatar: account?.picture || '',
    level: EnglishLevel.BEGINNER,
    streakDays: 0,
    streakCount: 0,
    points: 0,
    dailyGoalMinutes: 30,
    completedTodayMinutes: 0,
    targetAudienceCategory: 'general',
    timezone: DEFAULT_STUDENT_TIMEZONE,
    contractedLessons: 0,
    completedLessonsCount: 0,
    learningGoal: '',
    routineVideoTime: '',
    routineAudioTime: '',
    dailyPhraseTime: '',
    weeklyNativeLessonsTarget: 1,
    weeklyCycle: 1,
  };
};

const isOldAudioActivity = (act: RoutineItem) => {
  const id = String(act?.id || '');
  const name = (act?.activityName || '').toLowerCase();
  return (
    id.endsWith('2') ||
    name.includes('escuta ativa') ||
    name.includes('podcast diário') ||
    name.includes('podcast diario') ||
    name.includes('(áudio)') ||
    name.includes('(audio)')
  );
};

const applyProfileTimesToRoutines = (
  baseRoutines: Record<DayOfWeek, RoutineItem[]>,
  videoTime?: string,
  _audioTime?: string
): Record<DayOfWeek, RoutineItem[]> => {
  const source = baseRoutines && Object.keys(baseRoutines).length > 0 ? baseRoutines : defaultRoutinesByDay;
  const cloned: Record<DayOfWeek, RoutineItem[]> = {} as any;
  (Object.keys(source) as DayOfWeek[]).forEach((day) => {
    let videoTimeApplied = false;

    // Completely remove old audio activity from routine timeline
    const rawList = (source[day] || []).filter((act) => !isOldAudioActivity(act));
    const dayList = rawList.length > 0 ? rawList : defaultRoutinesByDay[day] || [];

    cloned[day] = dayList.map((act, index) => {
      // Strictly target exclusively the ONE primary Video of the Day activity for this day
      const isVideoOfTheDay =
        !videoTimeApplied &&
        Boolean(videoTime) &&
        (act.id.endsWith('1') ||
          (act.teacherVideos && act.teacherVideos.length > 0) ||
          act.activityName?.toLowerCase().includes('vídeo') ||
          act.activityName?.toLowerCase().includes('video') ||
          index === 0);

      if (isVideoOfTheDay && videoTime) {
        videoTimeApplied = true;
        return { ...act, time: videoTime };
      }

      return { ...act };
    });
  });
  return cloned;
};

export default function App() {
  // 0. View mode: 'landing' | 'dashboard' | 'find-tutors'
  const [viewMode, setViewMode] = useState<'landing' | 'dashboard' | 'find-tutors'>(() => {
    if (typeof window !== 'undefined') {
      const p = window.location.pathname;
      const h = window.location.hash;
      if (
        p === '/teacher' ||
        p === '/admin' ||
        p === '/dashboard' ||
        h === '#teacher' ||
        h === '#admin' ||
        h === '#dashboard'
      ) {
        return 'dashboard';
      }
      if (p === '/find-tutors' || h === '#find-tutors') {
        return 'find-tutors';
      }
    }
    return 'landing';
  });

  // 1. Language & i18n
  const [currentLanguage, setCurrentLanguage] = useState<Language>('en');
  const t = useMemo(() => getTranslations(currentLanguage), [currentLanguage]);

  // 2. Authentication & Accounts - 100% in-memory React state (ZERO localStorage)
  const [currentAccount, setCurrentAccount] = useState<GoogleAccount | null>(null);
  const [availableAccounts, setAvailableAccounts] = useState<GoogleAccount[]>([]);

  // Authoritative Native Friends hook syncing with Firestore unified collections across production and preview
  const {
    tutors,
    setTutors,
    publicTutors,
    allTutors,
    refresh: refreshNativeFriends,
  } = useNativeFriends({
    userEmail: currentAccount?.email,
    userRole: currentAccount?.role,
    uid: currentAccount?.uid,
    initialData: INITIAL_NATIVE_FRIENDS,
  });

  // Track active accounts in session memory
  useEffect(() => {
    if (currentAccount && currentAccount.email) {
      setAvailableAccounts((prev) => {
        const clean = currentAccount.email.toLowerCase().trim();
        if (!prev.some((a) => a.email.toLowerCase().trim() === clean)) {
          return [...prev, currentAccount];
        }
        return prev.map((a) => (a.email.toLowerCase().trim() === clean ? currentAccount : a));
      });
    }
  }, [currentAccount]);

  // One-time automatic migration of any legacy data to Cloud Firestore
  useEffect(() => {
    if (currentAccount?.uid) {
      migrateLegacyLocalStorageToFirestore(currentAccount.uid, currentAccount.email);
    }
  }, [currentAccount?.uid, currentAccount?.email]);

  // Synchronize Firebase Auth state with React app state for multi-account isolation & published profile detection
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (fbUser) => {
      if (fbUser && fbUser.email) {
        const cleanEmail = fbUser.email.toLowerCase().trim();
        const tokenResult = await fbUser.getIdTokenResult().catch(() => null);
        const isVerifiedAdmin = tokenResult?.claims?.role === 'admin';

        // Check if currentAccount matches the active Firebase Auth user and has the verified UID
        if (!currentAccount || currentAccount.email.toLowerCase() !== cleanEmail || currentAccount.uid !== fbUser.uid) {
          // If an authentication attempt is actively underway in LoginModal/AuthModal, do NOT eagerly hydrate as student
          if (isAuthModalOpen) {
            return;
          }

          // If currentAccount already knows this user is a teacher, keep it as high priority default
          const existingRole = currentAccount?.email?.toLowerCase() === cleanEmail ? currentAccount.role : undefined;
          let resolvedRole: UserRole = isVerifiedAdmin ? 'admin' : (existingRole === 'teacher' ? 'teacher' : 'student');
          let firestoreDoc: any = null;
          try {
            const db = getDb();
            const snap = await Promise.race([
              getDoc(doc(db, 'users', fbUser.uid)),
              new Promise<null>((r) => setTimeout(() => r(null), 3000)),
            ]);
            if (snap && snap.exists()) {
              firestoreDoc = snap.data();
              const r = (firestoreDoc.role || firestoreDoc.userRole || '').toLowerCase();
              if (r === 'admin' || isVerifiedAdmin) resolvedRole = isVerifiedAdmin ? 'admin' : 'student';
              else if (r === 'teacher' || r === 'native_friend' || r === 'tutor') resolvedRole = 'teacher';
            }

            const cleanDocId = cleanEmail.replace(/[^a-zA-Z0-9]/g, '-');
            // If role is still not teacher or admin, check email doc ID and tutor collections in Firestore
            if (resolvedRole !== 'teacher' && !isVerifiedAdmin && cleanEmail) {
              const snapEmail = await Promise.race([
                getDoc(doc(db, 'users', cleanDocId)),
                new Promise<null>((r) => setTimeout(() => r(null), 2500)),
              ]);
              if (snapEmail && snapEmail.exists()) {
                const emailData = snapEmail.data();
                const r = (emailData.role || emailData.userRole || '').toLowerCase();
                if (r === 'teacher' || r === 'native_friend' || r === 'tutor') {
                  firestoreDoc = { ...(firestoreDoc || {}), ...emailData };
                  resolvedRole = 'teacher';
                }
                // Migrate to Auth UID document
                setDoc(
                  doc(db, 'users', fbUser.uid),
                  { ...emailData, id: fbUser.uid, uid: fbUser.uid, email: cleanEmail, updatedAt: new Date().toISOString() },
                  { merge: true }
                ).catch(() => null);
              }

              if (resolvedRole !== 'teacher') {
                const cleanTutorId = `tutor-${cleanDocId}`;
                const [tutorSnap, userTutorSnap, authUidTutorSnap] = await Promise.all([
                  getDoc(doc(db, 'tutors', cleanTutorId)).catch(() => null),
                  getDoc(doc(db, 'users', cleanTutorId)).catch(() => null),
                  getDoc(doc(db, 'tutors', fbUser.uid)).catch(() => null),
                ]);
                if (authUidTutorSnap && authUidTutorSnap.exists()) {
                  firestoreDoc = { ...(firestoreDoc || {}), ...authUidTutorSnap.data(), role: 'teacher' };
                  resolvedRole = 'teacher';
                } else if (tutorSnap && tutorSnap.exists()) {
                  firestoreDoc = { ...(firestoreDoc || {}), ...tutorSnap.data(), role: 'teacher' };
                  resolvedRole = 'teacher';
                } else if (userTutorSnap && userTutorSnap.exists()) {
                  firestoreDoc = { ...(firestoreDoc || {}), ...userTutorSnap.data(), role: 'teacher' };
                  resolvedRole = 'teacher';
                }
              }

              // Also check tutors collection by email query in Firestore
              if (resolvedRole !== 'teacher') {
                try {
                  const qSnap = await Promise.race([
                    getDocs(query(collection(db, 'tutors'), where('email', '==', cleanEmail))),
                    new Promise<null>((r) => setTimeout(() => r(null), 2500)),
                  ]);
                  if (qSnap && !qSnap.empty) {
                    const tData = qSnap.docs[0].data();
                    firestoreDoc = { ...(firestoreDoc || {}), ...tData, role: 'teacher' };
                    resolvedRole = 'teacher';
                  }
                } catch {}
              }

              // Also check memory tutors list
              if (resolvedRole !== 'teacher') {
                const inMemoryTutor = tutors.find((t) => (t.email || '').toLowerCase().trim() === cleanEmail);
                if (inMemoryTutor) {
                  firestoreDoc = { ...(firestoreDoc || {}), ...inMemoryTutor, role: 'teacher' };
                  resolvedRole = 'teacher';
                }
              }

              // Also check backend user profile to confirm role
              if (resolvedRole !== 'teacher' && !isVerifiedAdmin) {
                try {
                  const profRes = await fetch(`/api/user-profile?email=${encodeURIComponent(cleanEmail)}&uid=${encodeURIComponent(fbUser.uid)}`);
                  if (profRes.ok) {
                    const profData = await profRes.json();
                    if (profData?.isTeacher || profData?.role === 'teacher') {
                      firestoreDoc = { ...(firestoreDoc || {}), ...(profData.tutor || {}), role: 'teacher' };
                      resolvedRole = 'teacher';
                    }
                  }
                } catch {}
              }
            }
          } catch (e) {
            console.warn('Notice hydrating Firebase Auth user in App:', e);
          }

          if (resolvedRole === 'teacher') {
            setViewMode('dashboard');
            if (typeof window !== 'undefined') {
              try {
                window.history.replaceState({ page: 'teacher' }, '', '/teacher');
              } catch {}
            }
          } else if (resolvedRole === 'admin') {
            setViewMode('dashboard');
            setIsAdminApprovalsOpen(true);
            if (typeof window !== 'undefined') {
              try {
                window.history.replaceState({ page: 'admin' }, '', '/admin');
              } catch {}
            }
          } else if (resolvedRole === 'student') {
            const p = typeof window !== 'undefined' ? window.location.pathname : '';
            const h = typeof window !== 'undefined' ? window.location.hash : '';
            if (p === '/admin' || p === '/teacher' || h === '#admin' || h === '#teacher') {
              try {
                window.history.replaceState({ page: 'dashboard' }, '', '/dashboard');
              } catch {}
            }
          }

          const account: GoogleAccount = {
            uid: fbUser.uid,
            email: cleanEmail,
            name: firestoreDoc?.name || fbUser.displayName || cleanEmail.split('@')[0],
            role: resolvedRole,
            picture: firestoreDoc?.picture || firestoreDoc?.avatar || fbUser.photoURL || '',
          };

          // Guarantee that student profile in Firestore is created/saved using doc(db, 'users', fbUser.uid)
          // Do NOT overwrite if user has a teacher/tutor role
          if (resolvedRole === 'student' && firestoreDoc?.role !== 'teacher' && firestoreDoc?.role !== 'native_friend') {
            const db = getDb();
            if (db && fbUser.uid) {
              const studentPayload = {
                id: fbUser.uid,
                uid: fbUser.uid,
                email: cleanEmail,
                name: account.name,
                role: 'student',
                picture: account.picture,
                avatar: account.picture,
                level: firestoreDoc?.level || firestoreDoc?.englishLevel || EnglishLevel.BEGINNER,
                learningGoal: firestoreDoc?.learningGoal || '',
                routineVideoTime: firestoreDoc?.routineVideoTime || '09:00',
                routineAudioTime: firestoreDoc?.routineAudioTime || '14:00',
                dailyPhraseTime: firestoreDoc?.dailyPhraseTime || '20:00',
                ...(firestoreDoc || {}),
                updatedAt: new Date().toISOString(),
              };
              setDoc(doc(db, 'users', fbUser.uid), studentPayload, { merge: true }).catch(() => null);
            }

            const teacherUid = (firestoreDoc?.teacherUid && isValidCanonicalUid(firestoreDoc.teacherUid))
              ? firestoreDoc.teacherUid
              : (firestoreDoc?.assignedNativeFriendUID && isValidCanonicalUid(firestoreDoc.assignedNativeFriendUID))
                ? firestoreDoc.assignedNativeFriendUID
                : (firestoreDoc?.nativeFriendUID && isValidCanonicalUid(firestoreDoc.nativeFriendUID))
                  ? firestoreDoc.nativeFriendUID
                  : undefined;

            const restoredProfile: UserProfile = {
              ...createDefaultStudentProfile(account),
              id: fbUser.uid,
              uid: fbUser.uid,
              email: cleanEmail,
              name: account.name,
              picture: account.picture,
              avatar: account.picture,
              level: (firestoreDoc?.level || firestoreDoc?.englishLevel || EnglishLevel.BEGINNER) as EnglishLevel,
              englishLevel: (firestoreDoc?.level || firestoreDoc?.englishLevel || EnglishLevel.BEGINNER) as EnglishLevel,
              userLevel: (firestoreDoc?.level || firestoreDoc?.englishLevel || EnglishLevel.BEGINNER) as EnglishLevel,
              learningGoal: firestoreDoc?.learningGoal || '',
              weeklyStudyDaysTarget: typeof firestoreDoc?.weeklyStudyDaysTarget === 'number' ? firestoreDoc.weeklyStudyDaysTarget : 4,
              weeklyStudyDays: firestoreDoc?.weeklyStudyDays || ['monday', 'tuesday', 'wednesday', 'thursday'],
              routineVideoTime: firestoreDoc?.routineVideoTime || '09:00',
              routineAudioTime: firestoreDoc?.routineAudioTime || '14:00',
              dailyPhraseTime: firestoreDoc?.dailyPhraseTime || '20:00',
              teacherEmail: firestoreDoc?.teacherEmail || '',
              teacherName: firestoreDoc?.teacherName || '',
              teacherMeetUrl: firestoreDoc?.teacherMeetUrl || '',
              teacherUid: teacherUid,
              assignedNativeFriendUID: teacherUid,
              nativeFriendUID: teacherUid,
              contractedLessons: typeof firestoreDoc?.contractedLessons === 'number' ? firestoreDoc.contractedLessons : 1,
              completedLessonsCount: typeof firestoreDoc?.completedLessonsCount === 'number' ? firestoreDoc.completedLessonsCount : 0,
              hasCompletedTrialLesson: Boolean(firestoreDoc?.hasCompletedTrialLesson),
              onboardingCompleted: typeof firestoreDoc?.onboardingCompleted === "boolean"
                ? firestoreDoc.onboardingCompleted
                : Boolean(firestoreDoc?.hasCompletedTrialLesson),
              subscriptionType: firestoreDoc?.subscriptionType || 'trial',
              enrollmentStatus: firestoreDoc?.enrollmentStatus || (teacherUid ? 'active' : 'not_enrolled'),
            };
            setUserProfile(restoredProfile);
          }

          // Guarantee that teacher profile is saved under doc(db, 'users', fbUser.uid) and doc(db, 'tutors', fbUser.uid)
          if (resolvedRole === 'teacher') {
            const db = getDb();
            if (db && fbUser.uid) {
              const teacherPayload = {
                id: fbUser.uid,
                uid: fbUser.uid,
                email: cleanEmail,
                name: account.name,
                role: 'teacher',
                picture: account.picture,
                avatar: account.picture,
                ...(firestoreDoc || {}),
                updatedAt: new Date().toISOString(),
              };
              setDoc(doc(db, 'users', fbUser.uid), teacherPayload, { merge: true }).catch(() => null);
              setDoc(doc(db, 'tutors', fbUser.uid), teacherPayload, { merge: true }).catch(() => null);
            }
          }

          setCurrentAccount(account);
          setAvailableAccounts((prev) => {
            if (!prev.some((a) => a.email.toLowerCase() === cleanEmail)) {
              return [...prev, account];
            }
            return prev.map((a) => (a.email.toLowerCase() === cleanEmail ? account : a));
          });

          // Sync with backend API
          fetch('/api/auth/google', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              uid: fbUser.uid,
              email: cleanEmail,
              name: account.name,
              role: resolvedRole,
              picture: account.picture,
            }),
          }).catch(() => {});
        }
      }
    });

    return () => unsubscribe();
  }, [currentAccount, tutors]);

  const isTeacher = currentAccount ? (currentAccount.role === 'teacher' || currentAccount.role === 'admin') : false;

  // 2.1 Tutors & Admin Content State
  const [landingContent, setLandingContent] = useState<AdminLandingContent | null>(null);

  // 3. Student Profile & Level - strictly isolated per account
  const [userProfile, setUserProfile] = useState<UserProfile>(() =>
    createDefaultStudentProfile(currentAccount)
  );

  // 4. Routines State by Day (Auto-positions on today's focus)
  const [routinesByDay, setRoutinesByDay] = useState<Record<DayOfWeek, RoutineItem[]>>(defaultRoutinesByDay);
  const [selectedDay, setSelectedDay] = useState<DayOfWeek>(() => getTodayDayOfWeek());
  const [selectedActivityId, setSelectedActivityId] = useState<string>(() => {
    const today = getTodayDayOfWeek();
    const todayActs = defaultRoutinesByDay[today];
    return todayActs && todayActs.length > 0 ? todayActs[0].id : 'm1';
  });

  // 5. Live Lessons State
  const [lessons, setLessons] = useState<LiveLesson[]>([]);
  const [teacherMeetSettings, setTeacherMeetSettings] = useState<Record<string, TeacherMeetSettings>>({
    'itissimple.school@gmail.com': {
      teacherEmail: 'itissimple.school@gmail.com',
      meetLink: 'https://meet.google.com/gmt-kxnw-zpq',
      workingHoursStart: '08:00',
      workingHoursEnd: '18:00',
      slotDurationMinutes: 30,
      availableDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'],
      timezone: 'America/Toronto',
    },
  });

  const [contractedLessons, setContractedLessons] = useState<Record<string, number>>({});

  // 6. Students Management State
  const [students, setStudents] = useState<StudentProfile[]>([]);

  // 7. Weekly Homework State
  const [weeklyHomework, setWeeklyHomework] = useState<WeeklyHomeworkData | null>(null);
  const [homeworkTargetDay, setHomeworkTargetDay] = useState<DayOfWeek>(getTodayDayOfWeek());

  // 7b. S-Path (Gráfico S) Weekly Checks & Student Journal State (Multi-device Single Source of Truth)
  const [weeklyChecks, setWeeklyChecks] = useState<Record<string, boolean>>({});
  const [studentJournal, setStudentJournal] = useState<StudentJournalEntry[]>([]);

  // 8. Notifications State
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);

  // 9. Modals Control State
  const [isAuthModalOpen, setIsAuthModalOpen] = useState<boolean>(false);
  const [authModalMode, setAuthModalMode] = useState<'login' | 'signup'>('login');
  const [authModalRole, setAuthModalRole] = useState<UserRole>('student');
  const [isBecomeTutorModalOpen, setIsBecomeTutorModalOpen] = useState<boolean>(false);
  const [isHomeworkModalOpen, setIsHomeworkModalOpen] = useState<boolean>(false);
  const [isScheduleModalOpen, setIsScheduleModalOpen] = useState<boolean>(false);
  const [isStudentMgmtModalOpen, setIsStudentMgmtModalOpen] = useState<boolean>(false);
  const [isMeetConfigModalOpen, setIsMeetConfigModalOpen] = useState<boolean>(false);
  const [isRescheduleModalOpen, setIsRescheduleModalOpen] = useState<boolean>(false);
  const [isNotCompletedModalOpen, setIsNotCompletedModalOpen] = useState<boolean>(false);
  const [isEmailModalOpen, setIsEmailModalOpen] = useState<boolean>(false);
  const [isDailySentenceModalOpen, setIsDailySentenceModalOpen] = useState<boolean>(false);
  const [isAdminLandingEditorOpen, setIsAdminLandingEditorOpen] = useState<boolean>(false);
  const [isAdminApprovalsOpen, setIsAdminApprovalsOpen] = useState<boolean>(false);
  const [isEditTutorProfileOpen, setIsEditTutorProfileOpen] = useState<boolean>(false);
  const [isStudentProfileOpen, setIsStudentProfileOpen] = useState<boolean>(false);
  const [isPersonalDictionaryOpen, setIsPersonalDictionaryOpen] = useState<boolean>(false);
  const [studentDictionaryEntries, setStudentDictionaryEntries] = useState<StudentDictionaryEntry[]>(() => {
    return getCachedLocalVocabulary(currentAccount?.uid, currentAccount?.email);
  });
  const [excludedDictionaryWords, setExcludedDictionaryWords] = useState<string[]>(() => {
    return getCachedExcludedDictionaryWords(currentAccount?.uid, currentAccount?.email);
  });
  // FASE 4B.3: Canonical student UID reference to discard out-of-order and cross-account async responses
  const activeStudentUidRef = useRef<string>(
    currentAccount?.role === 'student' ? normalizeUid(currentAccount?.uid, currentAccount?.email) : ''
  );
  const excludedDictionaryWordsRef = useRef<string[]>(excludedDictionaryWords);
  useEffect(() => {
    excludedDictionaryWordsRef.current = excludedDictionaryWords;
  }, [excludedDictionaryWords]);
  const [dailyJournalEntries, setDailyJournalEntries] = useState<DailyJournalEntry[]>([]);
  const [isJournalModalOpen, setIsJournalModalOpen] = useState<boolean>(false);
  const [isManageSubscriptionOpen, setIsManageSubscriptionOpen] = useState<boolean>(false);
  const [subscriptionTargetTutor, setSubscriptionTargetTutor] = useState<NativeFriendTutor | null>(null);
  const [isOnboardingModalOpen, setIsOnboardingModalOpen] = useState<boolean>(false);
  const [isOnboardingCompleting, setIsOnboardingCompleting] = useState<boolean>(false);
  const [isStartLivingModalOpen, setIsStartLivingModalOpen] = useState<boolean>(false);
  const [onboardingInitialEmail, setOnboardingInitialEmail] = useState<string>('');
  const [authInitialEmail, setAuthInitialEmail] = useState<string>('');
  const [isStartingNewWeek, setIsStartingNewWeek] = useState<boolean>(false);

  const [activeLessonForAction, setActiveLessonForAction] = useState<LiveLesson | null>(null);
  const [teacherEmailForConfig, setTeacherEmailForConfig] = useState<string>('itissimple.school@gmail.com');
  const [scheduleStudentInfo, setScheduleStudentInfo] = useState<{
    email: string;
    name: string;
    uid?: string;
    isTrialLesson?: boolean;
    teacherId?: string;
    teacherEmail?: string;
    teacherName?: string;
  } | null>(null);

  // Authoritative Trial Lesson Status Check (ensuring mandatory onboarding requirement)
  const hasConfirmedTrialLesson = useMemo(() => {
    if (userProfile?.hasCompletedTrialLesson) return true;
    const cleanEmail = (currentAccount?.email || userProfile?.email || '').toLowerCase().trim();
    const cleanUid = currentAccount?.uid || userProfile?.id || (userProfile as any)?.uid || '';
    if (!cleanEmail && !cleanUid) return false;
    return lessons.some((l) => {
      const isStudentMatch =
        (cleanEmail && (l.studentEmail || '').toLowerCase().trim() === cleanEmail) ||
        (cleanUid && (l.studentUid === cleanUid || (l as any).uid === cleanUid));
      const isCancelled = (l.status as string) === 'cancelled' || (l.status as string) === 'canceled' || Boolean(l.cancelledAt);
      return isStudentMatch && Boolean(l.isTrialLesson) && !isCancelled;
    });
  }, [userProfile?.hasCompletedTrialLesson, lessons, currentAccount?.email, currentAccount?.uid, userProfile?.email, userProfile?.id]);

  // Teacher Filter & Minimalist Activity Toggle
  const [selectedStudentFilter, setSelectedStudentFilter] = useState<string>('all');
  const [activeStudentActivity, setActiveStudentActivity] = useState<'insights' | 'notes' | 'videos_songs' | null>(null);
  const [videosAndSongsSubTab, setVideosAndSongsSubTab] = useState<'videos' | 'songs'>('videos');

  const handleSelectStudentFilter = (studentEmail: string) => {
    setSelectedStudentFilter(studentEmail);
    setActiveStudentActivity(null);
    if (studentEmail !== 'all') {
      setTimeout(() => {
        const el = document.getElementById('filtered-student-workspace');
        if (el) el.scrollIntoView({ behavior: 'smooth' });
      }, 100);
    }
  };

  const handleToggleStudentActivity = (act: 'insights' | 'notes' | 'videos_songs') => {
    setActiveStudentActivity((prev) => (prev === act ? null : act));
    setTimeout(() => {
      const el = document.getElementById('filtered-student-workspace');
      if (el) el.scrollIntoView({ behavior: 'smooth' });
    }, 100);
  };

  // 10. Fetch initial data from server on mount
  useEffect(() => {
    async function loadInitialData() {
      try {
        const authUser = await waitForAuthUser().catch(() => null);
        let tutorToken: string | null = null;
        if (authUser) {
          tutorToken = await getAdminAccessToken().catch(() => null);
          if (!tutorToken) {
            tutorToken = await authUser.getIdToken().catch(() => null);
          }
        }
        const tutorHeaders: Record<string, string> = {};
        if (tutorToken) {
          tutorHeaders['Authorization'] = `Bearer ${tutorToken}`;
        }

        const [routinesRes, studentsRes, settingsRes, landingRes, tutorsRes] = await Promise.all([
          fetch('/api/routines').catch(() => null),
          fetch('/api/students').catch(() => null),
          fetch('/api/teacher-settings').catch(() => null),
          fetch('/api/landing-content').catch(() => null),
          fetch('/api/tutors', { headers: tutorHeaders }).catch(() => null),
        ]);

        if (routinesRes && routinesRes.ok) {
          const data = await routinesRes.json();
          if (data && typeof data === 'object' && Object.keys(data).length > 0) {
            setRoutinesByDay(data);
          }
        }

        if (studentsRes && studentsRes.ok) {
          const data = await studentsRes.json();
          if (Array.isArray(data)) {
            setStudents(data);
          }
        }

        if (settingsRes && settingsRes.ok) {
          const data = await settingsRes.json();
          if (data && typeof data === 'object') {
            setTeacherMeetSettings((prev) => ({ ...prev, ...data }));
          }
        }

        if (landingRes && landingRes.ok) {
          const data = await landingRes.json();
          if (data && typeof data === 'object') {
            setLandingContent(data);
          }
        }

        if (tutorsRes && tutorsRes.ok) {
          const data = await tutorsRes.json();
          if (Array.isArray(data) && data.length > 0) {
            setTutors(data);
            setTeacherMeetSettings((prev) => {
              const updated = { ...prev };
              data.forEach((tut: any) => {
                const email = (tut.email || '').toLowerCase().trim();
                const mUrl = (tut.meetUrl || tut.meetLink || '').trim();
                if (email && mUrl) {
                  updated[email] = {
                    ...(updated[email] || {
                      workingHoursStart: '08:00',
                      workingHoursEnd: '18:00',
                      slotDurationMinutes: 30,
                      availableDays: tut.availableDays || ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'],
                      timezone: tut.timezone || 'America/Sao_Paulo',
                    }),
                    teacherEmail: email,
                    meetLink: mUrl,
                  };
                }
              });
              return updated;
            });
          }
        }
        // Authoritative Native Friends hydration from Firestore handled by useNativeFriends hook
        await refreshNativeFriends().catch(() => null);
      } catch (err) {
        console.warn('Using local default state:', err);
      }
    }

    loadInitialData();
  }, []);

  // Check for direct /admin, #admin, /teacher, or #teacher URL triggers with strict RBAC enforcement
  useEffect(() => {
    const handleRbacRouteCheck = () => {
      if (typeof window !== 'undefined') {
        const path = window.location.pathname;
        const hash = window.location.hash;

        // 1. Guard Administrator route (/admin or #admin)
        if (path === '/admin' || hash === '#admin') {
          if (currentAccount?.role === 'admin') {
            setViewMode('dashboard');
            setIsAdminApprovalsOpen(true);
          } else if (currentAccount?.role === 'student') {
            // STRICT RBAC: Block registered student from accessing Admin space
            setIsAdminApprovalsOpen(false);
            setIsAdminLandingEditorOpen(false);
            try {
              window.history.replaceState({ page: 'dashboard' }, '', '/dashboard');
            } catch {}
            setNotifications((prev) => [
              {
                id: `rbac-admin-guard-${Date.now()}`,
                title: currentLanguage === 'en' ? 'Access Restricted' : 'Acesso Restrito',
                message: currentLanguage === 'en'
                  ? 'Your account has a registered Student role. Access to Administrator panel is restricted.'
                  : 'Sua conta está registrada como Aluno(a). O acesso ao Painel de Administrador é restrito.',
                type: 'warning',
                timestamp: new Date().toISOString(),
                read: false,
              },
              ...prev,
            ]);
          } else if (currentAccount?.role === 'teacher') {
            setIsAdminApprovalsOpen(false);
            setIsAdminLandingEditorOpen(false);
            setViewMode('dashboard');
            try {
              window.history.replaceState({ page: 'teacher' }, '', '/teacher');
            } catch {}
          } else if (!currentAccount) {
            setAuthModalMode('login');
            setAuthModalRole('admin');
            setIsAuthModalOpen(true);
          }
        }

        // 2. Guard Native Friend / Teacher route (/teacher or #teacher)
        if (path === '/teacher' || hash === '#teacher') {
          if (currentAccount?.role === 'teacher' || currentAccount?.role === 'admin') {
            setViewMode('dashboard');
          } else if (currentAccount?.role === 'student') {
            // STRICT RBAC: Block registered student from accessing Native Friend space
            setIsEditTutorProfileOpen(false);
            try {
              window.history.replaceState({ page: 'dashboard' }, '', '/dashboard');
            } catch {}
            setNotifications((prev) => [
              {
                id: `rbac-teacher-guard-${Date.now()}`,
                title: currentLanguage === 'en' ? 'Access Restricted' : 'Acesso Restrito',
                message: currentLanguage === 'en'
                  ? 'Your account has a registered Student role. Access to Native Friend panel is restricted.'
                  : 'Sua conta está registrada como Aluno(a). O acesso ao Painel de Amigo Nativo é restrito.',
                type: 'warning',
                timestamp: new Date().toISOString(),
                read: false,
              },
              ...prev,
            ]);
          } else if (!currentAccount) {
            setAuthModalMode('login');
            setAuthModalRole('teacher');
            setIsAuthModalOpen(true);
          }
        }

        // 3. Guard Dashboard route (/dashboard or #dashboard)
        if (path === '/dashboard' || hash === '#dashboard') {
          if (currentAccount) {
            setViewMode('dashboard');
          }
        }
      }
    };
    handleRbacRouteCheck();
    window.addEventListener('popstate', handleRbacRouteCheck);
    return () => window.removeEventListener('popstate', handleRbacRouteCheck);
  }, [currentAccount, currentLanguage]);

  // Active RBAC enforcement: If user is a student, ensure admin/tutor modals are closed and url is student space
  useEffect(() => {
    if (currentAccount?.role === 'student') {
      if (isAdminApprovalsOpen) setIsAdminApprovalsOpen(false);
      if (isAdminLandingEditorOpen) setIsAdminLandingEditorOpen(false);
      if (isEditTutorProfileOpen) setIsEditTutorProfileOpen(false);
      if (typeof window !== 'undefined') {
        const path = window.location.pathname;
        const hash = window.location.hash;
        if (path === '/admin' || path === '/teacher' || hash === '#admin' || hash === '#teacher') {
          try {
            window.history.replaceState({ page: 'dashboard' }, '', '/dashboard');
          } catch {}
        }
      }
    }
  }, [currentAccount, isAdminApprovalsOpen, isAdminLandingEditorOpen, isEditTutorProfileOpen]);

  // Compute current day's routine items
  const currentDayRoutines = useMemo(() => {
    return routinesByDay[selectedDay] || [];
  }, [routinesByDay, selectedDay]);

  // Compute currently selected activity
  const currentActivity = useMemo(() => {
    return currentDayRoutines.find((item) => item.id === selectedActivityId) || currentDayRoutines[0] || null;
  }, [currentDayRoutines, selectedActivityId]);

  // Generate Weekly Homework automatically whenever routines, dictionary, or targetDay change
  useEffect(() => {
    const customWordList = consolidatedActiveDictionary.map((e) => ({
      id: e.id,
      word: e.word,
      definitionEn: e.definitionEn,
      exampleSentence: e.exampleSentenceEn,
      translationPt: e.translationPt || '',
      sourceActivityName: e.sourceActivityName || 'Personal Dictionary',
      sourceDay: (e as any).sourceDay,
      source: e.source,
      learnedAt: e.learnedAt,
      practiceCount: e.practiceCount,
      lastPracticedAt: e.lastPracticedAt,
    }));

    const generated = generateWeeklyHomeworkFromRoutines({
      routinesByDay,
      studentName: userProfile.name,
      studentLevel: userProfile.level,
      studentEmail: currentAccount?.email || userProfile.email,
      customWords: customWordList,
      targetDay: homeworkTargetDay,
      activeStudyDays: userProfile?.weeklyStudyDays,
      weeklyCycle: userProfile?.weeklyCycle || 1,
      userProfile,
      excludedWords: excludedDictionaryWords,
    });

    // If we already have an AI-generated homework and the collected words haven't changed, preserve it (unless it was generated with old template)!
    setWeeklyHomework((prev) => {
      const isSameWeek =
        prev &&
        ((prev.weeklyCycle && generated.weeklyCycle && prev.weeklyCycle === generated.weeklyCycle) ||
          (prev.weekId && generated.weekId && prev.weekId === generated.weekId));

      if (isSameWeek && prev?.isAiGenerated && !prev.isEmpty && prev.totalWordsCollected > 0 && prev.targetDay === homeworkTargetDay) {
        const prevText = prev.readingPassage?.text || '';
        const prevTextLower = prevText.toLowerCase();
        const hasBadOldStoryOrBoilerplate =
          prevText.includes('to make sure everything stayed aligned') ||
          prevText.includes('quick to ') ||
          prevText.includes('refreshing weather') ||
          prevText.includes('storm terms') ||
          prevTextLower.includes('the day began with great purpose as') ||
          prevTextLower.includes('reviewed key plans regarding') ||
          prevTextLower.includes('a productive day of focus and growth') ||
          prevTextLower.includes('address **') ||
          prevTextLower.includes('managing **') ||
          prevTextLower.includes('progress made on **') ||
          prevText.length < 80 ||
          prev.fillInBlanks?.some((f: any) =>
            f.sentenceWithBlank?.includes('Understanding how to optimize') ||
            f.sentenceWithBlank?.includes('The team established a') ||
            f.hintEn?.includes('Key concept representing') ||
            f.hintEn?.includes('Descriptive term characterizing')
          );

        if (!hasBadOldStoryOrBoilerplate) {
          const prevWords = prev.vocabularyList.map((w) => w.word.toLowerCase()).sort().join('|');
          const nextWords = generated.vocabularyList.map((w) => w.word.toLowerCase()).sort().join('|');
          if (prevWords === nextWords) {
            return prev;
          }
        }
      }
      return {
        ...generated,
        isCompleted: (isSameWeek && prev?.isCompleted) || generated.isCompleted,
        isDayPartCompleted: (isSameWeek && prev?.isDayPartCompleted) || generated.isDayPartCompleted,
        completedPartsByDay: {
          ...((isSameWeek && prev?.completedPartsByDay) || {}),
          ...(generated.completedPartsByDay || {}),
        },
        studentAnswers: {
          matching: { ...((isSameWeek && prev?.studentAnswers?.matching) || {}), ...(generated.studentAnswers?.matching || {}) },
          fillInBlanks: { ...((isSameWeek && prev?.studentAnswers?.fillInBlanks) || {}), ...(generated.studentAnswers?.fillInBlanks || {}) },
          sentences: { ...((isSameWeek && prev?.studentAnswers?.sentences) || {}), ...(generated.studentAnswers?.sentences || {}) },
          quizAnswers: { ...((isSameWeek && prev?.studentAnswers?.quizAnswers) || {}), ...(generated.studentAnswers?.quizAnswers || {}) },
        },
      };
    });
  }, [routinesByDay, userProfile.name, userProfile.level, studentDictionaryEntries, excludedDictionaryWords, homeworkTargetDay, userProfile?.weeklyStudyDays, userProfile?.weeklyCycle]);

  // Synchronize completedPartsByDay from weeklyChecks so memorization S-Path checks are always in sync
  useEffect(() => {
    if (!weeklyChecks || Object.keys(weeklyChecks).length === 0) return;
    setWeeklyHomework((prev) => {
      if (!prev) return prev;
      let hasChanges = false;
      const currentParts = { ...(prev.completedPartsByDay || {}) };
      DAYS_OF_WEEK.forEach((d) => {
        if (weeklyChecks[`memorization_${d}`] && !currentParts[d]) {
          currentParts[d] = true;
          hasChanges = true;
        }
      });
      if (!hasChanges) return prev;
      return {
        ...prev,
        isDayPartCompleted: true,
        completedPartsByDay: currentParts,
      };
    });
  }, [weeklyChecks]);

  // AI-powered dynamic regeneration for Memorization Activity (focused on target day's vocabulary)
  const [isGeneratingHomeworkAi, setIsGeneratingHomeworkAi] = useState<boolean>(false);
  const isGeneratingAiRef = useRef<boolean>(false);

  const handleRegenerateHomeworkWithAi = useCallback(async () => {
    if (isGeneratingAiRef.current) return;
    isGeneratingAiRef.current = true;
    setIsGeneratingHomeworkAi(true);
    try {
      const generated = await generateWeeklyHomeworkWithAi({
        routinesByDay,
        studentName: userProfile.name,
        studentLevel: userProfile.level,
        studentEmail: currentAccount?.email || userProfile.email || '',
        targetDay: homeworkTargetDay,
        activeStudyDays: userProfile?.weeklyStudyDays,
        weeklyCycle: userProfile?.weeklyCycle || 1,
        userProfile,
        customWords: studentDictionaryEntries.map((e) => ({
          id: e.id,
          word: e.word,
          definitionEn: e.definitionEn,
          exampleSentence: e.exampleSentenceEn,
          translationPt: e.translationPt || '',
          sourceActivityName: e.sourceActivityName || 'Personal Dictionary',
          sourceDay: (e as any).sourceDay,
          source: e.source,
          learnedAt: e.learnedAt,
          practiceCount: e.practiceCount,
          lastPracticedAt: e.lastPracticedAt,
        })),
      });
      if (generated) {
        setWeeklyHomework((prev) => {
          const isSameWeek =
            prev &&
            ((prev.weeklyCycle && generated.weeklyCycle && prev.weeklyCycle === generated.weeklyCycle) ||
              (prev.weekId && generated.weekId && prev.weekId === generated.weekId));

          return {
            ...generated,
            isCompleted: (isSameWeek && prev?.isCompleted) || generated.isCompleted,
            isDayPartCompleted: (isSameWeek && prev?.isDayPartCompleted) || generated.isDayPartCompleted,
            completedPartsByDay: {
              ...((isSameWeek && prev?.completedPartsByDay) || {}),
              ...(generated.completedPartsByDay || {}),
            },
            studentAnswers: {
              matching: { ...((isSameWeek && prev?.studentAnswers?.matching) || {}), ...(generated.studentAnswers?.matching || {}) },
              fillInBlanks: { ...((isSameWeek && prev?.studentAnswers?.fillInBlanks) || {}), ...(generated.studentAnswers?.fillInBlanks || {}) },
              sentences: { ...((isSameWeek && prev?.studentAnswers?.sentences) || {}), ...(generated.studentAnswers?.sentences || {}) },
              quizAnswers: { ...((isSameWeek && prev?.studentAnswers?.quizAnswers) || {}), ...(generated.studentAnswers?.quizAnswers || {}) },
            },
          };
        });
        if (generated.isAiGenerated) {
          setNotifications((prev) => [
            {
              id: `hw-ai-${Date.now()}`,
              title: currentLanguage === 'en' ? 'AI Memorization Activity Ready!' : 'Atividade de Memorização Pronta!',
              message: currentLanguage === 'en'
                ? 'Gemini AI crafted a custom native story, smart blanks, and writing challenges tailored to your weekly words.'
                : 'A IA Gemini elaborou uma história nativa inédita, lacunas inteligentes e desafios práticos para suas palavras.',
              type: 'success',
              timestamp: new Date().toISOString(),
              read: false,
            },
            ...prev,
          ]);
        } else {
          lastAttemptedSignatureRef.current = '';
        }
      } else {
        lastAttemptedSignatureRef.current = '';
      }
    } catch {
      lastAttemptedSignatureRef.current = '';
      // Non-blocking fallback
    } finally {
      isGeneratingAiRef.current = false;
      setIsGeneratingHomeworkAi(false);
    }
  }, [routinesByDay, userProfile, currentAccount?.email, studentDictionaryEntries, homeworkTargetDay, currentLanguage]);

  const lastAttemptedSignatureRef = useRef<string>('');

  // Security Hotfix (Etapa 2): Automatic paid generation on modal opening removed.
  // Homework uses cached state or deterministic layout on open; explicit button click required for AI generation.

  const handleOpenHomeworkModal = useCallback((targetDay?: DayOfWeek) => {
    const selected = targetDay || getTodayDayOfWeek();
    setHomeworkTargetDay(selected);
    setIsHomeworkModalOpen(true);
  }, []);

  // Synchronize isolated student profile, lessons, routines, and settings whenever currentAccount changes
  useEffect(() => {
    if (!currentAccount?.email) {
      activeStudentUidRef.current = '';
      setLessons([]);
      setStudents([]);
      setWeeklyChecks({});
      setStudentJournal([]);
      setWeeklyHomework(null);
      setStudentDictionaryEntries([]);
      setUserProfile(createDefaultStudentProfile(null));
      setRoutinesByDay(createCleanStudentRoutines());
      return;
    }

    const email = currentAccount.email;
    const role = currentAccount.role;
    const cleanEmail = email.toLowerCase().trim();
    const uid = normalizeUid(currentAccount.uid, cleanEmail);
    activeStudentUidRef.current = role === 'student' ? uid : '';
    const queryParams = `email=${encodeURIComponent(email)}&role=${encodeURIComponent(role)}${uid ? `&uid=${encodeURIComponent(uid)}` : ''}`;

    const isTeacherRole = role === 'teacher' || role === 'admin';
    let isCancelled = false;

    // 1. Fetch user-isolated lessons directly from Firestore + API atomically (Firestore is authoritative)
    Promise.all([
      fetchStudentLessonsFromFirestore(uid, email, isTeacherRole).catch(() => []),
      apiClient.get<LiveLesson[]>('/api/lessons'),
    ])
      .then(([fsLessons, apiLessons]) => {
        if (isCancelled) return;
        const map = new Map<string, LiveLesson>();
        // Put API data first
        (Array.isArray(apiLessons) ? apiLessons : []).forEach((l: LiveLesson) => {
          if (l?.id) map.set(l.id, l);
        });
        // Put fsLessons over API data (Firestore takes absolute priority!)
        (Array.isArray(fsLessons) ? fsLessons : []).forEach((l: LiveLesson) => {
          if (!l?.id) return;
          const existing = map.get(l.id);
          if (existing && (existing.status === 'cancelled' || existing.cancelledAt) && l.status !== 'cancelled' && !l.cancelledAt) {
            // Keep cancelled
          } else if (existing && (existing.status === 'completed' || existing.completedAt) && l.status !== 'completed' && !l.completedAt) {
            // Keep completed
          } else {
            map.set(l.id, { ...existing, ...l });
          }
        });
        // Strict invariant: any cancelled lesson is permanently marked cancelled, any completed lesson is permanently completed
        map.forEach((l, id) => {
          if (l.status === 'cancelled' || l.cancelledAt) {
            map.set(id, {
              ...l,
              status: 'cancelled',
              cancelledAt: l.cancelledAt || new Date().toISOString(),
            });
          } else if (l.status === 'completed' || l.completedAt) {
            map.set(id, {
              ...l,
              status: 'completed',
              completedAt: l.completedAt || new Date().toISOString(),
            });
          }
        });
        setLessons(Array.from(map.values()));
      })
      .catch((apiErr: any) => {
        if (isCancelled) return;
        console.error('[App] Erro ao carregar aulas da API /api/lessons:', apiErr);
        // Do NOT convert 401/403/500 silently into []
        const status = apiErr?.status;
        if (status === 401 || apiErr?.isUnauthorized) {
          setNotifications((prev) => [
            {
              id: `api-err-401-${Date.now()}`,
              title: currentLanguage === 'en' ? 'Session Required' : 'Autenticação Necessária',
              message: currentLanguage === 'en' ? 'Your session expired. Please sign in again.' : 'Sessão expirada ou não autenticada. Por favor, faça login novamente.',
              type: 'warning',
              timestamp: new Date().toISOString(),
              read: false,
            },
            ...prev,
          ]);
        } else if (status === 403 || apiErr?.isForbidden) {
          setNotifications((prev) => [
            {
              id: `api-err-403-${Date.now()}`,
              title: currentLanguage === 'en' ? 'Access Denied' : 'Acesso Negado',
              message: currentLanguage === 'en' ? 'Access forbidden to these lesson records.' : 'Acesso negado: sem autorização para consultar esses registros de aula.',
              type: 'warning',
              timestamp: new Date().toISOString(),
              read: false,
            },
            ...prev,
          ]);
        } else if (status === 500 || apiErr?.isServerError) {
          setNotifications((prev) => [
            {
              id: `api-err-500-${Date.now()}`,
              title: currentLanguage === 'en' ? 'Server Error' : 'Erro no Servidor',
              message: currentLanguage === 'en' ? 'Backend error while retrieving lessons.' : 'Erro interno do servidor ao recuperar aulas.',
              type: 'warning',
              timestamp: new Date().toISOString(),
              read: false,
            },
            ...prev,
          ]);
        }
        // Fallback to direct Firestore lessons so UI remains functional
        fetchStudentLessonsFromFirestore(uid, email, isTeacherRole)
          .then((fsLessons) => {
            if (!isCancelled && Array.isArray(fsLessons) && fsLessons.length > 0) {
              setLessons(fsLessons);
            }
          })
          .catch(() => {});
      });

    // Real-time synchronization for lessons from Firestore
    const unsubLessons = subscribeToStudentLessons(uid, email, isTeacherRole, (realtimeLessons) => {
      if (Array.isArray(realtimeLessons)) {
        setLessons(realtimeLessons);
      }
    });

    // Real-time synchronization for student journal (Sentence of the Day + Lesson Reviews)
    const unsubJournal = role === 'student' && uid ? subscribeToStudentDailyJournal(uid, email, (realtimeJournal) => {
      if (Array.isArray(realtimeJournal)) {
        setDailyJournalEntries(realtimeJournal);
      }
    }) : () => {};

    // 2. Fetch user-isolated students list (for teachers and admin)
    if (role === 'teacher' || role === 'admin') {
      fetch(`/api/students?${queryParams}`)
        .then((r) => (r.ok ? r.json() : []))
        .then((data) => {
          if (Array.isArray(data)) setStudents(data);
        })
        .catch((err) => console.warn('Could not fetch isolated students:', err));
    } else {
      setStudents([]);
    }

    // 3. If student, immediately reset routines and session state to clean state before fetching
    if (role === 'student') {
      setWeeklyChecks({});
      setStudentJournal([]);
      setWeeklyHomework(null);
      setStudentDictionaryEntries([]);
      const cachedDict = getCachedLocalVocabulary(uid, email);
      if (cachedDict && cachedDict.length > 0) {
        setStudentDictionaryEntries(cachedDict);
      }
      setRoutinesByDay(createCleanStudentRoutines(userProfile?.routineVideoTime));

      async function loadStudentData() {
        try {
          // A. Fetch directly from Firestore first (master source of truth for assigned Native Friend & profile)
          const [fsProfile, profileRes] = await Promise.all([
            fetchStudentProfileFromFirestore(uid, email).catch(() => null),
            fetch(`/api/user-profile?email=${encodeURIComponent(email)}${uid ? `&uid=${encodeURIComponent(uid)}` : ''}`).catch(() => null),
          ]);

          let loadedProfile: UserProfile | null = null;
          let apiProfileData: any = null;
          if (profileRes && profileRes.ok) {
            const data = await profileRes.json();
            apiProfileData = data.profile;
          }

          const baseProfile = createDefaultStudentProfile(currentAccount);
          const cleanPic =
            (fsProfile?.picture && fsProfile.picture.trim() !== '' ? fsProfile.picture : '') ||
            (apiProfileData?.picture && apiProfileData.picture.trim() !== '' ? apiProfileData.picture : '') ||
            (currentAccount!.picture && currentAccount!.picture.trim() !== '' ? currentAccount!.picture : '') ||
            '';

          // Critical: Firestore assigned Native Friend and status take absolute precedence over default/stale API data!
          const effectiveTeacherEmail =
            fsProfile?.teacherEmail !== undefined
              ? fsProfile.teacherEmail
              : apiProfileData?.teacherEmail || null;

          const effectiveTeacherName =
            fsProfile?.teacherName !== undefined
              ? fsProfile.teacherName
              : apiProfileData?.teacherName || null;

          const effectiveEnrollment =
            fsProfile?.enrollmentStatus ||
            apiProfileData?.enrollmentStatus ||
            (effectiveTeacherEmail ? 'active' : 'not_enrolled');

          const effectiveStudentUid = currentAccount?.uid || auth.currentUser?.uid || uid;
          loadedProfile = {
            ...baseProfile,
            ...(apiProfileData || {}),
            ...(fsProfile || {}),
            id: effectiveStudentUid,
            uid: effectiveStudentUid,
            name: fsProfile?.name || apiProfileData?.name || currentAccount!.name || '',
            email: currentAccount!.email,
            picture: cleanPic,
            avatar: cleanPic,
            teacherEmail: effectiveTeacherEmail,
            teacherName: effectiveTeacherName,
            teacherUid: fsProfile?.teacherUid || apiProfileData?.teacherUid || (effectiveTeacherEmail ? `usr-${effectiveTeacherEmail.replace(/[^a-zA-Z0-9]/g, '-')}` : null),
            assignedNativeFriendUID: fsProfile?.assignedNativeFriendUID || fsProfile?.nativeFriendUID || apiProfileData?.assignedNativeFriendUID || null,
            nativeFriendUID: fsProfile?.nativeFriendUID || fsProfile?.assignedNativeFriendUID || apiProfileData?.nativeFriendUID || null,
            enrollmentStatus: effectiveEnrollment,
          };
          if (loadedProfile) {
            setUserProfile(loadedProfile);
          }

          // Fetch student-specific routines
          const routinesRes = await fetch(`/api/student-routines?studentEmail=${encodeURIComponent(email)}${uid ? `&uid=${encodeURIComponent(uid)}` : ''}`).catch(() => null);
          let baseRoutines = createCleanStudentRoutines(loadedProfile?.routineVideoTime);
          if (routinesRes && routinesRes.ok) {
            const routines = await routinesRes.json();
            if (routines && typeof routines === 'object' && Object.keys(routines).length > 0) {
              baseRoutines = routines;
            }
          }

          // Hydrate daily routines directly from Firestore first (source of truth per student UID)
          try {
            const cloudVideos = await fetchAllRoutineVideosFromFirestore(effectiveStudentUid);
            if (cloudVideos && Object.keys(cloudVideos).length > 0) {
              (Object.keys(cloudVideos) as DayOfWeek[]).forEach((day) => {
                const v = cloudVideos[day];
                const cleanVidId = v && v.videoId ? v.videoId.trim() : '';
                if (cleanVidId && v) {
                  const dayList = baseRoutines[day] || defaultRoutinesByDay[day] || [];
                  baseRoutines[day] = dayList.map((item, idx) => {
                    if (idx === 0 || item.activityName?.toLowerCase().includes('video') || item.activityName?.toLowerCase().includes('vídeo')) {
                      return {
                        ...item,
                        activityName: v.playlistTitle || v.title || v.videoTitle || item.activityName,
                        playlistId: v.playlistId || '',
                        playlistTitle: v.playlistTitle || '',
                        teacherVideos: [{
                          id: cleanVidId,
                          videoId: cleanVidId,
                          title: v.title || v.videoTitle || 'Daily Video Practice',
                          url: v.url || `https://www.youtube.com/watch?v=${cleanVidId}`,
                          playlistId: v.playlistId || '',
                          isRepeatVideo: Boolean(v.isRepeatVideo),
                        }],
                        completedToday: v.completedToday !== undefined ? v.completedToday : item.completedToday,
                      };
                    }
                    return item;
                  });
                } else if (v && v.videoId === '') {
                  const dayList = baseRoutines[day] || defaultRoutinesByDay[day] || [];
                  baseRoutines[day] = dayList.map((item, idx) => {
                    if (idx === 0 || item.activityName?.toLowerCase().includes('video') || item.activityName?.toLowerCase().includes('vídeo')) {
                      return {
                        ...item,
                        activityName: 'Video of the Day',
                        playlistId: '',
                        playlistTitle: '',
                        teacherVideos: [],
                        completedToday: v.completedToday !== undefined ? v.completedToday : item.completedToday,
                      };
                    }
                    return item;
                  });
                }
              });
            }
          } catch (e) {
            console.warn('Notice hydrating routines from Firestore on login:', e);
          }

          // Apply this specific student's registered routine times
          const vidTime = loadedProfile?.routineVideoTime;
          const audTime = loadedProfile?.routineAudioTime;
          const finalRoutines = applyProfileTimesToRoutines(baseRoutines, vidTime, audTime);
          setRoutinesByDay(finalRoutines);

          // Auto-position on today's focus
          const today = getTodayDayOfWeek();
          setSelectedDay(today);
          const todayItems = finalRoutines[today] || [];
          if (todayItems.length > 0) {
            setSelectedActivityId(todayItems[0].id);
          }

          // Fetch student-isolated studentJournal & S-Path weekly checks directly from Firestore (Multi-device Sync)
          const loadedCycle = parseWeekCycleNumber(loadedProfile?.weeklyCycle);
          fetchStudentJournalActivitiesFromFirestore(uid, email)
            .then((journalData) => {
              if (Array.isArray(journalData) && journalData.length > 0) {
                setStudentJournal(journalData);
                if (loadedCycle !== null) {
                  const derivedChecks = deriveWeeklyChecksFromJournal(journalData, loadedCycle);
                  setWeeklyChecks((prev) => ({ ...prev, ...derivedChecks }));
                }
              }
            })
            .catch(() => {});

          // Hydrate student daily journal (Sentence of the Day + Lesson Reviews)
          fetch(`/api/student-journal?uid=${encodeURIComponent(uid)}&studentEmail=${encodeURIComponent(email)}`)
            .then((r) => (r.ok ? r.json() : null))
            .then((entries) => {
              if (Array.isArray(entries) && entries.length > 0) {
                setDailyJournalEntries((prev) => {
                  const map = new Map<string, any>();
                  (prev || []).forEach((e) => { if (e?.id) map.set(e.id, e); });
                  entries.forEach((e) => { if (e?.id) map.set(e.id, e); });
                  return Array.from(map.values()).sort((a, b) => {
                    const tA = new Date(a.createdAt || a.date).getTime();
                    const tB = new Date(b.createdAt || b.date).getTime();
                    return tB - tA;
                  });
                });
              }
            })
            .catch(() => {});

          if (loadedCycle !== null) {
            fetchStudentWeeklyChecksFromFirestore(uid, email, loadedCycle)
              .then((checksData) => {
                if (checksData && checksData.checks) {
                  setWeeklyChecks((prev) => ({ ...prev, ...checksData.checks }));
                }
              })
              .catch((err) => {
                console.warn('Notice loading weekly checks from Firestore:', err);
              });
          }

          // Fetch student exclusions first from Firestore/server, then student vocabulary
          fetchExcludedDictionaryWords(uid, email)
            .then((excluded) => {
              if (isCancelled) return null;
              if (activeStudentUidRef.current !== uid) return null;
              if (Array.isArray(excluded)) {
                excludedDictionaryWordsRef.current = excluded;
                setExcludedDictionaryWords(excluded);
              }
              return fetchStudentVocabularyFromFirestore(uid, email);
            })
            .then((vocab) => {
              if (isCancelled || !vocab) return;
              if (activeStudentUidRef.current !== uid) return;
              if (Array.isArray(vocab) && vocab.length > 0) {
                setStudentDictionaryEntries((prev) => {
                  if (activeStudentUidRef.current !== uid) return prev;
                  return consolidateDictionaryEntries(prev, vocab, excludedDictionaryWordsRef.current);
                });
              }
            })
            .catch(() => {});

          // 4. Fetch student homework and activity progress directly from Cloud Firestore (cross-device sync)
          const targetCycleForFetch = loadedCycle !== null ? loadedCycle : 1;
          const targetWeekIdForFetch = normalizeWeekId(targetCycleForFetch) || 'week-1';

          fetchStudentHomeworkProgressFromFirestore(uid, email, targetWeekIdForFetch)
            .then((cloudHw) => {
              if (isCancelled) return;
              if (cloudHw && (cloudHw.completedPartsByDay || cloudHw.studentAnswers || cloudHw.matchingPairs)) {
                const hwCycle = parseWeekCycleNumber(cloudHw.weeklyCycle) || parseWeekCycleNumber(cloudHw.weekId);
                if (hwCycle !== null && hwCycle !== targetCycleForFetch) return;

                setWeeklyHomework((prev) => {
                  const isSameWeek =
                    prev &&
                    ((prev.weeklyCycle && prev.weeklyCycle === targetCycleForFetch) ||
                      (prev.weekId && prev.weekId === targetWeekIdForFetch));
                  if (!isSameWeek) {
                    return cloudHw;
                  }
                  return {
                    ...prev,
                    ...cloudHw,
                    completedPartsByDay: {
                      ...(cloudHw.completedPartsByDay || {}),
                    },
                    studentAnswers: {
                      matching: { ...(cloudHw.studentAnswers?.matching || {}) },
                      fillInBlanks: { ...(cloudHw.studentAnswers?.fillInBlanks || {}) },
                      sentences: { ...(cloudHw.studentAnswers?.sentences || {}) },
                      quizAnswers: { ...(cloudHw.studentAnswers?.quizAnswers || {}) },
                    },
                    aiEvaluation: cloudHw.aiEvaluation || prev.aiEvaluation,
                    score: typeof cloudHw.score === 'number' ? cloudHw.score : prev.score,
                    isCompleted: typeof cloudHw.isCompleted === 'boolean' ? cloudHw.isCompleted : prev.isCompleted,
                  };
                });
              }
            })
            .catch((err) => {
              console.warn('Notice loading homework from Firestore:', err);
            });

          if (loadedCycle !== null) {
            getAccessToken().then((token) => {
              if (isCancelled || !token) return;
              const canonicalUid = auth.currentUser?.uid || (isValidCanonicalUid(uid) ? uid : '');
              if (!canonicalUid && !email) return;

              const currentAuthEmail = (auth?.currentUser?.email || '').toLowerCase().trim();
              const safeEmail = (email && (!currentAuthEmail || currentAuthEmail === email.toLowerCase().trim())) ? email : '';
              const canonicalWeekId = normalizeWeekId(loadedCycle);
              if (!canonicalWeekId) return;

              const hwParams = new URLSearchParams();
              if (canonicalUid) {
                hwParams.append('uid', canonicalUid);
                hwParams.append('studentUid', canonicalUid);
              }
              if (safeEmail) {
                hwParams.append('studentEmail', safeEmail);
              }
              hwParams.append('weekId', canonicalWeekId);
              hwParams.append('weeklyCycle', String(loadedCycle));

              fetch(`/api/homework?${hwParams.toString()}`, {
                headers: {
                  Authorization: `Bearer ${token}`,
                },
              })
                .then((res) => (res.ok ? res.json() : null))
                .then((savedHw) => {
                  if (isCancelled) return;
                  if (savedHw && (savedHw.completedPartsByDay || savedHw.studentAnswers)) {
                    const hwCycle = parseWeekCycleNumber(savedHw.weeklyCycle) || parseWeekCycleNumber(savedHw.weekId);
                    if (hwCycle !== null && hwCycle !== loadedCycle) return;

                    setWeeklyHomework((prev) => {
                      const isSameWeek =
                        prev &&
                        ((prev.weeklyCycle && prev.weeklyCycle === loadedCycle) ||
                          (prev.weekId && prev.weekId === canonicalWeekId));
                      if (!isSameWeek) {
                        return savedHw;
                      }
                      return {
                        ...prev,
                        ...savedHw,
                        completedPartsByDay: {
                          ...(savedHw.completedPartsByDay || {}),
                        },
                        studentAnswers: {
                          matching: { ...(savedHw.studentAnswers?.matching || {}) },
                          fillInBlanks: { ...(savedHw.studentAnswers?.fillInBlanks || {}) },
                          sentences: { ...(savedHw.studentAnswers?.sentences || {}) },
                          quizAnswers: { ...(savedHw.studentAnswers?.quizAnswers || {}) },
                        },
                        aiEvaluation: savedHw.aiEvaluation || prev.aiEvaluation,
                        score: typeof savedHw.score === 'number' ? savedHw.score : prev.score,
                        isCompleted: typeof savedHw.isCompleted === 'boolean' ? savedHw.isCompleted : prev.isCompleted,
                      };
                    });
                  }
                })
                .catch(() => {});
            }).catch(() => {});
          }
        } catch (err) {
          console.warn('Could not fetch student data:', err);
        }
      }
      loadStudentData();
    } else if (role === 'teacher') {
      // 4. If teacher, fetch isolated teacher settings and tutor profile
      fetch(`/api/teacher-settings?teacherEmail=${encodeURIComponent(email)}${uid ? `&uid=${encodeURIComponent(uid)}` : ''}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((settings) => {
          if (settings && typeof settings === 'object' && Object.keys(settings).length > 0) {
            setTeacherMeetSettings((prev) => ({ ...prev, ...settings }));
          }
        })
        .catch((err) => console.warn('Could not fetch teacher settings:', err));

      async function loadTeacherProfile() {
        try {
          const cleanEmail = email.toLowerCase().trim();
          const cleanTutorId = `tutor-${cleanEmail.replace(/[^a-zA-Z0-9]/g, '-')}`;

          // Direct Firestore tutor document check (Authoritative)
          try {
            const tutorSnap = await getDoc(doc(getDb(), 'tutors', cleanTutorId));
            if (tutorSnap.exists()) {
              const directTutor = { id: tutorSnap.id, ...tutorSnap.data() } as NativeFriendTutor;
              const directTutorEmail = (directTutor.email || '').toLowerCase().trim();
              setTutors((prev) => {
                const filtered = prev.filter(
                  (t) =>
                    (t?.email ? t.email.toLowerCase().trim() !== directTutorEmail : true) &&
                    t?.id !== directTutor.id
                );
                return [...filtered, directTutor];
              });
            }
          } catch (fsErr) {
            console.warn('Direct Firestore tutor check notice:', fsErr);
          }

          const res = await fetch(`/api/user-profile?email=${encodeURIComponent(email)}${uid ? `&uid=${encodeURIComponent(uid)}` : ''}`);
          if (res.ok) {
            const data = await res.json();
            if (data.tutor) {
              const dataTutorEmail = (data.tutor.email || '').toLowerCase().trim();
              setTutors((prev) => {
                const filtered = prev.filter(
                  (t) =>
                    (t?.email ? t.email.toLowerCase().trim() !== dataTutorEmail : true) &&
                    t?.id !== data.tutor.id
                );
                return [...filtered, data.tutor];
              });
            }
          }
        } catch (err) {
          console.warn('Could not fetch teacher profile:', err);
        }
      }
      loadTeacherProfile();
    }

    // Fetch user-isolated student dictionary entries and journal entries directly from Firestore
    // Strictly isolate: teachers and non-students must NEVER query the student's private dictionary endpoint
    if (role === 'student' && (email || uid)) {
      const dictEmail = email || userProfile?.email || '';
      const canonicalStudentUid = normalizeUid(uid, dictEmail);
      // 1. Direct Firestore fetch for vocabulary (cumulative)
      fetchStudentVocabularyFromFirestore(canonicalStudentUid, dictEmail).then((fsEntries) => {
        if (isCancelled) return;
        if (role === 'student' && activeStudentUidRef.current !== canonicalStudentUid) return;
        if (Array.isArray(fsEntries) && fsEntries.length > 0) {
          setStudentDictionaryEntries((prev) => {
            if (role === 'student' && activeStudentUidRef.current !== canonicalStudentUid) return prev;
            return consolidateDictionaryEntries(prev, fsEntries, excludedDictionaryWordsRef.current);
          });
        }
      });

      // 2. Mirror from backend
      auth.currentUser?.getIdToken().then((token) => {
        const headers: Record<string, string> = {};
        if (token) headers['Authorization'] = `Bearer ${token}`;
        return fetch(`/api/student-dictionary?studentEmail=${encodeURIComponent(dictEmail)}${canonicalStudentUid ? `&uid=${encodeURIComponent(canonicalStudentUid)}` : ''}`, { headers });
      }).catch(() => {
        return fetch(`/api/student-dictionary?studentEmail=${encodeURIComponent(dictEmail)}${canonicalStudentUid ? `&uid=${encodeURIComponent(canonicalStudentUid)}` : ''}`);
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (isCancelled || !data) return;
          if (role === 'student' && activeStudentUidRef.current !== canonicalStudentUid) return;

          const entries = Array.isArray(data) ? data : (Array.isArray(data?.dictionary) ? data.dictionary : []);
          const excluded = Array.isArray(data?.excludedWords)
            ? data.excludedWords.map((w: string) => normalizeDictionaryWord(w)).filter(Boolean)
            : [];

          if (excluded.length > 0) {
            excludedDictionaryWordsRef.current = excluded;
            setExcludedDictionaryWords(excluded);
            cacheExcludedWordsLocally(canonicalStudentUid, dictEmail, excluded);
          }

          if (entries.length > 0) {
            setStudentDictionaryEntries((prev) => {
              if (role === 'student' && activeStudentUidRef.current !== canonicalStudentUid) return prev;
              return consolidateDictionaryEntries(prev, entries, excludedDictionaryWordsRef.current);
            });
          }
        })
        .catch((err) => console.warn('Could not fetch student dictionary:', err));

      // 3. Direct Firestore fetch for student journal
      fetchStudentJournalFromFirestore(uid, dictEmail).then((fsJournal) => {
        if (Array.isArray(fsJournal) && fsJournal.length > 0) {
          setDailyJournalEntries(fsJournal);
        }
      });

      // 4. Backend journal mirror
      fetch(`/api/student-journal?studentEmail=${encodeURIComponent(dictEmail)}${uid ? `&uid=${encodeURIComponent(uid)}` : ''}`)
        .then((r) => (r.ok ? r.json() : []))
        .then((data) => {
          if (Array.isArray(data) && data.length > 0) {
            setDailyJournalEntries((prev) => {
              const map = new Map<string, DailyJournalEntry>();
              prev.forEach((e) => map.set(e.id, e));
              data.forEach((e: DailyJournalEntry) => map.set(e.id, e));
              const list = Array.from(map.values());
              list.sort((a, b) => new Date(b.createdAt || b.date).getTime() - new Date(a.createdAt || a.date).getTime());
              return list;
            });
          }
        })
        .catch(() => {});
    }

    return () => {
      isCancelled = true;
      unsubLessons();
      unsubJournal();
    };
  }, [currentAccount?.email, currentAccount?.role, currentAccount?.uid, selectedStudentFilter, userProfile?.email]);

  // Real-time synchronization of student profile and assigned Native Friend across all devices & sessions
  useEffect(() => {
    const uid = currentAccount?.uid || auth.currentUser?.uid || userProfile?.uid || userProfile?.id || '';
    const email = currentAccount?.email || userProfile?.email || '';
    if (!uid) return;

    const unsub = subscribeToStudentProfile(uid, email, (updated) => {
      if (updated) {
        setUserProfile((prev) => ({
          ...prev,
          ...updated,
          id: uid,
          uid: uid,
          teacherEmail: updated.teacherEmail !== undefined ? updated.teacherEmail : prev.teacherEmail,
          teacherName: updated.teacherName !== undefined ? updated.teacherName : prev.teacherName,
          teacherUid: updated.teacherUid !== undefined ? updated.teacherUid : prev.teacherUid,
          assignedNativeFriendUID: updated.assignedNativeFriendUID !== undefined ? updated.assignedNativeFriendUID : prev.assignedNativeFriendUID,
          nativeFriendUID: updated.nativeFriendUID !== undefined ? updated.nativeFriendUID : prev.nativeFriendUID,
          enrollmentStatus: updated.enrollmentStatus || prev.enrollmentStatus,
        }));
        if (typeof updated.contractedLessons === 'number' && email) {
          setContractedLessons((prev) => ({
            ...prev,
            [email.toLowerCase().trim()]: updated.contractedLessons as number,
          }));
        }
      }
    });

    return () => unsub();
  }, [currentAccount?.uid, currentAccount?.email]);

  // Real-time synchronization of student S-Path weekly checks across all devices (Mobile <-> Desktop)
  useEffect(() => {
    const uid = currentAccount?.uid || auth.currentUser?.uid || userProfile?.uid || userProfile?.id || '';
    const email = currentAccount?.email || userProfile?.email || '';
    if (!uid && !email) return;

    const activeCycle = parseWeekCycleNumber(userProfile?.weeklyCycle);
    if (activeCycle === null) {
      // Profile not loaded or cycle invalid: do not silently subscribe to Week 1
      return;
    }

    const unsub = subscribeToStudentWeeklyChecks(
      uid,
      email,
      (data) => {
        if (data && data.checks && Object.keys(data.checks).length > 0) {
          setWeeklyChecks((prev) => ({ ...prev, ...data.checks }));
        }
        if (typeof data.weeklyNativeLessonsTarget === 'number' && data.weeklyNativeLessonsTarget > 0) {
          setUserProfile((prev) => ({
            ...prev,
            weeklyNativeLessonsTarget: data.weeklyNativeLessonsTarget,
          }));
        }
        if (typeof data.weeklyStudyDaysTarget === 'number' && data.weeklyStudyDaysTarget > 0) {
          setUserProfile((prev) => ({
            ...prev,
            weeklyStudyDaysTarget: data.weeklyStudyDaysTarget,
          }));
        }
      },
      activeCycle
    );

    return () => unsub();
  }, [currentAccount?.uid, currentAccount?.email, userProfile?.id, userProfile?.weeklyCycle]);

  // Real-time synchronization of student daily routines across all devices
  useEffect(() => {
    const uid = currentAccount?.uid || auth.currentUser?.uid || userProfile?.uid || userProfile?.id || '';
    const email = currentAccount?.email || userProfile?.email || '';
    if (!uid && !email) return;

    const unsub = subscribeToStudentDailyRoutines(uid, (cloudRoutines) => {
      if (cloudRoutines && typeof cloudRoutines === 'object' && Object.keys(cloudRoutines).length > 0) {
        setRoutinesByDay((prev) => {
          const merged = { ...prev };
          (Object.keys(cloudRoutines) as DayOfWeek[]).forEach((day) => {
            const dayData = cloudRoutines[day];
            if (dayData && typeof dayData === 'object') {
              if (Array.isArray(dayData)) {
                merged[day] = dayData;
              } else {
                const dayList = merged[day] || defaultRoutinesByDay[day] || [];
                const cleanVidId = dayData.videoId ? dayData.videoId.trim() : '';
                merged[day] = dayList.map((item, idx) => {
                  if (
                    idx === 0 ||
                    item.id.endsWith('1') ||
                    item.activityName?.toLowerCase().includes('vídeo') ||
                    item.activityName?.toLowerCase().includes('video')
                  ) {
                    return {
                      ...item,
                      activityName: cleanVidId
                        ? (dayData.playlistTitle || dayData.title || dayData.videoTitle || item.activityName)
                        : (dayData.playlistTitle || 'Video of the Day'),
                      playlistId: dayData.playlistId || '',
                      playlistTitle: dayData.playlistTitle || '',
                      teacherVideos: cleanVidId
                        ? [
                            {
                              id: cleanVidId,
                              videoId: cleanVidId,
                              title: dayData.title || dayData.videoTitle || 'Daily Video Practice',
                              url: dayData.url || `https://www.youtube.com/watch?v=${cleanVidId}`,
                              playlistId: dayData.playlistId || '',
                              isRepeatVideo: Boolean(dayData.isRepeatVideo),
                            },
                          ]
                        : [],
                      teacherSpotify: dayData.teacherOverrideTrack
                        ? {
                            id: dayData.teacherOverrideTrack.url || 'track',
                            title: dayData.teacherOverrideTrack.title,
                            artist: dayData.teacherOverrideTrack.artist || dayData.teacherOverrideTrack.artistOrHost,
                            url: dayData.teacherOverrideTrack.url,
                          }
                        : item.teacherSpotify,
                      completedToday: dayData.completedToday !== undefined ? dayData.completedToday : item.completedToday,
                    };
                  }
                  return item;
                });
              }
            }
          });
          return merged;
        });
      }
    });

    return () => unsub();
  }, [currentAccount?.uid, currentAccount?.email, userProfile?.id]);

  // Real-time synchronization of daily journal entries (Daily Sentence & Reflections) across all devices
  useEffect(() => {
    const uid = currentAccount?.uid || auth.currentUser?.uid || userProfile?.uid || userProfile?.id || '';
    const email = currentAccount?.email || userProfile?.email || '';
    if (!uid && !email) return;

    const unsub = subscribeToStudentDailyJournal(uid, email, (entries) => {
      if (Array.isArray(entries)) {
        setDailyJournalEntries(entries);
      }
    });

    return () => unsub();
  }, [currentAccount?.uid, currentAccount?.email, userProfile?.id]);

  // Real-time synchronization of studentJournal across all devices (Mobile <-> Desktop)
  useEffect(() => {
    const uid = currentAccount?.uid || auth.currentUser?.uid || userProfile?.uid || userProfile?.id || '';
    const email = currentAccount?.email || userProfile?.email || '';
    if (!uid && !email) return;

    const activeCycle = parseWeekCycleNumber(userProfile?.weeklyCycle);

    const unsub = subscribeToStudentJournal(uid, email, (journal) => {
      if (Array.isArray(journal)) {
        setStudentJournal(journal);
        if (activeCycle !== null) {
          const derivedChecks = deriveWeeklyChecksFromJournal(journal, activeCycle);
          setWeeklyChecks((prev) => ({ ...prev, ...derivedChecks }));
        }
      }
    });

    return () => unsub();
  }, [currentAccount?.uid, currentAccount?.email, userProfile?.id, userProfile?.weeklyCycle]);

  // Real-time synchronization of student homework and activity progress across all devices (Mobile <-> Desktop)
  useEffect(() => {
    const uid =
      (currentAccount?.role === 'student'
        ? (currentAccount?.uid || '')
        : (selectedStudentFilter !== 'all' ? selectedStudentFilter : '')) ||
      auth.currentUser?.uid ||
      userProfile?.id ||
      (userProfile as any)?.uid ||
      '';
    const email =
      (currentAccount?.role === 'student'
        ? (currentAccount?.email || '')
        : (selectedStudentFilter !== 'all' ? selectedStudentFilter : '')) ||
      auth.currentUser?.email ||
      userProfile?.email ||
      '';
    if (!uid && !email) return;

    const activeCycle = parseWeekCycleNumber(userProfile?.weeklyCycle) || 1;
    const activeWeekId = normalizeWeekId(activeCycle) || 'week-1';

    let isCancelled = false;

    const unsub = subscribeToStudentHomeworkProgress(
      uid,
      email,
      (cloudHw) => {
        if (isCancelled) return;

        // Guard against stale callbacks from a different week cycle
        const incomingCycle = parseWeekCycleNumber(cloudHw.weeklyCycle) || parseWeekCycleNumber(cloudHw.weekId);
        if (incomingCycle !== null && incomingCycle !== activeCycle) {
          return;
        }

        setWeeklyHomework((prev) => {
          const isSameWeek =
            prev &&
            ((prev.weeklyCycle && prev.weeklyCycle === activeCycle) ||
              (prev.weekId && prev.weekId === activeWeekId));

          // If previous state belonged to an older or different week, start completely fresh from cloudHw
          if (!isSameWeek) {
            return cloudHw;
          }

          // If the cloud homework is reset, empty, or unanswered:
          const isResetOrEmpty =
            (!cloudHw.studentAnswers ||
              (Object.keys(cloudHw.studentAnswers.matching || {}).length === 0 &&
                Object.keys(cloudHw.studentAnswers.fillInBlanks || {}).length === 0 &&
                Object.keys(cloudHw.studentAnswers.sentences || {}).length === 0 &&
                Object.keys(cloudHw.studentAnswers.quizAnswers || {}).length === 0)) &&
            (!cloudHw.completedPartsByDay || Object.keys(cloudHw.completedPartsByDay).length === 0) &&
            !cloudHw.isCompleted;

          if (isResetOrEmpty) {
            return {
              ...prev,
              ...cloudHw,
              isCompleted: false,
              isDayPartCompleted: false,
              score: 0,
              completedPartsByDay: {},
              studentAnswers: {
                matching: {},
                fillInBlanks: {},
                sentences: {},
                quizAnswers: {},
              },
            };
          }

          return {
            ...prev,
            ...cloudHw,
            completedPartsByDay: {
              ...(cloudHw.completedPartsByDay || {}),
            },
            studentAnswers: {
              matching: { ...(cloudHw.studentAnswers?.matching || {}) },
              fillInBlanks: { ...(cloudHw.studentAnswers?.fillInBlanks || {}) },
              sentences: { ...(cloudHw.studentAnswers?.sentences || {}) },
              quizAnswers: { ...(cloudHw.studentAnswers?.quizAnswers || {}) },
            },
            aiEvaluation: cloudHw.aiEvaluation || prev.aiEvaluation,
            score: typeof cloudHw.score === 'number' ? cloudHw.score : prev.score,
            isCompleted: typeof cloudHw.isCompleted === 'boolean' ? cloudHw.isCompleted : prev.isCompleted,
          };
        });
      },
      activeWeekId
    );

    return () => {
      isCancelled = true;
      unsub();
    };
  }, [
    currentAccount?.uid,
    currentAccount?.email,
    currentAccount?.role,
    selectedStudentFilter,
    userProfile?.id,
    userProfile?.email,
    userProfile?.weeklyCycle,
  ]);

  // Real-time synchronization of student vocabulary dictionary across all devices & sessions (Mobile <-> Desktop)
  useEffect(() => {
    if (currentAccount?.role !== 'student') return;
    const cleanEmail = (currentAccount?.email || '').toLowerCase().trim();
    const uid = normalizeUid(currentAccount?.uid, cleanEmail);
    if (!uid) return;

    let isEffectCancelled = false;

    const unsub = subscribeToStudentVocabulary(uid, cleanEmail, (cloudEntries, snapshotResult) => {
      if (isEffectCancelled) return;
      if (activeStudentUidRef.current !== uid) return;

      const status = snapshotResult?.status;
      // Do not overwrite existing valid entries if state is error or initial loading with empty
      if (status === 'error') {
        return;
      }
      if (status === 'loading' && cloudEntries.length === 0) {
        return;
      }

      if (snapshotResult?.excludedWords && Array.isArray(snapshotResult.excludedWords)) {
        const excl = snapshotResult.excludedWords.map((w: string) => normalizeDictionaryWord(w)).filter(Boolean);
        excludedDictionaryWordsRef.current = excl;
        setExcludedDictionaryWords(excl);
      }

      if (Array.isArray(cloudEntries)) {
        // Direct authoritative reflection from Cloud Firestore guarantees deletion and addition instant sync across devices!
        const filtered = cloudEntries.filter((e) => {
          const norm = normalizeDictionaryWord(e.normalizedWord || e.word);
          return Boolean(norm && !excludedDictionaryWordsRef.current.includes(norm));
        });
        setStudentDictionaryEntries(filtered);
      }
    });

    return () => {
      isEffectCancelled = true;
      unsub();
    };
  }, [currentAccount?.uid, currentAccount?.email, currentAccount?.role]);

  // Ensure accumulated vocabulary is loaded from Firestore whenever switching lessons or days
  useEffect(() => {
    if (currentAccount?.role !== 'student') return;
    const cleanEmail = (currentAccount?.email || '').toLowerCase().trim();
    const uid = normalizeUid(currentAccount?.uid, cleanEmail);
    if (!uid) return;

    let isEffectCancelled = false;

    fetchStudentVocabularyFromFirestore(uid, cleanEmail).then((fsEntries) => {
      if (isEffectCancelled) return;
      if (activeStudentUidRef.current !== uid) return;
      if (Array.isArray(fsEntries) && fsEntries.length > 0) {
        setStudentDictionaryEntries((prev) => {
          if (activeStudentUidRef.current !== uid) return prev;
          return consolidateDictionaryEntries(prev, fsEntries, excludedDictionaryWordsRef.current);
        });
      }
    });

    return () => {
      isEffectCancelled = true;
    };
  }, [selectedDay, selectedActivityId, currentAccount?.role, currentAccount?.uid, currentAccount?.email]);

  // Refresh student dictionary whenever the modal is opened (students only)
  useEffect(() => {
    if (!isPersonalDictionaryOpen || currentAccount?.role !== 'student') return;
    const isStudentUser = currentAccount?.role === 'student';
    const targetStudentFromFilter = !isStudentUser && selectedStudentFilter && selectedStudentFilter !== 'all'
      ? studentsList.find((s) =>
          Boolean(s) &&
          (((s.email || '').toLowerCase().trim() === (selectedStudentFilter || '').toLowerCase().trim()) ||
            s.uid === selectedStudentFilter ||
            s.id === selectedStudentFilter)
        )
      : null;

    const cleanEmail = isStudentUser
      ? (currentAccount?.email || auth.currentUser?.email || userProfile?.email || '').toLowerCase().trim()
      : (targetStudentFromFilter?.email || (selectedStudentFilter !== 'all' && selectedStudentFilter.includes('@') ? selectedStudentFilter : '')).toLowerCase().trim();

    const rawUid = isStudentUser
      ? (currentAccount?.uid || auth.currentUser?.uid || userProfile?.id || (userProfile as any)?.uid || '')
      : (targetStudentFromFilter?.uid || targetStudentFromFilter?.id || (selectedStudentFilter !== 'all' && !selectedStudentFilter.includes('@') ? selectedStudentFilter : ''));

    const uid = normalizeUid(rawUid, cleanEmail);
    if (!uid && !cleanEmail) return;

    let isEffectCancelled = false;

    auth.currentUser?.getIdToken().then((token) => {
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      return fetch(`/api/student-dictionary?studentEmail=${encodeURIComponent(cleanEmail)}${uid ? `&uid=${encodeURIComponent(uid)}` : ''}`, { headers });
    }).catch(() => {
      return fetch(`/api/student-dictionary?studentEmail=${encodeURIComponent(cleanEmail)}${uid ? `&uid=${encodeURIComponent(uid)}` : ''}`);
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (isEffectCancelled || !data) return;
        if (currentAccount?.role === 'student' && activeStudentUidRef.current !== uid) return;

        const entries = Array.isArray(data) ? data : (Array.isArray(data?.dictionary) ? data.dictionary : []);
        const excluded = Array.isArray(data?.excludedWords)
          ? data.excludedWords.map((w: string) => normalizeDictionaryWord(w)).filter(Boolean)
          : [];

        if (excluded.length > 0) {
          excludedDictionaryWordsRef.current = excluded;
          setExcludedDictionaryWords(excluded);
          cacheExcludedWordsLocally(uid, cleanEmail, excluded);
        }

        const excludedSet = new Set(excluded);
        setStudentDictionaryEntries((prev) => {
          if (currentAccount?.role === 'student' && activeStudentUidRef.current !== uid) return prev;
          const filteredPrev = prev.filter((p) => !excludedSet.has(normalizeDictionaryWord(p.normalizedWord || p.word)));
          if (entries.length > 0) {
            return consolidateDictionaryEntries(filteredPrev, entries, excluded);
          }
          return filteredPrev;
        });
      })
      .catch((err) => console.warn('Could not refresh student dictionary:', err));

    return () => {
      isEffectCancelled = true;
    };
  }, [isPersonalDictionaryOpen, currentAccount?.email, currentAccount?.role, currentAccount?.uid, selectedStudentFilter, userProfile?.email]);

  // Handler: Manage/Update Native Friend Subscription
  const handleUpdateSubscription = async (teacherEmail: string | null, teacherName: string | null) => {
    const cleanTeacherEmail = teacherEmail ? teacherEmail.trim().toLowerCase() : null;
    const cleanTeacherName = teacherName ? teacherName.trim() : null;
    const matchedTutor = tutors.find((t) => (t.email || '').toLowerCase().trim() === cleanTeacherEmail);
    const resolvedTeacherUid =
      (matchedTutor?.uid && isValidCanonicalUid(matchedTutor.uid) ? matchedTutor.uid : null) ||
      (matchedTutor?.id && isValidCanonicalUid(matchedTutor.id) ? matchedTutor.id : null);
    const newEnrollmentStatus: 'active' | 'not_enrolled' | 'cancelled' = cleanTeacherEmail && resolvedTeacherUid ? 'active' : (cleanTeacherEmail ? 'not_enrolled' : 'cancelled');

    setUserProfile((prev) => ({
      ...prev,
      teacherEmail: cleanTeacherEmail || undefined,
      teacherName: cleanTeacherName || undefined,
      teacherUid: resolvedTeacherUid || undefined,
      assignedNativeFriendUID: resolvedTeacherUid || undefined,
      nativeFriendUID: resolvedTeacherUid || undefined,
      enrollmentStatus: newEnrollmentStatus,
    }));

    if (currentAccount?.email) {
      const cleanStEmail = currentAccount.email.toLowerCase().trim();
      const stUid = currentAccount.uid || userProfile?.id || cleanStEmail;

      // 1. Immediately write to Firestore
      saveStudentNativeFriendToFirestore(stUid, cleanStEmail, {
        teacherEmail: cleanTeacherEmail,
        teacherName: cleanTeacherName,
        teacherUid: resolvedTeacherUid,
        assignedNativeFriendUID: resolvedTeacherUid,
        nativeFriendUID: resolvedTeacherUid,
        enrollmentStatus: newEnrollmentStatus,
      }).catch((err) => console.warn('Firestore subscription update notice:', err));

      saveStudentProfileToFirestore(
        stUid,
        {
          ...userProfile,
          teacherEmail: cleanTeacherEmail || undefined,
          teacherName: cleanTeacherName || undefined,
          teacherUid: resolvedTeacherUid || undefined,
          assignedNativeFriendUID: resolvedTeacherUid || undefined,
          nativeFriendUID: resolvedTeacherUid || undefined,
          enrollmentStatus: newEnrollmentStatus,
        },
        cleanStEmail
      ).catch((err) => console.warn('Firestore profile update notice on subscription change:', err));

      // 2. Update students state
      setStudents((prev) => {
        const exists = prev.some((s) => (s.email || s.studentEmail || '').toLowerCase().trim() === cleanStEmail);
        if (exists) {
          return prev.map((s) =>
            (s.email || s.studentEmail || '').toLowerCase().trim() === cleanStEmail
              ? {
                  ...s,
                  teacherEmail: cleanTeacherEmail || '',
                  teacherName: cleanTeacherName || '',
                  teacherUid: resolvedTeacherUid || '',
                  status: newEnrollmentStatus,
                }
              : s
          );
        }
        return [
          ...prev,
          {
            id: stUid,
            name: userProfile.name || currentAccount.name || cleanStEmail.split('@')[0],
            studentName: userProfile.name || currentAccount.name || cleanStEmail.split('@')[0],
            email: cleanStEmail,
            studentEmail: cleanStEmail,
            teacherEmail: cleanTeacherEmail || '',
            teacherName: cleanTeacherName || '',
            teacherUid: resolvedTeacherUid || '',
            status: newEnrollmentStatus,
            level: userProfile.level || EnglishLevel.BEGINNER,
          },
        ];
      });

      // 3. Mirror to server API
      try {
        await fetch('/api/user-profile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: currentAccount.email,
            profile: {
              teacherEmail: cleanTeacherEmail,
              teacherName: cleanTeacherName,
              teacherUid: resolvedTeacherUid,
              assignedNativeFriendUID: resolvedTeacherUid,
              nativeFriendUID: resolvedTeacherUid,
              enrollmentStatus: newEnrollmentStatus,
            },
          }),
        });
      } catch (err) {
        console.warn('Failed to update subscription:', err);
      }
    }
  };

  // Handler: Start Living in English (Opens Email Verification Modal or redirects if student is logged in)
  const handleStartLivingInEnglish = () => {
    if (currentAccount?.role === 'student') {
      setViewMode('dashboard');
      return;
    }
    setIsStartLivingModalOpen(true);
  };

  // Handler: Complete Onboarding Wizard (Multi-step Assistant)
  const handleCompleteOnboarding = async (data: OnboardingResultData) => {
    setIsOnboardingCompleting(true);
    try {
      // 1. Student identity resolution
      const isRegisteringStudent = Boolean(data.studentAccount?.email && data.studentAccount.email.trim() !== '');
      const cleanEmail = isRegisteringStudent
        ? data.studentAccount!.email.trim().toLowerCase()
        : (currentAccount?.role === 'student' && currentAccount.email ? currentAccount.email.trim().toLowerCase() : (userProfile.email || currentAccount?.email || ''));
      const effectiveName = isRegisteringStudent
        ? (data.studentAccount!.name || data.studentAccount!.email.split('@')[0]).trim()
        : (currentAccount?.role === 'student' && currentAccount.name ? currentAccount.name.trim() : (userProfile.name || currentAccount?.name || 'Aluno'));

      // Resolve canonical Student UID directly from verified Firebase identity
      let studentUid =
        (data.studentAccount?.uid && isValidCanonicalUid(data.studentAccount.uid) ? data.studentAccount.uid.trim() : '') ||
        (auth.currentUser && (auth.currentUser.email || '').toLowerCase().trim() === cleanEmail && isValidCanonicalUid(auth.currentUser.uid) ? auth.currentUser.uid : '') ||
        (currentAccount?.role === 'student' && (currentAccount.email || '').toLowerCase().trim() === cleanEmail && isValidCanonicalUid(currentAccount.uid) ? currentAccount.uid : '');

      // If still missing and registration credentials provided, authenticate with Firebase Auth immediately
      if (!studentUid && isRegisteringStudent && data.studentAccount?.password) {
        try {
          const authRes = await firebaseSignUpWithEmail(cleanEmail, data.studentAccount.password);
          studentUid = authRes.user.uid;
        } catch (signupErr: any) {
          if (signupErr?.code === 'auth/email-already-in-use') {
            try {
              const loginRes = await firebaseSignInWithEmail(cleanEmail, data.studentAccount.password);
              studentUid = loginRes.user.uid;
            } catch (loginErr) {
              console.warn('Firebase login attempt failed during onboarding reconciliation:', loginErr);
            }
          }
        }
      }

      if (!studentUid || !isValidCanonicalUid(studentUid)) {
        throw new Error(
          currentLanguage === 'en'
            ? 'Canonical Student UID missing. Please authenticate with Firebase before completing onboarding.'
            : 'UID canônico do Aluno ausente. Por favor, autentique-se com o Firebase antes de concluir o onboarding.'
        );
      }

      const selectedLevel = (data.englishLevel || data.userLevel || data.level || EnglishLevel.BEGINNER) as EnglishLevel;

      // 2. Identify selected Native Friend public identity
      const cleanTeacherEmail = (data.selectedTutor?.email || '').toLowerCase().trim();
      const selectedTutorIdRaw = data.selectedTutor?.id;
      const selectedTutorPublicIdRaw = (data.selectedTutor as any)?.publicTutorId;
      const selectedTutorNameRaw = data.selectedTutor?.name;
      const selectedTutorUidRaw = data.selectedTutor?.uid || data.selectedTutor?.authUid;

      const matchedTutor = tutors.find((t) => {
        if (selectedTutorUidRaw && isValidCanonicalUid(selectedTutorUidRaw)) {
          if (t.uid === selectedTutorUidRaw || t.authUid === selectedTutorUidRaw || t.id === selectedTutorUidRaw) return true;
        }
        if (cleanTeacherEmail && cleanTeacherEmail.includes('@')) {
          if ((t.email || '').toLowerCase().trim() === cleanTeacherEmail) return true;
        }
        if (selectedTutorPublicIdRaw && !isGenericTutorId(selectedTutorPublicIdRaw)) {
          if (t.publicTutorId === selectedTutorPublicIdRaw || t.id === selectedTutorPublicIdRaw) return true;
        }
        if (selectedTutorIdRaw && !isGenericTutorId(selectedTutorIdRaw)) {
          if (t.id === selectedTutorIdRaw || t.publicTutorId === selectedTutorIdRaw) return true;
        }
        if (selectedTutorNameRaw && !isGenericTutorId(selectedTutorNameRaw)) {
          if (normalizeTutorName(t.name) === normalizeTutorName(selectedTutorNameRaw)) return true;
        }
        return false;
      });

      const targetTeacherPublicId =
        (selectedTutorPublicIdRaw && !isGenericTutorId(selectedTutorPublicIdRaw) ? selectedTutorPublicIdRaw.trim() : null) ||
        (matchedTutor?.publicTutorId && !isGenericTutorId(matchedTutor.publicTutorId) ? matchedTutor.publicTutorId.trim() : null) ||
        (selectedTutorIdRaw && !isGenericTutorId(selectedTutorIdRaw) ? selectedTutorIdRaw.trim() : null) ||
        (matchedTutor?.id && !isGenericTutorId(matchedTutor.id) ? matchedTutor.id.trim() : null) ||
        (selectedTutorNameRaw && !isGenericTutorId(selectedTutorNameRaw) ? normalizeTutorName(selectedTutorNameRaw).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : null) ||
        '';

      const finalTeacherEmail = (cleanTeacherEmail && cleanTeacherEmail.includes('@')) ? cleanTeacherEmail : ((matchedTutor?.email || '').toLowerCase().trim());
      const finalTeacherName = data.selectedTutor?.name || matchedTutor?.name || 'Native Friend';
      const finalTeacherMeetUrl = data.selectedTutor?.meetUrl || (data.selectedTutor as any)?.meetLink || matchedTutor?.meetUrl || '';

      // Candidate canonical UID if already verified in client session
      let canonicalTutorUid =
        (data.selectedTutor?.authUid && isValidCanonicalUid(data.selectedTutor.authUid) ? data.selectedTutor.authUid.trim() : '') ||
        (data.selectedTutor?.uid && isValidCanonicalUid(data.selectedTutor.uid) ? data.selectedTutor.uid.trim() : '') ||
        (data.selectedTutor?.id && isValidCanonicalUid(data.selectedTutor.id) ? data.selectedTutor.id.trim() : '') ||
        (matchedTutor?.authUid && isValidCanonicalUid(matchedTutor.authUid) ? matchedTutor.authUid.trim() : '') ||
        (matchedTutor?.uid && isValidCanonicalUid(matchedTutor.uid) ? matchedTutor.uid.trim() : '') ||
        (matchedTutor?.id && isValidCanonicalUid(matchedTutor.id) ? matchedTutor.id.trim() : '');

      if (!targetTeacherPublicId && !finalTeacherEmail && !canonicalTutorUid) {
        throw new Error(
          currentLanguage === 'en'
            ? 'Please select a valid Native Friend to complete onboarding.'
            : 'Por favor, selecione um Amigo Nativo válido para concluir o onboarding.'
        );
      }

      const newStudentAccount: GoogleAccount = {
        uid: studentUid,
        id: studentUid,
        name: effectiveName,
        email: cleanEmail,
        role: 'student',
        picture: auth.currentUser?.photoURL || '',
        avatar: auth.currentUser?.photoURL || '',
      };

      // 3. Sync with backend API — backend resolves canonical UID, verifies approval and enforces student link
      if (isRegisteringStudent) {
        const idToken = await auth.currentUser?.getIdToken().catch(() => null);
        const effectiveTeacherId = !isGenericTutorId(targetTeacherPublicId) ? targetTeacherPublicId : (canonicalTutorUid || undefined);
        const signupRes = await fetch('/api/auth/signup', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
          },
          body: JSON.stringify({
            uid: studentUid,
            name: effectiveName,
            email: cleanEmail,
            role: 'student',
            isUpdate: true,
            level: selectedLevel,
            englishLevel: selectedLevel,
            userLevel: selectedLevel,
            learningGoal: data.learningGoal,
            weeklyPracticeDays: data.weeklyStudyDaysTarget,
            routineActivities: data.weeklyStudyDays,
            routineVideoTime: data.routineVideoTime,
            routineAudioTime: data.routineAudioTime,
            dailyPhraseTime: data.dailyPhraseTime,
            teacherId: effectiveTeacherId,
            publicTutorId: effectiveTeacherId,
            selectedTutorId: effectiveTeacherId,
            teacherUid: canonicalTutorUid || undefined,
            teacherEmail: (finalTeacherEmail && finalTeacherEmail.includes('@')) ? finalTeacherEmail : undefined,
            teacherName: finalTeacherName,
            selectedTutorEmail: (finalTeacherEmail && finalTeacherEmail.includes('@')) ? finalTeacherEmail : undefined,
            selectedTutorName: finalTeacherName,
            contractedLessons: 1,
          }),
        });

        const signupData = await signupRes.json().catch(() => ({}));
        if (!signupRes.ok) {
          throw new Error(signupData.error || signupData.message || (currentLanguage === 'en' ? 'Failed to complete registration.' : 'Falha ao concluir cadastro.'));
        }

        if (signupData.profile?.teacherUid && isValidCanonicalUid(signupData.profile.teacherUid)) {
          canonicalTutorUid = signupData.profile.teacherUid;
        }
      }

      // 4. Prepare and persist user profile data with assigned Native Friend and trial lesson balance
      const effectiveStoredTeacherId = !isGenericTutorId(targetTeacherPublicId) ? targetTeacherPublicId : (canonicalTutorUid || '');
      const updatedProfile: UserProfile = {
        ...createDefaultStudentProfile(newStudentAccount),
        id: studentUid,
        uid: studentUid,
        name: effectiveName,
        email: cleanEmail,
        level: selectedLevel,
        userLevel: selectedLevel,
        englishLevel: selectedLevel,
        onboardingCompleted: false,
        learningGoal: data.learningGoal,
        weeklyStudyDaysTarget: data.weeklyStudyDaysTarget,
        weeklyStudyDays: data.weeklyStudyDays,
        routineVideoTime: data.routineVideoTime,
        routineAudioTime: data.routineAudioTime,
        dailyPhraseTime: data.dailyPhraseTime,
        teacherId: effectiveStoredTeacherId,
        publicTutorId: effectiveStoredTeacherId,
        teacherEmail: finalTeacherEmail || userProfile.teacherEmail || '',
        teacherName: finalTeacherName || userProfile.teacherName || '',
        teacherMeetUrl: finalTeacherMeetUrl || userProfile.teacherMeetUrl || '',
        teacherUid: canonicalTutorUid || undefined,
        assignedNativeFriendUID: canonicalTutorUid || undefined,
        nativeFriendUID: canonicalTutorUid || undefined,
        enrollmentStatus: 'active',
        contractedLessons: Math.max(userProfile.contractedLessons || 0, 1),
        hasCompletedTrialLesson: false,
        subscriptionType: 'trial',
      };

      // Persist profile to users/{studentUid} via backend API with Admin SDK
      let profileSaved = await saveStudentProfileToFirestore(studentUid, updatedProfile, cleanEmail);
      if (!profileSaved) {
        console.warn('[Onboarding] Direct Firestore profile write returned false; attempting retry...');
        profileSaved = await saveStudentProfileToFirestore(studentUid, updatedProfile, cleanEmail);
        if (!profileSaved) {
          throw new Error(
            currentLanguage === 'en'
              ? 'Failed to persist student profile to database. Please try again.'
              : 'Falha ao salvar perfil do estudante no banco de dados. Por favor, tente novamente.'
          );
        }
      }

      // Save student-teacher link in users/{studentUid}
      if (finalTeacherEmail || targetTeacherPublicId) {
        await saveStudentNativeFriendToFirestore(studentUid, cleanEmail, {
          teacherEmail: finalTeacherEmail,
          teacherName: finalTeacherName,
          teacherId: targetTeacherPublicId,
          publicTutorId: targetTeacherPublicId,
          teacherUid: canonicalTutorUid || undefined,
          assignedNativeFriendUID: canonicalTutorUid || undefined,
          nativeFriendUID: canonicalTutorUid || undefined,
          enrollmentStatus: 'active',
        }).catch((err) => console.warn('Teacher link persistence notice:', err));
      }

      // Initialize clean routines in Firestore
      await initializeCleanStudentRoutinesInFirestore(studentUid).catch(() => {});

      // 5. UPDATE REACT STATE AFTER SUCCESSFUL PERSISTENCE:
      const cleanInitialRoutines = createCleanStudentRoutines(data.routineVideoTime);
      setIsOnboardingCompleting(false);
      // Keep modal open so student advances to Step 6 (Roadmap / Trial lesson scheduling)
      setCurrentAccount(newStudentAccount);
      setUserProfile(updatedProfile);
      setRoutinesByDay(cleanInitialRoutines);
      setWeeklyChecks({});
      setStudentJournal([]);
      setWeeklyHomework(null);

      // Update contractedLessons map with trial lesson immediately
      if (cleanEmail) {
        setContractedLessons((prev) => ({
          ...prev,
          [cleanEmail]: Math.max(prev[cleanEmail] || 0, 1),
        }));

        setStudents((prev) => {
          const exists = prev.some((st) => (st.email || st.studentEmail || '').toLowerCase().trim() === cleanEmail);
          if (exists) {
            return prev.map((st) =>
              (st.email || st.studentEmail || '').toLowerCase().trim() === cleanEmail
                ? {
                    ...st,
                    id: studentUid,
                    uid: studentUid,
                    teacherEmail: data.selectedTutor?.email || st.teacherEmail,
                    teacherName: data.selectedTutor?.name || st.teacherName,
                    teacherUid: canonicalTutorUid || (st as any).teacherUid,
                    contractedLessons: Math.max(st.contractedLessons || 0, 1),
                    level: selectedLevel,
                  }
                : st
            );
          }
          return [
            ...prev,
            {
              id: studentUid,
              uid: studentUid,
              name: effectiveName || cleanEmail.split('@')[0],
              studentName: effectiveName || cleanEmail.split('@')[0],
              email: cleanEmail,
              studentEmail: cleanEmail,
              teacherEmail: data.selectedTutor?.email || '',
              teacherName: data.selectedTutor?.name || '',
              teacherUid: canonicalTutorUid,
              status: 'active',
              level: selectedLevel,
              contractedLessons: 1,
            },
          ];
        });
      }

      // Pre-fetch and cache Spotify playlist tracks for the selected student level
      const normLevel = normalizeStudentLevel(selectedLevel);
      fetchTracksForStudentLevel(normLevel).catch(() => {});

      // Push welcome notification immediately
      setNotifications((prev) => [
        {
          id: `onboarding-${Date.now()}`,
          title: currentLanguage === 'en'
            ? '🎉 Onboarding Completed!'
            : '🎉 Onboarding Concluído com Sucesso!',
          message: currentLanguage === 'en'
            ? `Your personalized routine with ${data.selectedTutor?.name || 'your Native Friend'} is active! Your first free trial lesson is available to schedule.`
            : `Sua rotina personalizada com ${data.selectedTutor?.name || 'seu Amigo Nativo'} foi ativada! Sua 1ª aula teste gratuita está disponível para agendamento.`,
          type: 'success',
          timestamp: new Date().toISOString(),
          read: false,
        },
        ...prev,
      ]);

      // Auto-open lesson schedule modal for this tutor with verified student UID ready
      const effectiveTeacherTarget = finalTeacherEmail || targetTeacherPublicId;
      if (effectiveTeacherTarget) {
        setTeacherEmailForConfig(effectiveTeacherTarget);
        setScheduleStudentInfo({
          name: effectiveName,
          email: cleanEmail,
          uid: studentUid,
          isTrialLesson: true,
          teacherId: targetTeacherPublicId,
          teacherEmail: finalTeacherEmail,
          teacherName: finalTeacherName,
        });
        setTimeout(() => {
          setIsScheduleModalOpen(true);
        }, 350);
      }
    } catch (err: any) {
      console.warn('Onboarding completion error:', err);
      alert(err?.message || (currentLanguage === 'en' ? 'Failed to complete onboarding.' : 'Erro ao concluir o onboarding.'));
      setIsOnboardingModalOpen(false);
      if (!currentAccount) {
        setViewMode('landing');
      }
    } finally {
      setIsOnboardingCompleting(false);
    }
  };

  // Handler: Purchase Lesson Package with a specific Native Friend (Fixed Assignment)
  const handlePurchasePackage = async (params: {
    teacherEmail: string;
    teacherName: string;
    packageLessons: number;
    packagePriceBrl?: number;
    packagePriceUsd?: number;
    paymentMethod?: string;
  }) => {
    if (!currentAccount?.email) return;

    try {
      const cleanStEmail = currentAccount.email.toLowerCase().trim();
      const stUid = currentAccount.uid || userProfile?.id || cleanStEmail;
      const cleanTeacherEmail = params.teacherEmail ? params.teacherEmail.trim().toLowerCase() : '';
      const cleanTeacherName = params.teacherName ? params.teacherName.trim() : 'Native Friend';
      const matchedTutor = tutors.find((t) =>
        (cleanTeacherEmail && (t.email || '').toLowerCase().trim() === cleanTeacherEmail) ||
        (cleanTeacherEmail && t.id === cleanTeacherEmail)
      );
      const targetTeacherId = matchedTutor?.publicTutorId || matchedTutor?.id || cleanTeacherEmail;

      if (!targetTeacherId && !cleanTeacherEmail) {
        alert(
          currentLanguage === 'en'
            ? 'Please select a valid Native Friend to purchase lessons.'
            : 'Por favor, selecione um Amigo Nativo válido para contratar aulas.'
        );
        return;
      }

      // Atomic backend transaction via Firebase Admin SDK
      const txResult = await purchasePackageWithTransaction({
        studentUid: stUid,
        studentEmail: cleanStEmail,
        teacherEmail: cleanTeacherEmail,
        teacherName: cleanTeacherName,
        teacherId: targetTeacherId,
        publicTutorId: matchedTutor?.publicTutorId || matchedTutor?.id,
        packageLessons: params.packageLessons,
      });

      if (!txResult.success) {
        console.error('Purchase transaction failed:', txResult.error);
        alert(
          currentLanguage === 'en'
            ? `Purchase transaction failed: ${txResult.error}`
            : `Falha na contratação do pacote: ${txResult.error}`
        );
        return;
      }

      const newCount = Number(txResult.contractedLessons || params.packageLessons);

      // Align weekly live lesson target with purchased frequency (4 -> 1x, 8 -> 2x, 12 -> 3x)
      let newWeeklyTarget = userProfile.weeklyNativeLessonsTarget || 1;
      if (params.packageLessons === 4) newWeeklyTarget = 1;
      else if (params.packageLessons === 8) newWeeklyTarget = 2;
      else if (params.packageLessons === 12) newWeeklyTarget = 3;

      const canonicalTeacherUid = txResult.teacherUid || txResult.profile?.teacherUid || (txResult as any)?.teacherUid || '';

      // Update userProfile with fixed teacher and updated lesson balance
      setUserProfile((prev) => ({
        ...prev,
        teacherEmail: cleanTeacherEmail,
        teacherName: cleanTeacherName,
        teacherUid: canonicalTeacherUid || prev.teacherUid,
        assignedNativeFriendUID: canonicalTeacherUid || prev.assignedNativeFriendUID,
        nativeFriendUID: canonicalTeacherUid || prev.nativeFriendUID,
        enrollmentStatus: 'active',
        contractedLessons: newCount,
        weeklyNativeLessonsTarget: newWeeklyTarget,
      }));

      // Update contractedLessons map
      setContractedLessons((prev) => ({
        ...prev,
        [currentAccount.email.toLowerCase()]: newCount,
      }));

      // Update students state list
      setStudents((prev) => {
        const cleanEmail = currentAccount.email.toLowerCase().trim();
        const exists = prev.some((st) => (st.email || st.studentEmail || '').toLowerCase().trim() === cleanEmail);
        if (exists) {
          return prev.map((st) =>
            (st.email || st.studentEmail || '').toLowerCase().trim() === cleanEmail
              ? {
                  ...st,
                  teacherEmail: cleanTeacherEmail,
                  teacherName: cleanTeacherName,
                  teacherUid: canonicalTeacherUid || (st as any).teacherUid,
                  contractedLessons: newCount,
                  weeklyNativeLessonsTarget: newWeeklyTarget,
                  status: 'active',
                }
              : st
          );
        }
        return [
          ...prev,
          {
            id: `st-${Date.now()}`,
            name: userProfile.name || currentAccount.name || cleanEmail.split('@')[0],
            studentName: userProfile.name || currentAccount.name || cleanEmail.split('@')[0],
            email: cleanEmail,
            studentEmail: cleanEmail,
            teacherEmail: cleanTeacherEmail,
            teacherName: cleanTeacherName,
            teacherUid: canonicalTeacherUid,
            contractedLessons: newCount,
            weeklyNativeLessonsTarget: newWeeklyTarget,
            status: 'active',
            level: userProfile.level || EnglishLevel.BEGINNER,
          },
        ];
      });

      // Notify student of successful fixed binding and purchase
      setNotifications((prev) => [
        {
          id: `purchase-${Date.now()}`,
          title: currentLanguage === 'en' ? 'Lesson Package Purchased!' : 'Pacote de Aulas Adquirido!',
          message:
            currentLanguage === 'en'
              ? `Congratulations! Package of ${params.packageLessons} lessons purchased. ${cleanTeacherName} is now your assigned Native Friend!`
              : `Parabéns! Pacote de ${params.packageLessons} aulas adquirido. ${cleanTeacherName} agora é seu Amigo Nativo fixo!`,
          type: 'success',
          timestamp: new Date().toISOString(),
          read: false,
        },
        ...prev,
      ]);

      return txResult;
    } catch (err) {
      console.error('Failed to purchase package:', err);
      throw err;
    }
  };

  // Handler: Change active account (teacher vs student)
  const handleSwitchAccount = (account: GoogleAccount) => {
    setCurrentAccount(account);
    setRoutinesByDay(defaultRoutinesByDay);
    if (account.role === 'student') {
      setUserProfile(createDefaultStudentProfile(account));
    } else {
      setUserProfile(createDefaultStudentProfile(null));
    }
  };

  // Handler: Add new Google account
  const handleAddAccount = (newAccount: GoogleAccount) => {
    setAvailableAccounts((prev) => [...prev, newAccount]);
    setCurrentAccount(newAccount);
    setRoutinesByDay(defaultRoutinesByDay);
    if (newAccount.role === 'student') {
      setUserProfile(createDefaultStudentProfile(newAccount));
    } else {
      setUserProfile(createDefaultStudentProfile(null));
    }
  };

  // Handler: Login Success from Auth Modal
  const handleLoginSuccess = (
    account: GoogleAccount,
    initialProfile?: Partial<UserProfile>,
    tutorData?: any
  ) => {
    const effectiveAuthUid = auth.currentUser?.uid || account.uid || account.id || initialProfile?.uid || initialProfile?.id || '';
    if (currentAccount && currentAccount.email.toLowerCase() !== account.email.toLowerCase()) {
      clearDictionaryMemoryCache();
      clearAllLocalPersistenceCaches();
    }
    const safeAccount: GoogleAccount = {
      ...account,
      uid: effectiveAuthUid || account.uid,
      id: effectiveAuthUid || account.id,
    };
    setCurrentAccount(safeAccount);
    if (!availableAccounts.some((a) => a.email.toLowerCase() === account.email.toLowerCase())) {
      setAvailableAccounts((prev) => [...prev, safeAccount]);
    }
    if (account.role === 'student') {
      const cleanPic =
        (initialProfile?.picture && initialProfile.picture.trim() !== '' ? initialProfile.picture : '') ||
        (initialProfile?.avatar && initialProfile.avatar.trim() !== '' ? initialProfile.avatar : '') ||
        (account.picture && account.picture.trim() !== '' ? account.picture : '') ||
        '';

      const freshProfile: UserProfile = {
        ...createDefaultStudentProfile(safeAccount),
        ...(initialProfile || {}),
        id: effectiveAuthUid || `usr-${account.email.replace(/[^a-zA-Z0-9]/g, '-')}`,
        uid: effectiveAuthUid || `usr-${account.email.replace(/[^a-zA-Z0-9]/g, '-')}`,
        name: initialProfile?.name || account.name || '',
        email: account.email,
        picture: cleanPic,
        avatar: cleanPic,
        level: initialProfile?.level || (initialProfile as any)?.englishLevel || (initialProfile as any)?.userLevel || EnglishLevel.BEGINNER,
        userLevel: initialProfile?.level || (initialProfile as any)?.englishLevel || (initialProfile as any)?.userLevel || EnglishLevel.BEGINNER,
        englishLevel: initialProfile?.level || (initialProfile as any)?.englishLevel || (initialProfile as any)?.userLevel || EnglishLevel.BEGINNER,
        learningGoal: initialProfile?.learningGoal || '',
        weeklyStudyDaysTarget: (initialProfile as any)?.weeklyStudyDaysTarget ?? 7,
        weeklyStudyDays: (initialProfile as any)?.weeklyStudyDays || ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
        routineVideoTime: (initialProfile as any)?.routineVideoTime || '09:00',
        routineAudioTime: (initialProfile as any)?.routineAudioTime || '14:00',
        dailyPhraseTime: (initialProfile as any)?.dailyPhraseTime || '20:00',
        teacherEmail: (initialProfile as any)?.teacherEmail || null,
        teacherName: (initialProfile as any)?.teacherName || null,
        contractedLessons: (initialProfile as any)?.contractedLessons ?? 1,
      };
      setUserProfile(freshProfile);

      // Pre-fetch Spotify tracks matching student level
      const normLevel = normalizeStudentLevel(freshProfile.level);
      fetchTracksForStudentLevel(normLevel).catch(() => {});
    } else {
      setUserProfile(createDefaultStudentProfile(null));
    }
    if (account.role === 'teacher') {
      if (tutorData) {
        const tEmailTarget = (tutorData.email || '').toLowerCase().trim();
        setTutors((prev) => {
          const next = prev.filter((t) => (t?.email ? t.email.toLowerCase().trim() !== tEmailTarget : true));
          return [...next, tutorData];
        });
      }
      fetch(`/api/user-profile?email=${encodeURIComponent(account.email)}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data?.tutor) {
            const dataTutorEmail = (data.tutor.email || '').toLowerCase().trim();
            setTutors((prev) => {
              const next = prev.filter((t) => (t?.email ? t.email.toLowerCase().trim() !== dataTutorEmail : true));
              return [...next, data.tutor];
            });
          }
        })
        .catch(() => {});
    }
    if (account.role === 'student') {
      setViewMode('dashboard');
      if (typeof window !== 'undefined') {
        try {
          window.history.replaceState({ page: 'dashboard' }, '', '/dashboard');
        } catch {}
      }
    } else if (account.role === 'teacher') {
      setViewMode('dashboard');
      if (typeof window !== 'undefined') {
        try {
          window.history.replaceState({ page: 'teacher' }, '', '/teacher');
        } catch {}
      }
    } else if (account.role === 'admin') {
      setViewMode('dashboard');
      setIsAdminApprovalsOpen(true);
      if (typeof window !== 'undefined') {
        try {
          window.history.replaceState({ page: 'admin' }, '', '/admin');
        } catch {}
      }
    } else {
      setViewMode('dashboard');
    }
  };

  // Handler: Logout
  const handleLogout = () => {
    try {
      firebaseSignOutAuth(auth).catch(() => {});
    } catch {}
    activeStudentUidRef.current = '';
    clearDictionaryMemoryCache();
    clearAllLocalPersistenceCaches();
    setCurrentAccount(null);
    setUserProfile(createDefaultStudentProfile(null));
    setStudentDictionaryEntries([]);
    setExcludedDictionaryWords([]);
    setLessons([]);
    setStudents([]);
    setNotifications([]);
    setViewMode('landing');
    if (typeof window !== 'undefined') {
      try {
        window.history.replaceState({}, '', '/');
      } catch {}
    }
  };

  // Handler: Update student English level
  const handleLevelChange = (newLevel: EnglishLevel) => {
    setUserProfile((prev) => ({ ...prev, level: newLevel }));
  };

  // Handler: Update contracted lessons
  const handleUpdateContractedLessons = async (studentEmail: string, count: number) => {
    setContractedLessons((prev) => ({ ...prev, [studentEmail.toLowerCase()]: count }));
    try {
      await fetch('/api/students/contract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: studentEmail, count }),
      });
    } catch {
      // local fallback
    }
  };

  // Handler: Save 5 learned words for an activity
  const handleSaveLearnedWords = async (activityId: string, words: string[]) => {
    setRoutinesByDay((prev) => {
      const updatedDayList = (prev[selectedDay] || []).map((item) => {
        if (item.id === activityId) {
          return { ...item, learnedWords: words };
        }
        return item;
      });
      return { ...prev, [selectedDay]: updatedDayList };
    });

    const currentAct = (routinesByDay[selectedDay] || []).find((a) => a.id === activityId);
    const actName = currentAct?.activityName || 'Daily Routine';
    const dictEntries: StudentDictionaryEntry[] = words
      .filter((w) => Boolean(w && w.trim()))
      .map((w) => {
        const cleanW = w.trim();
        const normKey = normalizeDictionaryWord(cleanW);
        const cached = getInstantOrCachedWord(cleanW, actName, userProfile?.level, userProfile?.uid, userProfile?.email, studentDictionaryEntries);
        const actVideoId = (currentAct as any)?.videoId || (currentAct as any)?.videoUrl;
        const actVideoTitle = (currentAct as any)?.title || actName;
        const todayIso = new Date().toISOString();

        return {
          id: `routine_${normKey.replace(/[^a-zA-Z0-9_-]/g, '_')}_${Date.now()}`,
          word: cleanW,
          originalWord: cleanW,
          normalizedWord: normKey,
          definitionEn: cached.definitionEn || '',
          exampleSentenceEn: cached.exampleSentenceEn || '',
          partOfSpeech: cached.partOfSpeech || '',
          translationPt: cached.translationPt || '',
          cefrLevel: cached.cefrLevel || 'B1',
          learnedAt: todayIso,
          source: 'routine',
          sourceActivityName: `${actName} (${selectedDay})`,
          sourceDay: selectedDay,
          origins: [
            {
              source: 'routine',
              activityName: `${actName} (${selectedDay})`,
              dayOfWeek: selectedDay,
              videoId: actVideoId,
              videoTitle: actVideoTitle,
              date: todayIso.slice(0, 10),
              context: `5 Words routine activity: "${actName}"`,
            },
          ],
          routineRef: {
            day: selectedDay,
            activityName: actName,
            activityId,
            videoId: actVideoId,
            videoTitle: actVideoTitle,
          },
        };
      });

    if (dictEntries.length > 0) {
      handleAddWordsToDictionary(dictEntries);

      // Asynchronously enrich any words that did not have cached definitions adhering to Native Friend Notes standard
      const wordsNeedingEnrichment = dictEntries.filter((e) => !e.definitionEn || e.definitionEn.trim().length === 0);
      if (wordsNeedingEnrichment.length > 0) {
        Promise.all(
          wordsNeedingEnrichment.map(async (entry) => {
            try {
              const enriched = await lookupWord(
                entry.word,
                entry.sourceActivityName,
                userProfile?.level,
                userProfile?.uid,
                userProfile?.email,
                studentDictionaryEntries
              );
              if (enriched && enriched.definitionEn) {
                return {
                  ...entry,
                  definitionEn: enriched.definitionEn,
                  exampleSentenceEn: enriched.exampleSentenceEn || entry.exampleSentenceEn,
                  partOfSpeech: enriched.partOfSpeech || entry.partOfSpeech,
                  translationPt: enriched.translationPt || entry.translationPt,
                  cefrLevel: enriched.cefrLevel || entry.cefrLevel,
                };
              }
            } catch {
              return null;
            }
            return null;
          })
        ).then((enrichedList) => {
          const validEnriched = enrichedList.filter(Boolean) as StudentDictionaryEntry[];
          if (validEnriched.length > 0) {
            handleAddWordsToDictionary(validEnriched);
          }
        });
      }
    }

    const activeEmail = currentAccount?.email || userProfile?.email;
    const effectiveStudentUid = userProfile?.id || (userProfile as any)?.uid || currentAccount?.uid;

    try {
      await fetch('/api/routines/words', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          day: selectedDay,
          activityId,
          words,
          studentEmail: activeEmail,
          studentUid: effectiveStudentUid,
        }),
      });
    } catch {
      // local fallback
    }
  };

  // Unified single source of truth for 100% automatic behavioral activity completion
  const handleBehavioralActivityComplete = useCallback(
    async (params: {
      type: 'video' | 'audio' | 'memorization' | 'live_lesson';
      dayOfWeek?: DayOfWeek;
      activityId?: string;
      video?: {
        videoId: string;
        videoTitle?: string;
        url?: string;
        duration?: string;
      };
      track?: {
        id: string;
        trackId?: string;
        title: string;
        artist?: string;
        coverUrl?: string;
        url?: string;
      };
      targetStudentUid?: string;
      targetStudentEmail?: string;
    }) => {
      const targetDay = params.dayOfWeek || selectedDay;
      const isTeacherCaller = currentAccount?.role === 'teacher' || currentAccount?.role === 'admin';

      let uid = params.targetStudentUid || '';
      let email = params.targetStudentEmail || '';

      if (!uid && isTeacherCaller && selectedStudentFilter && selectedStudentFilter !== 'all') {
        const found = studentsList.find(
          (s) =>
            Boolean(s) &&
            (((s.email || '').toLowerCase().trim() === (selectedStudentFilter || '').toLowerCase().trim()) ||
              s.uid === selectedStudentFilter ||
              s.id === selectedStudentFilter)
        );
        if (found) {
          uid = found.uid || found.id || '';
          email = email || found.email || selectedStudentFilter;
        }
      }

      if (!isTeacherCaller) {
        uid = uid || currentAccount?.uid || userProfile?.id || (userProfile as any)?.uid || '';
        email = email || currentAccount?.email || userProfile?.email || '';
      }

      const activeCycle = parseWeekCycleNumber(userProfile?.weeklyCycle) ?? 1;
      const activeWeekId = normalizeWeekId(userProfile?.weeklyCycle) || 'week-1';

      const stepMapping: Record<string, 'video_day' | 'audio_day' | 'memorization' | 'tutor_live'> = {
        video: 'video_day',
        audio: 'audio_day',
        memorization: 'memorization',
        live_lesson: 'tutor_live',
      };
      const stepId = stepMapping[params.type] || 'video_day';
      const checkKey = `${stepId}_${targetDay}`;
      const isAlreadyChecked = Boolean(weeklyChecks[checkKey]);
      const previousChecked = isAlreadyChecked;

      const isVideoRepeatAction = Boolean(
        params.type === 'video' &&
          (Boolean((params as any).isRepeat) ||
            Boolean((params as any).isRepeatVideo) ||
            Boolean((params.video as any)?.isRepeat) ||
            Boolean((params.video as any)?.isRepeatVideo) ||
            (params.video as any)?.playlistId === 'repeat_previous_video' ||
            params.video?.videoTitle?.toLowerCase().includes('repeat previous video') ||
            params.video?.videoTitle?.toLowerCase().includes('repetir vídeo anterior') ||
            params.video?.videoTitle?.toLowerCase().includes('repetir video anterior'))
      );

      // 1. Update S-Path (Gráfico S) in React state & direct Firestore users/{studentUID} persistence
      // S-Path rule: Ensure that when an activity is completed for any respective day of the week,
      // it is marked and maintained in the S-Path tracker until the student explicitly starts a new week.
      setWeeklyChecks((prev) => {
        if (prev[checkKey]) return prev;
        return { ...prev, [checkKey]: true };
      });

      const targetDate = getDateForDayInCurrentWeek(targetDay);
      const journalType = mapStepIdToJournalType(params.type);
      const journalItemId =
        params.type === 'video'
          ? (params.video?.videoId || params.video?.url || `video_${targetDay}_${Date.now()}`)
          : params.type === 'audio'
          ? (params.track?.id || params.track?.trackId || `audio_${targetDay}_${Date.now()}`)
          : `${params.type}_${targetDay}_${Date.now()}`;

      if (uid) {
        recordActivityInStudentJournal(
          uid,
          {
            id: journalItemId,
            type: journalType,
            date: targetDate,
            dayOfWeek: targetDay,
            week: activeCycle,
            timestamp: Date.now(),
            title: params.type === 'video' ? params.video?.videoTitle : params.type === 'audio' ? params.track?.title : undefined,
            artist: params.track?.artist,
            url: params.video?.url || params.track?.url,
            isRepeat: isVideoRepeatAction,
            isRepeatVideo: isVideoRepeatAction,
          },
          email
        ).then((res) => {
          if (res.updatedJournal) {
            setStudentJournal(res.updatedJournal);
          }
        });

        if (!isAlreadyChecked) {
          saveStudentWeeklyChecksToFirestore(
            uid,
            { [checkKey]: true },
            email,
            userProfile?.weeklyNativeLessonsTarget,
            userProfile?.weeklyStudyDaysTarget,
            activeCycle
          ).then((success) => {
            const currentCycle = parseWeekCycleNumber(userProfile?.weeklyCycle);
            if (currentCycle !== activeCycle) return;
            if (!success) {
              setWeeklyChecks((prev) => ({
                ...prev,
                [checkKey]: previousChecked,
              }));
            }
          }).catch(() => {
            const currentCycle = parseWeekCycleNumber(userProfile?.weeklyCycle);
            if (currentCycle === activeCycle) {
              setWeeklyChecks((prev) => ({
                ...prev,
                [checkKey]: previousChecked,
              }));
            }
          });

          // Routines subcollection update for daily routine tracking
          const db = getDb();
          if (db && uid) {
            setDoc(
              doc(db, 'users', uid, 'routines', targetDay),
              {
                completedToday: true,
                completed: true,
                updatedAt: new Date().toISOString(),
              },
              { merge: true }
            ).catch(() => {});
          }
        }
      }

      // 2. Update routine item state to completedToday = true
      setRoutinesByDay((prev) => {
        const dayList = prev[targetDay] || [];
        let matched = false;
        const updated = dayList.map((item) => {
          const actName = (item.activityName || '').toLowerCase();
          const isTarget =
            params.activityId === item.id ||
            (params.type === 'video' &&
              ((item.teacherVideos && item.teacherVideos.length > 0) ||
                actName.includes('video') ||
                actName.includes('vídeo') ||
                item.id.endsWith('1'))) ||
            (params.type === 'audio' &&
              (Boolean(item.teacherSpotify) ||
                actName.includes('audio') ||
                actName.includes('áudio') ||
                actName.includes('som') ||
                actName.includes('ouvir') ||
                item.id.endsWith('2')));

          if (isTarget && !matched) {
            matched = true;
            return { ...item, completedToday: true, completed: true };
          }
          return item;
        });
        return { ...prev, [targetDay]: updated };
      });

      // 3. Activity History, Exclusivity & Native Friend Database Feeding
      const currentWeekId = activeWeekId;
      const teacherUid = userProfile?.assignedNativeFriendUID || userProfile?.nativeFriendUID || '';

      if (params.type === 'video') {
        const rawVid = params.video?.videoId || params.video?.url || '';
        const cleanVid = extractYouTubeVideoId(rawVid) || rawVid.trim();
        const cleanTitle = (params.video?.videoTitle || 'Daily Video Practice').trim();

        if (cleanVid && uid) {
          // A. Persist to users/{studentUID}/watchedVideosHistory
          await addVideoToWatchedHistoryInFirestore(uid, cleanVid, cleanTitle);

          // B. Persist to weekly consumed videos users/{studentUID}/weeklyHistory/{weekId}
          await recordConsumedVideo(
            uid,
            currentWeekId,
            {
              id: cleanVid,
              videoId: cleanVid,
              videoTitle: cleanTitle,
              title: cleanTitle,
              watchedAt: new Date().toISOString(),
              dayOfWeek: targetDay,
              url: params.video?.url || getYouTubeWatchUrl(cleanVid),
              duration: params.video?.duration || '5-10 min',
            },
            teacherUid
          );

          // C. Update in-memory userProfile for 100% exclusivity rule
          setUserProfile((prev) => {
            if (!prev) return prev;
            const currentWatched = prev.watchedVideosHistory || [];
            if (currentWatched.includes(cleanVid)) return prev;
            return {
              ...prev,
              watchedVideosHistory: [...currentWatched, cleanVid],
            };
          });
        }
      } else if (params.type === 'audio') {
        const rawTrackId = params.track?.id || params.track?.trackId || '';
        const cleanTrackId = rawTrackId.trim();
        const cleanTitle = (params.track?.title || 'Daily Spotify Listening').trim();
        const cleanArtist = (params.track?.artist || 'Spotify Artist').trim();

        if (cleanTrackId && uid) {
          // A. Persist to users/{studentUID}/listenedTracksHistory
          await addTrackToListenedHistoryInFirestore(uid, cleanTrackId, cleanTitle, cleanArtist);

          // B. Persist to weekly consumed tracks users/{studentUID}/weeklyHistory/{weekId}
          await recordConsumedTrack(
            uid,
            currentWeekId,
            {
              id: cleanTrackId,
              trackId: cleanTrackId,
              title: cleanTitle,
              artist: cleanArtist,
              coverUrl: params.track?.coverUrl || '',
              dayOfWeek: targetDay,
              listenedAt: new Date().toISOString(),
              url: params.track?.url || '',
            },
            teacherUid
          );

          // C. Update in-memory userProfile for listened tracks history
          setUserProfile((prev) => {
            if (!prev) return prev;
            const currentListened = prev.listenedTracksHistory || [];
            const exists = currentListened.some((t: any) =>
              typeof t === 'string' ? t === cleanTrackId : t?.trackId === cleanTrackId || t?.id === cleanTrackId
            );
            if (exists) return prev;
            return {
              ...prev,
              listenedTracksHistory: [
                ...currentListened,
                { trackId: cleanTrackId, id: cleanTrackId, title: cleanTitle, artist: cleanArtist },
              ],
            };
          });
        }
      }

      // 4. Backend synchronization mirror
      try {
        fetch('/api/routines/toggle', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            day: targetDay,
            activityId: params.activityId || (params.type === 'video' ? 'act-1' : 'act-2'),
            studentEmail: email,
            studentUid: uid,
            videoId: params.video?.videoId || null,
          }),
        }).catch(() => {});
      } catch {}

      // 5. Success notification (only if newly completed)
      if (!isAlreadyChecked) {
        const stepLabels: Record<string, { en: string; pt: string }> = {
          video_day: { en: 'Daily Video', pt: 'Vídeo do Dia' },
          audio_day: { en: 'Daily Audio', pt: 'Áudio do Dia' },
          memorization: { en: 'Daily Memorization Activity', pt: 'Atividade de Memorização do Dia' },
          tutor_live: { en: 'Live Lesson with Native Friend', pt: 'Aula com Amigo Nativo' },
        };
        const dayLabels: Record<DayOfWeek, { en: string; pt: string }> = {
          monday: { en: 'Monday', pt: 'Segunda-feira' },
          tuesday: { en: 'Tuesday', pt: 'Terça-feira' },
          wednesday: { en: 'Wednesday', pt: 'Quarta-feira' },
          thursday: { en: 'Thursday', pt: 'Quinta-feira' },
          friday: { en: 'Friday', pt: 'Sexta-feira' },
          saturday: { en: 'Saturday', pt: 'Sábado' },
          sunday: { en: 'Sunday', pt: 'Domingo' },
        };

        setNotifications((prev) => [
          {
            id: `behavioral-comp-${Date.now()}`,
            title: currentLanguage === 'en' ? '✨ Activity Completed!' : '✨ Atividade Concluída!',
            message:
              currentLanguage === 'en'
                ? `${stepLabels[stepId]?.en || stepId} registered automatically for ${dayLabels[targetDay]?.en || targetDay} on your S-Path and Activity History.`
                : `${stepLabels[stepId]?.pt || stepId} registrado automaticamente para ${dayLabels[targetDay]?.pt || targetDay} no seu Gráfico S e Histórico de Atividades.`,
            type: 'success',
            timestamp: new Date().toISOString(),
            read: false,
          },
          ...prev,
        ]);
      }
    },
    [selectedDay, currentAccount?.uid, currentAccount?.email, userProfile, weeklyChecks, currentLanguage]
  );

  // Handler: Update S-Path (Gráfico S) check for a pillar with instant UI reflection & Firestore users/{studentUID} persistence
  const handleUpdateSPathCheck = useCallback(
    (
      stepId: 'video_day' | 'audio_day' | 'memorization' | 'tutor_live',
      dayKey: DayOfWeek,
      isCompleted: boolean = true,
      targetUid?: string,
      targetEmail?: string
    ) => {
      const uid = targetUid || currentAccount?.uid || userProfile?.id || '';
      const email = targetEmail || currentAccount?.email || userProfile?.email || '';

      const activeCycle = parseWeekCycleNumber(userProfile?.weeklyCycle) ?? 1;
      const activeWeekId = normalizeWeekId(userProfile?.weeklyCycle) || 'week-1';

      if (isCompleted && (stepId === 'video_day' || stepId === 'audio_day')) {
        handleBehavioralActivityComplete({
          type: stepId === 'video_day' ? 'video' : 'audio',
          dayOfWeek: dayKey,
          targetStudentUid: uid,
          targetStudentEmail: email,
        });
        return;
      }

      if (!isCompleted && (stepId === 'video_day' || stepId === 'audio_day')) {
        setRoutinesByDay((prev) => {
          const dayList = prev[dayKey] || [];
          const updated = dayList.map((item) => {
            const actName = (item.activityName || '').toLowerCase();
            const isTarget =
              (stepId === 'video_day' &&
                ((item.teacherVideos && item.teacherVideos.length > 0) ||
                  actName.includes('video') ||
                  actName.includes('vídeo') ||
                  item.id.endsWith('1'))) ||
              (stepId === 'audio_day' &&
                (Boolean(item.teacherSpotify) ||
                  actName.includes('audio') ||
                  actName.includes('áudio') ||
                  actName.includes('som') ||
                  actName.includes('ouvir') ||
                  item.id.endsWith('2')));
            if (isTarget) {
              return { ...item, completedToday: false, completed: false };
            }
            return item;
          });
          return { ...prev, [dayKey]: updated };
        });
      }

      const checkKey = `${stepId}_${dayKey}`;
      const previousChecked = Boolean(weeklyChecks[checkKey]);
      if (previousChecked === isCompleted) return;

      setWeeklyChecks((prev) => ({ ...prev, [checkKey]: isCompleted }));

      if (stepId === 'memorization') {
        setWeeklyHomework((prev) => {
          if (!prev) return prev;
          const currentParts = prev.completedPartsByDay || {};
          if (currentParts[dayKey] === isCompleted) return prev;
          const updatedParts = { ...currentParts, [dayKey]: isCompleted };
          const updatedHw = {
            ...prev,
            isDayPartCompleted: isCompleted,
            completedPartsByDay: updatedParts,
          };
          if (uid || email) {
            saveStudentHomeworkProgressToFirestore(uid, email, updatedHw, activeWeekId);
          }
          return updatedHw;
        });
      }

      if (uid) {
        const targetType = mapStepIdToJournalType(stepId);
        const targetDate = getDateForDayInCurrentWeek(dayKey);

        if (isCompleted) {
          recordActivityInStudentJournal(
            uid,
            {
              id: `${stepId}_${dayKey}_${activeCycle}_${Date.now()}`,
              type: targetType,
              date: targetDate,
              dayOfWeek: dayKey,
              week: activeCycle,
              timestamp: Date.now(),
              title: stepId === 'tutor_live' ? 'Live Session with Native Friend' : stepId === 'memorization' ? 'Weekly Memorization Activity' : undefined,
            },
            email
          ).then((res) => {
            if (res.updatedJournal) setStudentJournal(res.updatedJournal);
          });
        } else {
          removeActivityFromStudentJournal(
            uid,
            targetType,
            dayKey,
            activeCycle,
            email
          ).then((res) => {
            if (res.updatedJournal) setStudentJournal(res.updatedJournal);
          });
        }

        saveStudentWeeklyChecksToFirestore(
          uid,
          { [checkKey]: isCompleted },
          email,
          userProfile?.weeklyNativeLessonsTarget,
          userProfile?.weeklyStudyDaysTarget,
          activeCycle
        ).then((success) => {
          const curCycle = parseWeekCycleNumber(userProfile?.weeklyCycle);
          if (curCycle !== activeCycle) return;
          if (!success) {
            setWeeklyChecks((prev) => ({
              ...prev,
              [checkKey]: previousChecked,
            }));
          }
        }).catch(() => {
          const curCycle = parseWeekCycleNumber(userProfile?.weeklyCycle);
          if (curCycle === activeCycle) {
            setWeeklyChecks((prev) => ({
              ...prev,
              [checkKey]: previousChecked,
            }));
          }
        });
      }

      // Feedback toast/notification for student
      if (isCompleted) {
        const stepLabels: Record<string, { en: string; pt: string }> = {
          video_day: { en: 'Daily Video', pt: 'Vídeo do Dia' },
          audio_day: { en: 'Daily Audio', pt: 'Áudio do Dia' },
          memorization: { en: 'Daily Memorization Activity', pt: 'Atividade de Memorização do Dia' },
          tutor_live: { en: 'Live Lesson with Native Friend', pt: 'Aula com Amigo Nativo' },
        };
        const dayLabels: Record<DayOfWeek, { en: string; pt: string }> = {
          monday: { en: 'Monday', pt: 'Segunda-feira' },
          tuesday: { en: 'Tuesday', pt: 'Terça-feira' },
          wednesday: { en: 'Wednesday', pt: 'Quarta-feira' },
          thursday: { en: 'Thursday', pt: 'Quinta-feira' },
          friday: { en: 'Friday', pt: 'Sexta-feira' },
          saturday: { en: 'Saturday', pt: 'Sábado' },
          sunday: { en: 'Sunday', pt: 'Domingo' },
        };

        setNotifications((prev) => [
          {
            id: `toast-spath-${Date.now()}`,
            title: currentLanguage === 'en' ? '🎉 S-Path Updated!' : '🎉 Gráfico S Atualizado!',
            message:
              currentLanguage === 'en'
                ? `${stepLabels[stepId]?.en || stepId} marked as completed for ${dayLabels[dayKey]?.en || dayKey} on your S-Path.`
                : `${stepLabels[stepId]?.pt || stepId} marcado como concluído para ${dayLabels[dayKey]?.pt || dayKey} no seu Gráfico S.`,
            type: 'success',
            timestamp: new Date().toISOString(),
            read: false,
          },
          ...prev,
        ]);
      }
    },
    [currentAccount?.uid, currentAccount?.email, userProfile?.id, userProfile?.email, userProfile?.weeklyNativeLessonsTarget, userProfile?.weeklyStudyDaysTarget, currentLanguage, handleBehavioralActivityComplete]
  );

  // Phase 1B: Track completed daily memorization activity per cycle day to prevent duplicate increments
  const completedMemorizationDaysRef = useRef<Set<string>>(new Set());

  const handleMarkDailyMemorizationPracticed = useCallback(
    async (day: DayOfWeek, wordsUsed: string[]) => {
      const studentUid = currentAccount?.uid || userProfile?.id || (userProfile as any)?.uid || '';
      const studentEmail = currentAccount?.email || userProfile?.email || '';
      const activeCycle = parseWeekCycleNumber(userProfile?.weeklyCycle);
      if (activeCycle === null) return;
      const sessionKey = `${day}_${activeCycle}`;

      const persistedCheckKey = `memorization_${day}`;

      if (
      completedMemorizationDaysRef.current.has(sessionKey) ||
      weeklyChecks[persistedCheckKey] === true
      ) {
      return;
      }

      completedMemorizationDaysRef.current.add(sessionKey);

      if (!studentUid && !studentEmail) return;
      if (!wordsUsed || wordsUsed.length === 0) return;

      try {
        const updatedVocab = await markVocabularyWordsPracticedInFirestore(
          studentUid,
          wordsUsed,
          studentEmail
        );
        if (Array.isArray(updatedVocab) && updatedVocab.length > 0) {
          setStudentDictionaryEntries(updatedVocab);
        }
      } catch (err) {
        console.warn('Failed to mark daily memorization words practiced:', err);
      }
    },
[currentAccount?.uid, userProfile?.id, currentAccount?.email, userProfile?.email, userProfile?.weeklyCycle, weeklyChecks]  );

  // Handler: Toggle activity completed status
  const handleToggleActivityComplete = async (activityId: string) => {
    let nowCompleted = false;
    let videoIdToArchive: string | null = null;
    let currentActivity: RoutineItem | undefined;

    setRoutinesByDay((prev) => {
      const updatedDayList = (prev[selectedDay] || []).map((item) => {
        if (item.id === activityId) {
          currentActivity = item;
          nowCompleted = !item.completedToday;
          if (nowCompleted) {
            const v = item.teacherVideos?.[0];
            if (v && (v.videoId || v.url)) {
              videoIdToArchive = extractYouTubeVideoId(v.videoId || v.url || '') || v.videoId || null;
            }
          }
          return { ...item, completedToday: nowCompleted, completed: nowCompleted };
        }
        return item;
      });
      return { ...prev, [selectedDay]: updatedDayList };
    });

    const studentUid = currentAccount?.uid || userProfile?.id || '';
    const studentEmail = currentAccount?.email || userProfile?.email || '';

    // Requirement 2: Guarantee that upon completing a video activity, the video ID is persistently added to watchedVideosHistory
    if (nowCompleted && videoIdToArchive && studentUid) {
      addVideoToWatchedHistoryInFirestore(studentUid, videoIdToArchive).catch(() => {});
    }

    // Automatic S-Path (Gráfico S) marking based on activity type
    const actName = (currentActivity?.activityName || '').toLowerCase();
    const isVideoActivity = Boolean(
      (currentActivity?.teacherVideos && currentActivity.teacherVideos.length > 0) ||
      actName.includes('video') ||
      actName.includes('vídeo') ||
      actName.includes('assistir') ||
      actName.includes('watch') ||
      activityId.endsWith('1')
    );

    const isAudioActivity = Boolean(
      currentActivity?.teacherSpotify ||
      actName.includes('áudio') ||
      actName.includes('audio') ||
      actName.includes('som') ||
      actName.includes('ouvir') ||
      actName.includes('listen') ||
      actName.includes('podcast') ||
      actName.includes('música') ||
      actName.includes('music') ||
      activityId.endsWith('2')
    );

    if (isVideoActivity) {
      handleUpdateSPathCheck('video_day', selectedDay, nowCompleted);
    }
    if (isAudioActivity) {
      handleUpdateSPathCheck('audio_day', selectedDay, nowCompleted);
    }

    // Direct atomic write to Firestore routines subcollection
    const db = getDb();
    if (db && studentUid) {
      setDoc(
        doc(db, 'users', studentUid, 'routines', selectedDay),
        {
          completedToday: nowCompleted,
          completed: nowCompleted,
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      ).catch(() => {});
    }

    try {
      await fetch('/api/routines/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          day: selectedDay,
          activityId,
          studentEmail,
          studentUid,
          videoId: videoIdToArchive,
        }),
      });
    } catch {
      // local fallback
    }
  };

  // Handler: Start New Week (Rotates assignments, moves consumed to history, increments weeklyCycle, resets week checks)
  const handleStartNewWeek = useCallback(async (studyDaysTarget?: number, selectedDays?: DayOfWeek[]) => {
    setIsStartingNewWeek(true);
    const studentEmail = currentAccount?.email || userProfile?.email || '';
    const uid = currentAccount?.uid || userProfile?.id || (userProfile as any)?.uid || '';
    const targetDays = studyDaysTarget || userProfile?.weeklyStudyDaysTarget || 7;
    const chosenDays = selectedDays || userProfile?.weeklyStudyDays || ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

    try {
      const result = await executeStartNewWeek({
        studentEmail,
        studentUid: uid,
        weeklyStudyDaysTarget: targetDays,
        weeklyStudyDays: chosenDays,
        currentCycle: userProfile?.weeklyCycle || 1,
        studentLevel: userProfile?.level || (userProfile as any)?.englishLevel || 'intermediate',
        currentRoutines: routinesByDay,
      });

      if (result && result.success) {
        if (result.routines) {
          const vidTime = userProfile?.routineVideoTime;
          const audTime = userProfile?.routineAudioTime;
          const finalRoutines = applyProfileTimesToRoutines(result.routines, vidTime, audTime);
          setRoutinesByDay(finalRoutines);
        }

        const effectiveCycle = result.weeklyCycle;
        const effectiveStudyTarget = result.weeklyStudyDaysTarget;
        const effectiveStudyDays = result.weeklyStudyDays;

        setUserProfile((prev) => ({
          ...prev,
          weeklyCycle: effectiveCycle,
          weeklyStudyDaysTarget: effectiveStudyTarget,
          weeklyStudyDays: effectiveStudyDays,
        }));

        // Reset S-Path checks for the new week in memory and Firestore users/{studentUID}
        setWeeklyChecks({});
        saveStudentWeeklyChecksToFirestore(
          uid,
          {},
          studentEmail,
          userProfile?.weeklyNativeLessonsTarget || 1,
          effectiveStudyTarget,
          effectiveCycle
        );

        // Persist weekly checks and study targets via weekly-checks endpoint as well
        const effectiveWeekId = normalizeWeekId(effectiveCycle);
        if (effectiveCycle && effectiveWeekId) {
          getAccessToken().then((token) => {
            if (!token) return;
            const canonicalUid = auth.currentUser?.uid || (isValidCanonicalUid(uid) ? uid : '');
            if (!canonicalUid && !studentEmail) return;

            const currentAuthEmail = (auth?.currentUser?.email || '').toLowerCase().trim();
            const safeEmail = (studentEmail && (!currentAuthEmail || currentAuthEmail === studentEmail.toLowerCase().trim())) ? studentEmail : undefined;

            fetch('/api/routines/weekly-checks', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({
                ...(canonicalUid ? { studentUid: canonicalUid } : {}),
                ...(safeEmail ? { studentEmail: safeEmail } : {}),
                checks: {},
                weekId: effectiveWeekId,
                weeklyCycle: effectiveCycle,
                weeklyNativeLessonsTarget: userProfile?.weeklyNativeLessonsTarget || 1,
                weeklyStudyDaysTarget: effectiveStudyTarget,
                weeklyStudyDays: effectiveStudyDays,
              }),
            }).catch(() => {});
          }).catch(() => {});
        }

        // Automatic positioning on Today if in active study plan, otherwise first active study day
        const today = getTodayDayOfWeek();
        const effectiveDay = chosenDays.includes(today) ? today : (chosenDays[0] || 'monday');
        setSelectedDay(effectiveDay);
        if (result.routines && result.routines[effectiveDay] && result.routines[effectiveDay].length > 0) {
          setSelectedActivityId(result.routines[effectiveDay][0].id);
        }

        setNotifications((prev) => [
          {
            id: `new-week-${Date.now()}`,
            title: currentLanguage === 'en'
              ? `🎉 Week ${effectiveCycle} Started!`
              : `🎉 Semana ${effectiveCycle} Iniciada!`,
            message: currentLanguage === 'en'
              ? `Study goal calibrated to ${effectiveStudyTarget} days/week. Fresh curated YouTube videos and Spotify audios have been assigned.`
              : `Meta de estudos calibrada para ${effectiveStudyTarget} dias/semana. Novos vídeos do YouTube e áudios do Spotify foram atribuídos.`,
            type: 'success',
            timestamp: new Date().toISOString(),
            read: false,
          },
          ...prev,
        ]);
        return true;
      }
    } catch (err) {
      console.warn('Could not start new week:', err);
    } finally {
      setIsStartingNewWeek(false);
    }
    return false;
  }, [currentAccount?.email, currentAccount?.uid, userProfile?.email, userProfile?.id, (userProfile as any)?.uid, userProfile?.routineVideoTime, userProfile?.routineAudioTime, userProfile?.weeklyCycle, userProfile?.weeklyStudyDaysTarget, userProfile?.weeklyStudyDays, userProfile?.weeklyNativeLessonsTarget, routinesByDay, currentLanguage]);

  // Handler: Teacher saves video & Spotify for activity
  const handleTeacherSaveVideos = async (
    activityId: string,
    videos: TeacherAssignedVideo[],
    teacherNotes?: string,
    replicateToAllDays = false,
    targetDays?: DayOfWeek[],
    spotify?: TeacherAssignedSpotify | null,
    targetStudentEmail?: string,
    targetStudentUid?: string,
    activityName?: string
  ) => {
    const daysToUpdate: DayOfWeek[] = replicateToAllDays
      ? ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
      : targetDays && targetDays.length > 0
      ? targetDays
      : [selectedDay];

    const studentEmailToUse =
      targetStudentEmail ||
      (selectedStudentFilter !== 'all' ? selectedStudentFilter : '') ||
      (currentAccount?.role === 'student' ? currentAccount.email : '');

    const selectedSt = studentsList.find(
      (s) =>
        (studentEmailToUse && s.email?.toLowerCase() === studentEmailToUse.toLowerCase()) ||
        s.uid === studentEmailToUse ||
        s.id === studentEmailToUse
    );
    const studentUidToUse = targetStudentUid || selectedSt?.uid || selectedSt?.id || '';
    const resolvedTopic = activityName || videos?.[0]?.playlistTitle;

    setRoutinesByDay((prev) => {
      const updated = { ...prev };
      daysToUpdate.forEach((d) => {
        let matched = false;
        updated[d] = (updated[d] || []).map((item) => {
          const isTarget =
            item.id === activityId ||
            (item.teacherVideos && item.teacherVideos.length > 0) ||
            item.id.endsWith('1') ||
            item.activityName?.toLowerCase().includes('vídeo') ||
            item.activityName?.toLowerCase().includes('video') ||
            item.activityName === currentActivity?.activityName;
          if (isTarget && !matched) {
            matched = true;
            return {
              ...item,
              activityName: resolvedTopic || item.activityName,
              teacherVideos: videos,
              teacherNotes: teacherNotes || item.teacherNotes,
              ...(spotify !== undefined ? { teacherSpotify: spotify || undefined } : {}),
            };
          }
          return item;
        });
        if (!matched && updated[d] && updated[d].length > 0) {
          updated[d][0] = {
            ...updated[d][0],
            activityName: resolvedTopic || updated[d][0].activityName,
            teacherVideos: videos,
            teacherNotes: teacherNotes || updated[d][0].teacherNotes,
            ...(spotify !== undefined ? { teacherSpotify: spotify || undefined } : {}),
          };
        }
      });
      return updated;
    });

    try {
      await fetch('/api/routines/teacher-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentEmail: studentEmailToUse,
          studentUid: studentUidToUse,
          teacherUid: currentAccount?.uid,
          teacherEmail: currentAccount?.email,
          activityId,
          activityName: resolvedTopic,
          playlistTitle: resolvedTopic,
          videos,
          teacherNotes,
          days: daysToUpdate,
        }),
      });

      if (spotify !== undefined) {
        await fetch('/api/routines/teacher-spotify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            studentEmail: studentEmailToUse,
            studentUid: studentUidToUse,
            teacherUid: currentAccount?.uid,
            teacherEmail: currentAccount?.email,
            activityId,
            spotify,
            teacherNotes,
            days: daysToUpdate,
          }),
        });
      }
    } catch {
      // local fallback
    }
  };

  // Handler: Add custom activity to day's routine
  const handleAddCustomActivity = (newActivity: Omit<RoutineItem, 'id'>) => {
    const newItem: RoutineItem = {
      ...newActivity,
      id: `act-${Date.now()}`,
    };

    setRoutinesByDay((prev) => ({
      ...prev,
      [selectedDay]: [...(prev[selectedDay] || []), newItem],
    }));
    setSelectedActivityId(newItem.id);
  };

  // Handler: Assign video from playlist topic to activity
  const handleAssignVideoToActivity = (activityId: string, video: TeacherAssignedVideo, day: DayOfWeek) => {
    const playlistTopic = (video as any).playlistTitle;
    setRoutinesByDay((prev) => {
      const updated = { ...prev };
      updated[day] = (updated[day] || []).map((item) => {
        if (item.id === activityId) {
          return {
            ...item,
            activityName: playlistTopic || item.activityName,
            teacherVideos: [video],
            teacherNotes: video.instructions || item.teacherNotes,
          };
        }
        return item;
      });
      return updated;
    });

    const activeEmail = currentAccount?.email || userProfile?.email;
    const activeUid = currentAccount?.uid || (currentAccount as any)?.id || userProfile?.id;
    if (activeEmail || activeUid) {
      fetch('/api/routines/teacher-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          activityId,
          activityName: playlistTopic,
          playlistTitle: playlistTopic,
          videos: [video],
          teacherNotes: video.instructions,
          days: [day],
          day,
          studentEmail: activeEmail,
          studentUid: activeUid,
        }),
      }).catch(() => {});
    }
  };

  // Handler: Schedule new Live Lesson
  const handleScheduleLesson = async (lessonData: {
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
  }) => {
    const currentUser = auth.currentUser;
    if (!currentUser) {
      alert(
        currentLanguage === 'en'
          ? 'Authentication required. Please sign in to schedule your lesson.'
          : 'Autenticação necessária. Por favor, conecte-se para agendar sua aula.'
      );
      setIsAuthModalOpen(true);
      return;
    }

    const finalStudentEmail = (lessonData.studentEmail && lessonData.studentEmail.trim() !== '')
      ? lessonData.studentEmail.trim().toLowerCase()
      : (currentUser.email ? currentUser.email.toLowerCase().trim() : (userProfile?.email ? userProfile.email.toLowerCase().trim() : ''));

    const finalStudentName = (lessonData.studentName && lessonData.studentName.trim() !== '')
      ? lessonData.studentName.trim()
      : (currentUser.displayName || userProfile?.name || 'Aluno');

    const finalStudentUid = (currentUser?.uid || lessonData.studentUid || userProfile?.uid || userProfile?.id || '').trim();

    const cleanTeacherEmail = (lessonData.teacherEmail || '').toLowerCase().trim();
    const cleanTeacherUid = (lessonData.teacherUid || '').trim();
    const matchedTutor = tutors.find((t) =>
      (cleanTeacherUid && (t.id === cleanTeacherUid || t.uid === cleanTeacherUid || t.publicTutorId === cleanTeacherUid)) ||
      (cleanTeacherEmail && (t.email || '').toLowerCase().trim() === cleanTeacherEmail) ||
      (cleanTeacherEmail && t.id === cleanTeacherEmail)
    );

    const targetTeacherId = cleanTeacherUid || matchedTutor?.publicTutorId || matchedTutor?.id || cleanTeacherEmail || teacherEmailForConfig;
    const finalTeacherUid = targetTeacherId;

    if (!targetTeacherId) {
      alert(
        currentLanguage === 'en'
          ? 'Please select a valid Native Friend to schedule your lesson.'
          : 'Por favor, selecione um Amigo Nativo válido para agendar sua aula.'
      );
      return;
    }

    const isTrialBooking = Boolean((scheduleStudentInfo as any)?.isTrialLesson || userProfile?.subscriptionType === 'trial');
    const deterministicId = `lesson-${currentUser.uid}-${new Date(lessonData.startDateTime).getTime()}`;

    const newLesson: LiveLesson = {
      id: deterministicId,
      title: lessonData.title || (isTrialBooking ? 'Aula Experimental Ao Vivo' : 'Aula Ao Vivo 1-on-1'),
      description: lessonData.description || '',
      startDateTime: lessonData.startDateTime,
      endDateTime: lessonData.endDateTime,
      studentEmail: finalStudentEmail,
      studentName: finalStudentName,
      studentUid: currentUser.uid,
      teacherEmail: cleanTeacherEmail || (matchedTutor?.email || ''),
      teacherName: lessonData.teacherName || matchedTutor?.name || 'Native Friend',
      teacherUid: targetTeacherId,
      meetLink: lessonData.meetLink || matchedTutor?.meetUrl || matchedTutor?.meetLink || '',
      status: 'scheduled',
      isTrialLesson: isTrialBooking,
      createdAt: new Date().toISOString(),
    };

    // Direct backend atomic transaction: verified via Firebase Admin SDK
    const txResult = await scheduleLessonWithTransaction({
      lesson: newLesson,
      isTrialLesson: isTrialBooking,
    });

    if (!txResult.success) {
      console.error('Atomic lesson transaction failed:', txResult.error);
      alert(
        currentLanguage === 'en'
          ? `Scheduling failed: ${txResult.error}`
          : `Falha no agendamento: ${txResult.error}`
      );
      return;
    }

    // Success path: Add confirmed lesson to state and apply balances
    const confirmedLesson = txResult.lesson || newLesson;
    setLessons((prev) => {
      const exists = prev.some((l) => l.id === confirmedLesson.id);
      return exists ? prev : [confirmedLesson, ...prev];
    });

    if (txResult.remainingLessons !== undefined) {
      setUserProfile((prev) => ({
        ...prev,
        availableLessons: txResult.remainingLessons,
        contractedLessons: txResult.contractedLessons ?? prev.contractedLessons,
        hasCompletedTrialLesson: prev.hasCompletedTrialLesson,
        onboardingCompleted: isTrialBooking ? true : prev.onboardingCompleted,
        teacherUid: confirmedLesson.teacherUid || prev.teacherUid,
        teacherEmail: confirmedLesson.teacherEmail || prev.teacherEmail,
        teacherName: confirmedLesson.teacherName || prev.teacherName,
        teacherMeetUrl: confirmedLesson.meetLink || prev.teacherMeetUrl,
      }));
    }

    // Update students state so student appears immediately in teacher's filter and list
    setStudents((prev) => {
      const cleanEmail = finalStudentEmail;
      const exists = prev.some((s) => (s.email || s.studentEmail || '').toLowerCase().trim() === cleanEmail);
      if (exists) {
        return prev.map((s) =>
          (s.email || s.studentEmail || '').toLowerCase().trim() === cleanEmail
            ? { ...s, teacherEmail: lessonData.teacherEmail, teacherName: lessonData.teacherName, status: 'active' }
            : s
        );
      }
      return [
        ...prev,
        {
          id: `st-${Date.now()}`,
          name: lessonData.studentName,
          studentName: lessonData.studentName,
          email: cleanEmail,
          studentEmail: cleanEmail,
          teacherEmail: lessonData.teacherEmail,
          teacherName: lessonData.teacherName,
          status: 'active',
          level: EnglishLevel.BEGINNER,
        },
      ];
    });

    // Ensure active student session, profile, and fixed assigned Native Friend are locked in
    if (finalStudentEmail) {
      if (!currentAccount || currentAccount.role !== 'teacher' || scheduleStudentInfo) {
        const studentAccount: GoogleAccount = {
          uid: finalStudentUid,
          id: finalStudentUid,
          name: finalStudentName,
          email: finalStudentEmail,
          role: 'student',
          picture: '',
          avatar: '',
        };
        setCurrentAccount(studentAccount);
      }

      setUserProfile((prev) => ({
        ...prev,
        id: finalStudentUid,
        uid: finalStudentUid,
        name: finalStudentName,
        email: finalStudentEmail,
        teacherEmail: lessonData.teacherEmail,
        teacherName: lessonData.teacherName,
        teacherUid: finalTeacherUid,
        assignedNativeFriendUID: finalTeacherUid,
        nativeFriendUID: finalTeacherUid,
        enrollmentStatus: 'active',
        contractedLessons: Math.max(prev?.contractedLessons || 0, 1),
      }));

      setContractedLessons((prev) => ({
        ...prev,
        [finalStudentEmail]: Math.max(prev[finalStudentEmail] || 0, 1),
      }));

      saveStudentNativeFriendToFirestore(finalStudentUid, finalStudentEmail, {
        teacherEmail: lessonData.teacherEmail,
        teacherName: lessonData.teacherName,
        teacherUid: finalTeacherUid,
        assignedNativeFriendUID: finalTeacherUid,
        nativeFriendUID: finalTeacherUid,
        enrollmentStatus: 'active',
      }).catch(() => {});

      saveStudentProfileToFirestore(
        finalStudentUid,
        {
          id: finalStudentUid,
          uid: finalStudentUid,
          name: finalStudentName,
          email: finalStudentEmail,
          teacherEmail: lessonData.teacherEmail,
          teacherName: lessonData.teacherName,
          teacherUid: finalTeacherUid,
          assignedNativeFriendUID: finalTeacherUid,
          nativeFriendUID: finalTeacherUid,
          enrollmentStatus: 'active',
          onboardingCompleted: isTrialBooking ? true : Boolean(userProfile?.onboardingCompleted),
          contractedLessons: Math.max(userProfile?.contractedLessons || 0, 1),
        },
        finalStudentEmail
      ).catch(() => {});

      fetch('/api/user-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: finalStudentEmail,
          profile: {
            id: finalStudentUid,
            name: finalStudentName,
            email: finalStudentEmail,
            teacherEmail: lessonData.teacherEmail,
            teacherName: lessonData.teacherName,
            enrollmentStatus: 'active',
            onboardingCompleted: isTrialBooking ? true : Boolean(userProfile?.onboardingCompleted),
            contractedLessons: Math.max(userProfile?.contractedLessons || 0, 1),
          },
        }),
      }).catch(() => {});
    }

    // Direct student to their personal dashboard page and close modals
    setViewMode('dashboard');
    setIsScheduleModalOpen(false);
    setIsOnboardingModalOpen(false);
    setScheduleStudentInfo(null);
  };

  // Handler: Complete lesson (Automatically marks S-Path tutor_live for the lesson's day)
  const handleCompleteLesson = async (lessonId: string) => {
    let completedLesson: LiveLesson | undefined;
    const nowIso = new Date().toISOString();
    setLessons((prev) => {
      completedLesson = prev.find((l) => l.id === lessonId);
      return prev.map((l) => (l.id === lessonId ? { ...l, status: 'completed', completedAt: nowIso } : l));
    });

    const targetLesson = completedLesson || lessons.find((l) => l.id === lessonId);
    const targetStudentUid = targetLesson?.studentUid || currentAccount?.uid || userProfile?.id || '';
    const targetStudentEmail = targetLesson?.studentEmail || currentAccount?.email || userProfile?.email || '';
    const targetTeacherUid = targetLesson?.teacherUid || (isTeacher ? currentAccount?.uid : undefined);

    // Calculate lesson day of week
    let lessonDay: DayOfWeek = 'monday';
    if (targetLesson?.startDateTime) {
      const d = new Date(targetLesson.startDateTime);
      const dayNames: DayOfWeek[] = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
      const idx = d.getDay();
      if (dayNames[idx]) {
        lessonDay = dayNames[idx];
      }
    } else {
      lessonDay = selectedDay;
    }

    // Auto-mark S-Path for Native Friend session
    handleUpdateSPathCheck('tutor_live', lessonDay, true, targetStudentUid, targetStudentEmail);

    // Persist status change in Firestore
    await updateLiveLessonInFirestore(
      lessonId,
      { status: 'completed', completedAt: nowIso },
      targetStudentUid || currentAccount?.uid,
      targetTeacherUid,
      targetLesson,
      targetStudentEmail
    );

    try {
      await fetch(`/api/lessons/${lessonId}/complete`, { method: 'POST' });
    } catch {
      // local fallback
    }
  };

  // Handler: Cancel lesson (preserves student balance if teacher unforeseen)
  const handleCancelLesson = async (
    lessonId: string,
    reason?: string,
    cancelledByInput?: 'student' | 'teacher'
  ) => {
    const finalCancelledBy = cancelledByInput || (isTeacher ? 'teacher' : 'student');
    const finalReason =
      reason ||
      (finalCancelledBy === 'teacher'
        ? currentLanguage === 'en'
          ? 'Native tutor unforeseen circumstances'
          : 'Imprevisto do amigo nativo'
        : currentLanguage === 'en'
        ? 'Cancelled for personal reasons'
        : 'Cancelado por motivo próprio');

    const target = lessons.find((l) => l.id === lessonId);
    const targetStudentUid = target?.studentUid || (!isTeacher ? currentAccount?.uid : undefined);
    const targetStudentEmail = target?.studentEmail || (!isTeacher ? currentAccount?.email : undefined);
    const targetTeacherUid = target?.teacherUid || (isTeacher ? currentAccount?.uid : undefined);
    const nowIso = new Date().toISOString();

    setLessons((prev) => {
      return prev.map((l) =>
        l.id === lessonId ||
        (target &&
          l.studentEmail &&
          l.studentEmail.toLowerCase() === (target.studentEmail || '').toLowerCase() &&
          l.startDateTime === target.startDateTime)
          ? {
              ...l,
              status: 'cancelled',
              cancelledAt: l.cancelledAt || nowIso,
              cancelledBy: finalCancelledBy,
              cancellationReason: finalReason,
            }
          : l
      );
    });

    // Atomic Firestore transaction: cancels lesson across root & subcollections and restores balance if teacher/admin
    await cancelLessonWithTransaction({
      lessonId,
      studentUid: targetStudentUid,
      studentEmail: targetStudentEmail,
      cancelledBy: finalCancelledBy,
      cancellationReason: finalReason,
    }).catch((err) => console.warn('cancelLessonWithTransaction notice:', err));

    // Persist cancellation in Firestore with complete lesson metadata
    await updateLiveLessonInFirestore(
      lessonId,
      {
        status: 'cancelled',
        cancelledAt: nowIso,
        cancelledBy: finalCancelledBy,
        cancellationReason: finalReason,
      },
      targetStudentUid,
      targetTeacherUid,
      target,
      targetStudentEmail
    );

    try {
      await fetch(`/api/lessons/${lessonId}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cancelledBy: finalCancelledBy,
          reason: finalReason,
        }),
      });
    } catch {
      // local fallback
    }

    setNotifications((prev) => [
      {
        id: `cancel-${Date.now()}`,
        title: currentLanguage === 'en' ? 'Lesson Cancelled' : 'Aula Cancelada',
        message:
          currentLanguage === 'en'
            ? finalCancelledBy === 'teacher'
              ? 'The session was cancelled due to native tutor unforeseen circumstances. Your lesson balance was NOT deducted.'
              : 'The session has been cancelled and counted in completed lessons.'
            : finalCancelledBy === 'teacher'
            ? 'A aula foi cancelada por imprevisto do amigo nativo. O seu saldo NÃO foi deduzido.'
            : 'A aula foi cancelada por motivo próprio e contabilizada nas aulas realizadas.',
        type: finalCancelledBy === 'teacher' ? 'success' : 'info',
        timestamp: new Date().toISOString(),
        read: false,
      },
      ...prev,
    ]);
  };

  // Handler: Mark Not Completed
  const handleConfirmNotCompleted = async (
    lessonId: string,
    responsible: 'student' | 'teacher',
    reason: string
  ) => {
    setLessons((prev) =>
      prev.map((l) =>
        l.id === lessonId
          ? {
              ...l,
              status: 'not_completed',
              notCompletedResponsible: responsible,
              notCompletedReason: reason,
            }
          : l
      )
    );

    // Persist not completed in Firestore
    updateLiveLessonInFirestore(lessonId, {
      status: 'not_completed',
      notCompletedResponsible: responsible,
      notCompletedReason: reason,
    }, currentAccount?.uid);

    try {
      await fetch(`/api/lessons/${lessonId}/not-completed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ responsible, reason }),
      });
    } catch {
      // local fallback
    }
  };

  // Handler: Propose Reschedule (Requires confirmation from the other party)
  const handleConfirmReschedule = async (
    lessonId: string,
    newStartIso: string,
    newEndIso: string,
    reason: string
  ) => {
    // Conflict Check on Reschedule proposal
    const targetLesson = lessons.find((l) => l.id === lessonId);
    if (targetLesson) {
      const teacherEmail = targetLesson.teacherEmail || targetLesson.tutorEmail || '';
      const conflict = findTeacherLessonConflict(
        teacherEmail,
        newStartIso,
        newEndIso,
        lessons,
        lessonId,
        targetLesson.teacherUid || targetLesson.tutorUid,
        targetLesson.studentEmail,
        targetLesson.studentUid
      );
      if (conflict) {
        alert(
          isTeacher
            ? `Conflict Blocked: The slot has another scheduled lesson. Please pick an open time.`
            : `Bloqueio de Conflito: O Amigo Nativo já possui outra aula agendada neste horário.`
        );
        return;
      }
    }

    const proposedBy = isTeacher ? 'teacher' : 'student';
    const proposalStatus = isTeacher
      ? 'pending_student_reschedule'
      : 'pending_teacher_reschedule';

    setLessons((prev) =>
      prev.map((l) =>
        l.id === lessonId
          ? {
              ...l,
              proposedNewStartDateTime: newStartIso,
              proposedNewEndDateTime: newEndIso,
              rescheduleNotes: reason,
              proposedBy,
              proposalStatus,
              proposedAt: new Date().toISOString(),
            }
          : l
      )
    );

    try {
      await fetch(`/api/lessons/${lessonId}/reschedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newStartIso, newEndIso, reason, proposedBy }),
      });
    } catch {
      // local fallback
    }
  };

  // Handler: Accept Reschedule (Strictly updates existing lesson in place, no duplicates)
  const handleAcceptReschedule = async (lessonId: string) => {
    const target = lessons.find((l) => l.id === lessonId);
    if (target && target.proposedNewStartDateTime) {
      const teacherEmail = target.teacherEmail || target.tutorEmail || '';
      const conflict = findTeacherLessonConflict(
        teacherEmail,
        target.proposedNewStartDateTime,
        target.proposedNewEndDateTime || target.endDateTime,
        lessons,
        lessonId,
        target.teacherUid || target.tutorUid,
        target.studentEmail,
        target.studentUid
      );
      if (conflict) {
        alert(
          isTeacher
            ? `Conflict: This proposed slot was booked by another lesson and cannot be accepted.`
            : `Bloqueio de Conflito: Este horário já foi ocupado por outra aula e não pode ser aceito.`
        );
        return;
      }
    }

    setLessons((prev) =>
      prev.map((l) => {
        if (l.id === lessonId && l.proposedNewStartDateTime) {
          return {
            ...l,
            startDateTime: l.proposedNewStartDateTime,
            endDateTime: l.proposedNewEndDateTime || l.endDateTime,
            rescheduledFrom: {
              startDateTime: l.startDateTime,
              endDateTime: l.endDateTime,
            },
            rescheduledAt: new Date().toISOString(),
            rescheduledBy: l.proposedBy,
            rescheduledReason: l.rescheduleNotes,
            proposedNewStartDateTime: undefined,
            proposedNewEndDateTime: undefined,
            proposalStatus: undefined,
          };
        }
        return l;
      })
    );

    try {
      await fetch(`/api/lessons/${lessonId}/accept-reschedule`, {
        method: 'POST',
      });
    } catch {
      // local fallback
    }
  };

  // Handler: Decline Reschedule (Rejects proposed time, keeps original lesson intact)
  const handleDeclineReschedule = async (lessonId: string) => {
    setLessons((prev) =>
      prev.map((l) =>
        l.id === lessonId
          ? {
              ...l,
              proposedNewStartDateTime: undefined,
              proposedNewEndDateTime: undefined,
              proposalStatus: undefined,
            }
          : l
      )
    );

    try {
      await fetch(`/api/lessons/${lessonId}/decline-reschedule`, {
        method: 'POST',
      });
    } catch {
      // local fallback
    }
  };

  // Handler: Save Lesson Notes & Recommendations
  const handleSaveLessonNotes = async (
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
  ) => {
    setLessons((prev) => {
      const exists = prev.some((l) => l.id === lessonId);
      if (exists) {
        return prev.map((l) =>
          l.id === lessonId
            ? {
                ...l,
                title: notes.topic || l.title,
                liveNotes: notes.liveNotes || notes.sessionNotesDocument,
                recommendations: notes.recommendations || notes.sessionNotesDocument,
                pronunciationNotes: notes.pronunciationNotes,
                grammarAndPhrasing: notes.grammarAndPhrasing,
                vocabularyNotes: notes.vocabularyNotes,
                sessionNotesDocument: notes.sessionNotesDocument || notes.liveNotes || notes.recommendations,
                sessionDate: notes.sessionDate,
                notesLastSavedAt: new Date().toISOString(),
                ...(notes.driveFileId ? { driveFileId: notes.driveFileId } : {}),
                ...(notes.driveFileUrl ? { driveFileUrl: notes.driveFileUrl } : {}),
                ...(notes.driveFolderName ? { driveFolderName: notes.driveFolderName } : {}),
                ...(notes.driveLastSyncedAt ? { driveLastSyncedAt: notes.driveLastSyncedAt } : {}),
              }
            : l
        );
      } else {
        const studentClean = (selectedStudentFilter !== 'all' ? selectedStudentFilter : '').toLowerCase().trim();
        const foundStudent = studentsList.find((s) => (s.email || '').toLowerCase().trim() === studentClean);
        const effDate = notes.sessionDate || new Date().toISOString().split('T')[0];
        const newLessonItem: LiveLesson = {
          id: lessonId,
          title: notes.topic || 'Live Coaching Session',
          description: 'Live Session Notes',
          startDateTime: `${effDate}T10:00:00Z`,
          endDateTime: `${effDate}T11:00:00Z`,
          studentEmail: studentClean || '',
          studentName: foundStudent?.name || (foundStudent as any)?.studentName || studentClean.split('@')[0] || 'Student',
          teacherEmail: currentAccount?.email || '',
          teacherName: currentAccount?.name || 'Native Friend',
          meetLink: (notes as any)?.meetUrl || '',
          status: 'completed',
          liveNotes: notes.liveNotes || notes.sessionNotesDocument,
          recommendations: notes.recommendations || notes.sessionNotesDocument,
          sessionNotesDocument: notes.sessionNotesDocument || notes.liveNotes || notes.recommendations,
          sessionDate: effDate,
          notesLastSavedAt: new Date().toISOString(),
          ...(notes.driveFileId ? { driveFileId: notes.driveFileId } : {}),
          ...(notes.driveFileUrl ? { driveFileUrl: notes.driveFileUrl } : {}),
          ...(notes.driveFolderName ? { driveFolderName: notes.driveFolderName } : {}),
          ...(notes.driveLastSyncedAt ? { driveLastSyncedAt: notes.driveLastSyncedAt } : {}),
        };
        return [newLessonItem, ...prev];
      }
    });

    // Auto-migrate vocabulary notes to student's personal dictionary
    const targetLesson = lessons.find((l) => l.id === lessonId);
    const targetStudentEmail = targetLesson?.studentEmail || (selectedStudentFilter !== 'all' ? selectedStudentFilter : '');
    if (notes.vocabularyNotes && notes.vocabularyNotes.length > 0 && targetStudentEmail) {
      const dictEntries: StudentDictionaryEntry[] = notes.vocabularyNotes.map((vn) => ({
        id: vn.id || `dict_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        word: vn.word,
        partOfSpeech: vn.partOfSpeech || '',
        definitionEn: vn.meaningOrTip || '',
        exampleSentenceEn: vn.exampleSentence || '',
        learnedAt: new Date().toISOString(),
        source: vn.source || 'api',
        sourceActivityName: `Live Session with ${currentAccount?.name || 'Native Friend'}`,
      }));
      handleAddWordsToDictionary(dictEntries, targetStudentEmail);
    }

    try {
      await fetch(`/api/lessons/${lessonId}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...notes,
          studentEmail: targetStudentEmail,
          teacherEmail: currentAccount?.email,
          teacherName: currentAccount?.name,
        }),
      });
    } catch {
      // local fallback
    }
  };

  // Handler: Add words to Student Personal Dictionary (auto-migrated from lesson notes)
  const handleAddWordsToDictionary = async (
    entries: StudentDictionaryEntry[],
    studentEmail?: string,
    studentUid?: string,
    lessonId?: string,
    options?: { isAutomaticSync?: boolean; syncType?: string }
  ) => {
    if (!entries || entries.length === 0) return { success: false, error: 'No entries to add' };

    const isTeacherCaller = currentAccount?.role === 'teacher' || currentAccount?.role === 'admin';
    if (isTeacherCaller) {
      // HOTFIX 4B.21: The teacher does not read or write directly to the student's private My Dictionary endpoint.
      // Notes already migrate to Native Friends Notes.
      return { success: true, count: entries.length };
    }
    let targetEmail = (
      studentEmail ||
      (!isTeacherCaller ? currentAccount?.email : '') ||
      (selectedStudentFilter !== 'all' ? selectedStudentFilter : '') ||
      ''
    ).toLowerCase().trim();

    let targetUid = (studentUid && isValidCanonicalUid(studentUid) ? studentUid.trim() : '');

    if (!targetUid && targetEmail) {
      const allStudents = (studentsList || students || []) as any[];
      const targetStudent = allStudents.find(
        (s) => (s?.email || s?.studentEmail || '').toLowerCase().trim() === targetEmail
      );
      if (targetStudent && targetStudent.uid && isValidCanonicalUid(targetStudent.uid)) {
        targetUid = targetStudent.uid;
      }
    }

    if (!targetEmail && !targetUid) {
      throw new Error('Identidade do estudante não informada para adição ao My Dictionary.');
    }

    // Strict invariant: Teacher UID can NEVER be passed as student UID
    if (isTeacherCaller && targetUid && targetUid === currentAccount?.uid) {
      targetUid = '';
    }

    // Call backend API with Bearer token and await response
    const token = (await getAccessToken().catch(() => null)) || (await auth.currentUser?.getIdToken().catch(() => null));
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch('/api/student-dictionary', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        studentEmail: targetEmail,
        studentUid: targetUid,
        lessonId,
        teacherEmail: currentAccount?.email,
        teacherName: currentAccount?.name,
        entries,
        isAutomaticSync: options?.isAutomaticSync !== undefined ? options.isAutomaticSync : true,
        syncType: options?.syncType || 'automatic',
      }),
    });

    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      const msg = errJson.message || errJson.error || `HTTP ${res.status}: Erro ao persistir dicionário do aluno.`;
      throw new Error(msg);
    }

    const resData = await res.json();
    const updatedDictionary: StudentDictionaryEntry[] = resData.dictionary || [];

    // CRITICAL (Etapa 5 - Isolamento de Sessão):
    // Only update studentDictionaryEntries React state if the currently logged-in account is the student!
    // NEVER mutate the teacher's React state!
    if (currentAccount?.role === 'student' && (!targetEmail || targetEmail === currentAccount?.email?.toLowerCase().trim())) {
      setStudentDictionaryEntries(
        updatedDictionary.length > 0 ? updatedDictionary : (prev) => consolidateDictionaryEntries(prev, entries)
      );
    }

    return { success: true, count: entries.length };
  };

  // Handler: Save manual entry in Personal Dictionary
  const handleSaveCustomDictionaryEntry = async (entry: StudentDictionaryEntry) => {
    const norm = normalizeDictionaryWord(entry.normalizedWord || entry.word);
    if (norm) {
      setExcludedDictionaryWords((prev) => prev.filter((w) => normalizeDictionaryWord(w) !== norm));
    }

    setStudentDictionaryEntries((prev) => {
      return consolidateDictionaryEntries(prev, [entry]);
    });

    const targetUid = currentAccount?.uid || auth.currentUser?.uid || userProfile?.id || (userProfile as any)?.uid || '';
    const targetEmail = currentAccount?.email || auth.currentUser?.email || userProfile?.email || '';

    if (norm && (targetUid || targetEmail)) {
      await removeExcludedDictionaryWord(targetUid, norm, targetEmail);
    }

    // Direct Firestore persistence - cumulative and permanent!
    if (targetUid || targetEmail) {
      await saveStudentVocabularyToFirestore(targetUid, [entry], targetEmail);
    }

    if (currentAccount?.email || targetEmail) {
      try {
        const token = await auth.currentUser?.getIdToken().catch(() => null);
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;

        await fetch('/api/student-dictionary', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            studentEmail: targetEmail || currentAccount?.email,
            studentUid: targetUid,
            entry,
          }),
        });
      } catch (err) {
        console.warn('Failed to save student dictionary entry:', err);
      }
    }
  };

  // Handler: Delete entry from Personal Dictionary with atomic canonical backend persistence & optimistic rollback
  const handleDeleteCustomDictionaryEntry = async (word: string) => {
    const cleanWord = (word || '').trim().toLowerCase();
    if (!cleanWord) return;
    const norm = normalizeDictionaryWord(cleanWord);
    if (!norm) return;

    const targetUid = currentAccount?.uid || auth.currentUser?.uid || userProfile?.id || (userProfile as any)?.uid || '';
    const targetEmail = (currentAccount?.email || auth.currentUser?.email || userProfile?.email || '').toLowerCase().trim();

    // 1. Snapshot previous state for reliable rollback
    const previousEntries = [...studentDictionaryEntries];
    const previousExcluded = [...excludedDictionaryWords];
    const previousExcludedRef = [...excludedDictionaryWordsRef.current];

    // 2. Optimistic UI update
    setStudentDictionaryEntries((prev) =>
      prev.filter((e) => normalizeDictionaryWord(e.normalizedWord || e.word) !== norm)
    );
    if (!excludedDictionaryWordsRef.current.includes(norm)) {
      excludedDictionaryWordsRef.current = [...excludedDictionaryWordsRef.current, norm];
    }
    setExcludedDictionaryWords((prev) => {
      if (!prev.includes(norm)) return [...prev, norm];
      return prev;
    });

    try {
      // 3. Authenticated Backend DELETE with Firebase Bearer Token
      const token = await auth.currentUser?.getIdToken().catch(() => null);
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch('/api/student-dictionary', {
        method: 'DELETE',
        headers,
        body: JSON.stringify({
          word: cleanWord,
          studentUid: targetUid,
          studentEmail: targetEmail,
        }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.message || errJson.error || `HTTP ${res.status}: Erro ao excluir palavra do dicionário.`);
      }

      const resData = await res.json().catch(() => ({}));

      // Guard against out-of-order responses and identity switches
      if (targetUid && activeStudentUidRef.current && activeStudentUidRef.current !== targetUid) {
        return;
      }

      // Synchronize with authoritative backend exclusions list
      const authoritativeExcluded: string[] = Array.isArray(resData?.excludedWords)
        ? resData.excludedWords.map((w: string) => normalizeDictionaryWord(w)).filter(Boolean)
        : excludedDictionaryWordsRef.current;

      excludedDictionaryWordsRef.current = authoritativeExcluded;
      setExcludedDictionaryWords(authoritativeExcluded);
      cacheExcludedWordsLocally(targetUid, targetEmail, authoritativeExcluded);

      // Clean in-memory vocabulary caches for this word
      const updatedList = previousEntries.filter((e) => normalizeDictionaryWord(e.normalizedWord || e.word) !== norm);
      cacheVocabularyLocally(targetUid, targetEmail, updatedList);

      return resData;
    } catch (err: any) {
      // Rollback on failure
      console.error('Failed to delete word from student dictionary:', err);
      setStudentDictionaryEntries(previousEntries);
      setExcludedDictionaryWords(previousExcluded);
      excludedDictionaryWordsRef.current = previousExcludedRef;
      throw err;
    }
  };

  // Handler: Add words from Live Session to Student's Weekly Activity Routine
  const handleAddWordsToWeeklyActivity = async (newWords: string[], studentEmail?: string) => {
    if (!newWords || newWords.length === 0) return;
    setRoutinesByDay((prev) => {
      const updated: Record<DayOfWeek, RoutineItem[]> = { ...prev };
      (Object.keys(updated) as DayOfWeek[]).forEach((day) => {
        if (Array.isArray(updated[day])) {
          updated[day] = updated[day].map((item) => {
            if (!item) return item;
            const isTutorOrConversation =
              (item.id || '').toLowerCase().includes('tutor') ||
              (item.activityName || '').toLowerCase().includes('conversa') ||
              (item.activityName || '').toLowerCase().includes('chat') ||
              (item.activityName || '').toLowerCase().includes('native') ||
              item.time === '15:00';

            if (isTutorOrConversation) {
              const existing = item.learnedWords || [];
              const combined = Array.from(new Set([...existing, ...newWords]));
              return { ...item, learnedWords: combined };
            }
            return item;
          });
        }
      });
      return updated;
    });

    try {
      await fetch('/api/routines/words', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ words: newWords, studentEmail }),
      });
    } catch {
      // local fallback
    }

    if (studentEmail) {
      handleSendStudentNotification(
        studentEmail,
        'New Vocabulary Added by Your Native Friend',
        `Your Native Friend added ${newWords.length} new words to your weekly study routine: ${newWords.slice(0, 5).join(', ')}${newWords.length > 5 ? '...' : ''}`
      );
    }
  };

  // Handler: Send Notification to Student
  const handleSendStudentNotification = (
    studentEmail: string,
    title: string,
    message: string
  ) => {
    setNotifications((prev) => [
      {
        id: `notif-live-${Date.now()}`,
        title,
        message,
        type: 'info',
        timestamp: new Date().toISOString(),
        read: false,
      },
      ...prev,
    ]);
  };

  // Handler: Save Teacher Meet Settings
  const handleSaveTeacherMeetSettings = async (settings: TeacherMeetSettings) => {
    const cleanEmail = (settings.teacherEmail || '').toLowerCase().trim();
    const uid =
      settings.uid ||
      (currentAccount?.email?.toLowerCase().trim() === cleanEmail ? currentAccount?.uid : undefined);
    const merged = { ...settings, teacherEmail: cleanEmail, ...(uid ? { uid } : {}) };

    setTeacherMeetSettings((prev) => ({
      ...prev,
      [cleanEmail]: merged,
      ...(uid ? { [uid]: merged } : {}),
    }));

    // Synchronize timezone, meetLink, availableDays, and availability to tutors list if updated
    setTutors((prev) =>
      prev.map((t) =>
        (t.email || '').toLowerCase().trim() === cleanEmail || (uid && (t as any).uid === uid)
          ? {
              ...t,
              timezone: settings.timezone || t.timezone,
              meetUrl: settings.meetLink || t.meetUrl,
              meetLink: settings.meetLink || (t as any).meetLink,
              availableDays:
                settings.availableDays && settings.availableDays.length > 0
                  ? settings.availableDays
                  : t.availableDays,
              availability: settings.availability || settings.availableHoursByDay || t.availability,
              availableHoursByDay: settings.availableHoursByDay || settings.availability || (t as any).availableHoursByDay,
            }
          : t
      )
    );

    try {
      const token = (await getAccessToken().catch(() => null)) || (await auth.currentUser?.getIdToken().catch(() => null)) || null;
      await fetch('/api/teacher-settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(merged),
      });
    } catch {
      // local fallback
    }
  };

  // Handler: Save Landing Content from Admin Editor
  const handleSaveLandingContent = async (updatedContent: AdminLandingContent) => {
    setLandingContent(updatedContent);
    try {
      await fetch('/api/landing-content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedContent),
      });
    } catch {
      // local fallback
    }
  };

  const [adminAuthError, setAdminAuthError] = useState<string | null>(null);
  const [isRefreshingTutors, setIsRefreshingTutors] = useState(false);

  const fetchLatestTutors = async () => {
    setIsRefreshingTutors(true);
    setAdminAuthError(null);
    const isAdminUser = currentAccount?.role === 'admin' || isAdminApprovalsOpen;
    try {
      // 1. Await Firebase Auth state initialization
      const authUser = await waitForAuthUser();

      // 2. Strict validation: If user is visually acting as administrator, they MUST possess an authentic Firebase session
      if (isAdminUser && !authUser) {
        const errorMsg = currentLanguage === 'en'
          ? 'Administrator session not found in Firebase Auth. Please sign in with an authorized administrator account to review pending applications.'
          : 'Sessão de autenticação Firebase não encontrada para o administrador. Faça login com uma conta de administrador autorizada para revisar cadastros pendentes.';
        setAdminAuthError(errorMsg);
        setNotifications((prev) => [
          {
            id: `admin-auth-error-${Date.now()}`,
            title: currentLanguage === 'en' ? 'Authentication Required' : 'Autenticação Necessária',
            message: errorMsg,
            type: 'warning',
            timestamp: new Date().toISOString(),
            read: false,
          },
          ...prev,
        ]);
        return;
      }

      // 3. Acquire valid token
      let token: string | null = null;
      if (isAdminUser && authUser) {
        token = await getAdminAccessToken().catch(() => null);
        if (!token) {
          token = await authUser.getIdToken().catch(() => null);
        }
        if (!token) {
          const errorMsg = currentLanguage === 'en'
            ? 'Failed to obtain Firebase ID Token for administrator. Please re-authenticate.'
            : 'Falha ao obter o Firebase ID Token para o administrador. Por favor, autentique-se novamente.';
          setAdminAuthError(errorMsg);
          return;
        }
      } else if (authUser) {
        token = await getAccessToken().catch(() => null);
      }

      // Ensure hook is refreshed with authorization
      await refreshNativeFriends().catch(() => null);

      const headers: Record<string, string> = {};
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const res = await fetch(`/api/tutors?_t=${Date.now()}`, { headers, cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          setTutors((prev) => {
            const map = new Map<string, NativeFriendTutor>();
            prev.forEach((t) => map.set((t.email || t.id).toLowerCase().trim(), t));
            data.forEach((t: NativeFriendTutor) => {
              const k = (t.email || t.id).toLowerCase().trim();
              const existing = map.get(k);
              const approved = isTutorApproved(t);
              map.set(k, {
                ...existing,
                ...t,
                isApproved: approved,
                approvalStatus: approved ? 'approved' : ((t.approvalStatus || t.status || 'pending') as 'approved' | 'pending' | 'rejected'),
                status: approved ? 'approved' : (t.status || t.approvalStatus || 'pending'),
              });
            });
            return Array.from(map.values());
          });
        }
      } else if (res.status === 401 || res.status === 403) {
        if (isAdminUser) {
          const errorMsg = currentLanguage === 'en'
            ? 'Administrative access denied: your Firebase account lacks required administrator claims.'
            : 'Acesso administrativo negado: sua conta Firebase não possui a permissão administrativa necessária.';
          setAdminAuthError(errorMsg);
        }
      }
    } catch (err: any) {
      if (isAdminUser) {
        setAdminAuthError(err?.message || 'Error fetching tutors for administrator');
      }
    } finally {
      setIsRefreshingTutors(false);
    }
  };

  useEffect(() => {
    fetchLatestTutors();
    // Only poll when the admin approvals modal is actively open
    if (isAdminApprovalsOpen) {
      const interval = setInterval(fetchLatestTutors, 15000);
      return () => clearInterval(interval);
    }
  }, [isAdminApprovalsOpen]);

  // Handler: Admin Approve Tutor
  const handleApproveTutor = async (tutorId: string, tutorObj?: NativeFriendTutor): Promise<{ success: boolean; error?: string }> => {
    const existing = tutors.find(
      (t) => t.id === tutorId || t.email?.toLowerCase() === tutorId.toLowerCase()
    );
    const tutorToApprove = tutorObj || existing;
    const cleanEmail = (tutorToApprove?.email || (tutorId.includes('@') ? tutorId : '')).toLowerCase().trim();

    // 1. Verify administrative privileges from currentAccount
    const isLocalAdmin = currentAccount?.role === 'admin';
    if (!isLocalAdmin) {
      return {
        success: false,
        error: isTeacher ? 'Only administrators can approve Native Friends.' : 'Apenas administradores podem aprovar Amigos Nativos.',
      };
    }

    // 2. Obtain valid Firebase Auth ID Token for admin session
    let token = await getAdminAccessToken().catch(() => null);
    if (!token) {
      token = await getAccessToken(true).catch(() => null);
    }

    if (!token) {
      return {
        success: false,
        error: isTeacher
          ? 'Missing administrative credentials in Firebase Auth session. Please log in as Administrator.'
          : 'Sessão administrativa não autenticada no Firebase Auth. Efetue login como Administrador para autorizar Amigos Nativos.',
      };
    }

    // 3. Make authorized request to backend
    let res: Response;
    try {
      res = await fetch(`/api/tutors/${encodeURIComponent(tutorId)}/approve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({}),
      });
    } catch (networkErr: any) {
      return {
        success: false,
        error: networkErr?.message || 'Falha de comunicação com o servidor ao aprovar Amigo Nativo.',
      };
    }

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      const errorMsg =
        errData.message ||
        errData.error ||
        (res.status === 401
          ? 'Não autorizado: token de autenticação inválido ou ausente.'
          : res.status === 403
          ? 'Acesso negado: privilégios de administrador necessários.'
          : `Erro ao aprovar Amigo Nativo (HTTP ${res.status}).`);
      return { success: false, error: errorMsg };
    }

    const data = await res.json();

    // 4. Update UI state only upon verified server success
    setTutors((prev) => {
      const serverTutors = Array.isArray(data.tutors) ? data.tutors : null;
      if (serverTutors) {
        const map = new Map<string, NativeFriendTutor>();
        prev.forEach((t) => map.set((t.email || t.id).toLowerCase().trim(), t));
        serverTutors.forEach((t: NativeFriendTutor) => {
          const k = (t.email || t.id).toLowerCase().trim();
          map.set(k, {
            ...(map.get(k) || {}),
            ...t,
            approvalStatus: t.id === tutorId || (cleanEmail && t.email?.toLowerCase() === cleanEmail) ? 'approved' : t.approvalStatus,
            isApproved: t.id === tutorId || (cleanEmail && t.email?.toLowerCase() === cleanEmail) ? true : t.isApproved,
          });
        });
        return Array.from(map.values());
      }

      return prev.map((t) =>
        t.id === tutorId || (cleanEmail && t.email?.toLowerCase() === cleanEmail)
          ? {
              ...t,
              approvalStatus: 'approved',
              isApproved: true,
              status: 'approved',
              approved: true,
              updatedAt: new Date().toISOString(),
            }
          : t
      );
    });

    // 5. Backend API handles canonical Firestore persistence in /tutors/{canonicalAuthUid} and /users/{canonicalAuthUid}
    return { success: true };
  };

  // Handler: Admin Reject Tutor
  const handleRejectTutor = async (tutorId: string, tutorObj?: NativeFriendTutor): Promise<{ success: boolean; error?: string }> => {
    const existing = tutors.find(
      (t) => t.id === tutorId || t.email?.toLowerCase() === tutorId.toLowerCase()
    );
    const tutorToReject = tutorObj || existing;
    const cleanEmail = (tutorToReject?.email || (tutorId.includes('@') ? tutorId : '')).toLowerCase().trim();

    const isLocalAdmin = currentAccount?.role === 'admin';
    if (!isLocalAdmin) {
      return {
        success: false,
        error: isTeacher ? 'Only administrators can reject Native Friends.' : 'Apenas administradores podem recusar Amigos Nativos.',
      };
    }

    let token = await getAdminAccessToken().catch(() => null);
    if (!token) {
      token = await getAccessToken(true).catch(() => null);
    }

    if (!token) {
      return {
        success: false,
        error: isTeacher
          ? 'Missing administrative credentials in Firebase Auth session. Please log in as Administrator.'
          : 'Sessão administrativa não autenticada no Firebase Auth. Efetue login como Administrador.',
      };
    }

    let res: Response;
    try {
      res = await fetch(`/api/tutors/${encodeURIComponent(tutorId)}/reject`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });
    } catch (networkErr: any) {
      return {
        success: false,
        error: networkErr?.message || 'Falha de comunicação com o servidor ao recusar Amigo Nativo.',
      };
    }

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      const errorMsg =
        errData.message ||
        errData.error ||
        (res.status === 401
          ? 'Não autorizado: token de autenticação inválido ou ausente.'
          : res.status === 403
          ? 'Acesso negado: privilégios de administrador necessários.'
          : `Erro ao recusar Amigo Nativo (HTTP ${res.status}).`);
      return { success: false, error: errorMsg };
    }

    const data = await res.json();
    if (Array.isArray(data.tutors)) {
      setTutors(data.tutors);
    } else {
      setTutors((prev) =>
        prev.map((t) =>
          t.id === tutorId || (cleanEmail && t.email?.toLowerCase() === cleanEmail)
            ? {
                ...t,
                approvalStatus: 'rejected',
                isApproved: false,
                status: 'rejected',
                approved: false,
                updatedAt: new Date().toISOString(),
              }
            : t
        )
      );
    }

    // Direct persistence managed exclusively by backend /api/tutors/:id/reject via Firebase Admin SDK
    return { success: true };
  };

  // Handler: Admin Delete Tutor
  const handleDeleteTutor = async (tutorId: string, tutorEmail?: string): Promise<{ success: boolean; error?: string }> => {
    const isLocalAdmin = currentAccount?.role === 'admin';
    if (!isLocalAdmin) {
      return {
        success: false,
        error: isTeacher ? 'Only administrators can delete Native Friends.' : 'Apenas administradores podem excluir Amigos Nativos.',
      };
    }

    let token = await getAdminAccessToken().catch(() => null);
    if (!token) {
      token = await getAccessToken(true).catch(() => null);
    }

    if (!token) {
      return {
        success: false,
        error: isTeacher
          ? 'Missing administrative credentials in Firebase Auth session. Please log in as Administrator.'
          : 'Sessão administrativa não autenticada no Firebase Auth. Efetue login como Administrador.',
      };
    }

    const cleanEmail = tutorEmail?.toLowerCase().trim();
    const queryParam = cleanEmail ? `?email=${encodeURIComponent(cleanEmail)}` : '';

    let response: Response;
    try {
      response = await fetch(`/api/tutors/${encodeURIComponent(tutorId)}${queryParam}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
    } catch (networkErr: any) {
      return {
        success: false,
        error: networkErr?.message || 'Falha de comunicação com o servidor ao excluir Amigo Nativo.',
      };
    }

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      const errorMsg =
        errData.message ||
        errData.error ||
        `Erro ao excluir Amigo Nativo (HTTP ${response.status}).`;
      return { success: false, error: errorMsg };
    }

    const data = await response.json();
    if (Array.isArray(data.tutors)) {
      setTutors(data.tutors);
    } else {
      setTutors((prev) =>
        prev.filter((t) => {
          if (t.id === tutorId) return false;
          if (t.email?.toLowerCase() === tutorId.toLowerCase()) return false;
          if (cleanEmail && t.email?.toLowerCase() === cleanEmail) return false;
          return true;
        })
      );
    }

    if (cleanEmail && currentAccount?.role !== 'admin') {
      setAvailableAccounts((prev) => prev.filter((a) => (a?.email ? a.email.toLowerCase().trim() !== cleanEmail : true)));
    }

    // Direct Firestore deletion
    try {
      const db = getDb();
      const cleanEmailDocId = cleanEmail ? cleanEmail.replace(/[^a-zA-Z0-9]/g, '-') : '';
      await Promise.all([
        deleteDoc(doc(db, 'users', tutorId)).catch(() => null),
        deleteDoc(doc(db, 'tutors', tutorId)).catch(() => null),
        cleanEmailDocId ? deleteDoc(doc(db, 'users', cleanEmailDocId)).catch(() => null) : null,
        cleanEmailDocId ? deleteDoc(doc(db, 'tutors', cleanEmailDocId)).catch(() => null) : null,
      ]);
    } catch (fsErr) {
      console.warn('[NativeFriend Deletion] Firestore delete error:', fsErr);
    }

    return { success: true };
  };

  // Handler: Save Native Friend Profile (from Teacher Dashboard or Modal)
  const handleSaveTutorProfile = async (updatedTutor: NativeFriendTutor) => {
    const cleanEmail = (updatedTutor.email || '').toLowerCase().trim();
    const existingMeetSettings =
      teacherMeetSettings[cleanEmail] ||
      (currentAccount?.uid ? teacherMeetSettings[currentAccount.uid] : undefined);

    // Merge and preserve centralized meetUrl, availableDays, and availability
    const mergedTutor: NativeFriendTutor = {
      ...updatedTutor,
      meetUrl:
        existingMeetSettings?.meetLink ||
        updatedTutor.meetUrl ||
        '',
      availableDays:
        existingMeetSettings?.availableDays && existingMeetSettings.availableDays.length > 0
          ? existingMeetSettings.availableDays
          : updatedTutor.availableDays && updatedTutor.availableDays.length > 0
          ? updatedTutor.availableDays
          : [],
      availability:
        existingMeetSettings?.availability ||
        existingMeetSettings?.availableHoursByDay ||
        updatedTutor.availability,
      availableHours:
        existingMeetSettings?.availableHours ||
        updatedTutor.availableHours,
    };

    // 1. Obtain verified Firebase auth token
    const token =
      (await getAccessToken().catch(() => null)) ||
      (await auth.currentUser?.getIdToken().catch(() => null)) ||
      null;

    if (!token) {
      throw new Error('Authentication required: verified user token missing or expired.');
    }

    // 2. Resolve destination ID for request (prefer canonical UID)
    const targetId = (mergedTutor.uid && isValidCanonicalUid(mergedTutor.uid))
      ? mergedTutor.uid
      : (mergedTutor.id || mergedTutor.uid || cleanEmail);

    const response = await fetch(`/api/tutors/${encodeURIComponent(targetId)}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(mergedTutor),
    });

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      const errMsg = data?.message || data?.error || `Server returned error (${response.status})`;
      if (response.status === 401) {
        throw new Error('Session expired or unauthorized. Please sign in again.');
      } else if (response.status === 403) {
        throw new Error(errMsg || 'Access denied: You are not authorized to update this tutor profile.');
      } else if (response.status === 404) {
        throw new Error(errMsg || 'Tutor profile not found in database.');
      } else if (response.status === 409) {
        throw new Error(errMsg || 'Conflict: Profile has ambiguous mapping or lacks canonical UID.');
      } else {
        throw new Error(errMsg || 'Failed to save profile. Please try again.');
      }
    }

    // 3. Persistence confirmed by server: extract canonical saved tutor
    const canonicalSavedTutor: NativeFriendTutor = data?.tutor
      ? { ...mergedTutor, ...data.tutor }
      : mergedTutor;

    // Update local React tutors list with canonical saved tutor
    setTutors((prev) => {
      const targetEmail = (canonicalSavedTutor.email || '').toLowerCase().trim();
      const targetUid = canonicalSavedTutor.uid;
      const targetIdVal = canonicalSavedTutor.id;
      const exists = prev.some(
        (t) =>
          Boolean(t) &&
          ((targetUid && t.uid === targetUid) ||
            (targetIdVal && t.id === targetIdVal) ||
            (targetEmail && (t.email || '').toLowerCase().trim() === targetEmail))
      );
      if (exists) {
        return prev.map((t) =>
          Boolean(t) &&
          ((targetUid && t.uid === targetUid) ||
            (targetIdVal && t.id === targetIdVal) ||
            (targetEmail && (t.email || '').toLowerCase().trim() === targetEmail))
            ? canonicalSavedTutor
            : t
        );
      }
      return [...prev, canonicalSavedTutor];
    });

    // Update currentAccount if active user is this tutor
    setCurrentAccount((prev) => {
      const targetEmail = (canonicalSavedTutor.email || '').toLowerCase().trim();
      const targetUid = canonicalSavedTutor.uid;
      if (
        prev &&
        ((targetEmail && (prev.email || '').toLowerCase().trim() === targetEmail) ||
          (targetUid && (prev.uid === targetUid || prev.id === targetUid)))
      ) {
        return {
          ...prev,
          name: canonicalSavedTutor.name,
          picture: canonicalSavedTutor.avatar || prev.picture,
        };
      }
      return prev;
    });

    // Update available accounts list
    setAvailableAccounts((prev) => {
      const targetEmail = (canonicalSavedTutor.email || '').toLowerCase().trim();
      const targetUid = canonicalSavedTutor.uid;
      return prev.map((acc) =>
        Boolean(acc) &&
        ((targetEmail && (acc.email || '').toLowerCase().trim() === targetEmail) ||
          (targetUid && (acc.uid === targetUid || acc.id === targetUid)))
          ? {
              ...acc,
              name: canonicalSavedTutor.name,
              picture: canonicalSavedTutor.avatar || acc.picture,
            }
          : acc
      );
    });

    // Sync timezone to teacherMeetSettings if provided
    if (canonicalSavedTutor.timezone) {
      setTeacherMeetSettings((prev) => {
        const existing = prev[cleanEmail];
        if (existing) {
          return {
            ...prev,
            [cleanEmail]: {
              ...existing,
              timezone: canonicalSavedTutor.timezone,
            },
          };
        }
        return prev;
      });
    }

    // Refresh public directory / invalidate cache so directory reflects the persisted update
    refreshNativeFriends().catch(() => {});

    return canonicalSavedTutor;
  };

  // Handler: Save Student Profile & Photo
  const handleSaveStudentProfile = (updatedProfile: UserProfile, updatedPicture?: string) => {
    const cleanPic =
      updatedPicture !== undefined
        ? updatedPicture
        : updatedProfile.avatar || updatedProfile.picture || '';

    const cleanProfile: UserProfile = {
      ...updatedProfile,
      picture: cleanPic,
      avatar: cleanPic,
    };
    setUserProfile(cleanProfile);
    if (currentAccount) {
      setCurrentAccount((prev) =>
        prev
          ? {
              ...prev,
              name: cleanProfile.name,
              picture: cleanPic,
            }
          : null
      );
    }
    const targetCleanEmail = (cleanProfile.email || '').toLowerCase().trim();
    setAvailableAccounts((prev) =>
      prev.map((acc) =>
        Boolean(acc) && targetCleanEmail && (acc.email || '').toLowerCase().trim() === targetCleanEmail
          ? {
              ...acc,
              name: cleanProfile.name,
              picture: cleanPic,
            }
          : acc
      )
    );
    setStudents((prev) =>
      prev.map((st) =>
        Boolean(st) && targetCleanEmail && (st.email || '').toLowerCase().trim() === targetCleanEmail
          ? {
              ...st,
              name: cleanProfile.name,
              studentName: cleanProfile.name,
              level: cleanProfile.level,
              studentLevel: cleanProfile.level,
              goal: cleanProfile.learningGoal || st.goal,
              routineVideoTime: cleanProfile.routineVideoTime || st.routineVideoTime,
              routineAudioTime: cleanProfile.routineAudioTime || st.routineAudioTime,
              dailyPhraseTime: cleanProfile.dailyPhraseTime || st.dailyPhraseTime,
              picture: cleanPic,
              avatar: cleanPic,
            }
          : st
      )
    );
    if (cleanProfile.routineVideoTime || cleanProfile.routineAudioTime) {
      setRoutinesByDay((prev) =>
        applyProfileTimesToRoutines(prev, cleanProfile.routineVideoTime, cleanProfile.routineAudioTime)
      );
    }

    const studentUid = auth.currentUser?.uid || currentAccount?.uid || userProfile?.uid || userProfile?.id || '';
    if (studentUid) {
      const profileToSave: UserProfile = {
        ...cleanProfile,
        id: studentUid,
        uid: studentUid,
      };
      saveStudentProfileToFirestore(studentUid, profileToSave, cleanProfile.email).catch((err) =>
        console.warn('Firestore profile save notice:', err)
      );
      if (cleanProfile.teacherEmail !== undefined) {
        saveStudentNativeFriendToFirestore(studentUid, cleanProfile.email, {
          teacherEmail: cleanProfile.teacherEmail,
          teacherName: cleanProfile.teacherName,
          teacherUid: cleanProfile.teacherUid,
          assignedNativeFriendUID: cleanProfile.assignedNativeFriendUID,
          nativeFriendUID: cleanProfile.nativeFriendUID,
          enrollmentStatus: cleanProfile.enrollmentStatus,
        }).catch(() => {});
      }
    }

    try {
      fetch('/api/students/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profile: cleanProfile,
          picture: cleanPic,
          uid: currentAccount?.uid,
        }),
      }).catch(() => {});
    } catch {}
  };

  // Punctual time update for any activity in the timeline
  const handleUpdateActivityTime = (activityId: string, newTime: string, dayToUpdate?: DayOfWeek) => {
    const targetDay = dayToUpdate || selectedDay;
    setRoutinesByDay((prev) => {
      const updated = { ...prev };
      updated[targetDay] = (updated[targetDay] || []).map((item) =>
        item.id === activityId ? { ...item, time: newTime } : item
      );
      return updated;
    });

    const activeEmail = currentAccount?.email || userProfile?.email;
    if (activeEmail) {
      fetch('/api/routines/update-time', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentEmail: activeEmail,
          day: targetDay,
          activityId,
          time: newTime,
        }),
      }).catch(() => {});
    }
  };

  // Compute current tutor profile for Edit Profile Modal
  const currentTutorProfile: NativeFriendTutor = useMemo(() => {
    if (currentAccount && (currentAccount.role === 'teacher' || currentAccount.role === 'admin')) {
      const emailClean = (currentAccount.email || '').toLowerCase().trim();
      const accountUid = (currentAccount.uid || currentAccount.id || '').trim();
      const settings =
        teacherMeetSettings[emailClean] ||
        (accountUid ? teacherMeetSettings[accountUid] : undefined);
      const found = tutors.find(
        (t) =>
          Boolean(t) &&
          ((accountUid && (t.uid === accountUid || t.id === accountUid)) ||
            (emailClean && (t.email || '').toLowerCase().trim() === emailClean))
      );
      if (found) {
        return {
          ...found,
          uid: found.uid || (isValidCanonicalUid(accountUid) ? accountUid : undefined),
          meetUrl: settings?.meetLink || found.meetUrl || '',
          availableDays:
            settings?.availableDays && settings.availableDays.length > 0
              ? settings.availableDays
              : found.availableDays || [],
          availability: settings?.availability || settings?.availableHoursByDay || found.availability,
          timezone: settings?.timezone || found.timezone,
        };
      }

      return {
        id: (isValidCanonicalUid(accountUid) ? accountUid : null) || `tutor-${(currentAccount.email || currentAccount.id || 'current').replace(/[^a-zA-Z0-9]/g, '-')}`,
        uid: isValidCanonicalUid(accountUid) ? accountUid : undefined,
        name: currentAccount.name,
        email: currentAccount.email || '',
        avatar: currentAccount.picture || '',
        country: 'United States',
        countryCode: 'US',
        flag: '🇺🇸',
        accent: 'North American',
        rating: 5.0,
        reviewsCount: 0,
        activeStudents: 0,
        lessonsTaught: 0,
        pricePerSessionUsd: 20,
        pricePerSessionBrl: 110,
        headline: 'Conversational Native Friend',
        bio: 'Hello! I am ready to guide you in living English every day through real conversation and practical routines.',
        specialties: ['Conversational Fluency', 'Daily Routines'],
        availableDays: settings?.availableDays || ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
        availableHours: settings?.availableHours || ['09:00', '10:00', '11:00', '14:00', '15:00', '16:00'],
        availability: settings?.availability || settings?.availableHoursByDay,
        meetUrl: settings?.meetLink || '',
        approvalStatus: 'pending',
      };
    }
    if (tutors.length > 0) return tutors[0];
    return {
      id: 'default-tutor',
      name: 'Native Friend',
      email: 'contact@itissimple.com',
      avatar: '',
      country: 'United States',
      countryCode: 'US',
      flag: '🇺🇸',
      accent: 'North American',
      rating: 5.0,
      reviewsCount: 0,
      activeStudents: 0,
      lessonsTaught: 0,
      pricePerSessionUsd: 20,
      pricePerSessionBrl: 110,
      headline: 'Conversational Native Friend',
      bio: 'Ready to guide you in living English every day through real conversation.',
      specialties: ['Conversational Fluency', 'Daily Routines'],
      availableDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
      availableHours: ['09:00', '10:00', '11:00', '14:00', '15:00', '16:00'],
      approvalStatus: 'approved',
    };
  }, [tutors, currentAccount, teacherMeetSettings]);

  // Count pending tutor approvals for Administrator
  const pendingApprovalsCount = useMemo(() => {
    return tutors.filter((t) => {
      const isApproved =
        t.approvalStatus === 'approved' ||
        t.isApproved === true ||
        (t as any).status === 'approved' ||
        (t as any).approved === true;
      const isRejected =
        !isApproved &&
        (t.approvalStatus === 'rejected' || (t as any).status === 'rejected');
      return !isApproved && !isRejected;
    }).length;
  }, [tutors]);

  // Compute all words from routines and live sessions for Personal Dictionary
  const wordsFromRoutines = useMemo(() => {
    const list: Array<{ word: string; sourceActivityName?: string; sourceDay?: DayOfWeek }> = [];
    if (routinesByDay && typeof routinesByDay === 'object') {
      (Object.keys(routinesByDay) as DayOfWeek[]).forEach((day) => {
        (routinesByDay[day] || []).forEach((act) => {
          (act?.learnedWords || []).forEach((w) => {
            if (w && w.trim()) {
              list.push({
                word: w.trim(),
                sourceActivityName: act.activityName,
                sourceDay: day,
              });
            }
          });
        });
      });
    }

    // Also include vocabulary words noted by teacher during live lessons
    (lessons || []).forEach((l) => {
      if (l && Array.isArray(l.vocabularyNotes) && l.vocabularyNotes.length > 0) {
        l.vocabularyNotes.forEach((vn) => {
          if (vn && vn.word && vn.word.trim()) {
            list.push({
              word: vn.word.trim(),
              sourceActivityName: `Live Session with ${l.teacherName || 'Native Friend'}`,
            });
          }
        });
      }
    });

    return list;
  }, [routinesByDay, lessons]);

  // Phase 2.2E / Etapa 5: Unified consolidated active dictionary library
  // Combines previous & current routine words, Native Friends notes, manual additions,
  // rich definitions, and excludes persistent deletions.
  const consolidatedActiveDictionary = useMemo(() => {
    return buildConsolidatedActiveDictionary(
      studentDictionaryEntries,
      wordsFromRoutines,
      excludedDictionaryWords,
      userProfile?.level,
      currentAccount?.uid,
      currentAccount?.email
    );
  }, [studentDictionaryEntries, wordsFromRoutines, excludedDictionaryWords, userProfile?.level, currentAccount?.uid, currentAccount?.email]);

  // Handler: Save Daily Sentence and persist in Firestore Journal
  const handleSaveDailySentence = async (
    sentence: string,
    wordsUsed: string[],
    evaluationResult?: WritingEvaluationResult | null
  ) => {
    const studentUid = currentAccount?.uid || userProfile?.id || '';
    const studentEmail = (currentAccount?.email || userProfile?.email || '').toLowerCase().trim();

    const effectiveWords = (wordsUsed && wordsUsed.length > 0)
      ? wordsUsed
      : (evaluationResult?.usedWords && evaluationResult.usedWords.length > 0)
      ? evaluationResult.usedWords
      : [];

    const newJournalEntry: DailyJournalEntry = {
      id: `journal_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      date: new Date().toISOString().split('T')[0],
      sentence,
      wordsUsed: effectiveWords,
      usedWords: effectiveWords,
      correctedSentence: evaluationResult?.correctedSentence,
      explanation:
        evaluationResult?.explanation ||
        evaluationResult?.sentenceFeedback?.explanationPt ||
        evaluationResult?.sentenceFeedback?.explanationEn ||
        evaluationResult?.overallSummaryPt ||
        '',
      hasErrors: evaluationResult?.hasAnyError,
      evaluationResult: evaluationResult || null,
      createdAt: new Date().toISOString(),
      studentUid,
      studentEmail,
    };

    setDailyJournalEntries((prev) => [newJournalEntry, ...prev.filter((e) => e.id !== newJournalEntry.id)]);

    setUserProfile((prev) => ({
      ...prev,
      dailyJournalEntries: [
        newJournalEntry,
        ...(prev.dailyJournalEntries || []).filter((e) => e.id !== newJournalEntry.id),
      ],
    }));

    // Phase 2.2E (Etapas 1 & 2):
    // 1. Frase do Dia is strictly saved in My Journal via saveStudentJournalEntryToFirestore.
    // 2. No recordActivityInStudentJournal call (removes S-Path video_day collateral checkmark).
    // 3. No markVocabularyWordsPracticedInFirestore call (removes practiceCount/history contamination).
    if (studentUid || studentEmail) {
      saveStudentJournalEntryToFirestore(studentUid, newJournalEntry, studentEmail);
    }

    setNotifications((prev) => [
      {
        id: `notif-${Date.now()}`,
        title: currentLanguage === 'en' ? 'Sentence Saved to Journal!' : 'Frase Salva no Diário!',
        message: sentence,
        type: 'success',
        timestamp: new Date().toISOString(),
        read: false,
      },
      ...prev,
    ]);
  };

  const handleDeleteJournalEntry = async (entryId: string) => {
    setDailyJournalEntries((prev) => prev.filter((e) => e.id !== entryId));
    setUserProfile((prev) => ({
      ...prev,
      dailyJournalEntries: (prev.dailyJournalEntries || []).filter((e) => e.id !== entryId),
    }));

    const studentUid = currentAccount?.uid || userProfile?.id || '';
    const studentEmail = (currentAccount?.email || userProfile?.email || '').toLowerCase().trim();
    if (studentUid || studentEmail) {
      deleteStudentJournalEntryFromFirestore(studentUid, entryId, studentEmail).catch(() => {});
    }
  };

  // Comprehensive Teachers list for scheduling dropdowns, matching, and controls
  const teachersList = useMemo(() => {
    const teacherMap = new Map<string, GoogleAccount>();

    // 1. From availableAccounts
    availableAccounts.forEach((a) => {
      if (a.role === 'teacher' || a.role === 'admin') {
        const email = (a.email || '').toLowerCase().trim();
        if (email) teacherMap.set(email, { ...a, email });
      }
    });

    // 2. From all approved tutors list (coexistence of all Native Friends)
    tutors.forEach((t) => {
      if (!t) return;
      const isApproved =
        t.approvalStatus === 'approved' ||
        t.isApproved === true ||
        (t as any).status === 'approved' ||
        (t as any).approved === true;
      if (isApproved) {
        const key = (t.email || t.id || '').toLowerCase().trim();
        if (key) {
          const existing = teacherMap.get(key) || ({} as GoogleAccount);
          teacherMap.set(key, {
            ...existing,
            ...t,
            id: t.id || existing.id || `teacher-${key}`,
            name: t.name || existing.name || (t.email ? t.email.split('@')[0] : 'Native Friend'),
            email: t.email || existing.email || '',
            role: 'teacher',
            avatar: t.avatar || existing.avatar || '',
            picture: t.avatar || existing.picture || '',
          });
        }
      }
    });

    // 3. From current student's assigned teacher if present
    if (userProfile.teacherEmail) {
      const email = (userProfile.teacherEmail || '').toLowerCase().trim();
      if (email && !teacherMap.has(email)) {
        teacherMap.set(email, {
          id: `teacher-${email}`,
          name: userProfile.teacherName || email.split('@')[0],
          email,
          role: 'teacher',
        });
      }
    }

    return Array.from(teacherMap.values());
  }, [availableAccounts, tutors, userProfile.teacherEmail, userProfile.teacherName]);

  // Comprehensive Students list for teacher filtering, schedule modals, and student management
  const studentsList = useMemo(() => {
    const studentMap = new Map<string, GoogleAccount>();
    const isTeacher = currentAccount?.role === 'teacher' || currentAccount?.role === 'admin';
    const teacherEmailClean = (currentAccount?.email || '').toLowerCase().trim();
    const teacherUid = (currentAccount?.id || (currentAccount as any)?.uid || '').trim();
    const isAdmin = currentAccount?.role === 'admin';

    const isMatchingTeacher = (sTeacherEmail?: string, sTeacherUid?: string, _sTeacherName?: string) => {
      if (isAdmin) return true;
      const cleanSTeacher = (sTeacherEmail || '').toLowerCase().trim();
      const cleanSTeacherUid = (sTeacherUid || '').trim();

      if (teacherUid && cleanSTeacherUid && teacherUid === cleanSTeacherUid) return true;
      if (teacherEmailClean && cleanSTeacher && teacherEmailClean === cleanSTeacher) return true;

      return false;
    };

    // 1. From backend students array
    (students || []).forEach((s) => {
      if (!s) return;
      const email = (s.email || s.studentEmail || '').toLowerCase().trim();
      const sTeacher = (s.teacherEmail || '').toLowerCase().trim();
      const sTeacherUid = (s.teacherUid || (s as any).assignedTeacherId || '').trim();
      const sTeacherName = (s.teacherName || '').toLowerCase().trim();
      const sStatus = s.status || (s as any).enrollmentStatus;

      if (!email) return;

      // Strictly filter out cancelled or unenrolled students
      if (sStatus === 'cancelled' || sStatus === 'not_enrolled') return;

      // If teacher is logged in, strictly enforce that student is assigned to this teacher
      if (isTeacher) {
        if (!isMatchingTeacher(sTeacher, sTeacherUid, sTeacherName)) return;
      }

      // Check if any lesson or record has canonical UID for this student
      const lessonWithUid = (lessons || []).find(
        (l) => (l.studentEmail || '').toLowerCase().trim() === email && l.studentUid && isValidCanonicalUid(l.studentUid) && l.studentUid !== teacherUid && l.studentUid !== sTeacherUid
      );
      const studentCanonicalUid =
        (s.uid && isValidCanonicalUid(s.uid) && s.uid !== teacherUid && s.uid !== sTeacherUid ? s.uid : null) ||
        (lessonWithUid?.studentUid ? lessonWithUid.studentUid : null) ||
        ((s as any).studentUid && isValidCanonicalUid((s as any).studentUid) && (s as any).studentUid !== teacherUid && (s as any).studentUid !== sTeacherUid ? (s as any).studentUid : null) ||
        (s.id && isValidCanonicalUid(s.id) && s.id !== teacherUid && s.id !== sTeacherUid ? s.id : null);

      studentMap.set(email, {
        ...s,
        id: studentCanonicalUid || (s.id && s.id !== teacherUid ? s.id : (s as any).uid || `st-${email}`),
        uid: studentCanonicalUid || (s as any).uid && (s as any).uid !== teacherUid ? (s as any).uid : undefined,
        studentUid: studentCanonicalUid || (s as any).studentUid && (s as any).studentUid !== teacherUid ? (s as any).studentUid : undefined,
        name: s.name || s.studentName || email.split('@')[0],
        studentName: s.name || s.studentName || email.split('@')[0],
        email,
        studentEmail: email,
        role: 'student',
        level: s.level || s.studentLevel || EnglishLevel.BEGINNER,
        studentLevel: s.level || s.studentLevel || EnglishLevel.BEGINNER,
        teacherEmail: s.teacherEmail || '',
        teacherName: s.teacherName || '',
        teacherUid: sTeacherUid || teacherUid,
        status: sStatus || 'active',
      } as any);
    });

    // 2. From availableAccounts (ONLY when NOT viewing as a teacher)
    if (!isTeacher) {
      availableAccounts.forEach((a) => {
        if (a && a.role === 'student') {
          const email = (a.email || '').toLowerCase().trim();
          if (email) {
            const existing = studentMap.get(email) || ({} as GoogleAccount);
            studentMap.set(email, {
              ...existing,
              ...a,
              id: a.id || (a as any).uid || existing.id || `st-${email}`,
              name: a.name || (existing as any).studentName || email.split('@')[0],
              studentName: a.name || (existing as any).studentName || email.split('@')[0],
              email,
              studentEmail: email,
              role: 'student',
              level: (a as any).level || (existing as any).level || EnglishLevel.BEGINNER,
              studentLevel: (a as any).level || (existing as any).studentLevel || EnglishLevel.BEGINNER,
            } as any);
          }
        }
      });
    }

    // 3. From current lessons (ONLY for this teacher if viewing as teacher)
    (lessons || []).forEach((l) => {
      if (!l) return;
      const email = (l.studentEmail || '').toLowerCase().trim();
      if (!email) return;

      if (isTeacher) {
        if (l.status === 'cancelled') return;
        const lTeacherEmail = (l.teacherEmail || (l as any).tutorEmail || '').toLowerCase().trim();
        const lTeacherUid = (l.teacherUid || (l as any).tutorUid || '').trim();
        const lTeacherName = (l.teacherName || '').toLowerCase().trim();
        if (!isMatchingTeacher(lTeacherEmail, lTeacherUid, lTeacherName)) return;
      }

      // Check if student is explicitly unenrolled or cancelled
      const knownStudent = (students || []).find(
        (s) => Boolean(s) && (s.email || s.studentEmail || '').toLowerCase().trim() === email
      );
      if (knownStudent) {
        const kStatus = knownStudent.status || (knownStudent as any).enrollmentStatus;
        if (kStatus === 'cancelled' || kStatus === 'not_enrolled') return;
      }

      const existing = studentMap.get(email) || ({} as GoogleAccount);
      const lessonStudentUid = (l.studentUid && isValidCanonicalUid(l.studentUid) && l.studentUid !== teacherUid) ? l.studentUid : undefined;
      studentMap.set(email, {
        ...existing,
        id: (existing.id && !existing.id.startsWith('st-') && existing.id !== teacherUid) ? existing.id : (lessonStudentUid || existing.id || `st-${email}`),
        uid: existing.uid && existing.uid !== teacherUid ? existing.uid : lessonStudentUid,
        studentUid: (existing as any).studentUid && (existing as any).studentUid !== teacherUid ? (existing as any).studentUid : lessonStudentUid,
        name: existing.name || l.studentName || email.split('@')[0],
        studentName: (existing as any).studentName || l.studentName || email.split('@')[0],
        email,
        studentEmail: email,
        role: 'student',
        teacherEmail: (existing as any).teacherEmail || l.teacherEmail || '',
        teacherName: (existing as any).teacherName || l.teacherName || '',
        teacherUid: (existing as any).teacherUid || l.teacherUid || '',
      } as any);
    });

    // 4. Current user if student
    if (currentAccount?.role === 'student' && currentAccount.email) {
      const email = currentAccount.email.toLowerCase().trim();
      const existing = studentMap.get(email) || ({} as GoogleAccount);
      studentMap.set(email, {
        ...existing,
        ...currentAccount,
        id: currentAccount.id || (currentAccount as any).uid || existing.id || `st-${email}`,
        name: userProfile.name || currentAccount.name || existing.name || email.split('@')[0],
        studentName: userProfile.name || currentAccount.name || (existing as any).studentName || email.split('@')[0],
        email,
        studentEmail: email,
        role: 'student',
        teacherEmail: userProfile.teacherEmail || (existing as any).teacherEmail || '',
        teacherName: userProfile.teacherName || (existing as any).teacherName || '',
        teacherUid: (userProfile as any).teacherUid || (existing as any).teacherUid || '',
        level: userProfile.level || (existing as any).level || 'iniciante',
      } as any);
    }

    return Array.from(studentMap.values()).filter((st) => {
      if (!st) return false;
      const email = (st.email || (st as any).studentEmail || '').toLowerCase().trim();
      return Boolean(email && email.includes('@') && !email.includes('test-student'));
    });
  }, [students, availableAccounts, lessons, currentAccount, userProfile, currentTutorProfile]);

  return (
    <div className="min-h-screen bg-[#FAFCFF] text-[#000035] flex flex-col font-sans selection:bg-[#9AB4FF]/40 selection:text-[#000035]">
      {/* 1. Conditional View Rendering: Landing Page vs Dashboard vs Find Tutors */}
      {viewMode === 'landing' || (!currentAccount && viewMode !== 'find-tutors') ? (
        <LandingPage
          tutors={tutors}
          currentLanguage={currentLanguage}
          onToggleLanguage={setCurrentLanguage}
          currentAccount={currentAccount}
          landingContent={landingContent || undefined}
          onOpenAdminLandingEditor={() => setIsAdminLandingEditorOpen(true)}
          onOpenAdminApprovals={() => setIsAdminApprovalsOpen(true)}
          pendingApprovalsCount={pendingApprovalsCount}
          onLogout={handleLogout}
          onStartLivingInEnglish={handleStartLivingInEnglish}
          onOpenAuthModal={(mode, role = 'student') => {
            setAuthModalMode(mode);
            setAuthModalRole(role);
            setIsAuthModalOpen(true);
          }}
          onOpenBecomeTutorModal={() => setIsBecomeTutorModalOpen(true)}
          onGoToDashboard={() => {
            if (currentAccount) {
              setViewMode('dashboard');
            } else {
              setAuthModalMode('login');
              setAuthModalRole('student');
              setIsAuthModalOpen(true);
            }
          }}
          onBookLessonWithTutor={(tutor) => {
            const targetIdentifier = tutor.email || tutor.id;
            setTeacherEmailForConfig(targetIdentifier);
            if (currentAccount?.role === 'student') {
              handleUpdateSubscription(targetIdentifier, tutor.name);
            }
            setIsScheduleModalOpen(true);
          }}
          onSendMessageToTutor={(tutor) => {
            setNotifications((prev) => [
              {
                id: `msg-${Date.now()}`,
                title: currentLanguage === 'en' ? `Message to ${tutor.name}` : `Mensagem para ${tutor.name}`,
                message: currentLanguage === 'en'
                  ? `Opening direct chat with ${tutor.name}.`
                  : `Iniciando conversa com ${tutor.name}.`,
                type: 'info',
                timestamp: new Date().toISOString(),
                read: false,
              },
              ...prev,
            ]);
          }}
        />
      ) : viewMode === 'find-tutors' ? (
        <div className="flex-1 flex flex-col">
          {/* Top Navbar */}
          <Navbar
            userProfile={userProfile}
            currentAccount={currentAccount}
            currentLanguage={currentLanguage}
            t={t}
            onToggleLanguage={setCurrentLanguage}
            onOpenAccountModal={() => {
              setAuthModalMode('login');
              setAuthModalRole('student');
              setIsAuthModalOpen(true);
            }}
            onOpenStudentProfile={() => setIsStudentProfileOpen(true)}
            onOpenTeacherProfile={() => setIsEditTutorProfileOpen(true)}
            onOpenAdminApprovals={() => setIsAdminApprovalsOpen(true)}
            onOpenAdminLandingEditor={() => setIsAdminLandingEditorOpen(true)}
            pendingTutorsCount={pendingApprovalsCount}
            onGoToLanding={() => setViewMode('landing')}
            onFindTutors={() => setViewMode('find-tutors')}
            onLogout={handleLogout}
            timeZone={isTeacher ? DEFAULT_TEACHER_TIMEZONE : DEFAULT_STUDENT_TIMEZONE}
            onOpenJournal={() => setIsJournalModalOpen(true)}
            tutors={tutors}
            lessons={lessons}
            students={studentsList}
          />

          <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8 space-y-6 sm:space-y-8">
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => {
                  if (currentAccount) {
                    setViewMode('dashboard');
                  } else {
                    setViewMode('landing');
                  }
                }}
                className="px-4 py-2 rounded-xl bg-white border border-[#607EC9]/30 text-[#062863] font-bold text-xs sm:text-sm hover:bg-[#9AB4FF]/15 transition cursor-pointer shadow-2xs"
              >
                ← {currentLanguage === 'en' ? (currentAccount ? 'Back to Practice Space' : 'Back to Home') : (currentAccount ? 'Voltar ao Seu Espaço de Prática' : 'Voltar ao Início')}
              </button>

              <button
                type="button"
                onClick={() => setIsBecomeTutorModalOpen(true)}
                className="px-4 py-2 rounded-xl bg-[#062863] text-white font-bold text-xs sm:text-sm hover:bg-[#000035] transition cursor-pointer shadow-xs"
              >
                {currentLanguage === 'en' ? '+ Become a Native Friend' : '+ Seja um Amigo Nativo'}
              </button>
            </div>

            <FindTutorsSection
              tutors={tutors}
              currentLanguage={currentLanguage}
              onBookLesson={(tutor) => {
                const targetIdentifier = tutor.email || tutor.id;
                setTeacherEmailForConfig(targetIdentifier);
                if (currentAccount?.role === 'student') {
                  handleUpdateSubscription(targetIdentifier, tutor.name);
                }
                setIsScheduleModalOpen(true);
              }}
              onSendMessage={(tutor) => {
                setNotifications((prev) => [
                  {
                    id: `msg-${Date.now()}`,
                    title: `Chat with ${tutor.name}`,
                    message: currentLanguage === 'en'
                      ? `Chat window opened for ${tutor.name}.`
                      : `Janela de chat aberta com ${tutor.name}.`,
                    type: 'info',
                    timestamp: new Date().toISOString(),
                    read: false,
                  },
                  ...prev,
                ]);
              }}
              onSelectMentor={(tutor) => {
                if (!currentAccount) {
                  setAuthModalMode('signup');
                  setAuthModalRole('student');
                  setIsAuthModalOpen(true);
                  return;
                }
                setSubscriptionTargetTutor(tutor);
                setIsManageSubscriptionOpen(true);
              }}
              selectedMentorEmail={userProfile?.teacherEmail}
            />

            <EnglishMomentsShowcase
              currentLanguage={currentLanguage}
              onExploreRoutines={() => setViewMode('dashboard')}
            />
          </main>
        </div>
      ) : (
        <>
          {/* Global Navigation Bar */}
          <Navbar
            userProfile={userProfile}
            currentAccount={currentAccount}
            currentLanguage={currentLanguage}
            t={t}
            onToggleLanguage={setCurrentLanguage}
            onOpenAccountModal={() => {
              setAuthModalMode('login');
              setAuthModalRole('student');
              setIsAuthModalOpen(true);
            }}
            onOpenStudentProfile={() => {
              if (currentAccount?.role === 'teacher') {
                setIsEditTutorProfileOpen(true);
              } else {
                setIsStudentProfileOpen(true);
              }
            }}
            onOpenTeacherProfile={() => setIsEditTutorProfileOpen(true)}
            onOpenAdminApprovals={() => setIsAdminApprovalsOpen(true)}
            onOpenAdminLandingEditor={() => setIsAdminLandingEditorOpen(true)}
            pendingTutorsCount={pendingApprovalsCount}
            onGoToLanding={() => setViewMode('landing')}
            onFindTutors={() => setViewMode('find-tutors')}
            onLogout={handleLogout}
            timeZone={isTeacher ? DEFAULT_TEACHER_TIMEZONE : DEFAULT_STUDENT_TIMEZONE}
            onOpenJournal={() => setIsJournalModalOpen(true)}
            tutors={tutors}
            lessons={lessons}
            students={studentsList}
          />

          {/* Notification Toast Banner */}
          <NotificationBanner
            notifications={notifications}
            onDismiss={(id) => setNotifications((prev) => prev.filter((n) => n.id !== id))}
          />

          {/* Main Dashboard Workspace Container */}
          <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8 space-y-6">
            {/* TEACHER / ADMIN VIEW */}
            {isTeacher ? (
              <div className="space-y-6">
                {/* Admin Management Bar */}
                {currentAccount?.role === 'admin' && (
                  <div className="bg-gradient-to-r from-amber-500/10 via-amber-500/5 to-transparent border border-amber-300/80 rounded-3xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-sm">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-2xl bg-amber-500 text-white flex items-center justify-center font-black shadow-md shrink-0">
                        <ShieldCheck className="w-6 h-6" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h2 className="text-base sm:text-lg font-black text-[#000035]">
                            Administrator Control Panel
                          </h2>
                          <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-300">
                            System Administrator
                          </span>
                        </div>
                        <p className="text-xs text-slate-600">
                          Review pending Native Friend applications and manage homepage content.
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <button
                        type="button"
                        onClick={() => setIsAdminApprovalsOpen(true)}
                        className="relative px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-extrabold text-xs transition cursor-pointer shadow-xs flex items-center gap-2"
                      >
                        <ShieldCheck className="w-4 h-4" />
                        <span>Native Friend Approvals</span>
                        {pendingApprovalsCount > 0 && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-white text-amber-700">
                            {pendingApprovalsCount} pending
                          </span>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => setIsAdminLandingEditorOpen(true)}
                        className="px-4 py-2 rounded-xl bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 font-bold text-xs transition cursor-pointer shadow-2xs flex items-center gap-2"
                      >
                        <Edit3 className="w-4 h-4 text-slate-600" />
                        <span>Edit Landing Page</span>
                      </button>
                    </div>
                  </div>
                )}

                {/* 1. Teacher Master Schedule Control */}
                <TeacherScheduleControlTable
                  lessons={lessons}
                  teachers={teachersList}
                  students={studentsList}
                  teacherMeetSettings={teacherMeetSettings}
                  currentAccount={currentAccount}
                  tutorProfile={currentTutorProfile}
                  selectedStudentFilter={selectedStudentFilter}
                  onSelectStudentFilter={handleSelectStudentFilter}
                  activeStudentActivity={activeStudentActivity}
                  onSelectStudentActivity={(act) => handleToggleStudentActivity(act)}
                  onOpenScheduleModal={() => setIsScheduleModalOpen(true)}
                  onOpenTeacherMeetConfig={(email) => {
                    setTeacherEmailForConfig(email);
                    setIsMeetConfigModalOpen(true);
                  }}
                  onOpenEditProfile={() => setIsEditTutorProfileOpen(true)}
                  onCompleteLesson={handleCompleteLesson}
                  onMarkNotCompleted={(lesson) => {
                    setActiveLessonForAction(lesson);
                    setIsNotCompletedModalOpen(true);
                  }}
                  onRescheduleLesson={(lesson) => {
                    setActiveLessonForAction(lesson);
                    setIsRescheduleModalOpen(true);
                  }}
                  onCancelLesson={handleCancelLesson}
                  onAcceptReschedule={handleAcceptReschedule}
                  onDeclineReschedule={handleDeclineReschedule}
                  currentLanguage="en"
                  t={getTranslations('en')}
                  timeZone={DEFAULT_TEACHER_TIMEZONE}
                />

                {/* Minimalist & Practical Student Workspace: Displayed when a specific student is filtered */}
                {selectedStudentFilter && selectedStudentFilter !== 'all' ? (() => {
                  const filterClean = (selectedStudentFilter || '').toLowerCase().trim();
                  const found = studentsList.find(
                    (s) =>
                      Boolean(s) &&
                      (((s.email || '').toLowerCase().trim() === filterClean) ||
                        s.uid === selectedStudentFilter ||
                        s.id === selectedStudentFilter)
                  );
                  const stEmail = found?.email || selectedStudentFilter || '';
                  const stCleanEmail = (stEmail || '').toLowerCase().trim();
                  const stName = found?.name || (found as any)?.studentName || (found as any)?.fullName || (stEmail ? stEmail.split('@')[0] : 'Student');
                  const stLevel = found?.level || (found as any)?.studentLevel || 'intermediate';
                  const stAvatar = (found as any)?.avatarUrl || (found as any)?.photoUrl || (found as any)?.picture || '';
                  const stWeeklyCycle = (found as any)?.weeklyCycle || userProfile?.weeklyCycle || 1;
                  const stTimezone = (found as any)?.studentTimezone || (found as any)?.timezone || userProfile?.studentTimezone || 'America/Sao_Paulo';
                  const stActiveDays = (found as any)?.weeklyStudyDays || userProfile?.weeklyStudyDays;
                  const stActiveDaysCount = (found as any)?.weeklyStudyDaysTarget || userProfile?.weeklyStudyDaysTarget || 5;
                  const teacherUidVal = currentAccount?.uid || (currentTutorProfile as any)?.uid || currentTutorProfile?.id || '';
                  const teacherNameVal = currentAccount?.name || currentTutorProfile?.name;
                  const teacherEmailVal = currentAccount?.email || currentTutorProfile?.email;

                  // Student's scheduled lessons
                  const studentLessons = (lessons || []).filter((l) => {
                    if (!l || l.status === 'cancelled') return false;
                    const lEmail = (l.studentEmail || '').toLowerCase().trim();
                    return Boolean(stCleanEmail && lEmail === stCleanEmail);
                  });

                  // Resolve canonical student UID from all verified available sources (strictly excluding teacher UID)
                  const lessonWithUid = studentLessons.find((l) => l.studentUid && isValidCanonicalUid(l.studentUid) && l.studentUid !== teacherUidVal) ||
                    (lessons || []).find((l) => (l.studentEmail || '').toLowerCase().trim() === stCleanEmail && l.studentUid && isValidCanonicalUid(l.studentUid) && l.studentUid !== teacherUidVal);

                  const canonicalUidCandidate =
                    (found?.uid && isValidCanonicalUid(found.uid) && found.uid !== teacherUidVal ? found.uid : '') ||
                    (lessonWithUid?.studentUid ? lessonWithUid.studentUid : '') ||
                    ((found as any)?.studentUid && isValidCanonicalUid((found as any).studentUid) && (found as any).studentUid !== teacherUidVal ? (found as any).studentUid : '') ||
                    (isValidCanonicalUid(selectedStudentFilter) && selectedStudentFilter !== teacherUidVal ? selectedStudentFilter : '') ||
                    (found?.id && isValidCanonicalUid(found.id) && found.id !== teacherUidVal ? found.id : '');

                  const stUid = canonicalUidCandidate || (stCleanEmail ? toDeterministicCanonicalStudentUid(stCleanEmail) : '') || (found?.uid && found.uid !== teacherUidVal ? found.uid : '') || (found?.id && !found.id.startsWith('tutor-') && found.id !== teacherUidVal ? found.id : '') || '';

                  return (
                    <div className="space-y-5 animate-in fade-in duration-200" id="filtered-student-workspace">
                      {/* 1. Student Profile Header Bar with Minimalist Activity Buttons */}
                      <div className="bg-white rounded-2xl border border-[#607EC9]/30 shadow-sm overflow-hidden" id="student-activity-section">
                        {/* Header Info */}
                        <div className="p-4 sm:p-5 bg-gradient-to-r from-[#000035] via-[#062863] to-[#000035] text-white flex flex-col md:flex-row md:items-center justify-between gap-4">
                          <div className="flex items-center gap-3.5">
                            {stAvatar ? (
                              <img
                                src={stAvatar}
                                alt={stName}
                                className="w-12 h-12 rounded-2xl object-cover border-2 border-white/20 shadow-xs"
                                referrerPolicy="no-referrer"
                              />
                            ) : (
                              <div className="w-12 h-12 rounded-2xl bg-white/10 border border-white/20 flex items-center justify-center text-white font-bold text-lg shadow-xs">
                                {stName.charAt(0).toUpperCase()}
                              </div>
                            )}
                            <div>
                              <h2 className="text-lg sm:text-xl font-black text-white tracking-tight">
                                {stName}
                              </h2>
                              <p className="text-xs text-slate-300 mt-0.5">{stEmail}</p>
                            </div>
                          </div>

                          {/* Action Button: Clear Filter */}
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => setSelectedStudentFilter('all')}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/15 hover:bg-white/25 text-white text-xs font-bold transition cursor-pointer shrink-0"
                              title="Clear student filter and return to full schedule"
                            >
                              <X className="w-3.5 h-3.5" />
                              <span>Show All Students</span>
                            </button>
                          </div>
                        </div>

                        {/* Minimalist 3 Activity Buttons */}
                        <div className="p-3 sm:p-4 bg-slate-50 border-t border-slate-200/80">
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                            <div className="text-xs font-bold text-slate-700">
                              <span>Student Activity:</span>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 w-full sm:w-auto">
                              {/* 1. Insights & Icebreaks Button */}
                              <button
                                type="button"
                                onClick={() => handleToggleStudentActivity('insights')}
                                className={`flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-extrabold transition cursor-pointer shadow-xs ${
                                  activeStudentActivity === 'insights'
                                    ? 'bg-[#000035] text-white ring-2 ring-[#1C4C96]/60 shadow-xs'
                                    : 'bg-white hover:bg-slate-50 text-[#000035] border border-slate-200'
                                }`}
                              >
                                <Sparkles className={`w-4 h-4 ${activeStudentActivity === 'insights' ? 'text-amber-300' : 'text-[#1C4C96]'}`} />
                                <span>Insights & Icebreaks</span>
                                {activeStudentActivity === 'insights' && (
                                  <span className="w-2 h-2 rounded-full bg-amber-300 animate-pulse" />
                                )}
                              </button>

                              {/* 2. Live Lesson Notes Button */}
                              <button
                                type="button"
                                onClick={() => handleToggleStudentActivity('notes')}
                                className={`flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-extrabold transition cursor-pointer shadow-xs ${
                                  activeStudentActivity === 'notes'
                                    ? 'bg-[#000035] text-white ring-2 ring-[#1C4C96]/60 shadow-xs'
                                    : 'bg-white hover:bg-slate-50 text-[#000035] border border-slate-200'
                                }`}
                              >
                                <BookOpen className={`w-4 h-4 ${activeStudentActivity === 'notes' ? 'text-[#9AB4FF]' : 'text-[#1C4C96]'}`} />
                                <span>Live Lesson Notes</span>
                                {activeStudentActivity === 'notes' && (
                                  <span className="w-2 h-2 rounded-full bg-[#9AB4FF] animate-pulse" />
                                )}
                              </button>

                              {/* 3. Videos & Songs Button */}
                              <button
                                type="button"
                                onClick={() => handleToggleStudentActivity('videos_songs')}
                                className={`flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-extrabold transition cursor-pointer shadow-xs ${
                                  activeStudentActivity === 'videos_songs'
                                    ? 'bg-[#000035] text-white ring-2 ring-[#1C4C96]/60 shadow-xs'
                                    : 'bg-white hover:bg-slate-50 text-[#000035] border border-slate-200'
                                }`}
                              >
                                <div className="flex items-center gap-1">
                                  <Video className={`w-4 h-4 ${activeStudentActivity === 'videos_songs' ? 'text-white' : 'text-[#1C4C96]'}`} />
                                  <Headphones className={`w-3.5 h-3.5 ${activeStudentActivity === 'videos_songs' ? 'text-white' : 'text-[#1DB954]'}`} />
                                </div>
                                <span>Videos & Songs</span>
                                {activeStudentActivity === 'videos_songs' && (
                                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                                )}
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Content Area: ONLY the selected activity expands below */}
                      {activeStudentActivity === 'insights' && (
                        <div id="section-student-insights" className="scroll-mt-6 animate-in fade-in duration-200">
                          <NativeFriendLessonInsights
                            studentUid={stUid}
                            studentEmail={stEmail}
                            studentName={stName}
                            studentLevel={stLevel}
                            teacherUid={teacherUidVal}
                            teacherEmail={teacherEmailVal}
                            teacherName={teacherNameVal}
                            weekId={`week-${stWeeklyCycle}`}
                            weeklyCycle={stWeeklyCycle}
                            activeStudyDays={stActiveDays}
                            lessons={studentLessons}
                          />
                        </div>
                      )}

                      {activeStudentActivity === 'notes' && (
                        <div id="section-student-notes" className="scroll-mt-6 animate-in fade-in duration-200">
                          <TeacherLiveLessonNotesPanel
                            lessons={lessons || []}
                            students={students || []}
                            currentAccount={currentAccount || null}
                            selectedStudentFilter={selectedStudentFilter}
                            onSaveLessonNotes={handleSaveLessonNotes}
                            onAddWordsToDictionary={handleAddWordsToDictionary}
                            onAddWordsToWeeklyActivity={handleAddWordsToWeeklyActivity}
                            onSendStudentNotification={handleSendStudentNotification}
                            timeZone={DEFAULT_TEACHER_TIMEZONE}
                          />
                        </div>
                      )}

                      {activeStudentActivity === 'videos_songs' && (
                        <div id="section-student-videos-songs" className="space-y-4 scroll-mt-6 animate-in fade-in duration-200">
                          {/* Minimalist Sub-Toggle between Videos and Songs */}
                          <div className="bg-white p-2.5 rounded-2xl border border-slate-200 shadow-xs flex items-center justify-between gap-3 flex-wrap">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold text-slate-700">Videos and Songs for {stName}:</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => setVideosAndSongsSubTab('videos')}
                                className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                                  videosAndSongsSubTab === 'videos'
                                    ? 'bg-[#062863] text-white shadow-xs border border-[#9AB4FF]/30'
                                    : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                                }`}
                              >
                                <Video className="w-3.5 h-3.5" />
                                <span>YouTube Videos</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => setVideosAndSongsSubTab('songs')}
                                className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                                  videosAndSongsSubTab === 'songs'
                                    ? 'bg-[#1DB954] text-white shadow-xs'
                                    : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                                }`}
                              >
                                <Headphones className="w-3.5 h-3.5" />
                                <span>Spotify Routine & Songs</span>
                              </button>
                            </div>
                          </div>

                          {videosAndSongsSubTab === 'videos' ? (
                            <TeacherMediaAssignmentPanel
                              routinesByDay={routinesByDay}
                              students={studentsList}
                              selectedStudentEmail={selectedStudentFilter}
                              selectedStudentUid={stUid}
                              currentAccount={currentAccount}
                              onTeacherSaveVideos={handleTeacherSaveVideos}
                              currentLanguage="en"
                              t={getTranslations('en')}
                            />
                          ) : (
                            <TeacherSpotifyRoutineTracker
                              studentUid={stUid}
                              studentEmail={stEmail}
                              studentName={stName}
                              studentLevel={stLevel}
                              teacherUid={teacherUidVal}
                              teacherName={teacherNameVal}
                              teacherEmail={teacherEmailVal}
                              weekId={`week-${stWeeklyCycle}`}
                              weeklyCycle={stWeeklyCycle}
                              studentTimezone={stTimezone}
                              activeStudyDays={stActiveDays}
                              activeStudyDaysCount={stActiveDaysCount}
                            />
                          )}
                        </div>
                      )}
                    </div>
                  );
                })() : null}
              </div>
            ) : (
              /* STUDENT VIEW: Exactly Following the 3 User Model Sections */
              <div className="space-y-6" id="student-model-dashboard">
                {/* Section 1: Contracted Lessons & Balance + Fixed Teacher Card + Live 1-on-1 Sessions Panel (Image 1) */}
                <StudentHeaderSection
                  lessons={lessons}
                  currentAccount={currentAccount}
                  userProfile={userProfile}
                  teachers={teachersList}
                  teacherMeetSettings={teacherMeetSettings}
                  contractedLessons={contractedLessons}
                  onUpdateContractedLessons={handleUpdateContractedLessons}
                  onOpenScheduleModal={() => setIsScheduleModalOpen(true)}
                  onOpenManageSubscription={() => setIsManageSubscriptionOpen(true)}
                  onCancelLesson={handleCancelLesson}
                  onAcceptReschedule={handleAcceptReschedule}
                  onDeclineReschedule={handleDeclineReschedule}
                  onCompleteLesson={handleCompleteLesson}
                  onMarkNotCompleted={(lesson) => {
                    setActiveLessonForAction(lesson);
                    setIsNotCompletedModalOpen(true);
                  }}
                  onRescheduleLesson={(lesson) => {
                    setActiveLessonForAction(lesson);
                    setIsRescheduleModalOpen(true);
                  }}
                  currentLanguage={currentLanguage}
                  t={t}
                  timeZone={DEFAULT_STUDENT_TIMEZONE}
                  onVocabularySynced={(syncedEntries) => {
                    setStudentDictionaryEntries((prev) =>
                      consolidateDictionaryEntries(prev, syncedEntries, excludedDictionaryWordsRef.current)
                    );
                  }}
                  onOpenJournal={() => setIsJournalModalOpen(true)}
                />

                {/* Activity Reminders Manager (5-minute alerts based on registered times) */}
                <RoutineRemindersManager
                  key={currentAccount?.email || 'guest'}
                  userProfile={userProfile}
                  routinesByDay={routinesByDay}
                  currentLanguage={currentLanguage}
                  onTriggerNotification={(notif) => setNotifications((prev) => [notif, ...prev])}
                  onNavigateToActivity={(day, activityId) => {
                    setSelectedDay(day);
                    setSelectedActivityId(activityId);
                  }}
                  onOpenDailySentenceModal={() => setIsDailySentenceModalOpen(true)}
                />

                {/* Section 2: Daily Routine Guide STEP BY STEP (Image 2) */}
                <StudentRoutineGuideSection
                  routinesByDay={routinesByDay}
                  selectedDay={selectedDay}
                  onSelectDay={setSelectedDay}
                  selectedActivityId={selectedActivityId}
                  onSelectActivity={setSelectedActivityId}
                  onToggleActivityComplete={handleToggleActivityComplete}
                  onAddCustomActivity={handleAddCustomActivity}
                  onEditActivity={(act) => {
                    setSelectedActivityId(act.id);
                  }}
                  onDeleteActivity={(actId) => {
                    setRoutinesByDay((prev) => {
                      const updated = { ...prev };
                      updated[selectedDay] = (updated[selectedDay] || []).filter((i) => i.id !== actId);
                      return updated;
                    });
                  }}
                  onSaveLearnedWords={handleSaveLearnedWords}
                  onUpdateTimeActivity={handleUpdateActivityTime}
                  userProfile={userProfile}
                  onSaveDailySentence={handleSaveDailySentence}
                  onOpenJournalModal={() => setIsJournalModalOpen(true)}
                  onOpenEmailModal={() => setIsEmailModalOpen(true)}
                  onTest30MinReminder={() => {
                    setNotifications((prev) => [
                      {
                        id: `reminder-${Date.now()}`,
                        title: currentLanguage === 'en' ? '⏰ 30-Minute End of Day Reminder' : '⏰ Lembrete: 30 min para o fim do dia',
                        message: currentLanguage === 'en'
                          ? 'Time to review today’s vocabulary and write your Sentence of the Day in English!'
                          : 'Hora de revisar as palavras da sua rotina de hoje e escrever sua Frase do Dia em inglês!',
                        type: 'info',
                        timestamp: new Date().toISOString(),
                        read: false,
                      },
                      ...prev,
                    ]);
                  }}
                  currentLanguage={currentLanguage}
                  t={t}
                  onAssignVideoToActivity={handleAssignVideoToActivity}
                  weeklyCycle={userProfile?.weeklyCycle || 1}
                  onStartNewWeek={handleStartNewWeek}
                  isStarting={isStartingNewWeek}
                  weeklyChecks={weeklyChecks}
                  studentJournal={studentJournal}
                  onUpdateSPathCheck={handleUpdateSPathCheck}
                  onBehavioralComplete={handleBehavioralActivityComplete}
                  dictionaryEntries={consolidatedActiveDictionary}
                  excludedWords={excludedDictionaryWords}
                  hasConfirmedTrialLesson={hasConfirmedTrialLesson}
                  onScheduleTrialLesson={() => setIsScheduleModalOpen(true)}
                />

                {/* Section 3: Weekly Activity (Image 3) */}
                <StudentWeeklyActivitySection
                  key={`weekly-activity-${normalizeWeekId(userProfile?.weeklyCycle) || 'loading'}`}
                  homework={weeklyHomework}
                  routinesByDay={routinesByDay}
                  userProfile={userProfile}
                  studentJournal={studentJournal}
                  onOpenHomeworkModal={handleOpenHomeworkModal}
                  onOpenDictionaryModal={() => setIsPersonalDictionaryOpen(true)}
                  onOpenJournalModal={() => setIsJournalModalOpen(true)}
                  journalEntriesCount={dailyJournalEntries.length}
                  currentLanguage={currentLanguage}
                  dictionaryEntries={consolidatedActiveDictionary}
                  wordsFromRoutines={wordsFromRoutines}
                  excludedWords={excludedDictionaryWords}
                  onUpdateUserProfile={(partial) => {
                    handleSaveStudentProfile({ ...userProfile, ...partial });
                  }}
                  weeklyChecks={weeklyChecks}
                  onToggleWeeklyCheck={(stepId, dayKey, forcedChecked) => {
                    const isCompleted = typeof forcedChecked === 'boolean'
                      ? forcedChecked
                      : !Boolean(weeklyChecks[`${stepId}_${dayKey}`]);
                    handleUpdateSPathCheck(stepId as any, dayKey, isCompleted);
                  }}
                />
              </div>
            )}
          </main>

          {/* Footer with Discreet Easter Egg on © */}
          <Footer
            currentAccount={currentAccount}
            currentLanguage={currentLanguage}
            t={t}
            footerSlogan={landingContent?.footerSlogan || t.footerSub}
            scrollToSection={() => {}}
            onOpenBecomeTutorModal={() => setIsBecomeTutorModalOpen(true)}
            onOpenAuthModal={(mode, role) => {
              setAuthModalMode(mode);
              setAuthModalRole(role || 'student');
              setIsAuthModalOpen(true);
            }}
            onOpenAdminAuth={() => {
              if (currentAccount?.role === 'admin') {
                setViewMode('dashboard');
                setIsAdminApprovalsOpen(true);
                try {
                  window.history.replaceState({ page: 'admin' }, '', '/admin');
                } catch {}
                return;
              }
              setAuthModalMode('login');
              setAuthModalRole('admin');
              setIsAuthModalOpen(true);
              try {
                window.history.pushState({ page: 'admin' }, '', '/admin');
              } catch {}
            }}
            onOpenAdminApprovals={() => setIsAdminApprovalsOpen(true)}
            onGoToDashboard={() => setViewMode('dashboard')}
          />
        </>
      )}

  {/* 5. Modals & Dialogs (Accessible from anywhere) */}
  {isAuthModalOpen && authModalMode === 'login' ? (
    <LoginModal
      isOpen={isAuthModalOpen && authModalMode === 'login'}
      onClose={() => setIsAuthModalOpen(false)}
      initialRole={authModalRole}
      initialEmail={authInitialEmail}
      currentLanguage={currentLanguage}
      onLoginSuccess={handleLoginSuccess}
      onRoleChange={(role) => setAuthModalRole(role)}
      onShowToast={(title, message, type) => {
        setNotifications((prev) => [
          {
            id: `toast-${Date.now()}`,
            title,
            message,
            type: type || 'warning',
            timestamp: new Date().toISOString(),
            read: false,
          },
          ...prev,
        ]);
      }}
      onOpenOnboarding={(email) => {
        setIsAuthModalOpen(false);
        setOnboardingInitialEmail(email || authInitialEmail || '');
        setIsOnboardingModalOpen(true);
      }}
      onSwitchToSignUp={(role, email) => {
        if (role === 'student') {
          setIsAuthModalOpen(false);
          setOnboardingInitialEmail(email || authInitialEmail || '');
          setIsOnboardingModalOpen(true);
        } else {
          setAuthModalMode('signup');
          setAuthModalRole(role || 'student');
          if (email) setAuthInitialEmail(email);
        }
      }}
    />
  ) : (
    <AuthModal
      isOpen={isAuthModalOpen}
      onClose={() => setIsAuthModalOpen(false)}
      initialMode={authModalMode}
      initialRole={authModalRole}
      initialEmail={authInitialEmail}
      currentLanguage={currentLanguage}
      onLoginSuccess={handleLoginSuccess}
      onOpenOnboarding={(email) => {
        setIsAuthModalOpen(false);
        setOnboardingInitialEmail(email || authInitialEmail || '');
        setIsOnboardingModalOpen(true);
      }}
      onShowToast={(title, message, type) => {
        setNotifications((prev) => [
          {
            id: `toast-${Date.now()}`,
            title,
            message,
            type: type || 'warning',
            timestamp: new Date().toISOString(),
            read: false,
          },
          ...prev,
        ]);
      }}
    />
  )}

  <BecomeTutorModal
    isOpen={isBecomeTutorModalOpen}
    onClose={() => setIsBecomeTutorModalOpen(false)}
    currentLanguage={currentLanguage}
    onSwitchToLogin={(email) => {
      setIsBecomeTutorModalOpen(false);
      setAuthModalRole('teacher');
      setAuthModalMode('login');
      setAuthInitialEmail(email || '');
      setIsAuthModalOpen(true);
    }}
    onRegisteredSuccess={(tutor) => {
      const tutorAccount: GoogleAccount = {
        email: tutor.email,
        name: tutor.name,
        role: 'teacher',
        picture: tutor.avatar,
      };
      const cleanRegEmail = (tutor.email || '').toLowerCase().trim();
      setTutors((prev) => [
        ...prev.filter((t) => (t?.email ? t.email.toLowerCase().trim() !== cleanRegEmail : true)),
        tutor,
      ]);
      setAvailableAccounts((prev) => [
        ...prev.filter((a) => (a?.email ? a.email.toLowerCase().trim() !== cleanRegEmail : true)),
        tutorAccount,
      ]);
      setCurrentAccount(tutorAccount);
      setViewMode('dashboard');
      setNotifications((prev) => [
        {
          id: `tutor-reg-${Date.now()}`,
          title: currentLanguage === 'en' ? 'Registration Complete!' : 'Cadastro Realizado!',
          message: currentLanguage === 'en'
            ? 'Your profile has been created and is pending Administrator approval before public listing.'
            : 'Seu perfil de Amigo Nativo foi criado com sucesso e está pendente de aprovação pelo Administrador para ser exibido publicamente.',
          type: 'info',
          timestamp: new Date().toISOString(),
          read: false,
        },
        ...prev,
      ]);
    }}
  />

  {weeklyHomework && (
    <WeeklyHomeworkModal
      isOpen={isHomeworkModalOpen}
      onClose={() => setIsHomeworkModalOpen(false)}
      homework={weeklyHomework}
      selectedDay={homeworkTargetDay}
      activeStudyDays={userProfile?.weeklyStudyDays}
      weeklyCycle={userProfile?.weeklyCycle || 1}
      weeklyChecks={weeklyChecks}
      onChangeDay={(day) => setHomeworkTargetDay(day)}
      onSaveProgress={(updated) => {
        setWeeklyHomework(updated);
        const uid = currentAccount?.uid || userProfile?.id || (userProfile as any)?.uid || '';
        const email = currentAccount?.email || userProfile?.email || '';
        const currentActiveCycle = parseWeekCycleNumber(userProfile?.weeklyCycle);
        const currentActiveWeekId = normalizeWeekId(currentActiveCycle);
        if (uid || email) {
          saveStudentHomeworkProgressToFirestore(uid, email, updated, currentActiveWeekId || undefined);
        }
      }}
      onRegenerateWithAi={handleRegenerateHomeworkWithAi}
      isGeneratingAi={isGeneratingHomeworkAi}
      onCompleteTodayPart={(partKey, day) => {
        handleUpdateSPathCheck('memorization', day, true);
        const wordsUsed = weeklyHomework?.vocabularyList?.map((w) => w.word) || [];
        if (wordsUsed.length > 0) {
          handleMarkDailyMemorizationPracticed(day, wordsUsed);
        }
      }}
      onSubmitToTeacher={(updated) => {
        setWeeklyHomework(updated);
        const uid = currentAccount?.uid || userProfile?.id || (userProfile as any)?.uid || '';
        const email = currentAccount?.email || userProfile?.email || '';
        const currentActiveCycle = parseWeekCycleNumber(userProfile?.weeklyCycle);
        const currentActiveWeekId = normalizeWeekId(currentActiveCycle);
        if (uid || email) {
          saveStudentHomeworkProgressToFirestore(uid, email, updated, currentActiveWeekId || undefined);
        }
        const wordsUsed = updated?.vocabularyList?.map((w) => w.word) || [];
        if (wordsUsed.length > 0) {
          handleMarkDailyMemorizationPracticed(homeworkTargetDay, wordsUsed);
        }
        setNotifications((prev) => [
          {
            id: `hw-${Date.now()}`,
            title: currentLanguage === 'en' ? 'Weekly Homework Submitted!' : 'Homework Semanal Enviada!',
            message: currentLanguage === 'en'
              ? 'Your weekly exercises and essay have been delivered to your teacher.'
              : 'Seus exercícios e redação semanal foram entregues ao professor com sucesso.',
            type: 'success',
            timestamp: new Date().toISOString(),
            read: false,
          },
          ...prev,
        ]);
      }}
      currentLanguage={currentLanguage}
      t={t}
    />
  )}

      <LiveLessonScheduleModal
        isOpen={isScheduleModalOpen}
        onClose={() => {
          setIsScheduleModalOpen(false);
          setTeacherEmailForConfig('');
          setScheduleStudentInfo(null);
          if (!currentAccount) {
            setViewMode('landing');
          }
        }}
        currentAccount={currentAccount}
        teachers={teachersList}
        tutors={tutors}
        students={studentsList}
        initialTeacherEmail={teacherEmailForConfig || userProfile.teacherEmail}
        teacherMeetSettings={teacherMeetSettings}
        lessons={lessons}
        onSchedule={handleScheduleLesson}
        currentLanguage={isTeacher ? 'en' : currentLanguage}
        t={isTeacher ? getTranslations('en') : t}
        timeZone={isTeacher ? DEFAULT_TEACHER_TIMEZONE : DEFAULT_STUDENT_TIMEZONE}
        userProfile={userProfile}
        initialStudentEmail={scheduleStudentInfo?.email || (currentAccount?.role === 'student' ? currentAccount.email : userProfile?.email)}
        initialStudentName={scheduleStudentInfo?.name || (currentAccount?.role === 'student' ? currentAccount.name : userProfile?.name)}
        initialStudentUid={scheduleStudentInfo?.uid || (currentAccount?.role === 'student' ? currentAccount.uid : (userProfile?.id || userProfile?.uid))}
      />

      <StudentManagementModal
        isOpen={isStudentMgmtModalOpen}
        onClose={() => setIsStudentMgmtModalOpen(false)}
        students={studentsList as any}
        onAddStudent={(newSt) => {
          const created: StudentProfile = { ...newSt, id: `st-${Date.now()}` };
          setStudents((prev) => [...prev, created]);
        }}
        onUpdateStudent={(updated) => {
          setStudents((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
        }}
        onDeleteStudent={(id) => {
          setStudents((prev) => prev.filter((s) => s.id !== id));
        }}
        onSelectStudent={(st) => {
          setSelectedStudentFilter(st.email);
          setIsStudentMgmtModalOpen(false);
        }}
        selectedStudentId={selectedStudentFilter}
        currentLanguage={isTeacher ? 'en' : currentLanguage}
        t={isTeacher ? getTranslations('en') : t}
      />

      <TeacherMeetConfigModal
        isOpen={isMeetConfigModalOpen}
        onClose={() => setIsMeetConfigModalOpen(false)}
        teacherEmail={teacherEmailForConfig}
        teacherUid={
          (currentAccount?.email?.toLowerCase().trim() === teacherEmailForConfig?.toLowerCase().trim()
            ? currentAccount?.uid
            : undefined) ||
          tutors.find((t) => (t.email || '').toLowerCase().trim() === teacherEmailForConfig?.toLowerCase().trim())?.uid
        }
        currentSettings={
          teacherMeetSettings[teacherEmailForConfig?.toLowerCase().trim()] ||
          teacherMeetSettings[teacherEmailForConfig] ||
          (currentAccount?.uid ? teacherMeetSettings[currentAccount.uid] : undefined)
        }
        tutorProfile={
          tutors.find((t) => (t.email || '').toLowerCase().trim() === teacherEmailForConfig?.toLowerCase().trim()) ||
          (isTeacher ? currentTutorProfile : null)
        }
        onSave={handleSaveTeacherMeetSettings}
        currentLanguage="en"
      />

      <RescheduleModal
        isOpen={isRescheduleModalOpen}
        onClose={() => {
          setIsRescheduleModalOpen(false);
          setActiveLessonForAction(null);
        }}
        lesson={activeLessonForAction}
        currentAccount={currentAccount}
        lessons={lessons}
        teacherMeetSettings={teacherMeetSettings}
        onConfirmReschedule={handleConfirmReschedule}
        currentLanguage={isTeacher ? 'en' : currentLanguage}
        timeZone={isTeacher ? DEFAULT_TEACHER_TIMEZONE : DEFAULT_STUDENT_TIMEZONE}
      />

      <NotCompletedModal
        isOpen={isNotCompletedModalOpen}
        onClose={() => {
          setIsNotCompletedModalOpen(false);
          setActiveLessonForAction(null);
        }}
        lesson={activeLessonForAction}
        onConfirm={handleConfirmNotCompleted}
        currentLanguage={isTeacher ? 'en' : currentLanguage}
      />

      <EmailNotificationModal
        isOpen={isEmailModalOpen}
        onClose={() => setIsEmailModalOpen(false)}
        currentAccount={currentAccount}
        userProfile={userProfile}
        teachers={teachersList}
        activityName={currentActivity?.activityName}
        activities={currentDayRoutines.map((r) => ({
          name: r.activityName,
          nameEn: r.activityName,
          time: r.time,
          words: r.learnedWords,
          notes: r.teacherNotes,
        }))}
        dailyPhrase={(userProfile?.dailySentences as any)?.[new Date().toISOString().split('T')[0]]}
        selectedDayName={selectedDay}
        currentLanguage={currentLanguage}
      />

      <ManageSubscriptionModal
        isOpen={isManageSubscriptionOpen}
        onClose={() => {
          setIsManageSubscriptionOpen(false);
          setSubscriptionTargetTutor(null);
        }}
        userProfile={userProfile}
        tutorsList={tutors}
        teachers={teachersList}
        currentLanguage={currentLanguage}
        onUpdateSubscription={handleUpdateSubscription}
        onPurchasePackage={handlePurchasePackage}
        initialSelectedTutor={subscriptionTargetTutor}
        onScheduleTrialLessonWithTutor={(tutor) => {
          setTeacherEmailForConfig(tutor.email || tutor.id);
          setIsManageSubscriptionOpen(false);
          setIsScheduleModalOpen(true);
        }}
      />

      {/* Pre-onboarding Email Verification Modal */}
      <StartLivingEmailModal
        isOpen={isStartLivingModalOpen}
        onClose={() => setIsStartLivingModalOpen(false)}
        currentLanguage={currentLanguage}
        onEmailProceed={(cleanEmail) => {
          setIsStartLivingModalOpen(false);
          setOnboardingInitialEmail(cleanEmail);
          setIsOnboardingModalOpen(true);
        }}
        onEmailVerified={(cleanEmail) => {
          setIsStartLivingModalOpen(false);
          setOnboardingInitialEmail(cleanEmail);
          setIsOnboardingModalOpen(true);
        }}
        onEmailAlreadyExists={(existingEmail) => {
          setIsStartLivingModalOpen(false);
          setNotifications((prev) => [
            {
              id: `toast-${Date.now()}`,
              title: currentLanguage === 'en' ? 'Account exists' : 'Conta já cadastrada',
              message: 'Este e-mail já possui uma conta cadastrada.',
              type: 'warning',
              timestamp: new Date().toISOString(),
              read: false,
            },
            ...prev,
          ]);
          setAuthInitialEmail(existingEmail);
          setAuthModalMode('login');
          setAuthModalRole('student');
          setIsAuthModalOpen(true);
        }}
        onSwitchToLogin={(email) => {
          setIsStartLivingModalOpen(false);
          setAuthInitialEmail(email || '');
          setAuthModalMode('login');
          setAuthModalRole('student');
          setIsAuthModalOpen(true);
        }}
      />

      {/* Multi-step Onboarding Assistant Wizard */}
      <OnboardingWizardModal
        isOpen={isOnboardingModalOpen}
        initialEmail={onboardingInitialEmail}
        onEmailAlreadyExists={(existingEmail) => {
          setIsOnboardingModalOpen(false);
          setNotifications((prev) => [
            {
              id: `toast-${Date.now()}`,
              title: currentLanguage === 'en' ? 'Account exists' : 'Conta já cadastrada',
              message: 'Este e-mail já possui uma conta cadastrada.',
              type: 'warning',
              timestamp: new Date().toISOString(),
              read: false,
            },
            ...prev,
          ]);
          setAuthInitialEmail(existingEmail);
          setAuthModalMode('login');
          setAuthModalRole('student');
          setIsAuthModalOpen(true);
        }}
        onClose={() => {
          setIsOnboardingModalOpen(false);
          // If student closed onboarding before completing mandatory trial lesson, return to initial landing page
          if (!hasConfirmedTrialLesson && (!currentAccount || currentAccount.role === 'student')) {
            setViewMode('landing');
          }
        }}
        currentLanguage={currentLanguage}
        tutorsList={tutors}
        currentUserProfile={userProfile}
        currentAccount={currentAccount}
        onCompleteOnboarding={handleCompleteOnboarding}
        initialStep={userProfile?.teacherEmail || userProfile?.teacherId || userProfile?.teacherUid ? 6 : 1}
        hasCompletedTrialLesson={hasConfirmedTrialLesson}
        onOpenScheduleTrialLesson={(tutor, studentInfo) => {
          setTeacherEmailForConfig(tutor.email || tutor.id);
          if (studentInfo && studentInfo.email) {
            setScheduleStudentInfo(studentInfo);
          } else {
            setScheduleStudentInfo({
              name: userProfile.name,
              email: userProfile.email,
              uid: userProfile.id,
            });
          }
          setIsScheduleModalOpen(true);
        }}
      />

      <DailySentenceModal
        isOpen={isDailySentenceModalOpen}
        onClose={() => setIsDailySentenceModalOpen(false)}
        todayRoutines={currentDayRoutines}
        userProfile={userProfile}
        currentLanguage={currentLanguage}
        onSaveDailySentence={handleSaveDailySentence}
        onOpenJournalModal={() => setIsJournalModalOpen(true)}
        dictionaryEntries={consolidatedActiveDictionary}
        excludedWords={excludedDictionaryWords}
      />

      {/* Admin Landing Content Editor Modal */}
      <AdminLandingEditorModal
        isOpen={isAdminLandingEditorOpen}
        onClose={() => setIsAdminLandingEditorOpen(false)}
        currentContent={landingContent}
        onSave={handleSaveLandingContent}
        currentLanguage={isTeacher ? 'en' : currentLanguage}
      />

      {/* Admin Native Friend Approvals Modal */}
      <AdminApprovalsModal
        isOpen={isAdminApprovalsOpen}
        onClose={() => setIsAdminApprovalsOpen(false)}
        tutors={allTutors}
        onApproveTutor={handleApproveTutor}
        onRejectTutor={handleRejectTutor}
        onDeleteTutor={handleDeleteTutor}
        onRefresh={fetchLatestTutors}
        isRefreshing={isRefreshingTutors}
        currentLanguage={isTeacher ? 'en' : currentLanguage}
        authError={adminAuthError}
      />

      {/* Native Friend Edit Profile Modal */}
      {isEditTutorProfileOpen && currentTutorProfile && (
        <EditTutorProfileModal
          isOpen={isEditTutorProfileOpen}
          onClose={() => setIsEditTutorProfileOpen(false)}
          tutor={currentTutorProfile}
          onSave={handleSaveTutorProfile}
          currentLanguage="en"
        />
      )}

      {/* Student Profile & Photo Modal */}
      <StudentProfileModal
        isOpen={isStudentProfileOpen}
        onClose={() => setIsStudentProfileOpen(false)}
        userProfile={userProfile}
        currentAccount={currentAccount}
        onSave={handleSaveStudentProfile}
        currentLanguage={currentLanguage}
      />

      {/* Student Personal Dictionary Modal */}
      <PersonalDictionaryModal
        isOpen={isPersonalDictionaryOpen}
        onClose={() => setIsPersonalDictionaryOpen(false)}
        wordsFromRoutines={wordsFromRoutines}
        customSavedEntries={studentDictionaryEntries}
        consolidatedEntries={consolidatedActiveDictionary}
        excludedWords={excludedDictionaryWords}
        studentUid={
          (auth?.currentUser?.uid && isValidCanonicalUid(auth.currentUser.uid) ? auth.currentUser.uid : '') ||
          (userProfile?.uid && isValidCanonicalUid(userProfile.uid) ? userProfile.uid : '') ||
          ((currentAccount as any)?.uid && isValidCanonicalUid((currentAccount as any).uid) ? (currentAccount as any).uid : '') ||
          (currentAccount?.id && isValidCanonicalUid(currentAccount.id) ? currentAccount.id : '')
        }
        studentEmail={userProfile?.email || currentAccount?.email}
        studentLevel={userProfile?.level}
        onSaveCustomEntry={handleSaveCustomDictionaryEntry}
        onDeleteEntry={handleDeleteCustomDictionaryEntry}
        onOpenJournalModal={() => setIsJournalModalOpen(true)}
        currentLanguage={currentLanguage}
      />

      {/* Student Journal Modal (Saved & AI Corrected Sentences) */}
      <StudentJournalModal
        isOpen={isJournalModalOpen}
        onClose={() => setIsJournalModalOpen(false)}
        entries={dailyJournalEntries}
        currentLanguage={currentLanguage}
        onDeleteEntry={handleDeleteJournalEntry}
        onOpenDailySentenceSection={() => setIsDailySentenceModalOpen(true)}
      />

      {/* Developer & Admin Real-time Firestore Schema Protection & Migration Alert Banner */}
      <FirestoreSchemaAlertBanner isAdmin={currentAccount?.role === 'admin'} />
    </div>
  );
}
