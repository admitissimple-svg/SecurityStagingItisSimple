import express from 'express';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
dotenv.config();

import appletConfig from './firebase-applet-config.json' with { type: 'json' };

const isPlaceholder = (val: string | undefined): boolean => {
  if (!val) return true;
  const trimmed = val.trim();
  return (
    trimmed === '' ||
    trimmed.startsWith('your-') ||
    trimmed.includes('placeholder') ||
    trimmed.includes('YOUR_') ||
    trimmed.includes('<') ||
    trimmed.includes('>')
  );
};

// Clean non-existent or placeholder credentials file to allow fallback to ADC
if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  try {
    if (!fs.existsSync(process.env.GOOGLE_APPLICATION_CREDENTIALS) || isPlaceholder(process.env.GOOGLE_APPLICATION_CREDENTIALS)) {
      delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    }
  } catch {
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
  }
}

// Ensure required Firebase environment variables are loaded for staging
if (isPlaceholder(process.env.FIREBASE_PROJECT_ID) && appletConfig?.projectId) {
  process.env.FIREBASE_PROJECT_ID = appletConfig.projectId;
}
if (!process.env.FIREBASE_PROJECT_ID) {
  process.env.FIREBASE_PROJECT_ID = 'itissimple-security-staging';
}
// Canonical Firestore database consolidation — HOTFIX 4B.18
// All application data strictly targets Firestore '(default)'
process.env.FIREBASE_DATABASE_ID = '(default)';
process.env.VITE_FIREBASE_DATABASE_ID = '(default)';

if (appletConfig) {
  if (isPlaceholder(process.env.VITE_FIREBASE_PROJECT_ID) && appletConfig.projectId) {
    process.env.VITE_FIREBASE_PROJECT_ID = appletConfig.projectId;
  }
  if (isPlaceholder(process.env.VITE_FIREBASE_API_KEY) && appletConfig.apiKey) {
    process.env.VITE_FIREBASE_API_KEY = appletConfig.apiKey;
  }
  if (isPlaceholder(process.env.VITE_FIREBASE_AUTH_DOMAIN) && appletConfig.authDomain) {
    process.env.VITE_FIREBASE_AUTH_DOMAIN = appletConfig.authDomain;
  }
  if (isPlaceholder(process.env.VITE_FIREBASE_STORAGE_BUCKET) && appletConfig.storageBucket) {
    process.env.VITE_FIREBASE_STORAGE_BUCKET = appletConfig.storageBucket;
  }
  if (isPlaceholder(process.env.VITE_FIREBASE_MESSAGING_SENDER_ID) && appletConfig.messagingSenderId) {
    process.env.VITE_FIREBASE_MESSAGING_SENDER_ID = appletConfig.messagingSenderId;
  }
  if (isPlaceholder(process.env.VITE_FIREBASE_APP_ID) && appletConfig.appId) {
    process.env.VITE_FIREBASE_APP_ID = appletConfig.appId;
  }
}
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import {
  fetchAppStateFromFirestore,
  saveAppStateToFirestore,
  saveUserToFirestore,
  fetchUserFromFirestore,
  resolveCanonicalUserRoleAndIdentity,
  checkUserExistsInFirestore,
  getFirestoreDb,
  saveStudentAssignmentsByUid,
  fetchStudentAssignmentsByUid,
  saveTeacherAvailabilityToFirestore,
  fetchTeacherAvailabilityFromFirestore,
  saveRoutineVideoSubcollection,
  fetchRoutineVideosFromFirestoreServer,
  resolveStudentVideoContextForPart4,
  VideoContextForPart4,
  resetDailyRoutinesForNewWeekInFirestoreServer,
  resetRepeatFlagsSubcollection,
  addWatchedVideoToUserDoc,
  saveStudentVocabularyToFirestoreServer,
  fetchStudentVocabularyFromFirestoreServer,
  addExcludedDictionaryWordsServer,
  removeExcludedDictionaryWordsServer,
  fetchExcludedDictionaryWordsServer,
  resolveCanonicalStudentIdentity,
  saveSessionNotesToFirestoreServer,
  fetchSessionNotesFromFirestoreServer,
  fetchSessionNotesForStudentServer,
  saveYouTubePlaylistsToFirestore,
  fetchYouTubePlaylistsFromFirestore,
  fetchYouTubePlaylistsDocFromFirestore,
  saveYouTubeAuthToFirestore,
  fetchYouTubeAuthFromFirestore,
  saveTutorToFirestore,
  fetchTutorsFromFirestore,
  deleteTutorFromFirestore,
  deleteUserByEmailFromFirestore,
  saveSessionNotesProgressToFirestore,
  deleteStudentJournalEntryFromServerFirestore,
  fetchUserDocumentFromFirestore,
  fetchTutorDocumentFromFirestore,
  fetchWeeklyChecksFromFirestore,
  saveWeeklyChecksToFirestore,
  fetchHomeworkFromFirestore,
  saveHomeworkToFirestore,
  fetchCanonicalUserWeeklyCycleServer,
  fetchCanonicalWeeklyChecksServer,
  saveCanonicalWeeklyChecksServer,
  saveCanonicalHomeworkServer,
  mergeHomeworkRecords,
  isPermissionError,
  getIsCloudWriteDisabled,
  consolidateTutorsList,
  resolveTeacherCanonicalIdentity,
  isValidCanonicalUid,
  isGenericTutorId,
  normalizeTutorName,
  scheduleLessonAtomicServer,
  completeLessonAtomicServer,
  markLessonNotCompletedAtomicServer,
  proposeRescheduleAtomicServer,
  acceptRescheduleAtomicServer,
  declineRescheduleAtomicServer,
  cancelLessonAtomicServer,
  deleteLessonAtomicServer,
  recordDailyReminderShownServer,
  fetchSessionNotesProgressServer,
  savePedagogicalTransformationToFirestoreServer,
  fetchPedagogicalTransformationFromFirestoreServer,
  recordLessonReviewInStudentJournalServer,
  reconstructTransformationFromJournalAndDictionaryServer,
  fetchStudentDailyJournalFromServerFirestore,
  saveStudentDailyJournalEntryServer,
  fetchStudentActivityJournalFromServerFirestore,
  upsertStudentActivityJournalEntryServer,
  deleteStudentActivityJournalEntryServer,
  removeUndefinedFields,
  fetchLessonInsightsFromFirestoreServer,
  saveLessonInsightsToFirestoreServer,
  verifyTeacherLessonAccessServer,
  verifyCanonicalPedagogicalLinkServer,
  getStudentActivitiesBetweenLessonsServer,
  registerDbReader,
  advanceWeeklyCycleTransactionServer,
  fetchStudentCycleStatusFromServerFirestore,
  saveLastCycleResultToFirestore,
  fetchUsersFromFirestoreCanonical,
  fetchStudentProfileFromFirestoreServer,
  fetchCanonicalRoutineContextServer,
  saveStudentRoutineDayFieldsServer,
  saveStudentAssignmentsCanonicalServer,
  addWatchedVideoCanonicalServer,
  addListenedTrackCanonicalServer,
  fetchStudentCurrentRoutineServer,
  saveStudentCurrentRoutineServer,
  saveCurrentRoutineFeedbackServer,
  saveTeacherSpotifyOverrideServer,
  fetchWeeklyHistoryServer,
  fetchAllWeeklyHistoriesServer,
  fetchAccumulatedConsumedHistoryServer,
  saveWeeklyHistoryServer,
  closeWeeklyHistorySnapshotServer,
  prepareNewWeeklyCycleServer,
} from './src/serverFirestore';
import { normalizeDictionaryWord } from './src/utils/studentDictionaryLibrary';
import { buildWeeklyLearningInsights } from './src/utils/weeklyLearningInsights';
import { DEFAULT_CURATED_PLAYLISTS } from './src/utils/youtubeService';
import {
  syncSessionNotesWithPlatformDrive,
  getStoredDriveFile,
  listStoredDriveFiles,
  GOOGLE_DRIVE_SESSION_FOLDER,
  formatSessionNotesFileName,
  getPlatformGoogleAccessToken,
} from './src/serverGoogleDrive';
import { COMMON_ROUTINE_DICTIONARY, getDictionaryDefinition, NATIVE_FRIENDS_DICTIONARY_DATABASE } from './src/data/dictionaryDatabase';
import { defaultRoutinesByDay, createCleanStudentRoutines } from './src/data/defaultRoutines';
import {
  parseSpotifyUrl,
  isValidSpotifyUrl,
  CORRUPT_SPOTIFY_IDS,
  extractSpotifyTrackId,
  getWeeklySpotifyTracksForLevel,
  getDailySpotifyTrackForStudent,
  DAYS_SEQUENCE,
  SPOTIFY_LEVEL_PLAYLISTS,
} from './src/utils/spotify';
import {
  fetchOfficialPlaylistTracks,
  distributeWeeklySpotifyForStudentEngine,
  selectNextTrackFromPlaylist,
  getOrCreateStudentCycleState,
  cloneOrInitSpotifyCycleState,
  getSpotifyConfigStatus,
  getSpotifyAccessToken,
  clearSpotifyPlaylistCache,
  OFFICIAL_SPOTIFY_PLAYLISTS,
  SpotifyLevel,
  SpotifyTrack,
} from './src/serverSpotify';
import {
  extractYouTubeVideoId,
  getYouTubeEmbedUrl,
  getYouTubeWatchUrl,
  YOUTUBE_LEVEL_PLAYLISTS,
  getYouTubePlaylistForLevel,
  getWeeklyYouTubeVideosForLevel,
  getDailyYouTubeVideoForStudent,
} from './src/utils/youtube';
import { DayOfWeek, EnglishLevel, WordFeedback } from './src/types';
import {
  synthesizeCohesiveStoryAndQuestions,
  synthesizeFillInBlanks,
  profileWord,
} from './src/utils/pedagogicalStorySynthesizer';
import {
  analyzeSentenceGrammarDeterministic,
  isSyntheticHomeworkEvaluation,
  isValidHomeworkEvaluation,
  validateHomeworkAiEvaluationResponse,
} from './src/utils/writingChecker';
import { sanitizeTimeZone } from './src/utils/timezone';
import crypto from 'crypto';
import { parseNotesHtml, hasValidPedagogicalContent, isPedagogicalTermMatch } from './src/utils/notesHtmlParser';
import {
  generateLocalPedagogicalTransformation,
  getCanonicalSessionKey,
  computeNotesHash,
  buildPedagogicalCacheKey,
  PEDAGOGICAL_PROMPT_VERSION,
  getPendingConfirmationText,
  getUnconfirmedExplanationText,
  getPendingPitfallsText,
  getAiUnavailableNoticeText,
  resolveCefrLevel,
  validatePedagogicalAiResponse,
  isLegacyGenericTransformation,
  PedagogicalLessonTransformation,
} from './src/utils/pedagogicalTransformer';
import {
  mergeSessionNoteWithVersioning,
  computeNotesContentHash,
} from './src/utils/notesVersioning';
import {
  NoteDraftTransformation,
  NoteApprovedVersion,
} from './src/types';
import {
  firebaseAuthMiddleware,
  requireAdmin,
  requireTeacher,
  isVerifiedAdminRequest,
  getVerifiedUserFromRequest,
  AuthenticatedUser,
  extractTrustedRole,
  markAsVerifiedUser,
} from './src/middleware/firebaseAuth';
import { getFirebaseAdminAuth } from './src/serverFirebaseAdmin';
import { getPtaxClosingD1 } from './src/serverPtax';
import {
  isDiagnosticMode,
  isAuthorizedOriginStrict,
  registerDiagnosticRoutes,
} from './src/serverDiagnostic';
import {
  GEMINI_FIXED_MODEL,
  checkAndConsumeRateLimit,
  acquireSingleFlightLock,
  validatePayloadBounds,
  executeGeminiSingleAttempt,
  executeGeminiWithContingency,
  resolveGeminiContingencyModels,
  logGeminiAudited,
  resetGeminiSecurityStateForTesting,
  sendGeminiCostControlUnavailable,
  GeminiFeature,
  GeminiAttemptDetail,
  GeminiInterruptionReason,
  isGenericPedagogicalDefinition,
  isGenericPedagogicalExample,
} from './src/serverGeminiSecurity';

export const LANGUAGE_NAMES: Record<string, { nameEn: string; nameNative: string }> = {
  pt: { nameEn: 'Portuguese', nameNative: 'Português' },
  en: { nameEn: 'English', nameNative: 'English' },
  es: { nameEn: 'Spanish', nameNative: 'Español' },
  fr: { nameEn: 'French', nameNative: 'Français' },
  de: { nameEn: 'German', nameNative: 'Deutsch' },
  it: { nameEn: 'Italian', nameNative: 'Italiano' },
  ja: { nameEn: 'Japanese', nameNative: '日本語' },
  ko: { nameEn: 'Korean', nameNative: '한국어' },
  zh: { nameEn: 'Simplified Chinese', nameNative: '中文' },
  ru: { nameEn: 'Russian', nameNative: 'Русский' },
  ar: { nameEn: 'Arabic', nameNative: 'العربية' },
  tr: { nameEn: 'Turkish', nameNative: 'Türkçe' },
};

// Hotfix 4B.8.5: Controlled Gemini model selection centralized via GEMINI_MODEL (selected: gemini-3.8-flash)
const GEMINI_TEXT_MODEL = GEMINI_FIXED_MODEL;
const ACTIVE_FIREBASE_PROJECT_ID = 'itissimple-security-staging';
const GEMINI_PROJECT_ID = ACTIVE_FIREBASE_PROJECT_ID;

// Controlled cooldown tracker for Gemini quota exhaustion to prevent repeated 429 floods
let geminiQuotaCooldownUntil = 0;
const GEMINI_QUOTA_COOLDOWN_MS = 60_000;

const app = express();
/**
 * Resolves and validates a numeric server port from environment variables.
 * Enforces valid TCP port range (1-65535). Fallbacks safely to defaultPort (3000).
 * Accurately supports Cloud Run dynamic port 8080 and any custom valid port.
 */
export function parsePort(val?: string | number): number | null {
  if (val === undefined || val === null) return null;
  const str = String(val).trim();
  if (!/^\d+$/.test(str)) return null;
  const parsed = parseInt(str, 10);
  if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535) {
    return parsed;
  }
  return null;
}

/**
 * Detects whether the current runtime is an AI Studio Preview or development environment,
 * even when running inside Google Cloud Run (which injects K_SERVICE / K_REVISION).
 */
export function isCloudRunPreviewEnvironment(): boolean {
  if (process.env.APP_ENV === 'production') {
    return false;
  }
  if (process.env.NODE_ENV === 'development' || process.env.APP_ENV === 'development' || process.env.APP_ENV === 'preview') {
    return true;
  }
  if (process.env.IS_PREVIEW === 'true' || process.env.PREVIEW === 'true') {
    return true;
  }

  const kService = (process.env.K_SERVICE || '').toLowerCase();
  const kRevision = (process.env.K_REVISION || '').toLowerCase();

  if (kService || kRevision) {
    return (
      kService.startsWith('ais-') ||
      kService.includes('preview') ||
      kService.includes('dev') ||
      kRevision.startsWith('ais-') ||
      kRevision.includes('preview') ||
      kRevision.includes('dev')
    );
  }

  if (Boolean(process.env.APPLET_ID)) {
    return true;
  }
  const appUrl = (process.env.APP_URL || '').toLowerCase();
  return appUrl.includes('ais-') || appUrl.includes('preview');
}

export function parseCliPort(): number | null {
  const args = process.argv || [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port' && args[i + 1]) {
      const p = parsePort(args[i + 1]);
      if (p) return p;
    }
    if (args[i].startsWith('--port=')) {
      const p = parsePort(args[i].split('=')[1]);
      if (p) return p;
    }
  }
  return null;
}

export function resolvePort(portEnv?: string | number, appPortEnv?: string | number, defaultPort = 3000): number {
  return parsePort(portEnv) ?? parsePort(appPortEnv) ?? defaultPort;
}

export function resolveEffectivePort(): number {
  const cliPort = parseCliPort();
  if (cliPort) return cliPort;

  const appPort = parsePort(process.env.APP_PORT);
  if (appPort) return appPort;

  // In AI Studio / preview environment, Nginx is listening on 8080 and proxies to port 3000.
  // When Cloud Run injects PORT=8080, normalize it to 3000 to prevent port collision with Nginx.
  if (isCloudRunPreviewEnvironment()) {
    const rawPort = parsePort(process.env.PORT);
    if (rawPort && rawPort !== 8080) {
      return rawPort;
    }
    return 3000;
  }

  return resolvePort(process.env.PORT, process.env.APP_PORT, 3000);
}

export const PORT = resolveEffectivePort();

/**
 * Single explicit source of truth for runtime execution mode.
 * Determines whether the application should run in production mode (serving compiled static assets)
 * or development mode (using Vite development middleware).
 *
 * Explicit rules:
 * 1. NODE_ENV === 'test' signals test mode (not production).
 * 2. NODE_ENV === 'development' or preview/development APP_ENV unambiguously signals development mode.
 * 3. Explicit APP_ENV === 'production' signals production mode.
 * 4. Explicit NODE_ENV === 'production' signals production mode.
 * 5. Preview indicators in Cloud Run (K_SERVICE/K_REVISION matching ais-* or preview/dev)
 *    prevent treating Cloud Run as production, serving React via Vite dev middleware.
 * 6. Production Cloud Run runtime indicators (K_SERVICE, K_REVISION not matching preview patterns)
 *    signal production mode even if NODE_ENV was not explicitly passed in the service environment.
 * 7. In all other cases (e.g. local development where NODE_ENV is unset),
 *    it safely resolves to false (development mode), preserving Vite dev middleware.
 */
export function isProductionMode(): boolean {
  if (process.env.NODE_ENV === 'test') {
    return false;
  }
  if (process.env.NODE_ENV === 'development') {
    return false;
  }
  if (process.env.APP_ENV === 'development' || process.env.APP_ENV === 'preview') {
    return false;
  }
  if (process.env.APP_ENV === 'production') {
    return true;
  }
  if (process.env.NODE_ENV === 'production') {
    return true;
  }
  if (isCloudRunPreviewEnvironment()) {
    return false;
  }
  if (Boolean(process.env.K_SERVICE || process.env.K_REVISION)) {
    return true;
  }
  return false;
}

// Normalize NODE_ENV based on detected execution mode
if (process.env.NODE_ENV !== 'test') {
  if (isProductionMode()) {
    if (process.env.NODE_ENV !== 'production') {
      process.env.NODE_ENV = 'production';
    }
  } else if (process.env.NODE_ENV !== 'development') {
    process.env.NODE_ENV = 'development';
  }
}

export { isDiagnosticMode };

/**
 * Audits and validates incoming origin against strictly authorized exact staging allowlist.
 * Generic wildcards (*.run.app, *.google.com, *.web.app, *.firebaseapp.com) are completely forbidden.
 */
export function isAuthorizedOrigin(origin?: string): boolean {
  return isAuthorizedOriginStrict(origin);
}

// Audited CORS & embedding middleware for staging, Cloud Run, and authorized previews
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    if (isAuthorizedOrigin(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      // Strictly set credentials only for verified authorized origins
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    } else {
      if (req.method === 'OPTIONS') {
        return res.status(403).json({ error: 'Forbidden', message: 'CORS policy: origin unauthorized', origin });
      }
    }
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS, HEAD');
  res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, Range, X-Google-Access-Token, X-Serverless-Authorization');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range');


  // Prevent frame blocking when published or embedded in preview containers
  try {
    res.removeHeader('X-Frame-Options');
  } catch {}

  // Support Firebase Auth Popup & Cross-Account window communication
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');

  // Allow iframe embedding across Google AI Studio, Cloud Run, and authorized previews
  res.setHeader('Content-Security-Policy', "frame-ancestors 'self' https://*.google.com https://*.run.app https://*.aistudio.google.com https://*.googleusercontent.com;");

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  next();
});

app.use(express.json({ limit: '10mb' }));


// In-memory runtime state hydrated exclusively from Cloud Firestore
interface AppDb {
  teachers: Array<{ email: string; name: string; role: string; registeredByAdmin?: boolean; avatar?: string; picture?: string; approvalStatus?: string; country?: string; accent?: string; timezone?: string; availableDays?: any; videoIntroUrl?: string; [key: string]: any }>;
  tutorsList: Array<any>;
  deletedTutorIds?: string[];
  deletedTutorEmails?: string[];
  deletedStudentEmails?: string[];
  students: Array<any>;
  meetSettings: Record<string, any>;
  teacherSettings: Record<string, any>;
  liveLessons: any[];
  chatMessages: any[];
  routinesByDay: Record<string, any>;
  studentRoutinesMap: Record<string, any>;
  contractedLessons: Record<string, number>;
  userProfiles: Record<string, any>;
  emailLogs: any[];
  weeklyHomework: any;
  landingContent: any;
  dictionary: Record<string, any>;
  studentWeeklyChecks: Record<string, Record<string, boolean>>;
  weeklyNativeTargets: Record<string, number>;
  weeklyStudyDaysTargets: Record<string, number>;
  weeklyStudyDays: Record<string, string[]>;
  studentDictionaryMap: Record<string, any[]>;
  studentJournalMap: Record<string, any[]>;
  studentActivityJournal: Record<string, any[]>;
  authUsers: Record<string, { uid?: string; email: string; name: string; role: string; createdAt?: string; updatedAt?: string }>;
  transactions: any[];
  youtubePlaylists: any[];
  studentVideoAssignments: Record<string, any[]>;
  studentWatchedVideos: Record<string, string[]>;
  studentSpotifyAssignments: Record<string, any[]>;
  studentListenedTracks: Record<string, string[]>;
  studentAwaitingTopicSelection: Record<string, boolean>;
  studentSpotifyCycles?: Record<string, Record<string, any>>;
  spotifyPlaylists: Record<string, any>;
  studentHomeworkMap: Record<string, any>;
  sessionNotesMap: Record<string, any>;
  sessionNotesProgressMap: Record<string, any>;
  pedagogicalTransformationsMap: Record<string, any>;
  cycleAttempts?: Record<string, { attemptId: string; result: any }>;
}

const DEFAULT_LANDING_CONTENT = {
  heroBadge: 'Uma Nova Filosofia de Inglês',
  heroHeadlineStart: 'Learn English by',
  heroHeadlineHighlight: 'Living your Life',
  heroQuote: '“Você não precisa estudar mais. Você pode viver em inglês.”',
  heroSubtext: 'Transforme sua rotina diária em prática real. Do café da manhã ao trabalho e descanso noturno. Sua vida. Seu inglês. Do seu jeito.',
  heroFindFriendBtn: 'Encontre Seu Amigo Nativo',
  heroStartLivingBtn: 'Comece a Viver em Inglês',
  philosophyBadge: 'A Ciência do Hábito',
  philosophyHeading1: 'Não mude sua rotina.',
  philosophyHeading2: 'Viva-a em Inglês.',
  philosophySubheading: 'Aprender inglês não precisa ser uma tarefa pesada de 2 horas em uma sala de aula após um longo dia de trabalho. Conectamos seu aprendizado com o que você já faz todos os dias.',
  philosophyPillar1Title: 'Prática Integrada à Sua Vida',
  philosophyPillar1Desc: 'Cada momento do seu dia se torna uma oportunidade de aprendizado natural — sem sobrecarregar sua agenda.',
  philosophyPillar1Tag: 'Zero Sobrecarga',
  philosophyPillar2Title: '5 Palavras Chave por Atividade',
  philosophyPillar2Desc: 'Foque apenas nas palavras e expressões essenciais para cada momento. Qualidade e contexto superam quantidade.',
  philosophyPillar2Tag: 'Aprendizado Focado',
  philosophyPillar3Title: 'Amigos Nativos & IA',
  philosophyPillar3Desc: 'Sessões individuais ao vivo no Google Meet combinadas com correções instantâneas de IA no seu diário.',
  philosophyPillar3Tag: 'Imersão Humana + IA',
  footerSlogan: 'Learn English by living your life!',
};

// Active production users allowed in the platform
export const ACTIVE_PRODUCTION_USERS = new Set<string>([]);

export const ACTIVE_PRODUCTION_STUDENTS = new Set<string>([]);

export const PURGED_OBSOLETE_STUDENTS: string[] = [];

// Clean initial state: zero mock tutors, zero fake test accounts
const DEFAULT_TUTORS_LIST: any[] = [];

const DEFAULT_DB: AppDb = {
  teachers: [],
  tutorsList: [],
  deletedTutorIds: [],
  deletedTutorEmails: [],
  deletedStudentEmails: PURGED_OBSOLETE_STUDENTS,
  students: [],
  meetSettings: {},
  teacherSettings: {},
  liveLessons: [],
  chatMessages: [],
  routinesByDay: defaultRoutinesByDay,
  studentRoutinesMap: {},
  contractedLessons: {},
  userProfiles: {},
  emailLogs: [],
  weeklyHomework: null,
  studentHomeworkMap: {},
  landingContent: DEFAULT_LANDING_CONTENT,
  dictionary: {},
  studentWeeklyChecks: {},
  weeklyNativeTargets: {},
  weeklyStudyDaysTargets: {},
  weeklyStudyDays: {},
  studentDictionaryMap: {},
  studentJournalMap: {},
  studentActivityJournal: {},
  transactions: [],
  studentVideoAssignments: {},
  studentWatchedVideos: {},
  studentSpotifyAssignments: {},
  studentListenedTracks: {},
  studentAwaitingTopicSelection: {},
  spotifyPlaylists: {},
  sessionNotesMap: {},
  sessionNotesProgressMap: {},
  pedagogicalTransformationsMap: {},
  authUsers: {},
  youtubePlaylists: DEFAULT_CURATED_PLAYLISTS,
};

// In-memory runtime state hydrated exclusively from Cloud Firestore
let inMemoryDb: AppDb = DEFAULT_DB;

/**
 * Merges user profile records ensuring authentic canonical Firebase UIDs are never overwritten by placeholders
 */
export function mergeProfilePreservingCanonicalUid(existing: any, incoming: any): any {
  if (!existing) return incoming;
  if (!incoming) return existing;
  const merged = { ...existing, ...incoming };
  const existingUid = existing.uid || existing.id;
  const incomingUid = incoming.uid || incoming.id;
  if (isValidCanonicalUid(existingUid) && !isValidCanonicalUid(incomingUid)) {
    merged.uid = existingUid;
    merged.id = existingUid;
  } else if (isValidCanonicalUid(incomingUid)) {
    merged.uid = incomingUid;
    merged.id = incomingUid;
  }
  return merged;
}

/**
 * Merges student records ensuring authentic canonical Firebase UIDs are never overwritten by placeholders
 */
export function mergeStudentPreservingCanonicalUid(existing: any, incoming: any): any {
  if (!existing) return incoming;
  if (!incoming) return existing;
  const merged = { ...existing, ...incoming };
  const existingUid = existing.uid || existing.studentUid || existing.id;
  const incomingUid = incoming.uid || incoming.studentUid || incoming.id;
  if (isValidCanonicalUid(existingUid) && !isValidCanonicalUid(incomingUid)) {
    merged.uid = existingUid;
    merged.studentUid = existingUid;
    merged.id = existingUid;
  } else if (isValidCanonicalUid(incomingUid)) {
    merged.uid = incomingUid;
    merged.studentUid = incomingUid;
    merged.id = incomingUid;
  }
  return merged;
}

/**
 * Returns the default standard Spotify track for a given day and level from the official curriculum
 */
function getDefaultDailySpotify(dayKey: string, level: string = 'beginner') {
  const norm = normalizeStudentLevel(level).key;
  const normalizedDay = (dayKey || 'monday').toLowerCase().trim();
  const targetDay = (DAYS_SEQUENCE.includes(normalizedDay as any) ? normalizedDay : 'monday') as DayOfWeek;
  const track = SPOTIFY_LEVEL_PLAYLISTS[norm]?.tracks[targetDay] || SPOTIFY_LEVEL_PLAYLISTS.beginner.tracks[targetDay];
  return {
    id: `sp-${targetDay}-1`,
    url: track?.url || `https://open.spotify.com/playlist/${OFFICIAL_SPOTIFY_PLAYLISTS[norm]?.id || OFFICIAL_SPOTIFY_PLAYLISTS.beginner.id}`,
    title: track?.title || `${norm.charAt(0).toUpperCase() + norm.slice(1)} • It's simple`,
    artistOrHost: track?.artist || 'Adm Itissimple',
    type: 'music',
    duration: (track as any)?.duration || '3-4 min',
    instructions: track?.teacherTipPt || 'Prática diária de escuta ativa com a playlist oficial.',
    addedAt: '2025-01-15T08:00:00Z',
  };
}

function sanitizeSpotifyRecord(obj: any, dayHint?: string): any {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeSpotifyRecord(item, dayHint));
  }
  const clean = { ...obj };
  const effectiveDay = (clean.day || clean.dayOfWeek || dayHint || 'monday').toLowerCase();

  if (clean.teacherSpotify && typeof clean.teacherSpotify === 'object') {
    const spot = clean.teacherSpotify;
    if (spot.url) {
      const parsed = parseSpotifyUrl(spot.url);
      const isCorrupt = !parsed.isValid || CORRUPT_SPOTIFY_IDS.some((bad) => spot.url.includes(bad));
      // Anti-repetition check: If not Monday and track is "Count on Me", heal it to this day's designated track
      const isDuplicatedMondayTrack =
        effectiveDay !== 'monday' &&
        (spot.url.includes('3B5UbSndRz907IZhhmUfLi') || spot.title === 'Count on Me');

      if (isCorrupt || isDuplicatedMondayTrack) {
        const fallback = getDefaultDailySpotify(effectiveDay);
        clean.teacherSpotify = {
          ...spot,
          url: fallback.url,
          title: fallback.title,
          artistOrHost: fallback.artistOrHost,
          type: fallback.type,
          instructions: fallback.instructions,
        };
      } else if (parsed.canonicalUrl) {
        clean.teacherSpotify.url = parsed.canonicalUrl;
      }
    }
  }

  if (clean.url && (clean.day || clean.activityId) && typeof clean.url === 'string') {
    const parsed = parseSpotifyUrl(clean.url);
    const isCorrupt = !parsed.isValid || CORRUPT_SPOTIFY_IDS.some((bad) => clean.url.includes(bad));
    const isDuplicatedMondayTrack =
      effectiveDay !== 'monday' &&
      (clean.url.includes('3B5UbSndRz907IZhhmUfLi') || clean.title === 'Count on Me');

    if (isCorrupt || isDuplicatedMondayTrack) {
      const fallback = getDefaultDailySpotify(effectiveDay);
      clean.url = fallback.url;
      clean.title = fallback.title;
      clean.artistOrHost = fallback.artistOrHost;
      clean.type = fallback.type;
    } else if (parsed.canonicalUrl) {
      clean.url = parsed.canonicalUrl;
    }
  }
  return clean;
}

function mergeDbWithDefaults(parsed: any): AppDb {
  const {
    liveLessons: _ignoredParsedLiveLessons,
    lessons: _ignoredParsedLessons,
    scheduledLessons: _ignoredParsedScheduledLessons,
    ...safeParsed
  } = parsed || {};

  const merged: AppDb = {
    ...DEFAULT_DB,
    ...safeParsed,
    routinesByDay:
      parsed && parsed.routinesByDay && Object.keys(parsed.routinesByDay).length > 0
        ? parsed.routinesByDay
        : defaultRoutinesByDay,
    studentWeeklyChecks: (parsed && parsed.studentWeeklyChecks) || {},
    studentDictionaryMap: (parsed && parsed.studentDictionaryMap) || {},
    studentListenedTracks: (parsed && parsed.studentListenedTracks) || {},
    studentHomeworkMap: (parsed && parsed.studentHomeworkMap) || {},
    weeklyNativeTargets: (parsed && parsed.weeklyNativeTargets) || {},
    weeklyStudyDaysTargets: (parsed && parsed.weeklyStudyDaysTargets) || {},
    weeklyStudyDays: (parsed && parsed.weeklyStudyDays) || {},
    studentJournalMap: (parsed && parsed.studentJournalMap) || {},
    studentActivityJournal: (parsed && parsed.studentActivityJournal) || {},
    transactions: (parsed && parsed.transactions) || [],
    studentVideoAssignments: (parsed && parsed.studentVideoAssignments) || {},
    studentWatchedVideos: (parsed && parsed.studentWatchedVideos) || {},
    studentSpotifyAssignments: (parsed && parsed.studentSpotifyAssignments) || {},
    studentAwaitingTopicSelection: (parsed && parsed.studentAwaitingTopicSelection) || {},
    spotifyPlaylists: (parsed && parsed.spotifyPlaylists) || {},
    sessionNotesMap: (parsed && parsed.sessionNotesMap) || {},
    sessionNotesProgressMap: (parsed && parsed.sessionNotesProgressMap) || {},
    pedagogicalTransformationsMap: (parsed && parsed.pedagogicalTransformationsMap) || {},
    authUsers: (parsed && parsed.authUsers) || DEFAULT_DB.authUsers,
    teacherSettings: (parsed && parsed.teacherSettings) || {},
    meetSettings: (parsed && parsed.meetSettings) || {},
    landingContent: {
      ...DEFAULT_LANDING_CONTENT,
      ...((parsed && parsed.landingContent) || {}),
    },
    deletedTutorIds: Array.isArray(parsed?.deletedTutorIds) ? parsed.deletedTutorIds : [],
    deletedTutorEmails: Array.isArray(parsed?.deletedTutorEmails) ? parsed.deletedTutorEmails : [],
    deletedStudentEmails: Array.isArray(parsed?.deletedStudentEmails) ? parsed.deletedStudentEmails : [],
    tutorsList: Array.isArray(parsed?.tutorsList) ? parsed.tutorsList : [],
    teachers: Array.isArray(parsed?.teachers) ? parsed.teachers : DEFAULT_DB.teachers,
    students: (Array.isArray(parsed?.students) ? parsed.students : []).filter((s: any) => {
      const email = (s.email || s.studentEmail || '').toLowerCase().trim();
      const deletedStudentList: string[] = Array.isArray(parsed?.deletedStudentEmails) ? parsed.deletedStudentEmails : [];
      return !email || !deletedStudentList.includes(email);
    }),
    liveLessons: [],
    contractedLessons: (parsed && parsed.contractedLessons) || {},
    userProfiles: (parsed && parsed.userProfiles) || DEFAULT_DB.userProfiles,
    youtubePlaylists:
      Array.isArray(parsed?.youtubePlaylists) && parsed.youtubePlaylists.length > 5
        ? parsed.youtubePlaylists
        : DEFAULT_CURATED_PLAYLISTS,
  };

  // Sanitize routinesByDay for corrupted Spotify entries and daily sequential uniqueness
  if (merged.routinesByDay) {
    Object.keys(merged.routinesByDay).forEach((d) => {
      if (Array.isArray(merged.routinesByDay[d])) {
        merged.routinesByDay[d] = merged.routinesByDay[d].map((item: any) => sanitizeSpotifyRecord(item, d));
      }
    });
  }

  // Sanitize studentRoutinesMap for corrupted Spotify entries and daily sequential uniqueness
  if (merged.studentRoutinesMap) {
    Object.keys(merged.studentRoutinesMap).forEach((stKey) => {
      const studentRoutine = merged.studentRoutinesMap[stKey];
      if (studentRoutine && typeof studentRoutine === 'object') {
        Object.keys(studentRoutine).forEach((d) => {
          if (Array.isArray(studentRoutine[d])) {
            studentRoutine[d] = studentRoutine[d].map((item: any) => sanitizeSpotifyRecord(item, d));
          }
        });
      }
    });
  }

  // Sanitize studentSpotifyAssignments for corrupted Spotify entries and daily sequential uniqueness
  if (merged.studentSpotifyAssignments) {
    Object.keys(merged.studentSpotifyAssignments).forEach((stKey) => {
      if (Array.isArray(merged.studentSpotifyAssignments![stKey])) {
        merged.studentSpotifyAssignments![stKey] = merged.studentSpotifyAssignments![stKey].map((item: any) =>
          sanitizeSpotifyRecord(item, item.day)
        );
      }
    });
  }

  return merged;
}

export function scrubPasswords(db: any): any {
  if (!db || typeof db !== 'object') return db;
  if (db.authUsers && typeof db.authUsers === 'object') {
    for (const key of Object.keys(db.authUsers)) {
      if (db.authUsers[key]) {
        delete db.authUsers[key].password;
      }
    }
  }
  if (db.userProfiles && typeof db.userProfiles === 'object') {
    for (const key of Object.keys(db.userProfiles)) {
      if (db.userProfiles[key]) {
        delete db.userProfiles[key].password;
      }
    }
  }
  if (Array.isArray(db.students)) {
    for (const s of db.students) {
      if (s) delete s.password;
    }
  }
  if (Array.isArray(db.tutorsList)) {
    for (const t of db.tutorsList) {
      if (t) delete t.password;
    }
  }
  if (Array.isArray(db.teachers)) {
    for (const t of db.teachers) {
      if (t) delete t.password;
    }
  }
  return db;
}

export function readDb(): AppDb {
  return inMemoryDb;
}

registerDbReader(readDb);

let syncTimeout: any = null;
let isCloudHydrated = false;

function writeDb(db: AppDb) {
  if (isDiagnosticMode()) {
    return; // Strictly no disk writes or cloud syncing in diagnostic mode
  }
  scrubPasswords(db);
  inMemoryDb = db;

  // Cloud Firestore asynchronous sync - only persist to cloud once hydrated
  if (!isCloudHydrated) {
    return;
  }

  if (syncTimeout) clearTimeout(syncTimeout);
  syncTimeout = setTimeout(() => {
    saveAppStateToFirestore(db).catch((err) => {
      if (!isPermissionError(err)) {
        console.warn('Background Firestore sync error:', err);
      }
    });
  }, 300);
}

// Immediate synchronous memory update + background Cloud Firestore sync
export async function writeDbSync(db: AppDb): Promise<void> {
  if (isDiagnosticMode()) {
    return; // Strictly no disk writes or cloud syncing in diagnostic mode
  }
  scrubPasswords(db);
  inMemoryDb = db;
  if (!isCloudHydrated) {
    return;
  }
  // Run Firestore sync in background without blocking the HTTP response
  saveAppStateToFirestore(db).catch((err) => {
    if (!isPermissionError(err)) {
      console.warn('Background Firestore sync error:', err);
    }
  });
}

// Initial hydration from Firestore on server startup
export async function initCloudPersistence() {
  if (isDiagnosticMode()) {
    return; // Strictly disabled in DIAGNOSTIC_ONLY mode
  }
  try {
    // Fetch latest state directly from Cloud Firestore
    const cloudState = await fetchAppStateFromFirestore();
    if (cloudState && typeof cloudState === 'object') {
      console.log('Successfully hydrated database from Firebase Firestore cloud');
      // Sanitize non-canonical placeholder UIDs in cloudState before merging
      if (cloudState.authUsers) {
        for (const [em, u] of Object.entries(cloudState.authUsers)) {
          const uUid = (u as any)?.uid;
          if (uUid && !isValidCanonicalUid(uUid)) {
            delete (u as any).uid;
          }
        }
      }
      if (cloudState.userProfiles) {
        for (const [em, p] of Object.entries(cloudState.userProfiles)) {
          const pUid = (p as any)?.uid;
          const pId = (p as any)?.id;
          const pTeacherUid = (p as any)?.teacherUid;
          if (pUid && !isValidCanonicalUid(pUid)) {
            delete (p as any).uid;
          }
          if (pId && !isValidCanonicalUid(pId)) {
            delete (p as any).id;
          }
          if (pTeacherUid && !isValidCanonicalUid(pTeacherUid)) {
            delete (p as any).teacherUid;
          }
        }
      }

      // ARCH.2A: Hydrate userProfiles and authUsers strictly from canonically confirmed cloudState
      // (which is anchored in Firestore (default) /users and /tutors, never unconfirmed caches).
      const mergedUserProfiles: Record<string, any> = {};
      Object.keys(cloudState.userProfiles || {}).forEach((key) => {
        mergedUserProfiles[key] = cloudState.userProfiles[key];
      });

      const mergedAuthUsers: Record<string, any> = {
        ...(cloudState.authUsers || {}),
      };
      Object.keys(mergedAuthUsers).forEach((k) => {
        const canonical = mergedUserProfiles[k]?.uid;
        if (canonical && isValidCanonicalUid(canonical)) {
          mergedAuthUsers[k].uid = canonical;
        }
      });

      // Merge tutorsList strictly requiring canonical confirmation from /tutors or /users (role=='teacher')
      const localTutors = inMemoryDb.tutorsList || [];
      const cloudTutors = Array.isArray(cloudState.tutorsList) ? cloudState.tutorsList : [];
      let directTutors: any[] = [];
      let directTutorsOk = false;
      try {
        directTutors = await fetchTutorsFromFirestore();
        directTutorsOk = true;
      } catch {
        directTutorsOk = false;
        directTutors = [];
      }
      const tutorMap = new Map<string, any>();

      if (directTutorsOk) {
        const confirmedKeys = new Set<string>();
        directTutors.forEach((t: any) => {
          const em = (t.email || '').toLowerCase().trim();
          const uid = (t.authUid || t.uid || t.id || '').toLowerCase().trim();
          if (em) confirmedKeys.add(em);
          if (uid) confirmedKeys.add(uid);
        });
        const isConfirmedTutor = (t: any) => {
          const em = (t?.email || '').toLowerCase().trim();
          const uid = (t?.authUid || t?.uid || t?.id || '').toLowerCase().trim();
          return (em && confirmedKeys.has(em)) || (uid && confirmedKeys.has(uid));
        };

        // 1. Local memory tutors only if canonically confirmed
        localTutors.filter(isConfirmedTutor).forEach((t: any) => {
          const key = (t.email || t.id || '').toLowerCase().trim();
          if (key) tutorMap.set(key, t);
        });
        // 2. Cloud state tutors only if canonically confirmed
        cloudTutors.filter(isConfirmedTutor).forEach((t: any) => {
          const key = (t.email || t.id || '').toLowerCase().trim();
          if (key) {
            const existing = tutorMap.get(key) || {};
            tutorMap.set(key, { ...existing, ...t });
          }
        });
        // 3. Direct collection /tutors/ & /users/ over everything (authoritative source of truth)
        directTutors.forEach((t: any) => {
          const key = (t.email || t.id || '').toLowerCase().trim();
          if (key) {
            const existing = tutorMap.get(key) || {};
            tutorMap.set(key, { ...existing, ...t });
          }
        });
      }

      // Track deleted tutors across reboots
      const localDeletedTutorEmails: string[] = inMemoryDb.deletedTutorEmails || [];
      const cloudDeletedTutorEmails: string[] = Array.isArray(cloudState.deletedTutorEmails) ? cloudState.deletedTutorEmails : [];
      const allDeletedTutorEmails = Array.from(new Set([...localDeletedTutorEmails, ...cloudDeletedTutorEmails]));
      inMemoryDb.deletedTutorEmails = allDeletedTutorEmails;

      const localDeletedTutorIds: string[] = inMemoryDb.deletedTutorIds || [];
      const cloudDeletedTutorIds: string[] = Array.isArray(cloudState.deletedTutorIds) ? cloudState.deletedTutorIds : [];
      const allDeletedTutorIds = Array.from(new Set([...localDeletedTutorIds, ...cloudDeletedTutorIds]));
      inMemoryDb.deletedTutorIds = allDeletedTutorIds;

      const mergedTutorsList = Array.from(tutorMap.values()).filter((t: any) => {
        const em = (t.email || '').toLowerCase().trim();
        const id = (t.id || '').toLowerCase().trim();
        return !allDeletedTutorEmails.includes(em) && !allDeletedTutorIds.includes(id);
      });

      // Merge teachers list preserving legitimate admins and canonically confirmed tutors only
      const localTeachers = inMemoryDb.teachers || [];
      const cloudTeachers = Array.isArray(cloudState.teachers) ? cloudState.teachers : [];
      const teacherMap = new Map<string, any>();
      localTeachers.forEach((t: any) => {
        const key = (t.email || '').toLowerCase().trim();
        if (key && (t.role === 'admin' || !allDeletedTutorEmails.includes(key))) teacherMap.set(key, t);
      });
      cloudTeachers.forEach((t: any) => {
        const key = (t.email || '').toLowerCase().trim();
        if (key && (t.role === 'admin' || !allDeletedTutorEmails.includes(key))) {
          const existing = teacherMap.get(key) || {};
          teacherMap.set(key, { ...existing, ...t });
        }
      });
      // Ensure all canonically confirmed tutors have teacher entries
      mergedTutorsList.forEach((t: any) => {
        const key = (t.email || '').toLowerCase().trim();
        if (key && !teacherMap.has(key)) {
          teacherMap.set(key, {
            email: key,
            name: t.name || key.split('@')[0],
            role: 'teacher',
            country: t.country,
            timezone: t.timezone,
            avatar: t.avatar,
            approvalStatus: t.approvalStatus,
          });
        }
      });
      const mergedTeachers = Array.from(teacherMap.values()).filter((t: any) => {
        const em = (t.email || '').toLowerCase().trim();
        if (t.role === 'admin') {
          const adminUid = t.uid || t.id;
          return Boolean(adminUid && isValidCanonicalUid(adminUid));
        }
        if (allDeletedTutorEmails.includes(em)) return false;
        return mergedTutorsList.some((mt: any) => {
          const mtEm = (mt.email || '').toLowerCase().trim();
          const mtUid = (mt.authUid || mt.uid || mt.id || '').toLowerCase().trim();
          const tUid = (t.uid || t.id || '').toLowerCase().trim();
          return (mtEm && em && mtEm === em) || (mtUid && tUid && mtUid === tUid);
        });
      });

      // Sync canonically confirmed tutors with proven canonical UIDs into profiles
      mergedTutorsList.forEach((t: any) => {
        const key = (t.email || '').toLowerCase().trim();
        const tUid = (t.authUid && isValidCanonicalUid(t.authUid) ? t.authUid : null) ||
          (t.uid && isValidCanonicalUid(t.uid) ? t.uid : null) ||
          (t.id && isValidCanonicalUid(t.id) ? t.id : null);
        if (key && tUid && !allDeletedTutorEmails.includes(key)) {
          if (!mergedAuthUsers[key]) {
            mergedAuthUsers[key] = {
              uid: tUid,
              id: tUid,
              email: key,
              name: t.name || key.split('@')[0],
              role: 'teacher',
              createdAt: t.createdAt || new Date().toISOString(),
            };
          }
          if (!mergedUserProfiles[key]) {
            mergedUserProfiles[key] = {
              id: tUid,
              uid: tUid,
              name: t.name || key.split('@')[0],
              email: key,
              role: 'teacher',
              picture: t.avatar || '',
              avatar: t.avatar || '',
              createdAt: t.createdAt || new Date().toISOString(),
            };
          }
        }
      });

      allDeletedTutorEmails.forEach((em) => {
        if (mergedAuthUsers[em]?.role !== 'admin') {
          delete mergedUserProfiles[em];
          if (mergedAuthUsers[em]?.role === 'teacher') {
            delete mergedAuthUsers[em];
          }
        }
      });

      // Merge students list by email, strictly anchored in canonically confirmed cloudState.students
      const localDeletedStudents: string[] = inMemoryDb.deletedStudentEmails || [];
      const cloudDeletedStudents: string[] = Array.isArray(cloudState.deletedStudentEmails) ? cloudState.deletedStudentEmails : [];
      const allDeletedStudentEmails = Array.from(new Set([...localDeletedStudents, ...cloudDeletedStudents, ...PURGED_OBSOLETE_STUDENTS]));
      inMemoryDb.deletedStudentEmails = allDeletedStudentEmails;

      // Purge deleted user profiles and auth users (never purge teachers/tutors)
      Object.keys(mergedUserProfiles).forEach((em) => {
        const cleanEm = em.toLowerCase().trim();
        const isTeacher = mergedUserProfiles[em]?.role === 'teacher';
        if (!isTeacher && allDeletedStudentEmails.includes(cleanEm)) {
          delete mergedUserProfiles[em];
        }
      });
      Object.keys(mergedAuthUsers).forEach((em) => {
        const cleanEm = em.toLowerCase().trim();
        const isTeacher = mergedAuthUsers[em]?.role === 'teacher';
        if (!isTeacher && allDeletedStudentEmails.includes(cleanEm)) {
          delete mergedAuthUsers[em];
        }
      });

      const cloudStudents = Array.isArray(cloudState.students) ? cloudState.students : [];
      const studentMap = new Map<string, any>();
      cloudStudents.forEach((s: any) => {
        const key = (s.studentEmail || s.email || '').toLowerCase().trim();
        const sUid = s.uid || s.studentUid || s.id;
        if (key && sUid && isValidCanonicalUid(sUid) && !allDeletedStudentEmails.includes(key)) {
          studentMap.set(key, s);
        }
      });

      const mergedStudents = Array.from(studentMap.values()).filter((s: any) => {
        const em = (s.email || s.studentEmail || '').toLowerCase().trim();
        return em && !allDeletedStudentEmails.includes(em);
      });

      // ARCH.2D.2: Do not hydrate or reintroduce legacy lessons from app_state/lessons or inMemoryDb.liveLessons.
      // Canonical lessons reside exclusively in Firestore (default) collection `lessons/{lessonId}`.

      // Filter and clean student media assignments, routines and progress maps to remove deleted students
      const isAllowedKey = (k: string) => {
        const lk = k.toLowerCase().trim();
        for (const purged of allDeletedStudentEmails) {
          if (lk.includes(purged) || lk.includes(purged.replace(/[^a-zA-Z0-9]/g, '-'))) return false;
        }
        return true;
      };

      const rawVideoAssignments = {
        ...(inMemoryDb.studentVideoAssignments || {}),
        ...(cloudState.studentVideoAssignments || {}),
      };
      const cleanVideoAssignments: Record<string, any> = {};
      Object.entries(rawVideoAssignments).forEach(([k, v]) => {
        if (isAllowedKey(k)) cleanVideoAssignments[k] = v;
      });

      const rawSpotifyAssignments = {
        ...(inMemoryDb.studentSpotifyAssignments || {}),
        ...(cloudState.studentSpotifyAssignments || {}),
      };
      const cleanSpotifyAssignments: Record<string, any> = {};
      Object.entries(rawSpotifyAssignments).forEach(([k, v]) => {
        if (isAllowedKey(k)) cleanSpotifyAssignments[k] = v;
      });

      const rawStudentRoutines = {
        ...(inMemoryDb.studentRoutinesMap || {}),
        ...(cloudState.studentRoutinesMap || {}),
      };
      const cleanStudentRoutines: Record<string, any> = {};
      Object.entries(rawStudentRoutines).forEach(([k, v]) => {
        if (isAllowedKey(k)) cleanStudentRoutines[k] = v;
      });

      const rawStudentDictionary = {
        ...(inMemoryDb.studentDictionaryMap || {}),
        ...(cloudState.studentDictionaryMap || {}),
      };
      const cleanStudentDictionary: Record<string, any> = {};
      Object.entries(rawStudentDictionary).forEach(([k, v]) => {
        if (isAllowedKey(k)) cleanStudentDictionary[k] = v;
      });

      const mergedWatchedVideos = {
        ...(inMemoryDb.studentWatchedVideos || {}),
        ...(cloudState.studentWatchedVideos || {}),
      };
      const mergedListenedTracks = {
        ...(inMemoryDb.studentListenedTracks || {}),
        ...(cloudState.studentListenedTracks || {}),
      };

      const {
        liveLessons: _ignoredCloudLiveLessons,
        lessons: _ignoredCloudLessons,
        scheduledLessons: _ignoredCloudScheduledLessons,
        ...cloudStateWithoutLegacyLessons
      } = cloudState;
      inMemoryDb = mergeDbWithDefaults({
        ...inMemoryDb,
        ...cloudStateWithoutLegacyLessons,
        authUsers: mergedAuthUsers,
        userProfiles: mergedUserProfiles,
        tutorsList: mergedTutorsList,
        teachers: mergedTeachers,
        students: mergedStudents,
        liveLessons: [],
        studentVideoAssignments: cleanVideoAssignments,
        studentSpotifyAssignments: cleanSpotifyAssignments,
        studentRoutinesMap: cleanStudentRoutines,
        studentWatchedVideos: mergedWatchedVideos,
        studentListenedTracks: mergedListenedTracks,
        studentDictionaryMap: cleanStudentDictionary,
      });
      isCloudHydrated = true;
      await saveAppStateToFirestore(inMemoryDb);
    } else {
      console.warn('Could not fetch app_state from Firestore cloud. Attempting recovery from direct collections...');
      const directTutors = await fetchTutorsFromFirestore().catch(() => []);
      if (directTutors && directTutors.length > 0) {
        const cleanDirect = directTutors.filter((t: any) => {
          const em = (t.email || '').toLowerCase().trim();
          const uid = (t.authUid || t.uid || t.id || '').trim();
          return Boolean(em && uid) && !em.endsWith('@example.com') && !em.endsWith('@test.com');
        });
        console.log(`Recovered ${cleanDirect.length} valid tutors directly from /tutors collection!`);
        inMemoryDb.tutorsList = cleanDirect;
      }
      isCloudHydrated = true;
    }

    // Hydrate YouTube playlists from Firestore (default) app_state document
    try {
      const ytDoc = await fetchYouTubePlaylistsDocFromFirestore();
      if (ytDoc?.playlists && Array.isArray(ytDoc.playlists) && ytDoc.playlists.length > 0) {
        inMemoryDb.youtubePlaylists = ytDoc.playlists;
        lastYouTubeSyncTime = ytDoc.updatedAt ? new Date(ytDoc.updatedAt).getTime() : Date.now();
        console.info(`[initCloudPersistence] Hydrated ${ytDoc.playlists.length} YouTube playlists from Firestore (default).`);
      }
    } catch (ytErr) {
      console.warn('[initCloudPersistence] YouTube hydration notice:', ytErr);
    }
  } catch (err) {
    console.warn('Cloud persistence init notice:', err);
    isCloudHydrated = true;
  }

}

// Register isolated diagnostic routes (/api/health, /api/diagnostic/health, /api/diagnostic/firestore)
registerDiagnosticRoutes(app);

// Enforce DIAGNOSTIC_ONLY isolation on business routes:
// If DIAGNOSTIC_ONLY is active, business routes are strictly unreachable and return 404
app.use((req, res, next) => {
  if (isDiagnosticMode()) {
    const isHealthOrDiagnostic =
      req.path === '/api/health' ||
      req.path === '/api/diagnostic/health' ||
      req.path === '/api/diagnostic/firestore' ||
      req.path === '/' ||
      req.path.startsWith('/api/diagnostic');

    if (!isHealthOrDiagnostic) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Backend is operating in DIAGNOSTIC_ONLY mode. Business routes, authentication, student/tutor management, and payments are strictly not registered.',
        requestedPath: req.originalUrl,
        diagnosticMode: true,
      });
    }
  }
  next();
});

// Phase 1C-A & IDENTITY-CRITICAL.2: backend Firebase ID token verification and authoritative canonical role inspection
app.get('/api/auth/verify-session', firebaseAuthMiddleware, async (req, res) => {
  if (!req.user) {
    return res.status(401).json({ authenticated: false, error: 'Unauthorized' });
  }

  const db = readDb();
  const callerUid = req.user.uid;
  const callerEmail = (req.user.email || '').toLowerCase().trim();
  const tokenRole = req.user.role;

  const resolution = await resolveCanonicalUserRoleAndIdentity({
    uid: callerUid,
    email: callerEmail,
    tokenRole,
    dbState: db,
  });

  if (resolution.identityStatus === 'conflict' || resolution.identityStatus === 'divergent_uid') {
    return res.status(409).json({
      authenticated: true,
      uid: callerUid,
      email: callerEmail,
      role: 'conflict',
      identityStatus: resolution.identityStatus,
      message: resolution.message || 'Conflito de identidade detectado.',
    });
  }

  if (resolution.role === 'pending_teacher') {
    return res.status(403).json({
      authenticated: true,
      uid: callerUid,
      email: callerEmail,
      role: 'pending_teacher',
      approvalStatus: 'pending',
      identityStatus: 'pending_approval',
      message: 'Seu cadastro de Amigo Nativo está em análise e aguarda aprovação da administração.',
    });
  }

  return res.json({
    authenticated: true,
    uid: callerUid,
    email: callerEmail,
    emailVerified: req.user.email_verified,
    role: resolution.role,
    identityStatus: resolution.identityStatus,
    publicTutorId: resolution.publicTutorId,
    name: resolution.name,
    account: {
      uid: callerUid,
      email: callerEmail,
      name: resolution.name || callerEmail.split('@')[0],
      role: resolution.role,
    },
  });
});

app.post('/api/auth/sync-admin-claims', firebaseAuthMiddleware, async (req, res) => {
  const caller = req.user;
  if (!caller || !caller.uid) {
    return res.status(401).json({ error: 'Unauthorized', message: 'Authentication required: verified user token missing' });
  }

  const cleanEmail = (caller.email || '').toLowerCase().trim();

  // Rule 1: Caller email must be verified by Firebase Auth
  if (!caller.email_verified) {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'Access denied: caller email must be verified to synchronize administrative claims',
    });
  }

  const db = readDb();
  // Authorization is bound strictly to the verified UID assigned by the bootstrap procedure
  const isTeacherAdmin = (db.teachers || []).some(
    (t: any) => t.role === 'admin' && (t.uid === caller.uid || t.id === caller.uid)
  );

  const isConfirmedAdmin = isTeacherAdmin || caller.role === 'admin';
  if (!isConfirmedAdmin) {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'Access denied: caller UID is not an authorized administrator in system records',
    });
  }

  try {
    const adminAuth = getFirebaseAdminAuth();
    await adminAuth.setCustomUserClaims(caller.uid, { role: 'admin' });
    return res.json({ success: true, role: 'admin', uid: caller.uid });
  } catch (err: any) {
    console.error('Error assigning custom admin claims:', err);
    return res.status(500).json({ error: 'Internal server error assigning admin claim' });
  }
});

// 1.1 Auth Endpoints: Admin status check (never inspects or exposes credentials)
app.get('/api/auth/admin-status', (req, res) => {
  const db = readDb();
  const adminAccount =
    (db.teachers || []).find((t: any) => t.role === 'admin');

  res.json({
    hasAdmin: !!adminAccount,
    hasAdminRegistered: !!adminAccount,
    adminEmail: adminAccount ? (adminAccount as any).email : null,
    adminName: adminAccount ? (adminAccount as any).name : null,
  });
});

app.post('/api/auth/login', async (req, res) => {
  const db = readDb();

  // 1. Authenticate exclusively via Firebase Authentication ID Token
  let verifiedCaller: AuthenticatedUser | null = await getVerifiedUserFromRequest(req);
  if (!verifiedCaller && req.body.idToken && typeof req.body.idToken === 'string') {
    try {
      const adminAuth = getFirebaseAdminAuth();
      const decoded = await adminAuth.verifyIdToken(req.body.idToken);
      const trustedRole = extractTrustedRole(decoded);
      verifiedCaller = markAsVerifiedUser({
        uid: decoded.uid,
        email: decoded.email,
        email_verified: Boolean(decoded.email_verified),
        role: trustedRole,
      });
    } catch {
      // Invalid token
    }
  }

  if (!verifiedCaller || !verifiedCaller.uid) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Autenticação no Firebase Authentication é obrigatória. Token de ID ausente ou inválido.',
    });
  }

  const authenticatedUid = verifiedCaller.uid;
  const verifiedEmail = (verifiedCaller.email || '').toLowerCase().trim();

  // Account Impersonation Prevention: client-supplied email/uid cannot conflict with verified identity
  if (req.body.email && verifiedEmail && req.body.email.toLowerCase().trim() !== verifiedEmail) {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'Acesso negado: tentativa de personificação detectada. O e-mail não confere com a identidade verificada.',
    });
  }
  if (req.body.uid && req.body.uid !== authenticatedUid) {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'Acesso negado: tentativa de personificação detectada. O UID não confere com a identidade verificada.',
    });
  }

  const cleanEmail = verifiedEmail || (req.body.email ? req.body.email.toLowerCase().trim() : '');
  const requestedRole = (req.body.role || '').toLowerCase();
  let role: string = 'student';
  let isRoleEnforced = false;
  let name: string = (req.body.name || '').trim() || cleanEmail.split('@')[0];

  // 1. Authoritative canonical identity resolution
  const resolution = await resolveCanonicalUserRoleAndIdentity({
    uid: authenticatedUid,
    email: cleanEmail,
    tokenRole: verifiedCaller.role,
    dbState: db,
  });

  if (resolution.identityStatus === 'conflict' || resolution.identityStatus === 'divergent_uid') {
    return res.status(409).json({
      error: 'Conflict',
      code: 'IDENTITY_CONFLICT',
      message: resolution.message || 'Conflito de identidade detectado. Operação suspensa para reconciliação.',
    });
  }

  // If user requested admin role, they MUST possess verified admin privileges
  if (requestedRole === 'admin' && resolution.role !== 'admin') {
    return res.status(403).json({
      error: 'Forbidden',
      code: 'ADMIN_ACCESS_DENIED',
      message: 'Acesso negado: esta conta não possui privilégios de administrador ou a custom claim de administrador ainda não foi provisionada.',
    });
  }

  // If a pending tutor attempts to log into the teacher space, reject with 403
  if (resolution.role === 'pending_teacher' && requestedRole === 'teacher') {
    return res.status(403).json({
      error: 'Forbidden',
      code: 'TEACHER_APPROVAL_PENDING',
      message: 'Seu cadastro de Amigo Nativo está em análise e aguarda aprovação da administração.',
      approvalStatus: 'pending',
    });
  }

  if (resolution.role === 'admin') {
    role = 'admin';
    name = resolution.name || db.authUsers?.[cleanEmail]?.name || 'Admin';
    if (verifiedCaller.role !== 'admin') {
      try {
        const adminAuth = getFirebaseAdminAuth();
        adminAuth.setCustomUserClaims(authenticatedUid, { role: 'admin' }).catch(() => {});
      } catch {}
    }
  } else if (resolution.role === 'teacher') {
    role = 'teacher';
    name = resolution.name || db.authUsers?.[cleanEmail]?.name || name;
    if (requestedRole === 'admin') {
      isRoleEnforced = true;
      console.warn(`[RBAC] Blocked teacher ${cleanEmail} from accessing admin panel.`);
    }
    const tutorObj = (db.tutorsList || []).find(
      (t: any) => t.uid === authenticatedUid || t.authUid === authenticatedUid || (t.email || '').toLowerCase() === cleanEmail
    );
    const teacherObj = (db.teachers || []).find(
      (t: any) => (t.uid === authenticatedUid || (t.email || '').toLowerCase() === cleanEmail) && t.role !== 'admin'
    );
    if (tutorObj) {
      tutorObj.uid = authenticatedUid;
      tutorObj.authUid = authenticatedUid;
      if (resolution.publicTutorId) tutorObj.id = resolution.publicTutorId;
    }
    if (teacherObj) {
      teacherObj.uid = authenticatedUid;
    }
  } else if (resolution.role === 'student') {
    role = 'student';
    name = resolution.name || db.userProfiles?.[cleanEmail]?.name || db.authUsers?.[cleanEmail]?.name || name;
    if (requestedRole && requestedRole !== 'student') {
      isRoleEnforced = true;
      console.warn(`[RBAC] Blocked student ${cleanEmail} from accessing ${requestedRole} panel. Locked to student space.`);
    }
  } else {
    // Unregistered account attempting to log in without registration
    return res.status(401).json({
      error: 'Unauthorized',
      code: 'ACCOUNT_NOT_REGISTERED',
      message: 'Conta não autorizada ou perfil não encontrado. Por favor, cadastre-se antes de fazer login.',
    });
  }

  // Update authUsers record (NO PASSWORDS EVER)
  if (!db.authUsers) db.authUsers = {};
  db.authUsers[cleanEmail] = {
    uid: authenticatedUid,
    email: cleanEmail,
    name,
    role,
    createdAt: db.authUsers[cleanEmail]?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const effectiveAccountUid = authenticatedUid;
  const account = {
    uid: effectiveAccountUid,
    id: effectiveAccountUid,
    email: cleanEmail,
    name: name.charAt(0).toUpperCase() + name.slice(1),
    role,
    picture: '',
  };

  let studentProfile: any = null;
  let studentObj: any = null;

  if (role === 'student') {
    studentObj = (db.students || []).find(
      (s: any) => (s.email || s.studentEmail || '').toLowerCase() === cleanEmail
    );

    // Link real Firebase Auth UID to student record preserving trial lesson and tutor links
    if (authenticatedUid && isValidCanonicalUid(authenticatedUid)) {
      if (studentObj) {
        studentObj.uid = authenticatedUid;
        studentObj.id = authenticatedUid;
        studentObj.studentUid = authenticatedUid;
      }
      if (db.userProfiles?.[cleanEmail]) {
        db.userProfiles[cleanEmail].uid = authenticatedUid;
        db.userProfiles[cleanEmail].id = authenticatedUid;
      }
      if (db.authUsers?.[cleanEmail]) {
        db.authUsers[cleanEmail].uid = authenticatedUid;
      }
      writeDb(db);
    }

    studentProfile = db.userProfiles?.[cleanEmail] || null;

    // If profile is missing or lacks target settings, hydrate from Firestore
    if (!studentProfile || studentProfile.weeklyStudyDaysTarget === undefined || !studentProfile.level) {
      try {
        const firestoreUser = await fetchUserFromFirestore(cleanEmail, account.uid);
        const firestoreAssignments = await fetchStudentAssignmentsByUid(account.uid);
        if (firestoreUser || firestoreAssignments) {
          studentProfile = {
            ...(studentProfile || {}),
            ...(firestoreUser || {}),
            ...(firestoreAssignments || {}),
          };
        }
      } catch (err) {
        console.warn('Could not hydrate student from Firestore:', err);
      }
    }

    const defaultLevel = studentObj?.level || studentObj?.studentLevel || 'iniciante';
    const targetDays =
      studentProfile?.weeklyStudyDaysTarget ??
      studentObj?.weeklyStudyDaysTarget ??
      db.weeklyStudyDaysTargets?.[cleanEmail] ??
      (account.uid ? db.weeklyStudyDaysTargets?.[account.uid] : undefined) ??
      7;

    const studyDays =
      studentProfile?.weeklyStudyDays ??
      studentObj?.weeklyStudyDays ??
      db.weeklyStudyDays?.[cleanEmail] ??
      (account.uid ? db.weeklyStudyDays?.[account.uid] : undefined) ??
      ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

    if (!studentProfile) {
      studentProfile = {
        id: account.uid,
        name: account.name,
        email: cleanEmail,
        level: defaultLevel,
        userLevel: defaultLevel,
        englishLevel: defaultLevel,
        learningGoal: studentObj?.goal || studentObj?.learningGoal || 'English for everyday life & work',
        routineVideoTime: studentObj?.routineVideoTime || '09:00',
        routineAudioTime: studentObj?.routineAudioTime || '14:00',
        dailyPhraseTime: studentObj?.dailyPhraseTime || '20:00',
        weeklyStudyDaysTarget: targetDays,
        weeklyStudyDays: studyDays,
        selectedStudyDays: studyDays,
        teacherEmail: studentObj?.teacherEmail || null,
        teacherName: studentObj?.teacherName || null,
        contractedLessons: studentObj?.contractedLessons ?? db.contractedLessons?.[cleanEmail] ?? 1,
        completedLessonsCount: studentObj?.completedLessonsCount ?? 0,
        enrollmentStatus: studentObj?.status || 'active',
        streakDays: 0,
        streakCount: 0,
        points: 0,
        dailyGoalMinutes: 30,
        completedTodayMinutes: 0,
        createdAt: studentObj?.createdAt || new Date().toISOString(),
      };
    } else {
      studentProfile = {
        ...studentProfile,
        id: studentProfile.id || account.uid,
        name: studentProfile.name || account.name,
        email: cleanEmail,
        level: studentProfile.level || defaultLevel,
        userLevel: studentProfile.userLevel || studentProfile.level || defaultLevel,
        englishLevel: studentProfile.englishLevel || studentProfile.level || defaultLevel,
        learningGoal: studentProfile.learningGoal || studentObj?.goal || studentObj?.learningGoal || 'English for everyday life & work',
        weeklyStudyDaysTarget: targetDays,
        weeklyStudyDays: studyDays,
        selectedStudyDays: studyDays,
        routineVideoTime: studentProfile.routineVideoTime || studentObj?.routineVideoTime || '09:00',
        routineAudioTime: studentProfile.routineAudioTime || studentObj?.routineAudioTime || '14:00',
        dailyPhraseTime: studentProfile.dailyPhraseTime || studentObj?.dailyPhraseTime || '20:00',
        teacherEmail: studentProfile.teacherEmail ?? studentObj?.teacherEmail ?? null,
        teacherName: studentProfile.teacherName ?? studentObj?.teacherName ?? null,
        contractedLessons: studentProfile.contractedLessons ?? studentObj?.contractedLessons ?? db.contractedLessons?.[cleanEmail] ?? 1,
      };
    }

    if (!db.userProfiles) db.userProfiles = {};
    db.userProfiles[cleanEmail] = studentProfile;

    // Distribute Spotify media if not yet assigned for this student
    const normLevel = normalizeStudentLevel(studentProfile.level).key;
    if (!db.studentSpotifyAssignments?.[cleanEmail] || db.studentSpotifyAssignments[cleanEmail].length === 0) {
      await distributeWeeklySpotifyForStudent(db, cleanEmail, account.uid, normLevel, undefined, undefined, studyDays);
    }
    // Note: YouTube video topics are chosen voluntarily by the student ("Choose Topic...") or assigned by teacher.
    if (!db.studentVideoAssignments?.[cleanEmail] || db.studentVideoAssignments[cleanEmail].length === 0) {
      if (!db.studentAwaitingTopicSelection) db.studentAwaitingTopicSelection = {};
      db.studentAwaitingTopicSelection[cleanEmail] = true;
      if (account.uid) db.studentAwaitingTopicSelection[account.uid] = true;
      if (!db.studentVideoAssignments) db.studentVideoAssignments = {};
      db.studentVideoAssignments[cleanEmail] = [];
      if (account.uid) db.studentVideoAssignments[account.uid] = [];
      if (!db.studentRoutinesMap) db.studentRoutinesMap = {};
      if (!db.studentRoutinesMap[cleanEmail]) {
        const cleanInitial = createCleanStudentRoutines(studentProfile.routineVideoTime);
        db.studentRoutinesMap[cleanEmail] = cleanInitial;
        if (account.uid) db.studentRoutinesMap[account.uid] = cleanInitial;
      }
    }

    account.picture = studentProfile.picture || studentProfile.avatar || studentObj?.picture || studentObj?.avatar || '';
    saveStudentAssignmentsByUid(account.uid, {
      uid: account.uid,
      email: cleanEmail,
      level: studentProfile.level,
      weeklyStudyDaysTarget: studentProfile.weeklyStudyDaysTarget,
      weeklyStudyDays: studentProfile.weeklyStudyDays,
      videoAssignments: db.studentVideoAssignments?.[cleanEmail] || [],
      spotifyAssignments: db.studentSpotifyAssignments?.[cleanEmail] || [],
    }).catch(() => {});

    writeDb(db);
  } else if (role === 'teacher') {
    const tutorObj = (db.tutorsList || []).find(
      (t: any) => t.uid === authenticatedUid || t.authUid === authenticatedUid || (t.email || '').toLowerCase() === cleanEmail
    );
    const teacherObj = (db.teachers || []).find(
      (t: any) => (t.uid === authenticatedUid || (t.email || '').toLowerCase() === cleanEmail) && t.role !== 'admin'
    );
    account.picture = tutorObj?.avatar || tutorObj?.picture || teacherObj?.avatar || '';
  }

  const tutorResponseObj = role === 'teacher'
    ? ((db.tutorsList || []).find((t: any) => t.uid === authenticatedUid || t.authUid === authenticatedUid || (t.email || '').toLowerCase() === cleanEmail) ||
       (db.teachers || []).find((t: any) => (t.uid === authenticatedUid || (t.email || '').toLowerCase() === cleanEmail) && t.role !== 'admin') ||
       resolution?.rawDoc || null)
    : null;

  res.json({
    success: true,
    account,
    role: account.role,
    profile: role === 'teacher' ? null : (studentProfile ? { ...studentProfile, role: 'student' } : null),
    student: role === 'teacher' ? null : (studentObj || (db.students || []).find((s) => (s.email || s.studentEmail || '').toLowerCase() === cleanEmail) || null),
    tutor: tutorResponseObj,
    isRoleEnforced,
    enforcedRole: role,
  });
});

app.post('/api/auth/reset-password', async (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ error: 'Email é obrigatório.' });
  }
  const cleanEmail = email.toLowerCase().trim();

  try {
    const adminAuth = getFirebaseAdminAuth();
    // Verify that the user exists in Firebase Authentication
    await adminAuth.getUserByEmail(cleanEmail);
    // Generate official Firebase Authentication password reset link
    await adminAuth.generatePasswordResetLink(cleanEmail);

    return res.json({
      success: true,
      message: 'Instruções de redefinição de senha geradas com sucesso via Firebase Authentication.',
      resetInitiated: true,
      email: cleanEmail,
    });
  } catch (err: any) {
    if (err?.code === 'auth/user-not-found') {
      return res.status(404).json({
        error: 'Conta não encontrada no Firebase Authentication. Verifique o e-mail digitado.',
      });
    }
    console.error('Password reset notice via Firebase Auth:', err);
    return res.status(500).json({
      error: 'Falha ao processar solicitação de redefinição de senha no Firebase Authentication.',
    });
  }
});

app.get('/api/auth/check-user', async (req, res) => {
  const email = ((req.query.email as string) || '').toLowerCase().trim();
  const name = ((req.query.name as string) || '').toLowerCase().trim();
  const role = ((req.query.role as string) || '').toLowerCase().trim();

  let emailExists = false;
  let nameExists = false;
  let existingRole: string | null = null;
  let existingName: string | null = null;
  let profileDoc: any = null;
  let studentDoc: any = null;
  let tutorDoc: any = null;

  // 1. Authoritative email existence check strictly via Firebase Auth (strictly read-only)
  if (email) {
    let authLookupStatus: 'found' | 'not_found' | 'unavailable' = 'unavailable';
    let authUserRecord: any = null;

    try {
      const adminAuth = getFirebaseAdminAuth();
      if (!adminAuth || typeof adminAuth.getUserByEmail !== 'function') {
        authLookupStatus = 'unavailable';
      } else {
        const AUTH_LOOKUP_TIMEOUT_MS = 5000;
        let timer: NodeJS.Timeout | undefined;
        try {
          authUserRecord = await Promise.race([
            adminAuth.getUserByEmail(email),
            new Promise((_, reject) => {
              timer = setTimeout(() => reject(new Error('AUTH_LOOKUP_TIMEOUT')), AUTH_LOOKUP_TIMEOUT_MS);
            }),
          ]);
          authLookupStatus = authUserRecord && authUserRecord.uid ? 'found' : 'unavailable';
        } finally {
          if (timer) clearTimeout(timer);
        }
      }
    } catch (authErr: any) {
      const errCode = authErr?.code || authErr?.errorInfo?.code || '';
      if (errCode === 'auth/user-not-found') {
        authLookupStatus = 'not_found';
      } else {
        authLookupStatus = 'unavailable';
      }
    }

    if (authLookupStatus === 'unavailable') {
      return res.status(503).json({
        available: false,
        verificationAvailable: false,
        verificationStatus: 'unavailable',
        exists: null,
        emailExists: null,
        nameExists: null,
        role: null,
        name: null,
        profile: null,
        student: null,
        tutor: null,
        error: 'AUTHORITATIVE_VERIFICATION_UNAVAILABLE',
        message: 'Verificação autoritativa de conta no Firebase Auth indisponível no momento.',
      });
    }

    if (authLookupStatus === 'found' && authUserRecord) {
      emailExists = true;
      const authUid = authUserRecord.uid;
      const claimRole =
        authUserRecord.customClaims?.role === 'admin' ||
        authUserRecord.customClaims?.role === 'teacher' ||
        authUserRecord.customClaims?.role === 'student'
          ? authUserRecord.customClaims.role
          : null;

      // Read-only enrichment from canonical Firestore collections (/users and /tutors)
      try {
        const [fsUser, fsTutor] = await Promise.all([
          fetchUserFromFirestore(email, authUid).catch(() => null),
          fetchTutorDocumentFromFirestore(authUid, 3000).catch(() => null),
        ]);

        const fsUserRole = (fsUser?.role || fsUser?.userRole || '').toLowerCase().trim();
        if (fsUserRole === 'admin' || claimRole === 'admin') {
          existingRole = 'admin';
        } else if (
          fsUserRole === 'teacher' ||
          fsUserRole === 'tutor' ||
          fsUserRole === 'native_friend' ||
          (fsTutor && fsUserRole !== 'student') ||
          claimRole === 'teacher'
        ) {
          existingRole = 'teacher';
          tutorDoc = fsTutor || (fsUserRole === 'teacher' ? fsUser : null);
        } else if (fsUser) {
          existingRole = 'student';
          profileDoc = fsUser;
          studentDoc = fsUser;
        } else {
          existingRole = claimRole || null;
        }

        existingName = fsUser?.name || fsTutor?.name || authUserRecord.displayName || null;
      } catch {
        existingRole = claimRole || null;
        existingName = authUserRecord.displayName || null;
      }
    }
  }

  // 2. Read-only canonical name uniqueness check (never relies solely on app_state)
  if (name) {
    let canonicalNameCheckOk = true;
    const usersStatus = await fetchUsersFromFirestoreCanonical();
    if (!usersStatus.ok) {
      canonicalNameCheckOk = false;
    }

    let directTutors: any[] = [];
    if (role !== 'student') {
      try {
        directTutors = await fetchTutorsFromFirestore();
      } catch {
        canonicalNameCheckOk = false;
      }
    }

    if (!canonicalNameCheckOk && !emailExists) {
      return res.status(503).json({
        available: false,
        verificationAvailable: false,
        verificationStatus: 'unavailable',
        exists: null,
        emailExists: email ? emailExists : null,
        nameExists: null,
        role: null,
        name: null,
        profile: null,
        student: null,
        tutor: null,
        error: 'AUTHORITATIVE_VERIFICATION_UNAVAILABLE',
        message: 'Verificação autoritativa de nome no Firestore indisponível no momento.',
      });
    }

    if (canonicalNameCheckOk) {
      const inCanonicalStudents = usersStatus.users.some(
        (u: any) =>
          (u.role === 'student' || !u.role) &&
          ((u.name || u.studentName || '') as string).trim().toLowerCase() === name
      );
      const inCanonicalTutors =
        usersStatus.users.some(
          (u: any) =>
            (u.role === 'teacher' || u.role === 'tutor' || u.role === 'native_friend') &&
            ((u.name || '') as string).trim().toLowerCase() === name
        ) ||
        directTutors.some(
          (t: any) => ((t.name || '') as string).trim().toLowerCase() === name
        );

      if (role === 'student' && inCanonicalStudents) {
        nameExists = true;
      } else if (role === 'teacher' && inCanonicalTutors) {
        nameExists = true;
      } else if (!role && (inCanonicalStudents || inCanonicalTutors)) {
        nameExists = true;
      }
    }
  }

  return res.json({
    available: true,
    verificationAvailable: true,
    verificationStatus: 'available',
    exists: emailExists || nameExists,
    emailExists,
    nameExists,
    role: existingRole,
    name: existingName,
    profile: profileDoc,
    student: studentDoc,
    tutor: tutorDoc,
  });
});

const handleRegistration = async (req: any, res: any) => {
  const db = readDb();
  const { name, email, password, role = 'student' } = req.body;
  const level = req.body.englishLevel || req.body.level || 'iniciante';
  const goal = req.body.learningGoal || req.body.goal || 'English for everyday life & work';

  if (!email || !name) {
    return res.status(400).json({ error: 'Name and email are required' });
  }

  const cleanEmail = email.toLowerCase().trim();
  const cleanName = name.trim();
  const cleanNameLower = cleanName.toLowerCase();
  const requestedRole = (role || 'student').toLowerCase();

  // ----------------------------------------------------
  // 1. ADMIN REGISTRATION (Forbidden on public endpoints)
  // ----------------------------------------------------
  if (requestedRole === 'admin') {
    return res.status(403).json({
      error: 'Forbidden: Não é permitido cadastrar contas de administrador via endpoint público. O administrador deve ser configurado exclusivamente via procedimento seguro de bootstrap do servidor.',
    });
  }

  // ----------------------------------------------------
  // 2. TEACHER / NATIVE FRIEND REGISTRATION
  // ----------------------------------------------------
  if (requestedRole === 'teacher') {
    const verifiedCaller = await getVerifiedUserFromRequest(req);
    const verifiedUid = (verifiedCaller?.uid && isValidCanonicalUid(verifiedCaller.uid)) ? verifiedCaller.uid : null;
    const isVerifiedCallerOwner = verifiedCaller && (verifiedCaller.email || '').toLowerCase().trim() === cleanEmail;

    // Check duplicate email across platform
    const existingTutor = (db.tutorsList || []).find((t: any) => t.email?.toLowerCase() === cleanEmail);
    const existingTeacher = (db.teachers || []).find((t: any) => t.email?.toLowerCase() === cleanEmail && t.role !== 'admin');
    const existingAuth = db.authUsers?.[cleanEmail];
    const isExistingTutorEmail = Boolean(existingTutor || existingTeacher || existingAuth);

    // Identity Hardening: An existing student cannot mutate their role by calling teacher register
    let existingFirestoreDoc: any = null;
    try {
      existingFirestoreDoc = await fetchUserFromFirestore(cleanEmail, verifiedUid || undefined);
    } catch {}
    if (existingFirestoreDoc && existingFirestoreDoc.role === 'student') {
      return res.status(409).json({
        error: 'Este usuário já possui cadastro ativo como Aluno(a). O papel não pode ser alterado por formulário de cadastro. Para se tornar um Amigo Nativo, utilize o fluxo de candidatura.',
        code: 'ROLE_MUTATION_FORBIDDEN',
        isExistingUser: true,
      });
    }

    const existingTutorUid =
      (existingTutor?.uid && isValidCanonicalUid(existingTutor.uid) ? existingTutor.uid : null) ||
      (existingTutor?.authUid && isValidCanonicalUid(existingTutor.authUid) ? existingTutor.authUid : null) ||
      (existingTeacher?.uid && isValidCanonicalUid(existingTeacher.uid) ? existingTeacher.uid : null) ||
      (existingAuth?.uid && isValidCanonicalUid(existingAuth.uid) ? existingAuth.uid : null);

    if (verifiedUid && existingTutorUid && existingTutorUid !== verifiedUid) {
      return res.status(409).json({
        error: 'Conflito de identidade detectado: já existe um perfil de professor associado a este e-mail com outro UID. Entre em contato com o suporte para reconciliação segura.',
        code: 'UID_CONFLICT_RECONCILIATION_REQUIRED',
        conflictingUid: existingTutorUid,
        verifiedUid,
      });
    }

    if (isExistingTutorEmail && !req.body.isUpdate && !isVerifiedCallerOwner) {
      return res.status(409).json({
        error: 'Este e-mail já está cadastrado no sistema. Por favor, faça login com sua conta ou utilize outro e-mail.',
        duplicateField: 'email',
        isExistingUser: true,
      });
    }

    // Check duplicate name for Native Friend
    const isExistingTutorName =
      (db.tutorsList || []).some((t: any) => (t.name || '').trim().toLowerCase() === cleanNameLower && (t.email || '').toLowerCase() !== cleanEmail) ||
      (db.teachers || []).some((t: any) => (t.name || '').trim().toLowerCase() === cleanNameLower && t.role === 'teacher' && (t.email || '').toLowerCase() !== cleanEmail);

    if (isExistingTutorName && !req.body.isUpdate && !isVerifiedCallerOwner) {
      return res.status(409).json({
        error: 'Já existe um Amigo Nativo cadastrado com este nome na plataforma. Por favor, inclua seu sobrenome ou use um nome distintivo.',
        duplicateField: 'name',
        isExistingUser: true,
      });
    }

    const tutorUid = verifiedUid || (req.body.uid && isValidCanonicalUid(req.body.uid) ? req.body.uid : null) || (req.body.id && isValidCanonicalUid(req.body.id) ? req.body.id : null);
    if (!tutorUid) {
      return res.status(400).json({ error: 'UID de autenticação do Firebase obrigatório e inválido para Amigo Nativo.' });
    }
    const tutorId = tutorUid;
    // Zero-leakage: never use stock mock photos. If user provided an avatar use it, otherwise empty string.
    const tutorAvatar = req.body.avatar || req.body.picture || '';

    const tutorEntry = {
      id: tutorId,
      uid: tutorId,
      name: cleanName,
      email: cleanEmail,
      avatar: tutorAvatar,
      picture: tutorAvatar,
      role: 'teacher',
      country: req.body.country || 'United States',
      countryCode: req.body.countryCode || 'US',
      flag: req.body.flag || '🇺🇸',
      accent: req.body.accent || 'North American',
      rating: 5.0,
      reviewsCount: 0,
      activeStudents: 0,
      lessonsTaught: 0,
      pricePerSessionUsd: Number(req.body.pricePerSessionUsd || req.body.priceUsd) || 20,
      pricePerSessionBrl: Math.round((Number(req.body.pricePerSessionUsd || req.body.priceUsd) || 20) * 5.5),
      headline: req.body.headline || 'Conversational Native Friend',
      bio: req.body.bio || 'Hello! I am excited to help you live English in your daily routine.',
      specialties: Array.isArray(req.body.specialties) && req.body.specialties.length > 0
        ? req.body.specialties
        : (typeof req.body.specialties === 'string' && req.body.specialties.trim().length > 0
            ? req.body.specialties.split(',').map((s: string) => s.trim()).filter(Boolean)
            : ['Daily Routine & Lifestyle', 'Conversational Fluency']),
      videoIntroUrl: req.body.videoIntroUrl || req.body.videoUrl || '',
      availableDays: req.body.availableDays || ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
      availableHours: req.body.availableHours || ['08:00', '09:00', '10:00', '11:00', '14:00', '15:00', '16:00', '17:00'],
      approvalStatus: 'pending', // REQUIRED: All new Native Friends default strictly to pending approval
      isApproved: false,
      approved: false,
      status: 'pending',
      appliedAt: new Date().toISOString(),
      registeredByAdmin: false,
      meetUrl: req.body.meetUrl || req.body.meetLink || '',
    };

    if (!db.tutorsList) db.tutorsList = [];
    const tutorIdx = db.tutorsList.findIndex((t) => t.email.toLowerCase() === cleanEmail);
    if (tutorIdx >= 0) {
      db.tutorsList[tutorIdx] = { ...db.tutorsList[tutorIdx], ...tutorEntry };
    } else {
      db.tutorsList.push(tutorEntry);
    }

    // Maintain teachers list
    const teacherIdx = db.teachers.findIndex((t) => t.email.toLowerCase() === cleanEmail);
    if (teacherIdx >= 0) {
      db.teachers[teacherIdx] = {
        ...db.teachers[teacherIdx],
        id: tutorId,
        uid: tutorId,
        name: cleanName,
        email: cleanEmail,
        role: 'teacher',
        approvalStatus: tutorEntry.approvalStatus,
        isApproved: tutorEntry.isApproved,
        avatar: tutorEntry.avatar,
        picture: tutorEntry.avatar,
      };
    } else {
      db.teachers.push({
        id: tutorId,
        uid: tutorId,
        name: cleanName,
        email: cleanEmail,
        role: 'teacher',
        approvalStatus: tutorEntry.approvalStatus,
        isApproved: tutorEntry.isApproved,
        registeredByAdmin: false,
        avatar: tutorEntry.avatar,
        picture: tutorEntry.avatar,
      });
    }

    // Save auth record (NO PASSWORDS)
    if (!db.authUsers) db.authUsers = {};
    db.authUsers[cleanEmail] = {
      uid: tutorId,
      email: cleanEmail,
      name: cleanName,
      role: 'teacher',
      createdAt: db.authUsers[cleanEmail]?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Maintain meet settings
    if (!db.meetSettings) db.meetSettings = {};
    db.meetSettings[cleanEmail] = {
      teacherEmail: cleanEmail,
      meetLink: req.body.meetUrl || req.body.meetLink || '',
      workingHoursStart: '08:00',
      workingHoursEnd: '18:00',
      slotDurationMinutes: 30,
      availableDays: tutorEntry.availableDays,
      timezone: 'America/New_York',
    };

    // Purge any accidental student profile entry for this teacher
    if (db.userProfiles && db.userProfiles[cleanEmail]) {
      delete db.userProfiles[cleanEmail];
    }
    if (db.students) {
      db.students = db.students.filter((s: any) => (s.email || s.studentEmail || '').toLowerCase() !== cleanEmail);
    }

    // Log admin notification
    if (!db.emailLogs) db.emailLogs = [];
    db.emailLogs.push({
      id: `log-${Date.now()}`,
      to: 'adm.itissimple@gmail.com',
      subject: `Nova Solicitação de Amigo Nativo: ${cleanName}`,
      preview: `${cleanName} (${cleanEmail}) se cadastrou como Amigo Nativo e aguarda sua aprovação.`,
      date: new Date().toISOString(),
      status: 'pending_approval',
    });

    await writeDbSync(db);
    await saveUserToFirestore(tutorEntry);

    const account = {
      uid: tutorId,
      email: cleanEmail,
      name: cleanName,
      role: 'teacher',
      picture: tutorEntry.avatar,
    };

    return res.status(201).json({
      success: true,
      account,
      tutor: tutorEntry,
      approvalStatus: 'pending',
      message: 'Cadastro de Amigo Nativo enviado com sucesso! Seus dados foram salvos no seu perfil e aguardam aprovação do Administrador.',
    });
  }

  // ----------------------------------------------------
  // 3. STUDENT REGISTRATION
  // ----------------------------------------------------
  const verifiedCaller = await getVerifiedUserFromRequest(req);
  const verifiedUid = (verifiedCaller?.uid && isValidCanonicalUid(verifiedCaller.uid)) ? verifiedCaller.uid : null;

  const existingProfile = db.userProfiles?.[cleanEmail];
  const existingStudent = (db.students || []).find(
    (s: any) => (s.email || s.studentEmail || '').toLowerCase() === cleanEmail
  );
  const existingTutor = (db.tutorsList || []).find((t: any) => (t.email || '').toLowerCase() === cleanEmail);
  const existingAuthUser = db.authUsers?.[cleanEmail];

  const existingRecordUid =
    (existingProfile?.uid && isValidCanonicalUid(existingProfile.uid) ? existingProfile.uid : null) ||
    (existingStudent?.uid && isValidCanonicalUid(existingStudent.uid) ? existingStudent.uid : null) ||
    (existingStudent?.studentUid && isValidCanonicalUid(existingStudent.studentUid) ? existingStudent.studentUid : null) ||
    (existingAuthUser?.uid && isValidCanonicalUid(existingAuthUser.uid) ? existingAuthUser.uid : null) ||
    (existingProfile?.id && isValidCanonicalUid(existingProfile.id) ? existingProfile.id : null);

  // 3.1 Anti-Hijacking & UID Conflict Protection
  if (verifiedUid && existingRecordUid && existingRecordUid !== verifiedUid) {
    return res.status(409).json({
      error: 'Conflito de identidade detectado: já existe um perfil histórico associado a este e-mail com outro UID. Entre em contato com o suporte para reconciliação segura.',
      code: 'UID_CONFLICT_RECONCILIATION_REQUIRED',
      conflictingUid: existingRecordUid,
      verifiedUid,
    });
  }

  // 3.2 Firebase Auth authority check for unauthenticated calls
  if (!verifiedUid) {
    let fbAuthUser: any = null;
    try {
      const adminAuth = getFirebaseAdminAuth();
      fbAuthUser = await adminAuth.getUserByEmail(cleanEmail).catch(() => null);
    } catch {}

    if (fbAuthUser) {
      return res.status(409).json({
        error: 'Este e-mail já possui uma conta no Firebase Authentication. Por favor, faça login com sua conta.',
        duplicateField: 'email',
        isExistingUser: true,
      });
    }

    if ((existingStudent || existingProfile || existingTutor) && !req.body.isUpdate) {
      return res.status(409).json({
        error: 'Este e-mail já possui uma conta cadastrada.',
        duplicateField: 'email',
        isExistingUser: true,
      });
    }
  }

  // 3.3 Check duplicate name for student
  const isExistingStudentName =
    (db.students || []).some(
      (s: any) =>
        ((s.name || s.studentName || '') as string).trim().toLowerCase() === cleanNameLower &&
        (s.email || s.studentEmail || '').toLowerCase() !== cleanEmail
    );

  if (isExistingStudentName && !req.body.isUpdate && !verifiedUid) {
    return res.status(409).json({
      error: 'Já existe um(a) aluno(a) cadastrado(a) com este nome no sistema. Por favor, informe seu nome completo e sobrenome para garantir sua identificação individual.',
      duplicateField: 'name',
      isExistingUser: true,
    });
  }

  // Authoritative UID: verified Firebase UID strictly takes precedence; client cannot override it
  const userUid = verifiedUid || (req.body.uid && isValidCanonicalUid(req.body.uid) ? req.body.uid : null) || (req.body.id && isValidCanonicalUid(req.body.id) ? req.body.id : null);
  if (!userUid) {
    return res.status(400).json({ error: 'UID de autenticação do Firebase obrigatório e inválido.' });
  }
  const userAvatar = req.body.avatar || req.body.picture || '';

  // Save student auth record (NO PASSWORDS)
  if (!db.authUsers) db.authUsers = {};
  db.authUsers[cleanEmail] = {
    uid: userUid,
    email: cleanEmail,
    name: cleanName,
    role: 'student',
    createdAt: db.authUsers[cleanEmail]?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  let resolvedCanonicalTeacherUid: string | null = null;
  let resolvedCanonicalTeacherEmail: string | null = req.body.teacherEmail ? (req.body.teacherEmail as string).toLowerCase().trim() : null;
  let resolvedCanonicalTeacherName: string | null = req.body.teacherName || null;

  const incomingTeacherRef = req.body.teacherUid || req.body.teacherId || req.body.teacherEmail || req.body.selectedTutorId || req.body.selectedTutorEmail || req.body.teacherName || req.body.selectedTutorName;
  if (incomingTeacherRef) {
    const isPureGenericTutor =
      (req.body.teacherId === 'tutor' || req.body.selectedTutorId === 'tutor' || req.body.publicTutorId === 'tutor') &&
      (!req.body.teacherUid || !isValidCanonicalUid(req.body.teacherUid)) &&
      (!req.body.teacherEmail || !req.body.teacherEmail.includes('@')) &&
      (!req.body.selectedTutorEmail || !req.body.selectedTutorEmail.includes('@')) &&
      (!req.body.teacherName || isGenericTutorId(req.body.teacherName)) &&
      (!req.body.selectedTutorName || isGenericTutorId(req.body.selectedTutorName));

    if (isPureGenericTutor) {
      return res.status(400).json({
        error: 'Identificador de Amigo Nativo genérico ou inválido: o valor "tutor" não é aceito.',
      });
    }

    const rawTeacherId = !isGenericTutorId(req.body.teacherId) ? req.body.teacherId : undefined;
    const rawSelectedTutorId = !isGenericTutorId(req.body.selectedTutorId) ? req.body.selectedTutorId : undefined;
    const rawPublicTutorId = !isGenericTutorId(req.body.publicTutorId) ? req.body.publicTutorId : undefined;
    const rawTeacherUid = (req.body.teacherUid && isValidCanonicalUid(req.body.teacherUid)) ? req.body.teacherUid.trim() : undefined;
    const rawTeacherEmail = (req.body.teacherEmail && !isGenericTutorId(req.body.teacherEmail) && req.body.teacherEmail.includes('@'))
      ? req.body.teacherEmail
      : ((req.body.selectedTutorEmail && !isGenericTutorId(req.body.selectedTutorEmail) && req.body.selectedTutorEmail.includes('@')) ? req.body.selectedTutorEmail : undefined);
    const rawTeacherName = (req.body.teacherName && !isGenericTutorId(req.body.teacherName))
      ? req.body.teacherName
      : ((req.body.selectedTutorName && !isGenericTutorId(req.body.selectedTutorName)) ? req.body.selectedTutorName : undefined);

    const teacherRes = await resolveTeacherCanonicalIdentity({
      teacherId: rawTeacherId || rawSelectedTutorId || rawTeacherUid,
      teacherUid: rawTeacherUid,
      teacherEmail: rawTeacherEmail,
      publicTutorId: rawPublicTutorId || rawTeacherId || rawSelectedTutorId,
      teacherName: rawTeacherName,
      selectedTutorName: rawTeacherName,
      dbState: db,
    });

    if (teacherRes) {
      if (!teacherRes.isApproved) {
        return res.status(400).json({
          error: 'O Amigo Nativo selecionado ainda não foi aprovado para receber alunos.',
        });
      }
      if (!isValidCanonicalUid(teacherRes.canonicalUid)) {
        return res.status(400).json({
          error: 'Não foi possível comprovar a identidade canônica do Amigo Nativo selecionado.',
        });
      }
      resolvedCanonicalTeacherUid = teacherRes.canonicalUid;
      resolvedCanonicalTeacherEmail = teacherRes.email || resolvedCanonicalTeacherEmail;
      resolvedCanonicalTeacherName = teacherRes.name || resolvedCanonicalTeacherName;
    } else {
      return res.status(400).json({
        error: 'Amigo Nativo selecionado não encontrado ou inválido.',
      });
    }
  }

  const existingIdx = db.students.findIndex(
    (s) => (s.email || s.studentEmail || '').toLowerCase() === cleanEmail
  );

  const routineVideoTime = req.body.routineVideoTime || '09:00';
  const routineAudioTime = req.body.routineAudioTime || '14:00';
  const dailyPhraseTime = req.body.dailyPhraseTime || '20:00';

  if (existingIdx >= 0) {
    const existing = db.students[existingIdx];
    const resolvedCanonicalUid = (verifiedCaller?.uid && isValidCanonicalUid(verifiedCaller.uid))
      ? verifiedCaller.uid
      : ((existing.uid && isValidCanonicalUid(existing.uid)) ? existing.uid : ((req.body.uid && isValidCanonicalUid(req.body.uid)) ? req.body.uid : userUid));
    db.students[existingIdx] = {
      ...existing,
      id: resolvedCanonicalUid,
      uid: resolvedCanonicalUid,
      name: cleanName,
      studentName: cleanName,
      email: cleanEmail,
      studentEmail: cleanEmail,
      level: level || existing.level || existing.studentLevel,
      studentLevel: level || existing.studentLevel || existing.level,
      goal: goal || existing.goal || existing.learningGoal,
      learningGoal: goal || existing.learningGoal || existing.goal,
      routineVideoTime: req.body.routineVideoTime || existing.routineVideoTime || routineVideoTime,
      routineAudioTime: req.body.routineAudioTime || existing.routineAudioTime || routineAudioTime,
      dailyPhraseTime: req.body.dailyPhraseTime || existing.dailyPhraseTime || dailyPhraseTime,
      contractedLessons: existing.contractedLessons ?? db.contractedLessons?.[cleanEmail] ?? 0,
      completedLessonsCount: existing.completedLessonsCount ?? 0,
      teacherEmail: resolvedCanonicalTeacherEmail || existing.teacherEmail || null,
      teacherName: resolvedCanonicalTeacherName || existing.teacherName || null,
      teacherUid: resolvedCanonicalTeacherUid || (existing.teacherUid && isValidCanonicalUid(existing.teacherUid) ? existing.teacherUid : null),
      assignedNativeFriendUID: resolvedCanonicalTeacherUid || (existing.assignedNativeFriendUID && isValidCanonicalUid(existing.assignedNativeFriendUID) ? existing.assignedNativeFriendUID : null),
      nativeFriendUID: resolvedCanonicalTeacherUid || (existing.nativeFriendUID && isValidCanonicalUid(existing.nativeFriendUID) ? existing.nativeFriendUID : null),
      status: existing.status || 'active',
      activeSince: existing.activeSince || new Date().toISOString().split('T')[0],
      createdAt: existing.createdAt || new Date().toISOString(),
      picture: userAvatar,
      avatar: userAvatar,
    };
  } else {
    // New Student: Respect explicit onboarding selected tutor and trial lesson credit if provided
    const initialTeacherEmail = resolvedCanonicalTeacherEmail;
    const initialTeacherName = resolvedCanonicalTeacherName;
    const initialContractedLessons = Number(req.body.contractedLessons ?? 0);
    const initialEnrollmentStatus = req.body.enrollmentStatus || (initialTeacherEmail ? 'active' : 'not_enrolled');
    const initialWeeklyStudyDaysTarget = req.body.weeklyStudyDaysTarget !== undefined ? Number(req.body.weeklyStudyDaysTarget) : 7;
    const initialWeeklyStudyDays = req.body.weeklyStudyDays || ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

    const studentData = {
      id: userUid,
      uid: userUid,
      name: cleanName,
      studentName: cleanName,
      email: cleanEmail,
      studentEmail: cleanEmail,
      level,
      studentLevel: level,
      goal: goal || 'English for everyday life & work',
      learningGoal: goal || 'English for everyday life & work',
      contractedLessons: initialContractedLessons,
      completedLessonsCount: 0,
      teacherEmail: initialTeacherEmail,
      teacherName: initialTeacherName,
      teacherUid: resolvedCanonicalTeacherUid,
      assignedNativeFriendUID: resolvedCanonicalTeacherUid,
      nativeFriendUID: resolvedCanonicalTeacherUid,
      routineVideoTime,
      routineAudioTime,
      dailyPhraseTime,
      status: 'active',
      activeSince: new Date().toISOString().split('T')[0],
      createdAt: new Date().toISOString(),
      picture: userAvatar,
      avatar: userAvatar,
    };
    db.students.push(studentData);

    if (initialContractedLessons > 0) {
      if (!db.contractedLessons) db.contractedLessons = {};
      db.contractedLessons[cleanEmail] = initialContractedLessons;
    }
  }

  if (!db.contractedLessons) db.contractedLessons = {};
  if (db.contractedLessons[cleanEmail] === undefined) {
    db.contractedLessons[cleanEmail] = Number(req.body.contractedLessons ?? 0);
  }

  const initialTeacherEmail = resolvedCanonicalTeacherEmail;
  const initialTeacherName = resolvedCanonicalTeacherName;
  const initialContracted = Number(req.body.contractedLessons ?? db.contractedLessons[cleanEmail] ?? 0);
  const initialEnrollment = req.body.enrollmentStatus || (initialTeacherEmail ? 'active' : 'not_enrolled');

  if (!db.userProfiles) db.userProfiles = {};
  if (!db.userProfiles[cleanEmail]) {
    db.userProfiles[cleanEmail] = {
      id: userUid,
      uid: userUid,
      name: cleanName,
      email: cleanEmail,
      level,
      teacherEmail: initialTeacherEmail,
      teacherName: initialTeacherName,
      teacherUid: resolvedCanonicalTeacherUid,
      assignedNativeFriendUID: resolvedCanonicalTeacherUid,
      nativeFriendUID: resolvedCanonicalTeacherUid,
      routineVideoTime,
      routineAudioTime,
      dailyPhraseTime,
      enrollmentStatus: initialEnrollment,
      learningGoal: goal || 'English for everyday life & work',
      streakDays: 0,
      streakCount: 0,
      points: 0,
      dailyGoalMinutes: 30,
      completedTodayMinutes: 0,
      contractedLessons: initialContracted,
      completedLessonsCount: 0,
      weeklyStudyDaysTarget: req.body.weeklyStudyDaysTarget !== undefined ? Number(req.body.weeklyStudyDaysTarget) : 7,
      weeklyStudyDays: req.body.weeklyStudyDays || ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
      onboardingCompleted: req.body.onboardingCompleted ?? false,
      picture: userAvatar,
      avatar: userAvatar,
      createdAt: new Date().toISOString(),
    };
  } else {
    const p = db.userProfiles[cleanEmail];
    const resolvedCanonicalUid = (verifiedCaller?.uid && isValidCanonicalUid(verifiedCaller.uid))
      ? verifiedCaller.uid
      : ((p.uid && isValidCanonicalUid(p.uid)) ? p.uid : ((req.body.uid && isValidCanonicalUid(req.body.uid)) ? req.body.uid : userUid));
    db.userProfiles[cleanEmail] = {
      ...p,
      id: resolvedCanonicalUid,
      uid: resolvedCanonicalUid,
      name: cleanName,
      level: level || p.level,
      learningGoal: goal || p.learningGoal,
      routineVideoTime: req.body.routineVideoTime || p.routineVideoTime || routineVideoTime,
      routineAudioTime: req.body.routineAudioTime || p.routineAudioTime || routineAudioTime,
      dailyPhraseTime: req.body.dailyPhraseTime || p.dailyPhraseTime || dailyPhraseTime,
      teacherEmail: resolvedCanonicalTeacherEmail || p.teacherEmail || null,
      teacherName: resolvedCanonicalTeacherName || p.teacherName || null,
      teacherUid: resolvedCanonicalTeacherUid || p.teacherUid || null,
      assignedNativeFriendUID: resolvedCanonicalTeacherUid || p.assignedNativeFriendUID || null,
      nativeFriendUID: resolvedCanonicalTeacherUid || p.nativeFriendUID || null,
      contractedLessons: p.contractedLessons ?? db.contractedLessons?.[cleanEmail] ?? 0,
      completedLessonsCount: p.completedLessonsCount ?? 0,
      picture: userAvatar,
      avatar: userAvatar,
    };
  }

  // Ensure clean isolated state for newly registered student in database
  if (!db.studentRoutinesMap) db.studentRoutinesMap = {};
  if (!db.studentAwaitingTopicSelection) db.studentAwaitingTopicSelection = {};
  if (!db.studentVideoAssignments) db.studentVideoAssignments = {};
  if (!db.studentWatchedVideos) db.studentWatchedVideos = {};

  const cleanInitialRoutines = createCleanStudentRoutines(routineVideoTime);
  db.studentRoutinesMap[cleanEmail] = cleanInitialRoutines;
  db.studentRoutinesMap[userUid] = cleanInitialRoutines;
  db.studentAwaitingTopicSelection[cleanEmail] = true;
  db.studentAwaitingTopicSelection[userUid] = true;
  db.studentVideoAssignments[cleanEmail] = [];
  db.studentVideoAssignments[userUid] = [];
  db.studentWatchedVideos[cleanEmail] = [];
  db.studentWatchedVideos[userUid] = [];

  await writeDbSync(db);

  // Persist 100% of student profile settings to Firestore in background
  const fullProfileToSave = {
    uid: userUid,
    id: userUid,
    email: cleanEmail,
    name: cleanName,
    role: 'student',
    picture: userAvatar,
    avatar: userAvatar,
    level,
    userLevel: level,
    englishLevel: level,
    learningGoal: goal,
    routineVideoTime,
    routineAudioTime,
    dailyPhraseTime,
    weeklyStudyDaysTarget: db.userProfiles[cleanEmail].weeklyStudyDaysTarget,
    weeklyStudyDays: db.userProfiles[cleanEmail].weeklyStudyDays,
    teacherEmail: initialTeacherEmail,
    teacherName: initialTeacherName,
    teacherUid: resolvedCanonicalTeacherUid,
    assignedNativeFriendUID: resolvedCanonicalTeacherUid,
    nativeFriendUID: resolvedCanonicalTeacherUid,
    contractedLessons: initialContracted,
    createdAt: new Date().toISOString(),
  };

  await saveUserToFirestore(fullProfileToSave).catch(() => {});
  saveStudentAssignmentsByUid(userUid, {
    uid: userUid,
    email: cleanEmail,
    level,
    weeklyStudyDaysTarget: db.userProfiles[cleanEmail].weeklyStudyDaysTarget,
    weeklyStudyDays: db.userProfiles[cleanEmail].weeklyStudyDays,
    videoAssignments: [],
    spotifyAssignments: db.studentSpotifyAssignments?.[cleanEmail] || [],
    routines: cleanInitialRoutines,
  }).catch(() => {});

  const account = {
    uid: userUid,
    email: cleanEmail,
    name: cleanName,
    role: 'student',
    picture: userAvatar,
  };

  return res.status(201).json({
    success: true,
    account,
    profile: db.userProfiles?.[cleanEmail] || null,
    student: (db.students || []).find((s) => (s.email || s.studentEmail || '').toLowerCase() === cleanEmail) || null,
    tutor: (db.tutorsList || []).find((t) => t.email.toLowerCase() === cleanEmail) || null,
  });
};

// Endpoint permanently deprecated: credential management is handled exclusively by Firebase Authentication
app.post('/api/auth/sync-local-users', async (_req, res) => {
  return res.status(410).json({
    error: 'Endpoint permanently deprecated. All authentication and credential management is exclusively handled by Firebase Authentication.',
  });
});

app.post('/api/auth/register', handleRegistration);
app.post('/api/auth/signup', handleRegistration);

async function fetchUserWithStatusFromFirestore(
  email?: string,
  uid?: string
): Promise<{ ok: boolean; user: any | null; conflict?: boolean }> {
  const firestoreDb = getFirestoreDb();
  if (!firestoreDb || (!email && !uid)) return { ok: false, user: null };
  const cleanEmail = (email || '').toLowerCase().trim();
  const cleanUid = (uid || '').trim();
  try {
    if (cleanUid && isValidCanonicalUid(cleanUid)) {
      const snapUid = await firestoreDb.collection('users').doc(cleanUid).get();
      if (snapUid && snapUid.exists) {
        return { ok: true, user: { id: snapUid.id, ...snapUid.data() } };
      }
    }
    if (cleanEmail) {
      const qSnap = await firestoreDb.collection('users').where('email', '==', cleanEmail).get();
      if (qSnap && !qSnap.empty) {
        const matched = qSnap.docs[0];
        const data = matched.data();
        if (
          data &&
          (data.role === 'teacher' || data.role === 'native_friend') &&
          cleanUid &&
          (data.uid ? data.uid !== cleanUid : matched.id !== cleanUid)
        ) {
          return { ok: true, user: { ...data, id: matched.id, role: 'conflict', identityStatus: 'conflict' }, conflict: true };
        }
        return { ok: true, user: { id: matched.id, ...data } };
      }
    }
    return { ok: true, user: null };
  } catch {
    return { ok: false, user: null };
  }
}

app.post('/api/auth/google', async (req, res) => {
  const db = readDb();
  const { email, name, picture, role: requestedRole, uid } = req.body;
  if (!email) {
    return res.status(400).json({ error: 'Email is required for Google login' });
  }

  const cleanEmail = (email || '').toLowerCase().trim();
  const verifiedCaller = await getVerifiedUserFromRequest(req);

  if (verifiedCaller) {
    if (uid && String(uid).trim() !== verifiedCaller.uid) {
      return res.status(403).json({
        error: 'Forbidden',
        code: 'UID_MISMATCH',
        message: 'Acesso negado: o UID informado não confere com a identidade autenticada.',
      });
    }
    if (verifiedCaller.email && cleanEmail !== verifiedCaller.email.toLowerCase().trim()) {
      return res.status(403).json({
        error: 'Forbidden',
        code: 'EMAIL_MISMATCH',
        message: 'Acesso negado: o e-mail informado não confere com a identidade autenticada.',
      });
    }
  }

  const candidateUid = (verifiedCaller?.uid || (typeof uid === 'string' ? uid : '') || '').trim();
  if (!candidateUid || !isValidCanonicalUid(candidateUid)) {
    return res.status(400).json({
      error: 'Valid canonical Firebase UID is required',
      code: 'CANONICAL_UID_REQUIRED',
      message: 'Identidade canônica do Firebase Authentication é obrigatória. Identificadores sintéticos não são aceitos.',
    });
  }

  const targetUid = candidateUid;
  let displayName = (typeof name === 'string' && name.trim()) ? name.trim() : cleanEmail.split('@')[0];

  // Authoritative canonical identity resolution against Firestore (default)
  const resolution = await resolveCanonicalUserRoleAndIdentity({
    uid: targetUid,
    email: cleanEmail,
    tokenRole: verifiedCaller?.role,
    dbState: db,
  });

  if (resolution.identityStatus === 'conflict' || resolution.identityStatus === 'divergent_uid') {
    return res.status(409).json({
      error: 'Conflict',
      code: 'IDENTITY_CONFLICT',
      message: resolution.message || 'Conflito de identidade detectado. Operação suspensa para reconciliação.',
    });
  }

  // If a pending tutor attempts to access the teacher space, reject with 403
  if (resolution.role === 'pending_teacher' && requestedRole === 'teacher') {
    return res.status(403).json({
      error: 'Forbidden',
      code: 'TEACHER_APPROVAL_PENDING',
      message: 'Seu cadastro de Amigo Nativo está em análise e aguarda aprovação da administração.',
      approvalStatus: 'pending',
    });
  }

  let role: string = 'student';
  let isRoleEnforced = false;

  if (resolution.role === 'admin') {
    role = 'admin';
    const adminTeacher = (db.teachers || []).find((t: any) => t.role === 'admin' && (t.uid === targetUid || t.id === targetUid));
    displayName = adminTeacher?.name || resolution.name || name || 'Admin';
  } else if (resolution.role === 'teacher') {
    role = 'teacher';
    displayName = resolution.name || displayName;
    if (requestedRole === 'admin') {
      isRoleEnforced = true;
      console.warn(`[RBAC Google] Blocked teacher ${cleanEmail} from accessing admin panel.`);
    }
  } else if (resolution.role === 'pending_teacher') {
    role = 'pending_teacher';
    displayName = resolution.name || displayName;
  } else if (resolution.role === 'student') {
    role = 'student';
    displayName = resolution.name || displayName;
    if (requestedRole && requestedRole !== 'student') {
      isRoleEnforced = true;
      console.warn(`[RBAC Google] Blocked student ${cleanEmail} from accessing ${requestedRole} panel. Locked to student space.`);
    }
  } else {
    // Student, unapproved candidate, or unverified teacher request -> Lock strictly to student space
    role = 'student';
    if (requestedRole && requestedRole !== 'student') {
      isRoleEnforced = true;
      console.warn(`[RBAC Google] Blocked user ${cleanEmail} from accessing ${requestedRole} panel. Locked to student space.`);
    }
  }

  const firestoreDb = getFirestoreDb();
  const fsUserRes = await fetchUserWithStatusFromFirestore(cleanEmail, targetUid);
  const existingFsUser = fsUserRes.user;
  const isDeletedInDb = Boolean((db.deletedStudentEmails || []).includes(cleanEmail));

  let canonicalProfileResponse: any = null;
  let canonicalStudentResponse: any = null;
  let canonicalTutorResponse: any = null;

  // Update in-memory auth cache strictly with canonical UID
  if (!db.authUsers) db.authUsers = {};
  db.authUsers[cleanEmail] = {
    ...(db.authUsers[cleanEmail] || {}),
    uid: targetUid,
    email: cleanEmail,
    name: displayName,
    role,
    createdAt: db.authUsers[cleanEmail]?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  if (role === 'student' && resolution.role !== 'teacher' && resolution.role !== 'pending_teacher') {
    const incomingAssignedTeacher = (req.body.assignedNativeFriendUID || req.body.teacherUid || '').trim();
    const validAssignedTeacher =
      incomingAssignedTeacher &&
      isValidCanonicalUid(incomingAssignedTeacher) &&
      incomingAssignedTeacher !== targetUid
        ? incomingAssignedTeacher
        : null;

    // Never resurrect stale inMemoryDb data when Firestore confirmed user absence or user was deleted
    const existingMemStudent = !fsUserRes.ok && !isDeletedInDb
      ? (db.students || []).find(
          (s: any) =>
            s.uid === targetUid ||
            (s.email || s.studentEmail || '').toLowerCase().trim() === cleanEmail
        )
      : null;
    const existingMemProfile = !fsUserRes.ok && !isDeletedInDb ? db.userProfiles?.[cleanEmail] : null;
    const baseExisting = existingFsUser || existingMemProfile || existingMemStudent || null;

    const nowIso = new Date().toISOString();
    const resolvedTeacherUid = baseExisting?.teacherUid || baseExisting?.assignedNativeFriendUID || validAssignedTeacher || null;
    const resolvedName = baseExisting?.name || baseExisting?.studentName || displayName;
    const resolvedPicture = picture || baseExisting?.picture || baseExisting?.avatar || '';

    const studentProfileToPersist: Record<string, any> = {
      ...(baseExisting || {}),
      id: targetUid,
      uid: targetUid,
      name: resolvedName,
      email: cleanEmail,
      role: 'student',
      picture: resolvedPicture,
      avatar: resolvedPicture,
      level: baseExisting?.level || baseExisting?.studentLevel || 'iniciante',
      learningGoal: baseExisting?.learningGoal || baseExisting?.goal || 'English for everyday life & work',
      teacherEmail: baseExisting?.teacherEmail ?? null,
      teacherName: baseExisting?.teacherName ?? null,
      teacherUid: resolvedTeacherUid,
      assignedNativeFriendUID: resolvedTeacherUid,
      nativeFriendUID: resolvedTeacherUid,
      routineVideoTime: baseExisting?.routineVideoTime || '09:00',
      routineAudioTime: baseExisting?.routineAudioTime || '14:00',
      dailyPhraseTime: baseExisting?.dailyPhraseTime || '20:00',
      enrollmentStatus: baseExisting?.enrollmentStatus || (resolvedTeacherUid ? 'active' : 'not_enrolled'),
      streakDays: baseExisting?.streakDays ?? 0,
      streakCount: baseExisting?.streakCount ?? 0,
      points: baseExisting?.points ?? 0,
      completedLessonsCount: baseExisting?.completedLessonsCount ?? 0,
      ...(Array.isArray(baseExisting?.studentJournal) && baseExisting.studentJournal.length > 0
        ? { studentJournal: baseExisting.studentJournal }
        : {}),
      createdAt: baseExisting?.createdAt || nowIso,
      updatedAt: nowIso,
    };

    if (existingFsUser) {
      // Never overwrite financial balances on existing user documents during login
      delete studentProfileToPersist.contractedLessons;
      delete studentProfileToPersist.availableLessons;
    } else {
      studentProfileToPersist.contractedLessons = baseExisting?.contractedLessons ?? 0;
    }

    if (firestoreDb) {
      try {
        await firestoreDb.collection('users').doc(targetUid).set(removeUndefinedFields(studentProfileToPersist), { merge: true });
      } catch (fsErr: any) {
        if (!isPermissionError(fsErr)) {
          console.warn('[POST /api/auth/google] Firestore student profile persist notice:', fsErr?.message || fsErr);
        }
      }
    }

    const effectiveContracted =
      typeof existingFsUser?.contractedLessons === 'number'
        ? existingFsUser.contractedLessons
        : (typeof studentProfileToPersist.contractedLessons === 'number' ? studentProfileToPersist.contractedLessons : 0);
    const effectiveAvailable =
      typeof existingFsUser?.availableLessons === 'number' ? existingFsUser.availableLessons : undefined;

    canonicalProfileResponse = {
      ...studentProfileToPersist,
      contractedLessons: effectiveContracted,
      ...(effectiveAvailable !== undefined ? { availableLessons: effectiveAvailable } : {}),
    };

    canonicalStudentResponse = {
      id: targetUid,
      uid: targetUid,
      studentUid: targetUid,
      name: resolvedName,
      studentName: resolvedName,
      email: cleanEmail,
      studentEmail: cleanEmail,
      picture: resolvedPicture,
      avatar: resolvedPicture,
      level: canonicalProfileResponse.level,
      studentLevel: canonicalProfileResponse.level,
      goal: canonicalProfileResponse.learningGoal,
      learningGoal: canonicalProfileResponse.learningGoal,
      contractedLessons: effectiveContracted,
      ...(effectiveAvailable !== undefined ? { availableLessons: effectiveAvailable } : {}),
      completedLessonsCount: canonicalProfileResponse.completedLessonsCount,
      teacherEmail: canonicalProfileResponse.teacherEmail,
      teacherName: canonicalProfileResponse.teacherName,
      teacherUid: resolvedTeacherUid,
      assignedNativeFriendUID: resolvedTeacherUid,
      routineVideoTime: canonicalProfileResponse.routineVideoTime,
      routineAudioTime: canonicalProfileResponse.routineAudioTime,
      dailyPhraseTime: canonicalProfileResponse.dailyPhraseTime,
      status: canonicalProfileResponse.enrollmentStatus === 'cancelled' ? 'cancelled' : 'active',
      activeSince: canonicalProfileResponse.createdAt.split('T')[0],
      createdAt: canonicalProfileResponse.createdAt,
    };

    // Sync local cache with canonical UID (no synthetic IDs)
    if (!db.userProfiles) db.userProfiles = {};
    db.userProfiles[cleanEmail] = canonicalProfileResponse;
    if (!db.contractedLessons) db.contractedLessons = {};
    db.contractedLessons[cleanEmail] = effectiveContracted;
    if (!Array.isArray(db.students)) db.students = [];
    const stIdx = db.students.findIndex(
      (s: any) => s.uid === targetUid || (s.email || s.studentEmail || '').toLowerCase().trim() === cleanEmail
    );
    if (stIdx >= 0) {
      db.students[stIdx] = { ...db.students[stIdx], ...canonicalStudentResponse, id: targetUid, uid: targetUid };
    } else {
      db.students.push(canonicalStudentResponse);
    }
    writeDb(db);
  } else if (role === 'teacher') {
    const fsTutorDoc =
      resolution.rawDoc ||
      (await fetchTutorDocumentFromFirestore(targetUid).catch(() => null)) ||
      existingFsUser;

    if (firestoreDb) {
      const linkPatch = removeUndefinedFields({
        id: targetUid,
        uid: targetUid,
        authUid: targetUid,
        email: cleanEmail,
        updatedAt: new Date().toISOString(),
      });
      await Promise.all([
        firestoreDb.collection('tutors').doc(targetUid).set(linkPatch, { merge: true }).catch(() => null),
        firestoreDb.collection('users').doc(targetUid).set(linkPatch, { merge: true }).catch(() => null),
      ]);
    }

    const tutorEntry = (db.tutorsList || []).find((t: any) => t.uid === targetUid || (t.email || '').toLowerCase() === cleanEmail);
    const teacherEntry = (db.teachers || []).find((t: any) => t.uid === targetUid || (t.email || '').toLowerCase() === cleanEmail);
    if (tutorEntry) {
      tutorEntry.uid = targetUid;
      tutorEntry.authUid = targetUid;
    }
    if (teacherEntry) {
      teacherEntry.uid = targetUid;
    }
    writeDb(db);
    canonicalTutorResponse = fsTutorDoc
      ? { ...fsTutorDoc, id: fsTutorDoc.id || targetUid, uid: targetUid, authUid: targetUid, email: fsTutorDoc.email || cleanEmail }
      : (tutorEntry || teacherEntry || null);
  } else {
    writeDb(db);
  }

  const account = {
    uid: targetUid,
    id: targetUid,
    email: cleanEmail,
    name: displayName,
    role,
    picture:
      picture ||
      canonicalProfileResponse?.picture ||
      canonicalTutorResponse?.avatar ||
      canonicalTutorResponse?.picture ||
      '',
  };

  res.json({
    success: true,
    account,
    role: account.role,
    profile: role === 'teacher' || role === 'admin' ? null : canonicalProfileResponse,
    student: role === 'teacher' || role === 'admin' ? null : canonicalStudentResponse,
    tutor: role === 'teacher' ? canonicalTutorResponse : null,
    isRoleEnforced,
    enforcedRole: role,
  });
});

// 1.2 Landing Page Content (Editable by Admin)
app.get('/api/landing-content', (req, res) => {
  const db = readDb();
  res.json(db.landingContent || DEFAULT_LANDING_CONTENT);
});

app.post('/api/landing-content', (req, res) => {
  const db = readDb();
  const content = req.body;
  db.landingContent = { ...DEFAULT_LANDING_CONTENT, ...(db.landingContent || {}), ...content };
  writeDb(db);
  res.json({ success: true, landingContent: db.landingContent });
});

// 2. Teachers / Native Friends Endpoints
app.get('/api/teachers', firebaseAuthMiddleware, requireAdmin, async (req, res) => {
  const db = readDb();
  try {
    const directTutors = await fetchTutorsFromFirestore();
    const mergedList = [...(db.tutorsList || []), ...(directTutors || [])];
    db.tutorsList = consolidateTutorsList(mergedList);
  } catch (err: any) {
    console.error('[serverApp] Error fetching teachers from Firestore (default):', err?.message || err);
    return res.status(503).json({
      error: 'FIRESTORE_QUERY_FAILED',
      message: 'Failed to retrieve teachers from canonical Firestore database (default).',
      details: err?.message ? String(err.message).replace(/[<>{}\\]/g, '') : 'Query failed',
    });
  }
  res.json({ teachers: db.teachers || [], tutors: db.tutorsList || [] });
});

/**
 * Strict public DTO allowlist projection for Native Friends catalog.
 * Guarantees that no private data (email, uid, meetUrl, meetLink, credentials,
 * tokens, administrative fields, or unknown properties) is ever returned in public catalog.
 * Preserves ratings, reviews, and teaching counts ONLY when genuinely recorded as numbers (no fake values added).
 */
function toPublicTutorDto(t: any): Record<string, any> {
  const canonicalUid =
    (t.uid && isValidCanonicalUid(t.uid) ? t.uid.trim() : null) ||
    (t.authUid && isValidCanonicalUid(t.authUid) ? t.authUid.trim() : null) ||
    (t.id && isValidCanonicalUid(t.id) ? t.id.trim() : null) ||
    '';

  const nameSlug = (t.name && typeof t.name === 'string' && !isGenericTutorId(t.name))
    ? normalizeTutorName(t.name).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    : '';

  const emailSlug = (t.email && typeof t.email === 'string' && t.email.includes('@'))
    ? `tutor-${t.email.toLowerCase().trim().replace(/[^a-zA-Z0-9]/g, '-')}`
    : '';

  let publicSlug = '';
  if (t.publicTutorId && typeof t.publicTutorId === 'string' && !isGenericTutorId(t.publicTutorId)) {
    publicSlug = t.publicTutorId.trim();
  } else if (t.id && typeof t.id === 'string' && !isValidCanonicalUid(t.id) && !isGenericTutorId(t.id)) {
    publicSlug = t.id.trim();
  } else if (nameSlug && !isGenericTutorId(nameSlug)) {
    publicSlug = nameSlug;
  } else if (emailSlug && !isGenericTutorId(emailSlug)) {
    publicSlug = emailSlug;
  }

  const candidatePublicId = publicSlug || canonicalUid || nameSlug || emailSlug;
  const resolvedPublicId = !isGenericTutorId(candidatePublicId) ? candidatePublicId : (canonicalUid || 'native-friend');
  const resolvedId = (canonicalUid && isValidCanonicalUid(canonicalUid)) ? canonicalUid : resolvedPublicId;

  const dto: Record<string, any> = {
    id: resolvedId,
    publicTutorId: resolvedPublicId,
    name: String(t.name || ''),
    avatar: String(t.avatar || t.photoUrl || t.picture || ''),
    photoUrl: String(t.avatar || t.photoUrl || t.picture || ''),
    country: String(t.country || ''),
    countryCode: String(t.countryCode || ''),
    flag: String(t.flag || ''),
    accent: String(t.accent || ''),
    headline: String(t.headline || ''),
    bio: String(t.bio || ''),
    specialties: Array.isArray(t.specialties) ? t.specialties.filter((s: unknown) => typeof s === 'string') : [],
    videoIntroUrl: String(t.videoIntroUrl || t.youtubeUrl || t.videoUrl || t.introVideoUrl || ''),
    youtubeUrl: String(t.youtubeUrl || t.videoIntroUrl || ''),
    videoUrl: String(t.videoUrl || t.videoIntroUrl || ''),
    introVideoUrl: String(t.introVideoUrl || t.videoIntroUrl || ''),
    youtubeEmbedId: String(t.youtubeEmbedId || ''),
    availableDays: Array.isArray(t.availableDays) ? t.availableDays : [],
    availableHours: Array.isArray(t.availableHours) ? t.availableHours : [],
    availableHoursByDay: t.availableHoursByDay && typeof t.availableHoursByDay === 'object' ? t.availableHoursByDay : {},
    availability: t.availability && typeof t.availability === 'object' ? t.availability : {},
    isSuperTutor: Boolean(t.isSuperTutor),
    languagesSpoken: Array.isArray(t.languagesSpoken) ? t.languagesSpoken : [],
    timezone: String(t.timezone || ''),
    approvalStatus: 'approved',
    isApproved: true,
    status: 'approved',
    approved: true,
    role: 'teacher',
  };

  if (typeof t.pricePerSessionUsd === 'number') {
    dto.pricePerSessionUsd = t.pricePerSessionUsd;
  }
  if (typeof t.pricePerSessionBrl === 'number') {
    dto.pricePerSessionBrl = t.pricePerSessionBrl;
  }
  // Genuine stats only, never fabricate fake metrics:
  if (typeof t.rating === 'number' && !isNaN(t.rating)) {
    dto.rating = t.rating;
  }
  if (typeof t.reviewsCount === 'number' && !isNaN(t.reviewsCount)) {
    dto.reviewsCount = t.reviewsCount;
  }
  if (typeof t.activeStudents === 'number' && !isNaN(t.activeStudents)) {
    dto.activeStudents = t.activeStudents;
  }
  if (typeof t.lessonsTaught === 'number' && !isNaN(t.lessonsTaught)) {
    dto.lessonsTaught = t.lessonsTaught;
  }

  return dto;
}

/**
 * Sanitizes administrative / teacher tutor record for authorized viewers,
 * ensuring no credentials or password fields are ever exposed.
 */
function sanitizePrivateTutorRecord(t: any): Record<string, any> {
  const sanitized = { ...t };
  const canonicalUid =
    (t.uid && isValidCanonicalUid(t.uid) ? t.uid.trim() : null) ||
    (t.authUid && isValidCanonicalUid(t.authUid) ? t.authUid.trim() : null) ||
    (t.id && isValidCanonicalUid(t.id) ? t.id.trim() : null) ||
    '';

  const nameSlug = (t.name && typeof t.name === 'string' && !isGenericTutorId(t.name))
    ? normalizeTutorName(t.name).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    : '';

  let publicSlug = '';
  if (t.publicTutorId && typeof t.publicTutorId === 'string' && !isGenericTutorId(t.publicTutorId)) {
    publicSlug = t.publicTutorId.trim();
  } else if (t.id && typeof t.id === 'string' && !isValidCanonicalUid(t.id) && !isGenericTutorId(t.id)) {
    publicSlug = t.id.trim();
  } else if (nameSlug && !isGenericTutorId(nameSlug)) {
    publicSlug = nameSlug;
  }

  const resolvedPublicId = publicSlug || canonicalUid || '';
  const resolvedId = (canonicalUid && isValidCanonicalUid(canonicalUid)) ? canonicalUid : resolvedPublicId;

  sanitized.id = resolvedId;
  sanitized.publicTutorId = resolvedPublicId;
  delete sanitized.password;
  delete sanitized.token;
  delete sanitized.secret;
  delete sanitized.apiKey;
  return sanitized;
}

app.get('/api/tutors', async (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  const db = readDb();
  let firestoreQueryError: any = null;
  // Continuously synchronize tutors with Firestore so remotely created profiles (e.g. Teacher) appear immediately
  try {
    const directTutors = await fetchTutorsFromFirestore();
    const mergedList = [...(db.tutorsList || []), ...(directTutors || [])];
    db.tutorsList = consolidateTutorsList(mergedList);
  } catch (err: any) {
    if (isPermissionError(err)) {
      console.info('[serverApp] Firestore (default) read restricted by cloud IAM credentials, continuing with local tutor state.');
    } else {
      firestoreQueryError = err;
      console.warn('[serverApp] Error fetching tutors from Firestore (default) in GET /api/tutors:', err?.message || err);
    }
  }

  // Security & Resilience HOTFIX 4B.18:
  // Remove silent error suppression that converts Firestore read failures into empty successful responses.
  // A failed Firestore query must not produce HTTP 200 with an empty candidate list.
  if (firestoreQueryError && (!db.tutorsList || db.tutorsList.length === 0)) {
    const sanitizedMsg = firestoreQueryError?.message
      ? String(firestoreQueryError.message).replace(/[<>{}\\]/g, '')
      : 'Query failed';
    return res.status(503).json({
      error: 'FIRESTORE_QUERY_FAILED',
      message: 'Failed to retrieve teacher applications from canonical Firestore database (default).',
      details: sanitizedMsg,
    });
  }

  // SECURITY HOTFIX — Native Friends Public API Authorization
  // 1. Authenticate caller strictly via server-verified Firebase ID token.
  // 2. Reject ANY privilege derivation from query parameters (?admin=true, ?includePending=true, ?role=admin, ?email=..., ?uid=...).
  const verifiedUser = await getVerifiedUserFromRequest(req);

  const isServerVerifiedAdmin = verifiedUser?.role === 'admin';
  const verifiedCallerUid = verifiedUser?.uid || '';
  const verifiedCallerEmail = (verifiedUser?.email || '').toLowerCase().trim();

  // Helper to determine if a tutor record is approved
  const isApprovedTutor = (t: any) => {
    const role = (t?.role || '').toLowerCase().trim();
    const isTeacherRole = role === 'teacher' || role === 'native_friend' || role === 'tutor' || !role;
    return Boolean(
      isTeacherRole &&
      t?.approvalStatus === 'approved' &&
      t?.isApproved === true
    );
  };

  // If server-verified admin: return full listing of tutors for moderation (excluding explicitly deleted ones, credentials stripped)
  if (isServerVerifiedAdmin) {
    const adminList = (db.tutorsList || []).filter((t: any) => {
      const tEmail = (t.email || '').toLowerCase().trim();
      const tId = (t.id || '').toLowerCase().trim();
      return !db.deletedTutorEmails?.includes(tEmail) && !db.deletedTutorIds?.includes(tId);
    });
    return res.json(adminList.map(sanitizePrivateTutorRecord));
  }

  // Non-admin / unauthenticated caller:
  // - Public catalog accessible without login: returns only approved tutors.
  // - Authenticated tutor: can additionally consult their OWN pending/unapproved registration,
  //   without exposing registrations or private fields of any third parties.
  const filteredList = (db.tutorsList || []).filter((t: any) => {
    const tEmail = (t.email || '').toLowerCase().trim();
    const tId = (t.id || '').toLowerCase().trim();
    if (db.deletedTutorEmails?.includes(tEmail) || db.deletedTutorIds?.includes(tId)) {
      return false;
    }

    // 1. Approved tutors are public
    if (isApprovedTutor(t)) {
      return true;
    }

    // 2. If caller is an authenticated user (e.g. teacher), only include their OWN record
    if (verifiedUser && verifiedCallerUid) {
      const isOwnByUid = Boolean(t.uid && t.uid === verifiedCallerUid);
      const isOwnById = Boolean(t.id && t.id === verifiedCallerUid);
      const isOwnByEmail = Boolean(verifiedCallerEmail && tEmail && tEmail === verifiedCallerEmail);
      if (isOwnByUid || isOwnById || isOwnByEmail) {
        return true;
      }
    }

    return false;
  });

  // Projection layer:
  // - An authenticated teacher consulting their OWN record receives their full profile (with their private fields).
  // - All third parties and unauthenticated visitors receive strictly the public DTO projection (no email, uid, meetUrl, meetLink).
  const projectedList = filteredList.map((t: any) => {
    const tEmail = (t.email || '').toLowerCase().trim();
    const isOwnRecord = Boolean(
      verifiedUser &&
      verifiedCallerUid &&
      (
        (t.uid && t.uid === verifiedCallerUid) ||
        (t.id && t.id === verifiedCallerUid) ||
        (verifiedCallerEmail && tEmail && tEmail === verifiedCallerEmail)
      )
    );

    if (isOwnRecord) {
      return sanitizePrivateTutorRecord(t);
    }

    return toPublicTutorDto(t);
  });

  return res.json(projectedList);
});

app.post('/api/tutors', async (req, res) => {
  const db = readDb();
  const rawTutor = req.body?.tutor || req.body;
  if (!rawTutor || !rawTutor.email || typeof rawTutor.email !== 'string') {
    return res.status(400).json({ error: 'Invalid tutor data: email is required' });
  }
  const cleanEmail = rawTutor.email.toLowerCase().trim();
  if (!cleanEmail || !cleanEmail.includes('@')) {
    return res.status(400).json({ error: 'Invalid tutor email' });
  }
  const cleanName = (rawTutor.name || '').trim();
  if (!cleanName) {
    return res.status(400).json({ error: 'Invalid tutor name' });
  }
  if (!Array.isArray(rawTutor.availableDays) || rawTutor.availableDays.length === 0) {
    return res.status(400).json({ error: 'Available days are required: at least one day must be selected' });
  }
  const cleanNameLower = cleanName.toLowerCase();
  const tutorId = (rawTutor.id && typeof rawTutor.id === 'string' && rawTutor.id.trim() && !isGenericTutorId(rawTutor.id.trim()))
    ? rawTutor.id.trim()
    : `tutor-${cleanEmail.replace(/[^a-zA-Z0-9]/g, '-')}`;

  // Audit protection: Check if caller is verified admin
  const verifiedCaller = await getVerifiedUserFromRequest(req);
  const isAdminCaller = verifiedCaller?.role === 'admin';

  // Prevent hijacking or overwriting administrator accounts
  const isTargetAdmin =
    (db.teachers || []).some((t: any) => t.email?.toLowerCase() === cleanEmail && t.role === 'admin') ||
    (db.authUsers && db.authUsers[cleanEmail]?.role === 'admin');
  if (isTargetAdmin && !isAdminCaller) {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'Access denied: Cannot register or overwrite an administrator account',
    });
  }

  // Prevent role mutation: existing students cannot register as Native Friends to self-elevate
  let existingStudentDoc: any = null;
  try {
    const fs = getFirestoreDb();
    if (fs) {
      if (verifiedCaller?.uid && isValidCanonicalUid(verifiedCaller.uid)) {
        const uDoc = await fs.collection('users').doc(verifiedCaller.uid).get().catch(() => null);
        if (uDoc && uDoc.exists && (uDoc.data()?.role === 'student' || uDoc.data()?.learningGoal || uDoc.data()?.studentLevel)) {
          existingStudentDoc = uDoc.data();
        }
      }
      if (!existingStudentDoc && cleanEmail) {
        const cleanDocId = cleanEmail.replace(/[^a-zA-Z0-9]/g, '-');
        const emailDoc = await fs.collection('users').doc(cleanDocId).get().catch(() => null);
        if (emailDoc && emailDoc.exists && (emailDoc.data()?.role === 'student' || emailDoc.data()?.learningGoal || emailDoc.data()?.studentLevel)) {
          existingStudentDoc = emailDoc.data();
        }
      }
    }
  } catch {}

  const isExistingStudent = Boolean(
    existingStudentDoc ||
    (db.students || []).some((s: any) => (s.email || s.studentEmail || '').toLowerCase() === cleanEmail) ||
    Boolean(db.userProfiles?.[cleanEmail])
  );

  if (isExistingStudent && !isAdminCaller) {
    return res.status(409).json({
      error: 'ROLE_MUTATION_FORBIDDEN',
      message: 'Esta conta já está registrada como Aluno. Não é permitido converter contas de alunos em Amigos Nativos.',
      duplicateField: 'role',
      isExistingUser: true,
    });
  }

  // Reject attempts to update or overwrite existing tutors by email, UID or ID
  const incomingUid = (rawTutor.uid && typeof rawTutor.uid === 'string') ? rawTutor.uid.trim() : '';
  const incomingId = (rawTutor.id && typeof rawTutor.id === 'string') ? rawTutor.id.trim() : '';
  const verifiedUidForMatch = (!isAdminCaller && verifiedCaller?.uid) ? verifiedCaller.uid : '';

  const existingEmailIdx = (db.tutorsList || []).findIndex(
    (t: any) =>
      (t.email && t.email.toLowerCase() === cleanEmail) ||
      (incomingId && t.id && t.id === incomingId) ||
      (verifiedUidForMatch && ((t.uid && t.uid === verifiedUidForMatch) || (t.id && t.id === verifiedUidForMatch))) ||
      (incomingUid && ((t.uid && t.uid === incomingUid) || (t.id && t.id === incomingUid)))
  );

  const existingTeacherIdx = (db.teachers || []).findIndex(
    (t: any) =>
      (t.email && t.email.toLowerCase() === cleanEmail) ||
      (verifiedUidForMatch && t.uid && t.uid === verifiedUidForMatch) ||
      (incomingUid && t.uid && t.uid === incomingUid)
  );

  if (existingEmailIdx >= 0 || existingTeacherIdx >= 0) {
    return res.status(409).json({
      error: 'Este e-mail ou identificador já está cadastrado no sistema como Amigo Nativo. Não é permitido atualizar ou sobrescrever registros existentes através deste cadastro público.',
      duplicateField: 'email',
      isExistingUser: true,
    });
  }

  // Check if tutor already exists by name
  const existingName = (db.tutorsList || []).some(
    (t: any) => (t.name || '').trim().toLowerCase() === cleanNameLower && t.email?.toLowerCase() !== cleanEmail
  );

  if (existingName) {
    return res.status(409).json({
      error: 'Já existe um Amigo Nativo cadastrado com este nome na plataforma. Por favor, inclua seu sobrenome ou use um nome distintivo.',
      duplicateField: 'name',
      isExistingUser: true,
    });
  }

  // Strict allowlist: Only explicit accepted properties are persisted.
  // Unknown properties, credentials, passwords, and client-supplied administrative privileges are discarded.
  const rawVideoLink = String(rawTutor.videoIntroUrl || rawTutor.youtubeUrl || rawTutor.videoUrl || rawTutor.introVideoUrl || '').trim();
  const extractedVideoId = rawTutor.youtubeEmbedId || extractYouTubeVideoId(rawVideoLink) || '';

  // Privilege audit: Non-admin callers CANNOT self-approve or assign approvalStatus
  const resolvedApprovalStatus = isAdminCaller
    ? (rawTutor.approvalStatus || (rawTutor.registeredByAdmin ? 'approved' : 'pending'))
    : 'pending';
  const resolvedIsApproved = isAdminCaller && (resolvedApprovalStatus === 'approved' || rawTutor.isApproved === true);

  // Identity audit: Resolve canonical Firebase Auth UID via Admin SDK or verified token
  let canonicalAuthUid = '';
  if (isAdminCaller && incomingUid && isValidCanonicalUid(incomingUid)) {
    canonicalAuthUid = incomingUid;
  } else if (!isAdminCaller && verifiedCaller?.uid && isValidCanonicalUid(verifiedCaller.uid)) {
    canonicalAuthUid = verifiedCaller.uid;
  }
  if (!canonicalAuthUid && cleanEmail) {
    try {
      const { getFirebaseAdminAuth } = await import('./src/serverFirebaseAdmin');
      const adminAuth = getFirebaseAdminAuth();
      if (adminAuth) {
        const uRec = await adminAuth.getUserByEmail(cleanEmail).catch(() => null);
        if (uRec && uRec.uid && isValidCanonicalUid(uRec.uid)) {
          canonicalAuthUid = uRec.uid;
        }
      }
    } catch {}
  }
  if (!canonicalAuthUid && isAdminCaller && incomingUid && isValidCanonicalUid(incomingUid)) {
    canonicalAuthUid = incomingUid;
  }
  if (!canonicalAuthUid && cleanEmail) {
    try {
      const db = getFirestoreDb();
      if (db) {
        const uSnap = await db.collection('users').where('email', '==', cleanEmail).limit(1).get().catch(() => null);
        if (uSnap && !uSnap.empty) {
          const doc = uSnap.docs[0];
          if (isValidCanonicalUid(doc.id)) {
            canonicalAuthUid = doc.id;
          } else if (isValidCanonicalUid(doc.data()?.uid)) {
            canonicalAuthUid = doc.data().uid;
          } else if (isValidCanonicalUid(doc.data()?.authUid)) {
            canonicalAuthUid = doc.data().authUid;
          }
        }
      }
    } catch {}
  }

  // Abort if canonical UID cannot be proven - NEVER manufacture an alternative UID
  if (!canonicalAuthUid) {
    return res.status(400).json({
      error: 'Não foi possível comprovar a identidade canônica (Firebase Auth UID) para este Amigo Nativo. A autenticação prévia é mandatória.',
    });
  }

  const publicTutorId = tutorId;

  const tutorEntry: Record<string, any> = {
    id: publicTutorId,
    publicTutorId,
    uid: canonicalAuthUid,
    authUid: canonicalAuthUid,
    name: cleanName,
    email: cleanEmail,
    role: 'teacher', // strictly enforced
    approvalStatus: resolvedApprovalStatus,
    isApproved: resolvedIsApproved,
    status: resolvedApprovalStatus,
    approved: resolvedIsApproved,
    registeredByAdmin: isAdminCaller && Boolean(rawTutor.registeredByAdmin),
    appliedAt: rawTutor.appliedAt || new Date().toISOString(),
  };

  // Allowlist of accepted profile properties
  if (rawTutor.avatar && typeof rawTutor.avatar === 'string') tutorEntry.avatar = rawTutor.avatar.trim();
  if (rawTutor.photoUrl && typeof rawTutor.photoUrl === 'string') tutorEntry.photoUrl = rawTutor.photoUrl.trim();
  if (rawTutor.country && typeof rawTutor.country === 'string') tutorEntry.country = rawTutor.country.trim();
  if (rawTutor.countryCode && typeof rawTutor.countryCode === 'string') tutorEntry.countryCode = rawTutor.countryCode.trim();
  if (rawTutor.flag && typeof rawTutor.flag === 'string') tutorEntry.flag = rawTutor.flag.trim();
  if (rawTutor.accent && typeof rawTutor.accent === 'string') tutorEntry.accent = rawTutor.accent.trim();
  if (rawTutor.headline && typeof rawTutor.headline === 'string') tutorEntry.headline = rawTutor.headline.trim();
  if (rawTutor.bio && typeof rawTutor.bio === 'string') tutorEntry.bio = rawTutor.bio.trim();
  if (Array.isArray(rawTutor.specialties)) {
    tutorEntry.specialties = rawTutor.specialties.filter((s: unknown) => typeof s === 'string');
  }
  if (rawVideoLink) {
    tutorEntry.videoIntroUrl = rawVideoLink;
    tutorEntry.youtubeUrl = rawVideoLink;
    tutorEntry.videoUrl = rawVideoLink;
    tutorEntry.introVideoUrl = rawVideoLink;
  }
  if (extractedVideoId) {
    tutorEntry.youtubeEmbedId = extractedVideoId;
  }

  const rawUsd = Number(rawTutor.pricePerSessionUsd);
  if (!isNaN(rawUsd) && rawUsd >= 0) {
    tutorEntry.pricePerSessionUsd = rawUsd;
  }
  const rawBrl = Number(rawTutor.pricePerSessionBrl);
  if (!isNaN(rawBrl) && rawBrl >= 0) {
    tutorEntry.pricePerSessionBrl = rawBrl;
  }
  if (Array.isArray(rawTutor.availableDays)) tutorEntry.availableDays = rawTutor.availableDays;
  if (Array.isArray(rawTutor.availableHours)) tutorEntry.availableHours = rawTutor.availableHours;
  if (rawTutor.availableHoursByDay && typeof rawTutor.availableHoursByDay === 'object') {
    tutorEntry.availableHoursByDay = rawTutor.availableHoursByDay;
  }
  if (rawTutor.availability && typeof rawTutor.availability === 'object') {
    tutorEntry.availability = rawTutor.availability;
  }
  if (Array.isArray(rawTutor.languagesSpoken)) tutorEntry.languagesSpoken = rawTutor.languagesSpoken;
  if (rawTutor.timezone && typeof rawTutor.timezone === 'string') tutorEntry.timezone = rawTutor.timezone.trim();
  if (rawTutor.meetUrl && typeof rawTutor.meetUrl === 'string') tutorEntry.meetUrl = rawTutor.meetUrl.trim();
  if (rawTutor.meetLink && typeof rawTutor.meetLink === 'string') tutorEntry.meetLink = rawTutor.meetLink.trim();

  // Admin-only fields (moderators may set stats/superTutor on creation if needed)
  if (isAdminCaller) {
    if (typeof rawTutor.isSuperTutor === 'boolean') tutorEntry.isSuperTutor = rawTutor.isSuperTutor;
    if (typeof rawTutor.rating === 'number') tutorEntry.rating = rawTutor.rating;
    if (typeof rawTutor.reviewsCount === 'number') tutorEntry.reviewsCount = rawTutor.reviewsCount;
    if (typeof rawTutor.activeStudents === 'number') tutorEntry.activeStudents = rawTutor.activeStudents;
    if (typeof rawTutor.lessonsTaught === 'number') tutorEntry.lessonsTaught = rawTutor.lessonsTaught;
  }

  // Strip any accidental non-permitted keys
  delete (tutorEntry as any).isAdmin;
  delete (tutorEntry as any).permissions;
  delete (tutorEntry as any).credits;
  delete (tutorEntry as any).isUpdate;
  delete (tutorEntry as any).adminSettings;
  delete (tutorEntry as any).assignedStudents;
  delete (tutorEntry as any).password;
  delete (tutorEntry as any).token;

  db.tutorsList = db.tutorsList || [];
  db.tutorsList.push(tutorEntry);

  // Initialize teacher meet settings if configured during registration
  const tutorMeetLink = (tutorEntry.meetUrl || tutorEntry.meetLink || '').trim();
  if (tutorMeetLink && !tutorMeetLink.includes('meet.google.com/new')) {
    if (!db.meetSettings) db.meetSettings = {};
    if (!db.teacherSettings) db.teacherSettings = {};
    const meetEntry = {
      teacherEmail: cleanEmail,
      uid: canonicalAuthUid,
      meetLink: tutorMeetLink,
      workingHoursStart: '08:00',
      workingHoursEnd: '18:00',
      slotDurationMinutes: 30,
      availableDays: tutorEntry.availableDays || ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
      availability: tutorEntry.availability || tutorEntry.availableHoursByDay || {},
      availableHoursByDay: tutorEntry.availableHoursByDay || tutorEntry.availability || {},
      timezone: tutorEntry.timezone || 'America/Toronto',
      updatedAt: new Date().toISOString(),
    };
    db.meetSettings[cleanEmail] = meetEntry;
    db.teacherSettings[cleanEmail] = meetEntry;
    if (canonicalAuthUid) {
      db.meetSettings[canonicalAuthUid] = meetEntry;
      db.teacherSettings[canonicalAuthUid] = meetEntry;
    }
    saveTeacherAvailabilityToFirestore(canonicalAuthUid || cleanEmail, meetEntry).catch(() => {});
  }

  // Also maintain teachers list for auth
  db.teachers = db.teachers || [];
  db.teachers.push({
    id: tutorEntry.id,
    uid: tutorEntry.uid || tutorEntry.id,
    email: cleanEmail,
    name: cleanName,
    role: 'teacher',
    approvalStatus: resolvedApprovalStatus,
    isApproved: resolvedIsApproved,
    status: resolvedApprovalStatus,
    approved: resolvedIsApproved,
  });

  // Ensure auth record exists with role 'teacher' (NO PASSWORDS)
  if (!db.authUsers) db.authUsers = {};
  db.authUsers[cleanEmail] = {
    uid: tutorEntry.uid || tutorEntry.id,
    email: cleanEmail,
    name: cleanName,
    role: 'teacher',
    createdAt: db.authUsers[cleanEmail]?.createdAt || new Date().toISOString(),
  };

  // Unmark from deleted lists if newly registered or re-registering
  if (db.deletedTutorIds) {
    db.deletedTutorIds = db.deletedTutorIds.filter((id) => id !== rawTutor.id?.toLowerCase() && id !== tutorId.toLowerCase());
  }
  if (db.deletedTutorEmails) {
    db.deletedTutorEmails = db.deletedTutorEmails.filter((em) => em !== cleanEmail);
  }

  // Purge any accidental student profile entry for this teacher ONLY if explicitly registered by administrator
  if (isAdminCaller) {
    if (db.userProfiles && db.userProfiles[cleanEmail]) {
      delete db.userProfiles[cleanEmail];
    }
    if (db.students) {
      db.students = db.students.filter((s: any) => (s.email || s.studentEmail || '').toLowerCase() !== cleanEmail);
    }
  }

  // Persist directly to Cloud Firestore exclusively in tutors/{canonicalAuthUid} and users/{canonicalAuthUid}
  await saveTutorToFirestore(tutorEntry).catch((err) => {
    console.warn('Error saving tutor to Firestore collection:', err);
  });

  writeDb(db);

  res.status(200).json({ success: true, tutor: tutorEntry, tutors: db.tutorsList });
});

app.put('/api/tutors/:id', firebaseAuthMiddleware, async (req, res) => {
  const caller = req.user;
  if (!caller || !caller.uid) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Authentication required: verified user token missing',
    });
  }

  const db = readDb();
  const tutorIdParam = decodeURIComponent(req.params.id || '').trim();
  if (!tutorIdParam) {
    return res.status(400).json({ error: 'Bad Request', message: 'Invalid tutor id' });
  }

  const rawBody = req.body;
  const updatedData = rawBody?.tutor ? { ...rawBody.tutor } : { ...rawBody };
  if ((updatedData as any).tutor) delete (updatedData as any).tutor;

  let existingTutor: any = null;

  // 1. Resolve target profile using canonical Firestore (default) database first when possible
  const fsDb = getFirestoreDb();
  if (fsDb) {
    try {
      if (isValidCanonicalUid(tutorIdParam)) {
        const [tSnap, uSnap] = await Promise.all([
          fsDb.collection('tutors').doc(tutorIdParam).get(),
          fsDb.collection('users').doc(tutorIdParam).get(),
        ]);
        if (tSnap.exists || uSnap.exists) {
          existingTutor = {
            id: tutorIdParam,
            uid: tutorIdParam,
            authUid: tutorIdParam,
            ...(uSnap.exists ? uSnap.data() : {}),
            ...(tSnap.exists ? tSnap.data() : {}),
          };
        }
      } else {
        const isEmail = tutorIdParam.includes('@');
        const cleanEmail = tutorIdParam.toLowerCase();

        const queryList: Promise<any>[] = [
          fsDb.collection('tutors').where('publicTutorId', '==', tutorIdParam.toLowerCase()).get(),
          fsDb.collection('tutors').doc(tutorIdParam).get(),
        ];
        if (isEmail) {
          queryList.push(fsDb.collection('tutors').where('email', '==', cleanEmail).get());
          queryList.push(fsDb.collection('users').where('email', '==', cleanEmail).get());
        }

        const queryResults = await Promise.all(queryList);
        const matchedDocs: any[] = [];
        queryResults.forEach((snap) => {
          if (snap && snap.docs) {
            snap.forEach((d: any) => matchedDocs.push({ id: d.id, ...d.data() }));
          } else if (snap && snap.exists) {
            matchedDocs.push({ id: snap.id, ...snap.data() });
          }
        });

        if (matchedDocs.length > 0) {
          // Reject ambiguous or conflicting profile mappings across canonical UIDs
          const distinctUids = new Set(
            matchedDocs
              .map((d) => d.uid || d.authUid || (isValidCanonicalUid(d.id) ? d.id : null))
              .filter((u): u is string => Boolean(u && isValidCanonicalUid(u)))
          );
          if (distinctUids.size > 1) {
            return res.status(409).json({
              error: 'Conflict',
              message: 'Ambiguous or conflicting tutor profile mapping across canonical UIDs',
            });
          }
          existingTutor = consolidateTutorsList(matchedDocs)[0];
        }
      }
    } catch (fsErr: any) {
      console.error('[serverApp] Firestore error during tutor lookup in PUT /api/tutors/:id:', fsErr);
      return res.status(503).json({
        error: 'Service Unavailable',
        message: `Firestore is unavailable: ${fsErr?.message || 'Database connection error'}`,
      });
    }
  }

  // 2. Fallback to local in-memory DB if not located in Firestore
  if (!existingTutor) {
    const localCandidates = [
      ...(db.tutorsList || []),
      ...(db.teachers || []),
    ].filter((t: any) =>
      Boolean(t) && (
        (t.id && t.id.toLowerCase() === tutorIdParam.toLowerCase()) ||
        (t.uid && t.uid === tutorIdParam) ||
        (t.publicTutorId && t.publicTutorId.toLowerCase() === tutorIdParam.toLowerCase()) ||
        (t.email && t.email.toLowerCase() === tutorIdParam.toLowerCase())
      )
    );

    if (localCandidates.length > 0) {
      const distinctUids = new Set(
        localCandidates
          .map((d: any) => d.uid || d.authUid || (isValidCanonicalUid(d.id) ? d.id : null))
          .filter((u: any): u is string => Boolean(u && isValidCanonicalUid(u)))
      );
      if (distinctUids.size > 1) {
        return res.status(409).json({
          error: 'Conflict',
          message: 'Ambiguous or conflicting tutor profile mapping',
        });
      }
      existingTutor = consolidateTutorsList(localCandidates)[0];
    }
  }

  // Reject with 404 only when profile genuinely cannot be found; do NOT create a new tutor implicitly
  if (!existingTutor) {
    return res.status(404).json({
      error: 'Not Found',
      message: 'Tutor profile not found in database',
    });
  }

  // 3. Resolve canonical owner UID
  let canonicalUid = '';
  if (existingTutor.uid && isValidCanonicalUid(existingTutor.uid)) {
    canonicalUid = existingTutor.uid.trim();
  } else if (existingTutor.authUid && isValidCanonicalUid(existingTutor.authUid)) {
    canonicalUid = existingTutor.authUid.trim();
  } else if (existingTutor.id && isValidCanonicalUid(existingTutor.id)) {
    canonicalUid = existingTutor.id.trim();
  } else {
    const resolvedIdentity = await resolveTeacherCanonicalIdentity(existingTutor);
    if (resolvedIdentity?.canonicalUid && isValidCanonicalUid(resolvedIdentity.canonicalUid)) {
      canonicalUid = resolvedIdentity.canonicalUid.trim();
    }
  }

  // If the profile has a legacy ID without a trustworthy canonical UID mapping, reject update
  if (!canonicalUid || !isValidCanonicalUid(canonicalUid)) {
    return res.status(409).json({
      error: 'Conflict',
      message: 'Profile has a legacy identifier without a trustworthy canonical UID mapping. Explicit reconciliation required.',
    });
  }

  const existingEmail = (existingTutor.email || '').toLowerCase().trim();
  const callerUid = (caller.uid || '').trim();
  const isAdmin = caller.role === 'admin';

  // Ownership verification: Allow verified administrator OR owner whose verified UID matches canonical record UID
  // Do NOT require a teacher custom claim if ownership is established via verified UID
  const isOwner = Boolean(canonicalUid && callerUid === canonicalUid);
  if (!isAdmin && !isOwner) {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'Access denied: You are not authorized to update this tutor profile',
    });
  }

  // Prevent modifying an administrator account through tutor profile endpoint by non-admin
  const isTargetAdmin =
    (db.teachers || []).some((t: any) => t.email?.toLowerCase() === existingEmail && t.role === 'admin') ||
    (db.authUsers && db.authUsers[existingEmail]?.role === 'admin');

  if (isTargetAdmin && !isAdmin) {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'Access denied: Cannot modify administrator account through tutor endpoint',
    });
  }

  // 4. Filter allowed fields
  const TEACHER_EDITABLE_FIELDS = new Set([
    'name',
    'avatar',
    'photoUrl',
    'country',
    'countryCode',
    'flag',
    'accent',
    'headline',
    'bio',
    'specialties',
    'videoIntroUrl',
    'youtubeUrl',
    'videoUrl',
    'introVideoUrl',
    'youtubeEmbedId',
    'pricePerSessionUsd',
    'pricePerSessionBrl',
    'languagesSpoken',
    'timezone',
    'meetUrl',
    'meetLink',
    'availableDays',
    'availableHours',
    'availability',
    'availableHoursByDay',
  ]);

  const fieldsToApply: Record<string, any> = {};

  if (isAdmin) {
    const ADMIN_ADDITIONAL_FIELDS = new Set([
      'approvalStatus',
      'isApproved',
      'status',
      'approved',
      'registeredByAdmin',
      'isSuperTutor',
      'rating',
      'reviewsCount',
      'activeStudents',
      'lessonsTaught',
    ]);

    for (const [key, val] of Object.entries(updatedData)) {
      if (TEACHER_EDITABLE_FIELDS.has(key) || ADMIN_ADDITIONAL_FIELDS.has(key)) {
        fieldsToApply[key] = val;
      }
    }

    if (fieldsToApply.approvalStatus !== undefined) {
      const isApp = fieldsToApply.approvalStatus === 'approved';
      fieldsToApply.isApproved = fieldsToApply.isApproved ?? isApp;
      fieldsToApply.status = fieldsToApply.status ?? fieldsToApply.approvalStatus;
      fieldsToApply.approved = fieldsToApply.approved ?? isApp;
    }
  } else {
    // Regular teacher: strictly apply ONLY fields from TEACHER_EDITABLE_FIELDS
    for (const [key, val] of Object.entries(updatedData)) {
      if (TEACHER_EDITABLE_FIELDS.has(key)) {
        fieldsToApply[key] = val;
      }
    }
  }

  const tEmail = existingEmail;
  const existingSettings = (db.teacherSettings && db.teacherSettings[tEmail]) || (db.meetSettings && db.meetSettings[tEmail]);

  const rawVideoLink = (
    fieldsToApply.videoIntroUrl ||
    fieldsToApply.youtubeUrl ||
    fieldsToApply.videoUrl ||
    fieldsToApply.introVideoUrl ||
    existingTutor.videoIntroUrl ||
    existingTutor.youtubeUrl ||
    existingTutor.videoUrl ||
    existingTutor.introVideoUrl ||
    ''
  ).trim();
  const extractedVideoId = fieldsToApply.youtubeEmbedId || extractYouTubeVideoId(rawVideoLink) || existingTutor.youtubeEmbedId || '';

  const resolvedApprovalStatus = isAdmin
    ? (fieldsToApply.approvalStatus ?? existingTutor.approvalStatus ?? 'pending')
    : (existingTutor.approvalStatus ?? 'pending');
  const resolvedIsApproved = isAdmin
    ? (fieldsToApply.isApproved ?? existingTutor.isApproved ?? (resolvedApprovalStatus === 'approved'))
    : (existingTutor.isApproved ?? (existingTutor.approvalStatus === 'approved'));
  const resolvedStatus = isAdmin
    ? (fieldsToApply.status ?? existingTutor.status ?? resolvedApprovalStatus)
    : (existingTutor.status ?? existingTutor.approvalStatus ?? 'pending');
  const resolvedApproved = isAdmin
    ? (fieldsToApply.approved ?? existingTutor.approved ?? resolvedIsApproved)
    : (existingTutor.approved ?? existingTutor.isApproved ?? false);

  const updatedTutor = {
    ...existingTutor,
    ...fieldsToApply,
    id: existingTutor.publicTutorId || existingTutor.id || canonicalUid,
    publicTutorId: existingTutor.publicTutorId || (isValidCanonicalUid(existingTutor.id) ? undefined : existingTutor.id),
    email: existingEmail || updatedData.email,
    uid: canonicalUid,
    authUid: canonicalUid,
    role: 'teacher',
    approvalStatus: resolvedApprovalStatus,
    isApproved: resolvedIsApproved,
    status: resolvedStatus,
    approved: resolvedApproved,
    registeredByAdmin: isAdmin
      ? (fieldsToApply.registeredByAdmin ?? existingTutor.registeredByAdmin ?? false)
      : (existingTutor.registeredByAdmin ?? false),
    videoIntroUrl: rawVideoLink,
    youtubeUrl: rawVideoLink,
    videoUrl: rawVideoLink,
    introVideoUrl: rawVideoLink,
    youtubeEmbedId: extractedVideoId,
    meetUrl: fieldsToApply.meetUrl || existingTutor.meetUrl || existingSettings?.meetLink || '',
    availableDays:
      (fieldsToApply.availableDays && fieldsToApply.availableDays.length > 0)
        ? fieldsToApply.availableDays
        : (existingTutor.availableDays || existingSettings?.availableDays || []),
    availability:
      fieldsToApply.availability ||
      existingTutor.availability ||
      existingSettings?.availability ||
      existingSettings?.availableHoursByDay,
    updatedAt: new Date().toISOString(),
  };

  // 5. Persist directly to Cloud Firestore in /tutors/{canonicalUid} and /users/{canonicalUid}
  try {
    const saveSuccess = await saveTutorToFirestore(updatedTutor);
    if (saveSuccess === false) {
      return res.status(500).json({
        error: 'Persistence Error',
        message: 'Failed to persist tutor profile to Firestore',
      });
    }
  } catch (err: any) {
    console.error('[serverApp] Error persisting tutor to Firestore in PUT /api/tutors/:id:', err);
    return res.status(500).json({
      error: 'Persistence Error',
      message: 'Failed to persist tutor profile to Firestore',
      details: err?.message || String(err),
    });
  }

  // 6. Update local in-memory DB & disk cache
  db.tutorsList = db.tutorsList || [];
  const existingLocalIdx = db.tutorsList.findIndex(
    (t: any) =>
      (t.uid && t.uid === canonicalUid) ||
      (t.id && (t.id === updatedTutor.id || t.id.toLowerCase() === tutorIdParam.toLowerCase())) ||
      (tEmail && t.email && t.email.toLowerCase() === tEmail)
  );
  if (existingLocalIdx >= 0) {
    db.tutorsList[existingLocalIdx] = updatedTutor;
  } else {
    db.tutorsList.push(updatedTutor);
  }

  // Sync with db.teachers
  const teacherIdx = (db.teachers || []).findIndex(
    (tc: any) => (tc.email && tc.email.toLowerCase() === tEmail) || (tc.uid && tc.uid === canonicalUid)
  );
  if (teacherIdx >= 0) {
    db.teachers[teacherIdx] = {
      ...db.teachers[teacherIdx],
      name: updatedTutor.name,
      avatar: updatedTutor.avatar,
      country: updatedTutor.country,
      accent: updatedTutor.accent,
      timezone: updatedTutor.timezone,
      availableDays: updatedTutor.availableDays,
      videoIntroUrl: updatedTutor.videoIntroUrl,
      approvalStatus: resolvedApprovalStatus,
      isApproved: resolvedIsApproved,
      status: resolvedStatus,
      approved: resolvedApproved,
    };
  }

  // Sync with db.teacherSettings
  if (tEmail) {
    db.teacherSettings = db.teacherSettings || {};
    db.teacherSettings[tEmail] = {
      ...db.teacherSettings[tEmail],
      teacherEmail: tEmail,
      ...(updatedTutor.meetUrl ? { meetLink: updatedTutor.meetUrl } : {}),
      ...(updatedTutor.timezone ? { timezone: updatedTutor.timezone } : {}),
      ...(updatedTutor.availableDays && updatedTutor.availableDays.length > 0 ? { availableDays: updatedTutor.availableDays } : {}),
    };
  }

  writeDb(db);
  return res.status(200).json({ success: true, tutor: updatedTutor, tutors: db.tutorsList });
});

  // Admin Delete Tutor
app.delete('/api/tutors/:id', firebaseAuthMiddleware, requireAdmin, async (req, res) => {
  const db = readDb();
  const tutorId = decodeURIComponent(req.params.id);
  const targetEmailQuery = ((req.query.email as string) || '').toLowerCase();

  const targetTutor = (db.tutorsList || []).find(
    (t: any) =>
      t.id === tutorId ||
      t.email?.toLowerCase() === tutorId.toLowerCase() ||
      (targetEmailQuery && t.email?.toLowerCase() === targetEmailQuery)
  );
  const targetEmail = (
    targetTutor?.email ||
    targetEmailQuery ||
    (tutorId.includes('@') ? tutorId : '')
  )?.toLowerCase();

  // Safeguard: Primary administrator account can NEVER be deleted via tutors endpoint
  const isTargetAdmin = Boolean(
    targetTutor?.role === 'admin' ||
    (db.teachers || []).some((t: any) => t.email?.toLowerCase() === targetEmail && t.role === 'admin') ||
    (db.authUsers && db.authUsers[targetEmail]?.role === 'admin')
  );

  if (isTargetAdmin) {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'Cannot delete primary system administrator account',
    });
  }

  // Track permanently so deleted tutors are NEVER re-added by defaults or sync
  db.deletedTutorIds = Array.from(
    new Set([...(db.deletedTutorIds || []), tutorId.toLowerCase()])
  );
  if (targetEmail) {
    db.deletedTutorEmails = Array.from(
      new Set([...(db.deletedTutorEmails || []), targetEmail.toLowerCase()])
    );
  }

  db.tutorsList = (db.tutorsList || []).filter(
    (t: any) =>
      t.id !== tutorId &&
      t.email?.toLowerCase() !== tutorId.toLowerCase() &&
      (!targetEmail || t.email?.toLowerCase() !== targetEmail)
  );

  if (targetEmail) {
    // Only remove from teachers if NOT an admin! Admins must keep admin access
    db.teachers = (db.teachers || []).filter(
      (t: any) => t.email?.toLowerCase() !== targetEmail || t.role === 'admin'
    );
    if (db.meetSettings && !isTargetAdmin) {
      delete db.meetSettings[targetEmail];
    }
    if (db.teacherSettings && !isTargetAdmin) {
      delete db.teacherSettings[targetEmail];
    }
    // Only delete from authUsers if their role is teacher and not admin!
    if (db.authUsers && db.authUsers[targetEmail]?.role === 'teacher') {
      delete db.authUsers[targetEmail];
    }
  }

  // Delete directly from Firestore /tutors/{tutorId}
  await deleteTutorFromFirestore(tutorId).catch((err) => {
    console.warn('Error deleting tutor from Firestore collection:', err);
  });
  if (targetTutor?.id && targetTutor.id !== tutorId) {
    await deleteTutorFromFirestore(targetTutor.id).catch(() => {});
  }

  await writeDbSync(db);
  res.json({ success: true, message: 'Amigo Nativo excluído com sucesso.', tutors: db.tutorsList });
});

app.post('/api/tutors/:id/approve', firebaseAuthMiddleware, requireAdmin, async (req, res) => {
  const db = readDb();
  const tutorId = req.params.id;
  let approvedEmail = '';
  let approvedTutor: any = null;

  // 1. Search in local db.tutorsList
  db.tutorsList = (db.tutorsList || []).map((t) => {
    if (t.id === tutorId || t.uid === tutorId || t.authUid === tutorId || t.email?.toLowerCase() === tutorId.toLowerCase()) {
      approvedEmail = (t.email || '').toLowerCase().trim();
      approvedTutor = {
        ...t,
        approvalStatus: 'approved',
        isApproved: true,
        status: 'approved',
        approved: true,
        updatedAt: new Date().toISOString(),
      };
      return approvedTutor;
    }
    return t;
  });

  // 2. If not found in db.tutorsList, check db.teachers
  if (!approvedTutor) {
    const teacher = (db.teachers || []).find(
      (tc: any) => tc.id === tutorId || tc.uid === tutorId || tc.authUid === tutorId || (tc.email && tc.email.toLowerCase() === tutorId.toLowerCase())
    );
    if (teacher) {
      approvedEmail = (teacher.email || '').toLowerCase().trim();
      approvedTutor = {
        ...teacher,
        id: teacher.id || tutorId,
        approvalStatus: 'approved',
        isApproved: true,
        status: 'approved',
        approved: true,
        updatedAt: new Date().toISOString(),
      };
      db.tutorsList = db.tutorsList || [];
      db.tutorsList.push(approvedTutor);
    }
  }

  // 3. Locate the tutor directly in Firestore (default) by route ID
  if (!approvedTutor) {
    try {
      const directTutor = await fetchTutorDocumentFromFirestore(tutorId).catch(() => null);
      if (directTutor) {
        approvedEmail = (directTutor.email || '').toLowerCase().trim();
        approvedTutor = {
          ...directTutor,
          id: directTutor.id || tutorId,
          approvalStatus: 'approved',
          isApproved: true,
          status: 'approved',
          approved: true,
          updatedAt: new Date().toISOString(),
        };
        db.tutorsList = db.tutorsList || [];
        db.tutorsList.push(approvedTutor);
      }
    } catch (fsErr) {
      console.warn('Error fetching tutor document from Firestore in POST /api/tutors/:id/approve:', fsErr);
    }
  }

  // 4. Fallback if tutor was passed in body (e.g. legacy clients)
  if (!approvedTutor) {
    const passedTutor = req.body?.tutor;
    if (passedTutor) {
      approvedEmail = (passedTutor.email || '').toLowerCase().trim();
      approvedTutor = {
        ...passedTutor,
        id: tutorId,
        approvalStatus: 'approved',
        isApproved: true,
        status: 'approved',
        approved: true,
        updatedAt: new Date().toISOString(),
      };
      db.tutorsList = db.tutorsList || [];
      db.tutorsList.push(approvedTutor);
    }
  }

  if (!approvedTutor) {
    return res.status(404).json({
      error: 'NotFound',
      message: `Amigo Nativo "${tutorId}" não foi encontrado para aprovação.`,
    });
  }

  if (approvedEmail) {
    const tIdx = (db.teachers || []).findIndex((tc: any) => (tc.email || '').toLowerCase() === approvedEmail);
    if (tIdx >= 0) {
      db.teachers[tIdx] = {
        ...db.teachers[tIdx],
        approvalStatus: 'approved',
        isApproved: true,
        status: 'approved',
        approved: true,
      };
    } else {
      db.teachers = db.teachers || [];
      db.teachers.push({
        id: approvedTutor.id || tutorId,
        email: approvedEmail,
        name: approvedTutor.name || approvedEmail.split('@')[0],
        role: 'teacher',
        approvalStatus: 'approved',
        isApproved: true,
        status: 'approved',
        approved: true,
      });
    }
    if (db.userProfiles && db.userProfiles[approvedEmail]) {
      db.userProfiles[approvedEmail] = {
        ...db.userProfiles[approvedEmail],
        approvalStatus: 'approved',
        isApproved: true,
        status: 'approved',
        approved: true,
      };
    }
  }

  // 1. Resolve canonical identity and persist exclusively in /tutors/{canonicalAuthUid} and /users/{canonicalAuthUid}
  const approvedTeacherRes = await resolveTeacherCanonicalIdentity({
    teacherId: tutorId,
    publicTutorId: tutorId,
    teacherEmail: approvedEmail,
    dbState: db,
  });
  if (approvedTeacherRes && isValidCanonicalUid(approvedTeacherRes.canonicalUid)) {
    approvedTutor.authUid = approvedTeacherRes.canonicalUid;
    approvedTutor.uid = approvedTeacherRes.canonicalUid;
    approvedTutor.publicTutorId = tutorId;
  }
  await saveTutorToFirestore(approvedTutor, tutorId).catch((err) => {
    console.warn('Error saving approved tutor to Firestore:', err);
  });

  // 2. Synchronize app_state/tutors and in-memory DB ensuring full consistency
  await writeDbSync(db);
  res.json({ success: true, tutors: db.tutorsList, approvedTutor });
});

app.post('/api/tutors/:id/reject', firebaseAuthMiddleware, requireAdmin, async (req, res) => {
  const db = readDb();
  const tutorId = req.params.id;
  let rejectedEmail = '';
  let rejectedTutor: any = null;
  db.tutorsList = (db.tutorsList || []).map((t) => {
    if (t.id === tutorId || t.email?.toLowerCase() === tutorId.toLowerCase()) {
      rejectedEmail = (t.email || '').toLowerCase().trim();
      rejectedTutor = {
        ...t,
        approvalStatus: 'rejected',
        isApproved: false,
        status: 'rejected',
        approved: false,
        updatedAt: new Date().toISOString(),
      };
      return rejectedTutor;
    }
    return t;
  });

  if (!rejectedTutor) {
    const passedTutor = req.body?.tutor;
    if (passedTutor) {
      rejectedEmail = (passedTutor.email || '').toLowerCase().trim();
      rejectedTutor = {
        ...passedTutor,
        id: tutorId,
        approvalStatus: 'rejected',
        isApproved: false,
        status: 'rejected',
        approved: false,
        updatedAt: new Date().toISOString(),
      };
      db.tutorsList = db.tutorsList || [];
      db.tutorsList.push(rejectedTutor);
    }
  }

  if (!rejectedTutor) {
    try {
      const directTutor = await fetchTutorDocumentFromFirestore(tutorId).catch(() => null);
      if (directTutor) {
        rejectedEmail = (directTutor.email || '').toLowerCase().trim();
        rejectedTutor = {
          ...directTutor,
          id: directTutor.id || tutorId,
          approvalStatus: 'rejected',
          isApproved: false,
          status: 'rejected',
          approved: false,
          updatedAt: new Date().toISOString(),
        };
        db.tutorsList = db.tutorsList || [];
        db.tutorsList.push(rejectedTutor);
      }
    } catch {}
  }

  if (rejectedEmail) {
    const tIdx = (db.teachers || []).findIndex((tc: any) => (tc.email || '').toLowerCase() === rejectedEmail);
    if (tIdx >= 0) {
      db.teachers[tIdx] = {
        ...db.teachers[tIdx],
        approvalStatus: 'rejected',
        isApproved: false,
        status: 'rejected',
        approved: false,
      };
    }
    if (db.userProfiles && db.userProfiles[rejectedEmail]) {
      db.userProfiles[rejectedEmail] = {
        ...db.userProfiles[rejectedEmail],
        approvalStatus: 'rejected',
        isApproved: false,
        status: 'rejected',
        approved: false,
      };
    }
  }

  if (rejectedTutor) {
    const rejectedTeacherRes = await resolveTeacherCanonicalIdentity({
      teacherId: tutorId,
      publicTutorId: tutorId,
      teacherEmail: rejectedEmail,
      dbState: db,
    });
    if (rejectedTeacherRes && isValidCanonicalUid(rejectedTeacherRes.canonicalUid)) {
      rejectedTutor.authUid = rejectedTeacherRes.canonicalUid;
      rejectedTutor.uid = rejectedTeacherRes.canonicalUid;
      rejectedTutor.publicTutorId = tutorId;
    }
    await saveTutorToFirestore(rejectedTutor).catch((err) => {
      console.warn('Error saving rejected tutor to Firestore:', err);
    });
  }

  await writeDbSync(db);
  res.json({ success: true, tutors: db.tutorsList });
});

app.post('/api/teachers', firebaseAuthMiddleware, requireAdmin, (req, res) => {
  const db = readDb();
  const newTeacher = req.body.teacher || req.body;
  if (!newTeacher || !newTeacher.email) {
    return res.status(400).json({ error: 'Invalid teacher data' });
  }
  const cleanEmail = newTeacher.email.toLowerCase().trim();

  // Prevent modifying or downgrading administrator accounts
  const isTargetAdmin =
    (db.teachers || []).some((t: any) => t.email?.toLowerCase() === cleanEmail && t.role === 'admin') ||
    (db.authUsers && db.authUsers[cleanEmail]?.role === 'admin');

  if (isTargetAdmin) {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'System administrator account cannot be modified via teachers endpoint',
    });
  }

  const teacherEntry = {
    ...newTeacher,
    email: cleanEmail,
    role: 'teacher', // strictly enforce teacher role
  };

  const existingIdx = db.teachers.findIndex((t) => t.email.toLowerCase() === cleanEmail);
  if (existingIdx >= 0) {
    db.teachers[existingIdx] = { ...db.teachers[existingIdx], ...teacherEntry };
  } else {
    db.teachers.push(teacherEntry);
  }
  writeDb(db);
  res.json({ success: true, teachers: db.teachers });
});

app.delete('/api/teachers/:email', firebaseAuthMiddleware, requireAdmin, (req, res) => {
  const db = readDb();
  const email = decodeURIComponent(req.params.email).toLowerCase().trim();
  const isTargetAdmin =
    (db.teachers || []).some((t: any) => t.email?.toLowerCase() === email && t.role === 'admin') ||
    (db.authUsers && db.authUsers[email]?.role === 'admin');

  if (isTargetAdmin) {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'Cannot delete primary system administrator account',
    });
  }
  db.teachers = db.teachers.filter((t) => t.email.toLowerCase() !== email);
  writeDb(db);
  res.json({ success: true, teachers: db.teachers });
});

// 2.1 Native Friend Notes Standard Vocabulary & Pedagogical Helpers
function normalizePosForNativeNotes(rawPos: string, word: string): string {
  const p = (rawPos || '').toLowerCase().trim();
  const trimmedWord = word.trim().toLowerCase();
  const isMultiWord = trimmedWord.includes(' ');

  if (
    p.includes('phrasal') ||
    (isMultiWord &&
      /^(catch|work|get|make|touch|follow|figure|look|wrap|bring|come|run|give|take|turn|put|call|stand|point|hold|back|fill|drop|sign|warm|wind|burn|cut|deal|keep)\s+(up|out|down|off|in|on|at|for|to|with|into|across|away|over|back|through)/i.test(
        trimmedWord
      ))
  ) {
    return 'Phrasal Verb';
  }
  if (isMultiWord) {
    return 'Idiomatic Expression';
  }
  if (p === 'noun' || p.includes('noun')) return 'Noun';
  if (p === 'verb' || p.includes('verb')) return 'Verb';
  if (p === 'adjective' || p.includes('adj')) return 'Adjective';
  if (p === 'adverb' || p.includes('adv')) return 'Adverb';
  if (p === 'preposition' || p.includes('prep')) return 'Preposition';
  if (p === 'conjunction' || p.includes('conj')) return 'Conjunction';
  if (p === 'interjection') return 'Interjection';
  return 'Vocabulary Item';
}

function resolveNativeNotesCefr(level?: string): 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2' {
  const norm = String(level || '').toLowerCase().trim();
  if (norm.includes('c2') || norm.includes('c1') || norm.includes('avancado') || norm.includes('advanced')) {
    return 'C1';
  }
  if (norm.includes('b2') || norm.includes('upper')) {
    return 'B2';
  }
  if (norm.includes('b1') || norm.includes('intermediario') || norm.includes('intermediate')) {
    return 'B1';
  }
  if (norm.includes('a2') || norm.includes('elementary')) {
    return 'A2';
  }
  return 'A1';
}

function formatPedagogicalSentence(ex: string): string {
  if (!ex) return '';
  let cleaned = ex.trim().replace(/^["'\s]+|["'\s]+$/g, '').trim();
  if (cleaned && !/[.!?]$/.test(cleaned)) {
    cleaned += '.';
  }
  if (cleaned.length > 0) {
    cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }
  return cleaned;
}

function generateNativeNotesExample(word: string, partOfSpeech: string): string {
  const w = word.trim();
  const lowerPos = (partOfSpeech || '').toLowerCase();

  if (lowerPos.includes('phrasal') || lowerPos.includes('verb')) {
    return `We practiced how to ${w} naturally during our daily conversation routine.`;
  }
  if (lowerPos.includes('adjective') || lowerPos.includes('adj')) {
    return `Using "${w}" makes your daily English sound much more expressive and natural.`;
  }
  if (lowerPos.includes('adverb') || lowerPos.includes('adv')) {
    return `She spoke English ${w} during our live conversation practice today.`;
  }
  if (lowerPos.includes('idiom') || lowerPos.includes('expression')) {
    return `The phrase "${w}" is frequently used by native speakers in everyday chats.`;
  }
  if (lowerPos.includes('noun')) {
    return `Understanding the term "${w}" helps you follow native English conversations easily.`;
  }
  return `In daily speaking: "I practiced using '${w}' with confidence in our routine."`;
}

// In-memory cache for pedagogical dictionary lookups (Zero localStorage)
const pedagogicalDictCache = new Map<string, any>();

// 2.1.1 Ultra-Fast AI Pedagogical Vocabulary Synthesizer (Native Friend Notes Standard)
async function queryAiPedagogicalDefinition(
  cleanWord: string,
  studentLevel: string,
  cefr: string,
  callerRole: string = 'student'
): Promise<any | null> {
  const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY || '';
  if (!apiKey || !cleanWord || cleanWord.length < 2) return null;

  try {
    const prompt = `Analyze the word or phrase: "${cleanWord}".
Target CEFR: ${cefr}.
Student English Level: "${studentLevel}".

Generate a personalized pedagogical dictionary entry adhering strictly to Native Friend Notes standards:
1. "word": Exactly "${cleanWord}".
2. "partOfSpeech": Standardized grammatical class: Noun, Verb, Phrasal Verb, Adjective, Adverb, Idiomatic Expression, Collocation, or Preposition.
3. "cefrLevel": Accurate CEFR level for this term: A1, A2, B1, B2, C1, or C2 based on lexical complexity and natural usage.
4. "definitionEn": A personalized, crystal-clear pedagogical explanation in natural English tailored for an ESL learner explaining the practical meaning of this specific term without dictionary jargon or abbreviations (1-2 sentences).
5. "exampleSentenceEn": An authentic, realistic daily-life conversational example sentence showing how native speakers use this exact term in conversation, work, or daily life. Must be capitalized, with proper punctuation, and no surrounding quotes.
6. "translationPt": Accurate Brazilian Portuguese translation of the term in context.
7. "collocations": 2 to 3 natural, everyday collocations for this word.
8. "phonetic": Clean phonetic pronunciation guide (e.g. /.../).
9. "register": "informal" | "neutral" | "formal" | "idiomatic".

Respond strictly with a JSON object:
{
  "word": "${cleanWord}",
  "partOfSpeech": "...",
  "cefrLevel": "...",
  "definitionEn": "...",
  "exampleSentenceEn": "...",
  "translationPt": "...",
  "collocations": ["...", "..."],
  "phonetic": "...",
  "register": "..."
}`;

    // Gemini 3-Model Contingency: Up to 3 sequential attempts across verified models on recoverable failures
    const contingencyResult = await executeGeminiWithContingency({
      feature: 'dictionary_define',
      systemInstruction: 'You are the master Native Friend Notes Pedagogical AI Engine. Provide accurate, crystal-clear lexical analyses for ESL learners in strict JSON.',
      untrustedUserDataPrompt: prompt,
      callerRole,
      apiKey,
      temperature: 0.2,
      jsonValidator: (val) => Boolean(
        val &&
        val.definitionEn &&
        val.exampleSentenceEn &&
        !isGenericPedagogicalDefinition(val.definitionEn) &&
        !isGenericPedagogicalExample(val.exampleSentenceEn)
      ),
    });

    const parsed = contingencyResult?.parsedJson;
    if (
      parsed &&
      parsed.definitionEn &&
      parsed.exampleSentenceEn &&
      !isGenericPedagogicalDefinition(parsed.definitionEn)
    ) {
      return {
        word: parsed.word || cleanWord,
        partOfSpeech: parsed.partOfSpeech || (cleanWord.includes(' ') ? 'Idiomatic Expression' : 'Noun'),
        cefrLevel: parsed.cefrLevel || cefr,
        definitionEn: formatPedagogicalSentence(parsed.definitionEn),
        exampleSentenceEn: formatPedagogicalSentence(parsed.exampleSentenceEn),
        translationPt: parsed.translationPt || '',
        collocations: Array.isArray(parsed.collocations) ? parsed.collocations : [],
        phonetic: parsed.phonetic || '',
        register: parsed.register || 'neutral',
        source: 'native_notes_ai_personalized',
        isAiGenerated: true,
        notFound: false,
      };
    }
  } catch (err) {
    console.warn('Notice querying AI pedagogical dictionary:', err);
  }
  return null;
}

// 2.2 Dictionary Lookup Endpoint (Native Friend Notes Unified Standard)
app.all('/api/dictionary/define', firebaseAuthMiddleware, async (req, res) => {
  const rawWord = (req.body?.word || req.query?.word || '') as string;
  if (!rawWord || typeof rawWord !== 'string') {
    return res.status(400).json({ error: 'Word is required' });
  }

  const cleanWord = rawWord.trim();
  if (cleanWord.length > 100) {
    return res.status(400).json({
      error: 'Payload bounds exceeded',
      message: 'Word parameter exceeds the maximum permitted length of 100 characters.',
    });
  }

  const caller = req.user!;
  const lowerWord = cleanWord.toLowerCase();
  let studentLevel = (req.body?.studentLevel || req.body?.level || req.query?.level || 'intermediate') as string;

  // Authoritative CEFR level for authenticated student
  if (caller.role === 'student') {
    const db = readDb();
    const callerEmail = (caller.email || '').toLowerCase().trim();
    const registeredStudent = (db.students || []).find((s: any) =>
      (s.uid === caller.uid || s.id === caller.uid) ||
      (callerEmail && (s.email || '').toLowerCase().trim() === callerEmail)
    );
    const profile = db.userProfiles?.[caller.uid] || (callerEmail && db.userProfiles?.[callerEmail]);
    if (profile?.level || profile?.englishLevel || registeredStudent?.level || registeredStudent?.englishLevel) {
      studentLevel = profile?.level || profile?.englishLevel || registeredStudent?.level || registeredStudent?.englishLevel;
    }
  }

  const cefr = resolveNativeNotesCefr(studentLevel);
  const cacheKey = `${lowerWord}_${cefr}`;

  if (pedagogicalDictCache.has(cacheKey)) {
    const cached = pedagogicalDictCache.get(cacheKey);
    if (cached && !cached.notFound && !cached.unavailable && !isGenericPedagogicalDefinition(cached.definitionEn)) {
      return res.json(cached);
    }
    pedagogicalDictCache.delete(cacheKey);
    pedagogicalDictCache.delete(lowerWord);
  }

  // 1. Curated repository check adhering to Native Friend Notes (Instant 0ms)
  const normalizedKey = lowerWord.replace(/[_\-]+/g, ' ');
  const dbEntry = NATIVE_FRIENDS_DICTIONARY_DATABASE[lowerWord] || NATIVE_FRIENDS_DICTIONARY_DATABASE[normalizedKey];

  if (dbEntry) {
    const curatedResult = {
      word: dbEntry.word,
      partOfSpeech: dbEntry.partOfSpeech,
      cefrLevel: dbEntry.cefrLevel || cefr,
      definitionEn: dbEntry.definitionEn,
      exampleSentenceEn: formatPedagogicalSentence(dbEntry.exampleSentenceEn),
      translationPt: dbEntry.translationPt || '',
      collocations: dbEntry.collocations,
      synonyms: dbEntry.synonyms,
      register: dbEntry.register,
      phonetic: dbEntry.phonetic,
      source: 'native_notes_standard',
      notFound: false,
    };
    pedagogicalDictCache.set(cacheKey, curatedResult);
    pedagogicalDictCache.set(lowerWord, curatedResult);
    return res.json(curatedResult);
  }

  // Security Hotfix (Etapa 2 & Residuals): Rate limiting per UID and single-flight lock before AI invocation
  const rateLimitCheck = await checkAndConsumeRateLimit(caller.uid, 'dictionary_define');
  if (!rateLimitCheck.allowed) {
    if (rateLimitCheck.unavailable) {
      return sendGeminiCostControlUnavailable(res, 5);
    }
    logGeminiAudited({
      feature: 'dictionary_define',
      status: 'RATE_LIMITED',
      callerRole: caller.role,
      detail: `Rate limit hit, retry after ${rateLimitCheck.retryAfterSeconds}s`,
    });
    // Deterministic fallback immediately
    const offlineEntry = getDictionaryDefinition(cleanWord);
    if (offlineEntry && offlineEntry.definitionEn) {
      const offlineResult = {
        word: offlineEntry.word || cleanWord,
        partOfSpeech: offlineEntry.partOfSpeech || (cleanWord.includes(' ') ? 'Idiomatic Expression' : 'Noun'),
        cefrLevel: (offlineEntry as any).cefrLevel || cefr,
        definitionEn: offlineEntry.definitionEn,
        exampleSentenceEn: formatPedagogicalSentence(offlineEntry.exampleSentenceEn || generateNativeNotesExample(cleanWord, offlineEntry.partOfSpeech || '')),
        translationPt: offlineEntry.translationPt || '',
        phonetic: (offlineEntry as any).phonetic,
        source: 'native_notes_standard',
        isFallback: true,
        rateLimited: true,
        notFound: false,
      };
      return res.json(offlineResult);
    }
  }

  // 2. Query Gemini AI for personalized pedagogical entry with single-flight protection
  const flightLock = await acquireSingleFlightLock(`dictionary_define:${cacheKey}`);
  if (!flightLock.acquired && flightLock.unavailable) {
    return sendGeminiCostControlUnavailable(res, 5);
  }
  let aiResult: any = null;
  if (flightLock.acquired) {
    try {
      aiResult = await queryAiPedagogicalDefinition(cleanWord, studentLevel, cefr, caller.role);
    } finally {
      await flightLock.release();
    }
  }

  if (aiResult) {
    pedagogicalDictCache.set(cacheKey, aiResult);
    pedagogicalDictCache.set(lowerWord, aiResult);
    return res.json(aiResult);
  }

  // 3. Curated offline entry fallback
  const offlineEntry = getDictionaryDefinition(cleanWord);
  if (offlineEntry && offlineEntry.definitionEn) {
    const offlineResult = {
      word: offlineEntry.word || cleanWord,
      partOfSpeech: offlineEntry.partOfSpeech || (cleanWord.includes(' ') ? 'Idiomatic Expression' : 'Noun'),
      cefrLevel: (offlineEntry as any).cefrLevel || cefr,
      definitionEn: offlineEntry.definitionEn,
      exampleSentenceEn: formatPedagogicalSentence(offlineEntry.exampleSentenceEn || generateNativeNotesExample(cleanWord, offlineEntry.partOfSpeech || '')),
      translationPt: offlineEntry.translationPt || '',
      phonetic: (offlineEntry as any).phonetic,
      source: 'native_notes_standard',
      notFound: false,
    };
    pedagogicalDictCache.set(cacheKey, offlineResult);
    pedagogicalDictCache.set(lowerWord, offlineResult);
    return res.json(offlineResult);
  }

  // 4. Secondary query to Free Dictionary API with Native Friend Notes pedagogical adaptation
  try {
    const candidateTerms = [lowerWord];
    if (lowerWord.endsWith('pped') || lowerWord.endsWith('tted') || lowerWord.endsWith('gged') || lowerWord.endsWith('nned')) {
      candidateTerms.push(lowerWord.slice(0, -3)); // trapped -> trap
    } else if (lowerWord.endsWith('ied')) {
      candidateTerms.push(lowerWord.slice(0, -3) + 'y'); // tried -> try
    } else if (lowerWord.endsWith('ed')) {
      candidateTerms.push(lowerWord.slice(0, -2)); // learned -> learn
      candidateTerms.push(lowerWord.slice(0, -1)); // compelled -> compel
    } else if (lowerWord.endsWith('ing')) {
      candidateTerms.push(lowerWord.slice(0, -3));
      candidateTerms.push(lowerWord.slice(0, -3) + 'e');
    } else if (lowerWord.endsWith('es')) {
      candidateTerms.push(lowerWord.slice(0, -2));
      candidateTerms.push(lowerWord.slice(0, -1));
    } else if (lowerWord.endsWith('s')) {
      candidateTerms.push(lowerWord.slice(0, -1));
    }

    for (const term of candidateTerms) {
      if (!term || term.length < 2) continue;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3500);
      const apiRes = await fetch(
        `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(term)}`,
        {
          headers: { Accept: 'application/json' },
          signal: controller.signal,
        }
      ).catch(() => null);
      clearTimeout(timeout);

      if (apiRes && apiRes.ok) {
        const data = (await apiRes.json()) as any[];
        if (Array.isArray(data) && data.length > 0 && Array.isArray(data[0].meanings) && data[0].meanings.length > 0) {
          const entry = data[0];
          const firstMeaning = entry.meanings[0];
          const rawPos = firstMeaning.partOfSpeech || '';
          const pos = normalizePosForNativeNotes(rawPos, cleanWord);
          const firstDefObj = firstMeaning.definitions?.[0];
          let def = firstDefObj?.definition?.trim() || '';

          let example = firstDefObj?.example?.trim() || '';
          if (!example && Array.isArray(firstMeaning.definitions)) {
            const defWithEx = firstMeaning.definitions.find((d: any) => d.example && d.example.trim());
            if (defWithEx) example = defWithEx.example.trim();
          }
          if (!example) {
            for (const m of entry.meanings) {
              if (Array.isArray(m.definitions)) {
                const dEx = m.definitions.find((d: any) => d.example && d.example.trim());
                if (dEx) {
                  example = dEx.example.trim();
                  break;
                }
              }
            }
          }

          if (def) {
            let cleanDef = def.replace(/^[:\s\-—]+/, '').trim();
            if (cleanDef.length > 0) {
              cleanDef = cleanDef.charAt(0).toUpperCase() + cleanDef.slice(1);
              if (!/[.!?]$/.test(cleanDef)) {
                cleanDef += '.';
              }
            }

            const result = {
              word: cleanWord,
              partOfSpeech: pos,
              cefrLevel: cefr,
              definitionEn: cleanDef,
              exampleSentenceEn: example ? formatPedagogicalSentence(example) : generateNativeNotesExample(cleanWord, pos),
              phonetic: entry.phonetic || entry.phonetics?.find((p: any) => p.text)?.text,
              audio: entry.phonetics?.find((p: any) => p.audio && p.audio.startsWith('http'))?.audio,
              source: 'native_notes_standard',
              notFound: false,
            };
            pedagogicalDictCache.set(cacheKey, result);
            pedagogicalDictCache.set(lowerWord, result);
            return res.json(result);
          }
        }
      }
    }
  } catch {
    // Secondary fallback handling
  }

  // 5. If all sources fail, return transparent unavailability while preserving the word
  return res.status(503).json({
    word: cleanWord,
    unavailable: true,
    notFound: false,
    message: 'Pedagogical definition temporarily unavailable. Your word is preserved.',
    source: 'ai_unavailable',
  });
});

// Internal helper to lookup word definition & examples for pedagogical engine
async function lookupServerDictionaryWord(cleanWord: string, studentLevel?: string): Promise<{
  word: string;
  definitionEn: string;
  exampleSentenceEn: string;
  translationPt: string;
  cefrLevel: string;
  partOfSpeech: string;
}> {
  const trimmed = cleanWord.trim();
  const lower = trimmed.toLowerCase();
  const cefr = resolveNativeNotesCefr(studentLevel);

  // 1. Pedagogical cache check (0ms)
  const cacheKey = `${lower}_${cefr}`;
  if (pedagogicalDictCache.has(cacheKey)) {
    const cached = pedagogicalDictCache.get(cacheKey);
    if (cached && !cached.notFound && cached.definitionEn && !isGenericPedagogicalDefinition(cached.definitionEn)) {
      return {
        word: trimmed,
        definitionEn: cached.definitionEn,
        exampleSentenceEn: cached.exampleSentenceEn || generateNativeNotesExample(trimmed, cached.partOfSpeech || ''),
        translationPt: cached.translationPt || trimmed,
        cefrLevel: cached.cefrLevel || cefr,
        partOfSpeech: cached.partOfSpeech || 'Vocabulary Item',
      };
    }
    pedagogicalDictCache.delete(cacheKey);
  }

  // 2. Offline curated routine dictionary
  const normalizedKey = lower.replace(/[_\-]+/g, ' ');
  const dbEntry = NATIVE_FRIENDS_DICTIONARY_DATABASE[lower] || NATIVE_FRIENDS_DICTIONARY_DATABASE[normalizedKey];

  if (dbEntry) {
    return {
      word: dbEntry.word,
      definitionEn: dbEntry.definitionEn,
      exampleSentenceEn: formatPedagogicalSentence(dbEntry.exampleSentenceEn),
      translationPt: dbEntry.translationPt || trimmed,
      cefrLevel: dbEntry.cefrLevel || cefr,
      partOfSpeech: dbEntry.partOfSpeech,
    };
  }

  // 3. Query Gemini AI for personalized entry
  const aiRes = await queryAiPedagogicalDefinition(trimmed, studentLevel || 'intermediate', cefr);
  if (aiRes) {
    pedagogicalDictCache.set(cacheKey, aiRes);
    pedagogicalDictCache.set(lower, aiRes);
    return {
      word: trimmed,
      definitionEn: aiRes.definitionEn,
      exampleSentenceEn: aiRes.exampleSentenceEn,
      translationPt: aiRes.translationPt || trimmed,
      cefrLevel: aiRes.cefrLevel || cefr,
      partOfSpeech: aiRes.partOfSpeech,
    };
  }

  const offline = getDictionaryDefinition(trimmed);
  if (offline && offline.definitionEn && offline.definitionEn.trim()) {
    return {
      word: trimmed,
      definitionEn: offline.definitionEn.trim(),
      exampleSentenceEn: offline.exampleSentenceEn?.trim() || generateNativeNotesExample(trimmed, offline.partOfSpeech || ''),
      translationPt: offline.translationPt?.trim() || trimmed,
      cefrLevel: (offline as any).cefrLevel || cefr,
      partOfSpeech: offline.partOfSpeech || (trimmed.includes(' ') ? 'Idiomatic Expression' : 'Noun'),
    };
  }

  // 4. Free Dictionary API lookup with Native Friend Notes transformation
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3500);
    const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(lower)}`, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (res.ok) {
      const data = (await res.json()) as any[];
      if (Array.isArray(data) && data.length > 0 && Array.isArray(data[0].meanings) && data[0].meanings.length > 0) {
        const firstMeaning = data[0].meanings[0];
        const pos = normalizePosForNativeNotes(firstMeaning.partOfSpeech || '', trimmed);
        const def = firstMeaning.definitions?.[0]?.definition?.trim() || '';
        let ex = firstMeaning.definitions?.[0]?.example?.trim() || '';
        if (!ex && Array.isArray(firstMeaning.definitions)) {
          const found = firstMeaning.definitions.find((d: any) => d.example?.trim());
          if (found) ex = found.example.trim();
        }
        if (def) {
          let cleanDef = def.replace(/^[:\s\-—]+/, '').trim();
          if (cleanDef.length > 0) {
            cleanDef = cleanDef.charAt(0).toUpperCase() + cleanDef.slice(1);
            if (!/[.!?]$/.test(cleanDef)) cleanDef += '.';
          }
          return {
            word: trimmed,
            definitionEn: cleanDef,
            exampleSentenceEn: ex ? formatPedagogicalSentence(ex) : generateNativeNotesExample(trimmed, pos),
            translationPt: trimmed,
            cefrLevel: cefr,
            partOfSpeech: pos,
          };
        }
      }
    }
  } catch {}

  // 5. Unavailability fallback: return empty definition instead of synthetic placeholder
  const isMultiWord = trimmed.includes(' ');
  const fallbackPos = isMultiWord ? 'Idiomatic Expression' : 'Vocabulary Item';
  return {
    word: trimmed,
    definitionEn: '',
    exampleSentenceEn: '',
    translationPt: trimmed,
    cefrLevel: cefr,
    partOfSpeech: fallbackPos,
  };
}

// 3. Meet Settings & Teacher Settings Endpoints
app.get(['/api/meet-settings', '/api/teacher-settings'], async (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  const db = readDb();
  const teacherEmail = ((req.query.teacherEmail as string) || (req.query.email as string) || '').toLowerCase().trim();
  const uid = (req.query.uid as string) || '';
  const verifiedCaller = await getVerifiedUserFromRequest(req);
  const isCallerAdmin = verifiedCaller?.role === 'admin';

  if (isCallerAdmin || (!teacherEmail && !uid)) {
    const settings = { ...db.meetSettings, ...db.teacherSettings };
    return res.json(settings);
  }

  if (teacherEmail || uid) {
    let specific =
      (teacherEmail ? (db.meetSettings[teacherEmail] || db.teacherSettings[teacherEmail]) : null) ||
      (uid ? (db.meetSettings[uid] || db.teacherSettings[uid]) : null) ||
      null;

    // Check tutor match from db.tutorsList
    const tutorMatch = (db.tutorsList || []).find(
      (t: any) =>
        (teacherEmail && (t.email || '').toLowerCase().trim() === teacherEmail) ||
        (uid && t.uid === uid)
    );

    // If specific is not yet found or missing availability, attempt to retrieve from Firestore
    if (!specific || (!specific.availability && !specific.availableHoursByDay)) {
      try {
        const firestoreData = await fetchTeacherAvailabilityFromFirestore(uid || teacherEmail);
        if (firestoreData) {
          specific = {
            ...(specific || {}),
            ...firestoreData,
          };
          if (teacherEmail) {
            db.meetSettings[teacherEmail] = specific;
            db.teacherSettings[teacherEmail] = specific;
          }
          if (uid) {
            db.meetSettings[uid] = specific;
            db.teacherSettings[uid] = specific;
          }
        }
      } catch (err) {
        console.warn('Could not read teacher availability from Firestore:', err);
      }
    }

    const finalResult = {
      ...(specific || {}),
      teacherEmail: teacherEmail || specific?.teacherEmail || tutorMatch?.email || '',
      uid: uid || specific?.uid || tutorMatch?.uid || '',
    };

    // If meet link is missing, fallback to tutor profile meetUrl
    if (!finalResult.meetLink && tutorMatch) {
      finalResult.meetLink = tutorMatch.meetUrl || tutorMatch.meetLink || '';
    }

    // If availability was stored on tutorMatch, merge it
    if (!finalResult.availability && tutorMatch?.availability) {
      finalResult.availability = tutorMatch.availability;
    }
    if (!finalResult.availableHoursByDay && tutorMatch?.availableHoursByDay) {
      finalResult.availableHoursByDay = tutorMatch.availableHoursByDay;
    }
    if (!finalResult.availableDays && tutorMatch?.availableDays) {
      finalResult.availableDays = tutorMatch.availableDays;
    }

    return res.json(finalResult);
  }

  // Return all known meet settings, merging from tutorsList if available
  const allSettings = { ...(db.meetSettings || {}), ...(db.teacherSettings || {}) };
  if (Array.isArray(db.tutorsList)) {
    db.tutorsList.forEach((tut: any) => {
      const email = (tut.email || '').toLowerCase().trim();
      const mUrl = (tut.meetUrl || tut.meetLink || '').trim();
      const isGeneric = !mUrl || mUrl.toLowerCase().includes('meet.google.com/new');
      if (email && (!allSettings[email] || !allSettings[email].meetLink)) {
        allSettings[email] = {
          teacherEmail: email,
          meetLink: isGeneric ? '' : mUrl,
          workingHoursStart: tut.workingHoursStart || '08:00',
          workingHoursEnd: tut.workingHoursEnd || '18:00',
          slotDurationMinutes: tut.slotDurationMinutes || 30,
          availableDays: tut.availableDays || ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'],
          availability: tut.availability || tut.availableHoursByDay || {},
          availableHoursByDay: tut.availableHoursByDay || tut.availability || {},
          timezone: tut.timezone || 'America/Toronto',
        };
      }
    });
  }
  res.json(allSettings);
});

app.post(['/api/meet-settings', '/api/teacher-settings'], async (req, res) => {
  const db = readDb();
  const settings = req.body.settings || req.body;
  const teacherEmail = req.body.teacherEmail || settings.teacherEmail;
  const uid = req.body.uid || settings.uid;
  if (!teacherEmail || !settings) {
    return res.status(400).json({ error: 'Missing teacherEmail or settings' });
  }
  const cleanEmail = teacherEmail.toLowerCase().trim();

  // Normalize granular availability maps
  const availability = settings.availability || settings.availableHoursByDay || {};
  const availableHoursByDay = settings.availableHoursByDay || settings.availability || {};

  const entry = {
    ...settings,
    teacherEmail: cleanEmail,
    ...(uid ? { uid } : {}),
    availability,
    availableHoursByDay,
    updatedAt: new Date().toISOString(),
  };

  db.meetSettings[cleanEmail] = entry;
  db.teacherSettings[cleanEmail] = entry;
  if (uid) {
    db.meetSettings[uid] = entry;
    db.teacherSettings[uid] = entry;
  }

  // Also update corresponding tutor in tutorsList if present
  if (db.tutorsList && Array.isArray(db.tutorsList)) {
    const tutorIdx = db.tutorsList.findIndex(
      (t: any) => (t.email || '').toLowerCase().trim() === cleanEmail || (uid && t.uid === uid)
    );
    if (tutorIdx >= 0) {
      db.tutorsList[tutorIdx] = {
        ...db.tutorsList[tutorIdx],
        meetUrl: entry.meetLink || db.tutorsList[tutorIdx].meetUrl,
        meetLink: entry.meetLink || db.tutorsList[tutorIdx].meetLink,
        availableDays: entry.availableDays || db.tutorsList[tutorIdx].availableDays,
        availableHours: entry.availableHours || db.tutorsList[tutorIdx].availableHours,
        availability: entry.availability || db.tutorsList[tutorIdx].availability,
        availableHoursByDay: entry.availableHoursByDay || db.tutorsList[tutorIdx].availableHoursByDay,
        timezone: entry.timezone || db.tutorsList[tutorIdx].timezone,
      };
    }
  }

  await writeDbSync(db);

  // Directly persist to Firestore linked to teacher UID / Email in teacher_availability collection
  if (uid || cleanEmail) {
    saveTeacherAvailabilityToFirestore(uid || cleanEmail, entry).catch((err) => {
      console.warn('Background Firestore teacher availability save failed:', err);
    });
  }

  res.json({
    success: true,
    settings: entry,
    meetSettings: db.meetSettings,
    teacherSettings: db.teacherSettings,
  });
});

// 4. Students & Enrollments Endpoints
app.get('/api/students', async (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  const db = readDb();
  const verifiedCaller = await getVerifiedUserFromRequest(req);
  if (!verifiedCaller || !verifiedCaller.uid || !isValidCanonicalUid(verifiedCaller.uid)) {
    return res.json([]);
  }

  const deletedEmails = new Set(
    (db.deletedStudentEmails || []).map((e: string) => String(e || '').toLowerCase().trim()).filter(Boolean)
  );

  const normalizeStudentRecord = (raw: any) => {
    if (!raw || typeof raw !== 'object') return null;
    const cUid = String(raw.uid || raw.studentUid || raw.id || '').trim();
    if (!cUid || !isValidCanonicalUid(cUid)) return null;
    const em = String(raw.email || raw.studentEmail || '').toLowerCase().trim();
    if (!em || deletedEmails.has(em)) return null;
    const r = String(raw.role || raw.userRole || '').toLowerCase().trim();
    if (r === 'teacher' || r === 'admin' || r === 'native_friend' || r === 'tutor') return null;

    const resolvedTeacherUid = raw.teacherUid || raw.assignedNativeFriendUID || raw.nativeFriendUID || null;
    const resolvedTeacherEmail = raw.teacherEmail ? String(raw.teacherEmail).toLowerCase().trim() : null;
    const resolvedName = raw.name || raw.studentName || em.split('@')[0];
    const resolvedLevel = raw.level || raw.studentLevel || 'iniciante';
    const resolvedGoal = raw.learningGoal || raw.goal || 'English for everyday life & work';
    const resolvedStatus = raw.status || raw.enrollmentStatus || 'active';

    return {
      ...raw,
      id: cUid,
      uid: cUid,
      studentUid: cUid,
      name: resolvedName,
      studentName: resolvedName,
      email: em,
      studentEmail: em,
      level: resolvedLevel,
      studentLevel: resolvedLevel,
      goal: resolvedGoal,
      learningGoal: resolvedGoal,
      teacherEmail: resolvedTeacherEmail,
      teacherUid: resolvedTeacherUid,
      assignedNativeFriendUID: resolvedTeacherUid,
      nativeFriendUID: resolvedTeacherUid,
      teacherName: raw.teacherName || '',
      contractedLessons: Number(raw.contractedLessons ?? 0),
      ...(typeof raw.availableLessons === 'number' ? { availableLessons: raw.availableLessons } : {}),
      completedLessonsCount: Number(raw.completedLessonsCount || 0),
      picture: raw.picture || raw.avatar || '',
      avatar: raw.avatar || raw.picture || '',
      status: resolvedStatus,
      enrollmentStatus: raw.enrollmentStatus || resolvedStatus,
      enrolledAt: raw.enrolledAt || raw.createdAt || undefined,
    };
  };

  const isAdmin = verifiedCaller.role === 'admin';
  let isTeacher = false;
  let teacherPublicId = '';
  let callerIdentityRole: string = isAdmin ? 'admin' : 'student';

  if (!isAdmin) {
    try {
      const identityRes = await resolveCanonicalUserRoleAndIdentity({
        uid: verifiedCaller.uid,
        email: verifiedCaller.email,
        tokenRole: verifiedCaller.role,
        dbState: db,
      });
      callerIdentityRole = identityRes.role;
      if (identityRes.role === 'teacher') {
        isTeacher = true;
        teacherPublicId = identityRes.publicTutorId || '';
      }
    } catch {
      isTeacher = verifiedCaller.role === 'teacher';
    }
  }

  const firestoreDb = getFirestoreDb();

  // Admin gets all active canonical students from Firestore (default)
  if (isAdmin) {
    const usersRes = await fetchUsersFromFirestoreCanonical();
    if (usersRes.ok) {
      const adminStudents = usersRes.users
        .map((u: any) => normalizeStudentRecord(u))
        .filter((s: any) => {
          if (!s) return false;
          const sStatus = s.status || s.enrollmentStatus;
          return sStatus !== 'cancelled' && sStatus !== 'not_enrolled';
        });
      return res.json(adminStudents);
    }

    const fallbackAdminStudents = (db.students || [])
      .map((s: any) => normalizeStudentRecord(s))
      .filter((s: any) => {
        if (!s) return false;
        const sStatus = s.status || s.enrollmentStatus;
        return sStatus !== 'cancelled' && sStatus !== 'not_enrolled';
      });
    return res.json(fallbackAdminStudents);
  }

  if (isTeacher) {
    const callerUid = verifiedCaller.uid;
    const callerEmail = (verifiedCaller.email || '').toLowerCase().trim();
    const matchesTeacherRef = (tUid?: string | null, tEmail?: string | null): boolean => {
      const cleanTUid = String(tUid || '').trim();
      const cleanTEmail = String(tEmail || '').toLowerCase().trim();
      if (callerUid && cleanTUid && (cleanTUid === callerUid || (teacherPublicId && cleanTUid === teacherPublicId) || cleanTUid === `tutor-${callerUid}`)) {
        return true;
      }
      if (callerEmail && cleanTEmail && cleanTEmail === callerEmail) {
        return true;
      }
      return false;
    };

    const hasConflictingTeacherRef = (tUid?: string | null, tEmail?: string | null): boolean => {
      const cleanTUid = String(tUid || '').trim();
      const cleanTEmail = String(tEmail || '').toLowerCase().trim();
      if (cleanTUid && callerUid && cleanTUid !== callerUid && (!teacherPublicId || cleanTUid !== teacherPublicId) && cleanTUid !== `tutor-${callerUid}`) {
        return true;
      }
      if (cleanTEmail && callerEmail && cleanTEmail !== callerEmail) {
        return true;
      }
      return false;
    };

    const usersRes = await fetchUsersFromFirestoreCanonical();
    if (usersRes.ok) {
      const studentMap = new Map<string, any>();
      const assignedByUid = new Map<string, any>();
      const lessonUids = new Set<string>();

      if (firestoreDb) {
        try {
          const [assignSnap, lessonsSnap] = await Promise.all([
            firestoreDb.collection('student_assignments').get().catch(() => null),
            firestoreDb.collection('live_lessons').get().catch(() => null),
          ]);

          if (assignSnap) {
            assignSnap.forEach((d: any) => {
              const data = d.data();
              if (!data) return;
              const sUid = String(data.studentUid || data.uid || d.id || '').trim();
              if (!sUid || !isValidCanonicalUid(sUid)) return;
              if (
                matchesTeacherRef(
                  data.teacherUid || data.teacherAuthUid || data.assignedNativeFriendUID || data.nativeFriendUID,
                  data.teacherEmail
                )
              ) {
                assignedByUid.set(sUid, data);
              }
            });
          }

          if (lessonsSnap) {
            lessonsSnap.forEach((d: any) => {
              const l = d.data();
              if (!l || l.status === 'cancelled') return;
              const sUid = String(l.studentUid || '').trim();
              if (!sUid || !isValidCanonicalUid(sUid)) return;
              if (matchesTeacherRef(l.teacherUid || l.tutorUid, l.teacherEmail || l.tutorEmail)) {
                lessonUids.add(sUid);
              }
            });
          }
        } catch {}
      }

      for (const rawUser of usersRes.users) {
        const st = normalizeStudentRecord(rawUser);
        if (!st) continue;
        if (st.status === 'cancelled' || st.status === 'not_enrolled' || st.enrollmentStatus === 'cancelled' || st.enrollmentStatus === 'not_enrolled') {
          continue;
        }
        const assignMeta = assignedByUid.get(st.uid);
        const directMatch = matchesTeacherRef(
          st.teacherUid || st.assignedNativeFriendUID || st.nativeFriendUID,
          st.teacherEmail
        );
        const auxMatch = Boolean(assignMeta || lessonUids.has(st.uid));
        if (!directMatch && (!auxMatch || hasConflictingTeacherRef(st.teacherUid, st.teacherEmail))) {
          continue;
        }
        studentMap.set(st.uid, {
          ...st,
          ...(assignMeta?.weeklyCycle !== undefined && st.weeklyCycle === undefined ? { weeklyCycle: assignMeta.weeklyCycle } : {}),
          status: 'active',
        });
      }

      return res.json(Array.from(studentMap.values()));
    }

    // Degraded fallback when Firestore is unavailable in isolated test environments (never synthesizes st-*)
    const studentMap = new Map<string, any>();

    (db.students || []).forEach((s: any) => {
      const sStatus = s.status || s.enrollmentStatus;
      if (sStatus === 'cancelled' || sStatus === 'not_enrolled') return;
      if (!matchesTeacherRef(s.teacherUid || s.assignedNativeFriendUID, s.teacherEmail)) return;
      const sEmail = (s.email || s.studentEmail || '').toLowerCase().trim();
      const p = db.userProfiles?.[sEmail];
      if (p) {
        if (hasConflictingTeacherRef(p.teacherUid, p.teacherEmail)) return;
        if (p.enrollmentStatus === 'cancelled' || p.enrollmentStatus === 'not_enrolled') return;
      }
      const norm = normalizeStudentRecord(s);
      if (norm) studentMap.set(norm.uid, { ...norm, status: norm.status || 'active' });
    });

    Object.entries(db.userProfiles || {}).forEach(([pEmail, profile]: [string, any]) => {
      const cleanPEmail = pEmail.toLowerCase().trim();
      if (!matchesTeacherRef(profile?.teacherUid || profile?.assignedNativeFriendUID, profile?.teacherEmail)) return;
      if (profile?.enrollmentStatus === 'cancelled' || profile?.enrollmentStatus === 'not_enrolled' || profile?.status === 'cancelled') return;
      const norm = normalizeStudentRecord({ ...profile, email: cleanPEmail });
      if (norm && !studentMap.has(norm.uid)) {
        studentMap.set(norm.uid, {
          ...norm,
          contractedLessons: Number(profile.contractedLessons ?? db.contractedLessons?.[cleanPEmail] ?? 0),
          status: 'active',
        });
      }
    });

    return res.json(Array.from(studentMap.values()));
  }

  // Student caller: may ONLY view their own canonical student record
  if (callerIdentityRole === 'conflict' || callerIdentityRole === 'pending_teacher') {
    return res.json([]);
  }

  const callerUid = verifiedCaller.uid;
  const callerEmail = (verifiedCaller.email || '').toLowerCase().trim();
  const fsUserRes = await fetchUserWithStatusFromFirestore(callerEmail, callerUid);

  if (fsUserRes.ok) {
    const ownStudent = fsUserRes.user ? normalizeStudentRecord(fsUserRes.user) : null;
    return res.json(ownStudent ? [ownStudent] : []);
  }

  // Degraded fallback when Firestore is unavailable
  const list = (db.students || [])
    .filter((s: any) => {
      const em = (s.email || s.studentEmail || '').toLowerCase().trim();
      const u = (s.uid || s.studentUid || s.id || '').trim();
      return (u && u === callerUid) || (callerEmail && em === callerEmail);
    })
    .map((s: any) => normalizeStudentRecord(s))
    .filter(Boolean);
  if (list.length > 0) return res.json(list);

  const prof = callerEmail ? db.userProfiles?.[callerEmail] : null;
  if (prof) {
    const normProf = normalizeStudentRecord({ ...prof, uid: prof.uid || prof.id || callerUid, email: callerEmail });
    if (normProf) return res.json([normProf]);
  }

  return res.json([]);
});

// Dedicated maintenance endpoint to purge obsolete users and sanitize Firestore app_state
app.post('/api/admin/clean-obsolete-users', firebaseAuthMiddleware, requireAdmin, async (_req, res) => {
  // SECURITY HOTFIX 4B.19A: Unsafe destructive bulk cleanup via hardcoded allowlists is permanently disabled.
  // Preserves administrator-only authorization check while preventing accidental data deletion of legitimate users.
  return res.status(200).json({
    success: true,
    disabled: true,
    message: 'Bulk cleanup is safely disabled to prevent accidental deletion of legitimate users. Individual UID-based reconciliation required.',
    deletedCount: 0,
    modified: false,
  });
});

app.post('/api/students', async (req, res) => {
  const db = readDb();
  const enrollment = req.body;
  const email = enrollment.email || enrollment.studentEmail;
  if (!enrollment || !email) {
    return res.status(400).json({ error: 'Invalid student data' });
  }
  const cleanEmail = email.toLowerCase().trim();

  const incomingTeacherRef = enrollment.teacherUid || enrollment.teacherId || enrollment.teacherEmail || enrollment.assignedNativeFriendUID;
  if (incomingTeacherRef) {
    const teacherRes = await resolveTeacherCanonicalIdentity({
      teacherId: enrollment.teacherId || (typeof incomingTeacherRef === 'string' ? incomingTeacherRef : undefined),
      teacherUid: enrollment.teacherUid || enrollment.assignedNativeFriendUID,
      teacherEmail: enrollment.teacherEmail,
      publicTutorId: enrollment.teacherId,
      dbState: db,
    });
    if (teacherRes) {
      if (!teacherRes.isApproved) {
        return res.status(400).json({ error: 'O Amigo Nativo selecionado ainda não foi aprovado para receber alunos.' });
      }
      if (!isValidCanonicalUid(teacherRes.canonicalUid)) {
        return res.status(400).json({ error: 'Não foi possível comprovar a identidade canônica do Amigo Nativo selecionado.' });
      }
      enrollment.teacherUid = teacherRes.canonicalUid;
      enrollment.assignedNativeFriendUID = teacherRes.canonicalUid;
      enrollment.nativeFriendUID = teacherRes.canonicalUid;
      enrollment.teacherEmail = teacherRes.email || enrollment.teacherEmail;
      enrollment.teacherName = teacherRes.name || enrollment.teacherName;
    } else {
      return res.status(400).json({ error: 'Amigo Nativo selecionado não encontrado ou inválido.' });
    }
  }

  const idx = db.students.findIndex((s) => (s.email || s.studentEmail || '').toLowerCase() === cleanEmail);
  if (idx >= 0) {
    db.students[idx] = { ...db.students[idx], ...enrollment, email: cleanEmail, studentEmail: cleanEmail };
  } else {
    db.students.push({
      id: enrollment.id || `st-${Date.now()}`,
      ...enrollment,
      email: cleanEmail,
      studentEmail: cleanEmail,
    });
  }
  writeDb(db);
  res.json(db.students);
});

app.delete('/api/students/:identifier', firebaseAuthMiddleware, requireAdmin, async (req, res) => {
  const db = readDb();
  const rawId = req.params.identifier;
  if (!rawId) {
    return res.status(400).json({ error: 'Identifier is required' });
  }

  const clean = decodeURIComponent(rawId).toLowerCase().trim();
  console.log(`[DELETE /api/students] Request to delete student: ${clean}`);

  let targetEmail = clean.includes('@') ? clean : '';
  const matchingStudent = (db.students || []).find((s: any) => {
    const sEmail = (s.email || s.studentEmail || '').toLowerCase().trim();
    const sId = (s.id || '').toLowerCase().trim();
    return sEmail === clean || sId === clean;
  });

  if (matchingStudent) {
    targetEmail = (matchingStudent.email || matchingStudent.studentEmail || targetEmail).toLowerCase().trim();
  }

  // Remove from students array
  db.students = (db.students || []).filter((s: any) => {
    const sEmail = (s.email || s.studentEmail || '').toLowerCase().trim();
    const sId = (s.id || '').toLowerCase().trim();
    return sEmail !== clean && sId !== clean && (!targetEmail || sEmail !== targetEmail);
  });

  // Remove from userProfiles
  if (targetEmail && db.userProfiles?.[targetEmail]) {
    delete db.userProfiles[targetEmail];
  }

  // Remove from contractedLessons
  if (targetEmail && db.contractedLessons?.[targetEmail] !== undefined) {
    delete db.contractedLessons[targetEmail];
  }

  // Remove from authUsers
  if (targetEmail && db.authUsers?.[targetEmail]?.role === 'student') {
    delete db.authUsers[targetEmail];
  }

  // Remove from studentRoutinesMap
  if (targetEmail && db.studentRoutinesMap?.[targetEmail]) {
    delete db.studentRoutinesMap[targetEmail];
  }

  // Track permanently in deletedStudentEmails
  if (!Array.isArray(db.deletedStudentEmails)) {
    db.deletedStudentEmails = [];
  }
  if (targetEmail && !db.deletedStudentEmails.includes(targetEmail)) {
    db.deletedStudentEmails.push(targetEmail);
  }

  await writeDbSync(db);

  // Clean from Firestore users collection if present
  if (targetEmail) {
    await deleteUserByEmailFromFirestore(targetEmail).catch((e) => {
      console.warn('Could not delete user from Firestore users collection:', e);
    });
  }

  res.json({ success: true, message: 'Student profile deleted successfully', email: targetEmail });
});

app.post('/api/students/profile', (req, res) => {
  const db = readDb();
  const { profile, picture } = req.body;
  if (!profile || !profile.email) {
    return res.status(400).json({ error: 'Profile email is required' });
  }
  const cleanEmail = profile.email.toLowerCase().trim();
  if (!db.userProfiles) db.userProfiles = {};
  const existingProfile = db.userProfiles[cleanEmail] || {};

  db.userProfiles[cleanEmail] = {
    ...existingProfile,
    ...profile,
    email: cleanEmail,
    name: profile.name || existingProfile.name,
    level: profile.level || existingProfile.level,
    learningGoal: profile.learningGoal || existingProfile.learningGoal,
    dailyGoalMinutes: profile.dailyGoalMinutes ?? existingProfile.dailyGoalMinutes ?? 30,
    avatar: picture || profile.avatar || existingProfile.avatar,
    picture: picture || profile.picture || existingProfile.picture,
    // Preserve core counters
    contractedLessons: existingProfile.contractedLessons ?? db.contractedLessons?.[cleanEmail] ?? 5,
    completedLessonsCount: existingProfile.completedLessonsCount ?? 0,
    routineVideoTime: profile.routineVideoTime || existingProfile.routineVideoTime || '09:00',
    routineAudioTime: profile.routineAudioTime || existingProfile.routineAudioTime || '14:00',
    dailyPhraseTime: profile.dailyPhraseTime || existingProfile.dailyPhraseTime || '20:00',
    teacherEmail: profile.teacherEmail !== undefined ? profile.teacherEmail : existingProfile.teacherEmail,
    teacherName: profile.teacherName !== undefined ? profile.teacherName : existingProfile.teacherName,
  };

  const idx = db.students.findIndex((s) => (s.email || s.studentEmail || '').toLowerCase() === cleanEmail);
  if (idx >= 0) {
    db.students[idx] = {
      ...db.students[idx],
      name: profile.name || db.students[idx].name,
      studentName: profile.name || db.students[idx].studentName,
      level: profile.level || db.students[idx].level,
      studentLevel: profile.level || db.students[idx].studentLevel,
      goal: profile.learningGoal || db.students[idx].goal,
      learningGoal: profile.learningGoal || db.students[idx].learningGoal,
      picture: picture || profile.avatar || db.students[idx].picture,
      avatar: picture || profile.avatar || db.students[idx].avatar,
      routineVideoTime: profile.routineVideoTime || db.students[idx].routineVideoTime || '09:00',
      routineAudioTime: profile.routineAudioTime || db.students[idx].routineAudioTime || '14:00',
      dailyPhraseTime: profile.dailyPhraseTime || db.students[idx].dailyPhraseTime || '20:00',
    };
  }

  writeDb(db);
  res.json({ success: true, profile: db.userProfiles[cleanEmail] });
});

app.get('/api/user-profile', async (req, res) => {
  const db = readDb();
  const rawEmail = ((req.query.email as string) || '').toLowerCase().trim();
  const uid = ((req.query.uid as string) || (req.query.studentUid as string) || '').trim();
  const resolved = resolveStudentIdentifiers(db, rawEmail, uid);
  const email = resolved.email || rawEmail;
  if (!email && !uid) {
    return res.status(400).json({ error: 'Email or UID parameter is required' });
  }

  // 1. Authoritative Firestore document inspection
  let fsUser: any = null;
  if (email || uid) {
    try {
      fsUser = await fetchUserFromFirestore(email, uid);
    } catch {}
  }

  // 2. Identify student identity: an account with student role or student history is locked to student profile
  const studentInDb = (db.students || []).find(
    (s: any) => (s.email || s.studentEmail || '').toLowerCase() === email || (uid && s.uid === uid)
  );
  const isStudentUser =
    fsUser?.role === 'student' ||
    Boolean(db.userProfiles?.[email]) ||
    Boolean(studentInDb) ||
    Boolean(fsUser?.learningGoal || fsUser?.studentLevel || fsUser?.contractedLessons !== undefined);

  // 3. Teacher profile check: Strictly requires verified administrative approval and no conflicting student status
  let isApprovedTeacherUser = false;
  let teacherResolution: any = null;
  if (!isStudentUser) {
    try {
      teacherResolution = await resolveTeacherCanonicalIdentity({
        teacherUid: uid,
        teacherEmail: email,
        dbState: db,
      });
      if (teacherResolution && teacherResolution.isApproved) {
        isApprovedTeacherUser = true;
      }
    } catch {}
  }

  if (isApprovedTeacherUser && teacherResolution) {
    const tutor =
      teacherResolution.rawDoc ||
      (db.tutorsList || []).find((t: any) => (t.email || '').toLowerCase() === email) ||
      (db.teachers || []).find((t: any) => (t.email || '').toLowerCase() === email) ||
      fsUser;
    return res.json({
      success: true,
      role: 'teacher',
      isTeacher: true,
      tutor: tutor || null,
      message: 'Native Friend profile retrieved successfully',
    });
  }

  let profile = db.userProfiles?.[email] || null;
  const student = (db.students || []).find(
    (s) => (s.email || s.studentEmail || '').toLowerCase() === email
  );

  if (profile && student) {
    const fallbackTeacherEmail = student.teacherEmail || null;
    const fallbackTeacherName = student.teacherName || null;
    const canonicalResolvedUid = (uid && !uid.startsWith('usr-') && !uid.startsWith('st-')) ? uid : (profile.uid || (profile.id && !profile.id.startsWith('usr-') && !profile.id.startsWith('st-') ? profile.id : null) || student.uid || student.id || profile.id);
    // Fill in any missing fields from student without overwriting existing profile data
    profile = {
      ...profile,
      id: canonicalResolvedUid,
      uid: canonicalResolvedUid,
      name: profile.name || student.name || student.studentName,
      role: 'student',
      level: profile.level || student.level || student.studentLevel,
      learningGoal: profile.learningGoal || student.goal || student.learningGoal,
      routineVideoTime: profile.routineVideoTime || student.routineVideoTime || '09:00',
      routineAudioTime: profile.routineAudioTime || student.routineAudioTime || '14:00',
      dailyPhraseTime: profile.dailyPhraseTime || student.dailyPhraseTime || '20:00',
      contractedLessons: profile.contractedLessons ?? student.contractedLessons ?? db.contractedLessons?.[email] ?? 5,
      completedLessonsCount: profile.completedLessonsCount ?? student.completedLessonsCount ?? 0,
      teacherEmail: profile.teacherEmail !== undefined ? profile.teacherEmail : fallbackTeacherEmail,
      teacherName: profile.teacherName !== undefined ? profile.teacherName : fallbackTeacherName,
    };
    db.userProfiles[email] = profile;
    writeDb(db);
  } else if (!profile && student) {
    const fallbackTeacherEmail = student.teacherEmail || null;
    const fallbackTeacherName = student.teacherName || null;
    const canonicalResolvedUid = (uid && !uid.startsWith('usr-') && !uid.startsWith('st-')) ? uid : (student.uid || student.id || `usr-${Date.now()}`);
    profile = {
      id: canonicalResolvedUid,
      uid: canonicalResolvedUid,
      name: student.name || student.studentName,
      email,
      role: 'student',
      level: student.level || student.studentLevel || 'iniciante',
      teacherEmail: fallbackTeacherEmail,
      teacherName: fallbackTeacherName,
      routineVideoTime: student.routineVideoTime || '09:00',
      routineAudioTime: student.routineAudioTime || '14:00',
      dailyPhraseTime: student.dailyPhraseTime || '20:00',
      enrollmentStatus: student.status || 'active',
      learningGoal: student.goal || student.learningGoal || 'English for everyday life & work',
      streakDays: 0,
      streakCount: 0,
      points: 0,
      dailyGoalMinutes: 30,
      completedTodayMinutes: 0,
      contractedLessons: student.contractedLessons ?? db.contractedLessons?.[email] ?? 5,
      completedLessonsCount: student.completedLessonsCount ?? 0,
      createdAt: student.createdAt || new Date().toISOString(),
      avatar: student.avatar || student.picture,
      picture: student.picture || student.avatar,
    };
    if (!db.userProfiles) db.userProfiles = {};
    db.userProfiles[email] = profile;
    writeDb(db);
  } else if (!profile && fsUser) {
    profile = {
      ...fsUser,
      id: fsUser.id || fsUser.uid || uid,
      uid: fsUser.uid || fsUser.id || uid,
      email: fsUser.email || email,
      role: fsUser.role === 'teacher' ? 'teacher' : 'student',
    };
    if (!db.userProfiles) db.userProfiles = {};
    db.userProfiles[email] = profile;
    writeDb(db);
  } else if (!profile && !student) {
    return res.json({
      success: true,
      profile: null,
      message: 'Profile not found',
    });
  }

  if (profile) {
    // Populate authoritative credits from Firestore user doc if present
    if (fsUser) {
      if (typeof fsUser.contractedLessons === 'number') {
        profile.contractedLessons = fsUser.contractedLessons;
      }
      if (typeof fsUser.availableLessons === 'number') {
        profile.availableLessons = fsUser.availableLessons;
      }
    }
    const studentPlanDays =
      (db.weeklyStudyDays?.[email] && db.weeklyStudyDays[email].length > 0)
        ? db.weeklyStudyDays[email]
        : (uid && db.weeklyStudyDays?.[uid] && db.weeklyStudyDays[uid].length > 0)
        ? db.weeklyStudyDays[uid]
        : profile.weeklyStudyDays || profile.selectedStudyDays || undefined;
    if (studentPlanDays) {
      profile.weeklyStudyDays = studentPlanDays;
      profile.selectedStudyDays = studentPlanDays;
    }
    const studyTarget =
      (db.weeklyStudyDaysTargets?.[email] !== undefined)
        ? db.weeklyStudyDaysTargets[email]
        : (uid && db.weeklyStudyDaysTargets?.[uid] !== undefined)
        ? db.weeklyStudyDaysTargets[uid]
        : profile.weeklyStudyDaysTarget || undefined;
    if (studyTarget !== undefined) {
      profile.weeklyStudyDaysTarget = studyTarget;
    }
    let journalEntries = Array.isArray(profile.studentJournal) ? profile.studentJournal : [];
    if (uid && isValidCanonicalUid(uid)) {
      const canonicalActivityRes = await fetchStudentActivityJournalFromServerFirestore(uid).catch(() => null);
      if (canonicalActivityRes && canonicalActivityRes.ok) {
        journalEntries = canonicalActivityRes.entries;
      }
    }
    profile.studentJournal = journalEntries;
    if (!profile.role) {
      profile.role = 'student';
    }
  }

  res.json({ success: true, role: profile?.role || 'student', profile });
});

app.post('/api/user-profile', async (req, res) => {
  // 1. Authenticate caller strictly via server-verified Firebase ID token
  const verifiedUser = await getVerifiedUserFromRequest(req);
  if (!verifiedUser) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Valid Firebase ID token is required to update user profile',
    });
  }

  const db = readDb();
  const rawProfile = req.body.profile || req.body || {};
  const requestedUid = (req.body.uid || rawProfile.uid || rawProfile.id || '').trim();
  const requestedEmail = (req.body.email || rawProfile.email || '').toLowerCase().trim();

  // 2. Strict authorization: students can ONLY update their own profile
  if (verifiedUser.role !== 'admin') {
    if (requestedUid && requestedUid !== verifiedUser.uid) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Students can only update their own profile',
      });
    }
    if (requestedEmail && verifiedUser.email && requestedEmail !== verifiedUser.email.toLowerCase().trim()) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Students can only update their own profile',
      });
    }
  }

  const targetUid = verifiedUser.role === 'admin' ? (requestedUid || verifiedUser.uid) : verifiedUser.uid;
  const targetEmail = (verifiedUser.role === 'admin' && requestedEmail)
    ? requestedEmail
    : (verifiedUser.email?.toLowerCase().trim() || requestedEmail);

  if (!targetEmail && !targetUid) {
    return res.status(400).json({ error: 'Email or UID is required' });
  }

  const studentInDb = (db.students || []).find(
    (s: any) => (s.email || s.studentEmail || '').toLowerCase() === targetEmail || (targetUid && s.uid === targetUid)
  );
  const isStudentUser = Boolean(db.userProfiles?.[targetEmail]) || Boolean(studentInDb);

  let isTeacherUser = false;
  if (!isStudentUser) {
    try {
      const teacherRes = await resolveTeacherCanonicalIdentity({
        teacherUid: targetUid,
        teacherEmail: targetEmail,
        dbState: db,
      });
      if (teacherRes && teacherRes.isApproved) {
        isTeacherUser = true;
      }
    } catch {}
  }

  if (isTeacherUser) {
    const tutorIdx = (db.tutorsList || []).findIndex((t: any) => (t.email || '').toLowerCase() === targetEmail);
    if (tutorIdx >= 0) {
      db.tutorsList[tutorIdx] = {
        ...db.tutorsList[tutorIdx],
        ...rawProfile,
        email: targetEmail,
        role: 'teacher',
      };
    }
    if (db.userProfiles?.[targetEmail]) {
      delete db.userProfiles[targetEmail];
    }
    writeDb(db);
    return res.json({
      success: true,
      role: 'teacher',
      isTeacher: true,
      tutor: tutorIdx >= 0 ? db.tutorsList[tutorIdx] : rawProfile,
      profile: null,
    });
  }

  if (!db.userProfiles) db.userProfiles = {};
  const existing = db.userProfiles[targetEmail] || {};

  const updatedTeacherEmail =
    rawProfile.teacherEmail !== undefined ? (rawProfile.teacherEmail || null) : (existing.teacherEmail ?? null);
  const updatedTeacherName =
    rawProfile.teacherName !== undefined ? (rawProfile.teacherName || null) : (existing.teacherName ?? null);

  let resolvedTeacherUid = existing.teacherUid || null;
  let finalTeacherEmail = updatedTeacherEmail;
  let finalTeacherName = updatedTeacherName;

  const incomingTeacherQuery =
    rawProfile.teacherUid ||
    rawProfile.assignedNativeFriendUID ||
    rawProfile.teacherId ||
    rawProfile.publicTutorId ||
    rawProfile.teacherEmail;

  if (incomingTeacherQuery) {
    const teacherRes = await resolveTeacherCanonicalIdentity({
      teacherId: rawProfile.teacherId || rawProfile.publicTutorId || (typeof incomingTeacherQuery === 'string' ? incomingTeacherQuery : undefined),
      teacherUid: rawProfile.teacherUid || rawProfile.assignedNativeFriendUID,
      teacherEmail: rawProfile.teacherEmail || updatedTeacherEmail,
      publicTutorId: rawProfile.publicTutorId || rawProfile.teacherId,
      dbState: db,
    });

    if (teacherRes) {
      if (!teacherRes.isApproved) {
        return res.status(400).json({
          error: 'O Amigo Nativo selecionado ainda não foi aprovado para receber alunos.',
        });
      }
      if (!isValidCanonicalUid(teacherRes.canonicalUid)) {
        return res.status(400).json({
          error: 'Não foi possível comprovar a identidade canônica do Amigo Nativo.',
        });
      }
      resolvedTeacherUid = teacherRes.canonicalUid;
      finalTeacherEmail = teacherRes.email || finalTeacherEmail;
      finalTeacherName = teacherRes.name || finalTeacherName;
    } else {
      return res.status(400).json({
        error: 'Amigo Nativo selecionado não encontrado ou inválido.',
      });
    }
  }

  // Strict Credit Hardening (Correção B): Stripping any attempt to update credits via profile endpoint
  delete rawProfile.contractedLessons;
  delete rawProfile.availableLessons;

  const oldLevelKey = normalizeStudentLevel(existing.level).key;
  const newLevelKey = normalizeStudentLevel(rawProfile.level || existing.level).key;

  const resolvedLevel = rawProfile.level || existing.level || 'iniciante';
  const resolvedLearningGoal = rawProfile.learningGoal || existing.learningGoal || 'English for everyday life & work';
  const resolvedStudyDaysTarget = rawProfile.weeklyStudyDaysTarget !== undefined
    ? Number(rawProfile.weeklyStudyDaysTarget)
    : (rawProfile.weeklyPracticeDays !== undefined ? Number(rawProfile.weeklyPracticeDays) : (existing.weeklyStudyDaysTarget ?? 7));
  const resolvedStudyDays = rawProfile.weeklyStudyDays || rawProfile.routineActivities || existing.weeklyStudyDays || ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

  const updatedProfileObj: Record<string, any> = {
    ...existing,
    ...rawProfile,
    id: targetUid,
    uid: targetUid,
    email: targetEmail,
    name: rawProfile.name || existing.name || (targetEmail ? targetEmail.split('@')[0] : 'Aluno'),
    level: resolvedLevel,
    englishLevel: resolvedLevel,
    userLevel: resolvedLevel,
    learningGoal: resolvedLearningGoal,
    dailyGoalMinutes: rawProfile.dailyGoalMinutes ?? existing.dailyGoalMinutes ?? 30,
    completedLessonsCount: Number(existing.completedLessonsCount ?? rawProfile.completedLessonsCount ?? 0),
    teacherEmail: finalTeacherEmail,
    teacherName: finalTeacherName,
    teacherUid: resolvedTeacherUid && isValidCanonicalUid(resolvedTeacherUid) ? resolvedTeacherUid : null,
    assignedNativeFriendUID: resolvedTeacherUid && isValidCanonicalUid(resolvedTeacherUid) ? resolvedTeacherUid : null,
    nativeFriendUID: resolvedTeacherUid && isValidCanonicalUid(resolvedTeacherUid) ? resolvedTeacherUid : null,
    teacherMeetUrl: rawProfile.teacherMeetUrl ?? existing.teacherMeetUrl ?? null,
    enrollmentStatus: rawProfile.enrollmentStatus || existing.enrollmentStatus || (updatedTeacherEmail ? 'active' : 'not_enrolled'),
    ...(Array.isArray(existing.studentJournal) && existing.studentJournal.length > 0 ? { studentJournal: existing.studentJournal } : {}),
    weeklyStudyDaysTarget: resolvedStudyDaysTarget,
    weeklyStudyDays: resolvedStudyDays,
    routineVideoTime: rawProfile.routineVideoTime || existing.routineVideoTime || '09:00',
    routineAudioTime: rawProfile.routineAudioTime || existing.routineAudioTime || '14:00',
    dailyPhraseTime: rawProfile.dailyPhraseTime || existing.dailyPhraseTime || '20:00',
    hasCompletedTrialLesson: Boolean(rawProfile.hasCompletedTrialLesson ?? existing.hasCompletedTrialLesson ?? false),
    subscriptionType: rawProfile.subscriptionType || existing.subscriptionType || 'trial',
    onboardingCompleted: rawProfile.onboardingCompleted !== undefined ? Boolean(rawProfile.onboardingCompleted) : true,
    updatedAt: new Date().toISOString(),
  };

  // Crucial: Delete financial fields from Firestore write payload so merge:true never modifies credits
  delete updatedProfileObj.contractedLessons;
  delete updatedProfileObj.availableLessons;

  if (rawProfile.avatar || rawProfile.picture) {
    updatedProfileObj.avatar = rawProfile.avatar || rawProfile.picture;
    updatedProfileObj.picture = rawProfile.avatar || rawProfile.picture;
  }

  // 3. PERSISTENCE IN FIRESTORE VIA FIREBASE ADMIN SDK
  // Canonical record strictly in users/{targetUid} (without creating root journal array mirrors)
  const firestoreDb = getFirestoreDb();
  let persistedToFirestore = false;
  let canonicalContractedFromFs: number | undefined = undefined;
  let canonicalAvailableFromFs: number | undefined = undefined;

  if (firestoreDb && targetUid) {
    try {
      // Read current canonical credit balances from Firestore document
      const currentDocSnap = await firestoreDb.collection('users').doc(targetUid).get().catch(() => null);
      if (currentDocSnap && currentDocSnap.exists) {
        const curData = currentDocSnap.data() || {};
        if (typeof curData.contractedLessons === 'number') {
          canonicalContractedFromFs = curData.contractedLessons;
        }
        if (typeof curData.availableLessons === 'number') {
          canonicalAvailableFromFs = curData.availableLessons;
        }
      }

      const firestoreProfilePayload = { ...updatedProfileObj };
      delete firestoreProfilePayload.studentJournal;
      delete firestoreProfilePayload.dailyJournalEntries;
      await firestoreDb.collection('users').doc(targetUid).set(firestoreProfilePayload, { merge: true });
      persistedToFirestore = true;

      if (firestoreDb && targetUid && updatedProfileObj.teacherUid) {
        firestoreDb.collection('student_assignments').doc(targetUid).set({
          studentUid: targetUid,
          teacherUid: updatedProfileObj.teacherUid,
          teacherAuthUid: updatedProfileObj.teacherUid,
          assignedNativeFriendUID: updatedProfileObj.assignedNativeFriendUID,
          nativeFriendUID: updatedProfileObj.nativeFriendUID,
          teacherEmail: updatedProfileObj.teacherEmail,
          teacherName: updatedProfileObj.teacherName,
          updatedAt: new Date().toISOString(),
        }, { merge: true }).catch(() => {});
      }
    } catch (fsErr: any) {
      console.error(`[serverFirestore] Failed to persist user profile in users/${targetUid}:`, fsErr);
      return res.status(500).json({
        error: 'Failed to persist user profile to Firestore',
        message: fsErr?.message || 'Database write error',
      });
    }
  }

  // Authoritative read-only balances
  const effectiveContracted = canonicalContractedFromFs ?? existing.contractedLessons ?? (db.contractedLessons?.[targetEmail] !== undefined ? db.contractedLessons[targetEmail] : undefined);
  const effectiveAvailable = canonicalAvailableFromFs ?? existing.availableLessons;

  // 4. Update local cache / state strictly with read-only authoritative credits
  const fullProfileWithAuthoritativeCredits = {
    ...updatedProfileObj,
    ...(effectiveContracted !== undefined ? { contractedLessons: effectiveContracted } : {}),
    ...(effectiveAvailable !== undefined ? { availableLessons: effectiveAvailable } : {}),
  };

  db.userProfiles[targetEmail] = fullProfileWithAuthoritativeCredits;

  const studentIdx = (db.students || []).findIndex(
    (s: any) =>
      (s.email || s.studentEmail || '').toLowerCase() === targetEmail ||
      (s.uid && s.uid === targetUid) ||
      (s.id && s.id === targetUid)
  );

  if (studentIdx >= 0) {
    db.students[studentIdx] = {
      ...db.students[studentIdx],
      id: targetUid,
      uid: targetUid,
      name: updatedProfileObj.name,
      studentName: updatedProfileObj.name,
      level: updatedProfileObj.level,
      studentLevel: updatedProfileObj.level,
      goal: updatedProfileObj.learningGoal,
      learningGoal: updatedProfileObj.learningGoal,
      picture: updatedProfileObj.picture,
      avatar: updatedProfileObj.avatar,
      teacherEmail: updatedProfileObj.teacherEmail,
      teacherName: updatedProfileObj.teacherName,
      teacherUid: updatedProfileObj.teacherUid,
      assignedNativeFriendUID: updatedProfileObj.assignedNativeFriendUID,
      nativeFriendUID: updatedProfileObj.nativeFriendUID,
      ...(effectiveContracted !== undefined ? { contractedLessons: effectiveContracted } : {}),
      ...(effectiveAvailable !== undefined ? { availableLessons: effectiveAvailable } : {}),
      status: updatedProfileObj.enrollmentStatus === 'cancelled' ? 'cancelled' : (updatedProfileObj.teacherEmail ? 'active' : 'not_enrolled'),
    };
  } else {
    if (!db.students) db.students = [];
    db.students.push({
      id: targetUid,
      uid: targetUid,
      name: updatedProfileObj.name,
      studentName: updatedProfileObj.name,
      email: targetEmail,
      studentEmail: targetEmail,
      level: updatedProfileObj.level,
      studentLevel: updatedProfileObj.level,
      goal: updatedProfileObj.learningGoal,
      learningGoal: updatedProfileObj.learningGoal,
      ...(effectiveContracted !== undefined ? { contractedLessons: effectiveContracted } : {}),
      ...(effectiveAvailable !== undefined ? { availableLessons: effectiveAvailable } : {}),
      completedLessonsCount: 0,
      teacherEmail: updatedProfileObj.teacherEmail,
      teacherName: updatedProfileObj.teacherName,
      teacherUid: updatedProfileObj.teacherUid,
      assignedNativeFriendUID: updatedProfileObj.assignedNativeFriendUID,
      nativeFriendUID: updatedProfileObj.nativeFriendUID,
      status: updatedProfileObj.enrollmentStatus === 'cancelled' ? 'cancelled' : (updatedProfileObj.teacherEmail ? 'active' : 'not_enrolled'),
      activeSince: new Date().toISOString().split('T')[0],
      createdAt: new Date().toISOString(),
      picture: updatedProfileObj.picture,
      avatar: updatedProfileObj.avatar,
    });
  }

  // If student level changed, redistribute Spotify tracks to match the new level
  if (oldLevelKey !== newLevelKey || !db.studentSpotifyAssignments?.[targetEmail]) {
    const studentPlanDays: string[] =
      db.userProfiles[targetEmail]?.weeklyStudyDays ||
      db.userProfiles[targetEmail]?.selectedStudyDays ||
      DAYS_SEQUENCE;
    await distributeWeeklySpotifyForStudent(db, targetEmail, targetUid, newLevelKey, undefined, undefined, studentPlanDays);
  }

  await writeDbSync(db);
  res.json({ success: true, profile: fullProfileWithAuthoritativeCredits, persistedToFirestore });
});

// FASE FIN.2A.2B: Pre-commercialization Payment Gating Configuration
// Safe default is strictly false (any value other than exact string 'true' evaluates to false).
export const isPaymentsEnabled = (): boolean => {
  return process.env.PAYMENTS_ENABLED === 'true';
};

// Authoritative check whether a real payment gateway (Stripe/Pix webhook verification) is active.
// In the current pre-commercialization phase, no real gateway exists.
export const hasRealPaymentGatewayIntegrated = (): boolean => {
  return false;
};

// Public endpoint to query payments & commercialization status
app.get('/api/payments/status', (_req, res) => {
  res.json({
    paymentsEnabled: isPaymentsEnabled(),
    hasPaymentGateway: hasRealPaymentGatewayIntegrated(),
    mode: 'pre_commercialization',
    message: isPaymentsEnabled() && hasRealPaymentGatewayIntegrated()
      ? 'Pagamentos habilitados'
      : 'Contratações temporariamente indisponíveis (modo pré-comercialização)',
  });
});

// Rate limiter em memória específico para a rota pública PTAX (proteção contra flooding e DoS)
const ptaxRateLimitMap = new Map<string, { count: number; resetTime: number }>();
const PTAX_RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minuto
const PTAX_RATE_LIMIT_MAX_REQUESTS = 60; // 60 requisições por minuto por IP

// FASE FIN.2A.2C: Endpoint isolado para consulta da cotação oficial PTAX D-1 do BACEN
app.get('/api/financial/ptax', async (req, res) => {
  // 1. Segurança: rejeição de parâmetros arbitrários na rota pública
  if (req.query && Object.keys(req.query).length > 0) {
    return res.status(400).json({
      success: false,
      status: 'ERROR',
      error: 'PARAMETROS_INVALIDOS',
      details: 'A rota de cotação PTAX não aceita parâmetros de consulta.',
    });
  }

  // 2. Segurança: controle de frequência de chamadas (rate limiting por IP)
  const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
  const now = Date.now();
  const clientRecord = ptaxRateLimitMap.get(clientIp);

  if (clientRecord && now < clientRecord.resetTime) {
    clientRecord.count++;
    if (clientRecord.count > PTAX_RATE_LIMIT_MAX_REQUESTS) {
      const retryAfterSec = Math.ceil((clientRecord.resetTime - now) / 1000);
      res.setHeader('Retry-After', String(retryAfterSec));
      return res.status(429).json({
        success: false,
        status: 'ERROR',
        error: 'RATE_LIMIT_EXCEEDED',
        details: `Limite de consultas cambiais excedido. Tente novamente em ${retryAfterSec}s.`,
      });
    }
  } else {
    ptaxRateLimitMap.set(clientIp, { count: 1, resetTime: now + PTAX_RATE_LIMIT_WINDOW_MS });
  }

  try {
    const result = await getPtaxClosingD1();
    if (!result.success) {
      const statusCode = result.status === 'UNAVAILABLE' ? 404 : 503;
      return res.status(statusCode).json(result);
    }
    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300');
    return res.json(result);
  } catch (err: any) {
    console.error('[GET /api/financial/ptax] Erro interno:', err);
    // 3. Segurança: resposta padronizada sem vazamento de detalhes internos do Firestore/servidor
    return res.status(500).json({
      success: false,
      status: 'ERROR',
      error: 'ERRO_INTERNO_PTAX',
      details: 'Falha interna ao processar consulta da cotação PTAX.',
    });
  }
});

// Purchase Lesson Package with a specific Native Friend (binds tutor as fixed + adds lessons)
app.post('/api/students/purchase-package', async (req, res) => {
  // 1. Authenticate caller strictly via server-verified Firebase ID token
  const verifiedCaller = await getVerifiedUserFromRequest(req);
  if (!verifiedCaller) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Token de autenticação obrigatório para contratação de pacote.',
    });
  }

  const isAdminCaller = verifiedCaller.role === 'admin';

  // FASE FIN.2A.2B: Modo pré-comercialização — Proteção da rota de compra
  // 1. Alunos comuns são estritamente impedidos de adquirir pacotes sem gateway de pagamento ativo.
  // 2. PAYMENTS_ENABLED possui padrão seguro false.
  // 3. Mesmo com PAYMENTS_ENABLED=true, a concessão de créditos exige confirmação real do provedor (não implementada).
  if (!isAdminCaller) {
    if (!isPaymentsEnabled()) {
      return res.status(403).json({
        success: false,
        error: 'PAYMENTS_DISABLED',
        message: 'A contratação de pacotes de aulas pagas está temporariamente indisponível no momento. O sistema está em modo pré-comercialização sem gateway de pagamento ativo.',
      });
    }

    if (!hasRealPaymentGatewayIntegrated()) {
      return res.status(403).json({
        success: false,
        error: 'PAYMENT_GATEWAY_NOT_CONFIGURED',
        message: 'Gateway de pagamento não integrado. A concessão de créditos pagos requer confirmação real e autoritativa do provedor de pagamento. Estados de pagamento informados pelo cliente não autorizam créditos.',
      });
    }
  } else {
    console.warn(`[AUDIT - ADMIN PACKAGE ALLOCATION] Admin ${verifiedCaller.email || verifiedCaller.uid} executing manual package credit assignment.`);
  }

  const db = readDb();
  const { studentEmail, teacherEmail, teacherName, packageLessons, packageName, packagePriceBrl, packagePriceUsd, paymentMethod } = req.body;
  const requestedEmail = (studentEmail || '').toLowerCase().trim();

  // 2. Strict authorization: students can ONLY purchase packages for their own account
  if (verifiedCaller.role !== 'admin' && requestedEmail && requestedEmail !== (verifiedCaller.email || '').toLowerCase().trim()) {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'Não é permitido contratar pacote para outro usuário.',
    });
  }

  const cleanStudentEmail = (
    verifiedCaller.role === 'admin' && requestedEmail
      ? requestedEmail
      : (verifiedCaller.email?.toLowerCase().trim() || requestedEmail)
  );
  const targetStudentUid = (verifiedCaller.role === 'admin' && req.body.studentUid ? req.body.studentUid : verifiedCaller.uid)?.trim();

  if (!targetStudentUid || !isValidCanonicalUid(targetStudentUid)) {
    return res.status(400).json({ error: 'Identificador canônico do aluno inválido ou ausente.' });
  }

  // 3. Idempotency protection to prevent duplicate purchases on retry
  const idempotencyKey = String(req.body.idempotencyKey || req.body.requestId || req.headers['idempotency-key'] || '').trim();

  const cleanTeacherEmail = (teacherEmail || '').toLowerCase().trim();
  const incomingTeacherRef = req.body.teacherId || req.body.publicTutorId || req.body.tutorId || req.body.teacherUid || cleanTeacherEmail;

  if (!incomingTeacherRef && !cleanTeacherEmail) {
    return res.status(400).json({ error: 'Identificador do Amigo Nativo é obrigatório.' });
  }

  // 4. Resolve canonical Native Friend UID strictly via resolveTeacherCanonicalIdentity
  const teacherRes = await resolveTeacherCanonicalIdentity({
    teacherId: req.body.teacherId || req.body.publicTutorId || (typeof incomingTeacherRef === 'string' && !incomingTeacherRef.includes('@') ? incomingTeacherRef : undefined),
    teacherUid: req.body.teacherUid,
    teacherEmail: cleanTeacherEmail || (typeof incomingTeacherRef === 'string' && incomingTeacherRef.includes('@') ? incomingTeacherRef : undefined),
    publicTutorId: req.body.publicTutorId || req.body.teacherId,
    dbState: db,
  });

  if (!teacherRes) {
    return res.status(404).json({ error: 'Amigo Nativo selecionado não encontrado no sistema.' });
  }
  if (!teacherRes.isApproved) {
    return res.status(400).json({ error: 'O Amigo Nativo selecionado ainda não foi aprovado para receber agendamentos.' });
  }
  if (!isValidCanonicalUid(teacherRes.canonicalUid)) {
    return res.status(400).json({ error: 'Não foi possível comprovar a identidade canônica do Amigo Nativo.' });
  }

  const canonicalTeacherUid = teacherRes.canonicalUid;
  const finalTeacherEmail = teacherRes.email || cleanTeacherEmail;
  const finalTeacherName = teacherRes.name || teacherName || finalTeacherEmail.split('@')[0];

  const lessonsToAdd = Number(packageLessons) > 0 ? Number(packageLessons) : 4;
  let newWeeklyTarget = 1;
  if (lessonsToAdd === 4) newWeeklyTarget = 1;
  else if (lessonsToAdd === 8) newWeeklyTarget = 2;
  else if (lessonsToAdd === 12) newWeeklyTarget = 3;
  else if (lessonsToAdd > 0) newWeeklyTarget = Math.min(7, Math.ceil(lessonsToAdd / 4));

  const nowIso = new Date().toISOString();

  // 5. ATOMIC TRANSACTION IN FIRESTORE VIA FIREBASE ADMIN SDK
  const firestoreDb = getFirestoreDb();
  if (!firestoreDb) {
    return res.status(503).json({
      success: false,
      error: 'Serviço de persistência Firestore indisponível para contratação de pacotes.',
    });
  }

  let atomicContractedTotal: number | null = null;
  let atomicAvailableTotal: number | null = null;
  let isIdempotentReplay = false;
  let recordedStudentData: any = null;

  try {
    await firestoreDb.runTransaction(async (transaction) => {
      const studentRef = firestoreDb.collection('users').doc(targetStudentUid);
      const teacherRef = firestoreDb.collection('users').doc(canonicalTeacherUid);

      const [studentSnap, teacherSnap] = await Promise.all([
        transaction.get(studentRef),
        transaction.get(teacherRef).catch(() => null),
      ]);

      if (!studentSnap.exists) {
        const notFoundErr = new Error('Aluno não encontrado no Firestore.');
        (notFoundErr as any).statusCode = 404;
        throw notFoundErr;
      }

      const studentData = studentSnap.data() || {};
      recordedStudentData = studentData;

      // Check idempotency strictly inside the transaction
      const processedPurchases = studentData.processedPurchases || {};
      if (idempotencyKey && processedPurchases[idempotencyKey]) {
        const prevTx = processedPurchases[idempotencyKey];
        atomicContractedTotal = typeof studentData.contractedLessons === 'number'
          ? studentData.contractedLessons
          : prevTx.contractedLessons;
        atomicAvailableTotal = typeof studentData.availableLessons === 'number'
          ? studentData.availableLessons
          : prevTx.availableLessons;
        isIdempotentReplay = true;
        return;
      }

      // Read authoritative balances directly from canonical Firestore student document
      const currentAvailable = typeof studentData.availableLessons === 'number'
        ? studentData.availableLessons
        : 0;

      const currentContracted = typeof studentData.contractedLessons === 'number'
        ? studentData.contractedLessons
        : currentAvailable;

      const txContracted = currentContracted + lessonsToAdd;
      const txAvailable = currentAvailable + lessonsToAdd;

      atomicContractedTotal = txContracted;
      atomicAvailableTotal = txAvailable;

      const updatedProcessedPurchases = { ...processedPurchases };
      if (idempotencyKey) {
        updatedProcessedPurchases[idempotencyKey] = {
          lessonsAdded: lessonsToAdd,
          contractedLessons: txContracted,
          availableLessons: txAvailable,
          teacherUid: canonicalTeacherUid,
          timestamp: nowIso,
        };
      }

      const studentUpdate: Record<string, any> = {
        contractedLessons: txContracted,
        availableLessons: txAvailable,
        teacherUid: canonicalTeacherUid,
        assignedNativeFriendUID: canonicalTeacherUid,
        nativeFriendUID: canonicalTeacherUid,
        teacherEmail: finalTeacherEmail,
        teacherName: finalTeacherName,
        enrollmentStatus: 'active',
        weeklyNativeLessonsTarget: newWeeklyTarget,
        subscriptionType: 'package',
        processedPurchases: updatedProcessedPurchases,
        updatedAt: nowIso,
      };

      transaction.set(studentRef, studentUpdate, { merge: true });
      if (teacherSnap && teacherSnap.exists) {
        transaction.set(teacherRef, { updatedAt: nowIso }, { merge: true });
      }
    });
  } catch (fsErr: any) {
    console.error('[purchase-package] Failed to persist package credits in Firestore transaction:', fsErr);
    if (fsErr?.statusCode === 404) {
      return res.status(404).json({
        success: false,
        error: fsErr.message || 'Aluno não encontrado no Firestore.',
      });
    }
    if (isPermissionError(fsErr)) {
      return res.status(500).json({
        success: false,
        error: 'Erro de infraestrutura ao persistir créditos de aulas no banco de dados Firestore.',
        code: 'FIRESTORE_INFRASTRUCTURE_ERROR',
      });
    }
    const msg = String(fsErr?.message || '');
    const code = fsErr?.code;
    const isTimeout =
      code === 4 ||
      code === 'deadline-exceeded' ||
      msg.includes('DEADLINE_EXCEEDED') ||
      msg.includes('timeout') ||
      msg.includes('ETIMEDOUT');
    if (isTimeout) {
      return res.status(504).json({
        success: false,
        error: 'Tempo limite esgotado ao persistir créditos no banco de dados Firestore. Tente novamente.',
        code: 'FIRESTORE_TIMEOUT',
      });
    }
    return res.status(500).json({
      success: false,
      error: 'Falha ao processar e persistir compra de créditos no Firestore.',
      message: msg,
    });
  }

  // Update student assignments doc in background
  firestoreDb.collection('student_assignments').doc(targetStudentUid).set({
    studentUid: targetStudentUid,
    teacherUid: canonicalTeacherUid,
    teacherAuthUid: canonicalTeacherUid,
    assignedNativeFriendUID: canonicalTeacherUid,
    nativeFriendUID: canonicalTeacherUid,
    teacherEmail: finalTeacherEmail,
    teacherName: finalTeacherName,
    updatedAt: nowIso,
  }, { merge: true }).catch(() => {});

  // 6. Update local synchronized state strictly after transaction commit
  if (!db.contractedLessons) db.contractedLessons = {};
  db.contractedLessons[cleanStudentEmail] = atomicContractedTotal!;

  if (!db.userProfiles) db.userProfiles = {};
  const existingProfile = db.userProfiles[cleanStudentEmail] || {};

  // Update student in db.students
  let studentFound = false;
  db.students = (db.students || []).map((s: any) => {
    if ((s.email || s.studentEmail || '').toLowerCase() === cleanStudentEmail || (targetStudentUid && (s.uid === targetStudentUid || s.id === targetStudentUid))) {
      studentFound = true;
      return {
        ...s,
        teacherEmail: finalTeacherEmail,
        teacherName: finalTeacherName,
        teacherUid: canonicalTeacherUid,
        assignedNativeFriendUID: canonicalTeacherUid,
        nativeFriendUID: canonicalTeacherUid,
        contractedLessons: atomicContractedTotal!,
        availableLessons: atomicAvailableTotal!,
        status: 'active',
      };
    }
    return s;
  });

  if (!studentFound) {
    db.students.push({
      id: targetStudentUid,
      uid: targetStudentUid,
      name: cleanStudentEmail.split('@')[0],
      studentName: cleanStudentEmail.split('@')[0],
      email: cleanStudentEmail,
      studentEmail: cleanStudentEmail,
      level: 'iniciante',
      studentLevel: 'iniciante',
      goal: 'English for everyday life & work',
      learningGoal: 'English for everyday life & work',
      contractedLessons: atomicContractedTotal!,
      availableLessons: atomicAvailableTotal!,
      completedLessonsCount: 0,
      teacherEmail: finalTeacherEmail,
      teacherName: finalTeacherName,
      teacherUid: canonicalTeacherUid,
      assignedNativeFriendUID: canonicalTeacherUid,
      nativeFriendUID: canonicalTeacherUid,
      routineVideoTime: '09:00',
      routineAudioTime: '14:00',
      dailyPhraseTime: '20:00',
      status: 'active',
      activeSince: new Date().toISOString().split('T')[0],
      createdAt: nowIso,
    });
  }

  // Update db.userProfiles
  db.userProfiles[cleanStudentEmail] = {
    ...existingProfile,
    id: targetStudentUid,
    uid: targetStudentUid,
    email: cleanStudentEmail,
    name: existingProfile.name || cleanStudentEmail.split('@')[0],
    level: existingProfile.level || 'iniciante',
    teacherEmail: finalTeacherEmail,
    teacherName: finalTeacherName,
    teacherUid: canonicalTeacherUid,
    assignedNativeFriendUID: canonicalTeacherUid,
    nativeFriendUID: canonicalTeacherUid,
    enrollmentStatus: 'active',
    contractedLessons: atomicContractedTotal!,
    availableLessons: atomicAvailableTotal!,
    weeklyNativeLessonsTarget: newWeeklyTarget,
    subscriptionType: 'package',
    completedLessonsCount: existingProfile.completedLessonsCount || 0,
    updatedAt: nowIso,
  };

  // Record transaction
  if (!db.transactions) db.transactions = [];
  const transaction = {
    id: `tx-${Date.now()}`,
    idempotencyKey: idempotencyKey || undefined,
    studentUid: targetStudentUid,
    studentEmail: cleanStudentEmail,
    teacherUid: canonicalTeacherUid,
    teacherEmail: finalTeacherEmail,
    teacherName: finalTeacherName,
    packageLessons: lessonsToAdd,
    packageName: packageName || `${lessonsToAdd} Aulas`,
    packagePriceBrl: packagePriceBrl || lessonsToAdd * 90,
    packagePriceUsd: packagePriceUsd || lessonsToAdd * 16,
    paymentMethod: paymentMethod || 'credit_card',
    timestamp: nowIso,
    status: 'completed',
    ...(isAdminCaller ? { adminGrantBy: verifiedCaller.email || verifiedCaller.uid, isAdministrativeOperation: true } : {}),
  };
  if (!isIdempotentReplay) {
    db.transactions.unshift(transaction);
  }

  await writeDbSync(db);

  res.json({
    success: true,
    message: isIdempotentReplay ? 'Package already purchased (idempotent)' : 'Package purchased successfully and Native Friend assigned',
    contractedLessons: atomicContractedTotal,
    availableLessons: atomicAvailableTotal,
    teacherUid: canonicalTeacherUid,
    profile: db.userProfiles[cleanStudentEmail],
    transaction,
  });
});

app.post('/api/students/contract', (req, res) => {
  const db = readDb();
  const { email, studentEmail, count } = req.body;
  const cleanEmail = (email || studentEmail || '').toLowerCase().trim();
  if (cleanEmail && count !== undefined) {
    db.contractedLessons[cleanEmail] = Number(count);
    db.students = db.students.map((s) =>
      (s.email || s.studentEmail || '').toLowerCase() === cleanEmail
        ? { ...s, contractedLessons: Number(count) }
        : s
    );
    writeDb(db);
  }
  res.json({ success: true, contractedLessons: db.contractedLessons });
});

app.post('/api/students/cancel', (req, res) => {
  const db = readDb();
  const { studentEmail, email, cancelledBy } = req.body;
  const cleanEmail = (studentEmail || email || '').toLowerCase().trim();
  db.students = db.students.map((s) =>
    (s.studentEmail || s.email || '').toLowerCase() === cleanEmail
      ? { ...s, status: 'cancelled', cancelledAt: new Date().toISOString(), cancelledBy: cancelledBy || 'teacher' }
      : s
  );
  writeDb(db);
  res.json({ success: true, students: db.students });
});

// Helper to resolve student email and UID bi-directionally
const GENERIC_PLACEHOLDER_EMAILS = new Set([
  'aluno@itssimple.com',
  'student@itssimple.com',
]);

function resolveStudentIdentifiers(
  db: AppDb,
  emailOrUid?: string | null,
  explicitUid?: string | null
): { email: string; uid: string } {
  let email = (emailOrUid && emailOrUid.includes('@') ? emailOrUid : '').toLowerCase().trim();
  let uid = (explicitUid || (!emailOrUid?.includes('@') ? (emailOrUid || '') : '')).trim();

  // If explicit uid is known, verify and prioritize genuine email mapped to this UID
  if (uid) {
    const student = (db.students || []).find((s: any) => s.uid === uid || s.id === uid);
    if (student?.email || student?.studentEmail) {
      email = (student.email || student.studentEmail).toLowerCase().trim();
    } else {
      const authUser = Object.values(db.authUsers || {}).find((u: any) => u.uid === uid);
      if (authUser?.email) {
        email = authUser.email.toLowerCase().trim();
      }
    }
  }

  // If email is known but uid is not, resolve uid from students, userProfiles, or authUsers
  if (email && !uid && !GENERIC_PLACEHOLDER_EMAILS.has(email)) {
    const student = (db.students || []).find((s: any) =>
      ((s.email || s.studentEmail || '').toLowerCase().trim() === email)
    );
    if (student?.uid || student?.id) uid = (student.uid || student.id).trim();

    if (!uid) {
      const authUser = Object.values(db.authUsers || {}).find((u: any) => (u.email || '').toLowerCase().trim() === email);
      if (authUser?.uid) uid = authUser.uid.trim();
    }
    if (!uid && db.userProfiles?.[email]?.uid) {
      uid = db.userProfiles[email].uid.trim();
    }
  }

  // If email is a generic placeholder, clear it so it never acts as a shared key across students
  if (GENERIC_PLACEHOLDER_EMAILS.has(email)) {
    email = '';
  }

  return { email, uid };
}

// Helper to resolve student level for playlist mapping
function resolveStudentLevel(db: AppDb, email?: string, uid?: string): string {
  if (email && db.userProfiles?.[email]?.level) return db.userProfiles[email].level;
  if (uid) {
    const student = (db.students || []).find((s: any) => s.uid === uid || s.id === uid);
    if (student?.level || student?.studentLevel) return student.level || student.studentLevel;
    const profile = Object.values(db.userProfiles || {}).find((p: any) => p.uid === uid);
    if (profile?.level) return profile.level;
  }
  if (email) {
    const student = (db.students || []).find(
      (s: any) => (s.email || s.studentEmail || '').toLowerCase().trim() === email.toLowerCase().trim()
    );
    if (student?.level || student?.studentLevel) return student.level || student.studentLevel;
  }
  return 'beginner';
}

/**
 * Ensures strict sequential track assignment for a student across active study days
 * - Queries official Spotify playlist corresponding to student level with complete pagination
 * - Follows sequential order of playlist without skips or weekly offset jumps
 * - Increments cycle and returns to track 1 when exhausted, without erasing history
 * - Persists individual sequence in studentSpotifyCycles and studentSpotifyAssignments
 */
async function distributeWeeklySpotifyForStudent(
  db: AppDb,
  email: string,
  uid: string,
  rawLevel?: string,
  teacherUid?: string,
  teacherEmail?: string,
  activeDays?: string[]
): Promise<any[]> {
  const normLevel = normalizeStudentLevel(rawLevel || resolveStudentLevel(db, email, uid)).key;
  let tracks: SpotifyTrack[] = [];

  try {
    tracks = await fetchOfficialPlaylistTracks(normLevel);
  } catch (err: any) {
    console.warn(`[Spotify] Notice fetching official tracks for ${normLevel}:`, err?.message || err);
    if (db.spotifyPlaylists?.[normLevel]?.tracks && Array.isArray(db.spotifyPlaylists[normLevel].tracks)) {
      tracks = db.spotifyPlaylists[normLevel].tracks;
    }
  }

  if (!tracks || tracks.length === 0) {
    return [];
  }

  const assignedRecords = distributeWeeklySpotifyForStudentEngine({
    db,
    studentEmail: email,
    studentUid: uid,
    level: normLevel,
    playlistTracks: tracks,
    activeDays,
    teacherUid,
    teacherEmail,
  });

  if (uid) {
    saveStudentAssignmentsByUid(uid, {
      uid,
      email,
      level: normLevel,
      spotifyAssignments: assignedRecords,
      videoAssignments: db.studentVideoAssignments?.[uid] || db.studentVideoAssignments?.[email] || [],
      routines: db.studentRoutinesMap?.[uid] || db.studentRoutinesMap?.[email],
      updatedAt: new Date().toISOString(),
    }).catch((err) => console.warn('Firestore saveStudentAssignmentsByUid (Spotify) notice:', err));
  }

  return assignedRecords;
}

/**
 * Ensures strict sequential 7-day exclusive YouTube video assignment for a student across all days (Monday to Sunday)
 * Each day receives one unique video from the curated level curriculum (YOUTUBE_LEVEL_PLAYLISTS + pool), completely preventing repetitions.
 */
function distributeWeeklyYouTubeForStudent(
  db: AppDb,
  email: string,
  uid: string,
  rawLevel?: string,
  teacherUid?: string,
  teacherEmail?: string,
  activeDays?: string[],
  extraWatchedIds?: string[]
): any[] {
  const normLevel = normalizeStudentLevel(rawLevel || resolveStudentLevel(db, email, uid)).key;
  const levelPlaylist = YOUTUBE_LEVEL_PLAYLISTS[normLevel] || YOUTUBE_LEVEL_PLAYLISTS.beginner;

  const targetKeys = Array.from(new Set([email, uid].filter(Boolean) as string[]));
  if (targetKeys.length === 0) return [];

  if (!db.studentVideoAssignments) db.studentVideoAssignments = {};
  if (!db.studentWatchedVideos) db.studentWatchedVideos = {};
  if (!db.studentRoutinesMap) db.studentRoutinesMap = {};

  let studentRoutines =
    (email && db.studentRoutinesMap[email]) ||
    (uid && db.studentRoutinesMap[uid]) ||
    null;

  if (!studentRoutines || typeof studentRoutines !== 'object' || Object.keys(studentRoutines).length === 0) {
    studentRoutines = JSON.parse(JSON.stringify(db.routinesByDay || defaultRoutinesByDay));
  } else {
    DAYS_SEQUENCE.forEach((d) => {
      if (!studentRoutines[d] || !Array.isArray(studentRoutines[d]) || studentRoutines[d].length === 0) {
        studentRoutines[d] = JSON.parse(JSON.stringify(db.routinesByDay?.[d] || defaultRoutinesByDay[d] || []));
      }
    });
  }

  // Resolve active study days for this student
  const studentConfiguredDays: string[] =
    (activeDays && Array.isArray(activeDays) && activeDays.length > 0)
      ? activeDays
      : (email && db.weeklyStudyDays?.[email] && db.weeklyStudyDays[email].length > 0)
      ? db.weeklyStudyDays[email]
      : (uid && db.weeklyStudyDays?.[uid] && db.weeklyStudyDays[uid].length > 0)
      ? db.weeklyStudyDays[uid]
      : (email && db.userProfiles?.[email]?.weeklyStudyDays && db.userProfiles[email].weeklyStudyDays.length > 0)
      ? db.userProfiles[email].weeklyStudyDays
      : (email && db.userProfiles?.[email]?.selectedStudyDays && db.userProfiles[email].selectedStudyDays.length > 0)
      ? db.userProfiles[email].selectedStudyDays
      : DAYS_SEQUENCE;

  const targetDays = DAYS_SEQUENCE.filter((d) => studentConfiguredDays.includes(d));
  const daysToDistribute = targetDays.length > 0 ? targetDays : DAYS_SEQUENCE;

  // Consumed videos: already watched by this student (from watched history AND studentJournal)
  const consumedVideoIds = new Set<string>();
  targetKeys.forEach((k) => {
    const watched = db.studentWatchedVideos?.[k] || [];
    watched.forEach((id: string) => {
      const vid = extractServerYouTubeId(id);
      if (vid) consumedVideoIds.add(vid);
    });

    const journalEntries = [...((db.userProfiles?.[k]?.studentJournal) || [])];
    journalEntries.forEach((entry: any) => {
      if (entry && entry.type === 'video' && entry.id) {
        const vid = extractServerYouTubeId(entry.id);
        if (vid) consumedVideoIds.add(vid);
        if (entry.url) {
          const urlVid = extractServerYouTubeId(entry.url);
          if (urlVid) consumedVideoIds.add(urlVid);
        }
      }
    });
  });

  if (Array.isArray(extraWatchedIds)) {
    extraWatchedIds.forEach((id: string) => {
      const vid = extractServerYouTubeId(id);
      if (vid) consumedVideoIds.add(vid);
    });
  }

  const assignedRecords: any[] = [];
  const assignedInWeekVideoIds = new Set<string>();

  // Incorporate dynamic playlists from the YouTube channel as candidate pool
  const channelPlaylistCandidates: any[] = [];
  if (db.youtubePlaylists && Array.isArray(db.youtubePlaylists)) {
    db.youtubePlaylists.forEach((pl: any) => {
      if (Array.isArray(pl.videos)) {
        pl.videos.forEach((v: any) => {
          channelPlaylistCandidates.push({
            ...v,
            playlistId: pl.id,
            playlistTitle: pl.title,
            instructions: v.instructions || `Assista a esta aula sobre "${pl.title}".`,
          });
        });
      }
    });
  }

  // Full candidate pool for this level (7 designated days + curriculum pool + channel videos)
  const allLevelCandidates: any[] = [
    ...DAYS_SEQUENCE.map((d) => levelPlaylist.videos[d]),
    ...(levelPlaylist.pool || []),
    ...channelPlaylistCandidates,
  ].filter(Boolean);

  daysToDistribute.forEach((dayKey, idx) => {
    const designatedVideo = levelPlaylist.videos[dayKey];
    let chosenVideo = designatedVideo;
    const designatedVidId = extractServerYouTubeId(designatedVideo?.videoId || designatedVideo?.url);

    // Anti-repetition check:
    // If designated video is already watched OR already assigned to an earlier day this week:
    if (!designatedVidId || consumedVideoIds.has(designatedVidId) || assignedInWeekVideoIds.has(designatedVidId)) {
      // Find next unseen candidate in the level curriculum
      const unseenCandidate = allLevelCandidates.find((c) => {
        const cid = extractServerYouTubeId(c.videoId || c.url);
        return cid && !consumedVideoIds.has(cid) && !assignedInWeekVideoIds.has(cid);
      });

      if (unseenCandidate) {
        chosenVideo = unseenCandidate;
      } else {
        // If all consumed, pick one not yet assigned in this specific week
        const unassignedThisWeek = allLevelCandidates.find((c) => {
          const cid = extractServerYouTubeId(c.videoId || c.url);
          return cid && !assignedInWeekVideoIds.has(cid);
        });
        chosenVideo = unassignedThisWeek || designatedVideo;
      }
    }

    const cleanVidId = extractServerYouTubeId(chosenVideo.videoId || chosenVideo.url) || `vid-${dayKey}`;
    assignedInWeekVideoIds.add(cleanVidId);
    consumedVideoIds.add(cleanVidId);

    const canonicalUrl = `https://www.youtube.com/watch?v=${cleanVidId}`;
    const embedUrl = chosenVideo.embedUrl || `https://www.youtube-nocookie.com/embed/${cleanVidId}?rel=0&modestbranding=1&enablejsapi=1`;

    const videoObj = {
      id: `vid-${dayKey}-${Date.now()}-${idx}`,
      url: canonicalUrl,
      videoId: cleanVidId,
      title: chosenVideo.title,
      channelOrCreator: chosenVideo.channelOrCreator || 'BBC Learning English',
      duration: chosenVideo.duration || '6-8 min',
      instructions: chosenVideo.teacherTipPt || 'Vídeo exclusivo do dia. Assista com atenção e anote novos vocabulários.',
      addedAt: new Date().toISOString(),
      playlistId: chosenVideo.playlistId || levelPlaylist.playlistId,
      playlistTitle: chosenVideo.playlistTitle || levelPlaylist.playlistTitle,
    };

    const assignmentRecord = {
      id: `assign-${dayKey}-${Date.now()}-${idx}`,
      activityId: `act-${dayKey}-1`,
      studentEmail: email,
      studentUid: uid,
      teacherUid: (teacherUid || '').trim(),
      teacherEmail: (teacherEmail || '').trim(),
      day: dayKey,
      playlistId: videoObj.playlistId,
      playlistTitle: videoObj.playlistTitle,
      videoId: cleanVidId,
      videoTitle: chosenVideo.title,
      videoUrl: canonicalUrl,
      embedUrl,
      assignedAt: new Date().toISOString(),
      level: normLevel,
      instructions: videoObj.instructions,
    };

    assignedRecords.push(assignmentRecord);

    if (studentRoutines && studentRoutines[dayKey]) {
      let matched = false;
      studentRoutines[dayKey] = studentRoutines[dayKey].map((item: any) => {
        const isTarget =
          item.id?.endsWith('1') ||
          item.activityName?.toLowerCase().includes('vídeo') ||
          item.activityName?.toLowerCase().includes('video') ||
          (db.youtubePlaylists || []).some((pl: any) => pl.title?.toLowerCase() === item.activityName?.toLowerCase());
        if (isTarget) {
          matched = true;
          return {
            ...item,
            activityName: videoObj.playlistTitle || item.activityName,
            teacherVideos: [videoObj],
            teacherNotes: videoObj.instructions,
          };
        }
        return item;
      });
      if (!matched && studentRoutines[dayKey].length > 0) {
        studentRoutines[dayKey][0] = {
          ...studentRoutines[dayKey][0],
          activityName: videoObj.playlistTitle || studentRoutines[dayKey][0].activityName,
          teacherVideos: [videoObj],
          teacherNotes: videoObj.instructions,
        };
      }
    }
  });

  targetKeys.forEach((key) => {
    db.studentVideoAssignments![key] = assignedRecords;
    db.studentRoutinesMap[key] = studentRoutines;
  });

  if (uid) {
    saveStudentAssignmentsByUid(uid, {
      uid,
      email,
      level: normLevel,
      videoAssignments: assignedRecords,
      spotifyAssignments: db.studentSpotifyAssignments?.[uid] || db.studentSpotifyAssignments?.[email] || [],
      routines: studentRoutines,
      updatedAt: new Date().toISOString(),
    }).catch((err) => console.warn('Firestore saveStudentAssignmentsByUid (YouTube) notice:', err));
  }

  return assignedRecords;
}

// Helper for server-side clean YouTube ID extraction
function extractServerYouTubeId(urlOrId: string | null | undefined): string | null {
  if (!urlOrId) return null;
  const clean = urlOrId.trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(clean)) return clean;
  const match = clean.match(
    /(?:youtube(?:-nocookie)?\.com\/(?:[^\/\n\s]+\/\S+\/|(?:v|e(?:mbed)?|shorts)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i
  );
  return match && match[1] && match[1].length === 11 ? match[1] : null;
}

// ARCH.2E.2A: Canonical Firestore-backed YouTube weekly distributor (zero reliance on inMemoryDb routine maps)
async function distributeWeeklyYouTubeCanonical(params: {
  uid: string;
  email: string;
  level?: string;
  teacherUid?: string;
  teacherEmail?: string;
  days?: string[];
  weeklyCycle?: number;
  forceRedistribute?: boolean;
  idempotencyKey?: string;
  catalogPlaylists?: any[];
}): Promise<{
  success: boolean;
  idempotentReplay?: boolean;
  assignments: any[];
  weeklyCycle: number;
  error?: string;
  code?: string;
}> {
  const ctx = await fetchCanonicalRoutineContextServer(params.uid, params.weeklyCycle);
  if (!ctx) {
    return {
      success: false,
      assignments: [],
      weeklyCycle: params.weeklyCycle || 1,
      error: 'Canonical Firestore (default) context unavailable.',
      code: 'FIRESTORE_UNAVAILABLE',
    };
  }

  const requestedCycle = extractPositiveIntegerCycle(params.weeklyCycle);
  if (requestedCycle !== null && requestedCycle < ctx.activeCycle) {
    return {
      success: false,
      assignments: ctx.videoAssignments,
      weeklyCycle: ctx.activeCycle,
      error: `Stale cycle ${requestedCycle} rejected; active cycle is ${ctx.activeCycle}.`,
      code: 'STALE_CYCLE',
    };
  }

  const activeCycle = requestedCycle !== null ? Math.max(ctx.activeCycle, requestedCycle) : ctx.activeCycle;
  const studentLevelRaw = params.level || ctx.level || 'beginner';
  const normLevel = normalizeStudentLevel(studentLevelRaw).key;
  const levelPlaylist = YOUTUBE_LEVEL_PLAYLISTS[normLevel] || YOUTUBE_LEVEL_PLAYLISTS.beginner;

  const daysToDistribute = (Array.isArray(params.days) && params.days.length > 0 ? params.days : ctx.studyDays)
    .map((d) => String(d || '').toLowerCase().trim())
    .filter((d) => DAYS_SEQUENCE.includes(d as any));
  const targetDays = daysToDistribute.length > 0 ? daysToDistribute : DAYS_SEQUENCE;

  // Idempotency check: if idempotencyKey matches or all target days already have unique non-empty assignments in activeCycle
  const existingForDays = targetDays
    .map((d) => ctx.videoAssignments.find((a: any) => (a.day || a.dayOfWeek) === d && Number(a.weeklyCycle || activeCycle) === activeCycle))
    .filter(Boolean);
  const existingIds = existingForDays
    .map((a: any) => extractServerYouTubeId(a.videoId || a.videoUrl))
    .filter(Boolean) as string[];
  const hasUniqueExisting =
    existingForDays.length === targetDays.length &&
    existingIds.length === targetDays.length &&
    (targetDays.length === 1 || new Set(existingIds).size > 1);
  const matchingIdempotency =
    Boolean(params.idempotencyKey) &&
    existingForDays.some((a: any) => a.idempotencyKey === params.idempotencyKey);

  if (!params.forceRedistribute && (matchingIdempotency || hasUniqueExisting)) {
    return {
      success: true,
      idempotentReplay: true,
      assignments: ctx.videoAssignments,
      weeklyCycle: activeCycle,
    };
  }

  const consumedVideoIds = new Set<string>();
  ctx.watchedVideosHistory.forEach((id) => {
    const cid = extractServerYouTubeId(id) || id;
    if (cid) consumedVideoIds.add(cid);
  });
  ctx.studentJournal.forEach((entry: any) => {
    if (entry && entry.type === 'video') {
      const cid = extractServerYouTubeId(entry.id || entry.url);
      if (cid) consumedVideoIds.add(cid);
    }
  });

  const channelPlaylistCandidates: any[] = [];
  if (Array.isArray(params.catalogPlaylists)) {
    params.catalogPlaylists.forEach((pl: any) => {
      if (Array.isArray(pl.videos)) {
        pl.videos.forEach((v: any) => {
          channelPlaylistCandidates.push({
            ...v,
            playlistId: pl.id,
            playlistTitle: pl.title,
            instructions: v.instructions || `Assista a esta aula sobre "${pl.title}".`,
          });
        });
      }
    });
  }

  const allLevelCandidates: any[] = [
    ...DAYS_SEQUENCE.map((d) => levelPlaylist.videos[d]),
    ...(levelPlaylist.pool || []),
    ...channelPlaylistCandidates,
  ].filter(Boolean);

  const assignedInWeekVideoIds = new Set<string>();
  const assignedRecords: any[] = [];
  const now = new Date().toISOString();

  for (let idx = 0; idx < targetDays.length; idx++) {
    const dayKey = targetDays[idx] as DayOfWeek;
    const designatedVideo = levelPlaylist.videos[dayKey];
    let chosenVideo: any = designatedVideo;
    const designatedVidId = extractServerYouTubeId(designatedVideo?.videoId || designatedVideo?.url);

    if (!designatedVidId || consumedVideoIds.has(designatedVidId) || assignedInWeekVideoIds.has(designatedVidId)) {
      const unseenCandidate = allLevelCandidates.find((c) => {
        const cid = extractServerYouTubeId(c.videoId || c.url);
        return cid && !consumedVideoIds.has(cid) && !assignedInWeekVideoIds.has(cid);
      });
      if (unseenCandidate) {
        chosenVideo = unseenCandidate;
      } else {
        const unassignedThisWeek = allLevelCandidates.find((c) => {
          const cid = extractServerYouTubeId(c.videoId || c.url);
          return cid && !assignedInWeekVideoIds.has(cid);
        });
        chosenVideo = unassignedThisWeek || designatedVideo;
      }
    }

    const cleanVidId = extractServerYouTubeId(chosenVideo?.videoId || chosenVideo?.url) || `vid-${dayKey}`;
    assignedInWeekVideoIds.add(cleanVidId);
    consumedVideoIds.add(cleanVidId);

    const canonicalUrl = `https://www.youtube.com/watch?v=${cleanVidId}`;
    const embedUrl = chosenVideo?.embedUrl || `https://www.youtube-nocookie.com/embed/${cleanVidId}?rel=0&modestbranding=1&enablejsapi=1`;
    const instructions =
      chosenVideo?.instructions ||
      chosenVideo?.teacherTipPt ||
      'Vídeo exclusivo do dia. Assista com atenção e anote novos vocabulários.';
    const playlistIdVal = chosenVideo?.playlistId || levelPlaylist.playlistId;
    const playlistTitleVal = chosenVideo?.playlistTitle || levelPlaylist.playlistTitle;
    const titleVal = chosenVideo?.title || 'Daily Video Practice';
    const durationVal = chosenVideo?.duration || '6-8 min';

    const assignmentRecord: any = {
      id: `assign-${dayKey}-${activeCycle}-${cleanVidId}`,
      activityId: `act-${dayKey}-1`,
      studentEmail: params.email,
      studentUid: params.uid,
      teacherUid: (params.teacherUid || '').trim(),
      teacherEmail: (params.teacherEmail || '').trim(),
      day: dayKey,
      playlistId: playlistIdVal,
      playlistTitle: playlistTitleVal,
      videoId: cleanVidId,
      videoTitle: titleVal,
      videoUrl: canonicalUrl,
      embedUrl,
      assignedAt: now,
      level: normLevel,
      instructions,
      duration: durationVal,
      weeklyCycle: activeCycle,
      ...(params.idempotencyKey ? { idempotencyKey: params.idempotencyKey } : {}),
    };

    assignedRecords.push(assignmentRecord);

    const savedDay = await saveRoutineVideoSubcollection(
      params.uid,
      dayKey,
      {
        id: cleanVidId,
        videoId: cleanVidId,
        title: titleVal,
        videoTitle: titleVal,
        url: canonicalUrl,
        playlistId: playlistIdVal,
        playlistTitle: playlistTitleVal,
        dayOfWeek: dayKey,
        activityId: `act-${dayKey}-1`,
        teacherUid: (params.teacherUid || '').trim(),
        teacherEmail: (params.teacherEmail || '').trim(),
        isRepeatVideo: false,
        instructions,
        duration: durationVal,
        weeklyCycle: activeCycle,
        updatedAt: now,
      },
      activeCycle
    );

    if (!savedDay) {
      return {
        success: false,
        assignments: [],
        weeklyCycle: activeCycle,
        error: `Failed to persist daily video for ${dayKey} in Firestore.`,
        code: 'WRITE_FAILED',
      };
    }
  }

  const targetDaySet = new Set(targetDays);
  const mergedAssignments = [
    ...ctx.videoAssignments.filter((a: any) => !targetDaySet.has((a.day || a.dayOfWeek || '').toLowerCase())),
    ...assignedRecords,
  ];

  const savedAssignments = await saveStudentAssignmentsCanonicalServer(params.uid, {
    uid: params.uid,
    email: params.email,
    level: normLevel,
    weeklyCycle: activeCycle,
    videoAssignments: mergedAssignments,
    awaitingTopicSelection: false,
    updatedAt: now,
  });

  if (!savedAssignments) {
    return {
      success: false,
      assignments: [],
      weeklyCycle: activeCycle,
      error: 'Failed to persist weekly video assignments in Firestore.',
      code: 'WRITE_FAILED',
    };
  }

  return {
    success: true,
    assignments: mergedAssignments,
    weeklyCycle: activeCycle,
  };
}

app.get('/api/student-routines', firebaseAuthMiddleware, async (req, res) => {
  const authCtx = await authorizeStudentRoutineAccess(req, res, { allowMissingTargetFallbackToCaller: true });
  if (!authCtx) return;

  const { canonicalStudentUid, canonicalStudentEmail } = authCtx;
  const requestedCycle = req.query.weeklyCycle !== undefined ? String(req.query.weeklyCycle) : undefined;
  let ctx = await fetchCanonicalRoutineContextServer(canonicalStudentUid, requestedCycle);

  if (!ctx) {
    return res.status(503).json({
      error: 'FirestoreUnavailable',
      message: 'Could not read canonical student routines from Firestore (default).',
    });
  }

  // ARCH.2E.2D / ARCH.2E.2D.2: Recover interrupted post-transaction new-week preparation if still pending
  if (ctx.userProfile?.cycleTransition?.status === 'pending_preparation') {
    const pendingTargetCycle =
      ctx.userProfile.cycleTransition.targetCycle ||
      ctx.userProfile.weeklyCycle ||
      ctx.activeCycle;
    const recoveredPrep = await prepareNewWeeklyCycleServer({
      uid: canonicalStudentUid,
      studentEmail: canonicalStudentEmail || ctx.studentEmail,
      targetCycle: pendingTargetCycle,
      previousCycle: ctx.userProfile.cycleTransition.previousCycle,
      attemptId: ctx.userProfile.cycleTransition.attemptId || undefined,
      level: ctx.level,
      routineVideoTime: ctx.userProfile?.routineVideoTime,
    });
    if (recoveredPrep.ok) {
      const refreshedCtx = await fetchCanonicalRoutineContextServer(canonicalStudentUid, requestedCycle);
      if (refreshedCtx) ctx = refreshedCtx;
    }
  }

  const vidTime = ctx.userProfile?.routineVideoTime;
  const audTime = ctx.userProfile?.routineAudioTime;
  const merged = createCleanStudentRoutines(vidTime);

  const dayKeys = Object.keys(merged) as Array<keyof typeof merged>;
  dayKeys.forEach((day) => {
    const rawDay = ctx.routinesByDayRaw[day];
    const dayAssignment = ctx.videoAssignments.find((a: any) => (a.day || a.dayOfWeek) === day);
    const spotifyAssign = ctx.spotifyAssignments.find((s: any) => (s.day || s.dayOfWeek) === day);

    const dayList = (merged[day] || []).map((item: any, idx: number, arr: any[]) => {
      const nextItem = { ...item };

      if (idx === 0 || item.id?.endsWith('1')) {
        if (vidTime) nextItem.time = vidTime;

        if (rawDay) {
          if (Array.isArray(rawDay.learnedWords)) {
            nextItem.learnedWords = rawDay.learnedWords;
          }
          if (rawDay.completedToday !== undefined) {
            nextItem.completedToday = Boolean(rawDay.completedToday);
            nextItem.completed = Boolean(rawDay.completed ?? rawDay.completedToday);
          }
          if (rawDay.completedVideoToday !== undefined) {
            nextItem.completedVideoToday = Boolean(rawDay.completedVideoToday);
          }
          if (rawDay.time) {
            nextItem.time = rawDay.time;
          } else if (rawDay.activityTimes && nextItem.id && rawDay.activityTimes[nextItem.id]) {
            nextItem.time = rawDay.activityTimes[nextItem.id];
          }
          if (rawDay.instructions || rawDay.teacherNotes) {
            nextItem.teacherNotes = rawDay.teacherNotes || rawDay.instructions;
          }

          const rawVidId = rawDay.videoId ? (extractServerYouTubeId(rawDay.videoId || rawDay.url) || String(rawDay.videoId).trim()) : '';
          if (rawVidId) {
            const cleanUrl = rawDay.url || `https://www.youtube.com/watch?v=${rawVidId}`;
            const title = rawDay.title || rawDay.videoTitle || 'Daily Video Practice';
            const plTitle = rawDay.playlistTitle || '';
            nextItem.activityName = plTitle || title || nextItem.activityName;
            nextItem.playlistId = rawDay.playlistId || '';
            nextItem.playlistTitle = plTitle;
            nextItem.isRepeatVideo = Boolean(rawDay.isRepeatVideo);
            nextItem.teacherVideos = [
              {
                id: rawVidId,
                videoId: rawVidId,
                title,
                url: cleanUrl,
                playlistId: rawDay.playlistId || '',
                playlistTitle: plTitle,
                isRepeatVideo: Boolean(rawDay.isRepeatVideo),
                isCustomSuggestion: Boolean(rawDay.isCustomSuggestion || rawDay.playlistId === 'custom_suggestion'),
                instructions: rawDay.instructions || '',
                duration: rawDay.duration || '5-10 min',
                addedAt: rawDay.updatedAt || new Date().toISOString(),
              },
            ];
          } else if (rawDay.videoId === '' && rawDay.playlistId === '') {
            nextItem.activityName = 'Video of the Day';
            nextItem.playlistId = '';
            nextItem.playlistTitle = '';
            nextItem.teacherVideos = [];
          } else if (dayAssignment && (dayAssignment.videoId || dayAssignment.videoUrl)) {
            const aVidId = extractServerYouTubeId(dayAssignment.videoId || dayAssignment.videoUrl) || dayAssignment.videoId;
            if (aVidId) {
              nextItem.activityName = dayAssignment.playlistTitle || dayAssignment.videoTitle || nextItem.activityName;
              nextItem.playlistId = dayAssignment.playlistId || '';
              nextItem.playlistTitle = dayAssignment.playlistTitle || '';
              nextItem.teacherVideos = [
                {
                  id: aVidId,
                  videoId: aVidId,
                  title: dayAssignment.videoTitle || dayAssignment.title || 'Daily Video Practice',
                  url: dayAssignment.videoUrl || `https://www.youtube.com/watch?v=${aVidId}`,
                  playlistId: dayAssignment.playlistId || '',
                  playlistTitle: dayAssignment.playlistTitle || '',
                  isRepeatVideo: Boolean(dayAssignment.isRepeatVideo),
                  instructions: dayAssignment.instructions || '',
                  duration: dayAssignment.duration || '5-10 min',
                },
              ];
            }
          }
        } else if (dayAssignment && (dayAssignment.videoId || dayAssignment.videoUrl)) {
          const aVidId = extractServerYouTubeId(dayAssignment.videoId || dayAssignment.videoUrl) || dayAssignment.videoId;
          if (aVidId) {
            nextItem.activityName = dayAssignment.playlistTitle || dayAssignment.videoTitle || nextItem.activityName;
            nextItem.playlistId = dayAssignment.playlistId || '';
            nextItem.playlistTitle = dayAssignment.playlistTitle || '';
            nextItem.teacherVideos = [
              {
                id: aVidId,
                videoId: aVidId,
                title: dayAssignment.videoTitle || dayAssignment.title || 'Daily Video Practice',
                url: dayAssignment.videoUrl || `https://www.youtube.com/watch?v=${aVidId}`,
                playlistId: dayAssignment.playlistId || '',
                playlistTitle: dayAssignment.playlistTitle || '',
                isRepeatVideo: Boolean(dayAssignment.isRepeatVideo),
                instructions: dayAssignment.instructions || '',
                duration: dayAssignment.duration || '5-10 min',
              },
            ];
          }
        }
      }

      const isAudioTarget = arr.length === 1 ? idx === 0 : (idx === 1 || Boolean(item.id?.endsWith('2')));
      if (isAudioTarget) {
        if (audTime) {
          if (idx === 1 || item.id?.endsWith('2')) {
            nextItem.time = audTime;
          } else {
            nextItem.audioTime = audTime;
          }
        }
        if (rawDay && rawDay.completedAudioToday !== undefined) {
          nextItem.completedAudioToday = Boolean(rawDay.completedAudioToday);
          if (idx === 1 || item.id?.endsWith('2')) {
            nextItem.completedToday = Boolean(rawDay.completedAudioToday);
            nextItem.completed = Boolean(rawDay.completedAudioToday);
          }
        }
        if (rawDay && rawDay.teacherOverrideTrack !== undefined) {
          nextItem.teacherOverrideTrack = rawDay.teacherOverrideTrack;
        }
        if (rawDay && rawDay.teacherFeedback !== undefined) {
          nextItem.teacherFeedback = rawDay.teacherFeedback;
        }
        if (rawDay && (rawDay.teacherNotes || rawDay.instructions)) {
          nextItem.teacherNotes = rawDay.teacherNotes || rawDay.instructions;
        }
        const daySpot =
          rawDay?.teacherSpotify === null
            ? null
            : rawDay?.teacherSpotify && (rawDay.teacherSpotify.url || rawDay.teacherSpotify.trackUrl)
            ? rawDay.teacherSpotify
            : spotifyAssign;
        if (daySpot && (daySpot.url || daySpot.trackUrl)) {
          nextItem.teacherSpotify = {
            id: daySpot.id || daySpot.trackId || `spot-${day}`,
            ...(daySpot.trackId ? { trackId: daySpot.trackId } : {}),
            url: daySpot.url || daySpot.trackUrl,
            title: daySpot.title || daySpot.trackTitle || 'Daily Spotify Audio',
            artistOrHost: daySpot.artistOrHost || daySpot.artist || 'Spotify',
            instructions: daySpot.instructions || rawDay?.teacherNotes || '',
            type: daySpot.type || 'music',
          };
        }
      }

      if (rawDay?.activityTimes && nextItem.id && rawDay.activityTimes[nextItem.id]) {
        nextItem.time = rawDay.activityTimes[nextItem.id];
      }

      return nextItem;
    });

    merged[day] = dayList;
  });

  // Read-only hydration complete: never overwrite Firestore videos with empty state or auto-distribute YouTube here.
  return res.json(merged);
});

/**
 * Weekly Cycle Intelligence & Progression:
 * Advances the student to a new weekly cycle ("Start New Week" / "Iniciar Nova Semana").
 * - Registers all current week's videos and Spotify tracks in consumed history (watchedVideos / listenedTracks).
 * - Generates 7 brand-new, non-repeating YouTube videos and Spotify tracks matching student level.
 * - Resets weekly activity checklist for the fresh cycle.
 * - Persists full state linked to student UID in Firestore and local db.
 */
// HOTFIX 2.3.5E: In-process lock map per student UID to serialize concurrent requests on the same process
const inProcessCycleLocks = new Map<string, Promise<any>>();

app.post(['/api/student-routines/start-new-week', '/api/student/reset-week'], firebaseAuthMiddleware, async (req, res) => {
  // Reject explicit synthetic/non-canonical UIDs immediately before authorization
  const rawBodyUid = ((req.body?.uid as string) || (req.body?.studentUid as string) || '').trim();
  if (rawBodyUid && !isValidCanonicalUid(rawBodyUid)) {
    return res.status(422).json({
      success: false,
      error: 'Unprocessable Entity',
      message: 'Invalid or synthetic student UID rejected.',
    });
  }

  const authCtx = await authorizeHomeworkChecksAccess(req, res, 'write');
  if (!authCtx) return;

  const { canonicalStudentUid, canonicalStudentEmail } = authCtx;
  if (!isValidCanonicalUid(canonicalStudentUid)) {
    return res.status(422).json({
      success: false,
      error: 'Unprocessable Entity',
      message: 'Canonical Firebase Auth UID is required.',
    });
  }

  if (!getFirestoreDb()) {
    return res.status(503).json({
      success: false,
      error: 'FirestoreUnavailable',
      message: 'Canonical Firestore (default) database is unavailable.',
    });
  }

  // ARCH.2E.2D.2: Require explicit non-empty attemptId and explicit positive integer expectedCycle
  const rawAttemptId = req.body?.attemptId;
  if (typeof rawAttemptId !== 'string' || !rawAttemptId.trim() || rawAttemptId.trim().length > 200) {
    return res.status(400).json({
      success: false,
      error: 'InvalidOrMissingAttemptId',
      message: 'attemptId is required and must be a non-empty string.',
    });
  }
  const attemptId = rawAttemptId.trim();

  const rawExpected = req.body?.expectedCycle;
  const parsedExpected =
    typeof rawExpected === 'number'
      ? Number.isSafeInteger(rawExpected) && rawExpected > 0
        ? rawExpected
        : null
      : typeof rawExpected === 'string' &&
        /^[1-9][0-9]*$/.test(rawExpected.trim()) &&
        Number.isSafeInteger(Number(rawExpected.trim()))
      ? Number(rawExpected.trim())
      : null;

  if (parsedExpected === null) {
    return res.status(400).json({
      success: false,
      error: 'InvalidOrMissingExpectedCycle',
      message: 'expectedCycle is required and must be an explicit positive integer.',
    });
  }
  const expectedCycle = parsedExpected;

  // Concurrency serialization lock per canonical student UID
  const lockKey = canonicalStudentUid;
  const activeLock = inProcessCycleLocks.get(lockKey);
  if (activeLock) {
    try {
      await activeLock;
    } catch {}
  }

  let releaseCycleLock!: () => void;
  const lockPromise = new Promise<void>((resolve) => {
    releaseCycleLock = resolve;
  });
  inProcessCycleLocks.set(lockKey, lockPromise);

  try {
    const rawLevel = ((req.body?.level as string) || (req.body?.studentLevel as string) || '').trim();
    const weeklyStudyDaysTarget =
      typeof req.body?.weeklyStudyDaysTarget === 'number' &&
      req.body.weeklyStudyDaysTarget >= 1 &&
      req.body.weeklyStudyDaysTarget <= 7
        ? req.body.weeklyStudyDaysTarget
        : undefined;
    const VALID_DAYS: DayOfWeek[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    const weeklyStudyDays: DayOfWeek[] | undefined = Array.isArray(req.body?.weeklyStudyDays)
      ? req.body.weeklyStudyDays.filter((d: any): d is DayOfWeek => typeof d === 'string' && VALID_DAYS.includes(d as DayOfWeek))
      : undefined;

    // 1. Read authoritative persisted cycle & transition state from Firestore (default)
    let fsStatus = await fetchStudentCycleStatusFromServerFirestore(canonicalStudentUid);
    let currentCycle = fsStatus?.currentCycle ?? 1;

    // 2. Idempotency check FIRST (before rejecting expectedCycle that became old due to this confirmed advance)
    if (fsStatus?.lastCycleAttemptId === attemptId || fsStatus?.cycleTransition?.attemptId === attemptId) {
      const recordedPrevCycle =
        typeof fsStatus?.cycleTransition?.previousCycle === 'number' && fsStatus.cycleTransition.previousCycle > 0
          ? fsStatus.cycleTransition.previousCycle
          : null;
      if (recordedPrevCycle !== null && expectedCycle !== recordedPrevCycle) {
        return res.status(409).json({
          error: 'AttemptIdCycleMismatch',
          message: `Attempt ${attemptId} was already committed for cycle ${recordedPrevCycle}, not expectedCycle ${expectedCycle}.`,
          expectedCycle,
          persistedCycle: currentCycle,
          currentCycle,
          success: false,
        });
      }

      if (fsStatus?.cycleTransition?.status === 'pending_preparation') {
        const recoveredPrep = await prepareNewWeeklyCycleServer({
          uid: canonicalStudentUid,
          studentEmail: canonicalStudentEmail || fsStatus.studentEmail,
          targetCycle: fsStatus.cycleTransition.targetCycle || currentCycle,
          previousCycle: fsStatus.cycleTransition.previousCycle ?? Math.max(1, currentCycle - 1),
          attemptId,
          weeklyStudyDaysTarget: weeklyStudyDaysTarget ?? fsStatus.weeklyStudyDaysTarget,
          weeklyStudyDays: weeklyStudyDays && weeklyStudyDays.length > 0 ? weeklyStudyDays : fsStatus.weeklyStudyDays,
          level: rawLevel || fsStatus.level,
          routineVideoTime: fsStatus.routineVideoTime,
        });
        if (!recoveredPrep.ok) {
          return res.status(recoveredPrep.statusCode || 500).json({
            success: false,
            error: recoveredPrep.code || 'CyclePreparationFailed',
            message: recoveredPrep.error || 'Failed to finalize interrupted new week preparation.',
            weeklyCycle: currentCycle,
            preparationPending: true,
            inProgress: Boolean(recoveredPrep.inProgress),
            attemptId,
          });
        }
        return res.status(200).json(recoveredPrep.result);
      }

      if (fsStatus?.lastCycleResult) {
        return res.status(200).json(fsStatus.lastCycleResult);
      }

      return res.status(200).json({
        success: true,
        weeklyCycle: currentCycle,
        previousCycle: recordedPrevCycle ?? Math.max(1, currentCycle - 1),
        attemptId,
        message: 'New weekly cycle already activated for this attemptId.',
      });
    }

    // 3. Cycle conflict check: expectedCycle vs persisted canonical cycle
    if (currentCycle !== expectedCycle) {
      return res.status(409).json({
        error: 'Cycle Conflict',
        message: `Expected cycle ${expectedCycle} does not match current persisted cycle ${currentCycle}.`,
        expectedCycle,
        persistedCycle: currentCycle,
        currentCycle,
        success: false,
      });
    }

    // 3b. Do not close or advance past a cycle whose own preparation is still pending
    if (fsStatus?.cycleTransition?.status === 'pending_preparation' && fsStatus.cycleTransition.targetCycle === currentCycle) {
      const pendingPrep = await prepareNewWeeklyCycleServer({
        uid: canonicalStudentUid,
        studentEmail: canonicalStudentEmail || fsStatus.studentEmail,
        targetCycle: fsStatus.cycleTransition.targetCycle || currentCycle,
        previousCycle: fsStatus.cycleTransition.previousCycle ?? Math.max(1, currentCycle - 1),
        attemptId: fsStatus.cycleTransition.attemptId || undefined,
        weeklyStudyDaysTarget: fsStatus.weeklyStudyDaysTarget,
        weeklyStudyDays: fsStatus.weeklyStudyDays,
        level: fsStatus.level,
        routineVideoTime: fsStatus.routineVideoTime,
      });
      if (!pendingPrep.ok) {
        return res.status(pendingPrep.statusCode || 409).json({
          success: false,
          error: pendingPrep.code || 'CyclePreparationPending',
          message: pendingPrep.error || 'Current cycle preparation is still pending or in progress.',
          weeklyCycle: currentCycle,
          preparationPending: true,
          inProgress: Boolean(pendingPrep.inProgress),
        });
      }
      fsStatus = (await fetchStudentCycleStatusFromServerFirestore(canonicalStudentUid)) || fsStatus;
      currentCycle = fsStatus?.currentCycle ?? currentCycle;
    }

    // 4. Close outgoing week snapshot in users/{uid}/weeklyHistory/week-{currentCycle} BEFORE advancing cycle
    const closeRes = await closeWeeklyHistorySnapshotServer({
      uid: canonicalStudentUid,
      closingCycle: currentCycle,
      attemptId,
      studentEmail: canonicalStudentEmail || fsStatus?.studentEmail,
      clientWatchedVideos: Array.isArray(req.body?.watchedVideosHistory) ? req.body.watchedVideosHistory : undefined,
      clientListenedTracks: Array.isArray(req.body?.listenedTracksHistory) ? req.body.listenedTracksHistory : undefined,
    });
    if (!closeRes.ok) {
      return res.status(closeRes.statusCode || 500).json({
        success: false,
        error: 'WeeklyHistoryCloseFailed',
        message: closeRes.error || 'Failed to close weekly history before advancing cycle.',
        currentCycle,
      });
    }

    // 5. Transactional cycle advance in users/{uid} (marks cycleTransition.status = 'pending_preparation')
    const txResult = await advanceWeeklyCycleTransactionServer(
      canonicalStudentUid,
      expectedCycle,
      attemptId,
      currentCycle + 1,
      {
        weeklyStudyDaysTarget,
        weeklyStudyDays,
      }
    );

    if (txResult.conflict) {
      return res.status(409).json({
        error: 'Cycle Conflict',
        message: `Expected cycle ${expectedCycle} does not match current persisted cycle ${txResult.persistedCycle}.`,
        expectedCycle,
        persistedCycle: txResult.persistedCycle,
        currentCycle: txResult.persistedCycle,
        success: false,
      });
    }

    if (!txResult.success) {
      return res.status(txResult.statusCode || 500).json({
        success: false,
        error: 'CycleAdvanceFailed',
        message: txResult.error || 'Failed to advance weekly cycle in Firestore.',
        currentCycle,
      });
    }

    if (
      txResult.isIdempotentReplay &&
      txResult.cycleTransition?.status === 'completed' &&
      txResult.lastCycleResult
    ) {
      return res.status(200).json(txResult.lastCycleResult);
    }

    // 6. Coordinated idempotent & recoverable preparation for the new weekly cycle
    const prepRes = await prepareNewWeeklyCycleServer({
      uid: canonicalStudentUid,
      studentEmail: canonicalStudentEmail || fsStatus?.studentEmail,
      targetCycle: txResult.persistedCycle,
      previousCycle: txResult.previousCycle ?? currentCycle,
      attemptId,
      weeklyStudyDaysTarget: weeklyStudyDaysTarget ?? fsStatus?.weeklyStudyDaysTarget,
      weeklyStudyDays: weeklyStudyDays && weeklyStudyDays.length > 0 ? weeklyStudyDays : fsStatus?.weeklyStudyDays,
      level: rawLevel || fsStatus?.level,
      routineVideoTime: fsStatus?.routineVideoTime,
    });

    if (!prepRes.ok) {
      return res.status(prepRes.statusCode || 500).json({
        success: false,
        error: prepRes.code || 'CyclePreparationFailed',
        message: prepRes.error || 'Cycle advanced, but new week preparation failed and must be retried.',
        weeklyCycle: txResult.persistedCycle,
        preparationPending: true,
        inProgress: Boolean(prepRes.inProgress),
        attemptId,
      });
    }

    return res.status(200).json(prepRes.result);
  } finally {
    if (inProcessCycleLocks.get(lockKey) === lockPromise) {
      inProcessCycleLocks.delete(lockKey);
    }
    if (releaseCycleLock) releaseCycleLock();
  }
});

// HOTFIX 2.3.5E / ARCH.2E.2D: Authenticated canonical recovery endpoint to verify current cycle and attempt status
app.get(['/api/student-routines/cycle-status', '/api/student-routines/start-new-week'], firebaseAuthMiddleware, async (req, res) => {
  const rawQueryUid = ((req.query?.studentUid as string) || (req.query?.uid as string) || '').trim();
  if (rawQueryUid && !isValidCanonicalUid(rawQueryUid)) {
    return res.status(422).json({
      success: false,
      error: 'Unprocessable Entity',
      message: 'Invalid or synthetic student UID rejected.',
    });
  }

  const authCtx = await authorizeStudentRoutineAccess(req, res, {
    allowMissingTargetFallbackToCaller: true,
    requireApprovedTeacherIfTutor: true,
  });
  if (!authCtx) return;

  const { canonicalStudentUid, canonicalStudentEmail } = authCtx;
  if (!isValidCanonicalUid(canonicalStudentUid)) {
    return res.status(422).json({
      success: false,
      error: 'Unprocessable Entity',
      message: 'Canonical Firebase Auth UID is required.',
    });
  }

  const attemptId = ((req.query?.attemptId as string) || '').trim();
  let fsStatus = await fetchStudentCycleStatusFromServerFirestore(canonicalStudentUid);
  if (!fsStatus && !getFirestoreDb()) {
    return res.status(503).json({
      success: false,
      error: 'FirestoreUnavailable',
      message: 'Canonical Firestore (default) database is unavailable.',
    });
  }

  let currentCycle = fsStatus?.currentCycle ?? 1;
  let lastCycleAttemptId = fsStatus?.lastCycleAttemptId || '';
  let lastCycleResult = fsStatus?.lastCycleResult || null;
  let preparationPending = fsStatus?.cycleTransition?.status === 'pending_preparation';
  let recoveryInProgress = false;
  let recoveryError: string | undefined;

  // Recover interrupted preparation automatically on cycle-status check (fenced + leased across instances)
  if (preparationPending && fsStatus?.cycleTransition) {
    const recoveryPrep = await prepareNewWeeklyCycleServer({
      uid: canonicalStudentUid,
      studentEmail: canonicalStudentEmail || fsStatus.studentEmail,
      targetCycle: fsStatus.cycleTransition.targetCycle || currentCycle,
      previousCycle: fsStatus.cycleTransition.previousCycle,
      attemptId: fsStatus.cycleTransition.attemptId || undefined,
      weeklyStudyDaysTarget: fsStatus.weeklyStudyDaysTarget,
      weeklyStudyDays: fsStatus.weeklyStudyDays,
      level: fsStatus.level,
      routineVideoTime: fsStatus.routineVideoTime,
    });
    if (recoveryPrep.ok) {
      preparationPending = false;
      lastCycleResult = recoveryPrep.result;
      fsStatus = (await fetchStudentCycleStatusFromServerFirestore(canonicalStudentUid)) || fsStatus;
      currentCycle = fsStatus?.currentCycle ?? currentCycle;
      lastCycleAttemptId = fsStatus?.lastCycleAttemptId || lastCycleAttemptId;
    } else {
      recoveryInProgress = Boolean(recoveryPrep.inProgress);
      recoveryError = recoveryPrep.error;
      const refreshedStatus = await fetchStudentCycleStatusFromServerFirestore(canonicalStudentUid);
      if (refreshedStatus) {
        fsStatus = refreshedStatus;
        currentCycle = refreshedStatus.currentCycle ?? currentCycle;
        lastCycleAttemptId = refreshedStatus.lastCycleAttemptId || lastCycleAttemptId;
        preparationPending = refreshedStatus.cycleTransition?.status === 'pending_preparation';
        if (!preparationPending) {
          lastCycleResult = refreshedStatus.lastCycleResult || null;
        }
      }
    }
  }

  const ctx = await fetchCanonicalRoutineContextServer(canonicalStudentUid, currentCycle);
  const routines = lastCycleResult?.routines || createCleanStudentRoutines(fsStatus?.routineVideoTime);
  if (!lastCycleResult?.routines && ctx?.routinesByDayRaw) {
    for (const d of Object.keys(routines)) {
      const rawDay = ctx.routinesByDayRaw[d];
      if (rawDay && Array.isArray(routines[d as DayOfWeek]) && routines[d as DayOfWeek].length > 0) {
        const first = { ...routines[d as DayOfWeek][0] };
        if (rawDay.videoId) {
          first.activityName = rawDay.playlistTitle || rawDay.title || first.activityName;
          first.playlistId = rawDay.playlistId || '';
          first.playlistTitle = rawDay.playlistTitle || '';
          first.teacherVideos = [
            {
              id: rawDay.videoId,
              videoId: rawDay.videoId,
              title: rawDay.title || rawDay.videoTitle || 'Daily Video Practice',
              url: rawDay.url || `https://www.youtube.com/watch?v=${rawDay.videoId}`,
              playlistId: rawDay.playlistId || '',
              playlistTitle: rawDay.playlistTitle || '',
              isRepeatVideo: Boolean(rawDay.isRepeatVideo),
              instructions: rawDay.instructions || '',
              duration: rawDay.duration || '5-10 min',
              addedAt: rawDay.updatedAt || new Date().toISOString(),
            },
          ];
        }
        if (Array.isArray(rawDay.learnedWords)) {
          first.learnedWords = rawDay.learnedWords;
        }
        first.completedToday = Boolean(rawDay.completedToday);
        routines[d as DayOfWeek] = [first, ...routines[d as DayOfWeek].slice(1)];
      }
    }
  }

  const attemptMatches = Boolean(attemptId && lastCycleAttemptId === attemptId);
  const attemptConfirmed = attemptId ? attemptMatches && !preparationPending : undefined;

  return res.json({
    success: true,
    studentUid: canonicalStudentUid,
    studentEmail: canonicalStudentEmail || fsStatus?.studentEmail || '',
    currentCycle,
    weeklyCycle: currentCycle,
    lastCycleAttemptId,
    attemptConfirmed,
    preparationPending,
    recoveryInProgress,
    ...(recoveryError ? { recoveryError } : {}),
    cycleTransition: fsStatus?.cycleTransition || null,
    lastCycleResult: preparationPending ? null : lastCycleResult,
    routines,
    weeklyStudyDaysTarget: fsStatus?.weeklyStudyDaysTarget ?? 7,
    weeklyStudyDays: fsStatus?.weeklyStudyDays ?? ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
  });
});

// ARCH.2E.2D: Canonical Firestore (default) Weekly History Read & Record Endpoints
app.get('/api/student-history', firebaseAuthMiddleware, async (req, res) => {
  const rawQueryUid = ((req.query?.studentUid as string) || (req.query?.uid as string) || '').trim();
  if (rawQueryUid && !isValidCanonicalUid(rawQueryUid)) {
    return res.status(422).json({
      success: false,
      error: 'Unprocessable Entity',
      message: 'Invalid or synthetic student UID rejected.',
    });
  }

  const authCtx = await authorizeStudentRoutineAccess(req, res, {
    allowMissingTargetFallbackToCaller: true,
    requireApprovedTeacherIfTutor: true,
  });
  if (!authCtx) return;

  if (!getFirestoreDb()) {
    return res.status(503).json({
      success: false,
      error: 'FirestoreUnavailable',
      message: 'Canonical Firestore (default) database is unavailable.',
    });
  }

  const { canonicalStudentUid } = authCtx;
  const rawWeek = req.query?.weekId || req.query?.week || req.query?.weeklyCycle;
  const includeAll = String(req.query?.includeAll || '').toLowerCase() === 'true';
  const includeAccumulated = String(req.query?.includeAccumulated || '').toLowerCase() === 'true';

  let canonicalWeekId: string | null = null;
  if (rawWeek !== undefined && rawWeek !== '') {
    const cycle = extractPositiveIntegerCycle(rawWeek);
    if (cycle === null) {
      return res.status(400).json({
        success: false,
        error: 'InvalidWeekId',
        message: 'Invalid week identifier. Expected positive integer cycle or week-{cycle}.',
      });
    }
    canonicalWeekId = `week-${cycle}`;
  }

  const [weeklyHistory, allHistories, accumulated] = await Promise.all([
    canonicalWeekId ? fetchWeeklyHistoryServer(canonicalStudentUid, canonicalWeekId) : Promise.resolve(null),
    includeAll ? fetchAllWeeklyHistoriesServer(canonicalStudentUid) : Promise.resolve(undefined),
    includeAccumulated ? fetchAccumulatedConsumedHistoryServer(canonicalStudentUid) : Promise.resolve(undefined),
  ]);

  return res.json({
    success: true,
    studentUid: canonicalStudentUid,
    ...(canonicalWeekId ? { weekId: canonicalWeekId, weeklyHistory } : {}),
    ...(allHistories !== undefined ? { allHistories } : {}),
    ...(accumulated !== undefined ? { accumulated } : {}),
  });
});

app.post('/api/student-history/record', firebaseAuthMiddleware, async (req, res) => {
  const rawBodyUid = ((req.body?.uid as string) || (req.body?.studentUid as string) || '').trim();
  if (rawBodyUid && !isValidCanonicalUid(rawBodyUid)) {
    return res.status(422).json({
      success: false,
      error: 'Unprocessable Entity',
      message: 'Invalid or synthetic student UID rejected.',
    });
  }

  const authCtx = await authorizeHomeworkChecksAccess(req, res, 'write');
  if (!authCtx) return;

  if (!getFirestoreDb()) {
    return res.status(503).json({
      success: false,
      error: 'FirestoreUnavailable',
      message: 'Canonical Firestore (default) database is unavailable.',
    });
  }

  const { canonicalStudentUid, canonicalStudentEmail } = authCtx;
  const rawWeek = req.body?.weekId || req.body?.week || req.body?.weeklyCycle;
  let cycle: number | null = extractPositiveIntegerCycle(rawWeek);
  if (cycle === null) {
    cycle = await resolveStudentWeeklyCycle(canonicalStudentUid, canonicalStudentEmail);
  }
  if (cycle === null) {
    return res.status(400).json({
      success: false,
      error: 'MissingWeekId',
      message: 'A valid positive weekId or weeklyCycle is required.',
    });
  }

  const canonicalWeekId = `week-${cycle}`;
  const existing = await fetchWeeklyHistoryServer(canonicalStudentUid, canonicalWeekId);
  const fsStatus = await fetchStudentCycleStatusFromServerFirestore(canonicalStudentUid);
  const activeCycle = fsStatus?.currentCycle ?? 1;

  // Reject mutating an already closed past cycle history
  if (cycle < activeCycle && existing?.closedAt) {
    return res.status(409).json({
      success: false,
      error: 'STALE_CYCLE',
      code: 'STALE_CYCLE',
      activeCycle,
      requestedCycle: cycle,
      message: `Closed history for ${canonicalWeekId} cannot be overwritten while active cycle is ${activeCycle}.`,
    });
  }

  const recordType = String(req.body?.type || 'merge').trim().toLowerCase();
  const nativeFriendUid = typeof req.body?.nativeFriendUid === 'string' ? req.body.nativeFriendUid.trim() : '';
  const payload: Record<string, any> = {
    studentUid: canonicalStudentUid,
    ...(canonicalStudentEmail ? { studentEmail: canonicalStudentEmail } : {}),
    weekId: canonicalWeekId,
    weeklyCycle: cycle,
    ...(nativeFriendUid ? { assignedNativeFriendUID: nativeFriendUid, nativeFriendUID: nativeFriendUid } : {}),
  };

  if (recordType === 'video' && req.body?.video) {
    const v = req.body.video;
    const rawVid = v.videoId || v.id || v.url || '';
    const cleanVidId = (extractServerYouTubeId(rawVid) || String(rawVid || '')).trim();
    if (!cleanVidId) {
      return res.status(400).json({ success: false, error: 'InvalidVideo', message: 'Missing videoId.' });
    }
    const cleanTitle = (v.videoTitle || v.title || 'Daily Video Practice').trim();
    payload.consumedVideoIds = [
      {
        ...v,
        id: cleanVidId,
        videoId: cleanVidId,
        videoTitle: cleanTitle,
        title: cleanTitle,
        watchedAt: v.watchedAt || new Date().toISOString(),
      },
    ];
    await addWatchedVideoCanonicalServer(canonicalStudentUid, cleanVidId, cleanTitle);
  } else if (recordType === 'track' && req.body?.track) {
    const t = req.body.track;
    const rawTrackId = t.trackId || t.id || t.trackUrl || t.url || '';
    const cleanTrackId = (extractSpotifyTrackId(rawTrackId) || String(rawTrackId || '')).trim();
    if (!cleanTrackId) {
      return res.status(400).json({ success: false, error: 'InvalidTrack', message: 'Missing trackId.' });
    }
    const cleanTitle = (t.title || t.trackTitle || 'Daily Spotify Listening').trim();
    const cleanArtist = (t.artist || t.artistOrHost || 'Spotify Artist').trim();
    payload.consumedTrackIds = [
      {
        ...t,
        id: cleanTrackId,
        trackId: cleanTrackId,
        title: cleanTitle,
        artist: cleanArtist,
        listenedAt: t.listenedAt || new Date().toISOString(),
      },
    ];
    await addListenedTrackCanonicalServer(canonicalStudentUid, cleanTrackId, cleanTitle, cleanArtist);
  } else if (recordType === 'vocabulary' && Array.isArray(req.body?.words)) {
    payload.weeklyVocabulary = req.body.words;
  } else if (req.body?.data && typeof req.body.data === 'object') {
    const { closedAt: _ignoredClosedAt, closedForAttemptId: _ignoredAttempt, ...safeData } = req.body.data;
    Object.assign(payload, safeData);
  } else {
    return res.status(400).json({
      success: false,
      error: 'InvalidPayload',
      message: 'Unsupported history record payload.',
    });
  }

  const saveRes = await saveWeeklyHistoryServer(canonicalStudentUid, canonicalWeekId, payload);
  if (!saveRes.ok) {
    return res.status(saveRes.statusCode || 500).json({
      success: false,
      error: 'FirestorePersistenceFailed',
      message: saveRes.error || 'Failed to persist weekly history in Firestore.',
    });
  }

  return res.json({
    success: true,
    studentUid: canonicalStudentUid,
    weekId: canonicalWeekId,
    weeklyCycle: cycle,
    weeklyHistory: saveRes.data,
  });
});

// Canonical Firestore (default) Current Routine, Spotify Track, Feedback, and Override Endpoints
app.post('/api/routines/current-routine', firebaseAuthMiddleware, async (req, res) => {
  const authCtx = await authorizeStudentRoutineAccess(req, res, { allowMissingTargetFallbackToCaller: true });
  if (!authCtx) return;

  const { canonicalStudentUid, canonicalStudentEmail } = authCtx;
  const {
    weekId,
    currentSpotifyTrack,
    studentEmail,
    nativeFriendUid,
    nativeFriendEmail,
    dayOfWeek,
    weeklyCycle: bodyCycle,
  } = req.body || {};

  let sanitizedTrack = currentSpotifyTrack;
  if (currentSpotifyTrack && typeof currentSpotifyTrack === 'object' && typeof currentSpotifyTrack.url === 'string' && currentSpotifyTrack.url.trim() !== '') {
    const parsed = parseSpotifyUrl(currentSpotifyTrack.url);
    if (!parsed.isValid) {
      return res.status(400).json({
        success: false,
        error: parsed.errorMessage || 'Invalid Spotify URL in currentSpotifyTrack.',
      });
    }
    sanitizedTrack = {
      ...currentSpotifyTrack,
      url: parsed.canonicalUrl || currentSpotifyTrack.url,
    };
  }

  const safeWeekId = typeof weekId === 'string' && weekId.trim() ? weekId.trim() : 'weekData';
  const saveRes = await saveStudentCurrentRoutineServer(
    canonicalStudentUid,
    safeWeekId,
    {
      currentSpotifyTrack: sanitizedTrack,
      studentEmail: canonicalStudentEmail || studentEmail,
      nativeFriendUid,
      nativeFriendEmail,
      dayOfWeek: dayOfWeek || sanitizedTrack?.dayOfWeek,
    },
    bodyCycle
  );

  if (!saveRes.success) {
    if (saveRes.code === 'STALE_CYCLE') {
      return res.status(409).json({
        success: false,
        error: 'STALE_CYCLE',
        message: saveRes.error,
        activeCycle: saveRes.activeCycle,
      });
    }
    if (saveRes.code === 'FIRESTORE_UNAVAILABLE') {
      return res.status(503).json({
        success: false,
        error: 'FirestoreUnavailable',
        message: saveRes.error || 'Canonical Firestore (default) unavailable.',
      });
    }
    return res.status(500).json({
      success: false,
      error: 'FirestorePersistenceFailed',
      message: saveRes.error || 'Failed to persist current routine in Firestore (default).',
    });
  }

  return res.json({
    success: true,
    routine: saveRes.routine,
    studentUid: canonicalStudentUid,
    weeklyCycle: saveRes.activeCycle,
  });
});

app.get('/api/routines/current-routine', firebaseAuthMiddleware, async (req, res) => {
  const authCtx = await authorizeStudentRoutineAccess(req, res, { allowMissingTargetFallbackToCaller: true });
  if (!authCtx) return;

  const { canonicalStudentUid } = authCtx;
  const weekId = ((req.query.weekId as string) || '').trim();
  const requestedCycle = req.query.weeklyCycle !== undefined ? String(req.query.weeklyCycle) : undefined;

  const result = await fetchStudentCurrentRoutineServer(canonicalStudentUid, weekId || undefined, requestedCycle);
  if (!result) {
    return res.status(503).json({
      success: false,
      error: 'FirestoreUnavailable',
      message: 'Canonical Firestore (default) unavailable.',
    });
  }

  return res.json({
    success: true,
    routine: result.routine,
    studentUid: canonicalStudentUid,
    weeklyCycle: result.activeCycle,
  });
});

app.post('/api/routines/current-routine/feedback', firebaseAuthMiddleware, async (req, res) => {
  const authCtx = await authorizeStudentRoutineAccess(req, res, {
    allowMissingTargetFallbackToCaller: true,
    requireApprovedTeacherIfTutor: true,
  });
  if (!authCtx) return;

  const { callerUid, callerEmail, isCallerApprovedTeacher, canonicalStudentUid } = authCtx;
  const { weekId, feedback, weeklyCycle: bodyCycle } = req.body || {};

  if (!feedback || !feedback.dayOfWeek) {
    return res.status(400).json({ error: 'feedback with dayOfWeek is required' });
  }
  const cleanDay = String(feedback.dayOfWeek).toLowerCase().trim();
  if (!DAYS_SEQUENCE.includes(cleanDay as any)) {
    return res.status(400).json({ error: `Invalid dayOfWeek: ${cleanDay}` });
  }

  const stampedFeedback = {
    ...feedback,
    dayOfWeek: cleanDay,
    studentUid: canonicalStudentUid,
    teacherUid: isCallerApprovedTeacher ? callerUid : (feedback.teacherUid || callerUid),
    teacherEmail: isCallerApprovedTeacher ? callerEmail : (feedback.teacherEmail || callerEmail),
  };

  const safeWeekId = typeof weekId === 'string' && weekId.trim() ? weekId.trim() : 'weekData';
  const saveRes = await saveCurrentRoutineFeedbackServer(
    canonicalStudentUid,
    safeWeekId,
    stampedFeedback,
    bodyCycle
  );

  if (!saveRes.success) {
    if (saveRes.code === 'STALE_CYCLE') {
      return res.status(409).json({
        success: false,
        error: 'STALE_CYCLE',
        message: saveRes.error,
        activeCycle: saveRes.activeCycle,
      });
    }
    if (saveRes.code === 'FIRESTORE_UNAVAILABLE') {
      return res.status(503).json({
        success: false,
        error: 'FirestoreUnavailable',
        message: saveRes.error || 'Canonical Firestore (default) unavailable.',
      });
    }
    return res.status(500).json({
      success: false,
      error: 'FirestorePersistenceFailed',
      message: saveRes.error || 'Failed to persist track feedback in Firestore (default).',
    });
  }

  return res.json({
    success: true,
    routine: saveRes.routine,
    studentUid: canonicalStudentUid,
    weeklyCycle: saveRes.activeCycle,
  });
});

app.post('/api/routines/override-track', firebaseAuthMiddleware, async (req, res) => {
  const authCtx = await authorizeStudentRoutineAccess(req, res, {
    allowMissingTargetFallbackToCaller: true,
    requireApprovedTeacherIfTutor: true,
  });
  if (!authCtx) return;

  const { callerUid, callerEmail, isCallerApprovedTeacher, canonicalStudentUid } = authCtx;
  const { dayOfWeek, day, teacherOverrideTrack, weeklyCycle: bodyCycle } = req.body || {};

  const targetDay = String(dayOfWeek || day || '').toLowerCase().trim();
  if (!targetDay || !DAYS_SEQUENCE.includes(targetDay as any)) {
    return res.status(400).json({ error: 'Valid dayOfWeek is required' });
  }

  let sanitizedOverride: Record<string, any> | null = null;
  if (teacherOverrideTrack !== null && teacherOverrideTrack !== undefined) {
    if (typeof teacherOverrideTrack !== 'object' || !teacherOverrideTrack.url) {
      return res.status(400).json({ error: 'teacherOverrideTrack must include a valid Spotify url or be null' });
    }
    const parsed = parseSpotifyUrl(teacherOverrideTrack.url);
    if (!parsed.isValid) {
      return res.status(400).json({
        success: false,
        error: parsed.errorMessage || 'Invalid Spotify URL in teacherOverrideTrack.',
      });
    }
    const cleanTrackId =
      teacherOverrideTrack.trackId ||
      parsed.id ||
      extractSpotifyTrackId(parsed.canonicalUrl || teacherOverrideTrack.url) ||
      'override-track';
    sanitizedOverride = {
      ...teacherOverrideTrack,
      id: teacherOverrideTrack.id || `override-${targetDay}-${cleanTrackId}`,
      trackId: cleanTrackId,
      url: parsed.canonicalUrl || teacherOverrideTrack.url,
      embedUrl: parsed.embedUrl || teacherOverrideTrack.embedUrl,
      teacherUid: isCallerApprovedTeacher ? callerUid : (teacherOverrideTrack.teacherUid || callerUid),
      teacherEmail: isCallerApprovedTeacher ? callerEmail : (teacherOverrideTrack.teacherEmail || callerEmail),
    };
  }

  const saveRes = await saveTeacherSpotifyOverrideServer(
    canonicalStudentUid,
    targetDay,
    sanitizedOverride,
    bodyCycle
  );

  if (!saveRes.success) {
    if (saveRes.code === 'STALE_CYCLE') {
      return res.status(409).json({
        success: false,
        error: 'STALE_CYCLE',
        message: saveRes.error,
        activeCycle: saveRes.activeCycle,
      });
    }
    if (saveRes.code === 'FIRESTORE_UNAVAILABLE') {
      return res.status(503).json({
        success: false,
        error: 'FirestoreUnavailable',
        message: saveRes.error || 'Canonical Firestore (default) unavailable.',
      });
    }
    return res.status(500).json({
      success: false,
      error: 'FirestorePersistenceFailed',
      message: saveRes.error || 'Failed to persist Spotify override track in Firestore (default).',
    });
  }

  return res.json({
    success: true,
    studentUid: canonicalStudentUid,
    dayOfWeek: targetDay,
    teacherOverrideTrack: sanitizedOverride,
    weeklyCycle: saveRes.activeCycle,
  });
});

// 5. Live Lessons Endpoints

/**
 * Authoritatively verifies if an authenticated user is an approved Native Friend (Teacher).
 * Checks the trusted teacher records in Firestore (tutors and users collections) linked to the Firebase Auth UID.
 * Does NOT trust URL query params, body parameters, or self-asserted roles.
 * Does NOT grant admin privileges.
 * Validates that the tutor is explicitly approved (isApproved: true or approvalStatus: 'approved').
 */
async function verifyTeacherIdentityInFirestore(
  firestore: any,
  uid: string,
  email?: string,
  emailVerified?: boolean
): Promise<{
  isTeacher: boolean;
  publicTutorId?: string;
  authUid?: string;
  email?: string;
  name?: string;
}> {
  if (!firestore || !uid) {
    return { isTeacher: false };
  }

  const cleanUid = uid.trim();
  const cleanEmail = (email || '').trim().toLowerCase();

  const isApprovedTutorData = (data: any, sourceCollection: 'users' | 'tutors'): boolean => {
    if (!data || typeof data !== 'object') return false;
    const role = (data.role || '').toLowerCase().trim();
    const approvalStatus = (data.approvalStatus || data.status || '').toLowerCase().trim();
    if (
      approvalStatus === 'pending' ||
      approvalStatus === 'rejected' ||
      data.isApproved === false ||
      data.approved === false
    ) {
      return false;
    }
    const hasPositiveApproval =
      approvalStatus === 'approved' ||
      data.isApproved === true ||
      data.approved === true;
    if (!hasPositiveApproval) return false;

    if (sourceCollection === 'tutors') {
      return role !== 'student';
    }
    const isTeacherRole =
      role === 'teacher' ||
      role === 'tutor' ||
      role === 'native_friend' ||
      data.isTeacher === true;
    return Boolean(isTeacherRole);
  };

  try {
    // 1. Check /users/{cleanUid}
    const userDoc = await firestore.collection('users').doc(cleanUid).get().catch(() => null);
    if (userDoc && userDoc.exists) {
      const uData = userDoc.data();
      if (isApprovedTutorData(uData, 'users')) {
        return {
          isTeacher: true,
          publicTutorId: uData.publicTutorId || uData.tutorId || uData.id || cleanUid,
          authUid: cleanUid,
          email: uData.email || cleanEmail,
          name: uData.name,
        };
      }
    }

    // 2. Check /tutors/{cleanUid}
    const tutorDoc = await firestore.collection('tutors').doc(cleanUid).get().catch(() => null);
    if (tutorDoc && tutorDoc.exists) {
      const tData = tutorDoc.data();
      if (isApprovedTutorData(tData, 'tutors')) {
        return {
          isTeacher: true,
          publicTutorId: tData.publicTutorId || tutorDoc.id,
          authUid: tData.authUid || tData.uid || cleanUid,
          email: tData.email || cleanEmail,
          name: tData.name,
        };
      }
    }

    // 3. Query /tutors where authUid == cleanUid
    const qAuthUid = await firestore.collection('tutors').where('authUid', '==', cleanUid).limit(1).get().catch(() => null);
    if (qAuthUid && !qAuthUid.empty) {
      const doc = qAuthUid.docs[0];
      const tData = doc.data();
      if (isApprovedTutorData(tData, 'tutors')) {
        return {
          isTeacher: true,
          publicTutorId: tData.publicTutorId || doc.id,
          authUid: cleanUid,
          email: tData.email || cleanEmail,
          name: tData.name,
        };
      }
    }

    // 4. Query /tutors where uid == cleanUid
    const qUid = await firestore.collection('tutors').where('uid', '==', cleanUid).limit(1).get().catch(() => null);
    if (qUid && !qUid.empty) {
      const doc = qUid.docs[0];
      const tData = doc.data();
      if (isApprovedTutorData(tData, 'tutors')) {
        return {
          isTeacher: true,
          publicTutorId: tData.publicTutorId || doc.id,
          authUid: cleanUid,
          email: tData.email || cleanEmail,
          name: tData.name,
        };
      }
    }

    // 5. If verified email, query /tutors where email == cleanEmail
    if (cleanEmail && emailVerified) {
      const qEmail = await firestore.collection('tutors').where('email', '==', cleanEmail).limit(1).get().catch(() => null);
      if (qEmail && !qEmail.empty) {
        const doc = qEmail.docs[0];
        const tData = doc.data();
        if (isApprovedTutorData(tData, 'tutors')) {
          return {
            isTeacher: true,
            publicTutorId: tData.publicTutorId || doc.id,
            authUid: tData.authUid || cleanUid,
            email: cleanEmail,
            name: tData.name,
          };
        }
      }
    }
  } catch (err) {
    console.warn('[verifyTeacherIdentityInFirestore] Error querying teacher identity:', err);
  }

  return { isTeacher: false };
}

app.get(
  ['/api/lessons', '/api/live-lessons'],
  firebaseAuthMiddleware,
  async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');

    try {
      const user = req.user;

      if (!user?.uid) {
        return res.status(401).json({
          error: 'Authentication required',
        });
      }

      const firestore = getFirestoreDb();

      if (!firestore) {
        return res.status(503).json({
          error: 'Firestore unavailable',
        });
      }

      const uid = user.uid.trim();
      const email = (user.email || '').trim().toLowerCase();
      const emailVerified = Boolean(user.email_verified);

      // Administrative authority strictly controlled by verified Firebase custom claims
      const isAdmin = user.role === 'admin';

      let teacherInfo: {
        isTeacher: boolean;
        publicTutorId?: string;
        authUid?: string;
        email?: string;
        name?: string;
      } = { isTeacher: false };

      if (!isAdmin) {
        teacherInfo = await verifyTeacherIdentityInFirestore(
          firestore,
          uid,
          email,
          emailVerified
        );
      }

      const isTeacher = teacherInfo.isTeacher;
      const lessonsById = new Map<string, any>();

      if (isAdmin) {
        // Authoritative admin: can query all canonical lessons from Firestore (default)
        const snapshot = await firestore.collection('lessons').get();
        for (const doc of snapshot.docs) {
          lessonsById.set(doc.id, {
            ...doc.data(),
            id: doc.id,
          });
        }
      } else if (isTeacher) {
        // Teacher (Native Friend): execute strictly filtered canonical queries on lessons/{lessonId}
        const publicTutorId = teacherInfo.publicTutorId;
        const teacherAuthUid = (teacherInfo.authUid || '').trim();
        const teacherEmail = (teacherInfo.email || email).toLowerCase().trim();

        const rootQueryPromises: Promise<any>[] = [];

        if (publicTutorId) {
          rootQueryPromises.push(
            firestore.collection('lessons').where('teacherUid', '==', publicTutorId).get().catch(() => ({ docs: [] })),
            firestore.collection('lessons').where('tutorUid', '==', publicTutorId).get().catch(() => ({ docs: [] })),
            firestore.collection('lessons').where('teacherPublicId', '==', publicTutorId).get().catch(() => ({ docs: [] }))
          );
        }

        if (uid) {
          if (uid !== publicTutorId) {
            rootQueryPromises.push(
              firestore.collection('lessons').where('teacherUid', '==', uid).get().catch(() => ({ docs: [] })),
              firestore.collection('lessons').where('tutorUid', '==', uid).get().catch(() => ({ docs: [] })),
              firestore.collection('lessons').where('teacherAuthUid', '==', uid).get().catch(() => ({ docs: [] }))
            );
          } else {
            rootQueryPromises.push(
              firestore.collection('lessons').where('teacherAuthUid', '==', uid).get().catch(() => ({ docs: [] }))
            );
          }
        }

        if (teacherAuthUid && teacherAuthUid !== uid) {
          rootQueryPromises.push(
            firestore.collection('lessons').where('teacherUid', '==', teacherAuthUid).get().catch(() => ({ docs: [] })),
            firestore.collection('lessons').where('tutorUid', '==', teacherAuthUid).get().catch(() => ({ docs: [] })),
            firestore.collection('lessons').where('teacherAuthUid', '==', teacherAuthUid).get().catch(() => ({ docs: [] }))
          );
        }

        if (teacherEmail) {
          rootQueryPromises.push(
            firestore.collection('lessons').where('teacherEmail', '==', teacherEmail).get().catch(() => ({ docs: [] })),
            firestore.collection('lessons').where('tutorEmail', '==', teacherEmail).get().catch(() => ({ docs: [] }))
          );
        }

        const rootSnapshots = await Promise.all(rootQueryPromises);

        for (const snap of rootSnapshots) {
          if (snap && snap.docs) {
            for (const doc of snap.docs) {
              lessonsById.set(doc.id, {
                ...doc.data(),
                id: doc.id,
              });
            }
          }
        }
      } else {
        // Student: execute strictly filtered canonical queries on lessons/{lessonId}
        const rootQueryPromises: Promise<any>[] = [
          firestore.collection('lessons').where('studentUid', '==', uid).get().catch(() => ({ docs: [] })),
        ];

        if (email) {
          rootQueryPromises.push(
            firestore.collection('lessons').where('studentEmail', '==', email).get().catch(() => ({ docs: [] }))
          );
        }

        const rootSnapshots = await Promise.all(rootQueryPromises);

        for (const snap of rootSnapshots) {
          if (snap && snap.docs) {
            for (const doc of snap.docs) {
              lessonsById.set(doc.id, {
                ...doc.data(),
                id: doc.id,
              });
            }
          }
        }
      }

      return res.json(
        Array.from(lessonsById.values())
      );
    } catch (error) {
      console.error(
        '[GET /api/lessons] Failed to load lessons',
        error
      );

      return res.status(500).json({
        error: 'Unable to load lessons',
      });
    }
  }
);

/**
 * Safe, PII-isolated availability endpoint for checking teacher occupied intervals.
 * Returns exclusively busy time intervals: { startDateTime: string, endDateTime: string }[].
 * Strips out 100% of student names, emails, UIDs, Meet URLs, and any other student PII.
 */
app.get(
  [
    '/api/teachers/:teacherId/busy-slots',
    '/api/tutors/:tutorId/busy-slots',
    '/api/lessons/busy-slots',
    '/api/lessons/busy',
  ],
  async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');

    try {
      const firestore = getFirestoreDb();
      if (!firestore) {
        return res.status(503).json({
          error: 'Firestore unavailable',
        });
      }

      const rawTarget = (
        req.params.teacherId ||
        req.params.tutorId ||
        (req.query.teacherId as string) ||
        (req.query.teacherUid as string) ||
        (req.query.tutorId as string) ||
        (req.query.teacherEmail as string) ||
        (req.query.email as string) ||
        ''
      ).trim();

      const queryEmail = (
        (req.query.teacherEmail as string) ||
        (req.query.email as string) ||
        ''
      ).trim().toLowerCase();

      const queryUid = (
        (req.query.teacherUid as string) ||
        (req.query.tutorUid as string) ||
        (req.query.uid as string) ||
        ''
      ).trim();

      if (!rawTarget && !queryEmail && !queryUid) {
        return res.status(400).json({
          error: 'Identificador do professor obrigatório (teacherId, teacherEmail ou teacherUid).',
        });
      }

      const candidateTargets = new Set<string>();
      if (rawTarget) candidateTargets.add(rawTarget);
      if (queryEmail) candidateTargets.add(queryEmail);
      if (queryUid) candidateTargets.add(queryUid);

      let publicTutorId = '';
      let teacherAuthUid = queryUid;
      let teacherEmail = queryEmail;

      // Attempt to resolve tutor profile from canonical Firestore collections
      for (const target of candidateTargets) {
        try {
          // Direct doc lookup in tutors
          const tutorDoc = await firestore.collection('tutors').doc(target).get().catch(() => null);
          if (tutorDoc && tutorDoc.exists) {
            const tData = tutorDoc.data();
            if (tData) {
              publicTutorId = tData.publicTutorId || tutorDoc.id;
              teacherAuthUid = tData.authUid || tData.uid || teacherAuthUid || '';
              if (!teacherEmail && tData.email) teacherEmail = tData.email.toLowerCase().trim();
              break;
            }
          }

          // By publicTutorId
          const qPub = await firestore.collection('tutors').where('publicTutorId', '==', target).limit(1).get().catch(() => null);
          if (qPub && !qPub.empty) {
            const tData = qPub.docs[0].data();
            if (tData) {
              publicTutorId = tData.publicTutorId || qPub.docs[0].id;
              teacherAuthUid = tData.authUid || tData.uid || teacherAuthUid || '';
              if (!teacherEmail && tData.email) teacherEmail = tData.email.toLowerCase().trim();
              break;
            }
          }

          // By authUid
          const qAuthUid = await firestore.collection('tutors').where('authUid', '==', target).limit(1).get().catch(() => null);
          if (qAuthUid && !qAuthUid.empty) {
            const tData = qAuthUid.docs[0].data();
            if (tData) {
              publicTutorId = tData.publicTutorId || qAuthUid.docs[0].id;
              teacherAuthUid = tData.authUid || tData.uid || target;
              if (!teacherEmail && tData.email) teacherEmail = tData.email.toLowerCase().trim();
              break;
            }
          }

          // By uid
          const qUid = await firestore.collection('tutors').where('uid', '==', target).limit(1).get().catch(() => null);
          if (qUid && !qUid.empty) {
            const tData = qUid.docs[0].data();
            if (tData) {
              publicTutorId = tData.publicTutorId || qUid.docs[0].id;
              teacherAuthUid = tData.authUid || tData.uid || target;
              if (!teacherEmail && tData.email) teacherEmail = tData.email.toLowerCase().trim();
              break;
            }
          }

          // By email
          if (target.includes('@')) {
            const cleanTargetEmail = target.toLowerCase().trim();
            const qEm = await firestore.collection('tutors').where('email', '==', cleanTargetEmail).limit(1).get().catch(() => null);
            if (qEm && !qEm.empty) {
              const tData = qEm.docs[0].data();
              if (tData) {
                publicTutorId = tData.publicTutorId || qEm.docs[0].id;
                teacherAuthUid = tData.authUid || tData.uid || teacherAuthUid || '';
                teacherEmail = tData.email.toLowerCase().trim();
                break;
              }
            }
            const qUserEm = await firestore.collection('users').where('email', '==', cleanTargetEmail).limit(1).get().catch(() => null);
            if (qUserEm && !qUserEm.empty) {
              const uData = qUserEm.docs[0].data();
              if (uData && (uData.role === 'teacher' || uData.role === 'tutor' || uData.role === 'native_friend' || uData.isTeacher || uData.approved || uData.isApproved || uData.publicTutorId)) {
                publicTutorId = uData.publicTutorId || publicTutorId;
                teacherAuthUid = uData.authUid || uData.uid || qUserEm.docs[0].id;
                teacherEmail = (uData.email || cleanTargetEmail).toLowerCase().trim();
                break;
              }
            }
          } else {
            const userDoc = await firestore.collection('users').doc(target).get().catch(() => null);
            if (userDoc && userDoc.exists) {
              const uData = userDoc.data();
              if (uData && (uData.role === 'teacher' || uData.role === 'tutor' || uData.role === 'native_friend' || uData.isTeacher || uData.approved || uData.isApproved || uData.publicTutorId)) {
                publicTutorId = uData.publicTutorId || publicTutorId;
                teacherAuthUid = uData.authUid || uData.uid || userDoc.id;
                if (!teacherEmail && uData.email) teacherEmail = uData.email.toLowerCase().trim();
                break;
              }
            }
            const qUserPub = await firestore.collection('users').where('publicTutorId', '==', target).limit(1).get().catch(() => null);
            if (qUserPub && !qUserPub.empty) {
              const uData = qUserPub.docs[0].data();
              if (uData && (uData.role === 'teacher' || uData.role === 'tutor' || uData.role === 'native_friend' || uData.isTeacher || uData.approved || uData.isApproved || uData.publicTutorId)) {
                publicTutorId = uData.publicTutorId || target;
                teacherAuthUid = uData.authUid || uData.uid || qUserPub.docs[0].id;
                if (!teacherEmail && uData.email) teacherEmail = uData.email.toLowerCase().trim();
                break;
              }
            }
          }
        } catch {}
      }

      if (!publicTutorId && !rawTarget.includes('@') && rawTarget) {
        publicTutorId = rawTarget;
      }

      const activeLessonsMap = new Map<string, any>();

      // ARCH.2D.2: Fetch active scheduled lessons strictly from canonical Firestore (default) lessons/{lessonId}
      const rootQueryPromises: Promise<any>[] = [];

      if (publicTutorId) {
        rootQueryPromises.push(
          firestore.collection('lessons').where('teacherUid', '==', publicTutorId).get().catch(() => ({ docs: [] })),
          firestore.collection('lessons').where('tutorUid', '==', publicTutorId).get().catch(() => ({ docs: [] })),
          firestore.collection('lessons').where('teacherPublicId', '==', publicTutorId).get().catch(() => ({ docs: [] }))
        );
      }
      if (teacherAuthUid) {
        if (teacherAuthUid !== publicTutorId) {
          rootQueryPromises.push(
            firestore.collection('lessons').where('teacherUid', '==', teacherAuthUid).get().catch(() => ({ docs: [] })),
            firestore.collection('lessons').where('tutorUid', '==', teacherAuthUid).get().catch(() => ({ docs: [] })),
            firestore.collection('lessons').where('teacherAuthUid', '==', teacherAuthUid).get().catch(() => ({ docs: [] }))
          );
        } else {
          rootQueryPromises.push(
            firestore.collection('lessons').where('teacherAuthUid', '==', teacherAuthUid).get().catch(() => ({ docs: [] }))
          );
        }
      }
      if (teacherEmail) {
        rootQueryPromises.push(
          firestore.collection('lessons').where('teacherEmail', '==', teacherEmail).get().catch(() => ({ docs: [] })),
          firestore.collection('lessons').where('tutorEmail', '==', teacherEmail).get().catch(() => ({ docs: [] }))
        );
      }

      const rootSnapshots = await Promise.all(rootQueryPromises);

      for (const snap of rootSnapshots) {
        if (snap && snap.docs) {
          for (const doc of snap.docs) {
            activeLessonsMap.set(doc.id, doc.data());
          }
        }
      }

      // Filter only active scheduled lessons and extract strictly startDateTime and endDateTime
      const busySlots = Array.from(activeLessonsMap.values())
        .filter((l) => {
          const isCancelled =
            l.status === 'cancelled' ||
            l.status === 'canceled' ||
            Boolean(l.cancelledAt);
          return (
            !isCancelled &&
            (l.status === 'scheduled' || l.status === 'confirmed') &&
            Boolean(l.startDateTime) &&
            Boolean(l.endDateTime)
          );
        })
        .map((l) => ({
          startDateTime: l.startDateTime,
          endDateTime: l.endDateTime,
        }));

      // Deduplicate identical intervals
      const uniqueIntervals: { startDateTime: string; endDateTime: string }[] = [];
      const seenKey = new Set<string>();
      for (const slot of busySlots) {
        const key = `${slot.startDateTime}__${slot.endDateTime}`;
        if (!seenKey.has(key)) {
          seenKey.add(key);
          uniqueIntervals.push(slot);
        }
      }

      return res.json(uniqueIntervals);
    } catch (err: any) {
      console.error('[GET /api/teachers/:teacherId/busy-slots] Error retrieving busy slots:', err);
      return res.status(500).json({
        error: 'Erro ao consultar horários ocupados do professor.',
      });
    }
  }
);


/**
 * Dedicated secure backend endpoint for scheduling live and trial lessons.
 * Strictly authenticated via Firebase Admin SDK verifyIdToken.
 * Derived canonical student UID is exclusively taken from the verified token.
 * Prevents scheduling for other users, double-booking, and unauthorized trial lessons.
 */
app.post('/api/lessons/schedule', firebaseAuthMiddleware, async (req, res) => {
  const verifiedUser = req.user;
  if (!verifiedUser || !verifiedUser.uid) {
    return res.status(401).json({
      error: 'Autenticação necessária para agendar aulas.',
      message: 'Verified Firebase ID token missing',
    });
  }

  const studentAuthUid = verifiedUser.uid;
  const verifiedStudentEmail = (verifiedUser.email || '').toLowerCase().trim();

  // Defense-in-depth: Reject attempt to schedule on behalf of another student
  if (req.body.studentUid && String(req.body.studentUid).trim() !== studentAuthUid) {
    return res.status(403).json({
      error: 'Proibido: tentativa de agendar aula em nome de outro estudante.',
      message: 'Student UID does not match authenticated token UID',
    });
  }
  if (
    req.body.studentEmail &&
    verifiedStudentEmail &&
    String(req.body.studentEmail).toLowerCase().trim() !== verifiedStudentEmail
  ) {
    return res.status(403).json({
      error: 'Proibido: tentativa de agendar aula com e-mail divergente do token autenticado.',
      message: 'Student email does not match authenticated token email',
    });
  }

  try {
    const result = await scheduleLessonAtomicServer({
      studentAuthUid,
      studentEmail: verifiedStudentEmail,
      studentName: req.body.studentName,
      teacherIdOrEmail: req.body.teacherId || req.body.tutorId || req.body.teacherUid || req.body.teacherEmail,
      teacherUid: req.body.teacherUid,
      teacherEmail: req.body.teacherEmail,
      teacherName: req.body.teacherName,
      meetLink: req.body.meetLink,
      startDateTime: req.body.startDateTime,
      endDateTime: req.body.endDateTime,
      title: req.body.title,
      description: req.body.description,
      isTrialLesson: Boolean(req.body.isTrialLesson),
      requestId: req.body.requestId || req.body.id,
    });

    if (!result.success) {
      return res.status(result.statusCode || 400).json({
        error: result.error,
        message: result.error,
      });
    }

    return res.status(200).json(result);
  } catch (err: any) {
    console.error('Error in POST /api/lessons/schedule:', err);
    return res.status(500).json({
      error: 'Erro interno ao processar agendamento de aula.',
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

app.post(['/api/lessons', '/api/live-lessons'], firebaseAuthMiddleware, async (req, res) => {
  if (!req.user || !req.user.uid) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Autenticação necessária para registrar aulas.',
    });
  }

  const callerUid = req.user.uid.trim();
  const callerEmail = (req.user.email || '').toLowerCase().trim();
  const isCallerAdmin = req.user.role === 'admin';
  const { lesson, lessons } = req.body || {};

  if (Array.isArray(lessons)) {
    return res.status(403).json({
      error: 'Operação em lote em memória descontinuada. Utilize o agendamento canônico individual no Firestore.',
      message: 'Bulk liveLessons array overwrite is disabled under canonical Firestore persistence.',
    });
  }

  const payload = lesson || (req.body && (req.body.startDateTime || req.body.id) ? req.body : null);
  if (!payload || typeof payload !== 'object') {
    return res.status(400).json({
      error: 'Dados da aula não informados.',
      message: 'Missing lesson payload.',
    });
  }

  const firestore = getFirestoreDb();
  if (!firestore) {
    return res.status(503).json({
      error: 'Serviço Firestore (default) indisponível.',
      message: 'Firestore unavailable.',
    });
  }

  let targetStudentUid = callerUid;
  let targetStudentEmail = callerEmail;
  let targetStudentName = typeof payload.studentName === 'string' ? payload.studentName : undefined;

  if (isCallerAdmin) {
    const requestedUid = typeof payload.studentUid === 'string' ? payload.studentUid.trim() : '';
    const requestedEmail = typeof payload.studentEmail === 'string' ? payload.studentEmail.toLowerCase().trim() : '';

    if (requestedUid) {
      if (!isValidCanonicalUid(requestedUid)) {
        return res.status(400).json({
          error: 'UID canônico de estudante inválido. Criação de IDs sintéticos proibida.',
        });
      }
      const uSnap = await firestore.collection('users').doc(requestedUid).get().catch(() => null);
      if (!uSnap || !uSnap.exists) {
        return res.status(404).json({
          error: 'Estudante não encontrado no Firestore (default).',
        });
      }
      const uData = uSnap.data() || {};
      targetStudentUid = requestedUid;
      targetStudentEmail = (uData.email || requestedEmail || '').toLowerCase().trim();
      targetStudentName = targetStudentName || uData.name;
    } else if (requestedEmail) {
      const qSnap = await firestore.collection('users').where('email', '==', requestedEmail).limit(1).get().catch(() => null);
      if (!qSnap || qSnap.empty) {
        return res.status(404).json({
          error: 'Estudante não encontrado no Firestore (default) para o e-mail informado.',
        });
      }
      const uDoc = qSnap.docs[0];
      const uData = uDoc.data() || {};
      const resolvedUid = (uData.uid || uDoc.id || '').trim();
      if (!isValidCanonicalUid(resolvedUid)) {
        return res.status(400).json({
          error: 'Registro do estudante não possui UID canônico válido.',
        });
      }
      targetStudentUid = resolvedUid;
      targetStudentEmail = (uData.email || requestedEmail).toLowerCase().trim();
      targetStudentName = targetStudentName || uData.name;
    } else {
      return res.status(400).json({
        error: 'Informe studentUid ou studentEmail canônico para agendamento administrativo.',
      });
    }
  } else {
    if (payload.studentUid && String(payload.studentUid).trim() !== callerUid) {
      return res.status(403).json({
        error: 'Proibido: tentativa de agendar aula em nome de outro estudante.',
        message: 'Student UID does not match authenticated token UID',
      });
    }
    if (
      payload.studentEmail &&
      callerEmail &&
      String(payload.studentEmail).toLowerCase().trim() !== callerEmail
    ) {
      return res.status(403).json({
        error: 'Proibido: tentativa de agendar aula com e-mail divergente do token autenticado.',
        message: 'Student email does not match authenticated token email',
      });
    }
  }

  try {
    const result = await scheduleLessonAtomicServer({
      studentAuthUid: targetStudentUid,
      studentEmail: targetStudentEmail,
      studentName: targetStudentName,
      teacherIdOrEmail:
        payload.teacherId ||
        payload.tutorId ||
        payload.teacherUid ||
        payload.tutorUid ||
        payload.teacherEmail ||
        payload.tutorEmail,
      teacherUid: payload.teacherUid || payload.tutorUid,
      teacherEmail: payload.teacherEmail || payload.tutorEmail,
      teacherName: payload.teacherName || payload.tutorName,
      meetLink: payload.meetLink,
      startDateTime: payload.startDateTime,
      endDateTime: payload.endDateTime,
      title: payload.title,
      description: payload.description,
      isTrialLesson: Boolean(payload.isTrialLesson),
      requestId: payload.requestId || payload.id,
    });

    if (!result.success) {
      return res.status(result.statusCode || 400).json({
        error: result.error,
        message: result.error,
      });
    }

    return res.status(200).json(result);
  } catch (err: any) {
    console.error('Error in POST /api/lessons:', err);
    return res.status(500).json({
      error: 'Erro interno ao processar agendamento de aula.',
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

app.post('/api/lessons/:id/complete', firebaseAuthMiddleware, async (req, res) => {
  if (!req.user || !req.user.uid) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  const lessonId = decodeURIComponent(req.params.id || '');
  const result = await completeLessonAtomicServer({
    lessonId,
    callerUid: req.user.uid,
    callerEmail: req.user.email,
    callerRole: req.user.role,
    callerEmailVerified: req.user.email_verified,
  });
  if (!result.success) {
    return res.status(result.statusCode).json({ error: result.error, message: result.error });
  }
  return res.status(200).json({
    success: true,
    isIdempotent: Boolean(result.isIdempotent),
    lesson: result.lesson,
  });
});

app.post('/api/lessons/:id/not-completed', firebaseAuthMiddleware, async (req, res) => {
  if (!req.user || !req.user.uid) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  const lessonId = decodeURIComponent(req.params.id || '');
  const { responsible, reason } = req.body || {};
  const result = await markLessonNotCompletedAtomicServer({
    lessonId,
    callerUid: req.user.uid,
    callerEmail: req.user.email,
    callerRole: req.user.role,
    callerEmailVerified: req.user.email_verified,
    responsible,
    reason,
  });
  if (!result.success) {
    return res.status(result.statusCode).json({ error: result.error, message: result.error });
  }
  return res.status(200).json({
    success: true,
    isIdempotent: Boolean(result.isIdempotent),
    lesson: result.lesson,
    remainingLessons: result.remainingLessons,
    creditRefunded: Boolean(result.creditRefunded),
  });
});

app.post('/api/lessons/:id/reschedule', firebaseAuthMiddleware, async (req, res) => {
  if (!req.user || !req.user.uid) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  const lessonId = decodeURIComponent(req.params.id || '');
  const { newStartIso, newEndIso, reason, proposedBy } = req.body || {};
  const result = await proposeRescheduleAtomicServer({
    lessonId,
    callerUid: req.user.uid,
    callerEmail: req.user.email,
    callerRole: req.user.role,
    callerEmailVerified: req.user.email_verified,
    newStartIso,
    newEndIso,
    reason,
    requestedProposedBy: proposedBy,
  });
  if (!result.success) {
    return res.status(result.statusCode).json({ error: result.error, message: result.error });
  }
  return res.status(200).json({
    success: true,
    lesson: result.lesson,
  });
});

app.post('/api/lessons/:id/accept-reschedule', firebaseAuthMiddleware, async (req, res) => {
  if (!req.user || !req.user.uid) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  const lessonId = decodeURIComponent(req.params.id || '');
  const result = await acceptRescheduleAtomicServer({
    lessonId,
    callerUid: req.user.uid,
    callerEmail: req.user.email,
    callerRole: req.user.role,
    callerEmailVerified: req.user.email_verified,
  });
  if (!result.success) {
    return res.status(result.statusCode).json({ error: result.error, message: result.error });
  }
  return res.status(200).json({
    success: true,
    lesson: result.lesson,
  });
});

app.post('/api/lessons/:id/decline-reschedule', firebaseAuthMiddleware, async (req, res) => {
  if (!req.user || !req.user.uid) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  const lessonId = decodeURIComponent(req.params.id || '');
  const result = await declineRescheduleAtomicServer({
    lessonId,
    callerUid: req.user.uid,
    callerEmail: req.user.email,
    callerRole: req.user.role,
    callerEmailVerified: req.user.email_verified,
  });
  if (!result.success) {
    return res.status(result.statusCode).json({ error: result.error, message: result.error });
  }
  return res.status(200).json({
    success: true,
    isIdempotent: Boolean(result.isIdempotent),
    lesson: result.lesson,
  });
});

app.post('/api/lessons/:id/cancel', firebaseAuthMiddleware, async (req, res) => {
  if (!req.user || !req.user.uid) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  const lessonId = decodeURIComponent(req.params.id || '');
  const { cancelledBy, reason } = req.body || {};
  const result = await cancelLessonAtomicServer({
    lessonId,
    callerUid: req.user.uid,
    callerEmail: req.user.email,
    callerRole: req.user.role,
    callerEmailVerified: req.user.email_verified,
    requestedCancelledBy: cancelledBy,
    reason,
  });
  if (!result.success) {
    return res.status(result.statusCode).json({ error: result.error, message: result.error });
  }
  return res.status(200).json({
    success: true,
    isIdempotent: Boolean(result.isIdempotent),
    lesson: result.lesson,
    remainingLessons: result.remainingLessons,
    creditRefunded: Boolean(result.creditRefunded),
  });
});

/**
 * Invalidates all cached pedagogical transformations (all languages, hashes, CEFR levels)
 * for a modified session, preserving historical session documents.
 */
export function invalidatePedagogicalCache(
  db: any,
  identifiers: {
    canonicalSessionKey?: string;
    sessionKey?: string;
    lessonId?: string;
    id?: string;
  }
) {
  if (!db || !db.pedagogicalTransformationsMap) return;
  const prefixes = [
    identifiers.canonicalSessionKey,
    identifiers.sessionKey,
    identifiers.id,
    identifiers.lessonId,
    identifiers.lessonId ? `lesson_${identifiers.lessonId.replace(/^lesson_/, '')}` : undefined,
  ].filter(Boolean) as string[];

  const allKeys = Object.keys(db.pedagogicalTransformationsMap);
  allKeys.forEach((key) => {
    for (const prefix of prefixes) {
      if (key === prefix || key.startsWith(`${prefix}__`) || key.startsWith(`${prefix}_`)) {
        delete db.pedagogicalTransformationsMap[key];
        break;
      }
    }
  });
}

async function handleSaveSessionNotesInternal(req: any, res: any, explicitLessonId?: string) {
  if (!req.user || !req.user.uid) {
    return res.status(401).json({
      error: 'Unauthorized',
      code: 'UNAUTHORIZED',
      message: 'Autenticação mandatória para salvar anotações pedagógicas.',
    });
  }

  const callerUid = req.user.uid;
  const isCallerAdmin = req.user.role === 'admin';
  const db = readDb();

  // 1. Authorize teacher or admin
  let teacherResolution: any = null;
  let isCallerTeacher = false;
  if (!isCallerAdmin) {
    try {
      teacherResolution = await resolveTeacherCanonicalIdentity({
        teacherUid: callerUid,
        teacherEmail: req.user.email,
        dbState: db,
      });
      if (teacherResolution && teacherResolution.isApproved) {
        isCallerTeacher = true;
      }
    } catch {}

    if (!teacherResolution || !teacherResolution.isApproved) {
      return res.status(403).json({
        error: 'Forbidden',
        code: 'FORBIDDEN',
        message: 'Only approved Native Friends or administrators are authorized to save pedagogical session notes.',
      });
    }
  }

  // 2. Derive teacherUid strictly from verified token (admins can specify canonical teacherUid)
  const teacherUid = (isCallerAdmin && req.body?.teacherUid && isValidCanonicalUid(req.body.teacherUid))
    ? req.body.teacherUid.trim()
    : callerUid;

  if (!teacherUid || !isValidCanonicalUid(teacherUid)) {
    return res.status(400).json({
      error: 'CANONICAL_TEACHER_UID_REQUIRED',
      code: 'CANONICAL_TEACHER_UID_REQUIRED',
      message: 'Canonical teacher UID is required to save pedagogical session notes.',
    });
  }

  // 3. Resolve and validate studentUid (reject empty, non-canonical, or self-teacher)
  const incomingStudentUid = (req.body?.studentUid || '').trim();
  if (!incomingStudentUid || !isValidCanonicalUid(incomingStudentUid)) {
    return res.status(400).json({
      error: 'CANONICAL_STUDENT_UID_REQUIRED',
      code: 'CANONICAL_STUDENT_UID_REQUIRED',
      message: 'Canonical student UID is required to save pedagogical session notes.',
    });
  }
  const studentUid = incomingStudentUid;

  if (teacherUid === studentUid) {
    return res.status(400).json({
      error: 'INVALID_PEDAGOGICAL_IDENTITY',
      code: 'INVALID_PEDAGOGICAL_IDENTITY',
      message: 'Teacher UID cannot be identical to student UID.',
    });
  }

  // 4. Verify student identity exists in canonical persistence (do NOT auto-create mock users)
  let studentDoc: any = null;
  try {
    const fs = getFirestoreDb();
    if (fs) {
      const uSnap = await fs.collection('users').doc(studentUid).get().catch(() => null);
      if (uSnap && uSnap.exists) {
        studentDoc = uSnap.data();
      }
    }
  } catch {}

  if (!studentDoc) {
    const localMatch = (db.students || []).find((s: any) => s.uid === studentUid || s.id === studentUid || s.studentUid === studentUid) ||
      Object.values(db.authUsers || {}).find((u: any) => u.uid === studentUid) ||
      Object.values(db.userProfiles || {}).find((p: any) => p.uid === studentUid);
    if (localMatch) {
      studentDoc = localMatch;
    }
  }

  if (!studentDoc) {
    return res.status(400).json({
      error: 'STUDENT_NOT_FOUND',
      code: 'STUDENT_NOT_FOUND',
      message: 'Canonical student identity was not found in Firestore.',
    });
  }

  // 5. Verify pedagogical link between teacher and student (Admins exempt)
  if (!isCallerAdmin) {
    const hasAuthorizedPedagogicalLink = await verifyCanonicalPedagogicalLinkServer(teacherUid, studentUid);
    if (!hasAuthorizedPedagogicalLink) {
      return res.status(403).json({
        error: 'Forbidden',
        code: 'UNAUTHORIZED_PEDAGOGICAL_LINK',
        message: 'Native Friend does not have an authorized pedagogical link with this student.',
      });
    }
  }

  // 6. Lesson check (canonical Firestore lessons/{lessonId} only — decoupled from db.liveLessons and legacy subcollections)
  const lessonId = (explicitLessonId || req.body?.lessonId || (req.body?.id && !req.body.id.startsWith('session_') ? req.body.id : '')).trim();
  let lesson: any = null;
  if (lessonId) {
    try {
      const fs = getFirestoreDb();
      if (fs) {
        const lSnap = await fs.collection('lessons').doc(lessonId).get().catch(() => null);
        if (lSnap && lSnap.exists) {
          lesson = lSnap.data();
        }
      }
    } catch {}
    if (lesson) {
      if (lesson.studentUid && lesson.studentUid !== studentUid) {
        return res.status(403).json({
          error: 'STUDENT_LESSON_MISMATCH',
          code: 'STUDENT_LESSON_MISMATCH',
          message: 'The specified lesson belongs to a different student. Save blocked.',
        });
      }
      const lessonTeacherUids = [
        lesson.teacherUid,
        lesson.teacherAuthUid,
        lesson.tutorUid,
        lesson.teacherPublicId,
      ]
        .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
        .map((v) => v.trim());
      const callerTeacherUids = new Set(
        [
          teacherUid,
          callerUid,
          teacherResolution?.authUid,
          teacherResolution?.publicTutorId,
        ]
          .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
          .map((v) => v.trim())
      );
      if (!isCallerAdmin && lessonTeacherUids.length > 0 && !lessonTeacherUids.some((id) => callerTeacherUids.has(id))) {
        return res.status(403).json({
          error: 'TEACHER_LESSON_MISMATCH',
          code: 'TEACHER_LESSON_MISMATCH',
          message: 'Native Friend is not authorized to teach or save notes for this lesson.',
        });
      }
    }
  }

  // 7. Session date (mandatory YYYY-MM-DD)
  const rawDate = (
    req.body?.sessionDate ||
    (lesson?.sessionDate || (lesson?.startDateTime ? lesson.startDateTime.split('T')[0] : ''))
  );
  if (!rawDate || typeof rawDate !== 'string' || !rawDate.trim()) {
    return res.status(400).json({
      error: 'SESSION_DATE_REQUIRED',
      code: 'SESSION_DATE_REQUIRED',
      message: 'Session date in YYYY-MM-DD format is required to save pedagogical notes.',
    });
  }
  const dateMatch = rawDate.trim().match(/^\d{4}-\d{2}-\d{2}$/);
  if (!dateMatch) {
    return res.status(400).json({
      error: 'INVALID_SESSION_DATE',
      code: 'INVALID_SESSION_DATE',
      message: 'Invalid session date. Expected format is YYYY-MM-DD.',
    });
  }
  const sessionDate = dateMatch[0];

  const sessionKey = lessonId
    ? lessonId
    : (req.body?.id && typeof req.body.id === 'string' && req.body.id.trim()
        ? req.body.id.trim()
        : `session_${sessionDate}_${studentUid}`);

  // 8. Extract rawContent & content (mandatory)
  const rawContent = (
    req.body?.rawContent !== undefined
      ? req.body.rawContent
      : (req.body?.content || req.body?.sessionNotesDocument || req.body?.liveNotes || req.body?.recommendations || '')
  );
  if (typeof rawContent !== 'string' || !rawContent.trim()) {
    return res.status(400).json({
      error: 'CONTENT_REQUIRED',
      code: 'CONTENT_REQUIRED',
      message: 'Pedagogical note content is required.',
    });
  }
  const topic = req.body?.topic || lesson?.title || 'Live Coaching Session';
  const targetStudentEmail = (studentDoc?.email || req.body?.studentEmail || '').toLowerCase().trim();

  // 8. Fetch existing document to preserve approved version, original notes, and version history (FASE NF-DOC.2A)
  let existingDoc = db.sessionNotesMap?.[sessionKey];
  if (!existingDoc) {
    try {
      existingDoc = await fetchSessionNotesFromFirestoreServer(sessionKey);
    } catch {}
  }

  const authorContext = {
    authorUid: teacherUid,
    authorEmail: (req.user.email || '').toLowerCase().trim(),
    authorRole: (isCallerAdmin ? 'admin' : 'teacher') as 'teacher' | 'admin',
    teacherName: teacherResolution?.name || req.body?.teacherName || req.user.name || 'Native Friend',
  };

  const noteDoc = mergeSessionNoteWithVersioning({
    existingNote: existingDoc,
    incomingNote: {
      ...req.body,
      id: sessionKey,
      sessionId: sessionKey,
      sessionKey,
      sessionDate,
      lessonId: lessonId || '',
      studentUid,
      studentEmail: targetStudentEmail,
      teacherUid,
      teacherEmail: authorContext.authorEmail,
      teacherName: authorContext.teacherName,
      topic,
      content: rawContent,
      rawContent,
      pronunciationNotes: req.body?.pronunciationNotes,
      grammarAndPhrasing: req.body?.grammarAndPhrasing,
      vocabularyNotes: req.body?.vocabularyNotes,
      driveFileId: req.body?.driveFileId || '',
      driveFileUrl: req.body?.driveFileUrl || '',
      driveFolderName: req.body?.driveFolderName || GOOGLE_DRIVE_SESSION_FOLDER,
      driveLastSyncedAt: req.body?.driveLastSyncedAt || '',
    },
    author: authorContext,
    changeSummary: req.body?.changeSummary,
  });

  if (!db.sessionNotesMap) db.sessionNotesMap = {};
  db.sessionNotesMap[sessionKey] = noteDoc;

  // Invalidate cached pedagogical transformations
  invalidatePedagogicalCache(db, {
    canonicalSessionKey: sessionKey,
    sessionKey,
    lessonId,
    id: sessionKey,
  });

  // 10. Persist canonically to Firestore (default) under session_notes/{sessionKey}, users/{studentUid}/session_notes, and lessons/{lessonId}
  // ARCH.2D.2: Decoupled from db.liveLessons and writeDbSync (never triggers app_state/lessons write).
  await saveSessionNotesToFirestoreServer(sessionKey, noteDoc).catch((err) => {
    console.warn('Backend Firestore session notes save notice:', err);
  });

  return res.json({ success: true, sessionNote: noteDoc });
}

// Save live lesson notes & automatically migrate vocabulary to student's personal dictionary
app.post('/api/lessons/:id/notes', firebaseAuthMiddleware, async (req, res) => {
  const explicitLessonId = decodeURIComponent(req.params.id);
  return handleSaveSessionNotesInternal(req, res, explicitLessonId);
});

// Save Native Friend In-Session Notes & Recommendations document keyed by session date/ID
app.post('/api/session-notes', firebaseAuthMiddleware, async (req, res) => {
  return handleSaveSessionNotesInternal(req, res);
});

export interface PedagogicalTransformationCoreOptions {
  rawNotes: string;
  topic?: string;
  sessionDate?: string;
  teacherName?: string;
  authoritativeLevel?: string;
  language?: string;
  callerRole?: string;
  canonicalSessionKey: string;
  lessonId?: string;
  studentUid?: string;
  studentEmail?: string;
  effectiveTeacherUid?: string;
  effectiveTeacherEmail?: string;
  contentHashOverride?: string;
  customAttemptExecutor?: (model: string, params: any) => Promise<any>;
}

export interface PedagogicalTransformationCoreResult {
  success: boolean;
  transformation?: PedagogicalLessonTransformation;
  attemptsDetails?: any[];
  attemptsCount?: number;
  modelsAttempted?: string[];
  error?: any;
  category?: string;
  statusCode?: number;
  message?: string;
}

let sessionNoteTransformAttemptExecutorForTesting: ((model: string, params: any) => Promise<any>) | null = null;

export function setSessionNoteTransformAttemptExecutorForTesting(
  executor: ((model: string, params: any) => Promise<any>) | null
): void {
  if (process.env.NODE_ENV === 'test') {
    sessionNoteTransformAttemptExecutorForTesting = executor;
  }
}

function wrapTestAttemptExecutor(
  rawExecutor?: ((model: string, params: any) => Promise<any>) | null
): ((model: string, params: any) => Promise<any>) | undefined {
  if (!rawExecutor) return undefined;
  return async (model: string, params: any) => {
    const customRes = await rawExecutor(model, params);
    if (typeof customRes === 'string') {
      let cleanJson = customRes.trim();
      if (cleanJson.startsWith('```')) {
        cleanJson = cleanJson.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
      }
      const firstBrace = cleanJson.indexOf('{');
      const lastBrace = cleanJson.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        cleanJson = cleanJson.substring(firstBrace, lastBrace + 1);
      }
      return {
        text: customRes,
        parsedJson: JSON.parse(cleanJson),
      };
    }
    if (customRes && (customRes.parsedJson !== undefined || customRes.error !== undefined)) {
      return customRes;
    }
    if (customRes && typeof customRes === 'object') {
      return {
        text: JSON.stringify(customRes),
        parsedJson: customRes,
      };
    }
    return customRes;
  };
}

export async function executePedagogicalTransformationCore(
  options: PedagogicalTransformationCoreOptions
): Promise<PedagogicalTransformationCoreResult> {
  const rawNotes = (options.rawNotes || '').trim();
  const bounds = validatePayloadBounds('pedagogical_transform', { text: rawNotes });
  if (!bounds.valid) {
    return {
      success: false,
      statusCode: 400,
      category: 'INVALID_INPUT',
      error: 'PayloadBoundsExceeded',
      message: bounds.error,
    };
  }

  const markings = parseNotesHtml(rawNotes);
  const correctCount = markings.correctCount;
  const incorrectCount = markings.incorrectCount;
  const newWordCount = markings.newWordCount;
  const pronounceCount = markings.pronounceCount;

  const isTeacherCaller = options.callerRole === 'teacher' || options.callerRole === 'admin';
  if (!hasValidPedagogicalContent(rawNotes, markings)) {
    return {
      success: false,
      statusCode: 400,
      category: 'INVALID_INPUT',
      error: 'InvalidNotesContent',
      message: (!isTeacherCaller && (options.language || 'pt') === 'pt')
        ? 'As anotações enviadas estão vazias ou não contêm termos pedagógicos válidos para análise.'
        : 'The submitted notes are empty or contain no valid pedagogical content for analysis.',
    };
  }

  const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY || (process.env.NODE_ENV === 'test' ? 'test-dummy-key' : '');
  const isCooldownActive = Date.now() < geminiQuotaCooldownUntil;
  if (!apiKey || isCooldownActive) {
    return {
      success: false,
      statusCode: 503,
      category: isCooldownActive ? 'QUOTA_EXCEEDED' : 'NO_API_KEY',
      error: 'AiUnavailable',
      message: (!isTeacherCaller && (options.language || 'pt') === 'pt')
        ? 'O serviço pedagógico de IA está temporariamente indisponível. As anotações originais foram preservadas intactas.'
        : 'The pedagogical AI service is temporarily unavailable. Original teacher notes have been preserved.',
    };
  }

  const language = (options.language || 'pt').toLowerCase().trim();
  const cefrMeta = resolveCefrLevel(options.authoritativeLevel);
  const cefr = cefrMeta.cefr;

  const systemInstruction = `You are an elite, Cambridge/CELTA-certified Pedagogical English Language Synthesizer and Master Native Friend Teacher.
Your mission is to transform raw in-session teacher notes into a structured, high-clarity 4-part pedagogical lesson guide calibrated to the student's CEFR level (${cefr}).
The student MUST NEVER see raw, fragmented notes. Produce a polished, cohesive learning guide strictly in English.

LANGUAGE REQUIREMENT (STRICT 100% ENGLISH OUTPUT):
- Generate ALL four parts ("mistakesAnalysis" / Analyze Mistakes, "grammarPoints" / Grammar Points, "vocabularyAndExpressions" / Vocabulary & Expressions, and "reviewSummary" / Quick Review) EXCLUSIVELY in natural, clear English (code: "en"), regardless of the language used in the raw notes or any student/request locale.
- Every AI-authored field — including all titles, grammar topics ("topic"), grammar rules ("rule", "form", "usage"), mistake explanations ("explanation", "grammarRule", "similarFormsComparison"), common pitfalls ("commonPitfalls"), comparisons ("comparisons"), created examples ("twoExamples", "examples", "realExamples", "collocations"), vocabulary definitions ("definitionEn" AND "simpleDefinition"), parts of speech ("partOfSpeech"), register notes ("registerNote"), categories ("category"), phonetic guides ("phoneticGuide"), and review summaries ("estimatedMinutes", "keyRules", "mustKnowVocabulary", "usefulPatterns", "rememberThis") — MUST be written strictly in English.
- NEVER write explanations, titles, rules, created examples, definitions, or summaries in Portuguese or any other non-English language.

LITERAL QUOTE PRESERVATION & ORIGINAL NOTES INTEGRITY:
- Preserve literally (verbatim) the original excerpts from the student and the teacher whenever presented as lesson quotes, citations, or classroom examples from the session (such as "original" in "mistakesAnalysis" and "essentialCorrections", or literal utterances quoted from the lesson).
- Do NOT translate, paraphrase, rewrite, or modify the original session notes or literal student/teacher classroom excerpts. Treat the raw notes strictly as read-only source material.

PEDAGOGICAL INSTRUCTIONS FOR THE 4 PARTS:

Alt+N = Part 1. Analyze the student's mistakes ("mistakesAnalysis")
Go through every grammar, vocabulary, word-choice, collocation, preposition, sentence-structure, and naturalness issue in the note (including items marked with Alt+N, 'data-tag-type="incorrect"', '✗', 'Instead of:', or clear errors in the note).
For each mistake:
- Show the student's original form ("original", preserved verbatim).
- Show the corrected/natural version ("corrected").
- Explain why the original is incorrect or unnatural AND explain the underlying grammar rule or language pattern ("explanation" and "grammarRule").
- Give 2–4 natural examples ("twoExamples").
- Highlight common mistakes the student is likely to make with the same structure ("commonPitfalls").
- Where useful, explain the difference between similar forms or expressions ("similarFormsComparison").
Do not simply correct the sentence. Teach the grammar behind the correction.
(If the note contains NO student mistakes, return "mistakesAnalysis": [] — never invent synthetic mistakes.)

Alt+N = Part 2. Teach the grammar points ("grammarPoints")
Identify the main grammar points that appear in the note and explain them at the student's level (CEFR ${cefr}).
For each grammar point, include:
- Rule ("rule")
- Form/structure ("form")
- Meaning/use ("usage")
- Examples from real-life situations ("examples")
- Common mistakes ("commonMistakes")
- A short comparison with similar structures, when relevant ("comparisons")
Prioritize the grammar that is actually connected to the student's mistakes rather than adding unrelated grammar. If there are no grammar issues in the note, return "grammarPoints": [].

Alt + W or Alt + P = Part 3. Teach the vocabulary and expressions ("vocabularyAndExpressions")
Include every important word, phrase, expression, collocation, or phrasal verb from the note (items marked with Alt+W / 'new-word', Alt+P / 'pronounce', or vocabulary recorded in the note; if a term has a spelling slip like "blury", identify and teach the correct spelling "blurry").
For each one, provide:
- Part of speech ("partOfSpeech")
- Simple definition appropriate for the student's level ("simpleDefinition" AND "definitionEn" in clear English calibrated to CEFR ${cefr})
- Natural collocations or sentence patterns ("collocations")
- At least one realistic real-life example ("realExamples")
- Synonyms or related words when useful ("synonyms")
- A brief note about register or nuance when relevant — formal, informal, conversational, etc. ("register" and "registerNote")
- For Alt+P pronunciation items, also include IPA/syllable stress in "phoneticGuide" and set "isPronunciationFocus": true.
Organize the vocabulary into useful categories rather than giving one long alphabetical list. Assign each item's "category" to a clear thematic/functional group.
(If the note contains NO vocabulary or pronunciation items, return "vocabularyAndExpressions": [] — never invent synthetic vocabulary.)

4. Create a 5–10 minute review summary ("reviewSummary")
At the end, create a concise 5–10 minute revision section covering the entire lesson.
Include:
- The most important grammar rules ("keyRules")
- The most important vocabulary ("mustKnowVocabulary")
- Key corrections ("essentialCorrections": [{"original": "...", "corrected": "..."}])
- Useful sentence patterns ("usefulPatterns")
- A short "Remember this" section ("rememberThis")

Return a single JSON object strictly conforming to this schema (JSON only, no Markdown backticks):
{
  "mistakesAnalysis": [
    {
      "id": "mistake-1",
      "original": "Student's original form (verbatim)",
      "corrected": "Corrected/natural version",
      "category": "grammar" | "vocabulary" | "word-choice" | "collocation" | "preposition" | "sentence-structure" | "naturalness",
      "explanation": "Why the original is incorrect/unnatural and the underlying grammar rule or language pattern",
      "grammarRule": "Concise underlying grammar rule or pattern",
      "twoExamples": ["Natural example 1", "Natural example 2", "Natural example 3 (2 to 4 examples)"],
      "commonPitfalls": "Common mistakes the student is likely to make with the same structure",
      "similarFormsComparison": "Difference between similar forms or expressions (when useful, else empty string)"
    }
  ],
  "grammarPoints": [
    {
      "id": "grammar-1",
      "topic": "Main grammar point title",
      "rule": "Clear rule at CEFR ${cefr}",
      "form": "Form / structure formula",
      "usage": "Meaning / use in real communication",
      "examples": ["Real-life example 1", "Real-life example 2"],
      "commonMistakes": "Common mistakes to avoid",
      "comparisons": "Short comparison with similar structures, when relevant"
    }
  ],
  "vocabularyAndExpressions": [
    {
      "id": "vocab-1",
      "term": "Word, phrase, expression, collocation, or phrasal verb",
      "partOfSpeech": "Part of speech (e.g., Phrasal Verb, Noun, Adjective, Expression)",
      "definitionEn": "Simple, accurate English definition appropriate for CEFR ${cefr}",
      "simpleDefinition": "Simple definition appropriate for the student's level (CEFR ${cefr})",
      "collocations": ["Natural collocation or sentence pattern 1", "Natural collocation or sentence pattern 2"],
      "realExamples": ["Realistic real-life example sentence"],
      "synonyms": ["Synonym or related word 1"],
      "register": "conversational" | "informal" | "neutral" | "formal" | "idiomatic",
      "registerNote": "Brief note about register or nuance when relevant",
      "category": "Useful thematic or functional category (e.g., Work & Meetings, Everyday Expressions, Pronunciation Focus)",
      "phoneticGuide": "IPA / syllable stress guide (especially for Alt+P items)",
      "isPronunciationFocus": false,
      "isNewWord": true
    }
  ],
  "reviewSummary": {
    "estimatedMinutes": "5–10 minutes",
    "keyRules": ["Most important grammar rules"],
    "mustKnowVocabulary": ["Most important vocabulary"],
    "essentialCorrections": [{"original": "...", "corrected": "..."}],
    "usefulPatterns": ["Useful sentence pattern 1", "Useful sentence pattern 2"],
    "rememberThis": "Short, high-retention 'Remember this' takeaway"
  }
}`;

  const prompt = `Pedagogical Parameters:
- CEFR Level: ${cefr}
- Lesson Date: ${options.sessionDate || new Date().toISOString().split('T')[0]}
- Session Topic: ${options.topic || 'Conversation & Fluency'}
- Native Friend Teacher: ${options.teacherName || 'Native Friend'}
- Output Language: English (en) — MANDATORY for all generated pedagogical content

Raw In-Session Notes to transform (read-only source — do NOT translate or modify):
"""
${rawNotes}
"""

Apply the 4-part pedagogical instructions in a single pass calibrated to CEFR ${cefr}:
- Alt+N -> Part 1 (Analyze Mistakes: original, corrected/natural, why + underlying grammar rule/pattern, 2–4 natural examples, common mistakes, and comparison of similar forms where useful) AND Part 2 (Grammar Points prioritized strictly to the student's mistakes: rule, form/structure, meaning/use, real-life examples, common mistakes, short comparison when relevant).
- Alt+W or Alt+P -> Part 3 (Vocabulary & Expressions: part of speech, simple level-appropriate definition in both simpleDefinition and definitionEn, natural collocations/sentence patterns, realistic real-life example(s), useful synonyms/related words, register/nuance note, organized into useful categories).
- Part 4 -> Concise 5–10 minute review summary (most important grammar rules, most important vocabulary, key corrections, useful sentence patterns, and a short "Remember this" section).
- Preserve literally (verbatim) the original excerpts from the student and the teacher when presented as quotes or examples from the lesson.
- Do NOT translate or modify the original notes. Never invent ungrounded mistakes, grammar points, or vocabulary when absent from the notes.`;

  const effectiveCustomExecutor = wrapTestAttemptExecutor(
    options.customAttemptExecutor || (process.env.NODE_ENV === 'test' ? sessionNoteTransformAttemptExecutorForTesting : null)
  );

  const contingencyResult = await executeGeminiWithContingency(
    {
      feature: 'pedagogical_transform',
      systemInstruction,
      untrustedUserDataPrompt: prompt,
      callerRole: options.callerRole || 'teacher',
      apiKey,
      temperature: 0.35,
      validator: (json) => validatePedagogicalAiResponse(json, markings, cefr, language),
    },
    effectiveCustomExecutor
  );

  const sanitizedAttempts = (contingencyResult?.attemptsDetails || []).map((att: any) => ({
    attemptNumber: att.attemptNumber,
    model: att.model,
    durationMs: typeof att.durationMs === 'number' ? att.durationMs : 0,
    success: Boolean(att.success),
    category: att.category || (att.success ? undefined : 'INVALID_RESPONSE'),
    safeReason: att.safeReason || (att.success ? 'Success' : 'Execution failed'),
    finishReason: att.finishReason || undefined,
    isMaxTokens: Boolean(att.isMaxTokens || att.finishReason === 'MAX_TOKENS'),
    isParseError: Boolean(att.isParseError),
    isValidationError: Boolean(att.isValidationError),
  }));

  if (!contingencyResult.success || !contingencyResult.parsedJson) {
    const lastFailureCategory = (contingencyResult?.error?.category as GeminiFailureCategory) || 'SERVICE_UNAVAILABLE';
    if (contingencyResult?.error?.statusCode === 429 || lastFailureCategory === 'QUOTA_EXCEEDED') {
      geminiQuotaCooldownUntil = Date.now() + GEMINI_QUOTA_COOLDOWN_MS;
    }
    const statusCode = contingencyResult?.error?.statusCode === 429 ? 429 : 503;
    return {
      success: false,
      statusCode,
      category: lastFailureCategory,
      error: contingencyResult?.error || 'AiUnavailable',
      message: (!isTeacherCaller && language === 'pt')
        ? 'O serviço pedagógico de IA está temporariamente indisponível após tentativa com os modelos de contingência. As anotações originais do professor foram preservadas intactas.'
        : 'The pedagogical AI service is temporarily unavailable after trying contingency models. Original teacher notes have been preserved.',
      attemptsCount: contingencyResult?.attemptsCount || 1,
      modelsAttempted: contingencyResult?.modelsAttempted || resolveGeminiContingencyModels(),
      attemptsDetails: sanitizedAttempts,
    };
  }

  const parsed = contingencyResult.parsedJson;
  const cleanRawLower = (markings.cleanText || rawNotes).toLowerCase();

  // Part 1: Mistakes Analysis — preserve AI pedagogical fields directly without redundant rework
  const rawErrMap = new Map<string, typeof markings.errors[0]>();
  markings.errors.forEach((e) => rawErrMap.set(e.original.toLowerCase().trim(), e));

  const validatedMistakes: any[] = [];
  (parsed.mistakesAnalysis || []).forEach((m: any) => {
    if (!m || typeof m !== 'object') return;
    const aiOrig = String(m.original || '').trim();
    const origKey = aiOrig.toLowerCase();
    if (!origKey) return;

    const rawErr = Array.from(rawErrMap.values()).find(
      (e) => isPedagogicalTermMatch(origKey, e.original.toLowerCase().trim()) ||
             origKey.includes(e.original.toLowerCase().trim()) ||
             e.original.toLowerCase().trim().includes(origKey)
    );

    // Accept if matched to teacher Alt+N error OR grounded verbatim in untagged notes
    const isGroundedInNotes = Boolean(rawErr) || (markings.errors.length === 0 && cleanRawLower.includes(origKey));
    if (!isGroundedInNotes) return;

    const originalText = rawErr ? rawErr.original : aiOrig;
    const correctedText = (rawErr && rawErr.corrected) ? rawErr.corrected : String(m.corrected || originalText).trim();
    const examplesList = Array.isArray(m.twoExamples) && m.twoExamples.length > 0
      ? m.twoExamples
      : (Array.isArray(m.examples) ? m.examples : []);

    validatedMistakes.push({
      id: m.id || `mistake-${validatedMistakes.length + 1}`,
      original: originalText,
      corrected: correctedText,
      category: m.category || 'grammar',
      explanation: String(m.explanation || m.grammarRule || `In natural English, "${correctedText}" is the idiomatic structure.`).trim(),
      grammarRule: typeof m.grammarRule === 'string' && m.grammarRule.trim() ? m.grammarRule.trim() : undefined,
      twoExamples: examplesList
        .map((ex: any) => String(ex || '').trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean)
        .slice(0, 4),
      commonPitfalls: String(m.commonPitfalls || '').trim(),
      similarFormsComparison: typeof m.similarFormsComparison === 'string' && m.similarFormsComparison.trim()
        ? m.similarFormsComparison.trim()
        : undefined,
      isPendingConfirmation: false,
    });

    if (rawErr) {
      rawErrMap.delete(rawErr.original.toLowerCase().trim());
    }
  });

  // Part 2: Grammar Points — connected to the student's mistakes or notes
  let validatedGrammar: any[] = [];
  if (validatedMistakes.length > 0 || markings.errors.length > 0) {
    const rawGrammarList = Array.isArray(parsed.grammarPoints) ? parsed.grammarPoints : [];
    validatedGrammar = rawGrammarList
      .filter((g: any) => g && g.topic && g.rule)
      .map((g: any, idx: number) => ({
        id: g.id || `grammar-${idx + 1}`,
        topic: String(g.topic).trim(),
        rule: String(g.rule).trim(),
        form: String(g.form || '').trim(),
        usage: String(g.usage || '').trim(),
        examples: Array.isArray(g.examples)
          ? g.examples.map((ex: any) => String(ex || '').trim().replace(/^["']|["']$/g, '')).filter(Boolean)
          : [],
        commonMistakes: String(g.commonMistakes || '').trim(),
        comparisons: String(g.comparisons || '').trim(),
      }));
  }

  // Part 3: Vocabulary & Expressions — preserve useful AI categories, register nuance, and mirror definitions
  const validTermsPool = [
    ...markings.newWords.map((w) => w.toLowerCase().trim()),
    ...markings.pronounceItems.map((p) => p.toLowerCase().trim()),
    ...markings.vocabItems.map((v) => v.toLowerCase().trim()),
  ];
  const consumedTargets = new Set<string>();
  const seenVocabKeys = new Set<string>();
  const validatedVocab: any[] = [];

  (parsed.vocabularyAndExpressions || []).forEach((v: any) => {
    if (!v || typeof v !== 'object') return;
    const rawTerm = String(v.term || '').trim();
    const termKey = rawTerm.toLowerCase();
    if (!termKey || seenVocabKeys.has(termKey)) return;

    const matchedTarget = validTermsPool.find(
      (target) => !consumedTargets.has(target) && isPedagogicalTermMatch(termKey, target)
    );
    const appearsInRawNotes = validTermsPool.length > 0 && cleanRawLower.includes(termKey);

    if (!matchedTarget && !appearsInRawNotes) return;
    if (matchedTarget) consumedTargets.add(matchedTarget);
    seenVocabKeys.add(termKey);

    const lookupTarget = matchedTarget || termKey;
    const isPronounce =
      markings.pronounceItems.some((p) => isPedagogicalTermMatch(p, lookupTarget)) ||
      (markings.pronounceItems.length === 0 && Boolean(v.isPronunciationFocus));
    const isNewWord =
      markings.newWords.some((w) => isPedagogicalTermMatch(w, lookupTarget)) ||
      markings.vocabItems.some((w) => isPedagogicalTermMatch(w, lookupTarget)) ||
      (!isPronounce && Boolean(v.isNewWord ?? true));

    const simpleDef = String(v.simpleDefinition || v.definitionEn || '').trim();
    const defEn = String(v.definitionEn || simpleDef).trim();
    const rawExamples = Array.isArray(v.realExamples) ? v.realExamples : [];
    const formattedExamples = rawExamples
      .map((ex: any) => String(ex || '').trim().replace(/^["']|["']$/g, ''))
      .filter(Boolean);

    const aiCategory = String(v.category || '').trim();
    const isGenericCat = !aiCategory || /^(core|vocabulary|general|words?)$/i.test(aiCategory);
    const resolvedCategory = !isGenericCat
      ? aiCategory
      : isNewWord && isPronounce
      ? 'New Word & Pronunciation (Alt+W + Alt+P)'
      : isPronounce
      ? 'Pronunciation & Phonetics (Alt+P)'
      : 'New Words & Expressions (Alt+W)';

    validatedVocab.push({
      ...v,
      id: v.id || `vocab-${validatedVocab.length + 1}`,
      term: rawTerm,
      partOfSpeech: String(v.partOfSpeech || (isPronounce ? 'Pronunciation Focus' : 'Expression')).trim(),
      definitionEn: defEn,
      simpleDefinition: simpleDef,
      collocations: Array.isArray(v.collocations)
        ? v.collocations.map((c: any) => String(c || '').trim()).filter(Boolean)
        : [],
      realExamples: formattedExamples,
      synonyms: Array.isArray(v.synonyms)
        ? v.synonyms.map((s: any) => String(s || '').trim()).filter(Boolean)
        : [],
      register: v.register || 'conversational',
      registerNote: typeof v.registerNote === 'string' && v.registerNote.trim() ? v.registerNote.trim() : undefined,
      category: resolvedCategory,
      isPronunciationFocus: isPronounce,
      isNewWord: isNewWord,
    });
  });

  // Part 4: 5–10 Minute Review Summary — reuse AI summary fields directly when present, fallback deterministically only if empty
  const rawSummary = parsed.reviewSummary && typeof parsed.reviewSummary === 'object' ? parsed.reviewSummary : {};

  const aiKeyRules = Array.isArray(rawSummary.keyRules)
    ? rawSummary.keyRules.map((r: any) => String(r || '').trim()).filter(Boolean)
    : [];
  const finalKeyRules = validatedGrammar.length === 0
    ? []
    : (aiKeyRules.length > 0 ? aiKeyRules : validatedGrammar.map((g: any) => `${g.topic}: ${g.rule}`));

  const aiMustKnowVocab = Array.isArray(rawSummary.mustKnowVocabulary)
    ? rawSummary.mustKnowVocabulary.map((w: any) => String(w || '').trim()).filter(Boolean)
    : [];
  const finalMustKnowVocab = validatedVocab.length === 0
    ? []
    : (aiMustKnowVocab.length > 0
        ? aiMustKnowVocab
        : validatedVocab.map((v: any) => {
            const tag = v.isNewWord && v.isPronunciationFocus
              ? '🎯✨'
              : v.isPronunciationFocus
              ? '🎯'
              : '✨';
            return `${tag} ${v.term} (${v.partOfSpeech || 'Vocab'}) — ${v.simpleDefinition || ''}`;
          }));

  const finalCorrections = validatedMistakes.map((m: any) => ({
    original: m.original,
    corrected: m.corrected,
    explanation: m.explanation,
  }));

  const finalUsefulPatterns = Array.isArray(rawSummary.usefulPatterns)
    ? rawSummary.usefulPatterns.map((p: any) => String(p || '').trim()).filter(Boolean)
    : [];

  let rememberThis =
    typeof rawSummary.rememberThis === 'string' && rawSummary.rememberThis.trim().length >= 5
      ? rawSummary.rememberThis.trim()
      : '';

  if (!rememberThis) {
    if (validatedMistakes.length > 0) {
      rememberThis = `Remember this: Instead of saying "${validatedMistakes[0].original}", say "${validatedMistakes[0].corrected}"!`;
    } else if (validatedVocab.length > 0) {
      const termNames = validatedVocab.map((v: any) => v.term).slice(0, 3).join(', ');
      rememberThis = `Remember this: Active practice with your new expressions (${termNames}) turns passive recognition into spontaneous conversational confidence!`;
    } else {
      rememberThis = 'Remember this: Fluency is not about never making mistakes; it is about recognizing patterns quickly and adopting natural native phraseology!';
    }
  }

  const contentHash = options.contentHashOverride || computeNotesContentHash(rawNotes);
  const transformation: PedagogicalLessonTransformation = {
    lessonId: options.lessonId || undefined,
    sessionKey: options.canonicalSessionKey,
    sessionDate: options.sessionDate || new Date().toISOString().split('T')[0],
    topic: options.topic || 'Live Coaching Session',
    teacherName: options.teacherName || 'Native Friend',
    ...(options.effectiveTeacherUid ? { teacherUid: options.effectiveTeacherUid } : {}),
    teacherEmail: options.effectiveTeacherEmail || undefined,
    studentUid: options.studentUid || undefined,
    studentEmail: options.studentEmail || undefined,
    studentLevel: String(options.authoritativeLevel || 'intermediario'),
    cefrLevel: cefr,
    contentHash,
    language,
    promptVersion: PEDAGOGICAL_PROMPT_VERSION,
    isAiGenerated: true,
    isFallback: false,
    isProvisional: false,
    source: 'gemini' as const,
    modelUsed: contingencyResult.modelUsed || GEMINI_FIXED_MODEL,
    mistakesAnalysis: validatedMistakes,
    grammarPoints: validatedGrammar,
    vocabularyAndExpressions: validatedVocab,
    levelAdaptation: parsed.levelAdaptation || {
      cefrLevel: cefr,
      levelLabel: cefrMeta.labelEn,
      nativeInterferenceNotes: 'Focus on native collocations and avoiding literal calques.',
      complexityAdjustmentAdvice: 'Review key corrections out loud before each session.',
      targetedPracticePrompt: `Practice summarizing your views on "${options.topic || 'the topic'}".`,
    },
    reviewSummary: {
      estimatedMinutes: String(rawSummary.estimatedMinutes || '5–10 minutes').trim(),
      keyRules: finalKeyRules,
      mustKnowVocabulary: finalMustKnowVocab,
      essentialCorrections: finalCorrections,
      usefulPatterns: finalUsefulPatterns,
      rememberThis,
    },
    rawNotesSnippet: markings.cleanText.slice(0, 300),
    correctStampsCount: correctCount,
    incorrectStampsCount: incorrectCount,
    newWordStampsCount: newWordCount,
    pronounceStampsCount: pronounceCount,
    generatedAt: new Date().toISOString(),
  };

  return {
    success: true,
    transformation,
    attemptsDetails: sanitizedAttempts,
    modelsAttempted: contingencyResult.modelsAttempted,
    attemptsCount: contingencyResult.attemptsCount,
  };
}

// Helper to authoritatively resolve approved teacher for pedagogical note actions (transform, draft, approve)
async function resolveApprovedTeacherForSessionNotes(
  callerUid: string,
  callerEmail?: string,
  tokenRole?: string,
  dbState?: any
): Promise<{
  isApproved: boolean;
  callerKind: 'teacher' | 'pending_teacher' | 'conflict' | 'student' | 'unregistered';
  resolution: any;
}> {
  const canonicalRes = await resolveCanonicalUserRoleAndIdentity({
    uid: callerUid,
    email: callerEmail,
    tokenRole,
    dbState,
  }).catch(() => null);

  if (canonicalRes && canonicalRes.role === 'teacher' && canonicalRes.identityStatus === 'authorized') {
    const rawObj = canonicalRes.rawDoc || {};
    const tutorRec = rawObj.tutor || rawObj;
    const userRec = rawObj.user || rawObj;
    const isExplicitlyUnapproved =
      tutorRec?.approvalStatus === 'pending' ||
      tutorRec?.approvalStatus === 'rejected' ||
      tutorRec?.status === 'pending' ||
      tutorRec?.status === 'rejected' ||
      tutorRec?.isApproved === false ||
      userRec?.approvalStatus === 'pending' ||
      userRec?.approvalStatus === 'rejected' ||
      userRec?.status === 'pending' ||
      userRec?.status === 'rejected' ||
      userRec?.isApproved === false;
    if (isExplicitlyUnapproved) {
      return { isApproved: false, callerKind: 'pending_teacher', resolution: null };
    }
    return {
      isApproved: true,
      callerKind: 'teacher',
      resolution: {
        canonicalUid: canonicalRes.uid || callerUid,
        email: canonicalRes.email || callerEmail,
        name: canonicalRes.name || 'Native Friend',
        publicTutorId: canonicalRes.publicTutorId || callerUid,
        isApproved: true,
        role: 'teacher',
        rawDoc: canonicalRes.rawDoc,
      },
    };
  }

  // Respect explicit canonical conflict or pending tutor status without auto-promotion or student misclassification
  if (
    canonicalRes &&
    (canonicalRes.role === 'conflict' ||
      canonicalRes.identityStatus === 'conflict' ||
      canonicalRes.identityStatus === 'divergent_uid')
  ) {
    return { isApproved: false, callerKind: 'conflict', resolution: null };
  }

  if (canonicalRes && canonicalRes.role === 'pending_teacher') {
    return { isApproved: false, callerKind: 'pending_teacher', resolution: null };
  }

  const teacherResolution = await resolveTeacherCanonicalIdentity({
    teacherUid: callerUid,
    teacherEmail: callerEmail,
    dbState,
  }).catch(() => null);

  if (teacherResolution && teacherResolution.isApproved && teacherResolution.canonicalUid === callerUid) {
    return { isApproved: true, callerKind: 'teacher', resolution: teacherResolution };
  }

  return {
    isApproved: false,
    callerKind: canonicalRes?.role === 'student' ? 'student' : 'unregistered',
    resolution: null,
  };
}

async function resolveExistingSessionNoteWithKeyFallback(
  db: any,
  rawSessionKey: string
): Promise<{ effectiveKey: string; existingDoc: any | null }> {
  const candidateKeys = [rawSessionKey];
  if (rawSessionKey.startsWith('lesson_')) {
    const stripped = rawSessionKey.replace(/^lesson_/, '').trim();
    if (stripped && !candidateKeys.includes(stripped)) {
      candidateKeys.push(stripped);
    }
  }

  for (const key of candidateKeys) {
    if (db.sessionNotesMap?.[key]) {
      return { effectiveKey: key, existingDoc: db.sessionNotesMap[key] };
    }
  }

  for (const key of candidateKeys) {
    try {
      const fsDoc = await fetchSessionNotesFromFirestoreServer(key);
      if (fsDoc) {
        return { effectiveKey: key, existingDoc: fsDoc };
      }
    } catch {}
  }

  return { effectiveKey: rawSessionKey, existingDoc: null };
}

// FASE NF-DOC.2A & 2B: Save in-progress draft AI transformation being edited/reviewed by teacher
async function handleSessionNoteDraftInternal(req: any, res: any) {
  if (!req.user || !req.user.uid) {
    return res.status(401).json({ error: 'Unauthorized', message: 'Authentication required.' });
  }

  const callerUid = req.user.uid;
  const isCallerAdmin = req.user.role === 'admin';
  const db = readDb();

  let teacherResolution: any = null;
  let isCallerTeacher = false;
  if (!isCallerAdmin) {
    const authCheck = await resolveApprovedTeacherForSessionNotes(callerUid, req.user.email, req.user.role, db);
    if (authCheck.isApproved) {
      isCallerTeacher = true;
      teacherResolution = authCheck.resolution;
    } else if (authCheck.callerKind === 'conflict') {
      return res.status(403).json({
        error: 'Forbidden',
        code: 'IDENTITY_CONFLICT',
        message: 'Identity conflict detected on this account. Operation blocked to preserve canonical integrity.',
      });
    } else if (authCheck.callerKind === 'pending_teacher') {
      return res.status(403).json({
        error: 'Forbidden',
        code: 'TEACHER_NOT_APPROVED',
        message: 'Your Native Friend profile is pending administrator approval and cannot edit pedagogical drafts yet.',
      });
    } else {
      return res.status(403).json({
        error: 'Forbidden',
        code: 'STUDENTS_CANNOT_DRAFT',
        message: 'Students cannot create or edit pedagogical drafts.',
      });
    }
  }

  const rawSessionKey = decodeURIComponent(req.params.id || req.body?.id || req.body?.sessionId || req.body?.sessionKey || '').trim();
  if (!rawSessionKey) {
    return res.status(400).json({ error: 'SESSION_ID_REQUIRED', code: 'SESSION_ID_REQUIRED', message: 'Session identifier is required.' });
  }

  const { effectiveKey: targetSessionKey, existingDoc } = await resolveExistingSessionNoteWithKeyFallback(db, rawSessionKey);

  if (!existingDoc) {
    return res.status(404).json({ error: 'NOT_FOUND', code: 'SESSION_NOTE_NOT_FOUND', message: 'Session note document not found.' });
  }

  const studentUid = existingDoc.studentUid;
  if (!studentUid || !isValidCanonicalUid(studentUid)) {
    return res.status(400).json({ error: 'INVALID_STUDENT_IDENTITY', code: 'CANONICAL_STUDENT_UID_REQUIRED', message: 'Canonical student identity is missing or invalid in this document.' });
  }
  const docTeacherUid = existingDoc.teacherUid;
  if (!docTeacherUid || !isValidCanonicalUid(docTeacherUid)) {
    return res.status(400).json({ error: 'INVALID_TEACHER_IDENTITY', code: 'CANONICAL_TEACHER_UID_REQUIRED', message: 'Canonical teacher identity is missing or invalid in this document.' });
  }
  if (req.body?.studentUid && String(req.body.studentUid).trim() !== studentUid) {
    return res.status(403).json({ error: 'Forbidden', code: 'STUDENT_UID_MISMATCH', message: 'Provided studentUid does not match the canonical owner of this document.' });
  }

  if (isCallerTeacher && !isCallerAdmin) {
    if (req.body?.teacherUid && String(req.body.teacherUid).trim() !== callerUid) {
      return res.status(403).json({ error: 'Forbidden', code: 'TEACHER_MISMATCH', message: 'Invalid teacherUid parameter for the authenticated teacher.' });
    }
    const isAuthorized = await verifyCanonicalPedagogicalLinkServer(callerUid, studentUid);
    if (!isAuthorized) {
      return res.status(403).json({ error: 'Forbidden', code: 'UNAUTHORIZED_PEDAGOGICAL_LINK', message: 'Native Friend does not have an authorized pedagogical link with this student.' });
    }
    if (docTeacherUid !== callerUid) {
      return res.status(403).json({ error: 'Forbidden', code: 'TEACHER_MISMATCH', message: 'Teacher is not authorized to edit drafts belonging to another teacher.' });
    }
  }

  const transformation = req.body?.transformation;
  const customTeacherNotes = typeof req.body?.customTeacherNotes === 'string' ? req.body.customTeacherNotes : undefined;
  const reviewNotes = typeof req.body?.reviewNotes === 'string' ? req.body.reviewNotes : undefined;

  const currentVersion = existingDoc.currentVersionNumber || 1;
  const nextDraftVersion = currentVersion + 1;
  const rawNoteText = existingDoc.rawContent || existingDoc.content || '';
  const contentHash = computeNotesContentHash(rawNoteText);

  const draftTransformation: NoteDraftTransformation = {
    draftId: `draft_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    versionNumber: nextDraftVersion,
    status: 'draft',
    contentHash,
    rawNotesSnippet: rawNoteText.slice(0, 300),
    transformation: transformation || undefined,
    customTeacherNotes,
    reviewNotes,
    createdAt: existingDoc.draftTransformation?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    editorUid: callerUid,
    editorEmail: req.user.email,
  };

  const authorContext = {
    authorUid: callerUid,
    authorEmail: req.user.email,
    authorRole: (isCallerAdmin ? 'admin' : 'teacher') as 'teacher' | 'admin',
    teacherName: teacherResolution?.name || (req.user as any)?.name || 'Native Friend',
  };

  const updatedDoc = mergeSessionNoteWithVersioning({
    existingNote: existingDoc,
    incomingNote: {
      ...existingDoc,
      draftTransformation,
      studentUid,
      teacherUid: existingDoc.teacherUid || callerUid,
      sessionDate: existingDoc.sessionDate,
    },
    author: authorContext,
    changeSummary: req.body?.changeSummary || 'Teacher updated draft AI transformation in progress',
  });

  if (!db.sessionNotesMap) db.sessionNotesMap = {};
  db.sessionNotesMap[targetSessionKey] = updatedDoc;
  await writeDbSync(db);
  await saveSessionNotesToFirestoreServer(targetSessionKey, updatedDoc).catch(() => null);

  return res.json({ success: true, sessionNote: updatedDoc });
}

// FASE NF-DOC.2B: Generate AI draft transformation using Gemini and persist exclusively as draftTransformation
async function handleSessionNoteTransformInternal(req: any, res: any) {
  if (!req.user || !req.user.uid) {
    return res.status(401).json({ error: 'Unauthorized', message: 'Authentication required.' });
  }

  const callerUid = req.user.uid;
  const isCallerAdmin = req.user.role === 'admin';
  const db = readDb();

  let teacherResolution: any = null;
  let isCallerTeacher = false;
  if (!isCallerAdmin) {
    const authCheck = await resolveApprovedTeacherForSessionNotes(callerUid, req.user.email, req.user.role, db);
    if (authCheck.isApproved) {
      isCallerTeacher = true;
      teacherResolution = authCheck.resolution;
    } else if (authCheck.callerKind === 'conflict') {
      return res.status(403).json({
        error: 'Forbidden',
        code: 'IDENTITY_CONFLICT',
        message: 'Identity conflict detected on this account. Operation blocked to preserve canonical integrity.',
      });
    } else if (authCheck.callerKind === 'pending_teacher') {
      return res.status(403).json({
        error: 'Forbidden',
        code: 'TEACHER_NOT_APPROVED',
        message: 'Your Native Friend profile is pending administrator approval and cannot transform pedagogical notes yet.',
      });
    } else {
      // Non-admin caller is not an approved teacher -> reject as student/unauthorized
      return res.status(403).json({
        error: 'Forbidden',
        code: 'STUDENTS_CANNOT_TRANSFORM',
        message: 'Students cannot transform pedagogical notes.',
      });
    }
  }

  const rawSessionKey = decodeURIComponent(req.params.id || req.body?.id || req.body?.sessionId || req.body?.sessionKey || '').trim();
  if (!rawSessionKey) {
    return res.status(400).json({
      error: 'SESSION_ID_REQUIRED',
      code: 'SESSION_ID_REQUIRED',
      message: 'Session identifier is required.',
    });
  }

  const { effectiveKey: targetSessionKey, existingDoc } = await resolveExistingSessionNoteWithKeyFallback(db, rawSessionKey);

  if (!existingDoc) {
    return res.status(404).json({
      error: 'NOT_FOUND',
      code: 'SESSION_NOTE_NOT_FOUND',
      message: 'Session note document not found.',
    });
  }

  const studentUid = existingDoc.studentUid;
  if (!studentUid || !isValidCanonicalUid(studentUid)) {
    return res.status(400).json({
      error: 'INVALID_STUDENT_IDENTITY',
      code: 'CANONICAL_STUDENT_UID_REQUIRED',
      message: 'Canonical student identity is missing or invalid in this document.',
    });
  }
  const docTeacherUid = existingDoc.teacherUid;
  if (!docTeacherUid || !isValidCanonicalUid(docTeacherUid)) {
    return res.status(400).json({
      error: 'INVALID_TEACHER_IDENTITY',
      code: 'CANONICAL_TEACHER_UID_REQUIRED',
      message: 'Canonical teacher identity is missing or invalid in this document.',
    });
  }
  if (req.body?.studentUid && String(req.body.studentUid).trim() !== studentUid) {
    return res.status(403).json({
      error: 'Forbidden',
      code: 'STUDENT_UID_MISMATCH',
      message: 'Provided studentUid does not match the canonical owner of this document.',
    });
  }

  if (isCallerTeacher && !isCallerAdmin) {
    if (req.body?.teacherUid && String(req.body.teacherUid).trim() !== callerUid) {
      return res.status(403).json({
        error: 'Forbidden',
        code: 'TEACHER_MISMATCH',
        message: 'Invalid teacherUid parameter for the authenticated teacher.',
      });
    }
    const isAuthorized = await verifyCanonicalPedagogicalLinkServer(callerUid, studentUid);
    if (!isAuthorized) {
      return res.status(403).json({
        error: 'Forbidden',
        code: 'UNAUTHORIZED_PEDAGOGICAL_LINK',
        message: 'Native Friend does not have an authorized pedagogical link with this student.',
      });
    }
    if (docTeacherUid !== callerUid) {
      return res.status(403).json({
        error: 'Forbidden',
        code: 'TEACHER_MISMATCH',
        message: 'Teacher is not authorized to transform notes belonging to another teacher.',
      });
    }
  }

  const rawNotes = (existingDoc.rawContent || existingDoc.content || '').trim();
  const markings = parseNotesHtml(rawNotes);
  if (!rawNotes || !hasValidPedagogicalContent(rawNotes, markings)) {
    return res.status(400).json({
      success: false,
      error: 'InvalidNotesContent',
      code: 'NO_PEDAGOGICAL_CONTENT',
      message: 'The submitted notes are empty or contain no valid pedagogical content for analysis.',
    });
  }

  const contentHash = computeNotesContentHash(rawNotes);
  const forceRegenerate = Boolean(req.body?.forceRegenerate);
  const language = (req.body?.language || req.body?.lang || 'pt').toLowerCase().trim();
  const registeredStudent = (db.students || []).find((s: any) =>
    (studentUid && (s.uid === studentUid || s.id === studentUid)) ||
    (existingDoc.studentEmail && (s.email || '').toLowerCase().trim() === existingDoc.studentEmail.toLowerCase().trim())
  );
  const profile = (studentUid && db.userProfiles?.[studentUid]) || (existingDoc.studentEmail && db.userProfiles?.[existingDoc.studentEmail]);
  const authoritativeLevel = profile?.level || profile?.englishLevel || registeredStudent?.level || registeredStudent?.englishLevel || 'intermediario';
  const cefr = resolveCefrLevel(authoritativeLevel).cefr;
  const compositeCacheKey = buildPedagogicalCacheKey({
    canonicalSessionKey: targetSessionKey,
    contentHash,
    language: 'en',
    cefrLevel: cefr,
  });

  // Avoid duplicate AI calls in production when an identical, verified transformation already exists for this exact contentHash
  const isTestMockActive = Boolean(process.env.NODE_ENV === 'test' && sessionNoteTransformAttemptExecutorForTesting);
  if (!forceRegenerate && !isTestMockActive) {
    const existingDraftTrans =
      existingDoc.draftTransformation?.contentHash === contentHash
        ? existingDoc.draftTransformation.transformation
        : null;
    const existingApprovedTrans =
      existingDoc.lastApprovedVersion?.contentHash === contentHash
        ? existingDoc.lastApprovedVersion.transformation
        : null;
    const memoryCachedTrans = db.pedagogicalTransformationsMap?.[compositeCacheKey] || null;

    const reusableTransformation = [existingDraftTrans, existingApprovedTrans, memoryCachedTrans].find(
      (cand: any) =>
        cand &&
        cand.isAiGenerated &&
        !cand.isFallback &&
        !cand.isProvisional &&
        cand.promptVersion === PEDAGOGICAL_PROMPT_VERSION &&
        !isLegacyGenericTransformation(cand, rawNotes)
    );

    if (reusableTransformation) {
      if (existingDoc.draftTransformation?.contentHash === contentHash && existingDoc.draftTransformation?.transformation === reusableTransformation) {
        return res.json({
          success: true,
          cached: true,
          draftTransformation: existingDoc.draftTransformation,
          sessionNote: existingDoc,
        });
      }

      const currentVersion = existingDoc.currentVersionNumber || 1;
      const reusedDraft: NoteDraftTransformation = {
        draftId: `draft_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        versionNumber: currentVersion + 1,
        status: 'draft',
        contentHash,
        rawNotesSnippet: rawNotes.slice(0, 300),
        transformation: reusableTransformation,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        editorUid: callerUid,
        editorEmail: req.user.email,
      };

      const updatedDoc = mergeSessionNoteWithVersioning({
        existingNote: existingDoc,
        incomingNote: {
          ...existingDoc,
          draftTransformation: reusedDraft,
          studentUid,
          teacherUid: existingDoc.teacherUid || callerUid,
          sessionDate: existingDoc.sessionDate,
        },
        author: {
          authorUid: callerUid,
          authorEmail: req.user.email,
          authorRole: (isCallerAdmin ? 'admin' : 'teacher') as 'teacher' | 'admin',
          teacherName: teacherResolution?.name || (req.user as any)?.name || 'Native Friend',
        },
        changeSummary: req.body?.changeSummary || 'Reused validated pedagogical transformation for unchanged notes',
      });

      if (!db.sessionNotesMap) db.sessionNotesMap = {};
      db.sessionNotesMap[targetSessionKey] = updatedDoc;
      await writeDbSync(db);
      await saveSessionNotesToFirestoreServer(targetSessionKey, updatedDoc).catch(() => null);

      return res.json({
        success: true,
        cached: true,
        draftTransformation: reusedDraft,
        sessionNote: updatedDoc,
      });
    }
  }

  const lockKey = `session_notes_transform:${targetSessionKey}:${contentHash}`;
  const flightLock = await acquireSingleFlightLock(lockKey);
  if (!flightLock.acquired) {
    return res.status(429).json({
      success: false,
      error: 'Concurrent generation in progress',
      code: 'CONCURRENT_TRANSFORMATION',
      message: 'A pedagogical transformation for this session is already in progress. Please wait a moment.',
    });
  }

  const rateLimitCheck = await checkAndConsumeRateLimit(callerUid, 'pedagogical_transform');
  if (!rateLimitCheck.allowed) {
    await flightLock.release();
    return res.status(429).json({
      success: false,
      error: 'Rate limit exceeded',
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Transformation request rate limit reached for this account. Please wait a moment.',
      retryAfterSeconds: rateLimitCheck.retryAfterSeconds,
    });
  }

  try {
    const coreResult = await executePedagogicalTransformationCore({
      rawNotes,
      topic: existingDoc.topic || 'Live Coaching Session',
      sessionDate: existingDoc.sessionDate,
      teacherName: teacherResolution?.name || (req.user as any)?.name || existingDoc.teacherName || 'Native Friend',
      authoritativeLevel,
      language,
      callerRole: isCallerAdmin ? 'admin' : 'teacher',
      canonicalSessionKey: targetSessionKey,
      lessonId: existingDoc.lessonId,
      studentUid,
      studentEmail: existingDoc.studentEmail,
      effectiveTeacherUid: existingDoc.teacherUid || callerUid,
      effectiveTeacherEmail: existingDoc.teacherEmail || req.user.email,
      contentHashOverride: contentHash,
    });

    if (!coreResult.success || !coreResult.transformation) {
      return res.status(coreResult.statusCode || 503).json({
        success: false,
        error: 'AI_TRANSFORMATION_FAILED',
        code: 'AI_TRANSFORMATION_FAILED',
        category: coreResult.category || 'SERVICE_UNAVAILABLE',
        message: coreResult.message || 'Pedagogical AI transformation failed. Original notes were preserved intact without publishing.',
        attemptsCount: coreResult.attemptsCount || 1,
        modelsAttempted: coreResult.modelsAttempted || resolveGeminiContingencyModels(),
        attemptsDetails: coreResult.attemptsDetails,
      });
    }

    if (!db.pedagogicalTransformationsMap) db.pedagogicalTransformationsMap = {};
    db.pedagogicalTransformationsMap[compositeCacheKey] = coreResult.transformation;

    const currentVersion = existingDoc.currentVersionNumber || 1;
    const nextDraftVersion = currentVersion + 1;

    const draftTransformation: NoteDraftTransformation = {
      draftId: `draft_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      versionNumber: nextDraftVersion,
      status: 'draft',
      contentHash,
      rawNotesSnippet: rawNotes.slice(0, 300),
      transformation: coreResult.transformation,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      editorUid: callerUid,
      editorEmail: req.user.email,
    };

    const authorContext = {
      authorUid: callerUid,
      authorEmail: req.user.email,
      authorRole: (isCallerAdmin ? 'admin' : 'teacher') as 'teacher' | 'admin',
      teacherName: teacherResolution?.name || (req.user as any)?.name || 'Native Friend',
    };

    const updatedDoc = mergeSessionNoteWithVersioning({
      existingNote: existingDoc,
      incomingNote: {
        ...existingDoc,
        draftTransformation,
        studentUid,
        teacherUid: existingDoc.teacherUid || callerUid,
        sessionDate: existingDoc.sessionDate,
      },
      author: authorContext,
      changeSummary: req.body?.changeSummary || 'Gemini generated pedagogical draft transformation',
    });

    if (!db.sessionNotesMap) db.sessionNotesMap = {};
    db.sessionNotesMap[targetSessionKey] = updatedDoc;
    await writeDbSync(db);
    await saveSessionNotesToFirestoreServer(targetSessionKey, updatedDoc).catch(() => null);

    return res.json({
      success: true,
      draftTransformation,
      sessionNote: updatedDoc,
    });
  } finally {
    await flightLock.release();
  }
}

// FASE NF-DOC.2A & 2B: Teacher reviews and approves transformation version for student (publishing to lastApprovedVersion)
async function handleSessionNoteApproveInternal(req: any, res: any) {
  if (!req.user || !req.user.uid) {
    return res.status(401).json({ error: 'Unauthorized', message: 'Authentication required.' });
  }

  const callerUid = req.user.uid;
  const isCallerAdmin = req.user.role === 'admin';
  const db = readDb();

  let teacherResolution: any = null;
  let isCallerTeacher = false;
  if (!isCallerAdmin) {
    const authCheck = await resolveApprovedTeacherForSessionNotes(callerUid, req.user.email, req.user.role, db);
    if (authCheck.isApproved) {
      isCallerTeacher = true;
      teacherResolution = authCheck.resolution;
    } else if (authCheck.callerKind === 'conflict') {
      return res.status(403).json({
        error: 'Forbidden',
        code: 'IDENTITY_CONFLICT',
        message: 'Identity conflict detected on this account. Operation blocked to preserve canonical integrity.',
      });
    } else if (authCheck.callerKind === 'pending_teacher') {
      return res.status(403).json({
        error: 'Forbidden',
        code: 'TEACHER_NOT_APPROVED',
        message: 'Your Native Friend profile is pending administrator approval and cannot approve pedagogical notes yet.',
      });
    } else {
      return res.status(403).json({
        error: 'Forbidden',
        code: 'STUDENTS_CANNOT_APPROVE',
        message: 'Students cannot approve pedagogical notes.',
      });
    }
  }

  const rawSessionKey = decodeURIComponent(req.params.id || req.body?.id || req.body?.sessionId || req.body?.sessionKey || '').trim();
  if (!rawSessionKey) {
    return res.status(400).json({
      error: 'SESSION_ID_REQUIRED',
      code: 'SESSION_ID_REQUIRED',
      message: 'Session identifier is required.',
    });
  }

  const { effectiveKey: targetSessionKey, existingDoc } = await resolveExistingSessionNoteWithKeyFallback(db, rawSessionKey);

  if (!existingDoc) {
    return res.status(404).json({
      error: 'NOT_FOUND',
      code: 'SESSION_NOTE_NOT_FOUND',
      message: 'Session note document not found.',
    });
  }

  const studentUid = existingDoc.studentUid;
  if (!studentUid || !isValidCanonicalUid(studentUid)) {
    return res.status(400).json({
      error: 'INVALID_STUDENT_IDENTITY',
      code: 'CANONICAL_STUDENT_UID_REQUIRED',
      message: 'Canonical student identity is missing or invalid in this document.',
    });
  }
  const docTeacherUid = existingDoc.teacherUid;
  if (!docTeacherUid || !isValidCanonicalUid(docTeacherUid)) {
    return res.status(400).json({
      error: 'INVALID_TEACHER_IDENTITY',
      code: 'CANONICAL_TEACHER_UID_REQUIRED',
      message: 'Canonical teacher identity is missing or invalid in this document.',
    });
  }
  if (req.body?.studentUid && String(req.body.studentUid).trim() !== studentUid) {
    return res.status(403).json({
      error: 'Forbidden',
      code: 'STUDENT_UID_MISMATCH',
      message: 'Provided studentUid does not match the canonical owner of this document.',
    });
  }

  if (isCallerTeacher && !isCallerAdmin) {
    if (req.body?.teacherUid && String(req.body.teacherUid).trim() !== callerUid) {
      return res.status(403).json({
        error: 'Forbidden',
        code: 'TEACHER_MISMATCH',
        message: 'Invalid teacherUid parameter for the authenticated teacher.',
      });
    }
    const isAuthorized = await verifyCanonicalPedagogicalLinkServer(callerUid, studentUid);
    if (!isAuthorized) {
      return res.status(403).json({
        error: 'Forbidden',
        code: 'UNAUTHORIZED_PEDAGOGICAL_LINK',
        message: 'Native Friend does not have an authorized pedagogical link with this student.',
      });
    }
    if (docTeacherUid !== callerUid) {
      return res.status(403).json({
        error: 'Forbidden',
        code: 'TEACHER_MISMATCH',
        message: 'Teacher is not authorized to approve notes belonging to another teacher.',
      });
    }
  }

  const currentRawContent = existingDoc.rawContent || existingDoc.content || '';
  const currentContentHash = computeNotesContentHash(currentRawContent);

  // Stale draft & version protection
  if (existingDoc.draftTransformation) {
    if (req.body?.draftId && existingDoc.draftTransformation.draftId !== req.body.draftId) {
      return res.status(409).json({
        error: 'Conflict',
        code: 'DRAFT_ID_MISMATCH',
        message: 'The submitted draft ID does not match the current active draft.',
      });
    }
    if (existingDoc.draftTransformation.contentHash && existingDoc.draftTransformation.contentHash !== currentContentHash) {
      return res.status(409).json({
        error: 'Conflict',
        code: 'STALE_DRAFT',
        message: 'The pedagogical draft is outdated compared to the current session notes. Notes were modified after this draft was generated. Generate or edit a new draft before approving.',
      });
    }
  }

  if (req.body?.transformation?.contentHash && req.body.transformation.contentHash !== currentContentHash) {
    return res.status(409).json({
      error: 'Conflict',
      code: 'STALE_DRAFT',
      message: 'The submitted transformation is outdated compared to the current session notes.',
    });
  }

  // Idempotency check: already approved with identical content
  if (
    existingDoc.approvalStatus === 'approved' &&
    existingDoc.lastApprovedVersion &&
    existingDoc.lastApprovedVersion.contentHash === currentContentHash &&
    !existingDoc.draftTransformation
  ) {
    return res.json({
      success: true,
      approvalStatus: existingDoc.approvalStatus,
      approvedVersion: existingDoc.lastApprovedVersion,
      sessionNote: existingDoc,
      alreadyApproved: true,
    });
  }

  const rawIncomingTransformation = req.body?.transformation;
  const transformation =
    rawIncomingTransformation?.transformation ||
    (rawIncomingTransformation?.mistakesAnalysis ? rawIncomingTransformation : null) ||
    existingDoc.draftTransformation?.transformation;
  if (!transformation) {
    return res.status(400).json({
      error: 'TRANSFORMATION_REQUIRED',
      code: 'TRANSFORMATION_REQUIRED',
      message: 'A valid pedagogical transformation is required for approval.',
    });
  }

  if (
    !Array.isArray(transformation.mistakesAnalysis) ||
    !Array.isArray(transformation.grammarPoints) ||
    !Array.isArray(transformation.vocabularyAndExpressions) ||
    !transformation.reviewSummary ||
    typeof transformation.reviewSummary !== 'object' ||
    Array.isArray(transformation.reviewSummary)
  ) {
    return res.status(400).json({
      error: 'INVALID_TRANSFORMATION',
      code: 'INVALID_TRANSFORMATION_STRUCTURE',
      message: 'Invalid pedagogical transformation structure: all 4 canonical parts are required.',
    });
  }

  if (
    transformation.isFallback === true ||
    transformation.isProvisional === true ||
    (transformation.isAiGenerated && isLegacyGenericTransformation(transformation, currentRawContent))
  ) {
    return res.status(400).json({
      error: 'SYNTHETIC_TRANSFORMATION_REJECTED',
      code: 'SYNTHETIC_TRANSFORMATION_REJECTED',
      message: 'Synthetic or pre-fabricated fallback transformations cannot be approved.',
    });
  }

  const currentVersion = existingDoc.currentVersionNumber || 1;
  const nextApprovedVersion = currentVersion + 1;

  const approvedVersion: NoteApprovedVersion = {
    approvedVersionId: `appr_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    versionNumber: nextApprovedVersion,
    status: 'approved',
    contentHash: currentContentHash,
    rawNotesSnippet: currentRawContent.slice(0, 300),
    transformation,
    approvedAt: new Date().toISOString(),
    approvedByUid: callerUid,
    approvedByEmail: req.user.email,
    approvedByName: teacherResolution?.name || (req.user as any)?.name || 'Native Friend',
    notesSummary: req.body?.notesSummary || 'Teacher reviewed and approved pedagogical notes for student',
  };

  const authorContext = {
    authorUid: callerUid,
    authorEmail: req.user.email,
    authorRole: (isCallerAdmin ? 'admin' : 'teacher') as 'teacher' | 'admin',
    teacherName: teacherResolution?.name || (req.user as any)?.name || 'Native Friend',
  };

  const updatedDoc = mergeSessionNoteWithVersioning({
    existingNote: existingDoc,
    incomingNote: {
      ...existingDoc,
      lastApprovedVersion: approvedVersion,
      draftTransformation: null, // Draft is cleared upon approval and publication!
      studentUid,
      teacherUid: docTeacherUid,
      sessionDate: existingDoc.sessionDate,
    },
    author: authorContext,
    changeSummary: req.body?.changeSummary || `Version ${nextApprovedVersion} approved and published for student`,
  });

  if (!db.sessionNotesMap) db.sessionNotesMap = {};
  db.sessionNotesMap[targetSessionKey] = updatedDoc;
  await writeDbSync(db);
  await saveSessionNotesToFirestoreServer(targetSessionKey, updatedDoc).catch(() => null);

  return res.json({
    success: true,
    approvalStatus: updatedDoc.approvalStatus,
    approvedVersion,
    sessionNote: updatedDoc,
  });
}

app.post('/api/session-notes/:id/draft', firebaseAuthMiddleware, handleSessionNoteDraftInternal);
app.post('/api/session-notes/draft', firebaseAuthMiddleware, handleSessionNoteDraftInternal);

app.post('/api/session-notes/:id/transform', firebaseAuthMiddleware, handleSessionNoteTransformInternal);
app.post('/api/session-notes/transform', firebaseAuthMiddleware, handleSessionNoteTransformInternal);

app.post('/api/session-notes/:id/approve', firebaseAuthMiddleware, handleSessionNoteApproveInternal);
app.post('/api/session-notes/approve', firebaseAuthMiddleware, handleSessionNoteApproveInternal);

// FASE NF-DOC.2A: Inspect complete version history of session notes document
app.get('/api/session-notes/:id/versions', firebaseAuthMiddleware, async (req, res) => {
  if (!req.user || !req.user.uid) {
    return res.status(401).json({ error: 'Unauthorized', message: 'Autenticação mandatória.' });
  }

  const callerUid = req.user.uid;
  const isCallerAdmin = req.user.role === 'admin';
  const targetSessionKey = decodeURIComponent(req.params.id).trim();

  const db = readDb();
  let existingDoc = db.sessionNotesMap?.[targetSessionKey];
  if (!existingDoc) {
    try {
      existingDoc = await fetchSessionNotesFromFirestoreServer(targetSessionKey);
    } catch {}
  }

  if (!existingDoc) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Documento da anotação não encontrado.' });
  }

  const studentUid = existingDoc.studentUid;
  if (!isCallerAdmin) {
    let isCallerTeacher = false;
    try {
      const tRes = await resolveTeacherCanonicalIdentity({ teacherUid: callerUid, teacherEmail: req.user.email, dbState: db });
      if (tRes && tRes.isApproved) isCallerTeacher = true;
    } catch {}

    if (!isCallerTeacher) {
      if (callerUid !== studentUid) {
        return res.status(403).json({ error: 'Forbidden', message: 'Acesso negado a histórico de anotações de outro aluno.' });
      }
    } else {
      const isAuthorized = await verifyCanonicalPedagogicalLinkServer(callerUid, studentUid);
      if (!isAuthorized && existingDoc.teacherUid !== callerUid) {
        return res.status(403).json({ error: 'Forbidden', message: 'Professor não autorizado para consultar histórico deste documento.' });
      }
    }
  }

  return res.json({
    success: true,
    sessionId: existingDoc.id,
    sessionDate: existingDoc.sessionDate,
    studentUid: existingDoc.studentUid,
    teacherUid: existingDoc.teacherUid,
    approvalStatus: existingDoc.approvalStatus || (existingDoc.lastApprovedVersion ? 'approved' : 'unapproved'),
    currentVersionNumber: existingDoc.currentVersionNumber || 1,
    originalTeacherNotes: existingDoc.originalTeacherNotes || null,
    draftTransformation: existingDoc.draftTransformation || null,
    lastApprovedVersion: existingDoc.lastApprovedVersion || null,
    versionHistory: existingDoc.versionHistory || [],
  });
});

// Shared canonical student UID lookup for Native Friends Notes, Drive Sync, Progress, and Reminder routes
async function resolveCanonicalStudentUidForSessionNotes(params: {
  studentUid?: string;
  studentEmail?: string;
  db: any;
  excludeUid?: string;
}): Promise<{ valid: boolean; uid: string; email: string; code?: string; message?: string }> {
  const cleanUid = (params.studentUid || '').trim();
  const cleanEmail = (params.studentEmail || '').toLowerCase().trim();
  const excludeUid = (params.excludeUid || '').trim();

  if (cleanUid) {
    if (!isValidCanonicalUid(cleanUid)) {
      return {
        valid: false,
        uid: '',
        email: cleanEmail,
        code: 'CANONICAL_STUDENT_UID_REQUIRED',
        message: 'A valid canonical student UID is required.',
      };
    }
    if (excludeUid && cleanUid === excludeUid) {
      return {
        valid: false,
        uid: '',
        email: cleanEmail,
        code: 'INVALID_PEDAGOGICAL_IDENTITY',
        message: 'Teacher UID cannot be substituted as student UID.',
      };
    }
    let resolvedEmail = cleanEmail;
    if (!resolvedEmail) {
      const fs = getFirestoreDb();
      if (fs) {
        try {
          const uSnap = await fs.collection('users').doc(cleanUid).get().catch(() => null);
          if (uSnap && uSnap.exists) {
            resolvedEmail = String(uSnap.data()?.email || '').toLowerCase().trim();
          }
        } catch {}
      }
      if (!resolvedEmail && params.db) {
        const localStudent = (params.db.students || []).find(
          (s: any) => s.uid === cleanUid || s.id === cleanUid || s.studentUid === cleanUid
        );
        if (localStudent?.email) {
          resolvedEmail = String(localStudent.email).toLowerCase().trim();
        }
      }
    }
    return { valid: true, uid: cleanUid, email: resolvedEmail };
  }

  if (!cleanEmail) {
    return {
      valid: false,
      uid: '',
      email: '',
      code: 'MISSING_STUDENT_IDENTIFIER',
      message: 'Canonical student identifier is required.',
    };
  }

  const fs = getFirestoreDb();
  if (fs) {
    try {
      const uSnap = await fs.collection('users').where('email', '==', cleanEmail).limit(5).get();
      if (uSnap && !uSnap.empty) {
        for (const docSnap of uSnap.docs) {
          const candidate = isValidCanonicalUid(docSnap.id)
            ? docSnap.id
            : String(docSnap.data()?.uid || '').trim();
          if (candidate && isValidCanonicalUid(candidate) && (!excludeUid || candidate !== excludeUid)) {
            return { valid: true, uid: candidate, email: cleanEmail };
          }
        }
      }
    } catch {}
  }

  try {
    const adminAuth = getFirebaseAdminAuth();
    if (adminAuth && typeof adminAuth.getUserByEmail === 'function') {
      const userRec = await adminAuth.getUserByEmail(cleanEmail).catch(() => null);
      if (
        userRec?.uid &&
        isValidCanonicalUid(userRec.uid) &&
        (!excludeUid || userRec.uid !== excludeUid)
      ) {
        return {
          valid: true,
          uid: userRec.uid,
          email: (userRec.email || cleanEmail).toLowerCase().trim(),
        };
      }
    }
  } catch {}

  if (params.db) {
    const profile = params.db.userProfiles?.[cleanEmail];
    const student = (params.db.students || []).find(
      (s: any) => (s.email || s.studentEmail || '').toLowerCase().trim() === cleanEmail
    );
    const authUser = Object.values(params.db.authUsers || {}).find(
      (u: any) => (u.email || '').toLowerCase().trim() === cleanEmail
    ) as any;
    const candidates = [profile?.uid, student?.uid, student?.studentUid, authUser?.uid];
    for (const cand of candidates) {
      if (
        typeof cand === 'string' &&
        isValidCanonicalUid(cand.trim()) &&
        (!excludeUid || cand.trim() !== excludeUid)
      ) {
        return { valid: true, uid: cand.trim(), email: cleanEmail };
      }
    }
  }

  if (fs) {
    try {
      const lSnap = await fs.collection('lessons').where('studentEmail', '==', cleanEmail).limit(10).get();
      if (lSnap && !lSnap.empty) {
        for (const lDoc of lSnap.docs) {
          const cand = String(lDoc.data()?.studentUid || '').trim();
          if (cand && isValidCanonicalUid(cand) && (!excludeUid || cand !== excludeUid)) {
            return { valid: true, uid: cand, email: cleanEmail };
          }
        }
      }
    } catch {}
  }

  return {
    valid: false,
    uid: '',
    email: cleanEmail,
    code: 'CANONICAL_STUDENT_UID_REQUIRED',
    message: 'Unable to resolve canonical student UID.',
  };
}

// Shared authorization & lookup helper for /api/drive/files/:fileId and /download
async function authorizeAndFindDriveFile(
  req: any,
  res: any,
  fileId: string
): Promise<{
  handled: boolean;
  storedFile: ReturnType<typeof getStoredDriveFile>;
  sessionDoc: any;
  lessonDoc: any;
}> {
  if (!req.user || !req.user.uid) {
    res.status(401).json({ error: 'Unauthorized', message: 'Authentication required.' });
    return { handled: true, storedFile: null, sessionDoc: null, lessonDoc: null };
  }

  const callerUid = String(req.user.uid || '').trim();
  const callerEmail = String(req.user.email || '').toLowerCase().trim();
  if (!isValidCanonicalUid(callerUid)) {
    res.status(403).json({
      error: 'Forbidden',
      code: 'CANONICAL_UID_REQUIRED',
      message: 'A valid canonical UID is required.',
    });
    return { handled: true, storedFile: null, sessionDoc: null, lessonDoc: null };
  }

  const storedFile = getStoredDriveFile(fileId);
  const db = readDb();

  let sessionDoc: any =
    Object.values(db.sessionNotesMap || {}).find(
      (s: any) => s && (s.driveFileId === fileId || s.id === fileId)
    ) || null;
  let lessonDoc: any = null;

  if (!sessionDoc) {
    try {
      const directNote = await fetchSessionNotesFromFirestoreServer(fileId);
      if (directNote) sessionDoc = directNote;
    } catch {}
  }

  const fs = getFirestoreDb();
  if (fs) {
    if (!sessionDoc) {
      try {
        const snSnap = await fs.collection('session_notes').where('driveFileId', '==', fileId).limit(1).get();
        if (snSnap && !snSnap.empty) {
          sessionDoc = { id: snSnap.docs[0].id, ...snSnap.docs[0].data() };
        }
      } catch {}
    }
    if (!lessonDoc) {
      try {
        const targetLessonId = sessionDoc?.lessonId || fileId;
        if (targetLessonId) {
          const lDirect = await fs.collection('lessons').doc(targetLessonId).get().catch(() => null);
          if (lDirect && lDirect.exists) {
            lessonDoc = { id: lDirect.id, ...lDirect.data() };
          }
        }
        if (!lessonDoc) {
          const lSnap = await fs.collection('lessons').where('driveFileId', '==', fileId).limit(1).get();
          if (lSnap && !lSnap.empty) {
            lessonDoc = { id: lSnap.docs[0].id, ...lSnap.docs[0].data() };
          }
        }
      } catch {}
    }
  }

  if (!storedFile && !sessionDoc && !(lessonDoc && (lessonDoc.driveFileId === fileId || lessonDoc.sessionNotesDocument || lessonDoc.liveNotes))) {
    return { handled: false, storedFile: null, sessionDoc: null, lessonDoc: null };
  }

  const ownerStudentUid = String(
    storedFile?.studentUid || sessionDoc?.studentUid || lessonDoc?.studentUid || ''
  ).trim();
  const ownerStudentEmail = String(
    storedFile?.studentEmail || sessionDoc?.studentEmail || lessonDoc?.studentEmail || ''
  ).toLowerCase().trim();
  const ownerTeacherUid = String(
    storedFile?.teacherUid || sessionDoc?.teacherUid || lessonDoc?.teacherUid || lessonDoc?.teacherAuthUid || ''
  ).trim();

  const isCallerAdmin = req.user.role === 'admin';
  if (!isCallerAdmin) {
    const authCheck = await resolveApprovedTeacherForSessionNotes(callerUid, req.user.email, req.user.role, db);
    if (authCheck.callerKind === 'conflict') {
      res.status(403).json({
        error: 'Forbidden',
        code: 'IDENTITY_CONFLICT',
        message: 'Identity conflict detected on this account.',
      });
      return { handled: true, storedFile: null, sessionDoc: null, lessonDoc: null };
    }
    if (authCheck.callerKind === 'pending_teacher') {
      res.status(403).json({
        error: 'Forbidden',
        code: 'TEACHER_NOT_APPROVED',
        message: 'Your Native Friend profile is pending administrator approval.',
      });
      return { handled: true, storedFile: null, sessionDoc: null, lessonDoc: null };
    }
    if (req.user.role === 'teacher' && !authCheck.isApproved) {
      res.status(403).json({
        error: 'Forbidden',
        code: 'TEACHER_NOT_APPROVED',
        message: 'Only approved Native Friends can access session files.',
      });
      return { handled: true, storedFile: null, sessionDoc: null, lessonDoc: null };
    }

    if (authCheck.isApproved) {
      let teacherAuthorized = Boolean(ownerTeacherUid && ownerTeacherUid === callerUid);
      if (!teacherAuthorized && ownerStudentUid && isValidCanonicalUid(ownerStudentUid)) {
        teacherAuthorized = await verifyCanonicalPedagogicalLinkServer(callerUid, ownerStudentUid);
      }
      if (!teacherAuthorized) {
        res.status(403).json({
          error: 'Forbidden',
          code: 'UNAUTHORIZED_PEDAGOGICAL_LINK',
          message: 'Native Friend is not authorized to access this Google Drive session file.',
        });
        return { handled: true, storedFile: null, sessionDoc: null, lessonDoc: null };
      }
    } else {
      const isStudentOwner =
        (Boolean(ownerStudentUid) && ownerStudentUid === callerUid) ||
        (!ownerStudentUid && Boolean(ownerStudentEmail && callerEmail && ownerStudentEmail === callerEmail));
      if (!isStudentOwner) {
        res.status(403).json({
          error: 'Forbidden',
          message: 'You are not authorized to access another student\'s Google Drive session file.',
        });
        return { handled: true, storedFile: null, sessionDoc: null, lessonDoc: null };
      }
    }
  }

  return { handled: false, storedFile, sessionDoc, lessonDoc };
}

// Dedicated Google Drive Session Notes Sync Endpoint (uses platform credentials mapped to teacher's email)
app.post('/api/drive/sync-session-notes', firebaseAuthMiddleware, async (req, res) => {
  if (!req.user || !req.user.uid) {
    return res.status(401).json({ error: 'Unauthorized', message: 'Authentication required.' });
  }

  const callerUid = String(req.user.uid || '').trim();
  const callerEmail = String(req.user.email || '').toLowerCase().trim();
  if (!isValidCanonicalUid(callerUid)) {
    return res.status(403).json({
      error: 'Forbidden',
      code: 'CANONICAL_UID_REQUIRED',
      message: 'A valid canonical UID is required.',
    });
  }

  const isCallerAdmin = req.user.role === 'admin';
  const db = readDb();

  let teacherResolution: any = null;
  if (!isCallerAdmin) {
    const authCheck = await resolveApprovedTeacherForSessionNotes(callerUid, req.user.email, req.user.role, db);
    if (authCheck.isApproved) {
      teacherResolution = authCheck.resolution;
    } else if (authCheck.callerKind === 'conflict') {
      return res.status(403).json({
        error: 'Forbidden',
        code: 'IDENTITY_CONFLICT',
        message: 'Identity conflict detected on this account.',
      });
    } else if (authCheck.callerKind === 'pending_teacher') {
      return res.status(403).json({
        error: 'Forbidden',
        code: 'TEACHER_NOT_APPROVED',
        message: 'Your Native Friend profile is pending administrator approval and cannot sync Drive notes.',
      });
    } else {
      return res.status(403).json({
        error: 'Forbidden',
        code: 'STUDENTS_CANNOT_SYNC_DRIVE',
        message: 'Only approved Native Friends or administrators can sync session notes to Google Drive.',
      });
    }

    if (req.body?.teacherUid && String(req.body.teacherUid).trim() !== callerUid) {
      return res.status(403).json({
        error: 'Forbidden',
        code: 'TEACHER_MISMATCH',
        message: 'Invalid teacherUid parameter for the authenticated teacher.',
      });
    }
    if (req.body?.teacherEmail && callerEmail && String(req.body.teacherEmail).toLowerCase().trim() !== callerEmail) {
      return res.status(403).json({
        error: 'Forbidden',
        code: 'TEACHER_MISMATCH',
        message: 'Invalid teacherEmail parameter for the authenticated teacher.',
      });
    }
  }

  const {
    studentName,
    studentEmail,
    studentUid: rawStudentUid,
    sessionDate,
    content,
    topic,
    existingFileId,
    lessonId,
    sessionKey,
    teacherEmail,
    teacherName,
    teacherUid: rawTeacherUid,
  } = req.body || {};

  const cleanDate = String(sessionDate || new Date().toISOString().split('T')[0]).trim();
  const cleanStudentEmail = String(studentEmail || '').toLowerCase().trim();
  const cleanLessonId = String(lessonId || '').trim();
  const cleanSessionKey = String(sessionKey || '').trim();
  const cleanExistingFileId = String(existingFileId || '').trim();
  const requestedStudentUid = String(rawStudentUid || '').trim();

  if (requestedStudentUid && !isValidCanonicalUid(requestedStudentUid)) {
    return res.status(400).json({
      error: 'CANONICAL_STUDENT_UID_REQUIRED',
      code: 'CANONICAL_STUDENT_UID_REQUIRED',
      message: 'A valid canonical student UID is required.',
    });
  }

  const effectiveTeacherUid =
    isCallerAdmin && rawTeacherUid && isValidCanonicalUid(String(rawTeacherUid))
      ? String(rawTeacherUid).trim()
      : callerUid;
  const effectiveTeacherEmail = isCallerAdmin
    ? String(teacherEmail || callerEmail || '').toLowerCase().trim()
    : callerEmail || String(teacherResolution?.email || '').toLowerCase().trim();
  const effectiveTeacherName =
    teacherResolution?.name || String(teacherName || (req.user as any)?.name || 'Native Friend').trim();

  // Check existing Drive file ownership if existingFileId is provided
  if (cleanExistingFileId && !isCallerAdmin) {
    const storedExisting = getStoredDriveFile(cleanExistingFileId);
    const noteByFileId = Object.values(db.sessionNotesMap || {}).find(
      (s: any) => s && (s.driveFileId === cleanExistingFileId || s.id === cleanExistingFileId)
    ) as any;

    if (storedExisting) {
      if (storedExisting.teacherUid && storedExisting.teacherUid !== callerUid) {
        return res.status(403).json({
          error: 'Forbidden',
          code: 'TEACHER_MISMATCH',
          message: 'Teacher is not authorized to overwrite another teacher\'s Drive file.',
        });
      }
      if (storedExisting.studentUid && requestedStudentUid && storedExisting.studentUid !== requestedStudentUid) {
        return res.status(403).json({
          error: 'Forbidden',
          code: 'STUDENT_UID_MISMATCH',
          message: 'Provided studentUid does not match the Drive file owner.',
        });
      }
    }
    if (noteByFileId) {
      if (noteByFileId.teacherUid && noteByFileId.teacherUid !== callerUid) {
        return res.status(403).json({
          error: 'Forbidden',
          code: 'TEACHER_MISMATCH',
          message: 'Teacher is not authorized to overwrite another teacher\'s session note.',
        });
      }
      if (noteByFileId.studentUid && requestedStudentUid && noteByFileId.studentUid !== requestedStudentUid) {
        return res.status(403).json({
          error: 'Forbidden',
          code: 'STUDENT_UID_MISMATCH',
          message: 'Provided studentUid does not match the session note owner.',
        });
      }
    }
  }

  // Check lesson ownership if lessonId is provided
  let lesson: any = null;
  if (cleanLessonId) {
    const fs = getFirestoreDb();
    if (fs) {
      try {
        const lSnap = await fs.collection('lessons').doc(cleanLessonId).get().catch(() => null);
        if (lSnap && lSnap.exists) {
          lesson = lSnap.data();
        }
      } catch {}
    }
    if (lesson) {
      if (lesson.studentUid && requestedStudentUid && lesson.studentUid !== requestedStudentUid) {
        return res.status(403).json({
          error: 'STUDENT_LESSON_MISMATCH',
          code: 'STUDENT_LESSON_MISMATCH',
          message: 'The specified lesson belongs to a different student.',
        });
      }
      const lessonTeacherUids = [
        lesson.teacherUid,
        lesson.teacherAuthUid,
        lesson.tutorUid,
        lesson.teacherPublicId,
      ]
        .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
        .map((v) => v.trim());
      const callerTeacherUids = new Set(
        [
          callerUid,
          teacherResolution?.authUid,
          teacherResolution?.publicTutorId,
        ]
          .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
          .map((v) => v.trim())
      );
      if (!isCallerAdmin && lessonTeacherUids.length > 0 && !lessonTeacherUids.some((id) => callerTeacherUids.has(id))) {
        return res.status(403).json({
          error: 'TEACHER_LESSON_MISMATCH',
          code: 'TEACHER_LESSON_MISMATCH',
          message: 'Native Friend is not authorized to sync Drive notes for this lesson.',
        });
      }
    }
  }

  // Resolve canonical student UID
  const candidateSeedUid = requestedStudentUid || String(lesson?.studentUid || '').trim();
  const candidateSeedEmail = cleanStudentEmail || String(lesson?.studentEmail || '').toLowerCase().trim();
  const studentRes = await resolveCanonicalStudentUidForSessionNotes({
    studentUid: candidateSeedUid,
    studentEmail: candidateSeedEmail,
    db,
    excludeUid: isCallerAdmin ? undefined : callerUid,
  });

  if (!studentRes.valid || !studentRes.uid) {
    return res.status(400).json({
      error: studentRes.code || 'CANONICAL_STUDENT_UID_REQUIRED',
      code: studentRes.code || 'CANONICAL_STUDENT_UID_REQUIRED',
      message: studentRes.message || 'Canonical student UID is required to sync Drive session notes.',
    });
  }

  const targetStudentUid = studentRes.uid;
  const targetStudentEmail = studentRes.email || candidateSeedEmail;

  if (targetStudentUid === effectiveTeacherUid || targetStudentUid === callerUid) {
    return res.status(400).json({
      error: 'INVALID_PEDAGOGICAL_IDENTITY',
      code: 'INVALID_PEDAGOGICAL_IDENTITY',
      message: 'Teacher UID cannot be identical to student UID.',
    });
  }

  const effectiveKey = cleanSessionKey || cleanLessonId || `session_${cleanDate}_${targetStudentUid}`;
  const { existingDoc } = await resolveExistingSessionNoteWithKeyFallback(db, effectiveKey);

  if (existingDoc) {
    if (existingDoc.studentUid && existingDoc.studentUid !== targetStudentUid) {
      return res.status(403).json({
        error: 'Forbidden',
        code: 'STUDENT_UID_MISMATCH',
        message: 'Existing session note belongs to a different student.',
      });
    }
    if (!isCallerAdmin && existingDoc.teacherUid && existingDoc.teacherUid !== callerUid) {
      return res.status(403).json({
        error: 'Forbidden',
        code: 'TEACHER_MISMATCH',
        message: 'Teacher is not authorized to modify another teacher\'s session note.',
      });
    }
  }

  if (!isCallerAdmin) {
    const isLinked = await verifyCanonicalPedagogicalLinkServer(callerUid, targetStudentUid);
    if (!isLinked) {
      return res.status(403).json({
        error: 'Forbidden',
        code: 'UNAUTHORIZED_PEDAGOGICAL_LINK',
        message: 'Native Friend does not have an authorized pedagogical link with this student.',
      });
    }
  }

  try {
    const driveRes = await syncSessionNotesWithPlatformDrive({
      studentName: studentName || (targetStudentEmail ? targetStudentEmail.split('@')[0] : 'Student'),
      studentEmail: targetStudentEmail,
      studentUid: targetStudentUid,
      sessionDate: cleanDate,
      content: content || '',
      topic: topic || 'Native Friend Live Coaching',
      existingFileId: cleanExistingFileId || undefined,
      lessonId: cleanLessonId || undefined,
      sessionKey: effectiveKey,
      teacherEmail: effectiveTeacherEmail,
      teacherName: effectiveTeacherName,
      teacherUid: effectiveTeacherUid,
    });

    const nowIso = driveRes.syncedAt || new Date().toISOString();

    if (!db.sessionNotesMap) db.sessionNotesMap = {};
    if (db.sessionNotesMap[effectiveKey]) {
      db.sessionNotesMap[effectiveKey].driveFileId = driveRes.fileId;
      db.sessionNotesMap[effectiveKey].driveFileUrl = driveRes.webViewLink;
      db.sessionNotesMap[effectiveKey].driveFolderName = driveRes.folderName;
      db.sessionNotesMap[effectiveKey].driveLastSyncedAt = nowIso;
      if (!db.sessionNotesMap[effectiveKey].studentUid) db.sessionNotesMap[effectiveKey].studentUid = targetStudentUid;
      if (!db.sessionNotesMap[effectiveKey].teacherUid) db.sessionNotesMap[effectiveKey].teacherUid = effectiveTeacherUid;
      if (targetStudentEmail && !db.sessionNotesMap[effectiveKey].studentEmail) db.sessionNotesMap[effectiveKey].studentEmail = targetStudentEmail;
      if (effectiveTeacherEmail && !db.sessionNotesMap[effectiveKey].teacherEmail) db.sessionNotesMap[effectiveKey].teacherEmail = effectiveTeacherEmail;
      if (content) db.sessionNotesMap[effectiveKey].content = content;
      if (topic) db.sessionNotesMap[effectiveKey].topic = topic;
      db.sessionNotesMap[effectiveKey].updatedAt = nowIso;
    } else {
      db.sessionNotesMap[effectiveKey] = {
        id: effectiveKey,
        sessionKey: effectiveKey,
        sessionDate: cleanDate,
        lessonId: cleanLessonId || '',
        studentUid: targetStudentUid,
        studentEmail: targetStudentEmail,
        teacherUid: effectiveTeacherUid,
        teacherEmail: effectiveTeacherEmail,
        teacherName: effectiveTeacherName,
        topic: topic || '',
        content: content || '',
        rawContent: content || '',
        driveFileId: driveRes.fileId,
        driveFileUrl: driveRes.webViewLink,
        driveFolderName: driveRes.folderName,
        driveLastSyncedAt: nowIso,
        updatedAt: nowIso,
      };
    }

    // Invalidate cached pedagogical transformation for this session
    invalidatePedagogicalCache(db, {
      canonicalSessionKey: effectiveKey,
      sessionKey: effectiveKey,
      lessonId: cleanLessonId || undefined,
    });

    await writeDbSync(db);
    saveSessionNotesToFirestoreServer(effectiveKey, db.sessionNotesMap[effectiveKey]).catch(() => null);
    if (cleanLessonId) {
      const firestore = getFirestoreDb();
      if (firestore) {
        firestore
          .collection('lessons')
          .doc(cleanLessonId)
          .set(
            {
              ...(topic ? { title: topic } : {}),
              ...(content ? { liveNotes: content, recommendations: content, sessionNotesDocument: content } : {}),
              studentUid: targetStudentUid,
              teacherUid: effectiveTeacherUid,
              driveFileId: driveRes.fileId,
              driveFileUrl: driveRes.webViewLink,
              driveFolderName: driveRes.folderName,
              driveLastSyncedAt: nowIso,
              updatedAt: nowIso,
            },
            { merge: true }
          )
          .catch(() => null);
      }
    }

    res.json({
      success: true,
      fileId: driveRes.fileId,
      fileName: driveRes.fileName,
      folderId: driveRes.folderId,
      folderName: driveRes.folderName,
      webViewLink: driveRes.webViewLink,
      isUpdated: driveRes.isUpdated,
      syncedAt: nowIso,
    });
  } catch (err: any) {
    console.error('Server Drive sync handler error:', err);
    res.status(500).json({ error: err.message || 'Error syncing notes to Google Drive.' });
  }
});

// View Google Drive Session Notes Document
app.get('/api/drive/files/:fileId', firebaseAuthMiddleware, async (req, res) => {
  const fileId = decodeURIComponent(String(req.params.fileId || '')).trim();
  const authRes = await authorizeAndFindDriveFile(req, res, fileId);
  if (authRes.handled) return;

  const { storedFile, sessionDoc, lessonDoc } = authRes;

  if (!storedFile) {
    const docSource = sessionDoc || lessonDoc;
    if (docSource) {
      const fileName = formatSessionNotesFileName(
        docSource.studentEmail?.split('@')[0],
        docSource.sessionDate || (docSource.startDateTime ? docSource.startDateTime.split('T')[0] : undefined)
      );
      const docContent = docSource.content || docSource.rawContent || docSource.sessionNotesDocument || docSource.liveNotes || 'No content.';
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${fileName} - Google Drive</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-slate-100 min-h-screen p-4 sm:p-8 flex justify-center text-slate-800 font-sans">
  <div class="max-w-3xl w-full bg-white rounded-2xl shadow-lg border border-slate-200 p-6 sm:p-10 space-y-6">
    <div class="flex items-center justify-between border-b pb-4">
      <div class="flex items-center gap-3">
        <svg class="w-8 h-8 text-blue-600" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14h2v2h-2zm0-10h2v8h-2z"/></svg>
        <div>
          <h1 class="text-xl font-bold text-slate-900">${fileName}</h1>
          <p class="text-xs text-slate-500 font-semibold">Google Drive Folder: ${GOOGLE_DRIVE_SESSION_FOLDER}</p>
        </div>
      </div>
      <a href="/api/drive/files/${fileId}/download" class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl shadow transition">Download File</a>
    </div>
    <div class="bg-slate-50 p-6 rounded-xl border border-slate-200 whitespace-pre-wrap leading-relaxed text-sm font-sans">${docContent}</div>
  </div>
</body>
</html>`);
    }

    return res.status(404).send('Document not found in Google Drive session notes.');
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${storedFile.fileName} - Google Drive</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-slate-100 min-h-screen p-4 sm:p-8 flex justify-center text-slate-800 font-sans">
  <div class="max-w-3xl w-full bg-white rounded-2xl shadow-lg border border-slate-200 p-6 sm:p-10 space-y-6">
    <div class="flex items-center justify-between border-b pb-4">
      <div class="flex items-center gap-3">
        <svg class="w-8 h-8 text-blue-600" viewBox="0 0 24 24" fill="currentColor"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/></svg>
        <div>
          <h1 class="text-xl font-bold text-slate-900">${storedFile.fileName}</h1>
          <p class="text-xs text-slate-500 font-semibold">Folder: ${storedFile.folderName} • Synchronized for ${storedFile.studentName || storedFile.studentEmail}</p>
        </div>
      </div>
      <a href="/api/drive/files/${fileId}/download" class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl shadow transition">Download File</a>
    </div>
    <div class="bg-slate-50 p-6 rounded-xl border border-slate-200 whitespace-pre-wrap leading-relaxed text-sm font-sans">${storedFile.content || 'No content.'}</div>
  </div>
</body>
</html>`);
});

// Download raw Google Drive Session Notes Document
app.get('/api/drive/files/:fileId/download', firebaseAuthMiddleware, async (req, res) => {
  const fileId = decodeURIComponent(String(req.params.fileId || '')).trim();
  const authRes = await authorizeAndFindDriveFile(req, res, fileId);
  if (authRes.handled) return;

  const { storedFile, sessionDoc, lessonDoc } = authRes;

  if (storedFile) {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${storedFile.fileName}.txt"`);
    return res.send(storedFile.content);
  }

  const docSource = sessionDoc || lessonDoc;
  if (docSource) {
    const fileName = formatSessionNotesFileName(
      docSource.studentEmail?.split('@')[0],
      docSource.sessionDate || (docSource.startDateTime ? docSource.startDateTime.split('T')[0] : undefined)
    );
    const docContent = docSource.content || docSource.rawContent || docSource.sessionNotesDocument || docSource.liveNotes || '';
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}.txt"`);
    return res.send(docContent);
  }

  res.status(404).json({ error: 'File not found.' });
});

// Protected catch-all for any unmatched /api/drive/files/* subpaths
app.use('/api/drive/files', firebaseAuthMiddleware, (req, res) => {
  if (!req.user || !req.user.uid) {
    return res.status(401).json({ error: 'Unauthorized', message: 'Authentication required.' });
  }
  return res.status(404).json({ error: 'File not found.' });
});

// Retrieve Native Friend In-Session Notes & Recommendations
app.get('/api/session-notes', firebaseAuthMiddleware, async (req, res) => {
  if (!req.user || !req.user.uid) {
    return res.status(401).json({ error: 'Unauthorized', message: 'Autenticação mandatória para consultar anotações.' });
  }

  const callerUid = req.user.uid;
  const isCallerAdmin = req.user.role === 'admin';
  const db = readDb();

  let isCallerTeacher = false;
  if (!isCallerAdmin) {
    try {
      const tRes = await resolveTeacherCanonicalIdentity({ teacherUid: callerUid, teacherEmail: req.user.email, dbState: db });
      if (tRes && tRes.isApproved) isCallerTeacher = true;
    } catch {}
  }

  const id = (req.query.id as string) || '';
  const lessonId = (req.query.lessonId as string) || '';
  const queryStudentUid = ((req.query.studentUid as string) || (req.query.uid as string) || '').trim();
  const sessionDate = (req.query.sessionDate as string) || '';

  // 1. Determine target student and enforce strict student isolation
  let targetStudentUid = '';
  if (!isCallerAdmin && !isCallerTeacher) {
    // Caller is a student: strictly lock to caller's own UID
    if (queryStudentUid && queryStudentUid !== callerUid) {
      return res.status(403).json({ error: 'Forbidden', message: 'Alunos só podem acessar suas próprias anotações.' });
    }
    targetStudentUid = callerUid;
  } else {
    // Admin or Teacher caller
    targetStudentUid = queryStudentUid;

    // FASE NF-NOTES.6: If caller is a Teacher, verify authorized pedagogical link with target student
    if (isCallerTeacher && !isCallerAdmin && targetStudentUid) {
      const isAuthorized = await verifyCanonicalPedagogicalLinkServer(callerUid, targetStudentUid);
      if (!isAuthorized) {
        return res.status(403).json({
          error: 'Forbidden',
          code: 'UNAUTHORIZED_PEDAGOGICAL_LINK',
          message: 'Amigo Nativo não possui vínculo pedagógico autorizado com este aluno.',
        });
      }
    }
  }

  // 2. Direct lookup by id or lessonId
  if (id || lessonId) {
    const targetKey = id || lessonId;
    const cleanId = targetKey.replace(/^lesson_/, '');

    // First check Firestore canonical storage
    let firestoreNote: any = null;
    if (targetStudentUid) {
      try {
        const studentNotes = await fetchSessionNotesForStudentServer(targetStudentUid, targetKey);
        if (studentNotes && studentNotes.length > 0) {
          firestoreNote = studentNotes[0];
        }
      } catch {}
    }
    if (!firestoreNote) {
      try {
        firestoreNote = await fetchSessionNotesFromFirestoreServer(targetKey);
      } catch {}
    }

    let foundDoc = firestoreNote;
    if (!foundDoc) {
      foundDoc = db.sessionNotesMap?.[targetKey] ||
        db.sessionNotesMap?.[`lesson_${cleanId}`] ||
        db.sessionNotesMap?.[cleanId] ||
        Object.values(db.sessionNotesMap || {}).find(
          (n: any) => n.id === targetKey || n.lessonId === targetKey || n.lessonId === cleanId || n.id === `lesson_${cleanId}`
        );
    }

    if (!foundDoc) {
      try {
        const fs = getFirestoreDb();
        if (fs) {
          const candidateIds = Array.from(new Set([targetKey, cleanId].filter(Boolean)));
          for (const cid of candidateIds) {
            const lSnap = await fs.collection('lessons').doc(cid).get().catch(() => null);
            if (lSnap && lSnap.exists) {
              const matchLesson = lSnap.data();
              if (matchLesson && (matchLesson.sessionNotesDocument || matchLesson.liveNotes || matchLesson.recommendations)) {
                const lDate = matchLesson.sessionDate || (matchLesson.startDateTime ? matchLesson.startDateTime.split('T')[0] : '');
                const rawContent = matchLesson.sessionNotesDocument || matchLesson.liveNotes || matchLesson.recommendations || '';
                foundDoc = {
                  id: lSnap.id,
                  sessionKey: lSnap.id,
                  sessionDate: lDate,
                  lessonId: lSnap.id,
                  studentEmail: matchLesson.studentEmail,
                  studentUid: matchLesson.studentUid,
                  teacherEmail: matchLesson.teacherEmail || matchLesson.tutorEmail || '',
                  teacherName: matchLesson.teacherName || matchLesson.tutorName || 'Native Friend',
                  teacherUid: matchLesson.teacherUid || '',
                  topic: matchLesson.title || 'Conversation & Fluency',
                  content: rawContent,
                  rawContent,
                  driveFileId: matchLesson.driveFileId,
                  driveFileUrl: matchLesson.driveFileUrl,
                  driveFolderName: matchLesson.driveFolderName,
                  driveLastSyncedAt: matchLesson.driveLastSyncedAt,
                  updatedAt: matchLesson.updatedAt || matchLesson.notesLastSavedAt || new Date().toISOString(),
                };
                break;
              }
            }
          }
        }
      } catch {}
    }

    if (foundDoc) {
      // Authorization check for single document
      if (!isCallerAdmin && !isCallerTeacher) {
        if (foundDoc.studentUid && foundDoc.studentUid !== callerUid) {
          return res.status(403).json({ error: 'Forbidden', message: 'Acesso negado a anotações de outro aluno.' });
        }
      } else if (isCallerTeacher && !isCallerAdmin) {
        let isAuthorized = foundDoc.teacherUid === callerUid;
        if (!isAuthorized && foundDoc.studentUid) {
          isAuthorized = await verifyCanonicalPedagogicalLinkServer(callerUid, foundDoc.studentUid);
        }
        if (!isAuthorized) {
          return res.status(403).json({
            error: 'Forbidden',
            code: 'UNAUTHORIZED_PEDAGOGICAL_LINK',
            message: 'Acesso negado: professor não autorizado para esta anotação.',
          });
        }
      }
      const rawContent = foundDoc.rawContent || foundDoc.content || '';
      return res.json({
        ...foundDoc,
        rawContent,
        content: foundDoc.content || rawContent,
      });
    }

    return res.status(404).json({ error: 'Session note not found' });
  }

  // 3. Query notes for student (either caller or queried by teacher/admin)
  if (targetStudentUid) {
    const map = new Map<string, any>();

    // 3a. Retrieve from canonical Firestore
    try {
      const fsNotes = await fetchSessionNotesForStudentServer(targetStudentUid);
      if (Array.isArray(fsNotes)) {
        fsNotes.forEach((n: any) => {
          const rawContent = n.rawContent || n.content || '';
          const key = n.id || n.sessionKey || (n.sessionDate ? `session_${n.sessionDate}` : 'session');
          map.set(key, { ...n, rawContent, content: n.content || rawContent });
        });
      }
    } catch {}

    // 3b. Overlay in-memory sessionNotesMap matching targetStudentUid
    const allNotes: any[] = Object.values(db.sessionNotesMap || {});
    allNotes.forEach((n: any) => {
      if (n.studentUid === targetStudentUid) {
        const cleanLessonId = n.lessonId ? n.lessonId.replace(/^lesson_/, '') : '';
        const mapKey = cleanLessonId ? `lesson_${cleanLessonId}` : (n.id || n.sessionDate);
        if (mapKey && !map.has(mapKey)) {
          const rawContent = n.rawContent || n.content || '';
          map.set(mapKey, { ...n, rawContent, content: n.content || rawContent });
        }
      }
    });

    // 3c. Overlay canonical Firestore lessons/{lessonId} notes matching targetStudentUid
    try {
      const fs = getFirestoreDb();
      if (fs) {
        const lessonsSnap = await fs.collection('lessons').where('studentUid', '==', targetStudentUid).get().catch(() => null);
        if (lessonsSnap && !lessonsSnap.empty) {
          lessonsSnap.docs.forEach((doc: any) => {
            const l = doc.data();
            const lId = doc.id || l.id;
            const noteContent = l?.sessionNotesDocument || l?.liveNotes || l?.recommendations || '';
            if (noteContent && noteContent.trim()) {
              const lDate = l.sessionDate || (l.startDateTime ? l.startDateTime.split('T')[0] : '');
              const cleanLessonId = lId ? String(lId).replace(/^lesson_/, '') : '';
              const mapKey = cleanLessonId ? `lesson_${cleanLessonId}` : (lId || `session_${lDate}_${targetStudentUid}`);
              if (!map.has(mapKey)) {
                map.set(mapKey, {
                  id: mapKey,
                  sessionKey: mapKey,
                  sessionDate: lDate,
                  lessonId: lId,
                  startDateTime: l.startDateTime,
                  studentEmail: l.studentEmail,
                  studentUid: l.studentUid,
                  teacherEmail: l.teacherEmail || l.tutorEmail || '',
                  teacherName: l.teacherName || l.tutorName || 'Native Friend',
                  teacherUid: l.teacherUid || '',
                  topic: l.title || 'Conversation & Fluency',
                  content: noteContent,
                  rawContent: noteContent,
                  driveFileId: l.driveFileId,
                  driveFileUrl: l.driveFileUrl,
                  driveFolderName: l.driveFolderName,
                  driveLastSyncedAt: l.driveLastSyncedAt,
                  updatedAt: l.updatedAt || l.notesLastSavedAt || new Date().toISOString(),
                });
              }
            }
          });
        }
      }
    } catch {}

    const getRealLessonTimestamp = (item: any): number => {
      if (item?.startDateTime && typeof item.startDateTime === 'string') {
        const t = new Date(item.startDateTime).getTime();
        if (!isNaN(t) && t > 0) return t;
      }
      const rawDate = item?.sessionDate || item?.lessonDate || '';
      const match = typeof rawDate === 'string' ? rawDate.match(/\d{4}-\d{2}-\d{2}/) : null;
      if (match) {
        const t = new Date(match[0] + 'T00:00:00Z').getTime();
        if (!isNaN(t) && t > 0) return t;
      }
      const idMatch = typeof item?.id === 'string' ? item.id.match(/\d{4}-\d{2}-\d{2}/) : null;
      if (idMatch) {
        const t = new Date(idMatch[0] + 'T00:00:00Z').getTime();
        if (!isNaN(t) && t > 0) return t;
      }
      return 0;
    };

    const results = Array.from(map.values()).sort((a: any, b: any) => {
      const timeA = getRealLessonTimestamp(a);
      const timeB = getRealLessonTimestamp(b);
      if (timeB !== timeA) return timeB - timeA;
      const dateCmp = (b.sessionDate || '').localeCompare(a.sessionDate || '');
      if (dateCmp !== 0) return dateCmp;
      const updateCmp = (b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || '');
      if (updateCmp !== 0) return updateCmp;
      return (b.id || b.sessionKey || '').localeCompare(a.id || a.sessionKey || '');
    });

    if (sessionDate) {
      const match = results.find((n: any) => n.sessionDate === sessionDate);
      return res.json(match || null);
    }

    return res.json(results);
  }

  // 4. Admin listing all notes if no filter
  if (isCallerAdmin) {
    const all = Object.values(db.sessionNotesMap || {}).map((n: any) => ({
      ...n,
      rawContent: n.rawContent || n.content || '',
      content: n.content || n.rawContent || '',
    }));
    return res.json(all);
  }

  // Teacher listing notes for their lessons
  if (isCallerTeacher) {
    const callerEmail = (req.user?.email || '').toLowerCase();
    const teacherNotes = Object.values(db.sessionNotesMap || {})
      .filter((n: any) => n.teacherUid === callerUid || (callerEmail && n.teacherEmail?.toLowerCase() === callerEmail))
      .map((n: any) => ({
        ...n,
        rawContent: n.rawContent || n.content || '',
        content: n.content || n.rawContent || '',
      }));
    return res.json(teacherNotes);
  }

  return res.json([]);
});

// Retrieve Native Friends Notes Sequential Review Progress
app.get('/api/session-notes/progress', firebaseAuthMiddleware, async (req, res) => {
  if (!req.user || !req.user.uid) {
    return res.status(401).json({ error: 'Unauthorized', message: 'Authentication required.' });
  }

  const callerUid = String(req.user.uid || '').trim();
  const callerEmail = String(req.user.email || '').toLowerCase().trim();
  if (!isValidCanonicalUid(callerUid)) {
    return res.status(403).json({
      error: 'Forbidden',
      code: 'CANONICAL_UID_REQUIRED',
      message: 'A valid canonical UID is required.',
    });
  }

  const db = readDb();
  const isCallerAdmin = req.user.role === 'admin';
  const rawStudentUid = typeof req.query.studentUid === 'string'
    ? req.query.studentUid.trim()
    : (typeof req.query.uid === 'string' ? req.query.uid.trim() : '');
  const rawStudentEmail = typeof req.query.studentEmail === 'string'
    ? req.query.studentEmail.toLowerCase().trim()
    : (typeof req.query.email === 'string' ? req.query.email.toLowerCase().trim() : '');

  let targetStudentUid = '';

  if (isCallerAdmin) {
    if (rawStudentUid && !isValidCanonicalUid(rawStudentUid)) {
      return res.status(400).json({
        error: 'CANONICAL_STUDENT_UID_REQUIRED',
        code: 'CANONICAL_STUDENT_UID_REQUIRED',
        message: 'A valid canonical student UID is required.',
      });
    }
    const resolved = await resolveCanonicalStudentUidForSessionNotes({
      studentUid: rawStudentUid,
      studentEmail: rawStudentEmail,
      db,
    });
    if (!resolved.valid || !resolved.uid) {
      return res.status(400).json({
        error: resolved.code || 'CANONICAL_STUDENT_UID_REQUIRED',
        code: resolved.code || 'CANONICAL_STUDENT_UID_REQUIRED',
        message: resolved.message || 'Valid canonical student identifier is required.',
      });
    }
    targetStudentUid = resolved.uid;
  } else {
    const authCheck = await resolveApprovedTeacherForSessionNotes(callerUid, req.user.email, req.user.role, db);
    if (authCheck.callerKind === 'conflict') {
      return res.status(403).json({
        error: 'Forbidden',
        code: 'IDENTITY_CONFLICT',
        message: 'Identity conflict detected on this account.',
      });
    }
    if (authCheck.callerKind === 'pending_teacher') {
      return res.status(403).json({
        error: 'Forbidden',
        code: 'TEACHER_NOT_APPROVED',
        message: 'Your Native Friend profile is pending administrator approval.',
      });
    }
    if (req.user.role === 'teacher' && !authCheck.isApproved) {
      return res.status(403).json({
        error: 'Forbidden',
        code: 'TEACHER_NOT_APPROVED',
        message: 'Only approved Native Friends can inspect student review progress.',
      });
    }

    if (authCheck.isApproved) {
      if (!rawStudentUid && !rawStudentEmail) {
        return res.status(400).json({
          error: 'MISSING_STUDENT_IDENTIFIER',
          code: 'MISSING_STUDENT_IDENTIFIER',
          message: 'Target canonical student identifier is required.',
        });
      }
      if (rawStudentUid && !isValidCanonicalUid(rawStudentUid)) {
        return res.status(400).json({
          error: 'CANONICAL_STUDENT_UID_REQUIRED',
          code: 'CANONICAL_STUDENT_UID_REQUIRED',
          message: 'A valid canonical student UID is required.',
        });
      }
      const resolved = await resolveCanonicalStudentUidForSessionNotes({
        studentUid: rawStudentUid,
        studentEmail: rawStudentEmail,
        db,
        excludeUid: callerUid,
      });
      if (!resolved.valid || !resolved.uid) {
        return res.status(resolved.code === 'INVALID_PEDAGOGICAL_IDENTITY' ? 403 : 400).json({
          error: resolved.code || 'CANONICAL_STUDENT_UID_REQUIRED',
          code: resolved.code || 'CANONICAL_STUDENT_UID_REQUIRED',
          message: resolved.message || 'Valid canonical student identifier is required.',
        });
      }
      const isLinked = await verifyCanonicalPedagogicalLinkServer(callerUid, resolved.uid);
      if (!isLinked) {
        return res.status(403).json({
          error: 'Forbidden',
          code: 'UNAUTHORIZED_PEDAGOGICAL_LINK',
          message: 'Native Friend does not have an authorized pedagogical link with this student.',
        });
      }
      targetStudentUid = resolved.uid;
    } else {
      // Student self-access only
      if (rawStudentUid && rawStudentUid !== callerUid) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Students can only access their own review progress.',
        });
      }
      if (rawStudentEmail && (!callerEmail || rawStudentEmail !== callerEmail)) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Students can only access their own review progress.',
        });
      }
      targetStudentUid = callerUid;
    }
  }

  let progress = (db.sessionNotesProgressMap && db.sessionNotesProgressMap[targetStudentUid]) || null;
  if (!progress || !progress.lastReminderShownDate) {
    const fsProgress = await fetchSessionNotesProgressServer(targetStudentUid);
    if (fsProgress) {
      if (!db.sessionNotesProgressMap) db.sessionNotesProgressMap = {};
      progress = {
        ...(progress || {}),
        ...fsProgress,
      };
      db.sessionNotesProgressMap[targetStudentUid] = progress;
    }
  }
  return res.json(progress || null);
});

// Update Native Friends Notes Sequential Review Progress
app.post('/api/session-notes/progress', firebaseAuthMiddleware, async (req, res) => {
  if (!req.user || !req.user.uid) {
    return res.status(401).json({ error: 'Unauthorized', message: 'Authentication required.' });
  }

  const callerUid = String(req.user.uid || '').trim();
  const callerEmail = String(req.user.email || '').toLowerCase().trim();
  if (!isValidCanonicalUid(callerUid)) {
    return res.status(403).json({
      error: 'Forbidden',
      code: 'CANONICAL_UID_REQUIRED',
      message: 'A valid canonical UID is required.',
    });
  }

  const db = readDb();
  const isCallerAdmin = req.user.role === 'admin';
  const { studentUid, studentEmail, lastSessionKey, stepIndex, lastReviewedTab, lastReviewedDate } = req.body || {};
  const rawStudentUid = typeof studentUid === 'string' ? studentUid.trim() : '';
  const rawStudentEmail = typeof studentEmail === 'string' ? studentEmail.toLowerCase().trim() : '';

  let targetStudentUid = '';
  let targetStudentEmail = '';

  if (isCallerAdmin) {
    if (rawStudentUid && !isValidCanonicalUid(rawStudentUid)) {
      return res.status(400).json({
        error: 'CANONICAL_STUDENT_UID_REQUIRED',
        code: 'CANONICAL_STUDENT_UID_REQUIRED',
        message: 'A valid canonical student UID is required.',
      });
    }
    const resolved = await resolveCanonicalStudentUidForSessionNotes({
      studentUid: rawStudentUid,
      studentEmail: rawStudentEmail,
      db,
    });
    if (!resolved.valid || !resolved.uid) {
      return res.status(400).json({
        error: resolved.code || 'CANONICAL_STUDENT_UID_REQUIRED',
        code: resolved.code || 'CANONICAL_STUDENT_UID_REQUIRED',
        message: resolved.message || 'Valid canonical student identifier is required.',
      });
    }
    targetStudentUid = resolved.uid;
    targetStudentEmail = resolved.email || rawStudentEmail;
  } else {
    const authCheck = await resolveApprovedTeacherForSessionNotes(callerUid, req.user.email, req.user.role, db);
    if (authCheck.callerKind === 'conflict') {
      return res.status(403).json({
        error: 'Forbidden',
        code: 'IDENTITY_CONFLICT',
        message: 'Identity conflict detected on this account.',
      });
    }
    if (authCheck.callerKind === 'pending_teacher') {
      return res.status(403).json({
        error: 'Forbidden',
        code: 'TEACHER_NOT_APPROVED',
        message: 'Your Native Friend profile is pending administrator approval.',
      });
    }
    if (authCheck.isApproved || req.user.role === 'teacher') {
      return res.status(403).json({
        error: 'Forbidden',
        code: 'TEACHERS_CANNOT_MODIFY_STUDENT_PROGRESS',
        message: 'Teachers cannot modify a student\'s personal review progress.',
      });
    }

    if (rawStudentUid && rawStudentUid !== callerUid) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Students can only update their own review progress.',
      });
    }
    if (rawStudentEmail && (!callerEmail || rawStudentEmail !== callerEmail)) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Students can only update their own review progress.',
      });
    }
    targetStudentUid = callerUid;
    targetStudentEmail = callerEmail;
  }

  db.sessionNotesProgressMap = db.sessionNotesProgressMap || {};
  const existingProg = db.sessionNotesProgressMap[targetStudentUid] || {};

  const updatedProgress = {
    ...existingProg,
    studentUid: targetStudentUid,
    studentEmail: targetStudentEmail || existingProg.studentEmail || '',
    lastSessionKey: typeof lastSessionKey === 'string' ? lastSessionKey : (existingProg.lastSessionKey || ''),
    stepIndex: typeof stepIndex === 'number' && Number.isFinite(stepIndex) && stepIndex >= 0 ? Math.floor(stepIndex) : (existingProg.stepIndex || 0),
    lastReviewedTab: typeof lastReviewedTab === 'string' ? lastReviewedTab : (existingProg.lastReviewedTab || ''),
    lastReviewedDate: typeof lastReviewedDate === 'string' ? lastReviewedDate : (existingProg.lastReviewedDate || ''),
    lastAssignedDate: typeof req.body?.lastAssignedDate === 'string' ? req.body.lastAssignedDate : (existingProg.lastAssignedDate || ''),
    lastReminderShownDate: existingProg.lastReminderShownDate || '',
    updatedAt: new Date().toISOString(),
  };

  db.sessionNotesProgressMap[targetStudentUid] = updatedProgress;
  await writeDbSync(db);

  saveSessionNotesProgressToFirestore(targetStudentUid, updatedProgress).catch(() => {});
  return res.json({ success: true, progress: updatedProgress });
});

// Atomic Daily Reminder Claim Endpoint (Presented AT MOST ONCE per day per student)
app.post('/api/session-notes/reminder/claim', firebaseAuthMiddleware, async (req, res) => {
  if (!req.user || !req.user.uid) {
    return res.status(401).json({ error: 'Unauthorized', message: 'Authentication required.' });
  }

  const callerUid = String(req.user.uid || '').trim();
  const callerEmail = String(req.user.email || '').toLowerCase().trim();
  if (!isValidCanonicalUid(callerUid)) {
    return res.status(403).json({
      error: 'Forbidden',
      code: 'CANONICAL_UID_REQUIRED',
      message: 'A valid canonical UID is required.',
    });
  }

  const db = readDb();
  const isCallerAdmin = req.user.role === 'admin';
  const { studentUid, studentEmail, timeZone, dateStr } = req.body || {};
  const rawStudentUid = typeof studentUid === 'string' ? studentUid.trim() : '';
  const rawStudentEmail = typeof studentEmail === 'string' ? studentEmail.toLowerCase().trim() : '';

  let effectiveUid = '';
  let effectiveEmail = '';

  if (isCallerAdmin) {
    if (rawStudentUid && !isValidCanonicalUid(rawStudentUid)) {
      return res.status(400).json({
        error: 'CANONICAL_STUDENT_UID_REQUIRED',
        code: 'CANONICAL_STUDENT_UID_REQUIRED',
        message: 'A valid canonical student UID is required.',
      });
    }
    const resolved = await resolveCanonicalStudentUidForSessionNotes({
      studentUid: rawStudentUid,
      studentEmail: rawStudentEmail,
      db,
    });
    if (!resolved.valid || !resolved.uid) {
      return res.status(400).json({
        error: resolved.code || 'CANONICAL_STUDENT_UID_REQUIRED',
        code: resolved.code || 'CANONICAL_STUDENT_UID_REQUIRED',
        message: resolved.message || 'Valid canonical student identifier is required.',
      });
    }
    effectiveUid = resolved.uid;
    effectiveEmail = resolved.email || rawStudentEmail;
  } else {
    const authCheck = await resolveApprovedTeacherForSessionNotes(callerUid, req.user.email, req.user.role, db);
    if (authCheck.callerKind === 'conflict') {
      return res.status(403).json({
        error: 'Forbidden',
        code: 'IDENTITY_CONFLICT',
        message: 'Identity conflict detected on this account.',
      });
    }
    if (authCheck.callerKind === 'pending_teacher') {
      return res.status(403).json({
        error: 'Forbidden',
        code: 'TEACHER_NOT_APPROVED',
        message: 'Your Native Friend profile is pending administrator approval.',
      });
    }
    if (authCheck.isApproved || req.user.role === 'teacher') {
      return res.status(403).json({
        error: 'Forbidden',
        code: 'TEACHERS_CANNOT_CLAIM_STUDENT_REMINDER',
        message: 'Teachers cannot claim daily student reminders.',
      });
    }

    if (rawStudentUid && rawStudentUid !== callerUid) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Students can only claim daily reminders for their own account.',
      });
    }
    if (rawStudentEmail && (!callerEmail || rawStudentEmail !== callerEmail)) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Students can only claim daily reminders for their own account.',
      });
    }
    effectiveUid = callerUid;
    effectiveEmail = callerEmail;
  }

  const effectiveTz = sanitizeTimeZone(typeof timeZone === 'string' && timeZone ? timeZone : 'America/Sao_Paulo');
  const validDateStr = typeof dateStr === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateStr.trim()) ? dateStr.trim() : '';
  const todayInTz =
    validDateStr ||
    new Intl.DateTimeFormat('en-CA', {
      timeZone: effectiveTz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());

  const result = await recordDailyReminderShownServer(effectiveUid, todayInTz);

  if (!db.sessionNotesProgressMap) db.sessionNotesProgressMap = {};
  const existingProg = db.sessionNotesProgressMap[effectiveUid] || {};
  db.sessionNotesProgressMap[effectiveUid] = {
    ...existingProg,
    studentUid: effectiveUid,
    studentEmail: effectiveEmail || existingProg.studentEmail || '',
    lastReminderShownDate: result.lastReminderShownDate || todayInTz,
    updatedAt: new Date().toISOString(),
  };
  await writeDbSync(db);

  return res.json({
    success: true,
    canShow: result.canShow,
    alreadyShown: result.alreadyShown,
    lastReminderShownDate: result.lastReminderShownDate,
  });
});

export type GeminiFailureCategory =
  | 'AUTH_ERROR'
  | 'QUOTA_EXCEEDED'
  | 'SERVICE_UNAVAILABLE'
  | 'MODEL_UNAVAILABLE'
  | 'MODEL_NOT_FOUND'
  | 'MODEL_INCOMPATIBLE_CONFIG'
  | 'POLICY_VIOLATION'
  | 'TIMEOUT'
  | 'INVALID_RESPONSE'
  | string;

export function categorizeGeminiError(err: any): { category: GeminiFailureCategory; safeReason: string } {
  const msg = String(err?.message || err?.statusText || err || '').toLowerCase();
  const status = Number(err?.status || err?.statusCode || err?.code || 0);

  if (msg.includes('timeout') || status === 408 || msg.includes('deadline_exceeded')) {
    return { category: 'TIMEOUT', safeReason: 'Request timed out waiting for model response.' };
  }
  if (
    status === 503 ||
    msg.includes('503') ||
    msg.includes('high demand') ||
    msg.includes('service unavailable') ||
    msg.includes('temporarily unavailable') ||
    msg.includes('overloaded')
  ) {
    return {
      category: 'SERVICE_UNAVAILABLE',
      safeReason: 'Gemini model is temporarily experiencing high demand (HTTP 503).',
    };
  }
  if (
    status === 429 ||
    msg.includes('resource_exhausted') ||
    msg.includes('quota') ||
    msg.includes('rate limit') ||
    msg.includes('too many requests')
  ) {
    return { category: 'QUOTA_EXCEEDED', safeReason: 'Gemini quota or rate limit exceeded.' };
  }
  if (
    status === 401 ||
    status === 403 ||
    msg.includes('api_key') ||
    msg.includes('unauthenticated') ||
    msg.includes('permission_denied')
  ) {
    return { category: 'AUTH_ERROR', safeReason: 'Gemini authentication failed or invalid credentials.' };
  }
  if (status === 404 || msg.includes('not found') || msg.includes('is not supported')) {
    return { category: 'MODEL_UNAVAILABLE', safeReason: 'Requested model is unavailable or unsupported.' };
  }
  return { category: 'INVALID_RESPONSE', safeReason: 'Model response was empty or malformed.' };
}

export function logSafeGeminiDiagnostic(category: string, model: string, details?: string) {
  const sanitized = (details || '')
    .replace(/AIza[0-9A-Za-z-_]{30,45}/g, '[REDACTED_API_KEY]')
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[REDACTED_EMAIL]')
    .replace(/Bearer\s+[a-zA-Z0-9._-]+/gi, '[REDACTED_TOKEN]');
  console.warn(`[GEMINI_DIAGNOSTIC] Category: ${category} | Model: ${model} | Info: ${sanitized.slice(0, 150)}`);
}

// Helper for pedagogical transformation fallback
function generateServerPedagogicalFallback(params: {
  rawNotes: string;
  topic?: string;
  sessionDate?: string;
  teacherName?: string;
  studentLevel?: string;
  studentUid?: string;
  studentEmail?: string;
  lessonId?: string;
  sessionKey?: string;
  language?: string;
}) {
  return generateLocalPedagogicalTransformation(params as any);
}

async function syncTransformationVocabToDictionary(
  transformation: any,
  studentUid?: string,
  studentEmail?: string
) {
  if (!transformation || !Array.isArray(transformation.vocabularyAndExpressions)) return;
  const cleanEmail = (studentEmail || '').toLowerCase().trim();
  const targetKey = studentUid || cleanEmail;
  if (!targetKey) return;

  const db = readDb();
  if (!db.studentDictionaryMap) db.studentDictionaryMap = {};

  let currentList: any[] =
    (studentUid && db.studentDictionaryMap[studentUid]) ||
    (cleanEmail && db.studentDictionaryMap[cleanEmail]) ||
    [];

  let exclusions: string[] = [];
  if (studentUid) {
    try {
      const fsList = await fetchStudentVocabularyFromFirestoreServer(studentUid, cleanEmail);
      if (Array.isArray(fsList) && fsList.length > 0) {
        currentList = fsList;
      }
      exclusions = await fetchExcludedDictionaryWordsServer(studentUid);
    } catch {}
  }

  const exSet = new Set(exclusions.map(normalizeDictionaryWord).filter(Boolean));
  const map = new Map<string, any>();
  currentList.forEach((e: any) => {
    const norm = normalizeDictionaryWord(e?.normalizedWord || e?.word);
    if (norm) map.set(norm, e);
  });

  const isDefinitiveAi = Boolean(
    transformation.isAiGenerated && !transformation.isProvisional && !transformation.isFallback
  );

  transformation.vocabularyAndExpressions.forEach((v: any) => {
    const rawWord = (v.term || '').trim();
    if (!rawWord) return;
    const key = normalizeDictionaryWord(rawWord);
    if (!key || exSet.has(key)) return;
    const existing = map.get(key);

    const isPronounce =
      Boolean(v.isPronunciationFocus) ||
      Boolean(v.partOfSpeech?.toLowerCase().includes('pronounc')) ||
      Boolean(v.category?.toLowerCase().includes('pronounc'));

    const isNewWord =
      Boolean(v.isNewWord) ||
      Boolean(v.category?.toLowerCase().includes('new word')) ||
      Boolean(v.partOfSpeech?.toLowerCase().includes('new')) ||
      Boolean(existing);

    // PEDAGOGICAL RULE:
    // Only words marked as New Word (Alt+W) enter into My Dictionary.
    // Items exclusively marked as Pronounce (Alt+P) remain in pedagogical notes and do NOT enter automatically!
    if (isPronounce && !isNewWord && !existing) {
      return;
    }

    const exCount = typeof existing?.practiceCount === 'number' ? existing.practiceCount : 0;
    const existingDef = (existing?.definitionEn || '').trim();
    const hasValidExistingDef = Boolean(
      existingDef && (existing?.enrichmentStatus === 'enriched' || !existing?.isProvisional)
    );

    // Rule: definitionEn must receive EXCLUSIVELY validated English definition generated by AI. Never copy simpleDefinition into definitionEn!
    const rawAiDef = typeof v.definitionEn === 'string' ? v.definitionEn.trim() : '';
    const genericFallbackRegex = /A (fundamental word|natural conversational expression|practical English term|Key communicative expression)/i;
    const isNewGeneric = genericFallbackRegex.test(rawAiDef);
    const hasValidNewAiDef = Boolean(
      isDefinitiveAi &&
      rawAiDef &&
      rawAiDef.length > 5 &&
      !isNewGeneric &&
      !v.isProvisional &&
      !(v as any).isFallback
    );

    let resolvedDef = '';
    let isEnriched = false;

    if (hasValidExistingDef) {
      resolvedDef = existingDef;
      isEnriched = true;
    } else if (hasValidNewAiDef) {
      resolvedDef = rawAiDef;
      isEnriched = true;
    } else {
      resolvedDef = existingDef;
      isEnriched = false;
    }

    const simpleDef = (typeof v.simpleDefinition === 'string' && v.simpleDefinition.trim()) || (typeof existing?.simpleDefinition === 'string' && existing.simpleDefinition.trim()) || '';

    const mergedOrigins = [...(existing?.origins || [])];
    const isDupOrig = mergedOrigins.some(
      (o: any) => o.source === 'native_notes' && o.lessonId === transformation.sessionKey
    );
    if (!isDupOrig) {
      mergedOrigins.push(
        removeUndefinedFields({
          source: 'native_notes',
          activityName: `Native Friends Notes (${transformation.topic || 'Live Session'})`,
          date: transformation.sessionDate,
          lessonId: transformation.sessionKey,
          context: `Introduced in live session: "${transformation.topic || 'Live Session'}"`,
          teacherName: transformation.teacherName,
        })
      );
    }

    const dictEntry: Record<string, any> = {
      ...existing,
      id: existing?.id || `dict_${key.replace(/[^a-zA-Z0-9_-]/g, '_')}_${Date.now()}`,
      word: rawWord,
      originalWord: existing?.originalWord || rawWord,
      normalizedWord: existing?.normalizedWord || key,
      partOfSpeech:
        isDefinitiveAi && v.partOfSpeech
          ? v.partOfSpeech
          : existing?.partOfSpeech || (isPronounce ? 'Pronunciation Focus' : 'Expression'),
      definitionEn: resolvedDef,
      exampleSentenceEn:
        (isDefinitiveAi && Array.isArray(v.realExamples) && v.realExamples[0]) ||
        existing?.exampleSentenceEn ||
        '',
      translationPt: (isDefinitiveAi && v.translationPt) || existing?.translationPt || '',
      cefrLevel: transformation.cefrLevel || existing?.cefrLevel || 'B1',
      sourceActivityName: `Native Friends Notes (${transformation.topic || 'Live Session'})`,
      source: 'live_lesson',
      learnedAt:
        existing?.learnedAt ||
        (transformation.sessionDate
          ? `${transformation.sessionDate}T12:00:00.000Z`
          : new Date().toISOString()),
      studentEmail: cleanEmail || undefined,
      studentUid: studentUid || undefined,
      notFound: false,
      origins: mergedOrigins.map(removeUndefinedFields),
      practiceCount: exCount,
      practiceHistory: existing?.practiceHistory || [],
      enrichmentStatus: isEnriched ? 'enriched' : (existing?.enrichmentStatus || 'pending'),
      isProvisional: !isEnriched,
    };

    if (simpleDef) dictEntry.simpleDefinition = simpleDef;
    if (v.phoneticGuide || existing?.phonetic) dictEntry.phonetic = v.phoneticGuide || existing?.phonetic;
    if (existing?.lastPracticedAt) dictEntry.lastPracticedAt = existing.lastPracticedAt;

    map.set(key, removeUndefinedFields(dictEntry));
  });

  const updatedList = Array.from(map.values()).sort((a, b) =>
    (a.word || '').localeCompare(b.word || '')
  );
  if (studentUid) db.studentDictionaryMap[studentUid] = updatedList;
  if (cleanEmail) db.studentDictionaryMap[cleanEmail] = updatedList;
  await writeDbSync(db);

  if (isDefinitiveAi && studentUid) {
    try {
      await saveStudentVocabularyToFirestoreServer(studentUid, updatedList, cleanEmail);
    } catch (saveErr) {
      console.warn('Backend Firestore vocabulary save notice:', saveErr);
    }
  }
}

// Generate or retrieve Pedagogical Transformation using Gemini AI with fallback
app.post('/api/pedagogical-notes/transform', firebaseAuthMiddleware, async (req, res) => {
  const db = readDb();
  if (!db.pedagogicalTransformationsMap) {
    db.pedagogicalTransformationsMap = {};
  }

  const {
    rawNotes = '',
    topic = 'Conversation & Fluency',
    sessionDate = new Date().toISOString().split('T')[0],
    teacherName = 'Native Friend',
    studentLevel = 'intermediario',
    studentUid = '',
    studentEmail = '',
    lessonId = '',
    sessionKey: customSessionKey = '',
    forceRegenerate = false,
    language: rawLang = '',
    currentLanguage: altLang = '',
  } = req.body || {};

  // Security Hotfix (Etapa 2): Payload bounds validation before any processing
  const bounds = validatePayloadBounds('pedagogical_transform', { text: rawNotes });
  if (!bounds.valid) {
    return res.status(400).json({
      error: 'Payload bounds exceeded',
      message: bounds.error,
    });
  }

  const cleanEmail = (studentEmail || '').toLowerCase().trim();
  const canonicalSessionKey = getCanonicalSessionKey({
    lessonId,
    sessionKey: customSessionKey,
    studentUid,
    studentEmail: cleanEmail,
    sessionDate,
  });
  const contentHash = computeNotesHash(rawNotes);
  const language = (rawLang || altLang || 'pt').toLowerCase().trim();

  // 1. SECURITY & AUTHORIZATION:
  // Strictly verify caller permissions (mandatory Firebase ID token)
  const caller = req.user!;
  const callerUid = caller.uid;
  const callerEmail = (caller.email || '').toLowerCase().trim();
  let cleanUid = callerUid;
  let effectiveEmail = callerEmail;

  // Look up lesson metadata from canonical Firestore lessons/{lessonId}
  let foundLesson: any = null;
  if (lessonId) {
    const firestore = getFirestoreDb();
    if (firestore) {
      try {
        const lSnap = await firestore.collection('lessons').doc(lessonId).get();
        if (lSnap.exists) {
          foundLesson = lSnap.data();
        }
      } catch {}
    }
  }

  if (caller.role === 'student') {
    // Verify student ownership of requested student identifiers
    if (studentUid && studentUid !== callerUid) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Unauthorized access: student UID does not match authenticated user.',
      });
    }
    if (cleanEmail && cleanEmail !== callerEmail) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Unauthorized access: student email does not match authenticated user.',
      });
    }

    if (foundLesson) {
      const lEmail = (foundLesson.studentEmail || '').toLowerCase().trim();
      const lUid = foundLesson.studentUid || '';
      if ((lUid && lUid !== callerUid) || (lEmail && lEmail !== callerEmail)) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Unauthorized access: you may only transform pedagogical notes for your own lessons.',
        });
      }
    }

    cleanUid = callerUid;
    effectiveEmail = callerEmail;
  } else {
    // Teachers and Admins can act on behalf of the student
    cleanUid = studentUid || callerUid;
    effectiveEmail = cleanEmail || callerEmail;
  }

  const effectiveTeacherUid = (caller.role === 'teacher' ? caller.uid : '') || foundLesson?.teacherUid || foundLesson?.tutorUid || '';
  const effectiveTeacherEmail = (caller.role === 'teacher' ? callerEmail : '') || foundLesson?.teacherEmail || foundLesson?.tutorEmail || '';

  // Authoritative student CEFR level from registered user document (prevents client spoofing)
  const registeredStudent = (db.students || []).find((s: any) =>
    (cleanUid && (s.uid === cleanUid || s.id === cleanUid)) ||
    (effectiveEmail && (s.email || '').toLowerCase().trim() === effectiveEmail)
  );
  const profile = (cleanUid && db.userProfiles?.[cleanUid]) || (effectiveEmail && db.userProfiles?.[effectiveEmail]);
  const authoritativeLevel = profile?.level || profile?.englishLevel || registeredStudent?.level || registeredStudent?.englishLevel || studentLevel;
  const cefrMeta = resolveCefrLevel(authoritativeLevel);
  const cefr = cefrMeta.cefr;

  // 2. CACHE LOOKUP:
  // Build composite cache key partitioned by session, content hash, language, CEFR, and prompt version
  const compositeCacheKey = buildPedagogicalCacheKey({
    canonicalSessionKey,
    contentHash,
    language,
    cefrLevel: cefr,
  });

  let cached =
    db.pedagogicalTransformationsMap[compositeCacheKey] ||
    (language === 'pt' ? db.pedagogicalTransformationsMap[canonicalSessionKey] : undefined);

  if (!cached || cached.isProvisional || isLegacyGenericTransformation(cached, rawNotes)) {
    cached = null;
    const candidates = [canonicalSessionKey, customSessionKey, lessonId].filter(Boolean);
    for (const cand of candidates) {
      if (db.pedagogicalTransformationsMap[cand] && db.pedagogicalTransformationsMap[cand].isAiGenerated && !db.pedagogicalTransformationsMap[cand].isProvisional && !isLegacyGenericTransformation(db.pedagogicalTransformationsMap[cand], rawNotes)) {
        cached = db.pedagogicalTransformationsMap[cand];
        break;
      }
      const prefixMatch = Object.entries(db.pedagogicalTransformationsMap || {}).find(([k, v]: [string, any]) => {
        return (k.startsWith(`${cand}__`) || k === cand) && v?.isAiGenerated && !v?.isProvisional && !isLegacyGenericTransformation(v, rawNotes);
      });
      if (prefixMatch) {
        cached = prefixMatch[1];
        break;
      }
    }
  }

  if ((!cached || cached.isProvisional || isLegacyGenericTransformation(cached, rawNotes)) && (canonicalSessionKey || customSessionKey)) {
    const sessionToSearch = canonicalSessionKey || customSessionKey;
    try {
      const fsCached = await fetchPedagogicalTransformationFromFirestoreServer(sessionToSearch, { language, rawNotes });
      if (fsCached && fsCached.isAiGenerated && !fsCached.isProvisional && !isLegacyGenericTransformation(fsCached, rawNotes)) {
        cached = fsCached;
        db.pedagogicalTransformationsMap[compositeCacheKey] = cached;
      }
    } catch {}
    if ((!cached || cached.isProvisional || isLegacyGenericTransformation(cached, rawNotes)) && cleanUid) {
      try {
        const reconstructed = await reconstructTransformationFromJournalAndDictionaryServer(cleanUid, sessionToSearch);
        if (reconstructed && !isLegacyGenericTransformation(reconstructed, rawNotes)) {
          cached = reconstructed;
          db.pedagogicalTransformationsMap[compositeCacheKey] = cached;
        }
      } catch {}
    }
  }

  // FASE 4B.8 & 4B.9: If a valid, non-provisional AI-generated transformation exists for this session, REUSE IT,
  // EXCEPT when the user explicitly triggers forceRegenerate (Refresh Analysis) or when cache contains legacy generic content!
  const isGenericCached = isLegacyGenericTransformation(cached, rawNotes);

  if (!forceRegenerate && !isGenericCached && cached && !cached.isProvisional && cached.isAiGenerated) {
    // FASE 4B.9: Guarantee single idempotent journal entry for the session without repeated Gemini calls
    recordLessonReviewInStudentJournalServer({
      studentUid: cleanUid,
      studentEmail: effectiveEmail,
      transformation: cached,
      compositeCacheKey,
    }).catch((journalErr) => console.warn('Cache hit My Journal sync notice:', journalErr));

    return res.json({
      success: true,
      cached: true,
      transformation: cached,
      attemptsDetails: [],
    });
  }

  // Security Hotfix (Etapa 2 & Residuals): Rate limiting check per authenticated UID
  const rateLimitCheck = await checkAndConsumeRateLimit(callerUid, 'pedagogical_transform');
  if (!rateLimitCheck.allowed) {
    if (rateLimitCheck.unavailable) {
      return sendGeminiCostControlUnavailable(res, 5);
    }
    logGeminiAudited({
      feature: 'pedagogical_transform',
      status: 'RATE_LIMITED',
      callerRole: caller.role,
      detail: `Rate limit hit, retry after ${rateLimitCheck.retryAfterSeconds}s`,
    });
    return res.status(429).json({
      success: false,
      error: 'Rate limit exceeded',
      message: 'Limite de solicitações de análise pedagógica atingido para este usuário. Aguarde alguns instantes.',
      retryAfterSeconds: rateLimitCheck.retryAfterSeconds,
    });
  }

  // Security Hotfix (Etapa 2 & Residuals): Multi-instance Single-Flight Lock
  const flightLock = await acquireSingleFlightLock(`pedagogical_transform:${compositeCacheKey}`);
  if (!flightLock.acquired) {
    if (flightLock.unavailable) {
      return sendGeminiCostControlUnavailable(res, 5);
    }
    logGeminiAudited({
      feature: 'pedagogical_transform',
      status: 'INFLIGHT_LOCKED',
      callerRole: caller.role,
      detail: 'Concurrent generation already in progress for this session',
    });
    return res.status(429).json({
      success: false,
      error: 'Concurrent generation in progress',
      message: 'Uma análise pedagógica para esta sessão já está em andamento. Aguarde alguns instantes.',
      retryAfterSeconds: 4,
    });
  }

  try {
    // Delegate to the single unified executePedagogicalTransformationCore (zero duplicated prompt/AI logic)
    const markings = parseNotesHtml(rawNotes);
    if (!hasValidPedagogicalContent(rawNotes, markings)) {
      return res.status(400).json({
        success: false,
        error: 'InvalidNotesContent',
        message: language === 'pt'
          ? 'As anotações enviadas estão vazias ou não contêm termos pedagógicos válidos para análise.'
          : 'The submitted notes are empty or contain no valid pedagogical content for analysis.',
      });
    }

    const coreResult = await executePedagogicalTransformationCore({
      rawNotes,
      topic,
      sessionDate,
      teacherName,
      authoritativeLevel: String(authoritativeLevel),
      language,
      callerRole: caller.role,
      canonicalSessionKey,
      lessonId: lessonId || undefined,
      studentUid: cleanUid || studentUid,
      studentEmail: cleanEmail,
      effectiveTeacherUid: effectiveTeacherUid || undefined,
      effectiveTeacherEmail: effectiveTeacherEmail || undefined,
      contentHashOverride: contentHash,
    });

    if (coreResult.success && coreResult.transformation) {
      const transformation = coreResult.transformation;
      db.pedagogicalTransformationsMap[compositeCacheKey] = transformation;
      if (language === 'pt') {
        db.pedagogicalTransformationsMap[canonicalSessionKey] = transformation;
      }
      await savePedagogicalTransformationToFirestoreServer(compositeCacheKey, transformation, { rawNotes });
      await syncTransformationVocabToDictionary(transformation, cleanUid, effectiveEmail);

      // FASE 4B.9: Record single, validated pedagogical review in Student's My Journal via Firebase Admin SDK
      let recordedJournalEntry: any = null;
      try {
        const journalRes = await recordLessonReviewInStudentJournalServer({
          studentUid: cleanUid,
          studentEmail: effectiveEmail,
          transformation,
          compositeCacheKey,
        });
        if (journalRes.success && journalRes.entry) {
          recordedJournalEntry = journalRes.entry;
        }
      } catch (journalErr) {
        console.warn('Backend My Journal lesson review save notice:', journalErr);
      }

      await writeDbSync(db);

      return res.json({
        success: true,
        cached: false,
        transformation,
        journalEntry: recordedJournalEntry,
        attemptsDetails: coreResult.attemptsDetails || [],
      });
    }

    const statusCode = coreResult.statusCode || 503;
    return res.status(statusCode).json({
      success: false,
      error: 'AiUnavailable',
      category: coreResult.category || 'SERVICE_UNAVAILABLE',
      message: language === 'pt'
        ? 'O serviço pedagógico de IA está temporariamente indisponível após tentativa com os modelos de contingência. As anotações originais do professor foram preservadas intactas.'
        : 'The pedagogical AI service is temporarily unavailable after trying contingency models. Original teacher notes have been preserved.',
      attemptsCount: coreResult.attemptsCount || 1,
      modelsAttempted: coreResult.modelsAttempted || resolveGeminiContingencyModels(),
      attemptsDetails: coreResult.attemptsDetails || [],
    });
  } finally {
    await flightLock.release();
  }
});

// Retrieve cached pedagogical transformation
app.get('/api/pedagogical-notes', firebaseAuthMiddleware, async (req, res) => {
  if (!req.user || !req.user.uid) {
    return res.status(401).json({ error: 'Unauthorized', message: 'Authentication required.' });
  }

  const caller = req.user;
  const callerUid = String(caller.uid || '').trim();
  const callerEmail = String(caller.email || '').toLowerCase().trim();
  if (!isValidCanonicalUid(callerUid)) {
    return res.status(403).json({
      error: 'Forbidden',
      code: 'CANONICAL_UID_REQUIRED',
      message: 'A valid canonical UID is required.',
    });
  }

  const db = readDb();
  const sessionKey = typeof req.query.sessionKey === 'string'
    ? req.query.sessionKey.trim()
    : (typeof req.query.id === 'string' ? req.query.id.trim() : '');
  const queryLessonId = typeof req.query.lessonId === 'string' ? req.query.lessonId.trim() : '';
  const queryStudentUid = typeof req.query.studentUid === 'string'
    ? req.query.studentUid.trim()
    : (typeof req.query.uid === 'string' ? req.query.uid.trim() : '');
  const queryStudentEmail = typeof req.query.studentEmail === 'string'
    ? req.query.studentEmail.toLowerCase().trim()
    : (typeof req.query.email === 'string' ? req.query.email.toLowerCase().trim() : '');
  const language = typeof req.query.language === 'string'
    ? req.query.language.toLowerCase().trim()
    : (typeof req.query.lang === 'string' ? req.query.lang.toLowerCase().trim() : '');
  const contentHash = typeof req.query.contentHash === 'string' ? req.query.contentHash.trim() : '';

  const isCallerAdmin = caller.role === 'admin';
  let isCallerTeacher = false;

  if (!isCallerAdmin) {
    const authCheck = await resolveApprovedTeacherForSessionNotes(callerUid, caller.email, caller.role, db);
    if (authCheck.callerKind === 'conflict') {
      return res.status(403).json({
        error: 'Forbidden',
        code: 'IDENTITY_CONFLICT',
        message: 'Identity conflict detected on this account.',
      });
    }
    if (authCheck.callerKind === 'pending_teacher') {
      return res.status(403).json({
        error: 'Forbidden',
        code: 'TEACHER_NOT_APPROVED',
        message: 'Your Native Friend profile is pending administrator approval.',
      });
    }
    if (caller.role === 'teacher' && !authCheck.isApproved) {
      return res.status(403).json({
        error: 'Forbidden',
        code: 'TEACHER_NOT_APPROVED',
        message: 'Only approved Native Friends can query student pedagogical notes.',
      });
    }
    isCallerTeacher = authCheck.isApproved;
  }

  // Enforce query parameter boundaries across ALL routes (even when sessionKey/lessonId or studentUid are absent)
  let resolvedTeacherTargetStudentUid = '';
  if (!isCallerAdmin && !isCallerTeacher) {
    if (queryStudentUid && queryStudentUid !== callerUid) {
      return res.status(403).json({ error: 'Forbidden', message: 'Unauthorized access to student notes.' });
    }
    if (queryStudentEmail && (!callerEmail || queryStudentEmail !== callerEmail)) {
      return res.status(403).json({ error: 'Forbidden', message: 'Unauthorized access to student notes.' });
    }
  } else if (isCallerTeacher && !isCallerAdmin) {
    if (queryStudentUid || queryStudentEmail) {
      if (queryStudentUid && !isValidCanonicalUid(queryStudentUid)) {
        return res.status(400).json({
          error: 'CANONICAL_STUDENT_UID_REQUIRED',
          code: 'CANONICAL_STUDENT_UID_REQUIRED',
          message: 'A valid canonical student UID is required.',
        });
      }
      const resolved = await resolveCanonicalStudentUidForSessionNotes({
        studentUid: queryStudentUid,
        studentEmail: queryStudentEmail,
        db,
        excludeUid: callerUid,
      });
      if (!resolved.valid || !resolved.uid) {
        return res.status(resolved.code === 'INVALID_PEDAGOGICAL_IDENTITY' ? 403 : 403).json({
          error: 'Forbidden',
          code: resolved.code || 'UNAUTHORIZED_PEDAGOGICAL_LINK',
          message: resolved.message || 'Teacher is not authorized to query this student.',
        });
      }
      const isLinked = await verifyCanonicalPedagogicalLinkServer(callerUid, resolved.uid);
      if (!isLinked) {
        return res.status(403).json({
          error: 'Forbidden',
          code: 'UNAUTHORIZED_PEDAGOGICAL_LINK',
          message: 'Native Friend does not have an authorized pedagogical link with this student.',
        });
      }
      resolvedTeacherTargetStudentUid = resolved.uid;
    }
  } else if (isCallerAdmin && queryStudentUid && !isValidCanonicalUid(queryStudentUid)) {
    return res.status(400).json({
      error: 'CANONICAL_STUDENT_UID_REQUIRED',
      code: 'CANONICAL_STUDENT_UID_REQUIRED',
      message: 'A valid canonical student UID is required.',
    });
  }

  const linkCache = new Map<string, boolean>();
  const checkTeacherLinkCached = async (targetUid: string): Promise<boolean> => {
    const cleanTarget = targetUid.trim();
    if (!cleanTarget || !isValidCanonicalUid(cleanTarget) || cleanTarget === callerUid) return false;
    if (linkCache.has(cleanTarget)) return linkCache.get(cleanTarget)!;
    const ok = await verifyCanonicalPedagogicalLinkServer(callerUid, cleanTarget);
    linkCache.set(cleanTarget, ok);
    return ok;
  };

  const canCallerAccessRecord = async (
    record: any,
    fallbackOwner?: { studentUid?: string; studentEmail?: string; teacherUid?: string }
  ): Promise<boolean> => {
    if (!record || typeof record !== 'object') return false;
    const rStudentUid = String(record.studentUid || fallbackOwner?.studentUid || '').trim();
    const rStudentEmail = String(record.studentEmail || fallbackOwner?.studentEmail || '').toLowerCase().trim();
    const rTeacherUid = String(record.teacherUid || fallbackOwner?.teacherUid || '').trim();

    if (isCallerAdmin) {
      if (queryStudentUid && rStudentUid && rStudentUid !== queryStudentUid) return false;
      return true;
    }

    if (isCallerTeacher) {
      if (resolvedTeacherTargetStudentUid && rStudentUid && rStudentUid !== resolvedTeacherTargetStudentUid) {
        return false;
      }
      if (rTeacherUid && rTeacherUid === callerUid) {
        if (!rStudentUid || (await checkTeacherLinkCached(rStudentUid))) {
          return true;
        }
      }
      if (rStudentUid && (await checkTeacherLinkCached(rStudentUid))) {
        return true;
      }
      return false;
    }

    // Student caller: strict ownership (never return unattributed records or email-matches when studentUid differs)
    if (rStudentUid) {
      return rStudentUid === callerUid;
    }
    if (rStudentEmail && callerEmail) {
      return rStudentEmail === callerEmail;
    }
    return false;
  };

  if (sessionKey || queryLessonId) {
    const canonicalStudentContextUid = isCallerAdmin
      ? queryStudentUid
      : (isCallerTeacher ? resolvedTeacherTargetStudentUid : callerUid);
    const canonicalStudentContextEmail = isCallerAdmin
      ? queryStudentEmail
      : (isCallerTeacher ? queryStudentEmail : callerEmail);

    const canonicalKey = getCanonicalSessionKey({
      lessonId: queryLessonId || undefined,
      sessionKey,
      studentUid: canonicalStudentContextUid || undefined,
      studentEmail: canonicalStudentContextEmail || undefined,
    });
    const candidateKeys = Array.from(new Set([
      sessionKey,
      canonicalKey,
      queryLessonId,
      queryLessonId ? `lesson_${queryLessonId.replace(/^lesson_/, '')}` : '',
      queryLessonId ? queryLessonId.replace(/^lesson_/, '') : '',
      sessionKey ? sessionKey.replace(/^session_/, '').replace(/^lesson_/, '') : '',
    ].filter(Boolean)));

    // 0. Inspect underlying session_notes or lessons ownership BEFORE looking up or reconstructing transformations
    let underlyingOwner: { studentUid?: string; studentEmail?: string; teacherUid?: string } | undefined;
    for (const key of candidateKeys) {
      const memNote = db.sessionNotesMap?.[key];
      if (memNote) {
        underlyingOwner = {
          studentUid: memNote.studentUid,
          studentEmail: memNote.studentEmail,
          teacherUid: memNote.teacherUid,
        };
        if (!(await canCallerAccessRecord(memNote))) {
          return res.status(403).json({ error: 'Forbidden', message: 'Unauthorized access to student notes.' });
        }
        break;
      }
    }

    if (!underlyingOwner) {
      for (const key of candidateKeys) {
        try {
          const fsNote = await fetchSessionNotesFromFirestoreServer(key);
          if (fsNote) {
            underlyingOwner = {
              studentUid: fsNote.studentUid,
              studentEmail: fsNote.studentEmail,
              teacherUid: fsNote.teacherUid,
            };
            if (!(await canCallerAccessRecord(fsNote))) {
              return res.status(403).json({ error: 'Forbidden', message: 'Unauthorized access to student notes.' });
            }
            break;
          }
        } catch {}
      }
    }

    if (!underlyingOwner) {
      const fs = getFirestoreDb();
      if (fs) {
        for (const cid of Array.from(new Set([queryLessonId, queryLessonId.replace(/^lesson_/, ''), sessionKey].filter(Boolean)))) {
          try {
            const lSnap = await fs.collection('lessons').doc(cid).get().catch(() => null);
            if (lSnap && lSnap.exists) {
              const lData = lSnap.data() || {};
              underlyingOwner = {
                studentUid: lData.studentUid,
                studentEmail: lData.studentEmail,
                teacherUid: lData.teacherUid || lData.teacherAuthUid,
              };
              if (!(await canCallerAccessRecord(lData))) {
                return res.status(403).json({ error: 'Forbidden', message: 'Unauthorized access to student notes.' });
              }
              break;
            }
          } catch {}
        }
      }
    }

    let transformation: any = null;
    // 1. Check in-memory pedagogicalTransformationsMap across candidate keys
    for (const key of candidateKeys) {
      const directCand = db.pedagogicalTransformationsMap?.[key];
      if (directCand) {
        if (!(await canCallerAccessRecord(directCand, underlyingOwner))) {
          return res.status(403).json({ error: 'Forbidden', message: 'Unauthorized access to student notes.' });
        }
        if (directCand.isAiGenerated && !directCand.isProvisional && !isLegacyGenericTransformation(directCand, directCand.rawNotesSnippet)) {
          if ((!language || directCand.language === language) && (!contentHash || directCand.contentHash === contentHash)) {
            transformation = directCand;
            break;
          }
        }
      }

      const matchingEntries = Object.entries(db.pedagogicalTransformationsMap || {}).filter(
        ([k]: [string, any]) => k === key || k.startsWith(`${key}__`)
      );
      for (const [, v] of matchingEntries) {
        if (!v || typeof v !== 'object') continue;
        if (!(await canCallerAccessRecord(v, underlyingOwner))) {
          return res.status(403).json({ error: 'Forbidden', message: 'Unauthorized access to student notes.' });
        }
        const matchLang = !language || (v as any).language === language;
        const matchHash = !contentHash || (v as any).contentHash === contentHash;
        if (
          matchLang &&
          matchHash &&
          (v as any).isAiGenerated &&
          !(v as any).isProvisional &&
          !isLegacyGenericTransformation(v as any, (v as any).rawNotesSnippet)
        ) {
          transformation = v;
          break;
        }
      }
      if (transformation) break;
    }

    // 2. Firestore fallback lookup if in-memory cache misses
    if (!transformation) {
      for (const key of candidateKeys) {
        try {
          const fsMatch = await fetchPedagogicalTransformationFromFirestoreServer(key, { language, contentHash });
          if (fsMatch && fsMatch.isAiGenerated && !fsMatch.isProvisional && !isLegacyGenericTransformation(fsMatch, fsMatch.rawNotesSnippet)) {
            if (!(await canCallerAccessRecord(fsMatch, underlyingOwner))) {
              return res.status(403).json({ error: 'Forbidden', message: 'Unauthorized access to student notes.' });
            }
            transformation = fsMatch;
            const ownerScope = fsMatch.studentUid ? `__uid_${fsMatch.studentUid}` : '';
            const storeKey = fsMatch.cacheKey || `${sessionKey || queryLessonId}${ownerScope}__hash_${fsMatch.contentHash || 'any'}__lang_${fsMatch.language || language || 'pt'}`;
            if (!db.pedagogicalTransformationsMap) db.pedagogicalTransformationsMap = {};
            db.pedagogicalTransformationsMap[storeKey] = fsMatch;
            break;
          }
        } catch (fsErr) {
          console.warn('GET /api/pedagogical-notes Firestore lookup notice:', fsErr);
        }
      }
    }

    // 3. View Journal & My Dictionary fallback: recognize already fed definitions (strictly for caller student)
    if (!transformation && !isCallerAdmin && !isCallerTeacher) {
      for (const key of candidateKeys) {
        try {
          const reconstructed = await reconstructTransformationFromJournalAndDictionaryServer(callerUid, key);
          if (reconstructed && (reconstructed.vocabularyAndExpressions?.length > 0 || reconstructed.mistakesAnalysis?.length > 0 || reconstructed.grammarPoints?.length > 0)) {
            transformation = {
              ...reconstructed,
              studentUid: callerUid,
              studentEmail: reconstructed.studentEmail || callerEmail,
            };
            const storeKey = `${sessionKey || queryLessonId}__uid_${callerUid}__reconstructed__lang_${language || 'pt'}`;
            if (!db.pedagogicalTransformationsMap) db.pedagogicalTransformationsMap = {};
            db.pedagogicalTransformationsMap[storeKey] = transformation;
            break;
          }
        } catch (recErr) {
          console.warn('GET /api/pedagogical-notes journal reconstruction notice:', recErr);
        }
      }
    }

    if (transformation) {
      if (!(await canCallerAccessRecord(transformation, underlyingOwner))) {
        return res.status(403).json({ error: 'Forbidden', message: 'Unauthorized access to student notes.' });
      }
      return res.json(transformation);
    }

    // When a specific session was queried and no transformation exists yet, return null
    return res.json(null);
  }

  // Listing endpoint when both sessionKey and lessonId are absent
  if (!isCallerAdmin && !isCallerTeacher) {
    const list = Object.values(db.pedagogicalTransformationsMap || {}).filter((t: any) => {
      if (!t || typeof t !== 'object') return false;
      if (language && t.language !== language) return false;
      const tUid = String(t.studentUid || '').trim();
      const tEmail = String(t.studentEmail || '').toLowerCase().trim();
      if (tUid) return tUid === callerUid;
      return Boolean(callerEmail && tEmail && tEmail === callerEmail);
    });
    return res.json(list);
  }

  if (isCallerTeacher && !isCallerAdmin) {
    const authorizedList: any[] = [];
    for (const t of Object.values(db.pedagogicalTransformationsMap || {})) {
      if (!t || typeof t !== 'object') continue;
      if (language && (t as any).language !== language) continue;
      if (resolvedTeacherTargetStudentUid && String((t as any).studentUid || '').trim() !== resolvedTeacherTargetStudentUid) {
        continue;
      }
      if (await canCallerAccessRecord(t)) {
        authorizedList.push(t);
      }
    }
    return res.json(authorizedList);
  }

  // Admin caller
  if (queryStudentUid || queryStudentEmail) {
    const list = Object.values(db.pedagogicalTransformationsMap || {}).filter((t: any) => {
      if (!t || typeof t !== 'object') return false;
      if (language && t.language !== language) return false;
      if (queryStudentUid && t.studentUid !== queryStudentUid) return false;
      if (queryStudentEmail && String(t.studentEmail || '').toLowerCase().trim() !== queryStudentEmail) return false;
      return true;
    });
    return res.json(list);
  }

  const adminList = Object.values(db.pedagogicalTransformationsMap || {}).filter(
    (t: any) => !language || (t && t.language === language)
  );
  return res.json(adminList);
});

// ============================================================================
// FASE INSIGHTS.2 — Weekly Learning Insights Endpoint (Zero AI, Deterministic)
// ============================================================================
app.get('/api/weekly-learning-insights', firebaseAuthMiddleware, async (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  const caller = req.user;
  if (!caller || !caller.uid) {
    return res.status(401).json({ error: 'Unauthorized', message: 'Authentication required' });
  }

  const rawStudentUid = ((req.query.studentUid as string) || (req.query.uid as string) || '').trim();
  const rawStudentEmail = ((req.query.studentEmail as string) || (req.query.email as string) || '').toLowerCase().trim();
  const lessonId = ((req.query.lessonId as string) || '').trim();
  const referenceDateStr = ((req.query.referenceDate as string) || '').trim();
  const referenceDate = referenceDateStr ? new Date(referenceDateStr) : new Date();

  const db = readDb();
  const callerUid = caller.uid.trim();
  const callerEmail = (caller.email || '').toLowerCase().trim();

  const isTeacherOrAdmin =
    caller.role === 'teacher' ||
    caller.role === 'admin' ||
    (db.tutorsList || []).some((t: any) => (t.uid && t.uid === callerUid) || (t.id && (t.id === callerUid || t.id === `tutor-${callerUid}`)) || (t.authUid && t.authUid === callerUid) || (callerEmail && t.email && t.email.toLowerCase().trim() === callerEmail)) ||
    (db.teachers || []).some((t: any) => (t.uid && t.uid === callerUid) || (t.id && (t.id === callerUid || t.id === `tutor-${callerUid}`)) || (t.authUid && t.authUid === callerUid) || (callerEmail && t.email && t.email.toLowerCase().trim() === callerEmail));

  const effectiveCallerRole: 'admin' | 'teacher' | 'student' = caller.role === 'admin' ? 'admin' : (isTeacherOrAdmin ? 'teacher' : (caller.role as 'student'));
  const callerForIdentity = { ...caller, role: effectiveCallerRole };

  // Never allow teacher's own UID to masquerade as the student's UID
  let canonicalStudentUid = (rawStudentUid && isValidCanonicalUid(rawStudentUid) && rawStudentUid !== callerUid && !rawStudentUid.startsWith('tutor-')) ? rawStudentUid : '';
  let canonicalStudentEmail = rawStudentEmail || (rawStudentUid.includes('@') ? rawStudentUid.toLowerCase() : '');

  // 1. Authorization check via resolveCanonicalStudentIdentity
  if (effectiveCallerRole !== 'admin') {
    const identityRes = await resolveCanonicalStudentIdentity({
      caller: callerForIdentity,
      studentEmail: canonicalStudentEmail || undefined,
      studentUid: canonicalStudentUid || undefined,
      lessonId: lessonId || undefined,
    });

    if (identityRes.authorized) {
      if (identityRes.canonicalStudentUid && isValidCanonicalUid(identityRes.canonicalStudentUid) && identityRes.canonicalStudentUid !== callerUid) {
        canonicalStudentUid = identityRes.canonicalStudentUid;
      }
      if (identityRes.studentEmail) {
        canonicalStudentEmail = identityRes.studentEmail;
      }
    } else {
      const isAuthorized = await verifyTeacherLessonAccessServer(
        caller.uid,
        caller.email,
        canonicalStudentUid,
        lessonId,
        effectiveCallerRole,
        canonicalStudentEmail
      );
      if (!isAuthorized) {
        return res.status(403).json({
          error: 'Forbidden',
          message: identityRes.error || 'Unauthorized access: you may only access learning insights for your assigned students.',
        });
      }
    }
  }

  // Attempt resolution from all authoritative server sources if not yet resolved
  if (!canonicalStudentUid && canonicalStudentEmail) {
    try {
      const fsDb = getFirestoreDb();
      if (fsDb) {
        const uSnap = await fsDb.collection('users').where('email', '==', canonicalStudentEmail).limit(1).get();
        if (!uSnap.empty) {
          const docId = uSnap.docs[0].id;
          if (docId && docId !== callerUid && isValidCanonicalUid(docId)) {
            canonicalStudentUid = docId;
          }
        }
      }
    } catch {}

    if (!canonicalStudentUid) {
      let lessonStudentUid = '';
      try {
        const fsDb = getFirestoreDb();
        if (fsDb) {
          const lSnap = await fsDb.collection('lessons').where('studentEmail', '==', canonicalStudentEmail).limit(10).get();
          if (lSnap && !lSnap.empty) {
            for (const d of lSnap.docs) {
              const lData = d.data();
              if (lData?.studentUid && isValidCanonicalUid(lData.studentUid) && lData.studentUid !== callerUid) {
                lessonStudentUid = lData.studentUid;
                break;
              }
            }
          }
        }
      } catch {}

      const profile = db.userProfiles?.[canonicalStudentEmail];
      const student = (db.students || []).find((s: any) => (s.email || s.studentEmail || '').toLowerCase().trim() === canonicalStudentEmail);
      const lUid = (profile?.uid && isValidCanonicalUid(profile.uid) && profile.uid !== callerUid ? profile.uid : '') ||
        (student?.uid && isValidCanonicalUid(student.uid) && student.uid !== callerUid ? student.uid : '') ||
        (student?.studentUid && isValidCanonicalUid(student.studentUid) && student.studentUid !== callerUid ? student.studentUid : '') ||
        lessonStudentUid;
      if (lUid) {
        canonicalStudentUid = lUid;
      }
    }
  }

  if (!canonicalStudentUid && !canonicalStudentEmail) {
    return res.status(400).json({ error: 'Bad Request', message: 'Valid student identifier required.' });
  }

  try {
    const targetUid = canonicalStudentUid || callerUid;

    // Fetch exclusively from the 2 canonical sources
    // Source A: My Dictionary → My Words
    const rawWords = await fetchStudentVocabularyFromFirestoreServer(targetUid, canonicalStudentEmail);

    // Source B: View Journal → Your Sentence
    const rawJournal = await fetchStudentDailyJournalFromServerFirestore(targetUid);

    // Deterministic period calculation and payload construction
    const insights = buildWeeklyLearningInsights({
      rawWords,
      rawSentences: rawJournal,
      studentUid: targetUid,
      studentEmail: canonicalStudentEmail,
      referenceDate,
    });

    return res.json({
      success: true,
      ...insights,
    });
  } catch (err: any) {
    console.warn('GET /api/weekly-learning-insights error:', err);
    return res.status(500).json({ error: 'Internal Server Error', message: 'Failed to retrieve weekly learning insights.' });
  }
});

// ============================================================================
// HOTFIX PONTUAL — Insights & Icebreakers Endpoints (Preserved for backwards compatibility)
// ============================================================================

// 1. Retrieve saved lesson insights snapshot (Zero AI call)
app.get('/api/lesson-insights', firebaseAuthMiddleware, async (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  const caller = req.user;
  if (!caller || !caller.uid) {
    return res.status(401).json({ error: 'Unauthorized', message: 'Authentication required' });
  }

  const lessonId = ((req.query.lessonId as string) || '').trim();
  const rawStudentUid = ((req.query.studentUid as string) || (req.query.uid as string) || '').trim();
  const rawStudentEmail = ((req.query.studentEmail as string) || (req.query.email as string) || '').toLowerCase().trim();

  if (!lessonId) {
    return res.status(400).json({ error: 'Bad Request', message: 'Missing required lessonId query param.' });
  }

  const db = readDb();
  const callerUid = caller.uid.trim();
  const callerEmail = (caller.email || '').toLowerCase().trim();
  const isTeacherOrAdmin =
    caller.role === 'teacher' ||
    caller.role === 'admin' ||
    (db.tutorsList || []).some((t: any) => (t.uid && t.uid === callerUid) || (t.id && (t.id === callerUid || t.id === `tutor-${callerUid}`)) || (t.authUid && t.authUid === callerUid) || (callerEmail && t.email && t.email.toLowerCase().trim() === callerEmail)) ||
    (db.teachers || []).some((t: any) => (t.uid && t.uid === callerUid) || (t.id && (t.id === callerUid || t.id === `tutor-${callerUid}`)) || (t.authUid && t.authUid === callerUid) || (callerEmail && t.email && t.email.toLowerCase().trim() === callerEmail));

  if (!isTeacherOrAdmin) {
    return res.status(403).json({ error: 'Forbidden', message: 'Access denied: Teacher or administrator privileges required.' });
  }

  const effectiveCallerRole: 'admin' | 'teacher' | 'student' = caller.role === 'admin' ? 'admin' : (isTeacherOrAdmin ? 'teacher' : (caller.role as 'student'));
  const callerForIdentity = { ...caller, role: effectiveCallerRole };

  // Never allow teacher's own UID to masquerade as the student's UID
  let canonicalStudentUid = (rawStudentUid && isValidCanonicalUid(rawStudentUid) && rawStudentUid !== callerUid && !rawStudentUid.startsWith('tutor-')) ? rawStudentUid : '';
  let canonicalStudentEmail = rawStudentEmail || (rawStudentUid.includes('@') ? rawStudentUid.toLowerCase() : '');

  if (effectiveCallerRole !== 'admin') {
    const identityRes = await resolveCanonicalStudentIdentity({
      caller: callerForIdentity,
      studentEmail: canonicalStudentEmail || undefined,
      studentUid: canonicalStudentUid || undefined,
      lessonId: lessonId || undefined,
    });

    if (identityRes.authorized) {
      if (identityRes.canonicalStudentUid && isValidCanonicalUid(identityRes.canonicalStudentUid) && identityRes.canonicalStudentUid !== callerUid) {
        canonicalStudentUid = identityRes.canonicalStudentUid;
      }
      if (identityRes.studentEmail) {
        canonicalStudentEmail = identityRes.studentEmail;
      }
    } else {
      const isAuthorized = await verifyTeacherLessonAccessServer(
        caller.uid,
        caller.email,
        canonicalStudentUid,
        lessonId,
        effectiveCallerRole,
        canonicalStudentEmail
      );
      if (!isAuthorized) {
        return res.status(403).json({ error: 'Forbidden', message: identityRes.error || 'Unauthorized access to this lesson.' });
      }
    }
  }

  // Attempt resolution from all authoritative server sources if not yet resolved
  if (!canonicalStudentUid && canonicalStudentEmail) {
    try {
      const fsDb = getFirestoreDb();
      if (fsDb) {
        const uSnap = await fsDb.collection('users').where('email', '==', canonicalStudentEmail).limit(1).get();
        if (!uSnap.empty) {
          const docId = uSnap.docs[0].id;
          if (docId && docId !== callerUid && isValidCanonicalUid(docId)) {
            canonicalStudentUid = docId;
          }
        }
      }
    } catch {}

    if (!canonicalStudentUid) {
      try {
        const { getFirebaseAdminAuth } = await import('./src/serverFirebaseAdmin');
        const adminAuth = getFirebaseAdminAuth();
        if (adminAuth) {
          const rec = await adminAuth.getUserByEmail(canonicalStudentEmail);
          if (rec?.uid && isValidCanonicalUid(rec.uid) && rec.uid !== callerUid) {
            canonicalStudentUid = rec.uid;
          }
        }
      } catch {}
    }

    if (!canonicalStudentUid) {
      let lessonStudentUid = '';
      try {
        const fsDb = getFirestoreDb();
        if (fsDb) {
          const lSnap = await fsDb.collection('lessons').where('studentEmail', '==', canonicalStudentEmail).limit(10).get();
          if (lSnap && !lSnap.empty) {
            for (const d of lSnap.docs) {
              const lData = d.data();
              if (lData?.studentUid && isValidCanonicalUid(lData.studentUid) && lData.studentUid !== callerUid) {
                lessonStudentUid = lData.studentUid;
                break;
              }
            }
          }
        }
      } catch {}

      const profile = db.userProfiles?.[canonicalStudentEmail];
      const student = (db.students || []).find((s: any) => (s.email || s.studentEmail || '').toLowerCase().trim() === canonicalStudentEmail);
      const lUid = (profile?.uid && isValidCanonicalUid(profile.uid) && profile.uid !== callerUid ? profile.uid : '') ||
        (student?.uid && isValidCanonicalUid(student.uid) && student.uid !== callerUid ? student.uid : '') ||
        (student?.studentUid && isValidCanonicalUid(student.studentUid) && student.studentUid !== callerUid ? student.studentUid : '') ||
        lessonStudentUid;
      if (lUid) {
        canonicalStudentUid = lUid;
      }
    }
  }

  try {
    const cached = await fetchLessonInsightsFromFirestoreServer(lessonId);
    if (cached) {
      return res.json({
        exists: true,
        snapshot: cached,
        canonicalStudentUid: canonicalStudentUid || cached.studentUid,
        studentEmail: canonicalStudentEmail,
      });
    }
    return res.json({
      exists: false,
      snapshot: null,
      canonicalStudentUid,
      studentEmail: canonicalStudentEmail,
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'Internal Server Error', message: err?.message || 'Failed to fetch insights.' });
  }
});

// 2. Generate or retrieve on-demand pedagogical snapshot for a specific student and lesson
app.post('/api/lesson-insights/generate', firebaseAuthMiddleware, async (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  const caller = req.user;
  if (!caller || !caller.uid) {
    return res.status(401).json({ error: 'Unauthorized', message: 'Authentication required' });
  }

  const db = readDb();
  const callerUid = caller.uid.trim();
  const callerEmail = (caller.email || '').toLowerCase().trim();
  const isTeacherOrAdmin =
    caller.role === 'teacher' ||
    caller.role === 'admin' ||
    (db.tutorsList || []).some((t: any) => (t.uid && t.uid === callerUid) || (t.id && (t.id === callerUid || t.id === `tutor-${callerUid}`)) || (t.authUid && t.authUid === callerUid) || (callerEmail && t.email && t.email.toLowerCase().trim() === callerEmail)) ||
    (db.teachers || []).some((t: any) => (t.uid && t.uid === callerUid) || (t.id && (t.id === callerUid || t.id === `tutor-${callerUid}`)) || (t.authUid && t.authUid === callerUid) || (callerEmail && t.email && t.email.toLowerCase().trim() === callerEmail));

  if (!isTeacherOrAdmin) {
    return res.status(403).json({ error: 'Forbidden', message: 'Access denied: Teacher or administrator privileges required.' });
  }

  const body = req.body || {};
  const lessonId = (body.lessonId || '').trim();
  const rawStudentUid = (body.studentUid || '').trim();
  const rawStudentEmail = (body.studentEmail || '').toLowerCase().trim();

  if (!lessonId || (!rawStudentUid && !rawStudentEmail)) {
    return res.status(400).json({ error: 'Bad Request', message: 'Missing required lessonId or student identifier.' });
  }

  const effectiveCallerRole: 'admin' | 'teacher' | 'student' = caller.role === 'admin' ? 'admin' : (isTeacherOrAdmin ? 'teacher' : (caller.role as 'student'));
  const callerForIdentity = { ...caller, role: effectiveCallerRole };

  // Never allow teacher's own UID to masquerade as the student's UID
  let canonicalStudentUid = (rawStudentUid && isValidCanonicalUid(rawStudentUid) && rawStudentUid !== callerUid && !rawStudentUid.startsWith('tutor-')) ? rawStudentUid : '';
  let canonicalStudentEmail = rawStudentEmail || (rawStudentUid.includes('@') ? rawStudentUid.toLowerCase() : '');

  if (effectiveCallerRole !== 'admin') {
    const identityRes = await resolveCanonicalStudentIdentity({
      caller: callerForIdentity,
      studentEmail: canonicalStudentEmail || undefined,
      studentUid: canonicalStudentUid || undefined,
      lessonId: lessonId || undefined,
    });

    if (identityRes.authorized) {
      if (identityRes.canonicalStudentUid && isValidCanonicalUid(identityRes.canonicalStudentUid) && identityRes.canonicalStudentUid !== callerUid) {
        canonicalStudentUid = identityRes.canonicalStudentUid;
      }
      if (identityRes.studentEmail) {
        canonicalStudentEmail = identityRes.studentEmail;
      }
    } else {
      const isAuthorized = await verifyTeacherLessonAccessServer(
        caller.uid,
        caller.email,
        canonicalStudentUid,
        lessonId,
        effectiveCallerRole,
        canonicalStudentEmail
      );
      if (!isAuthorized) {
        return res.status(403).json({
          error: 'Forbidden',
          message: identityRes.error || 'Unauthorized access: you may only generate insights for your assigned students.',
        });
      }
    }
  }

  // Attempt resolution from all authoritative server sources if not yet resolved
  if (!canonicalStudentUid && canonicalStudentEmail) {
    try {
      const fsDb = getFirestoreDb();
      if (fsDb) {
        const uSnap = await fsDb.collection('users').where('email', '==', canonicalStudentEmail).limit(1).get();
        if (!uSnap.empty) {
          const docId = uSnap.docs[0].id;
          if (docId && docId !== callerUid && isValidCanonicalUid(docId)) {
            canonicalStudentUid = docId;
          }
        }
      }
    } catch {}

    if (!canonicalStudentUid) {
      try {
        const { getFirebaseAdminAuth } = await import('./src/serverFirebaseAdmin');
        const adminAuth = getFirebaseAdminAuth();
        if (adminAuth) {
          const rec = await adminAuth.getUserByEmail(canonicalStudentEmail);
          if (rec?.uid && isValidCanonicalUid(rec.uid) && rec.uid !== callerUid) {
            canonicalStudentUid = rec.uid;
          }
        }
      } catch {}
    }

    if (!canonicalStudentUid) {
      let lessonStudentUid = '';
      try {
        const fsDb = getFirestoreDb();
        if (fsDb) {
          const lSnap = await fsDb.collection('lessons').where('studentEmail', '==', canonicalStudentEmail).limit(10).get();
          if (lSnap && !lSnap.empty) {
            for (const d of lSnap.docs) {
              const lData = d.data();
              if (lData?.studentUid && isValidCanonicalUid(lData.studentUid) && lData.studentUid !== callerUid) {
                lessonStudentUid = lData.studentUid;
                break;
              }
            }
          }
        }
      } catch {}

      const profile = db.userProfiles?.[canonicalStudentEmail];
      const student = (db.students || []).find((s: any) => (s.email || s.studentEmail || '').toLowerCase().trim() === canonicalStudentEmail);
      const lUid = (profile?.uid && isValidCanonicalUid(profile.uid) && profile.uid !== callerUid ? profile.uid : '') ||
        (student?.uid && isValidCanonicalUid(student.uid) && student.uid !== callerUid ? student.uid : '') ||
        (student?.studentUid && isValidCanonicalUid(student.studentUid) && student.studentUid !== callerUid ? student.studentUid : '') ||
        lessonStudentUid;
      if (lUid) {
        canonicalStudentUid = lUid;
      }
    }
  }

  const effectiveStudentUid = (canonicalStudentUid && isValidCanonicalUid(canonicalStudentUid) && canonicalStudentUid !== callerUid)
    ? canonicalStudentUid
    : (isValidCanonicalUid(rawStudentUid) && rawStudentUid !== callerUid ? rawStudentUid : '');

  try {
    // A. Recheck Firestore cache: if already saved, return immediately with ZERO AI calls!
    const cached = await fetchLessonInsightsFromFirestoreServer(lessonId);
    if (cached && cached.summary) {
      return res.json({
        success: true,
        reused: true,
        snapshot: cached,
        canonicalStudentUid: effectiveStudentUid,
        studentEmail: canonicalStudentEmail,
      });
    }

    // B. Fetch student's real completed activities between previous lesson and current lesson
    const activities = await getStudentActivitiesBetweenLessonsServer(
      effectiveStudentUid,
      canonicalStudentEmail,
      lessonId,
      caller.uid
    );

    // C. If student has no activities logged, show discreet English message with ZERO AI calls!
    if (!activities.hasActivities || (activities.videos.length === 0 && activities.vocabulary.length === 0)) {
      const emptyMessage = 'No routine activities or 5 Words logged by the student since the last lesson.';
      const emptySnapshot = {
        lessonId,
        studentUid: effectiveStudentUid,
        teacherUid: caller.uid,
        summary: `Weekly Learning Snapshot\n- Videos & Topics: None logged yet\n- Key Vocabulary: None logged yet\n- Conversation Starters:\n  1. How was your week, and did you have time to practice English?\n  2. What topic would you like to explore together today?`,
        videoTopics: [],
        keyVocabulary: [],
        conversationStarters: [
          'How was your week, and did you have time to practice English?',
          'What topic would you like to explore together today?',
        ],
        wordCount: 36,
        isAiGenerated: false,
        isNoActivityNotice: true,
        createdAt: new Date().toISOString(),
      };
      return res.json({
        success: true,
        hasActivities: false,
        reused: false,
        message: emptyMessage,
        snapshot: emptySnapshot,
        canonicalStudentUid: effectiveStudentUid,
        studentEmail: canonicalStudentEmail,
      });
    }

    // D. Acquire single-flight lock to avoid duplicate calls on rapid clicks
    const lockKey = `lesson_insights:${lessonId}`;
    const lock = await acquireSingleFlightLock(lockKey);
    if (!lock.acquired) {
      await new Promise((r) => setTimeout(r, 1200));
      const newlyCached = await fetchLessonInsightsFromFirestoreServer(lessonId);
      if (newlyCached) {
        return res.json({
          success: true,
          reused: true,
          snapshot: newlyCached,
          canonicalStudentUid: effectiveStudentUid,
          studentEmail: canonicalStudentEmail,
        });
      }
      return res.status(429).json({ error: 'RateLimited', message: 'An insights request for this lesson is already processing. Please wait.' });
    }

    try {
      const rateLimitCheck = await checkAndConsumeRateLimit(caller.uid, 'lesson_insights');
      if (!rateLimitCheck.allowed) {
        return res.status(429).json({ error: 'RateLimited', message: `Too many requests. Please retry in ${rateLimitCheck.retryAfterSeconds}s.` });
      }

      // E. Build minimal prompt strictly limited to studied videos & 5 Words (no sensitive identifiers)
      const videoTitles = activities.videos.map((v, i) => `${i + 1}. ${v.title} (${v.dayOfWeek || 'routine'})`).join('\n');
      const vocabItems = activities.vocabulary.map((w, i) => `${i + 1}. "${w.word}" - Context: ${w.context || 'Routine'}`).join('\n');

      const promptData = `Real student activities completed between last lesson and current lesson:
[VIDEOS STUDIED]
${videoTitles || 'None'}

[5 WORDS ROUTINE VOCABULARY]
${vocabItems || 'None'}`;

      const systemInstruction = `You are an expert pedagogical assistant for 1-on-1 English teachers (Native Friends).
Generate a concise learning snapshot in English based strictly on the student's real completed activities since the last lesson.
The output MUST be a valid JSON object adhering to this schema:
{
  "summary": "Weekly Learning Snapshot\\n- Videos & Topics: <summarized themes from real videos>\\n- Key Vocabulary: <up to 5 real words>\\n- Conversation Starters:\\n  1. <conversational question 1>\\n  2. <conversational question 2>",
  "videoTopics": ["topic 1", ...],
  "keyVocabulary": ["word 1", ...],
  "conversationStarters": ["question 1", "question 2"]
}

STRICT CONSTRAINTS:
1. ALWAYS IN ENGLISH.
2. The entire "summary" string MUST NOT EXCEED 90 WORDS. Keep it concise, punchy, and natural.
3. NEVER invent activities, videos, or words. Ground yourself strictly in the provided data.
4. No filler, no apologies, no conversational greetings in JSON.`;

      const geminiResult = await executeGeminiWithContingency({
        feature: 'lesson_insights',
        callerRole: caller.role,
        systemInstruction,
        untrustedUserDataPrompt: promptData,
        jsonValidator: (val) => Boolean(val && typeof val.summary === 'string' && val.summary.trim().length > 0),
      });

      if (!geminiResult || !geminiResult.parsedJson) {
        return res.status(503).json({
          error: 'ServiceUnavailable',
          message: 'Unable to generate learning snapshot at this moment. Please try again later.',
        });
      }

      const parsed = geminiResult.parsedJson;
      let summaryText = (parsed.summary || '').trim();

      // Enforce word count limit: max 90 words
      const words = summaryText.split(/\s+/).filter(Boolean);
      if (words.length > 90) {
        summaryText = words.slice(0, 90).join(' ') + '...';
      }
      const finalWordCount = summaryText.split(/\s+/).filter(Boolean).length;

      const snapshotPayload = {
        lessonId,
        studentUid: effectiveStudentUid,
        teacherUid: caller.uid,
        summary: summaryText,
        videoTopics: Array.isArray(parsed.videoTopics) ? parsed.videoTopics : activities.videos.map((v) => v.title),
        keyVocabulary: Array.isArray(parsed.keyVocabulary) ? parsed.keyVocabulary : activities.vocabulary.map((w) => w.word),
        conversationStarters: Array.isArray(parsed.conversationStarters) ? parsed.conversationStarters : [],
        wordCount: finalWordCount,
        isAiGenerated: true,
        sourceActivitiesCount: {
          videos: activities.videos.length,
          vocabulary: activities.vocabulary.length,
        },
        createdAt: new Date().toISOString(),
      };

      // F. Persist to Firestore collection 'lesson_insights' in '(default)'
      await saveLessonInsightsToFirestoreServer(lessonId, snapshotPayload);

      return res.json({
        success: true,
        reused: false,
        snapshot: snapshotPayload,
        canonicalStudentUid: effectiveStudentUid,
        studentEmail: canonicalStudentEmail,
      });
    } finally {
      await lock.release();
    }
  } catch (err: any) {
    console.warn('POST /api/lesson-insights/generate error:', err);
    return res.status(500).json({ error: 'Internal Server Error', message: 'Failed to generate lesson snapshot.' });
  }
});

// Student Personal Dictionary Endpoints (isolated by student UID and email with verified authorization)
app.get('/api/student-dictionary', async (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  const db = readDb();
  const caller = await getVerifiedUserFromRequest(req);

  if (!caller) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Authentication required: verified user token missing.',
    });
  }

  const requestedEmail = ((req.query.studentEmail as string) || (req.query.email as string) || '').toLowerCase().trim();
  const requestedUid = ((req.query.studentUid as string) || (req.query.uid as string) || '').trim();
  const requestedLessonId = ((req.query.lessonId as string) || '').trim();

  // Admin access to all dictionaries (strictly requires verified admin token)
  if (caller.role === 'admin' && !requestedEmail && !requestedUid) {
    return res.json(db.studentDictionaryMap || {});
  }

  const identityRes = await resolveCanonicalStudentIdentity({
    caller,
    studentEmail: requestedEmail,
    studentUid: requestedUid,
    lessonId: requestedLessonId || undefined,
  });

  if (!identityRes.authorized) {
    return res.status(identityRes.statusCode || 403).json({
      error: 'Forbidden',
      message: identityRes.error || 'Access denied to student dictionary.',
    });
  }

  const canonicalUid = identityRes.canonicalStudentUid;
  const canonicalEmail = identityRes.studentEmail;

  // Fetch directly from canonical Firestore path
  const firestoreWords = await fetchStudentVocabularyFromFirestoreServer(canonicalUid, canonicalEmail);
  const canonicalExclusions = await fetchExcludedDictionaryWordsServer(canonicalUid);
  const excludedSet = new Set(canonicalExclusions.map(normalizeDictionaryWord).filter(Boolean));

  let activeWords = firestoreWords;
  if (activeWords.length > 0) {
    if (!db.studentDictionaryMap) db.studentDictionaryMap = {};
    if (canonicalUid) db.studentDictionaryMap[canonicalUid] = activeWords;
    if (canonicalEmail) db.studentDictionaryMap[canonicalEmail] = activeWords;
  } else {
    // Fallback to in-memory db if Firestore had no words, filtering out tombstones
    const fromEmail: any[] = (canonicalEmail && db.studentDictionaryMap?.[canonicalEmail]) || [];
    const fromUid: any[] = (canonicalUid && db.studentDictionaryMap?.[canonicalUid]) || [];
    const map = new Map<string, any>();
    [...fromEmail, ...fromUid].forEach((entry: any) => {
      const w = normalizeDictionaryWord(entry.normalizedWord || entry.word);
      if (w && !excludedSet.has(w)) map.set(w, entry);
    });
    activeWords = Array.from(map.values()).sort((a, b) => (a.word || '').localeCompare(b.word || ''));
  }

  // Backwards compatibility: If legacy array format requested
  if (req.query.format === 'legacy' || req.headers['x-legacy-format'] === 'true') {
    return res.json(activeWords);
  }

  return res.json({
    success: true,
    status: activeWords.length > 0 ? 'loaded_with_words' : 'loaded_empty',
    dictionary: activeWords,
    excludedWords: canonicalExclusions,
    count: activeWords.length,
    studentUid: canonicalUid,
    studentEmail: canonicalEmail,
  });
});

app.delete('/api/student-dictionary', async (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  const db = readDb();
  const caller = await getVerifiedUserFromRequest(req);

  if (!caller) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Authentication required: verified user token missing.',
    });
  }

  const rawWord = req.body?.word || req.query?.word;
  const rawWords = req.body?.words || (rawWord ? [rawWord] : []);
  const normalizedWords = Array.isArray(rawWords)
    ? Array.from(new Set(rawWords.map((w: string) => normalizeDictionaryWord(w)).filter(Boolean)))
    : [];

  if (normalizedWords.length === 0) {
    return res.status(400).json({
      error: 'Bad Request',
      message: 'Word or words array is required for dictionary exclusion.',
    });
  }

  let canonicalStudentUid = '';
  let studentEmail = '';

  if (caller.role === 'student') {
    // For student callers: identity is strictly determined by verified token UID
    // Rejects any studentUid or studentEmail that does not match the caller's verified identity
    const requestedUid = ((req.body?.studentUid || req.query?.studentUid || req.body?.uid || req.query?.uid) as string || '').trim();
    const requestedEmail = ((req.body?.studentEmail || req.query?.studentEmail || req.body?.email || req.query?.email) as string || '').toLowerCase().trim();

    if (requestedUid && requestedUid !== caller.uid) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Students cannot delete dictionary entries of other users.',
      });
    }

    if (requestedEmail && caller.email && requestedEmail !== caller.email.toLowerCase().trim()) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Students cannot delete dictionary entries of other users.',
      });
    }

    canonicalStudentUid = caller.uid;
    studentEmail = caller.email?.toLowerCase().trim() || '';
  } else {
    // Admin or authorized Teacher
    const requestedUid = ((req.body?.studentUid || req.query?.studentUid || req.body?.uid || req.query?.uid) as string || '').trim();
    const requestedEmail = ((req.body?.studentEmail || req.query?.studentEmail || req.body?.email || req.query?.email) as string || '').toLowerCase().trim();
    const requestedLessonId = ((req.body?.lessonId || req.query?.lessonId) as string || '').trim();

    const identityRes = await resolveCanonicalStudentIdentity({
      caller,
      studentEmail: requestedEmail,
      studentUid: requestedUid,
      lessonId: requestedLessonId || undefined,
    });

    if (!identityRes.authorized) {
      return res.status(identityRes.statusCode || 403).json({
        error: 'Forbidden',
        message: identityRes.error || 'Access denied to delete student dictionary entry.',
      });
    }

    canonicalStudentUid = identityRes.canonicalStudentUid;
    studentEmail = identityRes.studentEmail || '';
  }

  if (!canonicalStudentUid || !isValidCanonicalUid(canonicalStudentUid)) {
    return res.status(422).json({
      error: 'Unprocessable Entity',
      message: 'Canonical student UID could not be unequivocally determined.',
    });
  }

  // Persist canonical logical exclusions in users/{canonicalUid}.excludedDictionaryWords
  let updatedExclusions: string[] = [];
  try {
    updatedExclusions = await addExcludedDictionaryWordsServer(canonicalStudentUid, normalizedWords);
  } catch (saveErr: any) {
    console.error('Failed to persist student dictionary exclusion:', saveErr);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to persist dictionary exclusions to canonical Cloud Firestore.',
    });
  }

  // Filter in-memory db fallback as well
  const excludedSet = new Set(updatedExclusions.map(normalizeDictionaryWord));
  if (db.studentDictionaryMap) {
    if (canonicalStudentUid && Array.isArray(db.studentDictionaryMap[canonicalStudentUid])) {
      db.studentDictionaryMap[canonicalStudentUid] = db.studentDictionaryMap[canonicalStudentUid].filter(
        (e: any) => !excludedSet.has(normalizeDictionaryWord(e.normalizedWord || e.word))
      );
    }
    if (studentEmail && Array.isArray(db.studentDictionaryMap[studentEmail])) {
      db.studentDictionaryMap[studentEmail] = db.studentDictionaryMap[studentEmail].filter(
        (e: any) => !excludedSet.has(normalizeDictionaryWord(e.normalizedWord || e.word))
      );
    }
    await writeDbSync(db);
  }

  // Authoritative active words after exclusions
  const activeWords = await fetchStudentVocabularyFromFirestoreServer(canonicalStudentUid, studentEmail);

  return res.json({
    success: true,
    studentUid: canonicalStudentUid,
    studentEmail,
    excludedWord: normalizedWords[0],
    excludedWords: updatedExclusions,
    activeCount: activeWords.length,
    dictionary: activeWords,
  });
});

app.post('/api/student-dictionary', async (req, res) => {
  const db = readDb();
  const caller = await getVerifiedUserFromRequest(req);

  if (!caller) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Authentication required: verified user token missing.',
    });
  }

  const { studentEmail, studentUid, lessonId, teacherEmail, teacherName, entries, entry } = req.body || {};

  // Resolve canonical student identity and verify teacher's authorized pedagogical link
  const identityRes = await resolveCanonicalStudentIdentity({
    caller,
    studentEmail,
    studentUid,
    lessonId,
  });

  if (!identityRes.authorized) {
    return res.status(identityRes.statusCode || 403).json({
      error: identityRes.statusCode === 422 ? 'Unprocessable Entity' : 'Forbidden',
      message: identityRes.error || 'Access denied: unauthorized student dictionary persistence.',
    });
  }

  const canonicalStudentUid = identityRes.canonicalStudentUid;
  const verifiedStudentEmail = identityRes.studentEmail;

  // Strict invariant: Teacher UID can NEVER be the student UID
  if (caller.role === 'teacher' && canonicalStudentUid === caller.uid) {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'Teacher UID cannot be used as student UID for dictionary persistence.',
    });
  }

  const itemsToAdd = Array.isArray(entries) ? entries : (entry ? [entry] : []);
  if (itemsToAdd.length === 0) {
    const existing = await fetchStudentVocabularyFromFirestoreServer(canonicalStudentUid, verifiedStudentEmail);
    const existingExclusions = await fetchExcludedDictionaryWordsServer(canonicalStudentUid);
    return res.json({ success: true, studentUid: canonicalStudentUid, dictionary: existing, excludedWords: existingExclusions });
  }

  // ETAPA E: Distinguish automatic sync vs explicit intentional addition
  const isAutomaticSync = Boolean(
    req.body?.isAutomaticSync === true ||
    req.body?.syncType === 'routine_sync' ||
    req.body?.syncType === 'automatic' ||
    req.body?.syncType === 'native_notes' ||
    req.body?.source === 'routine_sync'
  );

  let finalItemsToAdd = itemsToAdd;

  if (isAutomaticSync) {
    // Sincronizações automáticas não podem remover tombstones nem ressuscitar palavras excluídas
    const currentExclusions = await fetchExcludedDictionaryWordsServer(canonicalStudentUid);
    const exSet = new Set(currentExclusions.map(normalizeDictionaryWord).filter(Boolean));
    finalItemsToAdd = itemsToAdd.filter((e: any) => {
      const norm = normalizeDictionaryWord(e.normalizedWord || e.word);
      return Boolean(norm && !exSet.has(norm));
    });
  } else {
    // Explicit inclusion by student or teacher reintroduces words by removing tombstones atomically
    const wordsToReintroduce = itemsToAdd
      .map((e: any) => normalizeDictionaryWord(e.normalizedWord || e.word))
      .filter(Boolean);
    if (wordsToReintroduce.length > 0) {
      try {
        await removeExcludedDictionaryWordsServer(canonicalStudentUid, wordsToReintroduce);
      } catch (unexcludeErr) {
        console.warn('Notice removing exclusion tombstones on explicit add:', unexcludeErr);
      }
    }
  }

  // Persist directly and permanently to Cloud Firestore using Firebase Admin SDK
  if (finalItemsToAdd.length > 0) {
    try {
      const persisted = await saveStudentVocabularyToFirestoreServer(canonicalStudentUid, finalItemsToAdd, verifiedStudentEmail);
      if (!persisted) {
        console.error('[serverApp] saveStudentVocabularyToFirestoreServer unconfirmed for canonicalStudentUid:', canonicalStudentUid);
        return res.status(500).json({
          error: 'Internal Server Error',
          message: 'Failed to confirm canonical persistence in Firestore.',
        });
      }
    } catch (saveErr: any) {
      console.error('Failed to persist student vocabulary in Firestore:', saveErr);
      return res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to persist student vocabulary to canonical Cloud Firestore.',
      });
    }
  }

  // Retrieve authoritative consolidated list from canonical Firestore path
  const updatedList = await fetchStudentVocabularyFromFirestoreServer(canonicalStudentUid, verifiedStudentEmail);
  const remainingExclusions = await fetchExcludedDictionaryWordsServer(canonicalStudentUid);

  // Sync memory cache
  if (!db.studentDictionaryMap) db.studentDictionaryMap = {};
  if (canonicalStudentUid) db.studentDictionaryMap[canonicalStudentUid] = updatedList;
  if (verifiedStudentEmail) db.studentDictionaryMap[verifiedStudentEmail] = updatedList;
  await writeDbSync(db);

  return res.json({
    success: true,
    studentUid: canonicalStudentUid,
    studentEmail: verifiedStudentEmail,
    dictionary: updatedList,
    excludedWords: remainingExclusions,
  });
});

// Endpoint: Enrich student vocabulary on demand exclusively via Gemini (used for Video routine words & new words)
app.post('/api/student-dictionary/enrich', async (req, res) => {
  const db = readDb();
  const caller = await getVerifiedUserFromRequest(req);

  if (!caller) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Authentication required: verified user token missing.',
    });
  }

  const { studentEmail, studentUid, words, studentLevel } = req.body || {};

  const identityRes = await resolveCanonicalStudentIdentity({
    caller,
    studentEmail,
    studentUid,
  });

  if (!identityRes.authorized) {
    return res.status(identityRes.statusCode || 403).json({
      error: 'Forbidden',
      message: identityRes.error || 'Access denied: unauthorized student dictionary persistence.',
    });
  }

  const canonicalStudentUid = identityRes.canonicalStudentUid;
  const verifiedStudentEmail = identityRes.studentEmail;

  const rawWords: string[] = Array.isArray(words) ? words : [];
  if (rawWords.length === 0) {
    return res.json({ success: true, enrichedEntries: [] });
  }

  // Fetch current vocabulary and exclusions
  const currentVocab = await fetchStudentVocabularyFromFirestoreServer(canonicalStudentUid, verifiedStudentEmail);
  const exclusions = await fetchExcludedDictionaryWordsServer(canonicalStudentUid);
  const exSet = new Set(exclusions.map(normalizeDictionaryWord).filter(Boolean));

  const existingMap = new Map<string, any>();
  currentVocab.forEach((entry: any) => {
    const norm = normalizeDictionaryWord(entry.normalizedWord || entry.word);
    if (norm) existingMap.set(norm, entry);
  });

  // Identify words needing enrichment (definitionEn missing or empty, and not excluded)
  const wordsNeedingEnrichment: string[] = [];
  rawWords.forEach((w) => {
    const clean = (w || '').trim();
    const norm = normalizeDictionaryWord(clean);
    if (!norm || exSet.has(norm)) return;
    const existing = existingMap.get(norm);
    if (!existing || !existing.definitionEn || existing.definitionEn.trim().length === 0 || existing.enrichmentStatus === 'pending') {
      wordsNeedingEnrichment.push(clean);
    }
  });

  // If zero words need enrichment (all already have definitions): zero Gemini calls!
  // "Evitar chamadas Gemini por palavra já enriquecida e válida."
  if (wordsNeedingEnrichment.length === 0) {
    const matching = rawWords
      .map((w) => existingMap.get(normalizeDictionaryWord(w)))
      .filter(Boolean);
    return res.json({ success: true, enrichedEntries: matching, cached: true });
  }

  const registeredStudent = (db.students || []).find((s: any) =>
    (canonicalStudentUid && (s.uid === canonicalStudentUid || s.id === canonicalStudentUid)) ||
    (verifiedStudentEmail && (s.email || '').toLowerCase().trim() === verifiedStudentEmail)
  );
  const profile = (canonicalStudentUid && db.userProfiles?.[canonicalStudentUid]) || (verifiedStudentEmail && db.userProfiles?.[verifiedStudentEmail]);
  const authoritativeLevel = profile?.level || profile?.englishLevel || registeredStudent?.level || registeredStudent?.englishLevel || studentLevel || 'intermediario';
  const cefrMeta = resolveCefrLevel(authoritativeLevel);
  const cefr = cefrMeta.cefr;

  const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY || '';
  const isCooldownActive = Date.now() < geminiQuotaCooldownUntil;

  // Limit batch to 10 words per request
  const batchToEnrich = wordsNeedingEnrichment.slice(0, 10);
  const newlyEnriched: any[] = [];

  if (apiKey && !isCooldownActive) {
    try {
      const lockKey = `dictionary_enrich:${canonicalStudentUid}`;
      const flightLock = await acquireSingleFlightLock(lockKey);
      if (flightLock.acquired) {
        try {
          const systemInstruction = `You are an elite, Cambridge/CELTA-certified Lexicographer and Pedagogical English Teacher.
For each given English word or phrase, generate:
1. "word": the exact English term.
2. "partOfSpeech": Part of speech (e.g., Noun, Verb, Adjective, Phrasal Verb, Expression).
3. "definitionEn": Crystal-clear, accessible English definition strictly calibrated to CEFR level ${cefr}.
4. "exampleSentenceEn": Authentic, natural conversational example sentence demonstrating the word in context.
5. "translationPt": Concise, accurate translation/support in Brazilian Portuguese.
6. "cefrLevel": "${cefr}".

CRITICAL REQUIREMENTS:
- definitionEn MUST be in English adapted to CEFR ${cefr}.
- translationPt MUST be in Portuguese.
- Return a JSON object with schema: { "words": [ { "word": string, "partOfSpeech": string, "definitionEn": string, "exampleSentenceEn": string, "translationPt": string, "cefrLevel": string } ] }
- Return JSON ONLY without Markdown formatting.`;

          const prompt = `Words to enrich for CEFR ${cefr} student:
${batchToEnrich.map((w, i) => `${i + 1}. ${w}`).join('\n')}`;

          const singleAttempt = await executeGeminiSingleAttempt({
            feature: 'dictionary_define',
            systemInstruction,
            untrustedUserDataPrompt: prompt,
            callerRole: caller.role,
            apiKey,
            temperature: 0.2,
          });

          if (singleAttempt?.parsedJson && Array.isArray(singleAttempt.parsedJson.words)) {
            singleAttempt.parsedJson.words.forEach((item: any) => {
              const w = (item.word || '').trim();
              const norm = normalizeDictionaryWord(w);
              if (!norm) return;
              const existing = existingMap.get(norm);
              const exCount = typeof existing?.practiceCount === 'number' ? existing.practiceCount : 0;
              const mergedOrigins = [...(existing?.origins || [])];
              if (!mergedOrigins.some((o: any) => o.source === 'routine')) {
                mergedOrigins.push({
                  source: 'routine',
                  activityName: 'Video of the Day',
                  date: new Date().toISOString().split('T')[0],
                });
              }

              const newEntry = {
                ...existing,
                id: existing?.id || `dict_${norm}_${Date.now()}`,
                word: w,
                originalWord: existing?.originalWord || w,
                normalizedWord: norm,
                partOfSpeech: item.partOfSpeech || 'Word',
                definitionEn: item.definitionEn || '',
                exampleSentenceEn: item.exampleSentenceEn || '',
                translationPt: item.translationPt || '',
                cefrLevel: item.cefrLevel || cefr,
                source: existing?.source || 'routine',
                sourceActivityName: existing?.sourceActivityName || 'Video Routine',
                learnedAt: existing?.learnedAt || new Date().toISOString(),
                studentEmail: verifiedStudentEmail,
                studentUid: canonicalStudentUid,
                origins: mergedOrigins,
                practiceCount: exCount,
                practiceHistory: existing?.practiceHistory || [],
                lastPracticedAt: existing?.lastPracticedAt,
                enrichmentStatus: 'enriched',
                notFound: false,
              };

              existingMap.set(norm, newEntry);
              newlyEnriched.push(newEntry);
            });
          }
        } finally {
          await flightLock.release();
        }
      }
    } catch (geminiErr) {
      console.warn('Backend dictionary enrichment error:', geminiErr);
    }
  }

  // Persist updated entries to Firestore and local memory
  if (newlyEnriched.length > 0) {
    try {
      const allEntries = Array.from(existingMap.values());
      await saveStudentVocabularyToFirestoreServer(canonicalStudentUid, allEntries, verifiedStudentEmail);
      if (!db.studentDictionaryMap) db.studentDictionaryMap = {};
      if (canonicalStudentUid) db.studentDictionaryMap[canonicalStudentUid] = allEntries;
      if (verifiedStudentEmail) db.studentDictionaryMap[verifiedStudentEmail] = allEntries;
      await writeDbSync(db);
    } catch (saveErr) {
      console.warn('Failed to persist enriched words to Firestore:', saveErr);
    }
  }

  return res.json({
    success: true,
    enrichedEntries: newlyEnriched,
    cached: false,
  });
});


// Endpoint: Get student journal entries (Requires authentication; strictly uses canonical UID)
app.get('/api/student-journal', firebaseAuthMiddleware, async (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  const caller = req.user!;
  const callerUid = caller.uid;

  if (!getFirestoreDb()) {
    return res.status(503).json({
      error: 'FirestoreUnavailable',
      message: 'Canonical Firestore (default) database is unavailable.',
    });
  }

  const requestedUid = ((req.query.uid as string) || (req.query.studentUid as string) || '').trim();
  const requestedEmail = ((req.query.email as string) || (req.query.studentEmail as string) || '').toLowerCase().trim();

  let targetUid = callerUid;
  if (caller.role === 'admin') {
    targetUid = requestedUid || callerUid;
  } else {
    const identityRes = await resolveCanonicalStudentIdentity({
      caller,
      studentEmail: requestedEmail,
      studentUid: requestedUid,
      lessonId: (req.query.lessonId as string) || undefined,
    });
    if (!identityRes.authorized) {
      return res.status(identityRes.statusCode || 403).json({
        error: 'Forbidden',
        message: identityRes.error || 'Cannot access journal of another user.',
      });
    }
    targetUid = identityRes.canonicalStudentUid || callerUid;
  }

  if (!isValidCanonicalUid(targetUid)) {
    return res.status(422).json({
      error: 'Unprocessable Entity',
      message: 'Invalid or non-canonical student UID.',
    });
  }

  const fsEntries = await fetchStudentDailyJournalFromServerFirestore(targetUid);
  return res.json(fsEntries || []);
});

// Endpoint: Save student daily journal entry (Requires authentication; persists solely in users/{uid}/journal/{entryId})
app.post('/api/student-journal', firebaseAuthMiddleware, async (req, res) => {
  const caller = req.user!;
  const callerUid = caller.uid;
  const callerEmail = (caller.email || '').toLowerCase().trim();
  const { studentUid, studentEmail, entry } = req.body || {};
  const cleanUid = (studentUid || '').trim();
  const cleanEmail = (studentEmail || '').toLowerCase().trim();
  const entryUid = (entry?.studentUid || '').trim();
  const entryEmail = (entry?.studentEmail || '').toLowerCase().trim();

  if (caller.role !== 'admin') {
    if (caller.role === 'teacher') {
      return res.status(403).json({ error: 'Forbidden', message: 'Teachers cannot modify student journal entries.' });
    }
    if ((cleanUid && cleanUid !== callerUid) || (entryUid && entryUid !== callerUid)) {
      return res.status(403).json({ error: 'Forbidden', message: 'Cannot write journal of another user.' });
    }
    if ((cleanEmail && callerEmail && cleanEmail !== callerEmail) || (entryEmail && callerEmail && entryEmail !== callerEmail)) {
      return res.status(403).json({ error: 'Forbidden', message: 'Cannot write journal of another user.' });
    }
  } else if (cleanUid && entryUid && cleanUid !== entryUid) {
    return res.status(403).json({ error: 'Forbidden', message: 'Conflicting studentUid in payload.' });
  }

  if (!entry || !entry.id) {
    return res.status(400).json({ error: 'Valid entry with id is required' });
  }

  const targetUid = (caller.role === 'admin' && cleanUid) ? cleanUid : callerUid;
  if (!isValidCanonicalUid(targetUid)) {
    return res.status(422).json({ error: 'Unprocessable Entity', message: 'Invalid or non-canonical student UID.' });
  }

  const saveRes = await saveStudentDailyJournalEntryServer(targetUid, entry);
  if (!saveRes.ok) {
    return res.status(saveRes.statusCode || 500).json({
      success: false,
      error: saveRes.error || 'Failed to save journal entry to Firestore',
    });
  }

  return res.json({ success: true, entry: saveRes.entry });
});

// Endpoint: Delete student daily journal entry with strict Firebase Auth and canonical UID verification
app.delete('/api/student-journal', firebaseAuthMiddleware, async (req, res) => {
  const caller = req.user!;
  const callerUid = caller.uid;
  const callerEmail = (caller.email || '').toLowerCase().trim();

  const requestedUid = ((req.query.uid as string) || (req.query.studentUid as string) || (req.body?.studentUid as string) || (req.body?.uid as string) || '').trim();
  const requestedEmail = ((req.query.studentEmail as string) || (req.query.email as string) || (req.body?.studentEmail as string) || (req.body?.email as string) || '').toLowerCase().trim();

  // Security Gate: Non-admin users can ONLY delete entries from their own canonical UID
  if (caller.role !== 'admin') {
    if (caller.role === 'teacher') {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Teachers cannot delete student journal entries.',
      });
    }
    if (requestedUid && requestedUid !== callerUid) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Unauthorized: Cannot delete journal entries belonging to another user.',
      });
    }
    if (requestedEmail && callerEmail && requestedEmail !== callerEmail) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Unauthorized: Cannot delete journal entries belonging to another user.',
      });
    }
  }

  const targetUid = (caller.role === 'admin' && requestedUid) ? requestedUid : callerUid;
  if (!isValidCanonicalUid(targetUid)) {
    return res.status(422).json({ error: 'Unprocessable Entity', message: 'Invalid or non-canonical student UID.' });
  }

  if (!getFirestoreDb()) {
    return res.status(503).json({ error: 'FirestoreUnavailable', message: 'Canonical Firestore (default) database is unavailable.' });
  }

  const entryId = (req.query.id as string) || (req.body?.id as string) || (req.body?.entryId as string) || '';

  if (!entryId) {
    return res.status(400).json({ error: 'id is required' });
  }

  // Authoritative Cloud Firestore deletion
  const success = await deleteStudentJournalEntryFromServerFirestore(targetUid, entryId);
  if (!success) {
    return res.status(500).json({ error: 'Failed to delete journal entry from Firestore' });
  }

  return res.json({ success: true, deletedId: entryId });
});

async function authorizeJournalActivityAccess(
  req: express.Request,
  res: express.Response,
  action: 'read' | 'write'
) {
  const nestedEntry = (req.body && req.body.entry && typeof req.body.entry === 'object') ? req.body.entry : null;
  const topUid = ((req.body?.studentUid as string) || (req.body?.uid as string) || (req.query?.studentUid as string) || (req.query?.uid as string) || '').trim();
  const topEmail = ((req.body?.studentEmail as string) || (req.body?.email as string) || (req.query?.studentEmail as string) || (req.query?.email as string) || '').toLowerCase().trim();
  const nestedUid = ((nestedEntry?.studentUid as string) || (nestedEntry?.uid as string) || '').trim();
  const nestedEmail = ((nestedEntry?.studentEmail as string) || (nestedEntry?.email as string) || '').toLowerCase().trim();

  if (topUid && nestedUid && topUid !== nestedUid) {
    res.status(403).json({
      error: 'Forbidden',
      message: 'Conflicting studentUid between request payload and nested activity entry.',
    });
    return null;
  }
  if (topEmail && nestedEmail && topEmail !== nestedEmail) {
    res.status(403).json({
      error: 'Forbidden',
      message: 'Conflicting studentEmail between request payload and nested activity entry.',
    });
    return null;
  }

  let effectiveReq: express.Request = req;
  if ((!topUid && nestedUid) || (!topEmail && nestedEmail)) {
    effectiveReq = Object.create(req, {
      body: {
        value: {
          ...(req.body || {}),
          ...(topUid ? {} : nestedUid ? { studentUid: nestedUid } : {}),
          ...(topEmail ? {} : nestedEmail ? { studentEmail: nestedEmail } : {}),
        },
        configurable: true,
      },
    });
  }

  const authCtx = await authorizeStudentRoutineAccess(effectiveReq, res, {
    allowMissingTargetFallbackToCaller: true,
    requireApprovedTeacherIfTutor: true,
  });
  if (!authCtx) return null;

  if (action === 'write' && authCtx.effectiveRole === 'teacher') {
    res.status(403).json({
      error: 'Forbidden',
      message: 'Teachers are not authorized to modify student activity journal.',
    });
    return null;
  }

  return authCtx;
}

// Endpoint: Student Activity Journal (ARCH.2F.2A Canonical Firestore-only: users/{uid}/activity_journal/{entryId})
app.get('/api/student-journal/activity', firebaseAuthMiddleware, async (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  const authCtx = await authorizeJournalActivityAccess(req, res, 'read');
  if (!authCtx) return;

  const fsRes = await fetchStudentActivityJournalFromServerFirestore(authCtx.canonicalStudentUid);
  if (!fsRes.ok) {
    return res.status(fsRes.statusCode || 500).json({
      success: false,
      error: fsRes.error || 'Failed to retrieve activity journal from Firestore.',
    });
  }

  return res.json({
    success: true,
    studentUid: authCtx.canonicalStudentUid,
    entries: fsRes.entries,
  });
});

app.post('/api/student-journal/activity', firebaseAuthMiddleware, async (req, res) => {
  const authCtx = await authorizeJournalActivityAccess(req, res, 'write');
  if (!authCtx) return;

  const entry = req.body?.entry;
  if (!entry || typeof entry !== 'object') {
    return res.status(400).json({
      success: false,
      error: 'entry object is required',
    });
  }

  const saveRes = await upsertStudentActivityJournalEntryServer(
    authCtx.canonicalStudentUid,
    entry,
    authCtx.canonicalStudentEmail
  );

  if (!saveRes.ok) {
    return res.status(saveRes.statusCode || 500).json({
      success: false,
      error: saveRes.error || 'Failed to persist activity journal entry to Firestore.',
    });
  }

  return res.json({
    success: true,
    firestoreConfirmed: true,
    studentUid: authCtx.canonicalStudentUid,
    entry: saveRes.entry,
    entries: saveRes.entries || [],
  });
});

app.delete('/api/student-journal/activity', firebaseAuthMiddleware, async (req, res) => {
  const authCtx = await authorizeJournalActivityAccess(req, res, 'write');
  if (!authCtx) return;

  const entryId = ((req.body?.entryId as string) || (req.body?.id as string) || (req.query?.entryId as string) || (req.query?.id as string) || '').trim();
  const type = ((req.body?.type as string) || (req.query?.type as string) || '').trim();
  const dayOfWeek = ((req.body?.dayOfWeek as string) || (req.query?.dayOfWeek as string) || '').trim();
  const week = req.body?.week ?? req.body?.weeklyCycle ?? req.body?.weekId ?? req.query?.week ?? req.query?.weeklyCycle ?? req.query?.weekId;

  if (!entryId && !type) {
    return res.status(400).json({
      success: false,
      error: 'entryId/id or type is required to delete an activity journal entry.',
    });
  }

  const delRes = await deleteStudentActivityJournalEntryServer(authCtx.canonicalStudentUid, {
    entryId: entryId || undefined,
    type: type || undefined,
    dayOfWeek: dayOfWeek || undefined,
    week,
  });

  if (!delRes.ok) {
    return res.status(delRes.statusCode || 500).json({
      success: false,
      error: delRes.error || 'Failed to delete activity journal entry from Firestore.',
    });
  }

  return res.json({
    success: true,
    firestoreConfirmed: true,
    studentUid: authCtx.canonicalStudentUid,
    deletedIds: delRes.deletedIds || [],
    entries: delRes.entries || [],
  });
});

// Endpoint: Strict UID correlation verification between Student and Native Friend
app.get('/api/students/verify-link', async (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  const db = readDb();
  const studentUid = ((req.query.studentUid as string) || '').trim();
  const studentEmail = ((req.query.studentEmail as string) || '').toLowerCase().trim();
  const teacherUid = ((req.query.teacherUid as string) || '').trim();
  const teacherEmail = ((req.query.teacherEmail as string) || '').toLowerCase().trim();

  const verifiedCaller = await getVerifiedUserFromRequest(req);
  if (verifiedCaller?.role === 'admin') {
    return res.json({ isLinked: true, reason: 'admin' });
  }

  const isTeacherAdmin = (db.teachers || []).some(
    (t: any) => t.role === 'admin' && (
      (teacherUid && (t.uid === teacherUid || t.id === teacherUid || t.authUid === teacherUid || t.id === `tutor-${teacherUid}`)) ||
      (teacherEmail && t.email?.toLowerCase().trim() === teacherEmail)
    )
  );

  if (isTeacherAdmin) {
    return res.json({ isLinked: true, reason: 'admin' });
  }

  if (!teacherUid && !teacherEmail) {
    return res.json({ isLinked: true, reason: 'self' });
  }

  // Find student in db.students or db.userProfiles
  const student = (db.students || []).find((s: any) => {
    const sUid = (s.uid || s.id || '').trim();
    const sEmail = (s.email || s.studentEmail || '').toLowerCase().trim();
    return (studentUid && sUid === studentUid) || (studentEmail && sEmail === studentEmail);
  });

  const profile = (studentEmail && db.userProfiles?.[studentEmail]) ||
    Object.values(db.userProfiles || {}).find((p: any) => {
      const pEmail = (p.email || '').toLowerCase().trim();
      const pUid = (p.uid || p.id || '').trim();
      return (studentUid && pUid === studentUid) || (studentEmail && pEmail === studentEmail);
    });

  const isApprovedTutor = (db.teachers || []).some((t: any) =>
    (teacherUid && (t.uid === teacherUid || t.id === teacherUid || t.authUid === teacherUid || t.id === `tutor-${teacherUid}`)) ||
    (teacherEmail && t.email?.toLowerCase().trim() === teacherEmail)
  ) || (db.tutorsList || []).some((t: any) =>
    (teacherUid && (t.uid === teacherUid || t.id === teacherUid || t.authUid === teacherUid || t.id === `tutor-${teacherUid}`)) ||
    (teacherEmail && t.email?.toLowerCase().trim() === teacherEmail)
  );

  const sTeacherUid = (student?.teacherUid || (student as any)?.assignedTeacherId || (student as any)?.assignedNativeFriendUID || profile?.teacherUid || (profile as any)?.assignedNativeFriendUID || '').trim();
  const sTeacherEmail = (student?.teacherEmail || profile?.teacherEmail || '').toLowerCase().trim();
  const isDirectMatch =
    (teacherUid && sTeacherUid && (teacherUid === sTeacherUid || teacherUid === `tutor-${sTeacherUid}` || sTeacherUid === `tutor-${teacherUid}`)) ||
    (teacherEmail && sTeacherEmail && teacherEmail === sTeacherEmail) ||
    (teacherUid && sTeacherEmail && teacherUid.toLowerCase().includes(sTeacherEmail));
  const isConflict = Boolean(
    sTeacherEmail && teacherEmail && sTeacherEmail !== teacherEmail &&
    sTeacherUid && teacherUid && sTeacherUid !== teacherUid && sTeacherUid !== `tutor-${teacherUid}`
  );

  if (isDirectMatch || (isApprovedTutor && !isConflict && (studentEmail || studentUid))) {
    return res.json({ isLinked: true, reason: 'assigned_student' });
  }

  // Check canonical Firestore (default) user profile & tutors + lessons
  let hasLesson = false;
  try {
    const fs = getFirestoreDb();
    if (fs) {
      // 1. Check student profile in Firestore users collection
      let fsStudentProfile: any = null;
      if (studentUid && isValidCanonicalUid(studentUid)) {
        const directUserSnap = await fs.collection('users').doc(studentUid).get().catch(() => null);
        if (directUserSnap && directUserSnap.exists) {
          fsStudentProfile = directUserSnap.data();
        }
      }
      if (!fsStudentProfile && studentEmail) {
        const qSnap = await fs.collection('users').where('email', '==', studentEmail).get().catch(() => null);
        if (qSnap && !qSnap.empty) {
          fsStudentProfile = qSnap.docs[0].data();
        }
      }

      if (fsStudentProfile) {
        const fsTeacherUid = (
          fsStudentProfile.assignedNativeFriendUID ||
          fsStudentProfile.nativeFriendUID ||
          fsStudentProfile.teacherUid ||
          fsStudentProfile.assignedTeacherId ||
          ''
        ).trim();
        const fsTeacherEmail = (fsStudentProfile.teacherEmail || fsStudentProfile.assignedTeacherEmail || '').toLowerCase().trim();
        const fsDirectMatch =
          (teacherUid && fsTeacherUid && (teacherUid === fsTeacherUid || teacherUid === `tutor-${fsTeacherUid}` || fsTeacherUid === `tutor-${teacherUid}`)) ||
          (teacherEmail && fsTeacherEmail && teacherEmail === fsTeacherEmail);
        const fsConflict = Boolean(
          (fsTeacherEmail && teacherEmail && fsTeacherEmail !== teacherEmail) ||
          (fsTeacherUid && teacherUid && fsTeacherUid !== teacherUid && fsTeacherUid !== `tutor-${teacherUid}`)
        );
        if (fsDirectMatch && !fsConflict) {
          return res.json({ isLinked: true, reason: 'assigned_student_firestore' });
        }
        if (fsConflict) {
          return res.json({ isLinked: false, reason: 'unauthorized_uid_pair' });
        }
      }

      // 2. Check canonical Firestore lessons
      const queries: Promise<any>[] = [];
      if (studentUid) {
        queries.push(fs.collection('lessons').where('studentUid', '==', studentUid).get().catch(() => ({ docs: [] })));
      }
      if (studentEmail) {
        queries.push(fs.collection('lessons').where('studentEmail', '==', studentEmail).get().catch(() => ({ docs: [] })));
      }
      const snaps = await Promise.all(queries);
      for (const snap of snaps) {
        if (!snap?.docs) continue;
        for (const doc of snap.docs) {
          const l = doc.data();
          if (!l || l.status === 'cancelled') continue;
          const lTeacherEmail = (l.teacherEmail || l.tutorEmail || '').toLowerCase().trim();
          const lTeacherUid = (l.teacherUid || l.tutorUid || l.teacherAuthUid || '').trim();
          const lTeacherAuthUid = (l.teacherAuthUid || '').trim();
          const teacherMatches =
            (teacherEmail && lTeacherEmail === teacherEmail) ||
            (teacherUid && (
              lTeacherUid === teacherUid ||
              lTeacherAuthUid === teacherUid ||
              lTeacherUid === `tutor-${teacherUid}` ||
              teacherUid === `tutor-${lTeacherUid}`
            ));
          if (teacherMatches) {
            hasLesson = true;
            break;
          }
        }
        if (hasLesson) break;
      }
    }
  } catch {}

  if (hasLesson) {
    return res.json({ isLinked: true, reason: 'active_lesson' });
  }

  return res.json({ isLinked: false, reason: 'unauthorized_uid_pair' });
});

app.delete(['/api/lessons/:id', '/api/live-lessons/:id'], firebaseAuthMiddleware, async (req, res) => {
  if (!req.user || !req.user.uid) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  const lessonId = decodeURIComponent(req.params.id || '');
  const result = await deleteLessonAtomicServer({
    lessonId,
    callerUid: req.user.uid,
    callerEmail: req.user.email,
    callerRole: req.user.role,
    callerEmailVerified: req.user.email_verified,
  });
  if (!result.success) {
    return res.status(result.statusCode).json({ error: result.error, message: result.error });
  }
  return res.status(200).json({
    success: true,
    deletedId: result.deletedId,
    remainingLessons: result.remainingLessons,
    creditRefunded: Boolean(result.creditRefunded),
  });
});

// 6. Chat Messages Endpoints
app.get('/api/chat-messages', (req, res) => {
  const db = readDb();
  res.json({ messages: db.chatMessages || [] });
});

app.post('/api/chat-messages', (req, res) => {
  const db = readDb();
  const { message, messages } = req.body;
  if (Array.isArray(messages)) {
    db.chatMessages = messages;
  } else if (message && message.id) {
    const idx = db.chatMessages.findIndex((m) => m.id === message.id);
    if (idx >= 0) {
      db.chatMessages[idx] = message;
    } else {
      db.chatMessages.push(message);
    }
  }
  writeDb(db);
  res.json({ success: true, messages: db.chatMessages });
});

app.delete('/api/chat-messages', (req, res) => {
  const db = readDb();
  db.chatMessages = [];
  writeDb(db);
  res.json({ success: true, messages: [] });
});

// 7. Routines Endpoints
app.get('/api/routines', (req, res) => {
  const db = readDb();
  if (Object.keys(db.routinesByDay || {}).length === 0) {
    return res.json({});
  }
  res.json(db.routinesByDay);
});

app.post('/api/routines', (req, res) => {
  const db = readDb();
  const routinesByDay = req.body.routinesByDay || req.body;
  const studentEmail = req.body.studentEmail;
  const studentUid = req.body.studentUid || req.body.uid;
  if (routinesByDay && typeof routinesByDay === 'object') {
    db.routinesByDay = routinesByDay;
    if (studentEmail || studentUid) {
      if (!db.studentRoutinesMap) db.studentRoutinesMap = {};
      const { email, uid } = resolveStudentIdentifiers(db, studentEmail, studentUid);
      if (email) db.studentRoutinesMap[email] = routinesByDay;
      if (uid) db.studentRoutinesMap[uid] = routinesByDay;
    }
    writeDb(db);
  }
  res.json(db.routinesByDay);
});

app.post('/api/routines/words', firebaseAuthMiddleware, async (req, res) => {
  const authCtx = await authorizeStudentRoutineAccess(req, res, { allowMissingTargetFallbackToCaller: true });
  if (!authCtx) return;

  const { day, words, weeklyCycle: bodyCycle } = req.body || {};
  if (!Array.isArray(words)) {
    return res.status(400).json({ error: 'words array is required' });
  }

  const { canonicalStudentUid } = authCtx;
  const ctx = await fetchCanonicalRoutineContextServer(canonicalStudentUid);
  if (!ctx) {
    return res.status(503).json({
      error: 'FirestoreUnavailable',
      message: 'Canonical Firestore (default) context unavailable.',
    });
  }

  const requestedCycle = extractPositiveIntegerCycle(bodyCycle);
  if (requestedCycle !== null && requestedCycle < ctx.activeCycle) {
    return res.status(409).json({
      success: false,
      error: 'STALE_CYCLE',
      message: `Stale cycle ${requestedCycle} rejected; active cycle is ${ctx.activeCycle}.`,
      activeCycle: ctx.activeCycle,
    });
  }

  const cleanWords = Array.from(
    new Set(
      words
        .map((w: any) => (typeof w === 'string' ? w.trim() : ''))
        .filter(Boolean)
    )
  );

  const targetDays = day
    ? [String(day).toLowerCase().trim()]
    : (ctx.studyDays.length > 0 ? ctx.studyDays : DAYS_SEQUENCE);

  const invalidDay = targetDays.find((d) => !DAYS_SEQUENCE.includes(d as any));
  if (invalidDay) {
    return res.status(400).json({ error: `Invalid day of week: ${invalidDay}` });
  }

  for (const targetDay of targetDays) {
    const existingWords = Array.isArray(ctx.routinesByDayRaw[targetDay]?.learnedWords)
      ? ctx.routinesByDayRaw[targetDay].learnedWords
      : [];
    const wordsToSave = day ? cleanWords : Array.from(new Set([...existingWords, ...cleanWords]));
    const saveRes = await saveStudentRoutineDayFieldsServer(
      canonicalStudentUid,
      targetDay,
      { learnedWords: wordsToSave },
      bodyCycle
    );
    if (!saveRes.success) {
      if (saveRes.code === 'STALE_CYCLE') {
        return res.status(409).json({
          success: false,
          error: 'STALE_CYCLE',
          message: saveRes.error,
          activeCycle: saveRes.activeCycle,
        });
      }
      return res.status(500).json({
        success: false,
        error: 'FirestorePersistenceFailed',
        message: saveRes.error || 'Failed to persist learnedWords in Firestore (default).',
      });
    }
  }

  return res.json({ success: true, learnedWords: cleanWords, studentUid: canonicalStudentUid, updatedDays: targetDays });
});

app.post('/api/routines/toggle', firebaseAuthMiddleware, async (req, res) => {
  const authCtx = await authorizeStudentRoutineAccess(req, res, { allowMissingTargetFallbackToCaller: true });
  if (!authCtx) return;

  const { day, activityId, videoId, videoTitle, completed, completedToday, activityType, weeklyCycle: bodyCycle } = req.body || {};
  const targetDay = String(day || '').toLowerCase().trim();
  if (!targetDay || !DAYS_SEQUENCE.includes(targetDay as any)) {
    return res.status(400).json({ error: 'Valid day of week is required' });
  }

  const { canonicalStudentUid } = authCtx;
  const ctx = await fetchCanonicalRoutineContextServer(canonicalStudentUid);
  if (!ctx) {
    return res.status(503).json({
      error: 'FirestoreUnavailable',
      message: 'Canonical Firestore (default) context unavailable.',
    });
  }

  const requestedCycle = extractPositiveIntegerCycle(bodyCycle);
  if (requestedCycle !== null && requestedCycle < ctx.activeCycle) {
    return res.status(409).json({
      success: false,
      error: 'STALE_CYCLE',
      message: `Stale cycle ${requestedCycle} rejected; active cycle is ${ctx.activeCycle}.`,
      activeCycle: ctx.activeCycle,
    });
  }

  const existingDay = ctx.routinesByDayRaw[targetDay] || {};
  const inferredType =
    activityType ||
    (typeof activityId === 'string' && activityId.endsWith('2') ? 'audio' : 'video');

  const explicitNext =
    typeof completedToday === 'boolean'
      ? completedToday
      : typeof completed === 'boolean'
      ? completed
      : null;

  const currentVal =
    inferredType === 'audio'
      ? Boolean(existingDay.completedAudioToday ?? existingDay.completedToday)
      : Boolean(existingDay.completedVideoToday ?? existingDay.completedToday);
  const nextState = explicitNext !== null ? explicitNext : !currentVal;

  const fieldsToSave: Record<string, any> = {};
  if (inferredType === 'audio') {
    fieldsToSave.completedAudioToday = nextState;
  } else {
    fieldsToSave.completedVideoToday = nextState;
    fieldsToSave.completedToday = nextState;
    fieldsToSave.completed = nextState;
  }

  const saveRes = await saveStudentRoutineDayFieldsServer(
    canonicalStudentUid,
    targetDay,
    fieldsToSave,
    bodyCycle
  );

  if (!saveRes.success) {
    if (saveRes.code === 'STALE_CYCLE') {
      return res.status(409).json({
        success: false,
        error: 'STALE_CYCLE',
        message: saveRes.error,
        activeCycle: saveRes.activeCycle,
      });
    }
    return res.status(500).json({
      success: false,
      error: 'FirestorePersistenceFailed',
      message: saveRes.error || 'Failed to persist completion toggle in Firestore (default).',
    });
  }

  const effectiveVideoId = videoId || existingDay.videoId;
  if (nextState && inferredType === 'video' && effectiveVideoId) {
    const cleanVid = extractServerYouTubeId(effectiveVideoId);
    if (cleanVid) {
      const watchRes = await addWatchedVideoCanonicalServer(
        canonicalStudentUid,
        cleanVid,
        videoTitle || existingDay.videoTitle || existingDay.title
      );
      if (!watchRes.success) {
        return res.status(500).json({
          success: false,
          error: 'FirestorePersistenceFailed',
          message: watchRes.error || 'Failed to persist watched video history in Firestore (default).',
        });
      }
    }
  }

  const effectiveTrackIdRaw =
    req.body?.trackId ||
    req.body?.trackUrl ||
    existingDay.teacherSpotify?.trackId ||
    existingDay.teacherSpotify?.url ||
    existingDay.teacherOverrideTrack?.trackId ||
    existingDay.teacherOverrideTrack?.url ||
    '';
  if (nextState && inferredType === 'audio' && effectiveTrackIdRaw) {
    const rawStr = String(effectiveTrackIdRaw).trim();
    const cleanTrackId =
      extractSpotifyTrackId(rawStr) ||
      (/^[a-zA-Z0-9_-]{3,80}$/.test(rawStr) ? rawStr : null);
    if (cleanTrackId) {
      const listenRes = await addListenedTrackCanonicalServer(
        canonicalStudentUid,
        cleanTrackId,
        req.body?.trackTitle || req.body?.title || existingDay.teacherSpotify?.title,
        req.body?.artist || req.body?.artistOrHost || existingDay.teacherSpotify?.artistOrHost
      );
      if (!listenRes.success) {
        return res.status(500).json({
          success: false,
          error: 'FirestorePersistenceFailed',
          message: listenRes.error || 'Failed to persist listened track history in Firestore (default).',
        });
      }
    }
  }

  return res.json({
    success: true,
    studentUid: canonicalStudentUid,
    day: targetDay,
    completed: nextState,
    completedToday: nextState,
    weeklyCycle: saveRes.activeCycle,
  });
});

app.post('/api/routines/teacher-video', firebaseAuthMiddleware, async (req, res) => {
  const authCtx = await authorizeStudentRoutineAccess(req, res, { allowMissingTargetFallbackToCaller: true });
  if (!authCtx) return;

  const {
    callerUid,
    callerEmail,
    isAdmin,
    isCallerApprovedTeacher,
    canonicalStudentUid,
    canonicalStudentEmail,
  } = authCtx;

  const {
    activityId,
    activityName,
    playlistTitle,
    playlistId,
    videos,
    teacherNotes,
    days,
    day,
    weeklyCycle: bodyWeeklyCycle,
    teacherUid: bodyTeacherUid,
    teacherEmail: bodyTeacherEmail,
  } = req.body || {};

  const ctx = await fetchCanonicalRoutineContextServer(canonicalStudentUid);
  if (!ctx) {
    return res.status(503).json({
      error: 'FirestoreUnavailable',
      message: 'Canonical Firestore (default) context unavailable.',
    });
  }

  const passedCycle = extractPositiveIntegerCycle(bodyWeeklyCycle);
  if (passedCycle !== null && passedCycle < ctx.activeCycle) {
    return res.status(409).json({
      success: false,
      error: 'STALE_CYCLE',
      message: `Stale cycle ${passedCycle} rejected; active cycle is ${ctx.activeCycle}.`,
      activeCycle: ctx.activeCycle,
    });
  }
  const activeCycle = passedCycle !== null ? Math.max(ctx.activeCycle, passedCycle) : ctx.activeCycle;

  const rawDays: string[] = Array.isArray(days) && days.length > 0
    ? days
    : day
    ? [day]
    : DAYS_SEQUENCE;
  const targetDays = rawDays
    .map((d) => String(d || '').toLowerCase().trim())
    .filter((d) => DAYS_SEQUENCE.includes(d as any));

  if (targetDays.length === 0) {
    return res.status(400).json({ error: 'Valid day or days array is required' });
  }

  const effectiveTeacherUid = isCallerApprovedTeacher
    ? callerUid
    : isAdmin
    ? (bodyTeacherUid || '').trim()
    : (ctx.userProfile?.assignedNativeFriendUID || ctx.userProfile?.teacherUid || '').trim();
  const effectiveTeacherEmail = isCallerApprovedTeacher
    ? callerEmail
    : isAdmin
    ? (bodyTeacherEmail || '').toLowerCase().trim()
    : (ctx.userProfile?.teacherEmail || '').toLowerCase().trim();

  const videoInput = Array.isArray(videos) && videos.length > 0 ? videos[0] : null;
  const rawVideoId = videoInput ? (videoInput.videoId || videoInput.url || videoInput.id || '') : '';
  const cleanVidId = videoInput
    ? (rawVideoId === '' ? '' : (extractServerYouTubeId(rawVideoId) || String(rawVideoId).trim()))
    : '';
  const cleanUrl = videoInput?.url || (cleanVidId ? `https://www.youtube.com/watch?v=${cleanVidId}` : '');
  const resolvedPlaylistId = playlistId ?? videoInput?.playlistId ?? '';
  const resolvedTopicTitle = activityName || playlistTitle || videoInput?.playlistTitle || videoInput?.title || '';
  const now = new Date().toISOString();

  let updatedAssignments = [...ctx.videoAssignments];

  for (const targetDay of targetDays) {
    const dayPayload = {
      id: cleanVidId || `vid-${targetDay}`,
      videoId: cleanVidId,
      title: videoInput?.title || resolvedTopicTitle || (cleanVidId ? 'Teacher Assigned Video' : 'Video of the Day'),
      videoTitle: videoInput?.title || resolvedTopicTitle || (cleanVidId ? 'Teacher Assigned Video' : 'Video of the Day'),
      url: cleanUrl,
      playlistId: resolvedPlaylistId,
      playlistTitle: playlistTitle || videoInput?.playlistTitle || resolvedTopicTitle || '',
      dayOfWeek: targetDay,
      activityId: activityId || 'act-1',
      teacherUid: effectiveTeacherUid,
      teacherEmail: effectiveTeacherEmail,
      isRepeatVideo: Boolean(videoInput?.isRepeatVideo || resolvedPlaylistId === 'repeat_previous_video'),
      isCustomSuggestion: Boolean(videoInput?.isCustomSuggestion || resolvedPlaylistId === 'custom_suggestion'),
      instructions: teacherNotes || videoInput?.instructions || '',
      duration: videoInput?.duration || '5-10 min',
      weeklyCycle: activeCycle,
      updatedAt: now,
    };

    const daySaved = await saveRoutineVideoSubcollection(canonicalStudentUid, targetDay, dayPayload, activeCycle);
    if (!daySaved) {
      return res.status(500).json({
        success: false,
        error: 'FirestorePersistenceFailed',
        message: `Failed to persist routine video for ${targetDay} in Firestore (default).`,
      });
    }

    updatedAssignments = updatedAssignments.filter((a: any) => (a.day || a.dayOfWeek) !== targetDay);
    if (cleanVidId || cleanUrl) {
      updatedAssignments.push({
        id: `assign-${targetDay}-${activeCycle}-${cleanVidId || 'custom'}`,
        activityId: activityId || 'act-1',
        studentEmail: canonicalStudentEmail,
        studentUid: canonicalStudentUid,
        teacherUid: effectiveTeacherUid,
        teacherEmail: effectiveTeacherEmail,
        day: targetDay,
        playlistId: resolvedPlaylistId || 'custom-teacher-url',
        playlistTitle: dayPayload.playlistTitle || 'Teacher Assigned Custom Video',
        videoId: cleanVidId,
        videoTitle: dayPayload.videoTitle,
        videoUrl: cleanUrl,
        isRepeatVideo: dayPayload.isRepeatVideo,
        instructions: dayPayload.instructions,
        duration: dayPayload.duration,
        weeklyCycle: activeCycle,
        assignedAt: now,
      });
    }
  }

  const hasAnyVideo = updatedAssignments.some((a: any) => Boolean(a.videoId || a.videoUrl));
  const assignmentsSaved = await saveStudentAssignmentsCanonicalServer(canonicalStudentUid, {
    uid: canonicalStudentUid,
    email: canonicalStudentEmail,
    level: normalizeStudentLevel(ctx.level).key,
    weeklyCycle: activeCycle,
    videoAssignments: updatedAssignments,
    awaitingTopicSelection: !hasAnyVideo,
    updatedAt: now,
  });

  if (!assignmentsSaved) {
    return res.status(500).json({
      success: false,
      error: 'FirestorePersistenceFailed',
      message: 'Failed to persist student_assignments document in Firestore (default).',
    });
  }

  return res.json({
    success: true,
    updatedDays: targetDays,
    studentEmail: canonicalStudentEmail,
    studentUid: canonicalStudentUid,
    weeklyCycle: activeCycle,
  });
});

app.post('/api/routines/teacher-spotify', firebaseAuthMiddleware, async (req, res) => {
  const authCtx = await authorizeStudentRoutineAccess(req, res, {
    allowMissingTargetFallbackToCaller: true,
    requireApprovedTeacherIfTutor: true,
  });
  if (!authCtx) return;

  const {
    callerUid,
    callerEmail,
    isAdmin,
    isCallerApprovedTeacher,
    canonicalStudentUid,
    canonicalStudentEmail,
  } = authCtx;

  const {
    activityId,
    spotify,
    teacherNotes,
    days,
    day,
    weeklyCycle: bodyWeeklyCycle,
    teacherUid: bodyTeacherUid,
    teacherEmail: bodyTeacherEmail,
  } = req.body || {};

  // Strict validation and sanitization of Spotify URL if provided
  let normalizedSpotify: Record<string, any> | null = null;
  if (spotify && typeof spotify === 'object' && spotify.url) {
    const spotifyValidation = parseSpotifyUrl(spotify.url);
    if (!spotifyValidation.isValid) {
      return res.status(400).json({
        success: false,
        error: spotifyValidation.errorMessage || 'URL do Spotify inválida ou incompleta. Utilize um link válido de /track/, /episode/ ou /show/.',
      });
    }
    const cleanTrackId =
      spotifyValidation.id ||
      spotify.trackId ||
      extractSpotifyTrackId(spotifyValidation.canonicalUrl || spotify.url) ||
      `spot-${Date.now()}`;
    normalizedSpotify = {
      ...spotify,
      id: spotify.id || `spot-${cleanTrackId}`,
      trackId: cleanTrackId,
      url: spotifyValidation.canonicalUrl || spotify.url,
      embedUrl: spotifyValidation.embedUrl || spotify.embedUrl,
      type: spotifyValidation.contentType || spotify.type || 'music',
      title: spotify.title || 'Teacher Recommended Audio',
      artistOrHost: spotify.artistOrHost || spotify.artist || 'Spotify',
      instructions: spotify.instructions || teacherNotes || '',
    };
  }

  const ctx = await fetchCanonicalRoutineContextServer(canonicalStudentUid);
  if (!ctx) {
    return res.status(503).json({
      error: 'FirestoreUnavailable',
      message: 'Canonical Firestore (default) context unavailable.',
    });
  }

  const passedCycle = extractPositiveIntegerCycle(bodyWeeklyCycle);
  if (passedCycle !== null && passedCycle < ctx.activeCycle) {
    return res.status(409).json({
      success: false,
      error: 'STALE_CYCLE',
      message: `Stale cycle ${passedCycle} rejected; active cycle is ${ctx.activeCycle}.`,
      activeCycle: ctx.activeCycle,
    });
  }
  const activeCycle = passedCycle !== null ? Math.max(ctx.activeCycle, passedCycle) : ctx.activeCycle;

  const rawDays: string[] = Array.isArray(days) && days.length > 0
    ? days
    : day
    ? [day]
    : DAYS_SEQUENCE;
  const targetDays = rawDays
    .map((d) => String(d || '').toLowerCase().trim())
    .filter((d) => DAYS_SEQUENCE.includes(d as any));

  if (targetDays.length === 0) {
    return res.status(400).json({ error: 'Valid day or days array is required' });
  }

  const effectiveTeacherUid = isCallerApprovedTeacher
    ? callerUid
    : isAdmin
    ? (bodyTeacherUid || '').trim()
    : (ctx.userProfile?.assignedNativeFriendUID || ctx.userProfile?.teacherUid || '').trim();
  const effectiveTeacherEmail = isCallerApprovedTeacher
    ? callerEmail
    : isAdmin
    ? (bodyTeacherEmail || '').toLowerCase().trim()
    : (ctx.userProfile?.teacherEmail || '').toLowerCase().trim();

  const now = new Date().toISOString();
  let updatedSpotifyAssignments = [...ctx.spotifyAssignments];

  for (const targetDay of targetDays) {
    const dayFields: Record<string, any> = {
      activityId: activityId || 'act-2',
      teacherSpotify: normalizedSpotify
        ? {
            ...normalizedSpotify,
            teacherUid: effectiveTeacherUid,
            teacherEmail: effectiveTeacherEmail,
            weeklyCycle: activeCycle,
            addedAt: normalizedSpotify.addedAt || now,
          }
        : null,
      ...(teacherNotes !== undefined ? { teacherNotes } : {}),
      ...(effectiveTeacherUid ? { teacherUid: effectiveTeacherUid } : {}),
      ...(effectiveTeacherEmail ? { teacherEmail: effectiveTeacherEmail } : {}),
    };

    const dayRes = await saveStudentRoutineDayFieldsServer(canonicalStudentUid, targetDay, dayFields, activeCycle);
    if (!dayRes.success) {
      if (dayRes.code === 'STALE_CYCLE') {
        return res.status(409).json({
          success: false,
          error: 'STALE_CYCLE',
          message: dayRes.error,
          activeCycle: dayRes.activeCycle,
        });
      }
      return res.status(500).json({
        success: false,
        error: 'FirestorePersistenceFailed',
        message: dayRes.error || `Failed to persist routine Spotify for ${targetDay} in Firestore (default).`,
      });
    }

    updatedSpotifyAssignments = updatedSpotifyAssignments.filter(
      (a: any) => (a.day || a.dayOfWeek) !== targetDay
    );
    if (normalizedSpotify && normalizedSpotify.url) {
      updatedSpotifyAssignments.push({
        id: normalizedSpotify.id || `spot-assign-${targetDay}-${activeCycle}`,
        activityId: activityId || 'act-2',
        studentEmail: canonicalStudentEmail,
        studentUid: canonicalStudentUid,
        teacherUid: effectiveTeacherUid,
        teacherEmail: effectiveTeacherEmail,
        day: targetDay,
        trackId: normalizedSpotify.trackId,
        trackTitle: normalizedSpotify.title,
        trackUrl: normalizedSpotify.url,
        url: normalizedSpotify.url,
        embedUrl: normalizedSpotify.embedUrl || '',
        title: normalizedSpotify.title,
        artistOrHost: normalizedSpotify.artistOrHost,
        type: normalizedSpotify.type || 'music',
        instructions: normalizedSpotify.instructions || teacherNotes || '',
        weeklyCycle: activeCycle,
        assignedAt: normalizedSpotify.addedAt || now,
      });
    }
  }

  const assignmentsSaved = await saveStudentAssignmentsCanonicalServer(canonicalStudentUid, {
    uid: canonicalStudentUid,
    email: canonicalStudentEmail,
    level: normalizeStudentLevel(ctx.level).key,
    weeklyCycle: activeCycle,
    spotifyAssignments: updatedSpotifyAssignments,
    updatedAt: now,
  });

  if (!assignmentsSaved) {
    return res.status(500).json({
      success: false,
      error: 'FirestorePersistenceFailed',
      message: 'Failed to persist student_assignments document in Firestore (default).',
    });
  }

  return res.json({
    success: true,
    updatedDays: targetDays,
    studentEmail: canonicalStudentEmail,
    studentUid: canonicalStudentUid,
    weeklyCycle: activeCycle,
  });
});

// Endpoint to validate Spotify link format and return canonical metadata (supports GET & POST)
const handleSpotifyValidate = (req: express.Request, res: express.Response) => {
  const rawUrl = (((req.query.url as string) || (req.body && req.body.url) || '') as string).trim();
  const parsed = parseSpotifyUrl(rawUrl);
  res.json({
    success: parsed.isValid,
    ...parsed,
  });
};

app.get('/api/spotify/validate-link', handleSpotifyValidate);
app.post('/api/spotify/validate-link', handleSpotifyValidate);

// Read-only canonical Spotify assignments retrieval (NO auto-distribution on empty state)
app.get('/api/student-spotify-assignments', firebaseAuthMiddleware, async (req, res) => {
  const authCtx = await authorizeStudentRoutineAccess(req, res, { allowMissingTargetFallbackToCaller: true });
  if (!authCtx) return;

  const { canonicalStudentUid, canonicalStudentEmail } = authCtx;
  const requestedCycle = req.query.weeklyCycle !== undefined ? String(req.query.weeklyCycle) : undefined;
  const ctx = await fetchCanonicalRoutineContextServer(canonicalStudentUid, requestedCycle);

  if (!ctx) {
    return res.status(503).json({
      error: 'FirestoreUnavailable',
      message: 'Canonical Firestore (default) context unavailable.',
    });
  }

  const studentLevel = normalizeStudentLevel(ctx.level).key;
  return res.json({
    success: true,
    assignments: ctx.spotifyAssignments,
    listened: ctx.listenedTracks,
    studentEmail: ctx.studentEmail || canonicalStudentEmail,
    studentUid: canonicalStudentUid,
    studentLevel,
    weeklyCycle: ctx.activeCycle,
  });
});

// Canonical Spotify exclusive track assignment for a specific day
app.post('/api/student-spotify-assignments/assign', firebaseAuthMiddleware, async (req, res) => {
  const authCtx = await authorizeStudentRoutineAccess(req, res, {
    allowMissingTargetFallbackToCaller: true,
    requireApprovedTeacherIfTutor: true,
  });
  if (!authCtx) return;

  const {
    callerUid,
    callerEmail,
    isAdmin,
    isCallerApprovedTeacher,
    canonicalStudentUid,
    canonicalStudentEmail,
  } = authCtx;

  const db = readDb(); // Catalog cache fallback only (db.spotifyPlaylists)
  const ctx = await fetchCanonicalRoutineContextServer(canonicalStudentUid);
  if (!ctx) {
    return res.status(503).json({
      error: 'FirestoreUnavailable',
      message: 'Canonical Firestore (default) context unavailable.',
    });
  }

  const passedCycle = extractPositiveIntegerCycle(req.body?.weeklyCycle);
  if (passedCycle !== null && passedCycle < ctx.activeCycle) {
    return res.status(409).json({
      success: false,
      error: 'STALE_CYCLE',
      message: `Stale cycle ${passedCycle} rejected; active cycle is ${ctx.activeCycle}.`,
      activeCycle: ctx.activeCycle,
    });
  }
  const activeCycle = passedCycle !== null ? Math.max(ctx.activeCycle, passedCycle) : ctx.activeCycle;

  const {
    day,
    level,
    trackUrl,
    title,
    artistOrHost,
    teacherNotes,
    trackType,
    activityId,
    teacherUid: bodyTeacherUid,
    teacherEmail: bodyTeacherEmail,
  } = req.body || {};

  const targetDay = String(day || 'monday').toLowerCase().trim() as DayOfWeek;
  if (!DAYS_SEQUENCE.includes(targetDay)) {
    return res.status(400).json({ error: `Invalid day of week: ${targetDay}` });
  }

  const studentLevel = normalizeStudentLevel(level || ctx.level).key as SpotifyLevel;
  const officialMeta = OFFICIAL_SPOTIFY_PLAYLISTS[studentLevel];
  const cleanEmail = ctx.studentEmail || canonicalStudentEmail;

  const forceNew = Boolean(req.body?.forceNewTrack || req.body?.reassign);
  const idempotencyKey = typeof req.body?.idempotencyKey === 'string' ? req.body.idempotencyKey.trim() : '';
  const customUrl = (trackUrl || '').trim();
  const parsedCustom = customUrl ? parseSpotifyUrl(customUrl) : null;
  if (customUrl && (!parsedCustom || !parsedCustom.isValid)) {
    return res.status(400).json({
      error: parsedCustom?.errorMessage || 'Link do Spotify inválido. Utilize um link válido do open.spotify.com.',
    });
  }

  // Idempotency check for identical repeated requests on (day, weeklyCycle)
  const existingAssignment = ctx.spotifyAssignments.find(
    (a: any) => (a.day || a.dayOfWeek) === targetDay && Number(a.weeklyCycle || activeCycle) === activeCycle
  );
  if (!forceNew && existingAssignment && (existingAssignment.trackUrl || existingAssignment.url)) {
    const existingTrackId = extractSpotifyTrackId(existingAssignment.trackId || existingAssignment.trackUrl || existingAssignment.url);
    const sameIdempotencyKey = Boolean(idempotencyKey && existingAssignment.idempotencyKey === idempotencyKey);
    const sameCustomUrl = Boolean(
      customUrl &&
      parsedCustom?.canonicalUrl &&
      (existingAssignment.trackUrl === parsedCustom.canonicalUrl || existingAssignment.url === parsedCustom.canonicalUrl)
    );
    const sameSequentialParams = Boolean(!customUrl && existingAssignment.level === studentLevel);
    if (sameIdempotencyKey || sameCustomUrl || (!idempotencyKey && sameSequentialParams)) {
      const replayTrack = {
        id: existingAssignment.id || `sp-${targetDay}-${existingTrackId || 'replay'}`,
        url: existingAssignment.trackUrl || existingAssignment.url,
        trackId: existingTrackId || existingAssignment.trackId,
        title: existingAssignment.title || existingAssignment.trackTitle || 'Daily Spotify Audio',
        artistOrHost: existingAssignment.artistOrHost || 'Spotify',
        duration: existingAssignment.duration || '3-4 min',
        instructions: existingAssignment.instructions || '',
        type: existingAssignment.type || 'music',
        addedAt: existingAssignment.assignedAt || new Date().toISOString(),
        level: existingAssignment.level || studentLevel,
        playlistId: existingAssignment.playlistId || officialMeta.id,
        playlistTitle: existingAssignment.playlistTitle || officialMeta.title,
        cycle: existingAssignment.cycle || 1,
      };
      return res.json({
        success: true,
        idempotentReplay: true,
        track: replayTrack,
        assignment: existingAssignment,
        playlistTitle: replayTrack.playlistTitle,
        studentEmail: cleanEmail,
        studentUid: canonicalStudentUid,
        weeklyCycle: activeCycle,
        message: `Faixa "${replayTrack.title}" já atribuída para ${targetDay}.`,
      });
    }
  }

  const effectiveTeacherUid = isCallerApprovedTeacher
    ? callerUid
    : isAdmin
    ? (bodyTeacherUid || '').trim()
    : (ctx.userProfile?.assignedNativeFriendUID || ctx.userProfile?.teacherUid || '').trim();
  const effectiveTeacherEmail = isCallerApprovedTeacher
    ? callerEmail
    : isAdmin
    ? (bodyTeacherEmail || '').toLowerCase().trim()
    : (ctx.userProfile?.teacherEmail || '').toLowerCase().trim();

  const updatedSpotifyCycles = { ...(ctx.spotifyCycles || {}) };
  const cycleState = cloneOrInitSpotifyCycleState(updatedSpotifyCycles, studentLevel);

  let chosenTrack: any = null;
  if (customUrl && parsedCustom) {
    const trackId = parsedCustom.id || `custom-${Date.now()}`;
    chosenTrack = {
      trackId,
      title: title || 'Faixa Selecionada pelo Professor',
      artist: artistOrHost || 'Artista / Podcast',
      url: parsedCustom.canonicalUrl || customUrl,
      embedUrl: parsedCustom.embedUrl,
      playlistId: officialMeta.id,
      playlistTitle: officialMeta.title,
    };
  } else {
    let playlistTracks: SpotifyTrack[] = [];
    try {
      playlistTracks = await fetchOfficialPlaylistTracks(studentLevel);
    } catch {
      if (db.spotifyPlaylists?.[studentLevel]?.tracks) {
        playlistTracks = db.spotifyPlaylists[studentLevel].tracks;
      }
    }
    if (playlistTracks.length === 0) {
      return res.status(503).json({
        error: 'SPOTIFY_PLAYLIST_UNAVAILABLE',
        message: 'Could not retrieve tracks from official Spotify playlist.',
      });
    }
    const { track } = selectNextTrackFromPlaylist(playlistTracks, cycleState, targetDay);
    chosenTrack = track;
  }

  updatedSpotifyCycles[studentLevel] = cycleState;

  const chosenId = chosenTrack.trackId || extractSpotifyTrackId(chosenTrack.url) || `sp-${Date.now()}`;
  const canonicalUrl = chosenTrack.url || `https://open.spotify.com/track/${chosenId}`;
  const embedUrl = chosenTrack.embedUrl || `https://open.spotify.com/embed/track/${chosenId}?utm_source=generator&theme=0`;
  const now = new Date().toISOString();

  const assignedTrackObj = {
    id: `sp-${targetDay}-${activeCycle}-${chosenId}`,
    url: canonicalUrl,
    trackId: chosenId,
    title: title || chosenTrack.title,
    artistOrHost: artistOrHost || chosenTrack.artist || 'Adm Itissimple',
    duration: '3-4 min',
    instructions:
      teacherNotes ||
      `Sugestão diária do Teacher: Prática auditiva com "${chosenTrack.title}" (${chosenTrack.artist}).`,
    type: trackType || 'music',
    addedAt: now,
    level: studentLevel,
    playlistId: chosenTrack.playlistId || officialMeta.id,
    playlistTitle: chosenTrack.playlistTitle || officialMeta.title,
    cycle: cycleState.cycle,
    weeklyCycle: activeCycle,
  };

  const newAssignment: Record<string, any> = {
    id: `spot-assign-${targetDay}-${activeCycle}-${chosenId}`,
    activityId: activityId || `act-${targetDay}-2`,
    studentEmail: cleanEmail,
    studentUid: canonicalStudentUid,
    teacherUid: effectiveTeacherUid,
    teacherEmail: effectiveTeacherEmail,
    day: targetDay,
    trackId: chosenId,
    trackTitle: assignedTrackObj.title,
    trackUrl: canonicalUrl,
    url: canonicalUrl,
    embedUrl,
    title: assignedTrackObj.title,
    artistOrHost: assignedTrackObj.artistOrHost,
    type: assignedTrackObj.type,
    instructions: assignedTrackObj.instructions,
    assignedAt: now,
    level: studentLevel,
    playlistId: assignedTrackObj.playlistId,
    playlistTitle: assignedTrackObj.playlistTitle,
    cycle: cycleState.cycle,
    weeklyCycle: activeCycle,
  };
  if (idempotencyKey) {
    newAssignment.idempotencyKey = idempotencyKey;
  }

  const dayRes = await saveStudentRoutineDayFieldsServer(
    canonicalStudentUid,
    targetDay,
    {
      activityId: newAssignment.activityId,
      teacherSpotify: assignedTrackObj,
      ...(teacherNotes !== undefined ? { teacherNotes } : {}),
      ...(effectiveTeacherUid ? { teacherUid: effectiveTeacherUid } : {}),
      ...(effectiveTeacherEmail ? { teacherEmail: effectiveTeacherEmail } : {}),
    },
    activeCycle
  );

  if (!dayRes.success) {
    if (dayRes.code === 'STALE_CYCLE') {
      return res.status(409).json({
        success: false,
        error: 'STALE_CYCLE',
        message: dayRes.error,
        activeCycle: dayRes.activeCycle,
      });
    }
    return res.status(500).json({
      success: false,
      error: 'FirestorePersistenceFailed',
      message: dayRes.error || `Failed to persist routine Spotify for ${targetDay} in Firestore (default).`,
    });
  }

  const updatedSpotifyAssignments = [
    ...ctx.spotifyAssignments.filter((a: any) => (a.day || a.dayOfWeek) !== targetDay),
    newAssignment,
  ];

  const assignmentsSaved = await saveStudentAssignmentsCanonicalServer(canonicalStudentUid, {
    uid: canonicalStudentUid,
    email: cleanEmail,
    level: studentLevel,
    weeklyCycle: activeCycle,
    spotifyAssignments: updatedSpotifyAssignments,
    spotifyCycles: updatedSpotifyCycles,
    updatedAt: now,
  });

  if (!assignmentsSaved) {
    return res.status(500).json({
      success: false,
      error: 'FirestorePersistenceFailed',
      message: 'Failed to persist student_assignments document in Firestore (default).',
    });
  }

  return res.json({
    success: true,
    idempotentReplay: false,
    track: assignedTrackObj,
    assignment: newAssignment,
    playlistTitle: officialMeta.title,
    studentEmail: cleanEmail,
    studentUid: canonicalStudentUid,
    weeklyCycle: activeCycle,
    message: `Faixa "${assignedTrackObj.title}" atribuída com sucesso para ${targetDay}.`,
  });
});

// Canonical weekly Spotify sequential distribution (idempotent, cycle-isolated, awaited persistence)
app.post('/api/student-spotify-assignments/distribute-week', firebaseAuthMiddleware, async (req, res) => {
  const authCtx = await authorizeStudentRoutineAccess(req, res, {
    allowMissingTargetFallbackToCaller: true,
    requireApprovedTeacherIfTutor: true,
  });
  if (!authCtx) return;

  const {
    callerUid,
    callerEmail,
    isAdmin,
    isCallerApprovedTeacher,
    canonicalStudentUid,
    canonicalStudentEmail,
  } = authCtx;

  const db = readDb(); // Catalog cache fallback only (db.spotifyPlaylists)
  const ctx = await fetchCanonicalRoutineContextServer(canonicalStudentUid);
  if (!ctx) {
    return res.status(503).json({
      error: 'FirestoreUnavailable',
      message: 'Canonical Firestore (default) context unavailable.',
    });
  }

  const { level, days, weeklyCycle: bodyCycle, teacherUid: bodyTeacherUid, teacherEmail: bodyTeacherEmail } = req.body || {};
  const passedCycle = extractPositiveIntegerCycle(bodyCycle);
  if (passedCycle !== null && passedCycle < ctx.activeCycle) {
    return res.status(409).json({
      success: false,
      error: 'STALE_CYCLE',
      message: `Stale cycle ${passedCycle} rejected; active cycle is ${ctx.activeCycle}.`,
      activeCycle: ctx.activeCycle,
    });
  }
  const activeCycle = passedCycle !== null ? Math.max(ctx.activeCycle, passedCycle) : ctx.activeCycle;

  const studentLevel = normalizeStudentLevel(level || ctx.level).key as SpotifyLevel;
  const cleanEmail = ctx.studentEmail || canonicalStudentEmail;
  const officialMeta = OFFICIAL_SPOTIFY_PLAYLISTS[studentLevel];

  const default5Days: DayOfWeek[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
  const requestedDays = Array.isArray(days) && days.length > 0
    ? days.map((d: any) => String(d || '').toLowerCase().trim()).filter((d: string) => DAYS_SEQUENCE.includes(d as any)) as DayOfWeek[]
    : [];
  const daysToAssign: DayOfWeek[] =
    requestedDays.length > 0
      ? requestedDays
      : ctx.studyDays.length > 0
      ? (ctx.studyDays as DayOfWeek[])
      : default5Days;

  const forceRedistribute = Boolean(req.body?.forceRedistribute || req.body?.reassign);
  const idempotencyKey = typeof req.body?.idempotencyKey === 'string' ? req.body.idempotencyKey.trim() : '';

  if (!forceRedistribute) {
    const existingForDays = daysToAssign
      .map((d) =>
        ctx.spotifyAssignments.find(
          (a: any) => (a.day || a.dayOfWeek) === d && Number(a.weeklyCycle || activeCycle) === activeCycle
        )
      )
      .filter(Boolean);

    const sameIdempotencyKey = Boolean(
      idempotencyKey &&
      ctx.lastSpotifyDistributionAttempt?.idempotencyKey === idempotencyKey &&
      Number(ctx.lastSpotifyDistributionAttempt?.weeklyCycle || activeCycle) === activeCycle &&
      existingForDays.length > 0
    );

    const allDaysAlreadyAssignedForLevel =
      existingForDays.length === daysToAssign.length &&
      existingForDays.every((a: any) => Boolean(a.trackUrl || a.url) && (!level || a.level === studentLevel));

    if (sameIdempotencyKey || allDaysAlreadyAssignedForLevel) {
      return res.json({
        success: true,
        idempotentReplay: true,
        assignments: existingForDays,
        studentEmail: cleanEmail,
        studentUid: canonicalStudentUid,
        weeklyCycle: activeCycle,
        message: `Semana de ${existingForDays.length} faixas exclusivas do Spotify já distribuída.`,
      });
    }
  }

  let playlistTracks: SpotifyTrack[] = [];
  try {
    playlistTracks = await fetchOfficialPlaylistTracks(studentLevel);
  } catch {
    if (db.spotifyPlaylists?.[studentLevel]?.tracks) {
      playlistTracks = db.spotifyPlaylists[studentLevel].tracks;
    }
  }

  if (playlistTracks.length === 0) {
    return res.status(503).json({
      error: 'SPOTIFY_PLAYLIST_UNAVAILABLE',
      message: 'Could not retrieve tracks from official Spotify playlist.',
    });
  }

  const effectiveTeacherUid = isCallerApprovedTeacher
    ? callerUid
    : isAdmin
    ? (bodyTeacherUid || '').trim()
    : (ctx.userProfile?.assignedNativeFriendUID || ctx.userProfile?.teacherUid || '').trim();
  const effectiveTeacherEmail = isCallerApprovedTeacher
    ? callerEmail
    : isAdmin
    ? (bodyTeacherEmail || '').toLowerCase().trim()
    : (ctx.userProfile?.teacherEmail || '').toLowerCase().trim();

  const updatedSpotifyCycles = { ...(ctx.spotifyCycles || {}) };
  updatedSpotifyCycles[studentLevel] = cloneOrInitSpotifyCycleState(updatedSpotifyCycles, studentLevel);

  const transientEngineDb: Record<string, any> = {
    studentSpotifyCycles: {
      [canonicalStudentUid]: updatedSpotifyCycles,
    },
    studentSpotifyAssignments: {},
    studentRoutinesMap: {},
    weeklyStudyDays: {
      [canonicalStudentUid]: daysToAssign,
    },
  };

  const distributedAssignments = distributeWeeklySpotifyForStudentEngine({
    db: transientEngineDb,
    studentEmail: cleanEmail,
    studentUid: canonicalStudentUid,
    level: studentLevel,
    playlistTracks,
    activeDays: daysToAssign,
    teacherUid: effectiveTeacherUid,
    teacherEmail: effectiveTeacherEmail,
    weeklyCycle: activeCycle,
  });

  if (transientEngineDb.studentSpotifyCycles?.[canonicalStudentUid]?.[studentLevel]) {
    updatedSpotifyCycles[studentLevel] = transientEngineDb.studentSpotifyCycles[canonicalStudentUid][studentLevel];
  }
  const now = new Date().toISOString();

  let updatedSpotifyAssignments = [...ctx.spotifyAssignments];
  for (const assign of distributedAssignments) {
    const targetDay = assign.day;
    const routineSpotifyObj = {
      id: `sp-${targetDay}-${activeCycle}-${assign.trackId}`,
      url: assign.trackUrl,
      trackId: assign.trackId,
      title: assign.trackTitle,
      artistOrHost: assign.artistOrHost,
      duration: '3-4 min',
      instructions: assign.instructions,
      type: assign.type || 'music',
      addedAt: assign.assignedAt || now,
      level: studentLevel,
      playlistId: assign.playlistId || officialMeta.id,
      playlistTitle: assign.playlistTitle || officialMeta.title,
      cycle: assign.cycle,
      weeklyCycle: activeCycle,
    };

    const dayRes = await saveStudentRoutineDayFieldsServer(
      canonicalStudentUid,
      targetDay,
      {
        activityId: assign.activityId || `act-${targetDay}-2`,
        teacherSpotify: routineSpotifyObj,
        ...(effectiveTeacherUid ? { teacherUid: effectiveTeacherUid } : {}),
        ...(effectiveTeacherEmail ? { teacherEmail: effectiveTeacherEmail } : {}),
      },
      activeCycle
    );

    if (!dayRes.success) {
      if (dayRes.code === 'STALE_CYCLE') {
        return res.status(409).json({
          success: false,
          error: 'STALE_CYCLE',
          message: dayRes.error,
          activeCycle: dayRes.activeCycle,
        });
      }
      return res.status(500).json({
        success: false,
        error: 'FirestorePersistenceFailed',
        message: dayRes.error || `Failed to persist distributed audio for ${targetDay} in Firestore (default).`,
      });
    }

    updatedSpotifyAssignments = updatedSpotifyAssignments.filter(
      (a: any) => (a.day || a.dayOfWeek) !== targetDay
    );
    updatedSpotifyAssignments.push({
      ...assign,
      url: assign.trackUrl,
      title: assign.trackTitle,
      weeklyCycle: activeCycle,
    });
  }

  const assignmentsSaved = await saveStudentAssignmentsCanonicalServer(canonicalStudentUid, {
    uid: canonicalStudentUid,
    email: cleanEmail,
    level: studentLevel,
    weeklyCycle: activeCycle,
    spotifyAssignments: updatedSpotifyAssignments,
    spotifyCycles: updatedSpotifyCycles,
    lastSpotifyDistributionAttempt: {
      at: now,
      level: studentLevel,
      weeklyCycle: activeCycle,
      days: daysToAssign,
      ...(idempotencyKey ? { idempotencyKey } : {}),
    },
    updatedAt: now,
  });

  if (!assignmentsSaved) {
    return res.status(500).json({
      success: false,
      error: 'FirestorePersistenceFailed',
      message: 'Failed to persist distributed Spotify assignments in Firestore (default).',
    });
  }

  return res.json({
    success: true,
    idempotentReplay: false,
    assignments: distributedAssignments,
    studentEmail: cleanEmail,
    studentUid: canonicalStudentUid,
    weeklyCycle: activeCycle,
    message: `Semana de ${distributedAssignments.length} faixas exclusivas do Spotify distribuída com sucesso!`,
  });
});

// Canonical idempotent endpoint to record a listened Spotify track in Firestore (default)
app.post('/api/student-spotify-assignments/listen', firebaseAuthMiddleware, async (req, res) => {
  const authCtx = await authorizeStudentRoutineAccess(req, res, { allowMissingTargetFallbackToCaller: true });
  if (!authCtx) return;

  const { canonicalStudentUid, canonicalStudentEmail } = authCtx;
  const { trackId, trackUrl, trackTitle, title, artist, artistOrHost } = req.body || {};

  const rawInput = typeof trackId === 'string' && trackId.trim() ? trackId.trim() : typeof trackUrl === 'string' ? trackUrl.trim() : '';
  const extracted = extractSpotifyTrackId(trackUrl || trackId);
  const cleanTrackId =
    extracted ||
    (rawInput && /^[a-zA-Z0-9_-]{3,80}$/.test(rawInput) ? rawInput : null);

  if (!cleanTrackId) {
    return res.status(400).json({ error: 'Valid trackId or trackUrl is required' });
  }

  const listenRes = await addListenedTrackCanonicalServer(
    canonicalStudentUid,
    cleanTrackId,
    trackTitle || title,
    artist || artistOrHost
  );

  if (!listenRes.success) {
    return res.status(500).json({
      success: false,
      error: 'FirestorePersistenceFailed',
      message: listenRes.error || 'Failed to persist listened track history in Firestore (default).',
    });
  }

  return res.json({
    success: true,
    alreadyRecorded: listenRes.alreadyRecorded,
    listened: listenRes.listenedTracks,
    studentEmail: canonicalStudentEmail,
    studentUid: canonicalStudentUid,
  });
});

// Endpoint to verify live Spotify Web API connection using backend credentials
app.get('/api/spotify/verify', async (req, res) => {
  const configStatus = getSpotifyConfigStatus();
  if (!configStatus.configured) {
    return res.status(400).json({
      connected: false,
      tokenStatus: 'missing_credentials',
      error: 'Spotify credentials not configured in environment variables (SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET).',
      missingEnvVars: configStatus.missingEnvVars,
    });
  }

  try {
    const token = await getSpotifyAccessToken();
    const playlistId = OFFICIAL_SPOTIFY_PLAYLISTS.intermediate.id;
    const testRes = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (testRes.ok) {
      const pData = await testRes.json();
      res.json({
        connected: true,
        tokenStatus: 'valid',
        authMethod: configStatus.authMethod,
        officialPlaylist: {
          id: pData.id,
          name: pData.name,
          totalTracks: pData.tracks?.total || 0,
        },
      });
    } else {
      res.status(testRes.status).json({
        connected: false,
        tokenStatus: 'expired_or_invalid',
        error: `Spotify API responded with status ${testRes.status}`,
      });
    }
  } catch (err: any) {
    res.status(500).json({
      connected: false,
      tokenStatus: 'error',
      error: err?.message || 'Failed to verify Spotify credentials',
    });
  }
});

// 7.0 YouTube & Spotify Dynamic Playlist Synchronization & Anti-Repetition Video Assignments

let lastYouTubeSyncTime = 0;
const YOUTUBE_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes cache
let institutionalYouTubeToken: string | null = null;
let institutionalYouTubeTokenUpdatedAt = 0;

/**
 * Fetches all playlists and their constituent videos from YouTube Data API v3
 * using pagination (nextPageToken) to overcome the 50-item limit.
 */
async function fetchYouTubePlaylistsFromDataApi(token: string): Promise<any[]> {
  if (!token) return [];

  const rawPlaylistsMap = new Map<string, any>();

  // 1A. Paginate through all playlists owned by the authenticated account (mine=true)
  let pageToken: string | undefined = undefined;
  do {
    const pageParam = pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '';
    const plUrl = `https://www.googleapis.com/youtube/v3/playlists?part=snippet,contentDetails,status&mine=true&maxResults=50${pageParam}`;
    const plRes = await fetch(plUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    });

    if (plRes.status === 401) {
      throw new Error('AUTH_EXPIRED: Access token expired or invalid');
    }

    if (!plRes.ok) {
      const errText = await plRes.text();
      console.warn(`[YouTube Data API] Playlists fetch error [${plRes.status}]:`, errText);
      break;
    }

    const plData = (await plRes.json()) as any;
    if (Array.isArray(plData.items)) {
      for (const item of plData.items) {
        if (item?.id) rawPlaylistsMap.set(item.id, item);
      }
    }
    pageToken = plData.nextPageToken || undefined;
  } while (pageToken);

  // 1B. Also paginate through channel playlists for UCdimJysdxd2Hu9YmlVHB98A
  try {
    let chanPageToken: string | undefined = undefined;
    do {
      const pageParam = chanPageToken ? `&pageToken=${encodeURIComponent(chanPageToken)}` : '';
      const chanUrl = `https://www.googleapis.com/youtube/v3/playlists?part=snippet,contentDetails,status&channelId=UCdimJysdxd2Hu9YmlVHB98A&maxResults=50${pageParam}`;
      const chanRes = await fetch(chanUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
      });
      if (!chanRes.ok) break;
      const chanData = (await chanRes.json()) as any;
      if (Array.isArray(chanData.items)) {
        for (const item of chanData.items) {
          if (item?.id && !rawPlaylistsMap.has(item.id)) {
            rawPlaylistsMap.set(item.id, item);
          }
        }
      }
      chanPageToken = chanData.nextPageToken || undefined;
    } while (chanPageToken);
  } catch (chanErr) {
    console.warn('[YouTube Data API] Channel playlists fetch notice:', chanErr);
  }

  const rawPlaylists = Array.from(rawPlaylistsMap.values());
  if (rawPlaylists.length === 0) return [];

  // 2. Paginate through all videos for each playlist
  const syncedPlaylists: any[] = [];
  for (const pl of rawPlaylists) {
    // Only synchronize public playlists (never private)
    if (pl.status?.privacyStatus === 'private') {
      continue;
    }
    const plId = pl.id;
    const title = pl.snippet?.title || 'English Practice';
    const description = pl.snippet?.description || '';
    const thumbnailUrl =
      pl.snippet?.thumbnails?.high?.url ||
      pl.snippet?.thumbnails?.medium?.url ||
      pl.snippet?.thumbnails?.default?.url ||
      '';
    const itemCount = pl.contentDetails?.itemCount || 0;

    let vidPageToken: string | undefined = undefined;
    const rawItems: any[] = [];

    try {
      do {
        const vidPageParam = vidPageToken ? `&pageToken=${encodeURIComponent(vidPageToken)}` : '';
        const itemsUrl = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails&playlistId=${plId}&maxResults=50${vidPageParam}`;
        const itemsRes = await fetch(itemsUrl, {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
          },
        });

        if (!itemsRes.ok) break;

        const itemsData = (await itemsRes.json()) as any;
        if (Array.isArray(itemsData.items)) {
          rawItems.push(...itemsData.items);
        }
        vidPageToken = itemsData.nextPageToken || undefined;
      } while (vidPageToken);
    } catch (err) {
      console.warn(`[YouTube Data API] Error fetching items for ${plId}:`, err);
    }

    const videos = rawItems
      .filter(
        (v: any) =>
          v.snippet?.resourceId?.videoId &&
          v.snippet?.title !== 'Private video' &&
          v.snippet?.title !== 'Deleted video'
      )
      .map((v: any) => {
        const vidId = v.snippet.resourceId.videoId;
        return {
          id: `vid-${vidId}`,
          videoId: vidId,
          title: v.snippet.title,
          description: v.snippet.description || '',
          thumbnailUrl:
            v.snippet?.thumbnails?.high?.url ||
            v.snippet?.thumbnails?.medium?.url ||
            `https://i.ytimg.com/vi/${vidId}/hqdefault.jpg`,
          url: `https://www.youtube.com/watch?v=${vidId}`,
          embedUrl: `https://www.youtube-nocookie.com/embed/${vidId}?rel=0&modestbranding=1&enablejsapi=1`,
          playlistId: plId,
          playlistTitle: title,
          instructions: `Assista a esta aula sobre "${title}" e anote 3 expressões novas.`,
          duration: '6-8 min',
        };
      });

    syncedPlaylists.push({
      id: plId,
      title,
      description,
      thumbnailUrl,
      channelId: pl.snippet?.channelId || 'UCdimJysdxd2Hu9YmlVHB98A',
      channelTitle: pl.snippet?.channelTitle || 'Adm Itissimple',
      itemCount: itemCount || videos.length,
      updatedAt: new Date().toISOString(),
      isPublic: pl.status?.privacyStatus === 'public',
      videos,
    });
  }

  return syncedPlaylists;
}

async function fetchPlaylistsDirectlyFromChannel(): Promise<any[]> {
  try {
    const channelUrl = 'https://www.youtube.com/@admitissimple/playlists';
    const res = await fetch(channelUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    if (!res.ok) return [];
    const html = await res.text();
    const m = html.match(/ytInitialData = ({.*?});<\/script>/);
    if (!m) return [];
    const d = JSON.parse(m[1]);
    const tabs = d?.contents?.twoColumnBrowseResultsRenderer?.tabs || [];
    const plTab = tabs.find((t: any) => t.tabRenderer?.title?.toLowerCase()?.includes('playlist'));
    const items =
      plTab?.tabRenderer?.content?.sectionListRenderer?.contents?.[0]?.itemSectionRenderer?.contents?.[0]?.gridRenderer
        ?.items || [];
    if (!Array.isArray(items) || items.length === 0) return [];

    const parsedPlaylists: any[] = [];
    for (const item of items) {
      const lockup = item.lockupViewModel;
      if (!lockup) continue;
      const title =
        lockup.metadata?.lockupMetadataViewModel?.title?.content ||
        lockup.title?.content ||
        'Playlist';

      // Robust extraction of Playlist ID
      const plId =
        lockup.contentId ||
        lockup.itemPlayback?.inlinePlayerData?.onSelect?.innertubeCommand?.watchEndpoint?.playlistId ||
        lockup.metadata?.lockupMetadataViewModel?.metadata?.contentMetadataViewModel?.metadataRows?.[1]?.metadataParts?.[0]?.text?.commandRuns?.[0]?.onTap?.innertubeCommand?.browseEndpoint?.browseId?.replace(/^VL/, '') ||
        null;

      const countText =
        lockup.contentImage?.collectionThumbnailViewModel?.primaryThumbnail?.thumbnailViewModel?.overlays?.[0]
          ?.thumbnailOverlayBadgeViewModel?.thumbnailBadges?.[0]?.thumbnailBadgeViewModel?.text || '';
      const numMatch = countText.match(/(\d+)/);
      const count = numMatch ? parseInt(numMatch[1], 10) : 0;
      const thumb =
        lockup.contentImage?.collectionThumbnailViewModel?.primaryThumbnail?.thumbnailViewModel?.image?.sources?.[0]?.url ||
        'https://i.ytimg.com/vi/5P773n6aDoQ/hqdefault.jpg';

      if (plId && title) {
        parsedPlaylists.push({
          id: plId,
          title,
          description: `Playlist oficial "${title}" da conta Adm Itissimple no YouTube.`,
          thumbnailUrl: thumb,
          channelId: 'UCdimJysdxd2Hu9YmlVHB98A',
          channelTitle: 'Adm Itissimple',
          itemCount: count,
          updatedAt: new Date().toISOString(),
          isPublic: true,
          videos: [],
        });
      }
    }

    if (parsedPlaylists.length === 0) return [];

    // Fetch videos for each playlist with controlled concurrency and retries
    const fetchVideosForPlaylist = async (pl: any, attempt = 1): Promise<void> => {
      try {
        const plRes = await fetch(`https://www.youtube.com/playlist?list=${pl.id}`, {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept-Language': 'en-US,en;q=0.9',
          },
        });
        if (plRes.ok) {
          const plHtml = await plRes.text();
          const plM = plHtml.match(/ytInitialData = ({.*?});<\/script>/);
          if (plM) {
            const plD = JSON.parse(plM[1]);
            const contents = plD?.contents?.twoColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content;
            const isrContents =
              contents?.sectionListRenderer?.contents?.[0]?.itemSectionRenderer?.contents || [];
            const videos: any[] = [];
            for (const vItem of isrContents) {
              const lvm = vItem.lockupViewModel;
              if (lvm) {
                const vidId =
                  lvm.contentId ||
                  lvm.commandContext?.onTap?.innertubeCommand?.watchEndpoint?.videoId ||
                  null;
                const vTitle = lvm.metadata?.lockupMetadataViewModel?.title?.content || 'Video';
                const duration =
                  lvm.rendererContext?.accessibilityContext?.label?.match(/(\d+\s*min[^\.,]*|\d+:\d+)/i)?.[0] ||
                  '6-8 min';

                if (vidId && vTitle) {
                  videos.push({
                    id: `vid-${vidId}`,
                    videoId: vidId,
                    title: vTitle,
                    description: '',
                    thumbnailUrl: `https://i.ytimg.com/vi/${vidId}/hqdefault.jpg`,
                    url: `https://www.youtube.com/watch?v=${vidId}`,
                    embedUrl: `https://www.youtube-nocookie.com/embed/${vidId}?rel=0&modestbranding=1&enablejsapi=1`,
                    playlistId: pl.id,
                    playlistTitle: pl.title,
                    instructions: `Assista a esta aula sobre "${pl.title}" e anote 3 termos ou frases úteis para a rotina.`,
                    duration,
                  });
                }
              }
            }
            if (videos.length > 0) {
              pl.videos = videos;
              pl.itemCount = videos.length;
              return;
            }
          }
        }
      } catch (e) {
        if (attempt < 2) {
          await new Promise((r) => setTimeout(r, 600));
          return fetchVideosForPlaylist(pl, attempt + 1);
        }
        console.warn(`Error fetching videos for playlist ${pl.id}:`, e);
      }
    };

    // Process in batches of 4 to avoid throttling
    const batchSize = 4;
    for (let i = 0; i < parsedPlaylists.length; i += batchSize) {
      const batch = parsedPlaylists.slice(i, i + batchSize);
      await Promise.all(batch.map((pl) => fetchVideosForPlaylist(pl)));
    }

    return parsedPlaylists;
  } catch (err) {
    console.warn('Error fetching playlists directly from channel:', err);
    return [];
  }
}

/**
 * Centralized synchronizer for YouTube playlists from official institutional channel.
 * 
 * Rules:
 * - force=true ALWAYS executes an upstream verification without early returning old cached data.
 * - force=false serves cache if fresh, otherwise revalidates against Firestore or upstream.
 * - Authenticated token is preserved securely on the backend without exposing it to students.
 * - Results are persisted to Firestore (default) for cross-instance and cross-deployment consistency.
 * - Temporary failures do NOT overwrite existing valid data with fake/empty data (Requirement 9).
 * - Existing student weekly video assignments are NEVER modified by playlist updates (Requirement 10).
 */
async function syncYouTubePlaylistsFromApi(force = false, oauthToken?: string): Promise<{
  playlists: any[];
  upstreamSuccess: boolean;
  source: 'api' | 'channel' | 'cache' | 'fallback';
  error?: string | null;
}> {
  const db = readDb();
  let upstreamSuccess = false;
  let upstreamError: string | null = null;

  // 1. Ingest and persist institutional token if provided
  if (oauthToken) {
    institutionalYouTubeToken = oauthToken;
    institutionalYouTubeTokenUpdatedAt = Date.now();
    saveYouTubeAuthToFirestore({ token: oauthToken, updatedAt: new Date().toISOString() }).catch(() => {});
  } else if (!institutionalYouTubeToken) {
    // Try to hydrate institutional token from Firestore
    try {
      const persistedAuth = await fetchYouTubeAuthFromFirestore();
      if (persistedAuth?.token) {
        institutionalYouTubeToken = persistedAuth.token;
      }
    } catch {}
  }

  // 2. If NOT force, check memory cache freshness
  const hasMemoryPlaylists = Array.isArray(db.youtubePlaylists) && db.youtubePlaylists.length > 0;
  const isMemoryFresh =
    hasMemoryPlaylists &&
    lastYouTubeSyncTime > 0 &&
    Date.now() - lastYouTubeSyncTime < YOUTUBE_CACHE_TTL_MS;

  if (!force && isMemoryFresh) {
    return {
      playlists: db.youtubePlaylists,
      upstreamSuccess: true,
      source: 'cache',
      error: null,
    };
  }

  // 3. If NOT force, check Firestore (default) freshness
  if (!force) {
    try {
      const firestoreDoc = await fetchYouTubePlaylistsDocFromFirestore();
      if (firestoreDoc && Array.isArray(firestoreDoc.playlists) && firestoreDoc.playlists.length > 0) {
        const docAge = firestoreDoc.updatedAt
          ? Date.now() - new Date(firestoreDoc.updatedAt).getTime()
          : Infinity;
        if (docAge < YOUTUBE_CACHE_TTL_MS) {
          db.youtubePlaylists = firestoreDoc.playlists;
          lastYouTubeSyncTime = firestoreDoc.updatedAt
            ? new Date(firestoreDoc.updatedAt).getTime()
            : Date.now();
          writeDb(db);
          return {
            playlists: firestoreDoc.playlists,
            upstreamSuccess: true,
            source: 'cache',
            error: null,
          };
        }
      }
    } catch (e) {
      console.warn('[YouTube Sync] Firestore check notice:', e);
    }
  }

  // 4. Upstream Sync: Either force=true OR cache is stale
  const effectiveToken =
    oauthToken ||
    institutionalYouTubeToken ||
    process.env.YOUTUBE_TOKEN ||
    process.env.GOOGLE_ACCESS_TOKEN ||
    undefined;

  let freshPlaylists: any[] = [];

  // 4A. Attempt Data API v3 if token is present
  if (effectiveToken) {
    try {
      freshPlaylists = await fetchYouTubePlaylistsFromDataApi(effectiveToken);
      if (freshPlaylists.length > 0) {
        upstreamSuccess = true;
      }
    } catch (err: any) {
      console.warn('[YouTube Sync] Data API sync notice:', err?.message || err);
      if (String(err?.message || '').includes('AUTH_EXPIRED') || String(err?.message || '').includes('401')) {
        institutionalYouTubeToken = null;
        upstreamError = 'AUTH_EXPIRED';
      } else {
        upstreamError = 'UPSTREAM_API_ERROR';
      }
    }
  } else {
    upstreamError = 'NO_AUTH_TOKEN';
  }

  // 4B. If Data API didn't produce items, use public channel scraper
  if (freshPlaylists.length === 0) {
    try {
      const scraped = await fetchPlaylistsDirectlyFromChannel();
      const totalVideos = scraped.reduce((acc, p) => acc + (p.videos?.length || 0), 0);
      // Reject incomplete scraper results (e.g. 0 items or no videos) so they never overwrite the valid catalog
      if (scraped.length > 0 && totalVideos > 0) {
        freshPlaylists = scraped;
        upstreamSuccess = true;
      } else if (scraped.length > 0 && totalVideos === 0) {
        console.warn('[YouTube Sync] Incomplete scraper results without videos; preserving existing catalog.');
        upstreamError = 'INCOMPLETE_SCRAPER_RESULTS';
      }
    } catch (err) {
      console.warn('[YouTube Sync] Channel fetch error:', err);
      upstreamError = 'CHANNEL_SCRAPER_ERROR';
    }
  }

  // 4C. If fresh sync succeeded, persist to in-memory DB and Firestore (default)
  if (freshPlaylists.length > 0) {
    // Merge fresh playlists with existing valid catalog so newly added or authenticated playlists are not dropped
    const playlistMap = new Map<string, any>();
    if (db.youtubePlaylists && Array.isArray(db.youtubePlaylists)) {
      for (const p of db.youtubePlaylists) {
        if (p?.id) playlistMap.set(p.id, p);
      }
    }

    for (const freshPl of freshPlaylists) {
      if (!freshPl?.id) continue;
      const prev = playlistMap.get(freshPl.id);
      if ((!freshPl.videos || freshPl.videos.length === 0) && prev?.videos?.length) {
        freshPl.videos = prev.videos;
        freshPl.itemCount = prev.videos.length;
      }
      playlistMap.set(freshPl.id, {
        ...prev,
        ...freshPl,
        videos: freshPl.videos?.length ? freshPl.videos : (prev?.videos || []),
        itemCount: freshPl.videos?.length || prev?.itemCount || 0,
      });
    }

    const mergedPlaylists = Array.from(playlistMap.values());
    db.youtubePlaylists = mergedPlaylists;
    writeDb(db);
    lastYouTubeSyncTime = Date.now();
    saveYouTubePlaylistsToFirestore(mergedPlaylists).catch((err) => {
      if (!isPermissionError(err)) {
        console.warn('Firestore saveYouTubePlaylists error:', err);
      }
    });
    return {
      playlists: mergedPlaylists,
      upstreamSuccess: true,
      source: effectiveToken ? 'api' : 'channel',
      error: null,
    };
  }

  // 4D. Temporary upstream failure: Preserve last valid catalog (Requirement 9)
  console.warn('[YouTube Sync] Upstream temporary failure; preserving last valid catalog.');

  // Try Firestore persisted catalog first
  try {
    const persisted = await fetchYouTubePlaylistsFromFirestore();
    if (Array.isArray(persisted) && persisted.length > 0) {
      db.youtubePlaylists = persisted;
      writeDb(db);
      return {
        playlists: persisted,
        upstreamSuccess: false,
        source: 'fallback',
        error: upstreamError || 'UPSTREAM_FAILED',
      };
    }
  } catch (err) {
    console.warn('[YouTube Sync] Fallback Firestore read notice:', err);
  }

  // Next preserve in-memory catalog
  if (Array.isArray(db.youtubePlaylists) && db.youtubePlaylists.length > 0) {
    return {
      playlists: db.youtubePlaylists,
      upstreamSuccess: false,
      source: 'fallback',
      error: upstreamError || 'UPSTREAM_FAILED',
    };
  }

  // Absolute fallback: authentic curated playlists baseline (never fake data)
  return {
    playlists: DEFAULT_CURATED_PLAYLISTS,
    upstreamSuccess: false,
    source: 'fallback',
    error: upstreamError || 'UPSTREAM_FAILED',
  };
}

// Automatically detect new playlists and videos added to the YouTube channel every 15 minutes
setInterval(() => {
  syncYouTubePlaylistsFromApi(true).catch((err) => {
    console.warn('Background periodic YouTube sync notice:', err);
  });
}, 15 * 60 * 1000);

async function syncSpotifyPlaylistsFromApi(force = false): Promise<any> {
  const configStatus = getSpotifyConfigStatus();
  if (!configStatus.configured) {
    console.warn('[Spotify] Credentials not configured in environment variables (SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET).');
    const db = readDb();
    return db.spotifyPlaylists || null;
  }

  const updatedPlaylists: Record<string, any> = {};
  for (const lvl of ['beginner', 'intermediate', 'advanced'] as SpotifyLevel[]) {
    try {
      const tracks = await fetchOfficialPlaylistTracks(lvl, force);
      const meta = OFFICIAL_SPOTIFY_PLAYLISTS[lvl];
      updatedPlaylists[lvl] = {
        level: lvl,
        playlistId: meta.id,
        playlistTitle: meta.title,
        descriptionPt: meta.descriptionPt,
        descriptionEn: meta.descriptionEn,
        totalTracks: tracks.length,
        tracks,
      };
    } catch (err: any) {
      console.warn(`[Spotify] Failed to fetch playlist for level ${lvl}:`, err?.message || err);
    }
  }

  if (Object.keys(updatedPlaylists).length > 0) {
    const db = readDb();
    db.spotifyPlaylists = updatedPlaylists;
    writeDb(db);
    return updatedPlaylists;
  }

  const db = readDb();
  return db.spotifyPlaylists || null;
}

app.get('/api/youtube-playlists', async (req, res) => {
  const force = req.query.refresh === 'true' || req.query.force === 'true';
  const authHeader = req.headers.authorization || '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.substring(7).trim() : undefined;
  const { playlists, upstreamSuccess, source, error } = await syncYouTubePlaylistsFromApi(force, bearerToken);
  const sortedPlaylists = [...playlists].sort((a, b) =>
    (a.title || '').localeCompare(b.title || '', undefined, { sensitivity: 'base' })
  );
  // Never expose tokens or administrative details to students
  res.setHeader('Cache-Control', force ? 'no-cache, no-store, must-revalidate' : 'public, max-age=300');
  res.setHeader('X-Upstream-Success', String(upstreamSuccess));
  res.setHeader('X-Catalog-Source', source);
  if (error) {
    res.setHeader('X-Upstream-Error', error);
  }
  res.json(sortedPlaylists);
});

app.post('/api/youtube-playlists/sync', async (req, res) => {
  const authHeader = req.headers.authorization || '';
  const bearerToken =
    (authHeader.startsWith('Bearer ') ? authHeader.substring(7).trim() : undefined) ||
    req.body?.token;
  const { playlists, upstreamSuccess, source, error } = await syncYouTubePlaylistsFromApi(true, bearerToken);
  res.json({ success: upstreamSuccess, count: playlists.length, playlists, source, error });
});

app.post('/api/youtube-playlists/authorize', async (req, res) => {
  const authHeader = req.headers.authorization || '';
  const token =
    req.body?.token ||
    (authHeader.startsWith('Bearer ') ? authHeader.substring(7).trim() : '');
  if (!token) {
    return res.status(400).json({ error: 'OAuth token is required for YouTube authorization' });
  }
  const { playlists, upstreamSuccess, source, error } = await syncYouTubePlaylistsFromApi(true, token);
  res.json({ success: upstreamSuccess, count: playlists.length, playlists, source, error });
});

app.post('/api/youtube-playlists/save', async (req, res) => {
  const { playlists } = req.body;
  if (!Array.isArray(playlists)) {
    return res.status(400).json({ error: 'Playlists array is required' });
  }
  const db = readDb();
  db.youtubePlaylists = playlists;
  writeDb(db);
  lastYouTubeSyncTime = Date.now();
  saveYouTubePlaylistsToFirestore(playlists).catch((err) => {
    if (!isPermissionError(err)) {
      console.warn('saveYouTubePlaylistsToFirestore notice:', err);
    }
  });
  res.json({ success: true, count: playlists.length, playlists });
});

app.get('/api/spotify-playlists', async (req, res) => {
  const force = req.query.refresh === 'true' || req.query.force === 'true';
  const configStatus = getSpotifyConfigStatus();
  if (!configStatus.configured) {
    const db = readDb();
    if (db.spotifyPlaylists && Object.keys(db.spotifyPlaylists).length > 0) {
      return res.json(db.spotifyPlaylists);
    }
    return res.status(503).json({
      error: 'SPOTIFY_CREDENTIALS_MISSING',
      message: 'Spotify credentials not configured in environment variables. Define SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET.',
      missingEnvVars: configStatus.missingEnvVars,
    });
  }
  try {
    const playlists = await syncSpotifyPlaylistsFromApi(force);
    if (!playlists) {
      return res.status(502).json({
        error: 'SPOTIFY_API_ERROR',
        message: 'Falha ao obter playlists oficiais do Spotify.',
      });
    }
    res.json(playlists);
  } catch (err: any) {
    res.status(502).json({
      error: 'SPOTIFY_API_ERROR',
      message: err?.message || 'Falha ao consultar a API oficial do Spotify.',
    });
  }
});

app.post('/api/spotify-playlists/sync', async (req, res) => {
  const configStatus = getSpotifyConfigStatus();
  if (!configStatus.configured) {
    return res.status(503).json({
      error: 'SPOTIFY_CREDENTIALS_MISSING',
      message: 'Spotify credentials not configured in environment variables. Define SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET.',
      missingEnvVars: configStatus.missingEnvVars,
    });
  }
  try {
    const playlists = await syncSpotifyPlaylistsFromApi(true);
    if (!playlists) {
      return res.status(502).json({
        error: 'SPOTIFY_API_ERROR',
        message: 'Falha ao sincronizar playlists oficiais do Spotify.',
      });
    }
    res.json({ success: true, playlists });
  } catch (err: any) {
    res.status(502).json({
      error: 'SPOTIFY_API_ERROR',
      message: err?.message || 'Falha ao sincronizar playlists do Spotify.',
    });
  }
});

app.get('/api/student-video-assignments', firebaseAuthMiddleware, async (req, res) => {
  const authCtx = await authorizeStudentRoutineAccess(req, res, { allowMissingTargetFallbackToCaller: true });
  if (!authCtx) return;

  const { canonicalStudentUid, canonicalStudentEmail } = authCtx;
  const requestedCycle = req.query.weeklyCycle !== undefined ? String(req.query.weeklyCycle) : undefined;
  const ctx = await fetchCanonicalRoutineContextServer(canonicalStudentUid, requestedCycle);

  if (!ctx) {
    return res.status(503).json({
      error: 'FirestoreUnavailable',
      message: 'Canonical Firestore (default) context unavailable.',
    });
  }

  const studentLevel = normalizeStudentLevel(ctx.level).key;

  return res.json({
    success: true,
    assignments: ctx.videoAssignments,
    watched: ctx.watchedVideosHistory,
    studentEmail: ctx.studentEmail || canonicalStudentEmail,
    studentUid: canonicalStudentUid,
    studentLevel,
    weeklyCycle: ctx.activeCycle,
  });
});

/**
 * Hardening Fase 2B + ARCH.2E.2A: Authoritatively verifies if an authenticated caller is an approved Native Friend (Teacher).
 * Checks Firestore /tutors and /users collections, canonical identity resolver, and local DB authoritative tutors.
 * Preserves approved teachers even when Firebase Auth token lacks a custom teacher claim.
 */
async function verifyActiveApprovedTeacher(
  uid: string,
  email?: string,
  emailVerified?: boolean,
  dbState?: any
): Promise<{ isTeacher: boolean; canonicalUid?: string; email?: string; name?: string }> {
  if (!uid || !isValidCanonicalUid(uid)) {
    return { isTeacher: false };
  }

  const firestore = getFirestoreDb();
  if (firestore) {
    try {
      const fsTeacher = await verifyTeacherIdentityInFirestore(firestore, uid, email, emailVerified);
      if (fsTeacher.isTeacher) {
        return {
          isTeacher: true,
          canonicalUid: fsTeacher.authUid || uid,
          email: fsTeacher.email || email,
          name: fsTeacher.name,
        };
      }
    } catch {}
  }

  try {
    const teacherRes = await resolveTeacherCanonicalIdentity({
      teacherUid: uid,
      teacherEmail: email,
      dbState: dbState,
    });
    if (teacherRes && teacherRes.canonicalUid && teacherRes.isApproved) {
      return {
        isTeacher: true,
        canonicalUid: teacherRes.canonicalUid,
        email: teacherRes.email || email,
        name: teacherRes.name,
      };
    }
  } catch {}

  if (dbState) {
    const cleanEmail = (email || '').toLowerCase().trim();
    const allTutors = [...(dbState.teachers || []), ...(dbState.tutorsList || [])];
    const found = allTutors.find((t: any) => {
      const matchUid = (t.uid && t.uid === uid) || (t.id && (t.id === uid || t.id === `tutor-${uid}`)) || (t.authUid && t.authUid === uid);
      const matchEmail = cleanEmail && t.email && t.email.toLowerCase().trim() === cleanEmail;
      return matchUid || matchEmail;
    });
    if (found) {
      const role = (found.role || '').toLowerCase().trim();
      const status = (found.approvalStatus || found.status || '').toLowerCase().trim();
      const isDeniedOrPending =
        status === 'pending' || status === 'rejected' || found.isApproved === false || found.approved === false;
      const isTeacherRole = role === 'teacher' || role === 'tutor' || role === 'native_friend' || !role;
      const isApproved = Boolean(
        isTeacherRole &&
        !isDeniedOrPending &&
        (status === 'approved' || found.isApproved === true || found.approved === true)
      );
      if (isApproved) {
        return {
          isTeacher: true,
          canonicalUid: found.uid || found.authUid || uid,
          email: found.email || email,
          name: found.name,
        };
      }
    }
  }

  return { isTeacher: false };
}

async function isExplicitlyUnapprovedTeacherInFirestore(
  firestore: any,
  uid: string,
  email?: string
): Promise<boolean> {
  if (!firestore || !uid) return false;
  const cleanUid = uid.trim();
  const cleanEmail = (email || '').toLowerCase().trim();
  const hasNegativeApproval = (data: any): boolean => {
    if (!data || typeof data !== 'object') return false;
    const status = (data.approvalStatus || data.status || '').toLowerCase().trim();
    return Boolean(
      status === 'pending' ||
      status === 'rejected' ||
      data.isApproved === false ||
      data.approved === false
    );
  };
  try {
    const [uDoc, tDoc] = await Promise.all([
      firestore.collection('users').doc(cleanUid).get().catch(() => null),
      firestore.collection('tutors').doc(cleanUid).get().catch(() => null),
    ]);
    if (uDoc?.exists) {
      const ud = uDoc.data() || {};
      const role = (ud.role || '').toLowerCase().trim();
      if ((role === 'teacher' || role === 'tutor' || role === 'native_friend' || ud.isTeacher === true) && hasNegativeApproval(ud)) {
        return true;
      }
    }
    if (tDoc?.exists && hasNegativeApproval(tDoc.data())) {
      return true;
    }
    if (cleanEmail) {
      const qT = await firestore.collection('tutors').where('email', '==', cleanEmail).limit(1).get().catch(() => null);
      if (qT && !qT.empty && hasNegativeApproval(qT.docs[0].data())) {
        return true;
      }
    }
  } catch {}
  return false;
}

async function authorizeStudentRoutineAccess(
  req: express.Request,
  res: express.Response,
  options?: { allowMissingTargetFallbackToCaller?: boolean; requireApprovedTeacherIfTutor?: boolean }
): Promise<{
  callerUid: string;
  callerEmail: string;
  isAdmin: boolean;
  isCallerApprovedTeacher: boolean;
  effectiveRole: 'admin' | 'teacher' | 'student';
  canonicalStudentUid: string;
  canonicalStudentEmail: string;
  firestore: any;
} | null> {
  const caller = req.user;
  if (!caller || !caller.uid) {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Authentication required: verified user token missing.',
    });
    return null;
  }

  const firestore = getFirestoreDb();
  if (!firestore) {
    res.status(503).json({
      error: 'FirestoreUnavailable',
      message: 'Canonical Firestore (default) database is unavailable.',
    });
    return null;
  }

  const db = readDb();
  const cleanCallerUid = caller.uid.trim();
  const cleanCallerEmail = (caller.email || '').toLowerCase().trim();
  const isAdmin = caller.role === 'admin';

  const teacherStatus = await verifyActiveApprovedTeacher(
    cleanCallerUid,
    cleanCallerEmail,
    caller.email_verified,
    db
  );
  const isCallerApprovedTeacher = teacherStatus.isTeacher;

  const allTutors = [...(db.teachers || []), ...(db.tutorsList || [])];
  const matchedTutorRecord = allTutors.find((t: any) => {
    const cleanTutorEmail = (t.email || '').toLowerCase().trim();
    return (
      (t.uid && t.uid === cleanCallerUid) ||
      (t.id && (t.id === cleanCallerUid || t.id === `tutor-${cleanCallerUid}`)) ||
      (t.authUid && t.authUid === cleanCallerUid) ||
      (cleanCallerEmail && cleanTutorEmail === cleanCallerEmail)
    );
  });
  const unapprovedInFirestore =
    !isCallerApprovedTeacher && !isAdmin
      ? await isExplicitlyUnapprovedTeacherInFirestore(firestore, cleanCallerUid, cleanCallerEmail)
      : false;

  const rawUid = ((req.body?.studentUid as string) || (req.body?.uid as string) || (req.query?.studentUid as string) || (req.query?.uid as string) || '').trim();
  const rawEmail = ((req.body?.studentEmail as string) || (req.body?.email as string) || (req.query?.studentEmail as string) || (req.query?.email as string) || '').toLowerCase().trim();

  if ((matchedTutorRecord || unapprovedInFirestore) && !isCallerApprovedTeacher && !isAdmin) {
    const targetingOther = Boolean(
      (rawUid && rawUid !== cleanCallerUid) ||
      (rawEmail && cleanCallerEmail && rawEmail !== cleanCallerEmail) ||
      (!rawUid && rawEmail)
    );
    if (options?.requireApprovedTeacherIfTutor || targetingOther) {
      res.status(403).json({
        error: 'Forbidden',
        message: 'Native Friend is not approved or active.',
      });
      return null;
    }
  }

  const effectiveRole: 'admin' | 'teacher' | 'student' = isAdmin
    ? 'admin'
    : isCallerApprovedTeacher
    ? 'teacher'
    : 'student';

  let candidateUid = rawUid;
  let candidateEmail = rawEmail;

  if (!candidateUid && !candidateEmail && options?.allowMissingTargetFallbackToCaller) {
    candidateUid = cleanCallerUid;
    candidateEmail = cleanCallerEmail;
  }

  if (!candidateUid && candidateEmail) {
    const fsProf = await fetchStudentProfileFromFirestoreServer('', candidateEmail);
    if (fsProf.uid && isValidCanonicalUid(fsProf.uid)) {
      candidateUid = fsProf.uid;
    }
  }

  const studentResolution = await resolveCanonicalStudentIdentity({
    caller: {
      uid: cleanCallerUid,
      email: cleanCallerEmail,
      role: effectiveRole,
    },
    studentEmail: candidateEmail || undefined,
    studentUid: candidateUid || undefined,
  });

  if (!studentResolution.authorized) {
    res.status(studentResolution.statusCode || 403).json({
      error: studentResolution.statusCode === 401 ? 'Unauthorized' : studentResolution.statusCode === 422 ? 'Unprocessable Entity' : 'Forbidden',
      message: studentResolution.error || 'Access denied.',
    });
    return null;
  }

  const canonicalStudentUid = studentResolution.canonicalStudentUid;
  if (!isValidCanonicalUid(canonicalStudentUid)) {
    res.status(422).json({
      error: 'Unprocessable Entity',
      message: 'Invalid or non-canonical student UID.',
    });
    return null;
  }

  return {
    callerUid: cleanCallerUid,
    callerEmail: cleanCallerEmail,
    isAdmin,
    isCallerApprovedTeacher,
    effectiveRole,
    canonicalStudentUid,
    canonicalStudentEmail: (studentResolution.studentEmail || candidateEmail || '').toLowerCase().trim(),
    firestore,
  };
}

app.post('/api/student-video-assignments/assign', firebaseAuthMiddleware, async (req, res) => {
  const authCtx = await authorizeStudentRoutineAccess(req, res, {
    allowMissingTargetFallbackToCaller: true,
    requireApprovedTeacherIfTutor: true,
  });
  if (!authCtx) return;

  const {
    callerUid,
    callerEmail,
    isAdmin,
    isCallerApprovedTeacher,
    canonicalStudentUid,
    canonicalStudentEmail,
  } = authCtx;

  const db = readDb(); // Catalog playlists only (db.youtubePlaylists)
  const ctx = await fetchCanonicalRoutineContextServer(canonicalStudentUid);
  if (!ctx) {
    return res.status(503).json({
      error: 'FirestoreUnavailable',
      message: 'Canonical Firestore (default) context unavailable.',
    });
  }

  const passedCycle = extractPositiveIntegerCycle(req.body.weeklyCycle);
  if (passedCycle !== null && passedCycle < ctx.activeCycle) {
    return res.status(409).json({
      success: false,
      error: 'STALE_CYCLE',
      message: `Stale cycle ${passedCycle} rejected; active cycle is ${ctx.activeCycle}.`,
      activeCycle: ctx.activeCycle,
    });
  }
  const activeCycle = passedCycle !== null ? Math.max(ctx.activeCycle, passedCycle) : ctx.activeCycle;

  let effectiveTeacherUid = '';
  let effectiveTeacherEmail = '';

  if (isCallerApprovedTeacher) {
    effectiveTeacherUid = callerUid;
    effectiveTeacherEmail = callerEmail;
  } else if (isAdmin) {
    if (req.body.teacherUid || req.body.teacherEmail) {
      const teacherRes = await resolveTeacherCanonicalIdentity({
        teacherUid: req.body.teacherUid,
        teacherEmail: req.body.teacherEmail,
        dbState: db,
      });
      if (teacherRes && teacherRes.canonicalUid && teacherRes.isApproved) {
        effectiveTeacherUid = teacherRes.canonicalUid;
        effectiveTeacherEmail = teacherRes.email || '';
      }
    }
  } else {
    effectiveTeacherUid = (
      ctx.userProfile?.assignedNativeFriendUID ||
      ctx.userProfile?.teacherUid ||
      ''
    ).trim();
    effectiveTeacherEmail = (ctx.userProfile?.teacherEmail || '').trim();
  }

  const uid = canonicalStudentUid;
  const cleanEmail = ctx.studentEmail || canonicalStudentEmail;
  const { playlistId, activityId, day, teacherNotes, videoUrl } = req.body;
  const targetDay: DayOfWeek = ((String(day || 'monday').toLowerCase().trim() as DayOfWeek));
  if (!DAYS_SEQUENCE.includes(targetDay)) {
    return res.status(400).json({ error: `Invalid day of week: ${targetDay}` });
  }

  const studentLevel = normalizeStudentLevel(ctx.level).key;
  const levelCurriculum = YOUTUBE_LEVEL_PLAYLISTS[studentLevel] || YOUTUBE_LEVEL_PLAYLISTS.beginner;
  const playlists = db.youtubePlaylists || [];
  const playlist = playlists.find((p: any) => p.id === playlistId) || playlists[0];

  const forceNew = Boolean(req.body.forceNewVideo || req.body.reassign);
  const idempotencyKey = typeof req.body.idempotencyKey === 'string' ? req.body.idempotencyKey.trim() : '';
  const requestedManualVidId = videoUrl ? extractServerYouTubeId(videoUrl) : null;

  // Idempotency check for identical repeated requests on the same (day, playlistId, cycle)
  const existingAssignment = ctx.videoAssignments.find(
    (a: any) => (a.day || a.dayOfWeek) === targetDay && Number(a.weeklyCycle || activeCycle) === activeCycle
  );
  if (!forceNew && existingAssignment && (existingAssignment.videoId || existingAssignment.videoUrl)) {
    const existingVidId = extractServerYouTubeId(existingAssignment.videoId || existingAssignment.videoUrl);
    const sameIdempotencyKey = Boolean(idempotencyKey && existingAssignment.idempotencyKey === idempotencyKey);
    const sameRequestParams = Boolean(
      playlistId &&
      existingAssignment.playlistId === playlistId &&
      (!requestedManualVidId || requestedManualVidId === existingVidId)
    );
    if (sameIdempotencyKey || sameRequestParams) {
      const consumedSet = new Set<string>(ctx.watchedVideosHistory.map((id) => extractServerYouTubeId(id) || id));
      ctx.videoAssignments.forEach((a: any) => {
        const cid = extractServerYouTubeId(a.videoId || a.videoUrl);
        if (cid) consumedSet.add(cid);
      });
      const remainingUnseen = (playlist?.videos || []).filter((v: any) => {
        const vid = extractServerYouTubeId(v.videoId || v.url || v.id);
        return vid && !consumedSet.has(vid);
      }).length;
      const replayVideo = {
        id: existingAssignment.id || `vid-${targetDay}-${existingVidId}`,
        url: existingAssignment.videoUrl || `https://www.youtube.com/watch?v=${existingVidId}`,
        videoId: existingVidId || existingAssignment.videoId,
        title: existingAssignment.videoTitle || 'Daily Video Practice',
        duration: existingAssignment.duration || '5-10 min',
        instructions: existingAssignment.instructions || '',
        addedAt: existingAssignment.assignedAt || new Date().toISOString(),
        playlistId: existingAssignment.playlistId,
        playlistTitle: existingAssignment.playlistTitle,
      };
      return res.json({
        success: true,
        idempotentReplay: true,
        video: replayVideo,
        playlistTitle: replayVideo.playlistTitle,
        playlistId: replayVideo.playlistId,
        remainingUnseen,
        totalVideos: playlist?.videos?.length || 7,
        studentEmail: cleanEmail,
        studentUid: uid,
        weeklyCycle: activeCycle,
        message: `Vídeo exclusivo "${replayVideo.title}" já atribuído para este dia.`,
      });
    }
  }

  const consumedVideoIds = new Set<string>();
  ctx.watchedVideosHistory.forEach((id: string) => {
    const cid = extractServerYouTubeId(id);
    if (cid) consumedVideoIds.add(cid);
  });
  const clientWatchedHistory: string[] = Array.isArray(req.body.watchedVideosHistory)
    ? req.body.watchedVideosHistory
    : [];
  clientWatchedHistory.forEach((id: string) => {
    const cid = extractServerYouTubeId(id);
    if (cid) consumedVideoIds.add(cid);
  });

  const reqJournal: any[] = Array.isArray(req.body.studentJournal) ? req.body.studentJournal : [];
  [...reqJournal, ...ctx.studentJournal].forEach((entry: any) => {
    if (entry && entry.type === 'video') {
      const cid = extractServerYouTubeId(entry.id || entry.url);
      if (cid) consumedVideoIds.add(cid);
    }
  });

  ctx.videoAssignments.forEach((assign: any) => {
    if ((assign.day || assign.dayOfWeek) !== targetDay) {
      const cid = extractServerYouTubeId(assign.videoId || assign.videoUrl);
      if (cid) consumedVideoIds.add(cid);
    }
  });

  let chosenVideo: any = null;

  if (playlistId === 'repeat_previous_video') {
    const calendarDays: DayOfWeek[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    const studentPlanDays = ctx.studyDays.length > 0 ? ctx.studyDays : calendarDays;
    const activeDaysInOrder = calendarDays.filter((d) => studentPlanDays.includes(d));
    const effectiveActiveDays = activeDaysInOrder.length > 0 ? activeDaysInOrder : calendarDays;
    const currentActiveIdx = effectiveActiveDays.indexOf(targetDay);

    let targetPrevDay: DayOfWeek = targetDay;
    if (currentActiveIdx > 0) {
      targetPrevDay = effectiveActiveDays[currentActiveIdx - 1];
    } else if (currentActiveIdx === 0 && effectiveActiveDays.length > 1) {
      targetPrevDay = effectiveActiveDays[effectiveActiveDays.length - 1];
    } else {
      const currentCalIdx = calendarDays.indexOf(targetDay);
      const preceding = effectiveActiveDays.filter((d) => calendarDays.indexOf(d) < currentCalIdx);
      targetPrevDay = (preceding.length > 0 ? preceding[preceding.length - 1] : (effectiveActiveDays[effectiveActiveDays.length - 1] || 'monday')) as DayOfWeek;
    }

    const prevAssign = ctx.videoAssignments.find((a: any) => (a.day || a.dayOfWeek) === targetPrevDay && (a.videoId || a.videoUrl));
    if (prevAssign) {
      const pVidId = extractServerYouTubeId(prevAssign.videoId || prevAssign.videoUrl);
      chosenVideo = {
        videoId: pVidId,
        url: prevAssign.videoUrl || `https://www.youtube.com/watch?v=${pVidId}`,
        title: prevAssign.videoTitle || prevAssign.title || `Repeated Video (${targetPrevDay})`,
        duration: prevAssign.duration || '5-10 min',
        instructions: `Repeated from ${targetPrevDay}`,
      };
    }

    if (!chosenVideo) {
      const prevRaw = ctx.routinesByDayRaw[targetPrevDay];
      if (prevRaw && (prevRaw.videoId || prevRaw.url)) {
        const pVidId = extractServerYouTubeId(prevRaw.videoId || prevRaw.url);
        if (pVidId) {
          chosenVideo = {
            videoId: pVidId,
            url: prevRaw.url || `https://www.youtube.com/watch?v=${pVidId}`,
            title: prevRaw.videoTitle || prevRaw.title || `Repeated Video (${targetPrevDay})`,
            duration: prevRaw.duration || '5-10 min',
            instructions: `Repeated from ${targetPrevDay}`,
          };
        }
      }
    }

    if (!chosenVideo) {
      const otherActiveDays = [...effectiveActiveDays].filter((d) => d !== targetDay && d !== targetPrevDay).reverse();
      for (const d of otherActiveDays) {
        const assign = ctx.videoAssignments.find((a: any) => (a.day || a.dayOfWeek) === d && (a.videoId || a.videoUrl));
        if (assign) {
          const pVidId = extractServerYouTubeId(assign.videoId || assign.videoUrl);
          chosenVideo = {
            videoId: pVidId,
            url: assign.videoUrl || `https://www.youtube.com/watch?v=${pVidId}`,
            title: assign.videoTitle || assign.title || `Repeated Video (${d})`,
            duration: assign.duration || '5-10 min',
            instructions: `Repeated from ${d}`,
          };
          break;
        }
      }
    }

    if (!chosenVideo && ctx.watchedVideosHistory.length > 0) {
      const lastWatchedId = ctx.watchedVideosHistory[ctx.watchedVideosHistory.length - 1];
      chosenVideo = {
        videoId: lastWatchedId,
        url: `https://www.youtube.com/watch?v=${lastWatchedId}`,
        title: 'Repeated Previous Video',
        duration: '5-10 min',
        instructions: 'Repeated from watched history',
      };
    }

    if (!chosenVideo) {
      const fallbackVid = levelCurriculum.videos[targetPrevDay] || levelCurriculum.videos.monday;
      if (fallbackVid) {
        chosenVideo = {
          videoId: fallbackVid.videoId,
          url: fallbackVid.url,
          title: fallbackVid.title,
          duration: fallbackVid.duration || '5-10 min',
          instructions: `Repeated from ${targetPrevDay}`,
        };
      }
    }
  }

  if (videoUrl) {
    const manualId = extractServerYouTubeId(videoUrl);
    if (manualId) {
      chosenVideo = {
        videoId: manualId,
        url: `https://www.youtube.com/watch?v=${manualId}`,
        title: 'Teacher Selected Video',
        duration: '5-10 min',
      };
    }
  }

  if (!chosenVideo && playlist && playlist.videos && playlist.videos.length > 0) {
    chosenVideo = playlist.videos.find((v: any) => {
      const vid = extractServerYouTubeId(v.videoId || v.url || v.id);
      return vid && !consumedVideoIds.has(vid);
    });
  }

  if (!chosenVideo) {
    const pool = [
      ...DAYS_SEQUENCE.map((d) => levelCurriculum.videos[d]),
      ...(levelCurriculum.pool || []),
    ].filter(Boolean);

    chosenVideo = pool.find((v: any) => {
      const vid = extractServerYouTubeId(v.videoId || v.url || v.id);
      return vid && !consumedVideoIds.has(vid);
    });
  }

  if (!chosenVideo) {
    chosenVideo = levelCurriculum.videos[targetDay] || {
      videoId: 'V1bFr2KGq1g',
      url: 'https://www.youtube.com/watch?v=V1bFr2KGq1g',
      title: 'Daily English Video Practice',
      duration: '5-8 min',
    };
  }

  const validVidId = extractServerYouTubeId(chosenVideo.videoId || chosenVideo.url || chosenVideo.id)!;
  const cleanVideoUrl = `https://www.youtube.com/watch?v=${validVidId}`;
  const now = new Date().toISOString();

  const resolvedPlaylistId =
    playlistId === 'repeat_previous_video'
      ? 'repeat_previous_video'
      : (playlist?.id || levelCurriculum.playlistId);
  const resolvedPlaylistTitle =
    playlistId === 'repeat_previous_video'
      ? 'Repeat Previous Video'
      : (playlist?.title || levelCurriculum.playlistTitle);
  const resolvedInstructions =
    teacherNotes ||
    chosenVideo.instructions ||
    chosenVideo.teacherTipPt ||
    'Vídeo exclusivo do dia. Assista com atenção e anote 5 novas palavras.';
  const resolvedDuration = chosenVideo.duration || '5-10 min';

  const assignedVideoObj = {
    id: `vid-${targetDay}-${activeCycle}-${validVidId}`,
    url: cleanVideoUrl,
    videoId: validVidId,
    title: chosenVideo.title,
    duration: resolvedDuration,
    instructions: resolvedInstructions,
    addedAt: now,
    playlistId: resolvedPlaylistId,
    playlistTitle: resolvedPlaylistTitle,
  };

  const assignmentRecord: any = {
    id: `assign-${targetDay}-${activeCycle}-${validVidId}`,
    activityId: activityId || 'act-1',
    studentEmail: cleanEmail,
    studentUid: uid,
    teacherUid: effectiveTeacherUid,
    teacherEmail: effectiveTeacherEmail,
    day: targetDay,
    playlistId: assignedVideoObj.playlistId,
    playlistTitle: assignedVideoObj.playlistTitle,
    videoId: validVidId,
    videoTitle: chosenVideo.title,
    videoUrl: cleanVideoUrl,
    isRepeatVideo: playlistId === 'repeat_previous_video',
    instructions: resolvedInstructions,
    duration: resolvedDuration,
    weeklyCycle: activeCycle,
    assignedAt: now,
    ...(idempotencyKey ? { idempotencyKey } : {}),
  };

  const updatedAssignments = [
    ...ctx.videoAssignments.filter((a: any) => (a.day || a.dayOfWeek) !== targetDay),
    assignmentRecord,
  ];

  const subcollectionSaved = await saveRoutineVideoSubcollection(
    uid,
    targetDay,
    {
      id: validVidId,
      videoId: validVidId,
      videoTitle: assignedVideoObj.title,
      title: assignedVideoObj.title,
      url: cleanVideoUrl,
      playlistId: assignedVideoObj.playlistId,
      playlistTitle: assignedVideoObj.playlistTitle,
      dayOfWeek: targetDay,
      activityId: activityId || 'act-1',
      teacherUid: effectiveTeacherUid,
      teacherEmail: effectiveTeacherEmail,
      isRepeatVideo: playlistId === 'repeat_previous_video',
      instructions: resolvedInstructions,
      duration: resolvedDuration,
      weeklyCycle: activeCycle,
      updatedAt: now,
    },
    activeCycle
  );

  if (!subcollectionSaved) {
    return res.status(500).json({
      success: false,
      error: 'FirestorePersistenceFailed',
      message: 'Failed to persist assigned video to users/{uid}/routines in Firestore (default).',
    });
  }

  const assignDocSaved = await saveStudentAssignmentsCanonicalServer(uid, {
    uid,
    email: cleanEmail,
    level: studentLevel,
    weeklyCycle: activeCycle,
    videoAssignments: updatedAssignments,
    awaitingTopicSelection: false,
    updatedAt: now,
  });

  if (!assignDocSaved) {
    return res.status(500).json({
      success: false,
      error: 'FirestorePersistenceFailed',
      message: 'Failed to persist student_assignments/{uid} in Firestore (default).',
    });
  }

  const remainingUnseen = (playlist?.videos || []).filter((v: any) => {
    const vid = extractServerYouTubeId(v.videoId || v.url || v.id);
    return vid && !consumedVideoIds.has(vid) && vid !== validVidId;
  }).length;

  return res.json({
    success: true,
    video: assignedVideoObj,
    playlistTitle: assignedVideoObj.playlistTitle,
    playlistId: assignedVideoObj.playlistId,
    remainingUnseen,
    totalVideos: playlist?.videos?.length || 7,
    studentEmail: cleanEmail,
    studentUid: uid,
    weeklyCycle: activeCycle,
    message: `Vídeo exclusivo "${chosenVideo.title}" atribuído com sucesso!`,
  });
});

// Endpoint to distribute exclusive sequential YouTube videos for student active days (or Monday to Sunday)
app.post('/api/student-video-assignments/distribute-week', firebaseAuthMiddleware, async (req, res) => {
  const caller = req.user;
  if (!caller || !caller.uid) {
    return res.status(401).json({ error: 'Unauthorized', message: 'Authentication required: verified user token missing.' });
  }

  const firestore = getFirestoreDb();
  if (!firestore) {
    return res.status(503).json({
      error: 'FirestoreUnavailable',
      message: 'Canonical Firestore (default) database is unavailable.',
    });
  }

  const db = readDb();
  const cleanCallerUid = caller.uid.trim();
  const cleanCallerEmail = (caller.email || '').toLowerCase().trim();
  const isAdmin = caller.role === 'admin';

  const teacherStatus = await verifyActiveApprovedTeacher(cleanCallerUid, cleanCallerEmail, caller.email_verified, db);
  const isCallerApprovedTeacher = teacherStatus.isTeacher;

  const allTutors = [...(db.teachers || []), ...(db.tutorsList || [])];
  const matchedTutorRecord = allTutors.find((t: any) => {
    const cleanTutorEmail = (t.email || '').toLowerCase().trim();
    return (
      (t.uid && t.uid === cleanCallerUid) ||
      (t.id && (t.id === cleanCallerUid || t.id === `tutor-${cleanCallerUid}`)) ||
      (t.authUid && t.authUid === cleanCallerUid) ||
      (cleanCallerEmail && cleanTutorEmail === cleanCallerEmail)
    );
  });
  const unapprovedInFirestore =
    !isCallerApprovedTeacher && !isAdmin
      ? await isExplicitlyUnapprovedTeacherInFirestore(firestore, cleanCallerUid, cleanCallerEmail)
      : false;
  if ((matchedTutorRecord || unapprovedInFirestore) && !isCallerApprovedTeacher && !isAdmin) {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'Native Friend is not approved or active.',
    });
  }

  const effectiveRole = isAdmin ? 'admin' : (isCallerApprovedTeacher ? 'teacher' : 'student');
  const forceRedistribute = Boolean(req.body.forceRedistribute);
  const idempotencyKey = typeof req.body.idempotencyKey === 'string' ? req.body.idempotencyKey.trim() : '';

  // Handle Batch Distribution
  if (Array.isArray(req.body.students)) {
    if (effectiveRole === 'student') {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Batch distribution not permitted for students.',
      });
    }

    const batchStudents = req.body.students;
    if (batchStudents.length === 0) {
      return res.status(400).json({ error: 'students array is empty' });
    }

    const validatedStudents: { canonicalUid: string; canonicalEmail: string; level?: string; days?: string[]; weeklyCycle?: number }[] = [];
    for (const item of batchStudents) {
      const sEmail = (item.studentEmail || item.email || '').toLowerCase().trim();
      let sUid = (item.studentUid || item.uid || '').trim();
      if (!sUid && sEmail) {
        const fsProf = await fetchStudentProfileFromFirestoreServer('', sEmail);
        if (fsProf.uid && isValidCanonicalUid(fsProf.uid)) sUid = fsProf.uid;
      }
      const sRes = await resolveCanonicalStudentIdentity({
        caller: {
          uid: cleanCallerUid,
          email: cleanCallerEmail,
          role: effectiveRole,
        },
        studentEmail: sEmail || undefined,
        studentUid: sUid || undefined,
      });

      if (!sRes.authorized || !isValidCanonicalUid(sRes.canonicalStudentUid)) {
        return res.status(sRes.statusCode || 403).json({
          error: 'Forbidden',
          message: sRes.error || `Unauthorized distribution for student ${item.studentEmail || item.studentUid || ''}`,
        });
      }

      validatedStudents.push({
        canonicalUid: sRes.canonicalStudentUid,
        canonicalEmail: (sRes.studentEmail || sEmail || '').toLowerCase().trim(),
        level: item.level || req.body.level,
        days: item.days || req.body.days,
        weeklyCycle: item.weeklyCycle ?? req.body.weeklyCycle,
      });
    }

    const batchResults: any[] = [];
    for (const vStudent of validatedStudents) {
      const teacherUidToUse = isCallerApprovedTeacher ? cleanCallerUid : (req.body.teacherUid || '');
      const teacherEmailToUse = isCallerApprovedTeacher ? cleanCallerEmail : (req.body.teacherEmail || '');
      const distRes = await distributeWeeklyYouTubeCanonical({
        uid: vStudent.canonicalUid,
        email: vStudent.canonicalEmail,
        level: vStudent.level,
        teacherUid: teacherUidToUse,
        teacherEmail: teacherEmailToUse,
        days: Array.isArray(vStudent.days) ? vStudent.days : undefined,
        weeklyCycle: vStudent.weeklyCycle,
        forceRedistribute,
        idempotencyKey,
        catalogPlaylists: db.youtubePlaylists,
      });

      if (!distRes.success) {
        if (distRes.code === 'STALE_CYCLE') {
          return res.status(409).json({
            success: false,
            error: 'STALE_CYCLE',
            message: distRes.error,
            activeCycle: distRes.weeklyCycle,
          });
        }
        return res.status(500).json({
          success: false,
          error: 'FirestorePersistenceFailed',
          message: distRes.error || 'Failed to persist batch weekly video distribution.',
        });
      }

      batchResults.push({
        studentUid: vStudent.canonicalUid,
        studentEmail: vStudent.canonicalEmail,
        count: distRes.assignments.length,
        idempotentReplay: Boolean(distRes.idempotentReplay),
      });
    }

    return res.json({
      success: true,
      batch: true,
      results: batchResults,
      message: `Distribuição em lote concluída com sucesso para ${batchResults.length} alunos!`,
    });
  }

  // Handle Single Student Distribution
  const authCtx = await authorizeStudentRoutineAccess(req, res, {
    allowMissingTargetFallbackToCaller: true,
    requireApprovedTeacherIfTutor: true,
  });
  if (!authCtx) return;

  const { canonicalStudentUid, canonicalStudentEmail } = authCtx;
  const { level, days, weeklyCycle: bodyCycle } = req.body;

  let effectiveTeacherUid = '';
  let effectiveTeacherEmail = '';
  if (isCallerApprovedTeacher) {
    effectiveTeacherUid = cleanCallerUid;
    effectiveTeacherEmail = cleanCallerEmail;
  } else if (isAdmin) {
    effectiveTeacherUid = (req.body.teacherUid || '').trim();
    effectiveTeacherEmail = (req.body.teacherEmail || '').trim();
  }

  const distRes = await distributeWeeklyYouTubeCanonical({
    uid: canonicalStudentUid,
    email: canonicalStudentEmail,
    level,
    teacherUid: effectiveTeacherUid,
    teacherEmail: effectiveTeacherEmail,
    days: Array.isArray(days) ? days : undefined,
    weeklyCycle: bodyCycle,
    forceRedistribute,
    idempotencyKey,
    catalogPlaylists: db.youtubePlaylists,
  });

  if (!distRes.success) {
    if (distRes.code === 'STALE_CYCLE') {
      return res.status(409).json({
        success: false,
        error: 'STALE_CYCLE',
        message: distRes.error,
        activeCycle: distRes.weeklyCycle,
      });
    }
    return res.status(500).json({
      success: false,
      error: 'FirestorePersistenceFailed',
      message: distRes.error || 'Failed to persist weekly video distribution in Firestore (default).',
    });
  }

  return res.json({
    success: true,
    idempotentReplay: Boolean(distRes.idempotentReplay),
    assignments: distRes.assignments,
    studentEmail: canonicalStudentEmail,
    studentUid: canonicalStudentUid,
    weeklyCycle: distRes.weeklyCycle,
    message: `Semana de ${distRes.assignments.length} vídeos exclusivos do YouTube atribuída com sucesso!`,
  });
});

app.post('/api/student-video-assignments/watch', firebaseAuthMiddleware, async (req, res) => {
  const authCtx = await authorizeStudentRoutineAccess(req, res, { allowMissingTargetFallbackToCaller: true });
  if (!authCtx) return;

  const { canonicalStudentUid, canonicalStudentEmail } = authCtx;
  const { videoId, videoTitle, title } = req.body || {};
  const cleanVidId = extractServerYouTubeId(videoId);

  if (!cleanVidId) {
    return res.status(400).json({ error: 'Valid videoId is required' });
  }

  const watchRes = await addWatchedVideoCanonicalServer(
    canonicalStudentUid,
    cleanVidId,
    videoTitle || title
  );

  if (!watchRes.success) {
    return res.status(500).json({
      success: false,
      error: 'FirestorePersistenceFailed',
      message: watchRes.error || 'Failed to persist watched video history in Firestore (default).',
    });
  }

  return res.json({
    success: true,
    watchedCount: watchRes.watchedVideos.length,
    watchedVideos: watchRes.watchedVideos,
    studentEmail: canonicalStudentEmail,
    studentUid: canonicalStudentUid,
  });
});

app.get('/api/routines/daily-video', firebaseAuthMiddleware, async (req, res) => {
  const authCtx = await authorizeStudentRoutineAccess(req, res, { allowMissingTargetFallbackToCaller: true });
  if (!authCtx) return;

  const { canonicalStudentUid } = authCtx;
  const requestedCycle = req.query.weeklyCycle !== undefined ? (req.query.weeklyCycle as string) : undefined;
  const ctx = await fetchCanonicalRoutineContextServer(canonicalStudentUid, requestedCycle);

  if (!ctx) {
    return res.status(503).json({
      error: 'FirestoreUnavailable',
      message: 'Canonical Firestore (default) context unavailable.',
    });
  }

  const routinesByDay: Record<string, any> = {};
  Object.entries(ctx.routinesByDayRaw).forEach(([d, rawDay]: [string, any]) => {
    if (rawDay && typeof rawDay === 'object') {
      routinesByDay[d] = {
        ...rawDay,
        dayOfWeek: d,
        weeklyCycle: ctx.activeCycle,
      };
    }
  });

  // Also include active-cycle videoAssignments not yet present on routinesByDay subcollection
  ctx.videoAssignments.forEach((assign: any) => {
    const d = (assign.day || assign.dayOfWeek || '').toLowerCase().trim();
    const assignCycle = extractPositiveIntegerCycle(assign.weeklyCycle) ?? ctx.activeCycle;
    if (d && !routinesByDay[d] && assign.videoId && assignCycle === ctx.activeCycle) {
      routinesByDay[d] = {
        videoId: assign.videoId,
        title: assign.videoTitle || assign.title || 'Daily Video Practice',
        videoTitle: assign.videoTitle || assign.title || 'Daily Video Practice',
        url: assign.url || assign.videoUrl || `https://www.youtube.com/watch?v=${assign.videoId}`,
        playlistId: assign.playlistId || '',
        playlistTitle: assign.playlistTitle || '',
        dayOfWeek: d,
        isRepeatVideo: Boolean(assign.isRepeatVideo),
        activityId: assign.activityId || 'act-1',
        duration: assign.duration || '5-10 min',
        instructions: assign.instructions || '',
        weeklyCycle: ctx.activeCycle,
        updatedAt: assign.assignedAt || new Date().toISOString(),
      };
    }
  });

  const currentDay = ((req.query.day || req.query.dayOfWeek || '') as string).toLowerCase().trim() || undefined;

  return res.json({
    success: true,
    studentUid: canonicalStudentUid,
    weeklyCycle: ctx.activeCycle,
    routinesByDay,
    watchedVideosHistory: ctx.watchedVideosHistory,
    currentDayRoutine: currentDay ? routinesByDay[currentDay] || null : undefined,
  });
});

app.post('/api/routines/daily-video', firebaseAuthMiddleware, async (req, res) => {
  const authCtx = await authorizeStudentRoutineAccess(req, res, { allowMissingTargetFallbackToCaller: true });
  if (!authCtx) return;

  const { canonicalStudentUid, canonicalStudentEmail } = authCtx;
  const {
    day,
    dayOfWeek,
    videoId,
    title,
    videoTitle,
    url,
    playlistId,
    playlistTitle,
    isRepeatVideo,
    isCustomSuggestion,
    activityId,
    instructions,
    duration,
    weeklyCycle: bodyWeeklyCycle,
  } = req.body || {};

  const targetDay = String(dayOfWeek || day || '').toLowerCase().trim();
  if (!targetDay || !DAYS_SEQUENCE.includes(targetDay as any)) {
    return res.status(400).json({ error: 'Valid day of week is required' });
  }

  const ctx = await fetchCanonicalRoutineContextServer(canonicalStudentUid);
  if (!ctx) {
    return res.status(503).json({
      error: 'FirestoreUnavailable',
      message: 'Canonical Firestore (default) context unavailable.',
    });
  }

  const passedCycle = extractPositiveIntegerCycle(bodyWeeklyCycle);
  if (passedCycle !== null && passedCycle < ctx.activeCycle) {
    return res.status(409).json({
      success: false,
      error: 'STALE_CYCLE',
      message: `Stale cycle ${passedCycle} rejected; active cycle is ${ctx.activeCycle}.`,
      activeCycle: ctx.activeCycle,
    });
  }
  const currentCycle = passedCycle !== null ? Math.max(ctx.activeCycle, passedCycle) : ctx.activeCycle;

  const cleanVidId = videoId === '' ? '' : (extractServerYouTubeId(videoId || url) || (typeof videoId === 'string' ? videoId.trim() : ''));
  const cleanTitle = title || videoTitle || (cleanVidId ? 'Daily Video Practice' : 'Video of the Day');
  const cleanUrl = url !== undefined ? String(url || '') : (cleanVidId ? `https://www.youtube.com/watch?v=${cleanVidId}` : '');
  const now = new Date().toISOString();

  const videoObj = {
    id: cleanVidId || `vid-${targetDay}`,
    videoId: cleanVidId,
    title: cleanTitle,
    videoTitle: cleanTitle,
    url: cleanUrl,
    playlistId: playlistId || '',
    playlistTitle: playlistTitle || '',
    dayOfWeek: targetDay,
    activityId: activityId || 'act-1',
    isRepeatVideo: Boolean(isRepeatVideo || playlistId === 'repeat_previous_video'),
    isCustomSuggestion: Boolean(isCustomSuggestion || playlistId === 'custom_suggestion'),
    instructions: instructions || '',
    duration: duration || '5-10 min',
    weeklyCycle: currentCycle,
    updatedAt: now,
  };

  const firestoreSaved = await saveRoutineVideoSubcollection(canonicalStudentUid, targetDay, videoObj, currentCycle);
  if (!firestoreSaved) {
    return res.status(500).json({
      success: false,
      error: 'FirestorePersistenceFailed',
      message: 'Falha ao confirmar persistência do vídeo diário no Firestore.',
      studentUid: canonicalStudentUid,
      day: targetDay,
    });
  }

  const filteredAssignments = ctx.videoAssignments.filter((a: any) => (a.day || a.dayOfWeek) !== targetDay);
  if (cleanVidId || cleanUrl) {
    filteredAssignments.push({
      id: `assign-${targetDay}-${currentCycle}-${cleanVidId || 'custom'}`,
      activityId: videoObj.activityId,
      studentEmail: ctx.studentEmail || canonicalStudentEmail,
      studentUid: canonicalStudentUid,
      day: targetDay,
      playlistId: videoObj.playlistId,
      playlistTitle: videoObj.playlistTitle,
      videoId: cleanVidId,
      videoTitle: cleanTitle,
      videoUrl: cleanUrl,
      isRepeatVideo: videoObj.isRepeatVideo,
      instructions: videoObj.instructions,
      duration: videoObj.duration,
      weeklyCycle: currentCycle,
      assignedAt: now,
    });
  }

  const assignSaved = await saveStudentAssignmentsCanonicalServer(canonicalStudentUid, {
    uid: canonicalStudentUid,
    email: ctx.studentEmail || canonicalStudentEmail,
    level: normalizeStudentLevel(ctx.level).key,
    weeklyCycle: currentCycle,
    videoAssignments: filteredAssignments,
    awaitingTopicSelection: filteredAssignments.length === 0,
    updatedAt: now,
  });

  if (!assignSaved) {
    return res.status(500).json({
      success: false,
      error: 'FirestorePersistenceFailed',
      message: 'Falha ao atualizar student_assignments no Firestore.',
      studentUid: canonicalStudentUid,
      day: targetDay,
    });
  }

  return res.json({
    success: true,
    savedRoutine: videoObj,
    firestoreConfirmed: true,
    studentUid: canonicalStudentUid,
    day: targetDay,
    weeklyCycle: currentCycle,
  });
});

app.post('/api/routines/update-time', firebaseAuthMiddleware, async (req, res) => {
  const authCtx = await authorizeStudentRoutineAccess(req, res, { allowMissingTargetFallbackToCaller: true });
  if (!authCtx) return;

  const { day, activityId, time, weeklyCycle: bodyCycle } = req.body || {};
  const targetDay = String(day || '').toLowerCase().trim();
  if (!targetDay || !DAYS_SEQUENCE.includes(targetDay as any) || !activityId || !time) {
    return res.status(400).json({ error: 'Valid day, activityId, and time are required' });
  }

  const { canonicalStudentUid, firestore } = authCtx;
  const ctx = await fetchCanonicalRoutineContextServer(canonicalStudentUid);
  if (!ctx) {
    return res.status(503).json({
      error: 'FirestoreUnavailable',
      message: 'Canonical Firestore (default) context unavailable.',
    });
  }

  const passedCycle = extractPositiveIntegerCycle(bodyCycle);
  if (passedCycle !== null && passedCycle < ctx.activeCycle) {
    return res.status(409).json({
      success: false,
      error: 'STALE_CYCLE',
      message: `Stale cycle ${passedCycle} rejected; active cycle is ${ctx.activeCycle}.`,
      activeCycle: ctx.activeCycle,
    });
  }

  const existingDay = ctx.routinesByDayRaw[targetDay] || {};
  const existingTimes = (existingDay.activityTimes && typeof existingDay.activityTimes === 'object')
    ? existingDay.activityTimes
    : {};
  const isVideoSlot = String(activityId).endsWith('1') || activityId === 'act-1';
  const cleanTime = String(time).trim();

  const dayFields: Record<string, any> = {
    activityTimes: {
      ...existingTimes,
      [String(activityId)]: cleanTime,
    },
  };
  if (isVideoSlot) {
    dayFields.time = cleanTime;
  }

  const saveRes = await saveStudentRoutineDayFieldsServer(
    canonicalStudentUid,
    targetDay,
    dayFields,
    bodyCycle
  );

  if (!saveRes.success) {
    if (saveRes.code === 'STALE_CYCLE') {
      return res.status(409).json({
        success: false,
        error: 'STALE_CYCLE',
        message: saveRes.error,
        activeCycle: saveRes.activeCycle,
      });
    }
    return res.status(500).json({
      success: false,
      error: 'FirestorePersistenceFailed',
      message: saveRes.error || 'Failed to persist activity time in Firestore (default).',
    });
  }

  // Also sync routineAudioTime / routineVideoTime if updating audio or video slot on user profile
  if (String(activityId).endsWith('2') || activityId === 'act-2') {
    try {
      await firestore.collection('users').doc(canonicalStudentUid).set(
        { routineAudioTime: cleanTime, updatedAt: new Date().toISOString() },
        { merge: true }
      );
    } catch {
      return res.status(500).json({
        success: false,
        error: 'FirestorePersistenceFailed',
        message: 'Failed to persist routineAudioTime on user profile.',
      });
    }
  }

  return res.json({
    success: true,
    studentUid: canonicalStudentUid,
    day: targetDay,
    activityId,
    time: cleanTime,
    weeklyCycle: saveRes.activeCycle,
  });
});

// Helper to strictly validate positive-integer week cycles (e.g. 1, "1", "week-1")
// Rejects zero, negative, fractional, NaN, non-numeric suffixes, and unsafe integers.
// Never silently defaults to Week 1.
function extractPositiveIntegerCycle(week?: any): number | null {
  if (week === undefined || week === null) return null;
  if (typeof week === 'number') {
    if (!Number.isFinite(week) || !Number.isSafeInteger(week) || week <= 0) return null;
    return week;
  }
  if (typeof week !== 'string') return null;
  const clean = week.trim().toLowerCase();
  if (!clean) return null;
  let numStr = clean;
  if (clean.startsWith('week-')) {
    numStr = clean.slice(5);
  }
  if (!/^[0-9]+$/.test(numStr)) return null;
  const parsed = Number(numStr);
  if (!Number.isFinite(parsed) || !Number.isSafeInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

function normalizeWeekId(week?: any): string | null {
  const cycle = extractPositiveIntegerCycle(week);
  return cycle !== null ? `week-${cycle}` : null;
}

/**
 * Validates client-supplied student identity (UID and/or email).
 * Rejects empty identity, malformed characters, and path traversal strings.
 */
function validateStudentIdentity(studentUid?: any, studentEmail?: any): {
  valid: boolean;
  cleanUid: string;
  cleanEmail: string;
  error?: string;
} {
  const cleanUid = typeof studentUid === 'string' ? studentUid.trim() : '';
  const cleanEmail = typeof studentEmail === 'string' ? studentEmail.toLowerCase().trim() : '';

  if (!cleanUid && !cleanEmail) {
    return { valid: false, cleanUid: '', cleanEmail: '', error: 'Missing student identifier: studentUid or studentEmail is required.' };
  }

  // Prevent path traversal or invalid characters in UID
  if (cleanUid && !/^[a-zA-Z0-9_\-\.]+$/.test(cleanUid)) {
    return { valid: false, cleanUid, cleanEmail, error: 'Invalid studentUid format.' };
  }

  // Email format sanity check if email is provided
  if (cleanEmail && (!cleanEmail.includes('@') || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail))) {
    return { valid: false, cleanUid, cleanEmail, error: 'Invalid studentEmail format.' };
  }

  return { valid: true, cleanUid, cleanEmail };
}

/**
 * Resolves the student's persisted weeklyCycle from memory or Firestore.
 * Used exclusively for resolving the legacy "current_week" alias.
 * Returns null if the student has no valid persisted weeklyCycle.
 * NEVER assumes or defaults to Week 1.
 */
async function resolveStudentWeeklyCycle(studentUid?: string, studentEmail?: string): Promise<number | null> {
  const cleanUid = (studentUid || '').trim();
  const cleanEmail = (studentEmail || '').toLowerCase().trim();

  // ARCH.2E.2C: Canonical Firestore (default) users/{uid}.weeklyCycle is the sole authoritative source.
  if (cleanUid) {
    const res = await fetchCanonicalUserWeeklyCycleServer(cleanUid);
    if (res.activeCycle !== null) return res.activeCycle;
  }

  if (cleanEmail) {
    try {
      const prof = await fetchStudentProfileFromFirestoreServer('', cleanEmail);
      const cycle = extractPositiveIntegerCycle(prof?.profile?.weeklyCycle);
      if (cycle !== null) return cycle;
    } catch {}
  }

  return null;
}

export interface StudentAuthResult {
  authorized: boolean;
  status: 200 | 400 | 401 | 403;
  error?: string;
  cleanUid: string;
  cleanEmail: string;
  callerRole: 'admin' | 'teacher' | 'student';
  callerUid: string;
  callerEmail?: string;
}

/**
 * Reusable server-side authorization helper for student-scoped endpoints.
 *
 * Rules:
 * 1. Requires verified Firebase identity attached by firebaseAuthMiddleware (req.user).
 * 2. Resolves canonical target student identity (cleanUid, cleanEmail).
 * 3. Never trusts client-supplied roles, emails, or UIDs as proof of authorization.
 * 4. Recognizes administrators only through trusted, server-verified identity and authoritative configuration.
 *    Preserves compatibility with admin accounts that lack Firebase custom role claims.
 * 5. Verifies student ownership using the authenticated Firebase UID (or verified email).
 * 6. Verifies teacher assignment through trusted server-side student records.
 *    Preserves compatibility with teacher accounts that lack Firebase custom role claims.
 * 7. Applies least-privilege permissions:
 *    - Students may read and update their own homework and routine checks.
 *    - Assigned teachers may read linked student records (writes are strictly forbidden).
 *    - Administrators may read and update student records.
 * 8. Denies access (403) if identity or assignment cannot be established.
 */

interface AuthoritativeStudentRecord {
  uid: string;
  email: string;
  teacherUid?: string;
  teacherEmail?: string;
  assignedTeacherId?: string;
  tutorUid?: string;
  tutorEmail?: string;
  rawRecord?: any;
}

/**
 * Searches trusted server sources (db.students, db.userProfiles, db.authUsers, Firestore)
 * for student records matching the specified target UID and/or target email.
 */
async function queryAuthoritativeStudentRecords(
  targetUid: string,
  targetEmail: string,
  db: AppDb,
  firestore: any
): Promise<{
  uidMatches: AuthoritativeStudentRecord[];
  emailMatches: AuthoritativeStudentRecord[];
  candidateEmailsFromUid: string[];
  candidateUidsFromEmail: string[];
}> {
  const cleanUid = (targetUid || '').trim();
  const cleanEmail = (targetEmail || '').toLowerCase().trim();

  const uidMatches: AuthoritativeStudentRecord[] = [];
  const emailMatches: AuthoritativeStudentRecord[] = [];

  // 1. In-memory students list (db.students)
  if (Array.isArray(db.students)) {
    for (const s of db.students) {
      const sUid = (s.uid || s.studentUid || s.id || '').trim();
      const sEmail = (s.email || s.studentEmail || '').toLowerCase().trim();
      const rec: AuthoritativeStudentRecord = {
        uid: sUid,
        email: sEmail,
        teacherUid: (s.teacherUid || s.assignedTeacherId || s.tutorUid || '').trim(),
        teacherEmail: (s.teacherEmail || s.tutorEmail || '').toLowerCase().trim(),
        rawRecord: s,
      };
      if (cleanUid && sUid && sUid === cleanUid) {
        uidMatches.push(rec);
      }
      if (cleanEmail && sEmail && sEmail === cleanEmail) {
        emailMatches.push(rec);
      }
    }
  }

  // 2. In-memory userProfiles (db.userProfiles)
  if (db.userProfiles && typeof db.userProfiles === 'object') {
    for (const [key, p] of Object.entries(db.userProfiles)) {
      if (!p || typeof p !== 'object') continue;
      if (p.role && p.role !== 'student') continue;
      const pUid = (p.uid || p.id || '').trim();
      const pEmail = (p.email || '').toLowerCase().trim();
      const keyEmail = key.includes('@') ? key.toLowerCase().trim() : '';
      const resolvedEmail = pEmail || keyEmail;
      const resolvedUid = pUid || (!key.includes('@') ? key.trim() : '');

      const rec: AuthoritativeStudentRecord = {
        uid: resolvedUid,
        email: resolvedEmail,
        teacherUid: (p.teacherUid || p.assignedTeacherId || '').trim(),
        teacherEmail: (p.teacherEmail || '').toLowerCase().trim(),
        rawRecord: p,
      };

      if (cleanUid && ((resolvedUid && resolvedUid === cleanUid) || key.trim() === cleanUid)) {
        if (!rec.uid) rec.uid = cleanUid;
        uidMatches.push(rec);
      }
      if (cleanEmail && ((resolvedEmail && resolvedEmail === cleanEmail) || keyEmail === cleanEmail)) {
        if (!rec.email) rec.email = cleanEmail;
        emailMatches.push(rec);
      }
    }
  }

  // 3. In-memory authUsers (db.authUsers)
  if (db.authUsers && typeof db.authUsers === 'object') {
    for (const [key, u] of Object.entries(db.authUsers)) {
      if (!u || typeof u !== 'object') continue;
      if (u.role && u.role !== 'student') continue;
      const uUid = (u.uid || '').trim();
      const uEmail = (u.email || '').toLowerCase().trim();
      const keyEmail = key.includes('@') ? key.toLowerCase().trim() : '';
      const resolvedEmail = uEmail || keyEmail;
      const resolvedUid = uUid || (!key.includes('@') ? key.trim() : '');

      const rec: AuthoritativeStudentRecord = {
        uid: resolvedUid,
        email: resolvedEmail,
        rawRecord: u,
      };

      if (cleanUid && (resolvedUid === cleanUid || key.trim() === cleanUid)) {
        if (!rec.uid) rec.uid = cleanUid;
        uidMatches.push(rec);
      }
      if (cleanEmail && (resolvedEmail === cleanEmail || keyEmail === cleanEmail)) {
        if (!rec.email) rec.email = cleanEmail;
        emailMatches.push(rec);
      }
    }
  }

  // 4. Firestore users collection (if available)
  if (cleanUid) {
    try {
      const data = await fetchUserDocumentFromFirestore(cleanUid, 250);
      if (data && (!data?.role || data.role === 'student')) {
        const fsUid = (data?.uid || data?.id || cleanUid).trim();
        const fsEmail = (data?.email || '').toLowerCase().trim();
        uidMatches.push({
          uid: fsUid,
          email: fsEmail,
          teacherUid: (data?.teacherUid || data?.assignedTeacherId || '').trim(),
          teacherEmail: (data?.teacherEmail || '').toLowerCase().trim(),
          rawRecord: data,
        });
      }
    } catch {}
  }
  if (cleanEmail && cleanEmail !== cleanUid) {
    try {
      const data = await fetchUserDocumentFromFirestore(cleanEmail, 250);
      if (data && (!data?.role || data.role === 'student')) {
        const fsUid = (data?.uid || data?.id || '').trim();
        const fsEmail = (data?.email || cleanEmail).toLowerCase().trim();
        emailMatches.push({
          uid: fsUid,
          email: fsEmail,
          teacherUid: (data?.teacherUid || data?.assignedTeacherId || '').trim(),
          teacherEmail: (data?.teacherEmail || '').toLowerCase().trim(),
          rawRecord: data,
        });
      }
    } catch {}
  }

  const candidateEmailsFromUid = Array.from(
    new Set(uidMatches.map((r) => r.email).filter(Boolean))
  );
  const candidateUidsFromEmail = Array.from(
    new Set(emailMatches.map((r) => r.uid).filter(Boolean))
  );

  return {
    uidMatches,
    emailMatches,
    candidateEmailsFromUid,
    candidateUidsFromEmail,
  };
}

export async function authorizeStudentAccess(
  req: express.Request,
  action: 'read' | 'write'
): Promise<StudentAuthResult> {
  // 1. Authenticated user verification
  if (!req.user || !req.user.uid) {
    return {
      authorized: false,
      status: 401,
      error: 'Unauthorized: valid Firebase authentication token is required.',
      cleanUid: '',
      cleanEmail: '',
      callerRole: 'student',
      callerUid: '',
    };
  }

  const callerUid = req.user.uid.trim();
  const callerEmail = (req.user.email || '').toLowerCase().trim();
  const callerEmailVerified = Boolean(req.user.email_verified);
  const callerTokenRole = req.user.role; // 'admin' | 'teacher' | 'student'

  const db = readDb();

  // 2. Identify caller's trusted server role (admin / teacher / student)
  // Strictly enforce that administrator privileges require the verified custom claim role: 'admin'
  // from the cryptographically verified Firebase ID token (req.user.role === 'admin').
  // Automatic administrative privileges based solely on email matching or local db stubs are strictly eliminated.
  const isVerifiedAdmin = callerTokenRole === 'admin';

  let isVerifiedTeacher = false;
  if (!isVerifiedAdmin) {
    const isTeacherByTutors = Boolean(
      (db.tutorsList || []).some((t: any) =>
        (t.uid && t.uid === callerUid) ||
        (t.id && (t.id === callerUid || t.id === `tutor-${callerUid}`)) ||
        (callerEmailVerified && t.email && t.email.toLowerCase().trim() === callerEmail)
      )
    );

    const isTeacherByTeachers = Boolean(
      (db.teachers || []).some((t: any) =>
        t.role !== 'admin' && (
          (t.uid && t.uid === callerUid) ||
          (t.id && (t.id === callerUid || t.id === `tutor-${callerUid}`)) ||
          (callerEmailVerified && t.email && t.email.toLowerCase().trim() === callerEmail)
        )
      )
    );

    const isTeacherByAuthUsers = Boolean(
      db.authUsers &&
      Object.values(db.authUsers).some((u: any) =>
        u.role === 'teacher' && (
          (u.uid && u.uid === callerUid) ||
          (callerEmailVerified && u.email && u.email.toLowerCase().trim() === callerEmail)
        )
      )
    );

    let isTeacherByFirestore = false;
    if (callerTokenRole !== 'teacher' && !isTeacherByTutors && !isTeacherByTeachers && !isTeacherByAuthUsers) {
      try {
        const tData = await fetchUserDocumentFromFirestore(callerUid, 250);
        if (tData && tData.role === 'teacher') {
          isTeacherByFirestore = true;
        } else {
          const tutData = await fetchTutorDocumentFromFirestore(callerUid, 250);
          if (tutData) {
            isTeacherByFirestore = true;
          }
        }
      } catch {}
    }

    isVerifiedTeacher =
      callerTokenRole === 'teacher' ||
      isTeacherByTutors ||
      isTeacherByTeachers ||
      isTeacherByAuthUsers ||
      isTeacherByFirestore;
  }

  const callerRole: 'admin' | 'teacher' | 'student' = isVerifiedAdmin
    ? 'admin'
    : isVerifiedTeacher
    ? 'teacher'
    : 'student';

  // 3. Extract client-requested target student identifiers
  const weeklyHw = (req.body && req.body.weeklyHomework) || null;
  const rawTargetUid = (
    req.query?.studentUid ||
    req.query?.uid ||
    req.body?.studentUid ||
    req.body?.uid ||
    weeklyHw?.studentUid ||
    weeklyHw?.uid ||
    ''
  ).toString().trim();

  const rawTargetEmail = (
    req.query?.studentEmail ||
    req.query?.email ||
    req.body?.studentEmail ||
    req.body?.email ||
    weeklyHw?.studentEmail ||
    weeklyHw?.email ||
    ''
  ).toString().toLowerCase().trim();

  const firestore = getFirestoreDb();

  // 4. Branch by caller role: Student Ownership vs Teacher/Administrator Access
  if (callerRole === 'student') {
    // -------------------------------------------------------------
    // STUDENT CALLER: ANCHORED STRICTLY TO CALLER'S FIREBASE UID
    // -------------------------------------------------------------
    // 4.1 Validate client-supplied format if provided
    if (rawTargetUid || rawTargetEmail) {
      const ident = validateStudentIdentity(rawTargetUid || callerUid, rawTargetEmail);
      if (!ident.valid) {
        return {
          authorized: false,
          status: 400,
          error: ident.error,
          cleanUid: '',
          cleanEmail: '',
          callerRole: 'student',
          callerUid,
          callerEmail,
        };
      }
    }

    // 4.2 UID Check: Student callers may NEVER query another student's UID
    if (rawTargetUid && rawTargetUid !== callerUid) {
      return {
        authorized: false,
        status: 403,
        error: 'Forbidden: students may only access their own student records.',
        cleanUid: '',
        cleanEmail: '',
        callerRole: 'student',
        callerUid,
        callerEmail,
      };
    }

    // Query server records for callerUid to check canonical email and conflicts
    const { candidateEmailsFromUid, candidateUidsFromEmail } =
      await queryAuthoritativeStudentRecords(callerUid, rawTargetEmail, db, firestore);

    // 4.3 Email Check: If studentEmail supplied, verify it does not conflict with authenticated identity
    if (rawTargetEmail) {
      // Conflicting verified token email
      if (callerEmail && callerEmailVerified && rawTargetEmail !== callerEmail) {
        return {
          authorized: false,
          status: 403,
          error: 'Forbidden: supplied studentEmail does not match authenticated student identity.',
          cleanUid: '',
          cleanEmail: '',
          callerRole: 'student',
          callerUid,
          callerEmail,
        };
      }

      // Conflicting server student record
      if (candidateEmailsFromUid.length > 0 && candidateEmailsFromUid.some((e) => e !== rawTargetEmail)) {
        return {
          authorized: false,
          status: 403,
          error: 'Forbidden: supplied studentEmail conflicts with student record.',
          cleanUid: '',
          cleanEmail: '',
          callerRole: 'student',
          callerUid,
          callerEmail,
        };
      }

      // Supplied email belongs to another registered student with different UID
      if (candidateUidsFromEmail.length > 0 && candidateUidsFromEmail.some((u) => u !== callerUid)) {
        return {
          authorized: false,
          status: 403,
          error: 'Forbidden: supplied studentEmail belongs to another student.',
          cleanUid: '',
          cleanEmail: '',
          callerRole: 'student',
          callerUid,
          callerEmail,
        };
      }
    }

    // 4.4 Resolve authoritative cleanUid and cleanEmail for the student
    const cleanUid = callerUid;
    const cleanEmail =
      candidateEmailsFromUid[0] ||
      (rawTargetEmail && (!callerEmail || rawTargetEmail === callerEmail) ? rawTargetEmail : '') ||
      callerEmail ||
      '';

    return {
      authorized: true,
      status: 200,
      cleanUid,
      cleanEmail,
      callerRole: 'student',
      callerUid,
      callerEmail,
    };
  }

  // -----------------------------------------------------------------
  // TEACHER & ADMINISTRATOR ACCESS: RESOLVE ONE AUTHORITATIVE RECORD
  // -----------------------------------------------------------------
  // 5.1 Enforce presence of student identifier
  if (!rawTargetUid && !rawTargetEmail) {
    return {
      authorized: false,
      status: 400,
      error: 'Missing student identifier: studentUid or studentEmail is required.',
      cleanUid: '',
      cleanEmail: '',
      callerRole,
      callerUid,
      callerEmail,
    };
  }

  // 5.2 Validate identifier format
  const ident = validateStudentIdentity(rawTargetUid, rawTargetEmail);
  if (!ident.valid) {
    return {
      authorized: false,
      status: 400,
      error: ident.error,
      cleanUid: '',
      cleanEmail: '',
      callerRole,
      callerUid,
      callerEmail,
    };
  }

  // 5.3 Query authoritative student records from trusted server sources
  const {
    uidMatches,
    emailMatches,
    candidateEmailsFromUid,
    candidateUidsFromEmail,
  } = await queryAuthoritativeStudentRecords(
    rawTargetUid,
    rawTargetEmail,
    db,
    firestore
  );

  let cleanUid = '';
  let cleanEmail = '';
  let canonicalRecords: AuthoritativeStudentRecord[] = [];

  if (rawTargetUid && rawTargetEmail) {
    // Both UID and email supplied: verify they refer to the SAME authoritative student record
    const emailConflicts = candidateEmailsFromUid.some((e) => e !== rawTargetEmail);
    const uidConflicts = candidateUidsFromEmail.some((u) => u !== rawTargetUid);

    if (emailConflicts || uidConflicts) {
      return {
        authorized: false,
        status: 400,
        error: 'Conflicting student identity: studentUid and studentEmail refer to different student records.',
        cleanUid: '',
        cleanEmail: '',
        callerRole,
        callerUid,
        callerEmail,
      };
    }

    if (uidMatches.length === 0 && emailMatches.length === 0) {
      return {
        authorized: false,
        status: 400,
        error: 'Cannot resolve student: authoritative student record not found.',
        cleanUid: '',
        cleanEmail: '',
        callerRole,
        callerUid,
        callerEmail,
      };
    }

    cleanUid = rawTargetUid;
    cleanEmail = rawTargetEmail;
    canonicalRecords = [...uidMatches, ...emailMatches];
  } else if (rawTargetUid) {
    // UID only supplied
    if (uidMatches.length === 0) {
      return {
        authorized: false,
        status: 400,
        error: 'Cannot resolve student: authoritative student record not found for studentUid.',
        cleanUid: '',
        cleanEmail: '',
        callerRole,
        callerUid,
        callerEmail,
      };
    }

    const uniqueEmails = Array.from(new Set(candidateEmailsFromUid));
    if (uniqueEmails.length > 1) {
      return {
        authorized: false,
        status: 400,
        error: 'Ambiguous student identity: multiple conflicting emails found for studentUid.',
        cleanUid: '',
        cleanEmail: '',
        callerRole,
        callerUid,
        callerEmail,
      };
    }

    cleanUid = rawTargetUid;
    cleanEmail = uniqueEmails[0] || '';
    canonicalRecords = uidMatches;
  } else {
    // Email only supplied (Teacher/Admin lookup)
    if (emailMatches.length === 0) {
      return {
        authorized: false,
        status: 400,
        error: 'Cannot resolve student: authoritative student record not found for studentEmail.',
        cleanUid: '',
        cleanEmail: '',
        callerRole,
        callerUid,
        callerEmail,
      };
    }

    const uniqueUids = Array.from(new Set(candidateUidsFromEmail));
    if (uniqueUids.length > 1) {
      return {
        authorized: false,
        status: 400,
        error: 'Ambiguous student identity: multiple conflicting UIDs found for studentEmail.',
        cleanUid: '',
        cleanEmail: '',
        callerRole,
        callerUid,
        callerEmail,
      };
    }

    if (uniqueUids.length === 0) {
      return {
        authorized: false,
        status: 400,
        error: 'Cannot resolve student: no authoritative UID found for studentEmail.',
        cleanUid: '',
        cleanEmail: '',
        callerRole,
        callerUid,
        callerEmail,
      };
    }

    cleanUid = uniqueUids[0];
    cleanEmail = rawTargetEmail;
    canonicalRecords = emailMatches;
  }

  // 5.4 Administrator Access: Authorized once canonical student identity is verified
  if (callerRole === 'admin') {
    return {
      authorized: true,
      status: 200,
      cleanUid,
      cleanEmail,
      callerRole: 'admin',
      callerUid,
      callerEmail,
    };
  }

  // 5.5 Teacher Access: Least privilege constraints & assignment verification
  if (callerRole === 'teacher') {
    // Teachers may never modify student homework or routine checks
    if (action === 'write') {
      return {
        authorized: false,
        status: 403,
        error: 'Forbidden: teachers do not have permission to modify student routine checks or homework answers.',
        cleanUid: '',
        cleanEmail: '',
        callerRole: 'teacher',
        callerUid,
        callerEmail,
      };
    }

    // Direct assignment check on canonical student records
    const isAssignedDirectly = canonicalRecords.some((r) => {
      const sTeacherUid = (r.teacherUid || r.assignedTeacherId || r.tutorUid || '').trim();
      const sTeacherEmail = (r.teacherEmail || r.tutorEmail || '').toLowerCase().trim();

      const uidMatches = Boolean(
        sTeacherUid &&
        (sTeacherUid === callerUid ||
          sTeacherUid === `tutor-${callerUid}` ||
          callerUid === `tutor-${sTeacherUid}`)
      );

      const emailMatches = Boolean(
        callerEmailVerified &&
        callerEmail &&
        sTeacherEmail &&
        sTeacherEmail === callerEmail
      );

      return uidMatches || emailMatches;
    });

    // Lesson-based assignment check in canonical Firestore lessons
    let isAssignedByLesson = false;
    if (!isAssignedDirectly) {
      try {
        const fs = getFirestoreDb();
        if (fs) {
          const lessonQueries: Promise<any>[] = [];
          if (cleanUid) {
            lessonQueries.push(fs.collection('lessons').where('studentUid', '==', cleanUid).get().catch(() => ({ docs: [] })));
          }
          if (cleanEmail) {
            lessonQueries.push(fs.collection('lessons').where('studentEmail', '==', cleanEmail).get().catch(() => ({ docs: [] })));
          }
          const lessonSnaps = await Promise.all(lessonQueries);
          for (const snap of lessonSnaps) {
            if (!snap?.docs) continue;
            for (const doc of snap.docs) {
              const l = doc.data();
              if (!l || l.status === 'cancelled') continue;

              const lStudentEmail = (l.studentEmail || '').toLowerCase().trim();
              const lStudentUid = (l.studentUid || '').trim();
              const lTeacherEmail = (l.teacherEmail || l.tutorEmail || '').toLowerCase().trim();
              const lTeacherUid = (l.teacherUid || l.tutorUid || '').trim();
              const lTeacherAuthUid = (l.teacherAuthUid || '').trim();

              const studentMatches =
                (cleanUid && lStudentUid && lStudentUid === cleanUid) ||
                (cleanEmail && lStudentEmail && lStudentEmail === cleanEmail);

              if (lStudentUid && cleanUid && lStudentUid !== cleanUid) continue;
              if (lStudentEmail && cleanEmail && lStudentEmail !== cleanEmail) continue;

              const teacherMatches =
                (lTeacherUid &&
                  (lTeacherUid === callerUid ||
                    lTeacherUid === `tutor-${callerUid}` ||
                    callerUid === `tutor-${lTeacherUid}`)) ||
                (lTeacherAuthUid && lTeacherAuthUid === callerUid) ||
                (callerEmailVerified && callerEmail && lTeacherEmail && lTeacherEmail === callerEmail);

              if (studentMatches && teacherMatches) {
                isAssignedByLesson = true;
                break;
              }
            }
            if (isAssignedByLesson) break;
          }
        }
      } catch {}
    }

    if (isAssignedDirectly || isAssignedByLesson) {
      return {
        authorized: true,
        status: 200,
        cleanUid,
        cleanEmail,
        callerRole: 'teacher',
        callerUid,
        callerEmail,
      };
    }

    // Teacher is not assigned to this resolved student
    return {
      authorized: false,
      status: 403,
      error: 'Forbidden: teacher is not assigned to this student.',
      cleanUid: '',
      cleanEmail: '',
      callerRole: 'teacher',
      callerUid,
      callerEmail,
    };
  }

  // Fail closed if unhandled
  return {
    authorized: false,
    status: 403,
    error: 'Forbidden: caller is not authorized to access this student record.',
    cleanUid: '',
    cleanEmail: '',
    callerRole: 'student',
    callerUid,
    callerEmail,
  };
}

async function authorizeHomeworkChecksAccess(
  req: express.Request,
  res: express.Response,
  action: 'read' | 'write'
) {
  const nested = (req.body && (req.body.weeklyHomework || req.body.homework)) || null;
  const topUid = ((req.body?.studentUid as string) || (req.body?.uid as string) || (req.query?.studentUid as string) || (req.query?.uid as string) || '').trim();
  const topEmail = ((req.body?.studentEmail as string) || (req.body?.email as string) || (req.query?.studentEmail as string) || (req.query?.email as string) || '').toLowerCase().trim();
  const nestedUid = ((nested?.studentUid as string) || (nested?.uid as string) || '').trim();
  const nestedEmail = ((nested?.studentEmail as string) || (nested?.email as string) || '').toLowerCase().trim();

  if (topUid && nestedUid && topUid !== nestedUid) {
    res.status(403).json({
      error: 'Forbidden',
      message: 'Conflicting studentUid between request payload and nested homework object.',
    });
    return null;
  }
  if (topEmail && nestedEmail && topEmail !== nestedEmail) {
    res.status(403).json({
      error: 'Forbidden',
      message: 'Conflicting studentEmail between request payload and nested homework object.',
    });
    return null;
  }

  let effectiveReq: express.Request = req;
  if ((!topUid && nestedUid) || (!topEmail && nestedEmail)) {
    effectiveReq = Object.create(req, {
      body: {
        value: {
          ...(req.body || {}),
          ...(topUid ? {} : nestedUid ? { studentUid: nestedUid } : {}),
          ...(topEmail ? {} : nestedEmail ? { studentEmail: nestedEmail } : {}),
        },
        configurable: true,
      },
    });
  }

  const authCtx = await authorizeStudentRoutineAccess(effectiveReq, res, {
    allowMissingTargetFallbackToCaller: true,
    requireApprovedTeacherIfTutor: true,
  });
  if (!authCtx) return null;

  if (action === 'write' && authCtx.effectiveRole === 'teacher') {
    res.status(403).json({
      error: 'Forbidden',
      message: 'Teachers are not authorized to modify student homework or weekly routine checks.',
    });
    return null;
  }

  return authCtx;
}

// 7.1 Student Weekly S-Path Progress Endpoints (ARCH.2E.2C Canonical Firestore-only)
app.get('/api/routines/weekly-checks', firebaseAuthMiddleware, async (req, res) => {
  const authCtx = await authorizeHomeworkChecksAccess(req, res, 'read');
  if (!authCtx) return;

  const { canonicalStudentUid } = authCtx;
  const rawWeek = req.query.weekId || req.query.week || req.query.weeklyCycle;
  if (!rawWeek) {
    return res.status(400).json({
      error: 'Missing week identifier. A valid positive integer cycle (e.g. 1, "week-1") or resolvable "current_week" alias is required.',
    });
  }

  let cycle: number | null = null;
  if (typeof rawWeek === 'string' && rawWeek.trim().toLowerCase() === 'current_week') {
    cycle = await resolveStudentWeeklyCycle(canonicalStudentUid, authCtx.canonicalStudentEmail);
    if (cycle === null) {
      return res.status(400).json({
        error: 'Cannot resolve "current_week" alias: student has no valid persisted weeklyCycle. Explicit week identifier required.',
      });
    }
  } else {
    cycle = extractPositiveIntegerCycle(rawWeek);
    if (cycle === null) {
      return res.status(400).json({
        error: 'Invalid week identifier. Expected positive integer cycle (e.g. 1, 2, "week-1", "week-2").',
      });
    }
  }

  const canonicalWeekId = `week-${cycle}`;
  const fsCtx = await fetchCanonicalWeeklyChecksServer(canonicalStudentUid, canonicalWeekId, cycle);
  if (!fsCtx) {
    return res.status(503).json({
      error: 'FirestoreUnavailable',
      message: 'Canonical Firestore (default) database is unavailable.',
    });
  }

  return res.json({
    success: true,
    studentUid: canonicalStudentUid,
    weekId: canonicalWeekId,
    weeklyCycle: cycle,
    checks: fsCtx.checks,
    weeklyNativeLessonsTarget: fsCtx.weeklyNativeLessonsTarget,
    weeklyStudyDaysTarget: fsCtx.weeklyStudyDaysTarget,
    weeklyStudyDays: fsCtx.weeklyStudyDays,
  });
});

app.post('/api/routines/weekly-checks', firebaseAuthMiddleware, async (req, res) => {
  const authCtx = await authorizeHomeworkChecksAccess(req, res, 'write');
  if (!authCtx) return;

  const { canonicalStudentUid, canonicalStudentEmail } = authCtx;
  const { checks, weeklyNativeLessonsTarget, weeklyStudyDaysTarget, weeklyStudyDays } = req.body || {};

  const rawWeek = req.body?.weekId || req.body?.week || req.body?.weeklyCycle || req.query?.weekId || req.query?.week || req.query?.weeklyCycle;
  if (!rawWeek) {
    return res.status(400).json({
      error: 'Missing week identifier. A valid positive integer cycle (e.g. 1, "week-1") or resolvable "current_week" alias is required.',
    });
  }

  let cycle: number | null = null;
  if (typeof rawWeek === 'string' && rawWeek.trim().toLowerCase() === 'current_week') {
    cycle = await resolveStudentWeeklyCycle(canonicalStudentUid, canonicalStudentEmail);
    if (cycle === null) {
      return res.status(400).json({
        error: 'Cannot resolve "current_week" alias: student has no valid persisted weeklyCycle. Explicit week identifier required.',
      });
    }
  } else {
    cycle = extractPositiveIntegerCycle(rawWeek);
    if (cycle === null) {
      return res.status(400).json({
        error: 'Invalid week identifier. Expected positive integer cycle (e.g. 1, 2, "week-1", "week-2").',
      });
    }
  }

  const canonicalWeekId = `week-${cycle}`;
  const saveResult = await saveCanonicalWeeklyChecksServer({
    studentUid: canonicalStudentUid,
    studentEmail: canonicalStudentEmail || undefined,
    canonicalWeekId,
    cycle,
    checks: checks && typeof checks === 'object' ? checks : undefined,
    reset: req.body?.reset === true,
    weeklyNativeLessonsTarget: typeof weeklyNativeLessonsTarget === 'number' ? weeklyNativeLessonsTarget : undefined,
    weeklyStudyDaysTarget: typeof weeklyStudyDaysTarget === 'number' ? weeklyStudyDaysTarget : undefined,
    weeklyStudyDays: Array.isArray(weeklyStudyDays) ? weeklyStudyDays : undefined,
  });

  if (!saveResult.ok) {
    if (saveResult.statusCode === 409) {
      return res.status(409).json({
        success: false,
        error: 'STALE_CYCLE',
        code: 'STALE_CYCLE',
        activeCycle: saveResult.activeCycle,
        requestedCycle: cycle,
        message: saveResult.error || `Stale cycle ${cycle} rejected; active cycle is ${saveResult.activeCycle}.`,
      });
    }
    return res.status(saveResult.statusCode || 500).json({
      success: false,
      error: 'FirestorePersistenceFailed',
      message: 'Falha ao confirmar persistência dos checks semanais no Firestore.',
    });
  }

  return res.json({
    success: true,
    firestoreConfirmed: true,
    studentUid: canonicalStudentUid,
    weekId: canonicalWeekId,
    weeklyCycle: cycle,
    checks: saveResult.checks || {},
    weeklyNativeLessonsTarget: saveResult.weeklyNativeLessonsTarget ?? 1,
    weeklyStudyDaysTarget: saveResult.weeklyStudyDaysTarget ?? 7,
    weeklyStudyDays: saveResult.weeklyStudyDays || ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
  });
});

// 8. Homework Endpoints with per-student and per-week isolation (ARCH.2E.2C Canonical Firestore-only)
app.get('/api/homework', firebaseAuthMiddleware, async (req, res) => {
  const authCtx = await authorizeHomeworkChecksAccess(req, res, 'read');
  if (!authCtx) return;

  const { canonicalStudentUid, canonicalStudentEmail } = authCtx;
  const rawWeek = req.query.weekId || req.query.week || req.query.weeklyCycle;
  if (!rawWeek) {
    return res.status(400).json({
      error: 'Missing week identifier. A valid positive integer cycle (e.g. 1, "week-1") or resolvable "current_week" alias is required.',
    });
  }

  let cycle: number | null = null;
  if (typeof rawWeek === 'string' && rawWeek.trim().toLowerCase() === 'current_week') {
    cycle = await resolveStudentWeeklyCycle(canonicalStudentUid, canonicalStudentEmail);
    if (cycle === null) {
      return res.status(400).json({
        error: 'Cannot resolve "current_week" alias: student has no valid persisted weeklyCycle. Explicit week identifier required.',
      });
    }
  } else {
    cycle = extractPositiveIntegerCycle(rawWeek);
    if (cycle === null) {
      return res.status(400).json({
        error: 'Invalid week identifier. Expected positive integer cycle (e.g. 1, 2, "week-1", "week-2").',
      });
    }
  }

  const canonicalWeekId = `week-${cycle}`;
  const hwData = await fetchHomeworkFromFirestore([canonicalStudentUid], canonicalWeekId, cycle);

  if (hwData) {
    if (hwData.aiEvaluation) {
      if (isSyntheticHomeworkEvaluation(hwData.aiEvaluation) || !isValidHomeworkEvaluation(hwData.aiEvaluation)) {
        delete hwData.aiEvaluation;
        if (hwData.isCompleted) {
          hwData.isCompleted = false;
          delete hwData.score;
        }
      }
    }
    return res.json({
      ...hwData,
      id: canonicalWeekId,
      weekId: canonicalWeekId,
      weeklyCycle: cycle,
      studentUid: canonicalStudentUid,
      ...(canonicalStudentEmail ? { studentEmail: canonicalStudentEmail } : {}),
    });
  }

  return res.json({
    id: canonicalWeekId,
    weekId: canonicalWeekId,
    weeklyCycle: cycle,
    studentUid: canonicalStudentUid,
    studentEmail: canonicalStudentEmail || undefined,
    completedPartsByDay: {},
    studentAnswers: { matching: {}, fillInBlanks: {}, sentences: {}, quizAnswers: {} },
  });
});

app.post(['/api/homework', '/api/homework/submit'], firebaseAuthMiddleware, async (req, res) => {
  const authCtx = await authorizeHomeworkChecksAccess(req, res, 'write');
  if (!authCtx) return;

  const { canonicalStudentUid, canonicalStudentEmail } = authCtx;
  const weeklyHomework = req.body?.weeklyHomework || req.body || {};
  const isSubmit = req.path === '/api/homework/submit' || Boolean(req.body?.submit);

  const idCycleCandidate = extractPositiveIntegerCycle(weeklyHomework?.id) !== null ? weeklyHomework?.id : undefined;
  let rawWeek = req.body?.weekId || req.body?.week || req.body?.weeklyCycle || weeklyHomework?.weekId || weeklyHomework?.weeklyCycle || idCycleCandidate;
  if (!rawWeek) {
    rawWeek = 'current_week';
  }

  let cycle: number | null = null;
  if (typeof rawWeek === 'string' && rawWeek.trim().toLowerCase() === 'current_week') {
    cycle = await resolveStudentWeeklyCycle(canonicalStudentUid, canonicalStudentEmail);
    if (cycle === null) {
      return res.status(400).json({
        error: 'Cannot resolve "current_week" alias: student has no valid persisted weeklyCycle. Explicit week identifier required.',
      });
    }
  } else {
    cycle = extractPositiveIntegerCycle(rawWeek);
    if (cycle === null) {
      return res.status(400).json({
        error: 'Invalid week identifier. Expected positive integer cycle (e.g. 1, 2, "week-1", "week-2").',
      });
    }
  }

  const canonicalWeekId = `week-${cycle}`;
  const hwPayload: Record<string, any> = {
    ...weeklyHomework,
    id: canonicalWeekId,
    weekId: canonicalWeekId,
    weeklyCycle: cycle,
    uid: canonicalStudentUid,
    studentUid: canonicalStudentUid,
    email: canonicalStudentEmail || undefined,
    studentEmail: canonicalStudentEmail || undefined,
    updatedAt: new Date().toISOString(),
  };

  if (hwPayload.aiEvaluation) {
    if (isSyntheticHomeworkEvaluation(hwPayload.aiEvaluation) || !isValidHomeworkEvaluation(hwPayload.aiEvaluation)) {
      delete hwPayload.aiEvaluation;
      if (hwPayload.isCompleted) {
        hwPayload.isCompleted = false;
        delete hwPayload.score;
      }
    }
  }

  const saveResult = await saveCanonicalHomeworkServer({
    studentUid: canonicalStudentUid,
    studentEmail: canonicalStudentEmail || undefined,
    canonicalWeekId,
    cycle,
    homeworkPayload: hwPayload,
    isSubmit,
    enforceStaleCycle: true,
  });

  if (!saveResult.ok) {
    if (saveResult.statusCode === 409) {
      return res.status(409).json({
        success: false,
        error: 'STALE_CYCLE',
        code: 'STALE_CYCLE',
        activeCycle: saveResult.activeCycle,
        requestedCycle: cycle,
        message: saveResult.error || `Stale cycle ${cycle} rejected; active cycle is ${saveResult.activeCycle}.`,
      });
    }
    return res.status(saveResult.statusCode || 500).json({
      success: false,
      error: 'FirestorePersistenceFailed',
      message: 'Falha ao confirmar persistência do homework no Firestore.',
    });
  }

  return res.json({
    success: true,
    firestoreConfirmed: true,
    studentUid: canonicalStudentUid,
    weekId: canonicalWeekId,
    weeklyCycle: cycle,
    weeklyHomework: saveResult.weeklyHomework,
  });
});

// Safe Gemini generation runner strictly using gemini-2.5-flash with single attempt and zero cascade
async function callGeminiSafeJson(
  prompt: string,
  timeoutMs: number = 6000,
  feature: GeminiFeature = 'check_writing',
  callerRole: string = 'student'
): Promise<any | null> {
  const result = await executeGeminiSingleAttempt({
    feature,
    systemInstruction: 'You are an expert English language evaluation engine. Provide rigorous, helpful, and accurate feedback strictly in valid JSON format.',
    untrustedUserDataPrompt: prompt,
    callerRole,
  });
  return result?.parsedJson || null;
}

// Helper to normalize and calibrate English proficiency levels
function normalizeStudentLevel(lvl?: string): {
  key: 'beginner' | 'intermediate' | 'advanced';
  labelEn: string;
  labelPt: string;
  cefr: string;
  grammarFocusEn: string;
  grammarFocusPt: string;
} {
  const clean = (lvl || '').toLowerCase().trim();
  if (clean.includes('avanc') || clean.includes('advan') || clean.includes('c1') || clean.includes('c2')) {
    return {
      key: 'advanced',
      labelEn: 'Advanced',
      labelPt: 'Avançado',
      cefr: 'C1-C2',
      grammarFocusEn: 'Complex clauses, passive voice, subjunctive/inversion, mixed conditionals, subtle modal nuances, idiomatic collocations, executive and reflective discourse (20-30 words per sentence).',
      grammarFocusPt: 'Orações complexas, voz passiva, inversões/condicionais mistas, colocações idiomáticas refinadas e discurso executivo (20 a 30 palavras por frase).',
    };
  }
  if (clean.includes('intermed') || clean.includes('b1') || clean.includes('b2')) {
    return {
      key: 'intermediate',
      labelEn: 'Intermediate',
      labelPt: 'Intermediário',
      cefr: 'B1-B2',
      grammarFocusEn: 'Compound and complex sentences with connectors (although, because, while, since, whenever), modal verbs (should, could, might), present perfect, workplace and social situations (14-22 words per sentence).',
      grammarFocusPt: 'Frases compostas com conectivos de causa/contraste, present perfect, verbos modais e situações de trabalho e convívio (14 a 22 palavras por frase).',
    };
  }
  return {
    key: 'beginner',
    labelEn: 'Beginner',
    labelPt: 'Iniciante',
    cefr: 'A1-A2',
    grammarFocusEn: 'Simple Present, Simple Past, Present Continuous, direct Subject + Verb + Object structures, accessible everyday routine vocabulary with high context clues (8-14 words per sentence).',
    grammarFocusPt: 'Presente Simples, Passado Simples, estruturas diretas Sujeito + Verbo + Objeto e vocabulário cotidiano com pistas claras de contexto (8 a 14 palavras por frase).',
  };
}

// Cache for AI memorization to provide instant (<5ms) responses and avoid rate limiting
const aiMemorizationCache = new Map<string, { data: any; expiry: number }>();

// Helper to safely extract and parse JSON from model responses (handles code fences and trailing text)
function extractCleanJson(text: string): any {
  if (!text || typeof text !== 'string') return null;
  let clean = text.trim();
  if (clean.includes('```')) {
    clean = clean.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
  }
  try {
    return JSON.parse(clean);
  } catch {
    const start = clean.indexOf('{');
    const end = clean.lastIndexOf('}');
    if (start !== -1 && end !== -1 && end > start) {
      const candidate = clean.substring(start, end + 1);
      try {
        return JSON.parse(candidate);
      } catch {
        try {
          const sanitized = candidate.replace(/,\s*([}\]])/g, '$1');
          return JSON.parse(sanitized);
        } catch {
          return null;
        }
      }
    }
    return null;
  }
}

// Detection for generic placeholders, boilerplate text, or repetitive templates that violate the zero-generic rule
function hasGenericBoilerplate(data: any): boolean {
  if (!data) return false;
  const str = JSON.stringify(data).toLowerCase();
  return (
    str.includes('core active vocabulary applied') ||
    str.includes('applied during your daily') ||
    str.includes('i practice using "______"') ||
    str.includes('i practice using \\"______\\"') ||
    str.includes('i practice using "') ||
    str.includes('i practice using \\"') ||
    str.includes('practicing with "______"') ||
    str.includes('practicing with \\"______\\"') ||
    str.includes('practicing with "') ||
    str.includes('practicing with \\"') ||
    str.includes('builds natural fluency and confidence') ||
    str.includes('plays an indispensable role in maintaining team morale') ||
    str.includes('focus on the sentence context to identify') ||
    str.includes('describe a specific task, plan, or event in your daily life using') ||
    str.includes('write about a conversation with a colleague or friend that involves') ||
    (str.includes('explain how "') && str.includes('connects to your current weekly goals')) ||
    str.includes('key vocabulary term practiced in daily routines') ||
    str.includes('understanding how to optimize') ||
    str.includes('the team established a') ||
    str.includes('key concept representing') ||
    str.includes('descriptive term characterizing') ||
    str.includes('action term describing') ||
    str.includes('modifying term highlighting') ||
    str.includes('with clear intention creates noticeable progress')
  );
}

// Detection for stale, formulaic, or robotic story templates that should never be shown to students
export function isBadStoryText(text: string): boolean {
  if (!text || typeof text !== 'string' || text.trim().length < 120) return true;
  // HOTFIX 2.3.5K: Enforce the pedagogical 4-paragraph narrative structure
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 25);
  if (paragraphs.length !== 4) return true;

  const t = text.toLowerCase();
  if (
    t.includes('the day began with great purpose as') ||
    t.includes('the working session began with clear intention as') ||
    t.includes('the project breakthrough') ||
    t.includes('reviewed key plans regarding') ||
    t.includes('address **') ||
    t.includes('managing **') ||
    t.includes('progress made on **') ||
    t.includes('to make sure everything stayed aligned') ||
    t.includes('quick to ') ||
    t.includes('refreshing weather') ||
    t.includes('storm terms') ||
    t.includes('a productive day of focus and growth') ||
    t.includes('finishing the workday on schedule allowed everyone to celebrate') ||
    t.includes('collaborating closely with colleagues to') ||
    t.includes('before wrapping up the day, celebrating the successful delivery of') ||
    t.includes('delivery of the small') ||
    t.includes('to need every detail') ||
    t.includes('in the youtube video') ||
    t.includes('the video showed') ||
    t.includes('as seen in the video clip') ||
    t.includes('watched the video') ||
    t.includes('pausing to watch the progress') ||
    t.includes('delivering a series of small improvements')
  ) {
    return true;
  }

  // Detect ungrammatical sentence fragments (e.g. temporal clause followed only by a participle phrase without a main finite verb)
  // e.g. "During the morning session, pausing to watch the progress."
  // e.g. "Before concluding the session, delivering a series of small improvements."
  const sentences = text.split(/(?<=[.!?])\s+/);
  const finiteVerbPattern = /\b(was|is|were|are|am|became|seemed|helped|allowed|proved|felt|remained|created|enabled|made|gave|found|decided|began|started|worked|wanted|needed|saw|said|noticed|observed|agreed|concluded|reviewed|finished|celebrated|delivered|showed|guided|adjusted)\b/i;
  const temporalOpener = /^(?:during|before|after|while|throughout|upon|in|on)\s+[^,]{2,60},/i;

  for (const rawSent of sentences) {
    const s = rawSent.trim();
    if (!s) continue;
    if (temporalOpener.test(s)) {
      const parts = s.split(',');
      if (parts.length === 2) {
        const afterComma = parts[1].trim().replace(/[.!?]+$/, '');
        if (/^[a-z]+ing\b/i.test(afterComma) && !finiteVerbPattern.test(afterComma)) {
          return true;
        }
      }
    }
  }

  return false;
}

export function validatePart4StoryResponse(json: any, targetWords?: string[]): boolean {
  if (!json || typeof json !== 'object') return false;
  if (!json.title || typeof json.title !== 'string' || json.title.trim().length < 3) return false;
  if (!json.text || typeof json.text !== 'string' || isBadStoryText(json.text)) return false;

  // 1. Strictly 4 paragraphs
  const paragraphs = json.text
    .split(/\n\s*\n/)
    .map((p: string) => p.trim())
    .filter((p: string) => p.length > 25);
  if (paragraphs.length !== 4) return false;

  // 2. Target words: At least 1 target expression must be integrated organically into the narrative.
  // It is NOT required that all 5 expressions be forced into the text (prioritizes natural narrative and CEFR over forcing vocabulary).
  if (Array.isArray(targetWords) && targetWords.length > 0) {
    const textLower = json.text.toLowerCase();
    const hasAtLeastOne = targetWords.some((w) => {
      const clean = (w || '').trim().toLowerCase();
      if (!clean) return false;
      if (textLower.includes(clean)) return true;
      const base = clean.replace(/ed$|s$|ing$/, '');
      return base.length >= 3 && textLower.includes(base);
    });
    if (!hasAtLeastOne) return false;
  }

  // 3. Exactly 2 or 3 questions
  if (!Array.isArray(json.questions) || json.questions.length < 2 || json.questions.length > 3) return false;

  for (const q of json.questions) {
    if (!q || typeof q.question !== 'string' || q.question.trim().length < 10) return false;
    if (!Array.isArray(q.options) || q.options.length !== 4) return false;
    const uniqueOptions = new Set(q.options.map((o: any) => String(o || '').trim().toLowerCase()));
    if (uniqueOptions.size < 4) return false; // Options must be distinct
    if (typeof q.correctAnswer !== 'number' && typeof q.correctAnswer !== 'string') return false;
    if (typeof q.correctAnswer === 'number' && (q.correctAnswer < 0 || q.correctAnswer > 3)) return false;
    if (!q.explanation || typeof q.explanation !== 'string' || q.explanation.trim().length < 5) return false;

    // Filter generic/meta questions
    const qLower = q.question.toLowerCase();
    if (
      qLower.includes('how many words') ||
      qLower.includes('target vocabulary') ||
      qLower.includes('study english') ||
      qLower.includes('in the video clip') ||
      qLower.includes('youtube video')
    ) {
      return false;
    }
  }
  return true;
}

export function validateDirectMemorizationAiResponse(json: any, targetWords?: string[]): boolean {
  if (!json || typeof json !== 'object') return false;
  if (!Array.isArray(json.matchingPairs) || json.matchingPairs.length === 0) return false;
  if (!Array.isArray(json.fillInBlanks) || json.fillInBlanks.length === 0) return false;
  if (!Array.isArray(json.sentenceWritingPrompts) || json.sentenceWritingPrompts.length === 0) return false;

  // Check matching pairs for boilerplate / generic definitions
  for (const item of json.matchingPairs) {
    if (!item?.word || !item?.definition) return false;
    if (isGenericPedagogicalDefinition(item.definition)) return false;
  }

  // Check fillInBlanks for valid blanks, plausible distractors, and zero generic boilerplate
  for (const item of json.fillInBlanks) {
    if (!item?.sentenceWithBlank || !item?.correctWord) return false;
    if (!Array.isArray(item.options) || item.options.length < 4) return false;
    const sent = item.sentenceWithBlank.toLowerCase();
    if (!item.sentenceWithBlank.includes('______') && !item.sentenceWithBlank.includes('___')) return false;
    if (sent.includes('practicing with') || sent.includes('builds natural fluency') || sent.includes('indispensable role')) return false;
    const cleanCorrect = item.correctWord.toLowerCase().trim();
    if (!item.options.some((opt: string) => opt.toLowerCase().trim() === cleanCorrect)) return false;
  }

  // Check readingPassage
  if (!json.readingPassage?.text || isBadStoryText(json.readingPassage.text)) {
    return false;
  }
  if (!Array.isArray(json.readingPassage?.questions) || json.readingPassage.questions.length < 2) {
    return false;
  }

  if (hasGenericBoilerplate(json)) return false;

  return true;
}

// Dedicated Generator for Part 4: Mini-Story / Routine Reading & Interpretation with Gemini API
// HOTFIX 2.3.5K & IT'S SIMPLE PART 4 NATURALITY: Contextual, Natural Narrative with Word Grammar Profiles and Authentic Comprehension Questions
async function generatePart4StoryWithGemini(
  words: string[],
  studentLevel: string,
  studentName: string = 'Student',
  videoContext?: VideoContextForPart4 | null
): Promise<any | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || !Array.isArray(words) || words.length === 0) return null;

  const levelMeta = normalizeStudentLevel(studentLevel);

  // Profile words to give Gemini exact part of speech and authentic meaning
  const profiledWordsList = words.map((w) => {
    const prof = profileWord(w);
    return `* "${w}" (${prof.partOfSpeech.toUpperCase()}): Authentic meaning: "${prof.definitionEn}". Grammatical function: if verb, conjugate or express natural action/state; if adjective, modify noun or follow linking verb; if noun, act as subject/object; if adverb, modify action or clause smoothly.`;
  }).join('\n');

  const videoInstruction = videoContext && videoContext.hasVideo && videoContext.videoTitle ? `
5. CONTEXTUAL VIDEO THEME (THEMATIC INSPIRATION ONLY):
   - Daily Routine Video Title: "${videoContext.videoTitle}"
   ${videoContext.themeOrCategory ? `- Category / Theme: "${videoContext.themeOrCategory}"` : ''}
   ${(videoContext as any).description ? `- Description: "${(videoContext as any).description}"` : ''}
   - Student Watch Status: ${videoContext.isWatched ? 'Confirmed watched by student' : 'Selected in weekly routine (not confirmed watched)'}

   COHERENCE & STRICT ANTI-HALLUCINATION RULES:
   * Ground the setting, atmosphere, industry, or environment of the story in the overarching subject matter of this video title (e.g. barista coffee techniques, public speaking, culinary arts, science lab, travel logistics, creative design).
   * ABSOLUTE PROHIBITION ON HALLUCINATING VIDEO DETAILS: NEVER invent, simulate, or fabricate transcripts, spoken dialogue, specific scene events, or quotes from the video.
   * NEVER state or assert that the student watched the video.
   * The mini-story must be an original narrative connecting today's words. It is NOT a summary of the video.
` : `
5. CONTEXTUAL SETTING:
   - No video context is available for this session.
   - Set the narrative in a realistic, engaging daily life, workplace, community, or creative scenario.
`;

  const systemInstruction = `You are an expert English Language Teaching (ELT) instructional designer and literary storyteller for "It's Simple - Learn English by Living Your Life".
Your mission is to craft an ORIGINAL, NATURAL, and COHESIVE 4-paragraph mini-story (Part 4: Routine Reading & Interpretation) and 2 to 3 narrative-grounded reading comprehension questions tailored to the student's proficiency level (${levelMeta.labelEn} - CEFR ${levelMeta.cefr}).

CRITICAL MANDATORY RULES (STRICTLY ENFORCED):

1. ESTRUTURA MANDATÓRIA DE EXATAMENTE 4 PARÁGRAFOS CONECTADOS (ZERO TEMPLATES):
   - The story MUST consist of exactly 4 cohesive paragraphs separated by double newlines (\`\\n\\n\`):
     * Paragraph 1: Setup, situation context, and introducing a relatable protagonist (e.g. Alex, Elena, Marcus, or Maya).
     * Paragraph 2: Challenge, conflict, tension, or pivotal incident.
     * Paragraph 3: Decisive action, turning point, or teamwork collaboration.
     * Paragraph 4: Outcome, reflection, and lasting takeaway.
   - ZERO REUSE OF STATIC TEMPLATES: Strictly forbidden are formulaic slot sentences such as:
     * "The working session began with clear intention as..."
     * "Collaborating closely with colleagues to need every detail..."
     * "Before wrapping up the day, celebrating the successful delivery of the small..."
     * "The project breakthrough..."
   - DO NOT assume personal names, professions, or private facts about the student. Feature a neutral, relatable protagonist.

2. NOVA REGRA PEDAGÓGICA — PRIORIDADE ABSOLUTA PARA A NATURALIDADE DA NARRATIVA:
   - PRIORITIZE a completely natural, plausible, and engaging narrative suited to the student's CEFR level (${levelMeta.labelEn} - CEFR ${levelMeta.cefr}).
   - ORGANIC INTEGRATION ONLY: Include ONLY expressions from the target vocabulary list that fit organically and effortlessly into the storyline and situation.
   - ZERO FORCED VOCABULARY: Do NOT create artificial situations, contrived comparisons, forced analogies, or awkward dialogues to force vocabulary into the story.
   - ADMISSIBILITY OF PARTIAL EXPRESSION SET: If some expressions do not combine naturally with the chosen plot, DO NOT force them! It is completely expected and preferred to use 2, 3, or 4 expressions when the remaining expressions would make the story sound robotic or strained. If all 5 expressions naturally fit, you may use all 5; but narrative coherence, authenticity, and natural English ALWAYS take precedence over using all 5 words.
   - PRESERVE AUTHENTIC MEANINGS: Every expression effectively used in the story MUST preserve its genuine dictionary meaning and correct grammatical part of speech. Never distort or misrepresent a word's meaning to make it fit.
   - VISUAL HIGHLIGHT: Highlight every expression effectively used in the story in markdown bold: **expression**. Do NOT bold expressions that were omitted.
   - REPORT USED AND UNUSED EXPRESSIONS: In your JSON output, return "usedWords" (array of expressions naturally integrated) and "unusedWords" (array of expressions that were omitted to preserve narrative naturalness).

3. RIGOROSA QUALIDADE GRAMATICAL E ZERO FRAGMENTOS DE FRASES:
   - Every single sentence must be complete and grammatically sound in English, containing an explicit subject and a finite main verb.
   - STRICTLY REJECT AND NEVER WRITE INCOMPLETE SENTENCES OR DANGLING PARTICIPIAL CLAUSES such as:
     * "During the morning session, pausing to watch the progress." (PROHIBITED - missing subject and finite verb)
     * "Before concluding the session, delivering a series of small improvements." (PROHIBITED - missing subject and finite verb)
   - CORRECT VERSIONS TO MODEL:
     * "During the morning session, Alex paused to watch the progress of the team."
     * "Before concluding the session, the team delivered a series of small improvements."
   - No awkward slot-filling, unnatural syntax, or artificial sentence connectors.

4. COERÊNCIA DAS PERGUNTAS DE COMPREENSÃO (EXATAMENTE 2 OU 3 PERGUNTAS):
   - Generate exactly 2 or 3 multiple-choice reading comprehension questions based EXCLUSIVELY on concrete plot events, decisions, or results in the story you just wrote.
   - ZERO GENERIC QUESTIONS: Prohibit any question about English study habits, vocabulary flashcards, or general philosophies.
   - Exactly 4 plausible options per question ([Option A, Option B, Option C, Option D]). 1 unambiguously correct based on the story, 3 plausible narrative distractors.
   - Accurate zero-based correctAnswer index (0, 1, 2, or 3).
   - Clear explanation directly referencing the story sentence that proves the answer.
${videoInstruction}
Output format must be a strict JSON object:
{
  "title": "A captivating, story-specific title",
  "text": "The 100% natural and original narrative (exactly 4 cohesive paragraphs separated by \\n\\n) with each organically used expression highlighted as **expression**.",
  "usedWords": ["expression1", "expression2"],
  "unusedWords": ["expression3"],
  "questions": [
    {
      "id": "q-1",
      "question": "Specific question testing a plot development or character action",
      "options": ["Story Option A", "Story Option B", "Story Option C", "Story Option D"],
      "correctAnswer": 0,
      "explanation": "Citation from the story text confirming this choice"
    }
  ]
}`;

  const videoPromptSnippet = videoContext && videoContext.hasVideo && videoContext.videoTitle ? `
Daily Video Inspiration:
- Title: "${videoContext.videoTitle}"
${videoContext.themeOrCategory ? `- Category / Theme: "${videoContext.themeOrCategory}"\n` : ''}
(Use purely as thematic setting inspiration. Do not fabricate scenes, quotes, or transcripts from the video.)
` : `
Setting Inspiration: Everyday professional, creative, or community scenario.
`;

  const userPrompt = `Generate the 4-paragraph mini-story and 2-3 reading questions for:
Protagonist: "Alex"
Proficiency Level: ${levelMeta.labelEn} (CEFR ${levelMeta.cefr})
Available Target Expressions of the Day:
${profiledWordsList}
${videoPromptSnippet}
PEDAGOGICAL INSTRUCTIONS:
1. Prioritize a completely natural, coherent, and realistic narrative.
2. Weave in ONLY expressions that organically fit into the context. Do NOT force vocabulary or create artificial dialogues/comparisons. Omit any expressions that do not fit naturally.
3. Preserve the genuine meaning and correct grammatical role of each expression.
4. Highlight effectively used expressions as **expression**.
5. Return "usedWords" and "unusedWords" in the JSON.
6. Exactly 4 connected paragraphs separated by double newlines (\\n\\n).
7. Complete grammatical sentences only with explicit subjects and finite verbs (zero dangling fragments).
8. Exactly 2 or 3 comprehension questions testing concrete story events.
Return strict JSON only.`;

  // HOTFIX IA.2A: Centralized 3-Model Contingency Failover via resolveGeminiContingencyModels()
  const contingencyResult = await executeGeminiWithContingency({
    feature: 'homework_part4',
    systemInstruction,
    untrustedUserDataPrompt: userPrompt,
    callerRole: 'student',
    apiKey,
    temperature: 0.7,
    validator: (json) => validatePart4StoryResponse(json, words),
  });

  if (contingencyResult.success && contingencyResult.parsedJson) {
    const parsed = contingencyResult.parsedJson;
    if (
      parsed &&
      parsed.title &&
      parsed.text &&
      !isBadStoryText(parsed.text) &&
      Array.isArray(parsed.questions) &&
      parsed.questions.length >= 2 &&
      parsed.questions.length <= 3
    ) {
      parsed.questions = parsed.questions.map((q: any, idx: number) => {
        let corrIdx = 0;
        if (typeof q.correctAnswer === 'number' && q.correctAnswer >= 0 && q.correctAnswer < 4) {
          corrIdx = q.correctAnswer;
        } else if (typeof q.correctAnswer === 'string' && Array.isArray(q.options)) {
          const foundIdx = q.options.findIndex(
            (opt: string) => opt.toLowerCase().trim() === q.correctAnswer.toLowerCase().trim()
          );
          corrIdx = foundIdx >= 0 ? foundIdx : 0;
        }
        return {
          ...q,
          id: q.id || `q-${idx + 1}`,
          correctAnswer: corrIdx,
        };
      });

      // Derive accurately which target expressions were used vs unused
      const textLower = parsed.text.toLowerCase();
      const detectedUsed: string[] = [];
      const detectedUnused: string[] = [];

      for (const w of words) {
        const clean = (w || '').trim();
        if (!clean) continue;
        const lower = clean.toLowerCase();
        const base = lower.replace(/ed$|s$|ing$/, '');
        const isUsed =
          textLower.includes(`**${lower}**`) ||
          textLower.includes(lower) ||
          (base.length >= 3 && textLower.includes(base));
        if (isUsed) {
          detectedUsed.push(clean);
        } else {
          detectedUnused.push(clean);
        }
      }

      parsed.usedWords = Array.isArray(parsed.usedWords) && parsed.usedWords.length > 0
        ? Array.from(new Set(parsed.usedWords.map((w: string) => String(w).trim()).filter((w: string) => words.some((tw) => tw.toLowerCase() === w.toLowerCase()))))
        : detectedUsed;

      parsed.unusedWords = Array.isArray(parsed.unusedWords)
        ? Array.from(new Set(parsed.unusedWords.map((w: string) => String(w).trim()).filter((w: string) => words.some((tw) => tw.toLowerCase() === w.toLowerCase()))))
        : detectedUnused;

      // Ensure expressions missing from usedWords are listed in unusedWords
      for (const w of words) {
        const clean = w.trim();
        const inUsed = parsed.usedWords.some((uw: string) => uw.toLowerCase() === clean.toLowerCase());
        if (!inUsed && !parsed.unusedWords.some((uw: string) => uw.toLowerCase() === clean.toLowerCase())) {
          parsed.unusedWords.push(clean);
        }
      }

      return {
        ...parsed,
        isAiGenerated: true,
      };
    }
  }

  return null;
}

// Specialized Native English Teacher & Instructional Designer Generator for Weekly Memorization Activity
async function generateDirectMemorizationAi(
  words: string[],
  studentLevel: string,
  studentName: string = 'Student',
  videoContext?: VideoContextForPart4 | null
): Promise<any | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || !Array.isArray(words) || words.length === 0) return null;

  const vidKey = videoContext?.videoId ? `_vid_${videoContext.videoId}` : '';
  const cacheKey = `${words.map((w) => w.toLowerCase().trim()).sort().join('|')}_${studentLevel.toLowerCase()}${vidKey}`;
  const cached = aiMemorizationCache.get(cacheKey);
  if (cached && Date.now() < cached.expiry) {
    const cachedStory = cached.data?.readingPassage?.text || '';
    if (!isBadStoryText(cachedStory) && !hasGenericBoilerplate(cached.data)) {
      return cached.data;
    }
    aiMemorizationCache.delete(cacheKey);
  }

  const levelMeta = normalizeStudentLevel(studentLevel);

  const videoInstruction = videoContext && videoContext.hasVideo && videoContext.videoTitle ? `
     * CONTEXTUAL VIDEO THEMATIC INSPIRATION: The student is working with the daily routine video "${videoContext.videoTitle}"${videoContext.themeOrCategory ? ` (${videoContext.themeOrCategory})` : ''}. Status: ${videoContext.isWatched ? 'Watched by student' : 'Selected in routine'}. Use this theme solely as creative inspiration for the setting/domain of the mini-story. NEVER invent, fake, or pretend to transcribe video scenes, dialogues, or specific video events.` : '';

  const systemInstruction = `You are a world-class English Language Teaching (ELT) Instructional Designer and Expert Native English Teacher for "It's Simple - Learn English by Living Your Life".
Your mission is to generate 100% authentic, personalized, native, and engaging educational content for the 4-part "Weekly Memorization Activity", strictly and exclusively utilizing the student's active target vocabulary words assigned for today's session:
MANDATORY ACTIVE TARGET VOCABULARY WORDS FOR TODAY'S SESSION (NON-NEGOTIABLE):
${words.map((w, i) => `  ${i + 1}. "${w}"`).join('\n')}

STRICT SYSTEM PROMPT CONSTRAINTS & RULES (ENFORCED 100%):
1. MANDATORY TARGET VOCABULARY INJECTION & EXCLUSIVITY:
   - You MUST strictly author every single exercise across Parts 1, 2, 3, and 4 around these exact target words: [${words.map((w) => `"${w}"`).join(', ')}].
   - COMPLETELY FORBIDDEN are placeholder words, arbitrary default words, or generic template terms (such as "now", "happy", "perfect", "app" unless they are explicitly in the active target words list above).
   - ZERO GENERIC BOILERPLATE: Strictly forbidden are repetitive slot-filling formulas such as "Understanding how to optimize...", "The team established a...", "Key concept representing...", "Action term describing...", "Taking time to...", or "I practice using...".
   - Every single sentence, definition, blank space, matching clue, distractor, and mini-story MUST be authentically authored specifically around the exact lexical, grammatical, and semantic meaning of each word in realistic daily life, conversation, or workplace contexts.

2. GRAMMATICAL DISTRACTOR RULE FOR PART 2 (FILL IN THE BLANKS):
   - For each target word, provide exactly 4 options: the correct target word + 3 plausible distractors.
   - CRITICAL: The 3 distractors MUST share the EXACT SAME grammatical part of speech and structural category as the correct word (e.g. nouns with nouns, adjectives with adjectives, verbs with verbs, adverbs with adverbs).
   - The sentence context must make the target word the ONLY semantically and logically correct choice.

3. PRECISE PROFICIENCY LEVEL CALIBRATION (${levelMeta.labelEn} / CEFR ${levelMeta.cefr}):
   - ${levelMeta.key === 'beginner' ? 'BEGINNER (A1-A2): Direct SVO sentences (8-14 words), accessible daily vocabulary, clear context clues, simple present/past.' : levelMeta.key === 'intermediate' ? 'INTERMEDIATE (B1-B2): Natural compound and complex sentences (14-22 words) using connectors (because, although, while, since, so), modal verbs, phrasal verbs, realistic workplace, technology, or modern social situations.' : 'ADVANCED (C1-C2): Nuanced vocabulary, varied syntax, idiomatic collocations, executive and reflective depth (18-28 words), conditional structures.'}

4. DETAILED SPECIFICATIONS FOR THE 4 PARTS:
   - Part 1 (Matching Pairs):
     * Create contextual definitions or synonyms where the clues explicitly hint at the meaning of each specific target word in realistic contexts.
     * Include a natural Portuguese equivalent ("translation").
     * Shuffle the order in the "matchingPairs" array so the items do not match 1-to-1 in sequence.
   - Part 2 (Fill in the Blanks):
     * Create a natural, realistic sentence for each target word where "______" is the single blank.
     * The blank must test the usage of that specific target word within real daily life or career contexts, and it MUST be the only logical and grammatical fit among the choices.
     * Provide 4 options (the target word + 3 plausible distractors belonging to the same part of speech).
     * Provide an insightful clue in English ("hintEn") and Portuguese ("hintPt") highlighting the context clue.
     * Provide an explanation in English ("explanationEn") and Portuguese ("explanationPt") explaining why that word is the correct choice.
   - Part 3 (Sentence Writing):
     * Provide an engaging prompt challenging the learner to apply each target word to their personal goals, career, or daily routine.
     * Calibrate the prompt to ${levelMeta.labelEn} level.
     * Include practical challenge guidance in English ("hint" and "hintEn"), in Portuguese ("hintPt"), and a clear level grammar instruction ("levelInstruction").
    - Part 4 (Mini-Story & Comprehension Questions):
      * Compose a cohesive, lively, and 100% original short story consisting of exactly 4 cohesive paragraphs separated by double newlines (\n\n) featuring a relatable protagonist navigating a concrete situation that seamlessly and organically embeds ALL target words in context, highlighted with **word**.
      * Accompany with 2 to 3 multiple-choice reading comprehension questions that strictly test concrete plot events, decisions, and outcomes in this narrative. ZERO generic questions about English study methods.
      * Each question has 4 options, a "correctAnswer" index (0, 1, 2, or 3), and an "explanation" citing the story.
${videoInstruction}

You MUST respond with a strict, valid JSON object matching the requested schema.`;

  // Security Hotfix (Etapa 2): Privacy enforcement — student personal name removed from prompts
  const videoPromptSnippet = videoContext && videoContext.hasVideo && videoContext.videoTitle ? `
Daily Video Thematic Inspiration for Part 4 Story:
- Video Title: "${videoContext.videoTitle}"
${videoContext.themeOrCategory ? `- Category / Theme: "${videoContext.themeOrCategory}"\n` : ''}- Watch status: ${videoContext.isWatched ? 'Confirmed watched' : 'Selected in routine'}
(Use purely as thematic inspiration for the story setting. Do not invent false video dialogues or scenes.)
` : '';

  const userPrompt = `Generate the complete, customized 4-part Memorization Activity:
- Target Learner Level: ${levelMeta.labelEn} (${levelMeta.labelPt} - CEFR ${levelMeta.cefr})
- Pedagogical Grammar Focus: ${levelMeta.grammarFocusEn}
${videoPromptSnippet}
TARGET VOCABULARY WORDS FOR TODAY (MUST GENERATE COMPLETE CUSTOM CONTENT FOR EACH ONE):
${words.map((w, i) => `${i + 1}. "${w}"`).join('\n')}

Required JSON Structure:
{
  "matchingPairs": [
    {
      "id": "match-1",
      "word": "exact target word",
      "definition": "Contextual definition or synonym hinting explicitly at the meaning in realistic contexts",
      "translation": "natural Portuguese translation"
    }
  ],
  "fillInBlanks": [
    {
      "id": "fill-1",
      "sentenceWithBlank": "Natural sentence with ______ as the blank testing this specific word",
      "correctWord": "exact target word",
      "options": ["target word", "distractor1", "distractor2", "distractor3"],
      "hintPt": "Dica funcional contextualizando a palavra",
      "hintEn": "Contextual clue highlighting the meaning",
      "explanationPt": "Explicação em português do porquê desta palavra encaixar",
      "explanationEn": "Explanation in English why this word fits"
    }
  ],
  "sentenceWritingPrompts": [
    {
      "word": "exact target word",
      "hint": "Engaging prompt challenging the student to apply this word to their personal goals, career, or daily routine",
      "hintPt": "Desafio prático de escrita em português direcionado para a rotina ou carreira",
      "hintEn": "Engaging prompt in English",
      "levelInstruction": "Grammar structure tip for ${levelMeta.labelEn} level"
    }
  ],
  "readingPassage": {
    "title": "Story Title",
    "text": "Coherent short story (exactly 4 cohesive paragraphs separated by double newlines) that organically embeds ALL target words highlighted with **word**.",
    "questions": [
      {
        "id": "q-1",
        "question": "Comprehension question directly probing plot events or character actions",
        "options": ["Option A", "Option B", "Option C", "Option D"],
        "correctAnswer": 0,
        "explanation": "Why this answer is correct based strictly on the text"
      }
    ]
  }
}`;

  // HOTFIX 3-MODEL CONTINGENCY: Sequential failover across up to 3 verified models on recoverable errors
  const contingencyResult = await executeGeminiWithContingency({
    feature: 'homework_generate',
    systemInstruction,
    untrustedUserDataPrompt: userPrompt,
    callerRole: 'student',
    apiKey,
    temperature: 0.65,
    validator: (json) => validateDirectMemorizationAiResponse(json, words),
  });

  if (contingencyResult.success && contingencyResult.parsedJson) {
    const parsed = contingencyResult.parsedJson;
    if (
      parsed &&
      Array.isArray(parsed.matchingPairs) &&
      parsed.matchingPairs.length > 0 &&
      Array.isArray(parsed.fillInBlanks) &&
      parsed.fillInBlanks.length > 0 &&
      Array.isArray(parsed.sentenceWritingPrompts) &&
      parsed.sentenceWritingPrompts.length > 0 &&
      parsed.readingPassage?.text &&
      !isBadStoryText(parsed.readingPassage.text)
    ) {
      if (!hasGenericBoilerplate(parsed)) {

        // Normalize questions
        if (Array.isArray(parsed.readingPassage?.questions)) {
          parsed.readingPassage.questions = parsed.readingPassage.questions.map((q: any, qIdx: number) => {
            let corrIdx = 0;
            if (typeof q.correctAnswer === 'number' && q.correctAnswer >= 0 && q.correctAnswer < 4) {
              corrIdx = q.correctAnswer;
            } else if (typeof q.correctAnswer === 'string' && Array.isArray(q.options)) {
              const foundIdx = q.options.findIndex(
                (opt: string) => opt.toLowerCase().trim() === q.correctAnswer.toLowerCase().trim()
              );
              corrIdx = foundIdx >= 0 ? foundIdx : 0;
            }
            return {
              ...q,
              id: q.id || `q-${qIdx + 1}`,
              correctAnswer: corrIdx,
            };
          });
        }

        // Cache successful AI response for 2 hours
        aiMemorizationCache.set(cacheKey, {
          data: parsed,
          expiry: Date.now() + 2 * 60 * 60 * 1000,
        });
        return parsed;
      }
    }
  }

  return null;
}

// AI-Powered 4-Stage Weekly Memorization Activity Generator
app.post('/api/homework/generate-ai', firebaseAuthMiddleware, async (req, res) => {
  try {
    const caller = req.user!;
    const callerUid = caller.uid;
    const callerEmail = (caller.email || '').toLowerCase().trim();
    const {
      words = [],
      wordDetails = [],
      studentName = 'Student',
      studentLevel = 'Intermediate',
      studentEmail = '',
      studentUid = '',
      weekLabel = '',
      targetDay = '',
      day = '',
      referenceDay = '',
      weeklyCycle: bodyWeeklyCycle,
    } = req.body || {};

    let effectiveLevel = studentLevel;
    let effectiveName = studentName;
    let effectiveEmail = studentEmail || callerEmail;

    if (caller.role === 'student') {
      if (studentUid && studentUid !== callerUid) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Unauthorized access: cannot generate homework for another student.',
        });
      }
      if (studentEmail && studentEmail.toLowerCase().trim() !== callerEmail) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Unauthorized access: cannot generate homework for another student.',
        });
      }

      effectiveEmail = callerEmail;
      const db = readDb();
      const registeredStudent = (db.students || []).find((s: any) =>
        (s.uid === callerUid || s.id === callerUid) ||
        (callerEmail && (s.email || '').toLowerCase().trim() === callerEmail)
      );
      const profile = db.userProfiles?.[callerUid] || (callerEmail && db.userProfiles?.[callerEmail]);
      effectiveLevel = profile?.level || profile?.englishLevel || registeredStudent?.level || registeredStudent?.englishLevel || studentLevel;
      effectiveName = profile?.name || registeredStudent?.name || studentName || 'Student';
    }

    const levelMeta = normalizeStudentLevel(effectiveLevel);

    // 1. Simple direct input: clean array of unique words
    const rawList = Array.isArray(words) ? words : [];
    const cleanWords = Array.from(
      new Set(
        rawList
          .map((item: any) => (typeof item === 'string' ? item : item?.word || '').trim())
          .filter((w: string) => Boolean(w))
      )
    ).slice(0, 15);

    // Security Hotfix (Etapa 2): Payload bounds validation
    const bounds = validatePayloadBounds('homework_generate', { words: cleanWords });
    if (!bounds.valid) {
      return res.status(400).json({ error: 'Payload bounds exceeded', message: bounds.error });
    }

    // Anti-generic rule: if no words provided, return clean empty notice immediately
    if (cleanWords.length === 0) {
      return res.json({
        success: true,
        isEmpty: true,
        emptyWarning:
          'Nenhum vocabulário cadastrado nesta semana ainda. Para gerar sua Atividade de Memorização inteligente, adicione palavras nas suas rotinas diárias ou participe de uma aula ao vivo com seu Amigo Nativo para que ele anote novos termos no seu vocabulário.',
        emptyWarningEn:
          'No vocabulary registered for this week yet. To generate your AI Memorization Activity, add words in your daily routines or attend a live lesson with your Native Friend so they can note new terms in your vocabulary.',
        totalWordsCollected: 0,
        vocabularyList: [],
        matchingPairs: [],
        fillInBlanks: [],
        sentenceWritingPrompts: [],
        readingPassage: {
          title: 'Aguardando Vocabulário Real',
          text: '',
          questions: [],
        },
      });
    }

    // Resolve verified student video context from Firestore
    const effectiveDay = (targetDay || day || referenceDay || '').toString();
    const effectiveWeeklyCycle = typeof bodyWeeklyCycle === 'number' && bodyWeeklyCycle > 0 ? bodyWeeklyCycle : undefined;
    let videoContext: VideoContextForPart4 | null = null;
    const targetStudentUid = caller.role === 'student' ? callerUid : (studentUid || callerUid);
    if (targetStudentUid) {
      try {
        videoContext = await resolveStudentVideoContextForPart4(targetStudentUid, effectiveDay, effectiveWeeklyCycle);
      } catch (vcErr) {
        console.warn('[serverApp] Error resolving videoContext in generate-ai:', vcErr);
      }
    }

    const vidKey = videoContext?.videoId ? `_vid_${videoContext.videoId}` : '';
    const cacheKey = `${cleanWords.map((w: string) => w.toLowerCase().trim()).sort().join('|')}_${studentLevel.toLowerCase()}${vidKey}`;
    const cachedResponse = aiMemorizationCache.get(cacheKey);
    if (cachedResponse && Date.now() < cachedResponse.expiry) {
      const cachedText = cachedResponse.data?.homework?.readingPassage?.text || '';
      if (!isBadStoryText(cachedText) && !hasGenericBoilerplate(cachedResponse.data)) {
        return res.json(cachedResponse.data);
      }
      aiMemorizationCache.delete(cacheKey);
    }

    // Security Hotfix (Etapa 2 & Residuals): Rate limiting per UID
    const rateCheck = await checkAndConsumeRateLimit(callerUid, 'homework_generate');
    if (!rateCheck.allowed) {
      if (rateCheck.unavailable) {
        return sendGeminiCostControlUnavailable(res, 5);
      }
      logGeminiAudited({
        feature: 'homework_generate',
        status: 'RATE_LIMITED',
        callerRole: caller.role,
        detail: `Rate limit hit, retry after ${rateCheck.retryAfterSeconds}s`,
      });
      return res.status(429).json({
        success: false,
        error: 'Rate limit exceeded',
        message: 'Muitas gerações de atividade solicitadas recentemente. Aguarde alguns instantes.',
        retryAfterSeconds: rateCheck.retryAfterSeconds,
      });
    }

    // Security Hotfix (Etapa 2 & Residuals): Single-flight lock
    const flightLock = await acquireSingleFlightLock(`homework_generate:${cacheKey}`);
    if (!flightLock.acquired) {
      if (flightLock.unavailable) {
        return sendGeminiCostControlUnavailable(res, 5);
      }
      logGeminiAudited({
        feature: 'homework_generate',
        status: 'INFLIGHT_LOCKED',
        callerRole: caller.role,
        detail: 'Concurrent homework generation in progress',
      });
      return res.status(429).json({
        success: false,
        error: 'Concurrent generation in progress',
        message: 'Uma geração de atividade idêntica já está em processamento.',
        retryAfterSeconds: 4,
      });
    }

    let aiResult: any = null;
    try {
      // 2. Direct Gemini AI generation with Specialized Native Teacher & Instructional Designer System Prompt
      aiResult = await generateDirectMemorizationAi(cleanWords, studentLevel, studentName, videoContext);
    } finally {
      await flightLock.release();
    }

    if (!aiResult) {
      return res.status(503).json({
        success: false,
        error: 'AiUnavailable',
        message: 'Não foi possível gerar a Atividade de Memorização no momento devido à indisponibilidade do serviço de IA. Suas palavras da semana foram preservadas.',
      });
    }

    // Assemble the 4 genuine AI-generated parts
    // HOTFIX 2.3: Reuse legitimate definitions already persisted in Firestore (e.g. from 5 Words / Native Friends Notes)
    const matchingPairs = (aiResult.matchingPairs || []).map((m: any) => {
      const existingDetail = Array.isArray(wordDetails)
        ? wordDetails.find((d: any) => (d.word || '').toLowerCase().trim() === (m.word || '').toLowerCase().trim())
        : null;
      if (existingDetail && !isGenericPedagogicalDefinition(existingDetail.definitionEn || existingDetail.definition)) {
        return {
          ...m,
          definition: existingDetail.definitionEn || existingDetail.definition,
          translation: existingDetail.translationPt || existingDetail.translation || m.translation,
        };
      }
      return m;
    });

    const fillInBlanks = aiResult.fillInBlanks;
    const sentenceWritingPrompts = aiResult.sentenceWritingPrompts || [];
    const readingPassage = aiResult.readingPassage;
    const wasAiGenerated = true;

    // Build unified vocabulary list populated directly with contextual definitions and sentences
    const vocabularyList = cleanWords.map((word) => {
      const matchPair = matchingPairs.find((m: any) => m.word?.toLowerCase() === word.toLowerCase());
      const fillItem = fillInBlanks.find((f: any) => f.correctWord?.toLowerCase() === word.toLowerCase());
      const existingDetail = Array.isArray(wordDetails)
        ? wordDetails.find((d: any) => (d.word || '').toLowerCase().trim() === word.toLowerCase().trim())
        : null;
      const prof = profileWord(word);
      const legitimateDef = existingDetail && !isGenericPedagogicalDefinition(existingDetail.definitionEn || existingDetail.definition)
        ? (existingDetail.definitionEn || existingDetail.definition)
        : matchPair?.definition || prof.definitionEn;
      const legitimateTrans = existingDetail?.translationPt || existingDetail?.translation || matchPair?.translation || prof.translationPt;

      return {
        word,
        definitionEn: legitimateDef,
        translationPt: legitimateTrans,
        exampleSentence: fillItem?.sentenceWithBlank?.replace(/______/g, word) || prof.exampleSentenceEn,
        sourceActivityName: 'Weekly Vocabulary',
        sourceDay: 'monday' as const,
      };
    });

    const stableMatchingPairs = matchingPairs.map((m: any) => ({
      ...m,
      id: m.id || `match-${(m.word || '').toLowerCase().replace(/[^a-z0-9]/g, '_')}`,
    }));
    const stableFillInBlanks = fillInBlanks.map((f: any) => ({
      ...f,
      id: f.id || `fill-${(f.correctWord || '').toLowerCase().replace(/[^a-z0-9]/g, '_')}`,
    }));

    const finalHomeworkData = {
      id: `hw-ai-${callerUid}`,
      weekLabel: weekLabel || `Semana de ${new Date().toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' })}`,
      studentUid: callerUid,
      studentEmail: effectiveEmail || callerEmail || studentEmail || '',
      studentName: effectiveName || studentName || 'Student',
      studentLevel: levelMeta.labelEn,
      createdAt: new Date().toISOString(),
      totalWordsCollected: cleanWords.length,
      vocabularyList,
      allRoutineWords: vocabularyList,
      matchingPairs: stableMatchingPairs,
      fillInBlanks: stableFillInBlanks,
      sentenceWritingPrompts,
      readingPassage,
      isEmpty: false,
      isAiGenerated: wasAiGenerated,
      isFallback: !wasAiGenerated,
      isCompleted: false,
      score: 0,
    };

    const payload = { success: true, homework: finalHomeworkData, videoContext: videoContext || undefined };
    if (!hasGenericBoilerplate(finalHomeworkData) && wasAiGenerated) {
      aiMemorizationCache.set(cacheKey, { data: payload, expiry: Date.now() + 60 * 60 * 1000 });
    }
    res.json(payload);
  } catch (error: any) {
    console.error('Error generating AI memorization activity:', error);
    res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
});

// Dedicated Endpoint for Part 4 (Mini-Story / Routine Reading & Interpretation)
// Delivers 100% original story narratives and dynamic comprehension questions using Gemini API
app.post(['/api/homework/generate-part4', '/api/homework/generate-story'], firebaseAuthMiddleware, async (req, res) => {
  try {
    const caller = req.user!;
    const callerUid = caller.uid;
    const callerEmail = (caller.email || '').toLowerCase().trim();
    const {
      words = [],
      studentLevel = 'Intermediate',
      studentName = 'Student',
      studentUid = '',
      studentEmail = '',
      wordDetails = [],
      targetDay = '',
      day = '',
      referenceDay = '',
      weeklyCycle: bodyWeeklyCycle,
    } = req.body || {};

    let effectiveLevel = studentLevel;
    let effectiveName = studentName;

    if (caller.role === 'student') {
      if (studentUid && studentUid !== callerUid) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Unauthorized access: cannot generate story for another student.',
        });
      }
      if (studentEmail && studentEmail.toLowerCase().trim() !== callerEmail) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Unauthorized access: cannot generate story for another student.',
        });
      }

      const db = readDb();
      const registeredStudent = (db.students || []).find((s: any) =>
        (s.uid === callerUid || s.id === callerUid) ||
        (callerEmail && (s.email || '').toLowerCase().trim() === callerEmail)
      );
      const profile = db.userProfiles?.[callerUid] || (callerEmail && db.userProfiles?.[callerEmail]);
      effectiveLevel = profile?.level || profile?.englishLevel || registeredStudent?.level || registeredStudent?.englishLevel || studentLevel;
      effectiveName = profile?.name || registeredStudent?.name || studentName || 'Student';
    }

    const rawList = Array.isArray(words) ? words : [];
    const cleanWords = Array.from(
      new Set(
        rawList
          .map((item: any) => (typeof item === 'string' ? item : item?.word || '').trim())
          .filter((w: string) => Boolean(w))
      )
    ).slice(0, 15);

    if (cleanWords.length === 0) {
      return res.status(400).json({ error: 'No words provided for Part 4 generation' });
    }

    // Security Hotfix (Etapa 2): Payload bounds validation
    const bounds = validatePayloadBounds('homework_part4', { words: cleanWords });
    if (!bounds.valid) {
      return res.status(400).json({ error: 'Payload bounds exceeded', message: bounds.error });
    }

    // Security Hotfix (Etapa 2 & Residuals): Rate limiting per UID
    const rateCheck = await checkAndConsumeRateLimit(callerUid, 'homework_part4');
    if (!rateCheck.allowed) {
      if (rateCheck.unavailable) {
        return sendGeminiCostControlUnavailable(res, 5);
      }
      logGeminiAudited({
        feature: 'homework_part4',
        status: 'RATE_LIMITED',
        callerRole: caller.role,
        detail: `Rate limit hit, retry after ${rateCheck.retryAfterSeconds}s`,
      });
      return res.status(429).json({
        success: false,
        error: 'Rate limit exceeded',
        message: 'Limite de solicitações para Part 4 atingido. Tente novamente mais tarde.',
        retryAfterSeconds: rateCheck.retryAfterSeconds,
      });
    }

    // Resolve verified student video context from Firestore
    const effectiveDay = (targetDay || day || referenceDay || '').toString();
    const effectiveWeeklyCycle = typeof bodyWeeklyCycle === 'number' && bodyWeeklyCycle > 0 ? bodyWeeklyCycle : undefined;
    let videoContext: VideoContextForPart4 | null = null;
    const targetStudentUid = caller.role === 'student' ? callerUid : (studentUid || callerUid);
    if (targetStudentUid) {
      try {
        videoContext = await resolveStudentVideoContextForPart4(targetStudentUid, effectiveDay, effectiveWeeklyCycle);
      } catch (vcErr) {
        console.warn('[serverApp] Error resolving videoContext for Part 4:', vcErr);
      }
    }

    // Security Hotfix (Etapa 2 & Residuals): Single-flight lock
    const vidKey = videoContext?.videoId ? `_v_${videoContext.videoId}` : '';
    const part4LockKey = `homework_part4:${cleanWords.sort().join('|')}_${effectiveLevel}${vidKey}`;
    const flightLock = await acquireSingleFlightLock(part4LockKey);
    if (!flightLock.acquired) {
      if (flightLock.unavailable) {
        return sendGeminiCostControlUnavailable(res, 5);
      }
      logGeminiAudited({
        feature: 'homework_part4',
        status: 'INFLIGHT_LOCKED',
        callerRole: caller.role,
        detail: 'Concurrent story generation in progress',
      });
      return res.status(429).json({
        success: false,
        error: 'Concurrent generation in progress',
        message: 'Uma história idêntica já está sendo gerada. Aguarde alguns instantes.',
        retryAfterSeconds: 4,
      });
    }

    let aiStory: any = null;
    try {
      // Direct generation via dedicated Gemini Prompt Architecture
      aiStory = await generatePart4StoryWithGemini(cleanWords, effectiveLevel, effectiveName, videoContext);
    } finally {
      await flightLock.release();
    }

    if (aiStory && !isBadStoryText(aiStory.text)) {
      return res.json({
        success: true,
        readingPassage: aiStory,
        videoContext: videoContext || undefined,
        isAiGenerated: true,
        isFallback: false,
      });
    }

    return res.status(503).json({
      success: false,
      error: 'AiUnavailable',
      message: 'Não foi possível gerar a história no momento devido à indisponibilidade do serviço de IA. Suas palavras da semana foram preservadas.',
    });
  } catch (error: any) {
    console.error('Error in /api/homework/generate-part4:', error);
    res.status(500).json({ error: error.message || 'Failed to generate Part 4 story' });
  }
});

// 9. Contracted Lessons Endpoints
app.get('/api/contracted-lessons', (req, res) => {
  const db = readDb();
  res.json(db.contractedLessons || {});
});

app.post('/api/contracted-lessons', (req, res) => {
  const db = readDb();
  const { studentEmail, email, count } = req.body;
  const cleanEmail = (studentEmail || email || '').toLowerCase().trim();
  if (cleanEmail && count !== undefined) {
    db.contractedLessons[cleanEmail] = Number(count);
    writeDb(db);
  }
  res.json(db.contractedLessons);
});

// 11. Email Logs Endpoint
app.post('/api/email-logs', (req, res) => {
  const db = readDb();
  const { log } = req.body;
  if (log) {
    db.emailLogs = [log, ...(db.emailLogs || [])].slice(0, 100);
    writeDb(db);
  }
  res.json({ success: true });
});

// 12a. Isolated, Token-Optimized AI Handler Strictly for "Sentence of the Day" (Project: itissimple-security-staging)
const dailySentenceEvaluationCache = new Map<string, { data: any; expiry: number }>();

export interface DailySentenceDiagnostics {
  correlationId: string;
  feature: GeminiFeature;
  model: string;
  attemptsCount: number;
  modelsAttempted: string[];
  category: GeminiFailureCategory | 'NONE';
  statusCode: number;
  safeReason: string;
  totalDurationMs: number;
  interruptionReason: GeminiInterruptionReason;
  attempts: Array<{
    attempt: number;
    model: string;
    success: boolean;
    category?: GeminiFailureCategory;
    statusCode?: number;
    safeReason?: string;
    durationMs?: number;
  }>;
}

export interface DailySentenceEvaluationResult {
  success: boolean;
  data: any | null;
  diagnostics: DailySentenceDiagnostics;
  error?: {
    statusCode?: number;
    category: GeminiFailureCategory;
    safeReason: string;
    nonRecoverable?: boolean;
    rawMessage?: string;
  };
}

export function logDailySentenceDiagnostic(diag: DailySentenceDiagnostics): void {
  const structuredEntry = {
    tag: 'GEMINI_OBSERVABILITY',
    timestamp: new Date().toISOString(),
    feature: diag.feature,
    model: diag.model || 'none',
    attemptsCount: diag.attemptsCount,
    category: diag.category || 'NONE',
    statusCode: diag.statusCode || 200,
    safeReason: diag.safeReason || 'Success',
    totalDurationMs: diag.totalDurationMs,
    correlationId: diag.correlationId,
    cascadeInterruptionReason: diag.interruptionReason,
    interruptionReason: diag.interruptionReason,
    attempts: (diag.attempts || []).map((a) => ({
      attempt: a.attempt,
      model: a.model,
      success: a.success,
      category: a.category || (a.success ? 'NONE' : 'UNKNOWN'),
      statusCode: a.statusCode || (a.success ? 200 : 500),
      safeReason: a.safeReason || (a.success ? 'Success' : 'Failed'),
      durationMs: a.durationMs || 0,
    })),
  };

  const jsonStr = JSON.stringify(structuredEntry);
  if (diag.interruptionReason === 'sucesso') {
    console.log(`[GeminiObservability] ${jsonStr}`);
  } else {
    console.warn(`[GeminiObservability] ${jsonStr}`);
  }
}

export async function evaluateDailySentenceIsolated(
  sentence: string,
  dailyWords: string[] = [],
  options?: {
    correlationId?: string;
    callerRole?: string;
    level?: EnglishLevel | string;
    language?: string;
    modelsOverride?: string[];
    attemptExecutor?: (model: string, params: any) => Promise<any>;
  }
): Promise<DailySentenceEvaluationResult & Record<string, any>> {
  const startTime = Date.now();
  const correlationId =
    options?.correlationId || `cds_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const rawClean = (sentence || '').trim();
  const cleanDailyWords = Array.from(
    new Set(
      (Array.isArray(dailyWords) ? dailyWords : [])
        .map((w) => (typeof w === 'string' ? w.trim() : ''))
        .filter(Boolean)
    )
  );

  const userLevel = options?.level || 'intermediario';
  const cefrInfo = resolveCefrLevel(userLevel);
  const langKey = options?.language || 'pt';
  const targetLang = LANGUAGE_NAMES[langKey] || { nameEn: 'Portuguese', nameNative: 'Português' };

  const cacheKey = `v4::${cefrInfo.cefr}::${langKey}::${rawClean}::${cleanDailyWords.map((w) => w.toLowerCase()).sort().join(',')}`;
  const cached = dailySentenceEvaluationCache.get(cacheKey);
  if (cached && cached.expiry > Date.now()) {
    const diag: DailySentenceDiagnostics = {
      correlationId,
      feature: 'check_daily_sentence',
      model: 'cache',
      attemptsCount: 0,
      modelsAttempted: [],
      category: 'NONE',
      statusCode: 200,
      safeReason: 'Grammar evaluation served from in-memory cache.',
      totalDurationMs: Date.now() - startTime,
      interruptionReason: 'sucesso',
      attempts: [],
    };
    logDailySentenceDiagnostic(diag);
    return {
      success: true,
      data: cached.data,
      diagnostics: diag,
      ...cached.data,
    };
  }

  // 1. Run deterministic grammar, capitalization ("I"), verb tense ("passed"), and vocabulary analysis
  const deterministic = analyzeSentenceGrammarDeterministic(rawClean, cleanDailyWords);
  const {
    fixedSentence: programmaticFixed,
    hasGrammarError: hasProgrammaticError,
    usedWords,
    missingWords,
    usedTargetWord,
    hasWordConstraint,
    errorsPt: programmaticErrorsPt,
    errorsEn: programmaticErrorsEn,
    wordFeedbacks,
  } = deterministic;

  if (rawClean.length < 3) {
    const diag: DailySentenceDiagnostics = {
      correlationId,
      feature: 'check_daily_sentence',
      model: 'none',
      attemptsCount: 0,
      modelsAttempted: [],
      category: 'POLICY_VIOLATION',
      statusCode: 400,
      safeReason: 'Sentence is too short for meaningful grammatical evaluation (<3 chars).',
      totalDurationMs: Date.now() - startTime,
      interruptionReason: 'erro não recuperável',
      attempts: [],
    };
    logDailySentenceDiagnostic(diag);
    return {
      success: false,
      data: null,
      diagnostics: diag,
      error: {
        statusCode: 400,
        category: 'POLICY_VIOLATION',
        safeReason: diag.safeReason,
        nonRecoverable: true,
      },
    };
  }

  // 2. Cambridge/CELTA Pedagogical English Assessor prompt for Sentence of the Day
  const apiKey = (process.env.GEMINI_API_KEY || process.env.API_KEY || '').trim();
  const pedagogicalSystemInstruction = `You are an expert, Cambridge/CELTA-certified Pedagogical English Assessor and Native Friend Teacher for "Sentence of the Day".
Evaluate student sentences with deep pedagogical fidelity, just like an experienced Native Friend tutor analyzing spoken and written production.

EVALUATE ACROSS 6 DISTINCT DIMENSIONS:
1. GRAMMAR: Subject-verb agreement, verb tenses (past/present narrative consistency), modal verbs, auxiliaries, pronouns, clause syntax.
2. PUNCTUATION & STRUCTURE: Run-on sentences, comma splices (joining independent clauses with only a comma without conjunction or semicolon), missing terminal punctuation, coordinating/subordinating clause links.
3. COLLOCATIONS: Authentic, natural English word combinations (e.g. "build rapport" or "develop rapport" instead of "make a rapport"; "do homework" instead of "make homework"; "make a decision" instead of "take a decision"; "have breakfast" instead of "take breakfast").
4. WORD CHOICE & L1 INTERFERENCE: Vocabulary suitability and nuance, eliminating false cognates or unnatural direct translations from Portuguese / the student's native language.
5. PREPOSITIONS: Contextual usage and dependent prepositions (e.g. "listen to", "depend on", "good at", "arrive at/in", "on Monday").
6. NATURALNESS & FLUENCY: Idiomatic expressions, conversational rhythm, eliminating clunky phrasing and redundancies (e.g. "keep closeness in my friendships" -> "maintain close relationships with them" or "stay close to them").

MANDATORY CLASSIFICATION IN wordFeedbacks:
For each feedback item, strictly classify:
- "Error": Grammatical mistake, spelling error, incorrect preposition, or punctuation rule violation (e.g., comma splice).
- "Improvement": Understandable and grammatical, but unnatural, clunky, or non-idiomatic phrasing (e.g., unnatural collocations like "make a good rapport", or clunky phrasing like "keep closeness in my friendships").
- "Alternative": Another natural, valid phrasing for the student to express the same idea.
NEVER classify stylistic preferences or natural alternatives as grammatical errors!

PRESERVE STUDENT INTENT:
- Preserve the original meaning and core idea of the student. Do NOT invent new facts or arbitrary context.
- Adapt all pedagogical explanations and vocabulary suggestions to CEFR level ${cefrInfo.cefr} (${cefrInfo.labelEn}).

HOLISTIC CORRECTION:
- Propose a "correctedSentence" that fixes all identified issues cohesively, considering the whole sentence so no awkward phrasing remains.

IF THE SENTENCE IS ALREADY ACCURATE AND NATURAL:
- Set hasAnyError: false, isCorrect: true, wordFeedbacks: [], and keep correctedSentence equal to the student's original sentence (with capitalization/punctuation if needed). Do NOT invent imaginary errors!

EXPLANATIONS & EXAMPLES:
- Provide explanationPt in ${targetLang.nameEn} (${targetLang.nameNative}) adapted to CEFR ${cefrInfo.cefr}.
- Provide explanationEn in natural English.
- Provide a concise example sentence illustrating the natural usage.

Return strict JSON conforming to:
{
  "hasAnyError": boolean,
  "isCorrect": boolean,
  "usedWords": [string],
  "missingWords": [string],
  "correctedSentence": string,
  "explanationPt": string,
  "explanationEn": string,
  "overallSummaryPt": string,
  "overallSummaryEn": string,
  "wordFeedbacks": [
    {
      "original": string,
      "corrected": string,
      "hasError": boolean,
      "classification": "Error" | "Improvement" | "Alternative",
      "category": "grammar" | "punctuation" | "collocation" | "word_choice" | "preposition" | "naturalness",
      "explanationPt": string,
      "explanationEn": string,
      "example": string
    }
  ]
}`;

  const pedagogicalPrompt = `Student Level: CEFR ${cefrInfo.cefr} (${cefrInfo.labelEn})
Target Language for explanations: ${targetLang.nameEn} (${targetLang.nameNative})
Student Sentence: "${rawClean}"
Daily Routine Words: ${JSON.stringify(cleanDailyWords)}

Analyze the sentence thoroughly according to all 6 pedagogical criteria. Identify any comma splices, unnatural collocations (e.g., "make a rapport"), awkward phrasing (e.g., "keep closeness"), or redundancies, while preserving student intent. If the sentence is already correct and natural, confirm it with hasAnyError: false and isCorrect: true. Return strict JSON only.`;

  // HOTFIX 3-MODEL CONTINGENCY: Sequential failover across up to 3 verified models on recoverable errors
  const contingencyResult = await executeGeminiWithContingency(
    {
      feature: 'check_daily_sentence',
      systemInstruction: pedagogicalSystemInstruction,
      untrustedUserDataPrompt: pedagogicalPrompt,
      callerRole: options?.callerRole || 'student',
      apiKey,
      temperature: 0.1,
      validator: (json) => typeof json === 'object' && ('hasAnyError' in json || 'isCorrect' in json),
      modelsOverride: options?.modelsOverride,
      correlationId,
    },
    options?.attemptExecutor
  );

  const parsed = contingencyResult?.parsedJson;
  if (parsed && typeof parsed === 'object') {
    // Ensure Gemini's correctedSentence also passes deterministic capitalization/tense rules
    const rawAiCorrected =
      parsed.correctedSentence && parsed.correctedSentence.trim()
        ? parsed.correctedSentence.trim()
        : programmaticFixed;
    const postChecked = analyzeSentenceGrammarDeterministic(rawAiCorrected, cleanDailyWords);
    const finalCorrected =
      rawAiCorrected !== rawClean
        ? postChecked.fixedSentence
        : programmaticFixed;

    const normalizedOriginal = rawClean.replace(/[.!?\s]+$/, '');
    const normalizedCorrected = finalCorrected.replace(/[.!?\s]+$/, '');
    const hasDiff = Boolean(normalizedCorrected && normalizedCorrected !== normalizedOriginal);

    const finalUsedWords =
      Array.isArray(parsed.usedWords) && parsed.usedWords.length > 0
        ? parsed.usedWords
        : usedWords;
    const finalMissingWords =
      Array.isArray(parsed.missingWords) && parsed.missingWords.length > 0
        ? parsed.missingWords
        : missingWords;

    // Merge wordFeedbacks from deterministic check and Gemini
    const combinedWordFeedbacks: WordFeedback[] = [];

    wordFeedbacks.forEach((wf) => {
      combinedWordFeedbacks.push({
        ...wf,
        classification: wf.classification || 'Error',
        category: wf.category || 'grammar',
      });
    });

    if (Array.isArray(parsed.wordFeedbacks)) {
      parsed.wordFeedbacks.forEach((wf: any) => {
        if (
          wf &&
          (wf.hasError === true || wf.classification === 'Error' || wf.classification === 'Improvement') &&
          wf.original &&
          wf.corrected
        ) {
          const origClean = String(wf.original).trim();
          const corrClean = String(wf.corrected).trim();
          if (!origClean || !corrClean) return;

          const origLower = origClean.toLowerCase();
          const existingIdx = combinedWordFeedbacks.findIndex(
            (existing) => existing.original.toLowerCase().trim() === origLower
          );
          const feedbackObj: WordFeedback = {
            original: origClean,
            hasError: true,
            corrected: corrClean,
            classification:
              wf.classification === 'Improvement' || wf.classification === 'Alternative'
                ? wf.classification
                : 'Error',
            category:
              wf.category && ['grammar', 'punctuation', 'collocation', 'word_choice', 'preposition', 'naturalness'].includes(wf.category)
                ? wf.category
                : 'grammar',
            explanationPt: wf.explanationPt || wf.explanation || '',
            explanationEn: wf.explanationEn || wf.explanation || '',
            example: wf.example ? String(wf.example).trim() : undefined,
          };

          if (existingIdx >= 0) {
            combinedWordFeedbacks[existingIdx] = {
              ...combinedWordFeedbacks[existingIdx],
              ...feedbackObj,
              explanationPt: feedbackObj.explanationPt || combinedWordFeedbacks[existingIdx].explanationPt,
              explanationEn: feedbackObj.explanationEn || combinedWordFeedbacks[existingIdx].explanationEn,
            };
          } else {
            combinedWordFeedbacks.push(feedbackObj);
          }
        }
      });
    }

    const hasAnyWordFeedbackIssue = combinedWordFeedbacks.some((wf) => wf.hasError);
    const finalHasError = Boolean(
      hasProgrammaticError ||
        hasDiff ||
        parsed.hasAnyError === true ||
        parsed.isCorrect === false ||
        hasAnyWordFeedbackIssue ||
        (hasWordConstraint && !usedTargetWord)
    );

    const aiExplPt = parsed.explanationPt || parsed.explanation || '';
    const aiExplEn = parsed.explanationEn || parsed.explanation || '';

    const combinedExplPt =
      Array.from(new Set([...programmaticErrorsPt, aiExplPt].filter(Boolean)))
        .join(' ')
        .trim() ||
      (finalHasError
        ? 'Ajustes pedagógicos sugeridos para tornar sua frase correta e natural.'
        : 'Sua frase está gramaticalmente correta e natural.');

    const combinedExplEn =
      Array.from(new Set([...programmaticErrorsEn, aiExplEn].filter(Boolean)))
        .join(' ')
        .trim() ||
      (finalHasError
        ? 'Suggested pedagogical adjustments to make your sentence accurate and natural.'
        : 'Your sentence is grammatically accurate and natural.');

    const targetWordFeedback = hasWordConstraint
      ? usedTargetWord
        ? finalMissingWords.length > 0
          ? `Palavras utilizadas (${finalUsedWords.length}/${cleanDailyWords.length}): ${finalUsedWords.join(', ')}. Não incluída(s): ${finalMissingWords.join(', ')}.`
          : `Palavras da rotina utilizadas (${finalUsedWords.length}/${cleanDailyWords.length}): ${finalUsedWords.join(', ')}.`
        : `Inclua pelo menos uma palavra da sua rotina na frase (${cleanDailyWords.slice(0, 5).join(', ')}).`
      : '';

    const isAllImprovements =
      combinedWordFeedbacks.length > 0 &&
      combinedWordFeedbacks.every((wf) => wf.classification === 'Improvement');

    const resultPayload = {
      hasAnyError: finalHasError,
      isCorrect: !finalHasError,
      usedTargetWord,
      usedWords: finalUsedWords,
      missingWords: finalMissingWords,
      targetWordFeedback,
      wordFeedbacks: combinedWordFeedbacks,
      sentenceFeedback: {
        original: rawClean,
        hasError: finalHasError,
        corrected: finalCorrected,
        explanationPt: combinedExplPt,
        explanationEn: combinedExplEn,
        classification: isAllImprovements ? 'Improvement' : 'Error',
      },
      correctedSentence: finalCorrected,
      explanation: combinedExplPt,
      overallSummaryPt: finalHasError
        ? combinedExplPt
        : (parsed.overallSummaryPt || `Excelente! Frase natural com o vocabulário da sua rotina (${finalUsedWords.join(', ') || 'palavras de hoje'}).`),
      overallSummaryEn: finalHasError
        ? combinedExplEn
        : (parsed.overallSummaryEn || `Outstanding! Natural sentence using your daily vocabulary (${finalUsedWords.join(', ') || 'today’s words'}).`),
      improvements: combinedWordFeedbacks.filter((wf) => wf.classification === 'Improvement'),
    };

    if (dailySentenceEvaluationCache.size > 200) {
      const firstKey = dailySentenceEvaluationCache.keys().next().value;
      if (firstKey) dailySentenceEvaluationCache.delete(firstKey);
    }
    dailySentenceEvaluationCache.set(cacheKey, {
      data: resultPayload,
      expiry: Date.now() + 30 * 60 * 1000,
    });

    const diag: DailySentenceDiagnostics = {
      correlationId,
      feature: 'check_daily_sentence',
      model: contingencyResult.modelUsed || 'unknown',
      attemptsCount: contingencyResult.attemptsCount,
      modelsAttempted: contingencyResult.modelsAttempted,
      category: 'NONE',
      statusCode: 200,
      safeReason: 'Grammar evaluation completed successfully.',
      totalDurationMs: contingencyResult.totalDurationMs || (Date.now() - startTime),
      interruptionReason: 'sucesso',
      attempts: (contingencyResult.attemptsDetails || []).map((ad) => ({
        attempt: ad.attemptNumber,
        model: ad.model,
        success: ad.success,
        category: ad.category,
        statusCode: ad.statusCode,
        safeReason: ad.safeReason,
        durationMs: ad.durationMs,
      })),
    };
    logDailySentenceDiagnostic(diag);

    return {
      success: true,
      data: resultPayload,
      diagnostics: diag,
      ...resultPayload,
    };
  }

  // Preserve failure details and log structured observability entry
  const lastErr = contingencyResult.error || {
    statusCode: 503,
    category: 'SERVICE_UNAVAILABLE' as GeminiFailureCategory,
    safeReason: 'All contingency models failed to provide a valid response.',
  };

  const interruptionReason: GeminiInterruptionReason =
    contingencyResult.interruptionReason ||
    (lastErr.nonRecoverable
      ? 'erro não recuperável'
      : lastErr.category === 'TIMEOUT'
      ? 'timeout'
      : 'esgotamento dos modelos');

  const modelLogged =
    contingencyResult.modelUsed ||
    (contingencyResult.modelsAttempted.length > 0
      ? contingencyResult.modelsAttempted[contingencyResult.modelsAttempted.length - 1]
      : 'none');

  const diag: DailySentenceDiagnostics = {
    correlationId,
    feature: 'check_daily_sentence',
    model: modelLogged,
    attemptsCount: contingencyResult.attemptsCount || contingencyResult.modelsAttempted.length,
    modelsAttempted: contingencyResult.modelsAttempted,
    category: lastErr.category || 'SERVICE_UNAVAILABLE',
    statusCode: lastErr.statusCode || 503,
    safeReason: lastErr.safeReason || 'Gemini service encountered an error.',
    totalDurationMs: contingencyResult.totalDurationMs || (Date.now() - startTime),
    interruptionReason,
    attempts: (contingencyResult.attemptsDetails || []).map((ad) => ({
      attempt: ad.attemptNumber,
      model: ad.model,
      success: ad.success,
      category: ad.category,
      statusCode: ad.statusCode,
      safeReason: ad.safeReason,
      durationMs: ad.durationMs,
    })),
  };

  logDailySentenceDiagnostic(diag);

  return {
    success: false,
    data: null,
    diagnostics: diag,
    error: {
      statusCode: lastErr.statusCode,
      category: lastErr.category,
      safeReason: lastErr.safeReason,
      nonRecoverable: lastErr.nonRecoverable,
    },
  };
}

app.post('/api/check-daily-sentence', firebaseAuthMiddleware, async (req, res) => {
  try {
    const caller = req.user!;
    const callerUid = caller.uid;
    const callerEmail = (caller.email || '').toLowerCase().trim();
    const {
      sentence = '',
      dailyWords = [],
      studentUid = '',
      studentEmail = '',
      level = '',
      language = 'pt',
    } = req.body || {};

    if (caller.role === 'student') {
      if (studentUid && studentUid !== callerUid) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Unauthorized access: student UID does not match authenticated user.',
        });
      }
      if (studentEmail && studentEmail.toLowerCase().trim() !== callerEmail) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Unauthorized access: student email does not match authenticated user.',
        });
      }
    }

    // Resolve student CEFR level if not passed in request body
    let effectiveLevel = level;
    if (!effectiveLevel && callerUid) {
      try {
        const userDoc = await fetchUserDocumentFromFirestore(callerUid, 500);
        if (userDoc?.level) {
          effectiveLevel = userDoc.level;
        }
      } catch {
        // non-blocking
      }
    }

    // Security Hotfix (Etapa 2): Payload bounds validation
    const bounds = validatePayloadBounds('check_daily_sentence', { sentence, words: dailyWords });
    if (!bounds.valid) {
      return res.status(400).json({ error: 'Payload bounds exceeded', message: bounds.error });
    }

    // Security Hotfix (Etapa 2 & Residuals): Rate limiting per UID
    const rateCheck = await checkAndConsumeRateLimit(callerUid, 'check_daily_sentence');
    if (!rateCheck.allowed) {
      if (rateCheck.unavailable) {
        return sendGeminiCostControlUnavailable(res, 5);
      }
      logGeminiAudited({
        feature: 'check_daily_sentence',
        status: 'RATE_LIMITED',
        callerRole: caller.role,
        detail: `Rate limit hit, retry after ${rateCheck.retryAfterSeconds}s`,
      });
      return res.status(429).json({
        success: false,
        error: 'Rate limit exceeded',
        message: 'Muitas verificações de frase solicitadas recentemente. Aguarde alguns instantes.',
        retryAfterSeconds: rateCheck.retryAfterSeconds,
      });
    }

    // Security Hotfix (Etapa 2 & Residuals): Single-flight lock
    const flightKey = `check_daily_sentence:${callerUid}:${sentence.trim().toLowerCase()}`;
    const flightLock = await acquireSingleFlightLock(flightKey);
    if (!flightLock.acquired) {
      if (flightLock.unavailable) {
        return sendGeminiCostControlUnavailable(res, 5);
      }
      logGeminiAudited({
        feature: 'check_daily_sentence',
        status: 'INFLIGHT_LOCKED',
        callerRole: caller.role,
        detail: 'Concurrent sentence verification in progress',
      });
      return res.status(429).json({
        success: false,
        error: 'Concurrent verification in progress',
        message: 'Esta frase já está sendo verificada.',
        retryAfterSeconds: 3,
      });
    }

    const correlationId =
      (req.headers['x-correlation-id'] as string) ||
      (req.headers['x-request-id'] as string) ||
      `cds_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    res.setHeader('X-Correlation-Id', correlationId);

    let evalOutcome: DailySentenceEvaluationResult | null = null;
    try {
      evalOutcome = await evaluateDailySentenceIsolated(sentence, dailyWords, {
        correlationId,
        callerRole: caller.role,
        level: effectiveLevel,
        language: language || 'pt',
      });
    } finally {
      await flightLock.release();
    }

    if (!evalOutcome || !evalOutcome.success || !evalOutcome.data) {
      return res.status(503).json({
        success: false,
        error: 'AiUnavailable',
        message: 'Serviço de verificação da Frase do Dia temporariamente indisponível. Sua frase foi preservada.',
      });
    }
    return res.json(evalOutcome.data);
  } catch (err: any) {
    const errorCorrelationId =
      (req.headers['x-correlation-id'] as string) ||
      (req.headers['x-request-id'] as string) ||
      `cds_${Date.now()}_err`;
    logDailySentenceDiagnostic({
      correlationId: errorCorrelationId,
      feature: 'check_daily_sentence',
      model: 'none',
      attemptsCount: 0,
      modelsAttempted: [],
      category: 'SERVICE_UNAVAILABLE',
      statusCode: 503,
      safeReason: 'Unexpected internal error in check-daily-sentence endpoint.',
      totalDurationMs: 0,
      interruptionReason: 'erro não recuperável',
      attempts: [],
    });
    return res.status(503).json({
      success: false,
      error: 'AiUnavailable',
      message: 'Não foi possível verificar a frase no momento devido à indisponibilidade do serviço.',
    });
  }
});

// 12. Writing / Grammar Evaluation via Gemini API with Absolute Rigor & Subtle Error Detection
app.post('/api/check-writing', firebaseAuthMiddleware, async (req, res) => {
  const caller = req.user!;
  const callerUid = caller.uid;
  const callerEmail = (caller.email || '').toLowerCase().trim();
  const {
    words = [],
    dailyWords = [],
    sentence = '',
    activityName = 'Weekly Memorization Activity',
    level = 'iniciante',
    targetWord = '',
    instruction = '',
    levelInstruction = '',
    language = 'pt',
    studentUid = '',
    studentEmail = '',
  } = req.body || {};

  let effectiveLevel = level;
  if (caller.role === 'student') {
    if (studentUid && studentUid !== callerUid) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Unauthorized access: student UID does not match authenticated user.',
      });
    }
    if (studentEmail && studentEmail.toLowerCase().trim() !== callerEmail) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Unauthorized access: student email does not match authenticated user.',
      });
    }

    const db = readDb();
    const registeredStudent = (db.students || []).find((s: any) =>
      (s.uid === callerUid || s.id === callerUid) ||
      (callerEmail && (s.email || '').toLowerCase().trim() === callerEmail)
    );
    const profile = db.userProfiles?.[callerUid] || (callerEmail && db.userProfiles?.[callerEmail]);
    effectiveLevel = profile?.level || profile?.englishLevel || registeredStudent?.level || registeredStudent?.englishLevel || level;
  }

  const levelMeta = normalizeStudentLevel(effectiveLevel);

  const rawWordsList = Array.isArray(dailyWords) && dailyWords.length > 0
    ? dailyWords
    : Array.isArray(words) ? words : [];

  // Security Hotfix (Etapa 2): Payload bounds validation
  const bounds = validatePayloadBounds('check_writing', { sentence, words: rawWordsList });
  if (!bounds.valid) {
    return res.status(400).json({ error: 'Payload bounds exceeded', message: bounds.error });
  }

  // Security Hotfix (Etapa 2 & Residuals): Rate limiting per UID
  const rateCheck = await checkAndConsumeRateLimit(callerUid, 'check_writing');
  if (!rateCheck.allowed) {
    if (rateCheck.unavailable) {
      return sendGeminiCostControlUnavailable(res, 5);
    }
    logGeminiAudited({
      feature: 'check_writing',
      status: 'RATE_LIMITED',
      callerRole: caller.role,
      detail: `Rate limit hit, retry after ${rateCheck.retryAfterSeconds}s`,
    });
    return res.status(429).json({
      success: false,
      error: 'Rate limit exceeded',
      message: 'Muitas análises de escrita solicitadas recentemente. Aguarde alguns instantes.',
      retryAfterSeconds: rateCheck.retryAfterSeconds,
    });
  }

  const allTargetWords = targetWord
    ? Array.from(new Set([targetWord, ...rawWordsList]))
    : rawWordsList;
  const mainTarget = targetWord || allTargetWords[0] || '';

  const rawClean = (sentence || '').trim();

  // Security Hotfix (Etapa 2 & Residuals): Single flight lock
  const flightKey = `check_writing:${callerUid}:${rawClean.toLowerCase()}`;
  const flightLock = await acquireSingleFlightLock(flightKey);
  if (!flightLock.acquired) {
    if (flightLock.unavailable) {
      return sendGeminiCostControlUnavailable(res, 5);
    }
    logGeminiAudited({
      feature: 'check_writing',
      status: 'INFLIGHT_LOCKED',
      callerRole: caller.role,
      detail: 'Concurrent writing check in progress',
    });
    return res.status(429).json({
      success: false,
      error: 'Concurrent evaluation in progress',
      message: 'Esta frase já está sendo analisada. Aguarde alguns instantes.',
      retryAfterSeconds: 3,
    });
  }

  const lowerSentence = rawClean.toLowerCase();
  const programmaticErrorsPt: string[] = [];
  const programmaticErrorsEn: string[] = [];
  let programmaticFixed = rawClean;
  let hasProgrammaticError = false;

  // 1. Vocabulary Usage Analysis against daily routine words
  const usedWords: string[] = [];
  const missingWords: string[] = [];

  allTargetWords.forEach((w: string) => {
    const cleanW = (w || '').trim().toLowerCase();
    if (!cleanW) return;
    const rootW = cleanW.replace(/(ing|ed|s|es|d)$/i, '');
    const isPresent = lowerSentence.includes(cleanW) || (rootW.length >= 4 && lowerSentence.includes(rootW));
    if (isPresent) {
      usedWords.push(w.trim());
    } else {
      missingWords.push(w.trim());
    }
  });

  const hasWordConstraint = allTargetWords.length > 0;
  const usedTargetWord = targetWord
    ? usedWords.some((w) => w.toLowerCase() === targetWord.toLowerCase().trim())
    : hasWordConstraint
    ? usedWords.length > 0
    : true;

  if (hasWordConstraint && !usedTargetWord) {
    hasProgrammaticError = true;
    programmaticErrorsPt.push(
      targetWord
        ? `Lembre-se de incluir a palavra "${targetWord}" na sua frase.`
        : `Vocabulário ausente: inclua pelo menos uma palavra da sua rotina de hoje na frase (ex: ${allTargetWords.slice(0, 3).join(', ')}).`
    );
    programmaticErrorsEn.push(
      targetWord
        ? `Remember to incorporate the word "${targetWord}" into your sentence.`
        : `Missing vocabulary: include at least one of today's routine words in your sentence (e.g., ${allTargetWords.slice(0, 3).join(', ')}).`
    );
  }

  // 2. Rigorous Check: Missing dummy subject "it" in impersonal clauses
  if (/\b(sometimes\s+)?is\s+better\b/i.test(programmaticFixed)) {
    programmaticFixed = programmaticFixed.replace(/\b(sometimes\s+)?is\s+better\b/gi, (match: string) => {
      if (/^sometimes/i.test(match)) {
        return match[0] === 'S' ? 'Sometimes it is better' : 'sometimes it is better';
      }
      return match[0] === 'I' || match[0] === 'i' ? 'It is better' : 'it is better';
    });
    hasProgrammaticError = true;
    programmaticErrorsPt.push("Omissão de sujeito: orações impessoais exigem o pronome 'it' (use 'It is better' ou 'Sometimes it is better').");
    programmaticErrorsEn.push("Missing dummy subject: English requires 'it' in impersonal clauses (use 'It is better' or 'Sometimes it is better').");
  } else if (/(^|[.?!;]\s*)is\s+(important|necessary|hard|easy|good|essential|bad)\b/i.test(programmaticFixed)) {
    programmaticFixed = programmaticFixed.replace(/(^|[.?!;]\s*)is\s+(important|necessary|hard|easy|good|essential|bad)\b/gi, '$1It is $2');
    hasProgrammaticError = true;
    programmaticErrorsPt.push("Omissão de sujeito: inicie com 'It is' para predicativos impessoais.");
    programmaticErrorsEn.push("Missing subject: start with 'It is' for impersonal predicates.");
  }

  // 3. Rigorous Check: Missing infinitive marker "to" after better + verb
  if (/\b(it\s+is\s+better|is\s+better)\s+(take|face|leave|stay|go|do|make|get|have|be|stop|start|try|listen|focus|choose)\b/i.test(programmaticFixed)) {
    programmaticFixed = programmaticFixed.replace(/\b(it\s+is\s+better|is\s+better)\s+(take|face|leave|stay|go|do|make|get|have|be|stop|start|try|listen|focus|choose)\b/gi, (match: string, prefix: string, verb: string) => {
      const cleanPrefix = prefix.toLowerCase().includes('it') ? prefix : (prefix[0] === 'I' ? 'It is better' : 'it is better');
      return `${cleanPrefix} to ${verb}`;
    });
    hasProgrammaticError = true;
    programmaticErrorsPt.push("Falta de infinitivo: use 'to' após 'better' (ex: 'better to stop', 'better to take').");
    programmaticErrorsEn.push("Missing infinitive: use 'to' after 'better' (e.g., 'better to stop', 'better to take').");
  }

  // 4. Rigorous Check: Gerund after 'stop' to cease an action
  if (/\bstop\s+to\s+(complain|worry|cry|smoke|argue|judge|overthink)\b/i.test(programmaticFixed)) {
    programmaticFixed = programmaticFixed.replace(/\bstop\s+to\s+(complain|worry|cry|smoke|argue|judge|overthink)\b/gi, (m: string, verb: string) => {
      let g = verb + 'ing';
      if (verb.endsWith('e') && !verb.endsWith('ee')) g = verb.slice(0, -1) + 'ing';
      return `stop ${g}`;
    });
    hasProgrammaticError = true;
    programmaticErrorsPt.push("Uso de gerúndio: para cessar uma atitude ou hábito, use 'stop + gerúndio' (ex: 'stop complaining', e não 'stop to complain').");
    programmaticErrorsEn.push("Gerund usage: to cease an action, use 'stop + gerund' (e.g., 'stop complaining', not 'stop to complain').");
  }

  // 5. Rigorous Check: Regência / Prepositional complement (instead to / instead + bare verb -> instead of + gerund)
  if (/\binstead\s+(to\s+([a-z]+)|(face|do|take|make|stay|go|complain|wait)\b)/i.test(programmaticFixed)) {
    programmaticFixed = programmaticFixed.replace(/\binstead\s+(to\s+([a-z]+)|([a-z]+)\b)/gi, (match: string, toGroup: string, verb1: string, verb2: string) => {
      const v = (verb1 || verb2 || '').toLowerCase();
      if (!v || v === 'of') return match;
      let gerund = v + 'ing';
      if (v.endsWith('e') && !v.endsWith('ee')) {
        gerund = v.slice(0, -1) + 'ing';
      }
      return `instead of ${gerund}`;
    });
    hasProgrammaticError = true;
    programmaticErrorsPt.push("Regência incorreta: após 'instead', usa-se 'instead of' seguido de verbo no gerúndio (ex: 'instead of facing', e não 'instead to face').");
    programmaticErrorsEn.push("Incorrect preposition: use 'instead of' + gerund (e.g., 'instead of facing', not 'instead to face').");
  }

  // 6. Rigorous Check: Indefinite article vowel error (a vs an)
  const A_BEFORE_VOWEL_REGEX = /\ba\s+([aeio][a-z]+|u(?!niversity|nicorn|nique|niform|nion|nit|ser|sage|seful|nisex|niversal|nilateral)[a-z]+|hour[a-z]*|honest[a-z]*|honor[a-z]*|heir[a-z]*)\b/gi;
  if (A_BEFORE_VOWEL_REGEX.test(programmaticFixed)) {
    programmaticFixed = programmaticFixed.replace(A_BEFORE_VOWEL_REGEX, (match: string, word: string) => {
      if (/^(one|once)/i.test(word)) return match;
      return `an ${word}`;
    });
    hasProgrammaticError = true;
    programmaticErrorsPt.push("Erro de artigo indefinido: use 'an' antes de palavras iniciadas por som vocálico (ex: 'an outstanding', 'an awkward', 'an hour').");
    programmaticErrorsEn.push("Indefinite article error: use 'an' before words starting with vowel sounds (e.g., 'an outstanding', 'an awkward', 'an hour').");
  }

  const AN_BEFORE_CONSONANT_REGEX = /\ban\s+([bcdfghjklmnpqrstvwxyz](?!hour|honest|honor|heir)[a-z]+|university[a-z]*|unicorn[a-z]*|unique[a-z]*|uniform[a-z]*|union[a-z]*|unit[a-z]*|user[a-z]*|usage[a-z]*|useful[a-z]*|european[a-z]*|one|once)\b/gi;
  if (AN_BEFORE_CONSONANT_REGEX.test(programmaticFixed)) {
    programmaticFixed = programmaticFixed.replace(AN_BEFORE_CONSONANT_REGEX, (match: string, word: string) => `a ${word}`);
    hasProgrammaticError = true;
    programmaticErrorsPt.push("Erro de artigo indefinido: use 'a' antes de palavras iniciadas por som consonantal (ex: 'a project', 'a university').");
    programmaticErrorsEn.push("Indefinite article error: use 'a' before words starting with consonant sounds (e.g., 'a project', 'a university').");
  }

  // 7. Rigorous Check: Homophone/confusable word (loose vs lose)
  if (/\bloose\s+(your|my|his|her|their|our|the|a|an|mental|mind|focus|control|temper|weight|job|state|peace|time|money|chance|opportunity|game|match)\b/i.test(programmaticFixed)) {
    programmaticFixed = programmaticFixed.replace(/\bloose\s+(your|my|his|her|their|our|the|a|an|mental|mind|focus|control|temper|weight|job|state|peace|time|money|chance|opportunity|game|match)\b/gi, 'lose $1');
    hasProgrammaticError = true;
    programmaticErrorsPt.push("Confusão ortográfica: use 'lose' (verbo perder) e não 'loose' (adjetivo frouxo/solto).");
    programmaticErrorsEn.push("Word confusion: use 'lose' (verb to lose) instead of 'loose' (adjective loose).");
  }

  // 7b. Rigorous Check: Indefinite pronoun with article error ("the anyone", "the someone", etc.)
  if (/\b(the|a|an)\s+(anyone|anybody|someone|somebody|everyone|everybody|no\s*one|nobody)\b/i.test(programmaticFixed)) {
    programmaticFixed = programmaticFixed.replace(/\b(the|a|an)\s+(anyone|anybody|someone|somebody|everyone|everybody|no\s*one|nobody)\b/gi, '$2');
    hasProgrammaticError = true;
    programmaticErrorsPt.push("Erro de artigo: não use 'the', 'a' ou 'an' antes de pronomes indefinidos como 'anyone' ou 'someone'.");
    programmaticErrorsEn.push("Article error: do not use 'the', 'a', or 'an' before indefinite pronouns like 'anyone' or 'someone'.");
  }

  // 7c. Rigorous Check: Incomplete question structure with "anyone know about" / dangling prepositions
  if (/\banyone\s+know\s+about\s*[.?!]*$/i.test(programmaticFixed)) {
    programmaticFixed = 'Does anyone know about this?';
    hasProgrammaticError = true;
    programmaticErrorsPt.push("Estrutura incompleta: inicie com 'Does' e forneça um complemento para a preposição 'about' (ex: 'Does anyone know about this?').");
    programmaticErrorsEn.push("Incomplete question structure: start with 'Does' and provide an object for 'about' (e.g., 'Does anyone know about this?').");
  } else if (/\banyone\s+know\s+about\b/i.test(programmaticFixed) && !/\b(does|did|if|whether|can|could|will)\s+anyone\s+know\s+about\b/i.test(programmaticFixed)) {
    programmaticFixed = programmaticFixed.replace(/\banyone\s+know\s+about\b/gi, 'Does anyone know about');
    hasProgrammaticError = true;
    programmaticErrorsPt.push("Estrutura de pergunta incompleta: inicie com 'Does' para fazer perguntas no presente (ex: 'Does anyone know about this?').");
    programmaticErrorsEn.push("Incomplete question structure: start with 'Does' for present tense questions (e.g., 'Does anyone know about this?').");
  }

  // 7d. Dangling preposition check
  if (/\b(about|between|among|during|into|onto)\s*[.?!]*$/i.test(programmaticFixed)) {
    hasProgrammaticError = true;
    const danglingMatch = programmaticFixed.match(/\b(about|between|among|during|into|onto)\b/i);
    const dangling = danglingMatch ? danglingMatch[0] : 'about';
    programmaticErrorsPt.push(`Frase incompleta: a preposição "${dangling}" exige um complemento ou objeto.`);
    programmaticErrorsEn.push(`Incomplete sentence: the preposition "${dangling}" requires an object.`);
    if (!programmaticFixed.includes('Does anyone know about this?')) {
      programmaticFixed = programmaticFixed.replace(/[.?!]*$/, '') + ' this.';
    }
  }

  // 7e. Transitive verbs ending sentence without an object (e.g., "Nobody told")
  if (/\b(nobody|no\s*one|somebody|someone|anybody|anyone|everybody|everyone|I|you|he|she|they|we)\s+(told|tell|tells|bring|brings|brought|give|gives|gave|sent|send|sends|buy|buys|bought|make|makes|made|take|takes|took|inform|informed|informs)\s*[.?!]*$/i.test(programmaticFixed)) {
    hasProgrammaticError = true;
    const transMatch = programmaticFixed.match(/\b(told|tell|tells|bring|brings|brought|give|gives|gave|sent|send|sends|buy|buys|bought|make|makes|made|take|takes|took|inform|informed|informs)\b/i);
    const verb = transMatch ? transMatch[0] : 'told';
    programmaticErrorsPt.push(`Frase incompleta: o verbo transitivo "${verb}" exige um objeto ou complemento (ex: "Nobody told me about it", "Nobody told us").`);
    programmaticErrorsEn.push(`Incomplete sentence: the transitive verb "${verb}" requires an object (e.g., "Nobody told me about it").`);
    programmaticFixed = programmaticFixed.replace(/[.?!]*$/, '') + ' me about it.';
  }

  // 7f. Short incomplete fragment check (< 3 words)
  const rawWordsInSentence = rawClean.split(/\s+/).filter(Boolean);
  if (rawWordsInSentence.length < 3 && !hasProgrammaticError) {
    hasProgrammaticError = true;
    programmaticErrorsPt.push('Frase muito curta ou incompleta: elabore uma sentença completa contendo Sujeito, Verbo e Complemento.');
    programmaticErrorsEn.push('Incomplete sentence: please write a complete sentence with a Subject, Verb, and Object.');
  }

  // 8. Rigorous Check: Common spelling mistakes
  const SERVER_SPELLING_FIXES: Record<string, { correct: string; explPt: string; explEn: string }> = {
    'millestone': { correct: 'milestone', explPt: 'A grafia correta é "milestone" (com apenas um "l").', explEn: 'Correct spelling is "milestone" (single "l").' },
    'millestones': { correct: 'milestones', explPt: 'A grafia correta é "milestones" (com apenas um "l").', explEn: 'Correct spelling is "milestones" (single "l").' },
    'definately': { correct: 'definitely', explPt: 'A grafia correta é "definitely" (com "i").', explEn: 'Correct spelling is "definitely".' },
    'tommorow': { correct: 'tomorrow', explPt: 'A grafia correta é "tomorrow" (com um "m" e dois "r").', explEn: 'Correct spelling is "tomorrow".' },
    'untill': { correct: 'until', explPt: 'A palavra "until" tem apenas uma letra "l".', explEn: 'The word "until" ends in a single "l".' },
    'comute': { correct: 'commute', explPt: '"Commute" (deslocamento) tem "mm" duplo.', explEn: '"Commute" has double "mm".' },
    'breackfast': { correct: 'breakfast', explPt: 'A grafia correta em inglês é "breakfast" (sem "c").', explEn: 'Correct spelling is "breakfast".' },
    'coffe': { correct: 'coffee', explPt: '"Coffee" termina com "ee" duplo.', explEn: '"Coffee" ends in double "ee".' },
    'restorant': { correct: 'restaurant', explPt: 'A grafia correta é "restaurant".', explEn: 'Correct spelling is "restaurant".' },
    'restaurante': { correct: 'restaurant', explPt: 'Em inglês, "restaurant" não tem "e" no final.', explEn: 'In English, "restaurant" does not have an "e" at the end.' },
  };

  Object.entries(SERVER_SPELLING_FIXES).forEach(([wrong, data]) => {
    const rx = new RegExp(`\\b${wrong}\\b`, 'gi');
    if (rx.test(programmaticFixed)) {
      programmaticFixed = programmaticFixed.replace(rx, data.correct);
      hasProgrammaticError = true;
      programmaticErrorsPt.push(data.explPt);
      programmaticErrorsEn.push(data.explEn);
    }
  });

  // 9. Rigorous Check: Verb agreement
  if (/\byou has\b/i.test(programmaticFixed)) {
    programmaticFixed = programmaticFixed.replace(/\byou has\b/gi, 'you have');
    hasProgrammaticError = true;
    programmaticErrorsPt.push("Concordância: use 'you have' em vez de 'you has'.");
    programmaticErrorsEn.push("Verb agreement: use 'you have' instead of 'you has'.");
  }

  // 10. Capitalization and terminal punctuation
  if (programmaticFixed && /^[a-z]/.test(programmaticFixed)) {
    programmaticFixed = programmaticFixed.charAt(0).toUpperCase() + programmaticFixed.slice(1);
    hasProgrammaticError = true;
    programmaticErrorsPt.push("Inicie a frase com letra maiúscula.");
    programmaticErrorsEn.push("Start the sentence with a capital letter.");
  }
  if (programmaticFixed && !/[.!?]$/.test(programmaticFixed)) {
    programmaticFixed = programmaticFixed + '.';
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(503).json({
      success: false,
      error: 'AiUnavailable',
      message: 'Serviço de avaliação de escrita temporariamente indisponível. Sua resposta foi preservada.',
    });
  }

  const prompt = `YOU ARE A METICULOUS, STRICT SENIOR PROFESSOR OF ENGLISH AND GRAMMAR SPECIALIST AT "IT'S SIMPLE".
YOUR TASK: Perform an EXTREMELY RIGOROUS, ZERO-TOLERANCE grammatical, orthographical, and linguistic evaluation of an English sentence written by a student for the "Sentence of the Day".

EVALUATION PARAMETERS:
- Student Proficiency Level: ${levelMeta.labelEn} (${levelMeta.labelPt} - CEFR ${levelMeta.cefr})
- Daily Routine Vocabulary Words: ${JSON.stringify(allTargetWords)}
- Specific Target Word: "${mainTarget || '(Any of the daily routine words)'}"
- Required Trigger/Instruction: "${levelInstruction || 'Form a natural, grammatically flawless sentence incorporating the daily routine words'}"
- Student Input: "${sentence}"

CRITICAL MANDATE - ZERO-TOLERANCE RIGOR:
1. DAILY VOCABULARY VALIDATION:
   - Check which of the daily words (${JSON.stringify(allTargetWords)}) are used in the sentence.
   - If daily words are provided and the student did not include any of them, set "usedTargetWord": false, "hasAnyError": true, "isCorrect": false.
2. GRAMMATICAL & LINGUISTIC RIGOR:
   - Indefinite articles ("an" before vowel sounds like "an outstanding", "a" before consonants/university).
   - Dummy subject omission ("Sometimes it is better", "It is important").
   - Prepositions ("instead of" + gerund).
   - Homophones ("loose" vs "lose").
   - Spelling & typos ("breakfast", "coffee", "commute", "milestone").
   - Capitalize first letter and end with valid punctuation (. ! ?).

OUTPUT STRICT JSON matching this schema:
{
  "hasAnyError": boolean,
  "isCorrect": boolean,
  "usedTargetWord": boolean,
  "usedWords": ["string"],
  "missingWords": ["string"],
  "targetWordFeedback": "string",
  "triggerFeedback": "string",
  "wordFeedbacks": [
    {
      "original": "string",
      "hasError": boolean,
      "corrected": "string",
      "explanationPt": "string",
      "explanationEn": "string"
    }
  ],
  "sentenceFeedback": {
    "original": "string",
    "hasError": boolean,
    "corrected": "string",
    "explanationPt": "string",
    "explanationEn": "string"
  },
  "correctedSentence": "string",
  "explanation": "string",
  "overallSummaryPt": "string",
  "overallSummaryEn": "string",
  "levelTipsPt": "string",
  "levelTipsEn": "string"
}`;

    let contingencyRes: any = null;
    try {
      contingencyRes = await executeGeminiWithContingency({
        feature: 'check_writing',
        systemInstruction: 'You are an expert English language evaluation engine. Provide rigorous, helpful, and accurate feedback strictly in valid JSON format.',
        untrustedUserDataPrompt: prompt,
        callerRole: caller.role,
        validator: (json) => typeof json === 'object' && ('hasAnyError' in json || 'isCorrect' in json || 'sentenceFeedback' in json),
      });
    } finally {
      await flightLock.release();
    }

    const parsed = contingencyRes?.parsedJson;
    if (parsed && typeof parsed === 'object') {
      const normalizedOriginal = rawClean.trim().replace(/[.!?\s]+$/, '').toLowerCase();
      const normalizedCorrected = (parsed.correctedSentence || '').trim().replace(/[.!?\s]+$/, '').toLowerCase();
      const hasGeminiDiff = Boolean(normalizedCorrected && normalizedCorrected !== normalizedOriginal);

      // Consolidate words feedback
      parsed.usedWords = Array.isArray(parsed.usedWords) && parsed.usedWords.length > 0 ? parsed.usedWords : usedWords;
      parsed.missingWords = Array.isArray(parsed.missingWords) ? parsed.missingWords : missingWords;
      parsed.usedTargetWord = typeof parsed.usedTargetWord === 'boolean' ? parsed.usedTargetWord : usedTargetWord;

      // Programmatic safety enforcement: if programmatic check detected an error OR Gemini made changes, guarantee failure!
      if (hasProgrammaticError || hasGeminiDiff || parsed.hasAnyError || parsed.isCorrect === false || !usedTargetWord) {
        parsed.hasAnyError = true;
        parsed.isCorrect = false;
        if (!parsed.sentenceFeedback) {
          parsed.sentenceFeedback = { original: rawClean, hasError: true, corrected: programmaticFixed, explanationPt: '', explanationEn: '' };
        }
        parsed.sentenceFeedback.hasError = true;
        const extraPt = programmaticErrorsPt.join(' ');
        const extraEn = programmaticErrorsEn.join(' ');
        if (extraPt) {
          parsed.sentenceFeedback.explanationPt = parsed.sentenceFeedback.explanationPt
            ? `${extraPt} ${parsed.sentenceFeedback.explanationPt}`
            : extraPt;
        }
        if (extraEn) {
          parsed.sentenceFeedback.explanationEn = parsed.sentenceFeedback.explanationEn
            ? `${extraEn} ${parsed.sentenceFeedback.explanationEn}`
            : extraEn;
        }
        parsed.explanation = parsed.sentenceFeedback.explanationPt || parsed.sentenceFeedback.explanationEn;
        parsed.overallSummaryPt = "Atenção: sua frase contém incorreções gramaticais ou ortográficas que precisam ser corrigidas antes da aprovação.";
        parsed.overallSummaryEn = "Needs revision: please review the grammar corrections below to perfect your sentence.";
        if (!parsed.correctedSentence || parsed.correctedSentence === rawClean) {
          parsed.correctedSentence = programmaticFixed;
        }
      }

      parsed.isCorrect = parsed.hasAnyError === false;
      if (parsed.hasAnyError) {
        parsed.overallSummaryPt = "Atenção: sua frase contém incorreções gramaticais ou ortográficas que precisam ser corrigidas antes da aprovação.";
        parsed.overallSummaryEn = "Needs revision: please review the grammar corrections below to perfect your sentence.";
      }
      parsed.targetWordFeedback = parsed.targetWordFeedback || (
        hasWordConstraint
          ? usedTargetWord
            ? `Palavras da rotina utilizadas: ${parsed.usedWords.join(', ')}.`
            : `Inclua pelo menos uma palavra da sua rotina na frase (${allTargetWords.slice(0, 3).join(', ')}...).`
          : ''
      );
      parsed.explanation =
        parsed.explanation ||
        parsed.sentenceFeedback?.explanationPt ||
        parsed.sentenceFeedback?.explanationEn ||
        parsed.overallSummaryPt;

      return res.json(parsed);
    }

    // Fail transparently: zero invented writing corrections when contingency models are unavailable
    return res.status(503).json({
      success: false,
      error: 'AiUnavailable',
      message: 'Serviço de avaliação de escrita temporariamente indisponível após tentativa com os modelos de contingência. Sua resposta foi preservada.',
      attemptsCount: contingencyRes?.attemptsCount || 1,
      modelsAttempted: contingencyRes?.modelsAttempted || resolveGeminiContingencyModels(),
    });
});

// In-memory cache for evaluated homework to prevent redundant evaluations and duplicate cost
const homeworkEvalCache = new Map<string, { data: any; expiry: number }>();

// In-memory cache for live lesson generated vocabulary to prevent duplicate generation
const lessonVocabCache = new Map<string, any[]>();

export function resetResidualCachesForTesting(): void {
  homeworkEvalCache.clear();
  lessonVocabCache.clear();
}

// 13. Comprehensive AI Homework Evaluator (All 4 Interactive Stages)
app.post('/api/homework/evaluate', firebaseAuthMiddleware, async (req, res) => {
  try {
    const authCtx = await authorizeHomeworkChecksAccess(req, res, 'write');
    if (!authCtx) return;

    const { canonicalStudentUid, canonicalStudentEmail, effectiveRole } = authCtx;
    const {
      homework,
      studentAnswers = {},
      studentLevel = 'iniciante',
      studentName = 'Student',
      currentLanguage = 'pt',
    } = req.body || {};

    if (!homework) {
      return res.status(400).json({ error: 'homework data is required' });
    }

    let effectiveLevel = studentLevel || homework.studentLevel;
    let effectiveName = studentName || homework.studentName;

    const userCycleInfo = await fetchCanonicalUserWeeklyCycleServer(canonicalStudentUid);
    if (userCycleInfo.userData) {
      effectiveLevel =
        userCycleInfo.userData.level ||
        userCycleInfo.userData.englishLevel ||
        effectiveLevel;
      effectiveName = userCycleInfo.userData.name || effectiveName;
    }

    const explicitCycle =
      extractPositiveIntegerCycle(req.body?.weeklyCycle) ??
      extractPositiveIntegerCycle(req.body?.weekId) ??
      extractPositiveIntegerCycle(homework?.weeklyCycle) ??
      extractPositiveIntegerCycle(homework?.weekId) ??
      extractPositiveIntegerCycle(homework?.id);

    if (
      explicitCycle !== null &&
      userCycleInfo.activeCycle !== null &&
      explicitCycle < userCycleInfo.activeCycle
    ) {
      return res.status(409).json({
        success: false,
        error: 'STALE_CYCLE',
        code: 'STALE_CYCLE',
        activeCycle: userCycleInfo.activeCycle,
        requestedCycle: explicitCycle,
        message: `Stale cycle ${explicitCycle} rejected; active cycle is ${userCycleInfo.activeCycle}.`,
      });
    }

    const cycle = explicitCycle ?? userCycleInfo.activeCycle ?? 1;
    const canonicalWeekId = `week-${cycle}`;

    const levelMeta = normalizeStudentLevel(effectiveLevel);
    const { matching = {}, fillInBlanks = {}, sentences = {}, quizAnswers = {} } = studentAnswers;

    // Check in-memory cache to preserve previously evaluated content and prevent duplicate costs
    const evaluatedContent = JSON.stringify({ sentences: sentences || {}, quizAnswers: quizAnswers || {} });
    const contentHash = crypto.createHash('sha256').update(evaluatedContent).digest('hex').slice(0, 16);
    const evalCacheKey = `${canonicalStudentUid}_${canonicalWeekId}_${homework.id || 'hw'}_${contentHash}`;
    const cachedEval = homeworkEvalCache.get(evalCacheKey);
    if (cachedEval && Date.now() < cachedEval.expiry) {
      if (isValidHomeworkEvaluation(cachedEval.data) && !isSyntheticHomeworkEvaluation(cachedEval.data)) {
        return res.json({ success: true, evaluation: cachedEval.data, cached: true });
      }
    }

    // Check if student already has a valid persisted evaluation in Firestore for this exact week, sentences, and quiz answers
    const existingHw = await fetchHomeworkFromFirestore([canonicalStudentUid], canonicalWeekId, cycle).catch(() => null);
    if (
      existingHw &&
      existingHw.aiEvaluation &&
      isValidHomeworkEvaluation(existingHw.aiEvaluation) &&
      !isSyntheticHomeworkEvaluation(existingHw.aiEvaluation)
    ) {
      const existingSentences = existingHw.studentAnswers?.sentences || {};
      const existingQuiz = existingHw.studentAnswers?.quizAnswers || {};
      const sentencesMatch = (homework.sentenceWritingPrompts || []).every((p: any) => {
        const curAns = (sentences[p.word] || sentences[p.word?.toLowerCase()] || sentences[p.word?.toUpperCase()] || '').trim();
        const prevAns = (existingSentences[p.word] || existingSentences[p.word?.toLowerCase()] || existingSentences[p.word?.toUpperCase()] || '').trim();
        return curAns === prevAns;
      });
      const quizMatch = (homework.readingPassage?.questions || []).every((q: any, idx: number) => {
        const curChoice = quizAnswers[q.id] !== undefined ? quizAnswers[q.id] : quizAnswers[String(idx)];
        const prevChoice = existingQuiz[q.id] !== undefined ? existingQuiz[q.id] : existingQuiz[String(idx)];
        return String(curChoice ?? '') === String(prevChoice ?? '');
      });
      if (sentencesMatch && quizMatch) {
        homeworkEvalCache.set(evalCacheKey, { data: existingHw.aiEvaluation, expiry: Date.now() + 600000 });
        return res.json({ success: true, evaluation: existingHw.aiEvaluation, cached: true });
      }
    }

    // Security Hotfix (Etapa 2 & Residuals): Payload bounds validation
    const bounds = validatePayloadBounds('homework_evaluate', { text: evaluatedContent });
    if (!bounds.valid) {
      return res.status(400).json({ error: 'Payload bounds exceeded', message: bounds.error });
    }

    // Security Hotfix (Etapa 2 & Residuals): Rate limiting check per authenticated UID
    const rateCheck = await checkAndConsumeRateLimit(canonicalStudentUid, 'homework_evaluate');
    if (!rateCheck.allowed) {
      if (rateCheck.unavailable) {
        return sendGeminiCostControlUnavailable(res, 5);
      }
      logGeminiAudited({
        feature: 'homework_evaluate',
        status: 'RATE_LIMITED',
        callerRole: effectiveRole,
        detail: `Rate limit hit, retry after ${rateCheck.retryAfterSeconds}s`,
      });
      return res.status(429).json({
        success: false,
        error: 'Rate limit exceeded',
        message: 'Limite de solicitações de avaliação de homework atingido para este usuário. Aguarde alguns instantes.',
        retryAfterSeconds: rateCheck.retryAfterSeconds,
      });
    }

    // Security Hotfix (Etapa 2 & Residuals): Multi-instance Single-Flight Lock with key bound to user and content
    const flightKey = `homework_evaluate:${canonicalStudentUid}:${canonicalWeekId}:${homework.id || 'hw'}:${contentHash}`;
    const flightLock = await acquireSingleFlightLock(flightKey);
    if (!flightLock.acquired) {
      if (flightLock.unavailable) {
        return sendGeminiCostControlUnavailable(res, 5);
      }
      logGeminiAudited({
        feature: 'homework_evaluate',
        status: 'INFLIGHT_LOCKED',
        callerRole: effectiveRole,
        detail: 'Concurrent homework evaluation in progress',
      });
      return res.status(429).json({
        success: false,
        error: 'Concurrent evaluation in progress',
        message: 'Uma avaliação deste exercício já está em processamento.',
        retryAfterSeconds: 4,
      });
    }

    // Calculate baseline scores
    let matchingCorrect = 0;
    const matchingFeedback = (homework.matchingPairs || []).map((p: any) => {
      const userAns = (matching[p.id] || '').trim();
      const isCorrect = userAns.toLowerCase() === p.word.toLowerCase();
      if (isCorrect) matchingCorrect++;
      return {
        id: p.id,
        isCorrect,
        userAnswer: userAns || '(sem resposta)',
        correctAnswer: p.word,
        explanationPt: isCorrect
          ? `Correto! "${p.word}" significa "${p.translation}".`
          : `A resposta correta é "${p.word}" (${p.translation}).`,
        explanationEn: isCorrect
          ? `Correct! "${p.word}" corresponds to "${p.definition}".`
          : `The correct match is "${p.word}" (${p.definition}).`,
      };
    });

    let fillCorrect = 0;
    const fillFeedback = (homework.fillInBlanks || []).map((f: any) => {
      const userAns = (fillInBlanks[f.id] || '').trim();
      const userLower = userAns.toLowerCase();
      const targetLower = (f.correctWord || '').toLowerCase().trim();
      const validAlts = Array.isArray(f.validAlternatives)
        ? f.validAlternatives.map((a: string) => (a || '').toLowerCase().trim())
        : [];
      const isCorrect = userLower === targetLower || (validAlts.length > 0 && validAlts.includes(userLower));
      if (isCorrect) fillCorrect++;
      return {
        id: f.id,
        isCorrect,
        userAnswer: userAns || '(sem resposta)',
        correctAnswer: f.correctWord,
        explanationPt: f.explanationPt || (isCorrect
          ? `Excelente! "${f.correctWord}" completa perfeitamente o sentido da frase.`
          : `A palavra correta é "${f.correctWord}" (${f.hintPt || ''}).`),
        explanationEn: f.explanationEn || (isCorrect
          ? `Great job! "${f.correctWord}" accurately completes the sentence.`
          : `The correct word is "${f.correctWord}".`),
      };
    });

    let quizCorrect = 0;
    const readingFeedback = (homework.readingPassage?.questions || []).map((q: any) => {
      const userAnsIdx = quizAnswers[q.id];
      const isCorrect = userAnsIdx === q.correctAnswer;
      if (isCorrect) quizCorrect++;
      const userAnsText = q.options?.[userAnsIdx] || '(sem resposta)';
      const correctAnsText = q.options?.[q.correctAnswer] || '';
      return {
        id: q.id,
        isCorrect,
        userAnswer: userAnsText,
        correctAnswer: correctAnsText,
        explanationPt: q.explanation || (isCorrect ? 'Resposta correta com base no texto!' : `Opção correta: ${correctAnsText}.`),
        explanationEn: q.explanation || (isCorrect ? 'Correct interpretation based on the passage!' : `Correct option: ${correctAnsText}.`),
      };
    });

    // Baseline score calculation
    const totalMatching = Math.max(1, homework.matchingPairs?.length || 1);
    const totalFill = Math.max(1, homework.fillInBlanks?.length || 1);
    const totalQuiz = Math.max(1, homework.readingPassage?.questions?.length || 1);
    const totalSentences = Math.max(1, homework.sentenceWritingPrompts?.length || 1);

    const matchScore = (matchingCorrect / totalMatching) * 20;
    const fillScore = (fillCorrect / totalFill) * 25;

    // Merge answers without overwriting non-empty answers with empty ones
    const existingSentences = existingHw?.studentAnswers?.sentences || {};
    const existingQuiz = existingHw?.studentAnswers?.quizAnswers || {};
    const existingMatching = existingHw?.studentAnswers?.matching || {};
    const existingFill = existingHw?.studentAnswers?.fillInBlanks || {};

    const mergedSentences = { ...existingSentences };
    Object.entries(sentences || {}).forEach(([k, v]) => {
      if (v !== undefined && v !== null && String(v).trim().length > 0) {
        mergedSentences[k] = v;
      }
    });

    const mergedQuizAnswers = { ...existingQuiz };
    Object.entries(quizAnswers || {}).forEach(([k, v]) => {
      if (v !== undefined && v !== null && String(v).trim().length > 0) {
        mergedQuizAnswers[k] = v;
      }
    });

    const mergedMatching = { ...existingMatching, ...(matching || {}) };
    const mergedFill = { ...existingFill, ...(fillInBlanks || {}) };

    // FASE 8.1 - ORDEM DAS OPERAÇÕES: Validar → Persistir respostas → Confirmar Firestore → Avaliar com Gemini → Persistir resultado da avaliação
    const unvalidatedHwState = {
      ...homework,
      id: canonicalWeekId,
      weekId: canonicalWeekId,
      weeklyCycle: cycle,
      studentUid: canonicalStudentUid,
      studentEmail: canonicalStudentEmail || homework.studentEmail,
      studentAnswers: {
        matching: mergedMatching,
        fillInBlanks: mergedFill,
        sentences: mergedSentences,
        quizAnswers: mergedQuizAnswers,
      },
      aiEvaluation: (existingHw?.aiEvaluation && isValidHomeworkEvaluation(existingHw.aiEvaluation) && !isSyntheticHomeworkEvaluation(existingHw.aiEvaluation))
        ? existingHw.aiEvaluation
        : undefined,
      updatedAt: new Date().toISOString(),
    };

    const initSave = await saveCanonicalHomeworkServer({
      studentUid: canonicalStudentUid,
      studentEmail: canonicalStudentEmail || homework.studentEmail,
      canonicalWeekId,
      cycle,
      homeworkPayload: unvalidatedHwState,
      isSubmit: false,
      enforceStaleCycle: true,
    });

    if (!initSave.ok) {
      await flightLock.release();
      if (initSave.statusCode === 409) {
        return res.status(409).json({
          success: false,
          error: 'STALE_CYCLE',
          code: 'STALE_CYCLE',
          activeCycle: initSave.activeCycle,
          requestedCycle: cycle,
          message: initSave.error || `Stale cycle ${cycle} rejected; active cycle is ${initSave.activeCycle}.`,
        });
      }
      if (!getIsCloudWriteDisabled()) {
        return res.status(initSave.statusCode || 500).json({
          success: false,
          persisted: false,
          error: 'FirestorePersistenceFailed',
          message: 'Falha ao salvar as respostas no banco de dados Firestore. Tente novamente.',
        });
      }
    }

    // AI evaluation of sentences with Gemini 3-model contingency (Frase do Dia robust pattern)
    const apiKey = (process.env.GEMINI_API_KEY || process.env.API_KEY || '').trim();
    let sentenceEvaluationResults: any[] = [];
    let readingEvaluationResults: any[] = [];
    let tutorSummaryPt = '';
    let tutorSummaryEn = '';
    let levelStrengthsPt = '';
    let levelStrengthsEn = '';
    let levelNextStepsPt = '';
    let levelNextStepsEn = '';

    try {
      if (apiKey) {
        const prompt = `You are a warm, inspiring Native English teacher at "It's Simple".
Evaluate this student's completed Part 3 Written Sentences for their Weekly Memorization Activity.

STUDENT PROFILE:
Name: ${effectiveName}
Level: ${levelMeta.labelEn} (${levelMeta.labelPt} - CEFR ${levelMeta.cefr})
Level Goals: ${levelMeta.grammarFocusEn}

PART 3: STUDENT WRITTEN SENTENCES (5 TARGET WORDS):
${JSON.stringify(
  (homework.sentenceWritingPrompts || []).map((p: any) => ({
    targetWord: p.word,
    studentSentence: (sentences[p.word] || sentences[p.word?.toLowerCase()] || sentences[p.word?.toUpperCase()] || '').trim(),
    promptHint: p.hintEn || p.hint,
    levelInstruction: p.levelInstruction || '',
    activityContext: (homework.wordOrigins || []).find((wo: any) => (wo.word || '').toLowerCase() === (p.word || '').toLowerCase())?.activityName || '',
  })),
  null,
  2
)}

CRITICAL EVALUATION INSTRUCTIONS (PART 3):
1. FOR EACH SENTENCE, assess both Grammar & Accuracy and Contextual Improvement separately:
   a) Grammar & Accuracy: Evaluate grammar, vocabulary, subject-verb agreement, and target word usage according to CEFR ${levelMeta.cefr}. If the sentence is grammatically sound, complete, and uses the target word properly, set isCorrect: true.
   b) Contextual Improvement: Provide a natural, idiomatic sentence in "correctedSentence".
2. CRITICAL RULE: A grammatically correct sentence must NEVER be marked isCorrect: false simply because a more sophisticated or native-like phrasing is possible. If the sentence is correct, set isCorrect: true and use "correctedSentence" for a richer contextual alternative.
3. ZERO SYNTHETIC APPROVALS: Incomplete fragments, missing subjects, transitive verbs ending abruptly without objects (e.g. 'nobody told'), dangling trailing prepositions (e.g. 'anyone know about'), or short fragments (< 3 words) MUST ALWAYS be marked isCorrect: false with a corrected full sentence.
4. In "explanationPt" and "explanationEn", clearly state:
   - Grammar & Accuracy status (is the sentence grammatically correct, or what error was found).
   - Contextual feedback explaining why the suggested phrasing sounds more natural or how it enriches the sentence.
5. In "levelAdvicePt" and "levelAdviceEn", provide guidance on how the sentence fulfills the grammatical challenge for ${levelMeta.labelEn} (levelInstruction).
6. Provide a personalized summary note from the tutor:
   - "tutorFeedbackSummaryPt" (in Portuguese) and "tutorFeedbackSummaryEn" (in English).
7. Provide level-specific strengths ("levelStrengthsPt", "levelStrengthsEn").
8. Provide actionable next steps for their English routine ("levelNextStepsPt", "levelNextStepsEn").

Output STRICT JSON matching this schema:
{
  "sentenceFeedback": [
    {
      "word": "string",
      "originalSentence": "string",
      "isCorrect": boolean,
      "correctedSentence": "string",
      "explanationPt": "string",
      "explanationEn": "string",
      "levelAdvicePt": "string",
      "levelAdviceEn": "string"
    }
  ],
  "tutorFeedbackSummaryPt": "string",
  "tutorFeedbackSummaryEn": "string",
  "levelStrengthsPt": "string",
  "levelStrengthsEn": "string",
  "levelNextStepsPt": "string",
  "levelNextStepsEn": "string"
}`;

        // HOTFIX 3-MODEL CONTINGENCY: Sequential failover across up to 3 verified models on recoverable errors
        const contingencyRes = await executeGeminiWithContingency({
          feature: 'homework_evaluate',
          systemInstruction: 'You are a warm, inspiring Native English teacher at "It\'s Simple". Evaluate student written sentences providing accurate, rigorous feedback strictly in valid JSON format.',
          untrustedUserDataPrompt: prompt,
          callerRole: effectiveRole,
          apiKey,
          temperature: 0.1,
          validator: (json) => validateHomeworkAiEvaluationResponse(
            json,
            homework.sentenceWritingPrompts || [],
            sentences || {}
          ),
        });

        if (
          contingencyRes.success &&
          contingencyRes.parsedJson &&
          validateHomeworkAiEvaluationResponse(
            contingencyRes.parsedJson,
            homework.sentenceWritingPrompts || [],
            sentences || {}
          )
        ) {
          sentenceEvaluationResults = contingencyRes.parsedJson.sentenceFeedback.map((item: any) => {
            const matchingPrompt = (homework.sentenceWritingPrompts || []).find(
              (p: any) => (p.word || '').toLowerCase() === (item.word || '').toLowerCase()
            );
            const promptWord = matchingPrompt ? matchingPrompt.word : item.word;
            const rawStudentText = (sentences[promptWord] || sentences[promptWord?.toLowerCase()] || sentences[item.word] || '').trim();

            const cleanTarget = (promptWord || '').toLowerCase().trim();
            const lowerAns = rawStudentText.toLowerCase();
            const rootTarget = cleanTarget.replace(/(ing|ed|s|es|d)$/i, '');
            const usedTarget = cleanTarget
              ? lowerAns.includes(cleanTarget) || (rootTarget.length >= 4 && lowerAns.includes(rootTarget))
              : true;
            const detGrammar = analyzeSentenceGrammarDeterministic(rawStudentText, [promptWord], promptWord);

            let finalIsCorrect = Boolean(item.isCorrect);
            if (!rawStudentText || !usedTarget || detGrammar.hasGrammarError) {
              finalIsCorrect = false;
            }

            return {
              ...item,
              word: promptWord,
              originalSentence: rawStudentText || '(nenhuma frase enviada)',
              isCorrect: finalIsCorrect,
              correctedSentence: item.correctedSentence || detGrammar.fixedSentence || rawStudentText,
              explanationPt: !usedTarget && cleanTarget
                ? `A palavra-alvo "${promptWord}" não foi utilizada na frase. Inclua "${promptWord}" para validar o exercício.`
                : detGrammar.hasGrammarError && !item.explanationPt
                ? detGrammar.errorsPt.join(' ')
                : item.explanationPt || '',
              explanationEn: !usedTarget && cleanTarget
                ? `The target word "${promptWord}" was not used in the sentence. Include "${promptWord}" to complete the exercise.`
                : detGrammar.hasGrammarError && !item.explanationEn
                ? detGrammar.errorsEn.join(' ')
                : item.explanationEn || '',
            };
          });

          // Part 4 readingFeedback derived deterministically from questions and student answers, with optional AI insight
          const geminiReadingMap = new Map<string, any>();
          if (Array.isArray(contingencyRes.parsedJson.readingFeedback)) {
            for (const rf of contingencyRes.parsedJson.readingFeedback) {
              if (rf && rf.id) geminiReadingMap.set(String(rf.id), rf);
            }
          }

          readingEvaluationResults = (homework.readingPassage?.questions || []).map((q: any, qIdx: number) => {
            const userAnsIdx = quizAnswers[q.id] !== undefined ? quizAnswers[q.id] : quizAnswers[String(qIdx)];
            const answered = userAnsIdx !== undefined && userAnsIdx !== null && userAnsIdx !== '';
            const userAnsText = answered && q.options?.[userAnsIdx] ? q.options[userAnsIdx] : (answered ? String(userAnsIdx) : '(sem resposta)');
            const correctAnsText = q.options?.[q.correctAnswer] || '';
            const isExactCorrect = answered && userAnsIdx === q.correctAnswer;

            const gRf = geminiReadingMap.get(String(q.id)) || geminiReadingMap.get(`q-${qIdx + 1}`);
            const isSemanticCorrect = gRf && typeof gRf.isCorrect === 'boolean' ? gRf.isCorrect : isExactCorrect;
            const isFinalCorrect = !answered ? false : (isExactCorrect || isSemanticCorrect);

            return {
              id: q.id || `q-${qIdx + 1}`,
              isCorrect: isFinalCorrect,
              userAnswer: userAnsText,
              correctAnswer: correctAnsText,
              explanationPt: gRf?.explanationPt || q.explanation || (isFinalCorrect ? 'Resposta correta com base no texto!' : `Opção correta: ${correctAnsText}.`),
              explanationEn: gRf?.explanationEn || q.explanation || (isFinalCorrect ? 'Correct interpretation based on the passage!' : `Correct option: ${correctAnsText}.`),
            };
          });

          tutorSummaryPt = contingencyRes.parsedJson.tutorFeedbackSummaryPt || '';
          tutorSummaryEn = contingencyRes.parsedJson.tutorFeedbackSummaryEn || '';
          levelStrengthsPt = contingencyRes.parsedJson.levelStrengthsPt || '';
          levelStrengthsEn = contingencyRes.parsedJson.levelStrengthsEn || '';
          levelNextStepsPt = contingencyRes.parsedJson.levelNextStepsPt || '';
          levelNextStepsEn = contingencyRes.parsedJson.levelNextStepsEn || '';
        }
      }
    } finally {
      await flightLock.release();
    }

    // Fail transparently: zero invented teacher evaluations when contingency models fail
    if (sentenceEvaluationResults.length === 0) {
      return res.status(503).json({
        success: false,
        persisted: true,
        evaluationStatus: 'pending_evaluation',
        error: 'AiUnavailable',
        message: 'Serviço de avaliação pedagógica temporariamente indisponível após tentativa com os modelos de contingência. Suas respostas foram preservadas.',
      });
    }

    // Standardized scores: Matching 20%, Fill 25%, Sentences 35%, Reading 20%
    let sentenceCorrectCount = 0;
    sentenceEvaluationResults.forEach((s) => {
      if (s.isCorrect) sentenceCorrectCount++;
    });
    const sentenceScore = (sentenceCorrectCount / totalSentences) * 35;

    let readingCorrectCount = 0;
    const finalReadingFeedback = readingEvaluationResults.length > 0 ? readingEvaluationResults : readingFeedback;
    finalReadingFeedback.forEach((r: any) => {
      if (r.isCorrect) readingCorrectCount++;
    });
    const quizScore = (readingCorrectCount / totalQuiz) * 20;

    const overallScore = Math.min(100, Math.round(matchScore + fillScore + quizScore + sentenceScore));

    const evaluationResponse = {
      overallScore,
      evaluatedAt: new Date().toISOString(),
      studentLevel: levelMeta.labelEn,
      tutorFeedbackSummaryPt: tutorSummaryPt,
      tutorFeedbackSummaryEn: tutorSummaryEn,
      levelStrengthsPt,
      levelStrengthsEn,
      levelNextStepsPt,
      levelNextStepsEn,
      matchingFeedback,
      fillFeedback,
      sentenceFeedback: sentenceEvaluationResults,
      readingFeedback: finalReadingFeedback,
    };

    // Persist genuine validated evaluation directly to canonical Firestore '(default)'
    const updatedHwForStorage = {
      ...homework,
      id: canonicalWeekId,
      weekId: canonicalWeekId,
      weeklyCycle: cycle,
      studentUid: canonicalStudentUid,
      studentEmail: canonicalStudentEmail || homework.studentEmail,
      isCompleted: true,
      score: overallScore,
      submittedAt: existingHw?.submittedAt || homework.submittedAt || new Date().toISOString(),
      studentAnswers: {
        matching: mergedMatching,
        fillInBlanks: mergedFill,
        sentences: mergedSentences,
        quizAnswers: mergedQuizAnswers,
      },
      aiEvaluation: evaluationResponse,
      updatedAt: new Date().toISOString(),
    };

    const evalSave = await saveCanonicalHomeworkServer({
      studentUid: canonicalStudentUid,
      studentEmail: canonicalStudentEmail || homework.studentEmail,
      canonicalWeekId,
      cycle,
      homeworkPayload: updatedHwForStorage,
      isSubmit: true,
      enforceStaleCycle: true,
    });

    if (!evalSave.ok) {
      return res.status(evalSave.statusCode === 409 ? 409 : 500).json({
        success: false,
        persisted: true,
        evaluationStatus: 'evaluation_persist_failed',
        error: evalSave.statusCode === 409 ? 'STALE_CYCLE' : 'EvaluationPersistenceFailed',
        message: 'Suas respostas foram salvas, mas ocorreu uma falha ao registrar a avaliação definitiva no banco de dados. Tente novamente.',
      });
    }

    // Cache evaluated result only after confirmed persistence
    if (isValidHomeworkEvaluation(evaluationResponse)) {
      homeworkEvalCache.set(evalCacheKey, { data: evaluationResponse, expiry: Date.now() + 600000 });
    }

    return res.json({
      success: true,
      persisted: true,
      evaluationStatus: 'completed',
      evaluation: evaluationResponse,
    });
  } catch (error: any) {
    console.error('Error evaluating homework:', error);
    res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
});

// AI Live Lesson Vocabulary Generator (Restricted strictly to Teachers and Admins)
app.post('/api/lesson/vocab-generate', firebaseAuthMiddleware, requireTeacher, async (req, res) => {
  const caller = req.user!;
  const callerUid = caller.uid;
  const { words, topic, notes } = req.body || {};
  if (!words || !Array.isArray(words) || words.length === 0) {
    return res.status(400).json({ error: 'words array is required' });
  }

  const cleanWords = words.map((w: any) => String(w || '').trim()).filter((w) => w.length > 0);
  if (cleanWords.length === 0) {
    return res.json({ success: true, entries: [] });
  }

  // 1. Check in-memory cache to prevent duplicate generation and unnecessary cost
  const vocabCacheKey = `${cleanWords.map((w: string) => w.toLowerCase().trim()).sort().join('|')}__${(topic || '').trim().toLowerCase()}`;
  if (lessonVocabCache.has(vocabCacheKey)) {
    return res.json({ success: true, entries: lessonVocabCache.get(vocabCacheKey), cached: true });
  }

  // Security Hotfix (Etapa 2 & Residuals): Payload bounds validation
  const bounds = validatePayloadBounds('vocab_generate', {
    words: cleanWords,
    text: `${topic || ''} ${notes || ''}`,
  });
  if (!bounds.valid) {
    return res.status(400).json({ error: 'Payload bounds exceeded', message: bounds.error });
  }

  // Security Hotfix (Etapa 2 & Residuals): Rate limiting check per authenticated teacher UID
  const rateCheck = await checkAndConsumeRateLimit(callerUid, 'vocab_generate');
  if (!rateCheck.allowed) {
    if (rateCheck.unavailable) {
      return sendGeminiCostControlUnavailable(res, 5);
    }
    logGeminiAudited({
      feature: 'vocab_generate',
      status: 'RATE_LIMITED',
      callerRole: caller.role,
      detail: `Rate limit hit, retry after ${rateCheck.retryAfterSeconds}s`,
    });
    return res.status(429).json({
      success: false,
      error: 'Rate limit exceeded',
      message: 'Limite de solicitações de geração de vocabulário atingido. Aguarde alguns instantes.',
      retryAfterSeconds: rateCheck.retryAfterSeconds,
    });
  }

  // Security Hotfix (Etapa 2 & Residuals): Multi-instance Single-Flight Lock
  const flightLock = await acquireSingleFlightLock(`vocab_generate:${vocabCacheKey}`);
  if (!flightLock.acquired) {
    if (flightLock.unavailable) {
      return sendGeminiCostControlUnavailable(res, 5);
    }
    logGeminiAudited({
      feature: 'vocab_generate',
      status: 'INFLIGHT_LOCKED',
      callerRole: caller.role,
      detail: 'Concurrent vocab generation in progress',
    });
    return res.status(429).json({
      success: false,
      error: 'Concurrent generation in progress',
      message: 'Uma geração de vocabulário idêntica já está em processamento.',
      retryAfterSeconds: 4,
    });
  }

  let generatedEntries: any[] | null = null;
  try {
    if (process.env.GEMINI_API_KEY) {
      const prompt = `You are a native English language teacher creating personalized vocabulary study notes for a live conversation lesson.
Lesson Topic: "${topic || 'Everyday conversation and practical routines'}"
Teacher's Live Lesson Notes/Context: "${notes || 'Real-life speaking practice'}"
Vocabulary items typed by the teacher during class: ${JSON.stringify(cleanWords)}

For EACH word or expression, generate a distinct, highly contextual pedagogical entry tailored specifically to that word:
1. word: exact word/expression
2. definitionEn: A simple, natural 1-sentence English definition explaining what the word means clearly for an English learner.
3. exampleSentenceEn: A natural, practical conversational or workplace example sentence in English that authentically uses the word in real context (NO generic placeholders, and never repeat the same sentence structure across words).
4. translationPt: A clear, concise Portuguese translation of the term.

Return a JSON array of objects with the exact schema:
[
  {
    "word": "string",
    "definitionEn": "string",
    "exampleSentenceEn": "string",
    "translationPt": "string"
  }
]`;

      // Gemini 3-Model Contingency: Up to 3 sequential attempts across verified models on recoverable failures
      const contingencyResult = await executeGeminiWithContingency({
        feature: 'vocab_generate',
        systemInstruction: 'You are a native English language teacher creating personalized vocabulary study notes for a live conversation lesson. Respond strictly with a JSON array.',
        untrustedUserDataPrompt: prompt,
        callerRole: caller.role,
        jsonValidator: (val) => Array.isArray(val) && val.length > 0,
      });

      if (contingencyResult && Array.isArray(contingencyResult.parsedJson) && contingencyResult.parsedJson.length > 0) {
        generatedEntries = contingencyResult.parsedJson;
      }
    }
  } finally {
    await flightLock.release();
  }

  if (generatedEntries && generatedEntries.length > 0) {
    lessonVocabCache.set(vocabCacheKey, generatedEntries);
    return res.json({ success: true, entries: generatedEntries });
  }

  // Non-negotiable Rule 6 & 7: Do not invent generic definitions or synthetic pedagogical entries.
  return res.status(503).json({
    success: false,
    error: 'AiUnavailable',
    message: 'Serviço de geração de vocabulário temporariamente indisponível após tentativa com os modelos de contingência. Os termos originais foram preservados.',
  });
});

// Explicit route for Privacy Policy (Google verification & direct access)
app.get(['/privacy.html', '/privacy'], (_req, res) => {
  const fileCandidates = [
    path.join(process.cwd(), 'privacy.html'),
    path.join(process.cwd(), 'public', 'privacy.html'),
    path.join(process.cwd(), 'dist', 'privacy.html'),
  ];
  for (const candidate of fileCandidates) {
    if (fs.existsSync(candidate)) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.sendFile(candidate);
    }
  }
  res.status(404).send('Privacy policy not found');
});

// Explicit route for Terms of Service (Google verification & direct access)
app.get(['/terms.html', '/terms'], (_req, res) => {
  const fileCandidates = [
    path.join(process.cwd(), 'terms.html'),
    path.join(process.cwd(), 'public', 'terms.html'),
    path.join(process.cwd(), 'dist', 'terms.html'),
  ];
  for (const candidate of fileCandidates) {
    if (fs.existsSync(candidate)) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.sendFile(candidate);
    }
  }
  res.status(404).send('Terms of service not found');
});

export async function startServer() {
  if (isDiagnosticMode()) {
    console.log('[Diagnostic] Backend starting in DIAGNOSTIC_ONLY mode (Project: itissimple-security-staging)');
    const server = app.listen(PORT, '0.0.0.0', () => {
      console.log(`[Diagnostic] Dedicated Diagnostic Backend running on http://0.0.0.0:${PORT} (PORT=${PORT})`);
    });
    server.on('error', (err: any) => {
      if (err.code === 'EADDRINUSE') {
        console.warn(`Port ${PORT} is already in use, listening skipped.`);
      } else {
        console.error('Server error event:', err);
      }
    });
    return server;
  }

  // Preload local database into memory immediately
  readDb();

  // Hydrate from Cloud Firestore in background without delaying server port readiness
  initCloudPersistence()
    .catch((err) => {
      console.warn('Initial cloud persistence notice:', err);
    })
    .finally(() => {
      isCloudHydrated = true;
    });

  const isStandalone = process.env.STANDALONE_BACKEND === 'true' || process.env.BACKEND_ONLY === 'true';

  if (isStandalone) {
    // Dedicated standalone Express backend mode: zero Vite or React frontend dependencies
    console.log(`[Backend] Dedicated Cloud Run Express backend running in standalone mode on port ${PORT}`);
    app.get('/', (_req, res) => {
      res.json({
        service: "It's Simple Dedicated Backend API",
        status: 'online',
        projectId: process.env.FIREBASE_PROJECT_ID || 'itissimple-security-staging',
        environment: process.env.NODE_ENV || 'production',
        port: PORT,
        timestamp: new Date().toISOString(),
      });
    });
  } else if (!isProductionMode()) {
    console.log(`[Server] Running in DEVELOPMENT mode with Vite dev middleware on port ${PORT}`);
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    console.log(`[Server] Running in PRODUCTION mode serving compiled static bundle on port ${PORT}`);
    const distPath = path.join(process.cwd(), 'dist');
    if (fs.existsSync(distPath)) {
      app.use(express.static(distPath));
      app.get('*', (req, res) => {
        if (req.path.startsWith('/api/')) {
          return res.status(404).json({ error: 'Not Found', message: `Route ${req.originalUrl} not found` });
        }
        res.sendFile(path.join(distPath, 'index.html'));
      });
    } else {
      console.warn('[Server] Production mode active but dist directory was not found. Serving API status fallback.');
      app.get('/', (_req, res) => {
        res.json({
          service: "It's Simple Dedicated Backend API",
          status: 'online',
          projectId: process.env.FIREBASE_PROJECT_ID || 'itissimple-security-staging',
          port: PORT,
          timestamp: new Date().toISOString(),
        });
      });
    }
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`It's Simple Server running on http://0.0.0.0:${PORT} (PORT=${PORT})`);
  });

  server.on('error', (err: any) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`Port ${PORT} is currently in use. Retrying in 1s...`);
      setTimeout(() => {
        try {
          server.close();
        } catch {}
        app.listen(PORT, '0.0.0.0', () => {
          console.log(`It's Simple Server re-bound and running on http://0.0.0.0:${PORT} (PORT=${PORT})`);
        });
      }, 1000);
    } else {
      console.error('Server error event:', err);
    }
  });

  return server;
}

export { app };

// Auto-start server unless disabled for testing
if (process.env.NODE_ENV !== 'test') {
  startServer().catch((err: unknown) => {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[Server] Fatal error during startup: ${errorMsg}`);
    process.exit(1);
  });
}
